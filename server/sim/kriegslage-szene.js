'use strict';
// SUND-02a A2: Sim-Szene – die Crew greift in eine Flottenbegegnung der Weltsimulation ein (Modus Freie Fahrt Sund, game.weltsim).
// Action-Layer wie kriegslage.js. Die Szene enthält KEINE Sim-Logik: sie liest den Zustand (Wahrheit des Servers, nicht das Wissen von Rom) und stellt
// ihn dar; zurück gehen nur Wirkungen aus dem Katalog (server/weltsim/wirkungen.js) über Kriegslage.szeneAbschliessen / wirkungenVormerken.
//
//   betreten(game, hex)        Auslöser: Hook am Ende von Space.enterScene (jede Ankunft, nie ein Tick). -> Szene | null
//   angriffStarten(game, hex)  SUND-02b A2: Auslöser durch die CREW (Halteprozess weapons.posten.angreifen, server/sim/posten.js), nie durch Ankunft: Szene modus 'angriff' gegen den Posten eines Gegners. -> Szene | null
//   verratStarten(game)        SUND-02b E: Auslöser durch die CREW (Halteprozess weapons.verrat.beginnen, server/sim/verrat.js): Szene wird zum Modus 'verrat' umgeschaltet (Verbündete -> Gegner). -> Szene | null
//   update(game, dt)           Takt der Szene (aus game.step): Vorwarnung, Finale, Sieg, Niederlage
//   ereignis(game, name, data) Hook aus game.missionEvent: enemyKilled (Verluste der Angreifer), allyLost (Verluste der Verteidiger)
//   abbrechen(game, wo)        Flucht per Sprung: Verluste bis dahin als Wirkungen VORMERKEN (der Sprung-Tick ist der eine Tick); Hook in Kriegslage.tick
//   verlassen(game, wo)        Ortswechsel ohne Sprung (Debug): Verluste + genau ein eigener Tick (szeneAbschliessen), nichts bleibt vorgemerkt
//   lage(game, hex)            was die Sim im Hex hat (Angreifer, Verteidiger, Ort), rein lesend
//   letzte(game)               Ergebnis der letzten Szene (Tests, Debug), nicht gespeichert
//   debug(game, args)          nur --debug: szene [staerke] [ger|pirat] [belagerung]
//
// SUND-02b A2 (Posten sprengen, README „Posten sprengen“): S.modus === 'angriff' ist dieselbe Szene mit anderer Herkunft und anderem Ende. Die Crew greift den Posten eines Gegners (ger, pirat) an;
// die Wellen kommen aus der Garnison (Plan.plane, Stärke = Garnison × angreifen.staerke_faktor), römische Flotten im Hex sind Verbündete. SIEG: Rest der Garnison (abwehr_verlust) + posten_gesprengt + Ruf (Sperre am Hex)
// + genau ein Tick. FLUCHT (Sprung): nur anteilige abwehr_verlust, kein Ruf-Abzug (der Angriff ist freiwillig). NIEDERLAGE: Notfallprotokoll wie oben, anteilige abwehr_verlust, kein Ruf-Abzug, die Garnison regeneriert.
// SUND-02b E (Verrat, README „Beschuss auf Rom“): S.modus === 'verrat' ist dieselbe Szene, in der die Crew auf die römischen Verbündeten (es.sim) feuert. Umschaltung statt Treffer-Ziel: die Verbündeten
// verlassen die Liste und kommen als echte Gegner derselben Klasse und Hüllen-Quote zurück (Tag SZENEN_TAG, Flagge ohneBeute, Marke verratS), die Gegner der Szene drehen ab, eine neue Ein-Wellen-Liste trägt sie.
// SIEG (alle ehemaligen Verbündeten vernichtet): anteilige Verluste der römischen Flotte/Abwehr (flotte_verlust, abwehr_verlust) + Ruf verrat_flotte_vernichtet (nur Abzug), genau ein Tick. FLUCHT (Sprung): anteilige Verluste,
// kein weiterer Ruf. NIEDERLAGE (Notfallprotokoll): anteilige Verluste, kein Game Over. Nie Ruf-Ertrag: weder sieg_feld_* noch ort_gehalten_*, keine Marken.
// Regeln (Entscheidungen A2, Details im README „Sim-Szene“):
//  - Auslöser: nur bei der ANKUNFT (enterScene), nie durch einen Tick. Eine feindliche Flotte (ger, pirat; Stärke ≥ 1) im Hex löst die Szene aus; ohne Flotte
//    keine Szene (auch bei Belagerung nicht: ohne Flotte im Hex gibt es nichts darzustellen). Römische Flotten im Hex sind Verbündete. Wer nach einer Szene im
//    Hex bleibt, bekommt keine zweite: erst die nächste Ankunft löst wieder aus. Gedockt (Laden, Debug-Start) gibt es keine Szene; Laden stellt nie eine her.
//  - Szenenzustand (game.simSzene) wird nicht gespeichert und liegt am Schiff, nicht an Spielern.
//  - Ende: SIEG = Flaggschiff gefallen (Rest bricht ab, auch mit Reststärke) -> Verluste + flaggschiff_gefallen (+ ort_gehalten bei Belagerung) + ein Tick.
//    NIEDERLAGE = Notfallprotokoll der Lerche, wenn kein Verteidiger mehr neben ihr lebt (CONFIG.simSzene.notfallBisNiederlage), oder Verteidiger erschöpft (nach Gnadenfrist) -> Verluste + ort_gefallen
//    (Hafen/Posten der Crew-Seite) + ein Tick. ABBRUCH (Flucht per Sprung/Notfallsprung) -> nur Verluste, kein ort_*, kein eigener Tick (Sprung-Tick). Ortswechsel ohne Sprung (Debug) -> nur Verluste + ein eigener Tick.
const fs = require('fs');
const path = require('path');
const Kern = require('../weltsim/kern.js');
const Plan = require('../weltsim/wellenplan.js');
const Zufall = require('../weltsim/zufall.js');
const Flotte = require('./flotte.js');
const Escort = require('./escort.js');
const Kriegslage = require('./kriegslage.js');
const Besitz = require('./besitz.js');
const Ruf = require('./ruf.js');   // SUND-02b B: Ruf-Wirkungen am Szenenende (Regeln stehen in ruf.js, Zahlen in content/welt/ruf-werte.json)
const KT = require('../../public/js/karte-tokens.js');   // Stärkenamen (wie Wissen von Rom, kriegslage-wissen.js)
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');
const Verrat = require('./verrat.js');   // SUND-02b E: Texte und Daten des Verrats
const Posten = require('./posten.js');   // SUND-02b A2: Ruf-Regel der Sprengung (Sperre am Hex)
const Chronik = require('./chronik.js');   // SUND-03 D: der Ausgang jeder Szene steht in der Chronik
const ANGRIFF = require('../../content/welt/posten-werte.json').werte.angreifen.wert;   // SUND-02b A2: Vorlauf und Stärkefaktor des Angriffs (Daten)

const TEXTE_FILE = path.join(__dirname, '..', '..', 'content', 'flotte', 'sim-szene.json');
const FEIND_VON = 'rom';   // die Crew spielt für Rom: Gegner sind alle, die zu Rom feindlich sind (ger, pirat)
const AUSLOESER_BEFEHLE = ['angriff', 'anspruch', 'rueckzug'];   // Flotten im Feld (wie BEFEHLE_FELD in weltsim/kern.js); 'heim' und 'sammeln' stehen im eigenen Hafen
const SZENEN_TAG = 'sim_szene';   // Spawn-Tag der Gegner dieser Szene (Flotte.wellenStartAusPlan)
const DEBUG_STAERKE_MAX = 200;   // Debug `szene <staerke>`: darüber wäre der Plan nur noch eine Last für den Server
const r2 = (v) => Math.round(v * 100) / 100;
const r2ab = (v) => Math.floor(v * 100 + 1e-9) / 100;   // abgerundet: nie mehr als der Pool hat (der Prüfer von abwehr_verlust lehnt Rundung nach oben ab)
const cfg = (game) => game.C.simSzene || {};
const hypot = Math.hypot;

let texteCache = null;
function texte() {
  if (texteCache) return texteCache;
  try { texteCache = JSON.parse(fs.readFileSync(TEXTE_FILE, 'utf8')); } catch (e) { texteCache = {}; }
  return texteCache;
}
const fmt = (t, v) => Flotte.fmt(t, v);
// SUND-02a Client-Runde M1: Szenenfunk läuft über den Lagefunk-Pfad (lage: 1 wie bei Kriegslage-Wissen): an jeder Konsole (Lagefunk-Tafel), im Funk-Reiter des
// Captains (KarteLage.funkMerken) und im Logbuch. Die normale Funk-Einblendung zeigt an Konsolen nur Missionsfunk mit Annahme, deshalb sah dort niemand die Szene.
// Reiter/Logbuch (Fixrunde S1/S2): sz: 1 = Szenenfunk; r: 1 = wichtig (Vorwarnung, Ergebnis): nur diese Meldungen kommen in den Funk-Reiter des Captains, die übrigen
// (Verteidiger, Finale, Gnadenfrist, Grund) sieht man an der Konsole. Logbuch: nur o.log (kurzer Text OHNE Ortsnamen, das Logbuch setzt ihn selbst davor).
function funk(game, text, o) {
  if (!text) return;
  const von = texte().sprecher || 'Aufklärung';
  game.emit('radio', Object.assign({ from: von, text: String(text), lage: 1, sz: 1 }, o && o.reiter ? { r: 1 } : {}, o && o.kz ? { kz: String(o.kz) } : {}));
  try { if (game.explore && o && o.log) game.explore.addLog(String(o.log), game.ship.scene, null); } catch (e) { if (game.countError) game.countError('sim-szene-log', e); }
}
// s: Ergebniszeile „SIEG · …“/„NIEDERLAGE · …“ in der Szenenzeile nach dem Ende (CONFIG.simSzene.endeAnzeige, Standard 6)
const endeAnzeige = (game) => (Number(cfg(game).endeAnzeige) > 0 ? Number(cfg(game).endeAnzeige) : 6);
// Szenen-ODA (Ortung/Erste Welle) nach dem Ende wegräumen: der Client entfernt sie aus der ODA-Warteschlange
const endeAufraeumen = (game) => game.emit('odaWeg', {});

// ---------- Lage: was die Sim im Hex hat ----------
const nachStaerke = (a, b) => b.staerke - a.staerke || a.id - b.id;
function wirksamFaktor(z, d, hex, fl) {
  const nd = z.hexe[hex]; let bonus = 0;
  if (nd.besitzer === fl.fraktion) {
    const h = d.hex[hex].hafen;
    bonus = h !== '' ? (z.werte.bonus[h] || 0) : (nd.posten ? z.werte.bonus.P || 0 : 0);
  }
  return (fl.versorgung == null ? 1 : fl.versorgung) * (1 + bonus);
}
// -> null (keine Szene) | { hex, ort: 'hafen'|'posten'|null, fraktion, angreifer: [{ id, fraktion, staerke }], summe, verteidiger: [{ typ: 'flotte'|'abwehr', id?, staerke, eff }], punkte }
function lage(game, hex) {
  const ws = game.weltsim;
  if (!ws || !hex || !ws.zustand.hexe[hex]) return null;
  const z = ws.zustand; const d = Kern.datenVon(z); const nd = z.hexe[hex];
  const hier = z.flotten.filter((f) => f.ort === hex);
  // Angreifer: die stärkste feindliche Fraktion im Hex (Flotten mit Stärke ≥ 1); andere feindliche Fraktionen kämpfen weiter nur in der Sim.
  // Nur Flotten im Feld (Marsch oder Belagerung) lösen eine Szene aus; die Heimatflotte im eigenen Hafen (befehl 'heim', auch beim Sammeln) nicht (Kai, 2026-10-23).
  const feind = hier.filter((f) => Kern.feindlich(f.fraktion, FEIND_VON) && f.staerke >= 1 && AUSLOESER_BEFEHLE.includes(f.befehl));
  if (!feind.length) return null;
  const summen = {};
  for (const f of feind) summen[f.fraktion] = (summen[f.fraktion] || 0) + f.staerke;
  const fraktion = Object.keys(summen).sort((a, b) => summen[b] - summen[a] || (a < b ? -1 : 1))[0];
  const angreifer = feind.filter((f) => f.fraktion === fraktion).sort(nachStaerke).map((f) => ({ id: f.id, fraktion: f.fraktion, staerke: f.staerke }));
  const summe = angreifer.reduce((s, f) => s + f.staerke, 0);
  const hafen = d.hex[hex].hafen !== '';
  const ort = nd.besitzer === FEIND_VON && (hafen || nd.posten) ? (hafen ? 'hafen' : 'posten') : null;
  const verteidiger = [];
  for (const f of hier.filter((x) => x.fraktion === FEIND_VON && x.staerke > 0).sort(nachStaerke)) {
    verteidiger.push({ typ: 'flotte', id: f.id, staerke: f.staerke, eff: f.staerke * wirksamFaktor(z, d, hex, f) });
  }
  if (ort) { const pool = hafen ? nd.abwehr : nd.garnison; if (pool > 0) verteidiger.push({ typ: 'abwehr', staerke: pool, eff: pool }); }
  const punkte = verteidiger.reduce((s, g) => s + g.eff, 0);
  return { hex, ort, fraktion, angreifer, summe, verteidiger, punkte };
}

// ---------- Umrechnung Verteidiger: Punkte -> höchstens `max` Schiffe ----------
// Je Platz die größte Klasse, deren Punktwert höchstens der gerundeten Restpunkte je freiem Platz entspricht (Mischung statt lauter Kreuzer); mehr Punkte
// als max × größte Klasse gehen nicht in mehr Schiffe, sondern in gröbere Auflösung (der Verlust eines Schiffs zählt dann anteilig mehr, siehe verlustAnteil).
function schiffeFuer(game, punkte, max) {
  const P = game.C.wellenplan.punkte;
  const klassen = Object.keys(P).filter((k) => P[k] > 0 && game.C.flotte.hull[k]).sort((a, b) => P[b] - P[a]);
  if (!klassen.length) return [];
  let rest = Math.round(Math.min(punkte, max * P[klassen[0]]));
  const out = [];
  while (rest > 0 && out.length < max) {
    const frei = max - out.length;
    const ideal = Math.ceil(rest / frei);
    const k = klassen.find((c) => P[c] <= ideal && P[c] <= rest) || klassen.filter((c) => P[c] <= rest).pop();
    if (!k) break;
    out.push(k); rest -= P[k];
  }
  return out;
}

// ---------- Verluste -> Punkte ----------
// ganze Punkte proportional zur Stärke; der Rest nach größtem Bruchteil (Gleichstand: kleinere Flottennummer), nie mehr als die Flotte hat
function verteile(punkte, flotten) {
  const out = {};
  const summe = flotten.reduce((s, f) => s + f.staerke, 0);
  if (!(punkte > 0) || !(summe > 0)) return out;
  const roh = flotten.map((f) => ({ id: f.id, cap: f.staerke, roh: punkte * f.staerke / summe, p: 0 }));
  let rest = punkte;
  for (const r of roh) { r.p = Math.min(Math.floor(r.roh), r.cap); rest -= r.p; }
  roh.sort((a, b) => ((b.roh - Math.floor(b.roh)) - (a.roh - Math.floor(a.roh))) || a.id - b.id);
  for (const r of roh) { if (rest <= 1e-9) break; const add = Math.min(1, rest, r.cap - r.p); if (add > 1e-9) { r.p += add; rest -= add; } }
  for (const r of roh) if (r.p > 0) out[r.id] = r2(r.p);
  return out;
}
const flotteMit = (z, id) => z.flotten.find((f) => f.id === id) || null;
// Anteil des Verteidigers, der verloren ist (Schiffspunkte der zerstörten Schiffe / Schiffspunkte aller Schiffe, 0..1)
const verlustAnteil = (S) => (S.vert.ges > 0 ? Math.min(1, S.vert.verloren / S.vert.ges) : 0);

function verlustWirkungen(game, S) {
  const z = game.weltsim.zustand; const w = [];
  const live = S.angreifer.map((a) => ({ id: a.id, staerke: (flotteMit(z, a.id) || { staerke: 0 }).staerke })).filter((a) => a.staerke > 0);
  const teil = verteile(S.killPunkte, live);
  for (const a of live) if (teil[a.id] > 0) w.push({ typ: 'flotte_verlust', flotte: a.id, punkte: teil[a.id] });
  let f = verlustAnteil(S);
  if (S.modus === 'verrat' && S.vert.ges > 0) {   // SUND-02b E: Verluste VOR der Umschaltung (Germanen) gelten voll wie ohne Verrat; nur die danach durch die Crew vernichteten Punkte gehen mit verlust.faktor ein (Daten, Stellschraube gegen die Bänder; Review E: sonst schützte der Verrat Rom)
    const v0 = Math.min(1, (S.vert.verloren0 || 0) / S.vert.ges);
    f = v0 + (f - v0) * Verrat.faktor();
  }
  if (f > 0) {
    for (const g of S.vert.gruppen) {
      if (g.typ === 'flotte') {
        const fl = flotteMit(z, g.id); if (!fl) continue;
        const p = r2(Math.min(fl.staerke, g.staerke * f));
        if (p >= 0.01) w.push({ typ: 'flotte_verlust', flotte: g.id, punkte: p });
      } else {
        const nd = z.hexe[S.hex]; const cur = Kern.datenVon(z).hex[S.hex].hafen !== '' ? nd.abwehr : nd.garnison;
        const p = r2(Math.min(cur, g.staerke * f));
        if (p >= 0.01) w.push({ typ: 'abwehr_verlust', ort: S.hex, punkte: p });
      }
    }
  }
  if (S.modus === 'angriff') {   // SUND-02b A2: die Garnison verliert anteilig, was die Crew an Gegnerpunkten vernichtet hat (Flucht, Niederlage); der Sieg nimmt den Rest (angriffSieg)
    const nd = z.hexe[S.hex];
    if (nd && nd.posten && S.planPunkte > 0 && S.killPunkte > 0) {
      const p = r2ab(Math.min(nd.garnison, S.garn0 * Math.min(1, S.killPunkte / S.planPunkte)));
      if (p >= 0.01) w.push({ typ: 'abwehr_verlust', ort: S.hex, punkte: p });
    }
  }
  return w;
}
// nur Wirkungen, die der Prüfer gegen den jetzigen Zustand annimmt (Szene baut nichts, was die Sim sicher ablehnt)
function gueltige(game, liste) { const z = game.weltsim.zustand; return liste.filter((wk) => Kern.pruefeWirkung(z, wk).ok); }

// ---------- Aufräumen ----------
function aufraeumen(game, S) {
  const sp = game.space;
  if (sp && sp.escorts) {
    sp.escorts = sp.escorts.filter((q) => q.sim !== S.id);
    if (sp.escortsGone) sp.escortsGone = sp.escortsGone.filter((g) => !String(g.tag || '').startsWith('sz' + S.id + '_'));
  }
  if (game.flotte) { Flotte.beenden(game); game.flotte = null; }   // in Freie Fahrt gehört der Flottenzustand der Szene
  // die übrigen Gegner DER SZENE (Spawn-Tag SZENEN_TAG) drehen ab und verlassen das Feld (sichtbar, höchstens ~14 s); die Rückzugsregel gilt nur für diese Gegner, nicht für spätere.
  // Gegner anderer Herkunft (z. B. der Hinterhalt eines Notrufs im selben Hex) bleiben: ihr Verschwinden würde sonst als „erledigt“ zählen (Lohn ohne Kampf, zweiter Tick).
  try { Escort.retreat(game, { tag: SZENEN_TAG }); delete game.space.retreatRule; } catch (e) { if (game.countError) game.countError('sim-szene-retreat', e); }
  game.simSzene = null;
}
function merken(game, S, ausgang, wirkungen, extra) {
  const ws = game.weltsim;
  game.simSzeneLetzte = Object.assign({ id: S.id, hex: S.hex, ausgang, tick: ws ? ws.tickZahl : null, wirkungen: wirkungen.map((x) => Object.assign({}, x)), kills: Object.assign({}, S.kills), killPunkte: S.killPunkte }, extra || {});
  chronikEintrag(game, S, ausgang);
}
// SUND-03 D: Ausgang der Szene (Sieg, Niederlage, Flucht) als kurzer Chronik-Eintrag; ein gescheiterter End-Tick (gestoert) gilt nicht
const AUSGANG_WORT = { sieg: 'Sieg', niederlage: 'Niederlage', abbruch: 'Flucht' };
const MODUS_WORT = { angriff: 'Angriff auf Posten', verrat: 'Verrat' };
function chronikEintrag(game, S, ausgang) {
  if (!AUSGANG_WORT[ausgang]) return;
  const modus = MODUS_WORT[S.modus] ? ` (${MODUS_WORT[S.modus]})` : '';
  Chronik.eintragen(game, { art: 'szene', ref: 's' + S.id, kurz: `${AUSGANG_WORT[ausgang]} bei ${S.ortName || S.hex}${modus}`, param: { ausgang, fraktion: S.fraktion || '', hex: S.hex } });
}

// ---------- Ende der Szene ----------
// R-S3: Scheitert der End-Tick (Kern.tick wirft, Rollback; oder kein Modus), steht die Welt wie vorher: der Ausgang gilt nicht. Weder Ergebnismeldung noch Ergebniszeile (simSzeneEnde, wird vor dem Tick
// gesetzt, damit der Tick es schon sieht); die Störungs-ODA kommt aus Kriegslage.tickMit. Die Szene selbst ist beendet (aufgeräumt), das Ergebnis wird nur als „gestoert“ vermerkt.
function gescheitert(game, S, gewollt, wirkungen, r) {
  game.simSzeneEnde = null;
  merken(game, S, 'gestoert', wirkungen, { gewollt, ergebnis: { ok: false, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}
function sieg(game, S) {
  if (S.modus === 'angriff') return angriffSieg(game, S);
  if (S.modus === 'verrat') return verratSieg(game, S);
  S.phase = 'ende';
  const z = game.weltsim.zustand;
  const kd = S.kommandant;
  const schicksal = schicksalWahl(game, S);
  const w = verlustWirkungen(game, S);
  for (const a of S.angreifer) if (flotteMit(z, a.id)) w.push(Object.assign({ typ: 'flaggschiff_gefallen', flotte: a.id }, kd ? { kommandant: { name: kd.name, schicksal } } : {}));   // alle Flotten des Angreifers brechen ab; ohne echten Kommandanten kein Gedächtniseintrag
  if (S.ort) w.push({ typ: 'ort_gehalten', ort: S.hex });
  w.push(...Ruf.szeneSieg(S, w.some((x) => x.typ === 'ort_gehalten' && Kern.pruefeWirkung(z, x).ok)));   // SUND-02b B: Ruf für den Sieg (Feld klein, gehaltener Ort groß); ort_gehalten zählt nur, wenn die Sim es annimmt (laufende Belagerung)
  const wirk = gueltige(game, w);
  const T = texte();
  const text = kd ? fmt(((T.sieg || {})[schicksal]), { kommandant: kd.name }) : (T.sieg || {}).ohneKommandant;
  aufraeumen(game, S);
  game.simSzeneEnde = { bis: game.time + endeAnzeige(game), szene: game.ship.scene, p: 's', o: S.ort ? S.ortName : null };
  // M2: erst der Tick (sein Wissens-Funk darf nicht obenauf landen; direkt: Rom sieht das Hex jetzt, kein „wird belagert“ nach dem abgewehrten Angriff), dann die Szenenmeldungen.
  // Die zuletzt gesendete Lagemeldung steht an der Konsole obenauf; die mit dem Kommandanten soll oben stehen.
  const r = Kriegslage.szeneAbschliessen(game, { wirkungen: wirk, wo: 'szene', direkt: S.hex, stumm: S.hex });
  endeAufraeumen(game);
  if (!r.ok) return gescheitert(game, S, 'sieg', wirk, r);   // R-S3: die Welt hat den Ausgang verworfen (Rollback): keine Meldung, keine Ergebniszeile
  if (S.ort) funk(game, fmt((T.sieg || {}).ort, { ort: S.ortName }));
  funk(game, text, { reiter: 1, log: (T.log || {})[S.ort ? 'siegOrt' : 'sieg'] });
  merken(game, S, 'sieg', wirk, { schicksal, ergebnis: { ok: r.ok, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}
function niederlage(game, S, grund) {
  if (S.modus === 'angriff') return angriffNiederlage(game, S, grund);
  if (S.modus === 'verrat') return verratNiederlage(game, S, grund);
  S.phase = 'ende';
  const w = verlustWirkungen(game, S);
  if (S.ort) w.push({ typ: 'ort_gefallen', ort: S.hex, an: S.fraktion });   // der Prüfer lehnt ab, was nicht gilt: Piraten erobern keinen Hafen, und ohne laufende Belagerung (durchziehende Flotte) fällt nichts
  const wirk = gueltige(game, w);
  const gefallen = wirk.some((x) => x.typ === 'ort_gefallen');
  const T = texte();
  aufraeumen(game, S);
  game.simSzeneEnde = { bis: game.time + endeAnzeige(game), szene: game.ship.scene, p: 'n', o: gefallen ? S.ortName : null };
  // M2: Tick zuerst; stumm: der Wissens-Funk „… ist gefallen“ entfällt (die Szene meldet „… ist verloren“ selbst, keine Doppelmeldung); Ergebnis zuletzt = oben
  const r = Kriegslage.szeneAbschliessen(game, { wirkungen: wirk, wo: 'szene', direkt: S.hex, stumm: S.hex });
  endeAufraeumen(game);
  if (!r.ok) return gescheitert(game, S, 'niederlage', wirk, r);   // R-S3
  funk(game, (T.niederlage || {})[grund]);
  funk(game, gefallen ? fmt((T.niederlage || {}).ort, { ort: S.ortName }) : (T.niederlage || {}).frei, { reiter: 1, log: (T.log || {})[gefallen ? 'niederlageOrt' : 'niederlage'] });
  merken(game, S, 'niederlage', wirk, { grund, ergebnis: { ok: r.ok, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}
// SUND-02b A2: Sieg gegen den Posten: Verbündete verlieren anteilig, die Garnison ganz (abwehr_verlust), dann posten_gesprengt (der Prüfer läuft der Reihe nach, Kern.filtereWirkungen), Ruf nur wenn die Sprengung gilt
// und der Hex nicht in der Sperre liegt; genau ein Tick (szeneAbschliessen), atomar mit Rollback.
function angriffSieg(game, S) {
  S.phase = 'ende';
  const z = game.weltsim.zustand; const nd = z.hexe[S.hex]; const T = texte(); const A = T.angriff || {};
  const sprengung = { typ: 'posten_gesprengt', ort: S.hex };
  const folge = (nd && nd.garnison > 0 ? [{ typ: 'abwehr_verlust', ort: S.hex, punkte: nd.garnison }] : []).concat([sprengung]);
  const pr = Kern.filtereWirkungen(z, folge);
  const gilt = pr.gueltig.includes(sprengung);
  const sperre = gilt && Posten.sprengungGesperrt(game, S.hex);
  const ruf = gilt ? Posten.sprengungRuf(game, S.hex, S.fraktion) : [];
  const wirk = gueltige(game, verlustWirkungen(game, S).filter((x) => x.typ !== 'abwehr_verlust')).concat(pr.gueltig, ruf);
  aufraeumen(game, S);
  game.simSzeneEnde = { bis: game.time + endeAnzeige(game), szene: game.ship.scene, p: 's', o: null, x: 1 };
  const r = Kriegslage.szeneAbschliessen(game, { wirkungen: wirk, wo: 'szene', direkt: S.hex, stumm: S.hex });
  endeAufraeumen(game);
  if (!r.ok) return gescheitert(game, S, 'sieg', wirk, r);
  const gesprengt = !r.verworfen.some((v) => v.wirkung && v.wirkung.typ === 'posten_gesprengt') && gilt;
  if (!gesprengt) game.simSzeneEnde = null;   // A2-Fix: keine Siegeszeile, wenn der Tick die Sprengung nicht angewandt hat (der Zweig ist mit der Vorabprüfung am selben Zustand nicht erreichbar, siehe README)
  if (gesprengt) {
    funk(game, fmt((A.sieg || {}).text, { ort: S.ortName }), { reiter: 1, log: (A.log || {}).sieg });
    if (sperre) funk(game, fmt((A.sieg || {}).ohneRuf, { ort: S.ortName }));
    game.missionEvent('postenGesprengt', { hex: S.hex, ort: S.ortName });
    if (game.markSaveDue) game.markSaveDue('docked');
  }
  merken(game, S, gesprengt ? 'sieg' : 'abbruch', wirk, { gesprengt, ruf: ruf.length ? ruf[0].delta : 0, sperre, ergebnis: { ok: r.ok, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}
// SUND-02b A2: Niederlage im Angriff: anteilige Verluste der Garnison, kein Ruf-Abzug (freiwilliger Kampf), ein Tick (die Garnison regeneriert dort), kein Game Over.
function angriffNiederlage(game, S, grund) {
  S.phase = 'ende';
  const T = texte(); const A = T.angriff || {};
  const wirk = gueltige(game, verlustWirkungen(game, S));
  aufraeumen(game, S);
  game.simSzeneEnde = { bis: game.time + endeAnzeige(game), szene: game.ship.scene, p: 'n', o: null, x: 1 };
  const r = Kriegslage.szeneAbschliessen(game, { wirkungen: wirk, wo: 'szene', direkt: S.hex, stumm: S.hex });
  endeAufraeumen(game);
  if (!r.ok) return gescheitert(game, S, 'niederlage', wirk, r);
  funk(game, (T.niederlage || {})[grund]);
  funk(game, (A.niederlage || {}).frei, { reiter: 1, log: (A.log || {}).niederlage });
  merken(game, S, 'niederlage', wirk, { grund, ergebnis: { ok: r.ok, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}
// SUND-02b E: Sieg im Verrat: die ehemaligen Verbündeten sind vernichtet. Verluste der römischen Seite anteilig (verlustWirkungen: alle Punkte der Verteidiger sind verloren, also die ganze Flotte/Abwehr, die
// Sim begrenzt auf Stärke 0,5 und Rückzug), Ruf nur als Abzug (verrat_flotte_vernichtet), KEIN sieg_feld_*/ort_gehalten_* (kein Ruf-Ertrag), genau ein Tick (szeneAbschliessen), atomar mit Rollback.
function verratSieg(game, S) {
  S.phase = 'ende';
  const w = verlustWirkungen(game, S).concat(S.verrat.tot > 0 ? Ruf.verratVernichtet() : []);
  const wirk = gueltige(game, w);
  aufraeumen(game, S);
  game.simSzeneEnde = { bis: game.time + endeAnzeige(game), szene: game.ship.scene, p: 's', o: null, vt: 1 };
  const r = Kriegslage.szeneAbschliessen(game, { wirkungen: wirk, wo: 'szene', direkt: S.hex, stumm: S.hex });
  endeAufraeumen(game);
  if (!r.ok) return gescheitert(game, S, 'sieg', wirk, r);
  funk(game, Verrat.text('sieg'), { reiter: 1, log: (Verrat.texte().log || {}).sieg });
  funk(game, Verrat.faktorText());
  merken(game, S, 'sieg', wirk, { verrat: true, ergebnis: { ok: r.ok, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}
// Niederlage im Verrat: anteilige Verluste (was die Crew schon vernichtet hat), kein Ruf, kein ort_gefallen, kein Game Over; die übrigen ehemaligen Verbündeten ziehen ab (aufraeumen: Tag SZENEN_TAG).
function verratNiederlage(game, S, grund) {
  S.phase = 'ende';
  const T = texte();
  const w = verlustWirkungen(game, S);
  if (S.ort) w.push({ typ: 'ort_gefallen', ort: S.hex, an: S.fraktion });   // Review E: der Fall des Orts gilt wie ohne Verrat (der Prüfer lehnt ab, was nicht gilt: ohne laufende Belagerung fällt nichts)
  const wirk = gueltige(game, w);
  aufraeumen(game, S);
  game.simSzeneEnde = { bis: game.time + endeAnzeige(game), szene: game.ship.scene, p: 'n', o: null, vt: 1 };
  const r = Kriegslage.szeneAbschliessen(game, { wirkungen: wirk, wo: 'szene', direkt: S.hex, stumm: S.hex });
  endeAufraeumen(game);
  if (!r.ok) return gescheitert(game, S, 'niederlage', wirk, r);
  funk(game, (T.niederlage || {})[grund]);
  funk(game, Verrat.text('niederlage'), { reiter: 1, log: (Verrat.texte().log || {}).niederlage });
  funk(game, Verrat.faktorText());
  merken(game, S, 'niederlage', wirk, { verrat: true, grund, ergebnis: { ok: r.ok, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}
// Flucht/Verlassen: Verluste vormerken, der folgende Sprung-Tick (Kriegslage.tick) wendet sie an. Kein ort_*, kein eigener Tick.
function abbrechen(game, wo) {
  const S = game.simSzene;
  if (!S || S.phase === 'ende') { game.simSzene = null; return null; }
  const imKampf = S.phase === 'kampf';   // B-Fix 1: Phase merken, bevor sie auf 'ende' geht; ein Sprung in der Vorwarnung (vor dem ersten Schuss) ist keine Fahrerflucht
  S.phase = 'ende';
  const ruf = imKampf && S.modus !== 'angriff' && S.modus !== 'verrat' ? Ruf.szeneFlucht(S, S.ort && Kern.pruefeWirkung(game.weltsim.zustand, { typ: 'ort_gehalten', ort: S.hex }).ok) : [];   // SUND-02b B: Fahrerflucht kostet Ruf (Piraten ignorieren: keine Quelle); B-Fix 2: Ort-Satz nur bei laufender Belagerung, wie beim Sieg
  const w = gueltige(game, verlustWirkungen(game, S).concat(ruf));
  aufraeumen(game, S);
  endeAufraeumen(game);   // H-a: auch die Flucht räumt die Szenen-ODA weg („Erste Welle in 10 s“ liefe sonst im neuen Sektor weiter)
  const r = Kriegslage.wirkungenVormerken(game, w);
  merken(game, S, 'abbruch', w, { wo: wo || null, vorgemerkt: r.vorgemerkt });
  return r;
}
// Ortswechsel OHNE Sprung (nur Debug: debugGoto, debugHex): kein Sprung-Tick folgt, also schließt die Szene selbst ab – Verluste + genau ein Tick (szeneAbschliessen),
// kein ort_*. Bei einem Sprung ist Kriegslage.tick schon vor dem Szenenaufbau gelaufen und hat die Szene über abbrechen() beendet; dann steht hier keine mehr.
function verlassen(game, wo) {
  const S = game.simSzene;
  if (!S || S.phase === 'ende') { game.simSzene = null; return null; }
  S.phase = 'ende';
  const w = gueltige(game, verlustWirkungen(game, S));
  aufraeumen(game, S);
  const r = Kriegslage.szeneAbschliessen(game, { wirkungen: w, wo: 'szene' });
  merken(game, S, 'abbruch', w, { wo: wo || null, ergebnis: { ok: r.ok, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}

// Schicksal des gefallenen Flaggschiffs: deterministisch aus dem Seed der Flotte (nicht aus dem Spielverlauf)
function schicksalWahl(game, S) {
  const p = Number(((cfg(game).schicksal) || {}).entkommen);
  const rng = { zufall: Zufall.startzustand(Plan.seedAus(S.seed, 'schicksal')) };
  return Zufall.zahl(rng) < (Number.isFinite(p) ? p : 0.5) ? 'entkommen' : 'gefallen';
}

// ---------- Auslöser ----------
function ortPunkt(game, S) {
  const loc = Locations.get(game.ship.scene); const sc = (loc && loc.scene) || {};
  if (S.ort === 'hafen' && sc.station) return { x: sc.station.x, y: sc.station.y };
  if (S.ort === 'posten') { const p = Besitz.postenLage(sc); return { x: p.x, y: p.y }; }
  const dock = Besitz.dockLage(game, sc, S.hex);   // SUND-02b A1
  if (S.ort === 'hafen' && dock) return { x: dock.x, y: dock.y };
  const L = game.ship;
  return { x: L.x - Math.cos(L.angle) * 200, y: L.y - Math.sin(L.angle) * 200 };
}
function verteidigerAufstellen(game, S, L) {
  const C = cfg(game); const V = C.verteidiger || {};
  const max = Math.max(1, Number(V.max) || 4);
  S.vert = { gruppen: L.verteidiger.map((g) => ({ typ: g.typ, id: g.id, staerke: g.staerke, eff: g.eff })), schiffe: [], ges: 0, verloren: 0, lebend: 0, n0: 0, erschT: null };
  if (L.punkte <= 0) return;
  const klassen = schiffeFuer(game, L.punkte, max);
  if (!klassen.length) return;
  const P = game.C.wellenplan.punkte; const namen = texte().namen || [];
  const ank = ortPunkt(game, S); const ring = Number(V.abstand) || 260;
  const sc = (Locations.get(game.ship.scene) || {}).scene || {};
  klassen.forEach((kind, i) => {
    const a = (i / klassen.length) * Math.PI * 2 + 0.6;
    const tag = 'sz' + S.id + '_' + i;
    const es = Flotte.aufstellen(game, { tag, kind, name: namen.length ? namen[(S.id * 3 + i) % namen.length] : undefined, rolle: V.rolle || 'angreifer',
      von: { x: Math.max(60, Math.min((sc.w || game.space.w) - 60, ank.x + Math.cos(a) * ring)), y: Math.max(60, Math.min((sc.h || game.space.h) - 60, ank.y + Math.sin(a) * ring)) } });
    if (!es) return;
    const hf = Number(V.huelle) > 0 ? Number(V.huelle) / 100 : 1;   // Hülle der Szenen-Verteidiger in Prozent der Klassenhülle (Eichung gegen die Gegner, CONFIG.simSzene.verteidiger.huelle)
    if (hf !== 1) { es.hpMax = Math.max(1, Math.round(es.hpMax * hf)); es.hp = es.hpMax; }
    es.sim = S.id; es.simPts = P[kind];
    S.vert.schiffe.push(tag); S.vert.ges += P[kind]; S.vert.lebend++; S.vert.n0++;
  });
}
function betreten(game, hex) {
  if (game.simSzene) verlassen(game, 'neu');   // eine alte Szene ragt nie in eine neue hinein (nach einem Sprung ist sie schon weg, siehe verlassen)
  const ws = game.weltsim;
  if (!ws || !hex || !game.ship || game.ship.docked) return null;
  const L = lage(game, hex);
  if (!L) return null;
  const z = ws.zustand;
  const haupt = L.angreifer[0];
  const seed = Plan.seedAus(haupt.id, z.tick);
  const gefallen = Object.keys(ws.kommandanten || {}).filter((n) => ws.kommandanten[n].schicksal === 'gefallen');
  const kd = Plan.kommandantFuer({ fraktion: L.fraktion, seed, gefallen });
  const volk = (kd && kd.volk) || L.fraktion;
  const plan = Plan.plane({ staerke: L.summe, seed, volk, kommandant: kd || { name: texte().ohneKommandant || 'Der Flottenführer', volk, zug: '' } });
  if (!plan.wellen.length) return null;
  const C = cfg(game); const T = texte();
  game.simSzeneN = (game.simSzeneN || 0) + 1;
  game.simSzeneEnde = null;
  const loc = Locations.get(game.ship.scene);
  const S = { id: game.simSzeneN, hex, ort: L.ort, ortName: Sektoren.hexName(hex) || (loc && loc.name) || hex, szene: game.ship.scene, phase: 'vorwarnung',
    klasse: Kern.staerkeKlasse(L.summe, z.werte), fraktion: L.fraktion, angreifer: L.angreifer, summe: L.summe, seed, plan, kommandant: kd, kills: {}, killPunkte: 0, flaggGefallen: false,
    t0: game.time, vorlauf: Number(C.vorwarnung) || 0, erinnern: (C.vorwarnungErinnerung || []).slice().sort((a, b) => b - a), emBasis: game.stats.emergencies || 0, finale: false };
  S.start = S.t0 + S.vorlauf;
  game.simSzene = S;
  verteidigerAufstellen(game, S, L);
  Flotte.wellenStartAusPlan(game, { plan, volk, ziel: 'auto', richtung: 'alle', tag: SZENEN_TAG, vorlauf: S.vorlauf, restAnteil: C.restAnteil });
  try { Kriegslage.szeneNachziehen(game); } catch (e) { if (game.countError) game.countError('sim-szene-nachziehen', e); }   // Andocken gesperrt, Dock-Marker weg
  // Vorwarnung: Funkspruch mit Stärkeklasse, Fraktion, Kommandant; Zeit bis Welle 1 steht im Text und im Hinweis (ODA)
  const klasse = (T.klassen || {})[Kern.staerkeKlasse(L.summe, z.werte)] || '';
  const fr = (T.fraktionen || {})[L.fraktion] || {};
  const vars = { ort: S.ortName, klasse, flotte: fr.flotte || 'Flotte', kommandant: kd ? kd.name : '', sek: Math.round(S.vorlauf) };
  const vw = T.vorwarnung || {};
  // Reihenfolge (M1): Verteidiger, Hinweis „entkommen“, zuletzt die Vorwarnung mit Fraktion, Stärke und Kommandant – sie steht an der Konsole obenauf
  if (S.vert.n0 > 0) funk(game, fmt((T.verteidiger || {})[L.ort || 'frei'], { ort: S.ortName, n: S.vert.n0 }));
  if (kd && ws.kommandanten && ws.kommandanten[kd.name] && ws.kommandanten[kd.name].schicksal === 'entkommen') funk(game, fmt(vw.entkommen, vars));
  funk(game, fmt(kd ? (L.ort ? vw.ort : vw.frei) : vw.ohneKommandant, vars), { reiter: 1, log: fmt((T.log || {})[kd ? 'vorwarnung' : 'vorwarnungOhne'], vars), kz: fmt(vw.kz, { ort: S.ortName, fraktion: fr.name || '', klasse: KT.staerkeName(Kern.staerkeKlasse(L.summe, z.werte)) }) });
  if (L.fraktion === 'pirat') game.oda(vw.pirat, null);
  game.oda(fmt(vw.hinweis, vars), null);
  return S;
}

// SUND-02b A2: Angriffsszene gegen den Posten eines Gegners. Aufrufer: Posten.haltFertig (Ops-Halteprozess der Crew); der Aufrufer hat Rang, Ring, Tempo, Szene und Gegner schon geprüft.
// Wellen aus der Garnison (nie weniger als 1 Punkt), Verbündete = römische Flotten im Hex, Vorlauf aus den Daten (angreifen.vorlauf). -> Szene | null (kein Posten eines Feindes, kein Plan, kein Modus)
function angriffStarten(game, hex) {
  if (game.simSzene) verlassen(game, 'neu');
  const ws = game.weltsim;
  if (!ws || !hex || !game.ship || game.ship.docked) return null;
  const z = ws.zustand; const d = Kern.datenVon(z); const nd = z.hexe[hex];
  if (!nd || !nd.posten || d.hex[hex].hafen !== '' || !nd.besitzer || !Kern.feindlich(FEIND_VON, nd.besitzer)) return null;
  const fraktion = nd.besitzer;
  const staerke = Math.max(1, nd.garnison * (Number(ANGRIFF.staerke_faktor) || 1));
  const C = cfg(game); const T = texte(); const A = T.angriff || {};
  const seed = Plan.seedAus('angriff', hex, z.tick, (game.simSzeneN || 0) + 1);
  const kd = { name: A.kommandant || T.ohneKommandant || 'Der Flottenführer', volk: fraktion, zug: '' };
  const plan = Plan.plane({ staerke, seed, volk: fraktion, kommandant: kd });
  if (!plan.wellen.length) return null;
  const hier = z.flotten.filter((f) => f.ort === hex && f.fraktion === FEIND_VON && f.staerke > 0).sort(nachStaerke);
  const verteidiger = hier.map((f) => ({ typ: 'flotte', id: f.id, staerke: f.staerke, eff: f.staerke * wirksamFaktor(z, d, hex, f) }));
  const L = { verteidiger, punkte: verteidiger.reduce((s, g) => s + g.eff, 0) };
  game.simSzeneN = (game.simSzeneN || 0) + 1;
  game.simSzeneEnde = null;
  const vorlauf = Math.max(0, Number(ANGRIFF.vorlauf) || 0);
  const S = { id: game.simSzeneN, modus: 'angriff', hex, ort: null, ortName: Sektoren.hexName(hex) || hex, szene: game.ship.scene, phase: 'vorwarnung',
    klasse: Kern.staerkeKlasse(plan.punkte, z.werte), fraktion, angreifer: [], summe: plan.punkte, seed, plan, kommandant: null, kills: {}, killPunkte: 0, flaggGefallen: false,
    garn0: nd.garnison, planPunkte: plan.punkte,
    t0: game.time, vorlauf, erinnern: (C.vorwarnungErinnerung || []).filter((s) => s < vorlauf).sort((a, b) => b - a), emBasis: game.stats.emergencies || 0, finale: false };
  S.start = S.t0 + S.vorlauf;
  game.simSzene = S;
  verteidigerAufstellen(game, S, L);
  Flotte.wellenStartAusPlan(game, { plan, volk: fraktion, ziel: 'auto', richtung: 'alle', tag: SZENEN_TAG, vorlauf: S.vorlauf, restAnteil: C.restAnteil });
  try { Kriegslage.szeneNachziehen(game); } catch (e) { if (game.countError) game.countError('sim-szene-nachziehen', e); }
  const fr = (T.fraktionen || {})[fraktion] || {};
  const klasse = (T.klassen || {})[S.klasse] || '';
  const vars = { ort: S.ortName, klasse, flotte: fr.flotte || 'Flotte', sek: Math.round(S.vorlauf) };
  const vw = A.vorwarnung || {};
  if (S.vert.n0 > 0) funk(game, fmt((T.verteidiger || {}).frei, { ort: S.ortName, n: S.vert.n0 }));
  funk(game, fmt(vw.text, vars), { reiter: 1, log: fmt((A.log || {}).vorwarnung, vars), kz: fmt(vw.kz, { ort: S.ortName, fraktion: fr.name || '', klasse: KT.staerkeName(S.klasse) }) });
  if (fraktion === 'pirat') game.oda(vw.pirat, null);
  game.oda(fmt(vw.hinweis, vars), null);
  return S;
}

// SUND-02b E: Umschaltung der Szene (Aufrufer: Verrat.haltFertig nach bewusster Bestätigung; Phase und Ruf hat der Aufrufer geprüft/bucht er). Die Verbündeten der Szene verlassen die Liste und kommen als Gegner
// derselben Klasse mit derselben Hüllen-Quote zurück (Name bleibt, Kennung rom, keine Beute); die Gegner der Szene drehen ab; eine neue Ein-Wellen-Liste trägt die neuen Gegner (Sieg = Welle fertig).
// Mit eigenem Rollback: wirft etwas, steht die Szene wie vorher. -> Szene | null (keine Verbündeten der Szene, Klasse unbekannt, Fehler)
function verratStarten(game) {
  const S = game.simSzene;
  if (!S || S.phase === 'ende' || S.modus === 'verrat') return null;
  const sp = game.space; const st = Flotte.state(game); const C = game.C;
  const ex = Verrat.verbuendete(game, S);
  if (!ex.length || ex.some((q) => !C.enemies[q.kind])) return null;
  const P = C.wellenplan.punkte; const hmin = Number(Verrat.W.huelle_min.wert);   // Daten, kein Rückfall im Code
  const sicher = { escorts: sp.escorts.slice(), gone: sp.escortsGone ? sp.escortsGone.slice() : null, enemies: sp.enemies.slice(), retreat: sp.retreatRule, welle: st.welle, nachschub: st.nachschub.slice(),
    S: { modus: S.modus, phase: S.phase, finale: S.finale, flaggGefallen: S.flaggGefallen, start: S.start, vert: Object.assign({}, S.vert), emBasis: S.emBasis, verrat: S.verrat, erinnern: S.erinnern } };
  try {
    // 1. neue Ein-Wellen-Liste (Klassen der ehemaligen Verbündeten), Welle 1 ist schon da
    const zaehl = {}; for (const q of ex) zaehl[q.kind] = (zaehl[q.kind] || 0) + 1;
    st.nachschub.length = 0;
    const w = Flotte.wellenStart(game, { wellen: [Object.keys(zaehl).map((kind) => ({ kind, n: zaehl[kind], volk: 'rom' }))], takt: 0, rest: 0, ziel: 'lerche', richtung: 'alle', ueberdruck: false, tag: SZENEN_TAG, volk: 'rom' });
    if (!w) throw new Error('keine Welle');
    w.ohneSkala = true; w.restJe = [0]; w.i = 0; w.n = 1; w.t = game.time;
    // 2. die Gegner: gleiche Klasse, gleiche Hüllen-Quote (Hülle / Hüllenmaximum des Verbündeten), Name und Ort bleiben. Vorläufiger Tag, damit der Rückzug der alten Gegner (Schritt 3) sie nicht erfasst.
    const neue = [];
    for (const q of ex) {
      const e = require('./space.js').spawnEnemy(game, q.kind, { x: q.x, y: q.y, facing: q.angle, tag: SZENEN_TAG + '_verrat', ziel: 'lerche', volk: 'rom' });
      if (!e) throw new Error('Gegner nicht erzeugt');
      neue.push(e);
      Object.assign(e, { wv: w.id, wvN: 1, ohneBeute: true, verratS: S.id, simPts: q.simPts || P[q.kind] || 0, name: q.name });
      e.hp = Math.max(1, Math.round(e.hpMax * Math.min(1, Math.max(hmin, q.hp / (q.hpMax || 1)))));
    }
    // 3. ab hier wirft nichts mehr: die Gegner der Szene drehen ab (sofort; die Regel wird gleich wieder gelöscht), die neuen tragen den Szenen-Tag (das Szenenende lässt sie abziehen)
    Escort.retreat(game, { tag: SZENEN_TAG }); delete sp.retreatRule;
    for (const e of neue) e.tag = SZENEN_TAG;
    for (const e of sp.enemies) if (e.tag === SZENEN_TAG && !e.verratS) e.ohneBeute = true;   // Review E: auch die abziehenden Gegner der Szene geben im Verrat keine Marken (kein lohnendes Ziel)
    // 4. die Verbündeten verlassen die Liste (wie aufraeumen, nur für diese Szene)
    sp.escorts = sp.escorts.filter((q) => q.sim !== S.id);
    if (sp.escortsGone) sp.escortsGone = sp.escortsGone.filter((g) => !String(g.tag || '').startsWith('sz' + S.id + '_'));
    // 5. Szenenzustand: Modus verrat, Kampf (Vorwarnung entfällt), kein Finale-Funk, kein Verteidiger mehr neben der Lerche
    S.vor = S.modus || 'normal'; S.modus = 'verrat';
    S.phase = 'kampf'; S.start = Math.min(S.start, game.time); S.finale = true; S.flaggGefallen = false; S.erinnern = [];
    S.vert.lebend = 0; S.emBasis = game.stats.emergencies || 0;
    S.vert.verloren0 = S.vert.verloren;   // Stand bei der Umschaltung: davor gilt der Faktor nicht
    S.verrat = { t0: game.time, n0: ex.length, tot: 0 };
  } catch (err) {
    sp.escorts = sicher.escorts; if (sicher.gone) sp.escortsGone = sicher.gone;
    sp.enemies = sicher.enemies; if (sicher.retreat) sp.retreatRule = sicher.retreat; else delete sp.retreatRule;
    st.welle = sicher.welle; st.nachschub = sicher.nachschub;
    for (const k of Object.keys(sicher.S)) { if (sicher.S[k] === undefined) delete S[k]; else S[k] = sicher.S[k]; }
    delete S.vor;
    if (game.countError) game.countError('sim-szene-verrat', err);
    return null;
  }
  return S;
}

// ---------- Takt ----------
function update(game, dt) {   // eslint-disable-line no-unused-vars
  const S = game.simSzene;
  if (!S || S.phase === 'ende') return;
  if (game.ship.scene !== S.szene) { verlassen(game, 'verlassen'); return; }   // Ortswechsel ohne Sprung (Debug): die Szene schließt selbst ab
  const C = cfg(game); const T = texte();
  const rest = S.start - game.time;
  if (S.phase === 'vorwarnung') {
    while (S.erinnern.length && rest <= S.erinnern[0]) { S.erinnern.shift(); if (rest > 0) game.oda(fmt((T.vorwarnung || {}).hinweis, { sek: Math.max(1, Math.round(rest)) }), null); }
    if (rest <= 0) S.phase = 'kampf';
  }
  const w = game.flotte && game.flotte.welle;
  if (w && !S.finale && w.i + 1 >= w.liste.length && w.i >= 0) {
    S.finale = true;
    if (S.kommandant) funk(game, fmt(T.finale, { kommandant: S.kommandant.name }));
    else if (S.modus === 'angriff') funk(game, fmt((T.angriff || {}).finale, { kommandant: (T.angriff || {}).kommandant || '' }));
  }
  if (S.flaggGefallen || (w && w.fertig)) { sieg(game, S); return; }   // Flaggschiff gefallen, oder alle Gegner tot
  // Die Lerche unterliegt (Notfallprotokoll): Niederlage nur, wenn kein Verteidiger mehr lebt – mit Verteidigern geht die Schlacht weiter (die Gegner ziehen 10 s ab,
  // wie überall; ein Hafen fällt nicht, solange seine Flotte steht). Das Protokoll zählt erst, wenn niemand mehr neben der Lerche kämpft.
  if (S.vert.lebend > 0) S.emBasis = game.stats.emergencies || 0;
  if ((game.stats.emergencies || 0) >= S.emBasis + Math.max(1, Number(C.notfallBisNiederlage) || 1)) { niederlage(game, S, 'lerche'); return; }
  if (S.ort && S.vert.n0 > 0 && S.vert.lebend <= 0 && S.modus !== 'verrat') {   // Verteidiger erschöpft (im Verrat sind sie keine Verteidiger mehr: das Notfallprotokoll entscheidet): Gnadenfrist, danach ist der Ort verloren
    // ohne laufende Belagerung (durchziehende Flotte) kann der Ort nicht fallen (ort_gefallen verlangt sie): dann ohne „verloren“ (Client-Runde GRNDS.)
    if (S.vert.erschT == null) {
      S.vert.erschT = game.time;
      const kannFallen = Kern.pruefeWirkung(game.weltsim.zustand, { typ: 'ort_gefallen', ort: S.hex, an: S.fraktion }).ok;
      funk(game, fmt(kannFallen ? T.gnade : (T.gnadeOhneBelagerung || T.gnade), { sek: Math.round(Number(C.erschoepfungGnade) || 0), ort: S.ortName }));
    }
    else if (game.time - S.vert.erschT >= (Number(C.erschoepfungGnade) || 0)) { niederlage(game, S, 'verteidigung'); return; }
  }
}

// Hook aus game.missionEvent (nur mit laufender Szene)
function ereignis(game, name, data) {
  const S = game.simSzene;
  if (!S || S.phase === 'ende' || !data) return;
  if (name === 'enemyKilled') {
    const e = data.enemy; const w = game.flotte && game.flotte.welle;
    if (e && e.verratS === S.id) {   // SUND-02b E: ein ehemaliger Verbündeter ist gefallen: Verlust der römischen Seite, nie Gegnerpunkte (killPunkte gehören den Angreifern)
      S.vert.verloren += e.simPts || 0; S.verrat.tot++;
      return;
    }
    if (!e || !w || e.wv !== w.id) return;
    S.kills[e.kind] = (S.kills[e.kind] || 0) + 1;
    S.killPunkte += Number(game.C.wellenplan.punkte[e.kind]) || 0;
    if (e.flagg) S.flaggGefallen = true;
  } else if (name === 'allyLost') {
    const es = data.escort;
    if (!es || es.sim !== S.id) return;
    S.vert.verloren += es.simPts || 0; S.vert.lebend = Math.max(0, S.vert.lebend - 1);
  }
}

const letzte = (game) => game.simSzeneLetzte || null;

// ---------- Snapshot: Szenenzeile (Client-Runde M2) ----------
// -> null | { p: 'v'|'k'|'f'|'s'|'n', v?: [Restsekunden, Vorwarnzeit], f?: Fraktion, k?: Klasse 1..3, g?: lebende Gegner, kd?: Kommandant (≤ 24), o?: Ort }
// Nur während einer Szene und die ersten CONFIG.simSzene.endeAnzeige s nach Sieg/Niederlage. Phase v Vorwarnung, k Kampf, f Finale, s Sieg, n Niederlage. Die Welle k/n der Zeile steht
// schon in flotte.wl; kd nur im Finale (Kommandant gekürzt), o nur am Ende (Ort, der hält bzw. fällt).
const kurz = (t, n) => { const x = String(t || ''); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
function snapshot(game) {
  const S = game.simSzene;
  if (S && S.phase !== 'ende') {
    const x = S.modus === 'angriff' ? { x: 1 } : {};   // SUND-02b A2: Angriff auf einen Posten (Zeile „ANGRIFF AUF POSTEN“ statt FEINDKONTAKT)
    const wa = Verrat.warnung(game);   // SUND-02b E: der Halteprozess des Verrats läuft: w = [Restsekunden, Dauer], die Zeile warnt alle Spieler
    if (wa) x.w = wa;
    if (S.modus === 'verrat') x.vt = 1;   // SUND-02b E: Verrat läuft (Zeile „VERRAT“)
    if (S.phase === 'vorwarnung') return Object.assign({ p: 'v', v: [Math.max(0, Math.ceil(S.start - game.time)), Math.round(S.vorlauf)], f: S.fraktion, k: S.klasse }, x);
    const w = game.flotte && game.flotte.welle;
    const g = w ? game.space.enemies.filter((e) => e.wv === w.id).length : 0;
    if (S.modus === 'verrat') return Object.assign({ p: 'k', g }, x);   // kein Finale, kein Flaggschiff: die ehemaligen Verbündeten sind die eine Welle
    const kdName = S.kommandant ? S.kommandant.name : (S.modus === 'angriff' ? (texte().angriff || {}).kommandant : null);   // A2-Fix: das Finale des Angriffs nennt den Postenkommandanten
    return Object.assign(S.finale ? Object.assign({ p: 'f', g }, kdName ? { kd: kurz(kdName, 24) } : {}) : { p: 'k', g }, x);
  }
  const E = game.simSzeneEnde;
  const rest = E ? E.bis - game.time : -1;   // robust gegen Zeitrücksprung (Reset, Laden): nur gültig, wenn die Restzeit in [0, endeAnzeige] liegt
  if (E && rest > 0 && rest <= endeAnzeige(game) && E.szene === game.ship.scene) return Object.assign({ p: E.p }, E.o ? { o: kurz(E.o, 24) } : {}, E.x ? { x: 1 } : {}, E.vt ? { vt: 1 } : {});
  return null;
}

// ---------- Debug: szene [staerke] [ger|pirat] [belagerung] – setzt im Hex der Lerche eine Flotte der Sim und löst die Szene aus ----------
function debug(game, args) {
  const a = (Array.isArray(args) ? args : []).map(String);
  const ws = game.weltsim;
  if (!ws) return 'Nur im Modus Freie Fahrt Sund.';
  if (game.ship.docked) return 'Erst ablegen.';
  const hex = Sektoren.hexVonOrt(game.ship.scene);
  if (!hex || !ws.zustand.hexe[hex]) return 'Hier gibt es kein Sim-Hex.';
  const staerke = Math.max(1, Number(a[0]) || 8);
  if (staerke > DEBUG_STAERKE_MAX) return `Stärke höchstens ${DEBUG_STAERKE_MAX}.`;
  const fraktion = a[1] === 'pirat' ? 'pirat' : 'ger';
  const z = ws.zustand;
  const heimat = Object.keys(z.hexe).find((c) => c !== hex && z.hexe[c].besitzer === fraktion) || hex;   // eine Flotte braucht eine Heimat außerhalb des Hexes, sonst bliebe sie beim Rückzug dort
  const fl = { id: z.naechsteId++, fraktion, heimat, ort: hex, staerke, kap: staerke, befehl: 'heim', ziel: null, warte: 0, versorgung: 1, angriff: null };
  z.flotten.push(fl);
  if (!a.includes('belagerung')) { fl.befehl = 'rueckzug'; fl.ziel = heimat; }   // eine durchziehende Flotte ist unterwegs (die Sim kennt „heim“ nur im eigenen Hafen) und zieht im nächsten Tick weiter
  if (a.includes('belagerung')) {
    const id = Number.isFinite(z.naechsteAngriffId) ? z.naechsteAngriffId++ : z.angriffe.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    z.angriffe.push({ id, t0: z.tick, ziel: hex, von: fraktion, art: fraktion === 'pirat' ? 'pirat' : 'reich', relevant: true, zielArt: z.hexe[hex].posten ? 'posten' : 'hafen', t_an: z.tick, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: z.tick, stuetz: null, flotten: [fl.id] });
    fl.befehl = 'angriff'; fl.ziel = hex; fl.angriff = id;
  }
  const S = betreten(game, hex);
  return S ? null : 'Keine Szene ausgelöst.';
}

// SUND-04a-3 STUB (Paket Finale-Orbit baut die echte Funktion): baut die Orbit-Szene des Finales im Hex { hex } und -> Szene | null. Der Stub baut nichts und liefert null:
// finale.starten() scheitert dann sauber (Finale startet nicht). Tests ersetzen ihn über Finale.ersetzen('szene', { finaleStarten }).
function finaleStarten(game, { hex } = {}) { return null; }   // eslint-disable-line no-unused-vars

module.exports = { SZENEN_TAG, funk, finaleStarten, verratStarten, betreten, angriffStarten, update, snapshot, ereignis, abbrechen, verlassen, lage, letzte, debug, schiffeFuer, verteile };
