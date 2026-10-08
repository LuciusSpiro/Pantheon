'use strict';
// Ablage erzeugter Missionen (CONTRACT-S2 §8c, Wunsch Kai 2026-10-08): Jede vom Spielleiter erzeugte Mission landet dauerhaft
// in content/spielleiter/erzeugt/<JJJJ-MM-TT>_<kennung>/ – als spielbare Aufzeichnung (mission.json, Archiv-Format
// llm-aufzeichnung/1 + fertiges Regiebuch + Metadaten) und als lesbare Fassung fürs Review (mission.md). Kai gibt frei, indem
// er im Frontmatter der mission.md `status: offen` → `angenommen` setzt (oder `npm run missionen -- annehmen <ordner>`);
// archiv.js lädt freigegebene Missionen dann als Standard-Missionen.
//
//   const ab = Ablage.create({ dir, mock?, onError?, now? })   // dir Pflicht; mock: auch Mock-Bücher ablegen
//   ab.saveBook({ book, grobplan, szenen, meta, kontext? })    // Buch registriert (Spielleiter-Angebot)  -> true | false
//   ab.updateBook({ book, grobplan, szenen, meta, kontext? })  // Szene ersetzt (Stand = zuletzt gültiges Buch)
//   ab.recordPlay({ id, welt?, ausgang, dauer_s, crew, datum? }) // Mission beendet -> Abschnitt „Gespielt“
//   ab.flush()                                                 // -> Promise (alle geplanten Schreibvorgänge erledigt)
//   ab.errors / ab.written                                     // Zähler
//   Ablage.fromEnv(env, { live, onError })   // Ablage für den Spielleiter oder null (ohne ERZEUGT_DIR nur live / ERZEUGT_MOCK=1)
//   Ablage.renderMarkdown(entry, { status, notizen }?)         // reine Funktion, deterministisch
//   Ablage.list(dir)                       -> [{ ordner, status, titel, quelle, auftraggeber, erstellt, gespielt, fehler? }]
//   Ablage.setStatus(dir, ordner, status)  -> { ok, status?, error? }
//   Ablage.rewrite(dir, ordner)            -> { ok, error? }   (md aus mission.json neu, Status/Notizen bleiben)
//   Ablage.archivEntry(rec, file)          -> entry (Archiv-Aufzeichnung -> Ablage-Format, Regiebuch gebaut)
//   Ablage.writeArchivMarkdown(archivDir?) -> [{ name, ok, error? }]   (rückwirkend: archiv/<name>.md neben die .json)
//
// meta: { mission_id?, welt, plan, origin, quelle: 'llm'|'mock'|'archiv', modell, tokens, anlass, szenen_quelle: { sid: quelle },
//         erinnerung_text, warnungen? }
// szenen: { sid: answer } oder { sid: { answer, quelle } } (wie plan.bookAnswers)
//
// Nie blockierend im Tick: saveBook/updateBook/recordPlay machen nur eine Momentaufnahme (JSON) und schreiben in setImmediate,
// nacheinander, atomar (tmp + rename). Fehler werden gezählt (onError), nie geworfen.

const fs = require('fs');
const path = require('path');
const Archiv = require('./archiv.js');

const FORMAT = 'llm-aufzeichnung/1';
const STATUS = ['offen', 'angenommen', 'abgelehnt'];
const DIR = Archiv.ERZEUGT_DIR;
const NOTES_HEAD = '## Notizen';
const NOTES_DEFAULT = '_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._';
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

// ---------- Hilfen ----------
let LOC = null;
function locName(id) {
  if (!LOC) { try { LOC = Object.fromEntries(require('../../shared/locations.js').LOCATIONS.map((l) => [l.id, l])); } catch (e) { LOC = {}; } }
  return (id && LOC[id] && LOC[id].name) || id || '–';
}
function npcName(id, book) {
  if (!id) return '–';
  const st = book && book.besetzung && book.besetzung.stimmen;
  if (st && st[id] && st[id].name) return st[id].name;
  try { return require('./loader.js').npcName(id) || id; } catch (e) { return id; }
}
function slugify(s, n) {
  return String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, n || 48) || 'mission';
}
function localDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}
function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}
let SEQ = 0;
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++SEQ}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); } catch (e) {
    // Windows: Datei gerade in einem Editor offen (EPERM/EBUSY) -> direkt schreiben
    try { fs.unlinkSync(tmp); } catch (e2) { /* egal */ }
    if (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') fs.writeFileSync(file, text, 'utf8'); else throw e;
  }
}
// Vorhandene mission.md: Status und Notizen (bleiben beim Neuschreiben erhalten)
function readMdState(file) {
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { status: null, notizen: null }; }
  const s = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const i = s.indexOf('\n' + NOTES_HEAD);
  let notizen = null;
  if (i >= 0) { const rest = s.slice(i + 1 + NOTES_HEAD.length); const nl = rest.indexOf('\n'); notizen = (nl >= 0 ? rest.slice(nl + 1) : '').replace(/^\n+|\s+$/g, '') || null; }
  return { status: Archiv.mdStatus(s), notizen };
}
const fmtErr = (x) => (typeof x === 'string' ? x : `${x.code || ''} ${x.p || ''}: ${x.msg || ''}`.trim());
function mmss(sec) { if (!Number.isFinite(sec)) return '–'; const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ---------- Eintrag (mission.json) ----------
function normAnswers(szenen) {
  const answers = {}; const quelle = {};
  for (const [sid, x] of Object.entries(isObj(szenen) ? szenen : {})) {
    const a = isObj(x) && 'answer' in x ? x.answer : x;
    if (isObj(a)) answers[sid] = clone(a);
    if (isObj(x) && typeof x.quelle === 'string') quelle[sid] = x.quelle;
  }
  return { answers, quelle };
}
function buildEntry(arg, ordner, prev, nowIso) {
  const { book, grobplan } = arg; const m = arg.meta || {};
  const g = grobplan;
  const { answers, quelle } = normAnswers(arg.szenen);
  const erText = m.erinnerung_text || g.erinnerung_text || (book.texte && book.texte['buch.erinnerung']) || null;
  const szQuelle = {};
  for (const s of g.szenen || []) szQuelle[s.id] = (m.szenen_quelle && m.szenen_quelle[s.id]) || quelle[s.id] || (answers[s.id] ? (m.quelle || 'llm') : 'rohfassung');
  const meta = { mission_id: book.id, welt: m.welt || null, plan: m.plan || null, origin: m.origin || 'sl', anlass: clone(m.anlass) || null, szenen_quelle: szQuelle,
    pruefer: arg.pruefer || { fehler: [], warnungen: [] } };
  return {
    format: FORMAT, kind: 'grobplan', key: `erzeugt-${ordner}`, name: ordner,
    quelle: m.quelle || 'llm', modell: m.modell || null, tokens: Number(m.tokens) || 0,
    erstellt: (prev && prev.erstellt) || nowIso, aktualisiert: nowIso,
    meta,
    erinnerung_varianten: isObj(g.erinnerung) && erText ? [{ erinnerung: clone(g.erinnerung), text: erText }] : [],
    erinnerung_neutral: `${npcName(g.auftraggeber, book)} hat wieder Arbeit für die Lerche.`,
    grobplan: clone(g), szenen: answers, regiebuch: clone(book),
    gespielt: prev && Array.isArray(prev.gespielt) ? prev.gespielt : [],
  };
}

// Prüferergebnis (außerhalb des Ticks): Regiebuch-Prüfer + Grobplan-Regeln S2 (wenn ein Kontext da ist)
let ENV = null;
function pruefe(book, grobplan, kontext, extra) {
  const fehler = []; const warnungen = [];
  try {
    const SB = require('./szenenbau.js');
    const r = SB.checkBook(book);
    fehler.push(...r.errors.map(fmtErr)); warnungen.push(...(r.warnings || []).map(fmtErr));
    if (kontext) {
      ENV = ENV || SB.buildEnv(require('./katalog.js').load({}));
      const s2 = SB.checkGrobplanS2(grobplan, ENV, kontext, { origin: 'sl' });
      warnungen.push(...s2.warnings.map((w) => 'Grobplan: ' + w), ...s2.errors.map((w) => 'Grobplan: ' + w));
    }
  } catch (e) { warnungen.push('Prüfung nicht möglich: ' + e.message); }
  for (const w of extra || []) warnungen.push(String(w));
  return { fehler: [...new Set(fehler)], warnungen: [...new Set(warnungen)] };
}

// ---------- Lesbare Fassung (mission.md) ----------
function renderMarkdown(entry, opts) {
  const o = opts || {};
  const e = entry || {};
  const g = e.grobplan || {}; const book = e.regiebuch || {}; const meta = e.meta || {};
  const texte = book.texte || {};
  const T = (x) => { if (typeof x !== 'string') return x == null ? '' : String(x); if (x[0] === '@') { const k = x.slice(1); return typeof texte[k] === 'string' ? texte[k] : x; } return x; };
  const q = (x) => `„${String(T(x)).replace(/\s+/g, ' ').trim()}“`;
  const who = (id) => npcName(id, book);
  const status = STATUS.includes(o.status) ? o.status : 'offen';
  const L = [];
  const titel = (book.kopf && book.kopf.titel) || g.titel || e.name || 'Mission';
  // Frontmatter
  L.push('---', `status: ${status}`, `quelle: ${e.quelle || '–'}`, `erstellt: ${e.erstellt || '–'}`, `auftraggeber: ${g.auftraggeber || (book.kopf && book.kopf.auftraggeber) || '–'}`,
    `titel: ${JSON.stringify(titel)}`, `kennung: ${e.name || '–'}`, '---', '');
  L.push(`# ${titel}`, '');
  L.push('> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen ' + (e.name || '<ordner>') + '`) – dann gehört die Mission',
    '> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status',
    '> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.', '');
  // Steckbrief
  const bel = book.buch && book.buch.belohnung ? T(book.buch.belohnung) : null;
  const dauer = (book.buch && book.buch.dauer_min) || g.zielspieldauer_min || (book.kopf && book.kopf.zielspieldauer_min);
  const quelleTxt = [e.quelle || '–', e.modell ? `Modell ${e.modell}` : null, e.tokens ? `${e.tokens} Tokens` : null].filter(Boolean).join(', ');
  L.push('| | |', '|---|---|');
  L.push(`| Auftraggeber | ${who(g.auftraggeber)} (\`${g.auftraggeber || '–'}\`) |`);
  L.push(`| Quelle | ${quelleTxt} |`);
  if (meta.welt) L.push(`| Welt / Anlass | \`${meta.welt}\`${meta.anlass && meta.anlass.art ? ` – ${meta.anlass.art}${meta.anlass.nach ? ` nach \`${meta.anlass.nach}\`` : ''}${meta.anlass.ausgang ? ` (${meta.anlass.ausgang})` : ''}` : ''} |`);
  L.push(`| Zieldauer | ${dauer ? dauer + ' min' : '–'} |`);
  L.push(`| Belohnung | ${bel || '–'} |`);
  L.push(`| Ziel | ${book.buch && book.buch.ziel ? locName(book.buch.ziel) : '–'} |`);
  L.push(`| Szenen | ${(g.szenen || []).length} |`);
  L.push('');
  L.push('## Pitch', '', String(g.aufhaenger || T(book.buch && book.buch.briefing) || '–').trim(), '');
  // Erinnerung
  L.push('## Erinnerung', '');
  const ref = (r) => (isObj(r) ? (r.neutral ? 'neutral (noch keine gemeinsame Geschichte)' : r.fakt ? `Fakt \`${r.fakt}\`` : `${who(r.npc)} / \`${r.ereignis}\``) : '–');
  const erBuch = book.buch && book.buch.erinnerung ? T(book.buch.erinnerung) : (g.erinnerung_text || null);
  if (erBuch) L.push(`${q(erBuch)}${isObj(g.erinnerung) ? ` – Bezug: ${ref(g.erinnerung)}` : ''}`, '');
  const vars = (e.erinnerung_varianten || []).filter((v) => v && v.text && v.text !== erBuch);
  if (vars.length) { L.push('Varianten (je nach Weltstand):'); for (const v of vars) L.push(`- ${ref(v.erinnerung)}: ${q(v.text)}`); L.push(''); }
  if (e.erinnerung_neutral) L.push(`Ohne passende Erinnerung: ${q(e.erinnerung_neutral)}`, '');
  if (!erBuch && !vars.length && !e.erinnerung_neutral) L.push('–', '');

  // Szenen
  const szenen = g.szenen || [];
  const sceneOf = (stepId) => { let best = null; for (const s of szenen) if ((stepId === s.id || stepId.startsWith(s.id + '_')) && (!best || s.id.length > best.length)) best = s.id; return best; };
  const stepsBy = {}; const rest = [];
  for (const st of book.steps || []) { const sid = sceneOf(String(st.id || '')); if (sid) (stepsBy[sid] = stepsBy[sid] || []).push(st); else rest.push(st); }
  const entsch = Array.isArray(g.entscheidungen) ? g.entscheidungen : [];
  L.push('## Szenen', '');
  szenen.forEach((s, i) => {
    L.push(`### ${i + 1}. ${s.id} – ${locName(s.ort)}${s.karte ? ` (Karte ${s.karte})` : ''}`, '');
    const bausteine = (s.molekuele || []).map((m) => `\`${m.id}/${m.umsetzung}\``).join(', ') || '–';
    const sq = meta.szenen_quelle && meta.szenen_quelle[s.id];
    L.push(`- **Szenentyp:** ${s.szenentyp || '–'} · **Baustein:** ${bausteine}${sq && (s.molekuele || []).length ? ` · **Fassung:** ${sq}` : ''}${s.dauer_min ? ` · **Plan:** ${s.dauer_min} min` : ''}`);
    if (s.sachverhalt) L.push(`- **Sachverhalt:** ${String(s.sachverhalt).trim()}`);
    if (s.wendung) L.push(`- **Wendung (Plan):** ${typeof s.wendung === 'string' ? s.wendung : JSON.stringify(s.wendung)}`);
    const weiter = (s.weiter || []).map((w) => `${w.wenn ? w.wenn + ' → ' : ''}${String(w.nach).startsWith('ausgang:') ? 'Ausgang `' + String(w.nach).slice(8) + '`' : '`' + w.nach + '`'}`);
    if (weiter.length) L.push(`- **Weiter:** ${weiter.join('; ')}`);
    L.push('');
    for (const d of entsch.filter((x) => x && x.szene === s.id)) {
      L.push(`**Entscheidung:** ${d.frage || '–'}`, '');
      for (const op of d.optionen || []) L.push(`- ${op.text || op.id}${op.folge ? ` → ${op.folge}` : ''}`);
      L.push('');
    }
    const steps = stepsBy[s.id] || [];
    const ziele = [];
    for (const st of steps) for (const ob of st.objectives || []) if (ob && ob.text) ziele.push(T(ob.text));
    if (ziele.length) { L.push('**Ziele**', ''); for (const z of ziele) L.push(`- ${z}`); L.push(''); }
    const tl = [];
    for (const st of steps) tl.push(...stepLines(st, T, q, who));
    L.push('**Texte in Reihenfolge**', '');
    if (tl.length) L.push(...tl); else L.push('- –');
    L.push('');
  });
  if (rest.length) {
    L.push('### Weitere Schritte', '');
    for (const st of rest) { L.push(`- \`${st.id}\``); L.push(...stepLines(st, T, q, who).map((x) => '  ' + x)); }
    L.push('');
  }
  if (isObj(book.on) && Object.keys(book.on).length) {
    L.push('### Ereignisse (ganze Mission)', '');
    for (const [ev, list] of Object.entries(book.on)) { const sub = actionLines(list, T, q, who, null, 1); if (sub.length) { L.push(`- bei \`${ev}\`:`); L.push(...sub); } }
    L.push('');
  }

  // Ausgänge
  L.push('## Ausgänge', '');
  const aus = isObj(book.ausgaenge) ? book.ausgaenge : {};
  const gAus = isObj(g.ausgaenge) ? g.ausgaenge : {};
  const aids = [...new Set([...Object.keys(gAus), ...Object.keys(aus)])];
  if (!aids.length) L.push('–', '');
  for (const aid of aids) {
    L.push(`### ${aid}`, '');
    const wann = (gAus[aid] && gAus[aid].wann) || (aus[aid] && T(aus[aid].beschreibung));
    if (wann) L.push(`*${String(wann).trim()}*`, '');
    const folgen = aus[aid] ? aus[aid].folgen || [] : null;
    if (folgen) {
      for (const f of folgen) L.push('- ' + folgeLine(f, T, q, who));
    } else for (const f of (gAus[aid] && gAus[aid].folgen) || []) L.push('- ' + (typeof f === 'string' ? f : JSON.stringify(f)));
    L.push('');
  }

  // Prüfer
  L.push('## Prüfer', '');
  const pr = meta.pruefer || {};
  const pf = pr.fehler || []; const pw = pr.warnungen || [];
  if (!pf.length && !pw.length) L.push('Keine Fehler, keine Warnungen.');
  for (const f of pf) L.push(`- **Fehler:** ${f}`);
  for (const w of pw) L.push(`- Warnung: ${w}`);
  L.push('');

  // Gespielt
  L.push('## Gespielt', '');
  const gs = Array.isArray(e.gespielt) ? e.gespielt : [];
  if (!gs.length) L.push('Noch nicht gespielt.');
  else {
    L.push('| Datum | Ausgang | Dauer | Crew |', '|---|---|---|---|');
    for (const x of gs) L.push(`| ${x.datum ? String(x.datum).replace('T', ' ').slice(0, 16) : '–'} | ${x.ausgang || '–'} | ${mmss(x.dauer_s)} | ${x.crew || '–'} |`);
  }
  L.push('');
  L.push(NOTES_HEAD, '', o.notizen || NOTES_DEFAULT, '');
  return L.join('\n');
}

// Texte eines Schritts in Spielreihenfolge: Start, Annahme, Timer (nach Zeit), Regeln, Sprungsperren, übrige Wahlen
const STEP_DONE = new Set(['id', 'loc', 'umsetzung', 'liefert_flags', 'objectives', 'next', 'skip', 'restartOnReturn', 'enter', 'onAccept', 'timers', 'rules', 'jumpBlock', 'choices', 'on']);
function stepLines(st, T, q, who) {
  const L = [];
  const used = new Set();
  const ctx = { choices: isObj(st.choices) ? st.choices : {}, used };
  const add = (list, notes) => L.push(...actionLines(list, T, q, who, ctx, 0, notes));
  // Zeitleiste: Start (0 s), verzögerte Start-Aktionen (after) und Timer nach Zeitpunkt, stabil sortiert
  const tl = [];
  const enter = Array.isArray(st.enter) ? st.enter : (st.enter ? [st.enter] : []);
  for (const a of enter) {
    if (isObj(a) && isObj(a.after) && Object.keys(a).filter((k) => k !== 'if').length === 1) tl.push({ t: Number(a.after.sec) || 0, list: a.after.do || [], notes: [`nach ${a.after.sec} s`] });
    else tl.push({ t: 0, list: [a], notes: [] });
  }
  if (st.onAccept) tl.push({ t: 0, list: st.onAccept, notes: ['bei Annahme'] });
  for (const t of Array.isArray(st.timers) ? st.timers : []) tl.push({ t: Number(t.at) || 0, list: [t], notes: [`nach ${t.at} s`, t.garantie === 'hinweis' ? 'Hinweis, falls nötig' : (t.if ? 'bedingt' : null)] });
  tl.map((x, i) => Object.assign(x, { i })).sort((a, b) => a.t - b.t || a.i - b.i).forEach((x) => add(x.list, x.notes));
  for (const r of Array.isArray(st.rules) ? st.rules : []) add([r], [r.garantie === 'autoloesung' ? 'Autolösung' : 'sobald erfüllt']);
  for (const j of Array.isArray(st.jumpBlock) ? st.jumpBlock : []) add([j], []);
  for (const id of Object.keys(ctx.choices)) if (!used.has(id)) add([{ choice: id }], []);
  if (isObj(st.on)) for (const [ev, list] of Object.entries(st.on)) add(list, [`bei ${ev}`]);
  for (const [k, v] of Object.entries(st)) if (!STEP_DONE.has(k) && (isObj(v) || Array.isArray(v))) add(v, []);
  return L;
}
const ACT_DONE = new Set(['if', 'garantie', 'at', 'id', 'radio', 'oda', 'log', 'reason', 'reward', 'rewardNotice', 'choice', 'after', 'do', 'wendung', 'ankuendigung', 'wirkung', 'marks', 'spawn', 'set', 'setFlag', 'text', 'from']);
function actionLines(list, T, q, who, ctx, depth, notes) {
  const L = [];
  const ind = (d) => '  '.repeat(d);
  const act = (a, d, ns) => {
    if (Array.isArray(a)) { for (const x of a) act(x, d, ns); return; }
    if (!isObj(a)) return;
    const n = (ns || []).filter(Boolean);
    const pre = `${ind(d)}- ${n.length ? `*(${n.join(', ')})* ` : ''}`;
    if (a.wendung && (a.ankuendigung || a.wirkung)) {
      const an = isObj(a.ankuendigung) ? a.ankuendigung : {};
      const anText = an.oda ? `ODA ${q(an.oda)}` : (isObj(an.radio) ? `Funk ${who(an.radio.from)}: ${q(an.radio.text)}` : '–');
      const art = [an.art, an.vorlauf_s ? `${an.vorlauf_s} s Vorlauf` : null].filter(Boolean).join(', ');
      L.push(`${pre}**Wendung** \`${a.wendung}\` – Ankündigung${art ? ` (${art})` : ''}: ${anText}`);
      act(a.wirkung || [], d + 1, []);
      return;
    }
    if (isObj(a.radio)) L.push(`${pre}**Funk – ${who(a.radio.from)}:** ${q(a.radio.text)}${a.radio.accept ? ' *(Auftrag annehmen)*' : ''}`);
    if (typeof a.oda === 'string') L.push(`${pre}**ODA:** ${q(a.oda)}`);
    if (typeof a.log === 'string') L.push(`${pre}**Log:** ${q(a.log)}`);
    if (typeof a.reason === 'string') L.push(`${pre}**Sprungsperre:** ${q(a.reason)}`);
    if (isObj(a.reward) && a.reward.marks) L.push(`${pre}Belohnung: ${a.reward.marks} Marken`);
    if (a.do === 'pay_marks') L.push(`${pre}Zahlung: ${a.marks} Marken`);
    if (typeof a.choice === 'string') {
      const c = ctx && ctx.choices[a.choice];
      if (ctx) ctx.used.add(a.choice);
      L.push(`${pre}**Entscheidung** \`${a.choice}\`${c && c.prompt ? `: ${q(c.prompt)}` : ''}`);
      if (c) for (const op of c.options || []) {
        L.push(`${ind(d + 1)}- Option \`${op.id}\`: ${q(op.label)}`);
        act((c.on || {})[op.id] || [], d + 2, []);
      }
    }
    // übrige Textverweise (z. B. direction_hint.text, chronik) – nichts Sichtbares geht verloren
    for (const [k, v] of Object.entries(a)) {
      if (typeof v !== 'string' || v[0] !== '@' || ['oda', 'log', 'reason'].includes(k)) continue;
      L.push(`${pre}**${k === 'text' && typeof a.do === 'string' ? (a.do === 'direction_hint' ? 'ODA (Richtung)' : `Text (${a.do})`) : k}:** ${q(v)}`);
    }
    if (isObj(a.after)) act(a.after.do || [], d, [...n, `nach ${a.after.sec} s`]);
    if (Array.isArray(a.do)) act(a.do, d, n);
    for (const [k, v] of Object.entries(a)) if (!ACT_DONE.has(k) && (isObj(v) || Array.isArray(v))) act(v, d, n);
  };
  act(list, depth || 0, notes || []);
  return L;
}
function folgeLine(f, T, q, who) {
  if (!isObj(f)) return String(f);
  if (isObj(f.reward)) return f.reward.marks > 0 ? `Belohnung: ${f.reward.marks} Marken` : 'Belohnung: keine Marken';   // QA S2b: nie „0 Marken“
  switch (f.do) {
    case 'npc_haltung': return `Haltung ${who(f.npc)}: ${f.delta > 0 ? '+' : ''}${f.delta}`;
    case 'npc_gedaechtnis': return `Gedächtnis ${who(f.npc)} (\`${f.ereignis}\`): ${q(f.text)}`;
    case 'chronik': return `Chronik: ${q(f.text)}`;
    case 'welt_fakt': return `Fakt \`${f.key}\`${f.faden ? ' (offener Faden)' : ''}: ${q(f.value)}`;
    case 'npc_status': return `Status ${who(f.npc)}: ${f.status}`;
    default: return '`' + JSON.stringify(f).slice(0, 160) + '`';
  }
}

// ---------- Ablage (Schreiben) ----------
class Ablage {
  constructor(opts) {
    const o = opts || {};
    this.dir = o.dir;
    this.mock = !!o.mock;
    this.onError = typeof o.onError === 'function' ? o.onError : null;
    this.now = typeof o.now === 'function' ? o.now : () => new Date();
    this.folders = {};        // `${welt}|${missionId}` -> Ordnername
    this.chain = Promise.resolve();
    this.errors = 0; this.written = 0; this.skipped = 0;
  }
  fail(e) { this.errors++; try { if (this.onError) this.onError(e); } catch (x) { /* nie werfen */ } }
  schedule(job) {
    this.chain = this.chain.then(() => new Promise((resolve) => setImmediate(() => { try { job(); } catch (e) { this.fail(e); } resolve(); })));
    return true;
  }
  flush() { return this.chain; }
  key(welt, id) { return `${welt || ''}|${id}`; }
  // Ordner zu einer Mission: aus diesem Lauf, sonst per Suche (Welt + Missions-ID, jüngster zuerst)
  findFolder(id, welt, titel) {
    const k = this.key(welt, id);
    if (this.folders[k]) return this.folders[k];
    let names = [];
    try { names = fs.readdirSync(this.dir, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort().reverse(); } catch (e) { return null; }
    for (const n of names) {
      try {
        const rec = readJson(path.join(this.dir, n, 'mission.json'));
        const m = rec.meta || {};
        const t = rec.regiebuch && rec.regiebuch.kopf ? rec.regiebuch.kopf.titel : null;
        if (m.mission_id === id && (!welt || !m.welt || m.welt === welt) && (!titel || t === titel)) { this.folders[k] = n; return n; }
      } catch (e) { /* kein Ablage-Ordner */ }
    }
    return null;
  }
  newFolder(id) {
    const base = `${localDate(this.now())}_${slugify(id, 48)}`;
    let n = base; let i = 1;
    while (fs.existsSync(path.join(this.dir, n))) n = `${base}-${++i}`;
    return n;
  }
  snapshot(arg) {
    if (!isObj(arg) || !isObj(arg.book) || !isObj(arg.grobplan) || !Array.isArray(arg.grobplan.szenen)) throw new Error('Ablage: book und grobplan nötig');
    return JSON.parse(JSON.stringify({ book: arg.book, grobplan: arg.grobplan, szenen: arg.szenen || {}, meta: arg.meta || {} }));
  }
  saveBook(arg) { return this.store(arg, 'save'); }
  updateBook(arg) { return this.store(arg, 'update'); }
  store(arg, how) {
    try {
      if (!this.dir) return false;
      const snap = this.snapshot(arg);
      const quelle = snap.meta.quelle || 'llm';
      if (quelle === 'mock' && !this.mock) { this.skipped++; return false; }
      const kontext = arg.kontext || null;
      return this.schedule(() => {
        const id = snap.book.id; const welt = snap.meta.welt || null;
        // neues Angebot -> immer neuer Ordner (IDs wiederholen sich zwischen Läufen); Szene ersetzt -> derselbe Ordner
        let ordner = how === 'update' ? this.findFolder(id, welt, snap.book.kopf && snap.book.kopf.titel) : null;
        if (!ordner) ordner = this.newFolder(id);
        this.folders[this.key(welt, id)] = ordner;
        const dir = path.join(this.dir, ordner);
        let prev = null;
        try { prev = readJson(path.join(dir, 'mission.json')); } catch (e) { prev = null; }
        snap.pruefer = pruefe(snap.book, snap.grobplan, kontext, snap.meta.warnungen);
        const entry = buildEntry(snap, ordner, prev, this.now().toISOString());
        if (how === 'update' && prev) entry.meta.aktualisierungen = (Number(prev.meta && prev.meta.aktualisierungen) || 0) + 1;
        this.writeEntry(dir, entry);
      });
    } catch (e) { this.fail(e); return false; }
  }
  recordPlay(arg) {
    try {
      if (!this.dir || !isObj(arg) || !arg.id) return false;
      const play = { datum: arg.datum || this.now().toISOString(), ausgang: arg.ausgang || null,
        dauer_s: Number.isFinite(arg.dauer_s) ? Math.round(arg.dauer_s) : null, crew: Number.isFinite(arg.crew) ? arg.crew : null };
      const id = String(arg.id); const welt = arg.welt || null;
      return this.schedule(() => {
        const ordner = this.findFolder(id, welt);
        if (!ordner) return;   // z. B. Mock-Buch ohne ERZEUGT_MOCK – nichts abgelegt
        const dir = path.join(this.dir, ordner);
        const entry = readJson(path.join(dir, 'mission.json'));
        entry.gespielt = (Array.isArray(entry.gespielt) ? entry.gespielt : []).concat([play]);
        this.writeEntry(dir, entry);
      });
    } catch (e) { this.fail(e); return false; }
  }
  writeEntry(dir, entry) {
    writeAtomic(path.join(dir, 'mission.json'), JSON.stringify(entry, null, 2) + '\n');
    const md = path.join(dir, 'mission.md');
    const st = readMdState(md);
    writeAtomic(md, renderMarkdown(entry, { status: st.status || 'offen', notizen: st.notizen }));
    this.written++;
  }
}

function create(opts) { return new Ablage(opts); }

// Ablage für den Spielleiter: ERZEUGT_DIR lenkt um; ohne ERZEUGT_DIR nur bei Live-LLM bzw. ERZEUGT_MOCK=1 ins Repo
// (Tests mit script/replay-LLM schreiben so nie nach content/). Mock-Bücher nur mit ERZEUGT_MOCK=1.
function fromEnv(env, opts) {
  const e = env || process.env; const o = opts || {};
  const mock = e.ERZEUGT_MOCK === '1';
  const dir = e.ERZEUGT_DIR || ((o.live || mock) ? DIR : null);
  if (!dir) return null;
  return create({ dir, mock, onError: o.onError });
}

// ---------- Werkzeuge (tools/missionen.js) ----------
function list(dir) {
  const d = dir || DIR;
  let names = [];
  try { names = fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort(); } catch (e) { return []; }
  const out = [];
  for (const n of names) {
    const row = { ordner: n, status: null, titel: null, quelle: null, auftraggeber: null, erstellt: null, gespielt: 0 };
    try {
      const rec = readJson(path.join(d, n, 'mission.json'));
      row.titel = (rec.regiebuch && rec.regiebuch.kopf && rec.regiebuch.kopf.titel) || (rec.grobplan && rec.grobplan.titel) || n;
      row.quelle = rec.quelle || null; row.auftraggeber = rec.grobplan ? rec.grobplan.auftraggeber : null;
      row.erstellt = rec.erstellt || null; row.gespielt = Array.isArray(rec.gespielt) ? rec.gespielt.length : 0;
      row.ausgaenge = Array.isArray(rec.gespielt) ? rec.gespielt.map((x) => x.ausgang).filter(Boolean) : [];
    } catch (e) { row.fehler = 'mission.json: ' + e.message; }
    row.status = readMdState(path.join(d, n, 'mission.md')).status || 'offen';
    out.push(row);
  }
  return out;
}
function rewrite(dir, ordner) {
  try {
    const p = path.join(dir || DIR, ordner);
    const entry = readJson(path.join(p, 'mission.json'));
    const st = readMdState(path.join(p, 'mission.md'));
    writeAtomic(path.join(p, 'mission.md'), renderMarkdown(entry, { status: st.status || 'offen', notizen: st.notizen }));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
function setStatus(dir, ordner, status) {
  try {
    if (!STATUS.includes(status)) return { ok: false, error: `Status '${status}' unbekannt (erlaubt: ${STATUS.join(', ')})` };
    const p = path.join(dir || DIR, ordner);
    if (!fs.existsSync(path.join(p, 'mission.json'))) return { ok: false, error: `Ordner '${ordner}' hat keine mission.json` };
    const md = path.join(p, 'mission.md');
    if (!fs.existsSync(md)) { const r = rewrite(dir, ordner); if (!r.ok) return r; }
    const text = fs.readFileSync(md, 'utf8').replace(/^﻿/, '');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const s = text.replace(/\r\n?/g, '\n');
    const m = /^---\n([\s\S]*?)\n---(\n|$)/.exec(s);
    let out;
    if (!m) out = `---\nstatus: ${status}\n---\n\n` + s;
    else {
      const fm = /^status:.*$/m.test(m[1]) ? m[1].replace(/^status:.*$/m, `status: ${status}`) : `status: ${status}\n${m[1]}`;
      out = `---\n${fm}\n---${m[2]}` + s.slice(m[0].length);
    }
    writeAtomic(md, eol === '\n' ? out : out.replace(/\n/g, '\r\n'));
    return { ok: true, status };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Archiv-Aufzeichnung (content/spielleiter/archiv/<name>.json) -> Eintrag im Ablage-Format, Regiebuch frisch gebaut
function archivEntry(rec, file) {
  const SB = require('./szenenbau.js');
  ENV = ENV || SB.buildEnv(require('./katalog.js').load({}));
  const name = String(rec.name || path.basename(file || 'archiv', '.json'));
  const errs = [];
  const loaded = Archiv.load(path.dirname(file), { erzeugtDir: null }).entries.find((x) => x.name === name);
  if (!loaded) throw new Error(`Archiv-Eintrag '${name}' nicht ladbar`);
  const g = clone(loaded.grobplan);
  const answers = {};
  for (const [sid, a] of Object.entries(loaded.szenen || {})) answers[sid] = { answer: a, quelle: 'archiv' };
  const built = SB.buildBook(g, answers, ENV, { id: `ar_${slugify(name, 36)}`, art: 'archiv', erinnerungText: g.erinnerung_text || null });
  errs.push(...built.errors.map(fmtErr));
  let erstellt = rec.aufgenommen || rec.erstellt || null;
  if (!erstellt && file) { try { erstellt = localDate(fs.statSync(file).mtime); } catch (e) { erstellt = null; } }
  const szq = {};
  for (const s of g.szenen) szq[s.id] = built.szenen[s.id] ? built.szenen[s.id].quelle : 'rohfassung';
  return {
    format: FORMAT, kind: 'grobplan', key: rec.key || `archiv-${name}`, name, quelle: 'archiv', modell: rec.modell || null, tokens: Number(rec.tokens) || 0,
    erstellt, aktualisiert: erstellt,
    meta: { mission_id: built.book.id, welt: null, origin: 'archiv', anlass: null, szenen_quelle: szq,
      pruefer: { fehler: errs, warnungen: [...new Set((built.warnings || []).map(fmtErr))] } },
    erinnerung_varianten: rec.erinnerung_varianten || [], erinnerung_neutral: rec.erinnerung_neutral || null,
    grobplan: g, szenen: loaded.szenen, regiebuch: built.book, gespielt: [],
  };
}
function writeArchivMarkdown(archivDir) {
  const d = archivDir || Archiv.DIR;
  let files = [];
  try { files = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort(); } catch (e) { return [{ name: d, ok: false, error: e.message }]; }
  const out = [];
  for (const f of files) {
    const file = path.join(d, f); const name = f.replace(/\.json$/, '');
    try {
      const rec = readJson(file);
      const entry = archivEntry(rec, file);
      const md = path.join(d, `${entry.name}.md`);
      const st = readMdState(md);
      writeAtomic(md, renderMarkdown(entry, { status: st.status || 'angenommen', notizen: st.notizen }));
      out.push({ name: entry.name, ok: true, file: md, fehler: entry.meta.pruefer.fehler.length });
    } catch (e) { out.push({ name, ok: false, error: e.message }); }
  }
  return out;
}

module.exports = { create, fromEnv, Ablage, renderMarkdown, list, setStatus, rewrite, archivEntry, writeArchivMarkdown, readMdState, buildEntry, STATUS, DIR, FORMAT };
