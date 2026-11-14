'use strict';
// KAT-01 C1: Kontext-Profile und Gesamtdeckel fuer tools/messe-abenteuer.js (nur Werkzeug, kein Spielcode).
//   profilLesen(datei, cwd)          -> geprueftes Profil (wirft Error mit code 'PROFIL'; die Datei ist relativ zum Aufrufer)
//   profilPruefen(obj)               -> Profil oder wirft; unbekannte Felder sind ein Fehler (erlaubt: name, crew_hex, ziel_hex, krieg_ticks, chronik, ruf, vorgeschichte, _gemessen)
//   zielFuer(profil, i)              -> Hex des Ziels fuer den i-ten Aufruf (reihum) oder null (dann bleibt das wandernde Ziel des Spiels)
//   anwenden(g, profil, deps)        -> setzt Crew-Hex, Krieg, Chronik, Ruf in der gebauten Welt (vor dem ersten Aufruf); deps = { Kriegslage, Chronik, Ruf, Sektoren }
// Gesamtdeckel (--gesamtdeckel <Tokens>, nur mit --out): <out-Wurzel>/gesamtverbrauch.json, Summe ueber alle Laeufe und Prozesse unter der Wurzel.
//   deckelStand(wurzel)              -> { tokens, kosten_usd, laeufe[] } (fehlende Datei = leer; kaputte Datei wirft)
//   deckelPruefen(summe, deckel, schaetz) -> { ok, grund }   ok nur wenn summe < deckel UND summe + schaetz <= deckel
//   deckelVerbuchen(wurzel, lauf, d) -> addiert d = { tokens, kosten_usd } auf Summe und Lauf-Eintrag, schreibt sofort atomar (Temp-Datei + rename)
//   Rennen zwischen gleichzeitigen Prozessen: gelesen und geschrieben wird synchron in einem Zug; ein Prozess, der genau zwischen Lesen und rename eines anderen schreibt, kann einen Eintrag verlieren (Fenster Millisekunden, Messlaeufe laufen nacheinander).
//   MESSE_DECKEL_TEST_AUS=1 schaltet die Pruefung ab (nur fuer die Mutationsprobe in tools/test-messe-profil.js) und gilt NUR mit der Fake-CLI (CLAUDE_CLI enthaelt fake-claude); sonst wirft deckelTestAus (code DECKEL_TEST), messe-abenteuer.js beendet sich mit Exit 2.
const fs = require('fs');
const path = require('path');

const ERLAUBT = ['name', 'crew_hex', 'ziel_hex', 'krieg_ticks', 'chronik', 'ruf', 'vorgeschichte', '_gemessen'];
const HEX = /^\d{4}$/;
const SCHAETZ_STANDARD = 11000;
const DECKEL_DATEI = 'gesamtverbrauch.json';

function fehler(msg) { const e = new Error(msg); e.code = 'PROFIL'; return e; }
const istObjekt = (x) => x && typeof x === 'object' && !Array.isArray(x);

function profilPruefen(p, chronikArten) {
  if (!istObjekt(p)) throw fehler('Profil: ein JSON-Objekt erwartet');
  for (const k of Object.keys(p)) if (!ERLAUBT.includes(k)) throw fehler(`Profil: unbekanntes Feld "${k}" (erlaubt: ${ERLAUBT.join(', ')})`);
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || /[\r\n]/.test(p.name)) throw fehler('Profil: name ist Pflicht (Text, hoechstens 60 Zeichen, eine Zeile)');
  if (p.crew_hex !== undefined && !(typeof p.crew_hex === 'string' && HEX.test(p.crew_hex))) throw fehler('Profil: crew_hex ist ein Hex-Code aus vier Ziffern (Text)');
  if (p.ziel_hex !== undefined) {
    const l = Array.isArray(p.ziel_hex) ? p.ziel_hex : [p.ziel_hex];
    if (!l.length || !l.every((h) => typeof h === 'string' && HEX.test(h))) throw fehler('Profil: ziel_hex ist ein Hex-Code (vier Ziffern, Text) oder eine nicht leere Liste davon');
  }
  if (p.krieg_ticks !== undefined && !(Number.isInteger(p.krieg_ticks) && p.krieg_ticks >= 0 && p.krieg_ticks <= 200)) throw fehler('Profil: krieg_ticks ist eine ganze Zahl 0 bis 200 (0 = aus)');
  if (p.chronik !== undefined) {
    if (!Array.isArray(p.chronik) || p.chronik.length > 40) throw fehler('Profil: chronik ist eine Liste von hoechstens 40 Eintraegen { art, ref, kurz }');
    for (const e of p.chronik) {
      if (!istObjekt(e) || Object.keys(e).some((k) => !['art', 'ref', 'kurz'].includes(k))) throw fehler('Profil: ein Chronik-Eintrag hat genau die Felder art, ref, kurz');
      if (typeof e.art !== 'string' || (chronikArten && !chronikArten.includes(e.art))) throw fehler(`Profil: Chronik-Art "${e.art}" unbekannt${chronikArten ? ' (erlaubt: ' + chronikArten.join(', ') + ')' : ''}`);
      if (typeof e.ref !== 'string' || typeof e.kurz !== 'string' || !e.kurz.trim() || e.kurz.length > 80) throw fehler('Profil: Chronik-Eintrag braucht ref (Text) und kurz (Text, 1 bis 80 Zeichen)');
    }
  }
  if (p.ruf !== undefined) {
    if (!istObjekt(p.ruf) || Object.keys(p.ruf).some((k) => !['rom', 'ger', 'kon'].includes(k)) || !Object.values(p.ruf).every((v) => Number.isFinite(v))) throw fehler('Profil: ruf ist { rom, ger, kon } mit Zahlen (nur diese Schluessel)');
  }
  if (p.vorgeschichte !== undefined && typeof p.vorgeschichte !== 'boolean') throw fehler('Profil: vorgeschichte ist wahr oder falsch');
  if (p._gemessen !== undefined && !istObjekt(p._gemessen)) throw fehler('Profil: _gemessen ist ein Objekt');
  return p;
}

function profilLesen(datei, cwd) {
  const abs = path.resolve(cwd || process.cwd(), datei);
  let obj;
  try { obj = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { throw fehler(`Profil ${abs} nicht lesbar: ${e.message}`); }
  let arten = null;
  try { arten = require('../server/sim/chronik.js').ARTEN; } catch (e) { /* ohne Liste: nur der Typ wird geprueft */ }
  return profilPruefen(obj, arten);
}

function zielListe(p) { return p && p.ziel_hex !== undefined ? [].concat(p.ziel_hex) : null; }
function zielFuer(p, i) { const l = zielListe(p); return l ? l[i % l.length] : null; }

function anwenden(g, p, deps) {
  const { Kriegslage, Chronik, Ruf, Sektoren } = deps;
  const meldung = [];
  if (p.crew_hex !== undefined) {
    const ort = Sektoren.ortVonHex(p.crew_hex);
    const err = ort ? g.debugGoto(ort, false) : 'kein Ort am Hex';
    if (err) throw fehler(`Profil ${p.name}: crew_hex ${p.crew_hex} nicht erreichbar (${err})`);
    meldung.push(`Crew ${p.crew_hex}`);
  }
  if (p.krieg_ticks) {
    g.weltsim.zustand.absichten = { rom: { aggr: 1, p_act: 1, max_active: 5 }, ger: { aggr: 1, p_act: 1, max_active: 5 } };
    for (let i = 0; i < p.krieg_ticks; i++) Kriegslage.tickMit(g, 'debug', null, []);
    meldung.push(`Krieg ${p.krieg_ticks} Ticks`);
  }
  if (p.chronik && p.chronik.length) {
    for (const e of p.chronik) Chronik.eintragen(g, { art: e.art, ref: e.ref, kurz: e.kurz });
    meldung.push(`Chronik ${p.chronik.length}`);
  }
  if (p.ruf) {
    for (const [f, ziel] of Object.entries(p.ruf)) Ruf.aendernWegen(g, f, ziel - g.weltsim.ruf[f], 'sieg_feld_pirat');
    meldung.push('Ruf ' + Object.entries(p.ruf).map(([f, v]) => `${f} ${g.weltsim.ruf[f]}`).join('/'));
  }
  return meldung;
}

// ---------- Gesamtdeckel
function deckelStand(wurzel) {
  const f = path.join(wurzel, DECKEL_DATEI);
  if (!fs.existsSync(f)) return { format: 'gesamtverbrauch/1', tokens: 0, kosten_usd: 0, laeufe: [] };
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!d || !Number.isFinite(d.tokens) || !Number.isFinite(d.kosten_usd) || !Array.isArray(d.laeufe)) throw new Error(`${f}: kein gueltiger Zaehler (tokens, kosten_usd, laeufe)`);
  return d;
}
// true nur, wenn MESSE_DECKEL_TEST_AUS=1 UND die Fake-CLI aktiv ist; ohne Fake-CLI ist der Schalter ein Fehler (der Deckel schuetzt echte Aufrufe, er darf nicht per Umgebung abschaltbar sein)
function deckelTestAus(env) {
  const e = env || process.env;
  if (e.MESSE_DECKEL_TEST_AUS !== '1') return false;
  if (!/fake-claude/.test(e.CLAUDE_CLI || '')) { const x = new Error('MESSE_DECKEL_TEST_AUS=1 gilt nur mit der Fake-CLI (CLAUDE_CLI muss auf fake-claude zeigen); der Gesamtdeckel bleibt fuer echte Aufrufe immer an'); x.code = 'DECKEL_TEST'; throw x; }
  return true;
}
function deckelPruefen(summe, deckel, schaetz) {
  if (deckelTestAus()) return { ok: true, grund: null };
  if (summe >= deckel) return { ok: false, grund: `Summe ${summe} >= Deckel ${deckel}` };
  if (summe + schaetz > deckel) return { ok: false, grund: `Summe ${summe} + Schaetzwert ${Math.round(schaetz)} > Deckel ${deckel}` };
  return { ok: true, grund: null };
}
function atomarSchreiben(datei, text) {
  const tmp = `${datei}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, datei);
}
// lauf = { id, profil, zeit }; d = { tokens, kosten_usd } eines Aufrufs (0 = Lauf nur eintragen)
function deckelVerbuchen(wurzel, lauf, d) {
  const s = deckelStand(wurzel);
  let e = s.laeufe.find((x) => x.lauf === lauf.id);
  if (!e) { e = { lauf: lauf.id, profil: lauf.profil || null, zeit: lauf.zeit, aufrufe: 0, tokens: 0, kosten_usd: 0 }; s.laeufe.push(e); }
  const t = Math.max(0, Number(d && d.tokens) || 0), k = Math.max(0, Number(d && d.kosten_usd) || 0);
  if (t || k || (d && d.aufruf)) e.aufrufe++;
  e.tokens += t; e.kosten_usd = Math.round((e.kosten_usd + k) * 1e6) / 1e6;
  s.tokens += t; s.kosten_usd = Math.round((s.kosten_usd + k) * 1e6) / 1e6;
  e.zeit_ende = new Date().toISOString();
  fs.mkdirSync(wurzel, { recursive: true });
  atomarSchreiben(path.join(wurzel, DECKEL_DATEI), JSON.stringify(s, null, 1));
  return s;
}

module.exports = { ERLAUBT, SCHAETZ_STANDARD, DECKEL_DATEI, profilPruefen, profilLesen, zielFuer, zielListe, anwenden, deckelStand, deckelPruefen, deckelVerbuchen, deckelTestAus };
