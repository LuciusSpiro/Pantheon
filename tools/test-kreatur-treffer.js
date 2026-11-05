'use strict';
// MON-01 P2a: Kreaturen (aw.kreaturen) werden von allen Waffenwegen getroffen, mit denselben Waffenregeln wie Gegner (Schild, Wunden, Frontarc, durchschlagFront),
// ohne Trupp-/Funk-/Missionslogik der Drohnen auszulösen. Echtes Spiel (Game), Karte kesh, ein Spieler (god).
// Geprüft: Projektil (inkl. eigener Trefferradius), Granate/Fläche, Nahkampf, Lanze gegen Frontbogen, Frontarc von vorn/hinten, Orbitalschlag, Fall bei letzter Wunde,
// Betäubung und Aufwachen, tote Kreatur bewegt sich nicht, Schildregeneration nur per Datenfeld, Kontrolle Drohne, Guards (kein Phantom-Trupp, kein bark, kein droneKilled/enemyUp,
// kein Zufallsverbrauch, keine Ausnahmen), leere aw.kreaturen = byte-gleiches Verhalten, ziele() gibt ohne Kreaturen dieselbe Referenz.
//   node tools/test-kreatur-treffer.js   (npm run test:kreatur-treffer)
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const away = require('../server/sim/away.js');
const squad = require('../server/sim/squad.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');

const DT = 1 / CONFIG.tickHz;
const TILE = Physics.TILE;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};

// Testtypen (vor dem ersten Gebrauch der Daten): stillstehend, ohne Regeneration / mit Regeneration. Der Server kennt keine Typnamen, es sind nur Datenzeilen.
const STILL = { name: 'kreatur.teststill', groesse: 2, sicht: 4, verlustZeit: 3, replan: 0.5, hitRadius: 18, schild: { seg: 3, max: 3 }, wunden: 2, frontArc: 0, tuerenAufbrechen: false, rammZeit: 1.2, start: 'steht',
  zustaende: { steht: { modus: 'steht', tempo: 0, uebergang: [] } }, bausteine: {} };
KREATUREN.typen.teststill = STILL;
KREATUREN.typen.testregen = Object.assign({}, STILL, { name: 'kreatur.testregen', schildRegen: { verzoegerung: 1.5, schritt: 0.5 } });
KREATUREN.typen.testgross = Object.assign({}, STILL, { name: 'kreatur.testgross', hitRadius: 40 });

function szene(seed) {
  const g = new Game({ noStore: true, seed: seed || 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Kre', color: 0 });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  g.setAwayMap('kesh');
  g.aways.kesh.active = true;
  const p = g.players[0];
  interior.placeOnAwayPad(g, p, 0); combat.onArrive(g, p);
  g.god = true;
  const aw = g.aways.kesh;
  aw.drones.length = 0;
  aw.kreaturen = [];
  const E = combat.env(g);
  const kart = g.karteOf(aw.map);
  let bahn = null;
  for (let ty = 2; ty < kart.h - 2 && !bahn; ty++) for (let tx = 2; tx < kart.w - 16; tx++) {
    let frei = true;
    for (let i = 0; i <= 14 && frei; i++) if (E.solid(tx + i, ty) || E.shotBlocked(tx + i, ty)) frei = false;
    if (frei) { bahn = { tx, ty }; break; }
  }
  if (!bahn) throw new Error('keine freie Bahn auf kesh');
  const S = { g, c, p, aw, bahn, me: [], rngN: 0, rngFremd: 0 };
  S.ev = (kind) => c.inbox.filter((m) => m.t === 'event' && m.kind === kind);
  S.lauf = (sek, vor) => { for (let k = 0; k < Math.round(sek / DT); k++) { if (vor) vor(); g.step(); } };
  S.setze = (dx) => Physics.tileCenter(bahn.tx + dx, bahn.ty);
  S.platz = (dx) => { const q = S.setze(dx); p.x = q.x; p.y = q.y; p.input.mx = 0; p.input.my = 0; };
  S.kreatur = (dx, o) => {
    o = o || {};
    const q = S.setze(dx);
    const K = Kreatur.erzeugen(g, o.typ || 'teststill', q.x, q.y + (o.dy || 0));
    K.facing = o.facing == null ? Math.PI : o.facing;
    if (o.seg != null) { K.seg = o.seg; K.max = Math.max(K.max, o.seg); K.hp = o.seg; }
    if (o.wunden != null) K.wunden = { n: o.wunden, max: o.wunden };
    if (o.frontArc != null) K.frontArc = o.frontArc;
    return K;
  };
  S.waffe = (w) => { const k = combat.kaempfer(g, p); k.waffe = w; k.hitze = 0; k.gesperrtBis = 0; k.bereitAt = 0; k.ladung = null; k.ausholen = null; };
  // Beobachter für die Guards (Missionsereignisse, Zufallsverbrauch aus aw.rng)
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { S.me.push(nm); return m0(nm, d); };
  // Zufallsverbrauch zählen; rngFremd = Aufrufe, die aus squad.js (Funkspruch/Trupp) oder kreatur.js kommen (Schüsse des Spielers ziehen selbst Streuung aus aw.rng)
  const r0 = aw.rng; aw.rng = (...a) => { S.rngN++; if (/squad\.js|kreatur\.js/.test(new Error().stack)) S.rngFremd++; return r0(...a); };
  return S;
}
const getroffen = (k) => k.seg < k.max || k.wunden.n < k.wunden.max || (k.zustand || 'ok') !== 'ok' || !k.alive;
// Guards: nach Treffer/Fall nichts von der Drohnen-Logik
function sauber(S, was) {
  ok(Object.keys(S.aw.squads).length === 0, was + ': kein Phantom-Trupp (aw.squads leer: ' + JSON.stringify(Object.keys(S.aw.squads)) + ')');
  ok(S.ev('bark').length === 0, was + ': kein Funkspruch (bark)');
  ok(!S.me.includes('droneKilled') && !S.me.includes('enemyUp'), was + ': kein droneKilled/enemyUp (' + S.me.filter((x) => /droneKilled|enemyUp/.test(x)).join(',') + ')');
  ok(S.rngFremd === 0, was + ': kein Zufall aus squad.js/kreatur.js (' + S.rngFremd + ' von ' + S.rngN + ' aw.rng-Aufrufen)');
  ok(S.g.errors === 0, was + ': g.errors = ' + S.g.errors);
}
const schuss = (S, w, dx, o) => { S.platz(0); const K = S.kreatur(dx, o); S.waffe(w); away.shoot(S.g, S.p, 0); return K; };

section('Projektil (Blaster)', () => {
  const S = szene(); const K = schuss(S, 'blaster', 6); S.lauf(1.0);
  ok(K.seg === 2 && K.max === 3, 'Schild 3 -> 2 (seg=' + K.seg + ')');
  ok(S.ev('enemyShieldHit').length === 1, 'Ereignis enemyShieldHit 1');
  sauber(S, 'Projektil');
  // eigener Trefferradius (40 px beim Typ testgross): 30 px neben der Schusslinie trifft die Kreatur (Drohnen-Tabelle 13 px träfe nicht, auch nicht mit Streuung)
  const S2 = szene(); const K2 = schuss(S2, 'blaster', 6, { typ: 'testgross', dy: 30 }); S2.lauf(1.0);
  ok(K2.seg === 2, 'Radius aus der Kreatur: Treffer 30 px neben der Linie (seg=' + K2.seg + ')');
  const S3 = szene(); const K3 = schuss(S3, 'blaster', 6, { dy: 30 }); S3.lauf(1.0);
  ok(K3.seg === 3, 'außerhalb des Radius (18 px beim Typ teststill, Abstand 30 px): kein Treffer');
});

section('Granate (Fläche)', () => {
  const S = szene(); S.platz(0); const K = S.kreatur(6); S.waffe('granatwerfer'); S.g.handleMessage(S.c, { t: 'shoot', angle: 0, dist: 6 }); S.lauf(1.6);
  ok(K.seg === 2, 'Schild 3 -> 2 (seg=' + K.seg + ')');
  ok(S.ev('enemyShieldHit').length >= 1, 'enemyShieldHit gemeldet');
  sauber(S, 'Granate');
});

section('Nahkampf (Wunde)', () => {
  const S = szene(); const K = schuss(S, 'nahkampf', 1, { seg: 0, wunden: 2 }); S.lauf(1.2);
  ok(K.wunden.n === 1 && K.wunden.max === 2, 'Wunden 2 -> 1 (' + K.wunden.n + '/' + K.wunden.max + ')');
  ok(K.alive && (K.zustand || 'ok') === 'ok', 'steht noch');
  sauber(S, 'Nahkampf');
});

section('Lanze gegen Frontbogen (durchschlagFront)', () => {
  const S = szene(); S.platz(0); const K = S.kreatur(6, { frontArc: 120, facing: Math.PI }); S.waffe('lanze'); S.lauf(0.1); away.shoot(S.g, S.p, 0);
  for (let i = 0; i < 40; i++) S.lauf(0.05, () => { if (S.p.ladung) away.shoot(S.g, S.p, 0); });
  away.shoot(S.g, S.p, 0, { los: true }); S.lauf(0.3);
  ok(S.ev('lanzeSchuss').length === 1, 'Lanze hat geschossen (lanzeSchuss ' + S.ev('lanzeSchuss').length + ')');
  ok(K.seg === 1, 'Schild 3 -> 1 (Schaden 2, geht durch den Frontbogen; seg=' + K.seg + ')');
  ok(S.ev('abgelenkt').length === 0, 'nicht abgelenkt');
  sauber(S, 'Lanze');
});

section('Frontarc: von vorn abgelenkt, von hinten Schaden', () => {
  let S = szene(); let K = schuss(S, 'blaster', 6, { frontArc: 120, facing: Math.PI }); S.lauf(1.0);   // schaut zum Schützen
  ok(K.seg === 3, 'von vorn: Schild unverändert (seg=' + K.seg + ')');
  ok(S.ev('abgelenkt').length === 1, 'von vorn: abgelenkt 1');
  ok(S.ev('wardenDeflect').length === 1, 'Ereignisname wardenDeflect (unverändert, für Kreaturen mitverwendet)');
  ok(S.aw.stats.deflects === 1, 'aw.stats.deflects zählt mit (' + S.aw.stats.deflects + ')');
  sauber(S, 'Front von vorn');
  S = szene(); K = schuss(S, 'blaster', 6, { frontArc: 120, facing: 0 }); S.lauf(1.0);   // schaut vom Schützen weg
  ok(K.seg === 2, 'von hinten: Schaden (seg=' + K.seg + ')');
  ok(S.ev('abgelenkt').length === 0, 'von hinten: nicht abgelenkt');
  sauber(S, 'Front von hinten');
});

section('Orbitalschlag', () => {
  const S = szene(); S.platz(0); const K = S.kreatur(6);
  S.aw.pendingStrikes.push({ x: K.x, y: K.y, at: S.g.time + 0.1 }); S.lauf(0.6);
  ok(K.seg === 0, 'Schild 3 -> 0 (strikeSegments; seg=' + K.seg + ')');
  sauber(S, 'Orbitalschlag');
});

section('Fall bei letzter Wunde, Aufstehen', () => {
  const S = szene(); const K = schuss(S, 'nahkampf', 1, { seg: 0, wunden: 1 }); S.lauf(1.5);
  ok(K.zustand === 'verwundet' && K.alive === false && K.liegt === true, 'verwundet, alive=false, liegt (' + K.zustand + ', ' + K.alive + ', ' + K.liegt + ')');
  ok(S.ev('enemyDown').length === 1, 'enemyDown 1');
  sauber(S, 'Fall');
  // Betäuber: bewusstlos -> liegt -> wacht auf -> steht wieder (Wf.update + folgenAbgleich)
  const T = szene(); T.platz(0); const B = T.kreatur(6, { seg: 0, wunden: 2 });
  B.zustand = 'bewusstlos'; B.bewusstBis = T.g.time + 0.5; T.lauf(0.2);
  ok(B.alive === false && B.liegt === true, 'bewusstlos: liegt');
  T.lauf(0.7);
  ok(B.zustand === 'ok' && B.alive === true && B.liegt === false, 'aufgewacht: steht wieder (' + B.zustand + ', alive=' + B.alive + ')');
  sauber(T, 'Aufwachen');
});

section('Tote/liegende Kreatur bewegt sich nicht, lebende schon', () => {
  const S = szene(); S.platz(0);
  const K = S.kreatur(8, { typ: 'probe' }); Kreatur.zustandSetzen(S.g, K, 'jagd');
  const k0 = { x: K.x, y: K.y };
  K.alive = false; K.liegt = true; K.zustand = 'verwundet';
  S.lauf(1.0);
  ok(K.x === k0.x && K.y === k0.y, 'liegend: keine Bewegung');
  const S2 = szene(); S2.platz(0);   // gleiche Lage wie die lebende Kontrolle unten, aber alive=false bei Zustand ok (kein Zustandsfeld, das den Stillstand schon erzwingt)
  const T = S2.kreatur(8, { typ: 'probe', dy: 3 * TILE }); Kreatur.zustandSetzen(S2.g, T, 'jagd'); const t0 = { x: T.x, y: T.y };
  T.alive = false; T.zustand = 'ok';
  S2.lauf(1.0);
  ok(T.x === t0.x && T.y === t0.y, 'alive=false (Zustand ok): keine Bewegung');
  const L = S.kreatur(8, { typ: 'probe', dy: 3 * TILE }); Kreatur.zustandSetzen(S.g, L, 'jagd'); const l0 = { x: L.x, y: L.y };
  S.lauf(1.0);
  ok(Math.hypot(L.x - l0.x, L.y - l0.y) > 5, 'lebend: bewegt sich (Kontrolle der Messung)');
});

section('Schildregeneration nur per Datenfeld', () => {
  let S = szene(); let K = S.kreatur(6, { seg: 3 }); K.seg = 1; K.hp = 1; K.lastHitAt = S.g.time; S.lauf(6);
  ok(K.seg === 1, 'ohne schildRegen keine Regeneration (seg=' + K.seg + ')');
  S = szene(); K = S.kreatur(6, { typ: 'testregen' }); K.seg = 1; K.hp = 1; K.lastHitAt = S.g.time; S.lauf(1.2);
  ok(K.seg === 1, 'Verzögerung 1,5 s: nach 1,2 s noch keine Regeneration (seg=' + K.seg + ')');
  S.lauf(3);
  ok(K.seg === 3, 'mit schildRegen volles Schild nach Verzögerung (seg=' + K.seg + ')');
  const ZIEL = JSON.stringify(Kreatur.pruefen({ version: 1, typen: { x: Object.assign({}, STILL, { schildRegen: { verzoegerung: -1 } }) } }));
  ok(/schildRegen/.test(ZIEL), 'Validator lehnt kaputtes schildRegen ab');
});

section('Kontrolle: echte Drohne mit denselben Schüssen', () => {
  const mk = (S, dx) => { const e = squad.makeEnemy(S.g, S.aw, 'scavenger', 'D' + S.g.nextId(''), S.setze(dx), 'test'); e.asleep = false; e.frozen = true; e.rolle = 'grundtyp'; S.aw.drones.push(e); combat.kaempfer(S.g, e); return e; };
  let S = szene(); S.platz(0); let d = mk(S, 6); S.waffe('blaster'); away.shoot(S.g, S.p, 0); S.lauf(1.0);
  ok(d.seg < d.max, 'Drohne Blaster: Treffer (' + d.seg + '/' + d.max + ')');
  ok(Object.keys(S.aw.squads).length === 1 && S.aw.squads.test, 'Drohne: Trupp-Logik läuft weiter (Trupp "test")');
  S = szene(); S.platz(0); d = mk(S, 6); S.waffe('granatwerfer'); S.g.handleMessage(S.c, { t: 'shoot', angle: 0, dist: 6 }); S.lauf(1.6);
  ok(d.seg < d.max, 'Drohne Granate: Treffer (' + d.seg + '/' + d.max + ')');
  S = szene(); S.platz(0); d = mk(S, 1); S.waffe('nahkampf'); away.shoot(S.g, S.p, 0); S.lauf(1.2);
  ok(d.wunden.n < d.wunden.max || (d.zustand || 'ok') !== 'ok', 'Drohne Nahkampf: Treffer (' + d.wunden.n + '/' + d.wunden.max + ', ' + d.zustand + ')');
  // Drohne fällt: droneKilled und Trupp-Ereignis kommen weiterhin
  S = szene(); S.platz(0); d = mk(S, 1); d.wunden = { n: 1, max: 1 }; d.seg = 0; d.hp = 0; S.waffe('nahkampf'); away.shoot(S.g, S.p, 0); S.lauf(1.5);
  ok(S.me.includes('droneKilled'), 'Drohne fällt: droneKilled bleibt');
});

section('Kreatur und Drohne gemeinsam (Reihenfolge, Granate trifft beide)', () => {
  const S = szene(); S.platz(0);
  const e = squad.makeEnemy(S.g, S.aw, 'scavenger', 'DK1', S.setze(6), 'test'); e.asleep = false; e.frozen = true; e.rolle = 'grundtyp'; S.aw.drones.push(e); combat.kaempfer(S.g, e);
  const K = S.kreatur(6, { dy: 20 });
  ok(Kreatur.ziele(S.aw)[0] === e && Kreatur.ziele(S.aw)[1] === K && Kreatur.ziele(S.aw).length === 2, 'ziele: Drohnen zuerst, dann Kreaturen');
  S.waffe('granatwerfer'); S.g.handleMessage(S.c, { t: 'shoot', angle: 0, dist: 6 }); S.lauf(1.6);
  ok(e.seg < e.max && K.seg < K.max, 'Granate trifft Drohne (' + e.seg + ') und Kreatur (' + K.seg + ')');
  ok(Object.keys(S.aw.squads).join() === 'test', 'nur der Drohnen-Trupp existiert (' + Object.keys(S.aw.squads).join() + ')');
});

section('Leere/fehlende aw.kreaturen: dieselbe Referenz, identisches Verhalten', () => {
  const S = szene();
  ok(Kreatur.ziele(S.aw) === S.aw.drones, 'leere Liste: ziele === aw.drones');
  S.aw.kreaturen = undefined;
  ok(Kreatur.ziele(S.aw) === S.aw.drones, 'fehlende Liste: ziele === aw.drones');
  const lauf = (liste) => {
    const T = szene(5); T.aw.kreaturen = liste;
    const e = squad.makeEnemy(T.g, T.aw, 'scavenger', 'DL1', T.setze(6), 'test'); e.asleep = false; e.rolle = 'grundtyp'; T.aw.drones.push(e); combat.kaempfer(T.g, e);
    T.platz(0); T.waffe('sturmgewehr');
    for (let i = 0; i < 90; i++) { if (i % 6 === 0) { T.p.bereitAt = 0; T.p.hitze = 0; away.shoot(T.g, T.p, 0); } T.g.step(); }
    return JSON.stringify({ d: { x: e.x, y: e.y, seg: e.seg, hp: e.hp, z: e.zustand, w: e.wunden, alive: e.alive }, sq: Object.entries(T.aw.squads).map(([k, v]) => [k, v.alert, v.members && v.members.length]),
      rng: T.aw.rng(), ev: T.c.inbox.filter((m) => m.t === 'event').map((m) => m.kind), err: T.g.errors, laerm: T.aw.laerm });
  };
  const a = lauf([]), b = lauf(undefined);
  ok(a === b, 'Lauf mit [] und ohne Feld byte-gleich (' + a.length + ' Zeichen)');
});

section('Kämpfer-Vertrag: Felder aus dem Typ der Kreatur', () => {
  const S = szene(); const K = S.kreatur(6, { typ: 'probe' });
  delete K.wunden; delete K.hitRadius; delete K.frontArc; K.facing = NaN;   // wie eine Kreatur, die ohne die Felder angelegt wurde
  const k = combat.kaempfer(S.g, K);
  ok(k === K && K.wunden.n === 3 && K.wunden.max === 3, 'Wunden aus dem Typ (3/3), nicht der Drohnen-Fallback (' + K.wunden.n + '/' + K.wunden.max + ')');
  ok(K.hitRadius === 24, 'hitRadius 24 aus dem Typ, nicht 13 der Drohnen-Tabelle (' + K.hitRadius + ')');
  ok(K.frontArc === 120, 'frontArc 120 aus dem Typ (' + K.frontArc + ')');
  ok(Number.isFinite(K.facing), 'facing endlich (' + K.facing + ')');
  ok(K.schild && K.schild.seg === 4 && K.schild.max === 4, 'Schild-Alias seg/max 4/4');
  ok(S.aw.kreaturen.includes(K) && !S.aw.drones.includes(K), 'Kreatur liegt nur in aw.kreaturen');
});

section('Betäubte Kreatur steht still', () => {
  const S = szene(); S.platz(0);
  const K = S.kreatur(8, { typ: 'probe' }); Kreatur.zustandSetzen(S.g, K, 'jagd');
  K.betaeubtBis = S.g.time + 5; const k0 = { x: K.x, y: K.y };
  S.lauf(1.0);
  ok(K.x === k0.x && K.y === k0.y, 'betäubt: keine Bewegung');
});

section('raeumen: Kreaturen der Karte entfernen (Szenario-Start)', () => {
  const S = szene(); S.kreatur(6); S.kreatur(8);
  ok(S.aw.kreaturen.length === 2, 'zwei Kreaturen angelegt');
  Kreatur.raeumen(S.aw);
  ok(S.aw.kreaturen.length === 0 && Kreatur.ziele(S.aw) === S.aw.drones, 'nach raeumen leer, ziele wieder aw.drones');
  Kreatur.raeumen({ drones: [] }); Kreatur.raeumen(null);   // ohne Liste und ohne Karte: kein Fehler
  ok(true, 'raeumen ohne Liste/Karte wirft nicht');
});

section('Szenario-Start (Graben, Wellen) räumt Kreaturen der Karte', () => {
  // Der Start ruft combat.ensureV2 unmittelbar vor dem Reset der Karte: dort wird je eine Kreatur in aw.kreaturen gelegt (die Karte war vorher belegt).
  const orig = combat.ensureV2;
  const spiel = (modus, opt) => {
    let gepflanzt = 0;
    combat.ensureV2 = function (game, aw, salt) { const r = orig.apply(this, arguments); if (aw && !gepflanzt) { aw.kreaturen = [{ id: 'KX', kind: 'kreatur', kreatur: true, typ: 'teststill', alive: true, x: 100, y: 100 }]; gepflanzt = 1; } return r; };
    try {
      const g = new Game({ noStore: true, seed: 13, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
      const c = { inbox: [], send(m) { if (this.inbox.length < 500) this.inbox.push(m); } };
      g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'Z0', name: 'Z0', color: 0 });
      g.handleMessage(c, { t: 'lobbyOpt', startMission: modus, ...opt }); g.handleMessage(c, { t: 'ready', ready: true });
      return { g, gepflanzt };
    } finally { combat.ensureV2 = orig; }
  };
  for (const [modus, opt] of [['arena_graben', {}], ['arena_away', { wellen: 'kesh' }]]) {
    const r = spiel(modus, opt);
    const aw = r.g.away;
    ok(r.gepflanzt === 1 && aw && Array.isArray(aw.kreaturen) && aw.kreaturen.length === 0, modus + ': Kreatur vor dem Start gepflanzt, danach Karte ohne Kreaturen (' + (aw && aw.kreaturen ? aw.kreaturen.length : 'keine Liste') + ')');
  }
});

console.log('\n' + (fails ? 'FEHLER ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen ok'));
process.exit(fails ? 1 : 0);
