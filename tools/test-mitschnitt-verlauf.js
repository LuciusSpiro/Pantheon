'use strict';
// MIT-01 N3/3: "Verlauf unverändert" auch für Kampf und Kampagne (test-mitschnitt-aufnahme deckt nur Faden und Funk-Antwort ab).
//   node tools/test-mitschnitt-verlauf.js
// Zwei kurze Szenarien in-process (Sekunden), je aus / an / an mit werfendem Empfänger UND werfender Senke:
//   Kampagne m1 (Schritt route): Buch-Entscheidung + Wahl (openChoice/choice), Raumgegner (gegner_neu, kill), Szenenstart/-ende (Mission beenden, Mission abbrechen)
//   Wellen Boden (arena_away): Bodengegner (gegner_neu, kill) per knockOut
// Hash über snapshot(), rng(), Fäden, Ruf, Chronik, Stats plus Zählung der Spielergebnisse (Ausgänge, Kills, Fehlerzähler).
// Belegt per Zähler in der 'an'-Variante, dass die Haken tatsächlich gefeuert haben (sonst wäre der Hash leer).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Combat = require('../server/sim/combat.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mit-verlauf-'));
let zaehler = 0;

function neuesSpiel(start, modus) {
  const dir = path.join(root, 'd' + (++zaehler));
  const env = { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(dir, 'regie') };
  if (modus !== 'aus') { env.MITSCHNITT = '1'; env.MITSCHNITT_DIR = path.join(dir, 'mit'); }
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Geheimname', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: start });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (modus === 'wirft') {   // jeder Eingang des Empfängers und die Senke der Telemetrie werfen
    const boese = () => { throw new Error('Mutationsprobe'); };
    const m = g.mitschnitt;
    for (const k of ['_neu', '_lesen', '_filter', '_szeneStart', '_szeneEnde', '_missionStart', '_missionEnde', '_funkOptionen']) m[k] = boese;
    g.telemetrie.senken = [boese];
  }
  return g;
}
const lauf = (g, n) => { for (let i = 0; i < n; i++) g.step(); };
const hash = (g, extra) => {
  const h = crypto.createHash('sha1');
  const F = g.weltsim && g.weltsim.faeden;
  h.update(JSON.stringify(g.snapshot())); h.update(String(g.rng()));
  h.update(JSON.stringify(F && F.liste ? F.liste.map((f) => [f.id, f.phase, f.beat, f.ausgang]) : null));
  h.update(JSON.stringify(g.weltsim ? [g.weltsim.ruf, g.weltsim.chronik] : null));
  h.update(JSON.stringify(g.stats)); h.update(JSON.stringify(extra));
  return h.digest('hex');
};

// Kampagne: Entscheidung, Raumkampf, Mission beenden, Mission abbrechen
function kampagne(modus) {
  const g = neuesSpiel('m1', modus);
  lauf(g, 60);
  const ergebnis = { ausgang: [], fehler: null };
  g.mission.startMissionAb('m1', 'route'); lauf(g, 10);
  g.mission.openChoice('grauzahn');
  ergebnis.wahl = g.mission.choice('fight');
  const e = space.spawnEnemy(g, 'raider', { x: g.ship.x + 400, y: g.ship.y, facing: 0 });
  lauf(g, 5);
  space.enemyDown(g, e); lauf(g, 5);
  const aus = Object.keys(g.mission.def.ausgaenge || {})[0] || 'erfolg';   // ein Ausgang, den das Buch kennt
  g.mission.completeMission(aus); lauf(g, 10);
  ergebnis.erwartet = aus;
  ergebnis.ausgang.push(g.mission.missions.m1 && g.mission.missions.m1.ausgang);
  g.mission.startMission('m2'); lauf(g, 10);
  g.mission.abbrechen(); lauf(g, 10);
  ergebnis.kills = g.stats.kills; ergebnis.fehler = g.errors;
  return { g, hash: hash(g, ergebnis), ergebnis };
}
// Wellen Boden: ein Bodengegner fällt
function boden(modus) {
  const g = neuesSpiel('arena_away', modus);
  lauf(g, 90);
  const aw = Object.values(g.aways).find((a) => a && a.active);
  const d = aw && aw.drones.find((x) => x.alive);
  if (d) Combat.knockOut(g, d);
  lauf(g, 5);
  const ergebnis = { gefallen: d ? !d.alive : null, fehler: g.errors };
  return { g, hash: hash(g, ergebnis), ergebnis, gegner: !!d };
}
const arten = (g, art, f) => g.mitschnitt.verlauf().eintraege.filter((e) => e.art === art && (!f || f(e)));

console.log('Kampagne (Entscheidung, Raumkampf, Szenenstart/-ende, Abbruch)');
{
  const a = kampagne('aus'), b = kampagne('an'), c = kampagne('wirft');
  ok(a.g.mitschnitt === null && a.ergebnis.wahl === null && a.ergebnis.kills >= 1 && a.ergebnis.ausgang[0] === a.ergebnis.erwartet, 'Szenario läuft: Wahl angenommen, Kill gezählt, Mission m1 mit Ausgang ' + a.ergebnis.erwartet + ' (kills ' + a.ergebnis.kills + ')');
  ok(b.hash === a.hash, 'Hash mit MITSCHNITT=1 = ohne (' + b.hash.slice(0, 8) + ')');
  ok(c.hash === a.hash, 'Hash mit werfendem Empfänger und werfender Senke = ohne');
  ok(c.g.mitschnitt.fehler > 0, 'Mutationsprobe: der Empfänger hat tatsächlich geworfen (' + c.g.mitschnitt.fehler + ')');
  ok(c.g.errors === a.g.errors, 'Fehlerzähler des Spiels unverändert (' + a.g.errors + ')');
  // die Haken haben gefeuert (sonst ist der Hash leer)
  ok(arten(b.g, 'entscheidung', (e) => e.id === 'grauzahn').length === 1 && arten(b.g, 'wahl', (e) => e.quelle === 'buch' && e.option === 'fight').length === 1, 'Haken buchEntscheidung/buchWahl feuerten (Entscheidung grauzahn, Option fight gewählt)');
  ok(arten(b.g, 'kill').length >= 1 && arten(b.g, 'gegner', (e) => e.ereignis === 'neu').length >= 1, 'Haken kill und gegner_neu (Raum) feuerten (' + arten(b.g, 'kill').length + ' kill)');
  ok(arten(b.g, 'szene', (e) => e.ereignis === 'start').length >= 2 && arten(b.g, 'szene', (e) => e.ereignis === 'ende' && e.ausgang === a.ergebnis.erwartet).length === 1 && arten(b.g, 'szene', (e) => e.ereignis === 'ende' && e.ausgang === 'abgebrochen').length === 1, 'Haken szene_start/szene_ende feuerten (Ausgang des Buchs und abgebrochen)');
  ok(arten(b.g, 'wirkung').length >= 1, 'Haken buchung/ruf (wirkung) feuerten (' + arten(b.g, 'wirkung').length + ')');
}

console.log('Wellen Boden (Bodengegner, kill)');
{
  const a = boden('aus'), b = boden('an'), c = boden('wirft');
  ok(a.gegner && a.ergebnis.gefallen === true, 'Szenario läuft: ein Bodengegner fiel');
  ok(b.hash === a.hash, 'Hash mit MITSCHNITT=1 = ohne (' + b.hash.slice(0, 8) + ')');
  ok(c.hash === a.hash, 'Hash mit werfendem Empfänger und werfender Senke = ohne');
  ok(c.g.mitschnitt.fehler > 0, 'Mutationsprobe: der Empfänger hat tatsächlich geworfen (' + c.g.mitschnitt.fehler + ')');
  ok(arten(b.g, 'kill').length === 1 && arten(b.g, 'gegner', (e) => e.ereignis === 'neu').length >= 1, 'Haken killBoden und bodenGegnerSehen feuerten (' + arten(b.g, 'kill').length + ' kill)');
}

console.log(fails ? `\n${fails} FEHLER` : '\nalle ok');
process.exit(fails ? 1 : 0);
