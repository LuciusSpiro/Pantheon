'use strict';
// S2 (CONTRACT-S2 §6, Team BAUSTEINE): Bausteine außerhalb des Raumkampfs als Registry-Plugin.
//   map_reset        { map*, grund, fund?, datenkern?, neuer_seed? }  Außenkarte zurück auf Anfang (Handkarten; B1: gebaute Karten -> Zustände des Landepunkts), ODA + Logbuch
//   spawn_person     { map*, person*, name?, verletzt?, anker? }  NSC-Person am NSC-Anker der Karte (verallgemeinerter Ivo)
//   person_rescued   { map*, person* }                   Person ist hochgebeamt (Ereignis npcRescued { person, name, map })
//   person_state     { map*, person*, state* }           injured | ok | following | rescued
//   purchased        { item?, min?, ctx? }               Käufe am Hafenterminal in der laufenden Mission (Ereignis bought)
//   ship_near        { dist, loc?, x?, y? }              Schiff höchstens dist px von der Station (bzw. Punkt) des Orts
//   ship_hold_position { dist, sec, loc?, x?, y? }       wie ship_near, aber seit sec Sekunden ununterbrochen (halten)
//   debug_rescue_person { name } (intern)                Person sofort als gerettet werten (skip)
// Schwere Module erst beim Aufruf laden (describe() und der Prüfer laufen ohne Server).
const Maps = require('../../../shared/maps.js');
const Locations = require('../../../shared/locations.js');
const Objects = require('../objects.js');

let mods = {};
const lazy = (name, p) => () => mods[name] || (mods[name] = require(p));
const away = lazy('away', '../../sim/away.js');
const world = lazy('world', '../../world.js');

const MAPS = ['platform', 'wreck', 'kesh'];
const txt = (m, t) => (t == null ? t : m.tpl(t));
const oda120 = (s) => (s.length <= 120 ? s : s.slice(0, 119) + '…');

// ---------- Anker -> begehbare, von den Pads erreichbare Kachel ----------
// anker: Bereich (Maps.MAP_AREAS), Objekt (Maps.MAP_OBJECTS), "x,y" (Kachel) oder "start" (B-7: Ivos alter Platz).
// Türen/Wände, die sich im Spiel öffnen (opensWhen), zählen als passierbar – eine Person darf hinter der Sondentür warten.
function anchorTile(map, anker) {
  const W = world();
  const info = W.AWAY_MAPS[map];
  if (!info) return null;
  const mp = info.map;
  const passable = (x, y) => { const i = mp.info(x, y); return !i.solid || !!i.opensWhen; };
  const standable = (x, y) => !mp.solid(x, y) && mp.info(x, y).kind !== 'pad';
  let target = null; let inside = null;
  const a = String(anker == null ? '' : anker);
  const area = (Maps.MAP_AREAS[map] || {})[a];
  if (area) {
    inside = (x, y) => Maps.inArea(map, a, x, y);
    target = area.rect ? { x: area.rect[0] + (area.rect[2] - 1) / 2, y: area.rect[1] + (area.rect[3] - 1) / 2 }
      : { x: (area.cols[0] + area.cols[1]) / 2, y: mp.h / 2 };
  } else if (Objects.declared(map)[a]) {
    const t = Objects.tilesOf(map, a)[0];
    if (t) target = { x: t.x, y: t.y };
  } else if (/^\d+\s*,\s*\d+$/.test(a)) {
    const [x, y] = a.split(',').map(Number);
    target = { x, y };
  } else if (a === 'start' && map === 'platform') target = { x: W.NPC_SPAWN.x, y: W.NPC_SPAWN.y };
  if (!target) return null;
  // Erst ohne verschlossene Türen/Wände suchen; nur wenn der Bereich so nicht erreichbar ist, dahinter (kernraum, hohlraum)
  const open = pick(mp, info, (x, y) => !mp.solid(x, y), standable, target, inside);
  if (open && (!inside || open.inside)) return open.tile;
  const behind = pick(mp, info, passable, standable, target, inside);
  return behind && (!inside || behind.inside) ? behind.tile : null;
}
function pick(mp, info, passable, standable, target, inside) {
  // BFS von den Pads über passierbare Kacheln
  const seen = new Set(); const q = [];
  for (const p of info.pads) { const k = p.y * mp.w + p.x; if (!seen.has(k)) { seen.add(k); q.push(p); } }
  let best = null; let bestD = Infinity; let bestIn = false;
  while (q.length) {
    const c = q.shift();
    if (standable(c.x, c.y)) {
      const isIn = inside ? inside(c.x, c.y) : false;
      const d = Math.hypot(c.x - target.x, c.y - target.y);
      if ((isIn && !bestIn) || (isIn === bestIn && d < bestD)) { best = { x: c.x, y: c.y }; bestD = d; bestIn = isIn; }
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= mp.w || ny >= mp.h) continue;
      const k = ny * mp.w + nx;
      if (seen.has(k) || !passable(nx, ny)) continue;
      seen.add(k); q.push({ x: nx, y: ny });
    }
  }
  return best ? { tile: best, inside: bestIn } : null;
}

// ---------- B1 Nachauftrag: Personen und Reset auf gebauten Karten ----------
const isHandMap = (map) => MAPS.includes(map);
// Kachel einer Person auf einer gebauten Karte: Anker (Rolle oder ID) bzw. nsc, dann zelle; n = laufende Nummer (mehrere Personen)
function personTile(g, map, anker, n) {
  let list = anker ? Objects.resolveAnker(g, map, String(anker)) : [];
  if (!list.length) list = Objects.resolveAnker(g, map, 'nsc').concat(Objects.resolveAnker(g, map, 'zelle'));
  if (!list.length) return null;
  const a = list[n % list.length];
  return { x: a.x, y: a.y, anker: a.id };
}
// Mehrere Personen je gebauter Karte (W2 AP6, E6): Die Laufzeit (away.js) führt bis CONFIG.personen.maxGleichzeitig offene
// Personen je Karte; weitere warten in aw.personen und rücken in freie Plätze nach, sobald eine gerettet ist (game.js ruft
// personenNachruecken jeden Tick).
function personenNachruecken(g) {
  for (const [map, aw] of Object.entries(g.aways || {})) {
    if (!aw || !Array.isArray(aw.personen) || !aw.personen.length || isHandMap(map)) continue;
    while (aw.personen.length && away().personPlatzFrei(g, aw)) {
      const next = aw.personen.shift();
      away().spawnPersonDazu(g, map, next.tile, { person: next.person, name: next.name, injured: next.injured });
    }
  }
}
function wartend(g, map, person) {
  const aw = g.aways && g.aways[map];
  return aw && Array.isArray(aw.personen) ? aw.personen.find((x) => x.person === person) || null : null;
}
// map_reset auf gebauten Karten: Zustände und Alarm des Landepunkts zurück, neuer Seed nur mit neuer_seed. -> { ok, reason? }
function resetLandepunkt(g, lp, neuerSeed) {
  let L;
  try { L = require('../../sim/landepunkte.js'); } catch (e) { return { ok: false, reason: 'landepunkte.js fehlt' }; }
  const e = typeof L.eintrag === 'function' ? L.eintrag(g, lp) : null;
  if (!e) return { ok: false, reason: 'Landepunkt ' + lp + ' unbekannt' };
  const old = g.aways && g.aways[lp];
  if (old && g.away === old) {
    const I = require('../../sim/interior.js');
    g.players.filter((p) => p.zone === 'away').forEach((p, i) => { if (p.downed) I.revivePlayer(g, p); I.placeOnShipPad(g, p, i); p.beamLock = false; p.hold = null; });
  }
  e.zustaende = {}; e.alarm = false;
  if (neuerSeed) {
    e.seed = (((Number(e.seed) || 1) * 1103515245 + 12345 + (g.tick || 0)) >>> 0) % 100000 + 1;
    e.bauversion = null;
  }
  e.resets = (e.resets || 0) + 1;
  if (g.aways) delete g.aways[lp];
  try { world().unregister(lp); } catch (x) { /* nicht registriert */ }
  // B1 F1: neu registrieren ohne Bau im Tick (Cache-Treffer sofort, neuer Seed: Bau außerhalb des Ticks, dann nachgeholt)
  const warAktiv = !!(old && g.away === old);
  const neuAnmelden = (aw) => { if (warAktiv && aw && g.away === old) g.away = aw; };
  if (typeof L.sobaldGeladen === 'function') L.sobaldGeladen(g, lp, 'map_reset:' + e.resets, neuAnmelden);
  else { L.get(g, lp); neuAnmelden(g.aways[lp]); }
  g.emit('mapReset', { map: lp });
  return { ok: true, resets: e.resets };
}

// Punkt, an dem das Schiff halten soll: x/y oder die Station des Orts
function holdPoint(g, a) {
  if (Number.isFinite(a.x) && Number.isFinite(a.y)) return { x: a.x, y: a.y };
  const loc = Locations.get(a.loc || g.ship.scene);
  const st = loc && loc.scene && loc.scene.station;
  return st ? { x: st.x, y: st.y } : null;
}
function shipNear(g, a) {
  if (a.loc && g.ship.scene !== a.loc) return false;
  const pt = holdPoint(g, a);
  if (!pt) return false;
  return Math.hypot(g.ship.x - pt.x, g.ship.y - pt.y) <= a.dist;
}

module.exports = (Registry) => {
  const { define } = Registry;

  // =============================================================================================================
  // Aktionen
  // =============================================================================================================
  define({ id: 'map_reset', art: 'aktion', ereignisse: ['mapReset'],
    beschreibung: 'Außenkarte wieder bespielbar machen (Tor zu, Trupps/Drohnen/Plünderer zurück, Container voll, Sonde an). '
      + 'Tutorial-Fakten bleiben: Kesh-Sockel leer, solange die Tafel im Konkordat-Archiv liegt (oder neuer Fund per fund); '
      + 'zerstörter Wächter bleibt zerstört; B-7 ohne Ivo (gerettet bleibt gerettet). grund = Erzähltext (ODA ≤ 120 + Logbuch). '
      + 'Wer unten ist, kommt vorher an Bord. Optional: fund (Kesh: Gegenstand auf dem Sockel), datenkern (B-7, Standard true).',
    params: { map: { typ: 'map', pflicht: true }, grund: { typ: 'text', oda: true }, fund: { typ: 'item' },
      datenkern: { typ: 'bool' }, neuer_seed: { typ: 'bool' } },
    run(m, a) {
      const g = m.game;
      const res = !isHandMap(a.map) ? resetLandepunkt(g, a.map, !!a.neuer_seed) : away().resetMap(g, a.map, { fund: a.map === 'kesh' ? a.fund : null, datenkern: a.map === 'platform' ? a.datenkern : undefined });
      if (!res.ok) { g.countError('mission-hook', new Error('map_reset: ' + res.reason)); return; }
      const grund = a.grund ? String(txt(m, a.grund)) : '';
      if (grund) {
        try { g.explore.addLog(grund, Objects.locOfMap(a.map)); } catch (e) { g.countError('mission-hook', e); }
        g.oda(oda120(grund), null);
      }
      g.missionEvent('mapReset', { map: a.map, resets: res.resets });
    } });

  define({ id: 'spawn_person', art: 'aktion', ereignisse: ['npcHealed', 'npcRescued'],
    beschreibung: 'NSC-Person auf einer Außenkarte (wie Ivo auf B-7) am NSC-Anker der Karte (Maps.MAP_AREAS.<karte>.nsc): folgt nach E '
      + 'zu den Pads und wird mit hochgebeamt (Ereignis npcRescued { person, name, map }); verletzt = braucht erst ein Medipack '
      + '(getragen, eingesteckt oder per Nachschub). person = Kennung (auch NSC-ID), name = Anzeige (Standard: NSC-Name bzw. person). '
      + 'Optional anker = Bereich, Objekt oder "x,y" (Handkarten) bzw. Ankerrolle/-ID (gebaute Karten: Standard nsc, dann zelle). '
      + 'Handkarten: eine Person je Karte; gebaute Karten: bis zu 3 gleichzeitig (je ein Anker), weitere rücken nach einer Rettung nach. Prüfen mit person_rescued { map, person }.',
    params: { map: { typ: 'map', pflicht: true }, person: { typ: 'string', pflicht: true }, name: { typ: 'string' },
      verletzt: { typ: 'bool' }, anker: { typ: 'string' } },
    run(m, a) {
      const g = m.game;
      if (!isHandMap(a.map)) {   // B1: gebaute Karte – Position aus dem Anker, nie aus Koordinaten
        const aw = g.aways && g.aways[a.map];
        if (!aw) { g.countError('mission-hook', new Error(`spawn_person: Karte ${a.map} nicht geladen`)); return; }
        aw.personenZahl = (aw.personenZahl || 0);
        const pt = personTile(g, a.map, a.anker, aw.personenZahl);
        if (!pt) { g.countError('mission-hook', new Error(`spawn_person: ${a.map} hat keinen nsc-/zelle-Anker`)); return; }
        aw.personenZahl++;
        const npcRec0 = g.weltstand && g.weltstand.data && g.weltstand.data.npc && g.weltstand.data.npc[a.person];
        const p0 = { person: a.person, name: a.name || (npcRec0 && npcRec0.name) || a.person, injured: !!a.verletzt, tile: { x: pt.x, y: pt.y } };
        // W2 AP6: bis CONFIG.personen.maxGleichzeitig gleichzeitig; ist kein Platz frei, wartet sie in aw.personen
        if ((aw.personen && aw.personen.length) || !away().spawnPersonDazu(g, a.map, p0.tile, p0)) (aw.personen || (aw.personen = [])).push(p0);
        return;
      }
      const anker = a.anker || 'nsc';
      const t = anchorTile(a.map, anker);
      if (!t) { g.countError('mission-hook', new Error(`spawn_person: Anker ${a.map}.${anker} ohne erreichbaren Boden`)); return; }
      const npcRec = g.weltstand && g.weltstand.data && g.weltstand.data.npc && g.weltstand.data.npc[a.person];
      const name = a.name || (npcRec && npcRec.name) || a.person;
      away().spawnPerson(g, a.map, t, { person: a.person, name, injured: !!a.verletzt });
    } });

  define({ id: 'debug_rescue_person', art: 'aktion', intern: true, beschreibung: 'Person sofort als gerettet werten (skip)',
    params: { map: { typ: 'map', pflicht: true }, person: { typ: 'string', pflicht: true } },
    run(m, a) {
      const g = m.game; const aw = g.aways && g.aways[a.map];
      away().setzePersonZustand(away().personMit(aw, a.person), 'rescued');
      if (away().personRescued(g, a.map, a.person)) return;
      away().markRescued(g, a.map, a.person);
      g.missionEvent('npcRescued', { person: a.person, map: a.map, debug: true });
    } });

  // =============================================================================================================
  // Prüfungen
  // =============================================================================================================
  define({ id: 'person_rescued', art: 'pruefung', beschreibung: 'Person (spawn_person) ist von dieser Karte an Bord gebeamt',
    params: { map: { typ: 'map', pflicht: true }, person: { typ: 'string', pflicht: true } },
    test: (m, a) => away().personRescued(m.game, a.map, a.person) });

  define({ id: 'person_state', art: 'pruefung', beschreibung: 'Zustand einer Person der Karte: injured | ok | following | rescued',
    params: { map: { typ: 'map', pflicht: true }, person: { typ: 'string', pflicht: true },
      state: { typ: 'string', pflicht: true, werte: ['injured', 'ok', 'following', 'rescued'] } },
    test: (m, a) => {
      const w = wartend(m.game, a.map, a.person);   // B1: wartende Person (noch nicht nachgerückt)
      if (w) return a.state === (w.injured ? 'injured' : 'ok');
      return away().personState(m.game, a.map, a.person) === a.state;
    } });

  define({ id: 'purchased', art: 'pruefung',
    beschreibung: 'Mindestens min Käufe (Standard 1) am Hafenterminal in der laufenden Mission; optional nur ein Artikel bzw. Ort (hafen, vaelen)',
    params: { item: { typ: 'item' }, min: { typ: 'number', min: 1 }, ctx: { typ: 'string' } },
    test: (m, a) => {
      const g = m.game; const mid = m.activeId || null;
      const n = (g.purchases || []).filter((p) => p.mission === mid && (!a.item || p.item === a.item) && (!a.ctx || p.ctx === a.ctx))
        .reduce((s, p) => s + (p.n || 1), 0);
      return n >= (a.min || 1);
    } });

  define({ id: 'ship_near', art: 'pruefung',
    beschreibung: 'Schiff höchstens dist px von der Station des Orts (bzw. vom Punkt x/y); loc = nur an diesem Ort',
    params: { dist: { typ: 'number', pflicht: true, min: 1 }, loc: { typ: 'loc' }, x: { typ: 'number' }, y: { typ: 'number' } },
    test: (m, a) => shipNear(m.game, a) });

  define({ id: 'ship_hold_position', art: 'pruefung',
    beschreibung: 'Schiff hält seit sec Sekunden ununterbrochen höchstens dist px von der Station (bzw. x/y) – Position halten',
    params: { dist: { typ: 'number', pflicht: true, min: 1 }, sec: { typ: 'number', pflicht: true, min: 0 }, loc: { typ: 'loc' },
      x: { typ: 'number' }, y: { typ: 'number' } },
    test: (m, a) => {
      const g = m.game;
      const key = `_hold:${a.loc || ''}:${a.x == null ? '' : a.x}:${a.y == null ? '' : a.y}:${a.dist}`;
      const v = m.v || (m.v = {});
      const st = v[key];
      if (!shipNear(g, a)) { delete v[key]; return false; }
      // Wurde die Prüfung länger als 1 s nicht ausgewertet (anderer Schritt), neu zählen
      if (!st || g.time - st.last > 1) { v[key] = { since: g.time, last: g.time }; return a.sec <= 0; }
      st.last = g.time;
      return g.time - st.since >= a.sec;
    } });
};

module.exports.anchorTile = anchorTile;
module.exports.personenNachruecken = personenNachruecken;
module.exports.resetLandepunkt = resetLandepunkt;
module.exports.MAPS = MAPS;
