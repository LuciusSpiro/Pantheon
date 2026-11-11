'use strict';
// MON-03 A: Schwarm mit Königin im Kreaturen-Rahmen (Typen `schwarmling`, `koenigin` in content/kampf/kreaturen.json, Baustein `brut`, Funktion Kreatur.nestSetzen). Echtes Spiel (Game), Wildnis-Karte.
// Geprüft: Daten und Validator (Reihenfolge am Ende, Größe, Bindung, brut-Parameter und seine Fehlerfälle); Startbesatz; Takt aus den Daten (zwei Takte); Obergrenze `max` nie überschritten (auch unter Dauerverlusten,
//   tote Nachkommen werden still entfernt, die Liste wächst nicht); Zerfall ohne Königin (alle lösen sich auf, keine Wiederkehr, auch nach langer Zeit); Wiederkehr mit lebender und mit bewusstloser Königin;
//   `kreaturen_erledigt { typ: Königin }` erst mit endgültig erledigter Königin (nicht, solange nur Schwarmlinge fehlen); nestSetzen (Buchführung, Fehlerfälle ohne Nebenwirkung);
//   keine neuen Instanzfelder an Schwarmlingen, K.brut nur lazy an der Königin; kein Typname im Servercode (die Wirkung kommt aus den Daten: ein Fremdtyp-Paar mit anderen Namen verhält sich gleich).
//   node tools/test-schwarm.js   (npm run test:schwarm)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const combat = require('../server/sim/combat.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');
const Registry = require('../server/mission/registry.js');
const H = require('./gel02-hilfen.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const kopie = (o) => JSON.parse(JSON.stringify(o));
const BRUT = KREATUREN.typen.koenigin.bausteine.brut;
const BRUT0 = kopie(BRUT);
const mitBrut = (aend, fn) => { Object.assign(BRUT, aend); try { return fn(); } finally { for (const k of Object.keys(BRUT)) delete BRUT[k]; Object.assign(BRUT, kopie(BRUT0)); } };

// ---------- Messhilfen ----------
// Wildnis-Szene im echten Spiel: Spieler unverwundbar (god) und weit von der Königin (Sicht 6 bis 7 Kacheln), keine Banditen; nicht downed (sonst endet das Gelände nach 5 s und die Crew geht aufs Schiff: dann steht die Karte still). Beobachter für Spiel- und Missionsereignisse.
function szene(seed) {
  const s = H.neuesSpiel(1, { art: 'wildnis', seed: seed || 101, groesse: 'mittel', biom: 'wueste' });
  const g = s.g, p = g.players[0];
  g.away.drones = []; combat.ensureV2(g, g.away, s.map); g.away.kreaturen = [];
  g.god = true;
  const S = { g, k: s.k, map: s.map, p, aw: g.away, fehler: [], me: [], ev: [] };
  g.countError = (w, e) => { S.fehler.push(w + ': ' + (e && e.message)); };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { S.me.push({ nm, d }); return m0(nm, d); };
  const e0 = g.emit.bind(g); g.emit = (nm, d) => { S.ev.push({ nm, d }); return e0(nm, d); };
  S.me_ = (nm) => S.me.filter((x) => x.nm === nm);
  return S;
}
// Königin über nestSetzen an die erste Stelle um den Spieler legen, an der sie Platz hat
function nest(S, gruppe, typ) {
  const tx = Math.floor(S.p.x / 32), ty = Math.floor(S.p.y / 32);
  let r = null;
  for (const [dx, dy] of [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, 10], [10, -10], [-10, -10], [18, 0], [-18, 0], [0, 18], [0, -18]]) {
    r = Kreatur.nestSetzen(S.g, { map: S.map, typ: typ || 'koenigin', gruppe, x: tx + dx, y: ty + dy });
    if (!r.fehler) break;
  }
  if (r.fehler) throw new Error('kein Platz für die Königin: ' + r.fehler);
  return S.aw.kreaturen.find((K) => K.id === r.ids[0]);
}
const lebende = (S, typ) => S.aw.kreaturen.filter((K) => K.typ === typ && Kreatur.nichtEndgueltigErledigt(K));
const schwarm = (S) => lebende(S, 'schwarmling');
const step = (S) => { S.g.step(); };
const schritte = (S, sek, pro) => { for (let i = 0, N = Math.round(sek / DT); i < N; i++) { step(S); if (pro) pro(i); } };
function hinten(S, K, art) {
  K.facing = 0;
  const x = K.x - 100, y = K.y;
  const w = art === 'betaeuber' ? { waffe: 'betaeuber', schaden: 1, art: 'direkt', nichttoedlich: true } : { waffe: 'blaster', schaden: 1, art: 'direkt' };
  const wirk = Object.assign({}, w, { x, y, quelle: { id: S.p.id, pid: S.p.id, team: 'crew', x, y } });
  for (let i = 0; i < 60 && K.alive; i++) combat.hitEnemy(S.g, K, 1, { x, y, pid: S.p.id, wirkung: wirk });
}
const toeten = (S, K) => hinten(S, K, 'blaster');
const erledigt = (S, o) => !!Registry.get('kreaturen_erledigt').test(S.g.mission, Object.assign({ map: S.map }, o));
// Bewusstlose Kreatur wartet, bis sie wieder steht (Betäuber trifft nur Lebende; Töten geht erst dann)
const aufwachen = (S, K) => { for (let i = 0, N = Math.round(90 / DT); i < N && !K.alive; i++) step(S); };
const wirft = (fn) => { try { fn(); return null; } catch (e) { return String(e.message); } };

// ---------- Daten ----------
section('Daten: Typen am Ende, Größe, Bindung, brut-Parameter, Validator', () => {
  const ids = Object.keys(KREATUREN.typen);
  ok(ids.slice(0, 2).join() === 'probe,rudeltier' && ids[2] === 'schwarmling' && ids[3] === 'koenigin', 'Reihenfolge: probe, rudeltier, dann schwarmling, koenigin am Ende (' + ids.join(',') + ')');
  ok(Kreatur.pruefen(KREATUREN).length === 0, 'Validator: alle Typen gültig ' + Kreatur.pruefen(KREATUREN).join(' | '));
  const Q = KREATUREN.typen.koenigin, W = KREATUREN.typen.schwarmling;
  ok(Q.groesse === 2 && Q.start === 'wurzel' && Object.keys(Q.zustaende).length === 1 && Q.zustaende.wurzel.tempo === 0 && Q.zustaende.wurzel.uebergang.length === 0, 'Königin: Größe 2, fest verwurzelt (ein Zustand, Tempo 0, keine Übergänge)');
  ok(W.groesse === 1 && W.bausteine.bindung && W.bausteine.bindung.quelle.art === 'kreatur' && W.bausteine.bindung.quelle.typ === 'koenigin' && W.bausteine.bindung.folge.art === 'aufloesen', 'Schwarmling: Größe 1, bindung an die Königin (art kreatur), Folge aufloesen');
  ok(BRUT.typ === 'schwarmling' && BRUT.anfang === 12 && BRUT.max === 20 && BRUT.takt > 0 && BRUT.radius >= 1, 'brut der Königin: Nachwuchs schwarmling, Startbesatz 12, max 20 (Takt ' + BRUT.takt + ' s, Radius ' + BRUT.radius + ')');
  const F = (aend, ohne) => { const d = kopie(KREATUREN); const b = d.typen.koenigin.bausteine.brut; Object.assign(b, aend); for (const k of ohne || []) delete b[k]; return Kreatur.pruefen(d); };
  ok(F({ max: 31 }).length === 1 && F({ max: 30, anfang: 12 }).length === 0, 'Validator: max 31 abgelehnt (Deckel 30), 30 gültig');
  ok(F({ anfang: 21 }).length === 1 && F({ anfang: -1 }).length === 1 && F({ anfang: 1.5 }).length === 1, 'Validator: anfang über max, negativ oder nicht ganzzahlig abgelehnt');
  ok(F({ max: 0 }).length >= 1 && F({ max: 2.5 }).length >= 1, 'Validator: max 0 und nicht ganzzahlig abgelehnt');
  ok(F({ takt: 0.1 }).length === 1 && F({ takt: 'x' }).length === 1, 'Validator: Takt unter 0,5 s oder keine Zahl abgelehnt');
  ok(F({ radius: 0 }).length === 1 && F({ radius: 13 }).length === 1, 'Validator: Radius außerhalb 1 bis 12 abgelehnt');
  ok(F({ typ: 'gibtsnicht' }).length === 1 && F({}, ['typ']).length === 1, 'Validator: unbekannter oder fehlender Nachwuchs-Typ abgelehnt');
  ok(F({ typ: 'rudeltier' }).length === 1 && /bindung/.test(F({ typ: 'rudeltier' })[0]), 'Validator: Nachwuchs ohne bindung abgelehnt (er zerfiele nie)');
  ok(F({ extra: 1 }).length === 1 && /unbekanntes Feld/.test(F({ extra: 1 })[0]), 'Validator: unbekanntes Feld abgelehnt');
  KREATUREN.typen.schwarmling.bausteine.brut = kopie(BRUT);   // der Validator liest die Nachwuchs-Typen aus den geladenen Daten
  try { ok(Kreatur.pruefen(KREATUREN).some((m) => /selbst eine brut/.test(m)), 'Validator: Nachwuchs, der selbst brütet, abgelehnt'); } finally { delete KREATUREN.typen.schwarmling.bausteine.brut; }
  ok(Kreatur.pruefen(KREATUREN).length === 0, 'Daten danach wieder unverändert gültig');
});

// ---------- nestSetzen ----------
section('nestSetzen: Königin angelegt, Buchführung, Fehlerfälle ohne Nebenwirkung', () => {
  const S = szene();
  const Q = nest(S, 'nestA');
  ok(Q && Q.typ === 'koenigin' && Q.gruppe === 'nestA' && Q.alive && S.aw.kreaturen.length === 1, 'Königin angelegt (Typ, Gruppe, lebt, die einzige Kreatur)');
  ok(S.aw.kreaturGruppen.nestA.erschienen === 1 && S.aw.kreaturGruppen.nestA.typ === 'koenigin', 'Buchführung aw.kreaturGruppen: erschienen 1, Typ koenigin');
  ok(Math.abs(Q.x / 32 - Math.round(Q.x / 32)) < 1e-9 && Math.abs(Q.y / 32 - Math.round(Q.y / 32)) < 1e-9, 'Größe 2: Mitte auf der Kachelecke');
  const vorher = JSON.stringify([S.aw.kreaturen.length, S.aw.kreaturSeq, S.aw.kreaturGruppen]);
  const fehler = [
    Kreatur.nestSetzen(S.g, { map: S.map, typ: 'gibtsnicht', gruppe: 'x', x: 10, y: 10 }),
    Kreatur.nestSetzen(S.g, { map: S.map, typ: 'koenigin', gruppe: '1 ungültig', x: 10, y: 10 }),
    Kreatur.nestSetzen(S.g, { map: S.map, typ: 'koenigin', gruppe: 'x', x: NaN, y: 10 }),
    Kreatur.nestSetzen(S.g, { map: 'nirgends', typ: 'koenigin', gruppe: 'x', x: 10, y: 10 }),
    Kreatur.nestSetzen(S.g, { map: S.map, typ: 'rudeltier', gruppe: 'nestA', x: 10, y: 10 }),
    Kreatur.nestSetzen(S.g, { map: S.map, typ: 'koenigin', gruppe: 'x', x: -50, y: -50 }),
    Kreatur.nestSetzen(S.g, null),
  ];
  ok(fehler.every((r) => r.n === 0 && r.ids.length === 0 && typeof r.fehler === 'string' && /^nest_setzen: /.test(r.fehler)), 'sieben Fehlerfälle (Typ, Gruppe, Position, Karte, Gruppe mit anderem Typ, kein Platz, kein Argument): Text, n 0 (' + fehler.map((r) => r.fehler).join(' | ') + ')');
  ok(JSON.stringify([S.aw.kreaturen.length, S.aw.kreaturSeq, S.aw.kreaturGruppen]) === vorher, 'Fehlerfälle ändern nichts (Kreaturen, Nummern, Buchführung)');
  const Q2 = nest(S, 'nestA');
  ok(S.aw.kreaturGruppen.nestA.erschienen === 2 && Q2.id !== Q.id, 'zweiter Aufruf derselben Gruppe zählt weiter (erschienen 2)');
});

// ---------- Startbesatz und Instanzfelder ----------
section('Startbesatz, Gruppe, keine neuen Instanzfelder', () => {
  const S = szene();
  const Q = nest(S, 'nestA');
  ok(Q.brut === undefined && schwarm(S).length === 0, 'vor dem ersten Abgleich: kein K.brut, kein Schwarmling');
  step(S);
  const W = schwarm(S);
  ok(W.length === BRUT.anfang && S.fehler.length === 0, 'nach dem ersten Tick mit Außenteam: Startbesatz ' + BRUT.anfang + ' (' + W.length + ', Fehler: ' + S.fehler.join('|') + ')');
  ok(W.every((K) => K.gruppe === 'nestA' && K.typ === 'schwarmling' && K.bindung && K.bindung.art === 'kreatur'), 'alle tragen die Gruppe der Königin und die Bindung an eine Kreatur');
  ok(Q.brut && Object.keys(Q.brut).sort().join() === 'rest,t', 'K.brut entsteht lazy nur an der Königin und trägt nur { t, rest }');
  ok(W.every((K) => !('brut' in K)), 'kein Schwarmling trägt K.brut');
  const dist = W.map((K) => Math.hypot(K.x - Q.x, K.y - Q.y) / 32);
  ok(dist.every((d) => d >= 1.5 - 1e-9 && d <= BRUT.radius * 1.5 + 2), 'Nachwuchs erscheint um die Königin (Abstand ' + Math.min(...dist).toFixed(1) + ' bis ' + Math.max(...dist).toFixed(1) + ' Kacheln, Radius ' + BRUT.radius + ')');
  // Instanzfelder: ein frisch angelegter Schwarmling hat dieselben Felder wie jede andere Kreatur (probe), nur gruppe/bindung kommen aus Daten und Aufruf dazu
  const S2 = szene(); nest(S2, 'g');
  const P = Kreatur.erzeugen(S2.g, 'probe', S2.p.x + 90, S2.p.y);
  const Wn = Kreatur.erzeugen(S2.g, 'schwarmling', S2.p.x - 90, S2.p.y);
  const ohne = (K) => Object.keys(K).filter((k) => k !== 'bindung' && k !== 'gruppe').sort().join();
  ok(ohne(Wn) === ohne(P), 'Instanzfelder des Schwarmlings = die einer Kreatur ohne Bindung plus bindung (keine neuen Felder): ' + ohne(Wn));
  const Q3 = S2.aw.kreaturen.find((K) => K.typ === 'koenigin');
  ok(Object.keys(Q3).sort().join() === Object.keys(P).concat(['gruppe']).sort().join(), 'die Königin hat vor dem ersten Abgleich keine zusätzlichen Felder');
});

// ---------- Takt aus den Daten ----------
for (const takt of [1.5, 6]) {
  section('Takt aus den Daten: ' + takt + ' s (Startbesatz 0, ein Neuzugang je Takt)', () => mitBrut({ anfang: 0, takt, max: 20 }, () => {
    const S = szene();
    nest(S, 'nestA');
    const zeiten = []; let z0 = 0;
    schritte(S, takt * 5.2, () => { const z = schwarm(S).length; if (z > z0) zeiten.push(S.g.time); z0 = z; });
    ok(zeiten.length === 5, '5,2 Takte: genau 5 Neuzugänge (' + zeiten.length + ')');
    const abst = zeiten.slice(1).map((t, i) => t - zeiten[i]);
    ok(abst.every((a) => Math.abs(a - takt) <= DT * 1.5), 'Abstände gleich dem Takt ' + takt + ' s (±1,5 Ticks): ' + abst.map((a) => a.toFixed(2)).join(' '));
    ok(zeiten[0] >= takt - DT * 1.5 && zeiten[0] <= takt + DT * 1.5, 'der erste Neuzugang nach einem Takt (' + (zeiten[0] || 0).toFixed(2) + ' s)');
  }));
}

// ---------- Obergrenze ----------
section('Obergrenze: nie mehr als max gleichzeitig, auch unter Dauerverlusten; die Liste wächst nicht', () => mitBrut({ takt: 0.5 }, () => {
  const S = szene();
  const Q = nest(S, 'nestA');
  let hoechst = 0, laenge = 0, tote = 0;
  const pro = (i) => {
    const z = schwarm(S); hoechst = Math.max(hoechst, z.length); laenge = Math.max(laenge, S.aw.kreaturen.length);
    if (i % Math.round(0.7 / DT) === 5 && z.length) { toeten(S, z[i % z.length]); tote++; }   // alle 0,7 s ein Verlust (langsamer als die Brut mit Takt 0,5 s): 200 Wiederkehr-Zyklen in 150 s
  };
  schritte(S, 150, pro);
  ok(tote >= 190, 'rund 200 Verluste erzeugt (' + tote + ')');
  ok(hoechst === BRUT.max, 'höchstens ' + BRUT.max + ' lebende Schwarmlinge gleichzeitig, die Obergrenze wird erreicht (' + hoechst + ')');
  ok(laenge <= BRUT.max + 1 + 3, 'aw.kreaturen bleibt klein: höchstens max + Königin + wenige noch nicht entfernte Tote (' + laenge + ' über 200 Zyklen)');
  ok(S.aw.kreaturen.filter((K) => !Kreatur.nichtEndgueltigErledigt(K)).length <= 3, 'Tote werden entfernt (kein Friedhof in der Liste: ' + S.aw.kreaturen.filter((K) => !Kreatur.nichtEndgueltigErledigt(K)).length + ' tot am Ende)');
  ok(S.me_('kreaturAufgeloest').length === 0, 'das stille Entfernen toter Nachkommen meldet kein kreaturAufgeloest');
  ok(S.me_('kreaturAusgefallen').length === tote, 'jeder Verlust meldet kreaturAusgefallen genau einmal (' + S.me_('kreaturAusgefallen').length + ')');
  ok(Q.alive && S.fehler.length === 0 && S.g.errors === 0, 'Königin lebt, keine Fehler (' + S.fehler.join('|') + ', g.errors ' + S.g.errors + ')');
}));
section('Obergrenze aus den Daten: max 14 bei Startbesatz 12', () => mitBrut({ anfang: 12, max: 14, takt: 1 }, () => {
  const S = szene();
  nest(S, 'nestA');
  let hoechst = 0;
  schritte(S, 30, () => { hoechst = Math.max(hoechst, schwarm(S).length); });
  ok(hoechst === 14 && schwarm(S).length === 14, 'nach 30 s genau 14 und nie mehr (' + hoechst + ')');
}));

// ---------- Wiederkehr mit lebender Königin ----------
section('Wiederkehr mit lebender Königin: gefallene Schwarmlinge kommen nach dem Takt zurück', () => {
  const S = szene();
  nest(S, 'nestA');
  step(S);
  const z0 = schwarm(S);
  ok(z0.length === BRUT.anfang, 'Ausgangslage: Startbesatz ' + z0.length);
  for (const K of z0.slice(0, 5)) toeten(S, K);
  step(S);
  ok(schwarm(S).length === BRUT.anfang - 5, '5 gefallen: ' + (BRUT.anfang - 5) + ' leben');
  schritte(S, BRUT.takt * 2 + 0.5);
  ok(schwarm(S).length === BRUT.anfang - 5 + 2, 'nach zwei Takten zwei Neue (' + schwarm(S).length + ')');
  schritte(S, BRUT.takt * 8);
  ok(schwarm(S).length === BRUT.anfang - 5 + 10, 'weiter nachwachsend, ein Neuer je Takt, bis max (' + schwarm(S).length + ' von max ' + BRUT.max + ')');
  schritte(S, BRUT.takt * 4);
  ok(schwarm(S).length === BRUT.max, 'danach genau max und nicht darüber (' + schwarm(S).length + ')');
});

// ---------- Zerfall ohne Königin ----------
section('Zerfall: Königin endgültig erledigt, alle Schwarmlinge lösen sich auf und kehren nie wieder', () => {
  const S = szene();
  const Q = nest(S, 'nestA');
  step(S);
  const vor = schwarm(S);
  ok(vor.length === BRUT.anfang, 'Ausgangslage: ' + vor.length + ' Schwarmlinge');
  toeten(S, Q);
  ok(!Q.alive && Q.zustand === 'verwundet', 'Königin tot (verwundet)');
  schritte(S, 1);
  ok(schwarm(S).length === 0 && S.aw.kreaturen.every((K) => K.typ === 'koenigin'), 'nach 1 s alle Schwarmlinge aufgelöst und aus aw.kreaturen entfernt');
  ok(S.me_('kreaturAufgeloest').length === vor.length, 'je Schwarmling ein kreaturAufgeloest (' + S.me_('kreaturAufgeloest').length + ')');
  schritte(S, BRUT.takt * 6);
  ok(schwarm(S).length === 0 && S.aw.kreaturen.length === 1, 'nach ' + BRUT.takt * 6 + ' s weiter keiner (Wiederkehr bleibt aus)');
  schritte(S, 60);   // Ausbluten verwundet -> aus
  ok(Q.zustand === 'aus' && schwarm(S).length === 0 && S.aw.kreaturen.length === 1, 'auch nach dem Ausbluten der Königin (aus) kein Nachwuchs');
  ok(S.fehler.length === 0 && S.g.errors === 0, 'keine Fehler');
});

// ---------- Bewusstlose Königin ----------
section('Bewusstlose Königin zählt weiter als Quelle: Schwarm bleibt, Wiederkehr läuft', () => {
  const S = szene();
  const Q = nest(S, 'nestA');
  step(S);
  hinten(S, Q, 'betaeuber');
  ok(!Q.alive && Q.zustand === 'bewusstlos' && Q.liegt === true, 'Königin mit dem Betäuber bewusstlos');
  schritte(S, 2);
  ok(schwarm(S).length === BRUT.anfang && S.me_('kreaturAufgeloest').length === 0, 'Schwarm bleibt (keine Auflösung bei Bewusstlosigkeit)');
  for (const K of schwarm(S).slice(0, 4)) toeten(S, K);
  const z = schwarm(S).length;
  schritte(S, BRUT.takt * 2 + 0.5);
  ok(!Q.alive && Q.zustand === 'bewusstlos' && schwarm(S).length === z + 2, 'bei weiter bewusstloser Königin kehren Schwarmlinge wieder (' + z + ' -> ' + schwarm(S).length + ')');
  ok(S.me_('kreaturAusgefallen').length === 4, 'bewusstlos meldet nichts, nur die vier gefallenen Schwarmlinge');
  aufwachen(S, Q);
  ok(Q.alive && Q.zustand === 'ok', 'Königin steht wieder auf (' + Q.zustand + ')');
  toeten(S, Q);
  schritte(S, 1);
  ok(Q.zustand === 'verwundet' && schwarm(S).length === 0, 'danach endgültig erledigt: Schwarm weg');
});

// ---------- Erledigt ----------
section('Missionsbedingung kreaturen_erledigt { typ }: erst mit endgültig erledigter Königin', () => {
  const S = szene();
  const Q = nest(S, 'nestA');
  ok(!erledigt(S, { typ: 'koenigin' }), 'Königin lebt: nicht erfüllt');
  step(S);
  for (const K of schwarm(S)) toeten(S, K);
  ok(schwarm(S).length === 0 && !erledigt(S, { typ: 'koenigin' }), 'alle Schwarmlinge gefallen, Königin lebt: NICHT erfüllt');
  hinten(S, Q, 'betaeuber');
  ok(Q.zustand === 'bewusstlos' && !erledigt(S, { typ: 'koenigin' }), 'Königin bewusstlos: nicht erfüllt');
  aufwachen(S, Q);
  toeten(S, Q);
  ok(Q.zustand === 'verwundet' && erledigt(S, { typ: 'koenigin' }), 'Königin aufgewacht und endgültig erledigt: erfüllt');
  const S2 = szene();
  const Q2 = nest(S2, 'nestB');
  step(S2);
  ok(!erledigt(S2, { typ: 'koenigin' }), 'zweite Szene: Königin lebt, Schwarm da: nicht erfüllt');
  toeten(S2, Q2);
  ok(erledigt(S2, { typ: 'koenigin' }), 'Königin tot, Schwarmlinge noch nicht aufgelöst (gleiche Tickzeit): erfüllt, Maß ist die Königin');
  schritte(S2, 1);
  ok(erledigt(S2, { typ: 'koenigin' }) && schwarm(S2).length === 0, 'nach dem Zerfall weiter erfüllt');
  // ohne Buchführung (Königin nicht über nestSetzen angelegt) gilt sie nie als erschienen: das ist der Grund für nestSetzen
  const S3 = szene();
  const Q3 = Kreatur.erzeugen(S3.g, 'koenigin', S3.p.x + 200, S3.p.y);
  toeten(S3, Q3);
  ok(!erledigt(S3, { typ: 'koenigin' }), 'Gegenprobe: über erzeugen statt nestSetzen angelegt führt keine Buchführung (nicht erfüllt)');
});

// ---------- Wirkung aus den Daten, kein Typname im Servercode ----------
section('Wirkung aus den Daten: ein Paar mit anderen Namen verhält sich gleich', () => {
  KREATUREN.typen.kolonie = kopie(KREATUREN.typen.koenigin); KREATUREN.typen.kolonie.name = 'kreatur.kolonie';
  KREATUREN.typen.kolonie.bausteine.brut = Object.assign(kopie(BRUT), { typ: 'arbeiter', anfang: 3, max: 5, takt: 2 });
  KREATUREN.typen.arbeiter = kopie(KREATUREN.typen.schwarmling); KREATUREN.typen.arbeiter.name = 'kreatur.arbeiter';
  KREATUREN.typen.arbeiter.bausteine.bindung.quelle.typ = 'kolonie';
  try {
    ok(Kreatur.pruefen(KREATUREN).length === 0, 'Fremdnamen-Paar kolonie/arbeiter gültig');
    const S = szene();
    const Q = nest(S, 'k', 'kolonie');
    step(S);
    const nur = (t) => S.aw.kreaturen.filter((K) => K.typ === t && Kreatur.nichtEndgueltigErledigt(K));
    ok(nur('arbeiter').length === 3, 'Startbesatz 3 aus den Daten des Fremdtyps');
    schritte(S, 30);
    ok(nur('arbeiter').length === 5, 'max 5 aus den Daten, nicht mehr');
    toeten(S, Q); schritte(S, 1);
    ok(nur('arbeiter').length === 0 && S.me_('kreaturAufgeloest').length === 5, 'Zerfall ohne die Fremd-Königin');
  } finally { delete KREATUREN.typen.kolonie; delete KREATUREN.typen.arbeiter; }
  const namen = ['schwarmling', 'koenigin'];
  const dateien = [];
  const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) geh(p); else if (e.name.endsWith('.js')) dateien.push(p); } };
  geh(path.join(__dirname, '..', 'server'));
  const treffer = [];
  for (const f of dateien) { const text = fs.readFileSync(f, 'utf8'); for (const nm of namen) if (new RegExp('[\'"`]' + nm + '[\'"`]|[\'"`]kreatur\\.' + nm + '[\'"`]|\\.' + nm + '\\b').test(text)) treffer.push(path.relative(path.join(__dirname, '..'), f) + ' ~ ' + nm); }
  ok(dateien.length > 50 && treffer.length === 0, 'kein Typname (schwarmling, koenigin) im server/ (' + dateien.length + ' Dateien)' + (treffer.length ? ': ' + treffer.join('; ') : ''));
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
