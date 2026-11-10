'use strict';
// LAD-01 D: Handel als Daten (content/handel.json, server/sim/ladung.js preisFuer/handelsOrt): Verkauf an jedem Hafen, an dem die Lerche andocken kann.
//   Daten · Preis je Ware und Volk · Verkauf je Ware (alle Arten, Erz, Personen abgelehnt) · Hafen ohne scene.kauft · Andocken/Reichweite · kein Hafen/kein Andocken · Marken-Buchung
//   · Ausschluss per Daten · Testware zur Laufzeit ohne Codeänderung · scene.kauft als Override · Snapshot vk
//   node tools/test-handel.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
require('../shared/maps.js'); require('../shared/physics.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Waren = require('../shared/waren.js');
const { Game } = require('../server/game.js');
const Fracht = require('../server/sim/fracht.js');
const Ladung = require('../server/sim/ladung.js');
const Space = require('../server/sim/space.js');
const HANDEL = require('../content/handel.json');
const FREI = require('../content/welt/sund_frei.json');
const SUND = require('../content/welt/sund.json');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) { console.log('\n' + name); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-handel-'));
let seq = 0;

function neuesSpiel() {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'P0', name: 'P0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 30; i++) g.step();
  g.space.enemies = []; g.god = true; g.players[0].console = 'weapons';
  return { g, c };
}
const run = (g, sek) => { for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) g.step(); };
function hinein(g, hex, docked) {
  const ort = Sektoren.ortVonHex(hex);
  Space.enterScene(g, ort, {});
  Object.assign(g.ship, { vx: 0, vy: 0, speed: 0 });
  if (docked) Object.assign(g.ship, { docked: true, dockedAt: ort });
  else Object.assign(g.ship, { docked: false, dockedAt: null });
  return ort;
}
const lade = (g, ...arten) => { g.fracht.lager = arten.map((a) => (a === 'person' ? { art: 'person', person: 'p1', name: 'Pia', bett: 0 } : { art: a })); g.fracht.halt = null; };
const erwartet = (art, volk, hex) => {   // unabhängig aus den Daten
  const v = HANDEL.voelker[volk] || HANDEL.standard, h = (HANDEL.haefen && HANDEL.haefen['sund_frei:' + hex]) || {};
  if ((v.nicht || []).includes(art) || (h.nicht || []).includes(art)) return 0;
  const grund = CONFIG.fracht.preise[art] != null ? CONFIG.fracht.preise[art] : Waren.grundpreis(art);
  const f = (v.faktor != null ? v.faktor : 1) * ((v.waren || {})[art] != null ? v.waren[art] : 1) * (h.faktor != null ? h.faktor : 1) * ((h.waren || {})[art] != null ? h.waren[art] : 1);
  return Math.max(1, Math.round(grund * f));
};
const ARTEN = Waren.arten();

section('Daten (content/handel.json)', () => {
  const frakt = Object.keys(FREI.fraktionen), frakt2 = Object.keys(SUND.fraktionen);
  ok(Object.keys(HANDEL.voelker).every((k) => frakt.includes(k) && frakt2.includes(k)), 'jedes Volk in handel.json ist eine Fraktion der Karten sund und sund_frei');
  ok(['rom', 'ger', 'frei', 'saum'].every((k) => HANDEL.voelker[k]), 'Rom, Germanen, Freie, Konkordat haben einen Eintrag');
  ok(Object.keys(HANDEL.haefen).every((k) => /^sund_frei:\d{4}$/.test(k) && FREI.hexe[k.slice(10)] && FREI.hexe[k.slice(10)].hafen), "jeder Hafen-Override ist '<karte>:<hex>' und ein Hafen der Karte");
  const warenIds = Waren.liste().map((w) => w.id);
  const alleWaren = [].concat(...Object.values(HANDEL.voelker), ...Object.values(HANDEL.haefen)).flatMap((e) => Object.keys(e.waren || {}).concat(e.nicht || [], Object.keys(e.preise || {})));
  ok(alleWaren.every((w) => warenIds.includes(w)), 'jede Ware in handel.json gibt es in waren.json');
  ok(Object.values(FREI.hexe).filter((h) => h.hafen).length === 21, '21 Häfen auf der Karte (Fraktionen aus den Daten)');
  ok(ARTEN.length === 7 && Waren.get('person').kategorie === 'person', '7 Warenarten plus Person in den Daten');
  ok(ARTEN.every((a) => (CONFIG.fracht.preise[a] || Waren.grundpreis(a)) > 0), 'jede Ware hat einen Grundpreis > 0 (Erz ' + Waren.grundpreis('erz') + ')');
});

section('Preis je Ware und Volk aus den Daten', () => {
  const { g } = neuesSpiel();
  ok(Sektoren.kartenId() === 'sund_frei', 'Karte sund_frei');
  const haefen = { rom: '0305', frei: '0603', saum: '0604', ger: '0905' };
  for (const [volk, hex] of Object.entries(haefen)) {
    hinein(g, hex, false);
    const h = Ladung.hafenVon(g);
    ok(h.fraktion === volk && h.hex === hex, `Hafen ${hex}: Fraktion ${h.fraktion} (aus der Karte)`);
    const kauft = Locations.get(h.ort).scene.kauft;
    const soll = {}, ist = {};
    for (const a of ARTEN) { soll[a] = kauft && kauft[a] === true ? CONFIG.fracht.preise[a] : erwartet(a, volk, hex); ist[a] = Ladung.preisFuer(g, h, a); }
    ok(JSON.stringify(soll) === JSON.stringify(ist), `Preise ${volk}/${hex}: ` + JSON.stringify(ist));
  }
  const R = (hex, art) => Ladung.preisFuer(g, { hex, fraktion: FREI.hexe[hex].fraktion }, art);
  ok(R('0305', 'erz') < R('0305', 'fracht') && R('0305', 'erz') <= 10, 'Erz ist günstig (' + R('0305', 'erz') + ' Marken)');
  ok(R('0305', 'waffen') > R('0305', 'fracht') && R('0305', 'hilfsgueter') > R('0305', 'fracht'), 'Waffen und Hilfsgüter höher als Handelsware');
  ok(R('0305', 'waffen') !== R('1004', 'waffen') && R('0305', 'erz') !== R('1004', 'erz'), 'Rom und Germanen zahlen verschieden');
  ok(R('0605', 'waffen') > Math.round(Waren.grundpreis('waffen') * HANDEL.voelker.frei.faktor), 'Hafen-Override Pulverhorn wirkt auf Waffen');
  ok(Ladung.preisFuer(g, { hex: '0305', fraktion: 'rom' }, 'person') === 0, 'Person hat keinen Preis');
  ok(Ladung.preisFuer(g, { hex: '0305', fraktion: 'rom' }, 'gibtsnicht') === 0, 'unbekannte Art hat keinen Preis');
  ok(Ladung.preisFuer(g, { hex: null, fraktion: null }, 'erz') === Waren.grundpreis('erz'), 'Hafen ohne Volk: Grundpreis');
});

// LAD-01 Nacharbeit 1 (Testluecke): Volk-faktor UND Hafen-faktor ungleich 1, mit festen Zahlen (nicht mit der Formel nachgerechnet) – eine Mutation 'hd.faktor ignorieren' faellt auf
section('Preisformel mit Volk- und Hafenfaktor ungleich 1, Hafen je Karte', () => {
  const { g } = neuesSpiel();
  const e = HANDEL.haefen['sund_frei:0603'];
  const vorher = e.faktor; e.faktor = 1.5;   // Freie: Volk-faktor 0.9, Fracht ohne Warenfaktor des Volkes; Hafen-faktor 1.5
  try {
    const P = (art) => Ladung.preisFuer(g, { hex: '0603', karte: 'sund_frei', fraktion: 'frei' }, art);
    ok(P('fracht') === 34, 'Fracht 25 x 0.9 x 1.5 = 33.75 -> 34 (' + P('fracht') + ')');
    ok(P('hilfsgueter') === 65, 'Hilfsgüter 35 x 0.9 x 1.25 x 1.5 x 1.1 = 64.97 -> 65 (' + P('hilfsgueter') + ')');
    e.faktor = 1;
    ok(P('fracht') === 23, 'Hafen-faktor 1: Fracht 25 x 0.9 = 22.5 -> 23 (' + P('fracht') + ')');
  } finally { e.faktor = vorher; }
  // N13: dieselbe Hex-Kennung 0704 ist im Sund Raffinerie Lumen (Deuterium-Abschlag 0.9), im Limes Eisenwald (kein Override)
  const D = (karte) => Ladung.preisFuer(g, { hex: '0704', karte, fraktion: 'neutral' }, 'deuterium');
  ok(D('sund_frei') === 36 && D('limes') === 40, 'Hafen-Override gilt nur auf seiner Karte (sund_frei ' + D('sund_frei') + ', limes ' + D('limes') + ')');
});

section('Verkauf je Ware an einem Hafen ohne scene.kauft', () => {
  const { g } = neuesSpiel();
  const ort = hinein(g, '0305', true);
  ok(!Locations.get(ort).scene.kauft, 'Ostia Nova hat kein scene.kauft');
  for (const art of ARTEN) {
    lade(g, art); g.inventory.marks = 100; const m0 = g.inventory.marks;
    const vor = Ladung.verkauft(g, art);
    const e = Ladung.verkaufStart(g, null);
    ok(e === null && g.fracht.halt && g.fracht.halt.kind === 'verk', `${art}: Verkauf startet (${e})`);
    run(g, 3.5);
    const preis = erwartet(art, 'rom', '0305');
    ok(g.fracht.lager.length === 0 && g.inventory.marks === m0 + preis && preis > 0, `${art}: Ware weg, +${preis} Marken (${m0} -> ${g.inventory.marks})`);
    ok(Ladung.verkauft(g, art) === vor + 1, `${art}: zählt als verkauft`);
  }
  lade(g, 'erz', 'erz'); const m1 = g.inventory.marks; Ladung.verkaufStart(g, null); run(g, 3.5);
  ok(g.inventory.marks === m1 + 2 * erwartet('erz', 'rom', '0305'), 'Erz: zwei Einheiten, Summe stimmt');
  lade(g, 'person'); const m2 = g.inventory.marks;
  const ep = Ladung.verkaufStart(g, null);
  ok(typeof ep === 'string' && /Personen/.test(ep) && !g.fracht.halt && g.fracht.lager.length === 1 && g.inventory.marks === m2, 'Person: klare Ablehnung (' + ep + '), nichts verkauft');
  lade(g, 'person', 'fracht');   // gemischt (nur im Test, die Typ-Regel erlaubt das nicht): nur die Ware geht
  const m3 = g.inventory.marks; Ladung.verkaufStart(g, null); run(g, 3.5);
  ok(g.fracht.lager.length === 1 && g.fracht.lager[0].art === 'person' && g.inventory.marks === m3 + erwartet('fracht', 'rom', '0305'), 'Person bleibt an Bord, die Ware wird verkauft');
});

section('Verkauf per Befehl (Ops), Ereignisse', () => {
  const { g, c } = neuesSpiel(); hinein(g, '0305', true);
  const ev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { ev.push(k); return me0(k, d); };
  lade(g, 'waffen'); g.players[0].console = 'weapons'; const m0 = g.inventory.marks;
  c.inbox.length = 0; g.handleMessage(c, { t: 'cmd', c: 'weapons.verkaufen' }); run(g, 3.5);
  ok(g.fracht.lager.length === 0 && g.inventory.marks === m0 + erwartet('waffen', 'rom', '0305'), 'Befehl weapons.verkaufen bucht Marken');
  ok(ev.includes('frachtVerkauft') && ev.includes('marksCredited'), 'Ereignisse frachtVerkauft und marksCredited');
});

section('Andocken und Reichweite', () => {
  const { g } = neuesSpiel(); const ort = hinein(g, '0305', false);
  const sc = Locations.get(ort).scene; const ref = sc.station || sc.dock;
  lade(g, 'erz');
  g.ship.x = ref.x + 60; g.ship.y = ref.y;
  ok(Ladung.verkaufOrt(g).ok, 'nicht angedockt, in Stationsreichweite: Handel möglich');
  g.ship.x = ref.x + CONFIG.fracht.stationRange + 400;
  const far = Ladung.verkaufStart(g, null);
  ok(/Zu weit/.test(far || '') && !g.fracht.halt, 'außerhalb der Reichweite: abgelehnt (' + far + ')');
  g.ship.docked = true; g.ship.dockedAt = ort;
  ok(Ladung.verkaufOrt(g).ok, 'angedockt: Handel möglich');
  g.ship.docked = false; g.ship.dockedAt = null; g.ship.x = ref.x + 60;
  Ladung.verkaufStart(g, null); run(g, 0.5); g.ship.x = ref.x + CONFIG.fracht.stationRange + 400; run(g, 0.5);
  ok(!g.fracht.halt && g.fracht.lager.length === 1, 'Reichweite während des Verkaufs verlassen: Abbruch, Ware bleibt');
});

section('Kein Hafen, kein Andocken, kein Handel', () => {
  const { g } = neuesSpiel();
  hinein(g, '0503', false); lade(g, 'erz');
  ok(!Ladung.verkaufOrt(g).ok && /kauft niemand/.test(Ladung.verkaufStart(g, null)), 'Gasfeld (kein Hafen): kein Handel');
  const ger = hinein(g, '0905', false); lade(g, 'erz');
  const sc = Locations.get(ger).scene; g.ship.x = (sc.station || sc.dock).x + 50; g.ship.y = (sc.station || sc.dock).y;
  const t = Ladung.verkaufStart(g, null);
  ok(typeof t === 'string' && !g.fracht.halt, 'germanischer Hafen (Andocken verweigert): kein Handel (' + t + ')');
  hinein(g, '0305', true); lade(g, 'erz');
  const ohneDock = Locations.get(g.ship.scene).scene; const dockAlt = ohneDock.dock;
  try { delete ohneDock.dock; ok(!Ladung.verkaufOrt(g).ok, 'Szene ohne Liegeplatz (kein Andocken möglich): kein Handel'); } finally { ohneDock.dock = dockAlt; }
  ok(Ladung.verkaufOrt(g).ok, 'mit Liegeplatz wieder Handel');
});

section('Ausschluss per Daten und Overrides', () => {
  const { g } = neuesSpiel(); hinein(g, '0305', true);
  HANDEL.voelker.rom.nicht.push('waffen');
  try {
    ok(Ladung.preisFuer(g, Ladung.hafenVon(g), 'waffen') === 0, 'Ware per Daten für das Volk ausgeschlossen: Preis 0');
    lade(g, 'waffen'); ok(!Ladung.verkaufOrt(g).ok && /nicht/.test(Ladung.verkaufStart(g, null)), 'Verkauf der ausgeschlossenen Ware abgelehnt');
  } finally { HANDEL.voelker.rom.nicht.pop(); }
  ok(Ladung.preisFuer(g, Ladung.hafenVon(g), 'waffen') > 0, 'nach Rücknahme wieder ein Preis');
  const sc = Locations.get(g.ship.scene).scene;
  sc.kauft = { erz: 77, fracht: false };
  try {
    ok(Ladung.preisFuer(g, Ladung.hafenVon(g), 'erz') === 77, 'scene.kauft als Override: fester Preis');
    ok(Ladung.preisFuer(g, Ladung.hafenVon(g), 'fracht') === 0, 'scene.kauft false: kauft nicht');
    ok(Ladung.preisFuer(g, Ladung.hafenVon(g), 'waffen') === erwartet('waffen', 'rom', '0305'), 'andere Waren laufen weiter über handel.json');
  } finally { delete sc.kauft; }
  const mit = hinein(g, '0604', true); const k = Locations.get(mit).scene.kauft;
  ok(k && k.deuterium === true && Ladung.preisFuer(g, Ladung.hafenVon(g), 'deuterium') === CONFIG.fracht.preise.deuterium, 'Concordia (scene.kauft in den Daten): Deuterium wie bisher ' + CONFIG.fracht.preise.deuterium);
});

section('Testware zur Laufzeit, ohne Codeänderung', () => {
  const { g } = neuesSpiel(); hinein(g, '0305', true);
  Waren.registrieren({ id: 'testware_handel', name: 'Testware', grundpreis: 50, gewicht: 0, eigenschaften: [], darstellung: 'kiste', kategorie: 'ware' });
  try {
    const h = Ladung.hafenVon(g);
    ok(Ladung.preisFuer(g, h, 'testware_handel') === 50, 'Testware hat einen Preis (Grundpreis × Volk) ohne Eintrag in handel.json');
    lade(g, 'testware_handel'); const m0 = g.inventory.marks;
    ok(Ladung.verkaufStart(g, null) === null, 'Verkauf startet'); run(g, 3.5);
    ok(g.fracht.lager.length === 0 && g.inventory.marks === m0 + 50, 'Testware verkauft: +50 Marken');
  } finally { Waren.entfernen('testware_handel'); }
  ok(Ladung.preisFuer(g, Ladung.hafenVon(g), 'testware_handel') === 0, 'nach dem Entfernen kein Preis mehr');
});

section('Snapshot', () => {
  const { g } = neuesSpiel(); hinein(g, '0305', true); lade(g, 'erz');
  ok(Fracht.snapshot(g).vk === 1, 'vk = 1 wenn verkaufbar');
  lade(g, 'person'); ok(Fracht.snapshot(g).vk === undefined, 'nur Personen: kein vk');
  lade(g, 'erz'); hinein(g, '0503', false); ok(Fracht.snapshot(g).vk === undefined, 'kein Hafen: kein vk');
});

console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
