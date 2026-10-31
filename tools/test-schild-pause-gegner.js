'use strict';
// SYS-03 C2: Regenerationspause der Schilde von Gegnern und Verbündeten je SEGMENT (Helfer Schilde.pause, shared/schilde.js; eine Regel mit der Lerche, C1).
// Regel: Ein Segment regeneriert erst, wenn auf DIESES Segment shields.regenDelay s lang kein Treffer ankam (jeder Treffer zählt, auch bei Schild 0, am Schild vorbei, Torpedo-Abpraller, Sturm,
// Streu, Lanze, Mine, Dauerdruck), danach 1 Punkt je enemyShieldRegen s (Timer je Segment). Sturm-Treffer sperren zusätzlich systemModell.sturm.regenSperre_s (es gilt das Längere).
// Eine Quelle je Wert: Pause = shields.regenDelay (wie die Lerche), Takt = enemyShieldRegen (Gegner) bzw. shields.regenInterval (Lerche).
// Der Stempel sitzt EINMAL in space.damageEnemy (alle Wege laufen dort durch: Waffen der Lerche, Waffen der Verbündeten, Dauerdruck, Mine, Brocken, Gegnerfeuer auf Verbündete über escort.hit).
// Abschnitt "Mutationsprobe": ohne Stempel wird jeder Stempel-Test rot.
//   node tools/test-schild-pause-gegner.js   (npm run test:schild-pause-gegner)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const Schilde = require('../shared/schilde.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Combat = require('../server/sim/combat.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); } }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-schild-pause-gegner-'));
const SH = CONFIG.shields;
const DELAY = SH.regenDelay, TAKT = CONFIG.enemyShieldRegen;
const STURM = Katalog.waffe('sturmbatterie').sturm;
const STURM_SPERRE = CONFIG.systemModell.sturm.regenSperre_s;
const dt = 1 / CONFIG.tickHz;
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);
const KLASSEN = ['raider', 'korvette', 'fregatte', 'kreuzer'];
let seq = 0;

function raum(seed) {
  const g = new Game({ noStore: true, seed: seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie' + (++seq)) }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W0', name: 'W0', color: 0 });
  g.reset(); g.phase = 'play';
  space.enterScene(g, 'splitter', {});
  g.space.enemies = []; g.space.projectiles = []; g.space.asteroids = [];
  const sh = g.ship; sh.x = 1500; sh.y = 800; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0; g.god = true;
  g.ship.shields.current = [8, 8, 8, 8];
  return g;
}
// Gegner ruhig an fester Stelle, in die Liste, aber ohne KI-Schritt: wir treiben Zeit und Schild-Tick selbst (g.time von Hand), das Verhalten des Gegners ist hier nicht Thema
function gegner(g, kind, x, y) {
  const e = space.spawnEnemy(g, kind, { x: x || 1500, y: y || 500, facing: 0 }) || g.space.enemies[g.space.enemies.length - 1];
  e.x = x || 1500; e.y = y || 500; e.angle = 0; e.vx = e.vy = 0; e.retreatUntil = 0;
  return e;
}
function verbuendeter(g, kind, x, y) {
  const es = Flotte.aufstellen(g, { tag: 'sp_' + kind + (++seq), kind });
  es.skript = { modus: 'halten' }; es.gestellt = true; es.x = x || 1500; es.y = y || 500; es.angle = 0; es.vx = 0; es.vy = 0;
  return es;
}
const quelle = (e, rel, d) => ({ x: e.x + Math.cos(e.angle + rel) * (d || 200), y: e.y + Math.sin(e.angle + rel) * (d || 200) });
// Zeit vorrücken (nur Schild-Tick, kein KI-Schritt)
const tickSek = (g, es, sek) => { const k = Math.round(sek / dt); for (let i = 0; i < k; i++) { g.time += dt; Gsys.schildTick(g, es, dt); } };
const treffer = (g, e, q, dmg, opts) => space.damageEnemy(g, e, dmg, q.x, q.y, opts);
const seg = (e, q) => Schilde.segmentOf(Schilde.layout(CONFIG, e.kind), e.x, e.y, e.angle, q.x, q.y);
const bis = (e, i) => Schilde.pause.bis(e, i);

// ---------- Stempel-Quellen (als Tabelle, damit die Mutationsprobe dieselben Prüfungen nutzt) ----------
function STEMPEL_FALL(kind, schild, opts, opts2) {
  const g = raum(); const e = gegner(g, kind);
  const q = quelle(e, 0, 300); const s = seg(e, q);
  e.shields[s] = schild;
  g.time += 3;
  treffer(g, e, q, opts2 && opts2.dmg != null ? opts2.dmg : 1, opts);
  const gestempelt = bis(e, s) > g.time + 0.5;
  const nachbarn = e.shields.every((v, i) => i === s || bis(e, i) === 0);
  return { ok: gestempelt && nachbarn, text: `Segment ${s} (Schild ${schild}) Pause bis +${(bis(e, s) - g.time).toFixed(1)} s` };
}
const STEMPEL = {
  'Standardtreffer (Schild steht)': () => STEMPEL_FALL('korvette', 2, {}),
  'Treffer bei Schild 0': () => STEMPEL_FALL('korvette', 0, {}),
  'Durchschlag (Lanze, pierce)': () => STEMPEL_FALL('fregatte', 2, { pierce: 1 }),
  'Lanze Vollladung (durchschlag zone)': () => STEMPEL_FALL('fregatte', 2, { durchschlag: 'zone' }),
  'Streu': () => STEMPEL_FALL('kreuzer', 3, { streu: { schildFaktor: 2 } }),
  'Sturm (Schild hoch)': () => { const r = STEMPEL_FALL('korvette', 2, { sturm: STURM }); return r; },
  'Sturm (Schild niedrig, Störung)': () => STEMPEL_FALL('korvette', STURM.niedrig * 0.5, { sturm: STURM }),
  'Torpedo-Abpraller (Schild steht)': () => STEMPEL_FALL('kreuzer', 2, { torpedo: true, huelle: true, nurOhneSchild: true }),
  'Torpedo bei Schild 0': () => STEMPEL_FALL('kreuzer', 0, { torpedo: true, huelle: true, nurOhneSchild: true }),
  'Dauerdruck (druck)': () => STEMPEL_FALL('kreuzer', 1, { druck: true }),
  'Mine / Brocken (ohne opts)': () => STEMPEL_FALL('raider', 1, undefined, { dmg: 20 }),
  'Verbündeter (Gegnerfeuer über escort.hit)': () => {
    const g = raum(); const es = verbuendeter(g, 'korvette');
    const q = quelle(es, 0, 300); const s = seg(es, q); g.time += 3;
    Escort.hit(g, es, 1, { von: q });
    return { ok: bis(es, s) > g.time + 0.5 && es.shields.every((v, i) => i === s || bis(es, i) === 0), text: `Segment ${s} Pause bis +${(bis(es, s) - g.time).toFixed(1)} s` };
  },
  'Verbündeter: Sturm': () => {
    const g = raum(); const es = verbuendeter(g, 'korvette');
    const q = quelle(es, 0, 300); const s = seg(es, q); g.time += 3;
    Escort.hit(g, es, 0.3, { von: q, sturm: true });
    return { ok: bis(es, s) >= g.time + STURM_SPERRE - 1e-6, text: `Segment ${s} Sturm-Pause bis +${(bis(es, s) - g.time).toFixed(1)} s` };
  },
  'Verbündeter: Dauerdruck': () => {
    const g = raum(); const es = verbuendeter(g, 'kreuzer');
    const q = quelle(es, 0, 300); const s = seg(es, q); g.time += 3;
    Escort.hit(g, es, 1, { light: true, druck: true, von: q });
    return { ok: bis(es, s) > g.time + 0.5, text: `Segment ${s} Pause bis +${(bis(es, s) - g.time).toFixed(1)} s` };
  },
};

section('Konfiguration: eine Quelle je Wert, Altfeld regenHold weg', () => {
  ok(DELAY === 5 && TAKT === 5, `shields.regenDelay ${DELAY} s (Pause, wie die Lerche), enemyShieldRegen ${TAKT} s (Takt je Segment)`);
  const e = gegner(raum(), 'korvette');
  space.damageEnemy(raum(), e, 0.1, 1500, 800, {});
  ok(!('regenHold' in e) && !Object.keys(e).includes('schildPause'), 'kein Feld regenHold am Gegner; die Pause ist nicht aufzählbar (nicht im Snapshot, nicht in Kopien)');
  ok(!JSON.stringify(e).includes('schildPause') && !JSON.stringify(Object.assign({}, e)).includes('schildPause'), 'JSON-Kopie und Spread tragen die Pause nicht: nirgends ein neues Feld, und die Kopie ist keine Trefferstelle');
});

section('Takt je Segment (Jäger, Korvette, Fregatte, Kreuzer)', () => {
  for (const kind of KLASSEN) {
    const g = raum(); const e = gegner(g, kind);
    const lay = Schilde.layout(CONFIG, kind);
    // Segment mit Schild >= 2, damit nach dem Treffer noch ein Rest steht und die Regeneration sichtbar ist
    const sec = lay.max.findIndex((m) => m >= 2);
    const rel = lay.segs[sec].seite === 0 ? 0 : lay.segs[sec].seite === 2 ? Math.PI : (lay.segs[sec].seite === 1 ? 1 : -1) * (Math.PI / 2 + (lay.segs[sec].von + 0.5 / lay.segs[sec].n - 0.5) * 1.2);
    let q = quelle(e, rel, 300); let s = seg(e, q);
    if (s !== sec) { for (let r = -Math.PI; r < Math.PI; r += 0.02) { q = quelle(e, r, 300); if (seg(e, q) === sec) break; } s = seg(e, q); }
    ok(s === sec, `${kind}: Test-Quelle trifft Segment ${sec}`);
    const t0 = g.time;
    treffer(g, e, q, 1, {});
    const v1 = e.shields[sec];
    ok(near(v1, lay.max[sec] - 1) && near(bis(e, sec), t0 + DELAY), `${kind}: Treffer auf Segment ${sec}: Schild ${lay.max[sec]} -> ${v1}, Pause bis +${DELAY} s`);
    const andere = lay.max.map((m, i) => i).filter((i) => i !== sec);
    ok(andere.every((i) => bis(e, i) === 0), `${kind}: kein anderes Segment bekommt eine Pause`);
    tickSek(g, e, DELAY - 0.3); ok(e.shields[sec] === v1, `${kind}: während der Pause keine Regeneration (${v1})`);
    tickSek(g, e, 0.3 + TAKT - 0.3); ok(e.shields[sec] === v1, `${kind}: nach der Pause erst nach einem vollen Takt (${TAKT} s) +1`);
    tickSek(g, e, 0.6); ok(e.shields[sec] === v1 + 1, `${kind}: danach +1 (${e.shields[sec]})`);
  }
});

section('Treffer bei laufendem Takt: der Takt startet nach der Pause bei 0 (nicht eingefroren)', () => {
  // Das Segment regeneriert (Takt läuft, 3 von 5 s), dann trifft es ein Schuss: Pause 5 s, der Takt wird auf 0 gesetzt. Nach der Pause kommt der erste Punkt nach einem vollen Takt (nicht schon 2 s später).
  for (const kind of ['korvette', 'kreuzer']) {
    const g = raum(); const e = gegner(g, kind);
    const q = quelle(e, 0, 300); const s = seg(e, q);
    e.shields[s] = Math.max(0, e.shieldsMax[s] - 3);
    tickSek(g, e, TAKT - 2);
    ok(e.shields[s] === Math.max(0, e.shieldsMax[s] - 3) && e.regenT[s] > TAKT - 2.2, `${kind}: Takt läuft (${e.regenT[s].toFixed(2)} s von ${TAKT} s), noch kein Punkt`);
    treffer(g, e, q, 0.5, {}); const v1 = e.shields[s];
    tickSek(g, e, DELAY - 0.2);
    ok(e.regenT[s] === 0 && e.shields[s] === v1, `${kind}: in der Pause Takt 0 (${e.regenT[s]}), kein Punkt`);
    tickSek(g, e, 0.2 + TAKT - 0.5);
    ok(e.shields[s] === v1, `${kind}: nach der Pause erst nach einem vollen Takt (${TAKT} s) ein Punkt, nicht früher (${e.shields[s]})`);
    tickSek(g, e, 1);
    ok(e.shields[s] === v1 + 1, `${kind}: danach +1 (${e.shields[s]})`);
  }
});

section('Segment gegen Segment: der Rest regeneriert, das getroffene steht', () => {
  const g = raum(); const e = gegner(g, 'kreuzer');
  const lay = Schilde.layout(CONFIG, 'kreuzer');
  // zwei Segmente auf Steuerbord: vorderes bekommt Treffer, hinteres war vorher beschädigt und bleibt ohne neuen Treffer frei
  const [vorn, hinten] = [lay.seiten[1][0], lay.seiten[1][2]];
  e.shields[hinten] = 1; e.shields[vorn] = 3;
  const qv = quelle(e, Math.PI / 2 - 0.55, 300), qh = quelle(e, Math.PI / 2 + 0.55, 300);
  ok(seg(e, qv) === vorn && seg(e, qh) === hinten, 'Quellen treffen vorderes bzw. hinteres Steuerbord-Segment');
  treffer(g, e, qv, 1, {});
  tickSek(g, e, TAKT + 0.5);
  ok(e.shields[hinten] === 2, 'das unbeschossene Segment der selben Seite regeneriert sofort im Takt (kein Seiten-Sperren)');
  ok(e.shields[vorn] === 2, 'das getroffene Segment steht (Pause läuft noch, Takt wartet)');
  // der erste Takt nach der Pause für das getroffene Segment kommt frühestens DELAY + TAKT nach dem Treffer
  tickSek(g, e, DELAY + TAKT);
  ok(e.shields[vorn] === 3, 'danach regeneriert auch das getroffene Segment');
});

section('Spiegel: gleiche Treffer, gleiches Ergebnis (Lerche, Gegner, Verbündeter)', () => {
  // Lerche (regenInterval) und Gegner (enemyShieldRegen) haben verschiedene Takte; die Pause ist dieselbe Quelle. Gleiche Treffer: Pause bis t + regenDelay, Sturm bis t + max(regenDelay, regenSperre)
  for (const kind of KLASSEN) {
    const g = raum(); const e = gegner(g, kind); const a = verbuendeter(g, kind, 1500, 700);
    const eq = quelle(e, 0, 300), aq = quelle(a, 0, 300);
    const se = seg(e, eq), sa = seg(a, aq);
    const t0 = g.time;
    treffer(g, e, eq, 0.5, {}); Escort.hit(g, a, 0.5, { von: aq });
    ok(se === sa && near(bis(e, se), bis(a, sa)) && near(bis(e, se), t0 + DELAY), `${kind}: Gegner und Verbündeter: dieselbe Pause (bis +${DELAY} s) im selben Segment ${se}`);
    g.time += 1;
    treffer(g, e, eq, 0.5, { sturm: STURM }); Escort.hit(g, a, 0.5, { von: aq, sturm: true });
    ok(near(bis(e, se), bis(a, sa)) && near(bis(e, se), t0 + 1 + Math.max(DELAY, STURM_SPERRE)), `${kind}: Sturm: Gegner und Verbündeter beide bis +${Math.max(DELAY, STURM_SPERRE)} s`);
  }
  // Lerche: dieselbe Pause je Sektor
  const g = raum(); const t0 = g.time;
  space.shipHit(g, 0, 1, {});
  ok(near(Schilde.pause.bis(g.ship.shields, 0), t0 + DELAY), 'Lerche: Treffer auf Sektor 0: Pause bis +regenDelay (gleiche Quelle)');
});

section('Alle Stempel-Quellen am Gegner', () => {
  for (const [name, fn] of Object.entries(STEMPEL)) {
    const r = fn();
    ok(r.ok, `${name}: ${r.text}`);
  }
});

section('Sturm-Sperre länger als die Pause', () => {
  const g = raum(); const e = gegner(g, 'korvette');
  const q = quelle(e, Math.PI / 2, 300); const s = seg(e, q);
  const t0 = g.time;
  e.shields[s] = 2;
  treffer(g, e, q, 1, { sturm: STURM });
  ok(near(bis(e, s), t0 + Math.max(DELAY, STURM_SPERRE)) && STURM_SPERRE > DELAY, `Sturm-Treffer: Pause ${Math.max(DELAY, STURM_SPERRE)} s (länger als normal ${DELAY} s)`);
  const v = e.shields[s];
  tickSek(g, e, STURM_SPERRE + TAKT - 0.5); ok(e.shields[s] === v, `${(STURM_SPERRE + TAKT - 0.5).toFixed(1)} s nach dem Sturm-Treffer noch keine Regeneration`);
  tickSek(g, e, 1); ok(e.shields[s] > v, 'danach regeneriert er');
  // ein normaler Treffer danach verkürzt die Sturm-Sperre nie
  const g2 = raum(); const e2 = gegner(g2, 'korvette'); const s2 = seg(e2, q);
  treffer(g2, e2, q, 0.2, { sturm: STURM }); const b = bis(e2, s2); g2.time += 1; treffer(g2, e2, q, 0.2, {});
  ok(bis(e2, s2) === b, 'ein späterer normaler Treffer verkürzt die laufende Sturm-Sperre nie');
});

section('Verbündete: Pause im Spielablauf (g.step)', () => {
  const g = raum(); const es = verbuendeter(g, 'korvette');
  const q = quelle(es, 0, 300); const s = seg(es, q);
  es.shields[s] = 1; Escort.hit(g, es, 0.3, { von: q });
  const v = es.shields[s];
  const k = (sek) => { for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) g.step(); };
  k(DELAY - 0.5); ok(es.shields[s] === v, `Verbündeter: ${DELAY - 0.5} s nach dem Treffer keine Regeneration (${v})`);
  k(TAKT + 1.5); ok(es.shields[s] > v, `Verbündeter: danach regeneriert er (${es.shields[s]})`);
  // Gegner im Spielablauf: space.updateEnemies ruft denselben Schild-Tick
  const e = gegner(g, 'korvette', 3000, 300); e.vx = e.vy = 0; e.shields[0] = 0;
  const qe = { x: e.x + 300, y: e.y };
  treffer(g, e, qe, 0.1, {});
  ok(bis(e, 0) > g.time && bis(e, 1) === 0, 'Gegner im Spielablauf: Pause nur auf dem getroffenen Segment');
});

section('tune: Pause und Takt einzeln einstellbar', () => {
  const g = raum();
  const tune = (pfad, wert) => { const r = Combat.tune(g, pfad, String(wert)); if (!r.ok) throw new Error('tune ' + pfad + ': ' + r.text); };
  const alt = [CONFIG.shields.regenDelay, CONFIG.enemyShieldRegen];
  try {
    tune('shields.regenDelay', 2);
    const e = gegner(g, 'korvette'); const q = quelle(e, Math.PI / 2, 300); const s = seg(e, q);
    const t0 = g.time; treffer(g, e, q, 1, {});
    ok(near(bis(e, s), t0 + 2), 'shields.regenDelay 2: Pause des Gegners 2 s (dieselbe Quelle wie die Lerche)');
    tune('enemyShieldRegen', 1);
    const v = e.shields[s]; tickSek(g, e, 2 + 0.5); ok(e.shields[s] === v, 'Takt 1 s: nach der Pause noch kein Punkt vor dem vollen Takt');
    tickSek(g, e, 1); ok(e.shields[s] === v + 1, 'Takt 1 s: Punkt 1 s nach Pausenende');
    tune('shields.regenDelay', 0);
    const e2 = gegner(g, 'korvette'); const s2 = seg(e2, q); treffer(g, e2, q, 1, {}); const v2 = e2.shields[s2];
    tickSek(g, e2, 1 + dt * 2); ok(e2.shields[s2] === v2 + 1, 'Pause 0: Regeneration sofort nach dem Takt (Altverhalten)');
  } finally { CONFIG.shields.regenDelay = alt[0]; CONFIG.enemyShieldRegen = alt[1]; }
});

section('Resets: kein dauerhaft gesperrtes Segment', () => {
  const g = raum(); const es = verbuendeter(g, 'kreuzer');
  const q = quelle(es, Math.PI / 2, 300); const s = seg(es, q);
  Escort.hit(g, es, 1, { von: q }); ok(bis(es, s) > g.time, 'Verbündeter: Pause gesetzt');
  Escort.heile(g, es);
  ok(Schilde.pause.darfRegenerieren(es, s, g.time) && es.shields.every((v, i) => v === es.shieldsMax[i]), 'Szenenneustart (heile): Schilde voll, Pause gelöscht');
  const e = gegner(g, 'korvette'); const q2 = quelle(e, 0, 300);
  treffer(g, e, q2, 0.3, {});
  const e2 = gegner(g, 'korvette');
  ok([0, 1, 2, 3].every((i) => bis(e2, i) === 0), 'neuer Gegner (Spawn, Welle, Arena): keine Pause');
  // Szenenwechsel: Gegnerliste wird ersetzt, die alten Körper samt Pause verschwinden
  space.enterScene(g, 'splitter', {});
  ok(g.space.enemies.every((x) => [0, 1, 2, 3].every((i) => bis(x, i) === 0)), 'Szenenwechsel: keine Gegner mit alter Pause');
  // Verrat: Ex-Verbündete kommen als neue Gegner (spawnEnemy) zurück, ohne Pause
  const neu = space.spawnEnemy(g, 'kreuzer', { x: 1000, y: 1000, tag: 'x_verrat' }) || g.space.enemies[g.space.enemies.length - 1];
  ok(Schilde.layout(CONFIG, 'kreuzer').max.every((m, i) => bis(neu, i) === 0 && neu.shields[i] === m), 'Verrat/Spawn: voller Schild, keine Pause');
  // Pause am Segment ohne Treffer läuft ab: alle Segmente regenerieren nach höchstens regenDelay + Takt wieder
  const h = gegner(g, 'kreuzer'); h.shields = h.shieldsMax.map((m) => Math.min(m, 1));
  for (let i = 0; i < h.shields.length; i++) treffer(g, h, quelle(h, (i / h.shields.length) * 2 * Math.PI - Math.PI, 300), 0.1, {});
  tickSek(g, h, DELAY + TAKT * 3 + 1);
  ok(h.shields.every((v, i) => v === h.shieldsMax[i]), 'nach der Pause laufen alle Segmente wieder voll (kein dauerhaft gesperrtes Segment)');
});

section('Mutationsprobe: ohne Stempel werden die Stempel-Tests rot', () => {
  const orig = [Schilde.pause.treffer, Schilde.pause.trefferSturm];
  Schilde.pause.treffer = () => {}; Schilde.pause.trefferSturm = () => {};
  try {
    for (const [name, fn] of Object.entries(STEMPEL)) { const r = fn(); ok(!r.ok, `Mutation (Stempel entfernt): "${name}" wird rot`); }
  } finally { [Schilde.pause.treffer, Schilde.pause.trefferSturm] = orig; }
});

console.log('\n' + (n - fails) + '/' + n + ' Prüfungen bestanden.');
process.exit(fails ? 1 : 0);
