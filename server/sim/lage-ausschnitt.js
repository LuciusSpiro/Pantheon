'use strict';
// SUND-03 A: Weltausschnitt für den Grobplan des Lage-Spielleiters (nur Modus Freie Fahrt Sund, game.weltsim). Eine Lesesicht, kein Zustand: kompakt-JSON (nie eingerückt), Schlüssel sortiert,
// deterministisch (gleicher Spielstand = gleicher Text). Inhalt: die Crew (Anzahl, Hex, Rang, Schiffsstufe: KEINE Spielernamen), die Orte im Umkreis, die Flotten (belagert, unterwegs, gefallen
// immer, ruhige zählbar), die letzten Ereignisse der Sim (ohne konvoi: der Handel meldet fast in jedem Tick eines), die Chronik (ersetzt die Chronik aus mission/context.js, nicht doppeln),
// der Ruf je Fraktion, aktive Embargos und Mieten, die Kennzahl „siegreiche Seite“ (Regie.lage). Der Spielleiter erzählt nur, was hier und in der Ereignisliste der Sim steht.
//
//   ausschnitt(game, { stufe })                   Stufe 0 voll bis 3 (Daten regie-werte.json, ausschnitt.stufen) -> { stufe, zeichen, text }
//   ausschnittPassend(game, { maxZeichen })       wählt die kleinste Kürzung (Stufe 0 bis 3), die unter maxZeichen bleibt (Standard: Obergrenze aus den Daten) -> { stufe, zeichen, text, passt }
// Nie gekürzt: belagert, unterwegs, gefallen (Wendepunkte, bei Stufe 2 nur die letzten 3) und die Crew-Zeile. Obergrenze 4800 Zeichen ≈ 1800 Gemma-Token (Messung der Erkundung: 2,7 Zeichen je Token).
const Daten = require('../weltsim/daten.js');
const Context = require('../mission/context.js');
const Ruf = require('./ruf.js');
const Marken = require('./marken.js');
const Regie = require('./regie-befehle.js');

const A = require('../../content/welt/regie-werte.json').werte.ausschnitt.wert;
const WICHTIG = ['hafen_gefallen', 'posten_verloren', 'hauptwelt_gefallen'];   // stehen unter flotten.gefallen, nicht noch einmal bei den Ereignissen
const r1 = (x) => Math.round(x * 10) / 10;

// Spielernamen dürfen nirgends im Text stehen (nur die Anzahl): was in einem Freitext (Chronik) vorkommt, wird ersetzt
function ohneNamen(text, namen) {
  let t = String(text == null ? '' : text);
  // auch ein längerer Name im Text (im Spiel auf 12 Zeichen gekürzt gespeichert) verschwindet ganz
  for (const n of namen) if (n.length >= 2) t = t.replace(new RegExp('(?<![\\wäöüÄÖÜß])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\wäöüÄÖÜß]*', 'gi'), 'Crew');
  return t;
}
function spielerNamen(game) {
  return (game.players || []).map((p) => (p && typeof p.name === 'string' ? p.name.trim() : '')).filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
}

function crewHex(game) {
  try { return game.ship && game.ship.scene ? Marken.hexVon(game.ship.scene) : null; } catch (e) { return null; }
}
const art = (d, z, c) => { const h = d.hex[c]; return h.hafen ? 'hafen' + h.hafen : (z.hexe[c].posten ? 'posten' : 'frei'); };

function ereignisKurz(e, d) {
  const x = { n: e.n, t: e.typ, f: e.fraktion };
  for (const k of ['art', 'grund', 'gegen', 'an', 'alt', 'neu', 'besitzer', 'durch', 'dauer', 'klasse']) if (e[k] !== undefined && e[k] !== null) x[k] = e[k];
  if (Array.isArray(e.waren)) x.waren = e.waren.join('');
  for (const k of ['ort', 'ziel', 'von', 'stuetzpunkt']) if (e[k + 'Name']) x[k] = e[k + 'Name'];
  return x;
}

function bauen(game, st, namen) {
  const ws = game.weltsim, z = ws.zustand, d = Daten.datenVon(z);
  const hex = crewHex(game);
  const anker = hex && d.hex[hex] ? hex : d.hauptwelten.rom;   // keine Crew im Sim-Gebiet (Randfall): Umkreis um die römische Hauptwelt, crew.hex bleibt null
  const nah = (c) => Daten.abstand(d, c, anker) <= st.radius;
  const name = (c) => d.hex[c].name;

  const orte = d.codes.filter((c) => nah(c) && (d.hex[c].hafen || z.hexe[c].posten || z.hexe[c].besitzer)).map((c) => {
    const nd = z.hexe[c], e = { h: c, n: name(c), a: art(d, z, c), b: nd.besitzer || 'frei' };
    if (d.hex[c].hafen) e.abw = r1(nd.abwehr); else if (nd.posten) e.abw = r1(nd.garnison);
    if (nd.crew === true) e.crew = 1;
    return e;
  });
  const staerkeVon = (id) => r1(z.flotten.filter((f) => f.angriff === id).reduce((s, f) => s + f.staerke, 0));
  const aktiv = z.angriffe.filter((a) => a.t_ende === null);
  const belagert = aktiv.filter((a) => a.t_an !== null).map((a) => ({ ziel: name(a.ziel), von: a.von, art: a.art, seit: z.tick - a.t_an, st: staerkeVon(a.id), b: z.hexe[a.ziel].besitzer || 'frei' }));
  const unterwegs = aktiv.filter((a) => a.t_an === null).map((a) => {
    const e = { ziel: name(a.ziel), von: a.von, art: a.art, ph: a.phase || 'marsch', st: staerkeVon(a.id) };
    if (a.stuetz) e.stuetz = name(a.stuetz);
    return e;
  });
  const gefallen = (ws.ereignisse || []).filter((e) => WICHTIG.includes(e.typ)).slice(-st.gefallen).map((e) => ({ n: e.n, t: e.typ, ort: e.ortName, von: e.alt || e.besitzer, an: e.neu || e.durch }));
  const imUmkreis = z.flotten.filter((fl) => nah(fl.ort) || (fl.ziel && fl.befehl !== 'heim' && nah(fl.ziel)));
  const aktivFl = imUmkreis.filter((fl) => fl.befehl !== 'heim');
  const ruhig = imUmkreis.filter((fl) => fl.befehl === 'heim');
  const flKurz = (fl) => {
    const e = { id: fl.id, f: fl.fraktion, ort: name(fl.ort), st: r1(fl.staerke), bef: fl.befehl };
    if (fl.ziel && fl.befehl !== 'heim') e.ziel = name(fl.ziel);
    if (fl.versorgung < 1) e.mangel = 1;
    if (fl.miete) e.miete = fl.miete.an;
    return e;
  };
  const flotten = { belagert, unterwegs, gefallen, aktiv: aktivFl.map(flKurz) };
  if (st.ruhige_zaehlen) flotten.ruhig = ruhig.length; else flotten.ruhig = ruhig.map(flKurz);

  const ev = (ws.ereignisse || []).filter((e) => e.typ !== 'konvoi' && !WICHTIG.includes(e.typ)).slice(-st.ereignisse).map((e) => ereignisKurz(e, d));
  const chronik = ((game.weltstand && game.weltstand.data && game.weltstand.data.chronik) || []).slice(-st.chronik).map((c) => ohneNamen(String((c && c.text) || ''), namen).slice(0, A.chronik_zeichen));
  const lage = Regie.lage(game);
  const embargos = Object.entries(z.embargo || {}).filter(([, e]) => z.tick < e.bis).map(([gegen, e]) => ({ gegen, waren: e.waren.join(''), rest: e.bis - z.tick })).sort((a, b) => (a.gegen < b.gegen ? -1 : 1));
  const mieten = z.flotten.filter((fl) => fl.miete).map((fl) => ({ id: fl.id, an: fl.miete.an, rest: fl.miete.bis - z.tick, st: r1(fl.staerke) }));
  return {
    tick: ws.tickZahl,
    crew: { anzahl: (game.players || []).filter((p) => p && p.connected !== false).length || (game.players || []).length, hex: hex && d.hex[hex] ? hex : null, ort: hex && d.hex[hex] ? name(hex) : null, rang: Ruf.rang(game), stufe: (game.ship && game.ship.stufe) | 0 },
    ruf: { rom: Ruf.ruf(game, 'rom'), ger: Ruf.ruf(game, 'ger'), kon: Ruf.ruf(game, 'kon') },
    lage: { sieger: lage.sieger, anteil: lage.anteil },
    orte, flotten, ereignisse: ev, chronik, embargos, mieten,
  };
}

function ausschnitt(game, { stufe = 0 } = {}) {
  if (!game.weltsim) return { stufe: 0, zeichen: 0, text: '' };
  const s = Math.max(0, Math.min(A.stufen.length - 1, Math.floor(Number(stufe)) || 0));
  const text = JSON.stringify(Context.sortKeys(bauen(game, A.stufen[s], spielerNamen(game))));
  return { stufe: s, zeichen: text.length, text };
}

function ausschnittPassend(game, { maxZeichen = A.max_zeichen } = {}) {
  let letzter = null;
  for (let s = 0; s < A.stufen.length; s++) {
    letzter = ausschnitt(game, { stufe: s });
    if (letzter.zeichen <= maxZeichen) return Object.assign(letzter, { passt: true });
  }
  return Object.assign(letzter || { stufe: 0, zeichen: 0, text: '' }, { passt: false });
}

module.exports = { ausschnitt, ausschnittPassend, ohneNamen, spielerNamen, STUFEN: A.stufen, MAX_ZEICHEN: A.max_zeichen };
