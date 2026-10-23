'use strict';
// Kennzahlen der Weltsimulation für Werkzeuge und Tests (Port von run/summary/window_stats/atk_summary in sim_sund.py und der Sicht-Messung
// aus sim_sund_sicht.py). NICHT Teil des Sim-Zustands: misst von außen, über Tick-Ergebnisse und das optionale messung-Objekt von tick().
const Kern = require('./kern.js');
const Daten = require('./daten.js');

const mittel = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

// Ein Lauf: { karte, werte, seed, ticks } (ticks sonst aus werte.ticks). Optional sichtRadien: Liste von Sichtweiten für die Sicht-Messung; eingriff(z, tick) -> [Wirkung] (Crew-Wirkungen vor dem Tick).
function lauf({ karte, werte, seed, ticks, sichtRadien = null, verzoegerung = null, eingriff = null }) {
  const z = Kern.erzeuge({ karte, werte, seed });
  const T = ticks !== undefined && ticks !== null ? ticks : z.werte.ticks;
  const d = Daten.datenVon(z);
  const m = {};
  const staerke = { rom: [], ger: [], kon: [] };
  const erstSicht = {};
  const ereignisse = [];
  for (let i = 0; i < T; i++) {
    const r = Kern.tick(z, { messung: m, wirkungen: eingriff ? eingriff(z, i) : [] });   // eingriff (SUND-02b A1, tools/sim-crew-posten.js): Wirkungen der Crew vor dem Tick, der Aufrufer prüft sie (Kern.pruefeWirkung)
    for (const e of r.ereignisse) ereignisse.push(e);
    for (const f of Kern.FRAKTIONEN) staerke[f].push(z.flotten.filter((fl) => fl.fraktion === f).reduce((s, fl) => s + fl.staerke, 0));
    if (sichtRadien) beobacheSicht(z, d, sichtRadien, erstSicht);
  }
  const alle = (m.angriffe_entfernt || []).concat(z.angriffe);   // beendete Feldzüge hält der Zustand nur angriff_behalt Ticks: die entfernten kommen über die Messung
  const haefen = (f) => d.codes.filter((c) => z.hexe[c].besitzer === f && d.hex[c].hafen).length;
  const hw = d.hauptwelten;
  const anteil = (k, f) => (m[k + '_' + f] || 0) / Math.max(1, k === 'mdef' || k === 'ndef' ? T : (m['fleet_ticks_' + f] || 0));
  const reich = [haefen('rom'), haefen('ger')];
  const res = {
    z, ereignisse, ticks: T,
    captures: m.captures || 0, battles: m.battles || 0, first_battle: m.first_battle || T, posten: m.posten || 0, posten_lost: m.posten_lost || 0,
    rom_hafen: haefen('rom'), ger_hafen: haefen('ger'), kon_hafen: haefen('kon'),
    hw_lost: Object.keys(hw).some((f) => z.hexe[hw[f]].besitzer !== f) ? 1 : 0,
    dominance: Math.max(...reich) / Math.max(1, reich[0] + reich[1]),
    unsup: { rom: anteil('unsupplied', 'rom'), ger: anteil('unsupplied', 'ger'), kon: anteil('unsupplied', 'kon') },
    mdef: { rom: anteil('mdef', 'rom'), ger: anteil('mdef', 'ger'), kon: anteil('mdef', 'kon') },
    strength: { rom: mittel(staerke.rom.slice(-50)), ger: mittel(staerke.ger.slice(-50)), kon: mittel(staerke.kon.slice(-50)) },
    kon_marken: z.marken.kon, attacks: m.attacks || 0, claims: m.claims || 0, rr: m.rr || 0, pb: m.pb || 0,
    plost_pirat: m.plost_pirat || 0, plost_reich: m.plost_reich || 0, abort: m.abort || 0, feld_loss: m.feld_loss || 0,
    stage_share: (m.stage_ticks || 0) / Math.max(1, Kern.FRAKTIONEN.reduce((s, f) => s + (m['fleet_ticks_' + f] || 0), 0)),
    atk: fenster(z, d, alle),
  };
  if (sichtRadien) res.sicht = sichtZeilen(z, d, sichtRadien, erstSicht, verzoegerung !== null ? verzoegerung : z.werte.sicht.verzoegerung, alle);
  return res;
}

// Je Feldzug: Vorlauf (Start bis Ankunft), Belagerung (Ankunft bis Ende), Anteil der Karte, den die Crew rechtzeitig erreichen könnte,
// wenn sie ab Start (A), erst 2 Sprünge vor der Ankunft (B) oder erst mit Marschbeginn (C) gewarnt wird (window_stats im Prototyp).
function fenster(z, d, angriffe = z.angriffe) {
  const out = [];
  const knoten = d.codes.filter((c) => z.hexe[c].besitzer !== 'pirat');
  for (const rec of angriffe) {
    if (rec.t_ende === null || !rec.relevant || rec.ausgang === 'abgebrochen') continue;
    const t0 = rec.t0, te = rec.t_ende;
    const tm = rec.t_marsch !== null ? rec.t_marsch : t0;
    const ta = rec.t_an !== null ? rec.t_an : te;
    const teil = (tw) => {
      let nIn = 0, nEng = 0;
      for (const c of knoten) {
        const tc = tw + 1 + Daten.abstand(d, c, rec.ziel);
        if (tc <= ta) nIn++;
        if (tc <= te) nEng++;
      }
      return [nIn / knoten.length, nEng / knoten.length];
    };
    const [aIn, aEng] = teil(t0), [bIn, bEng] = teil(Math.max(t0, ta - 2)), [cIn, cEng] = teil(tm);
    out.push({ art: rec.art, ausgang: rec.ausgang, zielArt: rec.zielArt, vor: ta - t0, bel: te - ta, fenster: te - t0, sam: tm - t0,
      a_in: aIn, a_eng: aEng, b_in: bIn, b_eng: bEng, c_in: cIn, c_eng: cEng });
  }
  return out;
}

function zusammenfassung(rs) {
  const avg = (key, sub) => mittel(rs.map((r) => (sub ? r[key][sub] : r[key])));
  return {
    eroberungen: avg('captures'), schlachten: avg('battles'), sch_reiche: avg('rr'), sch_piraten: avg('pb'), angriffe: avg('attacks'), ansprueche: avg('claims'),
    erste_schlacht: avg('first_battle'), posten: avg('posten'), verl_pirat: avg('plost_pirat'), verl_reich: avg('plost_reich'),
    rom_h: avg('rom_hafen'), ger_h: avg('ger_hafen'), kon_h: avg('kon_hafen'), hw_verloren: avg('hw_lost'), dominanz_max: Math.max(...rs.map((r) => r.dominance)),
    unversorgt_rom: avg('unsup', 'rom'), unversorgt_ger: avg('unsup', 'ger'), unversorgt_kon: avg('unsup', 'kon'),
    m_mangel_rom: avg('mdef', 'rom'), staerke_rom: avg('strength', 'rom'), staerke_ger: avg('strength', 'ger'), staerke_kon: avg('strength', 'kon'),
    kon_marken: avg('kon_marken'),
    still: rs.filter((r) => r.captures === 0 && r.battles < 3).length / rs.length,
    kollaps: rs.filter((r) => r.rom_hafen <= 1 || r.ger_hafen <= 1).length / rs.length,
  };
}

// Eingreif-Fenster über alle Läufe (atk_summary im Prototyp). art: 'reich' | 'pirat'.
function angriffsUebersicht(rs, art = 'reich', ticks = 300) {
  const a = [];
  for (const r of rs) for (const x of r.atk) if (x.art === art) a.push(x);
  const n = Math.max(1, a.length);
  const med = (k) => median(a.map((x) => x[k]));
  const avg = (k) => mittel(a.map((x) => x[k]));
  const anteil = (f) => a.filter(f).length / n;
  return {
    je100: a.length / rs.length / ticks * 100, vorlauf: med('vor'), sammeln: med('sam'), belagerung: med('bel'), fenster: med('fenster'),
    fenster_ge4: anteil((x) => x.fenster >= 4),
    A_rechtzeitig: avg('a_in'), A_eingreifen: avg('a_eng'), B_rechtzeitig: avg('b_in'), B_eingreifen: avg('b_eng'), C_rechtzeitig: avg('c_in'), C_eingreifen: avg('c_eng'),
    capture: anteil((x) => x.ausgang === 'capture'), posten: anteil((x) => x.ausgang === 'posten'), abgewehrt: anteil((x) => x.ausgang === 'abgewehrt'),
  };
}

// ---------- Sicht-Messung (sim_sund_sicht.py): wann sieht Rom einen germanischen Angriff, wenn es nur sieht, was innerhalb von r Sprüngen
// um römische Häfen, Posten und Flotten liegt? Wird je Tick nach tick() aufgerufen.
function beobacheSicht(z, d, radien, erst) {
  const sens = d.codes.filter((c) => z.hexe[c].besitzer === 'rom' && (d.hex[c].hafen || z.hexe[c].posten));
  for (const fl of z.flotten) if (fl.fraktion === 'rom') sens.push(fl.ort);
  for (const rec of z.angriffe) {
    if (rec.von !== 'ger' || rec.art !== 'reich' || rec.t_ende !== null) continue;
    const knoten = new Set(z.flotten.filter((fl) => fl.angriff === rec.id).map((fl) => fl.ort));
    if (rec.phase === 'sammeln' && rec.stuetz) knoten.add(rec.stuetz);
    if (!knoten.size) continue;
    let dist = 99;
    if (sens.length) for (const a of knoten) for (const b of sens) dist = Math.min(dist, Daten.abstand(d, a, b));
    const fr = erst[rec.id] || (erst[rec.id] = {});
    for (const r of radien) if (!(r in fr) && dist <= r) fr[r] = z.tick;
  }
}

function sichtZeilen(z, d, radien, erst, verz, angriffe = z.angriffe) {
  const alle = d.codes.filter((c) => z.hexe[c].besitzer !== 'pirat');
  const out = [];
  for (const rec of angriffe) {
    if (rec.von !== 'ger' || rec.art !== 'reich' || rec.t_ende === null || rec.ausgang === 'abgebrochen') continue;
    const te = rec.t_ende, ta = rec.t_an !== null ? rec.t_an : te, tm = rec.t_marsch !== null ? rec.t_marsch : rec.t0;
    const fr = erst[rec.id] || {};
    const zeile = {};
    for (const r of radien) {
      const tw = r in fr ? Math.min(fr[r] + verz, ta) : ta;
      let nIn = 0, nEng = 0;
      for (const c of alle) {
        const tc = tw + 1 + Daten.abstand(d, c, rec.ziel);
        if (tc <= ta) nIn++;
        if (tc <= te) nEng++;
      }
      zeile[r] = { vor: ta - tw, vor_marsch: r in fr && fr[r] + verz <= tm, n_in: nIn / alle.length, n_eng: nEng / alle.length };
    }
    out.push(zeile);
  }
  return out;
}

function sichtTabelle(rs, radien) {
  const zeilen = rs.flatMap((r) => r.sicht || []);
  return radien.map((r) => ({
    sichtweite: r, angriffe: zeilen.length,
    vor_marsch: zeilen.filter((x) => x[r].vor_marsch).length / Math.max(1, zeilen.length),
    vorwarnung: median(zeilen.map((x) => x[r].vor)),
    rechtzeitig: mittel(zeilen.map((x) => x[r].n_in)), mittendrin: mittel(zeilen.map((x) => x[r].n_eng)),
  }));
}

const fmt = (s) => Object.entries(s).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join(' ');

module.exports = { lauf, fenster, zusammenfassung, angriffsUebersicht, sichtTabelle, fmt, mittel, median };
