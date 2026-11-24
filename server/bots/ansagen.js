'use strict';
// BOT-02 B4: Ansagen des Bord-Bots an den Menschen unten (Action-Layer, Vertrag Bot-Befehle §3 bot.antwort). Nur der Bot im laufenden Bord-Dienst (mannschaft.js bordDienst ruft tick) sagt an; Quelle sind die Daten, die heute die
// Captain-Konsole im Reiter „Außenteam“ bekommt, kein freies LLM, keine Spielernamen, hoechstens 90 Zeichen je Text.
//   tick(game, bot)   einmal je Tick des Bord-Dienstes: prueft (hoechstens alle PRUEF_S) die Ansagen und sendet hoechstens eine je Empfaenger
// Arten (textId bord.ansage.<art>, die Texte stehen in content/bots/texte.json, Platzhalter {FOLGE} {LAGE} {HINWEIS}, die textId nennt nie ein Argument):
//   code     die Codefolge des Kustodenpults (Farben der drei Symbole in der Reihenfolge der Eingabe, aus codeTable und kustodenpult.symbols): einmal je Karte, und nur, wenn die ODA-Codehilfe waehrend des Dienstes ausgeloest wurde
//            (away.js: dasselbe Ereignis wie die ODA-Funkmeldung; mit Bord-Bot im Dienst schweigt die ODA, weichen.js bordBotHaelt). Die Folge hat nie mehr als drei Paare, sie passt in eine Ansage
//   gegner   Gegner, die das Team kennt (e.vis: Sicht eines Mitspielers, Sensor, Captain-Fokus = was die Captain-Konsole zeigt), der Mensch unten aber nicht selbst sieht (combat.gesehenVonSpieler): Richtung (Himmelsrichtung) und
//            Entfernung (Meter = Kacheln, 1 Kachel = 1 m wie im Voxelbild); nur bei Neuzugang oder geaenderter Zahl, nie derselbe Text zweimal in WIEDERHOLUNG_S
//   raetsel  Hinweis des Raetselpaares (shared/buehne.js raetselHinweis: solo nacheinander mit Fenster, in der Gruppe gleichzeitig), wenn der Mensch bei einem ungeloesten Schloss steht; einmal je Paar und Karte
// Haeufigkeit: hoechstens eine Ansage je ABSTAND_S je Empfaenger; gibt es mehrere Anlaesse, kommt die Art mit der aeltesten letzten Ansage zuerst (code, gegner, raetsel bei Gleichstand). Zustand nur je Game in einer WeakMap, nie Modulzustand der Partie, nie ein Feld an game.
// Die Ansage ist KEINE Antwort auf einen Befehl: botId null, befehl 'bord.ansage', status ok, kein Clip, keine Quittung im Menue (bot-menue.js/bot-sprache.js kennen sie), und sie geht nicht durch annahme.js (Rate und Varianten dort bleiben unberuehrt).
const Crew = require('../sim/crew.js');
const Combat = require('../sim/combat.js');
const Anker = require('../sim/anker.js');
const Buehne = require('../../shared/buehne.js');
const Physics = require('../../shared/physics.js');
const Protocol = require('../../shared/protocol.js');
const TEXTE = require('../../content/bots/texte.json');

const BEFEHL = 'bord.ansage';
const MAX_ZEICHEN = 90;
const PRUEF_S = 0.5;           // Pruefabstand (Sekunden Spielzeit)
const ABSTAND_S = 8;           // hoechstens eine Ansage je Empfaenger in diesem Abstand
const WIEDERHOLUNG_S = 30;     // derselbe Text nie zweimal in diesem Abstand
const RAETSEL_KACHELN = 3;     // „steht an einem Raetsel“: ein ungeloestes Schloss in diesem Umkreis
const NAMEN = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
const ZAHL = ['Kein', 'Ein', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun'];
const FARBE = { mint: 'Mint', bernstein: 'Bernstein', rot: 'Rot', blau: 'Blau', pink: 'Pink', weiss: 'Weiß' };
const SYMBOL = { kreis: 'Kreis', dreieck: 'Dreieck', raute: 'Raute', stern: 'Stern', welle: 'Welle', kreuz: 'Kreuz' };

const ZUSTAND = new WeakMap();   // game -> { runId, pruef, varianten: Map(textId -> Zaehler), codeStart: WeakMap(codeTable -> Flag beim ersten Blick), je: Map(spieler.id -> Zustand je Empfaenger) }

// ---------- Texte ----------
function zustandVon(game) {
  let z = ZUSTAND.get(game);
  if (!z || z.runId !== game.runId) { z = { runId: game.runId, pruef: -1e9, varianten: new Map(), codeStart: new WeakMap(), je: new Map() }; ZUSTAND.set(game, z); }
  return z;
}
function empfaengerVon(z, p, aw) {
  let e = z.je.get(p.id);
  if (!e) { e = { aw: null, letzte: -1e9, zuletzt: { code: -1e9, gegner: -1e9, raetsel: -1e9 }, bekannt: new Set(), text: new Map(), codeDone: new WeakSet(), raetsel: new Set() }; z.je.set(p.id, e); }
  if (e.aw !== aw) { e.aw = aw; e.bekannt = new Set(); e.text = new Map(); e.raetsel = new Set(); }   // neue Karte: Gegner, Wiederholungen und Raetsel von vorn (die Codefolge haengt an der codeTable der Karte)
  return e;
}
// Vorlage der textId mit Platzhaltern fuellen (die Varianten wechseln sich je textId ab); nie laenger als MAX_ZEICHEN
function fuelle(vorlage, werte) {
  const t = vorlage.replace(/\{(\w+)\}/g, (m, k) => (werte[k] != null ? werte[k] : m));
  return t.length > MAX_ZEICHEN ? t.slice(0, MAX_ZEICHEN - 1).replace(/[,\s]+$/, '') + '.' : t;
}
function formuliere(z, textId, werte) {
  const liste = TEXTE[textId];
  if (!Array.isArray(liste) || !liste.length) return null;
  const i = (z.varianten.get(textId) || 0) % liste.length; z.varianten.set(textId, i + 1);
  return { text: fuelle(liste[i], werte), variante: i };
}

// ---------- Arten ----------
// code: „Kreis Mint, Dreieck Bernstein, Raute Rot“
function codeFolge(away) {
  const sym = (away.kustodenpult && away.kustodenpult.symbols) || [], tab = away.codeTable || {};
  const teile = sym.filter((s) => tab[s]).map((s) => (SYMBOL[s] || s) + ' ' + (FARBE[tab[s]] || tab[s]));
  return teile.length ? teile.join(', ') : null;
}
function artCode(game, z, e, p) {
  const away = game.away;
  if (away.map !== 'platform' || !away.kustodenpult || !away.codeTable) return null;
  const tab = away.codeTable;
  if (!z.codeStart.has(tab)) z.codeStart.set(tab, !!away.odaCodeHelp);   // Stand beim ersten Blick des Dienstes auf diese Tabelle
  if (z.codeStart.get(tab) || !away.odaCodeHelp || away.kustodenpult.disabled || e.codeDone.has(tab)) return null;   // schon beim ersten Blick da: die Hilfe kam nicht waehrend dieses Dienstes (ODA oder frueher), nicht zweimal vorlesen
  const folge = codeFolge(away);
  if (!folge) return null;
  return { art: 'code', werte: { FOLGE: folge }, fertig: () => e.codeDone.add(tab) };
}
// gegner: Gruppen je Himmelsrichtung, naechste zuerst
const kompass = (p, q) => NAMEN[(Math.round(Math.atan2(q.x - p.x, p.y - q.y) / (Math.PI / 4)) + 8) % 8];   // Norden = Bildschirm oben (y wird kleiner)
const meter = (px) => { const m = px / Physics.TILE; return Math.max(1, m >= 10 ? Math.round(m / 2) * 2 : Math.round(m)); };
function unsichtbareGegner(game, p) {
  const aw = game.away;
  return (aw.drones || []).filter((d) => d.alive !== false && d.vis && !Combat.gesehenVonSpieler(game, p, d));
}
function lage(p, liste) {
  const gr = new Map();
  for (const d of liste) {
    const r = kompass(p, d), dist = Math.hypot(d.x - p.x, d.y - p.y);
    const g = gr.get(r) || { n: 0, dist: Infinity, r }; g.n++; g.dist = Math.min(g.dist, dist); gr.set(r, g);
  }
  const gs = Array.from(gr.values()).sort((a, b) => a.dist - b.dist);
  const satz = (g) => `${ZAHL[g.n] || g.n} Gegner im ${g.r}, etwa ${meter(g.dist)} Meter.`;
  let t = satz(gs[0]);
  for (const g of gs.slice(1, 2)) if ((t + ' ' + satz(g)).length <= MAX_ZEICHEN - 14) t += ' ' + satz(g);   // 14 = laengste Vorsilbe der Vorlagen
  return t;
}
function artGegner(game, z, e, p, jetzt) {
  const liste = unsichtbareGegner(game, p);
  if (!liste.length) { e.bekannt = new Set(); return null; }   // niemand mehr unbekannt: ein spaeteres Auftauchen ist wieder neu
  const ids = new Set(liste.map((d) => d.id));
  const neu = liste.some((d) => !e.bekannt.has(d.id)), zahl = ids.size !== e.bekannt.size;
  if (!neu && !zahl) return null;
  const t = lage(p, liste);
  const letzt = e.text.get(t);
  if (letzt != null && jetzt - letzt < WIEDERHOLUNG_S) { e.bekannt = ids; return null; }   // dieselbe Meldung kurz vorher: nicht noch einmal (die Lage gilt als gemeldet)
  return { art: 'gegner', werte: { LAGE: t }, schluessel: t, fertig: () => { e.bekannt = ids; e.text.set(t, jetzt); } };
}
// raetsel: ein ungeloestes Schloss in der Naehe, einmal je Paar und Karte
function artRaetsel(game, z, e, p) {
  const r = Anker.raetselNahe(game, p, RAETSEL_KACHELN);
  if (!r || e.raetsel.has(r.paar)) return null;
  let h = Buehne.raetselHinweis(r.solo, r.fenster);
  if (!/[.!?]$/.test(h)) h += '.';
  return { art: 'raetsel', werte: { HINWEIS: h }, fertig: () => e.raetsel.add(r.paar) };
}

// ---------- Eingang ----------
const menschenUnten = (game) => game.players.filter((p) => p && p.connected && p.conn && !Crew.istBot(p) && p.zone === 'away' && !p.downed);
function sende(game, p, z, a) {
  const f = formuliere(z, 'bord.ansage.' + a.art, a.werte);
  if (!f) return false;
  game.sendTo(p.conn, { t: Protocol.C.BOT_ANTWORT, botId: null, befehl: BEFEHL, status: 'ok', textId: 'bord.ansage.' + a.art, text: f.text, variante: f.variante });
  return true;
}
function tick(game, bot) {
  try {
    if (!game || game.phase !== 'play' || !bot || !game.away || !game.away.active) return;
    const z = zustandVon(game), jetzt = game.time;
    if (jetzt - z.pruef < PRUEF_S) return;
    z.pruef = jetzt;
    for (const p of menschenUnten(game)) {
      const e = empfaengerVon(z, p, game.away);
      if (jetzt - e.letzte < ABSTAND_S) continue;
      // Anlaesse einsammeln, die Art mit der aeltesten letzten Ansage kommt zuerst (bei Gleichstand code, gegner, raetsel): in einer Flut von Gegnermeldungen verhungert der Raetselhinweis nicht
      const a = [artCode(game, z, e, p), artGegner(game, z, e, p, jetzt), artRaetsel(game, z, e, p)].filter(Boolean).sort((x, y) => e.zuletzt[x.art] - e.zuletzt[y.art])[0];
      if (!a) continue;
      if (sende(game, p, z, a)) { a.fertig(); e.letzte = jetzt; e.zuletzt[a.art] = jetzt; }
    }
  } catch (err) { game.countError('bot.ansage', err); }
}

module.exports = { tick, fuelle, codeFolge, lage, kompass, meter, BEFEHL, MAX_ZEICHEN, ABSTAND_S, WIEDERHOLUNG_S, PRUEF_S, RAETSEL_KACHELN };
