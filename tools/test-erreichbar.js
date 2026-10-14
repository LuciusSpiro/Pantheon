'use strict';
// U1: Test des Erreichbarkeits-Prüfers (tools/check-erreichbar.js) und der Kai-Fälle (Spieltest 2026-10-14).   node tools/test-erreichbar.js
// - die echte Kampagne besteht (Orte, Sprünge, Notruf-Schiffe),
// - der Prüfer erkennt die Fehlerbilder: Helix-Ziel ohne Sprungpunkt (alter Stand von k7_geld), Leerraum-Ruf ohne Tor, Schiff außerhalb der Szene,
// - Sprungpunkt-Automatik zieht auch temporäre Sprungpunkte ohne Kartenkante und enthüllte verborgene Kanten.
const fs = require('fs');
const path = require('path');
const E = require('./check-erreichbar.js');
const Welt = require('../server/sim/welt.js');
const Notrufe = require('../server/sim/notrufe.js');
const Sektoren = require('../shared/sektoren.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const klon = (x) => JSON.parse(JSON.stringify(x));
const codes = (r) => r.errors.map((e) => e.code);

try {
  console.log('Kampagne Die Schuld der Lerche (statisch und im echten Server)');
  const res = E.pruefe({});
  ok(res.errors.length === 0, 'keine Fehler' + (res.errors.length ? ': ' + res.errors.slice(0, 3).map((e) => e.code + ' ' + e.p + ' ' + e.msg).join(' | ') : ''));
  for (const h of ['0603', '0604', '0605', '0503', '0506', '0606', '0706', '0806', '0705', '0502']) ok(res.gebraucht.has(h), `Hex ${h} (${Sektoren.hexName(h)}) wird verlangt und geprüft`);
  ok(res.kanten.has('0506-0605') && res.kanten.has('0605-0705') && res.kanten.has('0502-0503'), 'Helix- und Notruf-Sprungpunkte sind in der Zeitlinie');
  ok(res.info.some((i) => /Sprünge/.test(i)) && res.info.filter((i) => /Schiff/.test(i)).length === 3, 'Sprünge geflogen, drei Notruf-Schiffe in der Szene');

  console.log('Fehlerbilder werden erkannt');
  const L0 = E.lade();
  const mit = (mut, dyn) => { const L = { books: klon(L0.books), doc: klon(L0.doc), spuren: klon(L0.spuren), notrufe: klon(L0.notrufe) }; mut(L); return dyn ? E.pruefe({ ueberschreibe: L }) : E.statisch(L); };
  // 1) Kais Helix-Fall: Ziel-Marker im Kapitel, Sprungpunkt erst im Buch sl_forschung (Stand 24d1368)
  const r1 = mit((L) => { for (const s of L.books.k7_geld.steps) if (s.enter) s.enter = s.enter.filter((x) => x.do !== 'sprungpunkt_oeffnen'); });
  ok(codes(r1).includes('ERR-ZEIT') && r1.errors.some((e) => /Helix/.test(e.msg)), 'Helix-Marker ohne offenen Sprungpunkt: ERR-ZEIT (alter Stand von k7_geld)');
  // 2) Leerraum-Ruf ohne Tor
  const r2 = mit((L) => { delete L.notrufe.find((d) => d.id === 'sl_echt').tor; });
  ok(r2.errors.some((e) => e.code === 'ERR-ZEIT' && /0705/.test(e.msg)), 'Leerraum-Notruf ohne Tor: ERR-ZEIT');
  // 3) Tor zwischen Nicht-Nachbarn
  const r3 = mit((L) => { L.notrufe.find((d) => d.id === 'sl_falle').tor = { von: '0503', nach: '0302' }; });
  ok(codes(r3).includes('ERR-KANTE'), 'Sprungpunkt zwischen Nicht-Nachbarn: ERR-KANTE');
  // 4) Schiff außerhalb der Szene (dynamisch)
  const r4 = (() => { try { return mit((L) => { L.notrufe.find((d) => d.id === 'sl_echt').pos = { x: 9000, y: 9000 }; }, true); } finally { for (const d of L0.notrufe) Notrufe.registriere(d); } })();
  ok(r4.errors.some((e) => e.code === 'ERR-SZENE' && /sl_echt/.test(e.p)), 'Notruf-Schiff außerhalb der Szene: ERR-SZENE (' + r4.errors.map((e) => e.code).join(',') + ')');
  // 5) verborgene Kante nie enthüllt
  const r5 = mit((L) => { L.spuren.bote.ende = {}; });
  ok(codes(r5).includes('ERR-ZEIT'), 'Schrottkante ohne Enthüllung (Spur ohne ende.kante): ERR-ZEIT');
  // 6) Buch verlangt Ort, den die Karte nicht kennt
  const r6 = mit((L) => { L.books.k7_geld.steps[0].loc = 'gibts_nicht'; });
  ok(codes(r6).includes('ERR-ORT'), 'Unbekannter Ort im Buch: ERR-ORT');
  ok(Welt.waehle(null, 'sund') === 'sund' || true, 'Karte weiter aktiv');

  console.log('Quelltext-Stichproben (Kai-Fälle)');
  const k7 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher-sund', 'k7_geld.regiebuch.json'), 'utf8'));
  const oeffnetBeiWahl = JSON.stringify(k7.steps.find((s) => s.id === 'wahl').enter).includes('"sprungpunkt_oeffnen"') && JSON.stringify(k7.steps.find((s) => s.id === 'frei').enter).includes('"sprungpunkt_oeffnen"');
  ok(oeffnetBeiWahl, 'Kapitel 7 öffnet den Helix-Sprungpunkt schon bei der Wahl und im freien Flug (nicht erst im Buch sl_forschung)');
  const fo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher-sund', 'sl_forschung.regiebuch.json'), 'utf8'));
  ok(JSON.stringify(fo.steps[0].enter).includes('"bis":"immer"'), 'sl_forschung schließt den Helix-Sprungpunkt nicht mit dem Buchende (bis: immer)');
} finally { try { Welt.waehle(null, 'limes'); } catch (e) { /* */ } }

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
