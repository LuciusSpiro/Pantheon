'use strict';
// SL11 Kette „Die Schuld der Lerche“: Datei und Prüfer, Lobby-Start, Verzweigung (Weg A/B), Kapitel 7 mit freier Reihenfolge (Hub und Szenen),
// Geldziel, Speichern und Fortsetzen an Übergängen, Abspann.   node tools/test-sl11.js   (npm run test:sl11)
// Die Kapitel werden mit den Debug-Sprüngen der Bücher (skip) durchgespielt, nicht mit Bots; Bots je Szene liefern die Teams der Szenen (sim-headless).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const Protocol = require('../shared/protocol.js');
const Welt = require('../server/sim/welt.js');
const Loader = require('../server/mission/loader.js');
const Kampagne = require('../server/mission/kampagne.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sl11-'));
let seq = 0;

function neu(players, dir, lobby) {
  Welt.waehle(null, 'limes');
  const d = dir || path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: d, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < (players || 2); i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'L' + i, name: 'Crew' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], Object.assign({ t: 'lobbyOpt' }, lobby || { startMission: 'schuld_der_lerche' }));
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1);
  return { g, conns, run, dir: d };
}
const kap = (g) => g.weltstand.data.fakten.kapitel;
const fakt = (g, k) => g.weltstand.data.fakten[k];
// Kapitel mit den skip-Aktionen der Bücher durchspielen, bis das Kapitel `bis` erreicht ist (oder der Abspann kommt)
function bis(t, ziel, maxSchritte) {
  const g = t.g; let letztes = null; let stuck = 0;
  for (let i = 0; i < (maxSchritte || 400); i++) {
    if (g.phase === 'end' || kap(g) === ziel) return true;
    const k = kap(g) + ':' + (g.mission.step && g.mission.step.id) + ':' + g.mission.activeId;
    stuck = k === letztes ? stuck + 1 : 0; letztes = k;
    if (stuck > 25) return false;
    g.mission.skip(); t.run(1.2);
  }
  return false;
}

section('Kette als Datei, Prüfer');
{
  const doc = Kampagne.lesen('schuld-der-lerche');
  const { books, invalid } = Loader.loadAll();
  const pr = Kampagne.pruefen(doc, { books });
  ok(pr.ok && !pr.errors.length, `schuld-der-lerche.json: ${pr.errors.length} Fehler (${pr.errors.map((e) => e.code + ' ' + e.p).join(', ')}), ${pr.warnings.length} Warnungen`);
  ok(doc.kapitel.map((c) => c.id).join() === 'k1_kantenstein,k2_ueberfahrt,k3_falle,k4_gestrandet,k5_forderung,k6_spur,k7_geld,k8_entscheidung,k9a_uebergabe,k9b_soeldner,k10_boje', 'elf Kapitel: 1–8, 9A, 9B, 10');
  ok(!doc.tutorial && doc.welt === 'sund', 'ohne Tutorial, Karte Sund');
  ok(!invalid.length, 'alle Regiebücher beider Ordner laden (' + invalid.map((i) => i.id).join(', ') + ')');
  const k7 = doc.kapitel.find((c) => c.id === 'k7_geld');
  ok(k7.szenen.join() === 'sl_gasriese,sl_forschung' && Kampagne.buecherVon(k7).join() === 'k7_geld', 'Kapitel 7: Hub k7_geld, Szenen Gasfeld und Forschungsstation');
  const k3 = doc.kapitel.find((c) => c.id === 'k3_falle');
  ok(k3.ausgaenge.erfolg.weiter === 'k4_gestrandet' && k3.ausgaenge.verloren.wiederholen === true, 'Kapitel 3: erfolg (Notfallsprung/Sprungpunkt) weiter, verloren von vorn, kein rueckzug');
  const k8 = doc.kapitel.find((c) => c.id === 'k8_entscheidung');
  ok(Array.isArray(k8.ausgaenge.erfolg) && k8.ausgaenge.erfolg[0].weiter === 'k9a_uebergabe' && k8.ausgaenge.erfolg[0].wenn.flag === 'weg_a' && k8.ausgaenge.erfolg[1].weiter === 'k9b_soeldner', 'Kapitel 8: erfolg verzweigt über weg_a (Lösegeld) bzw. Rückfall Söldner');
  const kaputt = JSON.parse(JSON.stringify(doc)); kaputt.kapitel[6].szenen.push('gibtsnicht');
  ok(Kampagne.pruefen(kaputt, { books }).errors.some((e) => e.code === 'KETTE-BUCH'), 'Prüfer: unbekannte Szene wird abgelehnt');
  const kaputt2 = JSON.parse(JSON.stringify(doc)); kaputt2.kapitel[7].szenen = ['sl_gasriese'];
  ok(Kampagne.pruefen(kaputt2, { books }).errors.some((e) => e.code === 'KETTE-DOPPELT'), 'Prüfer: eine Szene gehört nur zu einem Kapitel');
  ok(Protocol.CAMPAIGN_KETTEN.schuld_der_lerche.kampagne === 'schuld-der-lerche' && !!Kampagne.laden('schuld-der-lerche'), 'Lobby-Modus lädt die Kette');
}

section('Lobby-Start: alle am Boden, Kapitel 1 läuft von selbst');
{
  const t = neu(4); const g = t.g;
  ok(g.players.every((p) => p.zone === 'away') && g.away.map === 'kantenstein.siedlung' && !g.ship.docked, 'vier Spieler am Boden von Kantenstein, Lerche im Orbit');
  ok(kap(g) === 'k1_kantenstein' && g.mission.activeId === 'k1_kantenstein' && !!g.mission.kette, 'Kapitel 1 startet ohne Debug (Kette)');
  ok(t.conns[0].inbox.some((m) => m.t === 'event' && m.kind === 'chapter'), 'Kapitelkarte 1');
  ok(g.weltstand.data.fakten.welt_karte === 'sund' && g.weltstand.data.tutorial === 'uebersprungen' && !g.mission.missions.m1, 'Sund, ohne Tutorial');
  ok(Object.keys(g.errorLog || {}).length === 0, 'keine Fehler ' + JSON.stringify(Object.keys(g.errorLog || {})));
  g.releaseWorldLock();
}

section('Weg B (Söldner): ganze Kette, Kapitel 7 in freier Reihenfolge');
let dirB, idB;
{
  const t = neu(2); const g = t.g;
  ok(bis(t, 'k7_geld'), 'Kapitel 1–6 per skip durchspielt (jetzt ' + kap(g) + ')');
  ok(kap(g) === 'k7_geld' && g.mission.activeId === 'k7_geld', 'Kapitel 7: Hub k7_geld läuft');
  t.run(2);
  ok(fakt(g, 'notrufe_frei') === 'ja', 'Fakt notrufe_frei zu Beginn von Kapitel 7');
  ok(g.mission.choice && !!g.mission.state.choice, 'Der Captain bekommt die Wahl (Gasfeld, Forschungsstation, selbst entscheiden)');
  const opts = g.mission.state.choice.options.map((o) => o.id).join();
  ok(opts === 'gas,forschung,frei', 'Optionen ' + opts);
  // Reihenfolge frei: erst die Forschungsstation
  g.mission.choice('forschung'); t.run(1);
  ok(g.mission.activeId === 'sl_forschung', 'Szene 7b (Forschungsstation) gestartet, Hub abgebrochen');
  // Szene endet (die Szene selbst setzt forschungFertig): Hub beginnt neu, die Flags bleiben
  g.mission.flags.forschungFertig = true;
  const k = g.mission.kette; k.onMissionDone({ id: 'sl_forschung', ausgang: 'erfolg' }); t.run(1);
  ok(g.mission.activeId === 'k7_geld' && kap(g) === 'k7_geld' && g.mission.flags.forschungFertig === true, 'zurück beim Hub, Flag forschungFertig bleibt');
  ok(g.mission.state.choice && !g.mission.state.choice.options.some((o) => o.id === 'forschung' && !o.disabled) , 'Forschungsstation ist erledigt (Option grau)');
  // Geldziel: Gas verkauft, aber zu wenig Marken -> Kapitel bleibt offen
  g.mission.flags.gasVerkauft = true; g.inventory.marks = 10; t.run(1);
  ok(kap(g) === 'k7_geld' && g.mission.activeId === 'k7_geld', 'beide Pflichtszenen, aber nicht genug Marken: Kapitel 7 bleibt offen');
  g.inventory.marks = g.C.campaign.sund.geldziel; t.run(1.5);
  ok(kap(g) === 'k8_entscheidung', 'Geldziel erreicht: Kapitel 8 (' + kap(g) + ')');
  ok(g.mission.activeId === 'k8_entscheidung' && !!g.mission.flags.gasVerkauft, 'Kapitel 8 läuft (Flags der Szenen bleiben)');
  dirB = t.dir; idB = g.weltstand.id;
  g.releaseWorldLock();
}

section('Kapitel 8: Verzweigung A (Lösegeld) und B (Söldner)');
{
  for (const weg of ['a', 'b']) {
    const t = neu(2); const g = t.g;
    g.mission.kette.einstieg('k8_entscheidung'); t.run(1);
    // Einstieg liefert 600 Marken und dockt in Concordia; Ablauf bis zur Wahl
    let i = 0; while (!(g.mission.state.choice) && i++ < 60) { g.mission.skip && 0; t.run(1); }
    if (!g.mission.state.choice) { g.mission.skip(); t.run(2); }
    const o = g.mission.state.choice ? g.mission.state.choice.options : [];
    ok(o.map((x) => x.id).join() === 'loesegeld,soeldner,nachverdienen', `Weg ${weg.toUpperCase()}: Wahl mit drei Optionen (${o.map((x) => x.id)})`);
    ok(o.find((x) => x.id === 'loesegeld') && !o.find((x) => x.id === 'loesegeld').disabled && !o.find((x) => x.id === 'soeldner').disabled, '600 Marken: beide Wege frei wählbar');
    g.inventory.marks = 100; t.run(0.5);
    const o2 = g.mission.state.choice ? g.mission.state.choice.options : o;
    ok(o2.every((x) => x.id === 'nachverdienen' || x.disabled), 'mit 100 Marken sind Lösegeld und Söldner grau (disabledIf)');
    g.inventory.marks = 600; t.run(0.5);
    g.mission.choice(weg === 'a' ? 'loesegeld' : 'soeldner'); t.run(2);
    ok(g.mission.flags['weg_' + weg] === true && !g.mission.flags['weg_' + (weg === 'a' ? 'b' : 'a')], `Flag weg_${weg}`);
    ok(g.inventory.marks === 600, 'Kapitel 8 bucht nichts ab (Bezahlen macht 9A/9B)');
    ok(kap(g) === (weg === 'a' ? 'k9a_uebergabe' : 'k9b_soeldner') && fakt(g, 'weg') === (weg === 'a' ? 'loesegeld' : 'soeldner'), `Kette führt in ${weg === 'a' ? 'Kapitel 9A' : 'Kapitel 9B'} (${kap(g)})`);
    g.releaseWorldLock();
  }
}

section('Kapitel 9 und 10: Ende und Abspann');
{
  const t = neu(2); const g = t.g;
  g.mission.kette.einstieg('k10_boje'); t.run(1);
  ok(kap(g) === 'k10_boje' && g.mission.activeId === 'k10_boje', 'Einstieg Kapitel 10');
  const k = g.mission.kette;
  g.weltstand.fact('lerche_weg', 'soeldner', 'test');
  g.weltstand.fact('piraten_kennen_boje', 'ja', 'test');
  k.onMissionDone({ id: 'k10_boje', ausgang: 'erfolg' }); t.run(1);
  ok(g.phase === 'end' && !!g.abspann, 'Kapitel 10 erfolg -> Abspann');
  const bl = g.abspann.bloecke.map((b) => b.kopf);
  ok(bl.includes('Die Söldner') && !bl.includes('Der Preis') && bl.includes('Die Piraten') && bl.includes('Die Boje'), 'Abspann reagiert auf den Weg: ' + bl.join(' | '));
  g.releaseWorldLock();
}

section('Speichern und Fortsetzen mitten in der Kette');
{
  const t = neu(2); const g = t.g;
  g.mission.kette.einstieg('k7_geld'); t.run(2);
  g.mission.flags.gasVerkauft = true;
  const r = g.saveWorld('test', { sync: true });
  ok(r && r.ok, 'Weltstand in Kapitel 7 gespeichert');
  const id = g.weltstand.id; const dir = t.dir;
  g.releaseWorldLock();
  const u = neu(2, dir, { world: id }); const h = u.g;
  ok(h.phase === 'play' && h.weltId === 'sund' && kap(h) === 'k7_geld', 'Fortsetzen: Karte Sund, Kapitel 7 (' + kap(h) + ')');
  u.run(2);
  ok(h.mission.activeId === 'k7_geld' && h.mission.flags.gasVerkauft === true, 'Hub läuft weiter, Flags bleiben');
  h.releaseWorldLock();
}

console.log(`\n${n - fails}/${n} bestanden${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
