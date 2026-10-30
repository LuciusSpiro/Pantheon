'use strict';
// BOD-01 P4: Szenario Grabenangriff (Lobby-Modus arena_graben, server/sim/graben.js). Headless, echtes Szenario (keine Attrappen):
//  - Lobby: Modus neben Wellen Boden, Variantenliste aus den Kartendaten (gen-fest varianten), Wahl je Abschnitt, ungültige Wahl abgelehnt
//  - Start: Rüstphase (Crew bleibt an Bord, „Szene starten“ am Terminal), dann beamt die Crew am Abholpunkt links hinunter; ohne Rüstphase gleich
//  - Aufstellung: Welle 1 im Graben/auf den Posten, Welle 2 im Wald/am Eingang, ALLE von Beginn an, kein Nachspawn; 6/9/12 Gegner für 1/2/3 Spieler
//  - Rom: Fraktion, Palette, Namen und Funk römisch (kein Karl, Bolzer, …); Rollenmix mit Grenadier und Schütze
//  - Ziel: vor dem Sieg über Welle 2 gesperrt und wirkungslos, danach erreichbar (3 s halten); Hochbeamen nach dem Ziel = Sieg, davor kein Sieg
//  - Niederlage: Notrückholung der ganzen Crew -> das ganze Szenario beginnt neu (Gegner, Ziel, Zähler)
//  - Snapshot mit 3 Spielern und vollem Szenario im Gefecht <= 18944 B
//   node tools/test-grabenangriff-szenario.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Physics = require('../shared/physics.js');
const GenFest = require('../shared/gen-fest.js');
const { Game } = require('../server/game.js');
const L = require('../server/sim/landepunkte.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const Anker = require('../server/sim/anker.js');
const Werft = require('../server/sim/werft.js');
const Wellen = require('../server/sim/wellen.js');
const Graben = require('../server/sim/graben.js');
const W = require('../server/world.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const TILE = Physics.TILE;
const fehlerZahl = (g) => (Array.isArray(g.errors) ? g.errors.length : g.errors | 0);
const tile = (o) => Physics.toTile(o.x, o.y);

// Spiel in der Lobby: np Verbundene, Modus arena_graben (über die Lobby-Nachrichten wie ein Client)
function lobby(np, o) {
  o = o || {};
  const g = new Game({ noStore: true, seed: o.seed || 11, debug: true, ruestphase: !!o.ruest, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 2000) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'G' + i, name: 'G' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_graben' });
  return { g, cs };
}
function start(np, o) {
  const r = lobby(np, o);
  for (const c of r.cs) r.g.handleMessage(c, { t: 'ready', ready: true });
  const S = r.g.arena && r.g.arena.wellen;
  r.S = S; r.aw = S && r.g.aways[S.lp]; r.K = S && W.AWAY_MAPS[S.lp].karte;
  return r;
}
const gegner = (aw) => aw.drones.filter((e) => e.tag === Wellen.TAG);
const lebend = (aw) => gegner(aw).filter((e) => e.alive);
const anker = (K, id) => K.anker.find((a) => a.id === id);
const nah = (K, e, gruppe, r) => K.meta.gruppen[gruppe].some((id) => { const a = anker(K, id), t = tile(e); return Math.abs(a.x - t.x) <= r && Math.abs(a.y - t.y) <= r; });
function faellen(g, ids) {
  for (const e of g.away.drones) if (ids.includes(e.id)) for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(g, e, 99, { x: e.x - 40, y: e.y });
}
const objektiv = (g) => ((g.snapshot().mission || {}).objectives || []).map((o) => o.text).join(' | ');
const stick = (g, c, mx, my) => g.handleMessage(c, { t: 'input', seq: (stick.s = (stick.s || 0) + 1), mx, my });
const zielTile = (K) => anker(K, K.meta.ziel);
function aufZiel(g, p, K) { const a = zielTile(K); const c = Physics.tileCenter(a.x, a.y); p.x = c.x; p.y = c.y; }
function ziel3s(g, cs, K) {   // Spieler 0 steht am Ziel und hält E (act) 4 s
  aufZiel(g, g.players[0], K);
  g.handleMessage(cs[0], { t: 'act', down: true });
  for (let i = 0; i < 4 * CONFIG.tickHz; i++) { for (const p of g.players) { if (p.shield) p.shield.seg = 3; } g.step(); }
  g.handleMessage(cs[0], { t: 'act', down: false });
}

section('Lobby: Modus neben Wellen Boden, Variantenliste aus den Kartendaten', () => {
  const ml = Protocol.LOBBY_MODI;
  ok(ml.includes('arena_graben') && ml.indexOf('arena_graben') === ml.indexOf('arena_away') + 1, 'LOBBY_MODI: arena_graben direkt hinter arena_away (Wellen Boden)');
  ok(Protocol.START_LABELS.arena_graben === 'Grabenangriff' && Protocol.START_HINTS.arena_graben, 'Beschriftung „Grabenangriff“ und Hinweistext');
  const { g, cs } = lobby(2);
  ok(g.startModi().includes('arena_graben') && g.lobbyOpts.startMission === 'arena_graben', 'Server nimmt den Modus an');
  const lob = g.snapshot().lobby;
  const DEF = L.festkarte('grabenangriff');
  const erw = GenFest.varianten(DEF).filter((a) => a.waehlbar);
  ok(JSON.stringify(lob.grabenListe) === JSON.stringify(erw.map((a) => ({ abschnitt: a.abschnitt, name: a.name, varianten: a.varianten }))), 'lobby.grabenListe = gen-fest varianten() (nur wählbare Abschnitte)');
  const nm = (ab) => lob.grabenListe.find((a) => a.abschnitt === ab).varianten.map((v) => v.name).join();
  ok(nm('wiese') === 'mit Graben' && nm('wald') === 'Weg durch den Wald', 'Wiese: „mit Graben“, Wald: „Weg durch den Wald“ (je Abschnitt eine Variante)');
  ok(!lob.grabenListe.some((a) => a.abschnitt === 'landung'), 'Landung ist nicht wählbar');
  ok(JSON.stringify(lob.graben) === JSON.stringify({ wiese: 'graben', wald: 'weg', eingang: 'bunker' }), 'Standardwahl je Abschnitt im Snapshot');
  g.handleMessage(cs[1], { t: 'lobbyOpt', graben: { wiese: 'graben' } });
  ok(!cs[0].inbox.some((m) => m.t === 'notice') && g.lobbyOpts.graben.wiese === 'graben', 'gültige Wahl (jeder darf umschalten) wird übernommen');
  const vor = JSON.stringify(g.lobbyOpts.graben);
  g.handleMessage(cs[0], { t: 'lobbyOpt', graben: { wiese: 'gibtsnicht' } });
  g.handleMessage(cs[0], { t: 'lobbyOpt', graben: { landung: 'standard' } });
  g.handleMessage(cs[0], { t: 'lobbyOpt', graben: { quatsch: 'x' } });
  ok(JSON.stringify(g.lobbyOpts.graben) === vor, 'unbekannte Variante, nicht wählbarer und unbekannter Abschnitt werden abgelehnt');
  ok(cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'notice' && /Grabenangriff/.test(m.text)).length === 3, 'jede Ablehnung geht als Hinweis an den Absender zurück');
  // Datengetrieben: eine zusätzliche Variante in der Kartendatei erscheint ohne Codeänderung in Liste und Wahl
  const d2 = JSON.parse(JSON.stringify(DEF)); const wv = d2.decks[0].abschnitte.wiese.varianten; wv.leer = JSON.parse(JSON.stringify(wv.graben)); wv.leer.name = 'Testvariante';
  const l2 = GenFest.varianten(d2).find((a) => a.abschnitt === 'wiese').varianten.map((v) => v.id);
  ok(l2.join() === 'graben,leer', 'weitere Variante in den Daten erscheint in der Liste (kein Code nötig)');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('Start mit Rüstphase: Crew bleibt an Bord, „Szene starten“, dann beamt sie am Abholpunkt links hinunter', () => {
  const r = start(3, { ruest: true }); const { g, S, aw, K } = r;
  ok(g.phase === 'play' && S && S.buehne === 'graben' && S.ph === 'vorbereitung', 'Szenario läuft, Phase vorbereitung');
  ok(g.players.every((p) => p.zone === 'ship'), 'die Crew bleibt an Bord (Rüstphase)');
  ticks(g, 1);
  ok(/Rüstphase/.test(objektiv(g)), 'Zielzeile: Rüstphase (' + objektiv(g) + ')');
  ok(g.snapshot().wellen.ph === 'vorbereitung' && g.snapshot().wellen.k === 'grabenangriff', 'Snapshot-Block wellen: ph vorbereitung, k grabenangriff');
  ticks(g, 5);
  ok(g.players.every((p) => p.zone === 'ship') && lebend(aw).length === 12, 'ohne „Szene starten“ passiert nichts (12 Gegner stehen, Crew an Bord)');
  ok(Werft.szeneStarten(g, g.players[0]) === null, 'werft.szeneStarten (Terminal) startet die Szene');
  ticks(g, 1);
  ok(S.ph === 'kampf' && g.players.every((p) => p.zone === 'away' && g.away.map === S.lp), 'Phase kampf, alle unten auf der festen Karte');
  const ab = anker(K, 'landung.abholpunkt');
  ok(g.players.every((p) => { const t = tile(p); return Math.abs(t.x - ab.x) <= 4 && Math.abs(t.y - ab.y) <= 4; }) && ab.x <= 6, 'alle am Abholpunkt links (x ' + ab.x + ')');
  ok(Werft.szeneStarten(g, g.players[0]) !== null, 'zweites „Szene starten“ wird abgelehnt');
  ticks(g, 2);
  ok(objektiv(g) === 'Rom besiegen: Graben 6 · Wald und Eingang 6', 'Zielzeile im Kampf mit Zählern je Welle: ' + objektiv(g));
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('Aufstellung: Welle 1 Graben und Posten, Welle 2 Wald und Eingang, alle von Beginn an; Zahl nach Crewgröße', () => {
  const erwartet = { 1: 6, 2: 9, 3: 12 };
  for (const np of [1, 2, 3]) {
    const { g, S, aw, K } = start(np);
    ok(g.players.every((p) => p.zone === 'away'), `${np} Spieler: ohne Rüstphase gleich unten`);
    ok(lebend(aw).length === erwartet[np] && S.gesamt === erwartet[np], `${np} Spieler: ${erwartet[np]} Gegner (${lebend(aw).length})`);
    const w1 = gegner(aw).filter((e) => S.ids[1].includes(e.id)), w2 = gegner(aw).filter((e) => S.ids[2].includes(e.id));
    ok(w1.length + w2.length === erwartet[np] && w1.length > 0 && w2.length > 0, `${np} Spieler: Welle 1 ${w1.length} + Welle 2 ${w2.length}, alle von Beginn an da`);
    const g1 = K.meta.wellen['1'], g2 = K.meta.wellen['2'];
    ok(w1.every((e) => g1.some((gr) => nah(K, e, gr, 2))), `${np} Spieler: Welle 1 steht an den Ankern von ${g1.join(' + ')}`);
    ok(w2.every((e) => g2.some((gr) => nah(K, e, gr, 2))), `${np} Spieler: Welle 2 steht an den Ankern von ${g2.join(' + ')}`);
    const xmax1 = Math.max(...w1.map((e) => tile(e).x)), xmin2 = Math.min(...w2.map((e) => tile(e).x));
    ok(xmax1 < xmin2, `${np} Spieler: Welle 1 (x bis ${xmax1}) steht vor Welle 2 (ab x ${xmin2})`);
    const rollen = new Set(gegner(aw).map((e) => e.rolle));
    ok(rollen.has('grenadier') && rollen.has('schuetze') && rollen.has('grundtyp'), `${np} Spieler: Rollenmix ${[...rollen].join(', ')} (Grenadier und Schütze dabei)`);
    const postenRollen = gegner(aw).filter((e) => nah(K, e, 'w1.posten', 0)).map((e) => e.rolle);
    ok(postenRollen.length >= 1 && postenRollen.every((r2) => r2 === 'schuetze'), `${np} Spieler: Posten bevorzugt Schützen (${postenRollen.join(',')})`);
    const pos0 = gegner(aw).map((e) => e.x + ',' + e.y).join(';');
    ticks(g, 20);
    ok(gegner(aw).length === erwartet[np] && gegner(aw).map((e) => e.x + ',' + e.y).join(';') === pos0, `${np} Spieler: nach 20 s kein Nachspawn, die Verteidiger rücken nicht nach (Ruhestellung)`);
    ok(S.ph === 'kampf' && fehlerZahl(g) === 0, `${np} Spieler: Phase kampf, keine Fehler`);
  }
  const dichte = start(3);
  ok(Graben.besetzungFuer(dichte.g, 4)[Object.keys(Graben.besetzungFuer(dichte.g, 3))[0]] === Graben.besetzungFuer(dichte.g, 3)[Object.keys(Graben.besetzungFuer(dichte.g, 3))[0]], 'Crew über dem größten Eintrag nimmt den größten');
});

section('Rom: Fraktion, Palette, Namen und Funk römisch', () => {
  const { g, S, aw } = start(3);
  const gs = gegner(aw);
  ok(gs.length === 12 && gs.every((e) => e.fraktion === 'rom'), 'alle 12 Verteidiger: Fraktion rom');
  ok(gs.every((e) => e.palette === 'rom'), 'alle mit Palette rom');
  const pa = (g.snapshot().away.drones || []).filter((d) => d.pa).length;
  ok(pa === 0 || pa === gs.length, 'Palette im Snapshot einheitlich (palette_senden)');
  const ev = []; const emit = g.emit; g.emit = function (t, d) { if (t === 'bark') ev.push(d); return emit.apply(this, arguments); };
  const anl = ['contact', 'playerDown', 'allgemein', 'kamerad_liegt', 'spieler_gefesselt', 'alarm_laerm', 'friendly_fire'];
  for (const e of gs) { const s = squad.squadOf(g, e); for (const k of anl) { s.barkAt = -999; squad.bark(g, s, e, k); } }
  const germ = ['Karl', 'Bolzer', 'Donnerwerfer', 'Jäger', 'Berserker', 'Wergeld-Fänger', 'Plünderer', 'Gegner'];
  ok(ev.length >= gs.length, `Funksprüche gefallen (${ev.length})`);
  ok(!ev.some((b) => germ.some((x) => b.from.includes(x))), 'kein Sprecher „Karl“, „Bolzer“ oder anderer germanischer Name' + (ev.find((b) => germ.some((x) => b.from.includes(x))) ? ': ' + ev.find((b) => germ.some((x) => b.from.includes(x))).from : ''));
  ok(['Legionär', 'Funditor', 'Speculator'].every((rn) => ev.some((b) => b.from.startsWith(rn + ' '))), 'Legionär, Funditor und Speculator sprechen');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('Ziel: vor dem Sieg über Welle 2 gesperrt und wirkungslos, danach erreichbar', () => {
  const { g, cs, S, aw, K } = start(3);
  const z = K.meta.ziel;
  ok(z === 'bunker.ziel' && S.ziel === 'gesperrt' && aw.ankerSperre && aw.ankerSperre[z], 'Ziel bunker.ziel gesperrt (ankerSperre mit Hinweistext: ' + (aw.ankerSperre && aw.ankerSperre[z]) + ')');
  const liste = []; Anker.interactionsAt(g, g.players[0], zielTile(K).x, zielTile(K).y, liste);
  ok(liste.length && liste.every((i) => i.blocked) && /Gesperrt/.test(liste[0].blocked), 'Interaktion am Ziel: „gesperrt“ statt Halten');
  // Welle 1 besiegt, Welle 2 steht: das Ziel bleibt gesperrt, Halten wirkt nicht
  faellen(g, S.ids[1]);
  ticks(g, 1);
  ok(S.ziel === 'gesperrt' && lebend(aw).length === g.arena.wellen.gesamt - S.ids[1].length, 'Welle 1 besiegt, Welle 2 steht: Ziel bleibt gesperrt');
  ziel3s(g, cs, K);
  ok(Anker.zustand(g, S.lp, z) === 'frei' && S.ziel === 'gesperrt', 'Halten am gesperrten Ziel (4 s) bewirkt nichts');
  ok(/Rom besiegen/.test(objektiv(g)), 'Zielzeile: ' + objektiv(g));
  // Welle 2 besiegt: Ziel offen, 3 s halten = erreicht
  faellen(g, S.ids[2]);
  ticks(g, 1);
  ok(S.ziel === 'offen' && !(aw.ankerSperre && aw.ankerSperre[z]), 'Welle 2 besiegt: Ziel offen, Sperre weg');
  ok(/Bunkereingang einnehmen/.test(objektiv(g)), 'Zielzeile: ' + objektiv(g));
  const l2 = []; Anker.interactionsAt(g, g.players[0], zielTile(K).x, zielTile(K).y, l2);
  ok(l2.length && !l2[0].blocked, 'Interaktion am Ziel wieder möglich');
  aufZiel(g, g.players[0], K);
  g.handleMessage(cs[0], { t: 'act', down: true });
  ticks(g, 1.5);
  ok(Anker.zustand(g, S.lp, z) === 'frei' && S.ziel === 'offen', 'nach 1,5 s noch nicht erreicht (halten dauert ' + CONFIG.anker.halten.ziel + ' s)');
  ticks(g, 2.5);
  g.handleMessage(cs[0], { t: 'act', down: false });
  ticks(g, 1);
  ok(Anker.zustand(g, S.lp, z) === 'aktiviert' && S.ziel === 'erreicht', 'Ziel nach dem Halten erreicht');
  ok(/Abholpunkt/.test(objektiv(g)) && /hochbeamen/.test(objektiv(g)), 'Zielzeile: ' + objektiv(g));
  ok(g.snapshot().wellen.ph === 'kampf', 'noch kein Sieg, solange die Crew unten ist');
  // Sieg = Hochbeamen nach dem Ziel (ein Spieler oben reicht nicht)
  away.executeBeam(g, [g.players[0].id], 'up'); ticks(g, 1);
  ok(S.ph === 'kampf', 'nur ein Spieler oben: kein Sieg');
  away.executeBeam(g, g.players.slice(1).map((p) => p.id), 'up'); ticks(g, 1);
  ok(S.ph === 'ende' && g.snapshot().wellen.ph === 'ende', 'alle hochgebeamt nach dem Ziel: Sieg (Phase ende)');
  const ev = cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'wellenEnde');
  ok(ev.length === 1 && ev[0].sieg === true && ev[0].kills.length === 3 && ev[0].geschafft === 2, 'Ereignis wellenEnde { sieg } wie bei den Wellen (Siegbild, Kills je Spieler)');
  ok(/gewonnen/.test(objektiv(g)), 'Zielzeile: ' + objektiv(g));
  ticks(g, CONFIG.graben.ergebnisZeit + 2);
  ok(g.phase === 'lobby', 'nach der Ergebnisanzeige zurück in der Lobby');
  ok(fehlerZahl(g) === 0, 'keine Fehler');
});

section('Hochbeamen ohne Ziel: kein Sieg, der Stand bleibt stehen', () => {
  const { g, S, aw } = start(3);
  faellen(g, S.ids[2].slice(0, 1));
  const lebt = lebend(aw).length;
  away.executeBeam(g, g.players.map((p) => p.id), 'up');
  ticks(g, 3);
  ok(S.ph === 'kampf' && g.phase === 'play' && g.players.every((p) => p.zone === 'ship'), 'alle oben, Ziel nicht erreicht: kein Sieg, Szenario läuft weiter');
  ok(lebend(aw).length === lebt && S.versuch === 1, 'Gegner und Stand bleiben (kein Neubeginn)');
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  ticks(g, 1);
  ok(g.players.every((p) => p.zone === 'away') && S.ph === 'kampf', 'die Crew kann wieder hinunter');
});

section('Niederlage: ganze Crew gefallen -> Notrückholung -> das ganze Szenario beginnt neu', () => {
  for (const ruest of [false, true]) {
    const { g, cs, S, aw, K } = start(3, { ruest });
    if (ruest) Werft.szeneStarten(g, g.players[0]);
    ticks(g, 1);
    const z = K.meta.ziel;
    const pos0 = gegner(aw).map((e) => e.rolle + '@' + tile(e).x + ',' + tile(e).y).sort().join(';');
    faellen(g, S.ids[1]); faellen(g, S.ids[2]);
    ticks(g, 1);
    ziel3s(g, cs, K);
    ok(S.ziel === 'erreicht' && lebend(aw).length === 0, `[${ruest ? 'mit' : 'ohne'} Rüstphase] Ausgangslage: alle besiegt, Ziel erreicht`);
    const vorher = (aw.stats && aw.stats.squadRecalls) || 0;
    for (const p of g.players) { combat.woundPlayer ? combat.woundPlayer(g, p, { quiet: true }) : (p.downed = true); p.downed = true; }
    ticks(g, CONFIG.awayCombat.wounded.squadRecallDelay + 3);
    ok(((aw.stats && aw.stats.squadRecalls) || 0) === vorher + 1, 'Notrückholung (bestehender Weg combat.squadRecall) hat gegriffen');
    ok(S.versuch === 2 && S.ph !== 'ende' && g.phase === 'play', 'Neubeginn: Versuch 2, kein Ende, kein Sieg');
    ok(lebend(aw).length === S.gesamt && S.gesamt === 12 && gegner(aw).map((e) => e.rolle + '@' + tile(e).x + ',' + tile(e).y).sort().join(';') === pos0, 'alle 12 Gegner wieder auf den Anfangsplätzen');
    ok(S.ziel === 'gesperrt' && Anker.zustand(g, S.lp, z) === 'frei' && aw.ankerSperre && aw.ankerSperre[z], 'Ziel wieder gesperrt und offen (Zustand frei)');
    ok(S.abschuesse === 0 && Object.keys(S.kills).length === 0, 'Zähler zurück (Abschüsse 0)');
    ok(g.ship.systems.transfer === 'ok' && !(aw.recallLockUntil > g.time), 'Transfer nach der Notrückholung wieder heil und nicht gesperrt (sonst kein Hochbeamen nach dem Neubeginn)');
    if (ruest) {
      ok(S.ph === 'vorbereitung' && g.players.every((p) => p.zone === 'ship'), 'mit Rüstphase: Crew an Bord, Phase vorbereitung (ausrüsten, „Szene starten“)');
      Werft.szeneStarten(g, g.players[0]); ticks(g, 1);
    }
    ok(S.ph === 'kampf' && g.players.every((p) => p.zone === 'away' && !p.downed), 'Crew wieder unten, Phase kampf');
    const ab = anker(K, 'landung.abholpunkt');
    ok(g.players.every((p) => Math.abs(tile(p).x - ab.x) <= 4), 'wieder am Abholpunkt');
    ok(W.AWAY_MAPS[S.lp].karte === K, 'Karte nicht neu gebaut (dasselbe Kartenobjekt)');
    away.executeBeam(g, g.players.map((p) => p.id), 'up'); ticks(g, 1);
    ok(S.ph === 'kampf', 'Hochbeamen nach dem Neubeginn ohne Ziel: kein Sieg (kein Rest vom ersten Versuch)');
    ok(fehlerZahl(g) === 0, 'keine Fehler');
  }
});

section('Debug: graben welle2 / reset / status', () => {
  const { g, S, aw } = start(2);
  ok(Graben.debug(g, 'status').startsWith('graben: Versuch 1'), 'status: ' + Graben.debug(g, 'status'));
  ok(Graben.debug(g, 'welle2') === null, 'welle2 entfernt Welle 2');
  ticks(g, 1);
  ok(S.ziel === 'offen', 'Ziel nach Debug welle2 offen');
  ok(Graben.debug(g, 'reset') === null && S.versuch === 2 && S.ziel === 'gesperrt' && lebend(aw).length === 9, 'reset: Neubeginn');
  ok(Wellen.debugWelle(g, 3) && /Grabenangriff/.test(Wellen.debugWelle(g, 3)), 'welle <n> im Grabenangriff abgelehnt');
});

section('Snapshot mit 3 Spielern, volles Szenario im Gefecht (Ziel <= 18944 B, Grenze 20480 B)', () => {
  const ZIEL = CONFIG.net.snapMax - CONFIG.net.snapLuft;
  let max = 0, summe = 0, cnt = 0, maxDr = 0, fehler = 0, schuss = 0;
  for (const seed of [11, 12, 13]) {
    const { g, cs, S, aw } = start(3, { seed });
    // alle Gegner kämpfen von Tick 0 an (Alarm), die Spieler marschieren über Wiese und Graben, wieder auf, wenn gefallen (kein Notruf)
    aw.alert = true;
    for (const nm of Object.keys(aw.squads)) aw.squads[nm].alert = true;
    const T = Math.round(60 * CONFIG.tickHz);
    for (let k = 0; k < T; k++) {
      const ph = Math.floor(k / CONFIG.tickHz);
      cs.forEach((c, i) => stick(g, c, ph < 45 ? 1 : 0, Math.sin((ph + i * 2) / 3) * 0.6));
      g.step();
      for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
      const sn = g.snapshot();
      const b = Buffer.byteLength(JSON.stringify(sn));
      if (b > max) max = b; summe += b; cnt++;
      if (k % 15 === 0) maxDr = Math.max(maxDr, (sn.away && sn.away.drones || []).length);
    }
    fehler += fehlerZahl(g);
    schuss += (aw.stats && aw.stats.playerHits) || 0;
  }
  console.log(`  Messwert: Snapshot max ${max} B, Mittel ${Math.round(summe / cnt)} B (echtes Szenario, 12 Gegner, bis ${maxDr} im Snapshot, 3 Spieler, 3 Seeds x 60 s, Treffer auf Spieler ${schuss})`);
  ok(maxDr >= 8, `mindestens 8 Gegner im Snapshot (${maxDr})`);
  ok(max <= ZIEL, `Snapshot max ${max} B <= Ziel ${ZIEL} B (Grenze ${CONFIG.net.snapMax} B)`);
  ok(fehler === 0, 'keine Tickfehler');
});

console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
