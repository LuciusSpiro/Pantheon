// LIV-01 A2: Kontingent-Meldung (Token-Zähler des Live-Spielleiters aufgebraucht). Globales `Kontingent`, in Node als Modul (Tests).
// Storage: store.block = letzter Block world.kontingent { used, limit, schwelle, erreicht } (CONTRACT-LIV01.md; kommt nur im Live-Modus und nur bei Änderung, deshalb bleibt der letzte Stand stehen;
//   welcome leert ihn, der Server sendet nach dem Beitritt neu). Ohne Block (kein Live-Modus) gibt es keine Meldung, keinen Knopf, kein DOM-Element.
//   store.wartet / store.antwort: Zustand des eigenen Befehls kontingent.freigeben (Antwort kontingentAntwort { ok, code?, text? } nur an den Absender).
// Action: modell() -> null | { used, limit, verbrauch, titel, text, knopf, bedienbar, hinweis, wartet, antwort }, freigeben(send, konsole) (Befehl, entprellt), lesen(msg).
//   Nur die Captain-Konsole darf freigeben (Server: CMD_CONSOLE.kontingent = captain); alle anderen sehen die Meldung und einen gesperrten Knopf mit Hinweis.
// Die Anzeige (DOM-Streifen, Taste allgemein.kontingentFreigeben) steht in kontingent-ui.js und liest nur hierüber. Die Meldung blockiert nichts.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Kontingent = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const store = { block: null, wartet: false, wartetT: 0, antwort: null, pid: null };
  const WARTE_MS = 4000;   // länger als eine Antwort braucht; bleibt sie aus (Verbindung weg), ist der Knopf wieder frei
  const KONSOLE = 'captain';   // wie der Server (CMD_CONSOLE.kontingent)
  const TEXT = {
    titel: 'Kontingent aufgebraucht',
    text: 'Der Spielleiter antwortet aus der Konserve, das Spiel läuft weiter.',
    knopf: '500 000 Tokens freigeben',
    nurCaptain: 'Nur an der Captain-Konsole.',
    gesendet: 'Freigabe gesendet …',
    freigegeben: 'Freigegeben: 500 000 Tokens mehr.',
    allgemein: 'Die Freigabe ging nicht durch. Noch einmal versuchen.',
  };

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const zahl = (v) => (isNum(v) ? Math.max(0, Math.floor(v)) : 0);
  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]+/g, ' ').slice(0, max) : '');
  // 450000 -> „450 000“ (geschütztes Leerzeichen, bricht nie um)
  const tausend = (n) => String(zahl(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  function blockAus(k) {
    if (!k || typeof k !== 'object' || !isNum(k.used) || !isNum(k.limit)) return null;
    return { used: zahl(k.used), limit: zahl(k.limit), schwelle: zahl(k.schwelle), erreicht: k.erreicht === true || k.erreicht === 1 };
  }
  function lesen(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') { store.block = null; store.wartet = false; store.antwort = null; store.pid = msg.pid == null ? null : msg.pid; return; }
    // Der Server lehnt den Befehl mit einem notice ab (falsche Konsole, kein kontingentAntwort): die Absage zeigt der Streifen, der Knopf bleibt nicht 4 s im Wartezustand
    if (msg.t === 'event' && msg.kind === 'notice') {
      if (store.wartet && msg.pid != null && msg.pid === store.pid) { store.wartet = false; store.antwort = { ok: false, code: 'notice', text: str(msg.text, 120), limit: store.block ? store.block.limit : 0 }; }
      return;
    }
    if (msg.t === 'event' && msg.kind === 'kontingentAntwort') {
      store.wartet = false;
      const ok = msg.ok === true || msg.ok === 1;
      store.antwort = { ok, code: str(msg.code, 20), text: str(msg.text, 120), limit: store.block ? store.block.limit : 0 };
      return;
    }
    if (msg.t !== 'snap' || !msg.world || !Object.prototype.hasOwnProperty.call(msg.world, 'kontingent')) return;
    store.block = blockAus(msg.world.kontingent);
    const b = store.block;
    // Meldung weg (Freigabe wirkte) oder neue Schwelle erreicht: die Rückmeldung zur alten Freigabe gilt nicht mehr
    if (!b || !b.erreicht || (store.antwort && store.antwort.limit !== b.limit)) { store.antwort = null; store.wartet = false; }
  }

  const bedienbar = (konsole) => konsole === KONSOLE;
  // null: nichts zu melden (kein Live-Modus, Zähler unter der Schwelle). jetzt = Millisekunden (nur für den Ablauf der Wartezeit)
  function modell(konsole, jetzt) {
    const b = store.block;
    if (!b || !b.erreicht) return null;
    if (store.wartet && isNum(jetzt) && jetzt - store.wartetT > WARTE_MS) store.wartet = false;
    const a = store.antwort;
    const frei = !!a && a.ok;
    const kann = bedienbar(konsole);
    return {
      used: b.used, limit: b.limit, verbrauch: tausend(b.used) + ' / ' + tausend(b.limit),
      titel: TEXT.titel, text: TEXT.text, knopf: TEXT.knopf,
      bedienbar: kann, wartet: store.wartet, freigegeben: frei,
      aktiv: kann && !store.wartet && !frei,   // Knopf und Taste wirken nur dann
      hinweis: !kann ? TEXT.nurCaptain : store.wartet ? TEXT.gesendet : '',
      antwort: !a ? null : frei ? { ok: true, text: TEXT.freigegeben } : { ok: false, text: a.text || TEXT.allgemein },
    };
  }
  // Befehl im Protokollformat; true, wenn gesendet. Doppelklick: solange keine Antwort da ist (oder die Wartezeit läuft), geht nichts nach.
  function freigeben(send, konsole, jetzt) {
    const m = modell(konsole, jetzt);
    if (typeof send !== 'function' || !m || !m.aktiv) return false;
    store.wartet = true; store.wartetT = isNum(jetzt) ? jetzt : 0; store.antwort = null;
    send({ t: 'cmd', c: (root && root.Shared_Protocol && root.Shared_Protocol.CMD_KONTINGENT_FREIGEBEN) || 'kontingent.freigeben' });
    return true;
  }
  const offen = () => !!store.block && store.block.erreicht;

  (function haken() {
    const N = root && root.Net;
    if (N && typeof N.on === 'function') N.on(lesen);   // wie brett.js: jede Servernachricht läuft durch lesen()
  })();

  return { store, lesen, modell, freigeben, offen, bedienbar, tausend, TEXT, WARTE_MS, KONSOLE };
});
