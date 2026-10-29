'use strict';
// SL6: Zonen mit Wirkung auf dem Server (CONCEPT-SL6 §2.1). Regeln stehen in shared/zonen.js; hier wirken sie auf ALLE Körper der Szene:
// Lerche, Gegner (auch Transporter des Konvois) und Schützlinge. Eine Funktion, ein Tick-Aufruf (space.update) – kein Flag an stepBody.
//
//   Drift     Positionsversatz NACH dem Flugmodell (stepBody regelt Geschwindigkeit sonst weg). Nettotempo = Schiff + Drift: Stufe 4 gegen
//             ein starkes Feld funktioniert von selbst, Gegner steuern nicht gegen und treiben mit (gleiche Regel für alle).
//   Hitze     Lerche: Zonenhitze je Sekunde auf Antrieb/Schilde (config zonen.hitzeSysteme, ab Energie zonen.hitzeMinEnergie). Gegner haben keine Hitze.
//   Schaden   sammelt sich je Körper und kommt jede `zonen.takt` s als ganze Punkte an (Lerche: shipHit, Gegner: damageEnemy – Schilde wirken wie bei jedem Treffer).
//   Sicht     sichtFaktor(game) – space.nebelFaktor multipliziert ihn auf Sensor-/Erfassungsreichweite der Lerche (Gegner sehen wie bisher).
//   Zug       Gravitation zur Mitte (zone.zug, px/s) als Positionsversatz wie die Drift: Nettotempo nach außen = Schiffstempo − Zug (Höhe halten, U2).
//   Ertrag    'zaehler:<id>' zählt game.zonenSim.zaehler[id] (z. B. Boje) von selbst. 'fracht:<art>' (Gasriese) füllt die Ladung NICHT von selbst:
//             die Ops startet das Schöpfen (weapons.schoepfen, Halteprozess in server/sim/ladung.js); nur dort, in der Ertragszone, läuft es.
// Szenen ohne `scene.zonen` kosten einen Array-Zugriff, Verhalten bleibt bitgleich (Eisenwald, Golden).
const Zonen = require('../../shared/zonen.js');
const Locations = require('../../shared/locations.js');
const Physics = require('../../shared/physics.js');

let spaceMod = null, escortMod = null;
const space = () => spaceMod || (spaceMod = require('./space.js'));
const escort = () => escortMod || (escortMod = require('./escort.js'));

const KEINE = Object.freeze([]);
// aus = abgeschaltete Schaltgruppen (zone_schalten; scene.zonenAus gilt beim Betreten der Szene), alle = für alle sichtbar freigegeben (Feldkarte, zone_sichtbar),
// scanT = laufender Ops-Scan der Verzerrungen, ruT = Sperre für das nächste Rücksetzen (s)
function neu() { return { bekannt: new Set(), zaehler: {}, akk: {}, in: [], t: 0, szene: null, aus: new Set(), alle: new Set(), scan: null, ruT: 0 }; }
function state(game) { return game.zonenSim || (game.zonenSim = neu()); }

function szeneZonenAlle(game) {
  const loc = Locations.get(game.ship.scene);
  const z = loc && loc.scene && loc.scene.zonen;
  return Array.isArray(z) && z.length ? z : KEINE;
}
// wirksame Zonen der Szene (abgeschaltete Gruppen fehlen); ohne Abschaltung dieselbe Liste
let filterCache = { src: null, aus: '', out: null };
function szeneZonen(game) {
  const zs = szeneZonenAlle(game);
  if (zs === KEINE) return zs;
  const S = game.zonenSim;
  if (!S || !S.aus.size) return zs;
  const key = [...S.aus].sort().join(',');
  if (filterCache.src !== zs || filterCache.aus !== key) filterCache = { src: zs, aus: key, out: zs.filter((z) => !(z.gruppe && S.aus.has(z.gruppe))) };
  return filterCache.out;
}

// Sichtfaktor der Lerche (1 ohne Zone)
function sichtFaktor(game) {
  const zs = szeneZonen(game);
  if (zs === KEINE) return 1;
  return Zonen.wirkung(zs, game.ship.x, game.ship.y).sicht;
}

// Schaltgruppe ein-/ausschalten (Regiebuch zone_schalten, z. B. Haltefeld der Forschungsstation im Finale)
function schalten(game, gruppe, an) {
  const S = state(game); const vorher = S.aus.has(gruppe);
  if (an) S.aus.delete(gruppe); else S.aus.add(gruppe);
  if (vorher === !an) return false;
  game.missionEvent('zonenGeschaltet', { gruppe, an: !!an });
  return true;
}
// Zonen (einer Gruppe, sonst alle der Szene) für alle sichtbar machen bzw. wieder zurücknehmen (Feldkarte)
function sichtbarMachen(game, gruppe, fuerAlle) {
  const S = state(game); let n = 0;
  for (const z of szeneZonenAlle(game)) {
    if (gruppe && gruppe !== 'alle' && z.gruppe !== gruppe) continue;
    if (fuerAlle) { if (!S.alle.has(z.id)) { S.alle.add(z.id); n++; } } else if (S.alle.delete(z.id)) n++;
  }
  if (n) game.missionEvent('zonenSichtbar', { gruppe: gruppe || 'alle', alle: !!fuerAlle });
  return n;
}
function istAus(game, gruppe) { return state(game).aus.has(gruppe); }

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
  for (const z of szeneZonen(game)) {   // nur wirksame Zonen: ein noch abgeschaltetes Haltefeld verrät der Scan nicht
    if (S.bekannt.has(z.id)) continue;
    const reichweite = Math.hypot(sh.x - z.x, sh.y - z.y) - (z.r1 || z.r || Math.max(z.w || 0, z.h || 0) / 2);
    if (reichweite <= (r || 0)) { S.bekannt.add(z.id); n++; }
  }
  if (n) game.missionEvent('zonenBekannt', { n });
  return n;
}

function zaehler(game, id) { return state(game).zaehler[id] || 0; }
function zaehlerSetzen(game, id, v) { state(game).zaehler[id] = Math.max(0, Number(v) || 0); }

// ---- Ops-Scan der Verzerrungen (weapons.zonenscan, Halten): macht Zonen im Umkreis bekannt (Pfeil und Stärke auf der Ops-Karte) ----
const scanR = (game) => Number(game.C.zonen && game.C.zonen.scanR) || 900;
const scanZeit = (game) => Number(game.C.zonen && game.C.zonen.scanZeit) || 3;
function scanNoetig(game) {   // noch unbekannte Zonen in Reichweite?
  const S = state(game); const sh = game.ship;
  return szeneZonen(game).some((z) => !S.bekannt.has(z.id) && Math.hypot(sh.x - z.x, sh.y - z.y) - (z.r1 || z.r || Math.max(z.w || 0, z.h || 0) / 2) <= scanR(game));
}
function scanStarten(game, p) {
  const S = state(game);
  if (S.scan) return 'Zonen-Scan läuft bereits.';
  if (game.ship.docked) return 'Angedockt – kein Zonen-Scan.';
  if (szeneZonen(game) === KEINE) return 'Hier gibt es keine Verzerrungen zu scannen.';
  if (!scanNoetig(game)) return 'Alle Zonen in Reichweite sind schon gescannt.';
  S.scan = { t: 0, dur: scanZeit(game) };
  game.emit('zonenScan', { phase: 'start', dur: S.scan.dur });
  return null;
}
function scanAbbrechen(game) { const S = state(game); if (!S.scan) return false; S.scan = null; game.emit('zonenScan', { phase: 'abbruch' }); return true; }
function scanTick(game, S, dt) {
  if (!S.scan) return;
  const Station = require('./station.js');
  if (!game.players.some((p) => p.connected && Station.stationOf(p) === 'weapons' && !p.downed)) return void scanAbbrechen(game);
  S.scan.t += dt;
  if (S.scan.t < S.scan.dur) return;
  S.scan = null;
  const n = scan(game, scanR(game));
  game.emit('zonenScan', { phase: 'fertig', n });
  if (n) game.oda(`Zonen-Scan: ${n} Verzerrung${n === 1 ? '' : 'en'} erfasst – Stärke und Richtung stehen auf der Ops-Karte.`, null);
}

function klemmen(body, sp, m) {
  if (body.x < m) body.x = m; if (body.x > sp.w - m) body.x = sp.w - m;
  if (body.y < m) body.y = m; if (body.y > sp.h - m) body.y = sp.h - m;
}

function update(game, dt) {
  const S = state(game);
  const sh = game.ship; const sp = game.space;
  if (S.szene !== sh.scene) {
    S.szene = sh.scene; S.akk = {}; S.in = []; S.scan = null; S.alle = new Set();
    const loc0 = Locations.get(sh.scene); const aus = loc0 && loc0.scene && loc0.scene.zonenAus;
    S.aus = new Set(Array.isArray(aus) ? aus : []);   // scene.zonenAus: Gruppen, die erst ein Regiebuch einschaltet (Haltefeld im Finale)
  }
  S.ruT = Math.max(0, S.ruT - dt);
  const zs = szeneZonen(game);
  if (zs === KEINE) { if (S.in.length) S.in = []; return; }
  scanTick(game, S, dt);
  const C = game.C.zonen || { takt: 1, hitzeSysteme: ['engines', 'shields'], hitzeMinEnergie: 3 };
  S.t += dt;
  const tackt = S.t >= C.takt;   // Schaden-Takt (alle Körper gleichzeitig)
  if (tackt) S.t -= C.takt;

  // ---- Lerche ----
  if (!sh.docked) {
    const w = Zonen.wirkung(zs, sh.x, sh.y);
    if (w.vx || w.vy) { sh.x += w.vx * dt; sh.y += w.vy * dt; klemmen(sh, sp, 40); }
    // Erkunden: wer in eine Zone fliegt, kennt sie ab dann
    // (ops_scan-Zonen, die Gravimetrie, kennt nur der Scan der Ops – das Hineinfliegen verrät sie nicht)
    const neuBekannt = w.ids.filter((id) => !S.bekannt.has(id) && (zs.find((q) => q.id === id) || {}).sichtbarFuer !== 'ops_scan');
    if (neuBekannt.length) {
      for (const id of neuBekannt) S.bekannt.add(id);
      const z = zs.find((q) => q.id === neuBekannt[0]);
      game.missionEvent('zoneBetreten', { id: neuBekannt[0], name: z && z.name || null, ids: neuBekannt });
      if (z && z.name) game.oda(`${z.name}: ${beschreibung(z)}`, 'zone_' + z.id);
    }
    S.in = w.ids;
    // Rücksetzen (Verzerrungskern): zurück zum Rücksetzpunkt, Fahrt weg, Systeme und Hülle bleiben wie sie sind (kein Tod, Kai)
    if (w.rueck && S.ruT <= 0) {
      sh.x = w.rueck.x; sh.y = w.rueck.y; sh.vx = 0; sh.vy = 0; sh.speed = 0; sh.turnVel = 0; S.in = []; S.ruT = 1.5;
      game.emit('sfx', { name: 'dodge' });
      game.oda('Verzerrungskern! Das Schiff wird zurückgeworfen – Kurs neu abstimmen.', 'zone_rueck');
      game.missionEvent('zoneRuecksetzen', { zone: w.rueck.id });
    }
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
      if (art === 'zaehler') S.zaehler[ziel] = (S.zaehler[ziel] || 0) + e.rate * dt;
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
          try { escort().hit(game, es, pts, es.ally ? { light: true, von: { x: w.mx, y: w.my } } : { light: true }); } catch (err) { if (game.countError) game.countError('zonen-escort', err); }
        }
      }
    }
  }
}

// Dauerdruck der Zone auf die Lerche (SYS-01 A1b): erst der Schild des Sektors, bei Schild 0 trifft der Rest per Trefferweg ein System des Sektors.
// Bewusst KEIN shipHit und KEIN Feuer: Dauerdruck ist kein Beschuss. Der Systemtreffer meldet sich wie jeder andere (systemSchaden, ein Rückschlag je Takt).
function druck(game, sector, pts) {
  const sh = game.ship.shields; let rest = pts;
  const cur = (sh.current && sh.current[sector]) || 0;
  const absorb = Math.min(cur, rest);
  if (absorb > 0) { sh.current[sector] = cur - absorb; rest -= absorb; if (sh.regenT != null) sh.regenT = 0; }
  if (rest > 0) {
    const D = require('./damage.js'); const M = game.C.systemModell || {};
    D.systemSchaden(game, { systems: [] }, sector, rest * (Number(M.schadenFaktor) || 1), { dauer: true });   // Dauerdruck bricht kein Schöpfen/Beamen ab (wie bisher)
  }
  game.stats.hits++;
  game.emit('hit', rest > 0 ? { sector, shield: false, dmg: Math.round(rest * 10) / 10, heavy: false, absorbed: absorb } : { sector, shield: true, dmg: pts, heavy: false, absorbed: absorb });
  game.emit('sfx', { name: rest > 0 ? 'hull_hit' : 'shield_hit' });
  if (cur > 0 && sh.current[sector] <= 0) game.missionEvent('shieldDown', { sector });
  if (rest > 0) game.missionEvent('hullHit', { sector });
}

// U2 (SYS-01 A1a): das Auftauchen bei Hüllenverlust entfällt mit der Hülle; ein Tod durch Zonenschaden gibt es in A1a nicht mehr.

function beschreibung(z) {
  const t = [];
  if (z.sicht != null && z.sicht < 1) t.push('Sicht schlechter');
  if (z.hitze) t.push('Hitze');
  if (z.schaden) t.push('Druck auf die Systeme');
  if (z.drift || z.tang) t.push('Strömung zieht am Schiff');
  if (z.zug) t.push('Sog nach innen');
  if (z.ertrag && String(z.ertrag.ziel).startsWith('fracht:')) t.push('Schöpfen mit der Ops möglich');
  else if (z.ertrag) t.push('hier lässt sich schöpfen');
  return t.length ? t.join(', ') + '.' : 'betreten.';
}

// Snapshot (klein): nur in Szenen mit Zonen. in = Zonen der Lerche, bk = bekannte Zonen-IDs, z = Zähler (gerundet)
function snapshot(game) {
  const zs = szeneZonen(game);
  if (zs === KEINE) return null;
  const S = state(game);
  const out = { in: S.in.slice(), bk: [...S.bekannt].filter((id) => zs.some((z) => z.id === id)) };
  if (S.aus.size) out.au = [...S.aus].sort();                  // abgeschaltete Schaltgruppen (Client zeichnet sie nicht)
  if (S.alle.size) out.sv = [...S.alle].sort();                // für alle sichtbar (Feldkarte)
  if (S.scan) out.sc = Math.round(Math.min(1, S.scan.t / S.scan.dur) * 100) / 100;   // Fortschritt des Ops-Scans
  else if (zs.some((z) => z.sichtbarFuer === 'ops_scan') && scanNoetig(game)) out.sn = 1;   // es gibt etwas zu scannen
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

module.exports = { neu, state, update, sichtFaktor, bekanntMachen, istBekannt, scan, scanStarten, scanAbbrechen, schalten, sichtbarMachen, istAus, zaehler, zaehlerSetzen, snapshot, toSave, restore, szeneZonen, szeneZonenAlle };
