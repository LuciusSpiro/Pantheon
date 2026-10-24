'use strict';
// SUND-02b E: Beschuss auf römische Verbündete („Verrat“) in einer Sim-Szene der Freien Fahrt Sund (game.simSzene, game.weltsim). Action-Layer wie posten.js und ruf.js.
// Leitgedanke: Ruf ist ein Kann, nie ein Muss. Der Verrat ist nie erzwungen und nie versehentlich: er braucht eine bewusste Aktion (Ops-Halteprozess mit Warnung), das Ablehnen und Abbrechen kostet
// nichts, kein Spieler wird hineingezwungen (jeder kann die Szene per Sprung verlassen). Mehrspieler: ein Spieler an der Ops genügt, alle sehen die Warnung (Funk, Szenenzeile). Nur der Server schreibt.
//
// Warum eine Umschaltung statt Verbündete als Treffer-Ziel: Crew-Waffen (sechs Projektilarten, Lanze, Streu-Explosion) treffen nur Gegner (space.enemies), Verbündete (space.escorts, ally) sind unverwundbar
// gegen sie. Statt fünf Waffenpfade zu öffnen (teuer, fehleranfällig, und Verbündete in Eisenwald/Kette würden angreifbar), wird die Szene umgeschaltet: die Verbündeten der Szene (es.sim) verlassen die
// Liste und kommen als echte Gegner derselben Klasse und derselben Hüllen-Quote zurück (kriegslage-szene.js verratStarten). Alle Waffen, Zielerfassung und Klassen-KI greifen unverändert. Nur Szenen der
// Sim (es.sim) können das: Verbündete der Kampagne, des Limes, von Eisenwald und Kette haben kein es.sim und bleiben unverwundbar.
//
//   verratStart(game, p)         Befehl weapons.verrat.beginnen: Halteprozess (kind 'posten', id 'verrat', Daten anlauf.dauer), Abbruch wie überall: weapons.fracht { off } -> Fehlertext | null
//   pruefen(game, laufend)       -> null | { code, text } (Weigerungsgrund mit Text aus content/flotte/verrat.json); laufend = während des Halteprozesses (ohne Docked/„läuft schon“)
//   haltWeiter(game, h)          je Tick (aus posten.haltWeiter): null oder { code, text } = Abbruch (Szene vorbei, keine Verbündeten, Transfer)
//   haltFertig(game, h)          Abschluss: Umschaltung der Szene, DANN der Ruf-Abzug (verrat_beginn, ohne Tick, nur bei tatsächlicher Auslösung), Funk, Gedächtnis
//   stummerAbbruchText(h, grund) Abbruchtext für Abbrüche, die fracht.js selbst auslöst (Sprung, Ops verlassen)
//   snapshot(game)               space.po: { k: 'v', ok: 0 | 1, t?: Weigerungstext } nur in einer Sim-Szene mit römischen Verbündeten, in der der Verrat in Frage kommt
//   warnung(game)                während des Halteprozesses [Restsekunden, Dauer] für die Szenenzeile aller Spieler, sonst null
//   gedaechtnis(game, hex) / lesen(b) / text(key, vars)
// Ruf: nur Abzug (verrat_beginn sofort, verrat_flotte_vernichtet beim Sieg), kein Lohn: weder Marken (e.ohneBeute) noch Ruf aus dem Kampf. Gedächtnis: ws.verrat = { n, tick, hex } (welt.sim.verrat, optional).
// Alle Zahlen stehen in content/welt/verrat-werte.json, alle Texte in content/flotte/verrat.json.
const fs = require('fs');
const path = require('path');
const Kern = require('../weltsim/kern.js');
const Sektoren = require('../../shared/sektoren.js');
const Ruf = require('./ruf.js');
const Fracht = require('./fracht.js');

const W = require('../../content/welt/verrat-werte.json').werte;
const TEXTE_FILE = path.join(__dirname, '..', '..', 'content', 'flotte', 'verrat.json');
let texteCache = null;
function texte() {
  if (texteCache) return texteCache;
  try { texteCache = JSON.parse(fs.readFileSync(TEXTE_FILE, 'utf8')); } catch (e) { texteCache = {}; }
  return texteCache;
}
const fmt = (s, o) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? String(o[k]) : m));
const text = (key, vars) => fmt(texte()[key], vars);
const fehl = (code, o) => ({ code, text: fmt((texte().weigerung || {})[code] || code, o) });
const sz = () => require('./kriegslage-szene.js');
const kl = () => require('./kriegslage.js');
const transferAus = (game) => ['broken', 'offline'].includes(game.ship.systems.transfer);

// Römische Verbündete der laufenden Szene (nur die der Sim: es.sim), lebend
function verbuendete(game, S) {
  const E = require('./escort.js');
  return ((game.space && game.space.escorts) || []).filter((q) => q.ally && S && q.sim === S.id && E.active(q));
}

// ---------- Prüfer ----------
// laufend = true: Prüfung während des Halteprozesses (ohne Docked, „läuft schon“)
function pruefen(game, laufend) {
  if (!game.weltsim) return fehl('modus');
  const S = game.simSzene;
  if (!S || S.phase === 'ende') return fehl('keine_szene');
  if (S.modus === 'verrat') return fehl('schon');
  if (!W.phasen.wert.includes(S.phase)) return fehl('phase');
  if (!laufend && game.ship.docked) return fehl('docked');
  if (!verbuendete(game, S).length) return fehl('keine_verbuendeten');
  if (transferAus(game)) return fehl('transfer');
  if (!laufend) { const s = Fracht.state(game); if (s.halt) return fehl('laeuft'); }
  return null;
}

// ---------- Halteprozess ----------
function verratStart(game, p) {   // eslint-disable-line no-unused-vars
  const e = pruefen(game, false);
  if (e) return e.text;
  const s = Fracht.state(game);
  s.halt = { kind: 'posten', id: 'verrat', t: 0, dur: W.anlauf.wert.dauer, hex: game.simSzene.hex };
  game.emit('frachtBeamen', { phase: 'start', was: 'posten', dur: s.halt.dur });
  // alle Spieler sehen die Warnung (Funk an jeder Konsole, Szenenzeile); der Funk steht VOR dem Abbruchtext, falls abgebrochen wird
  sz().funk(game, text('anlauf', { sek: Math.round(s.halt.dur) }), { reiter: 1 });
  return null;
}

const ABBRUCH = { keine_szene: 'szene', phase: 'szene', schon: 'szene', modus: 'szene', keine_verbuendeten: 'keine_verbuendeten', transfer: 'transfer', docked: 'szene' };
const abbruchText = (code) => (texte().abbruch || {})[ABBRUCH[code] || 'szene'] || '';
function stummerAbbruchText(h, grund) {
  const k = { szene: 'sprung', taktik: 'ops', abgebrochen: 'abgebrochen' }[grund];   // auch der Abbruch am Knopf meldet es allen (die Warnung stand im Funk): nichts ist geschehen
  return k ? ((texte().abbruch || {})[k] || '') : '';
}
function haltWeiter(game, h) {
  const S = game.simSzene;
  if (!S || S.hex !== h.hex) return { code: 'szene', text: abbruchText('keine_szene') };
  const e = pruefen(game, true);
  return e ? { code: e.code, text: abbruchText(e.code) } : null;
}

// Abschluss: erst die Szene umschalten (mit eigenem Rollback), dann der Ruf. Scheitert die Umschaltung, kostet es nichts (kein Ruf, die Szene bleibt wie sie war).
function haltFertig(game, h) {
  const e = pruefen(game, true);
  if (e) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: e.code }); game.oda(abbruchText(e.code), null); return false; }
  const S0 = game.simSzene;
  if (!S0 || S0.hex !== h.hex) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: 'ort' }); return false; }
  const beginn = Ruf.verratBeginn();
  const z = game.weltsim.zustand;
  if (beginn.some((wk) => !Kern.pruefeWirkung(z, wk).ok)) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: 'wirkung' }); game.oda(abbruchText('szene'), null); return false; }
  let S = null;
  try { S = sz().verratStarten(game); } catch (err) { if (game.countError) game.countError('verrat-start', err); }
  if (!S) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'posten', grund: 'szene' }); game.oda(abbruchText('szene'), null); return false; }
  // Ab hier gilt der Verrat: der Ruf-Abzug nur jetzt, nicht im Halteprozess
  const r = kl().rufBuchen(game, beginn);
  const abzug = beginn.length ? Math.abs(beginn[0].delta) : 0;
  game.emit('frachtBeamen', { phase: 'fertig', was: 'posten', art: 'verrat' });
  const ort = S.ortName;
  sz().funk(game, text(r.ok && abzug ? 'beginn' : 'beginnLeise', { ort, ruf: abzug }), { reiter: 1, log: (texte().log || {}).beginn });
  sz().funk(game, text('feinde', { n: S.verrat.n0 }));
  gedaechtnis(game, S.hex);
  game.missionEvent('verratBegonnen', { hex: S.hex, ort, n: S.verrat.n0 });
  return true;
}

// ---------- Gedächtnis (additiv): ws.verrat = { n, tick, hex } ----------
function gedaechtnis(game, hex) {
  const ws = game.weltsim; if (!ws) return;
  const alt = ws.verrat && ws.verrat.n >= 1 ? ws.verrat : { n: 0 };
  ws.verrat = { n: alt.n + 1, tick: ws.tickZahl, hex };
  const w = game.weltstand;
  if (w && typeof w.chronicle === 'function') { try { w.chronicle(text('chronik', { ort: Sektoren.hexName(hex) || hex })); } catch (err) { if (game.countError) game.countError('verrat-chronik', err); } }
}
function lesen(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  if (!Number.isFinite(b.n) || b.n < 1) return null;
  return { n: Math.floor(b.n), tick: Number.isFinite(b.tick) && b.tick >= 0 ? Math.floor(b.tick) : 0, hex: typeof b.hex === 'string' && /^\d{4}$/.test(b.hex) ? b.hex : '' };
}

// ---------- Anzeige ----------
function snapshot(game) {
  const S = game.simSzene;
  if (!game.weltsim || !S || S.phase === 'ende' || S.modus === 'verrat' || !W.phasen.wert.includes(S.phase)) return null;
  if (!verbuendete(game, S).length) return null;
  const e = pruefen(game, false);
  // ein laufender Halteprozess blockiert nur die Starttaste: die Fracht-Leiste zeigt dann den Fortschritt
  const out = { k: 'v', ok: e ? 0 : 1 };
  if (e) out.t = e.text;
  return out;
}
// [Restsekunden, Dauer] solange der Halteprozess des Verrats läuft: die Szenenzeile aller Spieler zeigt die Warnung
function warnung(game) {
  const h = game.fracht && game.fracht.halt;
  if (!h || h.kind !== 'posten' || h.id !== 'verrat') return null;
  return [Math.max(0, Math.ceil(h.dur - h.t)), Math.round(h.dur)];
}

module.exports = { verratStart, pruefen, haltWeiter, haltFertig, stummerAbbruchText, snapshot, warnung, gedaechtnis, lesen, text, texte, verbuendete, W };
