'use strict';
// TRA-01 E: Captain-Training (Setup, Übungsziele, Wächter, Bücher, Läufe), headless über den echten Lobby-Weg.
//   node tools/test-training-captain.js
//   Bücher       tra_captain / tra_captain_sprache: Checker, Katalog (nie im Brett), Erzeugung (gen-tra-captain.js --check), Quellen je Variante, Ziel-Ids, Hinweise (<= 120 Zeichen)
//   Setup        1 Mensch an der Captain-Konsole + 3 Bots an Navigation/Ops/Technik (Livia/Cassius/Titus), errors 0; andere Modi bekommen keine Bots; Lobby-Bots werden nicht doppelt angelegt
//   Ops-Sperre   Cassius schießt nicht unkommandiert (auch nicht nach bot.automatik), erst nach ops.feuer_frei; Abschuss, Nachrücken an dieselbe Stelle, keine Marken
//   Ziele        zwei stationäre, unbewaffnete Relais (Drift 0, hp 2, kein Schuss), einzeln anvisierbar (objekt / markiert / naechstes), Neustart räumt sie
//   Reparatur    tech.reparieren zieht ein System nach vorn; "repariert" nur mit Befehl, nie durch Eigenreparatur
//   Sprünge      normaler Sprung und Schnellsprung (Route), vorerkunden nötig, keine Zufallsbegegnung im Schnellsprung
//   Tab          im Stand: tab:helm und tab:captain; Tab-Falle: Sicherheitsstopp am Szenenrand, nur ohne Mensch am Steuer und ohne Bot-Kurs
//   Abzeichen    beide Varianten über den scripted Lauf (sim-training-captain.js), richtige Variante; Neustart behält die Bots
//   Zwei Seiten  Befehle mit der Quelle der anderen Variante zählen nicht; nav.sprung nur menu/taste
//   Hinweise     kein Hinweis solange man vorankommt; ein Hänger bekommt genau einen Hinweis; keine Doppelansage durch CONSOLE_HELP
const fs = require('fs');
const path = require('path');
const Checker = require('../server/mission/checker.js');
const Mission = require('../server/sim/mission.js');
const Training = require('../server/sim/training.js');
const Captain = require('../server/sim/training-captain.js');
const Erk = require('../server/sim/training-erkennung.js');
const Station = require('../server/sim/station.js');
const Lauf = require('../server/bots/lauf.js');
const Crew = require('../server/sim/crew.js');
const Sim = require('./sim-training-captain.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const DIR = path.join(__dirname, '..', 'content', 'regiebuecher');
const lesen = (id) => JSON.parse(fs.readFileSync(path.join(DIR, id + '.regiebuch.json'), 'utf8'));

// Partie bis die Bots an ihren Stationen sitzen
function bereit(seed, sprache) {
  const P = Sim.partie(seed || 3, !!sprache);
  P.run(20, () => ['helm', 'weapons', 'technik'].every((k) => P.g.players.some((p) => p.bot && Station.stationOf(p) === k)));
  P.hat = (id) => Erk.erreicht(P.g, id);
  P.bot = (rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
  P.agent = (rolle) => Lauf.agent(P.g, P.bot(rolle));
  P.ziele = () => P.g.arena.training.uebung;
  P.ziel = (k) => P.g.space.enemies.find((e) => e.id === P.ziele()[k].id);
  P.objektiv = (id) => (P.g.mission.state.objectives.find((o) => o.id === id) || {}).done;
  P.nav = (ziel) => Sim.befehlen(P, 'navigation', 'nav.kurs', 'menu', { ziel });
  return P;
}
// bis zum Schritt step (die Pflichtziele davor werden mit Sim-Handgriffen erfüllt)
function bis(P, step) {
  const g = P.g; const T = g.arena.training;
  const stufen = ['stand', 'kurs', 'ziele', 'kampf', 'reparatur', 'sprung'];
  const ziel = stufen.indexOf(step);
  const im = () => stufen.indexOf(g.mission.step ? g.mission.step.id : 'sprung');
  if (im() < ziel) {   // stand -> kurs
    P.cmd({ c: 'captain.selectDest', dest: 'splitter' }); P.run(0.5); P.cmd({ c: 'captain.marker', x: 1100, y: 450 }); P.run(0.5);
    for (let i = 0; i < 4; i++) { P.cmd({ c: 'station.tab', dir: 1 }); P.run(1); }
    P.run(2);
  }
  if (im() < ziel) {   // kurs -> ziele
    Sim.befehlen(P, 'navigation', 'nav.kurs', 'menu', { ziel: 'marke' });
    Sim.warten(P, 'Anflug', 120, () => P.hat('marke_erreicht'));
    Sim.befehlen(P, 'navigation', 'nav.stopp', 'menu'); P.run(2);
  }
  if (im() < ziel) {   // ziele -> kampf
    for (const k of Object.keys(T.uebung)) { P.cmd({ c: 'captain.anzeigeziel', id: T.uebung[k].id }); Sim.befehlen(P, 'ops', 'ops.ziel', 'menu', { ziel: 'markiert' }); P.run(1.5); }
    P.run(2);
  }
  if (im() < ziel) {   // kampf -> reparatur
    P.run(1.5);
    Sim.befehlen(P, 'navigation', 'nav.abstand', 'menu', { ziel: 'ziel', meter: 250 });
    const e = () => g.space.enemies.find((q) => q.id === T.uebung.b.id);
    Sim.warten(P, 'Schussposition', 60, () => { const z = e(); return z && Math.hypot(g.ship.x - z.x, g.ship.y - z.y) < 330; });
    Sim.befehlen(P, 'ops', 'ops.scan', 'menu'); P.run(2);
    Sim.befehlen(P, 'ops', 'ops.feuer_frei', 'menu');
    Sim.warten(P, 'Abschuss', 60, () => P.hat('abschuss'));
    Sim.befehlen(P, 'ops', 'ops.feuer_halt', 'menu'); P.run(2);
  }
  return P;
}

// ---------- Bücher ----------
section('Bücher: Checker, Katalog, Erzeugung, Quellen', () => {
  const katalog = Mission.catalog();
  const Gen = require('./gen-tra-captain.js');
  for (const [id, quellen] of [['tra_captain', ['menu', 'taste']], ['tra_captain_sprache', ['text', 'sprache']]]) {
    const doc = lesen(id); const r = Checker.check(doc);
    ok(r.ok && !r.errors.length, id + ': Checker akzeptiert das Buch (' + (r.errors || []).map((e) => e.code).join(',') + ')');
    ok(doc.kopf.art === 'intern' && doc.erwartet.trainingFertig === false && doc.steps.map((s) => s.id).join() === 'stand,kurs,ziele,kampf,reparatur,sprung', id + ': intern, Flag trainingFertig, Schritte stand..sprung');
    ok(!!katalog.books[id] && !katalog.invalid.some((x) => x.id === id) && !katalog.order.includes(id), id + ': im Katalog geladen, nicht im Angebotsbrett');
    const text = JSON.stringify(doc);
    const ids = [...text.matchAll(/"id":"((?:bot_befehl|bot_quelle|bot_name|ziel_angewaehlt|repariert)[^"]*)"/g)].map((m) => m[1]);
    ok(ids.length > 10 && ids.every((x) => Erk.istZielId(x)), id + ': alle ' + ids.length + ' Ziel-Ids kennt die Erkennung');
    const fremd = ids.filter((x) => /^(?:bot_befehl:[a-z.]+|bot_name|ziel_angewaehlt:[a-z]|repariert):(menu|taste|text|sprache)$/.test(x.replace(/^ziel_angewaehlt:[a-z]:/, 'ziel_angewaehlt:a:')) || /:(menu|taste|text|sprache)$/.test(x)).filter((x) => !quellen.includes(x.split(':').pop()));
    ok(fremd.every((x) => /^bot_befehl:nav\.sprung:(menu|taste)$/.test(x)), id + ': Quellen nur ' + quellen.join('/') + ' (Ausnahme nav.sprung: menu/taste); fremde: ' + fremd.join(','));
    const sprungIds = ids.filter((x) => /^bot_befehl:nav\.sprung/.test(x));
    ok(sprungIds.length > 0 && sprungIds.every((x) => /:(menu|taste)$/.test(x)), id + ': nav.sprung nur über menu/taste');
    const odas = Object.entries(doc.texte).filter(([k]) => /^(h\.|.*\.start|.*\.start2|ende|reparatur\.nochmal)/.test(k));
    ok(odas.every(([, t]) => t.length <= 120), id + ': alle ' + odas.length + ' ODA-Zeilen höchstens 120 Zeichen');
  }
  ok(!lesen('tra_captain').texte['ziel.name'] && !!lesen('tra_captain_sprache').texte['ziel.name'], 'Namensadresse ("Livia, …") nur in der Sprachvariante');
  const T = Training.TRAININGSMODI.training_captain;
  ok(T.buch === 'tra_captain' && T.buchSprache === 'tra_captain_sprache' && JSON.stringify(T.bots) === '["navigation","ops","technik"]' && T.konsole === 'captain' && T.vorerkunden.hexe.includes('0406'), 'Tabelle: buch, buchSprache, bots, konsole, vorerkunden');
  const abw = Gen.erzeugen().filter((e) => fs.readFileSync(e.datei, 'utf8').replace(/\r\n/g, '\n') !== e.inhalt);
  ok(abw.length === 0, 'Bücher entsprechen der Erzeugung (node tools/gen-tra-captain.js)');
});

// ---------- Setup ----------
section('Setup: Mensch, drei Bots, Konsole', () => {
  const P = bereit(3); const g = P.g;
  ok(g.phase === 'play' && g.mission.activeId === 'tra_captain' && g.mission.step.id === 'stand', 'Tafel-Buch aktiv im Schritt stand');
  const bots = g.players.filter((p) => Crew.istBot(p));
  ok(bots.length === 3 && Crew.menschen(g) === 1, '1 Mensch + 3 Bots (menschen ' + Crew.menschen(g) + ', Bots ' + bots.length + ')');
  ok(P.bot('navigation').name === 'Livia' && P.bot('ops').name === 'Cassius' && P.bot('technik').name === 'Titus', 'Figuren Livia (Navigation), Cassius (Ops), Titus (Technik): ' + bots.map((b) => b.name + '/' + b.rolle).join(' '));
  ok(Station.stationOf(P.bot('navigation')) === 'helm' && Station.stationOf(P.bot('ops')) === 'weapons' && Station.stationOf(P.bot('technik')) === 'technik', 'Bots sitzen an Steuer, Ops und Technik');
  ok(P.h.console === 'captain' && Station.stationOf(P.h) === 'captain', 'Mensch an der Captain-Konsole');
  ok(Lauf.agenten(g).length === 3 && g.errors === 0, 'drei Agenten, g.errors 0 (' + g.errors + ')');
  ok(g.ship.scene === 'hafen' && g.ship.docked === true && g.space.enemies.length === 0, 'Start angedockt im Hafen, keine Gegner');
  ok(['0206', '0306', '0406', '0207'].every((h) => g.explore.hexErkundet(h)), 'Sprungvorerkundung angewendet (vorerkunden)');
  ok(P.agent('ops').absicht.feuer === 'halt', 'Cassius startet mit Feuer halt (intern, kein gezählter Befehl)');
  ok(!P.hat('bot_befehl') && !P.hat('konsole:captain'), 'Herrichten der Szene zählt nicht als Ziel');
  // andere Modi: keine Bots
  for (const modus of ['training_fliegen', 'arena_space', 'm1']) {
    const G = new (require('../server/game.js').Game)({ noStore: true, worlds: false, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send() {}, sendRaw() {} }; G.addConnection(c);
    G.handleMessage(c, { t: 'hello', clientId: 'X', name: 'X', color: 0 }); G.handleMessage(c, { t: 'lobbyOpt', startMission: modus }); G.handleMessage(c, { t: 'ready', ready: true });
    ok(G.phase === 'play' && G.players.filter((p) => Crew.istBot(p)).length === 0, modus + ': startet ohne Bots');
  }
  // Bots aus der Lobby werden nicht verdoppelt
  const BS = require('../server/bots/spieler.js');
  const G = new (require('../server/game.js').Game)({ noStore: true, worlds: false, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} }; G.addConnection(c);
  G.handleMessage(c, { t: 'hello', clientId: 'X', name: 'X', color: 0 }); BS.botHinzufuegen(G, null, 'ops');
  G.handleMessage(c, { t: 'lobbyOpt', startMission: 'training_captain' }); G.handleMessage(c, { t: 'ready', ready: true });
  ok(G.players.filter((p) => Crew.istBot(p)).map((p) => p.rolle).sort().join() === 'navigation,ops,technik', 'Bot aus der Lobby bleibt, die übrigen kommen dazu (je Rolle genau einer)');
});

// ---------- Ops-Sperre und Übungsziele ----------
section('Ops-Sperre, Abschuss, Nachrücken, keine Marken', () => {
  const P = bereit(3); const g = P.g;
  bis(P, 'ziele');
  ok(!!P.ziele() && P.ziele().a && P.ziele().b, 'Schritt ziele: zwei Übungsziele gestellt');
  const A = P.ziel('a'), B = P.ziel('b');
  const posA = [A.x, A.y], posB = [B.x, B.y];
  ok(A.kind === 'relay' && B.kind === 'relay' && A.tag === 'training' && A.ohneBeute === true && A.orbitDir === 0 && A.hp === 2, 'Störrelais, tag training, ohne Beute, orbitDir 0, hp 2');
  ok(Math.hypot(A.x - B.x, A.y - B.y) > 150, 'die beiden Ziele stehen an verschiedenen Ringpositionen (' + Math.round(Math.hypot(A.x - B.x, A.y - B.y)) + ' px)');
  const sh = g.ship; const treffer0 = g.stats.hits;
  // Ziel A anvisieren, Livia in den Bogen, ohne Freigabe: kein Schuss
  P.cmd({ c: 'captain.anzeigeziel', id: A.id }); Sim.befehlen(P, 'ops', 'ops.ziel', 'menu', { ziel: 'markiert' }); P.run(1.5);
  Sim.befehlen(P, 'navigation', 'nav.abstand', 'menu', { ziel: 'ziel', meter: 250 });
  Sim.warten(P, 'in Reichweite', 60, () => Math.hypot(sh.x - A.x, sh.y - A.y) < 330);
  const kills0 = g.stats.kills; const marken0 = g.inventory.marks;
  P.run(20);
  ok(A.hp === 2 && g.space.enemies.includes(A) && g.stats.kills === kills0, 'in Reichweite, Feuer halt: Cassius schießt 20 s nicht (hp ' + A.hp + ')');
  Sim.befehlen(P, 'alle', 'bot.automatik', 'menu');   // verwirft alle Befehle und den Feuerzustand der Bots
  P.run(0.5);
  Sim.befehlen(P, 'navigation', 'nav.abstand', 'menu', { ziel: 'ziel', meter: 250 });   // das Ops-Ziel (ship.target) bleibt A
  P.run(15);
  ok(A.hp === 2 && P.agent('ops').absicht.feuer === 'halt' && Math.hypot(sh.x - A.x, sh.y - A.y) < 330, 'nach bot.automatik bleibt die Sperre (der Wächter setzt Feuer halt zurück): 15 s in Reichweite ohne Schuss');
  ok(Math.hypot(A.x - posA[0], A.y - posA[1]) < 0.5 && Math.hypot(B.x - posB[0], B.y - posB[1]) < 0.5, 'beide Relais stationär (Drift 0 über ' + Math.round(g.time) + ' s)');
  ok(g.stats.hits === treffer0 && Object.values(sh.systems).filter((s) => s !== 'ok').length === 0, 'Relais schießen nie auf die Lerche (keine Treffer, alle Systeme heil)');
  P.run(0.5);
  Sim.befehlen(P, 'ops', 'ops.feuer_frei', 'menu');
  Sim.warten(P, 'Abschuss', 30, () => P.hat('abschuss'));
  ok(P.hat('abschuss') && g.inventory.marks === marken0, 'nach ops.feuer_frei: Abschuss; keine Marken für das Training (' + marken0 + ' -> ' + g.inventory.marks + ')');
  const neu = () => g.space.enemies.filter((e) => e.tag === 'training' && e !== A && e !== B);
  Sim.warten(P, 'Nachrücken', 15, () => neu().length > 0);
  const N = neu()[0];
  ok(!!N && Math.hypot(N.x - posA[0], N.y - posA[1]) < 2 && N.orbitDir === 0, 'nach dem Abschuss rückt ein neues Ziel an dieselbe Stelle nach, stationär');
  ok(g.space.enemies.filter((e) => e.tag === 'training').length === 2 && g.errors === 0, 'immer genau zwei Übungsziele; g.errors 0');
});

section('Ziele einzeln anvisierbar (objekt, markiert, naechstes)', () => {
  const P = bereit(3); const g = P.g; bis(P, 'ziele');
  const A = P.ziele().a.id, B = P.ziele().b.id;
  Sim.befehlen(P, 'ops', 'ops.ziel', 'menu', { ziel: 'objekt:' + A }); P.run(1);
  ok(P.hat('ziel_angewaehlt:a') && P.hat('ziel_angewaehlt:a:menu') && !P.hat('ziel_angewaehlt:b'), 'objekt:<Id A>: nur Ziel A (a, a:menu), B nicht');
  ok(g.ship.target === A, 'Cassius hat A aufgeschaltet');
  P.cmd({ c: 'captain.anzeigeziel', id: B }); Sim.befehlen(P, 'ops', 'ops.ziel', 'taste', { ziel: 'markiert' }); P.run(1);
  ok(P.hat('ziel_angewaehlt:b:taste') && g.ship.target === B, 'markiert (Anzeigeziel B): Ziel B (b:taste), Ops-Ziel B');
  const Q = bereit(3); bis(Q, 'ziele');
  Sim.befehlen(Q, 'ops', 'ops.ziel', 'text', { ziel: 'naechstes' }); Q.run(1);
  const k = ['a', 'b'].filter((x) => Q.hat('ziel_angewaehlt:' + x));
  ok(k.length === 1, 'naechstes: genau ein Ziel (das nächste: ' + k.join() + ')');
  const R = bereit(3); bis(R, 'kurs');   // vor dem Schritt ziele gibt es keine Übungsziele: nichts anvisierbar
  ok(R.g.arena.training.uebung == null && R.g.space.enemies.length === 0, 'vor dem Schritt ziele: keine Übungsziele, keine Gegner');
});

section('Neustart räumt die Übungsziele, die Bots bleiben', () => {
  const P = bereit(3); const g = P.g; bis(P, 'kampf');
  const botIds = g.players.filter((p) => p.bot).map((p) => p.id + p.botId).join();
  ok(g.space.enemies.some((e) => e.tag === 'training'), 'Übungsziele stehen');
  g.mission.completeMission('verloren');
  P.run(8, () => g.arena.training.versuch === 2); P.run(1);
  ok(g.arena.training.versuch === 2 && g.mission.step.id === 'stand', 'Neustart: Versuch 2, Schritt stand');
  ok(!g.space.enemies.some((e) => e.tag === 'training') && g.arena.training.uebung == null, 'nichts übrig: keine Übungsziele, keine Gegner');
  ok(g.players.filter((p) => p.bot).map((p) => p.id + p.botId).join() === botIds && P.agent('ops').absicht.feuer === 'halt', 'dieselben drei Bots, Cassius wieder auf Feuer halt');
  ok(P.h.console === 'captain' && g.ship.docked === true && g.explore.hexErkundet('0306'), 'Mensch wieder an der Captain-Konsole, angedockt, Vorerkundung bleibt');
  ok(P.agent('navigation').absicht.befehl == null, 'Befehle der Bots verworfen');
  P.run(10);
  ok(g.errors === 0, 'g.errors 0 (' + g.errors + ')');
});

// ---------- Reparatur ----------
section('Reparatur: Befehlswirkung und Erkennung', () => {
  const zeit = (befohlen, seed) => {
    const P = bereit(seed || 3); const g = P.g; bis(P, 'reparatur');
    const t0 = g.time; P.run(0.5);
    const schaden = Object.keys(g.ship.systems).filter((s) => g.ship.systems[s] !== 'ok').sort();
    if (befohlen) Sim.befehlen(P, 'technik', 'tech.reparieren', 'menu', { system: 'transfer' });
    P.run(120, () => g.ship.systems.transfer === 'ok'); P.run(1);
    return { t: g.time - t0, schaden, P };
  };
  const a = zeit(true), b = zeit(false);
  ok(a.schaden.join() === [...Captain.SCHAEDEN].sort().join(), 'vier Systeme gleichzeitig beschädigt: ' + a.schaden.join(','));
  ok(a.t + 10 < b.t, 'tech.reparieren transfer heilt früher als ohne Befehl (' + a.t.toFixed(1) + ' s gegen ' + b.t.toFixed(1) + ' s)');
  ok(a.P.hat('repariert') && a.P.hat('repariert:menu') && a.P.g.mission.step.id === 'sprung', 'mit Befehl: repariert, repariert:menu, Ziel erledigt (Schritt sprung folgt)');
  ok(!b.P.hat('repariert') && b.P.objektiv('reparieren') === false, 'ohne Befehl (Eigenreparatur von Titus): kein "repariert", Ziel offen');
  ok(a.P.g.errors === 0 && b.P.g.errors === 0, 'g.errors 0');
  // ein schon heiles System befohlen zählt nicht
  const P = bereit(3); bis(P, 'reparatur'); P.run(0.5);
  P.g.ship.systems.shields = 'ok'; Sim.befehlen(P, 'technik', 'tech.reparieren', 'menu', { system: 'shields' }); P.run(2);
  ok(!P.hat('repariert'), 'tech.reparieren auf ein heiles System: kein "repariert"');
});

// ---------- Sprünge ----------
section('Sprünge: normal, Schnellsprung, vorerkunden, keine Zufallsbegegnung', () => {
  const P = bereit(3); const g = P.g; bis(P, 'sprung');
  P.cmd({ c: 'captain.selectDest', dest: 'b7' }); P.run(1);
  ok(!!g.reisePlan && g.reisePlan.hops.length === 2 && g.reisePlan.hops[1] === '0406', 'Route hafen -> b7 über splitter (Reiseplan mit ' + (g.reisePlan ? g.reisePlan.hops.join('>') : '-') + ')');
  // der Schnellsprung hält keine Zufallsbegegnung: jeder Wurf mit Wahrscheinlichkeit > 0 träfe
  g.rng.chance = (p) => p > 0;
  Sim.befehlen(P, 'navigation', 'nav.sprung', 'menu', { ziel: 'marke' });
  Sim.warten(P, 'Schnellsprung', 150, () => g.ship.scene === 'b7' && !g.reise);
  ok(P.hat('schnellsprung') && !P.hat('sprung') && g.ship.scene === 'b7' && g.space.enemies.length === 0, 'Schnellsprung: Ziel schnellsprung, kein "sprung", angekommen in b7, keine Jäger (Wurf wäre überall ein Treffer)');
  P.run(2); P.cmd({ c: 'captain.selectDest', dest: 'splitter' }); P.run(1);
  ok(g.reisePlan == null, 'Nachbarsektor: keine Route, ein normaler Sprung');
  Sim.befehlen(P, 'navigation', 'nav.sprung', 'taste', { ziel: 'marke' });
  Sim.warten(P, 'normaler Sprung', 150, () => g.ship.scene === 'splitter');
  ok(P.hat('sprung') && P.hat('bot_befehl:nav.sprung:taste') && P.hat('schnellsprung'), 'normaler Sprung: Ziel sprung, nav.sprung über taste');
  P.run(8);
  ok(g.errors === 0, 'g.errors 0');
  // ohne Vorerkundung gibt es keine Route (nur Zeile in der Tabelle, die die Probe entfernt)
  const Q = bereit(3); const ex = Q.g.explore;
  ex.erkundet.clear();
  Q.cmd({ c: 'captain.selectDest', dest: 'b7' }); Q.run(1);
  ok(Q.g.reisePlan == null, 'Gegenprobe: ohne erkundete Hexe keine Route (also kein Schnellsprung)');
  // Tabellenfeld wirkt bei Neustart erneut
  Q.g.mission.completeMission('verloren'); Q.run(8, () => Q.g.arena.training.versuch === 2);
  ok(Q.g.explore.hexErkundet('0306') && Q.g.explore.hexErkundet('0406'), 'vorerkunden wird beim Neustart erneut angewendet');
});

section('Schnellsprung-Erkennung: Hops, Abbruch', () => {
  const P = bereit(3); const g = P.g; bis(P, 'sprung');
  const poll = (reise, scene) => { g.reise = reise; if (scene) g.ship.scene = scene; Erk.update(g); };
  const zu = g.ship.scene;
  poll({ hops: ['0306'], i: 0, t: 0, ziel: 'x', abbruch: false }); poll(null, 'splitter');
  ok(!P.hat('schnellsprung'), 'Reise über einen einzelnen Hop: kein Schnellsprung');
  g.ship.scene = zu; Erk.update(g);
  poll({ hops: ['0306', '0406'], i: 0, t: 0, ziel: 'x', abbruch: true }); poll(null, 'b7');
  ok(!P.hat('schnellsprung'), 'abgebrochene Reise: kein Schnellsprung');
  g.ship.scene = zu; Erk.update(g);
  poll({ hops: ['0306', '0406'], i: 0, t: 0, ziel: 'x', abbruch: false }); poll(null, 'splitter');
  ok(!P.hat('schnellsprung'), 'Reise endet nicht am letzten Hop (abgefangen): kein Schnellsprung');
  g.ship.scene = zu; Erk.update(g);
  poll({ hops: ['0306', '0406'], i: 0, t: 0, ziel: 'x', abbruch: false }); poll(null, 'b7');
  ok(P.hat('schnellsprung'), 'Reise mit zwei Hops endet in b7: schnellsprung');
});

// ---------- Tab ----------
section('Tab im Stand und Sicherheitsstopp', () => {
  const P = bereit(3); const g = P.g;
  P.cmd({ c: 'station.tab', dir: 1 }); P.run(1); P.cmd({ c: 'station.tab', dir: 1 }); P.run(1);
  ok(Station.stationOf(P.h) === 'helm' && P.hat('tab:helm') && !P.hat('tab:captain'), 'zwei Tabs: Steuer (tab:helm), noch nicht zurück');
  P.cmd({ c: 'station.tab', dir: 1 }); P.run(1); P.cmd({ c: 'station.tab', dir: 1 }); P.run(1);
  ok(Station.stationOf(P.h) === 'captain' && P.hat('tab:captain'), 'zurück am Captain: tab:captain');
  ok(P.g.errors === 0, 'g.errors 0');
  // Tab-Falle: Livia fliegt mit Kurs, der Mensch übernimmt das Steuer und gibt es zurück, das Schiff läuft mit Schubstufe weiter
  const F = (stop) => {
    const Q = bereit(3); const G = Q.g; const sh = G.ship;
    bis(Q, 'kurs');
    if (!stop) G.arena.training.def = null;
    const HALTER = Captain.HALTER; const orig = HALTER.sicherheitsstopp;
    if (!stop) HALTER.sicherheitsstopp = () => {};
    try {
      Sim.befehlen(Q, 'navigation', 'nav.schub', 'menu', { stufe: 'voll' });
      Q.run(4);
      Q.cmd({ c: 'station.tab', dir: 1 }); Q.run(1); Q.cmd({ c: 'station.tab', dir: 1 }); Q.run(1);   // Steuer: Livia weicht, Kurs weg
      Q.cmd({ c: 'station.tab', dir: 1 }); Q.run(1); Q.cmd({ c: 'station.tab', dir: 1 }); Q.run(1);
      const kurs = Q.agent('navigation').absicht.befehl;
      let minRand = 1e9;
      for (let i = 0; i < 90; i++) { Q.run(1); minRand = Math.min(minRand, sh.x, sh.y, G.space.w - sh.x, G.space.h - sh.y); }
      return { kurs, minRand, speed: sh.speed, autoStop: sh.helm.autoStop, errors: G.errors };
    } finally { HALTER.sicherheitsstopp = orig; }
  };
  const mit = F(true), ohne = F(false);
  ok(mit.kurs == null, 'nach dem Tab ist der Kurs der Bots weg (Tab-Falle ist real)');
  ok(ohne.minRand < 60, 'ohne Sicherheitsstopp läuft das Schiff bis an den Rand (Randabstand ' + Math.round(ohne.minRand) + ' px)');
  ok(mit.minRand > 100 && mit.speed < 5 && mit.errors === 0, 'mit Sicherheitsstopp hält es vor dem Rand (Randabstand ' + Math.round(mit.minRand) + ' px, Tempo ' + Math.round(mit.speed) + ')');
  // Gegenproben: Mensch am Steuer, Kurs der Bots, angedockt -> kein Eingriff
  const S = bereit(3); const sh = S.g.ship; bis(S, 'kurs');
  S.g.ship.docked = false; sh.x = 80; sh.y = 700; sh.speed = 100; sh.helm.stage = 5; sh.helm.autoStop = false;
  const am = (k) => { for (let i = 0; i < 4; i++) { if (Station.stationOf(S.h) === k) break; S.cmd({ c: 'station.tab', dir: 1 }); S.run(0.4); } };
  am('helm'); sh.speed = 100; sh.helm.autoStop = false; Captain.sicherheitsstoppPruefen(S.g);
  ok(sh.helm.autoStop === false, 'Mensch am Steuer: kein Sicherheitsstopp');
  am('captain'); Sim.befehlen(S, 'navigation', 'nav.schub', 'menu', { stufe: 'voll' }); sh.speed = 100; sh.x = 80; sh.helm.autoStop = false; Captain.sicherheitsstoppPruefen(S.g);
  ok(sh.helm.autoStop === false, 'Kurs/Schubbefehl der Bots läuft: kein Sicherheitsstopp');
  const D = bereit(3); D.g.ship.x = 80; D.g.ship.speed = 100; Captain.sicherheitsstoppPruefen(D.g);
  ok(D.g.ship.helm.autoStop !== true, 'angedockt: kein Sicherheitsstopp');
});

// ---------- Erkennung, Zwei Seiten, Gespräch ----------
section('Zwei Seiten: Quellen der Variante, Namensadresse, Gespräch', () => {
  const Tafel = bereit(3, false); const Spr = bereit(3, true);
  ok(Tafel.g.mission.activeId === 'tra_captain' && Spr.g.mission.activeId === 'tra_captain_sprache' && Spr.g.arena.training.sprache === true, 'Variante wählt das Buch (buch / buchSprache)');
  for (const P of [Tafel, Spr]) { P.cmd({ c: 'captain.selectDest', dest: 'splitter' }); P.run(0.5); P.cmd({ c: 'captain.marker', x: 1100, y: 450 }); P.run(0.5); for (let i = 0; i < 4; i++) { P.cmd({ c: 'station.tab', dir: 1 }); P.run(1); } P.run(2); }
  ok(Tafel.g.mission.step.id === 'kurs' && Spr.g.mission.step.id === 'kurs', 'beide im Schritt kurs');
  // falsche Quelle: Tafel-Buch mit text, Sprach-Buch mit menu/taste
  Sim.befehlen(Tafel, 'navigation', 'nav.kurs', 'text', { ziel: 'marke' }); Tafel.run(1);
  ok(Tafel.hat('bot_befehl:nav.kurs:text') && Tafel.objektiv('kurs') === false, 'Tafel-Variante: nav.kurs über text zählt nicht');
  Sim.befehlen(Spr, 'navigation', 'nav.kurs', 'menu', { ziel: 'marke' }); Spr.run(1);
  ok(Spr.hat('bot_befehl:nav.kurs:menu') && Spr.objektiv('kurs') === false, 'Sprach-Variante: nav.kurs über menu zählt nicht');
  Sim.befehlen(Spr, 'navigation', 'nav.kurs', 'taste', { ziel: 'marke' }); Spr.run(1);
  ok(Spr.objektiv('kurs') === false, 'Sprach-Variante: auch taste zählt nicht');
  Sim.befehlen(Spr, 'navigation', 'nav.kurs', 'text', { ziel: 'marke' }); Spr.run(1);
  ok(Spr.objektiv('kurs') === true && Spr.objektiv('name') === false, 'Sprach-Variante: text zählt (Rolle navigation); "mit Namen ansprechen" noch nicht');
  Sim.befehlen(Spr, 'b0', 'nav.kurs', 'text', { ziel: 'marke' }); Spr.run(1);
  ok(Spr.hat('bot_name:text') && Spr.objektiv('name') === true, 'Namensadresse (an = botId b0, "Livia, …") per Text: Ziel "Bot mit Namen ansprechen"');
  Sim.befehlen(Tafel, 'navigation', 'nav.kurs', 'taste', { ziel: 'marke' }); Tafel.run(1);
  ok(Tafel.objektiv('kurs') === true && Tafel.hat('bot_quelle:taste') && !Tafel.hat('bot_name'), 'Tafel-Variante: taste zählt, keine Namensadresse');
  // nav.sprung: nur menu/taste (Annahme lehnt text/sprache ab)
  const ant = Tafel.befehl('navigation', 'nav.sprung', 'text', { ziel: 'marke' });
  ok(ant.join() === 'abgelehnt' && !Tafel.hat('bot_befehl:nav.sprung'), 'nav.sprung über text: abgelehnt und nicht gezählt (nicht sprechbar)');
  const ant2 = Spr.befehl('navigation', 'nav.sprung', 'sprache', { ziel: 'marke' });
  ok(ant2.join() === 'abgelehnt' && !Spr.hat('bot_befehl:nav.sprung'), 'nav.sprung über sprache: abgelehnt und nicht gezählt');
  // Gespräch: Versuch zählt als freiwilliges Ziel, auch ohne Dienst
  Spr.g.handleMessage(Spr.c, { t: 'bot.gespraech', an: 'b0', text: 'Hallo Livia', quelle: 'text' }); Spr.run(0.5);
  ok(Spr.hat('bot_gespraech'), 'Gespräch (bot.gespraech) wird erkannt, auch wenn der Dienst nicht erreichbar ist');
  ok(Tafel.g.errors === 0 && Spr.g.errors === 0, 'g.errors 0');
});

section('Checkliste im HUD', () => {
  const P = bereit(3); const g = P.g;
  const ziele = () => g.mission.state.objectives.map((o) => o.id + (o.optional ? '?' : '') + (o.done ? '+' : '-')).join(' ');
  ok(ziele() === 'sprungziel- marker- tab-', 'stand: ' + ziele());
  bis(P, 'ziele'); ok(ziele() === 'ziel1- ziel2-', 'ziele: ' + ziele());
  bis(P, 'reparatur');
  ok(ziele().startsWith('reparieren- status?- automatik?- gespraech?-'), 'reparatur: Pflichtziel und drei freiwillige Ziele (optional): ' + ziele());
  const S = bereit(3, true);
  for (let i = 0; i < 1; i++) { S.cmd({ c: 'captain.selectDest', dest: 'splitter' }); S.run(0.5); S.cmd({ c: 'captain.marker', x: 1100, y: 450 }); S.run(0.5); for (let k = 0; k < 4; k++) { S.cmd({ c: 'station.tab', dir: 1 }); S.run(1); } S.run(2); }
  ok(S.g.mission.state.objectives.map((o) => o.id).join() === 'kurs,name,anflug,stopp', 'Sprachvariante, Schritt kurs: ' + S.g.mission.state.objectives.map((o) => o.id).join());
});

// ---------- Hinweise ----------
section('Hinweise: nur bei Hängern, keine Doppelansage', () => {
  const P = bereit(3); const g = P.g;
  const odas = P.odas;   // seit dem Start mitgeschrieben (Sim.partie)
  P.run(Math.max(0, 30 - g.time));
  const buch = lesen('tra_captain').texte;
  const hinweise = (l) => l.filter((t) => Object.entries(buch).some(([k, v]) => /^h\./.test(k) && v === t));
  ok(odas.length === 2 && odas[0] === buch['stand.start'] && odas[1] === buch['stand.start2'], 'die ersten 30 s: nur die zwei Einführungszeilen (' + odas.length + ' Zeilen, keine CONSOLE_HELP-Doppelung)');
  ok(hinweise(odas).length === 0, 'solange kein Hänger: kein Hinweis');
  P.run(Math.max(0, 43 - g.time));
  ok(hinweise(odas).join() === buch['h.sprungziel'], 'nach 40 s Stillstand genau ein Hinweis (Sprungziel)');
  P.run(40);
  ok(hinweise(odas).filter((t) => t === buch['h.sprungziel']).length === 1 && hinweise(odas).includes(buch['h.marker']), 'jeder Hinweis nur einmal; der nächste Hänger (Marker) bekommt seinen');
  // ein gelaufener Lauf ohne Hänger: kein Hinweis
  const r = Sim.lauf({ seed: 7, variante: 'tafel' });
  ok(r.ok && r.hinweise === 0, 'ein Lauf ohne Hänger (Seed 7): Abzeichen, kein einziger Hinweis (' + r.hinweise + ')');
});

// ---------- Läufe: Abzeichen je Variante ----------
section('Abzeichen: scripted Lauf, beide Varianten', () => {
  for (const variante of ['tafel', 'sprache']) {
    for (const seed of [1, 2]) {
      const r = Sim.lauf({ seed, variante });
      ok(r.ok && r.errors === 0, variante + ' seed ' + seed + ': Abzeichen Captain mit Variante ' + (variante === 'sprache' ? 'sprache' : 'tafel') + ' nach ' + r.t + ' s' + (r.grund ? ' (' + r.grund + ')' : ''));
    }
  }
  // nach dem Abzeichen: Neustart nach NEUSTART_NACH_ERFOLG, Bots bleiben
  const P = Sim.partie(4, true); const g = P.g;
  const r = Sim.lauf({ seed: 4, variante: 'sprache' });
  ok(r.ok, 'Lauf Sprache seed 4');
  const O = bereit(5, false); bis(O, 'sprung'); O.g.mission.flags.trainingFertig = true; O.run(1);
  ok(O.abzeichenEreignisse().length === 1 && O.abzeichenEreignisse()[0].variante === 'tafel', 'trainingFertig: ein Abzeichen, variante tafel');
  O.run(Training.NEUSTART_NACH_ERFOLG + 2);
  ok(O.g.arena.training.versuch === 2 && O.g.players.filter((p) => p.bot).length === 3 && O.g.mission.step.id === 'stand', 'Neustart nach dem Abzeichen: Versuch 2, drei Bots, Schritt stand');
});

console.log('\ntest-training-captain: ' + (fails ? fails + ' FEHLER von ' + n : n + '/' + n + ' ok'));
process.exit(fails ? 1 : 0);
