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
  const cap = Maps.cargoCapacity([1]);   // PAN-01 B / LAD-01 A2: 4 Plätze je Modul Frachtraum (Start-Lerche: ein Frachtraum)
  const leer = FL.frachtListe(null, cap);
  ok(leer.belegt === 0 && leer.frei === cap && leer.text === 'FRACHTRAUM 0/' + cap + ': leer', 'leer: ' + leer.text);
  const eins = FL.frachtListe({ lager: ['deuterium'] }, cap);
  ok(eins.belegt === 1 && eins.frei === cap - 1 && /^FRACHTRAUM 1\/4: Deuterium · 3 frei$/.test(eins.text), 'eine Ware: ' + eins.text);
  const voll = FL.frachtListe({ lager: ['deuterium'], pers: [{ id: 'evert', n: 'Evert Kroeger', b: 0 }] }, cap);
  ok(voll.belegt === 2 && voll.frei === 2 && voll.text === 'FRACHTRAUM 2/4: Deuterium, Evert Kroeger · 2 frei', 'Ware und Person: ' + voll.text);
  ok(voll.eintraege[1].art === 'person' && voll.eintraege[0].art === 'deuterium', 'Einträge nach Art');
  ok(FL.frachtListe({ lager: ['sprengstoff', 'fracht'] }, cap).text === 'FRACHTRAUM 2/4: Sprengstoff, Fracht · 2 frei', 'Sprengstoff und Fracht');
  const drei = FL.frachtListe({ lager: ['deuterium', 'fracht', 'sprengstoff', 'sprengstoff', 'sprengstoff'], pers: [{ id: 'evert', n: 'Evert', b: 0 }, { id: 'a', n: 'A', b: 1 }, { id: 'b', n: 'B', b: 2 }] }, Maps.cargoCapacity([1, 2]));
  ok(drei.cap === 8 && drei.belegt === 8 && drei.frei === 0 && drei.titel === 'FRACHTRAUM 8/8', 'zwei Frachträume: 8 Plätze (' + drei.titel + ')');
  ok(Maps.cargoCapacity(Maps.frachtRaeumeAusMod([['f', 1, 1, 1], ['k', 2, 1, 1], ['f', 4, 1, 1]])) === 8, 'Kapazität aus dem Snapshot-Feld ship.mod (Code f): zwei Frachträume = 8');
  // LAD-01 A2: Füllstand 25/50/75/100 % je Modul aus der gemeinsamen Belegungsfunktion
  const B = Maps.frachtBelegungAusSnapshot({ ship: { mod: [['f', 1, 1, 1]] }, fracht: { lager: ['deuterium', 'deuterium'] } });
  ok(B.module.length === 1 && B.module[0].art === 'deuterium' && B.module[0].anzahl === 2 && B.module[0].plaetze.filter((p) => p.art).length === 2, 'Snapshot -> Belegung: ein Modul, Deuterium 2/4 (50 %)');
  const info = Maps.frachtPlatzAn(B, B.module[0].plaetze[0].x, B.module[0].plaetze[0].y);
  ok(info && info.art === 'deuterium' && info.modulArt === 'deuterium' && Maps.frachtPlatzAn(B, 0, 0) === null, 'Platz an einer Kachel: Ladung und Modultyp, sonst null');
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
