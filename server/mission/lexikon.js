'use strict';
// B1 F2 (CONTRACT-B1 §6, INHALT §8): Auflöser für Platzhalter {{lex.<schluessel>}} bzw. {{lex.<schluessel>:<form>}}.
// Wörter je Bauweise aus content/buehnen/lexikon/<bauweise>.json; fehlt die Bauweise oder der Schlüssel, gilt der
// neutrale Eintrag ('neutral'). Einzige Stelle der Ersetzung zur Laufzeit ist mission.tpl() (server/sim/mission.js).
//
// Eintrag: Zeichenkette (nur artikellos verwendbar) oder { wort, genus: m|f|n, plural?, gen?, dat? }
//   (gen/dat: Wortform im Genitiv/Dativ, nur wo sie vom Grundwort abweicht, z. B. "gen": "Sockels"). Listen
//   (fund_alt, namen, ort_muster) sind Auswahl für den Spielleiter; als Platzhalter gilt der erste Eintrag.
// Formen: ohne = Wort ohne Artikel; der|den|dem|des = bestimmter Artikel im Nominativ|Akkusativ|Dativ|Genitiv;
//   ein|einen|einem = unbestimmter Artikel (Nom|Akk|Dat); zum|vom|im|beim|am|ins = Präposition mit Artikel
//   (zum Landeplatz / zur Lichtung); pl = Pluralwort ohne Artikel.
// Am Satzanfang (Textanfang, nach . ! ? und nach „) wird groß geschrieben; nach einem Doppelpunkt nur, wenn danach der
// Satz weitergeht („Captain: Die Zelle ist markiert.“, aber „In Sicherheit: die Beute!“).
// Der Prüfer (checker.js) nutzt offene(): PLATZHALTER, LEX-ARTIKEL, LEX-FORM, Hinweis LEX-NORMALISIERT.
// Namens-Parameter der Umsetzungen: Sachnamen (fund_name, gegenstand, daten_name, probe_name) = Nominativ mit Artikel
// („die Legionskasse“); Eigennamen (ziel_name, Schiffs-/Personennamen) ohne Artikel („Frachter Schiefmaul“). Texte setzen
// beide nur an Stellen ein, an denen der Nominativ passt (Satzsubjekt, nach „Ziel:“ usw.). Aktion fund merkt einen
// Sachnamen für {fund} (mission.js).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'content', 'buehnen', 'lexikon');
const RE_LEX = /\{\{\s*lex\.([a-z0-9_]+)(?::([a-z]+))?\s*\}\}/g;
const RE_ALLE = /\{\{([^{}]*)\}\}/g;

// Artikel je Form und Genus (Plural nur über :pl, ohne Artikel)
const ARTIKEL = {
  der: { m: 'der', f: 'die', n: 'das' },
  den: { m: 'den', f: 'die', n: 'das' },
  dem: { m: 'dem', f: 'der', n: 'dem' },
  des: { m: 'des', f: 'der', n: 'des' },
  ein: { m: 'ein', f: 'eine', n: 'ein' },
  einen: { m: 'einen', f: 'eine', n: 'ein' },
  einem: { m: 'einem', f: 'einer', n: 'einem' },
  // Verschmelzungen (Präposition + Artikel): zum Landeplatz / zur Lichtung, vom/von der, im/in der, beim/bei der,
  // am/an der (Dativ), ins/in die/in den (Akkusativ)
  zum: { m: 'zum', f: 'zur', n: 'zum' },
  vom: { m: 'vom', f: 'von der', n: 'vom' },
  im: { m: 'im', f: 'in der', n: 'im' },
  beim: { m: 'beim', f: 'bei der', n: 'beim' },
  am: { m: 'am', f: 'an der', n: 'am' },
  ins: { m: 'in den', f: 'in die', n: 'ins' },
};
const FALL = { dem: 'dat', einem: 'dat', des: 'gen', zum: 'dat', vom: 'dat', im: 'dat', beim: 'dat', am: 'dat' };
const FORMEN = new Set(Object.keys(ARTIKEL).concat(['pl']));
// Wörter, die direkt vor einem Platzhalter einen Artikel vorwegnehmen (Prüfer LEX-ARTIKEL), auch Verschmelzungen
const ARTIKEL_DAVOR = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'zum', 'zur', 'vom', 'beim', 'im', 'ins', 'am', 'ans', 'aufs', 'durchs', 'fürs', 'übers', 'unters', 'hinters', 'vors']);

let cache = null;
function laden() {
  if (cache) return cache;
  const lex = {}; const neutral = {};
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort(); } catch (e) { files = []; }
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const bw = j.bauweise || f.replace(/\.json$/, '');
      lex[bw] = j;
      for (const [k, v] of Object.entries(j.neutral || {})) if (neutral[k] == null) neutral[k] = v;
    } catch (e) { /* kaputte Datei: Inhaltsprüfung meldet sie; hier nur auslassen */ }
  }
  cache = { lex, neutral };
  return cache;
}
function neuLaden() { cache = null; return laden(); }

// Rohwert -> { wort, genus?, plural?, gen?, dat? } | null
function norm(v) {
  if (Array.isArray(v)) return v.length ? norm(v[0]) : null;
  if (typeof v === 'string') return v ? { wort: v } : null;
  if (v && typeof v === 'object' && typeof v.wort === 'string' && v.wort) return v;
  return null;
}
// Eintrag für einen Schlüssel: Bauweise -> neutral der Bauweise -> neutral aller Lexika -> null
function eintrag(schluessel, bauweise) {
  const { lex, neutral } = laden();
  const l = bauweise && lex[bauweise];
  if (l) {
    const v = norm(l.eintraege && l.eintraege[schluessel]);
    if (v) return v;
    const n = norm(l.neutral && l.neutral[schluessel]);
    if (n) return n;
  }
  return norm(neutral[schluessel]);
}
function wort(schluessel, bauweise) { const e = eintrag(schluessel, bauweise); return e ? e.wort : null; }

// Form eines Eintrags -> Text | null (Form nicht möglich)
function form(e, f) {
  if (!e) return null;
  if (!f) return e.wort;
  if (f === 'pl') return e.plural || null;
  const art = ARTIKEL[f] && e.genus && ARTIKEL[f][e.genus];
  if (!art) return null;
  const fall = FALL[f];
  return art + ' ' + ((fall && e[fall]) || e.wort);
}

// Alle Schlüssel, die irgendein Lexikon kennt (eintraege oder neutral)
function bekannt() {
  const { lex, neutral } = laden();
  const s = new Set(Object.keys(neutral));
  for (const l of Object.values(lex)) for (const k of Object.keys(l.eintraege || {})) s.add(k);
  return s;
}
// Alle Einträge, die für einen Schlüssel je nach Bauweise gelten können (jede Bauweise + ohne Bauweise)
function moegliche(schluessel) {
  const { lex } = laden();
  return Object.keys(lex).concat([null]).map((bw) => [bw, eintrag(schluessel, bw)]);
}

const satzanfang = (vorher, nachher) => /(^|[.!?]\s+|„)\s*$/.test(vorher)
  || (/:\s+$/.test(vorher) && /^\s+[A-Za-zÄÖÜäöüß]/.test(nachher || ''));
const gross = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Text auflösen. Unmögliche Formen bzw. unbekannte Schlüssel (meldet der Prüfer) zeigen das Wort bzw. den Schlüssel.
// ---------- Normalisierer (Entscheid Studioleitung): eindeutige Altformen vor Prüfer und Auflösung umschreiben ----------
//   „das/die {{lex.x}}“ -> {{lex.x:der}}, „den“ -> :den, „dem“ -> :dem, „des … s“/„des“ -> :des, „der“ -> :dem nach einer
//   Präposition (in der Zelle), sonst :der; „ein/eine“ -> :ein, „einen“ -> :einen, „einem/einer“ -> :einem;
//   zum/zur -> :zum, vom/im/beim/am/ins -> gleichnamige Form; durchs/ans/aufs/fürs/übers/unters/hinters/vors -> „durch
//   {{lex.x:den}}“ usw.; angeklebtes -en/-n -> :pl (ein davorstehendes die/der/den bleibt als Pluralartikel).
//   Nicht eindeutig (z. B. „eines“, -s ohne „des“) bleibt stehen und der Prüfer meldet es. -> { text, stellen: [{ code, alt, neu }] }
const W = 'A-Za-zÄÖÜäöüß';
const PRAEP_DAT = new Set(['in', 'an', 'auf', 'aus', 'bei', 'mit', 'nach', 'von', 'zu', 'hinter', 'vor', 'unter', 'über', 'neben', 'zwischen', 'seit', 'gegenüber']);
const ART_FORM = { die: 'der', das: 'der', den: 'den', dem: 'dem', des: 'des', ein: 'ein', eine: 'ein', einen: 'einen', einem: 'einem', einer: 'einem',
  zum: 'zum', zur: 'zum', vom: 'vom', im: 'im', beim: 'beim', am: 'am', ins: 'ins' };
const PRAEP_S = { durchs: 'durch', ans: 'an', aufs: 'auf', 'fürs': 'für', 'übers': 'über', unters: 'unter', hinters: 'hinter', vors: 'vor' };
const PL_ARTIKEL = new Set(['die', 'der', 'den']);
// artikellos nach Präposition: Dativ bzw. Akkusativ eindeutig -> Form; '?' = Fall offen (nur Hinweis)
const PRAEP_OHNE_ART = { mit: 'dem', aus: 'dem', von: 'vom', zu: 'zum', durch: 'den', 'für': 'den', gegen: 'den', ohne: 'den', um: 'den',
  in: '?', an: '?', auf: '?', hinter: '?', vor: '?', unter: '?', 'über': '?', neben: '?', zwischen: '?' };
const FINIT = 'ist|sind|liegt|liegen|steht|stehen|wartet|warten|bleibt|bleiben|wird|werden|hat|haben|war|waren|öffnet|fällt|brennt|geht|läuft|hält|gehört|fehlt';
const RE_SATZ_VERB = new RegExp(`(^|[.!?]\\s+|„|:\\s+)\\{\\{\\s*lex\\.([a-z0-9_]+)\\s*\\}\\}(?=\\s+(?:${FINIT})(?![A-Za-zÄÖÜäöüß]))`, 'g');
const PRAEP_NOM_FORM = { zu: 'zum', von: 'vom', bei: 'beim', mit: 'dem', aus: 'dem', nach: 'dem', seit: 'dem', durch: 'den', 'für': 'den', gegen: 'den', ohne: 'den', um: 'den' };
const RE_PRAEP_NOM = new RegExp(`(^|[^A-Za-zÄÖÜäöüß])(zu|von|bei|mit|aus|nach|seit|durch|für|gegen|ohne|um)\\s+\\{\\{\\s*lex\\.([a-z0-9_]+):der\\s*\\}\\}`, 'gi');
const VERSCHMELZ = { in: 'im', an: 'am', bei: 'beim', von: 'vom', zu: 'zum' };
function normalisieren(text) {
  if (typeof text !== 'string' || text.indexOf('{{') < 0) return { text, stellen: [] };
  const stellen = [];
  const re = new RegExp(`(?:([${W}]+)\\s+)?(?:([${W}]+)\\s+)?\\{\\{\\s*lex\\.([a-z0-9_]+)\\s*\\}\\}([${W}]*)`, 'g');
  const out = text.replace(re, (all, w2, w1, k, suf) => {
    if (w1 === undefined && w2 !== undefined) { w1 = w2; w2 = undefined; }
    const l1 = (w1 || '').toLowerCase(); const l2 = (w2 || '').toLowerCase();
    const davor = (w) => (w ? w + ' ' : '');
    let neu = null;
    if (suf) {
      if ((suf === 'en' || suf === 'n') && !ART_FORM[l1] || PL_ARTIKEL.has(l1) && (suf === 'en' || suf === 'n')) neu = davor(w2) + davor(w1) + `{{lex.${k}:pl}}`;
      else if (suf === 's' && l1 === 'des') neu = davor(w2) + `{{lex.${k}:des}}`;
    } else if ((l1 === 'der' || l1 === 'dem') && VERSCHMELZ[l2]) neu = `{{lex.${k}:${VERSCHMELZ[l2]}}}`;   // in der Zelle -> im Carcer
    else if (l1 === 'der') neu = davor(w2) + `{{lex.${k}:${PRAEP_DAT.has(l2) ? 'dem' : 'der'}}}`;
    else if (ART_FORM[l1]) neu = davor(w2) + `{{lex.${k}:${ART_FORM[l1]}}}`;
    else if (PRAEP_S[l1]) { const p = PRAEP_S[l1]; neu = davor(w2) + (w1[0] === w1[0].toUpperCase() ? gross(p) : p) + ` {{lex.${k}:den}}`; }
    else if (PRAEP_OHNE_ART[l1]) {   // artikellos nach Präposition: Hinweis LEX-PRAEPOSITION, eindeutiger Fall wird gesetzt
      const f = PRAEP_OHNE_ART[l1];
      if (f === '?') { stellen.push({ code: 'LEX-PRAEPOSITION', alt: all.trim(), neu: null }); return all; }
      neu = davor(w2) + (f === 'vom' || f === 'zum' ? `{{lex.${k}:${f}}}` : `${w1} {{lex.${k}:${f}}}`);
      stellen.push({ code: 'LEX-PRAEPOSITION', alt: all.trim(), neu: neu.trim() });
      return neu;
    }
    if (neu === null) return all;
    stellen.push({ code: 'LEX-NORMALISIERT', alt: all.trim(), neu: neu.trim() });
    return neu;
  });
  // Satzanfang ohne Artikel vor einem finiten Verb („{{lex.fund}} ist geborgen!“) -> Nominativ :der
  const out2 = out.replace(RE_SATZ_VERB, (all, v, k) => {
    stellen.push({ code: 'LEX-NORMALISIERT', alt: `{{lex.${k}}}`, neu: `{{lex.${k}:der}} (Satzanfang)` });
    return `${v}{{lex.${k}:der}}`;
  });
  // Lexikon-Name im Nominativ nach Präposition („zu {{lex.fund:der}}“): Genus bekannt -> Fallform
  const out3 = out2.replace(RE_PRAEP_NOM, (all, v, p, k) => {
    const f = PRAEP_NOM_FORM[p.toLowerCase()];
    if (!f) return all;
    const neu = f === 'zum' || f === 'vom' || f === 'beim' ? `{{lex.${k}:${f}}}` : `${p} {{lex.${k}:${f}}}`;
    stellen.push({ code: 'LEX-PRAEPOSITION', alt: `${p} {{lex.${k}:der}}`, neu });
    return v + neu;
  });
  return { text: out3, stellen };
}
// Eingesetzte Sachnamen nach Präposition: nur beugen, wenn Genus/Numerus bekannt ist. Das gilt für Namen aus dem Lexikon
// („zu {{lex.fund:der}}“ -> :zum, normalisieren). Wörtliche Namen („zu die Boje“, „mit die Daten“) bleiben unverändert –
// der Prüfer gibt nur den Hinweis NAME-PRAEPOSITION (Genus und Numerus unbekannt, Plural wäre richtig).
const RE_NAME_PRAEP = new RegExp(`(^|[^${W}])(zu|von|bei|mit|aus|nach|seit|durch|für|gegen|ohne|um) (der|die|das)(?= [A-ZÄÖÜ])`, 'gi');
const NAME_FALSCH = { zu: ['die', 'das'], von: ['die', 'das'], bei: ['die', 'das'], mit: ['die', 'das'], aus: ['die', 'das'], nach: ['die', 'das'],
  seit: ['die', 'das'], durch: ['der'], 'für': ['der'], gegen: ['der'], ohne: ['der'], um: ['der'] };
function namenHinweise(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const m of text.matchAll(RE_NAME_PRAEP)) {
    if ((NAME_FALSCH[m[2].toLowerCase()] || []).includes(m[3].toLowerCase())) out.push(`${m[2]} ${m[3]}`);
  }
  return out;
}

function aufloesen(text, bauweise) {
  if (typeof text !== 'string' || text.indexOf('{{') < 0) return text;
  text = normalisieren(text).text;
  return text.replace(RE_LEX, (all, k, f, pos, whole) => {
    const e = eintrag(k, bauweise);
    let t = form(e, f) || (e && e.wort) || k.replace(/_/g, ' ');
    if (satzanfang(whole.slice(0, pos), whole.slice(pos + all.length))) t = gross(t);
    return t;
  });
}
// Eingesetzte Namen („die Legionskasse“ aus fund_name/ziel_name) am Satzanfang: kleiner Artikel vor großem Nomen -> groß
function satzanfaenge(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/(^|[.!?]\s+|„)(der|die|das|den|dem|ein|eine|einen|einem)(?=\s+[A-ZÄÖÜ])/g, (all, v, w) => v + gross(w));
}
// Wert an einer Stelle einsetzen, die am Satzanfang stehen kann (z. B. {fund} in mission.tpl)
function einsetzen(vorher, wert, nachher) { return satzanfang(vorher, nachher) ? gross(wert) : wert; }

// Prüfer: Probleme eines Texts -> [{ code, platzhalter, grund }]
//   PLATZHALTER: unbekannter lex-Schlüssel, andere {{…}} (nicht ausgefüllte Umsetzung), unvollständige {{ bzw. }}
//   LEX-ARTIKEL: Artikel (auch zum/zur/durchs …) direkt davor, oder Buchstaben direkt danach ({{lex.terminal}}en)
//   LEX-PRAEPOSITION (Hinweis): artikelloser Platzhalter nach Präposition; mit/aus/von/zu -> Dativ, durch/für/gegen/
//     ohne/um -> Akkusativ setzt normalisieren(), sonst bleibt er stehen
//   LEX-NORMALISIERT (Hinweis): eindeutige Altform, die normalisieren() umschreibt (Laufzeit tut dasselbe)
//   LEX-FORM: unbekannte Form, oder ein Eintrag (irgendeiner Bauweise bzw. neutral) gibt Genus/Plural nicht her
function offene(textIn) {
  if (typeof textIn !== 'string' || (textIn.indexOf('{{') < 0 && textIn.indexOf('}}') < 0)) return [];
  const out = []; const known = bekannt();
  const norm = normalisieren(textIn); const text = norm.text;
  for (const st of norm.stellen) out.push({ code: st.code, hinweis: true, platzhalter: st.alt,
    grund: st.neu ? `umgeschrieben zu ${st.neu}` : 'artikellos nach Präposition, Fall offen – Form mit Artikel setzen (z. B. :dem/:den)' });
  const rest = text.replace(RE_ALLE, (all, inner, pos) => {
    const m = /^\s*lex\.([a-z0-9_]+)(?::([a-z0-9_]*))?\s*$/.exec(inner);
    if (!m) { out.push({ code: 'PLATZHALTER', platzhalter: all, grund: 'Platzhalter wird zur Laufzeit nicht ersetzt' }); return ''; }
    const [, k, f] = m;
    if (!known.has(k)) { out.push({ code: 'PLATZHALTER', platzhalter: all, grund: `Lexikon-Schlüssel '${k}' unbekannt (content/buehnen/lexikon)` }); return ''; }
    const vor = /([A-Za-zÄÖÜäöüß]+)\s+$/.exec(text.slice(0, pos));
    if (vor && ARTIKEL_DAVOR.has(vor[1].toLowerCase()) && !(f === 'pl' && PL_ARTIKEL.has(vor[1].toLowerCase()))) out.push({ code: 'LEX-ARTIKEL', platzhalter: all, grund: `Artikel '${vor[1]}' vor dem Platzhalter – Form verwenden (z. B. {{lex.${k}:dem}})` });
    if (/^[A-Za-zÄÖÜäöüß]/.test(text.slice(pos + all.length))) out.push({ code: 'LEX-ARTIKEL', platzhalter: all, grund: `Buchstaben kleben am Platzhalter – Form verwenden (z. B. {{lex.${k}:pl}})` });
    if (f !== undefined && !FORMEN.has(f)) out.push({ code: 'LEX-FORM', platzhalter: all, grund: `Form '${f}' unbekannt (${[...FORMEN].join(', ')})` });
    else if (f) {
      const fehlt = moegliche(k).filter(([, e]) => !form(e, f)).map(([bw]) => bw || 'neutral');
      if (fehlt.length) out.push({ code: 'LEX-FORM', platzhalter: all, grund: `${f === 'pl' ? 'Plural' : 'Genus'} fehlt im Lexikon für ${fehlt.join(', ')}` });
    }
    return '';
  });
  if (rest.indexOf('{{') >= 0 || rest.indexOf('}}') >= 0) out.push({ code: 'PLATZHALTER', platzhalter: rest.trim().slice(0, 40), grund: 'unvollständiger Platzhalter ({{ ohne }} oder umgekehrt)' });
  return out;
}

// Längste Auflösung über alle Bauweisen und neutral (Prüfer ODA-LAENGE)
function laengste(text) {
  if (typeof text !== 'string' || text.indexOf('{{') < 0) return typeof text === 'string' ? text.length : 0;
  return Math.max(...Object.keys(laden().lex).concat([null]).map((bw) => aufloesen(text, bw).length));
}

// Bauweise eines Landepunkts ohne Kartenbau: Laufzeit-Eintrag (game.landepunkte) -> Stammdaten -> Kartenart-Standard
function bauweiseVon(game, mapId) {
  if (!mapId) return null;
  const S = game && game.landepunkte;
  const e = S && ((S.eintraege && S.eintraege[mapId]) || (S.dyn && S.dyn[mapId]));
  if (e && e.bauweise) return e.bauweise;
  let lp = null;
  try { lp = require('./objects.js').landepunkt(mapId); } catch (x) { lp = null; }
  if (lp && lp.bauweise) return lp.bauweise;
  const art = (e && e.art) || (lp && lp.art);
  if (!art || art === 'hand') return null;
  try {
    const a = require('../../content/buehnen/achsen.json');
    return (a.kartenarten && a.kartenarten[art] && a.kartenarten[art].bauweise) || null;
  } catch (x) { return null; }
}

module.exports = { laden, neuLaden, eintrag, wort, form, bekannt, aufloesen, einsetzen, offene, normalisieren, satzanfaenge, namenHinweise, laengste, bauweiseVon, FORMEN, DIR };
