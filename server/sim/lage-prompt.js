'use strict';
// SUND-03 A2: Prompt des Lage-Spielleiters (Freie Fahrt Sund) und Lesen seiner Antwort. Reine Funktionen, kein Zustand, kein Netz.
//
//   katalogText()                      Katalog der Befehle und Grenzen als Text, ABGELEITET aus den Daten (befehle-werte.json, regie-werte.json, content/welt/lage-katalog.json mit den Feldlisten). Statisch:
//                                      hängt nur von den Daten ab, nie vom Spielstand (steht deshalb vorn im Prompt, Cache-Treffer)
//   statischerTeil()                   { text, hash } von katalogText (Test: gleich über zwei Aufrufe)
//   baue(game, { art, letzte, werte }) -> { prompt, zeichen, ausschnitt: { stufe, zeichen }, katalogHash }  Prompt in buildPrompt-Reihenfolge: Katalog (statisch) → Ausschnitt → letzte Pläne → Grenze → Schluss.
//                                      Alles Variable läuft durch namenFiltern: keine Spielernamen im Prompt (nur crew.anzahl).
//   planAusText(text)                  -> { plan } | { fehler }  JSON-Extraktion und Reparatur (Codeblock-Zäune, Text davor/danach, Komma vor }/]); die Prüfung des Plans macht Regie.planAnwenden
//   namenFiltern(text, game)           ersetzt jeden Spielernamen durch „Crew“
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LLM = require('../mission/llm.js');
const Kern = require('../weltsim/kern.js');
const Ausschnitt = require('./lage-ausschnitt.js');

const ROOT = path.join(__dirname, '..', '..');
const KAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', 'lage-katalog.json'), 'utf8')).befehle;
const BW = Kern.BEFEHLE.WERTE;
const RW = require('../../content/welt/regie-werte.json').werte;
const FELDER = Kern.BEFEHLE.FELDER;
const SYSTEM_DATEI = path.join(LLM.PROMPT_DIR, 'lage.system.md');

// ---------- Katalog aus den Daten
function wertVon(pfad) {
  const [q, ...rest] = pfad.split('.');
  const quelle = q === 'w' ? BW : q === 'r' ? RW : null;
  if (!quelle) throw new Error('Katalogtext: unbekannte Quelle in {' + pfad + '}');
  let v = quelle[rest[0]];
  if (!v) throw new Error('Katalogtext: unbekannter Wert {' + pfad + '}');
  v = v.wert;
  for (const k of rest.slice(1)) { if (v == null || !(k in Object(v))) throw new Error('Katalogtext: unbekannter Wert {' + pfad + '}'); v = v[k]; }
  return Array.isArray(v) ? v.join('|') : String(v);
}
const einsetzen = (t) => String(t).replace(/\{([wr]\.[\w.]+)\}/g, (m, p) => wertVon(p));

let katalogCache = null;
function katalogText() {
  if (katalogCache) return katalogCache;
  const L = [];
  const P = RW.plan.wert;
  L.push('Plan (dein Antwortobjekt): { "befehle": [Befehl, ...], "fokus"?: { "hex": Hex-Code, "radius": Zahl, "dauer"?: Ticks, "fraktionen"?: ["rom"|"ger"] }, "begruendung": Satz }');
  L.push(`Höchstens ${P.befehle_max} Befehle je Plan. Höchstens ${P.vorgemerkt_max} wartende Befehle insgesamt. "fokus" im Plan wirkt auf alle erlaubten Fraktionen (${BW.fokus.wert.fraktionen.join('|')}), Standarddauer ${P.fokus_dauer} Ticks. "begruendung": höchstens ${P.begruendung_max} Zeichen, ein Satz, warum dieser Plan.`);
  L.push('Ein Befehl ist ein Objekt mit "typ" und genau den Feldern seines Typs (kein anderes Feld):');
  for (const typ of Object.keys(FELDER).sort()) {
    const k = KAT[typ];
    if (!k) throw new Error('Katalogtext: kein Eintrag für den Befehl ' + typ);
    const felder = FELDER[typ].filter((f) => f !== 'typ').map((f) => `${f}: ${k.felder[f]}`).join(', ');
    L.push(`- ${typ} { ${felder} } – ${einsetzen(k.zweck)} ${einsetzen(k.grenzen)} Abkühlung: ${RW.abkuehlung.wert[typ] || 0} Ticks je Typ und Fraktion.`);
  }
  const V = RW.vorwarnung.wert;
  L.push(`Vorwarnung: Jeder Befehl mit Wirkung auf Rom (Embargo gegen Rom, Angriff oder Überfall auf einen Ort in Roms Besitz, auch einen Posten der Crew) wird automatisch per Funk angekündigt und wirkt erst nach dem Vorlauf (mindestens ${V.mindest_vorlauf} Tick). Das machst nicht du, aber plane damit: nichts trifft die Crew ohne Ansage.`);
  L.push(`Sieger: lage.sieger im Ausschnitt ist rom, ger oder offen. Embargo nur gegen den Sieger, bei offen ist jedes Embargo ungültig. Wahl der Crew (Strategische Option) gilt vor deinen Reglern.`);
  L.push(`Je Tick wendet die Sim höchstens ${BW.je_tick_max.wert} Befehle an. Alles endet von selbst; es gibt keinen Dauerzustand.`);
  katalogCache = L.join('\n');
  return katalogCache;
}
function statischerTeil() {
  const text = katalogText();
  const sys = fs.existsSync(SYSTEM_DATEI) ? fs.readFileSync(SYSTEM_DATEI, 'utf8') : '';
  return { text, hash: crypto.createHash('sha1').update(sys + '\n\n' + text).digest('hex') };
}

// ---------- Namen
function spielerNamen(game) {
  return (game.players || []).map((p) => (p && typeof p.name === 'string' ? p.name.trim() : '')).filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
}
// wie lage-ausschnitt.js: auch ein längerer Name im Text (im Spiel auf 12 Zeichen gekürzt gespeichert) verschwindet ganz
function namenFiltern(text, game) {
  let t = String(text == null ? '' : text);
  for (const n of spielerNamen(game)) t = t.replace(new RegExp('(?<![\\wäöüÄÖÜß])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\wäöüÄÖÜß]*', 'gi'), 'Crew');
  return t;
}

// ---------- Prompt
// art: die Grenze (szene_ende | andocken | absicht | debug), nr: laufende Nummer des Plans in dieser Sitzung, letzte: kurze Pläne (Ringliste des Spielleiters), werte: lage-spielleiter-werte
function baue(game, { art, nr, letzte, werte }) {
  const st = statischerTeil();
  const letzteTxt = namenFiltern(JSON.stringify(letzte || []), game);
  const grenze = { art: String(art || 'unbekannt'), nr: Number.isInteger(nr) ? nr : 1, tick: game.weltsim ? game.weltsim.tickZahl : 0 };
  const schluss = 'Gib jetzt den Plan aus. Nur das JSON-Objekt.';
  // fester Rest: alles außer dem Ausschnitt (mit Tag-Rahmen), damit der Ausschnitt genau den freien Platz bekommt
  const ohne = LLM.buildPrompt({ katalog: st.text, variabel: [['ausschnitt', ''], ['letzte_plaene', letzteTxt], ['grenze', JSON.stringify(grenze)]], schluss });
  const frei = Math.min(Ausschnitt.MAX_ZEICHEN, werte.prompt_max_zeichen - ohne.length);
  if (frei < werte.ausschnitt_min_zeichen) return { fehler: `Prompt zu groß: für den Ausschnitt bleiben ${frei} Zeichen (Katalog ${st.text.length}, Chronik ${letzteTxt.length})` };
  const a = Ausschnitt.ausschnittPassend(game, { maxZeichen: frei });
  if (!a.passt) return { fehler: `Ausschnitt passt nicht (${a.zeichen} von ${frei} Zeichen)` };
  const text = namenFiltern(a.text, game);
  const prompt = LLM.buildPrompt({ katalog: st.text, variabel: [['ausschnitt', text], ['letzte_plaene', letzteTxt], ['grenze', JSON.stringify(grenze)]], schluss });
  return { prompt, zeichen: prompt.length, ausschnitt: { stufe: a.stufe, zeichen: a.zeichen }, katalogHash: st.hash };
}

// ---------- Antwort lesen
// Erstes vollständiges JSON-Objekt im Text (Anführungszeichen beachtet). Zäune ```json … ``` und Text davor/danach fallen weg;
// ein Komma vor } oder ] wird entfernt, wenn der Text sonst nicht lesbar ist. -> { plan } | { fehler }
function planAusText(text) {
  if (typeof text !== 'string' || !text.trim()) return { fehler: 'leere Antwort' };
  let t = text.replace(/^﻿/, '');
  const zaun = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (zaun && zaun[1].includes('{')) t = zaun[1];
  const start = t.indexOf('{');
  if (start < 0) return { fehler: 'kein JSON-Objekt in der Antwort' };
  let tiefe = 0, inStr = false, esc = false, ende = -1;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') tiefe++; else if (c === '}') { tiefe--; if (tiefe === 0) { ende = i; break; } }
  }
  if (ende < 0) return { fehler: 'JSON-Objekt nicht abgeschlossen' };
  const roh = t.slice(start, ende + 1);
  for (const versuch of [roh, roh.replace(/,\s*([}\]])/g, '$1')]) {
    try { const o = JSON.parse(versuch); if (o && typeof o === 'object' && !Array.isArray(o)) return { plan: o }; } catch (e) { /* nächster Versuch */ }
  }
  return { fehler: 'JSON nicht lesbar' };
}

module.exports = { katalogText, statischerTeil, baue, planAusText, namenFiltern, spielerNamen, SYSTEM_DATEI, KAT };
