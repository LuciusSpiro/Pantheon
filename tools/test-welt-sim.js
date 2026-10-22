'use strict';
// SUND-01 A: Weltsimulation (server/weltsim/*): Determinismus, Serialisierung, Reinheit, Daten statt Code, Kennzahlenbänder, Ereignisse, Hostilität.
//   node tools/test-welt-sim.js      (ca. 5 s)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Daten = require('../server/weltsim/daten.js');
const Kern = require('../server/weltsim/kern.js');
const Kz = require('../server/weltsim/kennzahlen.js');
const Ereignisse = require('../server/weltsim/ereignisse.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
const kopie = (x) => JSON.parse(JSON.stringify(x));

const { karte, werte } = Daten.laden();
const neu = (seed, aendere) => {
  const w = kopie(werte);
  if (aendere) aendere(w.werte);
  return Kern.erzeuge({ karte, werte: w, seed });
};
// n Ticks, gibt alle Ereignisse zurück
const laufe = (z, ticks, opt) => {
  const ev = [];
  for (let i = 0; i < ticks; i++) for (const e of Kern.tick(z, opt).ereignisse) ev.push(e);
  return ev;
};

section('1. Determinismus');
{
  const a = neu(5), b = neu(5), c = neu(6);
  const ea = laufe(a, 300), eb = laufe(b, 300), ec = laufe(c, 300);
  ok(gleich(a, b) && gleich(ea, eb), 'gleicher Seed, 300 Ticks: Zustände und Ereignisse tief gleich');
  ok(!gleich(a, c), 'anderer Seed: anderer Zustand');
  ok(ea.length > 50 && ec.length > 50, `Ereignisse entstehen (${ea.length} bei Seed 5, ${ec.length} bei Seed 6)`);
  // zwei Sims abwechselnd: kein versteckter Zustand im Modul
  const x = neu(11), y = neu(12), x1 = neu(11), y1 = neu(12);
  for (let i = 0; i < 200; i++) { Kern.tick(x); Kern.tick(y); }
  laufe(x1, 200); laufe(y1, 200);
  ok(gleich(x, x1) && gleich(y, y1), 'zwei Sims abwechselnd gerechnet = getrennt gerechnet (kein globaler Zustand im Modul)');
}

section('2. Serialisierung');
{
  const durch = neu(21), geteilt = neu(21);
  const e1 = laufe(durch, 300);
  const ea = laufe(geteilt, 150);
  let z2 = JSON.parse(JSON.stringify(geteilt));
  ok(gleich(z2, geteilt), 'Zustand nach 150 Ticks: JSON-Roundtrip verlustfrei (reine Daten, keine Objektverweise)');
  const eb = laufe(z2, 150);
  ok(gleich(z2, durch), '150 Ticks, speichern, laden, 150 Ticks = 300 Ticks am Stück (Zufallsstrom liegt im Zustand)');
  ok(gleich(ea.concat(eb), e1), 'Ereignisse identisch');
  ok(gleich(JSON.parse(JSON.stringify(durch)), durch), 'Endzustand ebenfalls verlustfrei serialisierbar');
}

section('3. Reinheit');
{
  const dir = path.join(__dirname, '..', 'server', 'weltsim');
  const dateien = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  ok(dateien.length >= 5, `Modulquellen gefunden: ${dateien.join(', ')}`);
  const verboten = [/\bsetTimeout\b/, /\bsetInterval\b/, /\bsetImmediate\b/, /\bMath\.random\b/, /\bDate\.now\b/, /\bnew Date\b/, /\bworker_threads\b/, /\bchild_process\b/, /\bprocess\.hrtime\b/, /\bperformance\.now\b/];
  const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  for (const f of dateien) {
    const q = ohneKommentare(fs.readFileSync(path.join(dir, f), 'utf8'));
    const treffer = verboten.filter((r) => r.test(q)).map(String);
    ok(treffer.length === 0, `${f}: kein Timer, Thread, Math.random, Date (${treffer.join(' ') || 'sauber'})`);
  }
  const mitFs = dateien.filter((f) => /require\(['"](fs|path|os|http|https|net)['"]\)/.test(ohneKommentare(fs.readFileSync(path.join(dir, f), 'utf8'))));
  ok(mitFs.join() === 'daten.js', `nur daten.js greift auf Dateien zu (${mitFs.join(', ')})`);
  const dq = ohneKommentare(fs.readFileSync(path.join(dir, 'daten.js'), 'utf8'));
  const lade = dq.slice(dq.indexOf('function laden'), dq.indexOf('function werteFlach'));
  ok((dq.match(/readFileSync/g) || []).length === 1 && lade.includes('readFileSync'), 'daten.js liest Dateien nur in laden()');
  // Laufzeit: während des Ticks sind Zeit, Zufall, Timer und Dateizugriff gesperrt
  const sperre = { Math: ['random'], Date: ['now'], fs: ['readFileSync', 'writeFileSync', 'readdirSync', 'existsSync', 'statSync', 'openSync'] };
  const ziel = { Math, Date, fs };
  const alt = [];
  const timer = ['setTimeout', 'setInterval', 'setImmediate'];
  const z = neu(31);
  let fehler = null;
  try {
    for (const [o, ks] of Object.entries(sperre)) for (const k of ks) { alt.push([ziel[o], k, ziel[o][k]]); ziel[o][k] = () => { throw new Error(`${o}.${k} im Tick`); }; }
    for (const k of timer) { alt.push([global, k, global[k]]); global[k] = () => { throw new Error(`${k} im Tick`); }; }
    laufe(z, 300);
  } catch (e) { fehler = e; } finally { for (const [o, k, f] of alt) o[k] = f; }
  ok(fehler === null && z.tick === 300, `300 Ticks mit gesperrtem Math.random, Date.now, Timern und Dateizugriff laufen durch${fehler ? ' (' + fehler.message + ')' : ''}`);
}

section('4. Daten statt Code');
{
  const mess = (aendere, seeds = 30) => {
    const w = kopie(werte); aendere(w.werte);
    const rs = []; for (let s = 0; s < seeds; s++) rs.push(Kz.lauf({ karte, werte: w, seed: s, ticks: 300 }));
    return { rs, a: Kz.angriffsUebersicht(rs), s: Kz.zusammenfassung(rs) };
  };
  const basis = mess(() => {});
  const langsam = mess((w) => { w.k.wert = 0.03; });
  const schnell = mess((w) => { w.k.wert = 0.25; });
  ok(langsam.a.belagerung > basis.a.belagerung && basis.a.belagerung >= schnell.a.belagerung, `Gefechtstempo k: Belagerung im Median ${schnell.a.belagerung} (k 0,25) <= ${basis.a.belagerung} (0,10) < ${langsam.a.belagerung} (0,03)`);
  const sam6 = mess((w) => { w.sammeln_min.wert = 6; w.sammeln_max.wert = 12; });
  ok(basis.a.sammeln === 3 && sam6.a.sammeln >= 6, `Sammeldauer: Median Sammeln ${basis.a.sammeln} (Datei) -> ${sam6.a.sammeln} (sammeln_min 6)`);
  const ohneFeld = mess((w) => { w.feld_decay.wert = 0; });
  const starkFeld = mess((w) => { w.feld_decay.wert = 0.05; });
  const verlust = (m) => Kz.mittel(m.rs.map((r) => r.feld_loss));
  ok(verlust(ohneFeld) === 0 && verlust(basis) > 0 && verlust(starkFeld) > verlust(basis), `Verschleiß im Feld: Verlust je Lauf ${verlust(ohneFeld).toFixed(1)} (0) < ${verlust(basis).toFixed(1)} (1,5 %) < ${verlust(starkFeld).toFixed(1)} (5 %)`);
  const direkt = mess((w) => { w.stuetz.wert = false; });
  ok(direkt.a.sammeln === 0 && basis.a.sammeln > 0, 'Schalter stuetz aus: kein Sammeln mehr (Median 0)');
  const keinHandel = mess((w) => { w.trade.wert = false; }, 3);
  ok(keinHandel.rs.every((r) => !r.ereignisse.some((e) => e.typ === 'konvoi')) && basis.rs.some((r) => r.ereignisse.some((e) => e.typ === 'konvoi')), 'Schalter trade aus: keine Konvoi-Ereignisse');
  // Embargo als Daten: Rom bekommt ab Tick 0 keine Medizin, Germanen schon
  const emb = mess((w) => { w.embargo.wert = { from: 0, fac: 'rom', goods: ['M'] }; }, 5);
  ok(emb.rs.every((r) => r.ereignisse.filter((e) => e.typ === 'konvoi').every((e) => !(e.handel.rom && e.handel.rom.verkauf.M))), 'Embargo-Parameter (Daten): Rom kauft keine Medizin beim Konkordat');
  ok(emb.s.m_mangel_rom > basis.s.m_mangel_rom, `Embargo wirkt: Medizinmangel Rom ${emb.s.m_mangel_rom.toFixed(2)} > ${basis.s.m_mangel_rom.toFixed(2)}`);
  // fehlende oder kaputte Werte fallen auf
  const kaputt = kopie(werte); delete kaputt.werte.k;
  let meldung = ''; try { Kern.erzeuge({ karte, werte: kaputt, seed: 1 }); } catch (e) { meldung = e.message; }
  ok(/"k" fehlt/.test(meldung), 'fehlender Wert wird beim Erzeugen klar gemeldet');
}

section('5. Kennzahlenbänder (40 Läufe à 300 Ticks, Seeds 0..39)');
{
  const rs = []; const t0 = Date.now();
  for (let s = 0; s < 40; s++) rs.push(Kz.lauf({ karte, werte, seed: s, ticks: 300 }));
  const s = Kz.zusammenfassung(rs), a = Kz.angriffsUebersicht(rs);
  console.log(`       ${Kz.fmt({ eroberungen: s.eroberungen, angriffe_je100: a.je100, still: s.still, kollaps: s.kollaps, hw: s.hw_verloren, rom_h: s.rom_h, ger_h: s.ger_h, kon_h: s.kon_h, sammeln: a.sammeln })} (${Date.now() - t0} ms)`);
  // Abnahmebänder des Auftrags (100 Läufe: 1,0–2,2 / 1,5–3,0 / <= 8 %); die kleine Stichprobe bekommt breitere Bänder (Standardfehler der Eroberungen etwa 0,2)
  ok(s.eroberungen >= 0.8 && s.eroberungen <= 2.5, `Eroberungen je Lauf ${s.eroberungen.toFixed(2)} in 0,8–2,5`);
  ok(a.je100 >= 1.3 && a.je100 <= 3.3, `Angriffe je 100 Ticks ${a.je100.toFixed(2)} in 1,3–3,3`);
  ok(s.still <= 0.12, `Stillstand ${(s.still * 100).toFixed(1)} % <= 12 %`);
  ok(s.kollaps === 0, 'Kollaps 0');
  ok(s.hw_verloren === 0, 'Hauptwelt nie verloren');
  ok(s.rom_h >= 7.3 && s.rom_h <= 8.7 && s.ger_h >= 7.3 && s.ger_h <= 8.7, `Häfen Rom ${s.rom_h.toFixed(2)}, Germanen ${s.ger_h.toFixed(2)} in 7,3–8,7`);
  ok(s.kon_h === 3, 'Konkordat hält 3 Häfen');
  ok(a.sammeln >= 3, `Sammeln im Median ${a.sammeln} Ticks >= 3`);
  ok(a.A_rechtzeitig > 0.8 && a.C_rechtzeitig < a.A_rechtzeitig, `Warnung ab Sammelbeginn erreicht mehr der Karte rechtzeitig (A ${a.A_rechtzeitig.toFixed(2)} > C ${a.C_rechtzeitig.toFixed(2)})`);
}

section('6. Ereignisse');
{
  // Ereignisse aus 30 Läufen sammeln
  const alle = [];
  for (let s = 0; s < 30; s++) { const z = neu(s); const ev = laufe(z, 300); alle.push({ z, ev }); }
  const typen = new Set(alle.flatMap((x) => x.ev.map((e) => e.typ)));
  const erwartet = ['flotte_aufbruch', 'flotte_sammelt', 'flotte_marsch', 'flotte_belagert', 'angriff_abgewehrt', 'hafen_gefallen', 'posten_gegruendet', 'konvoi', 'notruf'];
  ok(erwartet.every((t) => typen.has(t)), `Ereignistypen in 30 Läufen: ${[...typen].sort().join(', ')}`);
  ok(alle.every(({ ev }) => ev.every((e) => Ereignisse.TYPEN[e.typ] && Number.isInteger(e.tick) && typeof e.fraktion === 'string' && Ereignisse.TYPEN[e.typ].every((f) => f in e))), 'alle Ereignisse: typ, tick, fraktion und die Felder ihres Typs');
  ok(alle.every(({ ev }) => ev.every((e) => !('klasse' in e) || [1, 2, 3].includes(e.klasse)) && ev.filter((e) => e.ziel).every((e) => typeof e.zielName === 'string' && e.zielName)), 'Stärkeklasse 1–3, Orte mit Namen (Textvorlage braucht keinen Zustand)');
  ok(alle.every(({ ev }) => { const m = {}; for (const e of ev) if (e.typ === 'konvoi') { if (m[e.tick]) return false; m[e.tick] = 1; } return true; }), 'Konvoi: höchstens ein Ereignis je Tick');
  ok(alle.every(({ ev }) => ev.every((e) => e.typ !== 'konvoi' || (e.menge > 0 && Object.keys(e.handel).length))), 'Konvoi nur bei tatsächlichem Handel');
  // Ablauf eines Angriffs: Sammeln -> Marsch -> Belagerung -> Ausgang, je Feldzug in dieser Reihenfolge
  let ablauf = 0, fall = 0, ablaufOk = true;
  for (const { ev } of alle) {
    for (const e of ev.filter((x) => x.typ === 'flotte_sammelt')) {
      const folge = ev.filter((x) => x.angriff === e.angriff).map((x) => x.typ);
      const iM = folge.indexOf('flotte_marsch'), iB = folge.indexOf('flotte_belagert');
      if (iM >= 0 && iB >= 0) { ablauf++; if (!(folge[0] === 'flotte_sammelt' && iM < iB)) ablaufOk = false; }
      if (folge.filter((x) => x === 'flotte_sammelt' || x === 'flotte_marsch' || x === 'flotte_belagert').length > 3) ablaufOk = false;   // nie doppelt
    }
    fall += ev.filter((x) => x.typ === 'hafen_gefallen').length;
  }
  ok(ablauf > 20 && ablaufOk, `Sammeln erzeugt später Marsch und Belagerung, in dieser Reihenfolge (${ablauf} Feldzüge)`);
  ok(fall > 10, `Häfen fallen (${fall} in 30 Läufen)`);
  ok(alle.every(({ ev }) => ev.filter((e) => e.typ === 'flotte_belagert').every((e) => ev.some((x) => x.typ === 'notruf' && x.art === 'belagerung' && x.angriff === e.angriff && x.tick === e.tick && x.ort === e.ziel) === (e.zielArt === 'hafen'))), 'Belagerung eines Hafens löst im selben Tick einen Notruf mit Ort aus (Posten nicht)');
  ok(alle.some(({ ev }) => ev.some((e) => e.typ === 'notruf' && e.art === 'piratenueberfall')), 'Piratenüberfall: Notruf mit Ort');
  ok(alle.some(({ ev }) => ev.some((e) => e.typ === 'flotte_aufbruch' && e.art === 'raubzug' && e.fraktion === 'pirat')), 'Piraten brechen zum Raubzug auf');
  ok(alle.some(({ ev }) => ev.some((e) => e.typ === 'flotte_aufbruch' && e.art === 'beanspruchen')), 'Beanspruchen eines freien Sektors beginnt (Aufbruch)');
  const fallen = alle.flatMap((x) => x.ev.filter((e) => e.typ === 'hafen_gefallen'));
  ok(fallen.every((e) => e.alt !== e.neu && e.fraktion === e.neu), 'hafen_gefallen: Besitzer wechselt, fraktion = neuer Besitzer');

  // Hauptwelt: Palatina ohne Flotte, überlegener Angreifer
  const z = neu(1);
  z.flotten = z.flotten.filter((fl) => !(fl.fraktion === 'rom' && fl.ort === '0204'));
  z.vorrat.ger.U = z.vorrat.ger.T = 60;
  z.flotten.push({ id: z.naechsteId++, fraktion: 'ger', heimat: '1004', ort: '0204', staerke: 40, kap: 12, befehl: 'angriff', ziel: '0204', warte: 0, versorgung: 1, angriff: null });
  const ev = laufe(z, 8);
  const hw = ev.filter((e) => e.typ === 'hauptwelt_gefallen');
  ok(hw.length === 1 && hw[0].ort === '0204' && hw[0].ortName === 'Palatina' && hw[0].alt === 'rom' && hw[0].neu === 'ger' && z.hexe['0204'].besitzer === 'ger', 'hauptwelt_gefallen: Palatina 0204 wechselt von Rom zu den Germanen');
  ok(ev.some((e) => e.typ === 'hafen_gefallen' && e.ort === '0204'), 'zugleich hafen_gefallen');
  const z2 = neu(1);
  z2.flotten = z2.flotten.filter((fl) => !(fl.fraktion === 'ger' && fl.ort === '1004'));
  z2.vorrat.rom.U = z2.vorrat.rom.T = 60;
  z2.flotten.push({ id: z2.naechsteId++, fraktion: 'rom', heimat: '0204', ort: '1004', staerke: 40, kap: 12, befehl: 'angriff', ziel: '1004', warte: 0, versorgung: 1, angriff: null });
  const ev2 = laufe(z2, 8);
  ok(ev2.some((e) => e.typ === 'hauptwelt_gefallen' && e.ort === '1004' && e.ortName === 'Hrafnheim' && e.alt === 'ger'), 'hauptwelt_gefallen auch für Hrafnheim 1004');
  ok(!alle.some(({ ev: e }) => e.some((x) => x.typ === 'hauptwelt_gefallen')), 'im Normalbetrieb (30 Läufe) fällt keine Hauptwelt');
  // Posten: wird gegründet und kann verloren gehen
  ok(alle.some(({ z: zz }) => Object.values(zz.hexe).some((h) => h.posten)), 'Posten stehen am Ende');
}

section('7. Hostilität');
{
  let verstoss = '';
  const art = { rom: new Set(), ger: new Set(), pirat: new Set() };
  for (let s = 0; s < 40 && !verstoss; s++) {
    const z = neu(s);
    for (let i = 0; i < 300 && !verstoss; i++) {
      const vorher = z.angriffe.length;
      const vor = Object.fromEntries(Object.entries(z.hexe).map(([c, h]) => [c, h.besitzer]));
      const r = Kern.tick(z);
      for (const rec of z.angriffe.slice(vorher)) {
        const b = vor[rec.ziel];
        if (rec.von === 'kon') verstoss = `Seed ${s}: Konkordat greift an`;
        else if (rec.von === 'pirat') { if (b === 'pirat') verstoss = `Seed ${s}: Piraten gegen Piraten`; art.pirat.add(b); }
        else { if (b !== (rec.von === 'rom' ? 'ger' : 'rom')) verstoss = `Seed ${s}: ${rec.von} greift ${b} an`; art[rec.von].add(b); }
      }
      if (z.flotten.some((fl) => fl.fraktion === 'kon' && (fl.befehl === 'angriff' || fl.befehl === 'sammeln'))) verstoss = `Seed ${s}: Konkordat-Flotte im Angriff`;
      for (const e of r.ereignisse) {
        if (e.typ === 'hafen_gefallen' && (e.alt === 'kon' || e.neu === 'kon' || e.neu === 'pirat')) verstoss = `Seed ${s}: Hafen ${e.alt} -> ${e.neu}`;
        if (e.typ === 'flotte_belagert' && e.besitzer === 'kon') verstoss = `Seed ${s}: Konkordat belagert`;
      }
    }
  }
  ok(!verstoss, `Konkordat greift nie an und wird von Rom und Germanen nie angegriffen, Häfen wechseln nur zwischen Rom und Germanen${verstoss ? ' (' + verstoss + ')' : ''}`);
  ok([...art.rom].join() === 'ger' && [...art.ger].join() === 'rom', 'Rom greift nur Germanen an, Germanen nur Rom');
  ok(!art.pirat.has('pirat') && art.pirat.size >= 2, `Piraten überfallen Rom, Germanen, Konkordat oder freie Sektoren (${[...art.pirat].map(String).join(', ')})`);
  ok(Kern.feindlich('rom', 'ger') && Kern.feindlich('pirat', 'kon') && !Kern.feindlich('rom', 'kon') && !Kern.feindlich('ger', 'kon') && !Kern.feindlich('rom', 'rom'), 'feindlich(): Rom–Germanen, Piraten gegen alle, Konkordat neutral');
}

section('8. Schnittstelle: Wirkungen, Absichten, lesende Hilfen');
{
  const z = neu(3);
  let meldung = '';
  try { Kern.tick(z, { wirkungen: [{ typ: 'gibt_es_nicht' }] }); } catch (e) { meldung = e.message; }
  ok(/unbekannte Wirkung "gibt_es_nicht"/.test(meldung) && z.tick === 0, 'unbekannter Wirkungstyp wirft klar und ändert nichts');
  ok(Kern.tick(z, { wirkungen: [] }).ereignisse instanceof Array && z.tick === 1, 'leere Wirkungsliste ist der Normalfall');
  ok(Object.keys(Kern.WIRKUNGEN).sort().join() === Object.keys(require('../server/weltsim/wirkungen.js').KATALOG).sort().join(), 'WIRKUNGEN enthält genau den Katalog aus wirkungen.js (SUND-02, Test: test-wirkungen.js)');
  const r = Kern.tick(z);
  ok(r.zustand === z, 'tick() verändert den übergebenen Zustand und gibt ihn zurück');
  // Absichten: Rom hält still, Germanen normal
  const rom = (ev) => ev.filter((e) => e.fraktion === 'rom' && (e.typ === 'flotte_sammelt' || e.typ === 'flotte_aufbruch')).length;
  let seed = 0;
  while (rom(laufe(neu(seed), 200)) < 3) seed++;
  const a = neu(seed), b = neu(seed);
  a.absichten.rom = { max_active: 0 };
  const ea = laufe(a, 200), eb = laufe(b, 200);
  ok(rom(ea) === 0 && rom(eb) > 0, `Absicht max_active 0: Rom bricht nie auf (${rom(ea)} gegen ${rom(eb)} ohne Absicht)`);
  let mit = 0, ohne = 0;
  for (let s = 0; s < 10; s++) {
    const c = neu(s), d = neu(s);
    c.absichten.ger = { p_act: 1, aggr: 1 };
    const zaehle = (ev) => ev.filter((e) => e.fraktion === 'ger' && (e.typ === 'flotte_sammelt' || (e.typ === 'flotte_aufbruch' && e.art === 'angriff'))).length;
    mit += zaehle(laufe(c, 150)); ohne += zaehle(laufe(d, 150));
  }
  ok(mit > ohne, `Absicht p_act 1, aggr 1: Germanen greifen häufiger an (${mit} gegen ${ohne} Angriffe in 10 Läufen)`);
  const e2 = neu(4); Kern.tick(e2, { absichten: { rom: { max_active: 0 } } });
  ok(e2.absichten.rom.max_active === 0, 'tick(..., {absichten}) setzt die Absichten im Zustand');
  // lesende Hilfen
  const f = neu(2);
  const dat = Daten.datenVon(f);
  ok(Kern.besitzer(f, '0204') === 'rom' && Kern.besitzer(f, '1004') === 'ger' && Kern.besitzer(f, '0604') === 'kon' && Kern.besitzer(f, '0503') === null && Kern.besitzer(f, '0602') === 'pirat', 'besitzer()');
  ok(Kern.istPosten(f, '0204') === false && Kern.flottenAm(f, '0204').length === 1 && Kern.flottenAm(f, '0503').length === 0, 'istPosten(), flottenAm()');
  ok(Kern.abstand(dat, '0204', '0204') === 0 && Kern.abstand(dat, '0204', '0203') === 1 && Kern.abstand(dat, '0204', '1004') > 3 && Kern.abstand(dat, '0204', '9999') === 99, 'abstand(): Sprünge über Kanten des Flottennetzes, 99 = nicht erreichbar');
  ok(dat.nbr['0605'].includes('0705') && !dat.nbr['0605'].includes('0606') && dat.nbrP['0605'].includes('0606'), 'Flottennetz nur offene Kanten, Piratennetz alle (0605–0606)');
  ok(Kern.staerkeKlasse(0.5, f.werte) === 1 && Kern.staerkeKlasse(3.99, f.werte) === 1 && Kern.staerkeKlasse(4, f.werte) === 2 && Kern.staerkeKlasse(7.9, f.werte) === 2 && Kern.staerkeKlasse(8, f.werte) === 3 && Kern.staerkeKlasse(40, f.werte) === 3, 'staerkeKlasse(): Schwellen aus den Werten (4 und 8)');
  ok(Daten.datenVon(f).hauptwelten.rom === '0204' && dat.hauptwelten.ger === '1004', 'Hauptwelten aus den Daten abgeleitet (Klasse A der Reiche)');
}

section('9. Beendete Feldzüge werden entfernt, nichts ändert sich am Lauf (SUND-01 E)');
{
  const N = werte.speicher.angriff_behalt.wert;
  ok(Number.isInteger(N) && N >= 30 && N <= 200, `angriff_behalt ist ein Datenwert (${N} Ticks)`);
  const ohneEntfernen = (seed) => { const w = kopie(werte); w.speicher.angriff_behalt.wert = 1e9; return Kern.erzeuge({ karte, werte: w, seed }); };
  let gleichLauf = true, gekuerzt = 0, idsOk = true, messOk = true, maxLen = 0, alt = 0;
  for (const seed of [0, 1, 2, 3, 4, 5]) {
    const a = neu(seed), b = ohneEntfernen(seed), m = {};
    for (let i = 0; i < 1500; i++) {
      const ea = Kern.tick(a, { messung: m }).ereignisse, eb = Kern.tick(b).ereignisse;
      if (!gleich(ea, eb)) gleichLauf = false;
      maxLen = Math.max(maxLen, a.angriffe.length);
    }
    const strip = (z) => { const c = kopie(z); delete c.angriffe; delete c.naechsteAngriffId; delete c.werte; return c; };
    if (!gleich(strip(a), strip(b))) gleichLauf = false;
    if (a.angriffe.length < b.angriffe.length) gekuerzt++;
    if (a.naechsteAngriffId !== b.angriffe.length + 1) idsOk = false;
    if (a.angriffe.some((r) => r.t_ende !== null && a.tick - r.t_ende > N)) alt++;
    if (!gleich((m.angriffe_entfernt || []).concat(a.angriffe).sort((x, y) => x.id - y.id), b.angriffe)) messOk = false;
  }
  ok(gleichLauf, 'sechs Seeds à 1500 Ticks: Ereignisse je Tick und der ganze Zustand (außer angriffe) gleich mit und ohne Entfernen');
  ok(gekuerzt === 6 && alt === 0 && maxLen < 40, `die Liste wird gekürzt (höchste Länge ${maxLen}), kein beendeter Feldzug älter als ${N} Ticks bleibt`);
  ok(idsOk, 'Ids laufen weiter (naechsteAngriffId = Zahl aller je begonnenen Feldzüge + 1), keine Wiederverwendung');
  ok(messOk, 'entfernte Feldzüge + Rest = die volle Liste: das Messobjekt (messung.angriffe_entfernt) bekommt jeden Datensatz');
  // Altstand ohne Zähler: aus der höchsten Id abgeleitet
  const z = neu(2);
  laufe(z, 200);
  const hoechste = z.angriffe.reduce((x, r) => Math.max(x, r.id), 0);
  delete z.naechsteAngriffId;
  laufe(z, 200);
  const neue = z.angriffe.filter((r) => r.t0 > 200).map((r) => r.id);
  ok(neue.length > 0 && Math.min(...neue) > hoechste && Number.isInteger(z.naechsteAngriffId), 'Zustand ohne naechsteAngriffId: der Zähler beginnt bei höchste Id + 1');
  // von Hand eingetragene Feldzüge (Tests) kollidieren nicht mit der nächsten Id
  const y = neu(3); y.angriffe.push({ id: 9, t0: 0, ziel: '0204', von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: null, t_ende: 1, ausgang: 'abgewehrt', phase: 'marsch', t_marsch: 0, stuetz: null, flotten: [] });
  laufe(y, 100);
  ok(new Set(y.angriffe.map((r) => r.id)).size === y.angriffe.length, 'Ids bleiben eindeutig, auch neben von Hand eingetragenen');
}

console.log(`\n${n - fails}/${n} bestanden`);
process.exit(fails ? 1 : 0);
