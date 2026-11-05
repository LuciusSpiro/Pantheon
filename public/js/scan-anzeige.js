// SCA-01 P4: Anzeige der Scan-Ergebnisse (Datenblatt im Captain-Reiter Außenteam, Marker auf Kommandokarte und am Boden). Globales `ScanAnzeige`, in Node als Modul (Tests).
// Quelle ist der Snapshot `away.sc` = [[id, art, typ, sk(, x, y)], …] (Server scanbar.js). Der Client rechnet KEINE Stufenregel: eine Position gibt es nur, wenn x,y im Eintrag stehen;
// Texte, Gefahr und Symbol kommen aus content/scanner/datenblaetter.json (store.daten, vom Server ausgeliefert); der Regelhinweis erscheint ab `hinweisAb` des Typs.
// Unbekannte art/typ und kaputte Einträge werfen nie: Fallback „Unbekanntes Objekt“. Rein anzeigend; der einzige Zustand ist der Fokus (welcher Eintrag das volle Datenblatt zeigt).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScanAnzeige = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const store = { daten: null, bekannt: {}, fokus: null };
  const MAX_ZEILEN = 4;
  const FALLBACK = { name: 'Unbekanntes Objekt', gefahr: 0, zeile: 'Keine Angaben zu diesem Ziel.', hinweis: '', hinweisAb: 1, symbol: '??' };
  const TXT_KEINE_POS = 'Position unbekannt – höherer Scan nötig';
  const obj = (v) => (v && typeof v === 'object' ? v : {});
  const key = (e) => e.art + ':' + e.id;
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const kurz = (s, n) => String(s == null ? '' : s).slice(0, n);

  // Rohe Einträge prüfen und normalisieren; Müll fällt weg (kein Wurf)
  function lesen(sc) {
    const out = [];
    if (!Array.isArray(sc)) return out;
    for (const r of sc) {
      if (!Array.isArray(r) || r.length < 4) continue;
      const e = { id: kurz(r[0], 24), art: kurz(r[1], 24), typ: kurz(r[2], 24), sk: int(r[3], 0, 3, 0) };
      if (!e.id) continue;
      const x = Number(r[4]), y = Number(r[5]);
      if (r.length >= 6 && r[4] != null && r[5] != null && Number.isFinite(x) && Number.isFinite(y)) { e.x = x; e.y = y; }
      out.push(e);
    }
    return out;
  }
  const typDef = (daten, typ) => { const t = obj(obj(daten).typen)[typ]; return t && typeof t === 'object' ? t : null; };
  const artDef = (daten, art) => { const a = obj(obj(daten).arten)[art]; return a && typeof a === 'object' ? a : null; };

  // Anzeigezeile eines Eintrags: Texte nach Typ aus dem Content, sonst Fallback; Regelhinweis erst ab hinweisAb
  function zeile(e, daten) {
    const t = typDef(daten, e.typ), a = artDef(daten, e.art), fb = Object.assign({}, FALLBACK, obj(obj(daten).unbekannt));
    const q = t || fb;
    const hinweisAb = int(q.hinweisAb, 1, 3, 1);
    return {
      key: key(e), id: e.id, art: e.art, typ: e.typ, sk: e.sk,
      name: String(q.name || fb.name), gefahr: int(q.gefahr, 0, 3, 0), zeile: String(q.zeile || ''),
      hinweis: e.sk >= hinweisAb && q.hinweis ? String(q.hinweis) : '',
      symbol: kurz((t && t.symbol) || (a && a.symbol) || fb.symbol, 3),
      artTitel: a && a.titel ? String(a.titel) : '',
      pos: e.x != null ? { x: e.x, y: e.y } : null,
    };
  }

  // Fokus nachführen: ein neu erfasster oder in der Stufe gestiegener Eintrag wird Fokus (der zuletzt gelieferte gewinnt); leeres sc setzt zurück
  function beobachte(sc) {
    const l = lesen(sc);
    if (!l.length) { store.bekannt = {}; store.fokus = null; return; }
    const neu = {};
    let juengster = null;
    for (const e of l) { const k = key(e); neu[k] = e.sk; if (!(k in store.bekannt) || store.bekannt[k] < e.sk) juengster = k; }
    store.bekannt = neu;
    if (juengster) store.fokus = juengster;
    else if (!(store.fokus in neu)) store.fokus = key(l[l.length - 1]);
  }
  function waehle(k) { if (typeof k === 'string' && k in store.bekannt) store.fokus = k; }
  const fokusKey = () => store.fokus;

  // Ansicht für das Pult: { zeilen (höchstens max, der Fokus ist immer dabei), rest, fokus (Zeile | null) }; ohne Ergebnisse { zeilen: [], rest: 0, fokus: null }
  function ansicht(sc, max, daten) {
    const d = daten === undefined ? store.daten : daten;
    const alle = lesen(sc).map((e) => zeile(e, d));
    const m = Math.max(1, int(max, 1, 12, MAX_ZEILEN));
    if (!alle.length) return { zeilen: [], rest: 0, fokus: null };
    const fk = alle.find((z) => z.key === store.fokus) || alle[alle.length - 1];
    let sicht = alle.slice(0, m);
    if (!sicht.includes(fk)) sicht = alle.slice(0, m - 1).concat([fk]);
    return { zeilen: sicht, rest: alle.length - sicht.length, fokus: fk };
  }

  // Datenblatt des Fokus als Textblöcke (Umbruch macht der Aufrufer nach Pixelbreite): Name, Gefahr, Zeile, Hinweis, Position (Kachelkoordinate)
  function blatt(z, tile) {
    if (!z) return null;
    const T = tile > 0 ? tile : 32;
    return {
      titel: z.name, gefahr: z.gefahr, zeile: z.zeile, hinweis: z.hinweis,
      position: z.pos ? 'Position: Feld ' + Math.floor(z.pos.x / T) + ' / ' + Math.floor(z.pos.y / T) : TXT_KEINE_POS,
      hatPosition: !!z.pos,
    };
  }

  // Marker (nur Einträge mit Position): [{ key, x, y, symbol, fokus }]
  function marker(sc, daten) {
    const d = daten === undefined ? store.daten : daten;
    const out = [];
    for (const e of lesen(sc)) if (e.x != null) { const z = zeile(e, d); out.push({ key: z.key, x: e.x, y: e.y, symbol: z.symbol, artTitel: z.artTitel, fokus: z.key === store.fokus }); }
    return out;
  }

  // Text auf Pixelbreite kürzen (... am Ende); measure(text) liefert die Breite
  function kuerze(text, maxW, measure) {
    let s = String(text == null ? '' : text);
    if (measure(s) <= maxW) return s;
    while (s.length > 1 && measure(s + '...') > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '...';
  }
  const sterne = (q) => { const k = Math.max(0, Math.min(3, q)); return '[' + '*'.repeat(k) + '-'.repeat(3 - k) + ']'; };   // wie entschluesseln.js (die Pixelschrift hat keine Sterne)

  function laden() {
    if (typeof fetch !== 'function') return;
    fetch('/content/scanner/datenblaetter.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && typeof j === 'object' && j.typen) store.daten = j; }).catch(() => { /* ohne Texte: Fallback „Unbekanntes Objekt“ */ });
  }
  if (typeof window !== 'undefined' && root === window) laden();

  return { store, MAX_ZEILEN, TXT_KEINE_POS, FALLBACK, lesen, zeile, beobachte, waehle, fokusKey, ansicht, blatt, marker, kuerze, sterne, laden };
});
