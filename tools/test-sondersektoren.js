#!/usr/bin/env node
'use strict';
// SON-01 A: Daten der Sondersektoren und ihre Prüfer-Regeln (server/sim/sondersektoren.js, Daten content/welt/sondersektoren.json). Jede Regel positiv (echte Daten) und negativ
// (kaputte Kopie im Speicher). SONDERSEKTOREN_DATEI ersetzt die Daten (Mutationsprobe tools/mutation-sondersektoren.js).   Aufruf: node tools/test-sondersektoren.js
const assert = require('assert');
const S = require('../server/sim/sondersektoren.js');

let fehler = 0;
const t = (name, f) => { try { f(); console.log('✓ ' + name); } catch (e) { fehler++; console.log('✗ FEHLER ' + name + ': ' + e.message); } };
const kopie = () => JSON.parse(JSON.stringify(S.alle()));
// Eine Kopie mit einer Änderung muss genau an der erwarteten Regel scheitern
const rot = (aendere, muster) => {
  const d = kopie(); aendere(d[0]);
  const r = S.pruefe(d);
  assert.strictEqual(r.ok, false, 'Prüfer meldet nichts');
  assert(r.fehler.some((x) => muster.test(x)), 'erwartet ' + muster + ', bekommen: ' + r.fehler.join(' | '));
};

t('echte Daten: Prüfer grün, Helix vorhanden', () => {
  const r = S.pruefe(S.alle());
  assert.deepStrictEqual(r.fehler, []);
  const h = S.sektor('helix');
  assert(h && h.hex === '0506' && h.von === '0605' && h.buch === 'sl_forschung' && h.einmal === 'bei_erfolg' && h.ziel.erreichbar_max === 3);
});
t('Zugriff: ids(), sektor(), alle()', () => {
  assert.deepStrictEqual(S.ids(), S.alle().map((s) => s.id));
  assert.strictEqual(S.sektor('gibtesnicht'), null);
  assert.throws(() => { S.laden()[0].hex = 'x'; }, TypeError, 'eingefroren');
});
t('Funkzeilen: höchstens 100 Zeichen mit eingesetzten Platzhaltern, nur {hex} und {ort}, keine Spielernamen-Platzhalter', () => {
  for (const s of S.alle()) {
    const z = [s.ausgang.funk, s.funk.start, s.funk.erfolg, s.funk.verlust];
    for (const x of z) {
      assert(!/\{(?!hex\}|ort\})/.test(x), 'unbekannter Platzhalter: ' + x);
      assert(x.replace(/\{hex\}/g, '0000').replace(/\{ort\}/g, 'Brachland').length <= 100, 'zu lang: ' + x);
    }
  }
});
t('Regel: Pruefer leitet nichts aus Nicht-Liste ab', () => { assert.strictEqual(S.pruefe(null).ok, false); });
const karteKopie = () => JSON.parse(JSON.stringify(require('../content/welt/sund_frei.json')));
t('Regel hex: nicht spielbar (Karte mit spielbar:false) -> rot; Leerraum (0107) -> rot', () => {
  const k = karteKopie(); k.hexe['0506'].spielbar = false;
  const r = S.pruefe(kopie(), k); assert(r.fehler.some((x) => /hex '0506'.*nicht spielbar/.test(x)), r.fehler.join('|'));
  rot((s) => { s.hex = '0107'; }, /hex '0107'.*nicht spielbar/);
});
t('Regel von/ausgang.hex: unspielbar in der Karte -> rot', () => {
  const k = karteKopie(); k.hexe['0605'].spielbar = false;
  const r = S.pruefe(kopie(), k); assert(r.fehler.some((x) => /von '0605'/.test(x)), r.fehler.join('|'));
  const k2 = karteKopie(); k2.hexe['0505'].spielbar = false;
  const r2 = S.pruefe(kopie(), k2); assert(r2.fehler.some((x) => /ausgang.hex '0505'/.test(x)), r2.fehler.join('|'));
});
t('Regel hex: Leerraum/ohne Hex-Format -> rot', () => rot((s) => { s.hex = 'abcd'; }, /hex 'abcd'/));
t('Regel hex: nicht Nachbar von von (0605 -> 0101) -> rot', () => rot((s) => { s.hex = '0101'; }, /hex '0101'/));
t('Regel von: kein geometrischer Nachbar -> rot', () => rot((s) => { s.von = '0705'; }, /von '0705'.*kein geometrischer Nachbar/));
t('Regel von: Hex außerhalb der Karte -> rot', () => rot((s) => { s.von = '9999'; }, /von '9999'.*kein Hex der Karte/));
t('Regel von: Nachbar ohne Karten-Sektor (Leerraum 0507) -> rot', () => rot((s) => { s.von = '0507'; }, /von '0507'/));
t('Regel buch: fehlt im Katalog -> rot', () => rot((s) => { s.buch = 'sl_gibtesnicht'; }, /buch 'sl_gibtesnicht' fehlt im Regiebuch-Katalog/));
t('Regel buch: leer -> rot', () => rot((s) => { s.buch = ''; }, /buch fehlt/));
t('Regel buch: positiv, Buch ohne Punkt in der id (sl_gasriese) -> grün', () => {
  const d = kopie(); d[0].buch = 'sl_gasriese'; assert.deepStrictEqual(S.pruefe(d).fehler, []);
});
t('Regel einmal: unbekannter Wert -> rot', () => rot((s) => { s.einmal = 'nie'; }, /einmal 'nie' unbekannt/));
t('Regel ausgang.hex: Leerraum ohne Ort (0507) -> rot', () => rot((s) => { s.ausgang.hex = '0507'; }, /ausgang\.hex '0507'/));
t('Regel ausgang.hex: Leerraum (0302) -> rot', () => rot((s) => { s.ausgang.hex = '0302'; }, /ausgang\.hex '0302'/));
t('Regel ausgang.hex: der Sondersektor selbst -> rot', () => rot((s) => { s.ausgang.hex = '0506'; }, /darf nicht der Sondersektor selbst sein/));
t('Regel ausgang.hex: andere spielbare Nachbarn mit Szene (0605, 0606) -> grün', () => {
  for (const h of ['0605', '0606']) { const d = kopie(); d[0].ausgang.hex = h; assert.deepStrictEqual(S.pruefe(d).fehler, [], h); }
});
t('Regel ausgang.funk / funk.*: leer -> rot', () => {
  rot((s) => { s.ausgang.funk = ''; }, /ausgang\.funk fehlt/);
  for (const k of ['start', 'erfolg', 'verlust']) rot((s) => { delete s.funk[k]; }, new RegExp('funk\.' + k + ' fehlt'));
});
t('Regel ausgang: fehlt -> rot', () => rot((s) => { delete s.ausgang; }, /ausgang fehlt/));
t('Regel ids: doppelte id -> rot; fehlende/ungültige id -> rot', () => {
  const d = kopie(); d.push(JSON.parse(JSON.stringify(d[0])));
  const r = S.pruefe(d); assert(r.fehler.some((x) => /id kommt mehrfach vor/.test(x)), r.fehler.join('|'));
  rot((s) => { s.id = 'Helix X'; }, /kein Name/);
});
t('Regel ziel.erreichbar_max: 0, 2.5, "3", fehlend -> rot; 1 und 5 -> grün', () => {
  for (const v of [0, 2.5, '3', -1]) rot((s) => { s.ziel.erreichbar_max = v; }, /ziel\.erreichbar_max/);
  rot((s) => { delete s.ziel; }, /ziel\.erreichbar_max/);
  for (const v of [1, 5]) { const d = kopie(); d[0].ziel.erreichbar_max = v; assert.deepStrictEqual(S.pruefe(d).fehler, [], String(v)); }
});
t('Prüfer stellt die vorherige Karte wieder her', () => {
  const Sektoren = require('../shared/sektoren.js');
  const vorher = Sektoren.KARTE; S.pruefe(S.alle()); assert.strictEqual(Sektoren.KARTE, vorher);
});

console.log(fehler ? `${fehler} Fehler.` : 'Alle Prüfungen grün.');
process.exit(fehler ? 1 : 0);
