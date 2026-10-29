'use strict';
// SYS-01 C2b „Verbündete im Systemmodell, Kopplung Weltsimulation ↔ Szene, Baustein Gegner flieht per Notfallsprung“ (Konzept „Systemmodell Zonen“,
// Auftrag „Das Schiff in Zonen“ Paket C, Abnahme 11, 16, 18; Erkundung Frage 2c, Offener Punkt 6):
//   1. Verbündete (escort.js ally) haben das Systemmodell ihrer Klasse (gegner-systeme.json); Budget = flotte.hull[klasse], keine Crew-Skalierung.
//   2. Treffer über den Trefferweg der Gegner (Zone der Seite zur Quelle, zufälliges nicht zerstörtes System, leere Zone -> Mitte), Reaktor-Countdown und
//      Ablauf -> zerstört (allyLost), Reparatur wie bei Gegnern, es.hp = Σ der Integrität. Schützlinge bleiben vereinfacht (kein Systemmodell).
//   3. Szene-Kopplung: Budget und Anteil (Eichung, Verrat) setzen Systeme und Σ konsistent.
//   4. Szenenbaustein gegner_notfallsprung: Auslöser (3 Arten), Konkurrenz mit dem Countdown, ohne Baustein kein Entkommen, Prüfer (Fehlerfälle).
//   node tools/test-verbuendete-systeme.js [begriff …]
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gegnertod = require('../server/sim/gegnertod.js');
const Gegnersprung = require('../server/sim/gegnersprung.js');
const Zs = require('../server/sim/zielsysteme.js');
const Registry = require('../server/mission/registry.js');
const Checker = require('../server/mission/checker.js');
const Testhilfe = require('./gegner-testhilfe.js');
const DATEN = require('../content/kampf/gegner-systeme.json');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const F = CONFIG.flotte;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-verb-sys-'));
let dirSeq = 0;

// Partie im Raum (Splittergürtel), ohne Gegner, Lerche ruhig und unverwundbar (god); np Spieler verbunden.
function raum(np) {
  const dir = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'V' + i, name: 'V' + i, color: i });
  }
  g.reset(); g.phase = 'play';
  space.enterScene(g, 'splitter', {});
  g.space.enemies = []; g.space.projectiles = [];
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const me0 = g.missionEvent.bind(g);   // Missionsereignisse (enemyKilled, enemyEscaped) unter ihrem Namen
  g.missionEvent = (name, data) => { events.push(Object.assign({ kind: name, t: g.time }, data)); return me0(name, data); };
  const sh = g.ship; sh.x = 1500; sh.y = 800; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0;
  g.god = true;
  return { g, events, ev: (k) => events.filter((e) => e.kind === k) };
}
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const summe = (es) => Object.keys(es.sys).reduce((a, id) => a + es.sys[id].i, 0);
// Zone der Seite, aus der eine Quelle (x, y) das Schiff trifft (Geometrie wie im Spiel)
const zoneVonQuelle = (g, es, x, y) => Gsys.SEITE_ZONE[Zs.seiteGetroffen(g, es, x, y)];
const KLASSEN = ['korvette', 'fregatte', 'kreuzer', 'raider'];

section('Verbündete: Systemmodell der Klasse', () => {
  const { g } = raum(1);
  for (const kind of KLASSEN) {
    const es = Flotte.aufstellen(g, { tag: 'v_' + kind, kind });
    const ids = Object.keys(es.sys).sort(); const want = Gsys.systemeVon(kind).map((d) => d.id).sort();
    ok(!!es && Gsys.hat(es) && JSON.stringify(ids) === JSON.stringify(want), `${kind}: dieselben Systeme wie die Gegner-Klasse (${ids.length})`);
    ok(Object.keys(es.sys).every((id) => Gsys.defOf(kind, id).zone === DATEN.klassen[kind].systeme.find((d) => d.id === id).zone), `${kind}: dieselben Zonen wie in gegner-systeme.json`);
    ok(es.hpMax === F.hull[kind] && Math.abs(summe(es) - F.hull[kind]) < 1e-6 && Math.abs(es.hp - F.hull[kind]) < 1e-6, `${kind}: Budget = flotte.hull (${F.hull[kind]}), Σ der Integrität = hp`);
    ok(Object.keys(es.sys).every((id) => es.sys[id].z === 'ok'), `${kind}: alle Systeme ok im Ausgangszustand`);
  }
});

section('Verbündete: keine Crew-Skalierung', () => {
  const a = raum(1); const b = raum(3);
  const ea = Flotte.aufstellen(a.g, { tag: 'c1', kind: 'fregatte' });
  const eb = Flotte.aufstellen(b.g, { tag: 'c3', kind: 'fregatte' });
  ok(ea.hpMax === eb.hpMax && ea.hpMax === F.hull.fregatte, `Budget bei 1 und 3 Spielern gleich (${ea.hpMax} = ${eb.hpMax})`);
  ok(Object.keys(ea.sys).every((id) => Math.abs(ea.sys[id].i - eb.sys[id].i) < 1e-9), 'Integrität je System bei 1 und 3 Spielern gleich');
});

section('Verbündete: Trefferweg (Zone der Quelle, Mitte nur bei leerer Zone, Schild auf 0 gesetzt; Schildfall: test-verbuendete-wie-gegner)', () => {
  const { g } = raum(1);
  const es = Flotte.aufstellen(g, { tag: 'tw', kind: 'kreuzer' });
  const vor = {}; for (const id of Object.keys(es.sys)) vor[id] = es.sys[id].i;
  const vx = es.x + Math.cos(es.angle) * 300, vy = es.y + Math.sin(es.angle) * 300;   // Quelle vorn
  const zone = zoneVonQuelle(g, es, vx, vy);
  Testhilfe.schildNull(es);   // SYS-02b: Verbündete haben Schildsegmente; dieser Test prüft den Systemtreffer (Schild 0), der Schildfall steht in test-verbuendete-wie-gegner.js
  Escort.hit(g, es, 10, { von: { x: vx, y: vy } });
  const ge = Object.keys(es.sys).filter((id) => es.sys[id].i < vor[id] - 1e-9);
  ok(ge.length === 1 && Gsys.defOf('kreuzer', ge[0]).zone === zone, `Treffer aus Richtung ${zone} trifft genau ein System dieser Zone (${ge.join(',')})`);
  ok(Math.abs(es.hp - summe(es)) < 1e-6 && es.hp < F.hull.kreuzer, 'es.hp = Σ der Integrität, nach dem Treffer unter dem Budget');
  // Zone leer -> Mitte
  Testhilfe.setzeIntegritaet(es, zone, 0);
  const mitte = Gsys.ids(es).filter((id) => Gsys.defOf('kreuzer', id).zone === 'mitte');
  const mitteVor = {}; for (const id of mitte) mitteVor[id] = es.sys[id].i;
  Escort.hit(g, es, 10, { von: { x: vx, y: vy } });
  const mitteGe = mitte.filter((id) => es.sys[id].i < mitteVor[id] - 1e-9);
  ok(mitteGe.length === 1, `leere Zone ${zone}: der Treffer geht in die Mitte (${mitteGe.join(',')})`);
  // Nur ein nicht zerstörtes System in der Zone: die Treffer gehen nur dorthin
  const stb = Gsys.ids(es).filter((id) => Gsys.defOf('kreuzer', id).zone === 'stb');
  Testhilfe.setzeIntegritaet(es, 'stb', 0);
  const letzte = stb[stb.length - 1];
  Testhilfe.setzeIntegritaet(es, letzte, Gsys.maxOf(es, letzte));
  let quelle = null;   // Punkt, aus dem der Treffer die Steuerbord-Zone trifft
  for (let a = 0; a < 2 * Math.PI && !quelle; a += 0.05) { const x = es.x + Math.cos(a) * 300, y = es.y + Math.sin(a) * 300; if (zoneVonQuelle(g, es, x, y) === 'stb') quelle = { x, y }; }
  for (let i = 0; i < 30; i++) Escort.hit(g, es, 2, { von: quelle });
  const nurLetzte = stb.filter((id) => id !== letzte).every((id) => es.sys[id].i === 0 && es.sys[id].z === 'broken');
  ok(nurLetzte && es.sys[letzte].i < Gsys.maxOf(es, letzte), 'Zufall wählt nur nicht zerstörte Systeme der Zone (zerstörte bleiben bei 0)');
});

section('Verbündete: Reaktor-Countdown, Reparatur, Schützlinge unverändert', () => {
  const { g, ev } = raum(1);
  const es = Flotte.aufstellen(g, { tag: 'rk', kind: 'korvette' });
  Gegnertod.brechen(g, es, 'reaktor');   // Reaktor zerstört: Countdown wie bei Gegnern
  const rest = Gegnertod.restZehntel(es) / 10;
  ok(es.rt && es.rt.rest != null && rest > 0, `Reaktor zerstört: Countdown läuft (${rest} s)`);
  ok(Escort.active(es), 'bis zum Ablauf kämpft der Verbündete weiter');
  ticks(g, rest + 0.5);
  ok(Escort.stateOf(g, 'rk') === 'zerstoert' && ev('allyLost').filter((x) => x.tag === 'rk').length === 1 && !g.space.escorts.some((q) => q.tag === 'rk'), 'Countdown abgelaufen: zerstört (allyLost), aus dem Raum');
  ok(Escort.outcome(g, 'rk') === 'verloren' && g.mission.flags.rk_verloren === true, 'Ausgang verloren, Flag rk_verloren');
  // Reparatur: zerstörtes Waffensystem -> beschädigt nach zerstoertZuBeschaedigt
  const e2 = Flotte.aufstellen(g, { tag: 'rp', kind: 'fregatte' });
  Testhilfe.setzeIntegritaet(e2, 'waffe_bb1', 0);
  const zeit = Number(CONFIG.systemModell.gegner.reparatur.zerstoertZuBeschaedigt);
  ticks(g, zeit + 1);
  ok(e2.sys.waffe_bb1.z === 'damaged' && Math.abs(e2.hp - summe(e2)) < 1e-6, `Reparatur wie bei Gegnern: zerstört -> beschädigt nach ${zeit} s, es.hp = Σ`);
  // Reaktor: ohne Schalter reparatur.reaktor nicht reparierbar (hier nur ein zerstörter Reaktor ohne Countdown-Ablauf: Schalter aus)
  ok(Gegnertod.restZehntel(e2) === -1 && e2.sys.reaktor.z === 'ok', 'Reaktor unberührt (kein Countdown ohne Ausfall)');
  // Schützling: kein Systemmodell, Hülle wie bisher
  const s = Escort.spawn(g, { tag: 'sz', kind: 'frachter', verhalten: 'folgt_kurs', von: 'lerche' });
  const hp0 = s.hp; Escort.hit(g, s, 4, {});
  const cd = Number(((CONFIG.escorts || {}).crewDamage || {})[1]) || 1;
  ok(!Gsys.hat(s) && Math.abs((hp0 - s.hp) - 4 * CONFIG.escorts.hullPerDamage * cd) < 0.11, `Schützling ohne Systemmodell: Hülle −${Math.round((hp0 - s.hp) * 10) / 10} wie bisher (Schaden × hullPerDamage × crewDamage)`);
});

section('Szene-Kopplung: Budget und Anteil halten Systeme und Σ konsistent', () => {
  const { g } = raum(1);
  const es = Flotte.aufstellen(g, { tag: 'kp', kind: 'kreuzer' });
  Gsys.setzeBudget(g, es, F.hull.kreuzer * 1.2);
  ok(es.hpMax === Math.round(F.hull.kreuzer * 1.2) && Math.abs(summe(es) - es.hpMax) < 1e-6 && Math.abs(es.hp - es.hpMax) < 1e-6, `Eichung (Budget ×1,2): Maximum neu, Systeme voll, Σ = hp = ${es.hpMax}`);
  Gsys.setzeAnteil(g, es, 0.3);
  ok(Math.abs(es.hp - 0.3 * es.hpMax) < 1e-6 && Math.abs(summe(es) - es.hp) < 1e-6, 'Verteidiger-Anteil 30 %: Σ = 30 % des Budgets');
  ok(Math.abs(Gsys.integPct(es) - 30) < 1e-6, `Gesamtintegrität in Prozent = ${Math.round(Gsys.integPct(es))} % (Lesepfad der Szene)`);
  Gsys.setzeAnteil(g, es, 0.6);
  ok(Math.abs(Gsys.integPct(es) - 60) < 1e-6, 'Verrat: Quote 60 % bleibt nach dem Setzen erhalten');
  const r = space.spawnEnemy(g, 'relay', { tag: 'rl' });
  Gsys.setzeBudget(g, r, 333);
  ok(r.hp === 333 && r.hpMax === 333, 'Gegner ohne Modell (Störrelais): hp = Budget');
});

section('Baustein gegner_notfallsprung: Auslöser, Konkurrenz, ohne Baustein kein Entkommen', () => {
  const t = raum(1); const { g, ev } = t;
  const mk = (tag) => space.spawnEnemy(g, 'korvette', { tag, x: 2200, y: 800, ziel: 'lerche' });
  // (a) reaktor_zerstoert, Ladung 8 s < Countdown 20 s: entkommt ohne Abschuss
  const kills0 = g.stats.kills;
  const a = mk('flucht_a');
  Gegnersprung.regel(g, { ziel: 'flucht_a', ausloeser: 'reaktor_zerstoert', verzoegerung_s: 8 });
  Gegnertod.brechen(g, a, 'reaktor');
  ticks(g, 9);
  ok(!g.space.enemies.includes(a) && ev('enemyEscaped').length === 1, 'reaktor_zerstoert: Gegner entkommt (enemyEscaped), 8 s < 20 s');
  ok(g.stats.kills === kills0 && !ev('enemyKilled').some((x) => x.enemy === a), 'Entkommen ist kein Abschuss (kein enemyKilled, kein enemyDown)');
  // (b) Konkurrenz: Countdown-Rest 5 s < Ladung 8 s: der Gegner stirbt
  const b = mk('flucht_b');
  Gegnersprung.regel(g, { ziel: 'flucht_b', ausloeser: 'reaktor_zerstoert', verzoegerung_s: 8 });
  Gegnertod.brechen(g, b, 'reaktor'); b.rt.rest = 5;
  ticks(g, 6);
  ok(!g.space.enemies.includes(b) && ev('enemyKilled').some((x) => x.enemy === b) && !ev('enemyEscaped').some((x) => x.enemy === b), 'Countdown kürzer als die Ladung: der Gegner stirbt (enemyKilled), kein Entkommen');
  // (c) integritaet_unter 50 %, Ladung 3 s
  const c = mk('flucht_c');
  Testhilfe.setzeGesamt(c, 0.4 * c.hpMax);
  Gegnersprung.regel(g, { ziel: 'flucht_c', ausloeser: 'integritaet_unter', prozent: 50, verzoegerung_s: 3 });
  ticks(g, 0.5);
  ok(!!c.notsprung && g.space.enemies.includes(c), 'integritaet_unter 50 %: lädt bei 40 % Integrität');
  ticks(g, 3);
  ok(!g.space.enemies.includes(c) && ev('enemyEscaped').some((x) => x.enemy === c), 'integritaet_unter: nach 3 s entkommen');
  // (d) sofort, Ladung 2 s; während der Ladung keine Teleschüsse
  const d = mk('flucht_d');
  Gegnersprung.regel(g, { ziel: 'flucht_d', ausloeser: 'sofort', verzoegerung_s: 2 });
  ticks(g, 0.2);
  ok(!!d.notsprung, 'sofort: lädt ab dem ersten Tick');
  const teleVor = ev('tele').filter((x) => x.id === d.id).length;
  ticks(g, 1.5);
  ok(ev('tele').filter((x) => x.id === d.id).length === teleVor && !d.tele, 'während der Ladung keine Teleschüsse');
  ticks(g, 1);
  ok(!g.space.enemies.includes(d), 'sofort: nach 2 s entkommen');
  // (e) ohne Baustein: kein Entkommen, der Countdown endet im Abschuss
  const kills1 = g.stats.kills;
  const e = mk('ohne_e');
  Gegnertod.brechen(g, e, 'reaktor');
  ticks(g, Gegnertod.restZehntel(e) / 10 + 0.5);
  ok(!g.space.enemies.includes(e) && g.stats.kills === kills1 + 1 && !ev('enemyEscaped').some((x) => x.enemy === e), 'ohne Baustein: kein Entkommen, der Countdown endet im Abschuss');
});

section('Baustein gegner_notfallsprung: Prüfer und Vorlage', () => {
  const bs = Registry.get('gegner_notfallsprung');
  ok(!!bs && bs.art === 'aktion' && bs.params.ausloeser.werte.length === 3, 'Baustein registriert, drei Auslöser');
  const doc = (params) => ({ format: 'regiebuch/1', id: 'sprung_vorlage', titel: 'Notfallsprung-Vorlage', auftraggeber: 'tesk', kopf: { art: 'test' }, buehne: { orte: ['splitter'] },
    steps: [{ id: 'a', loc: 'splitter', enter: [Object.assign({ do: 'gegner_notfallsprung' }, params)],
      objectives: [{ id: 'o1', text: '@t1', done: { check: { name: 'verfolgung_erfolg' } } }],
      next: [{ if: { check: { name: 'verfolgung_erfolg' } }, complete: 'erfolg' }] }],
    texte: { t1: 'Gegner entkommen lassen' } });
  const meldungen = (r) => r.errors.concat(r.warnings).filter((x) => /enter|notfallsprung|ausloeser|verzoegerung/i.test(x.p + ' ' + x.msg));
  const gut = Checker.check(doc({ ziel: 'raider', ausloeser: 'reaktor_zerstoert', verzoegerung_s: 8 }), {});
  ok(meldungen(gut).length === 0, 'Prüfer: gültige Vorlage ohne Meldung' + (meldungen(gut).length ? ' – ' + JSON.stringify(meldungen(gut)[0]) : ''));
  const bad1 = Checker.check(doc({ ziel: 'raider', ausloeser: 'vielleicht', verzoegerung_s: 8 }), {});
  ok(bad1.errors.some((x) => /ausloeser|vielleicht/.test(x.msg + x.p)), 'Prüfer: unbekannter Auslöser wird gemeldet');
  const bad2 = Checker.check(doc({ ziel: 'raider', ausloeser: 'sofort', verzoegerung_s: 0 }), {});
  ok(bad2.errors.some((x) => /verzoegerung/.test(x.msg + x.p)), 'Prüfer: verzoegerung_s = 0 wird gemeldet');
  const bad3 = Checker.check(doc({ ausloeser: 'sofort', verzoegerung_s: 8 }), {});
  ok(bad3.errors.some((x) => /ziel/.test(x.msg + x.p)), 'Prüfer: fehlendes Ziel wird gemeldet');
  // Vorlage im Lauf: der Baustein legt die Regel an
  const { g, ev } = raum(1);
  Registry.get('gegner_notfallsprung').run({ game: g }, { ziel: 'vorlage', ausloeser: 'sofort', verzoegerung_s: 1 });
  const v = space.spawnEnemy(g, 'raider', { tag: 'vorlage', x: 2200, y: 800, ziel: 'lerche' });
  ticks(g, 1.5);
  ok(!g.space.enemies.includes(v) && ev('enemyEscaped').length === 1, 'Vorlage: der Baustein läuft, der Jäger entkommt nach 1 s');
});

section('Entkommen und Wellen: Gegner weg beendet die Welle, ohne Abschuss', () => {
  // (a) Flotten-Welle (Szene): alle Gegner der Welle entkommen -> Welle fertig, kein enemyKilled, stats.kills und Missionszähler unverändert
  const t = raum(1); const { g, ev } = t;
  Gegnersprung.regel(g, { ziel: 'wl_test', ausloeser: 'sofort', verzoegerung_s: 1 });
  const kills0 = g.stats.kills, mk0 = JSON.stringify(g.mission.kills || {});
  Flotte.wellenStart(g, { wellen: 'raider:2|raider:1', ziel: 'auto', richtung: 'alle', takt: 0, rest: 0, ueberdruck: false, tag: 'wl_test' });
  ticks(g, 12);
  const w = g.flotte.welle;
  ok(ev('enemyEscaped').length >= 2 && ev('enemyKilled').length === 0, 'Flotten-Welle: alle Gegner beider Wellen entkommen (enemyEscaped), kein enemyKilled');
  ok(!!w && w.fertig && Flotte.wellenFertig(g) && ev('wellenFertig').length === 1, 'Flotten-Welle: „Gegner weg“ beendet die Welle (wellenFertig, genau einmal)');
  ok(g.stats.kills === kills0 && JSON.stringify(g.mission.kills || {}) === mk0, 'Flotten-Welle: kein Abschuss gezählt (stats.kills, Missionszähler)');
  ok(!g.space.enemies.some((e) => e.tag === 'wl_test'), 'enemiesCleared: kein Gegner mit dem Tag mehr im Raum');
  // (b) Testgelände Raumkampf (arena.js): Welle gilt als geräumt, a.cleared zählt, Abschüsse bleiben 0
  const dir = path.join(TMP, 'arena'); fs.mkdirSync(dir, { recursive: true });
  const a = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  a.addConnection(c); a.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'A0', color: 0 });
  a.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); a.handleMessage(c, { t: 'ready', ready: true });
  a.god = true;
  Gegnersprung.regel(a, { ziel: 'arena', ausloeser: 'sofort', verzoegerung_s: 1 });
  for (let i = 0; i < 30 * 40 && !(a.arena && a.arena.active); i++) a.step();
  ok(a.arena && a.arena.active && a.arena.wave === 1 && a.space.enemies.some((e) => e.tag === 'arena'), 'Arena: Welle 1 steht');
  const ak0 = a.stats.kills;
  for (let i = 0; i < 30 * 12 && a.arena.active; i++) a.step();
  ok(!a.arena.active && a.arena.cleared === 1 && !a.space.enemies.some((e) => e.tag === 'arena'), 'Arena: alle entkommen -> Welle geräumt (cleared 1), nächste Welle angesetzt (' + (a.arena.nextAt != null) + ')');
  ok(a.stats.kills === ak0, 'Arena: kein Abschuss gezählt (stats.kills unverändert)');
  for (let i = 0; i < 30 * 30 && !a.arena.active; i++) a.step();
  ok(a.arena.active && a.arena.wave === 2, 'Arena: Welle 2 kommt nach dem Entkommen von Welle 1 (kein Hängen)');
});

if (fails) console.log(`\nFEHLER: ${fails} von ${n}`);
else console.log(`\ntest-verbuendete-systeme: ${n}/${n} ok`);
process.exit(fails ? 1 : 0);
