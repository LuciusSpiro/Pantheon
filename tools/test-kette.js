'use strict';
// EK8 Kapitelsteuerung: Tests der festen Kampagnenkette (content/kampagne/eisenwald.json, server/mission/kampagne.js) ohne Netz,
// direkt gegen die Game-Klasse. Die Bot-Durchläufe der Kette (Labor-Einstiege je Kapitel, ganze Kette) laufen über
// `node tools/sim-headless.js kette …` (siehe CONTRACT-EK8.md).   node tools/test-kette.js   (npm run test:kette)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const Protocol = require('../shared/protocol.js');
const Loader = require('../server/mission/loader.js');
const Checker = require('../server/mission/checker.js');
const Kampagne = require('../server/mission/kampagne.js');
const Weltstand = require('../server/weltstand.js');
const Fracht = require('../server/sim/fracht.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const t0 = Date.now();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-kette-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };

function setup(dir, players, lobby, opts) {
  const g = new Game(Object.assign({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} }, opts || {}));
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'Crew' + i, color: i });
    conns.push(c);
  }
  const send = (i, m) => g.handleMessage(conns[i], m);
  if (lobby) send(0, Object.assign({ t: 'lobbyOpt' }, lobby));
  const ready = () => { for (let i = 0; i < conns.length; i++) send(i, { t: 'ready', ready: true }); };
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const events = (kind) => conns[0].inbox.filter((m) => m.t === 'event' && m.kind === kind);
  return { g, conns, send, ready, run, events };
}
// Partie beenden, ohne zu speichern (Sperre lösen) und mit demselben Weltstand in einer neuen Partie fortsetzen
function weiterspielen(t, dir, id) {
  t.g.releaseWorldLock();
  const u = setup(dir, 1, { world: id });
  u.ready(); u.run(0.2);
  return u;
}
const aktiv = (g) => g.mission.activeId;
const fakt = (g, k) => g.weltstand.data.fakten[k];

function main() {
  // ---------------------------------------------------------------------------------------------------------------
  section('Kette als Datei, Prüfer');
  const doc = Kampagne.lesen('eisenwald');
  const { books, invalid } = Loader.loadAll();
  const pr = Kampagne.pruefen(doc, { books });
  ok(pr.ok && !pr.errors.length, `eisenwald.json: ${pr.errors.length} Fehler (${pr.errors.map((e) => e.code).join(', ')})`);
  ok(doc.kapitel.length === 8 && doc.kapitel.map((c) => c.nr).join() === '1,2,3,4,5,6,7,8', '8 Kapitel, fortlaufend nummeriert');
  ok(Kampagne.laden('eisenwald') && Kampagne.laden('eisenwald').id === 'eisenwald', 'Kampagne.laden (geprüft, gecacht)');
  ok(!invalid.length, `alle Regiebücher laden ohne Fehler (${invalid.map((i) => i.id).join(', ')})`);
  ok(Object.values(books).filter((b) => b.kopf.art === 'kapitel').length === 8, 'acht Kapitelbücher (kopf.art kapitel)');
  for (const c of doc.kapitel) {
    const bl = Kampagne.buecherVon(c);
    const r = bl.map((b) => Checker.check(books[b]));
    ok(r.every((x) => x.ok), `Prüfer grün: ${bl.join(', ')} (${r.map((x) => x.errors.length).join('/')} Fehler)`);
  }
  const selftest = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'check-kette.js'), '--selftest'], { encoding: 'utf8' });
  ok(selftest.status === 0 && /13\/13 bestanden/.test(selftest.stdout), 'Prüfer-Selbsttest: 13 kaputte Ketten werden mit dem erwarteten Code abgelehnt');
  const ph = Kampagne.platzhalter(doc, books);
  ok(ph.length === 3 && ph.every((p) => p.kapitel === 'k6_orbit' && p.echt), `nur noch die 3 Platzhalter-Schritte von Kapitel 6 (Orbit, Team VERK-ORBIT) markiert (${ph.map((p) => p.schritt).join(', ')})`);
  ok(doc.kapitel.every((c) => Object.keys(c.ausgaenge).includes('erfolg') && c.einstieg && c.einstieg.ort), 'jedes Kapitel: Ausgang erfolg und Labor-Einstieg');
  ok(doc.kapitel.every((c) => Object.entries(c.ausgaenge).every(([a, f]) => a === 'erfolg' ? [].concat(f).every((x) => x.weiter) : [].concat(f).every((x) => x.wiederholen))), 'Fortschritt nur aus erfolg, jeder andere Ausgang wiederholt die Szene');

  // ---------------------------------------------------------------------------------------------------------------
  section('Protokoll und Lobby');
  ok(Protocol.LOBBY_MODI.includes('eisenwald') && Protocol.LOBBY_MODI.includes('eisenwald_ohne'), 'LOBBY_MODI: eisenwald, eisenwald_ohne');
  ok(Protocol.CAMPAIGN_STARTS.includes('eisenwald') && Protocol.CAMPAIGN_STARTS.includes('eisenwald_ohne') && Protocol.CAMPAIGN_KETTEN.eisenwald.tutorial === true && Protocol.CAMPAIGN_KETTEN.eisenwald_ohne.tutorial === false, 'CAMPAIGN_STARTS und CAMPAIGN_KETTEN');
  ok(Protocol.START_LABELS.eisenwald === 'Kampagne Eisenwald' && !!Protocol.START_HINTS.eisenwald && Protocol.DEBUG_CMDS.includes('kapitel'), 'Beschriftung, Hinweis, Debug-Befehl kapitel');
  ok(JSON.stringify(Protocol.START_MISSIONS) === JSON.stringify(['m1', 'free', 'm3', 'arena_space', 'arena_away']), 'START_MISSIONS (alte Liste) unverändert');

  // ---------------------------------------------------------------------------------------------------------------
  section('Start „Eisenwald ohne Tutorial“: Kette ohne Spielleiter');
  {
    const dir = freshDir();
    const t = setup(dir, 1, { startMission: 'eisenwald_ohne' });
    t.ready(); t.run(0.5);
    const g = t.g;
    ok(g.phase === 'play' && g.mission.kette && g.mission.kette.id === 'eisenwald', 'Partie läuft, Kette angeschlossen');
    ok(g.spielleiter == null, 'kein Spielleiter in der festen Kette');
    ok(aktiv(g) === 'k1_anwerbung', 'Kapitel 1 läuft: ' + aktiv(g));
    ok(fakt(g, 'kampagne') === 'eisenwald' && fakt(g, 'kapitel') === 'k1_anwerbung' && fakt(g, 'kapitel_nr') === 1, 'Weltstand-Fakten kampagne, kapitel, kapitel_nr');
    ok(g.mission.missions.m3 && g.mission.missions.m3.state === 'done' && g.mission.missions.m1.ausgang === 'uebersprungen', 'Tutorial gilt als übersprungen');
    ok(g.explore.kanteOffen('0305-0306'), 'tutorial-ende: Sprungkante Splittergürtel – Statio Limitis ist offen');
    ok(g.weltstand.data.npc.legat && g.weltstand.data.npc.legat.status === 'lebt' && Array.isArray(g.weltstand.data.npc.legat.gedaechtnis), 'Legat als NSC im Weltstand (Gedächtnis vorgesehen)');
    ok(t.events('chapter').length === 1 && /Kapitel 1/.test(t.events('chapter')[0].title), 'Kapitelkarte Kapitel 1');
    ok(fs.readdirSync(dir).some((f) => /^w-.*\.json$/.test(f) && !f.includes('.bak')), 'Weltstand liegt auf der Platte (Start gespeichert)');
    ok(Weltstand.validate(Weltstand.capture(g)).length === 0, 'Weltstand-Schema gültig (Fakten, NSC, Flags)');
    // Missionsbuch kennt das Kapitel
    const book = g.mission.bookEntries();
    ok(book.some((e) => e.id === 'k1_anwerbung' && e.state === 'aktiv' && /Statio Limitis/.test(e.briefing)), 'Missionsbuch: Kapitel 1 mit Briefing');
    g.releaseWorldLock();
  }

  // ---------------------------------------------------------------------------------------------------------------
  section('Speichern und Laden an jedem Kapitelübergang (ganze Kette)');
  {
    const dir = freshDir();
    let t = setup(dir, 1, { startMission: 'eisenwald_ohne' });
    t.ready(); t.run(0.5);
    const id = t.g.weltstand.id;
    const folge = doc.kapitel.map((c) => c.id);
    for (let i = 0; i < folge.length; i++) {
      const c = doc.kapitel[i];
      ok(aktiv(t.g) === c.id, `Kapitel ${c.nr} läuft: ${aktiv(t.g)}`);
      // Zustand, den dieses Kapitel hinterlässt (wie das echte Spiel): Flags, Fracht, Sperrriegel
      if (c.id === 'k2_konvoi') { t.g.mission.flags.konvoi_gepluendert = true; Fracht.anBordLegen(t.g, 'sprengstoff'); }
      if (c.id === 'k4_methalle') { t.g.mission.flags.methalle_gesprengt = true; t.g.explore.sperrriegelOeffnen(); }
      if (c.id === 'k6_orbit') { Object.assign(t.g.mission.flags, { fregatte_zerstoert: true, legat_gerettet: true, legat_befolgt: true }); }
      if (c.id === 'k7_siedlung') { Object.assign(t.g.mission.flags, { flagge_gehisst: true, boss_besiegt: true }); }
      t.g.mission.completeMission('erfolg');
      t.run(0.2);   // Tick-Ende: gespeichert (missionDone)
      if (i < folge.length - 1) {
        const nx = folge[i + 1];
        ok(aktiv(t.g) === nx && fakt(t.g, 'kapitel') === nx && fakt(t.g, 'kapitel_nr') === c.nr + 1, `Übergang ${c.nr} → ${c.nr + 1}: ${aktiv(t.g)}`);
        const u = weiterspielen(t, dir, id);
        ok(u.g.phase === 'play' && u.g.mission.kette && aktiv(u.g) === nx, `  geladen: Kapitel ${c.nr + 1} läuft weiter (${aktiv(u.g)})`);
        ok(fakt(u.g, 'kapitel') === nx && fakt(u.g, 'kampagne') === 'eisenwald', '  Fakten kampagne und kapitel bleiben');
        ok(u.g.mission.missions[c.id] && u.g.mission.missions[c.id].state === 'done' && u.g.mission.missions[c.id].ausgang === 'erfolg', `  erledigt gespeichert: ${c.id}`);
        if (nx === 'k3_nebelheim') ok(Fracht.anBord(u.g, 'sprengstoff') === 1 && u.g.mission.flags.konvoi_gepluendert === true, '  Fracht (Sprengstoff) und Flag konvoi_gepluendert überleben das Laden');
        if (nx === 'k5_legat') ok(u.g.mission.flags.methalle_gesprengt === true && u.g.explore.sperrriegelOffen() && fakt(u.g, 'sperrriegel') === true, '  methalle_gesprengt und Sperrriegel überleben das Laden');
        if (nx === 'k6_orbit') ok(u.g.weltstand.data.npc.legat.gedaechtnis.some((e) => e.ereignis === 'erster_funkspruch'), '  Legat-Gedächtnis überlebt das Laden');
        if (nx === 'k8_sieg') ok(u.g.mission.flags.legat_befolgt === true && u.g.mission.flags.fregatte_zerstoert === true, '  Flags der Orbitschlacht überleben das Laden');
        t = u;
      }
    }
    // Ende: Sieg und Abspann, kein freies Spiel
    ok(t.g.phase === 'end' && fakt(t.g, 'kampagne_ende') === true, 'Nach Kapitel 8: Phase end, Fakt kampagne_ende');
    const snap = t.g.snapshot();
    ok(snap.abspann && Array.isArray(snap.abspann.bloecke) && snap.abspann.bloecke.length >= 3 && snap.abspann.titel, 'Snapshot trägt den Abspann (Titel, Blöcke)');
    const ending = t.events('ending').pop();
    ok(ending && ending.abspann === true && /römisch/.test(ending.title), 'Ereignis ending { abspann: true, title }');
    ok(Buffer.byteLength(JSON.stringify(snap.abspann)) < 2000, 'Abspann klein (' + Buffer.byteLength(JSON.stringify(snap.abspann)) + ' B)');
    ok(t.g.mission.missions.k8_sieg.state === 'done', 'Kapitel 8 erledigt');
    // Fortsetzen nach dem Ende: weiter der Abspann, kein freies Spiel
    t.g.saveWorld('test', { sync: true });
    const u = weiterspielen(t, dir, id);
    ok(u.g.phase === 'end' && u.g.snapshot().abspann, 'Weltstand nach dem Sieg laden: wieder der Abspann (kein freies Spiel)');
    u.send(0, { t: 'menu', op: 'end' });
    ok(u.g.phase === 'lobby', 'Abspann: Hauptmenü beendet die Partie (Lobby)');
    u.g.releaseWorldLock();
  }

  // ---------------------------------------------------------------------------------------------------------------
  section('Mitte aufhören und weitermachen (Speichern im Kapitel)');
  {
    const dir = freshDir();
    const t = setup(dir, 1, { startMission: 'eisenwald_ohne' });
    t.ready(); t.run(0.5);
    const id = t.g.weltstand.id;
    t.g.mission.kette.einstieg('k2_konvoi');
    t.run(0.2);
    ok(aktiv(t.g) === 'k2_konvoi' && t.g.ship.docked, 'Einstieg k2_konvoi: Statio Limitis, angedockt');
    t.g.mission.setStep('abgabe');   // mitten im Kapitel (Abgabe in der Statio Limitis)
    t.g.mission.flags.konvoi_gepluendert = true;
    Fracht.anBordLegen(t.g, 'sprengstoff'); Fracht.anBordLegen(t.g, 'sprengstoff');
    t.run(0.2);
    t.g.saveWorld('test', { sync: true });
    const u = weiterspielen(t, dir, id);
    ok(aktiv(u.g) === 'k2_konvoi' && u.g.mission.state.stage === 'abgabe', 'geladen: Kapitel 2, Schritt abgabe (' + u.g.mission.state.stage + ')');
    ok(Fracht.anBord(u.g, 'sprengstoff') === 2 && u.g.mission.flags.konvoi_gepluendert === true, 'geladen: beide Ladungen und die Flag da');
    // Abgabe per Skript beendet das Kapitel und startet Kapitel 3 mit der behaltenen Ladung
    Fracht.skriptAbliefern(u.g, 'sprengstoff', 2);
    u.run(0.3);
    ok(aktiv(u.g) === 'k3_nebelheim' && Fracht.anBord(u.g, 'sprengstoff') === 1, 'Abgabe: Kapitel 3 startet, Mars lässt eine Ladung Sprengstoff an Bord');
    ok(fakt(u.g, 'sprengstoff') === 'erbeutet', 'Fakt sprengstoff = erbeutet');
    u.g.releaseWorldLock();
  }

  // ---------------------------------------------------------------------------------------------------------------
  section('Scheitern und Wiederholen: der Feldzug scheitert nie');
  {
    const dir = freshDir();
    const t = setup(dir, 1, { startMission: 'eisenwald_ohne' });
    t.ready(); t.run(0.5);
    const g = t.g; const m = g.mission;
    m.kette.einstieg('k3_nebelheim');
    t.run(0.2);
    const karten0 = t.events('chapter').length;
    m.completeMission('rueckzug');
    t.run(0.2);
    ok(aktiv(g) === 'k3_nebelheim' && m.state.stage === 'auftrag', 'Rückzug: dasselbe Kapitel beginnt von vorn');
    ok(t.events('chapter').length === karten0, 'keine zweite Kapitelkarte bei Wiederholung');
    ok(fakt(g, 'kapitel') === 'k3_nebelheim', 'Fakt kapitel bleibt (kein Fortschritt ohne Ziel)');
    ok(!m.done.has('k3_nebelheim:k3_anflug:hin') && (m.doneLog.k3_nebelheim || []).length === 0, 'Wiederholung beginnt mit frischen Zielen');
    const gezaehlt = []; const countError = g.countError.bind(g); g.countError = (w) => gezaehlt.push(w);
    m.completeMission('gibt_es_nicht');
    g.countError = countError;
    ok(aktiv(g) === 'k3_nebelheim' && gezaehlt.includes('kette-folge'), 'unbekannter Ausgang: Szene wird wiederholt und der Fehler gezählt (jede Szene hat einen Ausgang)');
    for (const c of doc.kapitel) {
      if (!c.ausgaenge.rueckzug) continue;
      m.kette.einstieg(c.id);
      m.completeMission('rueckzug');
      ok(aktiv(g) === c.id && fakt(g, 'kapitel') === c.id, `Rückzug ${c.id}: Wiederholung, kein Fortschritt`);
    }
    g.releaseWorldLock();
  }

  // ---------------------------------------------------------------------------------------------------------------
  section('Kampagne Eisenwald mit Tutorial: m1–m3, dann Statio Limitis');
  {
    const dir = freshDir();
    const t = setup(dir, 1, { startMission: 'eisenwald' });
    t.ready(); t.run(0.5);
    const g = t.g; const m = g.mission;
    ok(aktiv(g) === 'm1' && m.kette && g.spielleiter == null, 'Tutorial m1 läuft, Kette angeschlossen, kein Spielleiter');
    ok(g.weltstand.data.tutorial === 'laeuft', 'Weltstand tutorial = laeuft');
    ok(fakt(g, 'kampagne') === 'eisenwald' && fakt(g, 'kapitel') === undefined, 'Fakt kampagne gesetzt, noch kein Kapitel');
    ok(!g.explore.kanteOffen('0305-0306'), 'tutorial-ende noch zu');
    // Tutorial durchwinken (die Abläufe selbst prüfen test-regiebuch und Golden)
    for (const mid of ['m1', 'm2', 'm3']) {
      ok(aktiv(g) === mid, `läuft: ${mid}`);
      m.completeMission(mid === 'm3' && m.flags.m3Direct ? 'erfolg' : (m.def.ausgaenge.erfolg ? 'erfolg' : Object.keys(m.def.ausgaenge)[0]));
      t.run(0.2);
    }
    ok(aktiv(g) === 'k1_anwerbung' && fakt(g, 'kapitel') === 'k1_anwerbung', 'nach m3: Kapitel 1 (Statio Limitis)');
    ok(g.explore.kanteOffen('0305-0306'), 'tutorial-ende offen: der Weg nach Statio Limitis');
    const karten = t.events('chapter').map((e) => e.title);
    ok(karten.length === 1 && /Kapitel 1/.test(karten[0]), 'nur die Kapitelkarte der Kette (keine Tutorial-Karte): ' + karten.join(' | '));
    g.releaseWorldLock();
  }

  // ---------------------------------------------------------------------------------------------------------------
  section('Funk, Briefings, Ersatz, Platzhalter');
  {
    const t = setup(freshDir(), 1, { startMission: 'eisenwald_ohne' });
    t.ready(); t.run(0.5);
    const g = t.g; const m = g.mission;
    m.kette.einstieg('k1_anwerbung'); t.run(0.2);
    // Mars (Symbol) und Legat (Porträt) im Funk
    m.kette.einstieg('k5_legat'); t.run(0.2);
    m.setStep('hafen');
    g.debugGoto('castra_martis', true);
    t.run(1);
    const r1 = t.events('radio').filter((e) => /Wolfstor ist offen/.test(e.text)).pop();
    ok(r1 && r1.from === 'Mars' && r1.pid === 'mars', 'Funk: Mars mit Symbol (pid mars)');
    t.run(9);
    const r2 = t.events('radio').filter((e) => /Streich bei der Methalle/.test(e.text)).pop();
    ok(r2 && /Legat Marcus Severus/.test(r2.from) && r2.pid === 'legat', 'Funk: Legat mit Porträt (pid legat), erster Funkspruch');
    const snap = g.snapshot();
    ok(snap.mission.radio && snap.mission.radio.pid === 'legat' && snap.mission.radio.needsAccept === true, 'Snapshot mission.radio trägt pid und needsAccept (Annahme am Captain)');
    m.accept(); t.run(0.2);
    ok(aktiv(g) === 'k6_orbit' && g.weltstand.data.npc.legat.gedaechtnis.length === 1, 'Annahme des Legaten: Kapitel 6, Gedächtnis-Eintrag erster_funkspruch');
    // Briefings im Missionsbuch (Statio Limitis und Castra Martis)
    const b = m.bookEntries();
    ok(b.some((e) => e.id === 'k1_anwerbung' && e.state === 'erledigt') && b.some((e) => e.id === 'k5_legat' && e.state === 'erledigt' && /Legat/.test(e.briefing)), 'Missionsbuch: Briefings der Kapitel 1 und 5 (erledigt)');
    // Ersatz einer verlorenen Sprengladung im Hafen
    m.kette.einstieg('k3_nebelheim'); t.run(0.2);
    Fracht.restore(g, []);
    g.debugGoto('statio_limitis', true);
    g.missionEvent('docked', { loc: 'statio_limitis' }); t.run(0.1);
    ok(Fracht.anBord(g, 'sprengstoff') === 1, 'Ersatz: Andocken in der Statio Limitis ohne Sprengstoff legt eine Ladung in den Frachtraum');
    g.missionEvent('docked', { loc: 'statio_limitis' }); t.run(0.1);
    ok(Fracht.anBord(g, 'sprengstoff') === 1, 'Ersatz nur, wenn keine Ladung an Bord ist');
    ok(Kampagne.platzhalter().every((p) => /Team (KONVOI|BODEN|FLOTTE)/.test(p.echt)), 'jeder Platzhalter nennt das zuständige Team');
    g.releaseWorldLock();
  }

  // ---------------------------------------------------------------------------------------------------------------
  section('Verdrahtung Boden: echte Szenen in Kapitel 2, 4 und 7 (VERK-BODEN)');
  {
    const Konvoi = require('../server/sim/konvoi.js');
    const Landepunkte = require('../server/sim/landepunkte.js');
    const Away = require('../server/sim/away.js');
    const Anker = require('../server/sim/anker.js');
    const W = require('../server/world.js');
    const Locations = require('../shared/locations.js');
    const rollen = (g) => { g.weltstand.data.rollen_gesehen = ['niederhalter', 'grenadier', 'schuetze', 'enterer']; };
    for (const id of ['k2_konvoi', 'k4_methalle', 'k7_siedlung']) ok(!books[id].steps.some((s) => s.platzhalter), `${id}: kein Platzhalter-Schritt mehr`);
    ok(doc.kapitel.filter((c) => (c.platzhalter || []).length).map((c) => c.id).join() === 'k6_orbit', 'Kette: nur Kapitel 6 (Orbit, Team VERK-ORBIT) hat noch Platzhalter');
    for (const [ort, lp] of [['methalle', 'methalle.siedlung'], ['eisenwald', 'eisenwald.siedlung']]) {
      const l = Locations.get(ort);
      ok(l.scene.beam && l.scene.beam.map === lp && l.scene.station, `${ort}: scene.beam.map = ${lp}`);
    }

    // ---- Kapitel 2: Konvoi, Mehrspieler und Solo
    for (const crew of [3, 1]) {
      const t = setup(freshDir(), crew, { startMission: 'eisenwald_ohne' });
      t.ready(); t.run(0.5);
      const g = t.g; const m = g.mission;
      m.kette.einstieg('k2_konvoi'); t.run(5);
      g.debugGoto('rabenpass', false); t.run(1);
      ok(m.state.stage === 'konvoi' && Konvoi.aktiv(g), `Crew ${crew}: Konvoi-Szene läuft am Rabenpass (${m.state.stage})`);
      const tr = g.space.enemies.filter((e) => e.kind === 'frachter').length;
      const esk = g.space.enemies.filter((e) => e.kind !== 'frachter').map((e) => e.kind).sort().join('+');
      ok(tr === 2, `Crew ${crew}: 2 Transporter`);
      ok(crew === 1 ? esk === 'raider' : esk === 'korvette+raider', `Crew ${crew}: Eskorte ${esk} (solo nur der Jäger, sonst Jäger und Korvette)`);
      ok(!m.flags.konvoi_gepluendert, `Crew ${crew}: die Szene setzt selbst keine Flag`);
      Konvoi.erzwingen(g); t.run(0.3);
      ok(m.state.stage === 'rueck_anflug' && m.flags.konvoi_gepluendert === true, `Crew ${crew}: Ausgang gepluendert -> Flag konvoi_gepluendert, weiter zur Abgabe (${m.state.stage})`);
      g.releaseWorldLock();
    }
    {   // Notfallsprung ist der Rückzug: Kapitel von vorn
      const t = setup(freshDir(), 1, { startMission: 'eisenwald_ohne' });
      t.ready(); t.run(0.5);
      const g = t.g; const m = g.mission;
      m.kette.einstieg('k2_konvoi'); t.run(5);
      g.debugGoto('rabenpass', false); t.run(1);
      m.completeMission('rueckzug'); t.run(0.3);
      ok(aktiv(g) === 'k2_konvoi' && m.state.stage === 'auftrag', 'Rückzug vom Rabenpass: Kapitel 2 beginnt von vorn');
      g.releaseWorldLock();
    }

    // ---- Kapitel 4: Methalle
    {
      const t = setup(freshDir(), 1, { startMission: 'eisenwald_ohne' });
      t.ready(); t.run(0.5);
      const g = t.g; const m = g.mission;
      m.kette.einstieg('k4_methalle'); t.run(5);
      ok(Fracht.anBord(g, 'sprengstoff') === 1 && !(g.inventory.ladung > 0), 'Einstieg k4: Sprengstoff im Frachtraum, nicht im Gepäck');
      g.debugGoto('methalle', false); t.run(3);
      ok(m.state.stage === 'methalle', 'Schritt methalle am Ort Methalle (' + m.state.stage + ')');
      ok(g.inventory.ladung === 1 && Fracht.anBord(g, 'sprengstoff') === 0, 'Sprengstoff aus dem Frachtraum ins Gepäck umgeladen (Inventar ladung 1, Fracht 0)');
      const lp = Landepunkte.liste(g, 'methalle').find((r) => r.id === 'methalle.siedlung');
      ok(lp && lp.frei && lp.art === 'aussenposten' && lp.beam && lp.beam.range === 360, 'Landepunkt methalle.siedlung ist frei (Kampagne, ohne Labor)');
      Landepunkte.get(g, 'methalle.siedlung'); t.run(1);   // der Bau läuft im Spiel außerhalb des Ticks (setImmediate), hier von Hand
      ok(W.AWAY_MAPS['methalle.siedlung'] && W.AWAY_MAPS['methalle.siedlung'].karte && g.aways['methalle.siedlung'].drones.length >= 6, 'Karte der Methalle gebaut und besetzt (Welle 1: 3 Zweiergruppen)');
      // Sprengstoff liegt, Team an Bord: die Szene setzt die Flag; Folgen (Meldung, Sperrriegel) liegen im Schritt meldung
      const K = W.AWAY_MAPS['methalle.siedlung'].karte; const sp = K.anker.find((a) => a.rolle === 'sprengpunkt');
      ok(!m.flags.methalle_gesprengt && !g.explore.sperrriegelOffen(), 'vor dem Setzen: keine Flag, Sperrriegel zu');
      Anker.setzen(g, 'methalle.siedlung', sp.id, 'platziert'); t.run(0.5);
      ok(m.state.stage === 'meldung' && m.flags.methalle_gesprengt === true, 'Sprengstoff liegt und niemand unten: Flag methalle_gesprengt, Schritt meldung (' + m.state.stage + ')');
      ok(g.explore.sperrriegelOffen(), 'Schritt meldung öffnet den Sperrriegel (die Szene ruft das nicht selbst)');
      t.run(10);
      ok(aktiv(g) === 'k5_legat' && fakt(g, 'methalle') === 'zerstoert' && fakt(g, 'sprengstoff') === 'verbraucht', 'Kapitel 4 erfolg: Kapitel 5, Fakten methalle und sprengstoff');
      g.releaseWorldLock();
    }
    {   // Team gefallen (Notrückholung): Karte zurück, Kapitel wiederholt
      const t = setup(freshDir(), 1, { startMission: 'eisenwald_ohne' });
      t.ready(); t.run(0.5);
      const g = t.g; const m = g.mission;
      m.kette.einstieg('k4_methalle'); t.run(5);
      g.debugGoto('methalle', false); t.run(3);
      const resets0 = (g.landepunkte.eintraege['methalle.siedlung'] || {}).resets || 0;
      g.missionEvent('squadRecall', { pids: [] }); t.run(0.5);
      ok(aktiv(g) === 'k4_methalle' && m.state.stage !== 'meldung' && !m.flags.methalle_gesprengt, 'Notrückholung: kein Fortschritt, Kapitel 4 beginnt von vorn (' + m.state.stage + ')');
      ok(((g.landepunkte.eintraege['methalle.siedlung'] || {}).resets || 0) === resets0 + 1, 'Notrückholung: Karte zurückgesetzt (map_reset)');
      t.run(6); g.debugGoto('methalle', false); t.run(3);
      ok(m.state.stage === 'methalle' && g.inventory.ladung === 1, 'Wiederholung: Sprengstoff im Gepäck (ersetzt, falls verbraucht)');
      // gekaufter Sprengstoff genügt: kein Ersatz im Hafen, solange einer im Gepäck liegt
      Fracht.restore(g, []);
      g.debugGoto('statio_limitis', true); g.missionEvent('docked', { loc: 'statio_limitis' }); t.run(0.1);
      ok(Fracht.anBord(g, 'sprengstoff') === 0, 'Hafen: kein Ersatz in den Frachtraum, solange Sprengstoff im Gepäck liegt (gekauft oder umgeladen)');
      g.releaseWorldLock();
    }

    {   // Speichern und Laden mitten in der Methalle: der umgeladene Sprengstoff (Gepäck) und der Schritt bleiben
      const dir = freshDir();
      const t = setup(dir, 1, { startMission: 'eisenwald_ohne' });
      t.ready(); t.run(0.5);
      const id = t.g.weltstand.id; const m = t.g.mission;
      m.kette.einstieg('k4_methalle'); t.run(5);
      t.g.debugGoto('methalle', false); t.run(3);
      ok(m.state.stage === 'methalle' && t.g.inventory.ladung === 1, 'Speichern in der Methalle: Sprengstoff im Gepäck');
      t.g.saveWorld('test', { sync: true });
      const u = weiterspielen(t, dir, id);
      ok(aktiv(u.g) === 'k4_methalle' && u.g.mission.state.stage === 'methalle' && u.g.inventory.ladung === 1, 'geladen: Kapitel 4, Schritt methalle, Sprengstoff im Gepäck (' + u.g.mission.state.stage + ', ' + u.g.inventory.ladung + ')');
      u.g.releaseWorldLock();
    }

    // ---- Kapitel 7: Siedlung, Mehrspieler und Solo
    const LP7 = 'eisenwald.siedlung';
    const landen7 = (t, g, m) => {
      rollen(g);
      m.kette.einstieg('k7_siedlung'); t.run(0.5);
      g.debugGoto('eisenwald', false); t.run(8);
      Landepunkte.get(g, LP7);
      g.transferZiel = { lp: LP7, scene: g.ship.scene }; g.setAwayMap(LP7);
      Away.executeBeam(g, g.players.map((p) => p.id), 'down'); t.run(1);
    };
    for (const crew of [3, 1]) {
      const t = setup(freshDir(), crew, { startMission: 'eisenwald_ohne' });
      t.ready(); t.run(0.5);
      const g = t.g; const m = g.mission;
      landen7(t, g, m);
      ok(m.state.stage === 'siedlung' || m.state.stage === 'siedlung_kampf', `Crew ${crew}: Szene am Eisenwald (${m.state.stage})`);
      if (crew === 1) {
        t.run(12);   // Solo: ein Legionär hisst mit (10 s nach dem Runterbeamen)
        ok(m.state.stage === 'siedlung_kampf' && m.flags.flagge_gehisst === true, `Crew 1: Legionär hisst mit, Flag flagge_gehisst, Angriff beginnt (${m.state.stage})`);
      } else {
        t.run(12);
        ok(m.state.stage === 'siedlung' && !m.flags.flagge_gehisst, 'Crew 3: ohne zwei Halter bleibt das Feldzeichen unten (kein Legionär, Hissen zu zweit)');
        Anker.setzen(g, LP7, 'platz.flagge', 'gehisst'); t.run(0.5);
        ok(m.state.stage === 'siedlung_kampf' && m.flags.flagge_gehisst === true, 'Crew 3: gehisst -> Flag flagge_gehisst, Angriff (' + m.state.stage + ')');
      }
      const aw = g.aways[LP7]; const gegner = aw.drones.filter((d) => d.alive).length;
      ok(crew === 1 ? gegner === 6 : gegner === 11, `Crew ${crew}: ${gegner} Gegner (Anführer eingerechnet; solo 5 + 1, sonst 10 + 1)`);
      ok(!m.flags.boss_besiegt, `Crew ${crew}: boss_besiegt noch nicht`);
      // Anführer fällt: Gegner beamen raus, boss_besiegt erst wenn das Team wieder an Bord ist
      aw.drones.find((d) => d.id === aw.endkampf.boss).alive = false; t.run(0.5);
      ok(aw.drones.length === 0 && !m.flags.boss_besiegt && m.state.stage === 'siedlung_kampf', `Crew ${crew}: Anführer gefallen, Gegner abgezogen, boss_besiegt wartet auf das Hochbeamen`);
      Away.executeBeam(g, g.players.map((p) => p.id), 'up'); t.run(1);
      ok(aktiv(g) === 'k8_sieg' && fakt(g, 'eisenwald') === 'roemisch', `Crew ${crew}: Team an Bord -> boss_besiegt, Kapitel 7 erfolg, Kapitel 8 (${aktiv(g)})`);
      g.releaseWorldLock();
    }
    {   // Crew fällt im Angriff: Siedlung zurück, Flags weg, Kapitel 7 von vorn
      const t = setup(freshDir(), 3, { startMission: 'eisenwald_ohne' });
      t.ready(); t.run(0.5);
      const g = t.g; const m = g.mission;
      landen7(t, g, m);
      Anker.setzen(g, LP7, 'platz.flagge', 'gehisst'); t.run(0.5);
      g.aways[LP7].endkampf.verloren = true; t.run(0.5);
      ok(aktiv(g) === 'k7_siedlung' && !m.flags.flagge_gehisst && !m.flags.boss_besiegt, 'Crew gefallen: Flags gelöscht, kein Fortschritt (' + m.state.stage + ')');
      ok(Anker.zustand(g, LP7, 'platz.flagge') === 'unten' && !g.aways[LP7].endkampf, 'Siedlung zurückgesetzt: Feldzeichen unten, kein Angriff mehr');
      g.releaseWorldLock();
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  section('Debug-Einstieg und Aufräumen');
  {
    const t = setup(freshDir(), 1, { startMission: 'm1' });
    t.ready(); t.run(0.3);
    ok(t.g.mission.kette == null, 'Kampagne mit Spielleiter (m1) hat keine Kette');
    const t2 = setup(freshDir(), 1, { startMission: 'eisenwald_ohne' });
    t2.ready(); t2.run(0.3);
    t2.send(0, { t: 'debug', cmd: 'kapitel', args: 'k6_orbit' }); t2.run(0.2);
    ok(aktiv(t2.g) === 'k6_orbit' && t2.g.ship.scene === 'castra_martis', 'Debug kapitel k6_orbit: Castra Martis, Kapitel 6');
    t2.send(0, { t: 'debug', cmd: 'kapitel', args: 'gibts_nicht' });
    ok(aktiv(t2.g) === 'k6_orbit', 'Debug kapitel mit unbekanntem Kapitel ändert nichts');
    t2.g.releaseWorldLock(); t.g.releaseWorldLock();
  }

  console.log(`\n${n - fails}/${n} Prüfungen bestanden (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(fails ? 1 : 0);
}
main();
