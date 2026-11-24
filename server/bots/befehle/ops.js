'use strict';
// BOT-01 C2b: Registry der Bot-Befehle fuer die Rolle ops (Vertrag Bot-Befehle, Katalog v1). Jede Funktion: (game, bot, args) => { ok: true } | { ok: false, code }.
// Codes (content/bots/gruende.json): kein_ziel (ops.ziel, ops.feuer_frei: es gibt kein Ziel), nicht_jetzt (geht in dieser Lage nicht), system (Waffen bzw. Transfer ausgefallen). Alles andere zaehlt C1 als Fehler.
// Schichten: die Registry prueft Voraussetzungen und setzt die Absicht des Agenten (Ziel, Feuerzustand, Scan) bzw. sendet die Einmal-Aktionen (Landescan, Beamen) ueber ihn (einmalig, Wachposten).
// Die Ausfuehrung (Ziel halten, Feuer filtern) liegt im Agenten (server/bots/mannschaft.js, opsDienst). args kommen normalisiert aus der Annahme: ziel naechstes|markiert|objekt:<id>, waffen alle|bug|bb|stb|torpedo, was person|fracht.
const Station = require('../../sim/station.js');
const Space = require('../../sim/space.js');
const interior = require('../../sim/interior.js');
const Waffen = require('../../sim/schiffswaffen.js');
const CaptainZiel = require('../../sim/captainziel.js');
const Lauf = require('../lauf.js');

const NICHT_JETZT = { ok: false, code: 'nicht_jetzt' };
const KEIN_ZIEL = { ok: false, code: 'kein_ziel' };
const SYSTEM = { ok: false, code: 'system' };
const OK = { ok: true };

const aus = (st) => st === 'broken' || st === 'offline';

// Gemeinsame Vorpruefung. o.station: der Bot muss jetzt an der Ops-Konsole sitzen (Einmal-Aktionen gehen als cmd sofort raus). -> { agent } oder { fehler }
function vorab(game, bot, o) {
  const agent = Lauf.agent(game, bot);
  if (!agent || bot.downed || bot.zone !== 'ship') return { fehler: NICHT_JETZT };
  if (o.station && Station.stationOf(bot) !== 'weapons') return { fehler: NICHT_JETZT };
  return { agent };
}

const ops = {};

// markiert = die Captain-Marke, naechstes = naechster aufschaltbarer Gegner, objekt:<id> = dieses Objekt (nur Menue/Taste). Gesetzt wird die Absicht; der Agent sendet weapons.target und haelt das Ziel bis zur Zerstoerung.
ops['ops.ziel'] = (game, bot, args) => {
  const v = vorab(game, bot, {});
  if (v.fehler) return v.fehler;
  let id = null;
  if (args.ziel === 'markiert') { const cz = CaptainZiel.gueltig(game); id = cz ? cz.id : null; }
  else if (args.ziel === 'naechstes') { const e = v.agent.naechsterGegner(); id = e ? e.id : null; if (!e && game.space.enemies.length) return NICHT_JETZT; }   // Gegner da, aber ausserhalb der Sensoren
  else { const m = /^objekt:(.+)$/.exec(args.ziel); id = m && Space.resolveTarget(game, m[1]) ? m[1] : null; }
  if (id == null) return KEIN_ZIEL;
  const rt = Space.resolveTarget(game, id);
  if (!rt) return KEIN_ZIEL;
  if ((rt.type === 'enemy' || rt.type === 'mine') && !v.agent.aufschaltbar(rt)) return NICHT_JETZT;   // ausserhalb der Sensoren: weapons.target wuerde abgewiesen
  v.agent.befehlSetzen('ops.ziel', args, { id });
  return OK;
};

// Ohne waffen = alle (Vertrag §3). Ohne Ziel (keine Captain-Marke, keine Ops-Marke, kein Gegner in der Szene): kein_ziel. Eine Gruppe ohne Waffe: nicht_jetzt; ist sie (oder jede Waffe) ausgefallen: system.
ops['ops.feuer_frei'] = (game, bot, args) => {
  const v = vorab(game, bot, {});
  if (v.fehler) return v.fehler;
  const waffen = args.waffen || 'alle';
  const aktiv = interior.WEAPON_SYSTEMS.filter((s) => interior.systemAktiv(game, s));
  if (aktiv.length && aktiv.every((s) => aus(game.ship.systems[s]))) return SYSTEM;
  if (!CaptainZiel.gueltig(game) && game.ship.target == null && !game.space.enemies.length) return KEIN_ZIEL;
  if (waffen !== 'alle') {
    const ids = v.agent.gruppeMounts(waffen);
    if (!ids.length) return NICHT_JETZT;
    if (ids.every((id) => aus(Waffen.mountState(game, id)))) return SYSTEM;
  }
  v.agent.feuerSetzen('frei', waffen === 'alle' ? null : waffen);
  return OK;
};

ops['ops.feuer_halt'] = (game, bot) => {
  const v = vorab(game, bot, {});
  if (v.fehler) return v.fehler;
  v.agent.feuerSetzen('halt', null);
  return OK;
};

// Scan: weapons.scan jetzt (das Spiel sagt, ob es geht: kein Ziel, zu weit), danach haelt der Agent ihn bis das Ziel gescannt ist
ops['ops.scan'] = (game, bot) => {
  const v = vorab(game, bot, { station: true });
  if (v.fehler) return v.fehler;
  if (v.agent.einmalig('weapons.scan', { on: true })) return NICHT_JETZT;
  v.agent.haltenSetzen('scan', { id: game.ship.target, bis: game.time + 8 });
  return OK;
};

ops['ops.landescan'] = (game, bot) => {
  const v = vorab(game, bot, { station: true });
  if (v.fehler) return v.fehler;
  return v.agent.landescanSenden() ? NICHT_JETZT : OK;   // Orbit, Landepunkt in Scanreichweite, Scan laeuft schon: das Spiel antwortet
};

ops['ops.beamen'] = (game, bot, args) => {
  const v = vorab(game, bot, { station: true });
  if (v.fehler) return v.fehler;
  if (aus(game.ship.systems.transfer)) return SYSTEM;
  return v.agent.einmalig(args.was === 'person' ? 'weapons.person' : 'weapons.fracht') ? NICHT_JETZT : OK;   // nichts in Reichweite, Frachtraum voll, Transfer laeuft: das Spiel antwortet
};

module.exports = ops;
