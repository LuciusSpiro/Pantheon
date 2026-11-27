'use strict';
// TRA-01 Nacharbeit (Befunde nach Review): Neustart, Bots, Mehrspieler-Ablehnung, Reparatur-Wächter, Sprachwahl, Weltstand.
//   node tools/test-training-nacharbeit.js
//   W1  Neustart      alle erwartet-Flags des Trainingsbuchs (nicht nur ziel_) stehen nach dem Neustart wieder auf Standard (Fliegen, Captain Tafel und Sprache)
//   W2  Bots          Trainings-Bots verschwinden beim Weg in die Lobby; Fliegen startet ohne vorhandene Lobby-Bots
//   W3  Ein Mensch    Training mit zwei Menschen: Start abgelehnt, Lobby intakt; vorbelegte Bots in falscher Reihenfolge: Livia/Navigation, Cassius/Ops, Titus/Technik
//   W4  Reparatur     der Wächter beschädigt neu, solange das Ziel offen ist (Sackgasse nach den drei festen Timern)
//   N1  Sprachwahl    Captain mit Sprache: nach „Partie beenden“ bleibt die Wahl für den nächsten Start
//   N2  Hinweise      h.reparieren feuert nicht, wenn der Befehl schon gegeben ist; b_schnell / b_rueckflug warten 90 s
//   N5  Weltstand     gewählter Weltstand: das Training legt keine Bots an
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Training = require('../server/sim/training.js');
const Erk = require('../server/sim/training-erkennung.js');
const Captain = require('../server/sim/training-captain.js');
const Gen = require('./gen-tra-captain.js');
const SimC = require('./sim-training-captain.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

// Lobby mit np Menschen; Modus gewählt, noch nicht bereit. noten = alle notice-Texte
function lobby(modus, np, o) {
  o = o || {};
  const g = new Game({ noStore: true, worlds: false, seed: o.seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off' }, log: () => {} });
  const noten = []; const n0 = g.notice.bind(g); g.notice = (p, t) => { noten.push(String(t)); return n0(p, t); };
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'N' + i, name: 'Nr' + i, color: i });
    cs.push(c);
  }
  if (modus) g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: modus });
  const T = { g, cs, noten, run: (sec, bis) => { for (let k = 0; k < Math.round(sec / DT); k++) { g.step(); if (bis && bis()) return true; } return !bis; } };
  T.bereit = () => { for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true }); };
  T.beenden = () => g.handleMessage(cs[0], { t: 'menu', op: 'end' });
  return T;
}
const bots = (g) => g.players.filter((p) => p.bot);
const rollen = (g) => bots(g).map((b) => b.rolle + '/' + b.botId).join(',');

// ---------- W1 ----------
function neustartProbe(modus, sprache) {
  const T = lobby(modus, 1); const g = T.g;
  if (sprache) g.handleMessage(T.cs[0], { t: 'lobbyOpt', trainingSprache: true });
  T.bereit(); T.run(2);
  const buch = Training.buchFuer(g); const def = g.mission.loadDef(buch);
  const erwartet = def.erwartet;
  for (const k of Object.keys(erwartet)) g.mission.flags[k] = true;   // wie nach einem durchgespielten Versuch
  g.mission.flags.ziel_tempo_hoch = true;
  g.mission.setStep(g.mission.def.steps[g.mission.def.steps.length - 1].id);
  g.mission.completeMission('verloren');
  T.run(40, () => g.arena.training.versuch === 2);
  return { g, erwartet, buch };
}
for (const [modus, sprache, name] of [['training_fliegen', false, 'Fliegen'], ['training_captain', false, 'Captain Tafel'], ['training_captain', true, 'Captain Sprache']]) {
  section('W1 Neustart ' + name, () => {
    const { g, erwartet, buch } = neustartProbe(modus, sprache);
    ok(g.arena.training.versuch === 2 && g.mission.activeId === buch, 'Versuch 2, Buch ' + buch + ' aktiv');
    const falsch = Object.keys(erwartet).filter((k) => g.mission.flags[k] !== erwartet[k]);
    ok(falsch.length === 0, 'alle erwartet-Flags (' + Object.keys(erwartet).join(',') + ') wieder auf Standard' + (falsch.length ? ', noch falsch: ' + falsch.join(',') : ''));
    ok(!Object.keys(g.mission.flags).some((k) => k.startsWith('ziel_')), 'keine ziel_-Flags');
    ok(g.mission.step && g.mission.step.id === g.mission.def.steps[0].id, 'Buch startet im ersten Schritt (' + (g.mission.step && g.mission.step.id) + ')');
    ok(g.mission.state.objectives.every((o) => !o.done), 'Checkliste am Start leer (kein Ziel abgehakt)');
    ok(g.errors === 0, 'g.errors 0');
  });
}

// ---------- W2 ----------
section('W2 Trainings-Bots verschwinden', () => {
  const T = lobby('training_captain', 1); const g = T.g;
  T.bereit(); T.run(2);
  ok(bots(g).length === 3, 'Captain-Training: drei Bots (' + bots(g).length + ')');
  T.beenden();
  ok(g.phase === 'lobby', 'Partie beendet: Lobby');
  ok(bots(g).length === 0, 'Lobby ohne Bots (' + rollen(g) + ')');
  g.handleMessage(T.cs[0], { t: 'lobbyOpt', startMission: 'training_fliegen' });
  T.bereit(); T.run(2);
  ok(g.arena && g.arena.kind === 'training_fliegen' && bots(g).length === 0, 'danach Fliegen: keine Bots');
  T.beenden();
  g.handleMessage(T.cs[0], { t: 'lobbyOpt', startMission: 'm1' });
  T.bereit(); T.run(2);
  ok(g.phase === 'play' && bots(g).length === 0, 'danach Kampagne: keine Bots (' + bots(g).length + ')');
});
section('W2 Fliegen räumt vorhandene Lobby-Bots', () => {
  const T = lobby('training_fliegen', 1); const g = T.g;
  const BS = require('../server/bots/spieler.js');
  BS.botHinzufuegen(g, null, 'ops'); BS.botHinzufuegen(g, null, 'technik');
  ok(bots(g).length === 2, 'Vorbedingung: zwei Lobby-Bots');
  T.bereit(); T.run(2);
  ok(g.phase === 'play' && bots(g).length === 0, 'Fliegen: Ein-Mensch-Modus ohne Bots (' + bots(g).length + ')');
  ok(g.players.length === 1, 'nur der Mensch bleibt (' + g.players.length + ')');
});
section('W2 vom Menschen gesetzte Bots bleiben nach einer Kampagnenpartie', () => {
  const T = lobby('m1', 1); const g = T.g;
  require('../server/bots/spieler.js').botHinzufuegen(g, null, 'ops');
  T.bereit(); T.run(1); T.beenden();
  ok(bots(g).length === 1, 'Kampagne: ein vom Menschen gesetzter Bot bleibt (Gegenprobe, nur Trainings-Bots räumen)');
});

// ---------- W3 ----------
section('W3 zwei Menschen: Start abgelehnt', () => {
  for (const modus of ['training_captain', 'training_fliegen']) {
    const T = lobby(modus, 2); const g = T.g;
    T.bereit(); T.run(1);
    ok(g.phase === 'lobby', modus + ': Phase bleibt Lobby (' + g.phase + ')');
    ok(T.noten.some((t) => /Training ist ein Ein-Spieler-Modus/.test(t)), modus + ': Hinweis „Training ist ein Ein-Spieler-Modus“ (' + T.noten.slice(0, 2).join(' | ') + ')');
    ok(g.players.filter((p) => !p.bot).every((p) => !p.ready), modus + ': Menschen wieder nicht bereit');
    ok(bots(g).length === 0, modus + ': keine Bots angelegt');
    ok(g.lobbyOpts.startMission === modus, modus + ': Moduswahl bleibt');
    // Lobby hängt nicht: ein Mensch geht, der andere startet
    g.handleMessage(T.cs[1], { t: 'leave' }); g.removeConnection(T.cs[1]);
    g.handleMessage(T.cs[0], { t: 'ready', ready: true }); T.run(1);
    ok(g.phase === 'play' && g.arena && g.arena.kind === modus, modus + ': nach dem Abgang startet der verbliebene Mensch');
  }
});
section('W3 vorbelegte Bots in falscher Reihenfolge', () => {
  const T = lobby('training_captain', 1); const g = T.g;
  const BS = require('../server/bots/spieler.js');
  for (const r of ['technik', 'ops', 'navigation']) BS.botHinzufuegen(g, null, r);
  ok(rollen(g) === 'technik/b0,ops/b1,navigation/b2', 'Vorbedingung falsche Reihenfolge (' + rollen(g) + ')');
  T.bereit(); T.run(2);
  const von = (r) => bots(g).find((b) => b.rolle === r);
  ok(bots(g).length === 3 && von('navigation').botId === 'b0' && von('ops').botId === 'b1' && von('technik').botId === 'b2', 'Livia/b0 Navigation, Cassius/b1 Ops, Titus/b2 Technik (' + rollen(g) + ')');
  const P = SimC.partie(5, true);   // Namensadresse „Livia“ (= b0) trifft den Navigations-Bot
  const st = P.g.players.find((p) => p.bot && p.botId === 'b0');
  ok(st && st.rolle === 'navigation', 'b0 ist der Navigations-Bot');
});
section('W3 zwei Menschen und Bots: der Technik-Bot fehlt nie', () => {
  const T = lobby('training_captain', 1); const g = T.g;
  T.bereit(); T.run(2);
  ok(['navigation', 'ops', 'technik'].every((r) => bots(g).some((b) => b.rolle === r)), 'Ein Mensch: alle drei Rollen besetzt');
});

// ---------- W4 ----------
section('W4 Reparatur: Wächter beschädigt neu', () => {
  const P = SimC.partie(3, false); const g = P.g; const sh = g.ship;
  P.run(2);
  g.mission.setStep('reparatur');
  const beschaedigt = () => ['engines', 'transfer', 'weapon_bow', 'shields'].filter((s) => sh.systems[s] !== 'ok').length;
  ok(beschaedigt() === 4, 'Schritt reparatur: vier Systeme beschädigt');
  let spaeter = 0; let tHeil = null;
  for (let t = 0; t < 400; t += 1) {
    P.run(1);
    if (beschaedigt() === 0 && tHeil == null) tHeil = t;
    if (t > 320 && beschaedigt() > 0) spaeter++;   // die alten festen Timer (75/150/225 s) wirken nur bis rund 285 s
  }
  ok(tHeil != null && tHeil < 150, 'Titus hat alles repariert (nach ' + tHeil + ' s)');
  ok(spaeter > 0, 'nach 320 bis 400 s ohne Befehl ist wieder ein System beschädigt (' + spaeter + ' s lang)');
  ok(g.arena.training.erreicht.has('repariert') === false, 'Ziel repariert noch offen (Eigenreparatur zählt nicht)');
  P.run(60, () => beschaedigt() > 0);   // das Nachlegen kommt nach REPARATUR_NEU_S s
  const system = ['transfer', 'engines', 'weapon_bow', 'shields'].find((s) => sh.systems[s] !== 'ok');
  ok(!!system, 'ein System ist beschädigt, das der Spieler wählen kann');
  SimC.befehlen(P, 'technik', 'tech.reparieren', 'taste', { system });
  ok(P.run(150, () => g.arena.training.erreicht.has('repariert')), 'Befehl nach dem Nachlegen löst das Ziel');
  ok(g.errors === 0, 'g.errors 0');
});
section('W4 Wächter nur im Schritt reparatur', () => {
  const P = SimC.partie(4, false); const g = P.g;
  P.run(2);
  for (const s of ['engines', 'transfer', 'weapon_bow', 'shields']) g.ship.systems[s] = 'ok';
  P.run(60);
  ok(['engines', 'transfer', 'weapon_bow', 'shields'].every((s) => g.ship.systems[s] === 'ok'), 'in anderen Schritten keine Neubeschädigung (Schritt ' + g.mission.step.id + ')');
});

// ---------- N1 ----------
section('N1 Sprachwahl bleibt beim Wiederholen', () => {
  const T = lobby('training_captain', 1); const g = T.g;
  g.handleMessage(T.cs[0], { t: 'lobbyOpt', trainingSprache: true });
  T.bereit(); T.run(2);
  ok(g.arena.training.sprache === true && g.mission.activeId === 'tra_captain_sprache', 'erster Start mit Sprache');
  T.beenden();
  ok(g.lobbyOpts.startMission === 'training_captain' && g.lobbyOpts.trainingSprache === true, 'nach „Partie beenden“: Wahl Sprache bleibt (' + g.lobbyOpts.trainingSprache + ')');
  ok(g.snapshot().lobby.trainingSprache === true, 'Lobby-Snapshot zeigt Sprache');
  T.bereit(); T.run(2);
  ok(g.arena.training.sprache === true && g.mission.activeId === 'tra_captain_sprache', 'Wiederholen startet die Sprachvariante');
  T.beenden();
  g.handleMessage(T.cs[0], { t: 'lobbyOpt', startMission: 'training_fliegen' });
  g.handleMessage(T.cs[0], { t: 'lobbyOpt', startMission: 'training_captain' });
  ok(g.lobbyOpts.trainingSprache === false, 'Moduswechsel setzt die Wahl zurück');
});

// ---------- N2 ----------
section('N2 Hinweise nur bei Hängern', () => {
  for (const v of ['tafel', 'sprache']) {
    const rep = Gen.buch(v).steps.find((s) => s.id === 'reparatur');
    const h = rep.timers.find((t) => t.oda === '@h.reparieren');
    ok(h && !JSON.stringify(h.if).includes('"repariert') && JSON.stringify(h.if).includes('tech.reparieren'), v + ': h.reparieren hängt nur am Befehl, nicht am Reparaturerfolg');
  }
  const P = SimC.partie(7, false); const g = P.g; P.run(2);
  g.mission.setStep('reparatur'); P.run(0.5);
  const sys = ['transfer', 'engines', 'weapon_bow', 'shields'].find((s) => g.ship.systems[s] !== 'ok');
  SimC.befehlen(P, 'technik', 'tech.reparieren', 'taste', { system: sys });
  P.run(70);
  const text = Gen.buch('tafel').texte['h.reparieren'];
  ok(!P.odas.includes(text), 'Befehl gegeben: der Hinweis h.reparieren feuert nicht');
  const fl = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'content', 'regiebuecher', 'tra_fliegen.regiebuch.json'), 'utf8'));
  for (const id of ['b_schnell', 'b_rueckflug']) {
    const st = fl.steps.find((s) => s.id === id);
    const t = st.timers.find((x) => x.garantie === 'hinweis');
    ok(t && t.at >= 90, id + ': Hinweis frühestens nach 90 s (' + (t && t.at) + ')');
  }
});

// ---------- N5 ----------
section('N5 Weltstand gewählt: keine Trainings-Bots', () => {
  const T = lobby('training_captain', 1); const g = T.g;
  g.worldsEnabled = true; let weiter = null; g.continueWorld = (id) => { weiter = id; return true; };
  g.lobbyOpts.world = 'w1';
  T.bereit();
  ok(weiter === 'w1', 'Start setzt den Weltstand fort');
  ok(bots(g).length === 0, 'keine Bots für den abgelösten Trainingsstart (' + bots(g).length + ')');
});

console.log('\nTEST-TRAINING-NACHARBEIT: ' + (fails ? fails + ' FEHLER von ' + n : 'alle ' + n + ' bestanden'));
process.exit(fails ? 1 : 0);
