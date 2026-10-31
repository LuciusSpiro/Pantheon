'use strict';
// BOD-02 P1: Lanze als Laserkanone mit Zielfenster (server/sim/waffen.js, Konfig awayCombat.waffen.lanze). Headless gegen die Game-Klasse.
//   - unter zielfenster.min: Loslassen = Abbruch ohne Schuss, ohne Hitze und ohne Abklingzeit
//   - zwischen min und max: Loslassen schießt; bei max schießt sie von selbst (Spieler und Gegner gleich)
//   - Strahl trifft sofort, reicht immer volle Reichweite, durchschlägt Körper (auch Kameraden, nie den Schützen); Volldeckung stoppt ihn
//   - Halbdeckung (o): stehend durchschlagen, geduckt sicher (Schussreihe); fester Schaden, per tune änderbar
//   - Treffer und Bewegen am Schützen brechen das Zielen ab; KI-Schütze folgt derselben Regel; Bereit-Signal (lanzeBereit, ch)
//   node tools/test-lanze-zielfenster.js
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const Wf = require('../server/sim/waffen.js');
const W = require('../server/world.js');
const KACHELN = require('../content/buehnen/kacheln.json').zeichen;

Wf.aktiv = true;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TILE = Physics.TILE;
const AC = CONFIG.awayCombat;
const LAN = AC.waffen.lanze;
const ORIG = JSON.parse(JSON.stringify(LAN));
const restore = () => { Object.assign(LAN, JSON.parse(JSON.stringify(ORIG))); };
const LP = 'test.lanze';
const ZEILE = 4;   // alle Schüsse laufen entlang dieser Kachelzeile

// Testkarte 40 x 12: offen, Rand Wand; `mods` = [[tx, ty, zeichen], …]
function karte(mods) {
  const grid = [];
  for (let y = 0; y < 12; y++) { const r = []; for (let x = 0; x < 40; x++) r.push((x === 0 || y === 0 || x === 39 || y === 11) ? '#' : '.'); grid.push(r); }
  for (const [x, y, ch] of mods || []) grid[y][x] = ch;
  const rows = grid.map((r) => r.join(''));
  const legende = {};
  for (const r of rows) for (const ch of r) legende[ch] = KACHELN[ch];
  const A = (id, rolle, x, y, extra) => Object.assign({ id, rolle, x, y, platz: id.split('.')[0], bereich: null }, extra || {});
  return { id: LP, erzeuger: 'modul/1', art: 'aussenposten', bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt', seed: 2, bauversion: 'test',
    schablone: null, spiegel: null, w: 40, h: 12, rows, legende, anker: [A('lz.abholpunkt', 'abholpunkt', 2, 9, { ankunft: true, bereich: 'lz' })],
    bereiche: { lz: { name: 'Landezone', rects: [[1, 8, 6, 3]], rolle: 'hinein', gefecht: false } },
    plaetze: {}, eingaenge: [], abholpunkte: ['lz.abholpunkt'], ankunft: 'lz.abholpunkt',
    patrouillen: [], coverSpots: [], decks: null, kanten: {}, gelaende: null, meta: {} };
}
// Szene: `spieler` Spieler (Mehrspieler), Gegner nur auf Zuruf; Zeitstempel für alle Ereignisse
function szene(spieler, mods) {
  restore();
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < spieler; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'L' + i, name: 'L' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  W.AWAY_MAPS[LP] = { id: LP, karte: karte(mods) };
  g.aways[LP] = away.makeLandepunkt(g, LP);
  g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  const aw = g.aways[LP];
  aw.drones.length = 0;
  const S = { g, conns, aw, stamps: [], gesehen: 0 };
  S.P = (i) => g.players[i];
  S.place = (i, tx, ty) => { const p = S.P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; p.crouch = false; };
  S.lanze = (i) => { const p = combat.kaempfer(g, S.P(i)); p.waffe = 'lanze'; p.hitze = 0; p.gesperrtBis = 0; p.ladung = null; p.shield.seg = 3; return p; };
  S.run = (sek, each) => {
    for (let k = 0; k < Math.round(sek * 30); k++) {
      g.step();
      const inbox = conns[0].inbox;
      for (; S.gesehen < inbox.length; S.gesehen++) S.stamps.push({ t: g.time, m: inbox[S.gesehen] });
      for (const p of g.players) if (p.shield) p.shield.seg = Math.max(p.shield.seg, p.shield.seg);   // 
      if (each) each();
    }
  };
  S.ev = (kind) => S.stamps.filter((s) => s.m.kind === kind);
  S.gegner = (rolle, tx, ty, opts) => {
    const e = squad.makeEnemy(g, aw, squad.TYP_KIND[rolle] || 'scavenger', 'G' + g.nextId(''), Physics.tileCenter(tx, ty), (opts && opts.trupp) || 'test');
    e.rolle = rolle; e.asleep = false; e.frozen = !(opts && opts.frei);
    if (!aw.squads[e.squad]) aw.squads[e.squad] = squad.newSquad(e.squad, 1);
    aw.drones.push(e);
    combat.kaempfer(g, e);
    return e;
  };
  S.winkel = (von, tx, ty) => { const c = Physics.tileCenter(tx, ty); return Math.atan2(c.y - von.y, c.x - von.x); };
  // zielen (Strom im Takt, wie der Client), nach `sek` loslassen (los: true) bzw. nichts tun (sek null)
  S.zielen = (p, ang, sek) => {
    const t0 = g.time;
    away.shoot(g, p, ang);
    S.run(sek, () => { if (Math.round((g.time - t0) * 30) % 8 === 0) away.shoot(g, p, ang); });
  };
  S.los = (p, ang) => away.shoot(g, p, ang, { los: true });
  return S;
}
const ende = () => { restore(); delete W.AWAY_MAPS[LP]; };
const segE = (e) => (e.seg != null ? e.seg : e.schild.seg);

console.log('\n[Konfig: Zielfenster statt Stufen]');
{
  ok(LAN.zielfenster && LAN.zielfenster.min === 0.5 && LAN.zielfenster.max === 1.0, 'zielfenster { min 0,5, max 1,0 }');
  ok(LAN.schaden === 2 && LAN.reichweite === 22 && LAN.laden === undefined && !Array.isArray(LAN.schaden), 'fester Schaden 2, Reichweite 22, keine Ladestufen mehr');
  ok(Wf.art(LAN) === 'lanze', 'Waffenart wird am Zielfenster erkannt');
}

console.log('\n[Abbruch vor 0,5 s: kein Schuss, keine Hitze, keine Abklingzeit]');
{
  const S = szene(1); const p = S.lanze(0); S.place(0, 3, ZEILE);
  const e = S.gegner('grundtyp', 12, ZEILE);
  const ang = S.winkel(p, 12, ZEILE);
  S.zielen(p, ang, 0.3);
  ok(p.ladung && !p.ladung.bereit && S.ev('ladungLanze').length === 1, 'Taste gehalten (0,3 s): Ziellinie, noch nicht bereit');
  S.los(p, ang); S.run(0.1);
  ok(!p.ladung && S.ev('lanzeSchuss').length === 0 && segE(e) === 3, 'Loslassen bei 0,3 s: kein Schuss, Gegner unberührt');
  ok(p.hitze === 0 && !Wf.ueberhitzt(g(S), p) && Wf.kannFeuern(g(S), p) === null && (p.schussAt == null || p.schussAt < 0), 'keine Hitze, keine Sperre, sofort wieder bereit zum Feuern (keine Abklingzeit)');
  ok(Wf.feuern(g(S), p, { angle: ang }) === null && p.ladung && p.ladung.t === 0, 'neues Zielen sofort möglich');
  ende();
}
function g(S) { return S.g; }

console.log('\n[Loslassen im Zielfenster (0,5 bis 1,0 s) schießt; Bereit-Signal]');
{
  const S = szene(1); const p = S.lanze(0); S.place(0, 3, ZEILE);
  const e = S.gegner('grundtyp', 12, ZEILE);
  const ang = S.winkel(p, 12, ZEILE);
  S.zielen(p, ang, 0.4);
  ok(S.ev('lanzeBereit').length === 0 && !Wf.bereit(p), 'bei 0,4 s: noch kein Bereit-Signal');
  S.run(0.2);
  const ch = Wf.snapFelder(S.g, p).ch;
  ok(Wf.bereit(p) && S.ev('lanzeBereit').length === 1 && S.ev('lanzeBereit')[0].m.id === p.id, 'ab 0,5 s: bereit (Ereignis lanzeBereit, einmal)');
  ok(ch >= 50 && ch < 100, 'Snapshot ch läuft über das Zielfenster (' + ch + ' %, bereit ab 50 %)');
  S.los(p, ang); S.run(0.1);
  ok(S.ev('lanzeSchuss').length === 1 && !p.ladung, 'Loslassen bei 0,6 s: Schuss');
  ok(segE(e) === 1, 'Schaden 2 (Schild 3 → 1)');
  ok(p.hitze === 1 && Wf.ueberhitzt(S.g, p), 'ein Schuss = 100 % Hitze, danach Sperre');
  ende();
}

console.log('\n[Auto-Schuss bei 1,0 s]');
{
  const S = szene(1); const p = S.lanze(0); S.place(0, 3, ZEILE);
  const e = S.gegner('grundtyp', 12, ZEILE);
  const ang = S.winkel(p, 12, ZEILE);
  S.zielen(p, ang, 0.9);
  ok(S.ev('lanzeSchuss').length === 0 && p.ladung, 'bei 0,9 s noch kein Schuss');
  // Strom nicht weiterführen: Auto-Schuss kommt von waffen.update, nicht vom Loslassen
  away.shoot(S.g, p, ang);
  S.run(0.2);
  const sch = S.ev('lanzeSchuss'); const beg = S.ev('ladungLanze')[0].t;
  ok(sch.length === 1 && sch[0].m.auto === 1, 'Spieler hält weiter: Schuss von selbst (auto)');
  ok(sch[0].t - beg >= 1.0 - 0.05 && sch[0].t - beg <= 1.15, 'Auto-Schuss nach ' + (Math.round((sch[0].t - beg) * 100) / 100) + ' s (Soll 1,0)');
  ok(segE(e) === 1, 'Auto-Schuss trifft');
  ende();
}

console.log('\n[Strahl: volle Reichweite, durchschlägt Körper, eigene Leute getroffen]');
{
  const S = szene(2); const p = S.lanze(0); S.place(0, 3, ZEILE); S.place(1, 8, ZEILE);
  const kam = S.P(1);
  const e1 = S.gegner('grundtyp', 12, ZEILE), e2 = S.gegner('grundtyp', 18, ZEILE);
  const nebenan = S.gegner('grundtyp', 15, ZEILE + 2);
  const ang = 0;
  S.zielen(p, ang, 0.6); S.los(p, ang); S.run(0.1);
  const sch = S.ev('lanzeSchuss')[0];
  ok(sch && Math.abs((sch.m.tx - sch.m.x) - LAN.reichweite * TILE) < 2 && Math.abs(sch.m.ty - sch.m.y) < 2, `Strahl endet nach ${LAN.reichweite} Kacheln (Endpunkt ${sch && sch.m.tx})`);
  ok(segE(e1) === 1 && segE(e2) === 1, 'beide Gegner in einer Linie getroffen');
  ok(kam.shield.seg === 1, 'Kamerad auf der Linie ebenfalls getroffen (Friendly Fire)');
  ok(p.shield.seg === 3, 'der Schütze selbst nicht');
  ok(segE(nebenan) === 3, 'wer nicht auf der Linie steht, bleibt unberührt');
  // Strahl reicht immer: Zielpunkt dicht vor dem Schützen ändert die Länge nicht
  p.hitze = 0; p.gesperrtBis = 0; S.P(1).shield.seg = 3;
  S.run(0.2);
  away.shoot(S.g, p, ang, { dist: 2 }); S.run(0.6); S.los(p, ang); S.run(0.1);
  const sch2 = S.ev('lanzeSchuss')[1];
  ok(sch2 && Math.abs((sch2.m.tx - sch2.m.x) - LAN.reichweite * TILE) < 2, 'auch mit kurzem Zielabstand (dist) volle Länge');
  ende();
}

console.log('\n[Volldeckung stoppt den Strahl, Endpunkt = Wand]');
{
  const S = szene(1, [[10, ZEILE, '#']]); const p = S.lanze(0); S.place(0, 3, ZEILE);
  const davor = S.gegner('grundtyp', 7, ZEILE), dahinter = S.gegner('grundtyp', 13, ZEILE);
  S.zielen(p, 0, 0.6); S.los(p, 0); S.run(0.1);
  const m = S.ev('lanzeSchuss')[0].m;
  ok(segE(davor) === 1 && segE(dahinter) === 3, 'Gegner vor der Wand getroffen, dahinter nicht');
  ok(Math.abs(m.tx - 10 * TILE) <= 2 && Math.abs(m.ty - Physics.tileCenter(10, ZEILE).y) <= 2, `Endposition tx,ty = Wand (${m.tx}, ${m.ty}; Wandkante ${10 * TILE})`);
  ende();
}

console.log('\n[Halbdeckung o: stehend durchschlagen, geduckt sicher (Schussreihe)]');
{
  const N = 200;
  // Schütze links, Halbdeckung o bei x 12, Ziel direkt dahinter (x 13)
  const reihe = (geduckt) => {
    const S = szene(2, [[12, ZEILE, 'o']]); const p = S.lanze(0); S.place(0, 3, ZEILE); S.place(1, 13, ZEILE);
    const ziel = S.P(1);
    if (geduckt) combat.setCrouch(S.g, ziel, true);
    let treffer = 0;
    for (let i = 0; i < N; i++) {
      ziel.shield.seg = 3; ziel.zustand = 'ok'; ziel.downed = false;
      p.hitze = 0; p.gesperrtBis = 0; p.ladung = null; p.shield.seg = 3;
      if (geduckt && !ziel.crouch) combat.setCrouch(S.g, ziel, true);
      away.shoot(S.g, p, 0);   // wie der Client: Strom im Takt, dann loslassen
      for (let k = 0; k < 16; k++) { if (k === 8) away.shoot(S.g, p, 0); S.g.step(); }
      away.shoot(S.g, p, 0, { los: true });
      if (ziel.shield.seg < 3) treffer++;
    }
    const crouchBlieb = !geduckt || ziel.crouch;
    ende();
    return { treffer, crouchBlieb };
  };
  const stehend = reihe(false), geduckt = reihe(true);
  ok(stehend.treffer === N, `stehend hinter o: ${stehend.treffer}/${N} Treffer (Lanze durchschlägt Halbdeckung)`);
  ok(geduckt.crouchBlieb && geduckt.treffer === 0, `geduckt hinter o: ${geduckt.treffer}/${N} Treffer (sicher)`);
  // Gegner geduckt hinter o ist ebenso sicher (gleiche Regel für beide Seiten)
  const S = szene(1, [[12, ZEILE, 'o']]); const p = S.lanze(0); S.place(0, 3, ZEILE);
  const e = S.gegner('grundtyp', 13, ZEILE); e.crouch = true;
  S.zielen(p, 0, 0.6); S.los(p, 0); S.run(0.1);
  ok(S.ev('lanzeSchuss').length === 1 && segE(e) === 3, 'geduckter Gegner hinter o: sicher');
  e.crouch = false; p.hitze = 0; p.gesperrtBis = 0; S.run(0.1);
  S.zielen(p, 0, 0.6); S.los(p, 0); S.run(0.1);
  ok(segE(e) === 1, 'derselbe Gegner stehend: getroffen');
  // o neben der Linie schützt nicht, Geduckter ohne Deckung ist getroffen
  const S2 = szene(2, []); const p2 = S2.lanze(0); S2.place(0, 3, ZEILE); S2.place(1, 13, ZEILE);
  combat.setCrouch(S2.g, S2.P(1), true);
  S2.zielen(p2, 0, 0.6); S2.los(p2, 0); S2.run(0.1);
  ok(S2.P(1).shield.seg === 1, 'geduckt ohne Halbdeckung: getroffen');
  ende();
}

console.log('\n[Fester Schaden 2, per tune änderbar]');
{
  const S = szene(1); const p = S.lanze(0); S.place(0, 3, ZEILE);
  const e = S.gegner('grundtyp', 12, ZEILE);
  const r = combat.tune(S.g, 'waffen.lanze.schaden', 1);
  ok(r.ok && S.g.C.awayCombat.waffen.lanze.schaden === 1, 'tune waffen.lanze.schaden 1 ' + (r.text || ''));
  S.zielen(p, 0, 0.6); S.los(p, 0); S.run(0.1);
  ok(segE(e) === 2, 'mit schaden 1: Schild 3 → 2');
  const r2 = combat.tune(S.g, 'waffen.lanze.zielfenster.min', 0.8);
  ok(r2.ok && S.g.C.awayCombat.waffen.lanze.zielfenster.min === 0.8, 'tune waffen.lanze.zielfenster.min 0.8 (Fenster per tune änderbar)');
  p.hitze = 0; p.gesperrtBis = 0; S.run(0.1);
  S.zielen(p, 0, 0.6); S.los(p, 0); S.run(0.1);
  ok(S.ev('lanzeSchuss').length === 1 && !p.ladung, 'mit min 0,8: Loslassen bei 0,6 s ist jetzt ein Abbruch');
  ok(combat.tuneList(S.g.C.awayCombat).includes('lanze.schaden=1') && combat.tuneList(S.g.C.awayCombat).includes('lanze.zielfenster.min=0.8'), 'tune-Liste kennt schaden und zielfenster.min/max');
  ende();
}

console.log('\n[Treffer und Bewegen am Schützen brechen das Zielen ab]');
{
  const S = szene(1); const p = S.lanze(0); S.place(0, 3, ZEILE);
  const e = S.gegner('grundtyp', 12, ZEILE);
  S.zielen(p, 0, 0.3);
  ok(p.ladung, 'zielt');
  Wf.treffer(S.g, p, { waffe: 'blaster', schaden: 1 }, { team: 'feind', x: e.x, y: e.y });
  ok(!p.ladung && p.unterbrochen && p.unterbrochen.grund === 'treffer', 'Treffer am Schützen: Abbruch');
  p.hitze = 0;
  S.run(0.5); S.los(p, 0); S.run(0.1);
  ok(S.ev('lanzeSchuss').length === 0 && segE(e) === 3 && p.hitze === 0, 'danach kein Schuss, keine Hitze');
  // Bewegen
  away.shoot(S.g, p, 0); S.run(0.2); p.x += 12; S.run(0.1);
  ok(!p.ladung && p.unterbrochen.grund === 'bewegt', 'Bewegen bricht ab (stehen: true)');
  ende();
}

console.log('\n[KI-Schütze: dieselbe Regel (hält die Ziellinie, löst im Zielfenster, Auto-Schuss bei max)]');
{
  const S = szene(1); const p = S.P(0); S.place(0, 6, ZEILE);
  const sz = S.gegner('schuetze', 15, ZEILE, { trupp: 's', frei: true }); S.aw.squads.s.alert = true;
  sz.shootTarget = p.id;
  let drift = 0, pos0 = null, gezielt = false;
  S.run(8, () => { if (!sz.ladung) pos0 = null; else { gezielt = true; if (!pos0) pos0 = { x: sz.x, y: sz.y }; drift = Math.max(drift, Math.hypot(sz.x - pos0.x, sz.y - pos0.y)); } p.shield.seg = 3; if (p.downed) combat.revive(S.g, p, 3, { quiet: true }); });
  const lad = S.ev('ladungLanze').filter((s) => s.m.id === sz.id), bereit = S.ev('lanzeBereit').filter((s) => s.m.id === sz.id), sch = S.ev('lanzeSchuss').filter((s) => s.m.id === sz.id);
  ok(lad.length >= 1 && bereit.length >= 1 && sch.length >= 1, 'Schütze zielt (ladungLanze), wird bereit (lanzeBereit) und schießt (lanzeSchuss)');
  ok(lad[0].t <= bereit[0].t && bereit[0].t <= sch[0].t, 'Reihenfolge: Zielen, bereit, Schuss');
  ok(bereit[0].t - lad[0].t >= LAN.zielfenster.min - 0.05, 'Zielfenster: bereit erst nach ' + (Math.round((bereit[0].t - lad[0].t) * 100) / 100) + ' s (min ' + LAN.zielfenster.min + ')');
  ok(sch[0].t - lad[0].t >= LAN.zielfenster.min - 0.05 && sch[0].t - lad[0].t <= LAN.zielfenster.max + 0.1, 'Schuss ' + (Math.round((sch[0].t - lad[0].t) * 100) / 100) + ' s nach Zielbeginn (Fenster ' + LAN.zielfenster.min + '–' + LAN.zielfenster.max + ')');
  ok(Math.abs(sch[0].m.tx - sch[0].m.x) > LAN.reichweite * TILE - 5 || Math.abs(sch[0].m.ty - sch[0].m.y) > 1, 'KI-Strahl: volle Länge');
  ok(gezielt && drift < 3, 'Schütze bleibt beim Zielen stehen');
  // Auto-Schuss des Gegners: festgehaltene Ziellinie ohne Auslöser schießt bei max von selbst
  const S2 = szene(1); S2.place(0, 6, ZEILE);
  const e2 = S2.gegner('schuetze', 18, ZEILE);
  Wf.feuern(S2.g, e2, { angle: Math.PI });
  S2.run(1.3);
  const s2 = S2.ev('lanzeSchuss').filter((s) => s.m.id === e2.id), l2 = S2.ev('ladungLanze').filter((s) => s.m.id === e2.id);
  ok(s2.length === 1 && s2[0].m.auto === 1 && s2[0].t - l2[0].t <= LAN.zielfenster.max + 0.1, 'Gegner mit Lanze: Auto-Schuss bei ' + LAN.zielfenster.max + ' s');
  ok(S2.P(0).shield.seg === 1, 'Strahl des Gegners trifft den Spieler mit Schaden 2 (Schild 3 → 1)');
  ende();
}

console.log('\n[Gegner zwei in einer Linie und Kamerad: Gegner-Strahl durchschlägt auch die eigene Seite]');
{
  const S = szene(1); S.place(0, 6, ZEILE);
  const e1 = S.gegner('schuetze', 18, ZEILE), e2 = S.gegner('grundtyp', 12, ZEILE);
  Wf.feuern(S.g, e1, { angle: Math.PI });
  S.run(1.3);
  ok(segE(e2) === 1 || e2.alive === false, 'eigener Kamerad des Schützen auf der Linie wird getroffen (Friendly Fire gilt für alle)');
  ende();
}

console.log(`\ntest-lanze-zielfenster: ${n - fails}/${n} Prüfungen bestanden${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
