'use strict';
// CONTRACT-ROLLEN R0 (Kapazität 4 Spieler) und 3a (Ivo im Frachtraum, Abgabe an der Station), direkt gegen die Game-Klasse.
//   node tools/test-rollen-r0.js
const Physics = require('../shared/physics.js');
const Maps = require('../shared/maps.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Fracht = require('../server/sim/fracht.js');
const W = require('../server/world.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

function neuesSpiel(spieler) {
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < spieler; i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'R' + i, name: 'R' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const notices = (i) => conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);
  const tap = (i) => { g.handleMessage(conns[i], { t: 'act', down: true }); g.handleMessage(conns[i], { t: 'act', down: false }); };
  return { g, conns, run, notices, tap };
}
const tileOf = (o) => Physics.toTile(o.x, o.y);
const bayKachel = new Set(Maps.CARGO_BAYS.flatMap((b) => [b.x + ',' + b.y, b.access.x + ',' + b.access.y]));

console.log('\n[R0: vier Spieler, Farben, Spawns]');
{
  ok(CONFIG.maxPlayers === 4, 'CONFIG.maxPlayers = 4');
  const { g, conns } = neuesSpiel(4);
  ok(g.players.length === 4, 'alle vier treten bei');
  const farben = g.players.map((p) => p.color).sort();
  ok(JSON.stringify(farben) === '[0,1,2,3]', 'Farben 0–3 eindeutig ' + JSON.stringify(farben));
  ok(g.phase === 'play', 'Spiel startet mit vier bereiten Spielern');
  const kacheln = g.players.map((p) => { const t = tileOf(p); return t.x + ',' + t.y; });
  ok(new Set(kacheln).size === 4, 'vier verschiedene Startkacheln ' + kacheln.join(' '));
  ok(Maps.SHIP_SPAWNS.length === 4 && new Set(Maps.SHIP_SPAWNS.map((s) => s.x + ',' + s.y)).size === 4, 'SHIP_SPAWNS: 4 verschiedene Einträge');
  ok(Maps.SHIP_SPAWNS.every((s) => !Maps.ship.solid(s.x, s.y)), 'alle Spawns begehbar');
  ok(Maps.BEDS.length === 4 && Maps.BEDS.every((b) => g.players.some((p) => p.color === b.color)), 'jede Koje 0–3 gehört einem Spieler');

  // fünfter Spieler wird abgewiesen
  const c5 = { inbox: [], send(o) { this.inbox.push(o); }, close() { this.closed = true; } };
  g.addConnection(c5);
  g.handleMessage(c5, { t: 'hello', clientId: 'R4', name: 'R4', color: 0 });
  const voll = c5.inbox.find((m) => m.t === 'full');
  ok(!!voll && /Server voll/.test(voll.text) && /4 Crewmitglieder/.test(voll.text), '5. Spieler: „Server voll“ (' + (voll && voll.text) + ')');
  ok(g.players.length === 4 && c5.closed === true, 'Spielerzahl bleibt 4, Verbindung wird geschlossen');

  // Farbwunsch außerhalb von 0–3 wird ignoriert, belegte Farbe weicht aus
  const h = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const ca = { send() {} }, cb = { send() {} }, cc = { send() {} };
  for (const c of [ca, cb, cc]) h.addConnection(c);
  h.handleMessage(ca, { t: 'hello', clientId: 'A', name: 'A', color: 3 });
  h.handleMessage(cb, { t: 'hello', clientId: 'B', name: 'B', color: 3 });
  h.handleMessage(cc, { t: 'hello', clientId: 'C', name: 'C', color: 4 });
  const fa = h.players.map((p) => p.color);
  ok(fa[0] === 3 && fa[1] !== 3 && fa[2] >= 0 && fa[2] <= 3 && new Set(fa).size === 3, 'Farbe 3 wählbar, doppelt/ungültig weicht aus ' + JSON.stringify(fa));
  void conns;
}

console.log('\n[R0: Truppstärke und Planungstisch bei 4 Spielern]');
{
  ok(CONFIG.awayCombat.squadScale[4] === 1.25, 'squadScale[4] = 1,25');
  ok(CONFIG.plan.maxSeated >= 4, 'Planungstisch fasst ' + CONFIG.plan.maxSeated);
  const squad = require('../server/sim/squad.js');
  const { g } = neuesSpiel(4);
  const aw = g.aways.kesh;
  ok(!!aw, 'Kesh vorhanden');
  const spots = (W.AWAY_MAPS.kesh.spawns.squad1 || []).length;
  aw.spawned = {};
  const e0 = aw.drones.length;
  const gespawnt = squad.spawnSquad(g, 'squad1', { force: true });
  ok(spots > 0 && gespawnt === Math.min(spots, Math.ceil(spots * 1.25)) && aw.drones.length === e0 + gespawnt, `Kesh-Trupp: ${gespawnt} von ${spots} Plätzen (aufgerundet, höchstens alle Plätze)`);
}

console.log('\n[R0: Ivo im Frachtraum]');
{
  const { g, run } = neuesSpiel(2);
  ok(!g.ivo, 'ohne Rettung kein Ivo an Bord');
  g.mission.flags.technikerRescued = true;
  run(0.2);
  ok(!!g.ivo, 'nach der Rettung zieht Ivo ein');
  const t = tileOf(g.ivo);
  const raum = Maps.roomAt(t.x, t.y);
  ok(raum && raum.id === 'messe', 'Ivo wohnt in der Messe (' + (raum && raum.id) + ') – PAN-01 B: die Schlafecke zog vom Frachtraum in die Messe');
  ok(Maps.nutzungAt(t.x, t.y).includes('quartier'), 'Messe: nutzung [quartier]');
  ok(!bayKachel.has(t.x + ',' + t.y), 'Ivo steht weder auf einer Bucht noch auf deren Zugangskachel');
  // Schlafecke belegt keine Bucht/Zugangskachel
  const ecke = [];
  for (let y = 17; y <= 27; y++) for (let x = 29; x <= 38; x++) { const k = Maps.ship.info(x, y).kind; if (k === 'cargo_cot' || k === 'tool_wall') ecke.push({ x, y, k }); }
  ok(ecke.some((e) => e.k === 'cargo_cot') && ecke.some((e) => e.k === 'tool_wall'), 'Schlafecke (Pritsche, Werkzeugwand) in der Messe');
  ok(ecke.every((e) => !bayKachel.has(e.x + ',' + e.y)), 'Schlafecke belegt keine Bucht und keine Zugangskachel');
  ok(Maps.CARGO_BAYS.length === 8 && Maps.CARGO_BAYS.every((b) => Maps.ship.at(b.x, b.y) === 'q' && !Maps.ship.solid(b.access.x, b.access.y)), 'acht Frachtbuchten (2 je Modulraum) mit freien Zugängen');
  ok(g.odaSeen.has('ivoMovedIn'), 'ODA-Hinweis beim Einzug');
  // er schlendert: nach einer Weile an anderer Kachel, bleibt auf Deck II
  run(30);
  const t2 = tileOf(g.ivo);
  ok(Maps.deckOf(t2.y) === 1, 'Ivo bleibt auf dem Oberdeck (Lift/Leiter nie)');
  const fr = Fracht.toSave(g);
  ok(Array.isArray(fr) && fr.length === 0, 'Fracht unverändert (leer)');
}

console.log('\n[R0: Ivo abgeben (nur angedockt)]');
{
  const { g, conns, run, notices, tap } = neuesSpiel(2);
  g.mission.flags.technikerRescued = true;
  run(0.2);
  const p = g.players[0];
  const zuIvo = () => { const t = tileOf(g.ivo); const c = Physics.tileCenter(t.x, t.y); p.x = c.x; p.y = c.y; p.zone = 'ship'; p.console = null; };
  // nicht angedockt: gesperrt
  g.ship.docked = false; g.ship.dockedAt = null;
  zuIvo(); tap(0);
  ok(notices(0).includes('Hier kann ich nicht aussteigen.'), 'nicht angedockt: „Hier kann ich nicht aussteigen.“');
  ok(!!g.ivo && !g.ivo.abschied && !(g.weltstand.data.fakten.ivo), 'nicht angedockt: Ivo bleibt, kein Fakt');
  // angedockt: Abgabe ohne Haltezeit
  g.ship.docked = true; g.ship.dockedAt = 'hafen';
  conns[0].inbox.length = 0;
  zuIvo(); tap(0);
  ok(g.ivo && g.ivo.abschied === true && !p.hold, 'angedockt: Abschied beginnt sofort (keine Haltezeit, kein Gespräch)');
  const radio = conns[0].inbox.find((m) => m.kind === 'radio');
  ok(!!radio && /Techniker Ivo/.test(radio.from), 'Funkzeile von Ivo zum Abschied');
  const fk = g.weltstand.data.fakten;
  ok(fk.ivo === 'abgegeben' && fk.ivo_ort === 'hafen', 'Weltstand-Fakt: ivo = abgegeben, ivo_ort = hafen');
  const ni = g.weltstand.data.npc.ivo;
  ok(ni.status === 'lebt' && ni.ort === 'hafen' && ni.gedaechtnis.some((e) => e.ereignis === 'abgegeben'), 'NSC-Gedächtnis von ivo: Ort hafen, Eintrag „abgegeben“');
  ok(g.mission.flags.technikerRescued === true, 'technikerRescued bleibt true');
  ok(g.snapshot().ship.npcs[0].ab === 1, 'Snapshot: Ivo geht (ab), die Schlafecke verschwindet');
  // läuft zum Ausstieg und verschwindet
  let k = 0;
  while (g.ivo && k++ < 30 * 60) g.step();
  ok(g.ivo === null, 'Ivo verschwindet nach dem Weg zum Ausstieg (' + (k / 30).toFixed(1) + ' s)');
  ok(g.snapshot().ship.npcs.length === 0, 'Snapshot ohne Ivo');
  run(10);
  ok(g.ivo === null, 'Ivo kommt nicht zurück');
  // zweite Abgabe nicht möglich (Ivo weg)
  const vor = JSON.stringify(g.weltstand.data.fakten);
  tap(0);
  ok(JSON.stringify(g.weltstand.data.fakten) === vor, 'keine weitere Wirkung');

  // Generator liest den Fakt
  const gen = require('../server/mission/generator.js');
  const prompt = gen.buildPrompt(g.mission.flags, g.weltstand.data.fakten);
  ok(/abgegeben bei Hafen Lichtkordon/.test(prompt) && !/Ivo von der Boje: gerettet\./.test(prompt), 'generator: „abgegeben bei <Ort>“ statt „gerettet“');

  console.log('\n[R0: Speichern und Laden nach der Abgabe]');
  const data = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  ok(data.welt.fakten.ivo === 'abgegeben' && data.welt.flags.technikerRescued === true && data.npc.ivo.ort === 'hafen', 'capture: Fakt, Flag, NSC-Ort');
  const h = new Game({ noStore: true, seed: 8, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c0 = { inbox: [], send(o) { this.inbox.push(o); } };
  h.addConnection(c0); h.handleMessage(c0, { t: 'hello', clientId: 'L0', name: 'L0', color: 0 }); h.handleMessage(c0, { t: 'ready', ready: true });
  h.reset(); h.phase = 'play';
  Weltstand.apply(h, data);
  for (let i = 0; i < 90; i++) h.step();
  ok(h.mission.flags.technikerRescued === true, 'geladen: technikerRescued true');
  ok(h.ivo === null && h.snapshot().ship.npcs.length === 0, 'Weltstand.apply erzeugt Ivo nicht neu');
  ok(h.weltstand.data.fakten.ivo === 'abgegeben', 'geladen: Fakt vorhanden');
  // Gegenprobe: gerettet, aber nicht abgegeben -> Ivo ist nach dem Laden wieder an Bord
  const g2 = neuesSpiel(1);
  g2.g.mission.flags.technikerRescued = true; g2.run(0.2);
  const d2 = JSON.parse(JSON.stringify(Weltstand.capture(g2.g)));
  const h2 = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c1 = { send() {} };
  h2.addConnection(c1); h2.handleMessage(c1, { t: 'hello', clientId: 'L1', name: 'L1', color: 0 }); h2.handleMessage(c1, { t: 'ready', ready: true });
  h2.reset(); h2.phase = 'play'; Weltstand.apply(h2, d2);
  for (let i = 0; i < 30; i++) h2.step();
  ok(!!h2.ivo, 'nicht abgegeben: Ivo ist nach dem Laden an Bord');
}

console.log('\n[R0: Fracht-Mechanik unberührt]');
{
  const { g } = neuesSpiel(2);
  ok(Fracht.capacity(g) === 2 && typeof Fracht.toSave === 'function', 'Kapazität 2 (ein Frachtraum), Fracht-Modul vorhanden');
  // Erreichbarkeit der Zugangskacheln vom Spawn (BFS über alle Decks, Lift) bei voll ausgebauter Lerche
  const solid = Maps.shipSolidFn(Maps.STUFE_MAX);
  const seen = new Set(); const q = [[Maps.SHIP_SPAWNS[0].x, Maps.SHIP_SPAWNS[0].y]]; seen.add(q[0].join(','));
  while (q.length) {
    const [x, y] = q.shift();
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).concat(Maps.deckLinks(x, y).map((l) => [l.x, l.y]));
    for (const [nx, ny] of next) { const key = nx + ',' + ny; if (!seen.has(key) && ny >= 0 && ny <= 44 && nx >= 0 && nx <= 39 && !solid(nx, ny)) { seen.add(key); q.push([nx, ny]); } }
  }
  ok(Maps.CARGO_BAYS.every((b) => seen.has(b.access.x + ',' + b.access.y)), 'Zugangskacheln aller acht Buchten erreichbar (voll ausgebaut)');
  void g;
}

console.log(`\ntest-rollen-r0: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
