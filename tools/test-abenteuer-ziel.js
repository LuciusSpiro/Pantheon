'use strict';
// FRE-02 A1: Zielwahl fuer Angebote (server/sim/abenteuer-ziel.js, Daten content/faeden/werte.json abenteuer.wert.angebot_radius_spruenge). Der Ort eines Angebots (angebot.hex, spaeter faden.parameter.ort) ist ein ZIEL in der Umgebung
// des Hafens: mindestens 1 und hoechstens Radius Spruenge im Kartengraph ueber offene Sprungpunkte (nicht Hex-Distanz), nie der Hafen selbst, ein Sektor mit Szene und landbarer Kartenart; der Sperrtext einer Region filtert NICHT.
// Geprueft ueber die echten Wege: den Rueckfall (game.lageGrenze('andocken') mit still gestelltem Komponisten, anschluss.json) und den Komponisten (Beat-Plan, Mock; job.hex, job.herkunftHex, Angebot).
// Die Erwartungen stehen hier selbst: der Graph-Abstand wird im Test eigens gerechnet (Breitensuche ueber die Kanten der Karte), der Radius aus der Datei gelesen.
// Aufruf: node tools/test-abenteuer-ziel.js        (npm run test:abenteuer-ziel)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Ziel = require('../server/sim/abenteuer-ziel.js');
const Orte = require('../server/sim/abenteuer-orte.js');
const Daten = require('../server/sim/faden-daten.js');
const { Faden, F } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const RADIUS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content/faeden/werte.json'), 'utf8')).werte.abenteuer.wert.angebot_radius_spruenge;
const HAEFEN = [['0305', 'Ostia Nova (Start)'], ['0603', 'Kantenstein (Mitte)'], ['0105', 'Carrara (Rand)']];
const frei = () => new Promise((r) => setImmediate(r));

// Spiel mit Lage-Spielleiter (Mock). stumm: der Komponist ruft nie (deckel 0): nur der Rueckfall bietet an. Der Rueckfall ist beim Aufbau aus (wie test-abenteuer-brett) und danach an.
function neu(seed, o) {
  o = o || {};
  const t = F.neuesSpiel({ crew: 1, seed, names: ['Mireille_Kas'], env: Object.assign({ FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' }, o.env || {}, { ABENTEUER_ANSCHLUSS: '0' }) });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: o.stumm === false ? { cooldown_grenzen: 1 } : { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  if (!o.ohneRueckfall) delete t.g.env.ABENTEUER_ANSCHLUSS;
  return t;
}
const zust = (g) => Faden.zustandVon(g);
const angebote = (g) => zust(g).abenteuerAngebote;
const hafenSetzen = (g, hex) => { g.ship.scene = Sektoren.ortVonHex(hex); };
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
// Breitensuche ueber die offenen Kanten der Karte, vom Test selbst gerechnet
function abstaende(g, von) {
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
// alle Ziele eines Hafens ueber zielImUmkreis mit wachsender Belegung (bis null)
function alleZiele(g, hafen) {
  const b = [];
  for (let i = 0; i < 40; i++) { const z = Ziel.zielImUmkreis(g, hafen, { belegt: b }); if (z === null) break; b.push(z); }
  return b;
}
// ein Angebot ueber den echten Rueckfall: Brett leer, Crew im Hafen, Grenze andocken
function rueckfallAngebot(seed, hafen) {
  const t = neu(seed), g = t.g;
  angebote(g).length = 0;
  hafenSetzen(g, hafen);
  g.lageGrenze('andocken');
  return { t, g, a: angebote(g)[0] || null };
}

console.log('\nDaten');
{
  ok(Number.isInteger(RADIUS) && RADIUS >= 1, 'Radius steht in content/faeden/werte.json abenteuer.wert.angebot_radius_spruenge (' + RADIUS + ')');
  ok(Daten.WERTE.abenteuer.angebot_radius_spruenge === RADIUS && Ziel.radius() === RADIUS, 'das Modul liest den Radius aus den Daten');
  ok(Ziel.werteFehler().length === 0, 'werteFehler: leer');
  const alt = Daten.WERTE.abenteuer.angebot_radius_spruenge;
  for (const bad of [-1, 1.5, '3', null, 99]) { Daten.WERTE.abenteuer.angebot_radius_spruenge = bad; if (Ziel.werteFehler().length !== 1) ok(false, 'werteFehler meldet ' + JSON.stringify(bad)); }
  Daten.WERTE.abenteuer.angebot_radius_spruenge = alt;
  ok(Ziel.werteFehler().length === 0, 'werteFehler meldet -1, 1.5, "3", null, 99 (und ist danach wieder leer)');
}

console.log('\nZiele je Hafen: nie der Hafen, Graph-Abstand 1 bis Radius, landbare Kartenart');
const mengen = {};
for (const [hafen, name] of HAEFEN) {
  const t = neu(7, { ohneRueckfall: true }), g = t.g;
  const d = abstaende(g, hafen);
  const z = alleZiele(g, hafen), kand = Ziel.kandidaten(g, hafen);
  mengen[hafen] = z.slice().sort();
  ok(z.length >= 1 && z.length === kand.length, `${name}: ${z.length} Ziele, die Belegungsfolge erschoepft genau die Kandidaten (${kand.length})`);
  ok(z.every((h) => h !== hafen), `${name}: kein Ziel ist der Hafen`);
  ok(z.every((h) => d[h] >= 1 && d[h] <= RADIUS), `${name}: jedes Ziel hat Graph-Abstand 1 bis ${RADIUS}: ${z.map((h) => h + ':' + d[h]).join(' ')}`);
  ok(z.every((h) => Sektoren.spielbar(h) && Sektoren.hatSzene(h) && Orte.moeglicheArten(h).length > 0), `${name}: jedes Ziel ist ein spielbarer Sektor mit Szene und landbarer Kartenart`);
  // alles, was der Graph hergibt, ist ein Ziel (ausser Sektoren ohne Szene oder Landeplatzart): nichts Gueltiges fehlt
  const erwartet = Object.keys(d).filter((h) => d[h] >= 1 && d[h] <= RADIUS && Sektoren.hatSzene(h) && Orte.moeglicheArten(h).length > 0).sort();
  ok(JSON.stringify(erwartet) === JSON.stringify(z.slice().sort()), `${name}: die Zielmenge ist genau die Menge der gueltigen Sektoren im Graphen`);
}
{
  const s = HAEFEN.map(([h]) => mengen[h].join(','));
  ok(new Set(s).size === 3, 'die drei Haefen haben verschiedene Zielmengen');
  ok(mengen['0305'].some((h) => !mengen['0105'].includes(h)) && mengen['0105'].some((h) => !mengen['0305'].includes(h)), 'Ostia Nova und Carrara: jeder hat Ziele, die der andere nicht hat');
}

console.log('\nSperrtext-Sektoren sind erlaubte Ziele');
{
  const g = neu(7, { ohneRueckfall: true }).g;
  const z = Ziel.kandidaten(g, '0105');
  ok(z.length === 7, 'Carrara (0105) hat 7 Ziele im Radius 3: ' + z.length);
  ok(z.every((h) => !!Sektoren.sperrtext(h)), 'alle 7 liegen in Sperrtext-Sektoren (ein Filter nach Sperrtext liesse 0 uebrig)');
  ok(Ziel.zielImUmkreis(g, '0105', { belegt: [] }) !== null, 'Carrara bekommt ein Ziel');
  const o = neu(7, { ohneRueckfall: true }).g;
  ok(Ziel.kandidaten(o, '0305').some((h) => !!Sektoren.sperrtext(h)), 'auch bei Ostia Nova sind Sperrtext-Sektoren Ziele');
}

console.log('\nBelegte Ziele, erschoepfte Ziele, Determinismus');
{
  const g = neu(11, { ohneRueckfall: true }).g;
  const kand = Ziel.kandidaten(g, '0305');
  const z1 = Ziel.zielImUmkreis(g, '0305', { belegt: [] });
  const z2 = Ziel.zielImUmkreis(g, '0305', { belegt: [z1] });
  const z3 = Ziel.zielImUmkreis(g, '0305', { belegt: [z1, z2] });
  ok(z1 && z2 && z3 && new Set([z1, z2, z3]).size === 3, 'mit Belegungsliste: drei Aufrufe, drei verschiedene Ziele (' + [z1, z2, z3] + ')');
  ok(Ziel.zielImUmkreis(g, '0305') === z1, 'ohne Belegungsliste gleich leere Liste');
  ok(Ziel.zielImUmkreis(g, '0305', { belegt: kand }) === null && Ziel.zielFolge(g, '0305', { belegt: kand }).length === 0, 'alle Ziele belegt: null (ehrlich weniger), Folge leer');
  ok(Ziel.zielFolge(g, '0305', { belegt: [] }).length === kand.length && new Set(Ziel.zielFolge(g, '0305', { belegt: [] })).size === kand.length, 'zielFolge ist eine Anordnung aller freien Ziele ohne Doppelte');
  ok(Ziel.zielFolge(g, '0305', { belegt: [kand[0]] }).every((h) => h !== kand[0]), 'ein belegtes Ziel steht nie in der Folge');
  ok(Ziel.zielImUmkreis(g, 'xxxx', {}) === null && Ziel.zielImUmkreis(g, undefined, {}) === null && Ziel.zielImUmkreis(g, '9999', {}) === null, 'ungueltiger Hafen: null, kein Absturz');
  // belegt(game): offene Angebote und der Ort eines laufenden Abenteuers
  const t = neu(12, { ohneRueckfall: true }), g2 = t.g;
  angebote(g2).length = 0;
  const p = { format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats: [{ typ: 'spur' }, { typ: 'abschluss' }] };
  const zz = Ziel.zielImUmkreis(g2, '0305', { belegt: [] });
  const a = Faden.abenteuerAnbieten(g2, p, { hex: zz });
  ok(a.ok && Ziel.belegt(g2).includes(zz), 'belegt(): das Ziel eines offenen Angebots ist belegt (' + zz + ')');
  const zw = Ziel.zielImUmkreis(g2, '0305', { belegt: Ziel.belegt(g2) });
  ok(zw !== zz && zw !== null, 'die Wahl mit belegt(game) nimmt ein anderes Ziel (' + zw + ')');
  // Determinismus: gleicher Seed, gleiche Folge; ueber mehrere Seeds kommen verschiedene Ziele vor
  const folge = (seed) => Ziel.zielFolge(neu(seed, { ohneRueckfall: true }).g, '0305', { belegt: [] }).join(',');
  ok(folge(21) === folge(21) && folge(22) === folge(22), 'gleicher Seed, gleiche Zielfolge (zweimal, zwei Seeds)');
  const ersten = new Set([21, 22, 23, 24, 25, 26, 27, 28].map((s) => folge(s).split(',')[0]));
  ok(ersten.size >= 3, 'ueber acht Seeds kommen mindestens drei verschiedene erste Ziele vor (' + [...ersten] + ')');
}

console.log('\nRueckfall (anschluss.json) ueber game.lageGrenze: Angebot traegt das Ziel');
{
  const gesehen = {};
  for (const [hafen, name] of HAEFEN) {
    const { g, a } = rueckfallAngebot(31, hafen);
    const kand = Ziel.kandidaten(g, hafen);
    ok(!!a && a.art === 'abenteuer', `${name}: der Rueckfall bietet ein Abenteuer an`);
    ok(a && a.hex !== hafen && kand.includes(a.hex), `${name}: angebot.hex = ${a && a.hex} ist ein Ziel im Umkreis, nicht der Hafen`);
    const d = abstaende(g, hafen);
    ok(a && d[a.hex] >= 1 && d[a.hex] <= RADIUS, `${name}: Graph-Abstand ${a && d[a.hex]} (1 bis ${RADIUS})`);
    const e = logbuch(g).filter((x) => x.art === 'abenteuer_anschluss').pop();
    ok(e && e.plan && e.plan.hex === a.hex && e.plan.ziel === true, `${name}: das Logbuch nennt das Ziel (ziel true)`);
    gesehen[hafen] = a && a.hex;
  }
  ok(new Set(Object.values(gesehen)).size === 3, 'drei Haefen, drei verschiedene Angebotsorte: ' + JSON.stringify(gesehen));
  // Annehmen: der Faden bekommt den Ort des Angebots (ein Plan ohne eigene Ortswahl behaelt ihn)
  let spur = null;
  for (let s = 40; s < 70 && !spur; s++) {
    const t = neu(s, { ohneRueckfall: true }), g = t.g;
    angebote(g).length = 0; hafenSetzen(g, '0305');
    const z = Ziel.zielImUmkreis(g, '0305', { belegt: [] });
    const p = { format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats: [{ typ: 'spur' }, { typ: 'abschluss' }] };
    const a = Faden.abenteuerAnbieten(g, p, { hex: z });
    if (!a.ok) continue;
    const c = t.cs[0];
    g.handleMessage(c, { t: 'cmd', c: 'abenteuer.annehmen', id: 'a' + a.angebot.nr });
    const f = g.weltsim.faeden.liste.find((x) => x.plan);
    spur = f && f.parameter.ort === z && z !== '0305' ? z : null;
  }
  ok(!!spur, 'Annehmen: faden.parameter.ort ist das Ziel des Angebots, nicht der Hafen');
}

console.log('\nGarantie bleibt: kein Ziel im Umkreis -> Hafen-Hex wie bisher');
{
  const alt = Daten.WERTE.abenteuer.angebot_radius_spruenge;
  Daten.WERTE.abenteuer.angebot_radius_spruenge = 0;
  try {
    const g0 = neu(31, { ohneRueckfall: true }).g;
    ok(Ziel.zielImUmkreis(g0, '0305', { belegt: [] }) === null && Ziel.kandidaten(g0, '0305').length === 0, 'Radius 0: kein Ziel (null)');
    const { a } = rueckfallAngebot(31, '0305');
    ok(!!a && a.hex === '0305', 'Radius 0: der Rueckfall bietet an, am Hafen-Hex (Garantie): ' + (a && a.hex));
  } finally { Daten.WERTE.abenteuer.angebot_radius_spruenge = alt; }
  // leere Karte: kein Sprungpunkt offen
  const t = neu(31), g = t.g;
  angebote(g).length = 0; hafenSetzen(g, '0305');
  const kante0 = g.explore.kanteOffen;
  g.explore.kanteOffen = () => false;
  ok(Ziel.kandidaten(g, '0305').length === 0 && Ziel.zielImUmkreis(g, '0305', { belegt: [] }) === null, 'Karte ohne offene Sprungpunkte: kein Ziel');
  g.lageGrenze('andocken');
  const a = angebote(g)[0];
  ok(!!a && a.hex === '0305', 'Karte ohne offene Sprungpunkte: der Rueckfall bietet am Hafen an (Garantie): ' + (a && a.hex));
  const e = logbuch(g).filter((x) => x.art === 'abenteuer_anschluss').pop();
  ok(e && e.plan && e.plan.ziel === false, 'das Logbuch nennt den Rueckfall des Rueckfalls (ziel false)');
  g.explore.kanteOffen = kante0;
}

console.log('\nKomponist (Beat-Plan, Mock): job.hex = Ziel, job.herkunftHex = Hafen');
(async () => {
  {
    const t = neu(51, { stumm: false, ohneRueckfall: true }), g = t.g, ab = g.lageSpielleiter.abenteuer;
    angebote(g).length = 0; hafenSetzen(g, '0305');
    const erw = Ziel.zielImUmkreis(g, '0305', { belegt: Ziel.belegt(g) });
    const r = ab.beiGrenze('andocken');
    ok(r && r.gestartet === true && ab.job, 'die Grenze andocken startet einen Aufruf');
    ok(ab.job.hex === erw && ab.job.hex !== '0305', `job.hex ist das Ziel (${ab.job.hex}), nicht der Hafen`);
    ok(ab.job.herkunftHex === '0305', 'job.herkunftHex ist der Hafen (am Job eingefroren)');
    const kand = Ziel.kandidaten(g, '0305');
    ok(kand.includes(ab.job.hex), 'das Ziel liegt im Umkreis des Hafens');
    // Kontext des Modells: Schauplatz im aufruf, Position der Crew unter crew, keine Spielernamen
    const jobHex = ab.job.hex;
    g.ship.scene = Sektoren.ortVonHex('0105');   // die Crew fliegt weiter: der Job bleibt eingefroren
    for (let i = 0; i < 8 && angebote(g).length === 0; i++) { g.step(); await frei(); }
    const a = angebote(g)[0];
    ok(!a || a.hex === jobHex, 'ein gueltiger Plan wird am Ziel des Jobs angeboten, auch wenn die Crew weitergeflogen ist (' + (a ? a.hex : 'Plan vom Mock abgelehnt') + ')');
  }
  {
    // Prompt: aufruf.hex = Schauplatz, crew.hex = Position; landeplatz_arten des Schauplatzes; kein Spielername
    const Prompt = require('../server/sim/abenteuer-prompt.js');
    const g = neu(52, { ohneRueckfall: true }).g;
    hafenSetzen(g, '0305');
    const ziel = Ziel.zielImUmkreis(g, '0305', { belegt: [] });
    const bau = Prompt.baue(g, { nr: 1, grenze: 'andocken', hex: ziel, letzte: [], werte: Prompt.WERTE });
    const tag = (n) => { const m = bau.prompt.match(new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>')); return m ? JSON.parse(m[1]) : null; };
    const aufruf = tag('aufruf'), kontext = tag('kontext');
    ok(aufruf && aufruf.hex === ziel, 'Prompt: aufruf.hex ist der Schauplatz (' + (aufruf && aufruf.hex) + ')');
    ok(kontext && kontext.crew && kontext.crew.hex === '0305' && kontext.crew.hex !== ziel, 'Prompt: crew.hex bleibt die Position der Crew (0305)');
    ok(JSON.stringify(kontext.landeplatz_arten) === JSON.stringify(Orte.moeglicheArten(ziel)), 'Prompt: landeplatz_arten gelten fuer den Schauplatz');
    ok(!/Mireille_Kas/.test(bau.prompt), 'Prompt: kein Spielername');
    ok(/Schauplatz/.test(fs.readFileSync(path.join(__dirname, '..', 'content/spielleiter/prompts/abenteuer.system.md'), 'utf8')), 'Systemprompt erklaert aufruf.hex als Schauplatz');
  }
  {
    // keine Ziele: kein Aufruf, uebersprungen kein_ort
    const t = neu(53, { stumm: false, ohneRueckfall: true }), g = t.g, ab = g.lageSpielleiter.abenteuer;
    angebote(g).length = 0; hafenSetzen(g, '0305');
    const k0 = g.explore.kanteOffen; g.explore.kanteOffen = () => false;
    const r = ab.beiGrenze('andocken');
    g.explore.kanteOffen = k0;
    ok(r && r.gestartet === false && r.grund === 'kein_ort' && ab.job === null && ab.aufrufe === 0 && ab.zaehler.uebersprungen.kein_ort === 1, 'ohne freies Ziel: uebersprungen kein_ort, kein Aufruf, nichts erfunden');
  }
  {
    // Modus Absichten bleibt in A1 unveraendert: job.hex = Ort der Crew; Herkunft gesetzt
    const t = neu(54, { stumm: false, ohneRueckfall: true, env: { ABENTEUER_ABSICHTEN: '1' } }), g = t.g, ab = g.lageSpielleiter.abenteuer;
    angebote(g).length = 0; hafenSetzen(g, '0305');
    const r = ab.beiGrenze('andocken');
    ok(r && r.gestartet === true && ab.job.hex === '0305' && ab.job.herkunftHex === '0305', 'Modus Absichten: job.hex bleibt der Hafen (A2), herkunftHex gesetzt');
  }
  console.log(`\n${n - fails}/${n} gruen`);
  process.exit(fails ? 1 : 0);
})();
