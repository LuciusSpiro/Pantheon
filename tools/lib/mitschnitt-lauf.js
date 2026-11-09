'use strict';
// MIT-01 C: kleine Hilfe fuer die simulierten Laeufer (spiel-faden, sim-headless, regie-fixture). Der Mitschnitt selbst ist der Recorder game.mitschnitt (server/telemetrie/mitschnitt.js):
// diese Datei liest nur den Schalter, setzt die Umgebung, gibt dem Recorder die Werkzeugdaten (lauf), beendet ihn am Laufende und nennt den Ausgabeordner.
//   --mitschnitt                 schaltet ihn ein (setzt MITSCHNITT=1); MITSCHNITT=1 in der Umgebung wirkt ebenso
//   --mitschnitt-dir <ordner>    Wurzel der Ablage (setzt MITSCHNITT_DIR, absolut gegen das aktuelle Verzeichnis), sonst MITSCHNITT_DIR bzw. data/mitschnitt
// Ohne Schalter ist game.mitschnitt null: jede Funktion hier ist dann ein Nulleffekt (keine Ausgabe, keine Datei, keine Umgebung).
// NICHT angebunden: tools/sim-freie-fahrt.js (spielt keine Mission und keinen Faden, es entstuende nur ein leerer Index) und die Messtreiber messe-*.js (rufen nur die Komposition, spielen nichts durch).
const path = require('path');

const AN = /^(1|an|on|true)$/i;
const flagWert = (argv, k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null && !String(argv[i + 1]).startsWith('--') ? String(argv[i + 1]) : null; };

// Reine Funktion: { an, dir } aus Argumenten und Umgebung (dir: absoluter Pfad oder null = Standard des Recorders)
function lesen(argv, env) {
  const a = Array.isArray(argv) ? argv : [];
  const e = env || {};
  const an = a.includes('--mitschnitt') || AN.test(String(e.MITSCHNITT || '').trim());
  const d = flagWert(a, '--mitschnitt-dir') || (e.MITSCHNITT_DIR ? String(e.MITSCHNITT_DIR) : null);
  return { an, dir: d ? path.resolve(d) : null };
}

// Setzt die Umgebung fuer das Spiel (vor dem Anlegen des Game). Ohne Schalter: nichts. Rueckgabe: { an, dir }
function einschalten(argv, env) {
  const e = env || process.env;
  const c = lesen(argv, e);
  if (c.an) { e.MITSCHNITT = '1'; if (c.dir) e.MITSCHNITT_DIR = c.dir; }
  return c;
}

// Werkzeugdaten an den Recorder (nur wenn das Spiel einen hat): { werkzeug, regel, seed, crew, modus, kuenstlich: [..] }
function anmelden(game, daten) {
  if (game && game.mitschnitt && typeof game.mitschnitt.lauf === 'function') game.mitschnitt.lauf(daten);
}
// Verlauf teilweise gesetzt (Teleport, Testhelfer, Skip ...): im Dokument ausgewiesen
function kuenstlich(game, ...arten) {
  if (game && game.mitschnitt && typeof game.mitschnitt.kuenstlich === 'function') game.mitschnitt.kuenstlich(...arten);
}

const genannt = new Set();
// Laufende: ende() des Recorders (idempotent), danach 'Mitschnitt: <ordner>' auf der Konsole (je Ordner einmal). Ohne Recorder: nichts. Rueckgabe: Ordner oder null
function beenden(game, ausgabe) {
  if (!game || !game.mitschnitt || typeof game.mitschnitt.ende !== 'function') return null;
  let ordner = null;
  try { ordner = game.mitschnitt.ende(); } catch (e) { ordner = null; }
  const aus = ausgabe || console.log;
  if (ordner) { if (!genannt.has(ordner)) { genannt.add(ordner); aus('Mitschnitt: ' + ordner); } } else aus('Mitschnitt: kein Eintrag aufgenommen, nichts geschrieben');
  return ordner;
}

module.exports = { lesen, einschalten, anmelden, kuenstlich, beenden };
