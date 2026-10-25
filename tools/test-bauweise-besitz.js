'use strict';
// ORT-01 Paket 4b Teil 1: Bauweise nach Besitzer (zuerst Station), Fraktionen rom und ger, Spielleiter-Anbindung, Labor-Weg.
//  - Ableitung bauweiseFuerBesitz(art, besitz) aus der Datentabelle content/buehnen/achsen.json (bauweise_nach_besitz)
//  - eine Stelle (LP.neu): Vorschau = Anlegen, Debug und Labor nutzen sie; ausdrückliche Bauweise gewinnt
//  - Einfrieren im Weltstand (toSave/restore, Version 3, kein neues Pflichtfeld), Altstand lädt unverändert
//  - Fraktionen rom und ger: Katalog gültig, Rezepte nur aus vorhandenen Gegnerrollen und Figuren, Besetzung gültig
//  - Spielleiter: Bauweise im Vorgabentext, Fraktion = Besitz
//   node tools/test-bauweise-besitz.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const LP = require('../server/sim/landepunkte.js');
const Buehne = require('../shared/buehne.js');
const Katalog = require('../server/mission/katalog.js');
const Szenenbau = require('../server/mission/szenenbau.js');
const Context = require('../server/mission/context.js');
const Weltstand = require('../server/weltstand.js');
const Labor = require('../server/mission/labor.js');
const { Game } = require('../server/game.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');
const sha = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex');
const json = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const frisch = () => ({ seed: 7, aways: {} });

section('Ableitung bauweiseFuerBesitz (Datentabelle, nicht Sonderfall im Code)');
{
  const erwartet = {
    station: { rom: 'rom', ger: 'germanen', konkordat: 'germanen', rostmeute: 'germanen', herrenlos: 'germanen', kontor: 'germanen', raubzug: 'germanen', kustoden: 'germanen' },
    aussenposten: { rom: 'germanen', ger: 'germanen', konkordat: 'germanen', rostmeute: 'germanen', herrenlos: 'germanen', kontor: 'germanen' },
    schiff: { rom: 'germanen', ger: 'germanen', konkordat: 'germanen', rostmeute: 'germanen', herrenlos: 'germanen', kontor: 'germanen' },
    ruine: { rom: 'rom', ger: 'rom', konkordat: 'rom', rostmeute: 'rom', herrenlos: 'rom' },
  };
  const falsch = [];
  for (const [art, m] of Object.entries(erwartet)) for (const [besitz, bw] of Object.entries(m)) if (LP.bauweiseFuerBesitz(art, besitz) !== bw) falsch.push(`${art}/${besitz} = ${LP.bauweiseFuerBesitz(art, besitz)} statt ${bw}`);
  ok(!falsch.length, `Station/Außenposten/Schiff/Ruine × Besitz: ${Object.values(erwartet).reduce((s, m) => s + Object.keys(m).length, 0)} Fälle` + (falsch.length ? ' – ' + falsch.join('; ') : ''));
  ok(LP.bauweiseFuerBesitz('station', undefined) === 'germanen' && LP.bauweiseFuerBesitz('station', null) === 'germanen', 'ohne Besitz: Standard der Kartenart');
  ok(LP.bauweiseFuerBesitz('hand', 'rom') === 'germanen', 'unbekannte Kartenart: Rückfall germanen');
  const A = json('content/buehnen/achsen.json');
  const T = A.bauweise_nach_besitz && A.bauweise_nach_besitz.kartenarten;
  ok(T && T.station && T.station.erlaubt === true && T.station.je_besitz.rom === 'rom', 'Tabelle: station { erlaubt: true, rom → rom }');
  ok(T.aussenposten && T.aussenposten.erlaubt === false && /Cardo|Layout/.test(T.aussenposten.hinweis || ''), 'Tabelle: aussenposten noch nicht freigegeben, Hinweis nennt den Grund (eigenes Layout)');
  ok(T.schiff.erlaubt === false && T.ruine.erlaubt === false, 'Tabelle: Schiff und Ruine nicht freigegeben');
  ok(Object.values(T).every((t) => Object.values(t.je_besitz || {}).every((bw) => A.bauweisen[bw] && A.bauweisen[bw].status === 'aktiv')), 'Tabelle: jede Ziel-Bauweise ist in achsen.bauweisen aktiv');
  ok(A.besitz.rom.status === 'aktiv' && A.besitz.ger.status === 'aktiv', 'achsen.besitz: rom und ger aktiv (rom stand auf spaeter)');
  for (const b of ['rom', 'ger']) ok(fs.existsSync(path.join(ROOT, 'content/buehnen/paletten/' + b + '.json')), `Besitz-Palette content/buehnen/paletten/${b}.json vorhanden`);
  // Freischalten allein per Daten: Außenposten freigeben (nur im Speicher), Ableitung folgt, danach zurück
  const ach = Buehne.daten().achsen;
  const alt = ach.bauweise_nach_besitz.kartenarten.aussenposten.erlaubt;
  try {
    ach.bauweise_nach_besitz.kartenarten.aussenposten.erlaubt = true;
    ok(LP.bauweiseFuerBesitz('aussenposten', 'rom') === 'rom' && LP.bauweiseFuerBesitz('aussenposten', 'kontor') === 'germanen', 'Außenposten per Datenschalter freischaltbar, ohne Codeänderung (Probe im Speicher)');
  } finally { ach.bauweise_nach_besitz.kartenarten.aussenposten.erlaubt = alt; }
  ok(LP.bauweiseFuerBesitz('aussenposten', 'rom') === 'germanen', 'Schalter zurück: Außenposten rom bleibt germanisch');
}

section('LP.neu: Bauweise folgt dem Besitz beim Anlegen');
{
  const g = frisch();
  const st = LP.neu(g, 'kesh', { art: 'station', besitz: 'rom', seed: 11 });
  const ap = LP.neu(g, 'kesh', { art: 'aussenposten', besitz: 'rom', seed: 11 });
  const sk = LP.neu(g, 'kesh', { art: 'schiff', besitz: 'rom', seed: 11 });
  const st2 = LP.neu(g, 'kesh', { art: 'station', besitz: 'kontor', seed: 11 });
  const st3 = LP.neu(g, 'kesh', { art: 'station', seed: 11 });
  const st4 = LP.neu(g, 'kesh', { art: 'station', besitz: 'rom', bauweise: 'germanen', seed: 11 });
  const d = (id) => g.landepunkte.dyn[id];
  ok(d(st).bauweise === 'rom' && d(st).besitz === 'rom', 'Station mit Besitz rom: Bauweise rom');
  ok(d(ap).bauweise === 'germanen', 'Außenposten mit Besitz rom: bleibt germanisch');
  ok(d(sk).bauweise === 'germanen', 'Schiff mit Besitz rom: bleibt germanisch');
  ok(d(st2).bauweise === 'germanen' && d(st3).bauweise === 'germanen' && d(st3).besitz === 'herrenlos', 'Station mit Besitz kontor bzw. ohne Besitz: germanisch');
  ok(d(st4).bauweise === 'germanen', 'ausdrückliche Bauweise gewinnt (Debug, Testgelände)');
  const k = LP.karte(g, st);
  ok(k.art === 'station' && k.bauweise === 'rom' && k.besitz === 'rom', 'gebaute Karte: station, bauweise rom, besitz rom');
  ok(LP.karte(g, st2).bauweise === 'germanen', 'gebaute Karte (kontor): germanen');
}

section('Vorschau = Anlegen (Spielleiter), kein Drift');
{
  const g = Object.assign(frisch(), { landepunkte: undefined });
  const ad = Context.lpAdapter(g);
  const v = ad.vorschau('kesh', { art: 'station', besitz: 'rom' });
  const id = ad.anlegen('kesh', { art: 'station', besitz: 'rom', seed: v.seed });
  ok(id === v.id, `gleiche Kennung (${id})`);
  ok(v.def.bauweise === 'rom' && g.landepunkte.dyn[id].bauweise === v.def.bauweise, 'gleiche Bauweise in Vorschau und Anlegen');
  ok(sha(v.karte) === sha(LP.karte(g, id)), 'gleiche Karte (Hash) in Vorschau und Anlegen');
  const va = ad.vorschau('kesh', { art: 'aussenposten', besitz: 'rom' });
  ok(va.def.bauweise === 'germanen', 'Vorschau Außenposten/rom: germanisch (wie Anlegen)');
}

section('Weltstand: eingefroren, Version 3, kein neues Pflichtfeld');
{
  const g = frisch();
  const id = LP.neu(g, 'kesh', { art: 'station', besitz: 'rom', seed: 23 });
  const vorher = LP.karte(g, id);
  const hashVor = sha(vorher);
  const block = JSON.parse(JSON.stringify(LP.toSave(g)));
  ok(block[id] && block[id].bauweise === 'rom' && block[id].besitz === 'rom' && block[id].art === 'station', 'toSave: bauweise rom und besitz rom im Eintrag');
  const felder = Object.keys(block[id]).sort().join(',');
  const gb = frisch(); const idb = LP.neu(gb, 'kesh', { art: 'station', besitz: 'kontor', seed: 23 });
  ok(Object.keys(LP.toSave(gb)[idb]).sort().join(',') === felder, 'gleiche Feldmenge wie bei einer germanischen Station (kein neues Feld)');
  // Tabelle ändert sich danach: gespeicherter Wert gewinnt (nicht pro Laden neu abgeleitet)
  const ach = Buehne.daten().achsen;
  const alt = ach.bauweise_nach_besitz.kartenarten.station.je_besitz.rom;
  let g2, id2, nachher;
  try {
    ach.bauweise_nach_besitz.kartenarten.station.je_besitz.rom = 'germanen';
    g2 = frisch(); LP.restore(JSON.parse(JSON.stringify(block)), g2);
    nachher = LP.karte(g2, id);
    id2 = LP.eintrag(g2, id);
  } finally { ach.bauweise_nach_besitz.kartenarten.station.je_besitz.rom = alt; }
  ok(id2.bauweise === 'rom' && nachher.bauweise === 'rom', 'nach restore: Bauweise rom, auch wenn die Tabelle inzwischen etwas anderes sagt');
  ok(sha(nachher) === hashVor, 'Karten-Hash nach toSave/restore gleich');
  const g3 = frisch(); LP.restore(JSON.parse(JSON.stringify(LP.toSave(g2))), g3);
  ok(sha(LP.karte(g3, id)) === hashVor && LP.toSave(g3)[id].bauweise === 'rom', 'zweiter Durchlauf (toSave → restore): weiter gleich');
  // Altstand: Eintrag ohne bauweise/besitz (ältere Spielstände) lädt unverändert
  const alter = JSON.parse(JSON.stringify(block)); delete alter[id].bauweise; delete alter[id].besitz;
  const g4 = frisch(); LP.restore(alter, g4);
  const e4 = LP.eintrag(g4, id); const k4 = LP.karte(g4, id);
  ok(e4 && k4 && k4.art === 'station' && k4.bauweise === 'germanen', 'Altstand ohne bauweise: lädt, baut wie bisher germanisch (nicht rückwirkend römisch)');
  const g5 = frisch(); LP.restore({}, g5);
  ok(Object.keys(LP.toSave(g5)).length === 0, 'leerer Block: lädt leer');
  // gesamter Weltstand (Version 3, Schema)
  const G = new Game({ noStore: true, seed: 9, log: () => {} });
  const leer = Weltstand.capture(G);
  const lid = LP.neu(G, 'kesh', { art: 'station', besitz: 'rom', seed: 5 }); LP.get(G, lid);
  const mit = Weltstand.capture(G);
  ok(Weltstand.VERSION === 3 && mit.version === 3 && leer.version === 3, 'Weltstand-Version bleibt 3');
  ok(Object.keys(mit).sort().join() === Object.keys(leer).sort().join() && Object.keys(mit.welt).sort().join() === Object.keys(leer.welt).sort().join(), 'keine neuen Blöcke im Weltstand (Kopf und welt gleich)');
  ok(mit.welt.landepunkte[lid] && mit.welt.landepunkte[lid].bauweise === 'rom', 'welt.landepunkte trägt die römische Station');
  const v = Weltstand.validate(Object.assign({}, mit, { id: 'bauweise-besitz', name: 'Test' }));
  ok(Array.isArray(v) && v.length === 0, 'Weltstand besteht die Schema-Prüfung (id/name gesetzt)' + (v && v.length ? ': ' + v.slice(0, 2).join(' | ') : ''));
}

section('Feste Landepunkte bleiben, wie sie sind');
{
  const g = frisch();
  const fest = ['helix.station', 'hafen.kontor', 'b7.aussenstelle', 'kantenstein.siedlung', 'schrottkante.lager'];
  const defs = LP.defs().byId;
  const sicht = fest.filter((id) => defs[id]);
  ok(sicht.length >= 3 && sicht.every((id) => LP.eintrag(g, id).bauweise === 'germanen' || defs[id].bauweise === 'germanen'), `feste Landepunkte (${sicht.join(', ')}) germanisch`);
  ok(sicht.every((id) => LP.karte(g, id).bauweise === 'germanen'), 'gebaute Karten der festen Landepunkte germanisch (Hash-Baseline prüft die Bytes)');
}

section('Katalog: Fraktionen rom und ger');
{
  const K = Katalog.load();
  ok(!K.fehler.length, 'Katalog lädt ohne Fehler' + (K.fehler.length ? ': ' + K.fehler.slice(0, 2).map((f) => f.msg).join(' | ') : ''));
  const rollen = new Set(Object.values(K.gegner).map((x) => x.rolle));
  const manText = fs.readFileSync(path.join(ROOT, 'public/voxel/manifest.json'), 'utf8');
  for (const id of ['rom', 'ger']) {
    const f = K.fraktionen[id];
    ok(!!f, `Fraktion ${id} im Katalog`);
    if (!f) continue;
    const rz = Object.values(f.rezepte).flat();
    ok(rz.every((t) => rollen.has(t.rolle)), `${id}: Rezepte nutzen nur vorhandene Gegnerrollen (${[...new Set(rz.map((t) => t.rolle))].join(', ')})`);
    ok(Object.values(f.modelle).every((m) => manText.includes('"' + m + '"')), `${id}: Modelle sind vorhandene Figuren (keine neuen Gegnermodelle)`);
    ok(!f.palette || fs.existsSync(path.join(ROOT, 'public/voxel/assets/palettes/' + f.palette + '.json')), `${id}: Palette ${f.palette || '(Standard)'} vorhanden`);
    ok(f.rezepte && Object.keys(f.rezepte).some((r) => (f.einsatz[r] || []).includes('station')), `${id}: mindestens ein Rezept für Kartenart station`);
    ok(Object.keys(f.einsatz).every((r) => f.rezepte[r]), `${id}: einsatz nennt nur vorhandene Rezepte`);
    for (const art of ['station', 'aussenposten']) {
      const r = Katalog.pruefeBesetzung([{ fraktion: id, staerke: 'mittel', haltung: 'wach' }], { katalog: K, kartenart: art, spieler: 3 });
      ok(!r.fehler.length, `pruefeBesetzung(${id}, mittel, wach) auf ${art}: keine Fehler`);
    }
  }
  const rk = K.fraktionen.rom, kt = K.fraktionen.kontor;
  ok(JSON.stringify(rk.staerke) === JSON.stringify(kt.staerke), 'Stärken wie bei den vorhandenen Fraktionen (keine neuen Zahlen)');
  const trupp = (f) => Object.values(f.rezepte).map((t) => t.reduce((s, x) => s + x.n, 0));
  ok(trupp(rk).every((x) => x <= 4) && trupp(K.fraktionen.ger).every((x) => x <= 4), 'Truppgrößen höchstens 4 (wie Kontor/Rostmeute)');
  ok(!K.fraktionen.rom.modelle.waechter, 'rom: menschliche Wachen, keine Kastell-Automaten (die gehören zu herrenlos)');
  // die Umsetzungen, die den Stationskampf tragen, kennen rom und ger als Fraktion
  const u = K.molekuele.stellung_nehmen.umsetzungen.find((x) => x.id === 'trupp_raeumen');
  ok(u.params.fraktion.werte.includes('rom') && u.params.fraktion.werte.includes('ger'), 'stellung_nehmen/trupp_raeumen: Fraktion rom und ger erlaubt');
  ok(Object.values(K.molekuele).every((m) => m.umsetzungen.every((x) => !x.params || !x.params.fraktion || !x.params.fraktion.werte || x.params.fraktion.werte.includes('rom') === x.params.fraktion.werte.includes('ger'))), 'rom und ger stehen immer gemeinsam in den Fraktionswerten');
}

section('Besetzung einer römischen Station im Stationskampf');
{
  const combat = require('../server/sim/combat.js');
  const g = new Game({ noStore: true, seed: 5, log: () => {} });
  const fe = []; g.countError = (w, e) => { fe.push(w + ': ' + (e && e.message)); };
  const id = LP.testgelaende(g, { ort: 'kesh', art: 'station', besitz: 'rom', seed: 3, zustand: 'umkaempft' });
  LP.get(g, id);
  const nn = combat.besetzen(g, { map: id, fraktion: 'rom', staerke: 'mittel', haltung: 'wach', tag: 't' });
  const aw = g.aways[id];
  const K = Katalog.load();
  const rollen = new Set(Object.values(K.gegner).map((x) => x.rolle));
  ok(nn > 0 && aw.drones.length === nn, `besetzen: ${nn} römische Gegner auf ${id}`);
  ok(aw.drones.every((e) => e.fraktion === 'rom' && e.palette === 'rom'), 'alle Gegner: Fraktion rom, Palette rom');
  ok(aw.drones.every((e) => rollen.has(e.rolle || 'grundtyp')), 'Rollen stammen aus dem vorhandenen Gegnerbestand (' + [...new Set(aw.drones.map((e) => e.rolle || 'grundtyp'))].join(', ') + ')');
  ok(aw.besetzt.t && aw.besetzt.t.fraktion === 'rom', 'Besetzungsprotokoll: Fraktion rom');
  const nn2 = combat.besetzen(g, { map: id, fraktion: 'ger', staerke: 'klein', haltung: 'ruhig', tag: 'u' });
  ok(nn2 > 0 && aw.drones.filter((e) => e.tag === 'u').every((e) => e.fraktion === 'ger'), 'Gegenrichtung: Fraktion ger besetzt dieselbe Station');
  ok(!fe.length, 'keine Server-Fehler' + (fe.length ? ' (' + fe.join(' | ') + ')' : ''));
}

section('Spielleiter: Bauweise im Text, Fraktion = Besitz');
{
  const g = new Game({ noStore: true, seed: 6, log: () => {} });
  const id = LP.neu(g, 'kesh', { art: 'station', besitz: 'rom', seed: 8 });
  const ad = Context.lpAdapter(g);
  const info = ad.liste('kesh').find((x) => x.id === id);
  ok(info && info.bauweise === 'rom' && info.besitz === 'rom', 'lp.liste: bauweise rom, besitz rom');
  const b = Szenenbau.sceneBesetzung({ ort: 'kesh', landepunkt: id }, {}, ad);
  ok(b && b.fraktion === 'rom', 'sceneBesetzung: Fraktion = Besitz des Landepunkts (rom)');
  const kontext = { orte: [{ id: 'kesh', landepunkte: [{ id, name: id, art: 'station', bauweise: 'rom', besitz: 'rom', zustand: 'intakt' }, { id: 'x.lager', name: 'x', art: 'aussenposten', bauweise: 'germanen', besitz: 'kontor', zustand: 'intakt' }] }] };
  const text = Szenenbau.grobplanVorgaben({ katalog: Katalog.load() }, kontext, { lp: ad });
  ok(new RegExp(id.replace('.', '\\.') + ' \\(station, rom, rom, intakt\\)').test(text), 'Vorgabentext nennt Kartenart und Bauweise: "station, rom, rom, intakt"');
  ok(/x\.lager \(aussenposten, germanen, kontor, intakt\)/.test(text), 'Vorgabentext: Außenposten germanen');
  const prompt = fs.readFileSync(path.join(ROOT, 'content/spielleiter/prompts/grobplan.system.md'), 'utf8');
  ok(/Station mit Besitz `rom`/.test(prompt) && /römische Station/.test(prompt), 'Prompt-Dokumentation: Station + Besitz rom = römische Station');
  ok(!/spielername|Spielername|player\.name/.test(prompt), 'kein Spielername im Prompt');
  const bw = Szenenbau.grobplanVorgaben({ katalog: Katalog.load() }, { orte: [{ id: 'kesh', landepunkte: [{ id: 'k.hand', name: 'h', art: 'hand', bauweise: null, besitz: null }] }] }, { lp: ad });
  ok(/k\.hand \(Handkarte\)/.test(bw), 'Handkarte ohne Bauweise: Text wie bisher');
}

section('Labor-Weg: römische Station im Stationskampf (buehne)');
{
  const g = new Game({ noStore: true, seed: 12, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 2; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'B' + i, color: i }); cs.push(c); }
  g.lobbyOpts.startMission = 'labor';
  g.lobbyOpts.labor = { id: 'stellung_nehmen/trupp_raeumen', seed: 4, staerke: 'klein', god: true, buehne: { kartenart: 'station', besitz: 'rom', seed: 21 } };
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ok(g.phase === 'play' && g.labor, 'Labor startet auf einer neuen römischen Station');
  const ids = Object.keys((g.landepunkte && g.landepunkte.dyn) || {});
  const id = ids.find((x) => /\.station-/.test(x));
  const d = id && g.landepunkte.dyn[id];
  ok(d && d.bauweise === 'rom' && d.besitz === 'rom' && d.test === true, `Landepunkt ${id}: bauweise rom, besitz rom, als Test markiert (nie im Weltstand)`);
  ok(id && !(id in LP.toSave(g)), 'nicht im Weltstand');
  for (let k = 0; k < 30 * 20; k++) g.step();
  const aw = id && g.aways[id];
  const rom = aw ? aw.drones.filter((e) => e.fraktion === 'rom') : [];
  ok(aw && rom.length > 0 && rom.length === aw.drones.length, `Besetzung: ${rom.length} römische Gegner (alle ${aw ? aw.drones.length : 0})`);
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
  const g2 = new Game({ noStore: true, seed: 12, log: () => {} }); g2.phase = 'play';
  const r3 = Labor.laborStart(g2, 'stellung_nehmen/trupp_raeumen', { buehne: { kartenart: 'hand' } });
  ok(r3.ok === false && /Kartenart/.test(r3.fehler), 'Labor lehnt eine unpassende Kartenart ab');
}

section('Debug buehne: römische Station mit römischen Gegnern in einem Befehl');
{
  const g = new Game({ noStore: true, seed: 14, log: () => {} });
  const fe = []; g.countError = (w, e) => { fe.push(w + ': ' + (e && e.message)); };
  const r = LP.debug(g, 'buehne', ['station', '3', '-', 'rom', 'umkaempft', '-', 'rom'], null);
  const id = Object.keys(g.landepunkte.dyn).find((x) => /\.station-/.test(x));
  const d = id && g.landepunkte.dyn[id], aw = id && g.aways[id];
  ok(r === null && d && d.bauweise === 'rom' && d.besitz === 'rom' && d.test === true, `buehne station 3 - rom umkaempft - rom: ${id} bauweise rom (aus dem Besitz), als Test markiert`);
  ok(aw && aw.drones.length > 0 && aw.drones.every((e) => e.fraktion === 'rom'), `besetzt: ${aw ? aw.drones.length : 0} Gegner der Fraktion rom`);
  ok(!fe.length, 'keine Server-Fehler' + (fe.length ? ' (' + fe.join(' | ') + ')' : ''));
  const g2 = new Game({ noStore: true, seed: 14, log: () => {} });
  LP.debug(g2, 'buehne', ['station', '3', 'germanen', 'rom'], null);
  const id2 = Object.keys(g2.landepunkte.dyn).find((x) => /\.station-/.test(x));
  ok(g2.landepunkte.dyn[id2].bauweise === 'germanen', 'buehne mit ausdrücklicher Bauweise: gewinnt (wie bisher)');
  const r3 = LP.debug(new Game({ noStore: true, seed: 14, log: () => {} }), 'buehne', ['station', '3', '-', 'rom', 'intakt', '-', 'gibtsnicht'], null);
  ok(typeof r3 === 'string', 'unbekannte Fraktion: Fehlermeldung statt stiller Leere');
}

section('Wellen Boden: Station mit Besitz rom (Testgelände-Parameter), Wellen aus Fraktion rom');
{
  const neuesSpiel = (cid, opt) => {
    const g = new Game({ noStore: true, seed: 13, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
    const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: cid, name: cid, color: 0 });
    g.handleMessage(c, Object.assign({ t: 'lobbyOpt', startMission: 'arena_away', wellen: 'station' }, opt));
    g.handleMessage(c, { t: 'ready', ready: true });
    return g;
  };
  const g = neuesSpiel('W0', { arena: { art: 'station', besitz: 'rom', fraktion: 'rom', seed: 4 } });
  const W8 = g.arena && g.arena.wellen;
  const d = W8 && g.landepunkte.dyn[W8.lp];
  ok(W8 && W8.fraktion === 'rom' && d && d.art === 'station' && d.bauweise === 'rom' && d.besitz === 'rom', `Wellen: Karte ${W8 && W8.lp} römisch, Fraktion rom`);
  for (let k = 0; k < 30 * 25; k++) g.step();
  const aw = W8 && g.aways[W8.lp];
  const lebende = aw ? aw.drones.filter((e) => e.alive) : [];
  ok(lebende.length > 0 && lebende.every((e) => e.fraktion === 'rom' && e.palette === 'rom'), `Welle 1: ${lebende.length} Gegner, alle Fraktion rom mit Palette rom`);
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
  const g2 = neuesSpiel('W1', {});
  const V = g2.arena && g2.arena.wellen;
  ok(V && V.fraktion === 'kontor' && g2.landepunkte.dyn[V.lp].bauweise === 'germanen', 'ohne Parameter wie bisher: Station germanisch, Fraktion kontor');
}

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log('TEST BAUWEISE-BESITZ FEHLGESCHLAGEN (' + fails + ')'); process.exit(1); }
console.log('TEST BAUWEISE-BESITZ OK');
process.exit(0);
