'use strict';
// PROTOTYP, nicht ans Spiel angebunden (Gespräch mit Kai, 2026-10-10): prozedurale Stationsgrammatik.
//   node tools/proto-station.js --raeume 8 --seed 1       eine Station als ASCII
//   node tools/proto-station.js --raeume 10 --seed 3 --viele 4   mehrere Seeds hintereinander
//   node tools/proto-station.js --sweep 40                Kennzahlen über 40 Seeds für 6/8/10/12/14 Räume
// Grammatik: Transporter (Ankunft) -> Gang (4 breit, je Seite ein Raum, Ende = Kreuzung oder Raum) -> Kreuzung (1-3 Gänge).
// Schott an jeder Modulgrenze (Öffnung 2 breit), Kriechgang = Röhrennetz um alle Räume, nur von Räumen aus erreichbar.
const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FW = +val('--w', 96), FH = +val('--h', 56);   // Kai 2026-10-10: Station darf größer als 48×24 werden, sie wächst mit der Raumzahl

const G = require('../shared/gen-station.js').erzeuger(FW, FH);
const { bauen, zeichnen, kennzahlen } = G;
const horiz = (d) => d === 'E' || d === 'W';

function ausgeben(seed, ziel) {
  const S = bauen(seed, ziel), Z = zeichnen(S), K = kennzahlen(S, Z);
  const b = K.bbox;
  const zeilen = Z.out.slice(b.y0, b.y1 + 1).map((r) => r.slice(b.x0, b.x1 + 1).join('').replace('%', '#'));
  console.log(`Seed ${seed}, Ziel ${ziel} Räume: erreicht ${K.raeume}, Gänge ${K.gaenge}, Kreuzungen ${K.kreuzungen}, Tiefe ${K.tiefe}, ${K.breite}×${K.hoehe} Kacheln`);
  console.log(`  Kriechnetze ${K.kriechNetze}, Räume mit Luke ${K.raeumeMitLuke}/${K.alleRaeume} (am Hauptnetz ${K.lukenAmHauptnetz}), längste Schussbahn ${K.schussbahn}`);
  console.log(zeilen.join('\n').replace(/%/g, '#'));
  console.log();
}

if (args.includes('--sweep')) {
  const n = +val('--sweep', 40);
  console.log('Räume(Ziel) | erreicht Ø | Größe Ø (max) | Kriechnetze=1 | alle Räume mit Luke | Luken am Hauptnetz | Schussbahn Ø (max)');
  for (const z of [6, 8, 10, 12, 14]) {
    let er = 0, ar = 0, amax = 0, eins = 0, luke = 0, haupt = 0, sb = 0, sbm = 0;
    for (let s = 1; s <= n; s++) {
      const S = bauen(s, z), K = kennzahlen(S, zeichnen(S));
      er += K.raeume; const a = K.breite * K.hoehe; ar += a; amax = Math.max(amax, a);
      if (K.kriechNetze === 1) eins++; if (K.raeumeMitLuke === K.alleRaeume) luke++; if (K.lukenAmHauptnetz === K.raeumeMitLuke) haupt++;
      sb += K.schussbahn; sbm = Math.max(sbm, K.schussbahn);
    }
    console.log(`${String(z).padStart(3)} | ${(er / n).toFixed(1)} | ${Math.round(ar / n)} (${amax}) | ${eins}/${n} | ${luke}/${n} | ${haupt}/${n} | ${(sb / n).toFixed(1)} (${sbm})`);
  }
} else {
  const ziel = +val('--raeume', 8), seed = +val('--seed', 1), viele = +val('--viele', 1);
  for (let i = 0; i < viele; i++) ausgeben(seed + i, ziel);
  console.log('Legende: T Transporter · K Kommando · R Reaktor · M Messe · L Lager · Q Quartiere · H Krankenstation · W Werkstatt · Z Zellen · . Gang · S Schott-Öffnung · D Tür · h Luke · ~ Kriechgang · # Wand');
}
