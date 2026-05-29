// ═══════════════════════════════════════════════════════════════
// JUNE FURY — Google Apps Script Backend
// ═══════════════════════════════════════════════════════════════
//
// SETUP (one-time):
//   1. Open your Google Sheet → Extensions → Apps Script
//   2. Paste this entire file, replacing any existing code
//   3. Change ADMIN_PIN below to a secret 4–8 digit code
//   4. Click Deploy → New deployment → Web app
//        Execute as: Me
//        Who has access: Anyone
//   5. Copy the deployment URL and paste it into index.html
//        where it says "PASTE_YOUR_APPS_SCRIPT_URL_HERE"
//   6. Re-deploy (create a new deployment) whenever you update this file
//
// ═══════════════════════════════════════════════════════════════

const ADMIN_PIN  = "1234";        // ← change this before deploying
const SHEET_NAME = "JuneFury";    // sheet tab name (auto-created if absent)
const STATE_CELL = "A1";          // single cell that stores JSON state

// ── helpers ────────────────────────────────────────────────────

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.hideSheet();            // keep the sheet tidy and hidden
  }
  return sheet;
}

function jsonp(callback, payload) {
  const body = callback + "(" + JSON.stringify(payload) + ")";
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function cors(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET handler ────────────────────────────────────────────────

function doGet(e) {
  const params   = e.parameter || {};
  const action   = params.action   || "";
  const callback = params.callback || "";

  const respond = (payload) =>
    callback ? jsonp(callback, payload) : cors(payload);

  try {
    if (action === "getState") {
      const raw = getSheet().getRange(STATE_CELL).getValue();
      if (!raw) return respond({ ok: true, state: null });
      const state = JSON.parse(raw);
      return respond({ ok: true, state });
    }

    if (action === "unlock") {
      const ok = (params.pin || "").trim() === ADMIN_PIN;
      return respond({ ok });
    }

    return respond({ ok: false, error: "Unknown action: " + action });

  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

// ── POST handler ───────────────────────────────────────────────

function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action || "";

    if (action === "saveState") {
      if (!body.state) throw new Error("Missing state");
      getSheet().getRange(STATE_CELL).setValue(JSON.stringify(body.state));
      return cors({ ok: true });
    }

    return cors({ ok: false, error: "Unknown action: " + action });

  } catch (err) {
    return cors({ ok: false, error: err.message });
  }
}
