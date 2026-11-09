'use strict';
// FRE-01 A: Szenario-Schalter der Freien Fahrt (Daten: content/welt/freie-fahrt-szenario.json). Rein: bildet aus dem Basis-Env des Servers
// und dem Lobby-Modus ein WIRKSAMES Env (immer eine neue Kopie, process.env wird nie verändert).
// Reihenfolge: Szenario-Werte (Schalter + Betriebsart) als Basis, in basisEnv GESETZTE Variablen (nicht leer) überstimmen die Schalter.
// AUSNAHME (Nacharbeit W2/W3): die lobby-eigenen Betriebsart-Schlüssel (Daten: lobby_eigene_schluessel) gehören der Lobby-Option allein;
// Basis-Werte werden entfernt, außer dem Haken ausnahme_basiswert (SPIELLEITER_LLM=mock).
//   wirksamesEnv(basisEnv, modus, { live }) -> neues Objekt
//   betriebsart(live) -> 'live' | 'rueckfall'

const DATEN = require('../../content/welt/freie-fahrt-szenario.json').werte;

const gesetzt = (v) => v !== undefined && v !== null && String(v) !== '';

function betriebsart(live) { return live === true ? 'live' : 'rueckfall'; }

function wirksamesEnv(basisEnv, modus, opt) {
  const basis = basisEnv || process.env;
  const kopie = {};
  for (const k of Object.keys(basis)) kopie[k] = basis[k];
  if (modus !== DATEN.modus.wert) return kopie;
  const szenario = Object.assign({}, DATEN.schalter.wert, DATEN.betriebsarten.wert[betriebsart(opt && opt.live)]);
  const aus = {};
  for (const k of Object.keys(szenario)) aus[k] = szenario[k];
  const eigene = new Set(DATEN.lobby_eigene_schluessel.wert);
  const ausn = DATEN.ausnahme_basiswert.wert;
  const haken = Object.keys(ausn).some((k) => String(basis[k] || '').toLowerCase() === ausn[k]);
  for (const k of Object.keys(basis)) {
    if (!gesetzt(basis[k])) continue;
    if (eigene.has(k)) {
      if (haken && Object.prototype.hasOwnProperty.call(ausn, k)) aus[k] = basis[k];
      continue;
    }
    aus[k] = basis[k];
  }
  // Betriebsart-Schlüssel gehören der Lobby: Basis-Werte sind oben schon ausgelassen, die Werte der Betriebsart bleiben stehen;
  // beim mock-Haken werden SPIELLEITER_RUECKFALL und LLM_LIVE der Betriebsart entfernt (mock ist ein Modell-Betrieb, kein Rückfall)
  if (haken) { delete aus.SPIELLEITER_RUECKFALL; delete aus.LLM_LIVE; }
  return aus;
}

module.exports = { wirksamesEnv, betriebsart };
