'use strict';
// SYS-01 C Nacharbeit (Review zu C1b-1, C1b-2, C2a, C2b), Befunde 1, 2, 4, 5, 7:
//   1. Die Regeln des Bausteins gegner_notfallsprung gelten nur in ihrer Szene (Szenenwechsel, Szene von vorn): ohne Baustein flieht kein Gegner (Abnahme 16).
//   2. Entkommen per Notfallsprung ist in Verfolgung (Ausgang entkommen) und Konvoi (Transporter nicht zerstört, keine Fracht, nicht aufgehalten) kein "zerstört".
//   4. Der Reaktor-Countdown tickt auch während der Sprungladung; wer zuerst abläuft, gewinnt. Obergrenze für verzoegerung_s im Vertrag und im Prüfer.
//   5. Das Systemziel der Ops geht mit dem Ziel (Zielsysteme.zielLoeschen, alle Stellen).
//   7. Keine toten Exporte (Gegnersprung.AUSLOESER, Zielsysteme.SCHALTER).
// Befund 3 (Gegnertreffer der Lerche auf die Mitte) steht in test-zielsysteme-zonen.js.
//   node tools/test-gegner-nacharbeit.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Gegnertod = require('../server/sim/gegnertod.js');
const Gegnersprung = require('../server/sim/gegnersprung.js');
const Verfolgung = require('../server/sim/verfolgung.js');
const Konvoi = require('../server/sim/konvoi.js');
const Szenenreset = require('../server/sim/szenenreset.js');
const Zs = require('../server/sim/zielsysteme.js');
const Registry = require('../server/mission/registry.js');
const Checker = require('../server/mission/checker.js');
const Testhilfe = require('./gegner-testhilfe.js');
const W = require('../content/kampf/gegnersprung-werte.json').werte;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-nacharbeit-'));
function raum() {
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'N0', name: 'N0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = true;
  space.enterScene(g, 'splitter', {});
  g.space.enemies = []; g.space.projectiles = [];
  const events = [];
  const me0 = g.missionEvent.bind(g);
  g.missionEvent = (name, data) => { events.push(Object.assign({ kind: name }, data)); return me0(name, data); };
  const sh = g.ship; sh.x = 300; sh.y = 300; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0;
  return { g, ev: (k) => events.filter((e) => e.kind === k) };
}
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const baustein = (g, a) => Registry.get('gegner_notfallsprung').run({ game: g, step: { loc: g.ship.scene } }, a);
const mk = (g, kind, tag) => space.spawnEnemy(g, kind, { tag, x: 1800, y: 800, ziel: 'lerche' });

section('Befund 1: Regeln des Bausteins gelten nur in ihrer Szene', () => {
  const { g } = raum();
  baustein(g, { ziel: 'korvette', ausloeser: 'sofort', verzoegerung_s: 1 });
  ok(g.space.sprungRegeln && g.space.sprungRegeln.length === 1, 'Vorbedingung: die Regel steht im Splittergürtel');
  const a = mk(g, 'korvette', 'a'); ticks(g, 2);
  ok(!g.space.enemies.includes(a), 'Vorbedingung: im Splittergürtel entkommt die Korvette');
  space.enterScene(g, 'hafen', {}); g.space.enemies = [];
  ok(!g.space.sprungRegeln, 'nach dem Szenenwechsel steht keine Regel mehr (space.sprungRegeln)');
  const b = mk(g, 'korvette', 'b'); ticks(g, 3);
  ok(g.space.enemies.includes(b) && !b.notsprung, 'neue Korvette im Hafen: bleibt, kein Entkommen (ohne Baustein flieht kein Gegner)');
  // Szene von vorn
  const { g: h } = raum();
  baustein(h, { ziel: 'korvette', ausloeser: 'sofort', verzoegerung_s: 1 });
  mk(h, 'korvette', 'c'); ticks(h, 2);
  Szenenreset.zuruecksetzen(h, {});
  ok(!h.space.sprungRegeln && !h.space.entkommene, 'Szene von vorn (szenenreset): Regeln und Entkommenen-Liste weg');
  const d = mk(h, 'korvette', 'd'); ticks(h, 3);
  ok(h.space.enemies.includes(d) && !d.notsprung, 'nach Szene von vorn flieht die neue Korvette nicht');
});

section('Befund 2: Verfolgung, Entkommen per Notfallsprung ist entkommen', () => {
  const { g } = raum();
  const k = Verfolgung.starten(g, { klasse: 'korvette' });
  ok(!!k && Verfolgung.ausgang(g) === null, 'Vorbedingung: Verfolgung läuft');
  baustein(g, { ziel: 'korvette', ausloeser: 'sofort', verzoegerung_s: 1 });
  ticks(g, 3);
  ok(Verfolgung.ausgang(g) === 'entkommen', 'Ausgang entkommen (nicht zerstoert): ' + Verfolgung.ausgang(g));
  ok(g.stats.verfolgung.entkommen === 1 && g.stats.verfolgung.zerstoert === 0 && !Verfolgung.erfolg(g), 'Zähler: entkommen 1, zerstoert 0, kein Erfolg');
  // Gegenprobe: echter Abschuss bleibt zerstoert
  const { g: h } = raum();
  Verfolgung.starten(h, { klasse: 'korvette' });
  const e = h.space.enemies.find((x) => x.tag === 'verfolgung');
  Testhilfe.toeten(h, e, { von: [e.x - 30, e.y] }); ticks(h, 1);
  ok(Verfolgung.ausgang(h) === 'zerstoert', 'Gegenprobe: Abschuss ohne Baustein bleibt zerstoert');
});

section('Befund 2: Konvoi, entkommener Transporter ist nicht zerstört und nicht aufgehalten', () => {
  const T = raum(); const g = T.g;
  Konvoi.an(g, { n: 1, sieg: 'aufhalten', eskorte: 'keine', wiederholung: false });
  baustein(g, { ziel: 'frachter', ausloeser: 'sofort', verzoegerung_s: 1 });
  ticks(g, 3);
  ok(Konvoi.zerstoert(g) === 0 && Konvoi.gesprungen(g) === 1, 'Transporter: nicht zerstört, gesprungen (' + Konvoi.zerstoert(g) + '/' + Konvoi.gesprungen(g) + ')');
  ok(Konvoi.ausgang(g) === 'entkommen' && !Konvoi.erfolg(g), 'Aufhalten: Transporter weg = entkommen, kein Erfolg (' + Konvoi.ausgang(g) + ')');
  ok(T.ev('konvoiTransporterZerstoert').length === 0 && g.space.konvoi.pods.length === 0, 'keine Zerstörung gemeldet, keine Fracht abgeworfen');
  const P = raum(); const p = P.g;
  Konvoi.an(p, { n: 1, sieg: 'pluendern', eskorte: 'keine', wiederholung: false });
  baustein(p, { ziel: 'frachter', ausloeser: 'sofort', verzoegerung_s: 1 });
  ticks(p, 3);
  ok(p.space.konvoi.pods.length === 0 && Konvoi.ausgang(p) === 'entkommen' && P.ev('konvoiTransporterZerstoert').length === 0, 'Plündern: keine Fracht (kein Wrack), Ausgang entkommen');
  // Gegenprobe: Abschuss wirft Fracht ab und gilt als aufgehalten
  const Q = raum(); const q = Q.g;
  Konvoi.an(q, { n: 1, sieg: 'aufhalten', eskorte: 'keine', wiederholung: false });
  const t = Konvoi.transporter(q)[0];
  Testhilfe.toeten(q, t, { von: [t.x - 30, t.y] }); ticks(q, 1);
  ok(Konvoi.zerstoert(q) === 1 && Konvoi.ausgang(q) === 'aufgehalten', 'Gegenprobe: Abschuss bleibt zerstört und aufgehalten');
});

section('Befund 4: Countdown tickt auch während der Sprungladung', () => {
  // (a) Ladung 30 s von Anfang an, Reaktor nach 1 s zerstört: der Countdown läuft ab, der Gegner stirbt, kein Entkommen
  const A = raum(); const a = A.g;
  baustein(a, { ziel: 'korvette', ausloeser: 'sofort', verzoegerung_s: 30 });
  const e = mk(a, 'korvette', 'ca'); ticks(a, 1);
  ok(!!e.notsprung, 'Vorbedingung: die Ladung läuft');
  Gegnertod.brechen(a, e, 'reaktor');
  const rest = e.rt.rest;
  ok(rest < 29, 'Vorbedingung: Countdown (' + rest.toFixed(1) + ' s) kürzer als der Rest der Ladung');
  ticks(a, 5);
  ok(e.rt.rest != null && e.rt.rest < rest - 4, 'Countdown tickt während der Ladung (Rest ' + (e.rt.rest != null ? e.rt.rest.toFixed(1) : null) + ' nach 5 s, vorher ' + rest.toFixed(1) + ')');
  ticks(a, rest + 1);
  ok(!a.space.enemies.includes(e) && A.ev('enemyKilled').some((x) => x.enemy === e) && !A.ev('enemyEscaped').some((x) => x.enemy === e), 'Gegner stirbt (enemyKilled), entkommt nicht');
  // (b) Countdown beginnt während der Ladung, die Ladung ist zuerst fertig
  const B = raum(); const b = B.g;
  baustein(b, { ziel: 'korvette', ausloeser: 'sofort', verzoegerung_s: 6 });
  const f = mk(b, 'korvette', 'cb'); ticks(b, 4);
  Gegnertod.brechen(b, f, 'reaktor');
  ticks(b, 3);
  ok(!b.space.enemies.includes(f) && B.ev('enemyEscaped').some((x) => x.enemy === f) && !B.ev('enemyKilled').some((x) => x.enemy === f), 'Countdown beginnt während der Ladung, Ladung zuerst fertig: entkommt, kein Abschuss');
  // (c) Countdown beginnt während der Ladung, läuft vor dem Sprung ab
  const C = raum(); const c = C.g;
  baustein(c, { ziel: 'korvette', ausloeser: 'sofort', verzoegerung_s: 20 });
  const h = mk(c, 'korvette', 'cc'); ticks(c, 2);
  Gegnertod.brechen(c, h, 'reaktor'); h.rt.rest = 4;
  ticks(c, 5);
  ok(!c.space.enemies.includes(h) && C.ev('enemyKilled').some((x) => x.enemy === h) && !C.ev('enemyEscaped').some((x) => x.enemy === h), 'Countdown (4 s) läuft vor dem Sprung (18 s) ab: der Gegner stirbt');
  // (d) Countdown schon vor der Ladung (Rest 5 s < Ladung 8 s): keine Ladung, Tod
  const D = raum(); const d = D.g;
  const i = mk(d, 'korvette', 'cd'); Gegnertod.brechen(d, i, 'reaktor'); i.rt.rest = 5;
  baustein(d, { ziel: 'korvette', ausloeser: 'sofort', verzoegerung_s: 8 });
  ticks(d, 6);
  ok(!d.space.enemies.includes(i) && D.ev('enemyKilled').some((x) => x.enemy === i), 'Countdown vor der Ladung kürzer: der Gegner stirbt');
  // Vertrag: Maximum
  ok(W.verzoegerung_s.max === 60, 'Vertrag: verzoegerung_s hat ein Maximum (' + W.verzoegerung_s.max + ')');
  const doc = (v) => ({ format: 'regiebuch/1', id: 'sprung_max', titel: 'Max', auftraggeber: 'tesk', kopf: { art: 'test' }, buehne: { orte: ['splitter'] },
    steps: [{ id: 'a', loc: 'splitter', enter: [{ do: 'gegner_notfallsprung', ziel: 'raider', ausloeser: 'sofort', verzoegerung_s: v }],
      objectives: [{ id: 'o1', text: '@t1', done: { check: { name: 'verfolgung_erfolg' } } }],
      next: [{ if: { check: { name: 'verfolgung_erfolg' } }, complete: 'erfolg' }] }],
    texte: { t1: 'x' } });
  const fehl = (r) => r.errors.some((x) => /verzoegerung/.test(x.msg + x.p));
  ok(!fehl(Checker.check(doc(60), {})), 'Prüfer: verzoegerung_s = 60 ist erlaubt');
  ok(fehl(Checker.check(doc(61), {})), 'Prüfer: verzoegerung_s = 61 wird gemeldet');
});

section('Befund 5: das Systemziel geht mit dem Ziel', () => {
  const { g } = raum();
  const e = mk(g, 'fregatte', 'z'); e.scanned = true;
  g.ship.target = e.id; g.ship.zielsystem = 'antrieb';
  Zs.zielLoeschen(g);
  ok(g.ship.target === null && g.ship.zielsystem === undefined, 'Zielsysteme.zielLoeschen: Ziel und Systemziel weg');
  // Statische Probe: keine Stelle leert ship.target allein (der Szenenwechsel in space.enterScene löscht zielsystem direkt daneben)
  const treffer = [];
  const lies = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) lies(p); else if (/\.js$/.test(f.name)) fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((z, i) => { if (/ship\.target = null/.test(z)) treffer.push(f.name + ':' + (i + 1) + ' ' + z.trim().slice(0, 70)); }); } };
  lies(path.join(__dirname, '..', 'server'));
  const fremd = treffer.filter((t) => !/^zielsysteme\.js:/.test(t) && !/^space\.js:\d+ ship\.target = null;$/.test(t));
  ok(fremd.length === 0, 'kein ship.target = null außerhalb von zielsysteme.js (und dem Szenenwechsel)' + (fremd.length ? ': ' + fremd.join(' | ') : ''));
  // Verhalten: Notfallsprung des Ziels, Abschuss des Ziels
  const { g: h } = raum();
  baustein(h, { ziel: 'korvette', ausloeser: 'sofort', verzoegerung_s: 1 });
  const k = mk(h, 'korvette', 'zz'); k.scanned = true; h.ship.target = k.id; h.ship.zielsystem = 'antrieb';
  ticks(h, 2);
  ok(h.ship.target === null && h.ship.zielsystem === undefined, 'Notfallsprung des Ziels: Systemziel gelöscht');
  // Konvoi-Neustart: das Ziel war ein Konvoi-Schiff, der Rest wird abgeräumt
  const { g: m } = raum();
  Konvoi.an(m, { n: 1, sieg: 'aufhalten', eskorte: 'keine', wiederholung: true });
  const t = Konvoi.transporter(m)[0];
  m.ship.target = t.id; m.ship.zielsystem = 'antrieb';
  Testhilfe.toeten(m, t, { von: [t.x - 30, t.y] });
  ticks(m, 12);
  ok(m.ship.target === null && m.ship.zielsystem === undefined, 'Konvoi: Ziel weg (Abschuss, Neustart) -> Systemziel gelöscht');
});

section('Befund 7: keine toten Exporte', () => {
  ok(!('AUSLOESER' in Gegnersprung), 'Gegnersprung.AUSLOESER entfernt');
  ok(!('SCHALTER' in Zs), 'Zielsysteme.SCHALTER entfernt');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ntest-gegner-nacharbeit: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
