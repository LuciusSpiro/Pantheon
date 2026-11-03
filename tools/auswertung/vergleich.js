'use strict';
// TEL-01 D2: Vergleich zweier Seiten (ein Lauf oder eine Gruppe von Laeufen). REINES Modul (kein I/O, keine Uhr); lesen, Ordner, Basis-Datei und Ausgabe macht tools/vergleich.js (npm run vergleich).
// Die Bewertung selbst steht NICHT hier, sondern in bewertung.js (vergleichSeiten, unterschiedGruppen, abweichungen, abweichungGegenBasisGruppe); hier nur: Seiten bauen, Tuning-Unterschied, Differenztabelle, Text.
//
//   filterParsen(text), filterPasst(kopf, filter)   --filter modus=m1,spielerzahl=3,quelle=bot,commit=<praefix> (auch szenario, plattform, tuning=<praefix>, seed)
//   mischung(kzs)                                    Warnungen, wenn eine Gruppe verschiedene Modi/Szenarien/Spielerzahlen, Quellen, Commits, Plattformen oder Tuning-Staende mischt
//   fehlerlaufVon(kz)                                Fehlerlauf-Regel wie die Basis (basis.js fehlerlauf): Bot-Lauf ohne session_ende oder vom Prozessende abgebrochen -> Text, sonst null
//   seiteAusLaeufen(name, laeufe, opt)               Seite { art: 'lauf' | 'gruppe', kz | gruppe, ... } aus [{ kz, kennung, tuningTeile }]; Gruppen laufen durch basis.js gruppeBauen (dieselbe Statistik und
//                                                    Gruppen-ID wie die Basis, am_limit, Zaehler/Summen mit 0 aufgefuellt)
//   seiteAusBasis(basisDatei, id)                    Gruppe aus der Basis-Datei (null, wenn es die ID nicht gibt)
//   vergleichen(a, b, opt)                           { text, zeilen, wesentlich, ergebnis }: Markdown mit Kopf und Differenztabelle (A, B, Delta, Delta %, Markierung, Einheit); B - A
//   tuningPfade(ja, jb)                              [{ pfad, a, b }]: Werte, die in zwei tuning/<hash>.json verschieden sind (config und alle Werte-Dateien)
//
// KERNKENNZAHLEN (ohne --alle neben den wesentlichen Abweichungen immer in der Tabelle): je Balancing-Frage 3 bis 5, ausgewaehlt nach "woran liest man die Frage zuerst ab":
//   1 Dauer/Ausgang  Sessiondauer, geschaffte Wellen, Szenen je Ausgang                                  (Hat der Bot/Mensch gewonnen, wie lange hat es gedauert?)
//   2 Gefecht        Trefferquote (die Waffe mit der groessten Aenderung), Schaden aus/ein roh (Raum oder Boden), Abschuesse gesamt, Zeit bis Kill gesamt   (Waffen- und Gegnerbalance)
//   2b Deckung       Deckungsanteil, Deckung verlassen, Treffer auf Spieler in Deckung, Gegnerschuesse aus Deckung
//   3 Verluste       gefallen, Notfallprotokoll, Zonenausfaelle, erster Verlust, Systemintegritaet min
//   4 Rollen         Reparaturspiele, Erfolgsanteil, Stationswechsel
//   5 Wirtschaft     Netto der Marken, Marken am Ende, Wirtschaftsbuchungen (2), Energie-Anteil
//   6 Technik        Zeilen je Minute, Zeilen gesamt, Schreibfehler, Session nicht sauber beendet   (nur der deterministische Teil; Tickzeit u. a. ist nie Teil eines Vergleichs)
// Wo ein Muster mehrere Schluessel trifft (Waffen, Slots), kommen die mit der groessten relativen Aenderung zuerst, hoechstens so viele wie in der Liste steht.

const { flach, infoZu } = require('./kennzahlen.js');
const Bewertung = require('./bewertung.js');
const Basis = require('./basis.js');

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const MAX_ZEILE = 160;           // keine Zeile des Berichts ist laenger (wie beim Sessionbericht)
const ZEILEN_STANDARD = 60;      // ohne --alle hoechstens etwa so viele Zeilen insgesamt
const TABELLE_MIN = 12;          // so viele Tabellenzeilen gibt es ohne --alle auch dann, wenn der Kopf lang ist
const KERN_MIN = 8;              // soviel Platz bleibt den Kernkennzahlen, auch wenn es sehr viele wesentliche Abweichungen gibt
const TUNING_ZEIGEN = 12;        // abweichende Tuning-Pfade im Kopf (der Rest steht als "und n weitere")
const TUNING_SUCHE_MAX = 400;    // so viele abweichende Pfade werden gesammelt

const KERN = {
  '1': [['f1.dauer.session', 1], ['f1.wellen.geschafft', 1], ['f1.ausgang.*', 2]],
  '2': [['f2.quote.*.*', 1], ['f2.schaden.*.aus.roh', 1], ['f2.schaden.*.ein.roh', 1], ['f2.kills.*.gesamt', 1], ['f2.zeit_bis_kill.*.gesamt', 1]],
  '2b': [['f2b.deckung.*.cv_anteil', 1], ['f2b.verlassen.n', 1], ['f2b.treffer_auf_spieler.in_deckung_anteil', 1], ['f2b.schuesse_gegner.aus_deckung_anteil', 1]],
  '3': [['f3.gefallen.n', 1], ['f3.notfall.n', 1], ['f3.zone_aus.n', 1], ['f3.erster_verlust_s', 1], ['f3.integritaet.min', 1]],
  '4': [['f4.reparatur.n', 1], ['f4.reparatur.erfolg_anteil', 1], ['f4.wechsel.*', 1]],
  '5': [['f5.konto.marks.netto', 1], ['f5.konto.marks.ende', 1], ['f5.buchung.marks.*', 2], ['f5.energie.*_anteil', 1]],
  '6': [['f6.protokoll.zeilen_je_min', 1], ['f6.protokoll.zeilen', 1], ['f6.fehler.*', 1], ['f6.daten.ohne_ende', 1]],
};
const FRAGEN = ['1', '2', '2b', '3', '4', '5', '6'];
const musterRegex = (m) => new RegExp('^' + m.split('.').map((t) => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*')).join('\\.') + '$');
const KERN_MUSTER = {};
for (const f of FRAGEN) KERN_MUSTER[f] = KERN[f].map(([m, n]) => ({ re: musterRegex(m), n }));

// ---------- Zahlen und Text ----------
const zahl = (v) => (num(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '-');
const vorzeichen = (v) => (num(v) ? (v > 0 ? '+' : '') + zahl(v) : '-');
const kurz = (v) => { const s = v === undefined ? '(fehlt)' : JSON.stringify(v); return s.length > 40 ? s.slice(0, 37) + '...' : s; };
function umbruch(text, max, einzug) {
  const out = [];
  let rest = String(text);
  while (rest.length > max) {
    let i = rest.lastIndexOf(' ', max);
    if (i < 20) i = max;
    out.push(rest.slice(0, i));
    rest = (einzug || '  ') + rest.slice(i).replace(/^ /, '');
  }
  out.push(rest);
  return out;
}
const zaehlen = (liste) => { const m = new Map(); for (const x of liste) if (x != null) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)); };
const kopfWert = (l, k) => zaehlen(l.map((x) => x[k])).map((e) => e[0]);

// ---------- Filter ----------
const FILTER = {
  modus: (kopf) => kopf.modus, szenario: (kopf) => kopf.szenario, spielerzahl: (kopf) => kopf.spielerzahl, quelle: (kopf) => kopf.quelle,
  plattform: (kopf) => kopf.plattform, seed: (kopf) => kopf.seed, commit: (kopf) => kopf.commit, tuning: (kopf) => kopf.tuning_hash,
};
const FILTER_PRAEFIX = new Set(['commit', 'tuning']);   // Praefix genuegt (Commit-Hash, Tuning-Hash)
function filterParsen(text) {
  const out = {};
  if (text == null || String(text).trim() === '') return out;
  for (const teil of String(text).split(',')) {
    const i = teil.indexOf('=');
    const k = teil.slice(0, i).trim(), v = teil.slice(i + 1).trim();
    if (i < 1 || v === '') throw new Error('Filter "' + teil + '" ist keine Angabe schluessel=wert');
    if (!Object.prototype.hasOwnProperty.call(FILTER, k)) throw new Error('unbekannter Filter "' + k + '"; bekannt: ' + Object.keys(FILTER).join(', '));
    out[k] = v;
  }
  return out;
}
function filterPasst(kopf, filter) {
  const kf = kopf || {};
  for (const k of Object.keys(filter || {})) {
    const w = FILTER[k](kf);
    if (w == null) return false;
    if (FILTER_PRAEFIX.has(k) ? !String(w).startsWith(filter[k]) : String(w) !== filter[k]) return false;
  }
  return true;
}

// ---------- Gruppen aus Protokollen ----------
function mischung(kzs) {
  const w = [];
  const kopfe = kzs.map((k) => k.kopf || {});
  const ids = zaehlen(kopfe.map((k) => Basis.gruppenId(k)));
  if (ids.length > 1) w.push('gemischte Gruppe (' + ids.map((e) => e[0] + ' x' + e[1]).join(', ') + '): Modus, Szenario und Spielerzahl sollten gleich sein, mit --filter trennen (z. B. --filter modus=m1,spielerzahl=3)');
  for (const [k, name] of [['quelle', 'Quellen'], ['commit', 'Commits'], ['tuning_hash', 'Tuning-Staende'], ['plattform', 'Plattformen']]) {
    const v = kopfWert(kopfe, k);
    if (v.length > 1) w.push('gemischte ' + name + ' in einer Gruppe: ' + v.map((x) => (k === 'commit' || k === 'tuning_hash' ? String(x).slice(0, 8) : x)).join(', ') + ' (mit --filter ' + (k === 'tuning_hash' ? 'tuning' : k) + '=... trennen)');
  }
  return w;
}

// Fehlerlauf wie in der Basis (basis.js fehlerlauf): nur Bot-Laeufe; ohne session_ende, oder der Prozess wurde abgebrochen (grund prozessende; den Exit-Code kennt das Protokoll nicht, das gilt wie "kein Code")
function fehlerlaufVon(kz) {
  const kopf = (kz && kz.kopf) || {};
  if (kopf.quelle !== 'bot') return null;
  if (kz.f6 && kz.f6.daten && kz.f6.daten.ohne_ende > 0) return 'kein session_ende';
  return Basis.fehlerlauf(kopf.grund, undefined);
}

function beschreibung(kopfe, extra) {
  const seeds = kopfe.map((k) => k.seed).filter(num).sort((x, y) => x - y);
  return Object.assign({
    commits: kopfWert(kopfe, 'commit'), plattformen: kopfWert(kopfe, 'plattform'), tuning: zaehlen(kopfe.map((k) => k.tuning_hash)), quellen: kopfWert(kopfe, 'quelle'),
    ids: zaehlen(kopfe.map((k) => Basis.gruppenId(k))).map((e) => e[0]), seeds,
  }, extra || {});
}

// laeufe: [{ kz, kennung?, tuningTeile? }]; opt.art 'lauf' (genau ein Lauf) oder 'gruppe'. Fehlerlaeufe (fehlerlaufVon) gehen nicht in die Gruppe und stehen in fehlerlaeufe.
function seiteAusLaeufen(name, laeufe, opt) {
  opt = opt || {};
  const gut = [], fehler = [];
  for (const l of laeufe) { const f = opt.art === 'lauf' ? null : fehlerlaufVon(l.kz); if (f) fehler.push({ kennung: l.kennung || (l.kz.kopf && l.kz.kopf.sitzung) || '?', grund: f }); else gut.push(l); }
  const teile = {};
  for (const l of gut) { const h = l.kz.kopf && l.kz.kopf.tuning_hash; if (h && l.tuningTeile && !teile[h]) teile[h] = l.tuningTeile; }
  const seite = { name, art: opt.art === 'lauf' ? 'lauf' : 'gruppe', n: gut.length, fehlerlaeufe: fehler, tuningTeile: teile, warnungen: [] };
  if (!gut.length) { seite.leer = true; return seite; }
  const kopfe = gut.map((l) => l.kz.kopf || {});
  Object.assign(seite, beschreibung(kopfe));
  seite.version = gut[0].kz.version == null ? null : gut[0].kz.version;
  if (seite.art === 'gruppe' && gut.length === 1) seite.art = 'lauf';   // K4: genau eine Session (Ordner oder Filter) gilt als Lauf: Lauf gegen Lauf bzw. Lauf gegen Gruppe
  if (seite.art === 'lauf') { seite.kz = gut[0].kz; return seite; }
  seite.gruppe = Basis.gruppeBauen(gut.map((l) => ({ seed: l.kz.kopf && l.kz.kopf.seed, kz: l.kz, ausgang: 'ok' })), {});
  seite.warnungen = mischung(gut.map((l) => l.kz));
  seite.amLimit = seite.gruppe.am_limit ? Bewertung.amLimitText(seite.gruppe.modus) : null;
  return seite;
}

function seiteAusBasis(basis, id) {
  const g = basis && basis.gruppen && Object.prototype.hasOwnProperty.call(basis.gruppen, id) ? basis.gruppen[id] : null;
  if (!g) return null;
  const k = basis.kopf || {};
  const kopf = { commit: k.commit || null, plattform: k.plattform || null, tuning_hash: k.tuning_hash || null, quelle: 'bot', seed: null, modus: g.modus, szenario: g.szenario, spielerzahl: g.spieler };
  return {
    name: 'basis:' + id, art: 'gruppe', n: g.laeufe, fehlerlaeufe: [], tuningTeile: {}, warnungen: [], gruppe: Object.assign({}, g, { id, kopf: basis.kopf }),
    commits: kopf.commit ? [kopf.commit] : [], plattformen: kopf.plattform ? [kopf.plattform] : [], tuning: kopf.tuning_hash ? [[kopf.tuning_hash, 1]] : [], quellen: ['bot'], ids: [id], seeds: g.seeds || [],
    amLimit: g.am_limit ? Bewertung.amLimitText(g.modus) : null, basis: true, kopfBasis: kopf, version: num(k.kennzahl_version) ? k.kennzahl_version : null,
  };
}

// ---------- Tuning ----------
const istObjekt = (v) => v !== null && typeof v === 'object';
// Alle Werte, die in zwei tuning/<hash>.json { config, werte: { datei: inhalt } } verschieden sind; pfad = [wurzel, schluessel ...]
function tuningPfade(ja, jb) {
  const out = [];
  const geh = (pfad, x, y) => {
    if (out.length >= TUNING_SUCHE_MAX) return;
    if (istObjekt(x) && istObjekt(y) && Array.isArray(x) === Array.isArray(y)) {
      const ks = new Set(Object.keys(x).concat(Object.keys(y)));
      for (const k of [...ks].sort()) geh(pfad.concat(k), x[k], y[k]);
    } else if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ pfad: pfad.slice(), a: kurz(x), b: kurz(y) });
  };
  geh(['config'], (ja || {}).config, (jb || {}).config);
  const wa = (ja && ja.werte) || {}, wb = (jb && jb.werte) || {};
  for (const d of [...new Set(Object.keys(wa).concat(Object.keys(wb)))].sort()) geh([d], wa[d], wb[d]);
  return out.map((e) => ({ pfad: e.pfad[0] + (e.pfad.length > 1 ? ': ' + e.pfad.slice(1).join('.').replace(/\.(\d+)(?=\.|$)/g, '[$1]') : ''), a: e.a, b: e.b }));
}
// Teile (Datei -> Hash) zweier Staende: welche Werte-Dateien (und die Config) sich unterscheiden
const teileUnterschied = (ta, tb) => [...new Set(Object.keys(ta || {}).concat(Object.keys(tb || {})))].sort().filter((k) => (ta || {})[k] !== (tb || {})[k]);

// Rueckgabe { zeilen, pfade }: pfade = Zahl der abweichenden Tuning-Pfade (null: Hash gleich/unbekannt oder die Werte nicht lesbar), verschieden = true bei verschiedenem Hash
function tuningZeilen(a, b, opt) {
  const ha = a.tuning && a.tuning[0] ? a.tuning[0][0] : null, hb = b.tuning && b.tuning[0] ? b.tuning[0][0] : null;
  const z = [];
  const r = { zeilen: z, pfade: null, verschieden: false };
  const mehrere = (s) => (s.tuning && s.tuning.length > 1 ? ' (gemischt: ' + s.tuning.map((e) => String(e[0]).slice(0, 8) + ' x' + e[1]).join(', ') + ')' : '');
  if (!ha || !hb) { z.push('- Tuning: ' + (ha ? '`' + ha + '`' : 'unbekannt') + ' gegen ' + (hb ? '`' + hb + '`' : 'unbekannt') + ' (kein Tuning-Hash im Kopf, kein Vergleich)'); return r; }
  if (ha === hb) { z.push('- Tuning: gleich (`' + ha + '`)' + mehrere(a) + mehrere(b)); return r; }
  r.verschieden = true;
  z.push('- **Tuning unterschiedlich:** A `' + ha + '`' + mehrere(a) + ', B `' + hb + '`' + mehrere(b) + '. Abweichende Pfade:');
  const laden = opt && opt.tuningLaden;
  const ja = laden ? laden(ha, a) : null, jb = laden ? laden(hb, b) : null;
  if (ja && jb) {
    const p = tuningPfade(ja, jb);
    r.pfade = p.length;
    for (const e of p.slice(0, TUNING_ZEIGEN)) z.push(...umbruch('  - ' + e.pfad + ': ' + e.a + ' -> ' + e.b, MAX_ZEILE, '      '));
    if (p.length > TUNING_ZEIGEN) z.push('  - ... und ' + (p.length - TUNING_ZEIGEN) + ' weitere' + (p.length >= TUNING_SUCHE_MAX ? ' (mindestens)' : ''));
    if (!p.length) z.push('  - keine Werte-Unterschiede gefunden (Hash unterschiedlich, Dateien gleich)');
    return r;
  }
  const ta = a.tuningTeile && a.tuningTeile[ha], tb = b.tuningTeile && b.tuningTeile[hb];
  if (ta && tb) {
    const d = teileUnterschied(ta, tb);
    z.push(...umbruch('  - Teile mit anderem Hash: ' + (d.length ? d.join(', ') : '(keine)') + ' (tuning/<hash>.json fehlt, die einzelnen Werte sind nicht lesbar)', MAX_ZEILE, '    '));
  } else z.push('  - Tuning-Datei nicht gefunden (tuning/' + (ja ? hb : ha) + '.json), die Pfade sind nicht lesbar');
  return r;
}

// ---------- Differenztabelle ----------
function seitenFlach(seite) { if (seite.kz && !seite.flachMerk) seite.flachMerk = flach(seite.kz); return seite.flachMerk; }
function wertAn(seite, k, info) {
  if (seite.kz) {
    const f = seitenFlach(seite);
    if (num(f[k])) return { w: f[k], text: zahl(f[k]) };
    return info.summe ? { w: 0, text: '0' } : null;
  }
  const st = (seite.gruppe.kz || {})[k];
  if (st) return { w: st[3], text: zahl(st[3]) + ' [' + zahl(st[2]) + '–' + zahl(st[4]) + ']', n: st[0], q1: st[2], q3: st[4] };
  return info.summe ? { w: 0, text: '0 [0–0]', n: seite.gruppe.laeufe, q1: 0, q3: 0 } : null;
}
function schluesselVon(seite) { return seite.kz ? Object.keys(flach(seite.kz)) : Object.keys(seite.gruppe.kz || {}); }

function zeilenBauen(a, b, erg) {
  const alle = [...new Set(schluesselVon(a).concat(schluesselVon(b)))].sort();
  const zeilen = [];
  for (const k of alle) {
    const info = infoZu(k);
    if (!info || info.determ === false) continue;
    const x = wertAn(a, k, info), y = wertAn(b, k, info);
    if (!x && !y) continue;
    const delta = x && y ? y.w - x.w : null;
    const rel = x && y ? (x.w === 0 ? (y.w === 0 ? 0 : null) : (y.w - x.w) / Math.abs(x.w) * 100) : null;
    const wesentlich = erg.wesentlich.has(k);
    const schlechter = delta == null || info.richtung === 'neutral' ? false : (info.richtung === 'schlechter' ? delta > 0 : delta < 0);
    const gewicht = !x || !y ? 0 : (x.w === 0 ? Math.abs(delta) / (info.min > 0 ? info.min : 1) : Math.min(Math.abs(delta / x.w), Bewertung.SCORE_MAX));
    zeilen.push({ k, info, a: x, b: y, delta, rel, wesentlich, konstantNull: nullSeite(x) && nullSeite(y), zuwenig: erg.zuwenig.has(k), score: gewicht * (schlechter ? Bewertung.SCHLECHTER_FAKTOR : 1) });
  }
  return zeilen;
}
// K5: auf einer Seite konstant 0 (Median, q1 und q3 alle 0; ein Lauf: der Wert 0)
const nullSeite = (x) => !!x && x.w === 0 && (x.q1 == null || x.q1 === 0) && (x.q3 == null || x.q3 === 0);
const fragenNr = (z) => FRAGEN.indexOf(z.info.frage);
const nachKey = (p, q) => (p.k < q.k ? -1 : p.k > q.k ? 1 : 0);

// ohneNull: Kennzahlen, die auf beiden Seiten konstant 0 sind (K5), kommen nicht in die Auswahl
function kernZeilen(zeilen, ohneNull) {
  const out = [];
  for (const f of FRAGEN) {
    for (const { re, n } of KERN_MUSTER[f]) {
      const treffer = zeilen.filter((z) => z.info.frage === f && re.test(z.k) && z.a && z.b && !(ohneNull && z.konstantNull)).sort((p, q) => Math.abs(q.rel == null ? Infinity : q.rel) - Math.abs(p.rel == null ? Infinity : p.rel) || nachKey(p, q));
      for (const z of treffer.slice(0, n)) if (!out.includes(z)) out.push(z);
    }
  }
  return out;
}

function zeileText(z) {
  const mark = z.wesentlich ? '**wesentlich**' : (z.zuwenig ? 'zu wenig Läufe' : '');
  const key = z.k.length > 60 ? z.k.slice(0, 59) + '…' : z.k;
  const rel = z.rel == null ? (z.delta == null ? '-' : '–') : vorzeichen(z.rel);
  const t = '| ' + key + ' | ' + (z.a ? z.a.text : '-') + ' | ' + (z.b ? z.b.text : '-') + ' | ' + (z.delta == null ? '-' : vorzeichen(z.delta)) + ' | ' + rel + ' | ' + mark + ' | ' + z.info.einheit + ' |';
  return t.length > MAX_ZEILE ? t.slice(0, MAX_ZEILE - 1) + '…' : t;
}

// ---------- Kopf ----------
const kurzHash = (h) => String(h).slice(0, 8);
function seitenText(s) {
  if (s.leer) return 'keine Läufe';
  const teile = [];
  if (s.art === 'lauf') teile.push('Lauf `' + (s.kz.kopf && s.kz.kopf.sitzung ? s.kz.kopf.sitzung : s.name) + '`', Basis.gruppenId(s.kz.kopf));
  else {
    teile.push('Gruppe ' + s.ids.map((i) => '`' + i + '`').join(', '));
    teile.push(s.n + (s.n === 1 ? ' Lauf' : ' Läufe') + (s.seeds.length ? ' (Seeds ' + (s.seeds.length > 6 ? s.seeds[0] + '–' + s.seeds[s.seeds.length - 1] : s.seeds.join(', ')) + ')' : ''));
  }
  teile.push('Commit ' + (s.commits.length ? s.commits.map(kurzHash).join('/') : '?'), s.plattformen.length ? s.plattformen.join('/') : '?', 'Tuning ' + (s.tuning.length ? s.tuning.map((e) => kurzHash(e[0])).join('/') : '?'), 'Quelle ' + (s.quellen.length ? s.quellen.join('/') : '?'));
  return teile.join(', ');
}
const REGEL_TEXT = {
  'lauf-lauf': 'Lauf gegen Lauf: wesentlich = Abweichung ab der Schwelle der Kennzahl (relativ UND absolut, bewertung.js abweichungen); A gilt als Basis.',
  'lauf-gruppe': 'Lauf gegen Gruppe: wesentlich = Abstand zur Spanne Min–Max der Gruppe größer als max(25 %, 2 × IQR) UND mindestens die Mindestmenge (bewertung.js abweichungGegenBasisGruppe); erkennt nur grobe Brüche, für Balance Gruppe gegen Gruppe vergleichen.',
  'gruppe-gruppe': 'Gruppe gegen Gruppe: Kerben nach McGill, wesentlich = |Median A − Median B| > ' + String(Bewertung.KERBE_K).replace('.', ',') + ' × IQR × (1/√nA + 1/√nB) UND mindestens die Mindestmenge der Kennzahl (bewertung.js unterschiedGruppen); nur bei n ≥ ' + Bewertung.MIN_BASIS_N + ' je Seite.',
};

function vergleichen(a, b, opt) {
  opt = opt || {};
  const hinweise = [];
  const kopf = ['# Vergleich: ' + a.name + ' gegen ' + b.name, ''];
  if (a.leer || b.leer) {
    kopf.push('- **A** `' + a.name + '`: ' + seitenText(a), '- **B** `' + b.name + '`: ' + seitenText(b), '', '> [!warning] ' + (a.leer ? 'A' : 'B') + ' enthält keine Läufe (Filter zu streng, Ordner leer oder alle Läufe Fehlerläufe).');
    for (const s of [a, b]) for (const f of s.fehlerlaeufe) kopf.push('- Fehlerlauf in ' + s.name + ' ausgeschlossen: ' + f.kennung + ' (' + f.grund + ')');
    return { text: kopf.join('\n') + '\n', zeilen: [], wesentlich: 0, ergebnis: null, leer: true };
  }
  const erg = Bewertung.vergleichSeiten(a, b);
  const zeilen = zeilenBauen(a, b, erg);
  kopf.push(...umbruch('- **A** `' + a.name + '`: ' + seitenText(a), MAX_ZEILE), ...umbruch('- **B** `' + b.name + '`: ' + seitenText(b), MAX_ZEILE));
  const tun = tuningZeilen(a, b, opt);
  kopf.push(...umbruch('- Regel: ' + REGEL_TEXT[erg.regel], MAX_ZEILE), ...tun.zeilen);
  const zuwenigSeiten = erg.regel === 'gruppe-gruppe' ? [a, b].filter((s) => s.n < Bewertung.MIN_BASIS_N) : [];
  if (zuwenigSeiten.length) hinweise.push(Bewertung.zuWenigText(a.n, b.n));                                                  // K4: 2 oder 3 Läufe: kein Urteil (genau 1 Lauf ist ein Lauf, siehe seiteAusLaeufen)
  else if (erg.regel === 'gruppe-gruppe' && (a.n < Bewertung.BALANCE_N || b.n < Bewertung.BALANCE_N)) hinweise.push(Bewertung.wenigLaeufeText(a.n, b.n));   // K2
  if (erg.regel === 'gruppe-gruppe') for (const id of new Set([].concat(a.ids || [], b.ids || []))) if (Bewertung.LAUTE_GRUPPEN[id]) hinweise.push(Bewertung.LAUTE_GRUPPEN[id]);   // K2
  for (const [s, n] of [[a, 'A'], [b, 'B']]) {
    if (s.amLimit) hinweise.push(n + ': ' + s.amLimit);
    for (const w of s.warnungen || []) hinweise.push(n + ': ' + w);
    for (const f of s.fehlerlaeufe || []) hinweise.push(n + ': Fehlerlauf ausgeschlossen: ' + f.kennung + ' (' + f.grund + ')');
  }
  // S1: verschiedene Quellen (Mensch gegen Bot), auch ohne basis:; die Basis ist immer Bot-Laeufe
  if (Bewertung.quellenText(a.quellen, b.quellen, 'A', 'B')) hinweise.push(a.basis || b.basis ? Bewertung.BASIS_ART_TEXT : Bewertung.quellenText(a.quellen, b.quellen, 'A', 'B'));
  // S2: Kennzahl-Version beider Seiten (kz.version bzw. Basis-Kopf)
  for (const d of Bewertung.versionsZeile({ version: a.version }, { version: b.version }, ['B', 'A'])) hinweise.push(d.name);
  const kopfA = { kopf: { plattform: a.plattformen && a.plattformen.length === 1 ? a.plattformen[0] : null } };
  for (const d of Bewertung.plattformZeile(kopfA, { plattform: b.plattformen && b.plattformen.length === 1 ? b.plattformen[0] : null })) hinweise.push(d.name);
  hinweise.push('Technik (Tickzeit, Snapshot, Kappung, Protokollgröße) wird nie verglichen, nur der deterministische Teil');
  for (const h of hinweise) kopf.push(...umbruch('- Hinweis: ' + h, MAX_ZEILE));
  const wes = zeilen.filter((z) => z.wesentlich).sort((p, q) => q.score - p.score || nachKey(p, q));
  const fazit = '- **Ergebnis:** ' + wes.length + ' wesentliche Abweichung' + (wes.length === 1 ? '' : 'en') + ' von ' + erg.verglichen + ' verglichenen Kennzahlen' + (erg.zuwenig.size || erg.zuwenigZahl ? ', ' + (erg.zuwenig.size || erg.zuwenigZahl) + ' mit zu wenig Läufen' : '') + (erg.fehlt ? ', ' + erg.fehlt + ' ohne Wert auf einer Seite' : '') + '.';
  kopf.push(fazit);
  if (tun.verschieden && !wes.length) kopf.push(...umbruch('  ' + Bewertung.tuningOhneBefundText(tun.pfade), MAX_ZEILE, '  '));   // K3
  kopf.push('');
  let sicht;
  const reste = [];
  if (opt.alle) sicht = zeilen.slice().sort((p, q) => fragenNr(p) - fragenNr(q) || nachKey(p, q));
  else {
    const kern = kernZeilen(zeilen, true).filter((z) => !z.wesentlich);
    const nullWeg = kernZeilen(zeilen).filter((z) => !z.wesentlich && z.konstantNull).length;   // K5: Kernkennzahlen, die auf beiden Seiten konstant 0 sind, entfallen
    const platz = Math.max(TABELLE_MIN, ZEILEN_STANDARD - kopf.length - 4);
    const wz = Math.min(wes.length, platz - Math.min(kern.length, KERN_MIN));
    const kz = Math.min(kern.length, platz - wz);
    sicht = wes.slice(0, wz).concat(kern.slice(0, kz));
    if (wes.length > wz) reste.push((wes.length - wz) + ' weitere wesentliche Abweichungen');
    if (kern.length > kz) reste.push((kern.length - kz) + ' weitere Kernkennzahlen');
    if (nullWeg) reste.push(nullWeg + ' Kernkennzahl' + (nullWeg === 1 ? '' : 'en') + ', auf beiden Seiten konstant 0, nicht gezeigt');
    const nicht = zeilen.length - sicht.length;
    reste.push(nicht + ' weitere Kennzahlen ohne wesentliche Abweichung nur mit --alle');
  }
  const tabelle = ['| Kennzahl | A | B | Δ | Δ % | Markierung | Einheit |', '|---|---|---|---|---|---|---|'].concat(sicht.map(zeileText));
  const text = kopf.concat(tabelle, reste.length ? ['', '_' + reste.join('; ') + '._'] : []).join('\n') + '\n';
  return { text, zeilen, wesentlich: wes.length, ergebnis: erg, sichtbar: sicht.length };
}

module.exports = {
  filterParsen, filterPasst, mischung, fehlerlaufVon, seiteAusLaeufen, seiteAusBasis, vergleichen, tuningPfade, teileUnterschied, kernZeilen, zeilenBauen,
  KERN, MAX_ZEILE, ZEILEN_STANDARD,
};
