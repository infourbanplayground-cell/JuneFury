// ════════════════════════════════════════════════════════════════
// 🔥 JUNE FURY — Apps Script Backend
// Urban Playground · Padel Tournament Series
// ════════════════════════════════════════════════════════════════

// CHANGE THIS PIN to unlock organizer mode on the dashboard
const ADMIN_PIN = "0001";

// ─── ENDPOINTS ────────────────────────────────────────────────

function doGet(e) {
  const cb = e.parameter.callback;
  const action = e.parameter.action || "ping";
  let result;
  try {
    if (action === "ping") result = { ok: true, ts: Date.now() };
    else if (action === "getState") result = { ok: true, state: readState() };
    else if (action === "unlock") result = { ok: String(e.parameter.pin) === String(ADMIN_PIN) };
    else if (action === "saveState") {
      // accepts both "state" (sent by app) and "data" (legacy)
      const raw = e.parameter.state || e.parameter.data || "{}";
      writeState(JSON.parse(raw));
      result = { ok: true };
    } else result = { ok: false, error: "Unknown action: " + action };
  } catch (err) {
    result = { ok: false, error: String(err && err.message || err) };
  }
  if (cb) return ContentService.createTextOutput(cb + "(" + JSON.stringify(result) + ")")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === "saveState") writeState(body.state);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── STATE STORAGE ────────────────────────────────────────────

function readState() {
  const props = PropertiesService.getScriptProperties();
  const json = props.getProperty("STATE_JSON");
  if (!json) return null;
  try { return JSON.parse(json); } catch (e) { return null; }
}

function writeState(state) {
  if (!state || typeof state !== "object") throw new Error("Invalid state");
  const props = PropertiesService.getScriptProperties();
  state._lastUpdated = Date.now();
  props.setProperty("STATE_JSON", JSON.stringify(state));
  try { updateLeaderboardSheet(state); } catch (e) { Logger.log("LB update failed: " + e); }
  try { updateSessionsSheet(state); } catch (e) { Logger.log("Sessions sheet failed: " + e); }
}

// ─── POINT CALCULATIONS (mirror of frontend) ─────────────────

function calcStreak(idxs) {
  if (!idxs || !idxs.length) return 0;
  const sorted = idxs.slice().sort(function(a, b) { return a - b; });
  let total = 0, len = 0, last = null;
  sorted.forEach(function(i) {
    if (last === null || i === last + 1) len++;
    else len = 1;
    last = i;
    if (len === 1 || len === 2 || len === 3) total += 1;
    else if (len === 4) total += 2;
  });
  return Math.min(total, 5);
}

function teamWon(m, teamId) {
  if (!m || !m.winner) return false;
  if (m.winner === "team1") return m.team1Id === teamId;
  if (m.winner === "team2") return m.team2Id === teamId;
  return false;
}

function getPlayerTeam(session, pid) {
  return (session.teams || []).filter(function(t) { return t.p1Id === pid || t.p2Id === pid; })[0];
}

function calcGroupStandings(session, group) {
  const teams = (session.teams || []).filter(function(t) { return t.group === group; });
  return teams.map(function(team) {
    let pts = 0, wins = 0, played = 0;
    (session.groupMatches || []).forEach(function(m) {
      if (m.team1Id !== team.id && m.team2Id !== team.id) return;
      if (!m.winner) return;
      played++;
      if (teamWon(m, team.id)) { pts += 3; wins++; }
      else {
        const t = m.lossType || "tiebreak";
        if (t === "tiebreak") pts += 2;
        else if (t === "competitive") pts += 1;
      }
    });
    return { team: team, pts: pts, wins: wins, played: played };
  }).sort(function(a, b) { return b.pts - a.pts || b.wins - a.wins; });
}

function getTopOfGroup(session, group) {
  const ov = session.topOfGroupOverride && session.topOfGroupOverride[group];
  if (ov) return ov;
  const s = calcGroupStandings(session, group);
  return s[0] && s[0].team && s[0].team.id || null;
}

function calcPlayerPoints(playerId, sessions) {
  let total = 0;
  const stats = { sessions: 0, wins: 0, finalsWon: 0, finalsReached: 0 };
  const attended = [];
  sessions.forEach(function(session, idx) {
    const team = getPlayerTeam(session, playerId);
    if (!team) return;
    attended.push(idx);
    stats.sessions++;
    (session.groupMatches || []).forEach(function(m) {
      if (m.team1Id !== team.id && m.team2Id !== team.id) return;
      if (!m.winner) return;
      if (teamWon(m, team.id)) { total += 3; stats.wins++; }
      else {
        const t = m.lossType || "tiebreak";
        total += t === "tiebreak" ? 2 : t === "competitive" ? 1 : 0;
      }
    });
    if (getTopOfGroup(session, team.group) === team.id) total += 1;
    const qf = (session.bracket && session.bracket.qf || []).filter(function(m) { return m.team1Id === team.id || m.team2Id === team.id; })[0];
    if (qf) {
      total += 1;
      if (teamWon(qf, team.id)) {
        const sf = (session.bracket.sf || []).filter(function(m) { return m.team1Id === team.id || m.team2Id === team.id; })[0];
        if (sf) {
          total += 2;
          if (teamWon(sf, team.id)) {
            const f = session.bracket.final;
            if (f && (f.team1Id === team.id || f.team2Id === team.id)) {
              total += 3; stats.finalsReached++;
              if (teamWon(f, team.id)) { total += 5; stats.finalsWon++; }
            }
          }
        }
      }
    }
  });
  total += calcStreak(attended);
  return { total: total, stats: stats, streak: calcStreak(attended), attended: attended.length };
}

// ─── SHEET WRITERS ────────────────────────────────────────────

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function updateLeaderboardSheet(state) {
  if (!state || !state.players) return;
  const sh = getSheet("Leaderboard");
  sh.clear();
  const players = state.players || [];
  const sessions = state.sessions || [];
  const rows = players.map(function(p) {
    const r = calcPlayerPoints(p.id, sessions);
    return { name: p.name, total: r.total, sessions: r.stats.sessions, wins: r.stats.wins, finalsWon: r.stats.finalsWon, streak: r.streak };
  }).filter(function(r) { return r.sessions > 0; })
    .sort(function(a, b) { return b.total - a.total; });

  // Header
  sh.getRange(1, 1, 1, 6).setValues([["Rank", "Player", "Pts", "Sessions", "Wins", "🏆"]])
    .setFontWeight("bold").setBackground("#0a0807").setFontColor("#fbbf24").setHorizontalAlignment("center");
  sh.setColumnWidth(1, 50); sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 70);
  sh.setColumnWidth(4, 80); sh.setColumnWidth(5, 70); sh.setColumnWidth(6, 50);

  rows.forEach(function(r, i) {
    const row = i + 2;
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
    const bg = i % 2 === 0 ? "#1c1917" : "#0c0a09";
    const fc = i === 0 ? "#fbbf24" : "#fafaf9";
    sh.getRange(row, 1).setValue(medal).setFontColor(fc).setBackground(bg).setHorizontalAlignment("center").setFontSize(14);
    sh.getRange(row, 2).setValue(r.name).setFontColor(fc).setBackground(bg).setFontWeight("bold");
    sh.getRange(row, 3).setValue(r.total).setFontColor("#f97316").setBackground(bg).setHorizontalAlignment("center").setFontWeight("bold").setFontSize(14);
    sh.getRange(row, 4).setValue(r.sessions).setFontColor("#a8a29e").setBackground(bg).setHorizontalAlignment("center");
    sh.getRange(row, 5).setValue(r.wins).setFontColor("#a8a29e").setBackground(bg).setHorizontalAlignment("center");
    sh.getRange(row, 6).setValue(r.finalsWon || "").setFontColor("#fbbf24").setBackground(bg).setHorizontalAlignment("center");
  });
  sh.getRange(1, 1, Math.max(rows.length + 1, 1), 6).setBorder(false, false, false, false, true, true, "#292524", SpreadsheetApp.BorderStyle.SOLID);
}

function updateSessionsSheet(state) {
  if (!state) return;
  const sh = getSheet("Sessions");
  sh.clear();
  const sessions = (state.sessions || []).slice().reverse();
  sh.getRange(1, 1, 1, 5).setValues([["Session", "Date", "Teams", "Matches", "Champion"]])
    .setFontWeight("bold").setBackground("#0a0807").setFontColor("#fbbf24").setHorizontalAlignment("center");
  sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 70);
  sh.setColumnWidth(4, 80); sh.setColumnWidth(5, 220);

  sessions.forEach(function(s, i) {
    const row = i + 2;
    const bg = i % 2 === 0 ? "#1c1917" : "#0c0a09";
    const matches = (s.groupMatches || []).filter(function(m) { return m.winner; }).length;
    let champ = "—";
    if (s.bracket && s.bracket.final && s.bracket.final.winner) {
      const f = s.bracket.final;
      const tid = f.winner === "team1" ? f.team1Id : f.team2Id;
      const t = (s.teams || []).filter(function(t) { return t.id === tid; })[0];
      if (t) {
        const p1 = (state.players || []).filter(function(p) { return p.id === t.p1Id; })[0];
        const p2 = (state.players || []).filter(function(p) { return p.id === t.p2Id; })[0];
        champ = "🏆 " + ((p1 && p1.name) || "?") + " & " + ((p2 && p2.name) || "?");
      }
    }
    sh.getRange(row, 1).setValue(s.name).setFontColor("#fafaf9").setBackground(bg).setFontWeight("bold");
    sh.getRange(row, 2).setValue(s.date || "").setFontColor("#a8a29e").setBackground(bg).setHorizontalAlignment("center");
    sh.getRange(row, 3).setValue((s.teams || []).length).setFontColor("#a8a29e").setBackground(bg).setHorizontalAlignment("center");
    sh.getRange(row, 4).setValue(matches).setFontColor("#a8a29e").setBackground(bg).setHorizontalAlignment("center");
    sh.getRange(row, 5).setValue(champ).setFontColor("#fbbf24").setBackground(bg);
  });
}

// ─── MENU ─────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi().createMenu("🔥 June Fury")
    .addItem("📊 Refresh Leaderboard", "refreshLB")
    .addItem("🔍 Data Summary", "dataSummary")
    .addItem("⚠️ Reset All Data", "resetAll")
    .addToUi();
}

function refreshLB() {
  const s = readState();
  if (!s) { SpreadsheetApp.getUi().alert("No data yet"); return; }
  updateLeaderboardSheet(s);
  updateSessionsSheet(s);
  SpreadsheetApp.getUi().alert("✅ Sheets refreshed!");
}

function dataSummary() {
  const s = readState();
  if (!s) { SpreadsheetApp.getUi().alert("No data yet"); return; }
  SpreadsheetApp.getUi().alert("🔥 June Fury\n\nSeason: " + (s.seasonName || "—") +
    "\nPlayers: " + (s.players || []).length +
    "\nSessions: " + (s.sessions || []).length +
    "\nLast updated: " + (s._lastUpdated ? new Date(s._lastUpdated).toLocaleString() : "—"));
}

function resetAll() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert("Reset everything?", "This will permanently delete all June Fury data.", ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().deleteProperty("STATE_JSON");
  try { getSheet("Leaderboard").clear(); } catch (e) {}
  try { getSheet("Sessions").clear(); } catch (e) {}
  ui.alert("Done — all data cleared.");
}
