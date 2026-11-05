'use strict';
// MON-02 P2: Ereignis `kreaturAusgefallen { id, typ, gruppe, x, y }` (Kreatur.ausgefallenMelden, aus combat.faellt) und Prüfbaustein `kreaturen_erledigt { map, gruppe | typ }` (Kreatur.rudelErledigt).
// Echtes Spiel (Game), Wildnis-Karte, Rudel über die Aktion kreatur_besetzen, Treffer über combat.hitEnemy mit echten Wirkungen (Blaster von hinten = Rückentreffer, Betäuber). Geprüft:
//   Rudel von 4 und 8: erschienen und alle am Leben = nicht erfüllt; n-1 tot = nicht erfüllt; alle tot = erfüllt; je Tier genau ein Ereignis mit richtigen Feldern (Spiel- und Missionsereignis); Ausbluten (verwundet -> aus) meldet nicht zweimal.
//   Bewusstlos (Betäuber) = nicht erfüllt und kein Ereignis; wacht auf = weiter nicht erfüllt; danach getötet = erfüllt, ein Ereignis. Aufgelöstes Tier (Bindung) zählt als erledigt (kein kreaturAusgefallen).
//   Zwei Gruppen unabhängig, typ-Variante, Parameterfehler (beide/keines, unbekannte Karte und Gruppe nie ein Fehler), Merker höchstens einmal, Räumen beim Szenario-Start.
//   Gegenproben: squad_cleared zählt Kreaturen nicht, Wellen/Graben/Bodenkampf unverändert (kein Kreaturenbezug außer raeumen), Drohnen melden kein kreaturAusgefallen, Kreaturen kein droneKilled/enemyUp/Phantom-Trupp, kein Typname im Servercode.
//   node tools/test-kreatur-erledigt.js   (npm run test:kreatur-erledigt)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
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

// Testtyp mit Bindung an alle rudeltiere (löst sich auf, sobald keines mehr nicht endgültig erledigt ist). Nur eine Datenzeile, der Server kennt keine Typnamen.
KREATUREN.typen.mitbindung = kopie(KREATUREN.typen.rudeltier);
KREATUREN.typen.mitbindung.name = 'kreatur.mitbindung';
KREATUREN.typen.mitbindung.bausteine.bindung = { quelle: { art: 'kreatur', typ: 'rudeltier' }, folge: { art: 'aufloesen' } };

// ---------- Messhilfen ----------
// Wildnis-Szene im echten Spiel (wie test-kreatur-rudel): Spieler unverwundbar und nicht wahrnehmbar (downed), Banditen weg; Beobachter für Spiel- und Missionsereignisse
function szene(biom, seed, gr) {
  const s = H.neuesSpiel(1, { art: 'wildnis', seed, groesse: gr || 'mittel', biom: biom || 'wueste' });
  const g = s.g, p = g.players[0];
  g.away.drones = []; combat.ensureV2(g, g.away, s.map); g.away.kreaturen = [];
  g.god = true; p.downed = true;
  const S = { g, k: s.k, map: s.map, p, aw: g.away, fehler: [], me: [], ev: [] };
  g.countError = (w, e) => { S.fehler.push(w + ': ' + (e && e.message)); };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { S.me.push({ nm, d }); return m0(nm, d); };
  const e0 = g.emit.bind(g); g.emit = (nm, d) => { S.ev.push({ nm, d }); return e0(nm, d); };
  S.me_ = (nm) => S.me.filter((x) => x.nm === nm);
  S.ev_ = (nm) => S.ev.filter((x) => x.nm === nm);
  return S;
}
const aktion = (S, o) => S.g.mission.act(Object.assign({ do: 'kreatur_besetzen', map: S.map }, o));
const rudel = (S, gruppe, anzahl, bereich, typ) => { aktion(S, { bereich: bereich || 'gelaende', typ: typ || 'rudeltier', anzahl, gruppe }); return S.aw.kreaturen.filter((K) => K.gruppe === gruppe); };
const chk = (S, name, args) => !!Registry.get(name).test(S.g.mission, args);
const erledigt = (S, o) => chk(S, 'kreaturen_erledigt', Object.assign({ map: S.map }, o));
// Treffer von hinten (Rückentreffer, Blick +x, Schütze links) bis die Kreatur liegt; Betäuber statt Blaster = nichttödlich. Liefert die Zahl der Treffer.
function hinten(S, K, art, max) {
  K.facing = 0;
  const x = K.x - 100, y = K.y;
  const w = art === 'betaeuber' ? { waffe: 'betaeuber', schaden: 1, art: 'direkt', nichttoedlich: true } : { waffe: 'blaster', schaden: 1, art: 'direkt' };
  const wirk = Object.assign({}, w, { x, y, quelle: { id: S.p.id, pid: S.p.id, team: 'crew', x, y } });
  let i = 0;
  for (; i < (max || 40) && K.alive; i++) combat.hitEnemy(S.g, K, 1, { x, y, pid: S.p.id, wirkung: wirk });
  return i;
}
const toeten = (S, K) => hinten(S, K, 'blaster');
function schritte(S, sek) { for (let i = 0, N = Math.round(sek / DT); i < N; i++) { S.p.downed = true; S.g.step(); } }

// ---------- Rudel von 4 und 8 ----------
for (const N of [4, 8]) {
  section('Rudel von ' + N + ': erledigt erst, wenn alle tot sind; je Tier ein Ereignis', () => {
    const S = szene('wueste', 101, 'mittel');
    const L = rudel(S, 'r', N, 'gelaende');
    ok(S.fehler.length === 0 && L.length === N && S.aw.kreaturGruppen.r.erschienen === N, N + ' Tiere über kreatur_besetzen angelegt, erschienen ' + N + ' (' + S.fehler.join('|') + ')');
    ok(!erledigt(S, { gruppe: 'r' }), 'alle am Leben: nicht erfüllt (obwohl erschienen)');
    for (let i = 0; i < N - 1; i++) toeten(S, L[i]);
    ok(L.slice(0, N - 1).every((K) => !K.alive && K.zustand === 'verwundet') && L[N - 1].alive, (N - 1) + ' tot (verwundet), eines lebt');
    ok(!erledigt(S, { gruppe: 'r' }) && !erledigt(S, { typ: 'rudeltier' }), 'n-1 tot: nicht erfüllt (Gruppe und Typ)');
    ok(S.me_('kreaturAusgefallen').length === N - 1 && S.ev_('kreaturAusgefallen').length === N - 1, 'n-1 Ereignisse (Missions- und Spielereignis je ' + (N - 1) + ')');
    toeten(S, L[N - 1]);
    ok(erledigt(S, { gruppe: 'r' }) && erledigt(S, { typ: 'rudeltier' }), 'alle tot: erfüllt (Gruppe und Typ)');
    const E = S.me_('kreaturAusgefallen').map((x) => x.d);
    ok(E.length === N && new Set(E.map((d) => d.id)).size === N && S.ev_('kreaturAusgefallen').length === N, 'je Tier genau ein Ereignis (' + E.length + ', verschiedene Kennungen ' + new Set(E.map((d) => d.id)).size + ')');
    ok(L.every((K) => { const d = E.find((x) => x.id === K.id); return d && d.typ === 'rudeltier' && d.gruppe === 'r' && d.x === Math.round(K.x) && d.y === Math.round(K.y) && Object.keys(d).sort().join() === 'gruppe,id,typ,x,y'; }), 'Felder id, typ, gruppe, x, y stimmen mit dem Tier überein (genau diese fünf Felder)');
    ok(S.me_('kreaturAusgefallen').every((x, i) => x.d === S.ev_('kreaturAusgefallen')[i].d || JSON.stringify(x.d) === JSON.stringify(S.ev_('kreaturAusgefallen')[i].d)), 'Spiel- und Missionsereignis tragen dieselben Daten');
    if (N === 4) {
      schritte(S, 50);   // Ausbluten: verwundet -> aus nach 45 s
      ok(L.every((K) => K.zustand === 'aus') && S.me_('kreaturAusgefallen').length === N && erledigt(S, { gruppe: 'r' }), 'nach dem Ausbluten (alle aus): kein zweites Ereignis, weiter erfüllt');
    }
    ok(S.g.errors === 0, 'g.errors 0');
  });
}

// ---------- Bewusstlos ----------
section('Bewusstlos (Betäuber) ist nicht erledigt und meldet nichts; wacht auf; danach getötet', () => {
  const S = szene('wueste', 101, 'mittel');
  const L = rudel(S, 'b', 3, 'gelaende');
  const [A, B, C] = L;
  toeten(S, A); toeten(S, B);
  ok(!erledigt(S, { gruppe: 'b' }) && S.me_('kreaturAusgefallen').length === 2, 'zwei tot, eines lebt: nicht erfüllt, 2 Ereignisse');
  hinten(S, C, 'betaeuber');
  ok(!C.alive && C.zustand === 'bewusstlos' && C.liegt === true, 'drittes Tier mit dem Betäuber bewusstlos (alive false, liegt)');
  ok(!erledigt(S, { gruppe: 'b' }) && !erledigt(S, { typ: 'rudeltier' }), 'bewusstlos zählt als NICHT erledigt (anders als eine liegende Drohne bei squad_cleared)');
  ok(S.me_('kreaturAusgefallen').length === 2 && S.ev_('kreaturAusgefallen').length === 2 && !('ausgefallenGemeldet' in C), 'bewusstlos: kein Ereignis, kein Merker am Körper');
  schritte(S, 31);
  ok(C.alive && C.zustand === 'ok' && !C.liegt, 'nach 31 s aufgewacht (alive, zustand ok)');
  ok(!erledigt(S, { gruppe: 'b' }) && S.me_('kreaturAusgefallen').length === 2, 'aufgewacht: weiter nicht erfüllt, weiter 2 Ereignisse');
  toeten(S, C);
  ok(C.zustand === 'verwundet' && erledigt(S, { gruppe: 'b' }), 'danach getötet: erfüllt');
  const E = S.me_('kreaturAusgefallen').filter((x) => x.d.id === C.id);
  ok(S.me_('kreaturAusgefallen').length === 3 && E.length === 1 && S.ev_('kreaturAusgefallen').length === 3, 'die einst bewusstlose Kreatur meldet genau einmal, beim endgültigen Ausfall (3 Ereignisse insgesamt)');
  // Betäuber trifft eine schon verwundete Kreatur nicht mehr (zustand != ok): nichts doppelt
  hinten(S, A, 'betaeuber', 3);
  ok(S.me_('kreaturAusgefallen').length === 3, 'weitere Treffer auf Liegende ändern nichts');
  ok(S.g.errors === 0, 'g.errors 0');
});

// ---------- Auflösung (Bindung) ----------
section('Aufgelöstes Tier (Bindung) zählt als erledigt, ohne kreaturAusgefallen', () => {
  const S = szene('wueste', 101, 'mittel');
  const Q = rudel(S, 'quelle', 2, 'gelaende');
  const G = rudel(S, 'gebunden', 2, 'gelaende', 'mitbindung');
  ok(S.fehler.length === 0 && Q.length === 2 && G.length === 2 && S.aw.kreaturGruppen.gebunden.typ === 'mitbindung', 'Quelle (2 rudeltier) und gebundene Gruppe (2) angelegt (' + S.fehler.join('|') + ')');
  ok(!erledigt(S, { gruppe: 'gebunden' }) && !erledigt(S, { typ: 'mitbindung' }), 'gebundene Tiere leben: nicht erfüllt');
  toeten(S, Q[0]);
  schritte(S, 1);
  ok(G.every((K) => !K.weg) && !erledigt(S, { gruppe: 'gebunden' }), 'eine Quelle lebt noch: nichts gelöst');
  toeten(S, Q[1]);
  schritte(S, 1);
  ok(S.aw.kreaturen.filter((K) => K.gruppe === 'gebunden').length === 0 && S.me_('kreaturAufgeloest').length === 2, 'Quelle tot: beide gebundenen Tiere aufgelöst (kreaturAufgeloest 2, aus aw.kreaturen entfernt)');
  ok(erledigt(S, { gruppe: 'gebunden' }) && erledigt(S, { typ: 'mitbindung' }), 'aufgelöste Tiere zählen als erledigt (Gruppe und Typ)');
  ok(S.me_('kreaturAusgefallen').length === 2 && S.me_('kreaturAusgefallen').every((x) => x.d.gruppe === 'quelle'), 'kreaturAusgefallen nur für die beiden erschossenen Tiere, nicht für die aufgelösten');
  ok(erledigt(S, { gruppe: 'quelle' }), 'die Quellgruppe ist ebenfalls erledigt');
});

// ---------- Zwei Gruppen, Typ ----------
section('Zwei Gruppen unabhängig, typ-Variante, Parameter', () => {
  const S = szene('wueste', 101, 'mittel');
  const A = rudel(S, 'a', 4, 'gelaende'), B = rudel(S, 'b', 4, 'gelaende');
  ok(A.length === 4 && B.length === 4, 'zwei Rudel zu je 4');
  for (const K of A) toeten(S, K);
  ok(erledigt(S, { gruppe: 'a' }) && !erledigt(S, { gruppe: 'b' }), 'a erledigt, b nicht');
  ok(!erledigt(S, { typ: 'rudeltier' }), 'typ: solange b lebt, nicht erfüllt');
  ok(S.me_('kreaturAusgefallen').every((x) => x.d.gruppe === 'a') && S.me_('kreaturAusgefallen').length === 4, 'Ereignisse nur mit gruppe a');
  for (const K of B) toeten(S, K);
  ok(erledigt(S, { gruppe: 'b' }) && erledigt(S, { typ: 'rudeltier' }) && erledigt(S, { gruppe: 'a' }), 'b tot: alle drei Varianten erfüllt');
  ok(!erledigt(S, { typ: 'probe' }), 'typ probe: nie erschienen, nicht erfüllt (kein Fehler)');
  ok(!erledigt(S, { gruppe: 'gibtsnicht' }) && !erledigt(S, { gruppe: 'constructor' }) && !erledigt(S, { gruppe: '__proto__' }), 'unbekannte Gruppe (auch constructor, __proto__): nicht erfüllt, kein Wurf');
  ok(!chk(S, 'kreaturen_erledigt', { map: 'nirgends', gruppe: 'a' }) && !chk(S, 'kreaturen_erledigt', { map: 'constructor', gruppe: 'a' }), 'unbekannte Karte: nicht erfüllt, kein Fehler');
  ok(!chk(S, 'kreaturen_erledigt', { map: S.map }) && !chk(S, 'kreaturen_erledigt', { map: S.map, gruppe: 'a', typ: 'rudeltier' }), 'weder gruppe noch typ, oder beide: nicht erfüllt');
  // Debug-Kreatur ohne Gruppe: zählt für die typ-Variante mit, hat gruppe null im Ereignis
  const D = Kreatur.erzeugen(S.g, 'rudeltier', 100, 100);
  ok(!erledigt(S, { typ: 'rudeltier' }) && erledigt(S, { gruppe: 'a' }), 'ein Tier ohne Gruppe lebt: typ nicht erfüllt, Gruppe a weiter erfüllt');
  toeten(S, D);
  const d = S.me_('kreaturAusgefallen').pop().d;
  ok(erledigt(S, { typ: 'rudeltier' }) && d.id === D.id && d.gruppe === null, 'ohne Gruppe: Ereignis mit gruppe null, typ erfüllt');
  const dsc = Registry.describe().find((x) => x.id === 'kreaturen_erledigt');
  ok(!!dsc && dsc.art === 'pruefung' && dsc.params.map.typ === 'map' && dsc.params.map.pflicht && dsc.params.gruppe.typ === 'string' && !dsc.params.gruppe.pflicht && dsc.params.typ.typ === 'string' && !dsc.params.typ.pflicht, 'Baustein kreaturen_erledigt registriert: Prüfung, map Pflicht, gruppe und typ als string (je optional, Laufzeitprüfung genau eines)');
});

// ---------- Prüfer und Laufzeitfehler (M1) ----------
section('Prüfer: kreaturen_erledigt braucht genau eines von gruppe/typ, typ gegen kreaturen.json; Laufzeit meldet einmal', () => {
  const Checker = require('../server/mission/checker.js');
  const book = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher', 'm3.regiebuch.json'), 'utf8'));
  const karte = book.buehne.aussenkarten[0];
  const pruefe = (args) => {
    const b = JSON.parse(JSON.stringify(book));
    b.steps[0].next = [{ if: { check: Object.assign({ name: 'kreaturen_erledigt', map: karte }, args) }, goto: b.steps[1].id }].concat(b.steps[0].next || []);
    return Checker.check(b);
  };
  const mit = (r) => r.errors.filter((e) => /kreaturen_erledigt/.test(e.msg || ''));
  ok(mit(pruefe({ gruppe: 'r' })).length === 0 && mit(pruefe({ typ: 'rudeltier' })).length === 0, 'nur gruppe oder nur gültiger typ: keine Prüferfehler (' + pruefe({ gruppe: 'r' }).errors.map((e) => e.code + ' ' + e.msg).join('|') + ')');
  ok(mit(pruefe({})).length === 1 && /beide fehlen/.test(mit(pruefe({}))[0].msg), 'weder gruppe noch typ: Prüferfehler');
  ok(mit(pruefe({ gruppe: 'r', typ: 'rudeltier' })).length === 1 && /beide gesetzt/.test(mit(pruefe({ gruppe: 'r', typ: 'rudeltier' }))[0].msg), 'gruppe und typ zugleich: Prüferfehler');
  const u = mit(pruefe({ typ: 'rudeltyp' }));
  ok(u.length === 1 && /gibt es in content\/kampf\/kreaturen.json nicht/.test(u[0].msg) && /rudeltier/.test(u[0].msg), 'unbekannter typ (Tippfehler): Prüferfehler mit den bekannten Typen');
  ok(!pruefe({ typ: 'rudeltyp' }).ok, 'Buch mit Tippfehler im typ besteht den Prüfer nicht');
  // Laufzeit: genau eine countError-Meldung, nicht eine je Tick/Aufruf; weiter false
  const S = szene('wueste', 101, 'mittel');
  ok(!erledigt(S, {}) && !erledigt(S, { gruppe: 'a', typ: 'probe' }) && !erledigt(S, { typ: 'rudeltyp' }) && S.fehler.length === 1 && /mission-kreatur: kreaturen_erledigt/.test(S.fehler[0]), 'Laufzeit: false und genau eine Meldung (' + S.fehler.join('|') + ')');
  const S2 = szene('wueste', 101, 'mittel');
  ok(!erledigt(S2, { typ: 'rudeltyp' }) && S2.fehler.length === 1 && /rudeltyp/.test(S2.fehler[0]), 'Laufzeit: Tippfehler im typ meldet (' + S2.fehler.join('|') + ')');
  ok(Kreatur.erledigtOptionenFehler({ gruppe: 'a' }).length === 0 && Kreatur.erledigtOptionenFehler({ typ: 'probe' }).length === 0, 'erledigtOptionenFehler: gültige Formen ohne Fehler');
  const dsc = Registry.describe().find((x) => x.id === 'kreatur_besetzen');
  ok(dsc.ereignisse.includes('kreaturAusgefallen') && dsc.ereignisse.includes('kreaturAufgeloest') && typeof Registry.describe().find((x) => x.id === 'kreaturen_erledigt').argsPruefen === 'undefined', 'kreatur_besetzen deklariert seine Folge-Ereignisse; describe gibt keine Funktion aus');
});

// ---------- Merker ----------
section('Merker: höchstens einmal, nie für Lebende, Bewusstlose, Aufgelöste', () => {
  const S = szene('wueste', 101, 'mittel');
  const [K] = rudel(S, 'm', 1, 'gelaende');
  ok(Kreatur.ausgefallenMelden(S.g, K) === false && S.me_('kreaturAusgefallen').length === 0 && !('ausgefallenGemeldet' in K), 'lebend: keine Meldung, kein Merker (die Instanz bleibt bis dahin unverändert)');
  K.alive = false; K.zustand = 'bewusstlos'; K.liegt = true;
  ok(Kreatur.ausgefallenMelden(S.g, K) === false && S.me_('kreaturAusgefallen').length === 0, 'bewusstlos: keine Meldung');
  K.zustand = 'verwundet';
  ok(Kreatur.ausgefallenMelden(S.g, K) === true && Kreatur.ausgefallenMelden(S.g, K) === false && S.me_('kreaturAusgefallen').length === 1, 'verwundet: genau eine Meldung, der zweite Aufruf meldet nichts');
  const [W] = rudel(S, 'w', 1, 'gelaende');
  W.alive = false; W.zustand = 'verwundet'; W.weg = true;
  ok(Kreatur.ausgefallenMelden(S.g, W) === false && Kreatur.ausgefallenMelden(S.g, null) === false && Kreatur.ausgefallenMelden(S.g, { alive: false, zustand: 'verwundet' }) === false, 'aufgelöst (weg), null und Nicht-Kreaturen: keine Meldung');
  ok(Kreatur.nichtEndgueltigErledigt({ alive: true }) === true && Kreatur.nichtEndgueltigErledigt({ alive: false, zustand: 'bewusstlos' }) === true && Kreatur.nichtEndgueltigErledigt({ alive: false, zustand: 'verwundet' }) === false && Kreatur.nichtEndgueltigErledigt({ alive: false, zustand: 'aus' }) === false && Kreatur.nichtEndgueltigErledigt({ alive: true, weg: true }) === false, 'nichtEndgueltigErledigt exportiert: lebend und bewusstlos ja, verwundet, aus und aufgelöst nein');
});

// ---------- Räumen ----------
section('Räumen: Szenario-Start (Graben, Wellen) räumt die Buchführung, dann nie erfüllt', () => {
  const S = szene('wueste', 101, 'mittel');
  const L = rudel(S, 'r', 2, 'gelaende');
  for (const K of L) toeten(S, K);
  ok(erledigt(S, { gruppe: 'r' }), 'Vorlage: Rudel erledigt');
  Kreatur.raeumen(S.aw);
  ok(!erledigt(S, { gruppe: 'r' }) && !erledigt(S, { typ: 'rudeltier' }) && S.aw.kreaturGruppen === undefined, 'nach raeumen: nicht erfüllt (die Gruppe erschien auf der geräumten Karte nie)');
  const orig = combat.ensureV2;
  for (const [modus, opt] of [['arena_graben', {}], ['arena_away', { wellen: 'kesh' }]]) {
    let gepflanzt = 0;
    combat.ensureV2 = function (game, aw) { const r = orig.apply(this, arguments); if (aw && !gepflanzt) { aw.kreaturen = [{ id: 'KX', kind: 'kreatur', kreatur: true, typ: 'rudeltier', gruppe: 'a', alive: false, zustand: 'verwundet', x: 100, y: 100 }]; aw.kreaturGruppen = { a: { erschienen: 1, typ: 'rudeltier' } }; gepflanzt = 1; } return r; };
    try {
      const g = new Game({ noStore: true, seed: 13, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
      const c = { inbox: [], send(m) { if (this.inbox.length < 500) this.inbox.push(m); } };
      g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'Z0', name: 'Z0', color: 0 });
      g.handleMessage(c, { t: 'lobbyOpt', startMission: modus, ...opt }); g.handleMessage(c, { t: 'ready', ready: true });
      const aw = g.away;
      ok(gepflanzt === 1 && !!aw && Registry.get('kreaturen_erledigt').test(g.mission, { map: aw.map, gruppe: 'a' }) === false && aw.kreaturGruppen === undefined, modus + ': ein erledigtes Rudel vor dem Start gepflanzt, danach nicht erfüllt und Buchführung weg');
    } finally { combat.ensureV2 = orig; }
  }
});

// ---------- Gegenproben ----------
section('Gegenprobe: squad_cleared zählt Kreaturen nicht, Drohnen melden kein kreaturAusgefallen, Kreaturen keine Drohnen-Ereignisse', () => {
  const S = szene('wueste', 101, 'mittel');
  const L = rudel(S, 'r', 4, 'gelaende');
  const aw = S.aw;
  const d = squad.makeEnemy(S.g, aw, 'scavenger', 'D' + S.g.nextId(''), { x: 100, y: 100 }, 'test'); d.asleep = false; d.frozen = true; d.rolle = 'grundtyp'; aw.drones.push(d); combat.kaempfer(S.g, d);
  aw.spawned = aw.spawned || {}; aw.spawned.sq = true; d.squad = 'sq';
  ok(!chk(S, 'squad_cleared', { map: S.map, squad: 'sq' }), 'Drohne des Trupps lebt: squad_cleared nicht erfüllt');
  for (let i = 0; i < 20 && d.alive; i++) combat.hitEnemy(S.g, d, 1, {});
  ok(!d.alive && chk(S, 'squad_cleared', { map: S.map, squad: 'sq' }), 'Drohne tot, vier Kreaturen leben: squad_cleared erfüllt (Kreaturen zählen nicht mit)');
  ok(S.me_('kreaturAusgefallen').length === 0 && S.ev_('kreaturAusgefallen').length === 0 && S.me_('droneKilled').length >= 1, 'die gefallene Drohne meldet droneKilled (' + S.me_('droneKilled').length + '), kein kreaturAusgefallen');
  ok(!erledigt(S, { gruppe: 'r' }), 'umgekehrt: squad_cleared erfüllt, kreaturen_erledigt nicht');
  S.me.length = 0; S.ev.length = 0;
  const trupps0 = JSON.stringify(Object.keys(aw.squads)), drohnen0 = aw.drones.length;
  for (const K of L) toeten(S, K);
  ok(erledigt(S, { gruppe: 'r' }), 'Rudel tot: erfüllt');
  ok(S.me_('droneKilled').length === 0 && S.me_('enemyUp').length === 0 && S.me_('enemyDown').length === 0 && S.me_('squadSpawn').length === 0, 'Kreaturen lösen kein droneKilled, enemyUp, enemyDown (Missionsereignis) oder squadSpawn aus');
  ok(S.ev_('enemyDown').length === 4 && S.ev_('wardenDown').length === 0, 'das Spielereignis enemyDown (Anzeige) bleibt wie bisher: 4 Fälle, 4 Ereignisse');
  ok(JSON.stringify(Object.keys(aw.squads)) === trupps0 && aw.drones.length === drohnen0 && aw.drones.every((e) => !e.kreatur), 'kein Phantom-Trupp (aw.squads unverändert ' + trupps0 + ' durch die Kreaturen-Fälle), keine Kreatur in aw.drones');
  ok(S.g.errors === 0, 'g.errors 0');
});

section('Gegenprobe: Wellen, Graben und Bodenkampf kennen Kreaturen nur beim Räumen', () => {
  const dir = path.join(__dirname, '..', 'server');
  const dateien = ['sim/wellen.js', 'sim/graben.js', 'mission/bausteine/bodenkampf.js', 'sim/endkampf.js'];
  for (const f of dateien) {
    const zeilen = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter((l) => /kreatur/i.test(l.replace(/\/\/.*$/, '')));
    ok(zeilen.every((l) => /kreatur\.js'\)\.raeumen\(aw\)/.test(l)), f + ': Kreaturen nur über raeumen (' + zeilen.length + ' Zeile(n))');
  }
  const reg = fs.readFileSync(path.join(dir, 'mission', 'registry.js'), 'utf8');
  ok(!/kreatur/i.test(reg.replace(/\/\/.*$/gm, '')), 'registry.js (squad_cleared) ohne Kreaturenbezug');
});

section('Kein Typname im Servercode', () => {
  const namen = ['rudeltier', 'kreatur.rudeltier'];
  const dateien = [];
  const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) geh(p); else if (e.name.endsWith('.js')) dateien.push(p); } };
  geh(path.join(__dirname, '..', 'server'));
  const treffer = [];
  for (const f of dateien) { const text = fs.readFileSync(f, 'utf8'); for (const nm of namen) if (new RegExp('[\'"`]' + nm.replace('.', '\\.') + '[\'"`]|\\.' + nm.replace('.', '\\.') + '\\b').test(text)) treffer.push(path.relative(path.join(__dirname, '..'), f) + ' ~ ' + nm); }
  ok(dateien.length > 50 && treffer.length === 0, 'kein Typname im server/ (' + dateien.length + ' Dateien)' + (treffer.length ? ': ' + treffer.join('; ') : ''));
  const reg = fs.readFileSync(path.join(__dirname, '..', 'server', 'mission', 'bausteine', 'kreaturen.js'), 'utf8');
  ok(!/rudeltier|probe/i.test(reg.replace(/\/\/.*$/gm, '')), 'das Plugin kreaturen.js enthält keinen Typnamen im Code');
});

delete KREATUREN.typen.mitbindung;
console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
