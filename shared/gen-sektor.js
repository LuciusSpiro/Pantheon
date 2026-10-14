// Raumszenen aus Karten-Daten (CONTRACT-EK7). UMD: window.Shared_GenSektor / require. Reine Funktionen, deterministisch.
// erzeuge(hex, daten, cfg) baut aus einem Hex-Eintrag von content/welt/limes.json eine Szene im Format von shared/locations.js:
//   Stern(e), Planeten, Station (+ Liegeplatz für Häfen), Navigationsbojen, Asteroidenfeld nach `einfluss`, Nebel nach `einfluss`.
// Der Seed kommt allein aus der Hex-Kennung (kein game.seed): Server und Client erzeugen dieselbe Szene.
// Sprungpunkte sind KEIN Teil der Szene: sprung.js legt sie aus den Kanten der Karte an den Szenenrand (Sektoren.sprungpunktLage);
// die Szene hält dafür einen Randstreifen frei (Asteroidenfeld mit Abstand, Station und Planeten in der Mitte).
// Überschreiben pro Hex: Feld `szene` im Hex-Eintrag (flach in die Szene gemischt, z. B. { "planeten": 0 }, { "beam": {...} }).
// Was der Server heute zeichnet bzw. verwendet: station, dock, asteroids/field, arrive, fog. Stern, Planeten und Bojen stehen
// als Daten in der Szene (scene.stern, scene.planeten, scene.bojen), bis space.js/art.js sie als Marker kennen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_GenSektor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Zonen-Baustein (SL6): Node per require, Browser über window.Shared_Zonen (Skript vor diesem)
  function zonenModul() {
    if (typeof module === 'object' && module.exports) { try { return require('./zonen.js'); } catch (e) { return null; } }
    return (typeof self !== 'undefined' && self.Shared_Zonen) || null;
  }

  const STANDARD = {
    w: 3000, h: 2200,
    randStreifen: 520,                    // px frei vom Szenenrand für Asteroiden (Sprungpunkte liegen 180 px vor dem Rand)
    asteroiden: { asteroiden: 24, truemmerstrom: 14 },   // Anzahl Brocken je Einfluss
    planeten: [0, 2],                     // Zahl der Planeten ohne Vorgabe (min, max)
    bojen: [2, 4],
    stationR: 60, dockAbstand: 170,
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Seed nur aus der Hex-Kennung (SSZZ)
  function hexSeed(hex) {
    let h = 2166136261 >>> 0;
    const s = 'hex:' + String(hex);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  const KIND_STERN = ['gelb', 'orange', 'weiss', 'rot'];
  const KIND_PLANET = ['fels', 'eis', 'wueste', 'ozean'];
  const slug = (n) => String(n).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  // Ort-ID aus dem Namen (Kleinbuchstaben, Unterstrich): „Castra Martis“ -> castra_martis
  function ortId(name) { return slug(name); }

  function weit(r, lo, hi) { return lo + r() * (hi - lo); }
  function ganz(r, lo, hi) { return Math.floor(weit(r, lo, hi + 1)); }

  function erzeuge(hex, daten, cfg) {
    const C = Object.assign({}, STANDARD, cfg || {});
    const d = daten || {};
    const ov = d.szene && typeof d.szene === 'object' ? d.szene : {};
    const r = mulberry32(hexSeed(hex));
    const w = ov.w || C.w, h = ov.h || C.h;
    const m = C.randStreifen;
    const mitte = { x: Math.round(w / 2), y: Math.round(h / 2) };
    const einfl = d.einfluss || null;

    // Station: jedes System mit Hafenklasse trägt eine; Liegeplatz nur, wenn der Eintrag `andocken` sagt
    const station = ov.station === false ? null : (d.hafen || ov.station)
      ? Object.assign({ kind: 'station', x: Math.round(w * weit(r, 0.42, 0.62)), y: Math.round(h * weit(r, 0.40, 0.60)), r: C.stationR },
        ov.station && typeof ov.station === 'object' ? ov.station : {}) : null;
    const dock = station && d.andocken ? { x: station.x, y: station.y + C.dockAbstand } : null;

    const arrive = { x: Math.round(w * 0.2), y: mitte.y, angle: 0 };
    const frei = [arrive, station, dock].filter(Boolean);

    // Sterne: Doppelstern nach `art`, sonst einer; weit außerhalb der Mitte (Hintergrund)
    const doppel = /doppelstern/i.test(d.art || '');
    const n0 = ov.sterne != null ? ov.sterne : (doppel ? 2 : 1);
    const sterne = [];
    for (let i = 0; i < n0; i++) {
      sterne.push({ x: Math.round(w * (i ? weit(r, 0.72, 0.9) : weit(r, 0.1, 0.28))), y: Math.round(h * weit(r, 0.12, 0.3) + i * h * 0.45),
        r: ganz(r, 90, 170), klasse: KIND_STERN[ganz(r, 0, KIND_STERN.length - 1)] });
    }

    // Planeten: Gasriese bei einfluss gas, sonst 0..2 zufällig; Abstand zu Station, Ankunft und zueinander
    const np = ov.planeten != null ? ov.planeten : (einfl === 'gas' ? 1 : ganz(r, C.planeten[0], C.planeten[1]));
    const planeten = [];
    for (let i = 0, guard = 0; i < np && guard++ < 200;) {
      const pr = einfl === 'gas' && i === 0 ? ganz(r, 240, 320) : ganz(r, 110, 230);
      const x = Math.round(weit(r, m + pr, w - m - pr)), y = Math.round(weit(r, m + pr, h - m - pr));
      if (frei.some((k) => Math.hypot(x - k.x, y - k.y) < pr + (k.r || 0) + 380)) continue;
      if (planeten.some((p) => Math.hypot(x - p.x, y - p.y) < pr + p.r + 300)) continue;
      planeten.push({ x, y, r: pr, art: einfl === 'gas' && i === 0 ? 'gasriese' : KIND_PLANET[ganz(r, 0, KIND_PLANET.length - 1)] });
      i++;
    }

    // Navigationsbojen: 2–4 Stück im freien Raum (Zierde; die Sprungpunkt-Bojen legt sprung.js an)
    const nb = ov.bojen != null ? ov.bojen : ganz(r, C.bojen[0], C.bojen[1]);
    const bojen = [];
    for (let i = 0, guard = 0; i < nb && guard++ < 200;) {
      const x = Math.round(weit(r, m, w - m)), y = Math.round(weit(r, m, h - m));
      if (frei.some((k) => Math.hypot(x - k.x, y - k.y) < (k.r || 0) + 300)) continue;
      if (bojen.some((b) => Math.hypot(x - b.x, y - b.y) < 400)) continue;
      bojen.push({ x, y }); i++;
    }

    const brocken = ov.asteroids != null ? ov.asteroids : (C.asteroiden[einfl] || 0);
    const scene = { w, h, arrive, asteroids: brocken, field: { x0: m, x1: w - m, y0: m, y1: h - m }, stern: sterne, planeten, bojen };
    if (station) scene.station = station;
    if (dock) scene.dock = dock;
    if (d.hafen) scene.hafen = { klasse: d.hafen, andocken: !!dock, ruf: false };   // Hafen ohne Ruf: Marken und Einkauf, keine Haltung
    for (const [k, v] of Object.entries(ov)) if (!['station', 'planeten', 'bojen', 'sterne', 'asteroids', 'w', 'h'].includes(k)) scene[k] = v;
    // SL6: `szene.zonen: "gasriese"` baut die Atmosphären-Zonen des ersten Gasriesen (shared/zonen.js); Listen von Zonen gehen unverändert durch.
    // Ohne diese Angabe bekommt kein Hex Zonen (Limes/Eisenwald unverändert).
    if (ov.zonen === 'gasriese') {
      const Z = zonenModul();
      const gp = planeten.find((p) => p.art === 'gasriese');
      scene.zonen = Z && gp ? Z.gasriese(gp, null, 'gas' + hex) : [];
    } else if (ov.zonen === 'boje') {
      // SL10: Vorläufer-Boje mit Aktivierungsfeld (Navigation hält das Schiff im Feld, drückt und driftet)
      const Z = zonenModul();
      const bj = Z ? Z.boje(w, h, hexSeed(hex)) : null;
      scene.zonen = bj ? bj.zonen : [];
      if (bj) {
        scene.bojeFeld = { x: bj.boje.x, y: bj.boje.y };
        scene.arrive = bj.arrive;
        scene.station = Object.assign({ kind: 'buoy', r: 48, name: 'Vorläufer-Boje' }, ov.station && typeof ov.station === 'object' ? ov.station : {}, { x: bj.boje.x, y: bj.boje.y });
      }
    } else if (ov.zonen === 'gravimetrie') {
      // SL7a: Forschungsstation im Gravimetriefeld: Ankunft links, Station rechts, Felder/Kerne dazwischen, Haltefeld (Gruppe halt) anfangs aus
      const Z = zonenModul();
      const gv = Z ? Z.gravimetrie(w, h, hexSeed(hex)) : null;
      scene.zonen = gv ? gv.zonen : [];
      if (gv) {
        scene.zonenAus = ['halt'];
        scene.gravimetrie = { weg: gv.weg, fluchtweg: gv.fluchtweg, start: gv.start, station: gv.station };
        scene.arrive = { x: gv.start.x, y: gv.start.y, angle: 0 };
        scene.station = Object.assign({ kind: 'station', r: C.stationR, name: 'Forschungsstation' }, ov.station && typeof ov.station === 'object' ? ov.station : {}, { x: gv.station.x, y: gv.station.y });
      }
    }

    const id = d.ort || ortId(d.name || hex);
    const kind = dock ? 'port' : einfl === 'nebel' ? 'nebula' : einfl === 'asteroiden' || einfl === 'truemmerstrom' ? 'asteroids' : einfl === 'gas' ? 'gasgiant' : station ? 'outpost' : 'void';
    const loc = {
      id, name: d.name || hex, kind, hex, gen: true, fog: einfl === 'nebel',
      desc: `${d.name}: ${d.art || 'System'}.${d.hafen ? ` Hafenklasse ${d.hafen}.` : ''}`,
      first: `${d.name} (${hex}). ${beschreibe(d, scene)}`,
      scene, hidden: [], links: [],
    };
    if (dock) loc.shop = 'hafen';   // Hafensortiment wie Lichtkordon (server/sim/shop.js)
    return loc;
  }
  function beschreibe(d, scene) {
    const t = [];
    if (scene.station) t.push(scene.dock ? 'Ein Hafen mit Liegeplatz.' : 'Eine Station im Orbit.');
    if (scene.planeten.length) t.push(scene.planeten.length === 1 ? 'Ein Planet.' : scene.planeten.length + ' Planeten.');
    if (scene.asteroids) t.push('Brocken im Anflug.');
    if (d.einfluss === 'nebel') t.push('Nebel schluckt die Sensoren.');
    if (!t.length) t.push('Stille. Nur die Sprungpunkt-Bojen blinken.');
    return t.join(' ');
  }

  return { erzeuge, hexSeed, ortId, STANDARD };
});
