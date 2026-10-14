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

  return { SEITEN, layout, seiteUndLaenge, segmentAt, segmentOf, winkelBei, seitenMax, seitenSumme, fuellen };
});
