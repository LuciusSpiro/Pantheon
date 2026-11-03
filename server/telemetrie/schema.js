'use strict';
// TEL-01: das Schema des Spielprotokolls an EINER Stelle. Die Auswertung (Paket D) liest nur, was hier steht.
//   SCHEMA[typ] = { frage, felder, text, [auch], [strukturiert] }
//   frage    Balancing-Frage laut Konzept: '1' Dauer, '2' Gefecht, '2b' Deckung, '3' Verluste, '4' Menschen, '5' Wirtschaft, '6' Technik, '-' kein Bezug
//   felder   alle Felder der Zeile AUSSER den Kopffeldern v, typ, sitzung, tick, t (die hat jede Zeile)
//   auch     weitere Fragen, denen der Typ zuarbeitet
//   strukturiert  true: darf verschachtelte Werte tragen (nur der Sessionkopf), alle anderen Typen sind flach
// Einträge alphabetisch nach typ (B1 und B2 ergänzen parallel, so gibt es kaum Konflikte).
//
// Kennungen: Spieler = slot p1..p4; von/ziel eines Schusses = p1..p4, lerche, gegner, objekt (crew: Spieler unbekannt);
//   gegner = Kennung des Gegnerobjekts (game.space.enemies[].id bzw. Boden-Gegner id), rolle = Klasse/Rolle (Raum: kind, Boden: rolle bzw. kind).
//   Zahlen auf 2 Nachkommastellen. Ein Feld, das es bei diesem Ereignis nicht gibt, steht als null in der Zeile.
//
// ort: 'raum' | 'boden'.   modus (Szenen): kampagne, labor, arena_raum, arena_boden, wellen_boden, wellen_all, graben, endkampf, sund.
// waffe (Raum Lerche): Katalog-Id (lanze, standardbatterie, ..., torpedowerfer); Treffer auf die Lerche: schuss, sperrfeuer, sturm, emp, torpedo, streu, ladung, brocken, mine, sonstige.
// waffe (Boden): blaster, sturmgewehr, granatwerfer, lanze, nahkampf, betaeuber, schrottblaster, faust, waechter; ohne Waffen-Rolle pistol (Verwundete), blaster, warden, enemy.
//
// TREFFERQUOTE JE WAFFE (schuss + treffer): Eine Schusskennung pid verbindet beide, je ort. Raum (nur Lerche): pid = Projektilkennung; die Lanze hat keine (ein Schuss, Ergebnis
//   steht gleich im schuss: treffer true/false). Boden: pid = Projektilkennung (Blaster, Sturmgewehr, Granate, Pistole) oder eine vom Dienst vergebene Kennung 's<n>' (Lanze, Nahkampf);
//   jeder Treffer eines Schusses traegt dieselbe pid (Lanze und Flaechenwaffen: ein Schuss, n Treffer).
//   Quote = Schuesse mit mindestens einem Treffer / Schuesse (je ort, waffe, von); Treffer je Schuss = Treffer / Schuesse. Treffer ohne pid (Orbitalschlag, Mine) gehoeren zu keinem Schuss.
// SCHADEN: schaden_roh = Schaden vor Schild; schild = dabei verlorene Schildpunkte (Raum, Gegner-Schild: Summe der Segmente) bzw. Schildsegmente (Boden, Bodenschild); schaden = was darueber
//   hinaus wirkt. Raum Lerche -> Gegner: schaden = Schildverlust + (nur bei Systemtreffer oder Sofort-Tod) Restschaden; Raum Gegner -> Lerche: schaden = Rest nach Schild (damage.resolveHit);
//   Boden: schaden = schaden_roh, wenn die Wirkung den Koerper erreicht (ergebnis wunde|gefallen|bewusstlos), sonst 0 (Schild nahm sie auf).

const SCHEMA = {
  bodenschild_leer: { frage: '3', text: 'Bodenschild eines Spielers auf 0 (Wirkung erreicht ihn: nächster Treffer wirft ihn um)', felder: ['slot', 'waffe'] },
  gefallen: { frage: '3', text: 'Spieler geht am Boden zu Boden (verwundet): durch einen Waffentreffer (treffer mit ergebnis gefallen, waffe/von dort) oder einen Monsterbiss (waffe monster)', felder: ['slot', 'waffe', 'von'] },
  gegner_neu: { frage: '2', text: 'Gegner erscheint. quelle spawn = im Tick des Erscheinens gesehen, kontakt = erst im Gefecht aufgefallen (Boden ohne Wellen/Graben)', felder: ['ort', 'gegner', 'rolle', 'tag', 'verbuendet', 'quelle'] },
  gegner_weg: { frage: '2', text: 'Gegner verschwindet ohne Abschuss. grund: Raum rueckzug, zerstoert, szenenwechsel, welle_vorbei (Wellenende raeumt), uebersprungen (Debug-Skip der Welle, Bots nach der Wellenzeitgrenze), konvoi_ende (Frachter und Eskorte des Konvois verlassen das Feld), unbekannt (alle uebrigen Wege); Boden welle_vorbei, koerperbudget, koerperzeit, neubeginn, abgezogen', felder: ['ort', 'gegner', 'rolle', 'grund', 'lebte'] },
  kill: { frage: '2', text: 'Abschuss (Raum: Gegner zerstört; Boden: Gegner geht zu Boden, kann wieder aufstehen, nr zählt). von/waffe aus dem treffer, der ihn fällt (steht davor; Raum auch aus dem letzten Treffer der Lerche, wenn der Tod später kommt, Reaktor-Countdown); von sonstige nur, wenn die Lerche ihn nie getroffen hat (Verbündete, Brocken)', felder: ['ort', 'gegner', 'rolle', 'von', 'waffe', 'lebte', 'nr'] },
  kopf: { frage: '-', text: 'Sessionkopf (erste Zeile)', strukturiert: true,
    felder: ['commit', 'server_version', 'plattform', 'node', 'run_id', 'seed', 'modus', 'szenario', 'graben', 'weltstand', 'regielog', 'quelle', 'spielerzahl', 'slots', 'schiff', 'schalter', 'tuning_hash', 'tuning_teile'] },
  notfall: { frage: '3', text: 'Notfallprotokoll der Lerche ausgelöst (Kosten in Marken bucht der Buchungsdienst)', felder: ['grund'] },
  notrueckholung: { frage: '3', text: 'Notrückholung am Boden. art: einzel (Ausbluten), krankenstation, fern (Ausbluten bei zerstörtem Transfer, kein Beamen), team (ganzes Außenteam, slots)', felder: ['art', 'slot', 'slots'] },
  partie_beendet: { frage: '1', text: 'Partie beendet (Menü, Zerstörung, Server)', felder: ['von', 'gesichert', 'grund'] },
  schiff_zerstoert: { frage: '3', text: 'Schiff zerstört (Reaktor-Countdown abgelaufen)', felder: ['grund', 'n'] },
  schuss: { frage: '2', auch: ['2b'], text: 'Schuss. Raum: nur die Lerche (Gegnerschüsse im Raum über treffer); Boden: Spieler und Gegner. treffer (nur Lanze Raum) = beim Schuss bekannt; sonst Quote über treffer mit gleicher pid (siehe Kopf der Datei: Quote = Schüsse mit >= 1 Treffer / Schüsse)', felder: ['ort', 'waffe', 'von', 'mount', 'pid', 'ziel', 'gegner', 'rolle', 'kraft', 'treffer', 'hitze', 'von_deckung', 'geduckt'] },
  session_ende: { frage: '-', text: 'Ende der Session (letzte Zeile)', felder: ['grund', 'dauer', 'zeilen', 'fehler', 'verworfen', 'bytes'] },
  spieler_bei: { frage: '1', auch: ['4'], text: 'Spieler tritt bei (neu, uebernahme, wieder)', felder: ['slot', 'art', 'belegung', 'nachzuegler', 'spielerzahl'] },
  spieler_weg: { frage: '1', auch: ['4'], text: 'Spieler geht', felder: ['slot', 'belegung', 'spielerzahl'] },
  szene_ende: { frage: '1', text: 'Szene endet (Kampagnenmission, Labor, Testgelände, Wellen, Graben, Endkampf, Sund). dauer = seit szene_start bzw. dem letzten szene_neustart (Graben: der letzte Versuch), dauer_gesamt = seit szene_start. Eine Szene, die bis zum Ende der Session lief, schließt der Dienst mit ausgang session_ende. spielerzahl = beim Ende; ein späterer Beitritt steht in spieler_bei', felder: ['modus', 'szene', 'ausgang', 'dauer', 'dauer_gesamt', 'spielerzahl', 'welle', 'geschafft', 'debug', 'versuche', 'hex', 'verrat'] },
  szene_neustart: { frage: '1', auch: ['3'], text: 'Grabenangriff beginnt nach Niederlage von vorn', felder: ['modus', 'szene', 'versuch'] },
  szene_start: { frage: '1', text: 'Szene beginnt. spielerzahl = beim Start (spätere Beitritte: spieler_bei)', felder: ['modus', 'szene', 'spielerzahl', 'seed', 'gegner', 'hex', 'klasse'] },
  treffer: { frage: '2', auch: ['2b', '3'], text: 'Treffer oder Wirkung. Raum: Lerche→Gegner (schade) und alles →Lerche (shipHit); Boden: waffen.treffer. ergebnis Raum treffer|abgeprallt|ausgewichen|emp; Boden schild|wunde|gefallen|bewusstlos|abgelenkt|kuppel. schild, schaden: siehe SCHADEN im Kopf der Datei. von bei Treffern auf die Lerche: gegner, objekt (Brocken, Mine). wunde (Boden, Feld) = true, wenn der Treffer eine Wunde gesetzt hat (ergebnis wunde oder gefallen; "gefallen" ist der Fall, in dem der Spieler zu Boden geht, dann folgt das Ereignis gefallen)',
    felder: ['ort', 'waffe', 'von', 'ziel', 'gegner', 'rolle', 'pid', 'ergebnis', 'schaden_roh', 'schild', 'schaden', 'zone', 'system', 'zustand', 'sektor', 'systeme', 'schuetzling', 'wunde', 'von_deckung', 'ziel_deckung', 'flaeche'] },
  tune: { frage: '-', text: 'Laufzeitänderung eines Tuning-Werts (Debug)', felder: ['pfad', 'alt', 'neu'] },
  ueberhitzt: { frage: '2', text: 'Überhitzung. Boden: Waffe gesperrt; Raum: Hitzegrenze eines Systems erreicht (Energie 4)', felder: ['ort', 'waffe', 'von', 'gegner', 'system'] },
  ueberladung: { frage: '2', auch: ['6'], text: 'Reaktor-Überladung der Lerche: wie an (ausgelöst) oder ende (Zeit abgelaufen, Reaktor schaltet ab); der Verlauf steht in der Zeitreihe', felder: ['wie'] },
  welle: { frage: '1', auch: ['2'], text: 'Welle beginnt (Wellen Boden, Wellen All)', felder: ['modus', 'nr', 'gesamt', 'spielerzahl'] },
  welle_geschafft: { frage: '1', auch: ['2'], text: 'Welle geschafft; dauer = Sekunden seit Wellenbeginn', felder: ['modus', 'nr', 'dauer'] },
  zone_aus: { frage: '3', text: 'Zonensystem der Lerche fällt aus oder wird beschädigt (Stufenverlust)', felder: ['system', 'zone', 'zustand', 'vorher'] },
  zone_wieder: { frage: '3', text: 'Zonensystem repariert (schreibt Paket B2 in interior.repairSystem); wie = Art der Reparatur', felder: ['system', 'zone', 'wie'] },
};

module.exports = { SCHEMA };
