// SUND-02b UI: Rang von Rom in der Anzeige (nur Freie Fahrt Sund). Globales `Rang`, in Node als Modul (Tests).
// Storage: store.ruf = letzter Block world.ruf { rom, ger, kon, rang, name, ab, bis } (kommt nur bei Änderung; world.ruf = null ist das Löschsignal,
//   wenn der Modus endet; welcome und die Lobby leeren ebenfalls, sonst stünde ein alter Rang in Kampagne oder Lobby). Dazu die Texte
//   (content/flotte/ruf.json, Abschnitt anzeige) und die Dienstgrade (content/welt/ruf-werte.json, raenge), beide vom Server gelesen.
// Action: modellAus(ruf, raenge, texte) -> Anzeigemodell oder null (ohne Block keine Anzeige, kein Platzhalter). Gleich für alle Spieler (nur der Server schreibt).
// Frontend: zeichne(ctx, xRechts, y, maxW, m) zeichnet rechtsbündig „RANG OPTIO ▮▮▮▯▯▯ 12/30 → CENTURIO“ und lässt von rechts weg, was nicht passt
//   (erst der nächste Rang, dann die Segmente, dann die Zahl); der Name steht immer. Farben nur aus KarteTokens.PULT (keine neuen Token).
//   Farbenblind: der Fortschritt steht als Zahl und als gefüllte/leere Segmente (Form), nie nur als Farbe.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Rang = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const SEGMENTE = 8;

  // ---------------------------------------------------------------- Storage
  const store = { ruf: null, texte: null, raenge: null };
  function lesen(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') { store.ruf = null; return; }   // neue Verbindung: der Server sendet den Block neu (sentRufKey wird zurückgesetzt)
    if (msg.t !== 'snap') return;
    if (msg.phase === 'lobby') { store.ruf = null; return; }
    if (msg.world && Object.prototype.hasOwnProperty.call(msg.world, 'ruf')) store.ruf = msg.world.ruf && typeof msg.world.ruf === 'object' ? msg.world.ruf : null;
  }
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  // ---------------------------------------------------------------- Action: Anzeigemodell
  // -> null | { name, ruf, ab, bis, anteil 0..1 | null, segmente, voll, naechster (Name | null), titel, zahl, weiter, hoechster, jetzt }
  function fuellen(t, w) { return String(t == null ? '' : t).replace(/\{(\w+)\}/g, (x, k) => (w[k] != null ? String(w[k]) : x)); }
  function modellAus(ruf, raenge, texte) {
    if (!ruf || typeof ruf !== 'object' || !ruf.name) return null;
    const T = (texte && typeof texte === 'object') ? texte : {};
    const R = Array.isArray(raenge) ? raenge : [];
    const rom = isNum(ruf.rom) ? ruf.rom : 0, ab = isNum(ruf.ab) ? ruf.ab : 0, bis = isNum(ruf.bis) ? ruf.bis : null;
    const i = R.findIndex((r) => r && r.id === ruf.rang);
    const naechster = bis != null && i >= 0 && R[i + 1] ? R[i + 1].name : null;
    const anteil = bis != null && bis > ab ? Math.max(0, Math.min(1, (rom - ab) / (bis - ab))) : null;
    const ganz = (v) => (isNum(v) ? Math.floor(v) : v);   // Welle 5 (S8): ganze Zahlen („MILES 0/8“ statt „0.25/8“); der Fortschritt (anteil, voll) rechnet weiter mit dem genauen Wert
    const w = { rang: ruf.name, ruf: ganz(rom), bis: ganz(bis), naechster };
    return {
      name: String(ruf.name), ruf: rom, ab, bis, anteil, segmente: SEGMENTE, voll: anteil == null ? 0 : Math.floor(anteil * SEGMENTE + 1e-9),
      naechster, titel: T.titel || '',
      zahl: bis != null && T.fortschritt ? fuellen(T.fortschritt, w) : bis != null ? ganz(rom) + '/' + ganz(bis) : '',
      weiter: naechster && T.naechster ? fuellen(T.naechster, w) : '',
      hoechster: bis == null ? (T.hoechster || '') : '',
      jetzt: bis != null ? (T.jetzt ? fuellen(T.jetzt, w) : '') : (T.jetzt_hoechster ? fuellen(T.jetzt_hoechster, w) : ''),
    };
  }
  const modell = () => modellAus(store.ruf, store.raenge, store.texte);

  // ---------------------------------------------------------------- Frontend: Zeile rechtsbündig
  const env = { Render: null, Tokens: null };   // Tests setzen env.Render = { text, measure } und env.Tokens = KarteTokens
  const Rd = () => env.Render || (root && root.Render) || null;
  const tw = (s) => { const r = Rd(); return r && r.measure ? r.measure(String(s), 1) : String(s).length * 6; };
  const P = () => (env.Tokens || (root && root.KarteTokens) || {}).PULT || null;   // Messing, Hell, Grau, Aus, Tisch aus den Pult-Grundfarben
  const SW = 4, SH = 5, SL = 1;   // Segment: 4×5 px, 1 px Luft
  const segBreite = (n) => n * (SW + SL) - SL;
  // Teile von links nach rechts mit Breite; was nicht in maxW passt, fällt von rechts weg (weiter, dann Segmente, dann Zahl)
  function teile(m) {
    const out = [];
    if (m.titel) out.push({ art: 'titel', t: m.titel, w: tw(m.titel) });
    out.push({ art: 'name', t: m.name.toUpperCase(), w: tw(m.name.toUpperCase()) });
    if (m.anteil != null) out.push({ art: 'seg', w: segBreite(m.segmente), weg: 2 });
    if (m.zahl) out.push({ art: 'zahl', t: m.zahl, w: tw(m.zahl), weg: 3 });
    if (m.weiter) out.push({ art: 'weiter', t: m.weiter.toUpperCase(), w: tw(m.weiter.toUpperCase()), weg: 1 });
    if (m.hoechster) out.push({ art: 'hoechster', t: m.hoechster, w: tw(m.hoechster), weg: 1 });
    return out;
  }
  const LUFT = 5;
  const breite = (ts) => ts.reduce((a, q) => a + q.w, 0) + Math.max(0, ts.length - 1) * LUFT;
  function passend(m, maxW) {
    let ts = teile(m);
    for (const stufe of [1, 2, 3]) { if (breite(ts) <= maxW) break; ts = ts.filter((q) => q.weg !== stufe); }
    if (breite(ts) > maxW) ts = ts.filter((q) => q.art !== 'titel');
    return ts;
  }
  // -> gezeichnete Breite (0 = nichts)
  function zeichne(ctx, xr, y, maxW, m) {
    const r = Rd();
    const C = P();
    if (!m || !r || !r.text || !C) return 0;
    const ts = passend(m, maxW), w = breite(ts);
    if (w > maxW) return 0;
    let x = Math.round(xr - w);
    for (const q of ts) {
      if (q.art === 'seg') {
        for (let i = 0; i < m.segmente; i++) {
          const sx = x + i * (SW + SL);
          if (i < m.voll) { ctx.fillStyle = C.messing; ctx.fillRect(sx, y + 1, SW, SH); }
          else { ctx.fillStyle = C.aus; ctx.fillRect(sx, y + 1, SW, SH); ctx.fillStyle = C.tisch; ctx.fillRect(sx + 1, y + 2, SW - 2, SH - 2); }
        }
      } else {
        const col = q.art === 'titel' ? C.messing : q.art === 'name' ? C.hell : C.grau;
        r.text(ctx, q.t, x, y, { color: col, shadow: false });
      }
      x += q.w + LUFT;
    }
    return w;
  }

  // ---------------------------------------------------------------- Laden und Anmelden (nur im Browser)
  function laden() {
    if (typeof fetch !== 'function') return;
    fetch('/content/flotte/ruf.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.anzeige) store.texte = j.anzeige; }).catch(() => { /* ohne Texte: Name und Zahl */ });
    fetch('/content/welt/ruf-werte.json').then((r) => (r.ok ? r.json() : null)).then((j) => { const w = j && j.werte && j.werte.raenge && j.werte.raenge.wert; if (Array.isArray(w)) store.raenge = w; }).catch(() => { /* ohne Dienstgrade: kein nächster Rang */ });
  }
  (function haken() {
    const N = root && root.Net;
    if (!N || typeof N.on !== 'function') return;
    N.on(lesen);
    laden();
  })();

  return { store, lesen, modellAus, modell, zeichne, passend, breite, env, SEGMENTE };
});
