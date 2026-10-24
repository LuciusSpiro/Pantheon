'use strict';
// SUND-03 A: Schnittstelle des Lage-Spielleiters zur Weltsimulation (nur Modus Freie Fahrt Sund, game.weltsim). Action-Layer wie absicht.js und ruf.js.
// Der Spielleiter (spätere Pakete: Modell-Anbindung, Texte, Reise-Ereignisse) liefert einen PLAN { befehle: [ { typ, ... } ], fokus?: { hex, radius, dauer?, fraktionen? }, begruendung? } als JSON
// (Objekt oder JSON-Text). Dieses Modul prüft ihn (Schema, Spielregeln, Kern-Prüfer server/weltsim/befehle.js), lehnt Ungültiges mit Grund ab, merkt Gültiges für einen der nächsten Ticks vor
// und gibt Ergebnis und Ablehnungen für das Regie-Logbuch zurück (server/mission/regielog.js, art lage_befehl). Der Spielleiter erzählt nur, was die Sim meldet, und erfindet Neues nur über
// diesen Katalog; er rechnet nichts. Das Spiel wartet nie auf ihn: kein Plan, ein ungültiger Plan oder ein Ausfall heißt, dass keine Befehle gespielt werden und die Standard-KI unverändert
// weiterläuft (Test: Sim byte-gleich zu „ohne Spielleiter“).
//
// Fairness (Mehrspieler, Kai): dieselben Regeln für alle Fraktionen. Der Spielleiter darf alle Fraktionen steuern, aber jeder Befehl mit Wirkung auf Rom (Embargo gegen Rom, Angriff oder
// Überfall auf einen Ort in Roms Besitz, auch einen Posten der Crew) wird ZUERST angekündigt (Funk, Sprecher Oberkommando/Aufklärung) und erst nach dem Vorlauf wirksam (Daten regie-werte.json,
// mindestens ein Tick, vom Code erzwungen): die Gefahr wird angekündigt, es gibt keine Scheinwahl. Ein Embargo gilt nur gegen die siegreiche Seite (lage.sieger, Kennzahl unten).
//
// Zustand: game.weltsim.regie = { vorgemerkt: [{ b: Befehl, ab: Tick, w?: 1 }], letzte: { Schlüssel: Tick } } (Zeit = ws.tickZahl). vorgemerkt: angenommene Befehle, die ab Tick `ab` an Kern.tick gehen
// (w = angekündigt); letzte: Tick der letzten Annahme je Typ und Fraktion (Abkühlzeit). Er gehört NICHT zum Sim-Zustand und wird als welt.sim.regie gespeichert (optional, additiv, Version bleibt 3).
//
//   neu() / toSave(ws) / lesen(block, tickZahl)   Weltstand-Block welt.sim.regie (Altstand und Müll = leer)
//   planAnwenden(game, plan) -> { ok, grund?, angenommen: [{ befehl, ab, vorwarnung }], abgelehnt: [{ befehl, grund }], funk: [{ von, text }] }
//                         prüft den Plan, merkt Gültiges vor, schickt die Vorwarnungen und schreibt das Regie-Logbuch. Ohne Modus oder bei einem unlesbaren Plan ändert sich nichts (ok false).
//   planPruefen(game, plan)  dasselbe ohne etwas zu ändern (Probelauf)
//   rueckfall(game, grund)   der Spielleiter fällt aus: wartende Befehle und die Überlagerung der Regie (zustand.regie) entfallen, die Standard-KI läuft allein weiter. -> Zahl der verworfenen Befehle
//   verwerfe(game)           wie rueckfall, aber ohne Logbuch (für Tests und Neustart)
//   vorTick(game, n)         Befehle, die für Tick n fällig sind (Aufrufer: Kriegslage.tickMit), werden aus der Warteschlange genommen
//   nachTick(game, res, fällige, n)   Ergebnis des Kerns auswerten -> { funk, log }; melde(game, aus) schreibt sie nach dem Commit
//   lage(game) -> { sieger: 'rom'|'ger'|'offen', anteil, schwung, macht }  Kennzahl „siegreiche Seite“
const fs = require('fs');
const path = require('path');
const Kern = require('../weltsim/kern.js');
const Regielog = require('../mission/regielog.js');
const Sektoren = require('../../shared/sektoren.js');

const R = require('../../content/welt/regie-werte.json').werte;
const TEXTE_FILE = path.join(__dirname, '..', '..', 'content', 'flotte', 'lage-befehle.json');
const KATALOG = Kern.BEFEHLE.KATALOG;
const BW = Kern.BEFEHLE.WERTE;
const PLAN_FELDER = ['befehle', 'fokus', 'begruendung'];
const FOKUS_FELDER = ['hex', 'radius', 'dauer', 'fraktionen'];
const KEY_MAX = 40;

let texteCache = null;
function texte() {
  if (texteCache) return texteCache;
  try { texteCache = JSON.parse(fs.readFileSync(TEXTE_FILE, 'utf8')); } catch (e) { texteCache = {}; }
  return texteCache;
}
const fmt = (s, o) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? String(o[k]) : m));
const klon = (v) => JSON.parse(JSON.stringify(v));
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const ganz = (v, d) => (Number.isFinite(v) ? Math.floor(v) : d);

const neu = () => ({ vorgemerkt: [], letzte: {} });
const zustandVon = (game) => { const ws = game.weltsim; if (!ws) return null; if (!ws.regie) ws.regie = neu(); return ws.regie; };

// ---------- Kennzahl „siegreiche Seite“ (lage.sieger)
const FENSTER = R.sieger.wert;
function macht(z, f) {
  const d = Kern.datenVon(z);
  let p = 0;
  for (const code of d.codes) {
    const nd = z.hexe[code];
    if (nd.besitzer !== f) continue;
    if (d.hex[code].hafen) p += z.werte.bevoelkerung[d.hex[code].hafen]; else if (nd.posten) p += z.werte.bevoelkerung.P;
  }
  return p + FENSTER.staerke_gewicht * z.flotten.filter((fl) => fl.fraktion === f).reduce((s, fl) => s + fl.staerke, 0);
}
// Schwung: Eroberungen minus Verluste von Häfen und Posten der letzten Ticks, aus dem Ereignisring (Rom minus Germanen). Der Ring steht nicht im Weltstand: nach dem Laden ist der Schwung 0.
function schwung(ws) {
  const s = { rom: 0, ger: 0 };
  const ab = ws.tickZahl - FENSTER.schwung_fenster;
  for (const e of ws.ereignisse || []) {
    if (!(e.n > ab)) continue;
    if (e.typ === 'hafen_gefallen') { if (e.neu in s) s[e.neu]++; if (e.alt in s) s[e.alt]--; }
    else if (e.typ === 'posten_verloren') { if (e.durch in s) s[e.durch]++; if (e.besitzer in s) s[e.besitzer]--; }
  }
  return { rom: s.rom, ger: s.ger, saldo: s.rom - s.ger };
}
function lage(game) {
  const ws = game.weltsim;
  if (!ws) return null;
  const z = ws.zustand, m = { rom: macht(z, 'rom'), ger: macht(z, 'ger') };
  const anteil = m.rom + m.ger > 0 ? m.rom / (m.rom + m.ger) : 0.5;
  const sw = schwung(ws);
  let sieger = 'offen';
  if (Math.abs(sw.saldo) >= FENSTER.schwung_min) sieger = sw.saldo > 0 ? 'rom' : 'ger';
  else if (anteil >= FENSTER.macht_schwelle) sieger = 'rom';
  else if (anteil <= 1 - FENSTER.macht_schwelle) sieger = 'ger';
  return { sieger, anteil: Math.round(anteil * 1000) / 1000, schwung: sw, macht: { rom: Math.round(m.rom * 10) / 10, ger: Math.round(m.ger * 10) / 10 } };
}

// ---------- Plan lesen (Schema)
function planLesen(plan) {
  let p = plan;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return { fehler: 'Plan ist kein gültiges JSON' }; } }
  if (!istObjekt(p)) return { fehler: 'Plan ist kein Objekt' };
  for (const k of Object.keys(p)) if (!PLAN_FELDER.includes(k)) return { fehler: `Plan: unbekanntes Feld "${k}"` };
  if (p.befehle !== undefined && !Array.isArray(p.befehle)) return { fehler: 'Plan: befehle ist keine Liste' };
  if (p.fokus !== undefined) {
    if (!istObjekt(p.fokus)) return { fehler: 'Plan: fokus ist kein Objekt' };
    for (const k of Object.keys(p.fokus)) if (!FOKUS_FELDER.includes(k)) return { fehler: `Plan: fokus: unbekanntes Feld "${k}"` };
  }
  if (p.begruendung !== undefined && typeof p.begruendung !== 'string') return { fehler: 'Plan: begruendung ist kein Text' };
  return { plan: { befehle: p.befehle || [], fokus: p.fokus, begruendung: typeof p.begruendung === 'string' ? p.begruendung.slice(0, R.plan.wert.begruendung_max) : null } };
}

// Plan-Fokus -> ein Fokus-Befehl je Fraktion (fraktionen aus dem Plan oder alle erlaubten aus befehle-werte.json)
function fokusBefehle(f) {
  const fr = f.fraktionen !== undefined ? f.fraktionen : BW.fokus.wert.fraktionen;
  if (!Array.isArray(fr) || !fr.length) return [{ typ: 'fokus', fraktion: null, hex: f.hex, radius: f.radius, dauer: f.dauer !== undefined ? f.dauer : R.plan.wert.fokus_dauer }];
  return fr.map((x) => ({ typ: 'fokus', fraktion: x, hex: f.hex, radius: f.radius, dauer: f.dauer !== undefined ? f.dauer : R.plan.wert.fokus_dauer }));
}

// ---------- Regeln des Aufsatzes
function abkuehlSchluessel(b) {
  switch (b.typ) {
    case 'embargo': return 'embargo:' + b.gegen;
    case 'soeldner': return 'soeldner:' + b.an;
    case 'nachschub': return 'nachschub:' + b.an + ':' + b.gut;
    case 'piratenueberfall': return 'piratenueberfall';
    case 'fokus': return 'fokus';
    default: return b.typ + ':' + b.fraktion;
  }
}
const schluesselOk = (k) => typeof k === 'string' && k.length <= KEY_MAX;
// Trifft der Befehl Rom (Vorwarnung)? -> null | { art: 'embargo'|'angreifen'|'piratenueberfall', ort?, stuetzpunkt? }
function trifftRom(z, b) {
  if (!b || typeof b !== 'object') return null;
  if (b.typ === 'embargo') return b.gegen === 'rom' ? { art: 'embargo' } : null;
  const ort = b.typ === 'angreifen' ? b.ziel : b.typ === 'piratenueberfall' ? b.ort : null;
  if (!ort || typeof ort !== 'string' || !z.hexe[ort] || z.hexe[ort].besitzer !== 'rom') return null;
  return { art: b.typ, ort, stuetzpunkt: z.hexe[ort].crew === true };
}
const vorlaufVon = (art) => Math.max(R.vorwarnung.wert.mindest_vorlauf, ganz(R.vorwarnung.wert.vorlauf[art], 0), 1);

function regelFehler(game, b, kennzahl) {
  const ws = game.weltsim, s = zustandVon(game);
  if (!istObjekt(b)) return 'kein Befehl';
  if (typeof b.typ !== 'string' || !Object.prototype.hasOwnProperty.call(KATALOG, b.typ)) return `unbekannter Typ "${b.typ}"`;
  const abk = ganz(R.abkuehlung.wert[b.typ], 0), key = abkuehlSchluessel(b);
  if (!schluesselOk(key)) return 'Schlüssel zu lang';
  if (abk > 0 && Number.isFinite(s.letzte[key]) && ws.tickZahl - s.letzte[key] < abk) return `Abkühlzeit: ${b.typ} gilt erst wieder in ${abk - (ws.tickZahl - s.letzte[key])} Sprüngen`;
  if (b.typ === 'embargo' && R.embargo_regel.wert.nur_gegen_sieger) {
    if (kennzahl.sieger === 'offen') return 'Embargo nur gegen die siegreiche Seite, derzeit ist keine entschieden (offen)';
    if (b.gegen !== kennzahl.sieger) return `Embargo nur gegen die siegreiche Seite (${kennzahl.sieger}), nicht gegen ${b.gegen}`;
  }
  return null;
}

// ---------- Plan prüfen und anwenden
function pruefen(game, plan) {
  const ws = game.weltsim, s = zustandVon(game), z = ws.zustand, n0 = ws.tickZahl;
  const out = { ok: false, grund: null, angenommen: [], abgelehnt: [], funk: [], begruendung: null };
  const p = planLesen(plan);
  if (p.fehler) { out.grund = p.fehler; return { out, neu: [] }; }
  out.ok = true; out.begruendung = p.plan.begruendung;
  const kennzahl = lage(game);
  const kand = [];
  const roh = p.plan.befehle.map((b, i) => ({ b, i }));
  for (const f of p.plan.fokus ? fokusBefehle(p.plan.fokus) : []) roh.push({ b: f, i: -1 });
  let planN = 0;
  for (const { b, i } of roh) {
    if (i >= 0) { planN++; if (planN > R.plan.wert.befehle_max) { out.abgelehnt.push({ befehl: b, grund: `mehr als ${R.plan.wert.befehle_max} Befehle im Plan` }); continue; } }
    const kopie = istObjekt(b) ? klon(b) : b;
    const g = regelFehler(game, kopie, kennzahl);
    if (g) { out.abgelehnt.push({ befehl: b, grund: g }); continue; }
    if (s.vorgemerkt.length + kand.length >= R.plan.wert.vorgemerkt_max) { out.abgelehnt.push({ befehl: b, grund: `zu viele wartende Befehle (höchstens ${R.plan.wert.vorgemerkt_max})` }); continue; }
    // Abkühlzeit auch innerhalb eines Plans: zwei Befehle desselben Schlüssels in einem Plan zählen als einer (der zweite wartet die Abkühlzeit ab)
    const key = abkuehlSchluessel(kopie);
    if (i >= 0 && ganz(R.abkuehlung.wert[kopie.typ], 0) > 0 && kand.some((k) => k.key === key)) { out.abgelehnt.push({ befehl: b, grund: `Abkühlzeit: ${kopie.typ} schon im selben Plan` }); continue; }
    kand.push({ b: kopie, orig: b, key });
  }
  // Kern-Prüfer: gegen eine Kopie der Sim, erst die wartenden (ihr Stand zählt), dann die neuen der Reihe nach
  const wartend = s.vorgemerkt.map((e) => e.b);
  const liste = wartend.concat(kand.map((k) => k.b));
  const { gueltig, verworfen } = Kern.filtereBefehle(z, liste);
  for (const k of kand) {
    const v = verworfen.find((x) => x.befehl === k.b);
    if (v) { out.abgelehnt.push({ befehl: k.orig, grund: v.grund }); continue; }
    if (!gueltig.includes(k.b)) { out.abgelehnt.push({ befehl: k.orig, grund: 'abgelehnt' }); continue; }
    const w = trifftRom(z, k.b);
    const ab = n0 + 1 + (w ? vorlaufVon(w.art) : 0);
    out.angenommen.push({ befehl: k.b, ab, vorwarnung: !!w, _w: w, _key: k.key });
  }
  return { out, neu: out.angenommen };
}

function vorwarnText(w, ab, n0, b) {
  const T = texte().vorwarnung || {};
  const sprung = Math.max(1, ab - n0);
  const key = w.art === 'embargo' ? 'embargo' : (w.art + (w.stuetzpunkt ? '_stuetzpunkt' : ''));
  const t = T[key] || T[w.art];
  if (!t) return null;
  const waren = b.typ === 'embargo' ? b.waren.map((g) => (texte().waren || {})[g] || g).join(', ') : '';
  return { von: t.sprecher || 'Oberkommando', text: fmt(t.text, { ziel: w.ort ? (Sektoren.hexName(w.ort) || w.ort) : '', n: sprung, waren }) };
}

function planPruefen(game, plan) {
  if (!game.weltsim) return { ok: false, grund: 'modus', angenommen: [], abgelehnt: [], funk: [] };
  const { out } = pruefen(game, plan);
  return { ok: out.ok, grund: out.grund, angenommen: out.angenommen.map((a) => ({ befehl: a.befehl, ab: a.ab, vorwarnung: a.vorwarnung })), abgelehnt: out.abgelehnt, funk: [] };
}

function planAnwenden(game, plan) {
  const ws = game.weltsim;
  if (!ws) return { ok: false, grund: 'modus', angenommen: [], abgelehnt: [], funk: [] };
  const s = zustandVon(game), n0 = ws.tickZahl;
  const { out } = pruefen(game, plan);
  const funk = [];
  if (!out.ok) {
    schreibe(game, { art: 'lage_befehl', ausgang: 'plan_abgelehnt', fehler: [out.grund], begruendung: 'Plan unbrauchbar, die Standard-KI läuft allein weiter', plan: kurz(plan) });
    return { ok: false, grund: out.grund, angenommen: [], abgelehnt: [], funk };
  }
  for (const a of out.angenommen) {
    s.vorgemerkt.push(a._w ? { b: a.befehl, ab: a.ab, w: 1 } : { b: a.befehl, ab: a.ab });
    s.letzte[a._key] = n0;
    if (a._w) { const f = vorwarnText(a._w, a.ab, n0, a.befehl); if (f) funk.push(f); }
  }
  for (const f of funk) funkSenden(game, f);
  for (const a of out.angenommen) schreibe(game, { art: 'lage_befehl', ausgang: 'vorgemerkt', key: a.befehl.typ, plan: a.befehl, begruendung: out.begruendung || (a.vorwarnung ? 'angekündigt, wirksam ab Tick ' + a.ab : 'wirksam ab Tick ' + a.ab) });
  for (const a of out.abgelehnt) schreibe(game, { art: 'lage_befehl', ausgang: 'abgelehnt', key: istObjekt(a.befehl) && typeof a.befehl.typ === 'string' ? a.befehl.typ : null, plan: kurz(a.befehl), fehler: [a.grund] });
  return { ok: true, grund: null, angenommen: out.angenommen.map((a) => ({ befehl: a.befehl, ab: a.ab, vorwarnung: a.vorwarnung })), abgelehnt: out.abgelehnt, funk };
}
const kurz = (x) => { try { const t = JSON.stringify(x); return t && t.length > 400 ? t.slice(0, 400) : (typeof x === 'string' ? x.slice(0, 400) : x); } catch (e) { return null; } };

// ---------- Rückfall: der Spielleiter fällt aus (benannte Funktion, kein Schalter)
function verwerfe(game) {
  const ws = game.weltsim;
  if (!ws) return 0;
  const s = zustandVon(game), n = s.vorgemerkt.length;
  const warn = s.vorgemerkt.filter((e) => e.w);
  s.vorgemerkt = [];
  Kern.BEFEHLE.regieRaeumen(ws.zustand);   // nur die Überlagerung der Regie, nie zustand.absichten (SUND-02b D)
  for (const e of warn) funkSenden(game, entwarnText(e.b));   // angekündigt und nie gekommen: Entwarnung
  return n;
}
function rueckfall(game, grund) {
  const n = verwerfe(game);
  schreibe(game, { art: 'lage_befehl', ausgang: 'rueckfall', begruendung: 'Standard-KI übernimmt allein' + (grund ? ': ' + String(grund).slice(0, 200) : ''), fehler: n ? [n + ' wartende Befehle verworfen'] : [] });
  return n;
}
// Entwarnung: ein angekündigter Befehl kommt nicht mehr (im Tick abgelehnt, verworfen, Tick gescheitert). Nur wenn vorher wirklich eine Vorwarnung ausging (Eintrag mit w).
function entwarnText(b) {
  const key = b.typ === 'embargo' ? 'embargo' : b.typ;
  const t = (texte().entwarnung || {})[key];
  if (!t) return null;
  const ort = b.typ === 'angreifen' ? b.ziel : b.typ === 'piratenueberfall' ? b.ort : null;
  return { von: t.sprecher || 'Oberkommando', text: fmt(t.text, { ziel: ort ? (Sektoren.hexName(ort) || ort) : '', waren: b.typ === 'embargo' ? b.waren.map((g) => (texte().waren || {})[g] || g).join(', ') : '' }) };
}
// Der Tick ist an den fälligen Befehlen gescheitert (Kriegslage.tickMit, im catch, NACH dem Zurückstellen der Sicherung): sie werden verworfen und nicht im nächsten Tick wiederholt, die Sim läuft ohne
// sie weiter (ein Befehl darf sie nie dauerhaft einfrieren). Logbuch und Entwarnung sofort (der Tick hat nichts committet).
function tickGescheitert(game, faellig, n) {
  const s = zustandVon(game);
  if (!s || !faellig || !faellig.length) return 0;
  const gleich = (x, y) => x.ab === y.ab && JSON.stringify(x.b) === JSON.stringify(y.b);
  s.vorgemerkt = s.vorgemerkt.filter((e) => !faellig.some((f) => gleich(e, f)));
  for (const e of faellig) {
    schreibe(game, { art: 'lage_befehl', ausgang: 'tick_gescheitert', key: e.b.typ, plan: e.b, fehler: ['Tick ' + n + ' ist gescheitert, der Befehl wird verworfen'], begruendung: 'die Sim läuft ohne ihn weiter' });
    if (e.w) funkSenden(game, entwarnText(e.b));
  }
  return faellig.length;
}

// Nach dem Laden: wartende angekündigte Befehle werden einmal erneut angekündigt (das Funkprotokoll der Sitzung ist weg, die Gefahr kommt aber): Aufrufer Kriegslage.nachLaden, einmal je Laden,
// nie im laufenden Betrieb (keine Doppelungen). Die Sprünge bis zur Wirkung zählen vom geladenen Stand. -> Zahl der Meldungen
function vorwarnungenErneut(game) {
  const ws = game.weltsim, s = ws && ws.regie;
  if (!s || !s.vorgemerkt.length) return 0;
  let n = 0;
  for (const e of s.vorgemerkt) {
    if (!e.w) continue;
    const w = trifftRom(ws.zustand, e.b);
    const f = w && vorwarnText(w, Math.max(e.ab, ws.tickZahl + 1), ws.tickZahl, e.b);
    if (f) { funkSenden(game, f); n++; }
  }
  return n;
}

// ---------- Tick (Aufrufer: Kriegslage.tickMit, im Atom)
// Fällige Befehle für Tick n; sie verlassen die Warteschlange sofort (wirft der Tick, stellt Kriegslage.tickMit die Sicherung zurück: dann sind sie wieder da).
function vorTick(game, n) {
  const s = zustandVon(game);
  const leer = [];
  leer.abgelehnt = [];
  if (!s || !s.vorgemerkt.length) return leer;
  const z = game.weltsim.zustand;
  const faellig = s.vorgemerkt.filter((e) => e.ab <= n).slice(0, BW.je_tick_max.wert);
  if (!faellig.length) return leer;
  s.vorgemerkt = s.vorgemerkt.filter((e) => !faellig.includes(e));
  // Besitz geändert: wurde das Ziel seit der Annahme römisch (Wirkung auf Rom) und es ging keine Vorwarnung hinaus, wirkt der Befehl nicht unangekündigt: abgelehnt
  const gut = faellig.filter((e) => e.w || !trifftRom(z, e.b));
  gut.abgelehnt = faellig.filter((e) => !gut.includes(e));
  return gut;
}
// res: Rückgabe von Kern.tick (befehle: { angewandt, abgelehnt }); faellig: die Einträge von vorTick. -> { funk: [{von, text}], log: [Eintrag] }
function nachTick(game, res, faellig, n) {
  const out = { funk: [], log: [] };
  for (const e of (faellig && faellig.abgelehnt) || []) out.log.push({ art: 'lage_befehl', ausgang: 'im_tick_abgelehnt', key: e.b.typ, plan: e.b, fehler: ['Ziel gehört inzwischen Rom, es ging keine Vorwarnung hinaus (Crew-Betroffenheit nie unangekündigt)'], begruendung: 'Tick ' + n });
  if (!faellig || !faellig.length) return out;
  const r = (res && res.befehle) || { angewandt: [], abgelehnt: [] };
  for (const e of faellig) {
    const abg = r.abgelehnt.find((x) => x.befehl === e.b || (x.befehl && JSON.stringify(x.befehl) === JSON.stringify(e.b)));
    if (abg) { out.log.push({ art: 'lage_befehl', ausgang: 'im_tick_abgelehnt', key: e.b.typ, plan: e.b, fehler: [abg.grund], begruendung: 'Tick ' + n + ': der Stand hat sich seit der Annahme geändert' }); if (e.w) out.funk.push(entwarnText(e.b)); continue; }
    out.log.push({ art: 'lage_befehl', ausgang: 'gespielt', key: e.b.typ, plan: e.b, begruendung: 'Tick ' + n });
    if (e.w && e.b.typ === 'embargo') {
      const t = (texte().wirksam || {}).embargo;
      if (t) out.funk.push({ von: t.sprecher || 'Oberkommando', text: fmt(t.text, { waren: e.b.waren.map((g) => (texte().waren || {})[g] || g).join(', ') }) });
    }
  }
  return out;
}
function melde(game, aus) {
  for (const f of aus.funk || []) funkSenden(game, f);
  for (const l of aus.log || []) schreibe(game, l);
}

// ---------- Funk und Logbuch
function funkSenden(game, f) {
  if (!f || !f.text) return;
  try { game.emit('radio', { from: f.von || 'Oberkommando', text: f.text, lage: 1, r: 1 }); } catch (e) { if (game.countError) game.countError('regie-funk', e); }
}
function logger(game) {
  const id = (game.weltstand && game.weltstand.id) || 'ohne-welt';
  if (!game.lageRegie || game.lageRegie.id !== id) {
    const env = game.env || process.env;
    try {
      game.lageRegie = { id, log: Regielog.create({ dir: Regielog.dir(env), weltId: id, memoryOnly: game.worldsEnabled === false && !(env && env.REGIE_DIR), onError: (e) => { if (game.countError) game.countError('regielog', e); } }) };
    } catch (e) { if (game.countError) game.countError('regielog', e); return null; }
  }
  return game.lageRegie.log;
}
function schreibe(game, eintrag) {
  try {
    const l = logger(game);
    if (l) l.write(Object.assign({ spielzeit: Number.isFinite(game.time) ? game.time : null, quelle: 'regie' }, eintrag));
  } catch (e) { if (game.countError) game.countError('regielog', e); }
}

// ---------- Weltstand welt.sim.regie
function toSave(ws) {
  const s = ws && ws.regie;
  if (!s || (!s.vorgemerkt.length && !Object.keys(s.letzte).length)) return null;
  const b = {};
  if (s.vorgemerkt.length) b.vorgemerkt = s.vorgemerkt.map((e) => (e.w ? { b: klon(e.b), ab: e.ab, w: 1 } : { b: klon(e.b), ab: e.ab }));
  if (Object.keys(s.letzte).length) b.letzte = Object.assign({}, s.letzte);
  return b;
}
// müll-fester Leser: Unbekanntes und Unsinniges fällt weg (Altstand und kaputter Block = leer); Zeiten werden auf die Gegenwart geklemmt
function lesen(b, tickZahl) {
  const out = neu();
  if (!istObjekt(b)) return out;
  const t = Number.isFinite(tickZahl) ? tickZahl : 0;
  if (Array.isArray(b.vorgemerkt)) {
    for (const e of b.vorgemerkt) {
      if (out.vorgemerkt.length >= R.plan.wert.vorgemerkt_max) break;
      if (!istObjekt(e) || !istObjekt(e.b) || typeof e.b.typ !== 'string' || !Object.prototype.hasOwnProperty.call(KATALOG, e.b.typ)) continue;
      const ab = ganz(e.ab, null);
      if (ab == null || ab < 0) continue;
      const eintrag = { b: klon(e.b), ab: Math.min(ab, t + 1 + Math.max(...Object.values(R.vorwarnung.wert.vorlauf), 1)) };
      if (e.w === 1) eintrag.w = 1;
      out.vorgemerkt.push(eintrag);
    }
  }
  if (istObjekt(b.letzte)) {
    for (const [k, v] of Object.entries(b.letzte)) {
      if (Object.keys(out.letzte).length >= R.plan.wert.letzte_max) break;   // die Menge der Schlüssel ist begrenzt (Typ × Fraktion): eine Datei kann den Block nicht aufblähen
      if (schluesselOk(k) && /^[a-z_]+(:[A-Za-z_]+)*$/.test(k) && Object.prototype.hasOwnProperty.call(KATALOG, k.split(':')[0]) && Number.isFinite(v) && v >= 0) out.letzte[k] = Math.min(Math.floor(v), t);
    }
  }
  return out;
}

module.exports = { R, schreibe, vorwarnungenErneut, tickGescheitert, neu, toSave, lesen, planAnwenden, planPruefen, rueckfall, verwerfe, vorTick, nachTick, melde, lage, trifftRom, abkuehlSchluessel, planLesen };
