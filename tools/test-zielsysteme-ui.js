'use strict';
// SUND-04a-1 A: Anzeige der Zielsysteme an den Ops (public/js/zielsysteme.js, Pult, Ziel-Scan): Modell aus Daten und Snapshot, Einbindung in Pult, Taste, Seite.
//   node tools/test-zielsysteme-ui.js
const fs = require('fs');
const path = require('path');
const DATEN = require('../content/kampf/gegner-systeme.json');
const Z = require('../public/js/zielsysteme.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

console.log('[Modell (SYS-01 C1b-2: Systeme je Klasse aus gegner-systeme.json, Zustand aus dem Snapshot)]');
ok(!Z.systemeFuer({ kind: 'korvette', scanned: true }).length && Z.zeilen({}, { kind: 'korvette', scanned: true }).length === 0, 'ohne geladene Daten keine Anzeige (müll-fest)');
Z.store.daten = DATEN;
const vor = { kind: 'korvette', scanned: false }, scan = { kind: 'korvette', scanned: true };
// Snapshot-Zustand wie der Server (ship.zielSys: Code 0 heil, 1 beschädigt, 2 zerstört, je Integrität %; zuletzt der Countdown)
const sysListe = (kind) => DATEN.klassen[kind].systeme;
function snapZiel(kind, besonders, wahl) {
  const zs = [];
  for (const d of sysListe(kind)) { const b = besonders[d.id] || [0, 100]; zs.push(b[0], b[1]); }
  zs.push(-1);
  return { zielSys: zs, zielWahl: wahl || [] };
}
const idx = (kind, id) => sysListe(kind).findIndex((d) => d.id === id);
ok(!Z.systemeFuer(vor).length, 'ungescanntes Ziel: keine Zielsysteme sichtbar');
ok(Z.systemeFuer(scan).includes('antrieb') && Z.systemeFuer(scan).length === sysListe('korvette').length, 'gescanntes Korvette: alle Systeme der Klasse (vorher nur Antrieb)');
ok(Z.systemeFuer({ kind: 'pylon', scanned: true }).length === sysListe('pylon').length && !Z.systemeFuer({ station: true, scanned: true, kind: 'station' }).length, 'Pylon hat Zonensysteme (C1b-2: vorher „nichts“), Station: nichts');
const ziel = Object.assign({}, scan, { kind: 'korvette' });
const st1 = { ship: snapZiel('korvette', { antrieb: [1, 40] }, [idx('korvette', 'antrieb')]) };
const z1 = Z.zeilen(st1, ziel).find((z) => z.id === 'antrieb');
ok(z1.zust === 'besch' && z1.pct === 40 && z1.wahl === true && z1.funktion === 'drive', 'Zustand beschädigt (40 %), Funktion drive (Bernstein), anwählbar (vorher Stufe „beschädigt“)');
const st2 = { ship: snapZiel('korvette', { antrieb: [2, 0] }, []) };
const z2 = Z.zeilen(st2, ziel).find((z) => z.id === 'antrieb');
ok(z2.zust === 'zer' && z2.pct === 0 && z2.wahl === false, 'Zustand zerstört (0 %), nicht anwählbar vom Server (vorher „ausgefallen“)');
ok(Z.antriebZustand({ az: 1 }).schaden && Z.antriebZustand({ az: 2 }).stufe === 2 && !Z.antriebZustand({}).schaden, 'Antrieb am Gegner (az, Karte): beschädigt 1, ausgefallen 2, sonst heil');
const st3 = { ship: snapZiel('korvette', {}, [idx('korvette', 'antrieb')]) };
ok(Z.zeilen(st3, ziel).every((z) => z.zust === 'ok'), 'alle heil: keine Schadenszeile');
ok(Z.zeilen({ ship: { zs: 'antrieb' } }, ziel).length === 0, 'ohne zielSys im Snapshot: keine Zeile');
ok(Z.zeilen({ ship: { zs: 'antrieb', zielSys: [0, 1] } }, ziel).length === 0, 'Snapshot passt nicht zur Klasse: keine Zeile (müll-fest)');
const st4 = { ship: Object.assign(snapZiel('korvette', {}, [idx('korvette', 'antrieb')]), { zs: 'antrieb' }) };
ok(Z.zeilen(st4, ziel).find((z) => z.id === 'antrieb').gewaehlt === true, 'ship.zs markiert das gewählte Systemziel');
const st5 = { ship: Object.assign(snapZiel('korvette', {}, []), { zs: 'unsinn' }) };
ok(Z.zeilen(st5, ziel).every((z) => z.gewaehlt === false), 'unbekanntes Systemziel im Snapshot wird ignoriert');
const st6 = { ship: { zielSys: snapZiel('korvette', { antrieb: [9, 50] }).zielSys, zielWahl: [idx('korvette', 'antrieb')] } };
ok(Z.zeilen(st6, ziel).find((z) => z.id === 'antrieb').zust === 'ok', 'unbekannter Zustandscode wird als heil gelesen (müll-fest; vorher Stufe-Klammer)');

console.log('\n[Einbindung]');
const pult = read('public/js/pult-stationen.js'), kons = read('public/js/consoles.js'), render = read('public/js/render.js');
ok(/'Systemziel', \{ hotkey: '0'/.test(pult) && /aktion: 'ops\.systemziel'/.test(pult) && /fn: 'drive'/.test(pult.split("'Systemziel', { hotkey: '0'")[1].slice(0, 200)), 'Pult: Knopf Systemziel (Taste 0), Aktion ops.systemziel, Funktionsfarbe drive (Bernstein)');
ok(/fn: P\.FN\.drive/.test(pult), 'Zielkasten: Antrieb in Bernstein (P.FN.drive)');
ok(/systemzielWechseln\(view\)/.test(kons) && /Digit0/.test(kons.split('systemzielWechseln(view)')[kons.split('systemzielWechseln(view)').length - 2] || ''), 'Taste 0 ruft systemzielWechseln');
ok(/weapons\.systemziel/.test(kons), 'Befehl weapons.systemziel');
ok(/FLUCHTPUNKT/.test(render) && /space\.vf/.test(render) && /Zielsysteme/.test(render), 'Karte: Fluchtpunkt und Antriebsschaden am Ziel');
const tasten = read('public/js/tasten.js');
ok(/'ops\.systemziel'.*Digit0/.test(tasten), 'Tastenbelegung ops.systemziel (Digit0, Numpad0) in tasten.js');
ok(/zielsysteme\.js/.test(read('public/index.html')) && /zielsysteme-werte\.json/.test(read('server/index.js')), 'index.html lädt das Modul, der Server liefert nur zielsysteme-werte.json aus content/kampf');

console.log('');
console.log('[Captain und Ops-Karte (Review D-S4, D-S8)]');
ok(/'Antrieb aus'/.test(kons) && /'Antrieb beschädigt'/.test(kons) && /antriebZustand\(e\)/.test(kons), 'Captain-Liste GESCANNTE ZIELE: Zeile Antrieb je beschädigtem oder ausgefallenem Ziel (D-S8)');
ok(/zoomY - 1/.test(kons) && /rect\.x \+ rect\.w - 66/.test(kons), 'Ops-Karte: Zoom-Anzeige ist ein Hindernis für die Kartenlabels, Randpfeile weichen aus (D-S4)');
console.log('\n[Layout (SUND-04a-1 Fix4, Prüfbefund 3)]');
const hud = read('public/js/hud.js');
ok(/    fitWort\(str, w, scale\) \{/.test(hud) && /this\.fitWort\(this\.lagefunkZeilenText\(f\)/.test(hud), 'Funk-Zeile oben: Kürzung am Wortende (fitWort), nicht mitten im Wort');
ok(/R\.wrap\(this\.shieldText\(e\), rw - 4, 1\)/.test(kons), 'Captain GESCANNTE ZIELE: Schildzeile bricht am Spaltenrand um (gemessen, nicht abgeschnitten)');
ok(/a\.label !== 'FLUCHTPUNKT'\) continue;[\s\S]{0,300}Math\.hypot\(q\.e\.x - a\.e\.x, q\.e\.y - a\.e\.y\)[\s\S]{0,600}s \* 22 \* tx/.test(render), 'Ops-Karte: Fluchtpunkt-Pfeil rückt bei gleicher Randrichtung entlang des Randes aus');

console.log(`\ntest-zielsysteme-ui: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
