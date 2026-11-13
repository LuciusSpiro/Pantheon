'use strict';
// WRK-01 A1: Beute an Wracks (server/sim/wrack-beute.js, Haken in anker.js case 'beute', Daten content/wrack-daten.json).
// Prise (Debug 'prise') und Wrack (welt.wracks): jeder beute-Anker legt dem Schiff bis zum Deckel eine Einheit Bergungsgut ins Lager, danach oeffnet er ohne Ware; volles Lager (auch Typ-Regel): Anker bleibt voll,
// Meldung nur an die Spielerin, kein Endlos-Halten; andere Karten (Eisenwald) unveraendert; zwei Spieler: eine Beute; Speichern/Laden; Verkauf am Hafen; Zahlen nur in den Daten.
//   node tools/test-wrack-beute.js
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const W = require('../server/world.js');
const away = require('../server/sim/away.js');
const space = require('../server/sim/space.js');
const Entern = require('../server/sim/entern.js');
const LP = require('../server/sim/landepunkte.js');
const Anker = require('../server/sim/anker.js');
const Interior = require('../server/sim/interior.js');
const Fracht = require('../server/sim/fracht.js');
const Ladung = require('../server/sim/ladung.js');
const WB = require('../server/sim/wrack-beute.js');
const Faden = require('../server/sim/faden.js');
const AO = require('../server/sim/abenteuer-orte.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const F = require('./regie-fixture.js');
const DATEN = require('../content/wrack-daten.json');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = async (t, f) => { console.log('\n' + t); try { await f(); } catch (e) { fails++; n++; console.log('  ABSTURZ ' + (e && e.stack)); } };
const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: '1' };
const tick = (k) => new Promise((r) => { let i = 0; const s = () => (++i >= (k || 3) ? r() : setImmediate(s)); setImmediate(s); });
const ART = DATEN.beute.art, JE = DATEN.beute.je_anker, DECKEL = DATEN.beute.deckel_je_wrack;

const lauf = (g, s) => { for (let k = 0; k < Math.round(s * CONFIG.tickHz); k++) g.step(); };
const lager = (g) => Fracht.lagerArten(g);
const anzahl = (g, art) => Fracht.anBord(g, art);
// Meldungen je Spielerin (game.notice), Broadcasts (ODA) und Missionsereignisse mitschreiben
function lausch(g) {
  const L = { notice: [], oda: 0, ev: [] };
  const n0 = g.notice.bind(g); g.notice = (p, text) => { L.notice.push({ pid: p.id, text }); return n0(p, text); };
  const o0 = g.oda.bind(g); g.oda = (t, k) => { L.oda++; return o0(t, k); };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { L.ev.push(nm); return m0(nm, d); };
  return L;
}
// Spiel, Prise per Debug, Crew unten (alle Spieler beamen)
async function prise(crew, seed) {
  const T = F.neuesSpiel({ crew, seed: seed || 7, env: ENV }); const g = T.g;
  space.enterScene(g, 'skjaldborg', { docked: false }); lauf(g, 0.5);
  g.onDebugQa(g.players[0], 'prise', { args: 'raider' }); lauf(g, 0.3); await tick(8);
  const id = 'skjaldborg.prise';
  g.chooseLandepunkt(g.players[0], id);
  away.executeBeam(g, g.players.map((p) => p.id), 'down'); lauf(g, 0.6);
  return { T, g, id, cs: T.cs };
}
const beuteAnker = (map) => W.AWAY_MAPS[map].karte.anker.filter((a) => a.rolle === 'beute');
const zst = (g, map, a) => Anker.zustand(g, map, a.id);
const stellen = (p, a) => { p.x = a.x * 32 + 16; p.y = a.y * 32 + 16; if (a.deck != null) p.deck = a.deck; };
// Spielerin auf die Kachel des Ankers stellen, E halten bis fertig (oder abgebrochen), E loslassen. -> { begann (Halten lief an), fertig (Zustand wechselte) }
function halten(g, p, map, a, sek) {
  stellen(p, a);
  const vor = zst(g, map, a);
  Interior.onAct(g, p, true);
  const begann = !!p.hold;
  for (let i = 0; i < (sek || 4) * CONFIG.tickHz; i++) { g.step(); if (!p.hold && begann) break; }
  Interior.onAct(g, p, false);
  return { begann, fertig: zst(g, map, a) !== vor };
}
const voll = (g) => { for (let i = 0; i < Fracht.capacity(g); i++) Fracht.lagerAufnehmen(g, { art: ART, quelle: 'debug' }); };

(async () => {
  await section('Prise: bis zum Deckel je Anker eine Einheit, danach ohne Ware', async () => {
    const S = await prise(1); const { g, id } = S; const p = g.players[0]; const L = lausch(g);
    ok(Entern.istPrise(g, id) && g.away && g.away.map === id, 'Crew steht auf der Prise (' + id + ')');
    const bs = beuteAnker(id); ok(bs.length >= 10 && bs.length <= 12, 'die Karte hat ' + bs.length + ' beute-Anker (10 bis 12, mehr als der Deckel)');
    ok(DECKEL >= 1 && JE >= 1 && ART === 'bergungsgut' && Fracht.capacity(g) === 4, 'Daten: ' + ART + ', je Anker ' + JE + ', Deckel ' + DECKEL + '; Startschiff 4 Plaetze');
    const m0 = g.inventory.marks;
    for (let i = 0; i < DECKEL; i++) {
      const r = halten(g, p, id, bs[i]);
      ok(r.begann && r.fertig && zst(g, id, bs[i]) === 'leer', 'Anker ' + (i + 1) + ': geoeffnet, leer');
      ok(anzahl(g, ART) === (i + 1) * JE, '  Lager: ' + anzahl(g, ART) + ' ' + ART);
    }
    ok(L.ev.filter((e) => e === 'beuteGeborgen').length === DECKEL, 'Ereignis beuteGeborgen je Anker (' + DECKEL + ')');
    ok(g.fracht.zugang.beute === DECKEL * JE, 'Zugang unter quelle beute gezaehlt (' + g.fracht.zugang.beute + ')');
    const nach = L.notice.length;
    const r = halten(g, p, id, bs[DECKEL]);
    ok(r.fertig && zst(g, id, bs[DECKEL]) === 'leer', 'weiterer Anker oeffnet sich und wird leer');
    ok(anzahl(g, ART) === DECKEL * JE, 'aber ohne Ware (Lager bleibt ' + anzahl(g, ART) + ')');
    ok(L.notice.slice(nach).some((x) => x.pid === p.id && x.text === DATEN.texte.nichts_mehr), 'Meldung "' + DATEN.texte.nichts_mehr + '" an die Spielerin');
    halten(g, p, id, bs[DECKEL + 1]);
    ok(anzahl(g, ART) === DECKEL * JE && zst(g, id, bs[DECKEL + 1]) === 'leer', 'noch ein Anker: weiter keine Ware');
    ok(g.inventory.marks === m0 && !g.inventory.erz, 'Marken und Inventar unveraendert (nur das Lager)');
    const sn = JSON.stringify(g.snapshot()).length; ok(sn <= 18944, 'Snapshot ' + sn + ' B <= 18944');
  });

  await section('Volles Lager: Anker bleibt voll, Meldung nur an die Spielerin, kein Endlos-Halten', async () => {
    const S = await prise(2); const { g, id, cs } = S; const p = g.players[0]; const L = lausch(g);
    const bs = beuteAnker(id);
    voll(g);
    ok(Fracht.freiFuer(g, ART) === 0, 'Lager voll (' + lager(g).length + '/' + Fracht.capacity(g) + ')');
    const inbox0 = cs[1].inbox.length;
    const r = halten(g, p, id, bs[0]);
    ok(!r.begann && zst(g, id, bs[0]) === 'voll', 'Halten beginnt gar nicht, Anker bleibt voll');
    stellen(p, bs[0]); Interior.onAct(g, p, true); lauf(g, 6); Interior.onAct(g, p, false);
    ok(zst(g, id, bs[0]) === 'voll' && !p.hold, 'E 6 s gedrueckt: Anker voll, kein Halten');
    ok(L.notice.length >= 1 && L.notice.length <= 12 && L.notice.every((x) => x.pid === p.id), 'Meldungen nur an die Spielerin (' + L.notice.length + ' Stueck, kein Endlosschleifen-Strom)');
    ok(L.ev.indexOf('beuteGeborgen') < 0 && anzahl(g, ART) === Fracht.capacity(g), 'kein Ereignis beuteGeborgen, Lager unveraendert');
    const msgs = cs[1].inbox.slice(inbox0).filter((m) => m.t === 'event' && m.kind === 'notice');
    ok(msgs.length === 0 && L.oda === 0, 'die Mitspielerin bekommt die Meldung nicht, keine ODA (' + msgs.length + ')');
    Fracht.debug(g, ['leer']);   // Platz schaffen: dann klappt es mit demselben Anker (die Beute war nicht verbrannt)
    const r2 = halten(g, p, id, bs[0]);
    ok(r2.fertig && zst(g, id, bs[0]) === 'leer' && anzahl(g, ART) === JE, 'nach Platzschaffen: derselbe Anker gibt seine Beute');
  });

  await section('Typ-Regel: anderes Gut im einzigen Modul', async () => {
    const S = await prise(1); const { g, id } = S; const p = g.players[0]; const L = lausch(g);
    const bs = beuteAnker(id);
    Fracht.lagerAufnehmen(g, { art: 'waffen', quelle: 'debug' });
    ok(Fracht.platzFuer(g, ART).grund === 'art_belegt' && Fracht.frei(g) === 3, 'Plaetze frei (3), aber das Modul gehoert den Waffen');
    const r = halten(g, p, id, bs[0]);
    ok(!r.begann && zst(g, id, bs[0]) === 'voll', 'Anker bleibt voll (Typ-Regel)');
    stellen(p, bs[0]); Interior.onAct(g, p, true); lauf(g, 1); Interior.onAct(g, p, false);
    ok(L.notice.length >= 1 && L.notice.every((x) => x.pid === p.id), 'Meldung an die Spielerin (' + L.notice.length + ')');
    ok(anzahl(g, ART) === 0 && anzahl(g, 'waffen') === 1, 'Lager unveraendert (Waffen bleiben, nichts verbrannt)');
    // Rennen: der Platz geht zwischen Start und Ende des Haltens verloren -> completeHold meldet, Anker bleibt voll
    Fracht.debug(g, ['leer']);
    stellen(p, bs[1]); Interior.onAct(g, p, true); lauf(g, 0.5);
    ok(!!p.hold, 'Halten laeuft (Lager frei)');
    const vorher = L.notice.length;
    Fracht.lagerAufnehmen(g, { art: 'waffen', quelle: 'debug' });
    for (let i = 0; i < 4 * CONFIG.tickHz && p.hold; i++) g.step();
    Interior.onAct(g, p, false);
    ok(zst(g, id, bs[1]) === 'voll' && anzahl(g, ART) === 0, 'Platz mitten im Halten verloren: Anker bleibt voll, nichts verbrannt');
    ok(L.notice.length > vorher && L.notice.every((x) => x.pid === p.id), 'die Spielerin wird informiert');
  });

  await section('Zwei Spieler am selben Anker: nur eine Beute', async () => {
    const S = await prise(2); const { g, id } = S; const [p, q] = g.players; const bs = beuteAnker(id);
    ok(q.zone === 'away' && p.zone === 'away', 'beide unten');
    stellen(p, bs[0]); stellen(q, bs[0]);
    Interior.onAct(g, p, true); Interior.onAct(g, q, true);
    ok(!!p.hold && !!q.hold, 'beide halten');
    for (let i = 0; i < 4 * CONFIG.tickHz && (p.hold || q.hold); i++) g.step();
    Interior.onAct(g, p, false); Interior.onAct(g, q, false);
    ok(zst(g, id, bs[0]) === 'leer', 'Anker leer');
    ok(anzahl(g, ART) === JE, 'genau eine Beute im Lager (' + anzahl(g, ART) + ')');
    halten(g, q, id, bs[1]);
    ok(anzahl(g, ART) === 2 * JE, 'Beute der Mitspielerin landet im selben Schiffslager (' + anzahl(g, ART) + ')');
  });

  await section('Andere Karten unveraendert (Eisenwald: Kampagnenkarte mit beute-Anker)', async () => {
    const T = F.neuesSpiel({ crew: 1, seed: 7, env: ENV }); const g = T.g; const p = g.players[0];
    const MAP = 'splitter.eisenwald';
    ok(!WB.istWrackOrt(g, MAP) && !WB.istWrackOrt(g, 'skjaldborg.prise'), 'istWrackOrt: Eisenwald nein, Prise (ohne Prise im Spiel) nein');
    LP.get(g, MAP); const k = W.AWAY_MAPS[MAP] && W.AWAY_MAPS[MAP].karte; const b = k && k.anker.find((a) => a.rolle === 'beute');
    ok(!!b, 'Eisenwald hat einen beute-Anker');
    g.transferZiel = { lp: MAP, scene: g.ship.scene }; g.setAwayMap(MAP);
    away.executeBeam(g, [p.id], 'down'); lauf(g, 0.6);
    const L = lausch(g); const l0 = lager(g).length; const z0 = JSON.stringify(g.fracht && g.fracht.zugang);
    const r = halten(g, p, MAP, b);
    ok(r.fertig && zst(g, MAP, b) === 'leer', 'Anker oeffnet wie bisher und wird leer');
    ok(lager(g).length === l0 && JSON.stringify(g.fracht && g.fracht.zugang) === z0, 'Lager und Zugangszaehler unveraendert');
    ok(L.ev.filter((e) => e === 'beuteGeborgen').length === 1 && L.notice.length === 0, 'Ereignis beuteGeborgen, keine Meldung (wie vorher)');
    voll(g);   // volles Lager aendert dort nichts: der Anker geht trotzdem auf
    const b2 = k.anker.find((a) => a.rolle === 'beute' && zst(g, MAP, a) === 'voll');
    if (b2) { const r2 = halten(g, p, MAP, b2); ok(r2.begann && r2.fertig && L.notice.length === 0, 'volles Lager: Anker oeffnet trotzdem, keine Meldung'); } else ok(true, '(nur ein beute-Anker, Fall uebersprungen)');
  });

  await section('Wrack (welt.wracks): Zustand bleibt, Deckel zaehlt weiter; Speichern und Laden', async () => {
    const S = await prise(1); const { g, id } = S; const p = g.players[0];
    const bs = beuteAnker(id);
    halten(g, p, id, bs[0]); halten(g, p, id, bs[1]);
    ok(anzahl(g, ART) === 2 * JE, 'zwei Anker geleert, ' + anzahl(g, ART) + ' im Lager');
    away.executeBeam(g, [p.id], 'up'); lauf(g, 0.6);
    Entern.merken(g, null); space.enterScene(g, 'carrara', { docked: false }); lauf(g, 0.5);
    const w = (Entern.toSave(g)[0] || {}).lpId;
    ok(w === 'skjaldborg.wrack-1', 'Prise wurde zum Wrack ' + w);
    space.enterScene(g, 'skjaldborg', { docked: false }); lauf(g, 0.5); await tick(8);
    ok(g.chooseLandepunkt(p, w) == null, 'Wrack waehlbar');
    away.executeBeam(g, [p.id], 'down'); lauf(g, 0.6);
    const bw = W.AWAY_MAPS[w].karte.anker.filter((a) => a.rolle === 'beute');
    const leer = bw.filter((a) => zst(g, w, a) === 'leer').length;
    ok(leer === 2, 'Wrack traegt die zwei geleerten Anker (' + leer + ')');
    ok(WB.istWrackOrt(g, w), 'istWrackOrt: Wrack ja');
    halten(g, p, w, bw.find((a) => zst(g, w, a) === 'voll'));
    ok(anzahl(g, ART) === Math.min(DECKEL, 3) * JE && anzahl(g, ART) === 3 * JE, 'dritter Anker am Wrack gibt die letzte Einheit (' + anzahl(g, ART) + ')');
    halten(g, p, w, bw.find((a) => zst(g, w, a) === 'voll'));
    ok(anzahl(g, ART) === DECKEL * JE, 'vierter: Deckel gilt ueber das Wrack hinweg');
    const cap = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    ok(cap.version === 3 && Weltstand.validate(cap).length === 0, 'Weltstand Version 3, schemagueltig' + Weltstand.validate(cap).slice(0, 1).map((x) => ' - ' + x).join(''));
    const blk = cap.welt.landepunkte && cap.welt.landepunkte[w];
    ok(!!blk && Object.values(blk.zustaende || {}).filter((z) => z === 'leer').length === 4, 'Weltstand traegt die 4 geleerten Anker des Wracks');
    const g2 = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    Weltstand.apply(g2, cap);
    const aw2 = LP.get(g2, w); const b2 = W.AWAY_MAPS[w].karte.anker.filter((a) => a.rolle === 'beute');
    ok(b2.filter((a) => aw2.zustaende[a.id] === 'leer').length === 4 && b2.filter((a) => (aw2.zustaende[a.id] || 'voll') === 'voll').length === b2.length - 4, 'nach dem Laden: 4 Anker leer, Rest voll');
    ok(anzahl(g2, ART) === DECKEL * JE, 'Lager nach dem Laden: ' + anzahl(g2, ART));
    ok(WB.istWrackOrt(g2, w) && WB.hindernis(g2, w) == null, 'nach dem Laden: weiter Wrack, Deckel erreicht (kein Hindernis)');
  });

  await section('Faden-Ort (bestellenAmPunkt, Karten-ID <ort>.<faden>-ort): gleiche Regeln', async () => {
    const T = F.neuesSpiel({ crew: 1, seed: 7, env: ENV }); const g = T.g; const p = g.players[0];
    const Fz = Faden.zustandVon(g); Fz.abenteuerAngebote = [];
    const plan = { format: 'faden-bauplan/1', titel: 'Wrack', anlass: 'Ein Wrack treibt im Sektor.', beats: [{ typ: 'bitte', optionen: true, verzweigung: { gescheitert: 'ende' } }, { typ: 'notruf' }, { id: 'ende', typ: 'abschluss' }] };
    const a = Faden.abenteuerAnbieten(g, plan, { hex: require('../server/sim/marken.js').hexVon(g.ship.scene) });
    const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {}); const f = r.faden;
    space.enterScene(g, 'skjaldborg', { docked: false }); lauf(g, 0.3);
    const id = AO.bestellenAmPunkt(g, f.id, { ort: 'skjaldborg', x: 1500, y: 900, art: 'schiff', besitz: 'raubzug', name: 'Wrack' });
    await tick(8);
    const bm = LP.info(g, id).beam; const s = g.ship; s.docked = false; s.dockedAt = null; s.x = bm.x + 20; s.y = bm.y; s.vx = s.vy = 0; s.speed = 0; lauf(g, 0.2);
    ok(!!AO.parse(id) && WB.istWrackOrt(g, id) && !Entern.frei(g, id), 'Faden-Ort ' + id + ' zaehlt als Wrack-Ort (nicht ueber Entern)');
    g.chooseLandepunkt(p, id); away.executeBeam(g, [p.id], 'down'); lauf(g, 0.6);
    const bs = beuteAnker(id);
    for (let i = 0; i < DECKEL + 1; i++) halten(g, p, id, bs[i]);
    ok(anzahl(g, ART) === DECKEL * JE && zst(g, id, bs[DECKEL]) === 'leer', 'Lager bis zum Deckel (' + anzahl(g, ART) + '), der Anker danach ohne Ware leer');
  });

  await section('Beute -> Lager -> Verkauf am Hafen', async () => {
    const S = await prise(1); const { g, id } = S; const p = g.players[0]; const bs = beuteAnker(id);
    for (let i = 0; i < DECKEL; i++) halten(g, p, id, bs[i]);
    const ware = anzahl(g, ART); ok(ware === DECKEL * JE, 'Beute im Lager: ' + ware);
    const T2 = F.neuesSpiel({ crew: 1, seed: 7, env: ENV }); const g2 = T2.g; const p2 = g2.players[0];   // Hafen: Startort des Spiels (angedockt)
    const l = Fracht.lagerAufnehmen(g2, { art: ART, quelle: 'beute' }); for (let i = 1; i < ware; i++) Fracht.lagerAufnehmen(g2, { art: ART, quelle: 'beute' });
    ok(l.ok && anzahl(g2, ART) === ware, 'dieselbe Ware im Lager des Hafen-Spiels');
    const hafen = Ladung.hafenVon(g2); const preis = Ladung.preisFuer(g2, hafen, ART);
    const m0 = g2.inventory.marks; p2.console = 'weapons';
    const v = Ladung.verkaufStart(g2, p2); lauf(g2, 4 + ware);
    ok(g2.inventory.marks - m0 === preis * ware && anzahl(g2, ART) === 0, 'Verkauf: ' + ware + ' x ' + preis + ' = ' + (g2.inventory.marks - m0) + ' Marken, Lager leer (verkaufStart ' + JSON.stringify(v) + ')');
  });

  await section('Zahlen und Namen nur in content/wrack-daten.json (Quelltext-Scan)', () => {
    const q = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'wrack-beute.js'), 'utf8').split('\n').map((z) => z.replace(/\/\/.*$/, '')).join('\n');
    ok(!/bergungsgut|waffen|erz\b/.test(q), 'keine Warenart im Servercode');
    ok(!/[^\w.]([1-9]\d*|0\d+)(?![\w])/.test(q), 'kein Zahlenliteral ausser 0 im Servercode');
    ok(!/Nichts mehr von Wert/.test(q), 'Meldungstext steht in den Daten');
    const a = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'anker.js'), 'utf8');
    ok(/Wrack\.beuteBergen\(game, map\)/.test(a) && !/bergungsgut/.test(a), 'anker.js ruft nur beuteBergen (keine Art im Haken)');
  });

  console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alles ok (' + n + ')'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
