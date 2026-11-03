'use strict';
// OPS-01 Paket C2: Zielkasten für den Captain. Ops und Captain sehen dasselbe Gefecht gleich gut; was ein Schiff im Detail zeigt, zeichnet EINE Funktion (Consoles.pultZielkasten),
// ohne Stationsparameter. Die Detaildaten kommen über Consoles.zielDetail(view, id): ship.zielSys/zielZon/zielWahl bei id === ship.target (Ziel der Ops), sonst ship.cz (Anzeigeziel des Captains).
//   (a) pultOps und pultCaptain rufen dieselbe Funktion pultZielkasten(c, view, b, target) auf, Signatur ohne Stationsparameter, kein ship.zielZon in der Zeichnung
//   (b) gescanntes Ziel: Ops und Captain zeichnen mit denselben Detaildaten dieselben Zeilentexte des Kastens
//   (c) ship.cz = { id } und ungescannt: kein Zonenkreuz, kein Schildtext, „nicht gescannt“
//   (d) cz-Detail (sys/zon/wahl) wird gezeichnet; cz.id === ship.target nutzt die Felder der Ops
//   (e) Klick auf eine Fläche der Lagekarte sendet captain.anzeigeziel mit der id, Klick auf leere Karte sendet captain.marker
//   (f) T zykliert in der Reihenfolge von targetList (eine gemeinsame Funktion für Ops und Captain)
//   (g) die Anwahl des Captains sendet nie weapons.target
//   (h) Ops-Zielkasten unverändert: Zeichenfolge der OPS-Anzeige gleich der gespeicherten Referenz vom Stand daa68f1 (tools/fixtures/ops-zielkasten-ref.json; die Referenz ist gespeichert,
//       weil der Test nicht gegen einen zweiten Git-Stand laufen kann; sie wird mit --ref-schreiben auf einem Stand erzeugt, dessen Ops-Zielkasten als richtig gilt)
//   node tools/test-captain-zielkasten.js [--ref-schreiben]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const DATEN = require('../content/kampf/gegner-systeme.json');
const REF = path.join(__dirname, 'fixtures', 'ops-zielkasten-ref.json');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');   // Quelldateien sind CRLF

// ---------------------------------------------------------------------------------------------------------------------------------
// Umgebung: echte Skripte (Render, Pult, Zonenkreuz, Zielsysteme, Consoles, Pult-Stationen), Zeichenfläche mit Aufzeichnung, Hud als Attrappe
function neueFlaeche() {
  const rec = { texte: [], rects: 0 };
  const st = { fillStyle: '#000', strokeStyle: '#000' };
  const f = { __rec: rec, fillText(s, x, y) { rec.texte.push([String(s), Math.round(x), Math.round(y)]); }, fillRect() { rec.rects++; }, measureText: (s) => ({ width: String(s).length * 5 }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) };
  const ctx = new Proxy(f, { get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { st[k] = v; return true; } });
  return { ctx, rec };
}
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
function umgebung(quellen) {
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'), Shared_Schilde: require('../shared/schilde.js'),
    document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null, addEventListener() {} },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' }, URLSearchParams,
    localStorage: { getItem: () => null, setItem() {} } };
  win.window = win; win.self = win;
  vm.createContext(win);
  win.__fehler = [];
  win.Net = { guard: (w, f, d) => { try { return f(); } catch (e) { win.__fehler.push(w + ': ' + e.message); return d; } }, reportError(w, e) { win.__fehler.push(w + ': ' + (e && e.message)); } };
  win.Hud = new Proxy({}, { get: () => () => 0 });
  for (const f of ['kennung.js', 'render.js', 'pult-systeme-tokens.js', 'zonenkreuz.js', 'zielsysteme.js', 'kartenlogik.js', 'pult.js', 'consoles.js', 'pult-stationen.js']) vm.runInContext((quellen && quellen[f]) || read(f), win, { filename: f });
  win.Zielsysteme.store.daten = DATEN;
  return win;
}
const win = umgebung();
const C = win.Consoles;

// ---------------------------------------------------------------------------------------------------------------------------------
// Szenario: Schiff bei (1000, 0), Gegner Korvette (gescannt) und Raider (ungescannt), Station, verstecktes Objekt
const SYS = DATEN.klassen.korvette.systeme;
const zielSys = (besonders) => { const zs = []; for (const d of SYS) { const b = (besonders || {})[d.id] || [0, 100]; zs.push(b[0], b[1]); } zs.push(-1); return zs; };
const DETAIL_A = { sys: zielSys({ antrieb: [1, 40] }), zon: { z: 0, pct: [100, 60, 100, 100], leer: [0, 0, 0, 0] }, wahl: [SYS.findIndex((d) => d.id === 'antrieb')] };
const DETAIL_B = { sys: zielSys({ antrieb: [2, 0], reaktor: [1, 30] }), zon: { z: 2, pct: [100, 100, 10, 100], leer: [0, 0, 0, 0] }, wahl: [] };
const gegner = () => [
  { id: 'k1', kind: 'korvette', vk: 'ger', x: 1200, y: 0, hp: 50, hpMax: 100, scanned: true, angle: 0, shields: [2, 2, 2, 2] },
  { id: 'k2', kind: 'korvette', vk: 'rom', x: 1500, y: 200, hp: 80, hpMax: 100, scanned: true, angle: 0, shields: [1, 1, 1, 1] },
  { id: 'r1', kind: 'raider', vk: 'pirat', x: 1100, y: -300, hp: 10, hpMax: 10, scanned: false, angle: 0, shields: [2, 2, 2, 2] },
];
function ansicht(o) {
  o = o || {};
  const en = gegner();
  const ship = Object.assign({ x: 1000, y: 0, angle: 0, hull: 100, mounts: [] }, o.ship || {});
  if (o.target !== undefined) ship.target = o.target;
  if (o.cz) ship.cz = o.cz;
  if (o.opsDetail) { ship.zielSys = o.opsDetail.sys; ship.zielZon = o.opsDetail.zon; ship.zielWahl = o.opsDetail.wahl; }
  const gesendet = [];
  const space = { enemies: en, hidden: o.hidden || [] };
  return { gesendet, time: 1, me: { console: o.console || 'weapons', id: 'p1' }, pid: 'p1', ship, enemies: en, escorts: [], actions: { sfx() {} }, send(m) { gesendet.push(m); },
    state: { time: 1, players: [], flotte: {}, space, ship } };
}
function zeichne(station, view, tab) {
  C.tab = tab == null ? 2 : tab; C.lageRects.length = 0; C.enemyRects.length = 0;
  const f = neueFlaeche(); win.__fehler.length = 0;
  C.pultDraw(f.ctx, view, station);
  return f;
}
const texte = (rec) => rec.texte.map((t) => t[0]);

// ---------------------------------------------------------------------------------------------------------------------------------
// Referenz: Zeichenfolge der OPS-Anzeige (Ziel gescannt mit Detail, Ziel ungescannt, verstecktes Ziel ungescannt/erfasst)
function opsFaelle() {
  const h = [{ id: 'h1', kind: 'wrack', x: 1050, y: 100, found: false }, { id: 'h2', kind: 'wrack', x: 1050, y: 100, found: true }];
  return {
    gescannt: ansicht({ target: 'k1', opsDetail: DETAIL_A }),
    gescanntB: ansicht({ target: 'k2', opsDetail: DETAIL_B }),
    ungescannt: ansicht({ target: 'r1' }),
    verstecktUngescannt: ansicht({ target: 'h1', hidden: h }),
    verstecktErfasst: ansicht({ target: 'h2', hidden: h }),
    keinsZiel: ansicht({}),
  };
}
const opsFolge = () => { const o = {}; for (const [k, v] of Object.entries(opsFaelle())) { const f = zeichne('weapons', v); o[k] = { texte: f.rec.texte, rects: f.rec.rects, fehler: win.__fehler.slice() }; } return o; };
if (process.argv.includes('--ref-schreiben')) { fs.writeFileSync(REF, JSON.stringify(opsFolge()) + '\n'); console.log('Referenz geschrieben: ' + REF); process.exit(0); }

// ---------------------------------------------------------------------------------------------------------------------------------
// Spion auf die Zielkasten-Funktion: jeder Aufruf (Argumentzahl, Ziel-id, Texte, die er zeichnet)
const aufrufe = [];
{
  const orig = C.pultZielkasten;
  C.pultZielkasten = function (c, view, b, target) {
    const rec = c.__rec; const vor = rec ? rec.texte.length : 0;
    const r = orig.apply(this, arguments);
    aufrufe.push({ n: arguments.length, fn: orig, id: target && target.id, rect: b, texte: rec ? rec.texte.slice(vor).map((t) => t[0]) : [] });
    return r;
  };
}
function zeichneSpion(station, view, tab) {
  C.tab = tab == null ? 2 : tab; C.lageRects.length = 0; C.enemyRects.length = 0;
  win.Render.ui.buttons.length = 0;
  const f = neueFlaeche(); win.__fehler.length = 0;
  aufrufe.length = 0;
  C.pultDraw(f.ctx, view, station);
  return { rec: f.rec, aufrufe: aufrufe.slice(), fehler: win.__fehler.filter((x) => !/Lerche\.sprite/.test(x)) };
}
const CZ_A = { id: 'k1', sys: DETAIL_A.sys, zon: DETAIL_A.zon, wahl: DETAIL_A.wahl };
const KREUZ = ['WBg', 'EBg', 'WSt', 'ESt', 'Antr', 'WBb', 'EBb', 'Reakt', 'Schld', 'Werk', 'ZU'];
const hatKreuz = (t) => KREUZ.some((k) => t.includes(k));

section('(a) eine Funktion für beide Stationen, ohne Stationsparameter');
{
  const ps = read('pult-stationen.js');
  ok(/\n    pultZielkasten\(c, view, b, target\) \{/.test(ps), 'Signatur pultZielkasten(c, view, b, target): kein Stationsparameter, kein Flag');
  ok(!/pultZielkasten\([^)]*(captain|ops|station|fuer)/i.test(ps.replace(/\/\/[^\n]*/g, '')), 'kein Aufruf mit Stations-Argument');
  const rumpf = ps.split('\n    pultZielkasten(c, view, b, target) {')[1].split('\n    // ====')[0];
  const ohneZst = rumpf.replace(/\/\/[^\n]*/g, '').split('\n').filter((l) => !/const zst = /.test(l)).join('\n');
  ok(!/ship\.ziel(Zon|Sys|Wahl)|ship\.cz\b|\.zielZon|\.zielSys|\.zielWahl/.test(ohneZst) && /zielDetail\(view, target\.id\)/.test(rumpf), 'der Kasten liest Zonen, Systeme und Wahl nur über zielDetail(view, target.id)');
  ok(/this\.pultZielkasten\(c, view, \{ x: r\.x \+ 410/.test(ps) && /capZielkasten\(c, view, b, target\) \{\n      const zk = this\.pultZielkasten\(c, view, b, target\);/.test(ps), 'Ops und Captain rufen pultZielkasten direkt auf (Captain über capZielkasten, das nur den Hinweis ergänzt)');
  const o = zeichneSpion('weapons', ansicht({ target: 'k1', opsDetail: DETAIL_A }));
  const cp = zeichneSpion('captain', ansicht({ console: 'captain', target: 'k1', cz: CZ_A }));
  ok(o.aufrufe.length === 1 && cp.aufrufe.length === 1 && o.aufrufe[0].fn === cp.aufrufe[0].fn && o.aufrufe[0].n === 4 && cp.aufrufe[0].n === 4, 'zur Laufzeit: pultOps und Captain-Lage rufen dieselbe Funktion mit vier Argumenten');
  ok(o.fehler.length === 0 && cp.fehler.length === 0, 'beide Zeichnungen ohne Anzeigefehler ' + JSON.stringify(o.fehler.concat(cp.fehler)));
  ok(typeof C.zielDetail === 'function' && typeof C.anzeigeZielVon === 'function' && typeof C.zielAusId === 'function' && typeof C.zielNach === 'function', 'zielDetail, anzeigeZielVon, zielAusId, zielNach vorhanden');
  ok(/targetOf\(view\) \{ return this\.zielAusId\(view,/.test(read('consoles.js')) && /anzeigeZielVon\(view\) \{[^\n]*this\.zielAusId\(view, cz\.id\)/.test(read('consoles.js')), 'targetOf und anzeigeZielVon lösen die id über dieselbe Funktion zielAusId auf');
}

section('(b) gescanntes Ziel: Ops und Captain zeichnen mit denselben Daten dieselben Zeilen');
{
  const o = zeichneSpion('weapons', ansicht({ target: 'k1', opsDetail: DETAIL_A }));
  const cp = zeichneSpion('captain', ansicht({ console: 'captain', target: 'k2', opsDetail: DETAIL_B, cz: CZ_A }));
  const to = o.aufrufe[0].texte, tc = cp.aufrufe[0].texte;
  ok(to.slice(0, 6).join('|') === tc.slice(0, 6).join('|') && /Korvette/.test(tc.join('|')), 'Kopf des Kastens gleich (' + tc.slice(0, 6).join(' | ') + ')');
  ok(tc.includes('STB 60%') && tc.includes('GESAMT 50 %'), 'Captain: schwächste Zone und Integrität aus den Daten von cz, nicht aus den Feldern der Ops (Ops zielt auf eine andere Korvette)');
  // gleicher Platz, gleiche Daten: Zeile für Zeile gleich
  const rect = { x: 20, y: 20, w: 158, h: 222 };
  const mitAnsicht = (v) => { const f = neueFlaeche(); C.tab = 2; C.pultZielkasten(f.ctx, v, rect, C.zielAusId(v, 'k1')); return f.rec.texte; };
  const gleich = JSON.stringify(mitAnsicht(ansicht({ target: 'k1', opsDetail: DETAIL_A }))) === JSON.stringify(mitAnsicht(ansicht({ console: 'captain', target: 'r1', cz: CZ_A })));
  ok(gleich, 'derselbe Platz und dieselben Detaildaten (Ops-Felder bzw. cz): identische Zeichenfolge');
  ok(tc.length > 6 && tc.every((t) => to.includes(t) || /^\+\d+$/.test(t)), 'das Kreuz im niedrigeren Captain-Kasten zeigt nur Zeilen, die auch bei den Ops stehen (dazu „+N“ für nicht mehr passende Systeme)');
}

section('(c) Anzeigeziel ungescannt: nichts Genaues');
{
  const v = ansicht({ console: 'captain', target: 'k1', opsDetail: DETAIL_A, cz: { id: 'r1' } });
  const cp = zeichneSpion('captain', v);
  const tc = cp.aufrufe[0].texte, alle = texte(cp.rec);
  ok(cp.aufrufe[0].id === 'r1' && /Jäger/.test(tc.join('|')), 'Kasten zeigt das ungescannte Ziel (Name Jäger)');
  ok(!tc.some(hatKreuz) && !tc.some((t) => /^(BUG|STB|HECK|BB) \d/.test(t)), 'kein Zonenkreuz, kein Schildtext, keine Zone im Kasten');
  ok(alle.includes('nicht gescannt') && !alle.some((t) => /S: scannen|S halten/.test(t)), '„nicht gescannt“ statt Scan-Hinweis der Ops');
  // gescannter Gegner, aber der Server liefert für den Captain kein Detail: die Felder der Ops (anderes Ziel) werden nicht gezeigt
  const v2 = ansicht({ console: 'captain', target: 'k1', opsDetail: DETAIL_A, cz: { id: 'k2' } });
  const t2 = zeichneSpion('captain', v2).aufrufe[0].texte;
  ok(!t2.includes('STB 60%'), 'kein Detail in cz: Zonenstatus der Ops-Daten erscheint nicht beim Anzeigeziel');
  ok(C.zielDetail(v2, 'k2') === null && C.zielDetail(v2, 'k1').zon === DETAIL_A.zon, 'zielDetail: kein cz-Detail = null; Ziel der Ops = Felder der Ops');
}

section('(d) cz-Detail und cz.id === ship.target');
{
  const v = ansicht({ console: 'captain', target: 'k1', opsDetail: DETAIL_A, cz: { id: 'k2', sys: DETAIL_B.sys, zon: DETAIL_B.zon, wahl: DETAIL_B.wahl } });
  const t = zeichneSpion('captain', v).aufrufe[0].texte;
  ok(t.includes('HECK 10%') && !t.includes('STB 60%'), 'cz-Detail wird gezeichnet (HECK 10 %), die Ops-Felder nicht (' + t.slice(3, 6).join(' | ') + ')');
  ok(t.some(hatKreuz), 'Zonenkreuz des gescannten Anzeigeziels');
  const v2 = ansicht({ console: 'captain', target: 'k1', opsDetail: DETAIL_A, cz: { id: 'k1' } });
  const t2 = zeichneSpion('captain', v2).aufrufe[0].texte;
  ok(t2.includes('STB 60%') && t2.some(hatKreuz), 'cz.id === ship.target: der Kasten nutzt die Felder der Ops (STB 60 %)');
  const ops = zeichneSpion('weapons', ansicht({ target: 'k1', opsDetail: DETAIL_A, cz: { id: 'k2', sys: DETAIL_B.sys, zon: DETAIL_B.zon, wahl: DETAIL_B.wahl } })).aufrufe[0].texte;
  ok(ops.includes('STB 60%') && !ops.includes('HECK 10%'), 'das Anzeigeziel des Captains ändert den Kasten der Ops nicht');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('(e) Klick auf der Lagekarte');
{
  const v = ansicht({ console: 'captain', target: 'k2' });
  zeichneSpion('captain', v);
  const rk = C.lageRects.find((r) => r.id === 'k1');
  ok(!!rk && !!C.maps.lage, 'Klickfläche von k1 und Karte vorhanden');
  v.gesendet.length = 0;
  ok(C.mouseDown(rk.x + rk.w / 2, rk.y + rk.h / 2, v, 0) === true, 'Linksklick auf die Fläche wird verbraucht');
  const cmds = v.gesendet.map((m) => m.c + (m.id !== undefined ? ':' + m.id : ''));
  ok(cmds.join() === 'captain.anzeigeziel:k1', 'sendet captain.anzeigeziel mit der id (' + cmds.join() + ')');
  // leere Karte: Marker
  const mr = C.mapRects.lage;
  const leer = [[mr.x + 3, mr.y + 3], [mr.x + mr.w - 4, mr.y + mr.h - 4], [mr.x + 3, mr.y + mr.h - 4]].find(([x, y]) => !C.lageRects.some((r) => C.inRect(x, y, r)));
  v.gesendet.length = 0;
  ok(C.mouseDown(leer[0], leer[1], v, 0) === true && v.gesendet.length === 1 && v.gesendet[0].c === 'captain.marker' && typeof v.gesendet[0].x === 'number', 'Linksklick auf leere Karte setzt den Marker wie bisher');
  v.gesendet.length = 0;
  C.mouseDown(rk.x + 2, rk.y + 2, v, 2);
  ok(v.gesendet.length === 1 && v.gesendet[0].c === 'captain.marker' && v.gesendet[0].clear === true, 'Rechtsklick löscht den Marker (auch auf einem Schiff)');
  // nur bei geänderter id; dasselbe Ziel noch einmal = abwählen; ohne Anzeigeziel nichts senden
  const v2 = ansicht({ console: 'captain', cz: { id: 'k1' } });
  C.anzeigeZielWaehlen(v2, 'k1');
  ok(v2.gesendet.length === 1 && v2.gesendet[0].c === 'captain.anzeigeziel' && v2.gesendet[0].id === null, 'dasselbe Ziel noch einmal: Anzeigeziel wird gelöscht (id null)');
  const v3 = ansicht({ console: 'captain' });
  C.anzeigeZielWaehlen(v3, null); C.anzeigeZielWaehlen(v3, '');
  ok(v3.gesendet.length === 0, 'kein Anzeigeziel und nichts gewählt: es wird nichts gesendet');
  // Klick auf eine Mine (Fläche ohne Ziel) setzt den Marker
  const v4 = ansicht({ console: 'captain' });
  zeichneSpion('captain', v4); const mr4 = C.mapRects.lage; C.lageRects.push({ id: 'mine7', x: mr4.x + 5, y: mr4.y + mr4.h - 20, w: 14, h: 14 }); v4.gesendet.length = 0;
  C.mouseDown(mr4.x + 10, mr4.y + mr4.h - 15, v4, 0);
  ok(v4.gesendet.length === 1 && v4.gesendet[0].c === 'captain.marker', 'Fläche ohne auflösbares Ziel (Mine, Schützling): Marker statt Anzeigeziel');
  // Liste GESCANNTE ZIELE: Zeile wählt
  const v5 = ansicht({ console: 'captain' });
  zeichneSpion('captain', v5);
  const z = C.lageListe.find((r) => r.id === 'k2');
  v5.gesendet.length = 0;
  ok(!!z && C.mouseDown(z.x + 3, z.y + 3, v5, 0) === true && v5.gesendet.length === 1 && v5.gesendet[0].c === 'captain.anzeigeziel' && v5.gesendet[0].id === 'k2', 'Zeile in GESCANNTE ZIELE wählt das Anzeigeziel');
}

section('(f) Taste T: Reihenfolge von targetList');
{
  const v = ansicht({ console: 'captain', target: 'k2' });
  const reihe = C.targetList(v).map((e) => e.id);
  ok(reihe.join() === 'k1,r1,k2', 'targetList nach Entfernung (' + reihe.join() + ')');
  const taste = (view, code) => { zeichneSpion('captain', view); return C.keyDown({ code, shiftKey: false, repeat: false, preventDefault() {} }, view); };
  const folge = [];
  for (let i = 0; i < 4; i++) {
    v.gesendet.length = 0;
    taste(v, 'KeyT');
    const m = v.gesendet.find((q) => q.c === 'captain.anzeigeziel');
    folge.push(m ? m.id : null);
    if (m) v.state.ship.cz = { id: m.id };
  }
  ok(folge.join() === 'k1,r1,k2,k1', 'T zykliert k1, r1, k2, k1 (' + folge.join() + ')');
  const ops = ansicht({ target: 'k1' }); const opsFolge2 = [];
  for (let i = 0; i < 4; i++) { ops.gesendet.length = 0; C.cycleTarget(ops); const m = ops.gesendet.find((q) => q.c === 'weapons.target'); opsFolge2.push(m.id); ops.state.ship.target = m.id; }
  ok(opsFolge2.join() === 'r1,k2,k1,r1', 'Ops-Zyklus (T) bleibt: ' + opsFolge2.join() + ', dieselbe Reihenfolge');
  ok(/zielNach\(view, view\.state\.ship && view\.state\.ship\.target\)/.test(read('consoles.js')) && /zielNach\(view, cz && cz\.id\)/.test(read('consoles.js')), 'beide Zyklen rufen zielNach(view, id) auf');
  const leer = ansicht({ console: 'captain' }); leer.state.space.enemies.length = 0; leer.enemies.length = 0; leer.gesendet.length = 0;
  C.denied = () => {}; C.anzeigeZielWechseln(leer);
  ok(leer.gesendet.length === 0, 'kein Ziel in Reichweite: T sendet nichts');
  // Knopf und Taste
  zeichneSpion('captain', ansicht({ console: 'captain' }));
  ok(win.Render.ui.buttons.some((b) => b.label === 'Nächstes Ziel' && b.hotkey === 'T') && win.Render.ui.buttons.some((b) => b.label === 'Ziel löschen'), 'Pult: Knopf „Nächstes Ziel“ mit Kappe T und „Ziel löschen“ (klickbar)');
  ok(/captain\.lage\.naechstesZiel'.*KeyT.*captain\.lage/.test(read('tasten.js')), 'tasten.js: captain.lage.naechstesZiel, KeyT, Bereich captain.lage');
}

section('(g) die Anwahl des Captains berührt weapons.target nicht');
{
  const v = ansicht({ console: 'captain', target: 'k2' });
  zeichneSpion('captain', v);
  const rk = C.lageRects.find((r) => r.id === 'k1');
  C.mouseDown(rk.x + rk.w / 2, rk.y + rk.h / 2, v, 0);
  C.anzeigeZielWechseln(v); C.anzeigeZielWaehlen(v, 'r1'); C.anzeigeZielWaehlen(v, null);
  zeichneSpion('captain', v); C.keyDown({ code: 'KeyT', shiftKey: false, repeat: false, preventDefault() {} }, v);
  const cmds = v.gesendet.map((m) => m.c);
  ok(cmds.length >= 3 && cmds.every((c) => c === 'captain.anzeigeziel'), 'nur captain.anzeigeziel gesendet (' + cmds.join() + ')');
  ok(!cmds.includes('weapons.target') && v.state.ship.target === 'k2', 'kein weapons.target; ship.target bleibt');
}

section('(h) Ops-Zielkasten unverändert (Referenz vom Stand daa68f1)');
{
  const ref = JSON.parse(fs.readFileSync(REF, 'utf8')), jetzt = opsFolge();
  for (const k of Object.keys(ref)) ok(JSON.stringify(jetzt[k].texte) === JSON.stringify(ref[k].texte) && jetzt[k].rects === ref[k].rects, 'Ops-Anzeige „' + k + '“: gleiche fillText-Folge (' + ref[k].texte.length + ' Texte) und ' + ref[k].rects + ' Flächen');
  const mitCz = zeichne('weapons', ansicht({ target: 'k1', opsDetail: DETAIL_A, cz: { id: 'r1' } }));
  ok(JSON.stringify(mitCz.rec.texte) === JSON.stringify(ref.gescannt.texte), 'ein Anzeigeziel des Captains ändert die Ops-Anzeige nicht');
  ok(jetzt.ungescannt.texte.some((t) => t[0] === 'S: scannen für Schilde') && jetzt.verstecktUngescannt.texte.some((t) => t[0] === 'S halten: genauer scannen'), 'Ops: Hinweis mit der Taste S steht weiter da (vom Aufrufer gezeichnet)');
}

console.log('\ntest-captain-zielkasten: ' + (n - fails) + '/' + n + ' ok');
process.exit(fails ? 1 : 0);
