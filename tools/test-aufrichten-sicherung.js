'use strict';
// BOD-02 P10: Aufrichten als Trupp-Aufgabe mit Sicherung (server/sim/aufrichten.js, trupp.js aufrichtenVerteilen, squad.js aufrichtenSchritt).
//   a) Liegender für einen bekannten Spieler sichtbar, keine Sicherung: niemand geht (Gegenprobe: sichtPruefen=false -> der Helfer geht)
//   b) Liegender sichtbar, Niederhalter feuert: genau ein Helfer geht und richtet auf
//   c) Liegender unsichtbar (Wand bzw. Sichtschutz bzw. zu weit): Helfer geht
//   d) Helfer unter Feuer (knapp vorbei / Treffer): bricht sofort ab, Deckung (pin), Sperre
//   e) Sicherung entfällt (Niederhalter fällt): Abbruch
//   f) Messlauf Grabenangriff (graben --lauf), Spieler mit Lanze schießen gezielt auf Gegner: Zähler aufrichtenTod = 0 (und Versuche > 0)
//   node tools/test-aufrichten-sicherung.js [--seeds N=8] [--sek S=120]
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const Wf = require('../server/sim/waffen.js');
const Aufr = require('../server/sim/aufrichten.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const KACHELN = require('../content/buehnen/kacheln.json').zeichen;

Wf.aktiv = true;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TILE = Physics.TILE;
const LP = 'test.aufrichten';
const AC = CONFIG.awayCombat;
const ORIG = JSON.parse(JSON.stringify(AC.aufrichtenSicherung));
const restore = () => { Object.assign(AC.aufrichtenSicherung, JSON.parse(JSON.stringify(ORIG))); };
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };

// Testkarte 44 x 18: offen, Rand Wand; `mods` = [[tx, ty, zeichen], …]
function karte(mods) {
  const grid = [];
  for (let y = 0; y < 18; y++) { const r = []; for (let x = 0; x < 44; x++) r.push((x === 0 || y === 0 || x === 43 || y === 17) ? '#' : '.'); grid.push(r); }
  for (const [x, y, ch] of mods || []) grid[y][x] = ch;
  const rows = grid.map((r) => r.join(''));
  const legende = {};
  for (const r of rows) for (const ch of r) legende[ch] = KACHELN[ch];
  const A = (id, rolle, x, y, extra) => Object.assign({ id, rolle, x, y, platz: id.split('.')[0], bereich: null }, extra || {});
  return { id: LP, erzeuger: 'modul/1', art: 'aussenposten', bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt', seed: 2, bauversion: 'test',
    schablone: null, spiegel: null, w: 44, h: 18, rows, legende, anker: [A('lz.abholpunkt', 'abholpunkt', 2, 15, { ankunft: true, bereich: 'lz' })],
    bereiche: { lz: { name: 'Landezone', rects: [[1, 14, 6, 3]], rolle: 'hinein', gefecht: false } },
    plaetze: {}, eingaenge: [], abholpunkte: ['lz.abholpunkt'], ankunft: 'lz.abholpunkt',
    patrouillen: [], coverSpots: [], decks: null, kanten: {}, gelaende: null, meta: {} };
}
const MAUER = []; for (let y = 1; y <= 16; y++) MAUER.push([17, y, '#']);

// Szene: ein Spieler (steht unverwundbar bei (px, py)), Trupp t1 alarmiert. `liegt` = Kachel des Liegenden (grundtyp, verwundet), `helfer` = Kacheln der Blaster-Helfer,
// `nieder` = Kachel eines Niederhalters (Sturmgewehr) oder null. Das Trupp-Wissen (lastKnown + geteilt) wird jeden Tick auf den Spieler gesetzt (bekannter Spieler).
function szene(o) {
  restore(); Object.assign(AC.aufrichtenSicherung, o.cfg || {});
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'A0', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
  W.AWAY_MAPS[LP] = { id: LP, karte: karte(o.mods) };
  g.aways[LP] = away.makeLandepunkt(g, LP);
  g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  const aw = g.aways[LP]; aw.drones.length = 0;
  const S = { g, aw, tick: 0, p: g.players[0], maxHelfer: 0 };
  const pc = Physics.tileCenter(o.px, o.py); S.p.x = pc.x; S.p.y = pc.y;
  const mk = (rolle, tx, ty) => {
    const e = squad.makeEnemy(g, aw, squad.TYP_KIND[rolle] || 'scavenger', 'G' + g.nextId(''), Physics.tileCenter(tx, ty), 't1');
    e.rolle = rolle === 'grundtyp' ? undefined : rolle; e.asleep = false;
    if (!aw.squads[e.squad]) aw.squads[e.squad] = squad.newSquad(e.squad, 1);
    aw.drones.push(e); combat.kaempfer(g, e);
    return e;
  };
  S.helfer = (o.helfer || []).map(([x, y]) => mk('grundtyp', x, y));
  S.nieder = o.nieder ? mk('niederhalter', o.nieder[0], o.nieder[1]) : null;
  S.liegt = mk('grundtyp', o.liegt[0], o.liegt[1]);
  for (let i = 0; i < 8 && S.liegt.alive; i++) combat.hitEnemy(g, S.liegt, 1, { x: S.liegt.x - 300, y: S.liegt.y });
  if (S.liegt.alive || !S.liegt.liegt) throw new Error('Liegender nicht entstanden');
  const s = aw.squads.t1; squad.alertSquad(g, aw, s);
  S.s = s;
  S.alle = () => aw.drones.filter((e) => e.alive);
  S.run = (sek, each) => {
    for (let k = 0; k < Math.round(sek * 30); k++) {
      if (S.p.shield) S.p.shield.seg = 3;
      s.lastKnown[S.p.id] = { x: S.p.x, y: S.p.y, t: g.time }; s.contactAt = g.time;
      s.geteilt = s.geteilt || {}; if (!o.unbekannt) s.geteilt[S.p.id] = g.time + 3;
      g.step(); S.tick++;
      const h = aw.drones.filter((e) => e.alive && e.role === 'aufrichten').length; if (h > S.maxHelfer) S.maxHelfer = h;
      if (each) each();
    }
  };
  S.st = () => aw.truppStats || {};
  return S;
}
const ende = () => { delete W.AWAY_MAPS[LP]; restore(); };
const rollen = (S) => S.helfer.filter((e) => e.alive && e.role === 'aufrichten').length;

console.log('\n[Config]');
{
  const C = AC.aufrichtenSicherung;
  ok(C && C.sichtPruefen === true && C.sicherungSek > 0 && C.abbruchTreffer === true, 'awayCombat.aufrichtenSicherung vorhanden (sichtPruefen, sicherungSek, abbruchTreffer)');
}

// Spieler (15,8), Liegender (20,8): 5 Kacheln, offen -> sichtbar. Helfer bei (22,10)/(22,6): > 5 Kacheln vom Spieler, 2-3 Kacheln vom Liegenden.
const OFFEN = { px: 15, py: 8, liegt: [20, 8], helfer: [[22, 10], [22, 6]] };

console.log('\n[a) sichtbar, keine Sicherung: niemand geht]');
{
  const S = szene(OFFEN);
  const sicht = Aufr.sichtbarFuer(S.g, combat.env(S.g), S.liegt, Aufr.bekannteSpieler(S.g, S.s, S.alle()));
  ok(sicht.length === 1, 'Vorbedingung: der Liegende ist für den bekannten Spieler sichtbar');
  S.run(12);
  ok(rollen(S) === 0 && !S.liegt.helfer && S.liegt.zustand === 'verwundet', 'kein Helfer geht, der Liegende bleibt liegen (' + S.liegt.zustand + ')');
  ok((S.st().aufrichten || 0) === 0, 'Zähler aufrichten = 0 (' + (S.st().aufrichten || 0) + ')');
  ok(S.g.errors === 0 || !S.g.errors || !S.g.errors.length, 'keine Server-Fehler');
  ende();
  const S2 = szene(Object.assign({ cfg: { sichtPruefen: false } }, OFFEN));
  S2.run(12);
  ok((S2.st().aufrichten || 0) >= 1 || S2.liegt.zustand === 'ok', 'Gegenprobe sichtPruefen=false (früheres Verhalten): der Helfer geht (aufrichten ' + (S2.st().aufrichten || 0) + ')');
  ende();
}

console.log('\n[b) sichtbar, Niederhalter feuert: genau ein Helfer geht]');
{
  const S = szene(Object.assign({ nieder: [24, 8] }, OFFEN));
  let gefeuert = 0; let beginn = null;
  S.run(14, () => { if (S.nieder.alive && S.g.time - (S.nieder.schussAt == null ? -99 : S.nieder.schussAt) < 0.2) gefeuert++; if (beginn == null && rollen(S)) beginn = S.g.time; });
  ok(gefeuert > 20, 'Vorbedingung: der Niederhalter feuert (' + gefeuert + ' Ticks)');
  ok(beginn != null && S.st().aufrichten === 1, 'ein Helfer beginnt (Zähler aufrichten ' + S.st().aufrichten + ')');
  ok(S.maxHelfer === 1, 'höchstens ein Helfer zugleich (Maximum ' + S.maxHelfer + ')');
  ok(S.liegt.alive && S.liegt.zustand === 'ok', 'der Liegende steht wieder auf (' + (S.liegt.alive ? 'steht' : S.liegt.zustand) + ')');
  ok(!S.helfer.some((e) => e.aufgabe === 'aufrichten') && (S.st().aufgerichtet || 0) === 1, 'Aufgabe danach zurückgegeben, aufgerichtet = ' + (S.st().aufgerichtet || 0));
  ok(S.st().aufrichtenTod === 0 && S.st().abgebrochen === 0, 'kein Tod ohne Sicherung, kein Abbruch');
  ende();
}

console.log('\n[c) Liegender unsichtbar: Helfer geht]');
{
  // Wand zwischen Spieler (12,8) und Liegendem (20,8); der Trupp kennt den Spieler weiter (lastKnown/geteilt)
  const S = szene({ mods: MAUER, px: 12, py: 8, liegt: [20, 8], helfer: [[22, 10], [22, 6]] });
  const sicht = Aufr.sichtbarFuer(S.g, combat.env(S.g), S.liegt, Aufr.bekannteSpieler(S.g, S.s, S.alle()));
  ok(sicht.length === 0, 'Vorbedingung: Wand verdeckt den Liegenden (keine Sicht)');
  S.run(12);
  ok(S.st().aufrichten >= 1 && S.maxHelfer === 1, 'Helfer geht, genau einer (aufrichten ' + S.st().aufrichten + ', Maximum ' + S.maxHelfer + ')');
  ok(S.liegt.alive && S.liegt.zustand === 'ok', 'der Liegende steht wieder auf');
  ende();
  // zu weit: Spieler (2,8) mit Blaster, Liegender (20,8): 18 Kacheln
  const S2 = szene({ px: 2, py: 8, liegt: [20, 8], helfer: [[22, 10], [22, 6]] });
  S2.run(10);
  ok(S2.st().aufrichten >= 1, 'außerhalb der Spielerreichweite (18 Kacheln, Blaster): Helfer geht');
  ende();
  // Lanze: derselbe Abstand ist für einen Spieler mit Lanze Schussreichweite -> sichtbar -> niemand geht
  const S3 = szene({ px: 7, py: 8, liegt: [20, 8], helfer: [[22, 10], [22, 6]] });
  Wf.waffeSetzen(S3.g, S3.p, 'lanze');
  S3.run(10);
  ok((S3.st().aufrichten || 0) === 0 && S3.liegt.zustand === 'verwundet', 'Spieler mit Lanze (13 Kacheln): Liegender gilt als sichtbar, niemand geht');
  ende();
  // Sichtschutz: Deckungsblock 'O' neben dem Liegenden auf der Spielerseite (Los.coverAgainst)
  const S4 = szene({ mods: [[19, 8, 'O']], px: 15, py: 8, liegt: [20, 8], helfer: [[22, 10], [22, 6]] });
  S4.run(12);
  ok(S4.st().aufrichten >= 1, 'Sichtschutz (Deckung gegen den Spieler): zählt als nicht sichtbar, Helfer geht');
  ende();
}

console.log('\n[d) Helfer unter Feuer: Abbruch sofort]');
{
  for (const art of ['knapp', 'treffer']) {
    const S = szene(Object.assign({ nieder: [24, 8] }, OFFEN));
    let h = null;
    S.run(8, () => { if (!h) h = S.helfer.find((e) => e.role === 'aufrichten') || null; });
    ok(!!h, art + ': Vorbedingung: ein Helfer ist unterwegs/hilft');
    if (!h) { ende(); continue; }
    const vor = S.st().abgebrochen;
    if (art === 'knapp') Wf.knapp(S.g, h, { owner: S.p.id }, h.x, h.y); else { h.lastHitAt = S.g.time; }
    S.run(0.1);
    ok(h.role !== 'aufrichten' && !h.hilft && S.st().abgebrochen === vor + 1, art + ': Abbruch binnen 0,1 s (Rolle ' + h.role + ', abgebrochen ' + S.st().abgebrochen + ')');
    ok(h.role === 'pin' && !S.liegt.helfer && S.liegt.zustand === 'verwundet', art + ': Deckung (pin), Liegender bleibt liegen, Helfer frei');
    S.run(4);
    ok(rollen(S) === 0, art + ': Sperre: kein neuer Versuch binnen 4 s (sperreSek ' + AC.aufrichtenSicherung.sperreSek + ')');
    ende();
  }
}

console.log('\n[e) Sicherung entfällt: Abbruch]');
{
  const S = szene(Object.assign({ nieder: [24, 8] }, OFFEN));
  let h = null;
  S.run(8, () => { if (!h) h = S.helfer.find((e) => e.role === 'aufrichten') || null; });
  ok(!!h && S.liegt.zustand === 'verwundet', 'Vorbedingung: Helfer unterwegs (noch nicht aufgerichtet)');
  if (h) {
    const vor = S.st().abgebrochen;
    S.nieder.alive = false; S.nieder.zustand = 'aus';   // der Niederhalter fällt: Sicherung weg, Liegender weiter sichtbar
    S.run(3.5);
    ok(h.role !== 'aufrichten' && S.st().abgebrochen === vor + 1, 'Abbruch wegen fehlender Sicherung (abgebrochen ' + S.st().abgebrochen + ')');
    ok(S.liegt.zustand === 'verwundet' && S.st().aufrichtenTod === 0, 'Liegender bleibt liegen, kein Tod ohne Sicherung');
  }
  ende();
}

// ---------- f) Messlauf Grabenangriff: Spieler mit Lanze schießen gezielt, Liegende entstehen ----------
function grabenLauf(seed, sek, o) {
  const g = new Game({ noStore: true, seed, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 3; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 50) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); cs.push(c); }
  g.lobbyOpts.startMission = 'arena_graben';
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const S = g.arena && g.arena.wellen;
  if (!S) throw new Error('Grabenangriff nicht gestartet (seed ' + seed + ')');
  const tk = (s) => { for (let i = 0; i < Math.round(s * CONFIG.tickHz); i++) g.step(); };
  tk(0.5);
  const aw = g.aways[S.lp]; const E = combat.env(g);
  for (const p of g.players) Wf.waffeSetzen(g, p, 'lanze');
  let seq = 0, liegend = 0; const gesehen = new Set();
  const nTick = Math.round(sek * CONFIG.tickHz);
  for (let t = 0; t < nTick; t++) {
    if (t % 6 === 0) g.players.forEach((p, i) => {   // Abzugsstrom alle 0,2 s (Lanze: Zielen halten, bei Bereit loslassen); laufen bis Kachel 22, dann stehen
      const mx = Physics.toTile(p.x, p.y).x < 22 ? 1 : 0;
      if (t % 30 === 0) g.handleMessage(cs[i], { t: 'input', seq: ++seq, mx, my: 0 });
      if (mx) return;
      const ziele = aw.drones.filter((e) => e.alive && !e.asleep && Math.hypot(e.x - p.x, e.y - p.y) <= 20 * TILE && combat.losBetween(E, p, e))
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      if (!ziele[0]) return;
      const a = Math.atan2(ziele[0].y - p.y, ziele[0].x - p.x);
      g.handleMessage(cs[i], { t: 'shoot', angle: a });
      if (p.ladung && Wf.bereit(p)) g.handleMessage(cs[i], { t: 'shoot', angle: a, los: true });
    });
    g.step();
    for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
    for (const e of aw.drones) if (!e.alive && e.liegt && e.zustand === 'verwundet' && !gesehen.has(e.id)) { gesehen.add(e.id); liegend++; }
  }
  const st = Object.assign({ aufrichten: 0, aufgerichtet: 0, abgebrochen: 0, aufrichtenTod: 0, aufrichtenTodBlind: 0, todGesichert: 0 }, aw.truppStats || {});
  const fehler = Array.isArray(g.errors) ? g.errors.length : g.errors | 0;
  return { seed, st, liegend, fehler };
}
function messlauf(seeds, sek, titel) {
  const sum = { aufrichten: 0, aufgerichtet: 0, abgebrochen: 0, aufrichtenTod: 0, aufrichtenTodBlind: 0, todGesichert: 0, liegend: 0, fehler: 0 };
  for (let s = 1; s <= seeds; s++) {
    const r = grabenLauf(s, sek);
    for (const k of Object.keys(sum)) sum[k] += k === 'liegend' ? r.liegend : k === 'fehler' ? r.fehler : r.st[k];
  }
  console.log(`  ${titel}: ${seeds} Seeds x ${sek} s: Liegende ${sum.liegend}, Versuche (aufrichten) ${sum.aufrichten}, aufgerichtet ${sum.aufgerichtet}, abgebrochen ${sum.abgebrochen}, Tod ohne Sicherung ${sum.aufrichtenTod}, Tod gesichert ${sum.todGesichert}, Tod unbekannter Schuetze (blind) ${sum.aufrichtenTodBlind}, Server-Fehler ${sum.fehler}`);
  return sum;
}

console.log('\n[f) Messlauf Grabenangriff, Spieler mit Lanze (laufen bis x 22, schießen gezielt)]');
{
  const seeds = arg('--seeds', 8), sek = arg('--sek', 120);
  restore();
  const neu = messlauf(seeds, sek, 'mit Sicherungsregel');
  ok(neu.liegend > 0, 'Vorbedingung: Liegende entstehen (' + neu.liegend + ')');
  ok(neu.aufrichten > 0, 'Aufrichten-Versuche kommen vor (' + neu.aufrichten + ')');
  ok(neu.aufrichtenTod === 0, 'kein Gegner fällt beim Aufrichten ohne Sicherung (aufrichtenTod ' + neu.aufrichtenTod + ')');
  ok(neu.fehler === 0, 'keine Server-Fehler');
  AC.aufrichtenSicherung.sichtPruefen = false; AC.aufrichtenSicherung.abbruchTreffer = false;
  const alt = messlauf(seeds, sek, 'Vergleich ohne Regel (sichtPruefen/abbruchTreffer aus)');
  restore();
  console.log(`  Vergleich: Tod ohne Sicherung ${alt.aufrichtenTod} (+ blind ${alt.aufrichtenTodBlind}) statt ${neu.aufrichtenTod} (+ blind ${neu.aufrichtenTodBlind}) bei Versuchen ${alt.aufrichten} statt ${neu.aufrichten}`);
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'Alles ok (' + n + ' Prüfungen)'));
process.exit(fails ? 1 : 0);
