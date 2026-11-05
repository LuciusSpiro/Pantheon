'use strict';
// MON-01 P3: Baustein `bindung` des Kreaturen-Rahmens (server/sim/kreatur.js): eine Kreatur hängt an Ankern oder an anderen Kreaturen; fällt die Bindung weg, löst sie sich auf.
// Echtes Spiel (Game) auf der gebauten Karte kesh.kastell (Anker `beute` innerstes.beute.1/.2 gleicher Rolle, Zustände voll/leer, ohne Nebenwirkung beim Setzen). Testtypen nur als Datenzeilen.
// Geprüft: (a) zwei Anker im Zielzustand innerhalb des Fensters löst auf (Ereignis, Entfernung, kein droneKilled/enemyDown, keine Trupps), (b) zweiter Eintritt nach Ablauf des Fensters löst nicht auf,
// (c) ein Anker genügt nicht, (d) ohne Fenster nur Gleichzeitigkeit, (e) Verlassen und erneuter Eintritt, Anker schon beim Anlegen im Zustand, Rolle statt IDs, Verzögerung (auch endgültig nach Auslösung),
// (f) Kreatur-Quelle (Typ und ID, Tod und Entfernung der Königin, Verzögerung, tote Gebundene), (g) mehrere gebundene Kreaturen unabhängig, (h) Validator und Fehler beim Anlegen (halbe Kreatur gibt es nicht),
// (i) der Baustein schreibt nie in Anker, (j) Verhalten ohne Bindungs-Baustein bytegleich zum Stand vor P3 (Zufallsstrom, aw-JSON), (k) Tick-Kosten mit 20 gebundenen Kreaturen.
//   node tools/test-kreatur-bindung.js   (npm run test:kreatur-bindung)
const crypto = require('crypto');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const L = require('../server/sim/landepunkte.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');

const DT = 1 / CONFIG.tickHz;
const KARTE = 'kesh.kastell';
const A1 = 'innerstes.beute.1', A2 = 'innerstes.beute.2';
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const kopie = (o) => JSON.parse(JSON.stringify(o));
const wirft = (fn) => { try { fn(); return null; } catch (e) { return String(e.message); } };

// ---------- Testtypen (nur Datenzeilen) ----------
const BASIS = { groesse: 2, sicht: 4, verlustZeit: 3, replan: 0.5, hitRadius: 18, schild: { seg: 6, max: 6 }, wunden: 2, frontArc: 0, tuerenAufbrechen: false, rammZeit: 1.2 };
const STEHT = { steht: { modus: 'steht', tempo: 0, uebergang: [] } };
const typ = (name, bindung) => { KREATUREN.typen[name] = Object.assign({ name: 'kreatur.' + name }, kopie(BASIS), { start: 'steht', zustaende: kopie(STEHT), bausteine: bindung ? { bindung } : {} }); };
const anker = (ids, zustand, fenster, verz) => ({ quelle: { art: 'anker', ids }, bedingung: Object.assign({ zustand }, fenster !== undefined ? { fenster } : {}), folge: Object.assign({ art: 'aufloesen' }, verz !== undefined ? { verzoegerung: verz } : {}) });
typ('tb_koenigin', null);
typ('tb_ohne', null);
typ('tb_fenster', anker([A1, A2], 'leer', 5));
typ('tb_offen', anker([A1, A2], 'leer'));              // ohne Fenster
typ('tb_rolle', { quelle: { art: 'anker', rolle: 'beute' }, bedingung: { zustand: 'leer', fenster: 5 }, folge: { art: 'aufloesen' } });
typ('tb_verz', anker([A1, A2], 'leer', 5, 2));
typ('tb_eins', anker([A1], 'leer'));                    // ein einziger Anker
typ('tb_gefolge', { quelle: { art: 'kreatur', typ: 'tb_koenigin' }, folge: { art: 'aufloesen' } });
typ('tb_zwilling', { quelle: { art: 'kreatur', typ: 'tb_zwilling' }, folge: { art: 'aufloesen' } });   // an den eigenen Typ gebunden
typ('tb_rammer', null); KREATUREN.typen.tb_rammer.zustaende = { ramme: { modus: 'ramme', tempo: 60, uebergang: [] } }; KREATUREN.typen.tb_rammer.start = 'ramme';
KREATUREN.typen.tb_rammer.bausteine = { zyklus: { hindernisAb: 0.5 }, rammschaden: { radius: 30 } };
KREATUREN.typen.tb_rammgefolge = JSON.parse(JSON.stringify(KREATUREN.typen.tb_rammer)); KREATUREN.typen.tb_rammgefolge.name = 'kreatur.tb_rammgefolge';
KREATUREN.typen.tb_rammgefolge.bausteine.bindung = { quelle: { art: 'kreatur', typ: 'tb_koenigin' }, folge: { art: 'aufloesen' } };
typ('tb_gefolge_verz', { quelle: { art: 'kreatur', typ: 'tb_koenigin' }, folge: { art: 'aufloesen', verzoegerung: 1 } });

// ---------- Szene: echtes Spiel auf kesh.kastell ----------
function szene(seed) {
  const g = new Game({ noStore: true, seed: seed || 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw() {} };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Bin', color: 0 });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  const aw = L.get(g, KARTE);
  g.setAwayMap(KARTE); aw.active = true;
  const p = g.players[0];
  interior.placeOnAwayPad(g, p, 0); combat.onArrive(g, p);
  g.god = true;
  combat.ensureV2(g, aw);
  aw.drones.length = 0; aw.kreaturen = [];
  const S = { g, c, p, aw, me: [], ev: [], fehler: [] };
  const ce0 = g.countError.bind(g); g.countError = (wo, e) => { S.fehler.push(wo + ': ' + (e && e.message)); return ce0(wo, e); };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { S.me.push([nm, d]); return m0(nm, d); };
  const e0 = g.emit.bind(g); g.emit = (kind, d) => { S.ev.push([kind, d]); return e0(kind, d); };
  S.zahl = (liste, nm) => liste.filter((e) => e[0] === nm).length;
  S.lauf = (sek) => { for (let k = 0; k < Math.round(sek / DT); k++) g.step(); };
  S.anker = (id, z) => { const e = Anker.setzen(g, KARTE, id, z, null); if (e) throw new Error(e); };
  S.kreatur = (t, dx) => Kreatur.erzeugen(g, t, p.x + (dx || 0) * 20, p.y);
  S.da = (K) => aw.kreaturen.includes(K);
  return S;
}

section('Daten: Testtypen gültig', () => {
  ok(Kreatur.pruefen(KREATUREN).length === 0, 'Validator: alle Testtypen (inkl. bindung) gültig: ' + Kreatur.pruefen(KREATUREN).join(' | '));
  ok(!KREATUREN.typen.probe.bausteine.bindung, 'probe trägt keine Bindung');
});

section('(a) zwei Anker im Zielzustand innerhalb des Fensters: Kreatur löst sich auf', () => {
  const S = szene(); const K = S.kreatur('tb_fenster'); const id = K.id;
  const trupps0 = JSON.stringify(Object.keys(S.aw.squads || {})), drohnen0 = S.aw.drones.length;
  S.lauf(0.5); ok(S.da(K) && !K.weg, 'ohne Anker im Zustand bleibt sie');
  S.anker(A1, 'leer'); S.lauf(2); ok(S.da(K), 'ein Anker im Zustand: bleibt');
  S.anker(A2, 'leer'); S.lauf(0.3);
  ok(!S.da(K) && S.aw.kreaturen.length === 0, 'beide innerhalb des Fensters: aus aw.kreaturen entfernt');
  const ev = S.ev.filter((e) => e[0] === 'kreaturAufgeloest');
  ok(ev.length === 1 && ev[0][1].id === id && ev[0][1].typ === 'tb_fenster' && Number.isFinite(ev[0][1].x) && Number.isFinite(ev[0][1].y), 'Ereignis kreaturAufgeloest {id, typ, x, y} genau einmal');
  ok(S.zahl(S.me, 'kreaturAufgeloest') === 1, 'Missionsereignis kreaturAufgeloest genau einmal');
  ok(S.zahl(S.me, 'droneKilled') === 0 && S.zahl(S.ev, 'enemyDown') === 0 && S.zahl(S.ev, 'explosion') === 0, 'kein droneKilled, kein enemyDown, keine Explosion (kein Fall)');
  ok(S.aw.drones.length === drohnen0 && JSON.stringify(Object.keys(S.aw.squads || {})) === trupps0, 'keine Drohne und kein Trupp (kein Phantom)');
  S.lauf(1); ok(S.zahl(S.ev, 'kreaturAufgeloest') === 1, 'danach kein zweites Ereignis');
  ok(!S.fehler.some((f) => /^(combat|kreatur|anker)/.test(f)), 'keine Fehler aus Kampf, Kreaturen, Ankern (' + S.fehler.filter((f) => /^(combat|kreatur|anker)/.test(f)).join('; ') + ')');
});

section('(b) zweiter Eintritt nach Ablauf des Fensters: löst nicht auf', () => {
  const S = szene(); const K = S.kreatur('tb_fenster');
  S.anker(A1, 'leer'); S.lauf(4.5); S.anker(A2, 'leer'); S.lauf(0.3);
  ok(!S.da(K), 'Kontrolle: 4,5 s Abstand (Fenster 5 s) löst auf');
  const S2 = szene(); const K2 = S2.kreatur('tb_fenster');
  S2.anker(A1, 'leer'); S2.lauf(5.6); S2.anker(A2, 'leer'); S2.lauf(0.5);
  ok(S2.da(K2) && S2.zahl(S2.ev, 'kreaturAufgeloest') === 0, '5,6 s Abstand: bleibt');
  S2.lauf(10); ok(S2.da(K2), 'bleibt auch später, solange kein neuer Eintritt kommt');
});

section('(c) nur ein Anker', () => {
  const S = szene(); const K = S.kreatur('tb_fenster'); const K1 = S.kreatur('tb_eins', 1);
  S.anker(A1, 'leer'); S.lauf(3);
  ok(S.da(K), 'zwei gebundene Anker, nur einer im Zustand: bleibt');
  ok(!S.da(K1), 'Kontrolle: Bindung an genau diesen einen Anker löst auf');
  S.anker(A1, 'voll'); S.anker(A2, 'leer'); S.lauf(3); ok(S.da(K), 'der andere allein: bleibt');
  const S2 = szene(); const K2 = S2.kreatur('tb_fenster'); S2.anker(A1, 'leer'); S2.anker(A2, 'voll'); S2.lauf(2);
  ok(S2.da(K2), 'zweiter Anker in einem anderen Zustand (voll): bleibt');
});

section('(d) ohne Fenster: nur Gleichzeitigkeit', () => {
  const S = szene(); const K = S.kreatur('tb_offen');
  S.anker(A1, 'leer'); S.lauf(60); ok(S.da(K), 'nach 60 s mit einem Anker: bleibt');
  S.anker(A2, 'leer'); S.lauf(0.3); ok(!S.da(K), 'zweiter Anker nach 60 s: löst auf (kein Zeitfenster)');
  const S0 = szene(); const Kn = S0.kreatur('tb_offen'); S0.anker(A1, 'voll'); S0.anker(A2, 'voll'); S0.lauf(1); ok(S0.da(Kn), 'beide im Startzustand: bleibt');
  const T = kopie(KREATUREN.typen.tb_offen); T.bausteine.bindung.bedingung.fenster = 0; KREATUREN.typen.tb_offen0 = T;
  const S1 = szene(); const K0 = S1.kreatur('tb_offen0'); S1.anker(A1, 'leer'); S1.lauf(40); S1.anker(A2, 'leer'); S1.lauf(0.3); ok(!S1.da(K0), 'fenster 0 wie fehlend');
});

section('(e) Verlassen und erneuter Eintritt (Fenster zählt ab dem NEUEN Eintritt)', () => {
  const S = szene(); const K = S.kreatur('tb_fenster');
  S.anker(A1, 'leer'); S.lauf(7); S.anker(A2, 'leer'); S.lauf(0.3);
  ok(S.da(K), 'A1 seit 7 s, A2 neu: bleibt (A1 zu alt)');
  S.anker(A1, 'voll'); S.lauf(0.3); S.anker(A1, 'leer'); S.lauf(0.3);
  ok(!S.da(K), 'A1 verlässt den Zustand und tritt erneut ein: neuer Eintritt, beide innerhalb 5 s, löst auf');
});
section('(e3) Anker schon beim Anlegen im Zustand', () => {
  const S = szene(); S.anker(A1, 'leer'); S.anker(A2, 'leer');
  const Kf = S.kreatur('tb_fenster'); const Ko = S.kreatur('tb_offen', 1);
  S.lauf(0.5);
  ok(S.da(Kf), 'mit Fenster: Eintritt unbekannt, löst nicht auf');
  ok(!S.da(Ko), 'ohne Fenster: beide im Zustand, löst sofort auf');
  S.anker(A1, 'voll'); S.lauf(0.2); S.anker(A1, 'leer'); S.lauf(0.3);
  ok(S.da(Kf), 'mit Fenster: A1 tritt neu ein, A2 hat weiter unbekannten Eintritt: bleibt');
  S.anker(A2, 'voll'); S.lauf(0.2); S.anker(A2, 'leer'); S.lauf(0.3);
  ok(!S.da(Kf), 'mit Fenster: auch A2 hat verlassen und neu betreten: löst auf');
});
section('(e4) Rolle statt IDs', () => {
  const S = szene(); const K = S.kreatur('tb_rolle');
  S.anker(A1, 'leer'); S.lauf(1); ok(S.da(K), 'ein Anker der Rolle beute: bleibt');
  S.anker(A2, 'leer'); S.lauf(0.3); ok(!S.da(K), 'alle (beide) Anker der Rolle beute im Zustand: löst auf');
  const k = require('../server/world.js').AWAY_MAPS[KARTE].karte; const beute = k.anker.filter((a) => a.rolle === 'beute').length;
  ok(beute === 2, 'Karte hat genau zwei beute-Anker (Annahme der Rollen-Prüfung)');
});
section('(e5) Verzögerung', () => {
  const S = szene(); const K = S.kreatur('tb_verz');
  S.anker(A1, 'leer'); S.anker(A2, 'leer'); S.lauf(1.5);
  ok(S.da(K) && S.zahl(S.ev, 'kreaturAufgeloest') === 0, 'nach 1,5 s (Verzögerung 2 s): noch da, kein Ereignis');
  S.anker(A1, 'voll'); S.lauf(0.3); ok(S.da(K), 'Anker verlässt den Zustand während der Verzögerung: noch da');
  S.lauf(0.4); ok(!S.da(K) && S.zahl(S.ev, 'kreaturAufgeloest') === 1, 'nach 2 s: aufgelöst, trotz verlassenem Zustand (einmal ausgelöst, endgültig)');
});

section('(f) Kreatur-Quelle', () => {
  const S = szene(); const Q = S.kreatur('tb_koenigin'); const F = S.kreatur('tb_gefolge', 1); const FV = S.kreatur('tb_gefolge_verz', 2);
  S.lauf(3); ok(S.da(F) && S.da(FV) && S.da(Q), 'solange die Königin lebt: Gefolge bleibt');
  Q.alive = false; S.lauf(0.3);
  ok(!S.da(F), 'Königin tot: Gefolge ohne Verzögerung aufgelöst');
  ok(S.da(FV) && S.zahl(S.ev, 'kreaturAufgeloest') === 1, 'mit Verzögerung 1 s: noch da');
  S.lauf(1); ok(!S.da(FV) && S.zahl(S.ev, 'kreaturAufgeloest') === 2, 'nach 1 s: aufgelöst');
  ok(S.da(Q) && S.zahl(S.me, 'droneKilled') === 0, 'die tote Königin bleibt liegen, kein droneKilled');
  const S2 = szene(); const Q2 = S2.kreatur('tb_koenigin'); const F2 = S2.kreatur('tb_gefolge', 1);
  S2.aw.kreaturen.splice(S2.aw.kreaturen.indexOf(Q2), 1); S2.lauf(0.3); ok(!S2.da(F2), 'Königin verschwindet aus der Liste: Gefolge aufgelöst');
  // zwei Königinnen: erst die letzte entlässt
  const S3 = szene(); const Qa = S3.kreatur('tb_koenigin'); const Qb = S3.kreatur('tb_koenigin', 1); const F3 = S3.kreatur('tb_gefolge', 2);
  Qa.alive = false; S3.lauf(0.5); ok(S3.da(F3), 'zwei Königinnen, eine fällt: bleibt'); Qb.alive = false; S3.lauf(0.3); ok(!S3.da(F3), 'beide gefallen: aufgelöst');
  // Quelle über ID
  const S4 = szene(); const Q4 = S4.kreatur('tb_koenigin'); const Q5 = S4.kreatur('tb_koenigin', 1);
  KREATUREN.typen.tb_gefolge_id = Object.assign(kopie(KREATUREN.typen.tb_gefolge), { name: 'kreatur.tb_gefolge_id' }); KREATUREN.typen.tb_gefolge_id.bausteine.bindung.quelle = { art: 'kreatur', id: Q4.id };
  let F4 = null; const m4 = wirft(() => { F4 = S4.kreatur('tb_gefolge_id', 2); });
  ok(!m4 && F4, 'Quelle per ID: Anlegen gelingt, wenn genau diese Kreatur lebt (' + m4 + ')');
  if (F4) {
    Q5.alive = false; S4.lauf(0.5); ok(S4.da(F4), 'Quelle per ID: eine andere Königin gleichen Typs fällt, bleibt');
    Q4.alive = false; S4.lauf(0.3); ok(!S4.da(F4), 'Quelle per ID: genau diese fällt, aufgelöst');
  }
  // an den eigenen Typ gebunden: die gebundene Kreatur zählt sich nicht selbst als lebende Quelle
  const S8 = szene(); const zw = KREATUREN.typen.tb_zwilling.bausteine; KREATUREN.typen.tb_zwilling.bausteine = {};
  const Z1 = S8.kreatur('tb_zwilling'); KREATUREN.typen.tb_zwilling.bausteine = zw; const Z2 = S8.kreatur('tb_zwilling', 1);
  S8.lauf(1); ok(S8.da(Z1) && S8.da(Z2), 'Zwilling: solange der erste lebt, bleibt der gebundene');
  Z1.alive = false; S8.lauf(0.3); ok(!S8.da(Z2), 'Zwilling: der erste fällt, der gebundene löst sich auf (zählt sich nicht selbst)');
  // tote Gebundene werden nicht mehr geprüft
  const S5 = szene(); const Q6 = S5.kreatur('tb_koenigin'); const F5 = S5.kreatur('tb_gefolge', 1); F5.alive = false; Q6.alive = false; S5.lauf(0.5);
  ok(S5.da(F5) && S5.zahl(S5.ev, 'kreaturAufgeloest') === 0, 'eine tote Gebundene bleibt liegen (kein Ereignis)');
  // ohne Außenteam und betäubt: Abgleich läuft trotzdem
  const S6 = szene(); const Q7 = S6.kreatur('tb_koenigin'); const F6 = S6.kreatur('tb_gefolge', 1);
  S6.p.zone = 'ship'; Q7.alive = false; S6.lauf(0.3); ok(!S6.da(F6), 'ohne Spieler am Boden: Auflösung trotzdem');
  const S7 = szene(); const Q8 = S7.kreatur('tb_koenigin'); const F7 = S7.kreatur('tb_gefolge', 1); F7.betaeubtBis = S7.g.time + 100; Q8.alive = false; S7.lauf(0.3);
  ok(!S7.da(F7), 'betäubt (nicht handlungsfähig): Auflösung trotzdem');
});

// Liegt eine Kreatur nach combat.faellt (alive=false, zustand bewusstlos), zählt sie als Quelle, bis sie endgültig erledigt ist
const bewusstlos = (S, K, sek) => { const kk = combat.kaempfer(S.g, K); kk.zustand = 'bewusstlos'; kk.bewusstBis = S.g.time + sek; return kk; };
section('(f2) bewusstlose Königin: Gefolge bleibt, bis sie endgültig erledigt ist', () => {
  const S = szene(); const Q = S.kreatur('tb_koenigin'); const F = S.kreatur('tb_gefolge', 1); const Z = S.kreatur('tb_gefolge_verz', 2);
  S.lauf(0.5); bewusstlos(S, Q, 10); S.lauf(1);
  ok(!Q.alive && Q.zustand === 'bewusstlos', 'Kontrolle: Königin liegt bewusstlos (alive=false, zustand bewusstlos)');
  ok(S.da(F) && S.da(Z) && S.zahl(S.ev, 'kreaturAufgeloest') === 0, 'bewusstlose Königin: Gefolge bleibt');
  S.lauf(4); ok(S.da(F) && S.da(Z), 'auch nach 5 s Bewusstlosigkeit');
  S.lauf(8); ok(Q.alive && Q.zustand === 'ok', 'Kontrolle: Königin ist wieder aufgestanden');
  ok(S.da(F) && S.da(Z) && S.zahl(S.ev, 'kreaturAufgeloest') === 0, 'Königin wacht wieder auf: Gefolge bleibt, kein Ereignis');
  S.lauf(2); ok(S.da(F), 'und bleibt auch danach');
  Q.alive = false; Q.zustand = 'verwundet'; Q.liegt = true; S.lauf(0.3);
  ok(!S.da(F) && S.zahl(S.ev, 'kreaturAufgeloest') >= 1, 'Königin danach tot (verwundet): Gefolge löst sich auf');
  const S2 = szene(); const Q2 = S2.kreatur('tb_koenigin'); const F2 = S2.kreatur('tb_gefolge', 1);
  S2.lauf(0.5); bewusstlos(S2, Q2, 10); S2.lauf(1); ok(S2.da(F2), 'zweiter Lauf: bewusstlos, Gefolge da');
  Q2.zustand = 'verwundet'; S2.lauf(0.3); ok(!S2.da(F2), 'bewusstlose Königin verwundet (endgültig): Gefolge löst sich auf');
  const S3 = szene(); const Q3 = S3.kreatur('tb_koenigin'); const F3 = S3.kreatur('tb_gefolge', 1);
  S3.lauf(0.5); bewusstlos(S3, Q3, 10); S3.lauf(0.5); S3.aw.kreaturen.splice(S3.aw.kreaturen.indexOf(Q3), 1); S3.lauf(0.3);
  ok(!S3.da(F3), 'bewusstlose Königin verschwindet aus der Liste: Gefolge löst sich auf');
  const S4 = szene(); const Q4 = S4.kreatur('tb_koenigin'); const F4 = S4.kreatur('tb_gefolge', 1);
  Q4.weg = true; S4.g.step(); ok(!S4.da(F4), 'eine als aufgelöst markierte Kreatur (weg) zählt nicht als Quelle, auch nicht im selben Tick');
});
section('(f3) gebundene Kreatur liegt bewusstlos: Anker-Eintritte werden trotzdem zeitgenau erfasst', () => {
  const S = szene(); const K = S.kreatur('tb_fenster');
  S.lauf(0.3); bewusstlos(S, K, 10); S.lauf(0.3); const t0 = S.g.time;
  S.anker(A1, 'leer'); S.lauf(0.2);
  ok(!K.alive && K.zustand === 'bewusstlos', 'Kontrolle: die gebundene Kreatur liegt bewusstlos');
  ok(Math.abs(K.bindung.eintritt[0] - t0) < 0.1, 'Eintritt von A1 wird beim Liegen zeitgenau erfasst (' + K.bindung.eintritt[0] + ' statt ' + t0.toFixed(2) + ')');
  let wach = null; for (let i = 0; i < 40 / DT && wach == null; i++) { S.g.step(); if (K.alive) wach = S.g.time; }
  ok(wach != null && wach - t0 > 9, 'Kreatur wacht nach etwa 10 s auf');
  S.lauf(0.5); S.anker(A2, 'leer'); S.lauf(0.5);
  ok(S.da(K) && S.zahl(S.ev, 'kreaturAufgeloest') === 0, 'A2 über 10 s nach A1 (Fenster 5 s): löst sich NICHT auf');
  const S2 = szene(); const K2 = S2.kreatur('tb_fenster');
  S2.lauf(0.3); bewusstlos(S2, K2, 10); S2.lauf(0.3); S2.anker(A1, 'leer'); S2.lauf(1); S2.anker(A2, 'leer'); S2.lauf(0.3);
  ok(!S2.da(K2) && S2.zahl(S2.ev, 'kreaturAufgeloest') === 1, 'beide Anker innerhalb des Fensters, während die Kreatur liegt: löst sich auch liegend auf');
  const S3 = szene(); const K3 = S3.kreatur('tb_fenster'); S3.lauf(0.3); bewusstlos(S3, K3, 10); S3.lauf(0.3); K3.zustand = 'verwundet'; K3.liegt = true; S3.lauf(0.2);
  S3.anker(A1, 'leer'); S3.anker(A2, 'leer'); S3.lauf(0.5);
  ok(S3.da(K3) && S3.zahl(S3.ev, 'kreaturAufgeloest') === 0, 'endgültig erledigte (verwundet) gebundene Kreatur wird nicht mehr geprüft');
});
section('(f4) aufgelöste Kreatur handelt im selben Tick nicht mehr', () => {
  const lauf1 = (typName) => {
    const S = szene(); S.g.god = false;   // Rammen verwundet nur ohne Gott-Modus
    const Q = S.kreatur('tb_koenigin'); const K = Kreatur.erzeugen(S.g, typName, S.p.x, S.p.y);
    Q.alive = false; S.g.step();
    return { S, K, treffer: S.zahl(S.ev, 'kreaturTreffer'), aufgeloest: S.zahl(S.ev, 'kreaturAufgeloest') };
  };
  const mit = lauf1('tb_rammgefolge'), ohne = lauf1('tb_rammer');
  ok(ohne.treffer === 1 && ohne.aufgeloest === 0, 'Kontrolle: derselbe Rammer ohne Bindung trifft den Spieler im ersten Tick');
  ok(mit.aufgeloest === 1 && !mit.S.da(mit.K), 'gebundener Rammer: Königin tot, aufgelöst');
  ok(mit.treffer === 0 && mit.S.zahl(mit.S.me, 'kreaturTreffer') === 0, 'aufgelöst heißt aufgelöst: kein Rammen und kein kreaturTreffer im selben Tick');
});

section('(g) mehrere gebundene Kreaturen lösen sich unabhängig', () => {
  const S = szene(); const Q = S.kreatur('tb_koenigin');
  const F = S.kreatur('tb_fenster', 1), E = S.kreatur('tb_eins', 2), G = S.kreatur('tb_gefolge', 3), O = S.kreatur('tb_ohne', 4);
  S.anker(A1, 'leer'); S.lauf(0.3);
  ok(!S.da(E) && S.da(F) && S.da(G) && S.da(O) && S.da(Q), 'nur die an A1 gebundene löst sich');
  S.anker(A2, 'leer'); S.lauf(0.3); ok(!S.da(F) && S.da(G) && S.da(O), 'danach die an beide Anker gebundene');
  Q.alive = false; S.lauf(0.3); ok(!S.da(G) && S.da(O) && S.da(Q), 'danach das Gefolge; die Kreatur ohne Bindung bleibt');
  ok(S.zahl(S.ev, 'kreaturAufgeloest') === 3, 'genau drei Ereignisse');
  const ids = S.ev.filter((e) => e[0] === 'kreaturAufgeloest').map((e) => e[1].id);
  ok(new Set(ids).size === 3 && ids.includes(F.id) && ids.includes(E.id) && ids.includes(G.id), 'jede mit der eigenen ID');
});

section('(h) Validator und Fehler beim Anlegen', () => {
  const pr = (par) => { const d = kopie(KREATUREN); d.typen.tb_x = Object.assign({ name: 'kreatur.tb_x' }, kopie(BASIS), { start: 'steht', zustaende: kopie(STEHT), bausteine: { bindung: par } }); return Kreatur.pruefen(d).filter((f) => f.startsWith('typen.tb_x')); };
  const gut = anker([A1, A2], 'leer', 3, 1);
  ok(pr(gut).length === 0, 'gültige Bindung: keine Befunde');
  const mut = (f) => { const p = kopie(gut); f(p); return pr(p); };
  ok(mut((p) => { p.quelle.art = 'x'; }).length > 0, 'unbekannte Quelle-Art abgelehnt');
  ok(mut((p) => { p.quelle.ids = []; }).length > 0, 'leere ids abgelehnt');
  ok(mut((p) => { p.quelle.ids = [A1, A1]; }).length > 0, 'doppelte ids abgelehnt');
  ok(mut((p) => { p.quelle.rolle = 'beute'; }).length > 0, 'ids und rolle zugleich abgelehnt');
  ok(mut((p) => { p.quelle = { art: 'anker', rolle: 'gibtsnicht' }; }).length > 0, 'unbekannte Rolle abgelehnt');
  ok(mut((p) => { p.quelle = { art: 'anker', rolle: 'beute' }; p.bedingung.zustand = 'zu'; }).length > 0, 'Zustand, den die Rolle nicht kennt, abgelehnt');
  ok(mut((p) => { delete p.bedingung; }).length > 0, 'Anker-Quelle ohne Bedingung abgelehnt');
  ok(mut((p) => { delete p.bedingung.zustand; }).length > 0, 'Bedingung ohne Zustand abgelehnt');
  ok(mut((p) => { p.bedingung.fenster = -1; }).length > 0 && mut((p) => { p.bedingung.fenster = 'x'; }).length > 0, 'fenster < 0 oder keine Zahl abgelehnt');
  ok(mut((p) => { p.bedingung.nochwas = 1; }).length > 0 && mut((p) => { p.extra = 1; }).length > 0, 'unbekannte Felder abgelehnt');
  ok(mut((p) => { delete p.folge; }).length > 0, 'ohne Folge abgelehnt');
  ok(mut((p) => { p.folge.art = 'fall'; }).length > 0, 'andere Folge abgelehnt');
  ok(mut((p) => { p.folge.verzoegerung = -2; }).length > 0, 'negative Verzögerung abgelehnt');
  ok(pr({ quelle: { art: 'kreatur', typ: 'gibtsnicht' }, folge: { art: 'aufloesen' } }).length > 0, 'Kreatur-Quelle mit unbekanntem Typ abgelehnt');
  ok(pr({ quelle: { art: 'kreatur', id: 'Q1' }, folge: { art: 'aufloesen' } }).length > 0, 'Kreatur-Quelle mit ungültiger ID abgelehnt');
  ok(pr({ quelle: { art: 'kreatur', typ: 'probe', id: 'K1' }, folge: { art: 'aufloesen' } }).length > 0, 'Kreatur-Quelle mit Typ und ID abgelehnt');
  ok(pr({ quelle: { art: 'kreatur', typ: 'probe' }, bedingung: { zustand: 'leer' }, folge: { art: 'aufloesen' } }).length > 0, 'Kreatur-Quelle mit Bedingung abgelehnt');
  ok(pr({ quelle: { art: 'kreatur', typ: 'probe' }, folge: { art: 'aufloesen' } }).length === 0, 'Kreatur-Quelle ohne Bedingung gültig');
  ok(pr(null).length > 0 && pr([]).length > 0, 'kein Objekt abgelehnt');

  // Fehler beim Anlegen: Anker/Rolle/Zustand nicht auf der Karte, keine halbe Kreatur, Nummer wieder frei
  const S = szene(); S.kreatur('tb_ohne');
  const seq0 = S.aw.kreaturSeq, anz0 = S.aw.kreaturen.length;
  const probe = (name, par, muster) => {
    KREATUREN.typen[name] = Object.assign({ name: 'kreatur.' + name }, kopie(BASIS), { start: 'steht', zustaende: kopie(STEHT), bausteine: { bindung: par } });
    const m = wirft(() => S.kreatur(name));
    ok(!!m && muster.test(m), name + ': erzeugen wirft mit klarer Meldung (' + (m || 'kein Fehler') + ')');
  };
  probe('tb_nichtda', anker(['gibt.es.nicht'], 'leer'), /gibt es auf der Karte kesh\.kastell nicht/);
  probe('tb_teilweise', anker([A1, 'gibt.es.nicht'], 'leer'), /gibt.es.nicht/);
  probe('tb_rolleleer', { quelle: { art: 'anker', rolle: 'zelle' }, bedingung: { zustand: 'zu' }, folge: { art: 'aufloesen' } }, /keinen Anker der Rolle zelle/);
  probe('tb_zustand', anker([A1], 'zu'), /Zustand zu gibt es für Anker/);
  probe('tb_ohneq', { quelle: { art: 'kreatur', typ: 'tb_koenigin' }, folge: { art: 'aufloesen' } }, /keine lebende Kreatur der Quelle/);
  probe('tb_ohneid', { quelle: { art: 'kreatur', id: 'K999' }, folge: { art: 'aufloesen' } }, /keine lebende Kreatur der Quelle K999/);
  const mz = wirft(() => S.kreatur('tb_zwilling'));
  ok(!!mz && /keine lebende Kreatur/.test(mz), 'Bindung an den eigenen Typ: die Kreatur zählt sich nicht selbst als Quelle (' + mz + ')');
  ok(S.aw.kreaturSeq === seq0 && S.aw.kreaturen.length === anz0, 'fehlgeschlagene Anlegeversuche: keine halbe Kreatur, Nummernzähler unverändert');
  const K = S.kreatur('tb_ohne'); ok(K.id === 'K' + (seq0 + 1), 'nächste Kreatur bekommt die Nummer, die frei blieb');
  // Handkarte ohne Anker
  const SH = szene(); SH.g.setAwayMap('kesh'); SH.g.aways.kesh.active = true; combat.ensureV2(SH.g, SH.g.aways.kesh); SH.g.aways.kesh.kreaturen = [];
  const mh = wirft(() => Kreatur.erzeugen(SH.g, 'tb_fenster', 100, 100));
  ok(!!mh && /hat keine Anker/.test(mh) && SH.g.aways.kesh.kreaturen.length === 0, 'Handkarte ohne Anker: klare Meldung, nichts angelegt (' + mh + ')');
});

section('(i) der Baustein schreibt nie in Anker', () => {
  const S = szene();
  const vor = () => JSON.stringify({ z: S.aw.zustaende, l: S.aw.ankerLauf, a: Anker.awaySnap(S.g, S.aw) });
  const v00 = vor();
  S.kreatur('tb_fenster'); S.kreatur('tb_rolle', 1); S.kreatur('tb_verz', 2); S.kreatur('tb_offen', 3);
  ok(vor() === v00, 'Anlegen gebundener Kreaturen verändert aw.zustaende, aw.ankerLauf und den Anker-Snapshot nicht');
  S.lauf(2); ok(vor() === v00, 'Beobachten über 2 s (ohne Anker-Eingriff) verändert sie nicht');
  S.anker(A1, 'leer'); S.lauf(1); S.anker(A2, 'leer');
  const v0 = vor(); const ankerEv0 = S.zahl(S.ev, 'ankerZustand');
  S.lauf(5);
  ok(S.aw.kreaturen.length === 0, 'Kontrolle: alle vier haben sich aufgelöst');
  ok(vor() === v0, 'aw.zustaende, aw.ankerLauf und der Anker-Snapshot vor und nach den Auflösungen byteweise gleich');
  ok(S.zahl(S.ev, 'ankerZustand') === ankerEv0, 'keine zusätzlichen ankerZustand-Ereignisse');
  ok(Anker.zustand(S.g, KARTE, A1) === 'leer' && Anker.zustand(S.g, KARTE, A2) === 'leer', 'beide Anker weiter im gesetzten Zustand');
  const Sx = szene(); const Kx = Sx.kreatur('tb_fenster'); Sx.lauf(2);
  ok(Sx.aw.zustaende[A1] === undefined && Sx.aw.zustaende[A2] === undefined, 'ohne Anker-Eingriff trägt aw.zustaende nach dem Beobachten keinen Eintrag der Quelle (kein Initialschreiben)');
  ok(Kx.bindung && Kx.bindung.ids.length === 2, 'Beobachtung liegt an der Kreatur (K.bindung), nicht an der Karte');
});

// ---------- (j) bytegleich ohne Bindungs-Baustein ----------
function lauf15() {
  const S = szene(7); const aw = S.aw;
  const K1 = Kreatur.erzeugen(S.g, 'probe', S.p.x + 80, S.p.y); Kreatur.erzeugen(S.g, 'tb_ohne', S.p.x - 80, S.p.y);
  S.lauf(15);
  const skip = new Set(['_ev']);
  const json = JSON.stringify(aw, (k, v) => (typeof v === 'function' || skip.has(k) ? undefined : (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)));
  const rng = [aw.rng(), aw.rng(), aw.rng()];
  return { hash: crypto.createHash('sha1').update(json).update(JSON.stringify(rng)).digest('hex'), len: json.length, K1 };
}
section('(j) ohne Bindungs-Baustein: Zufallsstrom und aw-JSON bytegleich zum Stand vor P3', () => {
  const a = lauf15(), b = lauf15();
  ok(a.hash === b.hash, 'zwei Läufe gleichen Seeds: gleicher Hash (Determinismus der Szene)');
  const SOLL = process.env.BINDUNG_HASH_SOLL || 'c9c9756feed6f31594278c8c957d1e25f8a261d7';
  console.log('  info Hash ' + a.hash + ' (aw-JSON ' + a.len + ' Zeichen)');
  ok(a.hash === SOLL, 'Hash gleich dem Stand vor P3 (kreatur.js ohne Baustein bindung, gemessen auf f21beb4)');
});

// ---------- (k) Tick-Kosten ----------
section('(k) Tick-Kosten mit 20 gebundenen Kreaturen', () => {
  const messen = (tn) => {
    const S = szene(); for (let i = 0; i < 20; i++) S.kreatur(tn, (i % 5) - 2);
    const N = 3000; const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) { S.g.time += DT; Kreatur.update(S.g, DT); }
    return Number(process.hrtime.bigint() - t0) / 1000 / N;
  };
  messen('tb_fenster'); messen('tb_ohne');   // Warmlauf
  const gebunden = messen('tb_fenster'), ohne = messen('tb_ohne');
  console.log('  info Kreatur.update je Tick mit 20 gebundenen Kreaturen (2 Anker): ' + gebunden.toFixed(1) + ' us; 20 Kreaturen ohne Bindung: ' + ohne.toFixed(1) + ' us; Differenz ' + (gebunden - ohne).toFixed(1) + ' us');
  ok(gebunden - ohne < 200, 'Mehrkosten der Bindung unter 200 us je Tick bei 20 Kreaturen (Tick-Budget 50 ms)');
});

console.log('\n' + (fails ? fails + ' von ' + n + ' Prüfungen FEHLGESCHLAGEN' : 'alle ' + n + ' Prüfungen ok'));
process.exit(fails ? 1 : 0);
