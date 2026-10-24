'use strict';
// SUND-03 D: Chronik der Freien Fahrt Sund (game.weltsim.chronik), Action-Layer wie ruf.js. Sie hält kurze, strukturierte Einträge zu den Tätigkeiten und Entscheidungen der Crew und der Welt:
// Reise-Ereignisse, Ausgänge der Sim-Szenen, Wahl und Ablehnung von Absichten, angewandte Pläne des Lage-Spielleiters, Posten (gegründet, ausgebaut, gesprengt, gefallen), Wendepunkte der Sim.
// Sie gehört NICHT zum Sim-Zustand des Kerns (der bleibt rein und bitgleich), sondern wie ruf und posten zum Spielaufsatz, und wird als welt.sim.chronik gespeichert (optional, additiv, Weltstand
// Version 3; Altstände = leer). Der Ausschnitt für den Grobplan (lage-ausschnitt.js) liest die letzten Einträge daraus; sie ersetzt dort die Chronik der Kampagne (mission/context.js).
// Kein Snapshot-Feld: die Chronik ist Serverzustand. Spielernamen stehen NIE darin (eintragen entfernt sie aus dem Text).
//
//   eintragen(game, { art, ref, kurz, param? }) -> Eintrag | null      ohne Modus oder bei unbrauchbarem Eintrag: nichts. Eintrag { t: Tick der Sim, art, ref, kurz (<= kurz_max), param? }
//   letzte(game, n) -> [Eintrag]                                       die letzten n Einträge (Kopien)
//   ausTick(game, ev, gueltig, crewPostenVorher)                       nach einem Sim-Tick: Posten der Crew und Wendepunkte (Hafen, Hauptwelt) aus den Ereignissen eintragen
//   neu() / toSave(ws) / lesen(block)                                  Weltstand-Block welt.sim.chronik (Altstand und Müll = leer)
const Sektoren = require('../../shared/sektoren.js');

const W = require('../../content/welt/chronik-werte.json').werte;
const MAX = W.max.wert, KURZ_MAX = W.kurz_max.wert, REF_MAX = W.ref_max.wert, ARTEN = W.arten.wert;
const PARAM_MAX = 4;

const neu = () => [];
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function spielerNamen(game) {
  return ((game && game.players) || []).map((p) => (p && typeof p.name === 'string' ? p.name.trim() : '')).filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
}
// Ein Spielername im Text (auch ein längeres Wort, das mit ihm beginnt) wird durch „Crew“ ersetzt
function ohneNamen(text, game) {
  let t = String(text == null ? '' : text);
  for (const n of spielerNamen(game)) t = t.replace(new RegExp('(?<![\\wäöüÄÖÜß])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\wäöüÄÖÜß]*', 'gi'), 'Crew');
  return t;
}
// param: höchstens PARAM_MAX Felder mit kurzen Texten, Zahlen oder Wahrheitswerten (keine Objekte, keine Namen)
function paramLesen(p, game) {
  if (!istObjekt(p)) return undefined;
  const out = {};
  for (const k of Object.keys(p)) {
    if (Object.keys(out).length >= PARAM_MAX) break;
    if (!/^[a-z_]{1,12}$/.test(k)) continue;
    const v = p[k];
    if (typeof v === 'string') out[k] = ohneNamen(v, game).slice(0, 24);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function eintragen(game, e) {
  const ws = game && game.weltsim;
  if (!ws || !istObjekt(e) || !ARTEN.includes(e.art)) return null;
  const kurz = ohneNamen(e.kurz, game).replace(/\s+/g, ' ').trim().slice(0, KURZ_MAX);
  if (!kurz) return null;
  if (!Array.isArray(ws.chronik)) ws.chronik = neu();
  const x = { t: ws.tickZahl, art: e.art, ref: ohneNamen(e.ref == null ? '' : e.ref, game).slice(0, REF_MAX), kurz };
  const p = paramLesen(e.param, game);
  if (p) x.param = p;
  ws.chronik.push(x);
  while (ws.chronik.length > MAX) ws.chronik.shift();
  return x;
}
function letzte(game, n) {
  const ws = game && game.weltsim;
  if (!ws || !Array.isArray(ws.chronik)) return [];
  const k = Math.max(0, Math.floor(n) || 0);
  return (k ? ws.chronik.slice(-k) : []).map((c) => JSON.parse(JSON.stringify(c)));
}

// Nach dem Tick (Kriegslage.tickMit, nach dem Commit): Ereignisse der Sim, die für die Crew Wendepunkte sind. crewPostenVorher: Hexe der Crew-Posten VOR dem Tick (ein Posten, der fällt, ist danach nicht mehr eingetragen).
// gueltig: die im Tick angewandten Wirkungen (posten_gesprengt steht dort, nicht als Ereignis der Crew).
function ausTick(game, ev, gueltig, crewPostenVorher) {
  const name = (hex) => Sektoren.hexName(hex) || String(hex);
  const crew = new Set(crewPostenVorher || []);
  for (const e of ev || []) {
    switch (e.typ) {
      case 'posten_gehisst': eintragen(game, { art: 'posten', ref: e.ort, kurz: `Posten gegründet: ${name(e.ort)}` }); break;
      case 'posten_ausgebaut': eintragen(game, { art: 'posten', ref: e.ort, kurz: `Posten ausgebaut: ${name(e.ort)}` }); break;
      case 'posten_verloren':
        if (crew.has(e.ort)) eintragen(game, { art: 'posten', ref: e.ort, kurz: `Posten gefallen: ${name(e.ort)}${e.durch ? ' an ' + e.durch : ''}`, param: { an: e.durch || '' } });
        break;
      case 'hafen_gefallen': eintragen(game, { art: 'welt', ref: e.ort, kurz: `Hafen gefallen: ${name(e.ort)} (${e.alt} an ${e.neu})` }); break;
      case 'hauptwelt_gefallen': eintragen(game, { art: 'welt', ref: e.ort, kurz: `Hauptwelt gefallen: ${name(e.ort)}` }); break;
      default:
    }
  }
  for (const w of gueltig || []) if (w && w.typ === 'posten_gesprengt') eintragen(game, { art: 'posten', ref: w.ort, kurz: `Posten gesprengt: ${name(w.ort)}` });
}

// ---------- Weltstand welt.sim.chronik: Liste der Einträge, fehlt = leer
function toSave(ws) {
  if (!ws || !Array.isArray(ws.chronik) || !ws.chronik.length) return null;
  return ws.chronik.map((c) => JSON.parse(JSON.stringify(c)));
}
// müll-fester Leser: Unbekanntes und Unsinniges fällt weg, die Länge wird auf die Obergrenze gebracht (die neuesten bleiben)
function lesen(b) {
  const out = neu();
  if (!Array.isArray(b)) return out;
  for (const c of b) {
    if (!istObjekt(c) || !ARTEN.includes(c.art) || typeof c.kurz !== 'string' || !c.kurz) continue;
    const x = { t: Number.isFinite(c.t) && c.t >= 0 ? Math.floor(c.t) : 0, art: c.art, ref: typeof c.ref === 'string' ? c.ref.slice(0, REF_MAX) : '', kurz: c.kurz.slice(0, KURZ_MAX) };
    if (istObjekt(c.param)) { const p = paramLesen(c.param, null); if (p) x.param = p; }
    out.push(x);
  }
  return out.slice(-MAX);
}

module.exports = { eintragen, letzte, ausTick, neu, toSave, lesen, ARTEN, MAX, KURZ_MAX, ohneNamen };
