'use strict';
// SUND-02b B: Ruf je Fraktion und Dienstgrade von Rom, nur im Modus Freie Fahrt Sund (game.weltsim). Action-Layer wie kriegslage.js.
// Ruf ist ein Kann, nie ein Muss: er öffnet Zugang (Werft-Stufen über game.rufErreicht), er erzwingt nichts, Ablehnen kostet nichts.
// Zustand: game.weltsim.ruf = { rom, ger, kon } (Zahlen, Start 0). Er gilt für die ganze Crew, nur der Server schreibt; er gehört NICHT zum Sim-Zustand des Kerns
// (der bleibt rein und bitgleich zum Prototyp), sondern wie das Gedächtnis der Kommandanten zum Spielaufsatz. Gespeichert wird er als welt.sim.ruf (optional, Altstände = 0).
// Alle Zahlen (Grenzen, Schwellen, Quellen) stehen in content/welt/ruf-werte.json, Funktexte in content/flotte/ruf.json.
//
//   ruf(game, fraktion)            Ruf bei einer Fraktion (ohne Modus 0)
//   rang(game) / rangVon(wert)     Rang-Id von Rom ('miles' … 'legat'); ohne Modus null
//   rangInfo(game)                 { id, name, index, ab, bis } (bis: Schwelle des nächsten Rangs | null)
//   rufErreicht(game, rangId)      Rang der Crew >= verlangter Rang. OHNE Modus: immer true (Kampagne, Werft ohne Ruf-System). Unbekannte Rang-Id im Modus: false
//   aendern(game, fraktion, delta) einen Wert verschieben (geklemmt auf die Grenzen der Fraktion) -> { alt, neu }
//   anwenden(game, wirkungen)      alle ruf_aenderung der Liste (plus `folge` der Quelle) anwenden; Aufrufer: Kriegslage.tickMit, nach dem Tick -> { vorher, nachher } Rang-Ids
//   meldeRang(game, vorher, nachher)  Funk bei einem Rangwechsel (nach dem Commit des Ticks)
//   szeneSieg(S, ortGehalten) / szeneFlucht(S)   Regeln der Sim-Szene: die Wirkung, die ein Szenenende gibt ([] wenn die Quelle fehlt, z. B. Flucht vor Piraten)
//   snapshot(game) / schluessel(game)   Anzeigeblock world.ruf (nur Daten) und sein Änderungsschlüssel; nur im Modus
//   toSave(ws) / lesen(block) / neu()
//   debug(game, args)              nur --debug: ruf [rom|ger|kon] [wert] – Wert setzen (geklemmt, Rangwechsel wird gemeldet) bzw. Stand ausgeben (Fehlertext oder null)
const fs = require('fs');
const path = require('path');
const DATEN = require('../../content/welt/ruf-werte.json');

const TEXTE_FILE = path.join(__dirname, '..', '..', 'content', 'flotte', 'ruf.json');
const W = DATEN.werte;
const FRAKTIONEN = Object.keys(W.fraktionen.wert);
const RAENGE = W.raenge.wert;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const r2 = (v) => Math.round(v * 100) / 100;

let texteCache = null;
function texte() {
  if (texteCache) return texteCache;
  try { texteCache = JSON.parse(fs.readFileSync(TEXTE_FILE, 'utf8')); } catch (e) { texteCache = {}; }
  return texteCache;
}

const neu = () => Object.fromEntries(FRAKTIONEN.map((f) => [f, 0]));
const klemmen = (fraktion, v) => { const g = W.fraktionen.wert[fraktion]; return r2(Math.min(g.max, Math.max(g.min, v))); };

const ruf = (game, fraktion) => {
  const ws = game.weltsim;
  return ws && ws.ruf && has(ws.ruf, fraktion) && Number.isFinite(ws.ruf[fraktion]) ? ws.ruf[fraktion] : 0;
};

// höchster Rang, dessen Schwelle erreicht ist (RAENGE ist aufsteigend)
function rangIndexVon(wert) {
  let i = 0;
  for (let k = 0; k < RAENGE.length; k++) if (wert >= RAENGE[k].ab) i = k;
  return i;
}
const rangVon = (wert) => RAENGE[rangIndexVon(wert)].id;
const rang = (game) => (game.weltsim ? rangVon(ruf(game, 'rom')) : null);
function rangInfo(game) {
  if (!game.weltsim) return null;
  const i = rangIndexVon(ruf(game, 'rom'));
  return { id: RAENGE[i].id, name: RAENGE[i].name, index: i, ab: RAENGE[i].ab, bis: i + 1 < RAENGE.length ? RAENGE[i + 1].ab : null };
}
function rufErreicht(game, rangId) {
  if (!game.weltsim) return true;   // kein Ruf-System (Kampagne, Limes, Labor, Arena): jede Bedingung ist erfüllt, nichts wird angezeigt
  const verlangt = RAENGE.findIndex((r) => r.id === rangId);
  if (verlangt < 0) return false;
  return rangIndexVon(ruf(game, 'rom')) >= verlangt;
}

function aendern(game, fraktion, delta) {
  const ws = game.weltsim;
  if (!ws || !ws.ruf || !has(ws.ruf, fraktion)) return { alt: 0, neu: 0 };
  const alt = ws.ruf[fraktion];
  if (!Number.isFinite(delta)) return { alt, neu: alt };
  ws.ruf[fraktion] = klemmen(fraktion, alt + delta);
  return { alt, neu: ws.ruf[fraktion] };
}

function anwenden(game, wirkungen) {
  const vorher = rang(game);
  for (const wk of wirkungen || []) {
    if (!wk || wk.typ !== 'ruf_aenderung') continue;
    aendern(game, wk.fraktion, wk.delta);
    const folge = W.quellen.wert[wk.grund] && W.quellen.wert[wk.grund].folge;   // Nebenwirkung der Quelle (z. B. Germanen sinken): aus den Daten, nicht vom Aufrufer
    if (folge) for (const [f, d] of Object.entries(folge)) aendern(game, f, d);
  }
  return { vorher, nachher: rang(game) };
}

function meldeRang(game, vorher, nachher) {
  if (!vorher || !nachher || vorher === nachher) return;
  const i0 = RAENGE.findIndex((r) => r.id === vorher); const i1 = RAENGE.findIndex((r) => r.id === nachher);
  const T = texte();
  const text = ((i1 > i0 ? T.auf : T.ab) || {})[nachher];
  if (!text) return;
  game.emit('radio', { from: T.sprecher || 'Oberkommando', text, lage: 1, r: 1, ruf: 1 });
}

// ---------- Regeln der Sim-Szene ----------
// grund-Schlüssel: sieg_feld_<fraktion> | ort_gehalten_<fraktion> | fahrerflucht[_ort]_<fraktion>; fehlt der Eintrag in `quellen`, gibt es nichts (Piraten ignorieren).
const quelle = (grund) => (has(W.quellen.wert, grund) ? [{ typ: 'ruf_aenderung', fraktion: W.quellen.wert[grund].fraktion, delta: W.quellen.wert[grund].delta, grund }] : []);
const szeneSieg = (S, ortGehalten) => quelle((ortGehalten ? 'ort_gehalten_' : 'sieg_feld_') + S.fraktion);
const szeneFlucht = (S) => quelle('fahrerflucht' + (S.ort ? '_ort_' : '_') + S.fraktion);

// ---------- Anzeige (nur Daten) ----------
// world.ruf = { rom, ger, kon, rang: Id, name, ab: Schwelle des Rangs, bis: nächste Schwelle | null }
function snapshot(game) {
  const ri = rangInfo(game);
  if (!ri) return null;
  return { rom: ruf(game, 'rom'), ger: ruf(game, 'ger'), kon: ruf(game, 'kon'), rang: ri.id, name: ri.name, ab: ri.ab, bis: ri.bis };
}
const schluessel = (game) => (game.weltsim ? FRAKTIONEN.map((f) => ruf(game, f)).join(':') : null);

// ---------- Weltstand ----------
function toSave(ws) {
  if (!ws || !ws.ruf || !FRAKTIONEN.some((f) => ws.ruf[f])) return null;   // 0/0/0 ist der Altstand: kein Block
  return Object.fromEntries(FRAKTIONEN.map((f) => [f, ws.ruf[f]]));
}
// müll-fester Leser: fehlende oder kaputte Werte = 0, alles auf die Grenzen geklemmt
function lesen(b) {
  const out = neu();
  if (!b || typeof b !== 'object' || Array.isArray(b)) return out;
  for (const f of FRAKTIONEN) if (Number.isFinite(b[f])) out[f] = klemmen(f, b[f]);
  return out;
}

// Debug: ohne Argumente den Stand als Funk-Hinweis ausgeben (ODA), mit `<fraktion> <wert>` setzen
function debug(game, args) {
  const ws = game.weltsim;
  if (!ws) return 'Nur im Modus Freie Fahrt Sund.';
  const a = (Array.isArray(args) ? args : []).map(String);
  if (!a.length) { game.oda(FRAKTIONEN.map((f) => `${f} ${ruf(game, f)}`).join(' · ') + ' · Rang ' + rangInfo(game).name, null); return null; }
  if (!FRAKTIONEN.includes(a[0])) return 'ruf [' + FRAKTIONEN.join('|') + '] [wert]';
  const v = Number(a[1]);
  if (!Number.isFinite(v)) return 'ruf ' + a[0] + ' <Zahl>';
  const vorher = rang(game);
  ws.ruf[a[0]] = klemmen(a[0], v);
  meldeRang(game, vorher, rang(game));
  return null;
}

module.exports = { debug, FRAKTIONEN, RAENGE, neu, ruf, rang, rangVon, rangInfo, rufErreicht, aendern, anwenden, meldeRang, szeneSieg, szeneFlucht, snapshot, schluessel, toSave, lesen };
