'use strict';
// SUND-04a-2 P1: Frachtauftrag light, NUR Faden-intern (kein allgemeines Auftragssystem, das kommt in 04b).
// Ein Beat „fracht“ (Baustein fracht) laedt eine Ware des NSC (Daten: content/faeden/szenen-werte.json, waren) und liefert sie am Zielhafen ab.
// LAD-01 C: die Ware ist ECHTE Fracht im Frachtraum (Art 'fracht', ein Platz, Typ-Regel, Verlust durch Huellentreffer wie jede Ladung): laden() legt sie ueber fracht.lagerAufnehmen
// (quelle 'faden') ein, abgeliefert oder verloren wird sie ueber fracht.auftragEntnehmen (LAD-01 B: Tag = Faden-ID, eigenschaft auftrag). faden.fracht = { ware, von, nach, tick } ist nur noch der AUFTRAG (Ziel, Frist, Weltstand), kein Lager.
// Fehlt die Ladung beim Andocken (Huellentreffer, am Ops abgeliefert, Frachtraum ausgebaut), gilt die Ware als verloren: Ausgang gescheitert.
//
//   laden(game, { fadenId, ware, vonHafen?, nachHafen })  -> { ok, grund? }   der laufende Beat „fracht“ bekommt die Ware (Hex-Codes; ware aus den Daten). Nacharbeit SUND-04a-2 (F6): der Zielhafen muss
//                                                         ANDOCKBAR sein (sonst ok false, nie eine Scheinfracht), die Crew hoert „Ware an Bord: <Ware> fuer <Hafenname>“ (Funk, Daten szenen-werte texte.fracht)
//   zielFuer(game, ort) -> Hex | null                     der naechste andockbare roemische/Konkordat-Hafen in Reichweite (Daten fracht_reichweite) um den Ort (Hex-Abstand, bei Gleichstand kleinerer Code);
//                                                         die Liste der andockbaren Orte kommt aus Karte, Szene (dock) und Besitz, nie aus dem Code
//   andockbar(game, hex) -> bool                          hat der Hex einen Hafen mit Liegeplatz, gehoert er Rom oder dem Konkordat (Besitz-Overlay zaehlt)
//   verlustMelden(game, faden)                            Funk „Die Ware ist verloren“ (Hook in faden.beatAusgang, wenn ein Beat mit Ware scheitert)
//   andocken(game)                                        Hook am Andock-Ereignis (game.js, missionEvent docked): liegt die Ware im Ziel-Hex, wird sie abgeliefert -> Ausgang gelungen
//   verloren(game, fadenId)                               die Ware geht verloren -> Ausgang gescheitert (Hook: Notsprung, game.js, über notsprung)
//   notsprung(game)                                       alle Waren an Bord gehen verloren (Hook in game.js, nach einem gelungenen Notfallsprung)
//   inventar(game)                                        die Waren an Bord (Auftraege), Name und Gewicht aus den Daten (nur Anzeige und Tests)
//   entladen(game, f)                                     die Ladung des Auftrags aus dem Frachtraum nehmen (Hook an jedem Ende eines Beats mit Ware, faden.js)
//   leseFracht(x)                                         Lesen aus dem Weltstand (muellfest): null bei unbrauchbaren Feldern
// Frist und Scheitern kommen aus dem Beat-Takt (beat_frist Taetigkeiten, faden.js): die Ware wird beim Ende des Beats ohnehin aus dem Faden entfernt (faden.beatAusgang).
const Sektoren = require('../../shared/sektoren.js');
const Besitz = require('./besitz.js');
const Locations = require('../../shared/locations.js');
const Lager = require('./fracht.js');   // LAD-01 C: die Ladung liegt im Frachtraum
const D = require('./faden-daten.js');   // BEA-01 C0: Ende-Modus der Beats (D.endeModus, Katalog beats.json ende_modi)
const DATEN = require('../../content/faeden/szenen-werte.json');
const W = DATEN.werte, TX = DATEN.texte;

const HEX = /^\d{4}$/;
const WAREN = W.waren.wert;
let faden = null;   // lazy (Zirkelbezug faden.js -> faden-fracht.js)
const F = () => faden || (faden = require('./faden.js'));

function leseFracht(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const ware = typeof x.ware === 'string' && Object.prototype.hasOwnProperty.call(WAREN, x.ware) ? x.ware : null;
  const nach = typeof x.nach === 'string' && HEX.test(x.nach) ? x.nach : null;
  const von = typeof x.von === 'string' && (x.von === '' || HEX.test(x.von)) ? x.von : '';
  if (!ware || !nach) return null;
  return { ware, von, nach, tick: Number.isFinite(x.tick) && x.tick >= 0 ? Math.floor(x.tick) : 0 };
}

// ---------- Ziel (Nacharbeit F6)
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
function andockbar(game, hex) {
  const d = Sektoren.hexDaten(hex);
  if (!d || !d.hafen) return false;
  if (!W.fracht_ziel_fraktionen.wert.includes(Besitz.besitzer(game, hex))) return false;
  const ort = Sektoren.ortVonHex(hex), l = ort && Locations.get(ort);
  return !!(l && l.scene && Besitz.dockLage(game, l.scene, hex));
}
function zielFuer(game, ort) {
  if (typeof ort !== 'string' || !HEX.test(ort) || !Sektoren.imRaster(ort)) return null;
  const dist = new Map([[ort, 0]]);
  let rand = [ort];
  for (let d = 1; d <= W.fracht_reichweite.wert; d++) {
    const neu = [];
    for (const h of rand) for (const n of Sektoren.nachbarn(h)) if (!dist.has(n)) { dist.set(n, d); neu.push(n); }
    rand = neu;
  }
  const reihe = Array.from(dist.entries()).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  for (const [hex] of reihe) if (andockbar(game, hex)) return hex;
  return null;
}

// ---------- Funk (Sprecher aus den Daten: dieselbe Aufklaerung wie die Szenen; Lagefunk, an alle)
const bitte = () => require('./faden-bitte.js');
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
function funk(game, key, v) {
  try { return bitte().funkSprecher(game, TX.sprecher, fmt(TX.fracht[key], v)); } catch (e) { if (game && game.countError) game.countError('faden-fracht-funk', e); return null; }
}
const frachtVars = (fr, extra) => Object.assign({ ware: WAREN[fr.ware].name, hafen: hexName(fr.nach) }, extra || {});
function verlustMelden(game, f) {
  if (f && f.fracht) funk(game, 'verloren', frachtVars(f.fracht));
}

function laden(game, o) {
  const q = o || {};
  if (!F().aktiv(game)) return { ok: false, grund: 'INAKTIV' };
  const f = F().zustandVon(game).liste.find((x) => x.id === q.fadenId);
  if (!f || f.phase !== 'laeuft' || !f.laufend) return { ok: false, grund: 'kein laufender Beat' };
  if (f.fracht) return { ok: false, grund: 'schon eine Ware an Bord' };
  const ware = q.ware || 'fracht_kiste';
  if (!Object.prototype.hasOwnProperty.call(WAREN, ware)) return { ok: false, grund: 'unbekannte Ware' };
  const hex = Sektoren.hexVonOrt(game.ship.scene) || '';
  const von = q.vonHafen !== undefined ? q.vonHafen : hex;
  const fr = leseFracht({ ware, von, nach: q.nachHafen, tick: game.weltsim.tickZahl });
  if (!fr) return { ok: false, grund: 'Zielhafen ungültig' };
  if (!andockbar(game, fr.nach)) return { ok: false, grund: 'Zielhafen nicht andockbar' };   // nie eine Scheinfracht: die Crew koennte dort nicht abliefern
  // LAD-01 Nacharbeit 2: liegt nur gewoehnliche Fremdware im Weg (Typ-Regel), raeumt der Quartiermeister das kleinste Fremd-Modul (Pod/Hafen, Meldung, Ereignis); Personen, Auftragsware und ein volles Lager nie.
  // Bleibt dann kein Platz, scheitert der Beat mit dem richtigen Grund (platz: true -> Funk „kein_platz“, nicht „kein Hafen“).
  let pf = Lager.platzFuerLadung(game, { art: 'fracht', eig: { auftrag: f.id } });
  if (!pf.ok && pf.grund === 'art_belegt' && Lager.fremdesModulRaeumen(game, { art: 'fracht', eig: { auftrag: f.id } })) pf = Lager.platzFuerLadung(game, { art: 'fracht', eig: { auftrag: f.id } });
  if (!pf.ok) return { ok: false, grund: pf.text, platz: true };   // LAD-01 C: Typ-Regel/Kapazitaet gelten auch fuer die Faden-Ware (nie eine Scheinfracht)
  const r = Lager.lagerAufnehmen(game, { art: 'fracht', quelle: 'faden', eigenschaften: { auftrag: f.id } });   // LAD-01 B: die Ladung gehoert diesem Faden (Tag = Faden-ID): nicht verkaufbar, nicht an irgendeiner Station abgebbar
  if (!r.ok) return { ok: false, grund: r.text };
  f.fracht = fr;
  funk(game, 'laden', frachtVars(fr));
  return { ok: true, grund: null };
}

// Abliefern: der Faden liegt im Ziel-Hex und der Beat „fracht“ laeuft. Beim Andocken im Zielhafen gilt die Ware als abgeliefert.
function andocken(game) {
  if (!F().aktiv(game)) return [];
  const hex = Sektoren.hexVonOrt(game.ship.scene);
  const out = [];
  for (const f of F().zustandVon(game).liste.slice()) {
    if (!f.fracht || f.phase !== 'laeuft' || f.fracht.nach !== hex || !liefertBeat(f)) continue;   // BEA-01 C0: nur der laufende Beat, der abliefert (Ende-Modus liefert), nimmt die Ware an; ein Zwischen-Beat mit Ware am Faden nie
    out.push(f.id);
    if (!Lager.auftragAnBord(game, f.id)) { F().beatAusgang(game, f.id, 'gescheitert'); continue; }   // LAD-01 C: die Ladung ist unterwegs verloren gegangen (Huellentreffer, abgegeben): der Auftrag scheitert
    funk(game, 'abgeliefert', frachtVars(f.fracht));
    F().beatAusgang(game, f.id, 'gelungen');   // entfernt die Ladung aus dem Frachtraum (entladen)
  }
  return out;
}

// Die Ladung des Auftrags verlassen den Frachtraum (abgeliefert, verloren, Beat zu Ende, Szene aufgeloest)
// LAD-01 Nacharbeit 2: auch die Pods dieses Fadens im All (alle Szenen; ein Huellentreffer legt Faden-Ware als Pod ab) verschwinden mit dem Ende des Beats
function entladen(game, f) {
  if (f && f.fracht && game && game.fracht) { Lager.auftragEntnehmen(game, f.id); Lager.podsEntnehmen(game, f.id); }   // LAD-01 B: gezielt die Ladung dieses Fadens, nie irgendeine Ladung der Art fracht
}
// Ein Faden-Tag (f<Nr>) ist erloschen, wenn der Faden in der Liste steht, aber seinen Beat „fracht“ nicht mehr mit Ware fuehrt (Beat zu Ende, Frist, Notsprung). Ein Tag, den kein Faden kennt, bleibt unbeanstandet
// (Tests, Skript, andere Quellen); das Faden-System aus heisst: nichts zu beurteilen.
const FADEN_TAG = /^f\d+$/;
function tagErloschen(game, tag) {
  if (typeof tag !== 'string' || !FADEN_TAG.test(tag) || !F().aktiv(game)) return false;
  const f = F().zustandVon(game).liste.find((x) => x.id === tag);
  return !!f && !(f.fracht && f.phase !== 'abgeschlossen');   // BEA-01 C0: die Ware lebt auch zwischen den Beats (phase wartet), solange sie am Faden haengt
}
// Je Tick (fracht.update): Ladung und Pods mit einem erloschenen Faden-Tag aufraeumen (kein toter Auftrag blockiert ein Modul). -> Zahl der entfernten Eintraege
function aufraeumen(game) {
  const n = Lager.erloschenesAufraeumen(game, FADEN_TAG, (t) => tagErloschen(game, t));
  if (n && game.log) game.log('Fracht: ' + n + ' Ladung(en) eines erloschenen Auftrags entfernt');
  return n;
}

function verloren(game, fadenId) {
  if (!F().aktiv(game)) return { ok: false, grund: 'INAKTIV' };
  const f = F().zustandVon(game).liste.find((x) => x.id === fadenId);
  if (!f || !f.fracht || f.phase === 'abgeschlossen') return { ok: false, grund: 'keine Ware an Bord' };
  if (f.phase === 'wartet') { wareAbgeben(game, f); return { ok: true, grund: null }; }   // BEA-01 C0: zwischen den Beats laeuft kein Beat, der scheitern koennte: die Ware ist weg, der Faden wartet auf seinen naechsten Beat
  F().beatAusgang(game, f.id, 'gescheitert');   // der Ausgang entfernt die Ware (faden.beatAusgang)
  return { ok: true, grund: null };
}

// Notsprung: jede Ware an Bord geht verloren (Hook in game.js bei einem Notsprung)
function notsprung(game) {
  if (!F().aktiv(game)) return [];
  const out = [];
  for (const f of F().zustandVon(game).liste.slice()) if (f.fracht && f.phase !== 'abgeschlossen') { out.push(f.id); verloren(game, f.id); }   // BEA-01 C0: auch die Ware zwischen den Beats
  return out;
}

function inventar(game) {
  const ws = game && game.weltsim; const liste = ws && ws.faeden ? ws.faeden.liste : [];
  return liste.filter((f) => f.fracht).map((f) => ({ faden: f.id, id: f.fracht.ware, name: WAREN[f.fracht.ware].name, gewicht: WAREN[f.fracht.ware].gewicht, nach: f.fracht.nach }));
}

// ---------- BEA-01 C0: Ware ueber mehrere Beats (Ende-Modi der Daten, beats.json ende_modi)
const beatVon = (f) => { const v = f && D.vorlage(f.vorlage); return v ? v.beats[f.beat] : null; };
// Der laufende Beat liefert beim Andocken im Ziel ab (Ende-Modus liefert); jeder andere Beat mit Ware am Faden nie
const liefertBeat = (f) => { const m = D.endeModus(beatVon(f)); return !!(m && m.liefert); };
// Die Ladung des Auftrags liegt noch im Frachtraum (ein spaeter Beat prueft das beim Start: Huellentreffer, abgegeben)
const anBord = (game, fadenId) => !!Lager.auftragAnBord(game, fadenId);
// Bleibt die Ware am Faden, wenn der Beat mit diesem Ausgang endet (Aufrufer: faden.beatAusgang; ausgang null = Beat steht wieder aus, faden.beatZurueck)?
//   Beat mit Ende-Modus: nur ein Lade-Beat (haelt), der gelungen endet; der Abliefer-Beat nie (abgeliefert oder verloren)
//   Beat ohne Ende-Modus (Zwischen-Beat): die Ware reist mit, ausser der Beat scheitert (Frist, Notsprung, Niederlage: Ware verloren)
function behaeltWare(f, beat, ausgang) {
  if (!f || !f.fracht) return false;
  const m = D.endeModus(beat);
  if (m) return ausgang === 'gelungen' && m.haelt === true;
  return ausgang !== 'gescheitert';
}
// Gedaechtnis-Ereignis eines gelungenen Beats mit besonderem Ende (Lade-Beat: fracht_geladen statt fracht_gelungen, damit das Laden allein nie als Lieferung zaehlt); sonst null
const endeEreignis = (beat, ausgang) => { const m = ausgang === 'gelungen' ? D.endeModus(beat) : null; return m && typeof m.ereignis === 'string' ? m.ereignis : null; };
// Die Ware zwischen den Beats geht verloren (Notsprung in der Wartezeit): Funk, Frachtraum leer, Ware vom Faden
function wareAbgeben(game, f) {
  verlustMelden(game, f);
  entladen(game, f);
  delete f.fracht;
}
// Weltstand: darf der Faden in dieser Lage eine Ware tragen (leseFaden)? Ein laufender Beat mit Ende-Modus (heute: Laden/Abliefern) oder ein Beat NACH einem Lade-Beat (die Ware reist mit).
function wareMoeglich(v, beatIndex, phase) {
  if (phase === 'abgeschlossen') return false;
  if (phase === 'laeuft' && D.endeModus(v.beats[beatIndex])) return true;
  return ladeBeatDavor(v, beatIndex);
}
// Gibt es vor diesem Beat einen Lade-Beat (Ende-Modus haelt), der die Ware hier haette tragen lassen? Dann wird eine verlorene Ware nie noch einmal geladen (faden-szene.js) und ihr Verlust gilt als fracht_gescheitert, nicht als fracht_ohne_ware (faden.js)
function ladeBeatDavor(v, beatIndex) {
  for (let j = 0; j < beatIndex; j++) { const m = D.endeModus(v.beats[j]); if (m && m.haelt) return true; }
  return false;
}

module.exports = { ladeBeatDavor, liefertBeat, anBord, behaeltWare, endeEreignis, wareMoeglich, aufraeumen, tagErloschen, laden, entladen, andocken, verloren, notsprung, inventar, leseFracht, zielFuer, andockbar, verlustMelden, funk, WAREN };
