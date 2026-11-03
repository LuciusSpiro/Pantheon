'use strict';
// BOD-03 B4/B5/C4: N Wellen in graben.js, Welle 3 im Bunker, Deck-Bindung der Gegner (Link-Filter), Tick-Zeit mit unerreichbarem Ziel. Headless, echtes Szenario.
//  - B4 Wellen: aktive Welle über N Wellen, Zielregel in EINER Funktion (Ziel öffnet, wenn Welle 2 oben besiegt ist, Welle 3 unten zählt nicht), Zielzeile nennt
//    Welle 3, neuBeginnen stellt Welle 3 wieder auf, HUD ohne Terminal-/Kisten-/Sprengpunkt-Zähler (aw.ohneZaehler -> awaySnap oz)
//  - B5 Welle 3: Größe und Rollen wie Welle 2, verteilt auf Reaktorraum, Halle, Nordgang, ruhig an den Plätzen; Messung Solo, 2, 4 Spieler (Ausgabe "Messung")
//  - C4 Link-Filter: Welle 2 (und 1) zählt in 60 s keinen Gegner auf Deck 1, Welle 3 keinen auf Deck 0 (trotz Spieler oben, Alarm), der Rohr-Link wird nie
//    genommen, ein Alarm oben zieht Welle 3 nicht hoch; Gegenproben ohne Bindung (ein Trupp ohne Deck-Bindung fährt weiterhin über den Lift)
//  - Tick-Zeit: Ziel auf dem fremden Deck (Welle 3 unten, Spieler oben) kostet keine Flutsuche (Erkundung BOD-03 A0: p95 ~60 ms über dem Budget von 33,3 ms)
//   node tools/test-bunker-wellen.js
const CONFIG = require('../shared/config.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const Anker = require('../server/sim/anker.js');
const Wellen = require('../server/sim/wellen.js');
const Graben = require('../server/sim/graben.js');
const W = require('../server/world.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const fehlerZahl = (g) => (Array.isArray(g.errors) ? g.errors.length : g.errors | 0);
const tile = (o) => Physics.toTile(o.x, o.y);
const anker = (K, id) => K.anker.find((a) => a.id === id);

function start(np, o) {
  o = o || {};
  const g = new Game({ noStore: true, seed: o.seed || 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 2000) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'W' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_graben' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const S = g.arena.wellen, aw = g.aways[S.lp], K = W.AWAY_MAPS[S.lp].karte, stride = K.decks.stride;
  const welle = (nr) => aw.drones.filter((e) => e.tag === Wellen.TAG && S.ids[nr].includes(e.id));
  const deck = (e) => Math.floor(tile(e).y / stride);
  const platz = (p, x, y) => { const c = Physics.tileCenter(x, y); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; };
  // läuft sek Sekunden, die Spieler sind unverwundbar; fn(tick) je Tick (Messung)
  const laufe = (sek, fn) => { for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) { for (const p of g.players) { if (p.shield) p.shield.seg = 3; p.downed = false; p.hp = 100; } g.step(); if (fn) fn(i); } };
  const neben = (e, a) => { const c = Physics.tileCenter(a.x - 1, a.y); e.x = c.x; e.y = c.y; };   // Gegner neben einen Anker stellen
  const squadsVon = (nr) => [...new Set(welle(nr).map((e) => e.squad))].map((nm) => aw.squads[nm]);
  const alarmiere = (nr) => { for (const s of squadsVon(nr)) squad.alertSquad(g, aw, s); };
  return { g, cs, S, aw, K, stride, welle, deck, platz, laufe, squadsVon, alarmiere, neben };
}

section('B4 Wellen: aktive Welle, Zielregel in einer Funktion, Zielzeile, Neubeginn', () => {
  const { g, S, aw, K, welle, deck } = start(2);
  ok(Object.keys(S.ids).join() === '1,2,3' && S.n === 1, 'drei Wellen (1,2,3), aktive Welle 1');
  ok(JSON.stringify(S.deckVon) === '{"1":0,"2":0,"3":1}', 'Deck je Welle: 1 und 2 oben (0), 3 im Bunker (1)');
  const fall = (ids) => { for (const e of aw.drones) if (ids.includes(e.id)) for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(g, e, 99, { x: e.x - 40, y: e.y }); };
  fall(S.ids[1]); ticks(g, 1);
  ok(S.n === 2 && S.ziel === 'gesperrt', 'Welle 1 besiegt: aktive Welle 2, Ziel gesperrt');
  fall(S.ids[2]); ticks(g, 1);
  ok(S.n === 3 && S.ziel === 'offen', 'Welle 2 besiegt: aktive Welle 3 (Bunker lebt), das Ziel öffnet trotzdem (Zielregel wie bisher: Oberfläche)');
  ok(welle(3).every((e) => e.alive), 'Welle 3 lebt');
  const zeile = ((g.snapshot().mission || {}).objectives || []).map((o) => o.text).join(' | ');
  fall(S.ids[3]); ticks(g, 1);
  ok(S.n === 3 && welle(3).every((e) => !e.alive), 'alle drei Wellen besiegt: aktive Welle bleibt 3');
  // Zielzeile mit Welle 3 (im Kampf, vor dem Öffnen)
  const b = start(1);
  const z2 = ((b.g.snapshot().mission || {}).objectives || []).map((o) => o.text).join(' | ');
  b.g.step();
  const z = ((b.g.snapshot().mission || {}).objectives || []).map((o) => o.text).join(' | ');
  ok(z === 'Rom besiegen: Graben 3 · Wald und Eingang 3 · Bunker 3' || /Bunker 3/.test(z2), 'Zielzeile nennt Welle 3: ' + (z || z2));
  ok(Graben.zeile(b.g, b.S) === 'Rom besiegen: Graben 3 · Wald und Eingang 3 · Bunker 3', 'zeile_kampf3: ' + Graben.zeile(b.g, b.S));
  // Neubeginn: Welle 3 steht wieder auf den Anfangsplätzen
  const c = start(2);
  const pos0 = c.welle(3).map((e) => e.rolle + '@' + tile(e).x + ',' + tile(e).y).sort().join(';');
  for (const e of c.aw.drones) if (c.S.ids[3].includes(e.id)) for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(c.g, e, 99, { x: e.x - 40, y: e.y });
  ticks(c.g, 1);
  ok(c.welle(3).length === 0 || c.welle(3).every((e) => !e.alive), 'Welle 3 besiegt (Vorbereitung des Neubeginns)');
  ok(Graben.debug(c.g, 'reset') === null && c.S.versuch === 2, 'Neubeginn');
  const w3 = c.welle(3);
  ok(w3.length === 4 && w3.every((e) => e.alive) && w3.map((e) => e.rolle + '@' + tile(e).x + ',' + tile(e).y).sort().join(';') === pos0, 'Welle 3 nach dem Neubeginn: 4 Gegner wieder auf den Anfangsplätzen');
  ok(c.squadsVon(3).every((s) => s.deckBindung === 1) && c.squadsVon(1).concat(c.squadsVon(2)).every((s) => s.deckBindung === 0), 'Deck-Bindung nach dem Neubeginn wieder gesetzt');
  ok(fehlerZahl(g) === 0 && fehlerZahl(c.g) === 0, 'keine Fehler');
});

section('HUD-Zähler: Station-Anker erzeugen keine Zähler (aw.ohneZaehler)', () => {
  const { g, aw, S } = start(2);
  ok(aw.ohneZaehler === true, 'graben.start setzt aw.ohneZaehler');
  ok(Anker.awaySnap(g, aw).oz === 1, 'awaySnap trägt oz: 1 (Client blendet „Terminal 0/2, Kiste 0/3, Sprengpunkt 0/1, Zelle 0/2“ aus)');
  g.step(); ok(g.snapshot().away.oz === 1, 'Snapshot away.oz = 1 (Client: hud.js und consoles.js zeigen die Zähler nicht)');
});

section('B5 Welle 3: Besetzung Solo, 2, 4 Spieler (Messung)', () => {
  const erwartet = { 1: { w: [6, 3, 3], r: { grundtyp: 2, schuetze: 1 } }, 2: { w: [9, 4, 4], r: { grundtyp: 2, grenadier: 1, schuetze: 1 } }, 4: { w: [16, 8, 8], r: { grundtyp: 4, grenadier: 1, schuetze: 2, niederhalter: 1 } } };
  for (const np of [1, 2, 4]) {
    const { g, S, aw, K, welle, deck, stride } = start(np);
    const zaehl = (arr) => arr.reduce((m, e) => { m[e.rolle] = (m[e.rolle] || 0) + 1; return m; }, {});
    const w1 = welle(1).concat(welle(2)), w2 = welle(2), w3 = welle(3);
    const raum = {};
    for (const e of w3) { const s = aw.squads[e.squad]; raum[s.gruppe] = (raum[s.gruppe] || 0) + 1; }
    const E = erwartet[np];
    console.log(`  Messung ${np} Spieler: Welle 1 ${welle(1).length}, Welle 2 ${w2.length}, Welle 3 ${w3.length}; Welle 3 je Gruppe ${JSON.stringify(raum)}; Rollen ${JSON.stringify(zaehl(w3))}; gesamt ${S.gesamt}`);
    ok(welle(1).length + w2.length === E.w[0] && w3.length === E.w[1] && w3.length === w2.length, `${np} Spieler: Welle 1+2 = ${E.w[0]} wie bisher, Welle 3 = ${E.w[1]} (so groß wie Welle 2)`);
    ok(JSON.stringify(zaehl(w3)) === JSON.stringify(zaehl(w2)) || Object.keys(E.r).every((r) => zaehl(w3)[r] === E.r[r] && zaehl(w2)[r] === E.r[r]), `${np} Spieler: Rollen wie Welle 2 ${JSON.stringify(E.r)}`);
    ok(Object.keys(raum).length === 3 && w3.every((e) => deck(e) === 1), `${np} Spieler: Welle 3 verteilt auf ${Object.keys(raum).length} Gruppen, alle auf Deck 1`);
    ok(w3.every((e) => { const s = aw.squads[e.squad]; return !s.alert && s.schleich && e.fraktion === 'rom' && e.palette === 'rom'; }), `${np} Spieler: Welle 3 startet ruhig (schleich), römisch`);
    const pos0 = w3.map((e) => e.x + ',' + e.y).join(';');
    ticks(g, 20);
    ok(welle(3).map((e) => e.x + ',' + e.y).join(';') === pos0 && fehlerZahl(g) === 0, `${np} Spieler: nach 20 s stehen sie an ihren Plätzen (ruhig), keine Fehler`);
    const reaktor = anker(K, 'bk.reaktor.sprengpunkt');
    if (np >= 2) ok(w3.some((e) => Math.abs(tile(e).x - reaktor.x) <= 6 && Math.abs(tile(e).y - reaktor.y) <= 6), `${np} Spieler: der Reaktorraum (Sprengpunkt) ist besetzt`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
section('C4 Welle 1 und 2 oben: kein Gegner auf Deck 1 in 60 s (Spieler im Bunker, alle alarmiert)', () => {
  const { g, S, aw, K, welle, deck, platz, laufe, alarmiere, squadsVon } = start(2);
  const lu = anker(K, 'bunker.lift.unten');
  g.players.forEach((p, i) => platz(p, lu.x - 1 - i, lu.y));
  alarmiere(1); alarmiere(2);
  let maxUnten = 0; let alle = 0;
  laufe(60, (i) => { if (i % 15 === 0) { const u = welle(1).concat(welle(2)).filter((e) => e.alive && deck(e) === 1).length; maxUnten = Math.max(maxUnten, u); alle++; } });
  ok(maxUnten === 0, `Zähler über 60 s (${alle} Messpunkte): höchstens ${maxUnten} Gegner der Wellen 1 und 2 auf Deck 1`);
  ok(welle(2).some((e) => e.alive) && fehlerZahl(g) === 0, 'Welle 2 lebt, keine Fehler');
  // Gegenprobe: ohne Deck-Bindung fährt ein alarmierter Trupp über den Lift hinunter (der Test ist empfindlich)
  const b = start(2);
  b.g.players.forEach((p, i) => b.platz(p, lu.x - 1 - i, lu.y));
  for (const s of b.squadsVon(2)) delete s.deckBindung;
  b.alarmiere(2);
  let u = 0; b.laufe(60, (i) => { if (i % 15 === 0) u = Math.max(u, b.welle(2).filter((e) => e.alive && b.deck(e) === 1).length); });
  ok(u > 0, `Gegenprobe ohne Deck-Bindung: Welle 2 steht in 60 s auf Deck 1 (${u} Gegner) – wie vor BOD-03`);
});

section('C4 Welle 3 unten: kein Gegner auf Deck 0 in 60 s (Spieler oben, Alarm)', () => {
  const { g, S, aw, K, welle, deck, platz, laufe, alarmiere, neben } = start(4);
  const lo = anker(K, 'bunker.lift.oben'), ro = anker(K, 'rohr.oben'), lu = anker(K, 'bunker.lift.unten');
  neben(welle(3)[0], lu); neben(welle(3)[1], lu);   // zwei Gegner stehen am Lift unten (frei, ohne Türen davor)
  g.players.forEach((p, i) => platz(p, i % 2 ? lo.x - 1 - (i >> 1) : ro.x + 1 - (i >> 1), i % 2 ? lo.y : ro.y + 1));   // oben am Lift und am Rohr
  alarmiere(3);
  let max0 = 0, minUnten = 99; let alle = 0;
  laufe(60, (i) => { if (i % 15 === 0) { const w = welle(3).filter((e) => e.alive); max0 = Math.max(max0, w.filter((e) => deck(e) === 0).length); minUnten = Math.min(minUnten, w.filter((e) => deck(e) === 1).length); alle++; } });
  ok(max0 === 0 && minUnten === 8, `Zähler über 60 s (${alle} Messpunkte): höchstens ${max0} Gegner der Welle 3 auf Deck 0, immer ${minUnten} von 8 unten`);
  ok(fehlerZahl(g) === 0, 'keine Fehler');
  const b = start(4);
  b.g.players.forEach((p, i) => b.platz(p, lo.x - 1 - i, lo.y));
  b.neben(b.welle(3)[0], lu); b.neben(b.welle(3)[1], lu);
  for (const s of b.squadsVon(3)) delete s.deckBindung;
  b.alarmiere(3);
  let u = 0; b.laufe(60, (i) => { if (i % 15 === 0) u = Math.max(u, b.welle(3).filter((e) => e.alive && b.deck(e) === 0).length); });
  ok(u > 0, `Gegenprobe ohne Deck-Bindung: Welle 3 kommt in 60 s nach oben (${u} Gegner) – wie vor BOD-03`);
});

section('C4 Rohr: Gegner im Kriechgang erreichen die Oberfläche nicht über das Rohr', () => {
  const { g, S, aw, K, welle, deck, platz, laufe, alarmiere, squadsVon } = start(2);
  const ro = anker(K, 'rohr.oben'), ru = anker(K, 'rohr.unten');
  g.players.forEach((p, i) => platz(p, ro.x + 1, ro.y + i));
  // ein Gegner der Welle 3 steht im Kriechgang am Rohr-Ende
  const e = welle(3)[0]; const c = Physics.tileCenter(ru.x, ru.y); e.x = c.x; e.y = c.y;
  alarmiere(3);
  let max0 = 0; laufe(60, (i) => { if (i % 15 === 0) max0 = Math.max(max0, welle(3).filter((q) => q.alive && deck(q) === 0).length); });
  ok(max0 === 0 && deck(e) === 1 && fehlerZahl(g) === 0, `Gegner im Kriechgang, Spieler oben am Rohr, alarmiert: nach 60 s auf Deck ${deck(e)}, nie auf Deck 0`);
  // Linkfilter selbst: auch ein Trupp, dessen Bindung das Deck 0 erlaubt (Lift hinauf ok), nimmt das Rohr nie
  const E = combat.env(g); E.walk = (x, y) => !E.solid(x, y);
  const s0 = squadsVon(3)[0]; s0.deckBindung = 0;
  const f = welle(3)[1]; const cc = Physics.tileCenter(ru.x, ru.y); f.x = cc.x; f.y = cc.y; f.squad = s0.name;
  const ziel = { x: ro.x + 2, y: ro.y };
  const pfad = squad.gegnerWeg(g, E, f, E.walk, tile(f), (x, y) => x === ziel.x && y === ziel.y, ziel);
  ok(pfad === null, 'Bindung Deck 0, Gegner im Kriechgang: kein Pfad nach oben, das Rohr nimmt er nie (obwohl das Deck erlaubt wäre)');
  const lu = anker(K, 'bunker.lift.unten'), cl = Physics.tileCenter(lu.x - 1, lu.y); f.x = cl.x; f.y = cl.y;
  const pfad2 = squad.gegnerWeg(g, E, f, E.walk, tile(f), (x, y) => x === ziel.x && y === ziel.y, ziel);
  ok(pfad2 && pfad2.some((st) => st.via === 'lift') && !pfad2.some((st) => st.via === 'leiter'), 'Bindung Deck 0, Gegner im Liftraum: der Pfad nach oben führt über den Lift (' + (pfad2 ? pfad2.filter((st) => st.via).map((st) => st.via).join() : 'kein Pfad') + ')');
  f.x = cc.x; f.y = cc.y;
  s0.deckBindung = 1;
  ok(squad.gegnerWeg(g, E, f, E.walk, tile(f), (x, y) => x === ziel.x && y === ziel.y, ziel) === null, 'Bindung Deck 1: kein Weg zu einem Ziel auf Deck 0');
  // Trupp ohne Bindung: unverändert alle Links (Lift und Rohr)
  delete s0.deckBindung;
  const frei = squad.gegnerWeg(g, E, f, E.walk, tile(f), (x, y) => x === ziel.x && y === ziel.y, ziel);
  ok(frei && frei.some((st) => st.via), 'Trupp ohne Bindung: Pfad über die Deck-Links wie bisher (' + (frei ? frei.filter((st) => st.via).map((st) => st.via).join() : 'kein Pfad') + ')');
});

section('Alarm oben zieht Welle 3 unten nicht hoch (Funk und Lärm über das Deck)', () => {
  const { g, S, aw, K, welle, squadsVon, laufe, platz, stride } = start(2);
  const lo = anker(K, 'bunker.lift.oben');
  g.players.forEach((p, i) => platz(p, lo.x - 1 - i, lo.y));
  const nord = anker(K, 'bk.gang_3.wache');
  // ein Trupp oben meldet die Crew an einer Stelle genau über der Nordgruppe des Bunkers (17 Kacheln darunter, innerhalb des Funkradius 20)
  const x = nord.x * 32 + 16, y = 33 * 32 + 16;   // Oberfläche (76,33): 17 Kacheln über der Nordgruppe (76,50)
  const s1 = squadsVon(1)[0];
  squad.alarmiere(g, aw, s1, x, y, 'sicht');
  laufe(10);
  ok(s1.alert && squadsVon(3).every((s) => !s.alert), 'Trupp oben alarmiert, Funk über dem Bunker: Welle 3 bleibt ruhig (' + squadsVon(3).map((s) => s.name + ':' + s.alert).join(' ') + ')');
  const b = start(2);
  b.g.players.forEach((p, i) => b.platz(p, lo.x - 1 - i, lo.y));
  for (const s of b.squadsVon(3)) delete s.deckBindung;
  squad.alarmiere(b.g, b.aw, b.squadsVon(1)[0], x, y, 'sicht');
  b.laufe(10);
  ok(b.squadsVon(3).some((s) => s.alert), 'Gegenprobe ohne Deck-Bindung: derselbe Funk weckt Welle 3 (der Filter wirkt)');
});

section('Tick-Zeit: Ziel auf fremdem Deck kostet keine Flutsuche (4 Spieler oben, Welle 3 alarmiert unten)', () => {
  const { g, aw, K, welle, deck, platz, laufe, alarmiere } = start(4);
  const lo = anker(K, 'bunker.lift.oben');
  g.players.forEach((p, i) => platz(p, lo.x - 1 - i, lo.y));
  alarmiere(3);
  const ms = [];
  laufe(5);   // Einschwingen
  laufe(20, () => {});
  const budget = 1000 / CONFIG.tickHz;
  // Messung Tickzeit
  for (let i = 0; i < 20 * CONFIG.tickHz; i++) {
    for (const p of g.players) { if (p.shield) p.shield.seg = 3; p.downed = false; p.hp = 100; }
    for (const nm of Object.keys(aw.squads)) { const s = aw.squads[nm]; if (s && s.tag === Wellen.TAG && s.deckBindung === 1) for (const p of g.players) s.lastKnown[p.id] = { x: p.x, y: p.y, t: g.time }; }   // wie die Messung der Erkundung: das Ziel bleibt bekannt
    const t0 = process.hrtime.bigint(); g.step(); ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const s = ms.slice().sort((a, b) => a - b); const med = s[Math.floor(s.length * 0.5)], p95 = s[Math.floor(s.length * 0.95)];
  console.log(`  Messung: step Median ${med.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${s[s.length - 1].toFixed(1)} ms (Budget ${budget.toFixed(1)} ms)`);
  ok(p95 < budget, `p95 ${p95.toFixed(2)} ms unter dem Tick-Budget ${budget.toFixed(1)} ms`);
  ok(welle(3).filter((e) => e.alive).every((e) => deck(e) === 1) && fehlerZahl(g) === 0, 'Welle 3 weiter unten, keine Fehler');
});

console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
