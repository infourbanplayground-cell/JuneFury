/**
 * JUNE FURY — Cloudflare Worker auth + storage proxy
 *
 * Keeps the JSONBin master key and the Admin/Scorer PINs server-side so they
 * never ship to the browser. Public can READ tournament state; only a client
 * holding a valid signed token (issued after a correct PIN) can WRITE.
 *
 * Routes:
 *   GET  /state            → returns the current tournament state (public)
 *   POST /login  {pin}     → { ok, role, token }  (role: "admin" | "scorer")
 *   POST /save   {state}   → requires "Authorization: Bearer <token>"
 *
 * Required secrets / vars (set via `wrangler secret put` or the dashboard):
 *   JSONBIN_ID     — the bin id (e.g. 6a1c241821f9ee59d2a0ebcd)
 *   JSONBIN_KEY    — the JSONBin X-Master-Key
 *   ADMIN_PIN      — admin PIN (full access)
 *   SCORER_PIN     — scorer PIN (scoring access)
 *   TOKEN_SECRET   — any long random string; signs the session tokens
 *   ALLOW_ORIGIN   — (optional) allowed CORS origin, e.g.
 *                    https://infourbanplayground-cell.github.io  (default "*")
 */

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12h sessions

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === "/state" && request.method === "GET") {
        return await handleState(env, cors);
      }
      if (url.pathname === "/login" && request.method === "POST") {
        return await handleLogin(request, env, cors);
      }
      if (url.pathname === "/save" && request.method === "POST") {
        return await handleSave(request, env, cors);
      }
      return json({ ok: false, error: "Not found" }, 404, cors);
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) }, 500, cors);
    }
  },
};

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

// ── GET /state ───────────────────────────────────────────────────────────
async function handleState(env, cors) {
  const res = await fetch("https://api.jsonbin.io/v3/b/" + env.JSONBIN_ID + "/latest", {
    headers: { "X-Master-Key": env.JSONBIN_KEY, "X-Bin-Meta": "false" },
  });
  if (!res.ok) return json({ ok: false, error: "Load failed (" + res.status + ")" }, 502, cors);
  const state = await res.json();
  return json({ ok: true, state }, 200, cors);
}

// ── POST /login ──────────────────────────────────────────────────────────
async function handleLogin(request, env, cors) {
  const body = await request.json().catch(() => ({}));
  const pin = String(body.pin || "");
  let role = null;
  if (env.ADMIN_PIN && pin === String(env.ADMIN_PIN)) role = "admin";
  else if (env.SCORER_PIN && pin === String(env.SCORER_PIN)) role = "scorer";
  if (!role) return json({ ok: false }, 401, cors);
  const token = await signToken(role, env.TOKEN_SECRET);
  return json({ ok: true, role, token }, 200, cors);
}

// ── POST /save ───────────────────────────────────────────────────────────
async function handleSave(request, env, cors) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = await verifyToken(token, env.TOKEN_SECRET);
  if (!payload) return json({ ok: false, error: "Unauthorized" }, 401, cors);

  const body = await request.json().catch(() => ({}));
  if (!body.state || typeof body.state !== "object") {
    return json({ ok: false, error: "Missing state" }, 400, cors);
  }
  const res = await fetch("https://api.jsonbin.io/v3/b/" + env.JSONBIN_ID, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": env.JSONBIN_KEY },
    body: JSON.stringify(body.state),
  });
  if (!res.ok) return json({ ok: false, error: "Save failed (" + res.status + ")" }, 502, cors);
  return json({ ok: true }, 200, cors);
}

// ── Token signing (HMAC-SHA256, no deps) ───────────────────────────────────
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signToken(role, secret) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const data = role + "." + exp;
  const sig = await hmac(data, secret);
  return data + "." + sig;
}

async function verifyToken(token, secret) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [role, exp, sig] = parts;
  const expected = await hmac(role + "." + exp, secret);
  if (sig !== expected) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  if (role !== "admin" && role !== "scorer") return null;
  return { role, exp: Number(exp) };
}
