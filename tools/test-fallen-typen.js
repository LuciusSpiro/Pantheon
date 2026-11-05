'use strict';
// ITM-01 D: die drei Fallentypen (server/sim/fallen-typen.js): Schott schließt sich, Druckverlust (Gefahrenfeld), Selbstschussanlage. Echtes Game, gebaute Karte (Ruine) mit einer
// herausgeschnittenen Arena (kleine, bekannte Geometrie: Räume, Schott-Kanten, Wände, niedrige Deckung) plus die echte Station (Seed 1, Schott-Kanten, Rätseltor).
// Geprüft je Typ: Auslösen -> Wirkung (Zahl, Takt, Dauer, Ende), genau einmal (auch mehrere Spieler im selben Tick), Entschärfen vorher verhindert die Wirkung, Treffer unterbricht das Entschärfen,
// nur Spieler im Bereich und nur aufrechte (nicht downed, nicht an Bord, nicht bewusstlos), god ohne Schaden, Gegner nie; Schott: schließt, öffnet nach der Dauer, Hacken öffnet früher (freies
// Schott E, technischer Eingang), nie jemand in einer festen Kachel, ohne Schott wirkungslos mit Hinweis (Ereignis, Debug-Meldung, Prüfer-Warnung K-FALLE), Rätseltor bleibt; Druck: Raum
// verlassen stoppt, Takt je Spieler, Dauer endet, zweite Variante nur per Config; Schuss: Sichtlinie, Reichweite, 3 Schuss im Takt, Ziel wechselt, Kollision, Entschärfen von der Nachbarkachel,
// Auslösen durch Berühren; Weltstand mit laufender Wirkung; 1 bis 4 Spieler.
//   node tools/test-fallen-typen.js   (npm run test:fallen-typen)
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const Fallen = require('../server/sim/fallen.js');
const Typen = require('../server/sim/fallen-typen.js');
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
const FC = CONFIG.anker.falle;
const cfgSchott = FC.schott, cfgSchuss = FC.schuss, cfgDruck = FC.feld.druck;

// Spione: jeder Aufruf von hitPlayer / hitEnemy (nur Server-Code ruft über combat.* auf)
const SPY = { spieler: [], gegner: [] };
const hp0 = combat.hitPlayer, he0 = combat.hitEnemy;
combat.hitPlayer = function (game, p, segs, source) { SPY.spieler.push({ pid: p.id, segs, kind: source && source.kind ? source.kind : source, t: game.time, src: source }); return hp0.apply(this, arguments); };
combat.hitEnemy = function () { SPY.gegner.push(Array.from(arguments).slice(2, 3)); return he0.apply(this, arguments); };
const treffer = (kind, pid) => SPY.spieler.filter((s) => s.kind === kind && (pid == null || s.pid === pid));

// ---------- Szene ----------
const AW = 16, AH = 9;   // Arena (Innenmaß)
// Fläche (mit Rand 1) ohne Kanten und ohne tragende Anker (Abholpunkt, Eingang, Tor, Lift, Leiter); alle übrigen Anker darin (Wachen, Beute …) werden entfernt. Weniger Anker zuerst.
const TRAGEND = { abholpunkt: 1, eingang: 1, tor: 1, lift: 1, leiter: 1, versteck: 1 };
function arenaPlatz(k) {
  const drin = (a, x, y) => a.x >= x - 1 && a.x <= x + AW && a.y >= y - 1 && a.y <= y + AH;
  const kante = (x, y) => Object.values(k.kanten || {}).some((kk) => (kk.tiles || []).some((t) => t[0] >= x - 1 && t[0] <= x + AW && t[1] >= y - 1 && t[1] <= y + AH));
  let best = null;
  for (let y = 2; y + AH + 2 < k.h; y++) for (let x = 2; x + AW + 2 < k.w; x++) {
    if (kante(x, y) || k.anker.some((a) => TRAGEND[a.rolle] && drin(a, x, y))) continue;
    const m = k.anker.filter((a) => drin(a, x, y)).length;
    if (!best || m < best.m) best = { x, y, m };
  }
  if (!best) throw new Error('keine Fläche für die Arena');
  k.anker = k.anker.filter((a) => !drin(a, best.x, best.y));
  return best;
}
// bauArena(A): A.x0/A.y0 = Ursprung des Innenmaßes; A.set(dx,dy,ch), A.kante(id, typ, [[dx,dy]…], zustand), A.anker({id, rolle, typ, sicht, dx, dy, …}), A.platz(id, dx, dy, w, h)
function arenaBauen(k, bauArena) {
  const p = arenaPlatz(k);
  const D = Buehne.daten().kacheln.zeichen;
  const rows = k.rows.map((r) => r.split(''));
  for (const pid of Object.keys(k.plaetze || {})) { const r = k.plaetze[pid].rect; if (r && r[0] < p.x + AW && r[0] + r[2] > p.x && r[1] < p.y + AH && r[1] + r[3] > p.y) delete k.plaetze[pid]; }   // Plätze der Karte unter der Arena fallen weg (sonst wäre ein kleinerer Modulraum der "Raum")
  for (let y = p.y - 1; y <= p.y + AH; y++) for (let x = p.x - 1; x <= p.x + AW; x++) rows[y][x] = (x < p.x || y < p.y || x >= p.x + AW || y >= p.y + AH) ? '#' : '.';
  const A = {
    x0: p.x, y0: p.y,
    set(dx, dy, ch) { rows[p.y + dy][p.x + dx] = ch; if (!k.legende[ch] && D[ch]) k.legende[ch] = JSON.parse(JSON.stringify(D[ch])); },
    kante(id, typ, tiles, zustand) { k.kanten[id] = { a: 'arena', b: 'arena', typ, tiles: tiles.map(([dx, dy]) => [p.x + dx, p.y + dy]), zustand }; },
    anker(o) { const a = Object.assign({}, o); a.x = p.x + o.dx; a.y = p.y + o.dy; delete a.dx; delete a.dy; k.anker.push(a); },
    platz(id, dx, dy, w, h) { (k.plaetze || (k.plaetze = {}))[id] = { typ: 'arena', rect: [p.x + dx, p.y + dy, w, h], bereich: null }; },
  };
  bauArena(A);
  k.rows = rows.map((r) => r.join(''));
  return A;
}

// opts: { spieler, art, seed, arena: fn(A) | null, setze: fn(k) (eigene Anker in die Rohkarte), god }
function szene(opts) {
  opts = opts || {};
  const np = opts.spieler || 1;
  const bauen0 = Buehne.bauen;
  L.cacheLeeren();
  SPY.spieler.length = 0; SPY.gegner.length = 0;
  let arena = null;
  Buehne.bauen = function () {
    const k = bauen0.apply(this, arguments);
    if (opts.arena) arena = arenaBauen(k, opts.arena);
    if (opts.setze) opts.setze(k);
    return k;
  };
  let g;
  try {
    g = new Game({ noStore: true, seed: 11, debug: opts.debug !== false, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const cs = Array.from({ length: np }, () => ({ inbox: [], send(o) { this.inbox.push(o); } }));
    for (const [i, c] of cs.entries()) { g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T' + i, name: 'Typ' + i, color: i }); }
    for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
    for (let i = 0; i < 6; i++) g.step();
    const id = L.neu(g, g.ship.scene, { art: opts.art || 'ruine', seed: opts.seed });
    const aw = L.get(g, id);
    g.setAwayMap(id); aw.active = true;
    for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
    g.god = opts.god !== false;
    const S = { g, cs, id, aw, k: W.AWAY_MAPS[id].karte, A: arena, ps: g.players, p: g.players[0], me: [], notes: [], ev: [] };
    const me0 = g.missionEvent.bind(g); g.missionEvent = (nm, a) => { S.me.push([nm, a]); return me0(nm, a); };
    const n0 = g.notice.bind(g); g.notice = (p, t) => { S.notes.push({ pid: p.id, text: t }); return n0(p, t); };
    const e0 = g.emit.bind(g); g.emit = function (t, d) { S.ev.push([t, d, g.time]); return e0(t, d); };
    S.an = (fid) => S.k.anker.find((a) => a.id === fid);
    S.mitte = (fid) => Physics.tileCenter(S.an(fid).x, S.an(fid).y);
    S.hin = (p, x, y) => { p.x = x; p.y = y; p.input.mx = 0; p.input.my = 0; };
    S.hinKachel = (p, dx, dy, ox, oy) => { const c = Physics.tileCenter(S.A.x0 + dx, S.A.y0 + dy); S.hin(p, c.x + (ox || 0), c.y + (oy || 0)); };   // dx,dy Arena-Kachel, ox,oy Pixel
    S.z = (fid) => Anker.zustand(g, id, fid);
    S.lauf = (sek, vor) => { for (let i = 0; i < Math.round(sek / DT); i++) { g.away.drones.length = 0; if (vor) vor(i); g.step(); } };
    S.act = (down, i) => g.handleMessage(cs[i || 0], { t: 'act', down });
    S.evn = (name, f) => S.ev.filter((e) => e[0] === name && (!f || f(e[1]))).length;
    S.evs = (name) => S.ev.filter((e) => e[0] === name).map((e) => e[1]);
    S.solid = (tx, ty) => interior.awaySolid(g)(tx, ty);
    S.schild = (p) => (p || S.p).shield.seg;
    S.stehtAufrecht = (p) => !p.downed;
    S.snap = () => g.snapshot();
    S.fest = (kid, st) => Anker.setzen(g, id, kid, st, null);
    return S;
  } finally { Buehne.bauen = bauen0; }
}
const kurz = (v) => (Math.round(v * 100) / 100);
const hatFehler = (g) => !!((g.errors && (g.errors.length != null ? g.errors.length : g.errors)) || 0);

// ---------- Arena-Aufbauten ----------
// Schott: Wand dx 8 mit Schott A (dy 3..4, frei hackbar), Wand dx 12 mit Schott B (dy 6..7) und technischem Eingang; Fallen tA (dx 6, dy 3), tB (dx 10, dy 6) Typ schott passiv.
function arenaSchott(A) {
  for (let dy = 0; dy < AH; dy++) { A.set(8, dy, '#'); A.set(12, dy, '#'); }
  for (const dy of [3, 4]) A.set(8, dy, 'S');
  for (const dy of [6, 7]) A.set(12, dy, 'S');
  A.kante('arena.schottA', 'schott', [[8, 3], [8, 4]], 'offen');
  A.kante('arena.schottB', 'schott', [[12, 6], [12, 7]], 'offen');
  A.anker({ id: 'arena.eingang', rolle: 'eingang', art: 'technisch', dx: 11, dy: 6 });
  A.anker({ id: 'falle.tA', rolle: 'falle', typ: 'schott', sicht: 'passiv', dx: 6, dy: 3 });
  A.anker({ id: 'falle.tB', rolle: 'falle', typ: 'schott', sicht: 'passiv', dx: 10, dy: 6 });
  A.anker({ id: 'falle.tV', rolle: 'falle', typ: 'schott', sicht: 'verborgen', dx: 3, dy: 7 });   // zu weit von jedem Schott (Wirkbereich leer)
}
// Druck: zwei Räume (dx 0..7 und 8..15), Druckfalle tD in Raum A (dx 3, dy 4), erkannte Testfalle tE ebenfalls in A (dx 5, dy 7; Typ tst, zählt)
function arenaDruck(A) {
  A.platz('raumA', 0, 0, 8, AH); A.platz('raumB', 8, 0, 8, AH);
  A.anker({ id: 'falle.tD', rolle: 'falle', typ: 'druck', sicht: 'passiv', dx: 3, dy: 4 });
  A.anker({ id: 'falle.tE', rolle: 'falle', typ: 'tst', sicht: 'passiv', dx: 6, dy: 7 });
  A.anker({ id: 'falle.tX', rolle: 'falle', typ: 'druck', sicht: 'passiv', dx: 12, dy: 1 });   // zweite Druckfalle in Raum B
  A.anker({ id: 'falle.tR', rolle: 'falle', typ: 'dorn', sicht: 'passiv', dx: 2, dy: 7 });   // Radius-Variante (nur wenn die Config sie kennt)
}
// Schuss: Anlage tS (dx 3, dy 4), Wand dx 6 dy 0..2 (Sichtsperre), niedrige Deckung dx 8 dy 4 (nur geduckt schützend)
function arenaSchuss(A) {
  for (let dy = 0; dy <= 2; dy++) A.set(6, dy, '#');
  A.set(8, 4, 'x');
  A.anker({ id: 'falle.tS', rolle: 'falle', typ: 'schuss', sicht: 'passiv', dx: 3, dy: 4 });
  A.anker({ id: 'falle.tT', rolle: 'falle', typ: 'schuss', sicht: 'verborgen', dx: 12, dy: 8 });
}
const schuesse = (S) => S.evs('selbstschuss');

// ======================================================================
section('Konfiguration, Register, Datenblätter, Prüfer');
{
  const wirft = (f) => { try { f(); return false; } catch (e) { return true; } };
  ok(FC.blockiert.schuss === true && !FC.blockiert.schott && !FC.blockiert.druck, 'Config: nur schuss blockiert (Kollisionsbox), schott und druck nicht');
  ok(cfgSchott.dauer === 20 && cfgSchott.radius === 3, 'Config: Schott 20 s, Radius 3 Kacheln');
  ok(cfgDruck.dauer === 20 && cfgDruck.takt === 2 && cfgDruck.segmente === 1 && cfgDruck.bereich === 'raum', 'Config: Druck 20 s, alle 2 s ein Segment, Bereich Raum');
  ok(cfgSchuss.schuesse === 3 && cfgSchuss.takt === 0.4 && cfgSchuss.reichweite === 8 && cfgSchuss.segmente === 1, 'Config: Schuss 3 Schuss, Takt 0,4 s, Reichweite 8, 1 Segment');
  const hb = CONFIG.player.hitbox;
  const minFest = (TILE / 2 + Math.min(hb.w, hb.h) / 2) / TILE, minX = (TILE / 2 + hb.w / 2) / TILE;
  ok(FC.radius.schuss > minX && FC.radius.schuss <= 0.9, 'Radius schuss ' + FC.radius.schuss + ': größer als der Berührabstand (' + kurz(minX) + ' Kacheln, Hitbox ' + hb.w + 'x' + hb.h + '), höchstens 0,9: Berühren löst aus, Entschärfen bleibt möglich');
  ok(FC.radius.schuss > minFest, 'Radius schuss auch größer als der Berührabstand von oben/unten (' + kurz(minFest) + ')');
  ok(Object.values(FC.radius).every((v) => v > 0 && v <= 0.9), 'alle Auslösezonen <= 0,9 Kachel');
  ok(wirft(() => Fallen.fallenWirkung('schott', () => {})) && wirft(() => Fallen.fallenWirkung('druck', () => {})) && wirft(() => Fallen.fallenWirkung('schuss', () => {})), 'Register: schott, druck und schuss sind angemeldet');
  const D = require('../content/scanner/datenblaetter.json');
  ok(['schott', 'druck', 'schuss'].every((t) => D.typen[t] && !/Platzhalter/i.test(JSON.stringify(D.typen[t]))), 'Datenblätter schott, druck, schuss: echte Texte');
  ok(D.typen.test && /Platzhalter/.test(D.typen.test.hinweis), 'Typ test bleibt');
  const A = require('../content/buehnen/anker.json');
  ok(['schott', 'druck', 'schuss'].every((t) => A.rollen.falle.attribute.typ.includes(t)), 'anker.json: Typen schott, druck, schuss');
  ok(Buehne.ankerBlockiert({ rolle: 'falle', typ: 'schuss' }) && !Buehne.ankerBlockiert({ rolle: 'falle', typ: 'druck' }) && !Buehne.ankerBlockiert({ rolle: 'falle', typ: 'schott' }) && !Buehne.ankerBlockiert({ rolle: 'falle', typ: 'test' }) && !Buehne.ankerBlockiert({ rolle: 'terminal' }), 'ankerBlockiert: nur Fallen des Typs aus der Config');
  ok(Buehne.ankerBlockiert({ rolle: 'falle', typ: 'druck' }, { blockiert: { druck: true } }) === true, 'ankerBlockiert nimmt eine übergebene Config (Server game.C, Client)');
  const S = szene({ arena: arenaDruck });
  ok(Buehne.pruefen(S.k).warnungen.every((w) => w.code !== 'K-FALLE'), 'Prüfer: keine K-FALLE-Warnung ohne Schott-Falle');
}

// ======================================================================
section('Schott: schließt sich, öffnet nach der Dauer, Hacken öffnet früher');
{
  const S = szene({ spieler: 2, arena: arenaSchott, god: false }); const { g, p, ps } = S;
  const q = ps[1];
  S.hinKachel(q, 14, 1); S.lauf(0.3);
  ok(S.z('arena.schottA') === 'offen' && S.z('arena.schottB') === 'offen' && !S.solid(S.an('falle.tA').x + 2, S.an('falle.tA').y), 'Vorbedingung: Schott A und B offen, begehbar');
  const sh0 = S.schild(p), t0 = SPY.spieler.length;
  S.hinKachel(p, 6, 3); S.hinKachel(q, 6, 3);   // beide stehen im selben Tick auf der Falle
  S.lauf(DT * 2);
  const kA = S.k.kanten['arena.schottA'].tiles[0];
  ok(S.z('falle.tA') === 'ausgeloest', 'Betreten löst die Falle aus');
  ok(S.z('arena.schottA') === 'zu' && S.solid(kA[0], kA[1]), 'Schott A (Abstand 2 Kacheln) ist zu und fest');
  ok(S.z('arena.schottB') === 'offen', 'Schott B (außerhalb des Radius ' + cfgSchott.radius + ') bleibt offen');
  ok(S.evn('falleSchott', (e) => e.an === 1) === 1, 'zwei Spieler im selben Tick: die Wirkung läuft genau einmal (ein Ereignis falleSchott)');
  ok(S.evs('falleSchott')[0].kanten.join() === 'arena.schottA' && S.evs('falleSchott')[0].dauer === cfgSchott.dauer, 'falleSchott: Kantenliste und Dauer');
  ok(S.evn('ankerZustand', (e) => e.anker === 'arena.schottA' && e.zustand === 'zu') === 1, 'Kantenzustand kommt als ankerZustand (zu)');
  ok(S.schild(p) === sh0 && !p.downed && SPY.spieler.length === t0, 'ohne Schaden: kein hitPlayer, Schild unverändert');
  ok(S.notes.some((m) => /Schotts schließen/.test(m.text)) && S.notes.filter((m) => /Schotts schließen/.test(m.text)).length === 2, 'beide Spieler am Boden bekommen den Hinweis');
  const ko = S.snap().away.ko; ok(Array.isArray(ko) && ko.length >= 1, 'Snapshot ko trägt die geschlossene Kante');
  ok(Fallen.ausloesen(g, S.aw, { id: 'falle.tA', x: 0, y: 0, px: 0, py: 0, typ: 'schott', start: 'verborgen' }, p) === false, 'zweites Auslösen derselben Falle: false');
  S.lauf(cfgSchott.dauer - 1);
  ok(S.z('arena.schottA') === 'zu', 'kurz vor Ablauf (' + (cfgSchott.dauer - 1) + ' s): noch zu');
  S.lauf(1.2);
  ok(S.z('arena.schottA') === 'offen' && !S.solid(kA[0], kA[1]) && S.evn('falleSchott', (e) => e.an === 0) === 1, 'nach ' + cfgSchott.dauer + ' s: offen, begehbar, Ereignis an 0');
  S.lauf(3);
  ok(S.z('arena.schottA') === 'offen' && S.evn('falleSchott') === 2, 'danach nichts mehr (kein zweites Schließen)');
  ok(!hatFehler(g), 'keine Laufzeitfehler');
}
{
  // Hacken am freien Schott (E halten, 1 s) öffnet früher; der Ablauf der Dauer lässt es offen
  const S = szene({ arena: arenaSchott, god: false }); const { p } = S;
  S.hinKachel(p, 6, 3); S.lauf(DT * 2);
  ok(S.z('arena.schottA') === 'zu', 'Vorbedingung: Schott A zu');
  S.hinKachel(p, 7, 3);   // Nachbarkachel des Schotts (und der Falle, außerhalb der ausgelösten Zone)
  S.act(true);
  ok(p.hold && p.hold.kind === 'anker:tuer', 'E am geschlossenen Schott startet das Hacken (Hold anker:tuer)');
  S.lauf(Buehne.TUER_ZEIT.schott + 0.3);
  ok(S.z('arena.schottA') === 'offen', 'nach der Haltezeit (' + Buehne.TUER_ZEIT.schott + ' s): offen, lange vor den ' + cfgSchott.dauer + ' s');
  S.act(false);
  S.lauf(cfgSchott.dauer);
  ok(S.z('arena.schottA') === 'offen' && S.evn('falleSchott', (e) => e.an === 0) === 1 && !S.aw.fallenSchott['arena.schottA'], 'Ablauf der Dauer lässt es offen, Eintrag aufgeräumt');
}
{
  // technischer Eingang: Hacken (6 s) -> gehackt; Zustand davor gehackt wird nach der Dauer wiederhergestellt
  const S = szene({ arena: arenaSchott, god: false }); const { p } = S;
  S.hinKachel(p, 10, 6); S.lauf(DT * 2);
  ok(S.z('falle.tB') === 'ausgeloest' && S.z('arena.schottB') === 'zu', 'Schott B (technischer Eingang) schließt sich');
  S.hinKachel(p, 11, 7);
  const l = []; Anker.interactionsAt(S.g, p, S.an('arena.eingang').x, S.an('arena.eingang').y, l);
  ok(l.length === 1 && l[0].op === 'hacken', 'am Eingang bietet E „hacken“ an');
  S.act(true); S.lauf(CONFIG.anker.halten.schott_hacken - 0.5);
  ok(S.z('arena.schottB') === 'zu', 'vor Ablauf der Hackzeit noch zu');
  S.lauf(0.8);
  ok(S.z('arena.schottB') === 'gehackt' && !S.solid(S.k.kanten['arena.schottB'].tiles[0][0], S.k.kanten['arena.schottB'].tiles[0][1]), 'nach ' + CONFIG.anker.halten.schott_hacken + ' s Hacken: gehackt, begehbar');
  S.act(false);
  S.lauf(cfgSchott.dauer);
  ok(S.z('arena.schottB') === 'gehackt' && !S.aw.fallenSchott['arena.schottB'], 'Ablauf der Dauer lässt das gehackte Schott gehackt (Zustand davor war offen)');
}
{
  const S = szene({ arena: arenaSchott, god: false }); const { p } = S;
  S.fest('arena.schottB', 'gehackt');
  S.hinKachel(p, 10, 6); S.lauf(DT * 2);
  S.hinKachel(p, 1, 1);
  S.lauf(cfgSchott.dauer + 0.5);
  ok(S.z('arena.schottB') === 'gehackt', 'ungehackt geschlossenes Schott kehrt auf den Zustand davor zurück (gehackt, nicht nur offen)');
}
{
  // nie in eine feste Kachel hinein: wer im Schott steht, wird nicht eingeschlossen; geschlossen wird, sobald er draußen ist; geöffnet wird nach der Dauer ab Auslösen
  const S = szene({ spieler: 2, arena: arenaSchott, god: false }); const { p, ps } = S; const q = ps[1];
  S.hinKachel(q, 8, 3);   // mitten im Schott
  S.hinKachel(p, 6, 3);
  S.lauf(DT * 2);
  const [tx, ty] = S.k.kanten['arena.schottA'].tiles[0];
  ok(S.z('falle.tA') === 'ausgeloest' && S.z('arena.schottA') === 'offen', 'jemand steht im Schott: es schließt nicht (kein Eingeschlossener)');
  ok(!S.solid(tx, ty) && Math.floor(q.x / TILE) === tx && Math.floor(q.y / TILE) === ty, 'der Spieler steht frei in der Kachel');
  S.lauf(5);
  ok(S.z('arena.schottA') === 'offen', 'nach 5 s noch offen, solange er dort steht');
  S.hinKachel(q, 10, 2); S.lauf(DT * 3);
  ok(S.z('arena.schottA') === 'zu', 'kaum ist er draußen, schließt das Schott (noch in der Dauer)');
  S.lauf(cfgSchott.dauer - 5 - DT * 3 + 1);
  ok(S.z('arena.schottA') === 'offen', 'geöffnet wird nach ' + cfgSchott.dauer + ' s ab dem Auslösen, nicht ab dem späten Schließen');
}
{
  // Gegner im Schott: bei Auslösen nicht geschlossen
  const S = szene({ arena: arenaSchott, god: false }); const { p, g } = S;
  const c = Physics.tileCenter(S.A.x0 + 8, S.A.y0 + 4);
  S.hinKachel(p, 5, 1);
  const hp = he0 && 3;
  g.away.drones.push({ id: 'dx', alive: true, x: c.x, y: c.y, kind: 'raider', hp: 3 });
  S.hinKachel(p, 6, 3);
  Fallen.update(g, DT);
  Fallen.update(g, DT);
  ok(S.z('falle.tA') === 'ausgeloest' && S.z('arena.schottA') === 'offen', 'Gegner steht im Schott: es schließt nicht');
  g.away.drones.length = 0; Fallen.update(g, DT);
  ok(S.z('arena.schottA') === 'zu', 'Gegner weg: es schließt');
  ok(SPY.gegner.length === 0, 'Gegner wurde nie getroffen');
}
{
  // Entschärfen vorher verhindert die Wirkung; Hold-Abbruch durch Treffer
  const S = szene({ arena: arenaSchott, god: false }); const { p } = S;
  S.hinKachel(p, 7, 3); S.act(true); S.lauf(CONFIG.anker.halten.falle + 0.3); S.act(false);
  ok(S.z('falle.tA') === 'entschaerft', 'Falle per E halten entschärft');
  S.hinKachel(p, 6, 3); S.lauf(0.5);
  ok(S.z('falle.tA') === 'entschaerft' && S.z('arena.schottA') === 'offen' && S.evn('falleSchott') === 0, 'entschärft: Betreten schließt nichts');
  const S2 = szene({ arena: arenaSchott, god: false }); const p2 = S2.p;
  S2.hinKachel(p2, 7, 3); S2.act(true); S2.lauf(1);
  ok(p2.hold && p2.hold.kind === 'anker:falle', 'Entschärfen läuft');
  combat.hitPlayer(S2.g, p2, 1, { kind: 'raider' });
  ok(!p2.hold, 'Treffer unterbricht das Entschärfen');
  S2.lauf(CONFIG.anker.halten.falle + 0.5);
  ok(S2.z('falle.tA') === 'erkannt', 'nach dem Treffer und ohne neuen Versuch bleibt die Falle erkannt');
}
{
  // ohne Schott im Wirkbereich: wirkungslos, sichtbar (Ereignis, Debug-Meldung, Prüfer-Warnung)
  const S = szene({ arena: arenaSchott, god: false }); const { p } = S;
  const n0 = S.notes.length;
  const w = Buehne.pruefen(S.k).warnungen.filter((x) => x.code === 'K-FALLE');
  ok(w.length === 1 && /falle\.tV/.test(w[0].msg), 'Prüfer-Warnung K-FALLE genau für die Falle ohne Schott (tV)');
  S.hinKachel(p, 3, 7); S.lauf(DT * 2);
  ok(S.z('falle.tV') === 'ausgeloest', 'Falle ohne Schott löst aus');
  ok(S.evn('falleWirkungslos', (e) => e.anker === 'falle.tV' && e.grund === 'kein_schott') === 1, 'Ereignis falleWirkungslos');
  ok(S.notes.slice(n0).some((m) => /ohne Wirkung/.test(m.text)), 'Hinweis an den Auslöser (Debug)');
  ok(S.evn('falleSchott') === 0 && S.z('arena.schottA') === 'offen', 'kein Schott geschlossen');
  const S2 = szene({ arena: arenaSchott, god: false, debug: false }); const n1 = S2.notes.length;
  S2.hinKachel(S2.p, 3, 7); S2.lauf(DT * 2);
  ok(S2.evn('falleWirkungslos') === 1 && !S2.notes.slice(n1).some((m) => /ohne Wirkung/.test(m.text)), 'ohne Debug: Ereignis, aber keine Spielermeldung');
  const S3 = szene({ arena: arenaDruck, god: false });
  S3.hinKachel(S3.p, 8, 4); S3.lauf(0.2);
  S3.g.handleMessage(S3.cs[0], { t: 'debug', cmd: 'falletest', typ: 'schott', sicht: 'passiv' });
  ok(S3.notes.some((m) => /falletest/.test(m.text) && /kein Schott im Wirkbereich/.test(m.text)), 'Debug falletest schott auf einer Karte ohne Schott: Hinweis, dass die Falle nie wirkt');
}
{
  // echte Station (Seed 3, Kreuzung mit vier Schott-Kanten, eine davon am Rätseltor): die Kanten im Radius schließen sich, die Tor-Kante bleibt, Erreichbarkeit nach der Dauer wie vorher
  const setze = (k) => {   // die Station kommt aus dem Generator (nicht über Buehne.bauen): Anker direkt in die gebaute Karte, Fallenstand neu (wie Debug falletest)
    const r = Buehne.raster(k); const belegt = new Set(k.anker.map((a) => a.x + ',' + a.y));
    const frei = (x, y) => { const i = r.info(x, y); return i && i.kante === 'begehbar' && r.durchgang(x, y) && !belegt.has(x + ',' + y); };
    for (let d = 0; d < 6; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || !frei(21 + dx, 15 + dy) || k.anker.some((a) => a.id === 'falle.st1')) continue;
      k.anker.push({ id: 'falle.st1', rolle: 'falle', x: 21 + dx, y: 15 + dy, typ: 'schott', sicht: 'passiv' });
    }
  };
  const S = szene({ art: 'station', seed: 3, god: false });
  const { g, p, k } = S;
  setze(k); Fallen.standVerwerfen(S.aw);
  const f = S.an('falle.st1');
  const schotts = Object.entries(k.kanten).filter(([, v]) => v.typ === 'schott');
  const torKanten = new Set(Buehne.ankerKanten(k, k.anker.find((a) => a.rolle === 'tor')).map((q) => q.id));
  const erw = schotts.filter(([id, v]) => !torKanten.has(id) && v.zustand === 'offen' && v.tiles.some((t) => Math.hypot(t[0] - f.x, t[1] - f.y) <= cfgSchott.radius)).map(([id]) => id).sort();
  ok(erw.length >= 2 && torKanten.size >= 1 && [...torKanten].every((id) => k.kanten[id].typ === 'schott'), 'Vorbedingung: station Seed 3: ' + erw.length + ' offene Schott-Kanten im Radius, Rätseltor-Kante ' + [...torKanten].join());
  const start = Physics.toTile(p.x, p.y);
  const erreichbar = () => { const solid = interior.awaySolid(g); const seen = new Set([start.x + ',' + start.y]); const q = [[start.x, start.y]]; for (let i = 0; i < q.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = q[i][0] + dx, y = q[i][1] + dy; if (x < 0 || y < 0 || x >= k.w || y >= k.h || seen.has(x + ',' + y) || solid(x, y)) continue; seen.add(x + ',' + y); q.push([x, y]); } return seen; };
  const vorher = erreichbar();
  const torZ = S.z([...torKanten][0]);
  S.hin(p, S.mitte('falle.st1').x, S.mitte('falle.st1').y); S.lauf(DT * 2);
  ok(S.z('falle.st1') === 'ausgeloest', 'echte Station: Falle löst aus');
  ok(erw.every((id) => S.z(id) === 'zu') && schotts.filter(([id]) => !erw.includes(id)).every(([id]) => S.z(id) === (S.aw.zustaende[id] || k.kanten[id].zustand) && !S.aw.fallenSchott[id]), 'echte Station: genau die Schotts im Radius (' + erw.join(', ') + ') schließen sich, alle anderen unberührt');
  ok(S.z([...torKanten][0]) === torZ && !S.aw.fallenSchott[[...torKanten][0]], 'die Kante des Rätseltors bleibt außen (Zustand ' + torZ + ')');
  const waehrend = erreichbar();
  ok(waehrend.size <= vorher.size, 'geschlossen: erreichbare Fläche ' + waehrend.size + ' von ' + vorher.size + ' Kacheln');
  ok(Buehne.fallenSchottKanten(k, { x: k.kanten[[...torKanten][0]].tiles[0][0], y: k.kanten[[...torKanten][0]].tiles[0][1] }, 1).every((q) => !torKanten.has(q.id)), 'fallenSchottKanten lässt Kanten eines tor-Ankers aus');
  S.lauf(cfgSchott.dauer + 0.5);
  ok(erw.every((id) => S.z(id) === 'offen'), 'nach der Dauer wieder alle offen');
  const nachher = erreichbar();
  ok(nachher.size === vorher.size && [...vorher].every((c) => nachher.has(c)), 'Erreichbarkeit nach der Dauer wie vor der Falle (' + nachher.size + ' Kacheln)');
  ok(!hatFehler(g), 'keine Laufzeitfehler');
}
{
  // Prüfer: K-FALLE auch an echter Karte; Rätseltor-Fall
  const k = Buehne.bauen({ art: 'ruine', seed: 3, zustand: 'verfallen', spiel: true });
  const r = Buehne.raster(k);
  const t = [...Array(k.h).keys()].flatMap((y) => [...Array(k.w).keys()].map((x) => [x, y])).find(([x, y]) => r.info(x, y) && r.info(x, y).kante === 'begehbar' && r.durchgang(x, y) && !k.anker.some((a) => a.x === x && a.y === y));
  k.anker.push({ id: 'falle.p', rolle: 'falle', x: t[0], y: t[1], typ: 'schott', sicht: 'verborgen' });
  ok(Buehne.pruefen(k).warnungen.some((w) => w.code === 'K-FALLE' && /falle\.p/.test(w.msg)), 'Buehne.pruefen: Schott-Falle ohne Schott in Reichweite -> K-FALLE (Warnung, kein Fehler)');
  ok(!Buehne.pruefen(k).fehler.some((e) => e.code === 'K-FALLE'), 'K-FALLE ist nur eine Warnung');
}

// ======================================================================
section('Druckverlust: Gefahrenfeld ohne Kollisionsbox');
{
  const S = szene({ spieler: 4, arena: arenaDruck, god: false }); const { g, ps } = S;
  const [p0, p1, p2, p3] = ps;
  ok(!S.solid(S.an('falle.tD').x, S.an('falle.tD').y), 'keine Kollisionsbox: die Kachel der Druckfalle ist begehbar');
  S.hinKachel(p0, 1, 1); S.hinKachel(p1, 5, 6); S.hinKachel(p2, 12, 5); S.hinKachel(p3, 2, 2); p3.downed = true;
  S.lauf(0.3);
  const sh = ps.map((p) => S.schild(p));
  SPY.spieler.length = 0;
  S.hinKachel(p0, 3, 4); S.hinKachel(p1, 3, 4); S.lauf(DT * 2);   // p0 und p1 im selben Tick auf der Falle
  ok(S.z('falle.tD') === 'ausgeloest', 'Falle ausgelöst');
  ok(S.evn('falleFeld', (e) => e.an === 1) === 1, 'zwei Spieler im selben Tick: genau ein Gefahrenfeld (ein Ereignis)');
  const ev = S.evs('falleFeld')[0];
  ok(ev.typ === 'druck' && ev.dauer === cfgDruck.dauer && Array.isArray(ev.rect) && ev.rect[2] === 8 && ev.rect[3] === AH && ev.rect[0] === S.A.x0, 'Ereignis falleFeld: Raum A als Rechteck, Dauer');
  ok(S.notes.filter((m) => /Druckverlust/.test(m.text)).length === 4, 'Hinweis an alle am Boden');
  S.hinKachel(p0, 1, 1); S.hinKachel(p1, 5, 6);   // wieder in Raum A, kein Auslöser mehr
  S.lauf(cfgDruck.takt - 0.15);
  ok(treffer('druck').length === 0 && S.schild(p0) === sh[0], 'vor dem ersten Takt: kein Schaden');
  S.lauf(0.3);
  ok(treffer('druck', p0.id).length === 1 && treffer('druck', p1.id).length === 1 && treffer('druck').length === 2, 'nach einem Takt: genau ein Treffer je Spieler im Raum (zwei insgesamt, nicht doppelt)');
  ok(S.schild(p0) === sh[0] - 1 && S.schild(p1) === sh[1] - 1, 'je ein Segment weniger');
  ok(S.schild(p2) === sh[2] && S.schild(p3) === sh[3] && treffer('druck', p2.id).length === 0, 'Spieler außerhalb des Raums (B) und der Liegende (downed) bleiben unberührt');
  const t1 = treffer('druck', p0.id)[0];
  ok(t1.segs === 1 && t1.src.kind === 'druck' && Number.isFinite(t1.src.x) && !t1.src.flaeche, 'Quelle { kind: druck, x, y }, 1 Segment');
  S.lauf(cfgDruck.takt);
  ok(treffer('druck', p0.id).length === 2 && S.schild(p0) === sh[0] - 2, 'zweiter Takt: wieder ein Segment (Takt ' + cfgDruck.takt + ' s)');
  ok(Math.abs(treffer('druck', p0.id)[1].t - treffer('druck', p0.id)[0].t - cfgDruck.takt) < DT * 1.5, 'Abstand der Treffer = Takt (' + kurz(treffer('druck', p0.id)[1].t - treffer('druck', p0.id)[0].t) + ' s)');
  // Spieler 1 verlässt den Raum: Takt setzt zurück, kein Schaden mehr; Wiedereintritt: erst nach einem vollen Takt
  S.hinKachel(p1, 12, 4);
  const n1 = treffer('druck', p1.id).length;
  S.lauf(cfgDruck.takt * 2 + 0.5);
  ok(treffer('druck', p1.id).length === n1, 'Raum verlassen: p1 bekommt keinen Schaden mehr');
  S.hinKachel(p1, 4, 4); S.lauf(cfgDruck.takt - 0.2);
  ok(treffer('druck', p1.id).length === n1, 'Wiedereintritt: der Takt beginnt neu (nach ' + (cfgDruck.takt - 0.2) + ' s noch nichts)');
  S.lauf(0.4);
  ok(treffer('druck', p1.id).length === n1 + 1, 'nach einem vollen Takt im Raum: der nächste Treffer');
  // p0 geht zu Boden (Schild 3 -> 0, vierter Treffer wundet): danach kein Folgeschaden
  S.hinKachel(p0, 1, 1);
  S.lauf(cfgDruck.takt * 3);
  ok(p0.downed === true && S.evn('wounded', (e) => e.pid === p0.id) === 1, 'dritter Treffer nach dem Schild wundet p0 (genau eine Verwundung)');
  const nn = treffer('druck', p0.id).length;
  S.lauf(cfgDruck.takt * 3);
  ok(treffer('druck', p0.id).length === nn, 'ein Spieler am Boden (downed) bekommt keinen Folgeschaden');
  ok(!hatFehler(g), 'keine Laufzeitfehler');
}
{
  // Dauer: genau dauer/takt Treffer, dann Ende; god ohne Schaden; Bewusstlose, an Bord, getrennt
  const S = szene({ spieler: 3, arena: arenaDruck, god: true }); const { g, ps } = S;
  const [p0, p1, p2] = ps;
  S.hinKachel(p0, 3, 4); S.hinKachel(p1, 2, 2); S.hinKachel(p2, 1, 1);
  p1.zustand = 'bewusstlos'; p1.bewusstBis = 1e9; p2.zone = 'ship';
  SPY.spieler.length = 0;
  const sh = S.schild(p0);
  S.lauf(DT * 2);
  S.hinKachel(p0, 1, 5);
  S.lauf(cfgDruck.dauer + 3);
  const nTreffer = treffer('druck', p0.id).length;
  ok(nTreffer === Math.floor(cfgDruck.dauer / cfgDruck.takt), 'ein Spieler bleibt die ganze Dauer: genau ' + Math.floor(cfgDruck.dauer / cfgDruck.takt) + ' Treffer (gezählt ' + nTreffer + ')');
  ok(S.schild(p0) === sh, 'god: hitPlayer wird gerufen, aber kein Schaden (Schild unverändert)');
  ok(treffer('druck', p1.id).length === 0 && treffer('druck', p2.id).length === 0, 'Bewusstlose (zustand) und Spieler an Bord werden nicht getroffen');
  ok(S.evn('falleFeld', (e) => e.an === 0) === 1, 'Ende: Ereignis falleFeld an 0');
  const n = treffer('druck').length; S.lauf(cfgDruck.takt * 3);
  ok(treffer('druck').length === n, 'nach dem Ende kein weiterer Treffer');
  const letzter = treffer('druck', p0.id).slice(-1)[0].t, ersterT = S.ev.find((e) => e[0] === 'falleFeld')[2];
  ok(Math.abs(letzter - ersterT - cfgDruck.dauer) < DT * 3, 'der letzte Treffer liegt am Ende der Dauer (' + kurz(letzter - ersterT) + ' s)');
}
{
  // Verlassen des Raums setzt den Takt zurück: 1,5 s im Raum, 1 s draußen, 1 s wieder drin = noch kein Treffer (zählte die Zeit weiter, wären es 2,5 s)
  const S = szene({ spieler: 2, arena: arenaDruck, god: true }); const [p0, p1] = S.ps;
  S.hinKachel(p0, 3, 4); S.hinKachel(p1, 12, 6); S.lauf(DT * 2);
  S.hinKachel(p0, 12, 4);
  S.hinKachel(p1, 4, 2); S.lauf(cfgDruck.takt * 0.75);
  S.hinKachel(p1, 12, 6); S.lauf(cfgDruck.takt * 0.5);
  S.hinKachel(p1, 4, 2); S.lauf(cfgDruck.takt * 0.5);
  ok(treffer('druck', p1.id).length === 0, 'Takt je Spieler: nach Verlassen und Wiedereintritt zählt die Zeit neu');
  S.lauf(cfgDruck.takt * 0.6);
  ok(treffer('druck', p1.id).length === 1, 'und nach einem vollen Takt am Stück trifft es');
}
{
  // Spieler, die später in den Raum kommen, haben einen eigenen Takt; Entschärfen vorher verhindert die Wirkung; Hold-Abbruch durch den Druck-Treffer
  const S = szene({ spieler: 2, arena: arenaDruck, god: false }); const { ps } = S; const [p0, p1] = ps;
  S.hinKachel(p0, 3, 4); S.lauf(DT * 2);
  S.hinKachel(p0, 1, 1); S.hinKachel(p1, 12, 6);
  S.lauf(cfgDruck.takt * 0.6);
  S.hinKachel(p1, 4, 2);
  S.lauf(cfgDruck.takt * 0.45);
  ok(treffer('druck', p0.id).length === 1 && treffer('druck', p1.id).length === 0, 'p0 hat nach einem Takt getroffen, der später eingetretene p1 noch nicht (eigener Takt)');
  S.lauf(cfgDruck.takt * 0.6);
  ok(treffer('druck', p1.id).length === 1, 'p1 wird einen vollen Takt nach seinem Eintritt getroffen');
  const T = szene({ arena: arenaDruck, god: false }); const q = T.p;
  T.hinKachel(q, 3, 3); T.act(true); T.lauf(CONFIG.anker.halten.falle + 0.3); T.act(false);
  ok(T.z('falle.tD') === 'entschaerft', 'Druckfalle entschärft');
  T.hinKachel(q, 3, 4); T.lauf(cfgDruck.takt * 2);
  ok(T.z('falle.tD') === 'entschaerft' && T.evn('falleFeld') === 0 && treffer('druck').length === 0 && T.schild(q) === 3, 'entschärft: Betreten wirkt nicht');
  // Hold-Abbruch: p entschärft tE (erkannt) in Raum A, während das Feld läuft
  const U = szene({ spieler: 2, arena: arenaDruck, god: false }); const a = U.ps[0], b = U.ps[1];
  U.hinKachel(b, 3, 4); U.lauf(DT * 2);
  U.hinKachel(b, 1, 1);
  U.hinKachel(a, 6, 6); U.act(true, 0); U.lauf(1);
  ok(a.hold && a.hold.kind === 'anker:falle', 'Spieler entschärft tE im Raum, Feld läuft');
  U.lauf(cfgDruck.takt);
  ok(!a.hold && treffer('druck', a.id).length >= 1 && U.z('falle.tE') === 'erkannt', 'der Druck-Treffer unterbricht das Entschärfen (Hold weg, Falle noch erkannt)');
}
{
  // Gegner im Raum: nie getroffen; Falle löst nicht durch Gegner aus
  const S = szene({ arena: arenaDruck, god: false }); const { g, p } = S;
  const c = Physics.tileCenter(S.A.x0 + 4, S.A.y0 + 4);
  S.hinKachel(p, 3, 4); S.lauf(DT * 2);
  S.hinKachel(p, 1, 1);
  const he = SPY.gegner.length;
  const dr = { id: 'dx', alive: true, x: c.x, y: c.y, kind: 'raider', hp: 3 };
  for (let i = 0; i < Math.round(cfgDruck.takt * 3 / DT); i++) { g.away.drones.length = 0; g.away.drones.push(dr); Fallen.update(g, DT); }
  ok(SPY.gegner.length === he && dr.hp === 3 && dr.alive, 'Gegner im Raum: nie getroffen (hitEnemy nie gerufen, hp unverändert)');
}
{
  // zweite Variante nur per Config: Dornen im Radius, 2 Segmente, Takt 1 s, Dauer 6 s
  const cfgG = (S) => S.g.C.anker.falle;
  const S = szene({ spieler: 2, arena: arenaDruck, god: true });
  cfgG(S).feld.dorn = { dauer: 6, takt: 1, segmente: 2, bereich: 'radius', radius: 2, quelle: 'dorn' };
  const ab = Typen.feldAnmelden('dorn');
  try {
    const [p0, p1] = S.ps;
    SPY.spieler.length = 0;
    S.hinKachel(p0, 2, 7); S.lauf(DT * 2);
    ok(S.z('falle.tR') === 'ausgeloest' && S.evn('falleFeld', (e) => e.typ === 'dorn' && e.an === 1) === 1, 'Variante dorn nur per Config: löst aus, falleFeld typ dorn');
    const e1 = S.evs('falleFeld')[0];
    ok(e1.r === 2 && !e1.rect, 'Bereich radius: Kreis 2 Kacheln (kein Rect)');
    S.hinKachel(p0, 2, 6); S.hinKachel(p1, 2, 3);   // p0 1 Kachel entfernt (innen), p1 4 Kacheln (außen)
    S.lauf(6.5);
    const h = treffer('dorn');
    ok(h.length === 6 && h.every((x) => x.pid === p0.id && x.segs === 2), 'Dornen: 6 Treffer à 2 Segmente auf den Spieler im Radius (Takt 1 s, Dauer 6 s), keiner auf den Außenstehenden');
    ok(treffer('druck').length === 0, 'die Config-Variante nutzt keinen Druck-Wert');
    ok(S.evn('falleFeld', (e) => e.typ === 'dorn' && e.an === 0) === 1, 'Ende nach der Dauer');
  } finally { ab(); delete cfgG(S).feld.dorn; }
}

// ======================================================================
section('Selbstschussanlage: Kollisionsbox, Salve, Sichtlinie, Reichweite');
{
  const S = szene({ spieler: 2, arena: arenaSchuss, god: false }); const { g, ps } = S; const [p0, p1] = ps;
  const a = S.an('falle.tS'), c = S.mitte('falle.tS');
  const hb = CONFIG.player.hitbox;
  ok(S.solid(a.x, a.y) && S.solid(S.an('falle.tT').x, S.an('falle.tT').y), 'Kollisionsbox: die Kachel der Anlage ist fest (awaySolid)');
  ok(!S.solid(a.x + 1, a.y) && !S.solid(a.x, a.y + 1), 'Nachbarkacheln bleiben frei');
  // Berühren löst aus und die Box hält die Figur draußen
  S.hinKachel(p0, 7, 4);
  S.hinKachel(p1, 14, 1);
  p0.input.mx = -1;
  S.lauf(1.2);
  p0.input.mx = 0;
  ok(S.z('falle.tS') === 'ausgeloest', 'Berühren der Anlage löst aus (Auslösezone ' + FC.radius.schuss + ' Kacheln liegt außerhalb der Box)');
  ok(p0.x >= c.x + TILE / 2 + hb.w / 2 - 0.01 && p0.x <= c.x + TILE / 2 + hb.w / 2 + 2, 'Spieler läuft nicht durch die Anlage (Abstand ' + kurz(p0.x - c.x) + ' px, Box + halbe Hitbox = ' + (TILE / 2 + hb.w / 2) + ')');
  S.lauf(2);
  const alle = schuesse(S);
  ok(alle.length === cfgSchuss.schuesse && alle.map((e) => e.i).join() === '0,1,2', 'Salve: genau ' + cfgSchuss.schuesse + ' Schuss (i 0, 1, 2), danach Schluss');
  const evs = S.ev.filter((e) => e[0] === 'selbstschuss');
  const t0 = S.ev.find((e) => e[0] === 'ankerZustand' && e[1].anker === 'falle.tS' && e[1].zustand === 'ausgeloest')[2];
  ok(evs.every((e, i) => Math.abs(e[2] - t0 - (cfgSchuss.verzug + i * cfgSchuss.takt)) < DT * 2.5), 'Zeiten: ' + evs.map((e) => kurz(e[2] - t0)).join(', ') + ' s (Verzug ' + cfgSchuss.verzug + ', Takt ' + cfgSchuss.takt + ')');
  ok(alle.every((e) => e.pid === p0.id && e.x === Math.round(c.x) && e.y === Math.round(c.y) && e.tx === Math.round(p0.x)), 'jeder Schuss auf den nächsten Spieler (p0), Ursprung = Anlage');
  const th = treffer('selbstschuss');
  ok(th.length === 3 && th.every((x) => x.pid === p0.id && x.segs === cfgSchuss.segmente && x.src.kind === 'selbstschuss' && x.src.x === c.x && x.src.y === c.y), 'hitPlayer 3x mit Quelle { kind: selbstschuss, x, y }, 1 Segment');
  ok(!p0.downed && S.schild(p0) === 0, 'drei Segmente: Schild auf 0, noch keine Wunde');
  ok(S.evn('falleFeld') === 0 && S.evn('falleSchott') === 0, 'keine fremden Wirkungen');
  const n = SPY.spieler.length; S.lauf(3);
  ok(SPY.spieler.length === n, 'nach der Salve ist Schluss');
  ok(!hatFehler(g), 'keine Laufzeitfehler');
}
{
  // Ziel wechselt: nächster Spieler je Schuss, mit Sichtlinie
  const S = szene({ spieler: 2, arena: arenaSchuss, god: false }); const { g, ps } = S; const [p0, p1] = ps;
  const c = S.mitte('falle.tS');
  S.hinKachel(p0, 5, 4); S.hinKachel(p1, 6, 6);   // beide in Sicht
  p0.input.mx = 0;
  // auslösen: ein dritter Punkt (p0 steht noch 2 Kacheln entfernt: kein Auslöser), wir lösen per Berühren von p0 aus
  S.hinKachel(p0, 4, 4, 0, 0); p0.x = c.x + 20; p0.y = c.y;   // innerhalb der Zone (20 px < 28,8)
  S.lauf(DT * 2);
  ok(S.z('falle.tS') === 'ausgeloest', 'Auslöser: p0 an der Anlage');
  // nach dem ersten Schuss tauschen die Entfernungen
  let getauscht = false;
  S.lauf(2, () => {
    if (!getauscht && schuesse(S).length === 1) { getauscht = true; S.hinKachel(p0, 11, 4); S.hinKachel(p1, 4, 5); }
  });
  const s = schuesse(S);
  ok(s.length === 3 && s[0].pid === p0.id && s[1].pid === p1.id && s[2].pid === p1.id, 'Ziel wechselt: Schuss 1 auf p0 (nah), danach auf p1 (jetzt näher): ' + s.map((e) => e.pid).join() + ' (p0=' + p0.id + ', p1=' + p1.id + ')');
}
{
  // Sichtlinie, Reichweite, Deckung
  SPY.spieler.length = 0;
  // Wand zwischen Anlage und Ziel (dx 6, dy 0..2): Ziel hinter der Wand
  { const S = szene({ spieler: 2, arena: arenaSchuss, god: false }); const [p0, p1] = S.ps; const c = S.mitte('falle.tS');
    S.hinKachel(p1, 15, 8);   // weit weg (jenseits Reichweite): kein Ziel
    S.hin(p0, c.x + 20, c.y); S.lauf(DT * 2);
    S.hinKachel(p0, 8, 1);   // 5 Kacheln, hinter der Wand
    S.lauf(2);
    ok(S.z('falle.tS') === 'ausgeloest' && schuesse(S).length === 0 && treffer('selbstschuss').length === 0, 'Sichtlinie: Ziel hinter der Wand wird nicht beschossen (kein Schuss, kein Treffer)'); }
  // gleiche Entfernung ohne Wand: Treffer
  { const S = szene({ spieler: 2, arena: arenaSchuss, god: false }); const [p0, p1] = S.ps; const c = S.mitte('falle.tS');
    S.hinKachel(p1, 15, 8);
    S.hin(p0, c.x + 20, c.y); S.lauf(DT * 2);
    S.hinKachel(p0, 8, 6);   // ähnliche Entfernung, freie Sicht
    S.lauf(2);
    ok(schuesse(S).length === 3 && treffer('selbstschuss', p0.id).length === 3, 'Gegenprobe: ohne Wand drei Treffer'); }
  // Reichweite
  { const S = szene({ spieler: 2, arena: arenaSchuss, god: false }); const [p0, p1] = S.ps; const c = S.mitte('falle.tS');
    S.hinKachel(p1, 15, 8);
    S.hin(p0, c.x + 20, c.y); S.lauf(DT * 2);
    S.hin(p0, c.x + (cfgSchuss.reichweite + 0.2) * TILE, c.y);
    S.lauf(2);
    ok(schuesse(S).length === 0, 'Reichweite: ' + (cfgSchuss.reichweite + 0.2) + ' Kacheln entfernt wird nicht beschossen'); }
  { const S = szene({ spieler: 2, arena: arenaSchuss, god: false }); const [p0, p1] = S.ps; const c = S.mitte('falle.tS');
    S.hinKachel(p1, 15, 8);
    S.hin(p0, c.x + 20, c.y); S.lauf(DT * 2);
    S.hin(p0, c.x + (cfgSchuss.reichweite - 0.2) * TILE, c.y);
    S.lauf(2);
    ok(schuesse(S).length === 3 && treffer('selbstschuss', p0.id).length === 3, 'Reichweite: ' + (cfgSchuss.reichweite - 0.2) + ' Kacheln entfernt wird beschossen'); }
  // Deckung: geduckt hinter niedriger Deckung (dx 8, dy 4; Ziel dx 9) sicher, aufrecht nicht
  { const S = szene({ spieler: 2, arena: arenaSchuss, god: false }); const [p0, p1] = S.ps; const c = S.mitte('falle.tS');
    S.hinKachel(p1, 15, 8);
    S.hin(p0, c.x + 20, c.y); S.lauf(DT * 2);
    S.hinKachel(p0, 9, 4); p0.crouch = true;
    S.lauf(2);
    ok(S.z('falle.tS') === 'ausgeloest' && schuesse(S).length === 0, 'Deckung: geduckt hinter niedriger Deckung wird nicht getroffen'); }
  { const S = szene({ spieler: 2, arena: arenaSchuss, god: false }); const [p0, p1] = S.ps; const c = S.mitte('falle.tS');
    S.hinKachel(p1, 15, 8);
    S.hin(p0, c.x + 20, c.y); S.lauf(DT * 2);
    S.hinKachel(p0, 9, 4); p0.crouch = false;
    S.lauf(2);
    ok(schuesse(S).length === 3, 'Deckung: aufrecht hinter niedriger Deckung wird getroffen (sie schützt nur Geduckte)'); }
}
{
  // nicht getroffen: downed, bewusstlos, an Bord; god ohne Schaden; Gegner nie
  const S = szene({ spieler: 4, arena: arenaSchuss, god: false }); const [p0, p1, p2, p3] = S.ps; const c = S.mitte('falle.tS');
  S.hin(p0, c.x + 20, c.y); S.lauf(DT * 2);
  S.hinKachel(p0, 15, 8);   // Auslöser außer Reichweite
  S.hinKachel(p1, 5, 4); p1.downed = true;
  S.hinKachel(p2, 5, 5); p2.zustand = 'bewusstlos'; p2.bewusstBis = 1e9;
  S.hinKachel(p3, 5, 6); p3.zone = 'ship';
  S.lauf(2);
  ok(schuesse(S).length === 0 && treffer('selbstschuss').length === 0, 'Liegende, Bewusstlose und Spieler an Bord sind keine Ziele');
  const T = szene({ spieler: 2, arena: arenaSchuss, god: true }); const q = T.p; const c2 = T.mitte('falle.tS');
  T.hin(q, c2.x + 20, c2.y); T.lauf(DT * 2);
  T.hinKachel(q, 6, 5);
  const sh = T.schild(q);
  T.lauf(2);
  ok(schuesse(T).length === 3 && T.schild(q) === sh && !q.downed, 'god: Salve fällt, aber kein Schaden');
  const U = szene({ spieler: 2, arena: arenaSchuss, god: false }); const u = U.p; const c3 = U.mitte('falle.tS');
  U.hin(u, c3.x + 20, c3.y); U.lauf(DT * 2);
  U.hinKachel(u, 15, 8);
  const he = SPY.gegner.length;
  const dr = { id: 'dx', alive: true, x: c3.x + 3 * TILE, y: c3.y, kind: 'raider', hp: 3 };
  for (let i = 0; i < Math.round(3 / DT); i++) { U.g.away.drones.length = 0; U.g.away.drones.push(dr); Fallen.update(U.g, DT); }
  ok(SPY.gegner.length === he && dr.hp === 3 && schuesse(U).length === 0, 'Gegner in Sicht: nie beschossen (hitEnemy nie gerufen, kein Schuss ohne Spielerziel)');
  // Gegner löst nicht aus
  const V = szene({ arena: arenaSchuss, god: false }); const cv = V.mitte('falle.tS');
  V.hinKachel(V.p, 15, 8);
  const dv = { id: 'dy', alive: true, x: cv.x + 20, y: cv.y, kind: 'raider', hp: 3 };
  for (let i = 0; i < 20; i++) { V.g.away.drones.length = 0; V.g.away.drones.push(dv); Fallen.update(V.g, DT); }
  ok(V.z('falle.tS') === 'erkannt', 'Gegner an der Anlage löst nicht aus');
}
{
  // Entschärfen von der Nachbarkachel: die Zone (0,9) und die Hitbox lassen den Platz; vorher entschärft: nie ausgelöst; Treffer bricht ab; die Box bleibt auch entschärft
  const S = szene({ spieler: 2, arena: arenaSchuss, god: false }); const { ps } = S; const [p0, p1] = ps;
  const a = S.an('falle.tS'), c = S.mitte('falle.tS');
  const abstand = FC.radius.schuss * TILE + 2;   // knapp außerhalb der Zone, in der Nachbarkachel (32 bis 48 px)
  S.hin(p0, c.x + abstand, c.y);
  const l = []; Anker.interactionsAt(S.g, p0, a.x, a.y, l);
  ok(abstand > TILE / 2 && abstand < TILE * 1.5, 'Abstand ' + kurz(abstand) + ' px liegt in der Nachbarkachel (' + TILE / 2 + ' bis ' + TILE * 1.5 + ' px)');
  S.hinKachel(p1, 15, 8);
  S.act(true, 0);
  ok(S.z('falle.tS') === 'erkannt' && p0.hold && p0.hold.kind === 'anker:falle', 'in der Nachbarkachel knapp außerhalb der Zone: E startet das Entschärfen (löst nicht aus)');
  S.lauf(1.5);
  combat.hitPlayer(S.g, p0, 1, { kind: 'raider' });
  ok(!p0.hold, 'Treffer unterbricht das Entschärfen der Anlage');
  S.act(false, 0); S.act(true, 0);
  S.lauf(CONFIG.anker.halten.falle + 0.4);
  ok(S.z('falle.tS') === 'entschaerft' && schuesse(S).length === 0, 'neuer Versuch: entschärft, keine Salve');
  ok(S.solid(a.x, a.y), 'entschärft bleibt die Kollisionsbox');
  p0.input.mx = -1; S.hin(p0, c.x + 60, c.y); p0.input.mx = -1;
  S.lauf(1);
  p0.input.mx = 0;
  ok(p0.x >= c.x + TILE / 2 + CONFIG.player.hitbox.w / 2 - 0.01 && S.z('falle.tS') === 'entschaerft' && schuesse(S).length === 0, 'Gegen die entschärfte Anlage laufen: blockiert, löst nichts aus');
  // Auch die Zone selbst: noch nicht entschärft, innerhalb der Zone steht niemand, ohne zu auslösen
  const T = szene({ arena: arenaSchuss, god: false }); const tc = T.mitte('falle.tS');
  T.hin(T.p, tc.x + FC.radius.schuss * TILE - 1, tc.y); T.lauf(DT * 2);
  ok(T.z('falle.tS') === 'ausgeloest', 'Knapp innerhalb der Zone: löst aus');
}
{
  // Typ-abhängig: Blockade nur für schuss; Gegner und Spieler teilen die Regel (awaySolid)
  const S = szene({ arena: arenaDruck, god: false });
  ok(!S.solid(S.an('falle.tD').x, S.an('falle.tD').y) && !S.solid(S.an('falle.tE').x, S.an('falle.tE').y), 'druck und tst: begehbar');
  const T = szene({ arena: arenaSchott, god: false });
  ok(!T.solid(T.an('falle.tA').x, T.an('falle.tA').y), 'schott: begehbar');
  // Config-getrieben: der Typ druck wird per Config blockierend (kein Sonderfall im Code)
  const U = szene({ arena: arenaDruck, god: false });
  U.g.C.anker.falle.blockiert.druck = true;
  ok(U.solid(U.an('falle.tD').x, U.an('falle.tD').y), 'blockiert.druck = true macht die Druckfalle fest (Cache folgt der Config)');
  U.g.C.anker.falle.blockiert.druck = false;
  ok(!U.solid(U.an('falle.tD').x, U.an('falle.tD').y), 'zurück auf false: begehbar');
  // Prüfer (Karten-Prüfer K-ANKER-WAND, K-ERREICHBAR): ein blockierender Anker zählt wie ein Objektanker, ein begehbarer (druck) nicht
  const pruefung = (typ) => {
    const k = Buehne.bauen({ art: 'ruine', seed: 3, zustand: 'verfallen', spiel: true });
    const r0 = Buehne.raster(k);
    const ziel = k.anker.find((q) => q.rolle === 'terminal');
    const nb = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ x: ziel.x + dx, y: ziel.y + dy }));
    const offen = nb.filter((t) => r0.durchgang(t.x, t.y) && !k.anker.some((q) => q.x === t.x && q.y === t.y));
    const zu = nb.filter((t) => offen[0] && t !== offen[0]);
    const rows = k.rows.map((rr) => rr.split(''));
    for (const t of zu) if (!k.anker.some((q) => q.x === t.x && q.y === t.y)) rows[t.y][t.x] = '#';
    k.rows = rows.map((rr) => rr.join(''));
    k.anker.push({ id: 'falle.pr', rolle: 'falle', x: offen[0].x, y: offen[0].y, typ, sicht: 'passiv' });
    return { fehler: Buehne.pruefen(k).fehler, ziel: ziel.id };
  };
  const mitSchuss = pruefung('schuss'), mitDruck = pruefung('druck');
  ok(mitSchuss.fehler.some((e) => e.code === 'K-ERREICHBAR' && e.msg.includes(mitSchuss.ziel)), 'Prüfer: eine Anlage (schuss) vor dem einzigen Zugang zum Ziel sperrt den Weg -> K-ERREICHBAR');
  ok(!mitDruck.fehler.some((e) => e.code === 'K-ERREICHBAR' && e.msg.includes(mitDruck.ziel)), 'Prüfer: dieselbe Lage mit einer Druckfalle (begehbar) ist erreichbar');
}

// ======================================================================
section('Weltstand: laufende Wirkung, Verhalten nach Laden');
{
  const S = szene({ spieler: 2, arena: arenaSchott, god: false }); const { g, id, p } = S;
  S.fest('arena.schottB', 'gehackt');
  S.hinKachel(p, 6, 3); S.lauf(DT * 2);
  S.hinKachel(p, 10, 6); S.lauf(DT * 2);
  ok(S.z('arena.schottA') === 'zu' && S.z('arena.schottB') === 'zu', 'zwei Schotts laufen (A offen -> zu, B gehackt -> zu)');
  S.lauf(2);
  L.sichern(g, id);
  const e = L.eintrag(g, id);
  const z = JSON.parse(JSON.stringify(e.zustaende));
  ok(z['arena.schottA'] === undefined && z['arena.schottB'] === 'gehackt', 'Weltstand-Eintrag: die Schotts stehen mit dem Zustand davor (A wie im Start = fehlt, B gehackt), nicht zu');
  ok(z['falle.tA'] === 'ausgeloest' && z['falle.tB'] === 'ausgeloest', 'die Fallen bleiben ausgelöst');
  ok(S.z('arena.schottA') === 'zu', 'die laufende Welt bleibt dabei unberührt (noch zu)');
  ok(JSON.stringify(JSON.parse(JSON.stringify(L.toSave(g)))).includes('ausgeloest') && !/"arena.schott[AB]":"zu"/.test(JSON.stringify(L.toSave(g))), 'toSave: JSON-fest, ohne geschlossene Schotts');
  // Außenkarte entladen und neu aufbauen: die Zeitwirkung ist weg (kein erneutes Schließen, keine Wirkung), die Falle bleibt ausgelöst
  delete g.aways[id];
  const aw2 = L.get(g, id); g.away = aw2; aw2.active = true;
  ok(aw2 !== S.aw && Anker.zustand(g, id, 'arena.schottA') === 'offen' && Anker.zustand(g, id, 'arena.schottB') === 'gehackt', 'nach dem Neuaufbau: Schotts wieder in ihrem Zustand davor');
  ok(Anker.zustand(g, id, 'falle.tA') === 'ausgeloest' && Anker.zustand(g, id, 'falle.tB') === 'ausgeloest', 'Fallen bleiben ausgelöst');
  const n0 = S.evn('falleSchott');
  S.hinKachel(p, 6, 3); S.lauf(cfgSchott.dauer + 2);
  ok(Anker.zustand(g, id, 'arena.schottA') === 'offen' && Anker.zustand(g, id, 'arena.schottB') === 'gehackt' && S.evn('falleSchott') === n0, 'ausgelöste Fallen laden nie wieder aus; keine Wirkung läuft weiter');
  ok(!hatFehler(g), 'keine Laufzeitfehler');
}
{
  // Druck und Schuss: Wirkung steht nicht im Weltstand; nach dem Neuaufbau kein Schaden, Falle bleibt ausgelöst
  const S = szene({ spieler: 2, arena: arenaDruck, god: false }); const { g, id, p } = S;
  S.hinKachel(p, 3, 4); S.lauf(DT * 2); S.hinKachel(p, 1, 1); S.lauf(1);
  L.sichern(g, id);
  delete g.aways[id];
  const aw2 = L.get(g, id); g.away = aw2; aw2.active = true;
  SPY.spieler.length = 0;
  S.lauf(cfgDruck.takt * 3);
  ok(Anker.zustand(g, id, 'falle.tD') === 'ausgeloest' && treffer('druck').length === 0, 'Druck nach dem Neuaufbau: ausgelöst, aber kein weiterer Schaden (die Zeitwirkung ist nicht im Weltstand)');
}

// ======================================================================
section('1 bis 4 Spieler');
for (const np of [1, 2, 3, 4]) {
  const S = szene({ spieler: np, arena: arenaDruck, god: false }); const { ps } = S;
  S.hinKachel(ps[0], 3, 4); S.lauf(DT * 2);
  for (const [i, p] of ps.entries()) S.hinKachel(p, 1 + i, 1);
  S.lauf(cfgDruck.takt + 0.3);
  ok(S.evn('falleFeld', (e) => e.an === 1) === 1 && treffer('druck').length === np && ps.every((p) => treffer('druck', p.id).length === 1), np + ' Spieler: ein Feld, je ein Treffer');
  const T = szene({ spieler: np, arena: arenaSchuss, god: false }); const c = T.mitte('falle.tS');
  for (const [i, p] of T.ps.entries()) T.hinKachel(p, 5 + (i % 2), 4 + Math.floor(i / 2) * 2);
  T.hin(T.ps[0], c.x + 20, c.y); T.lauf(DT * 2); T.hinKachel(T.ps[0], 5, 4);
  T.lauf(2);
  ok(schuesse(T).length === 3 && schuesse(T).every((e) => e.pid === T.ps[0].id), np + ' Spieler: drei Schuss auf den Nächsten');
  const U = szene({ spieler: np, arena: arenaSchott, god: false });
  for (const [i, p] of U.ps.entries()) U.hinKachel(p, 6, 3);
  U.lauf(DT * 2);
  ok(U.evn('falleSchott', (e) => e.an === 1) === 1 && U.z('arena.schottA') === 'zu', np + ' Spieler: das Schott schließt genau einmal');
}

// Aufräumen: Spione zurück
combat.hitPlayer = hp0; combat.hitEnemy = he0;
console.log('\n' + (fails ? fails + ' FEHLER' : 'alles ok') + ' (' + n + ' Prüfungen)');
process.exit(fails ? 1 : 0);
