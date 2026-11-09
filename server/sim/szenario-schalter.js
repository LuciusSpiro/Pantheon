'use strict';
// FRE-01 A: Szenario-Schalter der Freien Fahrt (Daten: content/welt/freie-fahrt-szenario.json). Rein: bildet aus dem Basis-Env des Servers
// und dem Lobby-Modus ein WIRKSAMES Env (immer eine neue Kopie, process.env wird nie verändert).
// Reihenfolge: Szenario-Werte (Schalter + Betriebsart) als Basis, in basisEnv GESETZTE Variablen (nicht leer) überstimmen.
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
  for (const k of Object.keys(basis)) if (gesetzt(basis[k])) aus[k] = basis[k];
  return aus;
}

module.exports = { wirksamesEnv, betriebsart };
