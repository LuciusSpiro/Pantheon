'use strict';
// TEL-01: das Schema des Protokolls an EINER Stelle. Die Auswertung (Paket D) liest nur, was hier steht.
//   SCHEMA[typ] = { frage, felder, text, flach? }
//     frage   Balancing-Frage (1, 2, '2b', 3, 4, 5, 6, '-')
//     felder  vollstaendige Feldliste OHNE die Kopffelder jeder Zeile (v, typ, sitzung, tick, t); Listen (Zahlen/Texte/null, je <= 64 Eintraege) sind flach
//     flach   false: der Typ darf verschachtelte Felder haben (nur 'kopf', der Sessionkopf)
// Eintraege alphabetisch nach typ. Kennungen: Spieler = slot (p1..p4), Gegner = die vorhandene Kennung des Gegnerobjekts (gegner), rolle = Gegnerrolle/-typ.
// Zahlen auf 2 Nachkommastellen, Positionen am Boden auf ganze Kacheln (1 Kachel = 1 m).

const SCHEMA = {
  buchung: { frage: 5, felder: ['konto', 'art', 'grund', 'betrag', 'stand'],
    text: 'Aenderung eines Kontos: konto = marks oder das Verbrauchsgut (bolzen, sonde, medipack, loeschgel, ersatzteil, flickblech, tafel, ladung); art buchung (Wirtschaft) | stand (Stand gesetzt: Anfang, Laden, Test, Debug); grund = Schluessel des Buchungsdienstes; betrag = Aenderung, stand = danach. Der Anfangsstand der Session ist stand - betrag der ersten Buchung des Kontos.' },
  deckung: { frage: '2b', felder: ['slot', 'gegner', 'rolle', 'rein', 'cv', 'geduckt', 'flanke', 'stellung', 'x', 'y'],
    text: 'Deckungswechsel. Spieler (slot gesetzt): rein = auf der Aussenkarte und cv > 0 (Deckung gegen den gefaehrlichsten sichtbaren Gegner, geduckt hinter niedriger Deckung zaehlt voll), rechnet combat.updateVisibility mit aiHz. Gegner (gegner, rolle gesetzt): rein = geduckt (squad.updateEnemyCrouch). cv/flanke nur bei Spielern. stellung = steht in einer Stellung. x, y = Kachel. Nicht entprellt: der kuerzeste Zustand dauert 3 Ticks (Peek-and-Shoot); die Auswertung filtert bei Bedarf. Ein Gegner, der geduckt stirbt, meldet kein rein = false: sein Ende ist das Kill-Ereignis (B1).' },
  energie: { frage: 5, felder: ['grund', 'system', 'delta', 'engines', 'shields', 'weapons', 'leistung', 'verbrauch'],
    text: 'Energieverteilung geaendert: grund technik (Konsole, mit system und delta) | automatik (der Reaktor hat gekuerzt); danach engines/shields/weapons, Reaktorleistung und Verbrauch. Der Verlauf steht in der Zeitreihe (r_energie).' },
  kopf: { frage: '-', flach: false, felder: ['commit', 'server_version', 'plattform', 'node', 'run_id', 'seed', 'modus', 'szenario', 'graben', 'weltstand', 'regielog', 'quelle', 'spielerzahl', 'slots', 'schiff', 'schalter', 'tuning_hash', 'tuning_teile'],
    text: 'Sessionkopf (erste Zeile): Build, Seed, Modus, Spielerzahl, Slots, Schiff, Schalter, Hash und Teile der Tuning-Werte.' },
  konsole: { frage: 4, felder: ['slot', 'konsole', 'station', 'rein', 'grund'],
    text: 'Konsole betreten (rein) oder verlassen bzw. aktive Station gewechselt (grund tab). konsole = Ort, station = aktives Interface (die Rolle). grund: betreten, tab, spieler, abgang, schubs, niedergestreckt, ortswechsel, beamen, debug, sonst (verlassen durch Szenen/Werft/Kampf ohne eigenen Grund).' },
  loeschen: { frage: 4, felder: ['slot', 'art', 'zone'],
    text: 'Feuer geloescht (art feuer) oder Leck geflickt (art leck); zone = Raumkennung der Kachel.' },
  mission_ende: { frage: 1, felder: ['mission', 'ausgang'], text: 'Mission zu Ende.' },
  mission_start: { frage: 1, felder: ['mission'], text: 'Mission begonnen.' },
  partie_beendet: { frage: 1, felder: ['von', 'gesichert', 'grund'], text: 'Partie beendet (Menue, Zerstoerung, Server).' },
  reparatur: { frage: 4, felder: ['slot', 'system', 'wie', 'dauer', 'erfolg', 'notflicken'],
    text: 'Reparaturspiel (Halteprozess) eines Spielers: wie = flick | swap | minigame, dauer in s Spielzeit, erfolg false bei Abbruch/Weglaufen/zu hastig; notflicken = wie flick (Stufe + fragil).' },
  ruf: { frage: 5, felder: ['fraktion', 'betrag', 'stand'], text: 'Ruf bei einer Fraktion geaendert (nur Freie Fahrt Sund); betrag = tatsaechliche Aenderung nach Klemmen.' },
  session_ende: { frage: '-', felder: ['grund', 'dauer', 'zeilen', 'fehler', 'verworfen', 'bytes'], text: 'Letzte Zeile jeder Session.' },
  spieler_bei: { frage: 4, felder: ['slot', 'art', 'belegung', 'nachzuegler', 'spielerzahl'], text: 'Spieler beigetreten (art neu | uebernahme | wieder); nachzuegler = nach dem Start.' },
  spieler_weg: { frage: 4, felder: ['slot', 'belegung', 'spielerzahl'], text: 'Spieler abgegangen.' },
  spielleiter_warten: { frage: 6, felder: ['art', 'dauer', 'ausgang'],
    text: 'Wartezeit auf den Spielleiter in s Spielzeit. art: anflug (Spieler halten vor der Szene, ausgang ready | failed), lage, abenteuer, grobplan, szene, szene-eskalation (Anfrage bis Antwort, ausgang ok | fehler | timeout).' },
  tune: { frage: '-', felder: ['pfad', 'alt', 'neu'], text: 'Laufzeitaenderung eines Tuning-Werts (Debug-Befehl).' },
  zeitreihe: { frage: '2b', felder: [
    'fenster', 'tick_n', 'tick_med', 'tick_max', 'fehler_n', 'fehler_wo',
    'ort', 'r_zustand', 'r_integ', 'r_reaktor', 'r_energie', 'r_leistung', 'r_verbrauch', 'r_hitze', 'r_schild', 'r_gegner',
    'slots', 'verbunden', 'zone', 'konsole', 'station', 'ein_bew', 'ein_akt',
    'b_schild', 'b_wunden', 'b_liegt', 'b_cv', 'b_geduckt', 'b_sp', 'b_gg', 'b_gg_duck', 'b_gg_abst_min', 'b_gg_abst_nn', 'b_gg_pos'],
    text: 'Schnappschuss alle fenster = 2 s Spielzeit (tickgenau). Technik: tick_n Ticks im Fenster, tick_med/tick_max Dauer von game.step in ms, fehler_n Fehler und fehler_wo ihre Schluessel (nie die Meldung). ' +
      'Raum: ort; r_zustand = ein Zeichen je System in der Reihenfolge interior.SYSTEM_ORDER (0 ok, 1 damaged, 2 broken, 3 offline); r_integ je System; r_reaktor; r_energie = engines, shields, weapons; r_leistung/r_verbrauch des Reaktors; r_hitze = engines, shields, weapons; r_schild = vier Sektoren; r_gegner Gegner im Raum (ohne relay). ' +
      'Je Slot (Listen in der Reihenfolge slots): verbunden, zone (ship | away), konsole (Ort), station (aktives Interface = Rolle), ein_bew/ein_akt = Eingaben im Fenster (Bewegung / alles andere, nur Anzahl). ' +
      'Boden (nur wenn jemand auf der Aussenkarte ist, sonst null; je Slot null wenn nicht draussen): b_schild Segmente, b_wunden, b_liegt, b_cv, b_geduckt, b_sp = Position x,y je Slot in Kacheln (Paare); ' +
      'Gegner: b_gg Zahl, b_gg_duck davon geduckt, b_gg_abst_min kleinster und b_gg_abst_nn mittlerer Abstand zum naechsten Nachbarn (Kacheln), b_gg_pos Positionen x,y als Paare (nur bis 16 Gegner, sonst null). Kein Kontostand.' },
  zone_wieder: { frage: 3, felder: ['zone', 'wie', 'durch'],
    text: 'Zone (System) durch Reparatur wieder besser: zone = Systemschluessel, wie = flick | swap | minigame | bot | oda, durch = player | bot | oda.' },
};

module.exports = { SCHEMA };
