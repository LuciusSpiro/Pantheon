'use strict';
// SUND-04a-3 Boden: Treiber des Boden-Teils der Entscheidungsschlacht um Hrafnheim (Schrein von Asgard). Action-Layer wie finale.js; alle Zahlen und Texte in content/welt/finale-boden.json.
// Schnittstelle zum Finale-Kern (server/sim/finale.js, Vertrag): Finale.orbitEnde(game, 'sieg') ruft bodenStarten(game) -> bool; dieses Modul meldet das Ende mit
// Finale.bodenEnde(game, 'sieg' | 'crew_gefallen'), je Versuch GENAU EINMAL.
//
// Ablauf:
//   bodenStarten   legt den Landepunkt 'hrafnheim.schrein' zur Laufzeit an (landepunkte.neu mit fester ID und festem Seed, fluechtig = nie im Weltstand, frei 'finale' = nur
//                  waehrend dieses Boden-Teils anwaehlbar), baut die Karte (Militaersiedlung, Kommando mit dem Schrein = Anker ziel), setzt das Transferziel und sperrt den
//                  Schrein (anker.js ankerSperre). Die Crew beamt mit dem normalen Weg (Transfer-Konsole) hinunter.
//   update         jeden Tick (game.js, nur solange ein Boden-Teil laeuft): Landung -> Gegner erscheinen EINMAL (endkampf.angriffStarten, Wachen nach Crewgroesse + Waechter);
//                  Freigabe (Waechter besiegt bzw. Wachen weg, Daten: freigabe.nach) hebt die Sperre auf; Schrein aktiviert (Anker ziel, 3 s halten) = Sieg;
//                  niemand mehr unten (Notrueckholung, freiwilliges Hochbeamen) oder Schiff weg = crew_gefallen (Neubeginn, kein Game Over, keine Strafe).
//   aufraeumen     nach dem Ende (oder Laden/Reset: Finale phase null): Transferziel weg, Landepunkt verwerfen, sobald niemand mehr dort ist.
// Zustand: game.finaleBoden = { lp, ort, tag, ziel, gelandet, frei, ende } – nicht im Weltstand (das Finale ist nicht speicherbar). Zufall: nur der eigene Strom der Karte (aw.rng im
// Endkampf, Seed aus der Landepunkt-ID), nie game.rng.
const D = require('../../content/welt/finale-boden.json');

const LPD = D.landepunkt;
const G = D.gegner;
const T = D.texte;

const lazy = (f) => { let m = null; return () => m || (m = require(f)); };
const Finale = lazy('./finale.js');
const LP = lazy('./landepunkte.js');
const Anker = lazy('./anker.js');
const Endkampf = lazy('./endkampf.js');
const Away = lazy('./away.js');

const fehler = (game, wo, e) => { if (game.countError) game.countError(wo, e); };
function funk(game, key) {
  const text = (T.funk || {})[key];
  if (text) game.emit('radio', { from: T.sprecher || 'Oberkommando', text, lage: 1, r: 1 });
}

const aktiv = (game) => !!(game.weltsim && Finale().phase(game) === 'boden');

// Sperrgrund des Landepunkts (landepunkte.sperrgrund, frei 'finale'): null nur, solange DIESER Boden-Teil laeuft
function sperrgrund(game, lpId) {
  const S = game.finaleBoden;
  return aktiv(game) && S && !S.ende && S.lp === lpId ? null : T.sperrgrund;
}

// Wachen je Zahl der Spieler im Aussenteam (nach_crew: hoechster Eintrag gilt darueber, kleinster darunter)
function wachenFuer(n) {
  const w = G.nach_crew.wert;
  const keys = Object.keys(w).map(Number).sort((a, b) => a - b);
  let k = keys[0];
  for (const x of keys) if (x <= n) k = x;
  return w[String(k)];
}
const unten = (game, lp) => game.players.filter((p) => p.zone === 'away' && game.away && game.away.map === lp);

// ---------- Start
function bodenStarten(game) {
  if (!game.weltsim || !game.ship) return false;
  aufraeumen(game);
  if (game.finaleBoden) return false;   // der vorige Landepunkt ist nicht frei zu bekommen
  const L = LP();
  const ort = game.ship.scene;
  if (!ort) return false;
  let id = null;
  try {
    id = L.neu(game, ort, {
      id: LPD.id, art: LPD.art, bauweise: LPD.bauweise, besitz: LPD.besitz, zustand: LPD.zustand, seed: LPD.seed, name: LPD.name, gen: LPD.gen,
      frei: 'finale', fluechtig: true, beam: { x: Math.round(game.ship.x), y: Math.round(game.ship.y), range: LPD.beam_reichweite },
    });
    game.finaleBoden = { lp: id, ort, tag: G.tag, ziel: null, gelandet: false, frei: false, ende: null };
    const err = L.waehlen(game, id, null);   // baut die Karte (registriert game.aways[id])
    if (err) throw new Error(err);
    const aw = game.aways[id];
    const k = L.karte(game, id);
    const ziel = k && (k.anker || []).find((a) => a.rolle === D.schrein.rolle);
    if (!aw || !ziel) throw new Error('Schrein-Karte ohne Anker ' + D.schrein.rolle);
    game.finaleBoden.ziel = ziel.id;
    aw.ankerSperre = Object.assign(aw.ankerSperre || {}, { [ziel.id]: sperrText() });
    game.transferZiel = { lp: id, scene: ort };
    game.setAwayMap(id);
  } catch (e) {
    fehler(game, 'finale-boden-start', e);
    if (game.finaleBoden) game.finaleBoden.ende = 'start';
    aufraeumen(game);
    return false;
  }
  funk(game, 'bereit');
  return true;
}
const sperrText = () => (D.freigabe.nach === 'wachen' ? T.sperre_wachen : T.sperre);

// ---------- Tick
function bedingung(game, S, aw) {
  const boss = Endkampf().bossBesiegt(game, S.lp, S.tag);
  const wachen = !(aw.drones || []).some((e) => e.tag === S.tag && e.alive);
  const nach = D.freigabe.nach;
  return nach === 'wachen' ? wachen : nach === 'boss_oder_wachen' ? boss || wachen : boss;
}
function ende(game, S, ausgang, grund) {
  if (S.ende) return;
  S.ende = grund;
  try { Finale().bodenEnde(game, ausgang); } catch (e) { fehler(game, 'finale-boden-ende', e); }
}
function update(game) {
  const S = game.finaleBoden;
  if (!S) return;
  if (!aktiv(game)) { aufraeumen(game); return; }   // Laden, Reset, Ende des Finales
  if (S.ende) return;
  const aw = game.aways && game.aways[S.lp];
  if (!aw) { ende(game, S, 'crew_gefallen', 'karte_weg'); return; }
  const da = unten(game, S.lp);
  if (!S.gelandet) {
    if (da.length) { S.gelandet = true; landung(game, S, aw, da.length); }
    else if (game.ship.scene !== S.ort) ende(game, S, 'crew_gefallen', 'abbruch');   // das Schiff ist vor der Landung weggeflogen
    return;
  }
  if (!da.length || Endkampf().crewGefallen(game, S.lp)) { ende(game, S, 'crew_gefallen', da.length ? 'gefallen' : 'abbruch'); return; }
  if (!S.frei && bedingung(game, S, aw)) {
    S.frei = true;
    if (aw.ankerSperre) delete aw.ankerSperre[S.ziel];
    funk(game, Endkampf().bossBesiegt(game, S.lp, S.tag) ? 'frei' : 'frei_wachen');
    if (G.alle_abziehen_nach_boss) Endkampf().gegnerAbziehen(game, S.lp, S.tag);
  }
  if (S.frei && Anker().zustand(game, S.lp, S.ziel) === 'aktiviert') {
    funk(game, 'schrein');
    ende(game, S, 'sieg', 'sieg');
  }
}
function landung(game, S, aw, n) {
  let k = 0;
  try { k = Endkampf().angriffStarten(game, { map: S.lp, fraktion: G.fraktion, tag: S.tag, gegner: wachenFuer(n), boss: G.boss }); } catch (e) { fehler(game, 'finale-boden-gegner', e); }
  if (!k) { fehler(game, 'finale-boden-gegner', new Error('keine Gegner erschienen')); ende(game, S, 'crew_gefallen', 'ohne_gegner'); return; }
  funk(game, 'landung');
}

// ---------- Aufraeumen
function aufraeumen(game) {
  const S = game.finaleBoden;
  if (!S) return;
  const L = LP();
  const aw = game.aways && game.aways[S.lp];
  if (aw) delete aw.ankerSperre;
  if (unten(game, S.lp).length) return;   // die Crew ist noch unten (nach dem Sieg): Transferziel und Karte bleiben, damit sie hochbeamen kann
  if (game.transferZiel && game.transferZiel.lp === S.lp) game.transferZiel = null;
  if (game.away && game.away.map === S.lp) {   // die Karte nicht mehr als Aussenkarte halten, sonst gilt sie als belegt
    try {
      const sp = Away().beamSpot(game);   // Karte des Orts (ohne Transferziel); gibt es keine (generierter Ort), irgendeine andere geladene Aussenkarte (Handkarten gibt es immer)
      const ziel = sp && sp.map !== S.lp ? sp.map : Object.keys(game.aways).sort().find((m) => m !== S.lp);
      if (ziel) game.setAwayMap(ziel);
    } catch (e) { fehler(game, 'finale-boden-aufraeumen', e); }
  }
  if (L.verwerfen(game, S.lp) || !L.eintrag(game, S.lp)) game.finaleBoden = null;   // sonst im naechsten Tick noch einmal (Crew noch unten)
}

module.exports = { bodenStarten, update, aufraeumen, sperrgrund, wachenFuer, DATEN: D };
