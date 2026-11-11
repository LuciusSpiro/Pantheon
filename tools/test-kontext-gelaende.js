#!/usr/bin/env node
'use strict';
// SPL-01 a2: Kontext-Politik für vom Spielleiter angelegte, besuchte Gelände-Landepunkte (server/mission/context.js gelaendeDeckeln, Wert in
// shared/config.js spielleiter.kontext.gelaendeEinzeln). Ohne Deckel wächst der Grobplan-Kontext um ~93 Tokens je Landepunkt (T13-Grenze 2200).
//  1. Weltstand mit 20 gespeicherten besuchten Gelände-Landepunkten (wildnis und hoehle, auf jedem Fixture-Weltstand): Zuwachs < 2200 Tokens
//     (Formel von T13: tools/lib/messe-spl.js kontextZuwachs), höchstens `gelaendeEinzeln` einzeln, Zählzeile stimmt, der zuletzt besuchte bleibt.
//  2. Politik mit dem Wert 3 (Entscheid des Leiters; Token-Grenze dort nicht Gegenstand): höchstens 3 einzeln, Zählzeile, ein vierter Besuch verdrängt den ältesten.
//  3. Echter Weg: LP.neu + LP.betreten -> toSave -> Kontext (Besuchsfolge `zuletzt`), Altstand ohne `zuletzt` lädt, Speicherformat additiv.
//  4. Feste, Kachel- und nie betretene Landepunkte sind nie betroffen.
// Aufruf: node tools/test-kontext-gelaende.js     (Mutationsprobe: tools/mutation-kontext-gelaende.js)
const M = require('./lib/messe-spl.js');
const Context = require('../server/mission/context.js');
const Katalog = require('../server/mission/katalog.js');
const LP = require('../server/sim/landepunkte.js');
const Config = require('../shared/config.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } };
const katalog = Katalog.load({});
const GRENZE = M.KONTEXT_GRENZE;   // wie T13 (Quelle: tools/lib/messe-spl.js)
const kont = Config.spielleiter.kontext;
const mitDeckel = (wert, fn) => { const alt = kont.gelaendeEinzeln; kont.gelaendeEinzeln = wert; try { return fn(); } finally { kont.gelaendeEinzeln = alt; } };
const eintrag = (art, i, extra) => Object.assign({ seed: 1000 + i, bauversion: art === 'wildnis' ? '~gelaende.3' : '~hoehle.1', art, bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt',
  zustaende: { 'fund.1': 'genommen' }, alarm: false, besuche: 1, zuletzt: i, letzte_mission: null, neu: false, gesperrt: false, ort: 'kesh', beam: { x: 1650, y: 1060, range: 360 } }, extra || {});
// Weltstand + nGes besuchte Gelände-Landepunkte am Ort kesh (Besuchsfolge = Nummer); bei gemischt wechselt die Art zwischen wildnis und hoehle
function mitGelaende(w0, nGes, gemischt) {
  const w = M.clone(w0); w.welt = Object.assign({}, w.welt);
  const b = Object.assign({}, w.welt.landepunkte || {});
  for (let i = 1; i <= nGes; i++) { const art = gemischt && i % 2 ? 'hoehle' : 'wildnis'; b[`kesh.${art}-${i}`] = eintrag(art, i); }
  w.welt.landepunkte = b; return w;
}
const alleLp = (c) => c.orte.flatMap((o) => o.landepunkte || []);
const IST_GEL = /^kesh\.(wildnis|hoehle)-\d+$/;
const gelaende = (c) => alleLp(c).filter((x) => IST_GEL.test(x.id));
const kesh = (c) => c.orte.find((o) => o.id === 'kesh');
const zahl = (c) => c.orte.reduce((s, o) => s + (o.landepunkte_mehr ? +/^\+(\d+) /.exec(o.landepunkte_mehr)[1] : 0), 0);
const build = (w) => Context.build(w, {}, katalog);
const nummern = (c) => gelaende(c).map((x) => +x.id.split('-')[1]).sort((a, b) => a - b).join();

ok(Number.isInteger(kont.gelaendeEinzeln) && kont.gelaendeEinzeln >= 0, 'Konfiguration spielleiter.kontext.gelaendeEinzeln ist eine ganze Zahl');
ok(Array.isArray(kont.gelaendeArten) && kont.gelaendeArten.includes('wildnis') && kont.gelaendeArten.includes('hoehle'), 'Konfiguration spielleiter.kontext.gelaendeArten nennt wildnis und hoehle');
const EINZELN = kont.gelaendeEinzeln;

// 1. 20 Landepunkte, jeder Fixture-Weltstand, Konfigurationswert
let maxPlus = 0;
for (const [name, w0] of M.weltstaende()) {
  const c = build(mitGelaende(w0, 20, true));
  const z = M.kontextZuwachs(c); maxPlus = Math.max(maxPlus, z.plus);
  ok(z.plus < GRENZE, `${name}: Kontext-Zuwachs mit 20 Gelände-Landepunkten ${z.plus} < ${GRENZE}`);
  const g = gelaende(c);
  ok(g.length <= EINZELN && g.length === Math.min(20, EINZELN), `${name}: ${g.length} Gelände-Landepunkte einzeln (Deckel ${EINZELN})`);
  ok(g.every((x) => x.anker && x.besucht === 1), `${name}: die einzeln genannten haben Anker-Zahlen und Besuchszähler (volle Form)`);
  if (EINZELN > 0) ok(g.some((x) => x.id === 'kesh.wildnis-20'), `${name}: der zuletzt besuchte (20) steht einzeln`);
  ok(zahl(c) === 20 - EINZELN, `${name}: Zählzeilen ergeben ${20 - EINZELN} weitere (gezählt ${zahl(c)})`);
  ok(kesh(c).landepunkte_mehr === `+${20 - EINZELN} weitere Gelände-Karten besucht`, `${name}: Zählzeile am Ort kesh: ${kesh(c).landepunkte_mehr}`);
}
console.log(`  20 Landepunkte: max Zuwachs ${maxPlus} (Grenze ${GRENZE}, Deckel ${EINZELN})`);

// 2. Politik mit Wert 3
const w0 = M.weltstand('frisch');
mitDeckel(3, () => {
  const c = build(mitGelaende(w0, 20, true));
  ok(gelaende(c).length === 3, `Deckel 3: genau 3 einzeln (${gelaende(c).length})`);
  ok(zahl(c) === 17 && kesh(c).landepunkte_mehr === '+17 weitere Gelände-Karten besucht', `Deckel 3: Zählzeile +17 (${kesh(c).landepunkte_mehr})`);
  ok(nummern(c) === '18,19,20', `Deckel 3: die drei zuletzt besuchten (${nummern(c)})`);
  const wenig = build(mitGelaende(w0, 2, false));
  ok(gelaende(wenig).length === 2 && !kesh(wenig).landepunkte_mehr, 'Deckel 3: bei 2 Landepunkten beide einzeln, keine Zählzeile');
  ok(!('landepunkte_mehr' in kesh(build(w0))), 'Deckel 3: ohne Gelände-Landepunkte keine Zählzeile (Kontext unverändert)');
  // ein vierter Besuch verdrängt den ältesten
  const vier = mitGelaende(w0, 3, false);
  ok(nummern(build(vier)) === '1,2,3' && !('landepunkte_mehr' in kesh(build(vier))), 'Deckel 3: drei besucht -> alle drei einzeln');
  vier.welt.landepunkte['kesh.wildnis-4'] = eintrag('wildnis', 4);
  const c4 = build(vier);
  ok(nummern(c4) === '2,3,4', `Deckel 3: vierter besucht -> kesh.wildnis-1 fällt aus dem Einzelblock (${nummern(c4)})`);
  ok(kesh(c4).landepunkte_mehr === '+1 weitere Gelände-Karten besucht', `Deckel 3: Zählzeile nach dem vierten +1 (${kesh(c4).landepunkte_mehr})`);
  // Wiederbesuch des ältesten (höhere Besuchsfolge) holt ihn zurück, ein anderer fällt heraus
  vier.welt.landepunkte['kesh.wildnis-1'] = eintrag('wildnis', 1, { zuletzt: 5, besuche: 2 });
  const c5 = build(vier);
  ok(nummern(c5) === '1,3,4' && gelaende(c5).find((x) => x.id === 'kesh.wildnis-1').besucht === 2, `Deckel 3: Wiederbesuch holt kesh.wildnis-1 zurück, kesh.wildnis-2 fällt heraus (${nummern(c5)})`);
  // Altstand ohne Besuchsfolge: höhere Nummer zuerst
  const alt = mitGelaende(w0, 6, false);
  for (const e of Object.values(alt.welt.landepunkte)) delete e.zuletzt;
  ok(nummern(build(alt)) === '4,5,6', 'Altstand ohne zuletzt: lädt, die höchsten Nummern bleiben einzeln');
});
mitDeckel(0, () => {
  const c = build(mitGelaende(w0, 5, false));
  ok(gelaende(c).length === 0 && kesh(c).landepunkte_mehr === '+5 weitere Gelände-Karten besucht', 'Deckel 0: keiner einzeln, Zählzeile +5');
});

// 3. echter Weg über die Landepunkt-Verwaltung
const spiel = () => ({ seed: 77, aways: {}, mission: { id: 'm1' }, weltstand: { data: {} }, ship: { scene: 'kesh' }, log() {}, countError(w, e) { throw e; } });
mitDeckel(3, () => {
  const g = spiel();
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(LP.neu(g, 'kesh', { art: i % 2 ? 'hoehle' : 'wildnis', besitz: 'rostmeute' }));
  const folge = [ids[2], ids[0], ids[3], ids[1]];   // Besuchsreihenfolge; ids[4] wird nie betreten
  for (const id of folge) LP.betreten(g, id);
  const block = LP.toSave(g);
  ok(!('zuletzt' in block[ids[4]]), 'Speicherformat: nie betreten -> kein Feld zuletzt');
  ok(folge.every((id, i) => block[id].zuletzt === i + 1), `Speicherformat: zuletzt = Besuchsfolge (${folge.map((id) => block[id].zuletzt)})`);
  const bekannt = ['seed', 'bauversion', 'schablone', 'art', 'bauweise', 'besitz', 'zustand', 'zustaende', 'alarm', 'besuche', 'letzte_mission', 'neu', 'gesperrt', 'abbau_runde', 'ort', 'beam', 'name', 'frei'];
  ok(JSON.stringify(Object.keys(block[ids[0]]).filter((k) => !bekannt.includes(k))) === '["zuletzt"]', 'Speicherformat: einziges neues Feld ist zuletzt (additiv)');
  const w = M.clone(w0); w.welt = Object.assign({}, w.welt, { landepunkte: block });
  const c = build(w);
  const besucht = gelaende(c).filter((x) => x.besucht > 0).map((x) => x.id).sort();
  ok(besucht.length === 3 && besucht.join() === [folge[1], folge[2], folge[3]].sort().join(), `echter Weg: die drei zuletzt betretenen einzeln (${besucht}), der älteste nicht`);
  ok(gelaende(c).some((x) => x.id === ids[4]), 'echter Weg: nie betretener neu-Landepunkt bleibt einzeln (verworfen wird er vom Spielleiter, nicht vom Kontext)');
  ok(kesh(c).landepunkte_mehr === '+1 weitere Gelände-Karten besucht', 'echter Weg: Zählzeile +1');
  // Weltstand laden und weiterspielen: Besuchsfolge geht weiter
  const g2 = spiel(); LP.restore(JSON.parse(JSON.stringify(block)), g2);
  LP.betreten(g2, folge[0]);
  ok(LP.toSave(g2)[folge[0]].zuletzt === 5, 'nach restore und neuem Besuch: zuletzt 5');
});

// 4. nicht betroffene Landepunkte
const feste = (c) => JSON.stringify(c.orte.map((o) => [o.id, (o.landepunkte || []).filter((x) => !IST_GEL.test(x.id))]));
const ohne = build(w0); const mit = build(mitGelaende(w0, 20, true));
ok(feste(ohne) === feste(mit), 'feste Landepunkte (hand, ruine, station, schiff, aussenposten) in jedem Ort unverändert');
ok(alleLp(ohne).length > 5 && alleLp(ohne).every((x) => !IST_GEL.test(x.id)), 'Fixture hat feste Landepunkte');
const adapter = Context.lpAdapter({ seed: 1, aways: {}, landepunkte: { lru: [],
  eintraege: { 'k_0103.k0': { besuche: 4, zuletzt: 9 }, 'kesh.kastell': { besuche: 4 }, 'kesh.wildnis-1': { besuche: 1 }, 'kesh.wildnis-2': { besuche: 0 }, 'kesh.schiff-1': { besuche: 3 }, 'kesh.wildnis-3': { besuche: 2 } },
  dyn: { 'kesh.wildnis-1': { art: 'wildnis' }, 'kesh.wildnis-2': { art: 'wildnis' }, 'kesh.schiff-1': { art: 'schiff' }, 'kesh.wildnis-3': { art: 'wildnis', kachel: true } } } });
ok(adapter.gelaendeBesucht('kesh.wildnis-1') === true, 'Adapter: angelegter, besuchter Gelände-Landepunkt zählt');
ok(adapter.gelaendeBesucht('kesh.wildnis-2') === false, 'Adapter: nie betretener zählt nicht');
ok(adapter.gelaendeBesucht('kesh.kastell') === false && adapter.gelaendeBesucht('k_0103.k0') === false, 'Adapter: fester und Kachel-Landepunkt (nicht in dyn) zählen nicht');
ok(adapter.gelaendeBesucht('kesh.schiff-1') === false, 'Adapter: angelegtes, besuchtes Schiff zählt nicht');
ok(adapter.gelaendeBesucht('kesh.wildnis-3') === false, 'Adapter: Definition mit kachel: true zählt nicht');

console.log(`${n - bad} ok, ${bad} Fehler`);
process.exit(bad ? 1 : 0);
