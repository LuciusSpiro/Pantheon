'use strict';
// SL7c (CONCEPT-SL7 §7c): das Monster der Forschungsstation Helix. Nicht verwundbar, ununterbrochen aktiv, laut. Ein Treffer verwundet einen Spieler
// (combat.woundPlayer: zu Boden, Bleedout, Aufhelfen), sind alle am Boden, wiederholt das Regiebuch die Szene. Eigene Zustandsmaschine, NICHT die
// Rollen-KI von squad.js (die Boden-KI-Überarbeitung ist ausgeklammert): patrouille → laerm → suche → jagd.
//
//   Größenklasse statt Kachelart (shared/monster.js): Fußabdruck 2×2, Pfad UND Kollision über dieselbe Maske, nie in Engstellen festgelaufen.
//   Der Kriechgang (1 breit) und die Luken sind für das Monster dicht: wer hineinkriecht, ist sicher (aber langsam und blind).
//   Lärm: Pulte hacken (laedt = leise, geladen = laut), Spieler in Sicht (9 Kacheln) lösen die Jagd aus; verschlossene/zugeschlossene Türen bricht es auf.
//   Die vier Pulte sind eine Reihenfolge (nächstes Pult = nächster Hack): die Ops leitet, der Captain sieht Pult und Monster (Snapshot away.mo / away.mp).
//
// Schnittstelle: update(game, dt) (aus combat.update), snap(game), pulteSnap(game), alleVerwundet(game), einrichten(game), laerm(game, x, y, art)
const Mon = require('../../shared/monster.js');
const Physics = require('../../shared/physics.js');
const Anker = require('./anker.js');

let combatMod = null;
const combat = () => combatMod || (combatMod = require('./combat.js'));

const TILE = Physics.TILE;
const HB = { w: 28, h: 28 };
const STANDARD = { speedPatrouille: 50, speedSuche: 62, speedJagd: 84, sicht: 9, hoerweite: { hack: 380, fertig: 900 }, treffer: 30, pause: 1.6,
  sucheZeit: 7, rammZeit: 1.2, verlustZeit: 3, replan: 0.5 };
const cfg = (game) => Object.assign({}, STANDARD, (game.C && game.C.monster) || {});
const r1 = (v) => Math.round(v * 10) / 10;

const maskeCache = new WeakMap();
function maskeVon(karte) { let m = maskeCache.get(karte); if (!m) { m = Mon.maske(karte); maskeCache.set(karte, m); } return m; }
function karteVon(game) { const aw = game.away; return aw && game.karteOf ? game.karteOf(aw.map) : null; }
const ankerVonXY = (x, y) => Mon.ankerVon(x, y);

function mon(game) { const aw = game.away; return (aw && aw.monster) || null; }

// ---------- Aufbau ----------
function einrichten(game) {
  const aw = game.away; if (!aw || aw.monster !== undefined) return;
  const k = karteVon(game);
  if (!k || !(k.meta && k.meta.monster)) { aw.monster = null; return; }
  const m = maskeVon(k);
  const ank = (k.anker || []).find((a) => a.rolle === 'abholpunkt' && a.ankunft) || (k.anker || []).find((a) => a.rolle === 'abholpunkt');
  const start = ank ? Mon.naechster(m, ank.x, ank.y, 4) : null;
  if (!start) { aw.monster = null; return; }
  const dist = Mon.bfs(m, [start]);
  // Räume: Mittelpunkte der Plätze (Ziele der Patrouille), auf den nächsten Ankerpunkt gelegt
  const raeume = [];
  for (const id of Object.keys(k.plaetze || {}).sort()) {
    const pl = k.plaetze[id]; if (!pl || !pl.rect) continue;
    const a = Mon.naechster(m, pl.rect[0] + Math.floor(pl.rect[2] / 2), pl.rect[1] + Math.floor(pl.rect[3] / 2), 3);
    if (a && dist[a.cy * m.w + a.cx] >= 0) raeume.push(a);
  }
  // Start: erreichbarer Raum mit der größten Entfernung zur Ankunft
  let sp = raeume[0] || start, bd = -1;
  for (const a of raeume) { const d = dist[a.cy * m.w + a.cx]; if (d > bd) { bd = d; sp = a; } }
  const pos = Mon.mitte(sp);
  aw.monster = { id: 'M1', kind: 'monster', x: pos.x, y: pos.y, z: 'patrouille', pfad: [], ziel: null, ziele: raeume, laerm: null, suche: 0, pause: 0, ramm: null,
    stuckT: 0, ref: { x: pos.x, y: pos.y }, facing: 0, replan: 0, verlust: 0, letzte: null, wait: 0, tref: 0 };
  // Pulte: Reihenfolge nach Entfernung von der Ankunft; nur das erste ist frei, die übrigen gesperrt
  const pulte = (k.anker || []).filter((a) => a.rolle === 'terminal').map((a) => {
    const n = Mon.naechster(m, a.x, a.y, 3);
    return { id: a.id, x: a.x, y: a.y, d: n ? dist[n.cy * m.w + n.cx] : 1e9 };
  }).sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  aw.monsterPulte = { order: pulte.map((p) => p.id), pos: Object.fromEntries(pulte.map((p) => [p.id, [p.x, p.y]])), erledigt: 0, gesehen: {}, fertig: false };
  pulte.forEach((p, i) => { if (i > 0) Anker.setzen(game, aw.map, p.id, 'gesperrt', null, { still: true }); });
  game.missionEvent('monsterStation', { map: aw.map, pulte: pulte.length });
}

// ---------- Lärm ----------
// art: 'hack' (leise, Hörweite hack) | 'fertig' (laut) | 'schuss'. Das Monster geht zum lautesten jüngsten Lärm, außer es jagt.
function laerm(game, x, y, art) {
  const M = mon(game); if (!M) return;
  const c = cfg(game);
  const w = art === 'fertig' ? c.hoerweite.fertig : c.hoerweite[art] || c.hoerweite.hack;
  M.laerm = { x, y, t: game.time, w, art };
  game.missionEvent('monsterLaerm', { art, x: Math.round(x), y: Math.round(y) });
}

function pulteTick(game) {
  const aw = game.away; const P = aw.monsterPulte; if (!P) return;
  for (const id of P.order) {
    const z = Anker.zustand(game, aw.map, id);
    const pos = P.pos[id]; const px = pos[0] * TILE + TILE / 2, py = pos[1] * TILE + TILE / 2;
    if (z === 'laedt') laerm(game, px, py, 'hack');
    if (z === 'geladen' && !P.gesehen[id]) {
      P.gesehen[id] = true; P.erledigt++;
      game.emit('pultGehackt', { map: aw.map, anker: id, n: P.erledigt, von: P.order.length });
      game.missionEvent('pultGehackt', { map: aw.map, anker: id, n: P.erledigt, von: P.order.length });
      laerm(game, px, py, 'fertig');
      const next = P.order[P.erledigt];
      if (next) { Anker.setzen(game, aw.map, next, 'bereit', null); game.oda(`Pult ${P.erledigt} von ${P.order.length} gehackt – das Monster hat es gehört! Als Nächstes: ${P.erledigt + 1}. Pult.`, null); }
      else { P.fertig = true; game.missionEvent('pulteFertig', { map: aw.map }); game.oda('Alle Pulte gehackt – die Feldkarte ist übertragen! Zurück zum Teleportpunkt, das Monster tobt!', null); }
    }
  }
}

// ---------- Wahrnehmung ----------
function spieler(game) { return game.players.filter((p) => p.zone === 'away' && p.connected !== false && !p.downed); }
function ziel(game, E, M, c) {
  let best = null, bd = Infinity;
  for (const p of spieler(game)) {
    const d = Math.hypot(p.x - M.x, p.y - M.y);
    if (d > c.sicht * TILE || d >= bd) continue;
    let sicht = true;
    try { sicht = combat().losBetween(E, M, p); } catch (e) { sicht = true; }
    if (sicht) { best = p; bd = d; }
  }
  return best;
}

// ---------- Bewegung ----------
function setzePfad(M, m, zielAnker) {
  const von = Mon.ankerVon(M.x, M.y);
  const a = m.geht(von.cx, von.cy) ? von : Mon.naechster(m, Math.floor(M.x / TILE), Math.floor(M.y / TILE), 2);
  if (!a) { M.pfad = []; return false; }
  const p = Mon.weg(m, a, zielAnker, 4000);
  M.pfad = p || []; M.ziel = zielAnker;
  return !!p;
}
function kanteAmSchritt(E, a) {   // geschlossene Tür im Fußabdruck des Ankerpunkts a -> Kanten-ID
  const kanteAt = E.info && E.info.kanteAt; if (!kanteAt) return null;
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const kid = kanteAt.get((a.cx + dx) + ',' + (a.cy + dy));
    if (kid) return { kid, tx: a.cx + dx, ty: a.cy + dy };
  }
  return null;
}
function tuerZu(E, kid) {
  const kk = ((E.info.karte || {}).kanten || {})[kid]; if (!kk) return false;
  return !E.solid || (kk.tiles || []).some((t) => E.solid(t[0], t[1]));
}

function gehen(game, E, M, dt, speed) {
  const aw = game.away;
  if (M.ramm) {
    M.ramm.t -= dt;
    if (M.ramm.t <= 0) {
      const err = Anker.setzen(game, aw.map, M.ramm.kid, 'offen', null);
      game.emit('sfx', { name: 'door', zone: 'away', x: Math.round(M.x), y: Math.round(M.y) });
      game.emit('sfx', { name: 'explosion_small', zone: 'away', x: Math.round(M.x), y: Math.round(M.y) });
      M.ramm = null; if (err) M.pfad = [];
    }
    return;
  }
  if (!M.pfad.length) return;
  let budget = speed * dt; let guard = 0;
  while (budget > 0.01 && M.pfad.length && guard++ < 4) {
    const n = M.pfad[0]; const c = Mon.mitte(n);
    const tz = kanteAmSchritt(E, n);
    if (tz && tuerZu(E, tz.kid)) { M.ramm = { kid: tz.kid, t: cfg(game).rammZeit }; return; }
    const dx = c.x - M.x, dy = c.y - M.y; const d = Math.hypot(dx, dy);
    if (d < 1) { M.pfad.shift(); continue; }
    const s = Math.min(d, budget);
    const res = Physics.moveWithCollision(E.solid, M.x, M.y, dx / d * s, dy / d * s, HB);
    const moved = Math.hypot(res.x - M.x, res.y - M.y);
    M.facing = Math.atan2(dy, dx); M.x = res.x; M.y = res.y;
    budget -= Math.max(moved, 0.01);
    if (moved < s * 0.3) break;
    if (Math.hypot(c.x - M.x, c.y - M.y) < 1) M.pfad.shift();
  }
}

// ---------- Tick ----------
function update(game, dt) {
  const aw = game.away; if (!aw) return;
  if (aw.monster === undefined) einrichten(game);
  const M = aw.monster; if (!M) return;
  if (!game.players.some((p) => p.zone === 'away')) return;   // ohne Außenteam steht die Station still
  const k = karteVon(game); if (!k) return;
  const m = maskeVon(k); const c = cfg(game);
  const E = combat().env(game);
  pulteTick(game);
  M.replan -= dt; M.pause -= dt; M.suche -= dt;
  // Treffer: ein Spieler in Reichweite wird verwundet (zu Boden), das Monster hält kurz inne
  if (M.pause <= 0) {
    for (const p of spieler(game)) {
      if (Math.hypot(p.x - M.x, p.y - M.y) <= c.treffer) {
        combat().woundPlayer(game, p, 'monster');
        game.emit('monsterTreffer', { pid: p.id, x: Math.round(p.x), y: Math.round(p.y) });
        game.missionEvent('monsterTreffer', { pid: p.id });
        game.emit('sfx', { name: 'hull_hit', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
        M.pause = c.pause; M.pfad = []; M.ramm = null;
        break;
      }
    }
  }
  if (M.pause > 0) { M.stuckT = 0; return; }
  // Wahrnehmung und Zustand
  const t = ziel(game, E, M, c);
  if (t) {
    if (M.z !== 'jagd') game.emit('monsterJagd', { x: Math.round(M.x), y: Math.round(M.y) });
    M.z = 'jagd'; M.verlust = 0; M.letzte = { x: t.x, y: t.y };
  } else if (M.z === 'jagd') {
    M.verlust += dt;
    if (M.verlust >= c.verlustZeit) { M.z = 'suche'; M.suche = c.sucheZeit; M.pfad = []; M.ziel = null; }
  }
  if (M.z !== 'jagd' && M.laerm && game.time - M.laerm.t < 1.5 && Math.hypot(M.laerm.x - M.x, M.laerm.y - M.y) <= M.laerm.w * 3) {
    // frischer Lärm: dorthin (jede Stelle, die das Monster einnehmen kann, in der Nähe)
    if (M.z !== 'laerm' || M.laermT !== M.laerm.t) { M.z = 'laerm'; M.laermT = M.laerm.t; M.replan = 0; }
  }
  let speed = c.speedPatrouille;
  if (M.z === 'jagd') {
    speed = c.speedJagd;
    if (M.letzte && (M.replan <= 0 || !M.pfad.length)) {
      const a = Mon.naechster(m, Math.floor(M.letzte.x / TILE), Math.floor(M.letzte.y / TILE), 3);
      if (a) {
        setzePfad(M, m, a); M.replan = c.replan;
        // Spieler im Kriechgang/unerreichbar: das Monster steht davor und tobt (Pfad leer), bleibt aber in der Jagd bis der Spieler verschwindet
      }
    }
  } else if (M.z === 'laerm') {
    speed = c.speedSuche;
    if (M.replan <= 0 && M.laerm) {
      const a = Mon.naechster(m, Math.floor(M.laerm.x / TILE), Math.floor(M.laerm.y / TILE), 4);
      if (a) setzePfad(M, m, a); M.replan = 1;
    }
    if (!M.pfad.length && !M.ramm) { M.z = 'suche'; M.suche = c.sucheZeit; }
  } else if (M.z === 'suche') {
    speed = c.speedSuche;
    if (!M.pfad.length && M.replan <= 0 && m.geht) {   // um den letzten Ort herumstreifen
      const a = nahZufall(game, m, M, 6); if (a) setzePfad(M, m, a); M.replan = 1.2;
    }
    if (M.suche <= 0) { M.z = 'patrouille'; M.pfad = []; }
  } else {   // patrouille: von Raum zu Raum, nie stehen bleiben (ununterbrochen aktive Gefahr)
    speed = c.speedPatrouille;
    if (!M.pfad.length && !M.ramm) {
      M.wait -= dt;
      if (M.wait <= 0) {
        const cand = M.ziele.filter((a) => Math.hypot(a.cx * TILE - M.x, a.cy * TILE - M.y) > 6 * TILE);
        const pool = cand.length ? cand : M.ziele;
        const a = game.rng.pick(pool);
        if (a) setzePfad(M, m, a); M.wait = 1.2;
      }
    }
  }
  gehen(game, E, M, dt, speed);
  // Anti-Hängen: bewegt es sich 3 s nicht, obwohl es sollte -> neu planen; dann auf den nächsten Ankerpunkt setzen
  if (M.pfad.length || M.ramm) {
    if (Math.hypot(M.x - M.ref.x, M.y - M.ref.y) > 6) { M.ref = { x: M.x, y: M.y }; M.stuckT = 0; }
    else {
      M.stuckT += dt;
      if (M.stuckT >= 3 && !M.ramm) { M.pfad = []; M.ziel = null; M.replan = 0; if (M.stuckT >= 6) { const a = Mon.naechster(m, Math.floor(M.x / TILE), Math.floor(M.y / TILE), 3); if (a) { const p = Mon.mitte(a); M.x = p.x; M.y = p.y; } M.stuckT = 0; } }
    }
  } else { M.stuckT = 0; M.ref = { x: M.x, y: M.y }; }
}
function nahZufall(game, m, M, r) {
  const base = Mon.ankerVon(M.letzte ? M.letzte.x : (M.laerm ? M.laerm.x : M.x), M.letzte ? M.letzte.y : (M.laerm ? M.laerm.y : M.y));
  const rnd = () => game.rng();
  for (let i = 0; i < 12; i++) {
    const cx = base.cx + Math.round((rnd() * 2 - 1) * r), cy = base.cy + Math.round((rnd() * 2 - 1) * r);
    if (m.geht(cx, cy)) return { cx, cy };
  }
  return null;
}

// ---------- Anzeige ----------
const Z = { patrouille: 'p', laerm: 'l', suche: 's', jagd: 'j' };
function snap(game) {
  const aw = game.away; const M = aw && aw.monster; if (!M) return null;
  const o = { x: r1(M.x), y: r1(M.y), z: Z[M.z] || 'p', f: Math.round(M.facing * 100) / 100 };
  if (M.ramm) o.r = 1;
  if (M.pause > 0) o.h = 1;
  return o;
}
// Captain: welches Pult als Nächstes dran ist (Kachel) und wie viele fertig sind
function pulteSnap(game) {
  const aw = game.away; const P = aw && aw.monsterPulte; if (!P) return null;
  const next = P.order[P.erledigt];
  const pos = next ? P.pos[next] : null;
  return { n: P.erledigt, t: P.order.length, id: next || null, x: pos ? pos[0] : null, y: pos ? pos[1] : null };
}
// alle Außenteam-Mitglieder am Boden? (Regiebuch team_alle_verwundet: Szene wiederholt sich)
function alleVerwundet(game) {
  const t = game.players.filter((p) => p.zone === 'away' && p.connected !== false);
  return t.length > 0 && t.every((p) => p.downed);
}
// Szene von vorn (Regiebuch monster_zuruecksetzen): Monster und Pulte zurück auf Anfang; einrichten() legt sie beim nächsten Tick neu an
function zuruecksetzen(game) {
  let n = 0;
  for (const [id, aw] of Object.entries(game.aways || {})) {
    if (!aw || aw.monster === undefined) continue;
    const k = game.karteOf ? game.karteOf(id) : null;
    if (k) for (const a of k.anker || []) if (a.rolle === 'terminal') Anker.setzen(game, id, a.id, 'bereit', null, { still: true });
    aw.monster = undefined; aw.monsterPulte = undefined; n++;
  }
  return n;
}
function pulteFertig(game) { const P = game.away && game.away.monsterPulte; return !!(P && P.fertig); }
function pulteErledigt(game) { const P = game.away && game.away.monsterPulte; return P ? P.erledigt : 0; }

module.exports = { einrichten, zuruecksetzen, update, laerm, snap, pulteSnap, alleVerwundet, pulteFertig, pulteErledigt, maskeVon, STANDARD };
