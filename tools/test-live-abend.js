'use strict';
// LIV-01 D: Test des Live-Laeufers tools/live-abend.js (npm run test:live-abend). Offline: Mock-Spielleiter bzw. die Fake-CLI tools/fixtures/messe/fake-claude.js (kein Netz, kein Abo, nie der echte Claude).
// Ablage nur in ein mkdtemp-Verzeichnis, nie im Repo. Geprueft:
//   A  Mock-Spielleiter, zwei Seeds: Laeufer startet, nimmt Angebote an, spielt Abenteuer zu Ende, index.md mit funktionierenden relativen Links auf mission.md, messung.json, keine Spielernamen
//   B  Live-Pfad mit Fake-CLI (Plan Gerücht): echte Spruenge, Plan Claude -> Aufnahme (Prompt + Rohantwort) -> Angebot -> Abenteuer -> mission.md, Tokens und Kosten aus dem Zaehler
//   C  Kontingent (kleines Limit, Fake mit hohem usage): Schwelle erreicht, Funkmeldung, der Abend laeuft im Rueckfall weiter, Index zeigt es; mit --freigeben der Knopfweg (Captain, Limit +500 000)
//   D  --live ohne LLM_LIVE=1: "nicht gemessen", Exit 0, nichts angelegt, die CLI wird nie aufgerufen      E  falsche Aufrufe: Exit 2, nichts angelegt (auch --out im Repo)
//   F  nichts im Repo (git status, data/), Fremddatei und fruehere Laeufe in --out unberuehrt, nichts geloescht
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(__dirname, 'live-abend.js');
const FAKE = path.join(__dirname, 'fixtures', 'messe', 'fake-claude.js');
const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-live-abend-'));
const env = { ...process.env };
for (const k of ['LLM_LIVE', 'REGIE_DIR', 'MITSCHNITT', 'MITSCHNITT_DIR', 'CLAUDE_TOKEN_BUDGET', 'SPIELLEITER_LLM', 'CLAUDE_CLI', 'FAKE_FAIL_ERSTER', 'FAKE_PLAN_MIT', 'FAKE_INPUT_TOKENS', 'FAKE_ZAEHLER_DIR', 'LAGE_SPIELLEITER', 'FAEDEN', 'REISE_EREIGNISSE']) delete env[k];

function lauf(args, extraEnv, cwd) {
  return new Promise((resolve) => {
    const p = cp.spawn(process.execPath, [TOOL, ...args], { cwd: cwd || TMP, env: { ...env, ...(extraEnv || {}) } });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { try { p.kill(); } catch (e) { /* egal */ } }, 420000);
    p.on('exit', (code) => { clearTimeout(t); resolve({ code, out, err, text: out + err }); });
  });
}
const fakeEnv = (extra) => { const z = fs.mkdtempSync(path.join(TMP, 'zaehler-')); return Object.assign({ LLM_LIVE: '1', CLAUDE_CLI: FAKE, CLAUDE_TOKEN_BUDGET: '300000', FAKE_ZAEHLER_DIR: z }, extra || {}); };
const dateien = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? dateien(path.join(dir, d.name)) : [path.join(dir, d.name)])) : []);
const lauford = (wurzel) => (fs.existsSync(wurzel) ? fs.readdirSync(wurzel, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(wurzel, d.name)) : []);
const links = (datei) => [...fs.readFileSync(datei, 'utf8').matchAll(/\]\(([^)#\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/i.test(l)).map((l) => path.resolve(path.dirname(datei), decodeURIComponent(l)));
const lies = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const json = (f) => { try { return JSON.parse(lies(f)); } catch (e) { return null; } };
const NAMEN = /\b(Ada|Bo|Cem)\b/;
const repoStatus = () => (cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout || '');
const dataListe = () => dateien(path.join(ROOT, 'data')).join('|');
const statusVorher = repoStatus(), dataVorher = dataListe();
const kurz = ['--dauer', '240', '--grenzabstand', '0.3', '--geduld', '5', '--rueckfall-nach', '40'];

(async () => {
  // ---------- D und E zuerst (sofort, ohne Server)
  const marker = path.join(TMP, 'cli-aufgerufen.txt');
  const spion = path.join(TMP, 'spion-cli.js');
  fs.writeFileSync(spion, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'aufgerufen');\n`);
  const outD = path.join(TMP, 'ablage-d');
  const rD = await lauf(['--live', '--seed', '3', '--out', outD], { CLAUDE_CLI: spion });
  check('D --live ohne LLM_LIVE=1: "nicht gemessen", Exit 0, nichts angelegt, die CLI wird nie aufgerufen', rD.code === 0 && /nicht gemessen/.test(rD.out) && /LLM_LIVE/.test(rD.out) && !fs.existsSync(outD) && !fs.existsSync(marker), rD.text);
  const rD2 = await lauf(['--seed', '3', '--out', outD], { SPIELLEITER_LLM: 'live', CLAUDE_CLI: spion });
  check('D SPIELLEITER_LLM=live aus der Umgebung ohne LLM_LIVE=1: ebenso "nicht gemessen"', rD2.code === 0 && /nicht gemessen/.test(rD2.out) && !fs.existsSync(outD) && !fs.existsSync(marker), rD2.text);
  const rE1 = await lauf(['--mock', '--out', path.join(ROOT, 'tools', 'fixtures', 'abend-nie')]);
  check('E --out im Repo: Exit 2, Meldung, nichts angelegt', rE1.code === 2 && /liegt im Repo/.test(rE1.err) && !fs.existsSync(path.join(ROOT, 'tools', 'fixtures', 'abend-nie')), rE1.text);
  const rE2 = await lauf(['--mock', '--live', '--out', 'x']);
  check('E --mock zusammen mit --live: Exit 2', rE2.code === 2, rE2.text);
  for (const a of [['--seed', '0'], ['--seed', 'a'], ['--seed', '4,4'], ['--dauer', '1'], ['--abenteuer', '0'], ['--sprunglimit', '0'], ['--mitschnitt-dir', path.join(ROOT, 'data', 'x')], ['--out']]) {
    const r = await lauf(['--mock', ...a], {}, TMP);
    check(`E ${a.join(' ')}: Exit 2`, r.code === 2, r.text);
  }
  check('E nach den Fehlaufrufen ist nichts im Repo und nichts in der Ablage', !fs.existsSync(path.join(TMP, 'pantheon-messung')));

  // ---------- A, B, C parallel (jeder Lauf hat seinen eigenen Server auf freiem Port)
  const outA = path.join(TMP, 'ablage-a'); fs.mkdirSync(outA); fs.writeFileSync(path.join(outA, 'FREMD.txt'), 'darf nie verschwinden');
  const outL = path.join(TMP, 'ablage-live'); fs.mkdirSync(outL); fs.writeFileSync(path.join(outL, 'FREMD.txt'), 'darf nie verschwinden');
  const mitDir = path.join(TMP, 'mitschnitte');
  const [rA, rB, rC1, rC2] = await Promise.all([
    lauf(['--mock', '--seed', '7,8', '--abenteuer', '1', ...kurz, '--out', 'ablage-a', '--mitschnitt-dir', mitDir]),   // relatives --out: gegen das Verzeichnis des Aufrufers (TMP)
    lauf(['--live', '--seed', '7', '--abenteuer', '2', ...kurz, '--out', outL], fakeEnv({ FAKE_PLAN_MIT: 'geruecht,spur' })),
    lauf(['--live', '--seed', '5', '--abenteuer', '1', ...kurz, '--out', outL], fakeEnv({ CLAUDE_TOKEN_BUDGET: '40000', FAKE_INPUT_TOKENS: '20000', FAKE_PLAN_MIT: 'geruecht,spur' })),
    lauf(['--live', '--seed', '6', '--abenteuer', '1', ...kurz, '--freigeben', '--out', outL], fakeEnv({ CLAUDE_TOKEN_BUDGET: '40000', FAKE_INPUT_TOKENS: '20000', FAKE_PLAN_MIT: 'geruecht,spur' })),
  ]);

  // ----- A
  check('A Exit 0 (zwei Abende, keine Serverfehler)', rA.code === 0 && !/Serverfehler [1-9]/.test(rA.out), rA.text.slice(-1500));
  const ordA = lauford(outA);
  check('A genau ein Lauf-Ordner abend-mock-<Zeit> unter dem relativen --out', ordA.length === 1 && /abend-mock-\d{8}-\d{6}/.test(ordA[0]), ordA.join(','));
  const oA = ordA[0] || outA;
  const idxA = lies(path.join(oA, 'index.md'));
  const mA = json(path.join(oA, 'messung.json')) || { abende: [] };
  check('A messung.json: zwei Abende (Seed 7 und 8) mit Ergebnis', mA.abende.length === 2 && mA.abende.every((a) => a.ergebnis) && mA.abende.map((a) => a.seed).join() === '7,8', JSON.stringify(mA.abende.map((a) => [a.seed, !!a.ergebnis, a.grund])));
  const eA = mA.abende.map((a) => a.ergebnis).filter(Boolean);
  check('A jeder Abend: Angebote gesehen, mindestens ein Abenteuer angenommen UND zu Ende gespielt (Ausgang gelungen/gescheitert)', eA.length === 2 && eA.every((e) => e.angebote.length >= 1 && e.abenteuer.length >= 1 && e.abenteuer.every((x) => /^(gelungen|gescheitert)/.test(x.ausgang))), JSON.stringify(eA.map((e) => e.abenteuer.map((x) => x.ausgang))));
  check('A jeder gespielte Beat steht mit "wie gespielt" und Ausgang im Index (nichts still uebersprungen)', eA.every((e) => e.abenteuer.every((x) => x.beats_vorlage.length >= 2 && x.beats_vorlage.every((b) => b.wie && b.ausgang))) && /\| Beat \| Typ \| Wie gespielt \| Ausgang \| Künstlich \| Notiz \|/.test(idxA));
  const lA = links(path.join(oA, 'index.md'));
  const missionen = lA.filter((l) => /mission\.md$/.test(l));
  check('A index.md: alle relativen Links loesen auf, mindestens eine mission.md je Abend verlinkt', lA.length >= 8 && lA.every((l) => fs.existsSync(l)) && missionen.length >= 2, lA.filter((l) => !fs.existsSync(l)).join(',') + ' | ' + missionen.length);
  check('A jede verlinkte mission.md hat Frontmatter mit titel, kennung, ausgang und einen Verlauf (Zeitleiste)', missionen.length >= 1 && missionen.every((m) => /^---\r?\ntitel:/.test(lies(m)) && /\nkennung:/.test(lies(m)) && /\nausgang:/.test(lies(m)) && /Zeitleiste/.test(lies(m))), missionen.slice(0, 2).map((m) => lies(m).slice(0, 200)).join(' ## '));
  check('A Mitschnitt liegt unter --mitschnitt-dir (nicht in der Ablage), je Seed ein Unterordner', fs.existsSync(path.join(mitDir, 'seed-7')) && fs.existsSync(path.join(mitDir, 'seed-8')) && missionen.some((m) => m.startsWith(mitDir)), dateien(mitDir).slice(0, 5).join(','));
  check('A index.md: Seed, Dauer, Tokens/Kosten, Angebote/angenommen/gespielt, Notrufe, Reaktionszeiten, Zuordnung Plan → Mission', /\| Seed \| Dauer \| Sprünge \| Tokens \| Kosten \| Angebote \| angenommen \| gespielt \| Notrufe \(Reise\) \|/.test(idxA) && /### Angebote und Reaktionszeiten/.test(idxA) && /### Zuordnung Plan → Mission/.test(idxA) && /### Notrufe der Reise/.test(idxA) && /## Was der Bot nicht spielen kann/.test(idxA), idxA.slice(0, 800));
  check('A je Plan eine Datei (Plan, Rohantwort, Prompt-Link) und je Anfrage eine Zeile in der Zuordnung', eA.every((e) => e.plaene.length >= 1 && e.plaene.every((p) => fs.existsSync(path.join(oA, 'abend-' + e.seed, p.datei)) && fs.existsSync(path.join(oA, 'abend-' + e.seed, p.prompt_datei)) && /## Rohantwort/.test(lies(path.join(oA, 'abend-' + e.seed, p.datei))))));
  const alleTexte = dateien(oA).filter((f) => /\.(md|json|txt)$/.test(f) && !/[\\/]welt[\\/]/.test(f)).concat(dateien(mitDir).filter((f) => /\.(md|json)$/.test(f)));
  check('A keine Spielernamen (Ada, Bo, Cem) in irgendeinem Dokument der Ablage und des Mitschnitts', alleTexte.length > 20 && alleTexte.every((f) => !NAMEN.test(lies(f))), alleTexte.filter((f) => NAMEN.test(lies(f))).slice(0, 3).join(','));
  check('A Reaktionszeit zwischen Angebot und Annahme steht je angenommenem Angebot (Sekunden und Spielzeit)', eA.every((e) => e.angebote.filter((a) => a.angenommen).every((a) => Number.isFinite(a.angenommen.reaktion_s) && Number.isFinite(a.angenommen.reaktion_spielzeit_s))));
  check('A Fremddatei im --out unberuehrt', lies(path.join(outA, 'FREMD.txt')) === 'darf nie verschwinden');
  check('A Spielstand liegt nicht in der Ablage (welt_dir im Temp-Ordner)', eA.every((e) => e.welt_dir && !e.welt_dir.startsWith(outA) && path.dirname(e.welt_dir) === os.tmpdir()));

  // ----- B
  const ordL = lauford(outL).sort();
  const dirB = ordL.find((d) => json(path.join(d, 'messung.json')) && (json(path.join(d, 'messung.json')).abende[0] || {}).seed === 7);
  check('B Exit 0, Ablage abend-live-<Zeit>', rB.code === 0 && !!dirB && /abend-live-\d{8}-\d{6}/.test(dirB || ''), rB.text.slice(-1500));
  const eB = dirB ? json(path.join(dirB, 'messung.json')).abende[0].ergebnis : null;
  const geruecht = eB && eB.abenteuer.find((x) => x.typen[0] === 'geruecht');
  check('B Live-Pfad: Anfragen an den "Claude" (Fake) gezaehlt, Tokens aus dem Zaehler (1800 je Aufruf), Kosten (0,0123 je Aufruf)', eB && eB.modus === 'live' && eB.anfragen.abenteuer >= 1 && eB.budget.delta === 1800 * (eB.anfragen.lage + eB.anfragen.abenteuer) && Math.abs(eB.kosten_usd - 0.0123 * (eB.anfragen.lage + eB.anfragen.abenteuer)) < 1e-9, eB && JSON.stringify([eB.anfragen, eB.budget, eB.kosten_usd]));
  check('B Gerücht aus einem Claude-Plan: angenommen, ueber ECHTE Spruenge gespielt (Spruenge > 0), Ausgang gelungen, erster Beat "gespielt"', !!geruecht && geruecht.plan_quelle === 'Claude' && eB.spruenge >= 1 && geruecht.ausgang === 'gelungen' && /^gespielt/.test(geruecht.beats_vorlage[0].wie) && !('teleport' in geruecht.beats_vorlage[0].kuenstlich), geruecht && JSON.stringify(geruecht.beats_vorlage) + ' ' + geruecht.plan_quelle);
  const planG = geruecht && geruecht.plan ? path.join(dirB, 'abend-7', geruecht.plan.datei) : null;
  const aufnG = geruecht && geruecht.plan && geruecht.plan.aufnahme ? path.join(dirB, 'abend-7', geruecht.plan.aufnahme) : null;
  const aufG = aufnG && json(aufnG);
  check('B Plan-Aufnahme (Prompt + Rohantwort) liegt vor und gehoert zum Plan (Rohantwort enthaelt den Beat geruecht)', !!aufG && aufG.format === 'llm-aufzeichnung/1' && aufG.input && /<kontext>/.test(aufG.input.prompt || '') && /"geruecht"/.test(aufG.response.text), aufnG);
  check('B Plan-Datei: Frontmatter (Zuordnung, Angebot, Mission, Aufnahme), Link auf mission.md loest auf, Zuordnung "eindeutig"', !!planG && /\nzuordnung: "eindeutig/.test(lies(planG)) && /\nmission: "mitschnitt\//.test(lies(planG)) && links(planG).every((l) => fs.existsSync(l)) && links(planG).some((l) => /mission\.md$/.test(l)) && /\naufnahme: "regie\/aufnahmen\/abenteuer\//.test(lies(planG)), planG && lies(planG).slice(0, 700));
  const idxB = lies(path.join(dirB || oA, 'index.md'));
  check('B index.md verlinkt Plan, Aufnahme und mission.md des Gerüchts; alle Links loesen auf', links(path.join(dirB || oA, 'index.md')).every((l) => fs.existsSync(l)) && /\[Claude\]\(abend-7\/plaene\/abenteuer-\d+\.md\)/.test(idxB) && /\[Aufnahme\]\(abend-7\/regie\/aufnahmen\/abenteuer\//.test(idxB) && /mission\.md\]/.test(idxB), idxB.slice(1200, 2600));
  check('B Rueckfall-Angebote sind als solche ausgewiesen (kein Plan-Aufruf), nicht als Claude-Plan', eB && eB.angebote.some((a) => /^Rueckfall/.test(a.plan_quelle)) && eB.angebote.filter((a) => a.plan_quelle === 'Claude').every((a) => a.plan && a.aufnahme));
  check('B Logbuch (regie/*.jsonl) und Aufnahmen im Lauf-Ordner', dirB && dateien(path.join(dirB, 'abend-7', 'regie')).some((f) => /\.jsonl$/.test(f)) && dateien(path.join(dirB, 'abend-7', 'regie', 'aufnahmen')).length >= 2);

  // ----- C
  const dirsC = ordL.filter((d) => { const m = json(path.join(d, 'messung.json')); return m && m.abende[0] && (m.abende[0].seed === 5 || m.abende[0].seed === 6); });
  const dirC1 = dirsC.find((d) => json(path.join(d, 'messung.json')).abende[0].seed === 5), dirC2 = dirsC.find((d) => json(path.join(d, 'messung.json')).abende[0].seed === 6);
  const eC1 = dirC1 ? json(path.join(dirC1, 'messung.json')).abende[0].ergebnis : null, eC2 = dirC2 ? json(path.join(dirC2, 'messung.json')).abende[0].ergebnis : null;
  check('C Kontingent: Exit 0 und kein Absturz trotz erreichter Schwelle (Serverfehler 0)', rC1.code === 0 && !!eC1 && eC1.server_fehler === 0 && !eC1.abbruch, rC1.text.slice(-1200));
  check('C Kontingent erreicht: Zeitpunkt, Stand ueber der Schwelle (36 000), Funkmeldung "Kontingent aufgebraucht" vom Bordrechner', !!eC1 && eC1.kontingent.erreicht === true && eC1.kontingent.used >= 36000 && eC1.kontingent.schwelle === 36000 && eC1.kontingent.wall_s_ab_start >= 0 && !!eC1.kontingent.funk && eC1.kontingent.funk.von === 'Bordrechner' && /Kontingent aufgebraucht/.test(eC1.kontingent.funk.text), eC1 && JSON.stringify(eC1.kontingent));
  check('C der Abend laeuft im Rueckfall weiter: Abenteuer nach der Schwelle gespielt, danach kein weiterer Aufruf an den Spielleiter', !!eC1 && eC1.abenteuer.length >= 1 && eC1.abenteuer.every((x) => /^(gelungen|gescheitert)/.test(x.ausgang)) && eC1.anfragen.lage + eC1.anfragen.abenteuer <= 3 && eC1.budget.delta <= 3 * 21000, eC1 && JSON.stringify([eC1.anfragen, eC1.budget, eC1.abenteuer.map((x) => [x.plan_quelle, x.ausgang])]));
  const idxC = lies(path.join(dirC1 || oA, 'index.md'));
  check('C index.md zeigt es: "Kontingent erreicht", Zeitpunkt, Funkmeldung, "Rückfall"; Freigabe "nicht gesendet" ohne --freigeben', /\*\*Kontingent erreicht\*\* nach/.test(idxC) && /Funkmeldung: „Bordrechner: Kontingent aufgebraucht/.test(idxC) && /Rückfall weiter/.test(idxC) && /Freigabe \(--freigeben\): nicht gesendet/.test(idxC) && /\| erreicht \|/.test(idxC), idxC.slice(900, 2200));
  check('C ohne --freigeben bleibt das Limit unveraendert', !!eC1 && eC1.kontingent.freigabe === null && eC1.budget.limit === 40000);
  check('C --freigeben: Bot-Captain sendet kontingent.freigeben, Antwort ok, Limit +500 000 (540 000), Index nennt es', rC2.code === 0 && !!eC2 && !!eC2.kontingent.freigabe && eC2.kontingent.freigabe.antwort && eC2.kontingent.freigabe.antwort.ok === true && eC2.kontingent.freigabe.limit_danach === 540000 && eC2.budget.limit === 540000 && /Freigabe \(--freigeben\): gesendet, ok nach/.test(lies(path.join(dirC2 || oA, 'index.md'))), eC2 && JSON.stringify(eC2.kontingent) + rC2.text.slice(-600));
  check('C Logbuch nennt Erreichen und Freigabe (art kontingent)', dirC2 && dateien(path.join(dirC2, 'abend-6', 'regie')).filter((f) => /\.jsonl$/.test(f)).some((f) => /"art":"kontingent"[^\n]*"ausgang":"erreicht"/.test(lies(f)) || (/"ausgang":"erreicht"/.test(lies(f)) && /"art":"kontingent"/.test(lies(f)))) && dateien(path.join(dirC2, 'abend-6', 'regie')).filter((f) => /\.jsonl$/.test(f)).some((f) => /"ausgang":"freigabe"/.test(lies(f))));

  // ---------- F: nichts im Repo, nichts geloescht
  check('F Fremddateien in beiden --out-Ordnern unberuehrt, drei Lauf-Ordner nebeneinander (nichts ueberschrieben)', lies(path.join(outL, 'FREMD.txt')) === 'darf nie verschwinden' && ordL.length === 3 && new Set(ordL).size === 3, ordL.join(','));
  check('F git status unveraendert (keine Datei im Repo angelegt)', repoStatus() === statusVorher, repoStatus());
  check('F data/ im Repo nicht angefasst (Spielstaende, Regie, Mitschnitt gingen nach aussen)', dataListe() === dataVorher, dataListe());
  const ohne = require('./live-abend.js').ohneNamen;
  check('F ohneNamen: Ganzwort, Spieler 1 bis 3', ohne('Ada und Bo, Cem. Adam, Bob') === 'Spieler 1 und Spieler 2, Spieler 3. Adam, Bob');

  let bad = 0;
  for (const r of results) { if (!r.ok) { bad++; console.log(`✗ ${r.name}${r.detail ? ' – ' + String(r.detail).slice(0, 600) : ''}`); } }
  if (!bad) fs.rmSync(TMP, { recursive: true, force: true });   // das eigene mkdtemp-Verzeichnis dieses Tests (bei Fehlern bleibt es zur Analyse liegen)
  else console.log('Ablage zur Analyse: ' + TMP);
  console.log(`${results.length - bad}/${results.length} Prüfungen ok`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FEHLER im Test: ' + (e && e.stack)); process.exit(1); });
