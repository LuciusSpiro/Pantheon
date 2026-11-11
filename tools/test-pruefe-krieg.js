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
    { tick: 13, min: 1.7, typ: 'flotte_marsch', ort: 'H4' },   // echter Typ der Sim: zählt
    { tick: 14, min: 1.8, typ: 'flotte_marschiert', ort: 'H4' }, { tick: 14, min: 1.8, typ: 'angriff_gestartet', ort: 'H4' },   // gibt es in der Sim nicht: zählt nicht
  ],
  funk: [
    { tick: 11, min: 1.4, von: 'HAFEN SKJALDBORG', text: 'Skjaldborg ist gefallen.', lage: true },   // im Fenster (Tick 10 + 1): meldet H1
    { tick: 25, min: 3.3, von: 'HAFEN ULFSVAKT', text: 'Posten Ulfsvakt verloren.', lage: true },   // 5 Ticks nach dem Fall: außerhalb des Fensters
    { tick: 20, min: 2.7, von: 'FLOTTE', text: 'Germanische Flotte sammelt sich bei Ulfsvakt.', lage: true },   // nennt H2, aber kein Verb des Falls
    { tick: 5, min: 0.7, von: 'HÄNDLER', text: 'Gasfeld wirkt ruhig.', lage: false },   // nennt H3, meldet keine Gründung
    { tick: 20, min: 2.7, von: 'HAFEN ULFSVAKT', text: 'Posten Anderswo verloren.', lage: true },   // Absender nennt H2, der Text einen anderen Ort: darf H2 nicht zuordnen (M3)
    { tick: 10, min: 1.3, von: 'FLOTTE', text: 'Anderswo ist gefallen.', lage: true },   // Verb, aber anderer Ort: darf H1 nicht zuordnen
  ],
  chronik: [{ t: 10, min: 1.3, art: 'welt', ref: 'H1', kurz: 'Hafen gefallen: Skjaldborg (ger an rom)' }, { t: 20, min: 2.7, art: 'welt', ref: 'H9', kurz: 'Posten gefallen: irgendwo' }],   // H9 ist nicht der Hex des Falls (Abgleich über ref)
  ticks: ticksBsp,
};
const b = PK.bilanzBauen(bsp);
ok(b.zaehlung.hafenfall.n === 1 && b.zaehlung.hafenfall.mitFunk === 1 && b.zaehlung.hafenfall.ohneFunk === 0, 'Hafenfall mit Funk im Fenster erkannt');
ok(b.zaehlung.postenverlust.n === 1 && b.zaehlung.postenverlust.mitFunk === 0 && b.zaehlung.postenverlust.ohneFunk === 1, 'Postenverlust mit Funk ausserhalb des Fensters ist eine Lücke');
ok(b.gesamt.besitzwechselGesamt === 3 && b.gesamt.faelle === 3 && b.zaehlung.besitzwechsel.n === 1 && b.zaehlung.besitzwechsel.ohneFunk === 1, 'N1: 3 Besitzwechsel, aber nur 3 Fälle; Hafenfall und Postenverlust schlucken ihren Besitzwechsel, übrig bleibt die Gründung (Flottenfunk und Händlerfunk ohne Verb zählen nicht)');
ok(b.faelle.filter((f) => f.hex === 'H1').length === 1 && b.faelle.find((f) => f.hex === 'H1').kind === 'eroberung', 'N1: Hafenfall H1 steht einmal da und kennt die Art des Wechsels (eroberung)');
ok(b.luecken.length === 2 && b.gesamt.luecken === 2 && b.luecken.map((l) => l.tick + ':' + l.art).sort().join() === '20:postenverlust,5:besitzwechsel', 'N1: Lückenliste je Fall einmal: Gründung Tick 5, Postenverlust Tick 20 (kein Doppelzählen mit dem Besitzwechsel)');
ok(b.zaehlung.postenverlust.mitFunk === 0 && b.zaehlung.postenverlust.mitChronik === 0 && b.zaehlung.hafenfall.mitChronik === 1, 'M3/Chronik: Funk mit anderem Ort im Text, aber dem Fall-Ort als Absender, ordnet nicht zu; Chronik eines anderen ref (H9) auch nicht');
{
  const hf = b.faelle.find((f) => f.art === 'hafenfall');
  ok(hf.funk && hf.funk.tick === 11 && hf.chronik && hf.chronik.t === 10, 'Fall trägt Funk (Tick 11) und Chronik (Tick 10)');
  ok(hf.karteAb === 11 && hf.karteVerzug === 1, 'Karte von Rom zeigt den Hafenfall mit einem Tick Verzug');
  const l2 = b.luecken.find((l) => l.hex === 'H2' && l.art === 'postenverlust');
  ok(l2 && l2.karteAb === null, 'Lücke ohne Funk, die auch die Karte nie zeigt, ist als solche erkennbar (karteAb null)');
  ok(b.zaehlung.postenverlust.ohneFunkUndKarteNie === 1 && b.zaehlung.besitzwechsel.ohneFunkUndKarteNie === 0, 'Zählung „ohne Funk und Karte nie“');
}
ok(b.sicht.rohEreignisse.flotte_sammelt === 1 && b.sicht.kriegsRohEreignisse === 4 && b.sicht.rohEreignisse.flotte_marschiert === 1 && b.sicht.stande.t20 && b.sicht.stande.ende, 'Sichtauswertung: Roh-Ereignisse und Kartenstände');
{
  const s = b.sicht.stande.t20;
  ok(s.hexe === 4 && s.unbekannt === 1 && s.abweichung === 1 && s.richtigBekannt === 2, 'Kartenstand Tick 20: H2 falsch (Wissen alt), H4 nie gesehen, H1 und H3 richtig gesehen');
}
ok(PK.bilanzBauen(bsp, 0).zaehlung.hafenfall.mitFunk === 0, 'Fenster 0: der Funk eines Ticks später zählt nicht');
// M2/N6: Sinn des Funks aus Sicht von Rom, Gründungen eigene/fremde (Beispiel nach s7 Tick 91: Rom vernichtet einen germanischen Posten, der Funk sagt „Posten Eisfeld verloren“)
{
  const b2 = PK.bilanzBauen({
    seed: 2, radius: null, lauf: { ticks: 120, minuten: 16, besuchteHexe: 5 }, bildticks: [0],
    namen: { E: 'Eisfeld', F: 'Fjordhafen', G: 'Gruendungshain', I: 'Ismark', J: 'Jarlsburg' },
    besitzwechsel: [
      { tick: 50, min: 6, hex: 'G', von: '-', nach: 'rP', art: 'gruendung' },
      { tick: 60, min: 8, hex: 'J', von: '-', nach: 'gP', art: 'gruendung' },
      { tick: 91, min: 12, hex: 'E', von: 'gP', nach: 'rP', art: 'eroberung' },
      { tick: 95, min: 12.6, hex: 'F', von: 'rP', nach: 'gP', art: 'eroberung' },
      { tick: 100, min: 13, hex: 'I', von: 'rP', nach: 'gP', art: 'eroberung' },
    ],
    ereignisse: [
      { tick: 91, min: 12, typ: 'posten_verloren', ort: 'E', besitzer: 'ger', durch: 'rom' },
      { tick: 95, min: 12.6, typ: 'hafen_gefallen', ort: 'F', alt: 'rom', neu: 'ger' },
      { tick: 100, min: 13, typ: 'posten_verloren', ort: 'I', besitzer: 'rom', durch: 'ger' },
    ],
    funk: [
      { tick: 50, min: 6, von: 'POSTEN', text: 'Posten Gruendungshain gegründet.', lage: true },
      { tick: 92, min: 12.1, von: 'FLOTTE BEI EISFELD', text: 'Posten Eisfeld verloren.', lage: true },
      { tick: 95, min: 12.6, von: 'HAFEN FJORDHAFEN', text: 'Fjordhafen ist gefallen.', lage: true },
      { tick: 101, min: 13.1, von: 'HAFEN ISMARK', text: 'Posten Ismark verloren.', lage: true },
    ],
    chronik: [], ticks: [],
  });
  const fe = b2.faelle.find((f) => f.hex === 'E'), ff = b2.faelle.find((f) => f.hex === 'F'), fi = b2.faelle.find((f) => f.hex === 'I');
  ok(b2.faelle.length === 5 && b2.luecken.length === 1 && b2.luecken[0].hex === 'J', 'M2-Beispiel: 5 Fälle aus 5 Besitzwechseln und 3 Spezialereignissen, einzige Lücke ist die fremde Gründung J');
  ok(fe.art === 'postenverlust' && fe.verlierer === 'g' && fe.gewinner === 'r' && fe.seite === 'gewinn' && fe.funk && fe.funk.von === 'FLOTTE BEI EISFELD' && fe.funkSinnfehler === true, 'M2: Postenverlust Eisfeld, ger verliert, Rom gewinnt, Funk „Posten Eisfeld verloren.“ -> gefunkt, aber falsch herum');
  ok(ff.verlierer === 'r' && ff.gewinner === 'g' && ff.seite === 'verlust' && ff.funkSinnfehler === false && fi.seite === 'verlust' && fi.funkSinnfehler === false, 'M2: Verluste von Rom (Hafen Fjordhafen, Posten Ismark) mit „gefallen/verloren“ sind kein Sinnfehler');
  ok(b2.gesamt.funkSinnfehler === 1 && b2.sinnfehler.length === 1 && b2.sinnfehler[0].hex === 'E' && b2.zaehlung.postenverlust.funkSinnfehler === 1 && b2.zaehlung.hafenfall.funkSinnfehler === 0 && b2.zaehlung.postenverlust.mitFunk === 2, 'M2: eigene Spalte, ein Sinnfehler; er bleibt trotzdem „mit Funk“');
  ok(b2.zaehlung.gruendungEigene.n === 1 && b2.zaehlung.gruendungEigene.mitFunk === 1 && b2.zaehlung.gruendungFremde.n === 1 && b2.zaehlung.gruendungFremde.ohneFunk === 1 && b2.gesamt.lueckenFremd === 1 && b2.gesamt.lueckenRom === 0, 'N6: Gründungen getrennt nach Rom (1, gefunkt) und fremd (1, Lücke)');
  // FRE-04b B1: die neuen Funktexte (Seite genannt) zählen als Meldung und sind für Rom als Gewinner kein Sinnfehler
  const b3 = PK.bilanzBauen({
    seed: 3, radius: null, lauf: { ticks: 120, minuten: 16, besuchteHexe: 5 }, bildticks: [0],
    namen: { E: 'Eisfeld', F: 'Fjordhafen', I: 'Ismark' },
    besitzwechsel: [
      { tick: 91, min: 12, hex: 'E', von: 'gP', nach: 'rP', art: 'eroberung' },
      { tick: 95, min: 12.6, hex: 'F', von: 'gP', nach: 'rP', art: 'eroberung' },
      { tick: 100, min: 13, hex: 'I', von: 'rP', nach: 'gP', art: 'eroberung' },
    ],
    ereignisse: [
      { tick: 91, min: 12, typ: 'posten_verloren', ort: 'E', besitzer: 'ger', durch: 'rom' },
      { tick: 95, min: 12.6, typ: 'hafen_gefallen', ort: 'F', alt: 'ger', neu: 'rom' },
      { tick: 100, min: 13, typ: 'hafen_gefallen', ort: 'I', alt: 'rom', neu: 'ger' },
    ],
    funk: [
      { tick: 92, min: 12.1, von: 'FLOTTE BEI EISFELD', text: 'Posten Eisfeld (Germanen) durch Rom ausgeschaltet.', lage: true },
      { tick: 95, min: 12.6, von: 'HAFEN FJORDHAFEN', text: 'Fjordhafen ist in römischer Hand.', lage: true },
      { tick: 101, min: 13.1, von: 'HAFEN ISMARK', text: 'Ismark ist an die Germanen gefallen.', lage: true },
    ],
    chronik: [], ticks: [],
  });
  ok(b3.faelle.length === 3 && b3.luecken.length === 0 && b3.gesamt.funkSinnfehler === 0, 'B1: neue Funktexte (Rom gewinnt/verliert) gelten als Meldung, 0 Lücken, 0 Sinnfehler');
  const t2 = PK.textBilanz({ seed: 2, radius: null, lauf: { ticks: 120, minuten: 16 } }, b2);
  ok(/Funk falsch herum/.test(t2) && /Eisfeld \(E\) Verlierer g, Gewinner r/.test(t2) && /Gründung Rom/.test(t2) && /Gründung fremd/.test(t2) && /Gründungen Rom 0, fremd 1/.test(t2), 'bilanz.txt: Spalte und Liste „Funk falsch herum“, Gründungen eigene/fremde');
}

// M1/N2: Sicht unter den gesehenen Hexen
{
  const wahr = { A: 'r', B: 'g', C: 'k' };
  const s2 = PK.sichtBauen({ ticks: [
    { tick: 0, wahr, wissen: { A: 'r@0', B: 'r@3', C: 'k@?' } },   // gesehen 2 (A richtig, B falsch), C nie gesehen
    { tick: 1, wahr, wissen: { A: 'r@0', B: 'g@0', C: 'k@?' } },   // gesehen 2, beide richtig
  ], bildticks: [0] });
  ok(s2.stande.t0.gesehen === 2 && s2.stande.t0.anteilRichtigGesehen === 0.5 && s2.stande.t0.anteilGesehen === 0.667, 'M1: Anteil unter den gesehenen Hexen = richtig/gesehen (1/2), nicht richtig/alle (1/3)');
  ok(s2.anteilRichtigGesehenMittel === 0.75 && s2.anteilGesehenMittel === 0.667 && s2.unbekanntMittel === 1, 'M1: Mittelwert unter den gesehenen 75 % (alt gerechnet 50 %), Anteil gesehen 67 %');
  const leer = PK.bilanzBauen({ seed: 1, ticks: [], lauf: {} });
  const t3 = PK.textBilanz({ seed: 2, radius: null, lauf: { ticks: 1, minuten: 1, besuchteHexe: 3 } }, { fenster: 2, zaehlung: leer.zaehlung, gesamt: leer.gesamt, besitzwechselNachArt: {}, luecken: [], sinnfehler: [], sicht: s2 });
  ok(/unter den gesehenen Hexen stimmt die Karte zu 75 %/.test(t3) && /gesehen sind im Mittel 67 % der Hexe/.test(t3) && /im Mittel 1,0 Hexe/.test(t3), 'M1/N2: Beschriftung „unter den gesehenen Hexen 75 %“, Anteil gesehen getrennt, Dezimalkomma');
  ok(PK.dez1(4.884) === '4,9' && PK.dez1(0) === '0,0' && PK.dez1(12) === '12,0', 'N2: 4.884 wird 4,9');
}

// N3: Kriegs-Roh-Typen gibt es in der Sim
{
  const alles = fs.readdirSync(path.join(repo, 'server', 'weltsim')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(repo, 'server', 'weltsim', f), 'utf8')).join('\n');
  ok(PK.KRIEGS_ROH.every((k) => alles.includes("'" + k + "'")), 'N3: jeder Typ aus KRIEGS_ROH kommt in server/weltsim vor (' + PK.KRIEGS_ROH.length + ' Typen)');
  ok(!PK.KRIEGS_ROH.includes('flotte_marschiert') && !PK.KRIEGS_ROH.includes('angriff_gestartet') && ['flotte_marsch', 'flotte_aufbruch', 'angriff_abgebrochen', 'flotte_verlegt', 'posten_gehisst'].every((k) => PK.KRIEGS_ROH.includes(k)), 'N3: erfundene Typen raus, echte drin');
}

// N4: Repo-Sperre
{
  const link = path.join(root, 'repolink');
  let linkOk = true; try { fs.symlinkSync(repo, link, 'junction'); } catch (e) { linkOk = false; }
  ok(PK.imRepo(repo) && PK.imRepo(path.join(repo, 'x', 'y')) && PK.imRepo(repo + path.sep) && !PK.imRepo(repo + '-x') && !PK.imRepo(path.join(root, 'z')), 'N4: imRepo: Wurzel selbst, darunter, nicht das Geschwisterverzeichnis mit gleichem Präfix');
  ok(linkOk && PK.imRepo(link) && PK.imRepo(path.join(link, 'neu', 'ordner')), 'N4: Junction/Symlink ins Repo wird über den echten Pfad erkannt (auch nicht vorhandene Unterordner)');
}
{
  const txt = PK.textBilanz(Object.assign({ lauf: bsp.lauf }, bsp), b), tv = PK.textVerlauf(bsp);
  ok(/Lücken \(Fälle ohne Funkmeldung, je Fall einmal\): 2/.test(txt) && /Kriegs-Roh-Ereignisse \([^)]*flotte_marsch[^)]*\): 4/.test(txt) && /Gasfeld \(H3\)/.test(txt), 'bilanz.txt nennt die Lücken');
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
  const c3b = cli(['--seed', '7', '--ticks', '5', '--ohne-bilder', '--out', repo]);
  ok(c3b.status === 2 && /im Repo/.test(c3b.stderr), 'N4: --out <Repo-Wurzel> wird abgelehnt (Exit 2)');
  const c4 = cli(['--seed', '7']);
  ok(c4.status === 2, 'ohne --out: Exit 2');

  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(fails ? `\n${fails} FEHLER` : '\nalles ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
