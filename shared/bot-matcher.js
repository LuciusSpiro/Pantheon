// BOT-04 A1: Matcher Text -> Bot-Befehl (UMD: window.Shared_BotMatcher / require). Reines JS ohne Abhaengigkeiten, Browser und Node.
// Vertrag: vault Pantheon/Vertrag Bot-Befehle (Katalog v1). Kein LLM, keine freie Auslegung: der Text wird gegen die feste Musterliste
// content/bots/muster.json abgeglichen (Fuzzy). match() liefert { an, befehl, args, konfidenz } oder null (null = unklar, der Client spielt
// den Rueckfrage-Clip bot.unklar). Falsch erkannt ist schlimmer als nicht erkannt: im Zweifel null.
//
// Verfahren: Normalisierung (klein, Umlaute, Satzzeichen), Fuellwoerter weg, optionale Adressierung ("Navigation, ...") vorn abtrennen.
// Muster werden beim Laden expandiert (Alternativen "(a|b|)" und Slots "{name}" -> konkrete Tokenfolgen mit Argumenten). Abgleich je Muster
// als Token-Alignment (Levenshtein ueber Tokens, Token-Aehnlichkeit = max(Zeichen-Levenshtein, Koelner Phonetik bei kleinem Zeichenabstand),
// Zusammenziehen/Trennen benachbarter Tokens). Konfidenz = 1 - Kosten / max(Tokenzahl Muster, Tokenzahl Text).
// Null bei: Negation oder Fragewort, zu langem Text, Konfidenz unter der Schwelle, Mehrdeutigkeit (zwei verschiedene Befehle/Argumente
// fast gleich gut), Adressierung an die falsche Rolle, Zahl mit "Meter" bei einem anderen Befehl als nav.abstand.
// Nicht per Sprache waehlbar: hex:<id>, objekt:<id> (kein Muster darf sie enthalten, Test).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else root.Shared_BotMatcher = factory(null);
})(typeof self !== 'undefined' ? self : this, function (req) {
  'use strict';

  // Standardschwelle: siehe Bericht BOT-04 A1 (Messung im Selbsttest und Begruendung in tools/test-bot-matcher.js).
  const SCHWELLE = 0.85;
  const MARGE = 0.05;            // Abstand zwischen bestem und zweitbestem (anderen) Treffer, sonst null
  const MAX_TOKENS = 10;         // laengere Texte sind Plaudern
  const KOSTE_EXTRA_TEXT = 0.5;  // zusaetzliches Wort im Text
  const KOSTE_FEHLT = 1;         // Wort des Musters fehlt im Text
  const SIM_MIN = 0.7;           // darunter gilt ein Wort als falsch (Kosten 1)
  const SIM_MIN_SLOT = 0.75;     // Argumentwoerter strenger (darunter Kosten 1,5)

  // ---------- Normalisierung ----------
  function norm(s) {
    let t = String(s == null ? '' : s).toLowerCase();
    t = t.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');   // Akzente (Cours, Capitaine)
    t = t.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');            // 1.000 -> 1000
    t = t.replace(/[^a-z0-9]+/g, ' ').trim();
    return t;
  }
  function tokens(s) { const n = norm(s); return n ? n.split(' ') : []; }

  // ---------- Aehnlichkeit ----------
  function lev(a, b) {
    const n = a.length, m = b.length;
    if (!n) return m; if (!m) return n;
    let prev = new Array(m + 1), cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      const t = prev; prev = cur; cur = t;
    }
    return prev[m];
  }
  // Koelner Phonetik (Postel 1969) auf normalisierten Woertern (nur a-z, Ziffern bleiben)
  function koelner(w) {
    const s = w.replace(/[^a-z]/g, '');
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i], p = i ? s[i - 1] : '', n = s[i + 1] || '';
      let code;
      if ('aeijouy'.includes(c)) code = '0';
      else if (c === 'h') code = '';
      else if (c === 'b') code = '1';
      else if (c === 'p') code = n === 'h' ? '3' : '1';
      else if ('dt'.includes(c)) code = 'csz'.includes(n) ? '8' : '2';
      else if ('fvw'.includes(c)) code = '3';
      else if ('gkq'.includes(c)) code = '4';
      else if (c === 'c') {
        if (!i) code = 'ahkloqrux'.includes(n) ? '4' : '8';
        else code = 'sz'.includes(p) ? '8' : ('ahkoqux'.includes(n) ? '4' : '8');
      } else if (c === 'x') code = 'ckq'.includes(p) ? '8' : '48';
      else if (c === 'l') code = '5';
      else if ('mn'.includes(c)) code = '6';
      else if (c === 'r') code = '7';
      else if ('sz'.includes(c)) code = '8';
      else code = '';
      out.push(code);
    }
    let r = '';
    for (const code of out) for (const ch of code) if (ch !== r[r.length - 1]) r += ch;   // Doppelte zusammenfassen
    return r ? r[0] + r.slice(1).replace(/0/g, '') : '';
  }
  const simCache = new Map();
  // Aehnlichkeit zweier Woerter 0..1. Kurze Woerter (bis 3 Zeichen) nur exakt; Ziffern nur exakt.
  function wortSim(a, b) {
    if (a === b) return 1;
    const key = a + '|' + b;
    const c = simCache.get(key);
    if (c !== undefined) return c;
    let r;
    const mn = Math.min(a.length, b.length), mx = Math.max(a.length, b.length);
    if (mn <= 3 || /\d/.test(a) || /\d/.test(b)) r = 0;
    else {
      const l = 1 - lev(a, b) / mx;
      r = l;
      if (l >= 0.6) { const ka = koelner(a); if (ka.length >= 2 && ka === koelner(b)) r = Math.max(r, 0.88); }
    }
    if (simCache.size > 50000) simCache.clear();
    simCache.set(key, r);
    return r;
  }

  // ---------- Muster laden und expandieren ----------
  let MUSTER = null;     // roh
  let GEL = null;        // gebaut: { fuell:Set, neg:Set, frage:Set, adressen:[{w,an,name}], befehle:{}, patterns:[], zahlwoerter }
  let nodeLaden = null;  // in Node: Datei laden, wenn nichts gesetzt wurde
  if (req) {
    nodeLaden = function () {
      const fs = req('fs'), path = req('path');
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', 'muster.json'), 'utf8'));
    };
  }

  // "(a|b|)" -> alle Kombinationen (leere Alternative erlaubt), verschachtelt nicht
  function expandAlt(p) {
    const m = /\(([^()]*)\)/.exec(p);
    if (!m) return [p];
    const out = [];
    for (const alt of m[1].split('|')) for (const r of expandAlt(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length))) out.push(r);
    return out;
  }
  function expandSlots(p, slots, args) {
    const m = /\{([a-z_]+)\}/.exec(p);
    if (!m) return [{ text: p, args }];
    const slot = slots[m[1]];
    if (!slot) throw new Error('Muster: unbekannter Slot {' + m[1] + '}');
    const out = [];
    for (const wert of Object.keys(slot.werte)) {
      for (const alias of slot.werte[wert]) {
        const a = Object.assign({}, args); a[slot.arg] = isNaN(Number(wert)) || wert === '' ? wert : Number(wert);
        // Slot-Tokens kennzeichnen mit Praefix "@" (wird beim Bauen in Flag umgewandelt)
        const ersatz = alias.split(' ').filter(Boolean).map((t) => '@' + t).join(' ');
        for (const r of expandSlots(p.slice(0, m.index) + ersatz + p.slice(m.index + m[0].length), slots, a)) out.push(r);
      }
    }
    return out;
  }

  function bauen(muster) {
    const fuell = new Set((muster.fuellwoerter || []).map(norm));
    const neg = new Set((muster.negation || []).map(norm));
    const frage = new Set((muster.fragewoerter || []).map(norm));
    const adressen = [];
    for (const rolle of Object.keys(muster.adressierung || {})) for (const w of muster.adressierung[rolle]) adressen.push({ w: norm(w), an: rolle, name: false });
    for (const id of Object.keys(muster.namen || {})) for (const w of muster.namen[id]) adressen.push({ w: norm(w), an: id, name: true });
    const slots = {};
    for (const k of Object.keys(muster.slots || {})) {
      const s = muster.slots[k]; const werte = {};
      for (const v of Object.keys(s.werte)) werte[v] = s.werte[v].map(norm).filter(Boolean);
      slots[k] = { arg: s.arg, werte };
    }
    const patterns = []; const seen = new Set();
    for (const befehl of Object.keys(muster.befehle || {})) {
      const def = muster.befehle[befehl];
      for (const eintrag of def.muster) {
        const e = typeof eintrag === 'string' ? { p: eintrag } : eintrag;
        for (const alt of expandAlt(e.p)) {
          for (const x of expandSlots(alt, slots, Object.assign({}, e.args || {}))) {
            // Text normalisieren, @-Tokens bleiben als Slot-Tokens erkennbar
            const toks = [];
            for (const raw of x.text.split(/\s+/).filter(Boolean)) {
              const slot = raw[0] === '@';
              const t = norm(slot ? raw.slice(1) : raw);
              if (!t) continue;
              for (const tt of t.split(' ')) { if (fuell.has(tt)) continue; toks.push({ w: tt, slot }); }
            }
            if (!toks.length) continue;
            const key = befehl + '|' + toks.map((t) => (t.slot ? '@' : '') + t.w).join(' ') + '|' + JSON.stringify(x.args);
            if (seen.has(key)) continue; seen.add(key);
            patterns.push({ befehl, an: def.an || 'alle', toks, args: x.args, argKey: JSON.stringify(sortiert(x.args)) });
          }
        }
      }
    }
    return { fuell, neg, frage, adressen, patterns, zahlwoerter: muster.zahlwoerter || {} };
  }
  function sortiert(o) { const r = {}; for (const k of Object.keys(o).sort()) r[k] = o[k]; return r; }

  function setzeMuster(obj) {
    if (!obj || typeof obj !== 'object' || !obj.befehle) throw new Error('setzeMuster: ungueltige Musterdaten');
    GEL = bauen(obj); MUSTER = obj; simCache.clear();
  }
  function geladen() {
    if (!GEL) {
      if (!nodeLaden) throw new Error('Bot-Matcher: keine Muster gesetzt (setzeMuster)');
      setzeMuster(nodeLaden());
    }
    return GEL;
  }

  // ---------- Abgleich ----------
  function subKosten(a, b, slot) {
    const s = wortSim(a, b);
    if (slot) return s >= SIM_MIN_SLOT ? 1 - s : 1.5;
    return s >= SIM_MIN ? 1 - s : 1;
  }
  // maxKosten: Abbruch (Infinity), sobald zwei aufeinanderfolgende Zeilen alle darueber liegen (spart den Grossteil der Muster)
  function ausrichten(T, P, maxKosten) {
    const n = T.length, m = P.length;
    const D = [];
    for (let i = 0; i <= n; i++) { D.push(new Array(m + 1).fill(Infinity)); }
    D[0][0] = 0;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= m; j++) {
        if (i === 0 && j === 0) continue;
        let best = Infinity;
        if (i > 0) best = Math.min(best, D[i - 1][j] + KOSTE_EXTRA_TEXT);
        if (j > 0) best = Math.min(best, D[i][j - 1] + KOSTE_FEHLT);
        if (i > 0 && j > 0) best = Math.min(best, D[i - 1][j - 1] + subKosten(T[i - 1], P[j - 1].w, P[j - 1].slot));
        if (i > 1 && j > 0) {   // zwei Textwoerter = ein Musterwort ("steuer bord")
          const s = wortSim(T[i - 2] + T[i - 1], P[j - 1].w);
          if (s >= 0.8) best = Math.min(best, D[i - 2][j - 1] + (1 - s) + 0.05);
        }
        if (i > 0 && j > 1) {   // ein Textwort = zwei Musterwoerter ("zieldrehen")
          const s = wortSim(T[i - 1], P[j - 2].w + P[j - 1].w);
          if (s >= 0.8) best = Math.min(best, D[i - 1][j - 2] + (1 - s) + 0.05);
        }
        D[i][j] = best;
      }
      if (i > 0) { let mn = Infinity; for (let j = 0; j <= m; j++) { if (D[i][j] < mn) mn = D[i][j]; if (D[i - 1][j] < mn) mn = D[i - 1][j]; } if (mn > maxKosten) return Infinity; }
    }
    return D[n][m];
  }

  // Deutsche Zahlwoerter 1..9999 ("fuenfzig", "zweihundertzwanzig", "tausendfuenfhundert", "einundzwanzig"); sonst null
  const EINER = { ein: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
  const ZEHNER = { zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
  function zahlwort(w) {
    if (!w) return null;
    let rest = w, summe = 0;
    const m = /^(.*?)tausend/.exec(rest);
    if (m) { const f = m[1] === '' ? 1 : unter100(m[1]) || hunderter(m[1]); if (!f) return null; summe += f * 1000; rest = rest.slice(m[0].length); }
    if (rest) { const h = hunderter(rest); if (h == null) return null; summe += h; }
    return summe > 0 ? summe : null;
  }
  function hunderter(s) {
    const m = /^(.*?)hundert(.*)$/.exec(s);
    if (!m) return unter100(s);
    const f = m[1] === '' ? 1 : EINER[m[1]];
    if (!f) return null;
    const r = m[2] === '' ? 0 : unter100(m[2]);
    return r == null ? null : f * 100 + r;
  }
  function unter100(s) {
    if (s in EINER) return EINER[s];
    if (s in ZEHNER) return ZEHNER[s];
    const m = /^(.+)und(.+)$/.exec(s);
    if (m && EINER[m[1]] && ZEHNER[m[2]] >= 20) return EINER[m[1]] + ZEHNER[m[2]];
    return null;
  }
  // Meter aus dem Text ziehen ("500 meter", "fuenfhundert meter"); liefert { rest, meter } (meter null, wenn keine Angabe)
  function meterZiehen(toks) {
    for (let i = 0; i < toks.length - 1; i++) {
      if (toks[i + 1] !== 'meter' && toks[i + 1] !== 'metern') continue;
      let v = null;
      if (/^\d+$/.test(toks[i])) v = Number(toks[i]);
      else v = zahlwort(toks[i]);
      if (v != null && v > 0) return { rest: toks.slice(0, i).concat(toks.slice(i + 2)), meter: v };
    }
    return { rest: toks, meter: null };
  }

  function match(text, opts) {
    const g = geladen();
    const schwelle = opts && typeof opts.schwelle === 'number' ? opts.schwelle : SCHWELLE;
    let toks = tokens(text);
    const nachKomma = /,\s*([^,\s]+)\s*[.!?]*\s*$/.exec(String(text));   // "..., Navigation": Adressierung hinten, nur mit Komma ("an Bord" bleibt Inhalt)
    if (!toks.length || toks.length > MAX_TOKENS + 3) return null;
    for (const t of toks) if (g.neg.has(t) || g.frage.has(t)) return null;

    // Adressierung (erstes Wort)
    let an = null, anName = false;
    if (nachKomma && toks.length > 1) {
      const w = norm(nachKomma[1]);
      let bestT = null, sT = 0.85;
      for (const a of g.adressen) { const s = wortSim(w, a.w); if (s >= sT) { sT = s; bestT = a; } }
      if (bestT && toks[toks.length - 1] === w) { an = bestT.an; anName = bestT.name; toks = toks.slice(0, -1); }
    }
    if (!an && toks.length > 1) {
      let bestA = null, bestS = 0.85;
      for (const a of g.adressen) { const s = wortSim(toks[0], a.w); if (s >= bestS) { bestS = s; bestA = a; } }
      if (bestA) { an = bestA.an; anName = bestA.name; toks = toks.slice(1); }
    }
    const mz = meterZiehen(toks);
    toks = mz.rest.filter((t) => !g.fuell.has(t));
    if (!toks.length || toks.length > MAX_TOKENS) return null;

    // Bester Treffer je (Befehl, Argumente)
    const beste = new Map();
    const n = toks.length;
    const wortOk = new Map();   // Musterwort -> kommt im Text (oder zusammengezogen/als Teil eines Textworts) ungefaehr vor
    const ok = (w) => {
      let r = wortOk.get(w);
      if (r === undefined) {
        r = false;
        for (let i = 0; i < n && !r; i++) {
          if (wortSim(toks[i], w) >= SIM_MIN || (w.length >= 3 && toks[i].includes(w))) r = true;
          else if (i + 1 < n && wortSim(toks[i] + toks[i + 1], w) >= 0.8) r = true;
        }
        wortOk.set(w, r);
      }
      return r;
    };
    for (const p of g.patterns) {
      const m = p.toks.length;
      if (Math.abs(m - n) > 3) continue;
      let fehlt = 0; const erlaubt = Math.floor((1 - (schwelle - MARGE)) * Math.max(m, n)) + 1;
      for (const t of p.toks) if (!ok(t.w) && ++fehlt > erlaubt) break;
      if (fehlt > erlaubt) continue;
      const kosten = ausrichten(toks, p.toks, (1 - (schwelle - MARGE)) * Math.max(m, n));
      const score = 1 - kosten / Math.max(m, n);
      if (score < schwelle - MARGE) continue;   // nur Kandidaten, die die Mehrdeutigkeitspruefung betreffen koennen
      const key = p.befehl + '|' + p.argKey;
      const alt = beste.get(key);
      if (!alt || score > alt.score) beste.set(key, { score, p });
    }
    if (!beste.size) return null;
    const liste = Array.from(beste.values()).sort((a, b) => b.score - a.score);
    const top = liste[0];
    if (top.score < schwelle) return null;
    if (liste.length > 1 && top.score - liste[1].score < MARGE) return null;   // mehrdeutig
    const p = top.p;
    // Rolle
    if (an && !anName && p.an !== 'alle' && an !== p.an) return null;
    if (an && !anName && p.an === 'alle' && an === 'alle') an = 'alle';
    const args = Object.assign({}, p.args);
    if (mz.meter != null) { if (p.befehl !== 'nav.abstand') return null; args.meter = mz.meter; }
    return { an: an || p.an, befehl: p.befehl, args, konfidenz: Math.round(top.score * 1000) / 1000 };
  }

  // Alle Befehle mit mindestens einem Muster (Test) und Anzahl expandierter Muster
  function info() { const g = geladen(); const b = {}; for (const p of g.patterns) b[p.befehl] = (b[p.befehl] || 0) + 1; return { muster: g.patterns.length, befehle: b }; }

  return { match, SCHWELLE, setzeMuster, info, _intern: { norm, koelner, wortSim } };
});
