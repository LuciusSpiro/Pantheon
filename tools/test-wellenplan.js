'use strict';
// SUND-02a A1: Wellenplan (server/weltsim/wellenplan.js) und Kommandantenwahl: rein, deterministisch, Zielpläne 8/17/40, Grenzen.
//   node tools/test-wellenplan.js
const assert = require('assert');
const CONFIG = require('../shared/config.js');
const Wp = require('../server/weltsim/wellenplan.js');
const KOMM = require('../content/welt/kommandanten.json').kommandanten;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
const P = CONFIG.wellenplan.punkte;
const pkt = (w) => w.reduce((s, g) => s + g.n * P[g.kind], 0);
const schiffe = (w) => w.reduce((s, g) => s + g.n, 0);
const text = (w) => w.map((g) => g.n + ' ' + g.kind).join(' + ');
const mengen = (plan) => plan.wellen.map((w) => w.map(({ kind, n }) => ({ kind, n })).sort((a, b) => P[a.kind] - P[b.kind]));
const J = (nn) => ({ kind: 'raider', n: nn }), K = (nn) => ({ kind: 'korvette', n: nn }), F = (nn) => ({ kind: 'fregatte', n: nn }), X = (nn) => ({ kind: 'kreuzer', n: nn });

section('Daten: Punktwerte je Klasse');
ok(P.raider === 1 && P.korvette === 2 && P.fregatte === 4 && P.kreuzer === 7 && P.frachter === 0, 'raider 1, korvette 2, fregatte 4, kreuzer 7, frachter 0');
ok(Object.keys(P).every((k) => CONFIG.enemies[k]), 'jede Klasse mit Punktwert ist eine Gegnerklasse der Config');

section('Zielpläne (neutrale Bauweise)');
for (const s of [8, 17, 40]) console.log('  Stärke ' + s + ': ' + Wp.plane({ staerke: s, seed: 1, volk: 'rom' }).wellen.map((w) => '[' + text(w) + ']').join(' '));
ok(gleich(mengen(Wp.plane({ staerke: 8, seed: 1, volk: 'rom' })), [[J(2)], [K(1)], [F(1)]]), 'Stärke 8: 2 Jäger | 1 Korvette | Finale Fregatte');
ok(gleich(mengen(Wp.plane({ staerke: 17, seed: 1, volk: 'rom' })), [[J(2), K(1)], [K(1), F(1)], [X(1)]]), 'Stärke 17: 2J+1K | 1F+1K | Finale Kreuzer');
ok(gleich(mengen(Wp.plane({ staerke: 40, seed: 1, volk: 'rom' })), [[J(4), K(2)], [K(1), F(2)], [F(2), X(1)], [X(1)]]), 'Stärke 40: 4J+2K | 2F+1K | 1X+2F | Finale Kreuzer');
ok(gleich(mengen(Wp.plane({ staerke: 40, seed: 99 })), mengen(Wp.plane({ staerke: 40, seed: 1 }))), 'ohne Bauweise-Charakter ist der Plan seed-unabhängig');
const p17 = Wp.plane({ staerke: 17, seed: 1, volk: 'rom', kommandant: 'Legat Test' });
ok(p17.flaggschiff.kind === 'kreuzer' && p17.flaggschiff.kommandant === 'Legat Test', 'flaggschiff = { kind, kommandant }');
ok(p17.wellen[p17.wellen.length - 1][0].kind === p17.flaggschiff.kind && p17.wellen.every((w) => w.every((g) => g.volk === 'rom')), 'Finale beginnt mit dem Flaggschiff, Gruppen tragen volk');

section('Reproduzierbarkeit');
for (const volk of ['rom', 'ger', 'pirat', undefined]) {
  const a = Wp.plane({ staerke: 33.7, seed: 4711, volk, kommandant: 'X' }), b = Wp.plane({ staerke: 33.7, seed: 4711, volk, kommandant: 'X' });
  ok(gleich(a, b), 'gleiche Eingabe, gleicher Plan (' + volk + ')');
}
const vielfalt = new Set();
for (let sd = 0; sd < 40; sd++) vielfalt.add(JSON.stringify(Wp.plane({ staerke: 40, seed: sd, volk: 'ger' }).wellen));
ok(vielfalt.size > 1, 'Seed wirkt bei Bauweise mit Charakter (verschiedene Pläne: ' + vielfalt.size + ')');
ok(Wp.seedAus('f12', 340) === Wp.seedAus('f12', 340) && Wp.seedAus('f12', 340) !== Wp.seedAus('f12', 341), 'seedAus(flottenId, tick) stabil und unterscheidet');
const rndSave = Math.random, nowSave = Date.now; let genutzt = 0;
Math.random = () => { genutzt++; return 0.5; }; Date.now = () => { genutzt++; return 1; };
Wp.plane({ staerke: 60, seed: 3, volk: 'pirat' }); Wp.kommandantFuer({ fraktion: 'ger', seed: 3 });
Math.random = rndSave; Date.now = nowSave;
ok(genutzt === 0, 'kein Math.random, kein Date.now');

section('Punktsumme, Gleichzeitigkeit, Form (Stärke 1 bis 500, alle Bauweisen)');
let summeOk = true, maxOk = true, formOk = true, flagOk = true, klasseOk = true, w1Ok = true, wachsOk = true, maxSchiffe = 0, schlecht = '';
for (const volk of ['rom', 'ger', 'pirat', 'kon', undefined]) {
  for (let s = 1; s <= 500; s++) {
    const pl = Wp.plane({ staerke: s, seed: s * 7, volk });
    const ws = pl.wellen, fin = ws[ws.length - 1];
    if (pl.punkte !== s || ws.reduce((a, w) => a + pkt(w), 0) !== s) { summeOk = false; schlecht = 'summe ' + s; }
    for (const w of ws) { maxSchiffe = Math.max(maxSchiffe, schiffe(w)); if (schiffe(w) > CONFIG.flotte.max) { maxOk = false; schlecht = 'max ' + s + ' ' + volk; } }
    if (!ws.length || !fin.length || fin[0].kind !== pl.flaggschiff.kind || fin[0].n !== 1) formOk = false;
    if (P[pl.flaggschiff.kind] > Math.max(s / 2, 1)) flagOk = false;
    if (ws.some((w) => w.some((g) => !(P[g.kind] > 0) || !CONFIG.enemies[g.kind] || !(g.n >= 1) || g.n !== Math.round(g.n)))) klasseOk = false;
    if (ws.length > 1 && pkt(ws[0]) > Math.max(1, Math.min(Math.floor(s * 0.25), CONFIG.wellenplan.welle1.max))) w1Ok = false;
    if (!volk || volk === 'kon' || volk === 'rom') { const mid = ws.slice(1, -1).map(pkt); for (let i = 1; i < mid.length; i++) if (mid[i] < mid[i - 1]) wachsOk = false; }
  }
}
ok(summeOk, 'Summe aller Punkte inkl. Finale = Stärke ' + schlecht);
ok(maxOk, 'höchstens ' + CONFIG.flotte.max + ' Schiffe je Welle (größte gesehen: ' + maxSchiffe + ')');
ok(formOk, 'Finale zuletzt, beginnt mit genau einem Flaggschiff');
ok(flagOk, 'Flaggschiff höchstens halbe Stärke (mindestens Jäger)');
ok(klasseOk, 'nur gültige Klassen-Ids, n ganzzahlig >= 1');
ok(w1Ok, 'Welle 1 höchstens ein Viertel der Stärke (höchstens welle1.max)');
ok(wachsOk, 'mittlere Wellen wachsen');
const p120 = Wp.plane({ staerke: 120, seed: 5, volk: 'rom' });
ok(p120.wellen.length > Wp.plane({ staerke: 40, seed: 5, volk: 'rom' }).wellen.length && p120.wellen.every((w) => schiffe(w) <= 12), 'Stärke 120: mehr Wellen als bei 40, jede Welle <= 12 Schiffe');
const w120 = p120.wellen.map(pkt);
ok(w120[0] < w120[1] && w120[0] <= 8 && w120[w120.length - 1] === P.kreuzer + Math.floor((120 - 40) * CONFIG.wellenplan.eskorte.anteil), 'Stärke 120: Welle 1 klein, Finale = Flaggschiff + Eskorte');

section('Welle 1 klein, Flaggschiff zuletzt, Bauweise');
const p60 = Wp.plane({ staerke: 60, seed: 2, volk: 'rom' });
ok(p60.wellen[0].every((g) => g.kind === 'raider' || g.kind === 'korvette'), 'Welle 1 nur Jäger und Korvetten');
ok(p60.wellen.slice(1, -1).every((w) => w.some((g) => g.kind === 'korvette' || g.kind === 'fregatte' || g.kind === 'kreuzer')), 'mittlere Wellen mit Korvetten/Fregatten/Kreuzern');
const mittel = (volk) => { let f = 0, k = 0, j = 0; for (let sd = 0; sd < 60; sd++) for (const w of Wp.plane({ staerke: 40, seed: sd, volk }).wellen) for (const g of w) { if (g.kind === 'raider') j += g.n; if (g.kind === 'korvette') k += g.n; if (g.kind === 'fregatte') f += g.n; } return { f, k, j }; };
const mg = mittel('ger'), mp = mittel('pirat'), mr = mittel('rom');
ok(mg.f > mr.f && mp.j > mr.j, 'Germanen mehr Fregatten, Piraten mehr Jäger als neutral (ger F ' + mg.f + ' > ' + mr.f + ', pirat J ' + mp.j + ' > ' + mr.j + ')');

section('Gebrochene Stärke, Stärke < 1');
ok(gleich(mengen(Wp.plane({ staerke: 8.9, seed: 1, volk: 'rom' })), mengen(Wp.plane({ staerke: 8, seed: 1, volk: 'rom' }))) && Wp.plane({ staerke: 8.9, seed: 1 }).punkte === 8, '8,9 wird 8 (abgerundet)');
ok(Wp.plane({ staerke: 7.3, seed: 1 }).punkte === 7, '7,3 wird 7');
for (const s of [0.5, 0, -3, NaN, undefined, 0.999]) { const pl = Wp.plane({ staerke: s, seed: 1 }); ok(pl.wellen.length === 0 && pl.flaggschiff === null && pl.punkte === 0, 'Stärke ' + s + ': leerer Plan'); }
ok(gleich(mengen(Wp.plane({ staerke: 1, seed: 1 })), [[J(1)]]), 'Stärke 1: nur ein Jäger (Flaggschiff)');

section('Kompatibel zu Flotte.wellenStart');
{
  const Flotte = require('../server/sim/flotte.js');
  let fehler = null;
  const spiel = { time: 0, ship: { scene: 's' }, C: CONFIG, nextId: () => 'wl1', space: {} };
  try { Flotte.wellenStart(spiel, { wellen: Wp.plane({ staerke: 17, seed: 1, volk: 'ger' }).wellen }); } catch (e) { fehler = e; }
  const st = spiel.flotte && spiel.flotte.welle;
  ok(!fehler && st && st.liste.length === 3 && st.liste.every((w) => w.every((g) => g.kind && g.n >= 1 && g.volk === 'ger')), 'wellenStart nimmt den Plan unverändert (Wellen und Gruppen {kind,n,volk})' + (fehler ? ' ' + fehler.message : ''));
}

section('Kommandanten');
for (const f of ['rom', 'ger', 'pirat', 'kon']) ok(Array.isArray(KOMM[f]) && KOMM[f].length >= 6 && KOMM[f].every((k) => k.name && ['rom', 'ger', 'pirat'].includes(k.volk)) && new Set(KOMM[f].map((k) => k.name)).size === KOMM[f].length, f + ': mindestens 6 Kommandanten mit Namen und Bauweise, Namen eindeutig');
ok(gleich(Wp.kommandantFuer({ fraktion: 'ger', seed: 12 }), Wp.kommandantFuer({ fraktion: 'ger', seed: 12 })), 'gleicher Seed, gleicher Kommandant');
const gesehen = new Set(); for (let sd = 0; sd < 200; sd++) gesehen.add(Wp.kommandantFuer({ fraktion: 'ger', seed: sd }).name);
ok(gesehen.size === KOMM.ger.length, 'alle Kommandanten der Fraktion kommen vor (' + gesehen.size + ')');
let uebersprungen = true;
for (let sd = 0; sd < 200; sd++) {
  const erster = Wp.kommandantFuer({ fraktion: 'pirat', seed: sd });
  const ohne = Wp.kommandantFuer({ fraktion: 'pirat', seed: sd, gefallen: [erster.name] });
  if (ohne.name === erster.name) uebersprungen = false;
  if (!gleich(ohne, Wp.kommandantFuer({ fraktion: 'pirat', seed: sd, gefallen: new Set([erster.name]) }))) uebersprungen = false;
}
ok(uebersprungen, 'gefallener Kommandant wird übersprungen (Liste oder Set), Wahl bleibt deterministisch');
ok(Wp.kommandantFuer({ fraktion: 'kon', seed: 1, gefallen: KOMM.kon.map((k) => k.name) }) === null, 'alle gefallen -> null');
ok(Wp.kommandantFuer({ fraktion: 'frei', seed: 1 }) === null, 'unbekannte Fraktion -> null');

console.log(`\n${n - fails}/${n} Prüfungen ok`);
process.exit(fails ? 1 : 0);
