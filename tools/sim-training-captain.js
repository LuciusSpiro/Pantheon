'use strict';
// TRA-01 E: scripted Mensch-Ersatz für das Captain-Training (Abzeichen Captain, beide Varianten), headless gegen die Game-Klasse über den echten Lobby-Weg.
//   node tools/sim-training-captain.js [--seeds N] [--variante tafel|sprache|beide] [--stt] [--verbose]
// Ein Lauf spielt alle Pflichtziele durch: Sprungziel, Marker, Tab zum Steuer und zurück (im Stand) · Kurs auf die Marke, Anflug, Stopp · zwei Übungsziele anvisieren (Anzeigeziel + ops.ziel markiert) ·
// Abstand, Scan, Feuer frei, Abschuss, Feuer halt · Reparatur · Schnellsprung und normaler Sprung (je nach Seed in anderer Reihenfolge). Befehle gehen als echte Nachricht bot.befehl durch die Annahme,
// Quellen je Variante: Tafel menu | taste (nach Seed), Sprache text | sprache (sprache nur mit --stt: ohne erreichbares STT bleibt es bei der Textzeile), nav.sprung immer menu | taste.
// Jeder Lauf spielt ZWEI Versuche (TRA-01 Nacharbeit W1): nach dem Abzeichen den Neustart abwarten (Buch von vorn, Flags auf Standard, Checkliste leer) und alles noch einmal bis zum zweiten Abzeichen.
// Die Sprachvariante spricht den Navigations-Bot mit der botId an (Namensadresse "Livia, …"). Ausgabe: je Lauf eine Zeile, am Ende Summe mit n.
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');

const DT = 1 / CONFIG.tickHz;
const WARTE = { bots: 20, anflug: 120, ziel: 8, kampf: 60, reparatur: 150, sprung: 150 };   // Obergrenzen in Spielsekunden je Abschnitt

class Haenger extends Error {}

// Partie über den Lobby-Weg; sprache = Lobby-Option trainingSprache
function partie(seed, sprache) {
  const g = new Game({ noStore: true, worlds: false, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 20000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'S' + seed, name: 'Sim', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'training_captain' });
  if (sprache) g.handleMessage(c, { t: 'lobbyOpt', trainingSprache: true });
  g.handleMessage(c, { t: 'ready', ready: true });
  const odas = []; const o0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(String(t)); return o0(t, x); };   // alle ODA-Zeilen seit dem Start
  const P = { g, c, h: c.player, odas };
  let jetzt = 1e12;   // die Annahme begrenzt die Rate nach Date.now: je Befehl 5 s weiter
  P.run = (sek, bis) => { for (let k = 0; k < Math.round(sek / DT); k++) { g.step(); if (g.wantsSnapshot && g.wantsSnapshot()) g.snapshot(); if (bis && bis()) return true; } return bis ? !!bis() : true; };
  P.cmd = (msg) => g.handleMessage(c, Object.assign({ t: 'cmd' }, msg));
  P.befehl = (an, befehl, quelle, args) => {
    jetzt += 5000; const n0 = c.inbox.length; const echt = Date.now; Date.now = () => jetzt;
    try { const m = { t: 'bot.befehl', an, befehl, quelle }; if (args) m.args = args; g.handleMessage(c, m); } finally { Date.now = echt; }
    return c.inbox.slice(n0).filter((m) => m.t === 'bot.antwort').map((m) => m.status);
  };
  P.abzeichenEreignisse = () => c.inbox.filter((m) => m.t === 'event' && m.kind === Protocol.EVT_ABZEICHEN);
  return P;
}

const erreicht = (P, id) => P.g.arena.training.erreicht.has(id);
const schritt = (P) => (P.g.mission.step ? P.g.mission.step.id : null);

// ein Befehl, bis er angenommen wird (z. B. kein_ziel/nicht_jetzt: kurz warten und wiederholen)
function befehlen(P, an, befehl, quelle, args, versuche) {
  let letzte = [];
  for (let i = 0; i < (versuche || 6); i++) {
    letzte = P.befehl(an, befehl, quelle, args);
    if (letzte.length && letzte.every((s) => s === 'ok')) return true;
    P.run(1.5);
  }
  throw new Haenger('Befehl ' + befehl + ' (' + quelle + ') nicht angenommen: ' + letzte.join(','));
}
function warten(P, was, max, bis) {
  if (!P.run(max, bis)) throw new Haenger('hängt: ' + was + ' (Schritt ' + schritt(P) + ', t ' + P.g.time.toFixed(0) + ')');
}

// Ein Lauf. o: { seed, variante: 'tafel' | 'sprache', stt }
function lauf(o) {
  const sprache = o.variante === 'sprache';
  const P = partie(o.seed, sprache); const g = P.g; const sh = g.ship; const T = g.arena.training;
  const ungerade = o.seed % 2 === 1;
  const quelle = sprache ? (ungerade && o.stt ? 'sprache' : 'text') : (ungerade ? 'menu' : 'taste');
  const sprungQuelle = ungerade ? 'menu' : 'taste';
  const nav = sprache ? 'b0' : 'navigation';   // Namensadresse: Livia ist die Figur b0 (erste Figur, Navigation zuerst angelegt)
  const res = { seed: o.seed, variante: o.variante, ok: false, schritt: null, t: 0, grund: null };
  const durchlauf = (nr) => {
    warten(P, 'Bots an den Stationen', WARTE.bots, () => ['helm', 'weapons', 'technik'].every((k) => g.players.some((p) => p.bot && Station.stationOf(p) === k)));
    // --- stand: Sprungziel, Marker, Tab (das Schiff steht, vorher gilt Allstopp)
    P.cmd({ c: 'captain.selectDest', dest: 'splitter' });
    const mx = 1000 + (o.seed * 97) % 500, my = 350 + (o.seed * 53) % 250;
    P.cmd({ c: 'captain.marker', x: mx, y: my });
    P.run(0.5);   // ein Mensch tippt nicht alles im selben Tick: die Erkennung vergleicht Tick mit Tick
    for (let i = 0; i < 4; i++) { P.cmd({ c: 'station.tab', dir: 1 }); P.run(1); }   // Captain -> Technik -> Steuer -> Ops -> Captain
    warten(P, 'stand abgeschlossen', 10, () => schritt(P) === 'kurs');
    // --- kurs
    befehlen(P, nav, 'nav.kurs', quelle, { ziel: 'marke' });
    warten(P, 'Anflug an die Marke', WARTE.anflug, () => erreicht(P, 'marke_erreicht'));
    befehlen(P, nav, 'nav.stopp', quelle);
    warten(P, 'Schritt ziele', 10, () => schritt(P) === 'ziele');
    // --- ziele: beide Übungsziele nacheinander anvisieren (Anzeigeziel des Captains, dann ops.ziel markiert), dazwischen Scan
    const ids = Object.keys(T.uebung).sort(); const reihe = ungerade ? ids.slice().reverse() : ids;
    P.cmd({ c: 'captain.anzeigeziel', id: T.uebung[reihe[0]].id });
    befehlen(P, 'ops', 'ops.ziel', quelle, { ziel: 'markiert' });
    P.run(1.5);
    P.cmd({ c: 'captain.anzeigeziel', id: T.uebung[reihe[1]].id });
    befehlen(P, 'ops', 'ops.ziel', quelle, { ziel: 'markiert' });
    warten(P, 'Schritt kampf', 10, () => schritt(P) === 'kampf');
    // --- kampf: Abstand zum Ziel (ein Tick nach ops.ziel), Feuer frei, Abschuss, Feuer halt
    P.run(1.5);
    befehlen(P, 'navigation', 'nav.abstand', quelle, { ziel: 'ziel', meter: 250 });
    const ziel = () => g.space.enemies.find((e) => e.id === T.uebung[reihe[1]].id);
    warten(P, 'Schussposition', WARTE.kampf, () => { const e = ziel(); return e && Math.hypot(sh.x - e.x, sh.y - e.y) < 330; });
    befehlen(P, 'ops', 'ops.scan', quelle);   // der Scan braucht Reichweite: erst nach dem Anflug
    P.run(2);
    befehlen(P, 'ops', 'ops.feuer_frei', quelle);
    warten(P, 'Abschuss', WARTE.kampf, () => erreicht(P, 'abschuss'));
    befehlen(P, 'ops', 'ops.feuer_halt', quelle);
    warten(P, 'Schritt reparatur', 10, () => schritt(P) === 'reparatur');
    // --- reparatur: ein beschädigtes System wählen (das am längsten dauernde), dazu freiwillig Status und Automatik
    P.run(0.5);
    const system = ['transfer', 'engines', 'weapon_bow', 'shields'].find((s) => sh.systems[s] !== 'ok');
    if (!system) throw new Haenger('keine Schäden zum Reparieren');
    befehlen(P, 'technik', 'tech.reparieren', quelle, { system });
    befehlen(P, 'alle', 'bot.status', quelle);
    warten(P, 'Reparatur', WARTE.reparatur, () => erreicht(P, 'repariert'));
    befehlen(P, 'alle', 'bot.automatik', quelle);
    warten(P, 'Schritt sprung', 10, () => schritt(P) === 'sprung');
    // --- sprung: Schnellsprung (Route über mehrere Sektoren) und normaler Sprung; ungerade Seeds zuerst normal
    const normalZuerst = ungerade;
    const springen = (dest, bis, was) => {
      P.cmd({ c: 'captain.selectDest', dest }); P.run(1);
      befehlen(P, 'navigation', 'nav.sprung', sprungQuelle, { ziel: 'marke' });
      warten(P, was, WARTE.sprung, () => sh.scene === bis && !g.reise);
      P.run(2);
    };
    if (normalZuerst) { springen('splitter', 'splitter', 'normaler Sprung'); springen('vaelen', 'vaelen', 'Schnellsprung'); }
    else { springen('b7', 'b7', 'Schnellsprung'); springen('splitter', 'splitter', 'normaler Sprung'); }
    warten(P, 'Abzeichen', 6, () => P.abzeichenEreignisse().length >= nr);
    const a = P.abzeichenEreignisse();
    res.ok = a.length === nr && a[nr - 1].id === 'captain' && a[nr - 1].variante === (sprache ? 'sprache' : 'tafel') && g.errors === 0;
    if (!res.ok) res.grund = 'Abzeichen (Versuch ' + nr + ') ' + JSON.stringify(a.map((x) => [x.id, x.variante])) + ', errors ' + g.errors;
  };
  try {
    durchlauf(1);
    if (res.ok) {   // zweiter Versuch: Neustart nach Erfolg, alles auf Anfang
      warten(P, 'Neustart nach Erfolg', 30, () => T.versuch === 2);
      const e = g.mission.def.erwartet || {};
      const flagsStandard = Object.keys(e).every((k) => g.mission.flags[k] === e[k]);
      res.neustartOk = flagsStandard && schritt(P) === g.mission.def.steps[0].id && g.mission.state.objectives.every((o) => !o.done) && T.erreicht.size === 0;
      if (!res.neustartOk) { res.ok = false; res.grund = 'Neustart: Flags ' + flagsStandard + ', Schritt ' + schritt(P) + ', erreicht ' + T.erreicht.size; } else durchlauf(2);
    }
  } catch (e) {
    if (e instanceof Haenger) res.grund = e.message; else throw e;
  }
  res.schritt = schritt(P); res.t = Math.round(g.time); res.errors = g.errors;
  const texte = require('./gen-tra-captain.js').buch(o.variante).texte;   // Hänger-Hinweise (h.*), die im Lauf angesprungen sind
  res.hinweise = P.odas.filter((t) => Object.entries(texte).some(([k, v]) => /^h./.test(k) && v === t)).length;
  return res;
}

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const n = Number(arg('--seeds', 10)); const wahl = arg('--variante', 'beide'); const stt = process.argv.includes('--stt'); const laut = process.argv.includes('--verbose');
  const varianten = wahl === 'beide' ? ['tafel', 'sprache'] : [wahl];
  const summe = {};
  for (const variante of varianten) {
    summe[variante] = { n: 0, ok: 0, t: 0 };
    for (let seed = 1; seed <= n; seed++) {
      const r = lauf({ seed, variante, stt });
      summe[variante].n++; if (r.ok) summe[variante].ok++; summe[variante].t += r.t;
      console.log((r.ok ? 'ok   ' : 'FEHL ') + variante + ' seed ' + seed + ' t ' + r.t + ' s, Schritt ' + r.schritt + ', errors ' + r.errors + ', Hinweise ' + r.hinweise + (r.grund ? ', ' + r.grund : ''));
      if (laut && !r.ok) console.log(JSON.stringify(r));
    }
  }
  let fehl = 0;
  for (const v of varianten) { const s = summe[v]; fehl += s.n - s.ok; console.log('SIM-TRAINING-CAPTAIN ' + v + ': n=' + s.n + ', Abzeichen ' + s.ok + '/' + s.n + ', mittlere Dauer ' + Math.round(s.t / s.n) + ' s' + (stt ? ' (mit Quelle sprache)' : '')); }
  process.exit(fehl ? 1 : 0);
}
module.exports = { partie, lauf, erreicht, befehlen, warten, WARTE };
