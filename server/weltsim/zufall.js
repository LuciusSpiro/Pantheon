'use strict';
// Eigener, seedbarer Zufallsstrom der Weltsimulation (mulberry32). Der Zustand ist EINE Zahl (uint32) im Sim-Zustand
// (zustand.zufall), damit "n Ticks, speichern, laden, n Ticks" gleich "2n Ticks" ist. Kein Math.random, kein globaler Zustand.

// Seed (beliebige Zahl) -> Startzustand. Ein Mischschritt (splitmix32), damit benachbarte Seeds nicht gleich anlaufen.
function startzustand(seed) {
  let s = (Number(seed) | 0) >>> 0;
  s = (s + 0x9E3779B9) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x85EBCA6B) >>> 0;
  s = Math.imul(s ^ (s >>> 13), 0xC2B2AE35) >>> 0;
  return (s ^ (s >>> 16)) >>> 0;
}

// Gleichverteilt in [0, 1). Schreibt den neuen Zustand zurück in z.zufall.
function zahl(z) {
  z.zufall = (z.zufall + 0x6D2B79F5) >>> 0;
  let t = z.zufall;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const gleichverteilt = (z, a, b) => a + (b - a) * zahl(z);

// Fisher-Yates in place (wie random.shuffle).
function mische(z, liste) {
  for (let i = liste.length - 1; i >= 1; i--) {
    const j = Math.floor(zahl(z) * (i + 1));
    const t = liste[i]; liste[i] = liste[j]; liste[j] = t;
  }
  return liste;
}

const waehle = (z, liste) => liste[Math.floor(zahl(z) * liste.length)];

module.exports = { startzustand, zahl, gleichverteilt, mische, waehle };
