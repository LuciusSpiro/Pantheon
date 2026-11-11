'use strict';
// MON-02 P1: Mission-Aktion für Kreaturen (Registry-Plugin, Logik in server/sim/kreatur.js; kein Eintrag in content/regiebuch/bausteine.json nötig).
//   kreatur_besetzen { map*, bereich?, typ*, anzahl*, gruppe* }   Aktion: ein Rudel (anzahl 1 bis 12 Tiere des Typs, Kennung gruppe) auf einer Außenkarte anlegen
//     map      Außenkarte (Typ map: die Mission schiebt die Aktion auf, bis die Karte gebaut und registriert ist, wie bei besetzen)
//     bereich  Bereichs-Kennung der Karte (lager_N, gelaende); ohne Angabe die ganze Karte. Ein unbekannter Bereich scheitert laut (kein stiller Rückfall auf die Karte)
//     typ      Kreaturentyp aus content/kampf/kreaturen.json (Text, kein Typname im Servercode: die Prüfung gegen die Daten läuft zur Laufzeit in Kreatur.rudelSetzen)
//     gruppe   Rudel-Kennung (Text, nicht squad: squad verlangt einen Eintrag in besetzung.gruppen des Regiebuchs); Buchführung aw.kreaturGruppen[gruppe]
//   nest_besetzen { map*, typ*, gruppe* }   Aktion (MON-03 B): die Quelle einer Gruppe (Königin) am verdeckten Anker nest der Karte anlegen (Kreatur.nestBesetzen); Fehler wie bei kreatur_besetzen (countError 'mission-kreatur')
//   kreaturen_erledigt { map*, gruppe | typ }   Prüfung (MON-02 P2): erfüllt, wenn mindestens ein Tier der Gruppe (bzw. des Typs) erschien und kein Tier mehr nicht endgültig erledigt ist.
//     Aufgelöste Tiere (Bindung) zählen als erledigt; bewusstlose und liegende (erholbare) Tiere zählen als NICHT erledigt (anders als squad_cleared, das liegende Drohnen mitzählt).
//     Genau eines von gruppe/typ ist Pflicht (der Prüfer lehnt beides/keines und einen unbekannten typ ab; zur Laufzeit einmal countError 'mission-kreatur'). Unbekannte Karte oder Gruppe (nie erschienen): nicht erfüllt, kein Fehler. Kreaturen zählen in squad_cleared, Wellen, Graben, Bodenkampf nicht mit.
//     Ereignis kreaturAusgefallen { id, typ, gruppe, x, y } (Missions- und Spielereignis, Kreatur.ausgefallenMelden) kommt je Tier einmal beim endgültigen Ausfall durch Beschuss.
// Fehler (unbekannter Typ, Bereich oder Karte, Anzahl außerhalb 1 bis 12, kein erreichbarer Platz) zählen als game.countError('mission-kreatur') mit der Meldung von Kreatur.rudelSetzen; es entsteht dann kein Tier.
const Kreatur = () => require('../../sim/kreatur.js');
// SPL-01 a4: Rudel-Deckel im Prüfer. Zahlen stehen je Typ in kreaturen.json (Feld rudel, Kreatur.rudelRegel), hier nur die Anwendung:
//   argsPruefen (je Aufruf): Rudelgröße gegen rudel.tiere; Bereich im Höhlen-Deck unter einer Wildnis (dort scheitert die Platzierung, Kreatur kennt keine Decks)
//   dokPruefen (je Buch, der Prüfer sammelt alle Aufrufe): Rudel je Karte gegen rudel.jeKarte
const Objekte = () => require('../objects.js');
const GenHoehle = () => require('../../../shared/gen-hoehle.js');
// Kartenart, die ein Höhlen-Deck unter der Oberfläche tragen kann (landepunkte.js hoehleKannAdern, gen-gelaende): nur die Wildnis
const MIT_DECK = 'wildnis';
// Liegt der Bereich im Höhlen-Deck unter einer Wildnis? Der Prüfer kennt nur die Landepunkt-Kennung (gebaute Karten gibt es erst zur Laufzeit), also die Kartenart aus den Landepunkt-Daten
// und die Bereichs-Namen aus dem Erzeuger selbst: alle Bereiche des Decks tragen den Platznamen des Erzeugers (GenHoehle.PLATZ) als Namen oder Präfix (hoehle, hoehle_lager_n).
function bereichImDeckFehler(args) {
  const o = args || {};
  if (typeof o.bereich !== 'string' || typeof o.map !== 'string') return [];
  const lp = Objekte().landepunkt(o.map);
  if (!lp || lp.art !== MIT_DECK) return [];
  const P = GenHoehle().PLATZ;
  if (o.bereich !== P && !o.bereich.startsWith(P + '_')) return [];
  return ["'bereich' = \"" + o.bereich + "\" liegt im Höhlen-Deck unter der Wildnis '" + o.map + "' (Rudel dort scheitern: die Platzierung kennt keine Decks); Rudel nur auf der Oberfläche oder auf einer eigenen Höhlenkarte"];
}

module.exports = (Registry) => {
  Registry.define({ id: 'kreatur_besetzen', art: 'aktion', effekt: 'gegner',
    ereignisse: ['kreaturAusgefallen', 'kreaturAufgeloest'],   // entstehen später am Tier (Beschuss bzw. Bindung), nicht in der Aktion selbst
    beschreibung: 'Rudel von Kreaturen (Typ aus kreaturen.json, 1 bis 12 Tiere, Kennung gruppe) in einem Bereich einer Außenkarte anlegen: nur erreichbare Plätze, mit Abstand, weit vom Abholpunkt. Unbekannter Bereich oder kein Platz: Fehler, kein Tier',
    params: { map: { typ: 'map', pflicht: true }, bereich: { typ: 'area' }, typ: { typ: 'string', pflicht: true },
      anzahl: { typ: 'number', pflicht: true, min: 1, max: 12 }, gruppe: { typ: 'string', pflicht: true } },
    argsPruefen: (args) => Kreatur().rudelGroesseFehler(args).concat(bereichImDeckFehler(args)).map((t) => ({ code: 'PARAM-WERT', text: t })),
    dokPruefen: (liste) => Kreatur().rudelJeKarteFehler(liste.map((x) => x.args)).map((f) => ({ code: 'PARAM-WERT', p: liste[f.index].p, text: f.text })),
    run(m, a) {
      const g = m.game;
      let r;
      try { r = Kreatur().rudelSetzen(g, { map: a.map, bereich: a.bereich != null ? a.bereich : null, typ: a.typ, anzahl: a.anzahl, gruppe: a.gruppe }); }
      catch (e) { g.countError('mission-kreatur', e); return; }
      if (r.fehler) g.countError('mission-kreatur', new Error(r.fehler));
    } });
  // MON-03 B: Quelle (Königin) an den verdeckten Anker der Rolle nest der Karte setzen; Logik in Kreatur.nestBesetzen. Der Nachwuchs entsteht über den Baustein brut des Typs, nicht hier.
  Registry.define({ id: 'nest_besetzen', art: 'aktion', effekt: 'gegner',
    ereignisse: ['kreaturAusgefallen', 'kreaturAufgeloest'],
    beschreibung: 'Quelle einer Kreatur-Gruppe (z. B. Königin eines Schwarms, Typ aus kreaturen.json, Kennung gruppe) am Nistplatz (Anker nest) einer Außenkarte anlegen; ihr Gefolge entsteht über die Daten des Typs. Karte ohne Nest: Fehler, kein Tier',
    params: { map: { typ: 'map', pflicht: true }, typ: { typ: 'string', pflicht: true }, gruppe: { typ: 'string', pflicht: true } },
    run(m, a) {
      const g = m.game;
      let r;
      try { r = Kreatur().nestBesetzen(g, { map: a.map, typ: a.typ, gruppe: a.gruppe }); }
      catch (e) { g.countError('mission-kreatur', e); return; }
      if (r.fehler) g.countError('mission-kreatur', new Error(r.fehler));
    } });
  Registry.define({ id: 'kreaturen_erledigt', art: 'pruefung',
    beschreibung: 'Rudel erledigt: mindestens ein Tier der Gruppe (oder des Typs) erschien und alle sind endgültig erledigt (tot oder aufgelöst); bewusstlose und liegende Tiere zählen nicht. Genau eines von gruppe oder typ',
    params: { map: { typ: 'map', pflicht: true }, gruppe: { typ: 'string' }, typ: { typ: 'string' } },
    // Prüfer (checker.paramCheck): Kreuzregel genau eines von gruppe/typ, typ gegen kreaturen.json; zur Laufzeit meldet Kreatur.rudelErledigt denselben Fehler einmal (countError)
    argsPruefen: (args) => Kreatur().erledigtOptionenFehler(args).map((t) => ({ code: 'PARAM-WERT', text: t })),
    test: (m, a) => {
      return Kreatur().rudelErledigt(m.game, a.map, { gruppe: a.gruppe, typ: a.typ });
    } });
};
