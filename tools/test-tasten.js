'use strict';
// Tastenbelegung als Daten (public/js/tasten.js): passt/welche/kappe, Shift-Exaktheit, Speichern/Zurücksetzen,
// Konflikte, Ops-Waffen auf Ziffernblock + obere Reihe, keine Standardkonflikte.   node tools/test-tasten.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tasten.js'), 'utf8');
function speicher(start, kaputt) {
  const d = Object.assign({}, start || {});
  return {
    d,
    getItem(k) { if (kaputt) throw new Error('gesperrt'); return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
    setItem(k, v) { if (kaputt) throw new Error('gesperrt'); d[k] = String(v); },
    removeItem(k) { if (kaputt) throw new Error('gesperrt'); delete d[k]; },
  };
}
function lade(ls) {
  const window = { localStorage: ls };
  vm.runInNewContext(SRC, { window, console }, { filename: 'tasten.js' });
  return window.Tasten;
}
const ev = (code, shift) => ({ code, shiftKey: !!shift });

section('Grundlagen');
let ls = speicher();
let T = lade(ls);
ok(Array.isArray(T.AKTIONEN) && T.AKTIONEN.length > 50, 'AKTIONEN geladen (' + T.AKTIONEN.length + ')');
const GR = ['steuer', 'ops', 'technik', 'captain', 'allgemein'];
ok(T.AKTIONEN.every((a) => GR.includes(a.gruppe) && a.id && a.name && Array.isArray(a.std) && a.std.length), 'jede Aktion hat Gruppe, Name und Standardtasten');
ok(new Set(T.AKTIONEN.map((a) => a.id)).size === T.AKTIONEN.length, 'ids eindeutig');
ok(T.AKTIONEN.every((a) => a.std.every((t) => /^(Shift\+)?[A-Za-z0-9]+$/.test(t))), 'Standardtasten haben die Form [Shift+]code');
ok(T.AKTIONEN.every((a) => !a.bereich || T.BEREICHE[a.bereich]), 'jeder Bereich ist benannt');
for (const g of GR.slice(0, 4)) ok(T.AKTIONEN.some((a) => a.gruppe === g), 'Gruppe ' + g + ' hat Aktionen');

section('passt / Shift-Exaktheit');
ok(T.passt(ev('KeyT'), 'ops.ziel'), 'T passt auf ops.ziel');
ok(!T.passt(ev('KeyT', true), 'ops.ziel'), 'Shift+T passt NICHT auf ops.ziel');
ok(T.passt(ev('KeyA', true), 'steuer.ausweichenBb'), 'Shift+A passt auf Ausweichen Bb');
ok(!T.passt(ev('KeyA'), 'steuer.ausweichenBb'), 'A ohne Shift passt nicht auf Ausweichen Bb');
ok(T.passt(ev('KeyA'), 'steuer.ruderBb') && !T.passt(ev('KeyA', true), 'steuer.ruderBb'), 'Ruder Bb nur ohne Shift');
ok(!T.passt(ev('ShiftLeft', true), 'steuer.ausweichenBb'), 'reine Shift-Taste passt nie');
ok(!T.passt(ev('KeyT'), 'gibt.es.nicht'), 'unbekannte id: false');
ok(T.passt(ev('Numpad8'), 'ops.waffe.vorn1') && T.passt(ev('Digit8'), 'ops.waffe.vorn1'), 'Frontwaffe 1 auf Num 8 und 8');
ok(T.loslassen(ev('Numpad8', true), 'ops.waffe.vorn1'), 'loslassen ignoriert Shift');
ok(T.gehalten({ KeyA: true }, 'steuer.ruderBb') && !T.gehalten({ KeyA: true, ShiftLeft: true }, 'steuer.ruderBb'), 'gehalten: Ruder nur ohne Shift');
ok(T.gehalten({ KeyA: true, ShiftRight: true }, 'steuer.ausweichenBb'), 'gehalten: Shift+A');

section('welche');
ok(T.welche(ev('KeyT'), 'ops') === 'ops.ziel', 'welche(T, ops) = ops.ziel');
ok(T.welche(ev('Tab'), 'ops') === 'allgemein.station', 'welche(Tab, ops) = allgemein.station');
ok(T.welche(ev('Tab', true), 'captain') === 'allgemein.stationZurueck', 'welche(Shift+Tab) = Station zurück');
ok(T.welche(ev('Escape'), 'steuer') === 'allgemein.verlassen', 'welche(Esc) = verlassen');
ok(T.welche(ev('KeyT'), 'steuer') === null, 'welche(T, steuer) = null');
ok(T.welche(ev('KeyX'), 'ops') === 'ops.markerLoeschen', 'welche(X, ops) ohne Bereich: Marker löschen (erste in der Liste)');
ok(T.welche(ev('KeyX'), 'ops', 'ops.fracht') === 'ops.fracht.abwerfen', 'welche(X, ops, fracht) = Ladung abwerfen');
ok(T.welche(ev('KeyQ'), 'captain', 'captain.notruf') === 'captain.notruf.frage1', 'welche(Q, captain, notruf) = Frage 1');
ok(T.welche(ev('Digit3'), 'captain', 'captain.notruf') === 'captain.reiter3', 'welche(3, captain, notruf) fällt auf Reiter zurück');

section('kappe / name');
ok(T.kappe('ops.ziel') === 'T', "kappe ops.ziel = 'T'");
ok(T.kappe('steuer.ausweichenBb') === 'Sh+A', "kappe Ausweichen Bb = 'Sh+A'");
ok(T.kappe('ops.waffe.vorn1') === '8', "kappe Num 8 = '8'");
ok(T.kappe('captain.reiter1') === '1', "kappe Digit1 = '1'");
ok(T.kappe('ops.waffe.beideSeiten') === 'Leer', "kappe Space = 'Leer'");
ok(T.kappe('allgemein.verlassen') === 'Esc' && T.kappe('allgemein.station') === 'Tab', 'kappe Esc/Tab');
ok(T.kappe('ops.glyphen.hoch') === '↑' && T.kappe('ops.glyphen.links') === '←', 'kappe Pfeile');
ok(T.kappe('captain.funk.annehmen') === 'Ent', "kappe Enter = 'Ent'");
ok(T.name('Numpad8') === 'Num 8' && T.name('Digit8') === '8' && T.name('Shift+KeyA') === 'Shift+A', 'name unterscheidet Ziffernblock');
// Die Pixelschrift muss jede Kappe zeichnen können (Glyphentabelle in art.js)
const art = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'art.js'), 'utf8');
const gStart = art.indexOf('var GLYPHS = {'), gEnd = art.indexOf('var glyphData', gStart);
const glyphen = new Set([...art.slice(gStart, gEnd).matchAll(/^\s*'((?:[^'\\]|\\.)+)'\s*:/gm)].map((m) => m[1].replace(/\\(.)/g, '$1')));
glyphen.add(' ');
const fehlend = new Set();
for (const a of T.AKTIONEN) for (const t of a.std) for (const ch of T.kappeVon(t) + T.name(t)) if (!glyphen.has(ch) && !glyphen.has(ch.toUpperCase())) fehlend.add(ch);
ok(glyphen.size > 60, 'Glyphentabelle gelesen (' + glyphen.size + ' Zeichen)');
ok(fehlend.size === 0, 'alle Kappen/Namen in der Pixelschrift' + (fehlend.size ? ' – fehlt: ' + [...fehlend].join(' ') : ''));

section('Ops-Waffen');
const WAFFEN = { vorn1: 8, vorn2: 5, heck: 2, bb1: 4, stb1: 6, bb2: 7, stb2: 9, bb3: 1, stb3: 3 };
for (const [k, d] of Object.entries(WAFFEN)) {
  const b = T.belegung('ops.waffe.' + k);
  ok(b[0] === 'Numpad' + d && b.includes('Digit' + d), 'ops.waffe.' + k + ' = Num ' + d + ' + ' + d);
}
ok(T.belegung('ops.waffe.beideSeiten').join() === 'Space', 'beide Batterien = Leertaste');
ok(T.belegung('ops.waffeZurueck')[0] === 'KeyQ' && T.belegung('ops.waffeVor')[0] === 'KeyE', 'Q/E Waffe wählen');
ok(T.belegung('ops.ladenWeniger')[0] === 'KeyA' && T.belegung('ops.ladenMehr')[0] === 'KeyD', 'A/D Ladepunkte');

section('keine Standardkonflikte');
for (const g of GR) { const k = T.konflikte(g); ok(k.length === 0, 'Gruppe ' + g + ' ohne Konflikte' + (k.length ? ': ' + k.map((x) => x.taste + '=' + x.ids.join('/')).join(', ') : '')); }

section('Ändern, Speichern, Zurücksetzen');
ok(ls.d['pantheon.tasten'] == null, 'Standard: nichts gespeichert');
ok(T.setze('ops.ziel', 0, 'KeyG'), 'setze ops.ziel[0] = G');
ok(T.passt(ev('KeyG'), 'ops.ziel') && !T.passt(ev('KeyT'), 'ops.ziel'), 'G statt T');
ok(T.geaendert('ops.ziel'), 'geaendert(ops.ziel)');
ok(JSON.parse(ls.d['pantheon.tasten'])['ops.ziel'].join() === 'KeyG', 'nur die Abweichung gespeichert');
ok(Object.keys(JSON.parse(ls.d['pantheon.tasten'])).length === 1, 'genau eine Abweichung');
T.setze('ops.ziel', 1, 'Shift+KeyT');
ok(T.belegung('ops.ziel').join() === 'KeyG,Shift+KeyT', 'zweite Belegung angehängt');
const T2 = lade(ls);
ok(T2.belegung('ops.ziel').join() === 'KeyG,Shift+KeyT', 'neu geladen: Belegung bleibt');
ok(T2.passt(ev('KeyT', true), 'ops.ziel') && !T2.passt(ev('KeyT'), 'ops.ziel'), 'neu geladen: Shift+T passt, T nicht');
T.setze('ops.ziel', 1, null);
ok(T.belegung('ops.ziel').join() === 'KeyG', 'setze(…, null) entfernt');
T.setze('ops.ziel', 0, 'KeyT');
ok(!T.geaendert('ops.ziel') && ls.d['pantheon.tasten'] == null, 'zurück auf std: Abweichung gelöscht');
ok(!T.setze('ops.ziel', 0, 'Kaputt Taste') && !T.setze('gibt.es.nicht', 0, 'KeyA'), 'ungültige Taste/id abgelehnt');
T.setze('ops.ziel', 5, 'KeyT');
ok(T.belegung('ops.ziel').join() === 'KeyT', 'dieselbe Taste nicht doppelt in einer Aktion');

section('Konflikterkennung');
T.setze('ops.ziel', 0, 'KeyR');   // R = Nachladen
let k = T.konflikte('ops');
ok(k.length === 1 && k[0].taste === 'KeyR' && k[0].ids.includes('ops.ziel') && k[0].ids.includes('ops.nachladen'), 'R doppelt: Ziel/Nachladen erkannt');
ok(T.konflikte('steuer').length === 0, 'andere Gruppe unberührt');
T.setze('steuer.allstopp', 0, 'Tab');
k = T.konflikte('steuer');
ok(k.some((x) => x.taste === 'Tab' && x.ids.includes('allgemein.station')), 'Konflikt mit allgemein (Tab) erkannt');
T.setze('captain.funk.abhoeren', 0, 'KeyM');   // M ist Sternkarte-Ansicht, aber anderer Reiter
ok(T.konflikte('captain').length === 0, 'gleiche Taste in verschiedenen Reitern ist kein Konflikt');
T.setze('captain.funk.abhoeren', 0, 'Digit2');   // Ziffern schalten in jedem Reiter den Reiter
ok(T.konflikte('captain').some((x) => x.taste === 'Digit2'), 'Reiter-Taste im Reiter belegt: Konflikt');
T.setze('ops.fracht.verkaufen', 0, 'KeyT');   // Fracht hat Vorrang (wird zuerst geprüft): kein Konflikt mit Basis
ok(!T.konflikte('ops').some((x) => x.taste === 'KeyT'), 'Vorrang-Bereich (Fracht) zählt nicht gegen die Basis');
T.setze('ops.fracht.verkaufen', 0, 'KeyF');   // F = Fracht beamen im selben Bereich
ok(T.konflikte('ops').some((x) => x.taste === 'KeyF'), 'Konflikt innerhalb des Vorrang-Bereichs erkannt');

section('zuruecksetzen');
T.zuruecksetzen('ops');
ok(T.konflikte('ops').length === 0 && !T.geaendert('ops.ziel'), 'zuruecksetzen(ops): Gruppe sauber');
ok(T.geaendert('steuer.allstopp') && T.geaendert('captain.funk.abhoeren'), 'andere Gruppen bleiben geändert');
T.zuruecksetzen('steuer.allstopp');
ok(!T.geaendert('steuer.allstopp'), 'zuruecksetzen(id)');
T.zuruecksetzen();
ok(T.AKTIONEN.every((a) => !T.geaendert(a.id)) && ls.d['pantheon.tasten'] == null, 'zuruecksetzen(): alles Standard, Speicher leer');

section('Speicher kaputt / Müll');
const Tk = lade(speicher({}, true));
ok(Tk.passt(ev('KeyT'), 'ops.ziel'), 'gesperrter localStorage: lädt mit Standard');
ok(Tk.setze('ops.ziel', 0, 'KeyG') && Tk.passt(ev('KeyG'), 'ops.ziel') && Tk.gespeichert() === false, 'gesperrt: gilt bis Neuladen, gespeichert() = false');
const Tm = lade(speicher({ 'pantheon.tasten': '{kaputt' }));
ok(Tm.passt(ev('KeyT'), 'ops.ziel'), 'kaputtes JSON: Standard');
const Tu = lade(speicher({ 'pantheon.tasten': JSON.stringify({ 'ops.ziel': ['KeyG', 42, 'a b'], 'weg.damit': ['KeyA'] }) }));
ok(Tu.belegung('ops.ziel').join() === 'KeyG' && Tu.belegung('weg.damit').length === 0, 'ungültige Einträge verworfen');
const Tn = lade({ localStorage: undefined }.localStorage);
ok(Tn.passt(ev('KeyT'), 'ops.ziel'), 'ohne localStorage: Standard');

console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLGESCHLAGEN' : 'alle ' + n + ' Prüfungen ok'));
process.exit(fails ? 1 : 0);
