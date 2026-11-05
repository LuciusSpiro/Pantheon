'use strict';
// ITM-01 B: Client des Medipacks als Slot-Item – HUD-Zelle (Ladungen aus medkit), Ausrüstungsstation (Symbol, Name, Infotext), Revive-Beschriftung, Texte, dev-mock-Parität.
// hud.js und consoles.js laufen im Sandkasten (mit der echten Pixelschrift art.js für die Breiten); client.js und dev-mock.js laufen nicht in Node: dort prüft der Test die Einhängestellen am Quelltext.
// Das Zusammenspiel mit echtem Server und Browser zeigt tools/itm01-b-shots.js (Zelle 3/2/1/0, Station, Revive-Hinweis über Client.interactionAt, 2D und Voxel).
//   node tools/test-medipack-client.js  (npm run test:medipack-client)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const CONFIG = require('../shared/config.js');
const PROTO = require('../shared/protocol.js');

// echte Pixelschrift nur für die Breiten
const artWin = { document: { createElement: () => ({ getContext: () => ({}), style: {} }) }, console };
artWin.window = artWin;
vm.createContext(artWin);
vm.runInContext(read('public/js/art.js'), artWin, { filename: 'art.js' });
const breite = (t) => artWin.Art.measureText(String(t), 1);

const calls = [];
const R = {
  PAL: new Proxy({}, { get: (t, k) => '#' + String(k) }),
  backdrop() {}, art() { return true; },
  text(ctx, txt, x, y, o) { calls.push({ txt: String(txt), x, y, o: o || {} }); },
  measure: (t) => breite(t),
  panel() {}, bar() {},
};
const speicher = {};
const win = { performance, localStorage: { getItem: (k) => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: (k) => { delete speicher[k]; } }, Render: R, Shared_Maps: {}, Shared_Config: CONFIG, Shared_Protocol: PROTO, Net: { guard: (nm, f) => f(), on() {} } };
win.window = win;
vm.createContext(win);
vm.runInContext(read('public/js/tasten.js'), win, { filename: 'tasten.js' });
vm.runInContext(read('public/js/hud.js'), win, { filename: 'hud.js' });
const H = win.Hud;

section('HUD: Medipack ist ein Slot-Item mit eigenem Namen und Infotext');
ok(H.SLOT_ITEMS.includes('medipack') && H.SLOT_ITEMS.includes('scanner') && !H.SLOT_ITEMS.some((i) => PROTO.WAFFEN.includes(i)), 'SLOT_ITEMS: Scanner und Medipack, keine Waffe');
ok(H.WAFFE_KURZ.medipack === 'Medipack' && H.WAFFE_NAME.medipack === 'Medipack', 'Name „Medipack“ (Kurz = Lang, kein doppelter Name in der Station)');
ok(/Wiederbeleben/.test(H.ITEM_INFO.medipack) && /Lager/.test(H.ITEM_INFO.medipack) && /Slot/.test(H.ITEM_INFO.medipack), 'Infotext nennt Wiederbeleben, Lager und den Slot (ohne Medipack im Slot kein Pack unten)');
ok(!/\d/.test(H.ITEM_INFO.medipack) && !/50 HP|heilt/i.test(H.ITEM_INFO.medipack), 'Infotext ohne feste Zahl (die Packgröße steht nicht im Protokoll) und ohne das alte „Heilt 50 HP“');

section('HUD-Zelle: Ladungen 3/2/1/0 aus medkit, 3 und 2 Slots');
const zelle = (slots, me) => {
  calls.length = 0; const fills = [], strokes = [];
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect(x, y, w, h) { fills.push({ x, w, c: this.fillStyle }); }, strokeRect() { strokes.push(this.strokeStyle); } };
  H.loadoutStand = { slotzahl: slots.length, slots };
  H.wechselSperre = null;
  H.drawSlotZeile.call(H, ctx, { me: Object.assign({ wf: 'blaster' }, me), time: 1 }, 8, 50);
  return { fills, strokes, calls: calls.slice() };
};
const ROT = '#B83A2E', STAHL = '#27394A', LEER = '#1B252F';
for (const n of [3, 2, 1]) {
  const z = zelle(['blaster', 'medipack', null], { medkit: n });
  const nm = z.calls.find((c) => /^Med/.test(c.txt));
  ok(nm && /\b\d$/.test(nm.txt) && nm.txt.endsWith(String(n)), n + ' Ladung(en): die Zelle trägt die Ziffer ' + n + ' („' + (nm && nm.txt) + '“)');
  ok(nm && breite(nm.txt) <= Math.floor(164 / 3) - 13, n + ' Ladung(en): „' + (nm && nm.txt) + '“ passt in die 3-Slot-Zelle (' + (nm && breite(nm.txt)) + ' ≤ ' + (Math.floor(164 / 3) - 13) + ')');
  ok(z.fills.some((f) => f.c === STAHL) && !z.fills.some((f) => f.c === LEER), n + ' Ladung(en): stahlblaue Item-Zelle');
  ok(nm && nm.o.color === '#star', n + ' Ladung(en): Name in Sternweiß (eigene Medizinfarbe aus dem Bestand, kein neues Token)');
}
{
  const z = zelle(['blaster', 'medipack', null], { medkit: 0 });
  const nm = z.calls.find((c) => /^Med/.test(c.txt));
  ok(nm && nm.txt === 'Medi ×0' && breite(nm.txt) <= Math.floor(164 / 3) - 13, '0 Ladungen (3 Slots): „Medi ×0“, passt');
  ok(z.fills.some((f) => f.c === LEER) && !z.fills.some((f) => f.c === STAHL) && nm.o.color === '#5E6A78', '0 Ladungen: dunkle Zelle und graue Schrift (deutlich anders als gefüllt)');
  const z2 = zelle(['blaster', 'medipack', null], {});
  ok(z2.fills.some((f) => f.c === LEER), 'medkit fehlt im Snapshot (Standard 0): wie leer');
  const z3 = zelle(['blaster', 'medipack'], { medkit: 0 });
  ok(z3.calls.some((c) => c.txt === 'Medi ×0'), '0 Ladungen (2 Slots, breite Zelle): feste Kurzform „Medi ×0“');
  const z4 = zelle(['blaster', 'medipack'], { medkit: 3 });
  ok(z4.calls.some((c) => c.txt === 'Medi ×3') && !z4.calls.some((c) => /^Medipack/.test(c.txt)), '3 Ladungen (2 und 3 Slots gleich): feste Kurzform „Medi ×3“, nie „Medipack 3“');
}
{
  const alle = ['blaster', 'medipack', 'scanner'];
  const zz = zelle(alle, { medkit: 2, action: { kind: 'scan' } });
  ok(!zz.fills.some((f) => f.c === ROT) || zz.fills.filter((f) => f.c === ROT).length === 1, 'neben Waffe und Scanner: Rot nur an der aktiven Waffe');
  ok(zz.fills.filter((f) => f.c === '#3F7F99').length === 1 && zz.fills.some((f) => f.c === STAHL) && zz.strokes.filter((s) => s === '#ice').length === 1, 'laufender Scan färbt nur die Scanner-Zelle (Medipack bleibt stahlblau, ein Eisblau-Rahmen)');
  const ohne = zelle(['medipack', null, null], { medkit: 3, wf: 'faust' });
  ok(!ohne.fills.some((f) => f.c === ROT), 'Medipack im Slot und Fäuste: kein Aktiv-Rahmen (ein Item ist nie die aktive Waffe)');
  const fremd = zelle(['blaster', 'medipack', null], { medkit: 3, wf: 'medipack' });
  ok(!fremd.fills.some((f) => f.c === ROT) || fremd.fills.filter((f) => f.c === ROT).length === 1, 'selbst wenn wf fälschlich „medipack“ hieße: das Medipack wird nicht zur aktiven Waffe');
}
{
  let fehler = null;
  try { for (let n = 0; n < 12; n++) for (const sl of [['medipack', null], ['medipack', 'scanner', null], [null, null, 'medipack']]) { const z = zelle(sl, { medkit: n }); const cw = Math.floor(164 / sl.length); for (const c of z.calls) if (/^Med/.test(c.txt) && breite(c.txt) > cw - 13) throw new Error('zu breit: ' + c.txt + ' bei ' + sl.length + ' Slots'); } } catch (e) { fehler = e; }
  ok(!fehler, 'Ladungen 0 bis 11, 2 und 3 Slots, jede Slotlage: der Name passt immer in die Zelle' + (fehler ? ': ' + fehler.message : ''));
  ok(zelle(['medipack', null, null], { medkit: 12 }).calls.some((c) => /^Me/.test(c.txt)), 'zweistellige Ladungszahl (Config-Tuning): gekürzt statt zu überlaufen, kein festes N im Client');
}

section('ITM-01 F: Schildzeile ohne doppeltes Medipack, feste Kurzform');
{
  const hudT = read('public/js/hud.js');
  ok(hudT.includes('if (slotZeile) { /* Leiste zeigt das Medipack */ } else if (me.medkit) {'), 'Schildzeile zeichnet das Medipack nur ohne Slot-Leiste (die Zelle „Medi ×n“ zeigt dieselbe Zahl; medkit gibt es nur mit Medipack im wirksamen Slot)');
  ok(!hudT.includes("R.text(ctx, 'Medipack', mx + 15"), 'kein fester Text „Medipack“ mehr in der Schildzeile');
  ok(!/Medipack [0-9]|Medi [0-9]|Med [0-9]/.test(hudT.slice(hudT.indexOf('medipack(me) {'), hudT.indexOf('medipack(me) {') + 700)), 'Zellnamen ohne „Medipack n“/„Medi n“');
}

section('Ausrüstungsstation: Medipack wählbar, eigenes Symbol, eigener Text');
{
  const proxy = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : proxy()), apply: () => proxy(), construct: () => proxy() });
  const sym = [];
  const w2 = { performance, localStorage: win.localStorage, Render: R, Hud: H, Shared_Maps: {}, Shared_Config: CONFIG, Shared_Protocol: PROTO, Tasten: win.Tasten, Scanner: { symbol: (cc, x, y, col) => sym.push([x, y, col]) }, Net: { guard: (nm, f) => f(), on() {}, reportError() {} }, console };
  w2.window = w2;
  vm.createContext(w2);
  let K = null, fehler = null;
  try { vm.runInContext(read('public/js/consoles.js'), w2, { filename: 'consoles.js' }); K = w2.Consoles; } catch (e) { fehler = e; }
  ok(K && typeof K.itemSymbol === 'function', 'consoles.js lädt im Sandkasten, itemSymbol vorhanden' + (fehler ? ': ' + fehler.message : ''));
  if (K) {
    const wahl = K.ausruestungWahl();
    ok(wahl[wahl.length - 1] === 'medipack' && wahl.includes('scanner') && wahl.length === PROTO.WAFFEN_WAHL.length + 3, 'Auswahlliste endet mit Medipack (leer, sechs Waffen, Scanner, Medipack)');
    ok(K.ausruestungName('medipack') === 'Medipack', 'Anzeigename „Medipack“');
    ok(K.ausruestungSlotText('medipack', { state: { inventory: { medipack: 2 } } }) === 'Medipack · ' + CONFIG.medipack.ladungen + ' Ladungen · Lager 2', 'Station: „Medipack · 3 Ladungen · Lager 2“ (Ladungen aus der Config, Lagerstand aus inventory)');
    ok(K.ausruestungSlotText('medipack', { state: {} }) === 'Medipack · ' + CONFIG.medipack.ladungen + ' Ladungen' && K.ausruestungSlotText('medipack', null) === 'Medipack · ' + CONFIG.medipack.ladungen + ' Ladungen', 'Station ohne Lagerstand im Client: nur die Ladungen, kein erfundenes „Lager 0“');
    ok(K.ausruestungSlotText('medipack', { state: { inventory: { medipack: 2, medipackCharges: 1 } } }) === 'Medipack · ' + CONFIG.medipack.ladungen + ' Ladungen · Lager 2 + 1 Rest' && K.ausruestungSlotText('medipack', { state: { inventory: { medipack: 0, medipackCharges: 2 } } }) === 'Medipack · ' + CONFIG.medipack.ladungen + ' Ladungen · Lager 0 + 2 Rest', 'Station: Rest-Topf wird mit angezeigt („Lager 2 + 1 Rest“)');
    ok(K.ausruestungSlotText('sturmgewehr', { state: {} }) === K.ausruestungName('sturmgewehr'), 'Station: andere Slot-Zeilen unverändert');
    K.ausr.stand = { slotzahl: 3, slots: ['sturmgewehr', null, null] };
    ok(K.ausruestungGrund('medipack', 1) === null && !K.ausruestungGesperrt('medipack', 1), 'Medipack in einen freien Slot: möglich');
    K.ausr.stand = { slotzahl: 3, slots: ['medipack', null, null] };
    ok(/Steckt schon in Slot 1/.test(K.ausruestungGrund('medipack', 1)) && K.ausruestungGesperrt('medipack', 1), 'steckt es schon in Slot 1: für Slot 2 gesperrt (wie alle)');
    // Symbole
    const fills = [];
    const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect(x, y, w, h) { fills.push({ x, y, w, h, c: this.fillStyle }); }, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
    K.itemSymbol(ctx, 'medipack', 43, 20);
    ok(sym.length === 0 && fills.length >= 3 && fills.some((f) => f.c === '#EDE6D6') && fills.some((f) => f.c === '#mint'), 'itemSymbol(medipack) zeichnet den Koffer mit Mint-Kreuz und ruft NICHT Scanner.symbol');
    K.itemSymbol(ctx, 'scanner', 43, 20);
    ok(sym.length === 1 && sym[0][2] === '#ice', 'itemSymbol(scanner) ruft weiter Scanner.symbol (Eisblau)');
    // Direktwahl
    const gesendet = [];
    const view = { send: (o) => gesendet.push(o), state: {}, me: {} };
    K.cmd = (v, c, extra) => gesendet.push(Object.assign({ c }, extra));
    K.denied = () => {};
    K.ausr.stand = { slotzahl: 3, slots: ['sturmgewehr', null, null] }; K.ausr.sel = 1; K.ausr.fokus = 'waffe';
    K.ausruestungTaste('Digit8', view);
    ok(gesendet.length === 1 && gesendet[0].c === 'ausruestung.slot' && gesendet[0].slot === 1 && gesendet[0].id === 'medipack', 'Taste 8 setzt das Medipack in den gewählten Slot (ausruestung.slot { slot 1, id medipack })');
    gesendet.length = 0; K.ausr.cur = wahl.indexOf('medipack'); K.ausruestungTaste('Enter', view);
    ok(gesendet.length === 1 && gesendet[0].id === 'medipack', 'Enter auf der Medipack-Zeile setzt es');
    gesendet.length = 0; K.ausruestungTaste('Digit9', view);
    ok(gesendet.length === 0, 'Taste 9 (hinter der Liste) tut nichts');
    // Zeichnen
    R.button = (c2, x, y, w, h, lab, o) => { calls.push({ txt: 'BTN:' + lab, x, y, o }); };
    R.wrap = (t, w) => { const out = []; let z = ''; for (const wd of String(t).split(' ')) { if (breite((z + ' ' + wd).trim()) > w && z) { out.push(z); z = wd; } else z = (z + ' ' + wd).trim(); } if (z) out.push(z); return out; };
    K.ausr.stand = { slotzahl: 3, slots: ['sturmgewehr', 'medipack', null] }; K.ausr.sel = 1; K.ausr.cur = wahl.indexOf('medipack'); K.ausr.fehler = null;
    calls.length = 0; sym.length = 0; fills.length = 0;
    let hilfe = null, f2 = null;
    try { hilfe = K.drawAusruestung(ctx, view); } catch (e) { f2 = e; }
    ok(!f2, 'drawAusruestung mit Medipack zeichnet ohne Fehler' + (f2 ? ': ' + f2.message : ''));
    const t2 = calls.map((x) => x.txt);
    ok(sym.length === 0, 'Slot mit Medipack zeigt NICHT das Scanner-Symbol');
    ok(fills.some((f) => f.c === '#EDE6D6'), 'Slot mit Medipack zeigt das Medipack-Symbol');
    ok(calls.some((x) => x.txt === 'BTN:Medipack' && x.o.hotkey === '8'), 'Zeile „Medipack“ mit Taste 8 in der Auswahl');
    const info = calls.filter((x) => !x.txt.startsWith('BTN:')).map((x) => x.txt).join(' ').replace(/\s+/g, ' ');
    ok(info.includes('Medipack: beschleunigt das Wiederbeleben') && info.includes('Pack kommt aus dem Lager'), 'Infotext des Medipacks steht in der Station (Cursor auf der Zeile)');
    ok(/Am Boden aktiv: Gewehr/.test(t2.join('\n')), 'am Boden aktiv bleibt die erste Waffe');
    ok(/1–8 direkt/.test(hilfe), 'Hilfezeile nennt 1–8');
    K.ausr.stand = { slotzahl: 3, slots: ['medipack', null, null] }; calls.length = 0; K.drawAusruestung(ctx, view);
    ok(/Kein Waffen-Slot = Fäuste/.test(calls.map((x) => x.txt).join('\n')), 'nur Medipack im Slot: „Kein Waffen-Slot = Fäuste.“');
    // Scanner-Zeile: Scanner-Info, nicht die des Medipacks
    K.ausr.cur = wahl.indexOf('scanner'); calls.length = 0; K.drawAusruestung(ctx, view);
    const info2 = calls.filter((x) => !x.txt.startsWith('BTN:')).map((x) => x.txt).join(' ').replace(/\s+/g, ' ');
    ok(info2.includes('Scanner: findet Erz') && !info2.includes('Medipack: beschleunigt'), 'Cursor auf dem Scanner: Scanner-Text, nicht der des Medipacks');
  }
}

section('Texte: Terminal und Handel sagen nicht mehr „Heilt 50 HP“');
{
  const t1 = read('public/js/terminal-ui.js'), t2 = read('public/js/consoles.js');
  ok(!/Heilt 50 HP/.test(t1) && !/Heilt 50 HP/.test(t2) && !/Heilt 50 HP/.test(read('public/js/hud.js')), 'kein „Heilt 50 HP“ mehr im Client');
  const m1 = /medipack: '([^']*)'/.exec(t1.slice(t1.indexOf('HANDEL_TEXT')));
  const m2 = /medipack: 'Beschleunigt[^']*'/.exec(t2);
  ok(m1 && /Wiederbeleben/.test(m1[1]) && m2 && m2[0].includes(m1[1]), 'Terminal (terminal-ui.js) und Handelsliste (consoles.js) nennen denselben Text: „' + (m1 && m1[1]) + '“');
  ok(m1 && breite(m1[1]) <= 440, 'der Text ist kurz genug für eine Zeile der Terminal-Beschreibung (' + (m1 && breite(m1[1])) + ' px)');
  ok(CONFIG.medipack && CONFIG.medipack.ladungen >= 1 && CONFIG.awayCombat && CONFIG.awayCombat.wounded.medkitReviveTime < CONFIG.awayCombat.wounded.reviveTime, 'Konfiguration: Medipack hat Ladungen, Revive mit Kit ist schneller (Grundlage der Beschriftung)');
}

section('Revive-Beschriftung und E-Hinweise (client.js, Quelltext; die Ausführung prüft tools/itm01-b-shots.js über Client.interactionAt)');
{
  const c = read('public/js/client.js');
  ok(/const sec = m\.medkit \? \(W\.medkitReviveTime \|\| 1\.5\) : \(W\.reviveTime \|\| 4\);/.test(c) && /\(m\.medkit \? ', Medipack' : ''\)/.test(c), 'Revive-Beschriftung hängt an truthy medkit (Ladungszahl > 0), ohne Ladung gilt der normale Text und die normale Zeit');
  ok(/carry === 'medipack' \|\| m\.medkit > 0/.test(c), 'NSC verarzten: Ladung (medkit > 0) genügt');
  ok(!/medkit\s*===\s*(true|1)\b|medkit\s*==\s*true/.test(c) && !/\.medkit\s*===\s*(true|1)/.test(read('public/js/hud.js')), 'nirgends ein Vergleich auf true oder 1 (die Ladungszahl wäre sonst bei 2 und 3 „nicht da“)');
  ok(/Client\.interactionAt = interactionAt;/.test(c), 'Client.interactionAt bleibt für QA erreichbar');
}

section('dev-mock: Ladungen statt Flag, Wiederbeleben verbraucht genau eine');
{
  const d = read('public/js/dev-mock.js');
  ok(/const PACK = Math\.max\(1, Math\.floor\(\(CFG\.medipack && CFG\.medipack\.ladungen\) \|\| 3\)\);/.test(d), 'Packgröße aus der geteilten Konfiguration (CFG.medipack.ladungen), Rückfall 3 wie der Server');
  ok(/q\.medkit = PACK; q\.dir = 'up'/.test(d) && /team\[1\]\.medkit = PACK;/.test(d), 'Team beginnt mit vollem Pack (Ladungen), nicht mit dem Flag 1');
  ok(!/medkit = 1\b/.test(d), 'kein medkit = 1 mehr');
  ok(/kind: 'revive', progress: 0, kit: p\.medkit > 0, dur: p\.medkit > 0 \?/.test(d), 'Revive-Start merkt sich, ob eine Ladung da war (wie completeRevive: h.medkit)');
  ok(/const kit = act\.kit && p\.medkit > 0;/.test(d) && /if \(kit\) p\.medkit -= 1;/.test(d) && !/if \(p\.medkit\) p\.medkit = 0;/.test(d), 'Revive-Ende verbraucht genau eine Ladung, keine alle auf einmal');
  const s = read('server/sim/combat.js');
  ok(/const kit = h\.medkit && p\.medkit > 0;/.test(s) && /if \(kit\) Medipack\.verbrauchen\(p\);/.test(s), 'Server-Regel unverändert so, wie der Mock sie doppelt (Parität)');
}

if (fails) { console.log('\n' + fails + ' FEHLER'); process.exit(1); }
console.log('\nalle ok');
