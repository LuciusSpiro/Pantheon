'use strict';
// SUND-02a C: Lagefunk-Einblendung (public/js/hud.js) mit Attrappen für Render/Karte im vm.
//   1. Das Feld an Konsole/Terminal liegt unter deren Kopfzeile (LAGEFUNK_Y 44, vorher 6/16 über dem Kopf).
//   2. Ein normaler Funkspruch verdrängt eine laufende Lagemeldung nicht: an der Konsole bleibt sie sichtbar, im HUD steht sie unter dem Funkspruch,
//      und ein Funkspruch, der während der Lagemeldung eintrifft, wird zurückgestellt und danach eingeblendet.
//   node tools/test-lagefunk.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const ctx2d = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : typeof k === 'string' ? () => {} : undefined), set: () => true });
const panels = [], texte = [];
const Render = {
  PAL: new Proxy({}, { get: () => '#fff' }),
  measure: (s) => String(s).length * 5,
  wrap: (s, w) => { const out = []; let cur = ''; for (const wd of String(s).split(' ')) { if (cur && (cur + ' ' + wd).length * 5 > w) { out.push(cur); cur = wd; } else cur = cur ? cur + ' ' + wd : wd; } if (cur) out.push(cur); return out; },
  panel: (c, x, y, w, h) => panels.push({ x, y, w, h }),
  text: (c, s, x, y) => texte.push({ s: String(s), x, y }),
  backdrop() {}, art: () => false, itemFallback() {}, ui: { buttons: [] },
};
let jetzt = 1000;   // s (performance.now()/1000)
const win = { Render, Shared_Maps: {}, Shared_Config: {}, Shared_Protocol: {}, performance: { now: () => jetzt * 1000 }, location: { search: '?debug=1' }, console,
  document: { createElement: () => ({ getContext: () => ctx2d, style: {} }), querySelector: () => null, getElementById: () => null, addEventListener() {} } };
win.window = win; win.self = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hud.js'), 'utf8'), win, { filename: 'hud.js' });
const Hud = win.Hud;
const sicht = (radio, konsole) => ({ me: { console: konsole === undefined ? 'shop' : konsole }, self: { zone: 'ship' }, time: 0, state: { mission: { radio: radio || null } } });
const reset = () => { panels.length = 0; texte.length = 0; Hud.radioFlash = null; Hud.radioNach = null; };
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

console.log(fails ? `\n${fails} FEHLER` : `\n${n}/${n} Prüfungen ok`);
process.exit(fails ? 1 : 0);
