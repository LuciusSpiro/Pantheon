'use strict';
// SUND-04a-2 P3: die Bausteine notruf, enthuellung und abschluss der Geschichtsfaeden (Freie Fahrt Sund, Schalter FAEDEN=1). Action-Layer wie faden-bitte.js.
// Die Bausteine tragen sich mit faden-bausteine.js ein; die Beats (Katalog beats.json, Vorlagen content/faeden/vorlagen/) bestimmen Ort, Text und Folgen, nie der Code.
//
//   notruf      (Beat „notruf“) Der NSC ruft um Hilfe: Funkzeile mit Porträt (faden-bitte funkVon), Ort aus dem Beat oder dem Faden, Gefahr angekündigt (Text).
//               Ausgang gelungen, wenn das Schiff den Ort erreicht (update, Takt aus reise-ereignis), gescheitert, wenn die Frist des Beats abläuft (Faden-Takt).
//               Der Text erinnert sich: hat der NSC im Gedaechtnis ein Ereignis aus p3-texte.json (erinnert), spricht er es an.
//   enthuellung (Beat „enthuellung“) Die verborgene Wahrheit kommt heraus (Funk, nsc.wahrheit.offenbart setzt faden.js). Die Folge ist eine germanische Sprengung eines
//               römischen Postens in der Nähe des Ortes (Sim-Befehl sabotage, regie-befehle fadenSabotage: Prüfung, Rate, Vorwarnung und Vorlauf wie bei den Befehlen des Spielleiters).
//               Gelungen, wenn die Sprengung angekündigt ist; gescheitert, wenn es keinen gültigen Posten gibt oder die Rate voll ist (Fallback: der Faden ändert sich, Funk und Chronik).
//   abschluss   (letzter Beat) Der Faden endet. Ausgang gelungen: die Crew hat den Faden zu Ende gespielt (auch wenn der NSC dabei gefallen ist: der Text sagt es).
//               Gedächtnis, Ruf und Haltung schreiben die Ausgänge der Vorlage (Wirkungen aus den Daten, faden.js beatAusgang). Ein Abschluss scheitert nie.
//
//   update(game)  Takt (Aufrufer: reise-ereignis.update). Wartet auf die Ankunft des Notrufs (game.fadenNotruf { fadenId, beatId, hex }); verwaiste Notrufe fallen weg.
//   Texte: content/faeden/p3-texte.json.
const Sektoren = require('../../shared/sektoren.js');
const TX = require('../../content/faeden/p3-texte.json');
const T = TX.texte, W = TX.werte;
const HEX = /^\d{4}$/;
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const Regie = () => require('./regie-befehle.js');
const fmt = (t, v) => String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };
const logbuch = (game, art, e) => { try { Regie().schreibe(game, Object.assign({ art }, e)); } catch (err) { fehlerZaehlen(game, 'faden-p3-logbuch', err); } };
const nscVon = (game, id) => Faden().nscVon(game, id);

// Funk eines NSC (Porträt) ueber den gemeinsamen Weg der Bitten (faden-bitte.funkVon)
function sagen(game, nsc, text) {
  if (!text || !nsc) return null;
  return Bitte().funkVon(game, nsc, text);
}

// ---------- notruf
// Erinnerung: der letzte Gedaechtnis-Eintrag mit einem Text aus `erinnert` gewinnt; sonst der Text des Beats
function notrufText(nsc, beat) {
  let key = (beat.parameter && beat.parameter.text_key) || null;
  for (const g of (nsc && nsc.gedaechtnis) || []) { const k = W.erinnert[g.ereignis]; if (k && T[k]) key = k; }
  if (!key || !T[key]) key = 'notruf_standard';
  return key;
}
const notruf = {
  id: 'notruf',
  starten(game, faden, ctx) {
    const p = (ctx.beat && ctx.beat.parameter) || {};
    const hex = typeof p.hex === 'string' && HEX.test(p.hex) ? p.hex : (faden.parameter && faden.parameter.ort);
    if (!hex || !HEX.test(hex)) { logbuch(game, 'faden_baustein', { ausgang: 'abgelehnt', key: 'notruf', begruendung: 'Notruf ohne Ort: der Beat gilt als gescheitert', plan: { faden: faden.id } }); return { ausgang: 'gescheitert' }; }
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const key = notrufText(nsc, ctx.beat);
    const text = fmt(T[key], { name: nsc.name, ort: hexName(hex) });
    const f = sagen(game, nsc, text);
    if (!f) return { ausgang: 'gescheitert' };
    for (const h of ctx.beat.hinweise || []) Faden().hinweisGezeigt(game, faden.id, h);   // der Notruf ist gesendet: die Hinweise des Beats gelten
    game.fadenNotruf = { fadenId: faden.id, beatId: ctx.beat.id, hex };
    logbuch(game, 'faden_baustein', { ausgang: 'notruf', key: 'notruf', begruendung: `Notruf von ${nsc.name} bei ${hexName(hex)}`, plan: { faden: faden.id, beat: ctx.beat.id, hex, text: key } });
    return { laeuft: true };
  },
};

// Takt: die Ankunft am Ort beendet den Notruf gelungen; ein Notruf, dessen Beat nicht mehr laeuft, faellt weg (die Frist hat ihn beendet)
function update(game) {
  const N = game && game.fadenNotruf;
  if (!N) return;
  const F = Faden().zustandVon(game);
  const f = F && F.liste.find((x) => x.id === N.fadenId);
  if (!f || f.phase !== 'laeuft' || !f.laufend || f.laufend.beat !== N.beatId) { game.fadenNotruf = null; return; }
  if (!game.ship) return;
  if (Sektoren.hexVonOrt(game.ship.scene) !== N.hex) return;
  game.fadenNotruf = null;
  const nsc = nscVon(game, f.nsc.id) || f.nsc;
  sagen(game, nsc, fmt(T.notruf_dank, { name: nsc.name }));
  Faden().beatAusgang(game, f.id, 'gelungen');
}

// ---------- enthuellung
// Der Posten Roms, der dem Ort am nächsten liegt (Abstand im Hex-Raster, bei Gleichstand der kleinere Code). Keiner: null.
function ziel(game, ort) {
  const ws = game.weltsim && game.weltsim.zustand;
  if (!ws || !HEX.test(ort || '')) return null;
  const teile = (h) => ({ c: Number(h.slice(0, 2)), r: Number(h.slice(2)) });
  const p = teile(ort);
  let best = null, bd = Infinity;
  for (const code of Object.keys(ws.hexe).sort()) {
    const nd = ws.hexe[code];
    if (!nd.posten || nd.besitzer !== 'rom') continue;   // ein Posten liegt nie auf einem Hafen
    const q = teile(code), d = Math.hypot(q.c - p.c, q.r - p.r);
    if (d < bd) { best = code; bd = d; }
  }
  return best;
}
const enthuellung = {
  id: 'enthuellung',
  starten(game, faden, ctx) {
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const z = ziel(game, faden.parameter && faden.parameter.ort);
    const r = z ? Regie().fadenSabotage(game, z) : { ok: false, grund: 'kein römischer Posten in der Nähe' };
    const key = r.ok ? 'enthuellung_sabotage' : 'enthuellung_ohne';
    sagen(game, nsc, fmt(T[key], { name: nsc.name, ziel: z ? hexName(z) : '', ort: hexName((faden.parameter && faden.parameter.ort) || '') }));
    logbuch(game, 'faden_baustein', { ausgang: r.ok ? 'sabotage' : 'sabotage_abgelehnt', key: 'enthuellung', begruendung: r.ok ? `Sprengung bei ${hexName(z)} angekündigt (ab Tick ${r.ab})` : `Keine Sprengung: ${r.grund}`, plan: { faden: faden.id, beat: ctx.beat.id, ziel: z || null } });
    return { ausgang: r.ok ? 'gelungen' : 'gescheitert' };
  },
};

// ---------- abschluss
const abschluss = {
  id: 'abschluss',
  starten(game, faden, ctx) {
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const key = ctx.beat.parameter && ctx.beat.parameter.text_key && T[ctx.beat.parameter.text_key] ? ctx.beat.parameter.text_key : (nsc.status === 'tot' ? 'abschluss_tot' : 'abschluss_gelungen');
    sagen(game, nsc, fmt(T[key], { name: nsc.name }));
    return { ausgang: 'gelungen' };
  },
};

module.exports = { notruf, enthuellung, abschluss, update, ziel, notrufText };
