'use strict';
// SUND-04a-3 Finale-Kern: Zustandsmaschine der „Entscheidungsschlacht um Hrafnheim“ (nur Freie Fahrt Sund, game.weltsim). Action-Layer wie absicht.js und verrat.js.
// Das Finale startet NICHT über eine Sim-Belagerung (die Sim belagert Hrafnheim praktisch nie, gemessen). Ab dem Rang Tribun bekommt die Crew ein Angebot am Terminal; ZWEISTUFIG wie der
// Verrat: erst die Anfrage (finale.waehlen), dann die Bestätigung innerhalb der Frist (finale.bestaetigen). Jeder Spieler darf, die erste Bestätigung gilt. Ablehnen und Ignorieren kosten nichts,
// kein Zwang; wer fehlt, verpasst nichts: das Finale gilt für die Crew. Gefahr wird vorab angekündigt (Funk), es gibt keine Scheinwahl.
//
// Ablauf (phase): null -> 'orbit' -> 'boden' -> 'ende'.
//   Orbit-Ende 'sieg' -> 'boden'. 'niederlage' und 'flucht' -> Neubeginn (phase null, Angebot wieder da): KEIN Game Over, die Crew bleibt am Leben.
//   Boden-Ende 'sieg' -> die Wirkung hauptwelt_erobert (EIN Sim-Tick, der Orbit-Sieg löst keinen aus), danach phase 'ende' und abspann.beenden(game, 'sieg').
//   Boden-Ende 'crew_gefallen' -> Neubeginn (nicht „zurück in den Orbit“: der Orbit-Sieg ist mit der Szene weg, das Finale ist nicht speicherbar; ein Neubeginn gibt der Crew einen Atemzug und
//   die Wahl, statt sie ohne Frage in den nächsten Kampf zu schicken).
// Zustand: game.weltsim.finale = { phase, angebot: 0|1, anfrage: { bis } | null, frei_ab: Tick, versuche: Zahl } – NICHT im Weltstand (toSave kennt ihn nicht): Laden und Neustart = phase null, das Angebot
// entsteht neu (beim nächsten Tick). Ein beendetes Finale (Fakt szenario_ende) gehört dem Paket Abspann.
//
//   bereit(game)                         -> { ok, grund: null | 'rang' | 'modus' | 'laeuft' | 'beendet' | 'szene' | 'aussen' }   (aussen: ein verbundener Spieler ist im Aussenteam; das Angebot bleibt, der Start wartet)
//   anbieten(game)                       Angebot machen (Funk): -> bool (neu entstanden)
//   waehlen(game) / bestaetigen(game) / ablehnen(game)    Befehle finale.waehlen (Anfrage), finale.bestaetigen, finale.ablehnen: -> null | { code, text }
//   phase(game)                          -> null | 'orbit' | 'boden' | 'ende'
//   starten(game)                        -> bool: phase 'orbit', baut die Szene über kriegslage-szene.finaleStarten(game, { hex })
//   orbitEnde(game, ausgang)             'sieg' | 'niederlage' | 'flucht' -> bool
//   bodenEnde(game, ausgang)             'sieg' | 'crew_gefallen' -> bool
//   nachTick(game)                       nach jedem Tick (kriegslage.js, nach dem Commit): Angebot machen, Anfrage verfallen lassen, Angebot bei Rangverlust zurückziehen
//   snapshot(game) / schluessel(game)    Anzeigeblock world.finale (nur bei Änderung, null = Löschsignal)
//   debug(game, args)                    nur --debug: finale [status | angebot | start | orbit <ausgang> | boden <ausgang> | reset]
//   ersetzen(name, modul | null)         nur Tests: Schnittstellen ersetzen ('szene' { finaleStarten }, 'boden' { bodenStarten }, 'abspann' { beenden })
// Schnittstellen zu anderen Paketen (zusammengeführt, in Tests ersetzbar): kriegslage-szene.finaleStarten (Orbit), finale-boden.bodenStarten (Boden), abspann.beenden (Abspann, Datei server/sim/abspann.js).
const Ruf = require('./ruf.js');
const OKFunk = require('./oberkommando-funk.js');

const D = require('../../content/welt/finale-werte.json');
const W = D.werte;
const T = D.texte;
const ZIEL = W.ziel.wert;
const PHASEN = ['orbit', 'boden', 'ende'];

const fmt = (s, o) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? String(o[k]) : m));
const fehl = (code, o) => ({ code, text: fmt((T.weigerung || {})[code] || code, o) });

// ---------- Schnittstellen (Stubs, in Tests ersetzbar)
const ERSATZ = { szene: null, boden: null, abspann: null };
const szene = () => ERSATZ.szene || require('./kriegslage-szene.js');
const boden = () => ERSATZ.boden || require('./finale-boden.js');
const abspann = () => ERSATZ.abspann || require('./abspann.js');
function ersetzen(name, modul) {
  if (!Object.prototype.hasOwnProperty.call(ERSATZ, name)) throw new Error('unbekannte Schnittstelle: ' + name);
  ERSATZ[name] = modul || null;
}

// ---------- Zustand
const neu = () => ({ phase: null, angebot: 0, anfrage: null, frei_ab: 0, versuche: 0 });
function zustandVon(game) {
  const ws = game.weltsim;
  if (!ws) return null;
  if (!ws.finale) ws.finale = neu();
  return ws.finale;
}
const phase = (game) => { const s = game.weltsim && game.weltsim.finale; return s && PHASEN.includes(s.phase) ? s.phase : null; };
const rangOk = (game) => Ruf.rufErreicht(game, W.mindestrang.wert);
const tickZahl = (game) => (game.weltsim && Number.isFinite(game.weltsim.tickZahl) ? game.weltsim.tickZahl : 0);
const anfrageRest = (game) => {   // Sekunden bis zum Ende der Frist, 0 = keine offene Anfrage
  const s = zustandVon(game), f = W.bestaetigung.wert.fenster;
  const a = s && s.anfrage;
  if (!a || !(a.bis > game.time)) return 0;
  const rest = a.bis - game.time;
  return rest <= f + 1e-9 ? Math.min(rest, f) : 0;   // Gleitkomma: (time + f) - time kann knapp über f liegen (Bestätigung im selben game.time wie die Anfrage)
};

// ---------- Prüfer
function bereit(game) {
  if (!game.weltsim) return { ok: false, grund: 'modus' };
  const p = phase(game);
  if (p === 'ende') return { ok: false, grund: 'beendet' };
  if (p) return { ok: false, grund: 'laeuft' };
  if ((game.simSzene && game.simSzene.phase !== 'ende') || game.fadenSzene) return { ok: false, grund: 'szene' };
  if (!rangOk(game)) return { ok: false, grund: 'rang' };
  if (game.players.some((p) => p.connected && p.zone === 'away')) return { ok: false, grund: 'aussen' };   // S3: der Start risse sonst Spieler aus einem laufenden Aussen-Einsatz (kriegslage-szene.js finaleStarten setzt alle auf die Pads); die Crew holt das Team erst zurueck
  return { ok: true, grund: null };
}
const weigerung = (grund) => fehl(grund, { rang: Ruf.rangName(W.mindestrang.wert) });

// ---------- Funk
// Alles Funk des Finale-Kerns ist Meldung (Messing); Gefahr (Rot) meldet nur die Szene im Orbit (Angriff, Niederlage) und die Landung am Boden (oberkommando-funk.js)
const funkMeldung = (game, key, vars) => OKFunk.meldung(game, T.sprecher, fmt((T.funk || {})[key], vars), { r: 1 });

// ---------- Angebot
function angebotSetzen(game) {   // ohne Funk (Neubeginn sagt es selbst)
  const s = zustandVon(game);
  const b = bereit(game);
  if (!s || s.angebot || (!b.ok && b.grund !== 'aussen') || tickZahl(game) < s.frei_ab) return false;   // 'aussen' sperrt nur den Start, nicht das Angebot (es bleibt sichtbar)
  s.angebot = 1;
  return true;
}
function anbieten(game) {
  if (!angebotSetzen(game)) return false;
  funkMeldung(game, 'angebot');
  return true;
}
// Verfall der Anfrage: gemeldet, sobald die Frist um ist (game.js ruft das in jedem Schritt, solange eine Anfrage offen ist), nicht erst im naechsten Sim-Tick (K5: der kommt erst mit dem
// naechsten Sprung, eventuell Minuten spaeter und an einem anderen Ort). nachTick ruft es ebenfalls (Absicherung, z. B. fuer Tests ohne Schritte).
function verfall(game) {
  const s = game.weltsim && game.weltsim.finale;
  if (!s || !s.anfrage || anfrageRest(game)) return false;
  s.anfrage = null;
  if (s.angebot) funkMeldung(game, 'angefragt_verfallen');
  return true;
}
function nachTick(game) {
  const s = zustandVon(game);
  if (!s) return;
  verfall(game);
  if (s.angebot && !rangOk(game)) { s.angebot = 0; s.anfrage = null; }   // fällt der Rang, zieht Rom das Angebot zurück (ohne Pause, ohne Folgen)
  anbieten(game);
}

// ---------- Befehle
function waehlen(game) {   // Stufe 1: Anfrage
  const s = zustandVon(game);
  if (!s) return fehl('modus');
  const b = bereit(game);
  if (!b.ok) return weigerung(b.grund);
  if (!s.angebot) return fehl('kein_angebot');
  const rest = anfrageRest(game);
  if (rest) return fehl('schon_angefragt', { sek: Math.ceil(rest) });
  const f = W.bestaetigung.wert.fenster;
  s.anfrage = { bis: game.time + f };
  funkMeldung(game, 'anfrage', { sek: Math.round(f) });
  return null;
}
function bestaetigen(game) {   // Stufe 2: innerhalb der Frist; die erste Bestätigung gilt
  const s = zustandVon(game);
  if (!s) return fehl('modus');
  const b = bereit(game);
  if (!b.ok) return weigerung(b.grund);
  if (!s.angebot) return fehl('kein_angebot');
  if (!anfrageRest(game)) { s.anfrage = null; return fehl('keine_anfrage'); }
  if (!starten(game)) { s.anfrage = null; return fehl('start'); }
  return null;
}
function ablehnen(game) {   // kostet nichts: kein Ruf, keine Sperre jenseits der Pause
  const s = zustandVon(game);
  if (!s) return fehl('modus');
  const p = phase(game);
  if (p) return fehl(p === 'ende' ? 'beendet' : 'laeuft');
  if (!s.angebot) return fehl('kein_angebot');
  s.angebot = 0; s.anfrage = null; s.frei_ab = tickZahl(game) + W.abstand_nach_ablehnen.wert;
  return null;
}

// ---------- Zustandsmaschine
function starten(game) {
  const s = zustandVon(game);
  if (!s || !bereit(game).ok) return false;
  const angebot = s.angebot;
  s.phase = 'orbit'; s.angebot = 0; s.anfrage = null;
  let S = null;
  try { S = szene().finaleStarten(game, { hex: ZIEL.hex }); } catch (e) { if (game.countError) game.countError('finale-start', e); }
  if (!S) { s.phase = null; s.angebot = angebot; return false; }   // nichts gebaut: es bleibt alles, wie es war
  s.versuche++;
  funkMeldung(game, 'start');
  return true;
}
function neubeginn(game, key) {   // Niederlage, Flucht, gefallene Crew: kein Game Over, das Finale beginnt von vorn
  const s = zustandVon(game);
  s.phase = null; s.anfrage = null; s.angebot = 0; s.frei_ab = tickZahl(game) + W.abstand_nach_scheitern.wert;
  funkMeldung(game, key);
  angebotSetzen(game);   // bei Pause 0 steht das Angebot sofort wieder (die Crew entscheidet, nichts startet von selbst)
}
function orbitEnde(game, ausgang) {
  const s = zustandVon(game);
  if (!s || s.phase !== 'orbit') return false;
  if (ausgang === 'niederlage' || ausgang === 'flucht') { neubeginn(game, 'orbit_' + ausgang); return true; }
  if (ausgang !== 'sieg') return false;
  s.phase = 'boden';   // keine Sim-Wirkung, kein Tick: die Welt wartet bis zum Boden-Sieg
  funkMeldung(game, 'orbit_sieg');
  let ok = false;
  try { ok = boden().bodenStarten(game) !== false; } catch (e) { if (game.countError) game.countError('finale-boden', e); }
  if (!ok) neubeginn(game, 'boden_nicht');
  return true;
}
function bodenEnde(game, ausgang) {
  const s = zustandVon(game);
  if (!s || s.phase !== 'boden') return false;
  if (ausgang === 'crew_gefallen') { neubeginn(game, 'crew_gefallen'); return true; }
  if (ausgang !== 'sieg') return false;
  // Fakt finale_gespielt VOR allem, was den Abspann auslöst: die Siegwirkung lässt Hrafnheim fallen, und kriegslage.hauptweltFaellt ruft Abspann.beenden('sieg')
  // schon innerhalb von szeneAbschliessen; der Abspann liest den Fakt genau dort (idempotent, ein späterer Aufruf ändert nichts mehr).
  try { if (game.weltstand && typeof game.weltstand.fact === 'function') game.weltstand.fact('finale_gespielt', true, 'finale'); } catch (e) { if (game.countError) game.countError('finale-fakt', e); }
  // GENAU EIN Sim-Tick mit der Siegwirkung; der Prüfer lässt sie nur zu, solange phase 'boden' ist (K2), also VOR dem Wechsel auf 'ende'
  const Kriegslage = require('./kriegslage.js');
  try { Kriegslage.szeneAbschliessen(game, { wirkungen: [{ typ: 'hauptwelt_erobert', ort: ZIEL.hex, an: ZIEL.an }], wo: 'finale' }); } catch (e) { if (game.countError) game.countError('finale-sieg', e); }
  // K1: der Abspann Sieg laeuft nur, wenn Hrafnheim WIRKLICH gefallen ist (Besitzer = ZIEL.an). Warf der Siegestick oder lehnte der Pruefer die Wirkung ab, beginnt das Finale von vorn
  // (wie bei einem nicht aufbaubaren Boden), statt dass die Crew einen Sieg ueber eine Hauptwelt sieht, die noch germanisch ist.
  const hx = game.weltsim.zustand && game.weltsim.zustand.hexe && game.weltsim.zustand.hexe[ZIEL.hex];
  if (!hx || hx.besitzer !== ZIEL.an) { neubeginn(game, 'sieg_nicht'); return true; }
  s.phase = 'ende'; s.angebot = 0; s.anfrage = null;
  funkMeldung(game, 'sieg');
  try { abspann().beenden(game, 'sieg'); } catch (e) { if (game.countError) game.countError('finale-abspann', e); }
  return true;
}

// ---------- Anzeige (nur Daten)
// world.finale = { frei: 0|1, ab: Name des Mindestrangs, name, text, pause (Sprünge nach dem Ablehnen), angebot?: 1, anfrage?: Sekunden der Frist (feste Zahl, die Anzeige zählt selbst), phase?: 'orbit'|'boden'|'ende' }
// Vor Tribun und ohne Zustand gibt es keinen Block (null = kein Modus oder noch nichts zu sagen).
function aktiv(game) {
  const s = game.weltsim && game.weltsim.finale;
  return !!game.weltsim && (rangOk(game) || !!(s && (s.phase || s.angebot)));
}
function snapshot(game) {
  if (!game.weltsim) return null;
  const s = zustandVon(game);
  const b = { frei: rangOk(game) ? 1 : 0, ab: Ruf.rangName(W.mindestrang.wert), name: T.anzeige.name, text: T.anzeige.text, pause: W.abstand_nach_ablehnen.wert };   // pause: Sprünge bis zum nächsten Angebot nach dem Ablehnen (Anzeige „Sie kommt in N Sprüngen wieder“)
  if (s.angebot) b.angebot = 1;
  if (anfrageRest(game)) b.anfrage = W.bestaetigung.wert.fenster;
  if (phase(game)) b.phase = phase(game);
  return b;
}
function schluessel(game) {
  if (!aktiv(game)) return null;
  const s = zustandVon(game);
  return [rangOk(game) ? 1 : 0, s.angebot ? 1 : 0, anfrageRest(game) ? 1 : 0, phase(game) || '-'].join('|');
}

// ---------- Debug: finale [status | angebot | start | orbit <ausgang> | boden <ausgang> | reset]
function debug(game, args) {
  if (!game.weltsim) return 'Nur im Modus Freie Fahrt Sund.';
  const s = zustandVon(game);
  const a = (Array.isArray(args) ? args : []).map(String);
  const cmd = a[0] || 'status';
  if (cmd === 'status') { game.oda(`Finale: phase ${s.phase || '-'} · Angebot ${s.angebot} · Anfrage ${anfrageRest(game) ? 'ja' : 'nein'} · bereit ${bereit(game).grund || 'ja'} · Versuche ${s.versuche}`, null); return null; }
  if (cmd === 'angebot') { s.frei_ab = 0; if (!bereit(game).ok) return 'Nicht bereit: ' + bereit(game).grund; anbieten(game); return null; }
  if (cmd === 'start') return starten(game) ? null : 'Finale startet nicht (' + (bereit(game).grund || 'Szene fehlt') + ').';
  if (cmd === 'orbit') return orbitEnde(game, a[1]) ? null : 'orbit sieg | niederlage | flucht (nur in der Phase orbit)';
  if (cmd === 'boden') return bodenEnde(game, a[1]) ? null : 'boden sieg | crew_gefallen (nur in der Phase boden)';
  if (cmd === 'reset') { game.weltsim.finale = neu(); return null; }
  return 'finale [status | angebot | start | orbit <ausgang> | boden <ausgang> | reset]';
}

module.exports = { WERTE: W, neu, bereit, anbieten, nachTick, verfall, waehlen, bestaetigen, ablehnen, phase, starten, orbitEnde, bodenEnde, snapshot, schluessel, debug, ersetzen };
