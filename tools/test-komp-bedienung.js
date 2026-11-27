'use strict';
// TEC-01 B2: Bedienung der Komponentenwahl: Lesepunkt shared/komponenten-format.js (Dekodierer, Zielwahl als reine Funktionen) und Protokoll (act/repair.start mit komp).
//   node tools/test-komp-bedienung.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const KF = require('../shared/komponenten-format.js');
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const K = require('../server/sim/komponenten.js');
const WORLD = require('../server/world.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } }
const KD = CONFIG.systemModell.komponenten;
const DT = 1 / CONFIG.tickHz;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

section('Dekodierer: alle Codes, Zähler, Altformat', () => {
  ok(eq(KF.dekodiere('odg', ['K', 'S', 'R']), [{ t: 'K', z: 'ok', n: 0, sp: 0 }, { t: 'S', z: 'defekt', n: 0, sp: 0 }, { t: 'R', z: 'geflickt', n: 0, sp: 0 }]), 'o/d/g in Rezeptreihenfolge, Zähler 0 ohne Zählerteil');
  ok(eq(KF.dekodiere('ood;0,1,2;0,3,0', ['K', 'S', 'R']).map((k) => [k.t, k.z, k.n, k.sp]), [['K', 'ok', 0, 0], ['S', 'ok', 1, 3], ['R', 'defekt', 2, 0]]), 'Zählerteil: Ausfall- und Sprungzähler je Komponente');
  ok(KF.dekodiere('o-g', ['K', 'S', 'R'])[1].z === null, "'-' = unbekannt (z null)");
  ok(KF.dekodiere('od', ['K', 'S', 'R']) === null && KF.dekodiere('odgx', ['K', 'S', 'R']) === null && KF.dekodiere('oxg', ['K', 'S', 'R']) === null && KF.dekodiere(null, ['K']) === null && KF.dekodiere('o', null) === null, 'falsche Länge, unbekannter Code, kein Text, kein Rezept: null');
  ok(eq(KF.dekodiere('od;1;2', ['R', 'L']).map((k) => [k.n, k.sp]), [[0, 0], [0, 0]]), 'Zähler mit falscher Länge: alle 0 (wie der Server)');
  ok(KF.dekodiere('od;99999,-3;x,1', ['R', 'L']).map((k) => k.n + '/' + k.sp).join() === '9999/0,0/1', 'Zähler begrenzt (0..9999), Müll = 0');
  ok(eq(KF.rezeptVon(KD, 'shields'), ['K', 'S', 'R']) && eq(KF.rezeptVon(KD, 'emitter_aft'), ['R', 'L']) && KF.rezeptVon(KD, 'reactor') === null && KF.rezeptVon(null, 'shields') === null, 'rezeptVon: Schilde K,S,R; Emitter R,L; Reaktor keins');
  ok(KF.name('K') === 'Steuerkern' && KF.name('S') === 'Spannungsregler' && KF.name('R') === 'Relais' && KF.name('L') === 'Leitung' && KF.name('Q') === 'Q', 'Namen der Typen');
  ok(KF.sperreVon(KD) === 3 && KF.sperreVon({ ausfallSperre: 5 }) === 5 && KF.sperreVon({ ausfallSperre: 0 }) === 3, 'Ausfallsperre aus den Daten, Standard 3');
  // Altformat: kein Text im Snapshot -> Systemzustand gilt
  const st = (komp, systems) => ({ ship: { komp, systems } });
  ok(eq(KF.liste(st(undefined, { shields: 'ok' }), KD, 'shields').map((k) => k.z), ['ok', 'ok', 'ok']), 'Altformat: kein ship.komp, System ok = alles ok');
  ok(eq(KF.liste(st(undefined, { shields: 'damaged' }), KD, 'shields').map((k) => k.z), ['ok', 'ok', 'defekt']), 'Altformat: damaged = letzte Komponente defekt (wie erzeugeAusZustand)');
  ok(eq(KF.liste(st(undefined, { emitter_bow: 'broken' }), KD, 'emitter_bow').map((k) => k.z), ['defekt', 'defekt']), 'Altformat: broken = die letzten zwei defekt');
  ok(eq(KF.liste(st({ shields: 'odo' }, { shields: 'damaged' }), KD, 'shields').map((k) => k.z), ['ok', 'defekt', 'ok']), 'Text im Snapshot hat Vorrang vor dem Systemzustand');
  ok(KF.liste(st({}, { reactor: 'damaged' }), KD, 'reactor') === null, 'System ohne Rezept: null');
  ok(eq(KF.liste(st({ shields: 'o-d;0,2,0;0,0,0' }, { shields: 'damaged' }), KD, 'shields').map((k) => k.z + k.n), ['ok0', 'ok2', 'defekt0']), "'-' im Text: Zustand aus dem Systemzustand, Zähler aus dem Text");
  ok(eq(KF.liste(st({ shields: 'kaputt' }, { shields: 'ok' }), KD, 'shields').map((k) => k.z), ['ok', 'ok', 'ok']), 'unlesbarer Text: Rückfall auf den Systemzustand, kein Absturz');
  // Gegenprobe mit dem Server (Doppelung bis zur Umstellung von komponenten.js): derselbe Text -> dieselbe Liste
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  I.integritaetVoll(g); K.konsistentAlle(g);
  let gleich = true, texte = [];
  for (const [sys, t] of [['shields', 'odg;1,0,2;0,3,0'], ['shields', 'ddo'], ['emitter_port', 'go;0,0;4,0'], ['emitter_stbd', 'od']]) {
    const a = K.dekodiere(g, sys, t), b = KF.dekodiere(t, KF.rezeptVon(KD, sys));
    if (!eq(a, b)) { gleich = false; texte.push(sys + ':' + t); }
  }
  ok(gleich, 'Dekodierer == server/sim/komponenten.dekodiere für Beispieltexte ' + texte.join(' '));
  // und Snapshot-Text aus dem Server kommt gleich an
  K.erzeugeAusZustand(g, 'shields'); g.ship.komp.shields[1].z = 'defekt'; g.ship.komp.shields[2].z = 'geflickt'; g.ship.komp.shields[2].n = 2; K.synchronisieren(g, 'shields');
  const sn = g.snapshot();
  const li = KF.liste(sn, KD, 'shields');
  ok(sn.ship.komp && sn.ship.komp.shields && eq(li.map((k) => k.z + k.n), ['ok0', 'defekt0', 'geflickt2']), 'Server-Snapshot ship.komp.shields wird vom Lesepunkt richtig gelesen: ' + (sn.ship.komp && sn.ship.komp.shields));
});

section('Zielwahl: zulässige Ziele je Aktion (reine Funktion)', () => {
  const S = (c) => KF.dekodiere(c, ['K', 'S', 'R']);
  const E = (c) => KF.dekodiere(c, ['R', 'L']);
  ok(eq(KF.zulaessigeZiele(S('ddo'), 'flick'), ['K', 'S']) && eq(KF.zulaessigeZiele(S('ogd'), 'flick'), ['R']), 'flick: nur defekte, Rezeptreihenfolge');
  ok(eq(KF.zulaessigeZiele(S('ooo'), 'flick'), []) && eq(KF.zulaessigeZiele(S('ggo'), 'flick'), []), 'flick: nichts defekt (auch nicht geflickt) = keine Ziele');
  ok(eq(KF.zulaessigeZiele(S('gdo'), 'swap'), ['S', 'K']), 'swap: defekte zuerst, dann geflickte (K geflickt, S defekt: S, K)');
  ok(eq(KF.zulaessigeZiele(S('gdg'), 'swap'), ['S', 'K', 'R']) && eq(KF.zulaessigeZiele(S('ooo'), 'swap'), []), 'swap: alle nicht heilen; alles heil = keine');
  ok(eq(KF.zulaessigeZiele(S('ddd'), 'minigame'), ['R']) && eq(KF.zulaessigeZiele(S('ddo'), 'minigame'), []) && eq(KF.zulaessigeZiele(S('ood'), 'minigame'), ['R']), 'minigame: nur das Relais, nur wenn nicht heil');
  ok(eq(KF.zulaessigeZiele(S('oog'), 'minigame'), ['R']), 'minigame: auch ein geflicktes Relais');
  ok(eq(KF.zulaessigeZiele(E('do'), 'minigame'), ['R']) && eq(KF.zulaessigeZiele(E('od'), 'minigame'), []), 'Emitter: Minispiel nur bei defektem Relais, Leitung hat keins');
  ok(eq(KF.zulaessigeZiele(E('dd'), 'flick'), ['R', 'L']) && eq(KF.zulaessigeZiele(E('og'), 'swap'), ['L']), 'Emitter R,L: flick/swap');
  const R3 = KF.dekodiere('ood;0,0,3;0,0,0', ['K', 'S', 'R']);
  ok(eq(KF.zulaessigeZiele(R3, 'minigame', 3), []) && eq(KF.zulaessigeZiele(R3, 'minigame', 4), ['R']) && eq(KF.zulaessigeZiele(R3, 'flick', 3), ['R']) && eq(KF.zulaessigeZiele(R3, 'swap', 3), ['R']), 'Relais n >= Sperre: kein Minispiel, Flicken und Tausch bleiben');
  const R2 = KF.dekodiere('ood;0,0,2;0,0,0', ['K', 'S', 'R']);
  ok(eq(KF.zulaessigeZiele(R2, 'minigame', 3), ['R']), 'Relais n = 2 (< 3): Minispiel zulässig');
  ok(eq(KF.zulaessigeZiele(S('ddo'), 'unbekannt'), []) && eq(KF.zulaessigeZiele(null, 'flick'), []), 'unbekannte Aktion / keine Liste: leer');
  ok(KF.aktionFuerHand('ersatzteil') === 'swap' && KF.aktionFuerHand(null) === 'flick' && KF.aktionFuerHand('loeschgel') === 'flick', 'Ersatzteil in der Hand = Tausch, sonst Flicken');
});

section('Zielwahl: Standard, Wechsel, Rückfall', () => {
  const S = (c) => KF.dekodiere(c, ['K', 'S', 'R']);
  ok(KF.standardZiel(S('ddo'), 'flick') === 'K' && KF.standardZiel(S('odd'), 'flick') === 'S' && KF.standardZiel(S('ooo'), 'flick') === null, 'Standard flick: erste defekte (wie der Server)');
  ok(KF.standardZiel(S('gdo'), 'swap') === 'S' && KF.standardZiel(S('ggo'), 'swap') === 'K', 'Standard swap: erste defekte, sonst erste geflickte (wie der Server)');
  ok(KF.zielWahl(S('ddo'), 'flick', 'S') === 'S' && KF.zielWahl(S('ddo'), 'flick', null) === 'K', 'gewähltes zulässiges Ziel bleibt, sonst Standard');
  ok(KF.zielWahl(S('ddo'), 'flick', 'R') === 'K', 'Rückfall: gewähltes Ziel nicht (mehr) defekt -> Standard');
  ok(KF.zielWahl(S('ddo'), 'flick', 'X') === 'K' && KF.zielWahl(S('ooo'), 'flick', 'K') === null, 'Müll-Wahl -> Standard; nichts zulässig -> null');
  // Wechsel
  let w = null; const folge = [];
  for (let i = 0; i < 4; i++) { w = KF.naechstesZiel(S('ddo'), 'flick', w); folge.push(w); }
  ok(eq(folge, ['S', 'K', 'S', 'K']), 'Wechsel rund herum (Start auf Standard K: S, K, S, K): ' + folge);
  w = null; const f3 = [];
  for (let i = 0; i < 4; i++) { w = KF.naechstesZiel(S('ddd'), 'swap', w); f3.push(w); }
  ok(eq(f3, ['S', 'R', 'K', 'S']), 'Wechsel bei drei defekten (Tausch): Rezeptreihenfolge ab Standard K: ' + f3);
  ok(KF.naechstesZiel(S('odo'), 'flick', null) === 'S' && KF.naechstesZiel(S('ooo'), 'flick', null) === null, 'ein Ziel: Wechsel bleibt dort; keines: null');
  ok(KF.naechstesZiel(S('ddo'), 'flick', 'R') === 'S', 'Wechsel aus unzulässiger Wahl rechnet vom Standard aus');
  // Bedienung (was E/R/Q jetzt anbieten)
  let b = KF.bedienung(S('dgd'), null, null);
  ok(b.aktion === 'flick' && b.ziel === 'K' && b.anzahl === 2 && b.minispiel === true && eq(b.geflickt, ['S']), 'bedienung: Flicken, Ziel K (erste defekte), zwei Ziele, Relais-Minispiel, S geflickt');
  b = KF.bedienung(S('dgd'), 'ersatzteil', 'S');
  ok(b.aktion === 'swap' && b.ziel === 'S' && b.anzahl === 3, 'bedienung mit Ersatzteil: Tausch, gewähltes S (geflickt) zulässig, drei Ziele');
  b = KF.bedienung(S('ggo'), null, null);
  ok(b.ziel === null && b.anzahl === 0 && b.minispiel === false && eq(b.geflickt, ['K', 'S']), 'bedienung: nur Flicken vorhanden, nichts zu flicken: ziel null (Hinweis "geflickt")');
  b = KF.bedienung(KF.dekodiere('od;0,0;0,0', ['R', 'L']), null, null);
  ok(b.ziel === 'L' && b.anzahl === 1 && b.minispiel === false, 'bedienung Emitter: Leitung defekt, Relais heil: kein Minispiel, ein Ziel');
  b = KF.bedienung(KF.dekodiere('do;3,0;0,0', ['R', 'L']), null, null, 3);
  ok(b.ziel === 'R' && b.minispiel === false, 'bedienung Emitter: Relais verschlissen (n 3): Flicken ja, Minispiel nein');
});

section('Protokoll: normKomp, act/repair.start mit komp bis in den Hold', () => {
  ok(Protocol.normKomp('K') === 'K' && Protocol.normKomp('S') === 'S' && Protocol.normKomp('R') === 'R' && Protocol.normKomp('L') === 'L', 'normKomp lässt die vier Arten durch');
  ok([undefined, null, 5, 'k', 'KS', '', {}, ['K'], true].every((v) => Protocol.normKomp(v) === undefined), 'normKomp: alles andere = kein Wunsch');
  ok(eq(Protocol.KOMP_ARTEN, ['K', 'S', 'R', 'L']) && Object.keys(KD.rezepte).every((r) => KD.rezepte[r].every((t) => Protocol.KOMP_ARTEN.includes(t))), 'KOMP_ARTEN deckt alle Rezeptarten ab');
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'freie_fahrt' }); g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  run(1); g.space.enemies = []; g.space.projectiles = [];
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {}; g.ship.repairQueue = []; I.integritaetVoll(g); K.neuAufstellen(g); g.god = false;
  const notices = []; const notice0 = g.notice.bind(g); g.notice = (pp, m) => { notices.push(m); return notice0(pp, m); };
  const p = g.players[0];
  const ankern = (sys) => { const st = WORLD.STATIONS.find((s) => s.system === sys); const ce = WORLD.tileCenter(st.x, st.y); p.x = ce.x; p.y = ce.y; p.zone = 'ship'; p.console = null; p.hold = null; p.moving = false; p.carry = null; };
  const setz = (sys, codes) => { K.erzeugeAusZustand(g, sys); codes.split('').forEach((ch, i) => { g.ship.komp[sys][i].z = { o: 'ok', d: 'defekt', g: 'geflickt' }[ch]; }); K.synchronisieren(g, sys); };
  const send = (m) => g.handleMessage(c, m);
  const aktion = () => (g.snapshot().players.find((q) => q.id === p.id) || {}).action;
  // act mit komp
  ankern('shields'); setz('shields', 'ddo');
  send({ t: 'act', down: true, komp: 'S' }); run(0.2);
  ok(p.hold && p.hold.kind === 'flick' && p.hold.komp === 'S', 'act { komp: S } bei K und S defekt: der Hold trägt S');
  ok(aktion() && aktion().kind === 'flick' && aktion().komp === 'S' && aktion().system === 'shields', 'Snapshot players[].action trägt komp S: ' + JSON.stringify(aktion()));
  run(1.6); send({ t: 'act', down: false });
  ok(K.kodiere(g, 'shields') === 'dgo' && !p.hold, 'nach dem Halten ist genau S geflickt (dgo)');
  // ohne komp: Standard
  ankern('shields'); setz('shields', 'ddo');
  send({ t: 'act', down: true }); run(0.2);
  ok(p.hold && p.hold.komp === 'K' && aktion().komp === 'K', 'act ohne komp: Standard = erste defekte (K)');
  send({ t: 'act', down: false });
  // Müll-Wunsch
  ankern('shields'); setz('shields', 'ddo');
  send({ t: 'act', down: true, komp: 'Z' }); run(0.1);
  ok(p.hold && p.hold.komp === 'K', "act { komp: 'Z' } (unbekannt): zählt als kein Wunsch, Standard K");
  send({ t: 'act', down: false });
  ankern('shields'); setz('shields', 'ddo'); send({ t: 'act', down: true, komp: { x: 1 } }); run(0.1);
  ok(p.hold && p.hold.komp === 'K', 'act { komp: Objekt }: kein Wunsch, kein Absturz');
  send({ t: 'act', down: false });
  // unzulässiges Ziel: Hinweis, kein Halten
  ankern('shields'); setz('shields', 'ddo'); notices.length = 0;
  send({ t: 'act', down: true, komp: 'R' }); run(0.1);
  ok(!p.hold && notices.some((t) => /Relais ist nicht defekt/.test(t)), 'act { komp: R } bei heilem Relais: kein Hold, Hinweis als notice: ' + notices.join('|'));
  // Tausch mit Ersatzteil
  ankern('shields'); setz('shields', 'gdo'); p.carry = 'ersatzteil'; g.inventory.ersatzteil = Math.max(1, g.inventory.ersatzteil | 0);
  send({ t: 'act', down: true, komp: 'K' }); run(0.2);
  ok(p.hold && p.hold.kind === 'swap' && p.hold.komp === 'K' && aktion().komp === 'K', 'act { komp: K } mit Ersatzteil: Tausch der geflickten K (nicht der defekten S)');
  send({ t: 'act', down: false });
  // repair.start mit komp
  ankern('emitter_bow'); setz('emitter_bow', 'dd'); notices.length = 0;
  send({ t: 'cmd', c: 'repair.start', system: 'emitter_bow', komp: 'R' });
  ok(p.hold && p.hold.kind === 'minigame' && p.hold.komp === 'R' && aktion().komp === 'R', 'repair.start { komp: R }: Minispiel am Relais, Snapshot trägt komp R');
  send({ t: 'cmd', c: 'repair.cancel', system: 'emitter_bow' });
  ankern('emitter_bow'); setz('emitter_bow', 'dd'); notices.length = 0;
  send({ t: 'cmd', c: 'repair.start', system: 'emitter_bow', komp: 'L' }); run(0.1);
  ok(!p.hold && notices.some((t) => /Leitung hat kein Minispiel/.test(t)), 'repair.start { komp: L }: kein Minispiel, Servertext als notice: ' + notices.join('|'));
  ankern('emitter_bow'); setz('emitter_bow', 'od'); notices.length = 0;
  send({ t: 'cmd', c: 'repair.start', system: 'emitter_bow' }); run(0.1);
  ok(!p.hold && notices.some((t) => /Relais ist heil/.test(t)), 'repair.start bei heilem Relais (Leitung defekt): Hinweis „Relais ist heil“, kein Minispiel: ' + notices.join('|'));
  ankern('emitter_bow'); setz('emitter_bow', 'do'); g.ship.komp.emitter_bow[0].n = 3; notices.length = 0;
  send({ t: 'cmd', c: 'repair.start', system: 'emitter_bow' }); run(0.1);
  ok(!p.hold && notices.some((t) => /verschlissen/.test(t)), 'repair.start bei verschlissenem Relais (n 3): Hinweis, kein Minispiel: ' + notices.join('|'));
  // Nicht-Schildkette bleibt unberührt: komp wird ignoriert, Hold ohne komp
  ankern('reactor'); g.ship.systems.reactor = 'damaged'; K.konsistentAlle(g);
  send({ t: 'act', down: true, komp: 'S' }); run(0.2);
  ok(p.hold && p.hold.komp === undefined && (aktion() || {}).komp === undefined, 'Nicht-Schildkette (Reaktor): komp im act ignoriert, kein komp im Hold und im Snapshot');
  send({ t: 'act', down: false });
  ankern('engines'); g.ship.systems.engines = 'damaged'; notices.length = 0;
  send({ t: 'cmd', c: 'repair.start', system: 'engines', komp: 'R' });
  ok(p.hold && p.hold.kind === 'minigame' && p.hold.komp === undefined, 'Nicht-Schildkette (Antrieb): Minispiel wie bisher, komp ignoriert');
  send({ t: 'cmd', c: 'repair.cancel', system: 'engines' });
});

console.log(`\n${n - fails}/${n} Prüfungen grün${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
