'use strict';
// TEL-01 B1: Haken fuer Szenen, Gefecht (Raum und Boden) und Verluste (Balancing-Fragen 1, 2, 3).
// Die Spielcode-Stellen rufen NUR diese benannten Funktionen auf (Tel.schussRaum(game, ...)), kein Feld, kein Parameter fuer das Protokoll
// wandert durch das Spiel. Jede Funktion beginnt mit der billigen Abfrage `dienst(game)` (null = keine Session offen, nichts bauen).
// Alles hier liest nur Spielzustand: kein Schreiben ins Spiel, kein Zufall (game.rng), keine Aenderung der Reihenfolge von emit/missionEvent.
// Pseudonym: Spieler nur als Slot p1..p4. Nie ein Spieler- oder Gegnerobjekt weitergeben, nie name, karte, clientId.
//
// Merkzustand (z. B. "wann erschien dieser Gegner", "womit wurde er zuletzt getroffen") haelt dieses Modul je Session selbst (WeakMap am Dienst);
// am Spielobjekt haengt nichts, der Snapshot bleibt unveraendert.
//
// Ereignistypen und Felder stehen in schema.js (eine Stelle, die Auswertung liest nur das).

const Haken = require('./haken.js');   // inDeckung: der eine Rechenweg fuer die Deckung (Roh-Zustand siehe dort)

const { r2, num, txt, slotVon, sektorName } = require('./hilfen.js');

// ---------- Dienst und Merkzustand ----------
const ZUSTAND = new WeakMap();
function dienst(game) {
  const t = game && game.telemetrie;
  return t && t.offen ? t : null;
}
function zustand(t) {
  let z = ZUSTAND.get(t);
  if (!z || z.s !== t.s) {
    z = { s: t.s, szenen: new Map(), wellen: new Map(), raum: new Map(), boden: new Map(), letzte: new Map(), letzteBoden: new Map(), quelle: null, system: null, schade: null, bodenSchuss: new Map(),
      bodenQuelle: null, letzterSchuss: new Map(), schussNr: 0, wegGrund: new Map(), ort: null };
    ZUSTAND.set(t, z);
    // Abschluss-Haken des Dienstes: vor session_ende offene Szenen schliessen und den Merkzustand freigeben (kein Sonderfall im Spielcode)
    const ref = new WeakRef(t);
    t.beiAbschluss(() => { const d = ref.deref(); if (d) szenenSchliessen(d, z); });
  }
  return z;
}
function szenenSchliessen(t, z) {
  try {
    const g = t.game;
    for (const e of z.szenen.values()) {
      t.ereignis('szene_ende', { modus: e.modus, szene: e.szene, ausgang: 'session_ende', dauer: num(g.time - e.t0), dauer_gesamt: num(g.time - e.anfang), spielerzahl: spielerzahl(g) });
    }
  } catch (err) { /* nie werfen */ }
  z.szenen.clear(); z.wellen.clear(); z.raum.clear(); z.boden.clear(); z.letzte.clear(); z.letzteBoden.clear(); z.bodenSchuss.clear(); z.letzterSchuss.clear(); z.wegGrund.clear();
  z.quelle = null; z.system = null; z.schade = null; z.bodenQuelle = null;
  ZUSTAND.delete(t);
}
// extras der Szenenaufrufer: undefined -> null (undefined waere kein flaches Feld und zaehlte als verworfen)
const extras = (o) => { const r = {}; if (o) for (const k of Object.keys(o)) { const v = o[k]; r[k] = v === undefined ? null : typeof v === 'number' ? num(v) : v; } return r; };
const spielerzahl = (game) => (typeof game.connectedCount === 'function' ? game.connectedCount() : null);

// ---------- Szenen (Frage 1) ----------
// Eine Szene = Kampagnenmission, Labor-Umsetzung, Testgelaende, Wellen, Grabenangriff, Endkampf, Sund-Szene. Key = modus + szene.
// Eine Szene ohne szene_ende lief bis zum session_ende.
function szeneStart(game, modus, szene, extra) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t);
    z.boden.clear(); z.letzteBoden.clear(); z.bodenSchuss.clear(); z.letzterSchuss.clear();   // Merkzustand des Bodens gehoert zur Szene: eine neue Szene beginnt ohne den der alten
    z.szenen.set(modus + '|' + szene, { modus, szene: txt(szene), t0: game.time, anfang: game.time });
    t.ereignis('szene_start', Object.assign({ modus, szene: txt(szene), spielerzahl: spielerzahl(game) }, extras(extra)));
  } catch (e) { /* nie werfen */ }
}
// dauer = ab Beginn bzw. letztem Neustart (Graben: letzter Versuch), dauer_gesamt = ab szene_start
function szeneEnde(game, modus, szene, ausgang, extra) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t); const key = modus + '|' + szene;
    const e = z.szenen.get(key);
    z.szenen.delete(key);
    t.ereignis('szene_ende', Object.assign({ modus, szene: txt(szene), ausgang: txt(ausgang), dauer: e ? num(game.time - e.t0) : null, dauer_gesamt: e ? num(game.time - e.anfang) : null,
      spielerzahl: spielerzahl(game) }, extras(extra)));
  } catch (err) { /* nie werfen */ }
}
// Modus einer Mission (Missionsstart/-ende): null = die Szene gehoert dem Wellen-Modul (startet/endet selbst), nicht doppelt melden
function modusMission(game) {
  const a = game.arena;
  if (a && a.wellen) return null;
  if (a) return a.kind === 'arena_away' ? 'arena_boden' : a.kind === 'arena_forschung' ? 'arena_forschung' : 'arena_raum';   // TEL-01 M2: Übungsplatz Forschungsstation (UEB-01) ist weder Raum- noch Bodenkampf
  return game.lobbyOpts && game.lobbyOpts.startMission === 'labor' ? 'labor' : 'kampagne';
}
function missionStart(game, id) { const m = modusMission(game); if (m) szeneStart(game, m, id); }
function missionEnde(game, id, ausgang) { const m = modusMission(game); if (m) szeneEnde(game, m, id, ausgang); }
function welle(game, modus, nr, gesamt) {
  const t = dienst(game); if (!t) return;
  try { zustand(t).wellen.set(modus + '|' + nr, game.time); t.ereignis('welle', { modus, nr: num(nr), gesamt: num(gesamt), spielerzahl: spielerzahl(game) }); } catch (e) { /* nie werfen */ }
}
function welleGeschafft(game, modus, nr) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t); const key = modus + '|' + nr; const t0 = z.wellen.get(key); z.wellen.delete(key);
    t.ereignis('welle_geschafft', { modus, nr: num(nr), dauer: t0 == null ? null : num(game.time - t0) });
  } catch (e) { /* nie werfen */ }
}
function szeneNeustart(game, modus, szene, versuch) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t); const e = z.szenen.get(modus + '|' + szene);
    if (e) e.t0 = game.time; else z.szenen.set(modus + '|' + szene, { modus, szene: txt(szene), t0: game.time, anfang: game.time });
    t.ereignis('szene_neustart', { modus, szene: txt(szene), versuch: num(versuch) });
  } catch (err) { /* nie werfen */ }
}

// ---------- Quelle des laufenden Treffers (Raum) ----------
// Ein Projektil trifft in updateProjectiles; der Treffer selbst geht ueber space.shipHit bzw. Waffen.schade, die das Projektil nicht kennen.
// quelle() merkt es fuer genau diesen Tick; JEDE Treffer-Funktion, die die Quelle liest, leert sie danach (kein fremder Treffer erbt sie).
// Fehlt sie (Mine, Dauerdruck, Zone), steht dort waffe 'sonstige'.
function quelle(game, art, p) {
  const t = dienst(game); if (!t) return;
  try { zustand(t).quelle = { art, pid: p && p.id != null ? String(p.id) : null, owner: p && p.owner != null ? String(p.owner) : null, tick: game.tick }; } catch (e) { /* nie werfen */ }
}
function frischeQuelle(game, z) {
  const q = z.quelle;
  return q && q.tick === game.tick ? q : null;
}
const gegnerKind = (game, id) => { const e = game.space && game.space.enemies.find((x) => x.id === id); return e ? e.kind : null; };

// ---------- Schuss und Treffer Raum ----------
// Lerche: waffe = Katalog-Id (lanze, standardbatterie, ..., torpedowerfer). Positionsargumente (kein Objekt bauen, wenn nichts geschrieben wird):
// mount, pid (Projektilkennung oder null), ziel (Gegnerobjekt oder null), kraft, treffer (nur Lanze: gleich beim Schuss bekannt, sonst undefined)
function schussRaum(game, waffe, mount, pid, ziel, kraft, treffer) {
  const t = dienst(game); if (!t) return;
  try {
    const e = ziel || null;
    t.ereignis('schuss', { ort: 'raum', waffe: txt(waffe), von: 'lerche', mount: txt(mount), pid: pid != null ? String(pid) : null, ziel: e ? 'gegner' : null,
      gegner: e ? e.id : null, rolle: e ? e.kind : null, kraft: num(kraft), treffer: treffer == null ? null : !!treffer });
  } catch (err) { /* nie werfen */ }
}
// Gegner-Systemtreffer (space.trefferSystem/torpedoSystem) merken, damit der Treffer-Satz von Waffen.schade Zone und System nennen kann
function gegnerSystem(game, e, tr) {
  const t = dienst(game); if (!t) return;
  try { zustand(t).system = e && tr ? { id: e.id, zone: txt(tr.zone), system: txt(tr.id), zustand: txt(tr.state), vorher: txt(tr.vorher), tick: game.tick } : null; } catch (err) { /* nie werfen */ }
}
// Beginn von Waffen.schade (vor space.damageEnemy): merkt Waffe und Ziel. Ein Abschuss mitten in damageEnemy (Torpedo-Sofort-Tod, Stoerrelais
// ohne Systemmodell) wird bis zum Treffer-Satz zurueckgehalten: so traegt der kill Waffe und Schuetzen, und der treffer steht davor.
function schadeBeginn(game, e, waffe) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t);
    if (z.schade && z.schade.kill) t.ereignis('kill', z.schade.kill);   // ein vorheriger Treffer-Satz kam nie an (Ausnahme): den Abschuss nicht verlieren
    z.schade = { id: e.id, waffe: txt(waffe), tick: game.tick, kill: null };
  } catch (err) { /* nie werfen */ }
}
// Lerche trifft einen Gegner (Waffen.schade). roh = Rohschaden, schild = verlorene Schildpunkte, schaden = wirksamer Schaden laut Waffen.schade
function trefferGegner(game, e, waffe, roh, schild, schaden) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t); const q = frischeQuelle(game, z); const s = z.system && z.system.id === e.id && z.system.tick === game.tick ? z.system : null;
    const sc = z.schade && z.schade.id === e.id ? z.schade : null;
    z.system = null; z.quelle = null; z.schade = null;
    t.ereignis('treffer', { ort: 'raum', waffe: txt(waffe), von: 'lerche', ziel: 'gegner', gegner: e.id, rolle: e.kind, pid: q ? q.pid : null,
      ergebnis: schaden > 0 ? 'treffer' : 'abgeprallt', schaden_roh: num(roh), schild: num(schild), schaden: num(schaden), zone: s ? s.zone : null, system: s ? s.system : null, zustand: s ? s.zustand : null });
    if (sc && sc.kill) t.ereignis('kill', sc.kill);   // der Abschuss kam mitten im Treffer: jetzt, nach dem treffer
    else z.letzte.set(e.id, txt(waffe));
  } catch (err) { /* nie werfen */ }
}
// Etwas trifft die Lerche (space.shipHit): r = Ergebnis von damage.resolveHit
function trefferLerche(game, sektor, dmg, opts, r) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t); const q = frischeQuelle(game, z); z.quelle = null;
    const o = opts || {}; const res = r || {};
    const systeme = Array.isArray(res.systems) ? res.systems : [];
    const s0 = systeme[0] || null;
    const art = q ? q.art : o.torpedo ? 'torpedo' : o.streu ? 'streu' : o.sturm ? 'sturm' : o.sperrfeuer ? 'sperrfeuer' : o.emp ? 'emp' : 'sonstige';
    const vonObjekt = art === 'brocken';   // Brocken sind keine Gegner
    t.ereignis('treffer', { ort: 'raum', waffe: art, von: vonObjekt ? 'objekt' : 'gegner', ziel: 'lerche', gegner: q ? q.owner : null, rolle: q && q.owner ? gegnerKind(game, q.owner) : null, pid: q ? q.pid : null,
      ergebnis: res.evaded ? 'ausgewichen' : res.empThrough ? 'emp' : 'treffer', schaden_roh: num(dmg), schild: num(res.absorbed), schaden: num(res.rest), sektor: sektorName(sektor),
      system: s0 ? txt(s0.system) : null, zustand: s0 ? txt(s0.state) : null, systeme: systeme.map((x) => txt(x.system, 30)), schuetzling: !!o.shielded });
  } catch (err) { /* nie werfen */ }
}
// Treffer ohne Schaden an der Lerche, der nicht ueber shipHit laeuft (Gegner-Torpedo prallt am Schild ab oder wird verfehlt). Verbraucht die Quelle.
function trefferLercheOhneSchaden(game, sektor, ergebnis, p) {
  const t = dienst(game); if (!t) return;
  try {
    zustand(t).quelle = null;
    t.ereignis('treffer', { ort: 'raum', waffe: 'torpedo', von: 'gegner', ziel: 'lerche', gegner: p && p.owner != null ? String(p.owner) : null, rolle: p && p.owner != null ? gegnerKind(game, p.owner) : null,
      pid: p && p.id != null ? String(p.id) : null, ergebnis, schaden_roh: 1, schild: 0, schaden: 0, sektor: sektorName(sektor) });
  } catch (err) { /* nie werfen */ }
}
// Mine trifft die Lerche (damage.direktTreffer mit opts.mine, kein Schild)
function trefferMine(game, sektor, r) {
  const t = dienst(game); if (!t) return;
  try {
    zustand(t).quelle = null;
    const systeme = r && Array.isArray(r.systems) ? r.systems : []; const s0 = systeme[0] || null;
    t.ereignis('treffer', { ort: 'raum', waffe: 'mine', von: 'objekt', ziel: 'lerche', ergebnis: 'treffer', schaden_roh: null, schild: 0, schaden: num(r && r.rest), sektor: sektorName(sektor),
      system: s0 ? txt(s0.system) : null, zustand: s0 ? txt(s0.state) : null, systeme: systeme.map((x) => txt(x.system, 30)) });
  } catch (err) { /* nie werfen */ }
}

// ---------- Gegner: erscheinen, fallen, verschwinden ----------
// Raum: space.update ruft nach jedem Tick raumGegner (Sweep ueber game.space.enemies): erstes Auftauchen = gegner_neu, Verschwinden ohne kill = gegner_weg.
// Ein Sweep faengt jeden Weg des Erscheinens und Verschwindens (Spawn, Flotte, Eskorte, Sprung, Rueckzug, Szenenwechsel ...), ohne dutzende Stellen anzufassen.
// Die Ursache des Verschwindens wird aus dem letzten gesehenen Zustand des Gegners gelesen (leaving, entkommen, hp), sonst 'unbekannt'.
function raumGegner(game) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t); const sp = game.space; if (!sp) return;
    const bekannt = z.raum;
    const jetzt = sp.enemies;
    const ort = game.ship ? game.ship.scene : null;
    const szWechsel = z.ort !== null && ort !== z.ort;   // Ort gewechselt (Sprung, Szenenwechsel): was verschwindet, ist mit der Szene gegangen
    z.ort = ort;
    for (let i = 0; i < jetzt.length; i++) {
      const e = jetzt[i];
      const b = bekannt.get(e.id);
      if (!b) {
        bekannt.set(e.id, { e, t0: game.time, kind: e.kind });
        t.ereignis('gegner_neu', { ort: 'raum', gegner: e.id, rolle: e.kind, tag: txt(e.tag), verbuendet: !!e.ally, quelle: 'spawn' });
      } else b.e = e;
    }
    if (bekannt.size > jetzt.length) {
      const da = new Set();
      for (let i = 0; i < jetzt.length; i++) da.add(jetzt[i].id);
      for (const [id, b] of bekannt) {
        if (da.has(id)) continue;
        bekannt.delete(id); z.letzte.delete(id);
        const vorgemerkt = z.wegGrund.get(id); z.wegGrund.delete(id);
        if (b.getoetet) continue;   // kill ist schon gemeldet
        const e = b.e;
        const grund = szWechsel ? 'szenenwechsel' : e.leaving ? 'rueckzug' : e.hp != null && e.hp <= 0 ? 'zerstoert' : vorgemerkt || (/^konvoi/.test(String(e.tag || '')) ? 'konvoi_ende' : 'unbekannt');   // Konvoi (Frachter, Eskorte) verlaesst das Feld am Missionsziel
        t.ereignis('gegner_weg', { ort: 'raum', gegner: id, rolle: b.kind, grund, lebte: num(game.time - b.t0) });
      }
    }
  } catch (err) { /* nie werfen */ }
}
// Aufrufer, die Gegner gezielt wegnehmen (Debug-Skip, Wellenende), nennen den Grund; raumGegner liest ihn beim naechsten Sweep (statt 'unbekannt')
function raumWegGrund(game, liste, grund) {
  const t = dienst(game); if (!t) return;
  try { const z = zustand(t); for (const e of liste) z.wegGrund.set(e.id, grund); } catch (err) { /* nie werfen */ }
}
// space.enemyDown: Abschuss. Mitten in Waffen.schade (schadeBeginn) wird er bis nach dem treffer zurueckgehalten, Waffe = die dieses Treffers.
// Sonst von/waffe aus dem letzten Treffer der Lerche auf diesen Gegner (der Tod kann spaeter kommen, Reaktor-Countdown); ohne Treffer von sonstige.
function killRaum(game, e) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t);
    const b = z.raum.get(e.id);
    if (b) b.getoetet = true;
    const sc = z.schade && z.schade.id === e.id && z.schade.tick === game.tick && !z.schade.kill ? z.schade : null;
    const w = sc ? sc.waffe : z.letzte.get(e.id) || null;
    z.letzte.delete(e.id); z.wegGrund.delete(e.id);
    const felder = { ort: 'raum', gegner: e.id, rolle: e.kind, von: w ? 'lerche' : 'sonstige', waffe: w, lebte: b ? num(game.time - b.t0) : null, nr: 1 };
    if (sc) sc.kill = felder; else t.ereignis('kill', felder);
  } catch (err) { /* nie werfen */ }
}

// ---------- Boden ----------
const aufGegner = (game, id) => { const aw = game.away; return aw && aw.drones ? aw.drones.find((d) => d.id === id) || null : null; };
const slotOderGegner = (k) => (k.team === 'crew' || k.input ? slotVon(k.id) : null);
function bodenRolle(k) { return txt(k.rolle || k.kind); }
// Boden-Gegner erfassen (idempotent): gegner_neu beim ersten Mal. quelle 'spawn' = der Wellen-/Grabenablauf sieht ihn beim Erscheinen,
// 'kontakt' = erstmals im Gefecht aufgefallen (Schuss, Treffer, Tod), dann ist t spaeter als der Spawn.
function bodenGegnerSehen(game, e, wie) {
  const t = dienst(game); if (!t || !e || e.team === 'crew') return null;
  try {
    const z = zustand(t);
    let b = z.boden.get(e.id);
    if (!b) {
      b = { t0: game.time, rolle: bodenRolle(e), n: 0 };
      z.boden.set(e.id, b);
      t.ereignis('gegner_neu', { ort: 'boden', gegner: e.id, rolle: b.rolle, tag: txt(e.tag), verbuendet: false, quelle: wie || 'kontakt' });
    }
    return b;
  } catch (err) { return null; }
}
// Schusskennung: Projektilkennung (Blaster, Sturmgewehr, Granate, Pistole ...) oder, wo es kein Projektil gibt (Lanze, Nahkampf), eine Kennung, die der Dienst
// selbst vergibt ('s<n>'; nichts am Spielobjekt, kein Verbrauch von Spielkennungen). Treffer tragen dieselbe Kennung: Quote je Waffe = Schuesse mit >= 1 Treffer / Schuesse.
function schussBoden(game, k, waffe, pid) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t);
    const slot = slotOderGegner(k);
    if (!slot) bodenGegnerSehen(game, k, 'kontakt');
    const dk = Haken.inDeckung(game, k);
    z.bodenSchuss.set(k.id, dk);
    const kennung = pid != null ? String(pid) : 's' + (++z.schussNr);
    z.letzterSchuss.set(k.id, { pid: kennung, eigene: pid == null, tick: game.tick });
    t.ereignis('schuss', { ort: 'boden', waffe: txt(waffe), von: slot || 'gegner', gegner: slot ? null : k.id, rolle: slot ? null : bodenRolle(k), pid: kennung,
      hitze: num(k.hitze), von_deckung: dk, geduckt: !!k.crouch });
  } catch (err) { /* nie werfen */ }
}
// Projektil (oder Granate) wirkt gerade: seine Kennung gilt fuer jeden Treffer bis zum Aufruf mit null. Wirkung aus anderer Quelle (Orbitalschlag): kein pid.
function quelleBoden(game, pid) {
  const t = dienst(game); if (!t) return;
  try { zustand(t).bodenQuelle = pid != null ? { pid: String(pid), tick: game.tick } : null; } catch (err) { /* nie werfen */ }
}
function ueberhitztBoden(game, k, waffe) {
  const t = dienst(game); if (!t) return;
  try { const slot = slotOderGegner(k); t.ereignis('ueberhitzt', { ort: 'boden', waffe: txt(waffe), von: slot || 'gegner', gegner: slot ? null : k.id }); } catch (err) { /* nie werfen */ }
}
function ueberhitztRaum(game, system) {
  const t = dienst(game); if (!t) return;
  try { t.ereignis('ueberhitzt', { ort: 'raum', waffe: null, von: 'lerche', system: txt(system, 30) }); } catch (err) { /* nie werfen */ }
}
// waffen.treffer: jede Wirkung auf einen Kaempfer. seg0 = Schildsegmente vorher (null = noch kein Schild), ergebnis = Rueckgabe von waffen.treffer
function trefferBoden(game, ziel, wirkung, quelleObj, ergebnis, seg0) {
  const t = dienst(game); if (!t) return;
  try {
    if (ergebnis === 'ignoriert') return;   // wirkungslos (Ziel schon unten, Friendly Fire ohne Flaeche): kein Treffer
    const z = zustand(t); const w = wirkung || {}; const q = quelleObj || {};
    const zielSlot = ziel.team === 'crew' ? slotVon(ziel.id) : null;
    // Schusskennung: das wirkende Projektil, sonst der Schuss ohne Projektil (Lanze, Nahkampf) desselben Schuetzen im selben Tick
    const bq = z.bodenQuelle && z.bodenQuelle.tick === game.tick ? z.bodenQuelle : null;
    const ls = q.id != null ? z.letzterSchuss.get(q.id) : null;
    const pid = bq ? bq.pid : ls && ls.eigene && ls.tick === game.tick ? ls.pid : null;
    const vonCrew = q.team === 'crew' || q.team === 'player';
    const vonSlot = vonCrew ? slotVon(q.id) : null;
    const von = vonSlot || (q.team === 'orbit' ? 'objekt' : vonCrew ? 'crew' : 'gegner');
    const seg1 = ziel.schild ? ziel.schild.seg : null;
    const schild = seg0 != null && seg1 != null ? Math.max(0, seg0 - seg1) : 0;
    if (!zielSlot) bodenGegnerSehen(game, ziel, 'kontakt');
    if (!zielSlot) z.letzteBoden.set(ziel.id, { waffe: txt(w.waffe || w.kind), von });
    const gegnerObj = zielSlot ? aufGegner(game, q.id) : ziel;
    const waffe = txt(w.waffe || w.kind);   // Pistole der Verwundeten und Altprojektile tragen nur kind
    const wirkt = ergebnis === 'wunde' || ergebnis === 'gefallen' || ergebnis === 'bewusstlos';   // Schild gibt es nicht mehr: der Treffer erreicht den Körper (bei 'schild' verfällt der Rest)
    t.ereignis('treffer', { ort: 'boden', waffe, von, ziel: zielSlot || 'gegner', gegner: gegnerObj ? gegnerObj.id : null, rolle: gegnerObj ? bodenRolle(gegnerObj) : null, pid,
      ergebnis: txt(ergebnis), schaden_roh: num(w.schaden), schild: num(schild), schaden: wirkt ? num(w.schaden) : 0, wunde: ergebnis === 'wunde' || ergebnis === 'gefallen',
      von_deckung: z.bodenSchuss.has(q.id) ? z.bodenSchuss.get(q.id) : null, ziel_deckung: Haken.inDeckung(game, ziel), flaeche: !!w.flaeche });
    if (zielSlot) {
      if (seg0 > 0 && seg1 === 0) t.ereignis('bodenschild_leer', { slot: zielSlot, waffe });
      if (ergebnis === 'gefallen') t.ereignis('gefallen', { slot: zielSlot, waffe, von });
    }
  } catch (err) { /* nie werfen */ }
}
// combat.knockOut: ein Gegner geht zu Boden (liegt oder ist tot). Von/Waffe aus dem letzten Treffer auf ihn
function killBoden(game, e) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t);
    const b = bodenGegnerSehen(game, e, 'kontakt');
    const l = z.letzteBoden.get(e.id) || null;
    if (b) b.n++;
    t.ereignis('kill', { ort: 'boden', gegner: e.id, rolle: bodenRolle(e), von: l ? l.von : 'sonstige', waffe: l ? l.waffe : null, lebte: b ? num(game.time - b.t0) : null, nr: b ? b.n : 1 });
  } catch (err) { /* nie werfen */ }
}
function bodenGegnerWeg(game, e, grund) {
  const t = dienst(game); if (!t) return;
  try {
    const z = zustand(t); const b = z.boden.get(e.id);
    if (!b) return;
    z.boden.delete(e.id); z.letzteBoden.delete(e.id);
    t.ereignis('gegner_weg', { ort: 'boden', gegner: e.id, rolle: b.rolle, grund, lebte: num(game.time - b.t0) });
  } catch (err) { /* nie werfen */ }
}

// ---------- Verluste (Frage 3) ----------
function zoneAus(game, system, zone, zustandNeu, vorher) {
  const t = dienst(game); if (!t) return;
  try { t.ereignis('zone_aus', { system: txt(system, 30), zone: sektorName(zone), zustand: txt(zustandNeu), vorher: txt(vorher) }); } catch (err) { /* nie werfen */ }
}
// Reaktor-Ueberladung: wie 'an' (technikOverload) oder 'ende' (Zeit abgelaufen, Reaktor schaltet ab). Der Verlauf kommt ueber die Zeitreihe.
function ueberladung(game, wie) {
  const t = dienst(game); if (!t) return;
  try { t.ereignis('ueberladung', { wie }); } catch (err) { /* nie werfen */ }
}
// Die Ueberladung endet NICHT durch Ablauf (das ist wie "ende" oben), sondern weil der Reaktor anderweitig umgestellt wird: wie zerstoert (Reaktor zerstoert, Neustart zu zweit),
// sprung (Notsprung setzt ihn zurueck), reset (Szene wird neu aufgestellt), online (Reaktor wieder online). Aufruf VOR der Umstellung; nur wenn er gerade ueberlaedt (nur lesen).
function ueberladungAbgebrochen(game, wie) {
  const t = dienst(game); if (!t) return;
  try { const rc = game.ship && game.ship.reactorCtl; if (rc && rc.state === 'overload') t.ereignis('ueberladung', { wie }); } catch (err) { /* nie werfen */ }
}
function notfall(game, grund) {
  const t = dienst(game); if (!t) return;
  try { t.ereignis('notfall', { grund: txt(grund) }); } catch (err) { /* nie werfen */ }
}
// Spieler geht ohne Waffentreffer zu Boden (Monsterbiss): Treffer ueber waffen.treffer melden ihr 'gefallen' selbst
function gefallenOhneTreffer(game, slot, waffe, von) {
  const t = dienst(game); if (!t) return;
  try { const s = slotVon(slot); if (s) t.ereignis('gefallen', { slot: s, waffe: txt(waffe), von: txt(von) }); } catch (err) { /* nie werfen */ }
}
// GEG-01 A: ein Konvoi-Transporter wollte springen, kann es aber nicht (Antrieb oder Reaktor zerstoert/offline): die Ladung bricht ab bzw. der Sprung wird vereitelt.
// konvoi.sprungVereiteln meldet je Sperre genau einmal; grund = das erste ausgefallene System (antrieb vor reaktor, wie konvoi.kannSpringen). Liest nur.
function konvoiSprungAbgebrochen(game, e) {
  const t = dienst(game); if (!t || !e) return;
  try {
    const Gsys = require('../sim/gegnersystem.js');
    let grund = null;
    for (const art of ['antrieb', 'reaktor']) {
      const id = Gsys.idVon(e, art); const z = id && e.sys[id] ? e.sys[id].z : null;
      if (z === 'broken' || z === 'offline') { grund = art; break; }
    }
    t.ereignis('konvoi_sprung_abgebrochen', { ort: 'raum', gegner: e.id, rolle: e.kind, grund });
  } catch (err) { /* nie werfen */ }
}
function schiffZerstoert(game, n) {
  const t = dienst(game); if (!t) return;
  try { t.ereignis('schiff_zerstoert', { grund: 'reaktor', n: num(n) }); } catch (err) { /* nie werfen */ }
}
// art: 'einzel' (Ausbluten), 'krankenstation', 'team' (squadRecall: slots = alle Betroffenen)
function notrueckholung(game, art, slots) {
  const t = dienst(game); if (!t) return;
  try {
    const l = (slots || []).map(slotVon).filter(Boolean);
    t.ereignis('notrueckholung', { art, slot: l.length === 1 ? l[0] : null, slots: l });
  } catch (err) { /* nie werfen */ }
}

module.exports = {
  szeneStart, szeneEnde, missionStart, missionEnde, welle, welleGeschafft, szeneNeustart,
  quelle, schussRaum, gegnerSystem, schadeBeginn, trefferGegner, trefferLerche, trefferLercheOhneSchaden, trefferMine,
  raumGegner, raumWegGrund, killRaum,
  bodenGegnerSehen, schussBoden, quelleBoden, ueberhitztBoden, ueberhitztRaum, trefferBoden, killBoden, bodenGegnerWeg,
  zoneAus, ueberladung, ueberladungAbgebrochen, notfall, gefallenOhneTreffer, schiffZerstoert, konvoiSprungAbgebrochen, notrueckholung,
  _dienst: dienst,
};
