'use strict';
// FAD-01 D: Messung der Sim-Baender mit der Invasion des Falschen-Haendler-Fadens (Regie().fadenInvasion: Vorlauf-Funk, Hochstufen +30 %, Angriff auf das naechste roemische Ziel).
// Treiber wie tools/sim-regie.js (Kz.lauf mit befehle/nach, Regie.vorTick/nachTick), aber ohne Spielleiter-Plaene: nur die Invasion, zu Ticks aus content/welt/invasion-messplan.json.
// Kennzahlen je Seed-Satz wie SUND-04b (Eroberungen · Angriffe/100 Ticks · Stillstand), dazu Kollaps und Hauptwelt verloren (Anzahl Laeufe) und je Invasion: Annahme durch den Kern,
// Eroberung des Ziels, mittlere Staerke vor/nach dem Hochstufen. Grundlast aller Szenarien ausser kern: Sabotage-Strategie der Crew wie tools/sim-crew-sprengen.js (Quelle der Bericht-Werte 1,65 · 1,88 · 4 %). Szenarien: kern (nackte Sim, nichts), basis (Sabotage, keine Invasion; der Treiber ruft nur invasionsZiel lesend auf, fuer den Vergleich "Ziel faellt ohnehin"),
// realistisch, drei, worst (siehe Messplan). Der Treiber ist deterministisch: eigener Zufallsstrom (mulberry32) je Seed, nie der der Sim.
//   node tools/mess-invasion-baender.js --selbsttest                    schneller Selbsttest (wenige Seeds) plus Gueltigkeit der Messdatei
//   node tools/mess-invasion-baender.js --satz <seed0> --szenario <kern|basis|realistisch|drei|worst> [--laeufe N] [--set pfad=wert]   ein Seed-Satz, JSON auf stdout
//   node tools/mess-invasion-baender.js --messen [--prozesse N] [--out tools/fixtures/mess/fad01-baender.json] [--einstellung "text"]   alle Saetze x Szenarien parallel, schreibt die Messdatei
//   node tools/mess-invasion-baender.js --tabelle [datei]                Messdatei als Tabelle
//   --set regie:vorwarnung.vorlauf.invasion=5 | befehle:flotte_hochstufen.wert.staerke_zuwachs=0.2   ueberschreibt einen Datenwert nur fuer diesen Lauf (zum Abstimmen vor dem Eintragen)
//   Echte Laeufe: npm run mess:invasion-baender -- --messen
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));
const Daten = require('../server/weltsim/daten.js');
const Kern = require('../server/weltsim/kern.js');
const Kz = require('../server/weltsim/kennzahlen.js');
const Regie = require('../server/sim/regie-befehle.js');
const P3 = require('../server/sim/faden-p3.js');
const PLAN = require('../content/welt/invasion-messplan.json').werte;
const BAENDER = require('../content/welt/absichten.json').werte.baender.wert;
const PW = require('../content/welt/posten-werte.json').werte;
const SAB = require('../content/faeden/b2-texte.json').werte.sabotage.wert;
const MESSDATEI = path.join(__dirname, 'fixtures', 'mess', 'fad01-baender.json');

const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
args.forEach((a, i) => {   // --set regie:pfad=wert | befehle:pfad=wert (nur dieser Prozess)
  if (a !== '--set') return;
  const m = /^(regie|befehle):([\w.]+)=(.+)$/.exec(args[i + 1] || '');
  if (!m) { console.log('--set: regie:pfad=wert oder befehle:pfad=wert'); process.exit(2); }
  let o = m[1] === 'regie' ? Regie.R : Kern.BEFEHLE.WERTE;
  const pfad = m[2].split('.');
  for (const k of pfad.slice(0, -1)) o = o[k];
  o[pfad[pfad.length - 1]] = JSON.parse(m[3]);
});

function rng(seed) { let a = (seed ^ 0x51ED270B) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rund = (x, n) => (x === null ? null : Math.round(x * Math.pow(10, n)) / Math.pow(10, n));

// Grundlast: die Sabotage-Strategie von tools/sim-crew-sprengen.js (SUND-04b B2; daraus stammen die Bericht-Werte 1,65 · 1,88 · 4 %): die Crew sprengt nach Verzug einen germanischen Versorgungsposten,
// hoechstens ein Beginn je pause_ticks (content/faeden/b2-texte.json), Ruf-Sperre je Hex (posten-werte.json). Zufallsstrom wie dort (strom), damit die Basis die Bericht-Werte reproduziert.
const strom = (seed) => { let a = (seed * 2654435761 + 12345) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
function sabotageEingriff(karte, seed) {
  const rng = strom(seed), sprengungen = [];
  const sprengung = (z, hex) => { const out = []; if (z.hexe[hex].garnison > 0) out.push({ typ: 'abwehr_verlust', ort: hex, punkte: z.hexe[hex].garnison }); out.push({ typ: 'posten_gesprengt', ort: hex }); return out; };
  const gilt = (z, liste) => Kern.filtereWirkungen(z, liste).gueltig.length === liste.length;
  const quellHex = (h) => { const x = karte.hexe.find((e) => e.code === h) || { quellen: [] }; return !!x.quellen.length && !x.hafenklasse; };
  let beginn = -1e9, ziel = null, sprengAm = null;
  return (z, i) => {
    const t = i + 1, out = [];
    const sperreAm = (h) => sprengungen.some((x) => x.ort === h && z.tick - x.tick < PW.sprengen.wert.ruf_sperre_ticks);
    const gueltig = (h, nd) => nd.posten && nd.besitzer === 'ger' && !nd.crew && quellHex(h) && !sperreAm(h);
    if (ziel == null && t >= 20 && t - beginn >= SAB.pause_ticks) {
      const ziele = Object.entries(z.hexe).filter(([h, nd]) => gueltig(h, nd)).map(([h]) => h).sort();
      if (ziele.length) { ziel = ziele[Math.floor(rng() * ziele.length)]; beginn = t; sprengAm = t + Math.floor(rng() * (PLAN.sabotage_verzug.wert + 1)); }
    }
    if (ziel != null && t >= sprengAm) {
      const nd = z.hexe[ziel];
      if (nd && gueltig(ziel, nd) && gilt(z, sprengung(z, ziel))) { out.push(...sprengung(z, ziel)); sprengungen.push({ ort: ziel, besitzer: nd.besitzer, tick: z.tick }); }
      ziel = null;
    }
    return out;
  };
}

// ---------- Ein Lauf
function einLauf(karte, werte, seed, ticks, szenario) {
  const r = rng(seed * 7919 + 17);
  const sz = (szenario === 'basis' || szenario === 'kern') ? PLAN.szenarien.wert.realistisch : PLAN.szenarien.wert[szenario];
  const echt = szenario !== 'basis' && szenario !== 'kern';
  const orteJe = sz.orte_je_versuch || PLAN.orte_je_versuch.wert;
  const ring = [];
  let game = null, faellig = [];
  const inv = [];   // je Versuch { n, ort, ziel, ok, grund, flotte, vor, nach, ab, erobert, schon_ger }
  const hochgestuft = new Set();
  const zeiten = sz.ticks ? sz.ticks : null;
  const versuchTick = (n) => (zeiten ? zeiten.includes(n) : (n >= sz.ab && (n - sz.ab) % sz.abstand === 0));
  const befehle = (z, i) => {
    if (!game) game = { weltsim: { zustand: z, tickZahl: 0, ereignisse: ring, regie: Regie.neu() }, emit() {}, countError() {}, worldsEnabled: false, env: {}, time: 0 };
    game.weltsim.tickZahl = i;
    const n = i + 1;
    const d = Kern.datenVon(z);
    const gerFlotten = z.flotten.filter((f) => f.fraktion === 'ger' && !f.miete).length;
    if (versuchTick(n) && !(zeiten === null && hochgestuft.size >= gerFlotten)) {
      let ziel = null, ort = null;
      for (let k = 0; k < orteJe && !ziel; k++) { ort = d.codes[Math.floor(r() * d.codes.length)]; ziel = P3.invasionsZiel(game, ort); }
      const rec = { n, ort, ziel, ok: false, grund: ziel ? null : 'kein Ziel', flotte: null, vor: null, nach: null, ab: null, erobert: false, schon_ger: ziel ? z.hexe[ziel].besitzer === 'ger' : false };
      if (ziel && echt) {
        const res = Regie.fadenInvasion(game, { ziel });
        rec.ok = res.ok; rec.grund = res.ok ? null : res.grund;
        if (res.ok) { rec.ab = res.ab; rec.flotte = res.flotte; rec.vor = z.flotten.find((f) => f.id === res.flotte).staerke; hochgestuft.add(res.flotte); }
      } else if (ziel) { rec.ok = null; rec.grund = 'schatten'; }
      inv.push(rec);
    }
    faellig = Regie.vorTick(game, n);
    return faellig.map((e) => e.b);
  };
  const nach = (z, i, res) => {
    for (const e of res.ereignisse) ring.push(Object.assign({ n: i + 1 }, e));
    if (ring.length > 120) ring.splice(0, ring.length - 120);
    if (faellig.length) Regie.nachTick(game, res, faellig, i + 1);
    game.weltsim.tickZahl = i + 1;
    for (const v of inv) {
      if (v.ziel && i + 1 >= (v.ab || v.n) && z.hexe[v.ziel].besitzer === 'ger' && !v.schon_ger) v.erobert = true;
      if (v.ok === true && v.nach === null && i + 1 >= v.ab) v.nach = z.flotten.find((f) => f.id === v.flotte).staerke;
    }
  };
  const res = Kz.lauf({ karte, werte, seed, ticks, befehle, nach, eingriff: szenario === 'kern' ? null : sabotageEingriff(karte, seed) });
  res.inv = inv;
  return res;
}

function messen(seed0, szenario, laeufe) {
  const { karte, werte } = Daten.laden();
  const ticks = PLAN.ticks.wert;
  const rs = [];
  for (let i = 0; i < laeufe; i++) rs.push(einLauf(karte, werte, seed0 + i, ticks, szenario));
  const s = Kz.zusammenfassung(rs), a = Kz.angriffsUebersicht(rs, 'reich', ticks);
  const alle = [].concat(...rs.map((x) => x.inv));
  const mitZiel = alle.filter((v) => v.ziel);
  const ang = alle.filter((v) => v.ok === true);
  const basis = szenario === 'basis' || szenario === 'kern';
  const mittel = (l) => (l.length ? l.reduce((x, y) => x + y, 0) / l.length : null);
  const gruende = {};
  for (const v of alle) if (v.ok === false) gruende[v.grund] = (gruende[v.grund] || 0) + 1;
  const erobert = (basis ? mitZiel : ang).filter((v) => v.erobert).length;
  return {
    szenario, seed0, laeufe, ticks,
    eroberungen: rund(s.eroberungen, 4), angriffe_je100: rund(a.je100, 4), stillstand: rund(s.still, 4), kollaps: s.kollaps, hauptwelt_verloren: rs.filter((x) => x.hw_lost).length,
    versuche: alle.length, mit_ziel: mitZiel.length, angenommen: ang.length,
    annahme_anteil: basis ? null : rund(ang.length / Math.max(1, alle.length), 4),
    annahme_anteil_mit_ziel: basis ? null : rund(ang.length / Math.max(1, mitZiel.length), 4),
    abgelehnt_gruende: gruende,
    ziel_erobert_anteil: rund(erobert / Math.max(1, basis ? mitZiel.length : ang.length), 4), ziel_erobert_anzahl: erobert,
    staerke_vor: rund(mittel(ang.map((v) => v.vor)), 3), staerke_nach: rund(mittel(ang.filter((v) => v.nach !== null).map((v) => v.nach)), 3),
    laeufe_mit_invasion: rs.filter((x) => x.inv.some((v) => v.ok === true)).length,
  };
}
function baendeFehler(z) {
  const f = [];
  if (z.eroberungen < BAENDER.eroberungen.min || z.eroberungen > BAENDER.eroberungen.max) f.push(`Erob ${z.eroberungen.toFixed(2)}`);
  if (z.angriffe_je100 < BAENDER.angriffe_je100.min || z.angriffe_je100 > BAENDER.angriffe_je100.max) f.push(`Angr/100 ${z.angriffe_je100.toFixed(2)}`);
  if (z.stillstand > BAENDER.stillstand_max) f.push(`Stillstand ${(z.stillstand * 100).toFixed(0)} %`);
  if (z.kollaps > BAENDER.kollaps_max) f.push('Kollaps ' + z.kollaps);
  if (z.hauptwelt_verloren > BAENDER.hauptwelt_verloren_max) f.push('Hauptwelt ' + z.hauptwelt_verloren);
  return f;
}
const SZENARIEN = ['kern', 'basis', 'realistisch', 'drei', 'worst'];

function tabelle(zeilen) {
  const p = (x, n) => String(x).padStart(n);
  const pr = (x) => (x === null ? '-' : (x * 100).toFixed(0) + '%');
  console.log('szenario'.padEnd(12) + p('Seeds', 7) + p('Erob', 7) + p('Angr/100', 9) + p('Still%', 7) + p('Koll', 5) + p('HW', 4) + p('Vers.', 7) + p('Annahme', 8) + p('m.Ziel', 8) + p('Erob.Z', 8) + p('St.vor', 8) + p('St.nach', 8) + '  Verstoss');
  for (const z of zeilen) {
    const f = baendeFehler(z);
    console.log(z.szenario.padEnd(12) + p(z.seed0, 7) + p(z.eroberungen.toFixed(2), 7) + p(z.angriffe_je100.toFixed(2), 9) + p((z.stillstand * 100).toFixed(0), 7) + p(z.kollaps, 5) + p(z.hauptwelt_verloren, 4) + p(z.versuche, 7)
      + p(pr(z.annahme_anteil), 8) + p(pr(z.annahme_anteil_mit_ziel), 8) + p(pr(z.ziel_erobert_anteil), 8)
      + p(z.staerke_vor === null ? '-' : z.staerke_vor.toFixed(2), 8) + p(z.staerke_nach === null ? '-' : z.staerke_nach.toFixed(2), 8) + (f.length ? '  ' + f.join(', ') : ''));
  }
}

// ---------- Aufrufe
if (args.includes('--satz')) {
  const seed0 = Number(argVal('--satz', 0)), sz = argVal('--szenario', 'realistisch');
  if (!SZENARIEN.includes(sz)) { console.log('Szenario: ' + SZENARIEN.join(' | ')); process.exit(2); }
  process.stdout.write(JSON.stringify(messen(seed0, sz, Number(argVal('--laeufe', PLAN.laeufe.wert)))) + '\n');
} else if (args.includes('--messen')) {
  const { spawn } = require('child_process');
  const os = require('os');
  const maxP = Number(argVal('--prozesse', Math.max(1, os.cpus().length - 2)));
  const auftraege = [];
  for (const sz of SZENARIEN) for (const s0 of PLAN.seed_saetze.wert) auftraege.push({ sz, s0 });
  const extra = [];
  args.forEach((a, i) => { if (a === '--set') extra.push('--set', args[i + 1]); });
  const out = [];
  let laufend = 0, next = 0, fertig = 0;
  const t0 = Date.now();
  const abschluss = () => {
    out.sort((x, y) => SZENARIEN.indexOf(x.szenario) - SZENARIEN.indexOf(y.szenario) || x.seed0 - y.seed0);
    const datei = argVal('--out', MESSDATEI);
    const doc = { format: 'fad01-baender/1', datum: new Date().toISOString().slice(0, 10), ticks: PLAN.ticks.wert, laeufe: PLAN.laeufe.wert, seeds: PLAN.seed_saetze.wert, invasion_ticks: PLAN.szenarien.wert, einstellung: argVal('--einstellung', 'Daten unveraendert'),
      baender: BAENDER, werte_stand: { vorlauf_invasion: Regie.R.vorwarnung.wert.vorlauf.invasion, staerke_zuwachs: Kern.BEFEHLE.WERTE.flotte_hochstufen.wert.staerke_zuwachs }, zeilen: out };
    fs.writeFileSync(datei, JSON.stringify(doc, null, 1) + '\n');
    tabelle(out);
    console.log(`geschrieben: ${datei} (${((Date.now() - t0) / 1000).toFixed(0)} s, ${maxP} Prozesse)`);
  };
  const start = () => {
    while (laufend < maxP && next < auftraege.length) {
      const au = auftraege[next++]; laufend++;
      const ch = spawn(process.execPath, [__filename, '--satz', String(au.s0), '--szenario', au.sz].concat(extra), { stdio: ['ignore', 'pipe', 'inherit'] });
      let buf = '';
      ch.stdout.on('data', (d) => { buf += d; });
      ch.on('close', (code) => {
        laufend--; fertig++;
        if (code !== 0) { console.error('Prozess ' + au.sz + ' ' + au.s0 + ' Exit ' + code); process.exit(1); }
        out.push(JSON.parse(buf));
        if (fertig === auftraege.length) abschluss(); else start();
      });
    }
  };
  start();
} else if (args.includes('--tabelle')) {
  tabelle(JSON.parse(fs.readFileSync(argVal('--tabelle', MESSDATEI), 'utf8')).zeilen);
} else if (args.includes('--selbsttest')) {
  let n = 0, fails = 0;
  const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
  const { karte, werte } = Daten.laden();
  // 1) Basis ohne Invasion ist byte-gleich zum nackten Kern-Lauf (der Treiber aendert die Sim nicht)
  const pur = Kz.zusammenfassung([0, 1, 2, 3].map((s) => Kz.lauf({ karte, werte, seed: s, ticks: PLAN.ticks.wert })));
  const b = messen(0, 'kern', 4);
  ok(rund(pur.eroberungen, 4) === b.eroberungen && rund(pur.still, 4) === b.stillstand, 'Szenario kern des Treibers = nackter Kern-Lauf (Eroberungen und Stillstand gleich)');
  // 2) Determinismus: derselbe Satz zweimal, Zeichen fuer Zeichen gleich
  const r1 = JSON.stringify(messen(0, 'realistisch', 4)), r2 = JSON.stringify(messen(0, 'realistisch', 4));
  ok(r1 === r2, 'realistisch: zwei Laeufe desselben Satzes sind byte-gleich');
  // 3) Die Invasion wirkt: Versuche gezaehlt, Staerke steigt durch das Hochstufen
  const w = messen(0, 'worst', 6);
  ok(w.versuche > 0 && w.angenommen > 0, `Worst: Versuche ${w.versuche}, angenommen ${w.angenommen}`);
  ok(w.staerke_vor !== null && w.staerke_nach !== null && w.staerke_nach > w.staerke_vor, `Hochstufen hebt die Staerke (${w.staerke_vor} -> ${w.staerke_nach})`);
  ok(w.kollaps === 0 && w.hauptwelt_verloren === 0, 'Worst (6 Seeds): Kollaps 0, Hauptwelt nie verloren');
  // 4) Messdatei: vorhanden, vollstaendig, realistischer Fall haelt die Baender
  if (fs.existsSync(MESSDATEI)) {
    const m = JSON.parse(fs.readFileSync(MESSDATEI, 'utf8'));
    ok(m.format === 'fad01-baender/1' && m.zeilen.length === SZENARIEN.length * PLAN.seed_saetze.wert.length, 'Messdatei hat alle Szenarien x Seed-Saetze');
    const real = m.zeilen.filter((z) => z.szenario === 'realistisch');
    ok(real.length === PLAN.seed_saetze.wert.length && real.every((z) => baendeFehler(z).length === 0), 'Messdatei: realistischer Fall haelt in allen Saetzen die Baender');
    ok(m.zeilen.every((z) => z.kollaps === 0 && z.hauptwelt_verloren === 0), 'Messdatei: Kollaps 0 und Hauptwelt nie verloren (alle Szenarien)');
    ok(m.werte_stand.vorlauf_invasion === Regie.R.vorwarnung.wert.vorlauf.invasion && m.werte_stand.staerke_zuwachs === Kern.BEFEHLE.WERTE.flotte_hochstufen.wert.staerke_zuwachs, 'Messdatei gehoert zu den aktuellen Datenwerten (sonst neu messen)');
  } else ok(false, 'Messdatei tools/fixtures/mess/fad01-baender.json fehlt');
  console.log(fails ? `\n${fails} von ${n} FEHLER` : `\nMESS-INVASION-BAENDER OK (${n} Pruefungen)`);
  process.exit(fails ? 1 : 0);
} else {
  console.log('node tools/mess-invasion-baender.js --selbsttest | --satz <seed0> --szenario <s> | --messen | --tabelle');
  process.exit(2);
}
