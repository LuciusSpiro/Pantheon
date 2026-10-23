'use strict';
// SUND-02a C + Client-Runde (M1, M2, S5, S6): Lagefunk-Einblendung (public/js/hud.js) mit Attrappen für Render/Karte im vm.
//   1. Das Feld an Konsole/Terminal liegt unter deren Kopfzeile (LAGEFUNK_Y 44, vorher 6/16 über dem Kopf).
//   2. Ein normaler Funkspruch verdrängt eine laufende Lagemeldung nicht: an der Konsole bleibt sie sichtbar, im HUD steht sie unter dem Funkspruch,
//      und ein Funkspruch, der während der Lagemeldung eintrifft, wird zurückgestellt und danach eingeblendet.
//   3. Client-Runde S5: am Hafenterminal (Handel/Werft) einzeilig über der Kopfzeile, auf der Sternkarte des Captains (Lage) keine Tafel.
//   4. Client-Runde S6: die Notrückholungs-Tafel sitzt unter der Unterkante ALLER Funktafeln (Missionsfunk + Lagemeldung).
//   5. Client-Runde M2: Szenenzeile (state.flotte.sz) ersetzt VERBÜNDET/BEFEHL; Inhalt je Phase.
//   node tools/test-lagefunk.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const rects = [];   // fillRect-Aufrufe mit der gerade gesetzten Füllfarbe (Flächen der einzeiligen Lagefunk-Zeile)
const ctx2d = new Proxy({ fillStyle: '' }, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : k === 'fillRect' ? (x, y, w, h) => rects.push({ x, y, w, h, fs: t.fillStyle }) : k === 'fillStyle' ? t.fillStyle : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { t[k] = v; return true; } });
const panels = [], texte = [], backdrops = [];
const Render = {
  PAL: new Proxy({}, { get: () => '#fff' }),
  measure: (s) => String(s).length * 5,
  wrap: (s, w) => { const out = []; let cur = ''; for (const wd of String(s).split(' ')) { if (cur && (cur + ' ' + wd).length * 5 > w) { out.push(cur); cur = wd; } else cur = cur ? cur + ' ' + wd : wd; } if (cur) out.push(cur); return out; },
  panel: (c, x, y, w, h) => panels.push({ x, y, w, h }),
  text: (c, s, x, y) => texte.push({ s: String(s), x, y }),
  backdrop: (c, x, y, w, h) => backdrops.push({ x, y, w, h }), art: () => false, itemFallback() {}, ui: { buttons: [] },
};
let jetzt = 1000;   // s (performance.now()/1000)
const win = { Render, Shared_Maps: {}, Shared_Config: {}, Shared_Protocol: {}, performance: { now: () => jetzt * 1000 }, location: { search: '?debug=1' }, console,
  document: { createElement: () => ({ getContext: () => ctx2d, style: {} }), querySelector: () => null, getElementById: () => null, addEventListener() {} } };
win.window = win; win.self = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hud.js'), 'utf8'), win, { filename: 'hud.js' });
const Hud = win.Hud;
const sicht = (radio, konsole) => ({ me: { console: konsole === undefined ? 'weapons' : konsole }, self: { zone: 'ship' }, time: 0, state: { mission: { radio: radio || null } } });
const reset = () => { panels.length = 0; texte.length = 0; backdrops.length = 0; rects.length = 0; Hud.radioFlash = null; Hud.radioNach = null; };
const LAGE = 'Germanische Flotte sammelt sich bei Eisfeld. Stärke groß, Ziel unbekannt.';

console.log('\nLage an der Konsole: unter dem Kopf');
reset(); Hud.onRadio('Rom-Legat', LAGE, null, true);
Hud.drawLagefunk(win.ctx = ctx2d, sicht(null));
ok(panels.length === 1 && panels[0].y >= 40 && panels[0].y === 44, 'Lagefunk-Feld bei y ' + (panels[0] && panels[0].y) + ' (unter der Kopfzeile, vorher 16 im Debug-Modus und 6 sonst)');
ok(texte.some((t) => /^FUNK · Rom-Legat/.test(t.s)) && texte.every((t) => t.y >= 44), 'Texte des Feldes alle ab y 44');
reset(); win.location.search = ''; Hud.onRadio('Rom-Legat', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null));
ok(panels.length === 1 && panels[0].y === 44, 'ohne Debug-Modus ebenfalls y 44'); win.location.search = '?debug=1';
reset(); Hud.onRadio('Rom-Legat', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null, null));
ok(panels.length === 0, 'ohne Konsole zeichnet drawLagefunk nichts (das HUD zeigt die Meldung)');

console.log('\nNormaler Funkspruch verdrängt die Lagemeldung nicht');
reset(); Hud.onRadio('Rom-Legat', LAGE, null, true);
Hud.drawLagefunk(ctx2d, sicht({ from: 'Mars', text: 'Normaler Funkspruch.' }));
ok(panels.length === 1 && panels[0].y === 44, 'an der Konsole: Lagefunk bleibt sichtbar, auch wenn mission.radio gesetzt ist');
reset(); Hud.onRadio('Rom-Legat', LAGE, null, true);
panels.length = 0; const ende = Hud.drawRadio(ctx2d, sicht({ from: 'Mars', text: 'Normaler Funkspruch.' }, null), false);
ok(panels.length === 2 && panels[1].y === panels[0].y + panels[0].h + 4 && ende === panels[1].y + panels[1].h, 'im HUD: Funkspruch oben, Lagemeldung darunter (' + JSON.stringify(panels.map((p) => p.y)) + '), Rückgabe = untere Unterkante');
ok(texte.some((t) => /Normaler Funkspruch/.test(t.s)) && texte.some((t) => /Germanische/.test(t.s)), 'beide Texte gezeichnet');

console.log('\nFunkspruch während der Lagemeldung: zurückgestellt, danach gezeigt');
reset(); jetzt = 2000;
Hud.onRadio('Rom-Legat', LAGE, null, true);
jetzt = 2002; Hud.onRadio('Mars', 'Kurzer Funkspruch.', null, false);
ok(Hud.radioAktuell() && Hud.radioAktuell().lage && Hud.radioAktuell().text === LAGE, 'nach 2 s: die Lagemeldung läuft weiter');
jetzt = 2005.9; ok(Hud.radioAktuell().lage, 'nach 5,9 s: noch die Lagemeldung');
jetzt = 2006.1; { const a = Hud.radioAktuell(); ok(a && !a.lage && a.text === 'Kurzer Funkspruch.', 'nach 6,1 s: der zurückgestellte Funkspruch beginnt'); }
jetzt = 2011.5; ok(Hud.radioAktuell() && Hud.radioAktuell().text === 'Kurzer Funkspruch.', '5,4 s später: Funkspruch noch sichtbar (6 s ab Beginn)');
jetzt = 2012.5; ok(Hud.radioAktuell() === null && Hud.radioNach === null, 'danach: nichts mehr, nichts hängt');
reset(); jetzt = 3000; Hud.onRadio('Mars', 'Allein.', null, false);
ok(Hud.radioAktuell() && Hud.radioAktuell().text === 'Allein.', 'Funkspruch ohne Lagemeldung: wie bisher sofort');
jetzt = 3002; Hud.onRadio('Mars', 'Zweiter.', null, false); ok(Hud.radioAktuell().text === 'Zweiter.', 'zwei normale Funksprüche: der neue ersetzt wie bisher');
reset(); jetzt = 4000; Hud.onRadio('Mars', 'Eins.', null, false); jetzt = 4001; Hud.onRadio('Rom-Legat', LAGE, null, true);
ok(Hud.radioAktuell().lage, 'Lagemeldung nach einem normalen Funkspruch: ersetzt ihn (wie bisher)');

console.log('\nClient-Runde S5: Hafenterminal einzeilig, Sternkarte ohne Tafel');
reset(); Hud.onRadio('Sensoren Lerche', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null, 'shop'));
ok(panels.length === 0 && rects.some((r) => r.y === 0 && r.h === 11 && r.fs === '#0B0E1A') && rects.some((r) => r.y === 10 && r.h === 1 && r.w === 232) && rects.some((r) => r.w === 3 && r.fs === '#E0473C'), 'Terminal (shop): flache Fläche (Tisch, 11 hoch) mit 1 px Messing als Unterkante und rotem Streifen, kein R.panel mit Fase (' + JSON.stringify(rects.slice(0, 3)) + ')');
ok(texte.length === 1 && /^LAGE · Germanische/.test(texte[0].s) && !/Sensoren Lerche/.test(texte[0].s) && texte[0].y >= 1 && texte[0].y < 12, 'Terminal: eine Textzeile „LAGE · …“ ohne den eigenen Sprecher (Sensoren Lerche), über der Kopfzeile');
win.location.search = ''; reset(); Hud.onRadio('Hafen Ostia Nova', LAGE, null, true, 'Eisfeld · Germanen · Stärke groß'); Hud.drawLagefunk(ctx2d, sicht(null, 'shop'));
ok(/^LAGE · Hafen Ostia Nova · Eisfeld · Germanen · Stärke groß · Germanische/.test(texte[0].s) || /^LAGE · Hafen Ostia Nova · Eisfeld · Germanen · Stärke groß/.test(texte[0].s), 'fremder Sprecher bleibt, dann zuerst Ort · Fraktion · Stärke, Prosa danach: „' + texte[0].s + '“');
win.location.search = ''; reset(); Hud.onRadio('Sensoren Lerche', LAGE, null, true, 'Eisfeld · Germanen · Stärke groß'); Hud.drawLagefunk(ctx2d, sicht(null, 'shop'));
ok(texte[0].s.length * 5 <= 440 - 12 && /^LAGE · Eisfeld · Germanen · Stärke groß · /.test(texte[0].s), 'schmale/breite Zeile: die Kernaussage steht vollständig vorn, gekürzt wird die Prosa („' + texte[0].s + '“)');
win.location.search = '?debug=1'; reset(); Hud.onRadio('Sensoren Lerche', LAGE, null, true, 'Eisfeld · Germanen · Stärke groß'); Hud.drawLagefunk(ctx2d, sicht(null, 'shop'));
ok(/^LAGE · Eisfeld · Germanen · Stärke groß/.test(texte[0].s) && texte[0].s.length * 5 <= 232 - 12, 'Debug-Modus (schmale Zeile): Kernaussage vollständig, Rest gekürzt: „' + texte[0].s + '“');
win.Consoles = { tab: 1 }; win.StarMap = { lageAktiv: () => true };
reset(); Hud.onRadio('Sensoren Lerche', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null, 'captain'));
ok(panels.length === 0, 'Captain, Sternkarte (Lage-Ansicht): keine Tafel (Neu-Strich der Meldeliste, Funk-Reiter, Logbuch)');
win.StarMap = { lageAktiv: () => false }; reset(); Hud.onRadio('Sensoren Lerche', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null, 'captain'));
ok(panels.length === 1, 'Captain, Sternkarte ohne Lage-Ansicht (Kampagne): Tafel wie bisher');
win.Consoles = { tab: 2 }; reset(); Hud.onRadio('Sensoren Lerche', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null, 'captain'));
ok(panels.length === 1 && panels[0].y === 44, 'Captain, anderer Reiter: Tafel bei y 44 wie bisher');
delete win.Consoles; delete win.StarMap;

console.log('\nClient-Runde S6: Notrückholungs-Tafel unter allen Funktafeln');
{
  const me = { id: 'a', downed: true, bleed: 20, console: null, zone: 'away' };
  const v = (radio) => ({ me, time: 0, state: { mission: { radio }, players: [me], time: 0 } });
  const radio = { from: 'Rom-Legat', text: 'Haltet die Stellung am Tor, der Trupp ist gleich da.', needsAccept: false };
  reset(); Hud.onRadio('Sensoren Lerche', LAGE, null, true);
  panels.length = 0; const ende = Hud.drawRadio(ctx2d, v(radio), false);
  backdrops.length = 0; Hud.drawDownedBanner(ctx2d, v(radio));
  const b = backdrops[0];
  ok(ende && b && b.y === ende + 4, 'Funk + Lagemeldung: Tafel bei ' + (b && b.y) + ' = Unterkante ' + ende + ' + 4');
  reset(); backdrops.length = 0; Hud.drawDownedBanner(ctx2d, v(null)); ok(backdrops[0].y === 24, 'ohne Funk: wie bisher bei y 24');
  reset(); Hud.onRadio('Sensoren Lerche', LAGE, null, true); backdrops.length = 0; panels.length = 0; const e2 = Hud.drawRadio(ctx2d, v(null), false); Hud.drawDownedBanner(ctx2d, v(null));
  ok(backdrops[0].y === e2 + 4, 'nur Lagemeldung: Tafel unter der Lagemeldung (' + backdrops[0].y + ' = ' + e2 + ' + 4)');
}

console.log('\nClient-Runde M2: Szenenzeile (state.flotte.sz) ersetzt VERBÜNDET und BEFEHL');
win.KarteTokens = { PULT: { rot: '#R', notruf: '#N', hell: '#H', mint: '#M', tisch: '#T', messing: '#B', warn: '#W', lampeAus: '#A' }, FARBE: { funk: { akzentFeind: '#R' }, fraktion: { g: { name: 'Germanen' }, p: { name: 'Piraten' }, r: { name: 'Rom' } } }, staerkeName: (k) => ({ 1: 'klein', 2: 'mittel', 3: 'groß' })[k] };
{
  const sz = (o, wl) => ({ me: { console: 'weapons' }, time: 0, state: { flotte: Object.assign({ sz: o }, wl ? { wl } : {}), space: { escorts: [{ id: 1, al: 1, name: 'Falco', hp: 5, hpMax: 10 }] } } });
  const z = (o, wl) => Hud.szeneZeile(sz(o, wl));
  let a = z({ p: 'v', v: [13, 20], f: 'ger', k: 2 }, [0, 3]);
  ok(a && a.kopf === 'FEINDKONTAKT' && a.text === 'Germanen · mittel · 3 Wellen' && a.sek === 13 && Math.abs(a.anteil - 0.65) < 1e-9 && a.kopfFarbe === '#N' && a.textFarbe === '#H', 'Vorwarnung: FEINDKONTAKT (S-3: aufgehelltes Rot PULT.notruf), „Germanen · mittel · 3 Wellen“ (hell, N8), 13 s, Balken 65 %');
  a = z({ p: 'v', v: [5, 20], f: 'pirat', k: 3 }, [0, 4]); ok(a.text === 'Piraten · groß · 4 Wellen' && a.sek === 5, 'Vorwarnung Piraten, groß, 5 s');
  a = z({ p: 'k', g: 3 }, [2, 3]); ok(a.kopf === 'WELLE 2/3' && a.text === ' · 3 Gegner' && !a.hoch, 'Kampf: „WELLE 2/3 · 3 Gegner“');
  a = z({ p: 'k', g: 1 }, [2, 3]); ok(a.text === ' · 1 Gegner', 'ein Gegner (Einzahl)');
  a = z({ p: 'f', g: 2, kd: 'Arminius' }, [3, 3]); ok(a.kopf === 'FLAGGSCHIFF' && a.text === ' · Arminius', 'Finale: „FLAGGSCHIFF · Arminius“');
  a = z({ p: 's', o: 'Ostia Nova' }); ok(a.kopf === 'SIEG' && a.text === ' · Ostia Nova hält' && a.kopfFarbe === '#M', 'Sieg: „SIEG · Ostia Nova hält“ (mint)');
  a = z({ p: 's' }); ok(a.text === ' · Flotte bricht ab', 'Sieg ohne Ort');
  a = z({ p: 'n', o: 'Ostia Nova' }); ok(a.kopf === 'NIEDERLAGE' && a.text === ' · Ostia Nova verloren' && a.kopfFarbe === '#N', 'Niederlage mit Ort');
  a = z({ p: 'n' }); ok(a.text === ' · Feind hält den Sektor', 'Niederlage ohne Ort');
  ok(Hud.szeneZeile({ state: { flotte: { wl: [1, 3] } } }) === null && Hud.szeneZeile({ state: {} }) === null, 'ohne sz: keine Szenenzeile (Kampagne, Limes, Eisenwald, Tutorial)');
  reset(); ok(Hud.drawAlliesStrip(ctx2d, sz({ p: 'k', g: 1 }, [1, 2]), 9, { measure: true }) === 0 && Hud.drawAlliesStrip(ctx2d, sz({ p: 'k', g: 1 }, [1, 2]), 9) === 9, 'VERBÜNDET entfällt während der Szene');
  reset(); const y1 = Hud.drawBefehlStrip(ctx2d, sz({ p: 'v', v: [13, 20], f: 'ger', k: 2 }, [0, 3]), 9);
  ok(y1 === 9 + 27 + 1 && texte.some((t) => t.s === 'FEINDKONTAKT') && texte.some((t) => t.s === '13 s') && !texte.some((t) => /BEFEHL/.test(t.s)), 'Szenenzeile an der Stelle der BEFEHL-Zeile (27 hoch), 13 s als Zahl, kein BEFEHL');
  reset(); Hud.drawBefehlStrip(ctx2d, { me: { console: 'weapons' }, time: 0, state: { flotte: { wl: [1, 3] } } }, 9);
  ok(texte.some((t) => /BEFEHL/.test(t.s)) && !texte.some((t) => t.s === 'FEINDKONTAKT'), 'ohne sz: BEFEHL-Zeile wie bisher');
}

console.log('\nFixrunde: Szenenzeile (N6, N8, H6), Notrückholung absolut (S4), Sitz-Versatz (N1), ODA (Kosmetik), Konsolen-Einzug (N4)');
{
  const sz = (o, wl) => ({ me: { console: 'weapons' }, time: 0, state: { flotte: Object.assign({ sz: o }, wl ? { wl } : {}) } });
  ok(Hud.szeneZeile(sz({ p: 's', o: 'Ostia Nova' })).akzent === '#M', 'N6: bei SIEG ist der Akzentstreifen Mint (wie der Kopf)');
  ok(Hud.szeneZeile(sz({ p: 'n', o: 'Ostia Nova' })).akzent === undefined && Hud.szeneZeile(sz({ p: 'k', g: 2 }, [1, 3])).akzent === undefined, 'bei NIEDERLAGE und im Kampf bleibt der Streifen rot (Standard)');
  ok(Hud.szeneZeile(sz({ p: 'v', v: [10, 20], f: 'ger', k: 1 }, [0, 1])).text === 'Germanen · klein · 1 Welle', 'N8: eine Welle in der Einzahl');
  // H6: ungültiges sz ganz ignorieren
  for (const [name, bad] of [['unbekannte Phase', { p: 'x' }], ['Phase fehlt', {}], ['Vorwarnung ohne v', { p: 'v', f: 'ger', k: 2 }], ['v kein Array', { p: 'v', v: 'abc', f: 'ger', k: 2 }], ['v mit Unsinn', { p: 'v', v: ['a', 'b'] }], ['kein Objekt', 'v']]) {
    ok(Hud.szeneVon(sz(bad)) === null && Hud.szeneZeile(sz(bad)) === null, 'H6: ' + name + ' -> sz wird ignoriert (keine Zeile, VERBÜNDET/BEFEHL bleiben)');
  }
  reset(); const y0 = Hud.drawBefehlStrip(ctx2d, Object.assign(sz({ p: 'v', f: 'ger', k: 2 }), {}), 9);
  ok(y0 === 9 && !texte.some((t) => t.s === 'FEINDKONTAKT') && !texte.some((t) => /undefined/.test(t.s)), 'H6: ungültiges sz zeichnet weder Szenenzeile noch „undefined s“');
  // N4: Einzug unter der Szenenzeile an den Konsolen
  const v = sz({ p: 'v', v: [10, 20], f: 'ger', k: 1 }, [0, 3]);
  ok(Hud.szeneUnten(v) === 37 && Hud.szeneRandOben(v, 6) === 33 && Hud.szeneRandOben(v, 40) === 0, 'N4: Unterkante der Zeile y 37; Karte bei y 6 braucht 33 px Einzug, Karte ab y 40 keinen');
  ok(Hud.szeneUnten(sz({ p: 'k', g: 1 })) === 9 + 14 + 1 && Hud.szeneUnten({ state: {} }) === 0 && Hud.szeneRandOben({ state: {} }, 6) === 0, 'N4: Kampfzeile 14 hoch; ohne Szene 0 (Kampagne unverändert)');
  // S4: Notrückholung ohne Lagemeldung bitgenau wie vor der Client-Runde (Umbruch 216, keine Porträtbreite, Mindesthöhe nur mit Lagemeldung)
  const me = { id: 'a', downed: true, bleed: 20, console: null, zone: 'away' };
  const vv = (radio) => ({ me, time: 0, state: { mission: { radio }, players: [me], time: 0 } });
  const R1 = { from: 'Rom-Legat', pid: 'legat', text: 'Haltet die Stellung am Tor, der Trupp ist gleich da.', needsAccept: false };
  reset(); backdrops.length = 0; Hud.drawDownedBanner(ctx2d, vv(R1));
  ok(backdrops[0].y === 6 + 16 + 2 * 10 + 2 + 4, 'S4 Kampagne: Funk mit Porträt ohne Lagemeldung: Tafel bei y ' + backdrops[0].y + ' (6 + 16 + 2 Zeilen à 10 + 2 + 4 = 48, wie vor der Client-Runde)');
  reset(); backdrops.length = 0; Hud.drawDownedBanner(ctx2d, vv(Object.assign({}, R1, { needsAccept: true })));
  ok(backdrops[0].y === 6 + 16 + 2 * 10 + 11 + 4, 'S4: Funk mit „annehmen“: y 57 (11 statt 2)');
  reset(); backdrops.length = 0; Hud.onRadio('Rom-Legat', 'Kurzer normaler Funkspruch ohne Lage.', null, false); Hud.drawDownedBanner(ctx2d, vv(null));
  ok(backdrops[0].y === 6 + 16 + 1 * 10 + 2 + 4 + 0 || backdrops[0].y === 6 + 16 + 20 + 2 + 4, 'S4: auch ein normaler Funk-Flash (ohne Lage) rechnet wie vorher (y ' + backdrops[0].y + ')');
  // N1: Voxel-Sitz, Szenenzeile am Hauptschirm: Lagefunk-Tafel rückt unter die Zeile
  win.Sitz = { szeneUnten: () => 101 };
  reset(); Hud.onRadio('Rom-Legat', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null));
  ok(Hud.sitzVersatz(v) === 101 + 3 - 44 && panels[0].y === 104, 'N1: im Voxel-Sitz mit Szenenzeile liegt die Lagefunk-Tafel bei y ' + panels[0].y + ' (unter der Zeile, Unterkante y 101)');
  win.Sitz = { szeneUnten: () => 0 }; reset(); Hud.onRadio('Rom-Legat', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null));
  ok(Hud.sitzVersatz(v) === 0 && panels[0].y === 44, 'ohne Szenenzeile am Schirm (oder Blick Pult/Crew) bleibt y 44');
  delete win.Sitz;
  // Kosmetik: Szenenende räumt die Szenen-ODA weg
  Hud.oda.queue = [{ text: 'Erste Welle in 10 s – Klarmachen.' }, { text: 'Ortung: Welle 3 von 3 im Anflug.' }, { text: 'Brachland (0505). Neuer Ort im Logbuch!' }]; Hud.oda.cur = { text: 'Ortung: Welle 2 von 3 im Anflug.', shown: 0, hold: 0 };
  Hud.odaWeg();
  ok(Hud.oda.cur === null && Hud.oda.queue.length === 1 && /Brachland/.test(Hud.oda.queue[0].text), 'odaWeg: Ortung/Erste Welle weg, andere ODA bleibt');
}

console.log('\nFixrunde 3: Steuerkonsole einzeilig (S-2), „+n im Funk-Reiter“ nur mit Reiter-Meldungen (S-1)');
{
  // S-2: an der Steuerkonsole (2D-Helm, Voxel-Blick PULT) die einzeilige Zeile ganz oben, sonst deckte die Tafel die AUSWEICHEN-Warnung der Frontsicht
  reset(); Hud.onRadio('Aufklärung', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null, 'helm'));
  ok(panels.length === 0 && rects.some((r) => r.y === 0 && r.h === 11) && texte.some((t) => /^LAGE · /.test(t.s)), 'S-2: Steuer (2D-Helm): einzeilige Lagefunk-Zeile bei y 0, keine Tafel');
  { const v = sicht(null, 'helm'); v.state.flotte = { sz: { p: 'k', g: 1 } }; reset(); Hud.onRadio('Aufklärung', LAGE, null, true); Hud.drawLagefunk(ctx2d, v);
    ok(rects.some((r) => r.y === 0 && r.h === 9), 'S-2: mit Szenenzeile ist die Lagefunk-Zeile 9 hoch (die Szenenzeile beginnt bei y 9)'); }
  win.Sitz = { station: 'helm', blick: 'pult', szeneUnten: () => 0 };
  reset(); Hud.onRadio('Aufklärung', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null, 'helm'));
  ok(panels.length === 0 && rects.some((r) => r.y === 0 && r.h === 11), 'S-2: Voxel-Sitz, Blick PULT an der Steuerkonsole: Zeile');
  win.Sitz = { station: 'helm', blick: 'vorn', szeneUnten: () => 0 };
  reset(); Hud.onRadio('Aufklärung', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null, 'helm'));
  ok(panels.length === 1 && panels[0].y === 44, 'S-2: Voxel-Sitz, Blick VORN (Konsole nicht zu sehen): Tafel wie bisher');
  win.Sitz = { station: 'weapons', blick: 'pult', szeneUnten: () => 0 };
  reset(); Hud.onRadio('Aufklärung', LAGE, null, true); Hud.drawLagefunk(ctx2d, sicht(null, 'weapons'));
  ok(panels.length === 1 && panels[0].y === 44, 'S-2: Ops behält die Tafel');
  delete win.Sitz;
  // H-b: odaWeg erkennt die Szenen-ODA am Wortlaut: die echten Texte aus Inhalt und Server müssen darauf passen
  { const root = path.join(__dirname, '..');
    const hinweis = JSON.parse(fs.readFileSync(path.join(root, 'content', 'flotte', 'sim-szene.json'), 'utf8')).vorwarnung.hinweis.replace('{sek}', '10');
    const welle = JSON.parse(fs.readFileSync(path.join(root, 'content', 'flotte', 'funktexte.json'), 'utf8')).meldungen.welle.replace('{n}', '2').replace('{von}', '3');
    const nach = (fs.readFileSync(path.join(root, 'server', 'sim', 'flotte.js'), 'utf8').match(/game\.oda\('(Nachschub trifft ein[^']*)'/) || [])[1];
    for (const [name, text] of [['Vorwarnung', hinweis], ['Welle', welle], ['Nachschub', nach]]) {
      Hud.oda.queue = [{ text }, { text: 'Brachland (0505). Neuer Ort im Logbuch!' }]; Hud.oda.cur = null; Hud.odaWeg();
      ok(text && Hud.oda.queue.length === 1 && /Brachland/.test(Hud.oda.queue[0].text), 'H-b: odaWeg räumt den echten Text „' + text + '“ (' + name + ')');
    } }
  // S-1
  reset(); jetzt = 7000;
  Hud.onRadio('Rom-Legat', LAGE, null, true); Hud.onRadio('Aufklärung', 'Szene 1', null, true, null, true); Hud.onRadio('Aufklärung', 'Szene 2', null, true, null, true);
  ok(Hud.radioAktuell().mehr === 1, 'S-1: zwei Szenenmeldungen ohne Reiter nach einer Reiter-Meldung: „+1“ (' + Hud.radioAktuell().mehr + ')');
  reset(); jetzt = 7100;
  Hud.onRadio('Aufklärung', 'Szene 1', null, true, null, true); Hud.onRadio('Rom-Legat', LAGE, null, true); Hud.onRadio('Rom-Legat', LAGE + ' 2', null, true);
  ok(Hud.radioAktuell().mehr === 1, 'S-1: nur die Reiter-Meldungen davor zählen (' + Hud.radioAktuell().mehr + ')');
  reset(); jetzt = 7200;
  Hud.onRadio('Rom-Legat', LAGE, null, true); Hud.onRadio('Rom-Legat', LAGE + ' 2', null, true);
  ok(Hud.radioAktuell().mehr === 1, 'S-1: ohne Szene unverändert (+1)');
}

console.log(fails ? `\n${fails} FEHLER` : `\n${n}/${n} Prüfungen ok`);
process.exit(fails ? 1 : 0);
