// CHA-01 C: Charaktere des Spielers im Browser. Store + Actions in einem Modul (Kais 3-Layer-Regel für Datentool-Teile):
//   Store    = dieses Objekt (Zustand an einer Stelle: `lies()`), die Oberfläche (public/js/kammer-ui.js) liest nur von dort
//   Actions  = benannte Funktionen je Absicht (ladeListe, legeAn, waehle, loesche, benenneUm, erststart, uebernimmOderNeu, nameBestaetigen, …); jede Regel steht hier, nicht in der Oberfläche
//   Speicher = EINE Stelle: localStorage 'pantheon.charaktere' = { v: 1, gewaehlt: <id>, liste: [{ id, karte }] }, höchstens 4; über `speicher` austauschbar (Test).
// Jede gelesene Karte geht durch Shared_Charakter.pruefeKarte (manipulierter Speicher bricht nichts). Kaputter/fehlender/gesperrter Speicher → leere Liste, Spiel läuft weiter.
// Actions werfen nie: Rückgabe { ok: true, … } oder { ok: false, grund }. Ohne Katalog (noch nicht geladen / fehlt) ist `bereit` false und nichts wird gespeichert.
// CHA-01 D: Spind (Outfit im Spiel wechseln): Entwurf in `sitzung.entwurf` (modus 'spind'), EINZIGER Schreibweg für `outfit` ist `speichereOutfit` (prüft mit Ch.pruefeOutfit, speichert über speichereListe,
//   meldet es dem Server über `sende`); Charakterteil, Name und Farben bleiben unberührt. Alle anderen Actions erhalten das Outfit (benenneUm, waehle).
// UMD: im Browser `window.Charaktere` (eine Instanz auf localStorage), in Node `require('…/charaktere.js').erzeuge({ speicher, Charakter })`.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.CharaktereModul = api; root.Charaktere = api.erzeuge({ speicher: api.browserSpeicher(root), Charakter: root.Shared_Charakter, sende: (outfit) => { const C = root.Client; if (C && typeof C.sendeOutfit === 'function') C.sendeOutfit(outfit); } }); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SCHLUESSEL = 'pantheon.charaktere';
  const MAX = 4;
  const ID_FORM = /^[A-Za-z0-9_-]{1,32}$/;
  // Plätze der Erstellung (genau diese sechs Felder: Name + drei Teile + zwei Farben), Reihenfolge = Ziffernblock von oben nach unten
  const TEIL_PLAETZE = ['frisur', 'gesicht', 'bart'];
  const FARB_PLAETZE = ['haar', 'haut'];
  const PLAETZE = TEIL_PLAETZE.concat(FARB_PLAETZE);
  // CHA-01 D: sechs Outfit-Plätze des Spinds, Reihenfolge wie die Mittelspalte des Ziffernblocks (Kopf → Füße, dann Hände und Umhang)
  const OUTFIT_PLAETZE = ['kopf', 'oberteil', 'hose', 'schuhe', 'haende', 'umhang'];
  const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  function browserSpeicher(root) {
    return {
      lesen() { try { return root.localStorage.getItem(SCHLUESSEL); } catch (e) { return null; } },
      schreiben(text) { try { root.localStorage.setItem(SCHLUESSEL, text); return true; } catch (e) { return false; } },
    };
  }

  function erzeuge(opt) {
    const speicher = opt.speicher, Ch = opt.Charakter, sende = typeof opt.sende === 'function' ? opt.sende : () => {}, zufall = typeof opt.zufall === 'function' ? opt.zufall : Math.random;
    const klon = (o) => JSON.parse(JSON.stringify(o));
    const lauscher = [];
    let katalog = null;

    // ------------------------------------------------------------------ Store
    // liste/gewaehlt = der gespeicherte Teil; sitzung = Zustand der Oberfläche (Seite, Cursor, Entwurf); rev zählt jede Änderung (Caches der Oberfläche)
    const store = {
      bereit: false, speicherOk: true, rev: 0,
      gewaehlt: null, liste: [],
      sitzung: { seite: null, cursor: 0, loeschFrage: null, entwurf: null, meldung: null },   // meldung: { grund, zeit } (z. B. 'voll'); die Oberfläche übersetzt in Text
    };
    const aenderung = () => { store.rev++; };
    let letzteAktive = 'null';
    function meldeWechsel() {
      const k = aktiveKarte(), j = JSON.stringify(k);
      if (j === letzteAktive) return;
      letzteAktive = j;
      for (const f of lauscher.slice()) { try { f(k); } catch (e) { /* ein Lauscher darf die Actions nicht stören */ } }
      if (store.sitzung.spindWartet) oeffneSpind();   // der Spind wurde geöffnet, bevor Katalog und Charakter da waren: jetzt nachziehen
    }
    // Outfit-Wechsel (Anziehen im Spind) ist ein eigener Kanal: kein Charakterwechsel, also kein hello; die Lauscher ziehen nur ihren Stand der aktiven Karte nach.
    const outfitLauscher = [];
    function meldeOutfitWechsel() {
      const k = aktiveKarte();
      letzteAktive = JSON.stringify(k);   // der gemerkte Stand bleibt aktuell, ein späteres meldeWechsel() sieht kein „neues“ Outfit
      for (const f of outfitLauscher.slice()) { try { f(k); } catch (e) { /* ein Lauscher darf die Actions nicht stören */ } }
    }
    const lies = () => store;
    const abonniere = (f) => { if (typeof f === 'function') lauscher.push(f); };
    const abonniereOutfit = (f) => { if (typeof f === 'function') outfitLauscher.push(f); };

    // ------------------------------------------------------------------ Katalog-Sicht (rein lesend)
    function teileFuer(platz) {
      if (!katalog || !TEIL_PLAETZE.includes(platz)) return [];
      return (katalog.teile || []).filter((t) => t && t.platz === platz && t.gruppe === 'charakter');
    }
    // Teile eines Outfit-Platzes (Gruppe 'outfit') in Katalogreihenfolge
    function outfitTeileFuer(platz) {
      if (!katalog || !OUTFIT_PLAETZE.includes(platz)) return [];
      return (katalog.teile || []).filter((t) => t && t.platz === platz && t.gruppe === 'outfit');
    }
    // CHA-01 F: Kacheln, die das Teil am eigenen Kopf zeigen statt einer festen Vorschau: Erstellung (modus 'neu') nur für Frisur, Spind nur für Kopf.
    // Liefert die Karte, an der das Teil sitzt (Erstellung: der Entwurf mit dem Teil; Spind: die getragene Karte mit dem Teil), sonst null (feste Vorschau).
    const KACHEL_LIVE = { neu: ['frisur'], spind: ['kopf'] };
    function kachelKarte(modus, platz, teilId) {
      if (!(KACHEL_LIVE[modus] || []).includes(platz) || String(teilId).indexOf(platz + '/') !== 0) return null;
      const wert = teilId.slice(platz.length + 1);
      if (modus === 'spind') { const k = aktiveKarte(); return k ? Object.assign(k, { outfit: Object.assign(k.outfit, { [platz]: wert }) }) : null; }
      const k = entwurfKarte(); return k ? Object.assign(k, { [platz]: wert }) : null;
    }
    // CHA-01 F: welche gesperrten Herkünfte ('haendler', 'fund') hat der Platz im Spind überhaupt? Die Legende zeigt nur diese Zeilen.
    function spindGesperrteHerkuenfte(platz) {
      const h = []; for (const t of outfitTeileFuer(platz)) if (t.herkunft && t.herkunft !== 'frei' && !h.includes(t.herkunft)) h.push(t.herkunft);
      return h;
    }
    function farbenFuer(platz) {
      const f = katalog && katalog.farben;
      return f && Array.isArray(f[platz === 'haut' ? 'haut' : 'haar']) ? f[platz === 'haut' ? 'haut' : 'haar'] : [];
    }
    // CHA-01 Nacharbeit Gesamt S3: Katalogteil und Anzeigename eines Teils (Platz + Teilname der Karte); unbekannt -> null bzw. der Rohname
    const teil = (platz, name) => ((katalog && katalog.teile) || []).find((t) => t && t.id === platz + '/' + name) || null;
    const teilName = (platz, name) => { const t = teil(platz, name); return t ? t.name : String(name || ''); };
    const anzahlOptionen = (platz) => (TEIL_PLAETZE.includes(platz) ? teileFuer(platz).length : farbenFuer(platz).length);

    // ------------------------------------------------------------------ Speicher (eine Stelle)
    function speichereListe() {
      if (!store.bereit) return false;
      const daten = { v: 1, gewaehlt: store.gewaehlt, liste: store.liste.map((c) => ({ id: c.id, karte: c.karte })) };
      store.speicherOk = !!speicher.schreiben(JSON.stringify(daten));
      aenderung();
      return store.speicherOk;
    }
    // Liest und prüft den Speicher. Ohne Katalog passiert nichts (bereit bleibt false).
    function ladeListe() {
      if (!katalog) return { ok: false, grund: 'katalog' };
      let liste = [], gewaehlt = null;
      try {
        const d = JSON.parse(speicher.lesen());
        if (istObjekt(d) && Array.isArray(d.liste)) {
          const ids = new Set();
          for (const e of d.liste.slice(0, 64)) {
            if (liste.length >= MAX) break;
            if (!istObjekt(e) || typeof e.id !== 'string' || !ID_FORM.test(e.id) || ids.has(e.id)) continue;
            ids.add(e.id);
            liste.push({ id: e.id, karte: Ch.pruefeKarte(e.karte, katalog) });
          }
          if (typeof d.gewaehlt === 'string' && ids.has(d.gewaehlt)) gewaehlt = d.gewaehlt;
        }
      } catch (e) { liste = []; gewaehlt = null; }
      store.liste = liste;
      store.gewaehlt = gewaehlt || (liste.length ? liste[0].id : null);
      store.bereit = true;
      store.sitzung.cursor = Math.max(0, indexVon(store.gewaehlt));
      aenderung();
      meldeWechsel();
      return { ok: true, anzahl: liste.length };
    }
    // Name für das erste hello, solange der Katalog noch lädt: der Name des gewählten Charakters aus dem Speicher (ungeprüfte Karte, nur der Name zählt), sonst der, den erststart vergeben wird
    function vorabName(o) {
      try {
        const d = JSON.parse(speicher.lesen());
        if (istObjekt(d) && Array.isArray(d.liste)) {
          const c = d.liste.find((e) => istObjekt(e) && e.id === d.gewaehlt && istObjekt(e.karte)) || d.liste.find((e) => istObjekt(e) && istObjekt(e.karte));
          const n = c && Ch.pruefeName(c.karte.name);
          if (n) return n;
          if (c) return Ch.STANDARD_NAME;
        }
      } catch (e) { /* kaputter Speicher: wie nichts */ }
      const alt = o && typeof o.altName === 'string' && o.altName.trim() ? o.altName : null;
      return alt != null ? (Ch.pruefeName(alt) || Ch.STANDARD_NAME) : (Ch.pruefeName(o && o.zufallsName) || Ch.STANDARD_NAME);
    }
    function setzeKatalog(k) {
      katalog = istObjekt(k) ? k : null;
      store.katalog = katalog;
      return katalog ? ladeListe() : { ok: false, grund: 'katalog' };
    }

    // ------------------------------------------------------------------ Actions: Charaktere
    const indexVon = (id) => store.liste.findIndex((c) => c.id === id);
    function neueId() {
      for (;;) {
        const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
        if (indexVon(id) < 0) return id;
      }
    }
    function aktiveKarte() {
      const c = store.liste.find((x) => x.id === store.gewaehlt);
      return c ? klon(c.karte) : null;
    }
    function aktiverName() { const c = store.liste.find((x) => x.id === store.gewaehlt); return c ? c.karte.name : null; }

    // Neuer Charakter: Name, Gesicht, Frisur, Bart, Hautton, Haarfarbe aus `wunsch`; alles andere (Körper, Outfit) ist Standard. Wird gewählt.
    function legeAn(wunsch) {
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      if (store.liste.length >= MAX) return { ok: false, grund: 'voll' };
      const w = istObjekt(wunsch) ? wunsch : {};
      const name = Ch.pruefeName(w.name);
      if (!name) return { ok: false, grund: 'name' };
      const karte = Ch.standardKarte(name, katalog);
      for (const p of PLAETZE) if (w[p] !== undefined) karte[p] = w[p];
      const geprueft = Ch.pruefeKarte(karte, katalog);   // unbekannte Teile/Farben werden zum Standard
      const id = neueId();
      store.liste.push({ id, karte: geprueft });
      store.gewaehlt = id;
      speichereListe();
      meldeWechsel();
      return { ok: true, id };
    }
    function waehle(id) {
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      if (indexVon(id) < 0) return { ok: false, grund: 'unbekannt' };
      store.gewaehlt = id;
      speichereListe();
      meldeWechsel();
      return { ok: true, id };
    }
    // Zufallsname nach der Namensregel (wie der Zufallsname des Clients: Crew-100 … Crew-999)
    const zufallsName = () => 'Crew-' + (100 + Math.floor(zufall() * 900));
    // Löscht einen Charakter. Der gewählte wird durch den nächsten ersetzt (sonst der vorherige). War es der letzte, gilt der Erststart: ein Standard-Charakter
    // mit Zufallsname wird angelegt und gewählt (Rückgabe `ersatz` = id), damit Client und Server nie ohne Charakter dastehen.
    function loesche(id) {
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      const i = indexVon(id);
      if (i < 0) return { ok: false, grund: 'unbekannt' };
      store.liste.splice(i, 1);
      if (store.gewaehlt === id) store.gewaehlt = store.liste.length ? store.liste[Math.min(i, store.liste.length - 1)].id : null;
      store.sitzung.loeschFrage = null;
      store.sitzung.cursor = Math.max(0, Math.min(store.sitzung.cursor, MAX - 1));
      speichereListe();
      if (!store.liste.length) { const r = legeStandardAn(zufallsName()); if (r.ok) { store.sitzung.cursor = 0; return { ok: true, ersatz: r.id }; } }
      meldeWechsel();
      return { ok: true };
    }
    function benenneUm(id, name) {
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      const c = store.liste.find((x) => x.id === id);
      if (!c) return { ok: false, grund: 'unbekannt' };
      const n = Ch.pruefeName(name);
      if (!n) return { ok: false, grund: 'name' };
      c.karte.name = n;
      speichereListe();
      meldeWechsel();
      return { ok: true, name: n };
    }
    // Altstand (nur sternenschicht.name): erster Charakter mit diesem Namen, Standardaussehen; ungültig/leer → STANDARD_NAME. Nur, wenn es noch keinen Charakter gibt.
    function uebernimmAltenNamen(altName) {
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      if (store.liste.length) return { ok: false, grund: 'vorhanden' };
      const r = legeAn({ name: Ch.pruefeName(altName) || Ch.STANDARD_NAME });
      return r.ok ? { ok: true, id: r.id, quelle: 'alt' } : r;
    }
    // Gar nichts da: Standard-Charakter mit dem Zufallsnamen (gilt nur, wenn er die Namensregel erfüllt, sonst STANDARD_NAME)
    function legeStandardAn(zufallsName) {
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      if (store.liste.length) return { ok: false, grund: 'vorhanden' };
      const r = legeAn({ name: Ch.pruefeName(zufallsName) || Ch.STANDARD_NAME });
      return r.ok ? { ok: true, id: r.id, quelle: 'zufall' } : r;
    }
    // Erststart ohne Pflichtschritt: gibt es schon Charaktere, passiert nichts; sonst Altname übernehmen oder Standard-Charakter anlegen.
    function erststart(o) {
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      if (store.liste.length) return { ok: true, quelle: 'vorhanden' };
      const alt = o && typeof o.altName === 'string' && o.altName.trim() ? o.altName : null;
      return alt != null ? uebernimmAltenNamen(alt) : legeStandardAn(o && o.zufallsName);
    }

    // ------------------------------------------------------------------ Actions: Liste (Seite der Oberfläche)
    function oeffneListe() {
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      store.sitzung.seite = 'liste';
      store.sitzung.loeschFrage = null;
      store.sitzung.entwurf = null;
      store.sitzung.cursor = Math.max(0, indexVon(store.gewaehlt));
      aenderung();
      return { ok: true };
    }
    function schliesse() { store.sitzung.seite = null; store.sitzung.entwurf = null; store.sitzung.loeschFrage = null; aenderung(); return { ok: true }; }
    // Cursor auf Karte i (0–3, auch freie Plätze); zurück nur ändern, wenn sich etwas ändert
    function setzeCursor(i) {
      const s = store.sitzung;
      i = Math.max(0, Math.min(MAX - 1, i | 0));
      if (i !== s.cursor) { s.cursor = i; s.loeschFrage = null; aenderung(); }
      return { ok: true, cursor: s.cursor };
    }
    const bewegeCursor = (d) => setzeCursor((store.sitzung.cursor + (d < 0 ? -1 : 1) + MAX) % MAX);
    const cursorCharakter = () => store.liste[store.sitzung.cursor] || null;
    // Enter in der Liste: den Charakter unter dem Cursor übernehmen („In die Lobby“); auf einem freien Platz: kein Wechsel
    function uebernimm() {
      const c = cursorCharakter();
      return c ? waehle(c.id) : { ok: false, grund: 'frei' };
    }
    // Enter in der Liste: Charakter unter dem Cursor übernehmen (aktion 'uebernommen'); auf einem freien Platz stattdessen neu anlegen (aktion 'neu')
    function uebernimmOderNeu() {
      const c = cursorCharakter();
      if (c) { const r = waehle(c.id); return r.ok ? { ok: true, aktion: 'uebernommen', id: c.id } : r; }
      const r = neuAnlegen();
      return r.ok ? { ok: true, aktion: 'neu' } : r;
    }
    // Löschen mit Rückfrage: der erste Aufruf fragt (grund 'gefragt', ok false), der zweite auf demselben Charakter löscht
    function loeschenAnfrage() {
      const c = cursorCharakter();
      if (!c) return { ok: false, grund: 'frei' };
      const s = store.sitzung;
      if (s.loeschFrage !== c.id) { s.loeschFrage = c.id; aenderung(); return { ok: false, grund: 'gefragt', id: c.id }; }
      return loesche(c.id);
    }
    function loeschenAbbrechen() { if (store.sitzung.loeschFrage) { store.sitzung.loeschFrage = null; aenderung(); } return { ok: true }; }

    // ------------------------------------------------------------------ Actions: Erstellung / Umbenennen (Entwurf)
    function standardEntwurfKarte() { return Ch.standardKarte(null, katalog); }
    // „Neu“ aus der Liste: öffnet die Erstellung; sind alle Plätze belegt, steht eine Meldung 'voll' im Store
    function neuAnlegen() {
      const r = beginneNeu();
      if (!r.ok && r.grund === 'voll') { store.sitzung.meldung = { grund: 'voll', zeit: Date.now() }; aenderung(); }
      return r;
    }
    function beginneNeu() {
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      if (store.liste.length >= MAX) return { ok: false, grund: 'voll' };
      const s = store.sitzung;
      s.seite = 'erstellung'; s.loeschFrage = null;
      s.entwurf = { modus: 'neu', id: null, karte: standardEntwurfKarte(), name: '', nameEdit: true, platz: 'frisur', yaw: 0, hinweis: null };
      aenderung();
      return { ok: true };
    }
    // F2 aus der Liste: nur das Namensfeld ist aktiv, das Aussehen bleibt wie gespeichert
    function beginneUmbenennen() {
      const c = cursorCharakter();
      if (!c) return { ok: false, grund: 'frei' };
      const s = store.sitzung;
      s.seite = 'erstellung'; s.loeschFrage = null;
      s.entwurf = { modus: 'umbenennen', id: c.id, karte: klon(c.karte), name: c.karte.name, nameEdit: true, platz: null, yaw: 0, hinweis: null };
      aenderung();
      return { ok: true };
    }
    const entwurf = () => store.sitzung.entwurf;
    function waehlePlatz(platz) {
      const e = entwurf();
      if (!e || e.modus !== 'neu' || !PLAETZE.includes(platz)) return { ok: false, grund: 'platz' };
      e.platz = platz; e.nameEdit = false; e.hinweis = null; aenderung();
      return { ok: true };
    }
    function naechsterPlatz(d) {
      const e = entwurf();
      if (!e || e.modus !== 'neu') return { ok: false, grund: 'platz' };
      const i = PLAETZE.indexOf(e.platz);
      return waehlePlatz(PLAETZE[(i + (d < 0 ? -1 : 1) + PLAETZE.length) % PLAETZE.length]);
    }
    // Index der aktuellen Wahl im Platz (Kachel bzw. Farbmuster)
    function wahlIndex(e, platz) {
      if (!e) return -1;
      if (TEIL_PLAETZE.includes(platz)) return teileFuer(platz).findIndex((t) => t.id === platz + '/' + e.karte[platz]);
      return e.karte[platz] | 0;
    }
    function setzeWahl(platz, i) {
      const e = entwurf();
      const n = anzahlOptionen(platz);
      if (!e || e.modus !== 'neu' || !PLAETZE.includes(platz) || !n) return { ok: false, grund: 'platz' };
      i = Math.max(0, Math.min(n - 1, i | 0));
      if (TEIL_PLAETZE.includes(platz)) e.karte[platz] = teileFuer(platz)[i].id.slice(platz.length + 1);
      else e.karte[platz] = i;
      e.hinweis = null; aenderung();
      return { ok: true, index: i };
    }
    // ←→: in der Wahl des aktuellen Platzes blättern (ringförmig)
    function blaettere(d) {
      const e = entwurf();
      if (!e || e.modus !== 'neu') return { ok: false, grund: 'platz' };
      const n = anzahlOptionen(e.platz);
      if (!n) return { ok: false, grund: 'platz' };
      return setzeWahl(e.platz, (Math.max(0, wahlIndex(e, e.platz)) + (d < 0 ? -1 : 1) + n) % n);
    }
    function dreheFigur(d) { const e = entwurf(); if (!e) return { ok: false }; e.yaw = (e.yaw + (d < 0 ? -45 : 45) + 360) % 360; aenderung(); return { ok: true, yaw: e.yaw }; }
    // Name: Schreibmodus (F2), Zeichen, Löschen; erlaubt ist, was pruefeName durchlässt (Buchstaben, Ziffern, Leerzeichen, Bindestrich), höchstens NAME_MAX Zeichen
    function nameBearbeiten(an) { const e = entwurf(); if (!e) return { ok: false }; e.nameEdit = !!an; e.hinweis = null; aenderung(); return { ok: true }; }
    function nameZeichen(z) {
      const e = entwurf();
      if (!e || !e.nameEdit || typeof z !== 'string') return { ok: false };
      const sauber = z.replace(/[^\p{L}\p{N} -]/gu, '');
      if (!sauber || Array.from(e.name).length >= Ch.NAME_MAX) return { ok: false };
      e.name = Array.from(e.name + sauber).slice(0, Ch.NAME_MAX).join(''); e.hinweis = null; aenderung();
      return { ok: true };
    }
    function nameLoeschen() { const e = entwurf(); if (!e || !e.nameEdit) return { ok: false }; e.name = Array.from(e.name).slice(0, -1).join(''); e.hinweis = null; aenderung(); return { ok: true }; }
    // Enter im Schreibmodus: Name gilt → Schreibmodus aus; sonst Hinweis (grund 'name')
    function nameFertig() {
      const e = entwurf();
      if (!e) return { ok: false };
      if (!Ch.pruefeName(e.name)) { e.hinweis = 'name'; aenderung(); return { ok: false, grund: 'name' }; }
      e.nameEdit = false; e.hinweis = null; aenderung();
      return { ok: true };
    }
    // Enter im Schreibmodus: Umbenennen speichert sofort (Name gilt → zurück in die Liste), Neu beendet nur das Schreiben (der Charakter wird erst mit Enter außerhalb gespeichert)
    function nameBestaetigen() {
      const e = entwurf();
      if (!e) return { ok: false, grund: 'kein-entwurf' };
      return e.modus === 'umbenennen' ? speichereEntwurf() : nameFertig();
    }
    // Esc im Schreibmodus: Neu mit eingetipptem Namen → nur das Schreiben beenden; sonst (leerer Name, Umbenennen) den Entwurf verwerfen
    function nameAbbrechen() {
      const e = entwurf();
      if (!e) return { ok: false, grund: 'kein-entwurf' };
      if (e.modus === 'neu' && e.name) return nameBearbeiten(false);
      return verwirfEntwurf();
    }
    // CHA-01 F: wirkt R (Zurücksetzen)? Erstellung: immer (setzt auch Platz und Schreibmodus zurück); Umbenennen: nur, wenn der Name vom gespeicherten abweicht (das Aussehen ändert sich dort nicht)
    function kannZuruecksetzen() {
      const e = entwurf();
      if (!e) return false;
      if (e.modus === 'neu') return true;
      const c = store.liste.find((x) => x.id === e.id);
      return !!c && e.name !== c.karte.name;
    }
    function zuruecksetzen() {
      const e = entwurf();
      if (!e) return { ok: false };
      if (!kannZuruecksetzen()) return { ok: false, grund: 'unveraendert' };
      if (e.modus === 'neu') { e.karte = standardEntwurfKarte(); e.name = ''; e.nameEdit = true; e.platz = 'frisur'; e.yaw = 0; }
      else { const c = store.liste.find((x) => x.id === e.id); if (c) { e.name = c.karte.name; e.karte = klon(c.karte); } }
      e.hinweis = null; aenderung();
      return { ok: true };
    }
    // Enter außerhalb des Schreibmodus: speichern (neu: anlegen und wählen; umbenennen: Name setzen), zurück in die Liste
    function speichereEntwurf() {
      const e = entwurf();
      if (!e) return { ok: false, grund: 'kein-entwurf' };
      let r;
      if (e.modus === 'neu') r = legeAn(Object.assign({}, { name: e.name }, PLAETZE.reduce((o, p) => { o[p] = e.karte[p]; return o; }, {})));
      else r = benenneUm(e.id, e.name);
      if (!r.ok) { e.hinweis = r.grund; if (r.grund === 'name') e.nameEdit = true; aenderung(); return r; }   // ungültiger Name: Namensfeld wieder offen, Hinweis steht
      const s = store.sitzung;
      s.seite = 'liste'; s.entwurf = null; s.cursor = Math.max(0, indexVon(e.modus === 'neu' ? store.gewaehlt : e.id));   // neu: auf den neuen (gewählten); umbenannt: beim umbenannten bleiben
      aenderung();
      return r;
    }
    function verwirfEntwurf() { const s = store.sitzung; s.seite = 'liste'; s.entwurf = null; aenderung(); return { ok: true }; }
    // Karte des Entwurfs für die Figur im Fenster (Name unwichtig); ohne Entwurf null
    function entwurfKarte() { const e = entwurf(); return e ? Ch.pruefeKarte(Object.assign({}, e.karte, { name: Ch.pruefeName(e.name) || Ch.STANDARD_NAME }), katalog) : null; }

    // ------------------------------------------------------------------ Actions: Spind (Outfit im Spiel wechseln)
    // Entwurf = das getragene Outfit des gewählten Charakters; der Cursor ist die Anprobe, erst `speichereOutfit` (Enter) zieht an.
    function oeffneSpind() {
      const k = aktiveKarte(), s = store.sitzung;
      if (!store.bereit || !k) { s.spindWartet = true; aenderung(); return { ok: false, grund: 'katalog' }; }   // merkt sich den Wunsch; ladeListe() öffnet nach
      s.spindWartet = false;
      s.seite = 'spind'; s.loeschFrage = null;
      s.entwurf = { modus: 'spind', id: store.gewaehlt, karte: k, platz: OUTFIT_PLAETZE[0], yaw: 0, hinweis: null };
      aenderung();
      return { ok: true };
    }
    function schliesseSpind() { store.sitzung.spindWartet = false; if (store.sitzung.seite === 'spind') schliesse(); return { ok: true }; }
    const spindEntwurf = () => { const e = entwurf(); return e && e.modus === 'spind' ? e : null; };
    function spindWahlIndex(platz) {
      const e = spindEntwurf();
      return e && OUTFIT_PLAETZE.includes(platz) ? outfitTeileFuer(platz).findIndex((t) => t.id === platz + '/' + e.karte.outfit[platz]) : -1;
    }
    function spindWaehlePlatz(platz) {
      const e = spindEntwurf();
      if (!e || !OUTFIT_PLAETZE.includes(platz)) return { ok: false, grund: 'platz' };
      e.platz = platz; e.hinweis = null; aenderung();
      return { ok: true };
    }
    function spindNaechsterPlatz(d) {
      const e = spindEntwurf();
      if (!e) return { ok: false, grund: 'platz' };
      return spindWaehlePlatz(OUTFIT_PLAETZE[(OUTFIT_PLAETZE.indexOf(e.platz) + (d < 0 ? -1 : 1) + OUTFIT_PLAETZE.length) % OUTFIT_PLAETZE.length]);
    }
    // Anprobe: Teil i im Platz auswählen (nur im Entwurf, noch nichts gespeichert)
    function spindSetzeWahl(platz, i) {
      const e = spindEntwurf(), teile = outfitTeileFuer(platz);
      if (!e || !teile.length) return { ok: false, grund: 'platz' };
      i = Math.max(0, Math.min(teile.length - 1, i | 0));
      e.platz = platz;
      e.karte.outfit[platz] = teile[i].id.slice(platz.length + 1);
      e.hinweis = null; aenderung();
      return { ok: true, index: i };
    }
    // ←→: ein Teil weiter (ringförmig); ↑↓: eine Kachelzeile weiter, nur wenn es dort ein Teil gibt (`spalten` = Kacheln je Zeile der Anzeige)
    function spindBlaettere(d) {
      const e = spindEntwurf();
      if (!e) return { ok: false, grund: 'platz' };
      const n = outfitTeileFuer(e.platz).length;
      return n ? spindSetzeWahl(e.platz, (Math.max(0, spindWahlIndex(e.platz)) + (d < 0 ? -1 : 1) + n) % n) : { ok: false, grund: 'platz' };
    }
    function spindZeile(d, spalten) {
      const e = spindEntwurf();
      if (!e) return { ok: false, grund: 'platz' };
      const n = outfitTeileFuer(e.platz).length, i = Math.max(0, spindWahlIndex(e.platz)) + (d < 0 ? -1 : 1) * Math.max(1, spalten | 0);
      return i >= 0 && i < n ? spindSetzeWahl(e.platz, i) : { ok: false, grund: 'rand' };
    }
    // R: zurück auf das getragene Outfit (Platz und Drehung bleiben)
    function spindZuruecksetzen() {
      const e = spindEntwurf(), k = aktiveKarte();
      if (!e || !k) return { ok: false, grund: 'kein-entwurf' };
      e.karte = k; e.hinweis = null; aenderung();
      return { ok: true };
    }
    // Karte des Entwurfs für die Anprobe-Figur
    const spindKarte = () => { const e = spindEntwurf(); return e ? Ch.pruefeKarte(e.karte, katalog) : null; };
    // Enter: das Outfit des Entwurfs anziehen = EINZIGER Weg, der `outfit` einer gespeicherten Karte schreibt. Geprüft (Ch.pruefeOutfit), nur in den gewählten Charakter,
    // gespeichert (speichereListe) und an den Server gemeldet (`sende`, kein hello: der Client-Stand zieht über abonniereOutfit nach). Name, Gesicht, Frisur, Bart, Farben bleiben, wie sie sind.
    function speichereOutfit() {
      const e = spindEntwurf();
      if (!e) return { ok: false, grund: 'kein-entwurf' };
      if (!store.bereit) return { ok: false, grund: 'katalog' };
      const c = store.liste.find((x) => x.id === store.gewaehlt);
      if (!c) return { ok: false, grund: 'unbekannt' };
      const outfit = Ch.pruefeOutfit(e.karte.outfit, katalog);
      if (OUTFIT_PLAETZE.every((pl) => outfit[pl] === c.karte.outfit[pl])) { e.karte = klon(c.karte); e.hinweis = 'angezogen'; aenderung(); return { ok: true, geaendert: false, outfit: klon(outfit), gespeichert: store.speicherOk }; }   // schon getragen: nichts speichern, nichts senden
      // Teile, die nicht frei sind (Händler, Fund), lassen sich anprobieren, aber nicht anziehen (in CHA-01 ist alles frei)
      if (OUTFIT_PLAETZE.some((pl) => outfit[pl] !== c.karte.outfit[pl] && outfitTeileFuer(pl).some((t) => t.id === pl + '/' + outfit[pl] && t.herkunft && t.herkunft !== 'frei'))) { e.hinweis = 'gesperrt'; aenderung(); return { ok: false, grund: 'gesperrt' }; }
      c.karte.outfit = outfit;
      speichereListe();   // schlägt der Browser-Speicher fehl, gilt das Outfit trotzdem für die Sitzung (store.speicherOk false)
      e.karte = klon(c.karte); e.hinweis = 'angezogen'; aenderung();
      meldeOutfitWechsel();
      sende(klon(outfit));
      return { ok: true, geaendert: true, outfit: klon(outfit), gespeichert: store.speicherOk };
    }

    return {
      SCHLUESSEL, MAX, PLAETZE, TEIL_PLAETZE, FARB_PLAETZE, OUTFIT_PLAETZE,
      outfitTeileFuer, kachelKarte, spindGesperrteHerkuenfte, oeffneSpind, schliesseSpind, spindWahlIndex, spindWaehlePlatz, spindNaechsterPlatz, spindSetzeWahl, spindBlaettere, spindZeile, spindZuruecksetzen, spindKarte, speichereOutfit,
      lies, abonniere, abonniereOutfit, katalog: () => katalog, setzeKatalog, vorabName,
      teileFuer, farbenFuer, anzahlOptionen, teil, teilName, wahlIndex: (platz) => wahlIndex(entwurf(), platz),
      ladeListe, speichereListe,
      legeAn, waehle, loesche, benenneUm, uebernimmAltenNamen, legeStandardAn, erststart, aktiveKarte, aktiverName,
      oeffneListe, schliesse, setzeCursor, bewegeCursor, uebernimm, uebernimmOderNeu, neuAnlegen, loeschenAnfrage, loeschenAbbrechen,
      beginneNeu, beginneUmbenennen, waehlePlatz, naechsterPlatz, setzeWahl, blaettere, dreheFigur,
      nameBearbeiten, nameZeichen, nameLoeschen, nameFertig, nameBestaetigen, nameAbbrechen, kannZuruecksetzen, zuruecksetzen, speichereEntwurf, verwirfEntwurf, entwurfKarte,
    };
  }

  return { SCHLUESSEL, MAX, erzeuge, browserSpeicher };
});
