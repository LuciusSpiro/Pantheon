'use strict';
// B1 §7/§8 (Team ENTERN): kampfunfähiges Feindschiff, Prise, treibende Wracks, Weltstand welt.wracks.
//   node tools/test-entern.js            -> alle Abschnitte
//   node tools/test-entern.js transfer   -> nur Abschnitte, deren Name einen der Begriffe enthält
// Echt gegen ein Testspiel (Lobby-Start arena_space, ohne Server und ohne Wellen).
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');

// landepunkte.js (BUEHNE) entsteht parallel: fehlt die Datei, prüft ein Ersatz die Aufrufe von entern.js.
const LP_PATH = path.join(__dirname, '..', 'server', 'sim', 'landepunkte.js');
const LP_ECHT = fs.existsSync(LP_PATH);
const lpCalls = [];
if (!LP_ECHT) {
  const Module = require('module');
  const m = new Module(LP_PATH); m.filename = LP_PATH; m.loaded = true;
  m.exports = {
    prise(game, ort, gegner) { lpCalls.push(['prise', ort, gegner]); return `${ort}.prise`; },
    priseVerlassen(game, ort, merken) { lpCalls.push(['priseVerlassen', ort, merken]); return merken ? `${ort}.wrack-1` : null; },
    freigeben(game, lpId) { lpCalls.push(['freigeben', lpId]); return true; },
  };
  require.cache[LP_PATH] = m;
}

const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Entern = require('../server/sim/entern.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);

function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | ')); }
}

// Testgelände ohne Wellen, Lerche in der Mitte, unverwundbar, Waffen leer
function arena(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 31, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'EN0', name: 'EN0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0; sh.speed = 0;
  g.god = true;
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind }, data)); return emit0(kind, data); };
  // Tick wie ENGINE es einbinden soll: nach space.update -> Entern.update (bis ENGINE den Hook setzt, ruft der Test)
  const tick = () => { g.step(); Entern.update(g, DT); };
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) tick(); };
  const noWeapons = () => { for (const k of ['bow', 'port', 'stbd']) if (g.ship.mount[k]) { g.ship.mount[k].charge = 0; g.ship.mount[k].salvo = 0; } };
  return { g, c, run, tick, noWeapons, events, ev: (k) => events.filter((e) => e.kind === k) };
}
function spawn(g, opts) {
  const sh = g.ship;
  return space.spawnEnemy(g, 'raider', Object.assign({ x: sh.x + 250, y: sh.y, facing: Math.PI }, opts || {}));
}
const kill = (g, e) => space.damageEnemy(g, e, 9999);

section('Hülle 0 ohne entern: Gegner wird wie bisher entfernt', () => {
  const { g, ev } = arena();
  const e = spawn(g);
  const kills0 = g.stats.kills; const marks0 = g.inventory.marks;
  kill(g, e);
  ok(!g.space.enemies.includes(e), 'nicht mehr in space.enemies');
  ok(!(g.space.treibend || []).includes(e), 'nicht in space.treibend');
  ok(e.st == null, 'kein Zustand treibt');
  ok(g.stats.kills === kills0 + 1 && g.inventory.marks === marks0 + CONFIG.enemies.raider.salvage, 'Abschuss und Marken wie bisher');
  ok(ev('explosion').length === 1 && ev('enternFrei').length === 0, 'Explosion, kein enternFrei');
  ok(Object.keys(g.entern ? g.entern.prisen : {}).length === 0, 'keine Prise');
});

section('Hülle 0 mit entern: Schiff treibt, feuert nicht, dreht langsam, Prise (§7)', () => {
  const { g, tick, ev, noWeapons } = arena();
  const e = spawn(g, { tag: 'beute' });
  e.entern = true;
  const kills0 = g.stats.kills; const marks0 = g.inventory.marks;
  kill(g, e);
  ok(e.st === 'treibt' && e.hp === 0, 'Zustand treibt, Hülle 0');
  ok(!g.space.enemies.includes(e) && Entern.treibende(g).includes(e), 'aus space.enemies in space.treibend (Raumkampf zählt ihn nicht mehr)');
  ok(g.stats.kills === kills0 + 1 && g.inventory.marks === marks0 + CONFIG.enemies.raider.salvage, 'Buchhaltung wie ein Abschuss');
  ok(ev('enternFrei').length === 1 && ev('enternFrei')[0].id === e.id, 'Ereignis enternFrei { id }');
  ok(ev('explosion').length === 0, 'keine Explosion (Schiff bleibt)');
  const lpId = g.ship.scene + '.prise';
  const p = g.entern.prisen[lpId];
  ok(!!p, `Prise ${lpId} angelegt`);
  ok(p && p.art === 'schiff' && p.bauweise === 'germanen' && p.besitz === 'rostmeute' && p.zustand === 'umkaempft', 'Prise: schiff, germanen, Besitz = Fraktion (Raider -> rostmeute), umkaempft');
  // Seed aus der Gegner-ID: gleiche ID -> gleicher Seed
  const { g: g2 } = arena(); const e2 = spawn(g2); e2.entern = true; kill(g2, e2);
  ok(e2.id === e.id && g2.entern.prisen[lpId].seed === p.seed, 'Seed aus der Gegner-ID (deterministisch)');
  if (!LP_ECHT) {
    const call = lpCalls.find((x) => x[0] === 'prise' && x[2].id === e.id);
    ok(!!call && call[1] === g.ship.scene && call[2].art === 'schiff' && call[2].besitz === 'rostmeute' && call[2].seed === p.seed,
      'landepunkte.prise(game, ort, gegner) mit Art/Besitz/Seed aufgerufen (Ersatzmodul)');
  } else {
    const L = require('../server/sim/landepunkte.js');
    const r = (L.liste(g, g.ship.scene) || []).find((x) => x.id === lpId);
    ok(!!r && r.art === 'schiff' && r.bauweise === 'germanen' && r.besitz === 'rostmeute' && r.zustand === 'umkaempft' && r.frei,
      'landepunkte.liste zeigt die Prise (schiff, germanen, rostmeute, umkaempft, frei)');
    ok(r && r.beam && r.beam.range === CONFIG.entern.transferRange, 'Prise-Transferpunkt mit entern.transferRange');
    let werr = 'x'; const err0 = g.errors;
    try { werr = L.waehlen(g, lpId, g.players[0]); } catch (x) { werr = String(x); }
    ok(werr === null && !!g.aways[lpId] && g.errors === err0, 'Prise echt gebaut (landepunkte.waehlen -> Schiffskarte, ' + (werr || 'ok') + ')');
  }
  const proj0 = g.space.projectiles.length;
  noWeapons();
  let dreh = 0; let a = e.angle;
  for (let k = 0; k < Math.round(10 / DT); k++) { tick(); let d = e.angle - a; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; dreh += d; a = e.angle; }
  dreh = Math.abs(dreh);
  ok(dreh > 0.2 && dreh < 2, `dreht langsam (${dreh.toFixed(2)} rad in 10 s)`);
  ok(!g.space.projectiles.some((q) => q.owner === e.id) && g.space.projectiles.length <= proj0, 'feuert nicht');
  ok(Math.hypot(e.vx, e.vy) <= (CONFIG.entern.driftMax || 6) + 1e-9, 'treibt höchstens mit driftMax');
  ok(g.ship.target !== e.id, 'nicht mehr als Ziel gewählt');
  // nochmal Schaden auf das treibende Schiff -> bleibt (onEnemyZero true)
  ok(Entern.onEnemyZero(g, e) === true, 'onEnemyZero auf treibendem Schiff -> true');
  // Snapshot (ENGINE trägt st ein: sp.enemies.concat(Entern.treibende(game)) + o.st)
  const snap = g.snapshot ? g.snapshot() : null;
  const se = snap && snap.space && (snap.space.enemies || []).find((x) => x.id === e.id);
  if (se && se.st === 'treibt') ok(true, 'Snapshot space.enemies[].st = treibt');
  else info('Snapshot zeigt das treibende Schiff noch nicht (Wunsch an ENGINE)');
});

section('Baustein entern_ziel: markieren per Tag, auch für spätere Spawns', () => {
  const { g } = arena();
  const a = spawn(g, { tag: 'ziel' });
  ok(Entern.markieren(g, 'ziel', { merken: true }) === null, 'markieren ok');
  ok(a.entern === true, 'bestehender Gegner mit Tag markiert');
  const b = spawn(g, { tag: 'ziel', y: g.ship.y + 200 });
  const c = spawn(g, { tag: 'anders', y: g.ship.y - 200 });
  kill(g, b); kill(g, c);
  ok(b.st === 'treibt', 'später gespawnter Gegner mit Tag treibt');
  ok(c.st == null && !g.space.enemies.includes(c), 'anderer Tag wird entfernt');
  ok(Object.values(g.entern.prisen).some((p) => p.gegnerId === b.id && p.merken === true), 'merken aus der Markierung');
  kill(g, a);
  const ids = Object.keys(g.entern.prisen);
  ok(ids.length === 1 && ids[0] === g.ship.scene + '.prise' && a.st == null && !g.space.enemies.includes(a),
    'je Ort höchstens eine Prise: zweites Enterziel wird normal zerstört');
  ok(Entern.markieren(g, '') !== null, 'ohne Tag -> Fehlertext');
});

section('Tutorial: nie entern', () => {
  const { g } = arena();
  const e = spawn(g); e.entern = true;
  const act0 = g.mission.activeId;
  g.mission.activeId = 'm2';
  ok(Entern.markieren(g, 'x') !== null, 'markieren im Tutorial abgelehnt');
  kill(g, e);
  g.mission.activeId = act0;
  ok(e.st == null && !g.space.enemies.includes(e) && !Entern.treibende(g).length, 'Gegner im Tutorial wie bisher entfernt');
  ok(!Object.keys(g.entern ? g.entern.prisen : {}).length, 'keine Prise');
});

section('Transferreichweite (CONFIG.entern.transferRange)', () => {
  const { g } = arena();
  const e = spawn(g); e.entern = true; kill(g, e);
  const lpId = g.ship.scene + '.prise';
  const R = CONFIG.entern.transferRange;
  const b = Entern.beamPunkt(g, lpId);
  ok(!!b && b.range === R && b.map === lpId, `Transferpunkt der Prise, Reichweite ${R}`);
  g.ship.x = b.x - (R - 1); g.ship.y = b.y;
  ok(Entern.transferFrei(g, lpId) === null, `frei bei ${R - 1}`);
  g.ship.x = b.x - R; ok(Entern.transferFrei(g, lpId) === null, `frei bei genau ${R}`);
  g.ship.x = b.x - (R + 1);
  ok(typeof Entern.transferFrei(g, lpId) === 'string', `gesperrt bei ${R + 1}`);
  ok(typeof Entern.transferFrei(g, 'gibtsnicht.prise') === 'string', 'unbekannte Prise -> Fehlertext');
  ok(Entern.frei(g, lpId) === true && Entern.frei(g, 'gibtsnicht.prise') === false, 'frei(lpId)');
  // Transferpunkt folgt dem treibenden Schiff
  e.vx = 10; e.vy = 0; const x0 = e.x;
  Entern.update(g, 1);
  ok(Entern.beamPunkt(g, lpId).x === Math.round(e.x) && e.x > x0, 'Transferpunkt folgt der Drift');
});

section('Verfall beim Verlassen der Szene bzw. merken', () => {
  {
    const { g } = arena();
    const ort = g.ship.scene;
    const e = spawn(g); e.entern = true; kill(g, e);
    const lpId = ort + '.prise';
    Entern.update(g, DT);
    ok(Entern.istPrise(g, lpId), 'am Ort bleibt die Prise');
    // Außenteam unten auf der Prise: Szene gilt nicht als verlassen
    g.away.map = lpId; g.players[0].zone = 'away'; g.ship.scene = 'hafen';
    Entern.update(g, DT);
    ok(Entern.istPrise(g, lpId), 'Team unten auf der Prise: kein Verfall');
    g.players[0].zone = 'ship';
    Entern.update(g, DT);
    ok(!Entern.istPrise(g, lpId) && !Entern.treibende(g).length, 'Ort verlassen: Prise verfällt, Schiff weg');
    ok(Entern.toSave(g).length === 0, 'ohne merken kein Wrack');
    if (!LP_ECHT) ok(lpCalls.some((x) => x[0] === 'priseVerlassen' && x[1] === ort && x[2] === false), 'landepunkte.priseVerlassen(ort, false) (Ersatzmodul)');
    else ok(!(require('../server/sim/landepunkte.js').liste(g, ort) || []).some((x) => x.id === lpId), 'Landepunkt der Prise ist weg');
    // nach Verfall darf am Ort wieder eine Prise entstehen
    space.enterScene(g, ort); const e2 = spawn(g); e2.entern = true; kill(g, e2);
    ok(e2.st === 'treibt' && Entern.istPrise(g, lpId), 'nach Verfall neue Prise am Ort möglich');
  }
  {
    const { g } = arena();
    const ort = g.ship.scene;
    const e = spawn(g); e.entern = true; kill(g, e);
    const lpId = ort + '.prise';
    ok(Entern.merken(g, lpId) === 1, 'Buch setzt merken');
    space.enterScene(g, 'hafen');
    Entern.update(g, DT);
    const w = Entern.toSave(g);
    const wrackId = ort + '.wrack-1';   // landepunkte.priseVerlassen benennt um und gibt die neue ID zurück
    ok(!Entern.istPrise(g, lpId) && w.length === 1 && w[0].lpId === wrackId && w[0].ort === ort && w[0].quelle === 'entern',
      `mit merken: Wrack in welt.wracks { lpId: ${wrackId}, ort, quelle: entern } (${w[0] && w[0].lpId})`);
    ok(Entern.frei(g, wrackId) && !Entern.frei(g, lpId), 'Wrack frei unter der neuen ID, Prise-ID frei für die nächste');
    if (!LP_ECHT) ok(lpCalls.some((x) => x[0] === 'priseVerlassen' && x[1] === ort && x[2] === true), 'landepunkte.priseVerlassen(ort, true) (Ersatzmodul)');
    else {
      const L = require('../server/sim/landepunkte.js');
      const r = (L.liste(g, ort) || []).find((x) => x.id === wrackId);
      ok(!!r && r.zustand === 'verfallen', 'Landepunkt bleibt als Wrack, Zustand verfallen');
      ok(!(L.liste(g, ort) || []).some((x) => x.id === lpId), 'Prise-Landepunkt ist weg');
    }
    // neue Prise am Ort möglich; gemerkt -> zweites Wrack mit eigener ID, das erste bleibt
    space.enterScene(g, ort); const e3 = spawn(g); e3.entern = true; kill(g, e3);
    ok(e3.st === 'treibt' && Entern.istPrise(g, lpId), 'nach gemerktem Wrack neue Prise am Ort möglich');
    Entern.merken(g, lpId); space.enterScene(g, 'hafen'); Entern.update(g, DT);
    const w2 = Entern.toSave(g).map((x) => x.lpId);
    ok(w2.length === 2 && w2[0] === wrackId && w2[1] !== wrackId && (!LP_ECHT || w2[1] === ort + '.wrack-2'), 'zweites Wrack eigene ID, erstes unverändert (' + w2.join(', ') + ')');
  }
});

section('Feste Wracks frei nach Raumgefecht (landepunkte.json, quelle daten)', () => {
  const { g } = arena();
  let daten = [];
  try { const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'landepunkte.json'), 'utf8')); daten = ((d.orte || {}).splitter || []).filter((x) => x.frei === 'nach_raumgefecht').map((x) => x.id); } catch (e) { /* fehlt */ }
  if (!daten.length) { info('landepunkte.json ohne nach_raumgefecht am Splittergürtel – übersprungen'); return; }
  space.enterScene(g, 'splitter');
  ok(!Entern.toSave(g).some((w) => w.lpId === daten[0]), daten[0] + ' vor dem Gefecht nicht frei');
  const e = spawn(g); kill(g, e);
  const w = Entern.toSave(g).find((x) => x.lpId === daten[0]);
  ok(!!w && w.quelle === 'daten' && w.ort === 'splitter', daten[0] + ' nach dem ersten Abschuss frei (quelle daten)');
  if (LP_ECHT) ok(require('../server/sim/landepunkte.js').sperrgrund(g, daten[0]) === null, 'landepunkte.freigeben: ' + daten[0] + ' wählbar');
  const e2 = spawn(g); kill(g, e2);
  ok(Entern.toSave(g).filter((x) => x.lpId === daten[0]).length === 1, 'kein Doppeleintrag');
});

section('Weltstand: toSave/restore (welt.wracks, §8)', () => {
  const { g } = arena();
  ok(!Entern.stub && typeof Entern.toSave === 'function' && typeof Entern.restore === 'function', 'kein Stub mehr: weltstand.js ruft toSave/restore');
  ok(Array.isArray(Entern.toSave(g)) && Entern.toSave(g).length === 0, 'leerer Block []');
  const block = [{ lpId: 'splitter.prise', ort: 'splitter', quelle: 'entern' }, { lpId: 'splitter.treibgut', ort: 'splitter', quelle: 'daten' },
    { lpId: 'splitter.prise', ort: 'splitter', quelle: 'entern' }, { ort: 'x' }, null, { lpId: 'b.y', quelle: 'quatsch' }];
  Entern.restore(block, g);
  const s = Entern.toSave(g);
  ok(s.length === 3, 'Doppelte und ungültige Einträge verworfen');
  ok(JSON.stringify(s.slice(0, 2)) === JSON.stringify(block.slice(0, 2)), 'Rundreise unverändert');
  ok(s[2].lpId === 'b.y' && s[2].ort === null && s[2].quelle === 'entern', 'fehlender Ort -> null, unbekannte Quelle -> entern');
  // offene Prise überlebt das Laden nicht
  const e = spawn(g); e.entern = true; kill(g, e);
  Entern.restore(s, g);
  ok(!Entern.treibende(g).length && !Object.keys(g.entern.prisen).length, 'restore verwirft offene Prisen');
  Entern.restore(undefined, g);
  ok(Entern.toSave(g).length === 0, 'restore(undefined) -> leer');
  // Schema: lpId Pflicht, quelle enum
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'schema', 'weltstand.schema.json'), 'utf8'));
  const it = schema.properties.welt.properties.wracks.items;
  ok(s.every((w) => it.required.every((k) => w[k] != null) && it.properties.quelle.enum.includes(w.quelle) && Object.keys(w).every((k) => k in it.properties)),
    'Einträge passen zum Schema');
  // neue Partie (reset) -> frischer Zustand
  Entern.restore([{ lpId: 'a.b', ort: 'a', quelle: 'entern' }], g);
  g.reset();
  ok(Entern.toSave(g).length === 0, 'reset() -> frischer Zustand');
});

console.log(`\ntest-entern: ${n - fails}/${n} ok${fails ? `, ${fails} FEHLER` : ''}`);
process.exit(fails ? 1 : 0);
