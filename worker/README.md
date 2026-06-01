# JUNE FURY — Cloudflare Worker (auth + storage proxy)

This Worker hides the JSONBin master key and the Admin/Scorer PINs **server-side**.
The browser can read tournament state but can only **save** after logging in with a
PIN and receiving a short-lived signed token. Nothing secret ships in `index.html`.

## What it does

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/state` | GET | none | Return current tournament state (public read) |
| `/login` | POST | PIN in body | Return `{ role, token }` if PIN matches |
| `/save` | POST | `Authorization: Bearer <token>` | Write state to JSONBin |

Tokens are HMAC-signed `role.expiry.signature` strings, valid 12h.

---

## Deploy — Option A: Cloudflare dashboard (no install, ~10 min)

1. Go to **dash.cloudflare.com** → sign up (free) / log in.
2. Left sidebar → **Workers & Pages** → **Create** → **Create Worker**.
3. Name it `june-fury` → **Deploy** (deploys a placeholder).
4. Click **Edit code**. Delete the placeholder, paste the entire contents of
   `june-fury-worker.js`, then **Deploy** (top right).
5. Go to the Worker's **Settings → Variables and Secrets**. Add these
   (use **Encrypt** / "Secret" for all except `ALLOW_ORIGIN`):

   | Name | Type | Value |
   |---|---|---|
   | `JSONBIN_ID` | Secret | `6a1c241821f9ee59d2a0ebcd` |
   | `JSONBIN_KEY` | Secret | your JSONBin X-Master-Key |
   | `ADMIN_PIN` | Secret | pick a new admin PIN |
   | `SCORER_PIN` | Secret | pick a new scorer PIN |
   | `TOKEN_SECRET` | Secret | a long random string (mash the keyboard) |
   | `ALLOW_ORIGIN` | Plaintext | `https://infourbanplayground-cell.github.io` |

6. **Deploy** again so the variables take effect.
7. Copy your Worker URL — looks like
   `https://june-fury.<your-subdomain>.workers.dev`.
8. In `index.html`, set `WORKER_URL` (top of the API client block) to that URL.
   Commit + push.

### Verify
Open `https://june-fury.<subdomain>.workers.dev/state` in a browser — you should
see `{"ok":true,"state":{...}}`. If you see an error about the bin, recheck
`JSONBIN_ID` / `JSONBIN_KEY`.

---

## Deploy — Option B: Wrangler CLI

```bash
npm install -g wrangler
cd worker
wrangler login

# Set secrets (you'll be prompted to paste each value)
wrangler secret put JSONBIN_ID
wrangler secret put JSONBIN_KEY
wrangler secret put ADMIN_PIN
wrangler secret put SCORER_PIN
wrangler secret put TOKEN_SECRET

wrangler deploy
```

`ALLOW_ORIGIN` is read from `wrangler.toml` (`[vars]`). Adjust it there if your
site is served from a different origin.

---

## Rotating PINs later
Just update the `ADMIN_PIN` / `SCORER_PIN` secrets in the dashboard (or
`wrangler secret put`) and redeploy. No code or `index.html` change needed.
Old tokens stay valid until they expire (max 12h) unless you also rotate
`TOKEN_SECRET`, which invalidates every existing session immediately.

## Security notes
- The JSONBin key and PINs never leave Cloudflare — `index.html` only knows the
  Worker URL, which is safe to expose.
- `ALLOW_ORIGIN` restricts which site can call the Worker from a browser. (It
  doesn't stop `curl`, but it stops other websites from using your Worker.)
- A determined attacker can still read the **public** state via `/state`; that's
  by design (the leaderboard is public). Only writes are protected.
