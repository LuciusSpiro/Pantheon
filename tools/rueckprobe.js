'use strict';
// TEL-01 E: Rueckwaertsprobe. Baut einen Balance-Fehler (EIN Tuning-Wert von shared/config.js mal Faktor) in die Bot-Laeufe ein und prueft, ob der Vergleich (npm run vergleich)
// ihn als Abweichung markiert. Das Repo bleibt unberuehrt: der Fehler kommt als Vorlade-Modul (node --require) in die Kindprozesse der Laeufe und veraendert dort nur das Config-Objekt
// im Speicher; keine Datei von server/, shared/ oder content/ wird angefasst, es gibt keine Wegwerfkopie des Spielcodes (und damit nichts, was versehentlich committet werden koennte).
//   npm run rueckprobe -- --pfad <tuning.pfad> --faktor <f> --gruppe <id[,id]> [--seeds 12] [--jobs 4] [--kern <kennzahl>] [--aus <ordner>] [--behalten] [--name <text>]
//     --pfad     Punktpfad in shared/config.js, z. B. awayCombat.waffen.blaster.schaden (muss eine Zahl sein, sonst Exit 2)
//     --faktor   Multiplikator, z. B. 2 (Schaden verdoppelt) oder 1.2 (+20 %)
//     --gruppe   Gruppen-IDs der Basis (tools/basis.js GRUPPEN), z. B. arena_graben/3,arena_away/aussenposten/3
//     --seeds    Seeds je Gruppe: Fehlerlaeufe und Referenz 1..N (dieselben wie die Basis), Kontrolle 101..100+N (Standard 12)
//     --kern     Kennzahl-Schluessel, dessen Aenderung je Methode ausgewiesen wird (sonst die groesste wesentliche Aenderung)
//     --aus      Arbeitsordner (Standard: temporaerer Ordner, wird geloescht, ausser mit --behalten); Ergebnisse als rueckprobe.md und rueckprobe.json darin
// Je Gruppe fuenf Laufsaetze (je Seed ein eigener Prozess wie bei der Basis): Fehler (Seeds 1..N, mit Fehler), Referenz (dieselben Seeds ohne Fehler), Kontrolle (Seeds 101.., ohne Fehler).
// Methoden: a) Gruppe gegen Gruppe, Basis gegen Fehler (basis:<id> gegen Ordner, n gegen n); b) Lauf gegen Lauf, dieselbe Seed ohne und mit Fehler (die Bots sind je Lauf deterministisch:
// jede Abweichung stammt aus dem Fehler; Rauschen zum Vergleich: Referenz gegen Referenz mit anderer Seed); c) Kontrolle ohne Fehler gegen die Basis (Fehlalarme).
// Exit 0 = fertig (auch wenn der Fehler nicht erkannt wurde: das ist das Ergebnis), 1 = Laeufe ohne gueltige Session, 2 = Aufrufproblem.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Basis = require('./basis.js');
const Vergleich = require('./vergleich.js');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'shared', 'config.js');

// Vorlade-Modul der Kindprozesse (wird in den Arbeitsordner geschrieben, nicht ins Repo)
const VORLADE = `'use strict';
// rueckprobe: ein Config-Wert mal Faktor, nur im Speicher dieses Prozesses
const pfad = process.env.RUECKPROBE_PFAD; const faktor = Number(process.env.RUECKPROBE_FAKTOR);
if (pfad) {
  const cfg = require(process.env.RUECKPROBE_CONFIG);
  const teile = pfad.split('.'); const letzt = teile.pop();
  let o = cfg; for (const t of teile) o = o && o[t];
  if (!o || typeof o[letzt] !== 'number' || !Number.isFinite(faktor)) { console.error('rueckprobe: ' + pfad + ' ist keine Zahl in shared/config.js'); process.exit(97); }
  o[letzt] = o[letzt] * faktor;
}
`;

function optionen(argv) {
  const o = { pfad: null, faktor: null, gruppen: null, seeds: 12, jobs: 4, kern: null, aus: null, behalten: false, name: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const wert = () => { const v = argv[++i]; if (v == null) throw new Error(x + ' braucht einen Wert'); return v; };
    if (x === '--pfad') o.pfad = wert();
    else if (x === '--faktor') o.faktor = Number(wert());
    else if (x === '--gruppe') o.gruppen = wert().split(',');
    else if (x === '--seeds') o.seeds = Number(wert());
    else if (x === '--jobs') o.jobs = Number(wert());
    else if (x === '--kern') o.kern = wert();
    else if (x === '--aus') o.aus = wert();
    else if (x === '--name') o.name = wert();
    else if (x === '--behalten') o.behalten = true;
    else throw new Error('unbekannte Option ' + x);
  }
  if (!o.pfad || !Number.isFinite(o.faktor) || !o.gruppen) throw new Error('--pfad, --faktor und --gruppe sind Pflicht');
  if (!(o.seeds >= 4) || !(o.jobs >= 1)) throw new Error('--seeds muss >= 4 sein (der Gruppenvergleich braucht 4 Laeufe je Seite), --jobs >= 1');
  const unbekannt = o.gruppen.filter((id) => !Basis.GRUPPEN.some((g) => g.id === id));
  if (unbekannt.length) throw new Error('unbekannte Gruppe ' + unbekannt.join(', ') + '; bekannt: ' + Basis.GRUPPEN.map((g) => g.id).join(', '));
  return o;
}

// Wert unter einem Punktpfad im Config-Objekt (nur zur Vorabpruefung; der Fehler selbst wird im Kindprozess gesetzt)
function configWert(pfad) {
  let o = require(CONFIG);
  for (const t of pfad.split('.')) o = o && o[t];
  return o;
}

const median = (a) => { const s = a.filter((x) => x != null).sort((p, q) => p - q); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const prozent = (rel) => (rel == null ? '-' : (rel > 0 ? '+' : '') + (Math.round(rel * 1000) / 10).toString().replace('.', ',') + ' %');

// Satz von Laeufen (je Seed ein Prozess): Rueckgabe { ordner, ergebnisse } ; env gilt fuer die Kindprozesse (Basis.lauf erbt process.env)
async function laufSatz(g, seeds, ordner, env, jobs) {
  const alt = {};
  for (const k of Object.keys(env)) { alt[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  try {
    fs.mkdirSync(ordner, { recursive: true });
    const ergebnisse = await Basis.pool(seeds, jobs, (s) => Basis.lauf(g, s, ordner));
    return { ordner, ergebnisse };
  } finally { for (const k of Object.keys(alt)) { if (alt[k] == null) delete process.env[k]; else process.env[k] = alt[k]; } }
}

// Kennzahl-Zeile einer Vergleichsausgabe (zeilen aus vergleichen()): { rel, wesentlich } ; ohne --kern die groesste wesentliche
function kernZeile(r, kern) {
  if (kern) { const z = r.zeilen.find((x) => x.k === kern); return z ? { k: z.k, rel: z.rel, delta: z.delta, wesentlich: z.wesentlich } : { k: kern, rel: null, delta: null, wesentlich: false }; }
  const w = r.zeilen.filter((x) => x.wesentlich).sort((p, q) => q.score - p.score)[0];
  return w ? { k: w.k, rel: w.rel, delta: w.delta, wesentlich: true } : null;
}
// Der Tuning-Pfad steht im Kopf des Vergleichs (nur wenn beide Seiten ein tuning/<hash>.json haben)
// (Zahlenschluessel stehen im Vergleich als crewScaling[3].x)
const tuningGenannt = (text, pfad) => text.replace(/\[(\w+)\]/g, '.$1').includes(pfad.split('.').slice(-2).join('.'));

async function probe(o, tmp, log) {
  const aus = { pfad: o.pfad, faktor: o.faktor, vorher: configWert(o.pfad), seeds: o.seeds, gruppen: [] };
  if (typeof aus.vorher !== 'number') throw new Error(o.pfad + ' ist in shared/config.js keine Zahl (gefunden: ' + typeof aus.vorher + ')');
  fs.mkdirSync(tmp, { recursive: true });
  const vorlade = path.join(tmp, 'vorlade.js');
  fs.writeFileSync(vorlade, VORLADE, 'utf8');
  const nodeOpt = '--require=' + JSON.stringify(vorlade.split(path.sep).join('/'));
  const fehlerEnv = { NODE_OPTIONS: nodeOpt, RUECKPROBE_PFAD: o.pfad, RUECKPROBE_FAKTOR: String(o.faktor), RUECKPROBE_CONFIG: CONFIG };
  const sauberEnv = { NODE_OPTIONS: null, RUECKPROBE_PFAD: null, RUECKPROBE_FAKTOR: null, RUECKPROBE_CONFIG: null };
  const seeds = Array.from({ length: o.seeds }, (_, i) => i + 1);
  const kontrollSeeds = Array.from({ length: o.seeds }, (_, i) => 101 + i);
  const tuningDir = path.join(tmp, 'tuning');
  fs.mkdirSync(tuningDir, { recursive: true });
  const tuningSammeln = (ordner) => {   // alle tuning/<hash>.json der Laeufe an einen Ort: dort findet sie der Vergleich
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const t = path.join(ordner, e.name, 'tuning');
      if (fs.existsSync(t)) for (const f of fs.readdirSync(t)) { try { fs.copyFileSync(path.join(t, f), path.join(tuningDir, f)); } catch (x) { /* egal */ } }
    }
  };
  for (const id of o.gruppen) {
    const g = Basis.GRUPPEN.find((x) => x.id === id);
    const slug = id.replace(/[^A-Za-z0-9_-]/g, '_');
    log('Gruppe ' + id + ': Fehler, Referenz, Kontrolle (' + 3 * o.seeds + ' Laeufe)');
    const fehler = await laufSatz(g, seeds, path.join(tmp, slug, 'fehler'), fehlerEnv, o.jobs);
    const ref = await laufSatz(g, seeds, path.join(tmp, slug, 'ref'), sauberEnv, o.jobs);
    const kont = await laufSatz(g, kontrollSeeds, path.join(tmp, slug, 'kontrolle'), sauberEnv, o.jobs);
    for (const s of [fehler, ref, kont]) tuningSammeln(s.ordner);
    const schlecht = [].concat(fehler.ergebnisse, ref.ergebnisse, kont.ergebnisse).filter((r) => r.fehler);
    const vopt = { tuningDir: [tuningDir] };
    const erg = { id, schlechte: schlecht.map((r) => r.gruppe.id + '#' + r.seed + ': ' + r.fehler) };
    // a) Basis gegen Fehler (ohne --kern gilt die groesste wesentliche Aenderung hier als Kernkennzahl der Gruppe, auch fuer b und c)
    const a = Vergleich.vergleichen('basis:' + id, fehler.ordner, vopt);
    const kern = o.kern || (kernZeile(a, null) || {}).k || null;
    erg.a = { wesentlich: a.wesentlich, kern: kernZeile(a, kern), tuningPfad: tuningGenannt(a.text, o.pfad), text: a.text, n: a.b.n };
    // c) Basis gegen Kontrolle (Fehlalarme)
    const c = Vergleich.vergleichen('basis:' + id, kont.ordner, vopt);
    erg.c = { wesentlich: c.wesentlich, kern: kernZeile(c, kern), wesentlicheKennzahlen: c.zeilen.filter((z) => z.wesentlich).map((z) => z.k), n: c.b.n };
    // b) Lauf gegen Lauf, dieselbe Seed (ohne gegen mit Fehler) und als Rauschmass Referenz s gegen Kontrolle 100+s (andere Seed, beide ohne Fehler)
    const dirVon = (s, seed) => path.join(s.ordner, slug + '-s' + seed);
    erg.b = { seeds: [], rauschen: [] };
    for (const s of seeds) {
      if (fehler.ergebnisse.find((r) => r.seed === s && r.fehler) || ref.ergebnisse.find((r) => r.seed === s && r.fehler)) continue;
      const r = Vergleich.vergleichen(dirVon(ref, s), dirVon(fehler, s), vopt);
      erg.b.seeds.push({ seed: s, wesentlich: r.wesentlich, kern: kernZeile(r, kern), text: s === seeds[0] ? r.text : undefined });
      if (!kont.ergebnisse.find((x) => x.seed === 100 + s && x.fehler)) {
        const q = Vergleich.vergleichen(dirVon(ref, s), dirVon(kont, 100 + s), vopt);
        erg.b.rauschen.push({ seed: s, wesentlich: q.wesentlich, kern: kernZeile(q, kern) });
      }
    }
    aus.gruppen.push(erg);
    log('  a) ' + erg.a.wesentlich + ' wesentlich, c) ' + erg.c.wesentlich + ' wesentlich, b) Seeds mit Abweichung ' + erg.b.seeds.filter((x) => x.wesentlich > 0).length + '/' + erg.b.seeds.length);
  }
  return aus;
}

function bericht(aus, o) {
  const name = o.name || (o.pfad + ' x' + String(o.faktor).replace('.', ','));
  const z = ['# Rueckwaertsprobe: ' + name, '',
    '- Fehler: `' + aus.pfad + '` (' + aus.vorher + ' x ' + String(aus.faktor).replace('.', ',') + ' = ' + Math.round(aus.vorher * aus.faktor * 1e6) / 1e6 + '), ' + aus.seeds + ' Seeds je Gruppe; Kernkennzahl: ' + (o.kern ? '`' + o.kern + '`' : 'die groesste wesentliche') + '.',
    '- a) Gruppe gegen Gruppe (Basis gegen n Fehlerlaeufe); b) Lauf gegen Lauf, dieselbe Seed ohne und mit Fehler; c) Kontrolle ohne Fehler, Seeds 101.., gegen die Basis (Fehlalarme).',
    '- b) Rauschen: dieselbe Zaehlung fuer Referenz-Seed s gegen Kontroll-Seed 100+s (beide ohne Fehler).', '',
    '| Gruppe | Methode | wesentliche Kennzahlen | Kernkennzahl (Median der Aenderung) | Tuning-Pfad im Kopf |', '|---|---|---|---|---|'];
  for (const g of aus.gruppen) {
    const k = (x) => (x && x.kern ? '`' + x.kern.k + '` ' + prozent(x.kern.rel) + (x.kern.wesentlich ? ' (wesentlich)' : '') : '-');
    z.push('| `' + g.id + '` | a) Basis gegen Fehler (' + g.a.n + ') | ' + g.a.wesentlich + ' | ' + k(g.a) + ' | ' + (g.a.tuningPfad ? 'ja' : 'nein') + ' |');
    const bw = g.b.seeds.map((x) => x.wesentlich);
    const bk = median(g.b.seeds.map((x) => (x.kern ? x.kern.rel : null)));
    const mit = g.b.seeds.filter((x) => x.wesentlich > 0).length;
    z.push('| `' + g.id + '` | b) Lauf gegen Lauf (' + g.b.seeds.length + ' Seeds) | Median ' + median(bw) + ' [' + Math.min(...bw) + '-' + Math.max(...bw) + '], ' + mit + ' von ' + bw.length + ' Seeds mit mindestens 1 | ' + (g.b.seeds[0] && g.b.seeds[0].kern ? '`' + g.b.seeds[0].kern.k + '` ' : '') + prozent(bk) + ' | - |');
    const rw = g.b.rauschen.map((x) => x.wesentlich);
    if (rw.length) z.push('| `' + g.id + '` | b0) Rauschen: andere Seed, kein Fehler (' + rw.length + ') | Median ' + median(rw) + ' [' + Math.min(...rw) + '-' + Math.max(...rw) + '], ' + rw.filter((v) => v > 0).length + ' von ' + rw.length + ' mit mindestens 1 | ' + prozent(median(g.b.rauschen.map((x) => (x.kern ? x.kern.rel : null)))) + ' | - |');
    z.push('| `' + g.id + '` | c) Kontrolle ohne Fehler gegen Basis (' + g.c.n + ') | ' + g.c.wesentlich + (g.c.wesentlicheKennzahlen.length ? ' (' + g.c.wesentlicheKennzahlen.join(', ') + ')' : '') + ' | ' + k(g.c) + ' | - |');
  }
  for (const g of aus.gruppen) if (g.schlechte.length) z.push('', '> [!warning] Laeufe ohne gueltige Session in `' + g.id + '`: ' + g.schlechte.join('; '));
  return z.join('\n') + '\n';
}

async function main() {
  let o;
  try { o = optionen(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  const tmp = o.aus ? path.resolve(o.aus) : fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-rueckprobe-'));
  let aus;
  try { aus = await probe(o, tmp, (t) => console.log(t)); } catch (e) { console.error('Rueckprobe fehlgeschlagen: ' + e.message); return 2; }
  const text = bericht(aus, o);
  fs.writeFileSync(path.join(tmp, 'rueckprobe.md'), text, 'utf8');
  fs.writeFileSync(path.join(tmp, 'rueckprobe.json'), JSON.stringify(aus), 'utf8');
  process.stdout.write('\n' + text);
  console.log('Ergebnis: ' + path.join(tmp, 'rueckprobe.md') + (o.aus || o.behalten ? '' : ' (wird geloescht, --aus oder --behalten behaelt es)'));
  if (!o.aus && !o.behalten) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ } }
  return aus.gruppen.some((g) => g.schlechte.length) ? 1 : 0;
}

if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error('Rueckprobe fehlgeschlagen: ' + e.message); process.exit(2); });
module.exports = { optionen, probe, bericht, VORLADE };
