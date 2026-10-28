'use strict';
// Raum: Orte/Szenen, Flug, Docken, Faltsprung, Energie/Reaktor, Schilde, Waffen (Phasenkanonen),
// Gegner (mit Schildsektoren), Projektile, Asteroiden, Ziel-Scan, Weitscan, Marker. CONTRACT-M1 §4–§6, §9.2.
const Physics = require('../../shared/physics.js');
const Protocol = require('../../shared/protocol.js');
const Locations = require('../../shared/locations.js');
const Flight = require('../../shared/flight.js');
const interior = require('./interior.js');
const Station = require('./station.js');   // R1 §4.4: aktive Station statt Ort (Besetzt-Prüfungen, Waffenautomatik)
const Pilot = require('./pilot.js');
const Escort = require('./escort.js');   // S2 §5 Schützlinge (ohne Schützlinge/Gegnerziel kein Einfluss auf den Ablauf)
const Entern = require('./entern.js');   // B1 §7 (Team ENTERN): kampfunfähiges Feindschiff; Stub -> wie bisher
const Sprung = require('./sprung.js');
const Reise = require('./reise.js');   // B3 (Team SEKTOR): Reisen/Faltsprung, Welle 0 wörtlich aus dieser Datei verschoben
const Drift = require('../../shared/drift.js');   // W2 AP3b: Brocken-Lage als reine Funktion der Spielzeit (Server und Client)
const Schilde = require('../../shared/schilde.js');   // EK1b: Schildsegmente der Gegner (Seiten mit mehreren Seitenbereichen)
const Gsys = require('./gegnersystem.js');   // SYS-01 C1a-1: Systemmodell der Gegner (Zonen, Integrität, Waffen- und Schildwirkung)
const Gegnertod = require('./gegnertod.js');   // SYS-01 C1a-2: Tod der Gegner (Reaktor-Countdown, Sofort-Tod, Kapern über den Schildgenerator)
const Sturm = require('./sturm.js');   // SYS-02a: Reparatursperre und Systemfaktor des Sturms
const Gegnerreparatur = require('./gegnerreparatur.js');   // SYS-01 C2a: Reparatur der Gegner (Vorgänge, Rückschlag)
const Gegnersprung = require('./gegnersprung.js');   // SYS-01 C2b: Notfallsprung der Gegner (Szenenbaustein gegner_notfallsprung)
const Zielsysteme = require('./zielsysteme.js');   // SUND-04a-1 A: gezielter Systemtreffer (Antrieb), gleiche Regeln für beide Seiten – ohne e.zs und Schalter ohne Wirkung
const Verfolgung = require('./verfolgung.js');   // SUND-04a-1 A: Szenentyp A6 – Zielschiff flieht zum Fluchtpunkt (e.fluchtZiel), Sprungladung, Ausgang gestellt/entkommen
const Konvoi = require('./konvoi.js');   // EK3 Teil B: Konvoi-Szene (Transporter, Eskorte, Route, Sprung) – ohne Konvoi in der Szene ohne Wirkung
const Alarm = require('./alarm.js');   // EK2: Alarmstufe, Patrouillen, Signatur, Minen, Einsprung (ohne Alarm in der Szene ohne Wirkung)
const Zonen = require('./zonen.js');   // SL6: Zonen mit Wirkung (Drift, Hitze, Schaden, Sicht, Ertrag); ohne scene.zonen ohne Wirkung
const Modul = require('./module.js');   // PAN-01 A: Bordmodule (je 1 Energie), Frachtraum gesichert, Krankenstation, Werkstatt
const Fracht = require('./fracht.js');   // PAN-01 A: ungesicherte Ladung bei Hüllentreffern
const Waffen = require('./schiffswaffen.js');   // PAN-01 C: Waffen der Lerche (neun Plätze, Katalog, Ladepool, Torpedowerfer)
const Katalog = require('../../shared/schiffskatalog.js');   // PAN-01 C: Waffen, Gegner-Abbildung, Torpedo
const Ladung = require('./ladung.js');   // SL6: Gewicht schwerer Ladung (Deuterium) senkt die Triebwerksleistung
const Besitz = require('./besitz.js');   // SUND-01 D: Besitzer, Posten, Andock-Erlaubnis (Banner); ohne Overlay/Modus ohne Wirkung
const Sektoren = require('../../shared/sektoren.js');   // Kennung: Fraktion des Hexes der Szene (Volk der Gegner)
const { makeRng, clamp, dist, turnToward } = require('../util.js');

const POWER_SYSTEMS = Protocol.POWER_SYSTEMS;
const isDown = (st) => st === 'broken' || st === 'offline';
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const EPS = 1e-6;   // Gleitkomma-Rest bei Gegner-HP/-Schilden
const GEGNER_GESCHOSSE = ['enemy', 'emp', 'sperrfeuer', 'sturm', 'etorpedo', 'estreu'];   // Geschosse der Gegner (PAN-01 C: Sturmnadeln, Torpedo, Granate)

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- M3a: Grunddaten (CONTRACT-M3 §4, §5) ----------
const M3_MOUNTS = ['bow', 'port', 'stbd'];   // die drei Startplätze (Altname); alle neun: Katalog.PRIORITAET
const MOUNT_SYSTEM = Waffen.MOUNT_SYSTEM;
const WEAPON_SYSTEMS = ['weapon_bow', 'battery_port', 'battery_stbd', 'lafette_5', 'lafette_7', 'lafette_9', 'lafette_1', 'lafette_3', 'lafette_2'];
const EMITTERS = ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];   // Sektor 0..3
const M3_SYSTEMS = ['reactor', 'engines', 'shields', 'transfer', 'thruster_port', 'thruster_stbd',
  'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port', 'weapon_bow', 'battery_port', 'battery_stbd',
  'lafette_5', 'lafette_7', 'lafette_9', 'lafette_1', 'lafette_3', 'lafette_2',
  'modul_1', 'modul_2', 'modul_3', 'modul_4'];
const SECTOR_LABEL = ['Bug', 'Steuerbord', 'Heck', 'Backbord'];
const ENEMY_LABEL = { raider: 'Jäger', korvette: 'Korvette', fregatte: 'Fregatte', kreuzer: 'Kreuzer', sentinel: 'Wächter', pylon: 'Pylon', relay: 'Störrelais' };
const STATE_RANK = { ok: 0, damaged: 1, offline: 2, broken: 3 };

function M3(game) { return game.C.spaceM3; }
function M3B(game) { return game.C.spaceM3b || {}; }
// QA M3b: Schusswinkel mit Vorhalt auf die Lerche (Abfangpunkt bei Geschossgeschwindigkeit v), Anteil f (0..1) des Vorhalts
function leadAngle(x, y, ship, v, f) {
  const rx = ship.x - x, ry = ship.y - y; const k = Math.max(0, Math.min(1, Number(f) || 0));
  const vx = (ship.vx || 0) * k, vy = (ship.vy || 0) * k;
  const a = vx * vx + vy * vy - v * v, b = 2 * (rx * vx + ry * vy), c = rx * rx + ry * ry;
  let t = 0;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : 0;
  else { const disc = b * b - 4 * a * c; if (disc >= 0) { const s = Math.sqrt(disc); const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a); t = Math.max(t1, t2) > 0 ? (t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2)) : 0; } }
  t = Math.max(0, Math.min(3, t));
  return Math.atan2(ry + vy * t, rx + vx * t);
}
function sysState(game, sys) { const s = game.ship.systems[sys]; return s == null ? 'ok' : s; }
function stateKey(st) { return st === 'offline' ? 'broken' : (st || 'ok'); }   // offline (EMP) wirkt wie zerstört
function emitterFor(sector) {
  if (typeof interior.emitterFor === 'function') { const e = interior.emitterFor(sector); if (e) return e; }
  return EMITTERS[sector];
}

// Zustand lazy ergänzen: game.js (SERVER-SHIP) legt evtl. noch den alten Zustand an.
function ensureM3(game) {
  const ship = game.ship; const S = M3(game);
  if (ship._m3) return;
  ship._m3 = true;
  for (const sys of M3_SYSTEMS) if (ship.systems[sys] == null) ship.systems[sys] = 'ok';
  if (!ship.fragile) ship.fragile = {};
  if (!ship.mount) ship.mount = {};
  Waffen.ensureMounts(game);   // PAN-01 C: Zustand je offenem, bestücktem Platz (Start: Lanze 8, Batterien 4 und 6)
  if (!ship.wAllocIntent) ship.wAllocIntent = Waffen.standardVerteilung(game);
  if (ship.turnVel == null) ship.turnVel = 0;
  const sh = ship.shields;
  if (sh.burst === undefined) sh.burst = null;
  if (sh.burstCd == null) sh.burstCd = 0;
  if (!sh.cap) sh.cap = [4, 4, 4, 4];
  const st = game.stats;
  for (const k of ['bursts', 'burstsPerfect', 'dodges', 'dodgeEvades']) if (st[k] == null) st[k] = 0;
  if (ship.lastDodgeT == null) ship.lastDodgeT = -99;
}

// ---------- Szenen ----------
// opts.docked: Start angedockt (nur Orte mit Liegeplatz). Sonst Ankunft am arrive-Punkt.
function enterScene(game, locId, opts) {
  const C = game.C;
  const loc = Locations.get(locId) || Locations.get('hafen');
  const sc = loc.scene;
  const ship = game.ship;
  const fromScene = ship.scene;
  // SUND-01 D: Besitzer des Hexes (Banner), Posten (kleine Station ohne Liegeplatz), Andock-Erlaubnis; ohne Overlay/Modus ändert sich nichts
  const hexB = loc.hex || Sektoren.hexVonOrt(loc.id);
  const frB = hexB ? Besitz.besitzer(game, hexB) : null;
  const postenB = hexB && !sc.station && Besitz.istPosten(game, hexB) ? Besitz.postenLage(sc) : null;
  const dockB = Besitz.dockLage(game, sc, hexB);   // SUND-02b A1: fester Liegeplatz oder Stützpunkt der Crew (berechnet, die Szene bleibt unverändert)
  const dockOk = !dockB || !hexB || Besitz.darfAndocken(game, hexB);
  const docked = !!(opts && opts.docked && dockB && dockOk);
  const st = docked ? Object.assign({ angle: 0 }, sc.start || dockB) : sc.arrive;
  ship.scene = loc.id;
  ship.x = st.x; ship.y = st.y; ship.angle = st.angle || 0;
  ship.vx = 0; ship.vy = 0; ship.speed = 0;
  ship.docked = docked; ship.dockedAt = docked ? loc.id : null; ship.dockArmed = !docked;
  ship.helm.turn = 0; ship.helm.thrust = 0; ship.helm.autoStop = false;   // §21.1: Sprung/Szenenwechsel beendet den Allstopp
  ship.helm.stage = stopIndex(game);   // M3b: Ankunft/Andocken steht auf Stopp
  ship.dodgeT = 0;
  ensureM3(game);
  ship.turnVel = 0;
  Waffen.szeneReset(game);
  ship.lastDodgeT = -99;
  ship.jump.dest = null; ship.jump.charge = 0; ship.jump.ready = false;
  game._jumpAuto = false;
  ship.target = null;
  delete ship.zielsystem;   // SUND-04a-1 A
  ship.markers = { captain: null, tactical: null };
  ship.tscan = { targetId: null, progress: 0, on: false, at: 0 };
  ship.scanning = false;
  const sp = game.space;
  sp.w = sc.w; sp.h = sc.h;
  sp.enemies = []; sp.projectiles = []; sp.beams = [];
  Zielsysteme.szeneAn(game, false);   // SUND-04a-1 A: der Szenenschalter gilt nur in der Szene, die ihn setzt
  sp.dockOk = dockOk; sp.dockHinweis = false;   // SUND-01 D: Andocken erlaubt? Hinweis „verweigert“ schon gezeigt?
  sp.asteroids = opts && opts.drift ? makeDriftAsteroids(game, loc, postenB, dockB) : makeAsteroids(game, loc, postenB, dockB);   // W2 AP3b: bewegt nur auf Wunsch (Wellen All)
  sp.salvage = [];
  sp.markers = [];
  Alarm.szeneBetreten(game);   // EK2: Alarm und Minen gelten je Szene
  if (sc.station) sp.markers.push(Object.assign({ kind: sc.station.kind, x: sc.station.x, y: sc.station.y, r: sc.station.r }, sc.station.name ? { name: sc.station.name } : {}, frB && Besitz.modus(game) ? { fr: frB } : {}));   // name: Planeten-Stationen (Methalle, Eisenwald) tragen ihren Namen; fr: Besitzer für das Banner (nur im Modus Freie Fahrt)
  if (postenB) sp.markers.push({ kind: 'station', x: postenB.x, y: postenB.y, r: postenB.r, name: 'Posten', posten: true, fr: frB });
  if (dockB && dockOk) sp.markers.push({ kind: 'dock', x: dockB.x, y: dockB.y, r: C.travel.dockDist });
  ship.asteroidImmune = {};
  game.asteroidsDirty = true;
  if (game.explore) game.explore.location = loc.id;
  if (sc.beam && game.setAwayMap && !game.players.some((p) => p.zone === 'away')) game.setAwayMap(sc.beam.map);
  // S2 §5: Rückzugsregel gilt nur im Ort; Schützlinge springen mit oder bleiben zurück
  if (sp.retreatRule) delete sp.retreatRule;
  Gegnersprung.szeneVerlassen(game);   // SYS-01 C Nacharbeit: Notfallsprung-Regeln des Bausteins gelten nur in der Szene, die sie setzt (Abnahme 16)
  if (sp.escorts && sp.escorts.length) { try { Escort.onSceneChange(game, fromScene); } catch (err) { if (game.countError) game.countError('escort-scene', err); } }
  if (game.weltsim) { try { require('./kriegslage-szene.js').betreten(game, hexB); } catch (err) { if (game.countError) game.countError('sim-szene', err); } }   // SUND-02a A2: Flotte der Sim im Hex? Szene beginnt (nach dem Aufbau, nur Freie Fahrt Sund)
}

function makeAsteroids(game, loc, posten, dockB) {
  const sc = loc.scene;
  const n = sc.asteroids || 0;
  if (!n) return [];
  const rng = makeRng((game.seed ^ 0xA57E ^ hashStr(loc.id)) >>> 0);
  const f = sc.field || { x0: 200, x1: sc.w - 120, y0: 80, y1: sc.h - 80 };
  const keep = [sc.arrive, sc.station, sc.dock, posten, dockB].filter(Boolean);
  const hiddenPts = loc.hidden || [];
  const list = [];
  let guard = 0;
  while (list.length < n && guard++ < 6000) {
    const r = Math.round(rng.range(16, 44));
    const x = Math.round(rng.range(f.x0, f.x1));
    const y = Math.round(rng.range(f.y0, f.y1));
    if (keep.some((k) => dist(x, y, k.x, k.y) < (k.r || 0) + 280)) continue;
    if (hiddenPts.some((h) => dist(x, y, h.x, h.y) < r + 110)) continue;
    if (list.some((a) => dist(a.x, a.y, x, y) < a.r + r + 70)) continue;
    list.push({ id: 'a' + list.length, x, y, r, seed: rng.int(100000) });
  }
  return list;
}

// W2 AP3b: Brocken mit Bahn (shared/drift.js). Gleiche Zahl und Größe wie still, aber jede Bahnstrecke hält Abstand zu den
// Schutzpunkten (Ankunft, Station, Dock: wie still + 280 px), zu Verstecken und zu allen anderen Bahnen (nie Berührung).
function makeDriftAsteroids(game, loc, posten, dockB) {
  const sc = loc.scene;
  const n = sc.asteroids || 0;
  if (!n) return [];
  const D = (game.C.arena && game.C.arena.drift) || { tempo: [12, 40], amplitude: [80, 240], drehung: 0.6 };
  const rng = makeRng((game.seed ^ 0xD71F7 ^ hashStr(loc.id)) >>> 0);
  const f = sc.field || { x0: 200, x1: sc.w - 120, y0: 80, y1: sc.h - 80 };
  const keep = [sc.arrive, sc.station, sc.dock, posten, dockB].filter(Boolean);
  const hiddenPts = loc.hidden || [];
  const list = []; const bahnen = [];
  const Mi = Drift.MILLI;
  let guard = 0;
  while (list.length < n && guard++ < 12000) {
    const r = Math.round(rng.range(16, 44));
    const x = Math.round(rng.range(f.x0, f.x1));
    const y = Math.round(rng.range(f.y0, f.y1));
    const dir = rng.range(-Math.PI, Math.PI);
    const amp = Math.round(rng.range(D.amplitude[0], D.amplitude[1]));
    const tempo = Math.round(rng.range(D.tempo[0], D.tempo[1]));
    const ph = rng.range(-Math.PI, Math.PI);
    const rot = rng.range(-D.drehung, D.drehung);
    const a = { id: 'a' + list.length, x, y, r, seed: rng.int(100000),
      b: [Math.round(dir * Mi), tempo, amp, Math.round(ph * Mi), Math.round(rot * Mi)] };
    const s = Drift.strecke(a);
    if (Math.min(s.x1, s.x2) - r < f.x0 - 60 || Math.max(s.x1, s.x2) + r > f.x1 + 60) continue;
    if (Math.min(s.y1, s.y2) - r < 40 || Math.max(s.y1, s.y2) + r > sc.h - 40) continue;
    if (keep.some((k) => Drift.punktStrecke(k.x, k.y, s) < (k.r || 0) + 280 + r)) continue;
    if (hiddenPts.some((h) => Drift.punktStrecke(h.x, h.y, s) < r + 110)) continue;
    if (list.some((o, i) => Drift.streckeStrecke(bahnen[i], s) < o.r + r + 30)) continue;
    list.push(a); bahnen.push(s);
  }
  return list;
}

// ---------- W2 AP3b: Nebel und Brocken – dieselben Regeln für Lerche und Gegner ----------
// Nebel (Ort mit fog): Sensor- und Zielerfassungs-Reichweite × CONFIG.sensors.fogFactor.
//  - Sensorreichweite (CONFIG.sensors.range): Ziele aufschalten (weapons.target) – der Client zeigt dieselbe Reichweite.
//  - Zielerfassung (CONFIG.tscan.range): Ziel-Scan und Waffen. Wirksame Waffenreichweite = min(Waffe, Zielerfassung),
//    für Lanze, Batterien und Bolzenwerfer der Lerche genauso wie für Feuern und Laden der Gegner.
//    Ohne Nebel ist die Zielerfassung (800) größer als jede Waffe (≤ 650): keine Wirkung.
// Wo die Regel gilt: CONFIG.sensors.nebelServer 'wellen' = nur im Modus Wellen All (Kampagne wie bisher), 'immer' = überall.
function nebelAktiv(game) {
  const S = game.C.sensors || {};
  if (S.nebelServer === 'immer') return true;
  return !!(game.arena && game.arena.kind === 'arena_space' && game.arena.szene);
}
function nebelFaktor(game) {
  const loc = Locations.get(game.ship.scene);
  const S = game.C.sensors || {};
  const nebel = loc && loc.fog && nebelAktiv(game) ? (S.fogFactor != null ? Number(S.fogFactor) : 0.5) : 1;
  return nebel * Zonen.sichtFaktor(game);   // SL6: Sichtgrenze der Zone, in der die Lerche liegt (ohne Zonen exakt 1)
}
function sensorReichweite(game) { return ((game.C.sensors && game.C.sensors.range) || 1400) * nebelFaktor(game); }
function erfassung(game) { return ((game.C.tscan && game.C.tscan.range) || 800) * nebelFaktor(game); }
function waffenReichweite(game, range) { return Math.min(range, erfassung(game)); }

// Brocken jetzt (bewegt: Lage zur Spielzeit, still: die Liste selbst)
function brocken(game) { return Drift.jetzt(game.space.asteroids, game.time); }
function brockenStats(game) { return game.stats.brocken || (game.stats.brocken = { lerche: 0, gegner: 0, schuesse: 0, strahlen: 0 }); }
// Körper (x, y, vx, vy) aus Brocken hinausschieben; die Geschwindigkeit relativ zum Brocken prallt ab (Faktor 1,6 wie
// bisher bei der Lerche). onHit(a) je Berührung. Still: Rechnung wie vor W2 (Brocken-Tempo 0).
function brockenStoss(game, body, rad, onHit) {
  for (const a of brocken(game)) {
    const d = dist(body.x, body.y, a.x, a.y);
    const min = a.r + rad;
    if (d >= min || d === 0) continue;
    const nx = (body.x - a.x) / d, ny = (body.y - a.y) / d;
    body.x = a.x + nx * min; body.y = a.y + ny * min;
    const avx = a.vx || 0, avy = a.vy || 0;
    if (typeof body.vx === 'number' && typeof body.vy === 'number') {
      const vn = (body.vx - avx) * nx + (body.vy - avy) * ny;
      if (vn < 0) { body.vx -= 1.6 * vn * nx; body.vy -= 1.6 * vn * ny; }
    }
    if (onHit) onHit(a);
  }
}
// Erster Brocken auf der Strecke (x1,y1)->(x2,y2) -> { x, y, a } | null (Strahlwaffen: Lanze, Batterien, Ladungen)
function brockenImWeg(game, x1, y1, x2, y2) {
  const list = brocken(game);
  if (!list.length) return null;
  const h = Drift.strahlTrifft(list, x1, y1, x2, y2);
  return h ? { x: x1 + (x2 - x1) * h.t, y: y1 + (y2 - y1) * h.t, a: h.a, t: h.t } : null;
}
// Ausweichen ohne Flugmodell (kinematische Gegner, moveLegacy): Liegt ein Brocken auf den nächsten `look` px der
// Bewegungsrichtung (ux, uy), seitlich vom Brocken weg lenken. -> neue Einheitsrichtung
function brockenAusweichen(game, x, y, ux, uy, rad, look) {
  const list = brocken(game);
  if (!list.length) return { x: ux, y: uy };
  let hx = ux, hy = uy;
  for (const a of list) {
    const rx = a.x - x, ry = a.y - y;
    const along = rx * ux + ry * uy;
    if (along < 0 || along > look + a.r) continue;
    const perp = -rx * uy + ry * ux;   // >0: Brocken links der Bahn
    const clear = a.r + rad + 30;
    if (Math.abs(perp) >= clear) continue;
    const s = perp >= 0 ? -1 : 1;      // vom Brocken weg
    const w = 2.5 * (1 - Math.abs(perp) / clear) + 0.4;
    hx += w * s * -uy; hy += w * s * ux;
  }
  const l = Math.hypot(hx, hy) || 1;
  return { x: hx / l, y: hy / l };
}
// Gegner und Brocken: hinausschieben, Treffer wie bei der Lerche (C.asteroid.damage, je Brocken Sperre asteroidImmunity s)
function gegnerRadius(game, e) {
  const SC = game.C.shipClasses && game.C.shipClasses[e.kind];
  return (SC && SC.radius) || (game.C.combat.hitRadius && game.C.combat.hitRadius[e.kind]) || 18;
}
function gegnerBrocken(game, e) {
  if (!game.space.asteroids.length) return;
  const C = game.C;
  const home = e.kind === 'pylon' && e.home ? { x: e.x, y: e.y } : null;
  brockenStoss(game, e, gegnerRadius(game, e), (a) => {
    const im = e.brockenImmun || (e.brockenImmun = {});
    if ((im[a.id] || 0) > game.time) return;
    im[a.id] = game.time + C.flight.asteroidImmunity;
    brockenStats(game).gegner++;
    damageEnemy(game, e, C.asteroid.damage, a.x, a.y);
  });
  if (home) { e.x = home.x; e.y = home.y; e.vx = 0; e.vy = 0; }   // Pylon ist verankert (Turm)
}
// Spawnpunkt nicht in einem Brocken: nach außen schieben (ohne Schaden)
function freiVonBrocken(game, x, y, rad) {
  const p = { x, y, vx: 0, vy: 0 };
  for (let i = 0; i < 3; i++) brockenStoss(game, p, rad + 10, null);
  return p;
}

// Bergungsgut im Splittergürtel (Mission 1): abseits der direkten Linie, frei von Brocken.
function spawnSalvage(game, count) {
  const C = game.C; const sp = game.space;
  const loc = Locations.get(game.ship.scene); const sc = loc.scene;
  const rng = makeRng((game.seed ^ 0x5A17) >>> 0);
  const xs = [800, 1550, 2300];
  sp.salvage = [];
  for (let i = 0; i < count; i++) {
    let best = null;
    for (let k = 0; k < 300 && !best; k++) {
      const x = Math.round(xs[i % xs.length] + rng.range(-150, 150));
      const y = Math.round(sc.arrive.y + (rng.chance(0.5) ? -1 : 1) * rng.range(180, 380));
      if (sp.asteroids.some((a) => dist(a.x, a.y, x, y) < a.r + 90)) continue;
      best = { id: 'sv' + i, x, y, kind: C.salvage.rewards[i % C.salvage.rewards.length] };
    }
    if (best) sp.salvage.push(best);
  }
}
function updateSalvage(game) {
  const sp = game.space; const ship = game.ship; const C = game.C;
  if (!sp.salvage || !sp.salvage.length) return;
  for (const s of sp.salvage.slice()) {
    if (dist(ship.x, ship.y, s.x, s.y) > C.salvage.pickupDist) continue;
    sp.salvage.splice(sp.salvage.indexOf(s), 1);
    game.salvaged = (game.salvaged || 0) + 1;
    let what;
    if (s.kind === 'marks') { game.inventory.marks += C.salvage.marks; what = C.salvage.marks + ' Marken Altmetall'; }
    else { game.inventory[s.kind] = (game.inventory[s.kind] || 0) + 1; what = s.kind === 'ersatzteil' ? 'ein Ersatzteil' : 'ein Flickblech'; }
    game.emit('sfx', { name: 'pickup' });
    game.missionEvent('salvage', { what, n: game.salvaged });
  }
}

// ---------- Energie / Reaktor (§6) ----------
function baseReactorOutput(game) {
  const P = game.C.power; const s = game.ship.systems.reactor;
  // M3a §4.2: zerstört = Notstrom spaceM3.reactorBrokenOutput (2)
  const broken = M3(game).reactorBrokenOutput != null ? M3(game).reactorBrokenOutput : P.reactorBroken;
  return isDown(s) ? broken : s === 'damaged' ? P.reactorDamaged : P.reactor;
}
function reactorOutput(game) {
  const R = game.C.reactorM1; const rc = game.ship.reactorCtl;
  const base = baseReactorOutput(game);
  if (rc.state === 'overload') return base + R.overloadBonus;
  if (rc.state === 'offline') return Math.min(base, R.offlineOutput);
  return base;
}
// PAN-01 A: Energieposten = die drei Hauptsysteme (ship.power) + jedes LAUFENDE Modul (je CONFIG.module.energie).
function powerMain(game) { return POWER_SYSTEMS.reduce((a, k) => a + game.ship.power[k], 0); }
function powerUsed(game) { return powerMain(game) + Modul.energieLauf(game); }
// Bedarf nach Wunsch (eingestellte Hauptsysteme + alle Module, die an sind), auch wenn der Reaktor gerade nicht reicht: Grundlage für technik.power/technik.module
function powerDemand(game) { return powerMain(game) + Modul.energieWunsch(game); }
// Reihenfolge beim Kürzen bei Gleichstand: Waffen zuerst (billigstes System, Ladepunkte = Energie + 2), Schilde zuletzt.
const CUT_ORDER = ['weapons', 'engines', 'shields'];
// Kürzung bei zu wenig Reaktorleistung (beschädigt 6, zerstört 3, Notstrom 2). Reihenfolge, damit die Technik im Kampf nicht plötzlich ein Hauptsystem
// verliert, solange noch ein Modul dranhängt, und doch nichts ganz ausfällt, solange es vermeidbar ist:
//   1. Hauptsysteme von oben kürzen (höchster Wert zuerst, bei Gleichstand CUT_ORDER), aber nie unter 1
//   2. Reicht das nicht: Module abschalten, in der Reihenfolge CONFIG.module.kuerzen (Werkstatt, Frachtraum, Krankenstation zuletzt)
//   3. Reicht auch das nicht (Reaktor unter 3): Hauptsysteme weiter kürzen, bis 0
// Der Wunsch der Technik (powerIntent, Modul.an) bleibt dabei erhalten; nach der Reparatur läuft wieder alles wie eingestellt.
function enforcePower(game) {
  const out = reactorOutput(game);
  const ship = game.ship;
  if (!ship.powerIntent) ship.powerIntent = Object.assign({}, ship.power);
  const pw = ship.power;
  for (const k of POWER_SYSTEMS) pw[k] = Math.max(0, Math.min(game.C.power.maxPerSystem, Number(ship.powerIntent[k]) || 0));
  const mods = Modul.liste(game);
  for (const m of mods) m.lauf = !!m.an && !interior.isDown(ship.systems['modul_' + m.raum]);   // SYS-01 A1a: ein zerstörtes Modul läuft nicht, bis es repariert ist
  const cut = (min) => {
    let top = null;
    for (const k of CUT_ORDER) if (pw[k] > min && (top === null || pw[k] > pw[top])) top = k;
    if (top === null) return false;
    pw[top]--;
    return true;
  };
  while (powerUsed(game) > out && cut(1)) { /* Phase 1 */ }
  if (powerUsed(game) > out) {
    const order = game.C.module.kuerzen;
    const rank = (m) => order.indexOf(m.id);
    const list = mods.filter((m) => m.lauf).sort((a, b) => rank(a) - rank(b) || b.raum - a.raum);   // gleiche Art: höchster Raum zuerst
    for (const m of list) { if (powerUsed(game) <= out) break; m.lauf = false; }
  }
  while (powerUsed(game) > out && cut(0)) { /* Phase 3 */ }
}
function shieldPool(game) {
  const C = game.C; const ship = game.ship;
  const gen = ship.systems.shields;
  if (isDown(gen)) return 0;   // M3a §4.2: Generator zerstört = keine Schilde
  let pool = ship.power.shields * C.shields.pointsPerPower;
  if (gen === 'damaged') pool += M3(game).generatorDamagedPool || 0;   // beschädigt: Pool −2
  if (game.time < game.away.kuppelUntil) pool -= C.support.kuppel.shieldCost;
  return Math.max(0, pool);
}
// M3a §4.2: Emitter je Sektor begrenzen, was der Sektor hält (cap 4 -> 2 -> 0).
function shieldCaps(game) {
  const C = game.C; const f = M3(game).emitterCap;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const st = stateKey(sysState(game, emitterFor(i)));
    const k = f[st] != null ? f[st] : 1;
    out.push(Math.floor(C.shields.maxPerSector * k));
  }
  return out;
}
function enforceShields(game) {
  const sh = game.ship.shields; const pool = shieldPool(game);
  sh.pool = pool;
  const cap = shieldCaps(game);
  sh.cap = cap;
  if (!sh.allocIntent) sh.allocIntent = sh.alloc.slice();
  sh.alloc = sh.allocIntent.map((v, i) => Math.min(v, cap[i]));
  while (sh.alloc.reduce((a, b) => a + b, 0) > pool) {
    let top = 0; for (let i = 0; i < 4; i++) if (sh.alloc[i] > sh.alloc[top]) top = i;
    sh.alloc[top]--;
  }
  for (let i = 0; i < 4; i++) if (sh.current[i] > cap[i]) sh.current[i] = cap[i];
}

function switchHolders(game) {
  const held = { A: false, B: false }; const byPlayer = { A: false, B: false };
  for (const p of game.players) if (p.hold && p.hold.kind === 'switch' && p.connected) { held[p.hold.sw] = true; byPlayer[p.hold.sw] = true; }
  for (const b of game.bots) if (b.task && b.task.kind === 'switch' && b.task.phase === 'work') held[b.task.sw] = true;
  return { held, byPlayer };
}

function updateReactor(game, dt) {
  const R = game.C.reactorM1; const rc = game.ship.reactorCtl;
  if (rc.state === 'overload') {
    rc.overloadLeft = Math.max(0, rc.overloadLeft - dt);
    if (!rc.warned && rc.overloadLeft <= R.warnAt) {
      rc.warned = true;
      game.emit('sfx', { name: 'overload_warn' });
      game.oda(`Reaktor-Überladung endet in ${R.warnAt} s – danach schaltet er ab. Neustart: beide Schalter im Maschinenraum.`, null);
    }
    if (rc.overloadLeft <= 0) {
      rc.state = 'offline'; rc.offlineT = 0; rc.restartProgress = 0; rc.aloneT = 0;
      game.emit('sfx', { name: 'reactor_down' });
      game.oda('Reaktor abgeschaltet – nur Notstrom. Neustart: Schalter A (oben) und B (unten) halten (E) – gleichzeitig oder nacheinander, der erste rastet ein.', null);
      game.missionEvent('reactorOffline', {});
    }
  }
  const { held, byPlayer } = switchHolders(game);
  if (rc.state !== 'offline') { rc.switches = held; rc.latch = { A: 0, B: 0 }; rc.holdT = { A: 0, B: 0 }; rc.restartProgress = 0; rc.needBot = null; rc.aloneT = 0; return; }
  rc.offlineT += dt;
  // Sequentielles Ziehen (solo): ein Schalter, den ein Spieler latchHold s gehalten hat, rastet latchWindow s lang ein und zählt als gehalten
  rc.latch = rc.latch || { A: 0, B: 0 }; rc.holdT = rc.holdT || { A: 0, B: 0 };
  for (const sw of ['A', 'B']) {
    if (byPlayer[sw]) {
      rc.holdT[sw] += dt;
      if (rc.holdT[sw] >= R.latchHold && rc.latch[sw] <= 0) {
        rc.latch[sw] = R.latchWindow;
        const other = sw === 'A' ? 'B' : 'A';
        if (!held[other] && !(rc.latch[other] > 0)) game.oda(`Schalter ${sw} ist eingerastet – ${R.latchWindow} s für Schalter ${other}.`, null);
      }
    } else { rc.holdT[sw] = 0; if (rc.latch[sw] > 0) rc.latch[sw] = Math.max(0, rc.latch[sw] - dt); }
    if (rc.latch[sw] > 0 && byPlayer[sw]) rc.latch[sw] = R.latchWindow;   // solange gehalten, läuft das Fenster nicht ab
    if (rc.latch[sw] > 0) held[sw] = true;
  }
  rc.switches = held;
  // Ein Schalter ist gezogen (gehalten/eingerastet/Schrauber), der andere nicht: nach botAssistAfter s kommt ein freier Schrauber zum anderen
  const spieler = { A: byPlayer.A || rc.latch.A > 0, B: byPlayer.B || rc.latch.B > 0 };
  const onlyOne = (spieler.A !== spieler.B);
  if (onlyOne) {
    rc.aloneT += dt;
    if (rc.aloneT >= R.botAssistAfter && !rc.needBot) {
      rc.needBot = spieler.A ? 'B' : 'A';
      game.oda(`Halt ihn fest – ich schicke einen Schrauber an Schalter ${rc.needBot}.`, null);
    }
  } else if (!spieler.A && !spieler.B) {
    rc.aloneT = 0;
    if (!game.bots.some((b) => b.task && b.task.kind === 'switch')) rc.needBot = null;   // ein vorsorglich geschickter Schrauber (bots.js) bleibt am Schalter
  }
  if (held.A && held.B) {
    rc.restartProgress += dt;
    if (rc.restartProgress >= R.restartTime) reactorOnline(game, 'Reaktor läuft wieder! Saubere Teamarbeit am Schalter.');
  } else rc.restartProgress = 0;
  if (rc.state === 'offline' && rc.offlineT >= R.autoRestartAfter) reactorOnline(game, 'Notstart über die Hilfsbatterie – ruckelig, aber der Reaktor läuft wieder.');
}
function reactorOnline(game, text) {
  const rc = game.ship.reactorCtl;
  rc.state = 'online'; rc.restartProgress = 0; rc.needBot = null; rc.aloneT = 0; rc.offlineT = 0; rc.overloadLeft = 0; rc.warned = false;
  rc.latch = { A: 0, B: 0 }; rc.holdT = { A: 0, B: 0 };
  for (const p of game.players) if (p.hold && p.hold.kind === 'switch') p.hold = null;
  game.emit('sfx', { name: 'reactor_up' });
  game.oda(text, null);
  game.missionEvent('reactorOnline', {});
}

function technikOverload(game) {
  const R = game.C.reactorM1; const ship = game.ship; const rc = ship.reactorCtl;
  if (rc.state === 'overload') return 'Der Reaktor ist bereits überladen.';
  if (rc.state === 'offline') return 'Reaktor ist abgeschaltet – erst neu starten (Maschinenraum, beide Schalter).';
  if (isDown(ship.systems.reactor)) return 'Reaktor zerstört oder offline – erst reparieren.';
  rc.state = 'overload'; rc.overloadLeft = R.overloadTime; rc.warned = false;
  Alarm.laerm(game, 'reaktor');   // EK2: Überladen ist laut
  game.emit('sfx', { name: 'overload_start' });
  game.oda(`Reaktor überladen: +${R.overloadBonus} Energie für ${Math.round(R.overloadTime / 60)} Minuten. Danach ist erst mal Pause.`, null);
  game.missionEvent('overload', {});
  return null;
}

// M3a §4.1: 'weapons' ist Altname = schlechtester Zustand von Lanze und Batterien. Bei SERVER-SHIP ist das ein
// Getter (interior.makeSystems); nur wenn es ein einfaches Feld ist (alter Zustand), schreiben wir es nach.
function syncWeaponsAlias(game) {
  const s = game.ship.systems;
  const d = Object.getOwnPropertyDescriptor(s, 'weapons');
  if (d && (d.get || d.set || !d.writable)) return;
  let worst = 'ok';
  for (const k of WEAPON_SYSTEMS) { const v = s[k] || 'ok'; if (STATE_RANK[v] > STATE_RANK[worst]) worst = v; }
  s.weapons = worst;
}
// Hitze (§4.2): Auswahl macht interior.heatDamage(game, powerSys) (SERVER-SHIP).
function heatDamage(game, k) { interior.heatDamage(game, k); }

function updateSystems(game, dt) {
  const C = game.C; const ship = game.ship;
  interior.updateOffline(game, dt);
  syncWeaponsAlias(game);
  updateReactor(game, dt);
  enforcePower(game);
  Modul.update(game);   // PAN-01 A: Frachtraum gesichert, Zahl der Schrauber
  const rc = ship.reactorCtl;
  ship.reactor = { state: rc.state, output: reactorOutput(game), used: powerUsed(game), overloadLeft: Math.ceil(rc.overloadLeft),
    switches: { A: !!rc.switches.A, B: !!rc.switches.B }, latch: { A: Math.ceil((rc.latch && rc.latch.A) || 0), B: Math.ceil((rc.latch && rc.latch.B) || 0) }, restartProgress: Math.round(Math.min(1, rc.restartProgress / C.reactorM1.restartTime) * 100) / 100 };
  // Hitze
  for (const k of POWER_SYSTEMS) {
    if (ship.power[k] >= C.power.maxPerSystem) ship.heat[k] += C.power.heatAt4 * dt;
    else ship.heat[k] = Math.max(0, ship.heat[k] - C.power.heatCool * dt);
    if (ship.heat[k] >= C.power.heatLimit) {
      ship.heat[k] = 0;
      heatDamage(game, k);
      syncWeaponsAlias(game);
      game.oda(`${cap(interior.sysNameNom(k))} ist überhitzt! Stufe 4 nur kurz fahren, sonst wird's warm.`, 'heat_' + k);
    }
  }
  // O₂ (PAN-01 B: die Lebenserhaltung ist als Station gestrichen; O₂ sinkt nur durch Lecks)
  ship.o2 += C.o2.regen * dt;
  const drill = game.mission && game.mission.isDrill();
  if (!drill) ship.o2 -= C.breach.o2PerSec * ship.breachList.length * dt;
  ship.o2 = clamp(ship.o2, 0, C.o2.max);
  // Schilde
  enforceShields(game);
  const sh = ship.shields;
  // M3b §4: Schildstoß entfällt (burst/burstCd bleiben eine Version lang null/0)
  sh.burst = null; sh.burstCd = 0;
  if (isDown(ship.systems.shields) || game.transfer.isBeaming(game)) {
    sh.current = [0, 0, 0, 0]; sh.regenT = 0;
  } else {
    for (let i = 0; i < 4; i++) {
      const max = Math.min(sh.cap ? sh.cap[i] : 4, sh.alloc[i]);
      if (sh.current[i] > max) sh.current[i] = max;
    }
    const interval = ship.systems.shields === 'damaged' ? C.shieldsDamagedInterval : C.shields.regenInterval;
    sh.regenT += dt;
    if (game.time < (sh.regenHold || 0)) sh.regenT = 0;   // PAN-01 C: Gegner-Sturmbatterie unterdrückt die Regeneration
    if (sh.regenT >= interval) {
      sh.regenT = 0;
      for (let i = 0; i < 4; i++) if (sh.current[i] < sh.alloc[i]) sh.current[i]++;
    }
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Flug (M3b §2: gemeinsames Flugmodell shared/flight.js) ----------
function lercheClass(game) {
  const SC = game.C.shipClasses;
  return (SC && SC.lerche) || FALLBACK_LERCHE(game);
}
// Falls der Config-Block fehlt (alte Config): Klasse aus den bisherigen ship-Werten
function FALLBACK_LERCHE(game) {
  const S = game.C.ship;
  return { maxSpeed: S.maxSpeed, minSpeed: 0, accel: S.accel, decel: S.accel, brakeFactor: 1, stages: [-0.3, 0, 0.25, 0.5, 0.75, 1],
    stageNames: ['R', 'STOPP', '¼', '½', '¾', 'VOLL'], turnRate: S.turnRate, turnCurve: [[0, 1], [1, 1]], turnAccel: S.turnAccel || 0.8,
    lateralDrag: game.C.flight.lateralDrag, dodge: { impulse: S.dodgeImpulse, cooldown: S.dodgeCooldown, turnPenalty: 1, turnPenaltyTime: 0 }, radius: game.C.flight.radius };
}
// Faktor aus Triebwerkszustand und Energie (vorher in maxSpeed): 0 = kein Schub
function engineSpeedFactor(game) {
  const C = game.C; const ship = game.ship;
  const st = ship.systems.engines === 'offline' ? 'broken' : ship.systems.engines;
  const sf = C.stateFactor.engines[st];
  const pf = C.enginePowerFactor[ship.power.engines];
  return (pf != null ? pf : 1) * (sf != null ? sf : 1) * Ladung.gewichtFaktor(game);   // SL6: ohne schwere Ladung exakt 1
}
function maxSpeed(game) {
  return lercheClass(game).maxSpeed * engineSpeedFactor(game);
}
function stopIndex(game) { return Flight.stopStage(lercheClass(game)); }
function ensureHelmStage(game) {
  const h = game.ship.helm;
  const n = (lercheClass(game).stages || [0]).length;
  if (!Number.isInteger(h.stage) || h.stage < 0 || h.stage >= n) h.stage = stopIndex(game);
}

// M3a §4.2/§6: Düsen begrenzen das Drehen zur jeweiligen Seite (negatives helm.turn = Backbord).
function turnCaps(game) {
  const f = M3(game).turnCap;
  const c = (sys) => { const st = stateKey(sysState(game, sys)); return f[st] != null ? f[st] : 1; };
  return { port: c('thruster_port'), stbd: c('thruster_stbd') };
}

function updateFlight(game, dt) {
  const C = game.C; const ship = game.ship;
  const loc = Locations.get(ship.scene); const sc = loc.scene;
  const cls = lercheClass(game);
  ensureHelmStage(game);
  const h = ship.helm;
  ship.dodgeCd = Math.max(0, ship.dodgeCd - dt);
  h.manned = Station.stationBesetzt(game, 'helm');
  // M3b §0.8: unbesetzte Steuer – Stufe bleibt, Ruder 0, keine Sonderbremse (das Stationshalten aus M1 entfällt)
  if (!h.manned) { h.turn = 0; h.thrust = 0; }
  const caps = turnCaps(game);
  ship.turnCap = caps;
  if (ship.docked) {
    const dp = Besitz.dockLage(game, sc, loc.hex || Sektoren.hexVonOrt(loc.id)) || sc.start || { x: ship.x, y: ship.y };   // SUND-02b A1-Fix: nie werfen (der Stützpunkt kann weg sein, generierte Szenen haben kein sc.start)
    ship.vx = 0; ship.vy = 0; ship.speed = 0; ship.turnVel = 0;
    // Ablegen: Temporegler über Stopp (W). Rückwärts oder Stopp: bleibt angedockt.
    if (h.stage > stopIndex(game)) {
      ship.docked = false; ship.dockedAt = null; ship.dockArmed = false; ship.undockT = game.time; ship.dockHold = false;
      game.emit('sfx', { name: 'dodge' });
      game.missionEvent('undocked', {});
    } else { h.stage = stopIndex(game); h.autoStop = false; ship.x = dp.x; ship.y = dp.y; return; }
  }
  const rudder = h.manned ? (Number(h.turn) || 0) : 0;
  const mods = { speedFactor: engineSpeedFactor(game), turnCapPort: caps.port, turnCapStbd: caps.stbd };
  const body = ship;   // ship hat x, y, angle, vx, vy, turnVel – stage/dodgeT liegen am Schiff
  body.stage = h.stage;
  Flight.stepBody(body, { stage: h.stage, rudder, brake: !!h.autoStop }, cls, mods, dt);
  delete body.stage;   // Stufe lebt in ship.helm.stage (Snapshot), nicht doppelt am Schiff
  // §2 Allstopp: Bremsen, bis das Schiff steht (unter 1 px/s), dann endet er von selbst
  if (h.autoStop && Math.hypot(ship.vx, ship.vy) < 1) { ship.vx = 0; ship.vy = 0; h.autoStop = false; }
  const m = 40, sp = game.space;
  if (ship.x < m) { ship.x = m; ship.vx = Math.max(0, ship.vx); }
  if (ship.x > sp.w - m) { ship.x = sp.w - m; ship.vx = Math.min(0, ship.vx); }
  if (ship.y < m) { ship.y = m; ship.vy = Math.max(0, ship.vy); }
  if (ship.y > sp.h - m) { ship.y = sp.h - m; ship.vy = Math.min(0, ship.vy); }
  ship.speed = Math.hypot(ship.vx, ship.vy);
  // Andocken (Hafen und Vaelen): Dock-Ring langsam anfliegen. Nach dem Ablegen erst einmal Abstand gewinnen.
  const dockL = Besitz.dockLage(game, sc, loc.hex || Sektoren.hexVonOrt(loc.id));   // SUND-02b A1: fester Liegeplatz oder Stützpunkt der Crew
  if (dockL && !ship.docked && sp.dockOk === false) {
    // SUND-01 D: Hafen im Besitz von Germanen/Piraten: kein Dock-Marker, kein Andocken; einmal je Anflug ein Hinweis
    const so = sc.station || dockL;
    const dh = dist(ship.x, ship.y, so.x, so.y);
    if (!sp.dockHinweis && dh < 650) { sp.dockHinweis = true; const t = Besitz.verbotText(game, Sektoren.hexVonOrt(loc.id)); if (t) game.oda(t, null); }
    else if (sp.dockHinweis && dh > 1000) sp.dockHinweis = false;
  } else if (dockL && !ship.docked) {
    const d = dist(ship.x, ship.y, dockL.x, dockL.y);
    // QA M1: auch scharf, wenn man nach dem Ablegen ein paar Sekunden in der Nähe bleibt (versehentlich abgelegt)
    if (!ship.dockArmed && (d > C.travel.dockDist + 60 || game.time - (ship.undockT || 0) > 4)) ship.dockArmed = true;
    if (ship.dockArmed && d <= C.travel.dockDist && ship.speed <= C.travel.dockSpeed) {
      ship.docked = true; ship.dockedAt = loc.id; ship.x = dockL.x; ship.y = dockL.y; ship.vx = 0; ship.vy = 0; ship.speed = 0;
      ship.angle = loc.id === 'hafen' ? 0 : ship.angle;
      ship.helm.thrust = 0; ship.helm.turn = 0; ship.dockHold = true;
      ship.helm.stage = stopIndex(game); ship.helm.autoStop = false; ship.turnVel = 0;
      game.emit('sfx', { name: 'door' });
      game.missionEvent('docked', { loc: loc.id });
    }
  }
  // Asteroiden (W2 AP3b: gemeinsame Regel brockenStoss, auch für Gegner)
  brockenStoss(game, ship, C.flight.radius, (a) => {
    if ((ship.asteroidImmune[a.id] || 0) <= game.time) {
      ship.asteroidImmune[a.id] = game.time + C.flight.asteroidImmunity;
      brockenStats(game).lerche++;
      shipHit(game, Physics.sectorOf(ship.x, ship.y, ship.angle, a.x, a.y), C.asteroid.damage, {});
      game.missionEvent('asteroid', {});
    }
  });
}

function dodge(game, dir) {
  const C = game.C; const ship = game.ship;
  if (ship.docked) return 'Erst ablegen.';
  if (ship.dodgeCd > 0) return 'Ausweichrolle lädt noch.';
  if (isDown(ship.systems.engines)) return 'Antrieb ausgefallen.';
  const D = lercheClass(game).dodge || {};
  const imp = D.impulse != null ? D.impulse : C.ship.dodgeImpulse;
  const a = ship.angle + (dir >= 0 ? Math.PI / 2 : -Math.PI / 2);
  ship.vx += Math.cos(a) * imp; ship.vy += Math.sin(a) * imp;
  ship.dodgeCd = D.cooldown != null ? D.cooldown : C.ship.dodgeCooldown;
  ship.dodgeT = D.turnPenaltyTime || 0;   // M3b §2: danach 1 s lang Drehen × dodge.turnPenalty (stepBody)
  ship.lastDodgeT = game.time;   // §20.2: Ausweich-Fenster für endende Ladungen
  ship.helm.autoStop = false;    // §21.1: Ausweichen ist erlaubt und beendet den Allstopp
  game.stats.dodges = (game.stats.dodges || 0) + 1;
  game.emit('sfx', { name: 'dodge' });
  return null;
}

// ---------- Allstopp und Temporegler (§21.1, M3b §2) ----------
// Altname (M3a): Bremsleistung des Allstopps. Seit M3b bremst stepBody mit decel × brakeFactor der Klasse.
function fullStopBrake(game) {
  const cls = lercheClass(game);
  return (cls.decel || 0) * (cls.brakeFactor || 1);
}
// cmd helm.stop (X): Stufe auf Stopp + brake, bis das Schiff steht (vorwärts und seitlich). Das Ruder bleibt frei.
function helmStop(game) {
  const ship = game.ship;
  if (ship.docked) return 'Angedockt – das Schiff steht schon.';
  ensureHelmStage(game);
  ship.helm.stage = stopIndex(game);
  ship.helm.autoStop = true;
  ship.helm.thrust = 0;
  game.emit('sfx', { name: 'ui_click' });
  return null;
}
// Stufe setzen (intern): beendet einen laufenden Allstopp
function setStage(game, idx) {
  const h = game.ship.helm; const n = (lercheClass(game).stages || [0]).length;
  const v = clamp(Math.round(idx), 0, n - 1);
  if (v === h.stage) return false;
  h.stage = v; h.autoStop = false;
  return true;
}
// cmd helm.throttle { delta: ±1 } oder { set: index } – eine Stufe pro Tastendruck (M3b §2)
function helmThrottle(game, msg) {
  ensureHelmStage(game);
  const h = game.ship.helm; const n = (lercheClass(game).stages || [0]).length;
  msg = msg || {};
  let want;
  if (msg.set != null && msg.set !== '') {
    want = Number(msg.set);
    if (!Number.isFinite(want)) return 'Unbekannte Stufe.';
    want = Math.round(want);
    if (want < 0 || want >= n) return 'Unbekannte Stufe.';
  } else {
    const d = Number(msg.delta);
    if (!Number.isFinite(d) || d === 0) return null;
    want = h.stage + (d > 0 ? 1 : -1);
    if (want < 0 || want >= n) { if (h.autoStop) h.autoStop = false; return null; }   // Anschlag: still
  }
  if (setStage(game, want)) game.emit('sfx', { name: 'ui_click' });
  else if (h.autoStop) h.autoStop = false;   // dieselbe Stufe nochmal gewählt: Allstopp endet trotzdem
  return null;
}
// cmd helm.input: der Client schickt kontinuierlich. turn = Ruder. thrust ist Altname: ein Wechsel über +0,5 bzw.
// unter −0,5 wirkt EINMAL als Stufe +1 bzw. −1 (Dauerdruck schaltet nicht weiter).
function helmInput(game, turn, thrust) {
  ensureHelmStage(game);
  const h = game.ship.helm;
  const prev = Number(h.thrust) || 0;
  h.turn = turn; h.thrust = thrust;
  if (thrust > 0.5 && !(prev > 0.5)) setStage(game, h.stage + 1);
  else if (thrust < -0.5 && !(prev < -0.5)) setStage(game, h.stage - 1);
}
// Snapshot-Ergänzung ship.helm (M3b §2): Stufe, Stufen-Tempi (Nennwert px/s), Faktor aus Triebwerk/Energie,
// aktueller Drehfaktor. game.js mischt das in ship.helm.
function helmSnapshot(game) {
  ensureHelmStage(game);
  const cls = lercheClass(game); const ship = game.ship;
  const fwd = Flight.forwardSpeed(ship);
  return {
    stage: ship.helm.stage,
    stages: (cls.stages || [0]).map((s) => Math.round(s * cls.maxSpeed)),
    stageNames: cls.stageNames || null,
    stop: stopIndex(game),
    agile: Flight.agileStage(cls),
    speedFactor: r2(engineSpeedFactor(game)),
    fwd: r1(fwd),
    turnFactor: r2(Flight.turnFactor(cls, fwd)),
    autoStop: !!ship.helm.autoStop,
  };
}

// ---------- Reisen / Faltsprung (§9.2) ----------
// Welle 0 (CONTRACT-B1 §1.2): wörtlich nach server/sim/sprung.js verschoben (Team SEKTOR); hier nur Delegation.
function jammersPresent(game) { return Sprung.jammersPresent(game); }
function updateJump(game, dt) { return Sprung.updateJump(game, dt); }
function doJump(game) { return Sprung.doJump(game); }
function selectDest(game, dest) { return Sprung.selectDest(game, dest); }

// ---------- Treffer ----------
// opts: { pierce (bool, Schild ganz umgehen – Nachzügler), emp, heavy (angekündigter Treffer) }
// M3b §4: dünne Hülle um damage.resolveHit (SERVER-DAMAGE). resolveHit rechnet Schild, Trefferweg (Integrität), EMP,
// Feuer und Zähler; shipHit behält Signatur, Ereignisse ('hit', sfx) und Missionsereignisse. SYS-01 A1a: keine Hülle mehr.
let damageMod = null;
function damageApi(game) { return damageMod || (damageMod = require('./damage.js')); }
// Rückgabe: das Ergebnis von damage.resolveHit ({ absorbed, rest, systems, empThrough, … }), rest = Schaden nach Schild
function shipHit(game, sector, dmg, opts) {
  const ship = game.ship; const sh = ship.shields;
  opts = Alarm.trefferOpts(game, opts || {});   // EK2: Schilde unten (Schleichfahrt) = Treffer ohne Schildabzug
  ensureM3(game);
  game.stats.hits++;
  const D = damageApi(game);
  const heavy = !!opts.heavy;
  const before = sh.current[sector] || 0;
  // S2 §5: Breitseite als Schild – das 'hit'-Ereignis nennt den geschützten Schützling (shielded: '<escortId>')
  const hitEv = (d) => (opts.shielded ? Object.assign(d, { shielded: opts.shielded }) : d);
  const r = D.resolveHit(game, sector, dmg, opts) || {};
  syncWeaponsAlias(game);
  if (r.evaded) {   // z. B. Ausweichfenster – kein Treffer
    game.emit('hit', hitEv({ sector, shield: true, dmg: 0, heavy, evaded: true }));
    return r;
  }
  const rest = Number(r.rest) || 0;
  const absorbed = Number(r.absorbed) || 0;
  if (r.empThrough) {
    game.emit('hit', hitEv({ sector, shield: false, dmg: 0, emp: true, heavy, absorbed }));
    game.emit('sfx', { name: 'emp' });
  } else if (rest > 0) {
    game.emit('hit', hitEv({ sector, shield: false, dmg: r1(rest), heavy, absorbed }));
    game.emit('sfx', { name: 'hull_hit' });
  } else {
    game.emit('hit', hitEv({ sector, shield: true, dmg, heavy, absorbed }));
    game.emit('sfx', { name: 'shield_hit' });
  }
  if (before > 0 && (sh.current[sector] || 0) <= 0) game.missionEvent('shieldDown', { sector });
  if (rest > 0) game.missionEvent('hullHit', { sector });   // Alias (SYS-01 A1b): ein Treffer, der den Schild durchbricht. Der Systemtreffer meldet 'systemHit' (damage.systemSchaden), der Frachtraum-Verlust hängt am Frachtraum-Modul dort.
  return r;
}

// SYS-01 A1a: Naht für das Notfallprotokoll. Die Hülle entfällt. SYS-01 A2a: ausgelöst vom Reaktor-Countdown (sim/reaktortod.js), zusätzlich Debug `verlust` und Tests.
// Ereignisse, Zähler und Marken wie bisher; die Systeme bleiben, wie sie sind (der Auslöser für den Tod kommt mit A2).
function verlustAusloesen(game, grund) {
  const C = game.C; const ship = game.ship;
  ship.fireList = [];
  ship.breachList = [];   // M1: Notschaum dichtet auch alle Lecks ab (sonst Notfall-Schleife ohne Flickblech)
  for (const e of game.space.enemies) { e.retreatUntil = game.time + C.combat.retreatTime; if (e.tele) { e.tele = null; game.emit('teleMiss', { id: e.id }); } }
  game.space.projectiles = game.space.projectiles.filter((p) => !GEGNER_GESCHOSSE.includes(p.kind));
  game.inventory.marks = Math.max(0, game.inventory.marks - C.emergency.marksCost);
  game.stats.emergencies++;
  game.emit('emergency', { grund: grund || null });
  game.missionEvent('emergency', { grund: grund || null });   // SL3: Regiebücher (Falle: Lerche am Ende = Szene von vorn)
  game.emit('sfx', { name: 'emergency' });
  game.oda('Notfallprotokoll! Feuer erstickt, Lecks verschäumt. Kostet 50 Marken – und Würde.', null);
}

// ---------- Waffen (PAN-01 C): neun Plätze, Katalog, Ladepool, Torpedowerfer – siehe server/sim/schiffswaffen.js ----------
// PHASES: Altname-Export (M1). Seit M3a gibt es keine Phasenkanonen mehr; Befehle mit phase_l/phase_r werden umgesetzt.
const PHASES = ['phase_l', 'phase_r'];
const mountIds = (game) => Waffen.mountIds(game);
const mountState = (game, k) => Waffen.mountState(game, k);
function weaponsManned(game) { return Station.stationBesetzt(game, 'weapons'); }
// R1 §4.5: Waffenautomatik (Lanze, Ladepunkt-Verteilung, autoFactor) nur bei ≤ 2 verbundenen Spielern und unbesetzter Ops
function waffenAutomatikAktiv(game) { return Station.waffenAutomatikAktiv(game); }

// R1 §4.5: ODA sagt den Wechsel der Waffenautomatik an (nur bei unbesetzter Ops; die Besetzung selbst ist still, der erste Stand auch).
function meldeWaffenAutomatik(game, manned) {
  const ship = game.ship;
  const stand = manned ? 'besetzt' : (waffenAutomatikAktiv(game) ? 'an' : 'aus');
  const alt = ship.waffenAutoStand;
  ship.waffenAutoStand = stand;
  if (alt === undefined || alt === stand || stand === 'besetzt') return;
  // „an“ nur einmal je Partie (wer allein fliegt, wechselt ständig zwischen Stationen), „aus“ höchstens alle 30 s (Warnung, dass niemand schießt)
  if (stand === 'an') return game.oda('Ops unbesetzt, Automatik an.', 'waffenAutoAn');
  if (ship.waffenAutoAusAt != null && game.time - ship.waffenAutoAusAt < 30) return;
  ship.waffenAutoAusAt = game.time;
  game.oda('Ops unbesetzt, Automatik aus – ohne Ops schießt niemand.', null);
}

// §5.2 Ladepunkte, Verteilung, Feuer, Lanze, Salven, Torpedo: alles in schiffswaffen.js
const chargePoints = (game) => Waffen.chargePoints(game);
const computeAlloc = (game) => Waffen.computeAlloc(game);
const inMountArc = (game, mount, x, y) => Waffen.inMountArc(game, Waffen.normMount(mount, game), x, y);
const normMount = (mount, game) => Waffen.normMount(mount, game);
const updateWeapons = (game, dt) => Waffen.update(game, dt);
const lanceTrace = (game, id) => Waffen.lanceTrace(game, id);
const lanceDamage = (game, power, id) => Waffen.lanceDamage(game, power, id);
const weaponsCharge = (game, mount, on) => Waffen.weaponsCharge(game, mount, on);
const weaponsFire = (game, mount) => Waffen.weaponsFire(game, mount);
const weaponsAlloc = (game, mount, delta) => Waffen.weaponsAlloc(game, mount, delta);
const weaponsHold = (game, mount, hold) => Waffen.weaponsHold(game, mount, hold);
const weaponsReload = (game) => Waffen.weaponsReload(game);
const consumeFullCharge = (game) => Waffen.consumeFullCharge(game);
const mountsSnapshot = (game) => Waffen.mountsSnapshot(game);
// Altname (M1): Faktor des alten Bolzenwerfers – der Torpedowerfer kennt keinen Energiefaktor mehr
const chargeFactor = () => 1;
function selectedEnemy(game) { const id = game.ship.target; return id == null ? null : game.space.enemies.find((e) => e.id === id) || null; }

// ---------- Schildstoß: entfällt seit M3b (Kai) ----------
const BURST_GONE = 'Den Schildstoß gibt es nicht mehr.';
function captainBurst(game, sector) { return BURST_GONE; }   // eslint-disable-line no-unused-vars
function debugBurst(game, sector) { return BURST_GONE; }     // eslint-disable-line no-unused-vars
function shieldsSnapshot(game) {
  ensureM3(game);
  const sh = game.ship.shields;
  return {
    pool: sh.pool, alloc: sh.alloc, current: sh.current, cap: sh.cap || shieldCaps(game),
    burst: null, burstCd: 0,   // M3b: eine Version lang als Altname
  };
}

// Ziel auflösen: Gegner, aufgedecktes verstecktes Objekt (dieser Ort) oder 'station'
function resolveTarget(game, id) {
  if (id == null) return null;
  const e = game.space.enemies.find((o) => o.id === id);
  if (e) return { type: 'enemy', id, x: e.x, y: e.y, obj: e };
  const mine = Alarm.mineById(game, id);   // EK2: gesehene Minen sind anwählbar (abschießen, scannen)
  if (mine && Alarm.mineSichtbar(game, mine)) return { type: 'mine', id, x: mine.x, y: mine.y, obj: mine };
  if (id === 'station') {
    const loc = Locations.get(game.ship.scene);
    if (loc.scene.station) return { type: 'station', id, x: loc.scene.station.x, y: loc.scene.station.y, loc: loc.id };
    return null;
  }
  const h = game.explore.hiddenHere().find((o) => o.id === id && game.explore.isRevealed(o.id));
  if (h) return { type: 'hidden', id, x: h.x, y: h.y, obj: h };
  return null;
}
function weaponsTarget(game, id) {
  if (id === null || id === undefined) { Zielsysteme.zielLoeschen(game); return null; }
  const rt = resolveTarget(game, id);
  if (!rt) return 'Ziel nicht gefunden.';
  // W2: Gegner nur innerhalb der Sensorreichweite aufschalten (im Nebel × fogFactor; der Client zeigt dieselbe Grenze)
  if ((rt.type === 'enemy' || rt.type === 'mine') && dist(game.ship.x, game.ship.y, rt.x, rt.y) > sensorReichweite(game) && !require('./sonden.js').sieht(game, rt.x, rt.y)) return 'Ziel außerhalb der Sensoren.';   // SL4: eine Sonde erweitert die Sicht
  if (game.ship.target !== id) { game.ship.tscan.progress = 0; delete game.ship.zielsystem; }   // SUND-04a-1 A: das Systemziel gilt für das gewählte Ziel
  game.ship.target = id;
  return null;
}

// ---------- Ziel-Scan / Weitscan / Marker ----------
function weaponsScan(game, on) {
  const ts = game.ship.tscan;
  ts.on = !!on; ts.at = game.time;
  if (!on) return null;
  const t = resolveTarget(game, game.ship.target);
  if (!t) return 'Erst ein Ziel wählen (T oder anklicken).';
  const R = erfassung(game);   // W2: im Nebel × fogFactor
  if (dist(game.ship.x, game.ship.y, t.x, t.y) > R) return `Ziel zu weit für den Scan (max. ${Math.round(R)}${R < game.C.tscan.range ? ', Nebel' : ''}).`;
  return null;
}
function updateTargetScan(game, dt) {
  const C = game.C; const ship = game.ship; const ts = ship.tscan;
  const manned = weaponsManned(game);
  if (!manned || game.time - ts.at > C.tscan.holdTimeout) ts.on = false;
  const t = resolveTarget(game, ship.target);
  if (!t) { ts.targetId = null; ts.progress = 0; return; }
  if (ts.targetId !== t.id) { ts.targetId = t.id; ts.progress = 0; }
  if (!ts.on) { ts.progress = 0; return; }
  if (dist(ship.x, ship.y, t.x, t.y) > erfassung(game)) { ts.progress = 0; return; }   // W2: Nebel
  if (alreadyScanned(game, t)) { ts.progress = 1; return; }
  const before = ts.progress;
  ts.progress = Math.min(1, ts.progress + dt / C.tscan.time);
  if (Math.floor(before * 4) !== Math.floor(ts.progress * 4) && ts.progress < 1) game.emit('sfx', { name: 'scan_tick' });
  if (ts.progress >= 1) {
    ts.on = false;
    game.emit('sfx', { name: 'scan_done' });
    onTargetScanned(game, t);
  }
}
function alreadyScanned(game, t) {
  if (t.type === 'mine') return !!t.obj.gescannt;
  if (t.type === 'enemy') return !!t.obj.scanned;
  if (t.type === 'station') return game.scans.has('station:' + t.loc);
  if (t.type === 'hidden') return game.scans.has(t.id);
  return false;
}
function onTargetScanned(game, t) {
  if (t.type === 'mine') {
    t.obj.gescannt = true;
    game.oda(t.obj.ohneStrom ? 'Scan: Mine ohne Strom – ein Blindgänger.' : 'Scan: Mine. Zündet bei Annäherung, ignoriert Schilde, 6 Punkte Systemschaden. Aus der Ferne abschießen – das macht aber Alarm.', 'scan_mine');
    return;
  }
  if (t.type === 'enemy') {
    t.obj.scanned = true;
    const n = { raider: 'Jäger: Bug stark, Heck ungeschützt, eine Kanone vorn.', korvette: 'Korvette: Seiten stark, Bug schwach, Heck ungeschützt – von hinten angreifen. Waffen je Platz im Bogen sichtbar.',
      fregatte: 'Fregatte: zwei Schildsegmente je Seite, Bug 2, Heck schwach – ein Segment aufbrechen, dort treffen. Je Seitenbereich eine Waffe.',
      kreuzer: 'Kreuzer: drei Schildsegmente je Seite, Bug 2, Heck schwach – von hinten angreifen. Je Seitenbereich eine Waffe, zwei vorn.',
      sentinel: 'Kustoden-Wächter: rundum geschützt, EMP-Schüsse. Schilde oben halten!', pylon: 'Pylon: nur die Front ist geschützt – Pilot, an die Seite!', relay: 'Störrelais: keine Schilde, keine Waffen.' }[t.obj.kind];
    game.oda('Scan: ' + (n || 'Daten erfasst.'), 'scan_' + t.obj.kind);
    game.missionEvent('enemyScanned', { enemy: t.obj });
    return;
  }
  if (t.type === 'station') {
    game.scans.add('station:' + t.loc);
    game.explore.onStationScanned(t.loc);
    game.missionEvent('scanned', { id: 'station:' + t.loc });
    return;
  }
  if (t.type === 'hidden') {
    game.scans.add(t.id);
    game.explore.onHiddenScanned(t.obj);
    game.missionEvent('scanned', { id: t.id });
  }
}

function weaponsWidescan(game) {
  const C = game.C; const ship = game.ship; const ws = ship.widescan;
  if (ws.cd > 0) return `Weitscan lädt noch (${Math.ceil(ws.cd)} s).`;
  ws.cd = C.widescan.cooldown; ws.pulseAt = Math.round(game.time * 100) / 100;
  game.emit('sfx', { name: 'widescan' });
  game.emit('widescan', { x: Math.round(ship.x), y: Math.round(ship.y), r: C.widescan.radius });
  const n = game.explore.widescanAt(ship.x, ship.y, C.widescan.radius);
  const extra = Alarm.onWidescan(game, C.widescan.radius);   // EK2: Minen und Patrouillen, Signatur-Ping
  if (!n && !extra) game.oda('Weitscan: nichts Neues in Reichweite. Woanders nochmal probieren.', null);
  game.missionEvent('widescan', { found: n });
  return null;
}

function setMarker(game, who, x, y, clear) {
  const m = game.ship.markers;
  if (clear) { m[who] = null; return null; }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Ungültige Markierung.';
  m[who] = { x: Math.round(clamp(x, 0, game.space.w)), y: Math.round(clamp(y, 0, game.space.h)) };
  game.emit('sfx', { name: 'marker_set' });
  return null;
}
function markerOnTarget(game) {
  const t = resolveTarget(game, game.ship.target);
  if (!t) return 'Kein Ziel für den Marker.';
  return setMarker(game, 'tactical', t.x, t.y, false);
}

// ---------- Gegner ----------
function spawnEnemy(game, kind, opts) {
  const C = game.C; const ship = game.ship; const sp = game.space;
  const o = opts || {};
  const cfg = C.enemies[kind];
  // SYS-01 C2a: Klassenbudget = Hülle × crewScaling.gegnerIntegritaet × Klassenfaktor budgetFaktor (SYS-01 D, Daten gegner-systeme.json; nicht beim Störrelais)
  const hp = Math.max(1, Math.round(cfg.hp * (kind === 'relay' ? 1 : crewScale(game).gegnerIntegritaet * Gsys.budgetFaktor(kind))));
  const a = o.angle != null ? o.angle : game.rng.range(-Math.PI, Math.PI);
  let x = o.x != null ? o.x : ship.x + Math.cos(a) * C.combat.spawnDist;
  let y = o.y != null ? o.y : ship.y + Math.sin(a) * C.combat.spawnDist;
  x = clamp(x, 60, sp.w - 60); y = clamp(y, 60, sp.h - 60);
  if (sp.asteroids.length) { const f = freiVonBrocken(game, x, y, (C.combat.hitRadius && C.combat.hitRadius[kind]) || 18); x = f.x; y = f.y; }   // W2: nicht im Brocken
  const lay = Schilde.layout(C, kind);   // EK1b: Segmente je Seite (Korvette: ein Segment je Seite = [Bug, Steuerbord, Heck, Backbord])
  const shields = lay ? lay.max.slice() : [0, 0, 0, 0];
  const e = { id: game.nextId('e'), kind, x, y, angle: o.facing != null ? o.facing : Math.atan2(ship.y - y, ship.x - x), hp, hpMax: hp,
    shields, shieldsMax: shields.slice(), regenT: 0, scanned: false,
    fireT: cfg.fireInterval * 0.5, orbitDir: game.rng.chance(0.5) ? 1 : -1, retreatUntil: 0, tag: o.tag || null, hitT: 0,
    phase: 'broadside', phaseT: 0, side: 1, orbitA: o.orbitA, home: { x, y }, vx: 0, vy: 0 };
  Gsys.anlegen(e);   // SYS-01 C1a-1: Systeme mit Integrität je Klassenbudget (e.hp = Summe); ohne Modell (relay) bleibt e.hp
  const vk = volkFuer(game, kind, o.volk);   // Kennung auf den Raumkarten (Snapshot vk, fehlt = CONFIG.kennung.gegner)
  if (vk) e.volk = vk;
  if (hatPlaetze(game, kind)) e.waffen = bestueckung(game, kind, o.waffen);   // EK1: Korvette, EK1b: Fregatte, Kreuzer
  // S2 §5: Spawn-Parameter ziel (lerche | schuetzling | auto | Tag eines Schützlings) -> e.targetId (null = Lerche)
  if (o.ziel != null && o.ziel !== 'lerche') {
    try { e.targetId = Escort.pickTarget(game, o.ziel); } catch (err) { e.targetId = null; if (game.countError) game.countError('escort-ziel', err); }
    if (e.targetId != null && o.facing == null) { const T = Pilot.targetOf(game, e); e.angle = Math.atan2(T.y - y, T.x - x); }
  }
  // M3b §3/§7: im neuen Flugmodell mit Anfangstempo (Korvette ½, Jäger Voll), nicht aus dem Stand
  if (Pilot.flies(game, e)) Pilot.initSpawn(game, e);
  sp.enemies.push(e);
  game.missionEvent('enemySpawn', { enemy: e });
  return e;
}

// Kennung (Volk) eines Raumschiffs: 'ger' | 'rom' | 'pirat' oder null (Klasse ohne Kennung: Wächter, Pylon, Relais …). Ableitung:
//   1. ausdrücklich beim Erzeugen: opts.volk (Regiebuch/Kampagne `spawn.volk`, Patrouille/Einsprung `volk`, Konvoi `volk`, Flotten-Wellen
//      `kind:n:volk`, Verbündete der Flotte `volk`) – ungültige Werte zählen nicht
//   2. sonst die Fraktion des Hexes der Szene, aber nur, wenn sie dort feindlich ist (CONFIG.reise.fraktionArt 'feind': ger, pirat). Ein Gegner
//      im römischen oder neutralen Raum ist ein Eindringling, kein Römer – Römer als Gegner gibt es nur ausdrücklich.
//   3. sonst der Standard CONFIG.kennung.gegner ('ger', Feldzug Eisenwald). Verbündete: escort.js, Standard CONFIG.kennung.verbuendet ('rom').
function volkFuer(game, kind, explizit) {
  const K = game.C.kennung || {};
  if (!(K.klassen || []).includes(kind)) return null;
  const V = K.voelker || [];
  if (V.includes(explizit)) return explizit;
  const hex = game.ship && Sektoren.hexVonOrt(game.ship.scene);
  const fr = hex ? Besitz.besitzer(game, hex) : null;   // SUND-01 D: aktueller Besitzer (ohne Overlay die Karten-Fraktion)
  if (fr && V.includes(fr) && ((game.C.reise || {}).fraktionArt || {})[fr] === 'feind') return fr;
  return K.gegner || 'ger';
}

function crewScale(game) {
  const n = Math.max(1, Math.min(3, game.players.filter((p) => p.connected).length));
  return game.C.crewScaling[n] || { enemyFireInterval: 1, gegnerIntegritaet: 1 };
}

// Schaden aus Richtung (srcX, srcY): erst Schildsektor des Gegners, dann Hülle.
// opts.pierce: der Schildsektor zählt bei diesem Treffer so viele Punkte weniger (Lanze, §5.1).
// SYS-01 C1a-1: Gegner mit Systemmodell (gegnersystem.js) bekommen keine Hülle mehr: ein Treffer, der den Schild durchschlägt, trifft ein
// System der Zone der Seite (Mitte bei Durchschlag 'zone' oder leerer Zone). Der Schild über 0 fängt ab, der Rest verfällt (kein Überlauf).
// Gegner ohne Modell (Störrelais) behalten die alte Hülle e.hp.
function damageEnemy(game, e, dmg, srcX, srcY, opts) {
  e.hitT = game.time;
  if (e.pat) Alarm.ausloeser(game, 'entdeckt');   // EK2: ein Treffer auf eine Patrouille verrät uns
  if (e.targetId != null && !(opts && opts.ally)) Escort.onLercheHit(game, e);   // S2 §5: Treffer der Lerche ziehen den Gegner 10 s auf sie (EK4b: nicht Treffer der Verbündeten)
  // M3a §7.1: Treffer verlängern eine laufende Ladung (je Treffer delayPerHit, insgesamt höchstens delayMax)
  if (e.tele) {
    const T = M3(game).tele;
    const add = Math.min(T.delayPerHit, Math.max(0, T.delayMax - (e.tele.delayed || 0)));
    if (add > 0) { e.tele.left += add; e.tele.dur += add; e.tele.delayed = (e.tele.delayed || 0) + add; }
  }
  const modell = Gsys.hat(e);
  let rest = dmg;
  let zone = null;   // Zone des Treffers im Modell: Seite des getroffenen Segments
  if (srcX != null && e.shields) {
    // EK1b: Segment des Treffers (Seite aus dem Winkel, Seitenbereich aus der Längslage – shared/schilde.js); Klassen ohne Segmente: Sektor wie bisher
    const lay = Schilde.layout(game.C, e.kind);
    let sec = lay ? Schilde.segmentOf(lay, e.x, e.y, e.angle, srcX, srcY) : -1;
    if (sec < 0 || sec >= e.shields.length) sec = Physics.sectorOf(e.x, e.y, e.angle, srcX, srcY);
    if (modell) zone = Gsys.zoneVonSegment(game, e, sec);
    if (!(opts && opts.huelle && !opts.nurOhneSchild)) {   // PAN-01 C: huelle = Torpedo, geht an Schildsegmenten vorbei (nurOhneSchild: wirkt nur auf ein ausgefallenes Segment)
      // SYS-01 B1: Durchschlag 'zone' (Vollladung der Lanze) umgeht den Schild ganz; die Mitte des Gegners ist hier die Hülle
      const pierce = opts && opts.durchschlag === 'zone' ? Infinity : (opts && opts.pierce) || 0;
      const sv = e.shields[sec];
      if (opts && opts.nurOhneSchild && sv > EPS) { game.emit('sfx', { name: 'shield_hit', volume: 0.5 }); game.missionEvent('enemyShieldHit', { enemy: e, sector: sec }); return; }   // Schild steht: der Torpedo prallt ab, Schaden 0
      if (opts && opts.sturm) {   // PAN-01 C: Sturmbatterie – hoher Schild: kaum Schildschaden und keine Regeneration; niedriger Schild: Treffer gehen durch, das Ziel wird gestört
        const T = opts.sturm; e.regenHold = game.time + T.regenSperre;
        if (modell) Gegnerreparatur.sperren(game, e, zone, Sturm.reparaturSperre(game));   // SYS-02a: jeder Sturm-Treffer sperrt die Reparatur der Zone (Fortschritt 0)
        if (sv > T.niedrig) {
          const take = Math.min(sv, dmg * T.schildFaktor);
          e.shields[sec] = Math.max(0, sv - take); if (e.shields[sec] < EPS) e.shields[sec] = 0;
          e.shieldHitT = game.time; e.shieldHitSector = sec;
          game.emit('sfx', { name: 'shield_hit', volume: 0.3 });
          return;
        }
        stoereGegner(e, T.stoerung);   // niedriger Schild: der Schild nimmt den Treffer (wie die Lerche in damage.resolveHit)
        if (sv > EPS && modell) {   // SYS-02a Nacharbeit: wie die Lerche (damage.resolveHit Schritt 3): bei 0 < Schild ≤ niedrig mit sturm.systemChance ein System der Zone, sturmSchaden × systemFaktor; Zone leer: Mitte (gesperrt in trefferSystem)
          const absorbiert = Math.min(sv, rest);
          e.shields[sec] = Math.max(0, sv - absorbiert); if (e.shields[sec] < EPS) e.shields[sec] = 0;
          if (absorbiert > 0) { e.shieldHitT = game.time; e.shieldHitSector = sec; }
          if (game.rng.chance(T.systemChance)) return trefferSystem(game, e, (Number(game.C.systemModell.sturmSchaden) || 0) * Sturm.systemFaktor(game), zone || 'bug', srcX, srcY, opts);
          game.emit('sfx', { name: 'shield_hit', volume: 0.5 }); game.missionEvent('enemyShieldHit', { enemy: e, sector: sec }); return;
        }
      } else if (opts && opts.streu) {   // PAN-01 C: eine Streu-Granate = Schildschaden (Schildbrecher), nie Hülle
        const take = Math.min(sv, dmg * opts.streu.schildFaktor);
        e.shields[sec] = Math.max(0, sv - take); if (e.shields[sec] < EPS) e.shields[sec] = 0;
        if (take > 0) { e.shieldHitT = game.time; e.shieldHitSector = sec; }
        game.missionEvent('enemyShieldHit', { enemy: e, sector: sec });
        return;
      }
      const absorb = Math.min(Math.max(0, e.shields[sec] - pierce), rest);
      // QA M3a: nicht mehr auf 0,1 runden (Teiltreffer wie 0,75 bei unbesetzter Ops verloren sonst Schaden);
      // gerundet wird nur im Snapshot. EPS fängt Gleitkomma-Reste ab.
      if (absorb > 0) { e.shields[sec] = Math.max(0, e.shields[sec] - absorb); if (e.shields[sec] < EPS) e.shields[sec] = 0; rest -= absorb; e.shieldHitT = game.time; e.shieldHitSector = sec; }   // sec = Index des Segments in e.shields (bei 4 Sektoren der Sektor)
      if (modell && Math.max(0, sv - pierce) > EPS) {   // SYS-01 C1a-1: der Schild hält, der Rest verfällt (kein Überlauf in das System)
        game.emit('sfx', { name: 'shield_hit', volume: 0.5 }); game.missionEvent('enemyShieldHit', { enemy: e, sector: sec }); return;
      }
      if (rest <= EPS) { game.emit('sfx', { name: 'shield_hit', volume: 0.5 }); game.missionEvent('enemyShieldHit', { enemy: e, sector: sec }); return; }
    }
  }
  if (modell) {
    // SYS-01 C1a-2 (Kai 2026-10-26): Torpedo gegen eine Klasse mit systemModell.torpedoSofortTod.<klasse> = true (Jäger; Config, live per tune) bei Schild 0 (die Schildprüfung oben ist durch): sofort tot, bei jeder Crewgröße, kein Countdown, kein Kapern
    if (opts && opts.torpedo && (game.C.systemModell.torpedoSofortTod || {})[e.kind] === true) { Gegnertod.sofort(e); return enemyDown(game, e); }
    if (opts && opts.torpedo) return torpedoSystem(game, e, zone || 'bug', srcX, srcY, opts);   // SYS-02a: System der Zone zerstört, Durchschlag auf den Reaktor
    if (opts && opts.durchschlag === 'zone') zone = 'mitte';
    return trefferSystem(game, e, opts && opts.sturm ? rest * Sturm.systemFaktor(game) : rest, zone || 'bug', srcX, srcY, opts);   // SYS-02a: Sturm bei niedrigem/leerem Schild × systemFaktor gegen das System
  }
  e.hp -= rest;
  if (e.hp < EPS) e.hp = 0;
  game.missionEvent('enemyDamaged', { enemy: e });
  if (e.hp > 0) return;   // Störrelais (ohne Systemmodell): die alte Hülle, ohne Zielsysteme (C1b-1)
  enemyDown(game, e);   // Gegner ohne Systemmodell (Störrelais): kein Schildgenerator, also kein Kapern
}

// SYS-01 C1a-1: Treffer, der den Schild durchschlägt, auf das Systemmodell eines Gegners: Trefferweg in der Zone (Mitte bei leerer Zone),
// Integrität -= Rest. SYS-01 C1a-2: der Tod kommt nicht mehr aus der Integrität, sondern aus dem System: zerstörter Reaktor = Countdown,
// zerstörter Schildgenerator bei einem Enterziel = Prise (sim/gegnertod.js). Gegner ohne Tod kämpfen weiter.
function trefferSystem(game, e, rest, zone, srcX, srcY, opts) {
  // C1b-1: Systemziel der Ops (nur Angriffe der Lerche); Zone und Erreichbarkeit prüft der Treffer selbst
  const gez = opts && opts.angriff && !opts.ally && game.ship.target === e.id ? Zielsysteme.gezielt(game, e) : null;
  const t = Gsys.treffen(game, e, zone, rest, gez);
  game.missionEvent('enemyDamaged', { enemy: e });
  if (t) Gegnerreparatur.rueckschlag(game, e, t.zone);   // SYS-01 C2a: Systemtreffer in der Zone halbiert den Fortschritt der Reparaturen dort
  if (t && opts && opts.sturm) Gegnerreparatur.sperren(game, e, t.zone, Sturm.reparaturSperre(game));   // SYS-02a: lief der Sturm in die Mitte über, ist auch sie gesperrt
  if (t && t.gezielt && t.state !== t.vorher) Zielsysteme.gegnerGetroffen(game, e, t);
  if (t && t.state === 'broken' && t.vorher !== 'broken' && Gegnertod.systemZerstoert(game, e, t.id)) return;   // Prise: der Gegner treibt (entern.js)
}
// SYS-02a (Kai 2026-10-28): Torpedo gegen einen Gegner mit Systemmodell (Schild 0 im Segment, Lesart B; Jäger sind vorher sofort tot). Zerstört das getroffene System der Zone sicher
// (Schaden mindestens dessen Maximum; Zufall game.rng oder Systemziel) und schlägt auf den Reaktor durch: systemModell.torpedo.reaktorAnteil × Reaktor-Maximum. Eine leere Zone
// läuft nicht in die Mitte: dann trifft der Torpedo nur den Reaktor. Zerstörter Reaktor = Countdown (gegnertod.js), wie jede Reaktorzerstörung.
function torpedoSystem(game, e, zone, srcX, srcY, opts) {
  const gez = opts && opts.angriff && !opts.ally && game.ship.target === e.id ? Zielsysteme.gezielt(game, e) : null;
  const ts = [];
  const t = Gsys.treffen(game, e, zone, Katalog.torpedoSchaden(e.kind), gez, { zerstoeren: true, keinUeberlauf: true });
  if (t) ts.push(t);
  const rid = Gsys.idVon(e, 'reaktor'); const anteil = Number((game.C.systemModell.torpedo || {}).reaktorAnteil) || 0;
  if (rid && e.sys[rid].z !== 'broken' && anteil > 0) ts.push(Gsys.treffenAuf(game, e, rid, 'mitte', anteil * Gsys.maxOf(e, rid), false));
  game.missionEvent('enemyDamaged', { enemy: e });
  for (const x of ts) {
    Gegnerreparatur.rueckschlag(game, e, x.zone);
    if (x.gezielt && x.state !== x.vorher) Zielsysteme.gegnerGetroffen(game, e, x);
    if (x.state === 'broken' && x.vorher !== 'broken' && Gegnertod.systemZerstoert(game, e, x.id)) return;
  }
}
// Tod eines Gegners (Buchhaltung wie ein Abschuss): entfernen, Marken, Explosion, Ansage. Aufrufer: Countdown abgelaufen, Sofort-Tod, Störrelais ohne Modell, Testhilfe
function enemyDown(game, e) {
  const C = game.C;
  Entern.abschuss(game);   // feste Wracks des Ortes nach jedem Abschuss frei
  game.space.enemies = game.space.enemies.filter((o) => o !== e);
  if (!e.ohneBeute) game.inventory.marks += C.enemies[e.kind].salvage;   // SUND-02b E: ehemalige Verbündete (Verrat) geben keinen Lohn
  game.stats.kills++;
  game.emit('explosion', { x: Math.round(e.x), y: Math.round(e.y), zone: 'space' });
  game.emit('sfx', { name: e.kind === 'pylon' ? 'pylon_down' : (e.waffen || e.kind === 'sentinel') ? 'explosion_big' : 'explosion_small' });
  if (game.ship.target === e.id) { Zielsysteme.zielLoeschen(game); }   // das Systemziel hängt am Ziel (A-K3)
  game.missionEvent('enemyKilled', { enemy: e });
}

// PAN-01 C: Störung – das Ziel kommt mit seinem nächsten Schuss/seiner Ladung um s Sekunden später (Systemschaden der Gegner, die kein Systemmodell haben)
function stoereGegner(e, s) {
  e.fireT = Math.max(0, (e.fireT || 0) - s);
  if (e.boltT != null) e.boltT = Math.max(0, e.boltT - s);
  if (e.sf) e.sf.t = Math.max(0, e.sf.t - s);
  if (e.sfS) e.sfS.t = Math.max(0, e.sfS.t - s);
  if (e.streuG != null) e.streuG = Math.max(0, e.streuG - s);
  if (e.torpG != null) e.torpG = Math.max(0, e.torpG - s);
}
const hasEnemy = (game, e) => game.space.enemies.includes(e);

function stationPoint(game) {
  const loc = Locations.get(game.ship.scene);
  return loc.scene.station || { x: game.space.w / 2, y: game.space.h / 2 };
}

// EK1: Waffenplätze eines Gegners. Ohne Waffenart (typ) alle, mit typ nur die Plätze mit dieser Bestückung (nur Klassen mit Plätzen
// (Korvette, Fregatte, Kreuzer: enemyWeapons[kind][].platz) haben eine Bestückung je Platz, bei allen anderen gilt jeder Platz für jede Art).
function waffenPlaetze(game, e, typ) {
  // SYS-01 C1a-1: eine zerstörte Waffe (System broken) schießt nicht; die Plätze fallen aus allen Feuerpfaden heraus
  const W = (game.C.enemyWeapons[e.kind] || []).filter((w) => !Gsys.zerstoertPlatz(e, w));
  if (!typ || !e.waffen) return W;
  return W.filter((w) => Katalog.verhaltenVon(e.waffen[w.platz]) === typ);   // PAN-01 C: Altart oder Katalog-Id -> Verhalten
}
function hatWaffe(game, e, typ) { return !e.waffen || waffenPlaetze(game, e, typ).length > 0; }
// EK1b: Klasse mit benannten Waffenplätzen (Breitseiten-Schiff: Korvette, Fregatte, Kreuzer)? Eine Regel für alle Klassen, keine Liste im Code.
function hatPlaetze(game, kind) { const W = game.C.enemyWeapons && game.C.enemyWeapons[kind]; return !!(W && W.length && W[0].platz); }
// Plätze, deren Bogen die Lerche (oder ein anderes Ziel) trifft, und zwar mit Bestückung typ
function plaetzeImBogen(game, e, T, typ, range) {
  return waffenPlaetze(game, e, typ).filter((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, waffenReichweite(game, range != null ? range : w.range), T.x, T.y));
}
// Abnahme 3: Der Gegner-Torpedo sitzt nur auf Seitenplätzen (Bogen 90°, quer zur Fahrt): Breitseiten-Schiffe zeigen der Lerche ihre Seite, nie den Bug (Bogen 40°) – am Bug feuerte er nie.
function torpedoPlatzOk(platz) { return /^(stbd|bb)/.test(String(platz)); }
function bestueckung(game, kind, vorgabe) {
  const arten = game.C.korvetteWaffen || ['lanze', 'batterie', 'bolzen'];
  const w = {};
  for (const w0 of game.C.enemyWeapons[kind] || []) {
    let v = vorgabe && vorgabe[w0.platz];
    if (v && Katalog.verhaltenVon(v) === 'torpedo' && !torpedoPlatzOk(w0.platz)) { v = null; if (game.countError) game.countError('gegner-torpedo-platz', new Error('Gegner-Torpedo nur auf Seitenplätzen (stbd, bb), nicht auf ' + w0.platz)); }   // Abnahme 3: der Bug zeigt bei Breitseiten-Schiffen nie auf die Lerche
    w[w0.platz] = arten.includes(v) || (v && Katalog.waffe(v)) ? v : arten[game.rng.int(arten.length)];   // PAN-01 C: gezielt auch jede Katalogwaffe, der Zufall bleibt bei den drei Altarten (Golden)
  }
  return w;
}
function enemyCanHit(game, e, target, typ) {
  const s = target || game.ship;
  return waffenPlaetze(game, e, typ).some((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, waffenReichweite(game, w.range), s.x, s.y));   // W2: Nebel
}

function updateEnemies(game, dt) {
  const C = game.C; const ship = game.ship; const sp = game.space;
  for (const e of sp.enemies) {
    const cfg = C.enemies[e.kind];
    // Schild-Regeneration je Sektor. SYS-01 C1a-1: die Obergrenze je Segment kommt aus den Emittern und dem Schildgenerator (ohne Modell: das Maximum)
    const caps = Gsys.schildGrenzen(game, e);
    Gsys.schildPflege(game, e, caps);
    e.regenT += dt;
    if (game.time < (e.regenHold || 0)) e.regenT = 0;   // PAN-01 C: Sturmbatterie unterdrückt die Regeneration
    if (e.regenT >= C.enemyShieldRegen * Gsys.regenFaktor(game, e)) { e.regenT = 0; for (let i = 0; i < e.shields.length; i++) if (e.shields[i] < caps[i]) e.shields[i] = Math.min(caps[i], Math.floor(e.shields[i]) + 1); }
    if (Gegnertod.tick(game, e, dt)) { enemyDown(game, e); continue; }   // SYS-01 C1a-2: Reaktor-Countdown abgelaufen (der Gegner kämpft bis dahin weiter, auch gestellt oder fliehend); SYS-01 C Nacharbeit: tickt auch während der Sprungladung
    if (Gegnersprung.schritt(game, e, dt)) continue;   // SYS-01 C2b: Notfallsprung (nur mit Baustein): lädt und hält Stellung, danach entkommen (ohne enemyDown)
    const retreating = e.retreatUntil > game.time;
    if (Konvoi.faehrt(e)) { Konvoi.fahre(game, e, dt); continue; }   // EK3 Teil B: Transporter und wachende Eskorte fahren die Route, kein Feuer
    if (e.pat) { Alarm.patrouille(game, e, dt); continue; }   // EK2: ruhige Patrouille: Strecke (Brocken ignoriert), kein Feuer
    if (Pilot.flies(game, e)) {
      // M3b §3: Pilot + gemeinsames Flugmodell
      try { Pilot.fly(game, e, dt); }
      catch (err) { if (game.countError) game.countError('pilot', err); moveLegacy(game, e, dt, retreating); }
    } else moveLegacy(game, e, dt, retreating);
    // W2 AP3b (E4): Brocken gelten für Gegner wie für die Lerche (hinausschieben, Treffer)
    gegnerBrocken(game, e);
    if (!(e.hp > 0) || !sp.enemies.includes(e)) continue;   // am Brocken zerschellt
    // S2b §2: Sperrfeuer der Breitseiten-Schiffe (eigener Takt, ruht während einer Ladung)
    if (e.waffen) {
      try { updateSperrfeuer(game, e, retreating, dt); if (hatWaffe(game, e, 'sturm')) updateSperrfeuer(game, e, retreating, dt, 'sturm'); }
      catch (err) { if (game.countError) game.countError('sperrfeuer', err); }
    }
    // S2 §5: Gegner mit Schützling als Ziel – eigene, immer angekündigte Angriffslogik (escort.js)
    if (e.targetId != null) {
      const T = Pilot.targetOf(game, e);
      if (T !== ship) {
        if (e.tele && !e.tele.tgt) { updateTele(game, e, Math.hypot(e.x - ship.x, e.y - ship.y) || 1, retreating, dt); continue; }
        try { Escort.updateAttack(game, e, T, Math.hypot(e.x - T.x, e.y - T.y) || 1, retreating, dt); }
        catch (err) { if (game.countError) game.countError('escort-attack', err); }
        continue;
      }
    }
    if (e.tele && e.tele.tgt) { e.tele = null; e.fireT = 0; game.emit('teleMiss', { id: e.id }); }   // Ziel gewechselt (Treffer der Lerche)
    const d = Math.hypot(e.x - ship.x, e.y - ship.y) || 1;
    const toShip = Math.atan2(ship.y - e.y, ship.x - e.x);
    // M3a §7.1: Korvette, Pylon, Wächter kündigen an (tele) und treffen am Ende sofort
    const T = M3(game).tele;
    if (T && T[e.kind] && hatWaffe(game, e, 'lanze')) { updateTele(game, e, d, retreating, dt); if (!e.waffen) continue; }
    if (e.waffen) {   // EK1: Bolzen-Plätze (Korvette, Fregatte, Kreuzer); PAN-01 C: Streu- und Torpedo-Plätze (nur gezielt bestückt, nie Zufall)
      updateBolzen(game, e, d, toShip, retreating, dt);
      try { updateStreuG(game, e, d, retreating, dt); updateTorpedoG(game, e, d, retreating, dt); } catch (err) { if (game.countError) game.countError('gegner-waffen', err); }
      continue;
    }
    // Schießen (nur wenn das Schiff in einem Feuerbogen liegt)
    e.fireT += dt;
    // QA M3b: im neuen Flugmodell eigenes Feuerintervall und Vorhalt (spaceM3b.pilotFire) – sonst trafen Jäger im kurzen
    // Anflug kaum: ein Schuss je Überflug, gezielt auf die alte Position (Schiff fährt 1–1,5 s Flugzeit weiter)
    const PF = Pilot.flies(game, e) ? ((M3B(game).pilotFire || {})[e.kind] || null) : null;
    const interval = (PF && PF.fireInterval != null ? PF.fireInterval : cfg.fireInterval) * Gsys.taktFaktor(game, e, waffenPlaetze(game, e));   // SYS-01 C1a-1: beschädigte Waffe: Feuerintervall × systemModell.gegner.taktBeschaedigt
    if (!retreating && e.fireT >= interval * crewScale(game).enemyFireInterval && d <= waffenReichweite(game, cfg.range) && enemyCanHit(game, e) && !ship.docked && !holdingFire(game)) {
      e.fireT = 0;
      const kind = cfg.emp ? 'emp' : 'enemy';
      const ang = PF && PF.lead ? leadAngle(e.x, e.y, ship, C.combat.enemyShotSpeed, PF.lead) : toShip;
      sp.projectiles.push({ id: game.nextId('pr'), kind, x: e.x, y: e.y, angle: ang, speed: C.combat.enemyShotSpeed,
        ttl: C.combat.enemyShotTtl, dmg: PF && PF.damage != null ? PF.damage : cfg.damage, owner: e.id });
      game.emit('sfx', { name: 'blaster' });
    }
  }
}

// ---------- EK1: Bolzen (Korvette) ----------
// Plätze mit Bolzen schießen einzelne gezielte Schüsse (Projektil wie beim Jäger), eigener Takt (e.boltT), ruhen während
// einer Ladung, beim Rückzug, angedockt oder bei Feuerpause. Schaden und Intervall wie die Grundwerte der Korvette.
function updateBolzen(game, e, d, toShip, retreating, dt) {
  const C = game.C; const ship = game.ship; const cfg = C.enemies[e.kind];
  if (!hatWaffe(game, e, 'bolzen')) return;
  e.boltT = (e.boltT == null ? cfg.fireInterval * 0.5 : e.boltT) + dt;
  if (e.tele || retreating || ship.docked || holdingFire(game)) return;
  // SYS-01 C1a-1: Feuerintervall × Takt-Faktor der Plätze dieser Art (eine beschädigte Waffe schießt langsamer; zerstörte Plätze fehlen in waffenPlaetze)
  if (e.boltT < cfg.fireInterval * crewScale(game).enemyFireInterval * Gsys.taktFaktor(game, e, waffenPlaetze(game, e, 'bolzen')) || d > waffenReichweite(game, cfg.range) || !enemyCanHit(game, e, null, 'bolzen')) return;
  e.boltT = 0;
  // EK1b: je Bolzen-Platz im Bogen ein Schuss aus der Mündung des Platzes (Plätze ohne Lage pos: aus der Schiffsmitte wie bisher)
  const W = plaetzeImBogen(game, e, ship, 'bolzen');   // zerstörte Plätze fehlen (waffenPlaetze); enemyCanHit verlangt oben einen Platz im Bogen
  const quellen = W.length ? W : [null];
  for (const w of quellen) {
    const o = w && w.pos != null ? platzPunkt(game, e, w) : { x: e.x, y: e.y };
    game.space.projectiles.push({ id: game.nextId('pr'), kind: 'enemy', x: o.x, y: o.y, angle: w && w.pos != null ? Math.atan2(ship.y - o.y, ship.x - o.x) : toShip, speed: C.combat.enemyShotSpeed,
      ttl: C.combat.enemyShotTtl, dmg: cfg.damage, owner: e.id });
  }
  game.emit('sfx', { name: 'blaster' });
}

// ---------- PAN-01 C: Streu- und Torpedo-Plätze der Gegner (nur gezielt bestückt: Labor, Spielleiter, Regiebuch) ----------
// Streu: alle streuIv s ein Wurf von Granaten auf den vorhergesagten Ort der Lerche (verzögert, ausweichbar). Torpedo: ein zielsuchender Torpedo je torpedoIv s,
// langsam und schwer, zerstört ein System der Zone der Lerche und trifft den Reaktor (systemModell.torpedo), geht an den Schilden vorbei, ist ausweichbar (Ausweichfenster) und
// vom Abwehrturm abschießbar. Gleiche Regeln wie für die Lerche: derselbe Katalog.
function updateStreuG(game, e, d, retreating, dt) {
  if (!e.waffen || !hatWaffe(game, e, 'streu')) return;
  const ship = game.ship; const w = Katalog.waffe('streubatterie'); const T = w.streu;
  e.streuG = (e.streuG == null ? 1.5 : e.streuG) + dt;
  if (e.tele || retreating || ship.docked || holdingFire(game)) return;
  const iv = game.C.enemies[e.kind].fireInterval * 1.5 * crewScale(game).enemyFireInterval * Gsys.taktFaktor(game, e, waffenPlaetze(game, e, 'streu'));   // SYS-01 C1a-1: beschädigte Waffe: Intervall × Takt-Faktor
  if (e.streuG < iv || d > waffenReichweite(game, w.reichweite) || !enemyCanHit(game, e, null, 'streu')) return;
  e.streuG = 0;
  const W = plaetzeImBogen(game, e, ship, 'streu', w.reichweite);
  for (const pl of (W.length ? W : [null])) {
    const o = pl && pl.pos != null ? platzPunkt(game, e, pl) : { x: e.x, y: e.y };
    const tx = ship.x + (ship.vx || 0) * T.zuend, ty = ship.y + (ship.vy || 0) * T.zuend;
    const a0 = Math.atan2(ty - o.y, tx - o.x);
    for (let i = 0; i < w.rohre; i++) {
      const off = (i - (w.rohre - 1) / 2) * (T.radius * 1.3);
      const ex = tx - Math.sin(a0) * off, ey = ty + Math.cos(a0) * off;
      const dd = Math.max(30, Math.hypot(ex - o.x, ey - o.y));
      game.space.projectiles.push({ id: game.nextId('pr'), kind: 'estreu', x: o.x, y: o.y, angle: Math.atan2(ey - o.y, ex - o.x), speed: dd / T.zuend, ttl: T.zuend, ttlMax: T.zuend, dmg: w.schaden, owner: e.id });
    }
  }
  game.emit('sfx', { name: 'streu_wurf', enemy: e.kind, x: Math.round(e.x), y: Math.round(e.y) });
}
function updateTorpedoG(game, e, d, retreating, dt) {
  if (!e.waffen || !hatWaffe(game, e, 'torpedo')) return;
  const ship = game.ship; const T = Katalog.TORPEDO;
  e.torpG = (e.torpG == null ? T.cooldown * 0.5 : e.torpG) + dt;
  if (e.tele || retreating || ship.docked || holdingFire(game)) return;
  const iv = T.cooldown * 1.2 * (crewScale(game).enemyFireInterval / ((game.C.crewScaling[3] || {}).enemyFireInterval || 1)) * Gsys.taktFaktor(game, e, waffenPlaetze(game, e, 'torpedo'));   // SYS-01 C1a-1: beschädigte Waffe: Intervall × Takt-Faktor
  if (e.torpG < iv || d > waffenReichweite(game, 650) || !enemyCanHit(game, e, null, 'torpedo')) return;
  e.torpG = 0;
  const pl = plaetzeImBogen(game, e, ship, 'torpedo', 650)[0];
  const o = pl && pl.pos != null ? platzPunkt(game, e, pl) : { x: e.x, y: e.y };
  game.space.projectiles.push({ id: game.nextId('pr'), kind: 'etorpedo', x: o.x, y: o.y, angle: Math.atan2(ship.y - o.y, ship.x - o.x), speed: T.gegnerGeschw, ttl: T.gegnerTtl, owner: e.id });
  game.emit('sfx', { name: 'torpedo', enemy: e.kind, x: Math.round(o.x), y: Math.round(o.y) });
}
// Explosion einer Gegner-Granate an der Lerche: eine = Schildschaden, zwei (andere Granaten) im Fenster = Durchschlag in die Hülle und sicherer Systemschaden
function estreuExplosion(game, p) {
  const ship = game.ship; const w = Katalog.waffe('streubatterie'); const T = w.streu;
  game.emit('explosion', { x: Math.round(p.x), y: Math.round(p.y), zone: 'space', small: true });
  game.emit('sfx', { name: 'streu_boom', x: Math.round(p.x), y: Math.round(p.y) });
  if (ship.docked || dist(p.x, p.y, ship.x, ship.y) > T.radius + game.C.flight.radius * 0.5) return;
  const L = ship.streuT || (ship.streuT = []);
  while (L.length && game.time - L[0] > T.fenster) L.shift();
  const zwei = L.length >= 1;
  L.push(game.time);
  const sec = Physics.sectorOf(ship.x, ship.y, ship.angle, p.x, p.y);
  shipHit(game, sec, p.dmg, { streu: { schildFaktor: T.schildFaktor } });
  if (zwei) {
    shipHit(game, sec, T.durchschlag, { pierce: true, streuZwei: true });   // SYS-01 A1a: ohne Schild trifft der Durchschlag immer ein System (Trefferweg)
    game.stats.streuZweiLerche = (game.stats.streuZweiLerche || 0) + 1;
  }
}

// ---------- S2b §2: Sperrfeuer (Korvette) ----------
// Feuerstöße aus der Breitseite: burst Geschosse im Abstand burstGap, Stoß alle interval s (× Crew-Faktor relativ zu
// einer Dreier-Crew). Geschosse fliegen langsam (speed) und geradeaus (kein Zielsuchen), gezielt auf den Abfangpunkt bei
// gehaltenem Kurs (sperrAim, höchstens maxLead s) plus Streuung ±spread/2.
// Kein Sperrfeuer, solange eine Ladung läuft, kurz bevor eine beginnt, beim Rückzug, angedockt oder bei Feuerpause.
function sperrCfg(game) { const s = game.C.spaceS2b; return s && s.sperrfeuer ? s.sperrfeuer : null; }
// PAN-01 C: Sturmbatterie des Gegners = Sperrfeuer mit den Katalogwerten (viele dünne Nadeln, kaum Schildschaden, Schild der Lerche regeneriert nicht)
function sturmCfg(game) {
  const base = sperrCfg(game); const w = Katalog.waffe('sturmbatterie');
  // SYS-01 B1: Gegner-Sperrfeuer hat eigene Werte (gegner.burst/burstGap), nicht den Katalogwert der Lerche
  return base ? Object.assign({}, base, { burst: w.gegner.burst, burstGap: w.gegner.burstGap, speed: 170, ttl: 4, damage: 0.15, spread: 0.1, range: w.reichweite, maxProjectiles: 24 }) : null;
}
function sperrInterval(game, S) {
  const cs = game.C.crewScaling || {}; const ref = (cs[3] && cs[3].enemyFireInterval) || 1;
  return S.interval * (crewScale(game).enemyFireInterval / ref);
}
function sperrStats(game) {
  return game.stats.sperrfeuer || (game.stats.sperrfeuer = { bursts: 0, shots: 0, hits: 0, schaden: 0, shielded: 0, escortHits: 0 });
}
// EK1b: Mündung eines Platzes mit Lage (pos entlang der Schiffslänge, quer seitlich versetzt) – Anteil des Klassenradius; Seitenplätze sitzen
// außen am Rumpf. Plätze ohne pos (Korvette) nutzen weiter sperrMuzzle / die Schiffsmitte.
function platzPunkt(game, e, w) {
  const SC = game.C.shipClasses && game.C.shipClasses[e.kind]; const R = (SC && SC.radius) || 32;
  const c = Math.cos(e.angle), s = Math.sin(e.angle);
  const f = (w.pos || 0) * R, q = (w.quer || 0) * R;
  const fa = e.angle + (w.facing || 0) * Math.PI / 180;
  const ab = Math.abs(w.facing || 0) >= 45 ? Math.max(22, R * 0.62) : 0;
  return { x: e.x + c * f - s * q + Math.cos(fa) * ab, y: e.y + s * f + c * q + Math.sin(fa) * ab };
}
function sperrMuzzle(e, T, W) {
  // Mündung am Batterie-Platz, der zum Ziel zeigt (Winkelabstand zur Platzrichtung am kleinsten); ohne Plätze die Breitseite
  const rel = Physics.normAngle(Math.atan2(T.y - e.y, T.x - e.x) - e.angle);
  let facing = (rel >= 0 ? 1 : -1) * Math.PI / 2;
  if (W && W.length) {
    let best = Infinity;
    for (const w of W) { const f = w.facing * Math.PI / 180; const dd = Math.abs(Physics.normAngle(rel - f)); if (dd < best) { best = dd; facing = f; } }
  }
  const side = e.angle + facing;
  return { x: e.x + Math.cos(side) * 22, y: e.y + Math.sin(side) * 22 };
}
// Abfang-Winkel von o auf T (Geschwindigkeit T.vx/T.vy) bei Geschosstempo S.speed; Vorhersage höchstens S.maxLead s,
// anteilig S.lead (0 = auf die aktuelle Position). Ohne Lösung (Ziel schneller und flieht): aktuelle Position.
function sperrAim(o, T, S) {
  const f = S.lead != null ? Math.max(0, Math.min(1, Number(S.lead))) : 1;
  const rx = T.x - o.x, ry = T.y - o.y; const vx = (T.vx || 0) * f, vy = (T.vy || 0) * f; const v = S.speed;
  const a = vx * vx + vy * vy - v * v, b = 2 * (rx * vx + ry * vy), c = rx * rx + ry * ry;
  let t = 0;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : 0;
  else { const disc = b * b - 4 * a * c; if (disc >= 0) { const s = Math.sqrt(disc); const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a); const ts = [t1, t2].filter((q) => q > 0); t = ts.length ? Math.min(...ts) : 0; } }
  t = Math.max(0, Math.min(S.maxLead != null ? Number(S.maxLead) : 4, t));
  return Math.atan2(ry + vy * t, rx + vx * t);
}
function updateSperrfeuer(game, e, retreating, dt, verh) {
  verh = verh || 'batterie';
  const sturm = verh === 'sturm';
  const S = sturm ? sturmCfg(game) : sperrCfg(game);
  if (!S || !(S.burst > 0) || !(S.interval > 0)) return;
  const ship = game.ship; const sp = game.space; const C = game.C;
  const sf = sturm ? (e.sfS || (e.sfS = { t: 0, left: 0, gapT: 0, n: 0 })) : (e.sf || (e.sf = { t: 0, left: 0, gapT: 0, n: 0 }));
  const T = Pilot.targetOf(game, e);
  const cfg = C.enemies[e.kind];
  // Ladung läuft (auch auf einen Schützling): Stoß abbrechen, Takt ruht
  if (e.tele || retreating || e.leaving || ship.docked || holdingFire(game) || !T) {
    sf.left = 0;
    if (e.tele) sf.t = Math.min(sperrInterval(game, S), sf.t + dt);   // nach der Ladung sofort wieder bereit
    return;
  }
  const range = waffenReichweite(game, S.range || cfg.range);   // W2: Nebel
  const W = waffenPlaetze(game, e, verh);   // EK1: nur Plätze mit Batterie (PAN-01 C: bzw. Sturm)
  if (!W.length) return;
  const imBogen = W.filter((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, range, T.x, T.y));
  const inArc = imBogen.length > 0;
  // EK1b: Plätze mit Lage schießen je Platz im Bogen; ohne Lage (Korvette) ein Strom aus sperrMuzzle wie bisher
  const lage = imBogen.some((w) => w.pos != null);
  const mund = (w) => (lage ? platzPunkt(game, e, w) : sperrMuzzle(e, T, W));
  if (sf.left > 0) {
    sf.gapT -= dt;
    while (sf.left > 0 && sf.gapT <= 0) {
      sf.gapT += S.burstGap || 0.25;
      const i = sf.n++; sf.left--;
      if (!inArc) continue;   // Ziel aus dem Bogen gedreht: Geschoss entfällt
      for (const w of (lage ? imBogen : [null])) {
        const o = w ? mund(w) : sperrMuzzle(e, T, W);
        // Kurs-Vorhersage: gezielt wird dorthin, wo das Ziel ist, wenn es Kurs und Tempo hält (Abfangpunkt, höchstens
        // maxLead s voraus). Ungelenkt und langsam: Kurswechsel, Tempowechsel oder Ausweichen bringen den Stoß vorbei.
        const ang = sperrAim(o, T, S) + game.rng.range(-(S.spread || 0) / 2, (S.spread || 0) / 2);
        const p = { id: game.nextId('pr'), kind: sturm ? 'sturm' : 'sperrfeuer', x: o.x, y: o.y, angle: ang, speed: S.speed, ttl: S.ttl, dmg: S.damage, owner: e.id };
        if (T !== ship) p.tgt = T.id;
        // Obergrenze (Snapshot-Budget): das älteste Sperrfeuer-Geschoss fällt weg
        const max = S.maxProjectiles || 0;
        if (max > 0) {
          const kk = p.kind; let n = 0; for (const q of sp.projectiles) if (q.kind === kk) n++;
          if (n >= max) { const k = sp.projectiles.findIndex((q) => q.kind === kk); if (k >= 0) sp.projectiles.splice(k, 1); }
        }
        sp.projectiles.push(p);
        sperrStats(game).shots++;
      }
    }
    if (sf.left <= 0) { sf.left = 0; sf.t = 0; }
    return;
  }
  sf.t += dt;
  if (sf.t < sperrInterval(game, S) * Gsys.taktFaktor(game, e, W) || !inArc) return;   // SYS-01 C1a-1: beschädigte Waffe: Intervall × Takt-Faktor (W = Plätze dieser Art ohne zerstörte)
  // Kurz vor einer Ladung keinen Stoß beginnen (lesbar: erst Sperrfeuer, dann Ruhe, dann Ladung)
  const teleIv = cfg.fireInterval * crewScale(game).enemyFireInterval;
  const burstDur = (S.burst - 1) * (S.burstGap || 0.25);
  // (nur wenn die Ladung auch beginnen kann – im Band zwischen Lade- und Sperrfeuer-Reichweite feuert das Boot weiter)
  if (M3(game).tele && M3(game).tele[e.kind] && hatWaffe(game, e, 'lanze') && e.fireT + burstDur + 0.5 >= teleIv && dist(e.x, e.y, T.x, T.y) <= waffenReichweite(game, cfg.range)) return;
  sf.left = S.burst; sf.n = 0; sf.gapT = 0; sf.t = 0;
  sperrStats(game).bursts++;
  const o = lage ? platzPunkt(game, e, imBogen[0]) : sperrMuzzle(e, T, W);
  game.emit('sfx', { name: sturm ? 'sturm_salvo' : 'sperrfeuer', enemy: e.kind, x: Math.round(o.x), y: Math.round(o.y) });
  game.missionEvent('sperrfeuer', { enemy: e });
}

// M3a-Bewegung (kinematisch): Missionen bis Schritt B, Relais und Wächter immer. Setzt vx/vy für die Interpolation.
function moveLegacy(game, e, dt, retreating) {
  const C = game.C; const ship = Pilot.targetOf(game, e); const sp = game.space;   // S2: Ziel (ohne targetId die Lerche)
  const cfg = C.enemies[e.kind];
  const x0 = e.x, y0 = e.y;
  {
    const dx = e.x - ship.x, dy = e.y - ship.y;
    const d = Math.hypot(dx, dy) || 1;
    const toShip = Math.atan2(ship.y - e.y, ship.x - e.x);
    let tx = e.x, ty = e.y, face = null;
    if (e.fluchtZiel) {   // SUND-04a-1 A: Verfolgung – das Zielschiff fährt zum Fluchtpunkt und bleibt dort (Sprungladung); gilt auch beim Rückzug
      const fz = Verfolgung.fluchtZiel(e);
      tx = fz.x; ty = fz.y;
    } else if (retreating) {
      tx = ship.x + dx / d * C.combat.retreatDist; ty = ship.y + dy / d * C.combat.retreatDist;
    } else if (e.kind === 'relay') {
      const b = stationPoint(game);
      e.orbitA = (e.orbitA || 0) + dt * 0.18 * e.orbitDir;
      tx = b.x + Math.cos(e.orbitA) * C.combat.relayOrbit; ty = b.y + Math.sin(e.orbitA) * C.combat.relayOrbit;
    } else if (e.kind === 'pylon') {
      tx = e.home.x; ty = e.home.y;
      e.angle = turnToward(e.angle, toShip, cfg.turnRate * dt);
      face = e.angle;
    } else if (e.kind === 'sentinel') {
      const a = Math.atan2(dy, dx) + 0.35 * e.orbitDir;
      tx = ship.x + Math.cos(a) * 240; ty = ship.y + Math.sin(a) * 240;
      face = toShip;
    } else if (e.kind === 'raider') {
      // M3a: Kreisrichtung regelmäßig wechseln – sonst „parkt“ ein Jäger im toten Winkel achtern, weil er so schnell
      // um das Schiff kreist, wie es dreht (spaceM3.raiderFlip s, 0 = aus)
      const flip = M3(game).raiderFlip || 0;
      if (flip > 0) { e.flipT = (e.flipT || 0) + dt; if (e.flipT >= flip) { e.flipT = 0; e.orbitDir = -e.orbitDir; } }
      const a =Math.atan2(dy, dx) + 0.55 * e.orbitDir;
      tx = ship.x + Math.cos(a) * C.combat.raiderOrbit; ty = ship.y + Math.sin(a) * C.combat.raiderOrbit;
      if (d <= cfg.range + 120) face = toShip;   // in Reichweite: Bug (Kanone) zum Schiff
    } else {
      // Korvette: Breitseite halten, regelmäßig quer vor dem Bug die Seite wechseln
      e.phaseT += dt;
      const rel = Physics.normAngle(Math.atan2(dy, dx) - ship.angle);
      if (e.phase === 'broadside') {
        e.side = rel >= 0 ? 1 : -1;
        if (e.phaseT >= C.combat.korvetteBroadside) { e.phase = 'crossing'; e.phaseT = 0; e.side = -e.side; }
        const a = ship.angle + e.side * Math.PI / 2;
        tx = ship.x + Math.cos(a) * C.combat.korvetteDist; ty = ship.y + Math.sin(a) * C.combat.korvetteDist;
      } else {
        const goal = e.side * Math.PI / 2;
        const step = Math.sign(goal - rel) * 0.6;
        const nrel = Math.abs(goal - rel) < 0.6 ? goal : rel + step;
        const a = ship.angle + nrel;
        tx = ship.x + Math.cos(a) * C.combat.korvetteDist; ty = ship.y + Math.sin(a) * C.combat.korvetteDist;
        if ((Math.sign(rel) === e.side && Math.abs(rel) > 1.2) || e.phaseT >= C.combat.korvetteCrossing) { e.phase = 'broadside'; e.phaseT = 0; }
      }
      face = toShip + Math.PI / 2;
    }
    // QA S2b (Golden m2/3 Seed 6): Steht das Ziel in einer Ecke, lag der Kreispunkt außerhalb der Karte – der Jäger klebte
    // am Rand auf dem Schiff (Abstand 14 px), traf nicht und war nicht zu treffen: 400 s Patt. Zielpunkt im Feld halten.
    if (!retreating && !e.fluchtZiel && e.kind !== 'pylon' && e.kind !== 'relay') { tx = clamp(tx, 120, sp.w - 120); ty = clamp(ty, 120, sp.h - 120); }
    const mx = tx - e.x, my = ty - e.y;
    const md = Math.hypot(mx, my);
    let vKin = cfg.speed;
    if (e.fluchtZiel) vKin = Verfolgung.legacyTempo(cfg.speed, e);   // SUND-04a-1 A: Fluchttempo des kinematischen Modells (Daten)
    vKin *= Zielsysteme.tempoFaktor(e);   // C1b-1: Antrieb (e.sys) beschädigt/ausgefallen; ohne Antrieb-Modell genau 1
    const step = Math.min(md, vKin * dt);
    if (md > 1 && cfg.speed > 0) {
      // W2 AP3b: um Brocken herum (Vorausschau 1,5 s, mindestens 80 px) – ohne Brocken unverändert
      const u = game.space.asteroids.length ? brockenAusweichen(game, e.x, e.y, mx / md, my / md, gegnerRadius(game, e), Math.max(80, cfg.speed * 1.5)) : { x: mx / md, y: my / md };
      e.x += u.x * step; e.y += u.y * step;
    }
    e.x = clamp(e.x, 30, sp.w - 30); e.y = clamp(e.y, 30, sp.h - 30);
    if (e.kind !== 'pylon') {
      const want = retreating || e.fluchtZiel ? (md > 2 ? Math.atan2(my, mx) : e.angle) : (face != null ? face : (md > 2 ? Math.atan2(my, mx) : e.angle));
      e.angle = turnToward(e.angle, want, 3 * dt);
    }
  }
  if (dt > 0) { e.vx = (e.x - x0) / dt; e.vy = (e.y - y0) / dt; }
}

// Snapshot-Ergänzung je Gegner (M3b §3): vx, vy (Interpolation) und state (nur im neuen Flugmodell).
// game.js: Object.assign(o, space.enemySnapExtra(e))
function enemySnapExtra(e) {
  const o = { vx: r1(e.vx || 0), vy: r1(e.vy || 0) };
  const st = Pilot.snapState(e);
  if (st) o.state = st;
  const kx = Konvoi.snapExtra(e);   // EK3 Teil B: sj = Sprungaufladung des Transporters
  if (kx) Object.assign(o, kx);
  { const zx = Zielsysteme.snapExtra(e); if (zx) Object.assign(o, zx); }   // C1b-1: az = Antriebsstufe aus e.sys (fehlt = voll oder ohne Wirkung), ag = gestellt
  if (e.fluchtZiel) { const vx = Verfolgung.snapExtra(e); if (vx) Object.assign(o, vx); }   // SUND-04a-1 A: sj = Sprungladung des Flüchtigen, nm = Name
  return o;
}

// ---------- Angekündigte Angriffe (M3a §7.1) ----------
function teleSector(game, e) { const s = game.ship; return Physics.sectorOf(s.x, s.y, s.angle, e.x, e.y); }
function startTele(game, e) {
  const T = M3(game).tele; const t = T[e.kind];
  if (!t) return false;
  e.tele = { kind: t.emp ? 'emp' : 'shot', left: t.dur, dur: t.dur, sector: teleSector(game, e), delayed: 0 };
  // Achtung: emit() mischt data in { t, kind } – kein Feld 'kind' mitgeben (sonst überschreibt es den Ereignistyp)
  game.emit('tele', { id: e.id, tkind: e.tele.kind, sector: e.tele.sector, dur: e.tele.dur, enemy: e.kind });
  game.emit('sfx', { name: 'tele_charge', enemy: e.kind, dur: e.tele.dur, key: e.id });
  game.missionEvent('tele', { enemy: e });
  // Solo: ODA sagt jede Ladung an (Abklingzeit je Gegner)
  const solo = game.players.filter((p) => p.connected).length === 1;
  if (solo && (e.teleOdaAt == null || game.time - e.teleOdaAt >= T.odaCooldown)) {
    e.teleOdaAt = game.time;
    game.oda(`${ENEMY_LABEL[e.kind] || 'Gegner'} lädt – ${SECTOR_LABEL[e.tele.sector]}!`, null);
  }
  return true;
}
function updateTele(game, e, d, retreating, dt) {
  const C = game.C; const ship = game.ship; const cfg = C.enemies[e.kind]; const t = M3(game).tele[e.kind];
  if (e.tele) {
    if (retreating || ship.docked) { e.tele = null; e.fireT = 0; game.emit('teleMiss', { id: e.id }); return; }
    e.tele.sector = teleSector(game, e);
    e.tele.left -= dt;
    if (e.tele.left > 0) return;
    const sector = e.tele.sector; const emp = e.tele.kind === 'emp';
    e.tele = null; e.fireT = 0;
    // §20.2: Ausweichen kurz vor dem Ende der Ladung -> der schwere Treffer verfehlt
    const DW = M3(game).dodgeWindow;
    if (DW > 0 && game.time - (ship.lastDodgeT != null ? ship.lastDodgeT : -99) <= DW + EPS) {
      game.stats.teleMisses = (game.stats.teleMisses || 0) + 1;
      game.stats.dodgeEvades = (game.stats.dodgeEvades || 0) + 1;
      game.emit('teleMiss', { id: e.id, dodged: true });
      game.emit('sfx', { name: 'dodge_evade', enemy: e.kind });
      game.missionEvent('dodgeEvade', { enemy: e });
      return;
    }
    // W2: ein Brocken zwischen Gegner und Lerche fängt die Ladung (wie bei den Strahlen der Lerche)
    const rock = d <= waffenReichweite(game, cfg.range) && enemyCanHit(game, e, null, 'lanze') ? brockenImWeg(game, e.x, e.y, ship.x, ship.y) : null;
    if (rock) {
      brockenStats(game).strahlen++;
      game.space.beams.push({ x1: e.x, y1: e.y, x2: rock.x, y2: rock.y, ttl: C.combat.beamTtl * 1.6, kind: 'enemy_heavy', owner: e.id });
      game.stats.teleMisses = (game.stats.teleMisses || 0) + 1;
      game.emit('teleMiss', { id: e.id, brocken: true });
    } else if (d <= waffenReichweite(game, cfg.range) && enemyCanHit(game, e, null, 'lanze')) {
      game.space.beams.push({ x1: e.x, y1: e.y, x2: ship.x, y2: ship.y, ttl: C.combat.beamTtl * 1.6, kind: 'enemy_heavy', owner: e.id });
      game.emit('sfx', { name: 'heavy_hit', enemy: e.kind });
      game.stats.heavyHits = (game.stats.heavyHits || 0) + 1;
      // EK1b: weitere Lanze-Plätze im Bogen verstärken die Ladung (waffenMehr.lanzeJeWeitere je Platz); Korvette: nie mehr als einer im Bogen
      const nL = e.waffen ? Math.max(1, plaetzeImBogen(game, e, ship, 'lanze').length) : 1;
      const mehr = 1 + ((C.waffenMehr && C.waffenMehr.lanzeJeWeitere) || 0) * (nL - 1);
      shipHit(game, sector, (t.damage != null ? t.damage : cfg.damage) * mehr, Zielsysteme.szeneAktiv(game) ? { heavy: true, emp, angriff: true, zielt: Zielsysteme.lercheZiel(e.zielsystem) } : { heavy: true, emp });
    } else {
      game.stats.teleMisses = (game.stats.teleMisses || 0) + 1;
      game.emit('teleMiss', { id: e.id });
    }
    return;
  }
  e.fireT += dt;
  if (!retreating && !ship.docked && !holdingFire(game) && e.fireT >= cfg.fireInterval * crewScale(game).enemyFireInterval * Gsys.taktFaktor(game, e, waffenPlaetze(game, e, 'lanze')) && d <= waffenReichweite(game, cfg.range) && enemyCanHit(game, e, null, 'lanze')) startTele(game, e);   // SYS-01 C1a-1: beschädigtes Lanzensystem: Intervall × Takt-Faktor
}
// M4 §2.4: erster Feindkontakt frühestens CONFIG.lift.firstContactDelay s nach dem Gefechtsalarm, wenn jemand auf Deck II war
// (game.updateAlert setzt ship.holdFireUntil).
function holdingFire(game) { return game.ship.holdFireUntil != null && game.time < game.ship.holdFireUntil; }
function enemyTeleSnap(e) {
  const t = e && e.tele;
  return t ? { kind: t.kind, left: r2(Math.max(0, t.left)), dur: r2(t.dur), sector: t.sector } : null;
}
// Debug `tele [id]`: sofort laden (ohne Bogen-/Reichweitenprüfung)
function debugTele(game, id) {
  const T = M3(game).tele;
  const list = game.space.enemies.filter((e) => T[e.kind]);
  const e = id != null && id !== '' ? list.find((q) => q.id === String(id)) : list.find((q) => !q.tele) || list[0];
  if (!e) return id ? 'Kein ladefähiger Gegner mit dieser ID (Korvette, Pylon, Wächter).' : 'Kein ladefähiger Gegner da (spawn korvette).';
  startTele(game, e);
  return null;
}

function torpedoNurOhneSchild() { return Katalog.TORPEDO.schildUmgehung === 'nur-ohne-schild'; }   // Kai 2026-10-18: Lesart B für alle Ziele
// PAN-01 C, SYS-02a: Gegner-Torpedo trifft die Lerche: bei Schild 0 im Sektor (Lesart B) wird ein System der Zone zerstört und der Reaktor anteilig getroffen (damage.torpedoTreffer, systemModell.torpedo).
// Wer kurz vorher ausgewichen ist (Ausweichfenster wie bei der Ladung), wird verfehlt.
function etorpedoTreffer(game, p) {
  const ship = game.ship; const T = Katalog.TORPEDO;
  const sec = Physics.sectorOf(ship.x, ship.y, ship.angle, p.x, p.y);
  const DW = M3(game).dodgeWindow;
  game.emit('explosion', { x: Math.round(p.x), y: Math.round(p.y), zone: 'space', small: true });
  if (DW > 0 && game.time - (ship.lastDodgeT != null ? ship.lastDodgeT : -99) <= DW + EPS) {
    game.stats.dodgeEvades = (game.stats.dodgeEvades || 0) + 1;
    game.emit('hit', { sector: sec, shield: true, dmg: 0, heavy: true, evaded: true });
    game.emit('sfx', { name: 'dodge_evade', enemy: 'torpedo' });
    return;
  }
  // Lesart B (Kai): bei stehendem Schildsektor prallt der Torpedo ab (kein Schaden, kein Schildabzug); ist der Sektor leer (Schild 0, Generator aus, Schilde unten), trifft er die Hülle
  if (Katalog.TORPEDO.schildUmgehung === 'nur-ohne-schild' && (ship.shields.current[sec] || 0) > 0 && Alarm.trefferOpts(game, {}).pierce !== true) {
    game.stats.torpedoAbgeprallt = (game.stats.torpedoAbgeprallt || 0) + 1;
    game.emit('hit', { sector: sec, shield: true, dmg: 0, heavy: true, absorbed: 0 });
    game.emit('sfx', { name: 'shield_hit' });
    return;
  }
  game.stats.torpedoLerche = (game.stats.torpedoLerche || 0) + 1;
  const eto = Zielsysteme.szeneAktiv(game) ? game.space.enemies.find((e) => e.id === p.owner) : null;
  shipHit(game, sec, 1, eto ? { pierce: true, heavy: true, torpedo: true, angriff: true, zielt: Zielsysteme.lercheZiel(eto.zielsystem) } : { pierce: true, heavy: true, torpedo: true });
}

function updateProjectiles(game, dt) {
  const C = game.C; const ship = game.ship; const sp = game.space;
  const keep = [];
  const rocks = brocken(game);
  for (const p of sp.projectiles) {
    if (p.weg) continue;
    p.ttl -= dt;
    if (p.kind === 'torpedo' || p.kind === 'etorpedo') Waffen.lenke(game, p, dt);   // PAN-01 C: zielsuchend
    p.x += Math.cos(p.angle) * p.speed * dt; p.y += Math.sin(p.angle) * p.speed * dt;
    // PAN-01 C: Granaten sind geworfen (Brocken stören nicht) und explodieren nach der Zündzeit
    if (p.kind === 'streu' || p.kind === 'estreu') {
      if (p.ttl > 0) { keep.push(p); continue; }
      if (p.kind === 'streu') Waffen.streuExplosion(game, p); else estreuExplosion(game, p);
      continue;
    }
    let hit = false;
    if (p.kind === 'pfunke') {   // Abwehrturm: Flak trifft anfliegende Gegner-Torpedos im Flug
      const tq = sp.projectiles.find((q) => q.kind === 'etorpedo' && dist(p.x, p.y, q.x, q.y) < 16);
      if (tq) {
        tq.weg = true; const ki = keep.indexOf(tq); if (ki >= 0) keep.splice(ki, 1);   // abgeschossen (noch nicht oder schon bearbeitet)
        game.emit('explosion', { x: Math.round(tq.x), y: Math.round(tq.y), zone: 'space', small: true });
        game.stats.torpedosAbgeschossen = (game.stats.torpedosAbgeschossen || 0) + 1;
        continue;
      }
    }
    // W2 AP3b (E4): Geschosse beider Seiten schlagen in Brocken ein
    if (rocks.length && rocks.some((a) => dist(p.x, p.y, a.x, a.y) < a.r)) { brockenStats(game).schuesse++; continue; }
    if (p.kind === 'enemy' || p.kind === 'emp' || p.kind === 'sperrfeuer' || p.kind === 'sturm' || p.kind === 'etorpedo') {
      if (dist(p.x, p.y, ship.x, ship.y) < C.flight.projectileHitDist) {
        hit = true;
        if (p.kind === 'etorpedo') { etorpedoTreffer(game, p); continue; }
        const sperr = p.kind === 'sperrfeuer' || p.kind === 'sturm';
        const owner = sp.enemies.find((e) => e.id === p.owner);
        const pierce = !sperr && !!(owner && owner.tag === 'nachzuegler' && !owner.hasHit);
        if (pierce) owner.hasHit = true;
        const hopts = { pierce, emp: p.kind === 'emp' };
        if (owner && Zielsysteme.szeneAktiv(game)) { hopts.angriff = true; if (owner.zielsystem) hopts.zielt = Zielsysteme.lercheZiel(owner.zielsystem); }   // SUND-04a-1 A: Angriff eines Gegners (gleiche Regel wie Lerche gegen Gegner)
        if (sperr) hopts.sperrfeuer = true;
        if (p.kind === 'sturm') hopts.sturm = true;
        if (p.tgt) { hopts.shielded = p.tgt; if (game.stats.escort) game.stats.escort.shielded++; }   // S2: Lerche fängt Salve auf den Schützling
        // S2b: Sperrfeuer auf einen Schützling, das die Lerche abfängt, zählt × shieldedFactor (sonst räumt es ihren Schild
        // ab, und die nächste Ladung auf den Schützling geht ungedeckt durch)
        let dmg = p.dmg;
        if (sperr && p.tgt) { const SF = sperrCfg(game) || {}; if (SF.shieldedFactor != null) dmg *= Number(SF.shieldedFactor); }
        const hsec = Physics.sectorOf(ship.x, ship.y, ship.angle, p.x, p.y);
        let rr = null;
        if (dmg > 0) rr = shipHit(game, hsec, dmg, hopts);
        else { game.emit('hit', { sector: hsec, shield: true, dmg: 0, heavy: false, absorbed: 0, shielded: p.tgt }); game.emit('sfx', { name: 'shield_hit', volume: 0.5 }); }
        if (sperr) { const st = sperrStats(game); st.hits++; st.schaden = r1(st.schaden + (rr ? Number(rr.rest) || 0 : 0)); if (p.tgt) st.shielded++; }
        if (pierce) game.missionEvent('nachzueglerHit', {});
      } else if (p.tgt) {
        try { hit = Escort.projectileHit(game, p); } catch (err) { if (game.countError) game.countError('escort-projectile', err); }
      }
    } else {
      for (const e of sp.enemies) {
        if (dist(p.x, p.y, e.x, e.y) < (C.combat.hitRadius[e.kind] || 18)) {
          hit = true;
          if (p.waffe) {   // PAN-01 C: Projektil der Lerche (Batterie, Kanone, Sturm, Abwehrturm): Schaden je Treffer = Katalogwert, Schild und Hülle wie bisher
            const wk = Katalog.waffe(p.waffe);
            game.stats.schussTreffer = (game.stats.schussTreffer || 0) + 1;
            Waffen.schade(game, e, p.dmg, p.x - Math.cos(p.angle) * 20, p.y - Math.sin(p.angle) * 20, p.waffe === 'sturmbatterie' ? { sturm: wk.sturm } : undefined, p.waffe);
          } else if (p.kind === 'torpedo') {   // PAN-01 C: kein Schildschaden, trifft die Hülle; Schaden je Zielklasse (Katalog TORPEDO.schaden)
            game.emit('explosion', { x: Math.round(p.x), y: Math.round(p.y), zone: 'space', small: true });
            const dgel = Waffen.schade(game, e, Katalog.torpedoSchaden(e.kind), p.x - Math.cos(p.angle) * 20, p.y - Math.sin(p.angle) * 20, { huelle: true, nurOhneSchild: torpedoNurOhneSchild(), torpedo: true }, 'torpedowerfer');
            if (dgel > 0) game.stats.torpedoTreffer = (game.stats.torpedoTreffer || 0) + 1; else game.stats.torpedoAbgeprallt = (game.stats.torpedoAbgeprallt || 0) + 1;   // Lesart B: am stehenden Schild abgeprallt
          } else damageEnemy(game, e, p.dmg, p.x - Math.cos(p.angle) * 20, p.y - Math.sin(p.angle) * 20, p.kind === 'ally' ? { ally: true, angriff: true } : undefined);   // SUND-04a-1 A: Treffer der Verbündeten zählen als Angriff (ungezielt)
          break;
        }
      }
      if (!hit && sp.minen && sp.minen.length) {   // EK2: Geschosse der Lerche treffen Minen
        const mn = Alarm.mineAt(game, p.x, p.y);
        if (mn) { hit = true; Alarm.abschuss(game, mn); }
      }
    }
    if (!hit && p.ttl > 0 && p.x > -50 && p.y > -50 && p.x < sp.w + 50 && p.y < sp.h + 50) keep.push(p);
  }
  sp.projectiles = keep;
}

function update(game, dt) {
  ensureM3(game);
  // W2 AP3b: wirksame Waffenreichweite (Nebel) für pilot.js – ohne Require von space.js (Zirkelbezug)
  if (!game.waffenReichweite) game.waffenReichweite = (range) => waffenReichweite(game, range);
  game.ship.widescan.cd = Math.max(0, game.ship.widescan.cd - dt);
  updateSystems(game, dt);
  updateFlight(game, dt);
  updateJump(game, dt);
  Reise.update(game, dt);   // Schnellsprung: Hop für Hop
  updateWeapons(game, dt);
  updateTargetScan(game, dt);
  updateEnemies(game, dt);
  for (const e of game.space.enemies) if (e.sys) Gegnerreparatur.tick(game, e, dt);   // SYS-01 C2a: Reparatur der Gegner (in jeder Szene)
  Konvoi.update(game, dt);   // EK3 Teil B: Zerstörte/Gesprungene, Alarm der Eskorte, Ausgang (ohne Konvoi sofort zurück)
  Zielsysteme.update(game);   // SUND-04a-1 A: Erholung der Zielsysteme (nur Gegner mit e.zs)
  Verfolgung.update(game, dt);   // SUND-04a-1 A: Fluchtpunkt, Sprungladung, Stellen, Ausgang (ohne Verfolgung sofort zurück)
  Alarm.update(game, dt);   // EK2: Lärm, Entdeckung, Einsprung, Minen
  Zonen.update(game, dt);   // SL6: Zonen wirken auf Lerche, Gegner und Schützlinge (nach den Flügen, vor den Geschossen)
  // S2 §5: Schützlinge und Rückzugsregel (nur wenn vorhanden – sonst unverändert)
  const sp = game.space;
  if ((sp.escorts && sp.escorts.length) || sp.retreatRule || sp.enemies.some((e) => e.leaving)) {
    try { Escort.update(game, dt); } catch (err) { if (game.countError) game.countError('escort', err); }
  }
  // W2 AP3b: Schützlinge und Brocken – dieselbe Regel (hinausschieben, Treffer über Escort.hit, Sperre je Brocken)
  if (sp.escorts && sp.escorts.length && sp.asteroids.length) {
    for (const es of sp.escorts) {
      const SC = game.C.shipClasses && game.C.shipClasses[es.kind];
      brockenStoss(game, es, (SC && SC.radius) || 30, (a) => {
        const im = es.brockenImmun || (es.brockenImmun = {});
        if ((im[a.id] || 0) > game.time) return;
        im[a.id] = game.time + game.C.flight.asteroidImmunity;
        try { Escort.hit(game, es, game.C.asteroid.damage, { light: true }); } catch (err) { if (game.countError) game.countError('escort-brocken', err); }
      });
    }
  }
  updateProjectiles(game, dt);
  updateSalvage(game);
}

// ---------- Konsolenbefehle ----------
function technikPower(game, sys, delta) {
  const C = game.C; const pw = game.ship.power;
  if (!POWER_SYSTEMS.includes(sys)) return 'Unbekanntes System.';
  const d = delta > 0 ? 1 : -1;
  const nv = pw[sys] + d;
  if (nv < 0 || nv > C.power.maxPerSystem) return 'Grenze erreicht.';
  if (d > 0 && powerDemand(game) + 1 > reactorOutput(game)) return 'Reaktor ausgelastet – erst woanders Energie abziehen oder ein Modul abschalten.';
  pw[sys] = nv;
  // PAN-01 A: nur der Wunsch für dieses System ändert sich; was die Kürzung bei Reaktorschaden den anderen Systemen genommen hat, bleibt als Wunsch erhalten
  if (!game.ship.powerIntent) game.ship.powerIntent = Object.assign({}, pw);
  game.ship.powerIntent[sys] = nv;
  enforceShields(game);
  return null;
}
// PAN-01 A: technik.module { id, on, raum? } – Bordmodul ab-/anschalten (frei werdende Energie kann die Technik auf Hauptsysteme legen)
function technikModul(game, id, on, raum) {
  const err = Modul.schalten(game, String(id), !!on, raum == null ? null : Number(raum), powerDemand(game), reactorOutput(game));
  if (err) return err;
  enforcePower(game); Modul.update(game);
  if (game.ship.reactor) game.ship.reactor.used = powerUsed(game);
  return null;
}
function technikShield(game, sector, delta) {
  const C = game.C; const sh = game.ship.shields;
  if (!(sector >= 0 && sector <= 3)) return 'Unbekannter Sektor.';
  const d = delta > 0 ? 1 : -1;
  const nv = sh.alloc[sector] + d;
  if (nv < 0 || nv > C.shields.maxPerSector) return 'Grenze erreicht.';
  const cp = shieldCaps(game)[sector];
  if (d > 0 && nv > cp) return cp === 0 ? `Emitter ${SECTOR_LABEL[sector]} zerstört – der Sektor hält keine Schilde.` : `Emitter ${SECTOR_LABEL[sector]} beschädigt – höchstens ${cp}.`;
  if (d > 0 && sh.alloc.reduce((a, b) => a + b, 0) + 1 > shieldPool(game)) return 'Schildpool erschöpft – erst woanders abziehen oder mehr Energie auf Schilde.';
  sh.alloc[sector] = nv;
  sh.allocIntent = sh.alloc.slice();
  return null;
}

module.exports = {
  enterScene, update, shipHit, spawnEnemy, volkFuer, damageEnemy, enemyDown, dodge, doJump, selectDest, weaponsFire, weaponsReload, weaponsTarget,
  weaponsScan, weaponsWidescan, setMarker, markerOnTarget, resolveTarget, technikOverload, reactorOnline,
  technikPower, technikModul, powerUsed, powerDemand, technikShield, waffenAutomatikAktiv, shieldPool, reactorOutput, maxSpeed, verlustAusloesen, spawnSalvage, mountIds, inMountArc, jammersPresent,
  stationPoint, isDown, PHASES,
  // M3a §9.4 (SERVER-COMBAT) – Aufrufer: game.js (Befehle, Snapshot)
  weaponsAlloc, weaponsHold, weaponsCharge, lanceTrace, lanceDamage, captainBurst, chargePoints, shieldCaps, turnCaps, mountsSnapshot, shieldsSnapshot, enemyTeleSnap,
  consumeFullCharge, debugTele, debugBurst, normMount, ensureM3, M3_MOUNTS, MOUNT_SYSTEM, EMITTERS, chargeFactor,
  // §21.1 Allstopp
  helmStop, helmInput, fullStopBrake,
  // M3b §2/§3 (SERVER-FLIGHT): Temporegler, Snapshot-Ergänzungen
  helmThrottle, helmSnapshot, enemySnapExtra, engineSpeedFactor, lercheClass,
  leadAngle,   // QA M3b: Vorhalt der Jäger-Schüsse (spaceM3b.pilotFire)
  hasEnemy, stoereGegner, meldeWaffenAutomatik, selectedEnemy, bestueckung, estreuExplosion, etorpedoTreffer, torpedoPlatzOk,   // PAN-01 C (schiffswaffen.js, Tests)
  crewScale, holdingFire, enemyCanHit, waffenPlaetze,   // S2 §5 (escort.js)
  updateEnemies, hatPlaetze, plaetzeImBogen,   // EK1b (Tests)
  // W2 AP3b: Nebel und Brocken (gleiche Regeln für Lerche und Gegner)
  nebelFaktor, sensorReichweite, erfassung, waffenReichweite, brocken, brockenStoss, brockenImWeg, brockenStats, makeDriftAsteroids,
};
