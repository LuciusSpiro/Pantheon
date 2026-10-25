'use strict';
// SUND-04a-1 B: Geschichtsfaeden der Freien Fahrt Sund (game.weltsim). Action-Layer wie ruf.js, chronik.js und reise-ereignis.js. Aus der taeglichen Arbeit entstehen Geschichten (Kai, 2026-10-18): eine Taetigkeit
// mit PERSON am Ausgang (heute: ein bewaeltigter Notruf) darf einen Faden anbieten; der Lage-Spielleiter (Claude) WAEHLT, ob und welche Vorlage (Befehl faden_oeffnen) und wann der naechste Beat
// kommt (faden_weiter), er erfindet keine Mechanik. NSC, Hinweise und Folgen kommen aus DATEN (content/faeden/), die Beats bedienen benannte Bausteine (faden-bausteine.js, in 04a-1 Platzhalter).
// Der Kern bleibt allgemein: keine Vorlage steht im Code, ein neuer Beat ist ein Katalogeintrag (beats.json), eine neue Vorlage eine Datei; EIN Pruefer (faden-pruefer.js) prueft alles.
//
// Schalter: FAEDEN=1 (eigener Schalter, nicht der des Lage-Spielleiters: der Weltstand-Block welt.sim.faeden soll nicht ungefragt in jeden Stand mit Spielleiter kommen, die Faeden ohne LLM zaehlen und
// testbar sein, und 04a-1 liefert noch keine Vorlage; ohne Schalter tut kein Hook etwas, Sim-Zustand und Weltstand sind byte-gleich zu main). Faeden OEFFNEN und WEITERBRINGEN kann nur der Spielleiter:
// ohne ihn (Schalter aus, Ausfall) bleiben begonnene Faeden stehen (der Zaehler laeuft weiter, kein Beat startet, kein Fehler, die Welt laeuft weiter).
//
// Zustand game.weltsim.faeden = { t, nr, nsc, liste: [Faden], angebote, ... }  (nur t, nr, nsc und liste stehen im Weltstand welt.sim.faeden, optional, additiv, Version 3, Altstaende = leer)
//   t        Taetigkeitszaehler (eigener Zaehler, NIE die Chronik: sie ist ein Ring von 200 und die Funk-Antworten schreiben hinein)     nr / nsc   laufende Nummern von Faeden (f<nr>) und NSC (n<nr>)
//   Faden    { id, vorlage, parameter: { volk, ort, name }, beat (Index: der laufende bzw. naechste), phase: wartet | laeuft | abgeschlossen, zaehler (Taetigkeiten seit dem letzten Beat), abstand (Ziel 2 bis 4),
//              laufend: { beat, n, seit, gewaehlt? } | null, hinweise: [Kennungen gestreut], ausgang: { art, status, tick } | null, begonnen: Tick, nsc }
//   NSC      { id, name, fraktion, schiff, schiffsklasse, status, haltung, gedaechtnis: [{ tick, ereignis, text_key }] (hoechstens 12), wahrheit: { id, fraktion?, offenbart } | null, portrait: Seed }
//   angebote (nur Laufzeit) { nr, art, ref, hex, volk, vorlagen: [Id], alter }: Taetigkeiten mit Person, aus denen der Spielleiter einen Faden oeffnen darf
//
//   aktiv(game)                          Schalter und Modus
//   taetigkeit(game, art) -> { t, faellig: [Id] } | null    EINE Taetigkeit zaehlen (Aufrufer: game.lageGrenze fuer szene_ende, andocken, absicht; ausgangMitPerson fuer notruf): Zaehler t, Zaehler je Faden, Fristen
//   ausgangMitPerson(game, { art: 'notruf', id, hex, sprecher, ausgang }) -> Angebot | null   (Hook in reise-ereignis.js, nur wenn aktiv) macht ein Angebot, wenn Platz ist und eine Vorlage passt
//   befehlPruefen(game, b, ctx) -> null | Grund / befehlAnwenden(game, b) -> { ok, grund?, faden? }   faden_oeffnen { vorlage, parameter? } und faden_weiter { faden, beat } (Aufrufer: regie-befehle.js)
//   oeffnen / weiterSetzen / beatAusgang(game, fadenId, 'gelungen'|'gescheitert') / optionWaehlen(game, fadenId, optionId)   die Schritte; Ausgang und Optionen melden die Bausteine
//   haltungPruefen / haltungBuchen / anwenden   Wirkung haltung_aenderung (Aufsatz-Wirkung, Katalog server/weltsim/wirkungen.js); haltungVon(npc), chanceSpontanhilfe(npc), tonVon(npc), kehrtFeindlichWieder(npc)
//   ausschnittBlock(game) / promptText()   kleiner Faden-Block fuer den Lage-Spielleiter (hoechstens 3 Faeden, nie Spielernamen, die verborgene Wahrheit nur als Kennung)
//   neu() / toSave(ws) / lesen(block)     Weltstand welt.sim.faeden
const D = require('./faden-daten.js');
const P = require('./faden-pruefer.js');
const Bausteine = require('./faden-bausteine.js');

const W = D.WERTE, B = D.BEATS, N = D.NAMEN, H = D.HALTUNG;
const regie = () => require('./regie-befehle.js');   // lazy: regie-befehle.js, kriegslage.js und reise-ereignis.js laden dieses Modul
const kl = () => require('./kriegslage.js');
const re = () => require('./reise-ereignis.js');
const Wirkungen = require('../weltsim/wirkungen.js');

const klon = (v) => JSON.parse(JSON.stringify(v));
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const r2 = (x) => Math.round(x * 100) / 100;
const nat = (x, max) => (Number.isFinite(x) && x >= 0 ? Math.min(Math.floor(x), max) : 0);
const ZAEHLER_MAX = 9999;
const HEX = /^\d{4}$/;
const aktive = P.aktive;

// ---------- Schalter und Zustand
function aktiv(game) {
  const ws = game && game.weltsim;
  if (!ws || !ws.zustand) return false;
  const env = game.env || process.env;
  const v = String((env && env.FAEDEN) || '').toLowerCase();
  return v === '1' || v === 'on';
}
const neu = () => ({ t: 0, nr: 0, nsc: 0, liste: [], angebote: [], angNr: 0, ladeFehler: [], gemeldet: false });
function zustandVon(game) {
  const ws = game && game.weltsim;
  if (!ws) return null;
  if (!ws.faeden) ws.faeden = neu();
  const F = ws.faeden;
  if (!F.gemeldet) {   // Fehler beim Laden der Vorlagen und des Weltstands: einmal je Partie ins Regie-Logbuch (Ungueltiges wird nie gespielt, aber nie still)
    F.gemeldet = true;
    for (const f of D.ladefehler()) logbuch(game, 'faden_pruefung', { ausgang: 'abgelehnt', key: f.datei, fehler: f.fehler, begruendung: 'Vorlage ' + f.datei + ' wird nie gespielt' });
    for (const f of F.ladeFehler || []) logbuch(game, 'faden_pruefung', { ausgang: 'abgelehnt', key: 'weltstand', fehler: [f], begruendung: 'Faden aus dem Weltstand verworfen' });
  }
  return F;
}
function logbuch(game, art, e) { try { regie().schreibe(game, Object.assign({ art }, e)); } catch (err) { if (game && game.countError) game.countError('faden-logbuch', err); } }
const melde = (game, ausgang, key, text, plan) => logbuch(game, 'faden_ereignis', { ausgang, key, begruendung: text, plan });
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };

// ---------- Zufall: eigener, zaehlerbasierter Strom (kein game.rng, nicht der Strom der Sim)
function strom(game, n, salz) {
  const seed = ((Number(game.weltsim.zustand.seed) | 0) ^ 0x46414445) >>> 0;   // „FADE“
  return re().strom(seed, n, salz);
}
const idNr = (id) => Number(String(id).replace(/\D/g, '')) || 0;
function abstandZiehen(game, f) {
  const v = D.vorlage(f.vorlage);
  const a = (v && v.abstand) || W.abstand;
  const lo = Math.max(a.min, W.abstand.min), hi = Math.min(a.max, W.abstand.max);
  const F = game.weltsim.faeden;
  const r = strom(game, idNr(f.id), 'abstand:' + f.beat + ':' + F.t)();
  return lo + Math.min(hi - lo, Math.floor(r * (hi - lo + 1)));
}

// ---------- NSC aus Datenlisten (nie vom Modell)
function nscErzeugen(game, v, volk, name, nscNr) {
  const L = N[volk];
  if (!L) return null;
  const F = game.weltsim.faeden;
  const rng = strom(game, nscNr, 'nsc');
  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const vergeben = new Set(F.liste.map((f) => f.nsc.name));
  let n = name;
  if (!n) {
    for (let i = 0; i < 40 && !n; i++) { const t = pick(L.vornamen) + ' ' + pick(L.nachnamen); if (!vergeben.has(t)) n = t; }
    for (const vor of L.vornamen) for (const nach of L.nachnamen) if (!n && !vergeben.has(vor + ' ' + nach)) n = vor + ' ' + nach;   // Rest: der erste freie Name (deterministisch)
  }
  if (!n || vergeben.has(n)) return null;
  const klassen = ((v.nsc && v.nsc.klassen) || L.klassen).filter((k) => L.klassen.includes(k));
  const nsc = {
    id: 'n' + nscNr, name: n, fraktion: volk, schiff: pick(L.schiffe), schiffsklasse: pick(klassen.length ? klassen : L.klassen),
    status: (v.nsc && v.nsc.status) || 'aktiv', haltung: klemmen((v.nsc && v.nsc.haltung) || 0), gedaechtnis: [], wahrheit: null, portrait: Math.floor(rng() * 2147483647),
  };
  if (v.wahrheit) { nsc.wahrheit = { id: v.wahrheit.id, offenbart: false }; if (v.wahrheit.fraktion) nsc.wahrheit.fraktion = v.wahrheit.fraktion; }
  return nsc;
}
const portraetVon = (npc) => (npc && Number.isFinite(npc.portrait) ? npc.portrait % W.portrait.varianten : 0);   // V1: eine von wenigen Varianten, der Baukasten folgt
function gedaechtnisEintragen(nsc, tick, ereignis, textKey) {
  nsc.gedaechtnis.push({ tick, ereignis, text_key: textKey });
  while (nsc.gedaechtnis.length > W.gedaechtnis_max) nsc.gedaechtnis.shift();
}

// ---------- Haltung
const klemmen = (x) => r2(Math.min(H.grenzen.max, Math.max(H.grenzen.min, Number.isFinite(x) ? x : 0)));
const haltungVon = (npc) => (npc && Number.isFinite(npc.haltung) ? klemmen(npc.haltung) : 0);
function chanceSpontanhilfe(npc) {   // Kurve aus den Daten (haltung-werte.json kurve_spontanhilfe): linear zwischen den Stuetzpunkten, ausserhalb geklemmt
  const h = haltungVon(npc), k = H.kurve_spontanhilfe;
  if (h <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (h <= k[i][0]) { const [x0, y0] = k[i - 1], [x1, y1] = k[i]; return r2(y0 + (y1 - y0) * ((h - x0) / (x1 - x0))); }
  }
  return k[k.length - 1][1];
}
function tonVon(npc) {   // Ton der Bitten: der hoechste erreichte Eintrag aus toene
  const h = haltungVon(npc);
  let ton = H.toene[0].id;
  for (const t of H.toene) if (h >= t.ab) ton = t.id;
  return ton;
}
const kehrtFeindlichWieder = (npc) => haltungVon(npc) < H.feindlich_unter;
const nscVon = (game, id) => {
  const F = game && game.weltsim && game.weltsim.faeden;
  const f = F && F.liste.find((x) => x.nsc.id === id);
  return f ? f.nsc : null;
};
// Wirkung haltung_aenderung: Form prueft der Katalog (wirkungen.js), dass der NSC existiert prueft der Aufsatz (der Sim-Zustand kennt keine Faeden)
function haltungPruefen(game, w) {
  if (!istObjekt(w) || w.typ !== 'haltung_aenderung') return { ok: false, grund: 'keine Haltungs-Wirkung' };
  let g;
  try { g = Wirkungen.KATALOG.haltung_aenderung.pruefe(null, null, w); } catch (e) { g = 'Prüfung fehlgeschlagen: ' + e.message; }
  if (g) return { ok: false, grund: g };
  if (!nscVon(game, w.npc)) return { ok: false, grund: 'unbekannter NSC (npc): er steht in keinem Faden' };
  return { ok: true, grund: null };
}
function anwenden(game, wirkungen) {   // Aufrufer: Kriegslage.tickMit (gueltig gefilterte Wirkungen des Ticks) und haltungBuchen; unbekannte NSC werden still uebergangen (geprueft ist vorher)
  let n = 0;
  for (const w of wirkungen || []) {
    if (!w || w.typ !== 'haltung_aenderung' || !haltungPruefen(game, w).ok) continue;
    const nsc = nscVon(game, w.npc);
    nsc.haltung = klemmen(nsc.haltung + w.delta);
    n++;
  }
  return n;
}
// Haltung OHNE Sim-Tick (wie Kriegslage.rufBuchen): geprueft, atomar (ein Wurf rollt zurueck). -> { ok, angewandt, verworfen: [{ wirkung, grund }] }
function haltungBuchen(game, wirkungen) {
  const ws = game.weltsim;
  if (!ws || !ws.faeden) return { ok: false, angewandt: 0, verworfen: [] };
  const gueltig = [], verworfen = [];
  for (const w of Array.isArray(wirkungen) ? wirkungen : []) { const r = haltungPruefen(game, w); if (r.ok) gueltig.push(klon(w)); else verworfen.push({ wirkung: w, grund: r.grund }); }
  const sicher = klon(ws.faeden.liste);
  try { anwenden(game, gueltig); } catch (e) { ws.faeden.liste = sicher; fehlerZaehlen(game, 'faden-haltung', e); return { ok: false, angewandt: 0, verworfen }; }
  for (const v of verworfen) logbuch(game, 'faden_pruefung', { ausgang: 'abgelehnt', key: 'haltung_aenderung', plan: v.wirkung, fehler: [v.grund] });
  return { ok: true, angewandt: gueltig.length, verworfen };
}

// Folgen eines Ausgangs oder einer Option (Wirkungen des Katalogs, Zahlen aus den Daten)
function folgenAnwenden(game, f, folge) {
  const ruf = [], halt = [];
  for (const x of folge || []) {
    const r = P.folgeWirkung(x, f.nsc.id);
    if (!r.wirkung) { logbuch(game, 'faden_pruefung', { ausgang: 'abgelehnt', key: 'folge', fehler: [r.fehler], plan: x }); continue; }
    (r.wirkung.typ === 'ruf_aenderung' ? ruf : halt).push(r.wirkung);
  }
  if (halt.length) haltungBuchen(game, halt);
  if (ruf.length) { try { kl().rufBuchen(game, ruf); } catch (e) { fehlerZaehlen(game, 'faden-ruf', e); } }
}

// ---------- Taetigkeiten und Takt
const faellig = (f) => f.phase === 'wartet' && f.zaehler >= f.abstand;
function taetigkeit(game, art) {
  if (!aktiv(game) || !W.taetigkeiten.includes(art)) return null;
  const F = zustandVon(game);
  F.t = Math.min(F.t + 1, 1e9);
  for (const f of F.liste) {
    if (f.phase === 'abgeschlossen') continue;
    f.zaehler = Math.min(f.zaehler + 1, ZAEHLER_MAX);
    if (f.phase === 'laeuft' && f.laufend) f.laufend.n++;
  }
  for (const a of F.angebote) a.alter++;
  F.angebote = F.angebote.filter((a) => a.alter <= W.angebot.gilt_taetigkeiten);
  for (const f of F.liste.slice()) {   // Frist: ein Beat ohne Ausgang gilt als gescheitert, nichts blockiert (auch ohne Spielleiter)
    if (f.phase === 'laeuft' && f.laufend && f.laufend.n >= W.beat_frist) {
      melde(game, 'frist', f.id, `Beat ${f.laufend.beat} ohne Ausgang nach ${W.beat_frist} Tätigkeiten: gescheitert`, { faden: f.id, beat: f.laufend.beat });
      beatAusgang(game, f.id, 'gescheitert');
    }
  }
  return { t: F.t, faellig: F.liste.filter(faellig).map((f) => f.id) };
}

// ---------- Angebot aus einem Taetigkeitsausgang mit Person
function volkVonHex(game, hex) {
  try { const b = require('./besitz.js').besitzer(game, hex); return b === 'rom' ? 'rom' : b === 'ger' ? 'ger' : b === 'saum' ? 'kon' : null; } catch (e) { return null; }
}
function ausgangMitPerson(game, o) {
  if (!aktiv(game) || !istObjekt(o)) return null;
  if (!W.ausloeser.includes(o.art) || !W.ausgaenge.includes(o.ausgang)) return null;
  taetigkeit(game, o.art);   // der Ausgang ist selbst eine Taetigkeit (gezaehlt vor dem Angebot, das neue Angebot ist also frisch)
  const F = zustandVon(game);
  if (aktive(F).length >= W.aktiv_max) return null;   // kein Platz: ein Angebot waere sinnlos (Obergrenze)
  const hex = typeof o.hex === 'string' && HEX.test(o.hex) ? o.hex : '';
  const volk = hex ? volkVonHex(game, hex) : null;
  const vorlagen = D.vorlagenIds().filter((id) => { const v = D.vorlage(id); return v.ausloeser.some((a) => a.art === o.art && a.ausgang === o.ausgang) && (!volk || v.volk_erlaubt.includes(volk)); });
  if (!vorlagen.length) return null;
  const ref = typeof o.id === 'string' ? o.id.slice(0, 40) : '';
  if (F.angebote.some((a) => a.ref === ref && a.hex === hex)) return null;
  const a = { nr: ++F.angNr, art: o.art, ref, hex, volk: volk || '', vorlagen, alter: 0 };
  F.angebote.push(a);
  while (F.angebote.length > W.angebot.max) F.angebote.shift();
  return a;
}

// ---------- Befehle des Lage-Spielleiters
const istBefehl = P.istBefehl;
function befehlPruefen(game, b, ctx) { return P.befehlPruefen(zustandVon(game), b, ctx || P.neuerKontext()); }
function befehlAnwenden(game, b) {
  const F = zustandVon(game);
  const ctx = P.neuerKontext();   // frisch: was im selben Plan schon angewandt wurde, steht im Zustand
  const g = b && b.typ === 'faden_oeffnen' ? P.pruefeOeffnen(F, b, ctx) : b && b.typ === 'faden_weiter' ? P.pruefeWeiter(F, b, ctx) : 'BEFEHL_FELD: kein Faden-Befehl';
  if (g) { logbuch(game, 'faden_pruefung', { ausgang: 'abgelehnt', key: b && b.typ, plan: b, fehler: [g] }); return { ok: false, grund: g }; }
  return b.typ === 'faden_oeffnen' ? oeffnen(game, b) : weiterSetzen(game, b);
}

function oeffnen(game, b) {
  const F = zustandVon(game), ws = game.weltsim;
  const v = D.vorlage(b.vorlage), p = b.parameter || {};
  const a = p.angebot !== undefined ? F.angebote.find((x) => x.nr === p.angebot) : F.angebote.find((x) => x.vorlagen.includes(v.id));
  if (!a) return { ok: false, grund: 'KEIN_ANGEBOT: Angebot nicht mehr da' };
  const volk = p.volk || (v.volk_erlaubt.includes(a.volk) ? a.volk : v.volk_erlaubt[0]);
  const nscNr = F.nsc + 1;
  const nsc = nscErzeugen(game, v, volk, p.name, nscNr);
  if (!nsc) { logbuch(game, 'faden_pruefung', { ausgang: 'abgelehnt', key: 'faden_oeffnen', plan: b, fehler: ['NAME: kein freier Name'] }); return { ok: false, grund: 'NAME: kein freier Name' }; }
  F.angebote.splice(F.angebote.indexOf(a), 1);
  F.nsc = nscNr; F.nr++;
  const f = { id: 'f' + F.nr, vorlage: v.id, parameter: { volk, ort: p.ort || a.hex || '', name: nsc.name }, beat: 0, phase: 'wartet', zaehler: 0, abstand: 0, laufend: null, hinweise: [], ausgang: null, begonnen: ws.tickZahl, nsc };
  f.abstand = abstandZiehen(game, f);
  F.liste.push(f);
  while (F.liste.length > W.faeden_gesamt_max) {   // die aeltesten abgeschlossenen zuerst (nie ein aktiver)
    const i = F.liste.findIndex((x) => x.phase === 'abgeschlossen');
    if (i < 0) break;
    F.liste.splice(i, 1);
  }
  melde(game, 'geoeffnet', f.id, `Faden ${f.id} (${v.id}) geöffnet: NSC ${nsc.id}, Abstand ${f.abstand}`, { faden: f.id, vorlage: v.id, volk, angebot: a.nr });
  return { ok: true, faden: f };
}

function weiterSetzen(game, b) {
  const F = zustandVon(game), ws = game.weltsim;
  const f = F.liste.find((x) => x.id === b.faden);
  const v = D.vorlage(f.vorlage), beat = v.beats[f.beat], cat = B[beat.typ];
  f.phase = 'laeuft'; f.zaehler = 0;
  f.laufend = { beat: beat.id, n: 0, seit: ws.tickZahl };
  for (const h of beat.hinweise || []) if (!f.hinweise.includes(h)) f.hinweise.push(h);   // der Hinweis ist gestreut, bevor der Beat erzaehlt wird
  if (cat.braucht && cat.braucht.wahrheit && f.nsc.wahrheit) f.nsc.wahrheit.offenbart = true;
  melde(game, 'beat_start', f.id, `Beat ${beat.id} (${beat.typ}) beginnt`, { faden: f.id, beat: beat.id, typ: beat.typ });
  const bs = Bausteine.vonId(cat.baustein);
  let r = null;
  try { r = bs.starten(game, f, { vorlage: v, beat, katalog: cat, parameter: klon(f.parameter), nsc: klon(f.nsc) }); } catch (e) {
    fehlerZaehlen(game, 'faden-baustein', e);
    melde(game, 'baustein_fehler', f.id, `Baustein ${cat.baustein} wirft: ${String(e && e.message).slice(0, 120)}`, { faden: f.id, beat: beat.id });
    r = { ausgang: 'gescheitert' };   // ein werfender Baustein blockiert nichts: der Beat gilt als gescheitert, der Faden lebt weiter
  }
  if (r && W.ausgaenge.includes(r.ausgang)) beatAusgang(game, f.id, r.ausgang);
  return { ok: true, faden: f };
}

// Der Beat ist zu Ende (Aufrufer: Bausteine, Frist). Scheitern VERAENDERT den Faden (anderer Zustand des NSC, anderer Weg), es beendet ihn nicht: nur der Abschluss-Beat schliesst einen Faden ab.
function beatAusgang(game, fadenId, ausgang) {
  const F = zustandVon(game), ws = game.weltsim;
  const f = F && F.liste.find((x) => x.id === fadenId);
  if (!f || f.phase !== 'laeuft') return { ok: false, grund: 'kein laufender Beat' };
  if (!W.ausgaenge.includes(ausgang)) return { ok: false, grund: 'unbekannter Ausgang' };
  const v = D.vorlage(f.vorlage), beat = v.beats[f.beat], cat = B[beat.typ];
  const o = (beat.aus || {})[ausgang] || {};
  if (o.status && f.nsc.status !== 'tot') f.nsc.status = o.status;   // ein toter NSC bleibt tot
  folgenAnwenden(game, f, o.folge);
  gedaechtnisEintragen(f.nsc, ws.tickZahl, beat.typ + '_' + ausgang, o.text_key || beat.id);
  f.laufend = null; f.zaehler = 0;
  if (cat.abschluss) {
    f.phase = 'abgeschlossen';
    f.ausgang = { art: ausgang, status: f.nsc.status, tick: ws.tickZahl };
  } else {
    const ziel = o.weiter !== undefined ? v.beats.findIndex((x) => x.id === o.weiter) : f.beat + 1;
    f.beat = ziel > f.beat && ziel < v.beats.length ? ziel : v.beats.length - 1;   // nur nach vorn; ein kaputtes Ziel springt zum Abschluss (der Pruefer laesst es nie zu)
    f.phase = 'wartet';
    f.abstand = abstandZiehen(game, f);
  }
  melde(game, f.phase === 'abgeschlossen' ? 'abgeschlossen' : 'beat_ende', f.id, `Beat ${beat.id} ${ausgang}${f.phase === 'abgeschlossen' ? ', Faden abgeschlossen' : ', NSC ' + f.nsc.status + ', weiter ' + v.beats[f.beat].id}`, { faden: f.id, beat: beat.id, ausgang, status: f.nsc.status });
  return { ok: true, faden: f };
}

// Die Crew waehlt eine Option des laufenden Beats (Baustein meldet die Wahl): Folgen aus dem Katalog, optional gleich der Ausgang. Nie bei Gefahr (Pruefer der Vorlage und Pruefung hier).
function optionWaehlen(game, fadenId, optionId) {
  const F = zustandVon(game);
  const f = F && F.liste.find((x) => x.id === fadenId);
  if (!f || f.phase !== 'laeuft' || !f.laufend) return { ok: false, grund: 'kein laufender Beat' };
  if (f.laufend.gewaehlt) return { ok: false, grund: 'schon gewählt' };
  const v = D.vorlage(f.vorlage), beat = v.beats[f.beat], cat = B[beat.typ];
  if (P.optionenFehler(beat, cat).length) return { ok: false, grund: 'Optionen ungültig oder bei Gefahr' };
  const opt = (beat.optionen || []).find((x) => x.id === optionId);
  if (!opt) return { ok: false, grund: 'unbekannte Option' };
  f.laufend.gewaehlt = opt.id;
  folgenAnwenden(game, f, opt.folge);
  if (opt.ausgang) beatAusgang(game, f.id, opt.ausgang);
  return { ok: true, ausgang: opt.ausgang || null };
}

// ---------- Ausschnitt und Prompt fuer den Lage-Spielleiter
// Klein: hoechstens aktiv_max Faeden, Zeichenbudget werte.ausschnitt.zeichen. Keine Spielernamen (keine NSC-Namen, nur Kennungen), die verborgene Wahrheit nur als Kennung (w), nie als Text.
function ausschnittBlock(game) {
  if (!aktiv(game)) return null;
  const F = zustandVon(game);
  const liste = aktive(F).slice(0, W.aktiv_max);
  const fa = liste.map((f) => {
    const v = D.vorlage(f.vorlage), beat = v.beats[f.beat];
    const e = { id: f.id, v: v.id, ph: f.phase, beat: beat.id, typ: beat.typ, z: f.zaehler, nsc: { f: f.nsc.fraktion, st: f.nsc.status, h: f.nsc.haltung } };
    if (f.phase === 'wartet') e.faellig = faellig(f) ? 1 : 0;
    if (f.nsc.wahrheit) { e.nsc.w = f.nsc.wahrheit.id; if (f.nsc.wahrheit.offenbart) e.nsc.off = 1; e.hw = f.hinweise.length; }
    return e;
  });
  const ang = F.angebote.map((a) => ({ nr: a.nr, v: a.vorlagen.slice(), hex: a.hex, volk: a.volk }));
  if (!fa.length && !ang.length) return null;
  const block = { aktiv: fa, platz: Math.max(0, W.aktiv_max - fa.length) };
  if (ang.length) block.angebote = ang;
  const zu = () => JSON.stringify(block).length > W.ausschnitt.zeichen;
  if (zu() && block.angebote) { for (const a of block.angebote) a.v = a.v.slice(0, 2); }
  while (zu() && block.aktiv.length > 1) block.aktiv.pop();
  return block;
}
function promptText() {
  const ids = D.vorlagenIds();
  if (!ids.length) return '';
  const L = [];
  L.push(`Fäden (Geschichten): Ein Faden ist ein wiederkehrender NSC mit einer festen Kette von Beats aus einer Vorlage. Du wählst, OB und WANN, die Beats selbst führen Sim und Bausteine aus; du erfindest weder NSC noch Mechanik (Namen, Schiffe und Folgen kommen aus Daten). Im Ausschnitt steht faeden: { aktiv: [ { id, v: Vorlage, ph: wartet|laeuft, beat: Id des laufenden bzw. nächsten Beats, typ, z: Tätigkeiten seit dem letzten Beat, faellig: 1 = der Abstand ist erreicht, nsc: { f: Volk, st: Zustand, h: Haltung, w: Kennung der verborgenen Wahrheit, off: 1 = enthüllt }, hw: gestreute Hinweise } ], angebote: [ { nr, v: [passende Vorlagen], hex, volk } ], platz: freie Plätze }.`);
  L.push(`- faden_oeffnen { vorlage: Vorlagen-Id, parameter?: { angebot: Nr aus angebote, volk?: ${W.voelker.join('|')}, ort?: Hex-Code, name?: "Vorname Nachname" aus den Namenlisten (besser weglassen) } } – öffnet einen Faden aus einem Angebot (eine Tätigkeit mit Person am Ausgang); ohne Angebot ungültig.`);
  L.push(`- faden_weiter { faden: Faden-Id, beat: die Id aus aktiv[].beat } – startet den nächsten Beat; nur wenn ph wartet und faellig 1 ist.`);
  L.push(`Regeln: höchstens ${W.aktiv_max} aktive Fäden, höchstens ${W.befehle_je_plan_max} Faden-Befehle je Plan (sie zählen nicht gegen die Rate); die Reihenfolge der Beats ist fest, der Abstand zwischen Beats ${W.abstand.min} bis ${W.abstand.max} Tätigkeiten (Zähler z); eine Enthüllung (typ enthuellung) kommt erst, wenn hw mindestens 1 ist; Gefahr wird angekündigt, nie abgefragt. Scheitern verändert einen Faden, es beendet ihn nicht. Läuft ein Beat, wartest du; er endet von selbst (Ausgang oder nach ${W.beat_frist} Tätigkeiten). Ohne Angebot und ohne fälligen Faden brauchst du keinen Faden-Befehl.`);
  L.push('Vorlagen: ' + ids.map((id) => { const v = D.vorlage(id); return `${id} (Völker ${v.volk_erlaubt.join('|')}; Beats ${v.beats.map((b) => `${b.id}:${b.typ}`).join(' > ')})`; }).join('; '));
  return L.join('\n');
}

// ---------- Weltstand welt.sim.faeden
function toSave(ws) {
  const F = ws && ws.faeden;
  if (!F || (!F.liste.length && !F.t && !F.nr && !F.nsc)) return null;
  const b = { t: F.t, nr: F.nr, nsc: F.nsc };
  if (F.liste.length) b.liste = klon(F.liste);
  return b;
}
function leseNsc(x, v) {
  if (!istObjekt(x) || typeof x.id !== 'string' || !/^n\d{1,6}$/.test(x.id)) return null;
  const str = (s, max) => (typeof s === 'string' && s.length > 0 && s.length <= max ? s : null);
  const name = str(x.name, 40), schiff = str(x.schiff, 40), klasse = str(x.schiffsklasse, 24);
  if (!name || !schiff || !klasse || !W.voelker.includes(x.fraktion)) return null;
  const ged = [];
  for (const g of Array.isArray(x.gedaechtnis) ? x.gedaechtnis : []) {
    if (istObjekt(g) && Number.isFinite(g.tick) && g.tick >= 0 && typeof g.ereignis === 'string' && /^[a-z_]{1,40}$/.test(g.ereignis) && typeof g.text_key === 'string' && /^[a-z0-9_]{1,40}$/.test(g.text_key)) ged.push({ tick: Math.floor(g.tick), ereignis: g.ereignis, text_key: g.text_key });
  }
  const nsc = { id: x.id, name, fraktion: x.fraktion, schiff, schiffsklasse: klasse, status: W.status.includes(x.status) ? x.status : 'aktiv', haltung: klemmen(x.haltung), gedaechtnis: ged.slice(-W.gedaechtnis_max), wahrheit: null, portrait: nat(x.portrait, 2147483647) };
  if (v.wahrheit) {   // die Wahrheit gehoert der Vorlage (Datei), aus dem Stand kommt nur, ob sie schon heraus ist
    nsc.wahrheit = { id: v.wahrheit.id, offenbart: !!(istObjekt(x.wahrheit) && x.wahrheit.offenbart === true) };
    if (v.wahrheit.fraktion) nsc.wahrheit.fraktion = v.wahrheit.fraktion;
  }
  return nsc;
}
function leseFaden(x) {
  if (!istObjekt(x) || typeof x.id !== 'string' || !/^f\d{1,6}$/.test(x.id)) return { fehler: 'Faden-Kennung ungültig' };
  const v = typeof x.vorlage === 'string' ? D.vorlage(x.vorlage) : null;
  if (!v) return { fehler: `${x.id}: Vorlage "${String(x.vorlage).slice(0, 30)}" unbekannt` };
  const nsc = leseNsc(x.nsc, v);
  if (!nsc) return { fehler: `${x.id}: NSC unbrauchbar` };
  const p = istObjekt(x.parameter) ? x.parameter : {};
  const phase = ['wartet', 'laeuft', 'abgeschlossen'].includes(x.phase) ? x.phase : null;
  if (!phase || !Number.isInteger(x.beat) || x.beat < 0 || x.beat >= v.beats.length) return { fehler: `${x.id}: Phase oder Beat ungültig` };
  const a = v.abstand || W.abstand;
  const f = {
    id: x.id, vorlage: v.id,
    parameter: { volk: W.voelker.includes(p.volk) ? p.volk : nsc.fraktion, ort: typeof p.ort === 'string' && (p.ort === '' || HEX.test(p.ort)) ? p.ort : '', name: nsc.name },
    beat: x.beat, phase, zaehler: nat(x.zaehler, ZAEHLER_MAX),
    abstand: Number.isInteger(x.abstand) ? Math.min(Math.min(a.max, W.abstand.max), Math.max(Math.max(a.min, W.abstand.min), x.abstand)) : Math.max(a.min, W.abstand.min),
    laufend: null, hinweise: [], ausgang: null, begonnen: nat(x.begonnen, 1e9), nsc,
  };
  if (Array.isArray(x.hinweise)) for (const h of x.hinweise) if (typeof h === 'string' && has(v.hinweise || {}, h) && !f.hinweise.includes(h)) f.hinweise.push(h);
  if (phase === 'laeuft') {
    const l = istObjekt(x.laufend) ? x.laufend : {};
    if (l.beat !== v.beats[f.beat].id) return { fehler: `${x.id}: laufender Beat passt nicht zur Vorlage` };
    f.laufend = { beat: l.beat, n: nat(l.n, ZAEHLER_MAX), seit: nat(l.seit, 1e9) };
    if (typeof l.gewaehlt === 'string' && (v.beats[f.beat].optionen || []).some((o) => o.id === l.gewaehlt)) f.laufend.gewaehlt = l.gewaehlt;
  }
  if (phase === 'abgeschlossen') {
    const o = istObjekt(x.ausgang) ? x.ausgang : {};
    f.ausgang = { art: W.ausgaenge.includes(o.art) ? o.art : 'gescheitert', status: W.status.includes(o.status) ? o.status : nsc.status, tick: nat(o.tick, 1e9) };   // kein Faden ohne Ausgang
  }
  const e = P.pruefeFaden(f);
  return e.length ? { fehler: `${x.id}: ${e[0]}` } : { faden: f };
}
// müll-fester Leser: Unbrauchbares faellt weg (mit Meldung im Logbuch der Partie), Obergrenzen werden geklemmt
function lesen(b) {
  const F = neu();
  if (!istObjekt(b)) return F;
  F.t = nat(b.t, 1e9);
  let nr = nat(b.nr, 1e9), nscNr = nat(b.nsc, 1e9);
  const ids = new Set();
  for (const x of Array.isArray(b.liste) ? b.liste : []) {
    const r = leseFaden(x);
    if (!r.faden) { F.ladeFehler.push(r.fehler); continue; }
    if (ids.has(r.faden.id) || F.liste.some((y) => y.nsc.id === r.faden.nsc.id)) { F.ladeFehler.push(`${r.faden.id}: Kennung doppelt`); continue; }
    if (r.faden.phase !== 'abgeschlossen' && aktive(F).length >= W.aktiv_max) { F.ladeFehler.push(`${r.faden.id}: mehr als ${W.aktiv_max} aktive Fäden, verworfen`); continue; }
    ids.add(r.faden.id);
    F.liste.push(r.faden);
  }
  while (F.liste.length > W.faeden_gesamt_max) { const i = F.liste.findIndex((x) => x.phase === 'abgeschlossen'); F.liste.splice(i < 0 ? 0 : i, 1); }
  for (const f of F.liste) { nr = Math.max(nr, idNr(f.id)); nscNr = Math.max(nscNr, idNr(f.nsc.id)); }
  F.nr = nr; F.nsc = nscNr;
  return F;
}

module.exports = { aktiv, neu, zustandVon, taetigkeit, ausgangMitPerson, istBefehl, befehlPruefen, befehlAnwenden, oeffnen, weiterSetzen, beatAusgang, optionWaehlen, haltungPruefen, haltungBuchen, anwenden, haltungVon, chanceSpontanhilfe, tonVon, kehrtFeindlichWieder, portraetVon, nscVon, ausschnittBlock, promptText, toSave, lesen, aktive, faellig, folgenAnwenden };
