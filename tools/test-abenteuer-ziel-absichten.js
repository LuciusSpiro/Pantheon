'use strict';
// FRE-02 A2: Ortswahl im Modus Absichten. Die Ortsregel `ziel_im_umkreis` des Inszenierers (server/sim/inszenierer.js, Rezepte in content/faeden/absichten.json) legt den Ort der Geschichte auf ein Ziel im Umkreis des Hafens
// (server/sim/abenteuer-ziel.js, Radius aus content/faeden/werte.json: angebot_radius_spruenge): nie der Hafen, Graph-Abstand 1 bis Radius, nie ein belegtes Ziel; kein freies Ziel ist ein ehrliches Nein (ORT_KEIN_ZIEL) mit Grund.
// Rezepte, deren Skelett einen Beat mit eigener Ortswahl (beats.json verlegt_ort) enthaelt oder bei denen die Crew selbst der Schauplatz ist, bleiben crew_hex. Geprueft ueber den Inszenierer, den Rueckfall im Modus Absichten
// (game.lageGrenze('andocken')), den Komponisten (Mock, Modus Absichten) und den Vorrat. Die Erwartungen stehen hier selbst: der Graph-Abstand wird eigens gerechnet, die Zielrezepte sind von Hand benannt.
// Aufruf: node tools/test-abenteuer-ziel-absichten.js        (npm run test:abenteuer-ziel-absichten)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Ziel = require('../server/sim/abenteuer-ziel.js');
const INS = require('../server/sim/inszenierer.js');
const AP = require('../server/sim/absicht-pruefer.js');
const V = require('../server/sim/abenteuer-vorrat.js');
const Daten = require('../server/sim/faden-daten.js');
const { Faden, F } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const RADIUS = lies('content/faeden/werte.json').werte.abenteuer.wert.angebot_radius_spruenge;
const BEATS = lies('content/faeden/beats.json');
const KAT = AP.katalogStandard();
const HAEFEN = [['0305', 'Ostia Nova (Start)'], ['0603', 'Kantenstein (Mitte)'], ['0105', 'Carrara (Rand)']];
// von Hand benannt (Beschluss FRE-02 A2): diese vier Rezepte spielen an einem Ziel, alle anderen im Sektor der Crew (oder wie bisher an einer Kartenart)
const ZIEL_REZEPTE = ['falscher_haendler', 'lieferung', 'notruf', 'rettung'];
const EIGENER_ORT_OHNE_FLAG = ['spur'];
const TEXT = { titel: 'Zebrafalke Probe Titel', einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', preis: 'Ein Preis ohne Namen fuer den Test.' };
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const frei = () => new Promise((r) => setImmediate(r));

function neu(seed, o) {
  o = o || {};
  const absichten = o.absichten === undefined ? '1' : o.absichten;
  const env = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' };
  if (absichten !== null) env.ABENTEUER_ABSICHTEN = absichten;
  const t = F.neuesSpiel({ crew: 1, seed, names: ['Mireille_Kas'], env });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: o.stumm === false ? { cooldown_grenzen: 1 } : { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  if (o.rueckfall) delete t.g.env.ABENTEUER_ANSCHLUSS;
  return t;
}
const zust = (g) => Faden.zustandVon(g);
const angebote = (g) => zust(g).abenteuerAngebote;
const hafenSetzen = (g, hex) => { g.ship.scene = Sektoren.ortVonHex(hex); };
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const codes = (r) => (r.fehler || []).map((f) => f.code);
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
const probePlan = (typ) => ({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats: [{ typ }, { typ: 'abschluss' }] });
const alleBeatTypen = (rez) => [].concat(rez.skelett.beats.map((b) => b.typ), ...Object.values(rez.wendungen || {}).map((w) => w.beats.map((b) => b.typ)));

console.log('\nKatalog: welche Rezepte ziel_im_umkreis haben');
{
  const regel = (name) => KAT.absichten[name].inszenierung.ort.regel;
  const mitZiel = Object.keys(KAT.absichten).filter((k) => regel(k) === 'ziel_im_umkreis').sort();
  ok(JSON.stringify(mitZiel) === JSON.stringify(ZIEL_REZEPTE), 'genau diese vier Rezepte haben ziel_im_umkreis: ' + mitZiel.join(', '));
  const verlegt = Object.keys(BEATS.beats || BEATS).filter((k) => (BEATS.beats || BEATS)[k] && (BEATS.beats || BEATS)[k].verlegt_ort === true);
  ok(['geruecht', 'sabotage', 'wiedersehen'].every((t) => verlegt.includes(t)), 'beats.json: die Beats mit eigener Ortswahl (verlegt_ort): ' + verlegt.join(', '));
  verlegt.push(...EIGENER_ORT_OHNE_FLAG);   // die Spur fliegt ihre feste Route aus den Daten (kein verlegt_ort-Flag in beats.json, aber der Ort der Geschichte ist nicht ihr Schauplatz)
  for (const k of Object.keys(KAT.absichten)) {
    const typen = alleBeatTypen(KAT.absichten[k].inszenierung);
    const hat = typen.some((t) => verlegt.includes(t));
    if (regel(k) === 'ziel_im_umkreis') ok(!hat, `${k}: ziel_im_umkreis, kein Beat mit eigener Ortswahl in Skelett und Wendungen (${typen.join('>')})`);
    else if (hat) ok(regel(k) === 'crew_hex', `${k}: ein Beat mit eigener Ortswahl im Skelett oder in einer Wendung, der Ort bleibt crew_hex`);
  }
  ok(ZIEL_REZEPTE.every((k) => { const o = KAT.absichten[k].inszenierung.ort; return Object.keys(o).join() === 'regel'; }), 'die Zielrezepte kennen weder kartenart noch reichweite_parameter');
  ok(INS.katalogFehler().length === 0, 'katalogFehler: leer');
  // Katalog-Pruefer: ziel_im_umkreis mit kartenart oder reichweite_parameter ist ein Fehler
  const k2 = JSON.parse(JSON.stringify(KAT));
  k2.absichten.notruf.inszenierung.ort = { regel: 'ziel_im_umkreis', kartenart: 'hoehle' };
  ok(INS.katalogFehler(k2).some((t) => /ziel_im_umkreis kennt weder kartenart/.test(t)), 'katalogFehler: ziel_im_umkreis mit kartenart wird gemeldet');
  const k3 = JSON.parse(JSON.stringify(KAT));
  k3.absichten.notruf.inszenierung.ort = { regel: 'umkreis_irgendwo' };
  ok(INS.katalogFehler(k3).some((t) => /ort\.regel ist eine von/.test(t) && /ziel_im_umkreis/.test(t)), 'katalogFehler: die Regelliste nennt ziel_im_umkreis, eine unbekannte Regel wird gemeldet');
}

console.log('\nInszenierer: Ort im Umkreis, 1 bis Radius Spruenge, drei Haefen');
const orte = {};
for (const [hafen, name] of HAEFEN) {
  const g = neu(7).g;
  hafenSetzen(g, hafen);
  const d = abstaende(g, hafen), kand = Ziel.kandidaten(g, hafen);
  for (const absicht of ZIEL_REZEPTE) {
    const r = INS.inszeniere(g, ab(absicht));
    ok(r.ok === true && r.hex !== hafen && kand.includes(r.hex), `${name}, ${absicht}: Ort ${r.ok ? r.hex : codes(r).join()} liegt im Umkreis, nicht im Hafen`);
    if (r.ok) ok(d[r.hex] >= 1 && d[r.hex] <= RADIUS && r.notizen.some((t) => t.includes(`${d[r.hex]} Spruenge`)), `${name}, ${absicht}: Graph-Abstand ${d[r.hex]} (1 bis ${RADIUS}), die Notiz nennt ihn`);
    if (r.ok && absicht === 'notruf') orte[hafen] = r.hex;
  }
  // die uebrigen Rezepte: crew_hex wie vorher
  const rache = INS.inszeniere(g, ab('konvoi'));
  ok(rache.ok === true && rache.hex === hafen, `${name}, konvoi (Crew ist der Schauplatz): Ort bleibt der Hafen`);
}
ok(new Set(Object.values(orte)).size >= 2 && HAEFEN.every(([h]) => orte[h] !== h), 'die Orte der drei Haefen unterscheiden sich (mindestens zwei verschiedene), keiner ist sein Hafen: ' + JSON.stringify(orte));

console.log('\nOrt des Angebots = Ort des Plans: anbietenAusAbsicht, Annehmen, belegte Ziele');
{
  const t = neu(8), g = t.g;
  angebote(g).length = 0; hafenSetzen(g, '0305');
  const kand = Ziel.kandidaten(g, '0305');
  const a1 = INS.anbietenAusAbsicht(g, ab('notruf'));
  const a2 = INS.anbietenAusAbsicht(g, ab('lieferung'));
  const a3 = INS.anbietenAusAbsicht(g, ab('rettung'));
  ok(a1.ok && a2.ok && a3.ok, 'drei Angebote ueber anbietenAusAbsicht (' + [a1, a2, a3].map((x) => x.ok ? x.angebot.hex : codes(x).join()) + ')');
  const hs = [a1, a2, a3].filter((x) => x.ok).map((x) => x.angebot.hex);
  ok(hs.length === 3 && new Set(hs).size === 3 && hs.every((h) => kand.includes(h) && h !== '0305'), 'drei verschiedene Ziele im Umkreis, nie der Hafen: ' + hs);
  ok(Ziel.belegt(g).length === 3 && hs.every((h) => Ziel.belegt(g).includes(h)), 'belegt(): genau diese drei');
  ok(a1.ok && a1.inszenierung.hex === a1.angebot.hex, 'das Angebot traegt den Ort der Inszenierung');
  const c = t.cs[0];
  g.handleMessage(c, { t: 'cmd', c: 'abenteuer.annehmen', id: 'a' + a1.angebot.nr });
  const f = g.weltsim.faeden.liste.find((x) => x.plan);
  ok(!!f && f.parameter.ort === a1.angebot.hex && f.parameter.ort !== '0305', 'Annehmen: faden.parameter.ort ist das Ziel, nicht der Hafen');
  ok(Ziel.belegt(g).includes(a1.angebot.hex), 'das laufende Abenteuer belegt sein Ziel weiter');
  // ein Rezept mit crew_hex behaelt den Hafen als Ort
  const k = INS.inszeniere(g, ab('geleit'));
  ok(k.ok && k.hex === '0305', 'ein crew_hex-Rezept (Geleit) behaelt den Hafen als Ort');
}

console.log('\nKein freies Ziel: ehrliches Nein mit Grund, kein Absturz');
{
  // (a) alle Ziele von Carrara bei Radius 1 durch echte Angebote belegt
  const alt = Daten.WERTE.abenteuer.angebot_radius_spruenge;
  Daten.WERTE.abenteuer.angebot_radius_spruenge = 1;
  try {
    const g = neu(9).g;
    angebote(g).length = 0; hafenSetzen(g, '0105');
    const kand = Ziel.kandidaten(g, '0105');
    ok(kand.length === 2, 'Carrara bei Radius 1: zwei Ziele (' + kand + ')');
    for (const h of kand) ok(Faden.abenteuerAnbieten(g, probePlan('spur'), { hex: h }).ok, 'Probeangebot bei ' + h);
    const r = INS.inszeniere(g, ab('notruf'));
    ok(!r.ok && codes(r).join() === INS.CODES.ORT_KEIN_ZIEL, 'alle Ziele belegt: ORT_KEIN_ZIEL (' + codes(r) + ')');
    const fe = (r.fehler || [])[0] || {};
    ok(fe.feld === INS.FELD_ZIELE_VERGEBEN && /vergeben/.test(fe.grund) && /Carrara/.test(fe.grund), 'der Grund nennt: alle vergeben, wo die Crew steht (' + String(fe.grund).slice(0, 90) + ')');
    const an = INS.anbietenAusAbsicht(g, ab('notruf'));
    ok(!an.ok && codes(an).join() === INS.CODES.ORT_KEIN_ZIEL, 'anbietenAusAbsicht: dasselbe Nein, kein Angebot erfunden');
    ok(INS.inszeniere(g, ab('konvoi')).ok === true, 'ein crew_hex-Rezept geht trotzdem (es braucht kein Ziel)');
  } finally { Daten.WERTE.abenteuer.angebot_radius_spruenge = alt; }
  // (b) Radius 0: es gibt nie ein Ziel
  Daten.WERTE.abenteuer.angebot_radius_spruenge = 0;
  try {
    const g = neu(9).g;
    hafenSetzen(g, '0305');
    const r = INS.inszeniere(g, ab('notruf'));
    ok(!r.ok && codes(r).join() === INS.CODES.ORT_KEIN_ZIEL && r.fehler[0].feld !== INS.FELD_ZIELE_VERGEBEN, 'Radius 0: ORT_KEIN_ZIEL, nicht "vergeben" (' + codes(r) + ')');
  } finally { Daten.WERTE.abenteuer.angebot_radius_spruenge = alt; }
  // (c) keine offene Kante; (d) Crew in keinem Sektor
  {
    const g = neu(9).g;
    hafenSetzen(g, '0305');
    const k0 = g.explore.kanteOffen; g.explore.kanteOffen = () => false;
    const r = INS.inszeniere(g, ab('rettung'));
    g.explore.kanteOffen = k0;
    ok(!r.ok && codes(r).join() === INS.CODES.ORT_KEIN_ZIEL, 'Karte ohne offene Sprungpunkte: ORT_KEIN_ZIEL');
    g.ship.scene = null;
    const r2 = INS.inszeniere(g, ab('rettung'));
    ok(!r2.ok && codes(r2).join() === INS.CODES.ORT_KEIN_ZIEL, 'Crew in keinem Sektor: ORT_KEIN_ZIEL, kein Absturz');
  }
}

console.log('\nDeterminismus');
{
  const ort = (seed) => { const g = neu(seed).g; hafenSetzen(g, '0305'); return INS.inszeniere(g, ab('notruf')).hex; };
  ok(ort(21) === ort(21) && ort(22) === ort(22), 'gleicher Seed, gleicher Ort (zweimal, zwei Seeds)');
  const alle = new Set([21, 22, 23, 24, 25, 26, 27, 28].map(ort));
  ok(alle.size >= 3, 'ueber acht Seeds mindestens drei verschiedene Orte: ' + [...alle]);
  const g = neu(21).g; hafenSetzen(g, '0305');
  const a = INS.inszeniere(g, ab('notruf')), b = INS.inszeniere(g, ab('notruf'));
  ok(a.hex === b.hex && JSON.stringify(a.plan) === JSON.stringify(b.plan), 'derselbe Aufruf zweimal: dieselbe Inszenierung (reine Funktion von Absicht und Welt)');
}

console.log('\nRueckfall im Modus Absichten (game.lageGrenze andocken)');
{
  // Die Rezepte mit `standard` (nur diese zieht der Rueckfall) sind heute alle crew_hex: ihr Skelett hat einen Beat mit eigener Ortswahl oder die Crew ist der Schauplatz. Der Rueckfall im Modus Absichten bietet darum am Hafen an.
  // Die Verdrahtung (Inszenierer -> Rueckfall -> Brett) prueft der zweite Lauf mit zwei Rezepten, die fuer den Test auf ziel_im_umkreis stehen (der Katalog wird danach zurueckgesetzt).
  const standard = Object.keys(KAT.absichten).filter((k) => KAT.absichten[k].standard);
  const lauf = (zielNamen) => {
    let ziel = 0, crew = 0, ohneLog = 0, fehler = 0;
    const gesehen = new Set();
    for (const [hafen, name] of HAEFEN) {
      for (let seed = 60; seed < 76; seed++) {
        const t = neu(seed, { rueckfall: true }), g = t.g;
        angebote(g).length = 0; hafenSetzen(g, hafen);
        g.lageGrenze('andocken');
        const a = angebote(g)[0];
        const e = logbuch(g).filter((x) => x.art === 'abenteuer_anschluss' && x.ausgang === 'angeboten').pop();
        if (!a || !e || e.modus !== 'rueckfall') { ohneLog++; continue; }
        const kand = Ziel.kandidaten(g, hafen);
        if (zielNamen.includes(e.absicht)) { ziel++; gesehen.add(e.absicht); if (!(a.hex !== hafen && kand.includes(a.hex))) { fehler++; console.log(`  FEHLER ${name} seed ${seed}: ${e.absicht} liegt nicht im Umkreis (${a.hex})`); } }
        else { crew++; if (a.hex !== hafen) { fehler++; console.log(`  FEHLER ${name} seed ${seed}: ${e.absicht} (crew_hex) liegt nicht im Hafen (${a.hex})`); } }
        if (g.errors) fehler++;
      }
    }
    return { ziel, crew, ohneLog, fehler, gesehen };
  };
  ok(standard.length === 7 && standard.every((k) => !ZIEL_REZEPTE.includes(k)), 'die sieben Rezepte mit standard haben alle crew_hex (SON-01 C: dazu forschungsstation): ' + standard.join(', '));
  const r0 = lauf(ZIEL_REZEPTE);
  ok(r0.ohneLog === 0 && r0.fehler === 0 && r0.ziel === 0 && r0.crew === 48, 'Katalog heute: 48 Rueckfaelle, jeder am Hafen (crew_hex), jeder mit modus rueckfall im Logbuch');
  const orig = {};
  const umgestellt = ['konvoi', 'geleit'];
  for (const k of umgestellt) { orig[k] = KAT.absichten[k].inszenierung.ort; KAT.absichten[k].inszenierung.ort = { regel: 'ziel_im_umkreis' }; }
  try {
    const r1 = lauf(ZIEL_REZEPTE.concat(umgestellt));
    ok(r1.ohneLog === 0 && r1.fehler === 0, 'Katalog mit konvoi und geleit auf ziel_im_umkreis: jeder Rueckfall bot an, jeder am richtigen Ort, keine Serverfehler');
    ok(r1.ziel >= 8 && r1.crew >= 8 && r1.gesehen.size === 2, `Rueckfaelle ueber 48 Laeufe: ${r1.ziel} am Ziel im Umkreis (nie im Hafen), ${r1.crew} am Hafen; beide umgestellten Rezepte kamen vor`);
    // belegte Ziele: mehrere Angebote desselben Hafens nehmen nie dasselbe Ziel
    const t = neu(61, { rueckfall: true }), g = t.g;
    angebote(g).length = 0; hafenSetzen(g, '0305');
    for (let i = 0; i < 3; i++) g.lageGrenze('andocken');
    const hs = angebote(g).map((a) => a.hex), zielHs = hs.filter((h) => h !== '0305');
    ok(hs.length >= 1 && new Set(zielHs).size === zielHs.length, 'mehrere Angebote desselben Hafens: kein Ziel doppelt (' + hs + ')');
    // kein freies Ziel: der Rueckfall faellt auf die Garantie zurueck (anschluss.json am Hafen), kein Absturz
    const t2 = neu(62, { rueckfall: true }), g2 = t2.g;
    angebote(g2).length = 0; hafenSetzen(g2, '0305');
    const k0 = g2.explore.kanteOffen; g2.explore.kanteOffen = () => false;
    g2.lageGrenze('andocken');
    g2.explore.kanteOffen = k0;
    const a2 = angebote(g2)[0];
    ok(!!a2 && a2.hex === '0305' && g2.errors === 0, 'Karte ohne offene Sprungpunkte: der Rueckfall bietet trotzdem an (Garantie), am Hafen (' + (a2 && a2.hex) + ')');
  } finally { for (const k of umgestellt) KAT.absichten[k].inszenierung.ort = orig[k]; }
  ok(KAT.absichten.konvoi.inszenierung.ort.regel === 'crew_hex' && KAT.absichten.geleit.inszenierung.ort.regel === 'crew_hex', 'der Katalog ist wieder zurueckgesetzt');
}

console.log('\nKomponist im Modus Absichten (Mock): job.hex bleibt der Hafen, das Ziel waehlt der Inszenierer');
(async () => {
  {
    const t = neu(54, { stumm: false }), g = t.g, abt = g.lageSpielleiter.abenteuer;
    angebote(g).length = 0; hafenSetzen(g, '0305');
    const r = abt.beiGrenze('andocken');
    ok(r && r.gestartet === true && abt.job.hex === '0305' && abt.job.herkunftHex === '0305', 'job.hex = Hafen (Position der Crew), herkunftHex = Hafen');
    const Prompt = require('../server/sim/abenteuer-prompt.js');
    const bau = Prompt.baueAbsicht(g, { nr: 1, grenze: 'andocken', hex: abt.job.hex, letzteAbsichten: [], werte: Prompt.WERTE, katalog: KAT });
    ok(!bau.fehler && !/Mireille_Kas/.test(bau.prompt), 'der Prompt der Absichten: kein Spielername');
    // Antwort des Mocks: das Modell nennt keinen Ort, das Angebot kommt vom Inszenierer
    for (let i = 0; i < 10 && angebote(g).length === 0; i++) { g.step(); await frei(); }
    const a = angebote(g)[0];
    const e = logbuch(g).filter((x) => x.art === 'abenteuer_komposition' || x.ausgang === 'gueltig').pop();
    ok(!!a, 'der Mock bietet im Modus Absichten ein Abenteuer an');
    if (a && e && e.plan) {
      ok(e.plan.hex === a.hex, 'Logbuch: plan.hex ist der Ort des Angebots (' + e.plan.hex + ')');
      ok(a.hex === '0305' ? e.plan.herkunft === undefined : e.plan.herkunft === '0305', 'Logbuch: herkunft nur, wenn das Ziel nicht der Hafen ist');
    }
  }
  {
    // Der Mock waehlt im Modus Absichten je Lage ein Rezept mit crew_hex (hier hinterhalt und andere): sein Angebot liegt am Hafen. Fuer die Verdrahtung (Inszenierer -> Komponist -> Brett -> Logbuch) stehen im Test
    // voruebergehend alle crew_hex-Rezepte auf ziel_im_umkreis (der Katalog wird danach zurueckgesetzt).
    // Die Wahl des Mocks haengt vom Katalog ab (Rng aus Lage, Hafen, Tick und Katalog; BEA-01: der Katalog ist groesser, im Hafen 0305 faellt die Wahl jetzt auf lieferung):
    // Haefen und Ticks durchprobieren, bis er ein crew_hex-Rezept waehlt.
    let wahl = null, g0 = null, hafen0 = null;
    for (let versuch = 0; versuch < 24 && !wahl; versuch++) {
      const h = HAEFEN[versuch % HAEFEN.length][0];
      const t0 = neu(80, { stumm: false }); g0 = t0.g;
      const ab0 = g0.lageSpielleiter.abenteuer;
      for (let i = 0; i < versuch; i++) { g0.step(); await frei(); }
      angebote(g0).length = 0; hafenSetzen(g0, h);
      ab0.beiGrenze('andocken');
      for (let i = 0; i < 10 && angebote(g0).length === 0; i++) { g0.step(); await frei(); }
      const e0 = logbuch(g0).filter((x) => x.ausgang === 'gueltig' && x.absicht).pop();
      if (e0 && KAT.absichten[e0.absicht].inszenierung.ort.regel === 'crew_hex' && angebote(g0).length) { wahl = e0.absicht; hafen0 = h; }
    }
    ok(!!wahl && angebote(g0)[0].hex === hafen0, 'Ausgangslage: der Mock waehlt ein crew_hex-Rezept, das Angebot liegt am Hafen (' + wahl + ')');
    const orig = {};
    for (const [k, e] of Object.entries(KAT.absichten)) if (e.inszenierung.ort.regel === 'crew_hex') { orig[k] = e.inszenierung.ort; e.inszenierung.ort = { regel: 'ziel_im_umkreis' }; }
    try {
      let mitZiel = 0;
      for (const [hafen, name] of HAEFEN) {
        const t = neu(81, { stumm: false }), g = t.g, abt = g.lageSpielleiter.abenteuer;
        angebote(g).length = 0; hafenSetzen(g, hafen);
        abt.beiGrenze('andocken');
        const jobHex = abt.job && abt.job.hex;
        for (let i = 0; i < 10 && angebote(g).length === 0; i++) { g.step(); await frei(); }
        const a = angebote(g)[0];
        const e = a && logbuch(g).filter((x) => x.ausgang === 'gueltig' && x.plan && x.plan.angebot === a.nr).pop();
        ok(jobHex === hafen && !!a && a.hex !== hafen && Ziel.kandidaten(g, hafen).includes(a.hex), `${name}: job.hex = Hafen, das Angebot liegt am Ziel ${a && a.hex} (der Inszenierer waehlt, das Modell nennt keinen Ort)`);
        ok(!!e && e.plan.hex === a.hex && e.plan.herkunft === hafen, `${name}: das Logbuch nennt hex (Ziel) und herkunft (Hafen)`);
        ok(g.errors === 0, `${name}: keine Serverfehler`);
        if (a && a.hex !== hafen) mitZiel++;
      }
      ok(mitZiel === 3, 'in allen drei Haefen am Ziel');
    } finally { for (const k of Object.keys(orig)) KAT.absichten[k].inszenierung.ort = orig[k]; }
    ok(KAT.absichten[wahl].inszenierung.ort.regel === 'crew_hex', 'der Katalog ist wieder zurueckgesetzt');
  }
  {
    // Modus AUS: unveraendert (job.hex ist das Ziel, wie A1)
    const t = neu(54, { stumm: false, absichten: null }), g = t.g, abt = g.lageSpielleiter.abenteuer;
    angebote(g).length = 0; hafenSetzen(g, '0305');
    abt.beiGrenze('andocken');
    ok(abt.job.hex !== '0305' && abt.job.herkunftHex === '0305', 'Modus aus: job.hex bleibt das Ziel des Beat-Plans (A1), herkunftHex der Hafen');
  }

  console.log('\nVorrat: Eintrag aus dem Vorrat, gueltig mit der neuen Regel, kein Verwerfen wegen belegter Ziele');
  {
    const t = neu(12), g = t.g;
    angebote(g).length = 0; hafenSetzen(g, '0305');
    const kand = Ziel.kandidaten(g, '0305');
    const er = V.eintrag(g, { absicht: ab('notruf'), art: 'notruf_vorrat' });
    ok(er.ok && kand.includes(er.eintrag.hex) && er.eintrag.hex !== '0305', 'eintrag: hex ist ein Ziel im Umkreis (' + (er.ok ? er.eintrag.hex : JSON.stringify(er)) + ')');
    ok(V.hinzufuegen(g, er.eintrag).ok === true && V.liste(g).length === 1, 'hinzufuegen: der Eintrag liegt im Vorrat');
    const gu = V.gueltig(g, V.liste(g)[0]);
    ok(gu.ok === true && kand.includes(gu.hex) && gu.hex !== '0305', 'gueltig: ok, der Ort JETZT ist ein Ziel (' + gu.hex + ')');
    // der Eintrag speichert Absicht, nicht Ort: die Welt aendert sich, das Ziel kann sich aendern
    hafenSetzen(g, '0105');
    const gu2 = V.gueltig(g, V.liste(g)[0]);
    ok(gu2.ok === true && Ziel.kandidaten(g, '0105').includes(gu2.hex), 'die Crew ist weitergeflogen: gueltig waehlt das Ziel im Umkreis des neuen Hafens (' + gu2.hex + ')');
    hafenSetzen(g, '0305');
    // alle Ziele belegt: Nein mit Grund, aber der Eintrag bleibt
    const z0 = Ziel.belegt, k0 = kand.slice();
    Ziel.belegt = () => k0;
    try {
      const gb = V.gueltig(g, V.liste(g)[0]);
      ok(gb.ok === false && gb.grund === INS.CODES.ORT_KEIN_ZIEL && gb.wartet === true, 'alle Ziele belegt: gueltig meldet ORT_KEIN_ZIEL mit wartet (' + gb.grund + ')');
      ok(V.verwirfUngueltige(g).length === 0 && V.liste(g).length === 1, 'verwirfUngueltige: der Eintrag bleibt im Vorrat');
      const av = V.ausVorrat(g, 'notruf_vorrat');
      ok(av.ok === false && av.grund === INS.CODES.ORT_KEIN_ZIEL && V.liste(g).length === 1 && angebote(g).length === 0, 'ausVorrat: ehrliches Nein ORT_KEIN_ZIEL, nichts angeboten, Eintrag bleibt (' + av.grund + ')');
      const an = V.anbieten(g, V.liste(g)[0]);
      ok(an.ok === false && an.grund === INS.CODES.ORT_KEIN_ZIEL && V.liste(g).length === 1, 'anbieten: dasselbe Nein, der Eintrag bleibt');
      const ne = V.eintrag(g, { absicht: ab('rettung'), art: 'rettung_vorrat' });
      ok(ne.ok === false && ne.grund === INS.CODES.ORT_KEIN_ZIEL, 'eintrag ohne freies Ziel: ehrliches Nein ORT_KEIN_ZIEL, nichts gebaut (' + ne.grund + ')');
    } finally { Ziel.belegt = z0; }
    // wieder frei: der Eintrag ist entnehmbar und das Angebot liegt am Ziel
    const av2 = V.ausVorrat(g, 'notruf_vorrat');
    ok(av2.ok === true && av2.angebot.hex !== '0305' && kand.includes(av2.angebot.hex) && V.liste(g).length === 0, 'ausVorrat: der Eintrag wird entnommen, das Angebot liegt am Ziel (' + (av2.ok ? av2.angebot.hex : av2.grund) + ')');
    // ein Eintrag fuer ein crew_hex-Rezept wird von belegten Zielen nie beruehrt
    const kr = V.eintrag(g, { absicht: ab('konvoi'), art: 'konvoi_vorrat' });
    Ziel.belegt = () => k0;
    try { ok(kr.ok && V.gueltig(g, kr.eintrag).ok === true, 'crew_hex-Eintrag: gueltig trotz belegter Ziele'); } finally { Ziel.belegt = z0; }
  }

  console.log(`\n${n - fails}/${n} gruen`);
  process.exit(fails ? 1 : 0);
})();
