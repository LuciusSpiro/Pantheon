'use strict';
// Kontext des Spielleiters (CONTRACT-S1 §8.2, S2 §2.2): was der Spielleiter aus Weltstand + Anlass + Katalog bekommt.
// S2: keine Spielernamen (nur crew.anzahl).
// Orientiert an der Kurzform im Trockenversuch (concept/regiebuch/trockenversuch/grobplan.js: weltstandKurz + katalogKurz),
// aber als Objekt statt Text. Deterministisch: gleiche Eingabe -> gleiches Objekt, alle Schlüssel sortiert, Listen in
// fester Reihenfolge (NSC und Orte nach Kennung, Gedächtnis/Chronik in Spielreihenfolge). Keine Zeitstempel, kein Zufall.
//
//   Context.build(weltstandData, anlass, katalog) -> {
//     anlass, crew: { anzahl }, schiff, ort, orte, fakten, flags, missionen, tutorial,
//     npc: [{ id, name, titel, fraktion, rolle, status, haltung, ort, gedaechtnis: letzte 5 }],
//     chronik: letzte 8, verfuegbar: { szenentypen, molekuele, noch_nicht_spielbar } | null }
// katalog = Ergebnis von Katalog.load() (tools/katalog.js bzw. server/mission/katalog.js); ohne Katalog verfuegbar: null.
//
// B1 (CONTRACT-B1 §11.2) zusätzlich:
//   orte[].landepunkte: [{ id, name, art, bauweise, besitz, zustand, besucht, anker?, zustaende?, alarm?, gesperrt?, frei? }]
//     anker = { rolle: anzahl } der gebauten Karte (Handkarten immer; gebaute Karten, sobald der Weltstand ihre bauversion
//     kennt). Fehlt anker, gilt der Pflichtsatz der Kartenart (kartenarten[].pflichtsatz) – jede Karte der Art hat ihn.
//     So bleibt der Kontext deterministisch und baut beim ersten Planen keine Karten (Bauzeit, Golden unabhängig von Modulen).
//     zustaende/alarm/gesperrt nur, wenn gesetzt; frei = 'nach_tutorial' | 'nach_raumgefecht', solange nicht anfliegbar.
//   bodenbilanz: { letzte: [{ titel, boden, lang?, landepunkte? }], pflicht_jetzt, lang_ab_min }   (GD §5)
//   kartenarten: [{ id, kurz, pflichtsatz }]
//   verfuegbar.molekuele[].umsetzungen[].braucht_anker (statt karten, wenn die Umsetzung buehne_braucht hat)
// B2 (CONTRACT-B2 §7): fraktionen: [{ id, name, rezepte, rollen }], gegner: [{ rolle, name }], rollen_gesehen,
//   crew.bewaffnung: { waffe: anzahl } (ohne Namen)
//
// Landepunkt-Helfer (auch für den Szenenbau): lpAdapter(game) / lpAdapterAusWelt(weltstandData)

const path = require('path');
const Locations = require(path.join(__dirname, '..', '..', 'shared', 'locations.js'));

const NPC_MEMORY = 5;
const CHRONIK = 8;
const BILANZ = 3;   // Bodenbilanz: letzte gespielte Missionen (= wiederholtFenster)
const ANKER_OHNE = new Set(['deckung']);   // Vorzugsplätze der KI: für den Spielleiter ohne Bedeutung
const KARTENART_KURZ = {
  aussenposten: 'Germanisches Lager im Freien (72×40): Palisade, Tore, Höfe, Aussichtsplateau – Sturm, Sabotage, Geiseln, Daten.',
  station: 'Germanische Raumstation (48×24): Gänge, Schotten, Hallen, Reaktor – Daten, Krise, Evakuieren, Sabotage.',
  ruine: 'Verfallenes römisches Grenzkastell (64×40): Tore, Gewölbe, Rätselpaar, Fund – Rätsel, Bergung, Probe.',
  schiff: 'Germanisches Langschiff, zwei Decks (37×13): Brücke, Laderaum, Zellen – Kapern, Sabotage, Bergung.',
};
const BODEN_DEFAULT = { langAbMin: 25, langMaxMin: 35, langeJeRunde: 1, wiederholtFenster: 3 };
function bodenConfig() {
  try { return Object.assign({}, BODEN_DEFAULT, (require('../../shared/config.js').spielleiter || {}).boden || {}); } catch (e) { return Object.assign({}, BODEN_DEFAULT); }
}

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

// S2 Entscheidung 14: keine Spielernamen ans LLM, nur die Crewgröße
function crewOf(w, anlass) {
  const spieler = arr(obj(w.meta).spieler);
  const anzahl = typeof anlass.crew === 'number' ? anlass.crew : (spieler.length || null);
  const r = { anzahl };
  // B2 §7: Bewaffnung der Crew ohne Namen (crew.waffen: { <hash>: waffe })
  const bew = {}; for (const v of Object.values(obj(obj(w.crew).waffen))) if (typeof v === 'string') bew[v] = (bew[v] || 0) + 1;
  if (Object.keys(bew).length) r.bewaffnung = bew;
  return r;
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
function orteOf(w, lp) {
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
    const lps = landepunkteOf(lp, l.id);
    if (lps.length) e.landepunkte = lps;
    return e;
  }).sort(byId);
}

// ---------- Landepunkte (B1 §6.1, §11.2) ----------
let LP;
function lpMod() {
  if (LP === undefined) { try { LP = require('../sim/landepunkte.js'); if (!LP || LP.stub || typeof LP.liste !== 'function') LP = null; } catch (e) { LP = null; } }
  return LP;
}
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const zahlen = (anker) => { const z = {}; for (const a of arr(anker)) if (a && a.rolle && !ANKER_OHNE.has(a.rolle)) z[a.rolle] = (z[a.rolle] || 0) + 1; return z; };
// Adapter auf server/sim/landepunkte.js (BUEHNE) für ein Spiel (echt oder aus dem Weltstand nachgebaut).
//   liste(ort) -> [{ id, name, art, bauweise, besitz, zustand, frei, gesperrt, grund, besuche, alarm }]
//   info(id) -> Definition (+ ort) | null · eintrag(id) -> Weltstand-Eintrag | null · karte(id) -> Karte (§2) | null
//   bekannt(id) -> true, wenn die gebaute Karte ohne Würfeln feststeht (Handkarte, registriert, bauversion im Weltstand)
//   vorschau(ort, { art, besitz }) -> { id, karte } (neuer Landepunkt, ohne das Spiel zu ändern)
//   anlegen(ort, { art, besitz, seed }) -> lpId (legt den Landepunkt im Spiel an)
//   vorbauen(ids) -> Anzahl (füllt den Karten-Cache; baut je Landepunkt per setImmediate, doppelt = Cache-Treffer)
function lpAdapter(game) {
  const L = lpMod();
  if (!L) return null;
  const g = game || {};
  const st = () => g.landepunkte || { eintraege: {}, dyn: {} };
  const ad = {
    game: g,
    liste(ort) { try { return L.liste(g, ort); } catch (e) { return []; } },
    info(id) { return (L.defs().byId[id]) || st().dyn[id] || null; },
    eintrag(id) { return st().eintraege[id] || null; },
    sperrgrund(id) { try { return L.sperrgrund(g, id); } catch (e) { return 'Landepunkt unbekannt.'; } },
    karte(id) { try { return L.karte(g, id); } catch (e) { return null; } },
    bekannt(id) {
      const d = ad.info(id);
      if (!d) return false;
      if (d.art === 'hand') return true;
      try { const W = require('../world.js'); if (W.AWAY_MAPS && W.AWAY_MAPS[id] && W.AWAY_MAPS[id].karte) return true; } catch (e) { /* ohne Welt */ }
      const e = ad.eintrag(id);
      return !!(e && e.bauversion);
    },
    vorschau(ort, o) {
      const tmp = { seed: g.seed, landepunkte: clone(st()) || undefined, weltstand: g.weltstand };
      if (tmp.landepunkte && !tmp.landepunkte.lru) tmp.landepunkte.lru = [];
      const id = L.neu(tmp, ort, o);
      return { id, karte: L.karte(tmp, id), def: tmp.landepunkte.dyn[id], seed: tmp.landepunkte.eintraege[id] && tmp.landepunkte.eintraege[id].seed };
    },
    anlegen(ort, o) { return L.neu(g, ort, o); },
    vorbauen(ids) { return typeof L.vorbauen === 'function' ? L.vorbauen(g, ids) : 0; },
  };
  return ad;
}
// Spiel aus dem Weltstand nachbauen (nur Landepunkte + Tutorial-Stand) – für Kontext und Prüfer ohne Server
function lpAdapterAusWelt(w) {
  const L = lpMod();
  if (!L) return null;
  const d = obj(w);
  const g = { weltstand: { data: d }, aways: {}, seed: obj(d.meta).seed | 0 };
  try { L.restore(clone(obj(obj(d.welt).landepunkte)), g); } catch (e) { /* leerer Stand */ }
  return lpAdapter(g);
}
function landepunkteOf(lp, ort) {
  if (!lp) return [];
  return lp.liste(ort).map((x) => {
    const e = lp.eintrag(x.id) || {};
    const r = { id: x.id, name: x.name, art: x.art, bauweise: x.bauweise || null, besitz: x.besitz || null, zustand: x.zustand || null, besucht: x.besuche | 0 };
    if (lp.bekannt(x.id)) { const k = lp.karte(x.id); if (k) r.anker = zahlen(k.anker); }
    const z = obj(e.zustaende);
    if (Object.keys(z).length) r.zustaende = Object.assign({}, z);
    if (x.alarm) r.alarm = true;
    if (x.gesperrt) r.gesperrt = true;
    else if (!x.frei) { const d = lp.info(x.id) || {}; r.frei = d.frei || 'nein'; }
    return r;
  }).sort(byId);
}

// Pflichtsatz je Kartenart: Minimum über alle Schablonen der Art (jede Karte der Art hat ihn auf jedem Seed)
let KARTENARTEN = null;
function kartenartenOf() {
  if (KARTENARTEN) return KARTENARTEN;
  const out = [];
  try {
    const B = require('../../shared/buehne.js');
    const sch = Object.values(obj(B.daten().schablonen));
    for (const art of Object.keys(KARTENART_KURZ)) {
      const list = sch.filter((s) => s && s.art === art && isObjPlain(s.pflicht));
      if (!list.length) continue;
      const p = {};
      for (const r of Object.keys(list[0].pflicht).sort()) if (list.every((s) => s.pflicht[r] > 0)) p[r] = Math.min(...list.map((s) => s.pflicht[r]));
      out.push({ id: art, kurz: KARTENART_KURZ[art], pflichtsatz: p });
    }
  } catch (e) { /* ohne Bühnen-Daten: leer */ }
  KARTENARTEN = out;
  return out;
}
function isObjPlain(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

// Bodenbilanz (GD §5): gezählt werden gespielte Missionen (spielleiter.zusammenfassung), nicht Angebote
function bodenbilanzOf(w) {
  const C = bodenConfig();
  const z = arr(obj(w.spielleiter).zusammenfassung).filter(isObjPlain);
  const letzte = z.slice(-Math.max(1, C.wiederholtFenster || BILANZ)).map((x) => {
    const e = { titel: x.titel || x.id || '?', boden: typeof x.boden === 'boolean' ? x.boden : null };
    if (x.lang === true) e.lang = true;
    if (arr(x.landepunkte).length) e.landepunkte = arr(x.landepunkte).slice();
    return e;
  });
  const last = z[z.length - 1];
  return { letzte, pflicht_jetzt: !!(last && last.boden === false), lang_ab_min: C.langAbMin };
}

// B2 §7: Fraktionen (Besetzung nur über Fraktion, Stärke, Haltung) und Gegnerrollen (für höchstens eine neue_rolle)
function fraktionenOf(k) {
  return Object.values(obj(k && k.fraktionen)).map((f) => ({ id: f.id, name: f.name, rezepte: Object.keys(obj(f.rezepte)).sort(),
    rollen: [...new Set(Object.values(obj(f.rezepte)).flatMap((t) => arr(t).map((x) => x.rolle)))].sort() })).sort(byId);
}
function gegnerOf(k) {
  return Object.values(obj(k && k.gegner)).map((g) => ({ rolle: g.rolle, name: obj(g.namen).germanen || Object.values(obj(g.namen))[0] || g.id }))
    .sort((a, b) => (a.rolle < b.rolle ? -1 : a.rolle > b.rolle ? 1 : 0));
}
function rollenGesehenOf(w) { return [...new Set([...arr(obj(w.crew).rollen_gesehen), ...arr(w.rollen_gesehen)].filter((x) => typeof x === 'string'))].sort(); }

function npcOf(w) {
  return Object.entries(obj(w.npc)).map(([id, n]) => {
    n = obj(n);
    const e = pick(n, ['name', 'titel', 'fraktion', 'rolle', 'status', 'haltung', 'ort']);
    e.id = id;
    e.gedaechtnis = arr(n.gedaechtnis).slice(-NPC_MEMORY).map((g) => pick(obj(g), ['text', 'mission', 'ereignis', 'haltung']));
    // QA-Abnahme S2b: Einträge ohne 'ereignis' (S1-Weltstände, Fixtures) bekommen eine stabile Kennung, sonst kann der
    // Grobplan sie nicht als Erinnerung { npc, ereignis } nennen (live: LLM erfand 'm1'/'m3', Prüfer lehnte 2× ab)
    const seen = {};
    for (const g of e.gedaechtnis) {
      if (typeof g.ereignis === 'string' && g.ereignis) continue;
      const base = `${String(g.mission || 'welt').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}_erinnerung`;
      seen[base] = (seen[base] || 0) + 1;
      g.ereignis = seen[base] > 1 ? `${base}_${seen[base]}` : base;
    }
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
        if (u.buehne_braucht && typeof u.buehne_braucht === 'object') e.braucht_anker = clone(u.buehne_braucht);   // B1 §11.2 statt karten
        else if (u.params.map && u.params.map.werte) e.karten = u.params.map.werte.slice();
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

// opts: { lp } – Landepunkt-Adapter (Standard: aus dem Weltstand nachgebaut; null = ohne Landepunkte)
function build(weltstandData, anlass, katalog, opts) {
  const o = opts || {};
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
    orte: orteOf(w, o.lp !== undefined ? o.lp : lpAdapterAusWelt(w)),
    bodenbilanz: bodenbilanzOf(w),
    kartenarten: kartenartenOf(),
    fraktionen: fraktionenOf(katalog),
    gegner: gegnerOf(katalog),
    rollen_gesehen: rollenGesehenOf(w),
    fakten: Object.assign({}, obj(obj(w.welt).fakten)),
    flags: flagsOf(w),
    missionen: missionenOf(w),
    npc: npcOf(w),
    chronik: arr(w.chronik).slice(-CHRONIK).map((c) => pick(obj(c), ['text', 'mission', 'ausgang'])),
    verfuegbar: verfuegbarOf(katalog),
  };
  return sortKeys(ctx);
}

module.exports = { build, sortKeys, NPC_MEMORY, CHRONIK, lpAdapter, lpAdapterAusWelt, kartenartenOf, bodenbilanzOf, bodenConfig, KARTENART_KURZ };
