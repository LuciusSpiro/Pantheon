'use strict';
// BOT-05 B1: die Lage des Schiffs fuer das Gespraech mit einem Bot, nur lesen (Spielzustand wird nie geschrieben). Reine Funktionen, kein Netz.
//   lageAuszug(game, bot)   die echten Werte als Objekt (fehlt ein Wert: null, nie erfunden); B3 prueft damit die Zahlen der Antworten
//   lageZeilen(auszug)      dieselben Werte als Zeilen fuer den Prompt (Ziffern, fehlende Werte als "unbekannt")
//   zustandText(game, bot, agent) / absichtText(game, bot, agent)   Zustand und Absicht des Bots als Text
// Kursumrechnung: Shared_Physics.kompassGrad(ship.angle) wie die Anzeige am Pult. Schiffswinkel (rad): 0 = +x = Osten, y nach unten, im Uhrzeigersinn positiv;
//   Kompass = Winkel in Grad + 90, auf 0..359 gerundet und normiert: 0 = Norden (oben), 90 = Osten, 180 = Sueden, 270 = Westen.
// Schilde: Sektoren 0 Bug, 1 Steuerbord, 2 Heck, 3 Backbord (wie status.js SEKTOR); Prozent = aktuelle Punkte / volle Stärke (CONFIG.shields.maxPerSector = Kappe eines INTAKTEN Emitters, wie die Anzeige am Pult),
//   nicht die gekürzte Kappe des Sektors (B-Nacharbeit W6/K1): ein beschädigter Emitter (Kappe halb) trägt den Zusatz „(Emitter beschädigt)“, ein ausgefallener steht als „0 % (Emitter ausgefallen)“, nie als „unbekannt“.
//   auszug.emitter: { bug|steuerbord|heck|backbord: 'ok' | 'beschaedigt' | 'ausgefallen' | null } (Zustand des Emitters je Sektor; null = unbekannt).
// Ziel: ship.target (Ops-Ziel) aufgeloest in game.space.enemies; Entfernung in m (1 Welt-px = 1 m, wie jump.d) auf 10 gerundet ("grob").
const Physics = require('../../shared/physics.js');
const Locations = require('../../shared/locations.js');
const interior = require('../sim/interior.js');
const Status = require('./status.js');

const SEKTOREN = ['bug', 'steuerbord', 'heck', 'backbord'];
const EMITTER_ZUSTAND = { ok: 'ok', damaged: 'beschaedigt', broken: 'ausgefallen', offline: 'ausgefallen' };   // offline (EMP) wirkt wie zerstört (space.js stateKey)
const SYSTEM_ZUSTAND = { damaged: 'beschädigt', offline: 'offline', broken: 'ausgefallen' };
const ROLLE = {
  navigation: 'Navigation: du fliegst die Lerche (Kurs, Schub, Sprung).',
  ops: 'Ops: du bedienst Waffen und Ziele (Feuer frei oder halt, Ziel erfassen, Scan).',
  technik: 'Technik: du verteilst Energie und Schilde und hältst die Systeme instand.',
};

const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sicher = (f) => { try { return f(); } catch (e) { return null; } };

function schilde(game, ship, em) {
  const sh = ship && ship.shields;
  const voll = game && game.C && game.C.shields ? zahl(game.C.shields.maxPerSector) : null;   // volle Stärke = Kappe eines intakten Emitters (Konfiguration)
  const out = {};
  for (let i = 0; i < 4; i++) {
    const cur = sh && Array.isArray(sh.current) ? zahl(sh.current[i]) : null;
    out[SEKTOREN[i]] = em[SEKTOREN[i]] === 'ausgefallen' ? 0 : cur == null || !(voll > 0) ? null : Math.max(0, Math.min(100, Math.round(cur / voll * 100)));
  }
  return out;
}
function emitter(ship) {
  const out = {};
  for (let i = 0; i < 4; i++) {
    const sys = interior.emitterFor(i);
    const st = ship && ship.systems && sys ? ship.systems[sys] : null;
    out[SEKTOREN[i]] = st == null ? (ship && ship.systems ? 'ok' : null) : (EMITTER_ZUSTAND[st] || null);   // ein fehlender Eintrag heißt wie in space.js sysState: ok
  }
  return out;
}

// null = Ziel nicht bekannt (kein Raum, kein Schiff); { keins: true } = kein Ziel gesetzt; sonst { art, name, entfernung_m } (Felder null, wenn nicht aufloesbar)
function ziel(game, ship) {
  if (!ship || !game.space) return null;
  if (ship.target == null) return { keins: true };
  const e = (game.space.enemies || []).find((q) => q && q.id === ship.target);
  if (!e) return { keins: false, art: null, name: typeof ship.target === 'string' ? ship.target.slice(0, 30) : null, entfernung_m: null };
  const d = zahl(e.x) != null && zahl(ship.x) != null ? Math.hypot(e.x - ship.x, e.y - ship.y) : null;
  return { keins: false, art: typeof e.kind === 'string' ? e.kind : null, name: typeof e.name === 'string' && e.name ? e.name.slice(0, 30) : null, entfernung_m: d == null ? null : Math.round(d / 10) * 10 };
}

function systeme(game, ship) {
  if (!ship || !ship.systems) return null;
  const out = [];
  for (const s of interior.SYSTEM_ORDER) {
    const st = ship.systems[s];
    if (!st || st === 'ok' || !SYSTEM_ZUSTAND[st] || !sicher(() => interior.systemAktiv(game, s))) continue;
    out.push({ system: s, name: (interior.SYS_LABEL && interior.SYS_LABEL[s]) || s, zustand: SYSTEM_ZUSTAND[st] });
  }
  return out;
}

function ort(game) {
  const id = sicher(() => game.explore.location);
  if (!id) return null;
  const L = sicher(() => Locations.get(id));
  return L && L.name ? String(L.name) : null;
}

function lageAuszug(game, bot) {
  const ship = game && game.ship;
  const rc = ship && ship.reactorCtl;
  const stage = ship && ship.helm ? zahl(ship.helm.stage) : null;
  const em = emitter(ship);
  return {
    kurs_grad: ship && zahl(ship.angle) != null ? Physics.kompassGrad(ship.angle) : null,
    schub: stage == null ? null : Status.stufeWort(stage),
    schilde: schilde(game, ship, em),
    emitter: em,
    ziel: ziel(game, ship),
    systeme: systeme(game, ship),
    reaktor: rc && typeof rc.state === 'string' ? { zustand: rc.state, ueberladen: rc.state === 'overload' } : null,
    sprung_bereit: ship && ship.jump && typeof ship.jump.ready === 'boolean' ? ship.jump.ready : null,
    ort: ort(game),
  };
}

const ZIEL_ART = { jaeger: 'Jäger', korvette: 'Korvette', fregatte: 'Fregatte', kreuzer: 'Kreuzer' };
function lageZeilen(a) {
  const u = (v, f) => (v == null ? 'unbekannt' : f ? f(v) : String(v));
  const z = a.ziel;
  let zielText = 'unbekannt';
  if (z && z.keins) zielText = 'keines gesetzt';
  else if (z) zielText = `${z.art ? ZIEL_ART[z.art] || z.art : 'Objekt'}${z.name ? ' ' + z.name : ''}, Entfernung ${z.entfernung_m == null ? 'unbekannt' : 'rund ' + z.entfernung_m + ' m'}`;
  const sys = a.systeme == null ? 'unbekannt' : a.systeme.length ? a.systeme.map((s) => `${s.name} ${s.zustand}`).join(', ') : 'keine ausgefallen oder beschädigt';
  const s = a.schilde, em = a.emitter || {};
  const sch = (k) => (s[k] == null ? 'unbekannt' : s[k] + ' %' + (em[k] === 'ausgefallen' ? ' (Emitter ausgefallen)' : em[k] === 'beschaedigt' ? ' (Emitter beschädigt)' : ''));
  return [
    `Kurs: ${u(a.kurs_grad, (v) => v + ' Grad')} (0 = Norden, 90 = Osten, 180 = Süden, 270 = Westen)`,
    `Schub: ${u(a.schub)}`,
    `Schilde: Bug ${sch('bug')}, Steuerbord ${sch('steuerbord')}, Heck ${sch('heck')}, Backbord ${sch('backbord')}`,
    `Ziel: ${zielText}`,
    `Systeme: ${sys}`,
    `Reaktor: ${a.reaktor == null ? 'unbekannt' : a.reaktor.ueberladen ? 'überladen' : a.reaktor.zustand === 'online' ? 'läuft normal' : a.reaktor.zustand}`,
    `Sprung: ${a.sprung_bereit == null ? 'unbekannt' : a.sprung_bereit ? 'bereit' : 'nicht bereit'}`,
    `Ort: ${u(a.ort)}`,
  ];
}

// Zustand des Bots aus den Spielerfeldern und der Absicht des Agenten (agent kann fehlen: dann "unbekannt")
function zustandText(game, bot, agent) {
  if (!bot) return 'unbekannt';
  if (bot.downed) return 'bewusstlos';
  if (bot.zone && bot.zone !== 'ship') return 'nicht an Bord';
  const z = agent && agent.absicht ? agent.absicht.zustand : null;
  if (z === 'an_station') return 'an seiner Station';
  if (z === 'unterwegs') return 'unterwegs zur Station';
  if (z === 'wartet') return 'wartet, ein Mitspieler hat seine Station';
  return 'unbekannt';
}
function absichtText(game, bot, agent) {
  if (!agent) return 'unbekannt';
  const t = sicher(() => Status.text(game, agent));
  return typeof t === 'string' && t ? t : 'unbekannt';
}
const rolleText = (bot) => ROLLE[bot && bot.rolle] || 'Besatzung ohne feste Station.';

module.exports = { lageAuszug, lageZeilen, zustandText, absichtText, rolleText, SEKTOREN };
