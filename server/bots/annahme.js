'use strict';
// BOT-01 C1: Annahme der Bot-Befehle (Action-Layer, Vertrag Bot-Befehle §3). game.js reicht bot.befehl nur hierher weiter; die Wirkung der Befehle liegt in server/bots/befehle/*.js (C2).
//   annehmen(game, spieler, msg)   Client -> Server { t: 'bot.befehl', an, befehl, args?, quelle }; antwortet dem Absender mit { t: 'bot.antwort', botId, befehl, status, textId, text?, variante? }
//                                  (direkt, keine event-Huelle; je angesprochenem Bot eine Antwort). Wirft nie.
// Pruefreihenfolge: Absender (nur Menschen) > Rate > Phase > Befehlsname > Quelle > Adressat (Rolle/botId passt zum Befehl) > args > Bots aufloesen (kein_bot) > je Bot: wartet > Registry.
// Quellen der Regeln: Befehlsnamen, Rollen und Argumente stehen in content/bots/kanon.json (+ nav.sprung, nicht sprechbar), Gruende je Befehl in content/bots/gruende.json, Texte in content/bots/texte.json.
// "Bestaetigung nie vor der Annahme": ok kommt nur nach erfolgreichem Registry-Aufruf. Fehlende optionale Argumente (ops.feuer_frei waffen, nav.abstand ziel/meter) lehnt die Annahme nicht ab; das Auffuellen gehoert in die Befehle (C2).
// Zustand (Rate, Textvarianten) nur je Game in WeakMaps, nie Modulzustand der Partie.
const Crew = require('../sim/crew.js');
const Protocol = require('../../shared/protocol.js');
const Lauf = require('./lauf.js');
const Befehle = require('./befehle/index.js');
const KANON = require('../../content/bots/kanon.json');
const GRUENDE = require('../../content/bots/gruende.json');
const TEXTE = require('../../content/bots/texte.json');

const QUELLEN = ['menu', 'taste', 'sprache', 'text'];
const ROLLEN_AN = ['navigation', 'ops', 'technik', 'bord'];
const BOT_ID = /^b[0-3]$/;
const OBJEKT_ID = /^(?:objekt|hex):[A-Za-z0-9_.,-]{1,40}$/;
const GRENZE = { meter: [1, 100000], stufe: [0, 6] };   // Wertgrenzen gehoeren dem Server (Vertrag)
const RATE_MAX = 10, RATE_FENSTER_MS = 1000;
const UNBEKANNT = 'befehl';   // Pseudo-Befehl fuer textIds, wenn der Befehlsname unbekannt ist

const hat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istZahlWort = (s) => /^(?:0|[1-9]\d{0,5})$/.test(s);

// ---------- Katalog aus dem Kanon ----------
// { an, args: Map(name -> { werte:Set, muster:[RegExp], pflicht }), meter, quellen }
function baueKatalog() {
  const kat = new Map();
  for (const e of KANON.befehle) {
    let k = kat.get(e.befehl);
    if (!k) { k = { an: e.an, n: 0, args: new Map(), meter: false, quellen: QUELLEN }; kat.set(e.befehl, k); }
    k.n++;
    for (const [name, wert] of Object.entries(e.args || {})) {
      let a = k.args.get(name);
      if (!a) { a = { werte: new Set(), muster: [], n: 0 }; k.args.set(name, a); }
      a.n++;
      const m = /^\{(\w+)\}$/.exec(String(wert));
      if (m) for (const w of Object.keys((e.werte || {})[m[1]] || {})) a.werte.add(w); else a.werte.add(String(wert));
    }
    if (e.meter) k.meter = true;
  }
  for (const k of kat.values()) for (const a of k.args.values()) a.pflicht = a.n === k.n;   // Pflicht = in jeder Sprechform des Befehls vorhanden
  for (const [name, k] of kat) {   // freie Ziele: objekt:<id> / hex:<id> (nicht sprechbar, nur Menue/Taste)
    if (name === 'nav.kurs' || name === 'nav.abstand' || name === 'ops.ziel') k.args.get('ziel').muster.push(OBJEKT_ID);
  }
  // nav.sprung: gueltig, aber nicht im Kanon (Vertrag: nur Menue/Taste, nie Sprache)
  kat.set('nav.sprung', { an: 'navigation', n: 1, meter: false, quellen: ['menu', 'taste'], args: new Map([['ziel', { werte: new Set(['marke', 'ziel', 'basis']), muster: [OBJEKT_ID], pflicht: true, n: 1 }]]) });
  return kat;
}
const KATALOG = baueKatalog();

// ---------- Argumente ----------
function wertOk(name, spec, v) {
  if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) return false;
  const s = String(v);
  if (GRENZE[name] && istZahlWort(s)) return Number(s) >= GRENZE[name][0] && Number(s) <= GRENZE[name][1];
  return spec.werte.has(s) || spec.muster.some((re) => re.test(s));
}
function argsOk(k, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return false;
  const keys = Object.keys(args);
  for (const key of keys) {
    if (key === 'meter' && k.meter) continue;
    if (!k.args.has(key)) return false;
  }
  for (const [name, spec] of k.args) {
    if (!hat(args, name) || args[name] === undefined) { if (spec.pflicht) return false; continue; }
    if (!wertOk(name, spec, args[name])) return false;
  }
  if (hat(args, 'meter') && args.meter !== undefined) {
    const m = args.meter;
    if (typeof m !== 'number' || !Number.isFinite(m) || m < GRENZE.meter[0] || m > GRENZE.meter[1]) return false;
  }
  return true;
}

// ---------- Zustand je Game ----------
const RATEN = new WeakMap();   // game -> Map(spieler.id -> [Zeitstempel ms])
const VARIANTEN = new WeakMap();   // game -> Map(botId|textId -> Zaehler)

function rateFrei(game, spieler) {
  let m = RATEN.get(game); if (!m) { m = new Map(); RATEN.set(game, m); }
  const jetzt = Date.now();
  const liste = (m.get(spieler.id) || []).filter((t) => jetzt - t < RATE_FENSTER_MS);
  if (liste.length >= RATE_MAX) { m.set(spieler.id, liste); return false; }   // abgelehnte Befehle zaehlen nicht mit: kein Dauerzustand
  liste.push(jetzt); m.set(spieler.id, liste);
  return true;
}

// ---------- Antwort ----------
function antwort(game, botId, befehl, status, grund) {
  const name = befehl || UNBEKANNT;
  const textId = grund ? `${name}.${status}.${grund}` : `${name}.${status}`;
  const msg = { t: Protocol.C.BOT_ANTWORT, botId: botId || null, befehl: befehl || null, status, textId };
  const liste = hat(TEXTE, textId) && Array.isArray(TEXTE[textId]) ? TEXTE[textId] : null;
  if (liste && liste.length) {
    let m = VARIANTEN.get(game); if (!m) { m = new Map(); VARIANTEN.set(game, m); }
    const key = (botId || '') + '|' + textId;
    const i = (m.get(key) || 0) % liste.length; m.set(key, i + 1);
    msg.text = liste[i]; msg.variante = i;
  }
  return msg;
}

// ---------- Adressierung ----------
// Rolle des Befehls und Ziel `an` muessen zusammenpassen; nur Befehle fuer `alle` (bot.*) duerfen an mehrere Bots gehen.
const adressatOk = (k, an) => {
  if (k.an === 'alle') return an === 'alle' || BOT_ID.test(an) || (ROLLEN_AN.includes(an) && an !== 'bord');
  return an === k.an || BOT_ID.test(an);
};
function botsFuer(game, an) {
  const bots = game.players.filter((p) => p && p.bot && p.connected);
  if (an === 'alle') return bots;
  if (BOT_ID.test(an)) return bots.filter((p) => p.botId === an);
  return bots.filter((p) => p.rolle === an);
}
const wartetAn = (game, bot) => { const a = Lauf.agent(game, bot); return !!(a && a.absicht && a.absicht.zustand === 'wartet'); };

function fuerBot(game, bot, name, args) {
  const gruende = GRUENDE.befehle[name] || [];
  if (gruende.includes('wartet') && wartetAn(game, bot)) return antwort(game, bot.botId, name, 'abgelehnt', 'wartet');
  let r;
  try { r = Befehle.befehl(game, bot, name, args || {}); } catch (e) { game.countError('bot.befehl', e); r = { ok: false, code: 'unbekannt' }; }
  if (r && r.ok === true) return antwort(game, bot.botId, name, 'ok');
  const code = r && typeof r.code === 'string' && gruende.includes(r.code) ? r.code : 'unbekannt';
  return antwort(game, bot.botId, name, GRUENDE.gruende[code], code);
}

// ---------- Eingang ----------
function antworten(game, spieler, msg) {
  const name = typeof msg.befehl === 'string' && KATALOG.has(msg.befehl) ? msg.befehl : null;
  if (!rateFrei(game, spieler)) return [antwort(game, null, name, 'abgelehnt', 'rate')];
  if (game.phase !== 'play') return [antwort(game, null, name, 'abgelehnt', 'phase')];
  if (!name) return [antwort(game, null, null, 'abgelehnt', 'unbekannt')];
  const k = KATALOG.get(name);
  if (typeof msg.quelle !== 'string' || !k.quellen.includes(msg.quelle)) return [antwort(game, null, name, 'abgelehnt', 'quelle')];
  const an = msg.an;
  if (typeof an !== 'string' || !(an === 'alle' || ROLLEN_AN.includes(an) || BOT_ID.test(an)) || !adressatOk(k, an)) return [antwort(game, null, name, 'abgelehnt', 'adressat')];
  if (!argsOk(k, msg.args)) return [antwort(game, BOT_ID.test(an) ? an : null, name, 'abgelehnt', 'argument')];
  const bots = botsFuer(game, an);
  if (!bots.length) return [antwort(game, BOT_ID.test(an) ? an : null, name, 'unmoeglich', 'kein_bot')];
  if (k.an !== 'alle' && bots.some((b) => b.rolle !== k.an)) return [antwort(game, an, name, 'abgelehnt', 'adressat')];   // botId eines Bots mit anderer Rolle
  const args = msg.args && typeof msg.args === 'object' ? Object.assign({}, msg.args) : {};
  return bots.map((b) => fuerBot(game, b, name, args));
}

function annehmen(game, spieler, msg) {
  try {
    if (!spieler || !spieler.conn || Crew.istBot(spieler) || !msg || typeof msg !== 'object') return;
    for (const a of antworten(game, spieler, msg)) game.sendTo(spieler.conn, a);
  } catch (e) { game.countError('bot.annahme', e); }
}

module.exports = { annehmen, KATALOG, QUELLEN };
