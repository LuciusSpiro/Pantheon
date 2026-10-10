'use strict';
// PROTOTYP, nicht ans Spiel angebunden (Gespräch mit Kai, 2026-10-10): prozedurale Siedlungsgrammatik.
//   node tools/proto-siedlung.js --haeuser 14 --seed 1 --bauweise rom --typ handel
//   node tools/proto-siedlung.js --haeuser 18 --seed 4 --bauweise germanen --typ militaer
//   node tools/proto-siedlung.js --sweep 40
// Reihenfolge: Rahmen (Tor, Landefeld, Mauer nur beim Militärlager) -> Straßennetz (Rom: Raster, Germanen: Hauptachse mit
// Abzweigen) -> Parzellen entlang der Straßen -> Gebäude (Funktionsgebäude betretbar, Rest Kulisse) -> Leitstücke, Deckung.
const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FW = +val('--w', 130), FH = +val('--h', 90);

const G = require('../shared/gen-siedlung.js').erzeuger(FW, FH);
const { bauen, kennzahlen } = G;

function ausgeben(seed, N, bw, typ) {
  const B = bauen(seed, N, bw, typ), K = kennzahlen(B), S = B.S;
  const z = [];
  for (let y = Math.max(0, S.y0 - 2); y <= Math.min(FH - 1, S.y1 + 2); y++) z.push(B.grid[y].slice(Math.max(0, S.x0 - 3), S.x1 + 4).join(''));
  console.log(`Seed ${seed} · ${bw} · ${typ} · Ziel ${N} Gebäude: gebaut ${K.haeuser} (davon betretbar ${K.funktion}, erreichbar ${K.erreichbar}) · Fläche ${K.breite}×${K.hoehe}`);
  console.log(`  Straße ${(K.anteilStrasse * 100).toFixed(0)} % · Platz ${(K.anteilPlatz * 100).toFixed(0)} % · bebaut ${(K.anteilBebaut * 100).toFixed(0)} % · längste freie Bahn ${K.sicht} · Deckung an Straßen ${K.deckungStrasse}`);
  console.log(z.join('\n'));
  console.log();
}

if (args.includes('--sweep')) {
  const n = +val('--sweep', 40);
  console.log('Typ/Volk | Ziel | gebaut Ø | betretbar erreichbar | Fläche Ø | Straße % | bebaut % | längste Bahn Ø (max)');
  for (const [bw, typ] of [['rom', 'handel'], ['rom', 'militaer'], ['germanen', 'handel'], ['germanen', 'militaer']]) for (const N of [8, 14, 20]) {
    let g = 0, fe = 0, ff = 0, fl = 0, sp = 0, bb = 0, sb = 0, sm = 0;
    for (let s = 1; s <= n; s++) { const K = kennzahlen(bauen(s, N, bw, typ)); g += K.haeuser; fe += K.erreichbar; ff += K.funktion; fl += K.flaeche; sp += K.anteilStrasse; bb += K.anteilBebaut; sb += K.sicht; sm = Math.max(sm, K.sicht); }
    console.log(`${bw}/${typ} | ${N} | ${(g / n).toFixed(1)} | ${fe}/${ff} | ${Math.round(fl / n)} | ${(sp / n * 100).toFixed(0)} | ${(bb / n * 100).toFixed(0)} | ${(sb / n).toFixed(0)} (${sm})`);
  }
} else {
  ausgeben(+val('--seed', 1), +val('--haeuser', 14), val('--bauweise', 'rom'), val('--typ', 'handel'));
  console.log('Legende: = Straße · + Platz · . Boden · , Landefeld · P Abholpunkt · m Monument · Y Generator · A Antenne · # Gebäude/Kulisse · x Kulissentür · D Tür · K Kommando · L Lager · W Werkstatt · Q Quartiere · C Kantine · M Mauer · T Turm · g Tor · o Deckungsobjekt · : Gelände');
}
