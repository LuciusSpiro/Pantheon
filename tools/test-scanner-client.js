'use strict';
// SCA-01 P3: Client des Scanners am Boden – Overlay (public/js/scanner.js), Eingabe, HUD-Zelle, Ausrüstungsstation, Verdrahtung in client.js.
// client.js läuft nicht in Node: die Entscheidungen stehen in Scanner.aktiv/taste/abgleichen/loslassen (hier ausgeführt), die Einhängestellen in client.js werden am Quelltext geprüft.
// Das Zusammenspiel mit echtem Server und echten Tasten zeigt tools/sca01-p3-shots.js.   node tools/test-scanner-client.js  (npm run test:scanner-client)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const ev = (code, extra) => Object.assign({ code, shiftKey: false, repeat: false }, extra || {});

const CONFIG = require('../shared/config.js');
const PROTO = require('../shared/protocol.js');
const calls = [];
const panels = [];
const bars = [];
const R = {
  PAL: new Proxy({}, { get: (t, k) => '#' + String(k) }),
  backdrop() {}, art() { return true; },
  text(ctx, txt, x, y, o) { calls.push({ txt: String(txt), x, y, o: o || {} }); },
  measure: (t) => Math.round(String(t).length * 5.6 * 10) / 10,   // grob wie die Pixelschrift („Betäuber“, 8 Zeichen, ist 45 px breit)
  panel(ctx, x, y, w, h, o) { panels.push({ x, y, w, h, o }); },
  bar(ctx, x, y, w, h, f, col) { bars.push({ x, y, w, h, f, col }); },
};
const speicher = {};
const win = { performance, localStorage: { getItem: (k) => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: (k) => { delete speicher[k]; } }, Render: R, Shared_Maps: {}, Shared_Config: CONFIG, Shared_Protocol: PROTO, Net: { guard: (nm, f) => f(), on() {} } };
win.window = win;
vm.createContext(win);
vm.runInContext(read('public/js/tasten.js'), win, { filename: 'tasten.js' });
vm.runInContext(read('public/js/hud.js'), win, { filename: 'hud.js' });
vm.runInContext(read('public/js/scanner.js'), win, { filename: 'scanner.js' });
const T = win.Tasten, H = win.Hud, S = win.Scanner;
const STAND = { slotzahl: 3, slots: ['sturmgewehr', 'scanner', 'lanze'] };   // Scanner in Slot 2 (Taste 2)

const ctxStub = () => { const fills = []; return { fills, fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect(x, y, w, h) { fills.push({ x, y, w, h, c: this.fillStyle }); }, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }; };

section('Sichtbarkeit: Overlay nur bei action.kind === scan (eigener Spieler)');
ok(S.aktiv({ action: { kind: 'scan', progress: 0.2 }, sc: { f: 0.5, s: 0.4, h: 0.2, q: 1 } }) === true, 'action.kind scan -> Overlay');
ok(S.aktiv(null) === false && S.aktiv(undefined) === false && S.aktiv({}) === false, 'kein Spieler / keine Aktion -> kein Overlay');
ok(S.aktiv({ action: { kind: 'minigame' } }) === false && S.aktiv({ action: { kind: 'fesseln' }, sc: { f: 0, s: 0, h: 0, q: 0 } }) === false, 'andere Aktion (auch mit sc-Feld) -> kein Overlay');
ok(S.aktiv({ action: null, sc: { f: 0, s: 0, h: 0, q: 0 } }) === false, 'sc allein (Server hat den Hold beendet) -> Overlay weg');
ok(S.schluckt({ action: { kind: 'scan' } }) === true && S.schluckt({ action: { kind: 'minigame' } }) === false && S.schluckt(null) === false, 'Mausklick (Schuss) nur während des Scans geschluckt');
{
  // nur me: ein fremder Scannender im Snapshot erzeugt kein Overlay (Client.view.me ist der eigene Spieler)
  const st = { players: [{ id: 1, action: { kind: 'scan', progress: 0.5 } }, { id: 2, action: null }] };
  const me2 = st.players.find((p) => p.id === 2);
  ok(S.aktiv(me2) === false, 'fremder Spieler scannt, ich nicht: kein Overlay');
  const cl = read('public/js/client.js');
  ok(/Scanner\.aktiv\(v\.me\)/.test(cl) && !/Scanner\.aktiv\(st\.players/.test(cl), 'client.js zeichnet nur für v.me');
}

section('Richtung: Tasten A/D und Pfeile');
ok(S.richtungVon({}) === 0 && S.richtungVon({ KeyA: true }) === -1 && S.richtungVon({ KeyD: true }) === 1 && S.richtungVon({ ArrowLeft: true }) === -1 && S.richtungVon({ ArrowRight: true }) === 1, 'A/Pfeil links = -1, D/Pfeil rechts = +1, nichts = 0');
ok(S.richtungVon({ KeyA: true, KeyD: true }) === 0 && S.richtungVon({ KeyA: true, ArrowLeft: true }) === -1, 'beide Richtungen gleichzeitig = 0; zwei Tasten derselben Richtung = eine Richtung');
const stimmen = (r) => r.senden.filter((m) => m.c === 'scan.stimme').map((m) => m.dir);
S.loslassen();
let r = S.taste(ev('KeyA'), true, STAND);
ok(r.verbraucht && stimmen(r).join() === '-1', 'A gedrückt: scan.stimme dir -1');
r = S.taste(ev('KeyA', { repeat: true }), true, STAND);
ok(r.verbraucht && r.senden.length === 0, 'Autorepeat von A: nichts gesendet (nur bei Wechsel)');
r = S.taste(ev('ArrowLeft'), true, STAND);
ok(r.verbraucht && r.senden.length === 0, 'zweite Links-Taste dazu: Richtung unverändert, nichts gesendet');
r = S.taste(ev('KeyA'), false, STAND);
ok(r.verbraucht && r.senden.length === 0, 'A los, Pfeil links noch gehalten: nichts gesendet');
r = S.taste(ev('ArrowLeft'), false, STAND);
ok(stimmen(r).join() === '0', 'letzte Links-Taste los: dir 0');
r = S.taste(ev('KeyD'), true, STAND);
ok(stimmen(r).join() === '1', 'D: dir +1');
r = S.taste(ev('KeyA'), true, STAND);
ok(stimmen(r).join() === '0', 'D und A zusammen: dir 0');
r = S.taste(ev('KeyA'), false, STAND);
ok(stimmen(r).join() === '1', 'A los, D gehalten: wieder dir +1');
r = S.taste(ev('KeyD'), false, STAND);
ok(stimmen(r).join() === '0', 'D los: dir 0');
r = S.taste(ev('KeyD'), false, STAND);
ok(r.senden.length === 0, 'zweites Loslassen ohne Wirkung: nichts gesendet');

section('Ende, Fokus- und Fensterwechsel: dir 0');
S.loslassen();
S.taste(ev('KeyD'), true, STAND);
ok(S.abgleichen({ action: { kind: 'scan' } }).length === 0, 'Scan läuft: abgleichen sendet nichts');
let a = S.abgleichen({ action: null });
ok(a.length === 1 && a[0].c === 'scan.stimme' && a[0].dir === 0, 'Server beendet den Scan, D noch gehalten: dir 0 wird gesendet');
ok(S.abgleichen({ action: null }).length === 0 && S.abgleichen(null).length === 0, 'danach nichts mehr (kein Dauerfeuer von dir 0)');
S.taste(ev('KeyA'), true, STAND);
a = S.loslassen();
ok(a.length === 1 && a[0].dir === 0, 'Fokusverlust (blur): dir 0');
ok(S.loslassen().length === 0, 'blur ohne gehaltene Richtung: nichts gesendet');
S.taste(ev('KeyD'), true, STAND); S.loslassen();
ok(S.taste(ev('KeyD'), false, STAND).senden.length === 0, 'nach blur ist die Taste vergessen: spätes Loslassen sendet nichts doppelt');

section('Abbruch: Esc, Rücktaste, Slot-Taste des Scanners');
r = S.taste(ev('Escape'), true, STAND);
ok(r.verbraucht && r.senden.length === 1 && r.senden[0].c === 'scan.abbruch' && r.senden[0].c === PROTO.CMD_SCAN_ABBRUCH, 'Esc: scan.abbruch (verbraucht, öffnet kein Menü)');
r = S.taste(ev('Backspace'), true, STAND);
ok(r.senden.length === 1 && r.senden[0].c === 'scan.abbruch', 'Rücktaste: scan.abbruch');
r = S.taste(ev('Escape', { repeat: true }), true, STAND);
ok(r.verbraucht && r.senden.length === 0, 'Esc-Wiederholung: nicht mehrfach gesendet');
r = S.taste(ev('Digit2'), true, STAND);
ok(r.verbraucht && r.senden.length === 1 && r.senden[0].c === PROTO.CMD_SLOT_NUTZEN && r.senden[0].slot === 1, 'Slot-Taste des Scanners (2): slot.nutzen mit Slot 1 (Server bricht ab)');
r = S.taste(ev('Numpad2'), true, STAND);
ok(r.senden.length === 1 && r.senden[0].slot === 1, 'Ziffernblock 2 ebenso');

section('Geschluckt: Schießen, Fremdwaffen-Slots, Bewegung');
for (const [code, text] of [['Space', 'Schießen (Space)'], ['Digit1', 'Slot 1 (Sturmgewehr)'], ['Digit3', 'Slot 3 (Lanze)'], ['Digit4', 'Taste 4 (kein Slot)'], ['KeyW', 'W'], ['KeyS', 'S'], ['ArrowUp', 'Pfeil hoch'], ['ArrowDown', 'Pfeil runter'], ['KeyQ', 'Q (Markieren)'], ['KeyE', 'E'], ['KeyC', 'C (ducken)'], ['Tab', 'Tab'], ['ShiftLeft', 'Shift (laufen)']]) {
  r = S.taste(ev(code), true, STAND);
  ok(r.verbraucht && r.senden.length === 0, text + ': verbraucht, nichts gesendet');
}
r = S.taste(ev('Digit2'), true, { slotzahl: 3, slots: ['sturmgewehr', 'lanze', 'scanner'] });
ok(r.verbraucht && r.senden.length === 0, 'Taste 2 mit Lanze im Slot 2 (Scanner liegt in Slot 3): geschluckt');
r = S.taste(ev('Digit3'), true, { slotzahl: 3, slots: ['sturmgewehr', 'lanze', 'scanner'] });
ok(r.senden.length === 1 && r.senden[0].slot === 2, 'Scanner in Slot 3: Taste 3 bricht ab');
r = S.taste(ev('Digit2'), true, null);
ok(r.verbraucht && r.senden.length === 0, 'ohne Loadout-Stand: geschluckt, nichts gesendet');
T.setze('boden.slot2', 0, 'KeyU');
r = S.taste(ev('KeyU'), true, STAND);
ok(r.senden.length === 1 && r.senden[0].slot === 1, 'umbelegte Slot-Taste (U) bricht ab');
r = S.taste(ev('Digit2'), true, STAND);
ok(r.verbraucht && r.senden.length === 0, 'die ersetzte Ziffer 2 tut nichts mehr');
T.zuruecksetzen('boden');
r = S.taste(ev('Digit1', { shiftKey: true }), true, STAND);
ok(r.verbraucht && r.senden.length === 0, 'Umschalt+1: geschluckt');
S.loslassen();

section('Verdrahtung in client.js (Quelltext)');
{
  const cl = read('public/js/client.js');
  const iKey = cl.indexOf("window.addEventListener('keydown'");
  const body = cl.slice(iKey, cl.indexOf("window.addEventListener('keyup'"));
  const iSc = body.indexOf('Scanner.aktiv(m)');
  const iKeys = body.indexOf('Client.keys[code] = true;');
  const iCons = body.indexOf('if (m.console) { Net.guard(');
  const iMini = body.indexOf('if (Client.minigame)');
  const iSlot = body.indexOf('Tasten.slotVon(e)');
  const iSw = body.indexOf('switch (code) {');
  ok(iSc > 0 && iSc < iKeys && iKeys < iCons && iCons < iMini && iMini < iSlot && iSlot < iSw, 'Scanner-Zweig vor Client.keys (gehaltene Tasten laufen nicht nach), Waffenslot und Boden-Switch');
  ok(/m\.zone === 'away' && !m\.console && Scanner\.aktiv\(m\)\) \{ e\.preventDefault\(\);/.test(body) && /Scanner\.taste\(e, true, H\.loadoutStand\)/.test(body) && /for \(const o of sr\.senden\) send\(o\); return;/.test(body), 'keydown: nur am Boden ohne Konsole, preventDefault, senden, return (Esc öffnet kein Menü)');
  const up = cl.slice(cl.indexOf("window.addEventListener('keyup'"), cl.indexOf("window.addEventListener('blur', releaseAll)"));
  ok(/Scanner\.taste\(e, false, H\.loadoutStand\)/.test(up), 'keyup: Richtungstaste los -> Scanner.taste(down false)');
  ok(/function releaseAll\(\) \{[^]*?Scanner\.loslassen\(\)[^]*?\n  \}/.test(cl), 'blur/releaseAll: Scanner.loslassen (dir 0)');
  ok(/Scanner\.abgleichen\(m\)/.test(cl), 'jeder Frame: Scanner.abgleichen (Ende des Scans: dir 0)');
  ok(/const canMove = [^\n]*!\(window\.Scanner && Scanner\.aktiv\(m\)\)/.test(cl), 'canMove: keine Bewegung während des Scans (sendet mx 0)');
  ok(/phase !== 'lobby' && !\(window\.Scanner && Scanner\.schluckt\(m\)\)\) \{ Client\.lanzeSperre = false; shoot\(\);/.test(cl), 'Mausklick-Schuss während des Scans geschluckt');
  ok(/else if \(window\.Scanner && Scanner\.aktiv\(v\.me\)\) Net\.guard\('Scanner\.draw'/.test(cl), 'Zeichnung: Scanner.draw nur für v.me');
  ok(read('public/js/hud.js').includes("me.action.kind === 'scan')"), 'Fortschrittsring über der Figur entfällt beim Scan (das Overlay zeigt ihn)');
}
{
  const html = read('public/index.html');
  ok(/<script src="js\/scanner\.js"><\/script>/.test(html) && html.indexOf('js/scanner.js') > html.indexOf('js/hud.js') && html.indexOf('js/scanner.js') < html.indexOf('js/consoles.js'), 'index.html lädt scanner.js nach hud.js und vor consoles.js');
  const code = read('public/js/scanner.js').replace(/\/\/[^\n]*/g, '');
  ok(!/Math\.random/.test(code) && !/dauer|abklingzeit|qSchwellen/i.test(code), 'scanner.js: keine Zufallswerte, keine Server-Regeln (Dauer, Abklingzeit, Schwellen) im Client');
}

section('Zeichnung des Overlays');
{
  const me = { id: 1, action: { kind: 'scan', progress: 0.25 }, sc: { f: 0.3, s: 0.62, h: 0.25, q: 2 } };
  const sicht = { me, time: 3.2, state: {}, self: { zone: 'away' } };
  const zeichne = (v) => { calls.length = 0; panels.length = 0; bars.length = 0; const c = ctxStub(); S.draw(c, v); return c; };
  let c = zeichne(sicht);
  ok(panels.length === 1 && panels[0].o.title === 'SCANNER – FREQUENZ ABSTIMMEN', 'Panel mit Titel „SCANNER – FREQUENZ ABSTIMMEN“');
  const p = panels[0];
  ok(p.x >= 174 && p.x + p.w <= 640 && p.y + p.h <= 360 && p.y >= 180 + 40, 'Panel mittig-unten: rechts der Bodenleiste (x ≥ 174), unter der Figurmitte, im Bild (' + p.x + ',' + p.y + ',' + p.w + 'x' + p.h + ')');
  ok(p.w === 240 && p.h === 84 && p.y === 360 - 8 - 84, 'Nacharbeit D5: 240 x 84, feste Lage y = VH - 8 - H');
  const txt = calls.map((x) => x.txt);
  ok(txt.includes('FREQUENZ') && txt.includes('SIGNAL') && txt.includes('SCAN') && txt.includes('Qualität [**-]') && txt.includes('· A/D stimmen · Esc') && !txt.some((t) => /bisher/.test(t)), 'Beschriftungen: „Qualität [**-]“ + „· A/D stimmen · Esc“ in EINER Zeile (kein „bisher“, keine zweite Hilfezeile)');
  { const q1 = calls.find((x) => x.txt === 'Qualität [**-]'), q2 = calls.find((x) => x.txt === '· A/D stimmen · Esc'); ok(q1 && q2 && q1.y === q2.y && q2.x > q1.x + R.measure(q1.txt), 'Qualität und Hinweis stehen auf einer Zeile'); }
  ok(bars.length === 2 && Math.abs(bars[0].f - 0.62) < 1e-9 && Math.abs(bars[1].f - 0.25) < 1e-9, 'Balken Signal 0,62 und Fortschritt 0,25 kommen aus dem Snapshot');
  ok(bars[0].col === '#ice' && bars[1].col === '#star' && calls.filter((x) => x.o.color).every((x) => ['#brass', '#ice', '#panelLight'].includes(x.o.color)), 'D5: SIGNAL Eisblau, SCAN-Fortschritt in PAL.star (nicht dieselbe Farbe); Schrift nur Eisblau/Messing/Grau: weder Rot (Waffen/Gefahr) noch Bernstein (Hitze)');
  ok(c.fills.some((f) => f.c === '#EAF6FA' && f.w === 3), 'Frequenzmarke gezeichnet');
  ok(calls.every((x) => x.x >= p.x && x.x + R.measure(x.txt) <= p.x + p.w - 4), 'alle Texte liegen innerhalb des Rahmens (kürzt über Hud.fit)');
  // Frequenzmarke folgt f
  const markeX = (f) => { zeichne(Object.assign({}, sicht, { me: Object.assign({}, me, { sc: Object.assign({}, me.sc, { f }) }) })); return ctxLast.fills.find((q) => q.c === '#EAF6FA' && q.w === 3).x; };
  let ctxLast; const zl = (f) => { calls.length = 0; ctxLast = ctxStub(); S.draw(ctxLast, Object.assign({}, sicht, { me: Object.assign({}, me, { sc: Object.assign({}, me.sc, { f }) }) })); return ctxLast.fills.find((q) => q.c === '#EAF6FA' && q.w === 3).x; };
  ok(zl(0) < zl(0.5) && zl(0.5) < zl(1), 'Frequenzmarke wandert mit f (links nach rechts)');
  // kaputte/fehlende Werte werfen nie
  let fehler = null;
  try { for (const sc of [undefined, {}, { f: NaN, s: -3, h: 9, q: 17 }, { f: null, s: 'x', h: undefined, q: null }]) zeichne(Object.assign({}, sicht, { me: Object.assign({}, me, { sc }) })); } catch (e) { fehler = e; }
  ok(!fehler, 'fehlendes oder unsinniges sc zeichnet ohne Fehler' + (fehler ? ': ' + fehler.message : ''));
  zeichne(Object.assign({}, sicht, { me: Object.assign({}, me, { sc: { f: 0.5, s: 7, h: -2, q: 9 } }) }));
  ok(bars[0].f === 1 && bars[1].f === 0 && calls.some((x) => /\[\*\*\*\]/.test(x.txt)), 'Werte werden auf 0..1 bzw. 0..3 Sterne begrenzt');
  zeichne(Object.assign({}, sicht, { me: { id: 1, action: null } }));
  ok(panels.length === 0, 'ohne Scan zeichnet draw nichts');
  // D5: ODA-Zeile unten ändert die Lage nicht (sie wird während des Scans nicht gezeichnet)
  const odaAlt = H.odaHoehe; H.odaHoehe = () => 30;
  zeichne(sicht); const mitOda = panels[0].y; H.odaHoehe = odaAlt; zeichne(sicht);
  ok(mitOda === panels[0].y && S.rechteck().y === panels[0].y, 'läuft unten eine ODA-Zeile, bleibt das Panel an seiner festen Stelle (kein Springen)');
  ok(S.sterne(0) === '[---]' && S.sterne(1) === '[*--]' && S.sterne(3) === '[***]' && S.sterne(-4) === '[---]' && S.sterne(NaN) === '[---]', 'sterne(): [---] bis [***], begrenzt');
}

section('HUD: Name, Zelle, nie aktive Waffe');
ok(H.WAFFE_KURZ.scanner === 'Scanner' && H.WAFFE_NAME.scanner === 'Scanner', 'WAFFE_KURZ und WAFFE_NAME kennen den Scanner');
ok(Array.isArray(H.SLOT_ITEMS) && H.SLOT_ITEMS.includes('scanner') && !H.SLOT_ITEMS.some((i) => PROTO.WAFFEN.includes(i)), 'SLOT_ITEMS = [scanner], keine Waffe');
const zelle = (slots, wf, aktion) => {
  calls.length = 0; const fills = [];
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect(x, y, w, h) { fills.push({ x, w, c: this.fillStyle }); }, strokeRect() {} };
  H.loadoutStand = { slotzahl: slots.length, slots };
  H.wechselSperre = null;
  H.drawSlotZeile.call(H, ctx, { me: { wf, action: aktion || null }, time: 1 }, 8, 50);
  return { fills, texte: calls.map((c) => c.txt), calls: calls.slice() };
};
let z = zelle(['sturmgewehr', 'scanner', 'lanze'], 'sturmgewehr');
ok(['1', '2', '3'].every((k) => z.texte.includes(k)) && z.texte.includes('Scanner'), 'Zelle zeigt Ziffer und Namen „Scanner“ wie bei Waffen');
ok(z.fills.filter((f) => f.c === '#B83A2E').length === 1 && z.fills.some((f) => f.c === '#27394A') && z.fills.filter((f) => f.c === '#46282B').length === 1, 'Aktiv-Rahmen (Rot) nur an der Waffe; der Scanner hat seine eigene kühle Grundfarbe, die Lanze bleibt Waffenfarbe');
z = zelle(['scanner', 'lanze', null], 'faust');
ok(!z.fills.some((f) => f.c === '#B83A2E'), 'Scanner im Slot und Fäuste getragen: kein Aktiv-Rahmen (ein Item ist nie die aktive Waffe)');
z = zelle(['scanner', 'sturmgewehr', null], 'scanner');
ok(!z.fills.some((f) => f.c === '#B83A2E'), 'selbst wenn wf fälschlich „scanner“ hieße: der Scanner wird nicht zur aktiven Waffe gerahmt (wf trägt nur Waffen)') ;
z = zelle(['sturmgewehr', 'scanner', 'lanze'], 'sturmgewehr', { kind: 'scan', progress: 0.3 });
ok(z.fills.some((f) => f.c === '#3F7F99') && !z.fills.some((f) => f.c === '#27394A'), 'beim laufenden Scan hebt sich die Zelle in Eisblau ab');
z = zelle(['sturmgewehr', 'scanner', 'lanze'], 'sturmgewehr', { kind: 'minigame' });
ok(z.fills.some((f) => f.c === '#27394A') && !z.fills.some((f) => f.c === '#3F7F99'), 'andere Aktion: keine Scan-Hervorhebung');
{
  const nm = z.calls.find((c) => c.txt === 'Scanner');
  ok(nm && R.measure(nm.txt) <= Math.floor(164 / 3) - 2 - 10, '„Scanner“ passt in die 3-Slot-Zelle (' + (nm && R.measure(nm.txt)) + ' ≤ ' + (Math.floor(164 / 3) - 12) + ')');
  let fehler = null;
  try { for (const sl of [['scanner', null], ['scanner', 'scanner', null], [null, null, 'scanner']]) zelle(sl, 'faust'); } catch (e) { fehler = e; }
  ok(!fehler, 'Loadouts mit Scanner zeichnen ohne Fehler' + (fehler ? ': ' + fehler.message : ''));
}

section('Ausrüstungsstation: Scanner wählbar');
{
  // consoles.js im Sandkasten laden (Stationsdaten und -tasten sind reine Funktionen über Consoles.ausr)
  const proxy = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : proxy()), apply: () => proxy(), construct: () => proxy() });
  const w2 = { performance, localStorage: win.localStorage, Render: R, Hud: H, Shared_Maps: {}, Shared_Config: CONFIG, Shared_Protocol: PROTO, Tasten: T, Scanner: S, Net: { guard: (nm, f) => f(), on() {}, reportError() {} }, console };
  w2.window = w2;
  vm.createContext(w2);
  let K = null, fehler = null;
  try { vm.runInContext(read('public/js/consoles.js'), w2, { filename: 'consoles.js' }); K = w2.Consoles; } catch (e) { fehler = e; }
  ok(K && typeof K.ausruestungWahl === 'function', 'consoles.js lädt im Sandkasten' + (fehler ? ': ' + fehler.message : ''));
  if (K) {
    const wahl = K.ausruestungWahl();
    ok(wahl[0] === null && PROTO.WAFFEN_WAHL.every((id, i) => wahl[i + 1] === id) && wahl[wahl.length - 1] === 'scanner' && wahl.length === PROTO.WAFFEN_WAHL.length + 2, 'Auswahlliste: leer, die sechs Waffen, dann Scanner (immer wählbar, auch ohne Scan-Ziele)');
    ok(K.ausruestungName('scanner') === 'Scanner', 'Anzeigename „Scanner“ (kein doppelter Kurzname)');
    K.ausr.stand = { slotzahl: 3, slots: ['sturmgewehr', null, null] };
    ok(K.ausruestungGrund('scanner', 1) === null && K.ausruestungGesperrt('scanner', 1) === false, 'Scanner in einen freien Slot: möglich, Zeile nicht gesperrt');
    K.ausr.stand = { slotzahl: 3, slots: ['scanner', null, null] };
    ok(/Steckt schon in Slot 1/.test(K.ausruestungGrund('scanner', 1)) && K.ausruestungGesperrt('scanner', 1), 'steckt der Scanner schon in Slot 1: für Slot 2 gesperrt (wie bei Waffen)');
    // Direktwahl und Cursor: Taste 7 wählt den Scanner
    const gesendet = [];
    const view = { send: (o) => gesendet.push(o), state: {}, me: {} };
    K.cmd = (v, c, extra) => gesendet.push(Object.assign({ c }, extra));
    K.denied = () => {};
    K.ausr.stand = { slotzahl: 3, slots: ['sturmgewehr', null, null] }; K.ausr.sel = 1; K.ausr.fokus = 'waffe';
    K.ausruestungTaste('Digit7', view);
    ok(gesendet.length === 1 && gesendet[0].c === 'ausruestung.slot' && gesendet[0].slot === 1 && gesendet[0].id === 'scanner', 'Taste 7 setzt den Scanner in den gewählten Slot (ausruestung.slot { slot 1, id scanner })');
    K.ausr.cur = K.ausruestungWahl().length - 1; gesendet.length = 0;
    K.ausruestungTaste('Enter', view);
    ok(gesendet.length === 1 && gesendet[0].id === 'scanner', 'Enter auf der Scanner-Zeile setzt ihn');
    K.ausr.cur = 0; K.ausruestungTaste('ArrowUp', view);
    ok(K.ausr.cur === K.ausruestungWahl().length - 1, 'Pfeil hoch aus der obersten Zeile springt auf die Scanner-Zeile (Liste umlaufend)');
    // Zeichnen: Beschreibung und Symbol
    calls.length = 0; const c = ctxStub(); const sym = []; w2.Scanner = { symbol: (cc, x, y, col) => sym.push([x, y, col]) };
    K.ausr.stand = { slotzahl: 3, slots: ['sturmgewehr', 'scanner', null] }; K.ausr.sel = 1; K.ausr.cur = K.ausruestungWahl().length - 1; K.ausr.fehler = null;
    R.button = (ctx, x, y, w, h, lab, o) => { calls.push({ txt: 'BTN:' + lab, x, y, o }); };
    R.wrap = (t, w) => { const out = []; let z = ''; for (const wd of String(t).split(' ')) { if ((z + ' ' + wd).trim().length * 6 > w && z) { out.push(z); z = wd; } else z = (z + ' ' + wd).trim(); } if (z) out.push(z); return out; };
    let hilfe = null, f2 = null;
    try { hilfe = K.drawAusruestung(c, view); } catch (e) { f2 = e; }
    ok(!f2, 'drawAusruestung mit Scanner zeichnet ohne Fehler' + (f2 ? ': ' + f2.message : ''));
    const t2 = calls.map((x) => x.txt).join('\n');
    ok(/BTN:Scanner/.test(t2) && calls.some((x) => x.txt === 'BTN:Scanner' && x.o.hotkey === '7'), 'Zeile „Scanner“ mit Taste 7 in der Auswahl');
    ok(/Scanner: findet Erz, scannt Monster und Fallen\. Slot-Taste startet, A\/D stimmt ab\./.test(calls.map((x) => x.txt).filter((x) => !x.startsWith('BTN:')).join(' ')) || calls.filter((x) => !x.txt.startsWith('BTN:')).map((x) => x.txt).join(' ').replace(/\s+/g, ' ').includes('Scanner: findet Erz, scannt Monster und Fallen. Slot-Taste startet, A/D stimmt ab.'), 'Beschreibung „Scanner: findet Erz, scannt Monster und Fallen. Slot-Taste startet, A/D stimmt ab.“ steht in der Station');
    ok(sym.length === 1 && sym[0][2] === '#ice', 'Slot mit Scanner zeigt das Scanner-Symbol in Eisblau (die Waffen-Icons kennen keine Items)');
    ok(/Am Boden aktiv: Gewehr/.test(t2), 'am Boden aktiv bleibt die erste Waffe');
    K.ausr.stand = { slotzahl: 3, slots: ['scanner', null, null] }; calls.length = 0; K.drawAusruestung(c, view);
    ok(/Kein Waffen-Slot = Fäuste/.test(calls.map((x) => x.txt).join('\n')) && !/Am Boden aktiv: Scanner/.test(calls.map((x) => x.txt).join('\n')), 'nur Scanner im Slot: „Kein Waffen-Slot = Fäuste.“ (ein Item ist nie die aktive Waffe)');
    ok(/1–7 direkt/.test(hilfe), 'Hilfezeile nennt 1–7');
  }
}

section('Nacharbeit D10: HUD-Zelle beim Scan mit 1-px-Eisblau-Rahmen');
{
  const strokes = [];
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect() {}, strokeRect(x, y, w, h) { strokes.push({ c: this.strokeStyle, w, h }); } };
  const zeichneZelle = (aktion) => { strokes.length = 0; H.loadoutStand = { slotzahl: 3, slots: ['sturmgewehr', 'scanner', 'lanze'] }; H.wechselSperre = null; H.drawSlotZeile.call(H, ctx, { me: { wf: 'sturmgewehr', action: aktion }, time: 1 }, 8, 50); return strokes.slice(); };
  ok(zeichneZelle({ kind: 'scan' }).filter((q) => q.c === '#ice').length === 1, 'laufender Scan: genau ein Eisblau-Rahmen (strokeRect) um die Scanner-Zelle');
  ok(zeichneZelle(null).every((q) => q.c !== '#ice') && zeichneZelle({ kind: 'minigame' }).every((q) => q.c !== '#ice'), 'ohne Scan: kein Rahmen');
}

section('Nacharbeit D5: ODA-Zeile wird während des Scans nicht gezeichnet (Marke „ODA +n“ bleibt)');
{
  H.oda = { queue: [{ text: 'a' }, { text: 'b' }], cur: { text: 'Hier spricht die Orbitale Datenanalyse, bitte kommen.', shown: 999 } };
  const rects = [];
  const c2 = { fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect(x, y, w, h) { rects.push({ x, y, w, h }); }, strokeRect() {} };
  calls.length = 0;
  H.drawOda(c2, { me: { action: { kind: 'scan' } }, time: 1 }, false);
  ok(!rects.some((q) => q.w === 284) && !calls.some((q) => /Hier spricht/.test(q.txt)), 'Scan läuft: keine ODA-Zeile (kein 284-px-Feld, kein Text)');
  ok(calls.some((q) => q.txt === 'ODA +2'), 'Zähler bleibt sichtbar als kleine Marke „ODA +2“');
  const r0 = S.rechteck();
  ok(rects.every((q) => q.y + q.h <= r0.y), 'die Marke liegt über dem Overlay und überdeckt es nicht');
  rects.length = 0; calls.length = 0;
  H.drawOda(c2, { me: { action: null }, time: 1 }, false);
  ok(rects.some((q) => q.w === 284) && calls.some((q) => /Hier spricht/.test(q.txt)), 'nach dem Scan erscheint die ODA-Zeile wieder');
  rects.length = 0; calls.length = 0;
  H.drawOda(c2, { me: { action: { kind: 'scan' } }, time: 1 }, true);
  ok(rects.some((q) => q.w === 284), 'an der Konsole (top) gilt die Regel nicht');
  H.oda = { queue: [], cur: null };
}

section('Nacharbeit N4: Boden-Slots nie auf A, D, Pfeil links/rechts, Rücktaste');
{
  const std = (id) => T.aktion(id).std.join();
  for (const code of ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Shift+KeyD', 'Shift+Backspace']) {
    ok(T.setze('boden.slot2', 0, code) === false && T.belegung('boden.slot2').join() === std('boden.slot2') && T.reserviert(code), code + ': Umbelegung abgelehnt, Belegung unverändert');
  }
  ok(T.setze('boden.slot2', 0, 'KeyU') === true && T.belegung('boden.slot2')[0] === 'KeyU', 'eine freie Taste (U) lässt sich weiterhin belegen');
  T.zuruecksetzen('boden');
  speicher['pantheon.tasten'] = JSON.stringify({ 'boden.slot1': ['KeyD'], 'boden.slot3': ['Backspace'], 'boden.slot2': ['KeyU'] });
  T.laden();
  ok(T.belegung('boden.slot1').join() === std('boden.slot1') && T.belegung('boden.slot3').join() === std('boden.slot3'), 'gespeicherte Altbelegungen auf D / Rücktaste werden beim Laden verworfen (Standard gilt)');
  ok(T.belegung('boden.slot2')[0] === 'KeyU', 'eine gültige gespeicherte Belegung bleibt');
  delete speicher['pantheon.tasten']; T.laden();
  ok(T.AKTIONEN.filter((a) => a.gruppe === 'boden').every((a) => a.std.every((t) => !T.reserviert(t))), 'keine Standardbelegung am Boden liegt auf einer reservierten Taste');
  ok(T.konflikte('boden').length === 0, 'Boden ohne Konflikte');
  // Verhalten: Scanner im Slot 2, Standardtasten: D stimmt die Frequenz (bricht nicht ab), Slot-Taste 2 bricht ab
  S.loslassen();
  let r2 = S.taste(ev('KeyD'), true, STAND);
  ok(r2.senden.length === 1 && r2.senden[0].c === 'scan.stimme' && r2.senden[0].dir === 1, 'D stimmt die Frequenz (scan.stimme dir +1), kein Abbruch');
  S.loslassen();
  ok(S.taste(ev('Digit2'), true, STAND).senden[0].c === 'slot.nutzen', 'die Slot-Taste des Scanners bricht weiterhin ab');
}

section('Nacharbeit N5: Datenblatt, Klicks, Tasten, Störrelais als Verhalten (consoles.js im Sandkasten)');
{
  const proxy = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : proxy()), apply: () => proxy(), construct: () => proxy() });
  const w3 = { performance, localStorage: win.localStorage, Render: R, Hud: H, Shared_Maps: {}, Shared_Config: CONFIG, Shared_Protocol: PROTO, Tasten: T, Scanner: S, Net: { guard: (nm, f) => f(), on() {}, reportError() {} }, console };
  w3.window = w3;
  vm.createContext(w3);
  vm.runInContext(read('public/js/scan-anzeige.js'), w3, { filename: 'scan-anzeige.js' });
  vm.runInContext(read('public/js/consoles.js'), w3, { filename: 'consoles.js' });
  const K = w3.Consoles, SA = w3.ScanAnzeige;
  ok(K && SA && typeof K.scanMass === 'function' && typeof SA.blattZeilen === 'function', 'consoles.js und scan-anzeige.js laden im Sandkasten');
  const DATEN = JSON.parse(read('content/scanner/datenblaetter.json'));
  const REAL = { name: 'Panzerkäfer', gefahr: 3, zeile: 'Schweres Tier, jagt im Rudel.', hinweis: 'Panzerung vorn, Schwachstelle am Rücken. Bäume und Felsen halten es auf.', hinweisAb: 1, symbol: 'PK' };
  const LANG = Object.assign({}, REAL, { name: 'Vierundzwanzigzeichenname', hinweis: 'Ein überlanger Regelhinweis, der weit mehr als hundert Zeichen hat und deshalb gekürzt werden muss, ohne die Positionszeile zu verdrängen. Wirklich.' });
  SA.store.daten = Object.assign({}, DATEN, { typen: Object.assign({}, DATEN.typen, { real: REAL, lang: LANG }) });
  R.ui = { buttons: [] };
  R.measure = (t) => Math.round(String(t).length * 4.9 * 10) / 10;
  const W = 318;   // Breite der Karte im echten Layout (Außenteam-Reiter, 640 x 360)
  const zeichne = (sc, stoer) => {
    calls.length = 0; R.ui.buttons.length = 0;
    SA.beobachte(sc);
    const scan = K.scanAnsicht({ sc }), blk = K.scanMass(scan, W);
    const fills = [], strokes = [];
    const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect(x, y, w, h) { fills.push({ x, y, w, h, c: this.fillStyle }); }, strokeRect(x, y, w, h) { strokes.push({ x, y, w, h, c: this.strokeStyle }); } };
    const X0 = 312, Y0 = 170;
    K.scanZeichne(ctx, scan, blk, X0, Y0, W, !!stoer);
    return { scan, blk, ctx, fills, strokes, calls: calls.slice(), X0, Y0 };
  };

  // D9: die Blockhöhe hängt nicht vom Text des Fokus ab (die Kartenzelle springt nicht)
  const hoehen = new Set();
  for (const sc of [[['a', 'test', 'testerz', 1]], [['a', 'test', 'real', 3, 224, 96]], [['a', 'test', 'lang', 1]], [['a', 'x', 'real', 1], ['b', 'x', 'real', 2], ['c', 'x', 'real', 3], ['d', 'x', 'real', 1], ['e', 'x', 'real', 1], ['f', 'x', 'real', 1]]]) hoehen.add(zeichne(sc).blk.h);
  ok(hoehen.size === 1 && [...hoehen][0] === 11 + 10 + 10 * SA.MAXL_BLATT, 'D9: blk.h ist immer gleich (' + [...hoehen].join() + '), egal ob 1 oder 6 Einträge, kurzer oder langer Text');

  // D2/D7/D8: kein Überlauf mit echtem langem Text, Position als letzte Zeile, Hierarchie, Gefahr nicht nur über Farbe
  for (const [titel, sc] of [['real Stufe 1', [['a', 'test', 'real', 1]]], ['real Stufe 3', [['a', 'test', 'real', 3, 224, 96]]], ['überlanger Hinweis, Stufe 3', [['a', 'test', 'lang', 3, 224, 96]]], ['überlanger Hinweis, Stufe 1', [['a', 'test', 'lang', 1]]]]) {
    const z = zeichne(sc), r = { x: z.X0, y: z.Y0, w: W, h: z.blk.h };
    const sx = z.X0 + z.blk.LW + 8, rechts = z.X0 + W, unten = z.Y0 + z.blk.h;
    const ueber = z.calls.filter((q) => q.x + R.measure(q.txt) > rechts + 0.5 || q.y + 8 > unten + 0.5 || q.x < z.X0);
    ok(ueber.length === 0, titel + ': kein Text über den Rand' + (ueber.length ? ' (' + ueber.map((q) => q.txt).join(' | ') + ')' : ''));
    const blatt = z.calls.filter((q) => q.x >= sx);
    const pos = blatt.filter((q) => /^Position: /.test(q.txt));
    ok(pos.length === 1 && blatt.every((q) => q.y <= pos[0].y), titel + ': Position steht (genau einmal) als letzte Zeile des Datenblatts: „' + (pos[0] && pos[0].txt) + '“');
    ok(pos[0] && pos[0].o.color === (/Feld/.test(pos[0].txt) ? '#ice' : '#panelLight') && !blatt.some((q) => q.o.color === '#mint'), titel + ': Position Eisblau (bekannt) bzw. Grau (unbekannt), kein Mint');
    const name = blatt.find((q) => q.txt === q.txt.toUpperCase() && q.o.color === '#ice' && /[A-Z]/.test(q.txt) && !/^Position/.test(q.txt));
    ok(name && name.o.color === '#ice', titel + ': Name in Versalien und Eisblau („' + (name && name.txt) + '“)');
    ok(blatt.some((q) => q.txt === 'GEFAHR') && z.strokes.length >= 0, titel + ': Beschriftung „GEFAHR“ vor den Kästchen');
    const hinweis = blatt.filter((q) => q.o.color === '#star' && q.x === sx + SA.HINWEIS_EINZUG);
    if (!/Stufe 1/.test(titel) || /real/.test(titel)) ok(hinweis.length >= 1 && z.fills.some((f) => f.c === '#ice' && f.w === 1 && f.x === sx), titel + ': Hinweis 7 px eingerückt mit 1-px-Eisblau-Strich links');
    if (/überlang/.test(titel)) ok(/…$/.test(hinweis[hinweis.length - 1].txt), titel + ': Hinweis endet mit „…“, Position bleibt');
    // Kästchen: Gefahr 3 = drei volle (Rot), keine Umrisse; leere sind Umrisse
    ok(z.fills.filter((f) => f.c === '#red' && f.w === 4).length >= 3, titel + ': volle Gefahrenkästchen gefüllt (Rot)');
  }
  {
    const z = zeichne([['a', 'test', 'testerz', 1]]);   // Gefahr 0
    ok(z.strokes.filter((q) => q.c === '#grey' && q.w === 3).length >= 6 && z.fills.filter((f) => f.c === '#red').length === 0, 'D8: Gefahr 0 = drei leere Kästchen als 1-px-Umriss in Liste UND Datenblatt, keine Füllung (lesbar ohne Farbe)');
    const ls = z.calls.find((q) => q.txt === 'GEF'), st = z.calls.find((q) => q.txt === 'SCAN' && q.y === z.Y0), stern = z.calls.find((q) => /^\[/.test(q.txt));
    const pipX = Math.min(...z.strokes.filter((q) => q.c === '#grey' && q.w === 3 && q.x < z.X0 + z.blk.LW).map((q) => q.x));
    ok(ls && st && stern && stern.x - (pipX + 16) >= 8, 'D8: Sterne in eigener Spalte rechts, Abstand zur Gefahr ' + (stern && Math.round((stern.x - (pipX + 16)) * 10) / 10) + ' px (>= 8), Kopfzeile „GEF“ / „SCAN“');
    ok(stern.x + R.measure(stern.txt) <= z.X0 + z.blk.LW, 'Sterne liegen in der Listenspalte');
  }

  // Liste: kein Namensüberlauf in die Gefahrenspalte
  {
    const z = zeichne([['a', 'test', 'lang', 3, 1, 1], ['b', 'x', 'unbekannt', 1]]);
    const liste = z.calls.filter((q) => q.x >= z.X0 + 15 && q.x < z.X0 + z.blk.LW - 40 && q.y > z.Y0);
    ok(liste.length > 0, 'Liste gezeichnet');
    const pipX = Math.min(...z.strokes.concat(z.fills.map((f) => Object.assign({}, f))).filter((q) => (q.c === '#grey' || q.c === '#red') && q.x < z.X0 + z.blk.LW).map((q) => q.x));
    ok(liste.every((q) => q.x + R.measure(q.txt) <= pipX), 'Listennamen enden vor der Gefahrenspalte (' + liste.map((q) => q.txt).join(' | ') + ')');
  }

  // N2: Störrelais-Zeile auch mit Scan-Ergebnissen
  {
    const mit = zeichne([['a', 'test', 'testerz', 1]], true), ohne = zeichne([['a', 'test', 'testerz', 1]], false);
    ok(mit.calls.some((q) => /^Störrelais stören den Scan/.test(q.txt)) && !ohne.calls.some((q) => /Störrelais/.test(q.txt)), 'N2: bei q < 1 steht „Störrelais stören den Scan“ auch mit Ergebnissen, bei klarem Scan nicht');
    ok(mit.calls.every((q) => q.x + R.measure(q.txt) <= mit.X0 + W + 0.5), 'N2: die Zeile läuft nicht über den Rand');
    const c = read('public/js/consoles.js');
    ok(/this\.scanZeichne\(ctx, scan, blk, rect\.x, ly, rect\.w, q < 1\)/.test(c), 'capAwayV2 übergibt q < 1 an scanZeichne (Verdrahtung)');
  }

  // D3: Marker-Klick wählt nur den Fokus; Shift+Klick und Klick daneben setzen den Befehl
  {
    const sent = [];
    K.cmd = (v, c, extra) => sent.push(Object.assign({ c }, extra));
    K.denied = () => {};
    K.order = { kind: 'sammeln' };
    K.keys = {};
    K.maps.away = { rect: { x: 300, y: 10, w: 300, h: 150 }, toW: (x, y) => ({ x: x * 2, y: y * 2 }), enemyRects: [], scanRects: [{ key: 'test:a', x: 400, y: 60, w: 16, h: 16 }, { key: 'test:b', x: 500, y: 60, w: 16, h: 16 }] };
    SA.beobachte([['a', 'test', 'testerz', 1, 1, 1], ['b', 'test', 'testerz', 1, 2, 2]]);
    const view = { state: { away: {} }, drones: [], actions: { sfx() {} } };
    sent.length = 0;
    let rv = K.awayMapClick(view, 408, 68, 0);
    ok(rv === true && sent.length === 0 && SA.fokusKey() === 'test:a', 'D3: Klick auf den Marker: Fokus gewählt, return true, KEIN Befehl');
    rv = K.awayMapClick(view, 508, 68, 0, false);
    ok(rv === true && sent.length === 0 && SA.fokusKey() === 'test:b', 'D3: Klick auf den zweiten Marker: Fokus wechselt, kein Befehl');
    rv = K.awayMapClick(view, 408, 68, 0, true);
    ok(rv === true && sent.length === 1 && sent[0].c === 'captain.order' && sent[0].kind === 'sammeln' && sent[0].x === 816 && SA.fokusKey() === 'test:b', 'D3: Shift+Klick auf den Marker setzt den Befehl (Fokus bleibt)');
    sent.length = 0; K.keys = { ShiftLeft: true };
    K.awayMapClick(view, 408, 68, 0);
    ok(sent.length === 1 && sent[0].c === 'captain.order', 'D3: gehaltene Shift-Taste (Consoles.keys) wirkt wie Shift+Klick');
    K.keys = {}; sent.length = 0;
    rv = K.awayMapClick(view, 450, 100, 0);
    ok(rv === true && sent.length === 1 && sent[0].c === 'captain.order' && sent[0].x === 900, 'D3: Klick daneben setzt den Befehl wie bisher');
    sent.length = 0;
    K.awayMapClick(view, 408, 68, 2);
    ok(sent.length === 1 && sent[0].clear === true, 'Rechtsklick auf den Marker löscht den Befehl wie bisher');
    ok(K.awayMapClick(view, 10, 10, 0) === false && sent.length === 1, 'Klick außerhalb der Karte: false, nichts gesendet');
  }

  // D4: Taste -> Fokus durch alle Einträge (Consoles.keyDown, Reiter Außenteam)
  {
    const sc = [['a', 'test', 'testerz', 1], ['b', 'test', 'testmonster', 1], ['c', 'test', 'testerz', 3], ['d', 'test', 'testerz', 2], ['e', 'test', 'testmonster', 3], ['f', 'test', 'testerz', 1]];
    const view = { state: { phase: 'play', away: { active: true, sc }, players: [] }, me: { console: 'captain' }, drones: [], actions: { sfx() {}, leave() {} }, send() {} };
    SA.beobachte(sc);
    K.tab = 3; K.keys = {};
    K.isAwayV2 = () => true;
    const ids = [];
    SA.waehle(SA.ansicht(sc, 12).zeilen[0].key);
    let verbraucht = true;
    for (let i = 0; i < sc.length; i++) { ids.push(SA.fokusKey()); verbraucht = K.keyDown(ev('PageDown'), view) && verbraucht; }
    ok(verbraucht && new Set(ids).size === sc.length && SA.fokusKey() === ids[0], 'D4: BildB schaltet reihum durch alle 6 Einträge (' + ids.join(' ') + ') und wieder zum Anfang');
    K.keyDown(ev('PageUp'), view);
    ok(SA.fokusKey() === ids[ids.length - 1], 'D4: BildA geht rückwärts (umlaufend)');
    const sichtbar = SA.ansicht(sc, SA.MAX_ZEILEN);
    ok(sichtbar.zeilen.includes(sichtbar.fokus) && sichtbar.rest === 2, 'der Fokus ist nach dem Umschalten in den 4 Listenzeilen sichtbar, „+2 weitere“');
    // umbelegt: die Taste der Aktion gilt, die Standardtaste nicht mehr
    T.setze('captain.aussen.scanVor', 0, 'KeyM');
    const f0 = SA.fokusKey();
    K.keyDown(ev('PageDown'), view);
    ok(SA.fokusKey() === f0, 'umbelegt (M): die Standardtaste BildB tut nichts mehr');
    K.keyDown(ev('KeyM'), view);
    ok(SA.fokusKey() !== f0, 'umbelegt (M): die neue Taste schaltet weiter');
    ok(/ M\//.test(K.aussenHilfeScan().replace('/', ' M/')) && /BildA\/M Ergebnis/.test(K.aussenHilfeScan()), 'die Hilfezeile nennt die echte Taste: „' + K.aussenHilfeScan() + '“');
    T.zuruecksetzen('captain');
    ok(/BildA\/BildB Ergebnis/.test(K.aussenHilfeScan()) && K.aussenHilfeScan().length <= 92, 'Standard-Hilfezeile „' + K.aussenHilfeScan() + '“ (' + K.aussenHilfeScan().length + ' Zeichen)');
    K.tab = 0;
  }
  SA.beobachte([]);
}

console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ok');
process.exit(fails ? 1 : 0);
