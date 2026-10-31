'use strict';
// BOD-02 P7: Trupp-Gehirn (server/sim/trupp.js, CONFIG.awayCombat.truppGehirn, squad.js Einhängestellen).
//   1) Aufgabenverteilung (Einheit): Rollenmix, ohne Sturmgewehr, 2 Gegner, ohne Allrounder; Stabilität, Neuverteilung bei Tod
//   2) Headless-Szene: Verteilung im laufenden Gefecht stabil (kein Flackern), Neuverteilung bei Tod, Scharfschütze auf Distanz,
//      kein Gehirn für ruhige Trupps/Einzelne, Wächter unberührt
//   3) Flankenschutz: Spieler geht in den Flankensektor -> Funkspruch flanke_umgangen, Trupp-bedrohung, Mitglieder wählen neu, Ziel = Umgehender
//   4) Funktexte aller Fraktionen (Katalog gegner/*.json inkl. funk_nach_fraktion.rom)
//   5) Messlauf (tools/mess-klumpen.js): Anteil Gefechts-Samples mit gültiger Verteilung, Klumpen nicht schlechter als P5
//   node tools/test-trupp-gehirn.js
const path = require('path');
const { spawnSync } = require('child_process');
const Physics = require('../shared/physics.js');
const Los = require('../shared/los.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const Wf = require('../server/sim/waffen.js');
const Trupp = require('../server/sim/trupp.js');
const W = require('../server/world.js');
const KACHELN = require('../content/buehnen/kacheln.json').zeichen;

Wf.aktiv = true;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TILE = Physics.TILE;
const LP = 'test.trupp';
const AC = CONFIG.awayCombat;
const ORIG = JSON.parse(JSON.stringify(AC.truppGehirn));

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
// Deckungsblöcke (volle Deckung 'O'): zwei Reihen quer zum Gefecht, dazu Blöcke an der Nord- und Südseite des Trupps
const BLOECKE = [];
for (const [x, y] of [[18, 5], [18, 8], [18, 11], [18, 14], [22, 4], [22, 7], [22, 10], [22, 13], [26, 6], [26, 9], [26, 12],
  [24, 2], [28, 3], [20, 15], [30, 8], [14, 6], [14, 11], [30, 12], [32, 5]]) BLOECKE.push([x, y, 'O']);

function szene(spieler, mods) {
  Object.assign(AC.truppGehirn, JSON.parse(JSON.stringify(ORIG)));
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < spieler; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'T' + i, name: 'T' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  W.AWAY_MAPS[LP] = { id: LP, karte: karte(mods) };
  g.aways[LP] = away.makeLandepunkt(g, LP);
  g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  const aw = g.aways[LP];
  aw.drones.length = 0;
  const S = { g, conns, aw, barks: [], tick: 0 };
  const emit = g.emit;
  g.emit = function (t, d) { if (t === 'bark') S.barks.push(Object.assign({ t: g.time }, d)); return emit.apply(this, arguments); };
  S.P = (i) => g.players[i];
  S.place = (i, tx, ty) => { const p = S.P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; p.crouch = false; };
  S.run = (sek, each) => {
    for (let k = 0; k < Math.round(sek * 30); k++) {
      g.step(); S.tick++;
      for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
      if (each) each();
    }
  };
  S.gegner = (rolle, tx, ty, trupp) => {
    const e = squad.makeEnemy(g, aw, squad.TYP_KIND[rolle] || 'scavenger', 'G' + g.nextId(''), Physics.tileCenter(tx, ty), trupp || 't1');
    e.rolle = rolle === 'grundtyp' ? undefined : rolle; e.asleep = false;
    if (!aw.squads[e.squad]) aw.squads[e.squad] = squad.newSquad(e.squad, 1);
    aw.drones.push(e);
    combat.kaempfer(g, e);
    return e;
  };
  S.alarm = (name) => { squad.alertSquad(g, aw, aw.squads[name || 't1']); };
  return S;
}
const ende = () => { delete W.AWAY_MAPS[LP]; Object.assign(AC.truppGehirn, JSON.parse(JSON.stringify(ORIG))); };
const kachel = (e) => Physics.toTile(e.x, e.y);
const zaehle = (ds, task) => ds.filter((e) => e.aufgabe === task).length;
const dummy = (rolle, id) => ({ id, rolle: rolle === 'grundtyp' ? undefined : rolle });
const verteilung = (rollen) => { const ms = rollen.map((r, i) => dummy(r, 'M' + i)); const m = Trupp.verteile(ms); return ms.map((e) => m.get(e)); };

console.log('\n[Config]');
{
  const T = AC.truppGehirn;
  ok(T && T.hz > 0 && T.haltezeit >= 4 && T.flankeWinkel === 50 && T.flankeKacheln === 14 && T.scharfAbstand >= 7, 'awayCombat.truppGehirn vorhanden (hz, haltezeit, flankeWinkel 50, flankeKacheln 14, scharfAbstand >= 7)');
  ok(Trupp.AUFGABEN.join() === 'niederhalten,scharf,unterstuetzung,flanke,sturm,allround,gegenstoss', 'fester Aufgabensatz (BOD-02 P9: gegenstoss ergänzt, wird nur für Trupps mit Verteidigungsprofil vergeben)');
}

console.log('\n[Verteilung: Rollenmix 5 (Lanze, Granatwerfer, Sturmgewehr, 2 Blaster)]');
{
  const v = verteilung(['schuetze', 'grenadier', 'niederhalter', 'grundtyp', 'grundtyp']);
  ok(v.join() === 'scharf,unterstuetzung,niederhalten,flanke,allround', 'Lanze scharf, Granatwerfer unterstuetzung, Sturmgewehr niederhalten, ein Blaster flanke, einer allround (' + v.join() + ')');
  ok(verteilung(['grundtyp', 'grundtyp', 'niederhalter', 'grenadier', 'schuetze']).join() === 'flanke,allround,niederhalten,unterstuetzung,scharf', 'unabhängig von der Reihenfolge der Liste (erster Blaster: flanke)');
}
console.log('\n[Verteilung: ohne Sturmgewehr]');
{
  const v = verteilung(['schuetze', 'grenadier', 'grundtyp', 'grundtyp', 'grundtyp']);
  ok(v.filter((x) => x === 'niederhalten').length === 1 && v.filter((x) => x === 'flanke').length === 1 && v[0] === 'scharf' && v[1] === 'unterstuetzung', 'ein Blaster-Träger übernimmt niederhalten, einer flanke, Rollen bleiben (' + v.join() + ')');
  const v2 = verteilung(['grundtyp', 'grundtyp', 'niederhalter', 'niederhalter']);
  ok(v2.filter((x) => x === 'flanke').length === 1 && v2.filter((x) => x === 'niederhalten').length >= 1, 'Legionäre/Blaster füllen die Flanke, Niederhalter halten nieder (' + v2.join() + ')');
  const v3 = verteilung(['schuetze', 'grenadier', 'niederhalter', 'enterer']);
  ok(v3.includes('niederhalten') && v3.includes('flanke') && v3[0] === 'scharf', 'ohne Allrounder: der Stürmer übernimmt die Flanke, Lanze bleibt scharf (' + v3.join() + ')');
  const v4 = verteilung(['schuetze', 'schuetze', 'grenadier', 'grenadier']);
  ok(v4.includes('niederhalten') && v4.includes('flanke') && v4.filter((x) => x === 'scharf').length >= 1, 'nur Fernkämpfer: doppelt besetzte Rolle gibt ab, mindestens ein Scharfschütze bleibt (' + v4.join() + ')');
}
console.log('\n[Verteilung: 2 und 3 Gegner (keine Pflichtaufgaben)]');
{
  ok(verteilung(['grundtyp', 'grundtyp']).join() === 'allround,allround', '2 Blaster: beide allround');
  ok(verteilung(['niederhalter', 'schuetze']).join() === 'niederhalten,scharf', '2 Gegner: nur Rollen-Aufgaben');
  ok(verteilung(['grundtyp', 'grundtyp', 'grundtyp']).join() === 'allround,allround,allround', '3 Blaster: allround (Lückenfüllen erst ab 4)');
}

console.log('\n[Headless: Verteilung im Gefecht, Stabilität, Tod]');
{
  const S = szene(2, BLOECKE);
  S.place(0, 12, 8); S.place(1, 12, 10);
  const ds = [S.gegner('schuetze', 24, 8), S.gegner('grenadier', 25, 9), S.gegner('niederhalter', 26, 7), S.gegner('grundtyp', 25, 10), S.gegner('grundtyp', 27, 9)];
  const wach = S.gegner('waechter', 40, 2, 'warden'); wach.kind = 'warden'; wach.asleep = true;
  S.alarm();
  const wechsel = new Map(ds.map((e) => [e.id, 0])); const letzte = new Map();
  let gueltigTicks = 0, messTicks = 0;
  S.run(10, () => {
    for (const e of ds) { if (e.aufgabe && letzte.has(e.id) && letzte.get(e.id) !== e.aufgabe) wechsel.set(e.id, wechsel.get(e.id) + 1); if (e.aufgabe) letzte.set(e.id, e.aufgabe); }
    if (S.tick > 60) { messTicks++; if (zaehle(ds, 'niederhalten') >= 1 && zaehle(ds, 'flanke') >= 1 && zaehle(ds, 'scharf') === 1) gueltigTicks++; }
  });
  const s = S.aw.squads.t1;
  ok(ds.every((e) => Trupp.AUFGABEN.includes(e.aufgabe)), 'jedes Mitglied hat eine Aufgabe aus dem festen Satz (' + ds.map((e) => e.aufgabe).join() + ')');
  ok(ds[0].aufgabe === 'scharf' && ds[1].aufgabe === 'unterstuetzung' && ds[2].aufgabe === 'niederhalten' && zaehle(ds.slice(3), 'flanke') === 1, 'Aufgaben nach Rollenprofil, ein Blaster sichert die Flanke');
  ok(gueltigTicks === messTicks && messTicks > 100, 'in jedem Tick: >= 1 niederhalten, >= 1 flanke, genau ein scharf (' + gueltigTicks + '/' + messTicks + ')');
  ok([...wechsel.values()].every((k) => k === 0), 'kein Flackern: keine Aufgabe wechselt über 10 s (Wechsel ' + [...wechsel.values()].join() + ')');
  ok(s.aufgaben && Object.keys(s.aufgaben).length === 5, 'Debug: aw.squads[..].aufgaben listet alle 5');
  ok(wach.aufgabe == null, 'Wächter bekommt keine Aufgabe');
  // Tod des Flankenschutzes: nur dieser Posten wird neu vergeben, alle anderen behalten ihre Aufgabe
  const flk = ds.find((e) => e.aufgabe === 'flanke');
  const vorher = new Map(ds.filter((e) => e !== flk).map((e) => [e.id, e.aufgabe]));
  flk.alive = false; squad.onEnemyDown(S.g, flk);
  S.run(2.5);
  const rest = ds.filter((e) => e.alive);
  ok(rest.length === 4 && zaehle(rest, 'niederhalten') >= 1 && zaehle(rest, 'flanke') === 1, 'Neuverteilung bei Tod: 4 Lebende haben weiter niederhalten und flanke (' + rest.map((e) => e.aufgabe).join() + ')');
  ok(rest.filter((e) => vorher.get(e.id) !== 'allround').every((e) => e.aufgabe === vorher.get(e.id)), 'wer eine Rollenaufgabe hatte, behält sie (Beharrung)');
  ok(rest.find((e) => e.aufgabe === 'flanke') && (rest.find((e) => e.aufgabe === 'flanke').rolle || 'grundtyp') === 'grundtyp', 'die Flanke übernimmt der Blaster-Träger (Allrounder)');
  for (const e of [ds[2], ds[3], ds[4]]) { e.alive = false; squad.onEnemyDown(S.g, e); }
  S.run(1.5);
  const rest2 = ds.filter((e) => e.alive);
  ok(rest2.length === 2 && rest2.map((e) => e.aufgabe).join() === 'scharf,unterstuetzung', 'bei 2 Lebenden nur noch Rollen-Aufgaben (' + rest2.map((e) => e.aufgabe).join() + ')');
  rest2[1].alive = false; squad.onEnemyDown(S.g, rest2[1]);
  S.run(1.2);
  ok(rest2[0].aufgabe === 'allround', 'ein Einzelner Lebender: allround (wie bisher)');
  ok(S.g.errors === 0 || !S.g.errors || (Array.isArray(S.g.errors) && !S.g.errors.length), 'keine Server-Fehler');
  ende();
}

console.log('\n[Ruhige Trupps und Einzelne]');
{
  const S = szene(1, BLOECKE);
  S.place(0, 6, 8);
  const ds = [S.gegner('niederhalter', 34, 8), S.gegner('grundtyp', 35, 9), S.gegner('grundtyp', 36, 7), S.gegner('grundtyp', 36, 10)];
  S.run(3);
  ok(ds.every((e) => e.aufgabe == null), 'nicht alarmierter Trupp: keine Aufgaben');
  const solo = S.gegner('grundtyp', 20, 16, 'solo'); S.alarm('solo');
  S.run(2);
  ok(solo.aufgabe === 'allround', 'alarmierter Einzelgegner: allround');
  ende();
}

console.log('\n[Scharfschütze steht auf Distanz]');
{
  const S = szene(1, BLOECKE);
  S.place(0, 12, 8);
  const ds = [S.gegner('schuetze', 20, 9), S.gegner('niederhalter', 26, 7), S.gegner('grundtyp', 25, 10), S.gegner('grundtyp', 27, 9)];
  S.alarm();
  const sch = ds[0]; let minD = Infinity; let n7 = 0, nGes = 0;
  S.run(12, () => {
    if (S.tick > 150) { nGes++; if (Math.hypot(sch.x - S.P(0).x, sch.y - S.P(0).y) >= 7 * TILE - TILE / 2) n7++; }   // Toleranz 0,5 Kachel: der Schütze bleibt beim Anlaufen kurz vor der Platzmitte stehen, das Zielfenster (K2: KI hält 0,8-1,0 s) verlängert diese Standzeit
    minD = Math.min(minD, Math.hypot(sch.x - S.P(0).x, sch.y - S.P(0).y));
  });
  ok(sch.aufgabe === 'scharf', 'Lanzenträger: Aufgabe scharf');
  ok(nGes > 50 && n7 / nGes >= 0.9, 'nach dem Einrücken hält der Scharfschütze >= 7 Kacheln Abstand (' + n7 + ' von ' + nGes + ' Ticks, Minimum ' + (minD / TILE).toFixed(1) + ')');
  ende();
}

console.log('\n[Unterstützung und Niederhalten: Feuer auf die letzte bekannte Position]');
{
  const S = szene(1, BLOECKE);
  S.place(0, 12, 8);
  const gr = S.gegner('grenadier', 22, 9), bl = [S.gegner('grundtyp', 24, 8), S.gegner('grundtyp', 25, 10), S.gegner('grundtyp', 26, 9), S.gegner('schuetze', 28, 8)];
  S.alarm();
  S.run(1.5);
  const nh = bl.find((e) => e.aufgabe === 'niederhalten');
  ok(gr.aufgabe === 'unterstuetzung' && nh, 'Granatwerfer unterstuetzung, ein Blaster-Träger niederhalten (ohne Sturmgewehr)');
  // Spieler verschwindet hinter einer Wand: nur die letzte bekannte Position bleibt
  const lk = squad.freshestKnown(S.aw.squads.t1);
  ok(!!lk, 'Trupp kennt die Position des Spielers');
  let granaten = 0, stoesse = 0; const e0 = nh;
  for (const e of [...bl, gr]) { e.sees = []; }
  const hide = Physics.tileCenter(2, 2); S.P(0).x = hide.x; S.P(0).y = hide.y;   // weit weg, nicht sichtbar
  S.aw.squads.t1.lastKnown[S.P(0).id] = { x: Physics.tileCenter(12, 8).x, y: Physics.tileCenter(12, 8).y, t: S.g.time };
  S.run(5, () => { if (gr.granatZiel && S.g.time - gr.granatZiel.t < 0.1) granaten++; if (e0.stoss > 0) stoesse++; });
  ok(granaten > 0 || (gr.unterdrueck && gr.role === 'pin'), 'Granatwerfer feuert ohne Sicht auf die letzte bekannte Position (granatZiel gesetzt: ' + granaten + ')');
  ok(stoesse > 0 || e0.unterdrueck, 'Blaster-Träger mit Aufgabe niederhalten hält Deckungsfeuer (Stoß-Ticks ' + stoesse + ')');
  ende();
}

console.log('\n[Flankenschutz: Umgehung, Funk, Umschwenken]');
function umgehungsszene() {
  const S = szene(2, BLOECKE);
  S.place(0, 10, 9); S.place(1, 10, 11);   // beide frontal im Westen
  const ds = [S.gegner('schuetze', 26, 9), S.gegner('grenadier', 27, 10), S.gegner('niederhalter', 28, 8), S.gegner('grundtyp', 27, 7), S.gegner('grundtyp', 28, 11)];
  S.alarm();
  return { S, ds };
}
{
  const { S, ds } = umgehungsszene();
  const s = S.aw.squads.t1;
  S.run(8);
  ok(s.achse != null && !s.bedrohung && S.barks.every((b) => b.cause !== 'flanke_umgangen'), 'frontale Spieler: Achse gesetzt, keine Umgehung, kein Flankenfunk');
  ok(!(S.aw.truppStats && S.aw.truppStats.umgangen), 'keine Umgehung gezählt');
  ende();
}
{
  const { S, ds } = umgehungsszene();
  const s = S.aw.squads.t1;
  S.run(5);
  const wache = ds.find((e) => e.aufgabe === 'flanke');
  ok(!!wache && s.achse != null, 'Flankenwache und Achse da (Achse ' + Math.round((s.achse || 0) * 180 / Math.PI) + ' Grad)');
  // Spieler 1 umgeht den Trupp: von Westen nach Norden (Winkel ~100 Grad zur Achse, ~5 Kacheln)
  const t0 = S.g.time;
  S.place(1, 27, 4);
  S.run(2.5);
  const b = s.bedrohung;
  const fk = S.barks.filter((x) => x.cause === 'flanke_umgangen');
  ok(fk.length === 1 && fk[0].id === wache.id && fk[0].t >= t0, 'Funkspruch flanke_umgangen, gesprochen von der Flankenwache (' + (fk[0] ? fk[0].from + ': ' + fk[0].text : 'keiner') + ')');
  ok(b && b.pid === S.P(1).id && Math.abs(b.x - S.P(1).x) < 4 * TILE && b.bis > S.g.time, 'Trupp-Zustand bedrohung: Spieler, Position, Ablaufzeit');
  ok(S.aw.truppStats && S.aw.truppStats.umgangen === 1, 'Zählung truppStats.umgangen = 1');
  const neu = ds.filter((e) => e.bedrohungT === (b && b.t));
  ok(neu.length >= 3, 'Mitglieder haben ihre Deckung gegen die neue Richtung neu bewertet (' + neu.length + ' von 5)');
  const sehen = ds.filter((e) => e.sees.includes(S.P(1)) && e.target);
  ok(sehen.length >= 1 && sehen.every((e) => e.target === S.P(1).id), 'Ziel-Wahl bevorzugt den Umgehenden (' + sehen.length + ' Mitglieder sehen ihn, alle zielen auf ihn)');
  ok(wache.aufgabe === 'flanke' && wache.role !== 'flank', 'die Wache bleibt in Deckung (Aufgabe flanke, keine Flankenfahrt)');
  // keine Dauerschleife: weiter dort, kein zweiter Funkspruch innerhalb der Sperre
  S.run(5);
  const sp = s.schwerpunkt;
  const quer = (Math.cos(s.achse) * (wache.y - sp.y) - Math.sin(s.achse) * (wache.x - sp.x)) / TILE * s.flankSeite;
  ok(quer >= 1.5, 'die Wache steht nach dem Umschwenken seitlich der Trupp-Achse, auf der Seite der Umgehung (' + quer.toFixed(1) + ' Kacheln quer)');
  ok(S.barks.filter((x) => x.cause === 'flanke_umgangen').length === 1, 'kein zweiter Flankenfunk innerhalb der Sperre');
  // Bedrohung läuft ab, wenn der Spieler wieder frontal steht
  S.place(1, 12, 10);
  S.run(10);
  ok(!s.bedrohung, 'Bedrohung endet, wenn der Spieler den Flankensektor verlässt');
  ende();
}
{   // Mitglieder wählen eine Deckung gegen die Umgehung: Trupp steht hinter Westdeckung, Spieler kommt aus Norden
  const { S, ds } = umgehungsszene();
  const info = require('../server/sim/interior.js').awayInfoOf(LP);
  const E = combat.env(S.g);
  S.run(5);
  const s = S.aw.squads.t1;
  const gegenBedrohung = (e, p) => Los.coverAgainst(info.map, E.solid, p.x, p.y, e.x, e.y);
  const vor = new Map(ds.map((e) => [e.id, gegenBedrohung(e, Physics.tileCenter(27, 4))]));
  S.place(1, 27, 4);
  S.run(6);
  const b = s.bedrohung;
  const nach = ds.map((e) => ({ e, v: vor.get(e.id), n: gegenBedrohung(e, { x: S.P(1).x, y: S.P(1).y }) }));
  const bewegt = ds.filter((e) => e.bedrohungT && e.alive);
  ok(!!b || S.barks.some((x) => x.cause === 'flanke_umgangen'), 'Umgehung bemerkt');
  ok(bewegt.length >= 3 && nach.filter((q) => q.n >= q.v).length >= 3 && nach.some((q) => q.n > q.v || q.n >= 1), 'Deckung gegen die Umgehung nicht schlechter, mindestens ein Mitglied steht jetzt dahinter (vorher ' + nach.map((q) => q.v).join('') + ', nachher ' + nach.map((q) => q.n).join('') + ')');
  ende();
}
{   // Funktexte
  const K = ['grundtyp', 'niederhalter', 'grenadier', 'schuetze', 'enterer', 'haescher'].map((r) => require('../content/katalog/gegner/' + r + '.json'));
  ok(K.every((g) => g.funk.flanke_umgangen && g.funk.flanke_umgangen.length >= 1), 'alle 6 Rollen: funk.flanke_umgangen');
  ok(K.every((g) => g.funk_nach_fraktion.rom.flanke_umgangen && g.funk_nach_fraktion.rom.flanke_umgangen.length >= 1), 'alle 6 Rollen: funk_nach_fraktion.rom.flanke_umgangen');
  const germ = new Set(K.flatMap((g) => g.funk.flanke_umgangen));
  ok(K.every((g) => g.funk_nach_fraktion.rom.flanke_umgangen.every((t) => !germ.has(t) && t.length <= 120)), 'römische Sätze unterscheiden sich von den germanischen');
  ok(AC.barks.flanke_umgangen && AC.barks.flanke_umgangen.length >= 1, 'Rückfall-Satz in awayCombat.barks (Plünderer ohne Katalog)');
  // rom: Sprecher mit römischem Namen und römischem Satz
  const S = szene(1, BLOECKE);
  const e = S.gegner('grundtyp', 20, 9); e.fraktion = 'rom';
  const s = S.aw.squads.t1; s.barkAt = -99;
  squad.bark(S.g, s, e, 'flanke_umgangen');
  const b = S.barks[S.barks.length - 1];
  const romSaetze = K.find((g) => g.id === 'grundtyp').funk_nach_fraktion.rom.flanke_umgangen;
  ok(b && b.cause === 'flanke_umgangen' && romSaetze.includes(b.text) && /Legion/.test(b.from), 'rom: Legionär spricht einen römischen Satz (' + (b && b.from + ': ' + b.text) + ')');
  ende();
}

console.log('\n[Messlauf: Verteilung und Klumpen]');
function mess(args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'mess-klumpen.js')].concat(args), { encoding: 'utf8', timeout: 400000 });
  const out = r.stdout || '';
  const a = /Anteil Gegner mit Kamerad <= 2 Kacheln ([0-9.]+)/.exec(out), v = /gueltiger Verteilung \([^)]*\) ([0-9.]+|n\/a) \(Gefechts-Samples mit Trupp ab 4: (\d+)/.exec(out);
  return { code: r.status, anteil: a ? +a[1] : NaN, gueltig: v ? +v[1] : NaN, mitGross: v ? +v[2] : 0, out };
}
{
  const gr = mess(['graben', '--seeds', '2', '--sek', '60', '--lauf', '--alarm']);
  ok(gr.code === 0 && gr.mitGross >= 50 && gr.gueltig >= 0.95, 'Grabenangriff alarmiert (Seeds 1-2, 60 s): Anteil Gefechts-Samples mit gültiger Verteilung ' + gr.gueltig + ' (' + gr.mitGross + ' Samples mit Trupp ab 4)');
  ok(gr.anteil <= 0.45, 'Grabenangriff: Klumpen-Anteil <= 0,45 über 2 Seeds/60 s (' + gr.anteil + '; 8 Seeds/120 s siehe README)');
  const ek = mess(['endkampf', '--seeds', '2', '--sek', '45']);
  ok(ek.code === 0 && ek.mitGross >= 50 && ek.gueltig >= 0.95, 'Endkampf (Seeds 1-2, 45 s): gültige Verteilung ' + ek.gueltig + ' (' + ek.mitGross + ' Samples)');
  ok(ek.anteil <= 0.4, 'Endkampf: Klumpen-Anteil <= 0,40 (' + ek.anteil + ')');
}

console.log(fails ? `\n${fails} von ${n} FEHLER` : `\nalle ${n} ok`);
process.exit(fails ? 1 : 0);
