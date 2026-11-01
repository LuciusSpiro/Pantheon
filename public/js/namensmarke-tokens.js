// CHA-01 Designer, Modus System: Tokens der Namensmarke über dem Kopf (Spielerkennung, Richtung B, Kai 2026-10-31).
// Globales `Namensmarke` (in Node als Modul, für tools/test-kammer-tokens.js). Nur Daten und eine reine Hilfe, kein Zeichnen.
// Eigene kleine Datei, weil der Verbraucher render.js ist (Welt-HUD an Bord und im Einsatz, ohne Pult und ohne Skin) und dieselbe Form in der
// Lobby-Karte (menue-tokens.js) und in der Charakterliste wieder auftaucht. So hängt render.js an keiner Pult- oder Menüdatei.
// Gestaltungsnotiz: vault Pantheon/„Auftrag CHA-01 – Tokens“. Referenz: public/kammer-preview.html (Bild „Namensmarke“).
//
//   Namensmarke.TOKENS            { FARBE, MASS, SPIELER }
//   Namensmarke.marke(name, eigen, measure) -> { w, h, form: { x, y, groesse }, text: { x, y, s } | null, stiel: { x, y, w, h } }
//       Koordinaten relativ zur Mitte über dem Kopf (x = 0 ist die Kopfmitte, y = 0 Oberkante der Marke); measure(s) = R.measure(s, 1)
//   Namensmarke.ordne(marken, hindernisse, vorher, jetztMs) -> { [id]: { dy, stielH, nurForm, zeile, tiefer } }   (Stapeln, siehe unten)
//   Namensmarke.spieler(farbIndex) -> { farbe, form } aus shared/protocol.js (PLAYER_COLORS, PLAYER_SHAPES), keine Kopie
//
// Regeln:
//   - Jeder Spieler trägt die Marke, auch die eigene Figur. Eigene Figur: nur die Form, kein Name. Mitspieler: Form + Name in Spielerfarbe.
//   - Gegner und NSC tragen nie eine Form (nur den Rollennamen in Rost wie heute, mit Schatten). Die Form ist die Spielerkennung.
//   - Grund `grund` mit Deckkraft MASS.grundDeckkraft (0,85, nicht 0,55 wie bisher und nicht 0,72 wie im Mockup): erst ab 0,85 haben alle vier
//     Spielerfarben ≥ 4,5:1 auf hellem Boden (Referenz FARBE.bodenHell, hellster Boden im echten Bodenkampf-Bild). Der Test misst das.
//   - Ein Stiel (1 px, Spielerfarbe) verbindet die Marke mit dem Kopf, damit bei dicht stehenden Figuren klar ist, wem sie gehört.
//   - Stapeln (ordne): eigene Marke zuerst in Zeile 0, übrige nach Bildschirm-y absteigend, dann x; jede nimmt die erste Zeile 0…max−1, in der sie weder gesetzte
//     Marken noch Hindernisse (Gegnernamen) schneidet (Rechteck + luecke). Keine Zeile frei → nur Form (wie die eigene Marke). Flackerschutz: die zuletzt benutzte Zeile
//     bleibt, solange sie frei ist; in eine tiefere Zeile (oder aus „nur Form“ in eine Zeile) wechselt die Marke erst, wenn diese haltenMs lang frei war.
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
    // Stapeln (CHA-01 F, Designer-Review „dicht“): stehen Figuren enger als eine Marke breit ist, rückt die Marke in eine höhere Zeile (Stiel wird länger).
    stapel: { luecke: 2, zeile: 12, max: 3, haltenMs: 300 },   // luecke: Mindestabstand px; zeile: Zeilenabstand px; max: Zeilen 0…max−1, sonst nur Form; haltenMs: Flackerschutz
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

  // Rechtecke { x (links), y (oben), w, h } schneiden sich, wenn der Abstand kleiner als `luecke` ist.
  function schneidet(a, b, luecke) {
    return a.x < b.x + b.w + luecke && b.x < a.x + a.w + luecke && a.y < b.y + b.h + luecke && b.y < a.y + a.h + luecke;
  }
  // Zeilenwahl für alle Marken eines Frames. marken: [{ id, eigen, x, y, w, h }] (Rechteck der Marke in Zeile 0, Bildschirm-px); hindernisse: [{ x, y, w, h }] (Gegnernamen);
  // vorher: Rückgabe des letzten Frames (oder null); jetztMs: Uhrzeit. Rein: ändert keine Eingabe.
  function ordne(marken, hindernisse, vorher, jetztMs) {
    const S = MASS.stapel, aus = {}, gesetzt = (hindernisse || []).slice();
    vorher = vorher || {};
    const zeileFrei = (mk, z) => { const r = { x: mk.x, y: mk.y - z * S.zeile, w: mk.w, h: mk.h }; return !gesetzt.some((g) => schneidet(r, g, S.luecke)); };
    const eigene = marken.filter((mk) => mk.eigen), andere = marken.filter((mk) => !mk.eigen);
    for (const mk of eigene) {   // eigene Marke: immer Zeile 0 (nur Form, klein), setzt ihr Rechteck
      aus[mk.id] = { dy: 0, stielH: MASS.stiel.h, nurForm: true, zeile: 0, tiefer: null };
      gesetzt.push({ x: mk.x, y: mk.y, w: mk.w, h: mk.h });
    }
    andere.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    for (const mk of andere) {
      let erste = -1;
      for (let z = 0; z < S.max && erste < 0; z++) if (zeileFrei(mk, z)) erste = z;
      const v = vorher[mk.id];
      let z = erste, tiefer = null;
      if (erste >= 0 && v) {
        const vz = v.nurForm ? S.max : v.zeile;   // „nur Form“ zählt wie eine Zeile hinter der letzten
        const vzFrei = vz >= S.max || zeileFrei(mk, vz);
        if (vz > erste && vzFrei) {   // eine tiefere Zeile ist frei, die alte auch noch: erst nach haltenMs wechseln
          tiefer = v.tiefer != null ? v.tiefer : jetztMs;
          if (jetztMs - tiefer < S.haltenMs) z = vz;   // Halten
          else tiefer = null;
        }
      }
      if (z < 0 || z >= S.max) { aus[mk.id] = { dy: 0, stielH: MASS.stiel.h, nurForm: true, zeile: S.max, tiefer }; continue; }
      aus[mk.id] = { dy: -z * S.zeile, stielH: MASS.stiel.h + z * S.zeile, nurForm: false, zeile: z, tiefer };
      gesetzt.push({ x: mk.x, y: mk.y - z * S.zeile, w: mk.w, h: mk.h });
    }
    return aus;
  }
  return { TOKENS, marke, spieler, ordne };
});
