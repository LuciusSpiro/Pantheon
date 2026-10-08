'use strict';
// Kontext des Spielleiters (CONTRACT-S1 §8.2): was der Spielleiter ab S2 aus Weltstand + Anlass + Katalog bekommt.
// Orientiert an der Kurzform im Trockenversuch (concept/regiebuch/trockenversuch/grobplan.js: weltstandKurz + katalogKurz),
// aber als Objekt statt Text. Deterministisch: gleiche Eingabe -> gleiches Objekt, alle Schlüssel sortiert, Listen in
// fester Reihenfolge (NSC und Orte nach Kennung, Gedächtnis/Chronik in Spielreihenfolge). Keine Zeitstempel, kein Zufall.
//
//   Context.build(weltstandData, anlass, katalog) -> {
//     anlass, crew, schiff, ort, orte, fakten, flags, missionen, tutorial,
//     npc: [{ id, name, titel, fraktion, rolle, status, haltung, ort, gedaechtnis: letzte 5 }],
//     chronik: letzte 8, verfuegbar: { szenentypen, molekuele, noch_nicht_spielbar } | null }
// katalog = Ergebnis von Katalog.load() (tools/katalog.js bzw. server/mission/katalog.js); ohne Katalog verfuegbar: null.

const path = require('path');
const Locations = require(path.join(__dirname, '..', '..', 'shared', 'locations.js'));

const NPC_MEMORY = 5;
const CHRONIK = 8;

function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x).sort()) if (x[k] !== undefined) o[k] = sortKeys(x[k]);
    return o;
  }
  return x;
}
const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== null) r[k] = o[k]; return r; };

function crewOf(w, anlass) {
  const spieler = arr(obj(w.meta).spieler).map(String);
  const anzahl = typeof anlass.crew === 'number' ? anlass.crew : (spieler.length || null);
  return { anzahl, spieler };
}

function schiffOf(w) {
  const s = obj(w.schiff);
  const lager = {}; for (const [k, v] of Object.entries(obj(s.lager))) if (v > 0) lager[k] = v;
  const schaeden = {}; for (const [k, v] of Object.entries(obj(s.systeme))) if (v && v !== 'ok') schaeden[k] = v;
  return { name: s.name || 'Lerche', marken: typeof s.marken === 'number' ? s.marken : 0, huelle: typeof s.huelle === 'number' ? s.huelle : 100,
    lager, ausbauten: arr(s.ausbauten).slice().sort(), schaeden };
}

// Orte: alle Orte des Spiels mit Status aus dem Weltstand (wie katalogKurz im Trockenversuch: Verbindungen, Außenkarte,
// Andocken, Funde). Gesperrte Verbindungen (LOCKED_LINKS, nicht in verbindungen_offen) stehen unter 'gesperrt'.
function orteOf(w) {
  const o = obj(obj(w.welt).orte);
  const bekannt = new Set(arr(o.bekannt)); const besucht = new Set(arr(o.besucht));
  const aufgedeckt = new Set(arr(o.aufgedeckt)); const gefunden = new Set(arr(o.gefunden));
  const offen = new Set(arr(obj(w.welt).verbindungen_offen));
  const locked = (a, b) => { const k = Locations.lockedKey(a, b); return k && !offen.has(k); };
  return Locations.LOCATIONS.map((l) => {
    const links = l.links.slice().sort();
    const e = {
      id: l.id, name: l.name, art: l.kind,
      status: besucht.has(l.id) ? 'besucht' : bekannt.has(l.id) ? 'bekannt' : 'unbekannt',
      verbindungen: links.filter((x) => !locked(l.id, x)),
      andocken: !!(l.scene && l.scene.dock),
      funde: l.hidden.map((h) => ({ id: h.id, status: gefunden.has(h.id) ? 'gefunden' : aufgedeckt.has(h.id) ? 'aufgedeckt' : 'verborgen' })).sort(byId),
    };
    const gesperrt = links.filter((x) => locked(l.id, x));
    if (gesperrt.length) e.gesperrt = gesperrt;
    if (l.scene && l.scene.beam) e.aussenkarte = l.scene.beam.map;
    return e;
  }).sort(byId);
}

function npcOf(w) {
  return Object.entries(obj(w.npc)).map(([id, n]) => {
    n = obj(n);
    const e = pick(n, ['name', 'titel', 'fraktion', 'rolle', 'status', 'haltung', 'ort']);
    e.id = id;
    e.gedaechtnis = arr(n.gedaechtnis).slice(-NPC_MEMORY).map((g) => pick(obj(g), ['text', 'mission', 'ereignis', 'haltung']));
    return e;
  }).sort(byId);
}

function missionenOf(w) {
  let src = obj(w.missionen);
  // mission.toSave()-Form (CONTRACT-S1 §3.5): { missionen: { id: {...} }, aktiv, flags, buchFokus }
  if (src.missionen && typeof src.missionen === 'object') src = src.missionen;
  const r = {};
  for (const [id, m] of Object.entries(src)) {
    if (!m || typeof m !== 'object' || m.status === undefined) continue;
    r[id] = pick(m, ['status', 'ausgang', 'schritt']);
  }
  return r;
}

function flagsOf(w) {
  const m = obj(w.missionen);
  return Object.assign({}, obj(m.flags), obj(obj(w.welt).flags));
}

// Katalog-Kurzform (wie Katalog.fuerSpielleiter 'kurz', als Objekt)
function verfuegbarOf(k) {
  if (!k || !k.szenentypen || !k.molekuele) return null;
  const st = Object.values(k.szenentypen);
  const ml = Object.values(k.molekuele);
  return {
    szenentypen: st.filter((s) => s.status === 'verfuegbar').map((s) => {
      const e = { id: s.id, kennung: s.kennung, name: s.name, bereich: s.bereich, kern: s.kern,
        plaetze: [s.molekuele_plaetze.min, s.molekuele_plaetze.max], molekuele: arr(s.verfuegbare_molekuele).slice().sort() };
      if (arr(s.kippt_zu).length) e.kippt_zu = s.kippt_zu.slice().sort();
      return e;
    }).sort(byId),
    molekuele: ml.filter((m) => m.status === 'verfuegbar').map((m) => ({
      id: m.id, name: m.name, kern: m.kern, ansaetze: arr(m.ansaetze).slice(), szenentypen: arr(m.szenentypen).slice().sort(),
      umsetzungen: m.umsetzungen.filter((u) => u.status === 'verfuegbar').map((u) => {
        const e = { id: u.id, name: u.name, schauplatz: u.schauplatz, dauer_min: u.dauer_min.slice(), beschreibung: u.beschreibung };
        if (u.params.loc && u.params.loc.werte) e.nur_an = u.params.loc.werte.slice();
        if (u.params.map && u.params.map.werte) e.karten = u.params.map.werte.slice();
        if (arr(u.nach).length) e.nach = u.nach.slice();
        return e;
      }).sort(byId),
    })).sort(byId),
    noch_nicht_spielbar: {
      szenentypen: st.filter((s) => s.status !== 'verfuegbar').map((s) => s.id).sort(),
      molekuele: ml.filter((m) => m.status !== 'verfuegbar').map((m) => m.id).sort(),
    },
  };
}

function build(weltstandData, anlass, katalog) {
  const w = obj(weltstandData);
  const a = anlass == null ? {} : (typeof anlass === 'string' ? { art: anlass } : anlass);
  const ortId = obj(w.ort).angedockt || null;
  const loc = ortId && Locations.get ? Locations.get(ortId) : null;
  const ctx = {
    anlass: a,
    tutorial: w.tutorial || null,
    crew: crewOf(w, a),
    schiff: schiffOf(w),
    ort: { angedockt: ortId, name: loc ? loc.name : null },
    orte: orteOf(w),
    fakten: Object.assign({}, obj(obj(w.welt).fakten)),
    flags: flagsOf(w),
    missionen: missionenOf(w),
    npc: npcOf(w),
    chronik: arr(w.chronik).slice(-CHRONIK).map((c) => pick(obj(c), ['text', 'mission', 'ausgang'])),
    verfuegbar: verfuegbarOf(katalog),
  };
  return sortKeys(ctx);
}

module.exports = { build, sortKeys, NPC_MEMORY, CHRONIK };
