'use strict';
// SYS-01 C1a-1 „Das Schiff in Zonen“: Systemmodell der Gegner (gleicher Aufbau wie die Lerche, Konzept „Systemmodell Zonen“).
// Daten: content/kampf/gegner-systeme.json (je Klasse fünf Zonen mit Systemen und Gewicht). Zustand je Gegner: e.sys[id] = { z, i }
// (z ok | damaged | broken, i = Integrität in Punkten). Maximum je System = gewicht / Σ gewicht × e.hpMax; e.hpMax ist das Klassenbudget
// (die frühere Hülle: enemies.hp × crewScale.enemyHp × spaceM3.enemyHpFactor). e.hp ist die Summe der Integrität (abgeleitet, wird nie direkt
// abgezogen). Ohne Modell (Störrelais `relay`) bleibt e.hp die alte Hülle.
// Trefferweg: ein zufälliges, nicht zerstörtes System der Zone (game.rng); ist die Zone leer, geht der Treffer in die Mitte.
// Wirkungen (nur Gegner mit Modell): Waffe zerstört = schießt nicht, beschädigt = Feuerintervall × taktBeschaedigt (der Takt der Waffenart: taktFaktor);
// Emitter der Seite beschädigt = Schild-Obergrenze × emitterBeschaedigt, zerstört = Schild 0; Schildgenerator zerstört = alle Schilde 0,
// beschädigt = Regeneration regenGeneratorBeschaedigt-mal so langsam; Reaktor zerstört = der Gegner ist tot. Antrieb und Module tragen nur den Zustand (C1b/C1a-2/C2).
// Die Wirkungswerte stehen in shared/config.js (systemModell.gegner, live per `tune systemModell.gegner.<pfad>`), Gewichte und Zonen in den Daten.
const DATEN = require('../../content/kampf/gegner-systeme.json');
const Schilde = require('../../shared/schilde.js');
const Integ = require('./integritaet.js');

const ZONEN = DATEN.zonen;   // bug, stb, heck, bb, mitte
const SEITE_ZONE = ['bug', 'stb', 'heck', 'bb'];   // Seite (shared/schilde.js) -> Zone
const RANG = { ok: 0, damaged: 1, broken: 2 };
const EPS = 1e-9;

const summenCache = new Map();

function systemeVon(kind) { const k = DATEN.klassen[kind]; return k ? k.systeme : null; }
function defOf(kind, id) { const ds = systemeVon(kind); return ds ? ds.find((d) => d.id === id) || null : null; }
function summeGewicht(kind) {
  if (!summenCache.has(kind)) summenCache.set(kind, (systemeVon(kind) || []).reduce((a, d) => a + d.gewicht, 0));
  return summenCache.get(kind);
}
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
  for (const id of ids(e)) { const m = maxOf(e, id); e.sys[id].i = m * a; e.sys[id].z = Integ.zustandVon(e.sys[id].i, m, schwelle(game)); }
  e.hp = summe(e);
  return e;
}

// Lebensanzeige: Gesamtintegrität in Prozent der Klasse (früher Hülle in %). Verbraucher: escort (unter_pct), mission (enemyHpBelow).
function integPct(e) { return e.hp / (e.hpMax || 1) * 100; }

// Zerstörung des Gegners: mit Modell der Reaktor (oder keine Integrität mehr), ohne Modell e.hp ≤ 0
function tot(e) {
  if (!hat(e)) return !(e.hp > 0);
  const r = idVon(e, 'reaktor');
  return (r != null && e.sys[r].z === 'broken') || summe(e) <= EPS;
}

// Trefferweg: ein zufälliges nicht zerstörtes System der Zone (game.rng). Leere Zone -> Mitte. Rückgabe { id, zone } oder null.
function treffen(game, e, zone, schaden) {
  const frei = (z) => ids(e).filter((id) => defOf(e.kind, id).zone === z && e.sys[id].z !== 'broken');
  let zielZone = zone;
  let kand = frei(zone);
  if (!kand.length && zone !== 'mitte') { zielZone = 'mitte'; kand = frei('mitte'); }
  if (!kand.length) return null;
  const id = game.rng.pick(kand);
  const st = e.sys[id];
  st.i = Math.max(0, st.i - Math.max(0, Number(schaden) || 0));
  const z = Integ.zustandVon(st.i, maxOf(e, id), schwelle(game));
  if (RANG[z] > RANG[st.z]) st.z = z;
  e.hp = summe(e);
  return { id, zone: zielZone, state: st.z };
}

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

// Zone, in der ein Treffer auf Segment sec landet (Seite des Segments)
function zoneVonSegment(game, e, sec) {
  const lay = Schilde.layout(game.C, e.kind);
  const seite = lay && lay.segs[sec] ? lay.segs[sec].seite : 0;
  return SEITE_ZONE[seite];
}

module.exports = {
  ZONEN, SEITE_ZONE, DATEN, systemeVon, defOf, summeGewicht, hat, maxOf, anlegen, integPct, tot, treffen, summe, setzeAnteil,
  waffeId, waffeZustand, zerstoertPlatz, taktFaktor, schildGrenzen, regenFaktor, schildPflege, zoneVonSegment, snapshotZiel, idVon, artVon, ids,
};
