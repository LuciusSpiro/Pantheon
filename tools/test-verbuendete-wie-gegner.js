'use strict';
// SYS-02b „Verbündete verhalten sich genauso wie Gegner, nur als Verbündete“ (Kai 2026-10-28: Schilde, Waffen, Schiffssysteme).
// Prüft: Schildsegmente je Klasse, Regeneration (Generator, Emitter, Sturm), Trefferweg gleich wie bei Gegnern (Spiegeltest Verbündeter <-> Gegner gleicher Klasse bei gleicher Lage und
// gleichen Treffern), zerstörte und beschädigte Waffen, Gesamtfeuerkraft, Antrieb, Sturm (Sperre, Faktor), Torpedo (zwei Treffer, Jäger sofort), Sperre/Immunität, Gegner-Sperrfeuer auf
// Verbündete über den Trefferweg, Minen, Schützlinge unverändert, Zufall deterministisch (game.rng).
//   node tools/test-verbuendete-wie-gegner.js [begriff …]
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const Katalog = require('../shared/schiffskatalog.js');
const { makeRng } = require('../server/util.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gegnerreparatur = require('../server/sim/gegnerreparatur.js');
const Zs = require('../server/sim/zielsysteme.js');
const Testhilfe = require('./gegner-testhilfe.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const F = CONFIG.flotte;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-verb-wie-gegner-'));
let dirSeq = 0;
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);
const STURM = Katalog.waffe('sturmbatterie').sturm;

// Partie im Raum (Splittergürtel), ohne Gegner, Lerche ruhig und unverwundbar (god)
function raum(seed) {
  const dir = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, seed: seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W0', name: 'W0', color: 0 });
  g.reset(); g.phase = 'play';
  space.enterScene(g, 'splitter', {});
  g.space.enemies = []; g.space.projectiles = []; g.space.asteroids = [];   // keine Brocken: sie träfen die ruhenden Verbündeten (Escort.hit light)
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const sh = g.ship; sh.x = 1500; sh.y = 800; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0;
  g.god = true;
  return { g, events, ev: (k) => events.filter((e) => e.kind === k) };
}
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const summe = (es) => Object.keys(es.sys).reduce((a, id) => a + es.sys[id].i, 0);
const dt = 1 / CONFIG.tickHz;
// Verbündeter ruhig und an einer festen Stelle (kein Flug, kein Formationsplatz), Schilde voll, gestellt (keine Reparatur dazwischen; Tests mit Reparatur setzen es.gestellt = false)
function still(g, tag, kind, x, y, angle) {
  const es = Flotte.aufstellen(g, { tag, kind });
  es.skript = { modus: 'halten' }; es.gestellt = true; es.x = x != null ? x : 1500; es.y = y != null ? y : 500; es.angle = angle || 0; es.vx = 0; es.vy = 0;
  return es;
}
// Punkt in Richtung rel (rad, Bug = 0, Steuerbord positiv) im Abstand d vom Schiff
const quelle = (e, rel, d) => ({ x: e.x + Math.cos(e.angle + rel) * (d || 200), y: e.y + Math.sin(e.angle + rel) * (d || 200) });
const KLASSEN = ['raider', 'korvette', 'fregatte', 'kreuzer'];
const SOLL = { raider: [2, 1, 0, 1], korvette: [1, 2, 0, 2], fregatte: [2, 2, 2, 1, 2, 2], kreuzer: [2, 3, 3, 3, 1, 3, 3, 3] };

section('Schilde: Segmente je Klasse wie bei Gegnern', () => {
  const { g } = raum();
  for (const kind of KLASSEN) {
    const es = still(g, 's_' + kind, kind);
    const lay = Schilde.layout(CONFIG, kind);
    const en = space.spawnEnemy(g, kind, { x: 800, y: 800 }) || g.space.enemies[g.space.enemies.length - 1];
    ok(JSON.stringify(es.shieldsMax) === JSON.stringify(SOLL[kind]), `${kind}: Schildsegmente ${JSON.stringify(es.shieldsMax)} = ${JSON.stringify(SOLL[kind])}`);
    ok(JSON.stringify(es.shieldsMax) === JSON.stringify(lay.max) && JSON.stringify(es.shieldsMax) === JSON.stringify(en.shieldsMax), `${kind}: gleich dem Layout der Klasse und dem Gegner gleicher Klasse`);
    ok(JSON.stringify(es.shields) === JSON.stringify(es.shieldsMax), `${kind}: Schilde zu Beginn voll`);
  }
  const snap = g.snapshot().space.escorts.find((q) => q.tag === 's_kreuzer');
  ok(snap && !('shields' in snap) && !('shieldsMax' in snap) && Object.keys(snap).length <= 10, `Snapshot der Verbündeten bleibt kompakt (${Object.keys(snap).join(',')}), keine neuen Felder`);
});

section('Schilde: Treffer ins Segment der Seite, Schild fängt ab ohne Überlauf', () => {
  const { g } = raum();
  const es = still(g, 'seg', 'kreuzer');
  const lay = Schilde.layout(CONFIG, 'kreuzer');
  // Steuerbord hinten (Segment 3 von 1 + 3): Quelle seitlich-achtern
  const q = quelle(es, Math.PI / 2 + 0.55, 300);
  const sec = Schilde.segmentOf(lay, es.x, es.y, es.angle, q.x, q.y);
  ok(lay.segs[sec].seite === 1 && lay.segs[sec].i === 2, `Test-Quelle liegt im hinteren Steuerbord-Segment (Index ${sec})`);
  const vor = es.shields.slice(); const sys0 = summe(es);
  Escort.hit(g, es, 1, { von: q });
  ok(near(es.shields[sec], vor[sec] - 1) && es.shields.every((v, i) => i === sec || v === vor[i]), `Schaden 1 geht in genau dieses Segment (${vor[sec]} -> ${es.shields[sec]})`);
  Escort.hit(g, es, 50, { von: q });
  ok(es.shields[sec] === 0 && near(summe(es), sys0), 'ein Großtreffer leert das Segment, der Überlauf verfällt: kein Systemschaden solange es stand');
  Escort.hit(g, es, 2, { von: q });
  ok(summe(es) < sys0, 'bei Schild 0 trifft der nächste Treffer ein System');
  const q2 = quelle(es, Math.PI / 2 - 0.55, 300);   // vorderes Steuerbord-Segment: Schild noch voll
  const s2 = Schilde.segmentOf(lay, es.x, es.y, es.angle, q2.x, q2.y);
  ok(s2 !== sec && es.shields[s2] === 3, 'das Nachbarsegment der Seite hat noch seinen vollen Schild');
});

section('Schilde: Regeneration wie bei Gegnern', () => {
  const R = CONFIG.enemyShieldRegen;
  const { g } = raum();
  const a = still(g, 'rg1', 'korvette', 1500, 450);
  a.shields.fill(0); a.regenT = 0;
  ticks(g, R - 0.5);
  ok(a.shields.every((v) => v === 0), `vor ${R} s keine Regeneration`);
  ticks(g, 1);
  ok(a.shields.every((v, i) => v === Math.min(1, a.shieldsMax[i])), `nach ${R} s +1 Punkt je Segment (höchstens bis zum Maximum): ${JSON.stringify(a.shields)}`);
  ticks(g, R * 4);
  ok(JSON.stringify(a.shields) === JSON.stringify(a.shieldsMax), 'läuft bis zum Maximum und nicht darüber');
  // Schildgenerator beschädigt = halb so schnell (Intervall × regenGeneratorBeschaedigt)
  const f = CONFIG.systemModell.gegner.regenGeneratorBeschaedigt;
  const b = still(g, 'rg2', 'fregatte', 1800, 450);
  b.sys.schildgenerator.z = 'damaged'; b.shields.fill(0); b.regenT = 0;
  ticks(g, R * f - 0.5); const v1 = b.shields.reduce((x, y) => x + y, 0);
  ticks(g, 1); const v2 = b.shields.reduce((x, y) => x + y, 0);
  ok(v1 === 0 && v2 > 0, `Schildgenerator beschädigt: Regeneration erst nach ${R * f} s (statt ${R} s)`);
  // zerstört = keine Regeneration, Schilde 0
  const c = still(g, 'rg3', 'kreuzer', 1200, 450);
  Testhilfe.setzeIntegritaet(c, 'schildgenerator', 0);
  ticks(g, R * 3);
  ok(c.shields.every((v) => v === 0), 'Schildgenerator zerstört: alle Schilde 0, keine Regeneration');
  // Emitter beschädigt halbiert die Obergrenze der Seite, zerstört 0
  const d = still(g, 'rg4', 'kreuzer', 900, 450);
  d.sys.emitter_stb.z = 'damaged'; d.sys.emitter_bb.z = 'damaged'; d.sys.emitter_bb.i = 0; d.sys.emitter_bb.z = 'broken';
  ticks(g, dt * 2);
  const lay = Schilde.layout(CONFIG, 'kreuzer');
  const stb = lay.seiten[1], bb = lay.seiten[3];
  ok(stb.every((i) => near(d.shields[i], 3 * CONFIG.systemModell.gegner.emitterBeschaedigt)), `Emitter Stb beschädigt: Obergrenze ${3 * CONFIG.systemModell.gegner.emitterBeschaedigt} statt 3 (Schild gekappt)`);
  ok(bb.every((i) => d.shields[i] === 0), 'Emitter Bb zerstört: Seite Backbord Schild 0');
  ok(d.shields[lay.seiten[0][0]] === 2 && d.shields[lay.seiten[2][0]] === 1, 'andere Seiten unberührt');
  ticks(g, R * 3);
  ok(stb.every((i) => d.shields[i] <= 1.5 + 1e-9) && bb.every((i) => d.shields[i] === 0), 'Regeneration überschreitet die Emitter-Obergrenze nicht');
  // Sturm unterdrückt die Regeneration
  const e = still(g, 'rg5', 'korvette', 1500, 450);
  e.shields[1] = 1.5; e.regenT = 0;
  Escort.hit(g, e, 0.2, { sturm: true, von: quelle(e, Math.PI / 2, 200) });
  const sv = e.shields[1];
  ticks(g, STURM.regenSperre - 0.5);
  ok(e.shields[1] === sv && sv < 1.5, `Sturm-Treffer sperrt die Regeneration für ${STURM.regenSperre} s (Schild bleibt ${sv})`);
  ticks(g, R + 1.5);
  ok(e.shields[1] > sv, 'danach regeneriert er wieder');
});

section('Trefferweg: Spiegeltest Verbündeter <-> Gegner gleicher Klasse', () => {
  const hullPro = CONFIG.escorts.hullPerDamage; const cd = F.crewDamage;
  CONFIG.escorts.hullPerDamage = 1; F.crewDamage = { 1: 1, 2: 1, 3: 1 };   // die Hüllen-Umrechnung der Verbündeten neutral (sie ist der einzige Unterschied im Trefferweg)
  try {
    for (const kind of KLASSEN) {
      const A = raum(3); const B = raum(3);
      for (const x of [A, B]) x.g.time = 50;
      const es = Flotte.aufstellen(A.g, { tag: 'sp', kind }); es.skript = { modus: 'halten' };
      const en = space.spawnEnemy(B.g, kind, { x: 1000, y: 600, facing: 0.3 });
      Testhilfe.setzeBudget(en, F.hull[kind]);
      for (const x of [A, B]) x.g.rng = makeRng(99);   // nach dem Spawn (er würfelt beim Gegner): beide Seiten starten mit demselben Zufallsstand
      es.x = en.x = 1000; es.y = en.y = 600; es.angle = en.angle = 0.3; es.einBis = 0;
      B.g.space.enemies = [en];
      const rnd = makeRng(1234 + kind.length);
      let same = true, wo = '', zaehlt = 0;
      for (let k = 0; k < 120 && same; k++) {
        const a = rnd.range(0, 2 * Math.PI), d = rnd.range(120, 400), dmg = [0.5, 1, 2, 3, 5][rnd.int(5)];
        const o = [{}, {}, { sturm: true }, { pierce: 1 }, { pierce: 99 }][rnd.int(5)];
        const x = es.x + Math.cos(a) * d, y = es.y + Math.sin(a) * d;
        const oa = Object.assign({ von: { x, y } }, o);
        const oe = {}; if (o.sturm) oe.sturm = STURM; if (o.pierce != null) oe.pierce = o.pierce;
        if (!Escort.active(es) || !B.g.space.enemies.includes(en)) break;
        Escort.hit(A.g, es, dmg, oa);
        space.damageEnemy(B.g, en, dmg, x, y, oe);
        zaehlt++;
        if (es.hp <= 1e-9 || en.hp <= 1e-9) { same = es.hp <= 1e-9 && en.hp <= 1e-9; wo = same ? '' : 'Tod nicht gleichzeitig'; break; }   // Tod: beide zugleich (der Ablauf danach ist je Seite verschieden: allyLost, enemyDown)
        const keys = Object.keys(es.sys);
        same = JSON.stringify(es.shields) === JSON.stringify(en.shields) && keys.every((id) => near(es.sys[id].i, en.sys[id].i, 1e-9) && es.sys[id].z === en.sys[id].z)
          && near(es.hp, en.hp, 1e-9) && (es.regenHold || 0) === (en.regenHold || 0) && JSON.stringify(es.repSperre || {}) === JSON.stringify(en.repSperre || {})
          && JSON.stringify(es.rt || null) === JSON.stringify(en.rt || null);
        if (!same) wo = `Treffer ${k}: Schilde ${JSON.stringify(es.shields)} / ${JSON.stringify(en.shields)}, hp ${es.hp} / ${en.hp}`;
      }
      ok(same && zaehlt >= 20, `${kind}: ${zaehlt} gleiche Treffer (Schild, Segment, Zone, Systeme, Sturm-Sperre, Countdown) – Verbündeter und Gegner identisch${wo ? ' – ' + wo : ''}`);
    }
  } finally { CONFIG.escorts.hullPerDamage = hullPro; F.crewDamage = cd; }
});

section('Waffen: zerstörte und beschädigte Plätze, Gesamtfeuerkraft', () => {
  // Korvette im Raum, ruhig; ein Ziel steuerbord (nur der Platz stbd liegt im Bogen). Geschosse werden gezählt (stats.schuesse) und weggeräumt.
  function lauf(zustand, sek, kind, rel) {
    const t = raum(11); const g = t.g;
    const es = still(g, 'wf', kind || 'korvette', 1500, 500, 0);
    const platz = zustand ? Object.keys(es.sys).find((id) => Gsys.defOf(es.kind, id).art === 'waffe' && Gsys.defOf(es.kind, id).platz === 'stbd') : null;
    if (platz) { es.sys[platz].z = zustand; es.sys[platz].i = zustand === 'broken' ? 0 : es.sys[platz].i; }
    const en = space.spawnEnemy(g, 'raider', {});   // Jäger als Ziel: seine Schüsse werden weggeräumt, er beschädigt den Verbündeten nicht
    const p = quelle(es, rel != null ? rel : Math.PI / 2, 300);
    const s0 = Flotte.state(g).stats.schuesse || 0;
    for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) {
      en.x = p.x; en.y = p.y; en.vx = 0; en.vy = 0; es.x = 1500; es.y = 500; es.angle = 0;
      Testhilfe.setzeGesamt(en, en.hpMax);
      g.step(); g.space.projectiles.length = 0;
    }
    return (Flotte.state(g).stats.schuesse || 0) - s0;
  }
  const iv = F.ki.intervall.korvette;
  const soll = 120 / iv;
  const ganz = lauf(null, 120);
  ok(ganz >= soll * 0.8 && ganz <= soll * 1.25, `ohne Schaden: ${ganz} Schüsse in 120 s des Platzes stbd (Soll ≈ ${soll.toFixed(1)} bei Intervall ${iv} s) – Grundtakt unverändert`);
  const beschaedigt = lauf('damaged', 120);
  const fak = CONFIG.systemModell.gegner.taktBeschaedigt;
  ok(beschaedigt >= soll / fak * 0.8 && beschaedigt <= soll / fak * 1.25 && beschaedigt < ganz, `Waffe beschädigt: ${beschaedigt} Schüsse, Intervall × ${fak} (Soll ≈ ${(soll / fak).toFixed(1)})`);
  const zerstoert = lauf('broken', 60);
  ok(zerstoert === 0, `Waffe zerstört: schießt nicht (${zerstoert} Schüsse)`);
  // Reparatur: zerstört -> beschädigt nach zerstoertZuBeschaedigt, danach schießt der Platz wieder (langsamer)
  {
    const t = raum(11); const g = t.g; const es = still(g, 'wr', 'korvette', 1500, 500, 0); es.gestellt = false;
    es.sys.waffe_stbd.i = 0; es.sys.waffe_stbd.z = 'broken';
    const en = space.spawnEnemy(g, 'raider', {});   // Jäger als Ziel: seine Schüsse werden weggeräumt, er beschädigt den Verbündeten nicht
    const p = quelle(es, Math.PI / 2, 300);
    let schuesse = 0; const s0 = () => Flotte.state(g).stats.schuesse || 0;
    for (let i = 0; i < Math.round((CONFIG.systemModell.gegner.reparatur.zerstoertZuBeschaedigt + 20) * CONFIG.tickHz); i++) {
      en.x = p.x; en.y = p.y; en.vx = 0; en.vy = 0; es.x = 1500; es.y = 500; es.angle = 0; Testhilfe.setzeGesamt(en, en.hpMax);
      g.step(); g.space.projectiles.length = 0; if (es.sys.waffe_stbd.z === 'broken') schuesse = s0();
    }
    ok(es.sys.waffe_stbd.z !== 'broken' && s0() > schuesse, 'nach der Reparatur schießt der Platz wieder');
  }
  // Platzbogen: ein Ziel achtern (kein Platz der Korvette deckt es ab) wird nicht beschossen; Fregatte und Kreuzer feuern mit ihren Plätzen
  ok(lauf(null, 40, 'korvette', Math.PI) === 0, 'Ziel im toten Winkel (achtern): kein Schuss (Platzbogen wirkt)');
  const fr = lauf(null, 120, 'fregatte'), frIv = F.ki.intervall.fregatte;
  ok(fr >= 2 * 120 / frIv * 0.75 && fr <= 2 * 120 / frIv * 1.3, `Fregatte steuerbord: zwei Plätze stbd1/stbd2 im Bogen = ${fr} Schüsse (Soll ≈ ${(2 * 120 / frIv).toFixed(1)})`);
});

section('Antrieb: beschädigt ×0,5, zerstört 0, Reparatur gilt', () => {
  function fahrt(zustand, sek) {
    const t = raum(5); const g = t.g; const es = Flotte.aufstellen(g, { tag: 'an', kind: 'korvette' });
    es.x = 1500; es.y = 300; es.angle = 0; es.vx = 0; es.vy = 0; es.stage = 0; es.gestellt = true;
    es.skript = { modus: 'ziel', x: 2600, y: 300, r: 40, tempo: 1 };
    if (zustand) { es.sys.antrieb.z = zustand; es.sys.antrieb.i = zustand === 'broken' ? 0 : es.sys.antrieb.i; }
    g.space.escorts.forEach((q) => { q.einBis = 0; });
    let vmax = 0;
    for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) { g.step(); vmax = Math.max(vmax, Math.hypot(es.vx, es.vy)); if (zustand === 'broken') es.sys.antrieb.z = 'broken'; }
    return { vmax, weg: es.x - 1500, es, g };
  }
  const ok0 = fahrt(null, 25), dm = fahrt('damaged', 25), br = fahrt('broken', 25);
  ok(ok0.vmax > 30, `intakter Antrieb: Höchsttempo ${ok0.vmax.toFixed(0)} px/s`);
  ok(dm.vmax > 0.35 * ok0.vmax && dm.vmax < 0.65 * ok0.vmax, `Antrieb beschädigt: Höchsttempo ${dm.vmax.toFixed(0)} px/s ≈ ×0,5 (${(dm.vmax / ok0.vmax).toFixed(2)})`);
  ok(br.vmax < 1 && Math.abs(br.weg) < 5, `Antrieb zerstört: das Schiff bleibt stehen (${br.vmax.toFixed(2)} px/s, Weg ${br.weg.toFixed(1)} px)`);
  // Reparatur (zerstört -> beschädigt) lässt es wieder fahren; die Szene bleibt nicht gelähmt
  const t = raum(5); const g = t.g; const es = Flotte.aufstellen(g, { tag: 'an2', kind: 'korvette' });
  es.einBis = 0; es.x = 1500; es.y = 300; es.angle = 0; es.vx = 0; es.vy = 0; es.skript = { modus: 'ziel', x: 2600, y: 300, r: 40, tempo: 1 };
  es.sys.antrieb.i = 0; es.sys.antrieb.z = 'broken';
  ticks(g, 5); const x5 = es.x;
  ticks(g, CONFIG.systemModell.gegner.reparatur.zerstoertZuBeschaedigt + 6);
  ok(Math.abs(x5 - 1500) < 5 && es.sys.antrieb.z !== 'broken' && es.x > x5 + 20, `zerstörter Antrieb: steht, bis die Reparatur fertig ist (nach ${CONFIG.systemModell.gegner.reparatur.zerstoertZuBeschaedigt} s fährt es wieder)`);
  // Formation: ein Verbündeter mit zerstörtem Antrieb bleibt zurück, der Szenenwechsel stellt ihn wieder hinter die Lerche
  ok(g.errors === 0 || g.errors == null, 'keine Server-Fehler');
});

section('Sturm: Sperre, Faktor, Schaden gegen Schild', () => {
  const { g } = raum(); const sk = CONFIG.escorts.hullPerDamage * F.crewDamage[1];
  // hoher Schild: kaum Schildschaden, kein Systemschaden
  const a = still(g, 'st1', 'kreuzer', 1500, 450);
  const lay = Schilde.layout(CONFIG, 'kreuzer'); const q = quelle(a, Math.PI / 2 + 0.55, 300); const sec = Schilde.segmentOf(lay, a.x, a.y, a.angle, q.x, q.y);
  const sys0 = summe(a);
  for (let i = 0; i < 6; i++) Escort.hit(g, a, 1, { sturm: true, von: q });
  ok(near(a.shields[sec], 3 - 6 * STURM.schildFaktor, 1e-6) && near(summe(a), sys0), `hoher Schild (> ${STURM.niedrig}): 6 Nadeln nehmen je ${STURM.schildFaktor} (Schild ${a.shields[sec]}), kein Systemschaden`);
  ok(a.regenHold > g.time, 'Sturm setzt die Regenerationssperre');
  // Reparatursperre der Zone
  const zone = Gsys.SEITE_ZONE[1];
  const b = still(g, 'st2', 'kreuzer', 1100, 450); b.gestellt = false;
  b.sys.waffe_stbd1.i = 0; b.sys.waffe_stbd1.z = 'broken'; b.sys.waffe_stbd1.rp = 3; b.sys.waffe_stbd1.rpVon = 'broken';
  Escort.hit(g, b, 1, { sturm: true, von: quelle(b, Math.PI / 2, 300) });
  ok(Gegnerreparatur.gesperrt(g, b, 'waffe_stbd1') && b.sys.waffe_stbd1.rp === 0 && Gegnerreparatur.gesperrt(g, b, 'waffe_stbd2') && !Gegnerreparatur.gesperrt(g, b, 'waffe_bb1'),
    `Sturm-Treffer sperrt die Reparatur der Zone ${zone} für ${CONFIG.systemModell.sturm.reparaturSperre_s} s (Fortschritt 0), andere Zonen frei`);
  ticks(g, CONFIG.systemModell.sturm.reparaturSperre_s - 1);
  ok(b.sys.waffe_stbd1.z === 'broken', 'während der Sperre keine Reparatur');
  ticks(g, 1.5 + CONFIG.systemModell.gegner.reparatur.zerstoertZuBeschaedigt);
  ok(b.sys.waffe_stbd1.z !== 'broken', 'nach der Sperre läuft die Reparatur');
  // Schild 0: Systemschaden × systemFaktor
  const c1 = still(g, 'st3', 'korvette', 800, 450), c2 = still(g, 'st4', 'korvette', 1000, 450);
  for (const c of [c1, c2]) { c.shields.fill(0); c.sys.waffe_stbd.i = Gsys.maxOf(c, 'waffe_stbd'); Testhilfe.setzeIntegritaet(c, 'bug', 0); Testhilfe.setzeIntegritaet(c, 'bb', 0); Testhilfe.setzeIntegritaet(c, 'heck', 0); }
  const dd = 0.4;
  const w0 = (c) => c.sys.waffe_stbd.i + c.sys.emitter_stb.i;
  const v1 = w0(c1), v2 = w0(c2);
  Escort.hit(g, c1, dd, { von: quelle(c1, Math.PI / 2, 200) });
  Escort.hit(g, c2, dd, { sturm: true, von: quelle(c2, Math.PI / 2, 200) });
  const l1 = v1 - w0(c1), l2 = v2 - w0(c2);
  ok(near(l1, dd * sk, 1e-6) && near(l2, dd * sk * CONFIG.systemModell.sturm.systemFaktor, 1e-6), `Schild 0: Sturm wirkt gegen das System × systemFaktor ${CONFIG.systemModell.sturm.systemFaktor} (${l2.toFixed(3)} statt ${l1.toFixed(3)})`);
});

section('Torpedo: Lesart B, zwei Treffer, Jäger sofort', () => {
  const { g, ev } = raum();
  const es = still(g, 'tp', 'korvette', 1500, 450);
  const q = quelle(es, Math.PI / 2, 300);
  const sys0 = summe(es);
  Escort.hit(g, es, 1, { torpedo: true, von: q });
  ok(near(summe(es), sys0) && es.shields[1] === 2, 'Schild steht: der Torpedo prallt ab, kein Schaden, Schild unberührt');
  es.shields.fill(0);
  const re = Gsys.maxOf(es, 'reaktor');
  Escort.hit(g, es, 1, { torpedo: true, von: q });
  const broken1 = Object.keys(es.sys).filter((id) => es.sys[id].z === 'broken' && id !== 'reaktor');
  ok(broken1.length === 1 && Gsys.defOf('korvette', broken1[0]).zone === 'stb', `Schild 0: das getroffene Zonensystem ist zerstört (${broken1.join(',')})`);
  ok(es.sys.reaktor.z === 'damaged' && near(es.sys.reaktor.i, re * (1 - CONFIG.systemModell.torpedo.reaktorAnteil)), `schlägt mit ${CONFIG.systemModell.torpedo.reaktorAnteil} × Reaktor auf die Mitte durch: Reaktor beschädigt (${es.sys.reaktor.i.toFixed(1)}/${re.toFixed(1)})`);
  ok(!es.rt || es.rt.rest == null, 'ein Treffer: noch kein Countdown');
  Escort.hit(g, es, 1, { torpedo: true, von: q });
  ok(es.sys.reaktor.z === 'broken' && es.rt && es.rt.rest > 0, `zweiter Treffer: Reaktor zerstört, Countdown läuft (${es.rt && es.rt.rest} s)`);
  ticks(g, es.rt.rest + 0.5);
  ok(ev('allyLost').some((x) => x.tag === 'tp'), 'Countdown abgelaufen: Verbündeter zerstört');
  // Jäger: ein Torpedo bei Schild 0 und er ist tot
  const j = still(g, 'tj', 'raider', 1200, 450); j.shields.fill(0);
  Escort.hit(g, j, 1, { torpedo: true, von: quelle(j, 0.1, 200) });
  ticks(g, 0.2);
  ok(ev('allyLost').some((x) => x.tag === 'tj') && !g.space.escorts.some((q2) => q2.tag === 'tj'), 'Jäger (torpedoSofortTod): sofort zerstört (ohne Countdown), aus dem Raum');
  ok(ev('allyLost').filter((x) => x.tag === 'tj').length === 1, 'allyLost genau einmal');
});

section('Sperre und Immunität (nachholen) gelten für Verbündete', () => {
  const { g } = raum();
  const es = still(g, 'sp', 'korvette', 1500, 450);
  const SP = require('../content/kampf/zielsysteme-werte.json').werte.treffer.wert.sperre_s;
  const st = es.sys.antrieb; const m = Gsys.maxOf(es, 'antrieb');
  es.shields.fill(0);
  // erster Treffer auf den Antrieb: beschädigt; zweiter innerhalb der Sperre: Integrität sinkt, der Zustand holt erst nach der Sperre nach
  Gsys.treffenAuf(g, es, 'antrieb', 'heck', m * 0.5, false);
  ok(st.z === 'damaged', 'Antrieb beschädigt');
  Gsys.treffenAuf(g, es, 'antrieb', 'heck', m, false);
  ok(st.i === 0 && st.z === 'damaged', `zweiter Treffer innerhalb ${SP} s: Integrität 0, der Zustand bleibt beschädigt (Sperre)`);
  ticks(g, SP + 1);
  ok(st.z === 'broken', `nach der Sperre holt der Zustand nach (${st.z}, allySysTick -> nachholen)`);
});

section('Gegner-Sperrfeuer und Sturm auf Verbündete über den Trefferweg', () => {
  const { g } = raum(); const EF = CONFIG.spaceS2b.sperrfeuer.escortFactor; const sk = CONFIG.escorts.hullPerDamage * F.crewDamage[1];
  const es = still(g, 'sf', 'kreuzer', 1500, 450, 0);
  const lay = Schilde.layout(CONFIG, 'kreuzer');
  const sPos = quelle(es, Math.PI / 2 + 0.5, 0);   // Position des Geschosses = Quelle des Treffers: knapp am Rumpf (hitRadius), Seite aus der Geometrie
  const proj = (kind, dmg) => ({ id: g.nextId('pr'), kind, x: es.x + Math.cos(es.angle + Math.PI / 2 + 0.5) * 20, y: es.y + Math.sin(es.angle + Math.PI / 2 + 0.5) * 20, angle: 0, speed: 0, ttl: 5, dmg, owner: 'x', tgt: es.id });
  const sec = Schilde.segmentOf(lay, es.x, es.y, es.angle, es.x + Math.cos(es.angle + Math.PI / 2 + 0.5) * 20, es.y + Math.sin(es.angle + Math.PI / 2 + 0.5) * 20);
  const sys0 = summe(es); const s0 = es.shields[sec];
  g.space.projectiles.push(proj('sperrfeuer', 0.5));
  g.step();
  ok(near(es.shields[sec], s0 - 0.5 * EF, 1e-6) && near(summe(es), sys0), `Sperrfeuer trifft das Schildsegment (${s0} -> ${es.shields[sec]}, escortFactor ${EF}), kein Systemschaden bei stehendem Schild`);
  es.shields.fill(0);
  g.space.projectiles.push(proj('sperrfeuer', 0.5));
  g.step();
  const verl = sys0 - summe(es);
  ok(near(verl, 0.5 * EF * sk, 1e-6), `bei Schild 0 geht es in ein System der Zone: −${verl.toFixed(3)} (Schaden × escortFactor × Hüllen-Umrechnung ${sk}), nicht mehr als Direktschaden auf die Hülle`);
  // Sturm-Nadel des Gegners: gleiche Regel wie gegen die Lerche (Schildfaktor, Sperre)
  es.shields.fill(3);
  const sv = es.shields[sec];
  g.space.projectiles.push(proj('sturm', 1));
  g.step();
  ok(near(es.shields[sec], sv - STURM.schildFaktor, 1e-6) && es.regenHold > g.time, `Sturm-Nadel auf den Verbündeten: Schild −${STURM.schildFaktor}, Regeneration gesperrt`);
  // schwere Ladung (Strahl, escort.updateAttack -> hit): läuft über den Schild
  es.shields.fill(2); const s1 = es.shields[sec];
  Escort.hit(g, es, 3, { heavy: true, von: { x: es.x + Math.cos(es.angle + Math.PI / 2 + 0.5) * 300, y: es.y + Math.sin(es.angle + Math.PI / 2 + 0.5) * 300 } });
  ok(es.shields[sec] === 0 && s1 === 2, 'schwerer Treffer nimmt das Segment, Überlauf verfällt');
});

section('Minen und quellenlose Treffer', () => {
  const { g } = raum();
  const es = still(g, 'mn', 'fregatte', 1500, 450);
  const sys0 = summe(es);
  Flotte.mineSchaden(g, { x: es.x + 60, y: es.y, besitzer: 'gegner' }, 200);
  ok(summe(es) < sys0 && es.shields.every((v, i) => v === es.shieldsMax[i]), 'Mine geht am Schild vorbei (pierce, wie bei Gegnern) und trifft ein System');
  // quellenlos: zufällige Seite, alle Segmente kommen vor, nur game.rng
  const t = raum(); const f = still(t.g, 'ql', 'fregatte', 1500, 450); f.shields.fill(1000);
  const vorher = f.shields.slice();
  for (let i = 0; i < 300; i++) Escort.hit(t.g, f, 0.01, { light: true });
  ok(f.shields.every((v, i) => v < vorher[i]), `ohne Quelle trifft jede Seite und jedes Segment (${f.shields.map((v) => (1000 - v).toFixed(2)).join(' ')})`);
});

section('Schützlinge bleiben vereinfacht', () => {
  const { g } = raum();
  const s = Escort.spawn(g, { tag: 'sz', kind: 'frachter', verhalten: 'folgt_kurs', von: 'lerche' });
  ok(!Gsys.hat(s) && s.shields === undefined && s.shieldsMax === undefined, 'Schützling: kein Systemmodell, keine Schilde');
  const cdv = Number(CONFIG.escorts.crewDamage[1]) || 1; const k = CONFIG.escorts.hullPerDamage * cdv;
  const h0 = s.hp; Escort.hit(g, s, 2, {});
  const d1 = h0 - s.hp;
  const h1 = s.hp; Escort.hit(g, s, 2, { sturm: true, von: { x: s.x + 50, y: s.y } });
  const d2 = h1 - s.hp;
  const h2 = s.hp; Escort.hit(g, s, 2, { torpedo: true, von: { x: s.x + 50, y: s.y } });
  const d3 = h2 - s.hp;
  ok(near(d1, 2 * k, 0.11) && near(d2, d1, 1e-9) && near(d3, d1, 1e-9), `Sturm und Torpedo gegen den Schützling: gewöhnlicher Hüllenschaden −${d1.toFixed(1)} (Schaden × hullPerDamage × crewDamage), wie bisher`);
});

section('Zufall: deterministisch über game.rng', () => {
  function lauf() {
    const t = raum(21); const g = t.g; const es = still(g, 'dz', 'kreuzer', 1500, 450);
    for (let i = 0; i < 60; i++) { Escort.hit(g, es, [0.5, 1, 2, 3][i % 4], i % 3 ? { light: true } : { von: quelle(es, i * 0.7, 200) }); }
    return JSON.stringify({ s: es.shields, i: Object.keys(es.sys).map((id) => es.sys[id].i), hp: es.hp });
  }
  ok(lauf() === lauf(), 'zwei Läufe mit gleichem Seed und gleichen Treffern: identischer Zustand');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'escort.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'gegnersystem.js'), 'utf8');
  ok(!/Math\.random/.test(src), 'kein Math.random in escort.js und gegnersystem.js');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`\n${n - fails}/${n} ok${fails ? ' – ' + fails + ' FEHLER' : ''}`);
if (fails) { console.log('TEST-VERBUENDETE-WIE-GEGNER FEHLER'); process.exit(1); }
console.log('TEST-VERBUENDETE-WIE-GEGNER OK');
