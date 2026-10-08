'use strict';
// Trockenversuch Spielleiter, Stufe 2: eine Szene aus einem Grobplan zum Regiebuch-Abschnitt ausarbeiten.
// Das LLM schreibt keinen Ablauf, sondern füllt nur die Parameter der registrierten Umsetzungen (+ ggf. Verzweigung).
// Das Skript setzt sie mit tools/katalog.js → instantiate in die Vorlagen ein, bettet die Szene in ein Prüf-Regiebuch
// (Folgeszenen als Platzhalter) und prüft mit tools/check-missions.js. Eine Nachbesserung bei Fehlern.
// Aufruf: node concept/regiebuch/trockenversuch/szene.js <grobplan-id> <szenen-id> [--model sonnet|haiku] [--mini]
// Ausgabe: out/<grobplan>.<szene>.<modell>.{antwort.json,regiebuch.json}, Zeile in out/szene-messung.md

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const CONCEPT = path.join(DIR, '..', '..', '..', 'content', 'regiebuch');   // S1: Vorarbeit liegt in content/
const ROOT = path.join(CONCEPT, '..', '..');
const OUT = path.join(DIR, 'out');
const Locations = require(path.join(ROOT, 'shared', 'locations.js'));
const Katalog = require(path.join(ROOT, 'tools', 'katalog.js'));
const { check } = require(path.join(ROOT, 'tools', 'check-missions.js'));
const REG = JSON.parse(fs.readFileSync(path.join(CONCEPT, 'bausteine.json'), 'utf8'));
const args = process.argv.slice(2);
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'sonnet';
const CLAUDE_CLI = process.env.CLAUDE_CLI || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');

const KAT = Katalog.load({});
const LOC = Object.fromEntries(Locations.LOCATIONS.map((l) => [l.id, l]));
const NPC = Object.keys(REG.npc).filter((k) => !k.startsWith('$'));

// ---------- Claude mit sichtbarem Fortschritt ----------
function callClaude(text, sysFile) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [CLAUDE_CLI, '-p', '--model', MODEL, '--tools', '', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--no-session-persistence', '--strict-mcp-config', '--system-prompt-file', sysFile],
    { cwd: OUT, env: Object.assign({}, process.env, { MAX_THINKING_TOKENS: '0' }) });
    let buf = ''; let txt = ''; let result = null; let first = null; let err = ''; let modelId = null;
    const tick = setInterval(() => process.stdout.write(`\r  … ${((Date.now() - t0) / 1000).toFixed(0)} s, ${txt.length} Zeichen${first ? ` (erstes Token nach ${first.toFixed(1)} s)` : ''}   `), 1000);
    const kill = setTimeout(() => p.kill(), 5 * 60 * 1000);
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let o; try { o = JSON.parse(line); } catch (e) { continue; }
        if (o.type === 'system' && o.model) modelId = o.model;
        if (o.type === 'stream_event') { const dl = (o.event || {}).delta || {}; if (dl.type === 'text_delta') { if (first === null) first = (Date.now() - t0) / 1000; txt += dl.text; } }
        if (o.type === 'result') result = o;
      }
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      clearInterval(tick); clearTimeout(kill); process.stdout.write('\n');
      if (code !== 0 && !result) return reject(new Error(`claude fehlgeschlagen (${code}): ${err.slice(0, 300)}`));
      resolve({ text: (result && result.result) || txt, sec: (Date.now() - t0) / 1000, first, modelId,
        cost: result && result.total_cost_usd, out: result && result.usage && result.usage.output_tokens, inp: result && result.usage && (result.usage.input_tokens + (result.usage.cache_read_input_tokens || 0) + (result.usage.cache_creation_input_tokens || 0)) });
    });
    p.stdin.end(text);
  });
}

// ---------- Kontext ----------
function weltstandKurz() {
  const w = JSON.parse(fs.readFileSync(path.join(DIR, 'weltstand-nach-tutorial.json'), 'utf8'));
  const L = [`Marken ${w.schiff.marken}.`, 'NSC:'];
  for (const [id, n] of Object.entries(w.npc)) L.push(`- ${id} (${n.titel} ${n.name}, ${n.fraktion}, Haltung ${n.haltung}): ${n.gedaechtnis.map((g) => g.text).join(' | ')}`);
  return L.join('\n');
}
function umsetzungVoll(m, s) {
  const mol = KAT.molekuele[m.id]; const u = mol.umsetzungen.find((x) => x.id === m.umsetzung);
  const L = [`### ${mol.id} / ${u.id} – ${u.name}`, u.beschreibung, 'Parameter (* = Pflicht):'];
  for (const [n, d] of Object.entries(u.params)) {
    let hint = '';
    if (d.typ === 'loc') hint = ` → Ort der Szene: ${s.ort}`;
    if (d.typ === 'npc') hint = ` → eine von: ${NPC.join(', ')}`;
    if (d.typ === 'find') hint = ` → Funde an ${s.ort}: ${(LOC[s.ort] ? LOC[s.ort].hidden.map((h) => h.id) : []).join(', ') || '–'}`;
    L.push(`- ${n}${d.pflicht ? '*' : ''} (${d.typ}${d.werte ? ': ' + d.werte.join('|') : ''}${d.min != null ? `, ${d.min}–${d.max}` : ''}${d.default !== undefined ? ', Standard ' + JSON.stringify(d.default) : ''})${d.beschreibung ? ' – ' + d.beschreibung : ''}${hint}`);
  }
  return L.join('\n');
}
function prompt(g, s) {
  const plan = Object.assign({}, g, { szenen: g.szenen.map((x) => ({ id: x.id, ort: x.ort, molekuele: x.molekuele.map((m) => m.umsetzung), sachverhalt: x.sachverhalt, weiter: x.weiter })) });
  return `<weltstand>\n${weltstandKurz()}\n</weltstand>\n\n<grobplan>\n${JSON.stringify(plan)}\n</grobplan>\n\n<szene>\n${JSON.stringify(s, null, 1)}\n</szene>\n\n<umsetzungen>\n${s.molekuele.map((m) => umsetzungVoll(m, s)).join('\n\n')}\n</umsetzungen>\n\nArbeite jetzt die Szene '${s.id}' aus. Nur das JSON-Objekt.`;
}

// ---------- Zusammensetzen ----------
const ziel = (n) => (n.startsWith('ausgang:') ? { complete: n.slice(8) } : { goto: n });
function baueSzene(g, s, a) {
  const E = []; const steps = []; const texte = {}; const buehne = { orte: [] }; const besetzung = { npc: [] };
  const mols = a.molekuele || [];
  if (mols.length !== s.molekuele.length) E.push(`${mols.length} Moleküle statt ${s.molekuele.length} wie im Grobplan`);
  mols.forEach((m, i) => {
    const soll = s.molekuele[i] || {};
    if (m.id !== soll.id || m.umsetzung !== soll.umsetzung) E.push(`Molekül ${i + 1}: ${m.id}/${m.umsetzung} statt ${soll.id}/${soll.umsetzung}`);
    const mol = KAT.molekuele[m.id]; const u = mol && mol.umsetzungen.find((x) => x.id === m.umsetzung);
    if (!u) return;
    // mehrere Moleküle: Kette, das letzte führt zum Folgeschritt
    const id = mols.length > 1 ? `${s.id}_${i + 1}` : s.id;
    const weiter = i < mols.length - 1 ? `${s.id}_${i + 2}` : '__weiter__';
    const { frag, errs } = Katalog.instantiate(u, m.params || {}, id, weiter);
    E.push(...errs.map((e) => `${m.id}/${m.umsetzung}: ${e}`));
    steps.push(...frag.steps); Object.assign(texte, frag.texte);
    for (const [k, v] of Object.entries(frag.buehne || {})) buehne[k] = Array.isArray(v) ? [...new Set([...(buehne[k] || []), ...v])] : Object.assign(buehne[k] || {}, v);
    for (const [k, v] of Object.entries(frag.besetzung || {})) besetzung[k] = Array.isArray(v) ? [...new Set([...(besetzung[k] || []), ...v])] : Object.assign(besetzung[k] || {}, v);
  });
  // Wendung aus dem Grobplan: generisch als Timer am ersten Schritt der Szene (nicht Sache der Vorlagen)
  const w = a.wendung;
  if (s.wendung && !w) E.push(`Der Grobplan sieht eine Wendung vor („${s.wendung}“), die Antwort hat keine`);
  if (w && steps[0]) {
    if (!w.kennung || !w.ankuendigung || !Array.isArray(w.wirkung) || !w.wirkung.length) E.push("Wendung braucht 'kennung', 'ankuendigung' und eine nicht leere 'wirkung'");
    const at = Number(w.nach_s);
    if (!(at >= 20 && at <= 120)) E.push(`Wendung: nach_s = ${w.nach_s}, erlaubt 20–120`);
    const erlaubt = ['setFlag', 'reward', 'radio', 'oda', 'log'];
    for (const x of w.wirkung || []) if (!(x.do === 'pay_marks' || (Object.keys(x).length === 1 && erlaubt.includes(Object.keys(x)[0])))) E.push(`Wendung: Aktion ${JSON.stringify(x)} ist nicht erlaubt`);
    (steps[0].timers = steps[0].timers || []).push({ at: at || 30, do: [{ wendung: `${s.id.split('_')[0]}_${w.kennung}`.slice(0, 40), ankuendigung: { oda: w.ankuendigung, art: 'gleichzeitig' }, wirkung: w.wirkung || [] }] });
  }
  // Literaltexte aus den Parametern (Funk, ODA, Log in Aktionslisten) nach 'texte' auslagern – Aufgabe des Rahmens, nicht des LLM
  let nr = 0;
  const auslagern = (node) => {
    if (Array.isArray(node)) return node.forEach(auslagern);
    if (!node || typeof node !== 'object') return;
    for (const k of ['oda', 'log']) if (typeof node[k] === 'string' && !node[k].startsWith('@')) { const key = `${s.id}.t${++nr}`; texte[key] = node[k]; node[k] = '@' + key; }
    if (node.radio && typeof node.radio.text === 'string' && !node.radio.text.startsWith('@')) { const key = `${s.id}.t${++nr}`; texte[key] = node.radio.text; node.radio.text = '@' + key; }
    for (const v of Object.values(node)) auslagern(v);
  };
  auslagern(steps);
  // NSC, die funken, gehören zur Besetzung
  for (const x of JSON.stringify(steps).match(/"radio":{"from":"([^"]+)"/g) || []) { const n = x.slice(17, -1); if (!besetzung.npc.includes(n)) besetzung.npc.push(n); }
  // setFlag: Schlüssel = Flag-Name, Wert true/Zahl (der Prüfer prüft die Form heute nicht)
  for (const x of JSON.stringify(steps).match(/"setFlag":\{[^}]*\}/g) || []) for (const [k, v] of Object.entries(JSON.parse(x.slice(10)))) if (typeof v === 'string' || k === 'name') E.push(`setFlag {"${k}": ${JSON.stringify(v)}}: der Schlüssel ist der Flag-Name, der Wert true – richtig wäre {"${typeof v === 'string' ? v : k}": true}`);
  // Verzweigung: Ziele aus dem Grobplan, Bedingungen vom LLM; der letzte Eintrag ist der Standardweg
  const soll = s.weiter.map((w) => w.nach);
  let zweige = (a.verzweigung || []).filter((z) => z && z.nach);
  if (soll.length === 1) zweige = [{ nach: soll[0] }];
  else {
    if (zweige.length < 2) E.push(`Szene verzweigt im Grobplan nach ${soll.join(', ')}, aber 'verzweigung' hat ${zweige.length} Einträge`);
    for (const z of zweige) if (!soll.includes(z.nach)) E.push(`Verzweigung nach '${z.nach}', im Grobplan nicht vorgesehen`);
    for (const n of soll) if (!zweige.some((z) => z.nach === n)) E.push(`Verzweigung: Ziel '${n}' aus dem Grobplan wird nie erreicht`);
    const gesetzt = new Set(JSON.stringify(mols).match(/"setFlag":\{[^}]*\}/g) || []);
    const gesetzteFlags = new Set([...gesetzt].flatMap((x) => Object.keys(JSON.parse(x.slice(10)))));
    for (const z of zweige) for (const f of (JSON.stringify(z.if || {}).match(/"flag":"([^"]+)"/g) || []).map((x) => x.slice(8, -1))) if (!gesetzteFlags.has(f)) E.push(`Verzweigung prüft Flag '${f}', das keine Folge setzt`);
  }
  for (const st of steps) {
    if (!st.next) continue;
    st.next = st.next.flatMap((n) => {
      if (n.goto !== '__weiter__') return [n];
      const { goto, ...rest } = n;
      return zweige.map((z, i) => Object.assign({}, rest, { if: i < zweige.length - 1 && z.if ? { all: [n.if, z.if] } : n.if }, ziel(z.nach)));
    });
  }
  return { steps, texte, buehne, besetzung, fehler: E };
}
// Prüf-Regiebuch: Hafen-Platzhalter davor (nimmt an, springt), Folgeszenen als Platzhalter, echte Ausgänge aus dem Grobplan
function pruefRegiebuch(g, s, sz) {
  const vorher = { id: 'start', objectives: [], next: [{ if: true, goto: sz.steps[0] ? sz.steps[0].id : s.id }], skip: [] };
  const ziele = [...new Set(s.weiter.map((w) => w.nach))];
  const platzhalter = ziele.filter((n) => !n.startsWith('ausgang:')).map((n) => ({ id: n, objectives: [], next: [{ if: true, complete: 'platzhalter' }], skip: [] }));
  const ausgaenge = { platzhalter: { beschreibung: 'Rest der Mission (noch nicht ausgearbeitet)', folgen: [{ chronik: '@test.text' }] } };
  for (const n of ziele.filter((x) => x.startsWith('ausgang:'))) ausgaenge[n.slice(8)] = { beschreibung: (g.ausgaenge[n.slice(8)] || {}).wann || n, folgen: [{ chronik: '@test.text' }] };
  return {
    format: 'regiebuch/1', id: `${g.id}_${s.id}`.slice(0, 40),
    kopf: { titel: g.titel.slice(0, 60), art: 'mission', auftraggeber: g.auftraggeber, zielspieldauer_min: g.zielspieldauer_min },
    buch: { von: [{ npc: g.auftraggeber }], briefing: '@test.text', belohnung: '@test.text' },
    buehne: Object.assign({}, sz.buehne, { orte: [...new Set(['hafen', ...(sz.buehne.orte || [])])] }),
    besetzung: Object.assign({}, sz.besetzung, { npc: [...new Set([g.auftraggeber, ...(sz.besetzung.npc || [])])] }),
    steps: [vorher, ...sz.steps, ...platzhalter], on: {}, ausgaenge,
    texte: Object.assign({ 'test.text': 'Platzhalter' }, sz.texte),
  };
}

// ---------- Ablauf ----------
async function run(gid, sid) {
  const g = JSON.parse(fs.readFileSync(path.join(OUT, `${gid}.grobplan.json`), 'utf8'));
  const s = g.szenen.find((x) => x.id === sid);
  if (!s) throw new Error(`Szene '${sid}' gibt es im Grobplan '${gid}' nicht (${g.szenen.map((x) => x.id).join(', ')})`);
  if (!s.molekuele.length) throw new Error(`Szene '${sid}' hat keine Moleküle (Hafen-Szenen setzt der Rahmen)`);
  const base = prompt(g, s); const sys = path.join(DIR, 'szene-spielleiter.md');
  const messung = []; let raw = ''; let errs = []; let doc = null; let a = null;
  for (let v = 1; v <= 2; v++) {
    const input = v === 1 ? base : `${base}\n\n<deine_antwort>\n${raw}\n</deine_antwort>\n\n<pruefer>\n${errs.map((e) => '- ' + e).join('\n')}\n</pruefer>\nKorrigiere die Fehler. Nur das JSON-Objekt.`;
    console.log(`${gid}/${sid} v${v} (${MODEL}, Eingabe ${input.length} Zeichen):`);
    const c = await callClaude(input, sys); raw = c.text;
    const t1 = Date.now();
    try {
      a = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      const sz = baueSzene(g, s, a); doc = pruefRegiebuch(g, s, sz);
      const r = check(doc);
      errs = sz.fehler.concat(r.errors.map((e) => `${e.code} ${e.p}: ${e.msg}`));
      c.warn = r.warnings.map((w) => `${w.code} ${w.p}: ${w.msg}`);
    } catch (e) { errs = ['kein gültiges JSON: ' + e.message]; c.warn = []; }
    c.pruefMs = Date.now() - t1;
    messung.push({ v, sec: c.sec, first: c.first, out: c.out, inp: c.inp, cost: c.cost, modelId: c.modelId, fehler: errs.length, warn: c.warn.length });
    console.log(`  ${c.sec.toFixed(1)} s (erstes Token ${c.first ? c.first.toFixed(1) : '–'} s, ${c.out} Tokens aus, ${c.inp} ein, $${(c.cost || 0).toFixed(4)}, ${c.modelId}), Zusammensetzen+Prüfen ${c.pruefMs} ms`);
    console.log(`  ${errs.length} Fehler${errs.length ? ':\n    - ' + errs.join('\n    - ') : ''}${c.warn.length ? `\n  ${c.warn.length} Warnungen:\n    - ${c.warn.join('\n    - ')}` : ''}`);
    if (!errs.length) break;
  }
  const tag = `${gid}.${sid}.${MODEL}`;
  if (a) fs.writeFileSync(path.join(OUT, `${tag}.antwort.json`), JSON.stringify(a, null, 2));
  if (doc) fs.writeFileSync(path.join(OUT, `${tag}.regiebuch.json`), JSON.stringify(doc, null, 2));
  const mf = path.join(OUT, 'szene-messung.md');
  if (!fs.existsSync(mf)) fs.writeFileSync(mf, '# Messung Szene ausarbeiten (Stufe 2)\n\nMAX_THINKING_TOKENS=0. Dauer = gesamter claude-Aufruf inkl. Start der CLI.\n\n| Zeit | Szene | Modell | Versuch | Dauer | erstes Token | Tokens aus | Tokens ein | Kosten | Fehler | Warnungen |\n|---|---|---|---|---|---|---|---|---|---|---|\n');
  for (const m of messung) fs.appendFileSync(mf, `| ${new Date().toISOString().slice(0, 16)} | ${gid}/${sid} | ${m.modelId || MODEL} | v${m.v} | ${m.sec.toFixed(1)} s | ${m.first ? m.first.toFixed(1) + ' s' : '–'} | ${m.out} | ${m.inp} | $${(m.cost || 0).toFixed(4)} | ${m.fehler} | ${m.warn} |\n`);
  console.log(`${errs.length ? '✗' : '✓'} ${tag}: ${errs.length ? 'ungültig' : 'gültig'} → out/${tag}.regiebuch.json`);
  return !errs.length;
}

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  if (KAT.fehler.length) { console.log('Katalog fehlerhaft – erst `node tools/katalog.js` reparieren.'); process.exit(1); }
  if (args.includes('--mini')) {
    // Mini-Aufruf: prüft CLI, Modell und Stream, bevor ein langer Lauf startet
    fs.writeFileSync(path.join(OUT, 'mini-system.md'), 'Antworte knapp.');
    callClaude('Antworte nur mit: {"ok": true}', path.join(OUT, 'mini-system.md')).then((c) => { console.log(`Mini (${MODEL} = ${c.modelId}): ${c.sec.toFixed(1)} s, erstes Token ${c.first && c.first.toFixed(1)} s, Antwort ${c.text.trim()}`); }, (e) => { console.log(e.message); process.exit(1); });
  } else {
    const [gid, sid] = args.filter((x, i) => !x.startsWith('--') && args[i - 1] !== '--model');
    run(gid, sid).then((ok) => process.exit(ok ? 0 : 1), (e) => { console.log(e.message); process.exit(1); });
  }
}
