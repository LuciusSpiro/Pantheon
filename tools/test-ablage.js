'use strict';
// Tests der Missions-Ablage (CONTRACT-S2 §8c) – npm run test:ablage, Teil von npm test. Ohne LLM (script-Modus), schreibt
// nur in ein temporäres Verzeichnis (nie nach content/spielleiter/erzeugt).
//   1 Ablage aus der Umgebung (fromEnv)          5 Archiv-Lader: angenommen ja, offen/abgelehnt nein, Dubletten
//   2 Pipeline: Angebot → Szene ersetzt → Ende   6 Angenommene Mission ist spielbar (Prüfer grün)
//   3 Status/Notizen bleiben beim Neuschreiben   7 Werkzeug missionen (liste/zeigen/annehmen/ablehnen/md)
//   4 Mock-Filter, Fehler zählen statt werfen    8 Archiv-Textfassung, Repo bleibt sauber

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const Ablage = require('../server/mission/ablage.js');
const Archiv = require('../server/mission/archiv.js');
const Spielleiter = require('../server/mission/spielleiter.js');
const SB = require('../server/mission/szenenbau.js');
const LLM = require('../server/mission/llm.js');
const Context = require('../server/mission/context.js');
const KatalogSrv = require('../server/mission/katalog.js');
const T = require('./test-spielleiter.js');

const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const flush = () => new Promise((r) => setImmediate(r));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-ablage-'));
const tmp = (n) => { const d = path.join(TMP, n); fs.mkdirSync(d, { recursive: true }); return d; };
const read = (f) => fs.readFileSync(f, 'utf8');
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const REPO_ERZEUGT = path.join(ROOT, 'content', 'spielleiter', 'erzeugt');
const repoBefore = (() => { try { return fs.readdirSync(REPO_ERZEUGT).sort().join(','); } catch (e) { return ''; } })();

async function ticks(sl, g, sec, dt, until) {
  const step = dt || 0.25;
  for (let t = 0; t < sec; t += step) { g.time += step; sl.update(step); await flush(); if (until && until()) return true; }
  return until ? !!until() : true;
}
// alle @-Verweise eines Buchs (Schritte, Ausgänge, Rahmen)
function refs(node, out) {
  if (Array.isArray(node)) { node.forEach((x) => refs(x, out)); return out; }
  if (node && typeof node === 'object') { for (const v of Object.values(node)) refs(v, out); return out; }
  if (typeof node === 'string' && node[0] === '@') out.add(node.slice(1));
  return out;
}

async function main() {
  const katalog = KatalogSrv.load({});
  const world = JSON.parse(read(path.join(__dirname, 'fixtures', 'context', 'nach-tutorial.weltstand.json')));
  const ctx = Context.build(world, T.ANLASS['nach-tutorial'], katalog);

  // ---------- 1. fromEnv ----------
  {
    const a = Ablage.fromEnv({}, {}); const b = Ablage.fromEnv({}, { live: true }); const c = Ablage.fromEnv({ ERZEUGT_DIR: TMP }, {});
    const d = Ablage.fromEnv({ ERZEUGT_MOCK: '1' }, {});
    check('1 fromEnv: ohne Schalter keine Ablage, live/ERZEUGT_MOCK ins Repo, ERZEUGT_DIR lenkt um',
      a === null && b && b.dir === Ablage.DIR && !b.mock && c && c.dir === TMP && d && d.mock && d.dir === Ablage.DIR, `a=${a} b=${b && b.dir} c=${c && c.dir} d=${d && d.dir}/${d && d.mock}`);
    const F = T.fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: {} }), kontext: () => ctx, archiv: [], regieDir: tmp('regie0'), memoryLog: true, katalog });
    check('1 Spielleiter in Tests (script, ohne ERZEUGT_DIR) legt nichts ab', sl.ablage() === null, String(sl.ablage()));
  }

  // ---------- 2./3. Pipeline ----------
  const ED = tmp('erzeugt');
  let folderSl = null;
  {
    LLM.resetBudget();
    const ab = Ablage.create({ dir: ED, onError: (e) => console.log('  Ablage-Fehler: ' + e.message) });
    const F = T.fakeGame();
    const AR = Archiv.load(undefined, { erzeugtDir: null });
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: {} }), kontext: () => ctx, archiv: AR.entries, regieDir: tmp('regie1'), memoryLog: true, katalog, ablage: ab });
    sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
    await ticks(sl, F.g, 10, 0.25, () => sl.offers().length >= 3);
    await ab.flush();
    const rows = Ablage.list(ED);
    const offersSl = sl.offers().filter((o) => o.origin === 'sl');
    check('2 Angebot registriert: je Spielleiter-Angebot ein Ordner (Archiv-Angebot nicht)', rows.length === offersSl.length && offersSl.length === 2 && rows.every((r) => r.status === 'offen' && /^\d{4}-\d{2}-\d{2}_sl_/.test(r.ordner)),
      rows.map((r) => `${r.ordner}[${r.status}]`).join(', '));
    const o = offersSl[0];
    const plan = sl.planById(o.id);
    folderSl = rows.find((r) => r.titel === plan.book.kopf.titel).ordner;
    const dir = path.join(ED, folderSl);
    const rec0 = JSON.parse(read(path.join(dir, 'mission.json')));
    const lo = Archiv.load(tmp('leer'), { erzeugtDir: null });
    check('2 mission.json im Archiv-Format (llm-aufzeichnung/1, grobplan, szenen, regiebuch, Metadaten)',
      rec0.format === 'llm-aufzeichnung/1' && rec0.grobplan && rec0.regiebuch && rec0.regiebuch.id === o.id && rec0.quelle === 'llm' && rec0.meta && rec0.meta.welt === 'w-test' && rec0.meta.pruefer && Array.isArray(rec0.meta.pruefer.fehler) && rec0.erstellt && !lo.errors.length,
      `quelle ${rec0.quelle}, meta ${JSON.stringify(Object.keys(rec0.meta || {}))}`);
    // accept -> Szene ersetzt
    sl.accept(o.id);
    await ticks(sl, F.g, 5, 0.25, () => F.m.updates.length >= 1);
    await ab.flush();
    const s2 = plan.grobplan.szenen[1].id;
    const rec1 = JSON.parse(read(path.join(dir, 'mission.json')));
    check('2 Szene ersetzt: derselbe Ordner, Stand = zuletzt gültiges Buch', Ablage.list(ED).length === 2 && rec1.meta.szenen_quelle[s2] === 'llm' && rec1.szenen[s2] && rec1.meta.aktualisierungen >= 1 && JSON.stringify(rec1.regiebuch) === JSON.stringify(plan.book),
      `Szenen ${JSON.stringify(rec1.meta.szenen_quelle)}, Aktualisierungen ${rec1.meta.aktualisierungen}`);
    // md: alle Texte
    const md1 = read(path.join(dir, 'mission.md'));
    const keys = [...refs([plan.book.steps, plan.book.ausgaenge, plan.book.buch, plan.book.on], new Set())];
    const missing = keys.filter((k) => typeof plan.book.texte[k] === 'string' && !norm(md1).includes(norm(plan.book.texte[k])));
    const g = plan.grobplan;
    const parts = ['status: offen', 'quelle: llm', 'erstellt:', `auftraggeber: ${g.auftraggeber}`, `# ${plan.book.kopf.titel}`, '## Pitch', '## Erinnerung', '| Zieldauer |', '| Belohnung |',
      '## Szenen', '**Texte in Reihenfolge**', '**Funk – ', '## Ausgänge', '## Prüfer', '## Gespielt', 'Noch nicht gespielt.', '## Notizen'];
    const fehlt = parts.filter((p) => !md1.includes(p));
    for (const s of g.szenen) if (!md1.includes(`– `) || !md1.includes(s.id)) fehlt.push('Szene ' + s.id);
    for (const s of g.szenen) for (const m of s.molekuele || []) if (!md1.includes(`\`${m.id}/${m.umsetzung}\``)) fehlt.push('Baustein ' + m.umsetzung);
    for (const aid of Object.keys(g.ausgaenge || {})) if (!md1.includes(`### ${aid}`)) fehlt.push('Ausgang ' + aid);
    check('2 mission.md: Frontmatter, Steckbrief, Szenen mit Ort/Baustein/Ziele, alle Texte (@ aufgelöst), Ausgänge, Prüfer, Gespielt',
      !missing.length && !fehlt.length && !/@[a-z0-9_]+\.[a-z0-9_.]+/.test(md1.split('## Ausgänge')[0].replace(/`[^`]*`/g, '')),
      `${keys.length} Texte; fehlen: ${missing.slice(0, 5).join(', ') || '–'}; Abschnitte fehlen: ${fehlt.join(', ') || '–'}`);
    // Kai setzt Status + Notiz von Hand (CRLF wie aus einem Windows-Editor)
    const kai = md1.replace('status: offen', 'status: angenommen').replace(/## Notizen\n\n[^\n]*/, '## Notizen\n\nKai: Funk von Grauzahn kürzen.\nZweite Zeile.').replace(/\n/g, '\r\n');
    fs.writeFileSync(path.join(dir, 'mission.md'), kai, 'utf8');
    F.m.activeId = null; F.m.step = null; F.g.time += 30;
    sl.onMissionDone({ id: o.id, ausgang: 'erfolg' });
    await ab.flush();
    const md2 = read(path.join(dir, 'mission.md'));
    const rec2 = JSON.parse(read(path.join(dir, 'mission.json')));
    check('2 Missionsende: Abschnitt „Gespielt“ mit Datum, Ausgang, Dauer, Crew', rec2.gespielt.length === 1 && rec2.gespielt[0].ausgang === 'erfolg' && rec2.gespielt[0].crew === 3 && rec2.gespielt[0].dauer_s > 0
      && /\| Datum \| Ausgang \| Dauer \| Crew \|/.test(md2) && /\| erfolg \| \d+:\d\d \| 3 \|/.test(md2), JSON.stringify(rec2.gespielt));
    check('3 Neuschreiben: von Kai gesetzter Status und Notizen bleiben erhalten', Archiv.mdStatus(md2) === 'angenommen' && md2.includes('Kai: Funk von Grauzahn kürzen.\nZweite Zeile.') && !md2.includes('Platz für Anmerkungen'),
      `Status ${Archiv.mdStatus(md2)}`);
    const r3 = Ablage.rewrite(ED, folderSl);
    check('3 md neu erzeugen (rewrite) behält Status und Notizen', r3.ok && Archiv.mdStatus(read(path.join(dir, 'mission.md'))) === 'angenommen' && read(path.join(dir, 'mission.md')) === md2, JSON.stringify(r3));
    // Determinismus
    const e = JSON.parse(read(path.join(dir, 'mission.json')));
    const m1 = Ablage.renderMarkdown(e, { status: 'offen' }); const m2 = Ablage.renderMarkdown(JSON.parse(JSON.stringify(e)), { status: 'offen' });
    const eBefore = JSON.stringify(e);
    check('3 renderMarkdown ist rein und deterministisch', m1 === m2 && m1 === Ablage.renderMarkdown(e, { status: 'offen' }) && JSON.stringify(e) === eBefore && Archiv.mdStatus(m1) === 'offen', `${m1.length} Zeichen`);
    check('2 Pipeline ohne gezählte Fehler, Ablage ohne Fehler', !F.errors.length && ab.errors === 0 && ab.written >= 4, `Fehler ${F.errors.join(' | ') || '–'}; Ablage geschrieben ${ab.written}, Fehler ${ab.errors}`);
  }

  // ---------- 4. Mock-Filter, Fehler ----------
  {
    const src = JSON.parse(read(path.join(ED, folderSl, 'mission.json')));
    const arg = { book: src.regiebuch, grobplan: src.grobplan, szenen: src.szenen, meta: { welt: 'w-mock', quelle: 'mock' } };
    const d1 = tmp('mock-aus'); const d2 = tmp('mock-an');
    const a1 = Ablage.create({ dir: d1 }); const a2 = Ablage.create({ dir: d2, mock: true });
    const r1 = a1.saveBook(arg); const r2 = a2.saveBook(arg);
    await a1.flush(); await a2.flush();
    check('4 Mock-Bücher nur mit mock (ERZEUGT_MOCK=1)', r1 === false && fs.readdirSync(d1).length === 0 && r2 === true && Ablage.list(d2).length === 1 && Ablage.list(d2)[0].quelle === 'mock', `ohne ${fs.readdirSync(d1).length}, mit ${Ablage.list(d2).length}`);
    const file = path.join(TMP, 'keinordner.txt'); fs.writeFileSync(file, 'x');
    let thrown = null; const errs = [];
    const a3 = Ablage.create({ dir: file, onError: (e) => errs.push(e.message) });
    try { a3.saveBook(Object.assign({}, arg, { meta: { quelle: 'llm' } })); a3.recordPlay({ id: 'x' }); a3.saveBook(null); await a3.flush(); } catch (e) { thrown = e; }
    check('4 Schreibfehler werden gezählt, nie geworfen', !thrown && a3.errors >= 2 && errs.length === a3.errors, `Fehler ${a3.errors}: ${errs.slice(0, 2).join(' | ')}`);
    // nicht im Tick: saveBook schreibt erst in setImmediate
    const d4 = tmp('async'); const a4 = Ablage.create({ dir: d4 });
    a4.saveBook(Object.assign({}, arg, { meta: { quelle: 'llm' } }));
    const sync = fs.readdirSync(d4).length;
    await a4.flush();
    check('4 Schreiben außerhalb des Ticks (setImmediate), atomar ohne Reste', sync === 0 && Ablage.list(d4).length === 1 && !fs.readdirSync(path.join(d4, Ablage.list(d4)[0].ordner)).some((f) => f.endsWith('.tmp')), `synchron ${sync}`);
  }

  // ---------- 5./6. Archiv-Lader und Spielbarkeit ----------
  {
    const EV = tmp('vorrat');
    const src = path.join(ED, folderSl);
    const cpDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f)); };
    cpDir(src, path.join(EV, '2026-10-08_angenommen'));
    // weitere Missionen: offen, abgelehnt (andere Ordner aus der Pipeline), Dublette der angenommenen
    const other = Ablage.list(ED).find((r) => r.ordner !== folderSl).ordner;
    cpDir(path.join(ED, other), path.join(EV, '2026-10-08_offen'));
    Ablage.setStatus(EV, '2026-10-08_offen', 'offen');
    cpDir(path.join(ED, other), path.join(EV, '2026-10-08_abgelehnt'));
    Ablage.setStatus(EV, '2026-10-08_abgelehnt', 'abgelehnt');
    cpDir(src, path.join(EV, '2026-10-09_dublette'));
    const r = Archiv.load(undefined, { erzeugtDir: EV });
    const er = r.entries.filter((e) => e.erzeugt);
    const base = Archiv.load(undefined, { erzeugtDir: null }).entries.length;
    check('5 Archiv-Lader: angenommene Mission im Vorrat, offene/abgelehnte nicht, Dublette übersprungen',
      er.length === 1 && er[0].name === '2026-10-08_angenommen' && r.entries.length === base + 1 && r.errors.some((x) => /doppelte Kennung/.test(x.msg)) && r.errors.length === 1,
      `${r.entries.length} Einträge (${er.map((x) => x.name).join(', ')}), Fehler ${r.errors.map((x) => x.file + ': ' + x.msg).join(' | ')}`);
    const r2 = Archiv.load(tmp('nur-eigenes-archiv'));
    check('5 Lader mit eigenem Archiv-Verzeichnis lädt keine Ablage (Tests sehen Kais Freigaben nicht)', r2.entries.length === 0, `${r2.entries.length}`);
    // spielbar: Archiv-Pipeline des Spielleiters baut das Buch, Prüfer grün
    const F = T.fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'off' }), kontext: () => ctx, archiv: er, regieDir: tmp('regie5'), memoryLog: true, katalog });
    const plan = sl.newPlan('archiv', { art: 'test' });
    const okPlan = sl.planFromArchive(plan, 'Test Ablage');
    const chk = okPlan ? SB.checkBook(plan.book) : { errors: ['kein Buch'] };
    const recBook = JSON.parse(read(path.join(EV, '2026-10-08_angenommen', 'mission.json'))).regiebuch;
    const chk2 = SB.checkBook(recBook);
    check('6 angenommene Mission ist spielbar: Archiv-Angebot, Buch besteht den Prüfer', okPlan && plan.state === 'offered' && plan.archivName === '2026-10-08_angenommen' && !chk.errors.length && !chk2.errors.length && F.m.books[plan.id] && !F.errors.length,
      `Plan ${plan.id} ${plan.state}; Prüfer ${chk.errors.length}/${chk2.errors.length} Fehler; ${F.errors.join(' | ') || '–'}`);
    // Skip-Durchlauf mit der echten Engine (falls verfügbar)
    let skipInfo = 'Engine nicht geprüft';
    try {
      const Game = require('../server/game.js');
      const G = Game.Game || Game;
      const wd = tmp('worlds6');
      const game = new G({ noStore: true, worlds: true, worldSaveSync: true, worldDir: wd, seed: 7, debug: false, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: tmp('regie6'), WORLD_DIR: wd }, log: () => {} });
      const m = game.mission;
      if (m && typeof m.registerBook === 'function') {
        const reg = m.registerBook(JSON.parse(JSON.stringify(plan.book)), { origin: 'archiv' });
        skipInfo = `registerBook ${reg && reg.ok === false ? 'abgelehnt: ' + JSON.stringify((reg.errors || []).slice(0, 2)) : 'ok'}`;
        check('6 echte Engine nimmt das Buch an (registerBook)', !(reg && reg.ok === false), skipInfo);
      }
      if (typeof game.dispose === 'function') try { game.dispose(); } catch (e) { /* egal */ }
    } catch (e) { check('6 echte Engine nimmt das Buch an (registerBook)', false, 'Ausnahme: ' + e.message); }
  }

  // ---------- 7. Werkzeug ----------
  {
    const EW = tmp('werkzeug');
    const cpDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f)); };
    cpDir(path.join(ED, folderSl), path.join(EW, '2026-10-08_sl_9_probe'));
    Ablage.setStatus(EW, '2026-10-08_sl_9_probe', 'offen');
    const run = (...a) => cp.spawnSync(process.execPath, [path.join(__dirname, 'missionen.js'), ...a, '--dir', EW], { encoding: 'utf8' });
    const l1 = run('liste');
    const an = run('annehmen', 'sl_9_probe');
    const st1 = Archiv.mdStatus(read(path.join(EW, '2026-10-08_sl_9_probe', 'mission.md')));
    const l2 = run('liste');
    const ab = run('ablehnen', 'sl_9');
    const st2 = Archiv.mdStatus(read(path.join(EW, '2026-10-08_sl_9_probe', 'mission.md')));
    const ze = run('zeigen', 'probe');
    fs.unlinkSync(path.join(EW, '2026-10-08_sl_9_probe', 'mission.md'));
    const mdAll = run('md', '--alle');
    const nach = fs.existsSync(path.join(EW, '2026-10-08_sl_9_probe', 'mission.md'));
    const bad = run('annehmen', 'gibtesnicht');
    check('7 missionen liste/annehmen/ablehnen/zeigen/md', l1.status === 0 && /offen\s+2026-10-08_sl_9_probe/.test(l1.stdout) && an.status === 0 && st1 === 'angenommen' && /angenommen\s+2026-10-08_sl_9_probe/.test(l2.stdout)
      && ab.status === 0 && st2 === 'abgelehnt' && ze.status === 0 && /## Gespielt/.test(ze.stdout) && mdAll.status === 0 && nach && bad.status === 1,
      `liste ${l1.status}, annehmen ${an.status}/${st1}, ablehnen ${ab.status}/${st2}, zeigen ${ze.status}, md ${mdAll.status}/${nach}, unbekannt ${bad.status}${l1.stderr ? ' | ' + l1.stderr.slice(0, 200) : ''}`);
  }

  // ---------- 8. Archiv-Textfassung, Repo sauber ----------
  {
    const AD = tmp('archiv');
    for (const f of fs.readdirSync(Archiv.DIR).filter((x) => x.endsWith('.json'))) fs.copyFileSync(path.join(Archiv.DIR, f), path.join(AD, f));
    const res = Ablage.writeArchivMarkdown(AD);
    const mds = fs.readdirSync(AD).filter((f) => f.endsWith('.md'));
    const zf = mds.length ? read(path.join(AD, mds[0])) : '';
    check('8 Archiv-Textfassung: je Archiv-Mission eine md (status angenommen, quelle archiv, ohne Prüferfehler)',
      res.length >= 4 && res.every((x) => x.ok && !x.fehler) && mds.length === res.length && Archiv.mdStatus(zf) === 'angenommen' && /quelle: archiv/.test(zf),
      res.map((x) => `${x.name}:${x.ok ? 'ok' : x.error}`).join(', '));
    const f0 = path.join(AD, mds[0]);
    fs.writeFileSync(f0, read(f0).replace('status: angenommen', 'status: abgelehnt'));
    Ablage.writeArchivMarkdown(AD);
    check('8 Archiv-Textfassung neu: Status bleibt', Archiv.mdStatus(read(f0)) === 'abgelehnt', Archiv.mdStatus(read(f0)));
    const repoMd = fs.readdirSync(Archiv.DIR).filter((f) => f.endsWith('.md')).length;
    const repoJson = fs.readdirSync(Archiv.DIR).filter((f) => f.endsWith('.json')).length;
    check('8 Repo: Archiv-Textfassungen liegen neben den JSON-Dateien', repoMd === repoJson, `${repoMd} md / ${repoJson} json`);
    const repoAfter = (() => { try { return fs.readdirSync(REPO_ERZEUGT).sort().join(','); } catch (e) { return ''; } })();
    check('8 Repo: Tests haben nichts nach content/spielleiter/erzeugt geschrieben', repoAfter === repoBefore, `vorher [${repoBefore}] nachher [${repoAfter}]`);
  }
}

main().catch((e) => { results.push({ name: 'Ausnahme', ok: false, detail: e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e) }); }).finally(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  let bad = 0;
  for (const r of results) { if (!r.ok) bad++; console.log(`${r.ok ? '✓' : '✗'} ${r.name}${!r.ok || process.argv.includes('--verbose') ? '  – ' + r.detail : ''}`); }
  console.log(`test-ablage: ${results.length - bad}/${results.length} grün`);
  process.exit(bad ? 1 : 0);
});
