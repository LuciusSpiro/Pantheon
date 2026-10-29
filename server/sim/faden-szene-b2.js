'use strict';
// SUND-04b B2: die Szenenarten konvoi und geleit der Faden-Szenen (faden-szene.js ruft sie an den vier festen Stellen: beginnen = plan, kampfBeginn = beginn, kampfTakt = ausgang, aufraeumen).
// Zahlen und Texte stehen in content/faeden/szenen-werte.json (werte konvoi, geleit; texte vorwarnung, gelungen, gescheitert je textKey), nichts davon im Code. Keine Mission: die Szene ruft die Sim-Module
// direkt (Konvoi.an in server/sim/konvoi.js, Escort.spawn in server/sim/escort.js), nie den Labor-Pfad (der schriebe m1-m3 in den Weltstand). Die Szene ist nicht speicherbar (faden-szene.js).
//
//   istArt(art)                               konvoi | geleit
//   plan(it, crew, nachCrew) -> { textKey, n, sieg?, eskorte?, modus? }     vor der Vorwarnung: die angekündigte Zahl (Transporter bzw. Angreifer) und die Wahl des Beats (Parameter sieg bzw. modus, ungültig = Standard der Daten)
//   beginn(game, fs) -> true | false | 'kein_platz'     Kampf beginnt: Konvoi bzw. Schützling und Angreifer; false = nicht möglich (Szene scheitert); 'kein_platz' = die Escort-Engine hat keinen Platz für den Schützling (keine Szene, kein Scheitern: der Beat steht wieder aus)
//   ausgang(game, fs) -> 'gelungen' | 'gescheitert' | null                  Ausgang aus dem Konvoi-Ausgang bzw. dem Zustand des Schützlings, oder die Höchstdauer
//   aufraeumen(game, fs)                      Konvoi, Eskorte, Beute am Boden bzw. Schützling und Angreifer gehen (jedes Ende: Ausgang, Unterbrechung, Sprung, Andocken)
const DATEN = require('../../content/faeden/szenen-werte.json');
const Konvoi = require('./konvoi.js');
const Escort = require('./escort.js');
const Fracht = require('./fracht.js');
const Zielsysteme = require('./zielsysteme.js');

const W = Object.fromEntries(Object.entries(DATEN.werte).map(([k, v]) => [k, v.wert]));
const ARTEN = ['konvoi', 'geleit'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
let spaceMod = null;
const space = () => spaceMod || (spaceMod = require('./space.js'));
const istArt = (art) => ARTEN.includes(art);
// der Beat nennt seine Wahl als Parameter (sieg, modus): nur was in den Daten steht, sonst der Standard
const wahl = (it, schluessel, liste, standard) => { const b = it && it.parameter && it.parameter.beat; const v = b && has(b, schluessel) ? b[schluessel] : null; return typeof v === 'string' && liste.includes(v) ? v : standard; };

function plan(it, crew, nachCrew, game) {
  if (it.art === 'konvoi') {
    const K = W.konvoi, k = String(Math.min(3, Math.max(1, crew))), n = nachCrew(K.anzahl, crew);
    let sieg = wahl(it, 'sieg', K.siegen, K.sieg_standard);
    // Plündern braucht Platz für die Beute (Konvoi.an: beuteMin = Zahl der Transporter, höchstens die Kapazität): ist der Frachtraum zu voll oder fehlt er, wäre die Szene nicht zu gewinnen (beamStart lehnt ab),
    // also gilt der Beat als aufhalten. Kein Fehler, kein Funktext darüber: die Szene bleibt gewinnbar.
    if (sieg === 'pluendern' && game && Fracht.frei(game) < Math.min(n, Math.max(1, Fracht.capacity(game)))) sieg = 'aufhalten';
    return { textKey: sieg === 'pluendern' ? 'konvoi_pluendern' : 'konvoi', n, sieg, eskorte: has(K.eskorte, k) ? K.eskorte[k] : 'voll' };
  }
  const G = W.geleit, modus = wahl(it, 'modus', Object.keys(G.modi), G.modus_standard);
  return { textKey: modus, n: nachCrew(G.modi[modus].angreifer, crew), modus };
}

// ---------- Kampf beginnt
function beginn(game, fs) {
  if (fs.art === 'konvoi') {
    const K = W.konvoi, p = fs.plan;
    const k = Konvoi.an(game, { n: fs.n, eskorte: p.eskorte, sieg: p.sieg, ladung: K.ladung, wiederholung: false, volk: K.volk });
    if (k) Fracht.state(game).szenenBeute = { art: K.ladung, vor: Fracht.anBord(game, K.ladung) };   // was schon an Bord liegt, gehoert nicht zur Beute dieser Szene (fracht.js nimmt die Beute auch aus dem Speicherstand)
    if (k) for (const e of game.space.enemies) if (e.kv) e.tag = fs.tag;   // Transporter und Eskorte tragen den Tag der Szene: auch ohne Konvoi-Zustand raeumt faden-szene.js sie ab
    return !!k;
  }
  const G = W.geleit, M = G.modi[fs.plan.modus], L = game.ship;
  const nach = M.verhalten === 'folgt_kurs' ? ferneSeite(game, G.ziele) : null;
  const name = fs.nsc && fs.nsc.schiff ? fs.nsc.schiff : undefined;
  const es = Escort.spawn(game, { tag: fs.tag, kind: M.kind, name, verhalten: M.verhalten, von: 'lerche', nach, huelle: M.huelle, reparatur_s: M.reparatur_s });
  if (!es) return 'kein_platz';   // die Engine kennt hoechstens zwei Schuetzlinge: das ist kein Scheitern der Crew, die Szene beginnt spaeter (faden-szene.js unterbrechen), es kommen keine Angreifer
  const A = G.angreifer;
  for (let i = 0; i < fs.n; i++) {
    const a = (i / Math.max(1, fs.n)) * Math.PI * 2 + W.ring_winkel_start;
    space().spawnEnemy(game, A.klasse, { x: L.x + Math.cos(a) * A.ring, y: L.y + Math.sin(a) * A.ring, tag: fs.tag, volk: A.volk, ziel: fs.tag });
  }
  return true;
}
// die Seite (Daten ziele), die von der Lerche aus weiter entfernt liegt: das Geleit hat einen Weg zu fahren
function ferneSeite(game, seiten) {
  const L = game.ship; let best = null, bd = -1;
  for (const s of seiten) { const p = Escort.point(game, s); if (!p || p.x == null) continue; const d = Math.hypot(p.x - L.x, p.y - L.y); if (d > bd) { bd = d; best = s; } }
  return best;
}

// ---------- Takt des Kampfes
function ausgang(game, fs) {
  const dauer = game.time - fs.start;
  if (fs.art === 'konvoi') {
    if (Konvoi.ausgang(game)) return Konvoi.erfolg(game) ? 'gelungen' : 'gescheitert';
    if (!Konvoi.aktiv(game) || dauer > W.konvoi.max_s) return 'gescheitert';   // Konvoi weg (Szene verlassen) oder zu lange
    return null;
  }
  const M = W.geleit.modi[fs.plan.modus];
  const es = Escort.find(game, fs.tag);
  if (!es) return 'gescheitert';
  if (es.state === 'kampfunfaehig' || es.state === 'zerstoert') return 'gescheitert';
  if (M.erfolg === 'angekommen' && es.arrived) return 'gelungen';
  if (M.erfolg === 'repariert' && es.repaired) return 'gelungen';
  if (M.erfolg === 'angreifer_weg' && !game.space.enemies.some((e) => e.tag === fs.tag)) return 'gelungen';
  if (dauer > W.geleit.max_s) return 'gescheitert';
  return null;
}

// ---------- Aufräumen
// Die Beute dieser Szene (Ladung K.ladung, die seit dem Beginn an Bord kam) übernimmt der Auftraggeber: jedes Ende der Szene nimmt sie aus dem Frachtraum. Nur die eigene Beute (Zugang seit dem Beginn), nie fremde Fracht.
function beuteUebergeben(game) {
  const st = Fracht.state(game), b = st.szenenBeute;
  if (!b) return;
  st.szenenBeute = null;
  const lager = st.lager;
  let zuviel = Math.max(0, Fracht.anBord(game, b.art) - b.vor), weg = 0;
  for (let i = lager.length - 1; i >= 0 && zuviel > 0; i--) if (lager[i].art === b.art) { lager.splice(i, 1); zuviel--; weg++; }
  if (weg && DATEN.texte.beute_uebernommen) game.emit('radio', { from: DATEN.texte.sprecher, text: DATEN.texte.beute_uebernommen, lage: 1 });
}
function aufraeumen(game, fs) {
  const sp = game.space;
  if (fs.art === 'konvoi') {
    if (fs.phase !== 'kampf') return;   // im Vorlauf gibt es noch keinen Konvoi, und ein fremder bleibt unberuehrt
    const k = sp.konvoi;
    const weg = sp.enemies.filter((e) => e.kv);
    if (weg.length) sp.enemies = sp.enemies.filter((e) => !e.kv);
    if (weg.some((e) => e.id === game.ship.target)) Zielsysteme.zielLoeschen(game);
    if (k && k.pods && k.pods.length) { const s = Fracht.state(game); s.draussen = s.draussen.filter((d) => !k.pods.includes(d.id)); }   // Beute am Boden, die niemand geholt hat, bleibt nicht liegen
    sp.konvoi = null;
    beuteUebergeben(game);
    return;
  }
  if (sp.escorts) sp.escorts = sp.escorts.filter((q) => q.tag !== fs.tag);
  if (sp.escortsGone) sp.escortsGone = sp.escortsGone.filter((q) => q.tag !== fs.tag);
}

module.exports = { istArt, plan, beginn, ausgang, aufraeumen, ARTEN };
