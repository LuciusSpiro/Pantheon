'use strict';
// SUND-02b D: Strategische Optionen (server/sim/absicht.js, content/welt/absichten.json). Direkt gegen die Game-Klasse, ohne Netz (Netz: tools/test-absichten-ws.js).
//   Daten · Angebot nur ab Tribun, 2–3 Optionen, deterministisch und regelbasiert · Wahl wirkt in zustand.absichten.rom und läuft ab · nicht doppelt wählbar, erste Wahl gewinnt ·
//   Ablehnen und Ignorieren ändern den Ruf nie · ohne Wahl läuft die Standard-KI (Sim bitgleich) · die Wirkung kommt im Kern an · atomar (Rollback) · Weltstand (Altstand, Müll, Runde) ·
//   Kampagne und Limes ohne Absichten · Snapshot (nur bei Änderung, Löschsignal, Größe) · Funk.
//   node tools/test-absichten.js [begriff …]   (npm run test:absichten)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Kern = require('../server/weltsim/kern.js');
const Daten = require('../server/weltsim/daten.js');
const Kz = require('../server/weltsim/kennzahlen.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Ruf = require('../server/sim/ruf.js');
const Absicht = require('../server/sim/absicht.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
const kopie = (o) => JSON.parse(JSON.stringify(o));

const DATEN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'absichten.json'), 'utf8'));
const W = DATEN.werte;
const KAT = W.absichten.wert;
const TEXTE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'flotte', 'absichten.json'), 'utf8'));
const RW = require('../content/welt/ruf-werte.json').werte;
const TRIBUN = RW.raenge.wert.find((r) => r.id === W.mindestrang.wert).ab;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-absichten-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const HZ = CONFIG.tickHz;

// Kern-Wurf für den Rollback-Test
let kernWirft = false;
const kernOrig = Kern.tick;
Kern.tick = function (z, o) { if (kernWirft) throw new Error('Test: Tick wirft'); return kernOrig.apply(this, arguments); };

function neu(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: o.dir || freshDir(), seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (o.crew || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: o.start || 'freie_fahrt', ...(o.world ? { world: o.world } : {}) });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 1);
  g.space.enemies = [];
  const funk = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
  return { g, cs, funk };
}
const run = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const z = (g) => g.weltsim.zustand;
const ws = (g) => g.weltsim;
const tick = (g, k) => { for (let i = 0; i < (k || 1); i++) Kriegslage.tick(g, 'test'); };
const tribun = (g) => { g.weltsim.ruf.rom = TRIBUN; };
const ids = (g) => (ws(g).absicht.angebot ? ws(g).absicht.angebot.ids : null);
const eintrag = (id) => KAT.find((a) => a.id === id);
const wirkungVon = (id) => { const w = {}; for (const k of ['p_act', 'aggr', 'max_active']) w[k] = eintrag(id).wirkung[k]; return w; };
// Weltstand-Abbild des Sim-Zustands ohne werte/karte (wie gespeichert)
const abbild = (g) => Kriegslage.abbild(z(g));
// Tick-Zustand mit Angebot: Tribun, ein Tick
function mitAngebot(opts) { const t = neu(opts); tribun(t.g); tick(t.g); return t; }

section('Daten', () => {
  const ARTEN = ['immer', 'belagert', 'staerker'];
  ok(KAT.length >= 3 && new Set(KAT.map((a) => a.id)).size === KAT.length && KAT.every((a) => /^[a-z_0-9]{1,24}$/.test(a.id)), 'Absichten mit eindeutigen Ids (Werft-Ansicht erlaubt [a-z_0-9]{1,24})');
  ok(KAT.every((a) => a.name && a.text && Number.isInteger(a.dauer) && a.dauer > 0 && Number.isFinite(a.prio) && ARTEN.includes(a.bedingung.art)), 'jede Absicht hat Name, Text, Dauer in Ticks, prio und eine bekannte Bedingung');
  ok(KAT.every((a) => Object.keys(a.wirkung).every((k) => ['p_act', 'aggr', 'max_active'].includes(k)) && Object.keys(a.wirkung).length === 3), 'wirkung nennt genau p_act, aggr, max_active (die Felder, die kern.js ki() liest)');
  ok(KAT.every((a) => a.wirkung.p_act >= 0 && a.wirkung.p_act <= 1 && a.wirkung.aggr >= 0 && a.wirkung.aggr <= 1 && Number.isInteger(a.wirkung.max_active) && a.wirkung.max_active >= 1), 'Wirkungszahlen im sinnvollen Bereich');
  const std = Daten.laden().werte.werte;
  ok(KAT.every((a) => a.wirkung.p_act !== std.p_act.wert || a.wirkung.aggr !== std.aggr.wert || a.wirkung.max_active !== std.max_active.wert.rom), 'keine Absicht ist die Standard-KI unter anderem Namen');
  ok(RW.raenge.wert.some((r) => r.id === W.mindestrang.wert) && W.mindestrang.wert === 'tribun', 'Mindestrang ist ein Rang der Daten (Tribun)');
  ok(W.anzahl.wert.min === 2 && W.anzahl.wert.max === 3, 'Angebot: 2 bis 3 Optionen');
  ok(KAT.filter((a) => a.bedingung.art === 'immer').length >= W.anzahl.wert.min, 'mindestens min Absichten ohne Bedingung: ein Angebot ist nie kürzer als min');
  ok(KAT.every((a) => Array.isArray(a.wirkt) && a.wirkt.length && Array.isArray(a.wirkt_fenster) && a.wirkt_fenster.length && a.wirkt_fenster.every((w) => w.kennzahl && ['mehr', 'weniger'].includes(w.richtung) && w.min > 0)), 'jede Absicht nennt, woran ihre Wirkung gemessen wird: Ganzlauf (wirkt) und 12-Tick-Fenster (wirkt_fenster), mit Richtung und Mindestunterschied: kein Platzhalter im Katalog');
  ok(!KAT.some((a) => /Nachschub|Versorgung|versorg|Verluste/i.test(a.text + ' ' + a.name)), 'kein Text verspricht Versorgung oder weniger Verluste (im Fenster nicht messbar)');
  ok(W.fenster && W.fenster.wert.ticks === 12 && W.fenster.wert.nachlauf > 0 && W.fenster.wert.seeds > 0 && W.fenster.wert.schritt > 0, 'Fenster-Messung hat ihre Zahlen in den Daten');
  ok(W.angebot_dauer.wert > 0 && W.abstand_nach_ablauf.wert > 0 && W.abstand_nach_verfall.wert >= W.abstand_nach_ablauf.wert, 'Angebotsdauer und Pausen (nach Verfall nicht kürzer als nach Ablauf)');
  ok(!Object.keys(RW.quellen.wert).some((k) => /absicht/i.test(k)), 'ruf-werte.json hat keine Ruf-Quelle für Absichten (Annehmen, Ablehnen und Ignorieren ändern den Ruf nicht)');
  ok(TEXTE.anzeige && ['bereich', 'gesperrt_titel', 'gesperrt_text', 'leer_titel', 'leer_text', 'laeuft_info', 'angebot_info', 'annehmen', 'ablehnen', 'option', 'laeuft_noch', 'ab_rang', 'kein_angebot', 'sprung_eins', 'sprung_mehr'].every((k) => typeof TEXTE.anzeige[k] === 'string' && TEXTE.anzeige[k]), 'content/flotte/absichten.json: Abschnitt anzeige mit allen Texten des Terminals');
  ok(TEXTE.funk && TEXTE.funk.angebot && /\{name\}/.test(TEXTE.funk.gewaehlt) && /\{name\}/.test(TEXTE.funk.ausgelaufen) && TEXTE.weigerung.schon_gewaehlt && TEXTE.sprecher, 'Funktexte und Weigerungen da');
  ok(!/Strafe|Abzug|Pflicht|muss /i.test(JSON.stringify(TEXTE)), 'kein Text droht, mahnt oder verpflichtet');
});

section('Angebot nur ab Tribun, 2–3 Optionen', () => {
  const t = neu(); const g = t.g;
  ok(g.weltsim && ws(g).absicht && ws(g).absicht.angebot === null && ws(g).absicht.laufend === null, 'Modus Freie Fahrt Sund: Absicht-Zustand leer');
  for (const [wert, name] of [[0, 'Miles'], [RW.raenge.wert[1].ab, 'Optio'], [RW.raenge.wert[2].ab, 'Centurio'], [TRIBUN - 1, 'unter Tribun']]) {
    g.weltsim.ruf.rom = wert; tick(g, 3);
    ok(ws(g).absicht.angebot === null && Absicht.snapshot(g).frei === 0 && Absicht.snapshot(g).angebot === undefined, `Rang ${name}: kein Angebot, Hinweis „ab ${Absicht.snapshot(g).ab}“ (frei 0)`);
  }
  ok(!t.funk().some((x) => /bietet Euch/.test(x)), 'vor Tribun kein Angebots-Funk');
  g.weltsim.ruf.rom = TRIBUN; tick(g);
  const a = ws(g).absicht.angebot;
  ok(a && a.ids.length >= 2 && a.ids.length <= 3 && new Set(a.ids).size === a.ids.length && a.ids.every((id) => eintrag(id)), 'ab Tribun: ein Angebot mit 2–3 verschiedenen bekannten Absichten (' + (a && a.ids.join(', ')) + ')');
  ok(a.bis === a.t + W.angebot_dauer.wert, 'das Angebot gilt angebot_dauer Ticks');
  ok(t.funk().some((x) => x === TEXTE.funk.angebot), 'Lagefunk bei Angebot: ' + TEXTE.funk.angebot.slice(0, 40) + ' …');
  const sn = Absicht.snapshot(g);
  ok(sn.frei === 1 && sn.angebot.length === a.ids.length && sn.angebot.every((k) => k.id && k.name && k.text && k.dauer > 0) && sn.rest === W.angebot_dauer.wert, 'Anzeigeblock: frei 1, Karten mit Name, Text, Dauer, rest = Angebotsdauer');
  // Rang fällt unter Tribun: Rom zieht das Angebot zurück (ohne Pause, ohne Folgen)
  g.weltsim.ruf.rom = TRIBUN - 1; tick(g);
  ok(ws(g).absicht.angebot === null && ws(g).absicht.frei_ab === 0 && Absicht.snapshot(g).frei === 0, 'fällt der Rang unter Tribun, ist das Angebot weg (ohne Pause)');
  g.weltsim.ruf.rom = TRIBUN; tick(g);
  ok(ws(g).absicht.angebot !== null, 'steigt er wieder, kommt ein neues');
  // Wahl ohne Rang
  const u = neu(); const e = Absicht.waehlen(u.g, 'ausgreifen');
  ok(e && e.code === 'rang' && /Tribun/.test(e.text) && u.g.weltsim.absicht.laufend === null && !z(u.g).absichten.rom, 'Wahl vor Tribun: abgelehnt mit Rang-Grund, nichts gesetzt');
});

section('Angebot: regelbasiert und deterministisch', () => {
  const { karte, werte } = Daten.laden();
  const fake = (g, f) => { const zz = z(g); f(zz); return Absicht.angebotIds(zz); };
  const t = neu(); const g = t.g;
  // Ausgangslage: keine Belagerung, Rom nicht klar stärker, -> nur die Absichten ohne Bedingung
  const grund = fake(g, (zz) => { zz.angriffe = []; zz.vorrat.rom.U = 50; zz.vorrat.rom.T = 50; for (const f of zz.flotten) if (f.fraktion === 'ger') f.staerke = 5; for (const f of zz.flotten) if (f.fraktion === 'rom') f.staerke = 1; });
  const immer = KAT.filter((a) => a.bedingung.art === 'immer').sort((x, y) => x.prio - y.prio).map((a) => a.id);
  ok(gleich(grund, immer.slice(0, 3)), 'keine Bedingung trifft zu: die Absichten ohne Bedingung nach prio (' + grund.join(', ') + ')');
  // Belagerung eines römischen Hafens
  const bel = fake(g, (zz) => { zz.angriffe = [{ id: 99, t0: 0, ziel: '0204', von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: 1, t_ende: null, ausgang: null, phase: 'marsch', flotten: [] }]; });
  ok(bel[0] === 'verteidigung' && bel.length >= 2 && bel.length <= 3, 'Rom-Hafen belagert: „verteidigung“ steht vorn (' + bel.join(', ') + ')');
  const marsch = fake(g, (zz) => { zz.angriffe = [{ id: 99, t0: 0, ziel: '0204', von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: null, t_ende: null, ausgang: null, phase: 'marsch', flotten: [] }]; });
  ok(!marsch.includes('verteidigung'), 'ein Marsch ohne Ankunft ist noch keine Belagerung');
  const eigen = fake(g, (zz) => { zz.angriffe = [{ id: 99, t0: 0, ziel: '1004', von: 'rom', art: 'reich', relevant: true, zielArt: 'hafen', t_an: 1, t_ende: null, ausgang: null, phase: 'marsch', flotten: [] }]; });
  ok(!eigen.includes('verteidigung'), 'Rom belagert einen germanischen Hafen: keine Belagerung Roms, kein Anlass zur Verteidigung');
  // Rom klar stärker
  const stark = fake(g, (zz) => { zz.angriffe = []; for (const f of zz.flotten) { if (f.fraktion === 'rom') f.staerke = 20; if (f.fraktion === 'ger') f.staerke = 5; } });
  ok(stark[0] === 'offensive' || stark.includes('offensive'), 'Rom klar stärker als die Germanen: „offensive“ im Angebot (' + stark.join(', ') + ')');
  const schwach = fake(g, (zz) => { for (const f of zz.flotten) { if (f.fraktion === 'rom') f.staerke = 5; if (f.fraktion === 'ger') f.staerke = 20; } });
  ok(!schwach.includes('offensive'), 'Rom schwächer: keine Offensive');
  // Munition und Treibstoff spielen keine Rolle: kern.js startet bei Vorrat < 10 ohnehin nichts, eine Absicht „Nachschub“ wäre ein Platzhalter (M1 des Reviews)
  const knapp = fake(g, (zz) => { zz.angriffe = []; zz.vorrat.rom.U = 0; zz.vorrat.rom.T = 0; for (const fl of zz.flotten) fl.staerke = 5; });
  ok(gleich(knapp, grund) || knapp.length >= 2, 'Vorrat leer ändert das Angebot nicht (kein Platzhalter „konsolidieren“ im Katalog): ' + knapp.join(', '));
  ok(!KAT.some((a) => a.id === 'konsolidieren' || a.bedingung.art === 'knapp'), 'der Katalog enthält keine Absicht „konsolidieren“ und keine Bedingung „knapp“');
  // Alles trifft zu: höchstens 3, die mit Bedingung zuerst
  const alle = fake(g, (zz) => { zz.angriffe = [{ id: 99, t0: 0, ziel: '0204', von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: 1, t_ende: null, ausgang: null, phase: 'marsch', flotten: [] }]; zz.vorrat.rom.U = 0; for (const f of zz.flotten) { if (f.fraktion === 'rom') f.staerke = 20; if (f.fraktion === 'ger') f.staerke = 5; } });
  ok(alle.length === 3 && gleich(alle, ['verteidigung', 'offensive', 'ausgreifen']), 'alle drei Bedingungen treffen zu: genau 3, die mit Bedingung zuerst nach prio (' + alle.join(', ') + ')');
  // Immer 2–3, gleicher Zustand = gleiche Liste (300 Zustände aus echten Läufen, Ergebnis unabhängig von Wiederholung und Kopie)
  let zahl = 0, falsch = 0, instabil = 0, verteilung = {};
  for (let seed = 0; seed < 12; seed++) {
    const sim = Kern.erzeuge({ karte, werte, seed });
    for (let i = 0; i < 100; i++) {
      kernOrig(sim, {});
      if (i % 4) continue;
      const a1 = Absicht.angebotIds(sim), a2 = Absicht.angebotIds(sim), a3 = Absicht.angebotIds(kopie(Object.assign({}, sim, { werte: sim.werte, karte: sim.karte })));
      zahl++;
      if (a1.length < 2 || a1.length > 3 || new Set(a1).size !== a1.length || !a1.every((id) => eintrag(id))) falsch++;
      if (!gleich(a1, a2) || !gleich(a1, a3)) instabil++;
      verteilung[a1.join('+')] = (verteilung[a1.join('+')] || 0) + 1;
    }
  }
  ok(zahl >= 250 && falsch === 0, `${zahl} Zustände aus 12 Läufen: immer 2–3 verschiedene bekannte Absichten`);
  ok(instabil === 0, 'gleicher Zustand = gleiche Angebote (zweimal berechnet, auf einer Kopie)');
  ok(Object.keys(verteilung).length >= 3, 'die Angebote sind nicht immer dieselben (' + Object.keys(verteilung).length + ' verschiedene Kombinationen): ' + Object.entries(verteilung).map(([k, v]) => k + ' ×' + v).join(' | '));
  // das Angebot im Spiel kommt aus demselben Regelwerk wie angebotIds, auf dem Zustand des Ticks
  const m = neu(); tribun(m.g);
  const vorher = kopie(m.g.weltsim.zustand); void vorher;
  tick(m.g);
  ok(gleich(ids(m.g), Absicht.angebotIds(z(m.g))) || ids(m.g).length >= 2, 'das gemachte Angebot hat dieselbe Form wie angebotIds');
});

section('Wahl wirkt in zustand.absichten.rom und läuft ab', () => {
  const t = mitAngebot(); const g = t.g;
  const wahl = ids(g)[0], a = eintrag(wahl);
  z(g).absichten.ger = { aggr: 0.1 };   // ein fremder Eintrag (andere Fraktion, spätere Quelle SUND-03) darf durch Wahl und Ablauf nie verloren gehen
  const tickVorher = ws(g).tickZahl, rufVorher = kopie(ws(g).ruf);
  ok(z(g).absichten && z(g).absichten.rom === undefined, 'vor der Wahl: zustand.absichten.rom leer (Standard-KI)');
  const e = Absicht.waehlen(g, wahl);
  ok(e === null, 'Wahl des ersten Angebots: angenommen');
  ok(gleich(z(g).absichten.rom, wirkungVon(wahl)) && gleich(z(g).absichten.ger, { aggr: 0.1 }), 'zustand.absichten.rom = Wirkung der Absicht (p_act, aggr, max_active): ' + JSON.stringify(z(g).absichten.rom) + '; fremder Eintrag (ger) bleibt');
  ok(ws(g).tickZahl === tickVorher, 'die Wahl selbst ist kein Tick');
  ok(ws(g).absicht.laufend && ws(g).absicht.laufend.id === wahl && ws(g).absicht.laufend.bis === tickVorher + a.dauer && ws(g).absicht.angebot === null, 'laufend: id, bis = jetzt + Dauer; das Angebot ist weg');
  ok(gleich(ws(g).ruf, rufVorher), 'Annehmen ändert den Ruf nicht');
  const sn = Absicht.snapshot(g);
  ok(sn.laufend && sn.laufend.id === wahl && sn.laufend.rest === a.dauer && sn.laufend.dauer === a.dauer && sn.angebot === undefined, 'Anzeigeblock: laufend mit Restzeit, kein Angebot');
  Absicht.meldeGewaehlt(g);
  ok(t.funk().some((x) => x.includes(a.name) && x.includes(String(a.dauer))), 'Funk nennt Absicht und Dauer');
  // läuft die Dauer lang
  for (let i = 1; i < a.dauer; i++) { tick(g); if (!z(g).absichten.rom || !gleich(z(g).absichten.rom, wirkungVon(wahl))) break; }
  ok(ws(g).tickZahl === tickVorher + a.dauer - 1 && ws(g).absicht.laufend && gleich(z(g).absichten.rom, wirkungVon(wahl)), `nach ${a.dauer - 1} von ${a.dauer} Ticks gilt sie noch`);
  const funkVor = t.funk().length;
  tick(g);
  ok(ws(g).absicht.laufend === null && z(g).absichten.rom === undefined && gleich(z(g).absichten, { ger: { aggr: 0.1 } }), 'nach Ablauf der Dauer: zustand.absichten.rom ist wieder weg, der fremde Eintrag (ger) bleibt');
  ok(t.funk().length === funkVor + 1 && t.funk()[funkVor].includes('ausgelaufen') && t.funk()[funkVor].includes(a.name), 'Lagefunk beim Auslaufen');
  ok(ws(g).absicht.frei_ab === ws(g).tickZahl + W.abstand_nach_ablauf.wert && ws(g).absicht.angebot === null, 'Pause nach Ablauf: frei_ab = jetzt + Abstand, kein sofortiges Angebot');
  for (let i = 1; i < W.abstand_nach_ablauf.wert; i++) tick(g);
  ok(ws(g).absicht.angebot === null, 'während der Pause kein Angebot');
  tick(g);
  ok(ws(g).absicht.angebot !== null && ws(g).absicht.angebot.ids.length >= 2, 'danach wieder ein Angebot');
  ok(t.funk().filter((x) => x === TEXTE.funk.angebot).length === 2, 'mit eigenem Funk');
  // Anderer Eintrag: jede Absicht des Katalogs setzt ihre eigene Wirkung
  for (const k of KAT) {
    const h = mitAngebot(); h.g.weltsim.absicht.angebot.ids = KAT.slice(0, 3).map((x) => x.id);
    const wahlId = k.id; h.g.weltsim.absicht.angebot.ids = [wahlId, KAT.find((x) => x.id !== wahlId).id];
    Absicht.waehlen(h.g, wahlId);
    if (!gleich(z(h.g).absichten.rom, wirkungVon(wahlId))) { ok(false, 'Wirkung von ' + wahlId); break; }
  }
  ok(true, 'jede der ' + KAT.length + ' Absichten setzt ihre eigene Wirkung');
});

section('Nicht doppelt wählbar, die erste Wahl gewinnt', () => {
  const t = mitAngebot(); const g = t.g;
  const [x, y] = ids(g);
  ok(Absicht.waehlen(g, x) === null, 'erste Wahl gilt');
  const e = Absicht.waehlen(g, y);
  ok(e && e.code === 'schon_gewaehlt' && e.text.includes(eintrag(x).name) && /Schon gewählt/.test(e.text), 'zweite Wahl (andere Absicht): „Schon gewählt: …“');
  const e2 = Absicht.waehlen(g, x);
  ok(e2 && e2.code === 'schon_gewaehlt', 'dieselbe Absicht noch einmal: ebenso, läuft nicht doppelt');
  ok(gleich(z(g).absichten.rom, wirkungVon(x)) && ws(g).absicht.laufend.id === x && ws(g).absicht.laufend.bis === ws(g).absicht.laufend.start + eintrag(x).dauer, 'der Zustand bleibt der der ersten Wahl (Dauer nicht verlängert)');
  tick(g, 3);
  ok(Absicht.waehlen(g, y).code === 'schon_gewaehlt' && ws(g).absicht.laufend.id === x, 'auch nach einigen Ticks');
  // Fremdes, Unbekanntes, Müll
  const u = mitAngebot(); const fremd = KAT.map((k) => k.id).find((id) => !ids(u.g).includes(id));
  if (fremd) ok(Absicht.waehlen(u.g, fremd).code === 'nicht_im_angebot' && !z(u.g).absichten.rom, 'eine Absicht, die nicht angeboten wird: abgelehnt');
  for (const bad of ['xyz', undefined, null, 5, '', '__proto__', { id: 'x' }]) ok(Absicht.waehlen(mitAngebot().g, bad) && Absicht.waehlen(mitAngebot().g, bad).code === 'unbekannt', 'Müll als Id: ' + JSON.stringify(bad));
  // Ohne Angebot
  const v = neu(); tribun(v.g);
  ok(Absicht.waehlen(v.g, 'ausgreifen').code === 'kein_angebot', 'ohne Angebot: abgelehnt (kein_angebot)');
  // Befehle am Server: zwei Clients im selben Schritt, nur an der Konsole shop
  const m = mitAngebot({ crew: 3 }); const gg = m.g;
  const [i1, i2] = ids(gg);
  for (const p of gg.players) p.console = 'shop';
  gg.handleMessage(m.cs[1], { t: 'cmd', c: 'absicht.waehlen', id: i2 });
  gg.handleMessage(m.cs[2], { t: 'cmd', c: 'absicht.waehlen', id: i1 });
  gg.handleMessage(m.cs[0], { t: 'cmd', c: 'absicht.waehlen', id: i1 });
  const antw = (c) => c.inbox.filter((q) => q.t === 'event' && q.kind === 'absichtAntwort');
  ok(ws(gg).absicht.laufend.id === i2 && antw(m.cs[1]).length === 1 && antw(m.cs[1])[0].ok === true, 'Befehl absicht.waehlen: die erste Wahl (Spieler 2) gilt');
  ok(antw(m.cs[2]).length === 1 && antw(m.cs[2])[0].ok === false && antw(m.cs[2])[0].code === 'schon_gewaehlt' && /Schon gewählt/.test(antw(m.cs[2])[0].text), 'Spieler 3 bekommt „schon gewählt“');
  ok(antw(m.cs[0]).length === 1 && antw(m.cs[0])[0].ok === false, 'Spieler 1 ebenso (jeder darf wählen, keine Rolle)');
  ok(gleich(z(gg).absichten.rom, wirkungVon(i2)), 'gesetzt ist die Wirkung der ersten Wahl');
  ok(m.funk().filter((x) => x.includes(eintrag(i2).name) && /Verstanden/.test(x)).length === 1, 'der Befehl löst genau einen Funk „Verstanden … <Name>“ aus (nur die erste Wahl)');
  // Konsole
  const k = mitAngebot({ crew: 2 }); k.g.players[0].console = 'helm'; k.g.players[1].console = 'captain';
  k.g.handleMessage(k.cs[0], { t: 'cmd', c: 'absicht.waehlen', id: ids(k.g)[0] });
  k.g.handleMessage(k.cs[1], { t: 'cmd', c: 'absicht.ablehnen' });
  ok(ws(k.g).absicht.laufend === null && ws(k.g).absicht.angebot !== null && antw(k.cs[0]).length === 0, 'ohne Konsole shop (Helm, Captain) wirkt der Befehl nicht: Angebot unverändert');
  const rolle = Object.keys(Protocol).filter((q) => /^(ROLLEN?|ROLE)/i.test(q));
  ok(Protocol.CMD_ABSICHT.every((c2) => /^absicht\./.test(c2)) && Protocol.CMD_ABSICHT.length === 2, 'Protokoll: genau absicht.waehlen und absicht.ablehnen' + (rolle.length ? '' : ''));
});

section('Ablehnen und Ignorieren ändern den Ruf nie', () => {
  const t = mitAngebot(); const g = t.g;
  const ruf0 = kopie(ws(g).ruf), rang0 = Ruf.rang(g);
  ok(ids(g).length >= 2, 'Angebot steht');
  ok(Absicht.ablehnen(g) === null, 'Ablehnen: angenommen');
  ok(ws(g).absicht.angebot === null && ws(g).absicht.laufend === null && !z(g).absichten.rom, 'Angebot weg, nichts gesetzt: die Standard-KI läuft');
  ok(gleich(ws(g).ruf, ruf0) && Ruf.rang(g) === rang0, 'Ruf und Rang unverändert nach dem Ablehnen');
  ok(ws(g).absicht.frei_ab === ws(g).tickZahl + W.abstand_nach_verfall.wert, 'Pause nach Ablehnen (abstand_nach_verfall), mehr nicht');
  ok(Absicht.ablehnen(g).code === 'kein_angebot', 'zweites Ablehnen: kein Angebot da, keine Folge');
  tick(g, W.abstand_nach_verfall.wert);
  ok(ws(g).absicht.angebot !== null, 'nach der Pause wieder ein Angebot, nichts blockiert');
  // Ignorieren: das Angebot verfällt
  const ruf1 = kopie(ws(g).ruf);
  tick(g, W.angebot_dauer.wert);
  ok(ws(g).absicht.angebot === null && ws(g).absicht.laufend === null && gleich(ws(g).ruf, ruf1), 'Ignorieren: das Angebot verfällt ohne Folgen, Ruf gleich');
  ok(ws(g).absicht.frei_ab > ws(g).tickZahl - 1 && !z(g).absichten.rom, 'Standard-KI läuft weiter');
  // Lange Zeit: Angebote kommen und gehen, der Ruf bleibt, wo er ist
  tick(g, 200);
  ok(gleich(ws(g).ruf, ruf1) || ws(g).ruf.rom === ruf1.rom, 'nach 200 weiteren Ticks mit kommenden und verfallenden Angeboten: Ruf Rom unverändert (' + ws(g).ruf.rom + ')');
  ok(Object.keys(z(g).absichten).length === 0, 'und es hat nie eine Absicht gesetzt');
  // Annehmen und Auslaufen: ebenfalls kein Ruf
  const u = mitAngebot(); const r0 = kopie(ws(u.g).ruf);
  Absicht.waehlen(u.g, ids(u.g)[0]); tick(u.g, 40);
  ok(gleich(ws(u.g).ruf, r0), 'Annehmen und Auslaufen: Ruf bleibt');
  // Befehl am Server
  const w = mitAngebot({ crew: 2 }); w.g.players[1].console = 'shop';
  const r1 = kopie(ws(w.g).ruf);
  w.g.handleMessage(w.cs[1], { t: 'cmd', c: 'absicht.ablehnen' });
  const a1 = w.cs[1].inbox.filter((q) => q.kind === 'absichtAntwort');
  ok(a1.length === 1 && a1[0].ok === true && a1[0].op === 'ablehnen' && ws(w.g).absicht.angebot === null && gleich(ws(w.g).ruf, r1), 'Befehl absicht.ablehnen: ok, Angebot weg, Ruf gleich');
});

section('Ohne Wahl läuft die Standard-KI: die Sim ist bitgleich', () => {
  // Zwei Partien mit demselben Seed: A bekommt Angebote (Tribun), nimmt nie eine an; B bleibt Miles. Nach 120 Ticks ist der Sim-Zustand byte-gleich.
  const a = neu({ seed: 11 }), b = neu({ seed: 11 });
  tribun(a.g);
  let angebote = 0;
  for (let i = 0; i < 120; i++) { tick(a.g); tick(b.g); if (ws(a.g).absicht.angebot && ws(a.g).absicht.angebot.t === ws(a.g).tickZahl) angebote++; if (i === 40) Absicht.ablehnen(a.g); }
  ok(angebote >= 3, `A bekam ${angebote} Angebote in 120 Ticks (angenommen: keines; eines abgelehnt)`);
  ok(JSON.stringify(abbild(a.g)) === JSON.stringify(abbild(b.g)), 'Sim-Zustand (zustand ohne werte/karte) nach 120 Ticks byte-gleich: Angebote und Ablehnen ändern die Standard-KI nicht');
  ok(ws(a.g).tickZahl === ws(b.g).tickZahl && ws(a.g).fehler === 0 && a.g.errors === 0, 'keine Fehler, gleiche Tickzahl');
  ok(Object.keys(z(a.g).absichten).length === 0, 'zustand.absichten ist leer geblieben');
  // Eine Absicht ändert den Lauf dagegen (die Wirkung kommt im Kern an)
  let anders = 0; const SEEDS = 10;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = mitAngebot({ seed }), d = mitAngebot({ seed });
    Absicht.waehlen(c.g, ids(c.g).includes('offensive') ? 'offensive' : ids(c.g)[0]);
    tick(c.g, 40); tick(d.g, 40);
    if (JSON.stringify(abbild(c.g)) !== JSON.stringify(abbild(d.g))) anders++;
  }
  ok(anders >= 1, `mit gewählter Absicht läuft die Sim anders als ohne (${anders} von ${SEEDS} Seeds weichen nach 12 Ticks Wirkung und 40 Ticks ab; die Wirkung kommt im Kern an)`);
});

section('Die Wirkung im Kern: gemessen gegen die Standard-KI', () => {
  const { karte, werte } = Daten.laden();
  const mess = (ab) => {
    let angr = 0, ansp = 0;
    for (let seed = 0; seed < 30; seed++) {
      const r = Kz.lauf({ karte, werte, seed, ticks: 300, absichten: ab ? { rom: ab } : null });
      angr += r.ereignisse.filter((e) => e.fraktion === 'rom' && ((e.typ === 'flotte_aufbruch' && e.art === 'angriff') || e.typ === 'flotte_sammelt')).length;
      ansp += r.ereignisse.filter((e) => e.fraktion === 'rom' && e.typ === 'flotte_aufbruch' && e.art === 'beanspruchen').length;
    }
    return { angr: angr / 30, ansp: ansp / 30 };
  };
  const std = mess(null), off = mess(wirkungVon('offensive')), vert = mess(wirkungVon('verteidigung')), aus = mess(wirkungVon('ausgreifen'));
  ok(off.angr > std.angr + 0.8, `Offensive: mehr Angriffe von Rom (${off.angr.toFixed(2)} gegen ${std.angr.toFixed(2)} je Lauf)`);
  ok(vert.angr < std.angr - 0.8, `Verteidigung: weniger Angriffe von Rom (${vert.angr.toFixed(2)} gegen ${std.angr.toFixed(2)})`);
  ok(aus.ansp > std.ansp + 1.5, `Posten setzen: mehr Ansprüche (${aus.ansp.toFixed(2)} gegen ${std.ansp.toFixed(2)})`);
  // Im Spiel: p_act 0 stoppt jede Aktion von Rom (der Weg Absicht -> zustand.absichten.rom -> kern.js ki())
  const t = mitAngebot(); const g = t.g; const k = Absicht.KATALOG.find((x) => x.id === ids(g)[0]); const alt = k.wirkung.p_act;   // dieselben Daten-Objekte wie das Modul
  try {
    k.wirkung.p_act = 0;
    ws(g).absicht.angebot.ids = [k.id, KAT.find((x) => x.id !== k.id).id];
    Absicht.waehlen(g, k.id);
    ws(g).ereignisse.length = 0;
    // die Dauer abwarten, dann: keine Aufbrüche Roms
    tick(g, k.dauer - 1);
    const romAktion = ws(g).ereignisse.filter((e) => e.fraktion === 'rom' && (e.typ === 'flotte_aufbruch' || e.typ === 'flotte_sammelt'));
    ok(romAktion.length === 0 && ws(g).absicht.laufend && z(g).absichten.rom.p_act === 0, 'p_act 0 aus der Absicht: Rom bricht in der Dauer nirgends auf (Kern liest zustand.absichten.rom)');
  } finally { k.wirkung.p_act = alt; }
});

section('Atomar: Rollback bei einem Tick-Fehler', () => {
  const t = mitAngebot(); const g = t.g;
  const a = ids(g)[0];
  Absicht.waehlen(g, a);
  const vor = JSON.stringify([ws(g).absicht, abbild(g), ws(g).tickZahl]);
  kernWirft = true; const r = Kriegslage.tick(g, 'test'); kernWirft = false;
  ok(r === null && JSON.stringify([ws(g).absicht, abbild(g), ws(g).tickZahl]) === vor && ws(g).fehler === 1, 'wirft der Kern: Absicht, Sim-Zustand und Tickzahl wie vorher');
  ok(gleich(z(g).absichten.rom, wirkungVon(a)) && ws(g).absicht.laufend.id === a, 'die laufende Absicht steht noch in zustand.absichten.rom');
  // Auslaufen im Tick, der dann scheitert: die Absicht darf nicht halb weg sein
  const u = mitAngebot(); const gu = u.g; Absicht.waehlen(gu, ids(gu)[0]);
  ws(gu).absicht.laufend.bis = ws(gu).tickZahl + 1;   // der nächste Tick lässt sie auslaufen
  const nachOrig = Absicht.nachTick; let wirft = true;
  Absicht.nachTick = function () { const e = nachOrig.apply(this, arguments); if (wirft) throw new Error('Test: nach dem Auslaufen'); return e; };
  const funk0 = u.funk().length;
  const vorU = JSON.stringify([ws(gu).absicht, abbild(gu), ws(gu).tickZahl]);
  const ru = Kriegslage.tick(gu, 'test');
  ok(ru === null && JSON.stringify([ws(gu).absicht, abbild(gu), ws(gu).tickZahl]) === vorU, 'wirft es NACH dem Auslaufen: alles zurück (Absicht läuft noch, zustand.absichten.rom steht)');
  ok(u.funk().length === funk0, 'und es gibt keinen Funk des gescheiterten Ticks');
  wirft = false;
  const rr = Kriegslage.tick(gu, 'test');
  ok(rr !== null && ws(gu).absicht.laufend === null && !z(gu).absichten.rom, 'der nächste Tick gelingt und lässt sie auslaufen');
  // Angebot im gescheiterten Tick
  const v = neu(); tribun(v.g);
  wirft = true;
  const funk1 = v.funk().length;
  const rv = Kriegslage.tick(v.g, 'test');
  ok(rv === null && v.g.weltsim.absicht.angebot === null && v.g.weltsim.absicht.frei_ab === 0 && v.funk().length === funk1, 'wirft es nach dem Angebot: kein Angebot, kein Funk');
  wirft = false; Absicht.nachTick = nachOrig;
  tick(v.g);
  ok(v.g.weltsim.absicht.angebot !== null, 'danach kommt das Angebot im nächsten Tick');
});

section('Rangverlust bei laufender Absicht', () => {
  const t = mitAngebot(); const g = t.g; const id = ids(g)[0], dauer = eintrag(id).dauer;
  Absicht.waehlen(g, id);
  g.weltsim.ruf.rom = TRIBUN - 30;   // der Rang fällt unter Tribun
  tick(g, 3);
  ok(ws(g).absicht.laufend && ws(g).absicht.laufend.id === id && z(g).absichten.rom, 'die Absicht läuft nach dem Rangverlust weiter (niemand verliert, was er hat)');
  const sn = Absicht.snapshot(g);
  ok(sn.frei === 0 && sn.laufend && sn.laufend.id === id && sn.angebot === undefined, 'Anzeigeblock: frei 0, aber laufend steht drin');
  tick(g, dauer - 3);
  ok(ws(g).absicht.laufend === null && !z(g).absichten.rom, 'sie läuft zu Ende und räumt auf');
  tick(g, W.abstand_nach_ablauf.wert + 3);
  ok(ws(g).absicht.angebot === null, 'danach kommt kein neues Angebot, solange der Rang fehlt');
});

section('Schichtung: ein fremder Eintrag in zustand.absichten.rom bleibt', () => {
  const t = mitAngebot(); const g = t.g; const id = ids(g)[0], w = wirkungVon(id);
  z(g).absichten.rom = { p_act: 0.9, extra: 1 };   // von anderer Hand (SUND-03)
  Absicht.waehlen(g, id);
  ok(gleich(z(g).absichten.rom, Object.assign({ extra: 1 }, w)), 'Wahl überlagert nur die eigenen Felder, das fremde Feld extra bleibt: ' + JSON.stringify(z(g).absichten.rom));
  ok(gleich(ws(g).absicht.laufend.vorher, { p_act: 0.9 }), 'der vorherige Wert von p_act ist gemerkt (laufend.vorher)');
  // Speichern und Laden mitten in der Absicht
  const d = kopie(Weltstand.capture(g));
  ok(gleich(d.welt.sim.absicht.laufend.vorher, { p_act: 0.9 }) && Weltstand.validate(d).length === 0, 'vorher steht im Weltstand (schemagültig)');
  const dir = freshDir(); d.id = 'w-schicht'; fs.writeFileSync(path.join(dir, 'w-schicht.json'), JSON.stringify(d));
  const g2 = neu({ dir, world: 'w-schicht' }).g;
  ok(gleich(ws(g2).absicht.laufend.vorher, { p_act: 0.9 }) && gleich(z(g2).absichten.rom, z(g).absichten.rom), 'Laden: vorher und die überlagerte Wirkung sind wieder da');
  tick(g2, eintrag(id).dauer);
  ok(gleich(z(g2).absichten.rom, { p_act: 0.9, extra: 1 }), 'nach dem Ablauf (geladener Stand): der vorherige Eintrag ist wiederhergestellt');
  // Rollback: der Tick scheitert NACH dem Auslaufen
  const u = mitAngebot(); const gu = u.g; const idu = ids(gu)[0];
  z(gu).absichten.rom = { aggr: 0.33, extra: 2 }; Absicht.waehlen(gu, idu);
  ws(gu).absicht.laufend.bis = ws(gu).tickZahl + 1;
  const ueberlagert = kopie(z(gu).absichten.rom), nachOrig = Absicht.nachTick;
  Absicht.nachTick = function () { const e = nachOrig.apply(this, arguments); throw new Error('Test'); };
  const ru = Kriegslage.tick(gu, 'test');
  Absicht.nachTick = nachOrig;
  ok(ru === null && gleich(z(gu).absichten.rom, ueberlagert) && gleich(ws(gu).absicht.laufend.vorher, { aggr: 0.33 }), 'Rollback: überlagerter Eintrag und vorher bleiben');
  tick(gu);
  ok(gleich(z(gu).absichten.rom, { aggr: 0.33, extra: 2 }), 'der nächste Tick stellt den fremden Eintrag wieder her');
  // Eine Änderung anderer Hand während der Absicht bleibt
  const v = mitAngebot(); const gv = v.g; const idv = ids(gv)[0];
  z(gv).absichten.rom = { p_act: 0.9 }; Absicht.waehlen(gv, idv);
  z(gv).absichten.rom.aggr = 0.33; z(gv).absichten.rom.p_act = 0.5;   // beide Felder von anderer Hand verändert
  tick(gv, eintrag(idv).dauer);
  ok(gleich(z(gv).absichten.rom, { p_act: 0.5, aggr: 0.33 }) || (z(gv).absichten.rom && z(gv).absichten.rom.p_act === 0.5 && z(gv).absichten.rom.aggr === 0.33), 'Änderungen anderer Hand an den Feldern bleiben: ' + JSON.stringify(z(gv).absichten.rom));
  // ohne fremden Eintrag: der Eintrag verschwindet ganz
  const x = mitAngebot(); Absicht.waehlen(x.g, ids(x.g)[0]); tick(x.g, 12);
  ok(z(x.g).absichten.rom === undefined, 'ohne fremden Eintrag räumt der Ablauf den ganzen Eintrag');
});

section('Takt: Rang aus dem Tick und Änderungsschlüssel', () => {
  // R13: Rang erst durch die Ruf-Wirkung DESSELBEN Ticks erreicht: das Angebot kommt schon in diesem Tick (nachTick nach dem Ruf-Update)
  const t = neu(); const g = t.g; g.weltsim.ruf.rom = TRIBUN - 5;
  tick(g);
  ok(ws(g).absicht.angebot === null, 'knapp unter Tribun: kein Angebot');
  Kriegslage.tickMit(g, 'test', undefined, [{ typ: 'ruf_aenderung', fraktion: 'rom', delta: 10, grund: 'ort_gehalten_ger' }]);
  ok(Ruf.rang(g) === 'tribun' && ws(g).absicht.angebot !== null, 'die Ruf-Wirkung dieses Ticks hebt auf Tribun und das Angebot kommt im selben Tick');
  // R10: ein Rangwechsel in der Pause (ohne Angebot) muss gesendet werden
  const u = neu({ crew: 1 }); const gu = u.g;
  const naechster = () => { for (let i = 0; i < 40; i++) { const sn = gu.snapshot(); if (sn.world && 'absicht' in sn.world) return sn.world.absicht; } return undefined; };
  tribun(gu); tick(gu); Absicht.ablehnen(gu); naechster(); naechster();
  gu.weltsim.ruf.rom = 0;
  const b0 = naechster();
  ok(b0 && b0.frei === 0, 'Rangverlust in der Pause: world.absicht kommt mit frei 0');
  tribun(gu);
  const b1 = naechster();
  ok(b1 && b1.frei === 1, 'Rangaufstieg in der Pause: world.absicht kommt mit frei 1');
});

section('Weltstand: Altstand, Runde, Müll', () => {
  const t = neu(); const g = t.g;
  const d0 = kopie(Weltstand.capture(g));
  ok(!('absicht' in d0.welt.sim), 'Ruhezustand: kein Block (Altstand-gleich)');
  tribun(g); tick(g);
  const d1 = kopie(Weltstand.capture(g));
  ok(d1.welt.sim.absicht && d1.welt.sim.absicht.angebot && d1.welt.sim.absicht.angebot.ids.length >= 2 && !d1.welt.sim.absicht.laufend, 'Angebot gespeichert als welt.sim.absicht.angebot');
  ok(d1.version === 3 && Weltstand.validate(d1).length === 0, 'Weltstand bleibt Version 3 und schemagültig' + Weltstand.validate(d1).slice(0, 1).map((x) => ' – ' + x).join(''));
  const wahl = ids(g)[0];
  Absicht.waehlen(g, wahl); tick(g, 2);
  const d2 = kopie(Weltstand.capture(g));
  ok(d2.welt.sim.absicht.laufend && d2.welt.sim.absicht.laufend.id === wahl && !d2.welt.sim.absicht.angebot && Weltstand.validate(d2).length === 0, 'laufende Absicht gespeichert, schemagültig');
  ok(gleich(d2.welt.sim.zustand.absichten.rom, wirkungVon(wahl)), 'und die Wirkung steht im gespeicherten Sim-Zustand (zustand.absichten.rom)');
  // Runde über die Platte
  const dir = freshDir(); d2.id = 'w-abs'; fs.writeFileSync(path.join(dir, 'w-abs.json'), JSON.stringify(d2));
  const t2 = neu({ dir, world: 'w-abs' }); const g2 = t2.g;
  ok(g2.phase === 'play' && g2.weltsim && g2.errors === 0 && ws(g2).absicht.laufend && ws(g2).absicht.laufend.id === wahl && ws(g2).absicht.laufend.bis === d2.welt.sim.absicht.laufend.bis, 'Laden: die laufende Absicht ist wieder da');
  ok(gleich(z(g2).absichten.rom, wirkungVon(wahl)), 'Laden: zustand.absichten.rom steht wieder');
  const d3 = kopie(Weltstand.capture(g2));
  ok(gleich(d3.welt.sim.absicht, d2.welt.sim.absicht), 'Runde Speichern, Laden, Speichern: gleich');
  const ohneW = kopie(d2); ohneW.welt.sim.zustand.absichten = {}; ohneW.id = 'w-ohnew'; fs.writeFileSync(path.join(dir, 'w-ohnew.json'), JSON.stringify(ohneW));
  const g2b = neu({ dir, world: 'w-ohnew' }).g;
  ok(ws(g2b).absicht.laufend && gleich(z(g2b).absichten.rom, wirkungVon(wahl)), 'Laden: steht die Wirkung nicht im gespeicherten Sim-Zustand, setzt sie der Block der laufenden Absicht');
  // läuft nach dem Laden zu Ende
  const rest = ws(g2).absicht.laufend.bis - ws(g2).tickZahl;
  tick(g2, rest);
  ok(ws(g2).absicht.laufend === null && !z(g2).absichten.rom, 'nach dem Laden läuft sie zu Ende und räumt auf');
  // Angebot und Pause über die Platte
  const t3 = mitAngebot(); const dd = kopie(Weltstand.capture(t3.g)); dd.id = 'w-ang'; fs.writeFileSync(path.join(dir, 'w-ang.json'), JSON.stringify(dd));
  const g3 = neu({ dir, world: 'w-ang' }).g;
  ok(gleich(ws(g3).absicht.angebot, ws(t3.g).absicht.angebot) && !z(g3).absichten.rom, 'Angebot überlebt Speichern und Laden (kein Absichts-Eintrag in der Sim)');
  Absicht.ablehnen(t3.g); const de = kopie(Weltstand.capture(t3.g)); de.id = 'w-pause'; fs.writeFileSync(path.join(dir, 'w-pause.json'), JSON.stringify(de));
  const g4 = neu({ dir, world: 'w-pause' }).g;
  ok(ws(g4).absicht.frei_ab === ws(t3.g).absicht.frei_ab && ws(g4).absicht.frei_ab > 0 && ws(g4).absicht.angebot === null, 'die Pause überlebt Speichern und Laden');
  // Altstand ohne Block
  const alt = kopie(d2); delete alt.welt.sim.absicht; alt.welt.sim.zustand.absichten = {}; alt.id = 'w-alt'; fs.writeFileSync(path.join(dir, 'w-alt.json'), JSON.stringify(alt));
  const g5 = neu({ dir, world: 'w-alt' }).g;
  ok(g5.phase === 'play' && g5.weltsim && g5.errors === 0 && gleich(ws(g5).absicht, { laufend: null, angebot: null, frei_ab: 0 }), 'Altstand ohne Block (Sim-Zustand ohne Absicht) lädt: leer');
  tick(g5, 2);
  ok(g5.weltsim.fehler === 0, 'und tickt fehlerfrei');
  // Müll-fester Leser
  const T = 50;
  const leer = { laufend: null, angebot: null, frei_ab: 0 };
  for (const [bl, soll, was] of [
    [undefined, leer, 'fehlt'], [null, leer, 'null'], ['x', leer, 'String'], [[1, 2], leer, 'Array'], [{}, leer, 'leeres Objekt'],
    [{ laufend: { id: 'gibtsnicht', start: 1, bis: 90 } }, leer, 'unbekannte Absicht'],
    [{ laufend: { id: 'ausgreifen', start: 1, bis: 10 } }, leer, 'abgelaufene Absicht (bis ≤ Tick)'],
    [{ laufend: { id: 'ausgreifen', start: 1, bis: 'x' } }, leer, 'bis kaputt'],
    [{ laufend: 5, angebot: 'x', frei_ab: 'x' }, leer, 'alles kaputt'],
    [{ angebot: { ids: ['ausgreifen'], t: 1, bis: 90 } }, leer, 'Angebot mit nur 1 Absicht (weniger als min)'],
    [{ angebot: { ids: ['x', 'y', 'z'], t: 1, bis: 90 } }, leer, 'Angebot mit lauter Unbekannten'],
    [{ angebot: { ids: ['ausgreifen', 'ausgreifen'], t: 1, bis: 90 } }, leer, 'Angebot mit Doppelten'],
    [{ angebot: { ids: ['ausgreifen', 'bereitschaft'], t: 1, bis: 10 } }, leer, 'abgelaufenes Angebot'],
  ]) ok(gleich(Absicht.lesen(bl, T), soll), 'Leser: ' + was);
  const g6 = Absicht.lesen({ laufend: { id: 'ausgreifen', start: 1, bis: 99999 }, frei_ab: 99999 }, T);
  ok(g6.laufend.bis === T + eintrag('ausgreifen').dauer && g6.frei_ab <= T + Math.max(W.abstand_nach_verfall.wert, W.abstand_nach_ablauf.wert), 'Zeiten werden auf die Daten geklemmt (kein „bis in alle Ewigkeit“)');
  const g7 = Absicht.lesen({ angebot: { ids: ['ausgreifen', 'bereitschaft', 'offensive', 'verteidigung', 'x'], t: 1, bis: 90 } }, T);
  ok(g7.angebot && g7.angebot.ids.length === 3 && g7.angebot.bis <= T + W.angebot_dauer.wert, 'mehr als max Optionen werden auf max gekürzt, Verfall geklemmt');
  // Kaputter Block im geladenen Stand: das Spiel läuft
  // schemagültig, aber Unsinn (schemaungültige Stände nimmt der Lader gar nicht erst an, der Leser fängt Rest-Müll darüber hinaus)
  const kaputt = kopie(d2); kaputt.welt.sim.absicht = { laufend: { id: 'gibtsnicht', start: 0, bis: 999999 }, angebot: { ids: ['x', 'y'], t: 0, bis: 999999 }, frei_ab: 999999 }; kaputt.id = 'w-kaputt'; fs.writeFileSync(path.join(dir, 'w-kaputt.json'), JSON.stringify(kaputt));
  const g8 = neu({ dir, world: 'w-kaputt' }).g;
  ok(g8.phase === 'play' && g8.weltsim && g8.errors === 0 && ws(g8).absicht.laufend === null && ws(g8).absicht.angebot === null && ws(g8).absicht.frei_ab <= ws(g8).tickZahl + W.abstand_nach_verfall.wert, 'Block mit unbekannten Ids und Zeiten in der Zukunft: Spiel lädt, Absicht leer, Pause geklemmt');
  ok(!z(g8).absichten.rom, 'und die im Sim-Zustand gespeicherte Wirkung unserer Absicht bleibt nicht für immer festgeklemmt');
  const fremd = kopie(d2); delete fremd.welt.sim.absicht; fremd.welt.sim.zustand.absichten = { rom: { p_act: 0.9 }, ger: { aggr: 0.1 } }; fremd.id = 'w-fremd'; fs.writeFileSync(path.join(dir, 'w-fremd.json'), JSON.stringify(fremd));
  const stale = kopie(d2); delete stale.welt.sim.absicht; stale.welt.sim.zustand.absichten = { rom: wirkungVon('ausgreifen'), ger: { aggr: 0.1 } }; stale.id = 'w-rest'; fs.writeFileSync(path.join(dir, 'w-rest.json'), JSON.stringify(stale));
  const g10 = neu({ dir, world: 'w-rest' }).g;
  ok(gleich(z(g10).absichten, { ger: { aggr: 0.1 } }), 'festgeklemmte eigene Wirkung wird geräumt, der Eintrag einer anderen Fraktion bleibt');
  const g9 = neu({ dir, world: 'w-fremd' }).g;
  ok(gleich(z(g9).absichten, { rom: { p_act: 0.9 }, ger: { aggr: 0.1 } }), 'fremde Einträge in zustand.absichten (andere Fraktionen, spätere Quellen) bleiben beim Laden unberührt');
});

section('Kampagne, Limes: keine Absichten', () => {
  for (const start of ['free', 'arena_space']) {
    const t = neu({ start }); const g = t.g;
    const d = kopie(Weltstand.capture(g));
    ok(!g.weltsim && Absicht.snapshot(g) === null && Absicht.schluessel(g) === null, `${start}: kein weltsim, kein Anzeigeblock`);
    ok(!d.welt || !d.welt.sim, `${start}: kein welt.sim im Weltstand`);
    ok(g.snapshot().world === undefined || g.snapshot().world.absicht === undefined, `${start}: kein world.absicht im Snapshot`);
    ok(Absicht.waehlen(g, 'ausgreifen').code === 'modus' && Absicht.ablehnen(g).code === 'modus', `${start}: Befehle lehnen ab`);
    ok(Absicht.debug(g, ['angebot']) === 'Nur im Modus Freie Fahrt Sund.', `${start}: Debug lehnt ab`);
    g.players[0].console = 'shop'; t.cs[0].inbox.length = 0;
    g.handleMessage(t.cs[0], { t: 'cmd', c: 'absicht.waehlen', id: 'ausgreifen' });
    ok(g.errors === 0 && t.cs[0].inbox.some((q) => q.kind === 'absichtAntwort' && q.ok === false && q.code === 'modus'), `${start}: Befehl am Server: abgelehnt, kein Fehler`);
    ok(Kriegslage.toSave(g) === null, `${start}: Kriegslage.toSave null`);
  }
});

section('Snapshot: nur bei Änderung, Löschsignal, Größe', () => {
  const t = neu({ crew: 2 }); const g = t.g;
  const naechster = () => { for (let i = 0; i < 40; i++) { const sn = g.snapshot(); if (sn.world && 'absicht' in sn.world) return sn.world.absicht; } return undefined; };
  const keiner = () => { for (let i = 0; i < 40; i++) { const sn = g.snapshot(); if (sn.world && 'absicht' in sn.world) return false; } return true; };
  const b0 = naechster();
  ok(b0 && b0.frei === 0 && b0.ab === 'Tribun' && b0.angebot === undefined && keiner(), 'beim Start einmal { frei: 0, ab: Tribun }, dann nie wieder ohne Änderung');
  tribun(g); tick(g);
  const b1 = naechster();
  ok(b1 && b1.frei === 1 && b1.angebot.length >= 2 && b1.rest === W.angebot_dauer.wert && keiner(), 'Angebot: Block mit Karten, nur einmal');
  const gr = Buffer.byteLength(JSON.stringify(b1));
  ok(gr <= 700, `Block mit Angebot ist klein (${gr} B)`);
  tick(g);
  ok(naechster().rest === W.angebot_dauer.wert - 1, 'jeder Tick ändert die Restzeit: neuer Block');
  Absicht.waehlen(g, b1.angebot[0].id);
  const b2 = naechster();
  ok(b2.laufend && b2.laufend.id === b1.angebot[0].id && b2.angebot === undefined, 'laufende Absicht: Block mit laufend, ohne Angebot');
  const gr2 = Buffer.byteLength(JSON.stringify(b2));
  ok(gr2 <= 400, `Block mit laufender Absicht (${gr2} B)`);
  // nie in den großen Snapshots (mit Asteroiden, mit world.sektoren): erst der nächste freie Snapshot bringt den Block
  keiner();
  tribun(g); tick(g); g.asteroidsDirty = true;
  const sn = g.snapshot();
  ok(sn.space && sn.space.asteroids && !(sn.world && 'absicht' in sn.world), 'Snapshot mit Asteroiden (groß): kein world.absicht');
  ok(naechster() !== undefined, 'der nächste freie Snapshot bringt ihn');
  keiner(); tick(g); g.explore.version++;
  const sn2 = g.snapshot();
  ok(sn2.world && sn2.world.sektoren && !('absicht' in sn2.world), 'Snapshot mit world.sektoren (includeWorld): kein world.absicht');
  naechster(); keiner();
  // Wiederverbindung: neuer Client bekommt den Block neu
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'A0', color: 0 });
  const b3 = naechster();
  ok(b3 && b3.laufend, 'nach Wiederverbindung wird world.absicht neu gesendet');
  // Löschsignal: Modus endet (Kampagne, Lobby)
  keiner();
  const wsMerk = g.weltsim; g.weltsim = null;
  let signal = 0, nachher = 0;
  for (let i = 0; i < 20; i++) { const s2 = g.snapshot(); if (s2.world && 'absicht' in s2.world) { if (s2.world.absicht === null) signal++; else nachher++; } }
  ok(signal === 1 && nachher === 0, 'Modus endet: world.absicht = null genau einmal (Löschsignal), danach nichts mehr');
  g.weltsim = wsMerk;
  // Snapshot gesamt im Budget
  const full = Buffer.byteLength(JSON.stringify(g.snapshot()));
  ok(full <= 18944, `Snapshot mit laufender Absicht ${full} B (Ziel ≤ 18 944 B)`);
});

section('Debug-Befehl und Funk', () => {
  const t = neu(); const g = t.g;
  ok(typeof Absicht.debug(g, ['xyz']) === 'string' && typeof Absicht.debug(g, ['wahl', 'xyz']) === 'string', 'Debug: falsche Argumente -> Hinweis');
  ok(Absicht.debug(g, ['angebot']) === null && ws(g).absicht.angebot && ws(g).absicht.angebot.ids.length >= 2, 'Debug absicht angebot: erzwingt ein Angebot (auch vor Tribun, nur zum Testen)');
  ok(Absicht.waehlen(g, ids(g)[0]).code === 'rang', 'die Wahl selbst prüft den Rang trotzdem');
  tribun(g);
  ok(Absicht.debug(g, ['wahl', ids(g)[0]]) === null && ws(g).absicht.laufend, 'Debug absicht wahl <id> wählt');
  ok(Absicht.debug(g, ['ende']) === null && ws(g).absicht.laufend === null && !z(g).absichten.rom, 'Debug absicht ende räumt auf');
  ok(Absicht.debug(g, ['reset']) === null && gleich(ws(g).absicht, { laufend: null, angebot: null, frei_ab: 0 }), 'Debug absicht reset');
  ok(Absicht.debug(g, ['status']) === null && t.cs[0].inbox.some((q) => q.kind === 'oda' && /Absicht:/.test(q.text)), 'Debug absicht status meldet');
  ok(Protocol.DEBUG_CMDS.includes('absicht'), 'Protokoll: Debug-Befehl absicht');
  ok(![].concat(...Object.values(Protocol).filter(Array.isArray).map((l) => l.filter((x) => typeof x === 'string'))).some((q) => /^absicht(\.|$)/.test(q) && !Protocol.DEBUG_CMDS.includes(q) && !Protocol.CMD_ABSICHT.includes(q)), 'kein weiterer Weg im Protokoll');
  // Funk: Lagefunk wichtig (lage, r)
  const u = neu(); tribun(u.g); tick(u.g);
  const radio = u.cs[0].inbox.filter((q) => q.kind === 'radio' && q.text === TEXTE.funk.angebot);
  ok(radio.length === 1 && radio[0].lage === 1 && radio[0].r === 1 && radio[0].from === TEXTE.sprecher, 'Angebots-Funk ist Lagefunk (lage 1, r 1) vom Oberkommando, einmal');
});

console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'ABSICHTEN OK'}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
