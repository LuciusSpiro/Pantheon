'use strict';
// B3 §7 (CONTRACT-B3, Team ENGINE): Bausteine der Sektorkarte. Laufzeit in server/sim/sprung.js (SEKTOR).
//   sprungpunkt_oeffnen    { von*, nach*, temp?, bis? }   Sprungpunkt öffnen (temp: temporäre Kante; bis mission|immer)
//   sprungpunkt_schliessen { kante* }                    geöffneten Sprungpunkt schließen
//   boje_aufdecken         { kante* }                    Boje (Kante) bekannt machen (hidden nie)
//   sperrriegel_oeffnen    {}                            EK7: Sperrriegel um Wolfstor öffnen (Weltstand-Schlüssel)
//   im_hex                 { hex* }                      Prüfung: Lerche im Hex
//   sprungpunkt_erreicht   { kante* }                    Prüfung: Lerche im Radius des Sprungpunkts dieser Kante
//   notgesprungen          {}                            Prüfung: in der laufenden Mission gab es einen Notfallsprung
// Prüfer (checker.js): kante 'SSZZ-SSZZ' -> SPRUNG-KANTE (Fehler) / SPRUNG-HIDDEN (Warnung); hex -> HEX-UNSPIELBAR.
// reveal_location und atLocation bleiben unverändert.
function sprung() { try { return require('../../sim/sprung.js'); } catch (e) { return null; } }
function sek() { try { return require('../../../shared/sektoren.js'); } catch (e) { return null; } }
function run(m, fn, ...args) {
  const S = sprung();
  if (!S || typeof S[fn] !== 'function') { m.game.countError('mission-sektor', new Error('sprung.' + fn + ' fehlt')); return null; }
  try { const r = S[fn](m.game, ...args); if (typeof r === 'string' && r) m.game.countError('mission-sektor', new Error(fn + ': ' + r)); return r; } catch (e) { m.game.countError('mission-sektor', e); return null; }
}

module.exports = (Registry) => {
  Registry.define({ id: 'sprungpunkt_oeffnen', art: 'aktion', ereignisse: ['sprungpunktOffen'],
    beschreibung: 'Sprungpunkt zwischen zwei Nachbarhexen öffnen (von/nach: Hex SSZZ oder Ort-ID). temp: temporär (bis Missionsende bzw. immer); nur spielbare Hexe bzw. Leerraum',
    params: { von: { typ: 'string', pflicht: true }, nach: { typ: 'string', pflicht: true }, temp: { typ: 'bool' }, bis: { typ: 'string', werte: ['mission', 'immer'] } },
    run(m, a) { run(m, 'oeffnen', { von: a.von, nach: a.nach, temp: a.temp !== false, bis: a.bis || 'mission' }); } });
  Registry.define({ id: 'sprungpunkt_schliessen', art: 'aktion', ereignisse: ['sprungpunktZu'],
    beschreibung: 'Geöffneten (temporären) Sprungpunkt schließen',
    params: { kante: { typ: 'kante', pflicht: true } },
    run(m, a) { run(m, 'schliessen', a.kante); } });
  Registry.define({ id: 'boje_aufdecken', art: 'aktion', ereignisse: ['bojeGefunden'],
    beschreibung: 'Boje (Sprungpunkt einer Kante) für die Crew aufdecken; verborgene Kanten nie',
    params: { kante: { typ: 'kante', pflicht: true } },
    run(m, a) { run(m, 'bojeAufdecken', a.kante); } });
  // SL1: verborgene Kante enthüllen (Weltstand-Schlüssel der Kante, gespeichert über verbindungen_offen)
  Registry.define({ id: 'kante_enthuellen', art: 'aktion', ereignisse: ['kanteEnthuellt'],
    beschreibung: 'Verborgene Kante enthüllen: Schlüssel der Kante (z. B. lager-schrottkante) oder Kanten-ID SSZZ-SSZZ; danach ist sie bekannt und befahrbar, auch nach dem Laden',
    params: { kante: { typ: 'string', pflicht: true } },
    run(m, a) { run(m, 'kanteEnthuellen', a.kante); } });
  Registry.define({ id: 'kante_offen', art: 'pruefung', beschreibung: 'Die Kante (ID SSZZ-SSZZ oder Schlüssel) ist befahrbar bzw. enthüllt',
    params: { kante: { typ: 'string', pflicht: true } },
    test: (m, a) => {
      const S = sek(); const ex = m.game.explore;
      if (!S || !S.KARTE) return false;
      const e = (S.KARTE.kanten || []).find((k) => k.key === a.kante || S.kanteId(k.a, k.b) === a.kante);
      return !!(e && ex.kanteOffen(S.kanteId(e.a, e.b)));
    } });
  // EK7: Methalle-Sprengung (Team BODEN) lässt den Sperrriegel um Wolfstor fallen: Weltstand-Schlüssel `sperrriegel` + Fakt
  Registry.define({ id: 'sperrriegel_oeffnen', art: 'aktion', ereignisse: ['sperrriegelOffen'],
    beschreibung: 'Sperrriegel um Wolfstor öffnen: setzt den Weltstand-Schlüssel sperrriegel (Kanten 0504–0604, 0604–0605, 0604–0705) und den Fakt sperrriegel',
    params: {},
    run(m) { try { m.game.explore.sperrriegelOeffnen(); } catch (e) { m.game.countError('mission-sektor', e); } } });
  Registry.define({ id: 'im_hex', art: 'pruefung', beschreibung: 'Die Lerche ist im Hex (SSZZ)',
    params: { hex: { typ: 'hex', pflicht: true } },
    test: (m, a) => { const S = sek(); return !!(S && typeof S.hexVonOrt === 'function' && S.hexVonOrt(m.game.ship.scene) === a.hex); } });
  Registry.define({ id: 'sprungpunkt_erreicht', art: 'pruefung', beschreibung: 'Die Lerche ist am Sprungpunkt der Kante (Radius CONFIG.sektoren.sprungpunktRadius)',
    params: { kante: { typ: 'kante', pflicht: true } },
    test: (m, a) => { const S = sprung(); try { return !!(S && typeof S.amSprungpunkt === 'function' && S.amSprungpunkt(m.game, a.kante)); } catch (e) { m.game.countError('mission-sektor', e); return false; } } });
  Registry.define({ id: 'notgesprungen', art: 'pruefung', beschreibung: 'In der laufenden Mission gab es einen Notfallsprung',
    params: {},
    test: (m) => !!m.activeId && m.game.notsprungIn === m.activeId });
};
