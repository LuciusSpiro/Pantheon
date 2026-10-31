// EK1b: Schildmodell der Gegner mit variablen Segmenten (UMD: window.Shared_Schilde / require). Server (Trefferzuordnung, Regeneration,
// Pilot-KI) und Client (Ziel-Scan, Ops-Anzeige) benutzen dieselbe Zuordnung.
//
// Modell: Ein Gegner hat vier SEITEN (Bug 0, Steuerbord 1, Heck 2, Backbord 3 – wie Physics.sectorOf und die Sektoren der Lerche). Jede Seite
// besteht aus einem oder mehreren SEGMENTEN, die der Länge nach hintereinander liegen (Index 0 = vorderster Seitenbereich). Die Schildwerte aller
// Segmente stehen flach in e.shields, Reihenfolge: Bug, Steuerbord (vorn -> hinten), Heck, Backbord (vorn -> hinten). Eine Klasse mit je einem Segment
// pro Seite (Jäger, Korvette, Wächter, Pylon) ist damit der Spezialfall [Bug, Steuerbord, Heck, Backbord] wie bisher – derselbe Index.
//
// Zuordnung eines Treffers: Die Seite folgt wie bisher aus dem Winkel des Treffers zur Schiffsachse (Physics.sectorOf, Viertelkreise). Bei den
// Seitenbereichen ersetzt die Längsachse den Winkel: Der Strahl vom Schiffsmittelpunkt zur Treffer-Quelle wird mit dem Quadrat des Seitensektors
// geschnitten (Bug-Ecke bei 45 Grad, Heck-Ecke bei 135 Grad); die Lage des Schnittpunkts entlang der Schiffslänge ergibt u (0 = Bug, 1 = Heck) und
// damit das Segment, dessen Längsintervall [i/n, (i+1)/n) getroffen wurde. Keine Winkelschwellen pro Klasse: n kommt allein aus der Config.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Schilde = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SEITEN = ['bug', 'stbd', 'heck', 'bb'];
  const Q = Math.PI / 4;

  function norm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  // Aufbau der Schilde einer Klasse aus der Config: { max: [...], segs: [{ seite, i, n, von, bis }], seiten: [[Index...] × 4], n } oder null
  // (Klasse ohne Schilde-Eintrag). Eigener Eintrag enemySchildSegmente, sonst enemyShields [Bug, Steuerbord, Heck, Backbord].
  function layout(C, kind) {
    if (!C) return null;
    const seg = C.enemySchildSegmente && C.enemySchildSegmente[kind];
    let per = null;
    if (seg) per = [seg.bug || [], seg.stbd || [], seg.heck || [], seg.bb || []];
    else if (C.enemyShields && C.enemyShields[kind]) per = C.enemyShields[kind].map((v) => [v]);
    if (!per) return null;
    const max = [], segs = [], seiten = [[], [], [], []];
    per.forEach((arr, seite) => {
      arr.forEach((v, i) => {
        seiten[seite].push(max.length);
        segs.push({ seite, i, n: arr.length, von: i / arr.length, bis: (i + 1) / arr.length });
        max.push(+v || 0);
      });
    });
    return { max, segs, seiten, n: max.length };
  }

  // Seite (0–3) und Längsanteil u (0 = Bug … 1 = Heck; bei Bug/Heck 0) für einen Winkel rel zur Schiffsachse (Bug = 0, Steuerbord positiv)
  function seiteUndLaenge(rel) {
    rel = norm(rel);
    if (Math.abs(rel) <= Q) return { seite: 0, u: 0 };
    if (Math.abs(rel) > 3 * Q) return { seite: 2, u: 0 };
    const s = Math.abs(Math.sin(rel)) || 1;
    const r = Math.max(-1, Math.min(1, Math.cos(rel) / s));
    return { seite: rel > 0 ? 1 : 3, u: 0.5 - 0.5 * r };
  }
  // Index des getroffenen Segments (in e.shields) für einen Winkel rel
  function segmentAt(lay, rel) {
    const su = seiteUndLaenge(rel);
    const list = lay.seiten[su.seite];
    if (!list.length) return -1;
    return list[Math.min(list.length - 1, Math.floor(su.u * list.length))];
  }
  // Index des getroffenen Segments für eine Quelle (px, py) bei einem Schiff (x, y, angle)
  function segmentOf(lay, x, y, angle, px, py) { return segmentAt(lay, Math.atan2(py - y, px - x) - angle); }
  // Winkel (relativ zur Schiffsachse) der Längslage u auf einer Seitenseite (1 oder 3): Umkehrung der Zuordnung, für die Anzeige der Segmentgrenzen
  function winkelBei(seite, u) {
    const a = Math.atan2(1, 1 - 2 * u);
    return seite === 3 ? -a : a;
  }
  // Schildwert des stärksten bzw. aller Segmente einer Seite
  function seitenMax(lay, vals, seite) { let m = 0; for (const i of lay.seiten[seite]) m = Math.max(m, +vals[i] || 0); return m; }
  function seitenSumme(lay, vals, seite) { let m = 0; for (const i of lay.seiten[seite]) m += +vals[i] || 0; return m; }

  // Leser-Standard (Snapshot „fehlt = Standard“): fehlt shieldsMax, gilt der Aufbau der Klasse; fehlt shields, gilt voll; Waffenplätze mit Namen
  // (platz, typ) bekommen facing/arc/range aus enemyWeapons[kind]. Ändert e, gibt e zurück.
  function fuellen(e, C) {
    if (!e) return e;
    if (!e.shieldsMax) {
      const lay = layout(C, e.kind);
      if (lay) e.shieldsMax = lay.max;
    }
    if (!e.shields && e.shieldsMax) e.shields = e.shieldsMax.slice();
    if (Array.isArray(e.weapons) && e.weapons.length && e.weapons[0].platz && e.weapons[0].facing == null && C && C.enemyWeapons && C.enemyWeapons[e.kind]) {
      const W = C.enemyWeapons[e.kind];
      e.weapons = e.weapons.map((w) => Object.assign({}, W.find((q) => q.platz === w.platz) || {}, w));
    }
    return e;
  }

  // ---------- Regenerationspause (SYS-03 C1) ----------
  // Ein Schild regeneriert erst, wenn auf DEN Sektor (Lerche) bzw. das Segment/die Seite (Gegner, Verbündete: C2) `shields.regenDelay` s lang kein Treffer ankam.
  // Je Index ein Zeitstempel „Pause bis“ am Körper (Lerche: ship.shields, Gegner: das Schiffsobjekt), nicht aufzählbar: weder im Snapshot noch im Weltstand.
  // idx = Sektorindex der Lerche (0–3) oder Segmentindex des Gegners (flach wie e.shields); idx darf auch eine Liste sein (z. B. layout().seiten[seite]: die Pause gilt dann für die ganze Seite).
  // Jeder Treffer auf den Sektor stempelt (auch bei Schild 0, Durchschlag, Torpedo, Mine, Sturm, Streu, Dauerdruck): nur `treffer`/`trefferSturm` aufrufen, nie Zeitstempel von Hand setzen.
  const PAUSE_FELD = 'schildPause';
  function pauseFeld(k) {
    if (!Array.isArray(k[PAUSE_FELD])) Object.defineProperty(k, PAUSE_FELD, { value: [], writable: true, enumerable: false, configurable: true });
    return k[PAUSE_FELD];
  }
  function zahl(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
  function pauseDelay(C) { return Math.max(0, zahl(C && C.shields && C.shields.regenDelay, 0)); }
  function pauseSturm(C) { return Math.max(0, zahl(C && C.systemModell && C.systemModell.sturm && C.systemModell.sturm.regenSperre_s, 0)); }
  function stempeln(k, idx, bis) {
    const f = pauseFeld(k);
    for (const i of Array.isArray(idx) ? idx : [idx]) if (Number.isInteger(i) && i >= 0 && !(zahl(f[i], 0) >= bis)) f[i] = bis;
  }
  // Normaler Treffer: Pause bis jetzt + shields.regenDelay (verlängert, verkürzt nie)
  function treffer(k, idx, jetzt, C) { stempeln(k, idx, jetzt + pauseDelay(C)); }
  // Sturm-Treffer: zusätzlich systemModell.sturm.regenSperre_s; es gilt das Längere von beiden
  function trefferSturm(k, idx, jetzt, C) { stempeln(k, idx, jetzt + Math.max(pauseDelay(C), pauseSturm(C))); }
  function pauseBis(k, idx) { const f = k && k[PAUSE_FELD]; return f ? zahl(f[idx], 0) : 0; }
  function darfRegenerieren(k, idx, jetzt) { return jetzt >= pauseBis(k, idx); }
  // Alle Pausen löschen (Szenenneustart, Wellenpause, Arena, Heilen eines Verbündeten, Neuaufbau eines Gegners: der Schild ist wieder voll bzw. leer, ohne Vorgeschichte)
  function pauseLoeschen(k) { if (k) pauseFeld(k).length = 0; }
  // Alle n Indizes bis `bis` sperren (Test-/Messwerkzeug: eingefrorener Schild)
  function pauseAlleBis(k, bis, n) { const f = pauseFeld(k); f.length = 0; for (let i = 0; i < (n == null ? 4 : n); i++) f[i] = bis; }
  const pause = { treffer, trefferSturm, darfRegenerieren, bis: pauseBis, loeschen: pauseLoeschen, alleBis: pauseAlleBis };

  return { pause, SEITEN, layout, seiteUndLaenge, segmentAt, segmentOf, winkelBei, seitenMax, seitenSumme, fuellen };
});
