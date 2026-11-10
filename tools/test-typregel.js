'use strict';
// LAD-01 A2: Typ-Regel je Frachtraum-Modul (ein Modul, eine Art, 4 Plätze), die gemeinsame Belegungsfunktion Maps.frachtBelegung und die EINE Einlagerung
// Fracht.lagerAufnehmen(game, { art, quelle }) mit Fracht.platzFuer als Prüfung.
//   Erstes Gut legt den Typ fest, andere Art wird abgelehnt bis das Modul leer ist, 4 Plätze je Modul (der 5. wird abgelehnt), zwei Module = zwei Arten,
//   Personen und Waren nur in getrennten Modulen, klare Hinweistexte, alle Einlagerungswege laufen durch lagerAufnehmen (Beamen, Debug/Skript, Schöpfen,
//   Konvoi-Beute, fracht_zuteilen, Personen, Kampagne, Laden), Füllstand 25/50/75/100 %, 4 Personen = 4 Betten, Eisenwald-Gegentest (Sprengstoff, Konvoi, Kette k2 bis k4).
//   node tools/test-typregel.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const CONFIG = require('../shared/config.js');
const Maps = require('../shared/maps.js');
const { Game } = require('../server/game.js');
const Fracht = require('../server/sim/fracht.js');
const PB = require('../server/sim/personen-bord.js');
const Modul = require('../server/sim/module.js');
const Ausbau = require('../server/sim/ausbau.js');
const Ladung = require('../server/sim/ladung.js');
const Konvoi = require('../server/sim/konvoi.js');
const Away = require('../server/sim/away.js');
const space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');
const Registry = require('../server/mission/registry.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-typregel-'));

function arena() {
  const g = new Game({ noStore: true, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Typ0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  g.god = true;
  const p = g.players[0];
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  const mev = []; const me0 = g.missionEvent.bind(g);
  g.missionEvent = (kind, data) => { mev.push(Object.assign({ kind }, data)); return me0(kind, data); };
  const T = { g, c, p, run, mev };
  T.cmd = (cmd, f) => { c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.taktik = () => { p.console = 'weapons'; };
  run(0.1);
  return T;
}
// Konvoi-Szene (Rabenpass), Lerche weit weg vom Konvoi
function konvoiRaum() {
  const T = arena(); const g = T.g;
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  g.ship.x = 300; g.ship.y = 300; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0;
  T.run(0.1);
  return T;
}
// Frachträume setzen (Raumnummern), Rest Krankenstation
function module(g, raeume) {
  Ausbau.setStufe(g, 3);
  g.ship.module = raeume.map((r) => ({ id: 'frachtraum', raum: r, an: true, lauf: true }));
  if (!raeume.includes(2)) g.ship.module.push({ id: 'krankenstation', raum: 2, an: true, lauf: true });
  Modul.verteilungSetzen(g);
}
const leeren = (g) => Fracht.debug(g, ['leer']);
const arten = (g) => Fracht.belegung(g).module.map((m) => (m.art ? m.art + ':' + m.anzahl : '-')).join();

section('Erstes Gut legt den Typ fest, andere Art wird abgelehnt', () => {
  const T = arena(); const g = T.g;
  ok(Fracht.capacity(g) === 4 && Fracht.belegung(g).module.length === 1 && Fracht.belegung(g).module[0].art === null, 'Start-Lerche: ein leeres Modul (4 Plätze)');
  ok(Fracht.platzFuer(g, 'fracht').ok && Fracht.platzFuer(g, 'sprengstoff').ok, 'leer: jede Art passt');
  ok(Fracht.anBordLegen(g, 'sprengstoff'), 'Sprengstoff an Bord');
  ok(arten(g) === 'sprengstoff:1', 'das Modul trägt jetzt Sprengstoff (1/4)');
  const pf = Fracht.platzFuer(g, 'fracht');
  ok(!pf.ok && pf.grund === 'art_belegt', 'Fracht wird abgelehnt (grund art_belegt)');
  ok(!Fracht.anBordLegen(g, 'fracht') && !Fracht.anBordLegen(g, 'deuterium') && Fracht.anBord(g) === 1, 'anBordLegen lehnt andere Arten ab');
  ok(Fracht.platzFuer(g, 'sprengstoff').ok, 'dieselbe Art passt weiter');
  // erst wenn das Modul leer ist, kann es eine andere Art aufnehmen
  Fracht.skriptAbliefern(g, 'sprengstoff', null);
  ok(Fracht.anBord(g) === 0 && Fracht.platzFuer(g, 'fracht').ok, 'Modul leer: eine andere Art passt wieder');
  ok(Fracht.anBordLegen(g, 'fracht') && arten(g) === 'fracht:1', 'jetzt legt Fracht den Typ fest');
  ok(!Fracht.anBordLegen(g, 'sprengstoff'), 'und Sprengstoff passt nicht mehr');
  // per Beamen
  leeren(g); T.taktik();
  Fracht.fracht_abwerfen(g, g.ship.x + 100, g.ship.y, 'sprengstoff');
  Fracht.fracht_abwerfen(g, g.ship.x + 120, g.ship.y, 'fracht');
  T.cmd('weapons.fracht'); T.run(3.2);
  ok(Fracht.anBord(g, 'sprengstoff') === 1, 'Beamen: das Sprengstoff-Paket kommt an Bord (nächste Fracht)');
  const err = T.cmd('weapons.fracht');
  ok(err.length === 1 && /nur eine Art/.test(err[0]) && !g.fracht.halt, 'Beamen der anderen Art wird schon beim Start abgelehnt: ' + err[0]);
  ok(Fracht.draussen(g).length === 1, 'die Fracht bleibt draußen liegen');
});

section('4 Plätze je Modul, der 5. wird abgelehnt', () => {
  const T = arena(); const g = T.g;
  for (let i = 1; i <= 4; i++) ok(Fracht.anBordLegen(g, 'deuterium'), `Deuterium ${i} von 4`);
  const pf = Fracht.platzFuer(g, 'deuterium');
  ok(!pf.ok && pf.grund === 'voll' && /Frachtraum voll \(4\/4\)/.test(pf.text), 'der 5. wird abgelehnt: ' + pf.text);
  ok(!Fracht.anBordLegen(g, 'deuterium') && Fracht.anBord(g) === 4 && Fracht.frei(g) === 0, 'anBordLegen lehnt ab, 4/4');
  ok(Maps.CARGO_PER_RAUM === 4 && Maps.cargoCapacity([1]) === 4 && Maps.cargoCapacity([1, 2, 3, 4]) === 16, 'Maps.CARGO_PER_RAUM = 4, Kapazität 4 je Frachtraum');
});

section('Zwei Module nehmen zwei Arten', () => {
  const T = arena(); const g = T.g; module(g, [1, 3]);
  ok(Fracht.capacity(g) === 8, 'zwei Frachträume: 8 Plätze');
  ok(Fracht.anBordLegen(g, 'sprengstoff') && Fracht.anBordLegen(g, 'fracht'), 'Sprengstoff und Fracht an Bord');
  ok(arten(g) === 'sprengstoff:1,fracht:1', 'Raum 1 Sprengstoff, Raum 3 Fracht');
  const pf = Fracht.platzFuer(g, 'deuterium');
  ok(!pf.ok && pf.grund === 'art_belegt', 'eine dritte Art hat kein Modul');
  for (let i = 0; i < 3; i++) Fracht.anBordLegen(g, 'sprengstoff');
  ok(Fracht.anBord(g, 'sprengstoff') === 4 && arten(g) === 'sprengstoff:4,fracht:1', 'Sprengstoff füllt sein Modul (4/4)');
  const p5 = Fracht.platzFuer(g, 'sprengstoff');
  ok(!p5.ok && p5.grund === 'art_belegt' && Fracht.freiFuer(g, 'sprengstoff') === 0 && Fracht.kapazitaetFuer(g, 'sprengstoff') === 4, 'ein 5. Sprengstoff bräuchte ein drittes Modul (Gruppenrechnung ceil(5/4) + 1 Fracht-Modul): abgelehnt, Kapazität für Sprengstoff 4');
  // Gruppenrechnung: 5 Sprengstoff brauchen zwei Module, dann ist für Fracht keines mehr frei
  leeren(g);
  for (let i = 0; i < 5; i++) Fracht.anBordLegen(g, 'sprengstoff');
  ok(arten(g) === 'sprengstoff:4,sprengstoff:1', 'fünf Sprengstoff: zwei Module');
  ok(!Fracht.anBordLegen(g, 'fracht') && Fracht.platzFuer(g, 'fracht').grund === 'art_belegt', 'für die Fracht ist kein Modul mehr frei');
  ok(Fracht.platzFuer(g, 'sprengstoff').ok && Fracht.freiFuer(g, 'sprengstoff') === 3, 'Sprengstoff passt noch (3 Plätze)');
});

section('Personen und Waren nur in getrennten Modulen', () => {
  const T = arena(); const g = T.g;
  ok(PB.personAnBordLegen(g, 'evert', 'Evert'), 'Person an Bord (einziges Modul)');
  ok(!Fracht.anBordLegen(g, 'sprengstoff') && Fracht.platzFuer(g, 'sprengstoff').grund === 'art_belegt', 'das Personen-Modul nimmt keine Ware');
  ok(Fracht.platzFuer(g, 'sprengstoff').text.includes('Personen 1/4'), 'der Hinweis nennt das belegte Modul (Personen 1/4)');
  const T2 = arena(); const h = T2.g;
  Fracht.anBordLegen(h, 'sprengstoff');
  ok(!PB.personAnBordLegen(h, 'evert', 'Evert') && PB.bettFrei(h) === -1 && !PB.personAnBord(h, 'evert'), 'das Waren-Modul nimmt keine Person, kein Bett frei');
  ok(/Kein Bett frei/.test(PB.aufnehmenGrund(h, null) || ''), 'Aufnehmen-Grund nennt den Typkonflikt: ' + PB.aufnehmenGrund(h, null));
  module(h, [1, 3]);
  ok(PB.personAnBordLegen(h, 'evert', 'Evert') && Fracht.anBord(h, 'sprengstoff') === 1, 'mit zwei Modulen liegen beide an Bord');
  ok(arten(h) === 'person:1,sprengstoff:1', 'Personen-Gruppe zuerst (Raum 1), Ware im zweiten Modul (Raum 3)');
});

section('Ohne passendes oder freies Modul: klarer Hinweis', () => {
  const T = arena(); const g = T.g;
  module(g, []);
  const k = Fracht.platzFuer(g, 'fracht');
  ok(!k.ok && k.grund === 'kein_frachtraum' && /Kein Frachtraum eingebaut/.test(k.text), 'ohne Frachtraum: ' + k.text);
  module(g, [1]);
  Fracht.anBordLegen(g, 'sprengstoff');
  const a = Fracht.platzFuer(g, 'fracht');
  ok(!a.ok && /Kein Frachtraum frei für Fracht/.test(a.text) && /nur eine Art/.test(a.text) && /Sprengstoff 1\/4/.test(a.text) && /leeren/.test(a.text), 'Typkonflikt: ' + a.text);
  const u = Fracht.platzFuer(g, 'kaviar');
  ok(!u.ok && u.grund === 'unbekannt', 'unbekannte Art: ' + u.text);
  // Beamen: der Spieler bekommt den Text
  T.taktik(); Fracht.fracht_abwerfen(g, g.ship.x + 100, g.ship.y, 'fracht');
  const err = T.cmd('weapons.fracht');
  ok(err.length === 1 && err[0] === a.text, 'Beamen meldet denselben Text an die Ops');
  // Schöpfen: der Text kommt auch dort an
  const g2 = arena().g; Fracht.anBordLegen(g2, 'sprengstoff');
  ok(Ladung.schoepfen(g2, 'deuterium', 5, 1) === 0 && g2.fracht.fuell === 1, 'Schöpfen einer fremden Art lädt nichts');
});

section('Alle Einlagerungswege laufen durch lagerAufnehmen', () => {
  // statisch: kein Produktionscode schreibt am Lager vorbei (Einlagern nur in fracht.js lagerAufnehmen)
  const roots = ['server', 'shared', 'public/js'];
  const treffer = [];
  const scan = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) scan(p); else if (/\.js$/.test(f.name)) { const src = fs.readFileSync(p, 'utf8'); src.split(/\r?\n/).forEach((l, i) => { if (/\b(?:s|st|state\([^)]*\)|fracht)\.lager\.(?:push|unshift|splice\([^)]*,\s*\d+\s*,)|\blager\.push\(/.test(l) && !/gen-(gelaende|hoehle)/.test(p)) treffer.push(p + ':' + (i + 1)); }); } } };
  for (const r of roots) scan(path.join(__dirname, '..', r));
  const nurLagerAufnehmen = treffer.filter((t) => !/server[\\/]sim[\\/]fracht\.js:/.test(t));
  ok(nurLagerAufnehmen.length === 0, 'kein lager.push außerhalb von fracht.js' + (nurLagerAufnehmen.length ? ' (' + nurLagerAufnehmen.join(', ') + ')' : ''));
  ok(treffer.length === 1, 'in fracht.js genau eine Stelle (lagerAufnehmen): ' + treffer.join(', '));
  ok(Fracht.lagerAufnehmen(arena().g, { art: 'fracht', quelle: 'unsinn' }).grund === 'quelle', 'eine unbekannte Quelle wird abgelehnt');

  const T = arena(); const g = T.g; const z = () => g.fracht.zugang;
  // Beamen (beamFertig)
  T.taktik(); Fracht.fracht_abwerfen(g, g.ship.x + 100, g.ship.y, 'sprengstoff'); T.cmd('weapons.fracht'); T.run(3.2);
  ok(z().beamen === 1 && Fracht.anBord(g) === 1, 'Beamen -> quelle beamen');
  // anBordLegen (Debug, Tests, Skript)
  Fracht.anBordLegen(g, 'sprengstoff'); Fracht.debug(g, ['an', 'sprengstoff']);
  ok(z().skript === 2 && Fracht.anBord(g) === 3, 'anBordLegen und Debug -> quelle skript');
  // fracht_zuteilen (Regiebuch)
  const m = { game: g, def: null, tpl: (t) => t };
  Registry.get('fracht_zuteilen').run(m, { art: 'sprengstoff', n: 1 });
  ok(z().zuteilung === 1 && Fracht.anBord(g) === 4, 'fracht_zuteilen -> quelle zuteilung');
  // Schöpfen
  const gs = arena().g; Ladung.schoepfen(gs, 'deuterium', 3, 1);
  ok(gs.fracht.zugang.schoepfen >= 1 && Fracht.anBord(gs, 'deuterium') >= 1, 'Schöpfen -> quelle schoepfen');
  // Konvoi-Beute: die Pods laufen beim Beamen durch denselben Weg (quelle beamen)
  const K = konvoiRaum(); const kg = K.g;
  Konvoi.an(kg, { n: 1, sieg: 'pluendern', eskorte: 'keine', ladung: 'fracht' });
  const e = Konvoi.transporter(kg)[0];
  ok(!!e, 'Konvoi-Transporter da');
  Testhilfe.toeten(kg, e, { von: [e.x - 30, e.y] }); K.run(0.2);
  const pod = Fracht.draussen(kg)[0];
  ok(!!pod && pod.art === 'fracht', 'Beute-Pod der Art fracht liegt im Raum');
  kg.ship.x = pod.x - 100; kg.ship.y = pod.y; kg.ship.vx = 0; kg.ship.vy = 0; K.taktik(); K.cmd('weapons.fracht'); K.run(3.2);
  ok(kg.fracht.zugang.beamen === 1 && Fracht.anBord(kg, 'fracht') === 1, 'Konvoi-Beute -> quelle beamen (Pod, dann Beamen)');
  // Person (Beamen vom Landepunkt) und Skript
  const P = arena(); const pg = P.g;
  ok(PB.personAnBordLegen(pg, 'evert', 'Evert') && pg.fracht.zugang.skript === 1 && pg.fracht.lager[0].bett === 0, 'Person per Skript -> quelle skript, Bett 0');
  const B = arena(); const bg = B.g; B.taktik();
  bg.away = bg.aways.platform; Away.spawnPerson(bg, 'platform', { x: 8, y: 8 }, { person: 'kora', name: 'Kora' });
  const spot0 = Away.beamSpot; bg.transferZiel = { lp: 'platform', scene: bg.ship.scene };
  Away.beamSpot = () => ({ x: bg.ship.x + 50, y: bg.ship.y, range: 300, map: 'platform' });
  try {
    require('../server/sim/lpscan.js').markieren(bg, 'platform');
    const err = B.cmd('weapons.person'); B.run(3.2);
    ok(!err.length && PB.personAnBord(bg, 'kora') && bg.fracht.zugang.person === 1, 'Person vom Landepunkt -> quelle person');
  } finally { Away.beamSpot = spot0; }
  // Laden
  const R = arena().g; Fracht.restore(R, ['sprengstoff', 'sprengstoff']);
  ok(R.fracht.zugang.laden === 2, 'Laden (restore) -> quelle laden');
});

section('Skript-Zuteilung ohne Softlock (Eisenwald-Ersatz)', () => {
  // k3/k4: fehlt der Sprengstoff, legt der Quartiermeister per fracht_zuteilen Ersatz in den Frachtraum. Liegt fremde Ware im einzigen Modul, räumt er sie aus.
  const T = arena(); const g = T.g;
  for (let i = 0; i < 3; i++) Fracht.anBordLegen(g, 'deuterium');
  const m = { game: g, def: null, tpl: (t) => t };
  Registry.get('fracht_zuteilen').run(m, { art: 'sprengstoff', n: 1 });
  ok(Fracht.anBord(g, 'sprengstoff') === 1 && Fracht.anBord(g, 'deuterium') === 0, 'fremde Ware (Deuterium) ausgeladen, Sprengstoff liegt an Bord');
  ok(T.mev.some((e) => e.kind === 'frachtAnBord' && e.art === 'sprengstoff'), 'Ereignis frachtAnBord kommt (Regiebuch kann weiterlaufen)');
  // Personen werden nie ausgeräumt
  const P = arena(); PB.personAnBordLegen(P.g, 'evert', 'Evert');
  Registry.get('fracht_zuteilen').run({ game: P.g, def: null, tpl: (t) => t }, { art: 'sprengstoff', n: 1 });
  ok(PB.personAnBord(P.g, 'evert') && Fracht.anBord(P.g, 'sprengstoff') === 0, 'Personen bleiben an Bord (kein Ausräumen), die Zuteilung scheitert ohne Absturz');
  // zweites Modul frei: nichts wird ausgeräumt
  const U = arena().g; module(U, [1, 3]); Fracht.anBordLegen(U, 'deuterium');
  Registry.get('fracht_zuteilen').run({ game: U, def: null, tpl: (t) => t }, { art: 'sprengstoff', n: 2 });
  ok(Fracht.anBord(U, 'deuterium') === 1 && Fracht.anBord(U, 'sprengstoff') === 2, 'mit freiem Modul bleibt die Fremdware liegen');
});

section('Eisenwald-Gegentest: Sprengstoff, Konvoi, Kette k2 bis k4', () => {
  // Die Kette kennt nur Sprengstoff im einzigen Modul (Erkundung LAD-01, 4): Einstieg, Konvoi-Beute und Ersatz laufen ohne Typkonflikt
  const eis = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'kampagne', 'eisenwald.json'), 'utf8'));
  const fremd = JSON.stringify(eis).match(/"fracht"\s*:\s*\[[^\]]*\]/g) || [];
  ok(fremd.length > 0 && fremd.every((f) => !/"(fracht|deuterium|waffen|erz|bergungsgut|hilfsgueter)"/.test(f.replace(/^"fracht"s*:/, ''))), 'Kampagne Eisenwald: Einstiege laden nur Sprengstoff ' + JSON.stringify(fremd));
  const T = arena(); const g = T.g;
  ok(Fracht.anBordLegen(g, 'sprengstoff', 'kampagne') && g.fracht.zugang.kampagne === 1, 'Kampagnen-Einstieg: Sprengstoff über quelle kampagne');
  // k2: Konvoi-Ladung Sprengstoff x2: beute_min 2 (Platz für 2 in einem Modul), beide per Beamen an Bord
  const K = konvoiRaum(); const kg = K.g;
  Konvoi.an(kg, { n: 2, sieg: 'pluendern', eskorte: 'keine', ladung: 'sprengstoff' });
  ok(kg.space.konvoi.beuteMin === 2 && kg.space.konvoi.art === 'sprengstoff', 'k2: Konvoi mit Sprengstoff, beute_min 2 bei 4 Plätzen');
  // k2 Abgabe von 2 und Behalt von 1 (fracht_zuteilen), k3/k4 Ersatz: ein Modul trägt alles
  for (let i = 0; i < 2; i++) Fracht.anBordLegen(kg, 'sprengstoff');
  Fracht.skriptAbliefern(kg, 'sprengstoff', 2);
  Registry.get('fracht_zuteilen').run({ game: kg, def: null, tpl: (t) => t }, { art: 'sprengstoff', n: 1 });
  ok(Fracht.anBord(kg, 'sprengstoff') === 1 && Fracht.abgeliefert(kg, 'sprengstoff') === 2, 'k2: 2 abgeliefert, 1 behalten');
  // die Testketten selbst (laufen auch einzeln in npm test): Eisenwald-Kette und Kette k1 bis k4
  for (const t of ['test-eisenwald.js', 'test-kette.js']) {
    let code = 0; try { execFileSync(process.execPath, [path.join(__dirname, t)], { stdio: 'pipe', timeout: 120000 }); } catch (e) { code = e.status == null ? 1 : e.status; }
    ok(code === 0, `${t} läuft mit der Typ-Regel grün (Exit 0)`);
  }
});

section('Füllstand 25/50/75/100 % über Maps.frachtBelegung', () => {
  for (const [k, pct] of [[1, 25], [2, 50], [3, 75], [4, 100]]) {
    const b = Maps.frachtBelegung([1], Array(k).fill('erz'), 0);
    const m = b.module[0];
    ok(m.art === 'erz' && m.anzahl === k && m.plaetze.filter((p) => p.art).length === k && Math.round(m.anzahl / Maps.CARGO_PER_RAUM * 100) === pct && b.ueber === 0, `${k} Erz: ${pct} % (${k} von 4 Plätzen belegt)`);
  }
  const b5 = Maps.frachtBelegung([1], Array(5).fill('erz'), 0);
  ok(b5.ueber === 1 && b5.module[0].anzahl === 4, 'ein 5. hat keinen Platz (ueber 1)');
  const b2 = Maps.frachtBelegung([3, 1], Array(5).fill('erz'), 0);
  ok(b2.module.map((m) => m.raum).join() === '1,3' && b2.module[0].anzahl === 4 && b2.module[1].anzahl === 1 && b2.ueber === 0, 'Gruppe über 4: zwei Module in Raumreihenfolge (4 + 1)');
  const b3 = Maps.frachtBelegung([1, 2, 4], ['fracht', 'erz', 'fracht'], 2);
  ok(b3.module.map((m) => m.art + ':' + m.anzahl).join() === 'person:2,fracht:2,erz:1', 'Personen zuerst, dann Arten in der Reihenfolge des ersten Auftretens');
  const eing = JSON.stringify(Maps.frachtBelegung([1, 2], ['a', 'b', 'a'], 1));
  ok(eing === JSON.stringify(Maps.frachtBelegung([2, 1], ['a', 'b', 'a'], 1)), 'deterministisch, unabhängig von der Reihenfolge der Raumnummern');
  ok(Maps.frachtBelegung([], ['erz'], 0).ueber === 1, 'ohne Frachtraum hat nichts Platz');
  // Server und Client rechnen dieselbe Funktion: die Snapshot-Belegung gleicht der Server-Belegung
  const T = arena(); const g = T.g; module(g, [1, 3]);
  Fracht.anBordLegen(g, 'erz'); Fracht.anBordLegen(g, 'erz'); PB.personAnBordLegen(g, 'evert', 'Evert');
  const snap = g.snapshot();
  const cl = Maps.frachtBelegungAusSnapshot(snap);
  const sv = Fracht.belegung(g);
  ok(JSON.stringify(cl) === JSON.stringify(sv) && sv.module[0].art === 'person' && sv.module[1].art === 'erz' && sv.module[1].anzahl === 2, 'Snapshot-Belegung (Client) = Server-Belegung: Raum 1 Personen, Raum 3 Erz 2/4');
  const info = Maps.frachtPlatzAn(cl, sv.module[1].plaetze[0].x, sv.module[1].plaetze[0].y);
  ok(info && info.art === 'erz' && info.modulArt === 'erz', 'Platz an der Kachel: Erz');
  const leerPlatz = Maps.frachtPlatzAn(cl, sv.module[1].plaetze[3].x, sv.module[1].plaetze[3].y);
  ok(leerPlatz && leerPlatz.art === null && leerPlatz.modulArt === 'erz', 'leerer Platz im Erz-Modul: art null, Modultyp erz');
  const bett = Maps.frachtPlatzAn(cl, sv.module[0].plaetze[3].x, sv.module[0].plaetze[3].y);
  ok(bett && bett.art === null && bett.modulArt === 'person', 'leerer Platz im Personen-Modul: Modultyp person (Bett)');
});

section('4 Personen belegen 4 Betten', () => {
  const T = arena(); const g = T.g;
  for (let i = 0; i < 4; i++) ok(PB.personAnBordLegen(g, 'p' + i, 'Person ' + i), `Person ${i} an Bord`);
  ok(Fracht.frei(g) === 0 && !PB.personAnBordLegen(g, 'p4', 'Person 4') && PB.bettFrei(g) === -1, 'vier Personen füllen das Modul, die fünfte hat kein Bett');
  const snap = g.snapshot();
  ok(snap.fracht.pers.length === 4 && snap.fracht.pers.map((p) => p.b).join() === '0,1,2,3', 'Snapshot: Betten 0, 1, 2, 3');
  const figs = snap.ship.npcs.filter((q) => q.lie === 1);
  const kacheln = new Set(figs.map((f) => Math.floor(f.x / 32) + ',' + Math.floor(f.y / 32)));
  const plaetze = Maps.frachtPlaetze([1]);
  ok(figs.length === 4 && kacheln.size === 4 && plaetze.every((p) => kacheln.has(p.x + ',' + p.y)), 'vier liegende Figuren auf vier verschiedenen Platzkacheln');
  const bel = Maps.frachtBelegungAusSnapshot(snap);
  ok(bel.module[0].art === 'person' && bel.module[0].anzahl === 4 && bel.module[0].plaetze.every((p) => p.art === 'person'), 'Belegung: Raum 1 Personen 4/4 (4 Betten)');
  PB.personAbgeben(g, 'p0');
  ok(PB.bettFrei(g) === 3 && g.snapshot().fracht.pers.map((p) => p.b).join() === '0,1,2', 'eine Person geht: ein Bett frei, die übrigen rücken nach');
  // Weltstand: Betten werden mit der Belegung gespeichert
  const sv = Fracht.toSave(g);
  ok(sv.length === 3 && sv.every((e) => e.p && Number.isInteger(e.b)) && sv.map((e) => e.b).join() === '0,1,2', 'toSave schreibt die abgeleiteten Betten');
});

section('Ausbau: Ladung nach Typ-Regel', () => {
  const T = arena(); const g = T.g; module(g, [1, 3]);
  Fracht.anBordLegen(g, 'sprengstoff'); Fracht.anBordLegen(g, 'fracht');
  ok(!Fracht.passtOhneRaum(g, 1) && !Fracht.passtOhneRaum(g, 3), 'zwei Arten brauchen zwei Module: keines lässt sich ausbauen');
  Fracht.skriptAbliefern(g, 'fracht', null);
  ok(Fracht.passtOhneRaum(g, 3) && Fracht.passtOhneRaum(g, 1), 'eine Art: ein Modul genügt');
  PB.personAnBordLegen(g, 'evert', 'Evert'); module(g, [1, 3]);
  ok(Fracht.personImRaum(g, 1) && !Fracht.personImRaum(g, 3), 'die Person liegt im ersten Frachtraum (Raum 1)');
});

console.log(`\ntest-typregel: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
