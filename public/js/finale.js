// SUND-04a-3 Finale-UI: Angebot „Entscheidungsschlacht um Hrafnheim“ am Terminal (nur Freie Fahrt Sund). Globales `Finale`, in Node als Modul (Tests).
// Storage: store.finale = letzter Block world.finale { frei, ab, name, text, angebot?: 1, anfrage?: Sekunden der Frist, phase?: 'orbit'|'boden'|'ende' } (kommt nur bei Änderung;
//   world.finale = null ist das Löschsignal; welcome und die Lobby leeren ebenfalls, sonst stünde ein altes Angebot in Kampagne oder Lobby). Gleich für alle Spieler (nur der Server schreibt).
//   Der Block trägt die Frist als Gesamtdauer, nicht als Rest: die Restsekunden zählt der Client ab dem Eintreffen der Anfrage (store.anfrageStart, Uhr store.uhr). Maßgeblich bleibt der Server
//   (er lehnt eine verspätete Bestätigung ab); die Anzeige zeigt nur, wie lange die Anfrage voraussichtlich noch gilt und blendet „Bestätigen“ danach aus.
// Action: modell() -> null | { name, text, zustand: 'angebot'|'anfrage'|'phase', rest, frist, phase, ... }, müll-fest (ohne Block oder ohne Angebot keine Karte, kein Platzhalter).
//   Name und Text kommen mit dem Block vom Server (content/welt/finale-werte.json, texte.anzeige); die internen Regeln dieser Datei werden nicht ausgeliefert. Beschriftungen der Knöpfe
//   stehen in TEXTE (eine Stelle, kein Text im Zeichen- oder Eingabecode).
// Das Terminal (terminal-ui.js, Bereich „Kurs“) baut daraus die Karte und sendet finale.waehlen / finale.bestaetigen / finale.ablehnen; der Server entscheidet alles.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Finale = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const store = { finale: null, anfrageStart: null, uhr: null, pause: null, neuerAnlauf: false, wechsel: 0 };   // pause: Sprünge nach dem Ablehnen (letzter Wert des Blocks); neuerAnlauf: der letzte Ausgang war ein Neubeginn (Niederlage, Flucht, gefallene Crew); wechsel zählt diese Wechsel   // uhr: () => Millisekunden (Tests ersetzen sie)
  const TEXTE = {
    tag_angebot: 'FINALE · ANGEBOT', tag_anfrage: 'FINALE · ANFRAGE', tag_laeuft: 'FINALE · LÄUFT', tag_ende: 'FINALE · ENTSCHIEDEN',
    anfragen: 'Anfragen', bestaetigen: 'Bestätigen ({n} s)', ablehnen: 'Schlacht ablehnen',
    frist: 'Verstreicht die Frist, passiert nichts.', angebot_hinweis: 'Erst anfragen, dann bestätigen.', neuer_anlauf: 'Neuer Anlauf: Die Crew ist zurück.',
    hilfe_schlacht: 'Schlacht', hilfe_ablehnen: 'ablehnen', orbit: 'Orbit', orbit_frei: 'Orbit frei', boden: 'Boden', boden_frei: 'Boden frei',
    status_orbit: 'Die Flotte im Orbit von Hrafnheim.', status_boden: 'Die Landung und der Schrein von Asgard.', status_ende: 'Die Entscheidung ist gefallen.',
    gewaehlt_waehlen: 'Angefragt: jetzt bestätigen.', gewaehlt_bestaetigen: 'Die Schlacht beginnt.', gewaehlt_ablehnen: 'Entscheidungsschlacht abgelehnt. Sie kommt in {n} Sprüngen wieder.', gewaehlt_ablehnen_eins: 'Entscheidungsschlacht abgelehnt. Sie kommt in 1 Sprung wieder.', gewaehlt_ablehnen_ohne: 'Entscheidungsschlacht abgelehnt.', nicht_moeglich: 'Nicht möglich.',
    zuschauer: 'Zuschauer bedienen nicht', wartet: 'Warte auf den Server …',
  };
  const uhr = () => (typeof store.uhr === 'function' ? store.uhr() : (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const text = (key, w) => String(TEXTE[key] == null ? '' : TEXTE[key]).replace(/\{(\w+)\}/g, (m, k) => (w && w[k] != null ? String(w[k]) : m));
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const str = (v) => (typeof v === 'string' ? v : '');
  const PHASEN = ['orbit', 'boden', 'ende'];
  const hatAnfrage = (b) => !!b && isNum(b.anfrage) && b.anfrage > 0;

  function lesen(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') { store.finale = null; store.anfrageStart = null; store.neuerAnlauf = false; store.pause = null; return; }   // neue Verbindung: der Server sendet den Block neu (sentFinaleKey wird zurückgesetzt)
    if (msg.t !== 'snap') return;
    if (msg.phase === 'lobby') { store.finale = null; store.anfrageStart = null; store.neuerAnlauf = false; store.pause = null; return; }
    if (!msg.world || typeof msg.world !== 'object' || !Object.prototype.hasOwnProperty.call(msg.world, 'finale')) return;
    const neu = msg.world.finale && typeof msg.world.finale === 'object' ? msg.world.finale : null;
    const vorher = store.finale;
    if (neu && isNum(neu.pause) && neu.pause >= 0) store.pause = Math.floor(neu.pause);
    // Neubeginn: eine laufende Phase endet und das Angebot steht wieder da (Niederlage, Flucht, gefallene Crew). Das Modell trägt diesen Ausgang, bis eine neue Phase oder Anfrage beginnt oder das Angebot geht.
    if (vorher && (vorher.phase === 'orbit' || vorher.phase === 'boden') && neu && !neu.phase && neu.angebot === 1) { store.neuerAnlauf = true; store.wechsel++; }
    else if (!neu || neu.phase || hatAnfrage(neu) || neu.angebot !== 1) store.neuerAnlauf = false;
    if (hatAnfrage(neu)) { if (!hatAnfrage(store.finale) || store.anfrageStart == null) store.anfrageStart = uhr(); }   // Anfrage neu eingetroffen: die Frist läuft ab jetzt
    else store.anfrageStart = null;
    store.finale = neu;
  }

  function modellAus(b, opt) {
    if (!b || typeof b !== 'object') return null;
    const phase = PHASEN.includes(b.phase) ? b.phase : null;
    const frei = b.frei === 1 || b.frei === true, angebot = b.angebot === 1 || b.angebot === true;
    const name = str(b.name);
    if (!name || (!phase && !(frei && angebot))) return null;   // ohne Name, Angebot oder laufendes Finale gibt es keine Karte
    const frist = hatAnfrage(b) ? Math.floor(b.anfrage) : 0;
    let rest = 0;
    if (frist && !phase) {
      const dt = store.anfrageStart == null ? 0 : Math.max(0, uhr() - store.anfrageStart);
      rest = Math.max(0, Math.min(frist, Math.ceil((frist * 1000 - dt) / 1000)));
    }
    const zustand = phase ? 'phase' : rest > 0 ? 'anfrage' : 'angebot';   // verfallen die Sekunden vor dem Server-Block, steht wieder das Angebot
    return { name, text: str(b.text), ab: str(b.ab), zustand, phase, frist, rest, neuerAnlauf: zustand === 'angebot' && !!(opt && opt.neuerAnlauf), wechsel: store.wechsel };
  }
  const modell = () => modellAus(store.finale, { neuerAnlauf: store.neuerAnlauf });
  // Rückmeldung zur eigenen Antwort des Servers (ok): beim Ablehnen mit der Pause bis zum nächsten Angebot (Sprünge aus dem Block; ohne Zahl, wenn sie nicht bekannt ist)
  function antwortText(op) {
    if (op === 'bestaetigen') return text('gewaehlt_bestaetigen');
    if (op !== 'ablehnen') return text('gewaehlt_waehlen');
    const n = store.pause;
    return n == null ? text('gewaehlt_ablehnen_ohne') : n === 1 ? text('gewaehlt_ablehnen_eins') : text('gewaehlt_ablehnen', { n });
  }

  (function haken() {
    const N = root && root.Net;
    if (!N || typeof N.on !== 'function') return;
    N.on(lesen);
  })();

  return { store, TEXTE, lesen, modellAus, modell, text, antwortText };
});
