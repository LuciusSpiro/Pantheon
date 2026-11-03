'use strict';
// TEL-01: das Schema des Spielprotokolls an EINER Stelle. Die Auswertung (Paket D) liest nur, was hier steht.
//   SCHEMA[typ] = { frage, felder, text, [auch], [strukturiert] }
//   frage    Balancing-Frage laut Konzept: '1' Dauer, '2' Gefecht, '2b' Deckung, '3' Verluste, '4' Menschen, '5' Wirtschaft, '6' Technik, '-' kein Bezug
//   felder   alle Felder der Zeile AUSSER den Kopffeldern v, typ, sitzung, tick, t (die hat jede Zeile)
//   auch     weitere Fragen, denen der Typ zuarbeitet
//   strukturiert  true: darf verschachtelte Werte tragen (nur der Sessionkopf), alle anderen Typen sind flach (Listen aus Zahlen/Texten/Wahrheitswerten/null, je <= 64 Eintraege)
// Eintraege alphabetisch nach typ (B1 und B2 ergaenzen parallel, so gibt es kaum Konflikte).
//
// Kennungen: Spieler = slot p1..p4; Gegner = die vorhandene Kennung des Gegnerobjekts (gegner), rolle = Klasse/Rolle. Zahlen auf 2 Nachkommastellen, Positionen am Boden auf ganze
// Kacheln (Math.floor(v / 32) wie Physics.toTile; 1 Kachel = 1 m). Ein Feld, das es bei diesem Ereignis nicht gibt, steht als null in der Zeile.
// ort: 'raum' | 'boden'.  zone: IMMER ein Sektor der Lerche (bug, steuerbord, heck, backbord, mitte), nie etwas anderes; die Raumkennung einer Kachel heisst raum.

const SCHEMA = {
  buchung: { frage: '5', text: 'Aenderung eines Kontos: konto = marks oder das Verbrauchsgut (bolzen, sonde, medipack, loeschgel, loeschgelCharges, ersatzteil, flickblech, tafel, ladung); art buchung (Wirtschaft) | stand (Stand gesetzt: Anfang, Laden, Test, Debug); grund = Schluessel des Buchungsdienstes; betrag = Aenderung, stand = danach. Der Anfangsstand der Session ist stand - betrag der ersten Buchung des Kontos. Ein kaputter Wert steht als null, nie als 0.',
    felder: ['konto', 'art', 'grund', 'betrag', 'stand'] },
  deckung: { frage: '2b', text: 'Deckung als ROHZUSTAND (die Deutung "in Deckung" macht die Auswertung): eine Zeile bei jeder Aenderung des Tupels. Spieler (slot gesetzt; Tupel cv, geduckt, verdeckt; Takt 5 Hz = combat.updateVisibility/aiHz): cv 0/1/2 = Deckung gegen den gefaehrlichsten sichtbaren Gegner (2 = voll, auch geduckt hinter niedriger Deckung ohne Gegner in Sicht), geduckt = p.crouch, verdeckt = es gibt alarmierte Gegner, keiner hat Sicht auf den Spieler und der Spieler steht an Deckung (combat.verdecktVor), flanke = offene Flanke zum Zeitpunkt der Zeile. Gegner (gegner, rolle gesetzt; Tupel geduckt, stellung; geduckt = e.crouch wird je Tick geprueft (squad.updateEnemyCrouch), stellung = steht in einer Stellung im 5-Hz-Takt oder sofort bei einem Wechsel von geduckt); cv, verdeckt, flanke null. stellung beim Spieler = steht in einer Stellung zum Zeitpunkt der Zeile (nicht im Tupel). x, y = Kachel. Grundzustand (0|0|0 bzw. 0|0) wird nicht gemeldet; die erste Zeile einer Figur ist der erste Zustand ungleich Grundzustand. Nicht entprellt: der kuerzeste Zustand dauert einen Takt (Peek-and-Shoot), die Auswertung filtert bei Bedarf. ende (sonst null) schliesst einen offenen Zustand mit einer letzten Zeile im Grundzustand: session (Sessionende), ort (Spieler nicht mehr draussen oder Aussenkarte gewechselt), tod (Gegner gefallen), weg (Gegner aus der Liste entfernt, z. B. Wellenende; bis zu 0,2 s spaeter erkannt). Zeit in Deckung = Zeit zwischen einer Zeile ungleich Grundzustand und der naechsten Zeile derselben Figur. "Zeit bis zum ersten Treffer" und "Treffer aus der Deckung" ergeben sich mit den Treffern aus B1 (von_deckung, ziel_deckung).',
    felder: ['slot', 'gegner', 'rolle', 'cv', 'geduckt', 'verdeckt', 'flanke', 'stellung', 'x', 'y', 'ende'] },
  energie: { frage: '5', text: 'Energieverteilung geaendert: grund technik (Konsole, mit system und delta) | automatik (der Reaktor hat gekuerzt); danach engines/shields/weapons, Reaktorleistung und Verbrauch. Der Verlauf steht in der Zeitreihe (r_energie).',
    felder: ['grund', 'system', 'delta', 'engines', 'shields', 'weapons', 'leistung', 'verbrauch'] },
  konsole: { frage: '4', text: 'Konsole betreten (rein) oder verlassen bzw. aktive Station gewechselt (grund tab). konsole = Ort, station = aktives Interface (die Rolle). grund: betreten, tab, spieler, abgang, schubs, niedergestreckt, ortswechsel, beamen, debug, sonst (verlassen durch Szenen/Werft/Kampf ohne eigenen Grund).',
    felder: ['slot', 'konsole', 'station', 'rein', 'grund'] },
  kopf: { frage: '-', text: 'Sessionkopf (erste Zeile)', strukturiert: true,
    felder: ['commit', 'server_version', 'plattform', 'node', 'run_id', 'seed', 'modus', 'szenario', 'graben', 'weltstand', 'regielog', 'quelle', 'spielerzahl', 'slots', 'schiff', 'schalter', 'tuning_hash', 'tuning_teile'] },
  loeschen: { frage: '4', text: 'Feuer geloescht (art feuer) oder Leck geflickt (art leck); raum = Raumkennung der Kachel (nicht der Sektor).',
    felder: ['slot', 'art', 'raum'] },
  mission_ende: { frage: '1', text: 'Mission zu Ende.', felder: ['mission', 'ausgang'] },
  mission_start: { frage: '1', text: 'Mission begonnen.', felder: ['mission'] },
  partie_beendet: { frage: '1', text: 'Partie beendet (Menue, Zerstoerung, Server)', felder: ['von', 'gesichert', 'grund'] },
  reparatur: { frage: '4', text: 'Reparaturspiel (Halteprozess) eines Spielers: wie = flick | swap | minigame, dauer in s Spielzeit, erfolg false bei Abbruch/Weglaufen/zu hastig; notflicken = wie flick (Stufe + fragil).',
    felder: ['slot', 'system', 'wie', 'dauer', 'erfolg', 'notflicken'] },
  ruf: { frage: '5', text: 'Ruf bei einer Fraktion geaendert (nur Freie Fahrt Sund); betrag = tatsaechliche Aenderung nach Klemmen, stand = danach; grund = Quelle der Wirkung (Schluessel aus content/welt/ruf-werte.json, folge:<grund> bei der Nebenwirkung, debug, sonst).',
    felder: ['fraktion', 'grund', 'betrag', 'stand'] },
  session_ende: { frage: '-', text: 'Ende der Session (letzte Zeile)', felder: ['grund', 'dauer', 'zeilen', 'fehler', 'verworfen', 'bytes'] },
  spieler_bei: { frage: '1', auch: ['4'], text: 'Spieler tritt bei (neu, uebernahme, wieder)', felder: ['slot', 'art', 'belegung', 'nachzuegler', 'spielerzahl'] },
  spieler_weg: { frage: '1', auch: ['4'], text: 'Spieler geht', felder: ['slot', 'belegung', 'spielerzahl'] },
  spielleiter_warten: { frage: '6', text: 'Wartezeit auf den Spielleiter in s Spielzeit. art: anflug (Spieler halten vor der Szene, ausgang ready | failed), lage, abenteuer, grobplan, szene, szene-eskalation (Anfrage bis Antwort, ausgang ok | fehler | timeout; timeout auch bei einem Transportfehler mit Code ETIMEDOUT).',
    felder: ['art', 'dauer', 'ausgang'] },
  tune: { frage: '-', text: 'Laufzeitaenderung eines Tuning-Werts (Debug)', felder: ['pfad', 'alt', 'neu'] },
  zeitreihe: { frage: '2b', auch: ['4', '5', '6'],
    text: 'Schnappschuss alle fenster = 2 s Spielzeit (tickgenau; zaehlt nicht in der Solo-Pause). Technik: tick_n Ticks im Fenster, tick_med/tick_max Dauer von game.step in ms, tick_ueber5/16/33 Ticks mit mehr als 5/16/33 ms; ' +
      'snap_n/snap_med/snap_max Snapshot-Bau + Broadcast in ms (nur im Server, index.js; im Bot-Lauf n = 0); kappung_n Aufrufe der Tickschleife, in denen die 250-ms-Kappung Zeit verwarf, kappung_ticks die dabei verworfene Zeit in Ticks, nachhol_ticks Ticks, die ein Aufruf zusaetzlich zum ersten nachholte; fehler_n Fehler und fehler_wo ihre Schluessel (nie die Meldung). ' +
      'Raum: szene (Name der Szene); r_zustand = ein Zeichen je System in der Reihenfolge interior.SYSTEM_ORDER (0 ok, 1 damaged, 2 broken, 3 offline); r_integ je System; r_reaktor; r_energie = engines, shields, weapons; r_leistung/r_verbrauch des Reaktors; r_hitze = engines, shields, weapons; r_schild = vier Sektoren; r_gegner Gegner im Raum (ohne relay). ' +
      'Je Slot (Listen in der Reihenfolge slots): verbunden, ort (raum | boden), konsole (Ort der Konsole), station (aktives Interface = Rolle), ein_bew/ein_akt = Eingaben im Fenster (Bewegung / alles andere, nur Anzahl, Debug und clientError zaehlen nicht). ' +
      'Boden (nur wenn jemand auf der Aussenkarte ist, sonst null; je Slot null wenn nicht draussen): b_schild Segmente, b_wunden, b_liegt, b_cv (Rohwert, Deutung siehe deckung), b_geduckt, b_sp = Position x,y je Slot in Kacheln (Paare); ' +
      'Gegner: b_gg Zahl, b_gg_duck davon geduckt, b_gg_abst_min kleinster und b_gg_abst_nn mittlerer Abstand zum naechsten Nachbarn (Kacheln), b_gg_pos Positionen x,y als Paare (nur bis 16 Gegner, sonst null). Kein Kontostand.',
    felder: [
      'fenster', 'tick_n', 'tick_med', 'tick_max', 'tick_ueber5', 'tick_ueber16', 'tick_ueber33', 'snap_n', 'snap_med', 'snap_max', 'kappung_n', 'kappung_ticks', 'nachhol_ticks', 'fehler_n', 'fehler_wo',
      'szene', 'r_zustand', 'r_integ', 'r_reaktor', 'r_energie', 'r_leistung', 'r_verbrauch', 'r_hitze', 'r_schild', 'r_gegner',
      'slots', 'verbunden', 'ort', 'konsole', 'station', 'ein_bew', 'ein_akt',
      'b_schild', 'b_wunden', 'b_liegt', 'b_cv', 'b_geduckt', 'b_sp', 'b_gg', 'b_gg_duck', 'b_gg_abst_min', 'b_gg_abst_nn', 'b_gg_pos'] },
  zone_wieder: { frage: '3', auch: ['4'], text: 'Zonensystem repariert (schreibt B2 in interior.repairSystem): system = Systemschluessel, zone = Sektor der Lerche (wie bei zone_aus, B1), wie = flick | swap | minigame | bot | oda, durch = player | bot | oda.',
    felder: ['system', 'zone', 'wie', 'durch'] },
};

module.exports = { SCHEMA };
