'use strict';
// MON-02 P1: Mission-Aktion für Kreaturen (Registry-Plugin, Logik in server/sim/kreatur.js; kein Eintrag in content/regiebuch/bausteine.json nötig).
//   kreatur_besetzen { map*, bereich?, typ*, anzahl*, gruppe* }   Aktion: ein Rudel (anzahl 1 bis 12 Tiere des Typs, Kennung gruppe) auf einer Außenkarte anlegen
//     map      Außenkarte (Typ map: die Mission schiebt die Aktion auf, bis die Karte gebaut und registriert ist, wie bei besetzen)
//     bereich  Bereichs-Kennung der Karte (lager_N, gelaende); ohne Angabe die ganze Karte. Ein unbekannter Bereich scheitert laut (kein stiller Rückfall auf die Karte)
//     typ      Kreaturentyp aus content/kampf/kreaturen.json (Text, kein Typname im Servercode: die Prüfung gegen die Daten läuft zur Laufzeit in Kreatur.rudelSetzen)
//     gruppe   Rudel-Kennung (Text, nicht squad: squad verlangt einen Eintrag in besetzung.gruppen des Regiebuchs); Buchführung aw.kreaturGruppen[gruppe]
//   kreaturen_erledigt { map*, gruppe | typ }   Prüfung (MON-02 P2): erfüllt, wenn mindestens ein Tier der Gruppe (bzw. des Typs) erschien und kein Tier mehr nicht endgültig erledigt ist.
//     Aufgelöste Tiere (Bindung) zählen als erledigt; bewusstlose und liegende (erholbare) Tiere zählen als NICHT erledigt (anders als squad_cleared, das liegende Drohnen mitzählt).
//     Genau eines von gruppe/typ ist Pflicht. Unbekannte Karte oder Gruppe (nie erschienen): nicht erfüllt, kein Fehler. Kreaturen zählen in squad_cleared, Wellen, Graben, Bodenkampf nicht mit.
//     Ereignis kreaturAusgefallen { id, typ, gruppe, x, y } (Missions- und Spielereignis, Kreatur.ausgefallenMelden) kommt je Tier einmal beim endgültigen Ausfall durch Beschuss.
// Fehler (unbekannter Typ, Bereich oder Karte, Anzahl außerhalb 1 bis 12, kein erreichbarer Platz) zählen als game.countError('mission-kreatur') mit der Meldung von Kreatur.rudelSetzen; es entsteht dann kein Tier.
const Kreatur = () => require('../../sim/kreatur.js');

module.exports = (Registry) => {
  Registry.define({ id: 'kreatur_besetzen', art: 'aktion', effekt: 'gegner',
    beschreibung: 'Rudel von Kreaturen (Typ aus kreaturen.json, 1 bis 12 Tiere, Kennung gruppe) in einem Bereich einer Außenkarte anlegen: nur erreichbare Plätze, mit Abstand, weit vom Abholpunkt. Unbekannter Bereich oder kein Platz: Fehler, kein Tier',
    params: { map: { typ: 'map', pflicht: true }, bereich: { typ: 'area' }, typ: { typ: 'string', pflicht: true },
      anzahl: { typ: 'number', pflicht: true, min: 1, max: 12 }, gruppe: { typ: 'string', pflicht: true } },
    run(m, a) {
      const g = m.game;
      let r;
      try { r = Kreatur().rudelSetzen(g, { map: a.map, bereich: a.bereich != null ? a.bereich : null, typ: a.typ, anzahl: a.anzahl, gruppe: a.gruppe }); }
      catch (e) { g.countError('mission-kreatur', e); return; }
      if (r.fehler) g.countError('mission-kreatur', new Error(r.fehler));
    } });
  Registry.define({ id: 'kreaturen_erledigt', art: 'pruefung',
    beschreibung: 'Rudel erledigt: mindestens ein Tier der Gruppe (oder des Typs) erschien und alle sind endgültig erledigt (tot oder aufgelöst); bewusstlose und liegende Tiere zählen nicht. Genau eines von gruppe oder typ',
    params: { map: { typ: 'map', pflicht: true }, gruppe: { typ: 'string' }, typ: { typ: 'string' } },
    test: (m, a) => {
      return Kreatur().rudelErledigt(m.game, a.map, { gruppe: a.gruppe, typ: a.typ });
    } });
};
