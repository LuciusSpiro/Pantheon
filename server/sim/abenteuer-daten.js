'use strict';
// SUND-04b A2: Zahlen der Komposition von Abenteuern (content/welt/abenteuer-werte.json). Reine Daten, kein Zustand.
const DATEI = require('../../content/welt/abenteuer-werte.json');
const WERTE = Object.fromEntries(Object.entries(DATEI.werte).map(([k, v]) => [k, v.wert]));
module.exports = { WERTE };
