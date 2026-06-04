/**
 * JUNE FURY — VPS API server (replaces Cloudflare Worker)
 * Runs on the urbanpadel.om VPS, proxied by nginx.
 *
 * Routes (same contract as the Cloudflare Worker):
 *   GET  /state            → { ok, state }   (public)
 *   POST /login  { pin }   → { ok, role, token }
 *   POST /save   { state } → { ok }           (requires Bearer token)
 *
 * Env vars (set in /opt/june-fury-api/.env):
 *   DATABASE_URL   postgresql://urbanpadel_app:...@127.0.0.1:5432/urbanpadel
 *   ADMIN_PIN      admin PIN
 *   SCORER_PIN     scorer PIN
 *   TOKEN_SECRET   long random string
 *   PORT           (optional, default 3001)
 */

require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "10mb" }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TOKEN_TTL = 60 * 60 * 12; // 12 h

// ── Bootstrap DB table ────────────────────────────────────────────
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_state (
      id         INTEGER PRIMARY KEY DEFAULT 1,
      data       JSONB    NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO tournament_state (id, data) VALUES (1, '{}')
    ON CONFLICT (id) DO NOTHING
  `);
  console.log("DB ready");
}

// ── Routes ────────────────────────────────────────────────────────

app.get("/state", async (req, res) => {
  try {
    const r = await pool.query("SELECT data FROM tournament_state WHERE id = 1");
    res.json({ ok: true, state: r.rows[0]?.data || {} });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.post("/login", async (req, res) => {
  const pin = String(req.body?.pin ?? "");
  let role = null;
  if (process.env.ADMIN_PIN  && pin === String(process.env.ADMIN_PIN))  role = "admin";
  else if (process.env.SCORER_PIN && pin === String(process.env.SCORER_PIN)) role = "scorer";
  if (!role) return res.status(401).json({ ok: false });
  const token = signToken(role);
  res.json({ ok: true, role, token });
});

app.post("/save", async (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const { state } = req.body || {};
  if (!state || typeof state !== "object")
    return res.status(400).json({ ok: false, error: "Missing state" });

  try {
    await pool.query(
      `INSERT INTO tournament_state (id, data, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
      [state]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// ── HMAC token (same format as Cloudflare Worker) ─────────────────

function hmac(data) {
  return crypto
    .createHmac("sha256", process.env.TOKEN_SECRET)
    .update(data)
    .digest("base64url");
}

function signToken(role) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const data = `${role}.${exp}`;
  return `${data}.${hmac(data)}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [role, exp, sig] = parts;
  if (sig !== hmac(`${role}.${exp}`)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  if (role !== "admin" && role !== "scorer") return null;
  return { role, exp: Number(exp) };
}

// ── Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
initDb()
  .then(() => app.listen(PORT, "127.0.0.1", () => console.log(`June Fury API :${PORT}`)))
  .catch(e => { console.error("Startup failed:", e); process.exit(1); });
