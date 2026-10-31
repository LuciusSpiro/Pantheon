'use strict';
// BOD-02 P8: Verteidigungsprofil (Halten, Rückzug). Nur Trupps, denen das Szenario ein Profil zuweist (graben.js aufstellen ->
// zuweisen); alle anderen Trupps (Tutorial, Siedlung, Wellen Boden, ...) laufen unverändert, jede Funktion hier kehrt ohne Profil sofort zurück.
//
// Datenmodell (nur serverintern, nicht im Snapshot): s.verteidigung = V, EIN Objekt, das sich alle Trupps einer Linie teilen:
//   V = { linie, modus, squads, halten, ostkante, linie2Anker, rueckzug, initial, ... }
//   linie        1 (Haltelinie der Welle 1)
//   modus        'halten'   Plätze der Haltelinie (halten) sind die einzigen erlaubten Ziele (squad.setGoal/planPin/planAdvance)
//                'rueckzug' Überlebende laufen zu den Plätzen der Linie 2 (rueckzug), schießen bei Sicht weiter; Ende bei Ankunft oder rueckzugMax s
//                'linie2'   endgültig: halten die Plätze der Linie 2 (keine Rückkehr zu Linie 1)
//   squads       Trupp-Namen der Linie; halten: [{x,y,posten}] alle Stellungsplätze (stellung.plaetze), sohle/posten: die Teilmengen (Schützen halten ihr Posten-Plateau); ostkante: östlichste Kachel der Grabensohle
//   linie2Anker  [{x,y}] die nächsten Anker der Welle 2 (Karte meta.wellen/meta.gruppen); rueckzug: [{x,y}] Anker + Deckungsplätze im Umkreis (beim Rückzug berechnet)
// Auslöser des Rückzugs (alarmierte Linie): höchstens rueckzugAnteil der Linie lebt (Hälfte gefallen) ODER die Linie ist umgangen (ein Spieler steht
// seit umgehungSek östlich der Grabenlinie, oder der Flankenschutz aus P7 meldet die Umgehung und der Spieler steht in der Stellung).
// Der Funkspruch 'half' („Rückzug zur zweiten Linie!“) gehört zu diesem Rückzug (squad.onEnemyDown: Trupps mit Profil funken ihn nur hier).
const Physics = require('../../shared/physics.js');
const Stellung = require('../../shared/stellung.js');
const { dist } = require('../util.js');

const TILE = Physics.TILE;
const squadMod = () => require('./squad.js');
const truppMod = () => require('./trupp.js');
const tileOf = (x, y) => Physics.toTile(x, y);
const STANDARD = { haltenAnteil: 0.8, rueckzugAnteil: 0.5, reichweite: 0, rueckzugMax: 15, umgehungSek: 2, umgehungDx: 1, rueckzugAnker: 3, rueckzugRadius: 4 };
const cfgVon = (game) => Object.assign({}, STANDARD, game.C.awayCombat.verteidigung || {});

const SETS = new WeakMap();   // Plätze-Array -> Set "x,y" (inkl. Toleranz reichweite)
function menge(liste, reichweite) {
  if (!liste) return null;
  let c = SETS.get(liste);
  if (c && c.r === reichweite) return c.set;
  const set = new Set();
  const r = Math.max(0, Math.floor(reichweite) || 0);
  for (const t of liste) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) set.add((t.x + dx) + ',' + (t.y + dy));
  SETS.set(liste, { r, set });
  return set;
}

function profilVon(game, e) {
  const s = game.away && game.away.squads && game.away.squads[e.squad];
  return (s && s.verteidigung) || null;
}

// ---------- Zuweisung (graben.js aufstellen) ----------
// names: Trupp-Namen der Haltelinie; linie2Gruppen: Gruppen der nächsten Linie (meta.wellen[2]); info = awayInfoOf(lp)
function zuweisen(game, aw, info, names, linie2Gruppen) {
  const k = info.karte;
  const halten = Stellung.plaetze(k, (x, y) => info.map.solid(x, y)).map((p) => ({ x: p.x, y: p.y, posten: !!p.posten }));
  const rects = Stellung.rects(k).slice().sort((a, b) => b[2] * b[3] - a[2] * a[3]);
  const sohle = rects[0];
  const V = { linie: 1, modus: 'halten', squads: names.slice(), halten, sohle: halten.filter((t) => !t.posten), posten: halten.filter((t) => t.posten), ostkante: sohle ? sohle[0] + sohle[2] - 1 : 0, linie2Anker: [], rueckzug: null, initial: 0, rueckzugAt: null, drin: {}, umgehungAb: {}, grund: null };
  // nächste Linie: die Gruppe der Welle 2, deren Anker der Haltelinie am nächsten liegen; davon die nächsten rueckzugAnker Anker
  const C = cfgVon(game);
  const mx = halten.length ? halten.reduce((a, t) => a + t.x, 0) / halten.length : 0, my = halten.length ? halten.reduce((a, t) => a + t.y, 0) / halten.length : 0;
  let best = null, bd = Infinity;
  for (const gr of linie2Gruppen || []) {
    const an = ((k.meta.gruppen || {})[gr] || []).map((id) => k.anker.find((a) => a.id === id)).filter(Boolean);
    if (!an.length) continue;
    const d = Math.min(...an.map((a) => Math.hypot(a.x - mx, a.y - my)));
    if (d < bd) { bd = d; best = an; }
  }
  if (best) V.linie2Anker = best.slice().sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my)).slice(0, Math.max(1, C.rueckzugAnker)).map((a) => ({ x: a.x, y: a.y }));
  for (const nm of names) { const s = aw.squads[nm]; if (s) { s.verteidigung = V; V.initial += aw.drones.filter((e) => e.squad === nm).length; } }
  return V;
}

// Mitglieder der Linie (lebend)
function mitglieder(game, V) {
  return game.away.drones.filter((e) => e.alive && !e.asleep && V.squads.includes(e.squad));
}
const alarmiert = (game, V) => V.squads.some((n) => { const s = game.away.squads[n]; return s && s.alert; });

// ---------- Abfragen für squad.js ----------
function aktiv(game, e) { const V = profilVon(game, e); return V && V.modus !== 'rueckzug' ? V : null; }
// Plätze, aus denen e sein Ziel wählen darf (statt E.coverSpots); ohne Profil unverändert
function spots(game, e, cover) {
  const V = profilVon(game, e);
  if (!V) return cover;
  if (V.modus === 'halten') {
    // Schützen (Aufgabe scharf) halten ihr Posten-Plateau, alle anderen die Grabensohle: kein Pendeln zwischen Plateau und Graben über die Wiese
    if (e.rolle === 'schuetze' && V.posten.length) {
      const h = tileOf(e.home.x, e.home.y);
      const eigene = V.posten.filter((t) => Math.max(Math.abs(t.x - h.x), Math.abs(t.y - h.y)) <= 4);
      return eigene.length ? eigene : V.posten;
    }
    return V.sohle.length ? V.sohle : V.halten;
  }
  if (V.modus === 'linie2') return V.rueckzug || cover;
  return cover;
}
// Darf e die Kachel als Ziel nehmen? (Haltelinie bzw. Linie 2; im Rückzug frei)
function erlaubt(game, e, tile) {
  const V = profilVon(game, e);
  if (!V || V.modus === 'rueckzug') return true;
  const liste = V.modus === 'halten' ? V.halten : V.rueckzug;
  if (!liste) return true;
  return menge(liste, cfgVon(game).reichweite).has(tile.x + ',' + tile.y);
}
// auf dem Rückzug: Modus rueckzug, oder (nach rueckzugMax s) wer noch zu seinem Platz der Linie 2 unterwegs ist
const unterwegs = (V, e) => V.modus === 'rueckzug' || (V.modus === 'linie2' && !!e.rueckzugZiel);
function imRueckzug(game, e) { const V = profilVon(game, e); return !!(V && unterwegs(V, e)); }

// ---------- Rückzug ----------
function rueckzugPlaetze(game, E, V) {
  const C = cfgVon(game); const out = []; const seen = new Set();
  const add = (x, y) => { const key = x + ',' + y; if (seen.has(key) || E.solid(x, y)) return; seen.add(key); out.push({ x, y }); };
  for (const a of V.linie2Anker) add(a.x, a.y);
  for (const a of V.linie2Anker) for (const c of E.coverSpots || []) if (Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y)) <= C.rueckzugRadius) add(c.x, c.y);
  return out;
}
function ausloesen(game, E, V, grund) {
  if (V.modus !== 'halten') return;
  const sq = squadMod(); const aw = game.away;
  V.modus = 'rueckzug'; V.rueckzugAt = game.time; V.grund = grund;
  V.rueckzug = rueckzugPlaetze(game, E, V);
  aw.truppStats = aw.truppStats || { umgangen: 0 };
  aw.truppStats.rueckzug = (aw.truppStats.rueckzug || 0) + 1;
  const ms = mitglieder(game, V);
  for (const e of ms) { e.goal = null; e.path = null; e.aim = null; e.goalAt = -99; }
  for (const nm of V.squads) { const s = aw.squads[nm]; if (s) s.halfBarked = true; }
  if (ms.length) {
    const s = aw.squads[ms[0].squad];
    s.barkAt = -99;   // dieser Funkspruch geht immer raus
    sq.bark(game, s, ms[0], 'half');
  }
  game.emit('verteidigungRueckzug', { map: aw.map, grund, lebend: ms.length });
}
// Auslöser prüfen (halten): Hälfte gefallen oder umgangen
function pruefe(game, E, V) {
  if (V.modus !== 'halten' || !alarmiert(game, V)) return;
  const C = cfgVon(game);
  const lebend = mitglieder(game, V).length;
  if (V.initial >= 2 && lebend > 0 && lebend <= V.initial * C.rueckzugAnteil) return ausloesen(game, E, V, 'verluste');
  if (!lebend) return;
  const k = require('./stellung.js').karteVon(game);
  for (const p of game.players) {
    if (p.zone !== 'away' || !p.connected || p.downed) continue;
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    const hinten = tx > V.ostkante + C.umgehungDx;
    const flanke = !!k && V.squads.some((n) => { const s = game.away.squads[n]; const b = s && s.bedrohung; return b && b.pid === p.id && game.time <= b.bis; }) && (Stellung.istIn(k, tx, ty) || Stellung.amPosten(k, p.x, p.y));
    if (!hinten && !flanke) { delete V.umgehungAb[p.id]; continue; }
    if (V.umgehungAb[p.id] == null) V.umgehungAb[p.id] = game.time;
    if (game.time - V.umgehungAb[p.id] >= C.umgehungSek) return ausloesen(game, E, V, 'umgangen');
  }
}

// Tote: sofort prüfen (Funkspruch kommt mit dem Rückzug, squad.onEnemyDown)
function beiTod(game, s, e) {
  const V = s.verteidigung;
  if (!V) return false;
  pruefe(game, require('./combat.js').env(game), V);
  return true;
}

// ---------- Tick (squad.update, nach Trupp.update) ----------
function tick(game, E) {
  const aw = game.away; const gesehen = new Set();
  for (const s of Object.values(aw.squads || {})) {
    const V = s && s.verteidigung;
    if (!V || gesehen.has(V)) continue;
    gesehen.add(V);
    try { tickLinie(game, E, V); } catch (err) { game.countError('squad-verteidigung', err); }
  }
}
function tickLinie(game, E, V) {
  const C = cfgVon(game);
  if (V.modus === 'halten') {
    pruefe(game, E, V);
    return;
  }
  if (V.modus === 'rueckzug' || V.modus === 'linie2') {
    const ms = mitglieder(game, V);
    const sq = squadMod();
    const menge2 = V.rueckzug || [];
    let fertig = true;
    for (const e of ms) {
      const here = tileOf(e.x, e.y);
      if (V.modus === 'linie2') {   // Nachzügler: weiter zum Platz, höchstens 2 x rueckzugMax s nach Beginn, dann hält er, wo er steht
        if (!e.rueckzugZiel) continue;
        const z = e.rueckzugZiel;
        if (game.time - V.rueckzugAt > 2 * C.rueckzugMax || Math.max(Math.abs(z.x - here.x), Math.abs(z.y - here.y)) <= 1) { e.rueckzugZiel = null; continue; }
        if (!e.path || !e.path.length) sq.setGoal(game, E, e, z);
        continue;
      }
      const imZiel = !!e.rueckzugZiel && (!e.path || !e.path.length);
      if (!imZiel && (!e.goal || !e.path || !e.path.length) && menge2.length) {
        // freien Platz der Linie 2 wählen: Abstand zu Kameraden und Insel-Belegung (platzStrafe), dann der nächste
        let best = null, bs = Infinity;
        for (const sp of menge2) {
          if (E.solid(sp.x, sp.y)) continue;
          const sc = Math.hypot(sp.x - here.x, sp.y - here.y) + sq._platzStrafe(game, E, e, sp) * 0.2;
          if (sc < bs) { bs = sc; best = sp; }
        }
        if (best && sq.setGoal(game, E, e, best)) { e.rueckzugZiel = { x: best.x, y: best.y }; e.home = Physics.tileCenter(best.x, best.y); }   // der Platz der Linie 2 ist der neue Posten (kein Zurückwandern nach Beruhigung)
      }
      if (e.path && e.path.length) fertig = false;
    }
    if (V.modus === 'rueckzug' && (fertig || game.time - V.rueckzugAt >= C.rueckzugMax)) {
      V.modus = 'linie2';   // endgültig: Linie 2 halten (wer noch läuft, geht zu Ende, siehe oben)
      for (const e of ms) if (!e.path || !e.path.length) e.rueckzugZiel = null;
    }
    return;
  }
}

// ---------- Entscheidung je Gegner (squad.decide, vor decideB2) ----------
// true = entschieden
function entscheide(game, E, e, s) {
  const V = s.verteidigung;
  if (!V) return false;
  const sq = squadMod();
  if (unterwegs(V, e)) {
    const ziele = sq.sichtbareZiele(game, E, e, s).filter((p) => !p.downed);
    const t = ziele.slice().sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
    sq.setRole(game, e, 'pin');
    // Im Laufen nur jede dritte Sekunde feuern (ein Schuss hält act sonst fest: Ankündigung + Pause), angekommen ohne Einschränkung
    const lauft = !!(e.path && e.path.length);
    e.shootTarget = t && (!lauft || game.time % 3 < 1) ? t.id : null; e.target = t ? t.id : e.target;
    return true;   // Weg setzt tickLinie; Schießen übernimmt act (Sichtlinie, Schussfenster)
  }
  return false;
}

module.exports = { STANDARD, zuweisen, aktiv, spots, erlaubt, imRueckzug, tick, entscheide, beiTod, pruefe, mitglieder, profilVon, cfgVon, menge };
