'use strict';
// Landepunkte zur Laufzeit (CONTRACT-B1 §6.1, §8; Team BUEHNE).
// - Definitionen aus content/welt/landepunkte.json, dazu Laufzeit-Landepunkte (neu/prise) im Weltstand.
// - get(game, lpId): baut die Karte bei Bedarf (shared/buehne.js), registriert sie in world.AWAY_MAPS und legt
//   game.aways[lpId] an. Höchstens CONFIG.landepunkte.maxGebaut (2) gebaute Karten im Speicher (LRU), Handkarten immer.
// - Weltstand-Block welt.landepunkte: toSave(game) / restore(block, game) (Konvention ENGINE).
// Laufzeitzustände der Anker/Kanten stehen in aw.zustaende (gemeinsam mit BODENKAMPF interior.kachelZustand);
// Alarm in aw.alarm. Beim Verdrängen/Speichern wandern sie in den Weltstand-Eintrag.
const fs = require('fs');
const path = require('path');
const Buehne = require('../../shared/buehne.js');
const GenSiedlung = require('../../shared/gen-siedlung.js');
const GenStation = require('../../shared/gen-station.js');
const Locations = require('../../shared/locations.js');
const W = require('../world.js');

// Vorwärmen (Daten laden, Lagen, ein Probebau je Kartenart ≈ 0,4 s) außerhalb des laufenden Aufrufs: setImmediate, damit es
// nie in einem Tick passiert. Am besten lädt ENGINE dieses Modul beim Serverstart (dann ist alles vor dem ersten Spiel warm).
let gewaermt = false;
function vorwaermen() { if (gewaermt) return; gewaermt = true; try { Buehne.vorwaermen(); } catch (e) { /* Inhalte unvollständig */ } }
if (typeof setImmediate === 'function') { const t = setImmediate(vorwaermen); if (t && t.unref) t.unref(); }

const DATEI = path.join(__dirname, '..', '..', 'content', 'welt', 'landepunkte.json');
const MAX_GEBAUT = 2;   // Rückfall; maßgeblich ist CONFIG.landepunkte.maxGebaut
const maxGebaut = (game) => (game && game.C && game.C.landepunkte && game.C.landepunkte.maxGebaut) || MAX_GEBAUT;
let DEF = null;
function defs() {
  if (DEF) return DEF;
  const j = JSON.parse(fs.readFileSync(DATEI, 'utf8'));
  DEF = { orte: {}, byId: {} };
  for (const ort of Object.keys(j.orte || {}).sort()) {
    DEF.orte[ort] = [];
    for (const e of j.orte[ort]) { const d = Object.assign({ ort }, e); DEF.orte[ort].push(d); DEF.byId[d.id] = d; }
  }
  return DEF;
}
function neuLaden() { DEF = null; return defs(); }

// ---------- Laufzeitzustand: game.landepunkte = { eintraege: { lpId: Eintrag }, lru: [lpId], dyn: { lpId: Def } } ----------
// halten: { lpId: missionId } – Karte der laufenden Mission (Besetzung/Setup), wird nicht verdrängt (F1)
// ausstehend: { lpId: [{ key, fn, mission }] } – Schritt-Aktionen, die auf die Registrierung warten (F1, nie gespeichert)
function st(game) {
  if (!game.landepunkte) game.landepunkte = { eintraege: {}, lru: [], dyn: {}, halten: {}, ausstehend: {} };
  const S = game.landepunkte;
  if (!S.halten) S.halten = {};
  if (!S.ausstehend) S.ausstehend = {};
  return S;
}
function istHand(id) { return W.istHand(id); }
function def(game, lpId) { return defs().byId[lpId] || st(game).dyn[lpId] || null; }
function eintrag(game, lpId) {
  const S = st(game);
  if (S.eintraege[lpId]) return S.eintraege[lpId];
  const d = def(game, lpId);
  if (!d) return null;
  const e = { seed: d.seed, bauversion: null, schablone: d.schablone || null, art: d.art, bauweise: d.bauweise || null, besitz: d.besitz || null,
    zustand: d.zustand || 'intakt', zustaende: {}, alarm: false, besuche: 0, letzte_mission: null, neu: !!d.neu, gesperrt: !!d.gesperrt };
  if (d.ort && !defs().byId[lpId]) e.ort = d.ort;
  if (d.frei_gesetzt) e.frei = true;
  if (d.gen) e.gen = d.gen;   // Generator-Vorgaben (nur Laufzeit, nicht im Weltstand)
  S.eintraege[lpId] = e;
  return e;
}
function log(game, text) { try { if (game.log) game.log('[Landepunkte] ' + text); } catch (e) { /* nie in den Tick werfen */ } }
function countError(game, where, err) { try { if (game.countError) game.countError(where, err); } catch (e) { /* */ } }

// ---------- Bauen ----------
function bauOpts(lpId, e) {
  return { spiel: true, id: lpId, art: e.art, schablone: e.schablone || undefined, seed: e.seed | 0, bauweise: e.bauweise || undefined,
    besitz: e.besitz || null, zustand: e.zustand || 'intakt' };
}
// Generatoren (shared/gen-siedlung.js, gen-station.js, Kai 2026-10-11): Außenposten = Siedlung, Station = Stationsgrammatik. Standard für alle
// Landepunkte dieser beiden Kartenarten (Bodenkampf-Auswahl, Testgelände, Szenenbau, feste Orte). Schiff, Ruine und Handkarten bleiben bei
// den Modulen. Aus: landepunkte.json "erzeuger": "modul" (ein Ort), Schablone explizit gesetzt (Test/Werkzeug) oder PANTHEON_GEN=0 (alles).
// Gleicher Seed = gleiche Karte; die Karten erfüllen den Pflichtsatz der Kartenart (Missionsplanung nimmt ihn an).
const GEN_GROESSE = { aussenposten: { n: 10 }, station: { n: 8 } };
function nutztGenerator(lpId, e) {
  if (!GEN_GROESSE[e.art] || process.env.PANTHEON_GEN === '0' || (e.schablone && !/^gen-/.test(e.schablone))) return false;   // gen-… = vom Generator gesetzt (uebernehmen)
  const d = defs().byId[lpId] || {};   // Aus-Schalter steht in der Definition, nicht im (gespeicherten) Eintrag
  return d.erzeuger !== 'modul';
}
// TA (Kai 2026-10-14): Siedlungsvorgaben der aktiven Welt (content/welt/<karte>.json "siedlung": { boden: 'sand'|'gras'|'wald'|'auto', ausstattung: true }).
// Ohne diesen Eintrag (Limes/Eisenwald) bleibt jede Siedlung wie bisher; ein Landepunkt kann mit gen.boden / gen.ausstattung abweichen.
function siedlungWelt() {
  try { const W = require('./welt.js'); const k = W.karte(W.kartenId()); return (k && k.siedlung) || null; } catch (x) { return null; }
}
function genBauen(lpId, e) {
  const o = { bauweise: e.bauweise || 'germanen', besitz: e.besitz || null, zustand: e.zustand || 'intakt', id: lpId };
  const gv = e.gen || (defs().byId[lpId] || {}).gen || {};   // EK5/EK6: Vorgaben der Definition bzw. des Debug-Landepunkts (variante methalle/eisenwald, typ, haeuser)
  const typ = gv.typ || (e.besitz === 'rostmeute' || e.zustand === 'umkaempft' ? 'militaer' : 'handel');
  const sw = e.art === 'aussenposten' ? siedlungWelt() : null;
  const ausstattung = gv.ausstattung != null ? !!gv.ausstattung : !!(sw && sw.ausstattung && typ === 'handel' && !gv.variante);
  const boden = gv.boden || (sw && sw.boden) || null;
  let letzte = null;
  for (let i = 0; i < 6; i++) {   // wie Buehne.bauen: scheitert der Prüfer, Seed + 1
    const seed = (e.seed | 0) + i;
    let roh;
    try {
      roh = e.art === 'aussenposten'
        ? GenSiedlung.erzeuger(130, 90).karteRoh(seed, gv.haeuser || GEN_GROESSE.aussenposten.n, Object.assign({ typ, variante: gv.variante || null, ausstattung, boden }, o))
        : GenStation.erzeuger(96, 56).karteRoh(seed, GEN_GROESSE.station.n, gv.monster ? Object.assign({ monster: true }, o) : o);   // SL7c: gen.monster = Monster-Station (4 Pulte, meta.monster)
    } catch (x) {
      if (gv.variante && i < 5) { letzte = { fehler: [{ code: 'GEN', msg: String(x.message) }] }; continue; }   // Variante ohne Platz: nächster Seed
      throw x;
    }
    const r = Buehne.ausRaster(roh, { spiel: true });
    if (r.pruefung.ok) { r.karte.meta.versuche = i + 1; r.karte.meta.seedStart = e.seed | 0; return r.karte; }
    letzte = r;
  }
  const err = new Error(`Generator ${lpId} ab Seed ${e.seed | 0}: 6 Versuche gescheitert (${letzte.fehler.slice(0, 3).map((f) => f.code + ' ' + f.msg).join('; ')})`);
  err.fehler = letzte.fehler; throw err;
}
function rohBauen(lpId, e) { return nutztGenerator(lpId, e) ? genBauen(lpId, e) : Buehne.bauen(bauOpts(lpId, e)); }
// Wirksame Bauwerte der (Roh-)Karte in den Eintrag
function uebernehmen(e, roh) {
  e.seed = roh.seed; e.schablone = roh.schablone; e.bauversion = roh.bauversion;
  if (!e.bauweise) e.bauweise = roh.bauweise;
}
// Gespeicherte Zustände auf eine eigene Kopie anwenden; Unbekanntes verwerfen. alt = bauversion vor dem Neubau (Logbuch).
function mitZustaenden(game, lpId, e, roh, alt) {
  const karte = JSON.parse(JSON.stringify(roh));
  const verworfen = Buehne.zustaendeAnwenden(karte, e.zustaende || {});
  if (alt && alt !== roh.bauversion) {
    log(game, `${lpId}: bauversion ${alt} -> ${roh.bauversion}, Karte neu gebaut (Seed ${roh.seed}); ${verworfen.length} Zustände verworfen`);
    if (game.mission && typeof game.mission.regieLog === 'function') { try { game.mission.regieLog('landepunkt_neu_gebaut', { lp: lpId, alt, neu: roh.bauversion, verworfen }); } catch (x) { /* */ } }
  }
  if (verworfen.length && e.zustaende) for (const k of verworfen) delete e.zustaende[k];
  return karte;
}
// Karte eines Landepunkts frisch bauen (ohne Registrierung, ohne Cache). Bei abweichender bauversion: neu bauen, Zustände
// über IDs übertragen, Unbekanntes verwerfen, Logbuch. -> Karte (oder wirft)
function bauen(game, lpId) {
  const e = eintrag(game, lpId);
  if (!e) throw new Error(`Landepunkt ${lpId} unbekannt`);
  if (e.art === 'hand') return Buehne.hand(lpId);
  const alt = e.bauversion;
  const roh = rohBauen(lpId, e);
  uebernehmen(e, roh);
  return mitZustaenden(game, lpId, e, roh, alt);
}

// Laufzeit-Außenkarte (Felder wie away.baseAway + Kampf v2 + B1-Felder)
function makeAway(game, lpId, karte, e) {
  const aw = {
    map: lpId, active: false, drones: [], projectiles: [],
    npcs: [],   // W2 AP6: Personen (away.js personen()), ersetzt away.npc
    items: [], marker: null, strikes: [], pendingStrikes: [],
    kustodenpult: { disabled: true, symbols: [], entered: [], lockout: 0 },
    codeTable: {}, odaCodeHelp: false, kuppelUntil: 0, sensorUntil: 0, doorOpen: true,
    kuppelHp: 0, alarmUntil: 0, noHumanT: 0, firstBeamAt: null, coreRebooted: false,
    salvage: [], hollow: null, loreRead: false,
    kampf: 'v2', combat: 'v2',
    // B1: Anker-/Kantenzustände (Abweichungen vom Start), Alarm, Anker-Laufzeit (anker.js)
    zustaende: Object.assign({}, karte.zustaende || {}, (e && e.zustaende) || {}),
    alarm: !!(e && e.alarm), haltung: (karte.meta && karte.meta.haltung) || null,
    ankerLauf: { download: {}, ladung: {}, raetsel: {} },
  };
  try {
    const combat = require('./combat.js');
    if (typeof combat.ensureV2 === 'function') combat.ensureV2(game, aw, (Buehne.fnv(lpId) >>> 0));
  } catch (x) { countError(game, 'landepunkte-ensureV2', x); }
  return aw;
}

// get(game, lpId) -> game.aways[lpId] (baut bei Bedarf). Wirft bei unbekanntem Landepunkt.
function get(game, lpId) {
  if (!game.aways) game.aways = {};
  if (istHand(lpId)) return game.aways[lpId];
  const S = st(game);
  if (game.aways[lpId] && W.AWAY_MAPS[lpId]) { beruehren(S, lpId); return game.aways[lpId]; }
  const e = eintrag(game, lpId);
  if (!e) throw new Error(`Landepunkt ${lpId} unbekannt`);
  const karte = gebauteKarte(game, lpId);
  W.register(lpId, karte);
  game.aways[lpId] = makeAway(game, lpId, karte, e);
  beruehren(S, lpId);
  verdraengen(game);
  nachholen(game, lpId);
  return game.aways[lpId];
}
function beruehren(S, lpId) { S.lru = S.lru.filter((x) => x !== lpId); S.lru.push(lpId); }
const missionId = (game) => (game.mission && game.mission.activeId) || null;
function belegt(game, lpId) {
  const S = st(game);
  return (game.away && game.away.map === lpId) || (game.players || []).some((p) => p.zone === 'away' && game.away && game.away.map === lpId) ||
    (game.transferZiel && game.transferZiel.lp === lpId) ||
    !!(S.halten[lpId] && S.halten[lpId] === missionId(game)) || !!S.ausstehend[lpId];   // F1: Karte der laufenden Mission
}

// ---------- F1: Schritt-Aktionen (besetzen, anker_zustand …) auf Landepunkten, die noch nicht registriert sind ----------
// game.aways[lp] entsteht erst über get(). Ein Schritt startet oft, bevor jemand den Landepunkt an der Transfer-Konsole
// wählt. Liegt die Karte im Cache (Vorbau bei Ankunft), registriert bereit() sie sofort (Kopie, keine Bauzeit im Tick);
// sonst baut vorbauen() außerhalb des Ticks (setImmediate) und get() holt die Aktionen nach – spätestens beim Wählen bzw.
// Betreten (waehlen -> get).
function imCache(game, lpId) { const e = eintrag(game, lpId); return !!(e && KARTEN_CACHE.has(cacheKey(lpId, e))); }
// bereit(game, lpId) -> true, wenn game.aways[lpId] registriert ist bzw. ohne Bau (Cache-Treffer) registriert werden konnte
function bereit(game, lpId) {
  if (!game.aways) game.aways = {};
  if (istHand(lpId)) return !!game.aways[lpId];
  if (game.aways[lpId] && W.AWAY_MAPS[lpId]) return true;
  if (!def(game, lpId) || !imCache(game, lpId)) return false;
  get(game, lpId);
  return !!(game.aways[lpId] && W.AWAY_MAPS[lpId]);
}
// sobaldGeladen(game, lpId, key, fn): fn(aw) sofort, wenn die Karte registriert ist bzw. aus dem Cache registriert werden
// kann; sonst Bau außerhalb des Ticks und fn bei der Registrierung. Idempotent je key (kein doppeltes Spawnen). Gilt nur für
// die Mission, die es angefordert hat (endet sie vorher, entfällt fn). -> 'jetzt' | 'spaeter' | 'unbekannt'
function sobaldGeladen(game, lpId, key, fn) {
  if (istHand(lpId)) { fn(game.aways && game.aways[lpId]); return 'jetzt'; }
  if (!def(game, lpId)) return 'unbekannt';
  const S = st(game);
  const mid = missionId(game);
  if (mid) S.halten[lpId] = mid;
  if (bereit(game, lpId)) { fn(game.aways[lpId]); return 'jetzt'; }
  const q = S.ausstehend[lpId] || (S.ausstehend[lpId] = []);
  if (key != null && q.some((x) => x.key === key)) return 'spaeter';
  q.push({ key, fn, mission: mid });
  if (q.length === 1) {
    vorbauen(game, [lpId], () => {
      if (game.landepunkte !== S || !S.ausstehend[lpId]) return;   // Partie zurückgesetzt bzw. schon nachgeholt
      try { get(game, lpId); } catch (x) { countError(game, 'landepunkte-nachholen', x); }
    });
  }
  return 'spaeter';
}
function nachholen(game, lpId) {
  const S = st(game);
  const q = S.ausstehend[lpId];
  if (!q) return;
  delete S.ausstehend[lpId];
  const mid = missionId(game);
  for (const x of q) {
    if (x.mission && x.mission !== mid) continue;
    try { x.fn(game.aways[lpId]); } catch (err) { countError(game, 'landepunkte-nachholen', err); }
  }
}
// Partie zurückgesetzt (game.reset): Registrierungen und Laufzeitzustand vollständig leeren. Der Karten-Cache bleibt (er
// hängt nur von Landepunkt, Seed und Achsen ab und hält nie Laufzeitzustände).
function zuruecksetzen(game) {
  const S = game.landepunkte;
  const ids = new Set(Object.keys(game.aways || {}));
  if (S) { for (const id of S.lru || []) ids.add(id); for (const id of Object.keys(S.eintraege || {})) ids.add(id); for (const id of Object.keys(S.dyn || {})) ids.add(id); }
  for (const id of ids) if (!istHand(id) && W.AWAY_MAPS[id]) W.unregister(id);
  game.landepunkte = null;
}
function verdraengen(game) {
  const S = st(game);
  let gebaut = S.lru.filter((id) => game.aways[id] && !istHand(id));
  while (gebaut.length > maxGebaut(game)) {
    const opfer = gebaut.find((id) => !belegt(game, id));
    if (!opfer) break;
    sichern(game, opfer);
    delete game.aways[opfer];
    W.unregister(opfer);
    S.lru = S.lru.filter((x) => x !== opfer);
    gebaut = S.lru.filter((id) => game.aways[id] && !istHand(id));
  }
}
// Laufzeitzustand (aw.zustaende, aw.alarm) in den Weltstand-Eintrag
function sichern(game, lpId) {
  const aw = game.aways && game.aways[lpId];
  const e = st(game).eintraege[lpId];
  if (!aw || !e) return;
  const k = karte(game, lpId);
  const start = (k && k.zustaende) || {};
  const z = {};
  for (const id of Object.keys(aw.zustaende || {}).sort()) {
    if (aw.zustaende[id] !== start[id] || (e.zustaende && e.zustaende[id] != null)) z[id] = aw.zustaende[id];
  }
  // laufende Interaktionen werden nicht gespeichert (scharf -> intakt, laedt -> bereit; Fortschritt bleibt nicht)
  for (const id of Object.keys(z)) if (z[id] === 'scharf') z[id] = 'intakt'; else if (z[id] === 'laedt') z[id] = 'bereit'; else if (z[id] === 'gehalten') z[id] = 'ruhe';
  e.zustaende = z;
  e.alarm = !!aw.alarm;
}
// Ergebnis-Cache je (Landepunkt, Seed, Achsen, Schablone, bauversion): Prüfer, Kontext, Vorbau und get() bauen nur einmal.
// Gespeicherte Zustände stehen nicht im Schlüssel (sie ändern rows/anker nicht): get() setzt sie je Laufzeitkarte neu.
// Der Cache hält nur Rohkarten (ohne Laufzeit-/Weltstand-Zustände) und wird nie verändert (F6: nichts aus einer früheren
// Partie). Ein frischer Eintrag (noch ohne bauversion) findet die Karte über einen zweiten Schlüssel aus den Ausgangswerten
// – so nutzt eine neue Partie bzw. ein Vorbau außerhalb der Partie (sim-headless) denselben Bau.
const KARTEN_CACHE = new Map();
const CACHE_MAX = 64;
// Frischer Eintrag (bauversion null): die aktuelle Modul-Bauversion der Kartenart steht im Schlüssel, damit neu geladene
// Module/Schablonen nicht die alte Karte treffen (F9b); cacheLeeren(art) ist zusätzlich die Absicherung der Werkstatt.
function aktBauversion(art) { if (!art || art === 'hand') return 'hand'; try { return '~' + Buehne.bauversion(art); } catch (x) { return '~'; } }
function cacheKey(lpId, e) { return [lpId, e.seed, e.art, e.schablone, e.bauweise, e.besitz, e.zustand, e.bauversion != null ? e.bauversion : aktBauversion(e.art), nutztGenerator(lpId, e) ? 'gen' : 'modul'].join('|'); }
// cacheLeeren(art?): Karten-Cache dieser Kartenart (ohne art: ganz) leeren (Werkstatt nach dem Speichern eines Moduls). -> Zahl
function cacheLeeren(art) {
  let n = 0;
  for (const k of Array.from(KARTEN_CACHE.keys())) if (!art || k.split('|')[2] === art) { KARTEN_CACHE.delete(k); n++; }
  return n;
}
function cacheSetzen(key, roh) {
  if (KARTEN_CACHE.has(key)) KARTEN_CACHE.delete(key);
  while (KARTEN_CACHE.size >= CACHE_MAX) KARTEN_CACHE.delete(KARTEN_CACHE.keys().next().value);
  KARTEN_CACHE.set(key, roh);
}
function gebauteKarte(game, lpId, nurLesen) {
  const e = eintrag(game, lpId);
  if (!e) throw new Error(`Landepunkt ${lpId} unbekannt`);
  const key = cacheKey(lpId, e);
  let roh = KARTEN_CACHE.get(key);
  let alt = null;
  if (!roh) {
    alt = e.bauversion;
    roh = e.art === 'hand' ? Buehne.hand(lpId) : rohBauen(lpId, e);
    uebernehmen(e, roh);
    const key2 = cacheKey(lpId, e);   // nach dem Bau mit wirksamem Seed/bauversion
    cacheSetzen(key2, roh);
    if (alt == null && key2 !== key) cacheSetzen(key, roh);   // Ausgangsschlüssel (frischer Eintrag)
  } else if (e.bauversion == null) uebernehmen(e, roh);
  if (nurLesen) return roh;   // geteiltes Cache-Objekt, nie verändern
  return mitZustaenden(game, lpId, e, roh, alt);   // eigene Kopie (Zustände je Laufzeitkarte)
}
// Karte eines Landepunkts (ENGINE game.karteOf, Prüfer): registriert -> diese; Handkarte -> Buehne.hand; sonst gebaut (Cache)
function karte(game, lpId) {
  const r = W.AWAY_MAPS[lpId];
  if (r && r.karte) return r.karte;
  if (istHand(lpId)) return Buehne.hand(lpId);
  if (!eintrag(game, lpId)) return null;
  return gebauteKarte(game, lpId, true);   // nur lesen: geteiltes Cache-Objekt
}
// Vorbau außerhalb des Ticks (Szenenplanung, Ankunft am Ort): je Landepunkt ein setImmediate, Fehler zählen, nie werfen.
// fertig(err|null) optional. -> Zahl der eingeplanten Bauten
function vorbauen(game, lpIds, fertig) {
  const ids = (lpIds || []).filter((id) => !istHand(id) && def(game, id));
  const S0 = st(game);
  let i = 0;
  const schritt = () => {
    if (game.landepunkte !== S0) return;   // Partie zurückgesetzt bzw. Weltstand neu geladen: nichts mehr bauen
    if (i >= ids.length) { if (fertig) fertig(null); return; }
    const id = ids[i++];
    try { gebauteKarte(game, id, true); } catch (x) { countError(game, 'landepunkte-vorbau', x); }
    setImmediate(schritt);
  };
  if (ids.length) setImmediate(schritt); else if (fertig) setImmediate(() => fertig(null));
  return ids.length;
}
// Alle freien Landepunkte eines Orts vorbauen (Ankunft am Ort)
function vorbauenOrt(game, ort) { return vorbauen(game, liste(game, ort).filter((x) => x.frei && x.art !== 'hand').map((x) => x.id)); }
// verwerfen(game, id): nie gebrauchten neu-Landepunkt entfernen (Wunsch SPIELLEITER). Nur Laufzeit-Landepunkte (neu/prise),
// nicht belegt. -> true/false
function verwerfen(game, lpId) {
  const S = st(game);
  if (!S.dyn[lpId] || belegt(game, lpId)) return false;
  if (game.aways && game.aways[lpId]) { delete game.aways[lpId]; W.unregister(lpId); }
  S.lru = S.lru.filter((x) => x !== lpId);
  delete S.dyn[lpId]; delete S.eintraege[lpId];
  for (const k of Array.from(KARTEN_CACHE.keys())) if (k.startsWith(lpId + '|')) KARTEN_CACHE.delete(k);
  return true;
}

// ---------- Auswahl (cmd transfer.ziel) ----------
function tutorialErledigt(game) {
  const d = game.weltstand && game.weltstand.data;
  if (!d || !d.tutorial) return true;   // ohne Weltstand (Testgelände, m3): frei
  return d.tutorial === 'erledigt' || d.tutorial === 'uebersprungen';
}
// frei? -> null | Grund
function sperrgrund(game, lpId) {
  const d = def(game, lpId);
  if (!d) return 'Landepunkt unbekannt.';
  const e = st(game).eintraege[lpId];
  if (d.gesperrt || (e && e.gesperrt)) return 'Dieser Landepunkt ist gesperrt.';
  if (d.frei === 'nach_tutorial' && !tutorialErledigt(game)) return 'Erst nach der Ausbildung erreichbar.';
  if (d.frei === 'nach_raumgefecht' && !(e && e.frei)) return 'Noch nicht entdeckt – erst ein Raumgefecht dort.';
  if (d.frei === 'labor' && !game.labor) return 'Nur im Szenario-Labor erreichbar.';   // EK5: Platzhalter-Landepunkt, bis der Ort methalle existiert
  if (d.frei === 'finale') return require('./finale-boden.js').sperrgrund(game, lpId);   // SUND-04a-3: Schrein von Asgard, nur im Boden-Teil des Finales
  return null;
}
// Landepunkte eines Orts (Transfer-Konsole, Kontext): [{ id, name, art, bauweise, besitz, zustand, frei, gesperrt, grund, beam, inReichweite? }]
function liste(game, ort) {
  const o = ort || (game.ship && game.ship.scene);
  const out = [];
  const all = (defs().orte[o] || []).concat(Object.values(st(game).dyn).filter((d) => d.ort === o));
  for (const d of all) {
    if (d.frei === 'labor' && !game.labor) continue;   // Labor-Landepunkte erscheinen nur im Labor (Transfer-Konsole, Vorbau)
    if (d.frei === 'finale' && sperrgrund(game, d.id)) continue;   // SUND-04a-3: der Schrein erscheint nur im Boden-Teil des Finales
    const e = st(game).eintraege[d.id];
    const grund = sperrgrund(game, d.id);
    const r = { id: d.id, name: d.name || d.id, art: d.art, bauweise: (e && e.bauweise) || d.bauweise || null, besitz: (e && e.besitz) || d.besitz || null,
      zustand: (e && e.zustand) || d.zustand || null, frei: !grund, gesperrt: !!d.gesperrt, grund, beam: d.beam || null,
      besuche: e ? e.besuche : 0, alarm: !!(e && e.alarm) };
    if (game.ship && d.beam) r.inReichweite = Math.hypot(game.ship.x - d.beam.x, game.ship.y - d.beam.y) <= d.beam.range;
    out.push(r);
  }
  return out;
}
// waehlen(game, lpId, p) -> Fehlertext | null (legt bei Erfolg game.aways[lpId] an)
function waehlen(game, lpId, p) {
  const d = def(game, lpId);
  if (!d) return 'Landepunkt unbekannt.';
  const g = sperrgrund(game, lpId);
  if (g) return g;
  const ort = game.ship && game.ship.scene;
  if (d.ort && ort && d.ort !== ort) return 'Dieser Landepunkt liegt nicht an diesem Ort.';
  try { get(game, lpId); } catch (x) { countError(game, 'landepunkte-get', x); return 'Landepunkt nicht verfügbar (Karte ließ sich nicht bauen).'; }
  return null;
}
// Transferpunkt des gewählten Landepunkts (für away.beamSpot): { x, y, range, map } | null
function beamSpot(game) {
  const z = game.transferZiel;
  if (!z || !z.lp) return null;
  const d = def(game, z.lp);
  if (!d || !d.beam) return null;
  return { x: d.beam.x, y: d.beam.y, range: d.beam.range, map: z.lp };
}
// Betreten (erstes Hinunterbeamen in einer Mission) zählt Besuche
function betreten(game, lpId) {
  const e = eintrag(game, lpId);
  if (!e) return;
  e.besuche = (e.besuche || 0) + 1;
  if (game.mission && game.mission.id) e.letzte_mission = game.mission.id;
  e.neu = false;
}
// Raumgefecht: Landepunkte mit frei 'nach_raumgefecht' am Ort freischalten (ENTERN/SEKTOR rufen das)
function freigeben(game, lpId) {
  const e = eintrag(game, lpId);
  if (!e) return false;
  e.frei = true;
  return true;
}

// ---------- neue Landepunkte ----------
// Bauweise nach Besitzer (ORT-01 4b): die einzige Stelle, die aus Kartenart und Besitz die Bauweise eines NEUEN Landepunkts ableitet.
// Datentabelle: content/buehnen/achsen.json bauweise_nach_besitz.kartenarten.<art> { erlaubt, je_besitz: { <besitz>: <bauweise> } }.
// Ohne Eintrag, nicht freigegeben (erlaubt != true), unbekannter Besitz oder nicht aktive Bauweise: Standard der Kartenart.
// Gilt nur beim Anlegen (neu: Vorschau, Spielleiter, Debug); der Wert steht danach im Weltstand und wird nie neu abgeleitet
// (Eroberung baut nichts um, feste Landepunkte behalten ihre Bauweise).
function bauweiseFuerBesitz(art, besitz) {
  const ach = Buehne.daten().achsen || {};
  const std = ((ach.kartenarten || {})[art] || {}).bauweise || 'germanen';
  const t = ((ach.bauweise_nach_besitz || {}).kartenarten || {})[art];
  if (!t || t.erlaubt !== true) return std;
  const bw = (t.je_besitz || {})[besitz];
  return bw && ((ach.bauweisen || {})[bw] || {}).status === 'aktiv' ? bw : std;
}
// neu(game, ort, { art, besitz, bauweise?, zustand?, seed?, gen?, name?, id?, frei?, beam?, fluechtig? }) -> lpId (<ort>.<art>-<n>), neuer Seed
// SUND-04a-3: id = feste ID (statt <ort>.<art>-<n>; wirft, wenn sie belegt ist), frei = Freigabe ('immer' | 'finale'), beam = { x, y, range } (statt Ort),
// fluechtig = nie im Weltstand (wie ein Testgelände, aber ohne Testmarke)
function neu(game, ort, o) {
  o = o || {};
  if (!ort) throw new Error('neu: ort fehlt');
  if (!['aussenposten', 'station', 'ruine', 'schiff'].includes(o.art)) throw new Error(`neu: Kartenart ${o.art} unbekannt`);
  const S = st(game);
  let n = 1;
  while (defs().byId[`${ort}.${o.art}-${n}`] || S.dyn[`${ort}.${o.art}-${n}`] || S.eintraege[`${ort}.${o.art}-${n}`]) n++;
  let id = `${ort}.${o.art}-${n}`;
  if (o.id) {
    if (defs().byId[o.id] || S.dyn[o.id] || S.eintraege[o.id]) throw new Error(`neu: Landepunkt ${o.id} gibt es schon`);
    id = String(o.id);
  }
  const seed = o.seed != null ? (o.seed | 0) : ((Buehne.fnv(id + ':' + ((game.seed | 0) >>> 0) + ':' + Object.keys(S.eintraege).length) % 100000) + 1);
  const ach = Buehne.daten().achsen || { kartenarten: {} };
  const bw = o.bauweise || bauweiseFuerBesitz(o.art, o.besitz);
  const zs = o.zustand || ((ach.kartenarten[o.art] || {}).zustand) || 'intakt';
  const basis = defs().orte[ort] && defs().orte[ort][0];
  S.dyn[id] = { id, ort, art: o.art, bauweise: bw, besitz: o.besitz || 'herrenlos', zustand: zs, seed, schablone: o.schablone || null,
    beam: o.beam || (basis && basis.beam) || ortBeam(ort), name: o.name || null, frei: o.frei || 'immer', gesperrt: false, neu: true, ...(o.gen ? { gen: o.gen } : {}), ...(o.fluechtig ? { fluechtig: true } : {}) };
  const e = eintrag(game, id);
  e.neu = true; e.ort = ort;
  return id;
}
// testgelaende(game, params) -> lpId: Landepunkt für das Testgelände bzw. Debug `buehne` (B1 §4). Wie neu() am Ort kesh,
// aber als Test markiert: nie im Weltstand (F6).
const TEST_ORT = 'kesh';
function testgelaende(game, params) {
  const id = neu(game, (params && params.ort) || TEST_ORT, params || {});
  st(game).dyn[id].test = true;
  return id;
}
function ortBeam(ort) {
  const l = Locations.get(ort);
  const sc = l && l.scene;
  if (sc && sc.station) return { x: sc.station.x, y: sc.station.y, range: 360 };
  if (sc) return { x: Math.round(sc.w / 2), y: Math.round(sc.h / 2), range: 360 };
  return { x: 0, y: 0, range: 360 };
}
// prise(game, ort, gegner { id, fraktion, x, y, beam? }) -> lpId '<ort>.prise' (§7); beam z. B. aus Entern.beamPunkt: Schiff, germanen, Besitz = Fraktion, Seed aus der Gegner-ID, umkaempft
function prise(game, ort, gegner) {
  const g = gegner || {};
  const id = `${ort}.prise`;
  const S = st(game);
  const seed = (Buehne.fnv(String(g.id != null ? g.id : 'prise')) % 100000) + 1;
  S.dyn[id] = { id, ort, art: 'schiff', bauweise: 'germanen', besitz: g.fraktion || g.besitz || 'raubzug', zustand: 'umkaempft', seed, schablone: null,
    beam: g.beam ? { x: Math.round(g.beam.x), y: Math.round(g.beam.y), range: g.beam.range || (game.C && game.C.entern && game.C.entern.transferRange) || 300 }
      : { x: Math.round(g.x || 0), y: Math.round(g.y || 0), range: (game.C && game.C.entern && game.C.entern.transferRange) || 300 },
    name: 'Prise', frei: 'immer', gesperrt: false, neu: true, prise: true };
  // neue Prise = neuer Eintrag (alte Zustände gelten nicht)
  delete S.eintraege[id];
  if (game.aways && game.aways[id]) { delete game.aways[id]; W.unregister(id); S.lru = S.lru.filter((x) => x !== id); }
  const e = eintrag(game, id);
  e.ort = ort; e.prise = true;
  return id;
}
// Prise verfällt beim Verlassen der Szene, außer merken: dann treibendes Wrack (verfallen) am Ort unter neuer ID
// <ort>.wrack-<n> (Wunsch ENTERN: die ID <ort>.prise bleibt frei für die nächste Prise). -> neue ID | null
function priseVerlassen(game, ort, merken) {
  const id = `${ort}.prise`;
  const S = st(game);
  if (!S.dyn[id]) return null;
  const alt = S.dyn[id]; const altE = S.eintraege[id];
  if (game.aways && game.aways[id] && !belegt(game, id)) sichern(game, id);
  if (game.aways && game.aways[id] && !belegt(game, id)) { delete game.aways[id]; W.unregister(id); }
  S.lru = S.lru.filter((x) => x !== id);
  delete S.dyn[id]; delete S.eintraege[id];
  if (!merken) return null;
  let n = 1;
  while (defs().byId[`${ort}.wrack-${n}`] || S.dyn[`${ort}.wrack-${n}`] || S.eintraege[`${ort}.wrack-${n}`]) n++;
  const neuId = `${ort}.wrack-${n}`;
  S.dyn[neuId] = Object.assign({}, alt, { id: neuId, zustand: 'verfallen', prise: false, name: 'Treibendes Wrack', neu: false });
  const e = eintrag(game, neuId);
  if (altE) { e.seed = altE.seed; e.schablone = altE.schablone; e.bauversion = altE.bauversion; e.zustaende = altE.zustaende || {}; e.besuche = altE.besuche; }
  e.zustand = 'verfallen'; e.ort = ort;
  return neuId;
}

// ---------- Weltstand (welt.landepunkte, §8) ----------
const FELDER = ['seed', 'bauversion', 'schablone', 'art', 'bauweise', 'besitz', 'zustand', 'zustaende', 'alarm', 'besuche', 'letzte_mission', 'neu', 'gesperrt'];
function toSave(game) {
  const S = st(game);
  for (const id of Object.keys(game.aways || {})) if (S.eintraege[id] && !istHand(id)) sichern(game, id);
  const out = {};
  for (const id of Object.keys(S.eintraege).sort()) {
    if (S.dyn[id] && (S.dyn[id].test || S.dyn[id].fluechtig)) continue;   // Testgelände-Landepunkte nie in den Weltstand (F6); fluechtig: Schrein des Finales (SUND-04a-3), das nicht speicherbar ist
    const e = S.eintraege[id];
    const o = {};
    for (const f of FELDER) o[f] = e[f] === undefined ? null : JSON.parse(JSON.stringify(e[f]));
    if (!o.zustaende) o.zustaende = {};
    o.alarm = !!o.alarm; o.besuche = o.besuche | 0; o.neu = !!o.neu; o.gesperrt = !!o.gesperrt;
    // Laufzeit-Landepunkte (neu/prise) brauchen ihren Ort und Transferpunkt
    const d = S.dyn[id];
    if (d) { o.ort = d.ort; o.beam = d.beam; if (d.name) o.name = d.name; }
    if (e.frei) o.frei = true;
    out[id] = o;
  }
  return out;
}
function restore(block, game) {
  const S = st(game);
  // geladene Karten verwerfen (neuer Stand)
  for (const id of Object.keys(game.aways || {})) if (!istHand(id) && S.eintraege[id]) { delete game.aways[id]; W.unregister(id); }
  for (const id of S.lru) if (!istHand(id) && game.aways && game.aways[id]) { delete game.aways[id]; W.unregister(id); }
  S.eintraege = {}; S.lru = []; S.dyn = {}; S.halten = {}; S.ausstehend = {};
  for (const id of Object.keys(block || {}).sort()) {
    const b = block[id] || {};
    if (!defs().byId[id]) {
      if (!b.ort || !b.art) continue;   // unbekannt und ohne Ort: verwerfen
      S.dyn[id] = { id, ort: b.ort, art: b.art, bauweise: b.bauweise, besitz: b.besitz, zustand: b.zustand, seed: b.seed, schablone: b.schablone || null,
        beam: b.beam || ortBeam(b.ort), name: b.name || null, frei: 'immer', gesperrt: !!b.gesperrt, neu: !!b.neu };
    }
    const e = eintrag(game, id);
    if (!e) continue;
    for (const f of FELDER) if (b[f] !== undefined && b[f] !== null) e[f] = JSON.parse(JSON.stringify(b[f]));
    if (!e.zustaende || typeof e.zustaende !== 'object') e.zustaende = {};
    if (defs().byId[id] && defs().byId[id].gesperrt) e.gesperrt = true;   // Datei gewinnt (E33)
    if (b.frei) e.frei = true;
  }
}

// ---------- Kontext/Prüfer: Ankerzahlen einer (gebauten) Karte ----------
function ankerZahlen(game, lpId) {
  const k = karte(game, lpId);
  const out = {};
  if (k) for (const a of k.anker) out[a.rolle] = (out[a.rolle] || 0) + 1;
  return out;
}

// ---------- Debug (§9): lp list | lp neu <ort> <art> [besitz] | buehne <art> <seed> [bauweise|- besitz zustand variante|- fraktion] ----------
function debug(game, cmd, args, p) {
  args = args || [];
  if (cmd === 'lp') {
    const sub = args[0] || 'list';
    if (sub === 'list') {
      const ort = args[1] || (game.ship && game.ship.scene);
      const l = liste(game, ort).map((x) => `${x.id}${x.frei ? '' : ' (' + x.grund + ')'}${x.inReichweite ? ' *' : ''}`);
      const geladen = st(game).lru.filter((id) => game.aways[id]);
      if (game.notice && p) game.notice(p, `Landepunkte ${ort}: ${l.join(', ') || '–'} · geladen: ${geladen.join(', ') || '–'}`);
      return null;
    }
    if (sub === 'neu') {
      const id = neu(game, args[1] || (game.ship && game.ship.scene), { art: args[2] || 'ruine', besitz: args[3] });
      const err = waehlen(game, id, p);
      if (err) return err;
      game.transferZiel = { lp: id, scene: game.ship && game.ship.scene };
      if (game.setAwayMap) game.setAwayMap(id);
      if (game.notice && p) game.notice(p, `Neuer Landepunkt ${id} (Seed ${eintrag(game, id).seed}).`);
      return null;
    }
    if (sub === 'hin') {   // lp hin <id>: einen bestehenden Landepunkt (z. B. helix.station) laden und hinbeamen (Screenshots, QA)
      const id = args[1];
      try { get(game, id); } catch (x) { countError(game, 'debug-lp-hin', x); return 'lp hin: ' + x.message; }
      game.transferZiel = { lp: id, scene: Object.keys(defs().orte).find((o) => defs().orte[o].some((d) => d.id === id)) || (eintrag(game, id) || {}).ort || (game.ship && game.ship.scene) || 'kesh' };   // Szene des Landepunkts, nicht die des Schiffs
      if (game.setAwayMap) game.setAwayMap(id);
      try {
        const away = require('./away.js');
        const pids = (game.players || []).filter((q) => q.connected && q.zone === 'ship').map((q) => q.id);
        if (pids.length && typeof away.executeBeam === 'function') away.executeBeam(game, pids, 'down');
      } catch (x) { countError(game, 'debug-lp-hin-beam', x); }
      return null;
    }
    return 'lp list | lp neu <ort> <art> [besitz] | lp hin <id>';
  }
  if (cmd === 'buehne') {
    const art = args[0] || 'ruine';
    const seed = Number(args[1] || 1) | 0;
    const ort = (game.ship && game.ship.scene) || 'kesh';
    // 6. Wert (EK5/EK6): Generator-Variante methalle | eisenwald (Methalle: Militärsiedlung mit Rohr; Eisenwald: Siedlung mit Feldzeichen)
    const variante = ['methalle', 'eisenwald'].includes(args[5]) ? args[5] : null;
    const gen = variante ? { variante, typ: variante === 'methalle' ? 'militaer' : 'handel', haeuser: variante === 'methalle' ? 10 : 12 } : undefined;
    const id = testgelaende(game, { ort, art, seed, bauweise: args[2] && args[2] !== '-' ? args[2] : undefined, besitz: args[3], zustand: args[4], gen });   // Bauweise '-' = aus dem Besitz ableiten (bauweiseFuerBesitz)
    try { get(game, id); } catch (x) { countError(game, 'debug-buehne', x); return 'buehne: ' + x.message; }
    game.transferZiel = { lp: id, scene: ort };
    if (game.setAwayMap) game.setAwayMap(id);
    // hinbeamen: alle Spieler auf die Ankunft (Transfer-Modul entscheidet, sonst nur Ziel gesetzt)
    try {
      const away = require('./away.js');
      const pids = (game.players || []).filter((q) => q.connected && q.zone === 'ship').map((q) => q.id);
      if (pids.length && typeof away.executeBeam === 'function') away.executeBeam(game, pids, 'down');
    } catch (x) { countError(game, 'debug-buehne-beam', x); }
    // 7. Wert (ORT-01 4b): Fraktion, die die Karte besetzt (Stationskampf mit römischen Gegnern: buehne station 3 - rom umkaempft - rom)
    if (args[6] && args[6] !== '-') {
      try { const n = require('./combat.js').besetzen(game, { map: id, fraktion: args[6], staerke: 'mittel', haltung: 'wach', tag: 'debug', neue_rolle: null }); if (!n) return 'buehne: Besetzung mit ' + args[6] + ' ergab keine Gegner'; } catch (x) { countError(game, 'debug-buehne-besetzen', x); return 'buehne: ' + x.message; }
    }
    if (game.notice && p) game.notice(p, `Bühne ${id}: ${art} Seed ${eintrag(game, id).seed}, Bauweise ${eintrag(game, id).bauweise}${args[6] && args[6] !== '-' ? ', besetzt von ' + args[6] : ''}.`);
    return null;
  }
  return `${cmd}: unbekannt`;
}

module.exports = {
  MAX_GEBAUT, bauweiseFuerBesitz, vorwaermen, defs, neuLaden, get, karte, bauen, vorbauen, vorbauenOrt, verwerfen, liste, waehlen, sperrgrund, beamSpot, betreten, freigeben, neu, prise, priseVerlassen,
  toSave, restore, ankerZahlen, debug, sichern, eintrag,
  bereit, sobaldGeladen, zuruecksetzen, testgelaende, cacheLeeren,   // F1, F6, F9b
};
