'use strict';
// SL6: Zonen mit Wirkung auf dem Server (CONCEPT-SL6 §2.1). Regeln stehen in shared/zonen.js; hier wirken sie auf ALLE Körper der Szene:
// Lerche, Gegner (auch Transporter des Konvois) und Schützlinge. Eine Funktion, ein Tick-Aufruf (space.update) – kein Flag an stepBody.
//
//   Drift     Positionsversatz NACH dem Flugmodell (stepBody regelt Geschwindigkeit sonst weg). Nettotempo = Schiff + Drift: Stufe 4 gegen
//             ein starkes Feld funktioniert von selbst, Gegner steuern nicht gegen und treiben mit (gleiche Regel für alle).
//   Hitze     Lerche: Zonenhitze je Sekunde auf Antrieb/Schilde (config zonen.hitzeSysteme, ab Energie zonen.hitzeMinEnergie). Gegner haben keine Hitze.
//   Schaden   sammelt sich je Körper und kommt jede `zonen.takt` s als ganze Punkte an (Lerche: shipHit, Gegner: damageEnemy – Schilde wirken wie bei jedem Treffer).
//   Sicht     sichtFaktor(game) – space.nebelFaktor multipliziert ihn auf Sensor-/Erfassungsreichweite der Lerche (Gegner sehen wie bisher).
//   Ertrag    Lerche in einer Ertragszone: 'fracht:<art>' füllt Ladung (server/sim/ladung.js), 'zaehler:<id>' zählt game.zonenSim.zaehler[id] (z. B. Boje).
// Szenen ohne `scene.zonen` kosten einen Array-Zugriff, Verhalten bleibt bitgleich (Eisenwald, Golden).
const Zonen = require('../../shared/zonen.js');
const Locations = require('../../shared/locations.js');
const Physics = require('../../shared/physics.js');

let spaceMod = null, escortMod = null, ladungMod = null;
const space = () => spaceMod || (spaceMod = require('./space.js'));
const escort = () => escortMod || (escortMod = require('./escort.js'));
const ladung = () => ladungMod || (ladungMod = require('./ladung.js'));

const KEINE = Object.freeze([]);
function neu() { return { bekannt: new Set(), zaehler: {}, akk: {}, in: [], t: 0, szene: null }; }
function state(game) { return game.zonenSim || (game.zonenSim = neu()); }

function szeneZonen(game) {
  const loc = Locations.get(game.ship.scene);
  const z = loc && loc.scene && loc.scene.zonen;
  return Array.isArray(z) && z.length ? z : KEINE;
}

// Sichtfaktor der Lerche (1 ohne Zone)
function sichtFaktor(game) {
  const zs = szeneZonen(game);
  if (zs === KEINE) return 1;
  return Zonen.wirkung(zs, game.ship.x, game.ship.y).sicht;
}

// Zonen als erkundet markieren (Flug hinein, Sonde, Scan). ids: Liste | 'alle'. Gibt die Zahl neu bekannter Zonen zurück.
function bekanntMachen(game, ids) {
  const S = state(game); const zs = szeneZonen(game);
  let n = 0;
  for (const z of zs) {
    if (ids !== 'alle' && !(ids || []).includes(z.id)) continue;
    if (!S.bekannt.has(z.id)) { S.bekannt.add(z.id); n++; }
  }
  if (n) game.missionEvent('zonenBekannt', { n, ids: ids === 'alle' ? 'alle' : ids });
  return n;
}
function istBekannt(game, id) { return state(game).bekannt.has(id); }

// Ops-Scan (SL7a): alle Zonen der Szene im Umkreis r um die Lerche werden bekannt (Stärke/Richtung für die Taktikkarte)
function scan(game, r) {
  const S = state(game); const sh = game.ship; let n = 0;
  for (const z of szeneZonen(game)) {
    if (S.bekannt.has(z.id)) continue;
    const reichweite = Math.hypot(sh.x - z.x, sh.y - z.y) - (z.r1 || z.r || Math.max(z.w || 0, z.h || 0) / 2);
    if (reichweite <= (r || 0)) { S.bekannt.add(z.id); n++; }
  }
  if (n) game.missionEvent('zonenBekannt', { n });
  return n;
}

function zaehler(game, id) { return state(game).zaehler[id] || 0; }
function zaehlerSetzen(game, id, v) { state(game).zaehler[id] = Math.max(0, Number(v) || 0); }

function klemmen(body, sp, m) {
  if (body.x < m) body.x = m; if (body.x > sp.w - m) body.x = sp.w - m;
  if (body.y < m) body.y = m; if (body.y > sp.h - m) body.y = sp.h - m;
}

function update(game, dt) {
  const S = state(game);
  const sh = game.ship; const sp = game.space;
  if (S.szene !== sh.scene) { S.szene = sh.scene; S.akk = {}; S.in = []; }
  const zs = szeneZonen(game);
  if (zs === KEINE) { if (S.in.length) S.in = []; return; }
  const C = game.C.zonen || { takt: 1, hitzeSysteme: ['engines', 'shields'], hitzeMinEnergie: 3 };
  S.t += dt;
  const tackt = S.t >= C.takt;   // Schaden-Takt (alle Körper gleichzeitig)
  if (tackt) S.t -= C.takt;

  // ---- Lerche ----
  if (!sh.docked) {
    const w = Zonen.wirkung(zs, sh.x, sh.y);
    if (w.vx || w.vy) { sh.x += w.vx * dt; sh.y += w.vy * dt; klemmen(sh, sp, 40); }
    // Erkunden: wer in eine Zone fliegt, kennt sie ab dann
    const neuBekannt = w.ids.filter((id) => !S.bekannt.has(id));
    if (neuBekannt.length) {
      for (const id of neuBekannt) S.bekannt.add(id);
      const z = zs.find((q) => q.id === neuBekannt[0]);
      game.missionEvent('zoneBetreten', { id: neuBekannt[0], name: z && z.name || null, ids: neuBekannt });
      if (z && z.name) game.oda(`${z.name}: ${beschreibung(z)}`, 'zone_' + z.id);
    }
    S.in = w.ids;
    if (w.hitze) for (const k of C.hitzeSysteme) if (sh.power[k] >= C.hitzeMinEnergie) sh.heat[k] += w.hitze * dt;
    if (w.schaden) {
      S.akk.L = (S.akk.L || 0) + w.schaden * dt;
      if (tackt && S.akk.L >= 1) {
        const pts = Math.floor(S.akk.L); S.akk.L -= pts;
        const sector = w.mx != null ? Physics.sectorOf(sh.x, sh.y, sh.angle, w.mx, w.my) : 0;
        druck(game, sector, pts);
        game.missionEvent('zoneSchaden', { n: pts });
      }
    }
    for (const e of w.ertrag) {
      const [art, ziel] = [e.ziel.slice(0, e.ziel.indexOf(':')), e.ziel.slice(e.ziel.indexOf(':') + 1)];
      if (art === 'fracht') ladung().schoepfen(game, ziel, e.rate, dt);
      else if (art === 'zaehler') S.zaehler[ziel] = (S.zaehler[ziel] || 0) + e.rate * dt;
    }
  } else if (S.in.length) S.in = [];

  // ---- Gegner und Schützlinge: gleiche Regeln (Drift, Schaden) ----
  for (const e of sp.enemies) {
    if (e.kind === 'pylon' || e.leaving) continue;   // Pylonen stehen fest
    const w = Zonen.wirkung(zs, e.x, e.y);
    if (!w.vx && !w.vy && !w.schaden) continue;
    if (w.vx || w.vy) { e.x += w.vx * dt; e.y += w.vy * dt; klemmen(e, sp, 30); }
    if (w.schaden) {
      const k = 'e' + e.id;
      S.akk[k] = (S.akk[k] || 0) + w.schaden * dt;
      if (tackt && S.akk[k] >= 1) {
        const pts = Math.floor(S.akk[k]); S.akk[k] -= pts;
        space().damageEnemy(game, e, pts, w.mx, w.my, {});
      }
    }
  }
  if (sp.escorts && sp.escorts.length) {
    for (const es of sp.escorts) {
      const w = Zonen.wirkung(zs, es.x, es.y);
      if (w.vx || w.vy) { es.x += w.vx * dt; es.y += w.vy * dt; klemmen(es, sp, 30); }
      if (w.schaden) {
        const k = 's' + es.id;
        S.akk[k] = (S.akk[k] || 0) + w.schaden * dt;
        if (tackt && S.akk[k] >= 1) {
          const pts = Math.floor(S.akk[k]); S.akk[k] -= pts;
          try { escort().hit(game, es, pts, { light: true }); } catch (err) { if (game.countError) game.countError('zonen-escort', err); }
        }
      }
    }
  }
}

// Dauerdruck der Zone auf die Lerche: erst der Schildsektor zur Zone, der Rest geht als Hüllenschaden durch (5 je Punkt wie damage.js).
// Bewusst KEIN shipHit: Dauerdruck würfelt keine Systemausfälle, Feuer oder Lecks (das macht nur Beschuss); die Technik hat mit Hitze genug zu tun.
function druck(game, sector, pts) {
  const sh = game.ship.shields; let rest = pts;
  const cur = (sh.current && sh.current[sector]) || 0;
  const absorb = Math.min(cur, rest);
  if (absorb > 0) { sh.current[sector] = cur - absorb; rest -= absorb; if (sh.regenT != null) sh.regenT = 0; }
  const hull = rest > 0 ? 5 * rest : 0;
  if (hull > 0 && !game.god) game.ship.hull = Math.max(0, game.ship.hull - hull);
  game.stats.hits++;
  game.emit('hit', hull > 0 ? { sector, shield: false, dmg: Math.round(hull / 5 * 10) / 10, heavy: false, absorbed: absorb, hull } : { sector, shield: true, dmg: pts, heavy: false, absorbed: absorb });
  game.emit('sfx', { name: hull > 0 ? 'hull_hit' : 'shield_hit' });
  if (cur > 0 && sh.current[sector] <= 0) game.missionEvent('shieldDown', { sector });
  if (hull > 0) game.missionEvent('hullHit', { sector });
}

function beschreibung(z) {
  const t = [];
  if (z.sicht != null && z.sicht < 1) t.push('Sicht schlechter');
  if (z.hitze) t.push('Hitze');
  if (z.schaden) t.push('Druck auf die Hülle');
  if (z.drift || z.tang) t.push('Strömung zieht am Schiff');
  if (z.ertrag) t.push('hier lässt sich schöpfen');
  return t.length ? t.join(', ') + '.' : 'betreten.';
}

// Snapshot (klein): nur in Szenen mit Zonen. in = Zonen der Lerche, bk = bekannte Zonen-IDs, z = Zähler (gerundet)
function snapshot(game) {
  const zs = szeneZonen(game);
  if (zs === KEINE) return null;
  const S = state(game);
  const out = { in: S.in.slice(), bk: [...S.bekannt].filter((id) => zs.some((z) => z.id === id)) };
  const zk = Object.keys(S.zaehler); if (zk.length) { out.z = {}; for (const k of zk) out.z[k] = Math.round(S.zaehler[k] * 10) / 10; }
  return out;
}

// Weltstand: bekannte Zonen und Zähler (klein)
function toSave(game) {
  const S = game.zonenSim; if (!S) return null;
  const bk = [...S.bekannt]; const zk = Object.keys(S.zaehler).filter((k) => S.zaehler[k] > 0);
  return bk.length || zk.length ? { bekannt: bk.sort(), zaehler: Object.fromEntries(zk.map((k) => [k, Math.round(S.zaehler[k] * 10) / 10])) } : null;
}
function restore(game, o) {
  const S = state(game); S.bekannt = new Set(); S.zaehler = {}; S.akk = {};
  if (!o || typeof o !== 'object') return;
  for (const id of Array.isArray(o.bekannt) ? o.bekannt : []) if (typeof id === 'string') S.bekannt.add(id);
  for (const [k, v] of Object.entries(o.zaehler || {})) if (Number.isFinite(v)) S.zaehler[k] = v;
}

module.exports = { neu, state, update, sichtFaktor, bekanntMachen, istBekannt, scan, zaehler, zaehlerSetzen, snapshot, toSave, restore, szeneZonen };
