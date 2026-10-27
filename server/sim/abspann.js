'use strict';
// SUND-04a-3: Abspaenne der Freien Fahrt Sund (game.weltsim). Action-Layer wie ruf.js und chronik.js. Nur Palatina faellt und der Sieg beenden das Szenario (kein Game Over mitten im Spiel);
// danach zeigt der Client den Abspann und fuehrt ueber Enter ins Hauptmenue (Weiterspielen gibt es in V1 nicht). Der Abspann nutzt den Mechanismus der Kampagne (game.endGame mit
// abspann: { titel, text, bloecke: [{ kopf, zeilen }], schluss? }), baut seine Bloecke aber aus Fakten der Welt (Freie Fahrt hat kein Regiebuch): Daten content/welt/abspann.json,
// Schema content/schema/abspann.schema.json. Alles hinter game.weltsim; ohne Ende (und ohne Marker im Weltstand) aendert sich nichts.
//
//   fakten(game) -> { haefenVerloren, postenVerloren, rang, rangName, kommandantenGefallen, faedenAusgang: { vorlage: gelungen|gescheitert|laufend }, chronikZahl, hauptweltGefallen: false|{fraktion,tick}, finaleGespielt }
//       rein lesend, muellfest; ohne Modus oder bei Altstaenden ohne Bloecke neutrale Vorgaben (alles 0, Rang miles, keine Faeden). haefenVerloren: Haefen Roms ohne die Hauptwelt, die nicht mehr Rom gehoeren.
//       postenVerloren: gefallene Posten der Crew laut Chronik (die Chronik gibt es nur mit den neuen Bloecken, sonst 0). finaleGespielt: Fakt finale_gespielt = true (setzt das Finale).
//       Mehrere Faeden einer Vorlage: ein gelungener Faden genuegt, sonst ein gescheiterter, sonst laufend.
//   bauen(fakten, art) -> { titel, text, bloecke, schluss? } | null      art: 'palatina' | 'sieg'; Bedingungen `wenn` filtern Bloecke und Zeilen, Bloecke ohne Zeile entfallen
//   beenden(game, art, quelle?) -> bool       setzt den Fakt szenario_ende (Marker im Weltstand), markiert „speichern auch ohne Dock“ und ruft game.endGame; idempotent; nur in der Freien Fahrt
//   nachLaden(game)                           Hook in Kriegslage.nachLaden: ist der Marker gesetzt, wird der Abspann erneut gezeigt statt weiterzuspielen; ohne Marker nichts
//   wennPruefen(w) -> [Fehler] / wennGilt(w, fakten) / pruefen(doc) -> [Fehler] / daten()      Sprache und Daten
//   debug(game, args)                         nur --debug: abspann palatina|sieg (zeigt nur, setzt keinen Marker)
// Sprache von `wenn` (alle Schluessel eines Objekts gelten zugleich): rang_min / rang_max (Rang-Id), haefenVerloren / postenVerloren / kommandantenGefallen / chronikZahl ({ min?, max? }),
// faedenAusgang ({ vorlage: gelungen | gescheitert | laufend }), finaleGespielt / hauptweltGefallen (wahr/falsch), nicht ({ wenn }), oder ([{ wenn }, ...]). Alles andere ist ein Datenfehler.
const fs = require('fs');
const path = require('path');
const Ruf = require('./ruf.js');
const Daten = require('../weltsim/daten.js');

const DATEI = path.join(__dirname, '..', '..', 'content', 'welt', 'abspann.json');
const SCHEMA = path.join(__dirname, '..', '..', 'content', 'schema', 'abspann.schema.json');
const ARTEN = ['palatina', 'sieg'];
const FAKT = 'szenario_ende';
const AUSGAENGE = ['gelungen', 'gescheitert', 'laufend'];
const ZAHLEN = ['haefenVerloren', 'postenVerloren', 'kommandantenGefallen', 'chronikZahl'];
const RAENGE = Ruf.RAENGE.map((r) => r.id);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const zahl = (x) => (Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);

// ---------- Sprache der Bedingung
const rangIndex = (id) => RAENGE.indexOf(id);
function vorlagenIds() {
  try { return require('./faden-daten.js').vorlagenIds(); } catch (e) { return null; }   // null: nicht prüfbar (Vorlagen nicht ladbar), dann zählt nur die Form
}
function wennPruefen(w, p, out) {
  p = p || 'wenn'; out = out || [];
  if (!istObjekt(w)) { out.push(`${p}: Objekt erwartet`); return out; }
  const keys = Object.keys(w);
  if (!keys.length) out.push(`${p}: leere Bedingung`);
  for (const k of keys) {
    const v = w[k], q = `${p}.${k}`;
    if (k === 'rang_min' || k === 'rang_max') { if (rangIndex(v) < 0) out.push(`${q}: unbekannter Rang ${JSON.stringify(v)}`); }
    else if (ZAHLEN.includes(k)) {
      if (!istObjekt(v) || !Object.keys(v).length) out.push(`${q}: { min?, max? } erwartet`);
      else for (const o of Object.keys(v)) { if (o !== 'min' && o !== 'max') out.push(`${q}.${o}: unbekannter Operator`); else if (!Number.isInteger(v[o]) || v[o] < 0) out.push(`${q}.${o}: ganze Zahl >= 0 erwartet`); }
      if (istObjekt(v) && Number.isInteger(v.min) && Number.isInteger(v.max) && v.min > v.max) out.push(`${q}: min groesser als max`);
    } else if (k === 'faedenAusgang') {
      if (!istObjekt(v) || !Object.keys(v).length) out.push(`${q}: { vorlage: ausgang } erwartet`);
      else {
        const ids = vorlagenIds();
        for (const [vl, a] of Object.entries(v)) {
          if (!AUSGAENGE.includes(a)) out.push(`${q}.${vl}: unbekannter Ausgang ${JSON.stringify(a)}`);
          if (ids && !ids.includes(vl)) out.push(`${q}.${vl}: unbekannte Fadenvorlage`);
        }
      }
    } else if (k === 'finaleGespielt' || k === 'hauptweltGefallen') { if (typeof v !== 'boolean') out.push(`${q}: wahr oder falsch erwartet`); }
    else if (k === 'nicht') wennPruefen(v, q, out);
    else if (k === 'oder') { if (!Array.isArray(v) || !v.length) out.push(`${q}: Liste von Bedingungen erwartet`); else v.forEach((x, i) => wennPruefen(x, `${q}[${i}]`, out)); }
    else out.push(`${q}: unbekannter Schluessel`);
  }
  return out;
}
// Auswertung: unbekannte Schlüssel werfen (nie still ignorieren); die Daten sind vorher geprüft
function wennGilt(w, f) {
  if (!istObjekt(w)) throw new Error('abspann: Bedingung ist kein Objekt');
  for (const k of Object.keys(w)) {
    const v = w[k];
    let ok;
    if (k === 'rang_min') ok = rangIndex(f.rang) >= rangIndex(v);
    else if (k === 'rang_max') ok = rangIndex(f.rang) <= rangIndex(v);
    else if (ZAHLEN.includes(k)) ok = (v.min === undefined || f[k] >= v.min) && (v.max === undefined || f[k] <= v.max);
    else if (k === 'faedenAusgang') ok = Object.keys(v).every((vl) => has(f.faedenAusgang, vl) && f.faedenAusgang[vl] === v[vl]);
    else if (k === 'finaleGespielt') ok = !!f.finaleGespielt === v;
    else if (k === 'hauptweltGefallen') ok = !!f.hauptweltGefallen === v;
    else if (k === 'nicht') ok = !wennGilt(v, f);
    else if (k === 'oder') ok = v.some((x) => wennGilt(x, f));
    else throw new Error(`abspann: unbekannter Schluessel ${k}`);
    if (!ok) return false;
  }
  return true;
}

// ---------- Daten
function pruefen(doc) {
  const out = [];
  let schema;
  try { schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8')); } catch (e) { return ['Schema nicht lesbar: ' + e.message]; }
  const V = require('../weltstand.js').fallbackValidate;
  if (!istObjekt(doc)) return ['Wurzel: Objekt erwartet'];
  for (const m of V(doc, schema)) out.push(m);
  if (out.length) return out;
  for (const art of ARTEN) {
    const a = doc.abspaenne[art];
    for (const m of V(a, schema.definitions.abspann, '$.abspaenne.' + art)) out.push(m);
    if (!istObjekt(a) || !Array.isArray(a.bloecke)) continue;
    const ids = new Set();
    a.bloecke.forEach((b, i) => {
      const p = `${art}.bloecke[${i}]`;
      if (!istObjekt(b)) return;
      if (ids.has(b.id)) out.push(`${p}: doppelte Id ${b.id}`);
      ids.add(b.id);
      if (b.wenn !== undefined) wennPruefen(b.wenn, `${p}.wenn`, out);
      (Array.isArray(b.zeilen) ? b.zeilen : []).forEach((z, j) => { if (istObjekt(z) && z.wenn !== undefined) wennPruefen(z.wenn, `${p}.zeilen[${j}].wenn`, out); });
    });
  }
  return out;
}
let cache = null;
function daten() {
  if (cache) return cache;
  const doc = JSON.parse(fs.readFileSync(DATEI, 'utf8'));
  const f = pruefen(doc);
  if (f.length) throw new Error('abspann.json ungueltig: ' + f.slice(0, 5).join('; '));
  return (cache = doc);
}

// ---------- Fakten
const karteCache = new WeakMap();   // Karte (Objekt des Sim-Zustands) -> Code der Hauptwelt Roms
function hauptweltRom(karte) {
  if (!karteCache.has(karte)) karteCache.set(karte, Daten.baue(karte).hauptwelten.rom);
  return karteCache.get(karte);
}
function haefenVerloren(ws) {
  const z = ws.zustand;
  const karte = z && z.karte && Array.isArray(z.karte.hexe) ? z.karte : JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'welt', 'sund-sim.json'), 'utf8'));
  const haupt = hauptweltRom(karte);
  let n = 0;
  for (const h of karte.hexe) if (h.hafenklasse && h.simFraktion === 'rom' && h.code !== haupt && z.hexe && z.hexe[h.code] && z.hexe[h.code].besitzer !== 'rom') n++;
  return n;
}
function faedenAusgang(ws) {
  const out = {}, rang = { gelungen: 3, gescheitert: 2, laufend: 1 };
  const liste = ws.faeden && Array.isArray(ws.faeden.liste) ? ws.faeden.liste : [];
  for (const f of liste) {
    if (!istObjekt(f) || typeof f.vorlage !== 'string') continue;
    const a = f.ausgang && AUSGAENGE.includes(f.ausgang.art) ? f.ausgang.art : 'laufend';
    if (!has(out, f.vorlage) || rang[a] > rang[out[f.vorlage]]) out[f.vorlage] = a;
  }
  return out;
}
function fakten(game) {
  const f = { haefenVerloren: 0, postenVerloren: 0, rang: RAENGE[0], rangName: Ruf.RAENGE[0].name, kommandantenGefallen: 0, faedenAusgang: {}, chronikZahl: 0, hauptweltGefallen: false, finaleGespielt: false };
  const ws = game && game.weltsim;
  if (!ws) return f;
  const sicher = (fn) => { try { fn(); } catch (e) { /* müllfest: Standardwert bleibt */ } };
  sicher(() => { f.haefenVerloren = haefenVerloren(ws); });
  sicher(() => { const c = Array.isArray(ws.chronik) ? ws.chronik : []; f.chronikZahl = c.length; f.postenVerloren = c.filter((e) => e && e.art === 'posten' && typeof e.kurz === 'string' && e.kurz.startsWith('Posten gefallen')).length; });
  sicher(() => { const i = Ruf.rangInfo(game); if (i) { f.rang = i.id; f.rangName = i.name; } });
  sicher(() => { f.kommandantenGefallen = Object.values(ws.kommandanten || {}).filter((k) => k && k.schicksal === 'gefallen').length; });
  sicher(() => { f.faedenAusgang = faedenAusgang(ws); });
  sicher(() => { const h = ws.hauptweltGefallen; if (h && typeof h === 'object') f.hauptweltGefallen = { fraktion: String(h.fraktion || 'rom'), tick: zahl(h.tick) }; });
  sicher(() => { const fk = game.weltstand && game.weltstand.data && game.weltstand.data.fakten; f.finaleGespielt = !!fk && fk.finale_gespielt === true; });
  return f;
}

// ---------- Abspann bauen
function bauen(fk, art) {
  if (!ARTEN.includes(art)) return null;
  const f = Object.assign({ haefenVerloren: 0, postenVerloren: 0, rang: RAENGE[0], kommandantenGefallen: 0, faedenAusgang: {}, chronikZahl: 0, hauptweltGefallen: false, finaleGespielt: false }, istObjekt(fk) ? fk : {});
  if (!istObjekt(f.faedenAusgang)) f.faedenAusgang = {};
  if (rangIndex(f.rang) < 0) f.rang = RAENGE[0];
  for (const k of ZAHLEN) f[k] = zahl(f[k]);
  const a = daten().abspaenne[art];
  const gilt = (x) => x.wenn === undefined || wennGilt(x.wenn, f);
  const bloecke = [];
  for (const b of a.bloecke) {
    if (!gilt(b)) continue;
    const zeilen = b.zeilen.filter((z) => typeof z === 'string' || gilt(z)).map((z) => (typeof z === 'string' ? z : z.text));
    if (zeilen.length) bloecke.push({ kopf: b.kopf, zeilen });
  }
  const out = { titel: a.titel, text: a.text, bloecke };
  if (a.schluss) out.schluss = a.schluss;
  return out;
}

// ---------- Ende, Marker, Laden
const markerVon = (game) => { const fk = game.weltstand && game.weltstand.data && game.weltstand.data.fakten; return fk && ARTEN.includes(fk[FAKT]) ? fk[FAKT] : null; };
const szenario = () => String(daten().szenario || '');   // Untertitel unter dem Titel des Abspanns (K7: aus den Daten, content/welt/abspann.json szenario; der Titel selbst steht auch dort)
const zeigen = (game, a) => game.endGame({ title: szenario(), text: a.text, abspann: Object.assign({ titel: a.titel, text: a.text, bloecke: a.bloecke }, a.schluss ? { schluss: a.schluss } : {}) });

function beenden(game, art, quelle) {
  if (!game || !game.weltsim || !ARTEN.includes(art)) return false;
  if (game.phase === 'end' || markerVon(game)) return false;   // idempotent: das Szenario endet genau einmal
  let a;
  try { a = bauen(fakten(game), art); } catch (e) { if (game.countError) game.countError('abspann-bauen', e); return false; }
  if (game.weltstand && typeof game.weltstand.fact === 'function') game.weltstand.fact(FAKT, art, quelle || 'kriegslage');   // Marker im Weltstand: welt.fakten ist eine offene Map, kein Schemafeld
  game.markSaveDue('missionDone');   // speichern am Tick-Ende AUCH ohne Dock (endGame speichert nur angedockt)
  game.log(`Szenario beendet: ${a.titel} (${art}).`);
  zeigen(game, a);
  return true;
}
function nachLaden(game) {
  if (!game || !game.weltsim) return;
  const art = markerVon(game);
  if (!art || game.phase === 'end') return;
  let a;
  try { a = bauen(fakten(game), art); } catch (e) { if (game.countError) game.countError('abspann-bauen', e); return; }
  zeigen(game, a);
}

// Debug (nur --debug): abspann palatina|sieg zeigt den Abspann mit dem jetzigen Stand der Welt (die Ereignisse sind sehr selten), OHNE Marker und ohne Speichern: die Welt bleibt spielbar. -> Fehlertext | null
function debug(game, args) {
  if (!game.weltsim) return 'Nur in der Freien Fahrt Sund.';
  const art = String((args && args[0]) || '').toLowerCase();
  if (!ARTEN.includes(art)) return 'abspann palatina|sieg';
  if (game.phase === 'end') return 'Das Szenario ist schon beendet.';
  zeigen(game, bauen(fakten(game), art));
  return null;
}

module.exports = { ARTEN, FAKT, fakten, bauen, beenden, nachLaden, wennPruefen, wennGilt, pruefen, daten, debug };
