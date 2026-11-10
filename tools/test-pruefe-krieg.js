'use strict';
// FRE-04: Test des Prüfwerkzeugs tools/pruefe-krieg.js – schnell, offline, ohne Browser, ohne LLM.
//   node tools/test-pruefe-krieg.js
// 1. Reine Logik an einem selbst konstruierten Beispiel: Besitzwechsel, Art, Funk-Zuordnung (Fenster, Name, Verb), Karte-Verzug, Lückenbilanz.
// 2. Kleiner Lauf (20 Ticks, --ohne-bilder): Aufbau der Ergebnisdatei, Szenario-Env (Rückfall, kein Live), Ausgabe nur im Laufordner.
// 3. CLI: Radius-Lauf bleibt im Radius, gleicher Seed gleicher Verlauf, --out im Repo abgelehnt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const PK = require('./pruefe-krieg.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-pk-'));
const repo = path.join(__dirname, '..');

// ------------------------------------------------------------------------------------------------ 1. reine Logik
console.log('Reine Logik');
ok(PK.art('-', 'rP') === 'gruendung' && PK.art('rP', '-') === 'verlust' && PK.art('gP', 'rP') === 'eroberung' && PK.art('r', 'rP') === 'postenaenderung', 'Art des Besitzwechsels: Gründung, Verlust, Eroberung, Postenänderung');
{
  const w = PK.besitzwechsel(7, 1.0, { A: 'r', B: 'gP', C: '-' }, { A: 'r', B: 'rP', C: 'kP' });
  ok(w.length === 2 && w[0].hex === 'B' && w[0].art === 'eroberung' && w[1].hex === 'C' && w[1].art === 'gruendung' && w.every((x) => x.tick === 7), 'Besitzwechsel nur dort, wo sich der Stand ändert');
}
// konstruiertes Beispiel: 4 Fälle, davon genau zwei ohne Funk
const ticksBsp = [];
for (let t = 0; t <= 30; t++) {
  ticksBsp.push({
    tick: t, min: t / 7.5,
    wahr: { H1: t < 10 ? 'gP' : 'rP', H2: t < 20 ? 'rP' : 'gP', H3: t < 5 ? '-' : 'rP', H4: 'k' },
    // Rom sieht H1 erst ab Tick 11 (ein Tick Verzug), H2 nie, H3 sofort, H4 stimmt
    wissen: { H1: (t < 11 ? 'gP' : 'rP') + '@1', H2: 'rP@5', H3: (t < 5 ? '-' : 'rP') + '@0', H4: 'k@?' },
  });
}
const bsp = {
  seed: 1, radius: null, lauf: { ticks: 30, minuten: 4, besuchteHexe: 3 }, bildticks: [0, 20],
  namen: { H1: 'Skjaldborg', H2: 'Ulfsvakt', H3: 'Gasfeld', H4: 'Kon' },
  besitzwechsel: [
    { tick: 5, min: 0.7, hex: 'H3', von: '-', nach: 'rP', art: 'gruendung' },
    { tick: 10, min: 1.3, hex: 'H1', von: 'gP', nach: 'rP', art: 'eroberung' },
    { tick: 20, min: 2.7, hex: 'H2', von: 'rP', nach: 'gP', art: 'eroberung' },
  ],
  ereignisse: [
    { tick: 10, min: 1.3, typ: 'hafen_gefallen', ort: 'H1', alt: 'ger', neu: 'rom' },
    { tick: 20, min: 2.7, typ: 'posten_verloren', ort: 'H2', besitzer: 'rom', durch: 'ger' },
    { tick: 12, min: 1.6, typ: 'flotte_sammelt', ort: 'H4' },
  ],
  funk: [
    { tick: 11, min: 1.4, von: 'HAFEN SKJALDBORG', text: 'Skjaldborg ist gefallen.', lage: true },   // im Fenster (Tick 10 + 1): meldet H1
    { tick: 25, min: 3.3, von: 'HAFEN ULFSVAKT', text: 'Posten Ulfsvakt verloren.', lage: true },   // 5 Ticks nach dem Fall: außerhalb des Fensters
    { tick: 20, min: 2.7, von: 'FLOTTE', text: 'Germanische Flotte sammelt sich bei Ulfsvakt.', lage: true },   // nennt H2, aber kein Verb des Falls
    { tick: 5, min: 0.7, von: 'HÄNDLER', text: 'Gasfeld wirkt ruhig.', lage: false },   // nennt H3, meldet keine Gründung
  ],
  chronik: [{ t: 10, min: 1.3, art: 'welt', ref: 'H1', kurz: 'Hafen gefallen: Skjaldborg (ger an rom)' }],
  ticks: ticksBsp,
};
const b = PK.bilanzBauen(bsp);
ok(b.zaehlung.hafenfall.n === 1 && b.zaehlung.hafenfall.mitFunk === 1 && b.zaehlung.hafenfall.ohneFunk === 0, 'Hafenfall mit Funk im Fenster erkannt');
ok(b.zaehlung.postenverlust.n === 1 && b.zaehlung.postenverlust.mitFunk === 0 && b.zaehlung.postenverlust.ohneFunk === 1, 'Postenverlust mit Funk ausserhalb des Fensters ist eine Lücke');
ok(b.zaehlung.besitzwechsel.n === 3 && b.zaehlung.besitzwechsel.mitFunk === 1 && b.zaehlung.besitzwechsel.ohneFunk === 2, 'Besitzwechsel: 3 Fälle, nur der Hafenfall gefunkt (Flottenfunk und Händlerfunk ohne Verb zählen nicht)');
ok(b.luecken.length === 3 && b.luecken.map((l) => l.tick + l.art).join() === '5besitzwechsel,20besitzwechsel,20postenverlust' || b.luecken.map((l) => l.tick + ':' + l.art).sort().join() === '20:besitzwechsel,20:postenverlust,5:besitzwechsel', 'Lückenliste: Gründung Tick 5, Eroberung und Postenverlust Tick 20');
{
  const hf = b.faelle.find((f) => f.art === 'hafenfall');
  ok(hf.funk && hf.funk.tick === 11 && hf.chronik && hf.chronik.t === 10, 'Fall trägt Funk (Tick 11) und Chronik (Tick 10)');
  ok(hf.karteAb === 11 && hf.karteVerzug === 1, 'Karte von Rom zeigt den Hafenfall mit einem Tick Verzug');
  const l2 = b.luecken.find((l) => l.hex === 'H2' && l.art === 'besitzwechsel');
  ok(l2 && l2.karteAb === null, 'Lücke ohne Funk, die auch die Karte nie zeigt, ist als solche erkennbar (karteAb null)');
  ok(b.zaehlung.postenverlust.ohneFunkUndKarteNie === 1 && b.zaehlung.besitzwechsel.ohneFunkUndKarteNie === 1, 'Zählung „ohne Funk und Karte nie“');
}
ok(b.sicht.rohEreignisse.flotte_sammelt === 1 && b.sicht.kriegsRohEreignisse === 3 && b.sicht.stande.t20 && b.sicht.stande.ende, 'Sichtauswertung: Roh-Ereignisse und Kartenstände');
{
  const s = b.sicht.stande.t20;
  ok(s.hexe === 4 && s.unbekannt === 1 && s.abweichung === 1 && s.richtigBekannt === 2, 'Kartenstand Tick 20: H2 falsch (Wissen alt), H4 nie gesehen, H1 und H3 richtig gesehen');
}
ok(PK.bilanzBauen(bsp, 0).zaehlung.hafenfall.mitFunk === 0, 'Fenster 0: der Funk eines Ticks später zählt nicht');
{
  const txt = PK.textBilanz(Object.assign({ lauf: bsp.lauf }, bsp), b), tv = PK.textVerlauf(bsp);
  ok(/Lücken \(Fälle ohne Funkmeldung\): 3/.test(txt) && /Gasfeld \(H3\)/.test(txt), 'bilanz.txt nennt die Lücken');
  ok(/Tick \| Minute \| Art/.test(tv) && /FUNK-LAGE/.test(tv) && /BESITZ/.test(tv) && /CHRONIK/.test(tv) && /KRIEG\s+\| hafen_gefallen/.test(tv), 'verlauf.txt: Tick, Minute, Ereignis, Funk, Chronik');
}

// ------------------------------------------------------------------------------------------------ 2. kleiner Lauf
console.log('Kleiner Lauf (20 Ticks, ohne Browser)');
(async () => {
  const out = path.join(root, 'a');
  const r = await PK.lauf({ seed: 7, ticks: 20, out, bilder: false });
  const v = JSON.parse(fs.readFileSync(path.join(r.dir, 'verlauf.json'), 'utf8'));
  ok(r.dir === path.join(out, 's7'), 'Laufordner <out>/s7');
  ok(v.format === 'pruefe-krieg/1' && v.seed === 7 && v.lauf.ticks === 20 && v.lauf.spruenge === 20 && v.ticks.length === 21, 'verlauf.json: Format, Seed, 20 Ticks, 20 Sprünge, 21 Tickstände (Start + je Sprung)');
  ok(v.ticks[0].tick === 0 && v.ticks[20].tick === 20 && Object.keys(v.ticks[0].wahr).length >= 20 && Object.keys(v.ticks[0].wissen).length >= 20, 'Tickstand trägt Wahrheit und Wissen je Hex');
  ok(Array.isArray(v.ticks[1].flotten) && Array.isArray(v.funk) && Array.isArray(v.chronik) && Array.isArray(v.ereignisse) && Array.isArray(v.besitzwechsel), 'Flotten, Funk, Chronik, Roh-Ereignisse und Besitzwechsel vorhanden');
  ok(v.bilanz && v.bilanz.zaehlung && Array.isArray(v.bilanz.luecken) && v.bilanz.sicht, 'Bilanz in der Ergebnisdatei');
  ok(v.lauf.fehler.server === 0 && v.lauf.fehler.sim === 0, 'keine Server- und Sim-Fehler');
  ok(v.szenario.FAEDEN === '1' && v.szenario.REISE_EREIGNISSE === '1' && v.szenario.LAGE_SPIELLEITER === '1' && v.szenario.SPIELLEITER_RUECKFALL === '1' && !v.szenario.LLM_LIVE && !v.szenario.SPIELLEITER_LLM, 'Szenario-Env des Servers: Rückfall-Spielleiter, Brett, Reise; kein Live, kein Mock');
  ok(['verlauf.txt', 'bilanz.txt', 'bilanz.json'].every((f) => fs.existsSync(path.join(r.dir, f))) && /^Verlauf Freie Fahrt Sund, Seed 7/.test(fs.readFileSync(path.join(r.dir, 'verlauf.txt'), 'utf8')), 'verlauf.txt, bilanz.txt, bilanz.json geschrieben');
  ok(v.lauf.mitschnitt && v.lauf.mitschnitt.startsWith(path.join(r.dir, 'mitschnitt')) && fs.existsSync(path.join(v.lauf.mitschnitt, 'verlauf.json')), 'Mitschnitt (MITSCHNITT=1) liegt im Laufordner');
  ok(process.env.MITSCHNITT_DIR === path.join(r.dir, 'mitschnitt') && process.env.TELEMETRIE_DIR === path.join(r.dir, 'telemetrie') && process.env.REGIE_DIR === path.join(r.dir, 'regie'), 'MITSCHNITT_DIR, TELEMETRIE_DIR, REGIE_DIR zeigen in den Laufordner');
  ok(!fs.existsSync(path.join(repo, 'data', 'mitschnitt', path.basename(v.lauf.mitschnitt))), 'nichts im Standardordner des Repos');

  // ---------------------------------------------------------------------------------------------- 3. CLI
  console.log('CLI');
  const cli = (args) => spawnSync(process.execPath, [path.join(__dirname, 'pruefe-krieg.js'), ...args], { cwd: repo, encoding: 'utf8', timeout: 120000 });
  const out2 = path.join(root, 'b');
  const c1 = cli(['--seed', '7', '--ticks', '20', '--ohne-bilder', '--out', out2]);
  ok(c1.status === 0 && /Besitzwechsel/.test(c1.stdout), 'CLI --ohne-bilder: Exit 0 und Zusammenfassung');
  const v2 = JSON.parse(fs.readFileSync(path.join(out2, 's7', 'verlauf.json'), 'utf8'));
  ok(JSON.stringify(v2.ticks.map((t) => t.wahr)) === JSON.stringify(v.ticks.map((t) => t.wahr)), 'gleicher Seed, gleicher Verlauf der Wahrheit (in-process und CLI)');
  const c2 = cli(['--seed', '7', '--ticks', '15', '--radius', '1', '--ohne-bilder', '--out', out2]);
  ok(c2.status === 0, 'CLI mit --radius 1: Exit 0');
  const v3 = JSON.parse(fs.readFileSync(path.join(out2, 's7-r1', 'verlauf.json'), 'utf8'));
  const Sektoren = require('../shared/sektoren.js');
  const erlaubt = new Set([v3.lauf.startHex, ...Sektoren.nachbarn(v3.lauf.startHex)]);
  ok(v3.radius === 1 && v3.ticks.length === 16 && v3.ticks.every((t) => erlaubt.has(t.lerche)), 'Radius 1: die Lerche bleibt auf dem Startort und seinen Nachbarn');
  const c3 = cli(['--seed', '7', '--ticks', '5', '--ohne-bilder', '--out', path.join(repo, 'tools', 'ausgabe-pruefe-krieg-test')]);
  ok(c3.status === 2 && !fs.existsSync(path.join(repo, 'tools', 'ausgabe-pruefe-krieg-test')), '--out im Repo wird abgelehnt (Exit 2, nichts angelegt)');
  const c4 = cli(['--seed', '7']);
  ok(c4.status === 2, 'ohne --out: Exit 2');

  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(fails ? `\n${fails} FEHLER` : '\nalles ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
