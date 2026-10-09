'use strict';
// B1 §7/§8 (Team ENTERN): kampfunfähiges Feindschiff betreten + treibende Wracks (Entscheidung 8, keine volle Enterregel).
//
// Ablauf:
//   - Ein Gegner mit e.entern === true oder mit einem Tag, den der Baustein entern_ziel markiert hat (markieren()),
//     wird bei Hülle 0 nicht gelöscht: onEnemyZero -> true. Er bekommt st = 'treibt' und wandert aus space.enemies in
//     space.treibend. Grund: In space.enemies würde er weiter feuern/fliegen und alle Zählstellen des Raumkampfs
//     verfälschen (enemiesCleared, Störsender-Sprungsperre, Alarmstufe Rot, Hüllen-Regeneration, Auto-Zielwahl der
//     Taktik, Geschosskollision). So bleibt der Raumkampf unverändert; der Snapshot hängt treibende Schiffe mit
//     st: 'treibt' an space.enemies an (ENGINE: sp.enemies.concat(Entern.treibende(game)), dazu o.st = e.st).
//   - Buchhaltung wie ein Abschuss (Marken, stats.kills, enemyKilled), damit Bücher und Belohnung gleich bleiben.
//   - Prise: Landepunkt <ort>.prise (Schiff, germanen, Besitz = Fraktion des Gegners, Seed aus der Gegner-ID, umkaempft),
//     angelegt über landepunkte.prise(game, ort, gegner) (BUEHNE). Transfer frei bis CONFIG.entern.transferRange.
//   - Verlässt die Lerche den Ort (und ist niemand mehr unten auf der Prise), verfällt die Prise. Mit merken bleibt sie
//     als treibendes Wrack (Zustand verfallen) in welt.wracks.
//   - Feste Wracks aus landepunkte.json mit frei: nach_raumgefecht werden nach dem ersten Abschuss am Ort frei
//     (welt.wracks, quelle 'daten').
//   - Nie im Tutorial (aktive Mission mit kopf.tutorial bzw. m1–m3): dann bleibt alles wie bisher.
//
// Schnittstellen: onEnemyZero, update (Tick, nach space.update), markieren, merken, treibende, transferFrei, beamPunkt,
// frei, verfallen, toSave, restore.
const fs = require('fs');
const path = require('path');

const TUTORIAL_MISSIONS = ['m1', 'm2', 'm3'];
const ZUSTAND_TREIBT = 'treibt';
// Fraktion je Raumgegner, wenn weder Gegner noch Markierung eine nennen (Raider/Kanonenboot = Rostmeute, §19)
const FRAKTION_STANDARD = { raider: 'rostmeute', gunboat: 'rostmeute', sentinel: 'kustoden', pylon: 'kustoden', relay: 'rostmeute' };
const DEFAULTS = { aktiv: true, transferRange: 300, driftMax: 6, driftDaempfung: 0.15, drehMin: 0.04, drehMax: 0.12 };

function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function cfg(game) { return Object.assign({}, DEFAULTS, (game && game.C && game.C.entern) || {}); }
function err(game, where, e) { if (game && typeof game.countError === 'function') game.countError(where, e); }

// Landepunkte (BUEHNE) defensiv: fehlt das Modul oder die Funktion, läuft entern ohne diesen Teil weiter
let lpMod;
function landepunkte() {
  if (lpMod === undefined) {
    try { lpMod = require('./landepunkte.js'); } catch (e) {
      if (!(e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes('landepunkte.js'))) console.warn('[Pantheon] entern: landepunkte.js:', e && e.message);
      lpMod = null;
    }
  }
  return lpMod;
}
function lpFn(name) { const L = landepunkte(); return L && !L.stub && typeof L[name] === 'function' ? L[name] : null; }

// Feste Landepunkte mit frei: nach_raumgefecht (content/welt/landepunkte.json, BUEHNE); einmal je Prozess gelesen
let datenWracks;
function wracksAusDaten() {
  if (datenWracks) return datenWracks;
  datenWracks = {};
  try {
    const f = path.join(__dirname, '..', '..', 'content', 'welt', 'landepunkte.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [ort, list] of Object.entries((d && d.orte) || {})) {
      for (const lp of Array.isArray(list) ? list : []) if (lp && lp.id && lp.frei === 'nach_raumgefecht' && !lp.gesperrt) (datenWracks[ort] = datenWracks[ort] || []).push(lp.id);
    }
  } catch (e) { /* Datei fehlt noch oder ist kaputt: keine Daten-Wracks */ }
  return datenWracks;
}

// ---------- Laufzeitzustand ----------
// game.entern = { tags: { <tag>: { merken, fraktion } }, prisen: { <lpId>: Prise }, wracks: [{ lpId, ort, quelle }] }
// game.space.treibend = [Gegner mit st 'treibt']
// game.reset() legt game.space neu an, kennt game.entern aber nicht: neuer Raum = neue Partie = frischer Zustand.
function state(game) {
  if (!game.entern || typeof game.entern !== 'object' || game.entern.space !== game.space) game.entern = { space: game.space, tags: {}, prisen: {}, wracks: [] };
  const s = game.entern;
  if (!s.tags) s.tags = {};
  if (!s.prisen) s.prisen = {};
  if (!Array.isArray(s.wracks)) s.wracks = [];
  return s;
}
function treibListe(game) {
  const sp = game.space;
  if (!sp) return [];
  if (!Array.isArray(sp.treibend)) sp.treibend = [];
  return sp.treibend;
}

function tutorialAktiv(game) {
  const m = game.mission;
  const id = m && m.activeId;
  if (!id) return false;
  if (TUTORIAL_MISSIONS.includes(id)) return true;
  try { const inf = typeof m.info === 'function' ? m.info(id) : null; return !!(inf && inf.tutorial); } catch (e) { return false; }
}
function aktiv(game) { return cfg(game).aktiv !== false && !tutorialAktiv(game); }
function markierung(game, e) { return e && e.tag != null ? state(game).tags[e.tag] || null : null; }
function istZiel(game, e) { return !!(e && (e.entern === true || markierung(game, e))); }

// ---------- Baustein entern_ziel (ENGINE ruft) ----------
// markieren(game, tag, { merken?, fraktion? }): Gegner mit diesem Tag (jetzt und später gespawnt) werden zu Enterzielen.
function markieren(game, tag, opts) {
  if (tag == null || tag === '') return 'Kein Tag für entern_ziel.';
  if (tutorialAktiv(game)) return 'Entern ist im Tutorial aus.';
  const o = opts || {};
  state(game).tags[String(tag)] = { merken: !!o.merken, fraktion: o.fraktion || null };
  for (const e of (game.space && game.space.enemies) || []) if (e.tag === tag) e.entern = true;
  return null;
}
// merken(game, lpIdOderTag?): das Buch behält die Prise als Wrack. Ohne Argument alle offenen Prisen am Ort.
function merken(game, ziel) {
  const s = state(game);
  let n = 0;
  if (ziel != null && s.tags[ziel]) { s.tags[ziel].merken = true; n++; }
  for (const p of Object.values(s.prisen)) {
    if (ziel == null || p.lpId === ziel || p.tag === ziel) { p.merken = true; n++; }
  }
  return n;
}

// ---------- Hülle 0 (space.damageEnemy) ----------
function onEnemyZero(game, e) {
  if (!e) return false;
  if (e.st === ZUSTAND_TREIBT) return true;   // schon kampfunfähig (sollte nicht mehr in space.enemies liegen)
  if (!aktiv(game)) return false;
  try { wrackFreiNachGefecht(game); } catch (x) { err(game, 'entern-datenwrack', x); }
  if (!istZiel(game, e)) return false;
  if (priseBelegt(game, ortVon(game))) return false;   // je Ort höchstens eine Prise (landepunkte: <ort>.prise)
  try { return treiben(game, e); } catch (x) { err(game, 'entern', x); return false; }
}

function ortVon(game) { return (game.ship && game.ship.scene) || null; }
// <ort>.prise ist schon vergeben: offene Prise oder gemerktes Wrack mit derselben ID (würde sonst überschrieben)
function priseBelegt(game, ort) {
  const id = `${ort}.prise`; const s = state(game);
  return !!s.prisen[id] || s.wracks.some((w) => w.lpId === id);
}

function treiben(game, e) {
  const C = game.C || {}; const K = cfg(game); const sp = game.space;
  const mk = markierung(game, e) || {};
  e.st = ZUSTAND_TREIBT;
  e.hp = 0;
  e.entern = true;
  e.tele = null; e.targetId = null; e.fireT = 0; e.retreatUntil = 0; e.leaving = false;
  if (e.shields) e.shields = e.shields.map(() => 0);
  // Drift: Restschwung, gedämpft auf höchstens driftMax; Drehrichtung und -tempo aus der ID (deterministisch)
  const h = hashStr(e.id);
  const v = Math.hypot(e.vx || 0, e.vy || 0);
  const k = v > K.driftMax ? K.driftMax / v : 1;
  e.vx = (e.vx || 0) * k; e.vy = (e.vy || 0) * k;
  e.spin = (h & 1 ? 1 : -1) * (K.drehMin + ((h >>> 1) % 1000) / 1000 * (K.drehMax - K.drehMin));
  sp.enemies = sp.enemies.filter((o) => o !== e);
  treibListe(game).push(e);
  // Buchhaltung wie ein Abschuss (space.damageEnemy macht das nach onEnemyZero nicht mehr)
  const ec = (C.enemies || {})[e.kind] || {};
  if (game.inventory) game.inventory.marks += ec.salvage || 0;
  if (game.stats) game.stats.kills = (game.stats.kills || 0) + 1;
  if (game.ship && game.ship.target === e.id) game.ship.target = null;
  if (typeof game.emit === 'function') {
    game.emit('sfx', { name: 'explosion_small' });
    game.emit('enternFrei', { id: e.id });
  }
  if (typeof game.missionEvent === 'function') game.missionEvent('enemyKilled', { enemy: e, treibt: true });
  prise(game, e, mk);
  return true;
}

function prise(game, e, mk) {
  const K = cfg(game); const s = state(game);
  const ort = ortVon(game);
  const lpId = `${ort}.prise`;
  const besitz = e.fraktion || mk.fraktion || FRAKTION_STANDARD[e.kind] || 'rostmeute';
  const p = {
    lpId, ort, gegnerId: e.id, kind: e.kind, tag: e.tag || null,
    // Seed wie landepunkte.prise: FNV-1a der Gegner-ID % 100000 + 1
    art: 'schiff', bauweise: 'germanen', besitz, zustand: 'umkaempft', seed: (hashStr(e.id) % 100000) + 1,
    merken: !!(mk.merken || e.merken), seit: game.time || 0,
    beam: { x: Math.round(e.x), y: Math.round(e.y), range: K.transferRange },
  };
  s.prisen[lpId] = p;
  const fn = lpFn('prise');
  if (fn) {
    try {
      const r = fn(game, ort, { id: e.id, kind: e.kind, fraktion: besitz, lpId, art: p.art, bauweise: p.bauweise, besitz,
        zustand: p.zustand, seed: p.seed, beam: p.beam, x: e.x, y: e.y });
      const id = typeof r === 'string' ? r : (r && r.id) || null;
      if (id && id !== lpId) { delete s.prisen[lpId]; p.lpId = id; s.prisen[id] = p; }
    } catch (x) { err(game, 'entern-prise', x); }
  }
  return p;
}

// ---------- Tick (ENGINE ruft nach space.update) ----------
function update(game, dt) {
  const list = (game.space && game.space.treibend) || [];
  const K = cfg(game);
  if (list.length) {
    const sp = game.space;
    const damp = Math.max(0, 1 - K.driftDaempfung * dt);
    for (const e of list) {
      e.angle = (e.angle || 0) + (e.spin || 0) * dt;
      if (e.angle > Math.PI) e.angle -= 2 * Math.PI; else if (e.angle < -Math.PI) e.angle += 2 * Math.PI;
      e.vx = (e.vx || 0) * damp; e.vy = (e.vy || 0) * damp;
      e.x = Math.max(60, Math.min((sp.w || 4000) - 60, e.x + e.vx * dt));
      e.y = Math.max(60, Math.min((sp.h || 4000) - 60, e.y + e.vy * dt));
    }
  }
  const s = game.entern;
  if (!s || s.space !== game.space || !s.prisen) return;
  for (const p of Object.values(s.prisen)) {
    const e = list.find((o) => o.id === p.gegnerId);
    if (e) { p.beam.x = Math.round(e.x); p.beam.y = Math.round(e.y); }
    if (verlassen(game, p)) verfallen(game, p.lpId);
  }
}
// Szene verlassen = die Lerche ist nicht mehr am Ort der Prise und niemand ist mehr unten auf ihr
function verlassen(game, p) {
  if (!game.ship || game.ship.scene === p.ort) return false;
  const unten = (game.players || []).some((q) => q.zone === 'away' && (!game.away || game.away.map === p.lpId));
  return !unten;
}

// Prise verfällt (Szene verlassen oder ENGINE am Missionsende). Mit merken -> Wrack (verfallen) in welt.wracks.
function verfallen(game, lpId) {
  const s = state(game);
  const p = s.prisen[lpId];
  if (!p) return false;
  delete s.prisen[lpId];
  if (game.space && Array.isArray(game.space.treibend)) game.space.treibend = game.space.treibend.filter((e) => e.id !== p.gegnerId);
  // landepunkte.priseVerlassen(game, ort, merken): merken -> neues Wrack '<ort>.wrack-<n>' (verfallen), Rückgabe = neue ID;
  // sonst Landepunkt weg. Ohne landepunkte.js (oder ohne Rückgabe) bleibt die Prise-ID das Wrack.
  let wrackId = p.lpId;
  const fn = lpFn('priseVerlassen');
  if (fn) {
    try { const r = fn(game, p.ort, !!p.merken); if (typeof r === 'string' && r) wrackId = r; }
    catch (x) { err(game, 'entern-verlassen', x); }
  }
  if (p.merken) wrackDazu(game, { lpId: wrackId, ort: p.ort, quelle: 'entern' });
  return true;
}

function wrackDazu(game, w) {
  const s = state(game);
  if (s.wracks.some((o) => o.lpId === w.lpId)) return false;
  s.wracks.push({ lpId: w.lpId, ort: w.ort == null ? null : w.ort, quelle: w.quelle === 'daten' ? 'daten' : 'entern' });
  return true;
}
// landepunkte.freigeben(game, lpId): Landepunkt mit frei 'nach_raumgefecht' wählbar machen
function lpFreigeben(game, lpId) {
  const fn = lpFn('freigeben');
  if (fn) { try { fn(game, lpId); } catch (x) { err(game, 'entern-freigeben', x); } }
}
function wrackFreiNachGefecht(game) {
  const ort = ortVon(game);
  for (const id of wracksAusDaten()[ort] || []) if (wrackDazu(game, { lpId: id, ort, quelle: 'daten' })) lpFreigeben(game, id);
}

// ---------- Abfragen (Snapshot ENGINE, Transfer BUEHNE/BODENKAMPF) ----------
function treibende(game) { return (game.space && game.space.treibend) || []; }
function snapExtra(e) { return e && e.st ? { st: e.st } : null; }
function istPrise(game, lpId) { return !!state(game).prisen[lpId]; }
// Transferpunkt der Prise (folgt dem treibenden Schiff) oder null
function beamPunkt(game, lpId) {
  const p = istPrise(game, lpId) ? game.entern.prisen[lpId] : null;
  return p ? { x: p.beam.x, y: p.beam.y, range: p.beam.range, map: p.lpId } : null;
}
// -> null (frei) | Fehlertext
function transferFrei(game, lpId) {
  const b = beamPunkt(game, lpId);
  if (!b) return 'Keine Prise.';
  const p = game.entern.prisen[lpId];
  if (!game.ship || game.ship.scene !== p.ort) return 'Die Prise treibt an einem anderen Ort.';
  const d = Math.hypot(game.ship.x - b.x, game.ship.y - b.y);
  if (d > b.range) return `Zu weit von der Prise (${Math.round(d)}, max. ${b.range}).`;
  return null;
}
// Landepunkt mit frei: nach_raumgefecht bzw. Prise/Wrack aus welt.wracks verfügbar?
function frei(game, lpId) { return istPrise(game, lpId) || state(game).wracks.some((w) => w.lpId === lpId); }

// ---------- Weltstand welt.wracks (CONTRACT-B1 §8) ----------
function toSave(game) { return state(game).wracks.map((w) => ({ lpId: w.lpId, ort: w.ort == null ? null : w.ort, quelle: w.quelle })); }
function restore(block, game) {
  const s = state(game);
  s.wracks = [];
  s.prisen = {};   // offene Prisen überleben das Laden nicht (sie verfallen beim Verlassen der Szene)
  if (game.space) game.space.treibend = [];
  for (const w of Array.isArray(block) ? block : []) if (w && typeof w.lpId === 'string' && w.lpId) wrackDazu(game, w);
  // Daten-Wracks bleiben frei, auch wenn welt.landepunkte den Eintrag (noch) nicht trägt (Laden: landepunkte vor wracks)
  for (const w of s.wracks) if (w.quelle === 'daten') lpFreigeben(game, w.lpId);
}

module.exports = {
  onEnemyZero, update, markieren, merken, verfallen, treibende, snapExtra, istPrise, beamPunkt, transferFrei, frei,
  toSave, restore, aktiv, ZUSTAND_TREIBT,
};
