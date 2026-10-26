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
  L.push(`Rate: höchstens ${RW.rate.wert.max} angenommene Befehle je ${RW.rate.wert.fenster} Ticks (alle Typen und Fraktionen zusammen); der Fokus eines Plans kostet nur einen Platz, egal für wie viele Fraktionen. Im Ausschnitt steht befehle_frei: rate (Rest der Rate), piraten (bereite Piratenflotten), platz (freie max_active-Plätze je Reich, auch außerhalb des Umkreises), abk (Rest der Abkühlzeit in Ticks, nur wenn größer 0; Schlüssel: Befehlstyp, dazu bei angreifen, beanspruchen, verstaerken, rueckzug und regler :rom oder :ger (regler auch :kon), bei embargo :Ziel-Fraktion, bei soeldner :Reich, bei nachschub :Reich:Gut, fokus und piratenueberfall ohne Zusatz), marken (Marken je Reich), soeldner (Ids der freien Konkordat-Flotten); nur wenn es nötig ist: kein_angriff (Reiche, deren Munition oder Treibstoff für einen Angriff nicht reicht: ein Angriff dieses Reichs scheitert) und nachschub_max (je eingeschränktem Reich die größte Nachschubmenge je Gut T und U, 0 = geht nicht: Konkordat-Vorrat, Marken oder Embargo). Fehlt ein Eintrag, ist die Voraussetzung erfüllt. Plane nur, was dort noch frei ist. Im Block letzte_plaene steht jeder Befehl als „Befehl Ziel: ok“ oder „Befehl Ziel: abgelehnt (Grund)“; „fokus (beide) HEX“ ist ein Fokus für Rom und Germanen und kostet einen Rate-Platz; „angenommen“ zählt die gebuchten Rate-Plätze.`);
  L.push('Ein Befehl ist ein Objekt mit "typ" und genau den Feldern seines Typs (kein anderes Feld):');
  for (const typ of Object.keys(FELDER).sort()) {
    if (typ === 'sabotage') continue;   // SUND-04a-2 P3: nur aus der Enthüllung eines Fadens (faden-p3.js), nie im Plan
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
// SUND-04a-1 B: mit Schalter FAEDEN=1 und mindestens einer geprüften Vorlage kommt der Abschnitt der Fäden (aus den Daten abgeleitet, statisch) ans Ende des Katalogs; sonst ist der Text wie vorher
const fadenText = (game) => { try { const F = require('./faden.js'); return F.aktiv(game) ? F.promptText() : ''; } catch (e) { return ''; } };
function statischerTeil(faeden) {
  const text = katalogText() + (faeden ? '\n' + faeden : '');
  const sys = fs.existsSync(SYSTEM_DATEI) ? fs.readFileSync(SYSTEM_DATEI, 'utf8') : '';
  return { text, hash: crypto.createHash('sha1').update(sys + '\n\n' + text).digest('hex') };
}

// ---------- Namen
// Der Filter gehört lage-ausschnitt.js (Chronik-Freitext ist dort schon gefiltert). Hier nur für Freitext, den der Spielleiter selbst einsetzt (letzte Pläne): NIE über serialisiertes JSON
// (kurze Namen wie „Rom“ oder „01“ träfen Schlüssel, Fraktionen und Hex-Codes).
const spielerNamen = Ausschnitt.spielerNamen;
function namenFiltern(text, game) { return Ausschnitt.ohneNamen(text, spielerNamen(game)); }
// letzte Pläne: nur der Freitext (begruendung, vom Modell geschrieben) wird gefiltert; Grenze, Befehle und Zahlen sind Struktur
function plaeneFiltern(plaene, game) {
  return (plaene || []).map((p) => (p && typeof p.begruendung === 'string' ? Object.assign({}, p, { begruendung: namenFiltern(p.begruendung, game) }) : p));
}
// SUND-03 F: der Block <letzte_plaene> bleibt unter einer Zeichenobergrenze (Daten letzte_plaene_zeichen.gesamt): erst kürzere Kurzgründe in den Befehls-Ergebnissen, dann fällt der älteste Plan weg
// Kurzgrund eines Ergebnistextes „Befehl: abgelehnt (Grund)“ auf len Zeichen kürzen (len 0: ohne Grund). Der Grund darf selbst Klammern enthalten: gesucht wird die ERSTE Marke, der Text endet mit der letzten Klammer.
const ABGELEHNT = ': abgelehnt (';
function grundKuerzen(b, len) {
  const s = String(b), i = s.indexOf(ABGELEHNT);
  if (i < 0) return s;
  const kopf = s.slice(0, i);
  if (!len) return kopf + ': abgelehnt';
  const grund = s.slice(i + ABGELEHNT.length, s.endsWith(')') ? -1 : undefined);
  return kopf + ABGELEHNT + grund.slice(0, len) + ')';
}
function plaeneKuerzen(plaene, maxGesamt) {
  let p = (plaene || []).map((x) => Object.assign({}, x));
  const groesse = () => JSON.stringify(p).length;
  for (const len of [30, 16, 0]) {
    if (groesse() <= maxGesamt) break;
    p = p.map((x) => Object.assign({}, x, { befehle: (x.befehle || []).map((b) => grundKuerzen(b, len)) }));
  }
  while (p.length > 1 && groesse() > maxGesamt) p.shift();
  return p;
}

// ---------- Prompt
// art: die Grenze (szene_ende | andocken | absicht | debug), nr: laufende Nummer des Plans in dieser Sitzung, letzte: kurze Pläne (Ringliste des Spielleiters), werte: lage-spielleiter-werte
function baue(game, { art, nr, letzte, werte }) {
  const st = statischerTeil(fadenText(game));
  const letzteTxt = JSON.stringify(plaeneKuerzen(plaeneFiltern(letzte, game), werte.letzte_plaene_zeichen ? werte.letzte_plaene_zeichen.gesamt : 900));
  const grenze = { art: String(art || 'unbekannt'), nr: Number.isInteger(nr) ? nr : 1, tick: game.weltsim ? game.weltsim.tickZahl : 0 };
  const schluss = 'Gib jetzt den Plan aus. Nur das JSON-Objekt.';
  // fester Rest: alles außer dem Ausschnitt (mit Tag-Rahmen), damit der Ausschnitt genau den freien Platz bekommt
  const ohne = LLM.buildPrompt({ katalog: st.text, variabel: [['ausschnitt', ''], ['letzte_plaene', letzteTxt], ['grenze', JSON.stringify(grenze)]], schluss });
  const frei = Math.min(Ausschnitt.MAX_ZEICHEN, werte.prompt_max_zeichen - ohne.length);
  if (frei < werte.ausschnitt_min_zeichen) return { fehler: `Prompt zu groß: für den Ausschnitt bleiben ${frei} Zeichen (Katalog ${st.text.length}, Chronik ${letzteTxt.length})` };
  const a = Ausschnitt.ausschnittPassend(game, { maxZeichen: frei });
  if (!a.passt) return { fehler: `Ausschnitt passt nicht (${a.zeichen} von ${frei} Zeichen)` };
  const text = a.text;   // Freitext (Chronik) hat lage-ausschnitt.js schon gefiltert; ein zweiter Durchlauf über das JSON würde Schlüssel und Codes beschädigen
  const prompt = LLM.buildPrompt({ katalog: st.text, variabel: [['ausschnitt', text], ['letzte_plaene', letzteTxt], ['grenze', JSON.stringify(grenze)]], schluss });
  return { prompt, zeichen: prompt.length, ausschnitt: { stufe: a.stufe, zeichen: a.zeichen }, katalogHash: st.hash };
}

// ---------- Antwort lesen
// Erstes vollständiges JSON-Objekt im Text (Anführungszeichen beachtet). Zäune ```json … ``` und Text davor/danach fallen weg;
// ein Komma vor } oder ] wird entfernt, wenn der Text sonst nicht lesbar ist. -> { plan } | { fehler }
const PLAN_KEYS = ['befehle', 'fokus', 'begruendung'];
// Ende des Objekts, das bei start beginnt (Zeichenketten beachtet), sonst -1
function objektEnde(t, start) {
  let tiefe = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') tiefe++; else if (c === '}') { tiefe--; if (tiefe === 0) return i; }
  }
  return -1;
}
function objektLesen(roh) {
  for (const versuch of [roh, roh.replace(/,\s*([}\]])/g, '$1')]) {
    try { const o = JSON.parse(versuch); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch (e) { /* nächster Versuch */ }
  }
  return null;
}
function planAusText(text) {
  if (typeof text !== 'string' || !text.trim()) return { fehler: 'leere Antwort' };
  let t = text.replace(/^﻿/, '');
  const zaun = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (zaun && zaun[1].includes('{')) t = zaun[1];
  if (t.indexOf('{') < 0) return { fehler: 'kein JSON-Objekt in der Antwort' };
  // jedes „{“ der Reihe nach: das erste lesbare Objekt in Plan-Form gilt (Text mit Klammern davor stört nicht); sonst das erste lesbare Objekt (die Prüfung lehnt es mit Grund ab)
  let erstes = null, geschlossen = false;
  for (let i = t.indexOf('{'); i >= 0; i = t.indexOf('{', i + 1)) {
    const ende = objektEnde(t, i);
    if (ende < 0) continue;
    geschlossen = true;
    const o = objektLesen(t.slice(i, ende + 1));
    if (!o) continue;
    if (PLAN_KEYS.some((k) => k in o)) return { plan: o };
    if (!erstes) erstes = o;
  }
  if (erstes) return { plan: erstes };
  return { fehler: geschlossen ? 'JSON nicht lesbar' : 'JSON-Objekt nicht abgeschlossen' };
}

module.exports = { plaeneKuerzen, grundKuerzen, katalogText, statischerTeil, baue, planAusText, namenFiltern, spielerNamen, SYSTEM_DATEI, KAT };
