'use strict';
// SPL-02 D: die Crew-Geschichte als Eingabe des Spielleiters. Action-Layer: reine Funktionen auf dem Weltstand (Kanon, Liste der Faeden, Karte), kein Zustand, kein Netz, alle Zahlen und Texte in
// content/faeden/geschichte.json. Dieses Modul kennt keinen Absichts- und keinen Beat-Namen: welche NSC eine Fortsetzung tragen, sagt der Katalog der Absichten (absicht-pruefer.js fortsetzungsNamen).
//
//   geschichteZeilen(game, opts?) -> { zeilen: [Text], kennungen: { K1: Vollname, ... }, zeichen }
//        4 bis 6 ausgewaehlte NSC (zeilen_min/-max, zeichen_ziel), deterministisch aus dem Zustand: zuerst die NSC, die eine Fortsetzung tragen (Kandidaten der Absichten), dann Zustand mit Folgen
//        (feindlich, verbuendet, gefangen), dann der juengste Faden; Tote fehlen. Zeile: "K1 Vollname (volk), Ortsname: ausgang, jetzt zustand, Haltung h, Taten a b, Ware w".
//        SPIELERNAMEN: nie in der Zeile (der Kontext kennt keine). Faellt ein NSC-Name (Vor- oder Nachname) mit einem Spielernamen zusammen (derselbe Filter wie die Anzeige: lage-ausschnitt ohneNamen),
//        nennt die Zeile nur Kennung, Volk und Rolle statt des Namens; die Kennung loest weiter zum Vollnamen auf (nur der Server kennt ihn).
//        opts: { werte?, katalog? }  (Tests)
//   bezugAufloesen(kennungen, bezug) -> { ok: true, bezug } | { ok: false, fehler: [{ code: BEZUG_UNBEKANNT, feld, grund, gegenvorschlag? }] }
//        ein Bezug { nsc: 'K2' } wird zu { nsc: <Vollname> }; ein Vollname bleibt (der Pruefer prueft ihn gegen den Kanon); eine Kennung, die es nicht gibt, ist BEZUG_UNBEKANNT (Format absicht-pruefer.js)
//   kandidatenZeilen(game, namen, kennungen, max) -> [Text]   SPL-02 G: Zeilen "K2 (volk), jetzt zustand, Haltung h" der genannten NSC, die eine eingefrorene Kennung haben (Folgeprompt der Verhandlung), hoechstens max
//   istKennung(text) -> bool     bezugImSpiel(game, bezug) -> wie bezugAufloesen, die Kennungen aus dem Zustand des Spiels (so gehoeren Prompt und Aufloesung zum selben Zustand)
//   imPromptStandard() -> bool   Datenwert im_prompt (Standard aus); werte() / werteNeuLesen() / werteFehler()
//   Anbindung: absicht-pruefer.js pruefeAbsicht loest Kennungen im Bezug auf (jeder Aufrufer: Verhandlung, Inszenierer); abenteuer-prompt.js haengt die Zeilen nur bei gesetztem Schalter an den Kontext.
const fs = require('fs');
const path = require('path');
const D = require('./faden-daten.js');
const Sektoren = require('../../shared/sektoren.js');

const DATEI = path.join(__dirname, '..', '..', 'content', 'faeden', 'geschichte.json');
const Faden = () => require('./faden.js');
const Kanon = () => require('./abenteuer-kanon.js');
const Brett = () => require('./abenteuer-brett.js');   // die Verbindung zum Pruefer der Absichten laeuft ueber das Brett (nur Brett, Verhandlung und Inszenierer laden den Pruefer: test-absichten-katalog)
const BEZUG_UNBEKANNT = 'BEZUG_UNBEKANNT';   // Code des Pruefers (absicht-pruefer.js CODES), gleiches Format
const Ausschnitt = () => require('./lage-ausschnitt.js');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const nr = (id) => Number(String(id).replace(/\D/g, '')) || 0;
const hexName = (hex) => { try { return Sektoren.hexName(hex) || String(hex); } catch (e) { return String(hex); } };

// ---------- Daten
let cache = null;
function lesen() {
  if (cache) return cache;
  const roh = JSON.parse(fs.readFileSync(DATEI, 'utf8'));
  cache = { werte: Object.fromEntries(Object.entries(roh.werte).map(([k, v]) => [k, v.wert])), texte: roh.texte, roh };
  return cache;
}
const werteNeuLesen = () => { cache = null; return lesen(); };
const werte = () => lesen().werte;
const imPromptStandard = () => werte().im_prompt === true;
function werteFehler(roh) {
  const out = [];
  const f = (t) => out.push(`GESCHICHTE_WERTE: ${t}`);
  try { roh = roh || JSON.parse(fs.readFileSync(DATEI, 'utf8')); } catch (e) { f('Datei nicht lesbar'); return out; }
  if (roh.format !== 'crew-geschichte/1' || !istObjekt(roh.werte) || !istObjekt(roh.texte)) { f('format "crew-geschichte/1", werte und texte fehlen'); return out; }
  const W = {};
  for (const [k, v] of Object.entries(roh.werte)) { if (!istObjekt(v) || !('wert' in v) || typeof v.einheit !== 'string' || typeof v._hinweis !== 'string') f(`${k}: wert, einheit, _hinweis`); else W[k] = v.wert; }
  const ganz = (n, min) => Number.isInteger(n) && n >= min;
  for (const k of ['zeilen_min', 'zeilen_max', 'zeichen_ziel', 'zeile_max', 'taten_je_zeile']) if (!ganz(W[k], 1)) f(`${k}: ganze Zahl ab 1`);
  if (ganz(W.zeilen_min, 1) && ganz(W.zeilen_max, 1) && W.zeilen_min > W.zeilen_max) f('zeilen_min liegt ueber zeilen_max');
  if (ganz(W.zeile_max, 1) && ganz(W.zeichen_ziel, 1) && W.zeile_max > W.zeichen_ziel) f('zeile_max liegt ueber zeichen_ziel');
  if (typeof W.im_prompt !== 'boolean') f('im_prompt: Wahrheitswert');
  if (!(typeof W.kennung_praefix === 'string' && /^[A-Z]{1,3}$/.test(W.kennung_praefix))) f('kennung_praefix: 1 bis 3 Grossbuchstaben');
  for (const k of ['ausschliessen_status', 'folgen_status']) if (!(Array.isArray(W[k]) && W[k].every((s) => typeof s === 'string' && s.length))) f(`${k}: Liste von Texten`);
  if (typeof W.platzhalter_rolle !== 'string' || !W.platzhalter_rolle.length) f('platzhalter_rolle: Text');
  for (const k of ['jetzt', 'haltung', 'taten', 'ware']) if (typeof roh.texte[k] !== 'string' || !roh.texte[k].length) f(`texte.${k}: Text`);
  return out;
}

// ---------- Kennungen
const kennungRe = () => new RegExp('^' + werte().kennung_praefix + '[1-9][0-9]?$');
const istKennung = (t) => typeof t === 'string' && kennungRe().test(t.trim());

// ---------- Auswahl
const faedenZustand = (game) => { try { return Faden().aktiv(game) ? Faden().zustandVon(game) : null; } catch (e) { return null; } };
// je Person (Vollname) der juengste ABGESCHLOSSENE Kanon-Eintrag; der NSC aus der Liste der Faeden, wenn sein juengster Faden noch dort steht (Zustand und Haltung jetzt), sonst nur das, was der Kanon weiss
function personen(F) {
  const kopf = new Map();
  for (const e of Kanon().liste(F)) if (e.ausgang !== undefined && (!kopf.has(e.name) || nr(e.f) >= nr(kopf.get(e.name).f))) kopf.set(e.name, e);
  const out = [];
  for (const e of kopf.values()) {
    let f = null;
    for (const x of F.liste || []) if (x.nsc && x.nsc.name === e.name && x.phase === 'abgeschlossen' && (!f || nr(x.id) >= nr(f.id))) f = x;
    out.push({ e, nsc: f ? f.nsc : null, status: f ? f.nsc.status : e.status });
  }
  return out;
}
function kollidiert(game, name) {   // derselbe Filter wie die Anzeige (lage-ausschnitt ohneNamen): ersetzt er etwas im NSC-Namen, ist der Name ein Spielername (oder beginnt mit einem)
  const A = Ausschnitt();
  return A.ohneNamen(name, A.spielerNamen(game || {})) !== name;
}
// Ereignis, das der Katalog der Beats fuer "die Ware wurde nie geladen" nennt (beats.json ereignis_ohne_ware): dann steht die Ware nicht in der Zeile
const ohneWare = () => new Set(Object.values(D.BEATS).map((c) => c.ereignis_ohne_ware).filter((x) => typeof x === 'string'));
const zahl = (d) => String(Number(d.toFixed(2)));

function zeileBauen(W, T, k, p, ort, stufe, neutral) {
  const e = p.e;
  const kopf = neutral
    ? `${k} (${e.volk}, ${p.nsc && p.nsc.schiffsklasse ? p.nsc.schiffsklasse : W.platzhalter_rolle}), ${ort}`
    : `${k} ${e.name} (${e.volk}), ${ort}`;
  const teile = [e.ausgang];
  if (p.status) teile.push(`${T.jetzt} ${p.status}`);
  if (stufe < 3 && p.nsc && Number.isFinite(p.nsc.haltung)) teile.push(`${T.haltung} ${zahl(p.nsc.haltung)}`);
  const taten = (e.taten || []).slice(-(stufe < 2 ? W.taten_je_zeile : 0));
  if (stufe < 2 && taten.length) teile.push(`${T.taten} ${taten.join(' ')}`);
  if (stufe < 1 && e.ware && !(e.taten || []).some((x) => ohneWare().has(x))) teile.push(`${T.ware} ${e.ware}`);
  return `${kopf}: ${teile.join(', ')}`;
}
// Zeile mit Stufen: erst alles, dann ohne Ware, ohne Taten (statt der Haelfte), ohne Haltung; zuletzt gekuerzt
function zeileFuer(W, T, k, p, neutral, game) {
  const hex = p.e.ort_ende || p.e.ort;
  const ort = hex ? hexName(hex) : '-';
  let z = '';
  for (let stufe = 0; stufe < 4; stufe++) { z = zeileBauen(W, T, k, p, ort, stufe, neutral); if (z.length <= W.zeile_max) break; }
  const A = Ausschnitt();
  z = A.ohneNamenImTitel(z, A.spielerNamen(game || {}));   // Sicherung: nie ein Spielername in der Zeile (Ortsname, Schiffsklasse); ganze Woerter, damit "Haltung" bei einem Spieler "Ha" bleibt
  return z.length > W.zeile_max ? z.slice(0, W.zeile_max - 1).trimEnd() + '…' : z;
}

function geschichteZeilen(game, opts) {
  opts = opts || {};
  const lw = lesen();
  const W = opts.werte || lw.werte, T = lw.texte;
  const F = faedenZustand(game);
  const leer = { zeilen: [], kennungen: {}, zeichen: 0 };
  if (!F) return leer;
  const fort = Brett().fortsetzungsNamen(game, opts.katalog);
  const folgen = new Set(W.folgen_status), aus = new Set(W.ausschliessen_status);
  const staerke = (p) => (folgen.has(p.status) && p.nsc && Number.isFinite(p.nsc.haltung) ? -Math.abs(p.nsc.haltung) : 0);   // wen die Crew stark beschaeftigt (Groll oder Dank), steht vor den anderen mit Folgen
  const rang = (p) => [fort.has(p.e.name) ? 0 : 1, folgen.has(p.status) ? 0 : 1, staerke(p), -nr(p.e.f)];
  const alle = personen(F).filter((p) => !aus.has(p.status)).sort((a, b) => { const x = rang(a), y = rang(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  const zeilen = [], kennungen = {};
  let zeichen = 0;
  for (const p of alle) {
    if (zeilen.length >= W.zeilen_max) break;
    const k = W.kennung_praefix + (zeilen.length + 1);
    const z = zeileFuer(W, T, k, p, kollidiert(game, p.e.name), game);
    const mit = zeichen + z.length + (zeilen.length ? 1 : 0);
    if (mit > W.zeichen_ziel && zeilen.length >= W.zeilen_min) break;
    zeilen.push(z); kennungen[k] = p.e.name; zeichen = mit;
  }
  return { zeilen, kennungen, zeichen };
}

// SPL-02 G: Kandidatenzeilen fuer den Folgeprompt der Verhandlung: nur NSC, die die eingefrorenen Kennungen kennen (nie ein Vollname), "K2 (volk), jetzt zustand, Haltung h"; hoechstens max Zeilen in der Reihenfolge von namen
function kandidatenZeilen(game, namen, kennungen, max) {
  const F = faedenZustand(game), T = lesen().texte, A = Ausschnitt();
  const ks = istObjekt(kennungen) ? kennungen : {};
  const von = new Map(Object.entries(ks).filter(([, n]) => typeof n === 'string').map(([k, n]) => [n, k]));
  const leute = F ? personen(F) : [];
  const out = [];
  for (const name of Array.isArray(namen) ? namen : []) {
    if (out.length >= max) break;
    const k = von.get(name), p = leute.find((x) => x.e.name === name);
    if (!k || !p) continue;
    const teile = [`${k} (${p.e.volk})`];
    if (p.status) teile.push(`${T.jetzt} ${p.status}`);
    if (p.nsc && Number.isFinite(p.nsc.haltung)) teile.push(`${T.haltung} ${zahl(p.nsc.haltung)}`);
    out.push(A.ohneNamenImTitel(teile.join(', '), A.spielerNamen(game || {})));
  }
  return out;
}

// ---------- Aufloesen
function bezugAufloesen(kennungen, bezug) {
  if (!istObjekt(bezug) || typeof bezug.nsc !== 'string' || !istKennung(bezug.nsc)) return { ok: true, bezug };
  const k = bezug.nsc.trim();
  const ks = istObjekt(kennungen) ? kennungen : {};
  if (has(ks, k) && typeof ks[k] === 'string') return { ok: true, bezug: Object.assign({}, bezug, { nsc: ks[k] }) };
  const bekannt = Object.keys(ks);
  const grund = `die Kennung ${k.slice(0, 6)} steht nicht in der Crew-Geschichte${bekannt.length ? ' (bekannt: ' + bekannt.join(', ') + ')' : ' (sie ist leer)'}`;
  const f = { code: BEZUG_UNBEKANNT, feld: 'bezug.nsc', grund };
  if (bekannt.length) f.gegenvorschlag = { patch: [{ feld: 'bezug.nsc', wert: bekannt[0] }], text: `Bezug ${bekannt[0]}` };
  return { ok: false, fehler: [f] };
}
// Kennungen aus dem Zustand: nur berechnet, wenn der Bezug wirklich eine Kennung nennt
function bezugImSpiel(game, bezug, opts) {
  if (!istObjekt(bezug) || !istKennung(bezug.nsc)) return { ok: true, bezug };
  return bezugAufloesen(geschichteZeilen(game, opts).kennungen, bezug);
}

module.exports = { geschichteZeilen, kandidatenZeilen, bezugAufloesen, bezugImSpiel, istKennung, imPromptStandard, werte, werteNeuLesen, werteFehler };
