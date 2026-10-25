'use strict';
// SUND-03b P: Preisfaktor der Verbrauchsgüter im Hafenterminal (server/sim/preise.js, content/welt/preise-werte.json).
// Direkt gegen die Game-Klasse, ohne Netz. Das Terminal läuft mit der echten consoles.js und terminal-ui.js in Node (Attrappen nur für Zeichnen).
//   Daten · Faktor ohne Treiber · je Treiber · Klemme · Werft fest · Kampagne und ohne Weltsim · Anzeige = Kauf · Rundung · Konkordat-Hafen · Snapshot · Terminal
//   node tools/test-preise.js [begriff …]   (npm run test:preise)
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Maps = require('../shared/maps.js');
const Physics = require('../shared/physics.js');
const Protocol = require('../shared/protocol.js');
const Katalog = require('../shared/schiffskatalog.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const Daten = require('../server/weltsim/daten.js');
const Kern = require('../server/weltsim/kern.js');
const Preise = require('../server/sim/preise.js');
const Shop = require('../server/sim/shop.js');
const Werft = require('../server/sim/werft.js');
const Space = require('../server/sim/space.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}

const PW = require('../content/welt/preise-werte.json');
const W = PW.werte;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-preise-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const HZ = CONFIG.tickHz;
const ROM_HAFEN = '0305';   // Ostia Nova, Hafen von Rom
const KON_HAFEN = '0604';   // Concordia, Hafen des Konkordats
const run = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const z = (g) => g.weltsim.zustand;
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function neu(o) {
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: freshDir(), seed: (o && o.seed) || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') } });
  const c = { inbox: [], send(m) { if (this.inbox.length < 600) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'P0', name: 'P0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: (o && o.start) || 'freie_fahrt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 1);
  g.space.enemies = [];
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  return { g, c };
}
// an einem Hafen angedockt (Ort, Sim-Hex), Marken reichlich
function andocken(g, hex) {
  Space.enterScene(g, Sektoren.ortVonHex(hex), {});
  Object.assign(g.ship, { docked: true, dockedAt: Sektoren.ortVonHex(hex), vx: 0, vy: 0, speed: 0 });
  g.inventory.marks = 5000; g.players[0].console = 'shop';
}
const eintrag = (g, id) => g.C.shop.find((s) => s.id === id);
const grundPreis = (g, id) => eintrag(g, id).price;
const VERBRAUCH = Object.keys(W.artikel.wert).filter((id) => W.artikel.wert[id].verbrauchsgut === true);
const FEST = CONFIG.shop.map((e) => e.id).filter((id) => !VERBRAUCH.includes(id));
const embargo = (zz, gegen, waren, bis) => { zz.embargo = Object.assign(zz.embargo || {}, { [gegen]: { waren, von: 'kon', from: zz.tick, bis: bis == null ? zz.tick + 10 : bis } }); };
const belagerung = (zz, ziel, o) => { zz.angriffe.push(Object.assign({ id: zz.naechsteAngriffId++, t0: zz.tick, ziel, von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: zz.tick, t_ende: null, ausgang: null, phase: 'direkt' }, o || {})); };
const F = (zz, id, hex) => Preise.faktorAus(zz, id, hex || ROM_HAFEN).faktor;

section('Daten', () => {
  ok(PW.format === 'preise-werte/1', 'Format');
  const ids = CONFIG.shop.map((e) => e.id);
  ok(Object.keys(W.artikel.wert).every((id) => ids.includes(id)), 'jeder Artikel der Daten steht im Sortiment (CONFIG.shop)');
  ok(VERBRAUCH.length >= 4 && VERBRAUCH.every((id) => eintrag({ C: CONFIG }, id).kind === 'item'), 'Verbrauchsgüter: ' + VERBRAUCH.join(', ') + ' (alles Vorrat)');
  ok(['sonde', 'ladung'].every((id) => !VERBRAUCH.includes(id)), 'Sonde und Sprengstoff fest');
  ok(CONFIG.shop.filter((e) => e.kind !== 'item').every((e) => !VERBRAUCH.includes(e.id)), 'Gear, Deko, Umbau fest');
  ok(W.faktor_grenzen.wert.min === 0.5 && W.faktor_grenzen.wert.max === 1.5, 'Grenzen 0,5 .. 1,5');
  ok(VERBRAUCH.every((id) => ['M', 'T', 'E', 'U', 'N'].includes(W.artikel.wert[id].gut)), 'jedes Verbrauchsgut trägt ein Sim-Gut');
  const T = W.texte.wert;
  ok(['teurer', 'billiger', 'embargo', 'belagerung', 'umkreis', 'vorrat_knapp', 'vorrat_reichlich'].every((k) => typeof T[k] === 'string' && T[k].length > 3) && /\{fraktion\}/.test(T.embargo), 'Texte als Daten');
  ok(['rom', 'ger'].every((f) => typeof W.fraktionen.wert[f] === 'string'), 'Fraktionsnamen als Daten');
  ok(!/spieler|P0|Ui\d/i.test(JSON.stringify(PW)), 'keine Spielernamen');
});

section('Faktor ohne Treiber ist 1,0', () => {
  const { g } = neu(); const zz = z(g);
  ok(VERBRAUCH.every((id) => F(zz, id) === 1), 'frische Sim: alle Verbrauchsgüter 1,0');
  ok(FEST.every((id) => F(zz, id) === 1), 'feste Artikel: 1,0');
  for (const id of VERBRAUCH) ok(Preises(g, id) === grundPreis(g, id), `Preis ${id} = Grundpreis (${grundPreis(g, id)})`);
  ok(Preise.faktorAus(zz, 'medipack', '0505').faktor === 1 && Preise.faktorAus(zz, 'medipack', 'xxxx').faktor === 1, 'kein Hafen / unbekanntes Hex: 1,0');
  ok(Preise.faktorFuer(g, 'medipack', ROM_HAFEN) === 1, 'faktorFuer(game, artikel, hex)');
  ok(Preise.faktorAus(null, 'medipack', ROM_HAFEN).faktor === 1, 'ohne Zustand: 1,0');
  ok(Preise.faktorAus(zz, 'gibtesnicht', ROM_HAFEN).faktor === 1, 'unbekannter Artikel: 1,0');
});
function Preises(g, id) { return Preise.preisFuer(g, eintrag(g, id), 'hafen'); }

section('Treiber Embargo', () => {
  const { g } = neu(); const zz = z(g);
  embargo(zz, 'rom', ['M'], zz.tick + 10);
  ok(F(zz, 'medipack') === 1 + W.embargo.wert.zuschlag, `Embargo auf M: Medipack ${F(zz, 'medipack')}`);
  ok(['ersatzteil', 'flickblech', 'loeschgel', 'bolzen'].every((id) => F(zz, id) === 1), 'andere Güter bleiben bei 1,0');
  ok(Preise.faktorAus(zz, 'medipack', ROM_HAFEN).gruende.join() === 'embargo', 'Grund embargo');
  embargo(zz, 'rom', ['E', 'T'], zz.tick + 10);
  ok(['ersatzteil', 'flickblech', 'loeschgel'].every((id) => F(zz, id) === 1.3) && F(zz, 'medipack') === 1 && F(zz, 'bolzen') === 1, 'Embargo auf E: Ersatzteil, Flickblech, Löschgel; T hat keinen Artikel');
  embargo(zz, 'ger', ['M'], zz.tick + 10); delete zz.embargo.rom;
  ok(F(zz, 'medipack') === 1, 'Embargo gegen die Germanen trifft den römischen Hafen nicht');
  embargo(zz, 'rom', ['M'], zz.tick);   // bis = jetzt: schon abgelaufen
  ok(F(zz, 'medipack') === 1, 'abgelaufenes Embargo wirkt nicht');
  embargo(zz, 'rom', ['M'], zz.tick + 1);
  ok(F(zz, 'medipack') === 1.3, 'Embargo bis tick+1 wirkt noch');
  Kern.tick(zz);
  ok(F(zz, 'medipack') === 1 && !(zz.embargo && zz.embargo.rom), 'nach dem Tick endet es von selbst: Faktor wieder 1,0');
  // über den echten Befehl des Kerns
  const z2 = z(neu({ seed: 9 }).g);
  const r = Kern.tick(z2, { befehle: [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['M'], dauer: 5 }] });
  ok(z2.embargo && z2.embargo.rom && F(z2, 'medipack') === 1.3, 'Befehl embargo des Kerns -> Medipack 1,3');
  void r;
});

section('Treiber Belagerung', () => {
  const { g } = neu(); const zz = z(g); const d = Daten.datenVon(zz);
  const nah = d.codes.filter((c) => c !== ROM_HAFEN && Daten.abstand(d, ROM_HAFEN, c) === 1)[0];
  const fern = d.codes.filter((c) => Daten.abstand(d, ROM_HAFEN, c) === 2 && Daten.abstand(d, ROM_HAFEN, c) > W.belagerung.wert.radius)[0];
  belagerung(zz, ROM_HAFEN);
  ok(VERBRAUCH.every((id) => F(zz, id) === 1 + W.belagerung.wert.hafen), 'Belagerung des Hafens: alle Verbrauchsgüter +' + W.belagerung.wert.hafen);
  ok(Preise.faktorAus(zz, 'medipack', ROM_HAFEN).gruende.join() === 'belagerung', 'Grund belagerung');
  zz.angriffe[0].phase = 'sammeln'; ok(F(zz, 'medipack') === 1, 'Phase sammeln: noch keine Belagerung');
  zz.angriffe[0].phase = 'abgebrochen'; ok(F(zz, 'medipack') === 1, 'abgebrochen: keine');
  zz.angriffe[0].phase = 'direkt'; zz.angriffe[0].t_an = null; ok(F(zz, 'medipack') === 1, 'Flotte noch nicht angekommen: keine');
  zz.angriffe[0].t_an = zz.tick; zz.angriffe[0].t_ende = zz.tick; ok(F(zz, 'medipack') === 1, 'beendet: keine');
  zz.angriffe.length = 0;
  ok(nah && fern, 'Testhexe: nah ' + nah + ', fern ' + fern);
  belagerung(zz, nah);
  ok(VERBRAUCH.every((id) => F(zz, id) === 1 + W.belagerung.wert.umkreis) && Preise.faktorAus(zz, 'medipack', ROM_HAFEN).gruende.join() === 'umkreis', 'Belagerung im Umkreis (1 Sprung): Zuschlag umkreis');
  zz.angriffe.length = 0; belagerung(zz, fern);
  ok(F(zz, 'medipack') === 1, 'Belagerung 2 Sprünge entfernt: nichts');
  zz.angriffe.length = 0; belagerung(zz, nah); belagerung(zz, ROM_HAFEN);
  embargo(zz, 'rom', ['M', 'E'], zz.tick + 10); zz.vorrat.rom.U = 0;
  ok(CONFIG.shop.filter((e) => !VERBRAUCH.includes(e.id)).every((e) => Preise.preisFuer(g, e, 'hafen') === e.price && F(zz, e.id) === 1), 'feste Artikel (Sonde, Sprengstoff, Gear, Deko) bleiben bei jeder Lage beim Grundpreis');
  delete zz.embargo; zz.vorrat.rom.U = 20;
  ok(F(zz, 'medipack') === 1 + W.belagerung.wert.hafen, 'Hafen und Nachbar zugleich: nur der stärkere Fall zählt');
});

section('Treiber Munitionsvorrat U (nur Torpedo)', () => {
  const { g } = neu(); const zz = z(g); const V = W.vorrat.wert;
  zz.vorrat.rom.U = V.knapp.bis;
  ok(F(zz, 'bolzen') === 1 + V.knapp.zuschlag && Preise.faktorAus(zz, 'bolzen', ROM_HAFEN).gruende.join() === 'vorrat_knapp', `U = ${V.knapp.bis}: knapp, ${F(zz, 'bolzen')}`);
  zz.vorrat.rom.U = V.knapp.bis + 0.5; ok(F(zz, 'bolzen') === 1, 'knapp+0,5: kein Zuschlag');
  zz.vorrat.rom.U = V.reichlich.ab; ok(F(zz, 'bolzen') === 1 + V.reichlich.zuschlag && Preise.faktorAus(zz, 'bolzen', ROM_HAFEN).gruende.join() === 'vorrat_reichlich', `U = ${V.reichlich.ab}: reichlich, ${F(zz, 'bolzen')}`);
  zz.vorrat.rom.U = V.reichlich.ab - 0.1; ok(F(zz, 'bolzen') === 1, 'knapp unter reichlich: kein Zuschlag');
  zz.vorrat.rom.U = 0;
  ok(['medipack', 'ersatzteil', 'flickblech', 'loeschgel'].every((id) => F(zz, id) === 1), 'U wirkt nur auf den Torpedo');
  zz.vorrat.rom.U = 20; zz.vorrat.rom.M = 0; zz.vorrat.rom.E = 0; zz.vorrat.rom.T = 0;
  ok(VERBRAUCH.every((id) => F(zz, id) === 1), 'M, E, T des Vorrats sind kein Treiber (Befund: nahezu konstant)');
});

section('Klemme und Rundung', () => {
  const { g } = neu(); const zz = z(g);
  embargo(zz, 'rom', ['E'], zz.tick + 10); belagerung(zz, ROM_HAFEN);
  const f = F(zz, 'ersatzteil');
  ok(f === 1.5 && 1 + W.embargo.wert.zuschlag + W.belagerung.wert.hafen > 1.5, `Summe 1,55 wird auf 1,5 geklemmt: ${f}`);
  ok(Preises(g, 'ersatzteil') === Math.round(grundPreis(g, 'ersatzteil') * 1.5), 'Preis Ersatzteil = 1,5 x ' + grundPreis(g, 'ersatzteil'));
  const alt = W.vorrat.wert.reichlich.zuschlag;
  W.vorrat.wert.reichlich.zuschlag = -3; zz.vorrat.rom.U = 50;
  ok(F(zz, 'bolzen') === 0.5, 'untere Klemme 0,5');
  ok(Preises(g, 'bolzen') === Math.round(grundPreis(g, 'bolzen') * 0.5), 'Preis bei 0,5');
  W.vorrat.wert.reichlich.zuschlag = alt;
  // Rundung auf ganze Marken, mindestens 1
  ok(Number.isInteger(Preises(g, 'ersatzteil')), 'ganze Marken');
  const e = { id: 'bolzen', price: 1, kind: 'item' };
  const gAlt = W.faktor_grenzen.wert.min;
  W.faktor_grenzen.wert.min = 0.1; W.vorrat.wert.reichlich.zuschlag = -0.9;   // bei Grenzen unter 0,5 würde 1 x 0,1 zu 0 Marken
  ok(Preise.preisFuer(g, e, 'hafen') === 1, 'mindestens 1 Marke (1 x 0,1 = 0,1 -> 1)');
  W.faktor_grenzen.wert.min = gAlt; W.vorrat.wert.reichlich.zuschlag = alt;
  const k2 = neu({ seed: 11 }).g; const z3 = z(k2); z3.vorrat.rom.U = 50; andocken(k2, ROM_HAFEN);
  ok(Preise.preisFuer(k2, { id: 'bolzen', price: 10, kind: 'item' }, 'hafen') === 8 && Preise.preisFuer(k2, { id: 'bolzen', price: 13, kind: 'item' }, 'hafen') === 10, 'Rundung kaufmännisch: 10 x 0,8 = 8, 13 x 0,8 = 10,4 -> 10');
  const k3 = neu({ seed: 12 }).g; const z4 = z(k3); andocken(k3, ROM_HAFEN); z4.vorrat.rom.U = 0;
  const nahK = Daten.datenVon(z4).codes.find((c) => c !== ROM_HAFEN && Daten.abstand(Daten.datenVon(z4), ROM_HAFEN, c) === 1);
  belagerung(z4, nahK);
  ok(F(z4, 'bolzen') === 1.4 && Preise.preisFuer(k3, { id: 'bolzen', price: 10, kind: 'item' }, 'hafen') === 14, 'Summe 1 + 0,1 + 0,3 = 1,4 ohne Gleitkomma-Rest (Faktor ' + F(z4, 'bolzen') + ')');
  z4.angriffe.length = 0; belagerung(z4, ROM_HAFEN); z4.vorrat.rom.U = 50;
  ok(F(z4, 'bolzen') === 1.05, 'Summe 1 + 0,25 - 0,2 = 1,05 (Faktor ' + F(z4, 'bolzen') + ')');
  ok(Preise.preisFuer(k2, { id: 'bolzen', price: 17, kind: 'item' }, 'hafen') === 14, '17 x 0,8 = 13,6 -> 14');
});

section('Werft-Preise ändern sich nie', () => {
  const { g } = neu(); andocken(g, ROM_HAFEN); const zz = z(g);
  const bild = () => JSON.stringify({
    sortiment: Werft.sortiment(g).map((s) => [s.art, s.id, Werft.preis(g, s.art, s.id)]),
    stufen: [1, 2, 3, 4, 5, 6].map((i) => Werft.preis(g, 'stufe', i)),
    cfg: CONFIG.werft.preise,
  });
  const vor = bild();
  const mitPreis = Werft.sortiment(g).filter((s) => Werft.preis(g, s.art, s.id) != null);
  ok(mitPreis.length >= 10, 'Werft hat feste Preise für ' + mitPreis.length + ' Teile');
  const zustaende = [];
  zustaende.push(() => embargo(zz, 'rom', ['M', 'T', 'E'], zz.tick + 30));
  zustaende.push(() => belagerung(zz, ROM_HAFEN));
  zustaende.push(() => { zz.vorrat.rom.U = 0; zz.vorrat.rom.E = 0; zz.vorrat.rom.M = 0; });
  zustaende.push(() => { zz.vorrat.rom.U = 50; zz.vorrat.rom.E = 50; zz.vorrat.rom.M = 50; });
  zustaende.push(() => { for (let i = 0; i < 40; i++) Kern.tick(zz); });
  let gleichBlieb = true, schritte = 0, wirkte = false;
  for (const f of zustaende) { f(); schritte++; if (bild() !== vor) gleichBlieb = false; if (schritte === 2 && Preise.faktorAus(zz, 'medipack', ROM_HAFEN).faktor !== 1) wirkte = true; }
  ok(gleichBlieb, `Werft-Preise nach ${schritte} Lagen (Embargo, Belagerung, Vorräte leer/voll, 40 Ticks) unverändert`);
  ok(wirkte, 'Gegenprobe: dieselbe Lage ändert den Medipack-Preis im Handel');
  // viele Zustände einer laufenden Sim
  for (let s = 0; s < 6; s++) {
    const k = neu({ seed: 20 + s }).g; andocken(k, ROM_HAFEN); const v = JSON.stringify(Werft.sortiment(k).map((q) => Werft.preis(k, q.art, q.id)));
    embargo(z(k), 'rom', ['M', 'E'], z(k).tick + 30);
    for (let t = 0; t < 60; t++) { Kern.tick(z(k)); if (t % 15 === 0) belagerung(z(k), ROM_HAFEN); if (JSON.stringify(Werft.sortiment(k).map((q) => Werft.preis(k, q.art, q.id))) !== v) { gleichBlieb = false; } }
  }
  ok(gleichBlieb, 'Werft-Preise über 6 Seeds x 60 Ticks mit Embargo und Belagerungen unverändert');
  ok(!/preise.js|preisFuer|faktorAus/.test(fs.readFileSync(path.join(__dirname, "..", "server", "sim", "werft.js"), "utf8")), "werft.js bindet die Preisschicht nicht ein");
});

section('Kampagne und ohne Weltsim: alter Preis', () => {
  for (const start of ['arena_space', 'tutorial']) {
    let g;
    try { g = neu({ start }).g; } catch (e) { g = null; }
    if (!g) continue;
    ok(!g.weltsim, `${start}: ohne Weltsim`);
    g.ship.docked = true; g.ship.dockedAt = 'hafen';
    ok(CONFIG.shop.every((e) => Preise.preisFuer(g, e, 'hafen') === Shop.priceFor(e, 'hafen')) && CONFIG.shop.every((e) => Preise.preisFuer(g, e, 'vaelen') === Shop.priceFor(e, 'vaelen')), `${start}: preisFuer = priceFor für das ganze Sortiment, Hafen und Vaelen`);
    g.players[0].console = 'shop';
    ok(!('shopPreise' in g.snapshot()), `${start}: kein Feld shopPreise im Snapshot`);
    g.inventory.marks = 500; const vor = g.inventory.marks;
    ok(Shop.buy(g, g.players[0], 'medipack') === null && g.inventory.marks === vor - eintrag(g, 'medipack').price, `${start}: Kauf zum alten Preis`);
  }
  const { g } = neu({ start: 'freie_fahrt' }); andocken(g, ROM_HAFEN);
  ok(!!g.weltsim && CONFIG.shop.every((e) => Preise.preisFuer(g, e, 'hafen') === Shop.priceFor(e, 'hafen')), 'Freie Fahrt ohne Treiber: alle Preise wie vorher');
  ok(!('shopPreise' in g.snapshot()), 'Freie Fahrt ohne Treiber: kein Feld im Snapshot (kein Byte)');
  // Vaelen: auch mit Lage fester Preis
  embargo(z(g), 'rom', ['M', 'E'], z(g).tick + 10); belagerung(z(g), ROM_HAFEN);
  ok(CONFIG.shop.every((e) => Preise.preisFuer(g, e, 'vaelen') === Shop.priceFor(e, 'vaelen')), 'Karawane (vaelen): feste Preise trotz Lage');
});

section('Anzeige = Kauf', () => {
  const { g } = neu(); andocken(g, ROM_HAFEN); const zz = z(g);
  embargo(zz, 'rom', ['M', 'E'], zz.tick + 10); zz.vorrat.rom.U = 3;
  const sn = g.snapshot();
  ok(sn.shopPreise && Object.keys(sn.shopPreise).sort().join() === 'bolzen,ersatzteil,flickblech,loeschgel,medipack', 'Snapshot nennt genau die Artikel mit Faktor != 1: ' + Object.keys(sn.shopPreise || {}).join());
  ok(sn.shopPreise.medipack[0] === 39 && /^teurer: Embargo gegen Rom$/.test(sn.shopPreise.medipack[1]), 'Medipack 30 -> 39, Hinweis "' + sn.shopPreise.medipack[1] + '"');
  ok(/^teurer: Munition knapp$/.test(sn.shopPreise.bolzen[1]), 'Torpedo: Hinweis "' + sn.shopPreise.bolzen[1] + '"');
  const p = g.players[0];
  for (const id of Object.keys(sn.shopPreise)) {
    const vor = g.inventory.marks, inv = g.inventory[id] || 0;
    const err = Shop.buy(g, p, id);
    ok(err === null && vor - g.inventory.marks === sn.shopPreise[id][0] && g.inventory[id] === inv + 1, `${id}: angezeigt ${sn.shopPreise[id][0]} = gebucht ${vor - g.inventory.marks}`);
    ok(g.purchases[g.purchases.length - 1].marks === sn.shopPreise[id][0], `${id}: Kaufprotokoll trägt denselben Preis`);
  }
  // feste Artikel kosten den Grundpreis
  const v2 = g.inventory.marks; Shop.buy(g, p, 'sonde'); ok(v2 - g.inventory.marks === grundPreis(g, 'sonde'), 'Sonde: fester Preis');
  // zu wenig Marken: Nachricht, nichts gebucht, Grenze genau beim Lagepreis
  g.inventory.marks = sn.shopPreise.medipack[0] - 1; const m0 = g.inventory.marks;
  ok(Shop.buy(g, p, 'medipack') === 'Nicht genug Marken.' && g.inventory.marks === m0, 'ein Mark zu wenig für den Lagepreis: abgelehnt');
  g.inventory.marks = sn.shopPreise.medipack[0]; ok(Shop.buy(g, p, 'medipack') === null && g.inventory.marks === 0, 'genau der Lagepreis reicht');
  // der Preis ändert sich nur mit dem Sim-Tick: gleicher Stand, gleicher Preis
  const a = JSON.stringify(g.snapshot().shopPreise), b = JSON.stringify((run(g, 3), g.snapshot().shopPreise));
  ok(a === b, 'Preis bleibt über 3 s Echtzeit gleich (nur Sim-Ticks ändern ihn)');
  // Sim tickt (Sprung): Embargo läuft aus, Preis fällt auf den Grundpreis zurück
  embargo(zz, 'rom', ['M'], zz.tick + 1); Kern.tick(zz); Kern.tick(zz);
  ok(Preises(g, 'medipack') === grundPreis(g, 'medipack'), 'nach Ablauf des Embargos: Grundpreis');
});

section('Hinweis: nur bei geänderter Anzeige, Richtung und Treiber nach dem Vorzeichen (Fix K2)', () => {
  const D = require('../server/weltsim/daten.js'), V = W.vorrat.wert, B = W.belagerung.wert;
  const { g } = neu(); andocken(g, ROM_HAFEN); const zz = z(g);
  const nachbar = D.datenVon(zz).nbr[ROM_HAFEN].find((c) => c !== ROM_HAFEN && D.datenVon(zz).hex[c]);
  belagerung(zz, nachbar); zz.vorrat.rom.U = V.reichlich.ab;   // Torpedo: Belagerung nebenan (+) und reichlich Munition (-): Summe 0,9
  ok(Math.abs(F(zz, 'bolzen') - (1 + B.umkreis + V.reichlich.zuschlag)) < 1e-9 && Preise.faktorAus(zz, 'bolzen', ROM_HAFEN).gruende.join() === 'umkreis,vorrat_reichlich', 'Ausgangslage: gemischte Treiber (umkreis und vorrat_reichlich), Faktor ' + F(zz, 'bolzen'));
  let sn = g.snapshot().shopPreise.bolzen;
  ok(sn[0] < grundPreis(g, 'bolzen') && /^günstiger: Munition reichlich$/.test(sn[1]), 'günstiger nach der Preisänderung, genannt wird nur der Treiber, der günstiger macht: "' + sn[1] + '"');
  ok(!/Belagerung/.test(sn[1]), 'der Treiber mit dem anderen Vorzeichen (Belagerung in der Nähe) steht nicht unter „günstiger“');
  zz.vorrat.rom.U = 20;   // nur noch die Belagerung nebenan: teurer
  sn = g.snapshot().shopPreise.bolzen;
  ok(sn[0] > grundPreis(g, 'bolzen') && /^teurer: Belagerung in der Nähe$/.test(sn[1]), 'teurer, nur die Belagerung: "' + sn[1] + '"');
  eintrag(g, 'bolzen').price = 3;   // 3 x 1,1 = 3,3 rundet auf 3: der angezeigte Preis ändert sich nicht
  const ohne = g.snapshot().shopPreise;
  ok(Preises(g, 'bolzen') === 3 && (!ohne || !('bolzen' in ohne)), 'ändert sich der gerundete Preis nicht (3 -> 3), gibt es weder Preis noch Hinweis für den Artikel');
  eintrag(g, 'bolzen').price = 10;
  ok(['umkreis', 'belagerung', 'embargo', 'vorrat_knapp'].every((k) => Preise.vorzeichenVon(k) === 1) && Preise.vorzeichenVon('vorrat_reichlich') === -1, 'Vorzeichen der Treiber aus den Daten: Belagerung, Embargo, knapp teurer, reichlich günstiger');
});

section('Konkordat-Hafen und Stützpunkt', () => {
  const { g } = neu(); const zz = z(g);
  ok(zz.hexe[KON_HAFEN].besitzer === 'kon', 'Concordia gehört dem Konkordat');
  embargo(zz, 'rom', ['M', 'E'], zz.tick + 10); embargo(zz, 'ger', ['M', 'E'], zz.tick + 10); belagerung(zz, KON_HAFEN); zz.vorrat.kon.U = 0;
  ok(VERBRAUCH.every((id) => F(zz, id, KON_HAFEN) === 1), 'Konkordat-Hafen: Embargo, Belagerung und Vorrat wirken nicht (Faktor 1,0)');
  andocken(g, KON_HAFEN);
  ok(CONFIG.shop.every((e) => Preise.preisFuer(g, e, Shop.shopContext(g)) === Shop.priceFor(e, Shop.shopContext(g))), 'Kauf im Konkordat-Hafen: Grundpreise');
  ok(!('shopPreise' in g.snapshot()), 'Snapshot ohne shopPreise');
  const z0 = Object.assign({}, zz.hexe[ROM_HAFEN]);
  zz.hexe[ROM_HAFEN].besitzer = 'ger'; embargo(zz, 'ger', ['M'], zz.tick + 10);
  ok(F(zz, 'medipack', ROM_HAFEN) === 1.3, 'Besitzer wird aus der Sim gelesen (Hafen in germanischer Hand: Embargo gegen die Germanen)');
  zz.vorrat.ger.U = 0; zz.vorrat.rom.U = 50;
  ok(F(zz, 'bolzen', ROM_HAFEN) === 1.3, 'Vorrat des Besitzers zählt (Hafen in germanischer Hand: Vorrat der Germanen, nicht Roms)');
  Object.assign(zz.hexe[ROM_HAFEN], z0);
  // Posten ist kein Hafen
  const k = neu(); const d = Daten.datenVon(z(k.g)); const frei = d.codes.find((c) => !d.hex[c].hafen);
  ok(Preise.faktorAus(z(k.g), 'medipack', frei).faktor === 1, 'Hex ohne Hafen: 1,0');
  const post = d.codes.find((c) => !d.hex[c].hafen && c !== frei);
  Object.assign(z(k.g).hexe[post], { besitzer: 'rom', posten: true }); embargo(z(k.g), 'rom', ['M', 'E'], z(k.g).tick + 10);
  ok(F(z(k.g), 'medipack', post) === 1, 'Posten (Besitzer Rom, Embargo läuft) ist kein Hafen: 1,0');
  // Stützpunkt der Crew: kein Handel, also auch kein Feld
  const { g: s } = neu(); andocken(s, ROM_HAFEN); embargo(z(s), 'rom', ['M'], z(s).tick + 10);
  ok('shopPreise' in s.snapshot(), 'Gegenprobe: Rom-Hafen mit Embargo hat shopPreise');
  ok(Shop.sperreFuer(s) === null, 'Rom-Hafen: keine Handelssperre');
  s.weltBesitz.hexe[ROM_HAFEN] = { besitzer: 'rom', posten: true, crew: true };   // wie ein Stützpunkt der Crew: Werft ja, Handel nein
  const sperre = Shop.sperreFuer(s), m1 = s.inventory.marks;
  ok(typeof sperre === 'string' && !('shopPreise' in s.snapshot()), 'Stützpunkt der Crew: kein Feld shopPreise (kein Handel, keine Preise)');
  ok(Shop.buy(s, s.players[0], 'medipack') === sperre && s.inventory.marks === m1, 'Stützpunkt der Crew: Kauf gesperrt, nichts gebucht');
});

section('Terminal (echte consoles.js und terminal-ui.js)', () => {
  const pal = new Proxy({}, { get: () => '#000' });
  const win = { Shared_Schiffskatalog: Katalog, Shared_Maps: Maps, Shared_Physics: Physics, Shared_Config: CONFIG, Shared_Protocol: Protocol, Shared_Locations: Locations, performance, Net: { reportError(w, e) { throw e; } } };
  win.window = win;
  win.Render = { PAL: pal, text() {}, drawTooltip() {} }; win.Hud = {}; win.Pult = {};
  win.PultTerminal = { TOKENS: { RASTER: { deckName: ['Mitteldeck', 'Oberdeck', 'Unterdeck'] } }, kappe: (a, e) => e, tw: (s) => String(s).length * 6, zeichneTerminal() {} };
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'consoles.js'), 'utf8'), win, { filename: 'consoles.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'terminal-ui.js'), 'utf8'), win, { filename: 'terminal-ui.js' });
  const TU = win.TerminalUI;
  ok(TU && win.Consoles && typeof win.Consoles.shopRows === 'function', 'TerminalUI und Consoles geladen');
  const { g, c } = neu(); andocken(g, ROM_HAFEN); const zz = z(g);
  const sicht = () => ({ state: JSON.parse(JSON.stringify(g.snapshot())), me: g.players[0], send(m) { g.handleMessage(c, m); }, actions: { sfx() {}, leave() {} } });
  const modell = () => { win.Render.ui = { buttons: [], mouse: { x: 0, y: 0 } }; const v = sicht(); TU.draw({}, v); return TU.modell(sicht()); };
  TU.zuruecksetzen();
  let m = modell();
  ok(m.bereich === 'handel', 'Terminal öffnet im Handel');
  const vorPreise = m.handel.artikel.map((a) => [a.id, a.preis]);
  ok(vorPreise.every(([id, p]) => p === grundPreis(g, id)), 'ohne Lage: alle Preise = Grundpreise');
  ok(!m.handel.info.text || !/teurer|günstiger/.test(m.handel.info.text), 'ohne Lage: kein Hinweis');
  embargo(zz, 'rom', ['M'], zz.tick + 10);
  m = modell();
  const art = (id) => m.handel.artikel.find((a) => a.id === id);
  ok(art('medipack').preis === 39 && art('ersatzteil').preis === grundPreis(g, 'ersatzteil'), 'Terminal zeigt Medipack 39, Ersatzteil unverändert');
  ok(art('medipack').preis === Preises(g, 'medipack'), 'Anzeige = Server-Preis');
  art('medipack').onClick(); m = modell();
  ok(m.handel.gewaehlt === 'medipack' && /^teurer: Embargo gegen Rom\./.test(m.handel.info.text), 'Hinweis in der Infozeile: "' + m.handel.info.text + '"');
  ok(/ 39 M/.test(m.aktionen.haupt.text), 'Kaufknopf nennt 39 M: ' + m.aktionen.haupt.text);
  art('ersatzteil').onClick(); m = modell();
  ok(!/teurer/.test(m.handel.info.text), 'Artikel ohne Faktor: kein Hinweis');
  // Kauf über die UI: gebucht = angezeigt
  art('medipack').onClick(); m = modell();
  const vor = g.inventory.marks; m.aktionen.haupt.onClick();
  ok(vor - g.inventory.marks === 39, 'Kauf über das Terminal bucht 39');
  g.inventory.marks = 38; m = modell();
  ok(art('medipack').grund === 'Nicht genug Marken' || m.handel.artikel.find((a) => a.id === 'medipack').grund === 'Nicht genug Marken', 'bei 38 Marken: gesperrt (Lagepreis, nicht Grundpreis 30)');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
