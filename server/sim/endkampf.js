'use strict';
// EK6 (CONTRACT-EK5-6.md §8): Endkampf der Siedlung Eisenwald. Action-Layer des Bodenkampfs für diese Szene; die Szene selbst steht im
// Regiebuch (Umsetzung stellung_nehmen/flagge_hissen), die Haltemechanik des Feldzeichens in anker.js (Rolle flagge).
//   angriffStarten(game, { map, fraktion, tag, gegner?, boss? })  einmalig: `gegner` Angreifer und ein Anführer erscheinen verteilt um den
//                                  Flaggenpunkt (Angriff von allen Seiten), alle wach; sonst gibt es keinen dynamischen Spawn
//   bossBesiegt(game, map, tag)    Prüfung: der Anführer liegt (nicht mehr stehend) bzw. ist entfernt
//   gegnerAbziehen(game, map, tag?)  Sieg: alle Gegner (dieses tag bzw. alle) beamen raus, sie verschwinden aus der Karte
//   crewGefallen(game, map)        Prüfung: während des Angriffs wurde die Crew per Notrückholung abgezogen (combat.squadRecall)
// Der Anführer ist ein normaler Sturmgewehr-Gegner (Rolle niederhalter, CONFIG.awayCombat.gegner.niederhalter) mit dem generischen
// Gegner-Modifikator `anfuehrer` (+50 % Leben, +50 % Schaden, 25 % größer dargestellt): combat.modifikatorSetzen, keine Sonderfigur.
const Physics = require('../../shared/physics.js');
const W = require('../world.js');
const squad = require('./squad.js');

let combatMod = null, interiorMod = null;
const combat = () => combatMod || (combatMod = require('./combat.js'));
const interior = () => interiorMod || (interiorMod = require('./interior.js'));
const TILE = Physics.TILE;

function cfg(game) { return (game.C && game.C.awayCombat && game.C.awayCombat.endkampf) || { gegner: 10, boss: 1, abstandMin: 12, abstandMax: 32, rolle: 'niederhalter' }; }
function awVon(game, map) { return (game.aways && game.aways[map]) || null; }
const tileOf = (e) => Physics.toTile(e.x, e.y);

// Flaggenpunkt der Karte (Anker flagge), sonst die Mitte des Platzes dorfplatz
function flaggenPunkt(k) {
  const a = (k.anker || []).find((q) => q.rolle === 'flagge');
  if (a) return { x: a.x, y: a.y };
  const p = Object.values(k.plaetze || {}).find((q) => q.typ === 'dorfplatz');
  if (p) return { x: p.rect[0] + Math.floor(p.rect[2] / 2), y: p.rect[1] + Math.floor(p.rect[3] / 2) };
  return { x: Math.floor(k.w / 2), y: Math.floor(k.h / 2) };
}

// n Erscheinungspunkte, auf n Winkelsektoren um den Flaggenpunkt verteilt (Abstand abstandMin..abstandMax Kacheln), begehbar, nicht auf den
// Pads, mindestens 8 Kacheln von jedem Spieler. Reihenfolge und Wahl aus dem Zufall der Karte (aw.rng), also je Seed gleich.
function verteilteKacheln(game, aw, info, n, c0) {
  const C = cfg(game); const map = info.map;
  const pads = new Set((info.pads || []).map((q) => q.x + ',' + q.y));
  const spieler = game.players.filter((p) => p.zone === 'away').map(tileOf);
  const sektoren = Array.from({ length: n }, () => []);
  const alle = [];
  const base = aw.rng() * Math.PI * 2;
  // nur Kacheln, von denen aus man den Flaggenpunkt zu Fuß erreicht (geschlossene Türen sperren: wer in einem verschlossenen Haus erschiene, käme nie heraus)
  const erreichbar = new Set(); const warte = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!map.solid(c0.x + dx, c0.y + dy)) { erreichbar.add((c0.y + dy) * map.w + c0.x + dx); warte.push([c0.x + dx, c0.y + dy]); }
  while (warte.length) {
    const [x, y] = warte.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h || map.solid(nx, ny) || erreichbar.has(ny * map.w + nx)) continue;
      erreichbar.add(ny * map.w + nx); warte.push([nx, ny]);
    }
  }
  for (let y = 1; y < map.h - 1; y++) for (let x = 1; x < map.w - 1; x++) {
    if (map.solid(x, y) || pads.has(x + ',' + y) || !erreichbar.has(y * map.w + x)) continue;
    const d = Math.hypot(x - c0.x, y - c0.y);
    if (d < C.abstandMin || d > C.abstandMax) continue;
    if (spieler.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < 8)) continue;
    let w = Math.atan2(y - c0.y, x - c0.x) - base; w = ((w % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const i = Math.min(n - 1, Math.floor(w / (2 * Math.PI / n)));
    sektoren[i].push({ x, y, d }); alle.push({ x, y, d, i });
  }
  const out = [];
  const benutzt = new Set();
  for (let i = 0; i < n; i++) {
    let liste = sektoren[i].filter((t) => !benutzt.has(t.x + ',' + t.y));
    if (!liste.length) {   // leerer Sektor (Gebäude, Rand): nächster Sektor mit Platz, gleiche Reihenfolge
      for (let o = 1; o < n && !liste.length; o++) liste = sektoren[(i + o) % n].filter((t) => !benutzt.has(t.x + ',' + t.y));
    }
    if (!liste.length) continue;
    const t = liste[Math.floor(aw.rng() * liste.length)];
    benutzt.add(t.x + ',' + t.y); out.push({ x: t.x, y: t.y });
  }
  return out;
}

// Rollen der Angreifer: Grundtyp, dazu je eine Rolle, die die Crew schon kennt (Einführungsregel: nie eine ungesehene Rolle außer dem Anführer)
function rollenFuer(game, anzahl) {
  const C = combat();
  const gesehen = new Set(['grundtyp']);
  try { const ws = game.weltstand; for (const r of (ws && ws.rollenGesehen ? ws.rollenGesehen() : (ws && ws.data && ws.data.rollen_gesehen) || [])) gesehen.add(r); } catch (e) { /* ohne Weltstand: nur Grundtyp */ }
  const mix = ['niederhalter', 'schuetze', 'grenadier', 'enterer'].filter((r) => gesehen.has(r));
  const out = [];
  for (let i = 0; i < anzahl; i++) out.push(i >= 1 && i <= mix.length ? mix[i - 1] : 'grundtyp');
  return out;
}

function angriffStarten(game, opts) {
  const o = opts || {}; const map = o.map;
  let aw = awVon(game, map);
  if ((!aw || !W.AWAY_MAPS[map]) && map) {
    try { const L = require('./landepunkte.js'); if (L && typeof L.bereit === 'function' && L.bereit(game, map)) aw = awVon(game, map); } catch (e) { /* ohne Landepunkte */ }
  }
  if (!aw || !W.AWAY_MAPS[map]) { if (game.countError) game.countError('endkampf', new Error('Karte ' + map + ' unbekannt')); return 0; }
  const cb = combat();
  cb.ensureV2(game, aw, map);
  if (aw.endkampf && aw.endkampf.phase === 'angriff') return 0;   // einmalig je Aufbau der Karte
  const K = cb.katalogDaten(game);
  const f = (K.fraktionen || {})[o.fraktion];
  if (!f) { if (game.countError) game.countError('endkampf', new Error('Fraktion ' + o.fraktion + ' unbekannt')); return 0; }
  const C = cfg(game);
  const anzahl = Math.max(0, Math.round(o.gegner != null ? o.gegner : C.gegner));
  const bosse = Math.max(0, Math.round(o.boss != null ? o.boss : C.boss));
  const info = interior().awayInfoOf(map);
  const karte = info.karte; if (!karte) return 0;
  const c0 = flaggenPunkt(karte);
  const plaetze = verteilteKacheln(game, aw, info, anzahl + bosse, c0);
  const tag = String(o.tag || 'endkampf');
  const rollen = rollenFuer(game, anzahl);
  const bossAt = bosse ? Math.floor(aw.rng() * plaetze.length) : -1;   // der Anführer steht an einer zufälligen Stelle des Rings
  let gesamt = 0, bossId = null, k = 0;
  plaetze.forEach((t, i) => {
    const istBoss = i === bossAt;
    const rolle = istBoss ? C.rolle : (rollen[k++] || 'grundtyp');
    const name = tag + (istBoss ? '.boss' : '.' + (i + 1));
    const m = squad.spawnSquad(game, name, { map, besetzung: [{ typ: rolle, anzahl: 1 }], force: true, alert: true, plaetze: [t], festeZahl: true });
    gesamt += m ? 1 : 0;
    const s = aw.squads[name];
    if (s) { s.tag = tag; s.fraktion = f.id; s.endkampf = true; }
    for (const e of aw.drones) if (e.squad === name) {
      e.tag = tag; e.fraktion = f.id; if (f.palette) e.palette = f.palette; cb.kaempfer(game, e);
      if (istBoss) { e.boss = true; bossId = e.id; cb.modifikatorSetzen(game, e, 'anfuehrer'); }
    }
  });
  aw.endkampf = { tag, phase: 'angriff', boss: bossId, t0: game.time, n: gesamt, verloren: false };
  aw.besetzt = aw.besetzt || {};
  aw.besetzt[tag] = { fraktion: f.id, staerke: null, haltung: 'wach', ersetzt: [], rezepte: ['endkampf'] };
  game.missionEvent('squadSpawn', { map, tag, n: gesamt });
  game.missionEvent('endkampfAngriff', { map, tag, n: gesamt, boss: bossId });
  return gesamt;
}

// Anführer besiegt: er steht nicht mehr (liegt, bewusstlos, gefesselt, aus) oder wurde entfernt. Ohne Angriff: false.
function bossBesiegt(game, map, tag) {
  const aw = awVon(game, map);
  const ek = aw && aw.endkampf;
  if (!ek || ek.phase !== 'angriff' || (tag && ek.tag !== tag) || !ek.boss) return false;
  const e = (aw.drones || []).find((d) => d.id === ek.boss);
  return !e || !e.alive;
}
function crewGefallen(game, map) {
  const aw = awVon(game, map);
  return !!(aw && aw.endkampf && aw.endkampf.verloren);
}
// Sieg: alle Gegner (tag, sonst alle der Karte) beamen raus
function gegnerAbziehen(game, map, tag) {
  const aw = awVon(game, map); if (!aw) return 0;
  const liste = (aw.drones || []).filter((e) => !tag || e.tag === tag);
  const ids = liste.map((e) => e.id);
  for (const e of liste) game.emit('sfx', { name: 'beam', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) });
  if (liste.length) game.emit('gegnerBeamt', { map, ids, n: ids.length });
  aw.drones = (aw.drones || []).filter((e) => !ids.includes(e.id));
  for (const s of Object.values(aw.squads || {})) if (s && (!tag || s.tag === tag)) delete aw.squads[s.name];
  if (aw.endkampf) aw.endkampf.phase = 'sieg';
  game.missionEvent('gegnerAbgezogen', { map, n: ids.length });
  return ids.length;
}

module.exports = { angriffStarten, bossBesiegt, crewGefallen, gegnerAbziehen, flaggenPunkt, verteilteKacheln, rollenFuer };
