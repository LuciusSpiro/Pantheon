'use strict';
// FAB-01 A: Ereignis-Verteiler fuer den Boden. Der Faden erfaehrt, was die Crew am Boden tut (Runter- und Hochbeamen, Person aufgenommen, abgegeben, gerettet). Ein Beat meldet sich mit seiner ART an
// (anmelden), game.missionEvent ruft EINMAL ereignis(game, { name, data }); der Verteiler reicht das Ereignis an die laufenden Faden-Beats angemeldeter Art weiter. Kein Beat steht hier im Code: die Art ist der
// Katalogtyp (beats.json), das Handler-Objekt bringt der Baustein der Art mit (BEA-02, WRK-01).
//
//   anmelden(beatArt, handler)   handler = Funktion (game, faden, ev) oder Objekt mit ereignis(game, faden, ev); ev = { name, data }. Ein Handler je Art (spaeteres Anmelden ersetzt)
//   ereignis(game, ev)           wirft nie; kehrt sofort zurueck (ohne Allokation), wenn kein Handler angemeldet ist, der Name nicht zu den sechs Ereignissen gehoert (dazu notsprung, FAB-01 B), FAEDEN=1 fehlt oder kein Beat laeuft
//   abmelden(beatArt)            nimmt den Handler weg (Tests)
//
// Zuordnung: beamedDown und beamedUp tragen data.map; die Ort-Id enthaelt die Fadenid (abenteuer-orte.parse): nur dieser Faden bekommt das Ereignis (ohne passende Karte: keiner). npcRescued und personAnBord
// gehen an den Faden der Karte, wenn data.map ein Faden-Ort ist (npcRescued traegt die Karte der Aufnahme, in away.js wie in personen-bord.js), sonst an alle laufenden Beats angemeldeter Art. personAbgegeben
// wird NIE ueber map zugeordnet: dessen data.map ist die zuletzt gewaehlte Aussenkarte (game.away.map), nicht der Abgabeort; es geht an alle laufenden Beats angemeldeter Art, der Handler filtert nach person.
// Ein laufender Beat hat phase 'laeuft' (f.laufend); seine Art ist der Katalogtyp, bei einer feindlichen Variante der Typ der Variante (wie faden.beatAusgang).
// Hinweise fuer Handler: (1) Eine Aufnahme erzeugt zwei Ereignisse (npcRescued aus personen-bord.js:147, danach personAnBord :164): Handler muessen Doppelungen erkennen und nach person filtern.
// (2) Die feindliche Variante geht nach Laden verloren (f.laufend.variante fehlt, artVon liefert dann den Grundtyp, wie beatAusgang). (3) Viele Wege nach oben melden kein beamedUp (Verbindung getrennt,
// resetMap, interior.updateDowned u. a.): ein Boden-Beat darf sich nicht allein auf beamedUp verlassen.
// Laufzeit-Zustand (WeakMap auf das Spiel) steht NICHT im Weltstand: nur ein Zaehler der Zustellungen fuer Tests; keine Snapshot-Felder.
// Fehler eines Handlers zaehlt game.countError('faden-boden'), nie weiter geworfen.
const Faden = { aktiv: (game) => require('./faden.js').aktiv(game) };   // lazy: faden-landung.js meldet sich beim Laden an (faden.js -> faden-bausteine.js -> faden-landung.js -> hier), faden.js waere dann noch nicht fertig
const D = require('./faden-daten.js');

const NAMEN = { beamedDown: 'karte', beamedUp: 'karte', npcRescued: 'karte_oder_alle', personAnBord: 'karte_oder_alle', personAbgegeben: 'alle', notsprung: 'alle', beuteGeborgen: 'karte', ankerGelesen: 'karte' };   // WRK-01 B: beuteGeborgen und ankerGelesen (Logbuch-Terminal) tragen data.map: nur der Faden der Karte   // FAB-01 B: notsprung geht an alle laufenden Beats angemeldeter Art (der Beat landung scheitert; kein Datum noetig)
const handler = new Map();   // Beat-Art -> Handler
const zustaende = new WeakMap();   // game -> { zugestellt, fehler }

function anmelden(beatArt, h) {
  if (typeof beatArt !== 'string' || !beatArt) throw new Error('faden-boden.anmelden: Beat-Art fehlt');
  if (typeof h !== 'function' && !(h && typeof h.ereignis === 'function')) throw new Error('faden-boden.anmelden: Handler ohne ereignis()');
  handler.set(beatArt, h);
}
const abmelden = (beatArt) => handler.delete(beatArt);
function zustandVon(game) {
  let z = zustaende.get(game);
  if (!z) { z = { zugestellt: 0, fehler: 0 }; zustaende.set(game, z); }
  return z;
}

// Die Art des laufenden Beats dieses Fadens (null: nichts laeuft oder kein Katalogtyp)
function artVon(f) {
  if (f.phase !== 'laeuft' || !f.laufend) return null;
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat) return null;
  return f.laufend.variante && beat.variante ? beat.variante.typ : beat.typ;
}
// Faden-Id aus der Karten-Id (Ort-Id enthaelt die Fadenid), null: keine Karte oder kein Faden-Ort
function fadenIdVon(map) {
  if (typeof map !== 'string') return null;
  const m = require('./abenteuer-orte.js').parse(map);
  return m ? m.faden : null;
}

function zustellen(game, f, h, ev) {
  try {
    if (typeof h === 'function') h(game, f, ev); else h.ereignis(game, f, ev);
    zustandVon(game).zugestellt++;
  } catch (e) {
    try { zustandVon(game).fehler++; game.countError('faden-boden', e); } catch (e2) { /* ein Zaehler darf nie werfen */ }
  }
}

function ereignis(game, ev) {
  try {
    if (handler.size === 0 || !ev || !game || !game.weltsim) return;
    const zuordnung = NAMEN[ev.name];
    if (zuordnung === undefined) return;
    const ws = game.weltsim;
    if (!ws.faeden || !ws.faeden.liste.length || !Faden.aktiv(game)) return;
    const liste = ws.faeden.liste;
    let fid;   // undefined: noch nicht gelesen (erst beim ersten Faden, der ueberhaupt in Frage kommt: sonst keine Allokation)
    for (let i = 0; i < liste.length; i++) {
      const f = liste[i];
      const art = artVon(f);
      if (art === null) continue;
      const h = handler.get(art);
      if (!h) continue;
      if (zuordnung === 'alle') { zustellen(game, f, h, ev); continue; }   // personAbgegeben: map ist nicht der Abgabeort
      if (fid === undefined) fid = fadenIdVon(ev.data && ev.data.map);
      if (zuordnung === 'karte' && fid === null) return;   // beamedDown/-Up ohne Faden-Ort: kein Faden gemeint
      if (fid !== null && f.id !== fid) continue;
      zustellen(game, f, h, ev);
    }
  } catch (e) {
    try { game.countError('faden-boden', e); } catch (e2) { /* nie weiterwerfen */ }
  }
}

const zugestellt = (game) => (zustaende.get(game) || { zugestellt: 0 }).zugestellt;

module.exports = { anmelden, abmelden, ereignis, zugestellt, EREIGNISSE: Object.keys(NAMEN) };
