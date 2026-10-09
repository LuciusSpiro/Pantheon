// Galerie (CONTRACT-B1 §4, Team WERKSTATT): galerie.html?art=station&seeds=1-24&bauweise=germanen&besitz=kontor&zustand=verfallen
// Weitere Parameter: schablone=<id>, decks=1|2, quelle=content|fixtures.
// Je Seed: Buehne.bauRoh (genau dieser Seed, wie sweep) -> Fehlbau rot markiert; Buehne.bauen (mit seed+1-Rückfall) -> gezeigte Karte.
// Vorschau: Voxel über den Kit-Renderer (VOXEL, /js/voxel/kit.js: snapshot für Kacheln, viewer zum Umsehen);
// 2D-Raster nach Kachelart erscheint sofort und bleibt Rückfall (vorschau=2d erzwingt ihn).
(function () {
  'use strict';
  const WB = window.WerkstattBasis, h = WB.h;
  const B = window.Shared_Buehne;
  const ARTEN = ['aussenposten', 'station', 'ruine', 'schiff'];

  // ---------------- Zustand ----------------
  const S = { buendel: null, params: null, ergebnisse: [], laeuft: 0, voxel: null, voxelFehler: 0, voxelFertig: 0, warteschlange: Promise.resolve() };

  function leseParams() {
    const q = new URLSearchParams(location.search);
    const art = ARTEN.includes(q.get('art')) ? q.get('art') : 'ruine';
    return {
      art, seeds: parseSeeds(q.get('seeds') || '1-24'), seedsText: q.get('seeds') || '1-24',
      schablone: q.get('schablone') || '', bauweise: q.get('bauweise') || '', besitz: q.get('besitz') || '',
      zustand: q.get('zustand') || '', decks: q.get('decks') ? Number(q.get('decks')) : null, quelle: q.get('quelle') || 'content',
      vorschau: q.get('vorschau') === '2d' ? '2d' : 'voxel',
    };
  }
  function parseSeeds(t) {
    const out = [];
    for (const teil of String(t).split(',')) {
      const m = teil.trim().match(/^(-?\d+)(?:\s*-\s*(-?\d+))?$/);
      if (!m) continue;
      const a = Number(m[1]), b = m[2] != null ? Number(m[2]) : a;
      for (let s = Math.min(a, b); s <= Math.max(a, b) && out.length < 500; s++) out.push(s);
    }
    return out.length ? out : [1];
  }
  function schreibeParams(p) {
    const q = new URLSearchParams();
    q.set('art', p.art); q.set('seeds', p.seedsText);
    for (const k of ['schablone', 'bauweise', 'besitz', 'zustand', 'decks']) if (p[k]) q.set(k, p[k]);
    if (p.quelle && p.quelle !== 'content') q.set('quelle', p.quelle);
    if (p.vorschau === '2d') q.set('vorschau', '2d');
    history.replaceState(null, '', '?' + q.toString());
  }

  // ---------------- Aktionen ----------------
  function bauOpts(p, seed) {
    const o = { art: p.art, seed, bauweise: p.bauweise || WB.standardBauweise(S.buendel, p.art), besitz: p.besitz || null,
      zustand: p.zustand || WB.standardZustand(S.buendel, p.art) };
    if (p.schablone) o.schablone = p.schablone;
    if (p.decks) o.schiffDecks = p.decks;
    return o;
  }
  function baueSeed(p, seed) {
    const o = bauOpts(p, seed);
    const e = { seed, opts: o, roh: null, karte: null, fehler: null, ms: 0, schablone: null };
    const t0 = performance.now();
    try { e.roh = B.bauRoh(o); } catch (err) { e.fehler = String(err.message || err); }
    try { e.karte = B.bauen(o); } catch (err) { e.fehler = e.fehler || String(err.message || err); e.bauFehler = err.fehler || []; }
    e.ms = Math.round(performance.now() - t0);
    e.fehlbau = !e.roh || !e.roh.pruefung || !e.roh.pruefung.ok;
    e.schablone = (e.karte && e.karte.schablone) || (e.roh && e.roh.karte && e.roh.karte.schablone) || p.schablone || null;
    return e;
  }
  async function baueAlle() {
    const p = S.params, lauf = ++S.laeuft;
    S.ergebnisse = []; S.voxelFehler = 0; S.voxelFertig = 0;
    V.liste();
    for (const seed of p.seeds) {
      if (lauf !== S.laeuft) return;
      const e = baueSeed(p, seed);
      S.ergebnisse.push(e);
      V.kachel(e);
      V.status();
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  async function ladeVoxel() {
    // Kit-Renderer (VOXEL, public/js/voxel/kit.js, ES-Modul). Nur laden, wenn die Datei existiert (kein 404 in der Konsole).
    try {
      const r = await fetch('/js/voxel/kit.js', { method: 'HEAD', cache: 'no-store' });
      if (!r.ok) return null;
      const VK = await import('/js/voxel/kit.js');
      if (typeof VK.snapshot !== 'function') return null;
      if (typeof VK.prefetch === 'function') await VK.prefetch();
      return VK;
    } catch (e) { console.warn('Galerie: Kit-Renderer nicht nutzbar, 2D-Rückfall', e); return null; }
  }
  // Voxelbild für eine Kachel – nacheinander (ein gemeinsamer Offscreen-Renderer), 2D bleibt bei Fehlern stehen
  function voxelKachel(e, box, lauf) {
    const k = e.karte;
    if (!k || S.params.vorschau === '2d') return;
    S.warteschlange = S.warteschlange.then(async () => {
      const VK = await S.voxelBereit;
      if (!VK || lauf !== S.laeuft || !box.isConnected) return;
      const cv = box.querySelector('canvas'); if (!cv) return;
      const t0 = performance.now();
      try {
        const url = await VK.snapshot(k, { width: cv.width * 2, height: cv.height * 2, deck: 0 });
        if (lauf !== S.laeuft) return;
        const img = h('img', { src: url, width: cv.width, height: cv.height, class: 'voxelbild', title: 'Voxel (Kit-Renderer) – 2D: Taste/Schalter oben' });
        cv.classList.add('rueckfall');
        cv.after(img);
        e.voxelMs = Math.round(performance.now() - t0);
        S.voxelFertig++;
      } catch (err) { S.voxelFehler++; e.voxelFehler = String(err && err.message || err); console.warn('Galerie: snapshot', e.seed, err); }
      V.status();
    });
  }

  // ---------------- Darstellung ----------------
  const V = {};
  V.kopf = function () {
    const p = S.params, b = S.buendel;
    const schs = B.schablonen(p.art).map((s) => s.id);
    const neu = Object.assign({}, p);
    const setze = (k, v) => { neu[k] = v; };
    const form = h('form', { id: 'kopfForm', onsubmit: (ev) => { ev.preventDefault(); neu.seeds = parseSeeds(neu.seedsText); S.params = neu; schreibeParams(neu); V.kopf(); baueAlle(); } },
      h('label', {}, 'Kartenart ', WB.auswahl(ARTEN, p.art, (v) => { setze('art', v); setze('schablone', ''); }, { id: 'fArt' })),
      h('label', {}, 'Schablone ', WB.auswahl([['', 'alle (Seed wählt)']].concat(schs), p.schablone, (v) => setze('schablone', v), { id: 'fSch' })),
      h('label', {}, 'Seeds ', h('input', { id: 'fSeeds', size: 8, value: p.seedsText, oninput: (e) => setze('seedsText', e.target.value) })),
      h('label', {}, 'Bauweise ', WB.auswahl([['', 'Standard']].concat(WB.achse(b, 'bauweisen')), p.bauweise, (v) => setze('bauweise', v))),
      h('label', {}, 'Besitz ', WB.auswahl([['', '–']].concat(WB.achse(b, 'besitz')), p.besitz, (v) => setze('besitz', v))),
      h('label', {}, 'Zustand ', WB.auswahl([['', 'Standard']].concat(WB.achse(b, 'zustaende')), p.zustand, (v) => setze('zustand', v))),
      h('label', {}, 'Vorschau ', WB.auswahl([['voxel', 'Voxel'], ['2d', '2D']], p.vorschau, (v) => setze('vorschau', v))),
      p.art === 'schiff' ? h('label', {}, 'Decks ', WB.auswahl([['', 'CONFIG'], '1', '2'], p.decks || '', (v) => setze('decks', v ? Number(v) : null))) : null,
      h('button', { type: 'submit', id: 'fBauen' }, 'Bauen'));
    const k = document.getElementById('kopfForm');
    if (k) k.replaceWith(form); else document.getElementById('kopf').insertBefore(form, document.getElementById('status'));
  };
  V.status = function (text, err) {
    const el = document.getElementById('status');
    if (text) { el.textContent = text; el.className = err ? 'err' : ''; return; }
    const n = S.ergebnisse.length, ok = S.ergebnisse.filter((e) => !e.fehlbau).length, tot = S.ergebnisse.filter((e) => !e.karte).length;
    const ms = S.ergebnisse.map((e) => e.ms).sort((a, b) => a - b);
    const quote = n ? Math.round(ok / n * 100) : 0;
    const ziel = Math.round(((S.buendel.cfg && S.buendel.cfg.bestehensquote) || 0.8) * 100);
    el.className = quote < ziel ? 'err' : '';
    const vx = S.params.vorschau === '2d' ? ' · Vorschau 2D' : !S.voxel ? ' · Voxel lädt/aus (2D)' : ` · Voxel ${S.voxelFertig}/${S.ergebnisse.filter((x) => x.karte).length}` + (S.voxelFehler ? ` (${S.voxelFehler} Fehler, 2D)` : '');
    el.textContent = `${n}/${S.params.seeds.length} gebaut · bestanden ${ok}/${n} (${quote} %, Ziel ${ziel} %)` + (tot ? ` · ${tot} ohne gültige Karte` : '') +
      (n ? ` · Bauzeit Median ${ms[Math.floor(n / 2)]} ms, max ${ms[n - 1]} ms` : '') + ` · bauversion ${B.bauversion(S.params.art)}` + vx;
  };
  V.liste = function () {
    const main = document.getElementById('liste');
    main.textContent = '';
    if (!B.schablonen(S.params.art).length) main.appendChild(h('div', { class: 'leer' }, (S.buendel && (S.buendel.schablonen || []).length) ? `Keine Schablone für ${S.params.art} in den geladenen Daten (${(S.buendel.schablonen || []).length} Schablonen anderer Kartenarten).` : `Keine Bühnendaten geladen (Datenweg: ${S.weg || 'unbekannt'}) – Server prüfen (/werkstatt/daten).`));
  };
  function kennzahlZeilen(k, cfg) {
    const kz = (k.meta && k.meta.kennzahlen) || B.kennzahlen(k);
    const deck = Object.values(kz.deckung || {}).filter((v) => v != null);
    const dmin = deck.length ? Math.min.apply(null, deck) : null;
    const wege = Object.values(kz.wege || {}).filter((v) => v != null && v >= 0);
    const sch = Object.values(kz.schatten || {});
    const c = cfg || {};
    const z = (label, wert, schlecht) => h('span', { class: 'kz' + (schlecht ? ' bad' : '') }, h('i', {}, label), ' ', wert);
    return [
      z('Deckung', dmin == null ? '–' : dmin.toFixed(2), dmin != null && dmin < (c.deckungMin || 0.35)),
      z('Sichtgasse', kz.sichtgasse, kz.sichtgasse > (c.sichtgasseMax || 12)),
      z('Wege', wege.length ? Math.min.apply(null, wege) + '–' + Math.max.apply(null, wege) : '–'),
      z('getrennt', kz.wegeGetrennt),
      z('Engstellen', (kz.engstellen || []).length),
      z('Schatten min', sch.length ? Math.min.apply(null, sch) : '–', sch.some((v) => v < 1)),
      z('Rückzug', kz.rueckzugFrei ? 'frei' : 'nur Eingang', kz.rueckzugFrei === false),
    ];
  }
  V.kachel = function (e) {
    const main = document.getElementById('liste');
    const k = e.karte || (e.roh && e.roh.karte);
    const kl = 'kachel' + (e.fehlbau ? ' fehlbau' : '') + (!e.karte ? ' tot' : '');
    const box = h('div', { class: kl, 'data-seed': e.seed, onclick: () => V.umsehen(e), title: 'Klick: Karte zum Umsehen öffnen' });
    if (k) {
      const px = Math.max(2, Math.min(9, Math.floor(300 / k.w)));
      const cv = h('canvas', { width: k.w * px, height: k.h * px });
      WB.zeichneKarte(cv.getContext('2d'), S.buendel, k, { px, anker: true, fehler: e.fehlbau && e.roh && e.roh.pruefung ? e.roh.pruefung.fehler : [] });
      box.appendChild(cv);
    } else box.appendChild(h('div', { class: 'keinbild' }, 'keine Karte'));
    const eff = e.karte ? e.karte.seed : null;
    box.appendChild(h('div', { class: 'cap' },
      h('b', {}, `Seed ${e.seed}`), eff != null && eff !== e.seed ? h('span', { class: 'bad' }, ` → ${eff}`) : null,
      ' · ', (e.schablone || '–').replace(S.params.art + '.', ''),
      k && k.spiegel ? ` · Spiegel ${k.spiegel}` : '', k && k.meta && k.meta.ueberzug && k.meta.ueberzug !== 'voll' ? ` · Überzug ${k.meta.ueberzug}` : '',
      ` · ${e.ms} ms`));
    voxelKachel(e, box, S.laeuft);
    if (e.karte) box.appendChild(h('div', { class: 'kzs' }, kennzahlZeilen(e.karte, S.buendel.cfg)));
    if (e.fehlbau) {
      const f = (e.roh && e.roh.pruefung && e.roh.pruefung.fehler) || [];
      box.appendChild(h('div', { class: 'fehler' }, f.length ? f.slice(0, 3).map((x) => h('div', {}, h('b', {}, x.code), ' ', x.msg)) : e.fehler || 'Fehlbau'));
    }
    const w = e.karte && e.karte.meta && e.karte.meta.warnungen;
    if (w && w.length) box.appendChild(h('div', { class: 'warn' }, w.slice(0, 2).map((x) => h('div', {}, h('b', {}, x.code), ' ', x.msg)), w.length > 2 ? `+${w.length - 2} weitere` : null));
    main.appendChild(box);
  };

  // ---------------- Umsehen ----------------
  V.umsehen = function (e) {
    const zeigeRoh = !e.karte;
    let karte = e.karte || (e.roh && e.roh.karte);
    if (!karte) {
      const f = (e.roh && e.roh.pruefung && e.roh.pruefung.fehler) || e.bauFehler || [];
      const dlg0 = h('div', { class: 'modal', id: 'umsehen', onclick: (ev) => { if (ev.target === dlg0) dlg0.remove(); } },
        h('div', { class: 'modalBox' }, h('div', { class: 'modalKopf' }, h('b', {}, `Seed ${e.seed}: keine Karte`), h('button', { onclick: () => dlg0.remove() }, 'Schließen')),
          h('div', { class: 'modalInhalt' }, h('div', { class: 'seite' }, h('p', {}, e.fehler || ''), f.map((x) => WB.fehlerZeile(x))))));
      document.body.appendChild(dlg0);
      return;
    }
    const opt = { anker: true, bereiche: false, plaetze: true, platzNamen: false, patrouillen: false, cover: false, zeichen: false, roh: zeigeRoh };
    const dlg = h('div', { class: 'modal', id: 'umsehen', onclick: (ev) => { if (ev.target === dlg) zu(); } });
    const cv = h('canvas', { id: 'grossKarte' });
    const info = h('div', { class: 'hover dim' }, 'Maus über die Karte: Kachel, Anker, Platz');
    const seite = h('div', { class: 'seite' });
    const zu = () => { if (ansicht && ansicht.v) ansicht.v.dispose(); dlg.remove(); document.removeEventListener('keydown', esc); };
    const esc = (ev) => { if (ev.key === 'Escape') zu(); };
    document.addEventListener('keydown', esc);
    let px = 10;
    function zeichne() {
      karte = opt.roh && e.roh && e.roh.karte ? e.roh.karte : (e.karte || e.roh.karte);
      const maxW = Math.min(window.innerWidth - 420, 1400), maxH = window.innerHeight - 140;
      px = Math.max(3, Math.min(28, Math.floor(Math.min(maxW / karte.w, maxH / karte.h))));
      cv.width = karte.w * px; cv.height = karte.h * px;
      const pr = opt.roh ? (e.roh && e.roh.pruefung) : B.pruefen(karte);
      WB.zeichneKarte(cv.getContext('2d'), S.buendel, karte, Object.assign({ px, fehler: pr ? pr.fehler : [], warnungen: pr ? pr.warnungen : [] }, opt));
      seiteFuellen(pr);
    }
    function seiteFuellen(pr) {
      seite.textContent = '';
      const p = e.opts;
      const q = new URLSearchParams({ arena: 'away', art: p.art, seed: String(karte.seed), bauweise: p.bauweise, zustand: p.zustand });
      if (p.besitz) q.set('besitz', p.besitz);
      if (karte.schablone) q.set('schablone', karte.schablone);
      seite.appendChild(h('div', { class: 'links' },
        h('a', { href: '/?' + q.toString(), target: '_blank', title: 'Direktstart Testgelände (ENGINE, CONTRACT-B1 §4)' }, 'Im Spiel ansehen ↗'), ' · ',
        h('a', { href: 'werkstatt.html?schablone=' + encodeURIComponent(karte.schablone || '') + '&seed=' + karte.seed, target: '_blank' }, 'Schablone in der Werkstatt ↗')));
      seite.appendChild(h('div', {}, h('b', {}, karte.schablone), ` · Seed ${e.seed}` + (karte.seed !== e.seed ? ` → ${karte.seed}` : '') +
        ` · ${karte.w}×${karte.h} · ${karte.bauweise}/${karte.besitz || '–'}/${karte.zustand} · Hash ${B.hash(karte)}`));
      const ebenen = [['anker', 'Anker'], ['bereiche', 'Bereiche'], ['plaetze', 'Plätze'], ['platzNamen', 'Platznamen'], ['patrouillen', 'Patrouillen'], ['cover', 'Deckungspunkte'], ['zeichen', 'Zeichen']];
      seite.appendChild(h('div', { class: 'ebenen' }, ebenen.map(([k, t]) => h('label', {}, h('input', { type: 'checkbox', checked: opt[k], onchange: (ev) => { opt[k] = ev.target.checked; zeichne(); } }), ' ' + t)),
        e.roh && e.roh.karte && e.karte && e.karte.seed !== e.seed ? h('label', {}, h('input', { type: 'checkbox', checked: opt.roh, onchange: (ev) => { opt.roh = ev.target.checked; zeichne(); } }), ` Fehlbau (Seed ${e.seed}) zeigen`) : null));
      if (S.voxel && !opt.roh) seite.appendChild(h('button', { id: 'bVoxel', onclick: () => voxel() }, ansicht ? '2D-Raster zeigen' : 'Voxel umsehen (ziehen, Rad, 1/2 Deck)'));
      if (pr) {
        seite.appendChild(h('h3', {}, pr.ok ? 'Prüfung: bestanden' : `Prüfung: ${pr.fehler.length} Fehler`));
        for (const f of pr.fehler) seite.appendChild(WB.fehlerZeile(f));
        for (const w of pr.warnungen) seite.appendChild(WB.fehlerZeile(Object.assign({ warnung: true }, w)));
      }
      const kz = (karte.meta && karte.meta.kennzahlen) || B.kennzahlen(karte);
      seite.appendChild(h('h3', {}, 'Kennzahlen'));
      seite.appendChild(h('pre', {}, JSON.stringify(kz, null, 1)));
      const anz = {}; for (const a of karte.anker) anz[a.rolle] = (anz[a.rolle] || 0) + 1;
      seite.appendChild(h('h3', {}, 'Anker'));
      seite.appendChild(h('div', {}, Object.keys(anz).sort().map((r) => h('span', { class: 'kz' }, h('i', { style: { color: WB.ROLLE_FARBE[r] } }, r), ' ' + anz[r]))));
      seite.appendChild(h('h3', {}, 'Plätze'));
      seite.appendChild(h('div', { class: 'plist' }, Object.keys(karte.plaetze || {}).sort().map((id) => h('div', {}, h('b', {}, id), ' ', karte.plaetze[id].modul || '–'))));
    }
    let ansicht = null;   // { canvas, v } solange die Voxelansicht offen ist
    async function voxel() {
      if (ansicht) { ansicht.v && ansicht.v.dispose(); ansicht.canvas.replaceWith(cv); ansicht = null; zeichne(); return; }
      const vc = h('canvas', { class: 'voxel', style: { width: cv.width + 'px', height: cv.height + 'px', minWidth: '640px', minHeight: '400px' } });
      cv.replaceWith(vc);
      ansicht = { canvas: vc, v: null };
      try { ansicht.v = await S.voxel.viewer(vc, karte, {}); } catch (err) { vc.replaceWith(h('div', { class: 'bad' }, 'Kit-Renderer: ' + err.message)); }
      seiteFuellen(opt.roh ? (e.roh && e.roh.pruefung) : B.pruefen(karte));
    }
    cv.addEventListener('mousemove', (ev) => {
      const r = cv.getBoundingClientRect();
      const x = Math.floor((ev.clientX - r.left) / px), y = Math.floor((ev.clientY - r.top) / px);
      if (x < 0 || y < 0 || x >= karte.w || y >= karte.h) return;
      const ch = karte.rows[y][x], i = WB.zeichenInfo(S.buendel, ch);
      const anker = karte.anker.filter((a) => a.x === x && a.y === y);
      const platz = Object.keys(karte.plaetze || {}).find((id) => { const q = karte.plaetze[id].rect; return q && x >= q[0] && y >= q[1] && x < q[0] + q[2] && y < q[1] + q[3]; });
      info.textContent = `${x},${y}  "${ch}" ${i ? i.kind : '?'}` + (platz ? `  ·  Platz ${platz} (${karte.plaetze[platz].modul})` : '') +
        (anker.length ? '  ·  ' + anker.map((a) => a.id + (a.art ? ' art=' + a.art : '') + (a.paar ? ' paar=' + a.paar : '') + (a.ankunft ? ' ankunft' : '') + (a.schwer ? ' schwer' : '')).join(', ') : '');
    });
    dlg.appendChild(h('div', { class: 'modalBox' }, h('div', { class: 'modalKopf' }, h('b', {}, 'Umsehen'), h('button', { onclick: zu }, 'Schließen (Esc)')),
      h('div', { class: 'modalInhalt' }, h('div', { class: 'kartenSpalte' }, cv, info), seite)));
    document.body.appendChild(dlg);
    zeichne();
  };

  // ---------------- Start ----------------
  async function start() {
    S.params = leseParams();
    V.status('lädt Bühnendaten …');
    try {
      const r = await WB.ladeDaten(S.params.quelle);
      S.buendel = r.buendel; S.weg = r.weg;
      B.setDaten(WB.klon(r.buendel));
    } catch (e) {
      V.status(e.message, true);
      document.getElementById('liste').appendChild(h('div', { class: 'leer' }, e.message));
      return;
    }
    V.kopf();
    S.voxelBereit = S.params.vorschau === '2d' ? Promise.resolve(null) : ladeVoxel().then((K) => { S.voxel = K; V.status(); return K; });
    await baueAlle();
    window.__galerieFertig = true;
    await S.warteschlange;
    window.__galerieVoxelFertig = true;
  }
  window.Galerie = { S, start, parseSeeds };
  start();
})();
