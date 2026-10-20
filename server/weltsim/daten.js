'use strict';
// Daten der Weltsimulation: lädt und prüft content/welt/sund-sim.json (Karte) und sund-sim-werte.json (Werte), baut Nachbarschaft,
// BFS-Abstände und nächste Schritte für das Flottennetz (offene Kanten) und das Piratennetz (alle Kanten mit piraten-Flag).
// Nur laden() liest Dateien (beim Start). Alles andere ist rein.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'content', 'welt');
const KARTE_FORMAT = 'weltsim-karte/1';
const WERTE_FORMAT = 'weltsim-werte/1';
// Schlüssel der Werte (wie DEFAULT im Prototyp sim_sund.py): fehlt einer, bricht die Prüfung ab.
const WERT_SCHLUESSEL = ['ticks', 'prod', 'civil_n', 'civil_m', 'tax', 'up_u', 'up_t', 'active_mult', 'overext', 'mangel_malus', 'mdef_decay', 'mdef_neubau',
  'decay', 'cap', 'init_frac', 'neubau', 'cost_e', 'cost_u', 'bonus', 'base_def', 'regen', 'garrison', 'posten_e', 'claim_ticks', 'k', 'retreat', 'aggr',
  'p_act', 'attack_ratio', 'max_active', 'price_sell', 'price_buy', 'trade_cap', 'embargo', 'pirat_cap', 'pirat_raid', 'trade', 'war', 'stuetz', 'feld_decay',
  'sammeln_min', 'sammeln_max', 'stuetz_cap'];
const FRAKTIONEN = ['rom', 'ger', 'kon'];

function laden(dir = DIR) {
  const lies = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return { karte: lies('sund-sim.json'), werte: lies('sund-sim-werte.json') };
}

// Prüft Karte und Werte (wirft mit klarer Meldung) und gibt die Werte flach zurück ({k: 0.1, cap: {...}, sicht: {...}, ...}).
function werteFlach(werte) {
  if (!werte || werte.format !== WERTE_FORMAT) throw new Error(`Werte: Format ${WERTE_FORMAT} erwartet`);
  const w = {};
  for (const k of WERT_SCHLUESSEL) {
    if (!werte.werte || !werte.werte[k] || !('wert' in werte.werte[k])) throw new Error(`Werte: Wert "${k}" fehlt`);
    w[k] = JSON.parse(JSON.stringify(werte.werte[k].wert));
  }
  for (const k of ['bevoelkerung', 'punktwerte', 'staerkeklassen', 'konvoi']) {
    if (!werte[k] || !('wert' in werte[k])) throw new Error(`Werte: Abschnitt "${k}" fehlt`);
    w[k] = JSON.parse(JSON.stringify(werte[k].wert));
  }
  if (!werte.sicht || !werte.sicht.weite || !werte.sicht.verzoegerung) throw new Error('Werte: Abschnitt "sicht" fehlt');
  w.sicht = { weite: werte.sicht.weite.wert, verzoegerung: werte.sicht.verzoegerung.wert };
  if (!werte.speicher || !werte.speicher.angriff_behalt || !(werte.speicher.angriff_behalt.wert >= 0)) throw new Error('Werte: Abschnitt "speicher" (angriff_behalt) fehlt');
  w.angriff_behalt = werte.speicher.angriff_behalt.wert;
  return w;
}

function pruefeKarte(karte, w) {
  if (!karte || karte.format !== KARTE_FORMAT) throw new Error(`Karte: Format ${KARTE_FORMAT} erwartet`);
  const codes = new Set();
  for (const h of karte.hexe) {
    if (codes.has(h.code)) throw new Error(`Karte: Hex ${h.code} doppelt`);
    codes.add(h.code);
    if (h.hafenklasse && !(h.hafenklasse in w.cap && h.hafenklasse in w.bevoelkerung && h.hafenklasse in w.base_def && h.hafenklasse in w.neubau && h.hafenklasse in w.bonus)) {
      throw new Error(`Karte: Hafenklasse ${h.hafenklasse} (${h.code}) ohne Werte`);
    }
  }
  for (const e of karte.kanten) if (!codes.has(e.a) || !codes.has(e.b)) throw new Error(`Karte: Kante ${e.a}-${e.b} mit unbekanntem Hex`);
}

function bfs(nbr, codes) {
  const dist = {}, nxt = {};
  for (const s of codes) {
    const d = { [s]: 0 }, f = {}, q = [s];
    for (let i = 0; i < q.length; i++) {
      const x = q[i];
      for (const y of nbr[x]) {
        if (!(y in d)) { d[y] = d[x] + 1; f[y] = x === s ? y : f[x]; q.push(y); }
      }
    }
    dist[s] = d; nxt[s] = f;
  }
  return { dist, nxt };
}

// Abgeleitete, unveränderliche Kartendaten. Hexe in der Reihenfolge der Datei (bestimmt die Iterationsreihenfolge der Regeln).
function baue(karte) {
  const codes = karte.hexe.map((h) => h.code);
  const hex = {};
  for (const h of karte.hexe) hex[h.code] = { code: h.code, name: h.name, fraktion: h.simFraktion, hafen: h.hafenklasse || '', quellen: h.quellen.slice() };
  const nbr = {}, nbrP = {};
  for (const c of codes) { nbr[c] = new Set(); nbrP[c] = new Set(); }
  for (const e of karte.kanten) {
    if (e.flotte) { nbr[e.a].add(e.b); nbr[e.b].add(e.a); }
    if (e.piraten) { nbrP[e.a].add(e.b); nbrP[e.b].add(e.a); }
  }
  const sortiert = (m) => Object.fromEntries(Object.entries(m).map(([c, s]) => [c, [...s].sort()]));
  const n1 = sortiert(nbr), n2 = sortiert(nbrP);
  const a = bfs(n1, codes), b = bfs(n2, codes);
  // Hauptwelt = Hafen der Klasse A, der zu Beginn Rom oder den Germanen gehört (Palatina 0204, Hrafnheim 1004).
  const hauptwelten = {};
  for (const c of codes) if (hex[c].hafen === 'A' && (hex[c].fraktion === 'rom' || hex[c].fraktion === 'ger')) hauptwelten[hex[c].fraktion] = c;
  return { codes, hex, nbr: n1, nbrP: n2, dist: a.dist, nxt: a.nxt, distP: b.dist, nxtP: b.nxt, hauptwelten };
}

// Daten zum Zustand: aus zustand.karte, einmal je Kartenobjekt zwischengespeichert (nach JSON-Roundtrip neu gebaut).
const ZWISCHEN = new WeakMap();
function datenVon(zustand) {
  let d = ZWISCHEN.get(zustand.karte);
  if (!d) { d = baue(zustand.karte); ZWISCHEN.set(zustand.karte, d); }
  return d;
}

// Sprünge über Kanten im Flottennetz (offene Kanten), 99 wenn nicht erreichbar.
function abstand(daten, a, b) {
  const d = daten.dist[a];
  return d && b in d ? d[b] : 99;
}

module.exports = { DIR, FRAKTIONEN, WERT_SCHLUESSEL, laden, werteFlach, pruefeKarte, baue, datenVon, abstand };
