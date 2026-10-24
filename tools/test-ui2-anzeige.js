'use strict';
// SUND-02b UI2 (Designer-Review A2, D, E): Anzeigelogik ohne Browser.
//   1. Ops-Feld „Posten“ (public/js/posten-anzeige.js): Zustände gesperrt/bereit/Anfrage/Bestätigen, einheitliche Weigerung, zwei deutlich verschiedene Verrat-Zustände,
//      Fristbalken, Doppelklick-Sperre, gleicher Suchname des Knopfs.
//   2. Halte-Leiste: Kopf mit Fortschritt, Abbruchzeile passt in die 266 px breite Leiste.
//   3. Szenenzeile (public/js/hud.js): rechte Grenze an den Konsolen (Ops-Karte/Zielkasten) und im Captain-Funk-Reiter (MISSION), sonst wie vorher.
//   4. Lagefunk-Zeile an der Ops: Unterkante für die Zoom-Beschriftung; Modus-Ende räumt eine laufende Lagemeldung.
//   5. Texte: die Anfrage des Verrats nennt den Knopf (es gibt keine Taste dafür).
//   node tools/test-ui2-anzeige.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PA = require('../public/js/posten-anzeige.js');
const VERRAT = require('../content/flotte/verrat.json');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n[' + t + ']'); return f(); };
// Breite der Spielschrift bei Maßstab 1: gemessen an den Bildern (33 Zeichen = 175 px), großzügig aufgerundet
const PX = 5.3, LEISTE = 266 - 8;
const breite = (s) => String(s).length * PX;

section('Ops-Feld: gesperrt sieht bei allen vier Arten gleich aus', () => {
  ok(PA.feld(null) === null && PA.feld({}) === null && PA.feld({ k: 'q', ok: true }) === null, 'ohne oder mit unbekanntem Block: kein Feld');
  for (const k of ['g', 'a', 'x', 'v']) {
    const F = PA.feld({ k, ok: false, t: 'Grund ' + k });
    ok(F && F.zustand === 'gesperrt' && F.rahmen === 'messing' && F.fn === null && F.aktiv === false && F.grund === 'Grund ' + k && F.zeilen.length === 0 && F.cmd === PA.ART[k].cmd,
      k + ': gesperrt = Messingrahmen, kein Funktionsknopf, Weigerungstext als Grund (vorher beim Verrat roter Rahmen)');
  }
  const G = PA.feld({ k: 'g', ok: true, n: 2 });
  ok(G.zustand === 'bereit' && G.fn === 'shield' && G.aktiv && G.rahmen === 'mint' && G.kosten === 2, 'Gründen möglich: Mint, aktiv, Kosten 2');
});

section('Verrat: zwei deutlich verschiedene Zustände, nie versehentlich', () => {
  const A = PA.feld({ k: 'v', ok: true });
  const B = PA.feld({ k: 'v', ok: true, b: 5 }, 5);
  ok(A.zustand === 'anfrage' && A.fn === null && !A.aktiv && A.rahmen === 'gefahr' && A.zeilen.length === 1 && A.zeilen[0].farbe === 'gefahr' && A.frist === null,
    'Anfrage: neutraler Knopf, Warnzeile in Gefahrfarbe schon vor dem Druck, kein Fristbalken');
  ok(B.zustand === 'bestaetigen' && B.fn === 'weapon' && B.aktiv && /^BESTÄTIGEN/.test(B.knopf) && /5 s$/.test(B.knopf) && B.zeilen.length === 2 && B.frist === 1,
    'Bestätigen: roter Knopf mit Rahmen, Großschrift, Restsekunden, zweite Zeile, voller Fristbalken');
  const unterschiede = ['fn', 'aktiv', 'knopf', 'frist'].filter((k) => A[k] !== B[k]).length + (A.zeilen.length !== B.zeilen.length ? 1 : 0);
  ok(unterschiede >= 4, 'die Zustände unterscheiden sich in ' + unterschiede + ' Merkmalen (Farbe, Rahmen, Text, Balken, Zeilen): nicht nur über die Farbe');
  ok(B.zeilen.some((z) => z.farbe === 'hinweis') && B.zeilen.some((z) => z.farbe === 'gefahr'), 'Bestätigen: Hinweis hell und Warnung in Gefahrfarbe');
  ok(PA.feld({ k: 'v', ok: true, b: 2 }, 5).frist === 0.4 && PA.feld({ k: 'v', ok: true, b: 3 }).frist === 1 && PA.feld({ k: 'v', ok: true, b: 2.2 }, 5).knopf.endsWith('3 s'), 'Fristbalken läuft ab (2 von 5 s = 0,4), ohne b0 voll, Restsekunden aufgerundet');
  ok(PA.feld({ k: 'v', ok: true, b: 0 }).zustand === 'anfrage' && PA.feld({ k: 'v', ok: true, b: -3 }).zustand === 'anfrage' && PA.feld({ k: 'v', ok: true, b: 'x' }).zustand === 'anfrage', 'b 0, negativ oder Müll: Anfrage (kein falsches Bestätigen)');
  ok(PA.feld({ k: 'v', ok: false, t: 'An Roms Hauptwelt gibt es keinen Verrat.', b: 4 }).zustand === 'gesperrt', 'gesperrt hat Vorrang vor b');
  ok(PA.ART.v.knopf === 'Römische Schiffe angreifen', 'Suchname des Knopfs bleibt in beiden Zuständen „Römische Schiffe angreifen“ (Consoles.tryButton)');
  ok(PA.klickZaehlt(undefined, 10) && !PA.klickZaehlt(10, 10.3) && !PA.klickZaehlt(10, 10 + PA.KLICK_SPERRE - 0.01) && PA.klickZaehlt(10, 10 + PA.KLICK_SPERRE), 'Doppelklick: der zweite Druck binnen ' + PA.KLICK_SPERRE + ' s zählt nicht, danach schon');
  for (const F of [A, B]) for (const z of F.zeilen) ok(breite(z.text) <= LEISTE, '„' + z.text + '“ passt in die Leiste (' + Math.round(breite(z.text)) + ' ≤ ' + LEISTE + ' px)');
  ok(breite(B.knopf) <= 266 - 6 - 10, 'Knopftext „' + B.knopf + '“ passt in den Knopf');
});

section('Halte-Leiste: kurz genug, Fortschritt im Kopf', () => {
  ok(PA.halt(null) === null && PA.halt({ kind: 'ab', p: 0.5 }) === null, 'nur für Posten-Halteprozesse');
  for (const id of ['gruenden', 'ausbau', 'angreifen', 'verrat']) {
    const H = PA.halt({ kind: 'posten', id, p: 0.374 });
    ok(H && / · 37 %$/.test(H.kopf) && breite(H.kopf) <= LEISTE && breite(H.hinweis) <= LEISTE, id + ': „' + H.kopf + '“ / „' + H.hinweis + '“ passen in ' + LEISTE + ' px');
  }
  const V = PA.halt({ kind: 'posten', id: 'verrat', p: 2 });
  ok(V.kopf === 'HOCHVERRAT AN ROM · 100 %' && V.kopfFarbe === 'gefahr' && /Abbruch kostenlos/.test(V.hinweis), 'Verrat: Gefahrfarbe, „Abbruch kostenlos“, Fortschritt geklemmt');
  ok(PA.halt({ kind: 'posten', id: 'gruenden', p: 0.5 }).kopfFarbe === 'mint' && PA.halt({ kind: 'posten', id: '??', p: 0 }).kopf === 'POSTEN GRÜNDEN · 0 %', 'Gründen Mint; unbekannte id fällt auf Gründen zurück');
});

section('Szenenzeile und Lagefunk-Zeile (hud.js)', () => {
  const ctx2d = new Proxy({ fillStyle: '' }, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : k === 'fillStyle' ? t.fillStyle : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { t[k] = v; return true; } });
  const Render = { PAL: new Proxy({}, { get: () => '#fff' }), measure: (s) => String(s).length * 5, wrap: (s) => [String(s)], panel() {}, text() {}, backdrop() {}, art: () => false, itemFallback() {}, ui: { buttons: [] } };
  let jetzt = 1000;
  const lauscher = [];
  const win = { Render, Shared_Maps: {}, Shared_Config: {}, Shared_Protocol: {}, performance: { now: () => jetzt * 1000 }, location: { search: '' }, console, Net: { on: (f) => lauscher.push(f) },
    document: { createElement: () => ({ getContext: () => ctx2d, style: {} }), querySelector: () => null, getElementById: () => null, addEventListener() {} } };
  win.window = win; win.self = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hud.js'), 'utf8'), win, { filename: 'hud.js' });
  const Hud = win.Hud;
  const v = (konsole, sz) => ({ me: { console: konsole }, self: { zone: 'ship' }, time: 0, state: { flotte: sz ? { sz, wl: [1, 3] } : {}, mission: {} } });
  ok(Hud.szeneStripX(v('weapons'), 150) === Hud.SZ_X_KONSOLE, 'Konsole, schmale Zeile: x wie vorher (' + Hud.SZ_X_KONSOLE + ')');
  const w = 232; const xk = Hud.szeneStripX(v('weapons'), w);
  ok(xk + w <= Hud.SZ_X_RECHTS && xk < Hud.SZ_X_KONSOLE, 'Konsole, „ANGRIFF AUF POSTEN · WELLE 1/3 · 1 Gegner“ (' + w + ' px): endet bei ' + (xk + w) + ' ≤ ' + Hud.SZ_X_RECHTS + ' (vorher 496, über „ZIEL“)');
  win.Consoles = { tab: 0 };
  const xf = Hud.szeneStripX(v('captain'), w);
  ok(xf + w <= Hud.SZ_X_RECHTS_FUNK, 'Captain-Funk-Reiter: endet bei ' + (xf + w) + ' ≤ ' + Hud.SZ_X_RECHTS_FUNK + ' (vorher 436, über MISSION)');
  ok(Hud.szeneStripX(v('captain'), 150) === 320 - 75, 'Captain-Funk-Reiter, schmale Zeile: mittig wie vorher');
  win.Consoles = { tab: 1 };
  ok(Hud.szeneStripX(v('captain'), w) === xk, 'Captain, anderer Reiter: wie die Konsolen');
  ok(Hud.szeneStripX(v(null), w) === Math.round(320 - w / 2), 'HUD (ohne Konsole): mittig wie vorher');
  // Lagefunk-Zeile an der Ops
  Hud.radioFlash = null; Hud.radioNach = null;
  ok(Hud.funkZeileUnten(v('weapons')) === 0, 'ohne Lagemeldung: 0 (Zoom-Zeile wie vorher)');
  Hud.onRadio('Oberkommando', 'Rom bietet Euch einen Kurs an.', null, true, 'Kurs');
  ok(Hud.funkZeileUnten(v('weapons')) === 11 && Hud.funkZeileUnten(v('weapons', { p: 'k', g: 1 })) === 9 && Hud.funkZeileUnten(v('helm')) === 0, 'Ops mit Lagemeldung: 11 (mit Szenenzeile 9), andere Plätze 0');
  // Modus-Ende
  ok(lauscher.length === 1, 'hud.js hört auf Net (Löschsignal des Modus)');
  ok(Hud.modusEnde({ t: 'snap', world: { lage: {} } }) === false && Hud.radioAktuell() && Hud.radioAktuell().lage, 'gewöhnlicher Snapshot: Lagemeldung bleibt');
  lauscher[0]({ t: 'snap', world: { absicht: null } });
  ok(Hud.radioAktuell() === null, 'world.absicht = null (Modus endet): die Lagemeldung „Rom bietet Euch …“ verschwindet sofort (vorher noch bis zu 7 s)');
  Hud.onRadio('Oberkommando', 'Lage', null, true); Hud.onRadio('Mars', 'Normaler Funkspruch.', null, false);
  Hud.modusEnde({ t: 'snap', world: { ruf: null } });
  const nach = Hud.radioAktuell();
  ok(nach && !nach.lage && nach.text === 'Normaler Funkspruch.', 'world.ruf = null: Lagemeldung weg, der zurückgestellte normale Funkspruch kommt');
  ok(Hud.modusEnde({ t: 'snap', world: { ruf: null } }) === false && Hud.radioAktuell() === nach, 'ein normaler Funkspruch bleibt beim Löschsignal stehen');
  ok(Hud.modusEnde(null) === false && Hud.modusEnde({ t: 'welcome' }) === false && Hud.modusEnde({ t: 'snap', world: { ruf: { rom: 3 } } }) === false, 'Müll, welcome, Ruf-Block: nichts');
});

section('Texte', () => {
  ok(/Knopf/.test(VERRAT.anfrage) && !/Taste/.test(VERRAT.anfrage) && /\{sek\}/.test(VERRAT.anfrage), 'Anfrage des Verrats nennt den Knopf an der Ops (es gibt keine Taste), {sek} bleibt');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  ok(html.indexOf('js/posten-anzeige.js') > 0 && html.indexOf('js/posten-anzeige.js') < html.indexOf('js/consoles.js'), 'index.html lädt posten-anzeige.js vor consoles.js');
});

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen ok'));
process.exit(fails ? 1 : 0);
