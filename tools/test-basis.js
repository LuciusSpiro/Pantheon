'use strict';
// TEL-01 C: Test der Basis (tools/basis.js, tools/auswertung/basis.js) und der Basis-Bewertung (bewertung.js: abweichungGegenBasisGruppe, plattformZeile).
//   1. Statistik und Gruppenschluessel mit von Hand gerechneten Werten.
//   2. Gruppe bauen: Zaehleinheiten fehlen = 0, Quoten fehlen = kein Wert, Technik (determ: false) nicht in der Basis; Dateiformat ohne Listen; Gueltigkeitspruefung.
//   3. Schwelle mit konstruierten Werten: drinnen, knapp draussen, Spanne Min/Max, Streuung, Mindestmenge, determ: false.
//   4. Plattform-Datenzeile (Basis von anderer Plattform) und Gruppenwahl im Bericht (Spielerzahl zaehlt, "keine passende Basis-Gruppe").
//   5. Zwei Kleinlaeufe: tools/basis.js baut aus 3 Laeufen eine Basis-Datei (Format, Statistik, Bericht); ein frischer Lauf mit anderer Seed vergleicht gegen die Gruppe.
//   6. Gueltigkeit der EINGECHECKTEN Basis (tools/fixtures/telemetrie/basis-win32-x64.json): Kennzahl-Version, Info-Eintrag je Kennzahl, Groesse. Rot heisst: `npm run basis` neu fahren.
//   node tools/test-basis.js   (npm run test:basis; Mutationsprobe: tools/mutation-auswertung.js; AUSWERTUNG_SCHNELL=1 laesst 5 und die Bot-Laeufe aus)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { infoZu, KENNZAHL_VERSION } = require('./auswertung/kennzahlen.js');
const Bewertung = require('./auswertung/bewertung.js');
const Basis = require('./auswertung/basis.js');
const { bericht } = require('./auswertung/bericht.js');
const { auswerten } = require('./auswerten.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const gleich = (a, b, t) => ok(JSON.stringify(a) === JSON.stringify(b), t + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' (ist ' + JSON.stringify(a) + ', soll ' + JSON.stringify(b) + ')'));
const section = (t) => console.log('\n' + t);
const SCHNELL = !!process.env.AUSWERTUNG_SCHNELL;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-basis-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });

// ===================== 1. Statistik, Gruppenschluessel =====================
section('1. Statistik und Gruppenschluessel');
gleich(Basis.statistik([5, 1, 3, 2, 4]), [5, 1, 2, 3, 4, 5], 'Statistik 1..5 (unsortiert): n, min, q1, median, q3, max');
gleich(Basis.statistik([1, 2, 3, 4]), [4, 1, 1.75, 2.5, 3.25, 4], 'Statistik 1..4: Quantile mit linearer Interpolation');
gleich(Basis.statistik([7]), [1, 7, 7, 7, 7, 7], 'Statistik eines Wertes');
ok(Basis.statistik([]) === null && Basis.statistik([NaN, null]) === null, 'Statistik ohne Zahlen: null');
gleich(Basis.statistik([0, 0, 0, 10]), [4, 0, 0, 0, 2.5, 10], 'Streuung: IQR = q3 - q1 = 2,5 bei einem Ausreisser');
const K3 = { modus: 'arena_graben', szenario: null, spielerzahl: 3 };
gleich(Basis.gruppenId(K3), 'arena_graben/3', 'Gruppen-ID ohne Szenario');
gleich(Basis.gruppenId({ modus: 'arena_away', szenario: 'kesh', spielerzahl: 1 }), 'arena_away/kesh/1', 'Gruppen-ID mit Szenario (Karte der Wellen)');
ok(Basis.gruppenId(K3) !== Basis.gruppenId(Object.assign({}, K3, { spielerzahl: 1 })), 'Spielerzahl gehoert zur Gruppen-ID (solo und zu dritt sind verschiedene Gruppen)');

// ===================== 2. Gruppe bauen, Format, Gueltigkeit =====================
section('2. Gruppe bauen, Dateiformat, Gueltigkeitspruefung');
// Kennzahlen-Objekte von Hand: Quote (%), Zaehler (n), Technik (determ: false), Seed i
const kzVon = (i, opt) => ({
  version: KENNZAHL_VERSION, kopf: Object.assign({ modus: 'arena_graben', szenario: null, spielerzahl: 3, plattform: 'win32-x64', quelle: 'bot' }, opt && opt.kopf),
  f1: { dauer: { session: 100 + i } }, f2: { quote: { boden: { lanze: 40 + 5 * i } }, kills: { boden: { gesamt: 10 + i } } },
  f3: i === 2 ? { gefallen: { n: 1 } } : {}, f6: { tick: { med: 0.1 + i / 100, max: 5 + i } },
});
const laeufe = [0, 1, 2, 3, 4].map((i) => ({ seed: i + 1, kz: kzVon(i), ausgang: i === 4 ? 'rot' : 'ok' }));
const g = Basis.gruppeBauen(laeufe, { name: 'Test' });
gleich(g.id, 'arena_graben/3', 'Gruppe: ID');
gleich(g.seeds, [1, 2, 3, 4, 5], 'Gruppe: Seeds');
gleich(g.ausgang, { ok: 4, rot: 1 }, 'Gruppe: Ausgang gezaehlt');
gleich(g.kz['f2.quote.boden.lanze'], [5, 40, 45, 50, 55, 60], 'Quote: Statistik ueber die 5 Seeds');
gleich(g.kz['f3.gefallen.n'], [5, 0, 0, 0, 0, 1], 'Zaehler (n), der in 4 von 5 Laeufen fehlt: fehlende Laeufe zaehlen als 0');
gleich(g.kz['f2.kills.boden.gesamt'], [5, 10, 11, 12, 13, 14], 'Zaehler: Statistik');
ok(!('f6.tick.med' in g.kz) && !('f6.tick.max' in g.kz), 'Technik (determ: false) steht nicht in der Basis');
// Quote, die nur in 2 Laeufen vorkommt: n = 2, kein Auffuellen mit 0
const laeufeQ = [0, 1, 2].map((i) => { const k = kzVon(i); if (i === 1) delete k.f2.quote; return { seed: i + 1, kz: k }; });
gleich(Basis.gruppeBauen(laeufeQ, {}).kz['f2.quote.boden.lanze'], [2, 40, 42.5, 45, 47.5, 50], 'Quote fehlt in einem Lauf: n = 2, nicht mit 0 aufgefuellt');
const datei = Basis.basisBauen({ [g.id]: g }, { plattform: 'win32-x64', commit: 'abc', spielstand_wie: 'f2daff7' });
gleich(Object.keys(datei), ['version', 'kopf', 'gruppen'], 'Datei: version, kopf, gruppen');
gleich(datei.kopf.kennzahl_version, KENNZAHL_VERSION, 'Datei: Kennzahl-Version im Kopf');
ok(!/listen|reihen/.test(JSON.stringify(datei)), 'Datei: keine listen.reihen und keine Listen');
gleich(Basis.pruefen(datei), [], 'Gueltigkeit: frisch gebaute Basis ist gueltig');
const alt = JSON.parse(JSON.stringify(datei)); alt.kopf.kennzahl_version = KENNZAHL_VERSION + 1;
ok(Basis.pruefen(alt).some((p) => /Kennzahl-Version/.test(p)), 'Gueltigkeit: falsche Kennzahl-Version wird gemeldet');
const fremd = JSON.parse(JSON.stringify(datei)); fremd.gruppen['arena_graben/3'].kz['f9.gibt_es.nicht'] = [1, 1, 1, 1, 1, 1];
ok(Basis.pruefen(fremd).some((p) => /f9\.gibt_es\.nicht.*keinen Info-Eintrag/.test(p)), 'Gueltigkeit: Kennzahl ohne Info-Eintrag wird gemeldet');
const tech = JSON.parse(JSON.stringify(datei)); tech.gruppen['arena_graben/3'].kz['f6.tick.med'] = [1, 1, 1, 1, 1, 1];
ok(Basis.pruefen(tech).some((p) => /nicht deterministische Kennzahl f6\.tick\.med/.test(p)), 'Gueltigkeit: Technik in der Basis wird gemeldet');
const schief = JSON.parse(JSON.stringify(datei)); schief.gruppen['arena_graben/3'].kz['f1.dauer.session'] = [5, 9, 1, 5, 6, 7];
ok(Basis.pruefen(schief).some((p) => /nicht geordnet/.test(p)), 'Gueltigkeit: ungeordnete Statistik wird gemeldet');

// ===================== 3. Schwelle =====================
section('3. Schwelle gegen die Basis-Gruppe (konstruierte Werte)');
// Quote in %: Mindestmenge 10, rel 25 %. Statistik [n, min, q1, med, q3, max]
const gr = (kz) => ({ id: 't', laeufe: 12, kz });
const kzMit = (o) => ({ version: KENNZAHL_VERSION, kopf: { modus: 'x', spielerzahl: 3 }, f1: {}, f2: o.f2 || {}, f3: o.f3 || {}, f6: o.f6 || {} });
const flag = (stat, wert, key) => {
  key = key || 'f2.quote.boden.lanze';
  const teile = key.split('.');
  const o = {}; let c = o; for (let i = 1; i < teile.length - 1; i++) c = c[teile[i]] = {}; c[teile[teile.length - 1]] = wert;
  const kz = kzMit({ [teile[0]]: o });
  return Bewertung.abweichungGegenBasisGruppe(kz, gr({ [key]: stat })).liste.map((x) => x.k);
};
const Q = [12, 40, 45, 50, 55, 60];   // IQR 10 -> Normalbereich max(25 % von 50 = 12,5; 2 x 10 = 20) = 20 ueber die Spanne [40, 60] hinaus
gleich(flag(Q, 58), [], 'innerhalb [Min, Max]: nicht auffaellig');
gleich(flag(Q, 75), [], 'ausserhalb Max, aber nur 15 darueber (Normalbereich 20): nicht auffaellig');
gleich(flag(Q, 80), [], 'genau 20 ueber Max = Normalbereich: nicht auffaellig (ausserhalb heisst echt groesser)');
gleich(flag(Q, 80.5), ['f2.quote.boden.lanze'], 'knapp draussen (20,5 ueber Max): auffaellig');
gleich(flag(Q, 15), ['f2.quote.boden.lanze'], 'weit unter Min (25 darunter): auffaellig');
gleich(flag([12, 0, 45, 50, 55, 100], 80), [], 'innerhalb [Min, Max] = [0, 100], obwohl 30 vom Median: nicht auffaellig (Spanne der Basis-Seeds)');
gleich(flag([12, 0, 45, 50, 55, 100], 130), ['f2.quote.boden.lanze'], 'ausserhalb Max und 30 darueber (Normalbereich 20): auffaellig');
// Streuung: IQR 60 -> Normalbereich max(12,5; 120) = 120; 150 liegt 50 ueber Max (waere ohne Streuung auffaellig)
gleich(flag([12, 0, 20, 50, 80, 100], 150), [], 'grosse Streuung (IQR 60): 50 ueber Max < 2 x 60: nicht auffaellig (die Streuung weitet den Normalbereich)');
gleich(flag([12, 0, 20, 50, 80, 100], 230), ['f2.quote.boden.lanze'], 'grosse Streuung: 130 ueber Max > 120: auffaellig');
// Mindestmenge: Zaehler (n) hat min 3; Median 0, Streuung 0, Normalbereich 0
const N = [12, 0, 0, 0, 0, 1];
gleich(flag(N, 2, 'f3.gefallen.n'), [], 'Mindestmenge: 2 gegen Median 0 liegt ausserhalb der Spanne und des Normalbereichs 0, aber unter min 3: nicht auffaellig');
gleich(flag(N, 3, 'f3.gefallen.n'), ['f3.gefallen.n'], 'Mindestmenge erreicht (3): auffaellig');
// Nicht deterministisch (Technik): nie
{
  const kz = kzMit({ f6: { tick: { max: 500, med: 5 } } });
  const r = Bewertung.abweichungGegenBasisGruppe(kz, gr({ 'f6.tick.max': [12, 1, 1, 1, 1, 2], 'f6.tick.med': [12, 0.1, 0.1, 0.1, 0.1, 0.1] }));
  ok(r.liste.length === 0 && r.verglichen === 0, 'determ: false: Tickzeit wird nie gegen die Basis verglichen (auch nicht gezaehlt)');
  const einzel = Bewertung.abweichungen(kz, { f6: { tick: { max: 1, med: 0.1 } } });
  ok(einzel.liste.length === 0 && einzel.verglichen === 0, 'determ: false gilt auch im Einzellauf-Vergleich');
}
// Fehlende Kennzahl im Lauf: Zaehler = 0, Quote = ohne Wert (fehlt)
{
  const kz = kzMit({});
  const r = Bewertung.abweichungGegenBasisGruppe(kz, gr({ 'f3.gefallen.n': [12, 5, 5, 5, 5, 5], 'f2.quote.boden.lanze': Q }));
  gleich(r.liste.map((x) => x.k), ['f3.gefallen.n'], 'fehlender Zaehler im Lauf gilt als 0 (5 -> 0 ist auffaellig)');
  gleich([r.verglichen, r.fehlt], [1, 1], 'fehlende Quote zaehlt als "ohne Wert im Lauf", nicht als verglichen');
}
// Richtung und Gewicht: schlechter zaehlt mehr
{
  const kz = kzMit({ f3: { gefallen: { n: 9 } }, f2: { kills: { boden: { gesamt: 0 } } } });
  const r = Bewertung.abweichungGegenBasisGruppe(kz, gr({ 'f3.gefallen.n': [12, 0, 0, 0, 0, 1], 'f2.kills.boden.gesamt': [12, 8, 9, 10, 11, 12] }));
  ok(r.liste.length === 2 && r.liste[0].score >= r.liste[1].score, 'beide auffaellig, sortiert nach Gewicht (wichtigste zuerst)');
  ok(r.liste.find((x) => x.k === 'f3.gefallen.n').schlechter === true && r.liste.every((x) => x.min !== undefined && x.max !== undefined && x.n === 12), 'Eintraege tragen Richtung (mehr Gefallene = schlechter) sowie Min, Max, n der Basis');
}

// ===================== 4. Plattform-Datenzeile, Gruppenwahl =====================
section('4. Plattformzeile und Gruppenwahl');
const basisKopf = { plattform: 'win32-x64' };
gleich(Bewertung.plattformZeile({ kopf: { plattform: 'win32-x64' } }, basisKopf), [], 'gleiche Plattform: keine Zeile');
const pz = Bewertung.plattformZeile({ kopf: { plattform: 'linux-arm64' } }, basisKopf);
ok(pz.length === 1 && pz[0].name.startsWith('Basis von anderer Plattform, Raumkampf nicht bit-gleich, nur grob vergleichbar') && /win32-x64/.test(pz[0].name) && /linux-arm64/.test(pz[0].name), 'andere Plattform: eine Datenzeile mit dem vereinbarten Wortlaut und beiden Plattformen');
gleich(Bewertung.plattformZeile({ kopf: {} }, basisKopf), [], 'Lauf ohne Plattformangabe: keine Zeile (nichts zu vergleichen)');
{
  const kzArm = kzVon(1, { kopf: { plattform: 'linux-arm64' } });
  const b = Bewertung.bewerten(kzArm, { basisGruppe: Object.assign({}, g, { kopf: datei.kopf }) });
  ok(b.daten.some((d) => d.k === 'plattform'), 'bewerten: die Plattformzeile steht in den Daten');
  const text = bericht(kzArm, { basisGruppe: Object.assign({}, g, { kopf: datei.kopf }) });
  ok(/Daten: Basis von anderer Plattform, Raumkampf nicht bit-gleich, nur grob vergleichbar/.test(text), 'Bericht: Auffaelligkeit "Daten: Basis von anderer Plattform ..."');
  const gleichePl = bericht(kzVon(1), { basisGruppe: Object.assign({}, g, { kopf: datei.kopf }) });
  ok(!/andere[r]? Plattform/.test(gleichePl), 'Bericht auf gleicher Plattform: keine Plattformzeile');
  // Einzellauf-Basis traegt die Plattform im Kopf, dieselbe Regel
  const einz = Bewertung.bewerten(kzArm, { basis: { version: KENNZAHL_VERSION, kopf: { plattform: 'win32-x64' }, f1: {}, f2: {}, f3: {}, f6: {} } });
  ok(einz.daten.some((d) => d.k === 'plattform'), 'Einzellauf-Basis von anderer Plattform: ebenfalls die Datenzeile');
}
const g1 = Basis.gruppeBauen([0, 1, 2].map((i) => ({ seed: i, kz: kzVon(i, { kopf: { spielerzahl: 1 } }) })), {});
const dg = Basis.basisBauen({ [g.id]: g, [g1.id]: g1 }, { plattform: 'win32-x64' });
gleich(Basis.gruppeWaehlen(dg, { modus: 'arena_graben', szenario: null, spielerzahl: 3 }).id, 'arena_graben/3', 'Gruppenwahl: zu dritt -> Gruppe zu dritt');
gleich(Basis.gruppeWaehlen(dg, { modus: 'arena_graben', szenario: null, spielerzahl: 1 }).id, 'arena_graben/1', 'Gruppenwahl: solo -> Gruppe solo (die Spielerzahl entscheidet)');
ok(Basis.gruppeWaehlen(dg, { modus: 'arena_graben', szenario: null, spielerzahl: 2 }) === null, 'Gruppenwahl: zu zweit gibt es nicht -> null');
ok(Basis.gruppeWaehlen(dg, { modus: 'wellen', spielerzahl: 3 }) === null, 'Gruppenwahl: anderer Modus -> null');
{
  const kzZwei = kzVon(1, { kopf: { spielerzahl: 2 } });
  const text = bericht(kzZwei, { basisKeine: Basis.keineGruppe(dg, kzZwei.kopf) });
  ok(/Basis: keine passende Basis-Gruppe \(arena_graben\/2; vorhanden: arena_graben\/1, arena_graben\/3\)/.test(text), 'Bericht ohne passende Gruppe: "Basis: keine passende Basis-Gruppe (...)"');
  ok(!/Kennzahlen verglichen/.test(text), 'Bericht ohne passende Gruppe: kein Vergleich');
  const mit = bericht(kzVon(1), { basisGruppe: Object.assign({}, gdW(dg, kzVon(1))) });
  ok(/Basis: Gruppe arena_graben\/3 \(5 Läufe\), \d+ Kennzahlen verglichen/.test(mit), 'Bericht mit Gruppe: "Basis: Gruppe arena_graben/3 (5 Läufe), n Kennzahlen verglichen"');
}
function gdW(b, kz) { return Basis.gruppeWaehlen(b, kz.kopf); }

// ===================== 5. Zwei Kleinlaeufe =====================
if (SCHNELL) console.log('\n5. Kleinlaeufe: uebersprungen (AUSWERTUNG_SCHNELL)');
else {
  section('5. tools/basis.js: Basis aus 3 Kleinlaeufen, danach ein frischer Lauf gegen die Gruppe');
  const aus = path.join(TMP, 'klein', 'basis.json');
  const r = spawnSync(process.execPath, [path.join('tools', 'basis.js'), '--gruppen', 'm3/3', '--seeds', '3', '--jobs', '3', '--aus', aus], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
  ok(r.status === 0, 'basis.js: Exit 0 (' + r.status + ')' + (r.status ? '\n' + (r.stdout || '') + (r.stderr || '') : ''));
  if (fs.existsSync(aus)) {
    const b = JSON.parse(fs.readFileSync(aus, 'utf8'));
    const gk = b.gruppen['m3/3'];
    gleich(Object.keys(b.gruppen), ['m3/3'], 'Datei: genau die angeforderte Gruppe');
    ok(gk && gk.laeufe === 3 && JSON.stringify(gk.seeds) === '[1,2,3]', 'Gruppe m3/3: 3 Laeufe, Seeds 1,2,3');
    ok(b.kopf.plattform === process.platform + '-' + process.arch && b.kopf.spielstand_wie === 'f2daff7' && b.kopf.kennzahl_version === KENNZAHL_VERSION && /^[0-9a-f]{7,}$/.test(b.kopf.commit) && b.kopf.tuning_hash && b.kopf.node && b.kopf.datum && b.kopf.laufzeit_s >= 0 && b.kopf.seeds === 3, 'Kopf: Plattform, spielstand_wie, Kennzahl-Version, Commit, Tuning-Hash, Node, Datum, Laufzeit, Seeds');
    const s = gk && gk.kz['f1.dauer.session'];
    ok(Array.isArray(s) && s[0] === 3 && s[1] <= s[3] && s[3] <= s[5] && s[3] > 60, 'Dauer: Statistik ueber 3 Seeds, Median plausibel (' + JSON.stringify(s) + ')');
    gleich(Basis.pruefen(b), [], 'Gueltigkeit der Kleinlauf-Basis');
    ok(!/"listen"|"reihen"/.test(fs.readFileSync(aus, 'utf8')), 'Datei: keine Listen, keine Reihen');
    ok(!/f6\.tick\.(med|max)|f6\.snap/.test(fs.readFileSync(aus, 'utf8')), 'Datei: keine Technik-Kennzahlen');
    const md = fs.readFileSync(aus.replace(/\.json$/, '.md'), 'utf8');
    ok(/^# Basis-Bericht/.test(md) && /## m3\/3/.test(md) && /Median \[Min–Max\]/.test(md) && /f1|dauer\.session/.test(md), 'Basis-Bericht (Markdown) neben der Datei: Kopf, Abschnitt je Gruppe, Median [Min-Max]');
    const mdNeu = spawnSync(process.execPath, [path.join('tools', 'basis.js'), '--nur-md', '--aus', aus], { cwd: ROOT, encoding: 'utf8' });
    ok(mdNeu.status === 0 && fs.readFileSync(aus.replace(/\.json$/, '.md'), 'utf8') === md, '--nur-md erzeugt denselben Bericht aus der Datei');
    // frischer Lauf mit anderer Seed (101), Gruppenwahl und Bericht
    const dir = path.join(TMP, 'frisch');
    const f = spawnSync(process.execPath, [path.join('tools', 'sim-headless.js'), 'm3', '--seed', '101'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000, env: Object.assign({}, process.env, { TELEMETRIE: 'an', TELEMETRIE_DIR: dir }) });
    const prot = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')) : [];
    ok(prot.length === 1, 'Frischer Lauf (m3, Seed 101): genau eine Protokolldatei (' + prot.length + ', Exit ' + f.status + ')');
    if (prot.length === 1) {
      const A = auswerten(path.join(dir, prot[0]), { basis: aus, aus: path.join(TMP, 'b-frisch') });
      ok(/Basis: Gruppe m3\/3 \(3 Läufe\)/.test(A.text), 'Bericht (--basis <Basis-Datei>): Gruppe m3/3 gewaehlt');
      const A2 = auswerten(path.join(dir, prot[0]), { basis: 'keine', aus: path.join(TMP, 'b-keine') });
      ok(!/Basis: Gruppe/.test(A2.text) && !/keine passende/.test(A2.text), '--basis keine: kein Basis-Vergleich');
      const A3 = auswerten(path.join(dir, prot[0]), { aus: path.join(TMP, 'b-std') });
      ok(/Basis: Gruppe m3\/3 \(\d+ Läufe\)/.test(A3.text), 'Bericht ohne --basis: nimmt automatisch die eingecheckte Basis-Gruppe m3/3 (' + (A3.text.split('\n').find((l) => /^- Basis:/.test(l)) || '?') + ')');
      // andere Gruppe angefordert: Basis-Datei hat nur m3/3, der Lauf ist ein Wellen-Solo -> keine passende Gruppe
      const dir2 = path.join(TMP, 'frisch2');
      spawnSync(process.execPath, [path.join('tools', 'sim-headless.js'), 'wellen', '--karte', 'kesh', '--players', '1', '--seed', '101', '--seeds', '1'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000, env: Object.assign({}, process.env, { TELEMETRIE: 'an', TELEMETRIE_DIR: dir2 }) });
      const p2 = fs.existsSync(dir2) ? fs.readdirSync(dir2).filter((x) => x.endsWith('.jsonl')) : [];
      if (p2.length === 1) {
        const B = auswerten(path.join(dir2, p2[0]), { basis: aus, aus: path.join(TMP, 'b-wellen') });
        ok(/Basis: keine passende Basis-Gruppe \(arena_away\/kesh\/1; vorhanden: m3\/3\)/.test(B.text), 'Bericht: Wellen kesh solo gegen eine Basis ohne diese Gruppe -> "keine passende Basis-Gruppe"');
      } else ok(false, 'Wellen-Lauf: genau eine Protokolldatei');
    }
  }
}

// ===================== 6. Gueltigkeit der eingecheckten Basis =====================
section('6. Eingecheckte Basis (tools/fixtures/telemetrie/basis-win32-x64.json)');
const BASIS_DATEI = path.join(__dirname, 'fixtures', 'telemetrie', 'basis-win32-x64.json');
if (!fs.existsSync(BASIS_DATEI)) ok(false, 'Basis-Datei fehlt: `npm run basis` fahren und einchecken');
else {
  const roh = fs.readFileSync(BASIS_DATEI, 'utf8');
  const eb = JSON.parse(roh);
  const probleme = Basis.pruefen(eb);
  ok(probleme.length === 0, 'Basis gueltig' + (probleme.length ? ' – `npm run basis` neu fahren: ' + probleme.join('; ') : ' (Kennzahl-Version ' + eb.kopf.kennzahl_version + ', jede Kennzahl hat einen Info-Eintrag)'));
  ok(eb.kopf.kennzahl_version === KENNZAHL_VERSION, 'Kennzahl-Version der Basis (' + eb.kopf.kennzahl_version + ') = aktuelle (' + KENNZAHL_VERSION + ') – sonst `npm run basis` neu fahren');
  ok(Object.keys(eb.gruppen).every((id) => Object.keys(eb.gruppen[id].kz).every((k) => infoZu(k))), 'jede Kennzahl jeder Gruppe hat einen Info-Eintrag (KENNZAHL_INFO) – sonst `npm run basis` neu fahren');
  ok(eb.kopf.plattform === 'win32-x64' && eb.kopf.spielstand_wie === 'f2daff7', 'Kopf: Plattform win32-x64, Spielstand wie f2daff7');
  ok(roh.length < 300 * 1024, 'Groesse unter 300 KB (' + Math.round(roh.length / 1024) + ' KB)');
  ok(Object.keys(eb.gruppen).length >= 5 && Object.keys(eb.gruppen).every((id) => eb.gruppen[id].laeufe >= 6), 'mindestens 5 Gruppen, je mindestens 6 Laeufe');
  ok(!/"listen"|"reihen"/.test(roh), 'keine listen.reihen, keine Rohprotokolle');
  const md = path.join(__dirname, 'fixtures', 'telemetrie', 'basis-win32-x64.md');
  ok(fs.existsSync(md) && fs.readFileSync(md, 'utf8').replace(/\r\n/g, '\n') === Basis.basisMarkdown(eb), 'Basis-Bericht (.md) passt zur Datei (sonst `node tools/basis.js --nur-md`)');
}

console.log('\n' + n + ' Pruefungen, ' + fails + ' Fehler');
process.exit(fails ? 1 : 0);
