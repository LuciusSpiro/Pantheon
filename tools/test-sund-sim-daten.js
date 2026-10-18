'use strict';
// SUND-01 P0: Kartendaten und Werte der Weltsimulation (content/welt/sund-sim.json, sund-sim-werte.json).   node tools/test-sund-sim-daten.js
// Geprüft: Datei = Ableitung aus sund.json (tools/gen-sund-sim.js), Hexmengen, Spiegelsymmetrie Rom/Germanen, Kanten, Häfen, Hauptwelten, Werte.
const fs = require('fs');
const path = require('path');
const Gen = require('./gen-sund-sim.js');
const DIR = path.join(__dirname, '..', 'content', 'welt');
const lies = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);

const sund = lies('sund.json'), sim = lies('sund-sim.json'), werte = lies('sund-sim-werte.json');
const spiegel = (c) => String(12 - Number(c.slice(0, 2))).padStart(2, '0') + c.slice(2);
const ek = (a, b) => [a, b].sort().join('-');
const spiegelKante = (k) => k.split('-').map(spiegel).sort().join('-');
const SONDER = ['0506', '0706', '0806'];                         // Helix, Bojenfeld, Vorläufer-Sektor: nicht in der Sim
// Kante des Prototyps (karte_sund.py), die sund.json noch nicht trägt: 0605–0705 ist der temporäre Sprungpunkt des Notrufs sl_echt
// (content/notrufe/sl_echt.json) und würde als feste Kante die Kampagne ändern. Offen, Entscheidung beim Entwicklungsleiter.
const OFFEN = ['0605-0705'];

section('Datei ist aus sund.json abgeleitet');
ok(sim.format === 'weltsim-karte/1' && sim.karte === 'sund', 'Format weltsim-karte/1, Karte sund');
ok(Gen.text(Gen.bauen(sund)) === fs.readFileSync(path.join(DIR, 'sund-sim.json'), 'utf8').replace(/\r\n/g, '\n'), 'sund-sim.json == Ableitung aus sund.json + Gütertabelle (node tools/gen-sund-sim.js)');

section('Hexe');
const codes = sim.hexe.map((h) => h.code);
ok(new Set(codes).size === codes.length, 'Hex-Codes eindeutig');
const erwartet = Object.keys(sund.hexe).filter((c) => !SONDER.includes(c)).sort();
ok(codes.slice().sort().join() === erwartet.join(), `Hexmenge = sund.json ohne Sonderorte (${codes.length} Hexe)`);
ok(SONDER.every((c) => sund.hexe[c] && !codes.includes(c)), 'Bojenfeld, Vorläufer-Sektor und Helix sind nicht in der Sim');
const nach = Object.fromEntries(sim.hexe.map((h) => [h.code, h]));
ok(sim.hexe.every((h) => sund.hexe[h.code].name === h.name), 'Namen wie in sund.json');
const FR = { rom: 'rom', ger: 'ger', saum: 'kon', pirat: 'pirat', frei: null };
ok(sim.hexe.every((h) => FR[sund.hexe[h.code].fraktion] === h.simFraktion), 'simFraktion aus Fraktion (saum -> kon, frei -> null)');
ok(sim.hexe.every((h) => ['', 'A', 'B', 'C', 'D'].includes(h.hafenklasse) && Array.isArray(h.quellen) && h.quellen.every((g) => 'TMUEN'.includes(g))), 'Hafenklassen A–D oder leer, Güter aus TMUEN');
ok(sim.hexe.every((h) => ['rom', 'ger', 'kon'].includes(h.simFraktion) === (h.hafenklasse !== '')), 'Hafenklasse genau bei Rom, Germanen und Konkordat');
ok(sim.hexe.every((h) => !h.hafenklasse || h.hafenklasse === sund.hexe[h.code].hafen), 'Hafenklassen wie in sund.json');
const hafen = (f) => sim.hexe.filter((h) => h.simFraktion === f && h.hafenklasse);
ok(hafen('rom').length === 8 && hafen('ger').length === 8, '8 Häfen je Reich');
ok(hafen('kon').length === 3, '3 Konkordat-Häfen');
ok(sim.hexe.filter((h) => h.simFraktion === 'pirat').length === 2, '2 Piratenlager');
ok(nach['0204'] && nach['0204'].simFraktion === 'rom' && nach['0204'].hafenklasse === 'A' && nach['0204'].name === 'Palatina', 'Hauptwelt Palatina 0204 (Rom, A)');
ok(nach['1004'] && nach['1004'].simFraktion === 'ger' && nach['1004'].hafenklasse === 'A' && nach['1004'].name === 'Hrafnheim', 'Hauptwelt Hrafnheim 1004 (Germanen, A)');
ok(sim.hexe.filter((h) => h.simFraktion === null).map((h) => h.code).join() === '0503,0505,0603,0605,0703,0705', 'freie Sektoren: Gasfeld, Brachland, Kantenstein, Pulverhorn, Eisfeld, Saatfeld');

section('Spiegelsymmetrie Rom / Germanen');
const rom = sim.hexe.filter((h) => h.simFraktion === 'rom'), ger = sim.hexe.filter((h) => h.simFraktion === 'ger');
ok(rom.length === ger.length, `Hexzahl gleich (${rom.length})`);
ok(rom.every((h) => nach[spiegel(h.code)] && nach[spiegel(h.code)].simFraktion === 'ger'), 'jedes römische Hex hat sein germanisches Spiegelbild (c <-> 12-c)');
ok(rom.every((h) => { const g = nach[spiegel(h.code)]; return g && g.hafenklasse === h.hafenklasse; }), 'Hafenklassen gespiegelt gleich');
ok(rom.every((h) => { const g = nach[spiegel(h.code)]; return g && g.quellen.join() === h.quellen.join(); }), 'Güter (Quellen) gespiegelt gleich');
ok(sim.hexe.every((h) => nach[spiegel(h.code)]), 'jedes Sim-Hex hat ein Spiegelbild (die Mittelspalte auf sich)');
ok(sim.hexe.filter((h) => h.simFraktion !== 'kon').every((h) => nach[spiegel(h.code)].quellen.join() === h.quellen.join()), 'Güter aller Hexe außer dem Konkordat spiegelsymmetrisch (Nord- und Südroute; Konkordat Hammerwerke E / Lumen T absichtlich ungleich)');

section('Kanten');
const kantenSim = sim.kanten.map((e) => ek(e.a, e.b));
ok(new Set(kantenSim).size === kantenSim.length, 'Kanten eindeutig');
const sundKanten = new Map(sund.kanten.map((e) => [ek(e.a, e.b), e]));
ok(sim.kanten.every((e) => sundKanten.has(ek(e.a, e.b)) && sundKanten.get(ek(e.a, e.b)).art === e.art), 'jede Kante der Sim existiert in sund.json (gleiche Art)');
ok(sim.kanten.every((e) => nach[e.a] && nach[e.b]), 'Kanten verbinden nur Sim-Hexe');
const imSim = sund.kanten.filter((e) => nach[e.a] && nach[e.b]);
ok(imSim.length === sim.kanten.length, `alle sund.json-Kanten zwischen Sim-Hexen sind übernommen (${sim.kanten.length})`);
ok(sim.kanten.every((e) => e.flotte === (e.art === 'open') && e.piraten === true), 'Flotten nur auf offenen Kanten, Piraten auf allen');
ok(sim.kanten.filter((e) => e.art !== 'open').map((e) => ek(e.a, e.b)).sort().join() === '0602-0603,0605-0606', 'nicht offen: nur die zwei Piratenzugänge (hidden)');
{
  const s = new Set(kantenSim);
  const ohne = kantenSim.filter((k) => !s.has(spiegelKante(k)));
  const erlaubt = new Set(OFFEN.flatMap((k) => [k, spiegelKante(k)]));
  ok(ohne.every((k) => erlaubt.has(k)), 'Kanten spiegelsymmetrisch bis auf die benannte offene Kante (' + (ohne.join() || 'keine') + ')');
  ok(OFFEN.every((k) => !s.has(k)) || ohne.length === 0, 'Ausnahmeliste OFFEN nicht veraltet');
  if (ohne.length) console.log('  HINWEIS Kante(n) des Prototyps fehlen in sund.json: ' + OFFEN.join() + ' (einseitig vorhanden: ' + ohne.join() + ')');
}
{ // Zusammenhang: Flotten über offene Kanten, Piraten über alle Kanten
  const nb = (nurOffen) => { const m = {}; for (const c of codes) m[c] = []; for (const e of sim.kanten) if (!nurOffen || e.flotte) { m[e.a].push(e.b); m[e.b].push(e.a); } return m; };
  const bfs = (m, s) => { const d = { [s]: 0 }, q = [s]; while (q.length) { const x = q.shift(); for (const y of m[x]) if (!(y in d)) { d[y] = d[x] + 1; q.push(y); } } return d; };
  const off = bfs(nb(true), '0204'), alle = bfs(nb(false), '0204');
  ok(codes.filter((c) => !['0602', '0606'].includes(c)).every((c) => c in off), 'Rom erreicht jedes Hex außer den Piratenlagern über offene Kanten');
  ok(codes.every((c) => c in alle), 'jedes Hex ist über alle Kanten erreichbar (Piraten)');
  ok(off['1004'] != null, 'Palatina -> Hrafnheim über offene Kanten: ' + off['1004'] + ' Sprünge');
}

section('Werte (sund-sim-werte.json)');
const KEYS = ['ticks', 'prod', 'civil_n', 'civil_m', 'tax', 'up_u', 'up_t', 'active_mult', 'overext', 'mangel_malus', 'mdef_decay', 'mdef_neubau', 'decay', 'cap', 'init_frac',
  'neubau', 'cost_e', 'cost_u', 'bonus', 'base_def', 'regen', 'garrison', 'posten_e', 'claim_ticks', 'k', 'retreat', 'aggr', 'p_act', 'attack_ratio', 'max_active',
  'price_sell', 'price_buy', 'trade_cap', 'embargo', 'pirat_cap', 'pirat_raid', 'trade', 'war', 'stuetz', 'feld_decay', 'sammeln_min', 'sammeln_max', 'stuetz_cap'];
const w = (k) => werte.werte[k] && werte.werte[k].wert;
ok(werte.format === 'weltsim-werte/1', 'Format weltsim-werte/1');
ok(KEYS.every((k) => werte.werte[k] && 'wert' in werte.werte[k]), `alle ${KEYS.length} DEFAULT-Werte des Prototyps vorhanden`);
ok(Object.keys(werte.werte).every((k) => KEYS.includes(k)), 'keine unbekannten Werte');
ok(Object.values(werte.werte).every((v) => typeof v.einheit === 'string' && v.einheit && typeof v._hinweis === 'string'), 'jeder Wert mit Einheit und _hinweis');
ok(w('stuetz') === true && w('feld_decay') === 0.015 && w('overext') === 0 && w('k') === 0.10, 'Auftragsvorgaben: stuetz, feld_decay 0,015, overext 0, k 0,10');
ok(w('sammeln_min') === 3 && w('sammeln_max') === 8 && w('stuetz_cap') === 6 && w('claim_ticks') === 3 && w('garrison') === 4, 'sammeln 3–8, stuetz_cap 6, claim_ticks 3, garrison 4');
ok(JSON.stringify(w('cap')) === '{"A":12,"B":8,"C":5,"D":3}' && JSON.stringify(w('bonus')) === '{"A":0.5,"B":0.35,"C":0.2,"D":0.1,"P":0.05}' && JSON.stringify(w('base_def')) === '{"A":8,"B":6,"C":4,"D":2}', 'Hafenklassen: cap, bonus, base_def');
ok(w('up_u') === 0.04 && w('up_t') === 0.04, 'Unterhalt 0,04');
ok(werte.sicht.weite.wert === 2 && werte.sicht.verzoegerung.wert === 1, 'Sicht 2 Sprünge, Verzögerung 1 Tick');
ok(JSON.stringify(werte.punktwerte.wert) === '{"jaeger":1,"korvette":2,"fregatte":4,"kreuzer":7}', 'Punktwerte Jäger 1, Korvette 2, Fregatte 4, Kreuzer 7');
ok(JSON.stringify(werte.bevoelkerung.wert) === '{"A":3,"B":2,"C":1.5,"D":1,"P":0.5}', 'Bevölkerung je Hafenklasse (A 3, B 2, C 1,5, D 1, Posten 0,5)');
ok(sim.hexe.every((h) => !h.hafenklasse || (h.hafenklasse in werte.werte.cap.wert && h.hafenklasse in werte.bevoelkerung.wert)), 'jede Hafenklasse der Karte hat Kapazität und Bevölkerung');

console.log(`\n${n - fails}/${n} bestanden${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
