'use strict';
// SUND-02b A1: Posten der Crew im Modus Freie Fahrt Sund (game.weltsim). Action-Layer wie kriegslage.js und ruf.js.
// Ruf ist ein Kann, nie ein Muss: die Crew KANN einen Posten gründen oder einen römischen Posten zum Stützpunkt ausbauen; Rang, Anspruch, Ersatzteile und Lage sind Bedingungen,
// nichts erzwingt es, der Abbruch kostet nichts (Kosten werden erst beim Abschluss gebucht), jeder Spieler an der Ops darf (Solo geht, die anderen sehen zu).
//
// Ablauf (Ops-Halteprozess, wie Beamen/Verkaufen in fracht.js; Zustand s.halt = { kind: 'posten', id: 'gruenden' | 'ausbau', t, dur, hex }, Anzeige halt.p im Snapshot fracht):
//   gruendenStart(game, p) / ausbauenStart(game, p)   Befehle weapons.posten.gruenden / weapons.posten.ausbauen (Abbruch: weapons.fracht { off }); -> Fehlertext | null
//   haltWeiter(game, h)         Prüfung je Tick (aus fracht.update): null oder { code, text } = Abbruch (Gegner, Szene, Ring verlassen, zu schnell, Transfer, belegt)
//   haltFertig(game, h)         Abschluss (aus fracht.beamFertig): Wirkung posten_gehisst bzw. posten_ausgebaut + ruf_aenderung über Kriegslage.szeneAbschliessen (genau ein Tick, atomar)
//   gruendenPruefen / ausbauPruefen (game)   -> null | { code, text } (Weigerungsgrund mit Text aus content/flotte/posten.json)
// SUND-02b A2: Posten sprengen. Die Crew greift den Posten eines Gegners (Besitzer ger oder pirat) an, sie löst die Szene SELBST aus (Kann, nie Muss: die Ankunft startet nie eine):
//   angreifenStart(game, p)     Befehl weapons.posten.angreifen: Halteprozess (id 'angreifen', Anlauf, Daten angreifen.dauer) mit denselben Bedingungen wie oben (Ring, Tempo, keine Szene, kein Gegner) plus: Posten
//                               eines Feindes von Rom, kein Hafen, keine Station; römische (auch eigene Crew-Posten) und Konkordat-Posten sind kein Ziel
//   angreifenPruefen(game)      -> null | { code, text }
//   Abschluss (haltFertig): SimSzene.angriffStarten (kriegslage-szene.js: Szene modus 'angriff', Wellen aus der Garnison). Ende dort: Sieg = abwehr_verlust (Rest) + posten_gesprengt + Ruf, Flucht/Niederlage = anteilig.
//   sprengungRuf(game, hex, besitzer) -> [ruf_aenderung] | []   Ruf der Sprengung; leer innerhalb von sprengen.ruf_sperre_ticks nach der letzten Sprengung am selben Hex (ws.sprengungen = { hex: Tick }, optional im Weltstand)
// Posten halten (Aufsatz, nicht im Kern): ws.posten = { hex: { t: Tick der Gründung, g?: 1 } } (welt.sim.posten, optional); nachTick() gibt nach halten_ticks Ticks einmal Ruf (Quelle posten_gehalten).
//   snapshot(game)              space.po: { k: 'g' | 'a', ok: 0 | 1, t?: Weigerungstext, n: Ersatzteile } nur dort, wo ein Posten Sinn hat (freies Hex ohne Hafen, römischer Posten ohne Stützpunkt)
// Alle Zahlen stehen in content/welt/posten-werte.json, alle Texte in content/flotte/posten.json.
const fs = require('fs');
const path = require('path');
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');
const Daten = require('../weltsim/daten.js');
const Kern = require('../weltsim/kern.js');
const Besitz = require('./besitz.js');
const Ruf = require('./ruf.js');
const Fracht = require('./fracht.js');
const { dist } = require('../util.js');

const W = require('../../content/welt/posten-werte.json').werte;
const TEXTE_FILE = path.join(__dirname, '..', '..', 'content', 'flotte', 'posten.json');
let texteCache = null;
function texte() {
  if (texteCache) return texteCache;
  try { texteCache = JSON.parse(fs.readFileSync(TEXTE_FILE, 'utf8')); } catch (e) { texteCache = {}; }
  return texteCache;
}
const fmt = (s, o) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? String(o[k]) : m));
const kl = () => require('./kriegslage.js');   // lazy: kriegslage.js ruft nachTick

const ART = {
  angreifen: { cfg: W.angreifen.wert, get rang() { return W.mindestrang.wert.angreifen; }, wirkung: null, grund: null, kurz: 'x' },
  gruenden: { cfg: W.gruenden.wert, get rang() { return W.mindestrang.wert.gruenden; }, wirkung: 'posten_gehisst', grund: 'posten_gehisst', kurz: 'g' },
  ausbau: { cfg: W.ausbau.wert, get rang() { return W.mindestrang.wert.ausbau; }, wirkung: 'posten_ausgebaut', grund: 'posten_ausgebaut', kurz: 'a' },
};
const T = (art) => texte()[art] || {};
const fehl = (art, code, o) => ({ code, text: fmt((T(art).weigerung || {})[code] || code, o) });

// Der Ort, an dem die Lerche steht: { hex, sc, nd, d } oder null (kein Modus, kein Sim-Hex)
function ort(game) {
  const ws = game.weltsim; const ship = game.ship;
  if (!ws || !ship) return null;
  const loc = Locations.get(ship.scene);
  if (!loc || !loc.scene) return null;
  const hex = loc.hex || Sektoren.hexVonOrt(loc.id);
  const z = ws.zustand;
  if (!hex || !z.hexe[hex]) return { hex: hex || null, sc: loc.scene, nd: null, d: null, z };
  return { hex, sc: loc.scene, nd: z.hexe[hex], d: Daten.datenVon(z).hex[hex], z };
}
const hatHafen = (o) => !!(o.d && o.d.hafen);
const feindImHex = (game, o) => o.z.flotten.some((fl) => fl.ort === o.hex && fl.staerke > 0 && Kern.feindlich('rom', fl.fraktion)) || ((game.space && game.space.enemies) || []).length > 0;
const transferAus = (game) => ['broken', 'offline'].includes(game.ship.systems.transfer);
const lage = (o) => Besitz.postenLage(o.sc);

// Bedingungen, die für beide Arten gleich sind und sich während des Halteprozesses ändern können (Szene, Gegner, Transfer, Ring, Tempo)
function lagePruefen(game, art, o) {
  const A = ART[art];
  if (game.simSzene && game.simSzene.hex === o.hex && game.simSzene.phase !== 'ende') return fehl(art, 'szene');
  if (feindImHex(game, o)) return fehl(art, 'gegner');
  if (transferAus(game)) return fehl(art, 'transfer');
  const pl = lage(o); const ship = game.ship;
  const d = Math.round(dist(ship.x, ship.y, pl.x, pl.y));
  if (d > A.cfg.radius) return fehl(art, 'weit', { ist: d, max: A.cfg.radius });
  if (ship.speed > A.cfg.tempo) return fehl(art, 'schnell');
  return null;
}
const teileFehler = (game, art) => {
  const k = ART[art].cfg.kosten || {};
  return Number(game.inventory.ersatzteil || 0) < (k.ersatzteil || 0) ? fehl(art, 'teile', { teile: k.ersatzteil }) : null;
};

// ---------- Prüfer ----------
// laufend = true: Prüfung während des Halteprozesses (ohne Rang, Docked, „läuft schon“; die Kosten erst beim Abschluss, siehe haltFertig)
function gruendenPruefen(game, laufend) {
  const art = 'gruenden';
  const o = ort(game);
  if (!o) return fehl(art, 'modus');
  if (!laufend && game.ship.docked) return fehl(art, 'docked');
  if (o.sc.station) return fehl(art, 'station');
  if (!o.nd) return fehl(art, 'anspruch');
  if (hatHafen(o)) return fehl(art, 'hafen');
  if (!W.anspruch.wert.rom.includes(o.hex)) return fehl(art, 'anspruch');
  if (o.nd.besitzer !== null || o.nd.posten) return fehl(art, 'belegt');
  if (!laufend && !Ruf.rufErreicht(game, ART[art].rang)) return fehl(art, 'rang', { rang: (Ruf.RAENGE.find((r) => r.id === ART[art].rang) || {}).name || ART[art].rang });
  const l = lagePruefen(game, art, o); if (l) return l;
  if (!laufend) { const s = Fracht.state(game); if (s.halt) return fehl(art, 'laeuft'); }
  return teileFehler(game, art);
}
function ausbauPruefen(game, laufend) {
  const art = 'ausbau';
  const o = ort(game);
  if (!o) return fehl(art, 'modus');
  if (!laufend && game.ship.docked) return fehl(art, 'docked');
  if (o.sc.station) return fehl(art, 'station');
  if (!o.nd) return fehl(art, 'kein_posten');
  if (hatHafen(o)) return fehl(art, 'hafen');
  if (!o.nd.posten || o.nd.besitzer !== 'rom') return fehl(art, 'kein_posten');
  if (o.nd.crew === true) return fehl(art, 'schon');
  if (!laufend && !Ruf.rufErreicht(game, ART[art].rang)) return fehl(art, 'rang', { rang: (Ruf.RAENGE.find((r) => r.id === ART[art].rang) || {}).name || ART[art].rang });
  const l = lagePruefen(game, art, o); if (l) return l;
  if (!laufend) { const s = Fracht.state(game); if (s.halt) return fehl(art, 'laeuft'); }
  return teileFehler(game, art);
}
// SUND-02b A2: Posten angreifen (sprengen). Ziel: Posten eines Feindes von Rom (Kern-Regel feindlich: ger, pirat; Konkordat neutral; Rom nie ein Ziel, Beschuss auf Rom ist Paket E).
function angreifenPruefen(game, laufend) {
  const art = 'angreifen';
  const o = ort(game);
  if (!o) return fehl(art, 'modus');
  if (!laufend && game.ship.docked) return fehl(art, 'docked');
  if (o.sc.station) return fehl(art, 'station');
  if (!o.nd || !o.nd.posten) return fehl(art, 'kein_posten');
  if (hatHafen(o)) return fehl(art, 'hafen');
  if (o.nd.besitzer === 'rom') return fehl(art, 'eigener');
  if (!Kern.feindlich('rom', o.nd.besitzer)) return fehl(art, 'neutral');
  if (!laufend && !Ruf.rufErreicht(game, ART[art].rang)) return fehl(art, 'rang', { rang: (Ruf.RAENGE.find((r) => r.id === ART[art].rang) || {}).name || ART[art].rang });
  const l = lagePruefen(game, art, o); if (l) return l;
  if (!laufend) { const s = Fracht.state(game); if (s.halt) return fehl(art, 'laeuft'); }
  return null;
}
const PRUEFER = { gruenden: gruendenPruefen, ausbau: ausbauPruefen, angreifen: angreifenPruefen };

// ---------- Halteprozess ----------
function start(game, art) {
  const e = PRUEFER[art](game, false);
  if (e) return e.text;
  const o = ort(game);
  const s = Fracht.state(game);
  s.halt = { kind: 'posten', id: art, t: 0, dur: ART[art].cfg.dauer, hex: o.hex };
  game.emit('frachtBeamen', { phase: 'start', was: 'posten', dur: s.halt.dur });
  return null;
}
const gruendenStart = (game, p) => start(game, 'gruenden');
const ausbauenStart = (game, p) => start(game, 'ausbau');
const angreifenStart = (game, p) => start(game, 'angreifen');

// Abbruchcode -> Schlüssel in abbruch{}; Gründe aus der Struktur (belegt, Anspruch, Posten weg) heißen alle „belegt“
const ABBRUCH = { szene: 'szene', gegner: 'gegner', transfer: 'transfer', weit: 'ring', schnell: 'schnell', anspruch: 'belegt', belegt: 'belegt', hafen: 'belegt', station: 'belegt', kein_posten: 'belegt', schon: 'belegt', modus: 'belegt', teile: 'teile' };
function abbruchText(art, code) { return (T(art).abbruch || {})[ABBRUCH[code] || 'belegt'] || ''; }
// Abbrüche, die fracht.js selbst auslöst (Szenenwechsel = Sprung, niemand mehr an der Ops): Text für beamStop; Abbruch durch den Spieler bleibt still
function stummerAbbruchText(h, grund) { const k = { szene: 'sprung', taktik: 'ops' }[grund]; return k ? ((T(h.id).abbruch || {})[k] || '') : ''; }

// Je Tick (Fracht.update, nur wenn die Ops besetzt ist): null = weiter, sonst { code, text } = Abbruch. Die Halte-Hex muss die des Starts sein (Szenenwechsel bricht fracht.update schon vorher ab).
function haltWeiter(game, h) {
  const o = ort(game);
  if (!o || o.hex !== h.hex) return { code: 'ring', text: abbruchText(h.id, 'weit') };
  const e = PRUEFER[h.id](game, true);
  if (!e || e.code === 'teile') return null;   // die Kosten zählen erst beim Abschluss
  return { code: e.code, text: abbruchText(h.id, e.code) };
}

// Abschluss: prüfen, Wirkung + Ruf in genau einem Tick, dann die Kosten buchen. Ein Wurf oder eine verworfene Wirkung kostet nichts.
function haltFertig(game, h) {
  if (h.id === 'angreifen') return angriffFertig(game, h);
  const art = h.id; const A = ART[art];
  const e = PRUEFER[art](game, true);
  if (e) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: e.code }); game.oda(abbruchText(art, e.code), null); return false; }
  const o = ort(game);
  if (!o || o.hex !== h.hex) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: 'ort' }); return false; }
  const wk = { typ: A.wirkung, ort: o.hex };
  const pr = Kern.pruefeWirkung(o.z, wk);
  if (!pr.ok) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: 'wirkung' }); game.oda(fmt(T(art).fehler, { grund: pr.grund }), null); return false; }
  // Vorabprüfung bestanden: Wirkung und Ruf gehen zusammen in den Tick (Ruf nur, wenn die Wirkung gilt, siehe Prüfung oben; beides atomar in Kriegslage.tickMit)
  const wirkungen = [wk, { typ: 'ruf_aenderung', fraktion: 'rom', delta: require('../../content/welt/ruf-werte.json').werte.quellen.wert[A.grund].delta, grund: A.grund }];
  const name = Sektoren.hexName(o.hex);
  // Gilt die Wirkung (nicht verworfen), ist sie angewandt; fällt der Posten im selben Tick durch die Sim wieder, bleiben Ruf und Kosten (die Crew hat ihn gehisst, der Ruf ist atomar mit dem Tick gebucht)
  const r = kl().szeneAbschliessen(game, { wirkungen, wo: 'posten', direkt: o.hex });
  const gilt = r.ok && !r.verworfen.some((v) => v.wirkung === wk || (v.wirkung && v.wirkung.typ === A.wirkung));
  if (!gilt) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: 'tick' }); game.oda(fmt(T(art).fehler, { grund: r.ok ? 'Wirkung abgelehnt' : 'Weltsimulation gestört' }), null); return false; }
  const k = A.cfg.kosten || {};
  if (k.ersatzteil) game.inventory.ersatzteil = Math.max(0, Number(game.inventory.ersatzteil || 0) - k.ersatzteil);
  game.emit('frachtBeamen', { phase: 'fertig', was: 'posten', art });
  game.emit('sfx', { name: 'repair_done' });
  game.oda(fmt(T(art).fertig, { ort: name }), null);
  game.missionEvent(art === 'gruenden' ? 'postenGegruendet' : 'postenAusgebaut', { hex: o.hex, ort: name });
  if (game.markSaveDue) game.markSaveDue('docked');
  return true;
}

// Abschluss des Anlaufs: die Angriffsszene beginnt (keine Kosten, keine Wirkung: die Welt ändert sich erst am Ende der Szene). Ein Wurf der Szene kostet nichts.
function angriffFertig(game, h) {
  const art = 'angreifen';
  const e = angreifenPruefen(game, true);
  if (e) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: e.code }); game.oda(abbruchText(art, e.code), null); return false; }
  const o = ort(game);
  if (!o || o.hex !== h.hex) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: 'ort' }); return false; }
  let S = null;
  try { S = require('./kriegslage-szene.js').angriffStarten(game, o.hex); } catch (err) { if (game.countError) game.countError('posten-angriff', err); }
  if (!S) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: 'szene' }); game.oda(fmt(T(art).fehler, { grund: 'kein Angriffsplan' }), null); return false; }
  game.emit('frachtBeamen', { phase: 'fertig', was: 'posten', art });
  game.oda(fmt(T(art).fertig, { ort: Sektoren.hexName(o.hex) }), null);
  return true;
}

// ---------- Sprengungen (Ruf-Sperre gegen Farmen) ----------
// ws.sprengungen = { hex: Tick der letzten Sprengung } (Aufsatz, nicht im Kern; optional im Weltstand welt.sim.sprengungen). nachTick() trägt jede gültige posten_gesprengt ein.
function sprengungGesperrt(game, hex) {
  const ws = game.weltsim; const letzte = ws && (ws.sprengungen || {})[hex];
  return Number.isFinite(letzte) && ws.zustand.tick - letzte < W.sprengen.wert.ruf_sperre_ticks;
}
function sprengungRuf(game, hex, besitzer) {
  if (!game.weltsim || sprengungGesperrt(game, hex)) return [];
  const q = require('../../content/welt/ruf-werte.json').werte.quellen.wert['posten_gesprengt_' + besitzer];
  if (!q) return [];
  return [{ typ: 'ruf_aenderung', fraktion: q.fraktion, delta: q.delta, grund: 'posten_gesprengt_' + besitzer }];
}

// ---------- Posten halten (Aufsatz) ----------
const istCrew = (z, hex) => { const nd = z.hexe[hex]; return !!(nd && nd.crew === true && nd.posten && nd.besitzer === 'rom'); };
// Nach dem Kern-Tick, im selben Atom (Kriegslage.tickMit, Zustand wird mit zurückgerollt): neue Crew-Posten eintragen, gefallene austragen, nach halten_ticks einmal Ruf.
// -> { wirkungen: [ruf_aenderung], gehalten: [Hex] }
function nachTick(game, gueltig) {
  const ws = game.weltsim; const z = ws.zustand;
  const reg = ws.posten || (ws.posten = {});
  const sp = ws.sprengungen || (ws.sprengungen = {});
  for (const wk of gueltig || []) if (wk.typ === 'posten_gesprengt') sp[wk.ort] = z.tick;   // SUND-02b A2: Ruf-Sperre am Hex
  for (const wk of gueltig || []) if ((wk.typ === 'posten_gehisst' || wk.typ === 'posten_ausgebaut') && istCrew(z, wk.ort)) reg[wk.ort] = { t: z.tick };
  const wirkungen = []; const gehalten = [];
  for (const hex of Object.keys(reg)) {
    if (!istCrew(z, hex)) { delete reg[hex]; continue; }
    if (!reg[hex].g && z.tick - reg[hex].t >= W.halten_ticks.wert) {
      reg[hex].g = 1;
      const q = require('../../content/welt/ruf-werte.json').werte.quellen.wert.posten_gehalten;
      if (q) wirkungen.push({ typ: 'ruf_aenderung', fraktion: q.fraktion, delta: q.delta, grund: 'posten_gehalten' });
      gehalten.push(hex);
    }
  }
  for (const [hex, nd] of Object.entries(z.hexe)) if (nd.crew === true && istCrew(z, hex) && !reg[hex]) reg[hex] = { t: z.tick };   // Crew-Posten ohne Eintrag (Debug, Altstand): ab jetzt zählen
  return { wirkungen, gehalten };
}
function meldeGehalten(game, hexe) {
  const ticks = W.halten_ticks.wert;
  for (const hex of hexe) game.oda(fmt(texte().gehalten, { ort: Sektoren.hexName(hex), ticks }), null);
}

// ---------- Weltstand ----------
function toSave(ws) {
  const reg = ws && ws.posten;
  const out = {};
  for (const [hex, e] of Object.entries(reg || {})) if (e && Number.isFinite(e.t)) out[hex] = e.g ? { t: e.t, g: 1 } : { t: e.t };
  return Object.keys(out).length ? out : null;
}
function sprengungenSave(ws) {
  const out = {};
  for (const [hex, t] of Object.entries((ws && ws.sprengungen) || {})) if (Number.isFinite(t)) out[hex] = t;
  return Object.keys(out).length ? out : null;
}
function sprengungenLesen(b) {
  const out = {};
  if (!b || typeof b !== 'object' || Array.isArray(b)) return out;
  for (const [hex, t] of Object.entries(b)) if (/^\d{4}$/.test(hex) && Number.isFinite(t) && t >= 0) out[hex] = Math.floor(t);
  return out;
}
function lesen(b) {
  const out = {};
  if (!b || typeof b !== 'object' || Array.isArray(b)) return out;
  for (const [hex, e] of Object.entries(b)) if (/^\d{4}$/.test(hex) && e && typeof e === 'object' && Number.isFinite(e.t) && e.t >= 0) out[hex] = e.g ? { t: Math.floor(e.t), g: 1 } : { t: Math.floor(e.t) };
  return out;
}

// ---------- Anzeige (space.po) ----------
function snapshot(game) {
  const o = ort(game);
  if (!o || !o.nd || hatHafen(o) || o.sc.station) return null;   // A1-Fix: auch Hexe mit Station (Kantenstein, Pulverhorn) zeigen kein Feld (die Weigerung „Station“ liefert nur der Befehl)
  let art = null;
  if (o.nd.besitzer === null && !o.nd.posten) art = 'gruenden';
  else if (o.nd.besitzer === 'rom' && o.nd.posten && o.nd.crew !== true) art = 'ausbau';
  else if (o.nd.posten && o.nd.besitzer !== 'rom' && Kern.feindlich('rom', o.nd.besitzer)) art = 'angreifen';   // SUND-02b A2: Posten eines Gegners (ger, pirat), nicht Konkordat
  if (!art) return null;
  const e = PRUEFER[art](game, false);
  // ein laufender Halteprozess blockiert nur die Starttaste: die Anzeige zeigt dann den Fortschritt (fracht.halt)
  const out = { k: ART[art].kurz, ok: e ? 0 : 1, n: (ART[art].cfg.kosten || {}).ersatzteil || 0 };
  if (e) out.t = e.text;
  return out;
}

module.exports = { gruendenStart, ausbauenStart, angreifenStart, gruendenPruefen, ausbauPruefen, angreifenPruefen, sprengungRuf, sprengungGesperrt, sprengungenSave, sprengungenLesen, haltWeiter, haltFertig, stummerAbbruchText, nachTick, meldeGehalten, toSave, lesen, snapshot, ort };
