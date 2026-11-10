// LIV-02 P2: Frage „Limit erhöhen?“ (Token-Kontingent des Live-Spielleiters erreicht). Globales `KontingentFrage`, in Node als Modul (Tests).
// Storage: store.offen (der Server hat dem Spieler mit der blauen Markierung die Frage gestellt), store.wartet / store.fehler (Zustand der eigenen Antwort).
//   Der Server sendet kontingentFrage nur an diesen einen Spieler und nach welcome erneut, solange sie offen ist; welcome leert den Zustand hier.
//   Keine Zahlen, kein Zählerstand: der Snapshot trägt keinen Kontingent-Block mehr.
// Action: modell(jetzt) -> null | { titel, text, ja, nein, aktiv, fehler }, freigeben(send, jetzt) / ablehnen(send, jetzt) (Befehl, entprellt), lesen(msg).
// Die Anzeige (DOM-Popup) steht in kontingent-frage-ui.js und liest nur hierüber. Die Frage blockiert nichts und belegt keine Taste.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KontingentFrage = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const store = { pid: null, offen: false, wartet: false, wartetT: 0, fehler: false };
  const WARTE_MS = 4000;   // länger als eine Antwort braucht; bleibt sie aus (Verbindung weg), sind die Knöpfe wieder frei
  const TEXT = {
    titel: 'Limit erhöhen?',
    text: 'Spielleiter-Limit erreicht · erhöhen?',
    kurz: 'Limit erhöhen?',   // Kurzform, wenn die Leiste bei kleiner Skala zu schmal für den langen Text ist
    ja: 'Ja',
    nein: 'Nein',
    fehler: 'Hat nicht geklappt · noch einmal?',   // ersetzt den Fragetext (die Leiste bleibt einzeilig)
    fehlerKurz: 'Noch einmal?',
  };
  const PROTO = () => (root && root.Shared_Protocol) || {};
  const eigen = (msg) => msg.pid != null && msg.pid === store.pid;
  const frei = () => { store.wartet = false; };
  const ABSAGE = /blauen Markierung/;   // die einzige notice, mit der der Server den Befehl ablehnt (game.js onCmd: Spieler ohne color 0)

  function lesen(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') { store.offen = false; store.wartet = false; store.fehler = false; store.pid = msg.pid == null ? null : msg.pid; return; }
    if (msg.t !== 'event') return;
    if (msg.kind === 'kontingentFrage') { if (eigen(msg)) { store.offen = true; store.fehler = false; } return; }
    if (msg.kind === 'kontingentErledigt') { if (eigen(msg)) { store.offen = false; store.wartet = false; store.fehler = false; } return; }
    if (msg.kind === 'kontingentAntwort') {
      // Erfolg und Absage schließen über kontingentErledigt; nur der Fehlerfall lässt die Frage stehen
      if (eigen(msg) && store.offen && msg.code === 'fehler') { frei(); store.fehler = true; }
      return;
    }
    // der Server lehnt den Befehl mit dieser notice ab (kein kontingentAntwort): Frage bleibt, Knöpfe wieder frei; andere notices (fremde Hinweise) lassen die Wartezeit unberührt
    if (msg.kind === 'notice' && store.offen && store.wartet && eigen(msg) && ABSAGE.test(String(msg.text || ''))) { frei(); store.fehler = true; }
  }

  // null: keine Frage. jetzt = Millisekunden (nur für den Ablauf der Wartezeit)
  function modell(jetzt) {
    if (!store.offen) return null;
    if (store.wartet && typeof jetzt === 'number' && jetzt - store.wartetT > WARTE_MS) frei();
    return { titel: TEXT.titel, text: TEXT.text, kurz: TEXT.kurz, fehlerKurz: TEXT.fehlerKurz, ja: TEXT.ja, nein: TEXT.nein, aktiv: !store.wartet, wartet: store.wartet, fehler: store.fehler ? TEXT.fehler : '' };
  }
  function senden(send, cmd, jetzt) {
    const m = modell(jetzt);
    if (typeof send !== 'function' || !m || !m.aktiv) return false;
    store.wartet = true; store.wartetT = typeof jetzt === 'number' ? jetzt : 0; store.fehler = false;
    send({ t: 'cmd', c: cmd });
    return true;
  }
  // Doppelklick: solange keine Antwort da ist (oder die Wartezeit läuft), geht nichts nach.
  const freigeben = (send, jetzt) => senden(send, PROTO().CMD_KONTINGENT_FREIGEBEN || 'kontingent.freigeben', jetzt);
  const ablehnen = (send, jetzt) => senden(send, PROTO().CMD_KONTINGENT_ABLEHNEN || 'kontingent.ablehnen', jetzt);
  const offen = () => store.offen;

  (function haken() {
    const N = root && root.Net;
    if (N && typeof N.on === 'function') N.on(lesen);
  })();

  return { store, lesen, modell, freigeben, ablehnen, offen, TEXT, WARTE_MS };
});
