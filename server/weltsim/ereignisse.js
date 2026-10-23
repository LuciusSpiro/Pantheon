'use strict';
// Ereignistypen der Weltsimulation. Jedes Ereignis: { typ, tick, fraktion, ...Felder }. Die Felder je Typ sind so gewählt, dass eine
// Textvorlage das Ereignis ohne Zugriff auf den Sim-Zustand formulieren kann. angriff = Id des Feldzugs (zustand.angriffe), gleiche Id über alle Ereignisse
// eines Feldzugs (Sammeln, Marsch, Belagerung, Ausgang, Notruf), damit Meldungen nie doppelt kommen. Fehlt bei Posten- und Hafen-Ereignissen ohne Feldzug. (Orte als Code und Name, Stärke und Stärkeklasse als Zahl).
//   ort/ziel/stuetzpunkt: Hex-Code, dazu <feld>Name.  staerke: Summe der Stärkepunkte der beteiligten Flotten.  klasse: 1 klein, 2 mittel, 3 groß.
const TYPEN = {
  flotte_aufbruch: ['art', 'von', 'ziel', 'staerke', 'klasse', 'angriff'],               // art: 'angriff' | 'beanspruchen' | 'raubzug'; direkter Aufbruch ohne Sammeln
  flotte_sammelt: ['stuetzpunkt', 'ziel', 'staerke', 'klasse', 'flotten', 'angriff'],    // Angriff beginnt mit dem Sammeln in einem Stützpunkt
  flotte_marsch: ['stuetzpunkt', 'ziel', 'staerke', 'klasse', 'angriff'],                // Sammeln fertig, der Marsch beginnt
  flotte_belagert: ['ziel', 'zielArt', 'besitzer', 'staerke', 'klasse', 'angriff'],      // erste Flotte am Ziel (zielArt: 'hafen' | 'posten'); nur Reichsangriffe
  angriff_abgewehrt: ['art', 'ziel', 'zielArt', 'besitzer', 'angriff'],                  // art: 'reich' | 'pirat'
  angriff_abgebrochen: ['ziel', 'grund', 'angriff'],                                     // grund: 'zeit' | 'ziel' | 'keine_flotte' (Sammeln abgebrochen)
  hafen_gefallen: ['ort', 'alt', 'neu'],                                      // fraktion = neuer Besitzer
  posten_gegruendet: ['ort'],
  posten_gehisst: ['ort'],                                                    // SUND-02b A1: Posten der Crew (Wirkung posten_gehisst), fraktion rom; kein posten_gegruendet, damit die Kennzahlen nur Posten der Sim zählen
  posten_ausgebaut: ['ort'],                                                  // SUND-02b A1: römischer Posten zum Stützpunkt der Crew ausgebaut
  posten_verloren: ['ort', 'besitzer', 'durch'],                              // fraktion = bisheriger Besitzer
  konvoi: ['handel', 'menge'],                                                // abstrakter Handel des Konkordats, höchstens eines je Tick
  notruf: ['art', 'ort', 'opfer', 'angreifer', 'staerke', 'klasse', 'angriff'],          // art: 'piratenueberfall' | 'belagerung'; fraktion = Opfer
  hauptwelt_gefallen: ['ort', 'alt', 'neu'],                                  // Palatina 0204 / Hrafnheim 1004; für Rom das Spielende-Signal
};

const ORTSFELDER = ['ort', 'ziel', 'stuetzpunkt', 'von'];

// Baut ein Ereignis. namen: (code) => Anzeigename. Fehlendes Feld wirft (Programmierfehler früh sichtbar).
function bauen(typ, tick, fraktion, felder, namen) {
  const soll = TYPEN[typ];
  if (!soll) throw new Error(`Unbekannter Ereignistyp: ${typ}`);
  const e = { typ, tick, fraktion };
  for (const f of soll) {
    if (!(f in felder)) throw new Error(`Ereignis ${typ}: Feld "${f}" fehlt`);
    e[f] = felder[f];
    if (ORTSFELDER.includes(f)) e[f + 'Name'] = namen(felder[f]);
  }
  return e;
}

module.exports = { TYPEN, bauen };
