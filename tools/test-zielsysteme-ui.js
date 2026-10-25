'use strict';
// SUND-04a-1 A: Anzeige der Zielsysteme an den Ops (public/js/zielsysteme.js, Pult, Ziel-Scan): Modell aus Daten und Snapshot, Einbindung in Pult, Taste, Seite.
//   node tools/test-zielsysteme-ui.js
const fs = require('fs');
const path = require('path');
const DATEN = require('../content/kampf/zielsysteme-werte.json').werte;
const Z = require('../public/js/zielsysteme.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

console.log('[Modell]');
ok(!Z.systemeFuer({ kind: 'korvette', scanned: true }).length && Z.zeilen({}, { kind: 'korvette', scanned: true }).length === 0, 'ohne geladene Daten keine Anzeige (müll-fest)');
Z.store.werte = DATEN;
const vor = { kind: 'korvette', scanned: false }, scan = { kind: 'korvette', scanned: true }, kaputt = { kind: 'korvette', scanned: true, az: 1 }, aus = { kind: 'korvette', scanned: true, az: 2 };
ok(!Z.systemeFuer(vor).length, 'ungescanntes Ziel: keine Zielsysteme sichtbar');
ok(Z.systemeFuer(scan).join() === 'antrieb' && !Z.systemeFuer({ kind: 'pylon', scanned: true }).length && !Z.systemeFuer({ station: true, scanned: true, kind: 'station' }).length, 'gescanntes Ziel mit Antrieb: antrieb; Pylon und Station: nichts');
const z0 = Z.zustand(scan, 'antrieb'), z1 = Z.zustand(kaputt, 'antrieb'), z2 = Z.zustand(aus, 'antrieb');
ok(z0.text === 'voll' && !z0.schaden && z1.text === 'beschädigt' && z1.schaden && z2.text === 'ausgefallen' && z2.faktor === 0 && z2.funktion === 'antrieb', 'Zustand: voll, beschädigt, ausgefallen mit Funktion antrieb (Bernstein im Pult)');
ok(Z.zustand(Object.assign({}, aus, { scanned: false }), 'antrieb').stufe === 0, 'ungescannt: der Schaden bleibt verborgen');
ok(Z.zeilen({ ship: { zs: 'antrieb' } }, kaputt)[0].gewaehlt === true && Z.zeilen({ ship: {} }, kaputt)[0].gewaehlt === false, 'ship.zs markiert das gewählte Systemziel');
ok(Z.gewaehlt({ ship: { zs: 'unsinn' } }) === null, 'unbekanntes Systemziel im Snapshot wird ignoriert');
ok(Z.stufe({ kind: 'korvette', scanned: true, az: 99 }, 'antrieb') === DATEN.systeme.wert.antrieb.stufen.length - 1, 'Stufe wird auf die letzte begrenzt (müll-fest)');

console.log('\n[Einbindung]');
const pult = read('public/js/pult-stationen.js'), kons = read('public/js/consoles.js'), render = read('public/js/render.js');
ok(/'Systemziel'/.test(pult) && /aktion: 'ops\.systemziel'/.test(pult) && /fn: 'drive'/.test(pult.split("'Systemziel'")[1].slice(0, 200)), 'Pult: Knopf Systemziel, Aktion ops.systemziel, Funktionsfarbe drive (Bernstein)');
ok(/fn: P\.FN\.drive/.test(pult), 'Zielkasten: Antrieb in Bernstein (P.FN.drive)');
ok(/systemzielWechseln\(view\)/.test(kons) && /Digit0/.test(kons.split('systemzielWechseln(view)')[kons.split('systemzielWechseln(view)').length - 2] || ''), 'Taste 0 ruft systemzielWechseln');
ok(/weapons\.systemziel/.test(kons), 'Befehl weapons.systemziel');
ok(/FLUCHTPUNKT/.test(render) && /space\.vf/.test(render) && /Zielsysteme/.test(render), 'Karte: Fluchtpunkt und Antriebsschaden am Ziel');
const tasten = read('public/js/tasten.js');
ok(/'ops\.systemziel'.*Digit0/.test(tasten), 'Tastenbelegung ops.systemziel (Digit0, Numpad0) in tasten.js');
ok(/zielsysteme\.js/.test(read('public/index.html')) && /zielsysteme-werte\.json/.test(read('server/index.js')), 'index.html lädt das Modul, der Server liefert nur zielsysteme-werte.json aus content/kampf');

console.log(`\ntest-zielsysteme-ui: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
