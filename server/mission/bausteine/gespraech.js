'use strict';
// SL2 (Team AUSSENPOSTEN): Bausteine für Gespräche mit NSC am Boden. Laufzeit in server/sim/gespraech.js, Daten content/welt/gespraeche.json.
//   spawn_person { map, person, anker, gespraech }   (Baustein in welt.js) setzt eine stehende, ansprechbare Person (E spricht sie an)
//   person_entfernen   { map, person }               nimmt die Person von der Karte (Evert verlässt die Taverne)
//   gespraech_beenden  {}                            laufendes Gespräch abbrechen (ohne Ergebnis)
//   gespraech_gefuehrt { id, wahl? }                 Prüfung: das Gespräch wurde geführt (und mit Option wahl beendet)
// Ergebnis steht auch als Flag gespraech_<id> (Wert = Option-Id, ohne Wahl 'gefuehrt') und als Ereignis gespraechBeendet { id, wahl, person }.
function gespraech() { try { return require('../../sim/gespraech.js'); } catch (e) { return null; } }
function away() { try { return require('../../sim/away.js'); } catch (e) { return null; } }

module.exports = (Registry) => {
  Registry.define({ id: 'person_entfernen', art: 'aktion',
    beschreibung: 'Person von der Außenkarte nehmen (z. B. Evert verlässt die Taverne); laufendes Gespräch mit ihr endet',
    params: { map: { typ: 'map', pflicht: true }, person: { typ: 'string', pflicht: true } },
    run(m, a) {
      const A = away(); const G = gespraech(); if (!A) return;
      if (G && m.game.gespraech && m.game.gespraech.nid === a.person) G.schliesse(m.game, 'person_weg');
      A.entfernePerson(m.game, a.map, a.person);
    } });
  Registry.define({ id: 'gespraech_beenden', art: 'aktion', beschreibung: 'Laufendes Gespräch abbrechen (ohne Ergebnis)', params: {},
    run(m) { const G = gespraech(); if (G) G.schliesse(m.game, 'beendet'); } });
  Registry.define({ id: 'gespraech_gefuehrt', art: 'pruefung', beschreibung: 'Das Gespräch wurde geführt (wahl: mit dieser Option beendet)',
    params: { id: { typ: 'string', pflicht: true }, wahl: { typ: 'string' } },
    test: (m, a) => { const v = m.flags['gespraech_' + a.id]; return a.wahl ? v === a.wahl : v !== undefined && v !== null && v !== false; } });
};
