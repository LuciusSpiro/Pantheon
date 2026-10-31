// B1 Team VOXEL – Deko-Regeln (CONTRACT-B1 §10.3, §3.4 AD 6; ART-PLAN §4/§6).
// Streut Deko-Props deterministisch aus Karten-Seed und Platz. Reine Funktion ohne three.js (läuft auch in Node).
// Regeln (Art-Daten content/buehnen/deko/<bauweise>.json):
//   { format: "deko/1", regeln: { <platztyp>|"*": { props: [ids], dichte: [min, max], wandnah: bool, frei_halten: 2 } } }
// Rollenmodus (ORT-01, Format rollen/1, content/buehnen/rollen/<kartenart>.json; opts.rollen = { daten, bauweise, ausschluss? }):
//   Für Plätze, deren Raumtyp (Präfix der Platz-ID ohne _n: kommando, werkstatt_2 → werkstatt) in daten.raumtypen steht, wird je
//   Platzrechteck nach Rollen gestreut statt je 8×8-Zelle. Die Rolle nennt ihre Belegung je Bauweise (daten.rollen.<name>.<bauweise>),
//   der Zufall kommt aus einem eigenen Strom je Platz und Rolle (fnv(platzId:rolle, seed)), nie aus game.rng oder dem Generator.
//   In diesen Rechtecken streut der Zellenmodus nicht mehr (fremde Platztypen wandern nicht hinein). Plätze ohne Raumtyp-Eintrag
//   und Karten ohne Rollen-Datei laufen unverändert im Zellenmodus (byte-gleich, tools/hash-baseline.js --compare).
//   opts.rollen.bericht (optional, Objekt): je Rollen-Platz { frei_halten (erreicht), gewuenscht, kandidaten, soll } (Tests); opts.onFehler(e) bei kaputter Datei.
//   kind leit = Hauptstück (mehrere Kacheln, rein optisch): wird nach Fußabdruck (opts.rollen.leitFuss = bauweisen/<bw>.json leit_fuss) im
//   Platzrechteck platziert, bevorzugt/erzwungen wandnah (Rücken zur Wand), nie auf Anker-, Tür-, Weg-, Kantenmitte-Kacheln und nie über die
//   Raumgrenze; findet sich kein Platz, entfällt es. Eigener Strom je Platz und Rolle, Positionen in Rom und Germanen gleich (gleicher Fuß).
//   Rückfall des Hauptstücks (Ausfall niedrig): wandnah mit frei_halten fh…1, dann frei, dann mit Abstand 0 (nicht bei nur_wand). Rollen mit zug_gross
//   nehmen es ab Platzfläche GROSS_AB. Der Raumtyp eines Platzes kann über seine Anker überschrieben werden (sprengpunkt → reaktor, terminal im
//   Kontrollraum → kommando), nur im Client. Rollen-Stücke zählen je Zelle gegen MAX_ROLLE_JE_ZELLE (unabhängig vom Zellenmodus, Layout-Parität).
//   kind anker (Belegung der Gameplay-Anker-Optik) ist im Format vorgesehen, wird aber erst mit den Anker-Modellen verdrahtet (kit.js propEintrag).
// Harte Grenzen (Vertrag, nicht per Daten abschaltbar):
//   - nie auf Anker-, Tür-, Weg- oder Kantenmitte-Kacheln, nie auf festen Kacheln
//   - höchstens 12 Props je Zelle (8×8), Deko ist nur Optik (keine Kollision), Deckung wird nie gestreut
// Ergebnis: [{ id, x, y, rot, seed, platz, dx, dz, rolle? }] (rolle nur im Rollenmodus) in Kacheln (x, y = Kachel; dx/dz Versatz in der Kachel, −0,25…0,25 m).

export const MAX_JE_ZELLE = 12;
export const MAX_ROLLE_JE_ZELLE = 6;   // Rollen-Stücke je 8×8-Zelle; Zellenmodus höchstens 6 (Regeln), zusammen ≤ MAX_JE_ZELLE
export const GROSS_AB = 49;   // Platzfläche (Kacheln, w × h) ab der Rollen ihr zug_gross nehmen (7×7)
// Altstücke der Holz- und Fass-Welt (ORT-01): in Orten (Station, Außenposten) nicht aus der Besitz-Streu (paletten/<besitz>.json), Ruine und Schiff behalten sie.
export const ALT_BESITZ_ORT = /gemein\/(fass|kette|werkzeug|feuerschale)$/;
// Orte (Station, Außenposten, ORT-01 9): nur Regeln mit Kartenart-Präfix ('station:lager', 'aussenposten:*'), nie die
// unpräfixierten Altstück-Regeln, die Schiff und Ruine weiter nutzen (Schiff und Ruine byte-gleich zu main).
export function regelFuer(typ, art, R) {
  if (art === 'station' || art === 'aussenposten') return R[art + ':' + typ] || R[art + ':*'] || null;
  return R[typ] || R['*'] || null;
}
/** Besitz-Streu für eine Kartenart: in Station und Außenposten ohne ALT_BESITZ_ORT, sonst unverändert (kit.js und tools/hash-baseline.js). */
export function besitzStreuFuerOrt(art, streu) {
  const liste = Array.isArray(streu) ? streu : [];
  if (art !== 'station' && art !== 'aussenposten') return liste;
  return liste.filter((e) => !ALT_BESITZ_ORT.test(typeof e === 'string' ? e : (e && e.id) || ''));
}
// Raumtypen (Präfix der Platz-ID) je Kartenart, für die Rollen definiert werden dürfen (Quelle: gen-station.js RAUMNAME, gen-siedlung.js GEB_NAME + kaefig_n).
// Nur die Gebäude des Außenpostens dürfen auf ihrem Innenboden boden2 bestreut werden; Gänge, Straßen, Station: nie (boden2 ist dort Weg).
export const RAUMTYPEN = {
  station: ['kommando', 'reaktor', 'zellen', 'lager', 'quartier', 'messe', 'werkstatt', 'krankenstation', 'kantine'],
  aussenposten: ['kommando', 'lager', 'werkstatt', 'quartier', 'kantine', 'krankenstation', 'kaefig'],
};
const hat = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const boden2Erlaubt = (art, platzId) => art === 'aussenposten' && RAUMTYPEN.aussenposten.includes(raumtypVon(platzId));
const ZELLE = 8;
// begehbare Untergründe, auf denen Deko liegen darf (Weg ',' / Pad / Rampe / Plateau-Kante nie)
const DEKO_BODEN = { boden: 1, gelaende: 1, plateau: 1 };
const WEG = { boden2: 1, pad: 1, rampe: 1, grabensohle: 1 };   // VOX-01: grabensohle wie boden2 (Weg)
const TUER = { tuer: 1, schott: 1, tor: 1, luke: 1, wand_schwach: 1 };
const WANDNAH = { wand: 1, zaun: 1, fels: 1, baum: 1, gitter: 1, fenster: 1, pfeiler: 1, kante: 1 };   // VOX-01: baum wie fels

function fnv(str, h) {
  h = h == null ? 0x811c9dc5 : h;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Raumtyp eines Platzes aus der Platz-ID: Präfix ohne laufende Nummer (werkstatt_2 → werkstatt, kommando → kommando). */
export function raumtypVon(platzId) { return String(platzId || '').replace(/_\d+$/, ''); }

/** Belegung einer Rolle für eine Bauweise: Liste von Modell-IDs (String oder Liste in den Daten), ohne `ausschluss` (Set). */
export function belegungVon(daten, rolle, bauweise, ausschluss) {
  const r = daten && hat(daten.rollen, rolle) ? daten.rollen[rolle] : null;
  const v = hat(r, bauweise) ? r[bauweise] : null;
  const l = (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []).filter((id) => typeof id === 'string' && id);
  return ausschluss ? l.filter((id) => !ausschluss.has(id)) : l;
}

/** Plätze ohne awayMap.plaetze aus den Anker-IDs (<platz>.<rolle>[.n]) ableiten: Zelle(n) mit Ankern des Platzes, Typ = ID ohne _n. */
export function plaetzeAbleiten(k) {
  const by = new Map();
  for (const a of k.anker || []) {
    const pid = String(a.platz || String(a.id || '').split('.')[0] || '');
    if (!pid) continue;
    let p = by.get(pid);
    if (!p) { p = { id: pid, typ: pid.replace(/_\d+$/, ''), zellen: new Set() }; by.set(pid, p); }
    p.zellen.add(Math.floor(a.x / ZELLE) + ',' + Math.floor(a.y / ZELLE));
  }
  const out = [];
  for (const id of [...by.keys()].sort()) {
    const p = by.get(id);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const z of p.zellen) { const [cx, cy] = z.split(',').map(Number); x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); }
    out.push({ id, typ: p.typ, x: x0 * ZELLE, y: y0 * ZELLE, w: (x1 - x0 + 1) * ZELLE, h: (y1 - y0 + 1) * ZELLE, abgeleitet: true });
  }
  return out;
}

/** Kantenmitte: Kachelindex 3 und 4 entlang einer Zellkante (CONTRACT-B1 §3.2). Schiff: Längsgänge (Zeile 2/6/10 je Deck). */
export function istKantenmitte(x, y, k) {
  if (k && k.art === 'schiff') {
    const ly = ((y % (k.stride || 16)) + (k.stride || 16)) % (k.stride || 16);
    return ly === 2 || ly === 6 || ly === 10;
  }
  const lx = x % ZELLE, ly = y % ZELLE;
  if ((lx === 3 || lx === 4) && (ly === 0 || ly === 7)) return true;
  if ((ly === 3 || ly === 4) && (lx === 0 || lx === 7)) return true;
  return false;
}

/**
 * k: { w, h, seed, art, kindAt(x, y) → kind|null, anker: [{ x, y }], plaetze?: [{ id, typ, x, y, w, h }] }
 * regeln: Objekt aus deko/<bauweise>.json (oder dessen .regeln); extra: zusätzliche Props (Besitz-Streuung, geringe Dichte),
 *   je Eintrag ID oder { id, wandnah: true } (nur an Wand/Zaun, Rücken zur Wand; Wunsch ART-PALETTEN)
 */
export function streuen(k, regeln, opts = {}) {
  const R = (regeln && regeln.regeln) || regeln || {};
  const extra = (opts.extra || []).map((e) => (typeof e === 'string' ? { id: e, wandnah: false } : e && e.id ? { id: e.id, wandnah: !!e.wandnah } : null)).filter(Boolean);
  const RO = opts.rollen && opts.rollen.daten && opts.rollen.daten.raumtypen && Object.keys(opts.rollen.daten.raumtypen).length ? opts.rollen : null;
  if (!Object.keys(R).length && !extra.length && !RO) return [];
  const W = k.w, H = k.h;
  const kind = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : k.kindAt(x, y));
  // gesperrte Kacheln: Anker (+ frei_halten), Türen (+ frei_halten), Weg, Kantenmitte
  const anker = (k.anker || []).map((a) => [a.x | 0, a.y | 0]);
  const tueren = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (TUER[kind(x, y)]) tueren.push([x, y]);
  const sperre = (radius) => {
    const s = new Uint8Array(W * H);
    const mark = (cx, cy, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < W && y < H) s[y * W + x] = 1; } };
    for (const [x, y] of anker) mark(x, y, radius);
    for (const [x, y] of tueren) mark(x, y, radius);
    return s;
  };
  const sperrCache = new Map();
  const gesperrt = (r) => { r = Math.max(0, Math.min(4, r | 0)); let s = sperrCache.get(r); if (!s) { s = sperre(r); sperrCache.set(r, s); } return s; };
  const wandnah = (x, y) => WANDNAH[kind(x, y - 1)] || WANDNAH[kind(x + 1, y)] || WANDNAH[kind(x, y + 1)] || WANDNAH[kind(x - 1, y)];
  const frei = (x, y) => {
    const kd = kind(x, y);
    if (!DEKO_BODEN[kd] || WEG[kd]) return false;
    return !istKantenmitte(x, y, k);
  };

  // Platz je Zelle (Zellen ohne Platz: Regel "*")
  const plaetze = (k.plaetze && k.plaetze.length ? k.plaetze : plaetzeAbleiten(k)).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const zelleZuPlatz = new Map();
  for (const p of plaetze) {
    for (let cy = Math.floor(p.y / ZELLE); cy < Math.ceil((p.y + p.h) / ZELLE); cy++) {
      for (let cx = Math.floor(p.x / ZELLE); cx < Math.ceil((p.x + p.w) / ZELLE); cx++) {
        const key = cx + ',' + cy;
        if (!zelleZuPlatz.has(key)) zelleZuPlatz.set(key, p);
      }
    }
  }
  const seed = (k.seed >>> 0) || fnv(String(k.id || 'karte'));
  const out = [];
  // Rollenmodus: Plätze mit Raumtyp-Eintrag; ihre Rechtecke sind für den Zellenmodus gesperrt
  // Ein Platz zählt nur, wenn seine Rollen für diese Bauweise mindestens eine streu-Rolle mit Belegung (nach Deckungs-Ausschluss) haben;
  // sonst bleibt er im Zellenmodus (kein Raum ohne Deko durch fehlende Belegung).
  const streuRollenVon = (def) => (def && Array.isArray(def.rollen) ? def.rollen : []).filter((e) => e && typeof e.rolle === 'string' && (e.kind || 'streu') === 'streu')
    .map((e) => ({ e, bel: belegungVon(RO.daten, e.rolle, RO.bauweise, RO.ausschluss) })).filter((r) => r.bel.length);
  // Hauptstücke (kind leit): Fußabdruck aus RO.leitFuss (bauweisen/<bw>.json leit_fuss), ohne Eintrag entfällt die Rolle
  const leitRollenVon = (def) => (def && Array.isArray(def.rollen) ? def.rollen : []).filter((e) => e && typeof e.rolle === 'string' && e.kind === 'leit')
    .map((e) => ({ e, bel: belegungVon(RO.daten, e.rolle, RO.bauweise, RO.ausschluss) })).filter((r) => r.bel.length);
  const fussVon = (id) => { const f = RO.leitFuss && hat(RO.leitFuss, id) ? RO.leitFuss[id] : null; return Array.isArray(f) && f.length === 2 && f[0] >= 1 && f[1] >= 1 ? [f[0] | 0, f[1] | 0] : null; };
  const sicher = (def) => { try { return streuRollenVon(def); } catch (e) { return []; } };   // kaputte Rollen-Datei: Platz bleibt im Zellenmodus
  // Raumtyp eines Platzes für die Rollen: Präfix der Platz-ID, überschrieben durch die Anker (nur Client, Karten bleiben unberührt): ein Platz mit
  // Anker sprengpunkt ist der Reaktorraum, ein Kontrollraum mit Anker terminal das Kommando (Module nennen ihre Plätze anders, z. B. messe_1 mit Schmiedeherd).
  const ankerJePlatz = new Map();
  for (const a of k.anker || []) { if (!a.platz) continue; if (!ankerJePlatz.has(a.platz)) ankerJePlatz.set(a.platz, new Set()); ankerJePlatz.get(a.platz).add(a.rolle); }
  const raumtypDe = (p) => {
    const t0 = raumtypVon(p.id), ar = ankerJePlatz.get(p.id);
    if (RO && ar) {
      if (ar.has('sprengpunkt') && hat(RO.daten.raumtypen, 'reaktor') && k.art === 'station') return 'reaktor';
      if (ar.has('terminal') && p.typ === 'kontrollraum' && hat(RO.daten.raumtypen, 'kommando')) return 'kommando';
    }
    return t0;
  };
  const rollenPlaetze = RO ? plaetze.filter((p) => hat(RO.daten.raumtypen, raumtypDe(p)) && sicher(RO.daten.raumtypen[raumtypDe(p)]).length) : [];
  const rollenFlaeche = rollenPlaetze.length ? new Uint8Array(W * H) : null;
  for (const p of rollenPlaetze) for (let y = Math.max(0, p.y); y < Math.min(H, p.y + p.h); y++) for (let x = Math.max(0, p.x); x < Math.min(W, p.x + p.w); x++) rollenFlaeche[y * W + x] = 1;
  const CW = Math.ceil(W / ZELLE), CH = Math.ceil(H / ZELLE);
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const p = zelleZuPlatz.get(cx + ',' + cy) || null;
    const typ = p ? p.typ : '*';
    const regel = regelFuer(typ, k.art, R);
    const props = ((regel && regel.props) || []).filter(Boolean);
    const pool = props.concat(extra);
    if (!pool.length) continue;
    const rnd = mulberry32(fnv((p ? p.id : '*') + ':' + cx + ':' + cy, seed));
    const d = (regel && regel.dichte) || [0, extra.length ? 1 : 0];
    const lo = Math.max(0, d[0] | 0), hi = Math.max(lo, d[1] | 0);
    let n = Math.min(MAX_JE_ZELLE, lo + Math.floor(rnd() * (hi - lo + 1)));
    if (!n) continue;
    const S = gesperrt(regel && regel.frei_halten != null ? regel.frei_halten : 1);
    const kand = [];
    for (let ly = 0; ly < ZELLE; ly++) for (let lx = 0; lx < ZELLE; lx++) {
      const x = cx * ZELLE + lx, y = cy * ZELLE + ly;
      if (x >= W || y >= H || S[y * W + x] || !frei(x, y) || (rollenFlaeche && rollenFlaeche[y * W + x])) continue;
      if (regel && regel.wandnah && !wandnah(x, y)) continue;
      kand.push([x, y]);
    }
    // Fisher-Yates mit dem Zell-RNG (Reihenfolge der Kandidaten ist fest: zeilenweise)
    for (let i = kand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = kand[i]; kand[i] = kand[j]; kand[j] = t; }
    n = Math.min(n, kand.length);
    for (let i = 0; i < n; i++) {
      const [x, y] = kand[i];
      // Besitz-Streuung nur selten (jedes vierte Prop), sonst Regel-Props
      const useExtra = extra.length && (!props.length || rnd() < 0.25);
      const extraOk = useExtra ? extra.filter((e) => !e.wandnah || wandnah(x, y)) : null;
      const list = useExtra ? (extraOk.length ? extraOk.map((e) => e.id) : props) : props;
      if (!list.length) continue;   // nur wandnahe Besitz-Props und keine Wand daneben
      const id = list[Math.floor(rnd() * list.length)];
      let rot = Math.floor(rnd() * 4) * (Math.PI / 2);
      const ex = useExtra && extraOk.find((e) => e.id === id);
      if ((regel && regel.wandnah) || (ex && ex.wandnah)) {
        // Rücken zur Wand: +z zeigt von der Wand weg
        if (WANDNAH[kind(x, y - 1)]) rot = 0; else if (WANDNAH[kind(x, y + 1)]) rot = Math.PI;
        else if (WANDNAH[kind(x - 1, y)]) rot = Math.PI / 2; else if (WANDNAH[kind(x + 1, y)]) rot = -Math.PI / 2;
      }
      out.push({ id, x, y, rot, seed: Math.floor(rnd() * 8), platz: p ? p.id : null, dx: (rnd() - 0.5) * 0.3, dz: (rnd() - 0.5) * 0.3 });
    }
  }
  if (rollenPlaetze.length) {
    const n0 = out.length;
    try { rollenStreuen(); } catch (e) { out.length = n0; if (typeof opts.onFehler === 'function') opts.onFehler(e); }   // kaputte Rollen-Datei: Zellen-Deko bleibt
  }
  return out;

  // ---- Rollenmodus: je Platzrechteck, je Rolle ein eigener Strom (läuft nach dem Zellenmodus, nutzt dessen Hilfen) ----
  function rollenStreuen() {
    const bw = RO.bauweise;
    const jeZelle = new Map(), belegt = new Set();
    const zKey = (x, y) => Math.floor(x / ZELLE) + ',' + Math.floor(y / ZELLE);
    for (const d of out) belegt.add(d.x + ',' + d.y);   // jeZelle zählt nur Rollen-Stücke (Obergrenze MAX_ROLLE_JE_ZELLE): so hängt das Layout nicht vom Zellenmodus der Bauweise ab (Parität)
    // freie Kacheln im Rechteck: Boden/Gelände/Plateau und (nur hier) der Innenboden boden2 der Gebäude; nie Anker, Tür, Pad, Rampe, Kantenmitte
    const kacheln = (p, fh) => {
      const S = gesperrt(fh), res = [], b2 = boden2Erlaubt(k.art, p.id);
      for (let y = Math.max(0, p.y); y < Math.min(H, p.y + p.h); y++) for (let x = Math.max(0, p.x); x < Math.min(W, p.x + p.w); x++) {
        const kd = kind(x, y);
        if (!(DEKO_BODEN[kd] || (kd === 'boden2' && b2)) || S[y * W + x] || istKantenmitte(x, y, k)) continue;
        res.push([x, y]);
      }
      return res;
    };
    // wahl(x, y) → { id, wand } | null; wand = Rücken zur Wand
    const nimm = (list, n, rnd, p, rolle, wahl) => {
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
      let got = 0;
      for (const [x, y] of list) {
        if (got >= n) break;
        const key = x + ',' + y, z = zKey(x, y);
        if (belegt.has(key) || (jeZelle.get(z) || 0) >= MAX_ROLLE_JE_ZELLE) continue;
        const w = wahl(x, y); if (!w) continue;
        let rot = Math.floor(rnd() * 4) * (Math.PI / 2);
        if (w.wand) {   // Rücken zur Wand: +z zeigt von der Wand weg
          if (WANDNAH[kind(x, y - 1)]) rot = 0; else if (WANDNAH[kind(x, y + 1)]) rot = Math.PI;
          else if (WANDNAH[kind(x - 1, y)]) rot = Math.PI / 2; else if (WANDNAH[kind(x + 1, y)]) rot = -Math.PI / 2;
        }
        out.push({ id: w.id, x, y, rot, seed: Math.floor(rnd() * 8), platz: p.id, dx: (rnd() - 0.5) * 0.3, dz: (rnd() - 0.5) * 0.3, rolle });
        belegt.add(key); jeZelle.set(z, (jeZelle.get(z) || 0) + 1); got++;
      }
    };
    // Hauptstück (kind leit, rein optisch): Fußabdruck-bewusst im Platzrechteck, nie auf gesperrten Kacheln (Anker/Tür + frei_halten, Kantenmitte,
    // Wege) und nie über die Raumgrenze. wandnah: Rücken (−z) liegt an einer Wand über die ganze Breite, sonst frei mit zufälliger Blickrichtung.
    // Versuche in dieser Reihenfolge (Ausfallquote niedrig halten): wandnah mit frei_halten fh … 1, dann (nur wandnahe Rollen ohne nur_wand)
    // frei stehend fh … 1, zuletzt mit Abstand 0 (nur Anker- und Türkachel selbst bleiben frei), erst wandnah, dann frei. Rotation: 0 Wand im Norden (Schauseite +z = Süden), π Süden,
    // π/2 Westen (Schauseite Osten), −π/2 Osten. Gerade Drehungen tauschen Breite und Tiefe des Fußes.
    const ROT = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
    function hauptstueck(p, h, fh0) {
      const [fw, fd] = h.fuss, rnd = h.rnd;
      const versuche = [];
      const sperreSued = p.h >= 3;   // Hauptstücke nie in der Südkachelreihe (Kamera blickt von Süden, die Hüllenwand verdeckt sie)
      const zurMitte = !!h.e.mitte && Math.min(p.w, p.h) >= 5;
      const wandErst = !!h.e.wandnah, freiOk = !wandErst || !h.e.nur_wand;
      // Südkachelreihe (sperre) zuerst; wandnah ohne Sperre vor dem freien Rückfall, damit der Rücken an der Wand bleibt
      for (let fh = fh0; fh >= 1; fh--) versuche.push([fh, wandErst, sperreSued]);
      if (wandErst && sperreSued) for (let fh = fh0; fh >= 1; fh--) versuche.push([fh, true, false]);
      if (wandErst && freiOk) for (let fh = fh0; fh >= 1; fh--) versuche.push([fh, false, sperreSued]);
      versuche.push([0, wandErst, sperreSued]);
      if (wandErst && sperreSued) versuche.push([0, true, false]);
      if (wandErst && freiOk) versuche.push([0, false, sperreSued]);
      for (const [fh, wand, sperre] of versuche) {
        const ok = new Set(kacheln(p, fh).map(([x, y]) => x + ',' + y).filter((key) => !belegt.has(key)));
        const opts = [];
        for (let ri = 0; ri < 4; ri++) {
          const ew = ri >= 2 ? fd : fw, eh = ri >= 2 ? fw : fd;
          for (let y0 = p.y; y0 + eh <= p.y + p.h; y0++) for (let x0 = p.x; x0 + ew <= p.x + p.w; x0++) {
            let frei = true;
            for (let y = y0; y < y0 + eh && frei; y++) for (let x = x0; x < x0 + ew; x++) if (!ok.has(x + ',' + y)) { frei = false; break; }
            if (!frei) continue;
            if (sperre && y0 + eh - 1 >= p.y + p.h - 1) continue;   // kamerazugewandte Südkachelreihe bleibt frei (verdeckt sonst durch die Hüllenwand)
            if (wand) {
              let rueck = true;
              if (ri === 0) { for (let x = x0; x < x0 + ew; x++) if (!WANDNAH[kind(x, y0 - 1)]) rueck = false; }
              else if (ri === 1) { for (let x = x0; x < x0 + ew; x++) if (!WANDNAH[kind(x, y0 + eh)]) rueck = false; }
              else if (ri === 2) { for (let y = y0; y < y0 + eh; y++) if (!WANDNAH[kind(x0 - 1, y)]) rueck = false; }
              else { for (let y = y0; y < y0 + eh; y++) if (!WANDNAH[kind(x0 + ew, y)]) rueck = false; }
              if (!rueck) continue;
            }
            opts.push([x0, y0, ri, ew, eh]);
          }
        }
        if (!opts.length) continue;
        if (zurMitte) {   // Raummitte (mitte: true, Platz mindestens 5 Kacheln tief): die Lage mit dem kleinsten Abstand zur Platzmitte zuerst
          const dm = (o) => Math.hypot(o[0] + o[3] / 2 - (p.x + p.w / 2), o[1] + o[4] / 2 - (p.y + p.h / 2));
          opts.sort((u, v) => dm(u) - dm(v));
        } else for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = opts[i]; opts[i] = opts[j]; opts[j] = t; }
        const [x0, y0, ri, ew, eh] = opts[0];
        const cx = x0 + ew / 2, cy = y0 + eh / 2, x = Math.floor(cx), y = Math.floor(cy);
        out.push({ id: h.id, x, y, rot: ROT[ri], seed: Math.floor(rnd() * 8), platz: p.id, dx: cx - (x + 0.5), dz: cy - (y + 0.5), rolle: h.e.rolle, fuss: [x0, y0, ew, eh] });
        for (let yy = y0; yy < y0 + eh; yy++) for (let xx = x0; xx < x0 + ew; xx++) belegt.add(xx + ',' + yy);
        const z = zKey(x, y); jeZelle.set(z, (jeZelle.get(z) || 0) + 1);
        return true;
      }
      return false;
    }
    for (const p of rollenPlaetze) {
      const def = RO.daten.raumtypen[raumtypDe(p)];
      const rollen = streuRollenVon(def);
      rollen.sort((a, b) => (b.e.pflicht ? 1 : 0) - (a.e.pflicht ? 1 : 0));   // Pflichtrollen zuerst (stabil)
      for (const r of rollen) {
        r.rnd = mulberry32(fnv(p.id + ':' + r.e.rolle, seed));
        // große Räume (Platzfläche ≥ GROSS_AB Kacheln) nehmen zug_gross, sofern die Rolle es nennt (4–6 Stücke auch in großen Räumen)
        const zg = p.w * p.h >= GROSS_AB && Array.isArray(r.e.zug_gross) && r.e.zug_gross.length === 2 ? r.e.zug_gross : null;
        const z = zg || (Array.isArray(r.e.zug) && r.e.zug.length === 2 ? r.e.zug : [1, 1]);
        const lo = Math.max(0, z[0] | 0), hi = Math.max(lo, z[1] | 0);
        r.n = lo + Math.floor(r.rnd() * (hi - lo + 1));
        if (r.e.pflicht) r.n = Math.max(1, r.n);
      }
      const extraRnd = extra.length ? mulberry32(fnv(p.id + ':besitz', seed)) : null;
      // Hauptstücke: Belegung und Fußabdruck vorab (Wahl = erster Zug des Rollenstroms, unabhängig von der Bauweise)
      const haupt = [];
      for (const r of leitRollenVon(def)) {
        const rnd = mulberry32(fnv(p.id + ':' + r.e.rolle, seed));
        const id = r.bel[Math.floor(rnd() * r.bel.length)], fuss = fussVon(id);
        if (fuss) haupt.push({ e: r.e, id, fuss, rnd });
      }
      const soll = rollen.reduce((s, r) => s + r.n, 0) + (extraRnd ? 1 : 0) + haupt.reduce((s, h) => s + h.fuss[0] * h.fuss[1], 0);
      if (!soll) continue;
      // Kapazität: reicht frei_halten nicht, schrittweise kleiner (nie unter 1: Anker und Türen bleiben frei)
      let fh = Math.max(1, Math.min(4, (def.frei_halten != null ? def.frei_halten : 1) | 0)), kand;
      for (;;) { kand = kacheln(p, fh); if (kand.length >= soll || fh <= 1) break; fh--; }
      if (RO.bericht) RO.bericht[p.id] = { frei_halten: fh, gewuenscht: Math.max(1, Math.min(4, (def.frei_halten != null ? def.frei_halten : 1) | 0)), kandidaten: kand.length, soll };
      // Hauptstücke zuerst (Streu weicht ihnen aus); kein Platz → entfällt ohne Fehler
      for (const h of haupt) hauptstueck(p, h, fh);
      for (const r of rollen) {
        const wand = !!r.e.wandnah;
        nimm(kand.filter(([x, y]) => !wand || wandnah(x, y)), r.n, r.rnd, p, r.e.rolle, () => ({ id: r.bel[Math.floor(r.rnd() * r.bel.length)], wand }));
      }
      if (extraRnd) {   // Besitz-Streuung: ein Stück je Platz (Banner usw.; wandnahe Einträge nur an der Wand)
        nimm(kand.filter(([x, y]) => extra.some((e) => !e.wandnah || wandnah(x, y))), 1, extraRnd, p, 'besitz', (x, y) => {
          const ok = extra.filter((e) => !e.wandnah || wandnah(x, y));
          const e = ok[Math.floor(extraRnd() * ok.length)];
          return { id: e.id, wand: e.wandnah };
        });
      }
    }
  }
}

/** Prüfung für Tests/QA: verletzt eine Streuung die Vertragsregeln? → Liste der Verstöße (leer = gut). */
export function pruefeStreuung(k, liste) {
  const fehler = [];
  const anker = new Set((k.anker || []).map((a) => (a.x | 0) + ',' + (a.y | 0)));
  const jeZelle = new Map();
  for (const d of liste) {
    // Hauptstücke (fuss = [x0, y0, w, h]) belegen mehrere Kacheln: jede wird wie ein Streustück geprüft
    const tiles = [];
    if (Array.isArray(d.fuss)) { for (let y = d.fuss[1]; y < d.fuss[1] + d.fuss[3]; y++) for (let x = d.fuss[0]; x < d.fuss[0] + d.fuss[2]; x++) tiles.push([x, y]); }
    else tiles.push([d.x, d.y]);
    for (const [tx, ty] of tiles) {
      const kd = k.kindAt(tx, ty);
      if (anker.has(tx + ',' + ty)) fehler.push('Anker ' + tx + ',' + ty);
      if (TUER[kd]) fehler.push('Tür ' + tx + ',' + ty);
      const innen = d.rolle && kd === 'boden2' && boden2Erlaubt(k.art, d.platz);   // Rollenmodus: Innenboden der Außenposten-Gebäude (siehe streuen)
      if (WEG[kd] && !innen) fehler.push('Weg ' + tx + ',' + ty);
      if (!DEKO_BODEN[kd] && !innen) fehler.push('fest/kein Boden ' + tx + ',' + ty + ' (' + kd + ')');
      if (d.rolle && k.plaetze) { const p = k.plaetze.find((q) => q.id === d.platz); if (!p || tx < p.x || ty < p.y || tx >= p.x + p.w || ty >= p.y + p.h) fehler.push('Rolle außerhalb des Platzes ' + tx + ',' + ty + ' (' + d.platz + ')'); }
      if (istKantenmitte(tx, ty, k)) fehler.push('Kantenmitte ' + tx + ',' + ty);
    }
    const z = Math.floor(d.x / ZELLE) + ',' + Math.floor(d.y / ZELLE);
    jeZelle.set(z, (jeZelle.get(z) || 0) + 1);
  }
  for (const [z, n] of jeZelle) if (n > MAX_JE_ZELLE) fehler.push('Zelle ' + z + ': ' + n + ' > ' + MAX_JE_ZELLE);
  return fehler;
}
