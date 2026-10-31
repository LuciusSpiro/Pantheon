'use strict';
// SYS-01 C1a-1 „Das Schiff in Zonen“: Systemmodell der Gegner (gleicher Aufbau wie die Lerche, Konzept „Systemmodell Zonen“).
// Daten: content/kampf/gegner-systeme.json (je Klasse fünf Zonen mit Systemen und Gewicht). Zustand je Gegner: e.sys[id] = { z, i }
// (z ok | damaged | broken, i = Integrität in Punkten). Maximum je System = gewicht / Σ gewicht × e.hpMax; e.hpMax ist das Klassenbudget
// (die frühere Hülle: enemies.hp × budgetFaktor; SYS-03 B2: keine Crew-Skalierung mehr). e.hp ist die Summe der Integrität (abgeleitet, wird nie direkt
// abgezogen). Ohne Modell (Störrelais `relay`) bleibt e.hp die alte Hülle.
// SYS-03 B2: Stufenregel statt Punktabzug (gleiche Regel wie die Lerche, interior.js stufeAb/trefferweg). Ein Treffer ohne Schildschutz schaltet ein System genau EINE Stufe weiter (ok -> beschädigt -> zerstört),
// unabhängig von der Schadenszahl. i ist nur noch der aus der Stufe abgeleitete Wert (ok = Maximum, beschädigt = reparatur.damaged × Maximum, zerstört = 0), e.hp = Σ i bleibt die abgeleitete Summe.
// Treffer-Fenster: ein System, das gerade eine Stufe verloren hat (st.tf, nicht im Snapshot), verliert innerhalb von systemModell.trefferFenster_s keine weitere (Integ.imFenster, dieselbe Config-Zahl wie die Lerche);
// der Trefferweg wählt dann ein anderes nicht zerstörtes System der Zone, gibt es keins, verfällt der Treffer. Der Antrieb behält die Sperre (st.sp) und die Immunität (st.imm): i trägt die vorgemerkte Stufe, z holt sie später nach (nachholen).
// Trefferweg: ein zufälliges, nicht zerstörtes System der Zone (game.rng); ist die Zone leer, geht der Treffer in die Mitte.
// SYS-01 C1b-1 (Zielsysteme im Zonenmodell): gezielter Treffer = Wahl statt Zufall. Ist das Systemziel (gez = { id, zugewandt }) in der Zone des Treffers
// und erreichbar (Zone der zugewandten Seite immer, Mitte nur bei leerer zugewandter Zone) und nicht zerstört, trifft der Treffer dieses System sicher.
// Sperre (Daten zielsysteme-werte.json, systeme.<id>.sperre): zwischen zwei Zustandswechseln desselben Systems liegt sperre_s; der Zustand holt
// verzögert nach (nachholen). Immunität (treffer.immunitaet_s) bremst eine Verschlechterung nach einer Reparatur (C2 setzt st.imm, reparaturFertig).
// Wirkungen (nur Gegner mit Modell): Waffe zerstört = schießt nicht, beschädigt = Feuerintervall × taktBeschaedigt (der Takt der Waffenart: taktFaktor);
// Emitter der Seite beschädigt = Schild-Obergrenze × emitterBeschaedigt, zerstört = Schild 0; Schildgenerator zerstört = alle Schilde 0,
// beschädigt = Regeneration regenGeneratorBeschaedigt-mal so langsam; Reaktor zerstört = Countdown (SYS-01 C1a-2, sim/gegnertod.js), dann stirbt der Gegner. Antrieb und Module tragen nur den Zustand (C1b/C2).
// Die Wirkungswerte stehen in shared/config.js (systemModell.gegner, live per `tune systemModell.gegner.<pfad>`), Gewichte und Zonen in den Daten.
const DATEN = require('../../content/kampf/gegner-systeme.json');
const Schilde = require('../../shared/schilde.js');
const Integ = require('./integritaet.js');

const ZONEN = DATEN.zonen;   // bug, stb, heck, bb, mitte
const SEITE_ZONE = ['bug', 'stb', 'heck', 'bb'];   // Seite (shared/schilde.js) -> Zone
const RANG = { ok: 0, damaged: 1, broken: 2 };
const EPS = 1e-9;

const summenCache = new Map();
const ZW = require('../../content/kampf/zielsysteme-werte.json').werte;
const SPERRE_S = ZW.treffer.wert.sperre_s;
const IMMUN_S = ZW.treffer.wert.immunitaet_s;

function systemeVon(kind) { const k = DATEN.klassen[kind]; return k ? k.systeme : null; }
function defOf(kind, id) { const ds = systemeVon(kind); return ds ? ds.find((d) => d.id === id) || null : null; }
function summeGewicht(kind) {
  if (!summenCache.has(kind)) summenCache.set(kind, (systemeVon(kind) || []).reduce((a, d) => a + d.gewicht, 0));
  return summenCache.get(kind);
}
// SYS-01 D: Klassenfaktor auf das Klassenbudget (Daten: klassen.<klasse>.budgetFaktor, Standard 1). Budget = enemies.<klasse>.hp × budgetFaktor (SYS-03 B2: ohne Crew-Skalierung).
function budgetFaktor(kind) { const k = DATEN.klassen[kind]; return k && typeof k.budgetFaktor === 'number' ? k.budgetFaktor : 1; }
// Hat die Gegnerklasse ein Systemmodell? (relay nicht)
function hat(e) { return !!(e && e.sys); }
// Maximum eines Systems: Anteil am Klassenbudget (e.hpMax)
function maxOf(e, id) { const d = defOf(e.kind, id); return d ? d.gewicht / summeGewicht(e.kind) * e.hpMax : 0; }
function wirkung(game) { return (game && game.C && game.C.systemModell && game.C.systemModell.gegner) || {}; }   // Wirkungswerte aus der Config (keine Zahlen im Code)
function schwelle(game) { const v = Number(game && game.C && game.C.systemModell && game.C.systemModell.schwelle); return v > 0 ? v : 0.6; }
function ids(e) { return Object.keys(e.sys); }
function artVon(e, id) { const d = defOf(e.kind, id); return d ? d.art : null; }
function idVon(e, art) { return ids(e).find((id) => artVon(e, id) === art) || null; }
function summe(e) { let v = 0; for (const id of ids(e)) v += e.sys[id].i; return v; }
function frei(e, z) { return ids(e).filter((id) => defOf(e.kind, id).zone === z && e.sys[id].z !== 'broken'); }
// Erreichbarkeit eines Systemziels (SYS-01 C1b-1): Zone der zugewandten Seite immer, Mitte erst wenn die zugewandte Zone keine nicht zerstörten Systeme mehr hat
function erreichbar(e, id, zugewandt) {
  if (!e.sys || !e.sys[id]) return false;
  if (e.sys[id].z === 'broken') return false;   // SYS-01 C2a: ein zerstörtes System ist nicht anwählbar und trifft nicht gezielt
  const z = defOf(e.kind, id).zone;
  return z === zugewandt || (z === 'mitte' && !!zugewandt && frei(e, zugewandt).length === 0);
}
// Sperre und Immunität eines Systems (nur Systeme mit Regel in den Zielsysteme-Daten); gesperrt = Zustand darf sich jetzt nicht verschlechtern
function regelVon(id) { return ZW.systeme.wert[id] || null; }
function gesperrt(game, st, id) {
  const now = game.time;
  const reg = regelVon(id);
  if (!reg) return false;
  if (reg.sperre && st.sp != null && now < st.sp + SPERRE_S) return true;
  return st.imm != null && now < st.imm;
}

// Anlegen beim Spawn: alle Systeme ok mit dem Maximum. e.hp wird die Summe (= Klassenbudget).
function anlegen(e) {
  if (!systemeVon(e.kind)) return e;
  e.sys = {};
  for (const d of systemeVon(e.kind)) e.sys[d.id] = { z: 'ok', i: maxOf(e, d.id) };
  e.hp = e.hpMax;   // = Σ der Maxima (gewicht / Σ gewicht × hpMax); exakt, damit hp === hpMax im Ausgangszustand gilt (keine Gleitkomma-Reste)
  return e;
}

// Gesamtintegrität auf einen Anteil des Klassenbudgets setzen (Verrat: ehemalige Verbündete behalten ihre Hüllen-Quote): jedes System auf anteil × Maximum,
// der Zustand folgt der Schwelle. Ohne Modell die alte Hülle.
function setzeAnteil(game, e, anteil) {
  const a = Math.max(0, Math.min(1, Number(anteil) || 0));
  if (!hat(e)) { e.hp = Math.max(1, Math.round(e.hpMax * a)); return e; }
  for (const id of ids(e)) { const m = maxOf(e, id); e.sys[id].i = m * a; e.sys[id].z = Integ.zustandVon(e.sys[id].i, m, schwelle(game)); delete e.sys[id].tf; }
  e.hp = summe(e);
  return e;
}

// SYS-01 C2b: Klassenbudget neu setzen (Eichung der Szene, Flaggschiff-Faktor): Maximum neu aus dem Budget, alle Systeme voll (wie ein Neuspawn).
// Ohne Modell e.hp = Budget. Ersetzt das frühere `e.hpMax = n; e.hp = n`, das die Systeme auf dem alten Maximum ließ.
function setzeBudget(game, e, budget) {
  e.hpMax = Math.max(1, Math.round(Number(budget) || 1));
  if (!hat(e)) { e.hp = e.hpMax; return e; }
  return setzeAnteil(game, e, 1);
}

// Lebensanzeige: Gesamtintegrität in Prozent der Klasse (früher Hülle in %). Verbraucher: escort (unter_pct), mission (enemyHpBelow).
function integPct(e) { return e.hp / (e.hpMax || 1) * 100; }

// Keine Integrität mehr (mit Modell: alle Systeme zerstört; ohne Modell e.hp ≤ 0). SYS-01 C1a-2: der zerstörte Reaktor ist kein Tod mehr,
// er startet den Countdown (sim/gegnertod.js), der Gegner kämpft weiter.
function tot(e) {
  if (!hat(e)) return !(e.hp > 0);
  return summe(e) <= EPS;
}

// Stufe, die ein System durch die Treffer schon hat (aus i; kann vor st.z liegen, solange Sperre oder Immunität den Zustandswechsel halten)
function stufeVon(game, e, id) { return Integ.zustandVon(e.sys[id].i, maxOf(e, id), schwelle(game)); }
function imFenster(game, e, id) { return Integ.imFenster(game, e.sys[id].tf); }
// Eine Stufe tiefer (Kern ohne Fenster): i = Grundwert der neuen Stufe, Fenster-Stempel; der Zustand z folgt, außer Sperre/Immunität halten ihn (erzwingen: Torpedo, Vollladung).
function stufeSetzen(game, e, id, ziel, erzwingen) {
  const st = e.sys[id];
  st.i = Integ.grundwertVon(ziel, maxOf(e, id), Integ.damagedAnteil(game));
  st.tf = game.time;
  if (RANG[ziel] > RANG[st.z] && (erzwingen || !gesperrt(game, st, id))) { st.z = ziel; st.sp = game.time; }
  e.hp = summe(e);
}
// Rückgabe true = die Stufe hat gewechselt (zerstört bleibt zerstört)
function stufeAb(game, e, id) {
  const jetzt = stufeVon(game, e, id);
  if (jetzt === 'broken') return false;
  stufeSetzen(game, e, id, Integ.naechsteStufe(jetzt), false);
  return true;
}
// Torpedo und Vollladung: das getroffene System ist sicher zerstört (auch im Fenster, auch gegen Sperre/Immunität)
function zerstoeren(game, e, id) {
  if (e.sys[id].z === 'broken') return false;
  stufeSetzen(game, e, id, 'broken', true);
  return true;
}
// Trefferweg ohne Schild: ein zufälliges nicht zerstörtes System der Zone (game.rng), das nicht im Treffer-Fenster steht. Leere Zone -> Mitte. Rückgabe { id, zone, state, vorher, gezielt } oder null
// (kein Ziel, oder alle freien Systeme der Zone stehen im Fenster: der Treffer verfällt, kein Überlauf deswegen). gez = Systemziel der Ops (C1b-1: trifft sicher, wenn in der Zone des Treffers und erreichbar).
// opts: zerstoeren = das getroffene System ist sicher zerstört (Torpedo, Vollladung, kein Fenster); keinUeberlauf = eine leere Zone läuft nicht in die Mitte.
function treffen(game, e, zone, gez, opts) {
  const zerst = !!(opts && opts.zerstoeren);
  const treffbar = (id) => zerst || !imFenster(game, e, id);
  let zielZone = zone;
  let kand = frei(e, zone);
  if (!kand.length && zone !== 'mitte') { if (opts && opts.keinUeberlauf) return null; zielZone = 'mitte'; kand = frei(e, 'mitte'); }
  if (!kand.length) return null;
  let id = null;
  if (gez && e.sys[gez.id] && e.sys[gez.id].z !== 'broken' && treffbar(gez.id) && defOf(e.kind, gez.id).zone === zielZone && erreichbar(e, gez.id, gez.zugewandt)) id = gez.id;
  const gezielt = id !== null;
  if (!gezielt) { kand = kand.filter(treffbar); if (!kand.length) return null; id = game.rng.pick(kand); }
  return treffenAuf(game, e, id, zielZone, gezielt, opts);
}
// Stufe auf ein bestimmtes System (Trefferweg). Rückgabe { id, zone, state, vorher, gezielt }.
function treffenAuf(game, e, id, zielZone, gezielt, opts) {
  const st = e.sys[id];
  e.sysTreffer = (e.sysTreffer || 0) + 1;   // Zähler der Systemtreffer (Verfolgung: Sprungverzögerung)
  const vorher = st.z;
  if (opts && opts.zerstoeren) zerstoeren(game, e, id); else stufeAb(game, e, id);
  return { id, zone: zielZone, state: st.z, vorher, gezielt: !!gezielt };
}
// Torpedo-Durchschlag auf das Hauptsystem (Reaktor): n Stufen ohne Fenster (Integ.stufenAusAnteil aus systemModell.torpedo.reaktorAnteil, dieselbe Umrechnung wie die Lerche). Rückgabe wie treffenAuf.
function durchschlagAuf(game, e, id, stufen) {
  const st = e.sys[id];
  e.sysTreffer = (e.sysTreffer || 0) + 1;
  const vorher = st.z;
  for (let i = 0; i < stufen; i++) if (!stufeAb(game, e, id)) break;
  return { id, zone: 'mitte', state: st.z, vorher, gezielt: false };
}
// Verzögerte Zustandswechsel: der Zustand folgt der Stufe in i, sobald Sperre und Immunität frei sind (Zielsysteme.update, jeden Tick) – eine Stufe je Wechsel (danach gilt die Sperre wieder)
function nachholen(game, e) {
  if (!hat(e)) return;
  for (const id of ids(e)) {
    if (!regelVon(id)) continue;
    const st = e.sys[id];
    const z = stufeVon(game, e, id);
    if (RANG[z] > RANG[st.z] && !gesperrt(game, st, id)) { st.z = Integ.naechsteStufe(st.z); st.sp = game.time; }
  }
}
// Reparatur aus dem Zustand zerstört (C2 ruft das): danach gilt die Immunität, in der ein Treffer den Zustand nicht wieder verschlechtert
function reparaturFertig(game, e, id) {
  const st = e.sys && e.sys[id];
  if (st) st.imm = game.time + IMMUN_S;
}
// Reaktor zerstört (Verfolgung: die Sprungladung bricht ab)
function reaktorZerstoert(e) { if (!hat(e)) return false; const r = idVon(e, 'reaktor'); return !!r && e.sys[r].z === 'broken'; }

// Zustand einer Waffe (Platz) des Gegners: Waffen ohne Platz (raider, sentinel, pylon) haben ein System ohne platz.
function waffeId(e, w) { return ids(e).find((id) => artVon(e, id) === 'waffe' && defOf(e.kind, id).platz === w.platz) || null; }
function waffeZustand(e, w) { if (!hat(e)) return 'ok'; const id = waffeId(e, w); return id ? e.sys[id].z : 'ok'; }
function zerstoertPlatz(e, w) { return waffeZustand(e, w) === 'broken'; }
// Feuerintervall-Faktor eines Feuerpfads (Waffenart): plaetze = Plätze dieser Art (ohne zerstörte). Ist eine davon beschädigt, gilt der Faktor systemModell.gegner.taktBeschaedigt
// auf den Takt des Pfads, sonst 1. Die Pfade haben je Schiff und Art einen gemeinsamen Takt: eine beschädigte Waffe bremst die gleichartigen Plätze mit (kein Zähler, deterministisch).
function taktFaktor(game, e, plaetze) {
  if (!hat(e)) return 1;
  return (plaetze || []).some((w) => waffeZustand(e, w) === 'damaged') ? wirkung(game).taktBeschaedigt : 1;
}

// Schild-Obergrenze je Segment (Index wie e.shields): Emitter der Seite und Schildgenerator wirken. Ohne Modell: das Maximum.
function schildGrenzen(game, e) {
  const max = e.shieldsMax || [];
  if (!hat(e)) return max.slice();
  const lay = Schilde.layout(game.C, e.kind);
  const gen = idVon(e, 'schildgenerator');
  const genZ = gen ? e.sys[gen].z : 'ok';
  return max.map((m, i) => {
    if (genZ === 'broken') return 0;
    const seite = lay && lay.segs[i] ? lay.segs[i].seite : -1;
    const em = SEITE_ZONE[seite] ? ids(e).find((id) => artVon(e, id) === 'emitter' && defOf(e.kind, id).zone === SEITE_ZONE[seite]) : null;
    const ez = em ? e.sys[em].z : 'ok';
    if (ez === 'broken') return 0;
    if (ez === 'damaged') return m * wirkung(game).emitterBeschaedigt;
    return m;
  });
}
// Regenerations-Takt: 1 oder 2 (Schildgenerator beschädigt)
function regenFaktor(game, e) {
  if (!hat(e)) return 1;
  const gen = idVon(e, 'schildgenerator');
  return gen && e.sys[gen].z === 'damaged' ? wirkung(game).regenGeneratorBeschaedigt : 1;
}
// Schilde auf die Obergrenzen kappen (ein Emitter halbiert, ein zerstörter Emitter oder Generator nimmt die Schilde)
function schildPflege(game, e, caps) {
  const C = caps || schildGrenzen(game, e);
  for (let i = 0; i < e.shields.length; i++) if (e.shields[i] > C[i]) e.shields[i] = C[i];
}

// SYS-02b: Schildsegmente der Klasse für ein Schiff ohne Spawn über space.spawnEnemy (Verbündete, escort.js): e.shields, e.shieldsMax, e.regenT. Ohne Eintrag der Klasse keine Schilde.
function schildAnlegen(game, e) {
  const lay = Schilde.layout(game.C, e.kind);
  e.shieldsMax = lay ? lay.max.slice() : [0, 0, 0, 0];
  e.shields = e.shieldsMax.slice();
  e.regenT = 0;
  return e;
}
// SYS-02b: Schild-Pflege und Regeneration je Tick – eine Regel für Gegner (space.updateEnemies) und Verbündete (escort.allySysTick): die Obergrenze je Segment kommt aus
// Emittern und Schildgenerator, 1 Punkt alle enemyShieldRegen × regenFaktor s, der Sturm (e.regenHold) unterdrückt die Regeneration.
function schildTick(game, e, dt) {
  if (!e.shields) return;
  const caps = schildGrenzen(game, e);
  schildPflege(game, e, caps);
  e.regenT = (e.regenT || 0) + dt;
  if (game.time < (e.regenHold || 0)) e.regenT = 0;
  if (e.regenT >= game.C.enemyShieldRegen * regenFaktor(game, e)) {
    e.regenT = 0;
    for (let i = 0; i < e.shields.length; i++) if (e.shields[i] < caps[i]) e.shields[i] = Math.min(caps[i], Math.floor(e.shields[i]) + 1);
  }
}

// Snapshot für das anvisierte Ziel (ship.zielSys): flach [Zustand, Integrität %] je System in der Reihenfolge der Daten; Zustand 0 ok, 1 beschädigt, 2 zerstört.
const ZUST_CODE = { ok: 0, damaged: 1, broken: 2 };
function snapshotZiel(e) {
  if (!hat(e)) return null;
  const out = [];
  for (const d of systemeVon(e.kind)) {
    const st = e.sys[d.id]; const m = maxOf(e, d.id);
    out.push(ZUST_CODE[st.z], m > 0 ? Math.max(0, Math.min(100, Math.round(100 * st.i / m))) : 0);
  }
  return out;
}

// SYS-01 C1b-2 (Ziel-Scan): Zonen des gescannten Gegners für die Anzeige (ship.zielZon). pct = Integrität je Seite in % (wie ship.zonen der Lerche, Σ Punkte / Σ Maximum der
// Systeme der Seite), leer = 1, wenn keine nicht zerstörten Systeme mehr da sind (Erreichbarkeit der Mitte, Trefferweg). Reihenfolge = SEITE_ZONE (0 Bug, 1 Stb, 2 Heck, 3 Bb).
function zonenWerte(e) {
  const pct = [], leer = [];
  for (const z of SEITE_ZONE) {
    let i = 0, m = 0;
    for (const id of ids(e)) if (defOf(e.kind, id).zone === z) { i += e.sys[id].i; m += maxOf(e, id); }
    pct.push(m > 0 ? Math.max(0, Math.min(100, Math.round(100 * i / m))) : 0);
    leer.push(frei(e, z).length === 0 ? 1 : 0);
  }
  return { pct, leer };
}
// Index der Klasse in gegner-systeme.json (Reihenfolge der Schlüssel): ship.zielAufKl
const KLASSEN = Object.keys(DATEN.klassen);
function klasseIndex(kind) { return KLASSEN.indexOf(kind); }

// Zone, in der ein Treffer auf Segment sec landet (Seite des Segments)
function zoneVonSegment(game, e, sec) {
  const lay = Schilde.layout(game.C, e.kind);
  const seite = lay && lay.segs[sec] ? lay.segs[sec].seite : 0;
  return SEITE_ZONE[seite];
}

module.exports = {
  ZONEN, SEITE_ZONE, DATEN, budgetFaktor, systemeVon, defOf, summeGewicht, hat, maxOf, anlegen, integPct, tot, treffen, nachholen, reparaturFertig, reaktorZerstoert, erreichbar,
  treffenAuf, durchschlagAuf, summe, setzeAnteil, setzeBudget, zonenWerte, klasseIndex,
  waffeId, waffeZustand, zerstoertPlatz, taktFaktor, schildGrenzen, regenFaktor, schildPflege, schildAnlegen, schildTick, zoneVonSegment, snapshotZiel, idVon, artVon, ids,
};
