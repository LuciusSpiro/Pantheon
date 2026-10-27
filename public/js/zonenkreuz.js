// SYS-01 A1c: „Zonenkreuz“ – die Systeme der Lerche als Kreuz aus fünf Kacheln (Bug oben, Bb links, Stb rechts, Heck unten, Mitte im Zentrum).
// Richtung B (Kai 2026-10-27). Globales `Zonenkreuz`, in Node als Modul (Test). Zwei Teile:
//   modell(state, opts)   rein: baut aus dem Snapshot (ship.integ + Protocol.SYSTEMS_INTEG, ship.systems, ship.zonen, ship.shields, ship.zielAuf) die Kacheln.
//                         Keine zweite Regel: Zustand und Prozent kommen vom Server, „Zone leer“ ist ship.zonen[i] === 0 (alle aktiven Systeme zerstört, Server-Regel),
//                         die Zone je System aus der Schiffslegende (shared/maps.js, Feld sector).
//   zeichne(ctx, m, rect, o)   zeichnet das Kreuz mit Farben, Maßen und Zeichen aus PultSysteme.TOKENS (keine eigenen Farbwerte hier).
// Darstellung: Zeile je System (Name, Integrität als Balken, Ops-Ziffer als Kappe bei Waffen), Schild als Balkenreihe an der Außenkante der Kachel,
// leere Zone gestrichelt in Rot mit LEER, die Wand zur Mitte öffnet sich (eigenes Schiff Rot, Gegner Bernstein), Mitte schraffiert „ZU“, solange die
// zugewandte Zone (o.zugewandt) nicht leer ist. Gegnerziel: Zeile in gezieltZeile mit → (o.gezieltId). Kein Zustand, keine Netzzugriffe.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Zonenkreuz = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const req = (p) => (typeof require === 'function' ? require(p) : null);
  const PS = root.PultSysteme || req('./pult-systeme-tokens.js');
  const Proto = root.Shared_Protocol || req('../../shared/protocol.js');
  const Maps = root.Shared_Maps || req('../../shared/maps.js');
  const ZONEN = ['bug', 'stb', 'heck', 'bb'];   // Index = Sektor des Servers (0 Bug, 1 Steuerbord, 2 Heck, 3 Backbord)
  const SCHILD_MAX = 4;                           // Segmente je Seite (config.shields, Technik-Pult)

  // ---------------------------------------------------------------- Zone je System (aus der Schiffslegende, wie interior.systemSector)
  let SEKTOR = null, PLATZ = null;
  function tabellen() {
    if (SEKTOR) return;
    SEKTOR = {}; PLATZ = {};
    const m = Maps && Maps.ship;
    if (m && m.legend && m.at) {
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const info = m.legend[m.at(x, y)];
        if (info && info.system && Number.isInteger(info.sector)) SEKTOR[info.system] = info.sector;
      }
    }
    for (const p of (Maps && Maps.WAFFENPLAETZE) || []) { PLATZ[p.system] = p.platz; if (SEKTOR[p.system] == null) SEKTOR[p.system] = p.sector; }
  }
  const sektorVon = (id) => { tabellen(); return SEKTOR[id] == null ? -1 : SEKTOR[id]; };
  const platzVon = (id) => { tabellen(); return PLATZ[id] || null; };

  // ---------------------------------------------------------------- Modell
  // Zustand eines Systems: Server-Zustand (ship.systems) und Prozent zusammen; offline (EMP) und zerstört haben eigene Form.
  function zustandVon(pct, state) {
    if (state === 'offline') return 'offline';
    if (state === 'broken' || !(pct > 0)) return 'zer';
    return state === 'damaged' ? 'besch' : PS.zustand(pct, 100);
  }
  // opts.name(id) -> Anzeigename; opts.reihenfolge: Liste der System-IDs (Reihenfolge der Zeilen), sonst die der Snapshot-Positionen
  function modell(state, opts) {
    opts = opts || {};
    const ship = (state && state.ship) || {};
    const ids = (Proto && Proto.SYSTEMS_INTEG) || [];
    const integ = Array.isArray(ship.integ) ? ship.integ : [];
    const sys = ship.systems || {};
    const frag = new Set(Array.isArray(ship.fragile) ? ship.fragile : []);
    const name = opts.name || ((id) => id);
    const reihe = opts.reihenfolge || ids;
    const zonen = {}; ZONEN.forEach((z) => { zonen[z] = { sys: [], schild: [], leer: false }; });
    const mitte = { sys: [] };
    const pos = {}; ids.forEach((id, i) => { pos[id] = i; });
    const sh = ship.shields || {}, cur = sh.current || [0, 0, 0, 0], cap = Array.isArray(sh.cap) ? sh.cap : [SCHILD_MAX, SCHILD_MAX, SCHILD_MAX, SCHILD_MAX];
    for (const id of reihe) {
      const i = pos[id];
      if (i == null) continue;
      const pct = integ[i];
      if (!(pct >= 0)) continue;   // -1 = nicht aktiv (Lafette ohne Waffe, Modulraum ohne Modul)
      const s = sys[id] || 'ok', sk = sektorVon(id);
      const e = { id, name: name(id), pct, state: s, zust: zustandVon(pct, s), platz: platzVon(id), fragil: frag.has(id), idx: i };
      (sk >= 0 && sk < 4 ? zonen[ZONEN[sk]] : mitte).sys.push(e);
    }
    const zz = Array.isArray(ship.zonen) ? ship.zonen : null;
    ZONEN.forEach((z, i) => {
      const o = zonen[z];
      o.schild = [{ v: Math.max(0, Math.min(SCHILD_MAX, +cur[i] || 0)), max: SCHILD_MAX, cap: Math.max(0, Math.min(SCHILD_MAX, cap[i] == null ? SCHILD_MAX : +cap[i])) }];
      o.leer = zz ? zz[i] === 0 : o.sys.length > 0 && o.sys.every((e) => e.state === 'broken');   // Server-Zahl, sonst derselbe Zustand
      o.pct = zz ? zz[i] : -1;
    });
    const gezielt = Number.isInteger(ship.zielAuf) && ship.zielAuf >= 0 ? ids[ship.zielAuf] || null : null;
    return { zonen, mitte, offen: ZONEN.filter((z) => zonen[z].leer), reaktorZer: sys.reactor === 'broken', gezieltId: gezielt };
  }
  // System-ID -> Eintrag
  function eintrag(m, id) {
    for (const z of ZONEN) { const e = m.zonen[z].sys.find((q) => q.id === id); if (e) return e; }
    return m.mitte.sys.find((q) => q.id === id) || null;
  }

  // ---------------------------------------------------------------- Zeichnen
  const T = PS.TOKENS, MASS = T.MASS, ZEICHEN = T.ZEICHEN, TEXT = T.TEXT;
  function zeichne(c, m, rect, o) {
    o = o || {};
    const R = (o.env && o.env.R) || root.Render, P = (o.env && o.env.P) || root.Pult;   // env: Test ohne Browser
    const F = PS.farben(o.skin || (P && P.skin && P.skin.id) || 'rom');
    const mass = Object.assign({}, MASS.kreuz.technik, o.mass || {});
    const rc = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const rand = (x, y, w, h, col) => { rc(x, y, w, 1, col); rc(x, y + h - 1, w, 1, col); rc(x, y, 1, h, col); rc(x + w - 1, y, 1, h, col); };
    const strich = (x, y, w, h, col, s) => { c.fillStyle = col; for (let i = 0; i < w; i += s) { c.fillRect(x + i, y, 1, 1); c.fillRect(x + i, y + h - 1, 1, 1); } for (let i = 0; i < h; i += s) { c.fillRect(x, y + i, 1, 1); c.fillRect(x + w - 1, y + i, 1, 1); } };
    const schraffur = (x, y, w, h, col, s) => { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.fillStyle = col; for (let d = -h; d < w; d += s) for (let r = 0; r < h; r++) c.fillRect(x + d + r, y + r, 1, 1); c.restore(); };
    const txt = (s, x, y, col, align, scale) => R.text(c, String(s), x, y, { color: col, align: align || 'left', scale: scale || 1, shadow: false });
    const tw = (s) => R.measure(String(s), 1);
    const L = PS.lage(rect, mass);
    const bodies = {};

    // Schild: Balkenreihe an der Außenkante; Segmente über der Kappung (Emitter beschädigt) rot schraffiert
    function schildKante(t, z) {
      const d = mass.schild, f = mass.schichtFuge, body = Object.assign({}, t), hor = t.kante === 'o' || t.kante === 'u';
      z.schild.forEach((l, j) => {
        const len = (hor ? t.w : t.h) - 4, sw = Math.max(1, Math.floor((len - (l.max - 1)) / l.max));
        for (let k = 0; k < l.max; k++) {
          const off = 2 + k * (sw + 1); let x, y, w, h;
          if (t.kante === 'o') { x = t.x + off; y = t.y + j * (d + f); w = sw; h = d; }
          else if (t.kante === 'u') { x = t.x + off; y = t.y + t.h - (j + 1) * (d + f) + f; w = sw; h = d; }
          else if (t.kante === 'l') { x = t.x + j * (d + f); y = t.y + off; w = d; h = sw; }
          else { x = t.x + t.w - (j + 1) * (d + f) + f; y = t.y + off; w = d; h = sw; }
          if (k < l.v) rc(x, y, w, h, F.schild);
          else if (k >= l.cap) { rc(x, y, w, h, F.schildUnt); schraffur(x, y, w, h, F.schildUntStrich, mass.schraffurUnt || MASS.schraffurUnt); }
          else { rc(x, y, w, h, F.schildLeerRand); if (w > 2 && h > 2) rc(x + 1, y + 1, w - 2, h - 2, F.schildLeer); }
        }
      });
      const s = z.schild.length * (d + f) + 1;
      if (t.kante === 'o') { body.y += s; body.h -= s; } else if (t.kante === 'u') body.h -= s; else if (t.kante === 'l') { body.x += s; body.w -= s; } else body.w -= s;
      return body;
    }
    // Integrität: Balken (Anteil der Prozent) in Zustandsfarbe, Rest in pipLeer; zerstört = Strich, offline = hohler Rahmen
    function balken(x, y, w, e) {
      const h = 4;
      if (e.zust === 'zer') { rc(x, y + h - 1, w, 1, F.zer); return; }
      if (e.zust === 'offline') { rand(x, y, w, h, F.offline); return; }
      rc(x, y, w, h, F.pipLeer);
      rc(x, y, Math.max(1, Math.round(w * Math.min(100, e.pct) / 100)), h, F[e.zust === 'besch' ? 'besch' : 'ok']);
    }
    function inhalt(list, body, zn, zu) {
      const zwei = body.w < mass.zweiZeilig, lh = zwei ? 16 : mass.zeile, bw = zwei ? 24 : 30;
      let y = body.y + 3;
      list.forEach((e) => {
        if (y + 8 > body.y + body.h) return;
        const sel = o.selId === e.id, gez = o.gezieltId === e.id;
        if (sel || gez) { rc(body.x + 1, y - 2, body.w - 2, lh - 1, gez ? F.gezieltZeile : F.systemzielZeile); rc(body.x + 1, y - 2, MASS.systemzielMarke, lh - 1, gez ? F.gezielt : F.systemziel); }
        let x = body.x + MASS.innen;
        if (gez) { txt(ZEICHEN.gezielt, x, y, F.gezielt); x += 8; }
        if (mass.tasten && e.platz) { rc(x, y - 1, 9, 9, P.mix(T.FN.weapon, F.grund, 0.55)); txt(e.platz, x + 5, y, F.text, 'center'); x += 12; }
        const col = gez ? F.gezielt : sel ? F.systemziel : e.zust === 'zer' ? F.zerText : e.zust === 'offline' ? F.dim : zu ? F.dim : F.text;
        txt(e.name, x, y, col);
        const rechts = body.x + body.w - MASS.innen;
        if (e.zust === 'zer') {
          const wort = x + tw(e.name) + 6 + tw(ZEICHEN.zerLang) <= rechts - 2 ? ZEICHEN.zerLang : ZEICHEN.zerKurz;
          txt(wort, rechts, y, F.zerText, 'right');
        } else if (zwei) balken(body.x + MASS.innen, y + 9, body.w - 2 * MASS.innen, e);
        else {
          if (e.zust === 'offline') txt(ZEICHEN.offline, rechts - bw - 4, y, F.dim, 'right');
          balken(rechts - bw, y + 1, bw, e);
        }
        if (o.queued) {   // Schrauberstrich unter der Zeile: in der Reparaturliste (gedimmt) bzw. ein Schrauber arbeitet daran (voll)
          const q = o.queued(e.id);
          if (q) rc(body.x + MASS.innen, y + 8, body.w - 2 * MASS.innen, 1, q === 2 ? F.schild : P.mix(F.schild, F.kachel, 0.55));
        }
        if (o.klick && R.ui && R.ui.buttons) R.ui.buttons.push({ x: body.x + 1, y: y - 2, w: body.w - 2, h: lh - 1, label: e.name, hotkey: null, onClick: () => o.klick(e) });
        y += lh;
      });
    }

    ZONEN.forEach((zn) => {
      const z = m.zonen[zn], t = L[zn], body = schildKante(t, z);
      bodies[zn] = body;
      rc(body.x, body.y, body.w, body.h, z.leer ? F.kachelLeer : F.kachel);
      if (z.leer) strich(body.x, body.y, body.w, body.h, F.zer, 2); else rand(body.x, body.y, body.w, body.h, F.kachelRand);
      if (o.seite === zn) rand(t.x - MASS.seiteRahmen, t.y - MASS.seiteRahmen, t.w + 2 * MASS.seiteRahmen, t.h + 2 * MASS.seiteRahmen, F.seiteZugewandt);
      inhalt(z.sys, body, zn, false);
      if (z.leer && body.w >= mass.zweiZeilig) txt(ZEICHEN.leer, body.x + body.w - MASS.innen, body.y + body.h - 10, F.zerText, 'right');
    });
    // Mitte: zu (schraffiert), solange die zugewandte Zone nicht leer ist; sonst offen. Reaktor zerstört = Fläche kachelReaktor.
    const mt = L.mitte, zu = !!o.zugewandt && !m.zonen[o.zugewandt].leer;
    rc(mt.x, mt.y, mt.w, mt.h, m.reaktorZer ? F.kachelReaktor : F.kachel);
    rand(mt.x, mt.y, mt.w, mt.h, m.reaktorZer ? F.zer : F.kachelRand);
    const wc = o.gegner ? F.wandGegner : F.wandEigen, wd = MASS.wand;
    m.offen.forEach((zn) => {   // die Wand zur leeren Zone steht offen
      if (zn === 'bb') rc(mt.x - 3, mt.y + 2, 3 + wd, mt.h - 4, wc);
      if (zn === 'stb') rc(mt.x + mt.w - wd, mt.y + 2, 3 + wd, mt.h - 4, wc);
      if (zn === 'bug') rc(mt.x + 2, mt.y - 3, mt.w - 4, 3 + wd, wc);
      if (zn === 'heck') rc(mt.x + 2, mt.y + mt.h - wd, mt.w - 4, 3 + wd, wc);
    });
    inhalt(m.mitte.sys, { x: mt.x + 2, y: mt.y + 2, w: mt.w - 4, h: mt.h - 4 }, 'mitte', zu);
    if (zu) {
      schraffur(mt.x + 1, mt.y + 1, mt.w - 2, mt.h - 2, F.zuSchraffur, MASS.schraffurZu);
      const w2 = tw(ZEICHEN.zu) + 6;
      rc(mt.x + mt.w - w2 - 1, mt.y + mt.h - 11, w2, 10, F.grund); txt(ZEICHEN.zu, mt.x + mt.w - 4, mt.y + mt.h - 9, F.zuText, 'right');
    }
    return { kacheln: L, bodies, mitte: mt, zu };
  }

  return { ZONEN, modell, eintrag, zeichne, zustandVon, sektorVon, platzVon };
});
