'use strict';
// GEL-03 A1: Anker-Rolle `abbau` (Erzader), Server-Kern in server/sim/anker.js. Echtes Game, gebaute Karte (Ruine) mit handgesetzten abbau-Ankern (der Erzeuger setzt in A1 keine: das ist Paket C;
// die Anker kommen über einen Wrapper um Buehne.bauen in die Rohkarte, der Landepunkt-Cache bewahrt sie, Neuaufbau und Weltstand laufen den echten Weg). Kein Client.
// Geprüft: Konfiguration/Rolle (Zustandsreihenfolge, Haltezeit, Lärmtakt, Kollision), Angebot je Zustand (da / laeuft / abgebaut / leer), Start und Abschluss mit Ereignissen, einmal je Mission,
// Treffer-Abbruch ohne Fortschritt (alle Wege), Loslassen/Bewegung/Trennung, zwei Spieler (ein Halter, Übernahme nach Loslassen und Treffer, gleichzeitiger Vollzug genau einmal),
// Lärmtakt (Start und alle abbauLaermTakt s, nicht nach Abbruch), Speichern und Laden (laeuft -> da, abgebaut und leer bleiben), Snapshot ao.
//   node tools/test-abbau.js   (npm run test:abbau)
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const Buehne = require('../shared/buehne.js');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const DT = 1 / CONFIG.tickHz;
const TILE = Physics.TILE;
const ZUSTAENDE = ['da', 'laeuft', 'abgebaut', 'leer'];
const DAUER = CONFIG.anker.halten.abbau;
const TAKT = CONFIG.anker.abbauLaermTakt;
const IDS = ['abbau.1', 'abbau.2', 'abbau.3', 'abbau.4'];

// abbau-Anker in die Rohkarte setzen: erreichbare begehbare Kacheln, weit auseinander, alle vier Nachbarkacheln frei (Spieler stehen daneben, der Anker ist ein Hindernis)
function ankerEinsetzen(k) {
  if (k.anker.some((a) => a.rolle === 'abbau')) return;
  const r = Buehne.raster(k);
  const start = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft) || k.anker.find((a) => a.rolle === 'abholpunkt');
  const dist = new Map([[start.y * k.w + start.x, 0]]); const q = [[start.x, start.y]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = ny * k.w + nx;
      if (dist.has(key) || !r.durchgang(nx, ny)) continue;
      dist.set(key, dist.get(y * k.w + x) + 1); q.push([nx, ny]);
    }
  }
  const belegt = new Set(k.anker.map((a) => a.x + ',' + a.y));
  const frei = (x, y) => { const i = r.info(x, y); return i && i.kante === 'begehbar' && r.durchgang(x, y) && !belegt.has(x + ',' + y); };
  const kand = [...dist.keys()].map((key) => ({ x: key % k.w, y: Math.floor(key / k.w), d: dist.get(key) }))
    .filter((t) => t.d >= 6 && frei(t.x, t.y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => frei(t.x + dx, t.y + dy)))
    .sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const gew = [];
  for (const t of kand) if (gew.length < IDS.length && gew.every((o) => Math.hypot(o.x - t.x, o.y - t.y) >= 6)) gew.push(t);
  if (gew.length < IDS.length) throw new Error('zu wenig freie Plätze für abbau-Anker: ' + gew.length);
  IDS.forEach((id, i) => k.anker.push({ id, rolle: 'abbau', x: gew[i].x, y: gew[i].y, art: 'erz' }));
}

function szene(opts) {
  opts = opts || {};
  const np = opts.spieler || 1;
  const bauen0 = Buehne.bauen;
  Buehne.bauen = function () { const k = bauen0.apply(this, arguments); ankerEinsetzen(k); return k; };
  let g;
  try {
    g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const cs = Array.from({ length: np }, () => ({ inbox: [], send(o) { this.inbox.push(o); } }));
    for (const [i, c] of cs.entries()) { g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'Abbau' + i, color: i }); }
    for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
    for (let i = 0; i < 6; i++) g.step();
    const id = L.neu(g, g.ship.scene, { art: 'ruine' });
    const aw = L.get(g, id);
    g.setAwayMap(id); aw.active = true;
    for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
    g.god = true;
    const S = { g, cs, id, aw, k: W.AWAY_MAPS[id].karte, ps: g.players, p: g.players[0], me: [], notes: [], ev: [] };
    const me0 = g.missionEvent.bind(g); g.missionEvent = (nm, a) => { S.me.push([nm, a, g.time]); return me0(nm, a); };
    const n0 = g.notice.bind(g); g.notice = (p, t) => { S.notes.push({ pid: p.id, text: t }); return n0(p, t); };
    const e0 = g.emit.bind(g); g.emit = function (t, d) { S.ev.push([t, d]); return e0(t, d); };
    S.an = (fid) => S.k.anker.find((a) => a.id === fid);
    S.mitte = (fid) => Physics.tileCenter(S.an(fid).x, S.an(fid).y);
    S.hin = (p, x, y) => { p.x = x; p.y = y; p.input.mx = 0; p.input.my = 0; };
    // Nachbarkachel i (0..3) eines Ankers: Mittelpunkt
    S.nachbar = (fid, i) => { const a = S.an(fid); const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][i || 0]; return Physics.tileCenter(a.x + dx, a.y + dy); };
    S.zu = (p, fid, i) => { const c = S.nachbar(fid, i); S.hin(p, c.x, c.y); };
    S.z = (fid) => Anker.zustand(g, id, fid);
    S.lauf = (sek, vor) => { for (let i = 0; i < Math.round(sek / DT); i++) { g.away.drones.length = 0; if (vor) vor(); g.step(); } };
    S.act = (down, i) => g.handleMessage(cs[i || 0], { t: 'act', down });
    S.setz = (fid, z, o) => Anker.setzen(g, id, fid, z, null, o);
    S.evn = (name) => S.ev.filter((e) => e[0] === name).length;
    S.men = (name) => S.me.filter((m) => m[0] === name);
    S.haelt = (p) => !!(p.hold && p.hold.kind === 'anker:abbau');
    S.angebot = (p, fid) => { const a = S.an(fid); const l = []; Anker.interactionsAt(g, p, a.x, a.y, l); return l; };
    S.snap = () => g.snapshot();
    return S;
  } finally { Buehne.bauen = bauen0; }
}
const treffer = (S, p) => { S.g.god = false; try { return combat.hitPlayer(S.g, p, 1, { kind: 'raider' }); } finally { S.g.god = true; } };

section('Konfiguration, Rolle, Kollision');
{
  const A = require('../content/buehnen/anker.json');
  ok(A.rollen.abbau && A.rollen.abbau.zustaende.join() === ZUSTAENDE.join(), 'anker.json: Rolle abbau, Zustände da, laeuft, abgebaut, leer (Start da)');
  ok(A.rollen.abbau.halten === 'abbau' && A.rollen.abbau.objekt === 'erzader', 'Rolle abbau: halten abbau, Objekt erzader');
  ok(DAUER === 5 && TAKT === 2, 'Config: halten.abbau 5 s, abbauLaermTakt 2 s');
  ok(Buehne.ANKER_GLYPHE.abbau, 'Anker-Kürzel für abbau');
  ok(Anker.startFuer({ rolle: 'abbau' }) === 'da', 'startFuer: da');
  ok(['abbauStarten', 'abbauAbbrechen', 'abbauFertig', 'abbauMenge'].every((f) => typeof Anker[f] === 'function'), 'benannte Funktionen exportiert');
  const m = Anker.abbauMenge(null, 'x', { art: undefined });
  ok(m.menge === 1 && m.art === 'erz', 'Platzhalter-Hook abbauMenge: 1 Erz (Paket B ersetzt nur diese Funktion)');
  const S = szene();
  ok(IDS.every((i) => S.an(i) && S.z(i) === 'da'), 'vier Adern im Test, Start da');
  const solid = interior.awaySolid(S.g);
  ok(IDS.every((i) => solid(S.an(i).x, S.an(i).y)) && !solid(S.an('abbau.1').x + 1, S.an('abbau.1').y), 'Kollision: die Kachel einer Ader ist fest (Server-Kollision), die Nachbarkachel frei');
}

section('Angebot je Zustand');
{
  const S = szene(); const { p } = S;
  S.lauf(0.2);
  S.zu(p, 'abbau.1');
  const l = S.angebot(p, 'abbau.1');
  ok(l.length === 1 && l[0].kind === 'anker:abbau' && l[0].op === 'abbauen' && !l[0].blocked && l[0].anker === 'abbau.1', 'da: E bietet abbauen an');
  S.setz('abbau.2', 'abgebaut');
  const l2 = S.angebot(p, 'abbau.2');
  ok(l2.length === 1 && l2[0].blocked === 'Die Ader ist erschöpft.', 'abgebaut: „Die Ader ist erschöpft.“');
  S.setz('abbau.3', 'leer');
  const n0 = S.notes.length;
  S.zu(p, 'abbau.3'); S.act(true); S.lauf(0.4); S.act(false);
  ok(S.angebot(p, 'abbau.3').length === 0 && !S.haelt(p) && S.notes.length === n0 && S.z('abbau.3') === 'leer', 'leer: nichts angeboten, kein Hold, kein Hinweis');
  ok(typeof S.setz('abbau.1', 'kaputt') === 'string' && S.setz('abbau.1', 'laeuft') === null && S.z('abbau.1') === 'laeuft', 'setzen kennt genau die vier Zustände');
}

section('Start, Abschluss, einmal je Mission');
{
  const S = szene(); const { p } = S;
  S.lauf(0.2);
  S.zu(p, 'abbau.1'); S.act(true);
  ok(S.haelt(p) && p.hold.dur === DAUER && p.hold.anker === 'abbau.1', 'E halten startet den Hold mit CONFIG.anker.halten.abbau (' + DAUER + ' s)');
  ok(S.z('abbau.1') === 'laeuft', 'Zustand laeuft');
  const st = S.men('abbauStart');
  ok(st.length === 1 && st[0][1].map === S.id && st[0][1].anker === 'abbau.1' && st[0][1].pid === p.id && S.evn('abbauStart') === 1, 'Ereignis abbauStart {map, anker, pid} (Mission und Spiel)');
  S.lauf(DAUER - 0.7);
  ok(S.haelt(p) && S.z('abbau.1') === 'laeuft' && S.men('abbauFertig').length === 0, 'vor Ablauf: noch laeuft, kein Fertig');
  const pr = S.snap().players[0].action;
  ok(pr && pr.kind === 'anker:abbau' && pr.progress > 0.5 && pr.progress < 1, 'Snapshot players[].action zeigt den Fortschritt');
  S.lauf(1.0);
  ok(S.z('abbau.1') === 'abgebaut' && !p.hold, 'nach der Haltezeit: abgebaut, Hold weg');
  const f = S.men('abbauFertig');
  ok(f.length === 1 && f[0][1].map === S.id && f[0][1].anker === 'abbau.1' && f[0][1].pid === p.id && f[0][1].menge === 1 && f[0][1].art === 'erz' && S.evn('abbauFertig') === 1, 'Ereignis abbauFertig {map, anker, pid, menge, art}');
  // zweiter Abbau derselben Ader
  S.act(false); S.lauf(0.2);
  const l = S.angebot(p, 'abbau.1');
  ok(l.length === 1 && l[0].blocked === 'Die Ader ist erschöpft.', 'zweiter Abbau: abgelehnt (erschöpft)');
  S.act(true); S.lauf(DAUER + 1);
  ok(!S.haelt(p) && S.z('abbau.1') === 'abgebaut' && S.men('abbauFertig').length === 1 && S.men('abbauStart').length === 1, 'E halten an der leeren Ader: kein Hold, kein zweites Ereignis');
  const h = { kind: 'anker:abbau', anker: 'abbau.1', map: S.id, op: 'abbauen', t: 0, dur: DAUER };
  ok(Anker.holdValid(S.g, p, h) === false, 'holdValid: abgebaut ungültig');
  Anker.abbauFertig(S.g, p, h);
  ok(S.men('abbauFertig').length === 1, 'abbauFertig direkt aufgerufen: nur aus da/laeuft');
  // Loslassen: nichts abgebaut, zurück auf da
  const q = szene(); q.lauf(0.2); q.zu(q.p, 'abbau.1'); q.act(true); q.lauf(2.0);
  ok(q.haelt(q.p) && q.p.hold.t > 1.5, 'Vorbedingung: Abbau läuft (' + q.p.hold.t.toFixed(2) + ' s)');
  q.act(false); q.lauf(DT * 2);
  ok(!q.haelt(q.p) && q.z('abbau.1') === 'da' && q.men('abbauFertig').length === 0, 'E loslassen: da, nichts abgebaut');
  q.act(true); q.lauf(0.5);
  ok(q.haelt(q.p) && q.p.hold.t < 0.7, 'erneutes Halten beginnt bei null (kein Fortschritt gemerkt)');
}

section('Treffer bricht ab: kein Fortschritt');
{
  const beginne = (opts) => { const S = szene(opts); S.lauf(0.2); S.zu(S.p, 'abbau.1'); S.act(true); S.lauf(2.0); return S; };
  const sauber = (S, p, name) => {
    ok(!S.haelt(p), name + ': Hold weg');
    ok(S.z('abbau.1') === 'da', name + ': Zustand da');
    S.act(false); S.lauf(DAUER + 0.5);
    ok(S.z('abbau.1') === 'da' && S.men('abbauFertig').length === 0, name + ': nichts abgebaut');
  };
  {
    const S = beginne(); const { p } = S;
    ok(S.haelt(p) && p.hold.t > 1.5, 'Vorbedingung: Abbau läuft (' + p.hold.t.toFixed(2) + ' s)');
    const n0 = S.notes.length;
    Anker.onTreffer(S.g, p.id);
    ok(S.notes.slice(n0).some((m) => m.pid === p.id && m.text === 'Getroffen – der Abbau ist unterbrochen.'), 'Meldung „Getroffen – der Abbau ist unterbrochen.“');
    sauber(S, p, 'direkter Aufruf onTreffer');
  }
  { const S = beginne(); const { p } = S; treffer(S, p); sauber(S, p, 'Treffer ohne Schild (hitPlayer)'); }
  { const S = beginne(); const { p } = S; S.g.waffenWelt.getroffen(p, 'abgelenkt', {}, {}); ok(S.haelt(p) && S.z('abbau.1') === 'laeuft', 'abgelenkter Treffer (kein Treffer): Abbau läuft weiter'); }
  {
    // nach dem Treffer von vorn: neuer Start, volle Zeit, keine Restzeit
    const S = beginne(); const { p } = S;
    treffer(S, p); S.act(false); S.lauf(DT * 2); S.act(true); S.lauf(0.3);
    ok(S.haelt(p) && p.hold.t < 0.5 && S.z('abbau.1') === 'laeuft', 'nach dem Treffer: neuer Hold beginnt bei null');
    S.lauf(DAUER - 0.5);
    ok(S.z('abbau.1') === 'laeuft', 'volle Haltezeit nötig (keine Restzeit)');
    S.lauf(0.7);
    ok(S.z('abbau.1') === 'abgebaut' && S.men('abbauFertig').length === 1, 'nach voller Zeit: abgebaut');
  }
  { const S = beginne(); const { p } = S; p.input.mx = 1; S.lauf(DT * 3); p.input.mx = 0; sauber(S, p, 'Bewegung'); }
  { const S = beginne(); const { g, p } = S; g.removeConnection(S.cs[0]); ok(p.hold === null, 'Trennung: Hold sofort weg'); S.lauf(DT * 3); ok(S.z('abbau.1') === 'da', 'Trennung: Zustand da'); }
  { const S = beginne(); const { g, p } = S; p.downed = true; ok(Anker.holdValid(g, p, p.hold) === false, 'Niederstrecken: holdValid ungültig'); p.downed = false; }
  { const S = beginne(); const { p } = S; p.zone = 'ship'; S.lauf(DT * 3); p.zone = 'away'; sauber(S, p, 'Zone verlassen'); }
}

section('Zwei Spieler an einer Ader');
{
  const bereit = () => { const S = szene({ spieler: 2 }); const [a, b] = S.ps; S.lauf(0.2); S.zu(a, 'abbau.1', 0); S.zu(b, 'abbau.1', 1); return { S, a, b }; };
  {
    const { S, a, b } = bereit();
    S.act(true, 0); S.lauf(1.0);
    ok(S.haelt(a) && S.z('abbau.1') === 'laeuft', 'a hält, laeuft');
    const l = S.angebot(b, 'abbau.1');
    ok(l.length === 1 && l[0].blocked === 'Dort wird schon abgebaut.', 'b: „Dort wird schon abgebaut.“');
    S.act(true, 1); S.lauf(0.5);
    ok(!S.haelt(b) && S.haelt(a) && a.hold.t > 1.4, 'b bekommt keinen Hold, a hält ungestört weiter');
    ok(S.men('abbauStart').length === 1, 'nur ein abbauStart');
    // a lässt los, b hat E schon unten -> Übernahme sofort (nach dem Loslassen neu drücken)
    S.act(false, 0); S.act(false, 1); S.lauf(DT * 2);
    ok(!S.haelt(a) && !S.haelt(b) && S.z('abbau.1') === 'da', 'a lässt los: Ader frei (da)');
    S.act(true, 1); S.lauf(DT * 3);
    ok(S.haelt(b) && S.z('abbau.1') === 'laeuft' && S.men('abbauStart').length === 2 && S.men('abbauStart')[1][1].pid === b.id, 'b übernimmt sofort (zweites abbauStart mit pid b)');
    ok(S.angebot(a, 'abbau.1')[0].blocked === 'Dort wird schon abgebaut.', 'jetzt ist a gesperrt');
    S.lauf(DAUER + 0.2);
    ok(S.z('abbau.1') === 'abgebaut' && S.men('abbauFertig').length === 1 && S.men('abbauFertig')[0][1].pid === b.id, 'b vollendet: genau ein abbauFertig (pid b)');
  }
  {
    // Übernahme im selben Tick: a lässt los, b drückt E, bevor der Tick (update) den Halter-Eintrag von a aufräumt
    const { S, a, b } = bereit();
    S.act(true, 0); S.lauf(1.0);
    S.act(false, 0); S.act(true, 1); S.lauf(DT * 3);
    ok(!S.haelt(a) && S.haelt(b) && S.z('abbau.1') === 'laeuft' && S.men('abbauStart').length === 2 && S.men('abbauStart')[1][1].pid === b.id, 'Loslassen und Übernehmen im selben Tick: b hält, kein verwaister Halter');
    S.lauf(DAUER + 0.2);
    ok(S.z('abbau.1') === 'abgebaut' && S.men('abbauFertig').length === 1 && S.men('abbauFertig')[0][1].pid === b.id, 'b vollendet');
  }
  {
    // Übernahme nach Treffer auf den Halter
    const { S, a, b } = bereit();
    S.act(true, 0); S.lauf(1.5);
    treffer(S, a);
    ok(!S.haelt(a) && S.z('abbau.1') === 'da', 'Treffer auf a: Ader frei');
    S.act(true, 1); S.lauf(DT * 3);
    ok(S.haelt(b) && S.z('abbau.1') === 'laeuft', 'b übernimmt sofort nach dem Treffer');
    S.act(false, 0);
  }
  {
    // gleicher Tick: beide drücken E zugleich -> genau ein Halter (erster gewinnt)
    const { S, a, b } = bereit();
    S.act(true, 0); S.act(true, 1); S.lauf(DT * 3);
    ok(S.haelt(a) !== S.haelt(b), 'gleicher Tick: genau ein Halter');
    ok(S.men('abbauStart').length === 1 && S.z('abbau.1') === 'laeuft', 'ein abbauStart, laeuft');
  }
  {
    // gleichzeitiger Vollzug: beide Holds kurz vor Ende erzwungen -> nur einer gewinnt
    const { S, a, b } = bereit();
    S.act(true, 0); S.lauf(1.0);
    b.hold = { kind: 'anker:abbau', anker: 'abbau.1', op: 'abbauen', tx: S.an('abbau.1').x, ty: S.an('abbau.1').y, t: DAUER, dur: DAUER };   // b „hält“ ebenfalls und wäre fertig
    a.hold.t = DAUER - DT * 0.5;
    ok(Anker.holdValid(S.g, b, b.hold) === false && Anker.holdValid(S.g, a, a.hold) === true, 'holdValid: der erste Halter gilt, der andere nicht');
    S.lauf(DT * 3);
    ok(S.z('abbau.1') === 'abgebaut' && S.men('abbauFertig').length === 1 && S.men('abbauFertig')[0][1].pid === a.id && S.evn('abbauFertig') === 1, 'gleichzeitiger Vollzug: genau ein abbauFertig, der erste Halter gewinnt');
    ok(!a.hold && !b.hold, 'beide Holds sind danach weg');
    // direkter Doppelaufruf von abbauFertig
    Anker.abbauFertig(S.g, b, { kind: 'anker:abbau', anker: 'abbau.1' });
    ok(S.men('abbauFertig').length === 1, 'abbauFertig ein zweites Mal: nichts');
  }
  {
    // zwei Spieler an verschiedenen Adern gleichzeitig: unabhängig
    const { S, a, b } = bereit();
    S.zu(b, 'abbau.2', 0); S.act(true, 0); S.act(true, 1); S.lauf(DAUER + 0.3);
    ok(S.z('abbau.1') === 'abgebaut' && S.z('abbau.2') === 'abgebaut' && S.men('abbauFertig').length === 2, 'zwei Adern, zwei Spieler: beide fertig');
  }
}

section('Lärm: Start und Takt');
{
  const S = szene(); const { p } = S;
  S.lauf(0.2);
  S.zu(p, 'abbau.1'); S.act(true);
  const l0 = S.men('abbauLaerm');
  const c = S.mitte('abbau.1');
  ok(l0.length === 1 && S.evn('abbauLaerm') === 1, 'Lärm beim Start: ein Ereignis');
  ok(l0[0][1].map === S.id && l0[0][1].anker === 'abbau.1' && l0[0][1].pid === p.id && l0[0][1].x === c.x && l0[0][1].y === c.y, 'abbauLaerm {map, anker, pid, x, y} mit der Mitte der Ader');
  S.lauf(TAKT - 0.3);
  ok(S.men('abbauLaerm').length === 1, 'vor dem Takt kein weiterer Lärm');
  S.lauf(0.5);
  ok(S.men('abbauLaerm').length === 2, 'nach dem ersten Takt: zweiter Lärm');
  S.lauf(TAKT);
  ok(S.men('abbauLaerm').length === 3, 'nach dem zweiten Takt: dritter Lärm');
  const t = S.men('abbauLaerm').map((m) => m[2]);
  ok(Math.abs((t[1] - t[0]) - TAKT) < 0.1 && Math.abs((t[2] - t[1]) - TAKT) < 0.1, 'Abstand der Ereignisse = Takt (Spielzeit ' + t.map((x) => x.toFixed(2)).join(', ') + ')');
  treffer(S, p); S.act(false);
  const nL = S.men('abbauLaerm').length;
  S.lauf(TAKT * 3);
  ok(S.men('abbauLaerm').length === nL, 'nach dem Abbruch kein Lärm mehr');
  // Abschluss: nach der Haltezeit kein weiterer Lärm
  const q = szene(); q.lauf(0.2); q.zu(q.p, 'abbau.1'); q.act(true); q.lauf(DAUER + TAKT * 2);
  ok(q.z('abbau.1') === 'abgebaut' && q.men('abbauLaerm').length === Math.floor((DAUER - 1e-6) / TAKT) + 1, 'Lauf bis zum Abschluss: Start plus ein Lärm je Takt (' + q.men('abbauLaerm').length + ')');
}

section('Speichern und Laden, Snapshot');
{
  const S = szene(); const { g, id, p } = S;
  S.lauf(0.2);
  S.setz('abbau.2', 'abgebaut', { merken: true }); S.setz('abbau.3', 'leer', { merken: true });
  S.zu(p, 'abbau.1'); S.act(true); S.lauf(1.0);
  ok(S.z('abbau.1') === 'laeuft', 'Vorbedingung: abbau.1 laeuft');
  const liste = Anker.ankerListe(g, S.aw, S.k);
  const ao = S.snap().away.ao;
  const idx = (fid) => liste.findIndex((a) => a.id === fid);
  ok(ao.some(([i, zi]) => i === idx('abbau.1') && zi === 1) && ao.some(([i, zi]) => i === idx('abbau.2') && zi === 2) && ao.some(([i, zi]) => i === idx('abbau.3') && zi === 3) && !ao.some(([i]) => i === idx('abbau.4')), 'ao: nur Abweichungen vom Start da (laeuft 1, abgebaut 2, leer 3)');
  L.sichern(g, id);
  const e = L.eintrag(g, id);
  const z = JSON.parse(JSON.stringify(e.zustaende));
  ok(z['abbau.1'] === 'da' && z['abbau.2'] === 'abgebaut' && z['abbau.3'] === 'leer' && !z['abbau.4'], 'Weltstand-Eintrag: laeuft wird da, abgebaut und leer bleiben');
  ok(JSON.parse(JSON.stringify(L.toSave(g)))[id].zustaende['abbau.1'] === 'da', 'toSave: kein laeuft im Weltstand');
  // Neuaufbau der Außenkarte
  S.act(false); S.lauf(DT * 2);
  delete g.aways[id];
  const aw2 = L.get(g, id); g.away = aw2; aw2.active = true;
  ok(aw2 !== S.aw, 'Vorbedingung: neue Außenkarte');
  ok(Anker.zustand(g, id, 'abbau.1') === 'da' && Anker.zustand(g, id, 'abbau.2') === 'abgebaut' && Anker.zustand(g, id, 'abbau.3') === 'leer' && Anker.zustand(g, id, 'abbau.4') === 'da', 'nach dem Neuaufbau: da, abgebaut, leer, da');
  // der Weltstand-Weg (toSave / restore)
  const block = JSON.parse(JSON.stringify(L.toSave(g)));
  L.restore(block, g);
  const aw3 = L.get(g, id); g.away = aw3; aw3.active = true;
  ok(Anker.zustand(g, id, 'abbau.2') === 'abgebaut' && Anker.zustand(g, id, 'abbau.3') === 'leer' && Anker.zustand(g, id, 'abbau.1') === 'da', 'nach restore: Zustände je Ader erhalten');
}

console.log(`\n${n - fails}/${n} Prüfungen ok`);
process.exit(fails ? 1 : 0);
