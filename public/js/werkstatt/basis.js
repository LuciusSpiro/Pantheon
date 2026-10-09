// Werkstatt/Galerie: gemeinsame Client-Basis (CONTRACT-B1 §4, Team WERKSTATT).
// - Daten laden (Bündel aus /werkstatt/daten, Rückfall /content/buehnen/index.json, sobald ENGINE es ausliefert)
// - 2D-Rasterdarstellung nach Kachelart (Rückfall der Voxelvorschau, bleibt dauerhaft)
// - kleine DOM-Hilfe h()
// Alle Bühnenregeln kommen aus window.Shared_Buehne (shared/buehne.js); hier wird nichts nachgebaut.
(function (root) {
  'use strict';
  const B = () => root.Shared_Buehne;

  // ---------------- Daten ----------------
  async function holeJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) { const e = new Error(`${url}: HTTP ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }
  // -> { buendel, weg: 'werkstatt' | 'content', speichernMoeglich }
  // Abnahme F8: /werkstatt/daten liefert der Server immer (Lesen); `speichern` sagt, ob POST /werkstatt/save erlaubt ist.
  async function ladeDaten(quelle) {
    let grund = null;
    try {
      const b = await holeJson('/werkstatt/daten?quelle=' + encodeURIComponent(quelle || 'content'));
      return { buendel: b, weg: 'werkstatt', speichernMoeglich: b.speichern !== false };
    } catch (e) { grund = e; /* alter Server ohne Leseroute -> Rückfall */ }
    try {
      // Rückfall (Wunsch an ENGINE): /content/buehnen/ wird ausgeliefert und führt eine index.json { module: [pfad], schablonen: [pfad] }
      const idx = await holeJson('/content/buehnen/index.json');
      const voc = async (n) => { try { return await holeJson('/content/buehnen/' + n + '.json'); } catch (e) { return null; } };
      const b = { quelle: 'content', kacheln: await voc('kacheln'), anker: await voc('anker'), achsen: await voc('achsen'), zustaende: await voc('zustaende'), module: [], schablonen: [] };
      for (const [feld, liste] of [['module', idx.module || []], ['schablonen', idx.schablonen || []]]) {
        const geladen = await Promise.all(liste.map((p) => holeJson('/content/buehnen/' + p).then((o) => Object.assign(o, { _datei: p })).catch(() => null)));
        b[feld] = geladen.filter(Boolean);
      }
      return { buendel: b, weg: 'content', speichernMoeglich: false };
    } catch (e) {
      const f = new Error('Bühnendaten nicht erreichbar (' + (grund && grund.status ? '/werkstatt/daten: HTTP ' + grund.status : (grund && grund.message) || 'kein Server') + '). Läuft der Spielserver dieses Repos? Zum Speichern: npm run werkstatt.');
      f.ohneDaten = true;
      throw f;
    }
  }
  function klon(o) { return JSON.parse(JSON.stringify(o)); }
  // Bündel mit ersetztem/ergänztem Modul oder Schablone (für Live-Bau mit ungespeicherten Änderungen)
  function mitErsatz(buendel, obj) {
    const b = Object.assign({}, buendel);
    if (obj && obj.format === 'schablone/1') b.schablonen = (buendel.schablonen || []).filter((s) => s.id !== obj.id).concat([obj]);
    else if (obj) b.module = (buendel.module || []).filter((m) => m.id !== obj.id).concat([obj]);
    return b;
  }
  function standardBauweise(buendel, art) {
    const a = buendel && buendel.achsen && buendel.achsen.kartenarten && buendel.achsen.kartenarten[art];
    return (a && a.bauweise) || (art === 'ruine' ? 'rom' : 'germanen');
  }
  function standardZustand(buendel, art) {
    const a = buendel && buendel.achsen && buendel.achsen.kartenarten && buendel.achsen.kartenarten[art];
    return (a && a.zustand) || 'intakt';
  }
  function achse(buendel, name) {
    const a = buendel && buendel.achsen && buendel.achsen[name];
    return a ? Object.keys(a).filter((k) => !a[k] || a[k].status !== 'spaeter') : [];
  }

  // ---------------- Farben ----------------
  const KIND_FARBE = {
    boden: '#3b4252', boden2: '#4b5163', gelaende: '#3c4a3b', plateau: '#776f45', rampe: '#9a8550', kante: '#b59a5c',
    wand: '#1a1d25', zaun: '#5d4630', gitter: '#5b6b7c', fenster: '#3f8fbf', fels: '#2b2925', abgrund: '#0b1532', leere: '#050608',
    deckung_halb: '#8a7740', deckung_voll: '#a5602e', pfeiler: '#8b8f99', truemmer: '#6e5d49', schutt: '#4c3d2d',
    tuer: '#d08a3c', schott: '#4fb0d0', tor: '#e0b030', luke: '#6fbf6f', wand_schwach: '#7a5368', pad: '#3f74ad',
  };
  const KANTE_FARBE = { offen: '#5fd38d', tuer: '#f2994a', wand: '#6b7383', frei: '#56ccf2' };
  const ROLLE_FARBE = {
    eingang: '#5fd38d', abholpunkt: '#56ccf2', wache: '#eb5757', patrouille: '#f2c94c', deckung: '#a0a8b8', terminal: '#9b51e0',
    sprengpunkt: '#ff6b3d', zelle: '#c2a4ff', beute: '#e0b030', ziel: '#ffffff', fund: '#ffd86b', tor: '#d08a3c', raetsel: '#ff7bd5',
    aussicht: '#7fe0c2', nsc: '#9fd8ff', versteck: '#b08968', lift: '#4fb0d0', leiter: '#4fb0d0',
  };
  const BEREICH_FARBE = ['#56ccf2', '#f2c94c', '#eb5757', '#5fd38d', '#bb6bd9', '#f2994a', '#9fd8ff', '#c2a4ff'];
  const ROLLE_BEREICH_FARBE = { hinein: '#5fd38d', ziel: '#eb5757', rueckzug: '#56ccf2' };

  function zeichenInfo(buendel, ch) { return (buendel && buendel.kacheln && buendel.kacheln.zeichen[ch]) || null; }
  function farbeVon(buendel, ch) {
    const i = zeichenInfo(buendel, ch);
    return i ? (KIND_FARBE[i.kind] || '#ff00ff') : '#ff2d55';
  }
  function glyphe(rolle) { const g = B() && B().ANKER_GLYPHE; return (g && g[rolle]) || '?'; }

  // ---------------- Zeichnen ----------------
  // rows -> Kacheln. o: { px, ox, oy, zeichen (Zeichen einblenden), alpha }
  function zeichneRows(ctx, buendel, rows, o) {
    const px = o.px, ox = o.ox || 0, oy = o.oy || 0;
    for (let y = 0; y < rows.length; y++) {
      const r = rows[y];
      for (let x = 0; x < r.length; x++) {
        const ch = r[x];
        const info = zeichenInfo(buendel, ch);
        ctx.fillStyle = farbeVon(buendel, ch);
        ctx.fillRect(ox + x * px, oy + y * px, px, px);
        if (!info) {   // unbekannt: rot schraffiert
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(ox + x * px, oy + y * px); ctx.lineTo(ox + (x + 1) * px, oy + (y + 1) * px); ctx.stroke();
          continue;
        }
        if (px >= 6) {
          if (info.kante === 'tuer') {   // Türen: Querbalken
            ctx.fillStyle = 'rgba(0,0,0,.45)';
            ctx.fillRect(ox + x * px + px * 0.15, oy + y * px + px * 0.42, px * 0.7, px * 0.16);
          } else if (info.kind === 'deckung_halb' || info.kind === 'deckung_voll' || info.kind === 'pfeiler') {
            ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = Math.max(1, px / 10);
            ctx.strokeRect(ox + x * px + px * 0.18, oy + y * px + px * 0.18, px * 0.64, px * 0.64);
          } else if (info.kind === 'gitter' || info.kind === 'fenster') {
            ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(ox + x * px + px / 2, oy + y * px); ctx.lineTo(ox + x * px + px / 2, oy + (y + 1) * px); ctx.stroke();
          } else if (info.kind === 'wand' || info.kind === 'fels') {
            ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(ox + x * px, oy + y * px, px, Math.max(1, px * 0.12));
          }
        }
        if (o.zeichen && px >= 14) {
          ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.font = `${Math.round(px * 0.45)}px ui-monospace, Consolas, monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(ch, ox + x * px + px / 2, oy + y * px + px / 2 + 1);
        }
      }
    }
  }
  // Belegung (o/O/I) halbtransparent über rows
  function zeichneBelegung(ctx, buendel, beleg, o) {
    const px = o.px, ox = o.ox || 0, oy = o.oy || 0;
    ctx.save(); ctx.globalAlpha = o.alpha == null ? 0.75 : o.alpha;
    for (let y = 0; y < beleg.length; y++) for (let x = 0; x < beleg[y].length; x++) {
      const ch = beleg[y][x]; if (ch === '.' || ch === ' ') continue;
      ctx.fillStyle = farbeVon(buendel, ch);
      ctx.fillRect(ox + x * px + px * 0.1, oy + y * px + px * 0.1, px * 0.8, px * 0.8);
      ctx.strokeStyle = '#f2c94c'; ctx.lineWidth = Math.max(1, px / 12);
      ctx.strokeRect(ox + x * px + px * 0.1, oy + y * px + px * 0.1, px * 0.8, px * 0.8);
    }
    ctx.restore();
  }
  // Anker: [{ x, y, rolle, ch? }] -> Kreis in Rollenfarbe + Glyphe
  function zeichneAnker(ctx, anker, o) {
    const px = o.px, ox = o.ox || 0, oy = o.oy || 0;
    for (const a of anker) {
      const cx = ox + a.x * px + px / 2, cy = oy + a.y * px + px / 2;
      const r = Math.max(2, px * 0.42);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = ROLLE_FARBE[a.rolle] || '#ff00ff'; ctx.fill();
      ctx.lineWidth = Math.max(1, px / 14); ctx.strokeStyle = a.ankunft ? '#ffffff' : 'rgba(0,0,0,.7)'; ctx.stroke();
      if (px >= 9) {
        ctx.fillStyle = '#10131a'; ctx.font = `bold ${Math.round(px * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(o.mitZeichen && a.ch ? a.ch : glyphe(a.rolle), cx, cy + 1);
      }
    }
  }
  function zeichneFehler(ctx, liste, o) {
    const px = o.px, ox = o.ox || 0, oy = o.oy || 0;
    for (const f of liste || []) {
      if (f.x == null || f.y == null) continue;
      const cx = ox + f.x * px + px / 2, cy = oy + f.y * px + px / 2;
      ctx.strokeStyle = f.warnung ? '#f2c94c' : '#ff2d55'; ctx.lineWidth = Math.max(2, px / 6);
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(4, px * 0.8), 0, Math.PI * 2); ctx.stroke();
    }
  }
  // Kanten eines Moduls (Lage) als farbige Balken außen. kanten: { N: [typ…], O, S, W } (Schiff: W/O je 3 Gänge in Zeile 2/6/10)
  function zeichneKanten(ctx, kanten, w, h, o) {
    const px = o.px, ox = o.ox || 0, oy = o.oy || 0, d = o.dicke || Math.max(3, px * 0.3);
    if (!kanten) return;
    const schiff = !kanten.N && kanten.W && kanten.W.length === 3 && h === 13;
    for (const seite of ['N', 'O', 'S', 'W']) {
      const liste = kanten[seite]; if (!liste) continue;
      liste.forEach((typ, i) => {
        ctx.fillStyle = KANTE_FARBE[typ] || '#ff00ff';
        if (schiff) {
          const zy = [2, 6, 10][i];
          const x = seite === 'W' ? ox - d - 2 : ox + w * px + 2;
          ctx.fillRect(x, oy + zy * px, d, px);
          return;
        }
        if (seite === 'N') ctx.fillRect(ox + i * 8 * px + px, oy - d - 2, 6 * px, d);
        if (seite === 'S') ctx.fillRect(ox + i * 8 * px + px, oy + h * px + 2, 6 * px, d);
        if (seite === 'W') ctx.fillRect(ox - d - 2, oy + i * 8 * px + px, d, 6 * px);
        if (seite === 'O') ctx.fillRect(ox + w * px + 2, oy + i * 8 * px + px, d, 6 * px);
        if (o.mitText && px * 6 >= 30) {
          ctx.fillStyle = '#0d1018'; ctx.font = `${Math.max(9, Math.round(d * 0.8))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const tx = seite === 'N' || seite === 'S' ? ox + i * 8 * px + 4 * px : (seite === 'W' ? ox - d / 2 - 2 : ox + w * px + 2 + d / 2);
          const ty = seite === 'W' || seite === 'O' ? oy + i * 8 * px + 4 * px : (seite === 'N' ? oy - d / 2 - 2 : oy + h * px + 2 + d / 2);
          if (seite === 'N' || seite === 'S') ctx.fillText(typ, tx, ty + 1);
        }
      });
    }
  }
  // ganze Karte (Format §2). o: { px, anker, bereiche, plaetze, patrouillen, cover, fehler: [..], warnungen: [..], markPlaetze: Set, zeichen }
  function zeichneKarte(ctx, buendel, karte, o) {
    const px = o.px, ox = o.ox || 0, oy = o.oy || 0;
    ctx.fillStyle = '#050608'; ctx.fillRect(ox, oy, karte.w * px, karte.h * px);
    zeichneRows(ctx, buendel, karte.rows, o);
    // verschlossene/gesprengte Kanten (Zustand)
    for (const id of Object.keys(karte.kanten || {})) {
      const k = karte.kanten[id]; if (!k.zustand) continue;
      ctx.strokeStyle = k.zustand === 'verschlossen' ? '#ff2d55' : k.zustand === 'gesprengt' ? '#ffb020' : '#5fd38d';
      ctx.lineWidth = Math.max(1, px / 5);
      for (const [x, y] of k.tiles || []) ctx.strokeRect(ox + x * px + 1, oy + y * px + 1, px - 2, px - 2);
    }
    if (o.bereiche && karte.bereiche) {
      const ids = Object.keys(karte.bereiche).sort();
      ids.forEach((id, i) => {
        const b = karte.bereiche[id];
        const f = ROLLE_BEREICH_FARBE[b.rolle] || (b.gefecht ? '#f2c94c' : BEREICH_FARBE[i % BEREICH_FARBE.length]);
        ctx.fillStyle = f + '22'; ctx.strokeStyle = f; ctx.lineWidth = 1;
        for (const q of b.rects || []) { ctx.fillRect(ox + q[0] * px, oy + q[1] * px, q[2] * px, q[3] * px); }
      });
    }
    if (o.plaetze && karte.plaetze) {
      ctx.lineWidth = 1;
      for (const id of Object.keys(karte.plaetze)) {
        const p = karte.plaetze[id]; const q = p.rect; if (!q) continue;
        const mark = o.markPlaetze && o.markPlaetze.has(id);
        ctx.strokeStyle = mark ? '#ff7bd5' : 'rgba(255,255,255,.22)'; ctx.lineWidth = mark ? Math.max(2, px / 3) : 1;
        ctx.strokeRect(ox + q[0] * px + 0.5, oy + q[1] * px + 0.5, q[2] * px - 1, q[3] * px - 1);
        if (o.platzNamen && px >= 6) {
          ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = `${Math.max(9, Math.round(px * 0.9))}px system-ui`;
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(id, ox + q[0] * px + 3, oy + q[1] * px + 2);
        }
      }
    }
    if (o.cover) {
      ctx.fillStyle = 'rgba(242,201,76,.55)';
      for (const c of karte.coverSpots || []) ctx.fillRect(ox + c.x * px + px * 0.4, oy + c.y * px + px * 0.4, px * 0.2, px * 0.2);
    }
    const byId = {}; for (const a of karte.anker || []) byId[a.id] = a;
    if (o.patrouillen) {
      ctx.strokeStyle = 'rgba(242,201,76,.8)'; ctx.lineWidth = Math.max(1, px / 6); ctx.setLineDash([px, px / 2]);
      for (const kette of karte.patrouillen || []) {
        ctx.beginPath();
        kette.forEach((id, i) => { const a = byId[id]; if (!a) return; const X = ox + a.x * px + px / 2, Y = oy + a.y * px + px / 2; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (karte.decks && karte.decks.links) {
      ctx.strokeStyle = '#4fb0d0'; ctx.lineWidth = Math.max(1, px / 5);
      for (const l of karte.decks.links) {
        ctx.beginPath(); ctx.moveTo(ox + l.a[0] * px + px / 2, oy + l.a[1] * px + px / 2); ctx.lineTo(ox + l.b[0] * px + px / 2, oy + l.b[1] * px + px / 2); ctx.stroke();
      }
    }
    if (o.anker !== false) zeichneAnker(ctx, karte.anker || [], o);
    zeichneFehler(ctx, (o.warnungen || []).map((w) => Object.assign({ warnung: true }, w)), o);
    zeichneFehler(ctx, o.fehler || [], o);
  }

  // ---------------- DOM ----------------
  function h(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    for (const k of Object.keys(a)) {
      const v = a[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const rein = (x) => {
      if (x == null || x === false) return;
      if (Array.isArray(x)) { for (const y of x) rein(y); return; }
      el.appendChild(typeof x === 'object' ? x : document.createTextNode(String(x)));
    };
    for (let i = 2; i < arguments.length; i++) rein(arguments[i]);
    return el;
  }
  function auswahl(werte, aktuell, onchange, attrs) {
    return h('select', Object.assign({ onchange: (e) => onchange(e.target.value) }, attrs || {}),
      werte.map((w) => { const v = Array.isArray(w) ? w[0] : w, t = Array.isArray(w) ? w[1] : w; return h('option', { value: v, selected: String(v) === String(aktuell) }, t); }));
  }
  function fehlerZeile(f, onclick) {
    return h('div', { class: 'fz ' + (f.warnung ? 'warn' : 'bad'), onclick, title: f.x != null ? `@${f.x},${f.y}` : '' },
      h('b', {}, f.code), ' ', f.msg, f.x != null ? h('span', { class: 'dim' }, ` @${f.x},${f.y}`) : null);
  }
  function download(name, text) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  root.WerkstattBasis = {
    ladeDaten, klon, mitErsatz, standardBauweise, standardZustand, achse, zeichenInfo, farbeVon, glyphe,
    zeichneRows, zeichneBelegung, zeichneAnker, zeichneFehler, zeichneKanten, zeichneKarte,
    h, auswahl, fehlerZeile, download, KIND_FARBE, KANTE_FARBE, ROLLE_FARBE, ROLLE_BEREICH_FARBE,
  };
})(typeof self !== 'undefined' ? self : this);
