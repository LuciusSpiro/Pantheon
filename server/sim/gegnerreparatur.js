'use strict';
// SYS-01 C2a „Reparatur der Gegner“ (Konzept „Systemmodell Zonen“, „Gegner im neuen Modell“; Auftrag Paket C): ein Gegner repariert seine Systeme
// wie die Spieler, mit festen Zeiten (Daten: content/kampf/gegner-systeme.json reparatur.prioritaet, Zeiten: shared/config.js systemModell.gegner.reparatur).
//   tick(game, e, dt)           – je Tick: die Vorgänge (vorgaenge) laufen mit dt; ist eine Stufe fertig, steht das System auf der nächsten Stufe.
//   rueckschlag(game, e, zone)  – Systemtreffer in der Zone: der Fortschritt der Systeme dieser Zone × (1 − rueckschlag) (wie repairHitLoss der Lerche).
//   plaetze(game, e)            – gleichzeitige Vorgänge: 1; + werkstattPlaetze, solange das Werkstatt-Modul lebt; bei zerstörtem Reaktor (ohne Strom) nur 1.
//   vorgaenge(game, e)          – die System-Ids, die gerade repariert werden (Wahl: Reihenfolge prioritaet, Gleichstand Reihenfolge der Daten).
//   zeit(game, e, id)           – Sekunden für die nächste Stufe des Systems: zerstört → beschädigt (Reaktor: reaktorTod.sonderreparatur.zeiten[0]), beschädigt → ok.
// Regeln:
//   - Fortschritt je System (st.rp in s, st.rpVon = Zustand, zu dem er gehört). Ein Wechsel des Zustands durch einen Treffer setzt ihn zurück.
//   - Eine fertige Stufe setzt die Integrität auf den Grundwert (integritaet.grundwertVon: ok = Maximum, beschädigt = systemModell.reparatur.damaged × Maximum),
//     und reparaturFertig setzt die Immunität (Schutz vor einer sofortigen Verschlechterung).
//   - Keine Skalierung mit der Crewgröße. Kein Zufall (game.rng wird nicht benutzt).
//   - Gestellte Gegner (reparaturErlaubt, Verfolgung) reparieren nicht. Gegner ohne Systemmodell (Störrelais) auch nicht. Gegner, die abziehen, reparieren weiter.
//   - Regelabweichung vom Konzept (Entwicklungsleiter, C2a Nacharbeit): Gegner reparieren den REAKTOR nicht selbst (systemModell.gegner.reparatur.reaktor, Standard false, live per `tune`).
//     Ein zerstörter Reaktor ist ein Todesurteil, der Countdown in gegnertod.js läuft ab. Die Rücksprung-Logik dort bleibt (Heilung von außen, Debug). Ist der Schalter an, gilt die Sonderreparatur (12 s).
//   - Klassen-Flag repariert (gegner-systeme.json): Jäger, Korvette, Fregatte, Kreuzer true; Pylon, Wächter, Frachter false (Struktur/Zivil). Relais hat kein Systemmodell.
//   - Verbündete mit e.sys (Konvoi, Schützlinge) bekommen Tempo-Wirkung und Reparatur wie Gegner mit: gewollt, die Festlegung für Verbündete trifft C2b.
const Gsys = require('./gegnersystem.js');
const Integ = require('./integritaet.js');
const Zielsysteme = require('./zielsysteme.js');
const DATEN = require('../../content/kampf/gegner-systeme.json');
const PRIO = DATEN.reparatur.prioritaet;

function cfgR(game) { return (game.C.systemModell && game.C.systemModell.gegner && game.C.systemModell.gegner.reparatur) || {}; }
function anteil(game) { const r = Number((game.C.systemModell.reparatur || {}).damaged); return r > 0 ? r : 0.5; }   // wie interior.integAusZustand

// Werkstatt-Modul des Gegners (Art modul, Modul werkstatt); ohne Reaktor-Strom laufen die Module nicht
function werkstattId(e) { return Gsys.ids(e).find((id) => { const d = Gsys.defOf(e.kind, id); return d.art === 'modul' && d.modul === 'werkstatt'; }) || null; }
function plaetze(game, e) {
  if (Gsys.reaktorZerstoert(e)) return 1;
  const w = werkstattId(e);
  const extra = w && e.sys[w].z !== 'broken' ? (Number(cfgR(game).werkstattPlaetze) || 0) : 0;
  return 1 + extra;
}
function zeit(game, e, id) {
  const st = e.sys[id];
  if (st.z === 'broken') return Gsys.artVon(e, id) === 'reaktor' ? game.C.reaktorTod.sonderreparatur.zeiten[0] : Number(cfgR(game).zerstoertZuBeschaedigt);
  return Number(cfgR(game).beschaedigtZuOk);
}
// Reparaturbedürftige Systeme (nicht ok), nach Priorität der Arten sortiert; bei Gleichstand bleibt die Reihenfolge der Daten
function kandidaten(game, e) {
  const rang = (id) => { const i = PRIO.indexOf(Gsys.artVon(e, id)); return i < 0 ? PRIO.length : i; };
  return Gsys.ids(e).map((id, i) => ({ id, i, r: rang(id) })).filter((k) => e.sys[k.id].z !== 'ok' && (Gsys.artVon(e, k.id) !== 'reaktor' || reaktorRepariert(game))).sort((a, b) => a.r - b.r || a.i - b.i).map((k) => k.id);
}
function vorgaenge(game, e) { return kandidaten(game, e).slice(0, plaetze(game, e)); }

// Klassen-Flag repariert (Daten gegner-systeme.json): Strukturen (Pylon, Wächter, Relais) und Zivil (Frachter) reparieren nicht
function repariert(e) { const k = DATEN.klassen[e.kind]; return !!k && k.repariert !== false; }
// Schalter reaktor (Config, Standard aus): ein zerstörter Reaktor ist für einen Gegner ein Todesurteil, der Countdown läuft ab
function reaktorRepariert(game) { return cfgR(game).reaktor === true; }

function fertig(game, e, id) {
  const st = e.sys[id];
  const neu = st.z === 'broken' ? 'damaged' : 'ok';
  st.z = neu;
  st.i = Integ.grundwertVon(neu, Gsys.maxOf(e, id), anteil(game));
  st.rp = 0; st.rpVon = neu;
  Gsys.reparaturFertig(game, e, id);
  e.hp = Gsys.summe(e);
}

function tick(game, e, dt) {
  if (!Gsys.hat(e) || !repariert(e) || !Zielsysteme.reparaturErlaubt(e)) return;
  for (const id of vorgaenge(game, e)) {
    const st = e.sys[id];
    if (st.rpVon !== st.z) { st.rp = 0; st.rpVon = st.z; }   // Zustand seit dem Vorgang geändert (Treffer): alter Fortschritt gilt nicht
    st.rp = (st.rp || 0) + dt;
    if (st.rp >= zeit(game, e, id)) fertig(game, e, id);
  }
}

function rueckschlag(game, e, zone) {
  if (!Gsys.hat(e)) return;
  const f = 1 - (Number(cfgR(game).rueckschlag) || 0);
  for (const id of Gsys.ids(e)) {
    const st = e.sys[id];
    if (Gsys.defOf(e.kind, id).zone !== zone || !(st.rp > 0) || st.rpVon !== st.z) continue;
    st.rp *= f;
  }
}

module.exports = { repariert, reaktorRepariert, tick, rueckschlag, plaetze, vorgaenge, zeit };
