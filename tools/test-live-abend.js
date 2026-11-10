'use strict';
// LIV-01 D: Test des Live-Laeufers tools/live-abend.js (npm run test:live-abend). Offline: Mock-Spielleiter bzw. die Fake-CLI tools/fixtures/messe/fake-claude.js (kein Netz, kein Abo, nie der echte Claude).
// Ablage nur in ein mkdtemp-Verzeichnis, nie im Repo. Geprueft:
//   A  Mock-Spielleiter, zwei Seeds: Laeufer startet, nimmt Angebote an, spielt Abenteuer zu Ende, index.md mit funktionierenden relativen Links auf mission.md, messung.json, keine Spielernamen
//   B  Live-Pfad mit Fake-CLI (Plan Gerücht): echte Spruenge, Plan Claude -> Aufnahme (Prompt + Rohantwort) -> Angebot -> Abenteuer -> mission.md, Tokens und Kosten aus dem Zaehler
//   C  Kontingent (kleines Limit, Fake mit hohem usage): Schwelle erreicht, Frage "Limit erhoehen?" (Ereignis an color 0, kein Funk), der Abend laeuft im Rueckfall weiter, Index zeigt es; mit --freigeben antwortet der Bot (color 0) mit Ja (Limit +500 000)
//   D  --live ohne LLM_LIVE=1: "nicht gemessen", Exit 0, nichts angelegt, die CLI wird nie aufgerufen      E  falsche Aufrufe: Exit 2, nichts angelegt (auch --out im Repo)
//   F  nichts im Repo (git status, data/), Fremddatei und fruehere Laeufe in --out unberuehrt, nichts geloescht
//   Nacharbeit (Reviewer-Befunde): U Einheiten ohne Server (K1 Ausgang/Takt je Angebot, K1c je Beat, M1 Nachhilfe, M2 gespielt, M3 Zuordnung Faden, N2 Abschuesse, N5 Titel); N Mock-Lauf --ohne-testhelfer (K1, M2, N1, N4, N5, N10, Index);
//   M4 harter Abbruch (Plaene, Protokoll, unvollstaendiges Ergebnis); M5 Pflicht CLAUDE_TOKEN_BUDGET und --gesamtdeckel; N8 Standardablage.  LIVE_ABEND_TEST=einheit|neu faehrt nur diese Teile (fuer schnelle Belege).
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
const NUR = process.env.LIVE_ABEND_TEST || '';
const kurz = ['--dauer', '240', '--grenzabstand', '0.3', '--geduld', '5', '--rueckfall-nach', '40'];

(async () => {
  const abschlussMeldung = () => {
    let bad = 0;
    for (const r of results) { if (!r.ok) { bad++; console.log(`✗ ${r.name}${r.detail ? ' – ' + String(r.detail).slice(0, 600) : ''}`); } }
    if (!bad) fs.rmSync(TMP, { recursive: true, force: true });   // das eigene mkdtemp-Verzeichnis dieses Tests (bei Fehlern bleibt es zur Analyse liegen)
    else console.log('Ablage zur Analyse: ' + TMP);
    console.log(`${results.length - bad}/${results.length} Prüfungen ok`);
    process.exit(bad ? 1 : 0);
  };
  // ---------- D und E zuerst (sofort, ohne Server)
  // N8: der Standardort der Ablage ist <Temp>/pantheon-messung (nicht <TMP>/pantheon-messung): Zustand vorher merken, nach den Fehlaufrufen unveraendert
  const stdAblage = path.join(os.tmpdir(), 'pantheon-messung');
  const stdVorher = fs.existsSync(stdAblage) ? fs.readdirSync(stdAblage).sort().join('|') : null;
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
  check('E nach den Fehlaufrufen ist nichts im Repo und nichts in der Standard-Ablage (<Temp>/pantheon-messung unveraendert)', (fs.existsSync(stdAblage) ? fs.readdirSync(stdAblage).sort().join('|') : null) === stdVorher, stdAblage);

  // =====================================================================================================================================================
  // Nacharbeit: Einheiten ohne Server (U)
  // =====================================================================================================================================================
  const LA = require('./live-abend.js');
  const Beats = require('./lib/bot-beats.js');
  // K1 a: Ausgang je Angebot, getrennt nach angenommen / verfallen / verdraengt / abgeloest / offen, mit Taetigkeiten und Bot-Anteil
  const mkA = (nr, extra) => Object.assign(LA.angebotNeu({ nr, ref: 'x', hex: '0101', alter: 0, vorlage: { titel: 'T' + nr, beats: [{ typ: 'geruecht' }] } }, { titel: 'T' + nr }, { t: 100, grenzen: 10, spielzeit: 1, wall: 1 }), extra || {});
  const verf = LA.angebotAusgang(mkA(1, { weg: { t: 113, bot: 23 } }), []);
  check('U K1 Ausgang verfallen: 13 Taetigkeiten seit Erstellung (Alter 12 ueberschritten), davon 13 vom Bot, Text "verfallen (Alter 12 erreicht)"', verf.art === 'verfallen' && verf.taetigkeiten === 13 && verf.davon_bot === 13 && /Alter 12 erreicht/.test(verf.text), JSON.stringify(verf));
  const gemischt = LA.angebotAusgang(mkA(2, { weg: { t: 113, bot: 18 } }), []);
  check('U K1 Bot-Anteil getrennt von der Gesamtzahl: 13 Taetigkeiten, davon nur 8 vom Bot', gemischt.taetigkeiten === 13 && gemischt.davon_bot === 8, JSON.stringify(gemischt));
  const verdr = LA.angebotAusgang(mkA(3, { weg: { t: 105, bot: 12 }, im_brett: false }), []);
  const verdr2 = LA.angebotAusgang(mkA(3, { weg: { t: 105, bot: 12 } }), []);
  check('U K1 Ausgang verdraengt: vor Alter 13 weg und nicht angenommen (nie im Brett der Crew: angebote_max), nicht "verfallen"', verdr.art === 'verdraengt' && /angebote_max/.test(verdr.text) && verdr2.art === 'verdraengt' && !/angebote_max/.test(verdr2.text), JSON.stringify([verdr, verdr2]));
  const abl = LA.angebotAusgang(mkA(4, { weg: { t: 104, bot: 11 } }), [{ plan: { angebot: 4 }, ausgang: 'abenteuer_veraltet' }]), abl2 = LA.angebotAusgang(mkA(5, { weg: { t: 113, bot: 11 } }), [{ plan: { angebot: 5 }, ausgang: 'abenteuer_abgelehnt' }]);
  check('U K1 Ausgang abgeloest: Logbuch (abenteuer_veraltet / abenteuer_abgelehnt) schlaegt die Altersrechnung', abl.art === 'abgeloest' && /veraltet/.test(abl.text) && abl2.art === 'abgeloest' && /abgelehnt/.test(abl2.text), JSON.stringify([abl, abl2]));
  const ang = LA.angebotAusgang(mkA(6, { weg: { t: 101, bot: 10 }, annahme_gesendet: true, faden: 'f3' }), []), off = LA.angebotAusgang(mkA(7, { t_zuletzt: 104 }), [], { t: 106, bot: 14 });
  check('U K1 Ausgang angenommen (Faden da) und offen (am Ende noch am Brett, Taetigkeiten bis jetzt)', ang.art === 'angenommen' && off.art === 'offen' && off.taetigkeiten === 6 && off.davon_bot === 4, JSON.stringify([ang, off]));
  const e0 = LA.angebotNeu({ nr: 9, ref: 'x', hex: '0101', alter: 2, vorlage: { titel: 'Titel aus dem Plan', beats: [{ typ: 'spur' }] } }, undefined, { t: 50, grenzen: 3, spielzeit: 1, wall: 1 });
  check('U N5 Titel nie null: ohne Eintrag im Brett der Crew kommt der Titel aus dem Plan; Erstellungsstand t_erstellt = t - alter', e0.titel === 'Titel aus dem Plan' && e0.t_erstellt === 48 && LA.titelVon(undefined, { titel: 'P' }, 'F') === 'P' && LA.titelVon(undefined, null, 'F') === 'F', JSON.stringify(e0));
  // M2: gespielt nur mit mindestens einem tatsaechlich gespielten Beat
  const sNicht = LA.spielStatus({ ausgang: 'gescheitert', beats: [{ typ: 'konvoi', wie: 'nicht gespielt' }, { typ: 'abschluss', wie: 'gespielt' }] });
  const sOffen = LA.spielStatus({ ausgang: 'offen beim Ende (laeuft, Beat konvoi)', beats: [{ typ: 'konvoi', wie: 'nicht gespielt' }] });
  const sJa = LA.spielStatus({ ausgang: 'gelungen', beats: [{ typ: 'geruecht', wie: 'gespielt (Anflug gesetzt)' }, { typ: 'abschluss', wie: 'gespielt' }] });
  const sTeils = LA.spielStatus({ ausgang: 'gelungen', beats: [{ typ: 'konvoi', wie: 'teils kuenstlich' }] });
  check('U M2 gespielt nur mit gespieltem Beat: nur "nicht gespielt" + abschluss = "angenommen, nicht gespielt"; offen = "offen bei Zeitende"; Gerücht gespielt = gespielt', !sNicht.gespielt && sNicht.status === 'angenommen, nicht gespielt' && !sOffen.gespielt && sOffen.status === 'offen bei Zeitende' && sJa.gespielt && sTeils.gespielt, JSON.stringify([sNicht, sOffen, sJa, sTeils]));
  // M3: Faden zum Angebot
  const alt = { id: 'f1', plan: {}, vorlage: 'RF', phase: 'abgeschlossen' }, neu2 = { id: 'f2', plan: {}, vorlage: 'RF', phase: 'laeuft' };
  const z1 = LA.fadenZuAngebot({ liste: [alt, neu2], logbuch: [], nr: 7, ref: 'RF', vergeben: new Set(['f1']) });
  const z2 = LA.fadenZuAngebot({ liste: [alt, neu2], logbuch: [], nr: 7, ref: 'RF', vergeben: new Set() });
  const z3 = LA.fadenZuAngebot({ liste: [alt, neu2], logbuch: [], nr: 7, ref: 'RF', vergeben: new Set(['f2']) });
  const z4 = LA.fadenZuAngebot({ liste: [alt, neu2], logbuch: [{ art: 'faden_ereignis', ausgang: 'geoeffnet', plan: { angebot: 7, faden: 'f2' } }], nr: 7, ref: 'RF', vergeben: new Set() });
  check('U M3 dieselbe Rueckfall-Vorlage zweimal im Abend: nie der alte abgeschlossene Faden (auch ohne Vermerk), kein schon zugeordneter Faden, mit Logbuch exakt der geoeffnete', z1 && z1.id === 'f2' && z2 && z2.id === 'f2' && z3 === null && z4 && z4.id === 'f2', JSON.stringify([z1 && z1.id, z2 && z2.id, z3 && z3.id, z4 && z4.id]));
  // M1 / K1 c: Beats der Vorlage
  const vorl = { beats: [{ id: 'b1', typ: 'konvoi' }, { id: 'b2', typ: 'abschluss' }] };
  const rec0 = { beats: [{ typ: 'konvoi', id: 'b1', wie: 'nicht gespielt', ausgang: 'gescheitert', kuenstlich: { 'grenze-gesetzt': 6 }, notiz: 'Frist lief ab' }], nachhilfe: [{ beat: 'abschluss', beat_id: 'b2', ok: true }, { beat: 'konvoi', beat_id: 'b1', ok: false }], gedaechtnis: ['abschluss_gelungen'] };
  const bv = LA.beatsVorlage(vorl, rec0, { b1: { warten: 2, laeuft: 6 }, b2: { warten: 3, laeuft: 0 } }, new Set(['b1']));
  check('U K1c je Beat: Bot-Grenzen davor/im Beat und Beat-Frist (allein durch den Bot-Takt, wenn die Bot-Grenzen die Frist 6 fuellen); grenze-gesetzt bleibt in "kuenstlich"', bv[0].grenzen_davor === 2 && bv[0].grenzen_beat === 6 && bv[0].frist_abgelaufen && bv[0].frist.nach === 6 && bv[0].frist.allein_durch_bot === true && bv[0].kuenstlich['grenze-gesetzt'] === 6 && bv[1].frist === null && !bv[1].frist_abgelaufen, JSON.stringify(bv));
  check('U M1 Nachhilfe dem gestarteten Beat zugeordnet: Beat ohne Bot-Spiel (nie "laeuft" gesehen) steht als "vom Bot gestartet (Nachhilfe) ... Baustein" mit faden-weiter-bot, abgelehnte Nachhilfe zaehlt nicht', /vom Bot gestartet \(Nachhilfe\)/.test(bv[1].wie) && bv[1].kuenstlich['faden-weiter-bot'] === 1 && bv[1].nachhilfe === 1 && bv[1].kuenstlich['grenze-gesetzt'] === 3 && bv[0].nachhilfe === 0 && !('faden-weiter-bot' in bv[0].kuenstlich), JSON.stringify(bv[1]));
  // N2: Abschuesse zaehlen, nicht Schleifendurchlaeufe
  const TH = require('./gegner-testhilfe.js'), toetenOrig = TH.toeten;
  try {
    const kzT = {}; const gT = { space: { enemies: [] } };
    const BT = Beats.neu({ g: gT, cl: [], w: {}, zeile() {}, k: (...a) => { for (const x of a) kzT[x] = (kzT[x] || 0) + 1; }, kz: kzT, opts: { testhelfer: true }, grenze() {}, ereignis() {} });
    TH.toeten = (game, e) => { game.space.enemies.splice(game.space.enemies.indexOf(e), 1); };
    for (let i = 0; i < 5; i++) BT.alleGegner();
    const ohneGegner = kzT['testhelfer-kill'] || 0;
    gT.space.enemies.push({ id: 1 }, { id: 2 });
    BT.alleGegner(); BT.alleGegner();
    const mitZwei = kzT['testhelfer-kill'] || 0;
    const lingering = { id: 3 }; gT.space.enemies.push(lingering);
    TH.toeten = () => {};   // der Gegner treibt noch (Countdown): noch kein Abschuss
    BT.alleGegner(); const waehrend = kzT['testhelfer-kill'] || 0;
    gT.space.enemies.splice(gT.space.enemies.indexOf(lingering), 1);   // jetzt ist er weg
    BT.alleGegner(); BT.alleGegner();
    check('U N2 testhelfer-kill zaehlt Abschuesse: 5 Durchlaeufe ohne Gegner = 0, zwei Gegner = 2 (nicht je Durchlauf), treibender Gegner erst bei Abgang, danach genau einmal', ohneGegner === 0 && mitZwei === 2 && waehrend === 2 && kzT['testhelfer-kill'] === 3, JSON.stringify([ohneGegner, mitZwei, waehrend, kzT]));
  } finally { TH.toeten = toetenOrig; }
  if (NUR === 'einheit') return abschlussMeldung();

  // =====================================================================================================================================================
  // Nacharbeit: Laeufe (N: Mock ohne Testhelfer; M4 harter Abbruch; M5 Pflicht-Budget und Gesamtdeckel)
  // =====================================================================================================================================================
  const outN = path.join(TMP, 'ablage-n'), outH = path.join(TMP, 'ablage-hart'), outG = path.join(TMP, 'ablage-gesamt'), outB = path.join(TMP, 'ablage-budget');
  for (const d of [outN, outH, outG, outB]) fs.mkdirSync(d);
  const rBud = await lauf(['--live', '--seed', '5', '--dauer', '5', '--out', outB], fakeEnv({ CLAUDE_TOKEN_BUDGET: '' }));   // M5: Pflicht, sofort
  const [rN, rH, rG] = await Promise.all([
    lauf(['--mock', '--seed', '7', '--abenteuer', '2', '--dauer', '100', '--grenzabstand', '0.3', '--geduld', '5', '--rueckfall-nach', '20', '--ohne-testhelfer', '--out', outN]),
    lauf(['--live', '--seed', '5', '--abenteuer', '2', '--dauer', '240', '--hart', '25', '--grenzabstand', '0.3', '--geduld', '5', '--rueckfall-nach', '40', '--out', outH], fakeEnv({ FAKE_PLAN_MIT: 'geruecht,spur' })),
    lauf(['--live', '--seed', '5,6,7', '--gesamtdeckel', '1', '--abenteuer', '1', '--dauer', '20', '--grenzabstand', '0.3', '--geduld', '5', '--rueckfall-nach', '40', '--out', outG], fakeEnv({ FAKE_PLAN_MIT: 'geruecht,spur' })),
  ]);
  // ----- M5
  check('M5 Live ohne CLAUDE_TOKEN_BUDGET: Exit 2 mit Hinweis, nichts angelegt, die Standard-500 000 gelten nie still', rBud.code === 2 && /CLAUDE_TOKEN_BUDGET/.test(rBud.err) && lauford(outB).length === 0, rBud.text);
  const dirG = lauford(outG)[0], mG = dirG && json(path.join(dirG, 'messung.json'));
  check('M5 --gesamtdeckel 1: nach dem ersten fertigen Seed startet kein weiterer (Seeds 6 und 7 nicht gestartet, kein Abend-Ordner), im Index und in messung.json ausgewiesen', !!mG && mG.abende.length === 3 && !mG.abende[0].uebersprungen && mG.abende[1].uebersprungen === true && mG.abende[2].uebersprungen === true && !fs.existsSync(path.join(dirG, 'abend-6')) && !fs.existsSync(path.join(dirG, 'abend-7')) && mG.optionen.gesamtdeckel === 1 && mG.verbraucht_tokens >= 1 && /nicht gestartet/.test(lies(path.join(dirG, 'index.md'))) && /Gesamtdeckel/.test(lies(path.join(dirG, 'index.md'))), mG ? JSON.stringify(mG.abende.map((a) => [a.seed, a.uebersprungen, a.grund])) + rG.text.slice(-500) : rG.text.slice(-800));
  check('M5 --gesamtdeckel ungueltig (0 / Text): Exit 2', (await lauf(['--mock', '--gesamtdeckel', '0'])).code === 2 && (await lauf(['--mock', '--gesamtdeckel', 'x'])).code === 2);
  // ----- M4
  const dirH = lauford(outH)[0], eH = dirH && json(path.join(dirH, 'abend-5', 'ergebnis.json')), mH = dirH && json(path.join(dirH, 'messung.json'));
  const plH = dirH ? dateien(path.join(dirH, 'abend-5', 'plaene')).filter((x) => /\.md$/.test(x)) : [];
  check('M4 harter Abbruch (--hart 25): Exit 1, Plaene (Datei + Prompt) und Protokoll liegen trotzdem vor, ergebnis.json als "unvollstaendig" markiert, im messung.json und im Index ausgewiesen', rH.code === 1 && plH.length >= 1 && dateien(path.join(dirH, 'abend-5', 'plaene')).some((x) => /prompt\.txt$/.test(x)) && lies(path.join(dirH, 'abend-5', 'protokoll.txt')).split('\n').length > 5 && !!eH && eH.unvollstaendig === true && !!mH && mH.abende[0].ergebnis && mH.abende[0].ergebnis.unvollstaendig === true && /unvollständig/.test(lies(path.join(dirH, 'index.md'))), rH.text.slice(-600) + JSON.stringify([plH.length, eH && eH.unvollstaendig]));
  // ----- Mock ohne Testhelfer: K1, M2, N1, N4, N5, N10
  const dirN = lauford(outN)[0], mN = dirN && json(path.join(dirN, 'messung.json')), eN = mN && mN.abende[0] && mN.abende[0].ergebnis, idxN = dirN ? lies(path.join(dirN, 'index.md')) : '', protN = dirN ? lies(path.join(dirN, 'abend-7', 'protokoll.txt')) : '';
  const SZ = ['konvoi', 'geleit', 'raumschlacht', 'verfolgung', 'befreiung', 'spontanhilfe'];
  const szBeats = eN ? eN.abenteuer.flatMap((x) => x.beats_vorlage.filter((b) => SZ.includes(b.typ) && b.wie !== 'nicht erreicht' && !/Baustein/.test(b.wie))) : [];
  const gespieltN = (x) => x.beats_vorlage.some((b) => b.typ !== 'abschluss' && b.typ !== 'enthuellung' && /^(gespielt|teils)/.test(b.wie));
  check('N10 --ohne-testhelfer: Exit 0, Szenen-Beats stehen als "nicht gespielt" (nie "gespielt"/"teils kuenstlich"), "gespielt" je Abenteuer genau dann, wenn ein Nicht-Szenen-Beat gespielt wurde (Gerücht, Spur ...), Index-Summe stimmt', rN.code === 0 && !!eN && eN.abenteuer.length >= 1 && szBeats.every((b) => b.wie === 'nicht gespielt') && eN.abenteuer.every((x) => x.gespielt === gespieltN(x) && x.spiel_status === (x.gespielt ? 'gespielt' : /^offen/.test(x.ausgang) ? 'offen bei Zeitende' : 'angenommen, nicht gespielt')) && idxN.includes(`Summe: ${eN.abenteuer.filter((x) => x.gespielt).length} Abenteuer gespielt (`) && idxN.includes(`abenteuer_gespielt: ${eN.abenteuer.filter((x) => x.gespielt).length}`), rN.text.slice(-300) + (eN ? JSON.stringify(eN.abenteuer.map((x) => [x.spiel_status, x.beats_vorlage.map((b) => b.wie)])) : ''));
  check('M2 Index: Spalte "gespielt" zaehlt nur gespielte, daneben "angenommen, nicht gespielt"; der Ausgang je Angebot folgt dem Abenteuer (angenommen und gespielt / angenommen, nicht gespielt / offen bei Zeitende), nie pauschal "gespielt"', !!eN && /\| Serverfehler \| angenommen, nicht gespielt \|/.test(idxN) && eN.angebote.filter((a) => a.abenteuer).every((a) => { const x = eN.abenteuer.find((y) => y.angebot === a.nr); return a.ausgang === (x.gespielt ? 'angenommen und gespielt' : x.spiel_status === 'offen bei Zeitende' ? 'angenommen, offen bei Zeitende' : 'angenommen, nicht gespielt'); }), eN && JSON.stringify(eN.angebote.map((a) => a.ausgang)));
  const alleEnde = eN ? eN.angebote.filter((a) => a.ende && a.ende.art !== 'offen') : [];
  check('K1 a Index je Angebot: Taetigkeiten bis Ende (davon Bot) und getrennter Ausgang; Verfall kommt hier allein vom Bot-Takt (davon Bot = alle Taetigkeiten)', !!eN && eN.angebote.every((a) => a.ende && Number.isInteger(a.ende.taetigkeiten) && Number.isInteger(a.ende.davon_bot) && a.ende.davon_bot <= a.ende.taetigkeiten + 1) && eN.angebote.some((a) => a.ende.art === 'verfallen' && a.ende.davon_bot >= a.ende.taetigkeiten - 1 && a.ende.taetigkeiten >= 12) && /Tätigkeiten bis Ende \(davon Bot\)/.test(idxN) && /verfallen \(Alter 12 erreicht\)/.test(idxN) && /\| \d+ \(davon Bot \d+\), Alter \d+ \| (verfallen|verdrängt|abgelöst|angenommen|am Ende)/.test(idxN) && alleEnde.length >= 2, eN && JSON.stringify(eN.angebote.map((a) => [a.id, a.ende])));
  check('K1 b Hinweis-Kasten je Abend: Bot-Takt = N Grenzen in T s (eine alle X s), Verfall nach rund Y s, Tokens/Kosten deckelgebunden (deckel_je_sitzung)', !!eN && eN.takt.grenzen === eN.grenzen && eN.takt.grenzen > 10 && eN.takt.verfall_angebot_s > 0 && /Bot-Takt = \d+ Grenzen in [\d.,]+ s\*\* \(eine alle [\d.,]+ s, eingestellt: --grenzabstand 0\.3 s\)/.test(idxN) && /Verfall wäre nach rund [\d.,]+ s/.test(idxN) && /deckelgebunden/.test(idxN) && /deckel_je_sitzung: Lage \d+, Abenteuer \d+/.test(idxN), idxN.slice(idxN.indexOf('Bot-Takt'), idxN.indexOf('Bot-Takt') + 900));
  check('K1 c Beat-Tabelle: Bot-Grenzen (davor / im Beat) und Beat-Frist je Beat; grenze-gesetzt steht in "Künstlich"; ohne Testhelfer lief die Frist allein durch den Bot-Takt ab', !!eN && eN.abenteuer.some((x) => x.beats_vorlage.some((b) => b.grenzen_beat >= 6 && b.frist_abgelaufen && b.frist && b.frist.allein_durch_bot && b.kuenstlich['grenze-gesetzt'] >= 6)) && /allein durch den Bot-Takt/.test(idxN) && /grenze-gesetzt ×\d+/.test(idxN), eN && JSON.stringify(eN.abenteuer.map((x) => x.beats_vorlage.map((b) => [b.typ, b.grenzen_davor, b.grenzen_beat, b.frist_abgelaufen]))));
  check('K1 d benutzter --grenzabstand steht in index.md (Kopf und Frontmatter) und messung.json (optionen und grenzabstand_s)', !!mN && mN.optionen.grenzabstand === 0.3 && mN.grenzabstand_s === 0.3 && /grenzabstand_s: 0\.3/.test(idxN) && /Bot-Takt \(--grenzabstand\): 0\.3 s/.test(idxN));
  check('N1 Angebote werden auch waehrend langer Beats gesehen (Hintergrund-Beobachter): kein Angebot wird erst bei hohem Alter bemerkt (Alter beim ersten Sehen hoechstens 2)', !!eN && eN.angebote.length >= 3 && eN.angebote.every((a) => a.alter_sichtbar <= 2), eN && JSON.stringify(eN.angebote.map((a) => [a.id, a.alter_sichtbar])));
  check('N5 kein Titel null: weder „null“ im Protokoll noch eine Ueberschrift ohne Titel im Index (#### f<Nr> / #### null)', !!eN && !/„null“/.test(protN) && !/^#### (null|f\d+) \(/m.test(idxN) && eN.angebote.every((a) => a.titel) && eN.abenteuer.every((x) => x.titel), protN.split('\n').filter((l) => /null/.test(l)).slice(0, 3).join(' | '));
  check('N4 namensfilter_ersetzungen in messung.json: Summe aus Eltern- und Abendprozessen (mindestens die Zahl des Abends, > 0, weil das Protokoll Spielernamen enthaelt)', !!eN && Number.isFinite(eN.namensfilter_ersetzungen) && eN.namensfilter_ersetzungen > 0 && mN.namensfilter_ersetzungen >= eN.namensfilter_ersetzungen, eN && JSON.stringify([eN.namensfilter_ersetzungen, mN.namensfilter_ersetzungen]));
  if (NUR === 'neu') return abschlussMeldung();

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
  check('A jeder gespielte Beat steht mit "wie gespielt" und Ausgang im Index (nichts still uebersprungen)', eA.every((e) => e.abenteuer.every((x) => x.beats_vorlage.length >= 2 && x.beats_vorlage.every((b) => b.wie && b.ausgang))) && /\| Beat \| Typ \| Wie gespielt \| Ausgang \| Künstlich \| Bot-Grenzen \(davor \/ im Beat\) \| Beat-Frist \| Notiz \|/.test(idxA));
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
  check('C Kontingent erreicht: Zeitpunkt, Stand ueber der Schwelle (36 000), Frage zugestellt (kein Funk)', !!eC1 && eC1.kontingent.erreicht === true && eC1.kontingent.used >= 36000 && eC1.kontingent.schwelle === 36000 && eC1.kontingent.wall_s_ab_start >= 0 && eC1.kontingent.frage_zugestellt === true && !('funk' in eC1.kontingent), eC1 && JSON.stringify(eC1.kontingent));
  check('C der Abend laeuft im Rueckfall weiter: Abenteuer nach der Schwelle gespielt, danach kein weiterer Aufruf an den Spielleiter', !!eC1 && eC1.abenteuer.length >= 1 && eC1.abenteuer.every((x) => /^(gelungen|gescheitert)/.test(x.ausgang)) && eC1.anfragen.lage + eC1.anfragen.abenteuer <= 3 && eC1.budget.delta <= 3 * 21000, eC1 && JSON.stringify([eC1.anfragen, eC1.budget, eC1.abenteuer.map((x) => [x.plan_quelle, x.ausgang])]));
  const idxC = lies(path.join(dirC1 || oA, 'index.md'));
  check('C index.md zeigt es: "Kontingent erreicht", Zeitpunkt, Frage zugestellt, "Rückfall"; Freigabe "nicht gesendet" ohne --freigeben', /\*\*Kontingent erreicht\*\* nach/.test(idxC) && /Frage „Limit erhöhen\?“ \(Ereignis kontingentFrage[^\n]*: zugestellt/.test(idxC) && !/Funkmeldung/.test(idxC) && /Rückfall weiter/.test(idxC) && /Freigabe \(--freigeben\): nicht gesendet/.test(idxC) && /\| erreicht \|/.test(idxC), idxC.slice(900, 2200));
  check('C ohne --freigeben bleibt das Limit unveraendert (der Bot antwortet nicht, die Frage bleibt offen)', !!eC1 && eC1.kontingent.freigabe === null && eC1.budget.limit === 40000);
  check('C --freigeben: der Bot (color 0) sendet kontingent.freigeben, Antwort ok, Limit +500 000 (540 000), Index nennt es', rC2.code === 0 && !!eC2 && !!eC2.kontingent.freigabe && eC2.kontingent.freigabe.antwort && eC2.kontingent.freigabe.antwort.ok === true && eC2.kontingent.freigabe.limit_danach === 540000 && eC2.budget.limit === 540000 && /Freigabe \(--freigeben\): gesendet, ok nach/.test(lies(path.join(dirC2 || oA, 'index.md'))), eC2 && JSON.stringify(eC2.kontingent) + rC2.text.slice(-600));
  check('C Logbuch nennt Erreichen und Freigabe (art kontingent)', dirC2 && dateien(path.join(dirC2, 'abend-6', 'regie')).filter((f) => /\.jsonl$/.test(f)).some((f) => /"art":"kontingent"[^\n]*"ausgang":"erreicht"/.test(lies(f)) || (/"ausgang":"erreicht"/.test(lies(f)) && /"art":"kontingent"/.test(lies(f)))) && dateien(path.join(dirC2, 'abend-6', 'regie')).filter((f) => /\.jsonl$/.test(f)).some((f) => /"ausgang":"freigabe"/.test(lies(f))));

  // ---------- F: nichts im Repo, nichts geloescht
  check('F Fremddateien in beiden --out-Ordnern unberuehrt, drei Lauf-Ordner nebeneinander (nichts ueberschrieben)', lies(path.join(outL, 'FREMD.txt')) === 'darf nie verschwinden' && ordL.length === 3 && new Set(ordL).size === 3, ordL.join(','));
  check('F git status unveraendert (keine Datei im Repo angelegt)', repoStatus() === statusVorher, repoStatus());
  check('F data/ im Repo nicht angefasst (Spielstaende, Regie, Mitschnitt gingen nach aussen)', dataListe() === dataVorher, dataListe());
  const ohne = require('./live-abend.js').ohneNamen;
  check('F ohneNamen: Ganzwort, Spieler 1 bis 3', ohne('Ada und Bo, Cem. Adam, Bob') === 'Spieler 1 und Spieler 2, Spieler 3. Adam, Bob');

  abschlussMeldung();
})().catch((e) => { console.log('FEHLER im Test: ' + (e && e.stack)); process.exit(1); });
