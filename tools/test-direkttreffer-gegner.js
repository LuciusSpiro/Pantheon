'use strict';
// SYS-03 B2 „Direkttreffer auf Gegner und Verbündete“: Ein Treffer ohne Schildschutz schaltet ein Gegner-/Verbündeten-System genau EINE Stufe weiter
// (ok -> beschädigt -> zerstört), unabhängig von der Schadenszahl (Stufenregel, gleiche Regel wie die Lerche, test-direkttreffer.js).
// SYS-03 B-Nacharbeit: Sturm-Fenster, Dauerdruck-Zähler mit Verfall, Robustheit gegen reparatur.damaged, Verrat (Stufen 1:1), Antrieb gezielt = zwei Stufen, integPct, Torpedo reaktorStufen.
// Abgedeckt: alle Gegnerklassen (Jäger, Korvette, Fregatte, Kreuzer) und Verbündete, bei Crew 1 und 3 (die Crewgröße wirkt hier nur auf das Feuerintervall, nicht auf Stufen), je Quelle (Standard, gezielt, Sturm bei Schild 0 und niedrigem Schild,
// Streu-zwei, Mine, Lanze Teil-/Vollladung, Torpedo, Dauerdruck); Treffer-Fenster, Spiegeltest Lerche <-> Gegner <-> Verbündeter, Antrieb-Sperre als Ausnahme,
// Schild über 0 fängt ab, e.hp/integPct/snapshotZiel nach dem ersten Treffer, Reaktor-Countdown nur einmal, keine Reste der Punktregel.
//   node tools/test-direkttreffer-gegner.js
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');   // SYS-03 C1: Regenerationspause je Sektor
const Katalog = require('../shared/schiffskatalog.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gegnertod = require('../server/sim/gegnertod.js');
const Integ = require('../server/sim/integritaet.js');
const Alarm = require('../server/sim/alarm.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const I = require('../server/sim/interior.js');
const Th = require('./gegner-testhilfe.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); } }
const SM = CONFIG.systemModell;
const FENSTER = SM.trefferFenster_s;
const FENSTER_STURM = SM.sturm.trefferFenster_s;
const STURM = Katalog.waffe('sturmbatterie').sturm;
const KLASSEN = ['raider', 'korvette', 'fregatte', 'kreuzer'];
const RANG = { ok: 0, damaged: 1, broken: 2 };

// ---------------------------------------------------------------- Aufbau
let seq = 0;
function raum(crew) {
  const g = new Game({ noStore: true, seed: 90 + (++seq), debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  for (let i = 0; i < crew; i++) {
    const c = { inbox: [], send() {}, sendRaw() {} };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'D' + i, name: 'D' + i, color: i });
  }
  g.reset(); g.phase = 'play';
  space.enterScene(g, 'splitter', {});
  g.space.enemies = []; g.space.projectiles = []; g.space.asteroids = [];
  g.ship.x = 1500; g.ship.y = 1200; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.god = true;
  return g;
}
// Ein Ziel (Gegner oder Verbündeter), ruhig bei (1500, 500), Bug zeigt nach +x; Quelle 300 px davor.
function gegner(g, kind) { const e = space.spawnEnemy(g, kind, { x: 1500, y: 500, facing: 0 }); e.hp = e.hp; return e; }
function verbuendeter(g, kind) {
  const es = Flotte.aufstellen(g, { tag: 'v_' + kind + (++seq), kind });
  es.skript = { modus: 'halten' }; es.gestellt = true; es.x = 1500; es.y = 500; es.angle = 0; es.vx = 0; es.vy = 0;
  return es;
}
// Alles auf Anfang: Systeme ok mit Maximum, Fenster/Sperre/Immunität/Zähler weg, Schilde 0
function frisch(g, e) {
  for (const id of Gsys.ids(e)) { const st = e.sys[id]; st.i = Gsys.maxOf(e, id); st.z = 'ok'; delete st.sp; delete st.imm; delete st.tf; delete st.rp; }
  e.hp = Gsys.summe(e); e.rt = null; delete e.druckZ; e.repSperre = null; e.sysTreffer = 0; e.regenHold = 0;
  Th.schildNull(e);
  e.shieldsMax = e.shieldsMax.map(() => 0);
  return e;
}
// Zone leer bis auf ein System (das erste lebende der Zone bleibt); Rückgabe: dessen Id
function einziges(e, zone, wahl) {
  const ks = Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone === zone);
  const bleib = wahl || ks[0];
  for (const id of ks) if (id !== bleib) { e.sys[id].i = 0; e.sys[id].z = 'broken'; }
  e.hp = Gsys.summe(e);
  return bleib;
}
const stand = (e) => Object.fromEntries(Gsys.ids(e).map((id) => [id, e.sys[id].z]));
const geaendert = (e, vor) => Gsys.ids(e).filter((id) => e.sys[id].z !== vor[id]);
const weiter = (g, s) => { g.time += (s == null ? FENSTER + 0.01 : s === 'sturm' ? FENSTER_STURM + 0.01 : s); };   // 'sturm': das längere Sturm-Fenster abwarten
const quelleBug = (e) => ({ x: e.x + 300, y: e.y });
const pctIn = (e, id) => { const z = Gsys.snapshotZiel(e); return z[2 * Gsys.ids(e).indexOf(id) + 1]; };
const zustandIn = (e, id) => { const z = Gsys.snapshotZiel(e); return z[2 * Gsys.ids(e).indexOf(id)]; };

// Quellen: treffer(g, ziel, schaden) – Seite = Bug. Gegner (Lerche-Waffen und Gegner-Quellen) und Verbündete nehmen denselben Eintritt (space.damageEnemy / escort.hit).
const STERNE = (g, e) => (e.ally ? { hit: (d, o) => Escort.hit(g, e, d, Object.assign({ von: quelleBug(e) }, o || {})) } : { hit: (d, o) => { const q = quelleBug(e); space.damageEnemy(g, e, d, q.x, q.y, o || {}); } });
const QUELLEN = {
  'Standard-Schuss': { dmgs: [0.1, 50], seiten: ['gegner', 'verbuendet'], treffer: (g, e, d) => STERNE(g, e).hit(d, {}) },
  'Sturm bei Schild 0': { dmgs: [0.1, 50], art: 'sturm', seiten: ['gegner', 'verbuendet'], treffer: (g, e, d) => STERNE(g, e).hit(d, { sturm: STURM }) },
  'Streu-zwei (Durchschlag)': { dmgs: [0.1, 50], seiten: ['gegner'], treffer: (g, e, d) => STERNE(g, e).hit(d, { huelle: true }) },
  'Lanze Teilladung': { dmgs: [3, 7.5], seiten: ['gegner'], treffer: (g, e, d) => STERNE(g, e).hit(d, { pierce: 2, angriff: true }) },
  'Mine': {
    dmgs: [null], seiten: ['gegner', 'verbuendet'], treffer: (g, e) => {
      const m = { id: 9100 + (++seq), x: e.x + 40, y: e.y, besitzer: 'gegner' };
      g.space.minen = [m];
      if (e.ally) Flotte.mineSchaden(g, m, 160); else Alarm.explodiere(g, m, 'test');
    },
  },
};

function aufZiele(crew, fn) {
  const g = raum(crew);
  for (const kind of KLASSEN) {
    for (const seite of ['gegner', 'verbuendet']) {
      const e = seite === 'gegner' ? gegner(g, kind) : verbuendeter(g, kind);
      try { fn(g, e, kind, seite); } finally { if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((q) => q !== e); }
    }
  }
}

// ---------------------------------------------------------------- Quellen: je zwei Treffer, eine Stufe je Treffer, bei Crew 1 und 3
for (const crew of [1, 3]) {
  for (const [name, q] of Object.entries(QUELLEN)) {
    section(`Crew ${crew}, Quelle ${name}: ok -> beschädigt -> zerstört, unabhängig vom Schaden`, () => {
      aufZiele(crew, (g, e, kind, seite) => {
        if (!q.seiten.includes(seite)) return;
        for (const d of q.dmgs) {
          frisch(g, e); const s = einziges(e, 'bug'); const vor = stand(e); const hp0 = e.hp; const pct0 = Gsys.integPct(e);
          q.treffer(g, e, d);
          const tag = `${seite} ${kind}, Schaden ${d}`;
          ok(e.sys[s].z === 'damaged' && geaendert(e, vor).join() === s, `${tag}: erster Treffer ok -> beschädigt (${s}), sonst nichts`);
          ok(e.hp < hp0 && Gsys.integPct(e) < pct0 && Math.abs(e.hp - Gsys.summe(e)) < 1e-9, `${tag}: e.hp ${hp0.toFixed(1)} -> ${e.hp.toFixed(1)} (= Σ i), integPct ${pct0.toFixed(0)} -> ${Gsys.integPct(e).toFixed(1)}`);
          ok(Math.abs(e.sys[s].i - Gsys.maxOf(e, s) * SM.reparatur.damaged) < 1e-9, `${tag}: i = abgeleiteter Wert der Stufe (${SM.reparatur.damaged} × Maximum)`);
          ok(zustandIn(e, s) === 1 && pctIn(e, s) === Math.round(100 * SM.reparatur.damaged), `${tag}: snapshotZiel [1, ${pctIn(e, s)}] sofort sichtbar`);
          weiter(g, q.art); q.treffer(g, e, d);
          ok(e.sys[s].z === 'broken' && e.sys[s].i === 0 && zustandIn(e, s) === 2 && pctIn(e, s) === 0, `${tag}: zweiter Treffer beschädigt -> zerstört, Snapshot [2, 0]`);
          weiter(g, q.art); const v2 = stand(e); q.treffer(g, e, d);
          ok(geaendert(e, v2).every((id) => Gsys.defOf(e.kind, id).zone === 'mitte'), `${tag}: dritter Treffer: Zone leer, geht in die Mitte (nie zurück auf das zerstörte System)`);
          if (e.rt) e.rt = null;
        }
      });
    });
  }
}

// ---------------------------------------------------------------- Treffer-Fenster
section('Treffer-Fenster: keine Doppelstufe im selben Tick, ein anderes System der Zone, sonst verfällt der Treffer', () => {
  const g = raum(1);
  for (const kind of KLASSEN) for (const seite of ['gegner', 'verbuendet']) {
    const e = frisch(g, seite === 'gegner' ? gegner(g, kind) : verbuendeter(g, kind));
    const zs = Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone === 'bug');
    const q = (d) => STERNE(g, e).hit(d, {});
    if (zs.length >= 2) {
      q(3); q(3);
      ok(zs.every((id) => e.sys[id].z === 'damaged' || zs.length > 2), `${seite} ${kind}: zwei Treffer im selben Tick treffen zwei verschiedene Systeme (${zs.map((id) => e.sys[id].z).join()}), keins zerstört`);
      ok(zs.every((id) => e.sys[id].z !== 'broken'), `${seite} ${kind}: kein System der Zone zerstört`);
    }
    frisch(g, e); const s = einziges(e, 'bug');
    q(3); q(3); q(3);
    ok(e.sys[s].z === 'damaged', `${seite} ${kind}: einziges System, drei Treffer im selben Tick: nur eine Stufe`);
    ok(Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone === 'mitte').every((id) => e.sys[id].z === 'ok'), `${seite} ${kind}: kein Überlauf in die Mitte allein wegen des Fensters`);
    weiter(g, FENSTER * 0.5); q(3);
    ok(e.sys[s].z === 'damaged', `${seite} ${kind}: Treffer nach ${(FENSTER * 0.5).toFixed(3)} s (im Fenster): verfällt`);
    weiter(g, FENSTER * 0.6); q(3);
    ok(e.sys[s].z === 'broken', `${seite} ${kind}: Treffer nach dem Fenster: zerstört`);
    if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
  const f0 = SM.trefferFenster_s;
  try {
    SM.trefferFenster_s = 0;
    const e = frisch(g, gegner(g, 'fregatte')); const s = einziges(e, 'bug'); const q = (d) => STERNE(g, e).hit(d, {});
    q(3); q(3);
    ok(e.sys[s].z === 'broken', 'Fenster 0 (tune systemModell.trefferFenster_s 0): zwei Treffer im selben Tick zerstören');
    g.space.enemies = g.space.enemies.filter((x) => x !== e);
  } finally { SM.trefferFenster_s = f0; }
  ok(Integ.fensterDauer({ C: CONFIG }) === FENSTER, 'eine Quelle: Gegner und Lerche lesen systemModell.trefferFenster_s (integritaet.js)');
});

// ---------------------------------------------------------------- Gezielter Treffer
section('Gezielter Treffer (Ziel-Scan der Ops): sicher auf das Systemziel, eine Stufe, mit Fenster', () => {
  const g = raum(2);
  for (const kind of ['korvette', 'fregatte', 'kreuzer']) {
    const e = frisch(g, gegner(g, kind));
    const zs = Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone === 'bug');
    const ziel = zs[zs.length - 1];
    g.ship.target = e.id; g.ship.zielsystem = ziel; e.scanned = true;
    g.ship.x = e.x + 300; g.ship.y = e.y;   // die Lerche steht vor dem Bug: die Bug-Zone ist die zugewandte Seite (erreichbar)
    const q = (d) => { const p = quelleBug(e); space.damageEnemy(g, e, d, p.x, p.y, { angriff: true }); };
    q(0.1);
    ok(e.sys[ziel].z === 'damaged' && zs.filter((id) => e.sys[id].z !== 'ok').join() === ziel, `${kind}: gezielter Treffer (Schaden 0,1) macht das Ziel ${ziel} beschädigt, sonst nichts`);
    q(50);
    ok(e.sys[ziel].z === 'damaged' && zs.filter((id) => e.sys[id].z === 'damaged').length === 2 || zs.length === 1, `${kind}: zweiter gezielter Treffer im Fenster trifft ein anderes System der Zone (Ziel steht im Fenster)`);
    weiter(g); q(50);
    ok(e.sys[ziel].z === 'broken', `${kind}: nach dem Fenster zerstört das nächste Ziel-Treffer das Ziel (zwei Stufen)`);
    g.space.enemies = g.space.enemies.filter((x) => x !== e);
    delete g.ship.zielsystem; g.ship.target = null;
  }
});

section('Antrieb: Sperre bleibt als Ausnahme (zweiter Treffer in der Sperre wird vorgemerkt und erst danach eine Stufe nachgeholt)', () => {
  const ZW = require('../content/kampf/zielsysteme-werte.json').werte;
  const SPERRE = ZW.treffer.wert.sperre_s;
  const g = raum(2);
  const e = frisch(g, gegner(g, 'fregatte'));
  const zone = Gsys.defOf(e.kind, 'antrieb').zone;
  const treffer = () => Gsys.treffen(g, e, zone, { id: 'antrieb', zugewandt: zone });
  const t0 = g.time;
  const r1 = treffer();
  ok(r1 && r1.id === 'antrieb' && r1.state === 'damaged', 'erster Treffer: Antrieb beschädigt');
  weiter(g, FENSTER + 0.05); const r2 = treffer();
  ok(e.sys.antrieb.z === 'damaged' && r2 && r2.state === 'damaged' && e.sys.antrieb.i === 0, 'zweiter Treffer außerhalb des Fensters, aber innerhalb der Sperre: Zustand bleibt beschädigt, die Stufe ist vorgemerkt (i = 0)');
  g.time = t0 + SPERRE - 0.05; Gsys.nachholen(g, e);
  ok(e.sys.antrieb.z === 'damaged', 'vor Ablauf der Sperre: noch beschädigt');
  g.time = t0 + SPERRE + 0.2; Gsys.nachholen(g, e);
  ok(e.sys.antrieb.z === 'broken', `nach der Sperre (${SPERRE} s): zerstört (nachgeholt)`);
  // Immunität nach Reparatur: ein Treffer ändert den Zustand nicht, die Stufen holen einzeln nach
  const e2 = frisch(g, gegner(g, 'kreuzer')); const z2 = Gsys.defOf(e2.kind, 'antrieb').zone;
  Gsys.reparaturFertig(g, e2, 'antrieb');
  const tz = () => Gsys.treffen(g, e2, z2, { id: 'antrieb', zugewandt: z2 });
  tz(); weiter(g); tz();
  ok(e2.sys.antrieb.z === 'ok' && e2.sys.antrieb.i === 0, 'Immunität: zwei Treffer, Zustand bleibt ok, die Stufen sind vorgemerkt');
  g.time += ZW.treffer.wert.immunitaet_s + 0.1; Gsys.nachholen(g, e2);
  ok(e2.sys.antrieb.z === 'damaged', 'nach der Immunität: ein Wechsel = EINE Stufe (beschädigt), nicht gleich zerstört');
  g.time += SPERRE + 0.1; Gsys.nachholen(g, e2);
  ok(e2.sys.antrieb.z === 'broken', 'nach der folgenden Sperre: zerstört');
  // Torpedo (zerstoeren) ignoriert die Sperre
  const e3 = frisch(g, gegner(g, 'fregatte')); const z3 = Gsys.defOf(e3.kind, 'antrieb').zone;
  Gsys.treffen(g, e3, z3, { id: 'antrieb', zugewandt: z3 });
  Gsys.treffen(g, e3, z3, { id: 'antrieb', zugewandt: z3 }, { zerstoeren: true });
  ok(e3.sys.antrieb.z === 'broken', 'Torpedo/Vollladung zerstören den Antrieb sicher, auch in der Sperre');
});

// ---------------------------------------------------------------- Schild
section('Schild über 0 fängt ab: kein Systemschaden, nur der Schild sinkt', () => {
  const g = raum(1);
  for (const kind of KLASSEN) for (const seite of ['gegner', 'verbuendet']) {
    const e = frisch(g, seite === 'gegner' ? gegner(g, kind) : verbuendeter(g, kind));
    const lay = require('../shared/schilde.js').layout(CONFIG, kind);
    e.shields = lay.max.slice(); e.shieldsMax = lay.max.slice();
    const vor = stand(e); const sum0 = e.shields.reduce((a, b) => a + b, 0);
    for (const d of [0.4, 50]) { e.shields = lay.max.slice(); STERNE(g, e).hit(d, {}); }
    ok(geaendert(e, vor).length === 0 && e.hp === Gsys.summe(e), `${seite} ${kind}: Schild fängt ab (Schaden 0,4 und 50), kein System geändert`);
    e.shields = lay.max.slice(); const sec = e.shields.findIndex((v) => v > 0);
    STERNE(g, e).hit(0.4, {});
    ok(e.shields.reduce((a, b) => a + b, 0) < sum0 || sec < 0, `${seite} ${kind}: Schild gesunken`);
    if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
});

section('Sturm: Schild 0 = Direkttreffer, 0 < Schild ≤ niedrig mit Chance eine Stufe, voller Schild nichts; Reparatursperre bleibt', () => {
  const g = raum(1);
  for (const seite of ['gegner', 'verbuendet']) {
    const e = frisch(g, seite === 'gegner' ? gegner(g, 'fregatte') : verbuendeter(g, 'fregatte'));
    const s = einziges(e, 'bug');
    const seg = require('../shared/schilde.js');
    const lay = seg.layout(CONFIG, e.kind);
    const hit = (d) => STERNE(g, e).hit(d, { sturm: STURM });
    const segBug = lay.segs.findIndex((x) => x.seite === 0);
    const setzeBug = (v) => { e.shields = e.shields.map((x, i) => (lay.segs[i].seite === 0 ? v : 0)); e.shieldsMax = e.shields.map((x, i) => (lay.segs[i].seite === 0 ? Math.max(v, 1) : 0)); };
    setzeBug(5); hit(3);
    ok(e.sys[s].z === 'ok', `${seite}: Sturm gegen Schild 5 (> niedrig): kein Systemschaden`);
    const chance0 = g.rng.chance; setzeBug(1);
    g.rng.chance = () => false; hit(3); const ohne = e.sys[s].z;
    g.rng.chance = () => true; setzeBug(1); hit(3); const mit = e.sys[s].z;
    g.rng.chance = chance0;
    ok(ohne === 'ok' && mit === 'damaged', `${seite}: Sturm bei Schild 1 (≤ niedrig): ohne Chance nichts, mit Chance (${STURM.systemChance}) genau eine Stufe`);
    weiter(g, 'sturm'); setzeBug(0); hit(0.1);
    ok(e.sys[s].z === 'broken', `${seite}: Sturm bei Schild 0: Direkttreffer, eine Stufe (beschädigt -> zerstört)`);
    ok(segBug >= 0, `${seite}: Layout hat ein Bug-Segment`);
    if (seite === 'gegner') {
      ok(e.repSperre && e.repSperre.bug > g.time, `${seite}: Reparatursperre der Zone gesetzt (bis ${e.repSperre && e.repSperre.bug})`);
      g.space.enemies = g.space.enemies.filter((x) => x !== e);
    }
  }
});

// ---------------------------------------------------------------- Lanze
section('Lanze: Vollladung zerstört das getroffene System (Mitte), Teilladung eine Stufe; Teilladung schwächt den Schild um 2', () => {
  const c = Waffen.wcfg(raum(1), Katalog.waffe('lanze'));
  ok(c.vollAb === CONFIG.spaceM3.lance.vollAb && c.vollAb > 0, `Schwelle der Vollladung aus der Config (spaceM3.lance.vollAb = ${c.vollAb})`);
  const g = raum(1);
  for (const kind of KLASSEN) {
    const e = frisch(g, gegner(g, kind));
    const p = quelleBug(e);
    const mitte = Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone === 'mitte');
    space.damageEnemy(g, e, 12, p.x, p.y, { pierce: c.pierce, durchschlag: 'zone', vollladung: true, angriff: true });
    const zerst = mitte.filter((id) => e.sys[id].z === 'broken');
    ok(zerst.length === 1 && Gsys.ids(e).filter((id) => e.sys[id].z !== 'ok').length >= 1 && Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone !== 'mitte').every((id) => e.sys[id].z === 'ok'),
      `${kind}: Vollladung: genau ein System der Mitte zerstört (${zerst.join()}), nichts anderes`);
    if (e.rt) e.rt = null;
    frisch(g, e);
    space.damageEnemy(g, e, 12, p.x, p.y, { pierce: c.pierce, durchschlag: 'zone', vollladung: true, angriff: true });
    weiter(g, 0); space.damageEnemy(g, e, 12, p.x, p.y, { pierce: c.pierce, durchschlag: 'zone', vollladung: true, angriff: true });
    ok(mitte.filter((id) => e.sys[id].z === 'broken').length === 2 || mitte.length < 2, `${kind}: zwei Vollladungen im selben Tick zerstören zwei Systeme (das Fenster gilt nicht gegen das Zerstören)`);
    if (e.rt) e.rt = null;
    frisch(g, e); const s = einziges(e, 'bug');
    space.damageEnemy(g, e, 7.5, p.x, p.y, { pierce: c.pierce, angriff: true });
    ok(e.sys[s].z === 'damaged', `${kind}: Teilladung (7,5): eine Stufe`);
    // Schild 4 (> pierce 2): Teilladung senkt den Schild um 2, kein Systemschaden
    frisch(g, e); const lay = require('../shared/schilde.js').layout(CONFIG, kind);
    e.shields = lay.max.map((m, i) => (lay.segs[i].seite === 0 ? 4 : 0)); e.shieldsMax = e.shields.slice();
    const vor = stand(e);
    space.damageEnemy(g, e, 3, p.x, p.y, { pierce: c.pierce, angriff: true });
    const bugSeg = lay.segs.map((x, i) => (x.seite === 0 ? i : -1)).filter((i) => i >= 0);
    ok(geaendert(e, vor).length === 0 && bugSeg.some((i) => e.shields[i] < 4), `${kind}: Teilladung 3 gegen Schild 4: Schild geschwächt (${e.shields.filter((v) => v > 0 && v < 4).join()}), kein Systemschaden`);
    g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
  // End-zu-Ende über die Waffe: fireLance mit Ladung 1 und 0,5 (Gegner ohne Schild vor der Lerche)
  const g2 = raum(1);
  g2.ship.x = 1500; g2.ship.y = 1200; g2.ship.angle = -Math.PI / 2;
  const ge = space.spawnEnemy(g2, 'fregatte', { x: 1500, y: 950, facing: Math.PI / 2 });
  frisch(g2, ge);
  try {
    Waffen.ensureMounts(g2);
    const vor = stand(ge);
    Waffen.fireLance(g2, 'bow', 1, false);
    const nach = geaendert(ge, vor);
    ok(nach.length === 1 && ge.sys[nach[0]].z === 'broken' && Gsys.defOf(ge.kind, nach[0]).zone === 'mitte', `fireLance Ladung 1: Vollladung zerstört ein System der Mitte (${nach.join()})`);
    if (ge.rt) ge.rt = null;
    frisch(g2, ge); const v2 = stand(ge);
    Waffen.fireLance(g2, 'bow', 0.5, false);
    const n2 = geaendert(ge, v2);
    ok(n2.length === 1 && ge.sys[n2[0]].z === 'damaged', `fireLance Ladung 0,5: Teilladung eine Stufe (${n2.join()})`);
  } catch (err) { fails++; console.log('  FEHLER fireLance: ' + (err && err.stack)); }
});

// ---------------------------------------------------------------- Streu-zwei über die Waffe
section('Streubatterie der Lerche: erste Granate nur Schild, zweite im Fenster = Durchschlag, eine Stufe', () => {
  const g = raum(1);
  const e = frisch(g, gegner(g, 'korvette'));
  const T = Katalog.waffe('streubatterie').streu;
  const p = { x: e.x + 20, y: e.y, dmg: 3, mount: 'port', owner: 'lerche' };
  const vor = stand(e);
  Waffen.streuExplosion(g, p);
  ok(geaendert(e, vor).length === 0, 'erste Granate: kein Systemschaden');
  g.time += T.fenster * 0.3; Waffen.streuExplosion(g, p);
  const ch = geaendert(e, vor);
  ok(ch.length === 1 && e.sys[ch[0]].z === 'damaged', `zweite Granate im Fenster: genau ein System eine Stufe (${ch.join()})`);
});

// ---------------------------------------------------------------- Torpedo
section('Torpedo: zerstört das getroffene System sicher, Durchschlag auf den Reaktor = reaktorStufen (1: eine Stufe), Jäger sofort tot', () => {
  const g = raum(1);
  ok(SM.torpedo.reaktorStufen === 1 && SM.torpedo.reaktorAnteil === undefined && Integ.torpedoStufen(g) === 1 && !('stufenAusAnteil' in Integ), 'systemModell.torpedo.reaktorStufen 1 (Ganzzahl, integritaet.js torpedoStufen, auch die Lerche); reaktorAnteil/stufenAusAnteil entfallen');
  {   // reaktorStufen 0 / 2: wirkt wirklich (Tune-Wert), Gegner und Verbündete
    const r0 = SM.torpedo.reaktorStufen;
    try {
      for (const [st, soll] of [[0, 'ok'], [1, 'damaged'], [2, 'broken']]) {
        SM.torpedo.reaktorStufen = st;
        for (const seite of ['gegner', 'verbuendet']) {
          const e = frisch(g, seite === 'gegner' ? gegner(g, 'kreuzer') : verbuendeter(g, 'kreuzer'));
          STERNE(g, e).hit(9, { torpedo: true, huelle: true, nurOhneSchild: true });
          ok(e.sys[Gsys.idVon(e, 'reaktor')].z === soll, `reaktorStufen ${st} ${seite}: ein Torpedo -> Reaktor ${soll}`);
          if (e.rt) e.rt = null;
          if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== e);
        }
      }
    } finally { SM.torpedo.reaktorStufen = r0; }
  }
  for (const kind of ['korvette', 'fregatte', 'kreuzer']) for (const seite of ['gegner', 'verbuendet']) {
    const e = frisch(g, seite === 'gegner' ? gegner(g, kind) : verbuendeter(g, kind));
    const vor = stand(e);
    STERNE(g, e).hit(9, { torpedo: true, huelle: true, nurOhneSchild: true });
    const ch = geaendert(e, vor);
    const bug = ch.filter((id) => Gsys.defOf(e.kind, id).zone === 'bug');
    const reaktor = Gsys.idVon(e, 'reaktor');
    ok(bug.length === 1 && e.sys[bug[0]].z === 'broken', `${seite} ${kind}: Torpedo zerstört ein System der Zone (${bug.join()})`);
    ok(e.sys[reaktor].z === 'damaged', `${seite} ${kind}: Reaktor eine Stufe (beschädigt), nicht zerstört`);
    weiter(g, 0);
    STERNE(g, e).hit(9, { torpedo: true, huelle: true, nurOhneSchild: true });
    ok(e.sys[reaktor].z === 'broken', `${seite} ${kind}: zweiter Torpedo zerstört den Reaktor (auch im selben Tick: kein Fenster)`);
    if (seite === 'gegner') ok(e.rt && e.rt.n === 1 && e.rt.rest > 0, `${kind}: Countdown genau einmal gestartet (n = ${e.rt && e.rt.n})`);
    if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
  // Jäger: Sofort-Tod bleibt
  const j = frisch(g, gegner(g, 'raider'));
  const q = quelleBug(j);
  space.damageEnemy(g, j, 45, q.x, q.y, { torpedo: true, huelle: true, nurOhneSchild: true });
  ok(!g.space.enemies.includes(j) && j.hp === 0, 'Jäger: Torpedo bei Schild 0 tötet sofort (torpedoSofortTod)');
});

// ---------------------------------------------------------------- Dauerdruck der Zonen
section('Dauerdruck auf Gegner/Verbündete: eine Stufe je zonen.druckPunkte (wie die Lerche)', () => {
  const g = raum(1); const K = CONFIG.zonen.druckPunkte;
  for (const seite of ['gegner', 'verbuendet']) {
    const e = frisch(g, seite === 'gegner' ? gegner(g, 'kreuzer') : verbuendeter(g, 'kreuzer'));
    const s = einziges(e, 'bug'); const vor = stand(e);
    const druck = (pts) => STERNE(g, e).hit(pts, { druck: true });
    druck(K - 1);
    ok(geaendert(e, vor).length === 0, `${seite}: ${K - 1} Punkte unter der Schwelle: keine Stufe`);
    druck(1);
    ok(e.sys[s].z === 'damaged', `${seite}: Schwelle ${K} erreicht: eine Stufe`);
    weiter(g); druck(500);
    ok(e.sys[s].z === 'broken' && Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone === 'mitte').every((id) => e.sys[id].z === 'ok'), `${seite}: viele Punkte auf einmal = höchstens eine Stufe je Aufruf (kein Durchschlag in die Mitte)`);
    if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
  ok(CONFIG.zonen.druckPunkte === K && K > 0, 'dieselbe Schwelle zonen.druckPunkte wie die Lerche (eine Quelle)');
});

// ---------------------------------------------------------------- Sturm-Fenster (SYS-03 B-Nacharbeit)
section('Sturm-Fenster: 8 Nadeln in 0,5 s auf eine Zone mit 2 Systemen (Schild 0) = je System eine Stufe, nichts in der Mitte; nach dem Fenster eine weitere', () => {
  const g = raum(1);
  for (const kind of ['korvette', 'kreuzer']) for (const seite of ['gegner', 'verbuendet']) {
    const e = frisch(g, seite === 'gegner' ? gegner(g, kind) : verbuendeter(g, kind));
    const zs = Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone === 'bug');
    for (const id of zs.slice(2)) { e.sys[id].i = 0; e.sys[id].z = 'broken'; }
    e.hp = Gsys.summe(e);
    const zwei = zs.slice(0, 2); const mitte = Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone === 'mitte');
    const stufen = () => zwei.reduce((a, id) => a + RANG[e.sys[id].z], 0);
    const nadel = () => STERNE(g, e).hit(0.5, { sturm: STURM });
    for (let i = 0; i < 8; i++) { nadel(); g.time += 0.5 / 8; }
    ok(zwei.every((id) => e.sys[id].z === 'damaged'), `${seite} ${kind}: 8 Nadeln in 0,5 s: je System eine Stufe (${zwei.map((id) => e.sys[id].z).join()}), keins zerstört`);
    ok(mitte.every((id) => e.sys[id].z === 'ok'), `${seite} ${kind}: nichts in der Mitte (Treffer im Fenster verfallen, kein Überlauf)`);
    g.time += 0.4; nadel();
    ok(stufen() === 2, `${seite} ${kind}: Nadel 0,9 s nach der ersten Stufe (Sturm-Fenster ${SM.sturm.trefferFenster_s} s): keine weitere Stufe`);
    STERNE(g, e).hit(3, {}); ok(stufen() === 2, `${seite} ${kind}: auch ein Standard-Treffer im Sturm-Fenster verfällt`);
    g.time += SM.sturm.trefferFenster_s; nadel();
    ok(stufen() === 3 && mitte.every((id) => e.sys[id].z === 'ok'), `${seite} ${kind}: nach Ablauf des Fensters eine weitere Stufe (${zwei.map((id) => e.sys[id].z).join()})`);
    if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
  ok(Integ.fensterDauer({ C: CONFIG }, 'sturm') === SM.sturm.trefferFenster_s && SM.sturm.trefferFenster_s > FENSTER, 'ein Wert: systemModell.sturm.trefferFenster_s, gelesen von Integ.fensterDauer (Lerche und Gegner gleich)');
  // Sturm gegen vollen Schild: kein Systemschaden (unverändert)
  const e2 = frisch(g, gegner(g, 'korvette')); const lay = require('../shared/schilde.js').layout(CONFIG, e2.kind);
  const hoch = lay.max.map(() => 5);   // über sturm.niedrig: der Sturm nutzt den Schild kaum ab und trifft keine Systeme
  e2.shields = hoch.slice(); e2.shieldsMax = hoch.slice(); const v2 = stand(e2);
  for (let i = 0; i < 20; i++) { e2.shields = hoch.slice(); STERNE(g, e2).hit(0.5, { sturm: STURM }); g.time += 0.1; }
  ok(geaendert(e2, v2).length === 0, 'Sturm gegen vollen Schild: kein Systemschaden');
  g.space.enemies = g.space.enemies.filter((x) => x !== e2);
});

// ---------------------------------------------------------------- Dauerdruck-Zähler
section('Dauerdruck-Zähler (Gegner, Verbündete): bleibt innerhalb der Frist, verfällt danach, auch bei Schild > 0 ohne Resttreffer', () => {
  const g = raum(1); const K = CONFIG.zonen.druckPunkte; const A = CONFIG.zonen.druckAbkling_s;
  for (const seite of ['gegner', 'verbuendet']) {
    const neu = () => { const e = frisch(g, seite === 'gegner' ? gegner(g, 'kreuzer') : verbuendeter(g, 'kreuzer')); const s = einziges(e, 'bug'); return { e, s, druck: (p) => STERNE(g, e).hit(p, { druck: true }), n: () => Integ.druckStand(g, Integ.druckZaehler(e, 'druckZ')) }; };
    let z = neu();
    z.druck(K - 2); ok(z.n() === K - 2, `${seite}: ${K - 2} Punkte im Zähler (${z.n()})`);
    g.time += A - 0.5; ok(z.n() === K - 2, `${seite}: nach ${A - 0.5} s ohne Druck (innerhalb der Frist ${A} s) unverändert`);
    z.druck(2); ok(z.e.sys[z.s].z === 'damaged', `${seite}: der Rest kommt dazu: die Stufe fällt (der Zähler blieb)`);
    if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== z.e);
    z = neu();
    z.druck(K - 2); g.time += A + 0.5;
    ok(z.n() === 0, `${seite}: nach ${A + 0.5} s ohne Druck (Frist ${A} s): Zähler 0`);
    z.druck(2); ok(z.e.sys[z.s].z === 'ok', `${seite}: dieselben 2 Punkte danach kosten keine Stufe`);
    z.druck(K - 2); ok(z.e.sys[z.s].z === 'damaged', `${seite}: erst ein voller Zähler (${K} Punkte) kostet eine Stufe`);
    if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== z.e);
    // Schild > 0 ohne Resttreffer: der Schild fängt den Druck, kein Rest erreicht ein System -> auch dann läuft die Frist ab
    z = neu(); const lay = require('../shared/schilde.js').layout(CONFIG, z.e.kind);
    z.druck(K - 2);
    for (let i = 0; i < A + 2; i++) { z.e.shields = lay.max.slice(); z.e.shieldsMax = lay.max.slice(); z.druck(1); g.time += 1; }
    z.e.shields = z.e.shields.map(() => 0);
    ok(z.n() === 0 && z.e.sys[z.s].z === 'ok', `${seite}: Schild fängt den Druck ${A + 2} s lang (kein Resttreffer): Zähler verfällt (${z.n()}), keine Stufe`);
    z.druck(2); ok(z.e.sys[z.s].z === 'ok', `${seite}: danach 2 Punkte ohne Stufe (Zähler war verfallen)`);
    if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== z.e);
  }
  ok(K === 6 && A === 3 && typeof Integ.druckSammeln === 'function', 'Startwerte zonen.druckPunkte 6 / druckAbkling_s 3; derselbe Helfer wie die Lerche (integritaet.js)');
});

// ---------------------------------------------------------------- Robustheit gegen systemModell.reparatur.damaged
section('Robustheit: tune systemModell.reparatur.damaged 0,6 / 0,7 / 0,9 – fünf Treffer auf ein System: ok -> beschädigt -> zerstört (kein hängendes System)', () => {
  const g = raum(1); const d0 = SM.reparatur.damaged;
  try {
    for (const dm of [0.6, 0.7, 0.9]) {
      SM.reparatur.damaged = dm;
      for (const seite of ['gegner', 'verbuendet']) for (const kind of ['fregatte', 'kreuzer']) {
        const e = frisch(g, seite === 'gegner' ? gegner(g, kind) : verbuendeter(g, kind)); const s = einziges(e, 'bug'); const folge = [];
        for (let i = 0; i < 5; i++) { weiter(g); STERNE(g, e).hit(1, {}); folge.push(e.sys[s].z); if (i === 0) ok(Math.abs(e.sys[s].i - Gsys.maxOf(e, s) * dm) < 1e-9 && pctIn(e, s) === Math.round(100 * dm), `damaged ${dm} ${seite} ${kind}: beschädigt = ${Math.round(100 * dm)} % (i = ${dm} × Maximum)`); }
        ok(folge.slice(0, 2).join() === 'damaged,broken' && folge.slice(2).every((x) => x === 'broken'), `damaged ${dm} ${seite} ${kind}: Folge ${folge.join(' > ')}`);
        if (e.rt) e.rt = null;
        if (seite === 'gegner') g.space.enemies = g.space.enemies.filter((x) => x !== e);
      }
    }
    // die Stufe liest sich aus i robust: zerstört nur bei i <= 0, ok nur ab Maximum
    SM.reparatur.damaged = 0.7;
    const e = frisch(g, gegner(g, 'fregatte')); const id = Gsys.ids(e).find((x) => Gsys.defOf(e.kind, x).zone === 'bug');
    const max = Gsys.maxOf(e, id);
    e.sys[id].i = 0.8 * max;
    const r = Gsys.treffen(g, e, 'bug', { id, zugewandt: 'bug' });
    ok(r && r.id === id && e.sys[id].z === 'broken', 'i = 80 % des Maximums (Zustand ok durch einen Stand von Hand): wird als beschädigt gelesen, der Treffer zerstört (nicht hängen)');
  } finally { SM.reparatur.damaged = d0; }
});

// ---------------------------------------------------------------- Verrat: Stufen 1:1
section('Verrat (Gsys.stufenUebernehmen): der Ex-Verbündete wird Gegner mit denselben Stufen, Integrität abgeleitet, Fenster/Sperre/Immunität weg', () => {
  const g = raum(1);
  for (const kind of ['korvette', 'fregatte', 'kreuzer']) {
    const es = verbuendeter(g, kind);
    const ids = Gsys.ids(es);
    const bug = ids.filter((id) => Gsys.defOf(kind, id).zone === 'bug'); const stb = ids.filter((id) => Gsys.defOf(kind, id).zone === 'stb');
    for (const id of bug) { es.sys[id].z = 'broken'; es.sys[id].i = 0; }   // drei zerstörte Systeme (Bug) …
    for (const id of stb) { es.sys[id].z = 'damaged'; es.sys[id].i = Gsys.maxOf(es, id) * SM.reparatur.damaged; }   // … und beschädigte
    es.sys.antrieb.z = 'damaged'; es.sys.antrieb.i = 0; es.sys.antrieb.sp = g.time; es.sys.antrieb.imm = g.time + 10; es.sys[bug[0]].tf = g.time + 5;   // eine vorgemerkte Stufe, Sperre, Immunität, Fenster
    es.hp = Gsys.summe(es);
    const e = gegner(g, kind);
    Gsys.stufenUebernehmen(g, e, es);
    const gleich = ids.every((id) => e.sys[id].z === (id === 'antrieb' ? 'broken' : es.sys[id].z));
    ok(gleich, `${kind}: alle Stufen übernommen (${bug.length} zerstört, ${stb.length} beschädigt, der Antrieb mit der vorgemerkten Stufe zerstört)`);
    ok(ids.every((id) => Math.abs(e.sys[id].i - Integ.grundwertVon(e.sys[id].z, Gsys.maxOf(e, id), Integ.damagedAnteil(g))) < 1e-9) && Math.abs(e.hp - Gsys.summe(e)) < 1e-9, `${kind}: i aus der Stufe abgeleitet, e.hp = Σ i (${e.hp.toFixed(1)} von ${e.hpMax})`);
    ok(ids.every((id) => !('tf' in e.sys[id]) && !('sp' in e.sys[id]) && !('imm' in e.sys[id])) && ids.every((id) => !Gsys.vorgemerkt(g, e, id)), `${kind}: Fenster, Sperre, Immunität und vorgemerkte Stufen gelöscht`);
    ok(ids.filter((id) => e.sys[id].z === 'ok').length === ids.filter((id) => es.sys[id].z === 'ok').length, `${kind}: keine ok-Systeme bei verminderter Integrität (alte Regel: alle ok mit i × Anteil)`);
    g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
  // Spawn eines verletzten Verbündeten über den Anteil (escort.js): Stufen von hinten nach vorn, deterministisch
  const a1 = Flotte.aufstellen(g, { tag: 'verl1', kind: 'kreuzer', huelle: 50 }); const a2 = Flotte.aufstellen(g, { tag: 'verl2', kind: 'kreuzer', huelle: 50 });
  ok(JSON.stringify(Gsys.ids(a1).map((id) => a1.sys[id].z)) === JSON.stringify(Gsys.ids(a2).map((id) => a2.sys[id].z)) && Object.values(a1.sys).some((s) => s.z !== 'ok') && a1.sys.reaktor.z !== 'broken', 'verletzter Verbündeter (Hülle 50 %): Stufen deterministisch, der Reaktor nicht zerstört');
});

// ---------------------------------------------------------------- Antrieb: gezielt = zwei Stufen, ungezielt = eine (Datenfeld gezielt = zerstoert)
section('Antrieb: gezielter Treffer = sofort beschädigt, nach der Sperre zerstört; ungezielt eine Stufe; die Reparatur wartet auf die vorgemerkte Stufe', () => {
  const ZW = require('../content/kampf/zielsysteme-werte.json').werte; const SPERRE = ZW.treffer.wert.sperre_s;
  const Rep = require('../server/sim/gegnerreparatur.js'); const Zs = require('../server/sim/zielsysteme.js');
  ok(ZW.systeme.wert.antrieb.gezielt === 'zerstoert' && Gsys.gezieltZerstoert('antrieb') && !Gsys.gezieltZerstoert('reaktor') && Zs.lercheGezieltZerstoert('engines'), 'Datenfeld systeme.antrieb.gezielt = zerstoert (eine Quelle für Gegner und Lerche)');
  const g = raum(1);
  for (const kind of ['korvette', 'fregatte']) {
    const e = frisch(g, gegner(g, kind)); const zone = Gsys.defOf(e.kind, 'antrieb').zone;
    const gez = () => Gsys.treffen(g, e, zone, { id: 'antrieb', zugewandt: zone });
    const t0 = g.time; const r1 = gez();
    ok(r1 && r1.gezielt && e.sys.antrieb.z === 'damaged' && Gsys.vorgemerkt(g, e, 'antrieb') && e.sys.antrieb.i === 0, `${kind}: gezielter Treffer: sofort beschädigt, die Zerstörung ist vorgemerkt (i = 0)`);
    ok(Rep.vorgaenge(g, e).indexOf('antrieb') < 0, `${kind}: die Reparatur nimmt den Antrieb nicht (vorgemerkte Stufe geht nicht verloren)`);
    g.time = t0 + SPERRE - 0.05; Gsys.nachholen(g, e); ok(e.sys.antrieb.z === 'damaged', `${kind}: vor Ablauf der Sperre noch beschädigt`);
    g.time = t0 + SPERRE + 0.1; Gsys.nachholen(g, e);
    ok(e.sys.antrieb.z === 'broken' && !Gsys.vorgemerkt(g, e, 'antrieb') && Rep.vorgaenge(g, e).indexOf('antrieb') >= 0, `${kind}: nach der Sperre (${SPERRE} s) zerstört, danach reparierbar`);
    g.time += FENSTER + 0.1; gez();
    ok(e.sys.antrieb.z === 'broken' && e.sys.antrieb.i === 0, `${kind}: gezielter Treffer auf den zerstörten Antrieb: nichts weiter (zerstört bleibt zerstört)`);
    g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
  // ungezielt (ohne Systemziel): die Heck-Zone der Korvette besteht nur aus dem Antrieb, der Treffer trifft ihn sicher – genau eine Stufe, nichts vorgemerkt
  const e2 = frisch(g, gegner(g, 'korvette')); const zone2 = Gsys.defOf(e2.kind, 'antrieb').zone; const t1 = g.time;
  const r2 = Gsys.treffen(g, e2, zone2, null, null);
  ok(r2 && r2.id === 'antrieb' && !r2.gezielt && e2.sys.antrieb.z === 'damaged' && !Gsys.vorgemerkt(g, e2, 'antrieb') && e2.sys.antrieb.i > 0, 'ungezielter Treffer auf den Antrieb: genau eine Stufe (beschädigt), nichts vorgemerkt');
  g.time = t1 + SPERRE + 0.5; Gsys.nachholen(g, e2); ok(e2.sys.antrieb.z === 'damaged', 'ungezielt: bleibt beschädigt (auch nach der Sperre)');
  g.space.enemies = g.space.enemies.filter((x) => x !== e2);
  // Ende zu Ende über den Waffenweg der Lerche: Systemziel Antrieb, Treffer von hinten (damageEnemy mit angriff)
  const e3 = frisch(g, gegner(g, 'korvette')); e3.angle = 0; e3.scanned = true; g.ship.target = e3.id; g.ship.zielsystem = 'antrieb';
  const qx = e3.x - 300, qy = e3.y; g.ship.x = qx; g.ship.y = qy;
  space.damageEnemy(g, e3, 3, qx, qy, { angriff: true });
  ok(e3.sys.antrieb.z === 'damaged', 'Waffenweg (damageEnemy, Systemziel Antrieb, Treffer von hinten): sofort beschädigt');
  g.time += SPERRE + 0.1; Gsys.nachholen(g, e3);
  ok(e3.sys.antrieb.z === 'broken' && Zs.ausgefallen(e3, 'antrieb'), 'nach der Sperre ausgefallen (die Verfolgung kann stellen)');
  delete g.ship.zielsystem; g.ship.target = null; g.space.enemies = g.space.enemies.filter((x) => x !== e3);
});

// ---------------------------------------------------------------- integPct und die Prozent-Auslöser
section('integPct: „alle Systeme beschädigt“ ist bei jeder Klasse genau 50 (Auslöser integritaet_unter < 50 und enemyHpBelow <= 50 entscheiden gleich)', () => {
  const g = raum(1);
  for (const kind of ['raider', 'korvette', 'fregatte', 'kreuzer', 'sentinel', 'pylon', 'frachter']) {
    const e = gegner(g, kind);
    for (const id of Gsys.ids(e)) { e.sys[id].z = 'damaged'; e.sys[id].i = Gsys.maxOf(e, id) * SM.reparatur.damaged; }
    e.hp = Gsys.summe(e);
    const p = Gsys.integPct(e);
    ok(p === 50 && !(p < 50) && p <= 50, `${kind}: integPct ${p} (genau 50: kein Rundungsrest, Auslöser < 50 aus, <= 50 an)`);
    ok(Number.isInteger(p * 1e6) || Math.abs(p * 1e6 - Math.round(p * 1e6)) < 1e-6, `${kind}: auf 6 Nachkommastellen gerundet`);
    g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
  ok(Gsys.integPct(gegner(g, 'raider')) === 100, 'voll: 100');
});

// ---------------------------------------------------------------- Spiegeltest Lerche <-> Gegner <-> Verbündeter
section('Spiegeltest: Lerche, Gegner und Verbündeter reagieren auf dieselbe Trefferfolge gleich (Stufenfolge)', () => {
  // Folge: Treffer, Treffer im selben Tick (verfällt), Pause, Treffer, Treffer im selben Tick (Zone leer: Mitte). Beobachtet: das einzige System der Zone.
  const folge = [0, 0, 1, 0];   // 1 = Fenster abwarten vor dem Treffer
  const lerche = () => {
    const g = new Game({ noStore: true, seed: 71, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    g.space.enemies = []; g.space.projectiles = []; g.ship.fireList = []; g.ship.breachList = [];
    for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
    g.ship.fragile = {}; g.ship.offline = {}; g.ship.trefferT = {}; g.ship.shields.current = [0, 0, 0, 0]; Schilde.pause.loeschen(g.ship.shields);
    g.ship.x = 1500; g.ship.y = 800; g.ship.angle = 0; g.ship.docked = false; g.god = false;
    I.integritaetVoll(g);
    const ks = I.SYSTEM_ORDER.filter((k) => I.systemSector(k) === 0 && I.systemAktiv(g, k));
    for (const k of ks.slice(1)) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
    const out = [RANG[g.ship.systems[ks[0]]]];
    for (const w of folge) { if (w) weiter(g); space.shipHit(g, 0, 3, {}); out.push(RANG[g.ship.systems[ks[0]]]); }
    return out;
  };
  const ziel = (kind, seite) => {
    const g = raum(2);
    const e = frisch(g, seite === 'gegner' ? gegner(g, kind) : verbuendeter(g, kind));
    const s = einziges(e, 'bug');
    const out = [RANG[e.sys[s].z]];
    for (const w of folge) { if (w) weiter(g); STERNE(g, e).hit(3, {}); out.push(RANG[e.sys[s].z]); }
    return out;
  };
  const L = lerche();
  ok(JSON.stringify(L) === JSON.stringify([0, 1, 1, 2, 2]), `Lerche: Stufenfolge ${L.join(',')} (Soll 0,1,1,2,2)`);
  for (const kind of KLASSEN) for (const seite of ['gegner', 'verbuendet']) {
    const z = ziel(kind, seite);
    ok(JSON.stringify(z) === JSON.stringify(L), `${seite} ${kind}: Stufenfolge ${z.join(',')} = Lerche`);
  }
});

// ---------------------------------------------------------------- Config und Code: keine Reste der Punktregel
section('Keine Reste der Punktregel: sturmSchaden, systemFaktor, gegnerIntegritaet und Punktabzug sind weg', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', f), 'utf8');
  const alle = ['space.js', 'sturm.js', 'gegnersystem.js', 'escort.js', 'zonen.js', 'alarm.js', 'flotte.js', 'schiffswaffen.js', 'damage.js'].map(src).join('\n');
  ok(!/sturmSchaden/.test(alle) && !/systemFaktor/.test(alle) && !/gegnerIntegritaet/.test(alle), 'kein sturmSchaden / systemFaktor / gegnerIntegritaet im Servercode');
  ok(!('sturmSchaden' in SM) && !('systemFaktor' in SM.sturm) && !('systemFaktor' in Katalog.waffe('sturmbatterie').sturm), 'Config und Katalog: Punktfaktoren entfernt');
  ok(Object.values(CONFIG.crewScaling).every((c) => !('gegnerIntegritaet' in c) && c.enemyFireInterval > 0), 'crewScaling: nur das Feuerintervall');
  ok(!/\.i\s*=\s*Math\.max\(0,\s*st\.i\s*-/.test(src('gegnersystem.js')), 'gegnersystem: kein Integritätsabzug mehr');
  ok(!/skala/.test(src('space.js')) && !/allyTreffer\(game, es, dmg, skala/.test(src('escort.js')), 'space/escort: keine Punkt-Skalierung (skala) für den Systemtreffer');
  // Budget ohne Crew-Skalierung: gleiches Budget bei Crew 1/2/3
  const hp = [1, 2, 3].map((c) => { const g = raum(c); const e = gegner(g, 'fregatte'); return e.hpMax; });
  ok(hp[0] === hp[1] && hp[1] === hp[2] && hp[0] === Math.round(CONFIG.enemies.fregatte.hp * Gsys.budgetFaktor('fregatte')), `Budget Fregatte bei Crew 1/2/3: ${hp.join('/')} (= Hülle × budgetFaktor)`);
  const fi = [1, 2, 3].map((c) => space.crewScale(raum(c)).enemyFireInterval);
  ok(fi[0] > fi[1] && fi[1] === fi[2], `Feuerintervall skaliert weiter mit der Crew (${fi.join('/')})`);
});

section('Reaktor: mehrere Stufen in kurzer Folge lösen den Countdown nur einmal aus; Reparatur setzt den Grundwert aus der Stufe', () => {
  const g = raum(1);
  const e = frisch(g, gegner(g, 'fregatte'));
  Th.mitteNurReaktor(e);
  const q = quelleBug(e);
  space.damageEnemy(g, e, 5, q.x, q.y, { durchschlag: 'zone' });
  weiter(g);
  space.damageEnemy(g, e, 5, q.x, q.y, { durchschlag: 'zone' });
  ok(Gsys.reaktorZerstoert(e) && e.rt && e.rt.n === 1, 'Reaktor beschädigt, dann zerstört: Countdown n = 1');
  weiter(g); space.damageEnemy(g, e, 5, q.x, q.y, { durchschlag: 'zone' });
  ok(e.rt.n === 1, 'weitere Treffer auf die leere Mitte lösen keinen zweiten Countdown aus');
  const Rep = require('../server/sim/gegnerreparatur.js');
  const id = Gsys.ids(e).find((x) => Gsys.defOf(e.kind, x).zone === 'bug');
  e.sys[id].z = 'broken'; e.sys[id].i = 0; e.hp = Gsys.summe(e);
  e.gestellt = false;
  for (let t = 0; t < 400; t++) Rep.tick(g, e, 0.1);
  ok(e.sys[id].z === 'ok' && Math.abs(e.sys[id].i - Gsys.maxOf(e, id)) < 1e-9, 'Reparatur zerstört -> beschädigt -> ok: i folgt dem Grundwert der Stufe');
});

console.log(`\n${n - fails}/${n} ok (SYS-03 B2 Direkttreffer Gegner/Verbündete)`);
process.exit(fails ? 1 : 0);
