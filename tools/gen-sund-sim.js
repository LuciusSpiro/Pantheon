'use strict';
// SUND-01 P0: erzeugt content/welt/sund-sim.json (Format weltsim-karte/1), die Kartendaten der Weltsimulation „Freie Fahrt Sund“.
//   node tools/gen-sund-sim.js            schreibt content/welt/sund-sim.json
//   node tools/gen-sund-sim.js --pruefen  vergleicht die Datei mit dem, was aus sund.json entstünde (Exit 1 bei Abweichung)
//
// Quelle der Wahrheit: content/welt/sund.json (Hexe, Namen, Fraktionen, Hafenklassen, Kanten). Dazu kommt nur die kleine Gütertabelle
// unten (aus dem Prototyp Vault/Pantheon/Welt/karte_sund.py, Güterspalte „+“ = Quelle). Die Datei ist abgeleitet und wird nie von Hand
// gepflegt; tools/test-sund-sim-daten.js prüft, dass sie zum Stand von sund.json passt.
//
// Regeln der Ableitung:
//  - Sim-Hexe sind alle Hexe mit Fraktion rom/ger/saum/pirat sowie die freien Sektoren der Gütertabelle (Gasfeld, Kantenstein, Eisfeld,
//    Brachland, Pulverhorn, Saatfeld). Die Sonderorte (Bojenfeld 0706, Vorläufer-Sektor 0806, Helix 0506) sind nicht in der Sim.
//  - simFraktion: rom, ger, kon (aus saum), pirat; null für freie Sektoren.
//  - hafenklasse (A–D) nur für Hexe von Rom, Germanen und Konkordat; wie im Prototyp haben freie Sektoren und Piratenlager keinen Hafen
//    (sund.json führt für Kantenstein D und Pulverhorn C eine Hafenklasse für die Kampagne, die Sim ignoriert sie: Sektoren sind dort
//    beanspruchbar, keine Häfen). Die Bevölkerung je Klasse steht in sund-sim-werte.json (bevoelkerung), nicht hier.
//  - quellen: Güter T (Treibstoff), M (Medizin), U (Munition), E (Ersatzteile), N (Nahrung) laut Gütertabelle.
//  - kanten: alle Kanten aus sund.json zwischen zwei Sim-Hexen. `flotte` ist true bei art open (Flotten fahren nur offene Kanten),
//    Piraten dürfen jede Kante nutzen (open, hidden, locked), wie nbr_p im Prototyp. Die Kantenart bleibt wie in sund.json.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SUND = path.join(ROOT, 'content', 'welt', 'sund.json');
const AUS = path.join(ROOT, 'content', 'welt', 'sund-sim.json');

// Gütertabelle: Quellen je Hex (karte_sund.py, Güterspalte „+“). Hexe ohne Eintrag oder mit leerer Liste haben keine Quelle.
const QUELLEN = {
  '0204': '', '0203': 'N', '0105': 'E', '0205': 'U', '0304': '', '0305': '', '0403': '', '0405': '',
  '1004': '', '1003': 'N', '1105': 'E', '1005': 'U', '0904': '', '0905': '', '0803': '', '0805': '',
  '0503': 'T', '0603': '', '0703': 'T', '0505': 'N', '0605': 'U', '0705': 'N',
  '0504': 'E', '0604': 'M', '0704': 'T',
  '0602': '', '0606': ''
};
const FRAKTION = { rom: 'rom', ger: 'ger', saum: 'kon', pirat: 'pirat', frei: null };
const MIT_HAFEN = new Set(['rom', 'ger', 'saum']);

function bauen(sund) {
  sund = sund || JSON.parse(fs.readFileSync(SUND, 'utf8'));
  const hexe = [];
  for (const code of Object.keys(sund.hexe).sort()) {
    const h = sund.hexe[code];
    if (!(code in QUELLEN)) continue;                      // Sonderorte und alles ohne Gütereintrag
    if (!(h.fraktion in FRAKTION)) throw new Error(`Hex ${code}: Fraktion ${h.fraktion} nicht in der Sim`);
    hexe.push({
      code, name: h.name, simFraktion: FRAKTION[h.fraktion],
      hafenklasse: MIT_HAFEN.has(h.fraktion) ? (h.hafen || '') : '',
      quellen: QUELLEN[code].split('').filter(Boolean)
    });
  }
  const in_ = new Set(hexe.map((h) => h.code));
  const kanten = sund.kanten.filter((e) => in_.has(e.a) && in_.has(e.b))
    .map((e) => { const [a, b] = [e.a, e.b].sort(); return { a, b, art: e.art, flotte: e.art === 'open', piraten: true }; })
    .sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1));
  return {
    format: 'weltsim-karte/1',
    _hinweis: 'ABGELEITET, nicht von Hand ändern: node tools/gen-sund-sim.js (Quelle content/welt/sund.json + Gütertabelle in tools/gen-sund-sim.js). simFraktion null = freier Sektor. flotte: Flotten fahren nur offene Kanten; piraten: Piraten nutzen alle Kanten.',
    karte: sund.id, spalten: sund.spalten, zeilen: sund.zeilen,
    hexe, kanten
  };
}

function text(doc) {
  const zeilen = (liste) => liste.map((x) => '    ' + JSON.stringify(x)).join(',\n');
  return '{\n' + ['format', '_hinweis', 'karte', 'spalten', 'zeilen'].map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(doc[k])},\n`).join('')
    + '  "hexe": [\n' + zeilen(doc.hexe) + '\n  ],\n  "kanten": [\n' + zeilen(doc.kanten) + '\n  ]\n}\n';
}

module.exports = { bauen, text, QUELLEN, AUS, SUND };

if (require.main === module) {
  const soll = text(bauen());
  if (process.argv.includes('--pruefen')) {
    const ist = fs.existsSync(AUS) ? fs.readFileSync(AUS, 'utf8').replace(/\r\n/g, '\n') : '';
    if (ist !== soll) { console.error('sund-sim.json weicht von sund.json + Gütertabelle ab: node tools/gen-sund-sim.js'); process.exit(1); }
    console.log('sund-sim.json ist aktuell');
  } else {
    fs.writeFileSync(AUS, soll);
    console.log('geschrieben: ' + path.relative(ROOT, AUS));
  }
}
