'use strict';
// SUND-03b I: Informationshandel des Konkordats (server/sim/handel-info.js, content/welt/handel-info-werte.json, Wissen.belege in kriegslage-wissen.js, Bereich Information im Terminal).
//   Daten · Angebot (deterministisch, nur was es gibt) · KERN: Beleg = Sim (viele Seeds × Ticks × Themen) · Gerücht (gekennzeichnet, Falschquote, nur erlaubte Felder) · Rahmen (Stelle für Paket T)
//   · Kauf (Marken atomar, zu wenig Marken, nur Konkordat-Häfen, nur mit Weltsim) · Karte (zusatzSicht: Beleg für die Dauer, danach nicht mehr; Sonden bleiben) · Sim byte-gleich mit und ohne Käufe
//   · Weltstand (Speichern, Laden, müllfest, ohne Käufe byte-gleich) · Terminal (echte terminal-ui.js)
//   node tools/test-handel-info.js [begriff …]   (npm run test:handel-info)
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Maps = require('../shared/maps.js');
const Physics = require('../shared/physics.js');
const Protocol = require('../shared/protocol.js');
const Katalog = require('../shared/schiffskatalog.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const Daten = require('../server/weltsim/daten.js');
const Kern = require('../server/weltsim/kern.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Wissen = require('../server/sim/kriegslage-wissen.js');
const Info = require('../server/sim/handel-info.js');
const KT = require('../public/js/karte-tokens.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const kopie = (x) => JSON.parse(JSON.stringify(x));
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const WJ = require('../content/welt/handel-info-werte.json');
const W = Object.fromEntries(Object.entries(WJ.werte).map(([k, v]) => [k, v.wert]));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-handel-info-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const KON_HAFEN = '0604';   // Concordia, Hafen des Konkordats
const ROM_HAFEN = '0305';   // Ostia Nova
const DATEN = Daten.laden();

// ---------------------------------------------------------------------------------------------------------------- reine Sim (ohne Spiel): viele Seeds und Ticks
function simLauf(seed, ticks, bei) {
  const z = Kern.erzeuge({ karte: DATEN.karte, werte: DATEN.werte, seed });
  const d = Daten.datenVon(z), ereignisse = [];
  for (let t = 1; t <= ticks; t++) {
    const r = Kern.tick(z, {});
    for (const ev of r.ereignisse) ereignisse.push(Object.assign({ n: z.tick }, ev));
    bei({ z, d, tickZahl: z.tick, ereignisse }, t);
  }
}
// Unabhängige Ableitung der Wahrheit eines Themas aus dem Sim-Zustand (nicht über handel-info.js)
function wahrheit(ctx, thema) {
  const { z, d } = ctx, [art, a, b, c] = thema.key.split(':');
  if (art === 'gefallen') {
    const ev = ctx.ereignisse.find((e) => e.typ === a && e.ort === b && String(e.n) === c);
    return { art, fakten: { ort: ev.ort, fraktion: a === 'hafen_gefallen' ? ev.neu : ev.durch, zeit: ctx.tickZahl - ev.n + 1 } };
  }
  const rec = z.angriffe.find((r) => r.id === Number(a));
  const fl = z.flotten.filter((f) => f.angriff === rec.id);
  const st = fl.reduce((s, f) => s + f.staerke, 0);
  const klasse = st >= z.werte.staerkeklassen.gross ? 3 : st >= z.werte.staerkeklassen.mittel ? 2 : 1;
  const wa = rec.t_an !== null ? 'belagert' : rec.phase === 'sammeln' ? 'sammeln' : 'marsch';
  const fakten = { ort: rec.ziel, fraktion: rec.von, klasse };
  if (wa === 'belagert') fakten.zeit = z.tick - rec.t_an + 1;
  return { art: wa, fakten };
}
function erwarteterText(stufe, art, f, d) {
  const zt = (k) => (k === 1 ? W.zeit.eins : W.zeit.mehr).replace('{n}', String(k));
  const w = { ort: d.hex[f.ort].name, fraktion: W.fraktionen[f.fraktion], klasse: ['', 'klein', 'mittel', 'groß'][f.klasse] || '', zeit: f.zeit ? zt(f.zeit) : '' };
  return W.kennzeichnung[stufe] + ': ' + W.themen[art][stufe].replace(/\{(\w+)\}/g, (m, k) => w[k]);
}

// ---------------------------------------------------------------------------------------------------------------- Spiel
function neuesSpiel(opt) {
  opt = opt || {};
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: freshDir(), seed: opt.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') } });
  const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'P0', name: 'P0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: opt.start || 'freie_fahrt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 30; i++) g.step();
  g.space.enemies = [];
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  return { g, c, p: g.players[0] };
}
function andocken(g, hex) {
  const Space = require('../server/sim/space.js');
  Space.enterScene(g, Sektoren.ortVonHex(hex), {});
  Object.assign(g.ship, { docked: true, dockedAt: Sektoren.ortVonHex(hex), vx: 0, vy: 0, speed: 0 });
  g.inventory.marks = 5000; g.players[0].console = 'shop';
}
const sim = (g) => g.weltsim.zustand;
const tickEin = (g) => Kriegslage.tick(g, 'test');
// Spiel mit Angebot: Ticks laufen lassen, bis das Konkordat etwas zu verkaufen hat
function mitAngebot(seed, art, mind) {
  const s = neuesSpiel({ seed }); andocken(s.g, KON_HAFEN);
  for (let t = 0; t < 400; t++) { tickEin(s.g); const a = Info.angebotFuer(s.g); if (a.themen.length >= (mind || 1) && (!art || a.themen.some((x) => x.art === art))) return Object.assign(s, { angebot: a }); }
  return null;
}
// Szene wie test-lage-wissen.js: ruhige Welt, eigene Feldzüge nach Wunsch, Lerche weit weg
function szene(opt) {
  opt = opt || {};
  const s = neuesSpiel({ seed: opt.seed }); const { g } = s, ws = g.weltsim, z = ws.zustand;
  for (const fl of z.flotten) { fl.befehl = 'heim'; fl.ziel = null; fl.ort = fl.heimat; fl.angriff = null; }
  z.angriffe.length = 0;
  Object.assign(z.hexe['0603'], { besitzer: 'rom', posten: true, garnison: 4 });
  andocken(g, KON_HAFEN);
  Wissen.starten(g);
  g.sektorplan = g.sektorplan || { gesichtet: {} };
  s.ws = ws; s.z = z;
  s.schritt = (aendere) => { const vor = Kriegslage.abbild(ws.zustand); if (aendere) aendere(ws.zustand); ws.tickZahl++; ws.zustand.tick++; Wissen.nachTick(g, vor, [], KON_HAFEN); };
  return s;
}
const flotteVon = (z, heimat) => z.flotten.find((f) => f.heimat === heimat && f.fraktion !== 'pirat');
function marsch(z, fl, an, von, ziel, o) {
  fl.befehl = 'angriff'; fl.ziel = ziel; fl.ort = von; fl.angriff = an;
  z.angriffe.push(Object.assign({ id: an, t0: z.tick, ziel, von: fl.fraktion, art: 'reich', relevant: true, zielArt: 'hafen', t_an: null, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: z.tick, stuetz: null, flotten: [fl.id] }, o || {}));
}

// ================================================================================================================================ Daten
section('Daten', () => {
  ok(WJ.format === 'handel-info-werte/1', 'Format');
  ok(W.preise.gerucht === 30 && W.preise.beleg === 120, 'Standardpreise 30 und 120 Marken');
  ok(Math.abs(W.falschquote - 1 / 3) < 0.001, 'Falschquote ein Drittel (Datenwert)');
  ok(W.angebot.min === 2 && W.angebot.max === 3 && W.beleg_dauer === 40, 'Angebot 2–3 Themen, Beleg-Dauer 40 Ticks');
  ok(Info.ARTEN.length === 4 && Info.ARTEN.every((a) => W.themen[a] && W.themen[a].label && W.falsch_felder[a]), 'vier Themenarten mit Überschrift und erlaubten Falschfeldern');
  ok(Info.ARTEN.every((a) => Info.STUFEN.every((s) => Info.rahmenGueltig(W.themen[a][s], a))), 'jeder Rahmen der Daten trägt genau die Platzhalter seines Themas');
  ok(Info.ARTEN.every((a) => W.falsch_felder[a].every((f) => W.themen[a].platzhalter.includes(f))), 'falsch_felder nur aus Feldern, die im Text vorkommen');
  ok(Object.keys(W.kennzeichnung).join() === 'gerucht,beleg' && /Gerücht/.test(W.kennzeichnung.gerucht) && /unbestätigt/.test(W.kennzeichnung.gerucht), 'Kennzeichnung des Gerüchts „Gerücht, unbestätigt“ als Daten');
  ok(W.haefen_besitzer.join() === 'kon,saum', 'Häfen des Konkordats (kon, saum)');
  ok(Object.keys(W.texte).every((k) => typeof W.texte[k] === 'string' && W.texte[k].length > 2) && ['kein_angebot', 'zu_wenig_marken', 'kein_konkordat', 'fehler'].every((k) => W.texte[k]), 'Texte als Daten');
  ok(!/spieler|P0|Ui\d/i.test(JSON.stringify(WJ)), 'keine Spielernamen');
  ok(Protocol.CMD_INFO && Protocol.CMD_INFO.join() === 'info.kaufen', 'Protokoll kennt info.kaufen');
});

// ================================================================================================================================ Angebot
section('Angebot: deterministisch, 2–3 Themen, nur was es gibt', () => {
  let gesehen = 0, leer = 0, drei = 0, zwei = 0, eins = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    simLauf(seed, 160, (ctx) => {
      const a = Info.angebotAus(ctx, KON_HAFEN), b = Info.angebotAus(ctx, KON_HAFEN), alle = Info.themenAus(ctx);
      gesehen++;
      if (!gleich(a, b)) throw new Error('Angebot nicht deterministisch (Seed ' + seed + ')');
      if (!a.length) { leer++; if (alle.length) throw new Error('Themen da, aber kein Angebot'); return; }
      if (a.length < Math.min(W.angebot.min, alle.length) || a.length > W.angebot.max) throw new Error('Anzahl ' + a.length);
      if (!a.every((t) => alle.some((x) => x.key === t.key))) throw new Error('Thema im Angebot, das es nicht gibt');
      if (new Set(a.map((t) => t.key)).size !== a.length) throw new Error('doppeltes Thema');
      if (!a.every((t, i) => t.id === 't' + i)) throw new Error('Ids t0…');
      if (a.length === 3) drei++; else if (a.length === 2) zwei++; else eins++;
    });
  }
  ok(gesehen === 960, 'in 960 Zuständen: gleicher Zustand = gleiche Liste, nur vorhandene Themen, keine doppelten');
  ok(drei > 0 && zwei > 0, `Länge 2 (${zwei}×) und 3 (${drei}×) kommen vor, nie mehr als 3; 1 Thema nur wenn es nur eins gibt (${eins}×)`);
  ok(leer > 0, `Zustände ohne jedes Thema: leeres Angebot (${leer}×)`);
  // gefallene Orte: nur im Fenster nach dem Fall
  { const z = Kern.erzeuge({ karte: DATEN.karte, werte: DATEN.werte, seed: 3 }), d = Daten.datenVon(z), T = 100;
    const ev = (n, ort) => ({ n, typ: 'hafen_gefallen', tick: n, fraktion: 'ger', ort, alt: 'rom', neu: 'ger' });
    const th = Info.themenAus({ z, d, tickZahl: T, ereignisse: [ev(T, '0603'), ev(T - W.gefallen_fenster + 1, '0703'), ev(T - W.gefallen_fenster, '0803')] }).filter((t) => t.art === 'gefallen');
    ok(th.length === 2 && th.every((t) => t.fakten.ort !== '0803') && th.find((t) => t.fakten.ort === '0603').fakten.zeit === 1 && th.find((t) => t.fakten.ort === '0703').fakten.zeit === W.gefallen_fenster, 'gefallene Orte: Fenster ' + W.gefallen_fenster + ' Ticks, zeit zählt ab 1, ältere Ereignisse sind kein Thema');
    ok(Info.themenAus({ z, d, tickZahl: T, ereignisse: [{ n: T, typ: 'posten_verloren', tick: T, fraktion: 'rom', ort: '0603', ortName: 'x', besitzer: 'rom', durch: null }] }).length === 0, 'Posten ohne bekannten neuen Besitzer ist kein Thema (nichts wird erfunden)');
  }
  // zwei Spiele, gleicher Seed und Tick: gleiche Liste (Zustand + Zähler), auch bei anderem Hafen anders gemischt
  const A = mitAngebot(11), B = (() => { const s = neuesSpiel({ seed: 11 }); andocken(s.g, KON_HAFEN); for (let i = 0; i < A.g.weltsim.tickZahl; i++) tickEin(s.g); return s; })();
  ok(A && A.g.weltsim.tickZahl === B.g.weltsim.tickZahl && gleich(Info.angebotFuer(A.g).themen, Info.angebotFuer(B.g).themen), 'zwei Spiele, gleicher Seed und Tick: dieselbe Liste');
  const snap = Info.snapshot(A.g);
  ok(snap && snap.th.length === A.angebot.themen.length && snap.th.every((t) => /^t\d$/.test(t.i) && W.themen[t.a]), 'Anzeigeblock: Id und Art je Thema');
  ok(!/\d{4}|fraktion|klasse|zeit/.test(JSON.stringify(snap.th)), 'der Block verrät vor dem Kauf keine Fakten (kein Ort, keine Fraktion, keine Stärke)');
});

// ================================================================================================================================ KERN: Beleg = Sim
section('KERN: Beleg = Sim (Seeds × Ticks × Themen)', () => {
  let themen = 0, belege = 0; const proArt = {}; let sichtOk = 0;
  for (let seed = 0; seed < 20; seed++) {
    simLauf(seed, 220, (ctx) => {
      const ts = Info.themenAus(ctx);
      for (const r of ctx.z.angriffe) if ((r.t_ende !== null || r.phase === 'abgebrochen') && ts.some((t) => t.key.split(':')[1] === String(r.id) && t.art !== 'gefallen')) throw new Error('beendeter Feldzug ' + r.id + ' als Thema');
      for (const t of ts) {
        const w = wahrheit(ctx, t), e = Info.ergebnisAus(ctx, t, 'beleg', 0);
        themen++; belege++; proArt[t.art] = (proArt[t.art] || 0) + 1;
        if (t.art !== w.art) throw new Error('Art ' + t.art + ' ≠ ' + w.art);
        if (!gleich(e.fakten, w.fakten)) throw new Error(`Beleg ≠ Sim (Seed ${seed}, ${t.key}): ${JSON.stringify(e.fakten)} gegen ${JSON.stringify(w.fakten)}`);
        if (e.text !== erwarteterText('beleg', w.art, w.fakten, ctx.d)) throw new Error('Belegtext ≠ Sim: ' + e.text);
        if (e.wahr !== true || e.zuverlaessigkeit !== 'beleg') throw new Error('Beleg nicht als Beleg');
        if (!t.sicht.h.includes(w.fakten.ort)) throw new Error('der Ort steht nicht in der Sicht des Belegs');
        sichtOk++;
      }
    });
  }
  ok(themen >= 600, `${themen} Themen geprüft: jedes Feld des Belegs gleich dem Sim-Zustand zum Kaufzeitpunkt`);
  ok(Info.ARTEN.every((a) => proArt[a] > 0), 'alle vier Themenarten geprüft: ' + JSON.stringify(proArt));
  ok(sichtOk === belege, 'jeder Beleg zeigt seinen Ort auf der Karte');
  // im Spiel: der Kauf liefert dasselbe wie die Sim im Moment des Kaufs (Zustand vorher und nachher gleich)
  let gespielt = 0;
  for (const seed of [21, 22, 23, 24]) {
    const s = mitAngebot(seed); if (!s) continue;
    for (const t of s.angebot.themen) {
      s.g.inventory.marks = 5000;
      const ctx = Info.ctxVon(s.g), w = wahrheit(ctx, t), vor = JSON.stringify(sim(s.g));
      const r = Info.kaufen(s.g, s.p, t.id, 'beleg');
      ok(r.ok && gleich(r.fakten, w.fakten) && r.text === erwarteterText('beleg', w.art, w.fakten, ctx.d) && JSON.stringify(sim(s.g)) === vor, `Seed ${seed} ${t.id} (${t.art}): Kauf = Sim, Sim-Zustand unverändert`);
      gespielt++;
    }
  }
  ok(gespielt >= 4, gespielt + ' Belege im Spiel gekauft');
});

// ================================================================================================================================ Gerücht
section('Gerücht: gekennzeichnet, Falschquote, nur erlaubte Felder', () => {
  const z = Kern.erzeuge({ karte: DATEN.karte, werte: DATEN.werte, seed: 5 }), d = Daten.datenVon(z), ctx = { z, d, tickZahl: 1, ereignisse: [] };
  const vorlagen = [
    { key: 'belagert:1', art: 'belagert', fakten: { ort: '0603', fraktion: 'ger', klasse: 2, zeit: 6 } },
    { key: 'marsch:2', art: 'marsch', fakten: { ort: '0403', fraktion: 'pirat', klasse: 1 } },
    { key: 'sammeln:3', art: 'sammeln', fakten: { ort: '0305', fraktion: 'ger', klasse: 3 } },
    { key: 'gefallen:hafen_gefallen:0803:9', art: 'gefallen', fakten: { ort: '0803', fraktion: 'rom', zeit: 2 } },
  ];
  let falsch = 0, gesamt = 0, ungekennzeichnet = 0, verbotenesFeld = 0, mehrAlsEins = 0, ortKeinNachbar = 0, klasseSprung = 0, gleichGeblieben = 0, artGeaendert = 0, wahrFalsch = 0;
  for (let i = 0; i < 6000; i++) {
    const t = vorlagen[i % vorlagen.length], e = Info.ergebnisAus(ctx, t, 'gerucht', i);
    gesamt++;
    if (!e.text.startsWith(W.kennzeichnung.gerucht + ': ') || e.zuverlaessigkeit !== 'gerucht') ungekennzeichnet++;
    const diff = Object.keys(t.fakten).filter((k) => t.fakten[k] !== e.fakten[k]);
    if (Object.keys(e.fakten).join() !== Object.keys(t.fakten).join()) artGeaendert++;
    if (e.wahr) { if (diff.length) wahrFalsch++; continue; }
    falsch++;
    if (diff.length !== 1) { mehrAlsEins++; continue; }
    if (!W.falsch_felder[t.art].includes(diff[0]) || e.feld !== diff[0]) verbotenesFeld++;
    if (diff[0] === 'ort' && !d.nbr[t.fakten.ort].includes(e.fakten.ort)) ortKeinNachbar++;
    if (diff[0] === 'klasse' && (Math.abs(e.fakten.klasse - t.fakten.klasse) !== 1 || e.fakten.klasse < 1 || e.fakten.klasse > 3)) klasseSprung++;
    if (diff[0] === 'fraktion' && !W.tausch_fraktionen.includes(e.fakten.fraktion)) verbotenesFeld++;
    if (diff[0] === 'zeit' && !(e.fakten.zeit >= 1)) verbotenesFeld++;
    if (e.text === Info.ergebnisAus(ctx, t, 'beleg', i).text.replace(W.kennzeichnung.beleg, W.kennzeichnung.gerucht)) gleichGeblieben++;
  }
  const quote = falsch / gesamt;
  ok(ungekennzeichnet === 0, `alle ${gesamt} Gerüchte gekennzeichnet („${W.kennzeichnung.gerucht}“) mit Stufe 'gerucht'`);
  ok(Math.abs(quote - W.falschquote) < 0.03, `Falschquote ${(quote * 100).toFixed(1)} % nahe dem Datenwert ${(W.falschquote * 100).toFixed(1)} % (${falsch} von ${gesamt})`);
  ok(mehrAlsEins === 0 && verbotenesFeld === 0 && artGeaendert === 0, 'ein falsches Gerücht ändert genau ein Faktum, nur aus den erlaubten Feldern, nie die Art oder die Feldmenge');
  ok(ortKeinNachbar === 0 && klasseSprung === 0, 'Ort nur gegen einen Nachbar-Hex, Stärkeklasse nur um eine Stufe innerhalb 1..3');
  ok(wahrFalsch === 0 && gleichGeblieben === 0, 'ein wahres Gerücht trägt genau die Fakten der Sim, ein falsches unterscheidet sich im Text');
  // jedes erlaubte Feld kommt vor (die Quote wird nicht von einem einzigen Feld getragen)
  const felder = {};
  for (let i = 0; i < 4000; i++) { const e = Info.ergebnisAus(ctx, vorlagen[0], 'gerucht', i); if (e.feld) felder[e.feld] = (felder[e.feld] || 0) + 1; }
  ok(W.falsch_felder.belagert.every((f) => felder[f] > 100), 'alle vier Felder des Belagerungs-Gerüchts werden vertauscht: ' + JSON.stringify(felder));
  // Zufall: eigener Strom, deterministisch je (Seed, Zähler, Thema)
  ok(Array.from({ length: 60 }, (_, i) => i).every((i) => gleich(Info.ergebnisAus(ctx, vorlagen[i % 4], 'gerucht', i), Info.ergebnisAus(ctx, vorlagen[i % 4], 'gerucht', i))), 'gleicher Zähler = gleiches Gerücht (60 Paare)');
  const verschieden = new Set(); for (let i = 0; i < 40; i++) verschieden.add(Info.ergebnisAus(ctx, vorlagen[0], 'gerucht', i).text);
  ok(verschieden.size > 4, 'andere Zähler = andere Gerüchte (' + verschieden.size + ' verschiedene Texte)');
  // im Spiel: game.rng und der Sim-Strom bleiben unberührt, der Zähler wandert mit
  const A = mitAngebot(31), B = neuesSpiel({ seed: 31 }); andocken(B.g, KON_HAFEN); for (let i = 0; i < A.g.weltsim.tickZahl; i++) tickEin(B.g);
  const r = Info.kaufen(A.g, A.p, 't0', 'gerucht');
  ok(r.ok && r.zuverlaessigkeit === 'gerucht' && r.text.startsWith(W.kennzeichnung.gerucht) && A.g.weltsim.wissen.gz === 1, 'Kauf im Spiel: gekennzeichnet, Zähler gz = 1');
  ok(A.g.rng() === B.g.rng() && A.g.rng() === B.g.rng() && sim(A.g).zufall === sim(B.g).zufall, 'game.rng und Sim-Zufall unberührt (gleiche nächste Zahlen wie im Spiel ohne Kauf)');
});

// ================================================================================================================================ Rahmen (Stelle für Paket T)
section('rahmenFuer: Datentext als Rückfall, Pool nur mit vollständigen Platzhaltern', () => {
  const t = { art: 'belagert', key: 'belagert:1' };
  ok(Info.rahmenFuer(t, 'gerucht') === W.themen.belagert.gerucht && Info.rahmenFuer(t, 'beleg') === W.themen.belagert.beleg, 'ohne Pool: der Datentext');
  const z = Kern.erzeuge({ karte: DATEN.karte, werte: DATEN.werte, seed: 5 }), ctx = { z, d: Daten.datenVon(z), tickZahl: 1, ereignisse: [] };
  const thema = { key: 'belagert:1', art: 'belagert', fakten: { ort: '0603', fraktion: 'ger', klasse: 2, zeit: 3 } };
  try {
    Info.setzeRahmenQuelle(() => 'Man munkelt: {ort} liegt unter Belagerung durch {fraktion}, Streitmacht {klasse}, seit {zeit}.');
    ok(Info.rahmenFuer(t, 'gerucht').startsWith('Man munkelt'), 'vollständiger Rahmen aus dem Pool wird genommen');
    const e = Info.ergebnisAus(ctx, thema, 'gerucht', 1);
    ok(e.text.startsWith(W.kennzeichnung.gerucht + ': Man munkelt') && !/\{/.test(e.text), 'der Code setzt die Fakten ein und die Kennzeichnung davor, kein Platzhalter bleibt: ' + e.text);
    Info.setzeRahmenQuelle(() => 'Man munkelt: {ort} wird belagert.');
    ok(Info.rahmenFuer(t, 'gerucht') === W.themen.belagert.gerucht, 'unvollständiger Rahmen (Platzhalter fehlen) wird abgelehnt: Datentext');
    Info.setzeRahmenQuelle(() => 'Man munkelt: {ort} {fraktion} {klasse} {zeit} {geheim}.');
    ok(Info.rahmenFuer(t, 'beleg') === W.themen.belagert.beleg, 'unbekannter Platzhalter wird abgelehnt: Datentext');
    Info.setzeRahmenQuelle(() => 42);
    ok(Info.rahmenFuer(t, 'beleg') === W.themen.belagert.beleg, 'kein Text: Datentext');
    Info.setzeRahmenQuelle(() => { throw new Error('Pool kaputt'); });
    ok(Info.rahmenFuer(t, 'beleg') === W.themen.belagert.beleg, 'ein Pool, der wirft, blockiert nie: Datentext');
    Info.setzeRahmenQuelle(() => 'Ohne Platzhalter, nur Prosa.');
    ok(Info.ergebnisAus(ctx, thema, 'beleg', 0).fakten.ort === '0603' && Info.rahmenFuer(t, 'beleg') === W.themen.belagert.beleg, 'ein Rahmen ohne Platzhalter würde die Fakten verschlucken: abgelehnt');
    let gesehen = null; Info.setzeRahmenQuelle((th, st) => { gesehen = [th, st]; return null; });
    Info.rahmenFuer(t, 'gerucht');
    ok(gesehen && gesehen[0].art === 'belagert' && gesehen[0].key === 'belagert:1' && gesehen[1] === 'gerucht', 'die Quelle bekommt Art, Schlüssel und Stufe');
  } finally { Info.setzeRahmenQuelle(null); }
  ok(Info.rahmenFuer(t, 'gerucht') === W.themen.belagert.gerucht, 'Quelle gelöscht: wieder der Datentext');
});

// ================================================================================================================================ Kauf
section('Kauf: Marken atomar, zu wenig Marken, nur Konkordat-Häfen, nur mit Weltsim', () => {
  const s = mitAngebot(41); const { g, p } = s;
  const marks = () => g.inventory.marks;
  g.inventory.marks = 29;
  const wissenVor = JSON.stringify(g.weltsim.wissen);
  let r = Info.kaufen(g, p, 't0', 'gerucht');
  ok(!r.ok && r.code === 'zu_wenig_marken' && /Marken/.test(r.text) && marks() === 29 && JSON.stringify(g.weltsim.wissen) === wissenVor, 'Gerücht mit 29 Marken: klare Meldung, nichts abgebucht, nichts geändert');
  g.inventory.marks = 119;
  r = Info.kaufen(g, p, 't0', 'beleg');
  ok(!r.ok && r.code === 'zu_wenig_marken' && marks() === 119 && JSON.stringify(g.weltsim.wissen) === wissenVor, 'Beleg mit 119 Marken: abgelehnt, Wissen und Marken unverändert');
  g.inventory.marks = 1000;
  const radioVor = s.c.inbox.length;
  r = Info.kaufen(g, p, 't0', 'gerucht');
  ok(r.ok && marks() === 970, 'Gerücht kostet 30: 1000 -> ' + marks());
  const wKarte = (w) => JSON.stringify({ hexe: w.hexe, flotten: w.flotten });
  ok(JSON.stringify(Object.assign({}, g.weltsim.wissen, { gz: undefined, ver: 0 })) === JSON.stringify(Object.assign({}, JSON.parse(wissenVor), { gz: undefined, ver: 0 })), 'das Gerücht ändert das Wissensmodell nicht (keine Kartenwirkung), nur der Zähler gz');
  const funk = s.c.inbox.slice(radioVor).filter((m) => m.t === 'event' && m.kind === 'radio' && m.text === r.text);
  ok(funk.length === 1 && funk[0].from === W.von, 'die Funkzeile geht an alle (Absender ' + W.von + ')');
  r = Info.kaufen(g, p, 't0', 'gerucht');
  ok(!r.ok && r.code === 'gekauft' && marks() === 970, 'dasselbe Gerücht noch einmal: „Schon gekauft“, keine Marken weg');
  const kartenVor = wKarte(g.weltsim.wissen);
  r = Info.kaufen(g, p, 't0', 'beleg');
  ok(r.ok && marks() === 850 && g.weltsim.wissen.belege.length === 1 && g.weltsim.wissen.belege[0].bis === g.weltsim.tickZahl + W.beleg_dauer, 'Beleg kostet 120, Wissen.belege trägt ihn bis Tick + 40');
  ok(JSON.stringify(Object.keys(r)) && r.zuverlaessigkeit === 'beleg' && r.text.startsWith(W.kennzeichnung.beleg), 'Beleg: Stufe beleg, gekennzeichnet');
  ok(typeof kartenVor === 'string' && g.errors === 0, 'kein Serverfehler');
  // ungültige Eingaben
  ok(Info.kaufen(g, p, 't9', 'gerucht').code === 'unbekannt' && Info.kaufen(g, p, 't0', 'gold').code === 'stufe_unbekannt' && marks() === 850, 'unbekanntes Thema, unbekannte Stufe: abgelehnt, nichts abgebucht');
  // Atomar: scheitert die Wirkung, bleiben Marken UND Wissen unverändert
  const s2 = mitAngebot(42), g2 = s2.g; g2.inventory.marks = 500;
  const w2 = g2.weltsim.wissen, original = Wissen.sondeGesichtet;
  Wissen.sondeGesichtet = () => { throw new Error('Wirkung scheitert'); };
  try {
    const fehler0 = g2.errors;
    const rr = Info.kaufen(g2, s2.p, 't0', 'beleg');
    ok(!rr.ok && rr.code === 'fehler' && g2.inventory.marks === 500 && g2.weltsim.wissen === w2 && !('belege' in g2.weltsim.wissen), 'Beleg-Wirkung wirft: Rollback, 500 Marken, dasselbe Wissen-Objekt, kein Beleg');
    ok(g2.errors >= fehler0, 'der Fehler wird gezählt, nicht verschluckt');
    const rr2 = Info.kaufen(g2, s2.p, 't0', 'beleg');
    ok(!rr2.ok && rr2.code === 'fehler', 'und gilt nicht als gekauft (nächster Versuch wirkt wieder)');
  } finally { Wissen.sondeGesichtet = original; }
  const rr3 = Info.kaufen(g2, s2.p, 't0', 'beleg');
  ok(rr3.ok && g2.inventory.marks === 380, 'nach dem Fehler klappt derselbe Kauf: 500 -> 380');
  // nicht am Konkordat
  const s3 = neuesSpiel({ seed: 43 }); for (let i = 0; i < 6; i++) tickEin(s3.g);
  s3.g.inventory.marks = 500;
  s3.g.ship.docked = false; s3.g.ship.dockedAt = null;
  ok(Info.kaufen(s3.g, s3.p, 't0', 'gerucht').code === 'nicht_angedockt' && s3.g.inventory.marks === 500, 'nicht angedockt: kein Kauf (Code nicht_angedockt)');
  andocken(s3.g, ROM_HAFEN); s3.g.inventory.marks = 500;
  r = Info.kaufen(s3.g, s3.p, 't0', 'gerucht');
  ok(!r.ok && r.code === 'kein_konkordat' && s3.g.inventory.marks === 500 && Info.snapshot(s3.g) === null && Info.schluessel(s3.g) === null, 'am römischen Hafen: kein Kauf, kein Block');
  andocken(s3.g, '0503'); s3.g.inventory.marks = 500;   // Hex ohne Hafen
  ok(Info.kaufen(s3.g, s3.p, 't0', 'gerucht').code === 'kein_konkordat', 'an einem Ort ohne Hafen: kein Kauf');
  { const zz = sim(s3.g), dd = Daten.datenVon(zz); Object.assign(zz.hexe['0603'], { besitzer: 'kon', posten: true }); andocken(s3.g, '0603'); s3.g.inventory.marks = 500;
    ok(dd.hex['0603'].hafen === '' && Info.kaufen(s3.g, s3.p, 't0', 'gerucht').code === 'kein_konkordat' && s3.g.inventory.marks === 500, 'ein Posten des Konkordats ist kein Hafen: kein Kauf'); }
  // ohne Weltsim (Kampagne)
  const k = neuesSpiel({ seed: 44, start: 'sund' }); k.g.inventory.marks = 500;
  ok(!k.g.weltsim && Info.kaufen(k.g, k.p, 't0', 'gerucht').code === 'kein_weltsim' && k.g.inventory.marks === 500 && Info.snapshot(k.g) === null, 'Kampagne ohne Weltsim: kein Kauf, kein Block');
  // jeder darf kaufen (geteilte Marken), der Befehl geht über die Konsole shop
  const s4 = mitAngebot(45); s4.g.inventory.marks = 400;
  s4.g.handleMessage(s4.c, { t: 'cmd', c: 'info.kaufen', thema: 't0', stufe: 'gerucht' });
  const antw = s4.c.inbox.filter((m) => m.t === 'event' && m.kind === 'infoAntwort');
  ok(antw.length === 1 && antw[0].ok && antw[0].stufe === 'gerucht' && antw[0].zuv === 'gerucht' && s4.g.inventory.marks === 370 && !('intern' in antw[0]) && !('wahr' in antw[0]) && !('feld' in antw[0]), 'Befehl info.kaufen: Antwort an den Absender, Marken -30, die Antwort verrät nicht, ob das Gerücht stimmt');
  s4.p.console = 'helm';
  s4.g.handleMessage(s4.c, { t: 'cmd', c: 'info.kaufen', thema: 't1', stufe: 'gerucht' });
  ok(s4.g.inventory.marks === 370, 'ohne Konsole shop: kein Kauf');
  s4.p.console = 'shop'; s4.g.inventory.marks = 5;
  s4.c.inbox.length = 0; s4.g.handleMessage(s4.c, { t: 'cmd', c: 'info.kaufen', thema: 't0', stufe: 'beleg' });
  const nein = s4.c.inbox.filter((m) => m.t === 'event' && m.kind === 'infoAntwort');
  ok(nein.length === 1 && !nein[0].ok && nein[0].code === 'zu_wenig_marken' && s4.g.inventory.marks === 5, 'zu wenig Marken über den Befehl: Antwort mit Code, nichts abgebucht');
});

// ================================================================================================================================ Karte
section('Karte: zusatzSicht liefert die Beleg-Hexe für die Dauer, danach nicht mehr', () => {
  // Germanische Flotte sammelt weit außerhalb der Sicht Roms (Gullfjord 1003) gegen Eisfeld 0703; der Beleg macht sie sichtbar
  const baue = () => {
    const s = szene({ seed: 51 }), z = s.z, fl = flotteVon(z, '1004');
    marsch(z, fl, 901, '1003', '0703', { von: 'ger' });
    s.fl = fl; return s;
  };
  const A = baue(), B = baue();
  const d = Daten.datenVon(A.z);
  const knoten = Wissen.sensorKnoten(A.z, d, KON_HAFEN);
  ok(Wissen.knotenAbstand(d, knoten, '1003') > A.z.werte.sicht.weite, 'Ausgangslage: die Flotte steht außerhalb der Sicht (Abstand ' + Wissen.knotenAbstand(d, knoten, '1003') + ' > ' + A.z.werte.sicht.weite + ')');
  A.schritt(); B.schritt();
  const ohne = B.ws.wissen.flotten.filter((r) => r.f === 'g' && r.h === '1003');
  ok(ohne.length === 0, 'ohne Beleg: Rom sieht die Flotte nicht');
  ok(Wissen.zusatzSicht(A.g, 0).size === 0, 'zusatzSicht ohne Beleg und ohne Sonde: leer');
  const ang = Info.angebotFuer(A.g); const t = ang.themen.find((x) => x.art === 'marsch');
  ok(!!t, 'Angebot enthält den Marsch (Thema)');
  A.g.inventory.marks = 1000;
  const r = Info.kaufen(A.g, A.p, t.id, 'beleg');
  ok(r.ok && r.fakten.ort === '0703' && r.fakten.fraktion === 'ger', 'Beleg gekauft: Ziel ' + r.fakten.ort);
  const zs = Wissen.zusatzSicht(A.g, 0);
  ok(zs instanceof Set && zs.has('0703') && zs.has('1003'), 'zusatzSicht liefert Ziel und den Standort der Flotte: ' + [...zs].join());
  const T0 = A.ws.tickZahl;
  const pl = A.ws.wissen.flotten.filter((q) => q.f === 'g' && q.h === '1003');
  ok(pl.length === 1 && pl[0].a === T0, 'sofort ohne Verzögerung: Plakette in Gullfjord mit Alter 0 (Tick ' + T0 + ')');
  ok(A.ws.wissen.hexe['1003'].a === T0, 'das Hex 1003 trägt den jetzigen Tick (exakt)');
  // Für die Dauer: jeder Tick bleibt exakt (Alter 0); die Flotte wandert, der Beleg folgt ihr
  let imTritt = true;
  for (let i = 1; i <= W.beleg_dauer; i++) {
    A.schritt(); B.schritt();
    const T = A.ws.tickZahl, hs = Wissen.zusatzSicht(A.g, 0);
    const fa = A.z.flotten.filter((f) => f.angriff === 901).map((f) => f.ort);
    for (const h of fa) { const q = A.ws.wissen.flotten.find((x) => x.f === 'g' && x.h === h); if (!hs.has(h) || !q || q.a !== T) imTritt = false; }
    if (!hs.has('0703')) imTritt = false;
  }
  ok(imTritt, `${W.beleg_dauer} Ticks lang: der Beleg liefert Ziel und die Hexe der Flotte, die Plakette trägt in jedem Tick Alter 0`);
  ok(A.ws.wissen.belege && A.ws.wissen.belege.length === 1 && A.ws.tickZahl === T0 + W.beleg_dauer, 'am letzten Tick der Dauer (Kauf + 40) steht der Beleg noch');
  A.schritt(); B.schritt();
  ok(!A.ws.wissen.belege, 'ein Tick danach: der Beleg ist aus dem Wissen geräumt');
  ok(Wissen.zusatzSicht(A.g, 0).size === 0, 'zusatzSicht liefert nichts mehr');
  const nachher = A.ws.wissen.flotten.find((q) => q.f === 'g' && q.a === A.ws.tickZahl);
  const nachherB = B.ws.wissen.flotten.find((q) => q.f === 'g' && q.a === B.ws.tickZahl);
  ok(!nachher && !nachherB, 'außerhalb der Sicht ist die Flotte wieder unbekannt: kein exakter Stand mehr, mit und ohne Beleg');
  // der Beleg gibt nie mehr als das Thema: außerhalb seiner Hexe ist das Wissen wie ohne Kauf (kein ganzer Weltblick)
  { const X = baue(), Y = baue(); X.schritt(); Y.schritt(); X.g.inventory.marks = 500;
    const th = Info.angebotFuer(X.g).themen.find((q) => q.art === 'marsch'); Info.kaufen(X.g, X.p, th.id, 'beleg');
    const zs = Wissen.zusatzSicht(X.g, 0), wx = X.ws.wissen, wy = Y.ws.wissen;
    const hexeAnders = Object.keys(wx.hexe).filter((c) => !gleich(wx.hexe[c], wy.hexe[c]));
    const flAnders = wx.flotten.filter((q) => !wy.flotten.some((o) => gleich(o, q))).map((q) => q.h);
    ok(hexeAnders.every((c) => zs.has(c)) && flAnders.every((h) => zs.has(h)) && zs.size <= 4, 'Beleg: Wissen weicht nur in den Hexen des Belegs ab (' + zs.size + ' Hexe: ' + [...zs].join() + ')'); }
  // Gerücht ändert die Karte nie
  const C = baue(); C.schritt(); const tg = Info.angebotFuer(C.g).themen.find((x) => x.art === 'marsch'); C.g.inventory.marks = 100;
  const vorKarte = JSON.stringify({ h: C.ws.wissen.hexe, f: C.ws.wissen.flotten });
  Info.kaufen(C.g, C.p, tg.id, 'gerucht');
  ok(JSON.stringify({ h: C.ws.wissen.hexe, f: C.ws.wissen.flotten }) === vorKarte && !C.ws.wissen.belege && Wissen.zusatzSicht(C.g, 0).size === 0, 'Gerücht: keine Kartenwirkung, kein Beleg, keine Sicht');
  // gefallener Ort: nur das Hex selbst
  const D = szene({ seed: 52 }); D.schritt();
  D.ws.ereignisse.push({ n: D.ws.tickZahl, typ: 'hafen_gefallen', tick: D.z.tick, fraktion: 'ger', ort: '1003', ortName: 'Gullfjord', alt: 'rom', neu: 'ger' });
  const tf = Info.angebotFuer(D.g).themen.find((x) => x.art === 'gefallen'); D.g.inventory.marks = 500;
  const rf = Info.kaufen(D.g, D.p, tf.id, 'beleg');
  ok(rf.ok && rf.fakten.ort === '1003' && rf.fakten.fraktion === 'ger' && rf.fakten.zeit === 1 && [...Wissen.zusatzSicht(D.g, 0)].join() === '1003', 'gefallener Hafen: Beleg zeigt nur dieses Hex (' + [...Wissen.zusatzSicht(D.g, 0)].join() + ')');
  ok(D.ws.wissen.hexe['1003'].f === 'g' && D.ws.wissen.hexe['1003'].a === D.ws.tickZahl, 'das Wissen hat den Besitzer exakt (Germanen, Alter 0)');
  // belagert: Ort und Flotte
  const E = szene({ seed: 53 }), fe = flotteVon(E.z, '1004');
  marsch(E.z, fe, 902, '1105', '1105', { von: 'ger', t_an: E.z.tick, phase: 'direkt' }); E.schritt();
  const tb = Info.angebotFuer(E.g).themen.find((x) => x.art === 'belagert'); E.g.inventory.marks = 500;
  const rb = Info.kaufen(E.g, E.p, tb.id, 'beleg');
  ok(tb && rb.ok && rb.fakten.ort === '1105' && rb.fakten.zeit >= 1 && Wissen.zusatzSicht(E.g, 0).has('1105'), 'Belagerung: Beleg mit Ort, Fraktion, Stärke und Zeit; das Hex ist sichtbar');
  // Sonden bleiben (test-lage-wissen.js prüft sie genauer): zusatzSicht = Sonden ∪ Belege
  const F = szene({ seed: 54 }); F.ws.sondeHexe = [{ hex: '0904', t: 0 }];
  ok(Wissen.zusatzSicht(F.g, 0).has('0904'), 'Sonden-Sichtungen kommen weiter aus zusatzSicht');
});

// ================================================================================================================================ Sim unberührt
section('Zuschauer: Ansicht Information wird synchronisiert', () => {
  const Werft = require('../server/sim/werft.js'), s = neuesSpiel({ seed: 91 });
  Werft.ansichtSetzen(s.g, s.p, { b: 'i', a: 'p', n: 8, i: 't1' });
  ok(s.g.werftUi && s.g.werftUi.b === 'i' && s.g.werftUi.i === 't1', 'werft.ansicht { b: i, i: t1 } wird übernommen (Zuschauer sehen das gewählte Thema)');
  Werft.ansichtSetzen(s.g, s.p, { b: 'x', i: 'DROP TABLE' });
  ok(s.g.werftUi.b === 'w' && s.g.werftUi.i === null, 'Unbekanntes fällt auf die Werft zurück, ungültige Ids werden verworfen');
});

section('Sim-Zustand byte-gleich mit und ohne Käufe', () => {
  const lauf = (kauf) => {
    const s = neuesSpiel({ seed: 61 }); andocken(s.g, KON_HAFEN); let gekauft = 0;
    for (let t = 0; t < 150; t++) {
      tickEin(s.g);
      if (kauf && t % 3 === 0) { const a = Info.angebotFuer(s.g); s.g.inventory.marks = 5000; for (const th of a.themen) for (const st of Info.STUFEN) { const r = Info.kaufen(s.g, s.p, th.id, st); if (r.ok) gekauft++; } }
    }
    return { s, gekauft };
  };
  const mit = lauf(true), ohne = lauf(false);
  ok(mit.gekauft >= 10, mit.gekauft + ' Käufe (Gerüchte und Belege) im Lauf');
  ok(JSON.stringify(sim(mit.s.g)) === JSON.stringify(sim(ohne.s.g)), 'nach 150 Ticks: Sim-Zustand byte-gleich (Zufall, Flotten, Besitz, Angriffe)');
  ok(gleich(mit.s.g.weltsim.ereignisse, ohne.s.g.weltsim.ereignisse) && mit.s.g.weltsim.tickZahl === ohne.s.g.weltsim.tickZahl, 'Ereignisse der Sim und Tickzähler gleich');
  ok(mit.s.g.rng() === ohne.s.g.rng(), 'game.rng gleich');
  ok(gleich(Kriegslage.abbild(sim(mit.s.g)), Kriegslage.abbild(sim(ohne.s.g))), 'auch das gespeicherte Abbild der Sim ist gleich');
  ok(mit.s.g.errors === 0 && ohne.s.g.errors === 0, 'keine Serverfehler');
});

// ================================================================================================================================ Weltstand
section('Weltstand: Wissen mit Belegen speichern und laden, müllfest, ohne Käufe byte-gleich', () => {
  const s = szene({ seed: 71 }), z = s.z;
  marsch(z, flotteVon(z, '1004'), 903, '1003', '0703', { von: 'ger' }); s.schritt();
  const frei = JSON.stringify(Wissen.toSave(s.ws));
  ok(!/belege|"gz"/.test(frei), 'ohne Käufe trägt das gespeicherte Wissen weder belege noch gz (byte-gleich für main)');
  s.g.inventory.marks = 1000;
  const t = Info.angebotFuer(s.g).themen.find((x) => x.art === 'marsch');
  Info.kaufen(s.g, s.p, t.id, 'gerucht'); Info.kaufen(s.g, s.p, t.id, 'beleg');
  const W1 = kopie(Wissen.toSave(s.ws));
  ok(W1.gz === 1 && W1.belege.length === 1 && W1.belege[0].an === 903 && /^\d{4}$/.test(W1.belege[0].h[0]), 'gespeichert: gz und belege { h, an, bis }');
  const gl = Weltstand_ok(s.g);
  ok(gl, 'Weltstand mit Belegen ist schemagültig');
  // laden: gleiches Wissen, gleiche Sicht
  const s2 = szene({ seed: 71 }); s2.ws.zustand.tick = W1.t; s2.ws.tickZahl = W1.t;
  Wissen.restore(s2.g, kopie(W1));
  ok(gleich(Wissen.toSave(s2.ws), W1), 'nach dem Laden: Wissen tief gleich (inklusive belege und gz)');
  ok(Wissen.zusatzSicht(s2.g, 0).has('0703') && s2.ws.wissen.belege[0].an === 903, 'die Sicht des Belegs gilt nach dem Laden weiter (Ziel in zusatzSicht)');
  // müllfest
  for (const [name, mach] of [
    ['belege kein Feld', (b) => { b.belege = 'x'; }],
    ['belege voller Müll', (b) => { b.belege = [null, 5, { h: 'x' }, { h: [1], an: 1, bis: 9 }, { h: ['0703'], an: 'a', bis: 99999 }, { h: ['0703'], an: null, bis: -5 }, { h: [], an: null, bis: 99999 }]; }],
    ['gz negativ', (b) => { b.gz = -3; }], ['gz Text', (b) => { b.gz = 'viel'; }],
  ]) {
    const x = kopie(W1); mach(x);
    const sx = szene({ seed: 71 }); sx.ws.zustand.tick = x.t; sx.ws.tickZahl = x.t;
    let geworfen = null; try { Wissen.restore(sx.g, x); } catch (e) { geworfen = e; }
    const wx = sx.ws.wissen;
    ok(!geworfen && wx && (!wx.belege || wx.belege.every((b) => b.h.every((h) => /^\d{4}$/.test(h)) && b.bis >= x.t)) && (wx.gz === undefined || wx.gz > 0), 'müllfest: ' + name);
  }
  // abgelaufene Belege fallen beim Laden weg
  const x = kopie(W1); x.belege[0].bis = x.t - 1;
  const sy = szene({ seed: 71 }); sy.ws.zustand.tick = x.t; sy.ws.tickZahl = x.t; Wissen.restore(sy.g, x);
  ok(!sy.ws.wissen.belege, 'abgelaufener Beleg wird beim Laden verworfen');
  // Altstand: Wissen ohne die Felder lädt unverändert
  const alt = kopie(JSON.parse(frei)); const sz = szene({ seed: 71 }); sz.ws.zustand.tick = alt.t; sz.ws.tickZahl = alt.t; Wissen.restore(sz.g, kopie(alt));
  ok(gleich(Wissen.toSave(sz.ws), alt), 'Altstand ohne belege und gz lädt unverändert (tief gleich)');
});
function Weltstand_ok(g) {
  const Weltstand = require('../server/weltstand.js');
  const d = Weltstand.capture(g);
  return Weltstand.validate(kopie(d)).length === 0;
}

// ================================================================================================================================ Terminal
section('Terminal (echte terminal-ui.js, handel-info.js)', () => {
  const pal = new Proxy({}, { get: () => '#000' });
  const win = { Shared_Schiffskatalog: Katalog, Shared_Maps: Maps, Shared_Physics: Physics, Shared_Config: CONFIG, Shared_Protocol: Protocol, Shared_Locations: Locations, performance, Net: { reportError(w, e) { throw e; } } };
  win.window = win;
  win.Render = { PAL: pal, text() {}, drawTooltip() {} }; win.Hud = {}; win.Pult = {};
  win.PultTerminal = { TOKENS: { RASTER: { deckName: ['Mitteldeck', 'Oberdeck', 'Unterdeck'] } }, kappe: (a, e) => e, tw: (s) => String(s).length * 6, zeichneTerminal() {} };
  vm.createContext(win);
  for (const f of ['consoles.js', 'handel-info.js', 'terminal-ui.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'), win, { filename: f });
  const TU = win.TerminalUI, HI = win.HandelInfo;
  ok(TU && HI && typeof HI.modell === 'function', 'TerminalUI und HandelInfo geladen');
  HI.store.werte = kopie(WJ.werte);
  const s = mitAngebot(81, null, 2); const { g, c, p } = s; g.inventory.marks = 500;
  const sicht = () => ({ state: JSON.parse(JSON.stringify(g.snapshot())), me: p, send(m) { g.handleMessage(c, m); }, actions: { sfx() {}, leave() {} } });
  const modell = () => { win.Render.ui = { buttons: [], mouse: { x: 0, y: 0 } }; TU.draw({}, sicht()); return TU.modell(sicht()); };
  const taste = (code) => TU.keyDown({ code, preventDefault() {} }, sicht());
  TU.zuruecksetzen();
  let m = modell();
  ok(m.bereichUmschalter.info === null, 'ohne Block: kein Knopf Information');
  taste('KeyI'); const roh = TU.zustand.bereich; m = modell();
  ok(m.bereich !== 'info' && roh !== 'info' && TU.zustand.bereich !== 'info', 'ohne Block wechselt I nicht in den Bereich (auch nicht im Zustand)');
  HI.store.info = kopie(Info.snapshot(g));
  m = modell();
  ok(m.bereichUmschalter.info && m.bereichUmschalter.info.label === 'Info', 'mit Block (Konkordat-Hafen): Knopf „Info“');
  ok(taste('KeyI') === true && (m = modell()).bereich === 'info' && TU.zustand.bereich === 'info', 'Taste I öffnet den Bereich Information');
  ok(m.info.karten.length === s.angebot.themen.length && m.info.karten.every((k) => k.name && !/\d{4}/.test(k.name)), 'Themen als Karten ohne Fakten: ' + m.info.karten.map((k) => k.name).join(' | '));
  ok(m.info.stufen.length === 2 && m.info.stufen[0].preis === 30 && m.info.stufen[1].preis === 120 && m.info.stufen[0].text && m.info.stufen[1].text, 'zwei Stufen mit Preis 30 und 120 und Hinweis');
  ok(/Gerücht kaufen · 30 M/.test(m.aktionen.haupt.text) && /^Beleg 120$/.test(m.aktionen.ausbau.label), 'Knöpfe: ' + m.aktionen.haupt.text + ' / ' + m.aktionen.ausbau.label);
  const vor = g.inventory.marks;
  taste('Enter'); modell();
  ok(vor - g.inventory.marks === 30, 'Enter kauft das Gerücht: 30 Marken über den Server');
  const antw = c.inbox.filter((q) => q.t === 'event' && q.kind === 'infoAntwort');
  ok(antw.length === 1 && antw[0].ok, 'infoAntwort kommt an');
  TU.onEvent(antw[0]); HI.store.info = kopie(Info.snapshot(g)); m = modell();
  ok(m.info.karten[0].sub === 'Gerücht gekauft' && m.info.letzte.length === 1 && /^Gerücht, unbestätigt/.test(m.info.letzte[0].text) && /Gerücht kaufen/.test(m.aktionen.haupt.text) && m.aktionen.haupt.disabled && /Schon gekauft/.test(m.aktionen.haupt.grund), 'danach: Karte „Gerücht gekauft“, das Ergebnis steht in der Anzeige, derselbe Kauf gesperrt');
  const vor2 = g.inventory.marks; taste('KeyB'); modell();
  TU.onEvent(c.inbox.filter((q) => q.t === 'event' && q.kind === 'infoAntwort').pop());
  ok(vor2 - g.inventory.marks === 120 && g.weltsim.wissen.belege.length === 1, 'B kauft den Beleg: 120 Marken, Wissen.belege');
  HI.store.info = kopie(Info.snapshot(g));
  ok(modell().info.letzte.length === 2 && modell().info.letzte[0].stufe === 'beleg', 'rechts stehen die letzten beiden Ergebnisse, das neueste zuerst');
  g.inventory.marks = 10; HI.store.info = kopie(Info.snapshot(g));
  taste('ArrowDown'); m = modell();
  const gew = m.info.karten.findIndex((k) => k.gewaehlt);
  ok(gew === 1, 'Pfeil runter wählt das nächste Thema');
  ok(m.aktionen.haupt.disabled && /Nicht genug Marken/.test(m.aktionen.haupt.grund) && m.aktionen.ausbau.disabled, 'zu wenig Marken: beide Knöpfe gesperrt mit Grund');
  const vor3 = g.inventory.marks; taste('Enter'); modell();
  ok(g.inventory.marks === vor3, 'Enter ohne Marken kauft nichts');
  // Block weg (abgelegt): zurück in die Werft/den Handel, nie ein toter Bereich
  HI.store.info = null; m = modell();
  ok(m.bereich !== 'info' && m.bereichUmschalter.info === null && TU.zustand.bereich !== 'info', 'ohne Block: der Bereich verschwindet (auch im Zustand), kein Knopf');
  taste('Digit3'); ok(TU.zustand.platz === 3, 'und schluckt keine Tasten mehr (Ziffer 3 wählt Platz 3)');
  // Löschsignal: world.info = null leert, welcome und Lobby leeren auch
  HI.lesen({ t: 'snap', phase: 'play', world: { info: kopie(Info.snapshot(g)) } }); ok(!!HI.modell(), 'Block aus dem Snapshot gelesen');
  HI.lesen({ t: 'snap', phase: 'play', world: {} }); ok(!!HI.modell(), 'Snapshot ohne Feld info lässt den Block stehen');
  HI.lesen({ t: 'snap', phase: 'play', world: { info: null } }); ok(HI.modell() === null, 'world.info = null (Löschsignal) leert den Block');
  HI.lesen({ t: 'snap', phase: 'play', world: { info: kopie(Info.snapshot(g)) } }); HI.lesen({ t: 'welcome' }); ok(HI.modell() === null, 'welcome leert den Block');
  HI.lesen({ t: 'snap', phase: 'play', world: { info: kopie(Info.snapshot(g)) } }); HI.lesen({ t: 'snap', phase: 'lobby' }); ok(HI.modell() === null, 'die Lobby leert den Block');
  ok(!HI.modellAus(null) && !HI.modellAus('x') && HI.modellAus({ th: 'x', l: 5 }).themen.length === 0, 'Leser ist müllfest');
  // Zuschauer
  HI.store.info = kopie(Info.snapshot(g)); TU.zuruecksetzen(); modell(); taste('KeyI');
  ok(modell().bereich === 'info' && TU.zustand.bereich === 'info', 'nach dem Öffnen des Terminals wechselt I in den Bereich und er bleibt gewählt');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
