'use strict';
// SUND-02b D: Messwerkzeug der Absichten (content/welt/absichten.json). Je Absicht und für die Standard-KI: N Läufe à T Ticks der Weltsimulation mit Seeds 0..N-1,
// die Absicht gilt für ROM über den GANZEN Lauf (schärfster Fall: im Spiel gilt sie nur `dauer` Ticks). Ausgabe: SUND-01-Kennzahlen (Eroberungen, Angriffe/100, Stillstand,
// Kollaps, Hauptwelt verloren) und die Kennzahlen von Rom (eigene Angriffe, Ansprüche, Posten gegründet/verloren, Häfen verloren, Eroberungen von Rom).
//   node tools/sim-absichten.js [--laeufe 100] [--ticks 300] [--seed0 0] [--pruefen] [--json] [--nur <id>] [--wert id.feld=zahl ...]
//   --pruefen   jede Absicht muss in den Bändern (absichten.json, baender) bleiben UND sich messbar von der Standard-KI unterscheiden (Richtung je Absicht, Daten: wirkt),
//               sonst Exit 1
//   --fenster   nur die Fenster-Messung (auch Teil von --pruefen): 12-Tick-Fenster, nur Zustände, in denen die Absicht angeboten wird, Richtung je Aussage des Textes (Datenfeld wirkt_fenster)
//   --wert      überschreibt eine Wirkungszahl für diesen Lauf (verteidigung.p_act=0.15), die Datei bleibt unverändert (zum Abstimmen)
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Daten = require('../server/weltsim/daten.js');
const Kz = require('../server/weltsim/kennzahlen.js');
const DATEN = require('../content/welt/absichten.json');

const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const laeufe = Number(argVal('--laeufe', 100)), seed0 = Number(argVal('--seed0', 0));
const nur = argVal('--nur', null);
const W = DATEN.werte;
const absichten = JSON.parse(JSON.stringify(W.absichten.wert));
args.forEach((a, i) => {
  if (a !== '--wert') return;
  const m = /^(\w+)\.(\w+)=(.+)$/.exec(args[i + 1] || '');
  const ab = m && absichten.find((x) => x.id === m[1]);
  if (ab) ab.wirkung[m[2]] = Number(m[3]);
});
const { karte, werte } = Daten.laden();
const ticks = Number(argVal('--ticks', werte.werte.ticks.wert));

// Kennzahlen von Rom aus den Ereignissen eines Laufs
function rom(r) {
  const e = r.ereignisse;
  const n = (f) => e.filter(f).length;
  return {
    angriffe: n((x) => x.fraktion === 'rom' && ((x.typ === 'flotte_aufbruch' && x.art === 'angriff') || x.typ === 'flotte_sammelt')),
    ansprueche: n((x) => x.fraktion === 'rom' && x.typ === 'flotte_aufbruch' && x.art === 'beanspruchen'),
    posten_neu: n((x) => x.typ === 'posten_gegruendet' && x.fraktion === 'rom'),
    posten_verloren: n((x) => x.typ === 'posten_verloren' && x.besitzer === 'rom'),
    hafen_verloren: n((x) => x.typ === 'hafen_gefallen' && x.alt === 'rom'),
    erobert: n((x) => x.typ === 'hafen_gefallen' && x.neu === 'rom'),
    belagert: n((x) => x.typ === 'flotte_belagert' && x.besitzer === 'rom'),
  };
}
const mit = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function messen(id, ab) {
  const rs = [];
  for (let i = 0; i < laeufe; i++) rs.push(Kz.lauf({ karte, werte, seed: seed0 + i, ticks, absichten: ab ? { rom: ab.wirkung } : null }));
  const s = Kz.zusammenfassung(rs), a = Kz.angriffsUebersicht(rs, 'reich', ticks);
  const ro = rs.map(rom);
  const out = {
    id, eroberungen: s.eroberungen, angriffe_je100: a.je100, stillstand: s.still, kollaps: s.kollaps, hauptwelt_verloren: s.hw_verloren,
    rom_posten_verloren: mit(ro.map((x) => x.posten_verloren)), rom_hafen_verloren: mit(ro.map((x) => x.hafen_verloren)), rom_erobert: mit(ro.map((x) => x.erobert)),
    rom_angriffe: mit(ro.map((x) => x.angriffe)), rom_aktionen: mit(ro.map((x) => x.angriffe + x.ansprueche)), rom_ansprueche: mit(ro.map((x) => x.ansprueche)), rom_posten_neu: mit(ro.map((x) => x.posten_neu)),
    rom_belagert: mit(ro.map((x) => x.belagert)),
    rom_haefen: s.rom_h, rom_staerke: s.staerke_rom, hw_laeufe: rs.filter((r) => r.hw_lost).length,
  };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- Fenster-Messung
// So wirkt eine Absicht im Spiel: sie gilt ticks Ticks, danach läuft die Standard-KI nachlauf Ticks weiter. Gemessen an Zuständen echter Läufe (jeder schritt-te Tick von seeds Seeds), in denen die Absicht
// angeboten würde (Absicht.angebotIds), mit der Absicht gegen dieselben Zustände ohne (Kern.tick, zustand.absichten.rom wie im Spiel). Kennzahlen: Aktionen von Rom nur im Fenster, Posten und Belagerungen
// über Fenster und Nachlauf. Es gilt die Richtung (wirkt_fenster), nicht die Bänder des Ganzlaufs.
function fensterMessen() {
  const Kern = require('../server/weltsim/kern.js');
  const Absicht = require('../server/sim/absicht.js');
  const F = W.fenster.wert, klon = (v) => JSON.parse(JSON.stringify(v));
  const lauf = (z0, wirkung) => {
    const z = klon(z0); z.absichten = wirkung ? { rom: klon(wirkung) } : {};
    const m = { rom_angriffe: 0, rom_ansprueche: 0, rom_posten_neu: 0, rom_belagert: 0 };
    for (let i = 0; i < F.ticks + F.nachlauf; i++) {
      if (i === F.ticks) delete z.absichten.rom;
      for (const e of Kern.tick(z).ereignisse) {
        if (i < F.ticks && e.fraktion === 'rom' && ((e.typ === 'flotte_aufbruch' && e.art === 'angriff') || e.typ === 'flotte_sammelt')) m.rom_angriffe++;
        if (i < F.ticks && e.fraktion === 'rom' && e.typ === 'flotte_aufbruch' && e.art === 'beanspruchen') m.rom_ansprueche++;
        if (e.typ === 'posten_gegruendet' && e.fraktion === 'rom') m.rom_posten_neu++;
        if (e.typ === 'flotte_belagert' && e.besitzer === 'rom') m.rom_belagert++;
      }
    }
    m.rom_aktionen = m.rom_angriffe + m.rom_ansprueche;
    return m;
  };
  const out = {};
  for (let seed = 0; seed < F.seeds; seed++) {
    const z0 = Kern.erzeuge({ karte, werte, seed });
    for (let t = 0; t < ticks - F.ticks - F.nachlauf; t++) {
      Kern.tick(z0);
      if (t % F.schritt) continue;
      for (const id of Absicht.angebotIds(z0)) {
        const ab = absichten.find((x) => x.id === id);
        if (!ab || (nur && nur !== id)) continue;
        const o = out[id] || (out[id] = { n: 0, std: {}, abs: {} });
        o.n++;
        const s = lauf(z0, null), a = lauf(z0, ab.wirkung);
        for (const k of Object.keys(s)) { o.std[k] = (o.std[k] || 0) + s[k]; o.abs[k] = (o.abs[k] || 0) + a[k]; }
      }
    }
  }
  for (const o of Object.values(out)) for (const k of Object.keys(o.std)) { o.std[k] /= o.n; o.abs[k] /= o.n; }
  return out;
}
function fensterFehler(out) {
  const f = [];
  for (const ab of absichten) {
    if (nur && nur !== ab.id) continue;
    const o = out[ab.id];
    if (!o || o.n < 30) { f.push(ab.id + ': im Fenster zu selten angeboten (n=' + (o ? o.n : 0) + ')'); continue; }
    for (const w of ab.wirkt_fenster || []) {
      const d = o.abs[w.kennzahl] - o.std[w.kennzahl];
      if ((w.richtung === 'mehr' ? d : -d) < w.min) f.push(`${ab.id} (Fenster): ${w.kennzahl} ${d.toFixed(3)} statt ${w.richtung} um ${w.min}`);
    }
  }
  return f;
}
const fensterAus = (out) => {
  const K = [['rom_angriffe', 'Angriffe'], ['rom_ansprueche', 'Ansprüche'], ['rom_aktionen', 'Aktionen'], ['rom_posten_neu', 'neue Posten'], ['rom_belagert', 'belagert']];
  console.log(`Fenster-Messung: ${W.fenster.wert.ticks} Ticks Absicht + ${W.fenster.wert.nachlauf} Nachlauf, Seeds 0..${W.fenster.wert.seeds - 1}, jeder ${W.fenster.wert.schritt}. Tick, nur angebotene Zustände (Standard-KI -> Absicht):`);
  for (const [id, o] of Object.entries(out)) console.log('  ' + id.padEnd(14) + ('n=' + o.n).padEnd(9) + K.map(([k, t]) => t + ' ' + o.std[k].toFixed(3) + '->' + o.abs[k].toFixed(3)).join(' | '));
};

const t0 = Date.now();
if (args.includes('--fenster')) { const fo = fensterMessen(); fensterAus(fo); const ff = fensterFehler(fo); if (ff.length) console.log('FEHLER ' + ff.join('\nFEHLER ')); process.exit(ff.length ? 1 : 0); }
const zeilen = [messen('standard', null)];
for (const ab of absichten) if (!nur || nur === ab.id) zeilen.push(messen(ab.id, ab));
const std = zeilen[0];

// Bänder und Richtung
const B = W.baender.wert;
function pruefe(z) {
  const f = [];
  if (z.eroberungen < B.eroberungen.min || z.eroberungen > B.eroberungen.max) f.push(`Eroberungen ${z.eroberungen.toFixed(2)} außerhalb ${B.eroberungen.min}-${B.eroberungen.max}`);
  if (z.angriffe_je100 < B.angriffe_je100.min || z.angriffe_je100 > B.angriffe_je100.max) f.push(`Angriffe/100 ${z.angriffe_je100.toFixed(2)} außerhalb ${B.angriffe_je100.min}-${B.angriffe_je100.max}`);
  if (z.stillstand > B.stillstand_max) f.push(`Stillstand ${(z.stillstand * 100).toFixed(0)} % > ${B.stillstand_max * 100} %`);
  if (z.kollaps > B.kollaps_max) f.push('Kollaps ' + z.kollaps);
  if (z.hw_laeufe > B.hauptwelt_verloren_max) f.push('Hauptwelt verloren in ' + z.hw_laeufe + ' Läufen');
  return f;
}
let schlecht = 0;
if (args.includes('--json')) { console.log(JSON.stringify({ laeufe, ticks, seed0, zeilen })); }
else {
  console.log(`${laeufe} Läufe à ${ticks} Ticks, Seeds ${seed0}..${seed0 + laeufe - 1}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const K = [['eroberungen', 'Erob.', 2], ['angriffe_je100', 'Angr/100', 2], ['stillstand', 'Stillst.', 2], ['kollaps', 'Kollaps', 2], ['hw_laeufe', 'HW verl.', 0],
    ['rom_angriffe', 'Rom Angr.', 2], ['rom_ansprueche', 'Rom Ansp.', 2], ['rom_aktionen', 'Rom Akt.', 2], ['rom_posten_neu', 'Rom P+', 2], ['rom_posten_verloren', 'Rom P-', 2], ['rom_hafen_verloren', 'Rom H-', 2], ['rom_erobert', 'Rom Erob.', 2], ['rom_belagert', 'Rom bel.', 2], ['rom_haefen', 'Rom Häfen', 2], ['rom_staerke', 'Rom Stärke', 1]];
  console.log('absicht'.padEnd(15) + K.map(([, t]) => t.padStart(10)).join(''));
  for (const z of zeilen) console.log(z.id.padEnd(15) + K.map(([k, , d]) => z[k].toFixed(d).padStart(10)).join(''));
}
if (args.includes('--pruefen')) {
  for (const z of zeilen) {
    const f = pruefe(z);
    if (z.id !== 'standard') {
      const ab = absichten.find((x) => x.id === z.id);
      for (const w of (ab.wirkt || [])) {   // wirkt: [{ kennzahl, richtung: 'mehr'|'weniger', min: Mindestunterschied }]
        const d = z[w.kennzahl] - std[w.kennzahl];
        if ((w.richtung === 'mehr' ? d : -d) < w.min) f.push(`${w.kennzahl}: ${d.toFixed(2)} statt ${w.richtung} um ${w.min}`);
      }
    }
    if (f.length) { schlecht++; console.log('FEHLER ' + z.id + ': ' + f.join('; ')); }
  }
  const fo = fensterMessen(); fensterAus(fo);
  const ff = fensterFehler(fo);
  for (const x of ff) { schlecht++; console.log('FEHLER ' + x); }
  console.log(schlecht ? schlecht + ' Verstöße gegen Bänder oder Wirkung' : 'ABSICHTEN OK: Ganzlauf in den Bändern und messbar anders; im 12-Tick-Fenster zeigt jede Absicht die Richtung, die ihr Text verspricht');
  process.exit(schlecht ? 1 : 0);
}
