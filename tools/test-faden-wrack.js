'use strict';
// WRK-01 B: Beat wrack (server/sim/faden-wrack.js, Texte content/faeden/wrack-texte.json, Besetzung aus boden-werte.json, Katalog beats.json). Die Erwartungen stehen hier selbst (Daten gelesen, nie aus dem Produktivcode abgeleitet).
//   (a) Katalog: Felder, Katalogzeile hoechstens 440 Zeichen, Daten stimmig, Baustein und Handler angemeldet, Verteiler kennt beuteGeborgen/ankerGelesen, Mock nimmt den Beat nicht in Zufallsplaene
//   (b) Pruefer: ohne landeplatz abgelehnt (Plan, Vorlage, Expander), nur Art schiff, Besetzung nur ruhig/raeuber; Plan besteht an allen spielbaren Hexen mit Szene
//   (c) Besetzung aus Daten (ruhig 0 Gegner, raeuber mindestens 1); Grep-Test: keine Zahl, keine Fraktion, kein Beat-Name ausser dem eigenen im Servercode
//   (d) Funk beim Start (je Besetzung), beim ersten Fund, beim Logbuch, beim Abschluss (vier Varianten), beim Scheitern; kein Spielername; je Ereignis genau einmal
//   (e) Ausgang gelungen: ohne Beute und Logbuch, mit Beute, mit Logbuch, mit beidem; nur nach "unten gewesen" UND niemand mehr unten (ein Spieler, drei; Wege ohne beamedUp ueber Taetigkeit und Tick); Laden vergisst Merker
//   (f) Scheitern: Frist (am Boden zaehlt keine), Notsprung, Notrueckholung (alle downed, recall), Faden-Ende; Ort restlos weg
//   (g) Beute/Logbuch ohne laufenden wrack-Beat: nichts Falsches (anderer Beat, anderer Faden, kein Faden)
//   (h) Rueckfall ohne Modell: Beat startet, nach der Frist scheitert er, Abschluss, Ort entstanden und weg, g.errors 0
// Aufruf: node tools/test-faden-wrack.js [begriff ...]        (npm run test:faden-wrack)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const W = require('../server/world.js');
const space = require('../server/sim/space.js');
const away = require('../server/sim/away.js');
const interior = require('../server/sim/interior.js');
const Anker = require('../server/sim/anker.js');
const Fracht = require('../server/sim/fracht.js');
const Lpscan = require('../server/sim/lpscan.js');
const LP = require('../server/sim/landepunkte.js');
const Faden = require('../server/sim/faden.js');
const FD = require('../server/sim/faden-daten.js');
const AO = require('../server/sim/abenteuer-orte.js');
const Bauplan = require('../server/sim/faden-bauplan.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Bausteine = require('../server/sim/faden-bausteine.js');
const Wrack = require('../server/sim/faden-wrack.js');
const Boden = require('../server/sim/faden-boden.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');
const AM = require('../server/sim/abenteuer-mock.js');
const Brett = require('../server/sim/abenteuer-brett.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
async function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { await fn(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); }
}
const lies = (...p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const BEATS = lies('content', 'faeden', 'beats.json').beats;
const WERTE = lies('content', 'faeden', 'boden-werte.json').werte;
const TEXTE = lies('content', 'faeden', 'wrack-texte.json').texte;
const KAT = require('../server/mission/katalog.js').load().fraktionen;
const trupps = (aw) => Object.keys((aw && aw.squads) || {}).length;

// ---------------------------------------------------------------- Hilfen
const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: '1' };
const RUECKFALL_ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };
const tick = (k) => new Promise((r) => { let i = 0; const s = () => (++i >= (k || 3) ? r() : setImmediate(s)); setImmediate(s); });
function spiel(o) {
  o = o || {};
  const T = F.neuesSpiel({ crew: o.crew || 1, seed: o.seed || 7, env: o.env || ENV });
  const g = T.g;
  T.run = (sek) => { for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) g.step(); };
  T.fehler = [];
  const ce = g.countError.bind(g);
  g.countError = (wo, e) => { T.fehler.push(wo + ': ' + (e && e.message)); return ce(wo, e); };
  T.radio = [];
  const em = g.emit.bind(g);
  g.emit = (e, d) => { if (e === 'radio' && d && d.text) T.radio.push({ von: d.from, text: d.text }); return em(e, d); };
  T.ev = [];
  const me = g.missionEvent.bind(g);
  g.missionEvent = (name, data) => { T.ev.push(name); return me(name, data); };
  return T;
}
const plan = (art, besetzung, extra) => Object.assign({
  format: 'faden-bauplan/1', titel: 'Wrack im Sektor', anlass: 'Ein Schiff liegt havariert im All und niemand weiss warum.',
  landeplaetze: [{ id: 'absturz', art, besitz: 'herrenlos', name: 'Das Wrack' }],
  beats: [{ typ: 'wrack', parameter: Object.assign({ landeplatz: 'absturz' }, besetzung ? { besetzung } : {}), verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }],
}, extra || {});
const grenzen = (g, k) => { for (let i = 0; i < k; i++) g.lageGrenze('andocken'); };
function oeffnen(g, hex, p) {
  Faden.zustandVon(g).abenteuerAngebote = [];
  const a = Faden.abenteuerAnbieten(g, p, { hex });
  if (!a.ok) throw new Error('Angebot: ' + (a.fehler || []).join('; '));
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  if (!r.ok) throw new Error('Oeffnen: ' + r.grund);
  return r.faden;
}
function beatStarten(g, f) {
  for (let i = 0; i < 8; i++) {
    const beat = FD.vorlage(f.vorlage).beats[f.beat].id;
    if (Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat }).ok) return true;
    grenzen(g, 1);
  }
  return false;
}
const hierHin = (T) => { space.enterScene(T.g, 'skjaldborg', { docked: false }); T.run(0.3); };
const stehen = (T, x, y) => { const s = T.g.ship; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; if (s.helm) { s.helm.thrust = 0; s.helm.turn = 0; } T.run(0.2); };
function runter(T, id) {
  const g = T.g, b = LP.info(g, id).beam;
  stehen(T, b.x + 20, b.y);
  const e = g.chooseLandepunkt(g.players[0], id);
  if (e) throw new Error('chooseLandepunkt: ' + e);
  const c = away.canBeam(g, 'down');
  if (!c.ok) throw new Error('canBeam: ' + JSON.stringify(c));
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  T.run(0.5);
}
const hoch = (T, pids) => { away.executeBeam(T.g, pids || T.g.players.map((p) => p.id), 'up'); T.run(0.5); };
const untenAnzahl = (g) => g.players.filter((p) => p.zone === 'away').length;
async function aufbau(o) {
  o = o || {};
  const T = spiel({ crew: o.crew, env: o.env });
  hierHin(T);
  const f = oeffnen(T.g, '0904', o.plan || plan(o.art || 'schiff', o.besetzung));
  T.f = f;
  T.gestartet = beatStarten(T.g, f);
  T.id = AO.idVon('skjaldborg', f.id, 'absturz');
  await tick(8);
  Lpscan.markieren(T.g, T.id);
  return T;
}
const beatId = (f) => FD.vorlage(f.vorlage).beats[f.beat].id;
const ereignisse = (f) => f.nsc.gedaechtnis.map((e) => e.ereignis);
const gegner = (g, id) => { const aw = g.aways[id]; return aw ? aw.drones : []; };
function orteReste(g) {
  return {
    dyn: Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).filter((i) => AO.parse(i)),
    scan: Array.from((g.explore && g.explore.lpScan) || []).filter((i) => AO.parse(i)),
    aways: Object.keys(g.aways || {}).filter((i) => AO.parse(i)),
  };
}
const restlos = (g) => { const r = orteReste(g); return r.dyn.length === 0 && r.scan.length === 0 && r.aways.length === 0 && !(g.away && AO.parse(g.away.map)); };
const FRIST = BEATS.wrack.frist;
function neuLaden(T) {
  const g = T.g, block = klon(Faden.toSave(g.weltsim));
  LP.zuruecksetzen(g);
  g.weltsim.faeden = Faden.lesen(block);
  AO.abgleichen(g);
  T.f = g.weltsim.faeden.liste.find((x) => x.id === T.f.id) || T.f;
}
// Beute und Logbuch: Spieler auf die Kachel des Ankers stellen, E halten (wie der echte Weg), E loslassen
const anker = (map, rolle) => W.AWAY_MAPS[map].karte.anker.filter((a) => a.rolle === rolle);
function halten(T, a, sek) {
  const g = T.g, p = g.players[0];
  p.x = a.x * 32 + 16; p.y = a.y * 32 + 16; if (a.deck != null) p.deck = a.deck;
  interior.onAct(g, p, true);
  for (let i = 0; i < (sek || 3) * CONFIG.tickHz; i++) { g.step(); if (!p.hold) break; }
  interior.onAct(g, p, false);
}
function beuteNehmen(T, i) { const a = anker(T.id, 'beute')[i || 0]; halten(T, a, 3); return Anker.zustand(T.g, T.id, a.id) === 'leer'; }
function logbuchLesen(T) {
  for (const a of anker(T.id, 'terminal')) {
    halten(T, a, 8);   // Download
    if (Anker.zustand(T.g, T.id, a.id) !== 'geladen') continue;
    halten(T, a, 3);   // lesen
    if (T.ev.includes('ankerGelesen')) return true;
  }
  return false;
}
const funkText = (key) => TEXTE[key].replace('{platz}', 'Das Wrack').replace('{ort}', Sektoren.hexName('0904') || '0904').slice(0, 160);
const gesprochen = (T, key) => T.radio.filter((r) => r.text === funkText(key)).length;

(async () => {
// ---------------------------------------------------------------- (a)
await section('(a) Katalog, Daten, Baustein, Verteiler, Mock', async () => {
  const k = FD.BEATS.wrack;
  ok(k && k.baustein === 'wrack' && k.gefahr === false && k.optionen === 'keine', 'Beat wrack: baustein wrack, gefahr false (Bodenkampf ist keine Raum-Gefahr), keine Optionen');
  ok(Number.isInteger(k.frist) && k.frist >= 1 && !k.abschluss, 'eigene frist in Taetigkeiten: ' + k.frist);
  ok(k.braucht.landeplatz === true && JSON.stringify(k.braucht.nsc_status) === JSON.stringify(FD.BEATS.landung.braucht.nsc_status), 'braucht.landeplatz: true, nsc_status wie landung');
  ok(JSON.stringify(k.landeplatz_art) === '["schiff"]', 'landeplatz_art: nur schiff');
  ok(k.parameter.optional.includes('landeplatz') && k.parameter.optional.includes('besetzung') && !k.parameter.pflicht.length, 'parameter.optional: landeplatz und besetzung');
  const bp = k.bauplan;
  ok(bp.parameter.landeplatz && bp.parameter.landeplatz.erlaubt === 'landeplatz', 'bauplan.parameter.landeplatz: erlaubt landeplatz (test-abenteuer-landeplaetze verlangt das)');
  ok(bp.hinweis_traeger === false, 'hinweis_traeger bleibt aus (Hinweis auf das naechste Ziel ist ein eigener Schritt)');
  ok(bp.parameter.besetzung.standard === 'ruhig' && JSON.stringify(bp.parameter.besetzung.erlaubt) === '["ruhig","raeuber"]' && bp.parameter.besetzung.erlaubt.every((e) => Object.prototype.hasOwnProperty.call(WERTE.besetzung.wert, e)), 'bauplan.parameter.besetzung: ruhig (Standard) oder raeuber, Schluessel der Tabelle aus boden-werte.json');
  ok(bp.aus.gelungen.status.includes('verbuendet') && bp.aus.gescheitert.status.includes('geflohen'), 'bauplan.aus: gelungen verbuendet/aktiv, gescheitert aktiv/geflohen');
  ok(Wrack.datenFehler().length === 0, 'Daten stimmig (datenFehler leer)' + (Wrack.datenFehler().length ? ': ' + Wrack.datenFehler().join(' | ') : ''));
  const kf = Bauplan.katalogFehler();
  ok(kf.length === 0, 'katalogFehler des Expanders leer' + (kf.length ? ': ' + kf.slice(0, 2).join(' | ') : ''));
  const zeile = Prompt.katalogText().split('\n').find((l) => l.startsWith('- wrack'));
  ok(!!zeile && zeile.length <= 440, 'Katalogzeile hoechstens 440 Zeichen (' + (zeile ? zeile.length : '?') + ')');
  ok(!!zeile && zeile.includes('Pflicht: landeplatz') && zeile.includes('landeplatz (id)') && zeile.includes('schiff'), 'Katalogzeile nennt landeplatz als Pflicht und die Art schiff');
  ok(Bausteine.vonId('wrack') === Wrack.baustein && !Bausteine.istPlatzhalter('wrack'), 'Baustein wrack ist registriert (kein Platzhalter)');
  ok(Boden.EREIGNISSE.includes('beuteGeborgen') && Boden.EREIGNISSE.includes('ankerGelesen') && Boden.EREIGNISSE.includes('notsprung'), 'der Verteiler kennt beuteGeborgen und ankerGelesen');
  ok(!!lies('content', 'faeden', 'abenteuer-brett.json').schritte.wrack, 'Brett: Klartext fuer den Schritt wrack');
  const T = await aufbau({ art: 'schiff' });
  const z0 = Boden.zugestellt(T.g);
  T.g.missionEvent('beuteGeborgen', { map: T.id, anker: 'x', pid: 'A0' });
  ok(Boden.zugestellt(T.g) === z0 + 1, 'der Verteiler stellt beuteGeborgen dem Handler der Art wrack zu');
  let mitWrack = 0, plaene = 0, versuche = 0;
  const expandiere = Bauplan.expandiere;
  Bauplan.expandiere = (p) => { if (p && Array.isArray(p.beats) && p.beats.some((b) => b.typ === 'wrack')) versuche++; return expandiere(p); };
  try {
    for (let i = 0; i < 400; i++) { const p = AM.gueltigerPlan(AM.rngVon('wrack-probe-' + i), { wiedersehen: true, lage: { sabotage_ziel: 1 } }); plaene++; if (p.beats.some((b) => b.typ === 'wrack')) mitWrack++; }
  } finally { Bauplan.expandiere = expandiere; }
  ok(plaene === 400 && mitWrack === 0 && versuche === 0, 'Mock: unter 400 Zufallsplaenen kein Beat wrack, nicht einmal als Versuch (braucht.landeplatz nimmt ihn aus planbar aus)');
});

// ---------------------------------------------------------------- (b)
await section('(b) Pruefer: Pflicht landeplatz, Art schiff, Plan an passenden Hexen', async () => {
  const rg = Bauplan.pruefe(plan('schiff', 'ruhig'));
  ok(rg.ok, 'Plan mit landeplatz besteht Expander und Pruefer' + (rg.ok ? '' : ': ' + rg.fehler.join(' | ')));
  const ohne = plan('schiff', 'ruhig'); delete ohne.beats[0].parameter.landeplatz; delete ohne.landeplaetze;
  const ro = Bauplan.pruefe(ohne);
  ok(!ro.ok && ro.fehler.some((x) => x.startsWith('LANDEPLATZ_PFLICHT')), 'Plan ohne landeplatz abgelehnt (LANDEPLATZ_PFLICHT): ' + (ro.fehler || []).slice(0, 2).join(' | ').slice(0, 140));
  const v = klon(rg.vorlage); delete v.beats[0].parameter.landeplatz; delete v.landeplaetze;
  const pv = Pruefer.pruefeVorlage(v);
  ok(!pv.ok && pv.fehler.some((x) => x.startsWith('LANDEPLATZ_PFLICHT')), 'pruefeVorlage lehnt einen wrack-Beat ohne landeplatz ab (Prueferseite der Pflicht, FAB-01 Befund B)');
  const ex = Bauplan.expandiere(ohne);
  ok(!ex.ok && ex.fehler.some((x) => x.startsWith('LANDEPLATZ_PFLICHT')), 'der Expander allein lehnt den Plan ohne landeplatz ab (Expander und Pruefer laufen nicht auseinander, FAB-01 Befund B)');
  const leer = plan('schiff', 'ruhig'); leer.beats[0].parameter.landeplatz = '';
  ok(!Bauplan.pruefe(leer).ok, 'leerer landeplatz abgelehnt');
  ok(!Bauplan.pruefe(plan('schiff', 'belagerer')).ok, 'besetzung belagerer ist fuer wrack nicht erlaubt (nur ruhig, raeuber)');
  const T = spiel();
  const codes = [];
  for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) { const c = String(a).padStart(2, '0') + String(b).padStart(2, '0'); if (Sektoren.imRaster(c) && Sektoren.spielbar && Sektoren.spielbar(c)) codes.push(c); }
  const mitSzene = codes.filter((h) => Sektoren.hatSzene(h) && !Sektoren.istLeerraum(h));
  ok(mitSzene.length >= 20, 'Aufbau: ' + mitSzene.length + ' spielbare Hexe mit Szene');
  const anbieten = (p, h) => { Faden.zustandVon(T.g).abenteuerAngebote = []; return Faden.abenteuerAnbieten(T.g, p, { hex: h }); };
  let okSchiff = 0;
  for (const h of mitSzene) if (anbieten(plan('schiff', 'raeuber'), h).ok) okSchiff++;
  ok(okSchiff === mitSzene.length, 'wrack(schiff) besteht an allen ' + mitSzene.length + ' spielbaren Hexen mit Szene (bestanden: ' + okSchiff + ')');
  let gesamt = 0, abgelehnt = 0, artFehler = 0;
  for (const art of ['station', 'wildnis', 'hoehle']) for (const h of mitSzene.slice(0, 12)) {
    const r = anbieten(plan(art, 'ruhig'), h);
    const vorlageBeat = (art === 'station') ? true : AO.moeglicheArten(h).includes(art);   // Kartenart geht am Hex (sonst lehnt schon die Eignung ab)
    if (!vorlageBeat) continue;
    gesamt++;
    if (!r.ok) { abgelehnt++; if (/LANDEPLATZ_ART/.test(String(r.grund || (r.fehler || []).join(' ')))) artFehler++; }
  }
  ok(gesamt > 0 && abgelehnt === gesamt && artFehler === gesamt, 'wrack an einer anderen Kartenart als schiff (station, wildnis, hoehle) wird abgelehnt (LANDEPLATZ_ART): ' + abgelehnt + ' von ' + gesamt);
});

// ---------------------------------------------------------------- (c)
await section('(c) Besetzung aus Daten, Grep-Test', async () => {
  const matrix = [];
  for (const bes of ['ruhig', 'raeuber']) {
    const T = await aufbau({ art: 'schiff', besetzung: bes });
    const d = gegner(T.g, T.id), aw = T.g.aways[T.id];
    matrix.push(`${bes}: ${d.length} Gegner`);
    ok(T.gestartet && T.f.phase === 'laeuft', `${bes}: Beat laeuft`);
    if (bes === 'ruhig') ok(d.length === 0 && !(aw && aw.besetzt), 'ruhig: keine Gegner, keine Besetzung eingetragen');
    else { const e = WERTE.besetzung.wert.raeuber; ok(d.length >= 1 && d.every((x) => x.fraktion === e.fraktion) && trupps(aw) === Number(KAT[e.fraktion].staerke[e.staerke]), `raeuber: ${d.length} Gegner in ${trupps(aw)} Trupps (laut Tabelle ${KAT[e.fraktion].staerke[e.staerke]})`); }
    ok(T.g.errors === 0, `${bes}: g.errors 0` + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
  }
  console.log('  Messung: ' + matrix.join(', '));
  const T0 = await aufbau({ art: 'schiff' });
  ok(gegner(T0.g, T0.id).length === 0, 'ohne Parameter besetzung: Standard ruhig, keine Gegner');
  const T2 = await aufbau({ art: 'schiff', besetzung: 'raeuber' });
  const soll = gegner(T2.g, T2.id).length;
  neuLaden(T2); runter(T2, T2.id);
  T2.g.missionEvent('beamedDown', { players: [], map: T2.id });
  ok(soll >= 1 && gegner(T2.g, T2.id).length === soll && T2.g.errors === 0, 'raeuber nach reset/Laden: erstes beamedDown holt die Besetzung nach, genau einmal (' + gegner(T2.g, T2.id).length + ' von ' + soll + ')');
  // Grep-Test
  const code = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-wrack.js'), 'utf8');
  const werte = [];
  for (const e of Object.values(WERTE.besetzung.wert)) for (const w of Object.values(e)) werte.push(String(w));
  const verboten = Array.from(new Set(['raubzug', 'rostmeute', 'herrenlos', 'klein', 'mittel', 'gross', 'bergungsgut'].concat(werte)));
  const ohneKommentar = code.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
  const treffer = verboten.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(ohneKommentar));
  ok(treffer.length === 0, 'faden-wrack.js enthaelt keinen Fraktions-, Staerke-, Haltungs- oder Warennamen (' + verboten.join(', ') + ')' + (treffer.length ? ': gefunden ' + treffer.join(', ') : ''));
  const zahlen = code.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\/\/.*$/, '')).filter((l) => (l.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '').match(/(?<![\w.$])\d+(\.\d+)?\b/g) || []).some((z) => z !== '0' && z !== '1'));
  ok(zahlen.length === 0, 'faden-wrack.js enthaelt im Code (ohne Kommentare und Texte) keine Zahlenliterale ausser 0 und 1' + (zahlen.length ? ': ' + zahlen.slice(0, 2).join(' | ') : ''));
  const lang = ohneKommentar.split('function datenFehler')[0].split('\n').flatMap((l) => (l.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g) || []).filter((s) => s.length > 62));
  ok(lang.length === 0, 'faden-wrack.js enthaelt keinen langen Text im Code (Funktexte stehen in wrack-texte.json)' + (lang.length ? ': ' + lang[0].slice(0, 60) : ''));
  ok(Object.values(TEXTE).every((t) => t.length <= WERTE.text_max.wert && (t.match(/\{[^}]*\}/g) || []).every((x) => x === '{platz}' || x === '{ort}')), 'wrack-texte.json: nur {platz} und {ort}, alle hoechstens ' + WERTE.text_max.wert + ' Zeichen');
});

// ---------------------------------------------------------------- (d)
await section('(d) Funk: Start, Fund, Logbuch, Abschluss, Scheitern', async () => {
  for (const bes of ['ruhig', 'raeuber']) {
    const T = await aufbau({ art: 'schiff', besetzung: bes });
    const z = T.radio.find((r) => r.text === funkText('start_' + bes));
    ok(!!z, `${bes}: Startfunk aus wrack-texte.json mit Platzname und Sektor`);
    ok(!!z && z.von === T.f.nsc.name, `${bes}: es spricht der NSC des Fadens`);
    ok(T.radio.every((r) => !/A0/.test(r.text) && !/A0/.test(String(r.von))), `${bes}: kein Spielername im Funk`);
  }
  const T = await aufbau({ art: 'schiff' });
  runter(T, T.id);
  ok(gesprochen(T, 'beute') === 0 && gesprochen(T, 'logbuch') === 0, 'unten, noch nichts getan: weder Fund- noch Logbuchfunk');
  ok(beuteNehmen(T) && gesprochen(T, 'beute') === 1, 'erste Beute geborgen: Funk "beute" genau einmal');
  beuteNehmen(T, 1);
  ok(gesprochen(T, 'beute') === 1, 'zweite Beute: kein zweiter Funk');
  ok(logbuchLesen(T) && gesprochen(T, 'logbuch') === 1, 'Logbuch-Terminal gelesen: Funk "logbuch" genau einmal');
  T.g.missionEvent('ankerGelesen', { map: T.id, anker: 'x', pid: 'A0' });
  ok(gesprochen(T, 'logbuch') === 1, 'Logbuch ein zweites Mal gelesen: kein zweiter Funk');
  hoch(T);
  ok(gesprochen(T, 'abschluss_mit_beute_mit_logbuch') === 1 && T.f.phase === 'wartet', 'oben: Abschlussfunk "mit Beute, mit Logbuch" genau einmal');
  const N = await aufbau({ art: 'schiff' }); runter(N, N.id); hoch(N);
  ok(gesprochen(N, 'abschluss_ohne_beute_ohne_logbuch') === 1 && N.f.phase === 'wartet' && ereignisse(N.f).includes('wrack_gelungen'), 'ohne alles: gelungen, Abschlussfunk "ohne Beute, ohne Logbuch"');
  const B = await aufbau({ art: 'schiff' }); runter(B, B.id); beuteNehmen(B); hoch(B);
  ok(gesprochen(B, 'abschluss_mit_beute_ohne_logbuch') === 1 && B.f.phase === 'wartet', 'nur Beute: Abschlussfunk "mit Beute, ohne Logbuch"');
  const L = await aufbau({ art: 'schiff' }); runter(L, L.id); logbuchLesen(L); hoch(L);
  ok(gesprochen(L, 'abschluss_ohne_beute_mit_logbuch') === 1 && L.f.phase === 'wartet', 'nur Logbuch: Abschlussfunk "ohne Beute, mit Logbuch"');
  const S = await aufbau({ art: 'schiff' }); runter(S, S.id); S.g.missionEvent('notsprung', {});
  ok(gesprochen(S, 'scheitern') === 1 && ereignisse(S.f).includes('wrack_gescheitert'), 'Scheitern: Funk "scheitern"');
  ok(T.g.errors === 0 && N.g.errors === 0 && B.g.errors === 0 && L.g.errors === 0 && S.g.errors === 0, 'g.errors 0 in allen Laeufen');
});

// ---------------------------------------------------------------- (e)
await section('(e) Ausgang gelungen', async () => {
  const A = await aufbau({ art: 'schiff' });
  A.g.missionEvent('beamedUp', { players: [], map: A.id });
  grenzen(A.g, 2); A.run(1);
  ok(A.f.phase === 'laeuft', 'beamedUp ohne vorheriges beamedDown: der Beat laeuft weiter');
  const T = await aufbau({ art: 'schiff', besetzung: 'raeuber' });
  runter(T, T.id);
  ok(untenAnzahl(T.g) === 1 && T.f.phase === 'laeuft', 'unten: der Beat laeuft');
  T.run(3);
  ok(T.f.phase === 'laeuft', 'unten und Zeit vergeht: der Beat laeuft (kein Fehlschluss der Tick-Pruefung)');
  hoch(T);
  ok(T.f.phase === 'wartet' && beatId(T.f) === 'ende' && ereignisse(T.f).includes('wrack_gelungen') && !ereignisse(T.f).includes('wrack_gescheitert'), 'hoch ohne Beute und Logbuch: gelungen (Gedaechtnis wrack_gelungen), Beute ist kein Muss');
  ok(T.g.errors === 0, 'g.errors 0' + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
  const B = await aufbau({ art: 'schiff' });
  runter(B, B.id);
  const vor = Fracht.lagerArten(B.g).length;
  ok(beuteNehmen(B) && Fracht.lagerArten(B.g).length > vor, 'Beute: ein beute-Anker am Wrack ist leer, Ware im Lager (' + Fracht.lagerArten(B.g).length + ')');
  ok(B.f.phase === 'laeuft', 'Beute allein beendet den Beat nicht');
  hoch(B);
  ok(B.f.phase === 'wartet' && ereignisse(B.f).includes('wrack_gelungen'), 'mit Beute: nach dem Hochbeamen gelungen');
  const L = await aufbau({ art: 'schiff' });
  runter(L, L.id);
  ok(logbuchLesen(L), 'Logbuch: Terminal geladen und gelesen (ankerGelesen)');
  ok(L.f.phase === 'laeuft', 'Logbuch allein beendet den Beat nicht');
  hoch(L);
  ok(L.f.phase === 'wartet' && ereignisse(L.f).includes('wrack_gelungen'), 'mit Logbuch: gelungen');
  const C = await aufbau({ art: 'schiff', crew: 3 });
  runter(C, C.id);
  const pids = C.g.players.map((p) => p.id);
  ok(untenAnzahl(C.g) === 3, 'Crew 3: alle unten');
  hoch(C, [pids[0]]); hoch(C, [pids[1]]);
  ok(C.f.phase === 'laeuft' && untenAnzahl(C.g) === 1, 'Crew 3: zwei oben, einer unten: der Beat laeuft');
  hoch(C, [pids[2]]);
  ok(C.f.phase === 'wartet' && ereignisse(C.f).includes('wrack_gelungen'), 'Crew 3: der letzte oben: gelungen');
  const W1 = await aufbau({ art: 'schiff' });
  runter(W1, W1.id);
  for (const p of W1.g.players) interior.placeOnShipPad(W1.g, p, 0);
  ok(W1.f.phase === 'laeuft' && !W1.ev.includes('beamedUp'), 'Aufbau: Crew ohne Ereignis oben, der Beat weiss es noch nicht');
  grenzen(W1.g, 1);
  ok(W1.f.phase === 'wartet' && ereignisse(W1.f).includes('wrack_gelungen'), 'Taetigkeit: niemand mehr unten -> gelungen (ohne beamedUp)');
  const W2 = await aufbau({ art: 'schiff' });
  runter(W2, W2.id);
  for (const p of W2.g.players) interior.placeOnShipPad(W2.g, p, 0);
  W2.g.step();
  ok(W2.f.phase === 'wartet' && ereignisse(W2.f).includes('wrack_gelungen'), 'Tick: niemand mehr unten -> gelungen (ohne beamedUp, ohne Taetigkeit)');
  const R = await aufbau({ art: 'schiff' });
  runter(R, R.id); beuteNehmen(R);
  for (const p of R.g.players) interior.placeOnShipPad(R.g, p);
  const fAlt = R.f;
  neuLaden(R);
  R.run(2); grenzen(R.g, 1); R.run(1);
  const f2 = R.g.weltsim.faeden.liste.find((x) => x.id === fAlt.id);
  ok(!!f2 && f2 !== fAlt && f2.phase === 'laeuft' && !ereignisse(f2).includes('wrack_gelungen'), 'nach reset/Laden: kein falsches gelungen (Merker "unten gewesen" ist weg)');
  runter(R, R.id); hoch(R);
  ok(R.g.weltsim.faeden.liste.find((x) => x.id === fAlt.id).phase === 'wartet', 'wer danach wirklich runter und hoch geht, gelingt');
  ok(gesprochen(R, 'abschluss_ohne_beute_ohne_logbuch') === 1, 'der Fund vor dem Laden zaehlt nicht mehr (Merker haengt am Faden-Objekt, nicht im Weltstand)');
  ok([A, T, B, L, C, W1, W2, R].every((x) => x.g.errors === 0), 'g.errors 0 in allen Laeufen');
  // Start am besetzten Platz: die Crew steht unten (frueherer Beat am selben Platz), dann startet wrack dort: "unten gewesen" kommt aus dem echten Zustand, hoch gilt als gelungen
  const U = await aufbau({ art: 'schiff' });
  runter(U, U.id);
  const f = U.f;
  Faden.beatAusgang(U.g, f.id, 'gescheitert');
  ok(untenAnzahl(U.g) === 1, 'Vorbedingung: die Crew steht noch unten');
  f.phase = 'laeuft'; f.beat = 0; f.laufend = { beat: beatId({ vorlage: f.vorlage, beat: 0 }) };
  const r = Wrack.baustein.starten(U.g, f, { beat: FD.vorlage(f.vorlage).beats[0] });
  ok(r && r.laeuft === true, 'wrack startet am Platz, an dem die Crew steht');
  hoch(U);
  ok(U.f.phase === 'wartet' && ereignisse(U.f).includes('wrack_gelungen'), 'hoch gilt als gelungen, auch ohne neues beamedDown (aus dem echten Zustand abgeleitet)');
  // zwei wrack-Beats in einem Plan: der Fund des ersten zaehlt im zweiten nicht, Ereignisse der Karte des ersten beenden den zweiten nicht
  const zwei = plan('schiff', 'ruhig');
  zwei.landeplaetze.push({ id: 'zweiter', art: 'schiff', besitz: 'herrenlos', name: 'Zweites Wrack' });
  zwei.beats = [{ typ: 'wrack', parameter: { landeplatz: 'absturz', besetzung: 'ruhig' } }, { typ: 'wrack', parameter: { landeplatz: 'zweiter', besetzung: 'ruhig' } }, { typ: 'abschluss' }];
  const Z = spiel(); hierHin(Z);
  const fz = oeffnen(Z.g, '0904', zwei);
  beatStarten(Z.g, fz);
  const a1 = AO.idVon('skjaldborg', fz.id, 'absturz'), a2 = AO.idVon('skjaldborg', fz.id, 'zweiter');
  await tick(8); Lpscan.markieren(Z.g, a1);
  Z.id = a1; runter(Z, a1); beuteNehmen(Z); hoch(Z);
  ok(fz.phase === 'wartet' && fz.beat === 1 && gesprochen(Z, 'abschluss_mit_beute_ohne_logbuch') === 1, 'zwei Beats: der erste gelungen mit Beute, der zweite steht aus');
  ok(beatStarten(Z.g, fz) && fz.phase === 'laeuft', 'der zweite wrack-Beat laeuft');
  await tick(8);
  Z.g.missionEvent('beamedDown', { players: [], map: a1 });
  Z.g.missionEvent('beamedUp', { players: [], map: a1 });
  Z.run(1);
  ok(fz.phase === 'laeuft', 'Ereignisse der Karte des ersten Beats beenden den zweiten nicht');
  Lpscan.markieren(Z.g, a2); Z.id = a2; runter(Z, a2); hoch(Z);
  ok(fz.phase === 'wartet' && ereignisse(fz).filter((e) => e === 'wrack_gelungen').length === 2, 'auch der zweite gelungen (Gedaechtnis 2 mal wrack_gelungen)');
  ok(gesprochen(Z, 'abschluss_ohne_beute_ohne_logbuch') === 1, 'der Fund des ersten Beats zaehlt im zweiten nicht: Abschlussfunk "ohne Beute, ohne Logbuch"');
  ok(Z.g.errors === 0 && U.g.errors === 0, 'g.errors 0');
  // Frist-Scheitern mit Fund (faden.js beendet den Beat ohne den Handler): der Fund bleibt nicht fuer den naechsten wrack-Beat stehen
  const Y = spiel(); hierHin(Y);
  const fy = oeffnen(Y.g, '0904', zwei);
  beatStarten(Y.g, fy);
  const y1 = AO.idVon('skjaldborg', fy.id, 'absturz'), y2 = AO.idVon('skjaldborg', fy.id, 'zweiter');
  await tick(8); Lpscan.markieren(Y.g, y1);
  Y.id = y1; runter(Y, y1); beuteNehmen(Y);
  grenzen(Y.g, FRIST);
  ok(fy.phase === 'wartet' && fy.beat === 1 && ereignisse(fy).includes('wrack_gescheitert'), 'Frist mit Beute im Beutel: der erste Beat scheitert (faden.js)');
  hoch(Y);
  ok(beatStarten(Y.g, fy) && fy.phase === 'laeuft', 'der zweite wrack-Beat laeuft');
  await tick(8); Lpscan.markieren(Y.g, y2); Y.id = y2; runter(Y, y2); hoch(Y);
  ok(fy.phase === 'wartet' && gesprochen(Y, 'abschluss_ohne_beute_ohne_logbuch') === 1 && gesprochen(Y, 'abschluss_mit_beute_ohne_logbuch') === 0, 'der Fund des gescheiterten ersten Beats zaehlt im zweiten nicht (Start loescht ihn)');
  ok(Y.g.errors === 0, 'g.errors 0');
});

// ---------------------------------------------------------------- (f)
await section('(f) Scheitern: Frist, Notsprung, Notrueckholung, Faden-Ende', async () => {
  const T = await aufbau({ art: 'schiff' });
  ok(Faden.fristVon(T.f) === FRIST, 'Frist des Beats aus dem Katalog: ' + FRIST + ' Taetigkeiten');
  runter(T, T.id);
  T.run(60);
  ok(T.f.laufend && T.f.laufend.n === 0 && T.f.phase === 'laeuft', 'Messung: 60 s am Boden zaehlen 0 Taetigkeiten');
  grenzen(T.g, FRIST - 1);
  ok(T.f.phase === 'laeuft', 'nach ' + (FRIST - 1) + ' Taetigkeiten laeuft der Beat noch (Crew unten)');
  grenzen(T.g, 1);
  ok(T.f.phase === 'wartet' && beatId(T.f) === 'ende' && ereignisse(T.f).includes('wrack_gescheitert'), 'Frist abgelaufen: gescheitert, Verzweigung -> ende');
  const T1 = await aufbau({ art: 'schiff' });
  grenzen(T1.g, FRIST);
  ok(T1.f.phase === 'wartet' && ereignisse(T1.f).includes('wrack_gescheitert'), 'Frist ohne Besuch: gescheitert');
  const N = await aufbau({ art: 'schiff', besetzung: 'raeuber' });
  N.g.missionEvent('notsprung', {});
  ok(N.f.phase === 'wartet' && ereignisse(N.f).includes('wrack_gescheitert') && beatId(N.f) === 'ende', 'Notsprung im Beat: gescheitert');
  const N2 = await aufbau({ art: 'schiff' });
  runter(N2, N2.id); beuteNehmen(N2);
  N2.g.missionEvent('notsprung', {});
  ok(N2.f.phase === 'wartet' && ereignisse(N2.f).includes('wrack_gescheitert'), 'Notsprung mit der Crew unten und Beute im Lager: gescheitert');
  const R = await aufbau({ art: 'schiff', besetzung: 'raeuber' });
  runter(R, R.id);
  for (const p of R.g.players) { p.downed = true; p.hp = 0; }
  R.run(8);
  ok(R.ev.includes('squadRecall') && untenAnzahl(R.g) === 0, 'alle Spieler unten downed: squadRecall holt die Crew hoch');
  ok(R.f.phase === 'wartet' && ereignisse(R.f).includes('wrack_gescheitert') && !ereignisse(R.f).includes('wrack_gelungen'), 'erzwungene Rueckkehr (squadRecall mit Marker): gescheitert, nicht gelungen');
  const R1 = await aufbau({ art: 'schiff' });
  runter(R1, R1.id); logbuchLesen(R1);
  ok(away.recall(R1.g, R1.g.players[0].id) === null, 'Aufbau: recall() der Crew 1');
  ok(R1.f.phase === 'wartet' && ereignisse(R1.f).includes('wrack_gescheitert'), 'recall() der ganzen Crew (auch nach gelesenem Logbuch): gescheitert');
  const R3 = await aufbau({ art: 'schiff', crew: 3 });
  runter(R3, R3.id);
  const pids = R3.g.players.map((p) => p.id);
  away.recall(R3.g, pids[0]);
  ok(R3.f.phase === 'laeuft' && untenAnzahl(R3.g) === 2, 'Crew 3: einer notzurueckgeholt, zwei noch unten: der Beat laeuft');
  hoch(R3, [pids[1], pids[2]]);
  ok(R3.f.phase === 'wartet' && ereignisse(R3.f).includes('wrack_gelungen'), 'Crew 3: die anderen kommen freiwillig hoch: gelungen');
  const E = await aufbau({ art: 'schiff' });
  runter(E, E.id);
  E.g.weltsim.faeden.liste.splice(0, E.g.weltsim.faeden.liste.length);
  hoch(E); E.run(1);
  ok(E.g.errors === 0 && restlos(E.g), 'Faden-Ende (Faden weg): kein Fehler, der Ort wird abgeraeumt');
  for (const wie of ['gelungen', 'gescheitert']) {
    const X = await aufbau({ art: 'schiff', besetzung: 'raeuber' });
    if (wie === 'gelungen') { runter(X, X.id); beuteNehmen(X); hoch(X); } else grenzen(X.g, FRIST);
    ok(X.f.phase === 'wartet' && !restlos(X.g), wie + ': Beat zu Ende, der Ort steht bis zum Abschluss');
    ok(beatStarten(X.g, X.f) && X.f.phase === 'abgeschlossen', wie + ': Abschluss laeuft');
    const r = orteReste(X.g);
    ok(restlos(X.g), wie + ': 0 Orte (' + r.dyn.length + '), keine lpScan-Reste (' + r.scan.length + '), kein Ort in aways (' + r.aways.length + '), away.map nicht der Ort (' + X.g.away.map + ')');
    ok(X.g.errors === 0, wie + ': g.errors 0');
  }
  const U = await aufbau({ art: 'schiff' });
  runter(U, U.id); U.g.missionEvent('notsprung', {});
  ok(beatStarten(U.g, U.f) && U.f.phase === 'abgeschlossen', 'gescheitert mit der Crew unten, Abschluss laeuft');
  U.run(2);
  ok(!restlos(U.g) && untenAnzahl(U.g) === 1, 'Crew noch unten: der Ort bleibt (kein Abraeumen unter den Fuessen)');
  hoch(U); U.run(2);
  ok(restlos(U.g) && U.g.errors === 0, 'Crew oben: der naechste Takt raeumt restlos ab');
  ok([T, T1, N, N2, R, R1, R3].every((x) => x.g.errors === 0), 'g.errors 0 in allen Laeufen');
});

// ---------------------------------------------------------------- (g)
await section('(g) Beute und Logbuch ohne laufenden wrack-Beat', async () => {
  const pl = plan('schiff', 'ruhig'); pl.beats[0].typ = 'landung';
  const T = await aufbau({ plan: pl });
  runter(T, T.id); beuteNehmen(T); logbuchLesen(T);
  ok(T.f.phase === 'laeuft' && T.ev.includes('beuteGeborgen') && T.ev.includes('ankerGelesen'), 'laeuft ein landung-Beat, bewirken Beute und Logbuch nichts (der Beat laeuft weiter)');
  ok(!Object.keys(TEXTE).some((k) => gesprochen(T, k) > 0 && !k.startsWith('start_')), 'und kein Funktext des wrack-Beats');
  hoch(T);
  ok(ereignisse(T.f).includes('landung_gelungen') && !ereignisse(T.f).some((e) => e.startsWith('wrack_')), 'der landung-Beat gelingt wie zuvor, kein wrack-Gedaechtnis');
  const A = await aufbau({ art: 'schiff' });
  const zA = Boden.zugestellt(A.g);
  A.g.missionEvent('beuteGeborgen', { map: 'eisenwald.siedlung', anker: 'b1', pid: 'A0' });
  A.g.missionEvent('beuteGeborgen', {});
  A.g.missionEvent('ankerGelesen', { map: 'eisenwald.siedlung', anker: 't1', pid: 'A0' });
  A.g.missionEvent('beuteGeborgen', { map: AO.idVon('skjaldborg', 'f99', 'absturz'), anker: 'b1', pid: 'A0' });
  ok(Boden.zugestellt(A.g) === zA, 'der Verteiler stellt sie gar nicht erst zu (Zuordnung ueber die Karte: Faden-Ort eines anderen Fadens, kein Faden-Ort, keine Karte)');
  A.g.missionEvent('beamedDown', { players: [], map: AO.idVon('skjaldborg', A.f.id, 'anderer') });
  A.g.missionEvent('beamedUp', { players: [], map: AO.idVon('skjaldborg', A.f.id, 'anderer') });
  A.g.missionEvent('beuteGeborgen', { map: AO.idVon('skjaldborg', A.f.id, 'anderer'), anker: 'b1', pid: 'A0' });
  A.run(1);
  ok(A.f.phase === 'laeuft' && gesprochen(A, 'beute') === 0, 'Ereignisse eines anderen Ortes desselben Fadens zaehlen nicht (der Handler prueft die Karte)');
  ok(gesprochen(A, 'beute') === 0 && gesprochen(A, 'logbuch') === 0 && A.f.phase === 'laeuft' && A.g.errors === 0, 'Ereignisse fremder Karten und ohne Karte: kein Funk, kein Fehler');
  A.g.missionEvent('beuteGeborgen', { map: A.id, anker: 'b1', pid: 'A0' });
  ok(Boden.zugestellt(A.g) === zA + 4, 'der Verteiler stellt die Ereignisse der eigenen Faden-Orte zu (drei des anderen Ortes, eines der eigenen Karte)');
  const P = F.neuesSpiel({ crew: 1, seed: 7, env: ENV }); const g = P.g;
  g.missionEvent('beuteGeborgen', { map: 'skjaldborg.prise', anker: 'b1', pid: 'A0' });
  g.missionEvent('ankerGelesen', { map: 'skjaldborg.prise', anker: 't1', pid: 'A0' });
  ok(g.errors === 0 && Boden.zugestellt(g) === 0, 'ohne Faden: kein Fehler, nichts zugestellt');
  const g2 = F.neuesSpiel({ crew: 1, seed: 7, env: {} }).g;
  g2.missionEvent('beuteGeborgen', { map: 'x', anker: 'b1', pid: 'A0' });
  ok(g2.errors === 0 && Boden.zugestellt(g2) === 0, 'ohne FAEDEN=1: sofort zurueck');
  const B = await aufbau({ art: 'schiff' });
  runter(B, B.id); hoch(B);
  const n0 = ereignisse(B.f).length;
  B.g.missionEvent('beuteGeborgen', { map: B.id, anker: 'b1', pid: 'A0' });
  B.g.missionEvent('beamedUp', { players: [], map: B.id });
  B.run(1);
  ok(ereignisse(B.f).length === n0 && B.g.errors === 0, 'nach dem Ausgang: weitere Ereignisse erzeugen keinen zweiten Ausgang');
  ok(T.g.errors === 0, 'g.errors 0');
});

// ---------------------------------------------------------------- (h)
await section('(h) Rueckfall ohne Modell: Frist, Verzweigung, Abschluss, Ort weg', async () => {
  for (const bes of ['ruhig', 'raeuber']) {
    const T = spiel({ env: RUECKFALL_ENV });
    const g = T.g;
    const hex0 = Sektoren.hexVonOrt(g.ship.scene);
    const ziel = ['0904', '0905', '0806', '0705'].find((h) => h !== hex0 && AO.moeglicheArten(h).includes('schiff') && Sektoren.spielbar(h));
    const p = { format: 'faden-bauplan/1', titel: 'Notruf: Probeschiff', anlass: 'Ein Schiff treibt havariert im All und ruft um Hilfe, niemand sonst antwortet.', landeplaetze: [{ id: 'wrack', art: 'schiff', besitz: 'herrenlos', name: 'Havarist' }],
      beats: [{ typ: 'notruf', parameter: { text_key: 'notruf_havarie' }, verzweigung: { gescheitert: 'ende' } }, { typ: 'wrack', parameter: { landeplatz: 'wrack', besetzung: bes }, verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }] };
    const res = Faden.abenteuerNotrufAnbieten(g, p, { hex: ziel });
    ok(res.ok, `${bes}: Angebot am Hex ${ziel}` + (res.ok ? '' : ': ' + (res.fehler || []).join(' | ')));
    const a = res.angebot; a.notruf = { nr: -9, id: 'notruf_hav', marke: 'reise:n-9' };
    const ann = Brett.annehmen(g, 'a' + a.nr);
    const f = Faden.zustandVon(g).liste.find((x) => x.vorlage === a.ref);
    ok(!ann && !!f && f.phase === 'laeuft', `${bes}: angenommen, Faden laeuft (${JSON.stringify(ann)})`);
    space.enterScene(g, Sektoren.ortVonHex(ziel), { docked: false });
    const verlauf = []; let ortGesehen = false;
    for (let i = 0; i < 100 && f.phase !== 'abgeschlossen'; i++) {
      g.lageGrenze('andocken');
      for (let k = 0; k < 20; k++) g.step();
      await tick(1);
      verlauf.push(f.beat + f.phase[0]);
      if (Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).some((x) => AO.parse(x))) ortGesehen = true;
    }
    console.log(`  Verlauf ${bes}: ${Array.from(new Set(verlauf)).join(',')}`);
    ok(f.phase === 'abgeschlossen', `${bes}: der Faden endet im Rueckfall ohne Crew (${f.phase}, Beat ${f.beat})`);
    ok(ereignisse(f).includes('wrack_gescheitert') && !ereignisse(f).includes('wrack_gelungen'), `${bes}: wrack scheitert nach der Frist (ohne Crew nie gelungen): ${ereignisse(f).join(',')}`);
    ok(ortGesehen && restlos(g), `${bes}: der Ort entstand und ist nach dem Abschluss restlos weg`);
    ok(g.errors === 0, `${bes}: g.errors 0` + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
  }
});

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log('FEHLER: ' + fails); process.exit(1); }
console.log('test-faden-wrack: alles ok');
})().catch((e) => { console.error(e); process.exit(2); });
