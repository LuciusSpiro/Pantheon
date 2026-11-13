'use strict';
// FAB-01 B: Beat landung (server/sim/faden-landung.js, Daten content/faeden/boden-werte.json und boden-texte.json, Katalog beats.json). Die Erwartungen stehen hier selbst (Daten gelesen, nie aus dem Produktivcode abgeleitet).
//   (a) Katalog: Felder, Katalogzeile hoechstens 400 Zeichen, Daten stimmig, Baustein und Handler angemeldet, Mock nimmt den Beat nicht in Zufallsplaene
//   (b) Pruefer: ohne landeplatz abgelehnt (Plan und Vorlage); der Plan Geruecht -> landung -> abschluss besteht an allen Hexen, an denen die Ort-Art geht
//   (c) Besetzung aus Daten je Variante und Ort-Art (ruhig 0 Gegner, raeuber mindestens 1 Gegner des Raubzugs, belagerer mindestens 2, alle grundtyp); Grep-Test: keine Zahl, kein Fraktionsname im Servercode
//   (d) Funk beim Start nennt den Landeplatz, kein Spielername
//   (e) Merker: die Besetzung entsteht genau einmal je Karte; nach Speichern und Laden (Merker weg, Ort leer) holt das erste beamedDown sie nach
//   (f) Ausgang gelungen: nur nach "unten gewesen" UND niemand mehr unten (ein Spieler, drei, teilweise hoch; Wege ohne beamedUp ueber Taetigkeit und Tick)
//   (g) Scheitern: Frist (am Boden zaehlt keine Taetigkeit), Notsprung, Notrueckholung (alle downed, recall), Faden-Ende
//   (h) Abraeumen nach gelungen und nach gescheitert (auch mit der Crew noch unten), zwei Faeden und zwei Beats nicht verwechseln
//   (i) Rueckfall ohne Modell: Beat startet, nach der Frist scheitert er, Verzweigung -> ende, Abschluss, Ort entstanden und weg, g.errors 0 (die Besetzung bringt keine Raum-Gefahr: der Rueckfall wartet nicht)
// Aufruf: node tools/test-faden-landung.js [begriff ...]        (npm run test:faden-landung)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const space = require('../server/sim/space.js');
const away = require('../server/sim/away.js');
const interior = require('../server/sim/interior.js');
const Lpscan = require('../server/sim/lpscan.js');
const LP = require('../server/sim/landepunkte.js');
const Faden = require('../server/sim/faden.js');
const FD = require('../server/sim/faden-daten.js');
const AO = require('../server/sim/abenteuer-orte.js');
const Bauplan = require('../server/sim/faden-bauplan.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Bausteine = require('../server/sim/faden-bausteine.js');
const Landung = require('../server/sim/faden-landung.js');
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
const TEXTE = lies('content', 'faeden', 'boden-texte.json').texte;

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
  format: 'faden-bauplan/1', titel: 'Absturz im Sektor', anlass: 'Ein Schiff ist abgestuerzt und niemand weiss warum.',
  landeplaetze: [{ id: 'absturz', art, besitz: 'herrenlos', name: 'Absturzstelle' }],
  beats: [{ typ: 'landung', parameter: Object.assign({ landeplatz: 'absturz' }, besetzung ? { besetzung } : {}), verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }],
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
// Aufbau: Spiel, Faden mit laufendem landung-Beat, Ort registriert und gescannt
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
const FRIST = BEATS.landung.frist;

(async () => {
// ---------------------------------------------------------------- (a)
await section('(a) Katalog, Daten, Baustein, Mock', async () => {
  const k = FD.BEATS.landung;
  ok(k && k.baustein === 'landung' && k.gefahr === false && k.optionen === 'keine', 'Beat landung: baustein landung, gefahr false (der Bodenkampf ist keine Raum-Gefahr), keine Optionen');
  ok(Number.isInteger(k.frist) && k.frist >= 1 && !k.abschluss, 'eigene frist in Taetigkeiten: ' + k.frist);
  ok(JSON.stringify(k.braucht.nsc_status) === JSON.stringify(FD.BEATS.notruf.braucht.nsc_status), 'braucht.nsc_status wie notruf');
  ok(k.braucht.landeplatz === true, 'braucht.landeplatz: true (Pflicht)');
  ok(k.parameter.optional.includes('landeplatz') && k.parameter.optional.includes('besetzung') && !k.parameter.pflicht.length, 'parameter.optional: landeplatz und besetzung');
  const bp = k.bauplan;
  ok(bp.parameter.landeplatz && bp.parameter.landeplatz.erlaubt === 'landeplatz', 'bauplan.parameter.landeplatz: erlaubt landeplatz');
  ok(JSON.stringify(bp.parameter.besetzung.erlaubt.slice().sort()) === JSON.stringify(Object.keys(WERTE.besetzung.wert).sort()) && bp.parameter.besetzung.standard === 'ruhig', 'bauplan.parameter.besetzung: erlaubt = Schluessel der Tabelle, Standard ruhig');
  ok(bp.aus.gelungen.status.includes('verbuendet') && bp.aus.gescheitert.status.includes('geflohen') && bp.aus.gelungen.folge[0].grund === 'geholfen', 'bauplan.aus: gelungen verbuendet/aktiv mit geholfen, gescheitert aktiv/geflohen');
  ok(Landung.datenFehler().length === 0, 'Daten stimmig (datenFehler leer)' + (Landung.datenFehler().length ? ': ' + Landung.datenFehler().join(' | ') : ''));
  const kf = Bauplan.katalogFehler();
  ok(kf.length === 0, 'katalogFehler des Expanders leer' + (kf.length ? ': ' + kf.slice(0, 2).join(' | ') : ''));
  const zeile = Prompt.katalogText().split('\n').find((l) => l.startsWith('- landung'));
  ok(!!zeile && zeile.length <= 400, 'Katalogzeile hoechstens 400 Zeichen (' + (zeile ? zeile.length : '?') + ')');
  ok(!!zeile && zeile.includes('Pflicht: landeplatz') && zeile.includes('landeplatz (id)'), 'Katalogzeile nennt landeplatz als Pflicht');
  ok(Bausteine.vonId('landung') === Landung.baustein && !Bausteine.istPlatzhalter('landung'), 'Baustein landung ist registriert (kein Platzhalter)');
  ok(Boden.EREIGNISSE.includes('notsprung'), 'der Verteiler kennt notsprung');
  // der Handler der Art ist am Verteiler angemeldet: ein landung-Beat bekommt ein beamedDown
  const T = await aufbau({ art: 'schiff' });
  const z0 = Boden.zugestellt(T.g);
  T.g.missionEvent('beamedDown', { players: [], map: T.id });
  ok(Boden.zugestellt(T.g) === z0 + 1, 'der Verteiler stellt dem Handler der Art landung zu');
  // Mock: nie landung in Zufallsplaenen (ohne landeplaetze lehnte der Pruefer sie ab)
  let mitLandung = 0, plaene = 0, versuche = 0;
  const expandiere = Bauplan.expandiere;
  Bauplan.expandiere = (p) => { if (p && Array.isArray(p.beats) && p.beats.some((b) => b.typ === 'landung')) versuche++; return expandiere(p); };
  try {
    for (let i = 0; i < 400; i++) { const p = AM.gueltigerPlan(AM.rngVon('landung-probe-' + i), { wiedersehen: true, lage: { sabotage_ziel: 1 } }); plaene++; if (p.beats.some((b) => b.typ === 'landung')) mitLandung++; }
  } finally { Bauplan.expandiere = expandiere; }
  ok(plaene === 400 && mitLandung === 0 && versuche === 0, 'Mock: unter 400 Zufallsplaenen kein Beat landung, nicht einmal als Versuch (braucht.landeplatz nimmt ihn aus planbar aus: die Wuerfelreihe bleibt wie zuvor; Versuche mit landung: ' + versuche + ')');
});

// ---------------------------------------------------------------- (b)
await section('(b) Pruefer: Pflicht landeplatz, Plan an passenden Hexen', async () => {
  const gut = plan('schiff', 'ruhig');
  const rg = Bauplan.pruefe(gut);
  ok(rg.ok, 'Plan mit landeplatz besteht Expander und Pruefer' + (rg.ok ? '' : ': ' + rg.fehler.join(' | ')));
  const ohne = plan('schiff', 'ruhig'); delete ohne.beats[0].parameter.landeplatz; delete ohne.landeplaetze;
  const ro = Bauplan.pruefe(ohne);
  ok(!ro.ok && ro.fehler.some((x) => x.startsWith('LANDEPLATZ_PFLICHT')), 'Plan ohne landeplatz abgelehnt (LANDEPLATZ_PFLICHT): ' + (ro.fehler || []).slice(0, 2).join(' | ').slice(0, 140));
  const v = klon(rg.vorlage); delete v.beats[0].parameter.landeplatz; delete v.landeplaetze;
  const pv = Pruefer.pruefeVorlage(v);
  ok(!pv.ok && pv.fehler.some((x) => x.startsWith('LANDEPLATZ_PFLICHT')), 'pruefeVorlage lehnt einen landung-Beat ohne landeplatz ab (Vorlagen und Plaene gleichermassen)');
  const leer = plan('schiff', 'ruhig'); leer.beats[0].parameter.landeplatz = '';
  ok(!Bauplan.pruefe(leer).ok, 'leerer landeplatz abgelehnt');
  const unbekannt = plan('schiff', 'ruhig'); unbekannt.beats[0].parameter.besetzung = 'gewaltig';
  ok(!Bauplan.pruefe(unbekannt).ok, 'unbekannter Schluessel der besetzung wird vom Expander abgelehnt');
  // Gegenprobe der Anbieten-Pruefung (weltabhaengig): Geruecht -> landung -> abschluss an jedem Hex
  const T = spiel();
  const codes = [];
  for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) { const c = String(a).padStart(2, '0') + String(b).padStart(2, '0'); if (Sektoren.imRaster(c) && Sektoren.spielbar && Sektoren.spielbar(c)) codes.push(c); }
  const mitSzene = codes.filter((h) => Sektoren.hatSzene(h) && !Sektoren.istLeerraum(h));
  ok(mitSzene.length >= 20, 'Aufbau: ' + mitSzene.length + ' spielbare Hexe mit Szene');
  const geruecht = (art) => ({ format: 'faden-bauplan/1', titel: 'Absturz im Sektor', anlass: 'Ein Gerücht spricht von einem Wrack, niemand weiss wo.', landeplaetze: [{ id: 'absturz', art, besitz: 'herrenlos', name: 'Absturzstelle' }], beats: [{ typ: 'geruecht' }, { typ: 'landung', parameter: { landeplatz: 'absturz', besetzung: 'raeuber' } }, { typ: 'abschluss' }] });
  const anbieten = (p, h) => { Faden.zustandVon(T.g).abenteuerAngebote = []; return Faden.abenteuerAnbieten(T.g, p, { hex: h }); };
  let okSchiff = 0;
  for (const h of mitSzene) if (anbieten(geruecht('schiff'), h).ok) okSchiff++;
  ok(okSchiff === mitSzene.filter((h) => AO.moeglicheArten(h).includes('schiff')).length && okSchiff === mitSzene.length, 'Gerücht -> landung(schiff) -> abschluss besteht an allen ' + mitSzene.length + ' Hexen (Raumpunkt-Art, bestanden: ' + okSchiff + ')');
  let okWildnis = 0; const gruende = {};
  for (const h of mitSzene) { const r = anbieten(geruecht('wildnis'), h); if (r.ok) okWildnis++; else { const c = String(r.grund).split(':')[0]; gruende[c] = (gruende[c] || 0) + 1; } }
  const passt = mitSzene.filter((h) => AO.moeglicheArten(h).includes('wildnis')).length;
  ok(okWildnis === 0 && gruende.LANDEPLATZ_VERLEGT === passt && Object.keys(gruende).every((c) => c === 'LANDEPLATZ_VERLEGT' || c === 'LANDEPLATZ_ART'), 'nach einem Gerücht (Ortswechsel) geht wildnis nirgends: LANDEPLATZ_VERLEGT an den ' + passt + ' Hexen mit passender Art, sonst LANDEPLATZ_ART (bestanden: ' + okWildnis + ', ' + JSON.stringify(gruende) + ')');
  let okDirekt = 0, richtig = 0;
  for (const h of mitSzene) { const r = anbieten(plan('wildnis', 'ruhig'), h); if (r.ok) okDirekt++; if (r.ok === AO.moeglicheArten(h).includes('wildnis')) richtig++; }
  ok(richtig === mitSzene.length && okDirekt > 0 && okDirekt < mitSzene.length, 'landung(wildnis) als erster Beat besteht genau an den Hexen mit passender Ort-Art (' + okDirekt + ' von ' + mitSzene.length + ')');
});

// ---------------------------------------------------------------- (c)
await section('(c) Besetzung aus Daten je Variante und Ort-Art', async () => {
  const matrix = [];
  for (const art of ['schiff', 'station', 'wildnis']) for (const bes of ['ruhig', 'raeuber', 'belagerer']) {
    const T = await aufbau({ art, besetzung: bes });
    const d = gegner(T.g, T.id), aw = T.g.aways[T.id];
    const rollen = d.every((e) => e.rolle === 'grundtyp'), fraktion = d.every((e) => e.fraktion === 'raubzug');
    matrix.push(`${art}/${bes}: ${d.length}`);
    ok(T.gestartet && T.f.phase === 'laeuft', `${art}/${bes}: Beat laeuft`);
    if (bes === 'ruhig') ok(d.length === 0 && !(aw && aw.besetzt), `${art}/ruhig: keine Gegner, keine Besetzung eingetragen`);
    if (bes === 'raeuber') ok(d.length >= 1 && fraktion && rollen && aw.besetzt.landung && aw.besetzt.landung.haltung === 'ruhig', `${art}/raeuber: ${d.length} Gegner, alle Raubzug, alle grundtyp (Rollen-Einfuehrung), ruhig`);
    if (bes === 'belagerer') ok(d.length >= 2 && fraktion && rollen && aw.besetzt.landung && aw.besetzt.landung.haltung === 'wach', `${art}/belagerer: ${d.length} Gegner (mindestens 2), alle Raubzug, alle grundtyp, wach`);
    ok(T.g.errors === 0, `${art}/${bes}: g.errors 0` + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
  }
  console.log('  Messung Gegner je Ort-Art/Variante: ' + matrix.join(', '));
  // ohne besetzung im Plan gilt die Standardbesetzung
  const T0 = await aufbau({ art: 'schiff' });
  ok(gegner(T0.g, T0.id).length === 0, 'ohne Parameter besetzung: Standard ruhig, keine Gegner');
});

await section('(c2) Grep-Test: keine Zahl und kein Fraktionsname im Servercode', async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-landung.js'), 'utf8');
  const werte = [];
  for (const e of Object.values(WERTE.besetzung.wert)) for (const v of Object.values(e)) werte.push(String(v));
  const verboten = Array.from(new Set(['raubzug', 'rostmeute', 'herrenlos', 'klein', 'mittel', 'gross'].concat(werte)));
  const treffer = verboten.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(code));
  ok(treffer.length === 0, 'faden-landung.js enthaelt keinen Fraktions-, Staerke- oder Haltungsnamen der Tabelle (' + verboten.join(', ') + ')' + (treffer.length ? ': gefunden ' + treffer.join(', ') : ''));
  const zahlen = code.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\/\/.*$/, '')).filter((l) => (l.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '').match(/(?<![\w.$])\d+(\.\d+)?\b/g) || []).some((z) => z !== '0' && z !== '1'));
  ok(zahlen.length === 0, 'faden-landung.js enthaelt im Code (ohne Kommentare und Texte) keine Zahlenliterale ausser 0 und 1' + (zahlen.length ? ': ' + zahlen.slice(0, 2).join(' | ') : ''));
});

// ---------------------------------------------------------------- (d)
await section('(d) Funk beim Start nennt den Landeplatz', async () => {
  for (const bes of ['ruhig', 'raeuber', 'belagerer']) {
    const T = await aufbau({ art: 'schiff', besetzung: bes });
    const soll = TEXTE['landung_' + bes].replace('{platz}', 'Absturzstelle').replace('{ort}', Sektoren.hexName('0904') || '0904').slice(0, 160);
    const z = T.radio.find((r) => r.text === soll);
    ok(!!z, `${bes}: Funktext aus boden-texte.json mit Landeplatz und Sektor`);
    ok(!!z && z.von === T.f.nsc.name, `${bes}: es spricht der NSC des Fadens`);
    ok(T.radio.every((r) => !/A0/.test(r.text) && !/A0/.test(String(r.von))), `${bes}: kein Spielername im Funk`);
  }
});

// ---------------------------------------------------------------- (e)
await section('(e) Merker: genau eine Besetzung, Nachholen nach Speichern und Laden', async () => {
  const T = await aufbau({ art: 'schiff', besetzung: 'raeuber' });
  const g = T.g, n0 = gegner(g, T.id).length, s0 = Object.keys(g.aways[T.id].squads).length;
  ok(n0 >= 1, 'Aufbau: Besetzung beim Beat-Start (' + n0 + ' Gegner)');
  runter(T, T.id);
  ok(gegner(g, T.id).length === n0 && Object.keys(g.aways[T.id].squads).length === s0, 'Runterbeamen besetzt nicht noch einmal (Merker steht)');
  hoch(T);
  g.missionEvent('beamedDown', { players: [], map: T.id });
  ok(gegner(g, T.id).length === n0, 'ein weiteres beamedDown (zweiter Besuch) besetzt nicht noch einmal');
  // Speichern und Laden: der Merker ist weg, der Ort kommt leer aus dem Faden zurueck
  const T2 = await aufbau({ art: 'schiff', besetzung: 'belagerer' });
  const g2 = T2.g, aw = g2.aways[T2.id];
  ok(aw.drones.length >= 2, 'Aufbau 2: Besetzung steht (' + aw.drones.length + ')');
  Landung.vergessen(g2);   // Laufzeit-Zustand weg wie nach dem Laden
  aw.drones.length = 0; for (const k of Object.keys(aw.squads)) delete aw.squads[k];
  ok(gegner(g2, T2.id).length === 0, 'Aufbau 2: Ort wieder leer');
  g2.missionEvent('beamedDown', { players: [], map: T2.id });
  const nachgeholt = gegner(g2, T2.id).length;
  ok(nachgeholt >= 2, 'erstes beamedDown holt die Besetzung nach (' + nachgeholt + ' Gegner)');
  g2.missionEvent('beamedDown', { players: [], map: T2.id });
  g2.missionEvent('beamedDown', { players: [], map: T2.id });
  ok(gegner(g2, T2.id).length === nachgeholt, 'weitere beamedDown: genau eine Besetzung (idempotent je Karte)');
  ok(g2.errors === 0 && g.errors === 0, 'g.errors 0');
  // ruhig: nichts nachzuholen
  const T3 = await aufbau({ art: 'schiff', besetzung: 'ruhig' });
  Landung.vergessen(T3.g); T3.g.missionEvent('beamedDown', { players: [], map: T3.id });
  ok(gegner(T3.g, T3.id).length === 0 && T3.g.errors === 0, 'ruhig: auch nach dem Nachholen keine Gegner, kein Fehler');
});

// ---------------------------------------------------------------- (f)
await section('(f) Ausgang gelungen', async () => {
  // ohne "unten gewesen" nie
  const A = await aufbau({ art: 'schiff' });
  A.g.missionEvent('beamedUp', { players: [], map: A.id });
  A.g.missionEvent('beamedUp', { players: A.g.players, map: A.id });
  grenzen(A.g, 2); A.run(1);
  ok(A.f.phase === 'laeuft', 'beamedUp ohne vorheriges beamedDown: der Beat laeuft weiter');
  // runter und hoch
  const T = await aufbau({ art: 'schiff', besetzung: 'raeuber' });
  runter(T, T.id);
  ok(untenAnzahl(T.g) === 1 && T.f.phase === 'laeuft', 'unten: der Beat laeuft');
  T.run(3);
  ok(T.f.phase === 'laeuft', 'unten und Zeit vergeht: der Beat laeuft (Tick-Pruefung meldet nichts, solange jemand unten ist)');
  hoch(T);
  ok(T.f.phase === 'wartet' && beatId(T.f) === 'ende' && ereignisse(T.f).includes('landung_gelungen') && !ereignisse(T.f).includes('landung_gescheitert'), 'hoch: Beat gelungen (Gedaechtnis landung_gelungen), weiter zum Abschluss');
  ok(T.g.errors === 0, 'g.errors 0' + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
  // drei Spieler: erst wenn der letzte oben ist
  const C = await aufbau({ art: 'schiff', crew: 3 });
  runter(C, C.id);
  const pids = C.g.players.map((p) => p.id);
  ok(untenAnzahl(C.g) === 3, 'Crew 3: alle unten');
  hoch(C, [pids[0]]);
  hoch(C, [pids[1]]);
  ok(C.f.phase === 'laeuft' && untenAnzahl(C.g) === 1, 'Crew 3: zwei oben, einer unten: der Beat laeuft');
  hoch(C, [pids[2]]);
  ok(C.f.phase === 'wartet' && ereignisse(C.f).includes('landung_gelungen'), 'Crew 3: der letzte oben: gelungen');
  // Wege nach oben ohne beamedUp: Taetigkeit
  const W1 = await aufbau({ art: 'schiff' });
  runter(W1, W1.id);
  for (const p of W1.g.players) interior.placeOnShipPad(W1.g, p, 0);   // wie Verbindung getrennt / resetMap: kein beamedUp
  ok(W1.f.phase === 'laeuft' && !W1.ev.includes('beamedUp'), 'Aufbau: Crew ohne Ereignis oben, der Beat weiss es noch nicht');
  grenzen(W1.g, 1);
  ok(W1.f.phase === 'wartet' && ereignisse(W1.f).includes('landung_gelungen'), 'Taetigkeit: niemand mehr unten -> gelungen (ohne beamedUp)');
  // ... und Tick
  const W2 = await aufbau({ art: 'schiff' });
  runter(W2, W2.id);
  for (const p of W2.g.players) interior.placeOnShipPad(W2.g, p, 0);
  ok(W2.f.phase === 'laeuft', 'Aufbau: Crew ohne Ereignis oben');
  W2.g.step();
  ok(W2.f.phase === 'wartet' && ereignisse(W2.f).includes('landung_gelungen'), 'Tick: niemand mehr unten -> gelungen (ohne beamedUp, ohne Taetigkeit)');
  ok(A.g.errors === 0 && C.g.errors === 0 && W1.g.errors === 0 && W2.g.errors === 0, 'g.errors 0 in allen Laeufen');
});

// ---------------------------------------------------------------- (g)
await section('(g) Scheitern: Frist, Notsprung, Notrueckholung, Faden-Ende', async () => {
  // Frist
  const T = await aufbau({ art: 'schiff' });
  ok(Faden.fristVon(T.f) === FRIST, 'Frist des Beats aus dem Katalog: ' + FRIST + ' Taetigkeiten');
  runter(T, T.id);
  T.run(60);
  ok(T.f.laufend && T.f.laufend.n === 0 && T.f.phase === 'laeuft', 'Messung: 60 s am Boden zaehlen 0 Taetigkeiten (laufend.n ' + (T.f.laufend && T.f.laufend.n) + ')');
  hoch(T, []);   // nichts (leere Liste): die Crew bleibt unten
  grenzen(T.g, FRIST - 1);
  ok(T.f.phase === 'laeuft', 'nach ' + (FRIST - 1) + ' Taetigkeiten laeuft der Beat noch (Crew unten)');
  grenzen(T.g, 1);
  ok(T.f.phase === 'wartet' && beatId(T.f) === 'ende' && ereignisse(T.f).includes('landung_gescheitert'), 'Frist abgelaufen: gescheitert, Verzweigung -> ende');
  // Frist, Crew nie unten
  const T1 = await aufbau({ art: 'schiff' });
  grenzen(T1.g, FRIST);
  ok(T1.f.phase === 'wartet' && ereignisse(T1.f).includes('landung_gescheitert'), 'Frist ohne Landung: gescheitert');
  // Notsprung
  const N = await aufbau({ art: 'schiff', besetzung: 'raeuber' });
  N.g.missionEvent('notsprung', {});
  ok(N.f.phase === 'wartet' && ereignisse(N.f).includes('landung_gescheitert') && beatId(N.f) === 'ende', 'Notsprung im Beat: gescheitert, Verzweigung -> ende');
  const N2 = await aufbau({ art: 'schiff' });
  runter(N2, N2.id);
  N2.g.missionEvent('notsprung', {});
  ok(N2.f.phase === 'wartet' && ereignisse(N2.f).includes('landung_gescheitert'), 'Notsprung mit der Crew unten: gescheitert');
  // Notrueckholung: alle unten downed
  const R = await aufbau({ art: 'schiff', besetzung: 'belagerer' });
  runter(R, R.id);
  for (const p of R.g.players) { p.downed = true; p.hp = 0; }
  R.run(8);
  ok(R.ev.includes('squadRecall') && untenAnzahl(R.g) === 0, 'alle Spieler unten downed: squadRecall holt die Crew hoch');
  ok(R.f.phase === 'wartet' && ereignisse(R.f).includes('landung_gescheitert') && !ereignisse(R.f).includes('landung_gelungen'), 'Notrueckholung (squadRecall mit Marker): gescheitert, nicht gelungen');
  // Notrueckholung einzeln (recall), Crew 1
  const R1 = await aufbau({ art: 'schiff' });
  runter(R1, R1.id);
  ok(away.recall(R1.g, R1.g.players[0].id) === null, 'Aufbau: recall() der Crew 1');
  ok(R1.f.phase === 'wartet' && ereignisse(R1.f).includes('landung_gescheitert'), 'recall() der ganzen Crew: gescheitert');
  // Crew 3: einer per recall geholt, die anderen kommen freiwillig: gelungen, solange nicht die letzte Rueckkehr erzwungen war
  const R3 = await aufbau({ art: 'schiff', crew: 3 });
  runter(R3, R3.id);
  const pids = R3.g.players.map((p) => p.id);
  away.recall(R3.g, pids[0]);
  ok(R3.f.phase === 'laeuft' && untenAnzahl(R3.g) === 2, 'Crew 3: einer notzurueckgeholt, zwei noch unten: der Beat laeuft');
  hoch(R3, [pids[1], pids[2]]);
  ok(R3.f.phase === 'wartet' && ereignisse(R3.f).includes('landung_gelungen'), 'Crew 3: die anderen kommen freiwillig hoch: gelungen');
  // Faden-Ende: der Faden ist weg, der Handler tut nichts, der Takt raeumt den Ort
  const E = await aufbau({ art: 'schiff' });
  runter(E, E.id);
  E.g.weltsim.faeden.liste.splice(0, E.g.weltsim.faeden.liste.length);
  hoch(E);
  E.run(1);
  ok(E.g.errors === 0 && restlos(E.g), 'Faden-Ende (Faden weg): kein Fehler, der Ort wird abgeraeumt');
  ok(T.g.errors === 0 && N.g.errors === 0 && R.g.errors === 0 && R1.g.errors === 0 && R3.g.errors === 0, 'g.errors 0 in allen Laeufen');
});

// ---------------------------------------------------------------- (h)
await section('(h) Abraeumen, zwei Faeden, zwei Beats', async () => {
  for (const wie of ['gelungen', 'gescheitert']) {
    const T = await aufbau({ art: 'schiff', besetzung: 'raeuber' });
    if (wie === 'gelungen') { runter(T, T.id); hoch(T); } else grenzen(T.g, FRIST);
    ok(T.f.phase === 'wartet' && beatId(T.f) === 'ende', wie + ': Beat zu Ende, Abschluss steht aus');
    ok(!restlos(T.g), wie + ': der Ort steht bis zum Abschluss des Fadens (Aufbau der Probe)');
    ok(beatStarten(T.g, T.f) && T.f.phase === 'abgeschlossen', wie + ': Abschluss laeuft, Faden abgeschlossen');
    const r = orteReste(T.g);
    ok(restlos(T.g), wie + ': 0 Orte (' + r.dyn.length + '), keine lpScan-Reste (' + r.scan.length + '), kein Ort in aways (' + r.aways.length + '), away.map nicht der Ort (' + T.g.away.map + ')');
    ok(T.g.errors === 0, wie + ': g.errors 0');
  }
  // gescheitert, Crew noch unten: der Ort bleibt, bis alle oben sind, dann weg
  const U = await aufbau({ art: 'schiff' });
  runter(U, U.id);
  U.g.missionEvent('notsprung', {});
  ok(U.f.phase === 'wartet' && untenAnzahl(U.g) === 1, 'Crew unten, Beat gescheitert');
  ok(beatStarten(U.g, U.f) && U.f.phase === 'abgeschlossen', 'Abschluss laeuft');
  U.run(2);
  ok(!restlos(U.g) && untenAnzahl(U.g) === 1, 'Crew noch unten: der Ort bleibt (kein Abraeumen unter den Fuessen)');
  hoch(U);
  U.run(2);
  ok(restlos(U.g) && U.g.errors === 0, 'Crew oben: der naechste Takt raeumt den Ort restlos ab');
  // zwei Faeden: der Ort des einen beendet nur seinen Beat
  const T = spiel();
  hierHin(T);
  const f1 = oeffnen(T.g, '0904', plan('schiff', 'ruhig'));
  beatStarten(T.g, f1);
  f1.phase = 'abgeschlossen';   // Aufbau: laufend_max ist 1 (ein laufendes Abenteuer), fuer die Probe zaehlt der erste kurz nicht
  const f2 = oeffnen(T.g, '0904', plan('station', 'ruhig'));
  f1.phase = 'laeuft';
  ok(f1.id !== f2.id, 'Aufbau: zwei Faeden ' + f1.id + ' und ' + f2.id);
  beatStarten(T.g, f2);
  const i1 = AO.idVon('skjaldborg', f1.id, 'absturz'), i2 = AO.idVon('skjaldborg', f2.id, 'absturz');
  await tick(8);
  Lpscan.markieren(T.g, i1); Lpscan.markieren(T.g, i2);
  ok(f1.phase === 'laeuft' && f2.phase === 'laeuft', 'beide Beats landung laufen');
  runter(T, i2); hoch(T);
  ok(f2.phase === 'wartet' && ereignisse(f2).includes('landung_gelungen') && f1.phase === 'laeuft', 'Landung am Ort des zweiten Fadens: nur dessen Beat gelungen, der erste laeuft weiter');
  runter(T, i1);
  ok(f1.phase === 'laeuft', 'unten am Ort des ersten Fadens: er laeuft');
  T.g.missionEvent('beamedUp', { players: [], map: i2 });
  ok(f1.phase === 'laeuft', 'ein beamedUp der anderen Karte beendet ihn nicht');
  hoch(T);
  ok(f1.phase === 'wartet' && ereignisse(f1).includes('landung_gelungen'), 'hoch von seiner Karte: gelungen');
  ok(T.g.errors === 0, 'g.errors 0');
  // zwei Beats in einem Plan: "unten gewesen" gilt nur fuer den Beat, in dem es geschah
  const zwei = plan('schiff', 'ruhig');
  zwei.landeplaetze.push({ id: 'zweiter', art: 'schiff', besitz: 'herrenlos', name: 'Zweiter Platz' });
  zwei.beats = [{ typ: 'landung', parameter: { landeplatz: 'absturz', besetzung: 'ruhig' } }, { typ: 'landung', parameter: { landeplatz: 'zweiter', besetzung: 'raeuber' } }, { typ: 'abschluss' }];
  const Z = spiel(); hierHin(Z);
  const fz = oeffnen(Z.g, '0904', zwei);
  beatStarten(Z.g, fz);
  const a1 = AO.idVon('skjaldborg', fz.id, 'absturz'), a2 = AO.idVon('skjaldborg', fz.id, 'zweiter');
  await tick(8); Lpscan.markieren(Z.g, a1);
  runter(Z, a1); hoch(Z);
  ok(fz.phase === 'wartet' && fz.beat === 1, 'zwei Beats: der erste ist gelungen, der zweite steht aus');
  ok(beatStarten(Z.g, fz) && fz.phase === 'laeuft' && fz.laufend.beat === FD.vorlage(fz.vorlage).beats[1].id, 'der zweite landung-Beat laeuft');
  await tick(8);
  Z.g.missionEvent('beamedDown', { players: [], map: a1 });   // der Ort des ersten Beats gehoert demselben Faden, aber nicht diesem Beat
  Z.g.missionEvent('beamedUp', { players: [], map: a1 });
  Z.run(1);
  ok(fz.phase === 'laeuft', 'zwei Beats: Ereignisse der Karte des ersten Beats beenden den zweiten nicht');
  Z.g.missionEvent('beamedUp', { players: [], map: a2 });
  Z.run(1);
  ok(fz.phase === 'laeuft', 'zwei Beats: "unten gewesen" des ersten Beats zaehlt im zweiten nicht (beamedUp ohne eigenes beamedDown)');
  Lpscan.markieren(Z.g, a2); runter(Z, a2); hoch(Z);
  ok(fz.phase === 'wartet' && ereignisse(fz).filter((e) => e === 'landung_gelungen').length === 2, 'zwei Beats: auch der zweite gelungen (Gedaechtnis 2 mal landung_gelungen)');
  ok(Z.g.errors === 0, 'g.errors 0');
});

// ---------------------------------------------------------------- (i)
await section('(i) Rueckfall ohne Modell: Frist, Verzweigung, Abschluss, Ort weg', async () => {
  for (const bes of ['ruhig', 'belagerer']) {
    const T = spiel({ env: RUECKFALL_ENV });
    const g = T.g;
    const hex0 = Sektoren.hexVonOrt(g.ship.scene);
    const ziel = ['0904', '0905', '0806', '0705'].find((h) => h !== hex0 && AO.moeglicheArten(h).includes('schiff') && Sektoren.spielbar(h));
    const p = { format: 'faden-bauplan/1', titel: 'Notruf: Probeschiff', anlass: 'Ein Schiff treibt havariert im All und ruft um Hilfe, niemand sonst antwortet.', landeplaetze: [{ id: 'wrack', art: 'schiff', besitz: 'herrenlos', name: 'Havarist' }],
      beats: [{ typ: 'notruf', parameter: { text_key: 'notruf_havarie' }, verzweigung: { gescheitert: 'ende' } }, { typ: 'landung', parameter: { landeplatz: 'wrack', besetzung: bes }, verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }] };
    const res = Faden.abenteuerNotrufAnbieten(g, p, { hex: ziel });
    ok(res.ok, `${bes}: Angebot am Hex ${ziel}` + (res.ok ? '' : ': ' + (res.fehler || []).join(' | ')));
    const a = res.angebot; a.notruf = { nr: -9, id: 'notruf_hav', marke: 'reise:n-9' };   // wie notrufAngebotAnlegen es setzt
    const ann = Brett.annehmen(g, 'a' + a.nr);
    const f = Faden.zustandVon(g).liste.find((x) => x.vorlage === a.ref);
    ok(!ann && !!f && f.phase === 'laeuft', `${bes}: angenommen, Faden laeuft (${JSON.stringify(ann)})`);
    space.enterScene(g, Sektoren.ortVonHex(ziel), { docked: false });
    const verlauf = []; let ortGesehen = false, gegnerGesehen = 0;
    for (let i = 0; i < 100 && f.phase !== 'abgeschlossen'; i++) {
      g.lageGrenze('andocken');
      for (let k = 0; k < 20; k++) g.step();
      await tick(1);
      verlauf.push(f.beat + f.phase[0]);
      const id = Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).find((x) => AO.parse(x));
      if (id) { ortGesehen = true; gegnerGesehen = Math.max(gegnerGesehen, gegner(g, id).length); }
    }
    console.log(`  Verlauf ${bes}: ${Array.from(new Set(verlauf)).join(',')}`);
    ok(f.phase === 'abgeschlossen', `${bes}: der Faden endet im Rueckfall ohne Crew (${f.phase}, Beat ${f.beat})`);
    ok(ereignisse(f).includes('landung_gescheitert') && !ereignisse(f).includes('landung_gelungen'), `${bes}: landung scheitert nach der Frist (ohne Crew nie gelungen): ${ereignisse(f).join(',')}`);
    ok(ortGesehen && restlos(g), `${bes}: der Ort entstand und ist nach dem Abschluss restlos weg`);
    if (bes === 'belagerer') ok(gegnerGesehen >= 2, `belagerer: der Ort war besetzt (${gegnerGesehen} Gegner), der Rueckfall wartete trotzdem nicht auf einen Raumkampf (gefahr false)`);
    ok(g.errors === 0, `${bes}: g.errors 0` + (T.fehler.length ? ' (' + T.fehler[0] + ')' : ''));
  }
});

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log('FEHLER: ' + fails); process.exit(1); }
console.log('test-faden-landung: alles ok');
})().catch((e) => { console.error(e); process.exit(2); });
