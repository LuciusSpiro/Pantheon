'use strict';
// EK3 Teil A (CONTRACT-EK3): Fracht (Ladung) im Raum, Beamen an Bord und Abliefern von der Ops, Frachtraum der Lerche.
//
//   fracht_abwerfen(game, x, y, art)   Schnittstelle für die Konvoi-Szene (Teil B): ein zerstörter Transporter lässt Fracht fallen.
//   weapons.fracht { id? } / { off }   Ops: Halteprozess starten (nächste Fracht in Reichweite) bzw. abbrechen
//   weapons.abliefern                  Ops: Fracht beim Abnehmer abgeben (derselbe Halteprozess, Beamen nach draußen)
//
// Regeln (Briefing EK3, Planung E6):
//  - Jedes Modul Frachtraum (PAN-01 B: in jedem der vier Modulräume möglich, auch mehrfach) hat Maps.CARGO_PER_RAUM (4) Plätze: Kapazität = 4 × Frachträume.
//    Ohne Frachtraum nimmt das Schiff nichts an. LAD-01 A2 Typ-Regel: Ein Frachtraum fasst nur EINE Art Ladung (Personen sind eine Art wie jede andere). Die Belegung rechnet
//    Maps.frachtBelegung (Server und Client dieselbe Funktion), platzFuer(game, art) prüft sie, lagerAufnehmen(game, { art, quelle }) ist der EINZIGE Weg ins Lager (Beamen,
//    Debug/Skript, Beute, Zuteilung, Personen, Laden): nichts schreibt an ihm vorbei in s.lager. Ein Platz mehr oder eine fremde Art ohne freies Modul wird abgelehnt (mit Hinweistext).
//  - Beamen: Haltezeit ship.beamTime (3 s; bei beschädigtem Transfer ship.beamTimeDamaged), Reichweite fracht.beamRange (320, wie scene.beam.range
//    der Außenkarten). Ein Systemtreffer (interior.damageSystem) bricht ab, ein Schildtreffer nicht. Auch Transfer ausgefallen, Fracht
//    außer Reichweite oder niemand mehr an der Ops bricht ab. Der Halteprozess belegt nicht ship.beaming (Schilde bleiben oben).
//  - Eine Ladung im Raum bleibt, wo sie ist, bis die Lerche die Szene (das System) verlässt. Dann ist sie weg.
//  - Abliefern: beim Abnehmer (game.fracht.abnehmer.ort, vom Regiebuch gesetzt), sonst bei jeder Station (scene.station.kind in
//    fracht.stationKinds) im Umkreis fracht.stationRange.
//  - Mitgeführte Ladung steht im Weltstand (schiff.fracht = ['sprengstoff', …]); Ladungen im Raum nicht.
//  - Schnittstelle gesichert/ungesichert („Lager ohne Strom“, PAN-01 A): gesichert(game) / setGesichert(game, bool). Das Lager ist kein
//    Schiffssystem, aber das Modul Frachtraum (module.js): läuft es nicht (abgeschaltet oder ohne Strom), setzt module.update die Flagge auf false.
//    Wirkung: huellenTreffer(game) – bei jedem Hüllentreffer löst sich CONFIG.module.fracht.verlustJeTreffer Ladung (Ware; Personen: AP14 hängt sich
//    an gefaehrdet()), sie treibt hinter dem Schiff und kann neu gebeamt werden. Anzeige: Snapshot fracht.g = false (Taktik: UNGESICHERT).
const W = require('../world.js');
const Station = require('./station.js');   // R1 §4.4
const Locations = require('../../shared/locations.js');
const Waren = require('../../shared/waren.js');   // LAD-01 A1: Warenarten, Namen, Preise, Gewicht aus content/waren.json
const { dist } = require('../util.js');

const cfg = (game) => game.C.fracht;
// Kapazität (Waren und Personen) = 2 je Modul Frachtraum (module.js, lazy wegen Zirkelbezug)
const frachtRaeume = (game) => require('./module.js').frachtRaeume(game);
const capacity = (game) => W.Maps.cargoCapacity(frachtRaeume(game));
const r1 = (v) => Math.round(v * 10) / 10;

function neu() {
  return { lager: [], draussen: [], halt: null, gesichert: true, abnehmer: null, abgeliefert: {}, szene: null, seq: 0, zugang: {} };
}
function state(game) { return game.fracht || (game.fracht = neu()); }

const artOk = (game, art) => Waren.artOk(art);   // LAD-01 A1: jede Ware der Kategorie 'ware' in content/waren.json, keine feste Liste
const artName = (art) => Waren.name(art);

// ---------- Abfragen ----------
function anBord(game, art) { const s = state(game); return art ? s.lager.filter((l) => l.art === art).length : s.lager.length; }
function frei(game) { return capacity(game) - state(game).lager.length; }

// ---------- LAD-01 A2: Belegung, Typ-Regel, die eine Einlagerung ----------
const istPerson = (l) => l.art === 'person';
// Arten der Waren in Lagerreihenfolge und Zahl der Personen (die Eingabe von Maps.frachtBelegung); extra = eine Art, die probeweise dazukommt
function belegungsEingabe(game, extra) {
  const lager = state(game).lager;
  const waren = lager.filter((l) => !istPerson(l)).map((l) => l.art);
  let pers = lager.filter(istPerson).length;
  if (extra === 'person') pers++; else if (extra) waren.push(extra);
  return { waren, pers };
}
function belegung(game, extra) { const e = belegungsEingabe(game, extra); return W.Maps.frachtBelegung(frachtRaeume(game), e.waren, e.pers); }
// Die Plätze der Personen (Betten) in Lagerreihenfolge: [{ x, y, nr, raum, id }]; Person i liegt auf dem i-ten Platz der Personen-Module (personen-bord.js)
function personPlaetze(game) {
  const out = [];
  for (const m of belegung(game).module) if (m.art === 'person') for (let i = 0; i < m.anzahl; i++) out.push(m.plaetze[i]);
  return out;
}
const artLabel = (art) => (art === 'person' ? 'Personen' : artName(art));
function moduleText(b) { return b.module.filter((m) => m.art).map((m) => `${artLabel(m.art)} ${m.anzahl}/${W.Maps.CARGO_PER_RAUM}`).join(', '); }
// Prüfung, ob eine Ladung dieser Art ins Lager passt. -> { ok: true, raum, platz (Platz im Raum 0–3), nr } | { ok: false, grund, text }
// grund: 'unbekannt' (keine Ware) · 'kein_frachtraum' · 'voll' (alle Plätze belegt) · 'art_belegt' (Plätze frei, aber nur in Modulen mit anderer Art, oder das Modul dieser Art ist voll)
function platzFuer(game, art) {
  const a = art == null ? cfg(game).artDefault : String(art);
  if (a !== 'person' && !artOk(game, a)) return { ok: false, grund: 'unbekannt', text: 'Diese Ware lässt sich nicht laden.' };
  if (capacity(game) <= 0) return { ok: false, grund: 'kein_frachtraum', text: 'Kein Frachtraum eingebaut.' };
  const n = state(game).lager.length;
  if (n >= capacity(game)) return { ok: false, grund: 'voll', text: `Frachtraum voll (${n}/${capacity(game)})` };
  const b = belegung(game, a);
  if (b.ueber > 0) return { ok: false, grund: 'art_belegt', text: `Kein Frachtraum frei für ${artLabel(a)}: jedes Modul fasst nur eine Art Ladung (belegt: ${moduleText(belegung(game))}). Erst ein Modul leeren (abliefern, abgeben, abwerfen) oder einen weiteren Frachtraum einbauen.` };
  const mods = b.module.filter((m) => m.art === a);
  const m = mods[mods.length - 1];
  return { ok: true, raum: m.raum, platz: m.anzahl - 1, nr: m.plaetze[m.anzahl - 1].nr };
}
// Wie viele Ladungen dieser Art noch hineinpassen (Konvoi-Planung: reicht der Platz für die Beute?)
function freiFuer(game, art) {
  const e = belegungsEingabe(game, null); const R = frachtRaeume(game);
  let k = 0;
  while (k < capacity(game)) {
    const b = art === 'person' ? W.Maps.frachtBelegung(R, e.waren, e.pers + k + 1) : W.Maps.frachtBelegung(R, e.waren.concat(Array(k + 1).fill(art)), e.pers);
    if (b.ueber > 0) break;
    k++;
  }
  return k;
}
// Werft: Hat die Ladung nach dem Ausbau dieses Frachtraums noch Platz (Typ-Regel)? / liegt eine Person in diesem Raum?
function passtOhneRaum(game, raum) { const e = belegungsEingabe(game, null); return W.Maps.frachtBelegung(frachtRaeume(game).filter((q) => q !== raum), e.waren, e.pers).ueber === 0; }
function personImRaum(game, raum) { return belegung(game).module.some((m) => m.raum === raum && m.art === 'person'); }
// Wie viele Ladungen dieser Art das Schiff in seinem jetzigen Zustand insgesamt tragen kann (schon an Bord plus noch frei)
function kapazitaetFuer(game, art) { return anBord(game, art) + freiFuer(game, art); }
const QUELLEN = ['beamen', 'schoepfen', 'debug', 'skript', 'kampagne', 'zuteilung', 'beute', 'person', 'abbau', 'laden'];
// Die EINE Einlagerung. o: { art, quelle, person?, name? } (Personen tragen person und name). -> { ok: true, eintrag, raum, platz, nr } | { ok: false, grund, text }
// Kein Ereignis und keine ODA-Meldung hier: das tut der Aufrufer (der Weg kennt seinen Text). quelle wird gezählt (state.zugang, nur Laufzeit, nicht im Stand).
function lagerAufnehmen(game, o) {
  const s = state(game);
  const a = o && o.art != null ? String(o.art) : cfg(game).artDefault;
  if (!o || !QUELLEN.includes(o.quelle)) return { ok: false, grund: 'quelle', text: 'Unbekannte Quelle der Ladung.' };
  const pf = platzFuer(game, a);
  if (!pf.ok) return pf;
  const eintrag = a === 'person' ? { art: 'person', person: String(o.person), name: String(o.name != null ? o.name : o.person), bett: pf.nr } : { art: a };
  s.lager.push(eintrag);
  s.zugang[o.quelle] = (s.zugang[o.quelle] || 0) + 1;
  return { ok: true, eintrag, raum: pf.raum, platz: pf.platz, nr: pf.nr };
}
// Skript-Zuteilung ohne Softlock (Eisenwald k3/k4: Ersatz-Sprengstoff): passt die Art nur wegen einer fremden Art nicht hinein, räumt der Quartiermeister das kleinste Modul mit
// fremder Ware (nie Personen) aus. Gibt true zurück, wenn ausgeladen wurde.
function fremdesModulRaeumen(game, art) {
  const s = state(game);
  const b = belegung(game);
  if (b.module.some((m) => !m.art)) return false;
  const kand = b.module.filter((m) => m.art && m.art !== 'person' && m.art !== art).sort((x, y) => x.anzahl - y.anzahl)[0];
  if (!kand) return false;
  const n = s.lager.filter((l) => l.art === kand.art).length;
  s.lager = s.lager.filter((l) => l.art !== kand.art);
  game.oda(`Der Quartiermeister hat ${n}× ${artName(kand.art)} ausgeladen, damit der Frachtraum ${artLabel(art)} fassen kann.`, null);
  return true;
}
function gesichert(game) { return state(game).gesichert !== false; }
function setGesichert(game, on) { state(game).gesichert = !!on; }
// Was bei einem ungesicherten Lager gefährdet ist (Waren und Personen); AP14 (Personen als Fracht) wertet das später aus
function gefaehrdet(game) { return gesichert(game) ? [] : state(game).lager.slice(); }
function lagerArten(game) { return state(game).lager.map((l) => l.art); }
function draussen(game) { const s = state(game); return s.draussen.filter((d) => d.szene === game.ship.scene); }
function abgeliefert(game, art) { const a = state(game).abgeliefert; return art ? (a[art] || 0) : Object.values(a).reduce((x, y) => x + y, 0); }

const isDown = (st) => st === 'broken' || st === 'offline';   // wie interior.isDown (kein require: interior ruft systemTreffer auf)
const transferDown = (game) => isDown(game.ship.systems.transfer);
const haltDauer = (game) => (game.ship.systems.transfer === 'damaged' ? game.C.ship.beamTimeDamaged : game.C.ship.beamTime);
const taktikBesetzt = (game) => game.players.some((p) => p.connected && Station.stationOf(p) === 'weapons' && !p.downed);   // R1: aktive Station

// ---------- Fracht im Raum ----------
// Schnittstelle (Konvoi-Szene, Teil B): Fracht an Weltposition (x, y) der aktuellen Szene ablegen. Gibt das Objekt oder null zurück.
function fracht_abwerfen(game, x, y, art) {
  const s = state(game);
  const a = art == null ? cfg(game).artDefault : String(art);
  if (!artOk(game, a) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pod = { id: 'fr' + (++s.seq), x: r1(x), y: r1(y), art: a, szene: game.ship.scene };
  s.draussen.push(pod);
  // Höchstens maxDraussen je Szene (Netzbudget): die älteste fällt weg
  const hier = s.draussen.filter((d) => d.szene === pod.szene);
  if (hier.length > cfg(game).maxDraussen) s.draussen.splice(s.draussen.indexOf(hier[0]), 1);
  game.emit('frachtAbgeworfen', { id: pod.id, x: pod.x, y: pod.y, art: a });
  game.missionEvent('frachtAbgeworfen', { id: pod.id, art: a, x: pod.x, y: pod.y });
  return pod;
}

// PAN-01 A: Ungesichert (Frachtraum-Modul aus) + Hüllentreffer: die älteste Ware löst sich und treibt hinter dem Schiff (neu beamen möglich). Rückgabe: Anzahl.
// SYS-01 A1b: Auslöser ist ein Treffer auf das Frachtraum-Modul (Trefferweg, damage.systemSchaden), nicht mehr jeder Hüllenrest.
function frachtraumTreffer(game, sys) {
  const mm = /^modul_([1-4])$/.exec(String(sys || ''));
  return !!mm && require('./module.js').liste(game).some((m) => m.id === 'frachtraum' && m.raum === Number(mm[1]));
}
function huellenTreffer(game) {
  // SYS-01 A1b: ungesichert = ein Frachtraum ist aus ODER zerstört (ein zerstörtes Modul läuft nicht, gilt also als ungesichert).
  // Nur wer den Frachtraum bewusst abgeschaltet hat (Technik), trägt das Risiko. Fällt er nur durch Reaktorschaden aus (Notstrom), zeigt die Anzeige
  // UNGESICHERT, aber die Ladung bleibt: sonst ginge Kampagnen-Fracht (Konvoi, Eisenwald) durch einen Treffer auf den Reaktor verloren (Kette k2).
  const M = require('./module.js');
  const fr = M.liste(game).filter((m) => m.id === 'frachtraum');
  if (!fr.length) return 0;
  const aus = fr.some((m) => !m.an);
  const zerstoert = fr.some((m) => game.ship.systems['modul_' + m.raum] === 'broken');
  if (!aus && !zerstoert) return 0;
  const s = state(game); const sh = game.ship;
  const lim = (game.C.module && game.C.module.fracht && game.C.module.fracht.verlustJeTreffer) || 1;
  let n = 0;
  while (n < lim) {
    const i = s.lager.findIndex((l) => l.art !== 'person');
    if (i < 0) break;
    const l = s.lager.splice(i, 1)[0];
    n++;
    game.emit('frachtVerloren', { art: l.art });
    if (!sh.docked) { const pod = fracht_abwerfen(game, sh.x - Math.cos(sh.angle) * cfg(game).abwurfAbstand, sh.y - Math.sin(sh.angle) * cfg(game).abwurfAbstand, l.art); if (pod) pod.eigene = true; }
    const ortName = (Locations.get(sh.scene) || {}).name;
    game.oda(`${artName(l.art)} hat sich gelöst – der Frachtraum ist ungesichert!${!sh.docked && ortName ? ` Sie treibt in ${ortName}, dort wieder an Bord beamen.` : ''}`, null);
    game.missionEvent('frachtVerloren', { art: l.art, n: s.lager.length });
  }
  return n;
}

// ---------- Beamen (Halteprozess) ----------
function beamGrund(game) {
  if (transferDown(game)) return game.ship.systems.transfer === 'offline' ? 'Transfer offline (EMP) – kurz warten.' : 'Transfer zerstört – erst reparieren.';
  return null;
}
function naechste(game) {
  const sh = game.ship; const R = cfg(game).beamRange;
  let best = null; let bd = Infinity;
  for (const d of draussen(game)) { const k = dist(sh.x, sh.y, d.x, d.y); if (k <= R && k < bd) { best = d; bd = k; } }
  return best;
}
// Ops: Halteprozess „an Bord beamen“ starten. id: bestimmte Fracht, sonst die nächste in Reichweite. Rückgabe: Fehlertext | null.
function beamStart(game, p, id) {
  const s = state(game);
  if (s.halt) return 'Transfer läuft bereits.';
  const g = beamGrund(game); if (g) return g;
  if (frei(game) <= 0) return capacity(game) <= 0 ? 'Kein Frachtraum eingebaut.' : `Frachtraum voll (${anBord(game)}/${capacity(game)}) – erst abliefern.`;
  const draus = draussen(game);
  if (!draus.length) return 'Keine Fracht in diesem Gebiet.';
  const pod = id != null ? draus.find((d) => d.id === String(id)) : naechste(game);
  if (!pod) return id != null ? 'Diese Fracht gibt es nicht mehr.' : `Keine Fracht in Reichweite (max. ${cfg(game).beamRange}).`;
  const far = dist(game.ship.x, game.ship.y, pod.x, pod.y);
  if (far > cfg(game).beamRange) return `Fracht zu weit (${Math.round(far)}, max. ${cfg(game).beamRange}).`;
  const pf = platzFuer(game, pod.art); if (!pf.ok) return pf.text;   // LAD-01 A2: Typ-Regel (ein Modul, eine Art)
  s.halt = { kind: 'an', id: pod.id, t: 0, dur: haltDauer(game) };
  game.emit('frachtBeamen', { phase: 'start', was: 'an', id: pod.id, dur: s.halt.dur });
  return null;
}
// Abliefern: Ort prüfen. Rückgabe { ok, reason?, name? }
function ablieferOrt(game) {
  if (!state(game).lager.some((l) => l.art !== 'person')) return { ok: false, reason: 'Keine Fracht an Bord.' };   // SL0: Personen sind keine Ware (abgeben: personen-bord.js)
  return stationOrt(game);
}
// SL0: Abnehmer/Station in Reichweite, ohne Rücksicht darauf, was an Bord ist (auch für Personen)
function stationOrt(game) {
  const s = state(game); const sh = game.ship;
  const loc = Locations.get(sh.scene);
  const st = loc && loc.scene && loc.scene.station;
  if (s.abnehmer && s.abnehmer.ort && s.abnehmer.ort !== sh.scene) return { ok: false, reason: `Abnehmer ist ${s.abnehmer.name || s.abnehmer.ort} – nicht hier.` };
  if (!st || !(s.abnehmer && s.abnehmer.ort ? true : cfg(game).stationKinds.includes(st.kind))) return { ok: false, reason: 'Hier ist keine Station, die Fracht annimmt.' };
  const far = dist(sh.x, sh.y, st.x, st.y);
  if (far > cfg(game).stationRange) return { ok: false, reason: `Zu weit von der Station (${Math.round(far)}, max. ${cfg(game).stationRange}).` };
  return { ok: true, name: (s.abnehmer && s.abnehmer.name) || (loc && loc.name) || sh.scene };
}
function abliefernStart(game, p) {
  const s = state(game);
  if (s.halt) return 'Transfer läuft bereits.';
  const g = beamGrund(game); if (g) return g;
  const o = ablieferOrt(game); if (!o.ok) return o.reason;
  s.halt = { kind: 'ab', id: null, t: 0, dur: haltDauer(game), name: o.name };
  game.emit('frachtBeamen', { phase: 'start', was: 'ab', dur: s.halt.dur });
  return null;
}
function beamStop(game, grund, text) {
  const s = state(game);
  if (!s.halt) return false;
  const h = s.halt; s.halt = null;
  game.emit('frachtBeamen', { phase: 'abbruch', was: h.kind, grund });
  if (!text && h.kind === 'posten') text = require('./posten.js').stummerAbbruchText(h, grund);   // SUND-02b A1-Fix: Sprung (Szenenwechsel) und Ops verlassen melden sich auch
  if (text) game.oda(text, null);
  if (h.kind === 'posten' && h.id === 'verrat') require('./verrat.js').abbruchFunk(game, text, grund);   // SUND-02b E-Fix: Abbruch auch in den Lagefunk
  return true;
}
// Systemtreffer: Aufruf aus interior.damageSystem (Schildtreffer erreichen diese Funktion nie)
function systemTreffer(game, sys) {
  const s = game.fracht;
  if (s && s.halt) beamStop(game, 'systemtreffer', 'Transfer unterbrochen – Systemtreffer! Fracht-Beamen muss neu starten.');
}
function beamFertig(game) {
  const s = state(game); const h = s.halt; s.halt = null;
  if (h.kind === 'an') {
    const i = s.draussen.findIndex((d) => d.id === h.id);
    if (i < 0) return;
    const pod = s.draussen[i];
    const r = lagerAufnehmen(game, { art: pod.art, quelle: 'beamen' });
    if (!r.ok) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'an', grund: 'voll' }); game.oda(`${r.text}${r.grund === 'voll' ? ' – erst abliefern.' : ''}`, null); return; }
    s.draussen.splice(i, 1);
    game.emit('frachtBeamen', { phase: 'fertig', was: 'an', art: pod.art });
    game.oda(`${artName(pod.art)} an Bord (${s.lager.length}/${capacity(game)}).`, null);
    game.missionEvent('frachtAnBord', { art: pod.art, n: s.lager.length, id: pod.id });
  } else if (h.kind === 'person_an' || h.kind === 'person_ab') {   // SL0: Person beamen (server/sim/personen-bord.js)
    require('./personen-bord.js').haltFertig(game, h);
  } else if (h.kind === 'verk') {   // SL6: Verkaufen an einen Händler (server/sim/ladung.js)
    require('./ladung.js').verkaufFertig(game);
  } else if (h.kind === 'posten') {   // SUND-02b A1: Posten gründen / zum Stützpunkt ausbauen (server/sim/posten.js)
    require('./posten.js').haltFertig(game, h);
  } else {
    const o = ablieferOrt(game);
    if (!o.ok) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'ab', grund: 'ort' }); return; }
    const weg = s.lager.filter((l) => l.art !== 'person');   // SL0: Personen bleiben an Bord (eigener Halteprozess)
    s.lager = s.lager.filter((l) => l.art === 'person');
    for (const l of weg) s.abgeliefert[l.art] = (s.abgeliefert[l.art] || 0) + 1;
    game.emit('frachtBeamen', { phase: 'fertig', was: 'ab', n: weg.length });
    game.oda(`Fracht übergeben: ${weg.map((l) => artName(l.art)).join(', ')} – ${o.name}.`, null);
    game.missionEvent('frachtAbgeliefert', { n: weg.length, arten: weg.map((l) => l.art), ort: game.ship.scene, name: o.name });
  }
}

// ---------- Tick ----------
function update(game, dt) {
  const s = state(game);
  const sc = game.ship.scene;
  // Systemwechsel: Fracht im Raum ist weg (Szene verlassen). Ladung an Bord bleibt.
  if (s.szene !== sc) {
    s.szene = sc;
    if (s.halt) beamStop(game, 'szene');
    s.draussen = s.draussen.filter((d) => d.eigene);   // PAN-01 A: Ware, die sich im ungesicherten Frachtraum gelöst hat, bleibt für die Rückkehr im Sektor liegen
  }
  const h = s.halt;
  if (!h) return;
  if (transferDown(game)) return void beamStop(game, 'transfer', 'Transfer ausgefallen – Beamen abgebrochen.');
  if (h.kind === 'schoepf') {   // U2: Schöpfen läuft weiter, auch wenn die Ops verlassen wird (solo: Steuer halten); Ende nur per Ops-Aktion, Ring verlassen, voll, Transfer aus
    const r = require('./ladung.js').schoepfWeiter(game, dt);
    if (r) beamStop(game, r.stop, r.text);
    return;
  }
  if (!taktikBesetzt(game)) return void beamStop(game, 'taktik');
  if (h.kind === 'an') {
    const pod = s.draussen.find((d) => d.id === h.id);
    if (!pod) return void beamStop(game, 'weg');
    if (dist(game.ship.x, game.ship.y, pod.x, pod.y) > cfg(game).beamRange) return void beamStop(game, 'reichweite', 'Fracht außer Reichweite – Beamen abgebrochen.');
  } else if (h.kind === 'person_an' || h.kind === 'person_ab') { if (!require('./personen-bord.js').haltWeiter(game, h)) return void beamStop(game, 'ort', 'Person beamen abgebrochen.'); }   // SL0
  else if (h.kind === 'verk') { if (!require('./ladung.js').verkaufWeiter(game)) return void beamStop(game, 'ort'); }
  else if (h.kind === 'posten') { const r = require('./posten.js').haltWeiter(game, h); if (r) return void beamStop(game, r.code, r.text); }   // SUND-02b A1
  else if (!ablieferOrt(game).ok) return void beamStop(game, 'ort');
  h.t += dt;
  if (h.t >= h.dur) beamFertig(game);
}

// ---------- Snapshot / Weltstand ----------
// Kompakt (Budget): fehlt = Standard. lager ['art'], draussen [{ id, x, y, art }] (nur diese Szene), halt { kind, id?, p 0..1 },
// ab 1 = jetzt abgebbar, abn = Name des Abnehmers (nur wenn gesetzt), g false = ungesichert.
function snapshot(game) {
  const s = game.fracht;
  if (!s) return null;
  const draus = s.draussen.filter((d) => d.szene === game.ship.scene);
  const out = {};
  const ware = s.lager.filter((l) => l.art !== 'person');   // SL0: lager = nur Ware (Buchten), Personen stehen in pers
  if (ware.length) { out.lager = ware.map((l) => l.art); if (ablieferOrt(game).ok) out.ab = 1; }
  Object.assign(out, require('./personen-bord.js').snapshotZusatz(game));   // SL0: pers, pq
  if (draus.length) out.draussen = draus.map((d) => ({ id: d.id, x: d.x, y: d.y, art: d.art }));
  if (s.halt) { out.halt = { kind: s.halt.kind, p: s.halt.kind === 'schoepf' ? require('./ladung.js').fuellStand(game) : Math.round(Math.min(1, s.halt.t / s.halt.dur) * 100) / 100 }; if (s.halt.id) out.halt.id = s.halt.id; }
  if (s.abnehmer && s.abnehmer.name) out.abn = s.abnehmer.name;
  if (s.gesichert === false) out.g = false;
  { const fu = require('./ladung.js').fuellStand(game); if (fu) out.fuell = fu; }   // SL6: Füllstand der nächsten Deuterium-Einheit
  { const vk = require('./ladung.js').verkaufOrt(game); if (vk.ok) out.vk = 1; }   // SL6: Händler in Reichweite (Verkaufen möglich)
  return Object.keys(out).length ? out : null;
}
// SUND-04b B2 (Nacharbeit M1): die Beute einer laufenden Faden-Szene Konvoi (state.szenenBeute { art, vor }, nur Laufzeit) gehoert nicht in den Stand: die Szene ist nicht speicherbar, nach dem Laden gaebe es sie nicht mehr abzuliefern
function lagerOhneSzenenBeute(game) {
  const s = state(game), b = s.szenenBeute, lager = s.lager.slice();
  if (!b) return lager;
  let zuviel = Math.max(0, lager.filter((l) => l.art === b.art).length - b.vor);
  for (let i = lager.length - 1; i >= 0 && zuviel > 0; i--) if (lager[i].art === b.art) { lager.splice(i, 1); zuviel--; }
  return lager;
}
function toSave(game) { const P = require('./personen-bord.js'); const plaetze = personPlaetze(game); let pi = 0; return lagerOhneSzenenBeute(game).map((l) => (l.art === 'person' ? P.toSaveEntry(l, plaetze[pi++]) : l.art)); }   // SL0: Personen als { p, n, b }; b = Bettnummer (Platz der Personen-Module, abgeleitet)
function restore(game, arten) {
  const s = state(game);
  const P = require('./personen-bord.js');
  s.lager = [];
  // LAD-01 A2: auch das Laden geht durch lagerAufnehmen: was über Kapazität oder Typ-Regel hinausgeht (alte Stände, ausgebauter Frachtraum), wird gekappt und gemeldet
  let gekappt = 0;
  for (const a of Array.isArray(arten) ? arten : []) {
    const ok = typeof a === 'string' ? artOk(game, a) : !!(a && typeof a === 'object' && a.p);
    if (!ok) { gekappt++; continue; }
    const r = typeof a === 'string' ? lagerAufnehmen(game, { art: a, quelle: 'laden' }) : lagerAufnehmen(game, { art: P.ART, person: a.p, name: a.n, quelle: 'laden' });   // SL0: Personen { p, n, b }
    if (!r.ok) gekappt++;
  }
  if (gekappt && game.log) game.log(`Fracht: ${gekappt} Ladung(en) beim Laden verworfen (unbekannte Art, Kapazität oder Typ-Regel)`);
  s.halt = null;
}

// ---------- Regiebuch ----------
// fracht_abnehmer: ort = Orts-ID des Auftraggebers (null = jede Station), name = Anzeigename
function setAbnehmer(game, ort, name) { state(game).abnehmer = ort ? { ort: String(ort), name: name != null ? String(name) : null } : null; }
// fracht_abliefern aus dem Skript: Ladung (art, n) sofort übernehmen, ohne Ort/Halteprozess. Gibt die Anzahl zurück.
function skriptAbliefern(game, art, n) {
  const s = state(game); let k = 0; const lim = n == null ? Infinity : n;
  for (let i = s.lager.length - 1; i >= 0 && k < lim; i--) {
    if (art && s.lager[i].art !== art) continue;
    if (!art && s.lager[i].art === 'person') continue;   // SL0: Personen nie per Warenabgabe
    const l = s.lager.splice(i, 1)[0]; s.abgeliefert[l.art] = (s.abgeliefert[l.art] || 0) + 1; k++;
  }
  if (k) game.missionEvent('frachtAbgeliefert', { n: k, arten: art ? [art] : [], ort: game.ship.scene, name: null, skript: true });
  return k;
}
// SYS-03 C-Nacharbeit: Softlock-Ausweg der Abgabe. Liefert alles ab, was an Bord ist, und schreibt die fehlende Ladung bis `min` gut
// (die Ladung ist unterwegs verloren gegangen, z. B. Frachtraum zerstört; sonst bliebe die Abgabe unlösbar). Gibt die Anzahl der gutgeschriebenen Ladungen zurück.
function skriptAbliefernBis(game, art, min) {
  const s = state(game);
  skriptAbliefern(game, art, null);
  const fehlt = Math.max(0, min - abgeliefert(game, art));
  if (fehlt) {
    s.abgeliefert[art] = (s.abgeliefert[art] || 0) + fehlt;
    game.missionEvent('frachtAbgeliefert', { n: fehlt, arten: [art], ort: game.ship.scene, name: null, skript: true });
  }
  return fehlt;
}
// Ladung direkt an Bord legen (Debug, Tests, Skript, Schöpfen); false = kein Platz (Typ-Regel, voll) bzw. unbekannte Art. quelle: eine aus QUELLEN (Standard 'skript')
function anBordLegen(game, art, quelle) {
  const a = art == null ? cfg(game).artDefault : String(art);
  const r = lagerAufnehmen(game, { art: a, quelle: quelle || 'skript' });
  if (!r.ok) return false;
  game.missionEvent('frachtAnBord', { art: a, n: state(game).lager.length });
  return true;
}
// fracht_zuteilen (Regiebuch): wie anBordLegen, aber ein Typkonflikt mit fremder Ware wird vom Quartiermeister aufgelöst (kein Softlock in der Kette)
function zuteilen(game, art) {
  const a = art == null ? cfg(game).artDefault : String(art);
  let pf = platzFuer(game, a);
  if (!pf.ok && pf.grund === 'art_belegt' && fremdesModulRaeumen(game, a)) pf = platzFuer(game, a);
  if (!pf.ok) { game.oda(pf.text, null); return false; }
  return anBordLegen(game, a, 'zuteilung');
}

// ---------- Debug: fracht <abwerfen [art] [dx dy] | an [art] | leer | gesichert an|aus | abnehmer [ort] | status> ----------
function debug(game, args) {
  const s = state(game); const sh = game.ship;
  const sub = args[0] || 'status';
  if (sub === 'abwerfen') {
    const art = args[1] && Number.isNaN(Number(args[1])) ? args[1] : null;
    const nums = args.slice(1).filter((a) => !Number.isNaN(Number(a))).map(Number);
    const dx = nums.length >= 2 ? nums[0] : 160, dy = nums.length >= 2 ? nums[1] : 0;
    if (game.ship.docked) return 'Nicht angedockt (Fracht liegt im freien Raum).';
    return fracht_abwerfen(game, sh.x + dx, sh.y + dy, art) ? null : 'Unbekannte Art (sprengstoff | fracht).';
  }
  if (sub === 'person') return require('./personen-bord.js').personAnBordLegen(game, args[1] || 'evert', args[2] || null) ? null : 'Frachtraum voll.';   // SL0: fracht person [id] [name]
  if (sub === 'an') return anBordLegen(game, args[1]) ? null : 'Frachtraum voll oder unbekannte Art.';
  if (sub === 'leer') { s.lager = []; s.draussen = []; s.halt = null; return null; }   // SL0: leert auch Personen
  if (sub === 'gesichert') { setGesichert(game, args[1] !== 'aus'); return null; }
  if (sub === 'abnehmer') { setAbnehmer(game, args[1] || null, args[2] || null); return null; }
  game.log(`Fracht: Lager ${JSON.stringify(lagerArten(game))}, draußen ${draussen(game).length}, Halt ${s.halt ? JSON.stringify(s.halt) : '-'}, gesichert ${gesichert(game)}, Abnehmer ${s.abnehmer ? s.abnehmer.ort : '-'}`);
  return null;
}

module.exports = {
  neu, state, update, snapshot, toSave, restore, debug,
  fracht_abwerfen, abwerfen: fracht_abwerfen,
  beamStart, abliefernStart, beamStop, systemTreffer, ablieferOrt, stationOrt,
  anBord, frei, capacity, platzFuer, freiFuer, kapazitaetFuer, passtOhneRaum, personImRaum, lagerAufnehmen, zuteilen, belegung, personPlaetze, gesichert, setGesichert, gefaehrdet, huellenTreffer, frachtraumTreffer, lagerArten, draussen, abgeliefert,
  setAbnehmer, skriptAbliefern, skriptAbliefernBis, anBordLegen, artOk, artName,
};
