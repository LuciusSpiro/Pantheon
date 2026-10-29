'use strict';
// SUND-03 D: Reise-Ereignisse der Freien Fahrt Sund (game.weltsim). Action-Layer wie ruf.js und absicht.js. Nach jedem Sprung (sprung.springeNach, auch jeder Hop des Schnellsprungs, NACH Kriegslage.tick
// und dem Szenenaufbau) entscheidet entscheiden(), ob ein Ereignis entsteht. Arten: notruf, patrouille, piraten, funkmeldung (Lagemeldung). Katalog (Daten): content/reise/ereignisse.json, Zahlen:
// content/reise/werte.json. Das Format lehnt sich an die Kampagnen-Notrufe (content/notrufe, SL8) an, die ein anderes System bleiben.
//
// Regeln (Auftrag SUND-03, Paket D):
//   Rate        höchstens 1 Ereignis je 3 aufeinanderfolgende Sprünge. Hart im Code (ABSTAND_HART = 3; die Daten dürfen den Abstand nur vergrößern). Dazu eine Chance je freiem Sprung (wahrscheinlichkeit).
//               Das Abfangen des Schnellsprungs (reise.js) zählt als Ereignis für diesen Abstand (abfangenVermerken); es hat sonst Vorrang vor nichts: ein Reise-Ereignis im selben Hop bricht den
//               Schnellsprung ab, bevor das Abfangen gewürfelt wird (kein doppeltes Ereignis, das Abfangen bleibt wie es war). Der Notfallsprung ist kein Reise-Sprung (kein Zähler, kein Ereignis).
//   Zufall      ein EIGENER, zählerbasierter Strom (kein game.rng, nicht der Strom der Sim: ihre Bit-Parität bleibt): Zufall(Sim-Seed, Sprungzähler, Salz). Es gibt keinen Strom-Zustand zu speichern,
//               nur den Zähler n; Speichern, Laden und Weiterspielen ist gleich Durchspielen.
//   Wiederholung nie dieselbe Katalog-Id zweimal in Folge, nie derselbe Parametersatz (Art, Variante, Ortstyp, Ziel-Hex) wie eines der letzten `fenster` Ereignisse, dazu der Mindestabstand je Id.
//   Fairness    Gefahr wird angekündigt: Patrouille und Piraten funken VOR dem Eintreffen (vorlauf_s, mindestens vorlauf_min_s), ein Notruf nennt seine Gefahr im Text und der Vorlauf folgt beim Eintreffen.
//               Gefahr angekündigt heißt: Vorwarnzeit zum Vorbereiten (wie beim bestehenden Abfangen), NICHT vermeidbar (der Sprung braucht Ladezeit und Abstand zum Gegen-Sprungpunkt). Wer in dieser Zeit trotzdem den Sektor wechselt, dem folgt die Gefahr nicht. Echte Wahl haben nur die Notrufe. Notrufe lassen die Wahl: Ablehnen (nicht hinfliegen, verfallen lassen oder ablehnen()) kostet nichts, es gibt dafür keine Wirkung. Funkmeldungen haben keine Gefahr.
//   Folgen      nur über den Wirkungen-Katalog: ruf_aenderung mit Gründen aus content/welt/ruf-werte.json (Kriegslage.rufBuchen, ohne Sim-Tick). Die Sim wird durch Ereignisse nie verändert.
//   Sim-Notruf  Liegt ein Notruf der Sim (Marke lage:n) in Reichweite, nimmt ein passender Katalog-Notruf ihn auf (Ort und Art), statt einen eigenen zu erfinden; ohne eigene Folge.
//
//   zaehleSprung(game) -> n           Sprungzähler +1 (erster Schritt je Sprung)
//   entscheiden(game, hex) -> Ereignis | null   die Entscheidung dieses Sprungs (verbraucht den Abstand, merkt Wiederholungsdaten); ändert sonst nichts
//   ausloesen(game, ereignis)         Funk, Marke, Chronik, Vorlauf (je Art eine benannte Funktion)
//   nachSprung(game, dest) -> { id, art, kurz } | null   alles zusammen (Aufrufer: sprung.springeNach). Beantwortet auch offene Notrufe des Ankunftssektors, ohne ein neues Ereignis zu würfeln.
//   abfangenVermerken(game)           das Abfangen des Schnellsprungs zählt für den Abstand
//   update(game, dt)                  Vorlauf ablaufen lassen, Gegner eintreffen lassen, Folgen nach bewältigter Lage (Aufrufer: reise.update)
//   textFuer(ereignis, slot, game?) -> { von, text } | null   BENANNTE STELLE für den Text (synchron): ein vorab von Gemma erzeugter Text aus dem Pool (texte-pool.js, nur mit TEXTE_POOL=1), sonst der feste Katalogtext
//   gruendeBuchen(game, gruende, nurFraktion?) -> n  Folgen buchen (ruf_aenderung unter dem Reise-Ruf-Deckel; rufRaum(game) = Raum darin); folgeBuchen(game, e) = die Folge des Katalogeintrags. SUND-03b A: funk-antwort.js hängt an ausloesenFunkmeldung, ausloesenKontakt (ohne Gefahr), notrufBeantworten (ohne Gefahr), nachSprung und update
//   ablehnen(game, nr) -> bool        ein offener Notruf wird ausdrücklich abgelehnt (keine Folge)
//   neu() / toSave(ws) / lesen(block) Weltstand welt.sim.reise: { n, letzter?, letzte? } (optional, Altstand = leer); Notruf-Marken und laufende Ereignisse stehen nicht im Weltstand
const Sektoren = require('../../shared/sektoren.js');
const Besitz = require('./besitz.js');
const Chronik = require('./chronik.js');
const Marken = require('./marken.js');
const Regie = require('./regie-befehle.js');
const Ruf = require('./ruf.js');
const TextePool = require('./texte-pool.js');   // SUND-03b T
const Zufall = require('../weltsim/zufall.js');

const KATALOG = require('../../content/reise/ereignisse.json').eintraege;
const WERTE = Object.fromEntries(Object.entries(require('../../content/reise/werte.json').werte).map(([k, v]) => [k, v.wert]));
const RUF_QUELLEN = require('../../content/welt/ruf-werte.json').werte.quellen.wert;
const RUF_FENSTER = 100;   // Sprünge, über die der Ruf-Deckel zählt
const ABSTAND_HART = 3;   // höchstens 1 Ereignis je 3 Sprünge, unabhängig von den Daten
const ARTEN = ['notruf', 'patrouille', 'piraten', 'funkmeldung'];
const FA = () => require('./funk-antwort.js');   // lazy: funk-antwort.js lädt dieses Modul
const kl = () => require('./kriegslage.js');   // lazy: kriegslage.js lädt dieses Modul
const space = () => require('./space.js');
const eintrag = (id) => KATALOG.find((e) => e.id === id) || null;
const fmt = (s, o) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? String(o[k]) : m));
const hexName = (hex) => Sektoren.hexName(hex) || String(hex);
const abstandSpruenge = () => Math.max(ABSTAND_HART, Math.floor(Number(WERTE.min_abstand_spruenge)) || 0);

// ---------- Zustand (Weltstand welt.sim.reise). Laufzeit (nicht gespeichert): offen = offene Notrufe des Katalogs, laufend = angekündigte/laufende Gefahren
const neu = () => ({ n: 0, letzter: null, letzte: [], rufLog: [], offen: [], laufend: [] });
function zustandVon(game) {
  const ws = game.weltsim;
  if (!ws) return null;
  if (!ws.reise) ws.reise = neu();
  return ws.reise;
}
const seedVon = (game) => ((Number(game.weltsim.zustand.seed) | 0) ^ 0x52454953) >>> 0;   // „REIS“: aus dem Sim-Seed des Weltstands, nie aus game.rng
function mix(a, b) {
  let h = (a ^ Math.imul((b | 0) + 0x9E3779B9, 0x85EBCA6B)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297A2D39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
const salzVon = (s) => { let h = 0x811C9DC5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h; };
// Strom für (Seed, Sprung n, Salz): bei gleichen Angaben immer dieselbe Folge, ohne gemeinsamen Zustand
function strom(seed, n, salz) {
  const z = { zufall: Zufall.startzustand(mix(mix(seed, n), salzVon(salz))) };
  return () => Zufall.zahl(z);
}

function aktiv(game) {
  const ws = game && game.weltsim;
  if (!ws || !ws.zustand) return false;
  const env = game.env || process.env;   // wie der Lage-Spielleiter: Standard aus (der Bestand läuft ohne Env unverändert), die Voreinstellung ist ein Datum (werte.standard_an)
  const v = String((env && env.REISE_EREIGNISSE) || '').toLowerCase();
  if (v === '1' || v === 'on') return true;
  if (v === '0' || v === 'off') return false;
  return voreinstellungAn(env);
}
// Ohne REISE_EREIGNISSE: an, wenn der Lage-Spielleiter an ist (LAGE_SPIELLEITER=1 und SPIELLEITER_LLM ≠ off), sonst der Datenwert standard_an (false)
function voreinstellungAn(env) {
  return require('./lage-spielleiter.js').schalterAn(env) || WERTE.standard_an === true;
}

// ---------- Bedingungen
const besitzerVon = (game, hex) => Besitz.besitzer(game, hex) || 'frei';
const rangIndex = (id) => Ruf.RAENGE.findIndex((r) => r.id === id);
function passt(e, ctx) {
  const b = e.bedingungen || {};
  if (b.besitzer && !b.besitzer.includes(ctx.besitzer)) return false;
  if (b.rang_min && ctx.rang < rangIndex(b.rang_min)) return false;
  if (b.rang_max && ctx.rang > rangIndex(b.rang_max)) return false;
  if (b.lage && !b.lage.includes(ctx.lage())) return false;
  return true;
}
function abstandOk(R, e) {
  const b = e.bedingungen || {};
  if (!b.min_abstand) return true;
  return R.letzte.every((x) => x.id !== e.id || R.n - x.n >= b.min_abstand);
}

// ---------- Orte
// Sektoren im Hex-Abstand von..bis um `hex` (spielbar, mit Ort), sortiert (deterministisch)
function umkreis(hex, von, bis) {
  const gesehen = { [hex]: 0 }; let rand = [hex]; const out = [];
  for (let d = 1; d <= bis; d++) {
    const next = [];
    for (const h of rand) for (const nb of Sektoren.nachbarn(h)) {
      if (nb in gesehen) continue;
      gesehen[nb] = d; next.push(nb);
      if (d >= von && Sektoren.spielbar(nb) && !Sektoren.istLeerraum(nb) && Sektoren.ortVonHex(nb)) out.push(nb);
    }
    rand = next;
  }
  return out.sort();
}
// Ein Notruf der Sim in Reichweite des Ankunftssektors, passend zur Art (Ereignis notruf im Ring). -> { hex, marke } | null
function simNotruf(game, hex, simArt) {
  const ws = game.weltsim;
  const liste = (ws.wissen && Array.isArray(ws.wissen.notrufe) && ws.wissen.notrufe) || [];
  if (!liste.length || !simArt) return null;
  const nah = new Set(umkreis(hex, 1, WERTE.sim_reichweite));
  for (const nr of liste.slice().reverse()) {   // der jüngste zuerst
    if (!nah.has(nr.h)) continue;
    const ev = (ws.ereignisse || []).find((x) => x.typ === 'notruf' && x.angriff === nr.an);
    if (ev && ev.art === simArt) return { hex: nr.h, marke: nr.m };
  }
  return null;
}
// Parametersatz des Ereignisses an diesem Ankunftssektor (null: der Eintrag hat hier keinen Platz, z. B. kein Ort für den Notruf)
function parameterFuer(game, R, e, hex) {
  const p = e.parameter || {};
  const out = { variante: p.variante || '', ort_typ: p.ort_typ || '', hex, sim: null };
  if (e.art === 'notruf') {
    const sim = simNotruf(game, hex, p.sim_art);
    if (sim) { out.hex = sim.hex; out.sim = sim.marke; }
    else {
      const T = WERTE.ort_typen[p.ort_typ] || WERTE.ort_typen.nachbar;
      const belegt = new Set(R.offen.map((o) => o.hex));
      const frei = umkreis(hex, T.min, T.max).filter((h) => !belegt.has(h));
      if (!frei.length) return null;
      out.hex = frei[Math.floor(strom(seedVon(game), R.n, 'ort:' + e.id)() * frei.length) % frei.length];
    }
  }
  out.schluessel = [e.art, out.variante, out.ort_typ, out.hex].join('|');
  return out;
}

// ---------- Entscheidung
const wuerfel = (game) => strom(seedVon(game), game.weltsim.reise.n, 'wurf');
function zaehleSprung(game) {
  const R = zustandVon(game);
  if (!R) return 0;
  R.n++;
  return R.n;
}
function kandidaten(game, R, hex) {
  const ctx = { besitzer: besitzerVon(game, hex), rang: Ruf.rangInfo(game).index, lage: (() => { let l = null; return () => l || (l = Regie.lage(game).sieger); })() };
  const letzterId = R.letzte.length ? R.letzte[R.letzte.length - 1].id : null;
  const verboten = new Set(R.letzte.slice(-WERTE.wiederholung.fenster).map((x) => x.k));   // Parametersätze der letzten Ereignisse
  const out = [];
  for (const e of KATALOG) {
    if (e.id === letzterId || !passt(e, ctx) || !abstandOk(R, e)) continue;   // nie zweimal in Folge dieselbe Id
    const p = parameterFuer(game, R, e, hex);
    if (!p || verboten.has(p.schluessel)) continue;
    out.push({ e, p });
  }
  return out;
}
function entscheiden(game, hex) {
  const R = zustandVon(game);
  if (!R || !aktiv(game) || game.simSzene || !hex) return null;
  if (R.letzter != null && R.n - R.letzter < abstandSpruenge()) return null;   // Rate: hart
  const rng = wuerfel(game);
  if (!(rng() < WERTE.wahrscheinlichkeit)) return null;
  const kand = kandidaten(game, R, hex);
  if (!kand.length) return null;
  const summe = kand.reduce((s, k) => s + k.e.gewicht, 0);
  let r = rng() * summe, wahl = kand[kand.length - 1];
  for (const k of kand) { r -= k.e.gewicht; if (r < 0) { wahl = k; break; } }
  const ev = { nr: R.n, id: wahl.e.id, art: wahl.e.art, variante: wahl.p.variante, ort_typ: wahl.p.ort_typ, hex: wahl.p.hex, ankunft: hex, sim: wahl.p.sim, schluessel: wahl.p.schluessel, textIdx: Math.floor(rng() * 1000) };
  R.letzter = R.n;
  R.letzte.push({ id: ev.id, k: ev.schluessel, n: R.n });
  while (R.letzte.length > WERTE.wiederholung.ring) R.letzte.shift();
  return ev;
}
// Das Abfangen des Schnellsprungs zählt für den Abstand (kein Reise-Ereignis im selben Hop und in den nächsten zwei)
// Ist der Abstand zum letzten Ereignis (oder Abfangen) groß genug für das Abfangen des Schnellsprungs? Ohne die Reise-Ereignisse immer ja.
function abstandFrei(game) {
  const R = aktiv(game) && zustandVon(game);
  return !R || R.letzter == null || R.n - R.letzter >= abstandSpruenge();
}
function abfangenVermerken(game) {
  const R = zustandVon(game);
  if (R) R.letzter = R.n;
}

// ---------- Text (benannte Stelle für Paket 03b: Live-Texte)
// SUND-03b T: ist im Pool ein vorab erzeugter Text für (Eintrag, Slot), kommt er (jeder Text genau einmal, FIFO, ohne Zufall: der Strom der Reise und der Sim bleibt unberührt), sonst der Katalogtext.
// Ohne Schalter (TEXTE_POOL) ist der Pool immer leer: der Katalogtext, wie in 03a. {ort} und {n} setzt textFuer beim Verbrauch ein.
function textFuer(ev, slot, game) {
  const e = ev && eintrag(ev.id);
  const liste = e && e.texte && e.texte[slot];
  if (!liste || !liste.length) return null;
  const werte = { ort: hexName(ev.hex), n: (e.parameter || {}).vorlauf_s };
  const live = TextePool.poolFuer(game, 'reise', e.id, slot);   // mit game: nur mit dem Schalter DIESES Raums und ohne dessen Spielernamen; ohne game (Aufrufer ohne Raum): prozessweite Freigabe
  return { von: e.sprecher || 'Aufklärung', text: fmt(live != null ? live : liste[(ev.textIdx || 0) % liste.length], werte) };
}
function funk(game, t) {
  if (!t || !t.text) return;
  try { game.emit('radio', { from: t.von, text: t.text, lage: 1, r: 1 }); } catch (e) { if (game.countError) game.countError('reise-funk', e); }
}
const kurzVon = (ev) => { const e = eintrag(ev.id); return fmt((e && e.chronik) || ev.id, { ort: hexName(ev.hex) }).slice(0, WERTE.chronik_kurz_max); };
function chronik(game, ev, kurz) {
  Chronik.eintragen(game, { art: 'reise', ref: ev.id, kurz: kurz || kurzVon(ev), param: { art: ev.art, variante: ev.variante, hex: ev.hex } });
}

// ---------- Folgen (Wirkungen-Katalog: ruf_aenderung)
const folgeBuchen = (game, e) => gruendeBuchen(game, (e && e.folge && e.folge.angenommen) || []);
// Gründe aus ruf-werte.json buchen (ruf_aenderung, Kriegslage.rufBuchen, ohne Sim-Tick) unter dem Reise-Ruf-Deckel; auch die Folgen der Funk-Antworten (funk-antwort.js, SUND-03b A) laufen hierüber -> Anzahl angewandter Wirkungen
// nurFraktion (SUND-03b A, Funk-Antworten): nur die Wirkungen DIESER Fraktion zählen für den Deckel (Konkordat-Antworten verdrängen sonst die Rom-Folgen der Ereignisse, der Deckel schützt die Rangleiter von Rom); ohne Angabe zählt alles wie in SUND-03 D
function gruendeBuchen(game, gruende, nurFraktion) {
  const wirkungen = gruende.filter((g) => RUF_QUELLEN[g]).map((g) => ({ typ: 'ruf_aenderung', fraktion: RUF_QUELLEN[g].fraktion, delta: RUF_QUELLEN[g].delta, grund: g }));
  if (!wirkungen.length) return 0;
  const R = zustandVon(game);
  const betrag = wirkungen.filter((w) => !nurFraktion || w.fraktion === nurFraktion).reduce((s, w) => s + Math.abs(w.delta), 0);
  if (betrag > 0) {
    R.rufLog = R.rufLog.filter((x) => R.n - x[0] < RUF_FENSTER);
    if (R.rufLog.reduce((s, x) => s + x[1], 0) + betrag > WERTE.ruf_max_je_100) return 0;   // Deckel: Reise-Ereignisse sollen die Rangleiter nicht verkürzen
    R.rufLog.push([R.n, betrag]);
  }
  try { return kl().rufBuchen(game, wirkungen).angewandt; } catch (err) { if (game.countError) game.countError('reise-folge', err); return 0; }
}

// Raum im Reise-Ruf-Deckel (Betrag, den eine Folge jetzt noch haben dürfte)
function rufRaum(game) {
  const R = zustandVon(game);
  if (!R) return 0;
  return WERTE.ruf_max_je_100 - R.rufLog.filter((x) => R.n - x[0] < RUF_FENSTER).reduce((s, x) => s + x[1], 0);
}

// ---------- Auslösen (je Art eine benannte Funktion)
function ausloesenFunkmeldung(game, ev) {
  funk(game, textFuer(ev, 'ankuendigung', game));
  chronik(game, ev);
  FA().anbieten(game, ev);   // SUND-03b A: Funk-Antwort (nur wo der Katalog antworten hat)
}
// Eine angekündigte Gefahr: Vorlauf, dann Gegner. `sprung` = Sprungzähler der Ankunft: jeder weitere Sprung (auch zurück in dieselbe Szene) beendet sie ohne Folge.
function laufendEintragen(game, R, ev, extra) {
  const e = eintrag(ev.id);
  R.laufend.push(Object.assign({ nr: ev.nr, id: ev.id, phase: 'erwartet', szene: game.ship.scene, sprung: R.n, ab: game.time + e.parameter.vorlauf_s, tag: 'reise' + ev.nr, ev }, extra));
}
const gefahrPlanen = (game, R, ev) => laufendEintragen(game, R, ev, { notruf: false });   // Patrouille, Piraten: nur die Vorwarnzeit zum Vorbereiten, kein Ruf
const notrufGefahrPlanen = (game, R, ev) => laufendEintragen(game, R, ev, { notruf: true });   // Notruf mit Gefahr: Ruf und Dank erst nach dem Kampf
function ausloesenKontakt(game, ev) {   // patrouille, piraten
  const R = zustandVon(game), e = eintrag(ev.id);
  funk(game, textFuer(ev, 'ankuendigung', game));
  chronik(game, ev);
  if (e.gefahr) gefahrPlanen(game, R, ev);
  else { folgeBuchen(game, e); FA().anbieten(game, ev); }
}
function ausloesenNotruf(game, ev) {
  const R = zustandVon(game);
  funk(game, textFuer(ev, 'ankuendigung', game));
  chronik(game, ev);
  if (ev.sim) return;   // die Sim kennt den Notruf (Marke, Feldzug); beim Eintreffen gilt ihre Szene
  R.offen.push({ nr: ev.nr, id: ev.id, hex: ev.hex, bis: R.n + WERTE.notruf_gilt_spruenge, marke: 'reise:n' + ev.nr, ev });
  try { const f = Marken.setze(game, { id: 'reise:n' + ev.nr, typ: 'notruf', hex: ev.hex, ticks: WERTE.notruf_marke_ticks }); if (f && game.countError) game.countError('reise-marke', new Error(f)); } catch (err) { if (game.countError) game.countError('reise-marke', err); }
}
const AUSLOESER = { funkmeldung: ausloesenFunkmeldung, patrouille: ausloesenKontakt, piraten: ausloesenKontakt, notruf: ausloesenNotruf };
function ausloesen(game, ev) {
  const f = AUSLOESER[ev && ev.art];
  if (!f) return;
  try { f(game, ev); } catch (err) { if (game.countError) game.countError('reise-ausloesen', err); }
}

// SUND-04a-1 B: ein bewältigter Notruf hat eine Person am Ausgang: Hook für die Geschichtsfäden (faden.ausgangMitPerson; ohne Schalter FAEDEN=1 tut er nichts, additiv, wirft nie)
function notrufMitPerson(game, e, ev) {
  try { require('./faden.js').ausgangMitPerson(game, { art: 'notruf', id: ev.id, hex: ev.hex, sprecher: (e && e.sprecher) || '', ausgang: 'gelungen' }); } catch (err) { if (game.countError) game.countError('reise-faden', err); }
}

// Die Lerche trifft beim offenen Notruf ein: Funk, bei Gefahr der Vorlauf (Ankündigung zuerst), sonst sofort Folge und Dank
function notrufBeantworten(game, R, o) {
  const e = eintrag(o.id);
  if (game.simSzene) {   // zwei Kämpfe übereinander gibt es nicht: der Notruf bleibt offen, bis die Szene vorbei ist
    funk(game, { von: 'Aufklärung', text: WERTE.hinweis_szene });
    return;
  }
  Marken.entferne(game, o.marke);
  R.offen.splice(R.offen.indexOf(o), 1);
  funk(game, textFuer(o.ev, 'eintreffen', game));
  Chronik.eintragen(game, { art: 'reise', ref: o.id, kurz: `Notruf bei ${hexName(o.hex)} beantwortet`, param: { art: 'notruf', hex: o.hex } });
  if (e.gefahr) notrufGefahrPlanen(game, R, o.ev);
  else { folgeBuchen(game, e); funk(game, textFuer(o.ev, 'dank', game)); FA().anbieten(game, o.ev); }
  if (!e.gefahr) notrufMitPerson(game, e, o.ev);   // SUND-04a-1 B: bewältigt (ohne Gefahr: gleich beim Eintreffen)
}
function notrufVerfaellt(game, R, o, text) {
  Marken.entferne(game, o.marke);
  R.offen.splice(R.offen.indexOf(o), 1);
  Chronik.eintragen(game, { art: 'reise', ref: o.id, kurz: `Notruf bei ${hexName(o.hex)} ${text}`, param: { art: 'notruf', hex: o.hex } });
}
function ablehnen(game, nr) {
  const R = zustandVon(game);
  const o = R && R.offen.find((x) => x.nr === nr);
  if (!o) return false;
  notrufVerfaellt(game, R, o, 'abgelehnt');   // Ablehnen kostet nichts: keine Wirkung, kein Ruf
  return true;
}

// Mitten in einem Schnellsprung (nicht der letzte Hop) fliegt die Lerche durch: ein offener Notruf gilt dann nicht als beantwortet
function durchflug(game) {
  const r = game.reise;
  return !!r && !r.abbruch && r.i < r.hops.length - 1;
}

// Ein Sprung ist geschehen (dest = Ort der Ankunft; die Szene steht schon). -> das Ereignis dieses Sprungs { id, art, kurz } | null
function nachSprung(game, dest) {
  if (!aktiv(game)) return null;
  const R = zustandVon(game);
  zaehleSprung(game);
  FA().nachSprung(game);   // SUND-03b A: ein offenes Funk-Angebot verfällt nach antwort_gilt_spruenge Sprüngen
  const hex = Sektoren.hexVonOrt(dest);
  for (const o of R.offen.slice()) if (o.bis < R.n) notrufVerfaellt(game, R, o, 'unbeantwortet');   // verfallen ohne Folgen
  const offen = hex && !durchflug(game) && R.offen.find((o) => o.hex === hex);
  if (offen) { notrufBeantworten(game, R, offen); return null; }   // die Antwort auf einen Notruf ist kein neues Ereignis (und bricht den Schnellsprung nicht ab)
  const ev = entscheiden(game, hex);
  if (!ev) return null;
  ausloesen(game, ev);
  return { id: ev.id, art: ev.art, kurz: kurzVon(ev) };
}

// ---------- Laufende Gefahren (Vorlauf, Eintreffen, Bewältigung)
function eintreffen(game, L) {
  const e = eintrag(L.id), sc = e.parameter.schiffe, ship = game.ship;
  const verbunden = (game.players || []).filter((q) => q.connected).length;
  const n = Math.max(sc.min, Math.min(sc.max, verbunden + WERTE.jaeger_je_spieler));
  const rng = strom(seedVon(game), L.nr, 'gegner');
  const w0 = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = w0 + (i - (n - 1) / 2) * 0.35;
    const g = space().spawnEnemy(game, sc.art, { x: ship.x + Math.cos(a) * WERTE.abstand_gegner, y: ship.y + Math.sin(a) * WERTE.abstand_gegner, facing: a + Math.PI, tag: L.tag });
    if (g) g.eingesprungen = true;
  }
  L.phase = 'kampf';
  funk(game, textFuer(L.ev, 'eintreffen', game));
}
function update(game, dt) {   // eslint-disable-line no-unused-vars
  FA().update(game);   // SUND-03b A: Reaktion des Sprechers, Angebot in unruhiger Lage zurückziehen
  try { require('./faden-p3.js').update(game); } catch (e) { if (game.countError) game.countError('faden-p3-update', e); }   // SUND-04a-2 P3: die Ankunft am Ort beendet einen Notruf
  try { require('./faden-b1.js').update(game); } catch (e) { if (game.countError) game.countError('faden-b1-update', e); }   // SUND-04b B1: Ankunft bei Gerücht und Wiedersehen, Fortgang der Rätsel-Spur
  try { require('./faden-b2.js').update(game); } catch (e) { if (game.countError) game.countError('faden-b2-update', e); }   // SUND-04b B2: Erfolg oder Verlust des Ziels eines Sabotage-Auftrags
  try { require('./faden-bitte.js').update(game); } catch (e) { if (game.countError) game.countError('faden-bitte-update', e); }   // SUND-04a-2 P2: Bitte in unruhiger Lage zurückziehen (ohne Folge)
  const R = game.weltsim && game.weltsim.reise;
  if (!R || !R.laufend.length) return;
  for (const L of R.laufend.slice()) {
    const weg = () => R.laufend.splice(R.laufend.indexOf(L), 1);
    if (game.ship.scene !== L.szene || R.n !== L.sprung) { weg(); continue; }   // jeder weitere Sprung (in jeder Phase, auch zurück in dieselbe Szene) beendet die Gefahr: weder Gegner noch Ruf noch Dank
    if (L.phase === 'erwartet') { if (game.simSzene || game.fadenSzene) L.ab = Math.max(L.ab, game.time + 1); else if (game.time >= L.ab) eintreffen(game, L); continue; }   // keine zwei Kämpfe übereinander: der Vorlauf wartet auf das Ende der Sim-Szene und einer Faden-Szene (SUND-04a-2 Nacharbeit L1)
    if (!((game.space && game.space.enemies) || []).some((g) => g.tag === L.tag)) {   // bewältigt
      weg();
      if (L.notruf) { folgeBuchen(game, eintrag(L.id)); funk(game, textFuer(L.ev, 'dank', game)); notrufMitPerson(game, eintrag(L.id), L.ev); }
    }
  }
}

// SUND-04a-2 Nacharbeit L1: gibt es eine laufende Reise-Gefahr (angekündigt oder im Kampf) in der aktuellen Szene? Faden-Szenen starten nie darüber (faden-szene.js frei), und der Kampf
// einer Reise-Gefahr zählt für die Spontanhilfe der Fäden als Gefecht. Veraltete Einträge (anderer Sprung, andere Szene) zählen nicht: update räumt sie erst im nächsten Takt ab.
function gefahrAktuell(game) {
  const R = game && game.weltsim && game.weltsim.reise;
  if (!R || !R.laufend || !game.ship) return [];
  return R.laufend.filter((L) => L.szene === game.ship.scene && L.sprung === R.n);
}
const gefahrLaeuft = (game) => gefahrAktuell(game).length > 0;
const gefahrKampf = (game) => gefahrAktuell(game).find((L) => L.phase === 'kampf') || null;

// ---------- Weltstand welt.sim.reise
function toSave(ws) {
  const R = ws && ws.reise;
  if (!R || !R.n) return null;
  const b = { n: R.n };
  if (R.letzter != null) b.letzter = R.letzter;
  if (R.letzte.length) b.letzte = R.letzte.map((x) => ({ id: x.id, k: x.k, n: x.n }));
  const rl = R.rufLog.filter((x) => R.n - x[0] < RUF_FENSTER);
  if (rl.length) b.r = rl.map((x) => [x[0], x[1]]);
  return b;
}
function lesen(b) {
  const R = neu();
  if (!b || typeof b !== 'object' || Array.isArray(b)) return R;
  if (Number.isFinite(b.n) && b.n >= 0) R.n = Math.min(1e9, Math.floor(b.n));   // klemmen: kein Müllwert, der den Zähler sprengt
  if (Number.isFinite(b.letzter) && b.letzter >= 0) R.letzter = Math.min(Math.floor(b.letzter), R.n);
  if (Array.isArray(b.r)) R.rufLog = b.r.filter((x) => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= 0 && x[0] <= R.n && R.n - x[0] < RUF_FENSTER && Number.isFinite(x[1]) && x[1] > 0 && x[1] <= 20).map((x) => [x[0], x[1]]).slice(-20);
  if (Array.isArray(b.letzte)) {
    for (const x of b.letzte) {
      if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !eintrag(x.id) || typeof x.k !== 'string' || x.k.length > 80 || !Number.isFinite(x.n) || x.n < 0) continue;
      R.letzte.push({ id: x.id, k: x.k, n: Math.min(Math.floor(x.n), R.n) });
    }
    R.letzte = R.letzte.slice(-WERTE.wiederholung.ring);
  }
  return R;
}

module.exports = { gefahrLaeuft, gefahrKampf, gruendeBuchen, rufRaum, eintrag, hexName, folgeBuchen, abstandFrei, voreinstellungAn, KATALOG, WERTE, ARTEN, ABSTAND_HART, neu, aktiv, zaehleSprung, entscheiden, ausloesen, nachSprung, abfangenVermerken, update, textFuer, ablehnen, toSave, lesen, strom, umkreis, parameterFuer, kandidaten };
