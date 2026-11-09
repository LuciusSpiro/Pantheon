// Raumszenen aus Karten-Daten (CONTRACT-EK7). UMD: window.Shared_GenSektor / require. Reine Funktionen, deterministisch.
// erzeuge(hex, daten, cfg) baut aus einem Hex-Eintrag von content/welt/limes.json eine Szene im Format von shared/locations.js:
//   Stern(e), Planeten, Station (+ Liegeplatz für Häfen), Navigationsbojen, Asteroidenfeld nach `einfluss`, Nebel nach `einfluss`.
// Der Seed kommt allein aus der Hex-Kennung (kein game.seed): Server und Client erzeugen dieselbe Szene.
// Sprungpunkte sind KEIN Teil der Szene: sprung.js legt sie aus den Kanten der Karte an den Szenenrand (Sektoren.sprungpunktLage);
// die Szene hält dafür einen Randstreifen frei (Asteroidenfeld mit Abstand, Station und Planeten in der Mitte).
// Überschreiben pro Hex: Feld `szene` im Hex-Eintrag (flach in die Szene gemischt, z. B. { "planeten": 0 }, { "beam": {...} }).
// Was der Server heute zeichnet bzw. verwendet: station, dock, asteroids/field, arrive, fog. Stern, Planeten und Bojen stehen
// als Daten in der Szene (scene.stern, scene.planeten, scene.bojen), bis space.js/art.js sie als Marker kennen.
// KAC-01 B: Hexe mit Feld `typ` (Typ-ID oder Liste von Typ-IDs, Katalog content/welt/sektortypen.json) bekommen zusätzlich scene.typ und
// scene.koerper[] ({id,index,art,x,y,r,biom?,planetenart?,landbar,beam:{range}}). Ohne `typ` bleibt alles wie vorher (tools/hash-raumszenen.js --compare).
// Den Katalog liefert im Node shared/sektortypen.js; im Browser setzeKatalog(daten) (oder cfg.katalog) vor erzeuge().
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

  // ---- KAC-01 B: Sektortypen (nur für Hexe mit Feld `typ`; der alte Pfad ruft nichts davon) ----
  // Katalog: Node per require, Browser über window.Shared_Sektortypen (Skript vor diesem)
  function typenModul() {
    if (typeof module === 'object' && module.exports) return require('./sektortypen.js');
    return (typeof self !== 'undefined' && self.Shared_Sektortypen) || null;
  }
  const leserCache = new WeakMap();
  let gesetzterLeser = null;
  function leserVonDaten(daten) {
    let l = leserCache.get(daten);
    if (!l) {
      const S = typenModul();
      if (!S) throw new Error('Sektortypen: shared/sektortypen.js ist nicht geladen');
      l = S.leser(daten); leserCache.set(daten, l);
    }
    return l;
  }
  // Katalog für den Browser (und Tests): Katalog-Daten wie content/welt/sektortypen.json; null = zurück auf den Node-Standard
  function setzeKatalog(daten) { gesetzterLeser = daten ? leserVonDaten(daten) : null; return gesetzterLeser !== null; }
  // katalog: Katalog-Daten oder schon ein Leser; sonst der gesetzte Katalog, im Node der Standardkatalog
  function katalogLeser(katalog) {
    if (katalog) return typeof katalog.typ === 'function' ? katalog : leserVonDaten(katalog);
    if (gesetzterLeser) return gesetzterLeser;
    if (typeof module === 'object' && module.exports) return require('./sektortypen.js').lade();
    throw new Error('Sektortypen-Katalog nicht gesetzt: Shared_GenSektor.setzeKatalog(daten) vor erzeuge() aufrufen');
  }
  function typIds(hex, d) {
    if (Array.isArray(d.typ)) {
      if (!d.typ.length) throw new Error(`Sektor ${hex}: typ ist eine leere Liste`);
      return d.typ;
    }
    return [d.typ];
  }
  // Körper aus Typen: je Vorlage `anzahl` aus eigenem Hash gezogen, Index = Position in der zusammengeführten Liste. Planetenart je Körper
  // aus (Hex, Index) allein; beides unabhängig vom Zufallsstrom der Szene. radius/extra/vorlage sind Material für die Lage.
  function koerperAus(hex, K, typen) {
    const rz = mulberry32(hexSeed(hex + ':anzahl'));
    const out = [];
    for (const t of typen) for (const v of t.koerper) {
      const n = ganz(rz, v.anzahl[0], v.anzahl[1]);
      for (let i = 0; i < n; i++) {
        const index = out.length;
        const k = { id: 'k' + index, index, art: v.art };
        if (v.arten) {
          k.planetenart = v.arten[Math.floor(mulberry32(hexSeed(hex + ':k' + index))() * v.arten.length)];
          const biom = K.planetenart(k.planetenart).biom;
          if (biom) k.biom = biom;
        }
        k.landbar = v.landbar === true;
        k.radius = v.radius.slice();
        if (k.landbar) k.extra = v.beam.extra;
        k.vorlage = t.id + '.' + v.id;
        out.push(k);
      }
    }
    return out;
  }
  // Körperliste eines Hex mit `typ` ohne Lage: [{id,index,art,planetenart?,biom?,landbar,radius,extra?,vorlage}]. Rein, deterministisch.
  function koerperVon(hex, daten, katalog) {
    const K = katalogLeser(katalog);
    const typen = typIds(hex, daten || {}).map((id) => K.typ(id));
    return koerperAus(hex, K, typen);
  }
  // Biom des Körpers `index` (Gelände-Biom der gewählten Planetenart); null bei nicht landbar oder ohne Planetenart
  function biomVon(hex, index, daten, katalog) {
    const k = koerperVon(hex, daten, katalog)[index];
    if (!k) throw new Error(`Sektor ${hex}: kein Koerper mit Index ${index}`);
    return k.biom || null;
  }
  // Plan eines typ-Hex: Szenenanteile des Haupttyps (aus eigenem Hash, nicht aus dem Szenenstrom) und Körperliste
  function typPlanVon(hex, d, katalog) {
    const K = katalogLeser(katalog);
    const typen = typIds(hex, d).map((id) => K.typ(id));
    const sz = typen[0].szene;
    const rs = mulberry32(hexSeed(hex + ':szene'));
    const spanne = (s) => ganz(rs, s[0], s[1]);
    const ov = { sterne: spanne(sz.sterne), bojen: spanne(sz.bojen), asteroids: spanne(sz.brocken), planeten: 0 };
    if (sz.w) ov.w = spanne(sz.w);
    if (sz.h) ov.h = spanne(sz.h);
    if (sz.zonen) ov.zonen = sz.zonen;
    const koerper = koerperAus(hex, K, typen);
    if (koerper.filter((k) => k.art === 'station').length > 1) throw new Error(`Sektor ${hex}: typ ${JSON.stringify(d.typ)} traegt mehr als eine Station (die Szene kennt nur eine)`);
    const einfluss = sz.nebel ? 'nebel' : sz.zonen === 'gasriese' ? 'gas' : ov.asteroids > 0 ? 'asteroiden' : null;
    return { ov, koerper, einfluss, gasFest: sz.zonen === 'gasriese' };
  }

  // Lage der Körper (eigener Hash): Abstand zu Ankunft/Liegeplatz +380, Körper untereinander +300, Rand m; Beam-Bereiche landbarer Körper
  // überlappen nicht (Abstand >= range1 + range2). Die Szene bleibt, wie sie ist: findet sich keine Lage, gibt es einen Fehler statt einer größeren Szene.
  const LAGE_VERSUCHE = 400, LAGE_ZUEGE = 300;
  function legeKoerper(hex, liste, o) {
    const { w, h, m, arrive } = o;
    const dockVon = (p) => (p.art === 'station' && o.andocken ? { x: p.x, y: p.y + o.dockAbstand } : null);
    const rl = mulberry32(hexSeed(hex + ':lage'));
    let letzter = null;
    for (let versuch = 0; versuch < LAGE_VERSUCHE; versuch++) {
      const gesetzt = [];
      let gasFest = o.gasFest, ok = true;
      // landbare Körper zuerst (sie brauchen die Beam-Abstände), Kulisse füllt den Rest; die Ergebnisliste bleibt nach Index geordnet
      for (const b of liste.slice().sort((p, q) => (q.landbar ? 1 : 0) - (p.landbar ? 1 : 0) || p.index - q.index)) {
        const r = ganz(rl, b.radius[0], b.radius[1]);
        const range = b.landbar ? r + b.extra : 0;
        let pos = null;
        if (b.art === 'gasriese' && gasFest) {
          gasFest = false;
          const gp = Array.isArray(o.gasPos) ? o.gasPos : [0.5, 0.36];
          pos = { x: Math.round(w * gp[0]), y: Math.round(h * gp[1]) };
        } else {
          const x0 = m + r, x1 = w - m - r, y0 = m + r, y1 = h - m - r;
          for (let z = 0; z < LAGE_ZUEGE && x0 <= x1 && y0 <= y1; z++) {
            const x = Math.round(weit(rl, x0, x1)), y = Math.round(weit(rl, y0, y1));
            if (Math.hypot(x - arrive.x, y - arrive.y) < r + 380) continue;
            if (b.art === 'station' && o.andocken && gesetzt.some((p) => Math.hypot(x - p.x, y + o.dockAbstand - p.y) < p.r + 380)) continue;
            if (gesetzt.some((p) => {
              if (Math.hypot(x - p.x, y - p.y) < r + p.r + 300) return true;
              if (range && p.range && Math.hypot(x - p.x, y - p.y) < range + p.range) return true;
              const dp = dockVon(p);
              return !!dp && Math.hypot(x - dp.x, y - dp.y) < r + 380;
            })) continue;
            pos = { x, y }; break;
          }
        }
        if (!pos) { ok = false; letzter = b; break; }
        gesetzt.push({ k: b, art: b.art, x: pos.x, y: pos.y, r, range });
      }
      if (ok) return gesetzt.sort((p, q) => p.k.index - q.k.index);
    }
    throw new Error(`Sektor ${hex}: Koerper ${letzter.id} (${letzter.art}) findet keine Lage in der Szene ${w}x${h} (Abstaende, Landestrahlen ohne Ueberlappung)`);
  }
  // Szenen-Körper aus der Lage; die Station mit den endgültigen Werten aus scene.station
  function szenenKoerper(gesetzt, station) {
    return gesetzt.map((g) => {
      const st = g.art === 'station' && station;
      const k = { id: g.k.id, index: g.k.index, art: g.art, x: st ? station.x : g.x, y: st ? station.y : g.y, r: st ? station.r : g.r };
      if (g.k.biom) k.biom = g.k.biom;
      if (g.k.planetenart) k.planetenart = g.k.planetenart;
      k.landbar = g.k.landbar;
      if (g.k.landbar) k.beam = { range: k.r + g.k.extra };
      return k;
    });
  }
  const KOERPERNAME = { planet: 'Planet', gasriese: 'Gasriese', station: 'Station', siedlung: 'Siedlung', asteroid: 'Asteroid' };
  function beschreibeTyp(d, einfl, koerper) {
    const t = [];
    if (einfl === 'nebel' && d.einfluss !== 'nebel') t.push('Nebel schluckt die Sensoren.');
    if (koerper.some((k) => k.art === 'gasriese')) t.push('Ein Gasriese.');
    const landbar = koerper.filter((k) => k.landbar).map((k) => KOERPERNAME[k.art] + (k.biom ? ` (${k.biom})` : ''));
    if (landbar.length) t.push(`Landbar: ${landbar.join(', ')}.`);
    return t.length ? ' ' + t.join(' ') : '';
  }

  function erzeuge(hex, daten, cfg) {
    const C = Object.assign({}, STANDARD, cfg || {});
    const d = daten || {};
    const ovRoh = d.szene && typeof d.szene === 'object' ? d.szene : {};
    const plan = d.typ !== undefined ? typPlanVon(hex, d, C.katalog) : null;   // KAC-01 B: nur Hexe mit `typ`; `szene` im Hex-Eintrag gewinnt
    const ov = plan ? Object.assign({}, plan.ov, ovRoh) : ovRoh;
    const r = mulberry32(hexSeed(hex));
    const w = ov.w || C.w, h = ov.h || C.h;
    const m = C.randStreifen;
    const mitte = { x: Math.round(w / 2), y: Math.round(h / 2) };
    const einfl = d.einfluss || (plan && plan.einfluss) || null;
    const arrive = { x: Math.round(w * 0.2), y: mitte.y, angle: 0 };
    // KAC-01 B: Körper des Typs mit eigenem Hash legen (kein Zufallsaufruf aus r); die Station des Typs ersetzt die zufällige Station unten
    const lage = plan ? legeKoerper(hex, plan.koerper, { w, h, m, arrive, andocken: !!d.andocken, dockAbstand: C.dockAbstand, gasFest: plan.gasFest, gasPos: ov.gasPos }) : null;
    const typStation = lage && lage.find((g) => g.art === 'station');

    // Station: jedes System mit Hafenklasse trägt eine; Liegeplatz nur, wenn der Eintrag `andocken` sagt
    const station = typStation
      ? Object.assign({ kind: 'station', x: typStation.x, y: typStation.y, r: typStation.r }, ov.station && typeof ov.station === 'object' ? ov.station : {})
      : ov.station === false ? null : (d.hafen || ov.station)
      ? Object.assign({ kind: 'station', x: Math.round(w * weit(r, 0.42, 0.62)), y: Math.round(h * weit(r, 0.40, 0.60)), r: C.stationR },
        ov.station && typeof ov.station === 'object' ? ov.station : {}) : null;
    const dock = station && d.andocken ? { x: station.x, y: station.y + C.dockAbstand } : null;

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
    const gasZ = ov.zonen === 'gasriese';   // U2: Gasriese mit Zonen ist doppelt so groß (Radius 480–640, Szene größer per `szene.w/h`) und steht fest (gasPos), damit Anflug und Rückflug frei bleiben
    for (let i = 0, guard = 0; i < np && guard++ < 200;) {
      const pr = einfl === 'gas' && i === 0 ? (gasZ ? ganz(r, 480, 640) : ganz(r, 240, 320)) : ganz(r, 110, 230);
      if (gasZ && i === 0 && einfl === 'gas') {
        const gp = Array.isArray(ov.gasPos) ? ov.gasPos : [0.5, 0.36];   // Sund 0503: alle drei Sprungpunkte liegen in der unteren Hälfte, der Gasriese oben in der Mitte
        planeten.push({ x: Math.round(w * gp[0]), y: Math.round(h * gp[1]), r: pr, art: 'gasriese' });
        i++; continue;
      }
      const x = Math.round(weit(r, m + pr, w - m - pr)), y = Math.round(weit(r, m + pr, h - m - pr));
      if (frei.some((k) => Math.hypot(x - k.x, y - k.y) < pr + (k.r || 0) + 380)) continue;
      if (planeten.some((p) => Math.hypot(x - p.x, y - p.y) < pr + p.r + 300)) continue;
      planeten.push({ x, y, r: pr, art: einfl === 'gas' && i === 0 ? 'gasriese' : KIND_PLANET[ganz(r, 0, KIND_PLANET.length - 1)] });
      i++;
    }
    if (lage) for (const g of lage) if (g.art === 'planet' || g.art === 'gasriese') planeten.push({ x: g.x, y: g.y, r: g.r, art: g.art === 'gasriese' ? 'gasriese' : g.k.planetenart });

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

    if (lage) {
      scene.typ = Array.isArray(d.typ) ? d.typ.slice() : d.typ;
      scene.koerper = szenenKoerper(lage, scene.station && scene.station.kind === 'station' ? scene.station : null);
    }

    const id = d.ort || (d.typ !== undefined ? 'k_' + hex : ortId(d.name || hex));   // KAC-01 C: typ-Hex ohne `ort` = k_<hex> (shared/sektoren.js kachelOrt)
    const kind = dock ? 'port' : einfl === 'nebel' ? 'nebula' : einfl === 'asteroiden' || einfl === 'truemmerstrom' ? 'asteroids' : einfl === 'gas' ? 'gasgiant' : station ? 'outpost' : 'void';
    const loc = {
      id, name: d.name || hex, kind, hex, gen: true, fog: einfl === 'nebel',
      desc: `${d.name}: ${d.art || 'System'}.${d.hafen ? ` Hafenklasse ${d.hafen}.` : ''}`,
      first: `${d.name} (${hex}). ${beschreibe(d, scene)}${lage ? beschreibeTyp(d, einfl, scene.koerper) : ''}`,
      scene, hidden: [], links: [],
    };
    if (dock) loc.shop = 'hafen';   // Hafensortiment wie Lichtkordon (server/sim/shop.js)
    if (d.flottenbasis) loc.flottenbasis = true;   // PAN-01 D: Werft (Freischalten, Umbauen), server/sim/werft.js; feindliche Basen tragen das Feld nicht
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

  return { erzeuge, hexSeed, ortId, STANDARD, koerperVon, biomVon, setzeKatalog };
});
