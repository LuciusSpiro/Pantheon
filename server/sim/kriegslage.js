'use strict';
// SUND-01 B: Kopplung der Weltsimulation (server/weltsim) an das Spiel, nur im Modus „Freie Fahrt Sund“.
// Action-Layer. Zustand: game.weltsim = { zustand, tickZahl, fehler, ereignisse[], hauptweltGefallen } | null (Kampagne, Limes, Labor, Arena).
//   starten(game, seed?)      Modus beginnen: Sim erzeugen (eigener Zufallsstrom aus dem Spiel-Seed), Besitz-Overlay füllen
//   tick(game, quelle)        genau ein Sim-Tick (Aufrufer: Sprung, Schnellsprung-Hop, Notfallsprung – sonst niemand). Ohne Modus: nichts
//   (SUND-02a A2) Die Sim-Szene (kriegslage-szene.js, game.simSzene) hängt hier mit zwei Stellen: tick() merkt beim Sprung die Verluste einer laufenden Szene VOR dem
//   Tick vor (Flucht, der Sprung-Tick ist der eine Tick); szeneAbschliessen() ist das Ende bei Sieg und Niederlage. reset() räumt game.simSzene mit weg.
//   szeneAbschliessen(game, { wirkungen, wo })   SUND-02: Szenenende OHNE Sprung (Sieg, Bleiben): Wirkungen der Crew + genau ein eigener Tick
//   wirkungenVormerken(game, wirkungen)          SUND-02: Szenenende MIT Sprung (Flucht): Wirkungen merken, der Sprung-Tick wendet sie an (kein zweiter Tick)
//   Beides atomar: gültige Wirkungen gelten, ungültige werden verworfen und gemeldet, ein Wurf rollt auf die Sicherung zurück. Gespeichert wird nie
//   mitten im Tick (Speichern gibt es nur an Docks, nie während eines Sprungs oder einer Szenenauflösung). Formate: server/weltsim/wirkungen.js.
//   szeneNachziehen(game)     Andock-Erlaubnis, Banner und Posten-Marker der aktuellen Szene nach einem Tick ohne Szenenwechsel neu setzen
//   nachLaden(game)           nach dem Laden: keine Angebote der Kampagne, Szene nachziehen
//   toSave(game) / restore(game, block) / reset(game)   Weltstand-Block welt.sim (inkl. welt.sim.wissen, SUND-01 C; optional kommandanten und vorgemerkt, SUND-02)
//   (SUND-02b B) welt.sim.ruf: { rom, ger, kon } (optional, Altstände = 0, server/sim/ruf.js). Die Wirkung ruf_aenderung prüft der Katalog, der Kern ignoriert sie; tickMit wendet sie NACH dem Tick an (Ruf.anwenden), im selben
//   Atom: wirft der Tick, geht auch der Ruf auf die Sicherung zurück. Rangwechsel-Funk erst nach dem Commit.
//   welt.sim.kommandanten: Gedächtnis { Name: { fraktion, schicksal: 'entkommen'|'gefallen', begegnungen, tick } }; welt.sim.vorgemerkt: [Wirkung] für den nächsten Tick
//   sondeGesichtet(game, hex)  Hook von Sektorplan.sichten: Sonden-Sichtung ins Wissen von Rom (sofort, ohne Verzögerung)
//   lage(game) / lageSchluessel(game)  Anzeigeblock world.lage und Änderungsschlüssel (nur im Modus, Wissen statt Wahrheit)
// Die Sim hat ihren eigenen Zufallsstrom (zustand.zufall) und fasst game.rng nie an. Rohereignisse bleiben auf dem Server (Ring, nicht gespeichert);
// Paket C baut daraus das Wissen. Der Sim-Zustand wird OHNE `werte` und `karte` gespeichert (kein Ballast im Speicherstand): beim Laden kommen beide
// wieder aus content/welt/sund-sim.json und sund-sim-werte.json.
// Besitz-Overlay (Paket D): game.weltBesitz.hexe[hex] = { besitzer, posten } für alle Sim-Hexe, Karten-Fraktionsnamen (rom, ger, saum, pirat, frei).
const Kern = require('../weltsim/kern.js');
const Daten = require('../weltsim/daten.js');
const Besitz = require('./besitz.js');
const Posten = require('./posten.js');   // SUND-02b A1: Posten der Crew (Halten, Weltstand welt.sim.posten)
const Ruf = require('./ruf.js');   // SUND-02b B: Ruf je Fraktion, Dienstgrade von Rom (welt.sim.ruf)
const Wissen = require('./kriegslage-wissen.js');   // SUND-01 C: Wissensmodell von Rom (Anzeigeblock world.lage, Funk)
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');

const MODUS = 'freie_fahrt';
const KARTE = 'sund_frei';
const RING = 120;   // letzte Ereignisse, die der Server für das Wissen (Paket C) bereithält
const KARTEN_FRAKTION = { rom: 'rom', ger: 'ger', kon: 'saum', pirat: 'pirat' };   // Sim -> Fraktionsname der Karte, null (frei) -> 'frei'
const HAUPTWELT_TEXT = { rom: 'Palatina ist gefallen.', ger: 'Hrafnheim ist gefallen.' };   // Platzhalter bis SUND-04
const KOMMANDANTEN_MAX = 100;   // Gedächtnis der Kommandanten: die ältesten fliegen zuerst raus
const VORGEMERKT_MAX = 50;
const STOERUNG_TEXT = 'Kriegslage gestört.';   // Platzhalter bis SUND-04: ein Tick-Fehler friert die Sim ein (jeder Folgetick scheitert gleich), die Crew soll es wenigstens erfahren

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
  if (!Number.isFinite(z.naechsteAngriffId)) z.naechsteAngriffId = z.angriffe.reduce((m, a) => Math.max(m, a.id), 0) + 1;   // Altstand vor SUND-01 E
  return z;
}
function abbildOk(ab) {
  return !!ab && typeof ab === 'object' && ab.version === 1 && Number.isFinite(ab.tick) && Number.isFinite(ab.zufall) && ab.hexe && typeof ab.hexe === 'object'
    && Array.isArray(ab.flotten) && Array.isArray(ab.angriffe) && ab.vorrat && ab.marken && Number.isFinite(ab.naechsteId)
    && daten().karte.hexe.every((h) => ab.hexe[h.code] && typeof ab.hexe[h.code] === 'object');   // jedes Sim-Hex muss da sein, sonst wirft der erste Tick
}

// auch restore() ruft reset(): die Ergebniszeile eines alten Szenenendes (simSzeneEnde, absolute Spielzeit) darf nie in eine neue Partie oder einen geladenen Stand ragen
function reset(game) { game.weltsim = null; game.weltBesitz = null; game.simSzene = null; game.simSzeneLetzte = null; game.simSzeneEnde = null; }

// Besitz-Overlay für Banner, Posten und Andocken aus dem Sim-Zustand füllen (nur Sim-Hexe; Sonderorte bleiben statisch)
function overlayFuellen(game) {
  const ws = game.weltsim;
  if (!ws) { game.weltBesitz = null; return; }
  const hexe = {};
  for (const [code, nd] of Object.entries(ws.zustand.hexe)) hexe[code] = { besitzer: nd.besitzer ? (KARTEN_FRAKTION[nd.besitzer] || 'frei') : 'frei', posten: !!nd.posten };
  for (const [code, nd] of Object.entries(ws.zustand.hexe)) if (nd.crew === true && nd.posten && nd.besitzer === 'rom' && nd.garnison > 0) hexe[code].crew = true;   // SUND-02b A1: Stützpunkt der Crew (Dock, Werft); additiv, ohne crew ändert sich nichts
  game.weltBesitz = { hexe };
}

// Neue Sim und neues Wissen (auch der Rückfall von restore(), wenn der gespeicherte Zustand unbrauchbar ist: dort bleibt die Erkundung des Standes)
function neueSim(game, seed) {
  const d = daten();
  const z = Kern.erzeuge({ karte: d.karte, werte: d.werte, seed: seed == null ? seedAus(game.seed) : seed });
  game.weltsim = { zustand: z, tickZahl: 0, fehler: 0, ereignisse: [], hauptweltGefallen: null, wissen: null, kommandanten: {}, vorgemerkt: [], ruf: Ruf.neu(), posten: {}, wirkungenAngewandt: 0, wirkungenVerworfen: 0 };
  overlayFuellen(game);
  try { Wissen.starten(game); } catch (e) { if (game.countError) game.countError('kriegslage-wissen', e); }
  return game.weltsim;
}

// Modus beginnen: Sim erzeugen und die Gebiete erkunden, die die Crew laut Karte (start.erkundet, start.bojen) schon kennt: bei sund_frei das Gebiet von
// Rom und Konkordat samt Bojen der Kanten hinaus (Spielerkenntnis, nicht Wissen der Sim: das Wissensmodell von Rom bleibt, wie es ist).
function starten(game, seed) {
  const ws = neueSim(game, seed);
  try {
    const v = Sektoren.vorerkundetBeiStart();
    if (game.explore && (v.hexe.length || v.bojen.length)) game.explore.vorerkunden(v.hexe, v.bojen);
  } catch (e) { if (game.countError) game.countError('kriegslage-vorerkundung', e); }
  return ws;
}

// Ein Tick. wo: 'sprung' | 'hop' | 'notsprung' (nur für Zähler und Tests). nachOrt: Ort/Hex, in dem die Lerche nach dem Sprung steht (Sensorknoten des
// Wissens; ohne Angabe der aktuelle Ort des Schiffs). -> Ereignisse des Ticks | null (kein Modus oder Fehler)
// Vorgemerkte Wirkungen (wirkungenVormerken) gehen in diesen Tick ein: Flucht per Sprung = Wirkungen + der eine Sprung-Tick.
// SUND-02a A2: läuft eine Sim-Szene, ist der Sprung ihre Flucht: die Verluste bis dahin werden VOR dem Tick vorgemerkt (der Sprung-Tick ist der eine Tick).
const tick = (game, wo, nachOrt) => {
  if (game.simSzene) { try { require('./kriegslage-szene.js').abbrechen(game, wo); } catch (e) { if (game.countError) game.countError('kriegslage-szene', e); } }
  return tickMit(game, wo, nachOrt, []);
};

// Der eine Tick, optional mit Wirkungen der Crew (vor dem Schritt). Wirkungen = vorgemerkte + übergebene, alle werden gegen den Zustand geprüft:
// gültige gelten, ungültige werden verworfen (ws.letzteWirkungen, Zähler). Wirft etwas, geht alles auf die Sicherung zurück (auch die Wirkungen).
function tickMit(game, wo, nachOrt, wirkungen, opt) {
  const ws = game.weltsim;
  if (!ws) return null;
  const sicher = abbild(ws.zustand);   // Rückfall, falls die Sim mitten im Tick wirft (der halbe Tick darf nie stehen bleiben)
  const alle = (ws.vorgemerkt || []).concat(wirkungen || []).map(klon);
  ws.vorgemerkt = [];
  const rufSicher = klon(ws.ruf || Ruf.neu());
  const postenSicher = klon(ws.posten || {});
  let ev, gueltig = [], verworfen = [], kommandanten = [], rang = null, gehalten = [];
  try {
    if (alle.length) {
      ({ gueltig, verworfen } = Kern.filtereWirkungen(ws.zustand, alle));
      kommandanten = gueltig.filter((w) => w.typ === 'flaggschiff_gefallen' && w.kommandant).map((w) => ({ name: w.kommandant.name, schicksal: w.kommandant.schicksal, fraktion: ws.zustand.flotten.find((f) => f.id === w.flotte).fraktion }))
        .filter((k, i, l) => l.findIndex((x) => x.name === k.name) === i);   // eine Begegnung zählt einmal, auch wenn mehrere Flotten desselben Kommandanten abbrechen (SUND-02a A2)
    }
    ev = Kern.tick(ws.zustand, { wirkungen: gueltig }).ereignisse;
    const po = Posten.nachTick(game, gueltig);   // SUND-02b A1: Crew-Posten eintragen/austragen, „gehalten“ als Ruf-Wirkung (Aufsatz, im selben Atom)
    gehalten = po.gehalten;
    rang = Ruf.anwenden(game, gueltig.concat(po.wirkungen));   // SUND-02b B: Ruf nach dem Tick, im selben Atom (der Kern ignoriert ruf_aenderung)
  } catch (e) {
    ws.zustand = Object.assign(sicher, { werte: ws.zustand.werte, karte: ws.zustand.karte });
    ws.ruf = rufSicher;
    ws.posten = postenSicher;
    ws.letzteWirkungen = { angewandt: 0, verworfen: alle.map((w) => ({ wirkung: w, grund: 'Tick gescheitert' })) };
    ws.wirkungenVerworfen += alle.length;
    ws.fehler++;
    if (game.countError) game.countError('kriegslage-tick', e);
    try { game.oda(STOERUNG_TEXT, 'kriegslage_gestoert'); } catch (e2) { /* der Hinweis ist nur Beiwerk */ }   // einmal je Partie
    return null;
  }
  ws.tickZahl++;
  ws.letzteQuelle = wo || null;
  ws.letzteWirkungen = { angewandt: gueltig.length, verworfen };
  ws.wirkungenAngewandt += gueltig.length; ws.wirkungenVerworfen += verworfen.length;
  for (const k of kommandanten) kommandantMerken(ws, k);
  if (rang) { try { Ruf.meldeRang(game, rang.vorher, rang.nachher); } catch (e) { if (game.countError) game.countError('kriegslage-ruf', e); } }   // Rangwechsel-Funk nach dem Commit; wie der Wissens-Funk des Ticks steht er VOR der Szenenmeldung
  if (gehalten.length) { try { Posten.meldeGehalten(game, gehalten); } catch (e) { if (game.countError) game.countError('kriegslage-posten', e); } }
  for (const e of ev) { ws.ereignisse.push(Object.assign({ n: ws.tickZahl }, e)); }
  if (ws.ereignisse.length > RING) ws.ereignisse.splice(0, ws.ereignisse.length - RING);
  overlayFuellen(game);
  try { Wissen.nachTick(game, sicher, ev, nachOrt, opt); } catch (e) { if (game.countError) game.countError('kriegslage-wissen', e); }   // SUND-01 C: nach dem Tick, vor dem Szenenaufbau
  try { for (const e of ev) if (e.typ === 'hauptwelt_gefallen') hauptweltFaellt(game, e); } catch (e) { if (game.countError) game.countError('kriegslage-hauptwelt', e); }
  return ev;
}

// Gedächtnis der Kommandanten: ein Name, der wiederkehrt, zählt eine Begegnung mehr; wer gefallen ist, bleibt gefallen.
function kommandantMerken(ws, k) {
  const alt = ws.kommandanten[k.name];
  ws.kommandanten[k.name] = { fraktion: k.fraktion, schicksal: alt && alt.schicksal === 'gefallen' ? 'gefallen' : k.schicksal, begegnungen: (alt ? alt.begegnungen : 0) + 1, tick: ws.tickZahl };
  const namen = Object.keys(ws.kommandanten);
  if (namen.length > KOMMANDANTEN_MAX) {
    namen.sort((a, b) => ws.kommandanten[a].tick - ws.kommandanten[b].tick);
    for (const n of namen.slice(0, namen.length - KOMMANDANTEN_MAX)) delete ws.kommandanten[n];
  }
}

// Szenenende ohne Sprung (Sieg, Bleiben): Wirkungen der Crew und genau ein Tick, atomar. wo: Zähler/Tests (Standard 'szene').
// -> { ok, ereignisse: [Ereignisse des Ticks] | null, angewandt: Zahl, verworfen: [{ wirkung, grund }], tick: Tickzähler danach }
// ok=false: kein Modus oder die Sim ist gescheitert (dann Zustand wie vorher, Tick nicht gezählt).
// direkt: Hex, das die Lerche selbst sieht (das Wissen von Rom nimmt dort den jetzigen Stand statt des Vor-Ticks); stumm: Hex, dessen Hafen-/Posten-Funk die Szene selbst meldet.
function szeneAbschliessen(game, { wirkungen = [], wo, direkt, stumm } = {}) {
  const ws = game.weltsim;
  if (!ws) return { ok: false, ereignisse: null, angewandt: 0, verworfen: [], tick: null };
  const opt = direkt || stumm ? { direkt: direkt ? [].concat(direkt) : [], stumm: stumm ? [].concat(stumm) : [] } : null;
  const ev = tickMit(game, wo || 'szene', undefined, Array.isArray(wirkungen) ? wirkungen : [], opt);
  const r = ws.letzteWirkungen || { angewandt: 0, verworfen: [] };
  if (ev) { try { szeneNachziehen(game); } catch (e) { if (game.countError) game.countError('kriegslage-szene', e); } }   // Besitz kann sich geändert haben (Banner, Andocken)
  return { ok: !!ev, ereignisse: ev, angewandt: r.angewandt, verworfen: r.verworfen, tick: ws.tickZahl };
}

// Szenenende mit Sprung (Flucht): Wirkungen für den nächsten Tick merken, das ist der Sprung-Tick (tick()), kein eigener. Geprüft wird sofort (Ablehnungen
// kommen zurück; ebenso, was wegen VORGEMERKT_MAX nicht mehr passt) und beim Tick noch einmal gegen den dann gültigen Zustand. Leere Liste ändert nichts. -> { vorgemerkt: Zahl, verworfen: [{ wirkung, grund }] }
function wirkungenVormerken(game, wirkungen) {
  const ws = game.weltsim;
  if (!ws || !Array.isArray(wirkungen) || !wirkungen.length) return { vorgemerkt: 0, verworfen: [] };
  const alt = ws.vorgemerkt || [];
  const neu = wirkungen.map(klon);
  const { gueltig, verworfen } = Kern.filtereWirkungen(ws.zustand, alt.concat(neu));
  const nurNeu = gueltig.filter((w) => neu.includes(w));
  const platz = Math.max(0, VORGEMERKT_MAX - alt.length);   // mehr als VORGEMERKT_MAX passt nicht: der Rest wird verworfen UND als verworfen gemeldet
  const behalten = nurNeu.slice(0, platz);
  ws.vorgemerkt = alt.concat(behalten);
  const voll = nurNeu.slice(platz).map((w) => ({ wirkung: w, grund: 'Vormerkung voll (höchstens ' + VORGEMERKT_MAX + ')' }));
  return { vorgemerkt: behalten.length, verworfen: verworfen.filter((v) => neu.includes(v.wirkung)).concat(voll) };
}

// Platzhalter bis SUND-04 (Abspann): Merker, Meldung, Missionsereignis; das Spiel läuft weiter
function hauptweltFaellt(game, e) {
  const ws = game.weltsim;
  const wer = e.alt === 'rom' ? 'rom' : 'ger';
  if (wer === 'rom' && !ws.hauptweltGefallen) ws.hauptweltGefallen = { fraktion: 'rom', tick: ws.tickZahl };
  game.oda(HAUPTWELT_TEXT[wer], wer === 'rom' ? 'kriegslage_hauptwelt_rom' : null);
  game.missionEvent('hauptwelt_gefallen', { fraktion: wer, ort: e.ort, neu: e.neu, tick: ws.tickZahl });
}

// Andock-Erlaubnis, Banner und Posten-Marker der Szene, in der das Schiff steht, neu setzen (nach einem Tick oder Laden ohne enterScene)
function szeneNachziehen(game) {
  const sp = game.space; const ship = game.ship;
  if (!sp || !ship || !ship.scene) return;
  const loc = Locations.get(ship.scene);
  if (!loc || !loc.scene) return;
  const hex = loc.hex || Sektoren.hexVonOrt(loc.id);
  if (!hex) return;
  const sc = loc.scene;
  const dock = Besitz.dockLage(game, sc, hex);   // SUND-02b A1: auch der Stützpunkt der Crew hat einen Liegeplatz (berechnet)
  sp.dockOk = !dock || Besitz.darfAndocken(game, hex);
  const fr = Besitz.besitzer(game, hex);
  const m = sp.markers || [];
  for (const k of m) if ('fr' in k) k.fr = fr;
  const i = m.findIndex((k) => k.kind === 'dock');
  if (dock && sp.dockOk && i < 0) m.push({ kind: 'dock', x: dock.x, y: dock.y, r: game.C.travel.dockDist });
  else if (i >= 0 && (!dock || !sp.dockOk)) m.splice(i, 1);   // SUND-02b A1: auch wenn der Stützpunkt weg ist
  // SUND-02b A1-Fix: der Stützpunkt fiel, während die Lerche daran angedockt lag (Tick durch Notruf-Ende): sie legt ab, mit Meldung (ohne Dock gäbe es keinen Liegeplatz mehr, ohne Posten auch keinen Handel)
  if (!dock && ship.docked && ship.dockedAt === loc.id) {
    ship.docked = false; ship.dockedAt = null; ship.dockArmed = false; ship.undockT = game.time; ship.dockHold = false;
    ship.vx = 0; ship.vy = 0; ship.speed = 0; ship.helm.thrust = 0; ship.helm.stage = 1;
    try { game.oda(Besitz.verlorenText(), null); game.emit('sfx', { name: 'dodge' }); game.missionEvent('undocked', {}); } catch (e) { if (game.countError) game.countError('kriegslage-ablegen', e); }
    for (const p of game.players || []) if (p.console === 'shop') { try { require('./interior.js').leaveConsole(game, p); } catch (e) { if (game.countError) game.countError('kriegslage-terminal', e); } }
  }
  // Posten-Marker (wie in Space.enterScene): im Hex wurde im Tick ein Posten gegründet oder verloren. Die Asteroiden der Szene bleiben (neu bis zum nächsten Besuch).
  const hatPosten = !sc.station && Besitz.istPosten(game, hex);
  const pi = m.findIndex((k) => k.posten);
  if (hatPosten && pi < 0) { const pl = Besitz.postenLage(sc); m.push({ kind: 'station', x: pl.x, y: pl.y, r: pl.r, name: 'Posten', posten: true, fr }); }
  else if (!hatPosten && pi >= 0) m.splice(pi, 1);
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
  const rb = Ruf.toSave(ws); if (rb) b.ruf = rb;
  const pb = Posten.toSave(ws); if (pb) b.posten = pb;   // SUND-02b A1: Zeitpunkt der Crew-Posten (Halten); fehlt = keine
  if (Object.keys(ws.kommandanten || {}).length) b.kommandanten = klon(ws.kommandanten);
  if ((ws.vorgemerkt || []).length) b.vorgemerkt = klon(ws.vorgemerkt);
  if (ws.hauptweltGefallen) b.hauptweltGefallen = { fraktion: String(ws.hauptweltGefallen.fraktion), tick: ws.hauptweltGefallen.tick };
  return b;
}
// Müll-feste Leser der optionalen Blöcke (Altstände ohne die Felder: leer)
function kommandantenLesen(b) {
  const out = {};
  if (!b || typeof b !== 'object' || Array.isArray(b)) return out;
  for (const [name, k] of Object.entries(b)) {
    if (!name || name.length > 60 || !k || typeof k !== 'object' || !['entkommen', 'gefallen'].includes(k.schicksal)) continue;
    out[name] = { fraktion: typeof k.fraktion === 'string' ? k.fraktion : '', schicksal: k.schicksal, begegnungen: Number.isFinite(k.begegnungen) && k.begegnungen >= 1 ? Math.floor(k.begegnungen) : 1, tick: Number.isFinite(k.tick) && k.tick >= 0 ? Math.floor(k.tick) : 0 };
    if (Object.keys(out).length >= KOMMANDANTEN_MAX) break;
  }
  return out;
}
function vorgemerktLesen(b) {
  if (!Array.isArray(b)) return [];
  return b.filter((w) => w && typeof w === 'object' && !Array.isArray(w) && typeof w.typ === 'string').slice(0, VORGEMERKT_MAX).map(klon);
}

function restore(game, b) {
  reset(game);
  if (!b || typeof b !== 'object' || b.modus !== MODUS) return;
  const tickZahl = Number.isFinite(b.tick) && b.tick >= 0 ? Math.floor(b.tick) : 0;
  if (abbildOk(b.zustand)) {
    game.weltsim = { zustand: voll(b.zustand), tickZahl, fehler: 0, ereignisse: [], hauptweltGefallen: null, wissen: null, kommandanten: {}, vorgemerkt: [], ruf: Ruf.neu(), posten: {}, wirkungenAngewandt: 0, wirkungenVerworfen: 0 };
    try { Wissen.restore(game, b.wissen); } catch (e) { if (game.countError) game.countError('kriegslage-wissen', e); }
  } else {
    if (game.countError) game.countError('kriegslage-restore', new Error('welt.sim: Sim-Zustand unbrauchbar – neue Welt'));
    neueSim(game);
    game.weltsim.tickZahl = tickZahl;
    if (game.weltsim.wissen) game.weltsim.wissen.t = tickZahl;   // das neu begonnene Wissen trägt den Tick der Partie
  }
  game.weltsim.kommandanten = kommandantenLesen(b.kommandanten);
  game.weltsim.vorgemerkt = vorgemerktLesen(b.vorgemerkt);
  game.weltsim.posten = Posten.lesen(b.posten);   // SUND-02b A1: fehlt = leer (Altstand)
  game.weltsim.ruf = Ruf.lesen(b.ruf);   // SUND-02b B: fehlt = 0 (Altstand)
  const h = b.hauptweltGefallen;
  if (h && typeof h === 'object' && Number.isFinite(h.tick)) game.weltsim.hauptweltGefallen = { fraktion: String(h.fraktion || 'rom'), tick: h.tick };
  overlayFuellen(game);
  szeneNachziehen(game);
}

module.exports = { MODUS, KARTE, RING, seedAus, abbild, starten, tick, tickMit, szeneAbschliessen, wirkungenVormerken, szeneNachziehen, nachLaden, toSave, restore, reset, sondeGesichtet, lage, lageSchluessel };
