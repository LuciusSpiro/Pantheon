'use strict';
// TEL-01 B2 Nacharbeit: Deckung als Rohzustand (server/telemetrie/haken.js deckungSpielerAlle/deckungGegner/deckungsZustand, combat.verdecktVor).
// Gescriptete Peek-Probe auf einer echten Aussenkarte (Karte wie tools/test-niederhalten.js): Spieler an niedriger Deckung, Gegner alarmiert hinter einer vollen Wand
//   -> verdeckt; ducken -> aufstehen -> ducken; Gegner kommt in Sicht; Spieler verlaesst die Aussenkarte; Gegner faellt / verschwindet / Ortswechsel; Sessionende.
// Jede offene Deckung wird mit einer letzten Zeile (ende) geschlossen. Das Protokoll liegt in einem Ordner ausserhalb des Repos.
//   node tools/test-telemetrie-deckung.js   (npm run test:telemetrie-deckung)
const fs = require('fs');
const os = require('os');
const path = require('path');
const Physics = require('../shared/physics.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const Wf = require('../server/sim/waffen.js');
const W = require('../server/world.js');
const Haken = require('../server/telemetrie/haken.js');
const Stellung = require('../server/sim/stellung.js');
const KACHELN = require('../content/buehnen/kacheln.json').zeichen;

Wf.aktiv = true;
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-deckung-'));
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* egal */ } });
const LP = 'test.tel.deckung', LP2 = 'test.tel.deckung2';
const ZEILE = 5;

function karte(id) {
  const grid = [];
  for (let y = 0; y < 14; y++) {
    const r = [];
    for (let x = 0; x < 50; x++) {
      let c = (x === 0 || y === 0 || x === 49 || y === 13) ? '#' : '.';
      if (x === 20 && y >= 1 && y <= 12) c = 'O';   // volle Deckung: sperrt die Sicht
      if (x === 10 && y === ZEILE + 1) c = 'o';     // niedrige Deckung unter dem Spieler (10, 5)
      r.push(c);
    }
    grid.push(r);
  }
  const rows = grid.map((r) => r.join(''));
  const legende = {};
  for (const r of rows) for (const ch of r) legende[ch] = KACHELN[ch];
  const A = (aid, rolle, x, y, extra) => Object.assign({ id: aid, rolle, x, y, platz: aid.split('.')[0], bereich: null }, extra || {});
  return { id, erzeuger: 'modul/1', art: 'aussenposten', bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt', seed: 2, bauversion: 'test',
    schablone: null, spiegel: null, w: 50, h: 14, rows, legende, anker: [A('lz.abholpunkt', 'abholpunkt', 2, 11, { ankunft: true, bereich: 'lz' })],
    bereiche: { lz: { name: 'Landezone', rects: [[1, 10, 6, 3]], rolle: 'hinein', gefecht: false } },
    plaetze: {}, eingaenge: [], abholpunkte: ['lz.abholpunkt'], ankunft: 'lz.abholpunkt',
    patrouillen: [], coverSpots: [], decks: null, kanten: {}, gelaende: null, meta: {} };
}
function szene(name) {
  const dir = path.join(root, name);
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', TELEMETRIE: 'an', TELEMETRIE_DIR: dir, TELEMETRIE_QUELLE: 'bot' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < 2; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'D' + i, name: 'D' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  for (const id of [LP, LP2]) { W.AWAY_MAPS[id] = { id, karte: karte(id) }; g.aways[id] = away.makeLandepunkt(g, id); }
  g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  const aw = g.aways[LP];
  aw.drones.length = 0;
  const S = { g, conns, aw, dir };
  S.P = (i) => combat.kaempfer(g, g.players[i]);
  S.place = (i, tx, ty) => { const p = S.P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; p.crouch = false; };
  S.run = (sek) => { for (let k = 0; k < Math.round(sek * 30); k++) g.step(); };
  S.gegner = (rolle, tx, ty) => {
    const e = squad.makeEnemy(g, aw, squad.TYP_KIND[rolle] || 'scavenger', 'G' + g.nextId(''), Physics.tileCenter(tx, ty), 'test');
    e.rolle = rolle; e.asleep = false; e.frozen = true;
    if (!aw.squads[e.squad]) aw.squads[e.squad] = squad.newSquad(e.squad, 1);
    aw.drones.push(e);
    combat.kaempfer(g, e);
    return e;
  };
  S.ducken = (i, an) => g.handleMessage(conns[i], { t: Protocol.C.CMD, c: 'crouch', on: an });
  S.zeilen = () => {
    g.telemetrie.schreibeJetzt();   // der Puffer wird sonst erst nach dem Tick geschrieben (setImmediate)
    const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')) : [];
    return f.length ? fs.readFileSync(path.join(dir, f[0]), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  };
  S.deckung = (slot) => S.zeilen().filter((x) => x.typ === 'deckung' && (slot ? x.slot === slot : true));
  S.ende = () => { for (const id of [LP, LP2]) delete W.AWAY_MAPS[id]; };
  return S;
}
const tup = (x) => x.cv + '|' + (x.geduckt ? 1 : 0) + '|' + (x.verdeckt ? 1 : 0);

console.log('Peek-Probe (Spieler, echte combat.updateVisibility)');
{
  const S = szene('peek'); const g = S.g;
  S.place(0, 10, ZEILE); S.place(1, 6, 11);
  const e = S.gegner('grundtyp', 30, ZEILE);   // hinter der vollen Wand, noch nicht alarmiert
  S.run(0.6);
  ok(S.deckung().length === 0, 'Grundzustand (kein alarmierter Gegner, nicht geduckt): keine Zeile');
  ok(combat.verdecktVor(g, S.P(0)) === false, 'verdecktVor: ohne alarmierte Gegner false');
  g.away.squads[e.squad].alert = true;
  S.run(0.6);
  let d = S.deckung('p1');
  ok(d.length === 1 && tup(d[0]) === '0|0|1' && d[0].x === 10 && d[0].y === ZEILE && d[0].ende === null && d[0].slot === 'p1' && d[0].gegner === null, 'alarmierter Gegner ohne Sicht, Spieler an Deckung: verdeckt (0|0|1) ' + JSON.stringify(d.map(tup)));
  S.ducken(0, true); S.run(0.6);
  S.ducken(0, false); S.run(0.6);
  S.ducken(0, true); S.run(0.6);
  d = S.deckung('p1');
  ok(d.map(tup).join() === '0|0|1,2|1|1,0|0|1,2|1|1', 'ducken, aufstehen, ducken erzeugt je eine Zeile: ' + d.map(tup).join());
  ok(S.deckung('p2').length === 0, 'p2 (ohne Deckung) bleibt ohne Zeile');
  ok(Haken.deckungsZustand(g, g.players[0]).verdeckt === true && Haken.deckungsZustand(g, g.players[0]).cv === 2, 'deckungsZustand(Spieler) = { cv 2, geduckt, verdeckt, stellung }');
  const zE = Haken.deckungsZustand(g, e);
  ok(zE.cv === null && zE.verdeckt === null && zE.geduckt === false && zE.stellung === false, 'deckungsZustand(Gegner) = { cv null, geduckt, verdeckt null, stellung }');
  // Gegner kommt in Sicht: verdeckt faellt, das Tupel aendert sich
  const c = Physics.tileCenter(15, ZEILE); e.x = c.x; e.y = c.y;
  S.run(0.6);
  d = S.deckung('p1');
  ok(d.length === 5 && d[4].verdeckt === false && d[4].ende === null, 'Gegner in Sicht: verdeckt false, neue Zeile (' + tup(d[d.length - 1]) + ')');
  // Spieler verlaesst die Aussenkarte: offener Zustand wird mit ende ort geschlossen
  const offen = tup(d[4]) !== '0|0|0';
  g.players[0].zone = 'ship';
  combat.updateVisibility(g);   // der Wechsel geschieht im Tick VOR der Sichtberechnung: deckungSpielerAlle sieht den offenen Zustand eines Spielers an Bord
  d = S.deckung('p1');
  const letzte = d[d.length - 1];
  ok(offen && d.length === 6 && letzte.ende === 'ort' && tup(letzte) === '0|0|0', 'Spieler nicht mehr draussen (updateVisibility): letzte Zeile ende ort im Grundzustand');
  S.run(0.6);
  ok(S.deckung('p1').length === 6, 'und es kommt keine zweite Schlusszeile (tickEnde findet nichts mehr offen)');
  { // an Bord zaehlt kein Deckungswert, auch wenn cv/crouch noch gesetzt sind (nur die Aussenkarte kennt Deckung)
    const p = g.players[0]; p.crouch = true; p.cv = 2;
    const z = Haken.deckungsZustand(g, p);
    ok(z.cv === 0 && z.geduckt === false && z.verdeckt === false && z.stellung === false, 'deckungsZustand: an Bord (zone ship) immer Grundzustand, auch mit crouch und cv');
    p.crouch = false; p.cv = 0;
  }
  g.players[0].zone = 'away';
  S.ducken(0, true); S.run(0.6);
  const vor = S.deckung('p1').length;
  g.telemetrie.sessionBeenden('test');
  d = S.deckung('p1');
  ok(d.length === vor + 1 && d[d.length - 1].ende === 'session' && tup(d[d.length - 1]) === '0|0|0', 'Sessionende schliesst den offenen Zustand (ende session, vor session_ende)');
  const z = S.zeilen();
  ok(z[z.length - 1].typ === 'session_ende' && z[z.length - 2].typ === 'deckung', 'die Schlusszeile steht vor session_ende');
  ok(g.telemetrie.stand().verworfeneFelder === 0 && g.telemetrie.stand().fehler === 0, 'verworfene Felder 0, Fehlerzaehler 0');
  S.ende();
}

console.log('Gegner: Tupel (geduckt, stellung), Tod, Entfernen, Ortswechsel');
{
  const S = szene('gegner'); const g = S.g;
  S.place(0, 10, ZEILE); S.place(1, 6, 11);
  const e1 = S.gegner('grundtyp', 30, 3), e2 = S.gegner('grundtyp', 30, 7), e3 = S.gegner('grundtyp', 30, 9);
  const t = (e) => S.deckung().filter((x) => x.gegner === e.id);
  Haken.deckungGegner(g, e1);
  ok(t(e1).length === 0, 'Gegner im Grundzustand: keine Zeile');
  e1.crouch = true; Haken.deckungGegner(g, e1); Haken.deckungGegner(g, e1);
  e1.crouch = false; Haken.deckungGegner(g, e1);
  ok(t(e1).map((x) => (x.geduckt ? 1 : 0) + '|' + (x.stellung ? 1 : 0)).join() === '1|0,0|0' && t(e1)[0].rolle === 'grundtyp' && t(e1)[0].cv === null && t(e1)[0].verdeckt === null, 'geduckt rein, raus: je eine Zeile, keine ohne Wechsel');
  // Stellung ist Teil des Tupels (steht in einer Stellung ohne zu ducken)
  const echt = Stellung.inStellung;
  Stellung.inStellung = (game, k) => k === e1;
  g.tick += (6 - (g.tick % 6)) % 6;   // die Stellung wird im 5-Hz-Takt (jeder 6. Tick) geprueft
  try { Haken.deckungGegner(g, e1); } finally { Stellung.inStellung = echt; }
  ok(t(e1).length === 3 && t(e1)[2].stellung === true && t(e1)[2].geduckt === false, 'Stellung allein ist ein Wechsel (0|1)');
  g.tick += 1;
  Haken.deckungGegner(g, e1);   // wieder ohne Stellung, aber nicht im Takt: noch keine Pruefung
  ok(t(e1).length === 3, 'ausserhalb des 5-Hz-Takts wird die Stellung nicht geprueft (nur eine Aenderung von geduckt wirkt sofort)');
  g.tick += 5;   // naechster Takt
  Haken.deckungGegner(g, e1);
  ok(t(e1).length === 4 && t(e1)[3].stellung === false && t(e1)[3].ende === null, 'Stellung endet: Zeile im Grundzustand');
  // Tod: geduckt gefallen -> tickEnde schliesst mit ende tod
  e2.crouch = true; Haken.deckungGegner(g, e2);
  e2.alive = false; Haken.deckungGegner(g, e2);   // ein gefallener Gegner meldet nicht selbst
  ok(t(e2).length === 1, 'gefallener Gegner: keine eigene Zeile ueber den Haken');
  S.run(0.1);
  ok(t(e2).length === 2 && t(e2)[1].ende === 'tod' && !t(e2)[1].geduckt, 'Gegner gefallen: letzte Zeile ende tod');
  // aus der Liste entfernt (z. B. Wellenende): ende weg
  e3.crouch = true; Haken.deckungGegner(g, e3);
  g.away.drones = g.away.drones.filter((x) => x !== e3);
  S.run(0.3);   // 'weg' wird im 5-Hz-Takt geprueft
  ok(t(e3).length === 2 && t(e3)[1].ende === 'weg', 'Gegner aus der Liste entfernt: letzte Zeile ende weg');
  // Ortswechsel: andere Aussenkarte
  const e4 = S.gegner('grundtyp', 30, 4);
  e4.crouch = true; Haken.deckungGegner(g, e4);
  g.setAwayMap(LP2);
  S.run(0.1);
  ok(t(e4).length === 2 && t(e4)[1].ende === 'ort', 'Aussenkarte gewechselt: offene Gegner ende ort');
  const n = S.deckung().length; S.run(0.5);
  ok(S.deckung().length === n, 'danach keine weiteren Zeilen ohne Aenderung (nichts bleibt offen)');
  g.telemetrie.sessionBeenden('test');
  ok(S.deckung().every((x) => x.ende == null || ['tod', 'weg', 'ort', 'session'].includes(x.ende)), 'ende nur aus der dokumentierten Liste');
  ok(g.telemetrie.stand().verworfeneFelder === 0 && g.telemetrie.stand().fehler === 0, 'verworfene Felder 0, Fehlerzaehler 0');
  S.ende();
}

console.log('Kosten von verdecktVor (nur lesen)');
{
  const S = szene('kosten'); const g = S.g;
  S.place(0, 10, ZEILE);
  const e = S.gegner('grundtyp', 30, ZEILE); g.away.squads[e.squad].alert = true;
  const vorher = JSON.stringify({ p: g.players.map((p) => [p.x, p.y, p.cv, p.crouch]), d: g.away.drones.map((x) => [x.x, x.y, x.crouch]), r: g.rng.state ? g.rng.state : null });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) combat.verdecktVor(g, g.players[0]);
  const us = Number(process.hrtime.bigint() - t0) / 2000 / 1000;
  console.log('  Info: verdecktVor ' + us.toFixed(2) + ' us je Aufruf (ein Spieler, ein alarmierter Gegner)');
  ok(vorher === JSON.stringify({ p: g.players.map((p) => [p.x, p.y, p.cv, p.crouch]), d: g.away.drones.map((x) => [x.x, x.y, x.crouch]), r: g.rng.state ? g.rng.state : null }), 'verdecktVor veraendert nichts');
  S.ende();
}

console.log(fails ? `\n${fails} FEHLER` : '\nTELEMETRIE DECKUNG OK');
process.exit(fails ? 1 : 0);
