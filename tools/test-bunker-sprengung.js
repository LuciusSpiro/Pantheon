'use strict';
// BOD-03 Paket C (C1, C2, C3, C5, C6): Sprengung als Ziel, Warnsignal, Nachschub, Sieg, Pad end-to-end. Headless, echtes Szenario (Lobby-Start arena_graben).
//  - C1 Ziel: die Crew startet mit EINER Ladung, Zünden = E halten (4 s) am Sprengpunkt im Reaktorraum, Countdown 60 s, Knall -> S.ziel erreicht (nicht schon das Zünden);
//    der alte Oberflächen-Anker meta.ziel (Bunkereingang) ist still (Hinweis, Halten wirkt nicht); Zielzeile „Sprengladung im Reaktorraum zünden“, danach „Zurück zum Pad“
//  - C2 Warnsignal: Ereignis nachschub, Ton alarm_yellow, ODA „ALARM – Nachschub kommt“ – nach dem Knall, einmal; kein Timer (120 s danach: keine Niederlage)
//  - C3 Nachschub: genau EINMAL vier Mann Sturmgewehr (grundtyp) oben nahe dem Lift (nicht auf Pad und Lift), alarmiert, Deck-Bindung 0; Replays lösen nichts neu aus
//  - Lift nach der Sprengung NICHT gesperrt (Fahrt hinunter und zurück, mit Nachschub oben)
//  - C5 Sieg: Sprengung erfolgt UND alle Spieler nicht mehr unten (2 und 4 Spieler, einer noch unten: kein Sieg); ohne Sprengung bringt das Pad keinen Sieg
//  - C6 Pad: Hochbeamen am Pad des Bunkereingangs im echten Spielweg (E halten auf dem Pad -> canBeam -> Beamzeit -> an Bord), Gegenproben (Transfer zerstört, Schiff zu weit)
//  - Neubeginn nach der Sprengung: Bunker-Wellen, Sprengpunkt intakt, Nachschub-Auslöser, Ladung 1; danach wieder genau einmal Nachschub
//   node tools/test-bunker-sprengung.js
const CONFIG = require('../shared/config.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const interior = require('../server/sim/interior.js');
const Anker = require('../server/sim/anker.js');
const Wellen = require('../server/sim/wellen.js');
const Graben = require('../server/sim/graben.js');
const W = require('../server/world.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const fehlerZahl = (g) => (Array.isArray(g.errors) ? g.errors.length : g.errors | 0);
const tile = (o) => Physics.toTile(o.x, o.y);
const SP = 'bk.reaktor.sprengpunkt';

function start(np, o) {
  o = o || {};
  const g = new Game({ noStore: true, seed: o.seed || 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'X' + i, name: 'X' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_graben' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const S = g.arena.wellen, aw = g.aways[S.lp], K = W.AWAY_MAPS[S.lp].karte, stride = K.decks.stride;
  const anker = (id) => K.anker.find((a) => a.id === id);
  const ev = [], oda = [];
  const emit = g.emit; g.emit = function (t, d) { ev.push([t, d]); return emit.apply(this, arguments); };
  const odaF = g.oda; g.oda = function (txt) { oda.push(String(txt)); return odaF.apply(this, arguments); };
  const platz = (p, x, y) => { const c = Physics.tileCenter(x, y); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; };
  const am = (p, id) => { const a = anker(id); platz(p, a.x, a.y); };
  // läuft sek Sekunden, die Spieler sind unverwundbar (Treffer ändern den Ablauf nicht)
  const laufe = (sek, fn) => { for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) { for (const p of g.players) { if (p.zone !== 'away') continue; if (p.shield) p.shield.seg = 3; p.downed = false; p.hp = 100; } g.step(); if (fn) fn(i); } };
  const send = (i, m) => g.handleMessage(cs[i], m);
  const faellen = (ids) => { for (const e of aw.drones) if (ids.includes(e.id)) for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(g, e, 99, { x: e.x - 40, y: e.y }); };
  const nachschub = () => aw.drones.filter((e) => e.squad === 'graben.nachschub');
  const deck = (e) => Math.floor(tile(e).y / stride);
  const evN = (name) => ev.filter((e) => e[0] === name).length;
  // Zünden im echten Ablauf: Spieler i steht am Sprengpunkt und hält E 4 s (CONFIG.anker.halten.sprengpunkt)
  const zuenden = (i) => { am(g.players[i], SP); send(i, { t: 'act', down: true }); laufe(CONFIG.anker.halten.sprengpunkt + 0.4); send(i, { t: 'act', down: false }); };
  // Hochbeamen im echten Ablauf: Spieler i auf dem Pad des Bunkereingangs, E halten bis zur Beamzeit
  const padHoch = (i) => { am(g.players[i], 'bunker.pad'); send(i, { t: 'act', down: true }); laufe(CONFIG.ship.beamTime + 0.6); send(i, { t: 'act', down: false }); };
  // Lift: E tippen, bis die Fahrt vorbei ist
  const lift = (i, id) => { am(g.players[i], id); send(i, { t: 'act', down: true }); send(i, { t: 'act', down: false }); const t0 = g.time; laufe(3); return g.time - t0; };
  const oben = () => { faellen(S.ids[1]); faellen(S.ids[2]); };
  return { g, cs, S, aw, K, stride, anker, ev, oda, platz, am, laufe, send, faellen, nachschub, deck, evN, zuenden, padHoch, lift, oben };
}

section('C1 Start: eine Ladung im Teaminventar, Sprengpunkt ist das Ziel, der alte Anker ist still', () => {
  const { g, cs, S, aw, K, anker, am, laufe, send, oben } = start(2);
  ok(g.inventory.ladung === 1, 'die Crew startet mit EINER Ladung (inventory.ladung ' + g.inventory.ladung + ')');
  ok(S.zielId === SP && K.anker.filter((a) => a.rolle === 'sprengpunkt').length === 1, 'Ziel-Anker = der einzige Sprengpunkt im Reaktorraum (' + S.zielId + ')');
  ok(Anker.zustand(g, S.lp, SP) === 'intakt' && S.ziel === 'gesperrt' && S.nachschub === null, 'Sprengpunkt intakt, Stufe gesperrt, kein Nachschub');
  ok(aw.ankerSperre && /Erst die Verteidiger/.test(aw.ankerSperre[SP]), 'Sprengpunkt gesperrt (ankerSperre: ' + (aw.ankerSperre && aw.ankerSperre[SP]) + ')');
  ok(S.stillId === 'bunker.ziel' && aw.ankerSperre && /nicht das Ziel/.test(aw.ankerSperre['bunker.ziel']), 'alter Anker bunker.ziel still (ankerSperre: ' + (aw.ankerSperre && aw.ankerSperre['bunker.ziel']) + ')');
  const z = anker('bunker.ziel'); const l = []; Anker.interactionsAt(g, g.players[0], z.x, z.y, l);
  ok(l.length && l.every((i) => i.blocked), 'E am Bunkereingang-Anker: nur der Hinweis, kein Halten');
  oben(); laufe(1);
  ok(S.ziel === 'offen' && !(aw.ankerSperre && aw.ankerSperre[SP]), 'Welle 1 und 2 besiegt: Stufe offen, die Sperre des Sprengpunkts ist weg');
  const txt = ((g.snapshot().mission || {}).objectives || []).map((o) => o.text).join(' | ');
  ok(txt === 'Sprengladung im Reaktorraum zünden', 'Zielzeile: ' + txt);
  // der alte Anker: 4 s Halten wirkt nichts, auch nach Welle 2
  am(g.players[0], 'bunker.ziel'); send(0, { t: 'act', down: true }); laufe(4.5); send(0, { t: 'act', down: false });
  ok(Anker.zustand(g, S.lp, 'bunker.ziel') === 'frei' && S.ziel === 'offen', 'Halten am alten Bunkereingang-Anker (4,5 s) erfüllt kein Ziel');
  ok(g.players.every((p) => p.zone === 'away') && S.ph === 'kampf', 'kein Sieg, niemand beamt');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('Sperre: der Sprengpunkt ist gesperrt, bis die Oberflächenwellen besiegt sind', () => {
  const r = start(2); const { g, S, aw, am, laufe, send, faellen } = r;
  const sp = r.anker(SP);
  // gesperrt: E zeigt nur den Hinweis, E halten zündet nicht, kein Sieg
  const l = []; Anker.interactionsAt(g, g.players[0], sp.x, sp.y, l);
  ok(l.length && l.every((i) => i.blocked) && /Erst die Verteidiger/.test(l[0].blocked), 'E am Sprengpunkt: nur der Hinweis „' + (l[0] && l[0].blocked) + '“');
  am(g.players[0], SP); send(0, { t: 'act', down: true }); laufe(CONFIG.anker.halten.sprengpunkt + 1); send(0, { t: 'act', down: false });
  ok(Anker.zustand(g, S.lp, SP) === 'intakt' && g.inventory.ladung === 1 && !(aw.ankerLauf.ladung && Object.keys(aw.ankerLauf.ladung).length), 'E 5 s halten bei lebenden Wellen: nichts scharf, Ladung unverbraucht');
  ok(typeof Anker.ladungScharf(g, S.lp, SP, 1) === 'string' && Anker.zustand(g, S.lp, SP) === 'intakt', 'auch Debug/Baustein ladungScharf wird abgewiesen: ' + Anker.ladungScharf(g, S.lp, SP, 1));
  laufe(5);
  ok(S.ziel === 'gesperrt' && S.ph === 'kampf' && S.nachschub === null && g.players.every((p) => p.zone === 'away'), 'kein Ziel, kein Nachschub, kein Sieg, die Crew bleibt unten');
  // Welle 1 tot, Welle 2 lebt: weiter gesperrt
  faellen(S.ids[1]); laufe(1);
  const l2 = []; Anker.interactionsAt(g, g.players[0], sp.x, sp.y, l2);
  ok(S.ziel === 'gesperrt' && l2.every((i) => i.blocked), 'nur Welle 1 besiegt: weiter gesperrt');
  // Welle 2 tot (Welle 3 im Bunker lebt): freigegeben, E halten zündet
  faellen(S.ids[2]); laufe(1);
  ok(S.ziel === 'offen' && !aw.ankerSperre[SP] && r.oda.some((t) => /Weg zum Bunker ist frei/.test(t)) && r.ev.some((e) => e[0] === 'sfx' && e[1].name === 'repair_done'), 'Welle 1 und 2 besiegt: offen, Sperre weg, ODA und Ton');
  const l3 = []; Anker.interactionsAt(g, g.players[0], sp.x, sp.y, l3);
  ok(l3.some((i) => !i.blocked && i.kind === 'anker:sprengpunkt'), 'E am Sprengpunkt bietet das Zünden an');
  r.zuenden(0);
  ok(Anker.zustand(g, S.lp, SP) === 'scharf' && g.inventory.ladung === 0, 'E 4 s halten: Ladung scharf');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('C3 Nachschub trotz belegter Plätze: vier lebende Gegner auf den alten Plätzen und ein Spieler am Lift -> trotzdem genau vier neue, nicht auf Spielern', () => {
  const r = start(2); const { g, S, aw, K, am, laufe, nachschub, oben, anker, platz } = r;
  oben(); laufe(1);
  const info = interior.awayInfoOf(S.lp); const lo = anker('bunker.lift.oben');
  const alt = Graben._nachschubPlaetze(g, aw, info, 4).slice(0, 4);   // die ersten vier Kandidaten = die alten Plätze (vorher: slice(0, 4))
  ok(alt.length === 4, 'vier Plätze im Ring um den Lift (' + alt.map((q) => q.x + ',' + q.y).join(' ') + ')');
  const b = squad.spawnSquad(g, 'test.blocker', { map: S.lp, besetzung: [{ typ: 'grundtyp', anzahl: 4 }], force: true, plaetze: alt, festeZahl: true });
  for (const e of aw.drones) if (e.squad === 'test.blocker') { e.tag = Wellen.TAG; e.fraktion = 'rom'; }
  ok(b === 4 && aw.drones.filter((e) => e.squad === 'test.blocker' && e.alive).length === 4, 'vier lebende Gegner stehen auf den alten Plätzen (Welle 2 am Eingang)');
  const alle = Graben._nachschubPlaetze(g, aw, info, 4);
  const belegt = (q) => alt.some((a) => a.x === q.x && a.y === q.y);
  ok(alle.length > 4 && !alle.some(belegt), 'Kandidatenliste: mehr als vier, keiner auf einem Gegner (' + alle.length + ' Kandidaten)');
  // Spieler 0 steht auf dem nächsten freien Kandidaten, Spieler 1 am Lift
  const pz = alle[0]; platz(g.players[0], pz.x, pz.y); am(g.players[1], 'bunker.lift.oben');
  const ohnePz = Graben._nachschubPlaetze(g, aw, info, 4);
  ok(!ohnePz.some((q) => q.x === pz.x && q.y === pz.y), 'Kachel unter einem Spieler ist kein Kandidat');
  Anker.ladungScharf(g, S.lp, SP, 0.3);
  platz(g.players[0], pz.x, pz.y); laufe(0.6);
  const ns = nachschub();
  const ts = ns.map((e) => tile(e));
  ok(S.ziel === 'erreicht' && ns.length === 4 && ns.every((e) => e.alive) && new Set(ts.map((t) => t.x + ',' + t.y)).size === 4, 'Knall: genau vier neue Gegner, vier verschiedene Kacheln (' + ns.length + ')');
  ok(!ts.some((t) => belegt(t)) && !ts.some((t) => t.x === pz.x && t.y === pz.y), 'keiner auf den Plätzen der lebenden Gegner und keiner auf dem Spieler');
  ok(fehlerZahl(g) === 0, 'keine Fehler (kein Fehlerzähler „Nachschub: n/4“)');
});

section('Sperre: Neubeginn sperrt den Sprengpunkt wieder', () => {
  const r = start(2); const { g, S, aw, laufe, oben } = r;
  oben(); laufe(1);
  ok(S.ziel === 'offen' && !aw.ankerSperre[SP], 'Ausgangslage: offen');
  Graben.debug(g, 'reset'); laufe(1);
  ok(S.ziel === 'gesperrt' && /Erst die Verteidiger/.test(aw.ankerSperre[SP]) && S.versuch === 2, 'nach dem Neubeginn: gesperrt (Versuch ' + S.versuch + ')');
  r.am(g.players[0], SP); r.send(0, { t: 'act', down: true }); laufe(CONFIG.anker.halten.sprengpunkt + 1); r.send(0, { t: 'act', down: false });
  ok(Anker.zustand(g, S.lp, SP) === 'intakt', 'nach dem Neubeginn zündet E halten nicht');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('C1/C2/C3 Echter Ablauf zu zweit: Zünden (E 4 s), Countdown, Knall -> Ziel, Warnsignal, genau einmal Nachschub', () => {
  const r = start(2); const { g, cs, S, aw, K, stride, anker, ev, oda, am, laufe, send, faellen, nachschub, deck, evN, zuenden, oben } = r;
  oben(); faellen(S.ids[3]); laufe(1);
  const gesamt0 = S.gesamt, lebt0 = aw.drones.filter((e) => e.alive).length;
  zuenden(0);
  ok(Anker.zustand(g, S.lp, SP) === 'scharf' && g.inventory.ladung === 0, 'nach 4 s Halten: Ladung scharf, Ladung verbraucht (inventory.ladung ' + g.inventory.ladung + ')');
  ok(S.ziel === 'offen' && !nachschub().length && evN('nachschub') === 0, 'Zünden ist noch nicht das Ziel: Stufe offen, kein Nachschub, kein Warnsignal');
  ok(/scharf/.test(((g.snapshot().mission || {}).objectives || []).map((o) => o.text).join()), 'Zielzeile: Ladung scharf');
  const cd = g.snapshot().away.cd;
  ok(cd && cd.t > 50 && cd.t <= 60, 'Countdown im Snapshot (cd.t ' + (cd && cd.t) + ' s, CONFIG.anker.countdown ' + CONFIG.anker.countdown + ')');
  // die Crew verlässt den Reaktorraum (Friendly Fire r 2 Kacheln bleibt wie bisher), Fahrt zum Lift unten wäre zu weit: einfach an den Lift stellen
  g.players.forEach((p) => am(p, 'bunker.lift.unten'));
  laufe(CONFIG.anker.countdown - 6);
  ok(Anker.zustand(g, S.lp, SP) === 'scharf' && S.ziel === 'offen' && !nachschub().length, 'Countdown läuft (noch scharf), noch nichts ausgelöst');
  for (let i = 0; i < 10 * CONFIG.tickHz && Anker.zustand(g, S.lp, SP) !== 'zerstoert'; i++) laufe(1 / CONFIG.tickHz);   // bis zum Knall, die Plätze des Nachschubs sofort danach prüfen
  const platz0 = nachschub().map((e) => tile(e).x + ',' + tile(e).y).sort().join(' ');
  ok(Anker.zustand(g, S.lp, SP) === 'zerstoert', 'Knall: Sprengpunkt zerstört');
  ok(S.ziel === 'erreicht', 'Sprengung erfüllt das Ziel (S.ziel erreicht)');
  ok(Graben.zeile(g, S) === 'Zurück zum Pad – hochbeamen', 'Zielzeile: ' + Graben.zeile(g, S));
  // Warnsignal
  ok(evN('nachschub') === 1 && ev.some((e) => e[0] === 'sfx' && e[1].name === 'alarm_yellow'), 'Warnsignal: Ereignis nachschub (1x) und Ton alarm_yellow');
  ok(oda.some((t) => /^ALARM – Nachschub kommt/.test(t)), 'ODA-Text: ' + oda.filter((t) => /Nachschub/.test(t))[0]);
  ok(cs[0].inbox.some((m) => m.t === 'event' && m.kind === 'nachschub'), 'der Client bekommt das Ereignis nachschub');
  // Nachschub
  const ns = nachschub();
  ok(ns.length === 4 && ns.every((e) => e.alive && e.rolle === 'grundtyp' && e.tag === Wellen.TAG && e.fraktion === 'rom'), 'genau vier Mann Nachschub: Rolle grundtyp (Sturmgewehr), römisch, in der Szene gezählt');
  const lo = anker('bunker.lift.oben'), pad = K.anker.filter((a) => a.rolle === 'abholpunkt');
  const info = interior.awayInfoOf(S.lp);
  ok(ns.every((e) => deck(e) === 0), 'alle oben (Deck 0)');
  const pl = platz0.split(' ').map((q) => ({ x: +q.split(',')[0], y: +q.split(',')[1] }));
  ok(pl.length === 4 && pl.every((t) => { const d = Math.max(Math.abs(t.x - lo.x), Math.abs(t.y - lo.y)); return d >= 2 && d <= 5; }), 'Erscheinungsplätze nahe dem Lift oben (Abstand 2 bis 5): ' + platz0 + ' (Lift ' + lo.x + ',' + lo.y + ')');
  ok(pl.every((t) => !(t.x === lo.x && t.y === lo.y) && !info.pads.some((q) => q.x === t.x && q.y === t.y) && !K.anker.some((a) => a.x === t.x && a.y === t.y)) && new Set(platz0.split(' ')).size === 4, 'keiner auf Pad, Lift-Anker oder einem anderen Anker, vier verschiedene Kacheln');
  const s = aw.squads['graben.nachschub'];
  ok(s && s.deckBindung === 0 && s.tag === Wellen.TAG, 'Trupp mit Deck-Bindung 0 (Oberfläche)');
  ok(S.gesamt === gesamt0 + 4 && S.nachschubIds.length === 4 && S.nachschub === 'gesendet', 'Zähler: gesamt +4, Auslöser gesetzt');
  ok(!S.ids[1].concat(S.ids[2], S.ids[3]).some((id) => S.nachschubIds.includes(id)), 'Nachschub ist keine vierte Welle (gehört zu keiner Welle, Zielzeile/aktive Welle unberührt)');
  const sw = g.snapshot().wellen;
  ok(sw.n === 3 && sw.l === 0 && sw.r === 0, 'HUD-Block: aktive Welle ' + sw.n + ', „Gegner übrig“ ' + sw.r + ' (der Nachschub mischt sich nicht in die Wellenanzeige)');
  // kein Timer, keine Niederlage, nicht noch einmal
  let min = 99, max = 0;
  laufe(120, (i) => { if (i % 15 === 0) { const c = nachschub().length; min = Math.min(min, c); max = Math.max(max, c); } });
  ok(S.ph === 'kampf' && g.phase === 'play' && S.versuch === 1 && S.ziel === 'erreicht', '120 s nach dem Knall: Szenario läuft, kein Neubeginn, keine Niederlage, Versuch 1');
  ok(min === 4 && max === 4 && evN('nachschub') === 1, 'Nachschub in 120 s unverändert 4 Mann, Warnsignal weiter nur einmal');
  // Replays: der Zustand fällt und wird wieder zerstört, S.ziel bleibt erreicht -> nichts neu
  Anker.setzen(g, S.lp, SP, 'intakt', null, { still: true }); laufe(1);
  Anker.setzen(g, S.lp, SP, 'zerstoert', null); laufe(2);
  ok(nachschub().length === 4 && evN('nachschub') === 1, 'Replay des Zustands zerstoert löst keinen zweiten Nachschub aus');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('Lift nach der Sprengung nicht gesperrt (mit Nachschub oben), Sieg erst wenn alle oben (Pad im echten Spielweg), 2 Spieler', () => {
  const r = start(2); const { g, S, aw, K, anker, am, laufe, send, faellen, nachschub, deck, ev, lift, padHoch, oben } = r;
  oben(); faellen(S.ids[3]); laufe(1);
  Anker.ladungScharf(g, S.lp, SP, 1); laufe(2.5);   // Knall (kurzer Countdown, Spieler am Landefeld)
  ok(S.ziel === 'erreicht' && nachschub().length === 4, 'Ausgangslage: gesprengt, vier Mann Nachschub oben');
  const lu = anker('bunker.lift.unten'), lo = anker('bunker.lift.oben');
  g.players.forEach((p) => am(p, 'bunker.lift.oben'));
  // beide fahren hinunter (nach der Sprengung gesperrt wäre ein Softlock des Plans: Kai: nicht sperren)
  const l = interior.interactionsAt(g, g.players[0], lo.x, lo.y, true);
  ok(l.some((i) => i.kind === 'lift' && !i.blocked), 'am Lift oben: Fahrt angeboten, nicht blockiert');
  let t = lift(0, 'bunker.lift.oben'); lift(1, 'bunker.lift.oben');
  ok(g.players.every((p) => deck(p) === 1 && p.zone === 'away'), 'beide per Lift im Bunker (Deck 1), obwohl oben der Nachschub steht');
  ok(nachschub().length === 4 && nachschub().every((e) => deck(e) === 0), 'Nachschub bleibt oben, kein Gegner im Bunker');
  // Spieler 0 fährt zurück hinauf (Nachschub alarmiert) und beamt am Pad hoch, Spieler 1 bleibt unten
  lift(0, 'bunker.lift.unten');
  ok(deck(g.players[0]) === 0 && g.players[0].zone === 'away', 'Spieler 0 fährt wieder hinauf (Lift nicht gesperrt)');
  faellen(S.nachschubIds);   // die Crew schlägt den Nachschub zurück (sonst unterbricht das Feuer das Halten)
  padHoch(0);
  ok(g.players[0].zone === 'ship', 'Spieler 0: E halten auf dem Pad bringt ihn an Bord (canBeam, Beamzeit ' + CONFIG.ship.beamTime + ' s)');
  laufe(1);
  ok(S.ph === 'kampf' && g.players[1].zone === 'away', 'Sprengung erfolgt, aber Spieler 1 noch unten: KEIN Sieg');
  lift(1, 'bunker.lift.unten'); padHoch(1);
  laufe(1);
  ok(g.players.every((p) => p.zone === 'ship') && S.ph === 'ende' && g.snapshot().wellen.ph === 'ende', 'alle oben nach der Sprengung: Sieg (Phase ende)');
  const we = ev.filter((e) => e[0] === 'wellenEnde');
  ok(we.length === 1 && we[0][1].sieg === true, 'Ereignis wellenEnde { sieg }');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('C5 Sieg mit vier Spielern: drei oben, einer noch unten = kein Sieg; erst der vierte', () => {
  const r = start(4); const { g, S, aw, am, laufe, faellen, nachschub, padHoch, lift, oben, deck } = r;
  oben(); faellen(S.ids[3]); laufe(1);
  Anker.ladungScharf(g, S.lp, SP, 1); laufe(2.5);
  ok(S.ziel === 'erreicht' && nachschub().length === 4, 'gesprengt, Nachschub 4 (auch bei 4 Spielern genau vier)');
  faellen(S.nachschubIds);
  g.players.forEach((p) => am(p, 'bunker.lift.oben'));
  lift(3, 'bunker.lift.oben');
  ok(deck(g.players[3]) === 1, 'Spieler 3 bleibt im Bunker');
  g.players.forEach((p, i) => { if (i < 3) am(p, 'bunker.lift.oben'); });
  for (let i = 0; i < 3; i++) { padHoch(i); laufe(0.5); ok(S.ph === 'kampf', `Spieler ${i} oben (${i + 1} von 4): kein Sieg, einer ist noch unten`); }
  ok(g.players.slice(0, 3).every((p) => p.zone === 'ship') && g.players[3].zone === 'away', 'drei an Bord, einer unten');
  lift(3, 'bunker.lift.unten'); padHoch(3); laufe(1);
  ok(S.ph === 'ende', 'der vierte beamt hoch: Sieg');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('C5 Ohne Sprengung bringt das Pad keinen Sieg (Pad immer aktiv); Spieler kommen trotzdem hoch', () => {
  for (const np of [2, 4]) {
    const r = start(np); const { g, S, aw, laufe, padHoch, oben, am } = r;
    oben(); laufe(1);
    ok(S.ziel === 'offen', `${np} Spieler: Welle 1 und 2 besiegt, Ziel offen, aber nicht gesprengt`);
    for (let i = 0; i < np; i++) padHoch(i);
    laufe(3);
    ok(g.players.every((p) => p.zone === 'ship'), `${np} Spieler: alle per Pad hochgebeamt (Pad ist ohne Sprengung aktiv)`);
    ok(S.ph === 'kampf' && g.phase === 'play' && S.ziel === 'offen', `${np} Spieler: kein Sieg, Szenario läuft weiter`);
    ok(fehlerZahl(g) === 0, `${np} Spieler: keine Fehler`);
  }
});

section('C6 Pad end-to-end: canBeam im Spielweg, Gegenproben (Transfer zerstört, Schiff zu weit, Notrückholung)', () => {
  const r = start(2); const { g, S, aw, K, anker, am, laufe, send, padHoch } = r;
  const pad = anker('bunker.pad');
  const info = interior.awayInfoOf(S.lp);
  ok(info.pads.some((q) => q.x === pad.x && q.y === pad.y) && !info.ankunftPads.some((q) => q.x === pad.x && q.y === pad.y), 'Pad in pads, nicht in ankunftPads');
  am(g.players[0], 'bunker.pad');
  ok(away.canBeam(g, 'up').ok === true, 'canBeam(up) am Szenario-Start ok');
  const li = interior.interactionsAt(g, g.players[0], pad.x, pad.y, true);
  ok(li.some((i) => i.kind === 'selfbeam' && !i.blocked), 'auf dem Pad wird selfbeam angeboten');
  // Gegenprobe 1: Transfer zerstört -> kein Beamen, Spieler bleibt
  interior.damageSystem(g, 'transfer', 'broken', { quiet: true });
  ok(away.canBeam(g, 'up').ok === false, 'Gegenprobe: Transfer zerstört -> canBeam nicht ok (' + away.canBeam(g, 'up').reason + ')');
  send(0, { t: 'act', down: true }); laufe(CONFIG.ship.beamTime + 0.6); send(0, { t: 'act', down: false });
  ok(g.players[0].zone === 'away', 'Gegenprobe: bei zerstörtem Transfer bleibt der Spieler unten');
  interior.damageSystem(g, 'transfer', 'ok', { quiet: true });
  // Gegenprobe 2: Schiff zu weit
  const sx = g.ship.x; g.ship.x += 5000;
  ok(away.canBeam(g, 'up').ok === false && /Zu weit/.test(away.canBeam(g, 'up').reason), 'Gegenprobe: Schiff zu weit -> canBeam nicht ok');
  g.ship.x = sx;
  // kurz gehalten bricht ab
  send(0, { t: 'act', down: true }); laufe(1); send(0, { t: 'act', down: false });
  ok(g.players[0].zone === 'away', 'zu kurz gehalten (1 s): kein Hochbeamen');
  // Spielweg: E halten auf dem Pad, volle Beamzeit (selfBeam nimmt alle mit, die auf einem Pad stehen: Spieler 1 steht dafür am Lift, nicht am Landefeld-Pad)
  am(g.players[1], 'bunker.lift.oben');
  padHoch(0);
  ok(g.players[0].zone === 'ship' && g.players[1].zone === 'away', 'E halten auf dem Pad (Beamzeit ' + CONFIG.ship.beamTime + ' s): der Spieler kommt an Bord');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
  // nach dem Neubeginn (Notrückholung brennt den Transfer durch): das Pad geht wieder
  const r2 = start(2); const g2 = r2.g;
  Graben.debug(g2, 'reset'); r2.laufe(1);
  r2.padHoch(0);
  ok(g2.players[0].zone === 'ship' && g2.ship.systems.transfer === 'ok', 'nach dem Neubeginn: das Pad bringt hoch (Transfer heil)');
  ok(fehlerZahl(g2) === 0, 'keine Fehler');
});

section('C1/C3 Neubeginn nach der Sprengung: alles zurück, danach wieder genau einmal Nachschub', () => {
  for (const np of [2, 4]) {
    const r = start(np); const { g, S, aw, K, am, laufe, faellen, nachschub, evN, ev } = r;
    const pos0 = aw.drones.filter((e) => e.tag === Wellen.TAG).map((e) => e.rolle + '@' + tile(e).x + ',' + tile(e).y).sort().join(';');
    const gesamt0 = S.gesamt;
    r.oben(); laufe(1);   // Welle 1 und 2 besiegt: der Sprengpunkt ist freigegeben
    Anker.ladungScharf(g, S.lp, SP, 1); laufe(2.5);
    ok(S.ziel === 'erreicht' && nachschub().length === 4, `${np} Spieler: Ausgangslage gesprengt, Nachschub 4`);
    g.inventory.ladung = 0;
    // die ganze Crew fällt (alle unten, niemand an Bord) -> Notrückholung -> Neubeginn
    const vorher = (aw.stats && aw.stats.squadRecalls) || 0;
    for (const p of g.players) { combat.woundPlayer ? combat.woundPlayer(g, p, { quiet: true }) : (p.downed = true); p.downed = true; }
    for (let i = 0; i < (CONFIG.awayCombat.wounded.squadRecallDelay + 3) * CONFIG.tickHz; i++) g.step();
    ok(((aw.stats && aw.stats.squadRecalls) || 0) === vorher + 1 && S.versuch === 2 && g.phase === 'play' && S.ph !== 'ende', `${np} Spieler: ganze Crew gefallen -> Notrückholung -> Neubeginn (Versuch ${S.versuch})`);
    ok(Anker.zustand(g, S.lp, SP) === 'intakt' && S.ziel === 'gesperrt' && S.nachschub === null && S.nachschubIds.length === 0, `${np} Spieler: Sprengpunkt wieder intakt, Stufe gesperrt, Nachschub-Auslöser zurück`);
    ok(nachschub().length === 0 && aw.drones.filter((e) => e.tag === Wellen.TAG).length === gesamt0 && !aw.squads['graben.nachschub'], `${np} Spieler: der Nachschub ist weg, nur die ${gesamt0} Gegner der Wellen stehen (auch Welle 3 im Bunker)`);
    ok(aw.drones.filter((e) => e.tag === Wellen.TAG).map((e) => e.rolle + '@' + tile(e).x + ',' + tile(e).y).sort().join(';') === pos0, `${np} Spieler: alle Gegner wieder auf den Anfangsplätzen`);
    ok(g.inventory.ladung === 1, `${np} Spieler: Ladung wieder 1 (nicht 2: gesetzt, nicht addiert)`);
    ok(!(aw.ankerLauf.ladung && Object.keys(aw.ankerLauf.ladung).length) && Object.keys(aw.zustaende).length === 0, `${np} Spieler: Countdown und Zustände zurück`);
    ok(S.ph === 'kampf' && g.players.every((p) => p.zone === 'away' && !p.downed), `${np} Spieler: Crew wieder unten am Landefeld`);
    // zweiter Versuch: Sprengung im echten Ablauf, wieder genau einmal Nachschub
    r.faellen(S.ids[1]); r.faellen(S.ids[2]); r.faellen(S.ids[3]); laufe(1);
    r.zuenden(0);
    ok(Anker.zustand(g, S.lp, SP) === 'scharf' && g.inventory.ladung === 0, `${np} Spieler: Versuch 2: Zünden (E 4 s) mit der neuen Ladung`);
    g.players.forEach((p) => am(p, 'bunker.lift.unten'));
    laufe(CONFIG.anker.countdown + 1);
    ok(S.ziel === 'erreicht' && nachschub().length === 4 && evN('nachschub') === 2, `${np} Spieler: Versuch 2: Knall, wieder genau vier Mann Nachschub (Warnsignal je Versuch einmal)`);
    ok(fehlerZahl(g) === 0, `${np} Spieler: keine Fehler`);
  }
});

section('Gegenrichtung: ohne Sprengung ändert sich nichts an Welle 1/2/3 und am Start; Nachschub nur nach dem Knall', () => {
  const { g, S, aw, laufe, nachschub, evN, oben } = start(2);
  oben(); laufe(30);
  ok(nachschub().length === 0 && evN('nachschub') === 0 && S.nachschub === null, 'Welle 1/2 besiegt, 30 s später: kein Nachschub ohne Knall');
  ok(!Object.keys(aw.squads).includes('graben.nachschub'), 'der Nachschub-Trupp existiert nicht');
  ok(Graben.zeile(g, S) === 'Sprengladung im Reaktorraum zünden', 'Zielzeile vor dem Zünden: ' + Graben.zeile(g, S));
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
