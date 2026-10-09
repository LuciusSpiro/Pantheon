'use strict';
// Kampfsystem v2 für Außenmissionen (CONTRACT-M2 §4/§6/§7). Gilt auf jeder Außenkarte mit Laufzeitfeld aw.kampf === 'v2'
// (B1 §0.1/§6.1): Kesh, alle gebauten Karten (Landepunkte) und Plattform/Wrack nach dem Tutorial. Während des Tutorials
// laufen Plattform B-7 und Wrack unverändert über server/sim/away.js (aw.kampf 'alt', HP, alter Kampf).
// Kartenneutral: Karte, Sicht, Deckungsplätze und Decks kommen aus interior.awayInfo (Handkarte oder `Karte`).
// Waffen-Schnittstelle (CONTRACT-B2 §3.3): hitPlayer/hitEnemy sind Hüllen um waffen.treffer, shoot/fireEnemy rufen
// waffen.feuern – nur wenn waffen.aktiv; sonst das bisherige Verhalten (siehe Abschnitt „Waffen-Schnittstelle“).
// Inhalt: Personenschild in Segmenten, verwundet/Pistole/Bleedout/Wiederbeleben/Medipack, Notrückholung aller,
// Projektile mit Wänden + halber Deckung, Gegner-Schilde, Wächter-Frontbogen, Fog of War (vis/ghost), Scan-Qualität,
// Captain-Befehle, Kesh-Interaktionen (Störrelais, Archivschlüssel, Tafel), Debug `tune`.
// Gegner-KI: server/sim/squad.js. Alle Balancing-Werte: CONFIG.awayCombat.
const Physics = require('../../shared/physics.js');
const Los = require('../../shared/los.js');
const Protocol = require('../../shared/protocol.js');
const W = require('../world.js');
const squad = require('./squad.js');
const { dist, makeRng, r1, r2, clamp } = require('../util.js');

const TILE = Physics.TILE;
const isDown = (st) => st === 'broken' || st === 'offline';
let interiorMod = null;
const interior = () => interiorMod || (interiorMod = require('./interior.js'));

function cfg(game) { return game.C.awayCombat; }
function infoOf(aw) { return aw && W.AWAY_MAPS[aw.map] ? interior().awayInfoOf(aw.map) : null; }
// B1 §0.1: Laufzeitfeld aw.kampf ('alt'|'v2') entscheidet; ohne Feld die Karte (Kesh combat 'v2', gebaute Karten v2)
function isV2Away(aw) {
  if (!aw) return false;
  if (aw.kampf) return aw.kampf === 'v2';
  const i = infoOf(aw);
  return !!(i && (i.combat === 'v2' || i.karte));
}
function isV2(game) { return isV2Away(game.away); }
function playerOnV2(game, p) { return p.zone === 'away' && isV2(game); }
function teamOf(game) { return game.players.filter((p) => p.zone === 'away' && p.connected); }

// Kontext für Sicht/Deckung auf der aktuellen Außenkarte (Tor zu/offen usw. über awaySolid)
// B1: gebaute Karten sperren die Sicht nach `sperrtSicht`/Zustand (`_` zwischen den Decks), Schüsse zusätzlich am Fenster;
// links = Deck-Übergänge für bfs (KI), coverSpots = Deckungsplätze der Karte.
function env(game) {
  const it = interior();
  const info = it.awayInfo(game);
  const map = info.map;
  const solid = it.awaySolid(game);
  const blocked = it.awaySight(game, solid) || Los.sightFn(map, solid);
  return { map, solid, blocked, shotBlocked: it.awayShotBlock(game, blocked), links: info.links || null,
    coverSpots: it.coverSpotsOf(info), info, C: cfg(game) };
}
function coverSpots(game) { return interior().coverSpotsOf(interior().awayInfo(game)); }

// ---------- Ducken (CONTRACT-M2 §15) ----------
function crouchCfg(game) { return cfg(game).crouch || { speedFactor: 0.5, dodge: 0.2, enemyCrouch: true }; }
// Sichtlinie zwischen zwei Figuren (Spieler/Gegner, Feld `crouch`): low-Kacheln um geduckte Endpunkte sperren beidseitig
function losBetween(E, a, b) {
  const pts = [];
  if (a && a.crouch) pts.push(a);
  if (b && b.crouch) pts.push(b);
  const blocked = pts.length ? Los.crouchSight(E.map, E.solid, E.blocked, pts) : E.blocked;
  return Los.lineOfSight(blocked, a.x, a.y, b.x, b.y);
}
function canCrouch(game, p) {
  return !!(p && p.zone === 'away' && isV2(game) && !p.downed && !p.console && !p.beamLock);
}
// cmd { c: 'crouch', on } – nur Außenzone auf v2-Karten, nicht verwundet, nicht an einer Konsole
function setCrouch(game, p, on) {
  if (!on) { p.crouch = false; return null; }
  if (!(p.zone === 'away' && isV2(game))) { p.crouch = false; return 'Ducken geht nur im Außeneinsatz (Kesh).'; }
  if (!canCrouch(game, p)) { p.crouch = false; return null; }
  p.crouch = true;
  return null;
}
// Jeden Tick (interior.updatePlayers): Konsole, Verwundung, Beamen, andere Zone beenden das Ducken
function checkCrouch(game, p) {
  if (p.crouch && !canCrouch(game, p)) p.crouch = false;
}
function speedFactor(game, p) {
  return p.crouch ? clamp(Number(crouchCfg(game).speedFactor) || 0, 0, 1) : 1;
}

// ---------- Aufbau ----------
function makeKesh(game, base) {
  const info = W.AWAY_MAPS.kesh;
  const aw = Object.assign(base, {
    combat: 'v2', kampf: 'v2', vault: { open: false },
    jammers: info.jammers.map((t) => ({ x: t.x, y: t.y, off: false })),
    keys: info.keys.map((t) => ({ x: t.x, y: t.y, t: 0, doneAt: null })),
    tablet: { x: info.tablet.x, y: info.tablet.y, taken: false },
    orders: [], squads: {}, spawned: {}, recallT: 0, recallLockUntil: 0, keyHintAt: -99, aiT: 0,
    rng: makeRng((game.seed ^ 0x5C0B1) >>> 0),
    stats: { wounds: 0, revives: 0, squadRecalls: 0, bleedRecalls: 0, playerHits: 0, offBoxHits: 0, offBoxShots: 0, maxStuck: 0,
      enemyShots: 0, coverBlocks: 0, barks: 0, deflects: 0, aimNoLos: 0, kuppelBlocks: 0 },
  });
  const L = info.spawns.warden[0];
  aw.drones.push(squad.makeEnemy(game, aw, 'warden', 'L1', W.tileCenter(L.x, L.y), 'warden'));
  return aw;
}

// B1 §6.1: Laufzeitfelder für Kampf v2 auf jeder Karte (gebaute Karten, Plattform/Wrack nach dem Tutorial).
// Idempotent; vorhandene Felder bleiben (Kesh: no-op, kein RNG-Verbrauch). salt unterscheidet die Karten-RNG.
function ensureV2(game, aw, salt) {
  if (!aw) return aw;
  if (!aw.kampf) aw.kampf = 'v2';
  if (!aw.drones) aw.drones = [];
  if (!aw.projectiles) aw.projectiles = [];
  if (!aw.items) aw.items = [];
  if (!aw.strikes) aw.strikes = [];
  if (!aw.pendingStrikes) aw.pendingStrikes = [];
  if (!aw.orders) aw.orders = [];
  if (!aw.squads) aw.squads = {};
  if (!aw.spawned) aw.spawned = {};
  if (aw.recallT == null) aw.recallT = 0;
  if (aw.recallLockUntil == null) aw.recallLockUntil = 0;
  if (aw.keyHintAt == null) aw.keyHintAt = -99;
  if (aw.aiT == null) aw.aiT = 0;
  if (aw.kuppelHp == null) aw.kuppelHp = 0;
  if (aw.kuppelUntil == null) aw.kuppelUntil = 0;
  if (aw.sensorUntil == null) aw.sensorUntil = 0;
  if (!aw.rng) {
    let h = 0x811c9dc5;
    const id = String(salt != null ? salt : aw.map || '');
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    aw.rng = makeRng(((game.seed ^ 0x5C0B1) ^ h) >>> 0);
  }
  if (!aw.stats) aw.stats = { wounds: 0, revives: 0, squadRecalls: 0, bleedRecalls: 0, playerHits: 0, offBoxHits: 0, offBoxShots: 0, maxStuck: 0,
    enemyShots: 0, coverBlocks: 0, barks: 0, deflects: 0, aimNoLos: 0, kuppelBlocks: 0 };
  return aw;
}
// Plattform/Wrack nach dem Tutorial auf Kampf v2 umrüsten (B1 §0.1): alte Drohnen/Plünderer werden v2-Gegner am
// selben Platz (Trupp 'posten', ruhig, ohne Funk bei Drohnen). Tote bleiben tot.
function ruesteV2(game, aw) {
  if (!aw || aw.kampf === 'v2') return aw;
  ensureV2(game, aw);
  aw.kampf = 'v2';
  aw.projectiles = [];
  aw.drones = aw.drones.map((d) => {
    const kind = d.kind === 'scavenger' ? 'scavenger' : d.kind;
    const e = squad.makeEnemy(game, aw, kind, d.id, { x: d.home ? d.home.x : d.x, y: d.home ? d.home.y : d.y }, 'posten');
    e.x = d.x; e.y = d.y;
    if (d.alive === false) { e.alive = false; e.seg = 0; e.hp = 0; }
    if (d.guard) e.guard = true;
    return e;
  });
  if (!aw.squads.posten) aw.squads.posten = squad.newSquad('posten', aw.drones.filter((e) => e.alive).length || 1);
  if (aw.drones.every((e) => e.kind !== 'scavenger')) aw.squads.posten.noBark = true;
  return aw;
}

// ---------- Waffen-Schnittstelle (CONTRACT-B2 §3, Einbaupunkte §3.3) ----------
// waffen.js (WAFFEN) und anker.js (BUEHNE) entstehen parallel: beide werden defensiv geladen. Solange waffen.aktiv nicht
// true ist (Stub), läuft jeder Einbaupunkt im bisherigen Verhalten. Einbaupunkte:
//   shoot (Spieler, nicht verwundet) -> waffen.feuern(game, p, { angle })
//   fireEnemy (Gegner mit e.waffe)  -> waffen.feuern(game, e, { x, y, ziel })
//   hitPlayer / hitEnemy            -> waffen.treffer(game, ziel, wirkung, quelle); Ereignisse und Folgen (woundPlayer,
//                                      knockOut, Funk, anker.onTreffer) bleiben hier
//   update                          -> waffen.update(game, k, dt) je Kämpfer (Hitze, Laden, Ausholen, Betäubung, Aufwachen)
//   updateWounded                   -> bewusstlos/gefesselt/gefangen bluten nicht aus
// Werkzeuge für waffen.js: spawnProjectile, flaeche, strahl, kaempfer, env.
const MODS = {};
const MOD_FILES = { waffen: './waffen.js', anker: './anker.js' };
function mod(name) {
  if (!(name in MODS)) {
    try { MODS[name] = require(MOD_FILES[name]); } catch (e) {
      if (!(e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(MOD_FILES[name].slice(2)))) console.error('[combat] ' + MOD_FILES[name] + ':', e && e.message);
      MODS[name] = null;
    }
  }
  return MODS[name];
}
// Tests: Modul ersetzen (null = fehlt, undefined = wieder normal laden)
function _setzeModul(name, m) { if (m === undefined) delete MODS[name]; else MODS[name] = m; }
function waffen() { const m = mod('waffen'); return m && m.aktiv === true && typeof m.treffer === 'function' ? m : null; }
function waffenAktiv() { return !!waffen(); }
// B1 §6.2: jeder Treffer, der einen Spieler erreicht -> anker.onTreffer(game, pid) (Abbruch von Download und Ladung)
function ankerTreffer(game, p) {
  const m = mod('anker');
  if (!m || typeof m.onTreffer !== 'function') return;
  try { m.onTreffer(game, p.id); } catch (e) { if (game.countError) game.countError('anker-onTreffer', e); }
}

// Kämpfer-Vertrag (B2 §3.1): Felder für Spieler und Gegner anlegen (idempotent). Gegner: schild = Alias auf seg/max/
// lastHitAt/regenT, Spieler: schild = p.shield (beide nicht aufzählbar, also nicht im Snapshot/Speicher).
// Rolle eines Gegners für die B2-Regeln: e.rolle, sonst Altname (Plünderer = grundtyp, Wächter = waechter, E-Entscheidung)
function rolleVon(e) {
  if (!e) return null;
  if (e.rolle) return e.rolle;
  if (e.kind === 'warden') return 'waechter';
  if (e.kind === 'scavenger' || e.kind === 'drone') return 'grundtyp';
  return null;
}
function kaempfer(game, k) {
  if (!k || k.kfOk) return k;
  const isP = !!(k.input && game.players && game.players.includes(k));
  const C = cfg(game);
  const Wf = waffen();
  if (!isP && Wf && !k.rolle) { const r = rolleVon(k); if (r && C.gegner && C.gegner[r]) k.rolle = r; }
  const g = !isP && k.rolle && C.gegner && C.gegner[k.rolle] ? C.gegner[k.rolle] : null;
  Object.defineProperty(k, 'kfOk', { value: true, enumerable: false, writable: true, configurable: true });
  schildAlias(k, isP);
  // Echtes waffen.js: Felder nach Rolle (Schild, Wunden, Waffe, Frontbogen) bzw. Spieler mit gespeicherter Waffenwahl
  if (Wf && typeof Wf.ausstatten === 'function' && (isP || g)) {
    const wahl = isP && typeof Wf.waffeFuer === 'function' ? Wf.waffeFuer(game, k) : null;
    const war = isP ? k.waffe : null;
    try { Wf.ausstatten(game, k, isP ? 'spieler' : k.rolle); } catch (e) { if (game.countError) game.countError('waffen-ausstatten', e); }
    if (isP) k.waffe = war || wahl || 'blaster';
    if (!isP && k.asleep) k.hp = k.seg;
    // Entscheidung Studioleitung (B2-Balancing): Plünderer (Kesh, Wrack, grundtyp der Rostmeute) tragen den
    // Schrottblaster (Blaster-Regeln, langsamere Geschosse); Karl (grundtyp der Germanen) bleibt beim Blaster.
    if (!isP && k.rolle === 'grundtyp' && C.waffen && C.waffen.schrottblaster &&
        (k.fraktion === 'rostmeute' || (!k.fraktion && k.kind === 'scavenger'))) k.waffe = 'schrottblaster';
  }
  if (k.team == null) k.team = isP ? 'crew' : 'feind';
  if (k.waffe === undefined) k.waffe = isP ? 'blaster' : (g ? g.waffe : null);
  if (k.hitze == null) k.hitze = 0;
  if (k.gesperrtBis == null) k.gesperrtBis = 0;
  if (k.ladung === undefined) k.ladung = null;
  if (k.ausholen === undefined) k.ausholen = null;
  if (!k.wunden) { const n = g && g.wunden ? g.wunden : 1; k.wunden = { n, max: n }; }
  if (!k.zustand) k.zustand = k.downed ? 'verwundet' : (k.alive === false ? 'aus' : 'ok');
  if (k.betaeubtBis == null) k.betaeubtBis = 0;
  if (k.bewusstBis == null) k.bewusstBis = 0;
  if (!isP && k.frontArc == null && k.kind === 'warden') k.frontArc = C.enemy.warden.frontArc;
  if (k.hitRadius == null) k.hitRadius = (C.hitRadius && C.hitRadius[isP ? 'player' : k.kind]) || (isP ? 12 : 13);
  return k;
}
function schildAlias(k, isP) {
  if (!Object.getOwnPropertyDescriptor(k, 'schild')) {
    const alias = isP ? null : {};
    if (alias) {
      Object.defineProperty(alias, 'seg', { enumerable: true, get() { return k.seg; }, set(v) { k.seg = v; k.hp = v; } });
      Object.defineProperty(alias, 'max', { enumerable: true, get() { return k.max; }, set(v) { k.max = v; } });
      Object.defineProperty(alias, 'lastHitAt', { enumerable: true, get() { return k.lastHitAt; }, set(v) { k.lastHitAt = v; } });
      Object.defineProperty(alias, 'regenT', { enumerable: true, get() { return k.regenT; }, set(v) { k.regenT = v; } });
    }
    // Setzen (waffen.ausstatten) schreibt in p.shield bzw. e.seg/e.max zurück
    Object.defineProperty(k, 'schild', { enumerable: false, configurable: true, get() { return isP ? k.shield : alias; },
      set(v) {
        if (!v) return;
        if (isP) { k.shield = v; return; }
        if (v.max != null) k.max = v.max;
        if (v.seg != null) { k.seg = v.seg; k.hp = v.seg; }
        if (v.lastHitAt != null) k.lastHitAt = v.lastHitAt;
        if (v.regenT != null) k.regenT = v.regenT;
      } });
  }
}
// Welt-Adapter für waffen.js (game.waffenWelt): Kämpfer der aktuellen Außenkarte, Wand = Schuss-Sperre (Fenster stoppt)
function waffenWelt(game) {
  if (!game.waffenWelt || !game.waffenWelt.bodenkampf) {
    game.waffenWelt = {
      bodenkampf: true,
      kaempfer() {
        const out = [];
        for (const p of game.players) if (p.zone === 'away' && !p.lift && !p.downed) out.push(kaempfer(game, p));
        for (const e of game.away.drones) if (e.alive && !e.asleep) out.push(kaempfer(game, e));
        return out;
      },
      wand(x0, y0, x1, y1) { const E = env(game); return !Los.lineOfSight(E.shotBlocked, x0, y0, x1, y1); },
      // B2-NACH: Treffer, die waffen.js selbst verteilt (Granate, Lanze, Schlag) -> dieselben Ereignisse wie Projektiltreffer
      getroffen(k, r, w, q) { trefferGemeldet(game, k, r, w || {}, q || {}); },
    };
  }
  return game.waffenWelt;
}
// Rückmeldung für Treffer, die waffen.js direkt verteilt (Explosion, Schlag, Strahl): Ereignisse (mit waffe), Funk-Reaktion
// und Zähler wie in hitPlayerWaffen/hitEnemyWaffen. Liegen/Verwunden zieht folgenAbgleich nach (gleicher Tick).
function trefferGemeldet(game, k, r, w, q) {
  if (r === 'ignoriert') return;
  const aw = game.away; const x = Math.round(k.x), y = Math.round(k.y); const waffe = w.waffe || null;
  if (game.players.includes(k)) {
    if (r === 'kuppel') { if (aw.stats) aw.stats.kuppelBlocks++; game.emit('sfx', { name: 'shield_hit', zone: 'away', x, y }); return; }
    if (r === 'abgelenkt') return;
    if (aw.stats && q.team === 'feind') {
      aw.stats.playerHits++;
      if (!w.flaeche && Number.isFinite(q.x)) offBoxZaehlen(game, k, q.x, q.y, sichtHilfe(game, aw.drones.find((d) => d.id === q.id), k));   // Lanze, Schlag
    }
    ankerTreffer(game, k);
    if (r === 'schild' && k.shield) {
      game.emit('shieldHit', { pid: k.id, seg: k.shield.seg, x, y, waffe });
      game.emit('sfx', { name: 'shield_hit', zone: 'away', x, y, seg: k.shield.seg, max: k.shield.max });
      if (k.shield.seg <= 0) { game.emit('shieldBreak', { pid: k.id, x, y }); game.emit('sfx', { name: 'shield_break', zone: 'away', x, y }); }
    }
    return;
  }
  squad.onEnemyHit(game, k, { x: q.x, y: q.y, pid: q.team === 'crew' ? q.id || null : null });
  if (r === 'abgelenkt') {
    if (aw.stats) aw.stats.deflects++;
    game.emit('wardenDeflect', { id: k.id, x, y });
    game.emit('sfx', { name: 'warden_deflect', zone: 'away', x, y });
    return;
  }
  k.hitT = game.time; k.hp = k.seg;
  if (r === 'schild') game.emit('enemyShieldHit', { id: k.id, seg: k.seg, x, y, waffe });
}
// Treffer, die waffen.js direkt verteilt (Explosion, Schlag, Strahl), haben keine Hülle durchlaufen: Folgen nachziehen
// (gefallener Spieler -> verwundet wie heute, gefallener Gegner -> knockOut; Welle 2: Gegner bleibt liegen).
// B2 Welle 2: Spieler bewusstlos/gefesselt -> liegen ohne Pistole und ohne Ausbluten; wach bzw. befreit -> stehen auf.
// Gegner verwundet/bewusstlos/gefesselt/aus -> liegen (alive false, Körper bleibt); aufgerichtet bzw. aufgewacht -> stehen auf.
const LIEGT = { verwundet: 1, bewusstlos: 1, gefesselt: 1, aus: 1 };
function folgenAbgleich(game) {
  for (const p of game.players) {
    if (p.zone !== 'away' || !p.zustand) continue;
    if (!p.downed && p.zustand === 'verwundet') { ankerTreffer(game, p); woundPlayer(game, p, 'waffe'); }
    else if (!p.downed && (p.zustand === 'bewusstlos' || p.zustand === 'gefesselt')) { ankerTreffer(game, p); bewusstlosPlayer(game, p); }
    else if (p.downed && p.zustand === 'ok' && p.bewusstlos) aufwachenPlayer(game, p);
  }
  for (const e of game.away.drones) {
    if (!e.zustand) continue;
    if (e.alive && LIEGT[e.zustand]) faellt(game, e);
    else if (!e.alive && e.liegt && e.zustand === 'ok') stehtAuf(game, e);
  }
}
// Spieler bewusstlos (Betäuber) bzw. gefesselt: liegt, keine Pistole, kein Ausbluten, niemand kann aufhelfen (B2 §2)
function bewusstlosPlayer(game, p) {
  const it = interior();
  if (p.console) it.leaveConsole(game, p);
  if (p.carry) it.dropCarry(game, p);
  p.downed = true; p.downedFor = 0; p.wound = true; p.bewusstlos = true; p.bleed = null; p.crouch = false;
  p.console = null; p.hold = null; p.input.mx = 0; p.input.my = 0;
  if (p.zustand === 'bewusstlos') game.oda(`${p.name} ist bewusstlos! Kameraden: Gegner fernhalten – in ${Math.round(cfg(game).koerper.bewusstlos)} s kommt ${p.name} wieder zu sich.`, null);
  squad.onPlayerWounded(game, p);
  game.missionEvent('playerWounded', { pid: p.id, zustand: p.zustand });
}
function aufwachenPlayer(game, p) {
  const seg = p.shield ? p.shield.seg : 1;
  p.bewusstlos = false;
  revive(game, p, Math.max(1, seg));
}
// Gegner fällt: liegt (alive false), Ereignisse wie knockOut; bleibt als Körper (aufrichten, fesseln, Ausbluten)
function faellt(game, e) {
  const zs = e.zustand;
  knockOut(game, e);
  e.zustand = zs; e.liegt = true;
}
function stehtAuf(game, e) {
  e.alive = true; e.liegt = false; e.hp = e.seg; e.path = null; e.goal = null; e.aim = null; e.role = 'pin';
  e.stuckRef = { x: e.x, y: e.y }; e.stuckT = 0;
  game.missionEvent('enemyUp', { id: e.id, kind: e.kind, rolle: e.rolle || null });
}
// wirkung = { schaden (Segmente, auch 0.5), art: 'direkt'|'flaeche'|'strahl'|'schlag'|'orbital', waffe?, kind? (Projektil),
//             x?, y? (Ursprung), quelle? }; ohne Angabe: alter Treffer mit segs Segmenten.
function wirkungVon(segs, kind, w) {
  const o = { schaden: segs == null ? 1 : segs, art: 'direkt', kind: typeof kind === 'string' ? kind : null };
  if (kind && typeof kind === 'object') {   // Quelle als Objekt (anker.js: { kind, x, y, flaeche })
    o.kind = kind.kind || null;
    if (Number.isFinite(kind.x)) { o.x = kind.x; o.y = kind.y; }
    if (kind.flaeche) { o.flaeche = true; o.art = 'flaeche'; }
  }
  return Object.assign(o, w || {});
}
// Wirkung eines Projektils: waffen.js setzt q.wirkung/q.seite (dann unverändert durchreichen), Altprojektile: Segmente = q.dmg
function wirkungAus(q) {
  if (q.wirkung) return Object.assign({ kind: q.kind, x: q.sx, y: q.sy }, q.wirkung, { quelle: { id: q.owner || null, team: q.seite || null, x: q.sx, y: q.sy } });
  return { schaden: q.dmg || 1, art: q.kind === 'granate' ? 'flaeche' : 'direkt', waffe: q.waffe || null, kind: q.kind, x: q.sx, y: q.sy,
    quelle: { id: q.owner || null, pid: q.team === 'player' || q.team === 'crew' ? q.owner || null : null, team: q.team === 'player' ? 'crew' : q.team === 'enemy' ? 'feind' : q.team || null, x: q.sx, y: q.sy } };
}
// Flächenwirkung (Granate, Ladung): trifft ALLE im Radius r (px) mit Sichtlinie vom Zentrum (B2 §2 Friendly Fire).
// -> [[kaempfer, ergebnis], …]. Auch ohne Waffen nutzbar (dann Segmente wie ein Schuss).
function flaeche(game, x, y, r, wirkung, quelle) {
  const aw = game.away; const E = env(game);
  const wk = Object.assign({ schaden: 1, art: 'flaeche' }, wirkung || {}, { x, y });
  if (quelle && !wk.quelle) wk.quelle = quelle;
  const reach = (o) => dist(o.x, o.y, x, y) <= r && Los.lineOfSight(E.blocked, x, y, o.x, o.y);
  const out = [];
  for (const p of game.players) if (p.zone === 'away' && !p.downed && reach(p)) out.push([p, hitPlayer(game, p, wk.schaden, wk.kind || 'flaeche', wk)]);
  for (const e of aw.drones) if (e.alive && reach(e)) out.push([e, hitEnemy(game, e, wk.schaden, { x, y, pid: quelle && quelle.pid, flaeche: true, wirkung: wk })]);
  return out;
}
// Strahl (Lanze): sofortiger Treffer auf den ersten Gegner von k auf der Linie bis zur Reichweite (px), gestoppt von
// Wänden/Fenstern (Schuss-Sperre). -> { ziel, ergebnis, x, y } (x/y = Endpunkt) bzw. ziel null.
function strahl(game, k, angle, reichweite, wirkung) {
  const aw = game.away; const E = env(game); const C = cfg(game);
  const x0 = k.x, y0 = k.y;
  let x1 = x0 + Math.cos(angle) * reichweite, y1 = y0 + Math.sin(angle) * reichweite;
  Los.walk(x0, y0, x1, y1, (tx, ty) => {
    if (!E.shotBlocked(tx, ty)) return false;
    const t = Math.max(0, (((tx + 0.5) * TILE - x0) * Math.cos(angle) + ((ty + 0.5) * TILE - y0) * Math.sin(angle)) - TILE / 2);
    x1 = x0 + Math.cos(angle) * t; y1 = y0 + Math.sin(angle) * t;
    return true;
  });
  const crew = k.team === 'crew' || game.players.includes(k);
  const wk = Object.assign({ schaden: 1, art: 'strahl' }, wirkung || {}, { x: x0, y: y0 });
  let best = null, bt = Infinity;
  const cand = crew ? aw.drones.filter((e) => e.alive) : game.players.filter((p) => p.zone === 'away' && !p.downed);
  for (const o of cand) {
    const r = crew ? ((C.hitRadius && C.hitRadius[o.kind]) || 13) : ((C.hitRadius && C.hitRadius.player) || 12);
    if (segDist(o.x, o.y, x0, y0, x1, y1) >= r) continue;
    const t = (o.x - x0) * Math.cos(angle) + (o.y - y0) * Math.sin(angle);
    if (t >= 0 && t < bt) { bt = t; best = o; }
  }
  if (!best) return { ziel: null, ergebnis: null, x: x1, y: y1 };
  const ergebnis = crew ? hitEnemy(game, best, wk.schaden, { x: x0, y: y0, pid: k.id, wirkung: wk })
    : hitPlayer(game, best, wk.schaden, wk.kind || 'strahl', Object.assign({ quelle: { id: k.id, team: 'feind', x: x0, y: y0 } }, wk));
  return { ziel: best, ergebnis, x: best.x, y: best.y };
}

// ---------- Spieler: Schild ----------
function initShield(game, p) {
  const n = cfg(game).shield.segments;
  p.shield = { seg: n, max: n, lastHitAt: -99, regenT: 0 };
}
function fullShield(game, p) { initShield(game, p); }

// Spieler betritt eine v2-Karte (Herunterbeamen): voller Schild, ein Medipack aus dem Lager (falls vorhanden)
function onArrive(game, p) {
  fullShield(game, p);
  p.wound = false; p.bleed = null; p.cv = 0; p.fl = false; p.crouch = false;
  p.medkit = 0;
  if ((game.inventory.medipack || 0) > 0) { game.inventory.medipack--; p.medkit = 1; }
  if (waffen()) { kaempfer(game, p); p.zustand = 'ok'; p.hitze = 0; p.gesperrtBis = 0; p.ladung = null; p.ausholen = null; p.wunden.n = p.wunden.max; }
}
// Spieler verlässt die v2-Karte (Beamen, Rückholung, Verbindungsabbruch): Medipack zurück ins Lager, Wunde heilt
function onLeave(game, p) {
  if (p.medkit) { game.inventory.medipack = (game.inventory.medipack || 0) + p.medkit; p.medkit = 0; }
  if (p.wound || p.downed) { p.downed = false; p.downedFor = 0; p.hp = game.C.player.hp; }
  p.wound = false; p.bleed = null; p.cv = 0; p.fl = false; p.crouch = false;
  if (p.shield) fullShield(game, p);
  p.bewusstlos = false;
  if (p.gefangen) { p.gefangen = null; if (p.waffeVorher) p.waffe = p.waffeVorher; p.waffeVorher = null; }
  if (p.zustand) { p.zustand = 'ok'; p.betaeubtBis = 0; p.hitze = 0; p.gesperrtBis = 0; p.ladung = null; p.ausholen = null; if (p.wunden) p.wunden.n = p.wunden.max; }
}

// Treffer auf einen Spieler (CONTRACT-M2 §4.1). segs = Segmente je Treffer (Wächter: shotSegments).
// B2 §3.3: Hülle um waffen.treffer (wenn aktiv). wirkung (optional) siehe wirkungVon. Jeder Treffer, der den Spieler
// erreicht (Schild oder Wunde), ruft anker.onTreffer(game, pid) (B1 §6.2: Abbruch von Download und Ladung).
// Rückgabe wie bisher: 'ignored'|'god'|'kuppel'|'shield'|'wounded' (+ mit Waffen: 'deflect'|'bewusstlos').
function hitPlayer(game, p, segs, source, wirkung) {
  const C = cfg(game); const aw = game.away;
  if (p.downed || p.zone !== 'away') return 'ignored';
  if (game.god) return 'god';
  const Wf = waffen();
  if (Wf) return hitPlayerWaffen(game, p, Wf, wirkungVon(segs, source, wirkung));
  if (aw.kuppelHp > 0 && game.time < aw.kuppelUntil) {
    aw.kuppelHp = Math.max(0, aw.kuppelHp - C.kuppelPerHit);
    if (aw.stats) aw.stats.kuppelBlocks++;
    game.emit('sfx', { name: 'shield_hit', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
    return 'kuppel';
  }
  if (!p.shield) initShield(game, p);
  const sh = p.shield;
  sh.lastHitAt = game.time; sh.regenT = 0;
  if (sh.seg > 0) {
    sh.seg = Math.max(0, sh.seg - Math.max(1, segs || 1));
    game.emit('shieldHit', { pid: p.id, seg: sh.seg, x: Math.round(p.x), y: Math.round(p.y) });
    game.emit('sfx', { name: 'shield_hit', zone: 'away', x: Math.round(p.x), y: Math.round(p.y), seg: sh.seg, max: sh.max });
    if (sh.seg === 0) {
      game.emit('shieldBreak', { pid: p.id, x: Math.round(p.x), y: Math.round(p.y) });
      game.emit('sfx', { name: 'shield_break', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
    }
    ankerTreffer(game, p);
    return 'shield';
  }
  ankerTreffer(game, p);
  woundPlayer(game, p, source);
  return 'wounded';
}
// Ereignisse wie im alten Weg; die Regeln (Schild, Wunden, Kuppel, Betäubung) entscheidet waffen.treffer.
function hitPlayerWaffen(game, p, Wf, wk) {
  const aw = game.away;
  kaempfer(game, p);
  const r = Wf.treffer(game, p, wk, wk.quelle || null);
  const x = Math.round(p.x), y = Math.round(p.y);
  if (r === 'kuppel') {
    if (aw.stats) aw.stats.kuppelBlocks++;
    game.emit('sfx', { name: 'shield_hit', zone: 'away', x, y });
    return 'kuppel';
  }
  if (r === 'schild' || r === 'wunde' || r === 'gefallen' || r === 'bewusstlos') ankerTreffer(game, p);
  if (r === 'schild' && p.shield) {
    game.emit('shieldHit', { pid: p.id, seg: p.shield.seg, x, y, waffe: wk.waffe || null });
    game.emit('sfx', { name: 'shield_hit', zone: 'away', x, y, seg: p.shield.seg, max: p.shield.max });
    if (p.shield.seg <= 0) { game.emit('shieldBreak', { pid: p.id, x, y }); game.emit('sfx', { name: 'shield_break', zone: 'away', x, y }); }
    return 'shield';
  }
  if (r === 'gefallen') { if (!p.downed) woundPlayer(game, p, wk.kind || null); return 'wounded'; }
  if (r === 'wunde') return 'shield';            // Wunde genommen, steht noch (Spieler haben in B2 eine Wunde -> selten)
  if (r === 'bewusstlos') { if (!p.downed) bewusstlosPlayer(game, p); return 'bewusstlos'; }
  if (r === 'abgelenkt') return 'deflect';
  return 'ignored';
}

function woundPlayer(game, p, source) {
  const C = cfg(game); const it = interior();
  if (p.downed) return;
  if (p.console) it.leaveConsole(game, p);
  if (p.carry) it.dropCarry(game, p);
  p.downed = true; p.downedFor = 0; p.wound = true; p.hp = 0; p.crouch = false;
  p.bleed = C.wounded.bleedout;
  p.console = null; p.hold = null; p.input.mx = 0; p.input.my = 0;
  if (!p.shield) initShield(game, p);
  p.shield.seg = 0; p.shield.regenT = 0;
  if (game.away.stats) game.away.stats.wounds++;
  game.emit('wounded', { pid: p.id, x: Math.round(p.x), y: Math.round(p.y), source: source || null });
  game.emit('sfx', { name: 'wounded', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
  game.oda(`${p.name} ist verwundet! Kameraden: E halten zum Aufhelfen. Liegend geht noch die Pistole.`, null);
  squad.onPlayerWounded(game, p);
  game.missionEvent('playerWounded', { pid: p.id });
}

function revive(game, p, segs, opts) {
  const o = opts || {};
  p.downed = false; p.downedFor = 0; p.wound = false; p.bleed = null; p.hold = null;
  p.hp = game.C.player.hp;
  if (!p.shield) initShield(game, p);
  p.shield.max = cfg(game).shield.segments;
  p.shield.seg = clamp(segs == null ? p.shield.max : segs, 0, p.shield.max);
  p.shield.lastHitAt = game.time; p.shield.regenT = 0;
  if (p.zustand) { p.zustand = 'ok'; if (p.wunden) p.wunden.n = p.wunden.max; }   // B2 Kämpfer-Vertrag (nur wenn angelegt)
  p.bewusstlos = false;
  if (o.quiet) return;
  if (game.away.stats) game.away.stats.revives++;
  game.emit('revived', { pid: p.id, x: Math.round(p.x), y: Math.round(p.y) });
  game.emit('sfx', { name: 'revive_done', zone: p.zone, x: Math.round(p.x), y: Math.round(p.y) });
}

// Verwundet: kein Aufstehen von selbst, nach bleedout s Einzel-Notrückholung (CONTRACT-M2 §4.2)
function updateWounded(game, p, dt) {
  p.moving = false;
  if (p.zone !== 'away' || !isV2(game)) { revive(game, p, null, { quiet: true }); return; }
  // B2: bewusstlos/gefesselt/gefangen bluten nicht aus (Aufwachen/Befreien regelt waffen.update)
  if (waffen() && p.zustand && p.zustand !== 'ok' && p.zustand !== 'verwundet') return;
  p.downedFor += dt;
  p.bleed = Math.max(0, (p.bleed == null ? cfg(game).wounded.bleedout : p.bleed) - dt);
  if (p.bleed > 0) return;
  const it = interior();
  if (isDown(game.ship.systems.transfer)) {
    revive(game, p, cfg(game).wounded.reviveSegments);
    game.oda(`Transfer ausgefallen – ${p.name}, ich flicke deinen Schild aus der Ferne. Steh auf!`, null);
    return;
  }
  const map = game.away.map;
  it.placeOnShipPad(game, p);
  revive(game, p, null, { quiet: true });
  if (game.away.stats) game.away.stats.bleedRecalls++;
  game.emit('beam', { pids: [p.id], dir: 'up', map });
  game.emit('sfx', { name: 'beam' });
  game.explore.addLog(`${ortName(game)}: Notrückholung für ${p.name} – zu lange verwundet. Schild wieder voll.`, logTag(game));
  game.oda(`Notrückholung für ${p.name}! Schild wieder voll – über die Pads geht's zurück nach unten.`, null);
  game.missionEvent('beamedUp', { players: [p], map });
}

// Logbuch-Ort: Kesh (Handkarte mit combat 'v2') wie bisher, sonst Name der Karte bzw. „Außeneinsatz“
function ortName(game) {
  const i = infoOf(game.away) || {};
  if (i.combat === 'v2') return 'Kesh';
  return i.name || (i.karte && i.karte.name) || 'Außeneinsatz';
}
function logTag(game) { const i = infoOf(game.away) || {}; return i.combat === 'v2' ? 'kesh' : 'boden'; }

// Liegen alle Außenteam-Spieler verwundet: nach squadRecallDelay s Notrückholung aller (CONTRACT-M2 §4.6)
function updateSquadRecall(game, dt) {
  const aw = game.away; const C = cfg(game);
  const team = teamOf(game);
  if (!team.length || !team.every((p) => p.downed)) { aw.recallT = 0; return; }
  aw.recallT += dt;
  if (waffen() && ausbruchMoeglich(game, team)) { ausbruch(game, team); return; }
  // B2: Bewusstlose wachen auf; solange ein Häscher sie fesseln kann, wartet die Rückholung (höchstens bewusstlos s)
  if (waffen() && team.some((p) => p.zustand === 'bewusstlos') && aw.drones.some((e) => e.alive && rolleVon(e) === 'haescher') &&
      aw.recallT < (Number(C.koerper.bewusstlos) || 30)) return;
  if (aw.recallT < C.wounded.squadRecallDelay) return;
  squadRecall(game);
}
function squadRecall(game) {
  const aw = game.away; const C = cfg(game); const it = interior();
  const list = game.players.filter((p) => p.zone === 'away');
  const map = aw.map;
  list.forEach((p, i) => { it.placeOnShipPad(game, p, i); p.beamLock = false; revive(game, p, null, { quiet: true }); });
  aw.recallT = 0;
  aw.recallLockUntil = game.time + C.wounded.recallBeamLock;
  if (aw.stats) aw.stats.squadRecalls++;
  const pids = list.map((p) => p.id);
  game.emit('squadRecall', { pids });
  game.emit('sfx', { name: 'squad_recall' });
  game.emit('beam', { pids, dir: 'up', map });
  game.explore.addLog(`${ortName(game)}: Notrückholung des ganzen Außenteams. Niemand verloren – nur Stolz.`, logTag(game));
  game.oda(`Notrückholung! Alle an Bord, Schilde voll. Der Transfer kühlt ${Math.round(C.wounded.recallBeamLock)} s ab.`, null);
  game.missionEvent('squadRecall', { pids });
  game.missionEvent('beamedUp', { players: list, map });
}

function updatePlayerShields(game, dt) {
  const C = cfg(game);
  for (const p of game.players) {
    if (p.zone !== 'away' || p.downed) continue;
    if (!p.shield) initShield(game, p);
    const sh = p.shield;
    sh.max = C.shield.segments;
    if (sh.seg > sh.max) sh.seg = sh.max;
    if (sh.seg >= sh.max) { sh.regenT = 0; continue; }
    if (game.time - sh.lastHitAt < C.shield.regenDelay) { sh.regenT = 0; continue; }
    sh.regenT += dt;
    if (sh.regenT < C.shield.regenStep) continue;
    sh.regenT = 0; sh.seg = Math.min(sh.max, Math.floor(sh.seg) + 1);   // B2: halbe Segmente runden beim Laden auf
    game.emit('shieldUp', { pid: p.id, seg: sh.seg });
    game.emit('sfx', { name: 'shield_up', zone: 'away', x: Math.round(p.x), y: Math.round(p.y), seg: sh.seg, max: sh.max });
    if (sh.seg >= sh.max) {
      game.emit('shieldFull', { pid: p.id });
      game.emit('sfx', { name: 'shield_full', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
    }
  }
}
function shieldProgress(game, p) {
  const sh = p.shield; const C = cfg(game);
  if (!sh || p.downed || sh.seg >= sh.max || game.time - sh.lastHitAt < C.shield.regenDelay) return 0;
  return Math.min(1, sh.regenT / Math.max(0.01, C.shield.regenStep));
}

// Medipacks (Nachschub vom Transfer) durch Darüberlaufen aufheben, höchstens 1 tragen (CONTRACT-M2 §4.2)
function updateMedkitPickup(game) {
  const aw = game.away;
  for (const p of game.players) {
    if (p.zone !== 'away' || p.downed || p.medkit) continue;
    const it = aw.items.find((i) => i.kind === 'medipack' && dist(i.x, i.y, p.x, p.y) <= 20);
    if (!it) continue;
    aw.items.splice(aw.items.indexOf(it), 1);
    p.medkit = 1;
    game.emit('sfx', { name: 'pickup', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
    game.notice(p, 'Medipack eingesteckt – damit belebst du schneller wieder (E halten).');
  }
}
function pickupMedkit(game, p, item) {
  if (p.medkit) { game.notice(p, 'Du trägst schon ein Medipack.'); return false; }
  const list = game.away.items; const i = list.indexOf(item);
  if (i < 0) return false;
  list.splice(i, 1); p.medkit = 1;
  game.emit('sfx', { name: 'pickup', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
  return true;
}

// ---------- Schießen und Projektile (CONTRACT-M2 §4.3) ----------
// v2-Projektile fliegen auf Fußhöhe (x/y = Füße wie Spieler/Gegner), damit Treffer, Sichtlinie und Deckung gleich rechnen.
function shoot(game, p, angle, opts) {
  const C = cfg(game);
  if (p.zone !== 'away' || p.console || p.beamLock) return;
  const Wf = waffen();
  // B2: shoot { los: true } = Loslassen -> Lanze feuert (zusätzlich bleibt der Weg über die Pause im shoot-Strom)
  if (opts && opts.los) {
    if (Wf && p.ladung && typeof Wf.loslassen === 'function') {
      if (Number.isFinite(angle)) Wf.feuern(game, p, { angle });
      p.losGemeldet = true;
      return Wf.loslassen(game, p);
    }
    return null;
  }
  if (!Number.isFinite(angle)) return;
  if (Wf && !p.downed) {   // B2 §3.3 (Pistole der Verwundeten bleibt)
    kaempfer(game, p);
    p.schussInputAt = game.time;
    const dist = opts && Number.isFinite(opts.dist) ? opts.dist : null;   // B2-NACH: Zielabstand (Kacheln) für die Wurfweite
    return Wf.feuern(game, p, dist != null ? { angle, dist } : { angle });
  }
  if (Wf && p.downed && p.zustand && p.zustand !== 'verwundet') return;   // bewusstlos/gefesselt: keine Pistole
  if (game.time < (p.shootReadyAt || 0)) return;
  const pistol = !!p.downed;
  p.shootReadyAt = game.time + (pistol ? C.wounded.pistolCooldown : C.blaster.cooldown);
  spawnProjectile(game, { kind: pistol ? 'pistol' : 'blaster', x: p.x, y: p.y, angle, speed: C.blaster.speed, ttl: C.blaster.ttl,
    dmg: 1, owner: p.id, team: 'player', crouch: !pistol && !!p.crouch });   // §15: geduckt -> eigene low-Deckung stoppt den Schuss
  game.emit('sfx', { name: pistol ? 'pistol' : 'blaster', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
}

function spawnProjectile(game, o) {
  const t = Physics.toTile(o.x, o.y);
  const q = Object.assign({ id: game.nextId('ap'), stx: t.x, sty: t.y, sx: o.x, sy: o.y, checked: [] }, o);
  game.away.projectiles.push(q);
  return q;
}

// Gegner feuert (nach abgeschlossener Ankündigung, CONTRACT-M2 §4.3)
function fireEnemy(game, e, target) {
  const C = cfg(game); const aw = game.away;
  const Wf = waffen();
  if (Wf && kaempfer(game, e).waffe) {   // B2 §3.3: Gegner mit Waffe (Rolle) feuern nach denselben Regeln wie Spieler
    if (aw.stats) aw.stats.enemyShots++;
    const n0 = aw.projectiles.length;
    const r = Wf.feuern(game, e, { x: target.x, y: target.y, ziel: target.id });
    // E16: Schuss mit Aussicht bzw. Trupp-Funk darf außerhalb der engageBox treffen (Zähler offBoxHitsHilfe statt offBoxHits)
    if (aw.projectiles.length > n0 && sichtHilfe(game, e, target)) for (let i = n0; i < aw.projectiles.length; i++) aw.projectiles[i].hilfe = true;
    return r;
  }
  const ec = C.enemy[e.kind] || C.enemy.scavenger;
  const spread = ((ec.spreadDeg || 0) * Math.PI / 180) * (aw.rng() * 2 - 1);
  const a = Math.atan2(target.y - e.y, target.x - e.x) + spread;
  const warden = e.kind === 'warden';
  const box = C.engageBox;
  const inBox = Math.abs(target.x - e.x) <= box.w / 2 && Math.abs(target.y - e.y) <= box.h / 2;
  if (aw.stats) { aw.stats.enemyShots++; if (!inBox) aw.stats.offBoxShots++; }
  spawnProjectile(game, { kind: warden ? 'warden' : 'enemy', x: e.x, y: e.y, angle: a, speed: ec.shotSpeed, ttl: C.shotTtl,
    dmg: warden ? (ec.shotSegments || 2) : 1, owner: e.id, team: 'enemy', target: target.id });
  game.emit('sfx', { name: warden ? 'warden_shot' : 'enemy_shot', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) });
}

// E16: Hat Gegner e für Ziel t Hilfe über die eigene Sicht hinaus (am aussicht-Anker bzw. Trupp-Funk/geteilte Sicht)?
function sichtHilfe(game, e, t) {
  if (!e || !t) return false;
  try {
    if (squad.amAussicht(game, env(game), e)) return true;
    const s = squad.squadOf(game, e);
    return !!(t.id != null && s && s.geteilt && s.geteilt[t.id] > game.time);
  } catch (err) { return false; }
}
// Invariante „kein Treffer aus dem Off“ (Sim): Gegnertreffer auf Spieler weiter als engageBox (+48 px) vom Schützen.
// Mit Sichthilfe (E16) zählt er als offBoxHitsHilfe, sonst als offBoxHits.
function offBoxZaehlen(game, p, sx, sy, hilfe) {
  const aw = game.away; const box = cfg(game).engageBox;
  if (!aw.stats || !box) return;
  if (Math.abs(p.x - sx) <= box.w / 2 + 48 && Math.abs(p.y - sy) <= box.h / 2 + 48) return;
  if (hilfe) aw.stats.offBoxHitsHilfe = (aw.stats.offBoxHitsHilfe || 0) + 1; else aw.stats.offBoxHits++;
}
// Schützt die halbe Deckung bei (tx,ty) ein mögliches Ziel in Flugrichtung? (8er-Nachbarschaft der Zielkachel)
function coverGuardsTarget(game, q, tx, ty) {
  const ca = Math.cos(q.angle), sa = Math.sin(q.angle);
  const ahead = (x, y) => (x - q.x) * ca + (y - q.y) * sa > 0;
  const near = (x, y) => { const t = Physics.toTile(x, y); return Math.abs(t.x - tx) <= 1 && Math.abs(t.y - ty) <= 1 && !(t.x === tx && t.y === ty); };
  if (q.team === 'player' || q.team === 'crew') return game.away.drones.some((e) => e.alive && near(e.x, e.y) && ahead(e.x, e.y));
  return game.players.some((p) => p.zone === 'away' && !p.downed && near(p.x, p.y) && ahead(p.x, p.y));
}

// §15: Liegt die low-Kachel (tx,ty) direkt neben einem geduckten Ziel des Projektils (Gegenseite, in Flugrichtung)?
function crouchGuardsTarget(game, E, q, tx, ty) {
  const ca = Math.cos(q.angle), sa = Math.sin(q.angle);
  const ahead = (o) => (o.x - q.x) * ca + (o.y - q.y) * sa > 0;
  const guards = (o) => o.crouch && ahead(o) && Los.lowGuard(E.map, E.solid, o.x, o.y, tx, ty);
  if (q.team === 'player' || q.team === 'crew') return game.away.drones.some((e) => e.alive && guards(e));
  return game.players.some((p) => p.zone === 'away' && !p.downed && guards(p));
}
// §15: Ausweichwurf eines geduckten Ziels, einmal je Projektil und Ziel (true = verfehlt)
function dodged(game, q, id) {
  if (!q.dodge) q.dodge = {};
  if (q.dodge[id] == null) {
    const miss = game.away.rng() < clamp(Number(crouchCfg(game).dodge) || 0, 0, 1);
    q.dodge[id] = miss;
    if (miss && game.away.stats) game.away.stats.dodges = (game.away.stats.dodges || 0) + 1;
  }
  return q.dodge[id];
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

function updateProjectiles(game, dt) {
  const C = cfg(game); const aw = game.away; const E = env(game);
  const keep = [];
  for (const q of aw.projectiles) {
    if (q.kind === 'granate') {   // B2 §3.2: kein Treffer im Flug, Flächenwirkung am Ziel
      const Wg = waffen();
      if (Wg && typeof Wg.granateFlug === 'function') { if (!Wg.granateFlug(game, q, dt)) keep.push(q); continue; }
      q.t = (q.t || 0) + dt;
      if (q.t < (q.flug || 0.8)) { keep.push(q); continue; }
      game.emit('granateEinschlag', { x: Math.round(q.tx), y: Math.round(q.ty) });
      flaeche(game, q.tx, q.ty, (q.radius || 1.5) * TILE, wirkungAus(q), { id: q.owner, pid: q.owner, team: q.team, x: q.sx, y: q.sy });
      continue;
    }
    q.ttl -= dt;
    const len = q.speed * dt;
    const steps = Math.max(1, Math.ceil(len / 8));
    const ca = Math.cos(q.angle), sa = Math.sin(q.angle);
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      const x0 = q.x, y0 = q.y;
      const x1 = x0 + ca * len / steps, y1 = y0 + sa * len / steps;
      // Kacheln auf dem Teilstück: Wand stoppt immer, halbe Deckung schluckt mit halfCoverBlock (CONTRACT-M2 §4.3)
      let stop = null;
      Los.walk(x0, y0, x1, y1, (tx, ty) => {
        if (E.shotBlocked(tx, ty)) { stop = { kind: 'wall', tx, ty }; return true; }
        if (!E.solid(tx, ty)) return false;
        const info = E.map.info(tx, ty);
        if (!(info.low && info.cover)) return false;
        // §15 Ducken: low-Kachel neben dem geduckten Schützen bzw. neben einem geduckten Ziel stoppt zu 100 %
        if (q.crouch && Math.max(Math.abs(tx - q.stx), Math.abs(ty - q.sty)) <= 1) { stop = { kind: 'cover', tx, ty, crouch: true }; return true; }
        if (crouchGuardsTarget(game, E, q, tx, ty)) { stop = { kind: 'cover', tx, ty, crouch: true }; return true; }
        if (Math.max(Math.abs(tx - q.stx), Math.abs(ty - q.sty)) <= 1) return false;   // Deckung am Schützen: drüber hinweg
        const key = tx + ',' + ty;
        if (q.checked.includes(key)) return false;
        if (!coverGuardsTarget(game, q, tx, ty)) return false;                           // keine Zieldeckung: drüber hinweg
        q.checked.push(key);
        if (aw.rng() < C.halfCoverBlock) { stop = { kind: 'cover', tx, ty }; return true; }
        return false;
      });
      if (stop) {
        dead = true;
        if (stop.kind === 'cover') {
          if (aw.stats) { aw.stats.coverBlocks++; if (stop.crouch) aw.stats.crouchBlocks = (aw.stats.crouchBlocks || 0) + 1; }
          const cx = stop.tx * TILE + TILE / 2, cy = stop.ty * TILE + TILE / 2;
          game.emit('coverHit', { x: cx, y: cy });
          game.emit('sfx', { name: 'cover_hit', zone: 'away', x: cx, y: cy });
        }
        break;
      }
      // Treffer
      if (q.team === 'player' || q.team === 'crew') {
        for (const e of aw.drones) {
          if (!e.alive) continue;
          const r = (C.hitRadius && C.hitRadius[e.kind]) || 13;
          if (segDist(e.x, e.y, x0, y0, x1, y1) < r) {
            if (e.crouch && dodged(game, q, e.id)) continue;   // §15: kleineres Ziel – Schuss fliegt vorbei
            dead = true; hitEnemy(game, e, q.dmg || 1, { x: q.sx, y: q.sy, pid: q.owner, wirkung: wirkungAus(q) }); break; }
        }
      } else {
        for (const p of game.players) {
          if (p.zone !== 'away' || p.downed) continue;
          if (segDist(p.x, p.y, x0, y0, x1, y1) < ((C.hitRadius && C.hitRadius.player) || 12)) {
            if (p.crouch && dodged(game, q, p.id)) continue;   // §15: kleineres Ziel – Schuss fliegt vorbei
            dead = true;
            if (aw.stats) { aw.stats.playerHits++; offBoxZaehlen(game, p, q.sx, q.sy, !!q.hilfe); }
            hitPlayer(game, p, q.dmg || 1, q.kind, wirkungAus(q));
            break;
          }
        }
      }
      q.x = x1; q.y = y1;
    }
    if (!dead && q.ttl > 0) keep.push(q);
  }
  aw.projectiles = keep;
}

// ---------- Gegner: Treffer, Schilde (CONTRACT-M2 §4.4/§4.5) ----------
// B2 §3.3: Hülle um waffen.treffer (wenn aktiv). src: { x, y, pid, strike?, flaeche?, wirkung? }.
// Rückgabe wie bisher: 'dead'|'asleep'|'deflect'|'shield'|'down' (+ mit Waffen: 'wunde'|'bewusstlos').
function hitEnemy(game, e, segs, src) {
  const C = cfg(game); const aw = game.away;
  if (!e.alive) return 'dead';
  const s = src || {};
  squad.onEnemyHit(game, e, s);
  const Wf = waffen();
  if (Wf) return hitEnemyWaffen(game, e, Wf, segs, s);
  if (e.asleep) {
    if (e.kind === 'warden') { game.emit('wardenDeflect', { id: e.id, x: Math.round(e.x), y: Math.round(e.y) }); game.emit('sfx', { name: 'warden_deflect', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) }); }
    return 'asleep';
  }
  if (e.kind === 'warden' && !s.strike && Number.isFinite(s.x)) {
    const rel = Physics.normAngle(Math.atan2(s.y - e.y, s.x - e.x) - e.facing);
    if (Math.abs(rel) <= (C.enemy.warden.frontArc * Math.PI / 180) / 2) {
      if (aw.stats) aw.stats.deflects++;
      game.emit('wardenDeflect', { id: e.id, x: Math.round(e.x), y: Math.round(e.y) });
      game.emit('sfx', { name: 'warden_deflect', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) });
      return 'deflect';
    }
  }
  e.lastHitAt = game.time; e.regenT = 0; e.hitT = game.time;
  const n = Math.max(1, segs || 1);
  if (e.seg > 0) {
    e.seg = Math.max(0, e.seg - n); e.hp = e.seg;
    game.emit('enemyShieldHit', { id: e.id, seg: e.seg, x: Math.round(e.x), y: Math.round(e.y) });
    if (n <= 1 || s.strike) return 'shield';
    return 'shield';
  }
  knockOut(game, e);
  return 'down';
}
function hitEnemyWaffen(game, e, Wf, segs, s) {
  const aw = game.away;
  kaempfer(game, e);
  if (e.asleep) {   // schlafender Wächter bleibt unverwundbar (wie bisher)
    if (e.kind === 'warden') { game.emit('wardenDeflect', { id: e.id, x: Math.round(e.x), y: Math.round(e.y) }); game.emit('sfx', { name: 'warden_deflect', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) }); }
    return 'asleep';
  }
  const wk = wirkungVon(segs, null, Object.assign({ art: s.strike ? 'orbital' : s.flaeche ? 'flaeche' : 'direkt', x: s.x, y: s.y },
    s.strike ? { strike: true } : null, s.flaeche ? { flaeche: true } : null, s.wirkung || {}));
  const quelle = wk.quelle || { id: s.pid || null, pid: s.pid || null, team: s.strike ? 'orbit' : 'crew', x: s.x, y: s.y };
  const r = Wf.treffer(game, e, wk, quelle);
  const x = Math.round(e.x), y = Math.round(e.y);
  if (r === 'abgelenkt' || (r === 'ignoriert' && e.asleep && e.kind === 'warden')) {
    if (r === 'abgelenkt' && aw.stats) aw.stats.deflects++;
    game.emit('wardenDeflect', { id: e.id, x, y });
    game.emit('sfx', { name: 'warden_deflect', zone: 'away', x, y });
    return r === 'abgelenkt' ? 'deflect' : 'asleep';
  }
  if (r === 'ignoriert') return e.asleep ? 'asleep' : 'shield';
  e.hitT = game.time; e.hp = e.seg;
  if (r === 'schild') { game.emit('enemyShieldHit', { id: e.id, seg: e.seg, x, y, waffe: wk.waffe || null }); return 'shield'; }
  if (r === 'gefallen' || r === 'bewusstlos') { faellt(game, e); return r === 'gefallen' ? 'down' : 'bewusstlos'; }   // liegt
  return r === 'wunde' ? 'wunde' : 'shield';
}
function knockOut(game, e) {
  e.alive = false; e.aim = null; e.seg = 0; e.hp = 0; e.path = null; e.vis = false; e.ghost = null; e.crouch = false;
  // Abweichung §7: Feld heißt enemyKind, weil `kind` im Event-Objekt der Ereignisname ist ({ t:'event', kind:'enemyDown' })
  game.emit('enemyDown', { id: e.id, enemyKind: e.kind, x: Math.round(e.x), y: Math.round(e.y) });
  game.emit('sfx', { name: 'drone_die', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) });
  if (!e.zustand || e.kind === 'drone') game.emit('explosion', { x: Math.round(e.x), y: Math.round(e.y), zone: 'away' });   // B2: Körper bleibt liegen
  game.missionEvent('droneKilled', { kind: e.kind, rolle: e.rolle || null, tag: e.tag || null });
  if (e.kind === 'warden') {
    game.emit('wardenDown', { id: e.id, x: Math.round(e.x), y: Math.round(e.y) });
    game.missionEvent('wardenKilled', {});
  }
  squad.onEnemyDown(game, e);
}
// Orbitalschlag: strikeSegments Treffer, unabhängig von der Wächter-Front (schlafender Wächter bleibt unverwundbar)
function strikeEnemy(game, e) {
  const n = cfg(game).strikeSegments;
  for (let i = 0; i < n && e.alive; i++) hitEnemy(game, e, 1, { strike: true });
}

function updateEnemyShields(game, dt) {
  const C = cfg(game);
  for (const e of game.away.drones) {
    if (!e.alive || e.asleep || e.seg >= e.max) { e.regenT = 0; continue; }
    const ec = C.enemy[e.kind] || C.enemy.scavenger;
    if (game.time - e.lastHitAt < ec.regenDelay) { e.regenT = 0; continue; }
    e.regenT += dt;
    if (e.regenT < ec.regenStep) continue;
    e.regenT = 0; e.seg++; e.hp = e.seg;
    if (e.seg >= e.max) squad.onShieldFull(game, e);
  }
}

// E16: Sichtradius eines Spielers – vom aussicht-Anker (gebaute Karte, Waffen aktiv) sicht.aussicht Kacheln, sonst R
function sichtRadius(game, E, p, R) {
  if (!waffen() || !E.info || !E.info.karte) return R;
  const t = Physics.toTile(p.x, p.y);
  const auf = E.info.karte.anker.some((a) => a.rolle === 'aussicht' && Math.abs(a.x - t.x) <= 1 && Math.abs(a.y - t.y) <= 1);
  return auf ? (Number(cfg(game).sicht && cfg(game).sicht.aussicht) || 22) * TILE : R;
}

// ---------- Fog of War, Deckung der Spieler (CONTRACT-M2 §6, §7 cv/fl) ----------
function updateVisibility(game) {
  const C = cfg(game); const aw = game.away; const E = env(game);
  const team = teamOf(game);
  const R = C.sightTiles * TILE;
  const sensor = game.time < aw.sensorUntil;
  for (const e of aw.drones) {
    if (!e.alive) { e.vis = false; e.ghost = null; continue; }
    let seen = false;
    for (const p of team) {
      if (dist(p.x, p.y, e.x, e.y) <= sichtRadius(game, E, p, R) && losBetween(E, p, e)) { seen = true; break; }   // §15: Ducken sperrt beidseitig
    }
    if (seen) { e.seenAt = game.time; e.seenX = e.x; e.seenY = e.y; rolleGesehen(game, e); }
    e.vis = seen || sensor || game.time < (e.focusUntil || 0);
    e.ghost = !e.vis && e.seenAt > -50 && game.time - e.seenAt < C.ghostTime ? { x: r1(e.seenX), y: r1(e.seenY), t: r2(e.seenAt) } : null;
  }
  // Deckung gegen den gefährlichsten sichtbaren Gegner (zielt auf mich > nächster), offene Flanke
  for (const p of game.players) {
    if (p.zone !== 'away') { p.cv = 0; p.fl = false; continue; }
    const danger = [];
    for (const e of aw.drones) {
      if (!e.alive || e.asleep || !squad.isAlert(game, e)) continue;
      if (dist(p.x, p.y, e.x, e.y) > R) continue;
      if (!Los.lineOfSight(E.blocked, e.x, e.y, p.x, p.y)) continue;
      danger.push(e);
    }
    // §15: Geduckt hinter niedriger Deckung zählt als volle Deckung (cv 2), auch solange kein Gegner in Sicht ist.
    // Die Gefahrenliste nutzt die Sicht ohne Ducken, damit cv die Deckung gegen den Gegner vor der Mauer zeigt.
    const crouched = !!p.crouch && !p.downed;
    if (!danger.length) { p.cv = crouched && Los.nextToLow(E.map, E.solid, p.x, p.y) ? 2 : 0; p.fl = false; continue; }
    danger.sort((a, b) => ((b.aim && b.aim.target === p.id) ? 1 : 0) - ((a.aim && a.aim.target === p.id) ? 1 : 0) || dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
    const covers = danger.map((e) => Los.coverAgainst(E.map, E.solid, e.x, e.y, p.x, p.y, crouched));
    p.cv = covers[0];
    // Offene Flanke: ein bemerkender Gegner mit Sichtlinie trifft ohne Deckung, obwohl der Spieler an Deckung steht
    p.fl = covers.some((c) => c === 0) && nextToCover(E, p);
  }
}
function nextToCover(E, p) {
  const t = Physics.toTile(p.x, p.y);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const info = E.map.info(t.x + dx, t.y + dy);
    if (info.cover && E.solid(t.x + dx, t.y + dy) && info.kind !== 'rock' && info.kind !== 'wall_ruin') return true;
  }
  return false;
}

function scanQuality(game, aw) {
  const a = aw || game.away;
  if (!a.jammers || !a.jammers.length) return 1;
  return a.jammers.every((j) => j.off) ? 1 : cfg(game).scanQualityJammed;
}

// ---------- Captain-Befehle (CONTRACT-M2 §6) ----------
function order(game, msg) {
  const C = cfg(game); const aw = game.away;
  const kind = typeof msg.kind === 'string' ? msg.kind : '';
  if (!aw.orders) aw.orders = [];
  if (msg.clear) {
    if (msg.id != null) aw.orders = aw.orders.filter((o) => o.id !== String(msg.id));
    else if (kind) aw.orders = aw.orders.filter((o) => o.kind !== kind);
    else aw.orders = [];
    return null;
  }
  if (!Protocol.ORDER_KINDS.includes(kind)) return 'Unbekannter Befehl.';
  const map = infoOf(aw).map;
  let x = Number(msg.x), y = Number(msg.y);
  let target = null;
  if (kind === 'fokus') {
    const e = aw.drones.find((d) => d.id === String(msg.target) && d.alive);
    if (!e) return 'Fokus: Bitte einen Gegner anklicken.';
    target = e.id;
    if (!Number.isFinite(x) || !Number.isFinite(y)) { x = e.x; y = e.y; }
    e.focusUntil = game.time + Math.max(C.orders.focusTime, Number(C.sicht && C.sicht.geteiltTtl) || 0);   // E16: geteilte Sicht
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Befehl braucht einen Punkt auf der Karte.';
  x = Math.round(clamp(x, 0, map.w * TILE)); y = Math.round(clamp(y, 0, map.h * TILE));
  aw.orders = aw.orders.filter((o) => o.kind !== kind);
  while (aw.orders.length >= Math.max(1, C.orders.max)) aw.orders.shift();
  const o = { id: game.nextId('o'), kind, x, y, target, until: game.time + C.orders.ttl };
  aw.orders.push(o);
  game.emit('order', { orderKind: kind, x, y, target, id: o.id });   // Abweichung §7: orderKind statt kind (s. enemyDown)
  game.emit('sfx', { name: 'order', zone: 'away', x, y });
  game.missionEvent('order', { kind });
  return null;
}

// ---------- Kesh-Interaktionen (CONTRACT-M2 §4.7) ----------
function interactionsAt(game, p, tx, ty, ch, list) {
  const aw = game.away;
  if (aw.map !== 'kesh') return;
  if (ch === 'r') {
    const i = aw.jammers.findIndex((j) => j.x === tx && j.y === ty);
    if (i >= 0 && !aw.jammers[i].off) list.push({ kind: 'jammer', i });
    else if (i >= 0) list.push({ kind: 'jammer', blocked: 'Störrelais ist schon aus.' });
  }
  if (ch === 'k') {
    const i = aw.keys.findIndex((k) => k.x === tx && k.y === ty);
    if (i < 0) return;
    if (aw.vault.open) list.push({ kind: 'archkey', blocked: 'Das Tor steht schon offen.' });
    else if (aw.keys[i].doneAt != null) list.push({ kind: 'archkey', blocked: 'Gedreht! Jetzt muss der zweite Schlüssel – sofort.' });
    else list.push({ kind: 'archkey', i });
  }
  if (ch === 'T') {
    if (!aw.vault.open) list.push({ kind: 'tablet', blocked: 'Das Gewölbe ist verschlossen.' });
    else if (aw.tablet.taken && aw.tablet.empty) list.push({ kind: 'tablet', blocked: 'Der Sockel ist leer – die Tafel liegt längst im Konkordat-Archiv.' });
    else if (aw.tablet.taken) list.push({ kind: 'tablet', blocked: aw.tablet.item && aw.tablet.item !== 'tafel' ? 'Der Sockel ist leer – der Fund ist schon bei uns.' : 'Der Sockel ist leer – die Tafel ist schon bei uns.' });
    else list.push({ kind: 'tablet' });
  }
}
function holdDuration(game, p, kind) {
  const C = cfg(game);
  if (kind === 'revive') return p.medkit ? C.wounded.medkitReviveTime : C.wounded.reviveTime;
  if (kind === 'jammer') return C.jammerTime;
  if (kind === 'archkey') return C.archkeyTime;
  if (kind === 'tablet') return C.tabletTime;
  return 1;
}
function holdValid(game, p, h) {
  const aw = game.away;
  if (p.zone !== 'away' || aw.map !== 'kesh') return false;
  if (h.kind === 'jammer') return !!aw.jammers[h.i] && !aw.jammers[h.i].off;
  if (h.kind === 'archkey') return !aw.vault.open && !!aw.keys[h.i] && aw.keys[h.i].doneAt == null;
  if (h.kind === 'tablet') return aw.vault.open && !aw.tablet.taken;
  return false;
}
function completeHold(game, p, h) {
  if (h.kind === 'jammer') jammerOff(game, p, h.i);
  else if (h.kind === 'archkey') keyTurned(game, p, h.i);
  else if (h.kind === 'tablet') takeTablet(game, p);
}
// Wiederbeleben auf v2-Karten (Zeiten/Segmente aus §4.2; Medipack wird verbraucht)
function completeRevive(game, p, h) {
  const C = cfg(game); const t = h.target;
  if (!t || !t.downed) return;
  const kit = h.medkit && p.medkit > 0;
  if (kit) p.medkit = 0;
  revive(game, t, kit ? C.wounded.medkitSegments : C.wounded.reviveSegments);
  game.oda(`${t.name} ist wieder auf den Beinen${kit ? ' – dank Medipack mit zwei Segmenten' : ''}. Deckung suchen!`, null);
}

function jammerOff(game, p, i) {
  const aw = game.away; const j = aw.jammers[i];
  if (!j || j.off) return;
  j.off = true;
  const x = j.x * TILE + TILE / 2, y = j.y * TILE + TILE / 2;
  game.emit('jammerOff', { i, x, y });
  game.emit('sfx', { name: 'jammer_off', zone: 'away', x, y });
  if (aw.jammers.every((q) => q.off)) game.oda('Beide Störrelais aus – der Captain sieht jetzt scharf. Schilde, Rollen, alles.', null);
  else game.oda('Störrelais aus! Eins fehlt noch, dann ist der Captain-Scan klar.', null);
  game.missionEvent('jammerOff', { i });
}
// QA M2: Ist nur noch ein Spieler verbunden, reicht das Zeitfenster zum Hinüberlaufen (sonst Sackgasse am Tor)
function keyWindow(game) {
  const C = cfg(game);
  const solo = game.players.filter((p) => p.connected).length <= 1;
  return solo ? Math.max(C.archkeyWindow, C.archkeySoloWindow || 0) : C.archkeyWindow;
}
function keyTurned(game, p, i) {
  const C = cfg(game); const aw = game.away; const k = aw.keys[i];
  if (!k || aw.vault.open) return;
  k.doneAt = game.time;
  const x = k.x * TILE + TILE / 2, y = k.y * TILE + TILE / 2;
  game.emit('sfx', { name: 'archkey', zone: 'away', x, y });
  const other = aw.keys.find((o, j) => j !== i && o.doneAt != null && game.time - o.doneAt <= keyWindow(game));
  if (other) openVault(game);
  else game.missionEvent('archkeyTurned', { i });
}
function openVault(game) {
  const aw = game.aways.kesh;
  if (aw.vault.open) return;
  aw.vault.open = true;
  for (const k of aw.keys) { k.doneAt = null; k.t = 1; }
  const g = W.AWAY_MAPS.kesh.gate;
  const x = g.length ? Math.round(g.reduce((s, t) => s + t.x, 0) / g.length * TILE + TILE / 2) : 0;
  const y = g.length ? g[0].y * TILE + TILE / 2 : 0;
  game.emit('vaultOpen', { x, y });
  game.emit('sfx', { name: 'vault_open', zone: 'away', x, y });
  game.missionEvent('vaultOpened', {});
}
function takeTablet(game, p) {
  const aw = game.aways.kesh;
  if (aw.tablet.taken) return;
  aw.tablet.taken = true; aw.tablet.by = p ? p.id : null;   // QA M2: Träger für den Wächter-Schritt (tabletInCourtyard)
  // S2: Nach map_reset kann ein anderer Fund auf dem Sockel liegen (aw.tablet.item); Standard bleibt die Tafel
  const item = aw.tablet.item || 'tafel';
  game.inventory[item] = (game.inventory[item] || 0) + 1;
  const x = aw.tablet.x * TILE + TILE / 2, y = aw.tablet.y * TILE + TILE / 2;
  game.emit('tabletTaken', { pid: p ? p.id : null, x, y });
  game.emit('sfx', { name: 'tablet', zone: 'away', x, y });
  if (aw.tablet.item) game.missionEvent('tabletTaken', { p, item });
  else game.missionEvent('tabletTaken', { p });
}
// Schlüssel: Fortschritt 0..1 für den Snapshot; einer allein -> Hinweis und Rücksetzen (§4.7)
function updateKeys(game) {
  const C = cfg(game); const aw = game.away;
  if (!aw.keys) return;
  for (let i = 0; i < aw.keys.length; i++) {
    const k = aw.keys[i];
    if (aw.vault.open) { k.t = 1; continue; }
    if (k.doneAt != null) {
      if (game.time - k.doneAt > keyWindow(game)) {
        k.doneAt = null; k.t = 0;
        if (game.time - aw.keyHintAt > 6) { aw.keyHintAt = game.time; game.oda('Beide Schlüssel gleichzeitig – einer allein reicht dem Archiv nicht.', null); }
        game.emit('sfx', { name: 'code_fail', zone: 'away', x: k.x * TILE + 16, y: k.y * TILE + 16 });
      } else { k.t = 1; continue; }
    }
    let t = 0;
    for (const p of game.players) if (p.zone === 'away' && p.hold && p.hold.kind === 'archkey' && p.hold.i === i) t = Math.max(t, p.hold.t / p.hold.dur);
    k.t = Math.min(1, t);
  }
}

// =====================================================================================================================
// B2 Welle 2 (BODENKAMPF): Rollen gesehen, Snapshot-Felder, Halte-Interaktionen (fesseln, befreien, Ausrüstung,
// Zellentür), Ausbruch, besetzen (Fraktion × Rezept), truppStatus, Debug. Regeln der Waffen: waffen.js (WAFFEN).
// =====================================================================================================================
// Gegnerrolle wurde für die Crew sichtbar -> weltstand.rolleGesehen (Einführungsregel E24); neu -> Ereignis rolleNeu
function rolleGesehen(game, e) {
  const r = rolleVon(e);
  if (!r || (!e.rolle && !waffen())) return;
  const seen = game.b2RollenGesehen || (game.b2RollenGesehen = new Set());
  if (seen.has(r)) return;
  seen.add(r);
  const ws = game.weltstand;
  let neu = false;
  try { neu = !!(ws && typeof ws.rolleGesehen === 'function' && ws.rolleGesehen(r)); } catch (x) { if (game.countError) game.countError('rolleGesehen', x); }
  if (neu) game.emit('rolleNeu', { rolle: r });
}
function rollenGesehen(game) {
  const ws = game.weltstand;
  try { if (ws && typeof ws.rollenGesehen === 'function') return ws.rollenGesehen() || []; } catch (x) { /* */ }
  return (ws && ws.data && ws.data.rollen_gesehen) || [];
}

// ---------- Snapshot (B2 §8) ----------
function b2SnapSpieler(game, p) {
  const Wf = waffen();
  if (!Wf || typeof Wf.snapFelder !== 'function') return {};
  kaempfer(game, p);
  const f = Wf.snapFelder(game, p);
  if (p.gefangen && !p.gefangen.offen) f.zs = 'gefangen';
  return f;
}
function b2SnapGegner(game, e, base) {
  const Wf = waffen();
  if (!Wf || typeof Wf.snapFelder !== 'function') return;
  kaempfer(game, e);
  const f = Wf.snapFelder(game, e);
  // Budget (B2 §8, < 13 KB): Standardwerte fallen weg – zs fehlt = 'ok', wn/wm fehlen = 1/1, pa fehlt = Palette der
  // Fraktion (Katalog fraktionen/<fr>.json), ro/fr nur, wenn gesetzt.
  base.wf = f.wf;
  const zs = e.zustand || (e.alive ? 'ok' : 'aus');
  if (zs !== 'ok') base.zs = zs;
  if (f.ch != null) base.ch = f.ch;
  if (f.wu != null) base.wu = f.wu;
  if (f.bt) base.bt = 1;
  const ro = rolleVon(e);
  if (ro) base.ro = ro;
  if (e.fraktion) base.fr = e.fraktion;
  if (e.rank) base.rk = 1;   // Häuptling-Look (actors.js liest rk); Standard 0 wird nicht gesendet
  if (e.palette) { const fk = (katalogDaten(game).fraktionen || {})[e.fraktion]; if (!fk || fk.palette !== e.palette) base.pa = e.palette; }
  if (e.wunden && (e.wunden.max > 1 || e.wunden.n < e.wunden.max)) { base.wn = e.wunden.n; base.wm = e.wunden.max; }
  if (e.granatZiel && game.time - e.granatZiel.t < 2) base.gr = { x: Math.round(e.granatZiel.x), y: Math.round(e.granatZiel.y), t: r2(e.granatZiel.t) };
  if (base.facing == null && Number.isFinite(e.facing)) base.facing = Math.round(e.facing * 100) / 100;
}

// Lanze der Spieler: Schuss beim Loslassen. Der Client schickt `shoot` beim Halten im Takt (≈ 0,3 s); bleibt der Strom
// länger als 0,45 s aus oder ist die höchste Stufe erreicht, löst der Schuss aus.
function lanzeLoslassen(game) {
  const Wf = waffen();
  if (!Wf || typeof Wf.loslassen !== 'function') return;
  for (const p of game.players) {
    if (p.zone !== 'away' || !p.ladung) continue;
    const d = Wf.def(game, p.waffe);
    if (!d || !Array.isArray(d.laden)) continue;
    if (p.losGemeldet) continue;   // Client meldet das Loslassen selbst (shoot { los: true })
    if (p.ladung.stufe >= d.laden.length || game.time - (p.schussInputAt || 0) > 0.45) Wf.loslassen(game, p);
  }
}

// ---------- Halte-Interaktionen (B2 §4, §8: fesseln, befreien, ausruestung, zellentuer) ----------
const B2_HOLDS = { fesseln: 1, befreien: 1, ausruestung: 1, zellentuer: 1 };
function istB2Hold(kind) { return !!B2_HOLDS[kind]; }
function reviveSperre(game, p, o) {
  if (!waffen() || !o.zustand) return null;
  if (o.zustand === 'bewusstlos') return `${o.name} ist bewusstlos – aufhelfen geht nicht. In ein paar Sekunden kommt ${o.name} zu sich.`;
  if (o.zustand === 'gefesselt') return `${o.name} ist gefesselt – E halten zum Befreien.`;
  return null;
}
const amOrt = (o, tx, ty) => { const t = Physics.toTile(o.x, o.y); return t.x === tx && t.y === ty; };
function kartenAnker(game, rolle) {
  const i = infoOf(game.away);
  return ((i && i.karte && i.karte.anker) || []).filter((a) => a.rolle === rolle).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function ankerZustand(game, id) {
  const A = mod('anker');
  if (A && typeof A.zustand === 'function') { try { const z = A.zustand(game, game.away.map, id); if (z) return z; } catch (e) { /* */ } }
  return (game.away.zustaende || {})[id] || null;
}
function ankerSetzen(game, id, z, pid) {
  const A = mod('anker');
  if (A && typeof A.setzen === 'function') { try { A.setzen(game, game.away.map, id, z, pid || null); return; } catch (e) { if (game.countError) game.countError('anker-setzen', e); } }
  if (!game.away.zustaende) game.away.zustaende = {};
  game.away.zustaende[id] = z;
}
function interactionsB2(game, p, tx, ty, list) {
  if (!waffen() || p.zone !== 'away' || p.downed) return;
  const aw = game.away;
  for (const e of aw.drones) {
    if (!e.alive && e.liegt && e.zustand === 'bewusstlos' && amOrt(e, tx, ty)) list.push({ kind: 'fesseln', ziel: e.id, tx, ty });
  }
  for (const o of game.players) {
    if (o !== p && o.zone === 'away' && o.downed && o.zustand === 'gefesselt' && amOrt(o, tx, ty)) list.push({ kind: 'befreien', ziel: o.id, tx, ty });
  }
  const g = p.gefangen;
  if (g) {
    const b = g.beute ? kartenAnker(game, 'beute').find((a) => a.id === g.beute) : null;
    if (b && p.waffeVorher && b.x === tx && b.y === ty) list.push({ kind: 'ausruestung', tx, ty });
    const z = kartenAnker(game, 'zelle').find((a) => a.id === g.zelle);
    if (z && !g.offen && Math.abs(z.x - tx) <= 1 && Math.abs(z.y - ty) <= 1) list.push({ kind: 'zellentuer', tx, ty });
  }
}
function holdDurationB2(game, p, kind) {
  const K = cfg(game).koerper || {};
  if (kind === 'fesseln') return Number(K.fesseln) || 3;
  if (kind === 'befreien') return Number(K.befreien) || 3;
  if (kind === 'zellentuer') return Number(K.ausbruchTuer) || 8;
  if (kind === 'ausruestung') return Number(game.C.anker && game.C.anker.halten && game.C.anker.halten.beute) || 2;
  return 1;
}
function holdValidB2(game, p, h) {
  if (p.zone !== 'away' || p.downed || !waffen()) return false;
  if (h.kind === 'fesseln') { const e = game.away.drones.find((d) => d.id === h.ziel); return !!(e && !e.alive && e.zustand === 'bewusstlos'); }
  if (h.kind === 'befreien') { const o = game.playerById(h.ziel); return !!(o && o.zone === 'away' && o.zustand === 'gefesselt'); }
  if (h.kind === 'ausruestung') return !!(p.gefangen && p.waffeVorher);
  if (h.kind === 'zellentuer') return !!(p.gefangen && !p.gefangen.offen);
  return false;
}
function completeHoldB2(game, p, h) {
  const Wf = waffen(); if (!Wf) return;
  kaempfer(game, p);
  if (h.kind === 'fesseln') {
    const e = game.away.drones.find((d) => d.id === h.ziel);
    if (e && !Wf.fesseln(game, kaempfer(game, e), p)) { game.missionEvent('gegnerGefesselt', { id: e.id, rolle: rolleVon(e), tag: e.tag || null, pid: p.id }); squad.onEnemyDown(game, e); }
  } else if (h.kind === 'befreien') {
    const o = game.playerById(h.ziel);
    if (o) { Wf.befreien(game, kaempfer(game, o), p); folgenAbgleich(game); }
  } else if (h.kind === 'ausruestung') {
    p.waffe = p.waffeVorher; p.waffeVorher = null; p.hitze = 0; p.gesperrtBis = 0; p.ladung = null; p.ausholen = null;
    game.emit('loadout', { pid: p.id, waffe: p.waffe });
    game.notice(p, 'Ausrüstung zurück.');
    game.missionEvent('ausruestungZurueck', { pid: p.id });
  } else if (h.kind === 'zellentuer') {
    zelleAuf(game, p);
  }
}

// ---------- Gefangen -> Ausbruch auf derselben Karte (B2 §4, E12) ----------
function ausbruchMoeglich(game, team) {
  const C = cfg(game); const aw = game.away;
  if (!(C.ausbruch && C.ausbruch.aktiv) || aw.ausbruchErlaubt === false || aw.ausbruchGehabt) return false;
  if (!team.length || !team.every((p) => p.downed) || !team.some((p) => p.zustand === 'gefesselt')) return false;
  return kartenAnker(game, 'zelle').length > 0 && kartenAnker(game, 'beute').length > 0;
}
function ausbruch(game, team) {
  const aw = game.away; const it = interior();
  const zellen = kartenAnker(game, 'zelle');
  const zelle = zellen.find((a) => ankerZustand(game, a.id) !== 'offen') || zellen[0];
  const beuten = kartenAnker(game, 'beute').slice().sort((a, b) => Math.hypot(a.x - zelle.x, a.y - zelle.y) - Math.hypot(b.x - zelle.x, b.y - zelle.y));
  const beute = beuten[0];
  aw.ausbruchGehabt = true; aw.recallT = 0;
  ankerSetzen(game, zelle.id, 'zu', null);
  if (beute && ankerZustand(game, beute.id) !== 'voll') ankerSetzen(game, beute.id, 'voll', null);
  const solid = it.awaySolid(game);
  const plaetze = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
    .map(([dx, dy]) => ({ x: zelle.x + dx, y: zelle.y + dy })).filter((t) => !solid(t.x, t.y));
  const Wf = waffen();
  team.forEach((p, i) => {
    const t = plaetze[i % Math.max(1, plaetze.length)] || zelle;
    const c = W.tileCenter(t.x, t.y);
    p.x = c.x; p.y = c.y; p.hold = null; p.lift = null; p.liftDest = null;
    p.bewusstlos = false;
    revive(game, p, null, { quiet: true });
    kaempfer(game, p);
    p.zustand = 'ok'; p.betaeubtBis = 0; p.bewusstBis = 0; if (p.wunden) p.wunden.n = p.wunden.max;
    p.waffeVorher = p.waffe && p.waffe !== 'faust' ? p.waffe : (p.waffeVorher || 'blaster');
    p.waffe = 'faust'; p.hitze = 0; p.gesperrtBis = 0; p.ladung = null; p.ausholen = null;
    p.gefangen = { zelle: zelle.id, beute: beute ? beute.id : null, x: c.x, y: c.y, offen: false };
  });
  // Die Wachen beruhigen sich: das Team ist eingesperrt
  for (const s of Object.values(aw.squads || {})) { if (!s) continue; s.alert = false; s.lastKnown = {}; s.lostBarked = true; }
  for (const e of aw.drones) { e.aim = null; e.path = null; e.goal = null; if (e.alive) e.role = 'idle'; }
  const pids = team.map((p) => p.id);
  game.emit('gefangen', { pids, zelle: zelle.id });
  game.oda('Ihr kommt in einer Zelle zu euch. Ausrüstung weg – aber die Tür hält nicht ewig. E halten an der Zellentür.', null);
  game.missionEvent('teamGefangen', { map: aw.map, pids, zelle: zelle.id });
  return true;
}
// Zellentür von innen geöffnet: laut (alarmiert), Zelle offen
function zelleAuf(game, p) {
  const aw = game.away; const g = p.gefangen;
  if (!g || g.offen) return;
  ankerSetzen(game, g.zelle, 'offen', p.id);
  for (const q of game.players) if (q.gefangen && q.gefangen.zelle === g.zelle) q.gefangen.offen = true;
  const Wf = waffen();
  if (Wf && typeof Wf.laerm === 'function') Wf.laerm(game, p.x, p.y, 'laut');
  game.emit('sfx', { name: 'zellentuer', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
  game.missionEvent('zelleOffen', { map: aw.map, zelle: g.zelle, pid: p.id });
}
// Eingesperrt: bleibt in der Zelle (weiche Leine um den Zellen-Anker), bis die Tür offen ist; danach entfällt gefangen,
// sobald die Waffe zurück ist
function updateGefangen(game) {
  for (const p of game.players) {
    const g = p.gefangen;
    if (!g || p.zone !== 'away') continue;
    if (!g.offen && ankerZustand(game, g.zelle) === 'offen') g.offen = true;
    if (!g.offen) {
      const d = dist(p.x, p.y, g.x, g.y); const R = 1.6 * TILE;
      if (d > R) { p.x = g.x + (p.x - g.x) / d * R; p.y = g.y + (p.y - g.y) / d * R; }
    } else if (!p.waffeVorher) p.gefangen = null;
  }
}

// ---------- besetzen (B1 §6.4, B2 §5/§7): Fraktion × Rezepte ----------
let katalogCache = null;
function katalogDaten(game) {
  if (katalogCache) return katalogCache;
  try { katalogCache = require('../mission/katalog.js').load(); } catch (e) { if (game && game.countError) game.countError('katalog-load', e); katalogCache = { gegner: {}, fraktionen: {} }; }
  return katalogCache;
}
function _setzeKatalog(k) { katalogCache = k || null; }
// opts { map, bereich?, fraktion, staerke: klein|mittel|gross, haltung: ruhig|wach, tag, neue_rolle? } -> Zahl der Gegner
// Einführungsregel: jede Rezeptrolle, die die Crew noch nicht gesehen hat, wird grundtyp – außer neue_rolle (höchstens
// eine neue Rolle je Gefecht). Solo: kein Häscher. Höchstens 1 Enterer je Spieler, höchstens 3 Typen je Trupp.
function besetzen(game, o) {
  const opts = o || {};
  const map = opts.map; let aw = game.aways && game.aways[map];
  // F1: noch nicht registrierte Landepunkt-Karte aus dem Karten-Cache registrieren (nie bauen; das macht landepunkte.sobaldGeladen)
  if ((!aw || !W.AWAY_MAPS[map]) && map) {
    try { const L = require('./landepunkte.js'); if (L && typeof L.bereit === 'function' && L.bereit(game, map)) aw = game.aways[map]; } catch (e) { /* ohne Landepunkte wie bisher */ }
  }
  if (!aw || !W.AWAY_MAPS[map]) { if (game.countError) game.countError('besetzen', new Error('Karte ' + map + ' unbekannt')); return 0; }
  ensureV2(game, aw, map);
  const K = katalogDaten(game);
  const f = (K.fraktionen || {})[opts.fraktion];
  if (!f || !f.rezepte) { if (game.countError) game.countError('besetzen', new Error('Fraktion ' + opts.fraktion + ' unbekannt')); return 0; }
  const info = interior().awayInfoOf(map);
  const art = info.karte ? info.karte.art : 'hand';
  let rezepte = Object.keys(f.rezepte).sort().filter((rz) => !f.einsatz || !f.einsatz[rz] || f.einsatz[rz].includes(art));
  if (!rezepte.length) rezepte = Object.keys(f.rezepte).sort();
  const n = Math.max(1, Number((f.staerke || {})[opts.staerke]) || 1);
  const picks = [];
  for (let i = 0; i < n; i++) picks.push(rezepte[Math.floor(aw.rng() * rezepte.length)]);
  if (opts.staerke === 'gross' && f.gross_extra && f.rezepte[f.gross_extra]) picks.push(f.gross_extra);
  const gesehen = new Set(rollenGesehen(game)); gesehen.add('grundtyp'); gesehen.add('waechter');   // Wächter gilt immer als bekannt (seit Kesh)
  const spieler = Math.max(1, Math.min(3, game.players.filter((p) => p.connected).length));
  const ersatz = f.modelle && f.modelle.grundtyp ? 'grundtyp' : null;   // Fraktion ohne grundtyp (herrenlos): Rolle bleibt
  const ersetzt = [];
  let enterer = 0;
  const tag = String(opts.tag || 'besetzung');
  const haltung = opts.haltung === 'wach' || (info.karte && info.karte.zustand === 'umkaempft') || aw.alarm ? 'wach' : 'ruhig';
  let gesamt = 0;
  const wege = (info.karte && info.karte.patrouillen) || [];
  const ankerPos = {}; for (const a of (info.karte && info.karte.anker) || []) ankerPos[a.id] = a;
  picks.forEach((rz, i) => {
    const rollen = {};
    for (const t of f.rezepte[rz]) {
      let r = t.rolle;
      if (ersatz && r !== opts.neue_rolle && !gesehen.has(r)) { ersetzt.push(r + '->' + ersatz + ' (ungesehen)'); r = ersatz; }
      if (ersatz && r === 'haescher' && spieler <= 1) { ersetzt.push('haescher->' + ersatz + ' (solo)'); r = ersatz; }
      let anzahl = Math.max(1, Number(t.n) || 1);
      if (r === 'enterer') {
        const frei = Math.max(0, spieler - enterer);
        if (anzahl > frei && ersatz) { rollen[ersatz] = (rollen[ersatz] || 0) + (anzahl - frei); ersetzt.push('enterer->' + ersatz + ' (je Spieler höchstens 1)'); anzahl = frei; }
        enterer += anzahl;
        if (!anzahl) continue;
      }
      rollen[r] = (rollen[r] || 0) + anzahl;
    }
    let typen = Object.keys(rollen);
    if (typen.length > 3 && ersatz) {
      for (const r of typen.filter((x) => x !== ersatz).slice(2)) { rollen[ersatz] = (rollen[ersatz] || 0) + rollen[r]; delete rollen[r]; ersetzt.push(r + '->' + ersatz + ' (höchstens 3 Typen)'); }
      typen = Object.keys(rollen);
    }
    const besetzung = typen.sort().map((r) => ({ typ: r, anzahl: rollen[r] }));
    const name = tag + '.' + (i + 1);
    const m = squad.spawnSquad(game, name, { map, bereich: opts.bereich || null, besetzung, force: true, alert: haltung === 'wach' });
    gesamt += m;
    const s = aw.squads[name];
    if (s) {
      s.schleich = true; s.tag = tag; s.fraktion = f.id;
      s.posten = i === 0 || !wege.length;
      if (!s.posten) s.weg = wege[(i - 1) % wege.length].map((id) => ankerPos[id]).filter(Boolean).map((a) => ({ x: a.x, y: a.y }));
    }
    for (const e of aw.drones) if (e.squad === name) { e.tag = tag; e.fraktion = f.id; if (f.palette) e.palette = f.palette; kaempfer(game, e); }
  });
  if (!aw.besetzt) aw.besetzt = {};
  aw.besetzt[tag] = { fraktion: f.id, staerke: opts.staerke || null, haltung, ersetzt, rezepte: picks };
  if (ersetzt.length && game.log) game.log(`besetzen ${map}/${tag}: ${ersetzt.join(', ')}`);
  try {
    const pb = require('../mission/katalog.js').pruefeBesetzung;
    if (typeof pb === 'function') {
      const r = pb([{ fraktion: f.id, staerke: opts.staerke, haltung, neue_rolle: opts.neue_rolle || null }], { katalog: K, rollen_gesehen: [...gesehen], spieler, kartenart: art });
      for (const w of (r && r.warnungen) || []) if (game.log) game.log(`besetzen ${tag}: ${w.code} ${w.msg}`);
    }
  } catch (e) { /* Prüfung ist nur Protokoll */ }
  game.missionEvent('squadSpawn', { map, tag, n: gesamt });
  return gesamt;
}
// Stand eines besetzten Trupps (Baustein trupp_geraeumt): aktiv = steht und kämpft (nicht liegend/bewusstlos/gefesselt)
function truppStatus(game, map, tag) {
  const aw = game.aways && game.aways[map];
  if (!aw) return { gesetzt: false, gesamt: 0, aktiv: 0, haltung: 'ruhig' };
  const list = (aw.drones || []).filter((e) => e.tag === tag);
  const aktiv = list.filter((e) => e.alive && (!e.zustand || e.zustand === 'ok')).length;
  const wach = Object.values(aw.squads || {}).some((s) => s && s.tag === tag && s.alert);
  return { gesetzt: !!((aw.besetzt && aw.besetzt[tag]) || list.length), gesamt: list.length, aktiv, haltung: wach ? 'wach' : 'ruhig' };
}

// ---------- Debug B2 (CONTRACT-B2 §8): gegner <rolle> [fraktion] · alarm on|off · fang ----------
function debugB2(game, cmd, args, p, msg) {
  const aw = game.away; const a = args || []; const m = msg || {};
  if (!p || p.zone !== 'away') return cmd + ': nur im Außeneinsatz.';
  ensureV2(game, aw, aw.map);
  if (cmd === 'gegner') {
    const rolle = String(m.rolle || a[0] || 'grundtyp');
    if (!cfg(game).gegner || !cfg(game).gegner[rolle]) return 'gegner <' + Object.keys(cfg(game).gegner || {}).join('|') + '> [fraktion]';
    const fr = String(m.fraktion || a[1] || '');
    const x = Number.isFinite(Number(m.x)) ? Number(m.x) : p.x + 3 * TILE, y = Number.isFinite(Number(m.y)) ? Number(m.y) : p.y;
    const t = Physics.toTile(x, y);
    const e = squad.makeEnemy(game, aw, squad.TYP_KIND[rolle] || 'scavenger', 'dbg-' + game.nextId(''), W.tileCenter(t.x, t.y), 'debug');
    e.rolle = rolle; e.asleep = false;
    if (fr) { e.fraktion = fr; const f = (katalogDaten(game).fraktionen || {})[fr]; if (f && f.palette) e.palette = f.palette; }
    kaempfer(game, e);
    aw.drones.push(e);
    if (!aw.squads.debug) aw.squads.debug = squad.newSquad('debug', 1);
    squad.alertSquad(game, aw, aw.squads.debug);
    return `gegner ${rolle}${fr ? ' (' + fr + ')' : ''} bei ${t.x},${t.y}`;
  }
  if (cmd === 'alarm') {
    const an = !/^(off|aus|0)$/i.test(String(m.an != null ? m.an : (a[0] || 'on')));
    for (const s of Object.values(aw.squads || {})) {
      if (!s) continue;
      if (an) squad.alarmiere(game, aw, s, p.x, p.y, 'debug'); else { s.alert = false; s.lastKnown = {}; }
    }
    aw.alarm = an;
    return 'alarm ' + (an ? 'an' : 'aus');
  }
  if (cmd === 'fang') {
    if (!waffen()) return 'fang: Waffen sind nicht aktiv.';
    const team = teamOf(game);
    for (const q of team) { kaempfer(game, q); q.zustand = 'gefesselt'; }
    folgenAbgleich(game);
    if (ausbruchMoeglich(game, team)) { ausbruch(game, team); return 'fang: Team gefangen, Ausbruch läuft.'; }
    return 'fang: kein Ausbruch möglich (Karte ohne zelle/beute, schon gehabt oder abgeschaltet) – Notrückholung folgt.';
  }
  return null;
}

// ---------- Trupps / Wächter (Mission, Debug) ----------
// opts: { map?, bereich?, besetzung?: [{ typ, anzahl }], alert?, force? } (squad.spawnSquad); ohne map: Kesh wie bisher
function spawnSquad(game, name, opts) { return squad.spawnSquad(game, name, opts); }
function wakeWarden(game, map) { return squad.wakeWarden(game, map); }

// ---------- Update (alle Ticks, nur v2-Karten, nur wenn away.active) ----------
function update(game, dt) {
  const aw = ensureV2(game, game.away);   // Kesh: no-op; gebaute Karten: fehlende Laufzeitfelder
  const Wf = waffen();
  if (Wf) {
    game.safe('combat-waffen', () => {
      waffenWelt(game);
      for (const p of game.players) if (p.zone === 'away') Wf.update(game, kaempfer(game, p), dt);
      for (const e of aw.drones) if (e.alive || (e.liegt && e.zustand !== 'aus' && e.zustand !== 'gefesselt')) Wf.update(game, kaempfer(game, e), dt);
      folgenAbgleich(game);
      lanzeLoslassen(game);
    });
    game.safe('combat-gefangen', () => updateGefangen(game));
  }
  game.safe('combat-shields', () => updatePlayerShields(game, dt));
  game.safe('combat-squadRecall', () => updateSquadRecall(game, dt));
  game.safe('combat-medkit', () => updateMedkitPickup(game));
  game.safe('combat-ai', () => squad.update(game, dt));
  game.safe('combat-enemyShields', () => updateEnemyShields(game, dt));
  game.safe('combat-projectiles', () => updateProjectiles(game, dt));
  game.safe('combat-keys', () => updateKeys(game));
  aw.visT = (aw.visT || 0) + dt;
  if (aw.visT >= 1 / Math.max(1, cfg(game).aiHz)) { aw.visT = 0; game.safe('combat-vis', () => updateVisibility(game)); }
  if (aw.orders && aw.orders.length) aw.orders = aw.orders.filter((o) => o.until > game.time);
}

// ---------- Debug `tune` (CONTRACT-M2 §8) ----------
function tuneList(C) {
  const out = [];
  const walk = (o, pre) => {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'barks') continue;
      if (typeof v === 'number') out.push(pre + k + '=' + v);
      else if (typeof v === 'boolean' && k !== 'barksOn') out.push(pre + k + '=' + (v ? 'on' : 'off'));
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, pre + k + '.');
    }
  };
  walk(C, '');
  return 'barks=' + (C.barksOn ? 'on' : 'off') + ' · ' + out.join(' · ');
}
function tune(game, path, value) {
  const C = cfg(game);
  if (!path) return { ok: true, text: tuneList(C) };
  if (path === 'barks') {
    const v = String(value).toLowerCase();
    if (!['on', 'off', '1', '0', 'true', 'false'].includes(v)) return { ok: false, text: 'tune barks on|off' };
    C.barksOn = v === 'on' || v === '1' || v === 'true';
    return { ok: true, text: 'barks = ' + (C.barksOn ? 'on' : 'off') };
  }
  const keys = String(path).split('.');
  // QA M3a: Pfade, die nicht unter awayCombat liegen (spaceM3.*, combat.*, crewScaling.* …), gelten für die ganze
  // Konfiguration – CONTRACT-M3 §10/§17 verlangt `tune spaceM3.<pfad> <wert>`. awayCombat-Pfade haben Vorrang (wie bisher).
  let o = (C[keys[0]] === undefined && game.C[keys[0]] !== undefined && keys[0] !== 'awayCombat') ? game.C : C;
  for (let i = 0; i < keys.length - 1; i++) {
    o = o[keys[i]];
    if (!o || typeof o !== 'object' || Array.isArray(o) || keys[i] === 'barks') return { ok: false, text: 'Unbekannter Pfad: ' + path };
  }
  const last = keys[keys.length - 1];
  if (typeof o[last] === 'boolean') {   // §15: z. B. tune crouch.enemyCrouch off
    const v = String(value).toLowerCase();
    if (!['on', 'off', '1', '0', 'true', 'false'].includes(v)) return { ok: false, text: 'tune ' + path + ' on|off' };
    o[last] = v === 'on' || v === '1' || v === 'true';
    return { ok: true, text: path + ' = ' + (o[last] ? 'on' : 'off') };
  }
  if (typeof o[last] !== 'number') return { ok: false, text: 'Kein Zahlenwert: ' + path };
  const v = Number(value);
  if (!Number.isFinite(v)) return { ok: false, text: 'Wert muss eine Zahl sein.' };
  o[last] = v;
  return { ok: true, text: path + ' = ' + v };
}

// ---------- Snapshot-Teile (CONTRACT-M2 §7) ----------
function playerSnap(game, p) {
  const v2 = p.zone === 'away' && isV2(game);
  return {
    sh: v2 && p.shield ? [p.shield.seg, p.shield.max] : null,
    shR: v2 ? r2(shieldProgress(game, p)) : 0,
    cv: v2 ? (p.cv || 0) : 0,
    fl: v2 ? !!p.fl : false,
    medkit: p.medkit ? 1 : 0,
    bleed: v2 && p.downed && p.bleed != null ? r1(p.bleed) : null,
    cr: v2 && !!p.crouch && !p.downed,   // §15
    ...(v2 ? b2SnapSpieler(game, p) : {}),
  };
}
function droneSnap(game, e, base) {
  const C = cfg(game);
  base.sh = [e.seg, e.max];
  base.role = e.role || 'idle';
  base.vis = !!e.vis;
  base.ghost = e.ghost || null;
  base.aim = e.aim ? { target: e.aim.target, p: r2(Math.min(1, (game.time - e.aim.t0) / Math.max(0.01, e.aim.dur))) } : null;
  if (e.kind === 'warden') base.facing = Math.round(e.facing * 1000) / 1000;
  base.asleep = !!e.asleep;
  base.cr = !!e.crouch && e.alive !== false;   // §15
  if (C) base.squad = e.squad || null;
  b2SnapGegner(game, e, base);
  // M4 (Wunsch ACTORS): festes Ausrüstungs-Kit je Plünderer 0 Schütze / 1 Flanker / 2 Funker – einmal vergeben
  // (Reihenfolge im Trupp), bleibt stabil, unabhängig von der wechselnden Rolle (role).
  if (e.kind === 'scavenger') {
    if (e.kit == null) e.kit = game.away.drones.filter((d) => d !== e && d.kind === 'scavenger' && (d.squad || null) === (e.squad || null) && d.kit != null).length % 3;
    base.kit = e.kit;
  }
  return base;
}
function awaySnap(game, aw) {
  if (!isV2Away(aw)) return { combat: null, scanQuality: 1, vault: null, jammers: [], keys: [], tablet: null, orders: [] };
  return {
    combat: 'v2', scanQuality: scanQuality(game, aw),
    vault: aw.vault ? { open: aw.vault.open } : null,
    jammers: (aw.jammers || []).map((j) => ({ x: j.x, y: j.y, off: j.off })),
    keys: (aw.keys || []).map((k) => ({ x: k.x, y: k.y, t: r2(k.t || 0) })),
    tablet: aw.tablet ? { x: aw.tablet.x, y: aw.tablet.y, taken: aw.tablet.taken } : null,
    orders: (aw.orders || []).map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y, target: o.target, until: r2(o.until) })),
  };
}

module.exports = {
  makeKesh, isV2, isV2Away, playerOnV2, onArrive, onLeave, hitPlayer, woundPlayer, revive, updateWounded, squadRecall,
  shoot, fireEnemy, hitEnemy, strikeEnemy, knockOut, order, interactionsAt, holdDuration, holdValid, completeHold, completeRevive,
  jammerOff, keyTurned, openVault, takeTablet, spawnSquad, wakeWarden, update, updateVisibility, scanQuality, tune, tuneList,
  playerSnap, droneSnap, awaySnap, pickupMedkit, fullShield, env, teamOf,
  losBetween, setCrouch, checkCrouch, canCrouch, speedFactor, crouchCfg,
  // B1/B2 (BODENKAMPF Welle 1): kartenneutral, Waffen-Schnittstelle
  ensureV2, ruesteV2, coverSpots, spawnProjectile, flaeche, strahl, kaempfer, wirkungVon, waffenAktiv, _setzeModul,
  // B2 Welle 2
  rolleVon, besetzen, truppStatus, debugB2, istB2Hold, reviveSperre, interactionsB2, holdDurationB2, holdValidB2, completeHoldB2,
  ausbruch, ausbruchMoeglich, folgenAbgleich, _setzeKatalog, katalogDaten,
};

// B2 §0: Waffen-Regeln (Hitze, Wunden, Betäubung, Fesseln) sind an, sobald WAFFEN geliefert hat (kein Stub).
// Schalter zum Abschalten: Umgebung WAFFEN=aus (z. B. für Vergleichsläufe gegen den alten Kampf).
(function waffenSchalter() {
  const m = mod('waffen');
  if (m && !m.stub && typeof m.treffer === 'function' && process.env.WAFFEN !== 'aus') m.aktiv = true;
})();
