'use strict';
// SUND-02b D: Strategische Optionen. Ab dem Rang Tribun bietet das Spiel der Crew 2 bis 3 regelbasierte Absichten für Rom an; eine gewählte Absicht steht für ihre Dauer in
// zustand.absichten.rom (p_act, aggr, max_active: kern.js ki(), der vorhandene Erweiterungspunkt, SUND-03 nutzt denselben Weg) und ändert das Verhalten der Standard-KI messbar.
// Action-Layer wie ruf.js und posten.js, nur im Modus Freie Fahrt Sund (game.weltsim). Der Kern bleibt unberührt (bitgleich zum Prototyp).
// Ruf ist ein Kann, nie ein Muss: Ignorieren und Ablehnen kosten nichts (kein Ruf, keine Sperre jenseits der Pause), ohne Wahl läuft die Standard-KI, nichts blockiert. Die Crew ist
// Offizier, nicht Feldherr: es gibt NUR die vorgeschlagenen Optionen, nie eine freie Strategiekarte. Alle Zahlen, Namen und Beschreibungen stehen in content/welt/absichten.json,
// Funktexte und Weigerungen in content/flotte/absichten.json.
// Zustand: game.weltsim.absicht = { laufend: { id, start, bis, vorher } | null (vorher = Werte unserer Felder in zustand.absichten.rom vor der Absicht, Schichtung), angebot: { ids: [id], t, bis } | null, frei_ab: Tick, ab dem wieder ein Angebot kommen darf }; Zeit = ws.tickZahl (Sprünge).
// Er gilt für die ganze Crew, nur der Server schreibt, er gehört NICHT zum Sim-Zustand (der trägt nur zustand.absichten.rom, das die Sim liest).
//
//   neu()                         leerer Zustand
//   angebotIds(z)                 die Angebotsliste aus dem Sim-Zustand: 2 bis 3 Ids, deterministisch (gleicher Zustand = gleiche Liste), ohne Zufall und ohne LLM
//   nachTick(game, n)             nach dem Kern-Tick (n = Nummer des Ticks, im Atom von Kriegslage.tickMit): laufende Absicht auslaufen lassen, Angebot verfallen lassen, neues Angebot
//                                 machen (Mindestrang, Pause) -> { funk: [Text] } (Funk erst nach dem Commit: melde)
//   waehlen(game, id)             Befehl absicht.waehlen: -> null | { code, text }. Die erste Wahl gilt, jede weitere bekommt „schon gewählt“
//   ablehnen(game)                Befehl absicht.ablehnen: Angebot schließen (ohne Folgen) -> null | { code, text }
//   melde(game, funk) / meldeGewaehlt   Funk (Lagefunk-Pfad, wichtig)
//   nachLaden(game)               nach restore: zustand.absichten.rom aus der laufenden Absicht setzen
//   snapshot(game) / schluessel(game)   Anzeigeblock world.absicht (nur im Modus) und sein Änderungsschlüssel
//   toSave(ws) / lesen(block, tickZahl) / neu()   Weltstand welt.sim.absicht (optional, Altstand = leer, müllfester Leser)
//   debug(game, args)             nur --debug: absicht [status | angebot | wahl <id> | ende | reset]
const fs = require('fs');
const path = require('path');
const Ruf = require('./ruf.js');
const Chronik = require('./chronik.js');   // SUND-03 D: Wahl und Ablehnung stehen in der Chronik

const W = require('../../content/welt/absichten.json').werte;
const TEXTE_FILE = path.join(__dirname, '..', '..', 'content', 'flotte', 'absichten.json');
const KATALOG = W.absichten.wert;
const FELDER = ['p_act', 'aggr', 'max_active'];   // die Felder, die kern.js ki() aus zustand.absichten[fraktion] liest
const FRAKTION = 'rom';

let texteCache = null;
function texte() {
  if (texteCache) return texteCache;
  try { texteCache = JSON.parse(fs.readFileSync(TEXTE_FILE, 'utf8')); } catch (e) { texteCache = {}; }
  return texteCache;
}
const fmt = (s, o) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? String(o[k]) : m));
const klon = (v) => JSON.parse(JSON.stringify(v));
const eintrag = (id) => KATALOG.find((a) => a.id === id) || null;
const fehl = (code, o) => ({ code, text: fmt((texte().weigerung || {})[code] || code, o) });

const neu = () => ({ laufend: null, angebot: null, frei_ab: 0 });
const zustandVon = (game) => { const ws = game.weltsim; if (!ws) return null; if (!ws.absicht) ws.absicht = neu(); return ws.absicht; };
const rangOk = (game) => Ruf.rufErreicht(game, W.mindestrang.wert);

// ---------- Angebot (regelbasiert, deterministisch)
// Tatsachen aus dem Sim-Zustand: laufende Belagerungen römischer Orte, Gesamtstärken. (Designschuld, README: das ist die Wahrheit der Sim, nicht das Wissen von Rom, kriegslage-wissen.js.)
function fakten(z) {
  const staerke = (f) => z.flotten.filter((fl) => fl.fraktion === f).reduce((s, fl) => s + fl.staerke, 0);
  return {
    belagert: z.angriffe.filter((r) => r.t_ende === null && r.t_an !== null && z.hexe[r.ziel] && z.hexe[r.ziel].besitzer === 'rom').length,
    rom: staerke('rom'), ger: staerke('ger'),
  };
}
function bedingung(b, f) {
  switch (b && b.art) {
    case 'immer': return true;
    case 'belagert': return f.belagert >= (b.min || 1);
    case 'staerker': return f.rom >= b.faktor * f.ger;
    default: return false;
  }
}
const vor = (a, b) => (a.prio - b.prio) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Zuerst die Absichten, deren Bedingung zutrifft (art ungleich immer), dann die ohne Bedingung, je nach prio; höchstens anzahl.max. Fehlt es an min (Daten falsch), füllen die übrigen auf.
function angebotIds(z) {
  const f = fakten(z), n = W.anzahl.wert;
  const trifft = KATALOG.filter((a) => a.bedingung.art !== 'immer' && bedingung(a.bedingung, f)).sort(vor);
  const immer = KATALOG.filter((a) => a.bedingung.art === 'immer').sort(vor);
  let liste = trifft.concat(immer).slice(0, n.max);
  if (liste.length < n.min) liste = liste.concat(KATALOG.filter((a) => !liste.includes(a)).sort(vor)).slice(0, n.min);
  return liste.map((a) => a.id);
}

// ---------- Wirkung in der Sim: zustand.absichten.rom (der Kern liest es in ki())
// Schichtung: zustand.absichten.rom kann schon einen Eintrag von anderer Hand haben (SUND-03). Wir überlagern NUR unsere Felder und merken uns die vorherigen Werte dieser Felder (laufend.vorher);
// beim Ablauf stellt wirkungRaeumen sie wieder her. Fremde Felder und Änderungen anderer an Feldern, die wir nicht gesetzt haben, bleiben unberührt.
const romEintrag = (z) => (z.absichten && typeof z.absichten === 'object' && z.absichten[FRAKTION] && typeof z.absichten[FRAKTION] === 'object' ? z.absichten[FRAKTION] : null);
function vorherMerken(z) {
  const rom = romEintrag(z), v = {};
  if (rom) for (const k of FELDER) if (Number.isFinite(rom[k])) v[k] = rom[k];
  return v;
}
function wirkungUeberlagern(z, a) {
  if (!z.absichten || typeof z.absichten !== 'object') z.absichten = {};
  const rom = Object.assign({}, romEintrag(z) || {});
  for (const k of FELDER) if (Number.isFinite(a.wirkung[k])) rom[k] = a.wirkung[k];
  z.absichten[FRAKTION] = rom;
}
// laufend: die Absicht, die endet (id, vorher). Ohne laufend (Rest einer verlorenen Absicht nach dem Laden): der ganze Eintrag geht.
function wirkungRaeumen(z, laufend) {
  const rom = romEintrag(z);
  if (!rom) return;
  const a = laufend && eintrag(laufend.id);
  if (!a) { delete z.absichten[FRAKTION]; return; }
  for (const k of FELDER) {
    if (rom[k] !== a.wirkung[k]) continue;   // von anderer Hand geändert: bleibt
    if (laufend.vorher && Number.isFinite(laufend.vorher[k])) rom[k] = laufend.vorher[k]; else delete rom[k];
  }
  if (!Object.keys(rom).length) delete z.absichten[FRAKTION];
}

// ---------- Takt: nach jedem Kern-Tick (im Atom von tickMit; wirft etwas, geht alles auf die Sicherung zurück)
function nachTick(game, n) {
  const s = zustandVon(game), z = game.weltsim.zustand, funk = [];
  if (s.laufend && n >= s.laufend.bis) {
    const a = eintrag(s.laufend.id);
    wirkungRaeumen(z, s.laufend);
    if (a) funk.push(fmt(texte().funk.ausgelaufen, { name: a.name }));
    s.laufend = null; s.frei_ab = n + W.abstand_nach_ablauf.wert;
  }
  if (s.angebot && (n >= s.angebot.bis || !rangOk(game))) {   // verfallen ohne Folgen; fällt der Rang, zieht Rom das Angebot zurück (ohne Pause)
    if (n >= s.angebot.bis) s.frei_ab = n + W.abstand_nach_verfall.wert;
    s.angebot = null;
  }
  if (!s.laufend && !s.angebot && n >= s.frei_ab && rangOk(game)) {
    s.angebot = { ids: angebotIds(z), t: n, bis: n + W.angebot_dauer.wert };
    funk.push(texte().funk.angebot);
  }
  return { funk };
}

// ---------- Befehle
function waehlen(game, id) {
  const ws = game.weltsim;
  if (!ws) return fehl('modus');
  const s = zustandVon(game);
  if (s.laufend) { const a = eintrag(s.laufend.id); return fehl('schon_gewaehlt', { name: a ? a.name : '', ticks: Math.max(0, s.laufend.bis - ws.tickZahl) }); }
  if (!rangOk(game)) return fehl('rang', { rang: Ruf.rangName(W.mindestrang.wert) });
  const a = eintrag(id);
  if (!a) return fehl('unbekannt');
  if (!s.angebot) return fehl('kein_angebot');
  if (!s.angebot.ids.includes(a.id)) return fehl('nicht_im_angebot');
  s.laufend = { id: a.id, start: ws.tickZahl, bis: ws.tickZahl + a.dauer, vorher: vorherMerken(ws.zustand) };
  s.angebot = null;
  wirkungUeberlagern(ws.zustand, a);
  Chronik.eintragen(game, { art: 'absicht', ref: a.id, kurz: `Absicht gewählt: ${a.name}`, param: { wahl: 'ja' } });   // SUND-03 D
  return null;
}
function ablehnen(game) {
  const ws = game.weltsim;
  if (!ws) return fehl('modus');
  const s = zustandVon(game);
  if (!s.angebot) return fehl('kein_angebot');
  const ids = s.angebot.ids.join(',');
  s.angebot = null; s.frei_ab = ws.tickZahl + W.abstand_nach_verfall.wert;   // Ablehnen ändert den Ruf nie
  Chronik.eintragen(game, { art: 'absicht', ref: ids, kurz: 'Angebot der Strategischen Optionen abgelehnt', param: { wahl: 'nein' } });   // SUND-03 D
  return null;
}

// ---------- Funk
function funkSenden(game, text) {
  if (!text) return;
  game.emit('radio', { from: texte().sprecher || 'Oberkommando', text, lage: 1, r: 1 });
}
function melde(game, funk) { for (const t of funk || []) funkSenden(game, t); }
function meldeGewaehlt(game) {
  const s = zustandVon(game); const a = s && s.laufend && eintrag(s.laufend.id);
  if (a) funkSenden(game, fmt(texte().funk.gewaehlt, { name: a.name, ticks: a.dauer }));
}

// Nach dem Laden: die laufende Absicht steht wieder in zustand.absichten.rom. Hat der gespeicherte Sim-Zustand dort noch eine Wirkung unserer Absichten, aber der Absicht-Block kennt keine
// laufende (Block fehlt oder ist kaputt), wäre sie für immer festgeklemmt: dann wird sie geräumt. Fremde Einträge (SUND-03) bleiben unberührt.
const istUnsere = (w) => !!w && KATALOG.some((a) => FELDER.every((k) => w[k] === a.wirkung[k]) && Object.keys(w).length === FELDER.length);
function nachLaden(game) {
  const s = zustandVon(game), z = game.weltsim.zustand; const a = s && s.laufend && eintrag(s.laufend.id);
  if (a) wirkungUeberlagern(z, a);
  else if (z.absichten && istUnsere(z.absichten[FRAKTION])) wirkungRaeumen(z, null);
}

// ---------- Anzeige (nur Daten)
// world.absicht = { frei: 0|1, ab: Name des Mindestrangs, angebot?: [{ id, name, text, dauer }], rest?: Sprünge bis das Angebot verfällt, laufend?: { id, name, text, rest, dauer } }
function snapshot(game) {
  const ws = game.weltsim;
  if (!ws) return null;
  const s = zustandVon(game);
  const b = { frei: rangOk(game) ? 1 : 0, ab: Ruf.rangName(W.mindestrang.wert) };
  if (s.angebot) {
    b.angebot = s.angebot.ids.map(eintrag).filter(Boolean).map((a) => ({ id: a.id, name: a.name, text: a.text, dauer: a.dauer }));
    b.rest = Math.max(0, s.angebot.bis - ws.tickZahl);
  }
  if (s.laufend) { const a = eintrag(s.laufend.id); if (a) b.laufend = { id: a.id, name: a.name, text: a.text, rest: Math.max(0, s.laufend.bis - ws.tickZahl), dauer: a.dauer }; }
  return b;
}
function schluessel(game) {
  const ws = game.weltsim;
  if (!ws) return null;
  const s = zustandVon(game);
  return [rangOk(game) ? 1 : 0, s.angebot ? s.angebot.ids.join(',') + ':' + (s.angebot.bis - ws.tickZahl) : '-', s.laufend ? s.laufend.id + ':' + (s.laufend.bis - ws.tickZahl) : '-'].join('|');
}

// ---------- Weltstand welt.sim.absicht
function toSave(ws) {
  const s = ws && ws.absicht;
  if (!s || (!s.laufend && !s.angebot && !(s.frei_ab > 0))) return null;
  const b = {};
  if (s.laufend) { b.laufend = { id: s.laufend.id, start: s.laufend.start, bis: s.laufend.bis }; if (s.laufend.vorher && Object.keys(s.laufend.vorher).length) b.laufend.vorher = Object.assign({}, s.laufend.vorher); }
  if (s.angebot) b.angebot = { ids: s.angebot.ids.slice(), t: s.angebot.t, bis: s.angebot.bis };
  if (s.frei_ab > 0) b.frei_ab = s.frei_ab;
  return b;
}
// müll-fester Leser: Unbekanntes, Abgelaufenes und Unsinniges fällt weg (Altstand und kaputter Block = leer); Zeiten geklemmt auf die Daten
function lesen(b, tickZahl) {
  const out = neu();
  if (!b || typeof b !== 'object' || Array.isArray(b)) return out;
  const t = Number.isFinite(tickZahl) ? tickZahl : 0;
  const zahl = (v, d) => (Number.isFinite(v) ? Math.floor(v) : d);
  if (b.laufend && typeof b.laufend === 'object') {
    const a = eintrag(b.laufend.id), bis = zahl(b.laufend.bis, null);
    if (a && bis != null && bis > t) {
      out.laufend = { id: a.id, start: Math.min(zahl(b.laufend.start, t), t), bis: Math.min(bis, t + a.dauer), vorher: {} };
      const vv = b.laufend.vorher;
      if (vv && typeof vv === 'object' && !Array.isArray(vv)) for (const k of FELDER) if (Number.isFinite(vv[k])) out.laufend.vorher[k] = vv[k];
    }
  }
  if (!out.laufend && b.angebot && typeof b.angebot === 'object' && Array.isArray(b.angebot.ids)) {
    const ids = b.angebot.ids.filter((id, i, l) => typeof id === 'string' && eintrag(id) && l.indexOf(id) === i).slice(0, W.anzahl.wert.max);
    const bis = zahl(b.angebot.bis, null);
    if (ids.length >= W.anzahl.wert.min && bis != null && bis > t) out.angebot = { ids, t: Math.min(zahl(b.angebot.t, t), t), bis: Math.min(bis, t + W.angebot_dauer.wert) };
  }
  const fa = zahl(b.frei_ab, 0);
  out.frei_ab = fa > 0 ? Math.min(fa, t + Math.max(W.abstand_nach_verfall.wert, W.abstand_nach_ablauf.wert)) : 0;
  return out;
}

// ---------- Debug: absicht [status | angebot | wahl <id> | ende | reset]
function debug(game, args) {
  const ws = game.weltsim;
  if (!ws) return 'Nur im Modus Freie Fahrt Sund.';
  const s = zustandVon(game);
  const a = (Array.isArray(args) ? args : []).map(String);
  const cmd = a[0] || 'status';
  if (cmd === 'status') {
    game.oda('Absicht: ' + (s.laufend ? s.laufend.id + ' bis ' + s.laufend.bis : 'keine') + ' · Angebot ' + (s.angebot ? s.angebot.ids.join('/') + ' bis ' + s.angebot.bis : 'keins') + ' · frei ab ' + s.frei_ab + ' · Tick ' + ws.tickZahl, null);
    return null;
  }
  if (cmd === 'angebot') {   // erzwingt ein Angebot jetzt (ohne Rang- und Pausenprüfung), nur zum Testen
    if (s.laufend) return 'Es läuft schon eine Absicht (absicht ende).';
    s.angebot = { ids: angebotIds(ws.zustand), t: ws.tickZahl, bis: ws.tickZahl + W.angebot_dauer.wert };
    funkSenden(game, texte().funk.angebot);
    return null;
  }
  if (cmd === 'wahl') { const e = waehlen(game, a[1]); if (e) return e.text; meldeGewaehlt(game); return null; }
  if (cmd === 'ende') { if (s.laufend) { wirkungRaeumen(ws.zustand, s.laufend); s.laufend = null; s.frei_ab = ws.tickZahl + W.abstand_nach_ablauf.wert; } return null; }
  if (cmd === 'reset') { wirkungRaeumen(ws.zustand, ws.absicht && ws.absicht.laufend); ws.absicht = neu(); return null; }
  return 'absicht [status | angebot | wahl <id> | ende | reset]';
}

module.exports = { KATALOG, neu, angebotIds, fakten, nachTick, waehlen, ablehnen, melde, meldeGewaehlt, nachLaden, snapshot, schluessel, toSave, lesen, debug };
