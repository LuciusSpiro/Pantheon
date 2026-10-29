// SUND-04b D: Auftragsbrett in der Anzeige (nur Freie Fahrt Sund mit FAEDEN=1). Globales `Brett`, in Node als Modul (Tests).
// Storage: store.abenteuer = letzter Block world.abenteuer (README „SUND-04b C“; kommt nur bei Änderung; world.abenteuer = null ist das Löschsignal; welcome und die Lobby leeren ebenfalls).
//   Gleich für alle Spieler (nur der Server schreibt). Ohne Block (kein FAEDEN=1) gibt es keinen Bereich, keine Hinweise, keine Fehler.
// Action: modell() -> null | { ok, kopf, ablehnen, scheitern, angebote: [{ id, titel, anlass, ort, ortname, rest, von, aus_geruecht, typen, vorschau }], geruechte, laufend },
//   müllfest (jedes Feld wird auf Typ und Länge geprüft; Titel, Anlass und Gerücht sind Modelltext: nur als Text gezeichnet, nie als HTML). Dazu die Kurztexte der Antwortcodes und die
//   Befehle abenteuer.annehmen / abenteuer.ablehnen (der Server entscheidet alles; die erste Antwort der Crew gilt).
// Das Terminal (terminal-ui.js, Bereich „Brett“) und der Flug-HUD (hud.js, Streifen) lesen nur hierüber; gezeichnet wird in pult-terminal-brett.js.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Brett = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const store = { abenteuer: null };
  // Grenzen der Anzeige (der Server kürzt schon enger: Titel 26, Anlass 110, Schritt 28; hier nur die Abwehr gegen Müll)
  const GRENZE = { angebote: 3, geruechte: 3, schritte: 12, folgen: 8, titel: 40, anlass: 160, text: 90, ort: 40, id: 12, typen: 4, typ: 16, wahl: 4, wahlText: 44 };
  const ID_FORM = /^a\d{1,6}$/;   // wie der Server (Form der Angebots-Id)
  // Kurztexte je Antwortcode (README SUND-04b C); fehlt einer, gilt der Klartext des Servers (ev.text), sonst ALLGEMEIN
  const CODE_KURZ = {
    modus: 'Das Auftragsbrett gibt es nur in der Freien Fahrt.',
    unbekannt: 'Diesen Auftrag kennt das Brett nicht.',
    kein_angebot: 'Dieses Angebot gibt es nicht mehr.',
    schon_beantwortet: 'Schon beantwortet: die erste Antwort der Crew gilt.',
    am_boden: 'Wer am Boden liegt, kann nicht entscheiden.',
    kein_spielleiter: 'Der Spielleiter ist nicht erreichbar. Das Angebot bleibt.',
    laeuft_schon: 'Ein Abenteuer läuft schon. Das Angebot bleibt.',
    kein_platz: 'Kein Platz für einen weiteren Handlungsstrang. Das Angebot bleibt.',
    veraltet: 'Der Auftrag hat sich erledigt und wurde vom Brett genommen.',
    fehler: 'Das Brett konnte nicht antworten. Das Angebot bleibt, noch einmal versuchen.',
  };
  const ALLGEMEIN = 'Das Brett konnte nicht antworten.';

  function lesen(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') { store.abenteuer = null; return; }   // neue Verbindung: der Server sendet den Block neu (sentAbenteuerKey wird zurückgesetzt)
    if (msg.t !== 'snap') return;
    if (msg.phase === 'lobby') { store.abenteuer = null; return; }
    if (msg.world && Object.prototype.hasOwnProperty.call(msg.world, 'abenteuer')) store.abenteuer = msg.world.abenteuer && typeof msg.world.abenteuer === 'object' ? msg.world.abenteuer : null;
  }
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]+/g, ' ').slice(0, max || GRENZE.text) : '');
  // Titel: zu lang heißt mit „…“ gekürzt (nie still abgeschnitten)
  const kurz = (v, max) => { const t = str(v, 100000); return t.length > max ? t.slice(0, Math.max(0, max - 1)).replace(/\s+$/, '') + '…' : t; };
  const zahl = (v) => (isNum(v) ? Math.max(0, Math.floor(v)) : 0);
  const liste = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  // Folge: Satz (Zeichenkette) oder Marke { f, art, d }; alles andere fällt weg
  function folgeAus(e) {
    if (typeof e === 'string') { const t = str(e, GRENZE.text); return t ? t : null; }
    if (!e || typeof e !== 'object' || !isNum(e.d) || typeof e.f !== 'string' || !e.f) return null;
    return { f: str(e.f, 12), art: e.art === 'haltung' ? 'haltung' : 'ruf', d: e.d };
  }
  // Wahl einer Bitte (Server: schritte[].wahl = [{ text, folgen: [Marke] }]): typgeprüft, längenbegrenzt; Müll fällt weg
  function wahlAus(w) {
    const out = liste(w, GRENZE.wahl * 4).filter((o) => o && typeof o === 'object' && str(o.text, GRENZE.wahlText)).slice(0, GRENZE.wahl).map((o) => ({ text: str(o.text, GRENZE.wahlText), folgen: liste(o.folgen, GRENZE.folgen).map(folgeAus).filter((f) => f !== null && typeof f === 'object') }));
    return out.length ? out : null;
  }
  function schrittAus(s) {
    if (typeof s === 'string') return { text: str(s, 60), gefahr: false, wahl: null };
    if (!s || typeof s !== 'object') return null;
    return { text: str(s.text, 60), gefahr: s.gefahr === true || s.gefahr === 1, wahl: wahlAus(s.wahl) };
  }
  function vorschauAus(v) {
    v = v && typeof v === 'object' ? v : {};
    const schritte = liste(v.schritte, GRENZE.schritte).map(schrittAus).filter((s) => s && s.text);
    const gef = schritte.find((s) => s.gefahr);
    return {
      gefahr: v.gefahr === true || v.gefahr === 1 || !!gef,
      gefahrText: gef ? gef.text : '',   // der Server schickt nur „ja/nein“; genannt wird der erste gefährliche Schritt
      schritte,
      gelingt: liste(v.gelingt, GRENZE.folgen).map(folgeAus).filter((x) => x !== null),
      scheitert: liste(v.scheitert, GRENZE.folgen).map(folgeAus).filter((x) => x !== null),
    };
  }
  function angebotAus(a) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !ID_FORM.test(a.id) || !str(a.titel, GRENZE.titel)) return null;
    return {
      id: a.id, titel: kurz(a.titel, GRENZE.titel), anlass: str(a.anlass, GRENZE.anlass), ort: str(a.ort, GRENZE.ort), ortname: str(a.ortname, GRENZE.ort), rest: zahl(a.rest),
      von: str(a.von, 8), aus_geruecht: a.aus_geruecht === true || a.aus_geruecht === 1,
      typen: liste(a.typen, GRENZE.typen * 4).filter((t) => typeof t === 'string' && t.trim()).slice(0, GRENZE.typen).map((t) => str(t.trim(), GRENZE.typ)),   // Beat-Typen ohne Abschluss (Server, höchstens 4)
      vorschau: vorschauAus(a.vorschau),
    };
  }
  function laufendAus(l) {
    if (!l || typeof l !== 'object' || !str(l.titel, GRENZE.titel)) return null;
    const gesamt = Math.max(1, Math.min(12, zahl(l.schritte_gesamt) || 1));
    return {
      id: str(l.id, GRENZE.id), titel: kurz(l.titel, GRENZE.titel), anlass: str(l.anlass, GRENZE.anlass), ort: str(l.ort, GRENZE.ort),
      schritt: Math.max(1, Math.min(gesamt, zahl(l.schritt) || 1)), schritte_gesamt: gesamt, schritt_text: str(l.schritt_text, 60), gefahr: l.gefahr === true || l.gefahr === 1,
      ph: l.ph === 'laeuft' ? 'laeuft' : 'wartet', rest: zahl(l.rest),
    };
  }
  function modellAus(b) {
    if (!b || typeof b !== 'object') return null;
    const angebote = liste(b.angebote, GRENZE.angebote).map(angebotAus).filter(Boolean);
    const laufend = laufendAus(b.laufend);
    const ids = new Set(angebote.map((a) => a.id));
    const geruechte = liste(b.geruechte, GRENZE.geruechte).filter((g) => g && typeof g === 'object' && str(g.text)).map((g) => ({ von: str(g.von, 8), text: str(g.text), angebot: typeof g.angebot === 'string' && ids.has(g.angebot) ? g.angebot : '' }));
    if (!angebote.length && !laufend) return null;   // nichts zu zeigen: kein Bereich (der Server sendet dann null)
    return { ok: b.ok === 1 || b.ok === true, kopf: str(b.kopf, 30), ablehnen: str(b.ablehnen, 50), scheitern: str(b.scheitern, 100), angebote, geruechte, laufend };
  }
  const modell = () => modellAus(store.abenteuer);

  // „Eben angenommen“: das Abenteuer wartet noch auf den ersten Schritt (aus dem Snapshot, für alle Geräte gleich, kein lokaler Zustand)
  const frisch = (l) => !!l && l.ph === 'wartet' && l.schritt === 1;
  // Text der Absage zu einem Antwortcode
  function antwortText(code, text) { return CODE_KURZ[code] || (typeof text === 'string' && text.trim() ? str(text.trim(), GRENZE.text) : ALLGEMEIN); }
  // Befehle im Protokollformat (README SUND-04b C); false bei einer ungültigen Id
  function annehmen(send, id) { return befehl(send, 'abenteuer.annehmen', id); }
  function ablehnen(send, id) { return befehl(send, 'abenteuer.ablehnen', id); }
  function befehl(send, c, id) {
    if (typeof send !== 'function' || typeof id !== 'string' || !ID_FORM.test(id)) return false;
    send({ t: 'cmd', c, id }); return true;
  }

  (function haken() {
    const N = root && root.Net;
    if (N && typeof N.on === 'function') N.on(lesen);   // wie absicht.js: jede Servernachricht läuft durch lesen()
  })();

  return { store, lesen, modellAus, modell, frisch, antwortText, annehmen, ablehnen, CODE_KURZ, GRENZE };
});
