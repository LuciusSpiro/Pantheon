'use strict';
// LAD-01 Nacharbeit 1 (Review-Befunde 1 und 2, Testluecke 16c): Handel in der Kampagne Eisenwald. Seit LAD-01 D kauft jeder andockbare Hafen jede Ware. Der Sprengstoff der Kette (Kapitel 2 Konvoi-Beute, Kapitel 3/4 Ersatz-
// Zuteilung) traegt deshalb den Kampagnen-Tag (eig.auftrag = 'kampagne'): nicht verkaufbar (keine Marken-Spirale in k3/k4, kein Softlock der Abgabe in k2), aber von der Kampagnen-Abgabe angenommen.
//   Kapitel 2 echt gespielt (Konvoi, Beute, Verkaufsversuch an jedem Andockort, Abgabe an der Statio) · Beute per Skript-Abgabe · Kapitel 3/4: Zuteilung, Verkaufsversuch, keine Spirale ·
//   Quartiermeister (fremde Ware raeumt weichen, Faden-Ware nie, kein Absturz) · Weltstand traegt den Tag · Faden-Ware bleibt fuer die Kampagnen-Abgabe tabu
//   node tools/test-kampagne-handel.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const Fracht = require('../server/sim/fracht.js');
const Ladung = require('../server/sim/ladung.js');
const Konvoi = require('../server/sim/konvoi.js');
const Besitz = require('../server/sim/besitz.js');
const Testhilfe = require('./gegner-testhilfe.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) { console.log('\n' + name); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-kamp-handel-'));
let seq = 0;

function neuesSpiel() {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'eisenwald_ohne' });
  g.handleMessage(c, { t: 'ready', ready: true });
  const T = { g, c };
  T.run = (sek) => { for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) g.step(); };
  T.cmd = (cmd, f) => { c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.run(0.5); g.god = true; g.players[0].console = 'weapons';
  return T;
}
const marks = (g) => g.inventory.marks;
const platz = (g, x, y) => { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.turnVel = 0; };
// Verkaufsversuch auf jedem Weg: Befehl (Ops), Start, und der Abschluss selbst (auch ohne Halteprozess). -> true, wenn NICHTS verkauft wurde
function verkaufVersuch(T) {
  const g = T.g; const m0 = marks(g); const vor = JSON.stringify(g.fracht.lager);
  const k0 = Ladung.verkauft(g);
  const err = T.cmd('weapons.verkaufen');
  T.run(3.6);
  const st = Ladung.verkaufStart(g, null);
  T.run(3.6);
  Ladung.verkaufFertig(g);
  return marks(g) === m0 && JSON.stringify(g.fracht.lager) === vor && Ladung.verkauft(g) === k0 && !g.fracht.halt && (typeof st === 'string' || st == null) && err !== undefined;
}
// alle Orte, an denen die Lerche andocken kann (Besitz.dockbar), samt Szene
const Sektoren = require('../shared/sektoren.js');
const andockOrte = (g) => Array.from(new Set(Locations.LOCATIONS.map((l) => l.id).concat(Sektoren.datenOrte()))).filter((id) => { const l = Locations.get(id); return l && l.scene && Besitz.dockbar(g, id); });

section('Kapitel 2 echt: Konvoi am Rabenpass, Beute tragen den Kampagnen-Tag, kein Verkauf, Abgabe klappt', () => {
  const T = neuesSpiel(); const g = T.g; const m = g.mission;
  m.kette.einstieg('k2_konvoi'); T.run(5);
  g.debugGoto('rabenpass', false); T.run(1);
  ok(m.state.stage === 'konvoi' && Konvoi.aktiv(g), 'Konvoi-Szene läuft (' + m.state.stage + ')');
  g.space.enemies.filter((e) => e.kind !== 'frachter').forEach((e) => { e.hp = 0; }); g.space.enemies = g.space.enemies.filter((e) => e.kind === 'frachter');
  platz(g, 300, 300);
  for (const e of Konvoi.transporter(g)) Testhilfe.toeten(g, e, { von: [e.x - 30, e.y] });
  T.run(0.3);
  ok(Fracht.draussen(g).length === 2 && Fracht.draussen(g).every((d) => d.art === 'sprengstoff' && d.eig && d.eig.auftrag === Fracht.KAMPAGNE), 'zwei Beute-Pods mit Tag ' + Fracht.KAMPAGNE + ': ' + JSON.stringify(Fracht.draussen(g).map((d) => d.eig)));
  for (let i = 0; i < 2; i++) { const d = Fracht.draussen(g)[0]; if (!d) break; platz(g, d.x - 100, d.y); T.cmd('weapons.fracht'); T.run(3.3); }
  ok(Fracht.anBord(g, 'sprengstoff') === 2 && g.fracht.lager.every((l) => l.eig && l.eig.auftrag === Fracht.KAMPAGNE), 'beide Ladungen an Bord, mit Tag (Typ-Regel und Eigenschaft beim Beamen)');
  T.run(0.5);
  ok(m.state.stage === 'rueck_anflug' && m.flags.konvoi_gepluendert === true, 'Ausgang gepluendert: weiter zur Abgabe (' + m.state.stage + ')');
  const sn = g.snapshot().fracht;
  ok(JSON.stringify(sn.lager) === '["sprengstoff","sprengstoff"]' && sn.le.every((b) => (b & 4) === 4), 'Snapshot: Auftragsmarke (Bit 4) an beiden Ladungen');

  // Verkaufsversuch an jedem Ort, an dem die Lerche andocken kann (auch unterwegs, ohne Docken, in Reichweite)
  const orte = andockOrte(g);
  ok(orte.includes('statio_limitis') && orte.includes('castra_martis') && orte.length >= 4, 'Andockorte gefunden (' + orte.join(',') + ', u. a. Statio Limitis und Castra Martis)');
  const S = require('../server/sim/space.js');
  let abgelehnt = 0, probiert = 0;
  for (const id of orte) {
    S.enterScene(g, id, {}); g.space.enemies = [];
    const l = Locations.get(id); const sc = l.scene; const ref = sc.station || sc.dock;
    for (const docked of [true, false]) {
      Object.assign(g.ship, { vx: 0, vy: 0, speed: 0, docked, dockedAt: docked ? id : null });
      if (!docked && ref) platz(g, ref.x + 50, ref.y);
      probiert++;
      const vk = Ladung.verkaufOrt(g);
      if (!vk.ok && vk.code === 2 && verkaufVersuch(T) && g.snapshot().fracht.vk == null && g.snapshot().fracht.vg === 2) abgelehnt++;
    }
  }
  ok(abgelehnt === probiert, 'Verkauf an allen ' + orte.length + ' Andockorten (angedockt und in Reichweite) abgelehnt: Code 2 (Auftragsware), Marken und Lager unverändert (' + abgelehnt + '/' + probiert + ')');
  ok(Fracht.anBord(g, 'sprengstoff') === 2 && Ladung.verkauft(g) === 0, 'Beute nach allen Versuchen vollständig an Bord');

  // Die Kampagnen-Abgabe (Ops-Beamen an der Statio) nimmt sie an
  g.debugGoto('statio_limitis', true); T.run(0.5);
  ok(m.state.stage === 'abgabe', 'Schritt abgabe an der Statio Limitis (' + m.state.stage + ')');
  ok(Fracht.ablieferOrt(g).ok && g.snapshot().fracht.ab === 1, 'Abgabe möglich (ab = 1)');
  const e = T.cmd('weapons.abliefern'); T.run(3.6);
  ok(!e.length && Fracht.abgeliefert(g, 'sprengstoff') === 2, 'Ops-Abgabe: beide Ladungen abgegeben (' + Fracht.abgeliefert(g, 'sprengstoff') + ')');
  T.run(1);
  ok(g.mission.activeId === 'k3_nebelheim', 'Kapitel 2 abgeschlossen, Kapitel 3 aktiv (' + g.mission.activeId + ')');
  ok(Fracht.anBord(g, 'sprengstoff') === 1 && g.fracht.lager[0].eig && g.fracht.lager[0].eig.auftrag === Fracht.KAMPAGNE, 'Mars lässt eine Ladung an Bord, ebenfalls mit Tag');
  g.releaseWorldLock();
});

section('Kapitel 2: Beute verkauft ist unmöglich, Abgabe per Skript (fracht_abliefern, fracht_abliefern_bis) nimmt Kampagnen-Ware', () => {
  const T = neuesSpiel(); const g = T.g;
  Fracht.restore(g, []);
  Fracht.zuteilen(g, 'sprengstoff'); Fracht.zuteilen(g, 'sprengstoff');
  ok(Fracht.anBord(g, 'sprengstoff') === 2 && verkaufVersuch(T), 'Zuteilung: zwei Ladungen, Verkaufsversuch ohne Wirkung');
  ok(Fracht.skriptAbliefern(g, 'sprengstoff', 1) === 1 && Fracht.anBord(g, 'sprengstoff') === 1 && Fracht.abgeliefert(g, 'sprengstoff') === 1, 'skriptAbliefern (fracht_abliefern) nimmt Kampagnen-Ware an');
  ok(Fracht.skriptAbliefernBis(g, 'sprengstoff', 2) === 0 && Fracht.abgeliefert(g, 'sprengstoff') === 2 && Fracht.anBord(g) === 0, 'skriptAbliefernBis (Skip-Ausweg): die letzte Ladung wird abgegeben, nichts fehlt, Frachtraum leer');
  Fracht.zuteilen(g, 'sprengstoff');
  ok(Fracht.skriptAbliefernBis(g, 'sprengstoff', 4) === 1 && Fracht.abgeliefert(g, 'sprengstoff') === 4 && Fracht.anBord(g) === 0, 'skriptAbliefernBis: eine Ladung abgegeben, die fehlende gutgeschrieben (min 4)');
  // Gegenprobe: gewöhnliche Ware ohne Tag lässt sich verkaufen (der Fix sperrt nur die Ware der Geschichte)
  const S = require('../server/sim/space.js');
  S.enterScene(g, 'statio_limitis', {}); Object.assign(g.ship, { vx: 0, vy: 0, speed: 0, docked: true, dockedAt: 'statio_limitis' });
  Fracht.restore(g, ['sprengstoff']);
  const vk = Ladung.verkaufOrt(g);
  ok(vk.ok && vk.summe > 0, 'Gegenprobe: Sprengstoff OHNE Tag (gekauft/gefunden) bleibt verkäuflich (' + vk.summe + ' Marken)');
  g.releaseWorldLock();
});

section('Kapitel 3 und 4: Ersatz-Sprengstoff an Statio Limitis und Castra Martis, keine Marken-Spirale', () => {
  for (const [kap, ort] of [['k3_nebelheim', 'statio_limitis'], ['k3_nebelheim', 'castra_martis'], ['k4_methalle', 'statio_limitis'], ['k4_methalle', 'castra_martis']]) {
    const T = neuesSpiel(); const g = T.g; const m = g.mission;
    m.kette.einstieg(kap); T.run(0.3);
    Fracht.restore(g, []);
    g.debugGoto(ort, true); g.missionEvent('docked', { loc: ort }); T.run(0.3);
    ok(Fracht.anBord(g, 'sprengstoff') === 1 && g.fracht.lager[0].eig.auftrag === Fracht.KAMPAGNE, `${kap}/${ort}: Andocken ohne Sprengstoff teilt eine Ladung zu, mit Tag`);
    const m0 = marks(g);
    let rund = 0;
    for (let i = 0; i < 4; i++) {
      const stumm = verkaufVersuch(T);   // der Versuch an jedem Weg
      Object.assign(g.ship, { docked: false, dockedAt: null }); T.run(0.2);
      g.debugGoto(ort, true); g.missionEvent('docked', { loc: ort }); T.run(0.3);   // ablegen und wieder andocken
      if (stumm && marks(g) === m0 && Fracht.anBord(g, 'sprengstoff') === 1) rund++;
    }
    ok(rund === 4 && marks(g) === m0, `${kap}/${ort}: vier Runden Verkaufsversuch, Ablegen, Andocken: Marken unverändert (${m0} -> ${marks(g)}), weiter genau 1 Sprengstoff`);
    ok((g.fracht.zugang.zuteilung || 0) === 1, `${kap}/${ort}: nur EINE Zuteilung insgesamt (Zugang zuteilung ${g.fracht.zugang.zuteilung})`);
    g.releaseWorldLock();
  }
  // Kapitel 4 braucht die Ware im Gepäck: die Abgabe an das Außenteam (fracht_abliefern art sprengstoff) nimmt die Kampagnen-Ware an
  const T = neuesSpiel(); const g = T.g;
  Fracht.restore(g, []); Fracht.zuteilen(g, 'sprengstoff');
  ok(Fracht.skriptAbliefern(g, 'sprengstoff', 1) === 1 && Fracht.anBord(g) === 0, 'k4: fracht_abliefern sprengstoff n 1 (Umladen ins Gepäck) nimmt die zugeteilte Ware');
  g.releaseWorldLock();
});

section('Quartiermeister und Kampagnen-Zuteilung: kein neuer Softlock', () => {
  const T = neuesSpiel(); const g = T.g;
  const nur = (arten) => { Fracht.restore(g, []); for (const a of arten) Fracht.anBordLegen(g, a); };
  // ein Frachtraum, gewöhnliche Fremdware (Deuterium aus dem Gasriesen): der Quartiermeister räumt, der Ersatz kommt
  nur(['deuterium', 'deuterium']);
  ok(Fracht.zuteilen(g, 'sprengstoff') && Fracht.anBord(g, 'sprengstoff') === 1 && Fracht.anBord(g, 'deuterium') === 0, 'gewöhnliche Fremdware im einzigen Modul: wird ausgeräumt, Ersatz-Sprengstoff kommt');
  // Fremdware der Kampagne selbst (Tag kampagne, z. B. Konvoi-Beute einer anderen Art): weicht ebenfalls
  Fracht.restore(g, []);
  Fracht.zuteilen(g, 'fracht');
  ok(Fracht.zuteilen(g, 'sprengstoff') && Fracht.anBord(g, 'sprengstoff') === 1 && Fracht.anBord(g, 'fracht') === 0, 'Kampagnen-Ware anderer Art weicht dem Ersatz (die Kette teilt selbst zu)');
  // Ware eines Fadens (fremder Auftrag) wird nie ausgeräumt; die Zuteilung scheitert mit Hinweis, nichts geht verloren, nichts stürzt ab
  Fracht.restore(g, []);
  Fracht.lagerAufnehmen(g, { art: 'waffen', quelle: 'faden', eigenschaften: { auftrag: 'faden_x' } });
  const odas = []; const o0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(t); return o0(t, x); };
  const geklappt = Fracht.zuteilen(g, 'sprengstoff');
  ok(!geklappt && Fracht.anBord(g, 'waffen') === 1 && Fracht.anBord(g, 'sprengstoff') === 0 && odas.some((t) => /Frachtraum/.test(t)), 'Faden-Ware im einzigen Modul bleibt: Zuteilung abgelehnt mit Hinweis (' + (odas[0] || '') + '), Ware unberührt');
  // ... und mit einem zweiten Frachtraum ist der Ersatz kein Problem
  g.releaseWorldLock();
});

section('Faden-Ware bleibt für die Kampagnen-Abgabe tabu, Kampagnen-Tag im Weltstand', () => {
  const T = neuesSpiel(); const g = T.g;
  Fracht.restore(g, []);
  Fracht.lagerAufnehmen(g, { art: 'sprengstoff', quelle: 'faden', eigenschaften: { auftrag: 'faden_y' } });
  ok(Fracht.skriptAbliefern(g, 'sprengstoff', null) === 0 && Fracht.anBord(g, 'sprengstoff') === 1, 'skriptAbliefern lässt Ware mit Faden-Tag an Bord');
  ok(!Fracht.ablieferOrt(g).ok && /Auftraggeber/.test(Fracht.ablieferOrt(g).reason), 'Ops-Abgabe lehnt Faden-Ware ab (' + Fracht.ablieferOrt(g).reason + ')');
  Fracht.restore(g, []); Fracht.zuteilen(g, 'sprengstoff');
  const art = Fracht.toSave(g), eig = Fracht.toSaveEig(g);
  ok(JSON.stringify(art) === '["sprengstoff"]' && eig && eig[0].auftrag === Fracht.KAMPAGNE, 'Weltstand: Ladung und Kampagnen-Tag werden gespeichert (' + JSON.stringify(eig) + ')');
  const R = new Game({ noStore: true, seed: 3, log: () => {} }); Fracht.restore(R, art, eig);
  ok(R.fracht.lager.length === 1 && R.fracht.lager[0].eig.auftrag === Fracht.KAMPAGNE, 'Laden: der Tag bleibt (nach dem Laden weiter unverkäuflich)');
  // Regiebuch/Spielleiter: fracht_zuteilen mit optionalen Eigenschaften und jeder Warenart aus waren.json
  const Registry = require('../server/mission/registry.js');
  const def = Registry.get('fracht_zuteilen');
  ok(def.params.art.werte.includes('waffen') && def.params.art.werte.includes('hilfsgueter') && def.params.getarnt.werte.includes('erz') && !!def.params.illegal && !!def.params.auftrag, 'Baustein fracht_zuteilen: alle Warenarten aus waren.json und die Eigenschaften illegal, getarnt, auftrag');
  Fracht.restore(g, []);
  ok(Fracht.zuteilen(g, 'waffen', { illegal: true, getarnt: 'fracht' }) && g.fracht.lager[0].eig.illegal === true && g.fracht.lager[0].eig.getarnt === 'fracht' && g.fracht.lager[0].eig.auftrag === Fracht.KAMPAGNE, 'Zuteilung mit Eigenschaften (illegal, getarnt) über die eine Einlagerung, Kampagnen-Tag bleibt');
  ok(!Fracht.zuteilen(g, 'waffen', { getarnt: 'waffen' }), 'ungültige Eigenschaft (Tarnung = eigene Art) wird abgelehnt, nichts eingelagert');
  g.releaseWorldLock();
});

console.log('\n' + (n - fails) + '/' + n + ' Prüfungen ok' + (fails ? ' – ' + fails + ' FEHLER' : ''));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
