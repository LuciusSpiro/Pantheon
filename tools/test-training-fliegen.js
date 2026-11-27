'use strict';
// TRA-01 D: Test des Abzeichens Fliegen (Regiebuch tra_fliegen, Tabellenfelder vorerkunden/reise, Aktion training_sprungziel).
//   node tools/test-training-fliegen.js
//   Katalog    Checker nimmt das Buch an (intern, keine Fehler); Zielliste und Reihenfolge der Schritte; jedes Ziel hat Text und Ziel-Id/Bedingung;
//              jeder Schritt mit Pflichtziel trägt einen Hinweis-Timer (garantie hinweis, nicht unter 30 s)
//   Setup      Tabelle: vorerkunden (Hexe/Kanten), reise (kein Abfangen); Start erkundet die Route hafen -> b7; Neustart wendet es wieder an
//   Durchlauf  scripted Mensch-Ersatz (tools/sim-training.js) über mehrere Seeds bis "Abzeichen erreicht": Reihenfolge der Schritte, genau ein Abzeichen,
//              Neustart nach 8 s, Buch von vorn, kein Gegner im Raum, g.errors 0, kein Hinweis solange der Spieler vorankommt
//   Hinweis    hängt der Spieler in einem Schritt, feuert genau der Hinweis dieses Schritts, nicht vor seiner Zeit
//   Sprungziel das Ziel setzt der Modus (kein sprungziel_gewaehlt), Route hafen -> b7 über splitter steht als Schnellsprung-Plan
//   Reise      Abfangen im Schnellsprung ist im Training abgeschaltet und danach (Lobby) wieder da
const fs = require('fs');
const path = require('path');
const Checker = require('../server/mission/checker.js');
const Training = require('../server/sim/training.js');
const Erk = require('../server/sim/training-erkennung.js');
const Reise = require('../server/sim/reise.js');
const Sim = require('./sim-training.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const BUCH = path.join(__dirname, '..', 'content', 'regiebuecher', 'tra_fliegen.regiebuch.json');
const doc = () => JSON.parse(fs.readFileSync(BUCH, 'utf8'));
const ZIELTEXTE = { hoch: 'Ablegen, Schub hoch (W)', runter: 'Temporegler runter (S)', ruder: 'Ruder legen (A / D)', stopp: 'Allstopp (X)', rolle: 'Ausweichrolle (Shift+A / D)',
  station: 'Hafenstation anfliegen', sprungpunkt: 'Sprungpunkt anfliegen', falt: 'Faltsprung (F) in den Gürtel', schnell: 'Schnellsprung (G) zu B-7', dock: 'Im Hafen andocken', ablegen: 'Wieder ablegen (W)' };
// Abfolge der Schritte des normalen Durchlaufs (ohne Abbruch-Zweige)
const ABFOLGE = ['a_hoch', 'a_runter', 'a_ruder', 'a_stopp', 'a_rolle', 'a_station', 'b_sprungpunkt', 'b_falt', 'b_zurueck', 'b_schnell', 'b_rueckflug', 'b_andocken', 'b_ablegen', 'b_fertig'];
// Ziel-Id der Erkennung je Schritt (null: Bedingung im Buch)
const SCHRITT_ZIEL = { a_hoch: 'tempo_hoch', a_runter: 'tempo_runter', a_ruder: 'ruder', a_stopp: 'allstopp', a_rolle: 'ausweichen', b_sprungpunkt: 'sprungpunkt' };

section('Katalog: Buch und Checker', () => {
  const d = doc();
  const r = Checker.check(JSON.parse(JSON.stringify(d)));
  ok(r.ok && r.errors.length === 0, 'Checker: keine Fehler (' + r.errors.length + ' Fehler, ' + r.warnings.length + ' Warnungen)');
  ok(d.id === 'tra_fliegen' && d.kopf.art === 'intern', 'Id tra_fliegen, kopf.art intern');
  ok(d.erwartet && d.erwartet.trainingFertig === false, 'Flag trainingFertig erwartet (false)');
  const ids = d.steps.map((s) => s.id);
  ok(ABFOLGE.every((s) => ids.includes(s)), 'alle Schritte der Abfolge sind im Buch (' + ABFOLGE.length + ')');
  const ziele = []; for (const s of d.steps) for (const o of s.objectives || []) if (!ziele.includes(o.id)) ziele.push(o.id);
  ok(JSON.stringify(ziele) === JSON.stringify(Object.keys(ZIELTEXTE)), 'Checkliste: ' + ziele.length + ' Ziele in Reihenfolge ' + ziele.join(', '));
  ok(Object.entries(ZIELTEXTE).every(([k, t]) => d.texte['ziel.' + k] === t), 'Zieltexte stehen im Buch (texte) wie geplant');
  const abschnitt = (pre) => d.steps.filter((s) => s.id.startsWith(pre)).map((s) => (s.objectives || []).length);
  ok(Math.max(...abschnitt('a_')) <= 7 && Math.max(...abschnitt('b_')) <= 7, 'höchstens 7 Ziele je Schritt (HUD zeigt 9 Zeilen mit zwei Kopfzeilen)');
  for (const [schritt, zid] of Object.entries(SCHRITT_ZIEL)) {
    const s = d.steps.find((x) => x.id === schritt);
    ok(JSON.stringify(s.next[0].if).includes('"' + zid + '"') || (schritt === 'a_hoch' && JSON.stringify(s.next[0].if).includes('tempo_hoch')), schritt + ': wartet auf Ziel ' + zid);
  }
  const hinweise = [];
  for (const s of d.steps) for (const t of s.timers || []) if (/^@hinweis\./.test(t.oda || '')) hinweise.push({ s: s.id, t });
  const mitPflicht = d.steps.filter((s) => (s.objectives || []).length);
  ok(mitPflicht.every((s) => (s.timers || []).some((t) => t.garantie === 'hinweis' && /^@hinweis\./.test(t.oda || ''))), 'jeder Schritt mit Ziel trägt einen Hinweis-Timer (garantie hinweis)');
  const regulaer = hinweise.filter((h) => h.t.oda !== '@hinweis.wieder_ab');
  ok(regulaer.every((h) => h.t.at >= 30), 'kein Hinweis unter 30 s im Schritt (frühester: ' + Math.min(...regulaer.map((h) => h.t.at)) + ' s)');
  ok(hinweise.filter((h) => h.t.oda === '@hinweis.wieder_ab').every((h) => JSON.stringify(h.t.if) === '{"docked":true}' && h.t.at >= 20), 'Sonderfall wieder angedockt: nur mit docked true, nach 20 s');
  ok(hinweise.every((h) => h.t.if !== undefined), 'jeder Hinweis trägt eine Bedingung (nur wenn das Ziel noch fehlt)');
  ok(hinweise.filter((h) => h.t.at < 120).length === hinweise.length && hinweise.every((h) => d.texte[h.t.oda.slice(1)] && d.texte[h.t.oda.slice(1)].length <= 120), 'Hinweistexte vorhanden und höchstens 120 Zeichen');
  const zeichen = (JSON.stringify(d).match(/training_ziel/g) || []).length;
  ok(zeichen >= 12, 'Erkennung per Prüfung training_ziel (' + zeichen + ' Stellen), nicht per done:{event:trainingZiel}');
  ok(!/"event"\s*:\s*"trainingZiel"/.test(JSON.stringify(d)), 'kein done:{event: trainingZiel} (nicht ziel-spezifisch)');
  const kein = (a) => !/debug_jump|debug_dock|spawn|debug_clear/.test(JSON.stringify(a));
  ok(kein(d.steps), 'keine Teleport-/Spawn-Aktionen im Buch (nur training_sprungziel setzt das Ziel)');
});

section('Setup: Tabelle und Start', () => {
  const T = Training.TRAININGSMODI.training_fliegen;
  ok(T.vorerkunden && T.vorerkunden.hexe.includes('0206') && T.vorerkunden.hexe.includes('0306') && T.vorerkunden.hexe.includes('0406'), 'vorerkunden.hexe: hafen, splitter, b7');
  ok(T.vorerkunden.kanten.includes('0206-0306') && T.vorerkunden.kanten.includes('0306-0406'), 'vorerkunden.kanten: hafen-splitter, splitter-b7');
  ok(!T.vorerkunden.hexe.includes('0205') && !T.vorerkunden.kanten.some((k) => k.includes('0205')), 'kein kesh (0205, gesperrt)');
  ok(T.reise && T.reise.neutralChance === 0 && T.reise.feindChance === 0, 'reise: Abfangen aus');
  ok(Training.TRAININGSMODI.training_captain.vorerkunden === undefined, 'training_captain unberührt (Feld ist optional)');
  const P = Sim.partie('training_fliegen', { seed: 3 }); const g = P.g;
  ok(g.explore.hexErkundet('0406') && g.explore.hexErkundet('0206'), 'Start: b7 und hafen sind erkundet');
  const plan = Reise.planen(g, '0206', '0406');
  ok(plan && plan.join() === '0306,0406', 'Route hafen -> b7 über splitter (' + (plan && plan.join('>')) + ')');
  ok(g.explore.hexErkundet('0306') && !g.explore.hexErkundet('0307'), 'nur die genannten Hexe sind vorerkundet');
  ok(g.reiseWerte && g.reiseWerte.neutralChance === 0, 'game.reiseWerte gesetzt');
  const vorher = g.explore.erkundet.size;
  g.explore.erkundet.delete('0406'); Training.neustart(g);
  ok(g.explore.hexErkundet('0406') && g.explore.erkundet.size >= vorher - 0, 'Neustart wendet vorerkunden wieder an');
});

section('Durchlauf: scripted Mensch-Ersatz bis Abzeichen', () => {
  const seeds = [1, 2, 3];
  for (const s of seeds) {
    const R = Sim.lauf('training_fliegen', s, { maxS: 400 });
    ok(R.ok, 'Seed ' + s + ': Abzeichen erreicht nach ' + R.zeit + ' s' + (R.ok ? '' : ' (' + R.grund + ')'));
    const ids = R.schritte.map((x) => x.id).filter((x) => x && x !== 'b_fertig');   // b_fertig setzt das Flag und schließt im selben Tick ab
    ok(ids.join() === ABFOLGE.slice(0, 13).join(), 'Seed ' + s + ': Schritte in der geplanten Abfolge (' + ids.join('>') + ')');
    ok(R.abzeichen === 1, 'Seed ' + s + ': genau ein Abzeichen (EVT_ABZEICHEN fliegen)');
    ok(R.neustartOk, 'Seed ' + s + ': Neustart nach Erfolg, Buch von vorn, Ziele leer, Flag zurück');
    ok(R.gegner === 0, 'Seed ' + s + ': nie ein Gegner im Raum (Hafen, Gürtel, B-7, Schnellsprung)');
    ok(R.fehler === 0, 'Seed ' + s + ': g.errors 0');
    ok(R.hinweise.length === 0, 'Seed ' + s + ': kein Hinweis, solange der Spieler vorankommt (' + R.hinweise.length + ')');
  }
  const R = Sim.lauf('training_fliegen', 1, { maxS: 400 });
  const zeigt = ['tempo_hoch', 'tempo_runter', 'ruder', 'allstopp', 'ausweichen', 'sprungpunkt', 'andocken'];
  ok(zeigt.every((z) => (R.zieleAmEnde || []).includes(z)), 'Erkennung: alle Ziel-Ids des Abzeichens gesetzt (' + zeigt.join(', ') + ')');
  ok(!(R.zieleAmEnde || []).includes('sprungziel_gewaehlt'), 'sprungziel_gewaehlt nie (das Ziel setzt der Modus, nicht der Mensch)');
});

section('Hinweis: feuert, wenn der Spieler hängt', () => {
  const d = doc();
  const proben = [['a_hoch', 'hinweis.hoch'], ['a_ruder', 'hinweis.ruder'], ['b_falt', 'hinweis.falt'], ['b_andocken', 'hinweis.andocken']];
  for (const [schritt, schluessel] of proben) {
    const at = d.steps.find((s) => s.id === schritt).timers.find((t) => t.oda === '@' + schluessel).at;
    const text = d.texte[schluessel];
    const P = Sim.partie('training_fliegen', { seed: 7 }); const g = P.g;
    const K = Sim.SKRIPTE.training_fliegen; const S = { rng: require('../server/util.js').makeRng(9), reaktion: 0.5, schrittAb: 0 };
    let t0 = null; let guard = 0;
    while (g.time < 600 && guard++ < 600 * 30) {
      const stufe = P.schritt();
      if (stufe === schritt) { if (t0 == null) t0 = g.time; } else K.schritt(P, S);
      g.step();
      if (t0 != null && g.time - t0 > at + 6) break;
    }
    const treffer = P.odas.filter((o) => o.text === text);
    const alle = Sim.hilfen.hinweisTexteDes(g);
    const fremd = P.odas.filter((o) => alle.has(o.text) && o.text !== text);
    ok(t0 != null, schritt + ': der Lauf erreicht den Schritt');
    ok(treffer.length === 1, schritt + ': Hinweis feuert genau einmal (' + treffer.length + ')');
    ok(treffer.length && treffer[0].t - t0 >= at - 0.1 && treffer[0].t - t0 <= at + 2, schritt + ': nicht vor Ablauf (' + (treffer.length ? (treffer[0].t - t0).toFixed(1) : '-') + ' s nach Schrittstart, Soll ' + at + ' s)');
    ok(fremd.length === 0, schritt + ': kein anderer Hinweis des Buchs davor');
  }
});

section('Hinweis: wieder angedockt', () => {
  const d = doc(); const text = d.texte['hinweis.wieder_ab'];
  const P = Sim.partie('training_fliegen', { seed: 8 }); const g = P.g;
  const K = Sim.SKRIPTE.training_fliegen; const S = { rng: require('../server/util.js').makeRng(3), reaktion: 0.5, schrittAb: 0 };
  let guard = 0; while (P.schritt() !== 'a_runter' && guard++ < 3000) { K.schritt(P, S); g.step(); }
  const dock = require('../shared/locations.js').get('hafen').scene.dock;
  g.ship.docked = true; g.ship.dockedAt = 'hafen'; g.ship.x = dock.x; g.ship.y = dock.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.helm.stage = 1;
  const t0 = g.time; for (let i = 0; i < 25 * 30; i++) g.step();
  const t = P.odas.filter((o) => o.text === text);
  ok(P.schritt() === 'a_runter' && t.length === 1 && t[0].t - t0 >= 19 && t[0].t - t0 <= 22, 'zurück am Liegeplatz in a_runter: Hinweis zum Ablegen nach 20 s (' + (t.length ? (t[0].t - t0).toFixed(1) : '-') + ' s)');
});

section('Sprungziel: setzt der Modus', () => {
  const P = Sim.partie('training_fliegen', { seed: 4 }); const g = P.g;
  const K = Sim.SKRIPTE.training_fliegen; const S = { rng: require('../server/util.js').makeRng(2), reaktion: 0.5, schrittAb: 0 };
  const sah = {};
  let guard = 0;
  while (guard++ < 400 * 30 && !(g.arena.training.versuch > 1)) {
    K.schritt(P, S); g.step();
    const id = P.schritt();
    if (id && !sah[id]) sah[id] = { dest: g.ship.jump.dest, plan: g.reisePlan ? g.reisePlan.hops.slice() : null, kapitaen: Erk.erreicht(g, 'sprungziel_gewaehlt'), t: g.time };
  }
  ok(sah.a_hoch && sah.a_hoch.dest === null, 'vor der Sprungübung ist kein Ziel gesetzt');
  ok(sah.b_sprungpunkt && sah.b_sprungpunkt.dest === 'splitter', 'b_sprungpunkt: Ziel splitter (vom Modus)');
  ok(sah.b_zurueck && sah.b_zurueck.dest === 'hafen', 'b_zurueck: Ziel hafen (vom Modus, F springt zurück)');
  ok(sah.b_schnell && sah.b_schnell.dest === 'splitter' && sah.b_schnell.plan && sah.b_schnell.plan.join() === '0306,0406', 'b_schnell: Ziel b7 als Schnellsprung-Plan über splitter (dest splitter, hops 0306,0406)');
  ok(sah.b_rueckflug && sah.b_rueckflug.plan && sah.b_rueckflug.plan.join() === '0306,0206', 'b_rueckflug: Rückweg b7 -> splitter -> hafen als Plan');
  ok(Object.values(sah).every((x) => !x.kapitaen), 'sprungziel_gewaehlt zählt in keinem Schritt (Mensch ist nie Captain)');
  ok(g.errors === 0, 'g.errors 0 (selectDest ohne Fehler)');
  // Fehler der Aktion melden sich (countError), brechen nichts
  const Q = Sim.partie('training_fliegen', { seed: 4 });
  const e = Training.sprungzielSetzen(Q.g, 'hafen');
  ok(typeof e === 'string' && Q.g.errors === 1, 'Ziel = aktueller Ort: Fehlertext "' + e + '" und countError, kein Wurf');
});

section('Reise: Abfangen im Training aus', () => {
  const abfaenge = (g, runden) => { let k = 0; for (let i = 0; i < runden; i++) { g.space.enemies = []; if (Reise.abfangen(g, '0306')) k++; } return k; };
  const P = Sim.partie('training_fliegen', { seed: 5 });
  ok(abfaenge(P.g, 400) === 0, 'im Training: 400 Würfe, nie abgefangen');
  const Q = Sim.partie('training_fliegen', { seed: 5 });
  Q.g.reiseWerte = null;   // Gegenprobe: ohne die Tabellenüberlagerung fängt die Region ab (neutral 8 % + 8 % je Hop)
  ok(abfaenge(Q.g, 400) > 5, 'Gegenprobe ohne Überlagerung: Abfangen kommt vor');
  const L = Sim.partie('training_fliegen', { seed: 5 });
  L.g.zurLobby();
  ok(L.g.reiseWerte === null || L.g.reiseWerte === undefined, 'nach dem Verlassen (zurLobby/reset): Überlagerung weg, normale Partien unverändert');
});

console.log(`\n${n - fails}/${n} Prüfungen grün`);
process.exit(fails ? 1 : 0);
