'use strict';
// WRK-01 A1: Beute an Wracks. Ein `beute`-Anker auf einer Prise, einem Wrack (welt.wracks) oder einem Faden-Ort (Karten-ID <ort>.<faden>-ort) legt dem SCHIFF eine kleine, gedeckelte Menge Ware ins Lager
// (Fracht.beuteEinlagern, Typ-Regel gilt). Art, Menge je Anker und Deckel je Wrack stehen NUR in content/wrack-daten.json. Alle anderen Karten (Missions-/Kampagnenkarten) bleiben unberuehrt.
//   istWrackOrt(game, map) -> bool
//   hindernis(game, map) -> null | Text      Anker darf sich nicht oeffnen (kein Platz im Frachtraum): der Anker bleibt voll, die Beute verbrennt nicht
//   beuteBergen(game, map) -> { ok: true, ware, text? } | { ok: false, text }   legt ein (ware = Zahl der Einheiten, 0 = Deckel erreicht, text = Meldung); nur der Aufrufer setzt den Anker auf leer
// Der Deckel zaehlt die schon geleerten `beute`-Anker der Karte (kein eigener Zaehler, nichts im Weltstand): jeder geleerte Anker unter dem Deckel hat Ware gegeben.
const W = require('../world.js');
const D = require('../../content/wrack-daten.json');

const lazy = (f) => { let m = null; return () => m || (m = require(f)); };
const Fracht = lazy('./fracht.js');
const Entern = lazy('./entern.js');
const Anker = lazy('./anker.js');
const Orte = lazy('./abenteuer-orte.js');

const BEUTE = D.beute;
const ganzzahl = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function istWrackOrt(game, map) {
  if (typeof map !== 'string') return false;
  try { return !!Orte().parse(map) || !!Entern().frei(game, map); } catch (e) { return false; }
}
function beuteAnker(map) { const e = W.AWAY_MAPS[map]; return e && e.karte && Array.isArray(e.karte.anker) ? e.karte.anker.filter((a) => a.rolle === 'beute') : []; }
// Einheiten, die an diesem Wrack noch vergeben werden duerfen
function restMenge(game, map) {
  const geleert = beuteAnker(map).filter((a) => Anker().zustand(game, map, a.id) === 'leer').length;
  return Math.max(0, Math.min(ganzzahl(BEUTE.je_anker), ganzzahl(BEUTE.deckel_je_wrack) - geleert * ganzzahl(BEUTE.je_anker)));
}
function hindernis(game, map) {
  if (!istWrackOrt(game, map)) return null;
  const n = restMenge(game, map);
  if (n <= 0) return null;
  if (Fracht().freiFuer(game, BEUTE.art) >= n) return null;
  const pf = Fracht().platzFuer(game, BEUTE.art);
  return pf.ok ? 'Frachtraum voll' : pf.text;
}
function beuteBergen(game, map) {
  if (!istWrackOrt(game, map)) return { ok: true, ware: 0 };
  const n = restMenge(game, map);
  if (n <= 0) return { ok: true, ware: 0, text: D.texte.nichts_mehr };
  const h = hindernis(game, map);
  if (h) return { ok: false, text: h };
  const r = Fracht().beuteEinlagern(game, BEUTE.art, n);
  return { ok: true, ware: r.eingelagert };
}
module.exports = { istWrackOrt, hindernis, beuteBergen };
