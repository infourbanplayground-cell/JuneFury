// ═══════════════════════════════════════════════════════════════
// JUNE FURY — Google Apps Script Backend
// ═══════════════════════════════════════════════════════════════
//
// SETUP (one-time):
//   1. Open your Google Sheet → Extensions → Apps Script
//      (or go to script.google.com → new project)
//   2. Paste this entire file, replacing any existing code
//   3. Set your admin PIN (see step below — do NOT leave it as "1234")
//   4. Click Deploy → New deployment → Web app
//        Execute as: Me
//        Who has access: Anyone
//   5. Copy the deployment URL and paste it into index.html line 49
//   6. Every time you change this file → Deploy → New deployment again
//
// SETTING YOUR ADMIN PIN (without touching the code):
//   Apps Script → Project Settings (gear icon) → Script Properties
//   → Add property:  Name = ADMIN_PIN   Value = your-secret-pin
//   If no Script Property is set, the default PIN below is used.
//
// ═══════════════════════════════════════════════════════════════

const DEFAULT_PIN = "1234"; // fallback if ADMIN_PIN script property not set
const STATE_KEY   = "june_fury_state";

// ── helpers ────────────────────────────────────────────────────

function getPin() {
  return PropertiesService.getScriptProperties().getProperty("ADMIN_PIN") || DEFAULT_PIN;
}

function loadState() {
  const raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function persistState(state) {
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(state));
}

function jsonp(callback, payload) {
  const body = callback + "(" + JSON.stringify(payload) + ")";
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function respond(callback, payload) {
  // Always use JSONP when a callback is present (GET requests from the app).
  // Falls back to plain JSON for direct browser testing.
  if (callback) return jsonp(callback, payload);
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET handler ────────────────────────────────────────────────
// Handles: getState, unlock, saveState
// saveState via GET avoids the Apps Script POST→redirect issue that
// causes fetch(no-cors) to silently drop the request body.

function doGet(e) {
  const p        = e.parameter || {};
  const action   = p.action   || "";
  const callback = p.callback || "";

  try {
    if (action === "getState") {
      const state = loadState();
      return respond(callback, { ok: true, state });
    }

    if (action === "unlock") {
      const ok = (p.pin || "").trim() === getPin();
      return respond(callback, { ok });
    }

    if (action === "saveState") {
      const raw = p.state || "";
      if (!raw) return respond(callback, { ok: false, error: "Missing state" });
      persistState(JSON.parse(decodeURIComponent(raw)));
      return respond(callback, { ok: true });
    }

    return respond(callback, { ok: false, error: "Unknown action: " + action });

  } catch (err) {
    return respond(callback, { ok: false, error: err.message });
  }
}

// ── POST handler (kept as fallback) ───────────────────────────

function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action || "";

    if (action === "saveState") {
      if (!body.state) throw new Error("Missing state");
      persistState(body.state);
      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Unknown action" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
