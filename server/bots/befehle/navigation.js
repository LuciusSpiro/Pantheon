'use strict';
// BOT-01 C2a: Registry der Bot-Befehle fuer die Rolle navigation (Vertrag Bot-Befehle, Katalog v1). Jede Funktion: (game, bot, args) => { ok: true } | { ok: false, code }.
// Die Registry liest nur (Navziel, Station.stationOf, Sprung.jammersPresent) und setzt die Absicht des Agenten; sie ruft nie eine Spielfunktion mit Zustandsaenderung auf (der Quellscan in tools/test-bot-befehle-nav.js haelt das fest).
// Codes (content/bots/gruende.json): kein_ziel (das Ziel gibt es nicht), nicht_jetzt (geht in dieser Lage nicht), system (Antrieb zerstoert). Alles andere zaehlt C1 als Fehler.
// Schichten: die Registry prueft Voraussetzungen und setzt die Absicht des Agenten (kurs, abstand, andocken, sprung, schub) bzw. sendet die direkten Befehle (stopp, ausweichen) ueber ihn.
// Die Ausfuehrung des Fluges liegt im Agenten (server/bots/mannschaft.js, Methoden befehlAusfuehren ...), die Ziele in navziel.js. Hier keine Spiellogik des Fluges.
// args kommen normalisiert aus der Annahme (annahme.js): ziel marke|ziel|basis|hex:<id>|objekt:<id>, stufe rueckwaerts|viertel|halb|dreiviertel|voll, meter 1-100000.
const Station = require('../../sim/station.js');
const Sprung = require('../../sim/sprung.js');
const Lauf = require('../lauf.js');
const Navziel = require('../navziel.js');
const { STOP, QUARTER, HALF, THREEQ, FULL } = require('../kern.js');

const NICHT_JETZT = { ok: false, code: 'nicht_jetzt' };
const KEIN_ZIEL = { ok: false, code: 'kein_ziel' };
const SYSTEM = { ok: false, code: 'system' };
const OK = { ok: true };

const maschineAus = (game) => { const st = game.ship.systems && game.ship.systems.engines; return st === 'broken' || st === 'offline'; };

// Gemeinsame Vorpruefung. o.bewegt: der Befehl setzt das Schiff in Bewegung (Antrieb noetig); o.aussenteam: mit Aussenteam unten nicht (das Schiff muss in Beamreichweite bleiben,
// Entscheidung des Leiters aus Paket B, Bericht 8.3 Nr. 3); o.station: der Bot muss jetzt an der Steuer sitzen (direkte Befehle gehen als cmd sofort raus, ein Bot unterwegs koennte sie nicht ausfuehren).
// -> { agent } oder { fehler: { ok: false, code } }
function vorab(game, bot, o) {
  const agent = Lauf.agent(game, bot);
  if (!agent || bot.downed || bot.zone !== 'ship') return { fehler: NICHT_JETZT };
  if (o.station && Station.stationOf(bot) !== 'helm') return { fehler: NICHT_JETZT };
  if (o.aussenteam && (agent.aussenteamUnten() || agent.lauf.stoppNoetig())) return { fehler: NICHT_JETZT };   // stoppNoetig: auch das Pad-Signal (Mensch will beamen, Schiff zu schnell): ehrlich nicht_jetzt statt ok ohne Wirkung
  if (o.bewegt && maschineAus(game)) return { fehler: SYSTEM };
  return { agent };
}

// Stufe -> Index der Lerche (shared/config.js lerche.stages [R, STOPP, ein Viertel, halb, drei Viertel, voll]): rueckwaerts = Index STOP - 1 (die Rueckwaertsstufe), STOPP ist nav.stopp.
const STUFEN = { rueckwaerts: STOP - 1, viertel: QUARTER, halb: HALF, dreiviertel: THREEQ, voll: FULL };
function stufenIndex(stufe) {
  return Object.prototype.hasOwnProperty.call(STUFEN, stufe) ? STUFEN[stufe] : STOP;   // die Annahme laesst nur die fuenf Woerter durch; alles andere waere Stopp
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

// Stopp ist nav.stopp (Absicht weg, helm.stop, Standardverhalten). Mit Aussenteam unten nur Stopp (Beamreichweite, Bericht 8.3 Nr. 3), jede Schubstufe (auch rueckwaerts) nicht_jetzt.
// Skala = die Stufen des Schiffs (Kais Entscheidung 2026-11-24): rueckwaerts, viertel, halb, dreiviertel, voll.
nav['nav.schub'] = (game, bot, args) => {
  const stage = stufenIndex(args.stufe);
  if (stage === STOP) return nav['nav.stopp'](game, bot, args);
  const v = vorab(game, bot, { bewegt: true, aussenteam: true });
  if (v.fehler) return v.fehler;
  v.agent.befehlSetzen('nav.schub', args, { stage });
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

// Sprung: nur ziel marke = das Sprungziel, das der Captain gewaehlt hat (ship.jump.dest); die Wahl bleibt beim Captain (captain.selectDest), die Registry waehlt nie ein Ziel und schreibt keinen Spielzustand.
// hex:<id>, ziel, basis und objekt: kein_ziel. Der Bot fliegt zum Sprungpunkt und springt (helm.jump, bei gewaehlter Route helm.schnellsprung). Was die Lage verbietet (Reise laeuft, Stoersender, Aussenteam, Transfer,
// Missionssperre, Antrieb ohne Energie): nicht_jetzt; nur der Anflug selbst (Navziel.sprungGrundOffen) ist kein Hindernis.
nav['nav.sprung'] = (game, bot, args) => {
  const v = vorab(game, bot, { bewegt: true, aussenteam: true });
  if (v.fehler) return v.fehler;
  if (args.ziel !== 'marke') return KEIN_ZIEL;
  const j = game.ship.jump || {};
  if (game.reise || Sprung.jammersPresent(game) || game.transfer.isBeaming(game)) return NICHT_JETZT;
  if (!j.dest) return KEIN_ZIEL;
  if (!Navziel.sprungGrundOffen(j.blockedReason)) return NICHT_JETZT;
  v.agent.befehlSetzen('nav.sprung', args, { dest: j.dest });
  return OK;
};

module.exports = nav;
