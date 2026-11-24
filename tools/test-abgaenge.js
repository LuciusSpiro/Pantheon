'use strict';
// SPT-02 7 (E Abgänge): Schiffe verschwinden nicht mehr ohne Knall. Geprüft werden die Server-Stellen (faden-szene.js aufraeumenMitAbzug, faden-szene-b2.js aufraeumenMitKnall, escort.js
// updateLeaving, gegnersprung.js, verfolgung.js, faden-szene.js hilfeWeg, abgang.js) und das Protokoll des Ereignisses abgang { x, y, art }; die Client-Hälfte (case 'abgang', render.js
// abgang_sprung / abgang_rueck) wird als Quelltext geprüft, das Bild selbst liegt in screenshots-spt02-p7/.
//   1. Szenenende mit Ausgang: die Gegner der Szene ziehen ab (leaving), werden nicht still gelöscht; nach der Zeitgrenze abgang rueck bzw. Austritt am Rand; kein zweiter Beat-Ausgang
//   2. Frist im Kampf (Raumschlacht): dasselbe; kampfTakt gibt keinen zweiten Ausgang
//   3. Unterbrechung (Sim-Szene), Szenenwechsel (Sprung) und Andocken bleiben still (Grund szene_ende in der Telemetrie bzw. keine Gegner mehr)
//   4. Schützling: kampfunfähig = ein Knall (kein zweiter im selben Atemzug), länger zurück = Explosion beim Szenenende
//   5. Zeitgrenze des Rückzugs: abgang rueck nur bei Zeitgrenze, nicht am Rand
//   6. Sprung: Notsprung (gegnersprung), Zielschiff der Verfolgung; (Transporter: test-konvoi.js)
//   7. Verbündete der Spontanhilfe springen ab (hilfeWeg); (Sim-Szene: test-szene-sund.js)
//   8. abgang.melde, Protokoll, Snapshot unberührt, Client-Hälfte
// Erwartete Werte: eigene Zählung im Test.      node tools/test-abgaenge.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const CONFIG = require('../shared/config.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Escort = require('../server/sim/escort.js');
const Faden = require('../server/sim/faden.js');
const FS = require('../server/sim/faden-szene.js');
const SZB2 = require('../server/sim/faden-szene-b2.js');
const Abgang = require('../server/sim/abgang.js');
const Gegnersprung = require('../server/sim/gegnersprung.js');
const Tel = require('../server/telemetrie/gefecht.js');
const SZ = require('../content/faeden/szenen-werte.json');
const SW = Object.fromEntries(Object.entries(SZ.werte).map(([k, v]) => [k, v.wert]));
const { D, spiel, oeffne, grenzen, alsVorlage, registriere, F } = X;
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
const HZ = CONFIG.tickHz;
const laufe = (g, sek) => { const k = Math.round(sek * HZ); for (let i = 0; i < k; i++) g.step(); };
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };

// Ereignisse, Beat-Ausgänge, Missionsereignisse und Telemetrie-Gründe mitschreiben
function lausche(g) {
  const L = { abgang: [], explosion: [], leftEvt: 0, ausgang: [], grund: [] };
  const o = g.emit.bind(g); g.emit = (k, d) => { if (k === 'abgang') L.abgang.push(d); if (k === 'explosion') L.explosion.push(d); return o(k, d); };
  const m = g.missionEvent.bind(g); g.missionEvent = (k, d) => { if (k === 'enemyLeft') L.leftEvt++; return m(k, d); };
  const ba = Faden.beatAusgang; Faden.beatAusgang = function (game, id, aus) { if (game === g) L.ausgang.push(aus); return ba.apply(this, arguments); };
  const rw = Tel.raumWegGrund; Tel.raumWegGrund = function (game, liste, grund) { if (game === g) L.grund.push({ grund, n: liste.length }); return rw.apply(this, arguments); };
  L.stop = () => { Faden.beatAusgang = ba; Tel.raumWegGrund = rw; };
  return L;
}

// ---- Aufbau: Geleit-Szene (Schützling + Angreifer) wie in test-faden-katalog-b2.js
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
function neu(seed, crew) {
  const t = F.neuesSpiel({ crew: crew || 1, seed: seed || 11, names: NAMEN.slice(0, crew || 1), env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  const llm = LLM.create({ mode: 'mock' });
  t.g.lageSpielleiter = LS.create(t.g, { llm, werte: { min_abstand_ticks: 1, deckel_je_sitzung: 9999 } }); t.g.lageSchalter = true;
  t.run = (sek) => laufe(t.g, sek);
  return t;
}
const ort = (hex) => Sektoren.ortVonHex(hex) || ('leer-' + hex);
const flieg = (t, hex) => { Space.enterScene(t.g, ort(hex), {}); t.g.explore.location = ort(hex); ab(t.g); t.run(0.1); };
const plan = (beats) => ({ format: 'faden-bauplan/1', titel: 'ZEBRAKAI Probe', anlass: 'Anlass ZEBRAKAI fuer den Test', beats });
const b = (typ, o) => Object.assign({ typ }, o || {});
function geleitStart(t) {
  const g = t.g;
  flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300;
  const a = Faden.abenteuerAnbieten(g, plan([b('geleit'), b('abschluss')]), { hex: '0305' });
  const f = Faden.abenteuerOeffnen(g, a.angebot.nr).faden;
  for (let i = 0; i < 10; i++) {
    const bt = { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id };
    if (Faden.befehlPruefen(g, bt) === null) { Faden.befehlAnwenden(g, bt); break; }
    grenzen(g, 1);
  }
  t.run(SW.vorlauf_s + 1);
  return f;
}
const schuetzling = (g) => (g.space.escorts || []).find((q) => !q.ally) || null;
const mitTag = (g, tag) => g.space.enemies.filter((e) => e.tag === tag);

section('1. Szenenende mit Ausgang gescheitert: die Gegner ziehen ab (nicht still gelöscht), nach der Zeitgrenze weg, genau ein Beat-Ausgang', () => {
  const t = neu(41, 1), g = t.g;
  const f = geleitStart(t);
  const tag = g.fadenSzene.tag, es = schuetzling(g);
  const vorher = mitTag(g, tag);
  ok(vorher.length === 2 && !!es, 'Szene läuft: 2 Angreifer und ein Schützling');
  const L = lausche(g);
  Escort.hit(g, es, 9999, { src: 'test' }); t.run(1);
  ok(!g.fadenSzene && f.phase === 'wartet' && f.beat === 1, 'Schützling kampfunfähig: die Szene endet gescheitert, der Faden geht zum Abschluss (wie vorher)');
  ok(L.ausgang.length === 1 && L.ausgang[0] === 'gescheitert', 'genau ein Beat-Ausgang, gescheitert (' + L.ausgang.join() + ')');
  const noch = vorher.filter((e) => g.space.enemies.includes(e));
  ok(noch.length >= 1 && noch.every((e) => e.leaving) && vorher.every((e) => e.leaving), 'alle Angreifer ziehen ab (leaving), mindestens einer steht noch im Bild (der andere stand schon am Kartenrand und ist dort hinausgeflogen)');
  ok(L.grund.length === 0, 'kein stilles Entfernen (keine Telemetrie-Grundvormerkung szene_ende)');
  t.run(20);
  ok(vorher.every((e) => !g.space.enemies.includes(e)), 'nach 20 s sind beide weg');
  ok(L.leftEvt === 2, 'enemyLeft je Gegner einmal (' + L.leftEvt + ')');
  ok(L.abgang.every((a) => a.art === 'rueck' && Number.isFinite(a.x) && Number.isFinite(a.y)) && L.abgang.length <= 2, 'abgang nur als rueck, je höchstens einer je Gegner (' + L.abgang.length + '; am Rand: kein Ereignis)');
  ok(L.ausgang.length === 1 && f.beat === 1 && f.phase === 'wartet', 'nach dem Abzug ändert sich am Beat nichts mehr (kein zweiter Ausgang, kein neuer Start)');
  ok(g.errors === 0, 'keine Serverfehler');
  L.stop();
});

section('2. Raumschlacht: die Frist beendet den Beat im Kampf, die Gegner ziehen ab', () => {
  const r = registriere(alsVorlage('abg_raum', (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    v.beats = [
      { id: 'b_szene', typ: 'raumschlacht', aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['raumschlacht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  ok(r.ok, 'Vorlage gültig');
  const x = spiel({ crew: 1, seed: 11 }); const g = x.g; ab(g);
  Space.enterScene(g, Sektoren.ortVonHex('0305'), {}); ab(g);
  const f = oeffne(g, 'abg_raum'); grenzen(g, 5);
  ok(Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_szene' }).ok, 'Beat startet');
  laufe(g, SW.vorlauf_s + 1);
  const tag = g.fadenSzene.tag; const vorher = mitTag(g, tag);
  ok(g.fadenSzene.phase === 'kampf' && vorher.length === 2, 'Kampf mit 2 Gegnern');
  const L = lausche(g);
  const fremd = { tag: 'fremd', pct: 50 }; g.space.retreatRule = fremd;   // eine laufende Regel (enemies_retreat) gehört nicht der Szene
  const relais = Space.spawnEnemy(g, 'relay', { x: g.ship.x, y: g.ship.y - 700, tag });   // ein Relais kann nicht abziehen (abseits der Lanzenachse der Lerche, sonst schießt sie es ab)
  Faden.beatAusgang(g, f.id, 'gescheitert');   // Frist (oder anderer Weg) beendet den Beat im Kampf
  L.ausgang.length = 0;
  laufe(g, 0.2);
  ok(!g.fadenSzene && vorher.every((e) => g.space.enemies.includes(e) && e.leaving), 'Frist: die Szene ist weg, die Gegner stehen noch und ziehen ab');
  ok(g.space.retreatRule === fremd && fremd.pct === 50 && fremd.tag === 'fremd', 'die vorher gesetzte Rückzugsregel bleibt unberührt (die Szene hinterlässt keine eigene)');
  ok(!!relais && !g.space.enemies.includes(relais), 'ein Gegner, der nicht abziehen kann (Relais), geht still');
  ok(L.ausgang.length === 0, 'kampfTakt gibt nach dem Ende keinen zweiten Ausgang');
  laufe(g, 20);
  ok(mitTag(g, tag).length === 0 && f.phase === 'wartet' && f.beat === 1, 'nach dem Abzug ist nichts übrig, der Beat steht (Abschluss)');
  ok(L.explosion.length === 0, 'der Abzug erzeugt keine Explosion (nur ein Abgang)');
  L.stop();
});

section('3. Unterbrechung, Szenenwechsel (Sprung) und Andocken bleiben still', () => {
  // Sim-Szene unterbricht (stilles Löschen, Telemetrie-Grund szene_ende)
  let t = neu(43, 1), g = t.g; const f = geleitStart(t);
  let tag = g.fadenSzene.tag; let L = lausche(g);
  g.simSzene = { id: 5, phase: 'kampf' }; FS.update(g, 1 / HZ); g.simSzene = null;
  ok(!g.fadenSzene && mitTag(g, tag).length === 0 && f.beat === 0, 'Unterbrechung: die Gegner sind sofort weg (still), der Beat steht wieder aus');
  ok(L.grund.some((x) => x.grund === 'szene_ende' && x.n === 2), 'Telemetrie: gegner_weg bekommt den Grund szene_ende (2 Gegner)');
  ok(L.abgang.length === 0 && L.leftEvt === 0 && L.explosion.length === 0, 'kein Ereignis (still)');
  L.stop();
  // Szenenwechsel: Gegner kamen nicht mit (enterScene leert die Liste), nichts zieht ab
  t = neu(44, 1); g = t.g; geleitStart(t); L = lausche(g);
  const nach = Sektoren.nachbarn(Sektoren.hexVonOrt(g.ship.scene)).find((h) => Sektoren.spielbar(h));
  Space.enterScene(g, Sektoren.ortVonHex(nach), {}); ab(g); t.run(0.5);
  ok(!g.fadenSzene && g.space.enemies.every((e) => !e.leaving) && L.abgang.length === 0, 'Szenenwechsel: die Szene endet gescheitert, nichts zieht ab, kein abgang');
  L.stop();
  // Andocken: still (Ausgang gescheitert mit textKey szenenwechsel)
  t = neu(45, 1); g = t.g; geleitStart(t); L = lausche(g); tag = g.fadenSzene.tag;
  g.ship.docked = true; g.ship.dockedAt = g.ship.scene; g.missionEvent('docked', {});
  ok(!g.fadenSzene && mitTag(g, tag).length === 0 && L.abgang.length === 0, 'Andocken: die Gegner sind sofort weg (still), kein abgang');
  L.stop();
});

section('4. Schützling: kampfunfähig = ein Knall; länger zurück = Explosion beim Szenenende', () => {
  let t = neu(46, 1), g = t.g; geleitStart(t);
  let es = schuetzling(g); let L = lausche(g);
  Escort.hit(g, es, 9999, { src: 'test' }); t.run(1);
  ok(!g.fadenSzene && L.explosion.length === 1, 'zerstört und gleich Szenenende: genau EIN Knall (der von disable, kein zweiter im selben Atemzug) (' + L.explosion.length + ')');
  ok(!schuetzling(g), 'der Schützling ist aus der Liste');
  L.stop();
  t = neu(47, 1); g = t.g; geleitStart(t);
  es = schuetzling(g); L = lausche(g);
  Escort.hit(g, es, 9999, { src: 'test' });
  es.disabledT = g.time - 20;   // er treibt schon lange: das Szenenende ist ein eigener Anlass
  const x = Math.round(es.x), y = Math.round(es.y);
  t.run(0.2);
  ok(!g.fadenSzene && L.explosion.length === 2 && Math.abs(L.explosion[1].x - x) < 40 && Math.abs(L.explosion[1].y - y) < 40 && L.explosion[1].zone === 'space', 'treibt schon lange: beim Szenenende ein zweiter Knall an seiner Position (' + L.explosion.length + ')');
  L.stop();
  // ein heiler Schützling bekommt keinen Knall
  t = neu(48, 1); g = t.g; geleitStart(t); L = lausche(g);
  SZB2.aufraeumenMitKnall(g, g.fadenSzene);
  ok(L.explosion.length === 0 && !schuetzling(g), 'heiler Schützling: keine Explosion, aber aus der Liste');
  L.stop();
});

section('5. Zeitgrenze des Rückzugs: abgang rueck mitten im Feld, am Rand keiner', () => {
  const t = neu(49, 1), g = t.g; flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300; g.space.enemies = [];
  const sp = g.space; const L = lausche(g);
  const mitte = Space.spawnEnemy(g, 'raider', { x: sp.w / 2, y: sp.h / 2, tag: 'abg_t' });
  const rand = Space.spawnEnemy(g, 'raider', { x: 40, y: sp.h / 2, tag: 'abg_t' });
  for (const e of [mitte, rand]) { e.leaving = true; e.leaveT = 0; e.retreatUntil = g.time + 9999; e.vx = 0; e.vy = 0; }
  mitte.leaveT = 14.5; rand.leaveT = 1;
  t.run(0.2);
  ok(!sp.enemies.includes(mitte) && !sp.enemies.includes(rand), 'beide verlassen die Liste');
  ok(L.abgang.length === 1 && L.abgang[0].art === 'rueck' && Math.abs(L.abgang[0].x - sp.w / 2) < 60 && Math.abs(L.abgang[0].y - sp.h / 2) < 60, 'genau ein abgang rueck, in der Mitte (nicht der Rand-Austritt) (' + JSON.stringify(L.abgang) + ')');
  L.stop();
});

section('6. Sprung: Notsprung (Gegnersprung) und Zielschiff der Verfolgung melden abgang sprung', () => {
  const t = neu(50, 1), g = t.g; flieg(t, '0305'); g.space.enemies = [];
  const L = lausche(g);
  const e = Space.spawnEnemy(g, 'raider', { x: 1200, y: 700, tag: 'abg_s' });
  e.notsprung = { rest: 0.01 };
  Gegnersprung.schritt(g, e, 0.1);
  ok(!g.space.enemies.includes(e) && L.abgang.length === 1 && L.abgang[0].art === 'sprung' && L.abgang[0].x === 1200 && L.abgang[0].y === 700, 'Notsprung: abgang sprung an der Position des Gegners');
  L.stop();
  // Verfolgung: das Ziel springt ohne Eingriff
  registriere(alsVorlage('abg_jagd', (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    v.beats = [
      { id: 'b_szene', typ: 'verfolgung', parameter: { fluchtziel: 'naechster_sprungpunkt' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['verfolgung_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  const x = spiel({ crew: 1, seed: 16 }); const g2 = x.g; ab(g2); Space.enterScene(g2, Sektoren.ortVonHex('0305'), {}); ab(g2);
  const f = oeffne(g2, 'abg_jagd'); grenzen(g2, 5);
  const L2 = lausche(g2);
  Faden.befehlAnwenden(g2, { typ: 'faden_weiter', faden: f.id, beat: 'b_szene' });
  let s = 0; while (s < 240 && f.phase === 'laeuft') { laufe(g2, 1); s++; }
  ok(f.phase === 'wartet' && L2.abgang.length === 1 && L2.abgang[0].art === 'sprung', 'Verfolgung: das Ziel springt, genau ein abgang sprung (' + L2.abgang.length + ')');
  ok(L2.ausgang.length === 1 && L2.ausgang[0] === 'gescheitert', 'und der Beat endet wie zuvor gescheitert');
  L2.stop();
});

section('7. Verbündeter der Spontanhilfe springt am Gefechtsende ab (hilfeWeg)', () => {
  const t = neu(51, 1), g = t.g; flieg(t, '0305'); g.space.enemies = [];
  const L = lausche(g);
  g.space.escorts = g.space.escorts || [];
  g.space.escorts.push({ id: 'a1', tag: 'nsc_x_1', ally: true, hp: 50, x: 777, y: 555, state: 'ok' });
  g.space.escorts.push({ id: 'a2', tag: 'nsc_x_1', ally: true, hp: 0, x: 111, y: 222, state: 'zerstoert' });   // zerstört: hat seinen Knall schon
  g.fadenHilfe = { fadenId: 'gibt-es-nicht', beatId: 'b', nsc: null, schiff: 'X', name: 'X', versucht: null, n: 0, ally: { tag: 'nsc_x_1', kampf: null } };
  FS.update(g, 1 / HZ);
  ok(!g.fadenHilfe || !g.fadenHilfe.ally, 'die Hilfe ist beendet');
  ok(L.abgang.length === 1 && L.abgang[0].art === 'sprung' && L.abgang[0].x === 777 && L.abgang[0].y === 555, 'der lebende Verbündete springt ab (abgang sprung), der zerstörte nicht (' + JSON.stringify(L.abgang) + ')');
  L.stop();
});

section('8. abgang.melde und Protokoll; Snapshot unberührt; Client-Hälfte', () => {
  const g = neu(52, 1).g; const L = lausche(g);
  Abgang.melde(g, { x: 10.4, y: 20.6 }, 'sprung'); Abgang.melde(g, { x: 1, y: 2 }, 'unbekannt'); Abgang.melde(g, { x: NaN, y: 2 }, 'rueck'); Abgang.melde(g, null, 'rueck');
  ok(L.abgang.length === 1 && L.abgang[0].x === 10 && L.abgang[0].y === 21 && L.abgang[0].art === 'sprung', 'melde: gerundet, nur bekannte Arten, nur endliche Koordinaten');
  L.stop();
  const P = require('../shared/protocol.js');
  const flach = JSON.stringify(P.PROTOCOL || P);
  ok(flach.includes('"ABGANG_EVENTS":["abgang"]') && flach.includes('"ABGANG_ARTEN":["sprung","rueck"]'), 'Protokoll nennt Ereignis und Arten');
  ok(JSON.stringify(Abgang.ARTEN) === JSON.stringify(['sprung', 'rueck']), 'Arten im Server = Arten im Protokoll');
  const snap = JSON.stringify(g.snapshot());
  ok(!/"abgang"/.test(snap) && !/disabledT/.test(snap), 'der Snapshot trägt weder abgang noch disabledT (Ereignisse laufen außerhalb)');
  const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'client.js'), 'utf8');
  const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'render.js'), 'utf8');
  ok(/case 'abgang':[\s\S]{0,300}R\.addFx\('abgang_' \+ ev\.art/.test(c) && /case 'konvoiSprung': break;/.test(c), "Client: case 'abgang' zeichnet abgang_<art>, konvoiSprung macht keinen zweiten Blitz");
  ok(/kind === 'abgang_sprung'/.test(r) && /kind === 'abgang_rueck'/.test(r), 'Render: beide FX-Arten gezeichnet');
});

console.log('\n' + (n - fails) + '/' + n + ' Pruefungen ok' + (fails ? ' – ' + fails + ' FEHLER' : ''));
if (fails) process.exit(1);
console.log('ABGAENGE OK');
