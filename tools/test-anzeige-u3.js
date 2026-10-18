'use strict';
// U3: Kompass-Anzeige (Kurs 0° = Norden) und Frachtraum-Liste.   node tools/test-anzeige-u3.js
const Phys = require('../shared/physics.js');
const FL = require('../shared/frachtliste.js');
const Maps = require('../shared/maps.js');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

console.log('Kompass-Grad (Weltwinkel 0 = +x/Osten, y nach unten)');
const P = Math.PI;
ok(Phys.kompassGrad(-P / 2) === 0, 'nach oben (−90° Welt) = 0° Norden');
ok(Phys.kompassGrad(0) === 90, 'nach rechts = 90° Osten');
ok(Phys.kompassGrad(P / 2) === 180, 'nach unten = 180° Süden');
ok(Phys.kompassGrad(P) === 270 && Phys.kompassGrad(-P) === 270, 'nach links = 270° Westen');
ok(Phys.kompassGrad(3 * P / 2) === 0, 'Winkel über 2π werden normiert');
for (const g of [0, 45, 90, 180, 270, 359]) ok(Phys.kompassGrad(Phys.radAusKompass(g)) === g, 'Rückrichtung ' + g + '°');
ok(Math.abs(Phys.radAusKompass(0) + P / 2) < 1e-9, 'radAusKompass(0) = −π/2 (oben)');

console.log('Frachtraum-Liste');
{
  const cap = Maps.cargoCapacity([1]);   // PAN-01 B: 2 Plätze je Modul Frachtraum (Start-Lerche: ein Frachtraum)
  const leer = FL.frachtListe(null, cap);
  ok(leer.belegt === 0 && leer.frei === cap && leer.text === 'FRACHTRAUM 0/' + cap + ': leer', 'leer: ' + leer.text);
  const eins = FL.frachtListe({ lager: ['deuterium'] }, cap);
  ok(eins.belegt === 1 && eins.frei === cap - 1 && /^FRACHTRAUM 1\/2: Deuterium · 1 frei$/.test(eins.text), 'eine Ware: ' + eins.text);
  const voll = FL.frachtListe({ lager: ['deuterium'], pers: [{ id: 'evert', n: 'Evert Kroeger', b: 0 }] }, cap);
  ok(voll.belegt === 2 && voll.frei === 0 && voll.text === 'FRACHTRAUM 2/2: Deuterium, Evert Kroeger', 'Ware und Person: ' + voll.text);
  ok(voll.eintraege[1].art === 'person' && voll.eintraege[0].art === 'deuterium', 'Einträge nach Art');
  ok(FL.frachtListe({ lager: ['sprengstoff', 'fracht'] }, cap).text === 'FRACHTRAUM 2/2: Sprengstoff, Fracht', 'Sprengstoff und Fracht');
  const drei = FL.frachtListe({ lager: ['deuterium', 'fracht', 'sprengstoff'], pers: [{ id: 'evert', n: 'Evert', b: 0 }] }, Maps.cargoCapacity([1, 2]));
  ok(drei.cap === 4 && drei.belegt === 4 && drei.frei === 0 && drei.titel === 'FRACHTRAUM 4/4', 'zwei Frachträume: 4 Plätze (' + drei.titel + ')');
  ok(Maps.cargoCapacity(Maps.frachtRaeumeAusMod([['f', 1, 1, 1], ['k', 2, 1, 1], ['f', 4, 1, 1]])) === 4, 'Kapazität aus dem Snapshot-Feld ship.mod (Code f): zwei Frachträume = 4');
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
