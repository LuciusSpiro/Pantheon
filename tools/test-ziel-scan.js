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
  const ctx = { fillStyle: '', fillRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} };
  const R = { text: (c, s) => texte.push({ s: String(s) }), measure: (s) => String(s).length * 6 };
  return { ctx, R, texte };
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

section('Test, Vorher → Nachher (Ziel-Scan, Einbindung)', () => {
  const kons = read('public/js/consoles.js'), pult = read('public/js/pult-stationen.js'), render = read('public/js/render.js');
  ok(kons.includes('wahlbar(view.state, target)') && kons.includes('wahlbar(view.state, tg)') && /reihum/.test(kons), 'Ops-Knopf und Taste 0 wählen reihum über die anwählbaren Systeme');
  const zk = pult.split('pultZielkasten(c, view, b, target)')[1] || '';
  ok(!/T\(c, 'HÜLLE'/.test(zk.slice(0, 1200)), 'Ops-Zielkasten: HÜLLE-Zeile entfällt (Gesamtintegrität in %)');
  ok(pult.includes('ZKk.modellZiel(view.state'), 'Ops-Zielkasten: Kreuz des gescannten Ziels');
  ok(render.includes('breschenKeil(ctx, s.x, s.y, eAng'), 'Karte: Bresche des gescannten Gegners');
});

console.log(`\ntest-ziel-scan: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
