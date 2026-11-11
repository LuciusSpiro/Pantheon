'use strict';
// FRE-02 B2: das Brett beim Andocken fuellen (server/sim/abenteuer-brett.js beiAndocken, Haken in game.js missionEvent('docked')). Je Andocken (nur mit Weltsim und FAEDEN=1): der Einzelhinweis ist stumm, die Grenze
// 'andocken' laeuft genau einmal wie bisher, das Brett wird bis angebote_max gefuellt (Vorrat zuerst: Paket C, nur Absichten; dann der Rueckfall, ein Angebot je Schritt, verschiedene Ziele im Umkreis des Hafens), danach
// genau EIN Sammelfunk "N Auftraege am Brett" (nicht bei 0, nie zusaetzlich ein Einzelhinweis). Geprueft ueber den echten Weg game.missionEvent('docked') mit dem Schiff im Hafen, nicht nur ueber lageGrenze.
// Die Erwartungen stehen hier selbst: Radius und Obergrenzen aus den Daten, Graph-Abstand per Breitensuche, Texte aus abenteuer-brett.json.
// Aufruf: node tools/test-abenteuer-andocken.js        (npm run test:abenteuer-andocken)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Ziel = require('../server/sim/abenteuer-ziel.js');
const Daten = require('../server/sim/faden-daten.js');
const { Faden, F } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const WERTE = lies('content/faeden/werte.json').werte.abenteuer.wert;
const RADIUS = WERTE.angebot_radius_spruenge, MAXA = WERTE.angebote_max;
const BW = lies('content/faeden/abenteuer-brett.json').werte;
const HAEFEN = [['0305', 'Ostia Nova (Start)'], ['0603', 'Kantenstein (Mitte)'], ['0105', 'Carrara (Rand)']];
const EINZEL = BW.hinweis_text.wert.split('{titel}')[0];
const SPRECHER = BW.hinweis_funk_sprecher.wert;
const sammelText = (k) => (k === 1 ? BW.sammel_text_eins.wert : BW.sammel_text.wert.split('{n}').join(String(k)));
const istEinzel = (m) => typeof m.text === 'string' && m.text.startsWith(EINZEL);

// Spiel mit Lage-Spielleiter (Mock), Komponist still (deckel 0, o.deckel: Aufrufe des Komponisten): nur der Rueckfall fuellt. o.env ergaenzt, o.ohneRueckfall: ABENTEUER_ANSCHLUSS=0 bleibt, o.aus: ohne FAEDEN
function neu(seed, o) {
  o = o || {};
  const env = Object.assign(o.aus ? {} : { FAEDEN: '1' }, { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' }, o.env || {}, { ABENTEUER_ANSCHLUSS: '0' });
  const t = F.neuesSpiel({ crew: 1, seed, names: ['Mireille_Kas'], env });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: o.deckel || 0 } });
  t.g.lageSchalter = true;
  if (!o.ohneRueckfall) delete t.g.env.ABENTEUER_ANSCHLUSS;
  return t;
}
const zust = (g) => Faden.zustandVon(g);
const angebote = (g) => zust(g).abenteuerAngebote;
const hafenSetzen = (g, hex) => { g.ship.scene = Sektoren.ortVonHex(hex); };
const funkAlle = (t) => t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio');
const brettFunk = (t) => funkAlle(t).filter((m) => m.from === SPRECHER);
const andocken = (t, hafen) => { if (hafen) hafenSetzen(t.g, hafen); t.g.missionEvent('docked', {}); };
function abstaende(g, von) {   // Breitensuche ueber die offenen Kanten der Karte, vom Test selbst gerechnet
  const d = { [von]: 0 }, q = [von];
  while (q.length) {
    const h = q.shift();
    for (const e of Sektoren.kantenVon(h)) {
      const m = Sektoren.anderes(e, h);
      if (m in d || !Sektoren.spielbar(m) || !g.explore.kanteOffen(Sektoren.kanteId(e.a, e.b))) continue;
      d[m] = d[h] + 1; q.push(m);
    }
  }
  return d;
}
const ablauf = (g, t) => JSON.stringify({ a: angebote(g).map((a) => [a.nr, a.hex, a.ref, a.alter, a.herkunft && a.herkunft.hex]), f: funkAlle(t).map((m) => m.text) });

console.log('\nDaten');
{
  ok(BW.sammel_text.wert === '{n} Aufträge am Brett' && BW.sammel_text_eins.wert === '1 Auftrag am Brett', 'Texte stehen in abenteuer-brett.json (sammel_text mit {n}, sammel_text_eins)');
  ok(Daten.BRETT.werte.sammel_text === BW.sammel_text.wert && Daten.BRETT.werte.sammel_text_eins === BW.sammel_text_eins.wert, 'das Modul liest sie aus den Daten');
  ok(MAXA === 3 && Number.isInteger(RADIUS) && RADIUS >= 1, 'angebote_max ' + MAXA + ' und Radius ' + RADIUS + ' aus content/faeden/werte.json');
  ok(typeof Brett.beiAndocken === 'function' && typeof Brett.anschlussFuellen === 'function' && typeof Brett.ausVorratFuellen === 'function', 'benannte Aufrufe: beiAndocken, anschlussFuellen, ausVorratFuellen');
  ok(Brett.ausVorratFuellen({}).length === 0, 'ausVorratFuellen ohne Spiel tut nichts (Paket C: im Spiel nur mit ABENTEUER_ABSICHTEN, getestet in test-abenteuer-vorrat-verdrahtet)');
}

console.log('\nAndocken fuellt das Brett: drei Haefen, Rueckfall ohne Absichten');
const mengen = {};
for (const [hafen, name] of HAEFEN) {
  const t = neu(7), g = t.g;
  angebote(g).length = 0;
  const funk0 = funkAlle(t).length, errors0 = g.errors;
  andocken(t, hafen);
  const a = angebote(g), d = abstaende(g, hafen), hex = a.map((x) => x.hex);
  mengen[hafen] = hex.slice().sort().join(',');
  console.log('  ' + name + ': ' + hex.join(', '));
  ok(a.length === MAXA, name + ': das Brett ist bis angebote_max gefuellt (' + a.length + ')');
  ok(new Set(hex).size === hex.length, name + ': alle Ziele verschieden');
  ok(hex.every((h) => h !== hafen && d[h] >= 1 && d[h] <= RADIUS), name + ': jedes Ziel ist nicht der Hafen und liegt 1 bis ' + RADIUS + ' Spruenge entfernt (' + hex.map((h) => d[h]).join(',') + ')');
  ok(a.every((x) => x.herkunft && x.herkunft.hex === hafen), name + ': Herkunft ist der Hafen');
  const neuF = brettFunk(t), alle = funkAlle(t).slice(funk0);
  ok(alle.length === 1 && neuF.length === 1, name + ': genau ein Funkspruch beim Andocken (' + alle.length + ')');
  ok(!!neuF[0] && neuF[0].text === sammelText(MAXA) && neuF[0].lage === 1 && neuF[0].fd === 1 && neuF[0].r === 1, name + ': Sammelfunk "' + sammelText(MAXA) + '", Felder wie der Einzelhinweis (' + (neuF[0] && neuF[0].text) + ')');
  ok(!funkAlle(t).some(istEinzel), name + ': kein Einzelhinweis daneben');
  ok(g.errors === errors0, name + ': keine Serverfehler');
}
ok(new Set(Object.values(mengen)).size === 3, 'drei Haefen ergeben drei verschiedene Zielmengen');

console.log('\nGrenze genau einmal, Zaehler wie bisher');
{
  const t = neu(7), g = t.g;
  const z = zust(g); angebote(g).length = 0;
  const grenzen = []; const alt = g.lageGrenze.bind(g);
  g.lageGrenze = (art) => { grenzen.push(art); return alt(art); };
  const t0 = z.t;
  andocken(t, '0305');
  ok(grenzen.length === 1 && grenzen[0] === 'andocken', 'lageGrenze(andocken) genau einmal (' + grenzen.join(',') + ')');
  ok(z.t === t0 + 1, 'der Taetigkeitszaehler steigt um genau 1');
  const sl = g.lageSpielleiter.abenteuer;
  let ruf = 0; const alt2 = sl.beiGrenze.bind(sl); sl.beiGrenze = (art) => { ruf++; return alt2(art); };
  andocken(t, '0305');
  ok(ruf === 1, 'der Komponist sieht beiGrenze(andocken) genau einmal je Andocken (' + ruf + ')');
}

console.log('\nJe Andocken genau ein Funk, nie doppelt; volles Brett fuellt nichts nach');
{
  const t = neu(7), g = t.g;
  angebote(g).length = 0;
  andocken(t, '0305');
  const nrs = angebote(g).map((a) => a.nr).join(',');
  ok(brettFunk(t).length === 1, 'erstes Andocken: ein Funk');
  andocken(t, '0305');
  ok(angebote(g).map((a) => a.nr).join(',') === nrs && brettFunk(t).length === 2, 'zweites Andocken mit vollem Brett: keine neuen Angebote, genau ein weiterer Funk (' + brettFunk(t).length + ')');
  ok(brettFunk(t)[1].text === sammelText(MAXA), 'der Funk nennt die vorhandene Zahl (' + brettFunk(t)[1].text + ')');
  ok(angebote(g).length <= MAXA, 'Obergrenze angebote_max bleibt');
  // Ablehnen kostet nichts und gibt den Platz frei: das naechste Andocken fuellt genau einen nach
  const id = 'a' + angebote(g)[0].nr;
  const r = Brett.ablehnen(g, id);
  ok(r === null && angebote(g).length === MAXA - 1, 'Ablehnen: ' + (MAXA - 1) + ' Angebote, keine Folge');
  const f0 = brettFunk(t).length;
  andocken(t, '0305');
  ok(angebote(g).length === MAXA && brettFunk(t).length === f0 + 1 && brettFunk(t)[f0].text === sammelText(MAXA), 'naechstes Andocken: wieder ' + MAXA + ' Angebote, ein Funk mit der Zahl ' + MAXA);
  ok(new Set(angebote(g).map((a) => a.hex)).size === MAXA, 'die Ziele bleiben verschieden');
  ok(g.errors === 0, 'keine Serverfehler');
}

console.log('\nLaufendes Abenteuer: 1 laufendes, der Rueckfall fuellt nicht, der Funk nennt die vorhandenen');
{
  const t = neu(7), g = t.g;
  angebote(g).length = 0;
  andocken(t, '0305');
  const id1 = 'a' + angebote(g)[0].nr, id2 = 'a' + angebote(g)[1].nr;
  ok(Brett.annehmen(g, id1) === null, 'Annehmen startet den Faden');
  ok(zust(g).liste.filter((f) => f.plan && f.phase !== 'abgeschlossen').length === 1 && angebote(g).length === MAXA - 1, 'ein laufendes Abenteuer, ' + (MAXA - 1) + ' Angebote am Brett');
  const r2 = Brett.annehmen(g, id2);
  ok(!!r2 && r2.code === 'laeuft_schon', 'ein zweites laeuft nicht (laeuft_schon)');
  const f0 = brettFunk(t).length;
  andocken(t, '0305');
  ok(angebote(g).length <= MAXA - 1 && brettFunk(t).length === f0 + 1 && brettFunk(t)[f0].text === sammelText(angebote(g).length), 'Andocken beim laufenden Abenteuer: nichts nachgefuellt (der Rueckfall wartet wie anschluss), Funk mit der Zahl der vorhandenen (' + angebote(g).length + ')');
}

console.log('\nKein Funk bei 0 (Rueckfall aus), Funk bei 1 (Einzahl)');
{
  const t = neu(7, { ohneRueckfall: true }), g = t.g;
  angebote(g).length = 0;
  const f0 = funkAlle(t).length;
  andocken(t, '0305');
  ok(angebote(g).length === 0 && funkAlle(t).length === f0, 'ABENTEUER_ANSCHLUSS=0: kein Angebot, kein Funk');
  andocken(t, '0305');
  ok(funkAlle(t).length === f0, 'zweimal: weiter kein Funk');
  const ziele = Ziel.zielFolge(g, '0305', { belegt: [] });
  const res = Brett.neuAnbieten(g, { format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats: [{ typ: 'geruecht' }, { typ: 'abschluss' }] }, { hex: ziele[0], herkunft: '0305' });
  ok(res.ok, 'ein Angebot von Hand');
  const f1 = brettFunk(t).length, fa1 = funkAlle(t).length;
  andocken(t, '0305');
  const neuF = brettFunk(t).slice(f1);
  ok(angebote(g).length === 1 && neuF.length === 1 && neuF[0].text === BW.sammel_text_eins.wert, 'ein Angebot am Brett: "' + BW.sammel_text_eins.wert + '" (' + (neuF[0] && neuF[0].text) + ')');
  ok(funkAlle(t).length === fa1 + 1, 'auch hier kein Einzelhinweis: dieses Andocken sendet genau einen Funk');
}

console.log('\nOhne Weltsim/FAEDEN: kein Brett-Aufruf, Verlauf unveraendert');
{
  let ruf = 0;
  const orig = Brett.beiAndocken;
  Brett.beiAndocken = function () { ruf++; return orig.apply(this, arguments); };
  try {
    // Zwillinge ohne FAEDEN: Andocken ueber den Haken gegen die blosse Grenze (so war der Weg vorher)
    const a = neu(7, { aus: true }), b = neu(7, { aus: true });
    hafenSetzen(a.g, '0305'); hafenSetzen(b.g, '0305');
    a.g.missionEvent('docked', {});
    b.g.markSaveDue('docked'); b.g.lageGrenze('andocken');
    ok(ruf === 0, 'ohne FAEDEN: Brett.beiAndocken wird nicht gerufen');
    const sicht = (t) => JSON.stringify({ f: funkAlle(t).map((m) => [m.from, m.text]), e: t.cs[0].inbox.filter((m) => m.t === 'event').map((m) => m.kind), err: t.g.errors, tz: t.g.weltsim && t.g.weltsim.faeden ? t.g.weltsim.faeden.t : null });
    ok(sicht(a) === sicht(b), 'Funk- und Ereignisverlauf eines Andockens ohne FAEDEN gleich dem der blossen Grenze');
    ok(funkAlle(a).every((m) => m.from !== SPRECHER), 'ohne FAEDEN kein Sammelfunk');
    const c = neu(7);
    andocken(c, '0305');
    ok(ruf === 1, 'mit FAEDEN: genau ein Aufruf');
  } finally { Brett.beiAndocken = orig; }
}

console.log('\nAbsichten-Modus an und aus, deterministisch');
for (const modus of [null, '1']) {
  const env = modus ? { ABENTEUER_ABSICHTEN: modus } : {};
  for (const [hafen, name] of HAEFEN) {
    const t = neu(7, { env }), g = t.g;
    angebote(g).length = 0;
    andocken(t, hafen);
    const a = angebote(g), d = abstaende(g, hafen), tag = (modus ? 'Absichten an, ' : 'Absichten aus, ') + name;
    ok(a.length === MAXA && a.every((x) => x.herkunft && x.herkunft.hex === hafen && d[x.hex] !== undefined && d[x.hex] <= RADIUS), tag + ': ' + MAXA + ' Angebote, Herkunft Hafen, Ziel hoechstens ' + RADIUS + ' Spruenge');
    ok(new Set(a.map((x) => x.ref + x.hex)).size === a.length, tag + ': keine doppelte Plan/Ort-Kombination');
    ok(brettFunk(t).length === 1 && brettFunk(t)[0].text === sammelText(a.length), tag + ': genau ein Sammelfunk mit der Zahl ' + a.length);
    ok(!funkAlle(t).some(istEinzel) && g.errors === 0, tag + ': kein Einzelhinweis, keine Serverfehler');
    if (modus) ok(a.every((x) => x.absicht && x.absicht.format === 'absicht/1'), tag + ': jedes Angebot behaelt seine Absicht');
    else ok(a.every((x) => !x.absicht), tag + ': der Rueckfall aus anschluss.json traegt keine Absicht');
  }
  const t1 = neu(11, { env }), t2 = neu(11, { env });
  for (const t of [t1, t2]) { angebote(t.g).length = 0; andocken(t, '0603'); andocken(t, '0603'); }
  ok(ablauf(t1.g, t1) === ablauf(t2.g, t2), (modus ? 'Absichten an' : 'Absichten aus') + ': gleicher Seed, gleicher Verlauf (Angebote, Ziele, Funk)');
}

console.log('\nGeruechtzeile: bei ort_offen kein vorlaeufiger Ort');
{
  const t = neu(7, { ohneRueckfall: true }), g = t.g;
  const BEATS = lies('content/faeden/beats.json').beats;
  const offenTyp = Object.keys(BEATS).find((k) => BEATS[k].verlegt_ort === true);
  const festTyp = ['konvoi', 'geleit'].find((k) => BEATS[k] && BEATS[k].verlegt_ort !== true);
  ok(!!offenTyp && !!festTyp, 'beats.json: Beat-Typen mit (' + offenTyp + ') und ohne (' + festTyp + ') verlegt_ort');
  const plan = (typ, i) => ({ format: 'faden-bauplan/1', titel: 'Probe Auftrag ' + i, anlass: 'Ein Probeanlass Nummer ' + i + ' ohne Namen', beats: [{ typ }, { typ: 'abschluss' }] });
  const ziele = Ziel.zielFolge(g, '0305', { belegt: [] });
  const mit = 'Scan bei {ort}: Der Transponder passt nicht zu den Papieren.', ohne = 'Im Hafen heisst es, ein Schiff fliege ohne Papiere.';
  const bau = (typ, i, texte) => {
    const r = Brett.neuAnbieten(g, plan(typ, i), { hex: ziele[i], herkunft: '0305' });
    if (!r.ok) throw new Error('Angebot: ' + r.grund);
    r.angebot.vorlage.hinweise = Object.fromEntries(texte.map((x, k) => ['h' + k, { kanal: 'hafenfunk', text: x }]));
    return r.angebot;
  };
  const geruechte = () => (Brett.snapshot(g) || {}).geruechte || [];
  angebote(g).length = 0;
  bau(offenTyp, 0, [mit]);
  ok(geruechte().length === 0, 'ort_offen, nur ein Hinweis mit {ort}: keine Geruechtzeile (nichts Falsches nennen)');
  angebote(g).length = 0;
  bau(offenTyp, 0, [mit, ohne]);
  ok(geruechte().length === 1 && geruechte()[0].text === ohne, 'ort_offen, Hinweise mit und ohne {ort}: der ohne {ort} (' + (geruechte()[0] && geruechte()[0].text) + ')');
  angebote(g).length = 0;
  bau(festTyp, 1, [mit]);
  ok(geruechte().length === 1 && geruechte()[0].text === 'Scan bei ' + Sektoren.hexName(ziele[1]) + ': Der Transponder passt nicht zu den Papieren.', 'fester Ort: {ort} wird mit dem Ziel eingesetzt wie bisher');
}

console.log('\nSpielstart angedockt bleibt beim Takt');
{
  const t = neu(33), g = t.g;
  for (let i = 0; i < 250; i++) g.step();
  ok(angebote(g).length === 1 && brettFunk(t).length === 1 && istEinzel(brettFunk(t)[0]), 'Spielstart: ein Angebot, ein Einzelhinweis (kein Sammelfunk, der Takt unveraendert)');
}

// ---------- FRE-02 B2 Nacharbeit: der Rueckfall laesst dem Komponisten Platz (async: die Antwort des Mock-Komponisten kommt zwischen den Ticks)
const frei = () => new Promise((r) => setImmediate(r));
async function pumpen(g, k) { for (let i = 0; i < k; i++) { g.step(); await frei(); } }
(async () => {
  const sl = (g) => g.lageSpielleiter.abenteuer;

  console.log('\nKomponist hat eine Anfrage offen: der Rueckfall legt nur die Garantie, die Antwort des Komponisten bleibt');
  {
    const t = neu(7, { deckel: 4 }), g = t.g;
    angebote(g).length = 0;
    const f0 = funkAlle(t).length;
    andocken(t, '0305');
    ok(sl(g).aufrufe === 1 && sl(g).zustand === 'angefragt' && sl(g).anfrageOffen() === true, 'der Komponist hat bei der Grenze angefragt (aufrufe ' + sl(g).aufrufe + ', Zustand ' + sl(g).zustand + ')');
    ok(angebote(g).length === 1, 'Rueckfall: genau EIN Angebot (Anschluss-Garantie), nicht ' + MAXA + ' (' + angebote(g).length + ')');
    const nr0 = angebote(g).map((a) => a.nr);
    const alle0 = funkAlle(t).slice(f0);
    ok(alle0.length === 1 && brettFunk(t).length === 1 && brettFunk(t)[0].text === sammelText(1), 'genau ein Sammelfunk nach dem Rueckfall, mit der Zahl 1 (' + (alle0[0] && alle0[0].text) + ')');
    await pumpen(g, 6);
    const z = sl(g).zaehler;
    ok(z.gueltig === 1 && Object.keys(z.abgelehnt).length === 0 && sl(g).zustand === 'idle', 'die Antwort des Komponisten wird angeboten, nicht verworfen (gueltig ' + z.gueltig + ', abgelehnt ' + JSON.stringify(z.abgelehnt) + ')');
    ok(angebote(g).length >= 2 && angebote(g).length <= MAXA && nr0.every((nr) => angebote(g).some((a) => a.nr === nr)), 'am Brett: die Garantie und das Angebot des Komponisten (' + angebote(g).length + ' von hoechstens ' + MAXA + ')');
    ok(new Set(angebote(g).map((a) => a.hex)).size === angebote(g).length, 'die Ziele sind verschieden');
    ok(funkAlle(t).slice(f0).length === 1 && !funkAlle(t).some(istEinzel), 'weiter genau ein Funk je Andocken: das spaete Angebot meldet sich nicht zusaetzlich (je Zaehler hoechstens einer)');
    ok(g.errors === 0, 'keine Serverfehler');
  }

  console.log('\nKein Komponist aktiv: der Rueckfall fuellt bis angebote_max wie bisher');
  {
    const a = neu(7, { deckel: 0 }), b = neu(7, { deckel: 4 });
    sl(b.g).aufrufe = 4;   // Deckel erschoepft
    for (const [t, was] of [[a, 'deckel 0'], [b, 'Deckel erschoepft']]) {
      angebote(t.g).length = 0;
      andocken(t, '0305');
      ok(sl(t.g).anfrageOffen() === false && angebote(t.g).length === MAXA && new Set(angebote(t.g).map((x) => x.hex)).size === MAXA, was + ': kein Komponist, ' + MAXA + ' Angebote mit verschiedenen Zielen (' + angebote(t.g).length + ')');
      ok(brettFunk(t).length === 1 && brettFunk(t)[0].text === sammelText(MAXA), was + ': ein Sammelfunk mit der Zahl ' + MAXA);
    }
    const c = neu(7, { deckel: 4 });   // Rueckfall-Betrieb: Modus off, der Rueckfall traegt das Brett
    c.g.lageSpielleiter.mode = 'off'; c.g.lageSpielleiter.rueckfallBetrieb = true;
    angebote(c.g).length = 0;
    andocken(c, '0305');
    ok(c.g.lageSpielleiter.abenteuer.aufrufe === 0 && angebote(c.g).length === MAXA, 'Rueckfall-Betrieb (Modus off): kein Aufruf, ' + MAXA + ' Angebote vom Rueckfall (' + angebote(c.g).length + ')');
  }

  console.log('\nVolles Brett beim Andocken: der Komponist startet nicht (Vorrat und zweites Andocken)');
  {
    // Vorrat fuellt das Brett (Paket C), danach startet der Komponist nicht
    const INS = require('../server/sim/inszenierer.js'), AP = require('../server/sim/absicht-pruefer.js'), V = require('../server/sim/abenteuer-vorrat.js');
    const KAT = AP.katalogStandard();
    const TEXT = { titel: 'Zebrafalke Probe Titel', einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', preis: 'Ein Preis ohne Namen fuer den Test.' };
    const ab = (name) => ({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' });
    const t = neu(7, { deckel: 4, ohneRueckfall: true, env: { ABENTEUER_ABSICHTEN: '1' } }), g = t.g;
    angebote(g).length = 0;
    for (const name of ['rettung', 'lieferung', 'falscher_haendler']) { const r = INS.anbietenAusAbsicht(g, ab(name), KAT); if (!r.ok) throw new Error('Angebot: ' + JSON.stringify(r.fehler)); }
    g.weltsim.tickZahl += 3;
    for (let i = 0; i < WERTE.angebot_gilt_taetigkeiten + 1; i++) Faden.taetigkeit(g, 'szene_ende');
    ok(angebote(g).length === 0 && V.liste(g).length === 3, 'Vorrat: drei verfallene Angebote liegen im Vorrat');
    const auf0 = sl(g).aufrufe, bf0 = brettFunk(t).length;
    andocken(t, '0305');
    ok(angebote(g).length === MAXA && sl(g).aufrufe === auf0 && sl(g).zustand === 'idle' && sl(g).anfrageOffen() === false, 'Brett nach dem Vorrat voll: KEIN Komponistenaufruf (aufrufe ' + auf0 + ' -> ' + sl(g).aufrufe + ')');
    ok(angebote(g).every((a) => a.absicht) && brettFunk(t).length === bf0 + 1 && brettFunk(t)[bf0].text === sammelText(MAXA), 'alle drei aus dem Vorrat, ein Sammelfunk mit der Zahl ' + MAXA);
  }
  {
    // Szenario des Pruefers: Brett voll (Rueckfall ohne Komponist), dann zweites Andocken mit freiem Deckel
    const t = neu(7, { deckel: 4 }), g = t.g;
    angebote(g).length = 0;
    sl(g).aufrufe = 4; andocken(t, '0305'); sl(g).aufrufe = 0;
    const nrs = angebote(g).map((a) => a.nr).join(',');
    ok(nrs.split(',').length === MAXA && sl(g).aufrufe === 0, 'Vorbereitung: volles Rueckfall-Brett, Deckel frei (aufrufe 0)');
    andocken(t, '0305');
    ok(sl(g).aufrufe === 0 && sl(g).zustand === 'idle' && sl(g).zaehler.uebersprungen.angebote_voll >= 1, 'zweites Andocken mit vollem Brett: der Komponist startet nicht (aufrufe ' + sl(g).aufrufe + ', angebote_voll ' + sl(g).zaehler.uebersprungen.angebote_voll + ')');
    ok(angebote(g).map((a) => a.nr).join(',') === nrs && brettFunk(t).length === 2, 'das Brett bleibt, ein weiterer Sammelfunk');
    // die Beobachtung "aufrufe 0 -> 1": beim ERSTEN Andocken ist das Brett zur Zeit der Komponisten-Grenze fast leer (die Grenze laeuft vor dem Fuellen, vor ihm nur die Garantie der Taetigkeit); das ist gewollt, kein volles Brett
    const u = neu(7, { deckel: 4 }); angebote(u.g).length = 0;
    let leerBeiGrenze = null; const alt = sl(u.g).beiGrenze.bind(sl(u.g)); sl(u.g).beiGrenze = (art) => { leerBeiGrenze = angebote(u.g).length; return alt(art); };
    andocken(u, '0305');
    ok(leerBeiGrenze === 1 && sl(u.g).aufrufe === 1, 'erstes Andocken: bei der Grenze liegt erst die Garantie der Taetigkeit am Brett (' + leerBeiGrenze + ' von ' + MAXA + '), darum startet der Komponist (aufrufe 1)');
  }

  console.log('\nKomponist nur kurz blockiert (Lage beschaeftigt): der Rueckfall fuellt das Brett nicht auf, Claude behaelt Platz (Befund test-messe-ablage)');
  {
    const t = neu(7, { deckel: 4 }), g = t.g, s = sl(g);
    angebote(g).length = 0;
    const alt = s.taktErlaubt.bind(s);
    s.taktErlaubt = (art) => s.ueberspringen('lage_beschaeftigt', art);   // der Lage-Plan laeuft an derselben Grenze: der Komponist startet nicht
    andocken(t, '0305');
    s.taktErlaubt = alt;
    ok(s.aufrufe === 0 && s.zustand === 'idle' && s.zaehler.uebersprungen.lage_beschaeftigt >= 1, 'der Komponist ist an der Andock-Grenze nur kurz blockiert (aufrufe ' + s.aufrufe + ', lage_beschaeftigt ' + s.zaehler.uebersprungen.lage_beschaeftigt + ')');
    ok(s.platzFuerKomponist() === true, 'er kann trotzdem noch komponieren (Modus an, Deckel und Budget frei)');
    ok(angebote(g).length === 1, 'Rueckfall: nur die Anschluss-Garantie, nicht ' + MAXA + ' (' + angebote(g).length + ')');
    ok(brettFunk(t).length === 1 && brettFunk(t)[0].text === sammelText(1), 'ein Sammelfunk mit der Zahl 1');
    g.lageGrenze('szene_ende');
    ok(s.aufrufe === 1, 'an der naechsten Grenze komponiert Claude (der Komponist laeuft, aufrufe ' + s.aufrufe + ', Brett nicht voll)');
    await pumpen(g, 6);
    ok(s.zustand === 'idle' && !s.zaehler.abgelehnt.ABENTEUER_ANGEBOTE && s.zaehler.gueltig + Object.keys(s.zaehler.abgelehnt).length === 1, 'seine Antwort wurde bearbeitet und NICHT wegen eines vollen Bretts verworfen (gueltig ' + s.zaehler.gueltig + ', abgelehnt ' + JSON.stringify(s.zaehler.abgelehnt) + '; Brett vor dem Aufruf ' + 1 + ' von ' + MAXA + ')');   // ob der Mock-Plan in dieser Lage gueltig ist, ist Sache des Pruefers (hier ABSCHLUSS_FEHLT), nicht der Platzfrage
    ok(g.errors === 0, 'keine Serverfehler');
    // Gegenprobe: ist der Komponist wirklich erledigt (Deckel erschoepft), fuellt der Rueckfall bis angebote_max
    const u = neu(7, { deckel: 4 }); angebote(u.g).length = 0;
    sl(u.g).aufrufe = 4;
    andocken(u, '0305');
    ok(sl(u.g).platzFuerKomponist() === false && angebote(u.g).length === MAXA, 'Deckel erschoepft: kein Platz fuer den Komponisten noetig, der Rueckfall fuellt bis ' + MAXA + ' (' + angebote(u.g).length + ')');
  }

  console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'ALLE ' + n + ' OK'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER (Ausnahme) ' + (e && e.stack || e)); process.exit(1); });
