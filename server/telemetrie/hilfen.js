'use strict';
// TEL-01: gemeinsame Hilfsfunktionen der Protokoll-Haken (ereignisse.js, gefecht.js, haken.js) – Rundung und Kennungen an EINER Stelle,
// damit jede Zahl und jede Position im Protokoll gleich gerundet ist. Reine Funktionen, kein Spielzustand, kein Zufall.

const TILE = 32;   // Pixel je Kachel (1 Kachel = 1 m), wie Physics.TILE
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
// Zahl auf 2 Nachkommastellen; ein kaputter Wert wird null, nie 0 (ein Fehler soll sichtbar bleiben)
const num = (v) => (Number.isFinite(v) ? r2(v) : null);
// Text, auf n Zeichen gekuerzt (Standard 60); null bleibt null
const txt = (v, n) => (v == null ? null : String(v).slice(0, n || 60));
// nur Slot-Kennungen p1..p4, sonst nichts (Pseudonym: nie ein Name, nie eine clientId)
const slotVon = (id) => (typeof id === 'string' && /^p[1-4]$/.test(id) ? id : null);
// Position am Boden auf ganze Kacheln: die Kachel, in der die Figur steht (wie Physics.toTile)
const kachel = (v) => Math.floor(v / TILE);
// Sektor der Lerche in der Reihenfolge von Physics.sectorOf: 0 bug, 1 steuerbord, 2 heck, 3 backbord, -1 mitte
const SEKTOR = ['bug', 'steuerbord', 'heck', 'backbord'];
const sektorName = (s) => (Number.isInteger(s) && s >= 0 && s < 4 ? SEKTOR[s] : s === -1 ? 'mitte' : null);

module.exports = { TILE, r1, r2, r3, num, txt, slotVon, kachel, sektorName };
