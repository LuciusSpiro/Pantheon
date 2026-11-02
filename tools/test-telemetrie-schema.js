'use strict';
// TEL-01 B1: Schema-Test des Spielprotokolls. server/telemetrie/schema.js ist die eine Stelle, die Auswertung liest nur das.
// Geprüft wird gegen kurze Bot-Läufe (Raum, Raum mit Wellen, Boden-Wellen, Grabenangriff) und eine Provokation im Spielprozess:
//   - jeder vorkommende Typ steht im Schema, jede Zeile trägt nur Felder aus dem Schema (Sessionkopf ausgenommen, der ist strukturiert),
//   - jedes Feld ist flach (Zahl, Text, Wahrheitswert, null, Liste davon) – nichts wird vom Dienst als „verworfen“ gezählt,
//   - jeder Typ, den das Paket B1 schreibt, kommt mindestens einmal vor (Bot-Läufe oder Provokation) – oder steht in OHNE_HAKEN,
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

// Typen ohne Haken in B1 (B2 schreibt sie) – sie müssen im Schema stehen, kommen hier aber nicht vor
const OHNE_HAKEN = new Set(['zone_wieder']);
// Typen anderer Pakete (A, B2), die in den kurzen Läufen vorkommen dürfen, aber nicht Pflicht sind
const EIGENE = Object.keys(SCHEMA).filter((t) => !OHNE_HAKEN.has(t) && SCHEMA[t].frage !== '-' && !['spieler_bei', 'spieler_weg', 'partie_beendet'].includes(t) &&
  !['zone_wieder'].includes(t) && !SCHEMA[t].b2);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-schema-'));
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
  for (const t of ['kopf', 'session_ende', 'spieler_bei', 'spieler_weg', 'partie_beendet', 'tune']) ok(!!SCHEMA[t], 'Typ aus Paket A steht im Schema: ' + t);
}

section('Kurze Bot-Läufe');
const laeufe = [
  ['arena-raum', ['arena', '--seeds', '1', '--players', '3', '--waves', '2', '--pilot', 'nose', '--max', '150']],
  ['wellen-all', ['arena', '--szene', 'frei', '--seeds', '1', '--max', '200']],
  ['wellen-boden-solo', ['wellen', '--karte', 'aussenposten', '--players', '1', '--seeds', '1', '--max', '200']],
  ['wellen-boden-drei', ['wellen', '--karte', 'kesh', '--players', '3', '--seeds', '1', '--max', '120']],
  ['graben', ['graben', '--players', '3', '--seeds', '1', '--max', '90']],
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
  g.telemetrie.sessionBeenden('test');
  const z = pruefeDateien('provokation', dir);
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
  alleZeilen.push(...z2);
  pruefeAufrufe('provokation', { typen: pv.typen, verstoesse: [...pv.verstoesse] });
}

section('Zusammenhänge zwischen den Ereignissen (je Session)');
{
  const nachSitzung = {};
  for (const x of alleZeilen) (nachSitzung[x.sitzung] = nachSitzung[x.sitzung] || []).push(x);
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
    if (gefallen !== z.filter((x) => x.typ === 'wunde').length) wundeUngleich++;
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
}

section('Jeder Typ von B1 kommt vor');
for (const t of EIGENE) ok((vorgekommen[t] || 0) > 0, 'Typ ' + t + ' kommt vor (' + (vorgekommen[t] || 0) + '×)');

section('Namenstest über alle Protokolle');
{
  const namen = ['Zyxwename', 'Qorvathchar', 'Clientqzx', 'Ada', 'Cem'];   // Spieler-/Charakter-/Client-Kennungen der Tests (Bots heißen Ada, Bo, Cem)
  let treffer = 0;
  const durchsuche = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) durchsuche(f); else if (f.endsWith('.jsonl')) { const s = fs.readFileSync(f, 'utf8'); for (const nm of namen) if (s.includes(nm)) { treffer++; console.log('    Fund: ' + nm + ' in ' + f); } } } };
  durchsuche(TMP);
  ok(treffer === 0, 'keine Spielernamen, Charakternamen oder Client-Kennungen in den Protokollen');
  ok(!alleZeilen.some((x) => 'name' in x || 'clientid' in x || 'karte' in x), 'kein Feld name, clientId oder karte');
}

section('Zeilen und Größe (Bot-Läufe, Richtwert)');
{
  const gefecht = alleZeilen.filter((x) => ['schuss', 'treffer', 'kill', 'gegner_neu', 'gegner_weg'].includes(x.typ)).length;
  ok(alleZeilen.length > 500 && gefecht > 100, 'Gefechtszeilen vorhanden: ' + gefecht + ' von ' + alleZeilen.length);
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log('\n' + (fails ? 'FEHLGESCHLAGEN: ' + fails + ' von ' + n : 'ALLE ' + n + ' PRÜFUNGEN GRÜN') + ' (test-telemetrie-schema)');
process.exit(fails ? 1 : 0);
