'use strict';
// BOT-01 C2b: Statustext fuer bot.status (Katalog v1): ein Satz aus dem Zustand des Bots, kein LLM, keine Spielernamen, knapp (hoechstens 90 Zeichen), seemaennisch-nuechtern.
//   text(game, agent)   Rolle, Absicht und Lage des Bots als Text; liest nur (Agent, game.ship), schreibt nie
// annahme.js uebernimmt den Text als bot.antwort.text (nur bei bot.status, begrenzt); textId bleibt bot.status.ok.
const interior = require('../sim/interior.js');
const { STOP, HALF, FULL } = require('./kern.js');
const Lage = require('./bordlage.js');

const MAX = 90;
const STUFE = ['Stopp', 'Viertel Kraft', 'halbe Kraft', 'dreiviertel Kraft', 'volle Kraft'];   // Index = Stufe der Lerche (STOP .. FULL)
const stufeWort = (s) => (s < STOP ? 'Rückwärts' : s === STOP ? STUFE[0] : s === HALF ? STUFE[2] : s === FULL ? STUFE[4] : STUFE[Math.max(0, Math.min(4, s - STOP))] || STUFE[0]);
const GRUPPE = { bug: 'Bug', bb: 'Backbord', stb: 'Steuerbord', torpedo: 'Torpedo' };
const SEKTOR = ['Bug', 'Steuerbord', 'Heck', 'Backbord'];
const PRIO = { fire: 'Feuer', breach: 'Leck' };
const gross = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ZIEL = { marke: 'die Marke des Captains', ziel: 'das Ops-Ziel', basis: 'die Basis' };

const nav = (g, a, b) => {
  if (!b) return `Kein Befehl, Fahrt ${stufeWort(g.ship.helm.stage)}.`;
  switch (b.name) {
    case 'nav.kurs': return `Kurs auf ${ZIEL[b.args.ziel] || 'das Objekt'}.`;
    case 'nav.abstand': return 'Halte Abstand zum Ziel.';
    case 'nav.andocken': return 'Anflug zum Andocken.';
    case 'nav.sprung': return g.ship.jump && g.ship.jump.ready ? 'Sprungpunkt erreicht.' : 'Fliege zum Sprungpunkt.';
    case 'nav.schub': return `Schub gehalten: ${stufeWort(b.stage)}.`;
    default: return 'Befehl läuft.';
  }
};
const ops = (g, a, b) => {
  const f = a.feuer === 'halt' ? 'Feuer gehalten' : a.waffen ? `Feuer frei, nur ${GRUPPE[a.waffen]}` : 'Feuer frei';
  const z = b && b.name === 'ops.ziel' ? 'Ziel gesetzt' : g.ship.target != null ? 'Ziel erfasst' : 'kein Ziel';
  return `${f}, ${z}${a.halten.scan ? ', scanne' : ''}.`;
};
const technik = (g, a) => {
  const h = a.halten; const t = [];
  if (h.schild !== undefined) t.push(`Schilde nach ${SEKTOR[h.schild]}`);
  if (h.prio) t.push(`${PRIO[h.prio.wert] || gross(interior.sysNameNom(h.prio.wert))} zuerst`);
  if (!t.length) t.push('Schilde nach Bedrohung');
  const rc = g.ship.reactorCtl;
  if (rc && rc.state === 'overload') t.push('Reaktor überladen');
  else if (interior.SYSTEM_ORDER.some((s) => interior.systemAktiv(g, s) && g.ship.systems[s] !== 'ok')) t.push('Schäden an Bord');
  return t.join(', ') + '.';
};

// BOT-02 B1/B2: der Bord-Dienst (kurz, hoechstens 90 Zeichen): Rueckholung, Weg zur Captain-Konsole, Halten des Transfers
// B2-Nacharbeit: der Text zeigt die Lage ehrlich: bei gesperrter Rueckholung (Abklingzeit, Transfer aus) sagt er das, und auf v2-Karten (das Spiel regelt die Rueckholung der liegenden Mannschaft) meldet er nur den Ist-Zustand
function bordText(game, agent, a) {
  const b = agent.bord;
  if (b.tun === 'rueckholen') {
    const sperre = Lage.rueckholSperre(game);
    return sperre === 'transfer' ? 'Transfer ausgefallen, warte auf die Reparatur.' : sperre === 'abklingzeit' ? 'Transfer lädt, warte auf Rückholung.' : 'Hole das Team zurück.';
  }
  if (Lage.allesDowned(game) && !Lage.rueckholAutomatik(game)) return 'Team liegt, Rückholung läuft über das Schiff.';
  if (b.tun === 'captain' && b.weg) return `Gehe zur Captain-Konsole, ${b.weg.art === 'sensor' ? 'Sensor' : 'Kuppel'} für das Team.`;
  return a.zustand === 'an_station' ? 'Halte den Transfer, bis das Team zurück ist.' : 'Unterwegs zum Transfer.';
}

function text(game, agent) {
  const a = agent.absicht;
  if (agent.spieler.downed) return 'Bewusstlos, ohne Auftrag.';
  if (agent.spieler.zone !== 'ship') return 'Nicht an Bord, ohne Auftrag.';
  if (agent.bordDienstLaeuft()) return bordText(game, agent, a);
  if (a.zustand === 'wartet') return 'Ein Mitspieler hat die Station, ich warte.';
  if (a.zustand === 'unterwegs') return 'Unterwegs zur Station.';
  const s = agent.rolleBot === 'navigation' ? nav(game, a, a.befehl) : agent.rolleBot === 'ops' ? ops(game, a, a.befehl) : technik(game, a);
  return s.length > MAX ? s.slice(0, MAX - 1) + '.' : s;
}

module.exports = { text, MAX };
