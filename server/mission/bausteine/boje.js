'use strict';
// SL10 (CONCEPT-SL10): Bausteine für die Vorläufer-Boje (Registry-Plugin, Logik in server/sim/boje.js und glyphen.js).
//   glyphen_starten    { id }          Aktion: Glyphen/Sternkarte-Minispiel beginnt (Captain sieht das Muster, Ops setzt es). Ereignis glyphenStart { id }
//   glyphen_geloest    { id, min? }    Prüfung: Adresse gelöst (Qualität ≥ min, Standard 0). Ereignis glyphenGeloest { id, versuche, qualitaet }
//   boje_zuruecksetzen {}              Aktion: Zähler 0, Wettlauf aus, Glyphen-Aufgabe verwerfen (Szene von vorn)
//   boje_wettlauf      { wellen? }     Aktion: Piraten kommen in Wellen (Weg A, Standard 3). Ereignis bojeWelle { n }
//   boje_geweckt       {}              Prüfung: die Boje ist erwacht (Ereignis bojeGeweckt, Kante zum Vorläufer-Sektor ist offen)
//   welt_fakt_ist      { key, value }  Prüfung: Weltstand-Fakt key hat den Wert value (z. B. lerche_weg = loesegeld)
const G = () => require('../../sim/glyphen.js');
const B = () => require('../../sim/boje.js');

module.exports = (Registry) => {
  Registry.define({ id: 'glyphen_starten', art: 'aktion', ereignisse: ['glyphenStart'],
    beschreibung: 'Glyphen/Sternkarte-Minispiel starten: der Captain sieht die Konstellation, die Ops setzt sie nach seiner Ansage nach (Adresse der Vorläufer-Boje)',
    params: { id: { typ: 'string', pflicht: true } },
    run(m, a) { const e = G().starten(m.game, { id: a.id }); if (e) m.game.countError('mission-hook', new Error('glyphen_starten: ' + e)); } });
  Registry.define({ id: 'glyphen_geloest', art: 'pruefung', beschreibung: 'Adresse gelöst (Qualität mindestens min, Standard 0)',
    params: { id: { typ: 'string', pflicht: true }, min: { typ: 'number', min: 0, max: 3 } },
    test: (m, a) => { const q = G().ergebnis(m.game, a.id); return q != null && q >= (a.min != null ? a.min : 0); } });
  Registry.define({ id: 'boje_zuruecksetzen', art: 'aktion', beschreibung: 'Vorläufer-Boje von vorn: Zähler 0, Wettlauf aus, Glyphen-Aufgabe verwerfen',
    params: {}, run(m) { B().zuruecksetzen(m.game); } });
  Registry.define({ id: 'boje_wettlauf', art: 'aktion', effekt: 'gegner', ereignisse: ['bojeWelle', 'enemySpawn'],
    beschreibung: 'Wettlauf (Weg A): die Piraten kommen in Wellen zur Boje, sobald das Aufleuchten sichtbar wird (wellen Standard 3)',
    params: { wellen: { typ: 'number', min: 1, max: 6 } },
    run(m, a) { B().wettlauf(m.game, a.wellen); } });
  Registry.define({ id: 'boje_geweckt', art: 'pruefung', beschreibung: 'Die Vorläufer-Boje ist erwacht (die Kante in den Vorläufer-Sektor ist offen)',
    params: {}, test: (m) => B().geweckt(m.game) });
  Registry.define({ id: 'welt_fakt_ist', art: 'pruefung', beschreibung: 'Der Weltstand-Fakt key hat den Wert value (z. B. lerche_weg = loesegeld)',
    params: { key: { typ: 'string', pflicht: true }, value: { typ: 'string', pflicht: true } },
    test: (m, a) => { const f = m.game.weltstand && m.game.weltstand.data && m.game.weltstand.data.fakten; return !!f && String(f[a.key]) === String(a.value); } });
};
