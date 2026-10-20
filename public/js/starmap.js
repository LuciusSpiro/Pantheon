// B3 Sektorkarte (CONTRACT-B3 §8; Team KARTE): Sternkarte als Hexfeld (Karte Limes, 10×8), Klick-Auswahl, Bojen in der
// Raumszene. render.js delegiert drawStarMap an StarMap.draw und ruft in der Raumszene StarMap.drawSzene; consoles.js fragt
// beim Klick zuerst StarMap.hit.
//
// Datenquellen (alles optional, der Server ist maßgeblich):
//   Karte      welcome.sektorkarte (hier mitgelesen) | StarMap.setKarte(k) | window.Shared_Sektoren.KARTE
//   Erkundung  Snapshot world.sektoren { e, b, t, o, v } (kommt nur bei Änderung; hier gemerkt) – fehlt er, wird der Stand
//              aus world.locations abgeleitet (Migrationsregel §5: erkundet = besucht, Boje bekannt = beide Orte bekannt)
//   Szene      space.jp [{ k, x, y, z, n }], ship.jump { dest, jp, d }
// Rückfall: Ohne Kartendaten oder nach wiederholten Fehlern zeichnet Render.drawStarMapAlt (die alte Punktkarte), hit()
// liefert dann null (es gilt die bisherige Trefferliste).
// Symbole/Bojen aus window.IconsB (Team UI-ART); fehlt ein Eintrag, zeichnet diese Datei einen einfachen Ersatz.
(function () {
  'use strict';

  // ------------------------------------------------------------------ Stil (artdirector §4, hex.svg)
  // SL1B: Farben, Symbol-Vokabular und Zeichenfunktionen liegen in js/kartenzeichen.js (gemeinsam mit dem Sektorplan, SL4)
  const KZ = window.Kartenzeichen;
  const { COL, FRAKTION, EINFLUSS, SYMBOL_ICON, SYMBOL_NAME, ZUSTAND_NAME, ZUSTAND_FARBE } = KZ;
  const SQ3 = Math.sqrt(3);
  const MAX_FEHLER = 3;

  const R = () => window.Render;
  function report(label, e) { try { if (window.Net && Net.reportError) Net.reportError(label, e); else console.warn(label, e); } catch (x) { /* egal */ } }
  function txt(ctx, s, x, y, o) { R().text(ctx, s, x, y, o); }
  function mess(s) { return R().measure(s, 1); }

  // ------------------------------------------------------------------ Datenhaltung
  const store = { karte: null, kartePrep: null, sektoren: null, fehler: 0, aus: false, layouts: [], pick: null, pickSel: undefined, ansicht: 'fokus', marken: [],
    lage: null, lageAnsicht: 'uebersicht', lageModell: null, hoverHex: null };   // SUND-01 C: Wissen von Rom (world.lage) – nur im Modus Freie Fahrt Sund
  // Ansichten (SL1B, karteneutral): 'fokus' = spielbare Hexe + ein Ring Nachbarn (Standard, groß), 'gesamt' = ganze Karte. Die alten Namen
  // 'saumraum' und 'limes' gelten weiter.
  const normAnsicht = (a) => (a === 'gesamt' || a === 'limes' ? 'gesamt' : 'fokus');

  function setKarte(k) {
    if (!k || typeof k !== 'object' || !k.hexe) return false;
    if (store.karte && store.karte.id !== k.id) { store.sektoren = null; store.marken = []; store.lage = null; }   // andere Karte (Limes <-> Sund): alter Stand gilt nicht
    store.karte = k; store.kartePrep = null;
    return true;
  }
  function karte() {
    if (store.karte) return store.karte;
    const SS = window.Shared_Sektoren;
    if (SS && SS.KARTE && SS.KARTE.hexe && Object.keys(SS.KARTE.hexe).length) return SS.KARTE;
    return null;
  }

  // welcome.sektorkarte und world.sektoren mitlesen: als Zuhörer an Net.on angemeldet (F7, B1-FIX-CLIENT).
  function mitlesen(msg) {
    if (!msg) return;
    if (msg.t === 'welcome' && msg.sektorkarte) {
      setKarte(msg.sektorkarte);
      // Bis CLIENT (Welle 2) das welcome bindet: Shared_Sektoren belegen (setzt auch Shared_Locations.links), nur wenn leer
      const SS = window.Shared_Sektoren;
      if (SS && typeof SS.setzeKarte === 'function' && SS.KARTE !== msg.sektorkarte && !(SS.KARTE && SS.KARTE.hexe)) {
        try { SS.setzeKarte(msg.sektorkarte); } catch (e) { report('StarMap.setzeKarte', e); }
      }
    }
    else if (msg.t === 'snap' && msg.phase === 'lobby') { store.lage = null; if (window.KarteLage) window.KarteLage.funkLeeren(); }   // SUND-01 C: neue Partie, altes Wissen verwerfen
    else if (msg.t === 'snap' && msg.world) {
      if (msg.world.lage) store.lage = msg.world.lage;   // SUND-01 C: nur bei Änderung
      if (msg.world.sektoren) store.sektoren = msg.world.sektoren;
      if (Array.isArray(msg.world.marken)) store.marken = msg.world.marken;   // SL1B: Marken (Ziele, Notrufe, Spuren, Funde, Kontakte), nur bei Änderung
    }
  }
  (function haken() {
    const N = window.Net;
    if (!N || typeof N.on !== 'function' || store.abmelden) return;
    store.abmelden = N.on((msg) => { try { mitlesen(msg); } catch (e) { report('StarMap.mitlesen', e); } });
  })();

  // ------------------------------------------------------------------ Geometrie (karte_limes.py: flache Hexe, ungerade Spalten oben)
  function code(c, r) { return (c < 10 ? '0' : '') + c + (r < 10 ? '0' : '') + r; }
  function cr(hex) { return { c: parseInt(String(hex).slice(0, 2), 10), r: parseInt(String(hex).slice(2), 10) }; }
  function nachbarn(hex, K) {
    const { c, r } = cr(hex);
    const cand = c % 2 ? [[c, r - 1], [c, r + 1], [c - 1, r - 1], [c - 1, r], [c + 1, r - 1], [c + 1, r]]
      : [[c, r - 1], [c, r + 1], [c - 1, r], [c - 1, r + 1], [c + 1, r], [c + 1, r + 1]];
    return cand.filter(([a, b]) => a >= 1 && a <= K.spalten && b >= 1 && b <= K.zeilen).map(([a, b]) => code(a, b));
  }
  function kanteId(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
  // SUND-01 C: Nachbarschaft über offene Kanten (Nahansicht, Vermutung), Fraktionsname der Karte -> Kürzel des Anzeigeblocks
  const FRK = { rom: 'r', ger: 'g', saum: 'k', pirat: 'p', frei: '-', vorl: 'v' };
  function lageAdj(P) {
    if (P.lageAdj) return P.lageAdj;
    const adj = {};
    for (const e of P.kanten) { if (e.art === 'hidden' || e.art === 'far' || e.art === 'locked') continue; (adj[e.a] = adj[e.a] || []).push(e.b); (adj[e.b] = adj[e.b] || []).push(e.a); }
    return (P.lageAdj = adj);
  }
  function lageWeg(P, a, b) {
    const adj = lageAdj(P), prev = { [a]: null }, q = [a];
    for (let i = 0; i < q.length; i++) { if (q[i] === b) break; for (const y of adj[q[i]] || []) if (!(y in prev)) { prev[y] = q[i]; q.push(y); } }
    if (!(b in prev)) return null;
    const out = []; for (let x = b; x; x = prev[x]) out.unshift(x);
    return out;
  }

  // Vorbereitete Karte: Kantenliste mit IDs, Ort <-> Hex, Regionen
  function prep(K) {
    if (store.kartePrep && store.kartePrep.K === K) return store.kartePrep;
    const P = { K, spalten: K.spalten || 10, zeilen: K.zeilen || 8, kanten: [], kanteById: {}, hexVonOrt: {}, ortVonHex: {} };
    for (const k of K.kanten || []) {
      const e = Object.assign({}, k, { id: kanteId(k.a, k.b) });
      P.kanten.push(e); P.kanteById[e.id] = e;
    }
    for (const h in K.hexe) { const o = K.hexe[h] && K.hexe[h].ort; if (o) { P.hexVonOrt[o] = h; P.ortVonHex[h] = o; } }
    store.kartePrep = P;
    return P;
  }
  function hexVon(P, id) {
    if (!id) return null;
    id = String(id);
    if (id.indexOf('leer-') === 0) return id.slice(5);
    if (/^\d{4}$/.test(id)) return id;
    return P.hexVonOrt[id] || null;
  }

  // ------------------------------------------------------------------ Lage (aus Snapshot)
  function lage(st, P) {
    const Rd = R();
    const w = Rd.worldOf(st);
    const ship = (st && st.ship) || {};
    const locs = {}; for (const l of w.locations || []) locs[l.id] = l;
    const hier = hexVon(P, w.location) || hexVon(P, ship.scene);
    const jump = ship.jump || {};
    const ziel = hexVon(P, jump.dest);
    const sek = (st && st.world && st.world.sektoren) || store.sektoren;
    const erkundet = new Set(), bojen = new Set(), temp = new Set(), offen = new Set();
    const ortBekannt = (h) => { const o = P.ortVonHex[h]; return !!(o && locs[o] && locs[o].known); };
    const ortSichtbar = (h) => { const o = P.ortVonHex[h]; return !!(o && locs[o]); };
    if (sek) {
      for (const h of sek.e || []) erkundet.add(h);
      for (const k of sek.b || []) bojen.add(k);
      for (const k of sek.t || []) temp.add(k);
      for (const k of sek.o || []) offen.add(k);
    } else {
      // Ableitung wie die Migration v2 -> v3 (§5): erkundet = besucht; Boje bekannt = open/locked zwischen bekannten Orten
      for (const id in locs) if (locs[id].visited) { const h = P.hexVonOrt[id]; if (h) erkundet.add(h); }
      const lid = {};
      for (const id in locs) for (const b of locs[id].links || []) { const ha = P.hexVonOrt[id], hb = P.hexVonOrt[b]; if (ha && hb) lid[kanteId(ha, hb)] = 1; }
      for (const e of P.kanten) {
        if (e.art === 'far' || e.art === 'hidden') continue;
        const ka = ortBekannt(e.a) || sichtbarGesperrt(P, e.a), kb = ortBekannt(e.b) || sichtbarGesperrt(P, e.b);
        if (ka && kb && (ortBekannt(e.a) || ortBekannt(e.b))) bojen.add(e.id);
        if (e.art === 'locked' && lid[e.id]) offen.add(e.id);
      }
    }
    if (hier) erkundet.add(hier);
    // Bojen der aktuellen Szene (Zustand vom Server)
    const jp = {};
    for (const b of (st && st.space && st.space.jp) || []) if (b && b.k) { jp[b.k] = b; bojen.add(b.k); }
    return { w, locs, hier, ziel, jump, erkundet, bojen, temp, offen, jp, ortBekannt, ortSichtbar, sek: !!sek, pflicht: anflugPflicht(st) };
  }
  function sichtbarGesperrt(P, h) { const s = P.K.hexe[h]; return !!(s && s.spielbar === false && !s.verborgen); }
  function spielbar(P, h) { const s = P.K.hexe[h]; return s ? s.spielbar !== false : true; }

  // Zustand einer Kante für die Karte: null = nicht zeigen
  function kantenZustand(P, L, e) {
    if (L.temp.has(e.id)) return 'temporaer';
    const j = L.jp[e.id];
    if (j && j.z) return j.z;
    if (e.art === 'hidden') return L.bojen.has(e.id) || L.offen.has(e.id) ? 'aktiv' : null;
    if (e.art === 'far') return L.offen.has(e.id) ? 'aktiv' : 'gesperrt';
    if (e.art === 'locked') return L.offen.has(e.id) ? 'aktiv' : 'gesperrt';
    return 'aktiv';
  }
  function kanteBekannt(P, L, e) {
    if (L.temp.has(e.id) || L.bojen.has(e.id) || L.jp[e.id]) return true;
    if (e.art === 'hidden') return false;
    // Karte Limes außerhalb des Saumraums ist bekannt (nicht spielbar): Kanten dort als Kartenwissen, ohne Boje
    return sichtbarGesperrt(P, e.a) && sichtbarGesperrt(P, e.b) ? 'karte' : false;
  }
  function begehbar(P, L, e) {
    const z = kantenZustand(P, L, e);
    return kanteBekannt(P, L, e) === true && (z === 'aktiv' || z === 'temporaer') && e.art !== 'far';
  }
  // Route über bekannte, begehbare Kanten (Breitensuche)
  function route(P, L, von, nach) {
    if (!von || !nach || von === nach) return null;
    const adj = {};
    for (const e of P.kanten) {
      if (!begehbar(P, L, e)) continue;
      if (!spielbar(P, e.a) || !spielbar(P, e.b)) continue;
      (adj[e.a] = adj[e.a] || []).push(e.b); (adj[e.b] = adj[e.b] || []).push(e.a);
    }
    for (const id of L.temp) { const [a, b] = id.split('-'); (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); }
    const prev = { [von]: null }, q = [von];
    while (q.length) {
      const x = q.shift();
      if (x === nach) break;
      for (const y of adj[x] || []) if (!(y in prev)) { prev[y] = x; q.push(y); }
    }
    if (!(nach in prev)) return null;
    const out = []; for (let x = nach; x; x = prev[x]) out.unshift(x);
    return out;
  }

  // Anzeigestatus eines Hex
  function hexStatus(P, L, h) {
    const s = P.K.hexe[h];
    if (!s) return { art: 'leer', erkundet: L.erkundet.has(h) };
    if (s.verborgen && !L.erkundet.has(h)) return { art: 'verborgen', s };
    if (s.spielbar === false) return { art: 'gesperrt', s };
    if (L.erkundet.has(h)) return { art: 'erkundet', s };
    return { art: 'unerkundet', s, nameBekannt: L.ortSichtbar(h) && L.ortBekannt(h) };
  }
  function hexName(P, L, h, lang) {
    const st = hexStatus(P, L, h);
    if (st.art === 'leer') return lang ? 'Leerraum ' + h : 'Leer';
    if (st.art === 'verborgen') return '?';
    if (st.art === 'unerkundet' && !st.nameBekannt) return lang ? 'Unbekanntes System' : '?';
    return st.s.name || h;
  }
  function sperrGrund(P, L, h) {
    const s = P.K.hexe[h];
    if (!s) return null;
    if (s.verborgen && !L.erkundet.has(h)) return 'Kein bekannter Sprungpunkt.';
    if (s.spielbar !== false) return null;
    const reg = (P.K.regionen || {})[s.region] || {};
    return reg.sperrtext || 'Sektor gesperrt.';
  }

  // ------------------------------------------------------------------ Icons (IconsB oder Ersatz)
  // Zeichenfunktionen aus js/kartenzeichen.js (SL1B); die Namen bleiben, damit der Rest der Datei unverändert läuft
  const fraktionFarbe = KZ.fraktionFarbe;
  const zeichneHexIcon = (ctx, id, x, y, farbe) => KZ.symbol(ctx, id, x, y, { farbe });
  const zeichneEinfluss = KZ.einfluss;
  const zeichneBoje = KZ.boje;
  const zeichneBojeErsatz = KZ.bojeErsatz;
  const hauptIcon = KZ.hauptIcon;

  // ------------------------------------------------------------------ Zeichnen der Karte
  function hexPfad(ctx, x, y, s) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; const px = x + s * Math.cos(a), py = y + s * Math.sin(a); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  }
  function kurzName(name, maxW) {
    if (mess(name) <= maxW) return name;
    const teile = String(name).split(/[\s\-„“"]+/).filter(Boolean);
    for (const t of teile) if (t.length > 2 && mess(t) <= maxW) return t;
    let s = teile[0] || String(name);
    while (s.length > 2 && mess(s + '.') > maxW) s = s.slice(0, -1);
    return s + '.';
  }

  function zeichne(ctx, view, rect, opts) {
    const K = karte();
    const P = prep(K);
    const Rd = R();
    const st = view.state || {};
    const t = view.time || 0;
    const L = lage(st, P);
    const C = P.spalten, Z = P.zeilen;
    const breiteF = 2 + 1.5 * (C - 1), hoeheF = SQ3 * (Z + 0.5);
    // Ansicht: „fokus“ (Standard, spielbare Hexe + ein Ring Nachbarn, groß; Hexe mit Marken kommen dazu) oder „gesamt“ (ganze Karte).
    // Der HUD-Ausschnitt (opts.kompakt) zeigt immer den Fokus.
    const marken = (store.marken || []).filter((mk) => mk && /^\d{4}$/.test(mk.h) && P.K.hexe !== undefined);   // SL1B: Ziele, Notrufe, Spuren, Funde, Kontakte
    const LG = !opts.kompakt && store.lage && window.KarteLage ? window.KarteLage : null;   // SUND-01 C: Übersichtskarte nach dem Wissen von Rom (nur mit world.lage)
    const A = LG ? LG.lesen(store.lage, LG.T.hexReihenfolge(K)) : null;
    const ansicht = LG ? 'lage-' + store.lageAnsicht : opts.kompakt ? 'fokus' : normAnsicht(opts.ansicht || store.ansicht);
    const alle = [];
    for (let c = 1; c <= C; c++) for (let r = 1; r <= Z; r++) alle.push(code(c, r));
    const ux = (c) => 1 + 1.5 * (c - 1), uy = (c, r) => SQ3 / 2 + SQ3 * (r - 1) + (c % 2 === 0 ? SQ3 / 2 : 0);
    let fokusSet = null;
    if (LG) fokusSet = LG.fokusHexe(store.lageAnsicht, Object.keys(K.hexe), L.hier, lageAdj(P));   // ohne Ring, ohne innere Seitenleiste
    else if (ansicht === 'fokus') {
      fokusSet = new Set();
      for (const mk of marken) { fokusSet.add(mk.h); for (const n of nachbarn(mk.h, P)) fokusSet.add(n); }   // Marken liegen immer im Bild
      for (const h in K.hexe) { const q = K.hexe[h]; if (q && (q.spielbar !== false || q.region === 'saumraum')) { fokusSet.add(h); for (const n of nachbarn(h, P)) fokusSet.add(n); } }
      if (L.hier) fokusSet.add(L.hier);
      if (!fokusSet.size) fokusSet = null;
    }
    const bbHexe = fokusSet ? [...fokusSet] : alle;
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const h of bbHexe) { const { c, r } = cr(h); bx0 = Math.min(bx0, ux(c) - 1); bx1 = Math.max(bx1, ux(c) + 1); by0 = Math.min(by0, uy(c, r) - SQ3 / 2); by1 = Math.max(by1, uy(c, r) + SQ3 / 2); }
    const bbW = bx1 - bx0, bbH = by1 - by0;
    // Seitenleiste für Hex-Details, wenn genug Platz bleibt; sonst Detail als Schild im Bild
    let seiteW = 0;
    if (!opts.kompakt) {
      if (LG) seiteW = 0;
      else if (fokusSet) seiteW = rect.w >= 320 ? 130 : 0;
      else { const s0 = Math.min((rect.w - 8) / bbW, (rect.h - 8) / bbH); seiteW = Math.min(150, rect.w - 8 - bbW * s0); if (seiteW < 96) seiteW = 0; }
    }
    const seite = seiteW > 0;
    const availW = rect.w - 8 - seiteW;
    const s0 = Math.max(6, Math.min(availW / bbW, (rect.h - 8) / bbH, LG && store.lageAnsicht === 'nah' ? LG.M.hexradius.nahMax : Infinity));
    const gArea = { x: rect.x + 2, y: rect.y + 2, w: availW + 4, h: rect.h - 4 };
    const ox0 = rect.x + 4 + (availW - bbW * s0) / 2 - bx0 * s0, oy0 = rect.y + (rect.h - bbH * s0) / 2 - by0 * s0;
    // TB1: Zoom/Pan (kartenansicht.js, reine Client-Ansicht; nicht im HUD-Ausschnitt). Schlüssel je Konsole und Ansicht.
    const KA = window.KartenAnsicht;
    const ansichtKey = !opts.kompakt && KA ? (opts.ansichtKey || 'stern') + ':' + ansicht : null;
    const ab = ansichtKey ? KA.anwenden(ansichtKey, gArea, { x: ox0 + bx0 * s0, y: oy0 + by0 * s0, w: bbW * s0, h: bbH * s0 }) : null;
    const s = ab ? s0 * ab.z : s0;
    const ox = ab ? ab.x(ox0) : ox0, oy = ab ? ab.y(oy0) : oy0;
    const kompakt = !!opts.kompakt || s < 14;
    const dicht = !kompakt && s < 24;
    const gx = ox, gy = oy, gw = breiteF * s, gh = hoeheF * s;   // ganze Karte Limes (für Pins)
    const h3 = SQ3 * s;
    const mitte = (hex) => { const { c, r } = cr(hex); return { x: ox + s * ux(c), y: oy + s * uy(c, r) }; };
    const imBereich = (x, y) => x >= gArea.x && y >= gArea.y && x < gArea.x + gArea.w && y < gArea.y + gArea.h;
    const toS = (x, y) => ({ x: Math.round(gx + x / 900 * gw), y: Math.round(gy + y / 600 * gh) });
    const toW = (sx, sy) => ({ x: Math.max(0, Math.min(900, Math.round((sx - gx) / gw * 900))), y: Math.max(0, Math.min(600, Math.round((sy - gy) / gh * 600))) });

    // Auswahl: Klick auf nicht wählbares Hex (pick) gilt, bis sich die Auswahl der Konsole ändert
    const selHex = hexVon(P, opts.selected);
    if (store.pickSel !== opts.selected) { store.pick = null; store.pickSel = opts.selected; }
    let hover = null;
    if (opts.mouse) {
      const m = opts.mouse;
      if (imBereich(m.x, m.y)) {
        let best = null, bd = s * 0.92;
        for (const h of alle) { const p = mitte(h); const d = Math.hypot(p.x - m.x, p.y - m.y); if (d < bd) { bd = d; best = h; } }
        hover = best;
      }
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.fillStyle = COL.tisch; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(gArea.x, gArea.y, gArea.w, gArea.h); ctx.clip();   // Karte (angeschnitten), Seitenleiste frei

    // 1) Hexflächen (Stilblatt §2: IconsB.hexFlaeche zeichnet Fläche, Muster, Abdunklung, Schraffur, Rand)
    const IB = window.IconsB || {};
    const sk = s / 60;                         // Skala der Stilblatt-Breiten (Hexradius 60)
    const STATUS_IB = { leer: 'leerraum', verborgen: 'verborgen', unerkundet: 'unerkundet', gesperrt: 'gesperrt', erkundet: 'erkundet' };
    for (const h of alle) {
      const p = mitte(h), hs = hexStatus(P, L, h);
      const pfad = [];
      for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; pfad.push([p.x + (s - 0.5) * Math.cos(a), p.y + (s - 0.5) * Math.sin(a)]); }
      const fr = hs.s ? hs.s.fraktion : null;
      if (LG && hs.s && (hs.art === 'erkundet' || hs.art === 'unerkundet')) { LG.flaeche(ctx, p, s, A, h, FRK[fr] || '-'); continue; }   // SUND-01 C
      if (typeof IB.hexFlaeche === 'function' && IB.hexFlaeche(ctx, pfad, fr, STATUS_IB[hs.art], { s: Math.max(0.5, sk), ohneMuster: kompakt }) !== false) continue;
      hexPfad(ctx, p.x, p.y, s - 0.5);
      if (hs.art === 'leer') {
        ctx.fillStyle = COL.leer; ctx.fill();
        ctx.strokeStyle = COL.leerRand; ctx.lineWidth = 1; ctx.stroke();
      } else if (hs.art === 'verborgen' || hs.art === 'unerkundet') {
        ctx.fillStyle = COL.unerkundet; ctx.fill();
        ctx.strokeStyle = COL.umriss; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.fillStyle = fraktionFarbe(fr); ctx.fill();
        ctx.strokeStyle = 'rgba(244,238,220,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        if (hs.art === 'gesperrt') {
          ctx.fillStyle = 'rgba(11,14,26,0.45)'; ctx.fill();
          ctx.save(); ctx.clip();
          ctx.strokeStyle = 'rgba(11,14,26,0.55)'; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let d = -2 * s; d < 2 * s; d += 4) { ctx.moveTo(p.x + d - s, p.y + s); ctx.lineTo(p.x + d + s, p.y - s); }
          ctx.stroke(); ctx.restore();
        }
      }
    }

    // 2) Kanten + Bojen (Stilblatt §3: IconsB.kante/perle auf der gemeinsamen Hexkante)
    const ks = Math.max(0.36, sk);            // Linien/Perlen nicht unter Lesbarkeit schrumpfen
    const kante = (ax, ay, bx, by, z, o) => {
      if (typeof IB.kante === 'function' && IB.kante(ctx, ax, ay, bx, by, z, Object.assign({ s: ks }, o)) !== false) return;
      // Ersatz
      ctx.save();
      ctx.strokeStyle = ZUSTAND_FARBE[z] || COL.aktiv; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2, 7 * ks);
      if (z === 'gesperrt') ctx.setLineDash([4, 3]); else if (z === 'temporaer') ctx.setLineDash([1, 4]);
      ctx.beginPath();
      if (o.bogenPunkt) { ctx.strokeStyle = COL.fern; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(o.bogenPunkt.x, o.bogenPunkt.y, bx, by); }
      else { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.stroke(); ctx.restore();
      if (!o.ohnePerle) zeichneBojeErsatz(ctx, z, o.perle ? o.perle.x : (ax + bx) / 2, o.perle ? o.perle.y : (ay + by) / 2, Math.max(5, 16 * ks));
    };
    // temporäre Kanten, die nicht in limes.json stehen (z. B. in den Leerraum), kommen dazu
    const perlenLage = [];   // SUND-01 C: Perlen werden über Sichtgrenze und Front erneut gezeichnet
    const kantenListe = P.kanten.slice();
    for (const id of L.temp) if (!P.kanteById[id]) { const [a, b] = id.split('-'); if (a && b) kantenListe.push({ a, b, art: 'temp', id }); }
    for (const e of kantenListe) {
      const bek = kanteBekannt(P, L, e);
      if (!bek) continue;
      const z = kantenZustand(P, L, e);
      if (!z) continue;
      const a = mitte(e.a), b = mitte(e.b);
      if (e.art === 'far') {
        // Fernsprung: Bogen mit Pfeil, Kreuz-Perle auf dem Scheitel (in B3 gesperrt)
        const hb = Math.max(18, 1.4 * s);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const cpx = (a.x + b.x) / 2 - dy / len * hb, cpy = (a.y + b.y) / 2 + dx / len * hb;
        kante(a.x, a.y, b.x, b.y, z === 'aktiv' ? 'aktiv' : 'far', { bogen: hb, bogenPunkt: { x: cpx, y: cpy }, perle: { x: 0.25 * a.x + 0.5 * cpx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cpy + 0.25 * b.y } });
        continue;
      }
      // gemeinsame Seite der Nachbarn
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = -dy / len, uy = dx / len, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, hl = s / 2 - 1;
      const nurKarte = bek === 'karte';
      ctx.save();
      if (nurKarte) ctx.globalAlpha = 0.35;
      kante(mx + ux * hl, my + uy * hl, mx - ux * hl, my - uy * hl, z, { s: nurKarte ? Math.max(0.25, sk * 0.6) : ks, ohnePerle: nurKarte });
      ctx.restore();
      if (LG && !nurKarte) perlenLage.push({ x: mx, y: my, z, ks });
    }
    // SUND-01 C: Sichtgrenze, Front (Warnbake), dann die Perlen der Kanten oben (der Sprungpunkt bleibt auf Grenze und Front sichtbar)
    const V = LG ? { s, h3, mitte, nachbarn: (h) => nachbarn(h, P), hexe: Object.keys(K.hexe), bereich: LG.T.bereich(s), weg: (a, b) => lageWeg(P, a, b) } : null;
    if (LG) {
      LG.sichtgrenze(ctx, A, V); LG.front(ctx, A, V);
      for (const q of perlenLage) { if (typeof IB.perle !== 'function' || IB.perle(ctx, q.z, q.x, q.y, q.ks) === false) zeichneBojeErsatz(ctx, q.z, q.x, q.y, Math.max(5, 16 * q.ks)); }
    }

    // 3) Route (über bekannte Kanten) zum gewählten / angefahrenen Ziel: Hell 2 px, Strich 4/4 (Stilblatt §2.3)
    const routeZiel = (store.pick && hexStatus(P, L, store.pick).art !== 'gesperrt' ? store.pick : null) || selHex || L.ziel;
    const weg = route(P, L, L.hier, routeZiel);
    if (weg && weg.length > 1) {
      ctx.save();
      ctx.strokeStyle = COL.text; ctx.globalAlpha = 0.85; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -((t * 12) % 8);
      ctx.beginPath(); weg.forEach((h, i) => { const p = mitte(h); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke();
      ctx.restore();
    }

    // 3b) Schnellsprung: gewählte Route (Gelb, durchgezogen) und das Schiff unterwegs (Server: ship.jump.rt, ship.jump.reise)
    const rt = L.jump && L.jump.rt, rs = L.jump && L.jump.reise;
    if (rt && rt.length && L.hier) {
      ctx.save(); ctx.strokeStyle = COL.ziel || '#F2C230'; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
      ctx.beginPath(); [L.hier].concat(rt).forEach((h, i) => { const p = mitte(h); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke();
      ctx.restore();
    }
    if (rs && rs.von && rs.nach) {
      const a0 = mitte(rs.von), b0 = mitte(rs.nach), q = Math.max(0, Math.min(1, rs.p || 0));
      const x = a0.x + (b0.x - a0.x) * q, y = a0.y + (b0.y - a0.y) * q, ang = Math.atan2(b0.y - a0.y, b0.x - a0.x);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(127,224,194,0.25)'; ctx.beginPath(); ctx.arc(0, 0, Math.max(6, s * 0.28), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COL.text; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-2, 0); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // 4) Inhalte je Hex: Koordinate oben, Symbol Mitte, Einfluss rechts, Hafenklasse rechts oben, Name unten
    const HS = IB.HEXSTATUS || {};
    for (const h of alle) {
      const p = mitte(h), hs = hexStatus(P, L, h);
      const stil = HS[STATUS_IB[hs.art]] || {};
      const lgHex = !!(LG && hs.s && (hs.art === 'erkundet' || hs.art === 'unerkundet'));   // SUND-01 C: Kartenstand gilt für alle Sim-Hexe (Namen, Symbole)
      const lgBel = lgHex && LG.belagert(A, h);
      // dicht (ganze Karte auf der 640×360-Konsole, s < 24): Koordinate nur im Detailfeld, Namen nur im Saumraum
      if (!kompakt && !dicht && !LG) {   // SUND-01 C: in der Übersicht entfällt die Koordinate im Hex
        const kc = stil.koord || (hs.art === 'leer' ? COL.leerText : hs.art === 'erkundet' ? 'rgba(244,238,220,0.75)' : COL.grau);
        txt(ctx, h, p.x, p.y - h3 / 2 + 3, { color: kc, align: 'center', shadow: false });
      }
      if (hs.art === 'leer') {
        // U1 (Kai): ein Leerraum-Hex mit temporärem Sprungpunkt oder Marke (Notruf, Ziel) ist ein Ort, kein schwarzes Loch: Umriss und Name
        const rel = [...L.temp].some((id) => id.indexOf(h) >= 0) || marken.some((mk) => mk.h === h);
        if (rel) {
          ctx.save(); ctx.strokeStyle = 'rgba(169,214,229,0.75)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); hexPfad(ctx, p.x, p.y, s - 2); ctx.stroke(); ctx.restore();
          if (!kompakt && !dicht) txt(ctx, 'Leerraum', p.x, p.y + h3 / 2 - 13, { color: 'rgba(169,214,229,0.9)', align: 'center' });
        }
        continue;
      }
      if (hs.art === 'verborgen' || (hs.art === 'unerkundet' && !hs.nameBekannt && !lgHex) || (hs.s && hs.s.name === '?')) {
        txt(ctx, '?', p.x, p.y - 4, { color: COL.grau, align: 'center' });
        continue;
      }
      const sys = hs.s;
      const haupt = hauptIcon(sys);
      ctx.save();
      if (lgHex) { if (!A.hell(h)) ctx.globalAlpha = LG.F.dunkel.inhaltAlpha; }
      else if (hs.art === 'unerkundet') ctx.globalAlpha = 0.6;
      else if (hs.art === 'gesperrt') ctx.globalAlpha = 0.8;
      if (!lgBel) zeichneHexIcon(ctx, haupt, p.x, p.y - (kompakt ? 0 : 1), COL.text);
      if (!kompakt && !(dicht && hs.art === 'gesperrt')) {
        // weiteres Symbol (z. B. Schrein, Verbündete, Ziel) links neben dem Hauptsymbol
        const neben = (sys.symbole || []).map(x => (SYMBOL_ICON[x] || x)).find(x => x !== haupt && x !== 'heimat');
        const nebenOk = !(lgHex && s < LG.M.hexradius.nebenMin);   // SUND-01 F: kleine Hexe der Übersicht ohne Nebensymbole, die Hafenklasse steht auf Symbolhöhe
        if (neben && s >= 16 && nebenOk) zeichneHexIcon(ctx, neben, p.x - s * 0.62, p.y - 1, COL.text);
        if (sys.hafen && !lgBel) txt(ctx, String(sys.hafen), p.x + 8, p.y + (lgHex ? LG.M.plakette.anker.hafenDy : -11), { color: COL.text });
        if (sys.einfluss && (hs.art !== 'unerkundet' || lgHex) && s >= 16 && nebenOk) zeichneEinfluss(ctx, sys.einfluss, p.x + s * 0.62, p.y - 1);
        if (lgHex && A.hex[h] && A.hex[h].posten) LG.posten(ctx, p.x - s * 0.62, p.y - 1, A.hex[h].f);
      }
      ctx.restore();
      if (!kompakt && !(dicht && hs.art === 'gesperrt')) {
        const nm = kurzName(sys.name || h, 1.6 * s);
        txt(ctx, nm, p.x, p.y + h3 / 2 - (dicht ? 9 : 13), { color: lgHex ? (A.hell(h) ? COL.text : LG.F.dunkel.name) : (stil.name || (hs.art === 'erkundet' ? COL.text : COL.grau)), align: 'center' });
      }
    }

    // SUND-01 F: Nahansicht dunkelt die Hexe außerhalb des Ausschnitts VOR Plaketten, Marken und Lerche ab (Übersicht: keine Abdunklung, Spezifikation §8)
    if (LG && fokusSet && store.lageAnsicht === 'nah') {
      ctx.fillStyle = 'rgba(11,14,26,0.6)';
      for (const h of alle) if (!fokusSet.has(h)) { const p = mitte(h); hexPfad(ctx, p.x, p.y, s + 0.5); ctx.fill(); }
    }
    // SUND-01 C: Belagerung, Kurs, Vermutung und Plaketten der Flotten (über Hexinhalten, unter Lerche, Auswahl und Notrufen)
    if (LG) LG.flotten(ctx, A, V, { notrufHex: new Set(marken.filter((mk) => mk.t === 'notruf').map((mk) => mk.h)) });

    // 5) Markierungen (Stilblatt §2.3): eigene Position Hell-Ring + Lerche-Dreieck, Ziel Gold-Doppelring pulsierend
    const ring = (h, farbe, breite, strich, inset) => {
      if (!h) return;
      const p = mitte(h);
      ctx.save(); ctx.strokeStyle = farbe; ctx.lineWidth = breite; if (strich) ctx.setLineDash(strich);
      hexPfad(ctx, p.x, p.y, s - inset); ctx.stroke(); ctx.restore();
    };
    if (L.hier) {
      ring(L.hier, COL.text, 2, null, 2);
      // QA-B3 F5: Lerche-Dreieck rechts neben die Koordinate (verdeckte sonst deren letzte Ziffer)
      const p = mitte(L.hier), ty = p.y - h3 / 2 + 7, tx = LG ? p.x - 3 : Math.min(p.x + Math.ceil(mess(L.hier) / 2) + 2, p.x + s / 2 - 3);
      if (!(LG && LG.hatPlakette(A, L.hier))) {   // SUND-01 C: mit Plakette im Lerche-Hex entfällt das Dreieck (der helle Ring bleibt)
        ctx.fillStyle = COL.text; ctx.strokeStyle = COL.tisch; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tx + 6, ty); ctx.lineTo(tx, ty - 3); ctx.lineTo(tx, ty + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    if (L.ziel && L.ziel !== L.hier) {
      const pul = 0.6 + 0.4 * Math.abs(Math.sin(t * 3));
      ring(L.ziel, 'rgba(255,198,107,' + pul + ')', 2, null, 2);
      ring(L.ziel, 'rgba(255,198,107,' + pul + ')', 1, null, 5);
    }
    const fokus = hover || store.pick || selHex;
    if (selHex && selHex !== L.ziel) ring(selHex, COL.wahl, 1, null, 5);
    if (store.pick && store.pick !== selHex) ring(store.pick, COL.gesperrt, 1, [2, 2], 5);
    if (hover && hover !== selHex) ring(hover, 'rgba(244,238,220,0.6)', 1, null, 5);

    // SL1B: Marken (Missionsziele, Notrufe, Spuren, Funde, Kontakte). Ziel: gestrichelter Doppelring + Fähnchen, die übrigen: Plakette an der
    // oberen rechten Ecke des Hexes; mehrere Marken im selben Hex stehen nebeneinander. Notrufe zeigen ihre Restzeit als Bogen.
    {
      const nr = {};
      const pr = Math.max(LG ? LG.M.notruf.rMinLage : 5, Math.min(9, s * 0.2));   // SUND-01 F: in der Lage-Karte mindestens 6
      for (const mk of marken) {
        const M = KZ.MARKEN[mk.t] || KZ.MARKEN.fund;
        const p = mitte(mk.h);
        if (mk.t === 'ziel' && mk.h !== L.hier) {
          const pul = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.4));
          ctx.save(); ctx.globalAlpha = pul; ctx.strokeStyle = M.farbe; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
          hexPfad(ctx, p.x, p.y, s - 3.5); ctx.stroke(); ctx.restore();
        }
        const k = nr[mk.h] = (nr[mk.h] || 0) + 1;
        const px = p.x + s * 0.5 - (k - 1) * (pr * 2 + 1), py = p.y - h3 / 2 + pr + 2;
        KZ.marke(ctx, mk.t, px, py, t, { r: pr, hier: mk.h === L.hier, rest: mk.b, gesamt: mk.g || 0, deckend: !!LG });
      }
    }

    // Fokus-Ansicht: Hexe außerhalb des Ausschnitts blass (dahinter geht die Karte weiter)
    {
      const kn = String((K && K.name) || 'Karte').toUpperCase();
      if (fokusSet) {
        if (!LG) {
          ctx.fillStyle = 'rgba(11,14,26,0.6)';
          for (const h of alle) if (!fokusSet.has(h)) { const p = mitte(h); hexPfad(ctx, p.x, p.y, s + 0.5); ctx.fill(); }
        }
        if (!kompakt) txt(ctx, kn + (LG ? (store.lageAnsicht === 'nah' ? ' · NAHANSICHT' : ' · ÜBERSICHT') : ' · AUSSCHNITT'), gArea.x + 3, gArea.y + gArea.h - (LG ? 24 : 11), { color: 'rgba(201,151,74,0.8)' });
      } else if (!kompakt) txt(ctx, kn, gArea.x + 3, gArea.y + gArea.h - 11, { color: 'rgba(201,151,74,0.8)' });
    }

    // Plan-Pins (Planungstisch)
    if (opts.pins !== false) for (const pin of (st.plan && st.plan.pins) || []) {
      if (pin.map !== 'star') continue;
      const q = toS(pin.x, pin.y);
      Rd.drawPin(ctx, pin, q.x, q.y, st, { highlight: opts.highlightPin === pin.id });
    }

    ctx.restore();   // Kartenbereich
    if (seite) { ctx.strokeStyle = 'rgba(201,151,74,0.5)'; ctx.beginPath(); ctx.moveTo(gArea.x + gArea.w + 0.5, rect.y + 2); ctx.lineTo(gArea.x + gArea.w + 0.5, rect.y + rect.h - 2); ctx.stroke(); }

    // 6) Details: Seitenleiste oder Schild
    const zeilen = details(P, L, fokus, weg && weg[weg.length - 1] === fokus ? weg : route(P, L, L.hier, fokus), marken);
    if (seite) {
      const sx = gArea.x + gArea.w + 5, sw = rect.x + rect.w - sx - 4;
      let y = rect.y + 4;
      for (const z of zeilen) {
        for (const l of Rd.wrap(z.t, sw, 1).slice(0, z.max || 3)) { if (y > rect.y + rect.h - 52) break; txt(ctx, l, sx, y, { color: z.c }); y += 10; }
        y += z.gap || 0;
      }
      legende(ctx, sx, rect.y + rect.h - 46, sw);
    } else if (fokus && hover && !(LG && opts.ansichtKey === 'captain-stern')) {   // SUND-01 C: nur die Captain-Konsole hat die Spalte mit der Ortsinfo, sonst bleibt das Schild
      const sw = Math.min(180, rect.w - 8);
      const ls = [];
      for (const z of zeilen.slice(0, 5)) for (const l of Rd.wrap(z.t, sw - 8, 1).slice(0, z.max || 2)) ls.push({ l, c: z.c });   // F5: z.max achten (Leerraum 3 Zeilen)
      const p = mitte(fokus);
      const bh = ls.length * 10 + 6;
      const bx = Math.max(rect.x + 2, Math.min(rect.x + rect.w - sw - 2, p.x - sw / 2));
      const by = p.y + s + bh < rect.y + rect.h ? p.y + s * 0.6 : p.y - s * 0.6 - bh;
      ctx.fillStyle = 'rgba(11,14,26,0.92)'; ctx.fillRect(bx, by, sw, bh);
      ctx.strokeStyle = COL.messing; ctx.strokeRect(bx + 0.5, by + 0.5, sw - 1, bh - 1);
      ls.forEach((z, i) => txt(ctx, z.l, bx + 4, by + 3 + i * 10, { color: z.c }));
    }
    if (ab) KA.knopf(ctx, R(), ansichtKey, gArea);   // TB1: Ansicht zurücksetzen (nur wenn gezoomt/verschoben)
    ctx.restore();
    ctx.strokeStyle = COL.messing; ctx.lineWidth = 1; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    if (LG) { store.hoverHex = hover; store.lageModell = { A, adj: lageAdj(P), hier: L.hier, hexe: Object.keys(K.hexe) }; } else { store.hoverHex = null; store.lageModell = null; }   // SUND-01 C: für die Spalte der Konsole
    if (opts.rects) opts.rects.length = 0;   // Treffer laufen über StarMap.hit
    return { toS, toW, scale: s, mitte, layout: { rect: gArea, gx, gy, s, h3, alle, mitte, ansicht, area: gArea } };
  }

  // Textzeilen zum Fokus-Hex
  function markenZeilen(P, L, marken, nurHex) {
    const out = [];
    for (const mk of marken) {
      if (nurHex && mk.h !== nurHex) continue;
      const M = KZ.MARKEN[mk.t] || KZ.MARKEN.fund;
      const rest = mk.b != null ? ' · noch ' + Math.ceil(mk.b / 60) + ' min' : '';
      out.push({ t: KZ.markeText(mk.t, nurHex ? '' : hexName(P, L, mk.h, false) + ' ' + mk.h) + rest, c: M.farbe, max: 2 });
    }
    return out;
  }
  function details(P, L, h, weg, marken) {
    const out = [];
    if (!h) {
      out.push({ t: String((P.K && P.K.name) || 'Karte').toUpperCase(), c: COL.messing, gap: 2 }, { t: 'Hex überfahren oder anklicken.', c: COL.grau, gap: 3 });
      const ml = markenZeilen(P, L, marken || [], null);
      if (ml.length) { out.push({ t: 'MARKEN', c: COL.messing }); for (const z of ml) out.push(z); }
      return out;
    }
    const hs = hexStatus(P, L, h), s = hs.s;
    out.push({ t: 'SEKTOR ' + h, c: COL.messing });
    for (const z of markenZeilen(P, L, marken || [], h)) out.push(z);
    out.push({ t: hexName(P, L, h, true), c: hs.art === 'erkundet' ? COL.aktiv : COL.text, max: 2 });
    if (hs.art === 'leer') {
      out.push({ t: 'Leerraum – Barriere. Nur über temporäre Sprungpunkte oder Notfallsprung.', c: COL.grau, max: 4, gap: 2 });   // QA-B3 F5: 4 Zeilen, sonst fehlt „Notfallsprung“
    } else if (hs.art === 'verborgen') {
      out.push({ t: 'Unbekannt.', c: COL.grau });
    } else {
      const f = FRAKTION[s.fraktion];
      const kopf = [f ? f.name : s.fraktion, s.hafen ? 'Hafen ' + s.hafen : null].filter(Boolean).join(' · ');
      if (kopf) out.push({ t: kopf, c: COL.text });
      if (s.art && (hs.art !== 'unerkundet' || hs.nameBekannt)) out.push({ t: s.art, c: COL.grau, max: 2 });
      const extra = [];
      if (s.einfluss) extra.push('Einfluss: ' + (EINFLUSS[s.einfluss] || s.einfluss));
      const sym = (s.symbole || []).map(x => SYMBOL_NAME[x]).filter(Boolean);
      if (sym.length) extra.push(sym.join(', '));
      if (extra.length) out.push({ t: extra.join(' · '), c: COL.temporaer, max: 2 });
      out[out.length - 1].gap = 2;
    }
    const grund = sperrGrund(P, L, h);
    if (h === L.hier) out.push({ t: 'HIER', c: COL.hier });
    if (h === L.ziel && h !== L.hier) out.push({ t: 'SPRUNGZIEL' + (L.jump.d != null && L.pflicht ? ' · Sprungpunkt ' + L.jump.d + ' m' : ''), c: COL.ziel, max: 2 });   // F4
    if (grund) out.push({ t: 'GESPERRT: ' + grund, c: COL.gesperrt, max: 4 });
    else if (hs.art === 'unerkundet') out.push({ t: 'Unerkundet – anfliegen und nachsehen.', c: COL.grau, max: 2 });
    if (!grund && h !== L.hier) {
      if (weg && weg.length > 1) out.push({ t: 'Route: ' + (weg.length - 1) + (weg.length === 2 ? ' Sprung' : ' Sprünge'), c: COL.route });
      else if (hs.art !== 'leer' || P.K.hexe[h] === undefined) {
        // Nachbar mit gesperrter Kante?
        const e = L.hier && P.kanteById[kanteId(L.hier, h)];
        if (e && kanteBekannt(P, L, e) === true && kantenZustand(P, L, e) === 'gesperrt') out.push({ t: 'Sprungpunkt gesperrt.', c: COL.gesperrt });
        else out.push({ t: 'Keine bekannte Route.', c: COL.grau });
      }
    }
    return out;
  }
  function legende(ctx, x, y, w) {
    const reihe = [['aktiv', 'aktiv'], ['gesperrt', 'gesperrt'], ['temporaer', 'temporär'], ['ohne_strom', w < 150 ? 'stromlos' : 'ohne Strom']];
    txt(ctx, 'BOJEN', x, y, { color: COL.messing }); y += 10;
    reihe.forEach(([z, n], i) => {
      const cx = x + (i % 2) * Math.floor(w / 2), cy = y + Math.floor(i / 2) * 11;
      zeichneBoje(ctx, z, cx + 4, cy + 4, 7, 0);
      txt(ctx, n, cx + 11, cy, { color: COL.grau });
    });
    y += 23;
    ctx.fillStyle = COL.fern; ctx.fillRect(x + 1, y + 3, 6, 1);
    txt(ctx, 'Fernsprung', x + 11, y, { color: COL.grau });
  }

  // QA-B3 F4 / B3-NACH: gilt die Anflugpflicht? Der Server schickt sie als ship.jump.anflug (sprung.anflugPflicht, immer im
  // Snapshot). Fehlt das Feld (Snapshot noch ohne ship), keine Anflug-Hinweise.
  function anflugPflicht(st) {
    const j = (st && st.ship && st.ship.jump) || {};
    return j.anflug === true;
  }

  // ------------------------------------------------------------------ Raumszene: Bojen aus space.jp
  function zeichneSzene(ctx, cam, st) {
    const jp = st && st.space && st.space.jp;
    if (!jp || !jp.length || !cam || typeof cam.toS !== 'function') return;
    const K = karte(), P = K ? prep(K) : null;
    const L = P ? lage(st, P) : null;
    const jump = (st.ship && st.ship.jump) || {};
    const zielHex = P ? hexVon(P, jump.dest) : null;
    const zoom = cam.zoom || 0.35;
    const CFGs = (window.Shared_Config && window.Shared_Config.sektoren) || {};
    const radius = CFGs.sprungpunktRadius || 250;
    const t = (performance.now() / 1000);
    const pflicht = anflugPflicht(st);   // F4: Ring, Abstand und Randpfeil nur, wenn die Boje angeflogen werden muss
    // Hindernisse für die Beschriftung: Peilstrich-Label „200“ der Frontsicht (render.js: cx + 3, cy − 200·zoom − 2)
    const hinder = [];
    if (cam.front && st.ship && st.ship.x != null) {
      const c0 = cam.toS(st.ship.x, st.ship.y);
      hinder.push({ x: c0.x - 4, y: Math.round(c0.y - 200 * zoom) - 6, w: 30, h: 14 });
    }
    // QA-B3 F1/F5: Bildausschnitt (cam.bound) – Randpfeil zur Ziel-Boje außerhalb, Labels im Rahmen halten
    const B = cam.bound || null;
    const rand = cam.front ? 6 : 4;
    const drin = (q, m) => (typeof cam.inB === 'function' ? cam.inB(q, m) : !B || (q.x >= B.x - m && q.y >= B.y - m && q.x <= B.x + B.w + m && q.y <= B.y + B.h + m));
    for (const b of jp) {
      if (!b || b.x == null || b.y == null) continue;
      const p = cam.toS(b.x, b.y);
      const z = b.z || 'aktiv';
      const gewaehlt = (jump.jp && jump.jp === b.k) || (zielHex && b.n === zielHex);
      const f = ZUSTAND_FARBE[z] || COL.aktiv;
      if (!drin(p, 0)) {
        // F1: Ziel-Boje außerhalb des Bildes -> Randpfeil wie Stationen (Name + Abstand)
        if (gewaehlt && pflicht && typeof cam.arrow === 'function') {
          let kurz = b.n || '';
          if (P && b.n) { const nm = hexName(P, L, b.n, false); kurz = nm === '?' || nm === 'Unbekanntes System' || nm === 'Leer' ? b.n : nm; }
          const d = st.ship && st.ship.x != null ? Math.round(Math.hypot(b.x - st.ship.x, b.y - st.ship.y)) : jump.d;
          const text = 'SPRUNG ' + kurz + (d != null ? ' ' + d : '');
          // Frontsicht „hinter uns“, Stapeln neben HAFEN/DOCK: macht render.js arrow() (B3-NACH)
          cam.arrow(b.x, b.y, f, text);
        }
        // Ring/Icon ragen evtl. noch ins Bild: zeichnen, Beschriftung aber nur, wenn die Boje im Bild liegt
        if (!drin(p, Math.max(40, (gewaehlt && pflicht ? radius : 100) * zoom))) continue;
      }
      if (gewaehlt && pflicht) {
        // Radius-Ring (sprungpunktRadius), Zustandsfarbe, 1 px, Strich 4/6 (Stilblatt §4)
        ctx.save();
        ctx.strokeStyle = f; ctx.lineWidth = 1; ctx.setLineDash([4, 6]); ctx.lineDashOffset = -((t * 8) % 10);
        ctx.beginPath(); ctx.arc(p.x, p.y, radius * zoom, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // Richtung zum Zielhex: Shared_Sektoren.winkel(richtung) wenn geladen, sonst vom Szenenmittelpunkt nach außen
      const sp = st.space || {};
      const SS = window.Shared_Sektoren;
      let w = sp.w ? Math.atan2(b.y - sp.h / 2, b.x - sp.w / 2) : 0;
      if (SS && typeof SS.richtung === 'function' && typeof SS.winkel === 'function' && L && L.hier && b.n) {
        try { const r = SS.richtung(L.hier, b.n); if (r != null && r >= 0) w = SS.winkel(r); } catch (e) { /* Ersatzwinkel */ }
      }
      let gr;
      const IB = window.IconsB;
      if (IB && typeof IB.boje === 'function' && IB.boje(ctx, z, p.x, p.y, zoom, w, { t, ziel: !!gewaehlt }) !== false) gr = Math.max(26, 96 * zoom);
      else { gr = Math.max(12, Math.min(28, Math.round(90 * zoom))); zeichneBojeErsatz(ctx, z, p.x, p.y, gr); }
      let name = b.n || '';
      if (P && b.n) {
        const nm = hexName(P, L, b.n, true);
        name = nm === '?' || nm === 'Unbekanntes System' ? 'Sektor ' + b.n : nm;
        // U1 (Kai): ein temporärer Sprungpunkt oder ein Missionsziel führt nicht ins Namenlose: der Ortsname der Marke bzw. des Kapitels gilt
        const hx = P.K.hexe[b.n];
        if (name === 'Sektor ' + b.n && hx && hx.name && hx.name !== '?' && (z === 'temporaer' || (store.marken || []).some((mk) => mk && mk.h === b.n))) name = hx.name + ' ' + b.n;
      }
      // Beschriftung unter der Boje (sonst darüber), knapp gehalten: voller Text nur beim gewählten Ziel. Bis render.js
      // die Label-Kollision (lab) im Hook reicht, weicht sie hier selbst aus: der „200“-Peilstrich der Frontsicht und
      // die eigenen Bojen-Labels sind Hindernisse.
      const zeilen = gewaehlt
        ? [['SPRUNGPUNKT → ' + name, COL.text], [z !== 'aktiv' ? (ZUSTAND_NAME[z] || z).toUpperCase() : 'ZIEL' + (pflicht && jump.d != null ? ' · ' + jump.d + ' m' : ''), f]]
        : [['→ ' + name + (z !== 'aktiv' ? ' · ' + (ZUSTAND_NAME[z] || z) : ''), z !== 'aktiv' ? f : 'rgba(244,238,220,0.8)']];
      if (!drin(p, 0)) continue;   // Boje außerhalb: kein Label (Ziel hat den Randpfeil)
      const lw = Math.max(...zeilen.map(q => mess(q[0]))) + 4, lh = zeilen.length * 10;
      // F5: Label-Mitte in den Rahmen schieben (nicht ins Nachbarpanel ragen, nicht am Rand gekappt)
      const lx = B ? Math.max(B.x + rand + lw / 2, Math.min(B.x + B.w - rand - lw / 2, p.x)) : p.x;
      const klemmY = (y0) => B ? Math.max(B.y + 2, Math.min(B.y + B.h - lh - 1, y0)) : y0;
      const unten = klemmY(p.y + gr / 2 + 5), oben = klemmY(p.y - gr / 2 - 5 - lh);
      const kollidiert = (y0) => hinder.some(r => lx - lw / 2 < r.x + r.w && lx + lw / 2 > r.x && y0 < r.y + r.h && y0 + lh > r.y);
      const ly = !kollidiert(unten) ? unten : !kollidiert(oben) ? oben : unten;
      hinder.push({ x: lx - lw / 2, y: ly, w: lw, h: lh });
      if (typeof cam.block === 'function') cam.block(lx - lw / 2, ly, lw, lh);   // Labels von render.js weichen aus
      zeilen.forEach((q, i) => txt(ctx, q[0], lx, ly + i * 10, { color: q[1], align: 'center' }));
    }
  }

  // ------------------------------------------------------------------ Treffer
  function treffer(x, y, rects) {
    const K = karte();
    if (!K) return null;
    let lay = null;
    for (const l of store.layouts) if ((!rects || l.rects === rects) && x >= l.rect.x && y >= l.rect.y && x < l.rect.x + l.rect.w && y < l.rect.y + l.rect.h) { lay = l; break; }
    if (!lay || !lay.hex) return null;
    // TB1: nur Klicks im Kartenbereich (gezoomt ragen Hexe unter die Seitenleiste; dort gilt kein Treffer)
    if (lay.area && (x < lay.area.x || y < lay.area.y || x >= lay.area.x + lay.area.w || y >= lay.area.y + lay.area.h)) return null;
    let best = null, bd = lay.s * 0.92;
    for (const h of lay.alle) { const p = lay.mitte(h); const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = h; } }
    if (!best) return null;
    const P = prep(K);
    const st = lay.state;
    const L = lage(st, P);
    const ort = P.ortVonHex[best];
    // wählbar: Ort in der Ortsliste (wie bisher) bzw. Leerraum über eine temporäre Kante
    if (ort && L.locs[ort] && hexStatus(P, L, best).art !== 'gesperrt') { store.pick = null; return { id: ort, hex: best }; }
    if (!K.hexe[best] && L.hier && L.temp.has(kanteId(L.hier, best))) { store.pick = null; return { id: 'leer-' + best, hex: best }; }
    // sonst nur merken (Seitenleiste zeigt Begründung); null -> Konsole macht weiter wie bisher
    store.pick = best;
    return null;
  }

  // ------------------------------------------------------------------ Öffentliche API
  window.StarMap = {
    stub: false,
    setKarte,
    // optional für Tests/Client: Erkundungsstand { e, b, t, o, v } setzen
    setSektoren(s) { store.sektoren = s || null; },
    // Ansicht der Sternkarte: 'fokus' (Standard, groß) | 'gesamt' (ganze Karte); alte Namen 'saumraum' und 'limes' werden übersetzt.
    // Taste bindet CLIENT (consoles.js).
    setAnsicht(a) { store.ansicht = normAnsicht(a); return store.ansicht; },
    toggleAnsicht() {
      if (store.lage && window.KarteLage) { store.lageAnsicht = store.lageAnsicht === 'nah' ? 'uebersicht' : 'nah'; return store.lageAnsicht; }   // SUND-01 C: Übersicht <-> Nahansicht (Lerche + 2 Sprünge)
      store.ansicht = store.ansicht === 'gesamt' ? 'fokus' : 'gesamt'; return store.ansicht;
    },
    // SUND-01 C: Übersichtskarte nach dem Wissen von Rom aktiv (world.lage da)? Modell der zuletzt gezeichneten Karte, Hex unter der Maus
    lageAktiv() { return !store.aus && !!store.lage && !!window.KarteLage && !!karte(); },
    get lageAnsicht() { return store.lageAnsicht; },
    lageModell() { return store.lageModell; },
    get hoverHex() { return store.hoverHex; },

    get ansicht() { return store.ansicht; },
    // SL1B: Marken aus dem Snapshot (world.marken) [{ h, t, id?, s?, b?, g? }]; für Konsolen und den Sektorplan (SL4)
    get marken() { return (store.marken || []).slice(); },
    setMarken(m) { store.marken = Array.isArray(m) ? m : []; },
    get karte() { return karte(); },
    get aktiv() { return !store.aus && !!karte(); },
    // QA-B3 F4: (state) -> true, wenn die Sprungpunkt-Boje angeflogen werden muss (freies Spiel); Tutorial: false
    anflugPflicht(st) { try { return anflugPflicht(st); } catch (e) { return false; } },   // W1 AP2: Rückfall einheitlich false
    // (ctx, view, rect, opts) -> { toS, toW, scale } wie bisher drawStarMap; opts.kompakt für den HUD-Ausschnitt
    draw(ctx, view, rect, opts) {
      opts = opts || {};
      const Rd = R();
      if (store.aus || !karte()) { markAlt(opts.rects); return Rd.drawStarMapAlt(ctx, view, rect, opts); }
      ctx.save();
      try {
        const res = zeichne(ctx, view, rect, opts);
        ctx.restore();
        merk(opts.rects, rect, res.layout, view.state);
        return { toS: res.toS, toW: res.toW, scale: res.scale };
      } catch (e) {
        ctx.restore();
        store.fehler++;
        if (store.fehler >= MAX_FEHLER) store.aus = true;
        report('StarMap.draw', e);
        markAlt(opts.rects);
        return Rd.drawStarMapAlt(ctx, view, rect, opts);
      }
    },
    // (ctx, cam { toS, zoom, front }, state) – Bojen der Raumszene
    drawSzene(ctx, cam, st) {
      if (store.aus) return;
      ctx.save();
      try { zeichneSzene(ctx, cam, st); } catch (e) { store.fehler++; if (store.fehler >= MAX_FEHLER) store.aus = true; report('StarMap.drawSzene', e); }
      ctx.restore();
    },
    // (x, y, rects) -> { id, hex } | null (null: bisherige Trefferliste der Konsole)
    hit(x, y, rects) {
      if (store.aus) return null;
      try { return treffer(x, y, rects); } catch (e) { report('StarMap.hit', e); return null; }
    },
    // Für Tests: Hexmitte in Bildschirmkoordinaten der zuletzt gezeichneten Karte
    hexMitte(hex, rects) {
      const l = store.layouts.find(q => q.hex && (!rects || q.rects === rects)) || null;
      return l ? l.mitte(hex) : null;
    },
  };
  function merk(rects, rect, layout, state) {
    const key = rects || null;
    let l = store.layouts.find(q => q.rects === key);
    if (!l) { l = { rects: key }; store.layouts.push(l); if (store.layouts.length > 6) store.layouts.shift(); }
    Object.assign(l, { rect, hex: true, s: layout.s, alle: layout.alle, mitte: layout.mitte, state, area: layout.area });
  }
  function markAlt(rects) {
    const l = store.layouts.find(q => q.rects === (rects || null));
    if (l) l.hex = false;
  }
})();
