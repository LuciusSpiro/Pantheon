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
const StatusTon = require('./status-ton.js');   // BOT-05 B2: Stimme zur Statusantwort (nur mit Voicebox)
const TexteFiguren = require('./texte-figuren.js');   // BOT-05 A3: Liste je Figur (Rueckfall: texte.json); dieselbe Quelle wie der Clip-Vorrat

const QUELLEN = ['menu', 'taste', 'sprache', 'text'];
const ROLLEN_AN = ['navigation', 'ops', 'technik', 'bord'];
const BOT_ID = /^b[0-3]$/;
const OBJEKT_ID = /^objekt:[A-Za-z0-9_.,-]{1,40}$/;   // ops.ziel: nur objekt:<id> (Vertrag §3)
const HEX_ODER_OBJEKT_ID = /^(?:objekt|hex):[A-Za-z0-9_.,-]{1,40}$/;   // nav.kurs, nav.abstand, nav.sprung
const DELTA = { '1': 1, '+1': 1, '-1': -1 };
const GRENZE = { meter: [1, 100000] };   // Wertgrenzen gehoeren dem Server (Vertrag)
const RATE_MAX = 10, RATE_FENSTER_MS = 1000;
const UNBEKANNT = 'befehl';   // Pseudo-Befehl fuer textIds, wenn der Befehlsname unbekannt ist

const hat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

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
  for (const [name, k] of kat) {   // freie Ziele: objekt:<id> / hex:<id> (nicht sprechbar: gelten nur bei Quelle menu/taste, siehe pruefeWert)
    if (name === 'nav.kurs' || name === 'nav.abstand') k.args.get('ziel').muster.push(HEX_ODER_OBJEKT_ID);
    if (name === 'ops.ziel') k.args.get('ziel').muster.push(OBJEKT_ID);
  }
  // nav.sprung: gueltig, aber nicht im Kanon (Vertrag: nur Menue/Taste, nie Sprache)
  kat.set('nav.sprung', { an: 'navigation', n: 1, meter: false, quellen: ['menu', 'taste'], args: new Map([['ziel', { werte: new Set(['marke', 'ziel', 'basis']), muster: [HEX_ODER_OBJEKT_ID], pflicht: true, n: 1 }]]) });
  return kat;
}
const KATALOG = baueKatalog();

// ---------- Argumente ----------
// Prueft einen Wert und liefert den normalisierten (stufe: eines der Stufenwoerter des Kanons; delta: Zahl 1/-1; sonst String), undefined = ungueltig.
// menue: Quelle menu/taste; nur dort gelten die freien Ziele objekt:<id> / hex:<id> (nicht sprechbar).
function pruefeWert(name, spec, v, menue) {
  if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) return undefined;
  const s = String(v);
  if (name === 'delta') return hat(DELTA, s) && spec.werte.has(String(DELTA[s])) ? DELTA[s] : undefined;
  return spec.werte.has(s) || (menue && spec.muster.some((re) => re.test(s))) ? s : undefined;
}
// Liefert eine normalisierte Kopie der args oder null (abgelehnt argument). Die Registry sieht nie das Original.
function pruefeArgs(k, args, menue) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return null;
  for (const key of Object.keys(args)) {
    if (key === 'meter' && k.meter) continue;
    if (!k.args.has(key)) return null;
  }
  const out = {};
  for (const [name, spec] of k.args) {
    if (!hat(args, name) || args[name] === undefined) { if (spec.pflicht) return null; continue; }
    const w = pruefeWert(name, spec, args[name], menue);
    if (w === undefined) return null;
    out[name] = w;
  }
  if (hat(args, 'meter') && args.meter !== undefined) {
    const m = args.meter;
    if (typeof m !== 'number' || !Number.isFinite(m) || m < GRENZE.meter[0] || m > GRENZE.meter[1]) return null;
    out.meter = m;
  }
  return out;
}

// Rueckmeldungen der Befehle (C2): { ok: true } oder { ok: false, code } mit einem Code aus gruende.json fuer diesen Befehl (u. a. kein_ziel, nicht_jetzt, system). Alles andere (Ausnahme, fehlender oder nicht vorgesehener Code)
// wird zu abgelehnt/fehler und per game.countError('bot.grund') sichtbar gezaehlt. args gehen normalisiert (delta als Zahl) als Kopie an die Registry; hex:/objekt:-Ziele nur bei Quelle menu/taste.
// Rate: je Spieler 10 je Sekunde; nur die erste Ablehnung im Fenster wird beantwortet, weitere werden still verworfen.
// ---------- Zustand je Game ----------
const RATEN = new WeakMap();   // game -> Map(spieler.id -> { t: [Zeitstempel ms], gemeldet })
const VARIANTEN = new WeakMap();   // game -> Map(botId|textId -> Zaehler)

// 'frei' = angenommen, 'melden' = erste Ablehnung im Fenster (wird beantwortet), 'still' = weitere Ablehnung im selben Fenster (verworfen, keine Antwort: keine Flut)
function rateStand(game, spieler) {
  let m = RATEN.get(game); if (!m) { m = new Map(); RATEN.set(game, m); }
  const jetzt = Date.now();
  const z = m.get(spieler.id) || { t: [], gemeldet: false };
  z.t = z.t.filter((t) => jetzt - t < RATE_FENSTER_MS);
  m.set(spieler.id, z);
  if (z.t.length >= RATE_MAX) {   // abgelehnte Befehle zaehlen nicht mit: kein Dauerzustand
    if (z.gemeldet) return 'still';
    z.gemeldet = true; return 'melden';
  }
  z.t.push(jetzt); z.gemeldet = false;
  return 'frei';
}

// ---------- Antwort ----------
function antwort(game, botId, befehl, status, grund) {
  const name = befehl || UNBEKANNT;
  const textId = grund ? `${name}.${status}.${grund}` : `${name}.${status}`;
  const msg = { t: Protocol.C.BOT_ANTWORT, botId: botId || null, befehl: befehl || null, status, textId };
  const liste = TexteFiguren.listeFuer(botId, textId, TEXTE);   // BOT-05 A3: Figurvarianten ersetzen die Grundliste nur fuer diese Figur; ohne botId oder ohne Figurliste gilt texte.json
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
// BOT-02 B1: 'bord' ist keine Rolle eines Bots, sondern der Zusatzdienst des Bord-Bots (lauf.js bordBot): an: bord trifft ihn, "alle" schliesst bord aus (bot.* gelten fuer jeden Bot ueber seine Rolle)
function botsFuer(game, an) {
  const bots = game.players.filter((p) => p && p.bot && p.connected);
  if (an === 'alle') return bots;
  if (an === 'bord') { const b = Lauf.bordBot(game); return b && b.connected ? [b] : []; }
  if (BOT_ID.test(an)) return bots.filter((p) => p.botId === an);
  return bots.filter((p) => p.rolle === an);
}
const passtZurRolle = (game, k, b) => (k.an === 'bord' ? Lauf.bordBot(game) === b : b.rolle === k.an);
const wartetAn = (game, bot) => { const a = Lauf.agent(game, bot); return !!(a && a.absicht && a.absicht.zustand === 'wartet'); };

// BOT-01 C2b: nur bot.status bringt einen eigenen Text aus dem Zustand des Bots (status.js); er ersetzt den Text der Variante, textId und variante bleiben. Zeilenumbrueche raus, Laenge begrenzt. Fuer alle anderen Befehle wird der Registry-Text weiter ignoriert.
const STATUS_MAX = 120;
function statusText(msg, name, r) {
  if (name !== 'bot.status' || typeof r.text !== 'string') return msg;
  const t = r.text.replace(/[\r\n]+/g, ' ').trim().slice(0, STATUS_MAX);
  if (t) msg.text = t;
  return msg;
}
// BOT-02 B1: haelt der Bot den Bord-Dienst (lauf.js dienstLaeuft), steht er nicht an seiner Station: Rollenbefehle (nav., ops., tech.) gehen nicht, ehrlich nicht_jetzt statt ok mit spaeterer Wirkung.
// Ausnahmen: bot.* (status, automatik) und bord.* (eigene Registry).
const ROLLENBEFEHL = /^(?:nav|ops|tech)\./;
function fuerBot(game, bot, name, args) {
  const gruende = GRUENDE.befehle[name] || [];
  if (gruende.includes('wartet') && wartetAn(game, bot)) return antwort(game, bot.botId, name, 'abgelehnt', 'wartet');
  if (ROLLENBEFEHL.test(name) && gruende.includes('nicht_jetzt') && Lauf.dienstLaeuft(game, bot)) return antwort(game, bot.botId, name, GRUENDE.gruende.nicht_jetzt, 'nicht_jetzt');
  let r, ursache = null;
  try { r = Befehle.befehl(game, bot, name, Object.assign({}, args)); } catch (e) { ursache = 'ausnahme: ' + (e && e.message); }
  if (!ursache && r && r.ok === true) return statusText(antwort(game, bot.botId, name, 'ok'), name, r);
  const code = r && typeof r.code === 'string' ? r.code : null;
  if (!ursache && code && gruende.includes(code)) return antwort(game, bot.botId, name, GRUENDE.gruende[code], code);
  // Ein Fehlerpfad: Ausnahme, kein Code oder ein Code, der fuer den Befehl nicht in gruende.json steht -> abgelehnt fehler, sichtbar gezaehlt (Luecken in gruende.json)
  game.countError('bot.grund', new Error(`${name}: ${ursache || 'Code ' + JSON.stringify(code)} (ok ${JSON.stringify(r && r.ok)})`));
  return antwort(game, bot.botId, name, GRUENDE.gruende.fehler, 'fehler');
}

// ---------- Eingang ----------
function antworten(game, spieler, msg) {
  const name = typeof msg.befehl === 'string' && KATALOG.has(msg.befehl) ? msg.befehl : null;
  const rate = rateStand(game, spieler);
  if (rate === 'still') return [];
  if (rate === 'melden') return [antwort(game, null, name, 'abgelehnt', 'rate')];
  if (game.phase !== 'play') return [antwort(game, null, name, 'abgelehnt', 'phase')];
  if (!name) return [antwort(game, null, null, 'abgelehnt', 'unbekannt')];
  const k = KATALOG.get(name);
  if (typeof msg.quelle !== 'string' || !k.quellen.includes(msg.quelle)) return [antwort(game, null, name, 'abgelehnt', 'quelle')];
  const an = msg.an;
  if (typeof an !== 'string' || !(an === 'alle' || ROLLEN_AN.includes(an) || BOT_ID.test(an)) || !adressatOk(k, an)) return [antwort(game, null, name, 'abgelehnt', 'adressat')];
  const args = pruefeArgs(k, msg.args, msg.quelle === 'menu' || msg.quelle === 'taste');
  if (!args) return [antwort(game, BOT_ID.test(an) ? an : null, name, 'abgelehnt', 'argument')];
  const bots = botsFuer(game, an);
  if (!bots.length) return [antwort(game, null, name, 'unmoeglich', 'kein_bot')];   // BOT-05 Nacharbeit: die Figur spielt nicht mit, also spricht sie auch nicht (kein Figurtext, keine eigene Stimme): Grundtext, botId null
  if (k.an !== 'alle' && bots.some((b) => !passtZurRolle(game, k, b))) return [antwort(game, an, name, 'abgelehnt', 'adressat')];   // botId eines Bots mit anderer Rolle (bord: nicht der Bord-Bot)
  return bots.map((b) => fuerBot(game, b, name, args));
}

function annehmen(game, spieler, msg) {
  try {
    if (!spieler || !spieler.conn || Crew.istBot(spieler) || !msg || typeof msg !== 'object') return;
    const liste = antworten(game, spieler, msg);
    for (const a of liste) game.sendTo(spieler.conn, a);
    if (msg.befehl === 'bot.status') StatusTon.sprechen(game, spieler, liste);   // BOT-05 B2: Stimme zur Statusantwort (asynchron, ohne Voicebox ohne Wirkung)
  } catch (e) { game.countError('bot.annahme', e); }
}

module.exports = { annehmen, KATALOG, QUELLEN };
