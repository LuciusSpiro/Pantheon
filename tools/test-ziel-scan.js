'use strict';
// SYS-01 C1b-2 „Ziel-Scan“: Kreuz des gescannten Ziels (Server-Snapshot zielSys/zielZon/zielWahl/zielAufKl), Systemziel reihum über die anwählbaren Systeme,
// ZU-Regel der Mitte, Bresche des Gegners (Bernstein), Reaktor-Countdown am Ziel, Absender „Fregatte zielt → …“, Quelle der Systeme gegen den Server.
//   node tools/test-ziel-scan.js
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Zs = require('../server/sim/zielsysteme.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gegnertod = require('../server/sim/gegnertod.js');
const DATEN = require('../content/kampf/gegner-systeme.json');
const PS = require('../public/js/pult-systeme-tokens.js');
const ZK = require('../public/js/zonenkreuz.js');
const Z = require('../public/js/zielsysteme.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | ')); }
}

function setup() {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'Z0', name: 'Zie0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  return g;
}
const leer = (g, kind, x, y) => { const e = space.spawnEnemy(g, kind, { x, y, facing: 0, tag: 'zz' }); e.retreatUntil = 0; return e; };
function platz(g, x, y, ang) { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.turnVel = 0; if (ang != null) s.angle = ang; }
// Lerche hinter dem Gegner: dessen Heck zeigt zur Lerche (Zone heck)
function hinten(g, e) { const a = e.angle + Math.PI; platz(g, e.x + Math.cos(a) * 300, e.y + Math.sin(a) * 300, e.angle); }
const setze = (e, id, i) => { e.sys[id].i = i; e.sys[id].z = i <= 0 ? 'broken' : (i < 0.6 * Gsys.maxOf(e, id) ? 'damaged' : 'ok'); e.hp = Gsys.summe(e); };
// Snapshot des gescannten Ziels (Server-Ausgabe, wie der Client sie bekommt)
function snap(g, e) { g.ship.target = e.id; const s = g.snapshot(); return { ship: s.ship, target: s.space.enemies.find((q) => q.id === e.id) }; }

// Fake-Zeichenfläche: zählt Texte, zeichnet nichts
function fakeCtx() {
  const texte = [];
  const rects = [];
  const ctx = { fillStyle: '', globalAlpha: 1, fillRect(x, y, w, h) { rects.push({ x, y, w, h, f: this.fillStyle }); }, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} };
  const R = { text: (c, s, x, y) => texte.push({ s: String(s), x, y }), measure: (s) => String(s).length * 6 };
  return { ctx, R, texte, rects };
}

const GEGNER_JS = read('public/js/zielsysteme.js');
Z.store.daten = DATEN;

section('Server: Snapshot des gescannten Ziels (zielSys, zielZon, zielWahl)', () => {
  const g = setup();
  const e = leer(g, 'fregatte', 1500, 1100); e.angle = 0; e.scanned = true;
  hinten(g, e);
  const { ship, target } = snap(g, e);
  const ids = Gsys.systemeVon('fregatte').map((d) => d.id);
  ok(Array.isArray(ship.zielSys) && ship.zielSys.length === 2 * ids.length + 1, `zielSys: je System zwei Werte + Countdown (${ids.length} Systeme)`);
  ok(ship.zielSys[ship.zielSys.length - 1] === -1, 'zielSys: Countdown -1 ohne Reaktor-Zerstörung');
  ok(ship.zielZon && ship.zielZon.z === 2 && ship.zielZon.pct.length === 4 && ship.zielZon.leer.every((v) => v === 0), `zielZon: zugewandt Heck (2), alle Seiten voll (${JSON.stringify(ship.zielZon)})`);
  const wahlNamen = ship.zielWahl.map((i) => ids[i]).sort();
  ok(JSON.stringify(wahlNamen) === JSON.stringify(['antrieb', 'emitter_heck']), `zielWahl: nur die Heck-Zone (${wahlNamen.join(',')})`);
  ok(target && target.scanned && typeof target.kind === 'string', 'Ziel im Snapshot gescannt');
  // Heck leer: die Mitte wird wählbar, zielZon.leer zeigt das Heck
  for (const id of Gsys.ids(e)) if (Gsys.defOf(e.kind, id).zone === 'heck') setze(e, id, 0);
  const s2 = snap(g, e).ship;
  ok(s2.zielZon.leer[2] === 1 && s2.zielZon.pct[2] === 0, 'Heck leer: zielZon.leer[2] = 1, pct 0');
  const w2 = s2.zielWahl.map((i) => ids[i]);
  // Regel C1b-1 (unverändert): erreichbar = Zone der zugewandten Seite (auch zerstörte Systeme dort bleiben wählbar, offener Punkt), Mitte erst bei leerer Zone
  ok(w2.includes('reaktor') && w2.includes('schildgenerator') && !w2.includes('waffe_bug') && !w2.includes('emitter_bug'), `Heck leer: Mitte wählbar, Bug nicht (${w2.join(',')})`);
  // Zustand des Antriebs im Snapshot: Code 2 = zerstört, mit Integrität 0
  const iA = ids.indexOf('antrieb');
  ok(s2.zielSys[2 * iA] === 2 && s2.zielSys[2 * iA + 1] === 0, 'Antrieb zerstört: zielSys Code 2, Integrität 0');
  // Mit Reaktor zerstört: Countdown im letzten Feld (Zehntelsekunden, > 0)
  setze(e, 'reaktor', 0); Gegnertod.systemZerstoert(g, e, 'reaktor');
  const s3 = snap(g, e).ship;
  ok(s3.zielSys[s3.zielSys.length - 1] > 0, `Reaktor zerstört: Countdown im letzten Feld (${s3.zielSys[s3.zielSys.length - 1]} Zehntel)`);
});

section('Server: Erreichbarkeit beim Befehl (Wahl prüft der Server wie die Anzeige)', () => {
  const g = setup();
  const e = leer(g, 'fregatte', 1500, 1100); e.angle = 0; e.scanned = true; g.ship.target = e.id;
  hinten(g, e);
  ok(Zs.waehle(g, 'antrieb') === null && g.ship.zielsystem === 'antrieb', 'Heck: Antrieb wählbar');
  ok(/nicht erreichbar/.test(Zs.waehle(g, 'waffe_bug') || ''), 'Heck: Bug-Waffe wird abgelehnt');
  ok(/nicht erreichbar/.test(Zs.waehle(g, 'reaktor') || ''), 'Heck offen: Reaktor (Mitte) wird abgelehnt');
});

section('Server: Absender des Gegnerziels (zielAufKl)', () => {
  const g = setup();
  Zs.szeneAn(g, true);
  const e = leer(g, 'fregatte', 1500, 1100); e.angle = 0; e.zielsystem = 'antrieb';
  const idx = Object.keys(DATEN.klassen).indexOf('fregatte');
  ok(g.snapshot().ship.zielAufKl === idx && idx >= 0, `zielAufKl = Index der Fregatte (${idx})`);
  ok(Z.klasseName(idx) === 'Fregatte', 'Client: Klassenname zum Index (Fregatte)');
  ok(Z.klasseName(-1) === null && Z.klasseName(99) === null, 'Client: kein Gegner zielt (-1) oder unbekannter Index: kein Name');
  e.zielsystem = undefined;
  ok(g.snapshot().ship.zielAufKl === -1, 'ohne Gegnerziel: -1');
});

section('Server: ungescanntes Ziel verbirgt die Systeme (kein zielSys, zielZon, zielWahl)', () => {
  const g = setup();
  const e = leer(g, 'fregatte', 1500, 1100); e.angle = 0;   // nicht gescannt
  hinten(g, e);
  const s = snap(g, e).ship;
  ok(s.zielSys === undefined && s.zielZon === undefined && s.zielWahl === undefined, 'ungescannt: keine Zielfelder im Snapshot');
});

section('Quelle: der Client liest die Systeme aus gegner-systeme.json, wie der Server', () => {
  for (const kind of Object.keys(DATEN.klassen)) {
    const serverIds = Gsys.systemeVon(kind).map((d) => d.id);
    const clientIds = Z.systemeFuer({ kind, scanned: true });
    ok(JSON.stringify(serverIds) === JSON.stringify(clientIds), `${kind}: Reihenfolge und Ids gleich (${clientIds.length})`);
  }
  ok(Z.systemeFuer({ kind: 'fregatte', scanned: false }).length === 0 && Z.systemeFuer({ kind: 'fregatte', scanned: true, station: true }).length === 0, 'ungescannt und Station: keine Systeme');
  ok(!/Emitter|Schildgenerator|Krankenstation|'antrieb'|'reaktor'/.test(GEGNER_JS), 'zielsysteme.js enthält keine zweite Tabelle der Systeme (keine Namen, keine Ids)');
});

section('Client gegen Server: Zeilen, Wahl, Grund, Reihum', () => {
  const g = setup();
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0; e.scanned = true;
  hinten(g, e);
  const { ship, target } = snap(g, e);
  const state = { ship };
  const zl = Z.zeilen(state, target);
  const ids = Gsys.systemeVon('korvette').map((d) => d.id);
  ok(zl.length === ids.length && zl.every((z, i) => z.id === ids[i]), 'zeilen: je System der Klasse in Reihenfolge');
  const wahl = zl.filter((z) => z.wahl).map((z) => z.id);
  ok(JSON.stringify(wahl.sort()) === JSON.stringify(ship.zielWahl.map((i) => ids[i]).sort()), 'zeilen.wahl stimmt mit zielWahl des Servers überein');
  const nicht = zl.find((z) => !z.wahl && z.zone === 'bug');
  ok(nicht && /abgewandt/.test(nicht.grund), `nicht anwählbar mit Grund (Bug: „${nicht && nicht.grund}“)`);
  const mitte = zl.find((z) => z.zone === 'mitte');
  ok(mitte && !mitte.wahl && /erst, wenn HECK leer/.test(mitte.grund), `Mitte nicht anwählbar, Grund nennt die Zone (${mitte && mitte.grund})`);
  // Reihum: jedes anwählbare System der Reihe nach, dann aus (null), dann wieder vorn
  const list = Z.wahlbar(state, target);
  ok(list.length >= 1 && JSON.stringify(list) === JSON.stringify(ship.zielWahl.map((i) => ids[i])), 'wahlbar: Liste wie zielWahl des Servers');
  ok(Z.reihum(state, target) === list[0], 'reihum ohne Wahl: erstes anwählbares System');
  if (list.length >= 2) ok(Z.reihum({ ship: Object.assign({}, ship, { zs: list[0] }) }, target) === list[1], 'reihum nach dem ersten: das zweite');
  ok(Z.reihum({ ship: Object.assign({}, ship, { zs: list[list.length - 1] }) }, target) === null, 'reihum nach dem letzten: aus (null)');
  ok(Z.reihum({ ship: Object.assign({}, ship, { zs: null }) }, target) === list[0], 'reihum aus: wieder das erste');
  ok(Z.reihum({ ship: Object.assign({}, ship, { zielWahl: [] }) }, target) === undefined, 'keine anwählbaren Systeme: undefined (kein Befehl)');
  ok(Z.gewaehlt({ ship: { zs: 'antrieb' } }) === 'antrieb' && Z.gewaehlt({ ship: {} }) === null, 'gewaehlt: ship.zs oder null');
  // Reaktor-Countdown am Ziel
  setze(e, 'reaktor', 0); Gegnertod.systemZerstoert(g, e, 'reaktor');
  const r = snap(g, e);
  ok(Math.abs(Z.reaktorRest({ ship: r.ship }, r.target) - r.ship.zielSys[r.ship.zielSys.length - 1] / 10) < 1e-9, 'reaktorRest: Sekunden aus dem Snapshot');
  ok(Z.reaktorRest({ ship }, target) === null, 'ohne Countdown: null');
  // müll-fest: Snapshot passt nicht zur Klasse
  ok(Z.zeilen({ ship: { zielSys: [0, 1] } }, target).length === 0, 'Snapshot passt nicht zur Klasse: keine Zeilen (keine Anzeige)');
});

section('Kreuz: Modell und Zeichnung (ZU-Regel, LEER, Bresche Gegner, Texte und Farben)', () => {
  const g = setup();
  const e = leer(g, 'fregatte', 1500, 1100); e.angle = 0; e.scanned = true;
  hinten(g, e);
  const lay = Schilde.layout(CONFIG, 'fregatte');
  const { ship, target } = snap(g, e);
  const m = ZK.modellZiel({ ship }, { systeme: DATEN.klassen.fregatte.systeme, lay, schild: target.shields });
  ok(m && m.zugewandt === 'heck' && m.zonen.heck.schild.length === 1 && m.zonen.stb.schild.length === 2, 'Modell: zugewandt Heck, Steuerbord hat 2 Schildschichten (Fregatte 2+2)');
  ok(m.offen.length === 0 && m.reaktorZer === false, 'Modell: keine offene Seite, Reaktor intakt');
  const F = PS.farben('rom');
  const cx = fakeCtx();
  const opt = { skin: 'rom', mass: PS.TOKENS.MASS.kreuz.ziel, gegner: true, zugewandt: 'heck', seite: 'heck', selId: null, env: { R: cx.R, P: {} } };
  ZK.zeichne(cx.ctx, m, { x: 0, y: 0, w: 146, h: 116 }, opt);
  ok(cx.texte.some((t) => t.s === 'ZU'), 'Heck offen (Zone nicht leer): Mitte mit ZU');
  ok(!cx.texte.some((t) => t.s === 'LEER'), 'Heck nicht leer: kein LEER');
  // Heck leer: ZU verschwindet, LEER steht, Mitte offen
  for (const id of Gsys.ids(e)) if (Gsys.defOf(e.kind, id).zone === 'heck') setze(e, id, 0);
  const s2 = snap(g, e);
  const m2 = ZK.modellZiel({ ship: s2.ship }, { systeme: DATEN.klassen.fregatte.systeme, lay, schild: s2.target.shields });
  const cx2 = fakeCtx();
  ZK.zeichne(cx2.ctx, m2, { x: 0, y: 0, w: 146, h: 116 }, Object.assign({}, opt, { env: { R: cx2.R, P: {} } }));
  ok(!cx2.texte.some((t) => t.s === 'ZU'), 'Heck leer: Mitte nicht mehr ZU (offen)');
  ok(cx2.texte.some((t) => t.s === 'LEER'), 'Heck leer: LEER in der Kachel');
  ok(m2.offen.length === 1 && m2.offen[0] === 'heck', 'Modell: offen = [heck]');
  // Bresche des Gegners: Bernstein (drive), nicht Rot
  ok(PS.TOKENS.FARBE.brescheGegner === PS.TOKENS.FN.drive && PS.TOKENS.FARBE.brescheGegner !== PS.TOKENS.FARBE.brescheEigen, 'Bresche Gegner = Bernstein (drive), Eigen = Rot');
  ok(F.zerText === '#FF6B5E' && PS.kontrast(F.zerText, PS.TOKENS.FARBE.kachel) >= 5.5, 'Roter Text nur über zerText (≥ 5,5:1 auf Kachel)');
  // Texte: Reaktor-Countdown am Ziel, Gesamtintegrität, Grund
  ok(PS.text(PS.TOKENS.TEXT.reaktorZiel, { s: '14,2' }) === 'REAKTOR ZERSTÖRT · 14,2 s', 'Text Reaktor-Countdown am Ziel');
  ok(PS.text(PS.TOKENS.TEXT.gesamt, { p: 63 }) === 'GESAMT 63 %', 'Text Gesamtintegrität');
  ok(PS.text(PS.TOKENS.TEXT.nichtWaehlbar.mitte, { zone: 'Heck' }) === 'Mitte erst, wenn Heck leer ist', 'Text Grund Mitte');
  // nicht anwählbare Systeme sind gedimmt (hinter), anwählbare nicht
  ok(m.zonen.bug.sys.every((x) => x.hinter === true) && m.zonen.heck.sys.every((x) => x.hinter === false), 'hinter: Bug gedimmt, Heck anwählbar');
  ok(ZK.modellZiel({ ship: {} }, { systeme: [] }) === null && ZK.modellZiel({ ship: { zielSys: [0, 100] } }, { systeme: DATEN.klassen.fregatte.systeme }) === null, 'müll-fest: kein Modell ohne passenden Snapshot');
});

section('Review C1b-2 Nacharbeit: Kurznamen, „+N“, Systemziel sichtbar, Bresche, Gesamt-Balken', () => {
  // Kurzbezeichnungen: höchstens 5 Zeichen, je Klasse eindeutig (Taste 0 und Kreuz nennen dasselbe System)
  for (const [kind, kl] of Object.entries(DATEN.klassen)) {
    const k = kl.systeme.map((s) => s.kurz);
    ok(k.every((s) => typeof s === 'string' && s.length >= 1 && s.length <= 5) && new Set(k).size === k.length, `${kind}: Kurznamen ≤ 5 Zeichen und eindeutig (${k.join(' ')})`);
  }
  const schema = JSON.parse(read('content/schema/gegner-systeme.schema.json'));
  ok(schema.properties.klassen.additionalProperties.properties.systeme.items.properties.kurz.maxLength === 5, 'Schema: kurz höchstens 5 Zeichen');
  // „+N“ steht in einer eigenen Zeile, nie auf einem Balken; das Systemziel bleibt sichtbar
  const g = setup();
  const e = leer(g, 'fregatte', 1500, 1100); e.angle = 0; e.scanned = true;
  hinten(g, e);
  const lay = Schilde.layout(CONFIG, 'fregatte');
  const { ship, target } = snap(g, e);
  const m = ZK.modellZiel({ ship }, { systeme: DATEN.klassen.fregatte.systeme, lay, schild: target.shields });
  const zeichne = (mm, selId) => { const cx = fakeCtx(); ZK.zeichne(cx.ctx, mm, { x: 0, y: 0, w: 146, h: 116 }, { skin: 'rom', mass: PS.TOKENS.MASS.kreuz.ziel, gegner: true, zugewandt: 'heck', seite: 'heck', selId, env: { R: cx.R, P: {} } }); return cx; };
  const c1 = zeichne(m, null);
  const plus = c1.texte.filter((t) => /^\+\d+$/.test(t.s));
  ok(plus.length >= 1, `Fregatte: Überlauf als „+N“ (${plus.map((t) => t.s).join(' ')})`);
  const balken = c1.rects.filter((r) => r.h === 4 && r.w >= 12);
  ok(plus.every((t) => !balken.some((r) => t.x < r.x + r.w && t.x + 12 > r.x && t.y < r.y + r.h && t.y + 7 > r.y)), '„+N“ liegt auf keinem Balken');
  ok(!c1.texte.some((t) => t.s === 'Werk'), 'ohne Systemziel: Werkstatt (hinten in der Mitte) ist der Überlauf');
  const c2 = zeichne(m, 'modul_werkstatt');
  ok(c2.texte.some((t) => t.s === 'Werk'), 'Systemziel im Überlauf rückt in die gezeichneten Zeilen (immer sichtbar)');
  // Jäger: Bug-Kachel zu niedrig für zwei Zeilen -> einzeilig, beide Systeme sichtbar, kein „+N“
  const e2 = leer(g, 'raider', 1800, 1100); e2.angle = 0; e2.scanned = true; g.ship.target = e2.id;
  const sn2 = g.snapshot(); const mr = ZK.modellZiel({ ship: sn2.ship }, { systeme: DATEN.klassen.raider.systeme, lay: Schilde.layout(CONFIG, 'raider'), schild: sn2.space.enemies.find((q) => q.id === e2.id).shields });
  const c3 = zeichne(mr, null);
  ok(c3.texte.some((t) => t.s === 'WBg') && c3.texte.some((t) => t.s === 'EBg') && !c3.texte.some((t) => /^\+\d+$/.test(t.s) && t.y < 30), 'Jäger: beide Bug-Systeme einzeilig sichtbar, kein „+N“ in der Bug-Kachel');
  // Bresche des Ziels: Winkel zur zugewandten leeren Seite, sonst keine
  for (const id of Gsys.ids(e)) if (Gsys.defOf(e.kind, id).zone === 'heck') setze(e, id, 0);
  const s2 = snap(g, e).ship;
  const zb = Z.bresche({ ship: s2 });
  ok(zb && zb.seite === 2 && Math.abs(zb.winkel - Math.PI) < 1e-9, 'Z.bresche: Heck leer -> Seite 2, Winkel π');
  ok(Z.bresche({ ship }) === null && Z.bresche({ ship: {} }) === null, 'Z.bresche: Zone nicht leer oder kein Scan -> null');
  const rsrc = read('public/js/render.js');
  ok(/zb = window\.Zielsysteme\.bresche\(st\)/.test(rsrc) && rsrc.indexOf("breschenKeil(ctx, k.x, k.y, k.mitte, k.r, 'gegner')") > rsrc.indexOf('drawBeamsFx(ctx, toS, t, ship)'), 'Karte: breschenKeil wird bei leerer zugewandter Zone gerufen, und zwar nach den Strahlen');
  ok(PS.TOKENS.MASS.bresche.kante === 2, 'Bresche: Kante 2 px');
  // Zielkasten: Gesamt-Balken ab Textende, abgerundet; Kreuz endet über der Frachtraum-Leiste
  const pult = read('public/js/pult-stationen.js');
  ok(/Math\.floor\(10 \* Math\.max\(0, n\(target\.hp\)\) \/ target\.hpMax\)/.test(pult) && !/Math\.ceil\(10 \* n\(target\.hp\)/.test(pult), 'GESAMT: Segmente abgerundet (93 % = 9 von 10)');
  ok(/bx = b\.x \+ 6 \+ P\.tw\(gt\) \+ 4/.test(pult), 'GESAMT: Balken beginnt 4 px hinter dem Text');
  ok(/y \+= kh \+ PSk\.TOKENS\.MASS\.seiteRahmen \+ 3/.test(pult), 'Zielkasten: unter dem Rahmen der zugewandten Seite weiter');
  ok(PS.kontrast(PS.farben('rom').zerText, PS.farben('rom').systemzielZeile) >= 4.5 && PS.kontrast(PS.farben('germanen').zerText, PS.farben('germanen').systemzielZeile) >= 4.5, 'zer. auf der Systemziel-Zeile ≥ 4,5:1 (beide Skins)');
});

section('Test, Vorher → Nachher (Ziel-Scan, Einbindung)', () => {
  const kons = read('public/js/consoles.js'), pult = read('public/js/pult-stationen.js'), render = read('public/js/render.js');
  ok(kons.includes('wahlbar(view.state, target)') && kons.includes('wahlbar(view.state, tg)') && /reihum/.test(kons), 'Ops-Knopf und Taste 0 wählen reihum über die anwählbaren Systeme');
  const zk = pult.split('pultZielkasten(c, view, b, target)')[1] || '';
  ok(!/T\(c, 'HÜLLE'/.test(zk.slice(0, 1200)), 'Ops-Zielkasten: HÜLLE-Zeile entfällt (Gesamtintegrität in %)');
  ok(pult.includes('ZKk.modellZiel(view.state'), 'Ops-Zielkasten: Kreuz des gescannten Ziels');
  ok(render.includes('breschenKeil(ctx, k.x, k.y, k.mitte'), 'Karte: Bresche des gescannten Gegners');
});

console.log(`\ntest-ziel-scan: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
