'use strict';
// SUND-01 P0: erzeugt content/welt/sund_frei.json (Format sektorkarte/1, id sund_frei), die Karte des Modus „Freie Fahrt Sund“.
//   node tools/gen-sund_frei.js            schreibt content/welt/sund_frei.json
//   node tools/gen-sund_frei.js --pruefen  vergleicht die Datei mit der Ableitung (Exit 1 bei Abdrift)
//
// Warum eine zweite Karte: Die Kampagne Die Schuld der Lerche teilt sich content/welt/sund.json. Brachland 0505 und Saatfeld 0705 sind dort
// bewusst Leerraum, und die Kante 0605–0705 ist der temporäre Sprungpunkt des Notrufs sl_echt. sund.json bleibt deshalb unverändert.
// sund_frei.json ist sund.json plus Overlay (unten): alle Hexe und Kanten von sund.json (Sonderorte und Schlüsselkanten wie dort), dazu
//  - die Hexe Brachland 0505 und Saatfeld 0705 (freie Sektoren, spielbar, Szene aus Daten),
//  - die 6 Kanten des Prototyps karte_sund.py, die sund.json fehlen: 0405–0505, 0505–0605, 0605–0705, 0705–0805, 0504–0505, 0704–0705
//    (alle fest offen, auch 0605–0705),
//  - id, name, quelle, start (Ostia Nova 0305, angedockt, boden false). Damit der Start einen Ort hat, bekommt 0305 minimal ort/gen/spielbar/
//    andocken (Paket P0),
//  - SUND-01 D: jedes Hex der Karte ist spielbar (ort aus dem Namen, gen true; Sonderorte behalten ihre Einträge), jedes Hex mit Hafenklasse
//    ist andockbar (andocken true; ob die Crew wirklich darf, entscheidet der Besitzer: server/sim/besitz.js). Kantenstein bekommt einen Dock
//    unter dem Planeten, weil der Liegeplatz sonst auf der Planetenoberfläche läge,
//  - SUND-01 E (Kai): Rom-Gebiet und Konkordat sind beim Start vorab erkundet (start.erkundet = Hexe, start.bojen = Kanten, siehe vorerkundung()).
// Die Datei ist abgeleitet und wird nie von Hand gepflegt; tools/test-sund-sim-daten.js prüft, dass sie zu sund.json + Overlay passt.
// sund-sim.json wird wiederum aus sund_frei.json abgeleitet (tools/gen-sund-sim.js).
const fs = require('fs');
const path = require('path');
const GenSektor = require('../shared/gen-sektor.js');
const Sektoren = require('../shared/sektoren.js');

const ROOT = path.join(__dirname, '..');
const QUELLE = path.join(ROOT, 'content', 'welt', 'sund.json');
const AUS = path.join(ROOT, 'content', 'welt', 'sund_frei.json');

// ---------- Overlay ----------
const NEUE_HEXE = {
  '0505': { name: 'Brachland', fraktion: 'frei', art: 'Kolonie, Ackerland', region: 'route', spielbar: true, ort: 'brachland', gen: true },
  '0705': { name: 'Saatfeld', fraktion: 'frei', art: 'Kolonie, Ackerland', region: 'route', spielbar: true, ort: 'saatfeld', gen: true }
};
const NEUE_KANTEN = [['0405', '0505'], ['0505', '0605'], ['0605', '0705'], ['0705', '0805'], ['0504', '0505'], ['0704', '0705']];
const HEXE_ERGAENZT = { '0305': { spielbar: true, ort: 'ostia_nova', gen: true, andocken: true } };   // Startort; sonst Paket D
// Sonderfall Kantenstein: Planeten-Station r 170 mit festem Mittelpunkt, Liegeplatz darunter außerhalb des Planeten
const SZENE_ERGAENZT = { '0603': { station: { x: 1500, y: 800 }, dock: { x: 1500, y: 1070 } } };
const START = { ort: 'ostia_nova', bekannt: ['ostia_nova'], boden: false };

// SUND-01 E (Kai 2026-10-20): Spielerkenntnis, nicht Wissen der Sim. Die Crew kennt beim Start ohne Weitscan
//  - alle Hexe mit Besitzer Rom und Konkordat (erkundet: Zielwahl, Schnellsprung) und die freien Hexe, die an beide grenzen (Gasfeld 0503, Brachland 0505:
//    die einzige Verbindung zwischen den Gebieten, ohne sie ginge der Schnellsprung nach Concordia nicht),
//  - die Boje jeder offenen Kante, deren eines Ende ein Rom- oder Konkordat-Hex ist (also auch die Kanten hinaus in die angrenzenden Hexe).
// Freie Sektoren sonst, Germanen, Piraten, Sonderorte und alle verborgenen/gesperrten Kanten bleiben unerkundet wie bisher.
function vorerkundung(doc) {
  const nb = (c) => doc.kanten.filter((e) => e.a === c || e.b === c).map((e) => (e.a === c ? e.b : e.a));
  const fr = (c) => doc.hexe[c].fraktion;
  const gebiet = Object.keys(doc.hexe).filter((c) => fr(c) === 'rom' || fr(c) === 'saum');
  const korridor = Object.keys(doc.hexe).filter((c) => fr(c) === 'frei' && nb(c).some((n) => fr(n) === 'rom') && nb(c).some((n) => fr(n) === 'saum'));
  const erkundet = gebiet.concat(korridor).sort();
  const bojen = doc.kanten.filter((e) => e.art === 'open' && (gebiet.includes(e.a) || gebiet.includes(e.b))).map((e) => Sektoren.kanteId(e.a, e.b)).sort();
  return { erkundet, bojen };
}

function bauen(sund) {
  sund = sund || JSON.parse(fs.readFileSync(QUELLE, 'utf8'));
  const doc = JSON.parse(JSON.stringify(sund));
  for (const c of Object.keys(NEUE_HEXE)) { if (doc.hexe[c]) throw new Error(`Hex ${c} steht schon in sund.json`); }
  for (const c of Object.keys(HEXE_ERGAENZT)) Object.assign(doc.hexe[c], HEXE_ERGAENZT[c]);
  Object.assign(doc.hexe, JSON.parse(JSON.stringify(NEUE_HEXE)));
  // Paket D: alle Hexe spielbar, alle Häfen andockbar
  const orte = new Set();
  for (const [c, h] of Object.entries(doc.hexe)) {
    if (!h.spielbar) { h.spielbar = true; h.ort = h.ort || GenSektor.ortId(h.name); h.gen = true; }
    if (h.hafen) h.andocken = true;
    if (orte.has(h.ort)) throw new Error(`Ort-Id ${h.ort} doppelt (${c})`);
    orte.add(h.ort);
  }
  for (const [c, sz] of Object.entries(SZENE_ERGAENZT)) {
    const z = doc.hexe[c].szene = doc.hexe[c].szene || {};
    for (const [k, v] of Object.entries(sz)) z[k] = (v && typeof v === 'object' && z[k] && typeof z[k] === 'object') ? Object.assign({}, z[k], v) : v;
  }
  for (const [a, b] of NEUE_KANTEN) {
    if (doc.kanten.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) throw new Error(`Kante ${a}–${b} steht schon in sund.json`);
    doc.kanten.push({ a, b, art: 'open' });
  }
  doc.id = 'sund_frei';
  doc.name = 'Karte Sund (Freie Fahrt)';
  doc.quelle = 'ABGELEITET aus content/welt/sund.json plus Overlay (tools/gen-sund_frei.js), nicht von Hand ändern. Karte des Modus Freie Fahrt Sund (SUND-01): alle Hexe und Kanten von sund.json, dazu Brachland 0505, Saatfeld 0705 und die 6 Kanten des Prototyps karte_sund.py, die sund.json fehlen (auch 0605–0705 fest offen). Die Kampagne Die Schuld der Lerche bleibt auf sund.json.';
  doc.start = Object.assign(JSON.parse(JSON.stringify(START)), vorerkundung(doc));
  return doc;
}

function text(doc) {
  const j = (x) => JSON.stringify(x);
  const kopf = Object.keys(doc).filter((k) => !['hexe', 'kanten', 'regionen', 'fraktionen'].includes(k)).map((k) => `  ${j(k)}: ${j(doc[k])}`);
  const zeilen = (o) => Object.entries(o).map(([k, v]) => `    ${j(k)}: ${j(v)}`).join(',\n');
  return '{\n' + kopf.join(',\n') + ',\n  "hexe": {\n' + zeilen(doc.hexe) + '\n  },\n  "kanten": [\n' + doc.kanten.map((e) => '    ' + j(e)).join(',\n')
    + '\n  ],\n  "regionen": {\n' + zeilen(doc.regionen) + '\n  },\n  "fraktionen": {\n' + zeilen(doc.fraktionen) + '\n  }\n}\n';
}

module.exports = { bauen, text, vorerkundung, AUS, QUELLE, NEUE_HEXE, NEUE_KANTEN };

if (require.main === module) {
  const soll = text(bauen());
  if (process.argv.includes('--pruefen')) {
    const ist = fs.existsSync(AUS) ? fs.readFileSync(AUS, 'utf8').replace(/\r\n/g, '\n') : '';
    if (ist !== soll) { console.error('sund_frei.json weicht von sund.json + Overlay ab: node tools/gen-sund_frei.js'); process.exit(1); }
    console.log('sund_frei.json ist aktuell');
  } else {
    fs.writeFileSync(AUS, soll);
    console.log('geschrieben: ' + path.relative(ROOT, AUS));
  }
}
