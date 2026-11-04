'use strict';
// AUS-02 B: Client des Waffenwechsels am Boden – Tasten 1–3 (Tastenregister boden.slot1..3), Slotzahl-Prüfung, HUD (Ziffern, Hilfezeile, Sperr-Zustand) und die Verdrahtung in client.js.
// client.js läuft nicht in Node; die Entscheidungen stehen deshalb in Tasten.slotVon und Hud.slotErlaubt/wechselStart/wechselAnteil (hier ausgeführt), die Einhängestellen in client.js werden am Quelltext geprüft.
// Das Zusammenspiel im echten Browser zeigt tools/aus02-b-shots.js.   node tools/test-waffenwechsel-client.js  (npm run test:waffenwechsel-client)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const ev = (code, shift) => ({ code, shiftKey: !!shift });

const CONFIG = require('../shared/config.js');
const calls = [];
const R = { PAL: new Proxy({}, { get: (t, k) => '#' + String(k) }), text(ctx, txt, x, y, o) { calls.push({ txt: String(txt), x, y, o: o || {} }); }, measure: (t) => String(t).length * 6 };
const win = { Render: R, Shared_Maps: {}, Shared_Config: CONFIG, Shared_Protocol: require('../shared/protocol.js'), Net: { guard: (nm, f) => f(), on() {} } };
win.window = win;
vm.createContext(win);
vm.runInContext(read('public/js/tasten.js'), win, { filename: 'tasten.js' });
vm.runInContext(read('public/js/hud.js'), win, { filename: 'hud.js' });
const T = win.Tasten, H = win.Hud;

section('Tastenregister: Slots 1–3');
ok(T.slotVon(ev('Digit1')) === 0 && T.slotVon(ev('Digit2')) === 1 && T.slotVon(ev('Digit3')) === 2, 'Digit1/2/3 -> Slot 0/1/2');
ok(T.slotVon(ev('Numpad1')) === 0 && T.slotVon(ev('Numpad2')) === 1 && T.slotVon(ev('Numpad3')) === 2, 'Numpad1/2/3 -> Slot 0/1/2');
ok(T.slotVon(ev('Digit4')) === -1 && T.slotVon(ev('Digit0')) === -1 && T.slotVon(ev('KeyQ')) === -1 && T.slotVon(ev('KeyC')) === -1, '4, 0, Q und C sind keine Slottasten');
ok(T.slotVon(ev('Digit1', true)) === -1, 'Shift+1 wechselt nicht');
ok(T.slotVon(ev('ShiftLeft', true)) === -1 && T.slotVon({}) === -1 && T.slotVon(null) === -1, 'reine Umschalttaste/leeres Ereignis: kein Slot');
ok(['boden.slot1', 'boden.slot2', 'boden.slot3'].every((id) => T.aktion(id) && T.aktion(id).gruppe === 'boden'), 'Aktionen boden.slot1..3 in der Gruppe boden');
ok(T.GRUPPEN.some((g) => g.id === 'boden'), 'Gruppe boden im Steuerungsmenü');
ok(T.konflikte('boden').length === 0, 'Gruppe boden ohne Konflikte (auch gegen allgemein: Tab, Esc, ?)');
ok(T.kappe('boden.slot1') === '1' && T.kappe('boden.slot3') === '3', 'Tastenkappe zeigt 1 und 3');
T.setze('boden.slot2', 0, 'KeyU');
ok(T.slotVon(ev('KeyU')) === 1 && T.slotVon(ev('Digit2')) === -1 && T.slotVon(ev('Numpad2')) === 1 && T.kappe('boden.slot2') === 'U', 'umbelegt: U wechselt auf Slot 2 (ersetzt die Ziffer), Kappe zeigt U, Ziffernblock bleibt');
T.zuruecksetzen('boden');
ok(T.slotVon(ev('KeyU')) === -1 && T.kappe('boden.slot2') === '2', 'zurückgesetzt: wieder Standard');
ok(!T.AKTIONEN.some((a) => a.gruppe === 'boden' && a.std.includes('KeyQ')), 'keine Bodenaktion auf Q (Markierung bleibt fest verdrahtet)');

section('Slotzahl-Prüfung (Hud.slotErlaubt)');
H.loadoutStand = null;
ok(H.slotErlaubt(0) && H.slotErlaubt(2), 'ohne Stand entscheidet der Server: 0..2 erlaubt');
ok(!H.slotErlaubt(-1) && !H.slotErlaubt(3) && !H.slotErlaubt(NaN), 'außerhalb 0..2 nie');
H.loadoutStand = { slotzahl: 2, slots: ['sturmgewehr', 'lanze'] };
ok(H.slotErlaubt(0) && H.slotErlaubt(1) && !H.slotErlaubt(2), 'Slotzahl 2: Taste 3 sendet nichts');
H.loadoutStand = { slotzahl: 3, slots: ['sturmgewehr', 'lanze', null] };
ok(H.slotErlaubt(0) && H.slotErlaubt(1) && H.slotErlaubt(2), 'Slotzahl 3: alle drei erlaubt (leeren Slot lehnt der Server ab)');

section('Sperr-Zustand nach Ereignis loadout');
H.wechselSperre = null;
ok(H.wechselAnteil(5) === null, 'ohne Ereignis keine Sperre');
H.wechselStart(10, 0.6);
ok(H.wechselAnteil(10) < 1e-9 && Math.abs(H.wechselAnteil(10.3) - 0.5) < 1e-9, 'Sperre läuft: Anteil 0 am Start, 0,5 nach halber Zeit');
ok(H.wechselAnteil(10.6) === null && H.wechselAnteil(11) === null, 'Sperre endet nach sperre Sekunden (view.time)');
H.wechselStart(10, 0);
ok(H.wechselAnteil(10) === null, 'sperre 0: keine Anzeige');
H.wechselStart(10, undefined);
ok(H.wechselAnteil(10.1) === null, 'sperre fehlt: keine Anzeige, kein Absturz');

section('HUD zeichnet (2 und 3 Slots, Ziffern, Sperre)');
const zeichne = (slots, wf, time) => {
  calls.length = 0;
  const fills = [];
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect(x, y, w, h) { fills.push({ x, w, c: this.fillStyle }); }, strokeRect() {} };
  H.drawSlotZeile.call(H, ctx, { me: { wf }, time }, 8, 50);
  return { fills, texte: calls.map((c) => c.txt) };
};
H.loadoutStand = { slotzahl: 3, slots: ['sturmgewehr', 'lanze', null] };
H.wechselSperre = null;
let z = zeichne(['sturmgewehr', 'lanze', null], 'sturmgewehr', 1);
ok(['1', '2', '3'].every((k) => z.texte.includes(k)), '3 Slots: Ziffern 1, 2, 3 stehen in den Zellen');
ok(z.texte.includes('Gewehr') && z.texte.includes('Lanze') && z.texte.includes('–'), '3 Slots: Kurznamen und leerer Slot bleiben');
ok(z.fills.filter((f) => f.c === '#B83A2E').length === 1 && !z.fills.some((f) => f.c === '#5A2A28'), 'ohne Sperre: aktive Zelle voll rot, kein Sperr-Hintergrund');
H.loadoutStand = { slotzahl: 2, slots: ['sturmgewehr', 'lanze'] };
z = zeichne(['sturmgewehr', 'lanze'], 'lanze', 1);
ok(['1', '2'].every((k) => z.texte.includes(k)) && !z.texte.includes('3'), '2 Slots: nur Ziffern 1 und 2');
H.loadoutStand = { slotzahl: 3, slots: ['sturmgewehr', 'lanze', null] };
H.wechselStart(20, 0.6);
z = zeichne(['sturmgewehr', 'lanze', null], 'lanze', 20.3);
ok(z.fills.some((f) => f.c === '#5A2A28') && z.fills.some((f) => f.c === '#C98A2E' && f.w > 0 && f.w < 52), 'während der Wechselzeit: gedämpfter Grund und teilweise gefüllter Balken in der aktiven Zelle');
z = zeichne(['sturmgewehr', 'lanze', null], 'lanze', 20.7);
ok(!z.fills.some((f) => f.c === '#5A2A28') && z.fills.filter((f) => f.c === '#B83A2E').length === 1, 'nach der Wechselzeit: wieder volle aktive Zelle');
z = zeichne(['sturmgewehr', 'lanze', null], 'faust', 20.3);
ok(!z.fills.some((f) => f.c === '#5A2A28'), 'Sperre ohne aktive Zelle (Fäuste): kein Balken');
let kaputt = null;
try { for (const sl of [[null, null, null], ['lanze', null, null], ['lanze', 'granatwerfer', 'schrottblaster']]) zeichne(sl, 'lanze', 20.2); } catch (e) { kaputt = e; }
ok(!kaputt, 'leeres, einzelnes und volles Loadout zeichnen ohne Fehler' + (kaputt ? ': ' + kaputt.message : ''));

section('Hilfezeile am Boden');
H.wechselSperre = null;
H.loadoutStand = { slotzahl: 3, slots: ['sturmgewehr', 'lanze', null] };
ok(H.bodenHilfe(true) === '1-3 Waffe · Q Mark. · C ducken', 'zwei Waffen, 3 Slots: „1-3 Waffe · Q Mark. · C ducken“');
H.loadoutStand = { slotzahl: 2, slots: ['sturmgewehr', 'lanze'] };
ok(H.bodenHilfe(true) === '1-2 Waffe · Q Mark. · C ducken', '2 Slots: „1-2 Waffe …“');
H.loadoutStand = { slotzahl: 3, slots: ['lanze', null, null] };
ok(H.bodenHilfe(true) === 'Klick feuern · Q Mark. · C ducken', 'nur eine Waffe: alter Text, kein Wechselhinweis');
H.loadoutStand = { slotzahl: 3, slots: [null, null, null] };
ok(H.bodenHilfe(true) === 'Klick feuern · Q Mark. · C ducken' && H.bodenHilfe(false) === 'Klick feuern · Q Mark. · C ducken', 'Fäuste (leer) bzw. ohne Slot-Leiste: alter Text');
H.loadoutStand = { slotzahl: 3, slots: ['sturmgewehr', 'lanze', null] };
T.setze('boden.slot1', 0, 'KeyU'); T.setze('boden.slot3', 0, 'KeyO');
ok(H.bodenHilfe(true) === 'U-O Waffe · Q Mark. · C ducken', 'umbelegte Tasten erscheinen in der Hilfezeile');
T.zuruecksetzen('boden');
ok(H.bodenHilfe(true).length <= 'Klick feuern · Q Mark. · C ducken'.length, 'neuer Text ist nicht länger als der alte (Panelbreite)');

section('client.js: Verdrahtung (Quelltext)');
{
  const cl = read('public/js/client.js');
  const iKey = cl.indexOf("window.addEventListener('keydown'");
  const body = cl.slice(iKey, cl.indexOf("window.addEventListener('keyup'"));
  const iUi = body.indexOf("if (uiTop()) { Client.keys = {}; Net.guard('Client.uiKey'");
  const iCons = body.indexOf('if (m.console) { Net.guard(');
  const iMini = body.indexOf('if (Client.minigame)');
  const iGp = body.indexOf('Gespraech.taste(code, send, st)');
  const iSlot = body.indexOf('Tasten.slotVon(e)');
  const iSw = body.indexOf('switch (code) {');
  ok(iUi > 0 && iCons > iUi && iMini > iCons && iGp > iMini && iSlot > iGp && iSw > iSlot && body.lastIndexOf('if (e.repeat) return;', iSlot) > iGp, 'Reihenfolge: UI-Overlay, Konsole, Minispiel, Gespräch, Wiederholungssperre, dann Waffenslot, dann der feste Boden-Switch');
  const blk = body.slice(body.lastIndexOf('if (m.zone', iSlot), iSw);
  ok(/m\.zone === 'away'/.test(blk) && /!st\.gp/.test(blk) && /!H\.showCrew/.test(blk), 'nur am Boden, nicht im Gespräch, nicht bei offenem Crew-Overlay');
  ok(/H\.slotErlaubt\(sl\)/.test(blk) && /c: P\.CMD_SLOT_NUTZEN \|\| 'slot\.nutzen', slot: sl/.test(blk), 'sendet cmd slot.nutzen mit dem Slot, nur wenn slotErlaubt');
  ok(/!m\.downed/.test(blk), 'am Boden liegend wird nichts gesendet');
  ok(/case 'KeyQ':\s*\n\s*if \(m\.zone === 'away'\) \{[\s\S]{0,300}send\(\{ t: P\.C\.MARK \|\| 'mark'/.test(body) && !/case 'KeyQ':[\s\S]{0,300}slot/.test(body.slice(body.indexOf("case 'KeyQ':"), body.indexOf("case 'Tab':"))), 'Q sendet weiterhin die Markierung (mark)');
  const iLo = cl.indexOf("case 'loadout':");
  ok(/case 'loadout':\s*\n\s*if \(ev\.pid === Client\.pid\)/.test(cl) && /if \(ev\.pid === Client\.pid\) \{[^}]*H\.wechselStart\(Client\.time, ev\.sperre\); \}/.test(cl.slice(iLo, iLo + 400)), 'Ereignis loadout setzt die Sperre nur für den eigenen Spieler');
  ok(/ctx\.fillRect\(cx, y - 2, Math\.round/.test(read('public/js/hud.js')), 'hud.js: Sperrbalken in der Slot-Zelle');
}

console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ' + n + ' ok');
process.exit(fails ? 1 : 0);
