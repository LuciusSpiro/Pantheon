'use strict';
// TEL-01 B1: Schema-Test des Spielprotokolls. server/telemetrie/schema.js ist die eine Stelle, die Auswertung liest nur das.
// Geprüft wird gegen kurze Bot-Läufe (Raum, Raum mit Wellen, Boden-Wellen, Grabenangriff) und eine Provokation im Spielprozess:
//   - jeder vorkommende Typ steht im Schema, jede Zeile trägt nur Felder aus dem Schema (Sessionkopf ausgenommen, der ist strukturiert),
//   - jedes Feld ist flach (Zahl, Text, Wahrheitswert, null, Liste davon) – nichts wird vom Dienst als „verworfen“ gezählt,
//   - jeder Typ, den das Paket B1 schreibt, kommt mindestens einmal vor (Bot-Läufe oder Provokation) – oder steht in NUR_IM_MENSCHENSPIEL (dann prüft ihn test-telemetrie-b2),
//   - kein Spielername und kein Charaktername irgendwo in den Protokollen (Namenstest über alle Läufe).
// Der Test lädt sich selbst als Preload in die Kindprozesse (-r, Umgebungsvariable B1SCHEMA_OUT): dort umhüllt er Telemetrie.ereignis und
// prüft JEDEN Aufruf gegen das Schema (auch Felder, die der Dienst still verwerfen würde).
//   node tools/test-telemetrie-schema.js   (npm run test:telemetrie-schema)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { SCHEMA } = require('../server/telemetrie/schema.js');
const { Telemetrie } = require('../server/telemetrie/protokoll.js');

const KOPF = new Set(['v', 'typ', 'sitzung', 'tick', 't']);
const flach = (v) => v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ||
  (Array.isArray(v) && v.every((x) => x === null || typeof x === 'boolean' || typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))));

// ---- Preload-Modus: Aufrufe von Telemetrie.ereignis gegen das Schema prüfen, am Prozessende ablegen ----
if (process.env.B1SCHEMA_OUT) {
  anmelden(process.env.B1SCHEMA_OUT);
  return;   // der Test selbst läuft nur im Elternprozess (Preload endet hier; sim-headless wird danach geladen)
}
function anmelden(ziel) {
  const typen = {}; const verstoesse = new Set();
  const orig = Telemetrie.prototype.ereignis;
  Telemetrie.prototype.ereignis = function (typ, felder) {
    typen[typ] = (typen[typ] || 0) + 1;
    const def = SCHEMA[typ];
    if (!def) verstoesse.add('Typ ' + typ + ' steht nicht im Schema');
    else if (felder) {
      for (const k of Object.keys(felder)) {
        if (!def.felder.includes(k)) verstoesse.add(typ + '.' + k + ' steht nicht im Schema');
        if (!flach(felder[k])) verstoesse.add(typ + '.' + k + ' ist nicht flach (' + typeof felder[k] + ')');
      }
    }
    return orig.apply(this, arguments);
  };
  if (ziel) process.on('exit', () => { try { fs.writeFileSync(ziel, JSON.stringify({ typen, verstoesse: [...verstoesse].slice(0, 40) })); } catch (e) { /* egal */ } });
  return { typen, verstoesse };
}

// ===================== Elternprozess =====================
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);

// Typen, die nur im Menschenspiel (bzw. nur mit Weltsim/LLM) erreichbar sind, nicht im Bot-Lauf: getestet in tools/test-telemetrie-b2.js mit gescriptetem Spiel
const NUR_IM_MENSCHENSPIEL = ['ruf', 'spielleiter_warten'];
// Typen, die jeder Lauf dieses Tests sehen muss: alles aus B1 und B2 (Paket A: kopf, session_ende, spieler_*, partie_beendet, tune prüft test-telemetrie.js)
const EIGENE = Object.keys(SCHEMA).filter((t) => SCHEMA[t].frage !== '-' && !['spieler_bei', 'spieler_weg', 'partie_beendet'].includes(t) && !NUR_IM_MENSCHENSPIEL.includes(t));
// Paket-Zuordnung (jeder Typ muss im Schema stehen und vorkommen)
const PAKET_TYPEN = {
  B2: ['buchung', 'deckung', 'energie', 'konsole', 'loeschen', 'reparatur', 'zeitreihe', 'zone_wieder'],
};
// Bot-Namen und Charakternamen der Bots (Wortgrenzen: sonst träfe "Bo" auch "Boden"); der Charaktername ist der Spielername nach Charakter.eindeutigerName
const BOT_NAME = /\b(Ada|Bo|Cem)\b/;
const BOT_ID = /sim-\d+/;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-schema-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });   // auch bei Abbruch oder Ausnahme
const protokollDir = (name) => path.join(TMP, name);

function lauf(name, args, extraEnv) {
  const dir = protokollDir(name);
  const out = path.join(TMP, name + '.pruefung.json');
  const r = spawnSync(process.execPath, ['-r', __filename, path.join('tools', 'sim-headless.js'), ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 480000,
    env: Object.assign({}, process.env, { TELEMETRIE: 'an', TELEMETRIE_DIR: dir, B1SCHEMA_OUT: out }, extraEnv || {}),
  });
  let pruef = { typen: {}, verstoesse: ['keine Prüfdatei'] };
  try { pruef = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { /* bleibt */ }
  return { status: r.status, text: (r.stdout || '') + (r.stderr || ''), dir, pruef };
}
function zeilen(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) out.push(JSON.parse(l));
  }
  return out;
}

const vorgekommen = {};   // typ -> Anzahl (aus allen Dateien)
const verstoesse = [];
function pruefeDateien(name, dir) {
  const z = zeilen(dir);
  ok(z.length > 0, name + ': Protokolldateien da (' + z.length + ' Zeilen)');
  let unbekannt = 0, fremd = 0, nichtFlach = 0;
  for (const x of z) {
    vorgekommen[x.typ] = (vorgekommen[x.typ] || 0) + 1;
    const def = SCHEMA[x.typ];
    if (!def) { unbekannt++; verstoesse.push(name + ': Typ ' + x.typ); continue; }
    for (const k of Object.keys(x)) {
      if (KOPF.has(k)) continue;
      if (!def.felder.includes(k)) { fremd++; verstoesse.push(name + ': ' + x.typ + '.' + k); }
      if (!def.strukturiert && !flach(x[k])) { nichtFlach++; verstoesse.push(name + ': ' + x.typ + '.' + k + ' nicht flach'); }
    }
  }
  ok(unbekannt === 0, name + ': jeder Typ steht im Schema');
  ok(fremd === 0, name + ': jede Zeile trägt nur Felder aus dem Schema');
  ok(nichtFlach === 0, name + ': alle Felder (außer dem Kopf) sind flach');
  return z;
}
function pruefeAufrufe(name, p) {
  ok(p.verstoesse.length === 0, name + ': Aufrufe von ereignis() entsprechen dem Schema, nichts wird verworfen' + (p.verstoesse.length ? ' (' + p.verstoesse.slice(0, 4).join('; ') + ')' : ''));
  for (const t of Object.keys(p.typen)) vorgekommen[t] = (vorgekommen[t] || 0) + 0;
}

section('Das Schema selbst');
{
  const arten = new Set(['1', '2', '2b', '3', '4', '5', '6', '-']);
  const typen = Object.keys(SCHEMA);
  ok(typen.length >= 20, 'Schema hat ' + typen.length + ' Typen');
  ok(typen.every((t) => /^[a-z0-9_]+$/.test(t)), 'Typnamen nur [a-z0-9_]');
  ok(typen.every((t) => arten.has(SCHEMA[t].frage) && Array.isArray(SCHEMA[t].felder) && SCHEMA[t].felder.length > 0 && typeof SCHEMA[t].text === 'string'), 'jeder Typ hat Frage, Feldliste und Text');
  ok(typen.every((t) => SCHEMA[t].felder.every((f) => /^[a-z0-9_]{1,40}$/.test(f) && !KOPF.has(f))), 'Feldnamen gültig und ohne Kopffelder');
  ok(typen.every((t) => new Set(SCHEMA[t].felder).size === SCHEMA[t].felder.length), 'keine doppelten Felder');
  ok(typen.join() === typen.slice().sort().join(), 'Einträge alphabetisch nach Typ');
  ok(typen.every((t) => !SCHEMA[t].strukturiert || t === 'kopf') && !typen.some((t) => 'flach' in SCHEMA[t]), 'nur der Kopf ist strukturiert (Form: frage als Text, strukturiert, auch)');
  ok(typen.every((t) => !SCHEMA[t].auch || SCHEMA[t].auch.every((a) => arten.has(a))), 'auch nennt nur gültige Fragen');
  ok(NUR_IM_MENSCHENSPIEL.every((t) => SCHEMA[t]), 'Nur-im-Menschenspiel-Typen stehen im Schema (' + NUR_IM_MENSCHENSPIEL.join(', ') + ')');
  ok(!typen.includes('mission_start') && !typen.includes('mission_ende') && !typen.includes('wunde'), 'ersetzte Typen (mission_*, wunde) stehen nicht mehr im Schema');
  for (const t of ['kopf', 'session_ende', 'spieler_bei', 'spieler_weg', 'partie_beendet', 'tune']) ok(!!SCHEMA[t], 'Typ aus Paket A steht im Schema: ' + t);
}

section('Kurze Bot-Läufe');
const laeufe = [
  ['arena-raum', ['arena', '--seeds', '1', '--players', '3', '--waves', '2', '--pilot', 'nose', '--max', '150']],
  ['wellen-all', ['arena', '--szene', 'frei', '--seeds', '1', '--max', '200']],
  ['wellen-boden-solo', ['wellen', '--karte', 'aussenposten', '--players', '1', '--seeds', '1', '--max', '200']],
  ['wellen-boden-drei', ['wellen', '--karte', 'kesh', '--players', '3', '--seeds', '1', '--max', '120']],
  ['graben', ['graben', '--players', '3', '--seeds', '1', '--max', '90']],
  // B2: volle Läufe (Grabenangriff zu dritt, Kampagne zu dritt), dort kommen Konsole, Energie, Reparatur, Löschen vor
  ['b2-graben', ['graben', '--players', '3', '--seed', '1']],
  ['b2-raum', ['3', '--seed', '7']],
];
const alleZeilen = [];
for (const [name, args] of laeufe) {
  const r = lauf(name, args);
  ok(r.status === 0, name + ': Lauf endet mit Exit 0' + (r.status === 0 ? '' : ' (' + r.status + ': ' + r.text.slice(-200).replace(/\s+/g, ' ') + ')'));
  pruefeAufrufe(name, r.pruef);
  alleZeilen.push(...pruefeDateien(name, r.dir));
}

section('Provokation im Spielprozess (Ereignisse, die kurze Bot-Läufe nicht sicher erzeugen)');
{
  const pv = anmelden(null);
  process.chdir(ROOT);
  process.env.TELEMETRIE = 'an';
  const dir = protokollDir('provokation');
  const { Game } = require('../server/game.js');
  const I = require('../server/sim/interior.js');
  const Space = require('../server/sim/space.js');
  const BOTS = require('../server/sim/bots.js');
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', TELEMETRIE: 'an', TELEMETRIE_DIR: dir, TELEMETRIE_QUELLE: 'bot', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'Clientqzx-0', name: 'Zyxwename', color: 0, karte: { name: 'Qorvathchar' } });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1); g.space.enemies = [];
  BOTS.setBotAuto(g, false);
  const C = g.C;
  // Zonenausfall, Überhitzung, Notfallprotokoll
  I.damageSystem(g, 'engines', 'damaged');
  g.ship.heat.weapons = C.power.heatLimit + 1; run(0.2);
  Space.verlustAusloesen(g, 'test');
  // Gegner erscheint, wird gesehen (gegner_neu), Reaktor zerstört -> Schiff zerstört nach dem Countdown
  const e = Space.spawnEnemy(g, 'raider', {});
  run(0.2);
  g.space.enemies = g.space.enemies.filter((x) => x !== e);   // Gegner verschwindet ohne Abschuss -> gegner_weg
  run(0.2);
  I.damageSystem(g, 'reactor', 'broken');
  let k = 0; while (!g.ship.schiffZerstoert && k < 30 * 60) { g.step(); k++; }
  ok(g.ship.schiffZerstoert === true, 'Provokation: Schiff zerstört nach dem Reaktor-Countdown');
  run(0.2);
  // S1 (Probe P1): Torpedo-Sofort-Tod als erster Treffer: kill traegt Waffe und Schuetzen, der treffer steht davor
  const Waffen = require('../server/sim/schiffswaffen.js');
  const sofort = Space.spawnEnemy(g, 'raider', {});
  run(0.2);
  if (sofort.shields) sofort.shields = sofort.shields.map(() => 0);
  Waffen.schade(g, sofort, 1, sofort.x, sofort.y, { huelle: true, torpedo: true }, 'torpedowerfer');
  run(0.2);
  g.telemetrie.sessionBeenden('test');
  const z = pruefeDateien('provokation', dir);
  {
    const ix = (typ) => z.findIndex((x) => x.typ === typ && x.gegner === sofort.id);
    const iT = ix('treffer'), iK = ix('kill');
    ok(g.space.enemies.indexOf(sofort) < 0 && iT >= 0 && iK > iT, 'Sofort-Tod (Torpedo): der treffer steht vor dem kill');
    ok(iK >= 0 && z[iK].von === 'lerche' && z[iK].waffe === 'torpedowerfer' && z[iT].waffe === 'torpedowerfer', 'Sofort-Tod (Torpedo): kill trägt von lerche und waffe torpedowerfer');
  }
  const t = (typ) => z.filter((x) => x.typ === typ);
  ok(t('zone_aus').some((x) => x.system === 'engines' && x.zustand === 'damaged' && x.vorher === 'ok' && typeof x.zone === 'string'), 'zone_aus: engines damaged, Zone als Text');
  ok(t('zone_aus').some((x) => x.system === 'reactor' && x.zustand === 'broken'), 'zone_aus: reactor broken');
  ok(t('ueberhitzt').some((x) => x.ort === 'raum' && x.system === 'weapons'), 'ueberhitzt (Raum): weapons');
  ok(t('notfall').some((x) => x.grund === 'test') && t('notfall').some((x) => x.grund === 'reaktor'), 'notfall: Auslöser test und reaktor');
  ok(t('schiff_zerstoert').length === 1 && t('schiff_zerstoert')[0].grund === 'reaktor' && t('schiff_zerstoert')[0].n === 1, 'schiff_zerstoert: genau einmal, grund reaktor, n 1');
  ok(t('gegner_neu').some((x) => x.ort === 'raum' && x.rolle === 'raider' && x.quelle === 'spawn'), 'gegner_neu: Raider erscheint');
  ok(t('gegner_weg').some((x) => x.ort === 'raum' && x.rolle === 'raider' && x.grund === 'unbekannt'), 'gegner_weg: Raider verschwindet ohne Abschuss');
  ok(g.telemetrie.stand().verworfeneFelder === 0 && g.telemetrie.stand().fehler === 0, 'Provokation: verworfeneFelder 0, Fehler 0');
  alleZeilen.push(...z);

  // K4 (Probe P2) und K9 (Probe P3): eine Quelle ohne Treffer wird von keinem fremden Treffer geerbt; Haken werfen nie
  const dirQ = protokollDir('quelle');
  const gq = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', TELEMETRIE: 'an', TELEMETRIE_DIR: dirQ, TELEMETRIE_QUELLE: 'bot', REGIE_DIR: path.join(TMP, 'regieq') }, log: () => {} });
  const cq = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw() {} };
  gq.addConnection(cq);
  gq.handleMessage(cq, { t: 'hello', clientId: 'Clientqzx-2', name: 'Zyxwename', color: 0 });
  gq.handleMessage(cq, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  gq.handleMessage(cq, { t: 'ready', ready: true });
  for (let i = 0; i < 30; i++) gq.step();
  gq.space.enemies = [];
  const Tel = require('../server/telemetrie/gefecht.js');
  Tel.quelle(gq, 'streu', { id: 'prY', owner: 'e-99' });
  Tel.trefferLercheOhneSchaden(gq, 0, 'ausgewichen', { id: 'prY', owner: 'e-99' });   // verbraucht die Quelle
  Space.shipHit(gq, 0, 1, {});   // ein fremder Treffer im selben Tick
  const echt = gq.telemetrie.ereignis; const geworfen = [];
  gq.telemetrie.ereignis = () => { throw new Error('kaputt'); };
  for (const [n, f] of [['schussRaum', () => Tel.schussRaum(gq, 'lanze')], ['raumGegner', () => Tel.raumGegner(gq)], ['trefferLerche', () => Tel.trefferLerche(gq, 0, 1, {}, {})], ['quelle', () => Tel.quelle(gq, 'x', null)],
    ['gegnerSystem', () => Tel.gegnerSystem(gq, null, { zone: 1 })], ['trefferBoden', () => Tel.trefferBoden(gq, null, {}, {}, 'schild', null)], ['killRaum', () => Tel.killRaum(gq, null)], ['schadeBeginn', () => Tel.schadeBeginn(gq, null, 'x')]]) {
    try { f(); } catch (e) { geworfen.push(n); }
  }
  gq.telemetrie.ereignis = echt;
  ok(geworfen.length === 0, 'Haken werfen nie, auch nicht mit kaputtem Dienst oder leeren Argumenten' + (geworfen.length ? ' (' + geworfen.join(', ') + ')' : ''));
  require('../server/sim/damage.js').direktTreffer(gq, 1, { mine: true });   // K1: Minentreffer (alarm.js ruft genau das)
  Space.technikOverload(gq); gq.ship.reactorCtl.overloadLeft = 0.05;   // K2: Reaktor-Überladung an, nach kurzer Zeit ende
  for (let i = 0; i < 10; i++) gq.step();
  Space.reactorOnline(gq, 'test'); Space.technikOverload(gq); require('../server/sim/szenenreset.js').zuruecksetzen(gq);   // K2b: Überladung endet durch Szenen-Neuaufbau (wie reset)
  Space.technikOverload(gq); Space.reactorOnline(gq, 'test');   // K2c: Überladung endet, weil der Reaktor online gesetzt wird (wie online)
  gq.telemetrie.sessionBeenden('test');
  const zm = zeilen(dirQ).filter((x) => x.typ === 'treffer');
  const zq = zm.filter((x) => x.waffe !== 'mine');
  ok(zm.some((x) => x.waffe === 'mine' && x.von === 'objekt' && x.ziel === 'lerche'), 'Minentreffer: treffer mit waffe mine, von objekt');
  { const u = zeilen(dirQ).filter((x) => x.typ === 'ueberladung').map((x) => x.wie); ok(u.join() === 'an,ende,an,reset,an,online', 'Überladung: an, ende, und die vorzeitigen Enden reset und online (' + u.join() + ')'); }
  ok(zq.length === 2 && zq[1].gegner === null && zq[1].waffe === 'sonstige', 'veraltete Quelle: ein fremder Treffer im selben Tick erbt die Quelle nicht (waffe sonstige)');
  alleZeilen.push(...pruefeDateien('quelle', dirQ));

  // Kampagne: Mission m1 beginnt (szene_start kampagne), endet mit Ausgang (szene_ende mit Dauer), die nächste beginnt
  const dir2 = protokollDir('kampagne');
  const g2 = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', TELEMETRIE: 'an', TELEMETRIE_DIR: dir2, TELEMETRIE_QUELLE: 'bot', REGIE_DIR: path.join(TMP, 'regie2') }, log: () => {} });
  const c2 = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw() {} };
  g2.addConnection(c2);
  g2.handleMessage(c2, { t: 'hello', clientId: 'Clientqzx-1', name: 'Zyxwename', color: 0 });
  g2.handleMessage(c2, { t: 'lobbyOpt', startMission: 'm1' });
  g2.handleMessage(c2, { t: 'ready', ready: true });
  for (let i = 0; i < 90; i++) g2.step();
  const aktiv = g2.mission.activeId;
  const ausgang = Object.keys((g2.mission.def && g2.mission.def.ausgaenge) || {})[0] || 'erfolg';
  g2.mission.completeMission(ausgang);
  for (let i = 0; i < 30; i++) g2.step();
  g2.telemetrie.sessionBeenden('test');
  const z2 = pruefeDateien('kampagne', dir2);
  const s0 = z2.find((x) => x.typ === 'szene_start' && x.szene === aktiv);
  const s1 = z2.find((x) => x.typ === 'szene_ende' && x.szene === aktiv);
  ok(!!s0 && s0.modus === 'kampagne' && s0.spielerzahl === 1, 'szene_start: Kampagne, Szenenschlüssel ' + aktiv + ', Spielerzahl 1');
  ok(!!s1 && s1.modus === 'kampagne' && s1.ausgang === ausgang && s1.dauer >= 2.9 && s1.dauer <= 3.1, 'szene_ende: Ausgang ' + ausgang + ', Dauer ' + (s1 && s1.dauer) + ' s (90 Ticks)');
  ok(!z2.some((x) => x.typ === 'mission_start' || x.typ === 'mission_ende'), 'mission_start/mission_ende sind durch szene_* ersetzt');
  ok(g2.telemetrie.stand().verworfeneFelder === 0, 'Kampagne: verworfeneFelder 0');
  {   // S4: der Verrat schaltet eine Szene um und sie endet unter dem Schlüssel, unter dem sie begann (ohne sim-szene-sund, das nicht in der Kette ist)
    const KS = require('../server/sim/kriegslage-szene.js');
    ok(KS.protokollSchluessel({ modus: 'verrat', vor: 'angriff' }) === 'angriff' && KS.protokollSchluessel({ modus: 'verrat', vor: 'normal' }) === 'verteidigung' &&
       KS.protokollSchluessel({ modus: 'verrat' }) === 'verteidigung' && KS.protokollSchluessel({ modus: 'angriff' }) === 'angriff' && KS.protokollSchluessel({ modus: 'finale' }) === 'finale' &&
       KS.protokollSchluessel({}) === 'verteidigung', 'Sund-Szene: Schlüssel im Protokoll (Verrat aus Angriff = angriff, aus Verteidigung = verteidigung)');
  }
  alleZeilen.push(...z2);
  pruefeAufrufe('provokation', { typen: pv.typen, verstoesse: [...pv.verstoesse] });
}

section('Deckung in Schuss und Treffer: EIN Rechenweg (haken.inDeckung)');
{
  const Tel = require('../server/telemetrie/gefecht.js');
  const Haken = require('../server/telemetrie/haken.js');
  const zeilenF = []; const beiAbschluss = [];
  const spieler = (id, cv, geduckt) => ({ id, team: 'crew', input: {}, zone: 'away', cv, crouch: geduckt, x: 100, y: 100, schild: { seg: 3 } });
  const pa = spieler('p1', 2, false), pb = spieler('p2', 0, true);
  const gegner = { id: 'e1', team: 'enemy', rolle: 'sturm', crouch: true, x: 300, y: 300 };
  const fake = { players: [pa, pb], tick: 1, time: 0, away: { drones: [gegner] }, telemetrie: { offen: true, s: {}, ereignis: (typ, f) => zeilenF.push({ typ, ...f }), beiAbschluss: (f) => beiAbschluss.push(f) } };
  const dk = (typ) => zeilenF.filter((x) => x.typ === typ);
  Tel.schussBoden(fake, pa, 'blaster', 'pa1'); Tel.schussBoden(fake, pb, 'blaster', 'pb1'); Tel.schussBoden(fake, gegner, 'enemy', 'pe1');
  const sh = dk('schuss').map((x) => x.von_deckung);
  ok(sh.join() === 'true,false,true', 'schuss: von_deckung Spieler cv 2 = ja, Spieler nur geduckt im Offenen = nein, Gegner geduckt = ja (' + sh.join() + ')');
  const echt = Haken.inDeckung; let aufrufe = 0;
  Haken.inDeckung = () => { aufrufe++; return 'stub'; };
  try { Tel.schussBoden(fake, pb, 'blaster', 'pb2'); Tel.trefferBoden(fake, pb, { waffe: 'blaster', schaden: 1 }, gegner, 'wunde', 3); } finally { Haken.inDeckung = echt; }
  const st = dk('schuss').pop(), tr = dk('treffer').pop();
  ok(aufrufe === 2 && st.von_deckung === 'stub' && tr && tr.ziel_deckung === 'stub', 'schuss und treffer holen von_deckung / ziel_deckung aus haken.inDeckung (kein zweiter Rechenweg), Aufrufe ' + aufrufe);
}

section('Zusammenhänge zwischen den Ereignissen (je Session)');
{
  const nachSitzung = {};
  for (const x of alleZeilen) (nachSitzung[x.sitzung] = nachSitzung[x.sitzung] || []).push(x);
  let killFolge = 0, killSonstigeObwohlGetroffen = 0, bodenTreffer = 0, bodenOhneSchuss = 0, bodenSchussOhnePid = 0, bodenSchuesse = 0; const bodenMitSchuss = new Set();
  let sitzungen = 0, killUndWeg = 0, trefferOhneSchuss = 0, pidDoppelt = 0, killOhneNeu = 0, lebteFalsch = 0, dauerFalsch = 0, wundeUngleich = 0, zoneGleich = 0, szeneEndeOhneStart = 0, ohneKopf = 0;
  for (const z of Object.values(nachSitzung)) {
    sitzungen++;
    if (z[0].typ !== 'kopf') ohneKopf++;
    const schuesse = new Map();
    for (const x of z) if (x.typ === 'schuss' && x.pid) { if (schuesse.has(x.pid + '|' + x.ort)) pidDoppelt++; schuesse.set(x.pid + '|' + x.ort, x); }
    for (const x of z) if (x.typ === 'treffer' && x.von === 'lerche' && x.pid) { const s = schuesse.get(x.pid + '|raum'); if (!s || s.waffe !== x.waffe) trefferOhneSchuss++; }
    const neu = new Map();
    for (const x of z) if (x.typ === 'gegner_neu') neu.set(x.ort + '|' + x.gegner, x);
    for (const x of z) if (x.typ === 'kill') {
      const n0 = neu.get(x.ort + '|' + x.gegner);
      if (!n0 || n0.t > x.t) killOhneNeu++;
      else if (x.lebte != null && Math.abs(x.lebte - (x.t - n0.t)) > 0.2) lebteFalsch++;
    }
    const getoetet = new Set(z.filter((x) => x.typ === 'kill' && x.ort === 'raum').map((x) => x.gegner));
    killUndWeg += z.filter((x) => x.typ === 'gegner_weg' && x.ort === 'raum' && getoetet.has(x.gegner)).length;
    const starts = new Map();
    for (const x of z) {
      if (x.typ === 'szene_start' || x.typ === 'szene_neustart') starts.set(x.modus + '|' + x.szene, x.t);
      if (x.typ === 'szene_ende') { const t0 = starts.get(x.modus + '|' + x.szene); if (t0 == null) szeneEndeOhneStart++; else if (Math.abs(x.dauer - (x.t - t0)) > 0.1) dauerFalsch++; }
    }
    const gefallen = z.filter((x) => x.typ === 'treffer' && x.ort === 'boden' && /^p[1-4]$/.test(x.ziel) && x.ergebnis === 'gefallen').length;
    if (gefallen !== z.filter((x) => x.typ === 'gefallen' && x.waffe !== 'monster').length) wundeUngleich++;
    // S1: kill im Raum -- von lerche nur nach einem Treffer der Lerche auf diesen Gegner, von sonstige nur ohne einen solchen
    const getroffen = new Set();
    for (const x of z) {
      if (x.typ === 'treffer' && x.ort === 'raum' && x.von === 'lerche') getroffen.add(x.gegner);
      if (x.typ === 'kill' && x.ort === 'raum') { if (x.von === 'lerche' && (!getroffen.has(x.gegner) || !x.waffe)) killFolge++; if (x.von === 'sonstige' && getroffen.has(x.gegner)) killSonstigeObwohlGetroffen++; }
    }
    // S2: am Boden hat jeder Treffer eines Projektils, einer Lanze oder eines Schlags einen Schuss mit gleicher Kennung und Waffe
    const bs = new Map();
    for (const x of z) {
      if (x.typ === 'schuss' && x.ort === 'boden') bs.set(x.pid, x);
      if (x.typ === 'treffer' && x.ort === 'boden' && (x.von === 'gegner' || /^p[1-4]$/.test(x.von))) { bodenTreffer++; const s = x.pid == null ? null : bs.get(x.pid); if (!s || s.waffe !== x.waffe) bodenOhneSchuss++; else bodenMitSchuss.add(x.sitzung + x.pid); }
    }
    for (const x of z) if (x.typ === 'schuss' && x.ort === 'boden' && x.pid == null) bodenSchussOhnePid++;
    bodenSchuesse += bs.size;
    zoneGleich += z.filter((x) => x.typ === 'zone_aus' && x.zustand === x.vorher).length;
  }
  ok(sitzungen >= 8, sitzungen + ' Sessions geprüft');
  ok(ohneKopf === 0, 'jede Session beginnt mit dem Kopf');
  ok(trefferOhneSchuss === 0, 'jeder Treffer der Lerche mit pid hat einen Schuss derselben Waffe und pid (Trefferquote je Waffe ist bildbar)');
  ok(pidDoppelt === 0, 'jede Projektilkennung wird je Ort nur einmal verschossen');
  ok(killOhneNeu === 0, 'jeder Abschuss hat ein früheres gegner_neu desselben Gegners');
  ok(killUndWeg === 0, 'ein im Raum abgeschossener Gegner meldet kein zusätzliches gegner_weg');
  ok(lebteFalsch === 0, 'kill.lebte entspricht kill.t − gegner_neu.t');
  ok(szeneEndeOhneStart === 0, 'jedes szene_ende hat einen szene_start (oder -neustart) derselben Szene');
  ok(dauerFalsch === 0, 'szene_ende.dauer entspricht t − Beginn der Szene (bzw. des letzten Neustarts)');
  ok(wundeUngleich === 0, 'je Treffer mit ergebnis gefallen auf einen Spieler genau ein wunde');
  ok(zoneGleich === 0, 'zone_aus meldet nur echte Zustandswechsel');
  ok(killFolge === 0, 'kill im Raum von lerche: nach einem Treffer der Lerche auf diesen Gegner, mit Waffe');
  ok(killSonstigeObwohlGetroffen === 0, 'kill im Raum mit von sonstige nur, wenn es keinen Treffer der Lerche auf diesen Gegner gab');
  ok(bodenTreffer > 20 && bodenOhneSchuss === 0, 'Boden: jeder Treffer (' + bodenTreffer + ') hat einen Schuss mit gleicher Kennung und Waffe');
  ok(bodenSchussOhnePid === 0 && bodenMitSchuss.size > 10, 'Boden: jeder Schuss trägt eine Kennung; Schüsse mit Treffer vorhanden (' + bodenMitSchuss.size + ' von ' + bodenSchuesse + ')');
}

section('Abdeckung je Ort und Richtung (jeder Haken einzeln: fehlt einer, wird es rot)');
{
  const n = (f) => alleZeilen.filter(f).length;
  const regeln = [
    ['kill raum (von lerche, mit waffe)', (x) => x.typ === 'kill' && x.ort === 'raum' && x.von === 'lerche' && !!x.waffe],
    ['kill boden', (x) => x.typ === 'kill' && x.ort === 'boden'],
    ['treffer raum Lerche -> Gegner', (x) => x.typ === 'treffer' && x.ort === 'raum' && x.von === 'lerche'],
    ['treffer raum Gegner -> Lerche (shipHit)', (x) => x.typ === 'treffer' && x.ort === 'raum' && x.ziel === 'lerche' && x.ergebnis === 'treffer' && x.waffe !== 'mine'],
    ['treffer boden Spieler -> Gegner', (x) => x.typ === 'treffer' && x.ort === 'boden' && /^p[1-4]$/.test(x.von) && x.ziel === 'gegner'],
    ['treffer boden Gegner -> Spieler', (x) => x.typ === 'treffer' && x.ort === 'boden' && x.von === 'gegner' && /^p[1-4]$/.test(x.ziel)],
    ['schuss raum (Lerche)', (x) => x.typ === 'schuss' && x.ort === 'raum'],
    ['schuss boden Spieler', (x) => x.typ === 'schuss' && x.ort === 'boden' && /^p[1-4]$/.test(x.von)],
    ['schuss boden Gegner', (x) => x.typ === 'schuss' && x.ort === 'boden' && x.von === 'gegner'],
    ['schuss boden Pistole der Verwundeten', (x) => x.typ === 'schuss' && x.ort === 'boden' && x.waffe === 'pistol'],
    ['gegner_neu raum', (x) => x.typ === 'gegner_neu' && x.ort === 'raum'],
    ['gegner_neu boden', (x) => x.typ === 'gegner_neu' && x.ort === 'boden'],
    ['gegner_weg raum', (x) => x.typ === 'gegner_weg' && x.ort === 'raum'],
    ['gegner_weg boden', (x) => x.typ === 'gegner_weg' && x.ort === 'boden'],
    ['gefallen (Spieler zu Boden)', (x) => x.typ === 'gefallen'],
    ['szene_ende wellen_boden mit echtem Ausgang (nicht session_ende)', (x) => x.typ === 'szene_ende' && x.modus === 'wellen_boden' && x.ausgang !== 'session_ende'],
    ['szene_ende kampagne mit echtem Ausgang', (x) => x.typ === 'szene_ende' && x.modus === 'kampagne' && x.ausgang !== 'session_ende'],
    ['szene_ende bei Sessionende (offene Szene wird geschlossen)', (x) => x.typ === 'szene_ende' && x.ausgang === 'session_ende'],
  ];
  for (const m of ['arena_raum', 'wellen_all', 'wellen_boden', 'graben', 'kampagne']) {
    regeln.push(['szene_start ' + m, (x) => x.typ === 'szene_start' && x.modus === m]);
    regeln.push(['szene_ende ' + m, (x) => x.typ === 'szene_ende' && x.modus === m]);
  }
  for (const [name, f] of regeln) ok(n(f) > 0, name + ' (' + n(f) + '×)');
  const offen = new Map();   // jede Szene hat am Ende ein szene_ende (je Session)
  for (const x of alleZeilen) { if (x.typ === 'szene_start') offen.set(x.sitzung + x.modus + x.szene, 1); if (x.typ === 'szene_ende') offen.delete(x.sitzung + x.modus + x.szene); }
  ok(offen.size === 0, 'jede Szene wird beendet (auch durch das Sessionende)' + (offen.size ? ' (offen: ' + offen.size + ')' : ''));
  const ende = alleZeilen.filter((x) => x.typ === 'szene_ende' && x.ausgang === 'session_ende');
  ok(ende.every((x) => x.dauer_gesamt != null && x.dauer_gesamt >= x.dauer), 'szene_ende trägt dauer_gesamt (>= dauer)');
}

section('Jeder Typ von B1 kommt vor');
for (const t of EIGENE) ok((vorgekommen[t] || 0) > 0, 'Typ ' + t + ' kommt vor (' + (vorgekommen[t] || 0) + '×)');
for (const [paket, typen] of Object.entries(PAKET_TYPEN)) {
  const fehlt = typen.filter((t) => !(vorgekommen[t] > 0) && !NUR_IM_MENSCHENSPIEL.includes(t));
  ok(fehlt.length === 0 && typen.every((t) => SCHEMA[t]), 'Paket ' + paket + ': jeder Typ kommt vor' + (fehlt.length ? ' – fehlt: ' + fehlt.join(',') : ''));
}
{ const z = alleZeilen.filter((x) => x.typ === 'zeitreihe'); const f = SCHEMA.zeitreihe.felder; ok(z.length > 0 && z.every((x) => f.every((k) => k in x)), 'zeitreihe trägt in jeder Zeile alle Felder des Schemas (' + z.length + ' Zeilen)'); }

section('Namenstest über alle Protokolle');
{
  // Spieler-/Charakter-/Client-Kennungen der Tests; Bots heißen Ada, Bo, Cem und haben die clientId sim-<n> (Bo nur in Anführungszeichen: sonst träfe es "Boden")
  const namen = ['Zyxwename', 'Qorvathchar', 'Clientqzx'];
  let treffer = 0;
  // ganzer Ordner (jsonl, tuning, alles): Test-Kennungen als Teilstring, Bot-Namen und Bot-clientId mit Wortgrenzen
  const durchsuche = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) durchsuche(f); else { const s = fs.readFileSync(f, 'utf8'); for (const nm of namen) if (s.includes(nm)) { treffer++; console.log('    Fund: ' + nm + ' in ' + f); } const m = BOT_NAME.exec(s); if (m) { treffer++; console.log('    Fund: ' + m[1] + ' in ' + f); } if (BOT_ID.test(s)) { treffer++; console.log('    Fund: clientId in ' + f); } } } };
  durchsuche(TMP);
  ok(treffer === 0, 'keine Spielernamen, Charakternamen oder Client-Kennungen in den Protokollen');
  ok(!alleZeilen.some((x) => 'name' in x || 'clientid' in x || 'karte' in x), 'kein Feld name, clientId oder karte');
}

section('Zeilen und Größe (Bot-Läufe, Richtwert)');
{
  const gefecht = alleZeilen.filter((x) => ['schuss', 'treffer', 'kill', 'gegner_neu', 'gegner_weg'].includes(x.typ)).length;
  ok(alleZeilen.length > 500 && gefecht > 100, 'Gefechtszeilen vorhanden: ' + gefecht + ' von ' + alleZeilen.length);
}

console.log('\n' + (fails ? 'FEHLGESCHLAGEN: ' + fails + ' von ' + n : 'ALLE ' + n + ' PRÜFUNGEN GRÜN') + ' (test-telemetrie-schema)');
process.exit(fails ? 1 : 0);
