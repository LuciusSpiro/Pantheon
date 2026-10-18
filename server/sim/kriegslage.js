'use strict';
// SUND-01 B: Kopplung der Weltsimulation (server/weltsim) an das Spiel, nur im Modus „Freie Fahrt Sund“.
// Action-Layer. Zustand: game.weltsim = { zustand, tickZahl, fehler, ereignisse[], hauptweltGefallen } | null (Kampagne, Limes, Labor, Arena).
//   starten(game, seed?)      Modus beginnen: Sim erzeugen (eigener Zufallsstrom aus dem Spiel-Seed), Besitz-Overlay füllen
//   tick(game, quelle)        genau ein Sim-Tick (Aufrufer: Sprung, Schnellsprung-Hop, Notfallsprung – sonst niemand). Ohne Modus: nichts
//   szeneNachziehen(game)     Andock-Erlaubnis und Banner der aktuellen Szene nach einem Tick ohne Szenenwechsel neu setzen
//   nachLaden(game)           nach dem Laden: keine Angebote der Kampagne, Szene nachziehen
//   toSave(game) / restore(game, block) / reset(game)   Weltstand-Block welt.sim (inkl. welt.sim.wissen, SUND-01 C)
//   sondeGesichtet(game, hex)  Hook von Sektorplan.sichten: Sonden-Sichtung ins Wissen von Rom (sofort, ohne Verzögerung)
//   lage(game) / lageSchluessel(game)  Anzeigeblock world.lage und Änderungsschlüssel (nur im Modus, Wissen statt Wahrheit)
// Die Sim hat ihren eigenen Zufallsstrom (zustand.zufall) und fasst game.rng nie an. Rohereignisse bleiben auf dem Server (Ring, nicht gespeichert);
// Paket C baut daraus das Wissen. Der Sim-Zustand wird OHNE `werte` und `karte` gespeichert (kein Ballast im Speicherstand): beim Laden kommen beide
// wieder aus content/welt/sund-sim.json und sund-sim-werte.json.
// Besitz-Overlay (Paket D): game.weltBesitz.hexe[hex] = { besitzer, posten } für alle Sim-Hexe, Karten-Fraktionsnamen (rom, ger, saum, pirat, frei).
const Kern = require('../weltsim/kern.js');
const Daten = require('../weltsim/daten.js');
const Besitz = require('./besitz.js');
const Wissen = require('./kriegslage-wissen.js');   // SUND-01 C: Wissensmodell von Rom (Anzeigeblock world.lage, Funk)
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');

const MODUS = 'freie_fahrt';
const KARTE = 'sund_frei';
const RING = 120;   // letzte Ereignisse, die der Server für das Wissen (Paket C) bereithält
const KARTEN_FRAKTION = { rom: 'rom', ger: 'ger', kon: 'saum', pirat: 'pirat' };   // Sim -> Fraktionsname der Karte, null (frei) -> 'frei'
const HAUPTWELT_TEXT = { rom: 'Palatina ist gefallen.', ger: 'Hrafnheim ist gefallen.' };   // Platzhalter bis SUND-04

let quelle = null;   // Karte und Werte der Sim, einmal je Prozess gelesen
const daten = () => quelle || (quelle = Daten.laden());
const klon = (v) => JSON.parse(JSON.stringify(v));
const seedAus = (spielSeed) => ((Number(spielSeed) | 0) ^ 0x53554E44) >>> 0;   // „SUND“: eigener Strom, nie game.rng

// Sim-Zustand ohne werte und karte (reine JSON-Daten, Tiefenkopie)
function abbild(z) {
  const out = {};
  for (const k of Object.keys(z)) if (k !== 'werte' && k !== 'karte') out[k] = klon(z[k]);
  return out;
}
// Abbild + werte/karte (frisch aus den Dateien) -> vollständiger Zustand
function voll(ab) {
  const d = daten();
  const frisch = Kern.erzeuge({ karte: d.karte, werte: d.werte, seed: 0 });
  const z = Object.assign({}, klon(ab), { werte: frisch.werte, karte: frisch.karte });
  return z;
}
function abbildOk(ab) {
  return !!ab && typeof ab === 'object' && ab.version === 1 && Number.isFinite(ab.tick) && Number.isFinite(ab.zufall) && ab.hexe && typeof ab.hexe === 'object'
    && Array.isArray(ab.flotten) && Array.isArray(ab.angriffe) && ab.vorrat && ab.marken && Number.isFinite(ab.naechsteId)
    && daten().karte.hexe.every((h) => ab.hexe[h.code] && typeof ab.hexe[h.code] === 'object');   // jedes Sim-Hex muss da sein, sonst wirft der erste Tick
}

function reset(game) { game.weltsim = null; game.weltBesitz = null; }

// Besitz-Overlay für Banner, Posten und Andocken aus dem Sim-Zustand füllen (nur Sim-Hexe; Sonderorte bleiben statisch)
function overlayFuellen(game) {
  const ws = game.weltsim;
  if (!ws) { game.weltBesitz = null; return; }
  const hexe = {};
  for (const [code, nd] of Object.entries(ws.zustand.hexe)) hexe[code] = { besitzer: nd.besitzer ? (KARTEN_FRAKTION[nd.besitzer] || 'frei') : 'frei', posten: !!nd.posten };
  game.weltBesitz = { hexe };
}

function starten(game, seed) {
  const d = daten();
  const z = Kern.erzeuge({ karte: d.karte, werte: d.werte, seed: seed == null ? seedAus(game.seed) : seed });
  game.weltsim = { zustand: z, tickZahl: 0, fehler: 0, ereignisse: [], hauptweltGefallen: null, wissen: null };
  overlayFuellen(game);
  try { Wissen.starten(game); } catch (e) { if (game.countError) game.countError('kriegslage-wissen', e); }
  return game.weltsim;
}

// Ein Tick. wo: 'sprung' | 'hop' | 'notsprung' (nur für Zähler und Tests). nachOrt: Ort/Hex, in dem die Lerche nach dem Sprung steht (Sensorknoten des
// Wissens; ohne Angabe der aktuelle Ort des Schiffs). -> Ereignisse des Ticks | null (kein Modus oder Fehler)
function tick(game, wo, nachOrt) {
  const ws = game.weltsim;
  if (!ws) return null;
  const sicher = abbild(ws.zustand);   // Rückfall, falls die Sim mitten im Tick wirft (der halbe Tick darf nie stehen bleiben)
  let ev;
  try {
    ev = Kern.tick(ws.zustand, {}).ereignisse;
  } catch (e) {
    ws.zustand = Object.assign(sicher, { werte: ws.zustand.werte, karte: ws.zustand.karte });
    ws.fehler++;
    if (game.countError) game.countError('kriegslage-tick', e);
    return null;
  }
  ws.tickZahl++;
  ws.letzteQuelle = wo || null;
  for (const e of ev) { ws.ereignisse.push(Object.assign({ n: ws.tickZahl }, e)); }
  if (ws.ereignisse.length > RING) ws.ereignisse.splice(0, ws.ereignisse.length - RING);
  overlayFuellen(game);
  try { Wissen.nachTick(game, sicher, ev, nachOrt); } catch (e) { if (game.countError) game.countError('kriegslage-wissen', e); }   // SUND-01 C: nach dem Tick, vor dem Szenenaufbau
  try { for (const e of ev) if (e.typ === 'hauptwelt_gefallen') hauptweltFaellt(game, e); } catch (e) { if (game.countError) game.countError('kriegslage-hauptwelt', e); }
  return ev;
}

// Platzhalter bis SUND-04 (Abspann): Merker, Meldung, Missionsereignis; das Spiel läuft weiter
function hauptweltFaellt(game, e) {
  const ws = game.weltsim;
  const wer = e.alt === 'rom' ? 'rom' : 'ger';
  if (wer === 'rom' && !ws.hauptweltGefallen) ws.hauptweltGefallen = { fraktion: 'rom', tick: ws.tickZahl };
  game.oda(HAUPTWELT_TEXT[wer], wer === 'rom' ? 'kriegslage_hauptwelt_rom' : null);
  game.missionEvent('hauptwelt_gefallen', { fraktion: wer, ort: e.ort, neu: e.neu, tick: ws.tickZahl });
}

// Andock-Erlaubnis und Banner der Szene, in der das Schiff steht, neu setzen (nach einem Tick oder Laden ohne enterScene)
function szeneNachziehen(game) {
  const sp = game.space; const ship = game.ship;
  if (!sp || !ship || !ship.scene) return;
  const loc = Locations.get(ship.scene);
  if (!loc || !loc.scene) return;
  const hex = loc.hex || Sektoren.hexVonOrt(loc.id);
  if (!hex) return;
  const sc = loc.scene;
  sp.dockOk = !sc.dock || Besitz.darfAndocken(game, hex);
  const fr = Besitz.besitzer(game, hex);
  const m = sp.markers || [];
  for (const k of m) if ('fr' in k) k.fr = fr;
  const i = m.findIndex((k) => k.kind === 'dock');
  if (sc.dock && sp.dockOk && i < 0) m.push({ kind: 'dock', x: sc.dock.x, y: sc.dock.y, r: game.C.travel.dockDist });
  else if (i >= 0 && !sp.dockOk) m.splice(i, 1);
}

function nachLaden(game) {
  if (!game.weltsim) return;
  if (game.mission) game.mission.mode = null;   // mission.restore setzt 'campaign': hier gibt es keine Angebote der Limes-Kampagne
  szeneNachziehen(game);
  try { Wissen.markenNeu(game); } catch (e) { if (game.countError) game.countError('kriegslage-wissen', e); }   // Notruf-Marken stehen nicht im Weltstand
}

// Sonden-Sichtung (Hook in Sektorplan.sichten): sofort ins Wissen, ohne Verzögerung
function sondeGesichtet(game, hex) {
  if (!game.weltsim) return;
  try { Wissen.sondeGesichtet(game, hex); } catch (e) { if (game.countError) game.countError('kriegslage-wissen', e); }
}
const lage = (game) => (game.weltsim ? Wissen.lage(game) : null);
const lageSchluessel = (game) => (game.weltsim ? Wissen.schluessel(game) : null);

// Weltstand welt.sim: { modus, tick, hauptweltGefallen?, zustand } | null (kein Modus: Block fehlt, Altstände bleiben Kampagne)
function toSave(game) {
  const ws = game.weltsim;
  if (!ws) return null;
  const b = { modus: MODUS, tick: ws.tickZahl, zustand: abbild(ws.zustand) };
  const wi = Wissen.toSave(ws); if (wi) b.wissen = wi;
  if (ws.hauptweltGefallen) b.hauptweltGefallen = { fraktion: String(ws.hauptweltGefallen.fraktion), tick: ws.hauptweltGefallen.tick };
  return b;
}
function restore(game, b) {
  reset(game);
  if (!b || typeof b !== 'object' || b.modus !== MODUS) return;
  const tickZahl = Number.isFinite(b.tick) && b.tick >= 0 ? Math.floor(b.tick) : 0;
  if (abbildOk(b.zustand)) {
    game.weltsim = { zustand: voll(b.zustand), tickZahl, fehler: 0, ereignisse: [], hauptweltGefallen: null, wissen: null };
    try { Wissen.restore(game, b.wissen); } catch (e) { if (game.countError) game.countError('kriegslage-wissen', e); }
  } else {
    if (game.countError) game.countError('kriegslage-restore', new Error('welt.sim: Sim-Zustand unbrauchbar – neue Welt'));
    starten(game);
    game.weltsim.tickZahl = tickZahl;
  }
  const h = b.hauptweltGefallen;
  if (h && typeof h === 'object' && Number.isFinite(h.tick)) game.weltsim.hauptweltGefallen = { fraktion: String(h.fraktion || 'rom'), tick: h.tick };
  overlayFuellen(game);
  szeneNachziehen(game);
}

module.exports = { MODUS, KARTE, RING, seedAus, abbild, starten, tick, szeneNachziehen, nachLaden, toSave, restore, reset, sondeGesichtet, lage, lageSchluessel };
