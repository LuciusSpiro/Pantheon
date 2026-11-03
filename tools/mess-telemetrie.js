'use strict';
// TEL-01 E: Tickmessung des Spielprotokolls (Abnahme 8, Fassung von Kai 2026-11-02): Protokollaufrufe <= 20 us je Tick, Schreibvorgang <= 5 ms, Spielverlauf bit-gleich (das prueft
// der Entwickler mit cmp und Golden Trace, nicht dieses Werkzeug); A-B-A-B nur berichten. Die Messung steckt in tools/mess-telemetrie-vorlade.js (node -r, nur im Kindprozess).
//   npm run mess:telemetrie -- [kosten|abab|alles] [--modi graben,wellen,kampagne] [--seeds 1,2,3] [--paare 5] [--seed 1] [--aus <datei.md>] [--json <datei>] [--tmp <ordner>] [--kurz]
//     kosten   us je Tick der Protokollaufrufe (ohne Schreiben) und Dauer der Schreibvorgaenge; Telemetrie an; je Modus alle --seeds (Standard 1,2,3)
//     abab     abwechselnd TELEMETRIE=aus und =an, gleiche Seed (--seed, Standard 1), --paare Paare (Standard 5): Tickzeit (Game.step) als Median und p99 je Lauf
//     alles    beides (Standard)
//     --modi   graben (Grabenangriff zu dritt), wellen (Wellen, Standardkarte), kampagne (M1/M2 zu dritt); mit --kurz stattdessen nur `kurz` (Wellen Kesh solo, wenige Sekunden: Selbsttest)
//   Die Laeufe laufen nacheinander (nie parallel: Zeitmessung), Protokolle in --tmp (Standard: temporaerer Ordner, danach geloescht). Exit 0 = gemessen; 1 = ein Lauf ohne Ergebnis; 2 = Aufruf.
//   Die Grenzen (20 us, 5 ms) stehen in der Ausgabe; ob sie gehalten sind, sagt die Ausgabe je Modus ("ok" / "UEBER").

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SIM = path.join(__dirname, 'sim-headless.js');
const VORLADE = path.join(__dirname, 'mess-telemetrie-vorlade.js');
const GRENZE_US = 20;
const GRENZE_SCHREIBEN_MS = 5;
const MODI = {
  graben: { name: 'Graben zu dritt', args: ['graben', '--players', '3'] },
  wellen: { name: 'Wellen', args: ['wellen'] },
  kampagne: { name: 'Kampagne zu dritt', args: ['3'] },
  kurz: { name: 'Wellen Kesh solo (kurz)', args: ['wellen', '--karte', 'kesh', '--players', '1'] },
};

function optionen(argv) {
  const o = { was: 'alles', modi: null, seeds: [1, 2, 3], seed: 1, paare: 5, aus: null, json: null, tmp: null, kurz: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const wert = () => { const v = argv[++i]; if (v == null) throw new Error(x + ' braucht einen Wert'); return v; };
    if (['kosten', 'abab', 'alles'].includes(x)) o.was = x;
    else if (x === '--modi') o.modi = wert().split(',');
    else if (x === '--seeds') o.seeds = wert().split(',').map(Number);
    else if (x === '--seed') o.seed = Number(wert());
    else if (x === '--paare') o.paare = Number(wert());
    else if (x === '--aus') o.aus = wert();
    else if (x === '--json') o.json = wert();
    else if (x === '--tmp') o.tmp = wert();
    else if (x === '--kurz') o.kurz = true;
    else throw new Error('unbekannte Option ' + x);
  }
  if (!o.modi) o.modi = o.kurz ? ['kurz'] : ['graben', 'wellen', 'kampagne'];
  for (const m of o.modi) if (!MODI[m]) throw new Error('unbekannter Modus ' + m + '; bekannt: ' + Object.keys(MODI).join(', '));
  if (o.seeds.some((s) => !Number.isInteger(s)) || !Number.isInteger(o.seed) || !(o.paare >= 1)) throw new Error('--seeds, --seed und --paare muessen ganze Zahlen sein (paare >= 1)');
  return o;
}

// Ein Lauf als Kindprozess. Rueckgabe das Ergebnis aus der JSON-Zeile des Vorlademoduls oder { fehler }
function lauf(modus, seed, art, telemetrie, tmp, kennung) {
  const dir = path.join(tmp, kennung);
  fs.mkdirSync(dir, { recursive: true });
  const aus = path.join(dir, 'mess.jsonl');
  const env = Object.assign({}, process.env, { MESS_ART: art, MESS_AUS: aus, TELEMETRIE: telemetrie ? 'an' : 'aus', TELEMETRIE_DIR: path.join(dir, 'telemetrie') });
  const r = spawnSync(process.execPath, ['-r', VORLADE, SIM].concat(MODI[modus].args, ['--seed', String(seed)]), { cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: 20 * 60 * 1000, maxBuffer: 1 << 24 });
  let zeilen = [];
  try { zeilen = fs.readFileSync(aus, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { /* keine Datei */ }
  const e = zeilen.filter((z) => z.art === art).pop();
  if (!e) return { fehler: 'kein Ergebnis (Exit ' + r.status + (r.stderr ? ', ' + String(r.stderr).trim().split('\n')[0].slice(0, 160) : '') + ')' };
  if (art === 'kosten' && !e.patch_ok) return { fehler: 'Schreibmessung: Quelltext von protokoll.js hat sich geaendert (schreibe-Kopf nicht gefunden)' };
  e.exit = r.status;
  return e;
}

const median = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const perz = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const f = (x, n) => (x == null ? '-' : x.toFixed(n === undefined ? 1 : n).replace('.', ','));
const pz = (x) => (x == null ? '-' : (x > 0 ? '+' : '') + x.toFixed(1).replace('.', ',') + ' %');

function messenKosten(modus, seeds, tmp, log) {
  const laeufe = [];
  for (const s of seeds) {
    log('  kosten ' + modus + ' Seed ' + s);
    laeufe.push(Object.assign({ seed: s }, lauf(modus, s, 'kosten', true, tmp, 'kosten-' + modus + '-s' + s)));
  }
  const gut = laeufe.filter((l) => !l.fehler);
  const ticks = gut.reduce((a, l) => a + l.ticks, 0);
  const gew = (k) => (ticks ? gut.reduce((a, l) => a + l[k] * l.ticks, 0) / ticks : null);   // je Lauf us/Tick, gewichtet mit den Ticks
  const ns = [].concat(...gut.map((l) => l.schreiben.ns));
  const bytes = [].concat(...gut.map((l) => l.schreiben.bytes));
  const ersteMax = Math.max(0, ...gut.map((l) => (l.schreiben.ns.length ? l.schreiben.ns[0] : 0)));   // der erste Vorgang jeder Session oeffnet die Datei und schreibt die Tuning-Datei
  return { modus, name: MODI[modus].name, seeds, fehler: laeufe.filter((l) => l.fehler).map((l) => 'Seed ' + l.seed + ': ' + l.fehler), ticks,
    us_je_tick: gew('us_je_tick'), B1: gew('B1'), B2: gew('B2'), Dienst: gew('Dienst'), je_lauf: gut.map((l) => ({ seed: l.seed, ticks: l.ticks, us_je_tick: l.us_je_tick })),
    top: gut.length ? gut[0].top : [],
    schreiben: { n: ns.length, im_tick: gut.reduce((a, l) => a + l.schreiben.im_tick, 0), med_ms: ns.length ? median(ns) / 1e6 : null, p99_ms: ns.length ? perz(ns, 0.99) / 1e6 : null, max_ms: ns.length ? Math.max(...ns) / 1e6 : null,
      erster_max_ms: ersteMax / 1e6, ohne_ersten_max_ms: gut.length ? Math.max(0, ...gut.map((l) => Math.max(0, ...l.schreiben.ns.slice(1)))) / 1e6 : null, med_bytes: median(bytes) } };
}

function messenAbab(modus, seed, paare, tmp, log) {
  const a = []; const b = [];
  for (let i = 1; i <= paare; i++) {
    log('  abab ' + modus + ' Paar ' + i + '/' + paare);
    a.push(lauf(modus, seed, 'tick', false, tmp, 'abab-' + modus + '-a' + i));
    b.push(lauf(modus, seed, 'tick', true, tmp, 'abab-' + modus + '-b' + i));
  }
  const fehler = [].concat(a, b).filter((l) => l.fehler).map((l) => l.fehler);
  const ok = a.every((l, i) => !l.fehler && !b[i].fehler);
  const rel = (x, y) => (x ? (y - x) / x * 100 : null);
  const aufeinander = (arr, k) => { const d = []; for (let i = 0; i + 1 < arr.length; i++) if (!arr[i].fehler && !arr[i + 1].fehler) d.push(Math.abs(rel(arr[i][k], arr[i + 1][k]))); return d; };
  const o = { modus, name: MODI[modus].name, seed, paare, fehler, gleiche_ticks: ok ? a.every((l, i) => l.ticks === b[i].ticks) : null };
  if (!ok) return o;
  for (const k of ['med_us', 'p99_us']) {
    const ds = a.map((l, i) => rel(l[k], b[i][k]));
    o[k] = { aus: median(a.map((l) => l[k])), an: median(b.map((l) => l[k])), delta_median_pct: median(ds), delta_min_pct: Math.min(...ds), delta_max_pct: Math.max(...ds), je_paar_pct: ds,
      rausch_aa_pct: median(aufeinander(a, k)), rausch_bb_pct: median(aufeinander(b, k)), aus_je_lauf: a.map((l) => l[k]), an_je_lauf: b.map((l) => l[k]) };
  }
  o.ticks = a[0].ticks;
  return o;
}

function bericht(erg, o) {
  const z = ['# Tickmessung Spielprotokoll (TEL-01 E)', '',
    '- Stand: ' + new Date().toISOString().slice(0, 10) + ', Node ' + process.version + ', ' + process.platform + '-' + process.arch + ', ' + os.cpus().length + ' Kerne (' + os.cpus()[0].model.trim() + '); Laeufe nacheinander.',
    '- Grenzen (Kai 2026-11-02): Protokollaufrufe <= ' + GRENZE_US + ' us je Tick, Schreibvorgang <= ' + GRENZE_SCHREIBEN_MS + ' ms; Spielverlauf bit-gleich (cmp, Golden Trace); A-B-A-B nur berichtet.', ''];
  if (erg.kosten) {
    z.push('## Kosten der Protokollaufrufe je Tick', '',
      'Alle Funktionen von `gefecht.js` (B1), `haken.js` (B2) und alle Methoden des Dienstes, je aeusserster Aufruf, ohne die Zeit des Schreibens (die laeuft im Server ausserhalb des Ticks), Leerlauf der Zeitmessung abgezogen. Telemetrie an, Seeds ' + o.seeds.join(', ') + ', gewichtet mit den Ticks.', '',
      '| Modus | Ticks | us/Tick | davon B1 | B2 | Dienst | Grenze ' + GRENZE_US + ' us |', '|---|---|---|---|---|---|---|');
    for (const k of erg.kosten) z.push('| ' + k.name + ' | ' + k.ticks + ' | **' + f(k.us_je_tick, 2) + '** | ' + f(k.B1, 2) + ' | ' + f(k.B2, 2) + ' | ' + f(k.Dienst, 2) + ' | ' + (k.us_je_tick == null ? '-' : k.us_je_tick <= GRENZE_US ? 'ok' : 'UEBER') + ' |');
    for (const k of erg.kosten) for (const e of k.fehler) z.push('', '> [!warning] ' + k.name + ': ' + e);
    z.push('', 'Je Lauf (us/Tick): ' + erg.kosten.map((k) => k.name + ' ' + k.je_lauf.map((l) => 'Seed ' + l.seed + ' ' + f(l.us_je_tick, 2)).join(', ')).join('; ') + '.');
    z.push('', '## Schreibvorgang', '',
      'Ein Schreibvorgang ist ein Aufruf von `schreibe` in `protokoll.js`: Zeilen serialisieren, Datei oeffnen (beim ersten), Tuning-Datei schreiben (beim ersten), `writeSync`. Bot-Laeufe haben keine Ereignisschleife zwischen den Ticks: dort schreibt der Puffer bei 1000 Zeilen mitten im Tick (die Bloecke sind dadurch deutlich groesser als die kleinen Bloecke je Tick im Server, die Messung ist also der unguenstige Fall).', '',
      '| Modus | Vorgaenge (davon im Tick) | Median ms | p99 ms | **Max ms** | davon erster je Session | Max ohne ersten | Median Bytes | Grenze ' + GRENZE_SCHREIBEN_MS + ' ms |', '|---|---|---|---|---|---|---|---|---|');
    for (const k of erg.kosten) { const s = k.schreiben; z.push('| ' + k.name + ' | ' + s.n + ' (' + s.im_tick + ') | ' + f(s.med_ms, 2) + ' | ' + f(s.p99_ms, 2) + ' | **' + f(s.max_ms, 2) + '** | ' + f(s.erster_max_ms, 2) + ' | ' + f(s.ohne_ersten_max_ms, 2) + ' | ' + (s.med_bytes == null ? '-' : Math.round(s.med_bytes)) + ' | ' + (s.max_ms == null ? '-' : s.max_ms <= GRENZE_SCHREIBEN_MS ? 'ok' : 'UEBER') + ' |'); }
    z.push('');
  }
  if (erg.abab) {
    z.push('## A-B-A-B: Tickzeit mit und ohne Protokoll (nur berichtet)', '',
      'Zeit je `Game.step`, gleiche Seed (' + o.seed + ') und gleiche Last in jedem Lauf, ' + o.paare + ' Paare, abwechselnd `TELEMETRIE=aus` (A) und `an` (B), nacheinander. Delta = (B - A) / A je Paar; "Rauschen" = Abstand zweier aufeinanderfolgender Laeufe derselben Art (A-A bzw. B-B), Median ueber die Paare.', '',
      '| Modus | Kennzahl | aus | an | Delta (Median der Paare) | Spanne der Paare | Rauschen A-A | Rauschen B-B |', '|---|---|---|---|---|---|---|---|');
    for (const a of erg.abab) {
      if (!a.med_us) { z.push('| ' + a.name + ' | - | - | - | - | - | - | ' + (a.fehler[0] || '') + ' |'); continue; }
      for (const [k, n] of [['med_us', 'Median'], ['p99_us', 'p99']]) { const m = a[k]; z.push('| ' + a.name + ' | ' + n + ' (us) | ' + f(m.aus, 1) + ' | ' + f(m.an, 1) + ' | ' + pz(m.delta_median_pct) + ' | ' + pz(m.delta_min_pct) + ' bis ' + pz(m.delta_max_pct) + ' | ' + f(m.rausch_aa_pct, 1) + ' % | ' + f(m.rausch_bb_pct, 1) + ' % |'); }
    }
    z.push('', 'Ticks je Lauf und gleiche Ticks mit und ohne Protokoll: ' + erg.abab.map((a) => a.name + ' ' + (a.ticks || '-') + ' (' + (a.gleiche_ticks ? 'gleich' : a.gleiche_ticks === false ? 'VERSCHIEDEN' : '?') + ')').join('; ') + '.');
  }
  return z.join('\n') + '\n';
}

function main() {
  let o;
  try { o = optionen(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  const tmp = o.tmp ? path.resolve(o.tmp) : fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mess-'));
  const log = (t) => console.error(t);
  const erg = {};
  if (o.was === 'kosten' || o.was === 'alles') erg.kosten = o.modi.map((m) => messenKosten(m, o.seeds, tmp, log));
  if (o.was === 'abab' || o.was === 'alles') erg.abab = o.modi.map((m) => messenAbab(m, o.seed, o.paare, tmp, log));
  const text = bericht(erg, o);
  if (o.aus) { fs.mkdirSync(path.dirname(path.resolve(o.aus)), { recursive: true }); fs.writeFileSync(path.resolve(o.aus), text, 'utf8'); }
  if (o.json) fs.writeFileSync(path.resolve(o.json), JSON.stringify(erg), 'utf8');
  process.stdout.write(text);
  if (!o.tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ } }
  const schlecht = [].concat((erg.kosten || []).flatMap((k) => k.fehler), (erg.abab || []).flatMap((a) => a.fehler));
  return schlecht.length ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { optionen, lauf, messenKosten, messenAbab, bericht, MODI, GRENZE_US, GRENZE_SCHREIBEN_MS };
