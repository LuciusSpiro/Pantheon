'use strict';
// BOT-01 C2a: Registry der Bot-Befehle fuer die Rolle navigation (Vertrag Bot-Befehle, Katalog v1). Jede Funktion: (game, bot, args) => { ok: true } | { ok: false, code }.
// Codes (content/bots/gruende.json): kein_ziel (das Ziel gibt es nicht), nicht_jetzt (geht in dieser Lage nicht), system (Antrieb zerstoert). Alles andere zaehlt C1 als Fehler.
// Schichten: die Registry prueft Voraussetzungen und setzt die Absicht des Agenten (kurs, abstand, andocken, sprung, schub) bzw. sendet die direkten Befehle (stopp, ausweichen) ueber ihn.
// Die Ausfuehrung des Fluges liegt im Agenten (server/bots/mannschaft.js, Methoden befehlAusfuehren ...), die Ziele in navziel.js. Hier keine Spiellogik des Fluges.
// args kommen normalisiert aus der Annahme (annahme.js): ziel marke|ziel|basis|hex:<id>|objekt:<id>, stufe 0-6|halb|voll, meter 1-100000.
const Station = require('../../sim/station.js');
const Sprung = require('../../sim/sprung.js');
const Sektoren = require('../../../shared/sektoren.js');
const Lauf = require('../lauf.js');
const Navziel = require('../navziel.js');
const { STOP, HALF, FULL } = require('../kern.js');

const NICHT_JETZT = { ok: false, code: 'nicht_jetzt' };
const KEIN_ZIEL = { ok: false, code: 'kein_ziel' };
const SYSTEM = { ok: false, code: 'system' };
const OK = { ok: true };

const maschineAus = (game) => { const st = game.ship.systems && game.ship.systems.engines; return st === 'broken' || st === 'offline'; };

// Gemeinsame Vorpruefung. o.bewegt: der Befehl setzt das Schiff in Bewegung (Antrieb noetig); o.aussenteam: mit Aussenteam unten nicht (das Schiff muss in Beamreichweite bleiben,
// Entscheidung des Leiters aus Paket B); o.station: der Bot muss jetzt an der Steuer sitzen (direkte Befehle gehen als cmd sofort raus, ein Bot unterwegs koennte sie nicht ausfuehren).
// -> { agent } oder { fehler: { ok: false, code } }
function vorab(game, bot, o) {
  const agent = Lauf.agent(game, bot);
  if (!agent || bot.downed || bot.zone !== 'ship') return { fehler: NICHT_JETZT };
  if (o.station && Station.stationOf(bot) !== 'helm') return { fehler: NICHT_JETZT };
  if (o.aussenteam && agent.aussenteamUnten()) return { fehler: NICHT_JETZT };
  if (o.bewegt && maschineAus(game)) return { fehler: SYSTEM };
  return { agent };
}

// Stufe -> Index der Lerche: Schub 0 = STOPP, 1 bis 4 = ein Viertel, halbe, drei Viertel, volle Kraft; darueber (Matcher erlaubt bis 6) = volle Kraft. halb/voll = die Stufen halb und voll.
function stufenIndex(stufe) {
  if (stufe === 'halb') return HALF;
  if (stufe === 'voll') return FULL;
  return Math.min(FULL, STOP + Math.max(0, Math.round(Number(stufe)) || 0));
}

const nav = {};

nav['nav.kurs'] = (game, bot, args) => {
  const v = vorab(game, bot, { bewegt: true, aussenteam: true });
  if (v.fehler) return v.fehler;
  const z = Navziel.aufloesen(game, args.ziel);
  if (!z) return KEIN_ZIEL;
  v.agent.befehlSetzen('nav.kurs', args, { ziel: z });
  return OK;
};

nav['nav.stopp'] = (game, bot) => {
  const v = vorab(game, bot, { station: true });
  if (v.fehler) return v.fehler;
  if (game.ship.docked) { v.agent.befehlVerwerfen('stopp'); return OK; }   // angedockt steht das Schiff schon (helm.stop wuerde abgewiesen)
  v.agent.stoppen();
  return OK;
};

nav['nav.schub'] = (game, bot, args) => {
  const v = vorab(game, bot, { bewegt: true });
  if (v.fehler) return v.fehler;
  v.agent.befehlSetzen('nav.schub', args, { stage: stufenIndex(args.stufe) });
  return OK;
};

nav['nav.ausweichen'] = (game, bot) => {
  const v = vorab(game, bot, { bewegt: true, station: true });
  if (v.fehler) return v.fehler;
  if (game.ship.docked || game.ship.dodgeCd > 0) return NICHT_JETZT;   // space.dodge: erst ablegen, Rolle laedt noch
  v.agent.ausweichenNun();   // ein laufender Kurs bleibt: das Ausweichen ist ein Manoever, kein neuer Kurs
  return OK;
};

// Ohne ziel: die Captain-Marke, sonst die Ops-Marke (Vertrag §3, Standardwerte); mit ziel genau dieses. meter ohne Angabe: Standardabstand (Agent).
nav['nav.abstand'] = (game, bot, args) => {
  const v = vorab(game, bot, { bewegt: true, aussenteam: true });
  if (v.fehler) return v.fehler;
  const z = args.ziel ? Navziel.aufloesen(game, args.ziel) : (Navziel.aufloesen(game, 'marke') || Navziel.aufloesen(game, 'ziel'));
  if (!z) return KEIN_ZIEL;
  v.agent.befehlSetzen('nav.abstand', args, { ziel: z, meter: args.meter || null });
  return OK;
};

nav['nav.andocken'] = (game, bot) => {
  const v = vorab(game, bot, { bewegt: true, aussenteam: true });
  if (v.fehler) return v.fehler;
  if (game.ship.docked && game.ship.dockedAt === game.ship.scene) { v.agent.befehlVerwerfen('angedockt'); return OK; }   // schon da
  if (!Navziel.dockLage(game)) return KEIN_ZIEL;
  v.agent.befehlSetzen('nav.andocken', {}, {});
  return OK;
};

// Sprung: marke = das Sprungziel, das der Captain gewaehlt hat (ship.jump.dest); hex:<id> waehlt es wie captain.selectDest. ziel, basis und objekt sind keine Sektoren: kein_ziel.
// Der Bot fliegt zum Sprungpunkt und springt (helm.jump, bei gewaehlter Route helm.schnellsprung). Was die Lage verbietet (Reise laeuft, Stoersender, Aussenteam, Transfer, Missionssperre): nicht_jetzt.
nav['nav.sprung'] = (game, bot, args) => {
  const v = vorab(game, bot, { bewegt: true, aussenteam: true });
  if (v.fehler) return v.fehler;
  const j = game.ship.jump || {};
  if (game.reise || Sprung.jammersPresent(game) || game.transfer.isBeaming(game)) return NICHT_JETZT;
  const hex = /^hex:(\d{4})$/.exec(args.ziel);
  if (args.ziel === 'marke') {
    if (!j.dest) return KEIN_ZIEL;
    const grund = j.blockedReason || '';
    if (grund && !/^(Sprungpunkt|Erst ablegen|Zu nah an der Station|Sprungantrieb|Antrieb ohne Energie)/.test(grund) && !/^Kein Sprungpunkt/.test(grund)) return NICHT_JETZT;
  } else if (hex) {
    if (!Sektoren.hatSzene(hex[1])) return KEIN_ZIEL;
    if (Sprung.selectDest(game, hex[1])) return NICHT_JETZT;   // Fehlertext des Spiels (gesperrt, keine Route, gleicher Sektor ...)
  } else return KEIN_ZIEL;
  if (!game.ship.jump.dest) return KEIN_ZIEL;
  v.agent.befehlSetzen('nav.sprung', args, { dest: game.ship.jump.dest });
  return OK;
};

module.exports = nav;
