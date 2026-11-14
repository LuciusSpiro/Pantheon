'use strict';
// BEA-02 D: Referenztest Beispiel 2 (Notruf > Rettung > Abgabe) am ECHTEN System, mit dem echten Standardplan des Bretts (nichts eingespeist). tools/spiel-rettung.js --brett startet je Fall einen echten Server mit Bots
// (Rueckfall ohne Modell: FAEDEN=1, REISE_EREIGNISSE=1, LAGE_SPIELLEITER=1, SPIELLEITER_RUECKFALL=1): im Takt entsteht ein Katalog-Notruf, das Brett legt das Angebot an (notrufAnbieten, Plan aus notruf-brett.json, Ort-Art folgt
// dem Hex), die Crew nimmt am Brett an (Befehl abenteuer.annehmen), fliegt hin (Teleport), die Rettung entsteht, Ops scannt, die Crew waehlt den Landepunkt und beamt runter und hoch, die Ops holt drei Ueberlebende per Halteprozess
// an Bord, die Crew fliegt zur Station und gibt sie ab. Der Test startet den Laeufer je Fall EINZELN (nacheinander, nie parallel) und zaehlt aus der Messdatei (--json) selbst nach; das Urteil des Laeufers allein genuegt nie.
// Die Erwartungen stehen hier selbst (Daten gelesen: namen.json, boden-werte.json, notruf-brett.json), nie aus dem Produktivcode abgeleitet.
//   (a) Beispiel 2 Planet: Hex mit wildnis, Variante havarie (Ort-Art wildnis, ruhig), Crew 1 und Crew 3: ein Abstieg, drei Ueberlebende mit Namen aus der Namensliste ohne Doppelte, Betten 0 bis 2, Abgabe (Lager und Weltstand
//       schiff.fracht leer), Faden gelungen, Ort restlos weg, 0 Komponisten-Aufrufe, g.errors 0; Gedaechtnis rettung_gelungen im Weltstand, ein Wiedersehen greift den NSC auf, Nebenfiguren ohne Fadenzustand (Abnahme 6)
//   (b) Beispiel 2 Wrack: Hex nur mit schiff, Variante piratenueberfall (Besetzung raeuber: Gegner da, die Bots schiessen nicht), Crew 3
//   (c) Einzelne Beats: notruf ohne Landung und Rettung (Plan notruf > abschluss eingespeist, Hilfe per Funk, Faden endet gelungen, im Prozess ohne Server, Abnahme 1a); rettung an einem Wrack ohne vorherige Landung ist durch
//       tools/test-rettung-bot.js abgedeckt (Faelle an_bord-ruhig-1, abgegeben-raeuber-3, frist, frachtraum: Plan Geruecht > rettung(Landeplatz schiff) > abschluss; Abnahme 1c), hier nur die Belegpruefung der Datei
//   (d) Kette Notruf > landung > rettung > abschluss (Plan eingespeist, ein Landeplatz fuer beide, spiel-rettung.js --kette): landung endet beim ersten Hochbeamen gelungen, danach startet die Rettung am selben Ort, zweiter Abstieg,
//       Rettung, Abgabe, Faden gelungen, Ort restlos weg (der Standardplan nutzt die Kette nicht)
//   D  Aufruf: falsche Werte geben Exit 2        E  das Repo ist unberuehrt (git status wie vorher)
//   node tools/test-faden-beispiel2.js [--behalte <ordner>] [--fall <name,...>]      Faelle: planet-3, wrack-3, planet-1, kette-1, notruf     Mutationsprobe: tools/mutation-faden-beispiel2.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const args = process.argv.slice(2);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : undefined; };
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const BW = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'boden-werte.json'), 'utf8')).werte.besetzung.wert;
const VOELKER = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'namen.json'), 'utf8')).voelker;
const NAMENLISTE = new Set(); for (const v of Object.values(VOELKER)) for (const a of v.vornamen) for (const b of v.nachnamen) NAMENLISTE.add(a + ' ' + b);
const MIN_GEGNER = { ruhig: 0, raeuber: 1, belagerer: 2 };   // aus der Abnahme (Tabelle boden-werte.json: ruhig leer, raeuber Raubzug klein, belagerer Raubzug mittel)
const BESETZUNG = { havarie: 'ruhig', piratenueberfall: 'raeuber' };   // Besetzung je Variante, wie Kai sie bestimmt hat (notruf-brett.json besetzung_je_variante, unten gegen die Datei geprueft)
const tmp = wert('behalte') ? path.resolve(wert('behalte')) : fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-beispiel2-'));
fs.mkdirSync(tmp, { recursive: true });
const gitStatus = () => (cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout || '');
const statusVorher = gitStatus();
const lauf = (a) => new Promise((resolve) => {
  const t0 = Date.now();
  const p = cp.spawn(process.execPath, a, { cwd: ROOT, env: process.env });
  let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; });
  const t = setTimeout(() => { try { p.kill(); } catch (e) { /* egal */ } }, 240000);
  p.on('exit', (code) => { clearTimeout(t); resolve({ code, text: o, s: Math.round((Date.now() - t0) / 100) / 10 }); });
});
const lesen = (datei) => { try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { return null; } };
const fehlerZeilen = (r) => (r.code === 0 ? '' : '\n' + r.text.split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n'));
// Faelle (Laufzeit: je Lauf rund 40 bis 50 s, Budget 170 s: vier echte Server-Laeufe; die uebrigen Mischungen fahren von Hand: node tools/spiel-rettung.js --brett ...)
const BRETT = [
  { name: 'planet-3', variante: 'havarie', ort: 'wildnis', crew: 3, seed: 7 },
  { name: 'wrack-3', variante: 'piratenueberfall', ort: 'schiff', crew: 3, seed: 7 },
  { name: 'planet-1', variante: 'havarie', ort: 'wildnis', crew: 1, seed: 7 },
];
const NUR = wert('fall') ? wert('fall').split(',') : null;   // z. B. --fall planet-1 (Probe, Mutationsprobe)
const gewollt = (name) => !NUR || NUR.includes(name);
const ortWeg = (j) => j.orte.vor === 0 && j.orte.lauf >= 1 && j.orte.nach === 0 && j.orte.nachDetail.dyn.length === 0 && j.orte.nachDetail.scan.length === 0 && j.orte.nachDetail.aways.length === 0 && j.orte.nachDetail.awayMap === null;
const GRUNDLAUF = ['beginnt b1_notruf', 'endet b1_notruf', 'beginnt b2_rettung', 'endet b2_rettung', 'beginnt ende'];

// Pruefungen, die alle Abgabe-Faelle teilen: Faden, Personen, Abgabe, Ort, Aufrufe
function gemeinsam(j, verlaufSoll) {
  const g = j.faden.gedaechtnis;
  ok(j.faden.phase === 'abgeschlossen' && j.faden.ausgang === 'gelungen', `Faden abgeschlossen, Ausgang gelungen (${j.faden.phase}, ${j.faden.ausgang})`);
  const v = j.faden.verlauf.map((x) => x.replace(/ \(.*$/, ''));
  ok(JSON.stringify(v) === JSON.stringify(verlaufSoll), `Beats in der Reihenfolge ${verlaufSoll.filter((x) => /^beginnt/.test(x)).map((x) => x.replace('beginnt ', '').replace(/^b\d_/, '')).join(' > ')} (${v.join(' > ')})`);
  ok(g.includes('rettung_gelungen') && g.includes('notruf_gelungen') && g.includes('abschluss_gelungen') && !g.some((e) => /_gescheitert$/.test(e)), `Gedaechtnis: alles gelungen, nichts gescheitert (${g.join(', ')})`);
  const namen = j.personen.map((p) => p.name);
  ok(j.amOrtStart === 3 && j.personen.length === 3 && new Set(namen).size === 3 && namen.every((x) => NAMENLISTE.has(x)), `3 Ueberlebende, Namen aus der Namensliste, ohne Doppelte: ${namen.join(', ')}`);
  ok(namen[0] === j.nsc, `Ueberlebender 1 ist der Faden-NSC (${j.nsc})`);
  ok(JSON.stringify(j.personen.map((p) => p.bett).sort()) === '[0,1,2]', `Betten 0 bis 2 (${j.personen.map((p) => p.bett).join(',')})`);
  ok(j.halteSek.length === 3 && j.halteSek.every((s) => s >= 2.5), `Aufnahme je Person ein Halteprozess (${j.halteSek.join(', ')} s)`);
  const ereignisse = j.boden.map((e) => e.k);
  ok(ereignisse.filter((x) => x === 'personAnBord').length === 3 && ereignisse.filter((x) => x === 'npcRescued').length === 3, 'je Person npcRescued und personAnBord (Haken)');
  ok(j.abgegeben.length === 3 && ereignisse.filter((x) => x === 'personAbgegeben').length === 3, 'Abgabe an der Station: drei personAbgegeben');
  ok(j.lagerPersonenNachher === 0 && j.lagerNachher === 0 && Array.isArray(j.weltFracht) && j.weltFracht.length === 0, `Lager leer (${j.lagerNachher} Eintraege), Weltstand schiff.fracht leer (${JSON.stringify(j.weltFracht)})`);
  ok(ortWeg(j), `Ort restlos weg: Orte ${j.orte.vor} vorher, ${j.orte.lauf} im Lauf, ${j.orte.nach} nachher (lpScan, aways, away.map leer)`);
  ok(j.komponistenAufrufe === 0 && j.errors === 0, `0 Komponisten-Aufrufe (${j.komponistenAufrufe}), g.errors ${j.errors}`);
}

(async () => {
  const NB = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'notruf-brett.json'), 'utf8')).werte;
  section('D  Aufruf: falsche Werte');
  {
    const r1 = await lauf(['tools/spiel-rettung.js', '--brett', '--variante', 'belagerung', '--ort', 'wildnis']);
    const r2 = await lauf(['tools/spiel-rettung.js', '--brett', '--variante', 'havarie', '--ort', 'hoehle']);
    const r3 = await lauf(['tools/spiel-rettung.js', '--brett', '--variante', 'havarie', '--ort', 'wildnis', '--besetzung', 'belagerer']);
    const r4 = await lauf(['tools/spiel-rettung.js', '--brett', '--variante', 'havarie', '--ort', 'wildnis', '--crew', '2']);
    const r5 = await lauf(['tools/spiel-rettung.js', '--kette', '--besetzung', 'ruhig', '--ende', 'an_bord']);
    ok(r1.code === 2 && /Aufruf/.test(r1.text), 'unbekannte Variante: Exit 2');
    ok(r2.code === 2, 'unbekannte Ort-Art: Exit 2');
    ok(r3.code === 2, 'Besetzung und Brett gleichzeitig (die Besetzung folgt der Variante): Exit 2');
    ok(r4.code === 2, 'Crew 2 (laut Steckbrief bei Bots instabil) wird nicht gefahren: Exit 2');
    ok(r5.code === 2, 'Kette mit Ende an_bord (die Kette gibt ab): Exit 2');
  }
  ok(Object.keys(NB.besetzung_je_variante.wert).every((v) => !BESETZUNG[v] || NB.besetzung_je_variante.wert[v] === BESETZUNG[v]) && NB.landeplatz_arten.wert.join() === 'wildnis,schiff', 'Erwartung gegen notruf-brett.json gelesen (havarie ruhig, piratenueberfall raeuber, Ort-Arten wildnis, schiff)');
  ok(Object.keys(BW).sort().join() === Object.keys(MIN_GEGNER).sort().join() && Object.keys(BW.ruhig).length === 0 && BW.raeuber.fraktion === 'raubzug', 'Erwartung gegen die Tabelle boden-werte.json gelesen (ruhig leer, raeuber Raubzug)');
  ok(NAMENLISTE.size > 20, `Namensliste namen.json gelesen (${NAMENLISTE.size} Namen)`);

  for (const fl of BRETT) {
    if (!gewollt(fl.name)) continue;
    const datei = path.join(tmp, fl.name + '.json');
    const r = await lauf(['tools/spiel-rettung.js', '--brett', '--variante', fl.variante, '--ort', fl.ort, '--crew', String(fl.crew), '--seed', String(fl.seed), '--json', datei]);
    const j = lesen(datei);
    section(`${fl.ort === 'wildnis' ? '(a) Beispiel 2 Planet' : '(b) Beispiel 2 Wrack'}: Variante ${fl.variante}, Crew ${fl.crew}, Seed ${fl.seed} (${r.s} s)`);
    ok(r.code === 0 && !!j, 'Laeufer Exit 0' + fehlerZeilen(r));
    if (!j) continue;
    const b = j.brett || {};
    const bes = BESETZUNG[fl.variante];
    ok(j.kuenstlich['plan-eingespeist'] === undefined && j.kuenstlich['katalog-einengen'] === 1 && j.kuenstlich.teleport === 3, `echter Standardplan, nichts eingespeist; kuenstlich nur Takt und Teleport (${JSON.stringify(j.kuenstlich)})`);
    ok(b.variante === fl.variante && b.plan === 'notruf,rettung,abschluss' && b.endeAmBeat === 'abgegeben' && b.absicht === 'bergung', `Angebot des Bretts: Variante ${b.variante}, Plan ${b.plan}, ende ${b.endeAmBeat}, Absicht ${b.absicht}`);
    const wild = (b.artenImHex || []).includes('wildnis');
    ok(fl.ort === 'wildnis' ? wild : (!wild && (b.artenImHex || []).includes('schiff')), `Hex ${b.notrufHex} (Arten ${(b.artenImHex || []).join('/')}): ${fl.ort === 'wildnis' ? 'kennt wildnis (Planet)' : 'kennt nur das Wrack im Raum'}`);
    ok(b.landeplatzArt === (wild ? 'wildnis' : 'schiff') && j.ortArt === b.landeplatzArt && j.ortArt === fl.ort, `Ort-Art folgt dem Hex: bestellt ${b.landeplatzArt}, entstanden ${j.ortArt} (Soll ${fl.ort})`);
    ok(b.besetzungAmBeat === bes && j.besetzung === bes, `die Besetzung folgt der Variante: ${b.besetzungAmBeat} (Soll ${bes})`);
    gemeinsam(j, GRUNDLAUF);
    const sollUnten = fl.crew === 1 ? 1 : 2;
    const downs = j.boden.filter((e) => e.k === 'beamedDown'), ups = j.boden.filter((e) => e.k === 'beamedUp');
    ok(j.unten === sollUnten && downs.length === 1 && ups.length === 1 && downs[0].n === sollUnten && ups[0].n === sollUnten && !ups.some((e) => e.notrueckholung), `ein Abstieg: unten waren ${j.unten} von ${fl.crew} Bots, einmal runter, einmal hoch, ohne Notrueckholung`);
    ok(j.gegner === 0 ? bes === 'ruhig' : bes !== 'ruhig' && j.gegner >= MIN_GEGNER[bes], `Gegner am Ort: ${j.gegner} (Soll ${bes === 'ruhig' ? '0' : 'mindestens ' + MIN_GEGNER[bes]}), Arten ${j.gegnerArten || '-'}`);
    const ge = j.gedaechtnisErg || {};
    ok(ge.imWeltstand >= 1 && ge.rettungGelungen === true, `Weltstand: der Faden-NSC steht mit Gedaechtnis rettung_gelungen (${ge.imWeltstand} Eintrag/Eintraege)`);
    ok(ge.wiedersehenFunk === true, 'ein Wiedersehen greift den Geretteten auf (Funk wiedersehen_rettung_gelungen)');
    ok((ge.nebenfiguren || []).length === 2 && ge.nebenfigurenMitZustand === 0 && j.personen.slice(1).every((p) => (ge.nebenfiguren || []).includes(p.name)), `Nebenfiguren (${(ge.nebenfiguren || []).join(', ')}) ohne Fadenzustand`);
  }

  if (gewollt('kette-1')) {
    const datei = path.join(tmp, 'kette-1.json');
    const r = await lauf(['tools/spiel-rettung.js', '--kette', '--besetzung', 'raeuber', '--ende', 'abgegeben', '--crew', '1', '--seed', '7', '--json', datei]);
    const j = lesen(datei);
    section(`(d) Kette Notruf > landung > rettung > abschluss, raeuber, Crew 1, Seed 7 (${r.s} s)`);
    ok(r.code === 0 && !!j, 'Laeufer Exit 0' + fehlerZeilen(r));
    if (j) {
      ok(j.kuenstlich['plan-eingespeist'] === 1, 'der Plan ist eingespeist (der Standardplan des Bretts nutzt landung nicht)');
      gemeinsam(j, ['beginnt b1_notruf', 'endet b1_notruf', 'beginnt b2_landung', 'endet b2_landung', 'beginnt b3_rettung', 'endet b3_rettung', 'beginnt ende']);
      ok(j.faden.gedaechtnis.includes('landung_gelungen') && j.kette && j.kette.landungGelungen === true && /b2_landung gelungen/.test(j.faden.verlauf.join(' ')), `landung endet beim ersten Hochbeamen gelungen (${j.faden.gedaechtnis.join(', ')})`);
      ok(j.kette && j.kette.selberOrt === true && j.orte.lauf >= 1, 'die Rettung startet am selben Ort wie die Landung');
      const downs = j.boden.filter((e) => e.k === 'beamedDown'), ups = j.boden.filter((e) => e.k === 'beamedUp');
      ok(downs.length === 2 && ups.length === 2 && downs.every((e) => e.n === 1) && ups.every((e) => e.n === 1 && !e.notrueckholung), `zwei Abstiege: ${downs.length}x runter, ${ups.length}x hoch, ohne Notrueckholung`);
      ok(j.kette && j.kette.gegnerLandung >= MIN_GEGNER.raeuber && j.gegner >= MIN_GEGNER.raeuber, `die Besetzung der Variante steht bei Landung und Rettung (Gegner ${j.kette && j.kette.gegnerLandung} bei der Landung, ${j.gegner} bei der Rettung, Arten ${j.gegnerArten || '-'})`);
    }
  }

  if (gewollt('notruf')) {
    section('(c) Einzelne Beats: notruf ohne Landung und Rettung (Hilfe per Funk, der Faden endet)');
    try { await notrufAlleine(); } catch (e) { ok(false, 'Ausnahme: ' + (e && e.stack)); }
    const rb = fs.readFileSync(path.join(ROOT, 'tools', 'test-rettung-bot.js'), 'utf8');
    ok(/an_bord-ruhig-1/.test(rb) && /abgegeben-raeuber-3/.test(rb) && /name: 'frist'|gewollt\('frist'\)/.test(rb) && /frachtraum/.test(rb) && /rettung/.test(rb), 'Beleg: rettung an einem Wrack ohne vorherige Landung deckt tools/test-rettung-bot.js ab (Plan Geruecht > rettung > abschluss, Faelle an_bord, abgegeben, frist, frachtraum)');
  }

  section('E  Repo unberuehrt');
  ok(gitStatus() === statusVorher, 'nichts im Repo veraendert (git status wie vorher)');
  if (!wert('behalte') && !fails) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ } } else console.log('\nAblage: ' + tmp);
  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) console.log('FEHLER: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER Ausnahme: ' + (e && e.stack)); process.exit(1); });

// (c) notruf allein, im Prozess (kein Server, kein Bot): Plan notruf > abschluss eingespeist (eine Spur in Daten), angenommen am Brett, Ankunft am Hex, der Rueckfall fuehrt den Faden zum Abschluss.
// Der Beat notruf ist die Hilfe per Funk (Funktext der Ankunft); es gibt weder Landeplatz noch Ort noch Rettung, der Faden endet gelungen.
async function notrufAlleine() {
  const F = require('./regie-fixture.js');
  const Sektoren = require('../shared/sektoren.js');
  const space = require('../server/sim/space.js');
  const Faden = require('../server/sim/faden.js');
  const Brett = require('../server/sim/abenteuer-brett.js');
  const AO = require('../server/sim/abenteuer-orte.js');
  const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };
  const T = F.neuesSpiel({ crew: 1, seed: 7, env: ENV }), g = T.g;
  const fehler = []; const ce = g.countError.bind(g); g.countError = (wo, e) => { fehler.push(wo + ': ' + (e && e.message)); return ce(wo, e); };
  const funk = []; const em = g.emit.bind(g); g.emit = (ev, d) => { if (ev === 'radio' && d && d.text) funk.push(d.text); return em(ev, d); };
  const hafen = Sektoren.hexVonOrt(g.ship.scene);
  const ziel = Object.keys(Sektoren.KARTE.hexe).filter((h) => h !== hafen && Sektoren.spielbar(h) && !Sektoren.istLeerraum(h) && Sektoren.hatSzene(h)).sort()[0];
  const plan = { format: 'faden-bauplan/1', titel: 'Hilfe per Funk', anlass: 'Ein Schiff ruft um Hilfe, die Crew antwortet per Funk.', beats: [{ typ: 'notruf' }, { id: 'ende', typ: 'abschluss' }] };
  const a = Faden.abenteuerAnbieten(g, plan, { hex: ziel });
  ok(a.ok === true, 'Plan notruf > abschluss eingespeist (Pruefer: keine Landeplaetze noetig)' + (a.ok ? '' : ': ' + (a.fehler || [a.grund]).join('; ')));
  if (!a.ok) return;
  ok(Brett.annehmen(g, 'a' + a.angebot.nr) === null, 'Annehmen am Brett');
  const f = Faden.zustandVon(g).liste.find((x) => x.vorlage === a.angebot.ref);
  for (let i = 0; i < 25 && !(f.phase === 'laeuft' && f.laufend); i++) { g.lageGrenze('andocken'); for (let k = 0; k < 20; k++) g.step(); }
  ok(f.phase === 'laeuft', `der Beat notruf laeuft (Phase ${f.phase})`);
  space.enterScene(g, Sektoren.ortVonHex(ziel), { docked: false });
  for (let i = 0; i < 80 && f.phase !== 'abgeschlossen'; i++) { g.lageGrenze('andocken'); for (let k = 0; k < 20; k++) g.step(); }
  const ged = f.nsc.gedaechtnis.map((e) => e.ereignis);
  ok(f.phase === 'abgeschlossen' && f.ausgang && f.ausgang.art === 'gelungen', `der Faden endet gelungen (Phase ${f.phase}, Ausgang ${f.ausgang && f.ausgang.art})`);
  ok(ged.includes('notruf_gelungen') && !ged.some((e) => /^(landung|rettung)_/.test(e)), `Gedaechtnis ohne Landung und Rettung (${ged.join(', ')})`);
  const dyn = Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).filter((i) => AO.parse(i));
  ok(dyn.length === 0 && !AO.parse(g.away && g.away.map) && Object.keys(g.aways || {}).filter((i) => AO.parse(i)).length === 0, 'kein Ort entstanden (kein Landeplatz, kein Abstieg)');
  ok(funk.length >= 2, `Hilfe per Funk: ${funk.length} Funkzeilen (z. B. "${String(funk[funk.length - 1]).slice(0, 50)}")`);
  const aufrufe = g.lageSpielleiter ? (g.lageSpielleiter.aufrufe || 0) + ((g.lageSpielleiter.abenteuer && g.lageSpielleiter.abenteuer.aufrufe) || 0) : 0;
  ok(aufrufe === 0 && g.errors === 0 && fehler.length === 0, `0 Komponisten-Aufrufe (${aufrufe}), g.errors ${g.errors}, gezaehlte Fehler ${fehler.length}${fehler.length ? ' (' + fehler[0] + ')' : ''}`);
}
