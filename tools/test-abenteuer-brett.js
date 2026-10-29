'use strict';
// SUND-04b C: Auftragsbrett der Freien Fahrt Sund, Server-Seite (server/sim/abenteuer-brett.js, Daten content/faeden/abenteuer-brett.json und anschluss.json): Abenteuer in der Freien Fahrt annehmen, spielen,
// die Ausgaenge wirken, der Anschluss ist garantiert. Ohne Oberflaeche: Paket D rendert world.abenteuer und sendet abenteuer.annehmen / abenteuer.ablehnen.
// Die Erwartungen stehen hier selbst (aus den Daten und von Hand gerechnet), nie aus dem Produktivcode abgeleitet. Der Test laeuft durch die ECHTEN Hooks: den Befehl ueber game.handleMessage (drei Clients),
// den Snapshot (game.snapshot, Block world.abenteuer), game.lageGrenze, Game.step, faden_weiter und den Befehl faden.bitte; er ruft nie Faden.beatAusgang und baut die Zuordnung nicht nach.
// Geprueft wird: Daten und Anschluss-Plaene · Snapshot (Block, Vorschau aus den Daten, keine Namen, Loeschsignal, Schluessel) · Befehle (annehmen, ablehnen, erste Antwort, Codes, Eingabe, Prototype-Keys,
// ohne Spielleiter, am Boden) · Wiedersehen (juengster Kandidat, NSC_VON, Verdraengung, Deckel) · Ende wirkt (Chronik, Logbuch, Haltung, Scheitern) · Anschluss-Garantie (nach dem Ende, Start, Laden, Lage,
// nie der letzte Plan, deterministisch, LLM-Ausfall, aus) · ohne Spielleiter laeuft die Welt weiter · Weltstand (Angebote, Altstand, Muell) · drei Spieler · ohne Schalter nichts.
// Aufruf: node tools/test-abenteuer-brett.js [begriff ...]        (npm run test:abenteuer-brett)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Chronik = require('../server/sim/chronik.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const BP = require('../server/sim/faden-bauplan.js');
const Bitte = require('../server/sim/faden-bitte.js');
const B2 = require('../server/sim/faden-b2.js');

const { D, Faden, F } = X;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const BRETT = lies('content/faeden/abenteuer-brett.json'), ANS = lies('content/faeden/anschluss.json'), WERTE = lies('content/faeden/werte.json').werte, HW = lies('content/faeden/haltung-werte.json').werte;
const BEATS = lies('content/faeden/beats.json').beats;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const GILT = WERTE.abenteuer.wert.angebot_gilt_taetigkeiten, MAXA = WERTE.abenteuer.wert.angebote_max;
const CODES = ['modus', 'kein_angebot', 'schon_beantwortet', 'unbekannt', 'kein_spielleiter', 'laeuft_schon', 'kein_platz', 'veraltet', 'fehler', 'am_boden'];

// ---------------------------------------------------------------- Hilfen
// Spiel mit Lage-Spielleiter (Mock). o.ab = abenteuerWerte (Standard: der Komponist ist still, deckel 0: nur der Rueckfall), o.env ergaenzt, o.ohne: ohne Rueckfall
function neu(seed, o) {
  o = o || {};
  // das Spiel entsteht mit abgeschaltetem Rueckfall (die ersten Schritte laufen mit dem Spielleiter des Spiels), der Wunsch des Tests gilt danach
  const wunsch = o.env && 'ABENTEUER_ANSCHLUSS' in o.env ? o.env.ABENTEUER_ANSCHLUSS : undefined;
  const t = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: Object.assign({ FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' }, o.env || {}, { ABENTEUER_ANSCHLUSS: '0' }) });
  if (wunsch === undefined) delete t.g.env.ABENTEUER_ANSCHLUSS; else t.g.env.ABENTEUER_ANSCHLUSS = wunsch;
  const llm = LLM.create(o.llm || { mode: 'mock' });
  t.g.lageSpielleiter = LS.create(t.g, { llm, werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: Object.assign({ deckel_je_sitzung: 0 }, o.ab || {}) });
  t.g.lageSchalter = true;
  t.c = t.cs[0];
  t.cmd = (k, extra, c) => t.g.handleMessage(c || t.c, Object.assign({ t: 'cmd', c: k }, extra || {}));
  t.antw = (c) => (c || t.c).inbox.filter((m) => m.t === 'event' && m.kind === 'abenteuerAntwort');
  t.letzte = (c) => { const a = t.antw(c); return a[a.length - 1]; };
  t.an = (id, c) => { t.cmd('abenteuer.annehmen', { id }, c); return t.letzte(c); };
  t.ab = (id, c) => { t.cmd('abenteuer.ablehnen', { id }, c); return t.letzte(c); };
  return t;
}
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats }, o || {});
const b = (typ, o) => Object.assign({ typ }, o || {});
const bitteplan = (i, o) => plan([b('bitte', { verzweigung: { gescheitert: 'e' } }), b('geruecht'), b('abschluss', { id: 'e' })], Object.assign({ titel: 'Bitte ' + i, anlass: 'Probeanlass Nummer ' + i + ' ohne Namen' }, o || {}));
// ein Plan, der ohne Reise und Kampf zu Ende geht: der Notruf wird beantwortet (die Crew ist am Ort) oder verfaellt (Frist), dann der Abschluss
const notrufplan = (i, o) => plan([b('notruf'), b('abschluss')], Object.assign({ titel: 'Notruf ' + i, anlass: 'Probeanlass Nummer ' + i + ' ohne Namen' }, o || {}));
const zust = (g) => Faden.zustandVon(g);
const offen = (g) => zust(g).abenteuerAngebote;
const liste = (g) => g.weltsim.faeden.liste;
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const grenzen = (g, k, art) => { for (let i = 0; i < k; i++) g.lageGrenze(art || 'andocken'); };
const anbieten = (g, p, hex) => Faden.abenteuerAnbieten(g, p, { hex: hex || '0305' });
// der erste Snapshot, der den Block traegt (null = Loeschsignal), sonst undefined (der Schluessel ist schon gesendet)
function block(g) { for (let i = 0; i < 40; i++) { const s = g.snapshot(); if ('abenteuer' in s.world) return s.world.abenteuer; } return undefined; }
const keinBlock = (g) => { for (let i = 0; i < 30; i++) if ('abenteuer' in g.snapshot().world) return false; return true; };
function startBeat(g, f) {   // wie der Spielleiter: nach dem Abstand der Befehl faden_weiter (ueber den echten Befehlsweg)
  for (let i = 0; i < 12; i++) {
    const bt = { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id };
    if (Faden.befehlPruefen(g, bt) === null) return Faden.befehlAnwenden(g, bt);
    grenzen(g, 1);
  }
  return { ok: false };
}
// ein Notruf-Abenteuer zu Ende spielen: wahl 'gelungen' (die Crew ist am Ort: zwei Schritte, Ankunft) oder 'scheitern' (die Frist des Beats laeuft ab), dann der Abschluss (jeweils ueber faden_weiter)
function spiele(t, f, wahl) {
  const g = t.g;
  startBeat(g, f);
  if (wahl === 'scheitern') grenzen(g, WERTE.beat_frist.wert + 1); else { g.step(); g.step(); }
  startBeat(g, f);
  return f.phase === 'abgeschlossen';
}
// ein Angebot (Plan) ueber den Befehl annehmen und spielen; liefert den Faden
function annehmenUndSpielen(t, p, wahl, hex) {
  const a = anbieten(t.g, p, hex);
  if (!a.ok) return { a };
  const r = t.an('a' + a.angebot.nr);
  const f = liste(t.g).find((x) => x.plan && x.vorlage === a.angebot.ref);
  if (!r || !r.ok || !f) return { a, r };
  return { a, r, f, fertig: spiele(t, f, wahl) };
}
const frei = () => new Promise((r) => setImmediate(r));
const wipe = (g) => { zust(g).abenteuerAngebote.length = 0; };
const hexname = (hex) => Sektoren.hexName(hex);
const rangAb = (id) => lies('content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === id).ab;
function postenSetzen(g, hex, besitzer) {
  Object.assign(g.weltsim.zustand.hexe[hex], { besitzer, posten: true, garnison: 4, anspruch: {} });
  if (g.weltBesitz && g.weltBesitz.hexe[hex]) g.weltBesitz.hexe[hex] = { besitzer: { rom: 'rom', ger: 'ger', kon: 'saum' }[besitzer] || 'frei', posten: true };
}
const refs = (g) => offen(g).map((a) => a.vorlage.beats[0].typ);

// ======================================================================
section('Daten: Brett-Texte, Weigerungen, Anschluss-Plaene (3 bis 6, durch denselben Expander und Pruefer)', () => {
  ok(Object.keys(D.BEATS).every((typ) => BRETT.schritte[typ] && typeof BRETT.schritte[typ].text === 'string' && BRETT.schritte[typ].text.length >= 3 && BRETT.schritte[typ].text.length <= BRETT.werte.schritt_max.wert && Object.values(BRETT.schritte[typ].varianten || {}).every((t) => t.length >= 3 && t.length <= BRETT.werte.schritt_max.wert)), 'jeder Beat-Typ des Katalogs (' + Object.keys(D.BEATS).length + ') hat einen kurzen Klartext-Schritt (hoechstens ' + BRETT.werte.schritt_max.wert + ' Zeichen, auch die Varianten)');
  ok(Object.values(BRETT.schritte).every((e) => Object.entries(e.varianten || {}).every(([k, t]) => { const [typ, p, v] = k.split(':'); const s = BEATS[typ] && BEATS[typ].bauplan && BEATS[typ].bauplan.parameter && BEATS[typ].bauplan.parameter[p]; return s && Array.isArray(s.erlaubt) && s.erlaubt.includes(v) && typeof t === 'string'; })), 'jede Variante nennt einen erlaubten Wert eines Parameters des Katalogs');
  ok(WERTE.status.wert.every((s) => s in BRETT.status_scheitern) && Object.keys(BRETT.status_gelingen).every((s) => WERTE.status.wert.includes(s)), 'Zustaende des NSC: jeder hat einen Eintrag fuer das Scheitern, keiner ist unbekannt');
  ok(CODES.every((c) => typeof BRETT.weigerungen[c] === 'string' && BRETT.weigerungen[c].length > 5), 'jede Weigerung der Befehle hat einen Text (' + CODES.join(', ') + ')');
  const alle = JSON.stringify([BRETT.schritte, BRETT.weigerungen, BRETT.folgen, BRETT.chronik, BRETT.status_gelingen, BRETT.status_scheitern]);
  ok(!/\{name\}/.test(JSON.stringify(BRETT.chronik)) && (alle.match(/\{\w+\}/g) || []).every((p) => ['{ort}', '{fraktion}', '{delta}'].includes(p)), 'Platzhalter nur {ort} {fraktion} {delta}; die Chronik nennt nie den Namen des NSC (sie geht in den Prompt des Spielleiters)');
  ok(ANS.plaene.length >= 3 && ANS.plaene.length <= 6, 'Anschluss-Plaene: 3 bis 6 (' + ANS.plaene.length + ')');
  const ergebnisse = ANS.plaene.map((p) => BP.pruefe(p));
  ok(ergebnisse.every((r) => r.ok), 'jeder Anschluss-Plan besteht Expander und Pruefer' + ergebnisse.filter((r) => !r.ok).map((r) => ' ' + r.fehler[0]).join(''));
  ok(new Set(ergebnisse.map((r) => r.vorlage && r.vorlage.id)).size === ANS.plaene.length, 'die Plaene sind verschieden (verschiedene Vorlagen-Ids)');
  const typen = new Set(ANS.plaene.map((p) => p.beats[0].typ));
  ok(['geruecht', 'konvoi', 'sabotage', 'wiedersehen'].every((x) => typen.has(x)), 'die Typgruppen Geruecht, Konvoi, Sabotage und Wiedersehen sind vertreten');
  ok(ANS.plaene.every((p) => p.beats.length === 2 && p.beats[1].typ === 'abschluss' && !/[{}]/.test(p.titel + p.anlass)), 'kleine Plaene (Beat und Abschluss), Titel und Anlass ohne Platzhalter');
  ok(ANS.plaene.every((p) => !NAMEN.some((x) => (p.titel + p.anlass).includes(x))), 'keine Spielernamen in Titel und Anlass');
});

section('Snapshot world.abenteuer: Block, Vorschau aus den Daten, Loeschsignal, Schluessel, Budget', () => {
  const t = neu(21, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  ok(keinBlock(g), 'ohne Angebot und ohne laufendes Abenteuer: kein Feld world.abenteuer');
  const a1 = anbieten(g, bitteplan(0, { titel: 'Mireille_Kas Bitte', anlass: 'Mireille_Kas braucht Hilfe bei Ouzo_Brandt' }));
  const a2 = anbieten(g, plan([b('geruecht'), b('spur'), b('abschluss')], { titel: 'Spur und Gerucht', anlass: 'Ein Gerucht ohne Namen im Anlass' }));
  const a3 = anbieten(g, plan([b('konvoi'), b('geleit', { parameter: { modus: 'havarist' } }), b('abschluss')], { titel: 'Konvoi und Geleit', anlass: 'Zwei Szenen hintereinander im Sektor' }));
  ok(a1.ok && a2.ok && a3.ok, 'drei Angebote');
  const s = block(g);
  ok(s && s.ok === 1 && s.kopf === BRETT.werte.kopf.wert && s.ablehnen === BRETT.werte.ablehnen_text.wert && s.scheitern === BRETT.werte.scheitern_text.wert, 'Block: ok 1 (Spielleiter da), Kopf, Hinweis zum Ablehnen und zum Scheitern aus den Daten');
  ok(s && s.angebote.length === 3 && s.angebote.map((x) => x.id).join() === ['a' + a1.angebot.nr, 'a' + a2.angebot.nr, 'a' + a3.angebot.nr].join(), 'drei Angebote mit den Ids a<Nummer> in der Reihenfolge des Anbietens');
  const e1 = s.angebote[0], e2 = s.angebote[1], e3 = s.angebote[2], V = (e) => e.vorschau, hs = HW.quellen.wert;
  ok(e1.ort === '0305' && e1.ortname === hexname('0305') && e1.rest === GILT && V(e1).schritte.length === 3, 'Ort (Hex und Name), Verfall in Taetigkeiten (' + GILT + '), drei Schritte (Bitte, Gerücht, Abschluss)');
  ok(e1.titel.includes('Crew') && !NAMEN.some((x) => e1.titel.includes(x)), 'Titel ohne Spielername (der Name ist durch Crew ersetzt)');
  ok(!NAMEN.some((x) => JSON.stringify(s).includes(x)) && !/Mireille|Ouzo|Tzvi/.test(JSON.stringify(s)), 'der Block nennt keinen Spielernamen (auch nicht im Anlass)');
  ok(s.angebote.every((e) => e.von === 'rom') && e1.aus_geruecht === true && e2.aus_geruecht === true && e3.aus_geruecht === false, 'von: Fraktion des Auftraggebers (Ostia Nova: rom); aus_geruecht: nur Plaene mit einem Geruecht-Beat');
  ok(V(e1).gefahr === false && V(e2).gefahr === false && V(e3).gefahr === true && V(e3).schritte.map((x) => x.gefahr).join() === 'true,true,false' && V(e1).schritte.every((x) => x.gefahr === false), 'vorschau.gefahr (bool) aus den Daten der Beats: Konvoi und Geleit sind Gefahr, Bitte, Geruecht, Abschluss nicht');
  ok(V(e1).schritte[0].text === BRETT.schritte.bitte.text && V(e1).schritte.every((x) => typeof x.text === 'string' && x.text.length <= 28), 'Schritte als { text, gefahr }: Klartext aus den Daten, hoechstens 28 Zeichen');
  const wahl = V(e1).schritte[0].wahl;
  ok(wahl && wahl.length === 2 && wahl.every((w) => typeof w.text === 'string' && Array.isArray(w.folgen)), 'die Bitte zeigt ihre Wahl im Voraus (zwei Optionen aus den Daten, mit Folgen)');
  ok(JSON.stringify(wahl[0].folgen) === JSON.stringify([{ f: 'rom', art: 'haltung', d: hs.geholfen.delta }]) && JSON.stringify(wahl[1].folgen) === JSON.stringify([{ f: 'rom', art: 'haltung', d: hs.bitte_abgelehnt.delta }]), 'Folgen der Optionen als Marken { f, art, d }: Haltung ' + hs.geholfen.delta + ' bei Zusage, ' + hs.bitte_abgelehnt.delta + ' bei Ablehnung (Zahlen der Haltungswerte)');
  ok(JSON.stringify(V(e1).gelingt) === JSON.stringify([BRETT.status_gelingen.verbuendet, { f: 'rom', art: 'haltung', d: 2 * hs.gedankt.delta }]), 'gelingt (Bitte, Geruecht, Abschluss): Verbuendeter und Haltung, Summe ueber die Schritte (zweimal gedankt)');
  ok(JSON.stringify(V(e1).scheitert) === JSON.stringify([BRETT.status_scheitern.aktiv, BRETT.werte.weg_text.wert]) && V(e2).scheitert.every((x) => typeof x === 'string'), 'scheitert: nur Saetze (bleibt unverbuendet, anderer Weg), keine erfundene Marke');
  ok(JSON.stringify(V(e3).gelingt.filter((x) => typeof x === 'object')) === JSON.stringify([{ f: 'rom', art: 'haltung', d: 4 }]) && JSON.stringify(V(e3).scheitert.filter((x) => typeof x === 'object')) === JSON.stringify([{ f: 'rom', art: 'haltung', d: -2 }]), 'Konvoi, Geleit, Abschluss: gelingt Haltung +4 (1 + 2 + 1, von Hand), scheitert die staerkste Einzelfolge -2 (Geleit)');
  ok(V(e3).schritte[1].text === BRETT.schritte.geleit.varianten['geleit:modus:havarist'], 'Variante des Parameters (Havarist) im Klartext');
  ok(JSON.stringify(e1.typen) === '["bitte","geruecht"]' && JSON.stringify(e2.typen) === '["geruecht","spur"]' && JSON.stringify(e3.typen) === '["konvoi","geleit"]', 'typen: die Beat-Typen ohne den Abschluss, in der Reihenfolge der Beats (die Typ-Zeile der Karte)');
  ok(JSON.stringify(s).length < 4500, 'Block mit drei Angeboten klein (' + JSON.stringify(s).length + ' Zeichen)');
  ok(!s.geruechte, 'ohne Hinweis ohne Namen in den Plaenen: keine Geruechte');
  ok(keinBlock(g), 'ein zweiter Snapshot ohne Aenderung traegt den Block nicht noch einmal (nur bei Aenderung)');
  grenzen(g, 1, 'andocken');
  const s2 = block(g);
  ok(s2 && s2.angebote.every((x) => x.rest === GILT - 1), 'mit der Taetigkeit aendert sich der Schluessel: der Block kommt neu, der Verfall zaehlt (' + (s2 && s2.angebote[0].rest) + ')');
  // Verfall: nach 12 Taetigkeiten ist alles weg, danach das Loeschsignal
  grenzen(g, GILT, 'andocken');
  ok(offen(g).length === 0, 'nach ' + (GILT + 1) + ' Taetigkeiten sind die Angebote verfallen');
  ok(block(g) === null, 'Loeschsignal: world.abenteuer = null');
  ok(keinBlock(g), 'danach kein Feld mehr');
  // Laufendes Abenteuer
  const p = anbieten(g, notrufplan(1));
  t.an('a' + p.angebot.nr);
  const l = block(g);
  ok(l && l.laufend && l.laufend.id === liste(g)[0].id && l.laufend.schritt === 1 && l.laufend.schritte_gesamt === 2 && l.laufend.ph === 'wartet' && l.laufend.schritt_text === BRETT.schritte.notruf.text && l.laufend.gefahr === false && Number.isInteger(l.laufend.rest) && l.laufend.rest >= 0, 'laufendes Abenteuer: Id, Schritt 1 von 2 (schritte_gesamt), wartet, schritt_text, gefahr, Rest');
  ok(l && l.angebote.length === 0 && l.laufend.ort === '0305' && l.laufend.titel === 'Notruf 1', 'Angebote leer, Ort, Titel (Crew-neutral, hier ohne Namen im Text unveraendert)');
  const f = liste(g)[0];
  ok(keinBlock(g), 'der Block ist gesendet, ein zweiter Snapshot traegt ihn nicht');
  startBeat(g, f);
  const l2 = block(g);
  ok(l2 && l2.laufend.ph === 'laeuft' && l2.laufend.rest > 0 && l2.laufend.rest <= WERTE.beat_frist.wert, 'laeuft der Beat, zeigt der Block die Frist (' + (l2 && l2.laufend.rest) + ' Taetigkeiten)');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('Snapshot: ein Spielername im Freitext wird ersetzt, nie ein Feld mit Namen (drei Spieler)', () => {
  const t = neu(22, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  anbieten(g, plan([b('geruecht'), b('abschluss')], { titel: 'Tzvi_Lund und das Schiff', anlass: 'Mireille_Kas hat etwas gehoert; Ouzo_Brandt zahlt.' }));
  const s = block(g);
  ok(s && !NAMEN.some((x) => JSON.stringify(s).includes(x)), 'weder Titel noch Anlass tragen einen der drei Spielernamen: ' + JSON.stringify(s && s.angebote[0].titel));
  ok(s && s.angebote[0].titel.includes('Crew') && s.angebote[0].anlass.includes('Crew'), 'der Spielername ist durch Crew ersetzt (Namensfilter des Ausschnitts)');
  const inboxen = t.cs.map((c) => c.inbox.filter((m) => m.t === 'snap').length);
  ok(g.errors === 0 && inboxen.length === 3, 'drei Clients, keine Serverfehler');
});

section('Snapshot: typen je Angebot (Beat-Typen ohne Abschluss, jeder einmal, hoechstens typen_max)', () => {
  const t = neu(33, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  const p = anbieten(g, plan([b('geruecht'), b('spur'), b('geruecht'), b('spur'), b('konvoi'), b('geleit'), b('notruf'), b('abschluss')], { titel: 'Viele Typen im Plan', anlass: 'Viele verschiedene Typen in einem Plan ohne Namen' }));
  ok(p.ok, 'Plan mit wiederholten Typen und mehr als vier Typen angeboten');
  const e = (block(g) || { angebote: [] }).angebote[0] || { typen: [] };
  ok(BRETT.werte.typen_max.wert === 4 && JSON.stringify(e.typen) === '["geruecht","spur","konvoi","geleit"]', 'typen: jeder Typ einmal in der Reihenfolge der Beats, ohne abschluss, hoechstens 4: ' + JSON.stringify(e.typen));
  ok(e.typen.every((x) => has(BEATS, x) && !BEATS[x].abschluss) && JSON.stringify(e).length < 1500, 'jeder Typ ist ein Beat-Typ des Katalogs; das Angebot bleibt klein (' + JSON.stringify(e).length + ' Zeichen)');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('Snapshot: Kuerzung im Server (Titel 40, Anlass 110), Geruechte aus den Hinweis-Daten, laufendes Abenteuer', () => {
  const t = neu(23, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  const lang = 'Ein sehr langer Titel mit vielen Woertern und noch mehr';
  anbieten(g, plan([b('notruf'), b('geruecht'), b('spur'), b('enthuellung'), b('abschluss')], { titel: lang, anlass: 'x'.repeat(30) + ' ' + 'y'.repeat(120) }));
  const s = block(g), e = s.angebote[0];
  const TM = BRETT.werte.titel_max.wert;
  ok(TM === 40 && e.titel.length <= TM && e.titel.length >= TM - 1 && e.titel.endsWith('…') && lang.startsWith(e.titel.slice(0, -1).trimEnd()) && e.anlass.length <= 110 && e.anlass.endsWith('…'), 'Titel auf 40 (Daten titel_max, = Brett.GRENZE.titel der Anzeige), Anlass auf 110 Zeichen gekuerzt (mit …): ' + JSON.stringify(e.titel));
  ok(s.geruechte && s.geruechte.length === 1 && s.geruechte[0].angebot === e.id && s.geruechte[0].von === 'Sensoren Lerche' && s.geruechte[0].text === 'Scan bei ' + hexname('0305') + ': Der Transponder des Schiffs passt nicht zu seinen Papieren.', 'Geruecht: Hinweistext der Vorlage ohne Namen, {ort} eingesetzt, Sprecher des Kanals, Verweis auf das Angebot');
  ok(!/[{}]|Lieferung gesehen|Siegel/.test(s.geruechte.map((x) => x.text).join(' ')), 'kein Hinweis mit {name} (der NSC steht erst nach der Annahme fest)');
  const g2 = neu(24, { env: { ABENTEUER_ANSCHLUSS: '0' } }).g;
  for (let i = 0; i < 5; i++) anbieten(g2, plan([b('notruf'), b('geruecht'), b('spur'), b('enthuellung'), b('abschluss')], { titel: 'Geruechte ' + i, anlass: 'Anlass Nummer ' + i + ' ohne Namen' }), '0305');
  ok(block(g2).geruechte.length <= 3 && offen(g2).length === 3, 'hoechstens drei Angebote, hoechstens drei Geruechte');
  // von: das Volk des Angebots (Ostia Nova: rom), auch wenn die Vorlage ein anderes Volk zuerst nennt; sonst das erste erlaubte Volk
  const g3 = neu(25, { env: { ABENTEUER_ANSCHLUSS: '0' } }).g;
  anbieten(g3, plan([b('geruecht'), b('abschluss')], { titel: 'Erst Konkordat', anlass: 'Ein Anlass ohne Namen im Test', volk_erlaubt: ['kon', 'rom'] }));
  anbieten(g3, plan([b('geruecht'), b('abschluss')], { titel: 'Nur Konkordat', anlass: 'Ein Anlass nur fuer das Konkordat', volk_erlaubt: ['kon'] }));
  const s3 = block(g3);
  ok(s3.angebote[0].von === 'rom' && s3.angebote[1].von === 'kon' && s3.angebote[1].vorschau.gelingt.some((x) => x.f === 'kon' && x.art === 'haltung'), 'von: rom (Volk des Ortes, obwohl kon zuerst steht) und kon (nur dieses Volk); die Haltungs-Marke traegt die Fraktion des Auftraggebers');
  // laufend: gefahr
  const g4 = neu(26, { env: { ABENTEUER_ANSCHLUSS: '0' } }), p4 = anbieten(g4.g, plan([b('konvoi'), b('abschluss')], { titel: 'Konvoi laeuft', anlass: 'Ein Konvoi, der gleich kommt, ohne Namen' }));
  g4.an('a' + p4.angebot.nr);
  const l4 = block(g4.g).laufend;
  ok(l4.gefahr === true && l4.schritt_text === BRETT.schritte.konvoi.text && l4.schritte_gesamt === 2, 'laufend: gefahr (Konvoi ist eine Szene), schritt_text aus den Daten');
  // Scheitern = staerkste Einzelfolge, nie die Summe
  const vw = Brett.vorschau(BP.pruefe(plan([b('wiedersehen'), b('notruf'), b('abschluss')])).vorlage, 'rom');
  ok(JSON.stringify(vw.scheitert.filter((x) => typeof x === 'object')) === JSON.stringify([{ f: 'rom', art: 'haltung', d: HW.quellen.wert.im_stich_gelassen.delta }]), 'scheitert: die staerkste Einzelfolge (Notruf: im Stich gelassen), nicht die Summe und nicht die schwaechere (Wiedersehen -1)');
  // die staerkste Folge ist die mit dem groessten Betrag, auch bei positiven Folgen (kleinstes d waere hier -1 statt +2); Daten: gedankt +1, gerettet +2, hingehalten -1
  { const fo = (grund) => ({ aus: { gescheitert: { folge: [{ typ: 'haltung_aenderung', grund }] } } });
    const m = (bt) => Brett.vorschau({ beats: bt }, 'rom').scheitert;
    ok(JSON.stringify(m([fo('gedankt'), fo('gerettet'), fo('hingehalten')])) === JSON.stringify([{ f: 'rom', art: 'haltung', d: HW.quellen.wert.gerettet.delta }]), 'scheitert: +1, +2, -1 zeigt +2 (groesster Betrag, Vorzeichen bleibt), nicht das kleinste d');
    ok(JSON.stringify(m([fo('gedankt'), fo('gerettet')])) === JSON.stringify([{ f: 'rom', art: 'haltung', d: HW.quellen.wert.gerettet.delta }]) && JSON.stringify(m([fo('hingehalten'), fo('im_stich_gelassen')])) === JSON.stringify([{ f: 'rom', art: 'haltung', d: HW.quellen.wert.im_stich_gelassen.delta }]), 'scheitert: nur positive Folgen +2, nur negative -2 (Vorzeichen bleibt)'); }
});

section('Befehle: annehmen (Crew entscheidet, die ERSTE Antwort gilt), Codes, Eingabe, Prototype-Keys', () => {
  const t = neu(23, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  const a1 = anbieten(g, bitteplan(1)), a2 = anbieten(g, bitteplan(2)), a3 = anbieten(g, bitteplan(3));
  const id1 = 'a' + a1.angebot.nr, id2 = 'a' + a2.angebot.nr, id3 = 'a' + a3.angebot.nr;
  // Eingabe: Typ, Laenge, Prototype-Keys
  for (const x of [undefined, null, 7, {}, [], ['a1'], true, 'x', '', 'a', 'a0x', 'A1', 'a-1', 'a1 ', ' a1', 'xa1', 'a1x', 'a1234567', 'f1', 'constructor', '__proto__', 'prototype', 'toString', 'hasOwnProperty', 'a'.repeat(5000), 'a1\n', 'a1;a2']) {
    const r = t.an(x);
    ok(r && r.ok === false && r.code === 'unbekannt' && r.pid === 'p1' && r.op === 'annehmen', 'annehmen mit ' + JSON.stringify(x === undefined ? 'undefined' : x).slice(0, 24) + ': abgelehnt (' + (r && r.code) + ')');
  }
  ok(offen(g).length === 3 && liste(g).length === 0, 'nichts davon hat ein Angebot beruehrt oder ein Abenteuer geoeffnet');
  ok(Brett.annehmen(g, ['a' + a1.angebot.nr]).code === 'unbekannt' && Brett.ablehnen(g, { toString: () => 'a' + a1.angebot.nr }).code === 'unbekannt' && offen(g).length === 3, 'das Modul selbst prueft den Typ (ein Array oder Objekt mit toString ist keine id)');
  ok(t.an('a999').code === 'kein_angebot', 'unbekannte Nummer: kein_angebot');
  ok(g.errors === 0, 'keine Serverfehler durch die Eingaben');
  const roh = JSON.parse('{"t":"cmd","c":"abenteuer.annehmen","id":{"__proto__":{"x":1}}}');
  g.handleMessage(t.c, roh);
  ok(t.letzte().code === 'unbekannt' && offen(g).length === 3, 'id als Objekt mit eigenem Schluessel __proto__: unbekannt');
  g.handleMessage(t.c, { t: 'cmd', c: 'abenteuer.annehmen' });
  ok(t.letzte().code === 'unbekannt', 'ohne id: unbekannt');
  // Annahme durch einen anderen Spieler als den Hauptspieler: jeder darf, die Crew entscheidet
  const r = t.an(id2, t.cs[2]);
  ok(r && r.ok === true && r.pid === 'p3' && r.op === 'annehmen' && !('code' in r), 'Spieler 3 nimmt an: ok, die Antwort geht an ihn (pid p3)');
  ok(t.antw(t.cs[0]).length === t.antw(t.cs[0]).filter((x) => x.pid === 'p1').length && t.antw(t.cs[1]).length === 0, 'die Antwort geht nur an den Absender (Client 2 hat keine)');
  const f = liste(g)[0];
  ok(f && f.plan && f.vorlage === a2.angebot.ref && f.phase === 'wartet' && offen(g).length === 2 && !offen(g).some((a) => a.nr === a2.angebot.nr), 'ein Abenteuer-Faden ist offen (wartet), das Angebot ist vom Brett');
  ok(f.parameter.ort === '0305' && f.abstand >= 2 && f.abstand <= 4, 'Ort des Angebots, Abstand 2 bis 4 wie bei jedem Faden');
  // erste Antwort gilt
  const s2 = t.an(id2, t.cs[0]);
  ok(s2.ok === false && s2.code === 'schon_beantwortet' && s2.text === BRETT.weigerungen.schon_beantwortet, 'zweite Antwort auf dasselbe Angebot: schon_beantwortet (Text aus den Daten)');
  { // eine Ausnahme im Modul: Code fehler (nicht veraltet), das Angebot bleibt, die Antwort kommt, ein Serverfehler wird gezaehlt
    const tx = neu(231, { env: { ABENTEUER_ANSCHLUSS: '0' } }), p = anbieten(tx.g, bitteplan(9)), orig = { an: Brett.annehmen, ab: Brett.ablehnen };
    Brett.annehmen = () => { throw new Error('Probe'); }; Brett.ablehnen = () => { throw new Error('Probe'); };
    let ra, rb; try { ra = tx.an('a' + p.angebot.nr); rb = tx.ab('a' + p.angebot.nr); } finally { Brett.annehmen = orig.an; Brett.ablehnen = orig.ab; }
    ok(ra && ra.ok === false && ra.code === 'fehler' && ra.text === BRETT.weigerungen.fehler && rb && rb.code === 'fehler' && offen(tx.g).length === 1 && tx.g.errors === 2, 'Ausnahme beim Annehmen/Ablehnen: Code fehler mit Text aus den Daten, das Angebot bleibt auf dem Brett, zwei gezaehlte Fehler');
    tx.g.errors = 0;
    ok(tx.an('a' + p.angebot.nr).ok === true, 'danach laesst sich das Angebot normal annehmen'); }
  ok(t.ab(id2, t.cs[1]).code === 'schon_beantwortet', 'auch Ablehnen nach der Annahme: schon_beantwortet');
  // hoechstens ein laufendes Abenteuer
  const fp0 = logbuch(g).filter((x) => x.art === 'faden_pruefung').length;
  const e = t.an(id1, t.cs[1]);
  ok(e.ok === false && e.code === 'laeuft_schon' && offen(g).length === 2, 'ein zweites Abenteuer neben dem laufenden: laeuft_schon, das Angebot bleibt');
  ok(logbuch(g).filter((x) => x.art === 'faden_pruefung').length === fp0, 'die Weigerung ist sauber: kein Eintrag faden_pruefung im Logbuch (der Zustand wird vorher geprueft)');
  // am Boden
  g.players[0].downed = true;
  const d = t.an(id1, t.cs[0]);
  ok(d.ok === false && d.code === 'am_boden', 'wer am Boden liegt: am_boden');
  g.players[0].downed = false;
  // Code ohne Schalter
  const t0 = neu(24, { env: { FAEDEN: '' } });
  ok(t0.an('a1').code === 'modus' && t0.ab('a1').code === 'modus', 'ohne Schalter FAEDEN: modus (kein Absturz)');
  // ohne Spielleiter bleibt das Angebot
  const tl = neu(25, { env: { ABENTEUER_ANSCHLUSS: '0' } });
  const p = anbieten(tl.g, bitteplan(9));
  tl.g.lageSpielleiter.dispose();
  const k = tl.an('a' + p.angebot.nr);
  ok(k.ok === false && k.code === 'kein_spielleiter' && offen(tl.g).length === 1 && liste(tl.g).length === 0, 'ohne Spielleiter: kein_spielleiter, das Angebot bleibt bis zum Verfall, nichts wird begonnen');
  ok(g.errors === 0 && tl.g.errors === 0 && t0.g.errors === 0, 'keine Serverfehler');
  void id3;
});

section('Befehle: ablehnen kostet nichts (kein Ruf, keine Haltung, kein Cooldown), der Platz wird frei', () => {
  const t = neu(26, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  // ein NSC mit Haltung steht schon im Spiel (abgeschlossener Faden), der Ruf hat einen Stand
  const alt = annehmenUndSpielen(t, notrufplan(0), 'gelungen');
  ok(alt.fertig, 'Vorlauf: ein Abenteuer gespielt (der NSC hat Haltung)');
  g.weltsim.ruf.rom = 5; g.weltsim.ruf.ger = -3;
  const vorher = JSON.stringify({ ruf: g.weltsim.ruf, nsc: liste(g).map((f) => [f.id, f.nsc.haltung, f.nsc.status]), t: zust(g).t, deckel: zust(g).bitteLog, sl: g.lageSpielleiter.abenteuer.grenzenSeit });
  const a = anbieten(g, bitteplan(1)), c = anbieten(g, bitteplan(2));
  const idA = 'a' + a.angebot.nr;
  const r = t.ab(idA, t.cs[1]);
  ok(r.ok === true && r.op === 'ablehnen' && r.pid === 'p2', 'Spieler 2 lehnt ab: ok');
  ok(offen(g).length === 1 && offen(g)[0].nr === c.angebot.nr && liste(g).filter((f) => f.phase !== 'abgeschlossen').length === 0, 'das Angebot ist vom Brett, es entsteht kein Abenteuer, der Platz ist frei');
  const nachher = JSON.stringify({ ruf: g.weltsim.ruf, nsc: liste(g).map((f) => [f.id, f.nsc.haltung, f.nsc.status]), t: zust(g).t, deckel: zust(g).bitteLog, sl: g.lageSpielleiter.abenteuer.grenzenSeit });
  ok(vorher === nachher, 'Ruf, Haltung aller NSC, Taetigkeitszaehler, Deckel und Cooldown des Komponisten vorher und nachher gleich');
  ok(t.ab(idA, t.cs[0]).code === 'schon_beantwortet' && t.an(idA, t.cs[0]).code === 'schon_beantwortet', 'zweite Antwort auf das abgelehnte Angebot: schon_beantwortet');
  ok(logbuch(g).some((e) => e.art === 'faden_ereignis' && e.ausgang === 'abenteuer_abgelehnt') && !logbuch(g).some((e) => /Bitte 1|Probeanlass/.test(JSON.stringify(e))), 'Logbuch: abgelehnt ohne Titel und Anlass');
  // das naechste Angebot kann sofort angenommen werden
  ok(t.an('a' + c.angebot.nr).ok === true && liste(g).filter((f) => f.phase !== 'abgeschlossen').length === 1, 'der Platz ist frei: ein anderes Angebot laesst sich sofort annehmen');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('Annahme: kein Platz, Lage veraltet (Sabotage ohne Ziel), Wiedersehen (juengster Kandidat, NSC_VON, Verdraengung)', () => {
  X.registriere(X.vorlageTest());   // test_geschichte: Faeden aus einer Datei (ohne Plan)
  // kein Platz: drei aktive Faeden (Datei-Vorlagen) -> Obergrenze, das Angebot bleibt
  { const t = neu(27, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
    const o1 = X.oeffne(g), o2 = X.oeffne(g), o3 = X.oeffne(g);
    const a = anbieten(g, bitteplan(1));
    ok(o1 && o2 && o3 && a.ok, 'drei aktive Faeden aus Dateien (test_geschichte), ein Angebot');
    const fp0 = logbuch(g).filter((x) => x.art === 'faden_pruefung').length;
    const r = t.an('a' + a.angebot.nr);
    ok(r.ok === false && r.code === 'kein_platz' && offen(g).length === 1, 'drei aktive Faeden: kein_platz, das Angebot bleibt');
    ok(logbuch(g).filter((x) => x.art === 'faden_pruefung').length === fp0, 'sauber: kein Eintrag faden_pruefung'); }
  // Lage veraltet: ein Sabotage-Angebot, das Ziel faellt weg
  { const t = neu(28, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
    postenSetzen(g, '0703', 'ger'); g.weltsim.ruf.rom = rangAb('miles');
    const a = anbieten(g, plan([b('sabotage'), b('abschluss')], { titel: 'Sabotage', anlass: 'Ein Posten soll fallen, still und schnell' }));
    ok(a.ok && B2.lage('sabotage_ziel').zahl(g) === 1, 'Sabotage-Angebot mit Ziel');
    postenSetzen(g, '0703', 'rom');   // das Ziel ist weg
    ok(B2.lage('sabotage_ziel').zahl(g) === 0, 'das Ziel ist weg');
    const fp0 = logbuch(g).filter((x) => x.art === 'faden_pruefung').length;
    const r = t.an('a' + a.angebot.nr);
    ok(logbuch(g).filter((x) => x.art === 'faden_pruefung').length === fp0, 'veraltet ist eine eigene, saubere Meldung (kein Eintrag faden_pruefung)');
    ok(r.ok === false && r.code === 'veraltet' && r.text === BRETT.weigerungen.veraltet && offen(g).length === 0 && liste(g).length === 0, 'Annahme: veraltet, das Angebot wird mit klarer Meldung vom Brett genommen, kein Faden');
    ok(logbuch(g).some((e) => e.ausgang === 'abenteuer_veraltet') && t.an('a' + a.angebot.nr).code === 'schon_beantwortet', 'Logbuch: veraltet; eine weitere Antwort: schon_beantwortet'); }
  // Wiedersehen: zwei Kandidaten, der juengste zuerst (SUND-04b E3: die Hauptfigur des letzten Abenteuers zaehlt nicht, deshalb ein drittes Abenteuer davor)
  { const t = neu(29, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
    const e1 = annehmenUndSpielen(t, notrufplan(1), 'gelungen'), e2 = annehmenUndSpielen(t, notrufplan(2), 'gelungen'), e3 = annehmenUndSpielen(t, notrufplan(3), 'gelungen');
    ok(e1.fertig && e2.fertig && e3.fertig && new Set([e1.f.nsc.name, e2.f.nsc.name, e3.f.nsc.name]).size === 3, 'drei abgeschlossene Abenteuer mit verschiedenen NSC');
    const w = anbieten(g, plan([b('wiedersehen'), b('abschluss')], { titel: 'Wiedersehen', anlass: 'Jemand meldet sich wieder, mit Dank' }));
    ok(w.ok, 'Wiedersehen angeboten (es gibt Kandidaten)');
    const r = t.an('a' + w.angebot.nr);
    const f = liste(g).find((x) => x.phase !== 'abgeschlossen');
    ok(r.ok === true && f && f.nsc.name === e2.f.nsc.name && f.nsc.id !== e2.f.nsc.id, 'Annahme: der juengste Kandidat (' + e2.f.nsc.name + ') kehrt wieder, mit neuer Kennung');
    ok(liste(g).filter((x) => x.nsc.name === e2.f.nsc.name).length === 2, 'der alte Faden bleibt als Geschichte stehen'); }
  // Wiedersehen: der Kandidat taugt nicht mehr (NSC_VON): zweiter Kandidat, sonst veraltet
  { const t = neu(30, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
    const e1 = annehmenUndSpielen(t, notrufplan(1), 'gelungen'), e2 = annehmenUndSpielen(t, notrufplan(2), 'gelungen'); annehmenUndSpielen(t, notrufplan(3), 'gelungen');
    const w = anbieten(g, plan([b('wiedersehen'), b('abschluss')], { titel: 'Wiedersehen', anlass: 'Jemand meldet sich wieder, mit Dank' }));
    e2.f.nsc.status = 'tot';   // der juengste ist tot: er taugt nicht
    const r = t.an('a' + w.angebot.nr);
    const f = liste(g).find((x) => x.phase !== 'abgeschlossen');
    ok(r.ok === true && f && f.nsc.name === e1.f.nsc.name, 'der juengste taugt nicht (tot): der naechste Kandidat (' + e1.f.nsc.name + ')');
    // der einzige Kandidat stirbt, nachdem das Angebot schon auf dem Brett liegt: die Annahme sagt veraltet, das Angebot ist vom Brett
    const t3 = neu(130, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g3 = t3.g;
    const e3 = annehmenUndSpielen(t3, notrufplan(1), 'gelungen');
    const w3 = anbieten(g3, plan([b('wiedersehen'), b('abschluss')], { titel: 'Wiedersehen drei', anlass: 'Jemand meldet sich, aber nicht mehr lange' }));
    ok(e3.fertig && w3.ok, 'ein Kandidat, das Wiedersehen liegt aus');
    e3.f.nsc.status = 'tot';
    const fp0 = logbuch(g3).filter((x) => x.art === 'faden_pruefung').length;
    const r3 = t3.an('a' + w3.angebot.nr);
    ok(r3.ok === false && r3.code === 'veraltet' && offen(g3).length === 0 && liste(g3).filter((x) => x.phase !== 'abgeschlossen').length === 0 && logbuch(g3).filter((x) => x.art === 'faden_pruefung').length === fp0, 'kein Kandidat mehr: veraltet, das Angebot ist vom Brett, kein Faden, sauber (kein Eintrag faden_pruefung)');
    ok(g3.errors === 0, 'keine Serverfehler');
    ok(g.errors === 0, 'keine Serverfehler'); }
  // Verdraengung: neun abgeschlossene Faeden voll, die Annahme klappt, der aelteste faellt heraus
  { const t = neu(31, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
    for (let i = 1; i <= WERTE.faeden_gesamt_max.wert; i++) { const e = annehmenUndSpielen(t, notrufplan(i), 'gelungen'); if (!e.fertig) ok(false, 'Vorlauf ' + i); }
    ok(liste(g).length === WERTE.faeden_gesamt_max.wert && liste(g).every((f) => f.phase === 'abgeschlossen'), 'neun abgeschlossene Faeden (Obergrenze der Liste)');
    const erster = liste(g)[0].id;
    const w = anbieten(g, plan([b('wiedersehen'), b('abschluss')], { titel: 'Wiedersehen', anlass: 'Jemand meldet sich nach langer Zeit' }));
    const r = t.an('a' + w.angebot.nr);
    ok(r.ok === true && liste(g).length === WERTE.faeden_gesamt_max.wert && !liste(g).some((f) => f.id === erster), 'Annahme bei voller Liste: ok, der aelteste abgeschlossene Faden wird verdraengt, die Liste bleibt bei ' + WERTE.faeden_gesamt_max.wert);
    ok(g.errors === 0, 'keine Serverfehler'); }
});

section('Ende wirkt: Chronik aus Daten (nie Titel, nie NSC-Name), Logbuch ohne Titel, Haltung, Scheitern blockiert nichts', () => {
  const t = neu(32, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  const hs = HW.quellen.wert;
  const gel = annehmenUndSpielen(t, notrufplan(1, { titel: 'Der Dank von Quintus', anlass: 'Quintus Serran bittet um einen Gefallen' }), 'gelungen');
  ok(gel.fertig && gel.f.ausgang.art === 'gelungen', 'Notruf beantwortet: das Abenteuer endet gelungen');
  ok(gel.f.nsc.haltung === hs.geholfen.delta + hs.gedankt.delta, 'Haltung des NSC: geholfen +' + hs.geholfen.delta + ' (Notruf) und gedankt +' + hs.gedankt.delta + ' (Abschluss) = ' + gel.f.nsc.haltung);
  const c = Chronik.letzte(g, 1)[0];
  ok(c && c.kurz === BRETT.chronik.gelungen.replace('{ort}', hexname('0305')) && c.art === 'reise' && c.ref === gel.f.id && c.param.art === 'abenteuer', 'Chronik: ' + JSON.stringify(c && c.kurz) + ' (Zeile aus den Daten, Ort eingesetzt)');
  ok(!JSON.stringify(Chronik.letzte(g, 40)).match(new RegExp(gel.f.nsc.name + '|Quintus|Dank von')), 'Chronik nennt weder NSC-Namen noch Titel noch Anlass');
  const ende = logbuch(g).filter((e) => e.art === 'faden_ereignis' && e.ausgang === 'abenteuer_ende');
  ok(ende.length === 1 && ende[0].plan.ausgang === 'gelungen' && ende[0].plan.faden === gel.f.id && !/Quintus|Dank von|Gefallen/.test(JSON.stringify(logbuch(g))), 'Logbuch: abenteuer_ende ohne Titel und Anlass (nirgends im Logbuch)');
  // Scheitern
  const bad = annehmenUndSpielen(t, notrufplan(2, { titel: 'Ein Nein mit Folgen', anlass: 'Eine Bitte, die abgeschlagen wird' }), 'scheitern');
  ok(bad.fertig && bad.f.ausgang.art === 'gescheitert', 'Notruf verfaellt (Frist): das Abenteuer endet gescheitert');
  ok(bad.f.nsc.status === 'gefangen' && bad.f.nsc.haltung === hs.im_stich_gelassen.delta, 'Scheitern veraendert den NSC (gefangen, nicht verbuendet), Haltung ' + hs.im_stich_gelassen.delta + ' (im Stich gelassen)');
  ok(Chronik.letzte(g, 1)[0].kurz === BRETT.chronik.gescheitert.replace('{ort}', hexname('0305')), 'Chronik: gescheitert (Zeile aus den Daten)');
  ok(liste(g).filter((f) => f.phase !== 'abgeschlossen').length === 0 && g.phase !== 'end', 'nichts blockiert: kein laufendes Abenteuer, kein Game Over');
  // naechstes Angebot geht sofort
  const nxt = anbieten(g, bitteplan(3));
  ok(nxt.ok && t.an('a' + nxt.angebot.nr).ok === true, 'danach laesst sich sofort das naechste Abenteuer annehmen');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('Ruf und Haltung: die Vorschau zeigt Ruf-Folgen, sobald die Daten sie tragen; die Wirkung laeuft ueber den Katalog', () => {
  const v = JSON.parse(JSON.stringify(D.vorlage('falscher_haendler')));
  const vs = Brett.vorschau(v, 'rom');
  const ruf = lies('content/welt/ruf-werte.json').werte.quellen.wert;
  const alleM = vs.gelingt.concat(vs.scheitert).filter((x) => typeof x === 'object' && x.art === 'ruf');
  const grund = (v.beats.flatMap((x) => Object.values(x.aus || {}).flatMap((o) => (o.folge || []).filter((f) => f.typ === 'ruf_aenderung').map((f) => f.grund)))[0]);
  ok(vs.schritte.length === v.beats.length && alleM.length >= 1 && grund && alleM.some((x) => x.f === ruf[grund].fraktion && x.d === ruf[grund].delta), 'Vorschau der Datei-Vorlage falscher_haendler: Ruf-Marke { f, art ruf, d } mit der Zahl der Ruf-Werte (Grund ' + grund + ': ' + JSON.stringify(alleM[0]) + ')');
  ok(!JSON.stringify(Brett.vorschau(BP.pruefe(plan([b('geruecht'), b('abschluss')])).vorlage, 'rom')).includes('"art":"ruf"'), 'ein Plan des Katalogs traegt heute keine Ruf-Folge: die Vorschau zeigt auch keine erfundene');
  ok(WERTE.folge_typen.wert.join() === 'ruf_aenderung,haltung_aenderung', 'folge_typen unveraendert: nur ruf_aenderung und haltung_aenderung');
});

section('Anschluss-Garantie: nach dem Ende ein Angebot ohne Modell, nie der letzte Plan, Lage, deterministisch', () => {
  // nach dem Ende
  const t = neu(33), g = t.g;   // Rueckfall an, Komponist still (deckel 0)
  for (let i = 0; i < 250; i++) g.step();
  ok(offen(g).length === 1 && offen(g)[0].vorlage && ANS.plaene.some((p) => BP.pruefe(p).vorlage.id === offen(g)[0].ref), 'Spielstart ohne Angebot: im Takt entsteht ein Angebot aus den Standard-Plaenen (auch ohne Taetigkeit)');
  ok(logbuch(g).some((e) => e.art === 'abenteuer_anschluss' && e.ausgang === 'angeboten'), 'Logbuch: abenteuer_anschluss');
  wipe(g);
  const e = annehmenUndSpielen(t, notrufplan(1), 'gelungen');
  ok(e.fertig, 'ein Abenteuer gespielt');
  ok(offen(g).length >= 1, 'direkt nach dem Ende ist mindestens ein neues Angebot da (' + offen(g).length + ')');
  ok(!offen(g).some((a) => a.ref === e.a.angebot.ref), 'es ist nicht das eben gespielte');
  const mitAnschluss = offen(g).filter((a) => ANS.plaene.some((p) => BP.pruefe(p).vorlage.id === a.ref));
  ok(mitAnschluss.length === offen(g).length, 'es stammt aus anschluss.json');
  { const tt = neu(43), gg = tt.g; for (let i = 0; i < 250; i++) gg.step();
    ok(offen(gg).length === 1, 'ein Angebot aus dem Rueckfall liegt aus');
    grenzen(gg, GILT + 1, 'andocken');
    ok(offen(gg).length === 1 && offen(gg)[0].alter < GILT, 'verfaellt es, ist mit derselben Taetigkeit ein neues da (ohne auf den Takt zu warten)'); }
  // waehrend ein Abenteuer laeuft, kein Rueckfall
  const t2 = neu(34), g2 = t2.g;
  const a = anbieten(g2, bitteplan(1)); t2.an('a' + a.angebot.nr);
  wipe(g2); grenzen(g2, 3); for (let i = 0; i < 300; i++) g2.step();
  ok(offen(g2).length === 0, 'waehrend ein Abenteuer laeuft, entsteht kein Rueckfall-Angebot');
  // Spielleiter weg: nichts
  const t3 = neu(35), g3 = t3.g; g3.lageSpielleiter.dispose(); grenzen(g3, 2); for (let i = 0; i < 300; i++) g3.step();
  ok(offen(g3).length === 0, 'ohne Spielleiter: kein Rueckfall (alles wie vorher)');
  const t4 = neu(36, { env: { ABENTEUER_ANSCHLUSS: '0' } }); grenzen(t4.g, 2); for (let i = 0; i < 300; i++) t4.g.step();
  ok(offen(t4.g).length === 0, 'ABENTEUER_ANSCHLUSS=0: kein Rueckfall');
  const t5 = neu(37, { env: { FAEDEN: '' } }); grenzen(t5.g, 2); for (let i = 0; i < 300; i++) t5.g.step();
  ok(!t5.g.weltsim.faeden || (t5.g.weltsim.faeden.abenteuerAngebote || []).length === 0, 'ohne FAEDEN: kein Rueckfall');
  // nie der zuletzt gespielte Plan (alle sechs, viele Zaehler)
  const ids = ANS.plaene.map((p) => BP.pruefe(p).vorlage.id);
  let verstoss = 0, gezogen = 0;
  for (const letzte of ids) {
    for (let k = 0; k < 8; k++) {
      const tt = neu(100 + k, { env: {} }); const gg = tt.g;
      const F0 = zust(gg); F0.abenteuerZuletzt = letzte; F0.angNr = k;
      wipe(gg); const r = Brett.anschluss(gg);
      if (r) { gezogen++; if (r.ref === letzte) verstoss++; }
    }
  }
  ok(gezogen > 40 && verstoss === 0, 'der Rueckfall wiederholt den zuletzt gespielten Plan nie (' + gezogen + ' Ziehungen, ' + verstoss + ' Wiederholungen)');
  // abgelehnt: nicht sofort wieder dasselbe
  const t6 = neu(38), g6 = t6.g; for (let i = 0; i < 250; i++) g6.step();
  const erst = offen(g6)[0].ref; t6.ab('a' + offen(g6)[0].nr);
  for (let i = 0; i < 250; i++) g6.step();
  ok(offen(g6).length === 1 && offen(g6)[0].ref !== erst, 'ein abgelehntes Angebot wird nicht sofort wieder angeboten, der Platz wird mit einem anderen belegt');
  { const tt = neu(39), gg = tt.g; for (let i = 0; i < 250; i++) gg.step();
    const folgeRefs = []; let gleich = 0;
    for (let k = 0; k < 20; k++) { const o = offen(gg)[0]; if (!o) { folgeRefs.push(null); break; } if (folgeRefs.length && folgeRefs[folgeRefs.length - 1] === o.ref) gleich++; folgeRefs.push(o.ref); tt.ab('a' + o.nr); Brett.beiTaetigkeit(gg); }
    ok(folgeRefs.length === 20 && !folgeRefs.includes(null) && gleich === 0 && new Set(folgeRefs).size >= 4, 'zwanzigmal abgelehnt: jedes Mal ein neues Angebot, nie zweimal derselbe Plan hintereinander (' + new Set(folgeRefs).size + ' verschiedene)'); }
  // die Sperren (zuletzt, letzte drei Ablehnungen) duerfen den Rueckfall nie leeren, solange ein Plan passt: ohne Ziel und Kandidat gibt es nur vier passende Plaene (Geruecht, Spur, Konvoi, Geleit)
  { const idv = (typ) => ids[ANS.plaene.findIndex((p) => p.beats[0].typ === typ)];
    const vier = ['geruecht', 'spur', 'konvoi', 'geleit'].map(idv);
    let leer = 0, falsch = 0, n2 = 0;
    for (const zuletzt of vier) for (let k = 0; k < 6; k++) {
      const abg = vier.filter((x) => x !== zuletzt);   // die drei uebrigen gerade abgelehnt: ohne Lockerung bliebe nichts
      const tt = neu(400 + k, { env: {} }), gg = tt.g; const F0 = zust(gg); F0.abenteuerZuletzt = zuletzt; F0.brett = { antworten: [], abgelehnt: abg.slice(), pruefung: -1e9 }; F0.angNr = k;
      wipe(gg); const r = Brett.anschluss(gg); n2++;
      if (!r) leer++; else if (!vier.includes(r.ref) || r.ref === zuletzt) falsch++;   // erst die aelteste Ablehnung, dann zuletzt: hier ist die aelteste Ablehnung frei, zuletzt bleibt gesperrt
    }
    ok(n2 === 24 && leer === 0 && falsch === 0, 'zuletzt = ein Plan des Rueckfalls, die drei anderen abgelehnt, ohne Ziel und Kandidat: immer ein Angebot (' + n2 + ' Faelle, ' + leer + ' leer), zuerst wird die aelteste Ablehnung freigegeben, nicht zuletzt');
    const tt = neu(410, { env: {} }), gg = tt.g; const F0 = zust(gg); F0.abenteuerZuletzt = vier[0]; F0.brett = { antworten: [], abgelehnt: [vier[1], vier[2], vier[3]], pruefung: -1e9 }; wipe(gg);
    const r = Brett.anschluss(gg); ok(r && r.ref === vier[1], 'die AELTESTE der drei Ablehnungen wird zuerst freigegeben (Spur)');
    // wie im Betrieb: zuletzt = Geruecht, danach hintereinander abgelehnt, ohne Ziel und Kandidat: das Brett bleibt nie leer
    const t9 = neu(411, { env: {} }), g9 = t9.g; zust(g9).abenteuerZuletzt = vier[0]; let leer9 = 0; const gesehen = new Set();
    for (let k = 0; k < 12; k++) { wipe(g9); const o = Brett.anschluss(g9); if (!o) { leer9++; break; } gesehen.add(o.ref); t9.ab('a' + o.nr); }
    ok(leer9 === 0 && gesehen.size >= 3, 'zwoelf Ablehnungen hintereinander (zuletzt = Geruecht): jedes Mal ein Angebot (' + gesehen.size + ' verschiedene)');
    // nur zuletzt und drei Ablehnungen waeren uebrig: es bleibt trotzdem ein Plan
    const t10 = neu(412, { env: {} }), g10 = t10.g; const F10 = zust(g10); F10.abenteuerZuletzt = vier[2]; F10.brett = { antworten: [], abgelehnt: [vier[0], vier[1], vier[3]], pruefung: -1e9 }; wipe(g10);
    ok(!!Brett.anschluss(g10) && g10.errors === 0, 'auch dann ein Angebot, wenn zuletzt und die drei Ablehnungen alle vier passenden Plaene sperren'); }
  // passt nur ein einziger Plan und das ist der zuletzt gespielte, bleibt das Brett trotzdem nicht leer (zuletzt wird als Letztes freigegeben)
  { const orig = D.ANSCHLUSS.plaene; D.ANSCHLUSS.plaene = [orig[0]];
    try { const tt = neu(413, { env: {} }), gg = tt.g; const F0 = zust(gg); F0.abenteuerZuletzt = ids[0]; F0.brett = { antworten: [], abgelehnt: [ids[0]], pruefung: -1e9 }; wipe(gg);
      const r = Brett.anschluss(gg); ok(r && r.ref === ids[0] && gg.errors === 0, 'der einzige passende Plan ist zuletzt gespielt und abgelehnt: er wird trotzdem angeboten (zuletzt wird als Letztes freigegeben)'); }
    finally { D.ANSCHLUSS.plaene = orig; } }
  // SUND-04b E3: drei Ablehnungen (die Obergrenze) und der einzige passende Plan ist zuletzt gespielt: erst die vierte Stufe gibt ihn frei, auch wenn die Wiederholungsregeln schon auf Stufe 3 ganz gelockert sind
  { const orig = D.ANSCHLUSS.plaene; D.ANSCHLUSS.plaene = [orig[0]];
    try { const tt = neu(414, { env: {} }), gg = tt.g; const F0 = zust(gg); F0.abenteuerZuletzt = ids[0]; F0.brett = { antworten: [], abgelehnt: [ids[0], 'abenteuer_aaaaaaaaaaaa', 'abenteuer_bbbbbbbbbbbb'], pruefung: -1e9 }; wipe(gg);
      const r = Brett.anschluss(gg); ok(r && r.ref === ids[0] && gg.errors === 0, 'drei Ablehnungen und zuletzt gespielt, nur dieser Plan passt: er wird trotzdem angeboten (Stufe 4)'); }
    finally { D.ANSCHLUSS.plaene = orig; } }
  // deterministisch aus Seed und Zustand
  const folge = (seed) => { const tt = neu(seed), gg = tt.g; const out = []; for (let i = 0; i < 6; i++) { for (let k = 0; k < 100; k++) gg.step(); const o = offen(gg)[0]; out.push(o ? o.ref : null); if (o) tt.ab('a' + o.nr); } return out.join(); };
  ok(folge(41) === folge(41) && folge(41).split(',').every((x) => x !== 'null'), 'gleicher Seed, gleiche Folge von Anschluss-Angeboten');
  ok(g.errors === 0 && g2.errors === 0, 'keine Serverfehler');
});

section('Anschluss-Garantie nach Lage: Sabotage nur mit Ziel, Wiedersehen nur mit Kandidat; Komponist ausgefallen', async () => {
  const typenOhne = new Set(), typenMit = new Set();
  for (let seed = 200; seed < 230; seed++) {
    const t = neu(seed), g = t.g; zust(g).angNr = seed;
    wipe(g); const r = Brett.anschluss(g); if (r) typenOhne.add(r.vorlage.beats[0].typ);
  }
  { const t1 = neu(250), g1 = t1.g; const n0 = logbuch(g1).filter((e) => e.art === 'faden_pruefung').length; const gewaehlt = new Set();
    for (let k = 1; k <= 24; k++) { zust(g1).angNr = k; wipe(g1); const r = Brett.anschluss(g1); if (r) gewaehlt.add(r.ref); }
    ok(gewaehlt.size >= 3, 'derselbe Zustand, anderer Zaehler der Angebote: verschiedene Plaene (' + gewaehlt.size + ' von 24 Ziehungen)');
    ok(logbuch(g1).filter((e) => e.art === 'faden_pruefung').length === n0, 'der Rueckfall waehlt nur, was passt (kein Eintrag faden_pruefung durch einen abgelehnten Plan)'); }
  ok(typenOhne.size >= 3 && !typenOhne.has('sabotage') && !typenOhne.has('wiedersehen'), 'ohne Ziel und ohne Kandidat: nie Sabotage, nie Wiedersehen (30 Zaehler: ' + [...typenOhne].join(', ') + ')');
  for (let seed = 200; seed < 260; seed++) {
    const t = neu(seed), g = t.g; zust(g).angNr = seed;
    postenSetzen(g, '0703', 'ger'); g.weltsim.ruf.rom = rangAb('miles');
    wipe(g); const r = Brett.anschluss(g); if (r) typenMit.add(r.vorlage.beats[0].typ);
  }
  ok(typenMit.has('sabotage') && !typenMit.has('wiedersehen'), 'mit Ziel (Posten bei 0703, Rang): Sabotage kommt vor, Wiedersehen weiter nicht (' + [...typenMit].join(', ') + ')');
  const typenWied = new Set();
  for (let seed = 300; seed < 360; seed++) {
    const t = neu(seed), g = t.g; zust(g).angNr = seed;
    const e = annehmenUndSpielen(t, notrufplan(1), 'gelungen'); if (!e.fertig) continue;
    const e2 = annehmenUndSpielen(t, notrufplan(2), 'gelungen'); if (!e2.fertig) continue;   // SUND-04b E3: die Hauptfigur des letzten Abenteuers kehrt nicht sofort wieder, der des vorletzten schon
    wipe(g); const r = Brett.anschluss(g); if (r) typenWied.add(r.vorlage.beats[0].typ);
  }
  ok(typenWied.has('wiedersehen'), 'mit einem Kandidaten (ein NSC, der sich erinnert): Wiedersehen kommt vor (' + [...typenWied].join(', ') + ')');
  // A2 (Komponist) faellt aus: LLM kaputt, der Rueckfall bleibt, das Spiel laeuft
  const kaputt = LLM.create({ mode: 'script', script: { abenteuer: [{ error: 'OFFLINE' }, { error: 'OFFLINE' }, { error: 'OFFLINE' }, { error: 'OFFLINE' }] } });
  const t = neu(61, { llm: undefined, ab: { deckel_je_sitzung: 4, cooldown_grenzen: 1 } }), g = t.g;
  g.lageSpielleiter.abenteuer.lage.llm = kaputt; if (g.lageSpielleiter.llm) g.lageSpielleiter.llm = kaputt;
  for (let i = 0; i < 6; i++) { g.lageGrenze('andocken'); for (let k = 0; k < 10; k++) g.step(); }
  ok(offen(g).length >= 1 && g.errors === 0, 'Komponist ausgefallen oder im Cooldown: trotzdem ein Angebot (' + offen(g).length + '), kein Fehler');
  // Komponist liefert: Angebote kommen zusaetzlich (hoechstens 3)
  const t7 = neu(62, { ab: { deckel_je_sitzung: 8, cooldown_grenzen: 1 } }), g7 = t7.g;
  for (let i = 0; i < 12; i++) { g7.lageGrenze('andocken'); for (let k = 0; k < 10; k++) { g7.step(); await frei(); } }   // der Komponist antwortet asynchron: zwischen den Schritten die Promises laufen lassen
  const anschlussIds = ANS.plaene.map((p) => BP.pruefe(p).vorlage.id);
  ok(offen(g7).length >= 1 && offen(g7).length <= MAXA && g7.errors === 0, 'Komponist (Mock) und Rueckfall nebeneinander: 1 bis ' + MAXA + ' Angebote (' + offen(g7).length + ')');
  ok(offen(g7).some((a) => !anschlussIds.includes(a.ref)), 'mindestens ein Angebot stammt vom Komponisten, nicht aus anschluss.json (' + offen(g7).map((a) => a.ref.slice(-4) + (anschlussIds.includes(a.ref) ? ' Rueckfall' : ' Komponist')).join(', ') + ')');
});

section('Ohne Spielleiter laeuft die Welt weiter: begonnene Abenteuer stehen, speicherbar, Angebote bis zum Verfall', () => {
  const t = neu(51, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  const a = anbieten(g, bitteplan(1)), c = anbieten(g, bitteplan(2));
  t.an('a' + a.angebot.nr);
  const f = liste(g)[0]; startBeat(g, f);
  const z0 = { beat: f.beat, phase: f.phase, n: f.laufend && f.laufend.n };
  ok(block(g).ok === 1, 'mit Spielleiter: ok 1');
  g.lageSpielleiter.dispose();
  const sw = block(g);
  ok(sw && sw.ok === 0, 'der Wechsel allein (ohne jede Taetigkeit) wird gesendet: ok 0');
  grenzen(g, 10, 'andocken'); for (let i = 0; i < 200; i++) g.step();
  ok(f.phase === z0.phase && f.beat === z0.beat && g.errors === 0, 'das Abenteuer steht (kein Fortschritt, kein Scheitern durch die Frist), kein Fehler');
  ok(liste(g).length === 1 && Weltstand.validate(Weltstand.capture(g), g).filter((x) => /faeden|abenteuer/.test(String(x))).length === 0, 'speicherbar und schemagueltig');
  const s = block(g);
  ok(s && s.ok === 0 && s.laufend && s.laufend.id === f.id, 'Snapshot: ok 0 (Spielleiter nicht erreichbar), das laufende Abenteuer steht im Block');
  ok(offen(g).length === 0 || offen(g).every((x) => x.alter <= GILT), 'Angebote verfallen weiter nach den Taetigkeiten (kein Haengenbleiben)');
  ok(t.an('a' + c.angebot.nr).code === 'kein_spielleiter' || offen(g).length === 0, 'Antworten auf Angebote ohne Spielleiter: kein_spielleiter oder schon verfallen');
});

section('Weltstand: Version 3, Altstand laedt, Angebote und zuletzt ueberstehen das Laden, Muell und Prototype-Keys fallen weg', () => {
  const t = neu(71, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  const p1 = anbieten(g, bitteplan(1)), p2 = anbieten(g, plan([b('geruecht'), b('abschluss')], { titel: 'Gerucht', anlass: 'Ein Gerucht aus dem Hafen von Ostia' }));
  grenzen(g, 3);
  const e = annehmenUndSpielen(t, notrufplan(5), 'gelungen');
  const data = Weltstand.capture(g);
  const sim = JSON.parse(JSON.stringify(data.welt.sim));
  const blk = sim.faeden.abenteuer;
  ok(data.version === 3 && Weltstand.validate(data, g).length === 0, 'Weltstand-Version 3, schemagueltig');
  ok(blk && blk.angebote.length === 2 && blk.angebote.every((x) => x.alter === 3 + 0 || x.alter >= 3) && /^abenteuer_[0-9a-f]{12}$/.test(blk.zuletzt), 'Block abenteuer: zwei Angebote mit Alter, zuletzt = Vorlagen-Id des gespielten Abenteuers');
  ok(blk.zuletzt === e.a.angebot.ref, 'zuletzt ist das gespielte Abenteuer');
  const laden = (s, seed) => { const t2 = neu(seed || 72, { env: { ABENTEUER_ANSCHLUSS: '0' } }); Kriegslage.restore(t2.g, s); return t2; };
  D.zuruecksetzen();   // wie ein neuer Prozess
  const t2 = laden(JSON.parse(JSON.stringify(sim)));
  ok(offen(t2.g).length === 2 && offen(t2.g).map((a) => a.ref).sort().join() === [p1.angebot.ref, p2.angebot.ref].sort().join() && D.vorlage(offen(t2.g)[0].ref), 'nach dem Laden: die Angebote sind da, ihre Plaene stehen im Register');
  ok(zust(t2.g).abenteuerZuletzt === blk.zuletzt && zust(t2.g).ladeFehler.length === 0, 'zuletzt gelesen, keine Ladefehler');
  ok(JSON.stringify(Faden.toSave(t2.g.weltsim)) === JSON.stringify(sim.faeden), 'Speichern nach dem Laden ergibt denselben Block');
  { // das Volk des Ortes geht beim Speichern und Laden nicht verloren: von, Marken und Volk des Angebots vor und nach dem Laden gleich
    const tg = neu(272, { env: { ABENTEUER_ANSCHLUSS: '0' } }), gg = tg.g;
    postenSetzen(gg, '0703', 'ger');
    const ag = anbieten(gg, plan([b('geruecht'), b('abschluss')], { titel: 'Germanen Gerucht', anlass: 'Ein Gerucht im germanischen Raum', volk_erlaubt: ['rom', 'ger'] }), '0703');
    const vor = block(gg), simg = JSON.parse(JSON.stringify(Weltstand.capture(gg).welt.sim));
    D.zuruecksetzen();
    const tl = laden(simg, 273), nach = block(tl.g);
    ok(ag.ok && ag.angebot.volk === 'ger' && vor.angebote[0].von === 'ger' && nach && nach.angebote[0].von === 'ger' && offen(tl.g)[0].volk === 'ger' && JSON.stringify(nach.angebote[0].vorschau) === JSON.stringify(vor.angebote[0].vorschau) && JSON.stringify(Faden.toSave(tl.g.weltsim)) === JSON.stringify(simg.faeden), 'Angebot an germanischem Hex: Volk, von und Marken vor und nach Speichern/Laden gleich (ger)');
    const sx = JSON.parse(JSON.stringify(simg)); sx.faeden.abenteuer.angebote[0].volk = 'kon'; const tx = laden(sx, 274);
    ok(offen(tx.g)[0].volk === '' && block(tx.g).angebote[0].von === 'rom', 'ein Volk, das die Vorlage nicht erlaubt, wird beim Laden verworfen (Rueckfall: erstes erlaubtes Volk)');
    sx.faeden.abenteuer.angebote[0].volk = 5; const ty = laden(sx, 275); ok(offen(ty.g)[0].volk === '' && ty.g.errors === 0, 'Volk kein Text: verworfen, kein Fehler');
    // die Geltungsdauer steht in den Daten: das Schema kennt keine eigene feste Obergrenze, das Laden prueft gegen den Datenwert
    const gilt = D.WERTE.abenteuer.angebot_gilt_taetigkeiten; D.WERTE.abenteuer.angebot_gilt_taetigkeiten = gilt + 8;
    try { const sl = JSON.parse(JSON.stringify(simg)); sl.faeden.abenteuer.angebote[0].alter = gilt + 6; const tz = laden(sl, 276), dz = Weltstand.capture(tz.g);
      ok(offen(tz.g)[0].alter === gilt + 6 && Weltstand.validate(dz, tz.g).filter((x) => /abenteuer|alter/.test(String(x))).length === 0, 'Geltungsdauer aus den Daten ' + (gilt + 8) + ': Alter ' + (gilt + 6) + ' laedt unveraendert und ist schemagueltig (kein festes Maximum im Schema)'); }
    finally { D.WERTE.abenteuer.angebot_gilt_taetigkeiten = gilt; }
    { const tr = neu(277, { env: { ABENTEUER_ANSCHLUSS: '0' } }); anbieten(tr.g, plan([b('geruecht'), b('abschluss')], { titel: 'Zwei Voelker', anlass: 'Ein Gerucht fuer zwei Voelker', volk_erlaubt: ['kon', 'rom'] }));
      const k1 = Brett.schluessel(tr.g); offen(tr.g)[0].volk = 'kon'; const k2 = Brett.schluessel(tr.g);
      ok(k1 && k2 && k1 !== k2, 'Schluessel: aendert sich die Fraktion des Auftraggebers (von), wird der Block neu gesendet'); } }
  const s2 = block(t2.g);
  ok(s2 && s2.angebote.length === 2 && s2.angebote[0].rest === GILT - blk.angebote[0].alter && s2.angebote[0].titel, 'der Block der neuen Sitzung zeigt die Angebote mit ihrem Verfall');
  ok(t2.an(s2.angebote[0].id).ok === true, 'ein geladenes Angebot laesst sich annehmen');
  // Muell
  const muell = (aend) => { const s = JSON.parse(JSON.stringify(sim)); aend(s.faeden.abenteuer); return laden(s, 73); };
  const mit = (name, aend, pruef) => { const tt = muell(aend); ok(pruef(tt) && tt.g.errors === 0, name); };
  mit('Angebote kein Array: alles verworfen, Meldung', (a) => { a.angebote = 'x'; }, (tt) => offen(tt.g).length === 0 && zust(tt.g).ladeFehler.length > 0);
  mit('hex unbrauchbar (Text, kein Sektor): Angebot verworfen, das andere bleibt', (a) => { a.angebote[0].hex = 'abcd'; }, (tt) => offen(tt.g).length === 1);
  mit('hex ausserhalb der spielbaren Sektoren: verworfen', (a) => { a.angebote[0].hex = '9999'; }, (tt) => offen(tt.g).length === 1);
  mit('Plan mit falscher Id (Hash passt nicht): verworfen', (a) => { a.angebote[0].plan.titel = 'Geaendert nach dem Speichern'; }, (tt) => offen(tt.g).length === 1);
  mit('Plan kein Objekt / null / Zahl: verworfen', (a) => { a.angebote[0].plan = null; a.angebote[1].plan = 5; }, (tt) => offen(tt.g).length === 0);
  mit('Plan mit Schluessel __proto__: verworfen, nichts im Prototyp', (a) => { a.angebote[0] = JSON.parse('{"hex":"0305","alter":0,"plan":{"__proto__":{"polluted":1},"id":"abenteuer_000000000000"}}'); }, (tt) => offen(tt.g).length === 1 && ({}).polluted === undefined);
  mit('alter negativ, Text: 0, kein Absturz', (a) => { a.angebote[0].alter = -5; a.angebote[1].alter = 'x'; }, (tt) => offen(tt.g).length === 2 && offen(tt.g).every((x) => x.alter === 0));
  mit('alter 99: auf die Geltungsdauer geklemmt', (a) => { a.angebote[0].alter = 99; }, (tt) => offen(tt.g).length === 2 && offen(tt.g).every((x) => x.alter <= GILT) && offen(tt.g).some((x) => x.alter === GILT));
  mit('dasselbe Angebot zweimal: einmal', (a) => { a.angebote = [a.angebote[0], a.angebote[0]]; }, (tt) => offen(tt.g).length === 1);
  mit('sechs verschiedene gueltige Angebote: genau drei', (a) => { a.angebote = ANS.plaene.map((p) => ({ hex: '0305', alter: 0, plan: BP.pruefe(p).vorlage })); }, (tt) => offen(tt.g).length === MAXA);
  mit('zuletzt kaputt (Text, Prototyp-Name, Zahl): wird ignoriert', (a) => { a.zuletzt = 'constructor'; }, (tt) => zust(tt.g).abenteuerZuletzt === undefined);
  { const s = JSON.parse(JSON.stringify(sim)); s.faeden.abenteuer = 7; const tt = laden(s, 74); ok(offen(tt.g).length === 0 && zust(tt.g).ladeFehler.some((x) => /abenteuer/.test(x)) && tt.g.errors === 0, 'abenteuer = 7: verworfen mit Meldung, kein Absturz'); }
  { const s = JSON.parse(JSON.stringify(sim)); s.faeden.abenteuer = JSON.parse('{"__proto__":{"x":1},"angebote":[]}'); const tt = laden(s, 75); ok(tt.g.errors === 0 && ({}).x === undefined, 'abenteuer mit __proto__: kein Absturz, keine Verschmutzung'); }
  { const s = JSON.parse(JSON.stringify(sim)); s.faeden.abenteuer.angebote[0].plan = { id: 'abenteuer_aaaaaaaaaaaa', beats: new Array(5000).fill({ typ: 'x' }) }; const tt = laden(s, 76); ok(offen(tt.g).length === 1 && tt.g.errors === 0, 'riesiger Plan: verworfen (Groessengrenze), kein Absturz'); }
  // Altstand: der Stand aus main laedt unveraendert
  const alt = lies('tools/fixtures/faeden/main-sim-altstand.json');
  { const tt = laden(alt, 77); ok(tt.g.errors === 0 && offen(tt.g).length === 0 && zust(tt.g).abenteuerZuletzt === undefined, 'Altstand aus main: laedt unveraendert, keine Angebote, kein zuletzt, kein Fehler'); }
  { const sim0 = JSON.parse(JSON.stringify(sim)); delete sim0.faeden.abenteuer; const tt = laden(sim0, 78); ok(tt.g.errors === 0 && offen(tt.g).length === 0, 'Stand ohne Block abenteuer: laedt'); }
  ok(g.errors === 0, 'keine Serverfehler');
});

section('Weltstand: ohne Angebot und ohne gespielte Abenteuer bleibt der Block weg (additiv)', () => {
  const t = neu(79, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  grenzen(g, 2);
  const sim = JSON.parse(JSON.stringify(Weltstand.capture(g).welt.sim));
  ok(!sim.faeden || !('abenteuer' in sim.faeden), 'kein Block abenteuer im Stand, solange es nichts zu speichern gibt');
});

section('Drei Spieler, ein Raum: dieselbe Anzeige fuer alle, die Crew entscheidet, keine Namen', () => {
  const t = neu(81, { env: { ABENTEUER_ANSCHLUSS: '0' } }), g = t.g;
  const a = anbieten(g, bitteplan(0, { titel: 'Mireille_Kas im Hafen', anlass: 'Ouzo_Brandt und Tzvi_Lund werden erwaehnt' }));
  anbieten(g, plan([b('konvoi'), b('abschluss')], { titel: 'Konvoi', anlass: 'Ein Konvoi zieht durch den Sektor' }));
  anbieten(g, plan([b('spur'), b('abschluss')], { titel: 'Spur', anlass: 'Eine Spur im Funkprotokoll' }));
  const s = block(g);
  const alle = JSON.stringify(s);
  ok(s && s.angebote.length === MAXA && !NAMEN.some((x) => alle.includes(x)), 'der Block (' + alle.length + ' Zeichen) hat keine Spielernamen (auch nicht in Titel, Anlass, Texten der Vorschau)');
  // die Antworten gehen nur an den Absender, zwei Spieler antworten gleichzeitig auf dasselbe Angebot
  t.cmd('abenteuer.annehmen', { id: 'a' + a.angebot.nr }, t.cs[1]);
  t.cmd('abenteuer.annehmen', { id: 'a' + a.angebot.nr }, t.cs[2]);
  const r1 = t.letzte(t.cs[1]), r2 = t.letzte(t.cs[2]);
  ok(r1.ok === true && r2.ok === false && r2.code === 'schon_beantwortet' && t.antw(t.cs[0]).length === 0, 'Spieler 2 gewinnt, Spieler 3 bekommt schon_beantwortet, Spieler 1 hoert nichts');
  ok(liste(g).filter((f) => f.phase !== 'abgeschlossen').length === 1, 'ein Abenteuer fuer die Crew, nicht eines je Spieler');
  const prompt = require('../server/sim/abenteuer-prompt.js').baue(g, { nr: 1, grenze: 'szene_ende', hex: '0305', letzte: [] });
  ok(!prompt.fehler && !NAMEN.some((x) => prompt.prompt.includes(x)) && !prompt.prompt.includes('Hafen von Ostia'), 'Prompt der Komposition: keine Spielernamen, kein Titel oder Anlass');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('Ohne Schalter nichts: kein Feld, kein Logbuch, kein Zustand', () => {
  const t = neu(91, { env: { FAEDEN: '' } }), g = t.g;
  for (let i = 0; i < 300; i++) g.step();
  grenzen(g, 4);
  ok(keinBlock(g), 'ohne FAEDEN: kein Feld world.abenteuer');
  ok(!g.weltsim.faeden || ((g.weltsim.faeden.abenteuerAngebote || []).length === 0 && !g.weltsim.faeden.abenteuerZuletzt), 'kein Angebot, kein zuletzt');
  ok(!logbuch(g).some((e) => /abenteuer/.test(e.art || '') || /abenteuer_/.test(e.ausgang || '')), 'kein Eintrag im Regie-Logbuch');
  ok(Brett.snapshot(g) === null && Brett.schluessel(g) === null && Brett.anschluss(g) === null, 'snapshot, schluessel und anschluss liefern null');
  const sim = Weltstand.capture(g).welt.sim;
  ok(!sim.faeden && g.errors === 0, 'kein Block faeden im Weltstand, keine Serverfehler');
});

(async () => {
  for (const [name, fn] of abschnitte) {
    if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
    console.log('\n' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  ABSTURZ ' + (e && e.stack)); }
  }
  console.log(`\n${n - fails} von ${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
  process.exit(fails ? 1 : 0);
})();
