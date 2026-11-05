'use strict';
// AUS-02 A: Waffenwechsel am Boden (Befehl slot.nutzen). Echtes Spiel (Game, Außenkarte kesh), ein Spieler mit mehreren Loadout-Slots.
// Geprüft: jede der sechs Waffen wirkt nach dem Wechsel (Wechselzeit, dann Schuss), kein Exploit durch Wechseln (Überhitzungssperre, Kadenz, Hitze kühlt im Halfter wie im Tick),
// Laden/Ausholen brechen ohne Abklingzeit ab, Ablehnungen, Item-Dispatch über die Registry (Test-Id), kein neues Snapshot-Feld, nichts im Weltstand, Marker unverändert.
//   node tools/test-waffenwechsel.js   (npm run test:waffenwechsel)
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const Loadout = require('../server/sim/loadout.js');
const Waffen = require('../server/sim/waffen.js');
const combat = require('../server/sim/combat.js');
const away = require('../server/sim/away.js');
const Weltstand = require('../server/weltstand.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const near = (a, b, e) => Math.abs(a - b) <= e;
const DT = 1 / CONFIG.tickHz;

// Szene: ein Spieler (Kennung W0) am Boden auf kesh, Gegner weg, unverwundbar, Slots wie angegeben (null = leer)
function szene(slots, opts) {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  // opts.mit: Loadouts weiterer Spieler (Mehrspieler); alle verbinden sich vor dem ersten ready (die Slotzahl steht beim Start fest: ab 3 Spielern 2)
  const alle = [slots].concat(opts && opts.mit || []);
  const cs = alle.map((_, i) => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } }));
  for (const [i, cc] of cs.entries()) { g.addConnection(cc); g.handleMessage(cc, { t: 'hello', clientId: 'W' + i, name: i ? 'Mit' + i : 'Wechsel', color: i }); }
  for (const cc of cs) g.handleMessage(cc, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  const c = cs[0];
  const p = g.players[0];
  for (const [j, sl] of alle.entries()) for (let i = 0; i < sl.length; i++) Loadout.slotSetzen(g, g.players[j], i, sl[i]);   // ersetzt Slot für Slot (Blaster in Slot 1 wird überschrieben)
  g.setAwayMap(opts && opts.karte || 'kesh');
  g.aways[opts && opts.karte || 'kesh'].active = true;
  for (const [j] of alle.entries()) { interior.placeOnAwayPad(g, g.players[j], j); combat.onArrive(g, g.players[j]); }
  g.god = true;
  const ev = [];
  const emit0 = g.emit.bind(g);
  g.emit = (name, data) => { ev.push({ name, data }); return emit0(name, data); };
  const S = { g, c, p, ev, mit: g.players.slice(1), cs };
  S.lauf = (sek) => { for (let k = 0; k < Math.round(sek / DT); k++) { g.away.drones.length = 0; g.step(); } };
  S.nutze = (slot) => g.handleMessage(c, { t: 'cmd', c: Protocol.CMD_SLOT_NUTZEN, slot });
  S.feuer = (dist) => away.shoot(g, p, 0, dist == null ? undefined : { dist });   // null = ausgeführt/begonnen, sonst Grund
  S.halten = (sek, dist) => { for (let k = 0; k < Math.round(sek / DT); k++) { S.feuer(dist); g.away.drones.length = 0; g.step(); } };   // Abzug gehalten (Lanze: der Strom hält das Laden am Leben)
  S.loadoutEv = () => ev.filter((e) => e.name === 'loadout');
  S.wf = () => Waffen.snapFelder(g, p).wf;
  return S;
}
const WZ = CONFIG.awayCombat.wechselzeit;

section('Konfiguration und Protokoll');
ok(WZ === 0.6, 'awayCombat.wechselzeit = 0,6 s (Startwert)');
ok(Protocol.CMD_SLOT_NUTZEN === 'slot.nutzen', "Protokoll: CMD_SLOT_NUTZEN = 'slot.nutzen'");
ok(Loadout.ITEMS === undefined && Loadout.itemNutzen === undefined && JSON.stringify(Loadout.erlaubteIds()) === JSON.stringify([...Waffen.WAHL, 'scanner']), 'Item-Registry: nur der Scanner (SCA-01), erlaubte Ids = Waffen + scanner (keine Platzhalter-Items)');
ok(Waffen.WAHL.length === 6, 'sechs wählbare Waffen');

section('(a) Jede Waffe wirkt nach dem Wechsel');
for (const W of Waffen.WAHL) {
  const von = W === 'blaster' ? 'sturmgewehr' : 'blaster';
  const S = szene([von, W]);
  const { p, g } = S;
  ok(p.waffe === von && S.wf() === von, W + ': Start mit ' + von + ' in Slot 1');
  const t0 = g.time;
  S.nutze(1);
  ok(p.waffe === W && S.wf() === W, W + ': nach slot.nutzen 1 sofort aktiv (p.waffe und wf)');
  const e = S.loadoutEv().pop();
  ok(e && e.data.pid === p.id && e.data.waffe === W && near(e.data.sperre, WZ, 1e-9), W + ': Ereignis loadout { pid, waffe, sperre ' + WZ + ' }');
  ok(near(p.bereitAt, t0 + WZ, 1e-6), W + ': bereitAt = jetzt + Wechselzeit');
  ok(S.feuer(6) === 'kadenz' && !p.ladung && !p.ausholen, W + ': sofort feuern gesperrt (Grund kadenz)');
  S.lauf(WZ + 0.1);
  const n0 = g.away.projectiles.length; ev0(S);
  const r = S.feuer(6);
  let wirkt;
  if (W === 'lanze') {
    ok(r === null && !!p.ladung, W + ': nach der Wechselzeit beginnt das Laden');
    S.halten(2.2, 6);
    wirkt = S.ev.some((x) => x.name === 'lanzeSchuss');
  } else if (W === 'nahkampf') {
    ok(r === null && !!p.ausholen, W + ': nach der Wechselzeit beginnt das Ausholen');
    S.lauf(1.0);
    wirkt = S.ev.some((x) => x.name === 'schlag');
  } else if (W === 'granatwerfer') {
    wirkt = r === null && S.ev.some((x) => x.name === 'granate') && g.away.projectiles.some((q) => q.kind === 'granate');
  } else {
    wirkt = r === null && g.away.projectiles.length > n0 && g.away.projectiles.some((q) => q.waffe === W);
  }
  ok(wirkt, W + ': nach der Wechselzeit entsteht die Wirkung (Projektil/Strahl/Schlag der eigenen Waffe)');
}
function ev0(S) { S.ev.length = 0; }

section('(b) Überhitzungs-Exploit: Wechseln löscht die Sperre nicht');
{
  const S = szene(['blaster', 'sturmgewehr']);
  const { p, g } = S;
  let schuesse = 0;
  for (let i = 0; i < 400 && !(p.gesperrtBis > g.time); i++) { if (S.feuer(6) === null) schuesse++; S.lauf(DT); }
  ok(p.gesperrtBis > g.time && p.hitze >= 1 - 1e-6, 'Blaster überhitzt nach ' + schuesse + ' Schüssen (gesperrt bis ' + p.gesperrtBis.toFixed(2) + ')');
  const sperrEnde = p.gesperrtBis;
  S.nutze(1);
  ok(p.waffe === 'sturmgewehr' && p.hitze === 0 && p.gesperrtBis === 0, 'Sturmgewehr ist frisch (keine Hitze, keine Sperre)');
  S.lauf(0.8);
  S.nutze(0);
  ok(p.waffe === 'blaster' && p.gesperrtBis === sperrEnde && p.hitze >= 1 - 1e-6, 'zurück zum Blaster: Sperre unverändert (' + sperrEnde.toFixed(2) + '), Hitze 100 %');
  ok(S.feuer(6) === 'ueberhitzt' && g.time < sperrEnde, 'Blaster feuert nicht, solange die Sperre läuft (Grund ueberhitzt)');
  S.lauf(Math.max(0, sperrEnde - g.time) + 0.05);
  ok(p.gesperrtBis === 0 && p.hitze === 0 && g.time >= sperrEnde, 'nach Ablauf der Sperre: Hitze 0 wie im Tick');
  ok(S.feuer(6) === null, 'danach feuert der Blaster wieder');
  // Sperre läuft im Halfter ab: Ablauf, während der Blaster weg ist
  const T = szene(['blaster', 'sturmgewehr']);
  for (let i = 0; i < 400 && !(T.p.gesperrtBis > T.g.time); i++) { if (T.feuer(6) === null) { /* feuern */ } T.lauf(DT); }
  const ende = T.p.gesperrtBis;
  T.nutze(1);
  T.lauf(ende - T.g.time + 0.5);
  T.nutze(0);
  ok(T.p.waffe === 'blaster' && T.p.gesperrtBis === 0 && T.p.hitze === 0, 'Sperre im Halfter abgelaufen: Blaster kommt kalt zurück (Hitze 0, keine Sperre)');
  ok(T.p.bereitAt >= T.g.time + WZ - 1e-6, 'auch dann kostet das Ziehen die Wechselzeit');
}

section('(b2) Hitze kühlt im Halfter nach denselben Regeln wie im Tick');
{
  const A = szene(['blaster', 'sturmgewehr']);   // wechselt
  const B = szene(['blaster', 'sturmgewehr']);   // bleibt beim Blaster
  for (const S of [A, B]) { for (let i = 0; i < 4; i++) { S.feuer(6); S.lauf(0.3 + 0.001); } S.lauf(0.5); }   // 0,5 s kühlen vor dem Wegstecken: diese Kühlung darf im Halfter nicht noch einmal zählen
  ok(near(A.p.hitze, B.p.hitze, 1e-9) && A.p.hitze > 0.3 && A.p.hitze < 1, 'Ausgangslage gleich: Hitze ' + A.p.hitze.toFixed(3) + ' (keine Überhitzung)');
  A.nutze(1);
  A.lauf(1.2);
  B.lauf(1.2);
  A.nutze(0);
  ok(A.p.waffe === 'blaster', 'zurück beim Blaster');
  ok(near(A.p.hitze, B.p.hitze, 0.04) && A.p.hitze < 0.4, 'Hitze nach 1,2 s im Halfter = Hitze des Blasters, der dageblieben ist (' + A.p.hitze.toFixed(3) + ' vs ' + B.p.hitze.toFixed(3) + ')');
  const C0 = szene(['blaster', 'sturmgewehr']), D0 = szene(['blaster', 'sturmgewehr']);
  for (const X of [C0, D0]) { for (let i = 0; i < 4; i++) { X.feuer(6); X.lauf(0.3 + 0.001); } X.lauf(0.4); }   // erst abkühlen lassen, dann wegstecken: Kühlung vor dem Ablegen darf nicht doppelt zählen
  C0.nutze(1); C0.lauf(0.1); C0.nutze(0); D0.lauf(0.1);
  ok(near(C0.p.hitze, D0.p.hitze, 0.04), 'kurzes Wegstecken (0,1 s) gibt keinen Kühlbonus (' + C0.p.hitze.toFixed(3) + ' vs ' + D0.p.hitze.toFixed(3) + ')');
  ok(C0.p.hitze > 0.2, 'und setzt die Hitze nicht auf 0 zurück');
}

section('(c) Kadenz-Exploit: A -> B -> A schneller als die Kadenz');
{
  const S = szene(['granatwerfer', 'blaster']);
  const { p, g } = S;
  S.lauf(0.7);
  ok(S.feuer(6) === null, 'Granatwerfer feuert');
  const tSchuss = g.time;
  const bereit = p.bereitAt;
  ok(near(bereit, tSchuss + CONFIG.awayCombat.waffen.granatwerfer.kadenz, 1e-6), 'Kadenz 1,2 s gesetzt');
  S.nutze(1); S.nutze(0);   // im selben Tick hin und zurück
  ok(p.waffe === 'granatwerfer' && p.bereitAt >= bereit - 1e-9, 'zurück beim Granatwerfer: Kadenz nicht zurückgesetzt (bereitAt ' + p.bereitAt.toFixed(2) + ' >= ' + bereit.toFixed(2) + ')');
  S.lauf(0.3);
  ok(S.feuer(6) === 'kadenz', 'nach 0,3 s: kein Schuss');
  S.lauf(0.4);
  S.nutze(1); S.nutze(0);
  const tZiehen = g.time;
  ok(S.feuer(6) === 'kadenz', 'nach weiterem Hin und Her (0,7 s nach dem Schuss): kein Schuss');
  let erst = null;
  for (let i = 0; i < 200 && erst === null; i++) { S.lauf(DT); if (Waffen.kannFeuern(g, p) === null) erst = g.time - tSchuss; }
  ok(erst !== null && near(erst, tZiehen - tSchuss + WZ, 0.04) && erst > 1.2, 'erster neuer Schuss genau eine Wechselzeit nach dem letzten Ziehen (' + (erst == null ? '?' : erst.toFixed(2)) + ' s nach dem Schuss, später als die Kadenz 1,2 s)');
  // Wechselzeit selbst ist der Preis, auch bei kurzer Kadenz: Blaster (0,3 s) A -> B -> A
  const T = szene(['blaster', 'sturmgewehr']);
  T.lauf(0.5);
  T.nutze(1); T.nutze(0);
  ok(T.feuer(6) === 'kadenz', 'Blaster: direkt nach A -> B -> A kein Schuss (Wechselzeit ' + WZ + ' s > Kadenz 0,3 s)');
  T.lauf(WZ + 0.05);
  ok(T.feuer(6) === null, 'nach der Wechselzeit wieder');
  // Wechsel während laufender Wechselzeit setzt die Zeit neu (kein Gratis-Spam)
  const U = szene(['blaster', 'sturmgewehr']);
  U.nutze(1); U.lauf(0.4);
  const t1 = U.g.time; U.nutze(0);
  ok(near(U.p.bereitAt, t1 + WZ, 1e-6), 'Wechsel mitten in der Wechselzeit: Zeit beginnt neu (' + U.p.bereitAt.toFixed(2) + ' = ' + (t1 + WZ).toFixed(2) + ')');
}

section('(d) Laden und Ausholen brechen beim Wechsel ab, ohne Abklingzeit');
{
  const S = szene(['lanze', 'blaster', 'nahkampf']);
  const { p, g } = S;
  S.lauf(0.7);
  ok(S.feuer(8) === null && !!p.ladung, 'Lanze lädt');
  S.halten(0.5, 8);
  ev0(S);
  const t0 = g.time;
  S.nutze(1);
  ok(p.waffe === 'blaster' && p.ladung === null, 'Wechsel bricht das Laden ab');
  ok(near(p.bereitAt, t0 + WZ, 1e-6), 'keine Abklingzeit über die Wechselzeit hinaus (bereitAt = jetzt + ' + WZ + ')');
  S.lauf(2.5);
  ok(!S.ev.some((x) => x.name === 'lanzeSchuss'), 'abgebrochene Ladung schießt nie (kein lanzeSchuss)');
  ok(p.hitze === 0, 'abgebrochene Ladung heizt nicht');
  ok(S.feuer(6) === null, 'Blaster feuert nach der Wechselzeit');
  S.lauf(0.4);
  S.nutze(0);
  ok(p.waffe === 'lanze' && p.ladung === null && p.hitze === 0, 'zurück zur Lanze: keine Ladung, keine Hitze');
  S.lauf(WZ + 0.05);
  ok(S.feuer(8) === null && !!p.ladung, 'Lanze lädt danach normal von vorn (Zielfenster beginnt neu)');
  S.halten(0.4, 8);
  ok(p.ladung && p.ladung.t < 0.6, 'Ladezeit zählt von 0 (nicht die alte)');
  // Nahkampf: Ausholen
  const N = szene(['nahkampf', 'blaster']);
  N.lauf(0.7);
  ok(N.feuer(1) === null && !!N.p.ausholen, 'Nahkampf holt aus');
  N.lauf(0.15);
  ev0(N);
  const tn = N.g.time;
  N.nutze(1);
  ok(N.p.waffe === 'blaster' && N.p.ausholen === null, 'Wechsel bricht das Ausholen ab');
  ok(near(N.p.bereitAt, tn + WZ, 1e-6), 'keine Erholungszeit des Schlags (bereitAt = jetzt + ' + WZ + ')');
  N.lauf(1.2);
  ok(!N.ev.some((x) => x.name === 'schlag') && N.p.hitze === 0, 'abgebrochener Schlag trifft nicht und heizt nicht');
}

section('(e) Ablehnungen');
{
  const rein = (S, was, vor) => {
    const { p, g } = S;
    const vorher = JSON.stringify({ w: p.waffe, b: p.bereitAt, h: p.hitze, gb: p.gesperrtBis });
    const nEv = S.loadoutEv().length;
    let wurf = null;
    try { vor(); } catch (e) { wurf = e; }
    ok(wurf === null && JSON.stringify({ w: p.waffe, b: p.bereitAt, h: p.hitze, gb: p.gesperrtBis }) === vorher && S.loadoutEv().length === nEv, was + ': kein Effekt, kein Ereignis, kein Absturz');
    ok(!g.errors || !g.errors.loadout, was + ': kein gezählter Fehler');
  };
  const frisch = () => { const S = szene(['blaster', 'sturmgewehr']); S.lauf(0.5); return S; };
  let S = frisch();
  rein(S, 'leerer Slot (3)', () => S.nutze(2));
  rein(S, 'Slot 3 (>= Slotzahl 3)', () => S.nutze(3));
  rein(S, 'Slot -1', () => S.nutze(-1));
  rein(S, 'Slot als Text', () => S.nutze('1'));
  rein(S, 'Slot fehlt', () => S.nutze(undefined));
  rein(S, 'Slot 1,5', () => S.nutze(1.5));
  S = frisch(); S.g.slotzahl = 2; Loadout.slotSetzen(S.g, S.p, 1, null);
  S.g.slotzahl = 3; Loadout.slotSetzen(S.g, S.p, 2, 'lanze'); S.g.slotzahl = 2;
  rein(S, 'versteckter dritter Slot bei Slotzahl 2', () => S.nutze(2));
  S = frisch(); S.p.downed = true;
  rein(S, 'ausgeschaltet (downed)', () => S.nutze(1));
  S = frisch(); S.p.zustand = 'verwundet';
  rein(S, 'Zustand verwundet', () => S.nutze(1));
  S = frisch(); S.p.zustand = 'bewusstlos'; S.p.bewusstlos = true;
  rein(S, 'bewusstlos', () => S.nutze(1));
  S = frisch(); S.p.gefangen = { zelle: 'z', x: 0, y: 0, offen: false };
  rein(S, 'gefangen', () => S.nutze(1));
  S = frisch(); S.p.betaeubtBis = S.g.time + 5;
  rein(S, 'betäubt', () => S.nutze(1));
  S = frisch(); S.p.zone = 'ship';
  rein(S, 'nicht am Boden (zone ship)', () => S.nutze(1));
  S = szene(['blaster', 'sturmgewehr'], { karte: 'platform' }); S.lauf(0.5);
  rein(S, 'Außenkarte ohne Kampf v2 (platform)', () => S.nutze(1));
  S = frisch(); S.g.away = null;
  rein(S, 'keine Außenkarte aktiv', () => S.nutze(1));
  S = frisch();
  rein(S, 'gleiche Waffe (Slot 0 bei Blaster): No-op ohne Preis', () => S.nutze(0));
  S.feuer(6);
  const b = S.p.bereitAt;
  S.nutze(0);
  ok(S.p.bereitAt === b && S.p.waffe === 'blaster', 'gleiche Waffe nach einem Schuss: Kadenz unverändert, keine Wechselzeit');
  ok(Loadout.slotNutzen(S.g, null, 0) !== null && Loadout.slotNutzen(null, S.p, 0) !== null, 'slotNutzen mit null-Argumenten: abgelehnt, kein Absturz');
  // Gegenprobe: derselbe Befehl wirkt, sobald nichts mehr dagegen spricht
  S = frisch(); S.nutze(1);
  ok(S.p.waffe === 'sturmgewehr', 'Gegenprobe: gleiche Szene ohne Hindernis wechselt');
  // handlungsfähig wieder: Wechsel nach Betäubung
  S = frisch(); S.p.betaeubtBis = S.g.time + 0.3; S.nutze(1);
  ok(S.p.waffe === 'blaster', 'betäubt: abgelehnt ...');
  S.lauf(0.4); S.nutze(1);
  ok(S.p.waffe === 'sturmgewehr', '... und danach möglich');
}

section('(f) Items: Dispatch über die Registry, aktive Waffe bleibt');
{
  const calls = [];
  const weg = Loadout.itemRegistrieren('testitem', (game, p) => { calls.push([game, p]); return null; });
  const S = szene(['blaster', 'sturmgewehr', 'testitem']);
  S.lauf(0.5);
  ok(Loadout.wirksam(S.g, S.p)[2] === 'testitem', 'Test-Id steckt in Slot 3 (erlaubteIds liest die Registry)');
  ok(S.p.waffe === 'blaster' && Loadout.aktiveWaffe(S.g, S.p) === 'blaster', 'Item ist keine Waffe: aktive Waffe Blaster');
  const b = S.p.bereitAt, nEv = S.loadoutEv().length;
  S.nutze(2);
  ok(calls.length === 1 && calls[0][0] === S.g && calls[0][1] === S.p, 'Handler genau einmal mit (game, Spieler) gerufen');
  ok(S.p.waffe === 'blaster' && S.p.bereitAt === b && S.loadoutEv().length === nEv, 'Nutzen ändert die aktive Waffe nicht (kein Ereignis, kein bereitAt)');
  S.nutze(1);
  ok(S.p.waffe === 'sturmgewehr', 'Waffenslot daneben wechselt weiter');
  S.nutze(2);
  ok(calls.length === 2 && S.p.waffe === 'sturmgewehr', 'Item nutzen mit anderer aktiver Waffe: Waffe bleibt');
  weg();
  ok(!Loadout.istErlaubt('testitem'), 'Entfernen-Funktion nimmt die Id wieder aus der Registry');
  let weg2 = () => {};
  try { weg2 = Loadout.itemRegistrieren('testitem', () => 'geht nicht'); } catch (e) { ok(false, 'Id nach dem Entfernen wieder registrierbar: ' + e.message); }
  ok(Loadout.slotNutzen(S.g, S.p, 2) === 'geht nicht', 'Fehlertext des Handlers wird zurückgegeben');
  weg2();
  weg();   // zweites Entfernen schadet nicht
  ok(typeof Loadout.slotNutzen(S.g, S.p, 2) === 'string' && S.p.waffe === 'sturmgewehr', 'ohne Registry-Eintrag: abgelehnt, Waffe bleibt');
  ok(JSON.stringify(Loadout.erlaubteIds()) === JSON.stringify([...Waffen.WAHL, 'scanner']), 'Registry nach dem Test wieder nur mit dem Scanner (Entfernen-Funktion räumt auf)');
  const wirft = (f) => { try { f(); return false; } catch (e) { return true; } };
  ok(wirft(() => Loadout.itemRegistrieren('blaster', () => null)) && wirft(() => Loadout.itemRegistrieren('faust', () => null)) && wirft(() => Loadout.itemRegistrieren('', () => null)) && wirft(() => Loadout.itemRegistrieren('x', null)), 'itemRegistrieren lehnt Waffen-Ids, leere Ids und fehlenden Handler ab');
  const w3 = Loadout.itemRegistrieren('doppelt', () => null);
  ok(wirft(() => Loadout.itemRegistrieren('doppelt', () => null)), 'doppelte Id wird abgelehnt');
  w3();
  ok(!Loadout.istErlaubt('constructor') && !Loadout.istErlaubt('__proto__') && !Loadout.istErlaubt('toString') && !Loadout.istErlaubt('doppelt'), 'Prototyp-Namen und entfernte Ids sind keine erlaubten Slot-Ids');
}

section('(g) Kein neues Snapshot-Feld, nichts im Weltstand');
{
  const S = szene(['blaster', 'sturmgewehr']);
  const { p, g } = S;
  S.lauf(0.5);
  ok(JSON.stringify(Protocol.PLAYER_SNAP_B2) === JSON.stringify(['wf', 'ht', 'ov', 'ch', 'wu', 'zs', 'bt']), 'Protokoll: PLAYER_SNAP_B2 unverändert');
  const keysVor = Object.keys(Waffen.snapFelder(g, p)).sort().join();
  const ws0 = JSON.stringify(Weltstand.capture(g).crew);
  const toSave0 = JSON.stringify([Loadout.toSave(g), Waffen.toSave(g)]);
  const sn0 = g.snapshot();
  const pe0 = sn0.players.find((x) => x.id === p.id);
  S.feuer(6); S.lauf(0.4);
  S.nutze(1); S.lauf(0.8); S.feuer(6); S.nutze(0);
  const keysNach = Object.keys(Waffen.snapFelder(g, p)).sort().join();
  ok(keysVor === keysNach && keysVor === 'ht,ov,wf,zs,bt'.split(',').sort().join(), 'snapFelder-Schlüssel gleich vor und nach dem Wechsel (' + keysNach + ')');
  const sn1 = g.snapshot();
  const pe1 = sn1.players.find((x) => x.id === p.id);
  ok(Object.keys(pe0).sort().join() === Object.keys(pe1).sort().join(), 'Snapshot players[]: gleiche Schlüsselmenge vor und nach dem Wechsel');
  ok(!JSON.stringify(sn1).includes('waffenZustand') && !Object.keys(p).includes('waffenZustand'), 'abgelegter Waffenzustand weder im Snapshot noch aufzählbar am Spieler');
  ok(p.waffenZustand && Object.keys(p.waffenZustand).includes('sturmgewehr') && Object.getOwnPropertyDescriptor(p, 'waffenZustand').enumerable === false, 'Speicher existiert, nicht aufzählbar');
  ok(JSON.stringify(Weltstand.capture(g).crew) === ws0, 'Weltstand crew (inkl. crew.loadout) unverändert nach Wechseln und Schüssen');
  ok(JSON.stringify([Loadout.toSave(g), Waffen.toSave(g)]) === toSave0, 'loadout.toSave und waffen.toSave unverändert');
  ok(Weltstand.VERSION === 3, 'Weltstand-Version bleibt 3');
}

section('(h) Marker (mark) unverändert, Zustandsspeicher wird zurückgesetzt');
{
  const S = szene(['blaster', 'sturmgewehr']);
  const { p, g, c } = S;
  g.handleMessage(c, { t: 'mark', x: 200, y: 120 });
  ok(g.away.marker && g.away.marker.x === 200 && g.away.marker.y === 120, 'mark setzt den Marker vor dem Wechsel');
  S.nutze(1);
  g.handleMessage(c, { t: 'mark', x: 260, y: 150 });
  ok(g.away.marker.x === 260 && g.away.marker.y === 150 && p.waffe === 'sturmgewehr', 'mark nach dem Wechsel unverändert, Waffe bleibt');
  ok(!Object.keys(Loadout).includes('markieren'), 'kein neuer Markierungsweg');
  // Beamen/Anlegen vergisst abgelegte Waffen
  S.lauf(0.7);
  for (let i = 0; i < 3; i++) { S.nutze(0); S.feuer(6); S.lauf(0.7); S.nutze(1); S.lauf(0.7); }
  S.nutze(0);   // aktive Waffe = Loadout-Waffe: onArrive legt nichts neu an, das Leeren muss von ihm selbst kommen
  ok(Object.keys(p.waffenZustand).length > 0 && p.waffe === Loadout.aktiveWaffe(g, p), 'abgelegte Waffe ist gespeichert');
  combat.onArrive(g, p);
  ok(Object.keys(p.waffenZustand).length === 0 && p.waffe === Loadout.aktiveWaffe(g, p), 'onArrive: Speicher leer, Waffe aus dem Loadout');
  S.nutze(1); S.lauf(0.7); S.nutze(0);
  combat.onLeave(g, p);
  ok(Object.keys(p.waffenZustand).length === 0, 'onLeave: Speicher leer');
  S.nutze(1);
  Waffen.waffeAnlegen(g, p, 'blaster');
  ok(Object.keys(p.waffenZustand).length === 0, 'waffeAnlegen (Labor, Arena, Debug; die Zelle läuft nicht darüber): Speicher leer');
}

section('(h2) Ausrüstung zurück und Ausbruch räumen Waffenstand und Speicher');
{
  const verschmutzen = (S) => {
    const { p, g } = S;
    p.hitze = 0.7; p.gesperrtBis = g.time + 5; p.ladung = { t: 0.5 }; p.ausholen = { t: 0.1, dauer: 0.4 };
    p.waffenZustand.lanze = { hitze: 0.5, gesperrtBis: 0, bereitAt: g.time + 3, schussAt: g.time, t: g.time };
  };
  const sauber = (p) => p.hitze === 0 && p.gesperrtBis === 0 && p.ladung === null && p.ausholen === null && Object.keys(p.waffenZustand).length === 0;
  // Ausrüstung zurück (Truhe in der Zelle): vorher getragene Waffe, frischer Stand
  let S = szene(['blaster', 'sturmgewehr']);
  S.lauf(0.5);
  S.p.waffe = 'faust'; S.p.waffeVorher = 'blaster'; verschmutzen(S);
  combat.completeHoldB2(S.g, S.p, { kind: 'ausruestung' });
  ok(S.p.waffe === 'blaster' && !S.p.waffeVorher && sauber(S.p), 'Ausrüstung zurück: Waffe zurück, Hitze/Sperre/Laden/Ausholen weg, Speicher leer');
  // Ausbruch (Landepunkt mit Zelle): Faust, frischer Stand
  const L = require('../server/sim/landepunkte.js');
  const LP = 'vaelen.handelsschiff';
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw() {} };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'W0', name: 'Ausbruch', color: 0 });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  const p = g.players[0];
  L.get(g, LP);
  g.setAwayMap(LP); interior.placeOnAwayPad(g, p, 0); g.aways[LP].active = true; combat.onArrive(g, p);
  Loadout.slotSetzen(g, p, 1, 'sturmgewehr');
  Waffen.waffeWechseln(g, p, 'sturmgewehr');
  Waffen.waffeWechseln(g, p, 'blaster');
  ok(Object.keys(p.waffenZustand).length === 1, 'Ausbruch: Speicher vor dem Ausbruch gefüllt');
  verschmutzen({ p, g });
  combat.ausbruch(g, [p]);
  ok(p.waffe === 'faust' && p.waffeVorher === 'blaster' && sauber(p), 'Ausbruch: Faust in der Zelle, Hitze/Sperre/Laden/Ausholen weg, Speicher leer');
}

section('(i) Ereignis loadout: sperre = wirksame Restzeit');
{
  const S = szene(['granatwerfer', 'sturmgewehr']);
  const { p, g } = S;
  S.lauf(0.7);
  ok(S.feuer(6) === null, 'Granatwerfer feuert');
  const tSchuss = g.time;
  const kad = CONFIG.awayCombat.waffen.granatwerfer.kadenz;
  S.nutze(1);
  let e = S.loadoutEv().pop();
  ok(e.data.waffe === 'sturmgewehr' && near(e.data.sperre, WZ, 1e-9) && near(e.data.sperre, p.bereitAt - g.time, 1e-9), 'Wechsel auf das Gewehr direkt nach dem Wurf: sperre = Wechselzeit der gezogenen Waffe (' + e.data.sperre.toFixed(2) + ')');
  S.lauf(0.1);
  S.nutze(0);
  e = S.loadoutEv().pop();
  const rest = tSchuss + kad - g.time;
  ok(e.data.waffe === 'granatwerfer' && near(e.data.sperre, rest, 1e-6) && e.data.sperre > WZ, 'zurück auf den Werfer innerhalb der Kadenz: sperre = Rest der Kadenz ' + e.data.sperre.toFixed(2) + ' s > Wechselzeit ' + WZ);
  ok(near(g.time + e.data.sperre, p.bereitAt, 1e-9), 'sperre endet genau, wenn die Waffe feuern darf (bereitAt)');
  S.lauf(e.data.sperre - DT);
  const frueh = S.feuer(6);
  S.lauf(2 * DT);
  ok(frueh === 'kadenz' && S.feuer(6) === null, 'der Werfer feuert erst nach der gemeldeten Sperre');
  S.lauf(2);
  S.nutze(1);
  e = S.loadoutEv().pop();
  ok(near(e.data.sperre, WZ, 1e-9), 'abgelaufene Kadenz: wieder nur die Wechselzeit');
}

section('(i2) tune wechselzeit');
{
  const S = szene(['blaster', 'sturmgewehr']);
  const r1 = combat.tune(S.g, 'awayCombat.wechselzeit', '1.5');
  const r2 = combat.tune(S.g, 'wechselzeit', '1.5');
  ok(r1.ok === false && /Unbekannter Pfad/.test(r1.text), 'tune awayCombat.wechselzeit gibt „Unbekannter Pfad“');
  ok(r2.ok === true && S.g.C.awayCombat.wechselzeit === 1.5, 'tune wechselzeit 1.5 setzt awayCombat.wechselzeit');
  S.nutze(1);
  const e = S.loadoutEv().pop();
  ok(near(e.data.sperre, 1.5, 1e-9), 'neue Wechselzeit wirkt (sperre 1,5 s)');
  combat.tune(S.g, 'wechselzeit', String(WZ));
  ok(CONFIG.awayCombat.wechselzeit === WZ, 'globale Konfiguration blieb unberührt');
}

section('(k) Mehrspieler: ein Wechsel berührt die anderen Spieler nicht');
for (const anz of [2, 3]) {
  const mit = anz === 2 ? [['sturmgewehr', 'blaster']] : [['sturmgewehr', 'blaster'], ['nahkampf', 'betaeuber']];
  const S = szene(['blaster', 'granatwerfer'], { mit });
  const { g, p } = S;
  const B = S.mit[0];
  ok(Loadout.slotzahl(g) === (anz === 2 ? 3 : 2), anz + ' Spieler: Slotzahl ' + Loadout.slotzahl(g));
  const nutzeB = (slot) => g.handleMessage(S.cs[1], { t: 'cmd', c: Protocol.CMD_SLOT_NUTZEN, slot });
  S.lauf(0.7);
  // A überhitzt den Blaster, B feuert und wechselt einmal (Speicher gefüllt, Hitze, Kadenz)
  for (let i = 0; i < 400 && !(p.gesperrtBis > g.time); i++) { S.feuer(6); S.lauf(DT); }
  ok(p.gesperrtBis > g.time, anz + ' Spieler: A ist überhitzt (Sperre läuft)');
  away_shoot(g, B); S.lauf(0.2); away_shoot(g, B);
  nutzeB(1); S.lauf(WZ + 0.1); away_shoot(g, B);
  ok(B.waffe === 'blaster', anz + ' Spieler: B hat gewechselt und trägt eine andere Waffe als A-Start');
  const stand = (q) => JSON.stringify({ w: q.waffe, b: q.bereitAt, h: q.hitze, gb: q.gesperrtBis, s: q.schussAt, l: q.ladung, a: q.ausholen, z: q.waffenZustand });
  const evB = () => S.loadoutEv().filter((x) => x.data.pid === B.id).length;
  const vorher = stand(B), nB = evB();
  ok(B.hitze > 0 && B.bereitAt > g.time && Object.keys(B.waffenZustand).length > 0, anz + ' Spieler: B hat Hitze/Ladung/Speicher (die Probe ist nicht leer)');
  S.nutze(1); S.nutze(0); S.nutze(1); S.nutze(1); S.nutze(0);
  ok(stand(B) === vorher && evB() === nB, anz + ' Spieler: A wechselt mehrfach (auch überhitzt) – B unverändert (Waffe, bereitAt, Hitze, Sperre, Ladung, Speicher), kein Ereignis für B');
  for (const q of S.mit.slice(1)) ok(q.waffe === Loadout.aktiveWaffe(g, q) && q.hitze === 0 && Object.keys(q.waffenZustand).length === 0, anz + ' Spieler: unbeteiligter Spieler ' + q.id + ' unberührt');
  // umgekehrt: B wechselt, A (überhitzt) bleibt unberührt
  const a0 = stand(p);
  nutzeB(0); nutzeB(1); nutzeB(0);
  ok(stand(p) === a0, anz + ' Spieler: B wechselt – der überhitzte A bleibt unverändert');
  // Zustandsspeicher sind getrennte Objekte
  ok(p.waffenZustand !== B.waffenZustand && (S.mit.length < 2 || S.mit[1].waffenZustand !== B.waffenZustand), anz + ' Spieler: Zustandsspeicher je Spieler');
}
function away_shoot(g, q) { return away.shoot(g, q, 0, { dist: 6 }); }

console.log(`\n${n} Prüfungen, ${fails} Fehler`);
process.exit(fails ? 1 : 0);
