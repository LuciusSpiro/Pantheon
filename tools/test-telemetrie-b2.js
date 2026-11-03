'use strict';
// TEL-01 B2: Test der Haken fuer Deckung, Menschen, Wirtschaft, Technik und die Zeitreihe (server/telemetrie/haken.js) – ohne Netz, direkt gegen die Game-Klasse.
//   node tools/test-telemetrie-b2.js  (npm run test:telemetrie-b2)
// (Deckung als Rohzustand mit Peek-Probe: tools/test-telemetrie-deckung.js; Tickschleife in server/index.js: tools/test-telemetrie-server.js.)
// Prueft je Ereignistyp: er entsteht an der richtigen Stelle mit den richtigen Feldern, Zeitreihe (alle 2 s, drei Slots, Tickzeit, Fehlerzaehler, Eingaben,
// kein Kontostand), Pseudonym (keine Namen, keine Fehlermeldung im Protokoll), Schema (nur Felder aus schema.js), und der Spielverlauf ist mit und ohne
// Protokoll bit-gleich.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const Protocol = require('../shared/protocol.js');
const interior = require('../server/sim/interior.js');
const Station = require('../server/sim/station.js');
const Space = require('../server/sim/space.js');
const Geld = require('../server/sim/geld.js');
const Vorrat = require('../server/sim/vorrat.js');
const Ruf = require('../server/sim/ruf.js');
const Haken = require('../server/telemetrie/haken.js');
const { SCHEMA } = require('../server/telemetrie/schema.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-b2-'));
const lesen = (d) => { const f = fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')); return f.length ? fs.readFileSync(path.join(d, f[0]), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []; };

function setup(dir, tel) {
  const env = { MISSION_SOURCE: 'fallback', TELEMETRIE: tel, TELEMETRIE_DIR: dir, TELEMETRIE_QUELLE: 'bot' };
  const g = new Game({ noStore: true, seed: 7, env, log: () => {} });
  const conns = [];
  for (let i = 0; i < 3; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'Clientqzx-' + i, name: ['Zyxwename', 'Qorvath', 'Mirelle'][i], color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  return { g, conns, run: (sek) => { for (let k = 0; k < Math.round(sek * 30); k++) g.step(); } };
}

// Dasselbe Drehbuch fuer Protokoll an und aus: Konsolen, Tab, Eingaben, Energie, Reparaturspiel, Buchungen, Ruf, Deckung, Fehler
function drehbuch(S) {
  const { g, conns, run } = S;
  const [p1, p2, p3] = g.players;
  run(1);
  interior.enterConsole(g, p1, 'helm'); interior.enterConsole(g, p2, 'weapons'); interior.enterConsole(g, p3, 'captain');
  run(1);
  Station.tab(g, p3, 1);                                                        // Rollenwechsel an der Konsole
  g.handleMessage(conns[0], { t: Protocol.C.INPUT, mx: 1, my: 0, run: false });   // Eingabe Bewegung
  g.handleMessage(conns[1], { t: Protocol.C.ACT, down: true });                  // Eingabe Aktion
  g.handleMessage(conns[1], { t: Protocol.C.ACT, down: false });
  run(1);
  g.handleMessage(conns[2], { t: Protocol.C.DEBUG, cmd: 'help' });                // Debug und clientError sind keine Eingaben (p3 sendet nur diese)
  g.handleMessage(conns[2], { t: 'clientError', msg: 'x' });
  g.handleMessage(conns[0], { t: Protocol.C.LEAVE });                            // Spieler verlaesst die Konsole
  run(1);
  Space.technikPower(g, 'engines', -1);                                          // Energie aus der Technik-Konsole
  run(1);
  Geld.einnehmen(g, 7, 'bergung'); Geld.abziehenHoechstens(g, 3, 'notfall'); Vorrat.verbrauchen(g, 'bolzen', 1, 'torpedo'); Vorrat.einlagern(g, 'flickblech', 2, 'fund');
  g.weltsim = Object.assign(g.weltsim || {}, { ruf: { rom: 0, ger: 0, kon: 0 } });
  Ruf.aendern(g, 'rom', 5);
  // Reparaturspiel (Halteprozess minigame) von p1: System kaputt, Halteprozess gesetzt, laufen lassen, fertig melden
  interior.konsoleVerlassen(g, p2, 'spieler'); interior.konsoleVerlassen(g, p3, 'spieler');
  g.handleMessage(conns[0], { t: Protocol.C.INPUT, mx: 0, my: 0, run: false });   // p1 steht wieder (Bewegung bricht den Halteprozess ab)
  g.ship.systems.engines = 'broken';
  p1.hold = { kind: 'minigame', system: 'engines', t: 0, dur: Infinity };
  run(3.2);
  g.handleMessage(conns[0], { t: Protocol.C.CMD, c: 'repair.done', system: 'engines', errors: 0 });
  run(1);
  // Deckung: Spieler draussen mit Deckung, danach ohne; Gegner duckt sich
  // Spieler: ueber die echte combat.updateVisibility (die Karte ersetzt eine Attrappe: geduckt neben niedriger Deckung -> cv 2)
  const Los = require('../shared/los.js'); const nextToLow = Los.nextToLow;
  p2.zone = 'away'; p2.crouch = true; Los.nextToLow = () => true;
  try { require('../server/sim/combat.js').updateVisibility(g); p2.crouch = false; require('../server/sim/combat.js').updateVisibility(g); } finally { Los.nextToLow = nextToLow; }
  const e = { id: 'gra-1', kind: 'scavenger', rolle: 'grundtyp', alive: true, crouch: true, x: 336, y: 496 };
  Haken.deckungGegner(g, e); Haken.deckungGegner(g, e); e.crouch = false; Haken.deckungGegner(g, e);
  Haken.spielleiterWarten(g, 'lage', 3.456, 'ok');
  g.countError('test-x', new Error('Geheimname-Fehlermeldung'));
  run(2.5);
}

(async () => {
  console.log('Haken (B2): Ereignisse');
  const d1 = path.join(root, 'an');
  const S = setup(d1, 'an');
  drehbuch(S);
  const g = S.g;
  g.telemetrie.sessionBeenden('test');
  const z = lesen(d1);
  const von = (t) => z.filter((x) => x.typ === t);
  const kon = von('konsole');
  ok(kon.some((x) => x.slot === 'p1' && x.konsole === 'helm' && x.station === 'helm' && x.rein === true && x.grund === 'betreten'), 'konsole: p1 betritt die Steuer');
  ok(kon.some((x) => x.slot === 'p3' && x.rein === true && x.grund === 'tab' && x.station !== 'captain'), 'konsole: Tab wechselt die Rolle (station != Ort)');
  ok(kon.some((x) => x.slot === 'p1' && x.rein === false && x.grund === 'spieler' && x.konsole === 'helm'), 'konsole: Leave verlaesst, Grund spieler, konsole = Ort davor');
  ok(kon.filter((x) => x.rein === false && x.slot === 'p2' && x.grund === 'spieler').length === 1, 'konsole: konsoleVerlassen schreibt je Verlassen genau eine Zeile');
  const en = von('energie');
  ok(en.length === 1 && en[0].grund === 'technik' && en[0].system === 'engines' && en[0].delta === -1 && en[0].engines === 1 && en[0].leistung === 8, 'energie: Technik-Konsole, engines -1');
  const bu = von('buchung');
  const bg = (k, gr) => bu.find((x) => x.konto === k && x.grund === gr);
  ok(bg('marks', 'bergung') && bg('marks', 'bergung').betrag === 7 && bg('marks', 'bergung').art === 'buchung', 'buchung: Marken +7 (bergung)');
  ok(bg('marks', 'notfall') && bg('marks', 'notfall').betrag === -3, 'buchung: Marken -3 (notfall)');
  ok(bg('marks', 'bergung').stand === g.inventory.marks - bg('marks', 'notfall').betrag, 'buchung: stand = Stand danach');
  ok(bg('bolzen', 'torpedo') && bg('bolzen', 'torpedo').betrag === -1 && bg('flickblech', 'fund').betrag === 2, 'buchung: Verbrauchsgueter (bolzen -1, flickblech +2)');
  const rf = von('ruf');
  ok(rf.length === 1 && rf[0].fraktion === 'rom' && rf[0].betrag === 5 && rf[0].stand === 5, 'ruf: rom +5, Stand 5');
  const rp = von('reparatur');
  ok(rp.length === 1 && rp[0].slot === 'p1' && rp[0].system === 'engines' && rp[0].wie === 'minigame' && rp[0].erfolg === true && rp[0].dauer >= 3 && rp[0].notflicken === false, 'reparatur: p1, minigame, Erfolg, Dauer ' + (rp[0] && rp[0].dauer));
  const zw = von('zone_wieder');
  const SEKT = ['bug', 'steuerbord', 'heck', 'backbord'];
  ok(zw.length === 1 && zw[0].system === 'engines' && zw[0].zone === SEKT[interior.systemSector('engines')] && zw[0].wie === 'minigame' && zw[0].durch === 'player', 'zone_wieder: system engines, zone = Sektor (' + (zw[0] && zw[0].zone) + '), minigame, durch player');
  const dk = von('deckung');
  const tp = (x) => x.cv + '|' + (x.geduckt ? 1 : 0) + '|' + (x.verdeckt ? 1 : 0);
  ok(dk.filter((x) => x.slot === 'p2').map(tp).join() === '2|1|0,0|0|0' && Number.isInteger(dk.find((x) => x.slot === 'p2').x) && dk.every((x) => !('rein' in x)), 'deckung: Spieler als Rohzustand (cv|geduckt|verdeckt) 2|1|0 dann 0|0|0, je Aenderung eine Zeile, kein rein');
  ok(dk.filter((x) => x.gegner === 'gra-1').map((x) => (x.geduckt ? 1 : 0) + '|' + (x.stellung ? 1 : 0)).join() === '1|0,0|0' && dk.find((x) => x.gegner === 'gra-1').rolle === 'grundtyp' && dk.find((x) => x.gegner === 'gra-1').x === 10, 'deckung: Gegner geduckt dann nicht, keine Zeile ohne Aenderung, Kachel = floor(v/32)');
  const sw = von('spielleiter_warten');
  ok(sw.length === 1 && sw[0].art === 'lage' && sw[0].dauer === 3.46 && sw[0].ausgang === 'ok', 'spielleiter_warten: lage, 3.46 s');

  console.log('Zeitreihe');
  const zr = von('zeitreihe');
  const abst = zr.slice(1).map((x, i) => +(x.t - zr[i].t).toFixed(2));
  ok(zr.length >= 5 && abst.every((a) => Math.abs(a - 2) < 0.04), 'alle 2 s Spielzeit (' + zr.length + ' Zeilen, Abstaende ' + [...new Set(abst)].join('/') + ')');
  ok(zr.every((x) => x.slots.join() === 'p1,p2,p3' && x.verbunden.length === 3 && x.konsole.length === 3 && x.station.length === 3 && x.ein_bew.length === 3), 'drei Slots in allen Listen');
  ok(zr.some((x) => x.konsole.join() === 'helm,weapons,captain' && x.station[2] !== 'captain'), 'drei Slots mit eigenen Konsolen/Rollen');
  ok(zr.every((x) => x.tick_n >= 59 && x.tick_n <= 61 && x.tick_med > 0 && x.tick_max >= x.tick_med), 'Tickzeit je Fenster: n ~60, Median > 0, Max >= Median');
  ok(zr.some((x) => x.ein_bew[0] >= 1) && zr.some((x) => x.ein_akt[1] === 2), 'Eingaben je Slot gezaehlt (Bewegung / Aktion)');
  ok(zr.some((x) => x.fehler_n === 1 && x.fehler_wo.join() === 'test-x'), 'Fehler: Anzahl und Schluessel');
  ok(!z.some((x) => JSON.stringify(x).includes('Geheimname')), 'keine Fehlermeldung im Protokoll');
  ok(zr.some((x) => x.r_energie.join() === '1,2,2') && zr.every((x) => x.r_zustand.length === interior.SYSTEM_ORDER.length && x.r_integ.length === interior.SYSTEM_ORDER.length), 'Raum: Energie-Verlauf, Zustand und Integritaet je System');
  ok(zr.every((x) => !Object.keys(x).some((k) => /mark|konto|stand_m/.test(k))), 'kein Kontostand in der Zeitreihe');
  ok(zr.some((x) => x.ort.includes('boden') && x.b_cv[1] === 0) && zr.every((x) => x.ort.every((o) => o === 'raum' || o === 'boden')), 'Boden: ort (raum | boden) und Deckungswerte je Slot');
  ok(zr.every((x) => x.ein_akt[2] === 0 && x.ein_bew[2] === 0), 'Debug und clientError zaehlen nicht als Eingabe (p3 sendet nur diese)');
  ok(zr.every((x) => x.tick_ueber5 >= x.tick_ueber16 && x.tick_ueber16 >= x.tick_ueber33 && x.tick_ueber5 <= x.tick_n && x.snap_n === 0 && x.kappung_n === 0 && x.nachhol_ticks === 0), 'Tick-Zaehler ueber 5/16/33 ms verschachtelt; ohne Server (Bot) keine Snapshot- und Kappungswerte');
  ok(zr.every((x) => Object.keys(x).length === 5 + SCHEMA.zeitreihe.felder.length), 'Zeitreihe: alle Felder des Schemas, keine fremden');

  console.log('Schema und Pseudonym');
  const fremd = [];
  for (const x of z) {
    const s = SCHEMA[x.typ];
    if (!s) { fremd.push(x.typ); continue; }
    for (const k of Object.keys(x)) if (!['v', 'typ', 'sitzung', 'tick', 't'].includes(k) && !s.felder.includes(k)) fremd.push(x.typ + '.' + k);
  }
  ok(fremd.length === 0, 'jeder Typ und jedes Feld steht im Schema' + (fremd.length ? ': ' + [...new Set(fremd)].join(',') : ''));
  ok(g.telemetrie.stand().verworfeneFelder === 0 && g.telemetrie.stand().fehler === 0, 'verworfene Felder 0, Fehlerzaehler 0');
  const roh = fs.readdirSync(d1).filter((f) => f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(d1, f), 'utf8')).join('\n');
  ok(!['Zyxwename', 'Qorvath', 'Mirelle', 'Clientqzx'].some((n) => roh.includes(n)), 'keine Namen, keine clientId im Protokoll');

  console.log('Spielverlauf mit und ohne Protokoll');
  const d2 = path.join(root, 'aus');
  const A = setup(d2, 'aus');
  drehbuch(A);
  const zustand = (x) => JSON.stringify({ inv: x.g.inventory, ship: x.g.ship, ps: x.g.players.map((p) => ({ x: p.x, y: p.y, c: p.console, st: p.station, z: p.zone, cv: p.cv, hold: p.hold })), tick: x.g.tick, time: x.g.time, ruf: x.g.weltsim && x.g.weltsim.ruf, err: x.g.errors });
  const zs = zustand(S);
  ok(zs === zustand(A), 'Zustand nach dem Drehbuch identisch (Inventar, Schiff, Spieler, Zeit, Fehler)');
  ok(!fs.existsSync(d2) || lesen(d2).length === 0, 'TELEMETRIE=aus schreibt nichts');

  console.log('Abnahme 10: drei Slots, Nachzuegler, Abgang (gescriptet)');
  {
    const d3 = path.join(root, 'drei');
    const T = setup(d3, 'an');   // drei hello, dann erst ready: alle drei sind beim Start da
    const { g, conns, run } = T;
    const [q1, q2, q3] = g.players;
    run(1);
    interior.enterConsole(g, q1, 'helm'); interior.enterConsole(g, q2, 'weapons'); interior.enterConsole(g, q3, 'technik');
    run(4.5);
    // echter Nachzuegler: ein vierter Spieler kommt nach dem Start dazu und setzt sich an die Captain-Konsole
    const c4 = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c4); g.handleMessage(c4, { t: 'hello', clientId: 'Clientqzx-3', name: 'Nachzuegleria', color: 3 });
    const q4 = g.players.find((p) => p.id === 'p4');
    interior.enterConsole(g, q4, 'captain');
    run(4.5);
    // Abgang: p2 trennt die Verbindung
    g.removeConnection(conns[1]);
    run(4.5);
    g.telemetrie.sessionBeenden('test');
    const z3 = lesen(d3);
    const bei = z3.filter((x) => x.typ === 'spieler_bei'), weg = z3.filter((x) => x.typ === 'spieler_weg');
    ok(z3[0].typ === 'kopf' && z3[0].spielerzahl === 3 && z3[0].slots.map((s) => s.slot).join() === 'p1,p2,p3' && bei.length === 1 && bei[0].slot === 'p4' && bei[0].nachzuegler === true, 'Start mit drei bereiten Spielern (Kopf: p1, p2, p3), spaeter p4 als Nachzuegler (spieler_bei)');
    ok(weg.length === 1 && weg[0].slot === 'p2', 'spieler_weg: p2 (Abgang)');
    const zr3 = z3.filter((x) => x.typ === 'zeitreihe');
    const zu = (x) => x.slots.join();
    ok(zr3.some((x) => zu(x) === 'p1,p2,p3' && x.konsole.join() === 'helm,weapons,technik' && x.station.join() === 'helm,weapons,technik'), 'Zeitreihe: drei Slots mit eigenen Konsolen und Rollen (helm, weapons, technik)');
    ok(zr3.some((x) => zu(x) === 'p1,p2,p3,p4' && x.konsole[3] === 'captain' && x.verbunden.join() === 'true,true,true,true'), 'Zeitreihe: Nachzuegler p4 mit eigener Konsole (captain), vier verbundene Slots');
    ok(zr3.some((x) => zu(x) === 'p1,p2,p3,p4' && x.verbunden[1] === false && x.verbunden[0] === true && x.konsole[1] === null), 'Zeitreihe: Abgang p2 nicht mehr verbunden, Konsole frei');
    const kon = z3.filter((x) => x.typ === 'konsole');
    ok(kon.some((x) => x.slot === 'p2' && x.rein === false && x.grund === 'abgang') && kon.filter((x) => x.rein === true && x.grund === 'betreten').map((x) => x.slot).join() === 'p1,p2,p3,p4', 'konsole: vier Betreten, p2 verlaesst mit Grund abgang');
    ok(!z3.some((x) => JSON.stringify(x).match(/Zyxwename|Qorvath|Mirelle|Nachzuegleria|Clientqzx/)), 'keine Namen, keine clientId');
    ok(g.telemetrie.stand().verworfeneFelder === 0 && g.telemetrie.stand().fehler === 0, 'verworfene Felder 0, Fehlerzaehler 0');
    console.log('  Info: ' + zr3.length + ' Zeitreihenzeilen, Slots je Zeile ' + [...new Set(zr3.map(zu))].join(' | '));
  }

  console.log('Solo-Pause zaehlt nicht (Tickzeit und Zeitreihe stehen mit der Spielzeit)');
  {
    const dp = path.join(root, 'pause');
    const env = { MISSION_SOURCE: 'fallback', TELEMETRIE: 'an', TELEMETRIE_DIR: dp, TELEMETRIE_QUELLE: 'bot' };
    const g = new Game({ noStore: true, seed: 7, env, log: () => {} });
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'Clientqzx-9', name: 'Solowolf', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
    const run = (sek) => { for (let k = 0; k < Math.round(sek * 30); k++) g.step(); };
    run(3.2);
    g.paused = true;   // Solo-Pause: die Simulation steht, Game.step laeuft weiter
    g.telemetrie.schreibeJetzt();
    const tPause = g.time; const n0 = lesen(dp).filter((x) => x.typ === 'zeitreihe').length;
    run(20);   // 600 Steps in der Pause
    g.telemetrie.schreibeJetzt();
    const nP = lesen(dp).filter((x) => x.typ === 'zeitreihe').length;
    ok(g.time === tPause && nP === n0, 'in der Pause: Spielzeit steht, keine neue Zeitreihenzeile (' + n0 + ' -> ' + nP + ')');
    g.paused = false;
    run(2.2);
    g.telemetrie.sessionBeenden('test');
    const zp = lesen(dp).filter((x) => x.typ === 'zeitreihe');
    ok(zp.length === n0 + 1 && zp[zp.length - 1].tick_n >= 25 && zp[zp.length - 1].tick_n <= 61, 'danach: das naechste Fenster zaehlt nur laufende Ticks (tick_n ' + zp[zp.length - 1].tick_n + ', nicht ~600 mehr)');
    ok(zp.every((x) => x.tick_n <= 61), 'kein Fenster hat mehr als ~60 Ticks (die 600 Pausen-Steps sind nicht eingerechnet)');
  }

  console.log('Kaputte Werte stehen als null');
  {
    const dk2 = path.join(root, 'null');
    const S2 = setup(dk2, 'an');
    S2.run(1);
    S2.g.inventory.ladung = undefined;   // kaputter Bestand
    Vorrat.einlagern(S2.g, 'ladung', 2, 'fund');
    Haken.buchung(S2.g, 'marks', 'buchung', 'test', NaN, undefined);
    Haken.ruf(S2.g, 'rom', undefined, NaN, 'test');
    S2.g.telemetrie.sessionBeenden('test');
    const zn = lesen(dk2);
    const b = zn.filter((x) => x.typ === 'buchung' && x.konto === 'ladung');
    ok(b.length === 1 && b[0].betrag === null && b[0].stand === 2, 'vorrat mit kaputtem Vorwert: betrag null statt 0 (' + JSON.stringify(b[0] && [b[0].betrag, b[0].stand]) + ')');
    ok(zn.some((x) => x.typ === 'buchung' && x.grund === 'test' && x.betrag === null && x.stand === null), 'buchung mit NaN/undefined: betrag und stand null');
    ok(zn.some((x) => x.typ === 'ruf' && x.grund === 'test' && x.betrag === null && x.stand === null), 'ruf mit kaputtem Wert: null, grund steht im Feld');
  }

  console.log('Ruf-Grund und ein Fehler in der Zeitreihe');
  {
    const dr = path.join(root, 'ruf');
    const S3 = setup(dr, 'an');
    S3.run(1);
    S3.g.weltsim = Object.assign(S3.g.weltsim || {}, { ruf: { rom: 0, ger: 0, kon: 0 } });
    Ruf.aendern(S3.g, 'rom', 4);
    Ruf.debug(S3.g, ['rom', '9']);
    // ein Fehler beim Bauen der Zeitreihe (kaputte Hitze): das Fenster rueckt trotzdem weiter, der Fehler kommt je Fenster einmal, nicht je Tick
    const echt = S3.g.telemetrie.ereignis;
    S3.g.telemetrie.ereignis = function (typ, f) { if (typ === 'zeitreihe') throw new Error('zeitreihe kaputt'); return echt.apply(this, arguments); };
    const e0 = S3.g.errors;
    S3.run(4.1);
    const fehlerJeFenster = S3.g.errors - e0;
    S3.g.telemetrie.ereignis = echt;
    S3.g.telemetrie.sessionBeenden('test');
    const zr4 = lesen(dr);
    const rf4 = zr4.filter((x) => x.typ === 'ruf');
    ok(rf4.length === 2 && rf4[0].fraktion === 'rom' && rf4[0].grund === 'sonst' && rf4[1].fraktion === 'rom' && rf4[1].grund === 'debug' && rf4[1].betrag === 5 && rf4[1].stand === 9, 'ruf: grund sonst (Ruf.aendern) und debug (Ruf.debug)');
    ok(fehlerJeFenster >= 1 && fehlerJeFenster <= 3, 'Fehler beim Bauen der Zeitreihe: ' + fehlerJeFenster + ' in 4,1 s (je Fenster einmal, nicht je Tick)');
  }

  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(fails ? `\n${fails} FEHLER` : '\nTELEMETRIE B2 OK');
  process.exit(fails ? 1 : 0);
})();
