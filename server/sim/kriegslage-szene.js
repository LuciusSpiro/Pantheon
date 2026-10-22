'use strict';
// SUND-02a A2: Sim-Szene – die Crew greift in eine Flottenbegegnung der Weltsimulation ein (Modus Freie Fahrt Sund, game.weltsim).
// Action-Layer wie kriegslage.js. Die Szene enthält KEINE Sim-Logik: sie liest den Zustand (Wahrheit des Servers, nicht das Wissen von Rom) und stellt
// ihn dar; zurück gehen nur Wirkungen aus dem Katalog (server/weltsim/wirkungen.js) über Kriegslage.szeneAbschliessen / wirkungenVormerken.
//
//   betreten(game, hex)        Auslöser: Hook am Ende von Space.enterScene (jede Ankunft, nie ein Tick). -> Szene | null
//   update(game, dt)           Takt der Szene (aus game.step): Vorwarnung, Finale, Sieg, Niederlage
//   ereignis(game, name, data) Hook aus game.missionEvent: enemyKilled (Verluste der Angreifer), allyLost (Verluste der Verteidiger)
//   abbrechen(game, wo)        Flucht/Verlassen: Verluste bis dahin als Wirkungen VORMERKEN (der Sprung-Tick ist der eine Tick); Hook in Kriegslage.tick
//   lage(game, hex)            was die Sim im Hex hat (Angreifer, Verteidiger, Ort), rein lesend
//   letzte(game)               Ergebnis der letzten Szene (Tests, Debug), nicht gespeichert
//   debug(game, args)          nur --debug: szene [staerke] [ger|pirat] [belagerung]
//
// Regeln (Entscheidungen A2, Details im README „Sim-Szene“):
//  - Auslöser: nur bei der ANKUNFT (enterScene), nie durch einen Tick. Eine feindliche Flotte (ger, pirat; Stärke ≥ 1) im Hex löst die Szene aus; ohne Flotte
//    keine Szene (auch bei Belagerung nicht: ohne Flotte im Hex gibt es nichts darzustellen). Römische Flotten im Hex sind Verbündete. Wer nach einer Szene im
//    Hex bleibt, bekommt keine zweite: erst die nächste Ankunft löst wieder aus. Gedockt (Laden, Debug-Start) gibt es keine Szene; Laden stellt nie eine her.
//  - Szenenzustand (game.simSzene) wird nicht gespeichert und liegt am Schiff, nicht an Spielern.
//  - Ende: SIEG = Flaggschiff gefallen (Rest bricht ab, auch mit Reststärke) -> Verluste + flaggschiff_gefallen (+ ort_gehalten bei Belagerung) + ein Tick.
//    NIEDERLAGE = Notfallprotokoll der Lerche, wenn kein Verteidiger mehr neben ihr lebt (CONFIG.simSzene.notfallBisNiederlage), oder Verteidiger erschöpft (nach Gnadenfrist) -> Verluste + ort_gefallen
//    (Hafen/Posten der Crew-Seite) + ein Tick. ABBRUCH (Flucht per Sprung/Notfallsprung, Verlassen) -> nur Verluste, kein ort_*, kein eigener Tick.
const fs = require('fs');
const path = require('path');
const Kern = require('../weltsim/kern.js');
const Plan = require('../weltsim/wellenplan.js');
const Zufall = require('../weltsim/zufall.js');
const Flotte = require('./flotte.js');
const Escort = require('./escort.js');
const Kriegslage = require('./kriegslage.js');
const Besitz = require('./besitz.js');
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');

const TEXTE_FILE = path.join(__dirname, '..', '..', 'content', 'flotte', 'sim-szene.json');
const FEIND_VON = 'rom';   // die Crew spielt für Rom: Gegner sind alle, die zu Rom feindlich sind (ger, pirat)
const r2 = (v) => Math.round(v * 100) / 100;
const cfg = (game) => game.C.simSzene || {};
const hypot = Math.hypot;

let texteCache = null;
function texte() {
  if (texteCache) return texteCache;
  try { texteCache = JSON.parse(fs.readFileSync(TEXTE_FILE, 'utf8')); } catch (e) { texteCache = {}; }
  return texteCache;
}
const fmt = (t, v) => Flotte.fmt(t, v);
function funk(game, text) { if (text) Flotte.funk(game, { name: texte().sprecher || 'Aufklärung' }, text); }

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
  // Angreifer: die stärkste feindliche Fraktion im Hex (Flotten mit Stärke ≥ 1); andere feindliche Fraktionen kämpfen weiter nur in der Sim
  const feind = hier.filter((f) => Kern.feindlich(f.fraktion, FEIND_VON) && f.staerke >= 1);
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
  const f = verlustAnteil(S);
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
  // alle übrigen Gegner drehen ab und verlassen das Feld (sichtbar, höchstens ~14 s); die Rückzugsregel gilt nur für diese Gegner, nicht für spätere
  try { Escort.retreat(game, {}); delete game.space.retreatRule; } catch (e) { if (game.countError) game.countError('sim-szene-retreat', e); }
  game.simSzene = null;
}
function merken(game, S, ausgang, wirkungen, extra) {
  const ws = game.weltsim;
  game.simSzeneLetzte = Object.assign({ id: S.id, hex: S.hex, ausgang, tick: ws ? ws.tickZahl : null, wirkungen: wirkungen.map((x) => Object.assign({}, x)), kills: Object.assign({}, S.kills), killPunkte: S.killPunkte }, extra || {});
}

// ---------- Ende der Szene ----------
function sieg(game, S) {
  S.phase = 'ende';
  const z = game.weltsim.zustand;
  const kd = S.kommandant; const kName = kd ? kd.name : (texte().ohneKommandant || 'Der Flottenführer');
  const schicksal = schicksalWahl(game, S);
  const w = verlustWirkungen(game, S);
  for (const a of S.angreifer) if (flotteMit(z, a.id)) w.push({ typ: 'flaggschiff_gefallen', flotte: a.id, kommandant: { name: kName, schicksal } });   // alle Flotten des Angreifers brechen ab
  if (S.ort) w.push({ typ: 'ort_gehalten', ort: S.hex });
  const wirk = gueltige(game, w);
  const T = texte();
  const text = kd ? fmt(((T.sieg || {})[schicksal]), { kommandant: kd.name }) : (T.sieg || {}).ohneKommandant;
  aufraeumen(game, S);
  funk(game, text);
  if (S.ort) funk(game, fmt((T.sieg || {}).ort, { ort: S.ortName }));
  const r = Kriegslage.szeneAbschliessen(game, { wirkungen: wirk, wo: 'szene' });
  merken(game, S, 'sieg', wirk, { schicksal, ergebnis: { ok: r.ok, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}
function niederlage(game, S, grund) {
  S.phase = 'ende';
  const w = verlustWirkungen(game, S);
  if (S.ort) w.push({ typ: 'ort_gefallen', ort: S.hex, an: S.fraktion });   // der Prüfer lehnt ab, was nicht gilt (z. B. Piraten erobern keinen Hafen)
  const wirk = gueltige(game, w);
  const T = texte();
  aufraeumen(game, S);
  funk(game, (T.niederlage || {})[grund]);
  funk(game, S.ort ? fmt((T.niederlage || {}).ort, { ort: S.ortName }) : (T.niederlage || {}).frei);
  const r = Kriegslage.szeneAbschliessen(game, { wirkungen: wirk, wo: 'szene' });
  merken(game, S, 'niederlage', wirk, { grund, ergebnis: { ok: r.ok, angewandt: r.angewandt, verworfen: r.verworfen.length, tick: r.tick } });
  return r;
}
// Flucht/Verlassen: Verluste vormerken, der folgende Sprung-Tick (Kriegslage.tick) wendet sie an. Kein ort_*, kein eigener Tick.
function abbrechen(game, wo) {
  const S = game.simSzene;
  if (!S || S.phase === 'ende') { game.simSzene = null; return null; }
  S.phase = 'ende';
  const w = gueltige(game, verlustWirkungen(game, S));
  aufraeumen(game, S);
  const r = Kriegslage.wirkungenVormerken(game, w);
  merken(game, S, 'abbruch', w, { wo: wo || null, vorgemerkt: r.vorgemerkt });
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
  if (S.ort === 'hafen' && sc.dock) return { x: sc.dock.x, y: sc.dock.y };
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
  if (game.simSzene) abbrechen(game, 'neu');   // eine alte Szene ragt nie in eine neue hinein
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
  const loc = Locations.get(game.ship.scene);
  const S = { id: game.simSzeneN, hex, ort: L.ort, ortName: Sektoren.hexName(hex) || (loc && loc.name) || hex, szene: game.ship.scene, phase: 'vorwarnung',
    fraktion: L.fraktion, angreifer: L.angreifer, summe: L.summe, seed, plan, kommandant: kd, kills: {}, killPunkte: 0, flaggGefallen: false,
    t0: game.time, vorlauf: Number(C.vorwarnung) || 0, erinnern: (C.vorwarnungErinnerung || []).slice().sort((a, b) => b - a), emBasis: game.stats.emergencies || 0, finale: false };
  S.start = S.t0 + S.vorlauf;
  game.simSzene = S;
  verteidigerAufstellen(game, S, L);
  Flotte.wellenStartAusPlan(game, { plan, volk, ziel: 'auto', richtung: 'alle', tag: 'sim_szene', vorlauf: S.vorlauf, restAnteil: C.restAnteil });
  try { Kriegslage.szeneNachziehen(game); } catch (e) { if (game.countError) game.countError('sim-szene-nachziehen', e); }   // Andocken gesperrt, Dock-Marker weg
  // Vorwarnung: Funkspruch mit Stärkeklasse, Fraktion, Kommandant; Zeit bis Welle 1 steht im Text und im Hinweis (ODA)
  const klasse = (T.klassen || {})[Kern.staerkeKlasse(L.summe, z.werte)] || '';
  const fr = (T.fraktionen || {})[L.fraktion] || {};
  const vars = { ort: S.ortName, klasse, flotte: fr.flotte || 'Flotte', kommandant: kd ? kd.name : '', sek: Math.round(S.vorlauf) };
  const vw = T.vorwarnung || {};
  funk(game, fmt(kd ? (L.ort ? vw.ort : vw.frei) : vw.ohneKommandant, vars));
  if (kd && ws.kommandanten && ws.kommandanten[kd.name] && ws.kommandanten[kd.name].schicksal === 'entkommen') funk(game, fmt(vw.entkommen, vars));
  if (L.fraktion === 'pirat') game.oda(vw.pirat, null);
  if (S.vert.n0 > 0) funk(game, fmt((T.verteidiger || {})[L.ort || 'frei'], { ort: S.ortName, n: S.vert.n0 }));
  game.oda(fmt(vw.hinweis, vars), null);
  return S;
}

// ---------- Takt ----------
function update(game, dt) {   // eslint-disable-line no-unused-vars
  const S = game.simSzene;
  if (!S || S.phase === 'ende') return;
  if (game.ship.scene !== S.szene) { abbrechen(game, 'verlassen'); return; }   // Ortswechsel ohne Sprung (Debug): wie Flucht
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
  }
  if (S.flaggGefallen || (w && w.fertig)) { sieg(game, S); return; }   // Flaggschiff gefallen, oder alle Gegner tot
  // Die Lerche unterliegt (Notfallprotokoll): Niederlage nur, wenn kein Verteidiger mehr lebt – mit Verteidigern geht die Schlacht weiter (die Gegner ziehen 10 s ab,
  // wie überall; ein Hafen fällt nicht, solange seine Flotte steht). Das Protokoll zählt erst, wenn niemand mehr neben der Lerche kämpft.
  if (S.vert.lebend > 0) S.emBasis = game.stats.emergencies || 0;
  if ((game.stats.emergencies || 0) >= S.emBasis + Math.max(1, Number(C.notfallBisNiederlage) || 1)) { niederlage(game, S, 'lerche'); return; }
  if (S.ort && S.vert.n0 > 0 && S.vert.lebend <= 0) {   // Verteidiger erschöpft: Gnadenfrist, danach ist der Ort verloren
    if (S.vert.erschT == null) { S.vert.erschT = game.time; funk(game, fmt(T.gnade, { sek: Math.round(Number(C.erschoepfungGnade) || 0), ort: S.ortName })); }
    else if (game.time - S.vert.erschT >= (Number(C.erschoepfungGnade) || 0)) { niederlage(game, S, 'verteidigung'); return; }
  }
}

// Hook aus game.missionEvent (nur mit laufender Szene)
function ereignis(game, name, data) {
  const S = game.simSzene;
  if (!S || S.phase === 'ende' || !data) return;
  if (name === 'enemyKilled') {
    const e = data.enemy; const w = game.flotte && game.flotte.welle;
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

// ---------- Debug: szene [staerke] [ger|pirat] [belagerung] – setzt im Hex der Lerche eine Flotte der Sim und löst die Szene aus ----------
function debug(game, args) {
  const a = (Array.isArray(args) ? args : []).map(String);
  const ws = game.weltsim;
  if (!ws) return 'Nur im Modus Freie Fahrt Sund.';
  if (game.ship.docked) return 'Erst ablegen.';
  const hex = Sektoren.hexVonOrt(game.ship.scene);
  if (!hex || !ws.zustand.hexe[hex]) return 'Hier gibt es kein Sim-Hex.';
  const staerke = Math.max(1, Number(a[0]) || 8);
  const fraktion = a[1] === 'pirat' ? 'pirat' : 'ger';
  const z = ws.zustand;
  const heimat = Object.keys(z.hexe).find((c) => c !== hex && z.hexe[c].besitzer === fraktion) || hex;   // eine Flotte braucht eine Heimat außerhalb des Hexes, sonst bliebe sie beim Rückzug dort
  const fl = { id: z.naechsteId++, fraktion, heimat, ort: hex, staerke, kap: staerke, befehl: 'heim', ziel: null, warte: 0, versorgung: 1, angriff: null };
  z.flotten.push(fl);
  if (a.includes('belagerung')) {
    const id = Number.isFinite(z.naechsteAngriffId) ? z.naechsteAngriffId++ : z.angriffe.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    z.angriffe.push({ id, t0: z.tick, ziel: hex, von: fraktion, art: fraktion === 'pirat' ? 'pirat' : 'reich', relevant: true, zielArt: z.hexe[hex].posten ? 'posten' : 'hafen', t_an: z.tick, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: z.tick, stuetz: null, flotten: [fl.id] });
    fl.befehl = 'angriff'; fl.ziel = hex; fl.angriff = id;
  }
  const S = betreten(game, hex);
  return S ? null : 'Keine Szene ausgelöst.';
}

module.exports = { betreten, update, ereignis, abbrechen, lage, letzte, debug, schiffeFuer, verteile };
