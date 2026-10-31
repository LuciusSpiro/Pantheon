// CHA-01 Designer, Modus System: Tokens der Namensmarke über dem Kopf (Spielerkennung, Richtung B, Kai 2026-10-31).
// Globales `Namensmarke` (in Node als Modul, für tools/test-kammer-tokens.js). Nur Daten und eine reine Hilfe, kein Zeichnen.
// Eigene kleine Datei, weil der Verbraucher render.js ist (Welt-HUD an Bord und im Einsatz, ohne Pult und ohne Skin) und dieselbe Form in der
// Lobby-Karte (menue-tokens.js) und in der Charakterliste wieder auftaucht. So hängt render.js an keiner Pult- oder Menüdatei.
// Gestaltungsnotiz: vault Pantheon/„Auftrag CHA-01 – Tokens“. Referenz: public/kammer-preview.html (Bild „Namensmarke“).
//
//   Namensmarke.TOKENS            { FARBE, MASS, SPIELER }
//   Namensmarke.marke(name, eigen, measure) -> { w, h, form: { x, y, groesse }, text: { x, y, s } | null, stiel: { x, y, w, h } }
//       Koordinaten relativ zur Mitte über dem Kopf (x = 0 ist die Kopfmitte, y = 0 Oberkante der Marke); measure(s) = R.measure(s, 1)
//   Namensmarke.spieler(farbIndex) -> { farbe, form } aus shared/protocol.js (PLAYER_COLORS, PLAYER_SHAPES), keine Kopie
//
// Regeln:
//   - Jeder Spieler trägt die Marke, auch die eigene Figur. Eigene Figur: nur die Form, kein Name. Mitspieler: Form + Name in Spielerfarbe.
//   - Gegner und NSC tragen nie eine Form (nur den Rollennamen in Rost wie heute, mit Schatten). Die Form ist die Spielerkennung.
//   - Grund `grund` mit Deckkraft MASS.grundDeckkraft (0,85, nicht 0,55 wie bisher und nicht 0,72 wie im Mockup): erst ab 0,85 haben alle vier
//     Spielerfarben ≥ 4,5:1 auf hellem Boden (Referenz FARBE.bodenHell, hellster Boden im echten Bodenkampf-Bild). Der Test misst das.
//   - Ein Stiel (1 px, Spielerfarbe) verbindet die Marke mit dem Kopf, damit bei dicht stehenden Figuren klar ist, wem sie gehört.
//   - Farbwerte stehen nur zwischen „// <tokens>“ und „// </tokens>“ (tools/check-terminal-farben.js prüft diese Datei mit).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Namensmarke = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const PROTO = (root && root.Shared_Protocol) || (typeof require === 'function' ? require('../../shared/protocol.js') : {});

  // ================================================================= TOKENS
  // <tokens>
  const FARBE = {
    grund: '#0B0E1A',             // wie render.js backdrop (rgba 11,14,26), Deckkraft aus MASS
    gegner: '#C2703D',            // Rollenname der Gegner (render.js PAL.rust), mit Schatten, ohne Form
    bodenHell: '#E2CDA8',         // Referenz für den Test: hellster Boden (99. Perzentil) im Bodenkampf-Rendering der Designrichtungen CHA-01
    bodenMittel: '#827963',       // Referenz: typischer Boden (Median) desselben Bildes
  };
  const MASS = {
    grundDeckkraft: 0.85,         // vorher 0,55 (rosa Name auf hellem Boden 1,9:1), Mockup 0,72 (3,2:1); jetzt 4,6:1
    h: 10,                        // Höhe der Marke (eine Zeile Pixelschrift)
    form: 6,                      // Größe der Spielerform (render.js shape size)
    formX: 6,                     // Mitte der Form ab linkem Rand
    textX: 11,                    // Name ab linkem Rand
    rechts: 3,                    // Rand rechts nach dem Namen
    eigenW: 12,                   // Breite der eigenen Marke (nur Form)
    stiel: { w: 1, h: 3 },        // Verbindung zum Kopf, unter der Marke
    ueberKopf: 52, geduckt: 40,   // Abstand Füße → Oberkante Marke (wie heute in render.js)
    nameMax: 12,                  // Zeichen
  };
  // </tokens>

  const SPIELER = { farben: PROTO.PLAYER_COLORS || [], formen: PROTO.PLAYER_SHAPES || [] };
  const TOKENS = { FARBE, MASS, SPIELER };

  function spieler(i) { i = i || 0; return { farbe: SPIELER.farben[i], form: SPIELER.formen[i] }; }
  function marke(name, eigen, measure) {
    const m = MASS, nm = eigen ? '' : String(name || '').slice(0, m.nameMax);
    const w = nm ? (measure ? measure(nm) : nm.length * 5) + m.textX + m.rechts : m.eigenW;
    const x = -Math.round(w / 2);
    return {
      w, h: m.h, x,
      form: { x: x + m.formX, y: Math.round(m.h / 2), groesse: m.form },
      text: nm ? { x: x + m.textX, y: 1, s: nm } : null,
      stiel: { x: 0, y: m.h, w: m.stiel.w, h: m.stiel.h },
    };
  }
  return { TOKENS, marke, spieler };
});
