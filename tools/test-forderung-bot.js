'use strict';
// BEA-01 D: Bot-Wege der Forderung am echten Server (tools/spiel-forderung.js, Bot-Schalter --wahl in tools/lib/bot-beats.js und tools/live-abend.js). Der Test startet den Laeufer, liest je Weg die Belege (<weg>.json)
// und prueft sie mit EIGENER Zaehlung (Preise, Bussgeld und Ruf aus den Datendateien gelesen, Beat-Folgen hier hart notiert), nie nur das Urteil des Laeufers:
//   A  ausliefern: Ware nach dem Laden da, am Ende aus dem Frachtraum, Faden gescheitert, keine Enthuellung, keine Invasion, keine Marken
//   B  verweigern: Beat raumschlacht (b_kampf), Marken bis zum Kampf unveraendert, Ware bleibt bis zur Ablieferung, Enthuellung, Invasion; Seed 601: der Kern lehnt die Invasion ab (Enthuellung ohne Invasion)
//   C  bestechen: Marken um den Preis der Daten gesenkt, kein b_kampf, Ablieferung, Enthuellung, Invasion
//   D  Durchsuchung mit Schmuggelware: Tiefe voll (offene und getarnte Ware weg), Tiefe scan (getarnte bleibt), sauberer Frachtraum (nichts), Bestechen beim Zoll (Marken, Ware bleibt); Bussgeld und Ruf nach den Daten, die echte Art nie im Funk
//   E  Aufrufe: --wahl in live-abend (Exit 2 bei falschen Werten), Laeufer (Exit 2 bei unbekanntem Weg), --wahl unbekannt: Rueckfall wie bisher (annehmen, sonst die erste Option)
//   F  der Mitschnitt (MIT-01) je Weg ist geschrieben; nichts im Repo (git status unveraendert)
//   node tools/test-forderung-bot.js [--weg a,b] [--behalte <ordner>]      Mutationsprobe: tools/mutation-forderung-bot.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const args = process.argv.slice(2);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : undefined; };
const lies = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);

const FW = lies('content', 'faeden', 'forderung-werte.json').werte;
const FT = lies('content', 'faeden', 'forderung-texte.json');
const RUF = lies('content', 'welt', 'ruf-werte.json').werte.quellen.wert;
const PREIS_MITTEL = FW.bestechung_marken.wert.mittel;     // 90: Staerke mittel (Freibeuter, Zollschiff der Vorlage)
const BUSSE_MITTEL = FW.bussgeld_marken.wert.mittel;       // 30 je Platz
const FUND_DELTA = RUF[FW.fund_ruf.wert.rom].delta;        // Ruf-Abzug eines Funds (Rom)
const MARKEN0 = 500;
const KETTE_VOLL = ['b_bitte', 'b_fracht', 'b_forderung', 'b_schmier', 'b_kampf', 'b_abgabe', 'b_enthuell', 'b_jagd', 'b_schlacht', 'b_abschluss'];

const NUR = wert('weg') ? wert('weg').split(',') : null;
const gewollt = (w) => !NUR || NUR.includes(w);
const tmp = wert('behalte') ? path.resolve(wert('behalte')) : fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-forderung-bot-'));
fs.mkdirSync(tmp, { recursive: true });
const gitStatus = () => (cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout || '');
const statusVorher = gitStatus();
const lauf = (a, cwd) => new Promise((resolve) => {
  const p = cp.spawn(process.execPath, a, { cwd: cwd || ROOT, env: process.env });
  let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; });
  const t = setTimeout(() => { try { p.kill(); } catch (e) { /* egal */ } }, 600000);
  p.on('exit', (code) => { clearTimeout(t); resolve({ code, text: o }); });
});
const J = (w) => { try { return lies(path.relative(ROOT, path.join(tmp, w + '.json'))); } catch (e) { return null; } };
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  // ---------------- E (schnell, ohne Server): Aufrufe
  section('E  Aufrufe: --wahl und unbekannte Wege');
  {
    const r1 = await lauf(['tools/live-abend.js', '--mock', '--wahl', 'Gross!', '--out', path.join(tmp, 'nie')]);
    ok(r1.code === 2 && /--wahl/.test(r1.text) && !fs.existsSync(path.join(tmp, 'nie')), 'live-abend --wahl mit ungueltigen Zeichen: Exit 2, Meldung, nichts angelegt');
    const r2 = await lauf(['tools/live-abend.js', '--mock', '--wahl', '', '--out', path.join(tmp, 'nie')]);
    ok(r2.code === 2 && /--wahl/.test(r2.text), 'live-abend --wahl ohne Wert: Exit 2');
    const r3 = await lauf(['tools/spiel-forderung.js', '--weg', 'gibt_es_nicht', '--out', path.join(tmp, 'nie')]);
    ok(r3.code === 2 && /Unbekannter Weg/.test(r3.text), 'spiel-forderung mit unbekanntem Weg: Exit 2');
    const src = fs.readFileSync(path.join(ROOT, 'tools', 'lib', 'bot-beats.js'), 'utf8');
    const la = fs.readFileSync(path.join(ROOT, 'tools', 'live-abend.js'), 'utf8');
    ok(/opts\.wahl \|\| \[\]/.test(src) && /off\.optionen\.find\(\(o\) => o\.id === 'annehmen'\) \|\| off\.optionen\[0\]/.test(src), 'Bot: ohne --wahl gilt wie bisher "annehmen, sonst die erste Option"');
    ok(/wahl: o\.wahl/.test(la) && /kind\.push\('--wahl'/.test(la), 'live-abend reicht --wahl an den Abend (Kindprozess) und an den Bot weiter');
    // kein Beat- oder Absichtsname im Servercode (Daten): die Wahl-Ids stehen nur in tools/, nie in server/
    const serverDateien = []; const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) geh(q); else if (/\.js$/.test(e.name)) serverDateien.push(q); } };
    geh(path.join(ROOT, 'server'));
    const treffer = serverDateien.filter((f) => /['"`](nicht_ausliefern|nicht_dulden|verweigern|bestechen|dulden)['"`]/.test(fs.readFileSync(f, 'utf8')));
    ok(treffer.length === 0, 'kein Wahl-Id-Name im Servercode (Grep: nicht_ausliefern, nicht_dulden, verweigern, bestechen, dulden)' + (treffer.length ? ': ' + treffer.map((f) => path.relative(ROOT, f)).join(', ') : ''));
  }

  // ---------------- die Laeufe (parallel)
  const alle = ['ausliefern', 'verweigern', 'verweigern_kern_lehnt_ab', 'bestechen', 'durchsuchung_voll', 'durchsuchung_scan', 'durchsuchung_sauber', 'zoll_bestechen'].filter(gewollt);
  const lf = alle.length ? await lauf(['tools/spiel-forderung.js', '--weg', alle.join(','), '--parallel', '4', '--out', tmp, '--mitschnitt-dir', path.join(tmp, 'mit')]) : { code: 0, text: '' };
  section('Laeufer: ' + alle.join(', '));
  ok(lf.code === 0, 'spiel-forderung.js Exit 0' + (lf.code === 0 ? '' : '\n' + lf.text.split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 12).join('\n')));
  const uebers = path.join(tmp, 'uebersicht.md');
  ok(!alle.length || (fs.existsSync(uebers) && alle.every((w) => fs.readFileSync(uebers, 'utf8').includes('| ' + (J(w) || { titel: '?' }).titel + ' |'))), 'Uebersichtstabelle: eine Zeile je Weg');

  if (gewollt('ausliefern')) {
    section('A  ausliefern: Ware weg, Faden gescheitert, keine Enthuellung, keine Invasion');
    const j = J('ausliefern');
    ok(!!j && gleich(j.beats, ['b_bitte', 'b_fracht', 'b_forderung', 'b_abschluss']), 'Beats: Bitte, Laden, Forderung, Abschluss (' + (j && j.beats.join(' > ')) + ')');
    ok(!!j && j.ware_nach_laden && j.ware_nach_laden.lager === j.lager.vorher + 1, 'nach dem Laden liegt die Ware im Frachtraum (' + (j && j.ware_nach_laden && j.ware_nach_laden.lagerText) + ')');
    ok(!!j && j.lager.nachher === j.lager.vorher, 'am Ende ist die Ware aus dem Frachtraum (' + (j && j.lager.vorher) + ' -> ' + (j && j.lager.nachher) + ')');
    ok(!!j && /abgeschlossen, Ausgang gescheitert/.test(j.belege.faden) && j.gedaechtnis.includes('forderung_gescheitert'), 'Faden gescheitert, Gedaechtnis forderung_gescheitert (' + (j && j.belege.faden) + ')');
    ok(!!j && j.invasion === false && j.enthuellung === false, 'keine Enthuellung, keine Invasion');
    ok(!!j && j.marken.nachher === MARKEN0 && j.marken.vorher === MARKEN0, 'Ausliefern kostet keine Marken');
    ok(!!j && gleich(j.wahl, ['annehmen', 'ausliefern']), 'Rangfolge des Bots: annehmen, ausliefern');
  }
  if (gewollt('verweigern')) {
    section('B  verweigern: Kampf (raumschlacht), Ablieferung, Enthuellung, Invasion');
    const j = J('verweigern');
    ok(!!j && gleich(j.beats, KETTE_VOLL), 'Beats: alle zehn in der Reihenfolge der Vorlage (' + (j && j.beats.join(' > ')) + ')');
    ok(!!j && j.marken_bei_beat.b_schmier === MARKEN0 && j.marken_bei_beat.b_kampf === MARKEN0 && j.marken_bei_beat.b_abgabe >= MARKEN0, 'Verweigern kostet nichts: Marken bis zum Kampf ' + (j && j.marken_bei_beat.b_kampf));
    ok(!!j && j.lager.nachher === j.lager.vorher && j.gedaechtnis.includes('schmiergeld_gescheitert') && j.gedaechtnis.includes('raumschlacht_gelungen') && j.gedaechtnis.includes('fracht_gelungen'), 'Ware beim Haendler abgeliefert nach dem Kampf (' + (j && j.gedaechtnis) + ')');
    ok(!!j && j.enthuellung === true && j.invasion === true && /abgeschlossen, Ausgang gelungen/.test(j.belege.faden), 'Enthuellung und Invasion, Faden gelungen (' + (j && j.belege.invasion) + ')');
    const k = J('verweigern_kern_lehnt_ab');
    ok(!!k && gleich(k.beats, KETTE_VOLL) && k.enthuellung === true && k.invasion === false && /sim_befehl_abgelehnt/.test(fs.readFileSync(path.join(tmp, 'verweigern_kern_lehnt_ab.txt'), 'utf8')), 'Seed 601: die Enthuellung kommt, der Kern lehnt die Invasion ab (zu schwach), keine Invasion');
  }
  if (gewollt('bestechen')) {
    section('C  bestechen: Marken weg, kein Kampf, Ablieferung, Enthuellung, Invasion');
    const j = J('bestechen');
    ok(!!j && gleich(j.beats, KETTE_VOLL.filter((b) => b !== 'b_kampf')), 'Beats: ohne b_kampf (' + (j && j.beats.join(' > ')) + ')');
    ok(!!j && j.marken_bei_beat.b_schmier === MARKEN0 && j.marken_bei_beat.b_abgabe === MARKEN0 - PREIS_MITTEL, `Marken abgebucht: ${MARKEN0} -> ${j && j.marken_bei_beat.b_abgabe} (Preis ${PREIS_MITTEL} aus forderung-werte.json)`);
    ok(!!j && j.lager.nachher === j.lager.vorher && j.gedaechtnis.includes('schmiergeld_gelungen') && j.gedaechtnis.includes('fracht_gelungen'), 'Ware beim Haendler abgeliefert (' + (j && j.gedaechtnis) + ')');
    ok(!!j && j.enthuellung === true && j.invasion === true && /abgeschlossen, Ausgang gelungen/.test(j.belege.faden), 'Enthuellung und Invasion, Faden gelungen (' + (j && j.belege.invasion) + ')');
  }
  if (['durchsuchung_voll', 'durchsuchung_scan', 'durchsuchung_sauber', 'zoll_bestechen'].some(gewollt)) {
    section('D  Durchsuchung: Schmuggelware gefunden (getarnte nur bei Tiefe voll), sauber, Bestechen beim Zoll');
    const v = J('durchsuchung_voll'), s = J('durchsuchung_scan'), r = J('durchsuchung_sauber'), z = J('zoll_bestechen');
    if (gewollt('durchsuchung_voll')) {
      ok(!!v && v.lager.vorher === 3 && v.lager.nachher === 1 && /hilfsgueter/.test(v.lager.text_nachher) && !/waffen|sprengstoff/.test(v.lager.text_nachher), 'voll: Sprengstoff (offen) UND Waffen (getarnt) beschlagnahmt, die Hilfsgueter bleiben (' + (v && v.lager.text_nachher) + ')');
      ok(!!v && v.marken.nachher === MARKEN0 - 2 * BUSSE_MITTEL, `voll: Bussgeld ${BUSSE_MITTEL} je Platz, zwei Plaetze: ${v && v.marken.nachher}`);
      ok(!!v && v.ruf_rom.nachher === v.ruf_rom.vorher + FUND_DELTA && FUND_DELTA < 0, `voll: Ruf Rom ${v && v.ruf_rom.vorher} -> ${v && v.ruf_rom.nachher} (Delta ${FUND_DELTA} aus ruf-werte.json, einmal je Durchsuchung)`);
      ok(!!v && gleich(v.beats, ['b_forderung', 'b_abschluss']), 'voll: Beats Forderung, Abschluss (kein Kampf)');
    }
    if (gewollt('durchsuchung_scan')) {
      ok(!!s && s.lager.vorher === 3 && s.lager.nachher === 2 && /waffen\(getarnt als fracht\)/.test(s.lager.text_nachher) && !/sprengstoff/.test(s.lager.text_nachher), 'scan: nur der offene Sprengstoff weg, die getarnten Waffen bleiben getarnt an Bord (' + (s && s.lager.text_nachher) + ')');
      ok(!!s && s.marken.nachher === MARKEN0 - BUSSE_MITTEL && s.ruf_rom.nachher === s.ruf_rom.vorher + FUND_DELTA, `scan: Bussgeld fuer EINEN Platz (${BUSSE_MITTEL}), Ruf ${FUND_DELTA}`);
    }
    if (gewollt('durchsuchung_sauber')) {
      ok(!!r && r.lager.vorher === 1 && r.lager.nachher === 1 && r.marken.nachher === MARKEN0 && r.ruf_rom.nachher === r.ruf_rom.vorher, 'sauber: nichts beschlagnahmt, kein Bussgeld, kein Ruf-Abzug');
      ok(!!r && fs.readFileSync(path.join(tmp, 'durchsuchung_sauber.txt'), 'utf8').includes(FT.durchsuchung.sauber), `sauber: der Zoll meldet "${FT.durchsuchung.sauber}"`);
    }
    if (gewollt('zoll_bestechen')) {
      ok(!!z && z.marken.nachher === MARKEN0 - PREIS_MITTEL && z.lager.nachher === z.lager.vorher && z.ruf_rom.nachher === z.ruf_rom.vorher, `Zoll bestechen: ${PREIS_MITTEL} Marken, Schmuggelware bleibt, Ruf unveraendert`);
      ok(!!z && gleich(z.beats, ['b_forderung', 'b_schmier', 'b_abschluss']) && /Ausgang gelungen/.test(z.belege.faden), 'Zoll bestechen: Beats Forderung, Schmiergeld, Abschluss; Faden gelungen, kein Kampf');
    }
    // Tarnung: die echte Art der getarnten Ware steht in keiner Funkzeile (Funk der Crew)
    for (const w of ['durchsuchung_voll', 'durchsuchung_scan', 'zoll_bestechen'].filter(gewollt)) {
      const t = fs.readFileSync(path.join(tmp, w + '.txt'), 'utf8').split('\n').filter((l) => /\sFUNK\s/.test(l));
      ok(t.length > 0 && !t.some((l) => /waffen/i.test(l)), `${w}: ${t.length} Funkzeilen, keine nennt die echte Art der getarnten Ware`);
    }
  }
  if (gewollt('ausliefern')) {
    section('E2 --wahl wirkt, unbekannte Id faellt auf das alte Verhalten zurueck');
    const [rf, ue] = await Promise.all([
      lauf(['tools/spiel-forderung.js', '--weg', 'ausliefern', '--wahl', 'gibt_es_nicht', '--out', path.join(tmp, 'rueckfall')]),
      lauf(['tools/spiel-forderung.js', '--weg', 'ausliefern', '--wahl', 'annehmen,nicht_ausliefern,bestechen', '--out', path.join(tmp, 'umgewaehlt')]),
    ]);
    const jr = (() => { try { return lies(path.relative(ROOT, path.join(tmp, 'rueckfall', 'ausliefern.json'))); } catch (e) { return null; } })();
    const ju = (() => { try { return lies(path.relative(ROOT, path.join(tmp, 'umgewaehlt', 'ausliefern.json'))); } catch (e) { return null; } })();
    ok(rf.code === 0 && !!jr && gleich(jr.beats, ['b_bitte', 'b_fracht', 'b_forderung', 'b_abschluss']), 'unbekannte Id: wie bisher (annehmen, sonst die erste Option = ausliefern): dieselbe Folge wie der Weg ausliefern');
    ok(ue.code === 1 && !!ju && ju.beats.includes('b_schmier') && ju.beats.includes('b_abgabe') && ju.invasion === true, 'andere Rangfolge: der Bot geht einen anderen Weg (Schmiergeld, Abgabe, Invasion), die Erwartung des Wegs ausliefern wird verfehlt (Exit 1)');
  }
  if (alle.length) {
    section('F  Belege: jeder Weg mit Urteil ok, Mitschnitt geschrieben, Repo unberuehrt');
    for (const w of alle) { const j = J(w); ok(!!j && j.ok === true && j.abweichungen.length === 0 && j.pruefungen.length >= 6, `${w}: Urteil ok (${j ? j.pruefungen.length : 0} Pruefungen)`); }
    const mitDirs = fs.existsSync(path.join(tmp, 'mit')) ? fs.readdirSync(path.join(tmp, 'mit')) : [];
    ok(alle.every((w) => mitDirs.includes(w)), 'Mitschnitt (MIT-01) je Weg angelegt: ' + mitDirs.length + ' Ordner');
    const mds = []; const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) geh(q); else if (e.name === 'mission.md') mds.push(q); } };
    if (fs.existsSync(path.join(tmp, 'mit'))) geh(path.join(tmp, 'mit'));
    ok(mds.length >= alle.length && mds.every((f) => fs.statSync(f).size > 200), `je Weg eine mission.md (${mds.length} gefunden)`);
    ok(gitStatus() === statusVorher, 'nichts im Repo veraendert (git status wie vorher)');
  }
  if (!wert('behalte') && !fails) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ } } else console.log('\nAblage: ' + tmp);
  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER Ausnahme: ' + (e && e.stack)); process.exit(1); });
