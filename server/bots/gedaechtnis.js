'use strict';
// BOT-05 A4: kleines Gedaechtnis der drei Bot-Figuren (b0 Livia, b1 Cassius, b2 Titus; botId = Figur, nicht Platz). Action-Layer.
// Der Zustand liegt je Weltstand in game.weltstand.data.botFiguren = { b0: { gedaechtnis: [Eintrag] } } (Quelle der Wahrheit); ohne Weltstand (Szenario-Labor) passiert nichts.
//   merken(game, botId, { ereignis, text, gewicht?, mission? })   legt einen Eintrag an (text <= 120 Zeichen, Spielernamen entfernt); unbekannte botId oder kein Weltstand: nichts
//   lesen(game, botId)                                            Kopie der Eintraege, neueste zuletzt
//   toSave(game) / restore(game, block)                           Block crew.botFiguren des Weltstands (fehlt, solange kein Eintrag existiert)
// Ereignisquellen (alle deterministisch, ohne LLM; Eintraege gehen an jeden Bot auf einem Slot, zu seiner botId):
//   beiMissionEnde(game, id, titel, ausgang)   Gewicht 2, aus mission.js completeMission
//   beiBewusstlos(game, p)                     Gewicht 1, hoechstens einmal je Mission und Bot (combat.js, interior.js)
//   beiSystemAusfall(game, system)             Gewicht 1, entprellt (hoechstens einmal je SYSTEM_PAUSE_S Spielzeit; interior.js damageSystemRoh)
//   gespraech(game, botId)                     Haken fuer Paket B: nur „sprach mit dem Captain“, kein Inhalt
// Eintrag: { ereignis, text, spielzeit_s, mission?, gewicht? } (Form wie ws.npcMemory). Nie Namen von Menschen im Text.
const Crew = require('../sim/crew.js');

const BOT_IDS = ['b0', 'b1', 'b2'];
const TEXT_MAX = 120;
const SYSTEM_PAUSE_S = 120;
const laufzeit = new WeakMap();   // game -> { bewusstlos: Map(botId -> missionId), systemT: Zahl }

const cfg = (game) => (game && game.C && game.C.weltstand) || {};
const maxJe = (game) => Math.max(1, Number(cfg(game).botMemoryMax) || 12);
// nur ein gespeicherter Weltstand (persistent) hat ein Gedaechtnis; Szenario-Labor und Testlaeufe ohne Welt bleiben unberuehrt
const speicher = (game) => { const ws = game && game.weltstand; return ws && ws.persistent && ws.data ? ws.data : null; };
const spielzeit = (game) => { try { return Math.round(game.mission.playTime()); } catch (e) { return 0; } };
const lauf = (game) => { let l = laufzeit.get(game); if (!l) { l = { bewusstlos: new Map(), systemT: -Infinity }; laufzeit.set(game, l); } return l; };

// Menschennamen nie ins Gedaechtnis (auch nicht ueber Missions- oder Ortstexte): alle Spielernamen der Partie raus
function ohneNamen(game, text) {
  let s = String(text == null ? '' : text);
  const namen = (game.players || []).filter((p) => p && !p.bot && typeof p.name === 'string' && p.name.trim().length >= 2).map((p) => p.name.trim());
  for (const n of namen.sort((a, b) => b.length - a.length)) s = s.split(n).join('jemand');
  return s.replace(/\s+/g, ' ').trim();
}

function liste(game, botId, anlegen) {
  const d = speicher(game);
  if (!d || !BOT_IDS.includes(botId)) return null;
  if (!d.botFiguren) { if (!anlegen) return null; d.botFiguren = {}; }
  if (!d.botFiguren[botId]) { if (!anlegen) return null; d.botFiguren[botId] = { gedaechtnis: [] }; }
  return d.botFiguren[botId].gedaechtnis;
}

function verdraengen(l, max) {
  while (l.length > max) {   // kleinstes Gewicht fliegt, bei Gleichstand der aelteste (fehlendes Gewicht = 1, wie bei NSC)
    let idx = 0, w = Infinity;
    l.forEach((x, i) => { const g = Number.isFinite(x.gewicht) ? x.gewicht : 1; if (g < w) { w = g; idx = i; } });
    l.splice(idx, 1);
  }
}

function merken(game, botId, e) {
  const l = liste(game, botId, true);
  if (!l) return false;
  const x = e || {};
  const rec = { ereignis: String(x.ereignis || 'ereignis').slice(0, 40), text: ohneNamen(game, x.text).slice(0, TEXT_MAX), spielzeit_s: spielzeit(game) };
  const m = x.mission != null ? String(x.mission) : (game.mission && game.mission.activeId) || null;
  if (m) rec.mission = m.slice(0, 80);
  if (x.gewicht != null && Number.isFinite(Number(x.gewicht))) rec.gewicht = Number(x.gewicht);
  l.push(rec);
  verdraengen(l, maxJe(game));
  return true;
}

function lesen(game, botId) {
  const l = liste(game, botId, false);
  return l ? l.map((x) => Object.assign({}, x)) : [];
}

function toSave(game) {
  const d = speicher(game);
  if (!d || !d.botFiguren) return null;
  const out = {};
  for (const id of BOT_IDS) { const l = lesen(game, id); if (l.length) out[id] = { gedaechtnis: l }; }
  return Object.keys(out).length ? out : null;
}

function restore(game, block) {
  const d = speicher(game);
  if (!d) return;
  delete d.botFiguren;
  if (!block || typeof block !== 'object') return;
  for (const id of BOT_IDS) {
    const src = block[id] && Array.isArray(block[id].gedaechtnis) ? block[id].gedaechtnis : [];
    const l = [];
    for (const x of src) {
      if (!x || typeof x !== 'object' || typeof x.ereignis !== 'string') continue;
      const r = { ereignis: x.ereignis, text: typeof x.text === 'string' ? x.text.slice(0, TEXT_MAX) : '', spielzeit_s: Number.isFinite(x.spielzeit_s) ? x.spielzeit_s : 0 };
      if (typeof x.mission === 'string') r.mission = x.mission;
      if (Number.isFinite(x.gewicht)) r.gewicht = x.gewicht;
      l.push(r);
    }
    verdraengen(l, maxJe(game));
    if (l.length) { if (!d.botFiguren) d.botFiguren = {}; d.botFiguren[id] = { gedaechtnis: l }; }
  }
}

// ---------- Ereignisquellen ----------
const slotBots = (game) => (game.players || []).filter((p) => Crew.istBot(p) && BOT_IDS.includes(p.botId));
function ortName(game) {
  try { const L = require('../../shared/locations.js').get(game.explore.location); return L && L.name ? L.name : null; } catch (e) { return null; }
}

function beiMissionEnde(game, id, titel, ausgang) {
  if (!speicher(game)) return;
  const ort = ortName(game);
  const text = `Mission ${titel || id} beendet: ${ausgang || 'erfolg'}${ort ? ', bei ' + ort : ''}.`;
  for (const b of slotBots(game)) merken(game, b.botId, { ereignis: 'mission', text, gewicht: 2, mission: id });
}

function beiBewusstlos(game, p) {
  if (!p || !Crew.istBot(p) || !BOT_IDS.includes(p.botId) || !speicher(game)) return;
  const m = (game.mission && game.mission.activeId) || '-';
  const l = lauf(game);
  if (l.bewusstlos.get(p.botId) === m) return;
  l.bewusstlos.set(p.botId, m);
  merken(game, p.botId, { ereignis: 'bewusstlos', text: 'War bewusstlos und wurde wieder auf die Beine gebracht.', gewicht: 1 });
}

function beiSystemAusfall(game, system) {
  if (!speicher(game)) return;
  const t = spielzeit(game), l = lauf(game);
  if (t - l.systemT < SYSTEM_PAUSE_S) return;
  l.systemT = t;
  for (const b of slotBots(game)) merken(game, b.botId, { ereignis: 'schiffstreffer', text: `Das Schiff wurde schwer getroffen, System ${String(system).slice(0, 30)} fiel aus.`, gewicht: 1 });
}

// Haken fuer Paket B (Gespraech mit dem Captain): speichert nie den Inhalt
function gespraech(game, botId) {
  return merken(game, botId, { ereignis: 'gespraech', text: 'Sprach mit dem Captain.', gewicht: 1 });
}

module.exports = { BOT_IDS, TEXT_MAX, merken, lesen, toSave, restore, beiMissionEnde, beiBewusstlos, beiSystemAusfall, gespraech };
