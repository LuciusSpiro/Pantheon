'use strict';
// Trockenversuch Spielleiter (Vorarbeit S2): Kann ein LLM aus Katalog + Weltstand ein gültiges, gutes Regiebuch bauen?
// Ruft `claude -p` (ohne Werkzeuge, ohne Sitzung) wie die Claude-Bridge auf, prüft das Ergebnis mit tools/check-missions.js
// und gibt bei Fehlern genau eine Nachbesserungsrunde (wie im Konzept: begrenzte Versuche, danach Archiv).
// Aufruf: node concept/regiebuch/trockenversuch/trockenversuch.js [auftrag-id …] [--model sonnet] [--katalog]
// Ausgabe: concept/regiebuch/trockenversuch/out/<id>.v1.json, .v2.json, <id>.bericht.md

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const CONCEPT = path.join(DIR, '..');
const ROOT = path.join(CONCEPT, '..', '..');
const OUT = path.join(DIR, 'out');
const { check } = require(path.join(ROOT, 'tools', 'check-missions.js'));
const Locations = require(path.join(ROOT, 'shared', 'locations.js'));
const REG = JSON.parse(fs.readFileSync(path.join(CONCEPT, 'bausteine.json'), 'utf8'));

const args = process.argv.slice(2);
const CLAUDE_CLI = process.env.CLAUDE_CLI || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'sonnet';

// ---------- Katalog als Text (nur, was der Spielleiter benutzen darf) ----------
function katalog() {
  const L = [];
  L.push('# Katalog\n');
  L.push('## Orte (Weltraumszenen; ein Sprung führt nur über bekannte Verbindungen)');
  for (const l of Locations.LOCATIONS) {
    L.push(`- \`${l.id}\` – ${l.name} (${l.kind}). ${l.desc} Verbindungen: ${l.links.join(', ')}.` +
      (l.scene.beam ? ` Außenkarte per Transfer: \`${l.scene.beam.map}\`.` : '') + (l.scene.dock ? ' Andocken möglich (Hafen, Speichern).' : ''));
    for (const h of l.hidden) L.push(`  - Fund \`${h.id}\` (${h.kind}): ${h.name}`);
  }
  L.push('\n## Außenkarten (nur diese drei gibt es; jede gehört zu einem Ort, siehe oben)');
  for (const [map, k] of Object.entries(REG.karten)) {
    if (map.startsWith('$')) continue;
    L.push(`- \`${map}\``);
    L.push(`  - Objekte: ${Object.entries(k.objekte || {}).map(([o, d]) => `\`${o}\` (Zustände: ${d.zustaende.join('/')})`).join(', ') || '–'}`);
    L.push(`  - Bereiche: ${Object.keys(k.bereiche || {}).map((b) => `\`${b}\``).join(', ') || '–'}`);
    L.push(`  - Trupps (besetzung.gruppen, quelle "karte"): ${Object.entries(k.gruppen || {}).map(([g, d]) => `\`${g}\` (Kachelart ${d.legend})`).join(', ') || '–'}`);
    if (k.einheiten) L.push(`  - Einheiten (besetzung.einheiten): ${Object.keys(k.einheiten).map((u) => `\`${u}\``).join(', ')}`);
  }
  L.push('\nAnker in `besetzung` sind die Spawn-Zeichen der Karte: kesh a=squad1, b=squad2/relief, c=rearguard, L=warden; wreck a=plunderer; platform d=guards.');
  L.push('\n## Gegner im Weltraum (Atom `spawn`)');
  L.push('`{ "spawn": { "kind": K, "tag": "frei", "n": 1–3 | "angles": [rad…] | "atStation": [{ "dx", "dy" }…] | "behind": true | "crew": { "1": n, "2": n, "3": n }, "face": "out"|"in" } }`');
  L.push('- `raider` Jäger: schnell, Anflüge über das Schiff');
  L.push('- `gunboat` Kanonenboot: träge, lädt schwere Breitseiten sichtbar (Pilot dreht weg, Taktik antwortet)');
  L.push('- `relay` Störrelais: kreist um ein Objekt, blockiert einen Scan, schießt nicht');
  L.push('- `pylon` Pylon (Kustoden): fest, Frontschild – nur von der Seite verwundbar');
  L.push('- `sentinel` Kustoden-Wächter: langsam, EMP legt Systeme lahm');
  L.push('\n## Bausteine: Aktionen (`{ "do": name, …parameter }`)');
  for (const [n, d] of Object.entries(REG.aktionen)) if (d.einordnung === 'generisch') L.push(`- \`${n}\` – ${d.beschreibung || ''}. Parameter: ${Object.entries(d.params).map(([p, x]) => `${p}${x.pflicht ? '*' : ''}:${x.typ}${x.werte ? '(' + x.werte.join('|') + ')' : ''}`).join(', ') || '–'}`);
  L.push('\n## Bausteine: Prüfungen (`{ "check": { "name": name, …parameter } }`)');
  for (const [n, d] of Object.entries(REG.pruefungen)) L.push(`- \`${n}\` – Parameter: ${Object.entries(d.params).map(([p, x]) => `${p}${x.pflicht ? '*' : ''}:${x.typ}${x.werte ? '(' + x.werte.join('|') + ')' : ''}`).join(', ') || '–'}`);
  L.push('\n(* = Pflicht)');
  L.push('\n## Atome (direkt in Aktionen)');
  L.push('`oda`, `radio {from: npc, text, accept?}`, `set {var: wert}` (Schrittvariablen, Bedingung `v`), `setFlag {flag: wert}` (missionsweit, Bedingung `flag`), `reveal` (Ort-ID oder Liste), `reward {marks?, items?: {ersatzteil|flickblech|loeschgel|medipack|bolzen: n}, deko?: [..]}`, `log` (+ `loc`), `spawn`, `spawnSalvage: n` (Bergungskisten in der Szene, Prüfung `salvage_done`), `choice: id` (öffnet eine Entscheidung des Schritts), `after {sec, do: [..]}`, `goto: schritt`, `complete: ausgang`, `end {title, text}` nur in ausgaenge.danach.');
  L.push('Schritt-Felder: `loc` (Ort, an dem der Schritt spielt), `scan {id, label, range (300–500), time (s), requires?, blocked?}` (Captain-Scan des Hauptobjekts, Bedingung `scanDone: id`), `jumpBlock [{dest?, if, reason}]`, `allowBeam: [karte]`, `restartOnReturn`.');
  L.push('\n## Bedingungen (Atome)');
  L.push('`all`, `any`, `not`, `atLocation: ort`, `docked: true|false|ort`, `elapsed: s` (seit Schrittbeginn), `flag`, `v`, `enemiesCleared`, `enemiesLeft {kind?, tag?, max}`, `killed {kind|tag, min}`, `enemyHpBelow {tag|kind, frac}`, `scanDone: id`, `choiceMade: id`, `event: name`, `known: ort`, `visited: ort`, `revealed: fund`, `found: fund`, `dest: ort` (Sprungziel gewählt), `near {station: px}`, `check {…}`.');
  L.push('\n## Ereignisse (für `event` und `on`)');
  L.push('accepted, jumped, docked, undocked, scanned, enemyKilled, enemyScanned, shieldsChanged, widescan, hiddenFound, salvage, beamedDown, beamedUp, playerWounded, fire, breach, systemDamaged, repaired, bought, decoPlaced, jammerOff, vaultOpened, tabletTaken, wardenKilled, sondeDisabled, datenkernTaken, coreRebooted, npcRescued, droneKilled.');
  L.push('\n## Platzhalter in Texten');
  L.push('`{killed:tag}`, `{left:tag}`, `{found}`, `{total}`, `{salvaged}`, `{squadLeft:trupp}`, `{objectsInState:objekt:zustand}`.');
  L.push('\n## NSC (Kennungen)');
  for (const [k, v] of Object.entries(REG.npc)) if (!k.startsWith('$')) L.push(`- \`${k}\` – ${v}`);
  L.push('\n## Folgen in `ausgaenge.*.folgen` (je Eintrag genau ein Schlüssel)');
  L.push('`npc_gedaechtnis {npc, text}`, `npc_haltung {npc, delta: -2…2}`, `npc_status {npc, status}`, `chronik: text`, `welt_fakt {key, wert}`, `remove_item {item}`, `ruf {fraktion, delta}`.');
  return L.join('\n');
}

function prompt(auftrag) {
  const weltstand = fs.readFileSync(path.join(DIR, 'weltstand-nach-tutorial.json'), 'utf8');
  const schema = fs.readFileSync(path.join(CONCEPT, 'regiebuch.schema.json'), 'utf8');
  const beispiel = fs.readFileSync(path.join(CONCEPT, 'm3.regiebuch.json'), 'utf8');
  return [
    '<weltstand>\n' + weltstand + '\n</weltstand>',
    '<katalog>\n' + katalog() + '\n</katalog>',
    '<schema>\n' + schema + '\n</schema>',
    '<beispiel titel="m3 – Die Tafel von Kesh (handgeschrieben, gültig)">\n' + beispiel + '\n</beispiel>',
    '<auftrag>\n' + auftrag.auftrag + '\n</auftrag>',
    'Baue jetzt das Regiebuch. Antworte nur mit dem JSON-Objekt.',
  ].join('\n\n');
}

function callClaude(text) {
  const t0 = Date.now();
  // Windows: claude.cmd ist ein npm-Shim; über die Shell gehen leere Argumente (--tools "") verloren -> direkt cli.js starten
  const r = spawnSync(process.execPath, [CLAUDE_CLI, '-p', '--model', MODEL, '--tools', '', '--output-format', 'json', '--no-session-persistence',
    '--strict-mcp-config', '--system-prompt-file', path.join(DIR, 'spielleiter.md')],
  { input: text, encoding: 'utf8', cwd: OUT, maxBuffer: 64 * 1024 * 1024, shell: false, timeout: 15 * 60 * 1000 });
  const sec = Math.round((Date.now() - t0) / 1000);
  if (r.error || r.status !== 0) throw new Error(`claude fehlgeschlagen (${r.status}): ${r.error || ''} ${(r.stderr || '').slice(0, 500)}`);
  const meta = JSON.parse(r.stdout);
  return { text: meta.result || '', cost: meta.total_cost_usd, usage: meta.usage, sec, isError: meta.is_error };
}

function extractJson(text) {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('kein JSON in der Antwort');
  return JSON.parse(text.slice(a, b + 1));
}

function fmt(r) {
  return r.errors.map((e) => `- FEHLER ${e.code} ${e.p}: ${e.msg}`).concat(r.warnings.map((w) => `- warnung ${w.code} ${w.p}: ${w.msg}`)).join('\n');
}

function run(auftrag) {
  const base = prompt(auftrag);
  const bericht = [`# Trockenversuch: ${auftrag.id}`, '', `Modell: ${MODEL} · ${new Date().toISOString()}`, '', `**Auftrag:** ${auftrag.auftrag}`, ''];
  let doc = null; let res = null; let raw = '';
  for (let v = 1; v <= 2; v++) {
    const input = v === 1 ? base
      : base + '\n\n<deine_antwort>\n' + raw + '\n</deine_antwort>\n\n<pruefer>\nDer Prüfer hat das Regiebuch zurückgewiesen:\n' +
        res.errors.map((e) => `- ${e.code} ${e.p}: ${e.msg}`).join('\n') +
        '\n</pruefer>\n\nKorrigiere alle Fehler und gib das vollständige Regiebuch zurück. Nur das JSON-Objekt.';
    process.stdout.write(`${auftrag.id} v${v}: Spielleiter arbeitet … `);
    const c = callClaude(input);
    raw = c.text;
    bericht.push(`## Versuch ${v}`, '', `Dauer ${c.sec} s · Kosten ${c.cost != null ? '$' + c.cost.toFixed(3) : '?'} · Tokens ein/aus: ${c.usage ? (c.usage.input_tokens + (c.usage.cache_read_input_tokens || 0) + (c.usage.cache_creation_input_tokens || 0)) + '/' + c.usage.output_tokens : '?'}`, '');
    try { doc = extractJson(raw); } catch (e) {
      fs.writeFileSync(path.join(OUT, `${auftrag.id}.v${v}.txt`), raw);
      bericht.push(`Antwort war kein gültiges JSON: ${e.message}`, '');
      res = { errors: [{ code: 'JSON', p: '$', msg: e.message }], warnings: [] };
      console.log('kein JSON');
      continue;
    }
    fs.writeFileSync(path.join(OUT, `${auftrag.id}.v${v}.json`), JSON.stringify(doc, null, 2));
    res = check(doc);
    console.log(`${res.errors.length} Fehler, ${res.warnings.length} Warnungen (${c.sec} s)`);
    bericht.push(`Prüfer: **${res.errors.length} Fehler**, ${res.warnings.length} Warnungen`, '', fmt(res) || '(nichts)', '');
    if (!res.errors.length) break;
  }
  bericht.push('## Ergebnis', '', res && !res.errors.length ? '**Gültig.**' : '**Nach Nachbesserung weiterhin ungültig → im Spiel würde das Archiv greifen.**', '');
  fs.writeFileSync(path.join(OUT, `${auftrag.id}.bericht.md`), bericht.join('\n'));
  return !!(res && !res.errors.length);
}

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  if (args.includes('--dump')) { const all0 = JSON.parse(fs.readFileSync(path.join(DIR, 'auftraege.json'), 'utf8')); fs.writeFileSync(path.join(OUT, 'prompt.txt'), prompt(all0[0])); console.log('prompt.txt geschrieben'); process.exit(0); }
  if (args.includes('--katalog')) { fs.writeFileSync(path.join(OUT, 'katalog.md'), katalog()); console.log('katalog.md geschrieben'); process.exit(0); }
  const all = JSON.parse(fs.readFileSync(path.join(DIR, 'auftraege.json'), 'utf8'));
  const ids = args.filter((a) => !a.startsWith('--') && a !== MODEL);
  const list = ids.length ? all.filter((a) => ids.includes(a.id)) : all;
  let ok = 0;
  for (const a of list) { try { if (run(a)) ok++; } catch (e) { console.log(`${a.id}: ${e.message}`); } }
  console.log(`\n${ok}/${list.length} gültig. Berichte in ${path.relative(ROOT, OUT)}`);
}
