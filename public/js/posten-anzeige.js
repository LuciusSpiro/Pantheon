// SUND-02b UI2 (Designer-Review A2, E): Anzeigemodell des Ops-Felds „Posten“ (Snapshot space.po { k, ok, t?, n?, b? }) und der Halte-Leiste eines Posten-Halteprozesses
// (fracht.halt { kind: 'posten', id, p }). Nur Inhalt und Zustand, kein Zeichnen (prüfbar in Node: tools/test-ui2-anzeige.js); gezeichnet wird in public/js/consoles.js.
// Farben sind Rollen, keine Werte: 'gefahr' (Hellrot PULT.notruf, unter Protanopie lesbar), 'weigerung' (Bernstein), 'hinweis' (Hell), 'mint'; der Aufrufer setzt die Tokens ein.
// Der Server entscheidet alles (ok, Weigerungstext t, Restsekunden der Bestätigung b); hier wird nur dargestellt.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PostenAnzeige = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ART = {
    g: { knopf: 'Posten gründen', cmd: 'weapons.posten.gruenden' },
    a: { knopf: 'Stützpunkt ausbauen', cmd: 'weapons.posten.ausbauen' },
    x: { knopf: 'Posten angreifen', cmd: 'weapons.posten.angreifen' },   // A2: Posten eines Gegners (sprengen)
    v: { knopf: 'Römische Schiffe angreifen', cmd: 'weapons.verrat.beginnen' },   // E: Beschuss auf römische Verbündete
  };
  const TEXT = {
    warnung: 'Hochverrat an Rom – der Ruf sinkt',
    bestaetigen: 'BESTÄTIGEN · Hochverrat',
    zweiter: 'Zweiter Druck beginnt den Angriff',
  };
  // Halte-Leiste: Kopf (mit Fortschritt) und eine kurze Abbruchzeile, die in die 266 px breite Leiste passt (vorher lief „Gründung läuft … (Feindkontakt, Tempo oder Abstand bricht ab)“ über den Rand)
  const HALT = {
    gruenden: { kopf: 'POSTEN GRÜNDEN', hinweis: 'Feind, Tempo oder Abstand bricht ab', farbe: 'mint' },
    ausbau: { kopf: 'STÜTZPUNKT AUSBAUEN', hinweis: 'Feind, Tempo oder Abstand bricht ab', farbe: 'mint' },
    angreifen: { kopf: 'POSTEN ANGREIFEN', hinweis: 'Feind, Tempo oder Abstand bricht ab', farbe: 'mint' },
    verrat: { kopf: 'HOCHVERRAT AN ROM', hinweis: 'Abbruch kostenlos · Ruf sinkt erst bei Beginn', farbe: 'gefahr' },
  };
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  // -> null (kein Feld) | { cmd, knopf, zustand: 'bereit' | 'gesperrt' | 'anfrage' | 'bestaetigen', fn: 'shield' | 'weapon' | null, aktiv, rahmen: 'mint' | 'gefahr' | 'messing',
  //    zeilen: [{ text, farbe }], grund: Weigerungstext (der Aufrufer bricht ihn auf höchstens zwei Zeilen um), frist: Anteil der Bestätigungsfrist 0..1 oder null, kosten }
  // b0 = größte bisher gesehene Restzeit derselben Anfrage (für den Fristbalken; ohne b0 gilt b selbst als voll)
  function feld(po, b0) {
    if (!po || typeof po !== 'object') return null;
    const art = ART[po.k];
    if (!art) return null;
    const kosten = num(po.n) > 0 ? num(po.n) : 0;
    if (!po.ok) return { cmd: art.cmd, knopf: art.knopf, zustand: 'gesperrt', fn: null, aktiv: false, rahmen: 'messing', zeilen: [], grund: String(po.t || ''), frist: null, kosten };
    if (po.k !== 'v') return { cmd: art.cmd, knopf: art.knopf, zustand: 'bereit', fn: 'shield', aktiv: true, rahmen: 'mint', zeilen: [], grund: '', frist: null, kosten };
    const b = Math.max(0, Math.ceil(num(po.b)));
    if (!b) return { cmd: art.cmd, knopf: art.knopf, zustand: 'anfrage', fn: null, aktiv: false, rahmen: 'gefahr', zeilen: [{ text: TEXT.warnung, farbe: 'gefahr' }], grund: '', frist: null, kosten };
    const voll = Math.max(b, num(b0));
    return { cmd: art.cmd, knopf: TEXT.bestaetigen + ' · ' + b + ' s', zustand: 'bestaetigen', fn: 'weapon', aktiv: true, rahmen: 'gefahr',
      zeilen: [{ text: TEXT.zweiter, farbe: 'hinweis' }, { text: TEXT.warnung, farbe: 'gefahr' }], grund: '', frist: voll > 0 ? b / voll : 0, kosten };
  }
  // -> null | { kopf, kopfFarbe, hinweis, hinweisFarbe } für fracht.halt kind 'posten'
  function halt(h) {
    if (!h || h.kind !== 'posten') return null;
    const H = HALT[h.id] || HALT.gruenden;
    const pct = Math.round(Math.max(0, Math.min(1, num(h.p))) * 100);
    return { kopf: H.kopf + ' · ' + pct + ' %', kopfFarbe: H.farbe, hinweis: H.hinweis, hinweisFarbe: H.farbe === 'gefahr' ? 'hinweis' : 'mint' };
  }
  // Sperre gegen den Doppelklick: ein zweiter Druck auf denselben Verrat-Knopf binnen KLICK_SPERRE s zählt nicht (sonst wäre ein Doppelklick schon die Bestätigung,
  // weil der Knopf erst mit dem nächsten Snapshot umschaltet). Gilt nur für den Verrat, die anderen Felder haben keine Bestätigung.
  const KLICK_SPERRE = 0.8;
  function klickZaehlt(letzter, jetzt) { return !(typeof letzter === 'number' && isFinite(letzter) && jetzt - letzter < KLICK_SPERRE); }
  return { ART, TEXT, HALT, KLICK_SPERRE, feld, halt, klickZaehlt };
});
