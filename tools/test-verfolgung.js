'use strict';
// SUND-04a-1 A: Szenentyp A6 Verfolgung (server/sim/verfolgung.js, Daten content/kampf/verfolgung-werte.json, Bausteine verfolgung_*).
//  - Aufbau: Zielschiff auf der Linie Lerche - Fluchtpunkt, Parameter Klasse/Volk/Name, Fluchtpunkt (Sprungpunkt bzw. virtueller Randpunkt)
//  - Flucht in beiden Flugmodellen (Pilot, kinematisch), Ankunft, Sprungladung, Ausgang entkommen (Wiederholung / ohne)
//  - Stellen: Antrieb ausschalten (gezielter Treffer) und nah bleiben, Sprungladung stören (Hüllentreffer), Ausfall hält die Ladung an, Zerstörung
//  - gleiche Regeln: das Zielschiff zielt auf den Antrieb der Lerche
//  - Faden-Schnittstelle: Verfolgung.starten ohne Labor und Regiebuch, Ausgang als Ereignis und Rückgabe
//  - Katalog (A6 verfügbar), Labor, Bausteine, Prüfer, Snapshot
//   node tools/test-verfolgung.js            -> alle Abschnitte
//   node tools/test-verfolgung.js stellen    -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Verfolgung = require('../server/sim/verfolgung.js');
const Zs = require('../server/sim/zielsysteme.js');
const Registry = require('../server/mission/registry.js');
const Labor = require('../server/mission/labor.js');
const Spielleiter = require('../server/mission/spielleiter.js');
const Checker = require('../server/mission/checker.js');
const V = require('../content/kampf/verfolgung-werte.json').werte;

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-verfolgung-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

function setup(start, opts) {
  const o = opts || {};
  const worlds = start !== 'arena_space';
  const g = new Game(Object.assign({ noStore: true, worlds, worldSaveSync: true, worldDir: o.dir, seed: o.seed || 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} }, o.game || {}));
  const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'V0', name: 'Ver0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: start });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const odas = []; const oda0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(t); return oda0(t, x); };
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  const T = { g, c, odas, mev, me: (k) => mev.filter((e) => e.kind === k) };
  T.run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  T.cmd = (cmd, f) => { c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  return T;
}
// Raumszene (Rabenpass 3000×2200, Lerche unverwundbar)
function raum(ort, opts) {
  const T = setup('arena_space', opts); const g = T.g; g.god = true;
  space.enterScene(g, ort || 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  T.run(0.1);
  return T;
}
const platz = (g, x, y, ang) => { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.turnVel = 0; if (ang != null) s.angle = ang; };
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const vel = (e) => Math.hypot(e.vx || 0, e.vy || 0);
const treffer = (g, e, rel, dmg, opts) => space.damageEnemy(g, e, dmg == null ? 3 : dmg, e.x + Math.cos(e.angle + rel) * 60, e.y + Math.sin(e.angle + rel) * 60, Object.assign({ angriff: true }, opts || {}));
const HECK = Math.PI;
const zielVon = (g) => Verfolgung.ziel(g);
// Lerche 400 px hinter dem Zielschiff (Heck zeigt zur Lerche), Systemziel gewählt
function hinterher(g, e, abstand) {
  const a = e.angle + Math.PI;
  platz(g, e.x + Math.cos(a) * (abstand || 300), e.y + Math.sin(a) * (abstand || 300), e.angle);
  e.scanned = true; g.ship.target = e.id; return Zs.waehle(g, 'antrieb');
}
// Zeit, bis die Lerche (Geradeausflug am Ziel entlang) kein Eingreifen mehr braucht: hier wird nichts gesteuert – die Lerche bleibt stehen, das Zielschiff flieht
const sprungStart = (T) => T.run(60, () => Verfolgung.ziel(T.g) && Verfolgung.ziel(T.g).sprung != null);

section('Daten', () => {
  ok(V.ziel.wert.klassen.every((k) => CONFIG.enemies[k] && CONFIG.shipClasses[k]) && V.ziel.wert.klassen.includes(V.ziel.wert.klasse), 'Zielklassen gibt es in CONFIG.enemies und shipClasses, die Standardklasse ist erlaubt');
  ok(V.flucht.wert.tempo > 0 && V.flucht.wert.tempo < 1 && V.flucht.wert.legacyFaktor > 0 && V.sprung.wert.dauer > 0 && V.stellen.wert.radius > 0 && V.stellen.wert.zeit > 0, 'Tempo, Sprungdauer, Stellen: positive Werte');
  const kl = V.ziel.wert.klassen.map((k) => `${k}: Pilot ${(V.flucht.wert.tempo * CONFIG.shipClasses[k].maxSpeed).toFixed(0)} px/s, kinematisch ${(CONFIG.enemies[k].speed * V.flucht.wert.legacyFaktor).toFixed(0)} px/s`).join(' · ');
  info(kl + ' (Lerche ' + CONFIG.shipClasses.lerche.maxSpeed + ')');
  ok(V.ziel.wert.klassen.every((k) => V.flucht.wert.tempo * CONFIG.shipClasses[k].maxSpeed < CONFIG.shipClasses.lerche.maxSpeed || k === 'raider'), 'Fluchttempo der Klassen (außer Jäger, Mindestfahrt) unter der Höchstfahrt der Lerche');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'verfolgung.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/\b(12|560|380|180)\b/.test(src), 'keine Zahlen der Daten im Code von verfolgung.js');
});

section('Aufbau: Zielschiff, Fluchtpunkt, Zustand', () => {
  const T = raum(); const g = T.g;
  platz(g, 600, 1100, 0);
  const k = Verfolgung.starten(g, { klasse: 'korvette', volk: 'pirat', name: 'Falke' });
  const e = zielVon(g);
  ok(e && e.kind === 'korvette' && e.volk === 'pirat' && e.name === 'Falke', 'Zielschiff: Klasse korvette, Volk pirat, Name Falke');
  ok(k.fluchtpunkt && Verfolgung.fluchtpunkt(g) === k.fluchtpunkt && e.fluchtZiel.x === k.fluchtpunkt.x, 'Fluchtpunkt im Zustand, am Schiff als e.fluchtZiel');
  const dL = dist(600, 1100, e.x, e.y);
  ok(Math.abs(dL - V.ziel.wert.startAbstand) < 30, `Zielschiff ${Math.round(dL)} px vor der Lerche (startAbstand ${V.ziel.wert.startAbstand})`);
  const a1 = Math.atan2(k.fluchtpunkt.y - 1100, k.fluchtpunkt.x - 600), a2 = Math.atan2(e.y - 1100, e.x - 600);
  ok(Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2))) < 0.05, 'es steht auf der Linie Lerche – Fluchtpunkt (die Lerche verfolgt von hinten)');
  ok(Zs.szeneAktiv(g) && e.zielsystem === 'antrieb', 'Szenenschalter zielsysteme an, das Zielschiff zielt auf den Antrieb (gleiche Regeln)');
  ok(g.space.enemies.length === 1 && Verfolgung.aktiv(g) && Verfolgung.ausgang(g) === null && !Verfolgung.erfolg(g), 'ein Gegner, aktiv, noch kein Ausgang');
  ok(T.me('verfolgungStart').length === 1 && T.odas.some((t) => /Falke dreht ab/.test(t)), 'missionEvent verfolgungStart und Ansage mit dem Namen');
  const U = raum(); Verfolgung.starten(U.g, { klasse: 'unsinn' });
  ok(zielVon(U.g).kind === V.ziel.wert.klasse, 'unbekannte Klasse: Standardklasse');
  const D = raum(); ok(Verfolgung.debug(D.g, ['frachter', 'ohne']) === null && zielVon(D.g).kind === 'frachter' && D.g.space.verfolgung.wiederholung === false, 'Debug verfolgung frachter ohne');
  // Fluchtpunkt: Sprungpunkt des Orts (Rabenpass hat Kanten) bzw. virtueller Randpunkt (Ort ohne Kanten)
  const kand = Verfolgung.kandidaten(T.g);
  ok(kand.length >= 1 && kand.every((c) => !c.virtuell), 'Rabenpass: Kandidaten sind echte Sprungpunkte (' + kand.length + ')');
  const L = raum('b7'); const kb = Verfolgung.kandidaten(L.g);
  info('Boje B-7: ' + (kb[0].virtuell ? 'virtuelle Randpunkte' : 'Sprungpunkte') + ' (' + kb.length + ')');
  const sp = L.g.space; sp.w = 3000; sp.h = 2000;
  const real = Verfolgung.kandidaten(L.g);
  ok(real.length >= 1, 'Kandidaten in B-7 vorhanden');
  // virtuell erzwingen: Ort ohne Hex (Testgelände-Szene, hexVonOrt liefert null)
  const A = setup('arena_space'); A.g.god = true; A.g.ship.scene = 'unbekannt-ohne-hex'; A.g.space.w = 2000; A.g.space.h = 1400;
  const kv = Verfolgung.kandidaten(A.g);
  ok(kv.length === V.fluchtpunkt.wert.virtuell.length && kv.every((c) => c.virtuell), 'Ort ohne Sprungpunkt: vier virtuelle Randpunkte (west, ost, nord, sued)');
  ok(kv.every((c) => c.x >= V.fluchtpunkt.wert.randAbstand - 1 && c.x <= 2000 - V.fluchtpunkt.wert.randAbstand + 1 && c.y >= V.fluchtpunkt.wert.randAbstand - 1 && c.y <= 1400 - V.fluchtpunkt.wert.randAbstand + 1), 'virtuelle Punkte liegen randAbstand vor dem Rand');
  platz(A.g, 300, 700, 0);
  const wf = Verfolgung.fluchtpunktWaehlen(A.g);
  ok(wf.virtuell && wf.x > 1500, 'gewählt wird der Punkt mit dem größten Abstand zur Lerche (Lerche links: Punkt rechts)');
  // gewählter Fluchtpunkt von außen vorgegeben (Faden)
  const F = raum(); platz(F.g, 600, 1100, 0);
  const kf = Verfolgung.starten(F.g, { fluchtpunkt: { x: 2500, y: 900, virtuell: true } });
  ok(kf.fluchtpunkt.x === 2500 && kf.fluchtpunkt.y === 900 && zielVon(F.g).fluchtZiel.x === 2500, 'vorgegebener Fluchtpunkt gilt');
});

section('Flucht: beide Flugmodelle, Ankunft und Sprung', () => {
  for (const [kind, modell] of [['korvette', 'pilot'], ['frachter', 'kinematisch']]) {
    const T = raum(); const g = T.g; platz(g, 600, 1100, 0);
    const k = Verfolgung.starten(g, { klasse: kind, wiederholung: false });
    const e = zielVon(g); const fp = k.fluchtpunkt;
    const pilot = require('../server/sim/pilot.js');
    ok(pilot.flies(g, e) === (modell === 'pilot'), `${kind}: Flugmodell ${modell}`);
    const d0 = dist(e.x, e.y, fp.x, fp.y);
    T.run(4); const v4 = vel(e);
    ok(dist(e.x, e.y, fp.x, fp.y) < d0 - 100, `${kind}: fährt auf den Fluchtpunkt zu (${Math.round(d0)} -> ${Math.round(dist(e.x, e.y, fp.x, fp.y))} px)`);
    const t0 = g.time;
    ok(T.run(60, () => e.sprung != null), `${kind}: erreicht den Fluchtpunkt und lädt den Sprung (${(g.time - t0).toFixed(1)} s)`);
    ok(dist(e.x, e.y, fp.x, fp.y) <= V.flucht.wert.ankunftRadius + 5 && T.odas.some((t) => /lädt den Sprung/.test(t)) && T.me('verfolgungSprungStart').length === 1, `${kind}: Ankunft im Radius, Ansage und missionEvent verfolgungSprungStart`);
    T.run(1); const sj = g.snapshot().space.enemies.find((q) => q.id === e.id);
    ok(sj.sj > 0 && sj.sj < 1 && g.snapshot().space.vf && g.snapshot().space.vf.x === fp.x, `${kind}: Snapshot sj (${sj.sj}) und space.vf = Fluchtpunkt`);
    T.run(4); const x1 = e.x; T.run(2);
    ok(Math.abs(e.x - x1) < 3 && vel(e) < 3, `${kind}: während der Ladung bremst das Schiff und steht (nach 4 s)`);
    T.run(V.sprung.wert.dauer + 1);
    ok(Verfolgung.ausgang(g) === 'entkommen' && !g.space.enemies.length, `${kind}: nach ${V.sprung.wert.dauer} s gesprungen: Ausgang entkommen, Schiff weg`);
    const ev = T.me('verfolgungAusgang');
    ok(ev.length === 1 && ev[0].was === 'entkommen' && ev[0].klasse === kind && T.odas.some((t) => /gesprungen/.test(t)), `${kind}: missionEvent verfolgungAusgang (entkommen) und Ansage`);
    ok(!Verfolgung.erfolg(g) && g.snapshot().space.vf === undefined, `${kind}: kein Erfolg, kein Fluchtpunkt mehr im Snapshot`);
    T.run(V.wiederholung.wert.neuNach + 2);
    ok(!g.space.enemies.length && Verfolgung.ausgang(g) === 'entkommen', `${kind}: ohne Wiederholung kommt kein neues Zielschiff`);
  }
  const T = raum(); const g = T.g; platz(g, 600, 1100, 0);
  Verfolgung.starten(g, { klasse: 'korvette', wiederholung: true });
  const id0 = zielVon(g).id;
  sprungStart(T); T.run(V.sprung.wert.dauer + 1);
  ok(Verfolgung.ausgang(g) === 'entkommen', 'mit Wiederholung: zuerst entkommen');
  T.run(V.wiederholung.wert.neuNach + 0.5);
  const e2 = zielVon(g);
  ok(e2 && e2.id !== id0 && Verfolgung.ausgang(g) === null && g.space.verfolgung.versuch === 2, 'nach neuNach s ein neues Zielschiff, Versuch 2');
});

section('Stellen: Antrieb ausschalten', () => {
  const T = raum(); const g = T.g; platz(g, 600, 1100, 0);
  Verfolgung.starten(g, { klasse: 'korvette', wiederholung: false });
  const e = zielVon(g);
  T.run(3);
  ok(hinterher(g, e, 250) === null, 'Ops: gescannt, Systemziel Antrieb gewählt');
  const v0 = vel(e);
  treffer(g, e, HECK, 3);
  T.run(0.2);
  T.run(V.stellen.wert.zeit + 0.5);
  ok(!Verfolgung.ausgang(g) && Zs.stufe(e, 'antrieb') === 1, 'Antrieb nur beschädigt: noch nicht gestellt');
  T.run(DATEN_SPERRE() + 0.2); treffer(g, e, HECK, 3);
  ok(Zs.ausgefallen(e, 'antrieb'), 'zweiter Treffer: Antrieb ausgefallen');
  platz(g, e.x - Math.cos(e.angle) * 250, e.y - Math.sin(e.angle) * 250, e.angle);
  T.run(3); const v1 = vel(e);
  info(`Tempo des Zielschiffs: ${v0.toFixed(1)} px/s vor dem Treffer, ${v1.toFixed(1)} nach dem Ausfall`);
  ok(v1 < 2, 'das Zielschiff steht');
  const bleibt = T.run(V.stellen.wert.zeit + 2, () => Verfolgung.ausgang(g) === 'gestellt');
  ok(bleibt && Verfolgung.erfolg(g), 'Lerche nah (' + V.stellen.wert.radius + ' px) seit ' + V.stellen.wert.zeit + ' s: Ausgang gestellt (Erfolg)');
  ok(e.fluchtZiel === null && e.sprung === null, 'das gestellte Schiff flieht nicht mehr');
  ok(g.space.enemies.length === 1, 'das Schiff bleibt im Raum (die Szene kann zum Raumgefecht kippen)');
  T.run(Zs.SYSTEME.antrieb.stufen[2].erholung_s + Zs.SYSTEME.antrieb.stufen[1].erholung_s + 5);
  ok(Zs.ausgefallen(e, 'antrieb') && vel(e) < 1, 'der Antrieb bleibt aus (halte), das Schiff steht weiter');
  const ev = T.me('verfolgungAusgang');
  ok(ev.length === 1 && ev[0].was === 'gestellt' && T.odas.some((t) => /gestellt/.test(t)), 'missionEvent verfolgungAusgang (gestellt)');
});
function DATEN_SPERRE() { return Zs.TREFFER.sperre_s; }

section('Stellen: zu weit weg oder Antrieb erholt sich', () => {
  const T = raum(); const g = T.g; platz(g, 600, 1100, 0);
  Verfolgung.starten(g, { klasse: 'korvette', wiederholung: false });
  const e = zielVon(g); T.run(2);
  hinterher(g, e, 200);
  treffer(g, e, HECK, 3); T.run(DATEN_SPERRE() + 0.2); treffer(g, e, HECK, 3);
  platz(g, 300, 300, 0);   // weit weg
  T.run(V.stellen.wert.zeit + 3);
  ok(Zs.ausgefallen(e, 'antrieb') && !Verfolgung.ausgang(g), 'Antrieb aus, aber die Lerche ist weit weg: nicht gestellt');
  T.run(Zs.SYSTEME.antrieb.stufen[2].erholung_s);
  ok(Zs.stufe(e, 'antrieb') === 1 && !Verfolgung.ausgang(g), 'nach der Erholungsfrist: nur noch beschädigt, die Flucht geht weiter');
});

section('Sprungladung stören', () => {
  const T = raum(); const g = T.g; platz(g, 600, 1100, 0);
  Verfolgung.starten(g, { klasse: 'korvette', wiederholung: false });
  const e = zielVon(g);
  sprungStart(T);
  ok(e.sprung != null, 'Sprungladung läuft');
  const k = g.space.verfolgung;
  ok(k.verz === 0, 'keine Verzögerung');
  // Hüllentreffer (an der Seite, ohne Antriebstreffer: kein Systemziel, kein Heck)
  space.damageEnemy(g, e, 4, e.x + Math.cos(e.angle + Math.PI / 2) * 60, e.y + Math.sin(e.angle + Math.PI / 2) * 60, { angriff: true });
  T.run(0.1);
  ok(Math.abs(k.verz - V.sprung.wert.verzoegerungJeTreffer) < 1e-9, `ein Hüllentreffer verzögert die Ladung um ${V.sprung.wert.verzoegerungJeTreffer} s`);
  for (let i = 0; i < 12; i++) { space.damageEnemy(g, e, 0.5, e.x + Math.cos(e.angle + Math.PI / 2) * 60, e.y + Math.sin(e.angle + Math.PI / 2) * 60, { angriff: true }); T.run(0.1); }
  ok(k.verz === V.sprung.wert.verzoegerungMax, `die Verzögerung ist begrenzt (${V.sprung.wert.verzoegerungMax} s)`);
  const sj0 = e.sprung; const dauer = V.sprung.wert.dauer + k.verz;
  ok(e.sprungDauer === dauer, 'e.sprungDauer = Dauer + Verzögerung (' + dauer + ' s)');
  // Schildtreffer verzögern nicht
  const k2 = raum(); platz(k2.g, 600, 1100, 0); Verfolgung.starten(k2.g, { klasse: 'korvette', wiederholung: false });
  const e2 = zielVon(k2.g); sprungStart(k2);
  const lay = require('../shared/schilde.js').layout(CONFIG, 'korvette'); e2.shields[lay.seiten[1][0]] = 5;
  space.damageEnemy(k2.g, e2, 1, e2.x + Math.cos(e2.angle + Math.PI / 2) * 60, e2.y + Math.sin(e2.angle + Math.PI / 2) * 60, { angriff: true });
  k2.run(0.1);
  ok(k2.g.space.verfolgung.verz === 0, 'ein Treffer, den der Schild fängt, verzögert nicht');
  // ausgefallener Antrieb hält die Ladung an
  const p = raum(); platz(p.g, 600, 1100, 0); Verfolgung.starten(p.g, { klasse: 'korvette', wiederholung: false });
  const e3 = zielVon(p.g); sprungStart(p); hinterher(p.g, e3, 900);
  treffer(p.g, e3, HECK, 0.5); p.run(DATEN_SPERRE() + 0.2); treffer(p.g, e3, HECK, 0.5);
  const s1 = e3.sprung; p.run(3);
  ok(Zs.ausgefallen(e3, 'antrieb') && Math.abs(e3.sprung - s1) < 1e-6, 'ausgefallener Antrieb: die Sprungladung steht (pausiertBeiAusfall)');
  p.run(Zs.SYSTEME.antrieb.stufen[2].erholung_s);
  ok(e3.sprung > s1, 'nach der Erholung läuft die Ladung weiter');
});

section('Stellen: Haltezeit, Ausfall am Fluchtpunkt, Erholung nach dem Stellen', () => {
  // Haltezeit: erst nach stellen.zeit s im Radius, nicht sofort
  const T = raum(); const g = T.g; platz(g, 600, 1100, 0);
  Verfolgung.starten(g, { klasse: 'korvette', wiederholung: false });
  const e = zielVon(g); T.run(2);
  hinterher(g, e, 250);
  treffer(g, e, HECK, 3); T.run(DATEN_SPERRE() + 0.2); treffer(g, e, HECK, 3);
  e.hp = e.hpMax = 9999;
  platz(g, e.x - Math.cos(e.angle) * 250, e.y - Math.sin(e.angle) * 250, e.angle);
  T.run(V.stellen.wert.zeit - 0.6);
  ok(Zs.ausgefallen(e, 'antrieb') && !Verfolgung.ausgang(g), `nach ${V.stellen.wert.zeit - 0.6} s im Radius noch nicht gestellt (Haltezeit ${V.stellen.wert.zeit} s)`);
  T.run(1.5);
  ok(Verfolgung.ausgang(g) === 'gestellt', 'nach der Haltezeit gestellt');
  // nach dem Stellen erholt sich der Antrieb nie (der Lerche-Automat darf das Schiff nicht vorher zerstören: Hülle hoch gesetzt)
  const S = Zs.SYSTEME.antrieb.stufen;
  platz(g, 300, 300, 0); delete g.ship.zielsystem; Zs.szeneAn(g, false);   // die Lerche schießt nicht weiter nach (neue Treffer würden die Frist ohnehin erneuern)
  T.run(S[2].erholung_s + S[1].erholung_s + 5);
  ok(g.space.enemies.includes(e) && Zs.ausgefallen(e, 'antrieb'), 'ein gestelltes Schiff bleibt ausgefallen, auch nach allen Erholungsfristen');
  // ein ausgefallener Antrieb am Fluchtpunkt startet die Ladung nicht
  const U = raum(); const h = U.g; platz(h, 600, 1100, 0);
  Verfolgung.starten(h, { klasse: 'korvette', wiederholung: false });
  const z = zielVon(h);
  z.scanned = true; h.ship.target = z.id; Zs.waehle(h, 'antrieb');
  const fp = h.space.verfolgung.fluchtpunkt;
  z.x = fp.x - 60; z.y = fp.y + 60; z.angle = Math.atan2(fp.y - z.y, fp.x - z.x);
  treffer(h, z, HECK, 3); z.zs.antrieb.sp = 0; treffer(h, z, HECK, 3);   // beide Stufen im selben Tick, noch vor dem Ankunftstest
  platz(h, 300, 300, 0);
  U.run(2);
  ok(Zs.ausgefallen(z, 'antrieb') && z.sprung == null, 'ausgefallener Antrieb im Ankunftsradius: die Sprungladung beginnt nicht');
});

section('Zerstörung und Szenenwechsel', () => {
  const T = raum(); const g = T.g; platz(g, 600, 1100, 0);
  Verfolgung.starten(g, { klasse: 'raider', wiederholung: false });
  const e = zielVon(g); T.run(1);
  space.damageEnemy(g, e, 9999, e.x - 30, e.y, { angriff: true });
  T.run(0.2);
  ok(Verfolgung.ausgang(g) === 'zerstoert' && Verfolgung.erfolg(g), 'zerstört: Ausgang zerstoert zählt als Erfolg');
  ok(T.me('verfolgungAusgang').length === 1 && T.me('verfolgungAusgang')[0].was === 'zerstoert', 'missionEvent verfolgungAusgang (zerstoert)');
  const U = raum(); Verfolgung.starten(U.g, { klasse: 'korvette' });
  space.enterScene(U.g, 'splitter', {}); U.run(0.2);
  ok(!Verfolgung.aktiv(U.g) && !Zs.szeneAktiv(U.g) && U.g.space.verfolgung === undefined || U.g.space.verfolgung === null, 'Szenenwechsel: Verfolgung und Szenenschalter sind weg');
  // erzwingen (Überspringen)
  const S = raum(); Verfolgung.starten(S.g, { klasse: 'korvette' }); S.run(0.5);
  ok(Verfolgung.erzwingen(S.g) === true && Verfolgung.erfolg(S.g), 'erzwingen: als geschafft gewertet');
  ok(Verfolgung.erzwingen(raum().g) === false, 'erzwingen ohne Verfolgung: false');
});

section('Gleiche Regeln: das Zielschiff zielt auf den Antrieb der Lerche', () => {
  const T = raum(); const g = T.g; g.god = false; g.rng.chance = () => false;
  platz(g, 600, 1100, 0);
  Verfolgung.starten(g, { klasse: 'korvette', wiederholung: false });
  const e = zielVon(g);
  // das Zielschiff liegt hinter der Lerche und schießt auf ihr Heck
  e.x = 400; e.y = 1100; e.angle = 0; e.vx = 0; e.vy = 0; e.fluchtZiel = null;
  g.ship.shields.current = [0, 0, 0, 0];
  g.space.projectiles.push({ id: 'prV', kind: 'enemy', x: 570, y: 1100, angle: 0, speed: 100, ttl: 3, dmg: 1, owner: e.id });
  T.run(0.5);
  ok(g.ship.systems.engines === 'damaged', 'Treffer des Zielschiffs auf das Heck der Lerche: Triebwerk beschädigt (derselbe Regelweg wie gegen Gegner)');
});

section('Faden-Schnittstelle: ohne Labor und Regiebuch', () => {
  const T = raum(); const g = T.g; platz(g, 600, 1100, 0);
  ok(typeof Verfolgung.starten === 'function' && typeof Verfolgung.ausgang === 'function' && typeof Verfolgung.ziel === 'function', 'benannte Schnittstelle: starten, ausgang, ziel');
  ok(!g.mission || !g.labor || !g.labor.buch, 'kein Labor-Buch läuft');
  const k = Verfolgung.starten(g, { klasse: 'frachter', volk: 'ger', name: 'Brynja', ort: 'ignoriert', wiederholung: false });
  ok(k.klasse === 'frachter' && k.volk === 'ger' && k.name === 'Brynja' && zielVon(g).name === 'Brynja', 'Parameter Klasse, Volk, Name genügen');
  T.run(70);
  ok(Verfolgung.ausgang(g) === 'entkommen' && T.me('verfolgungAusgang').some((e) => e.was === 'entkommen' && e.name === 'Brynja' && e.volk === 'ger'), 'Ausgang als Rückgabe (ausgang) und als Ereignis (verfolgungAusgang mit Name und Volk)');
  ok(Verfolgung.AUSGAENGE.join() === 'gestellt,zerstoert,entkommen', 'Ausgänge: ' + Verfolgung.AUSGAENGE.join(', '));
  const names = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'verfolgung.js'), 'utf8');
  ok(!/require\('\.\/(mission|labor)|katalog|regiebuch/i.test(names.replace(/\/\/.*$/gm, '')), 'verfolgung.js hängt weder an Labor noch an Regiebuch noch an Katalog');
});

section('Katalog, Labor, Bausteine, Prüfer', () => {
  const k = Spielleiter.katalog();
  const sz = Object.values(k.szenentypen).find((s) => s.kennung === 'A6');
  ok(sz && sz.status === 'verfuegbar' && sz.verfuegbare_molekuele.includes('verfolgen'), 'Szenentyp A6 Verfolgung verfügbar mit Molekül verfolgen');
  ok(k.mechaniken.verfolgung.status === 'verfuegbar' && k.mechaniken.zielsysteme.status === 'verfuegbar', 'Mechaniken verfolgung und zielsysteme verfügbar');
  const mol = k.molekuele.verfolgen;
  ok(mol && mol.umsetzungen.length === 1 && mol.umsetzungen[0].status === 'verfuegbar' && mol.umsetzungen[0].pruefung.fehler === 0 && mol.umsetzungen[0].pruefung.warnungen === 0, 'Molekül verfolgen: Umsetzung fliehenden_stellen verfügbar, Prüfer ohne Fehler und Warnungen');
  const liste = Labor.laborListe(k).filter((e) => e.molekuel === 'verfolgen');
  ok(liste.length === 1 && liste[0].schauplatz === 'weltraum' && liste[0].ort === 'rabenpass', 'Labor-Liste: Eintrag verfolgen/fliehenden_stellen (Ort rabenpass)');
  for (const id of ['verfolgung_an', 'verfolgung_ende', 'verfolgung_ausgang', 'verfolgung_erfolg']) ok(!!Registry.get(id), 'Baustein ' + id + ' registriert');
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuch', 'bausteine.json'), 'utf8'));
  ok(['verfolgung_an', 'verfolgung_ende'].every((id) => contract.aktionen[id] && contract.aktionen[id].status === 'registriert') && ['verfolgung_ausgang', 'verfolgung_erfolg'].every((id) => contract.pruefungen[id]), 'Vertrag content/regiebuch/bausteine.json kennt die vier Bausteine');
  // Labor: startet im Rabenpass, Erfolg über das Regiebuch
  const L = setup('free', { dir: freshDir() }); L.run(0.3);
  const r = Labor.laborStart(L.g, 'verfolgen/fliehenden_stellen', { seed: 5, direkt: true });
  ok(r.ok === true, 'laborStart: ' + (r.fehler || 'ok'));
  L.run(6);
  const g = L.g;
  ok(g.ship.scene === 'rabenpass' && Verfolgung.aktiv(g) && zielVon(g) && zielVon(g).kind === 'fregatte' && zielVon(g).volk === 'ger', 'Labor: Szene Rabenpass, Zielschiff Fregatte (test.params), Volk ger');
  g.god = true;
  const e = zielVon(g);
  hinterher(g, e, 250);
  treffer(g, e, HECK, 3); L.run(DATEN_SPERRE() + 0.2); treffer(g, e, HECK, 3);
  platz(g, e.x - Math.cos(e.angle) * 250, e.y - Math.sin(e.angle) * 250, e.angle);
  L.run(V.stellen.wert.zeit + 4);
  const ms = g.mission.missions[g.labor.buch];
  ok(Verfolgung.ausgang(g) === 'gestellt' && ms && ms.state === 'done', `Labor: gestellt, Mission erfolgreich beendet (${ms && ms.state})`);
  // Überspringen (skip)
  const S = setup('free', { dir: freshDir() }); S.run(0.3);
  Labor.laborStart(S.g, 'verfolgen/fliehenden_stellen', { seed: 3 }); S.run(3);
  S.g.mission.skip(); S.run(2);
  ok(Verfolgung.erfolg(S.g) || (S.g.mission.missions[S.g.labor.buch] || {}).state === 'done', 'Überspringen wertet die Szene als geschafft (verfolgung_ende)');
  // Prüfer
  const doc = { format: 'regiebuch/1', id: 'vtest', titel: 'Verfolgungs-Test', auftraggeber: 'tesk', kopf: { art: 'test' }, buehne: { orte: ['rabenpass'] },
    steps: [{ id: 'a', loc: 'rabenpass', enter: [{ do: 'verfolgung_an', klasse: 'korvette', volk: 'ger', name: 'Falke' }],
      objectives: [{ id: 'o1', text: '@t1', done: { check: { name: 'verfolgung_erfolg' } } }],
      next: [{ if: { check: { name: 'verfolgung_ausgang', was: 'gestellt' } }, complete: 'erfolg' }] }],
    texte: { t1: 'Zielschiff stellen' } };
  const rr = Checker.check(doc, {});
  const mine = rr.errors.concat(rr.warnings).filter((x) => /verfolgung/i.test(x.p + ' ' + x.msg));
  ok(mine.length === 0, 'Prüfer: keine Meldung zu verfolgung_*' + (mine.length ? ' – ' + JSON.stringify(mine[0]) : ''));
  const bad = JSON.parse(JSON.stringify(doc)); bad.steps[0].enter[0].klasse = 'schlachtschiff';
  ok(Checker.check(bad, {}).errors.some((x) => /klasse|schlachtschiff/.test(x.msg + x.p)), 'Prüfer: unbekannte Klasse wird gemeldet');
  const bad2 = JSON.parse(JSON.stringify(doc)); bad2.steps[0].next[0].if.check.was = 'verschwunden';
  ok(Checker.check(bad2, {}).errors.some((x) => /was|verschwunden/.test(x.msg + x.p)), 'Prüfer: unbekannter Ausgang in verfolgung_ausgang wird gemeldet');
});

section('Snapshot-Größe', () => {
  const T = raum(); const g = T.g; g.players[0].connected = true; platz(g, 600, 1100, 0);
  Verfolgung.starten(g, { klasse: 'korvette', name: 'Falke' });
  const e = zielVon(g); e.scanned = true; g.ship.target = e.id; Zs.waehle(g, 'antrieb');
  const e0 = JSON.stringify(g.snapshot().space.enemies.find((q) => q.id === e.id)).length;
  e.sprung = 3; e.sprungDauer = 12; treffer(g, e, HECK, 3);
  const eintrag = JSON.stringify(g.snapshot().space.enemies.find((q) => q.id === e.id));
  const sn = g.snapshot();
  info(`Zielschiff-Eintrag: ${e0} B vor dem Sprung, ${eintrag.length} B mit sj, nm, az; space.vf ${JSON.stringify(sn.space.vf).length} B; ship.zs ${JSON.stringify(sn.ship.zs).length} B`);
  ok(eintrag.length - e0 <= 40, 'Zusatz je Zielschiff (sj, nm, az) ≤ 40 B');
  const s = JSON.stringify(sn).length;
  ok(s < 18944, `Snapshot mit Verfolgung: ${s} B (Ziel ≤ 18 944)`);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ntest-verfolgung: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
