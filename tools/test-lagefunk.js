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

const ctx2d = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : typeof k === 'string' ? () => {} : undefined), set: () => true });
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
const reset = () => { panels.length = 0; texte.length = 0; backdrops.length = 0; Hud.radioFlash = null; Hud.radioNach = null; };
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
ok(panels.length === 1 && panels[0].y === 0 && panels[0].h <= 12, 'Terminal (shop): ein Feld ganz oben, höchstens 12 hoch (' + JSON.stringify(panels[0]) + ')');
ok(texte.length === 1 && /^LAGEFUNK · Sensoren Lerche: Germanische/.test(texte[0].s) && texte[0].y < 12, 'Terminal: eine Textzeile über der Kopfzeile (ab y 12)');
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
win.KarteTokens = { PULT: { rot: '#R', hell: '#H', mint: '#M', tisch: '#T', messing: '#B', warn: '#W', lampeAus: '#A' }, FARBE: { funk: { akzentFeind: '#R' } }, staerkeName: (k) => ({ 1: 'klein', 2: 'mittel', 3: 'groß' })[k] };
{
  const sz = (o, wl) => ({ me: { console: 'weapons' }, time: 0, state: { flotte: Object.assign({ sz: o }, wl ? { wl } : {}), space: { escorts: [{ id: 1, al: 1, name: 'Falco', hp: 5, hpMax: 10 }] } } });
  const z = (o, wl) => Hud.szeneZeile(sz(o, wl));
  let a = z({ p: 'v', v: [13, 20], f: 'ger', k: 2 }, [0, 3]);
  ok(a && a.kopf === 'FEINDKONTAKT' && a.text === 'Germanen · mittel · Welle 0/3' && a.sek === 13 && Math.abs(a.anteil - 0.65) < 1e-9 && a.kopfFarbe === '#R' && a.textFarbe === '#H', 'Vorwarnung: FEINDKONTAKT (rot), „Germanen · mittel · Welle 0/3“ (hell), 13 s, Balken 65 %');
  a = z({ p: 'v', v: [5, 20], f: 'pirat', k: 3 }, [0, 4]); ok(a.text === 'Piraten · groß · Welle 0/4' && a.sek === 5, 'Vorwarnung Piraten, groß, 5 s');
  a = z({ p: 'k', g: 3 }, [2, 3]); ok(a.kopf === 'WELLE 2/3' && a.text === ' · 3 Gegner' && !a.hoch, 'Kampf: „WELLE 2/3 · 3 Gegner“');
  a = z({ p: 'k', g: 1 }, [2, 3]); ok(a.text === ' · 1 Gegner', 'ein Gegner (Einzahl)');
  a = z({ p: 'f', g: 2, kd: 'Arminius' }, [3, 3]); ok(a.kopf === 'FLAGGSCHIFF' && a.text === ' · Arminius', 'Finale: „FLAGGSCHIFF · Arminius“');
  a = z({ p: 's', o: 'Ostia Nova' }); ok(a.kopf === 'SIEG' && a.text === ' · Ostia Nova hält' && a.kopfFarbe === '#M', 'Sieg: „SIEG · Ostia Nova hält“ (mint)');
  a = z({ p: 's' }); ok(a.text === ' · Flotte bricht ab', 'Sieg ohne Ort');
  a = z({ p: 'n', o: 'Ostia Nova' }); ok(a.kopf === 'NIEDERLAGE' && a.text === ' · Ostia Nova verloren' && a.kopfFarbe === '#R', 'Niederlage mit Ort');
  a = z({ p: 'n' }); ok(a.text === ' · Feind hält den Sektor', 'Niederlage ohne Ort');
  ok(Hud.szeneZeile({ state: { flotte: { wl: [1, 3] } } }) === null && Hud.szeneZeile({ state: {} }) === null, 'ohne sz: keine Szenenzeile (Kampagne, Limes, Eisenwald, Tutorial)');
  reset(); ok(Hud.drawAlliesStrip(ctx2d, sz({ p: 'k', g: 1 }, [1, 2]), 9, { measure: true }) === 0 && Hud.drawAlliesStrip(ctx2d, sz({ p: 'k', g: 1 }, [1, 2]), 9) === 9, 'VERBÜNDET entfällt während der Szene');
  reset(); const y1 = Hud.drawBefehlStrip(ctx2d, sz({ p: 'v', v: [13, 20], f: 'ger', k: 2 }, [0, 3]), 9);
  ok(y1 === 9 + 27 + 1 && texte.some((t) => t.s === 'FEINDKONTAKT') && texte.some((t) => t.s === '13 s') && !texte.some((t) => /BEFEHL/.test(t.s)), 'Szenenzeile an der Stelle der BEFEHL-Zeile (27 hoch), 13 s als Zahl, kein BEFEHL');
  reset(); Hud.drawBefehlStrip(ctx2d, { me: { console: 'weapons' }, time: 0, state: { flotte: { wl: [1, 3] } } }, 9);
  ok(texte.some((t) => /BEFEHL/.test(t.s)) && !texte.some((t) => t.s === 'FEINDKONTAKT'), 'ohne sz: BEFEHL-Zeile wie bisher');
}

console.log(fails ? `\n${fails} FEHLER` : `\n${n}/${n} Prüfungen ok`);
process.exit(fails ? 1 : 0);
