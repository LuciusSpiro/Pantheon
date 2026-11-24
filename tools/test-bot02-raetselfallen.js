'use strict';
// BOT-02 A: Rätselfallen im Einspielermodus (ein Mensch unten, Bots oben). „Solo“ heißt überall „genau 1 Spieler im Außenteam“
// (Buehne.raetselSolo, dieselbe Zählung wie das Rätselpaar), nicht „1 Kopf insgesamt“.
//  a) Archiv-Schlüssel (combat.keyWindow): 1 Mensch unten + 3 Bots oben -> 15-s-Fenster; 2 Menschen unten -> archkeyWindow (1,5 s)
//  b) Feldzeichen (anker.js flaggeMin): 1 Spieler im Außenteam hisst allein; ab 2 im Außenteam braucht es 2 lebende Halter
//  c) Katalog: jede Umsetzung mit dauer_je_crew hat auch den Schlüssel "1"
//   node tools/test-bot02-raetselfallen.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const L = require('../server/sim/landepunkte.js');
const Anker = require('../server/sim/anker.js');
const combat = require('../server/sim/combat.js');
const away = require('../server/sim/away.js');
const W = require('../server/world.js');
const Buehne = require('../shared/buehne.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const AC = CONFIG.awayCombat;

// ---------- a) Archiv-Schlüssel ----------
// np Spieler; die letzten `bots` sind Bots und bleiben an Bord (zone 'ship'); `unten` Menschen sind auf Kesh
function keshSpiel(np, bots, unten) {
  const g = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'C' + i, name: 'C' + i, color: i }); cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  g.handleMessage(cs[0], { t: 'debug', cmd: 'kesh' });   // alle runter
  g.players.forEach((p, i) => { if (i >= np - bots) { p.bot = true; p.zone = 'ship'; } else if (i >= unten) p.zone = 'ship'; });
  const run = (sek) => { for (let k = 0; k < Math.round(sek * 30); k++) g.step(); };
  return { g, run, aw: g.aways.kesh };
}
function zweiSchluessel(np, bots, unten, abstand) {
  const { g, run, aw } = keshSpiel(np, bots, unten);
  const p = g.players[0];
  combat.keyTurned(g, p, 0);
  run(abstand);
  const nochDa = aw.keys[0].doneAt != null;
  combat.keyTurned(g, p, 1);
  return { offen: !!aw.vault.open, nochDa, away: g.players.filter((q) => q.zone === 'away').length };
}
section('a) Archiv-Schlüssel: Fenster nach Spielern im Außenteam');
{
  ok(AC.archkeyWindow < 5 && AC.archkeySoloWindow >= 10, `Config: archkeyWindow ${AC.archkeyWindow} s, archkeySoloWindow ${AC.archkeySoloWindow} s`);
  let r = zweiSchluessel(4, 3, 1, 10);
  ok(r.away === 1 && r.nochDa && r.offen, '1 Mensch unten + 3 Bots oben: zweiter Schlüssel nach 10 s öffnet das Tor (Solo-Fenster)');
  r = zweiSchluessel(4, 3, 1, 1.0);
  ok(r.offen, '1 Mensch unten + 3 Bots oben: auch 1 s Abstand öffnet');
  r = zweiSchluessel(5, 3, 2, 10);
  ok(r.away === 2 && !r.nochDa && !r.offen, '2 Menschen unten (+3 Bots oben): 10 s Abstand scheitert, erster Schlüssel zurückgesprungen');
  r = zweiSchluessel(5, 3, 2, 1.0);
  ok(r.offen, '2 Menschen unten (+3 Bots oben): 1,0 s Abstand öffnet');
  r = zweiSchluessel(2, 0, 2, 10);
  ok(r.away === 2 && !r.offen, 'reine Menschenpartie, 2 unten: 10 s scheitert (unverändert)');
  r = zweiSchluessel(1, 0, 1, 10);
  ok(r.offen, 'reine Menschenpartie, 1 Spieler: 10 s öffnet (unverändert)');
  r = zweiSchluessel(2, 0, 1, 10);
  ok(r.away === 1 && r.offen, 'zwei Menschen, einer an Bord, einer unten: jetzt Solo (1 im Außenteam, wie das Rätselpaar)');
}

// Solo-Wortlaut der Meldung nach abgelaufenem Fenster (Server) und der Hinweise (shared, Client)
section('a2) Archiv-Schlüssel: Meldung/Hinweis solo vs. Gruppe');
{
  const meldung = (np, bots, unten, warte) => {
    const { g, run } = keshSpiel(np, bots, unten);
    const msgs = []; const oda = g.oda.bind(g); g.oda = (t, ...r) => { msgs.push(String(t)); return oda(t, ...r); };
    combat.keyTurned(g, g.players[0], 0);
    run(warte);
    return msgs.join(' | ');
  };
  const w = Math.max(AC.archkeyWindow, AC.archkeySoloWindow);
  let m = meldung(4, 3, 1, w + 1);
  ok(/innerhalb von 15 s/.test(m) && !/gleichzeitig/.test(m), `1 Mensch unten, Fenster abgelaufen: Solo-Wortlaut „nach dem ersten Schloss das zweite innerhalb von 15 s“ (${m})`);
  m = meldung(5, 3, 2, AC.archkeyWindow + 1);
  ok(/Beide Schlüssel gleichzeitig/.test(m) && !/innerhalb von/.test(m), `2 Menschen unten: bisheriger Wortlaut „Beide Schlüssel gleichzeitig“ (${m})`);
  const pl = (...zonen) => zonen.map((z) => ({ zone: z, connected: true }));
  ok(Buehne.archkeyFenster(pl('away', 'ship', 'ship', 'ship'), AC) === AC.archkeySoloWindow && Buehne.archkeyFenster(pl('away', 'away'), AC) === AC.archkeyWindow, 'shared archkeyFenster: 1 im Außenteam = Solo-Fenster, 2 = Gruppenfenster');
  ok(/innerhalb von 15 s/.test(Buehne.archkeyHinweis(true, 15)) && Buehne.archkeyHinweis(false) === 'beide gleichzeitig!', 'shared archkeyHinweis: Solo/Gruppe');
  // zweiter Spieler getrennt: 2 unten, einer trennt -> Solo-Fenster
  const { g, run, aw } = keshSpiel(2, 0, 2);
  g.players[1].connected = false;
  combat.keyTurned(g, g.players[0], 0); run(10);
  const noch = aw.keys[0].doneAt != null; combat.keyTurned(g, g.players[0], 1);
  ok(noch && aw.vault.open, '2 unten, einer getrennt: der andere bekommt das Solo-Fenster (10 s Abstand öffnet)');
}

// ---------- b) Feldzeichen ----------
const LP = 'splitter.eisenwald', LAB = 'stellung_nehmen/flagge_hissen';
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
// np Spieler im Labor Flagge hissen; nur die ersten `unten` beamen runter, die letzten `bots` sind Bots (an Bord)
function flaggeSpiel(np, unten, bots, seed) {
  const g = new Game({ noStore: true, seed: seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 600) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'labor', labor: { id: LAB, seed: seed || 5 } });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ticks(g, 1);
  g.weltstand.data.rollen_gesehen = ['niederhalter', 'grenadier', 'schuetze', 'enterer'];
  g.players.forEach((p, i) => { if (i >= np - bots) p.bot = true; });
  L.get(g, LP);
  g.transferZiel = { lp: LP, scene: g.ship.scene }; g.setAwayMap(LP);
  away.executeBeam(g, g.players.slice(0, unten).map((p) => p.id), 'down');
  ticks(g, 0.5);
  const a = W.AWAY_MAPS[LP].karte.anker.find((q) => q.rolle === 'flagge');
  return { g, a, T: CONFIG.anker.halten.flagge };
}
const halten = (g, ps, a, sek) => {
  for (const p of ps) { p.actDown = true; p.moving = false; p.hold = { kind: 'anker:flagge', anker: a.id, t: 0, dur: Anker.holdDuration(g, p, 'anker:flagge', {}), op: 'hissen' }; }
  ticks(g, sek);
};
const angebot = (g, p, a) => { const li = []; Anker.interactionsAt(g, p, a.x, a.y, li); return li[0]; };

section('b) Feldzeichen: Solo-Regel nach Spielern im Außenteam');
// Client-Hinweis (shared/buehne.js flaggeHinweis) == Server-Angebot (anker.js interactionsAt) für dieselben Spieler
const hinweisPasst = (g, p, a, text) => { const o = angebot(g, p, a); const h = Buehne.flaggeHinweis(g.players, CONFIG.anker.flagge.min, '6 s'); return o && h.ok === !o.blocked && (h.ok || h.label === (o.blocked)) ? text : null; };
{
  // 1 Mensch unten, 3 Bots an Bord: hisst allein
  const { g, a, T } = flaggeSpiel(4, 1, 3);
  const [p1] = g.players;
  ok(g.players.filter((p) => p.zone === 'away').length === 1 && p1.zone === 'away', '1 Mensch unten, 3 Bots oben');
  const h1 = Buehne.flaggeHinweis(g.players, CONFIG.anker.flagge.min, '6 s');
  ok(h1.ok === true && /Feldzeichen hissen \(6 s\)/.test(h1.label) && !/zwei/.test(h1.label), `Client-Hinweis 1 unten + 3 Bots: „${h1.label}“, ok`);
  ok(hinweisPasst(g, p1, a, true), 'Client-Hinweis stimmt mit dem Server-Angebot überein (1 unten)');
  const o = angebot(g, p1, a);
  ok(o && o.kind === 'anker:flagge' && o.op === 'hissen' && !o.blocked, 'Hissen wird angeboten (kein „zwei gemeinsam“)');
  ok(Anker.holdValid(g, p1, { kind: 'anker:flagge', anker: a.id }) === true, 'holdValid true');
  halten(g, [p1], a, T / 2);
  ok(p1.hold && p1.hold.t > T / 2 - 0.6 && Anker.zustand(g, LP, a.id) === 'unten', `Fortschritt läuft allein (${p1.hold ? p1.hold.t.toFixed(1) : '-'} s von ${T})`);
  p1.actDown = false; p1.hold = null; ticks(g, 1);
  halten(g, [p1], a, T / 2 + 1);
  ok(Anker.zustand(g, LP, a.id) === 'gehisst', 'losgelassen und weitergehalten: Fortschritt blieb, gehisst');
}
{
  // reine Menschenpartie mit nur einem Spieler: unverändert solo
  const { g, a, T } = flaggeSpiel(1, 1, 0);
  halten(g, [g.players[0]], a, T + 1);
  ok(Anker.zustand(g, LP, a.id) === 'gehisst', 'ein einziger Spieler ohne Bots hisst allein');
}
{
  // 2 im Außenteam (3 Spieler, einer Bot an Bord): zwei Halter nötig
  const { g, a, T } = flaggeSpiel(3, 2, 1);
  const [p1, p2] = g.players;
  const o = angebot(g, p1, a);
  ok(o && o.kind === 'anker:flagge' && !o.blocked, '2 im Außenteam, beide leben: Hissen wird angeboten');
  const h2 = Buehne.flaggeHinweis(g.players, CONFIG.anker.flagge.min, '6 s');
  ok(h2.ok && /6 s, zwei gleichzeitig/.test(h2.label) && hinweisPasst(g, p1, a, true), `Client-Hinweis 2 unten: „${h2.label}“`);
  halten(g, [p1], a, 3);
  ok(p1.hold && Math.abs(p1.hold.t) < 0.01 && Anker.zustand(g, LP, a.id) === 'unten', 'ein Halter von zwei: kein Fortschritt');
  halten(g, [p1, p2], a, T + 1);
  ok(Anker.zustand(g, LP, a.id) === 'gehisst', 'zwei Halter: gehisst');
}
{
  // 2 im Außenteam, einer liegt: nur noch ein Lebender -> nicht möglich (Regel „zwei gemeinsam“ gilt, weil 2 im Außenteam)
  const { g, a } = flaggeSpiel(3, 2, 1, 8);
  const [p1, p2] = g.players;
  combat.woundPlayer(g, p2, { kind: 'test' });
  const o = angebot(g, p1, a);
  ok(o && /zwei gemeinsam/.test(o.blocked || ''), `2 im Außenteam, einer verwundet: Hinweis „zwei gemeinsam“ (${o && o.blocked})`);
  const h3 = Buehne.flaggeHinweis(g.players, CONFIG.anker.flagge.min, '6 s');
  ok(!h3.ok && h3.label === Buehne.FLAGGE_GESPERRT && hinweisPasst(g, p1, a, true), 'Client-Hinweis 2 unten, einer verwundet: gesperrt mit dem Server-Text');
  ok(Anker.holdValid(g, p1, { kind: 'anker:flagge', anker: a.id }) === false, '2 im Außenteam, einer verwundet: holdValid false');
  combat.revive(g, p2, null, { quiet: true });
  ok(Anker.holdValid(g, p1, { kind: 'anker:flagge', anker: a.id }) === true, 'wieder aufgestanden: möglich');
}
{
  // allein im Außenteam und selbst verwundet: nicht möglich
  const { g, a } = flaggeSpiel(2, 1, 1, 9);
  const [p1] = g.players;
  combat.woundPlayer(g, p1, { kind: 'test' });
  const o = angebot(g, p1, a);
  ok(o && !!o.blocked && Anker.holdValid(g, p1, { kind: 'anker:flagge', anker: a.id }) === false, 'allein unten und verwundet: kein Hissen');
}

{
  // 3 Spieler, 2 unten, einer trennt die Verbindung: der andere ist jetzt allein im Außenteam und hisst allein
  const { g, a, T } = flaggeSpiel(3, 2, 1, 10);
  const [p1, p2] = g.players;
  p2.connected = false;
  const o = angebot(g, p1, a);
  ok(o && o.kind === 'anker:flagge' && !o.blocked && Anker.holdValid(g, p1, { kind: 'anker:flagge', anker: a.id }) === true, '2 unten, einer getrennt: Hissen für den anderen angeboten und gültig');
  ok(Buehne.flaggeHinweis(g.players, CONFIG.anker.flagge.min, '6 s').ok && hinweisPasst(g, p1, a, true), 'Client-Hinweis nach Trennung: allein hissbar');
  halten(g, [p1], a, T + 1);
  ok(Anker.zustand(g, LP, a.id) === 'gehisst', '2 unten, einer getrennt: der andere hisst allein');
}
{
  // 3 unten, einer getrennt, einer am Boden: ein Getrennter zählt weder als Halter noch gegen die Regel (2 verbundene im Außenteam -> zwei nötig)
  const { g, a } = flaggeSpiel(3, 3, 0, 12);
  const [p1, p2, p3] = g.players;
  p3.connected = false; combat.woundPlayer(g, p2, { kind: 'test' });
  const o = angebot(g, p1, a);
  ok(o && !!o.blocked && Anker.holdValid(g, p1, { kind: 'anker:flagge', anker: a.id }) === false && !Buehne.flaggeHinweis(g.players, CONFIG.anker.flagge.min, '6 s').ok, '3 unten, einer getrennt, einer am Boden: nur 1 lebender Halter, gesperrt (Server und Client)');
}
{
  // Zweiter beamt mitten im Hissen runter: Fortschritt bleibt, ab dann braucht es 2 Halter
  const { g, a, T } = flaggeSpiel(3, 1, 2, 11);
  const [p1, p2] = g.players;
  halten(g, [p1], a, T / 2);
  const vorher = p1.hold ? p1.hold.t : -1;
  ok(vorher > T / 2 - 0.6 && Anker.zustand(g, LP, a.id) === 'unten', `allein halber Fortschritt (${vorher.toFixed ? vorher.toFixed(1) : vorher} s)`);
  away.executeBeam(g, [p2.id], 'down'); ticks(g, 1);
  ok(p2.zone === 'away', 'zweiter Spieler ist heruntergebeamt');
  halten(g, [p1], a, 3);
  ok(p1.hold && Math.abs(p1.hold.t - vorher) < 0.7 && Anker.zustand(g, LP, a.id) === 'unten', `ab 2 im Außenteam: ein Halter bringt nichts mehr, Fortschritt bleibt (${p1.hold ? p1.hold.t.toFixed(1) : '-'} s)`);
  halten(g, [p1, p2], a, T / 2 + 1);
  ok(Anker.zustand(g, LP, a.id) === 'gehisst', 'zwei Halter schließen den Rest ab: gehisst');
}

// Der Client darf die Hinweise nicht selbst zählen/formulieren (sonst läuft er wieder von der Server-Regel weg)
{
  const cl = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'client.js'), 'utf8');
  ok(/Shared_Buehne[\s\S]{0,300}flaggeHinweis\(st\.players/.test(cl) && !/hissen geht nur zu zweit/.test(cl), 'client.js: Feldzeichen-Hinweis kommt aus shared/buehne.js flaggeHinweis');
  ok(/archkeyHinweis\(/.test(cl) && !/other ? 'der zweite wird gedreht!' : 'beide gleichzeitig!'/.test(cl), 'client.js: Archivschlüssel-Hinweis kommt aus shared/buehne.js archkeyHinweis');
}

// ---------- c) Katalog ----------
section('c) Katalog: dauer_je_crew mit Schlüssel "1"');
{
  const dir = path.join(__dirname, '..', 'content', 'katalog', 'molekuele');
  let mit = 0, ohne = 0; const fehlt = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const u of j.umsetzungen || []) {
      if (!u.dauer_je_crew) { ohne++; continue; }
      mit++;
      if (!Array.isArray(u.dauer_je_crew['1']) || u.dauer_je_crew['1'].length !== 2) fehlt.push(j.id + '/' + u.id);
    }
  }
  ok(mit > 0, `Bestand: ${mit} Umsetzungen mit Tabelle, ${ohne} ohne (crewunabhängig)`);   // keine feste Zahl: die Regel ist unten („jede mit Tabelle hat "1"“)
  ok(fehlt.length === 0, `jede Umsetzung mit dauer_je_crew hat den Schlüssel "1"${fehlt.length ? ': ' + fehlt.join(', ') : ''}`);
  const u = JSON.parse(fs.readFileSync(path.join(dir, 'stellung_nehmen.json'), 'utf8')).umsetzungen.find((x) => x.id === 'flagge_hissen');
  const d = u.dauer_je_crew;
  ok(d['1'][0] >= d['2'][0] && d['1'][1] >= d['2'][1], `flagge_hissen: Solo-Dauer ${d['1']} nicht kürzer als zu zweit ${d['2']}`);
}

console.log(`\ntest-bot02-raetselfallen: ${n - fails}/${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
