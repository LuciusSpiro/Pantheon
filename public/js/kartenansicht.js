// TB1: Zoom und Verschieben (Pan) für Kartenansichten der Konsolen – Sternkarte (Captain, Planungstisch), Detailkarten des Planungstischs,
// Sektorplan. Globales `KartenAnsicht`. Reine Client-Ansicht: lokal je Spieler, nie im Snapshot, nie im Weltstand.
//
// Ablauf: Die Zeichenfunktion rechnet ihr Standardlayout wie bisher und ruft anwenden(key, rect, inhalt) auf. rect = sichtbarer Kartenbereich,
// inhalt = Kasten der Karte im Standardlayout (Bildschirmkoordinaten). Zurück kommt die Abbildung { z, px, py, x(v), y(v) }:
// bildschirm = Mitte + (standard − Mitte) · z + Pan. Weil die Karte selbst mit dieser Abbildung gezeichnet wird, stimmen toS/toW und
// die Trefferprüfung automatisch mit Zoom und Pan.
// Eingabe (client.js): Mausrad = Zoom um den Mauszeiger, linke Maustaste ziehen = Pan, Klick ohne Ziehen = der bisherige Klick (wird erst
// beim Loslassen ausgeführt), Taste 0 / Pos1 = zurücksetzen, +/− = Zoom um die Kartenmitte. Gilt nur für Karten, die in den letzten
// 300 ms gezeichnet wurden (Region wird je Frame neu gemeldet).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KartenAnsicht = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const ZMIN = 1, ZMAX = 8;
  const SCHWELLE = 4;      // Bildschirmpunkte, ab denen ein Klick zum Ziehen wird
  const FRIST = 300;       // ms: so lange gilt eine gezeichnete Karte als sichtbar
  const RAND = 40;         // bei großer Karte bleibt mindestens so viel Karte im Bild (Pan nicht ins Leere)
  const ansichten = {};    // key -> { z, px, py }
  const regionen = {};     // key -> { key, rect, inhalt, t }
  let zug = null;          // laufendes Ziehen { key, x0, y0, px0, py0, bewegt, klick }

  const jetzt = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const hol = (key) => ansichten[key] || (ansichten[key] = { z: 1, px: 0, py: 0 });
  const unveraendert = (a) => a.z <= 1.0001 && Math.abs(a.px) < 0.5 && Math.abs(a.py) < 0.5;
  const frisch = () => { const t = jetzt(); return Object.keys(regionen).map((k) => regionen[k]).filter((r) => t - r.t <= FRIST); };

  function achse(lo, len, vlo, vlen, p) {
    const m = Math.min(RAND, vlen / 4);
    let mn, mx;
    if (len <= vlen) { mn = vlo - lo; mx = vlo + vlen - (lo + len); }          // Karte passt: ganz im Bild halten
    else { mn = vlo + vlen - m - (lo + len); mx = vlo + m - lo; }              // Karte größer: Rand darf nicht ins Bild wandern
    return Math.max(mn, Math.min(mx, p));
  }
  function klemme(a, rect, inhalt) {
    a.z = Math.max(ZMIN, Math.min(ZMAX, a.z));
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    a.px = achse(cx + (inhalt.x - cx) * a.z, inhalt.w * a.z, rect.x, rect.w, a.px);
    a.py = achse(cy + (inhalt.y - cy) * a.z, inhalt.h * a.z, rect.y, rect.h, a.py);
  }

  // Abbildung für diesen Frame; meldet die Karte als sichtbare Region (für Rad, Ziehen, Tasten)
  function anwenden(key, rect, inhalt) {
    const a = hol(key);
    klemme(a, rect, inhalt);
    regionen[key] = { key, rect, inhalt, t: jetzt() };
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, z = a.z, px = a.px, py = a.py;
    return { z, px, py, cx, cy, x: (v) => cx + (v - cx) * z + px, y: (v) => cy + (v - cy) * z + py, geaendert: !unveraendert(a) };
  }
  function bereichBei(x, y) {
    let best = null;
    for (const r of frisch()) if (x >= r.rect.x && y >= r.rect.y && x < r.rect.x + r.rect.w && y < r.rect.y + r.rect.h) best = r;
    return best;
  }

  function zoomUm(r, mx, my, faktor) {
    const a = hol(r.key);
    const z1 = Math.max(ZMIN, Math.min(ZMAX, a.z * faktor));
    if (z1 === a.z) return false;
    const cx = r.rect.x + r.rect.w / 2, cy = r.rect.y + r.rect.h / 2, f = z1 / a.z;
    a.px = mx - cx - (mx - a.px - cx) * f;     // Punkt unter dem Zeiger bleibt stehen
    a.py = my - cy - (my - a.py - cy) * f;
    a.z = z1;
    if (a.z <= 1.0001) { a.z = 1; a.px = 0; a.py = 0; }
    klemme(a, r.rect, r.inhalt);
    return true;
  }
  // Mausrad auf der Karte: true, wenn verbraucht (dann preventDefault)
  function rad(x, y, deltaY) {
    const r = bereichBei(x, y);
    if (!r) return false;
    zoomUm(r, x, y, Math.exp(-Math.max(-300, Math.min(300, deltaY)) * 0.002));
    return true;
  }
  // Tasten: +/− Zoom um die Kartenmitte
  function zoomTaste(richtung) {
    const rs = frisch();
    if (!rs.length) return false;
    for (const r of rs) zoomUm(r, r.rect.x + r.rect.w / 2, r.rect.y + r.rect.h / 2, richtung > 0 ? 1.25 : 0.8);
    return true;
  }
  function zuruecksetzen(key) { const a = ansichten[key]; if (a) { a.z = 1; a.px = 0; a.py = 0; } }
  function zuruecksetzenAktiv() {
    const rs = frisch();
    for (const r of rs) zuruecksetzen(r.key);
    return rs.length > 0;
  }

  // Maustaste links: auf einer Karte beginnt ein möglicher Zug; der Klick (klick-Funktion) läuft erst beim Loslassen, wenn nicht gezogen wurde
  function druecken(x, y, klick) {
    const r = bereichBei(x, y);
    if (!r) return false;
    const a = hol(r.key);
    zug = { key: r.key, x0: x, y0: y, px0: a.px, py0: a.py, bewegt: false, klick };
    return true;
  }
  function bewegen(x, y) {
    if (!zug) return false;
    const dx = x - zug.x0, dy = y - zug.y0;
    if (!zug.bewegt && Math.hypot(dx, dy) < SCHWELLE) return false;
    zug.bewegt = true;
    const a = hol(zug.key);
    a.px = zug.px0 + dx; a.py = zug.py0 + dy;
    const r = regionen[zug.key];
    if (r) klemme(a, r.rect, r.inhalt);
    return true;
  }
  function loslassen() {
    const z = zug; zug = null;
    if (z && !z.bewegt && typeof z.klick === 'function') z.klick();
    return !!z;
  }
  function abbrechen() { zug = null; }

  // Knopf „Ansicht zurücksetzen“ in der Ecke des Kartenbereichs, nur wenn gezoomt/verschoben (R = window.Render)
  function knopf(ctx, R, key, rect) {
    const a = ansichten[key];
    if (!a || unveraendert(a) || !R || typeof R.button !== 'function') return;
    const label = Math.round(a.z * 100) + ' % · zurück';
    const w = Math.min(rect.w - 4, 92);
    R.button(ctx, rect.x + rect.w - w - 2, rect.y + 2, w, 13, label, { hotkey: '0', onClick: () => zuruecksetzen(key) });
  }

  return {
    anwenden, bereichBei, rad, zoomTaste, zuruecksetzen, zuruecksetzenAktiv, druecken, bewegen, loslassen, abbrechen, knopf,
    get zieht() { return !!(zug && zug.bewegt); },
    get(key) { const a = hol(key); return { z: a.z, px: a.px, py: a.py }; },
    GRENZEN: { min: ZMIN, max: ZMAX },
  };
});
