// SL4 (CONCEPT-SL4): Sektorplan – gemeinsame Rechenregeln für Server und Client. UMD: window.Shared_Sektorplan / require. Reine Funktionen.
// Die ortsfeste Szene eines Hexes (Stern, Planeten, Station, Bojen, Zonen, Sprungpunkte) ist deterministisch aus den Kartendaten ableitbar
// (shared/gen-sektor.js, shared/locations.js): Der Server schickt sie NICHT, Client und Server rechnen `objekte(hex)` gleich.
// Eintragsformat (Vertrag mit SL1B, Kartenzeichen): { id, sym, x, y, r?, name?, quelle: 'karte', bekannt: true } im Szenen-Koordinatensystem.
//   sym: stern | planet | gasriese | station | hafen | boje | sprungpunkt | zone | wrack | marke | schiff
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sektoren.js'), require('./locations.js'));
  } else root.Shared_Sektorplan = factory(root.Shared_Sektoren, root.Shared_Locations);
})(typeof self !== 'undefined' ? self : this, function (Sektoren, Locations) {
  'use strict';

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);

  // Szene des Hexes (Ort aus Locations oder Daten, sonst Leerraum) | null
  function szene(hex) {
    const ort = Sektoren && Sektoren.ortVonHex ? Sektoren.ortVonHex(hex) : null;
    const loc = ort && Locations && Locations.get ? Locations.get(ort) : null;
    return loc && loc.scene ? { ort, loc, scene: loc.scene } : null;
  }

  // Ortsfeste Objekte eines Hexes. Rückgabe: [] bei unbekanntem/unspielbarem Hex.
  function objekte(hex) {
    const z = szene(hex); if (!z) return [];
    const sc = z.scene; const out = [];
    (sc.stern || []).forEach((s, i) => out.push({ id: 'st' + i, sym: 'stern', x: s.x, y: s.y, r: s.r, name: 'Stern' + (s.klasse ? ' (' + s.klasse + ')' : '') }));
    (sc.planeten || []).forEach((p, i) => out.push({ id: 'pl' + i, sym: p.art === 'gasriese' || p.art === 'gas' ? 'gasriese' : 'planet', x: p.x, y: p.y, r: p.r, name: p.name || (p.art === 'gasriese' || p.art === 'gas' ? 'Gasriese' : 'Planet') }));
    if (sc.station) out.push({ id: 'sta', sym: sc.dock ? 'hafen' : 'station', x: sc.station.x, y: sc.station.y, r: sc.station.r, name: sc.station.name || z.loc.name || 'Station' });
    (sc.bojen || []).forEach((b, i) => out.push({ id: 'bj' + i, sym: 'boje', x: b.x, y: b.y, name: 'Boje' }));
    (sc.zonen || []).forEach((q, i) => out.push({ id: 'zo' + i, sym: 'zone', x: num(q.x), y: num(q.y), r: num(q.r || q.rMax || q.rad), name: q.name || 'Zone' }));
    // Sprungpunkte: je Kante des Hexes am Szenenrand (wie sprung.js)
    if (Sektoren && Sektoren.kantenVon) {
      for (const e of Sektoren.kantenVon(hex)) {
        const nach = Sektoren.anderes(e, hex);
        const p = Sektoren.sprungpunktLage(sc.w, sc.h, Sektoren.richtung(hex, nach), 180);
        out.push({ id: 'sp' + nach, sym: 'sprungpunkt', x: p.x, y: p.y, name: 'Sprungpunkt ' + Sektoren.hexName(nach), nach, art: e.art });
      }
    }
    return out;
  }
  function groesse(hex) { const z = szene(hex); return z ? { w: z.scene.w, h: z.scene.h } : null; }
  // Anzeigetext für das Alter in Sekunden: „vor 4 min“, „vor 40 s“
  function alterText(s) { s = Math.max(0, Math.round(num(s))); return s < 90 ? 'vor ' + s + ' s' : 'vor ' + Math.round(s / 60) + ' min'; }

  return { szene, objekte, groesse, alterText };
});
