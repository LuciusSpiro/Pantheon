'use strict';
// FAD-01 C: der Falsche Händler (content/faeden/vorlagen/falscher_haendler.json) löst die Invasion NUR aus, wenn die Crew die Ware im Zielhafen ABLIEFERT (Beat fracht gelungen). Verweigern, Ware verloren
// (Notsprung, Frist, den Piraten gegeben = Fracht-Beat gescheitert) -> der Faden springt in den Abschluss gescheitert, ohne Enthüllung, ohne Sim-Befehl. Vor der Enthüllung kommt der Hinweis h_schmuggel.
// Alle Pfade laufen im echten Ablauf (Bitte beantworten, Ware laden, Andocken, Notsprung, Frist) mit Weltsim und FAEDEN=1; Erwartungen stehen hier selbst, nie aus dem Produktivcode.
//   Daten (Beat-Pfade, Stati, Folge, Hinweis, Text) · (1) Abliefern: Invasion mit Funk vor der Wirkung, Stärke +30 %, Angriff; Art sprengung und beides · (2) Piraten (verloren) · (3) Verweigern, Notsprung, Frist
//   · (4) Hinweis vor der Enthüllung · (5) zweiter Händlerfaden: dieselbe Flotte wird nicht ein zweites Mal hochgestuft
//   node tools/test-faden-haendler-invasion.js [begriff …]
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const V = require('./test-faden-vorlagen.js');   // Hilfen: neu (Spiel mit Mock-Spielleiter), liste, pumpen, runde, notrufOhneOrt
const X = require('./faden-fixture.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Fracht = require('../server/sim/faden-fracht.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const P3 = require('../server/sim/faden-p3.js');
const Faden = require('../server/sim/faden.js');
const Geld = require('../server/sim/geld.js');   // BEA-01 C1: Marken fuer das Bestechen
const Dat = require('../server/weltsim/daten.js');
const { D } = X;
const { neu, liste, runde, notrufOhneOrt } = V;

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
async function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const FH = lies('content/faeden/vorlagen/falscher_haendler.json');
const TX = lies('content/faeden/p3-texte.json');
const WERTE = lies('content/faeden/werte.json').werte;
const LB = lies('content/flotte/lage-befehle.json');
const BEAT_FRIST = WERTE.beat_frist.wert;
const klon = (x) => JSON.parse(JSON.stringify(x));
const beat = (v, id) => v.beats.find((x) => x.id === id);
const ORT = '0203';   // Ort des Notrufs, wie test-faden-nach3.js (Zielhafen Campania)
const ZIEL_BEAT = 9;  // Index von b_abschluss (BEA-01 C1: zehn Beats, vorher 5)
const ENTH_BEAT = 6;  // Index von b_enthuell (vorher 2)
const FEIND = ['sabotage', 'invasion'];   // die Sim-Befehle, die aus einer Enthüllung entstehen

const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const nameVon = (x) => Sektoren.hexName(x) || x;
const hexe = (g) => g.weltsim.zustand.hexe;
const vorg = (g) => g.weltsim.regie.vorgemerkt;
const feindBefehle = (g) => vorg(g).filter((e) => FEIND.includes(e.b.typ));
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const germ = (g) => g.weltsim.zustand.flotten.filter((fl) => fl.fraktion === 'ger');
// Feldzüge, die ein Befehl der Regie ausgelöst hat (Feld befohlen); die Standard-KI der Welt greift von sich aus an und zählt hier nicht
const befohleneAngriffe = (g) => g.weltsim.zustand.angriffe.filter((a) => a.befohlen === true);
const hochgestuft = (g) => g.weltsim.zustand.flotten.filter((fl) => fl.hochgestuft === true);

// Ruhige Ausgangslage (wie test-faden-sim-befehl.js): alle Flotten voll im Heimathafen, keine Feldzüge, die Standard-KI plant nichts
function stille(g) {
  const zz = g.weltsim.zustand;
  zz.angriffe = [];
  for (const fl of zz.flotten) { fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null; fl.angriff = null; fl.warte = 0; fl.staerke = fl.kap; fl.versorgung = 1; }
  for (const h of Object.values(zz.hexe)) h.anspruch = {};
  for (const f of ['rom', 'ger']) { zz.vorrat[f].T = 40; zz.vorrat[f].U = 40; zz.marken[f] = 500; }
  zz.vorrat.kon.T = 31; zz.vorrat.kon.U = 10;
  zz.regie = { rom: { p_act: 0, regler_bis: 1e9 }, ger: { p_act: 0, regler_bis: 1e9 } };
  if (g.weltsim.regie) g.weltsim.regie.rate = [];   // BEA-01 C1: auch die Befehlsrate der Regie (max 8 je 100 Ticks) frei, sonst nimmt der Mock-Spielleiter bei den laengeren Wegen den Faden nicht mehr
}
// ein römischer Posten (ohne Hafen) im Hex-Abstand 1 bis 3 vom Ort: Ziel der Sprengung
function postenNah(g) {
  const d = Dat.datenVon(g.weltsim.zustand);
  const nah = (k) => d.hex[k].hafen === '' && (Sektoren.hexAbstand(ORT, k) || 99) <= 3 && Sektoren.hexAbstand(ORT, k) >= 1;
  const c = Object.keys(hexe(g)).sort().find((k) => nah(k) && !hexe(g)[k].posten) || Object.keys(hexe(g)).sort().find(nah);   // BEA-01 C1: nach den laengeren Wegen kann der Welt der freie Hex fehlen: dann ein Hex mit Posten (wird roemisch gesetzt)
  hexe(g)[c].besitzer = 'rom'; hexe(g)[c].posten = true; delete hexe(g)[c].crew;
  return c;
}

// Eine Partie mit Mitschnitt: Funk (radio) und Takte der Kriegslage in EINER Reihenfolge (g.emit umhüllt, nichts geht verloren)
function partie(seed) {
  const g = neu(seed);
  const ereig = [];   // { k: 'radio', x } | { k: 'tick', hoch, angriff }
  const orig = g.emit.bind(g);
  g.emit = (...a) => { if (a[0] === 'radio' && a[1]) ereig.push({ k: 'radio', x: a[1] }); return orig(...a); };
  const tick = () => { Kriegslage.tick(g, 'test'); ereig.push({ k: 'tick', hoch: hochgestuft(g).map((fl) => fl.id), angriff: befohleneAngriffe(g).filter((a) => a.von === 'ger').map((a) => a.ziel) }); };
  return { g, ereig, tick, funk: () => ereig.filter((e) => e.k === 'radio').map((e) => e.x) };
}
const nscFunk = (p, f, re) => p.funk().filter((x) => x.from === f.nsc.name && re.test(String(x.text)));

// Bitte erscheint, wird beantwortet: antwort 'annehmen' | 'ablehnen' | null (unbeantwortet verfällt sie)
async function bisBitte(p, hex) {
  const f = Faden.befehlAnwenden(p.g, { typ: 'faden_oeffnen', vorlage: 'falscher_haendler', parameter: { angebot: notrufOhneOrt(p.g, 'notruf_havarie_konvoi', hex || ORT, 'gelungen').nr } }).faden;
  for (let i = 0; i < 8 && !Bitte.offen(p.g); i++) await runde(p.g);
  return f;
}
async function annehmenBisWare(p, f) {
  Bitte.beantworten(p.g, 'annehmen', Bitte.offen(p.g).nr);
  for (let i = 0; i < 12 && !f.fracht; i++) await runde(p.g);
}
// BEA-01 C1: die Crew antwortet auf die Forderung des Fadens (die Leiste zeigt zuerst die Forderung, dann das Schmiergeld)
async function waehle(p, f, optionId) {
  for (let i = 0; i < 12 && !(Bitte.offen(p.g) && Bitte.offen(p.g).fadenId === f.id && Bitte.offen(p.g).optionen.some((o) => o.id === optionId)); i++) await runde(p.g);
  const a = Bitte.offen(p.g);
  if (!a || Bitte.beantworten(p.g, optionId, a.nr) !== null) throw new Error('Option ' + optionId + ' nicht angenommen');
}
// die Crew liefert ab (BEA-01 C1: nach dem Laden kommen die Forderung der Piraten und das Schmiergeld; hier: Nicht ausliefern, Bestechen, dann am Zielhafen andocken); danach steht der Faden vor der Enthüllung
async function abliefern(p, f) {
  Geld.standSetzen(p.g, 500, 'testmarken');
  await waehle(p, f, 'nicht_ausliefern'); await waehle(p, f, 'bestechen');
  for (let i = 0; i < 12 && !(f.phase === 'laeuft' && f.laufend && f.laufend.beat === 'b_abgabe'); i++) await runde(p.g);
  if (!f.fracht) throw new Error('keine Ware vor der Ablieferung');
  ankunft(p.g, f.fracht.nach); p.g.missionEvent('docked', {}); ab(p.g);
}
// der Faden ist bis zum Abschluss gelaufen (Mock-Spielleiter, Takte der Welt)
async function bisEnde(p, f, runden) { for (let i = 0; i < (runden || 30) && f.phase !== 'abgeschlossen'; i++) await runde(p.g); }
// bis kurz vor die Enthüllung (abgeliefert); der Test setzt die ruhige Welt und löst die Enthüllung selbst aus
async function vorEnthuellung(seed, o) {
  o = o || {};
  const p = o.partie || partie(seed);
  const f = await bisBitte(p);
  await annehmenBisWare(p, f);
  if (!f.fracht) throw new Error('keine Ware an Bord (Seed ' + seed + ')');
  await abliefern(p, f);
  stille(p.g);
  f.zaehler = f.abstand;
  return { p, g: p.g, f };
}
const weiter = (g, f, art) => Faden.befehlAnwenden(g, Object.assign({ typ: 'faden_weiter', faden: f.id, beat: 'b_enthuell' }, art === undefined ? {} : { art }));
// Gegenprobe jedes Nicht-Abliefern-Wegs: der Faden endet im Abschluss gescheitert, ohne Enthüllung, ohne Sim-Befehl
async function keineWirkung(p, f, titel) {
  const g = p.g;
  for (let i = 0; i < 14 && f.beat !== ZIEL_BEAT && f.phase !== 'abgeschlossen'; i++) { stille(g); await runde(g); }   // BEA-01 C1: unbeantwortete oder gescheiterte Beats (Forderung: Frist) laufen bis vor den Abschluss
  ok(f.beat === ZIEL_BEAT && f.nsc.status !== 'feindlich' && f.nsc.status !== 'geflohen', `${titel}: der Faden steht direkt vor dem Abschluss (Beat ${f.beat}, NSC ${f.nsc.status}), die Enthüllung wird übersprungen`);
  stille(g);
  for (let i = 0; i < 6; i++) p.tick();
  for (let i = 0; i < 30 && f.phase !== 'abgeschlossen'; i++) { stille(g); await runde(g); }   // BEA-01 C1: die Welt bleibt ruhig (stille), sonst fuellt der Mock-Spielleiter die Rate der Befehle und nimmt den Faden nicht mehr
  const sprueche = p.funk().filter((x) => /^Ich bin Germane/.test(String(x.text)));
  ok(f.phase === 'abgeschlossen' && f.ausgang && f.ausgang.art === 'gescheitert', `${titel}: der Faden endet im Abschluss gescheitert (${f.phase}, ${f.ausgang && f.ausgang.art})`);
  ok(sprueche.length === 0 && !p.funk().some((x) => x.from === f.nsc.name && /Flotte|Ladung ist scharf/.test(String(x.text))), `${titel}: keine Enthüllung per Funk`);
  ok(feindBefehle(g).length === 0 && hochgestuft(g).length === 0 && !befohleneAngriffe(g).length, `${titel}: 0 vorgemerkte Sim-Befehle (sabotage, invasion), keine Hochstufung, kein befohlener Feldzug (vorgemerkt: ${vorg(g).map((e) => e.b.typ).join(',') || '-'}; hochgestuft ${hochgestuft(g).length}; Angriffe ${JSON.stringify(g.weltsim.zustand.angriffe.map((a) => a.fraktion + '>' + a.ziel))})`);
  ok(!logbuch(g).some((e) => e.art === 'faden_baustein' && e.key === 'enthuellung') && !p.funk().some((x) => /Sprengladung bei |rückt gegen/.test(String(x.text))), `${titel}: kein Enthüllungs-Eintrag im Logbuch, keine Ankündigung des Oberkommandos`);
  ok(p.funk().some((x) => x.from === f.nsc.name && x.text === String(TX.texte.abschluss_gescheitert).replace('{name}', f.nsc.name)) || p.funk().some((x) => x.text === String(TX.texte.abschluss_gescheitert).replace('{name}', f.nsc.name)), `${titel}: der Abschlusstext abschluss_gescheitert wird gesprochen`);
  ok(f.nsc.status === 'aktiv', `${titel}: der NSC bleibt aktiv, nicht feindlich (${f.nsc.status})`);
}

(async () => {
  await section('Daten: Pfade, Stati, Folge, Hinweis, Text', async () => {
    const r = Pruefer.pruefeVorlage(klon(FH));
    ok(r.ok, 'die Vorlage besteht den Prüfer (' + r.fehler.join('; ') + ')');
    const w = (id, ag) => beat(FH, id).aus[ag].weiter;
    ok(w('b_bitte', 'gelungen') === 'b_fracht' && w('b_bitte', 'gescheitert') === 'b_abschluss', 'b_bitte: gelungen -> b_fracht, gescheitert -> b_abschluss');
    ok(w('b_fracht', 'gelungen') === 'b_forderung' && w('b_fracht', 'gescheitert') === 'b_abschluss' && beat(FH, 'b_fracht').parameter.ende === 'geladen', 'b_fracht (BEA-01 C1: Lade-Beat, ende geladen): gelungen -> b_forderung, gescheitert -> b_abschluss');
    ok(w('b_abgabe', 'gelungen') === 'b_enthuell' && w('b_abgabe', 'gescheitert') === 'b_abschluss' && beat(FH, 'b_abgabe').parameter.ende === 'abgeliefert', 'b_abgabe (Abliefer-Beat, ende abgeliefert): gelungen -> b_enthuell, gescheitert -> b_abschluss: nur die Ablieferung fuehrt zur Enthuellung');
    ok(w('b_enthuell', 'gelungen') === 'b_jagd' && w('b_enthuell', 'gescheitert') === 'b_jagd' && w('b_jagd', 'gelungen') === 'b_schlacht' && w('b_schlacht', 'gelungen') === 'b_abschluss', 'ab der Enthüllung wie bisher: b_jagd -> b_schlacht -> b_abschluss (der Händler bleibt Feind)');
    const hits = [];
    for (const b of FH.beats) for (const [ag, a] of Object.entries(b.aus || {})) for (const fo of (a.folge || [])) if (fo.typ === 'sim_befehl') hits.push(b.id + '.' + ag + ' ' + JSON.stringify(fo));
    ok(hits.length === 1 && hits[0] === 'b_enthuell.gelungen {"typ":"sim_befehl"}', 'genau eine Folge sim_befehl, im Ausgang gelungen der Enthüllung, ohne arten (alle Standard-Arten): ' + hits.join(' | '));
    ok(beat(FH, 'b_bitte').aus.gescheitert.status === 'aktiv' && beat(FH, 'b_fracht').aus.gescheitert.status === 'aktiv' && beat(FH, 'b_abgabe').aus.gescheitert.status === 'aktiv' && beat(FH, 'b_forderung').aus.gescheitert.status === 'aktiv', 'nicht abgeliefert: der NSC bleibt aktiv (kein Verbündeter, kein Feind: er hat nichts enthüllt)');
    ok(JSON.stringify(beat(FH, 'b_abschluss').erfolg) === '{"ereignis":["raumschlacht_gelungen"]}', 'der Abschluss zählt weiter nur raumschlacht_gelungen als Erfolg');
    const h = FH.hinweise.h_schmuggel;
    ok(h && ['geruecht', 'funk'].includes(h.kanal) && /\{name\}/.test(h.text) && /Schmuggelware/.test(h.text), 'Hinweis h_schmuggel: Kanal ' + (h && h.kanal) + ', Text nennt Schmuggelware und {name}');
    const lang = h.text.replace('{name}', 'Ouzo Brandt-Langername');
    ok(lang.length <= WERTE.hinweis_text_max.wert, 'Hinweistext höchstens ' + WERTE.hinweis_text_max.wert + ' Zeichen mit langem Namen (' + lang.length + ')');
    ok(!/Waffe|Sprengstoff|Sprengladung|Flotte|Invasion|Germane|scharf/i.test(h.text), 'der Hinweis verrät nicht, dass die Ware eine Waffe ist');
    ok(beat(FH, 'b_fracht').hinweise.join() === 'h_papiere,h_schmuggel' && !beat(FH, 'b_bitte').hinweise.includes('h_schmuggel'), 'h_schmuggel hängt an b_fracht (neben h_papiere), nicht an der Bitte');
    ok(/Waffe/.test(TX.texte.enthuellung_invasion) && TX.texte.enthuellung_invasion.length <= WERTE.funk_text_max.wert, 'der Enthüllungstext der Invasion erzählt „Ware war Waffe“ (bis LAD-01 die einzige Stelle, die die Waffen-Natur der Ware nennt)');
    ok(beat(FH, 'b_fracht').parameter.ware === 'fracht_kiste', 'die Ware bleibt die Faden-Ware fracht_kiste (Warenliste unverändert)');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  await section('(1) Abliefern: Invasion, Ankündigung vor der Wirkung, Stärke, Angriff', async () => {
    const { p, g, f } = await vorEnthuellung(501);
    ok(f.phase === 'wartet' && f.beat === ENTH_BEAT && f.nsc.status === 'verbuendet' && !f.fracht, `abgeliefert: der Faden wartet vor der Enthüllung (Beat ${f.beat}), Ware weg, NSC verbündet`);
    ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'fracht_gelungen'), 'das Gedächtnis kennt die gelungene Fracht');
    const ziel = P3.invasionsZiel(g, ORT);
    ok(!!ziel, 'Testwelt: ein römisches Ziel in Reichweite (' + ziel + ')');
    const stark0 = germ(g).map((fl) => ({ id: fl.id, s: fl.staerke, kap: fl.kap }));
    const r = weiter(g, f);   // ohne art: Standardart invasion
    ok(r.ok, 'faden_weiter enthuellung ohne Art angenommen');
    ok(feindBefehle(g).map((e) => e.b.typ).join() === 'invasion' && vorg(g).length === 1, 'vorgemerkt: EIN Befehl invasion (Hochstufen und Angriff in einem, keine Sprengung): ' + feindBefehle(g).map((e) => e.b.typ).join());
    const ang = feindBefehle(g).find((e) => e.b.typ === 'invasion');
    ok(ang && ang.b.ziel === ziel && ang.w === 1, 'die Invasion gilt dem Ziel ' + ziel + ', angekündigt');
    const iVor = p.ereig.findIndex((e) => e.k === 'radio' && e.x.from === LB.vorwarnung.invasion.sprecher && String(e.x.text).startsWith(LB.vorwarnung.invasion.text.split('{')[0]));
    const iNsc = p.ereig.findIndex((e) => e.k === 'radio' && e.x.from === f.nsc.name && /^Ich bin Germane/.test(String(e.x.text)));
    ok(iVor >= 0 && iNsc > iVor, `Funk: erst die Ankündigung des Oberkommandos (${iVor}), dann der Enthüllungstext des NSC (${iNsc})`);
    ok(nscFunk(p, f, /Waffe/).length === 1 && nscFunk(p, f, /Waffe/)[0].text === String(TX.texte.enthuellung_invasion).replace('{invasion}', nameVon(ziel)), 'der NSC enthüllt: die Ladung war Waffe (Text enthuellung_invasion mit Ziel)');
    ok(!befohleneAngriffe(g).length && hochgestuft(g).length === 0, 'zum Zeitpunkt der Ankündigung noch keine Wirkung auf die Sim');
    const nVorTick = p.ereig.length;
    let wirkung = -1;
    for (let i = 0; i < 8 && wirkung < 0; i++) { p.tick(); if (hochgestuft(g).length) wirkung = p.ereig.length - 1; }
    ok(wirkung >= nVorTick && iVor < nVorTick, 'die Wirkung (Hochstufen) kommt in einem späteren Takt als die Ankündigung (Funk ' + iVor + ' < Takt ' + wirkung + ')');
    const hs = hochgestuft(g);
    ok(hs.length === 1 && hs[0].fraktion === 'ger', 'genau eine germanische Flotte ist hochgestuft (' + hs.map((x) => x.id).join() + ')');
    const alt = stark0.find((x) => x.id === hs[0].id);
    const ersterTick = p.ereig.find((e) => e.k === 'tick' && e.hoch.length);   // der Takt, in dem die Hochstufung wirkte
    ok(!!alt && hs[0].staerke > alt.s * 1.0001, 'die Flotte ist stärker geworden (' + (alt && alt.s) + ' -> ' + hs[0].staerke + ')');
    ok(!!alt && hs[0].staerke <= alt.s * 1.3 + 1e-6, 'höchstens +30 % (' + (alt && alt.s) + ' -> ' + hs[0].staerke + ', Grenze ' + (alt && alt.s * 1.3) + ')');
    ok(!!ersterTick && ersterTick.angriff.includes(ziel), 'der Angriff auf das Ziel läuft (Feldzug gegen ' + ziel + ')');
    ok(f.nsc.status === 'feindlich' && f.beat >= ENTH_BEAT + 1, `der Händler bleibt als Feind im Faden (Status ${f.nsc.status}, Beat ${f.beat})`);
    const lb = logbuch(g).filter((e) => e.art === 'faden_baustein').pop();
    ok(lb && lb.ausgang === 'sim_befehl' && lb.plan.art === 'invasion' && lb.plan.ziele.invasion === ziel, 'Logbuch: sim_befehl, Art invasion, Ziel ' + ziel);
  });

  await section('(1) Abliefern: art sprengung und art beides über faden_weiter', async () => {
    {   // sprengung
      const { p, g, f } = await vorEnthuellung(502);
      const post = postenNah(g), z = P3.ziel(g, ORT);
      ok(!!post && !!z, 'Testwelt: ein römischer Posten bei ' + ORT + ' (' + z + ')');
      ok(weiter(g, f, 'sprengung').ok, 'faden_weiter art sprengung angenommen');
      ok(feindBefehle(g).map((e) => e.b.typ).join() === 'sabotage' && feindBefehle(g)[0].b.ort === z, 'vorgemerkt: nur die Sprengung am Ziel ' + z);
      ok(nscFunk(p, f, /Ladung ist scharf/).length === 1 && hochgestuft(g).length === 0, 'Funk: Sprengungstext, keine Hochstufung');
      for (let i = 0; i < 8; i++) p.tick();
      ok(hexe(g)[z].besitzer !== 'rom' || hexe(g)[z].posten === false, 'die Sprengung wirkt (Posten ' + z + ')');
      ok(f.nsc.status === 'feindlich', 'Ausgang gelungen, der Händler ist Feind');
    }
    {   // beides
      const { p, g, f } = await vorEnthuellung(503);
      const post = postenNah(g), z = P3.ziel(g, ORT), zi = P3.invasionsZiel(g, ORT);
      ok(weiter(g, f, 'beides').ok, 'faden_weiter art beides angenommen');
      ok(feindBefehle(g).map((e) => e.b.typ).join() === 'sabotage,invasion', 'vorgemerkt: Sprengung, Invasion (' + feindBefehle(g).map((e) => e.b.typ).join() + ')');
      const iS = p.ereig.findIndex((e) => e.k === 'radio' && /Sprengladung/.test(String(e.x.text))), iI = p.ereig.findIndex((e) => e.k === 'radio' && /rückt gegen/.test(String(e.x.text)));
      const iN = p.ereig.findIndex((e) => e.k === 'radio' && e.x.from === f.nsc.name && /^Ich bin Germane/.test(String(e.x.text)));
      ok(iS >= 0 && iI > iS && iN > iI && !p.ereig.slice(0, iN).some((e) => e.k === 'tick' && e.hoch.length), `Funk-Reihenfolge Sprengung (${iS}), Invasion (${iI}), NSC (${iN}), alles vor der Wirkung`);
      for (let i = 0; i < 8; i++) p.tick();
      ok((hexe(g)[z].besitzer !== 'rom' || !hexe(g)[z].posten) && hochgestuft(g).length === 1 && befohleneAngriffe(g).some((a) => a.ziel === zi), `beides wirkt: Posten ${z} gesprengt, eine Flotte hochgestuft, Feldzug gegen ${zi}`);
    }
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  await section('(2) Piraten (simuliert): Ware geladen, die Crew liefert sie den Piraten aus (BEA-01 C1: Beat forderung, Ausliefern)', async () => {
    const p = partie(511);
    const f = await bisBitte(p);
    await annehmenBisWare(p, f);
    ok(!!f.fracht && f.beat === 2 && f.phase === 'wartet' && f.nsc.gedaechtnis.slice(-1)[0].ereignis === 'fracht_geladen', 'Testlage: die Ware ist an Bord, der Lade-Beat ist zu Ende (Beat b_forderung wartet), Gedaechtnis fracht_geladen');
    stille(p.g);
    await waehle(p, f, 'ausliefern');
    ok(!f.fracht && f.nsc.gedaechtnis.some((x) => x.ereignis === 'fracht_gescheitert') && f.nsc.gedaechtnis.slice(-1)[0].ereignis === 'forderung_gescheitert', 'die Ware ist weg, das Gedaechtnis schreibt fracht_gescheitert (verlorene Ladung) und danach forderung_gescheitert');
    await keineWirkung(p, f, 'Piraten (Ausliefern)');
  });

  await section('(2b) Ware zwischen den Beats verloren (Notsprung nach dem Laden): Gedaechtnis kennt die verlorene Ladung', async () => {
    const p = partie(512);
    const f = await bisBitte(p);
    await annehmenBisWare(p, f);
    stille(p.g);
    const r = Fracht.verloren(p.g, f.id);   // zwischen den Beats (phase wartet): kein Beat, der scheitern koennte
    ok(r.ok && !f.fracht, 'die Ware ist verloren (Faden wartet)');
    ok(f.nsc.gedaechtnis.map((x) => x.ereignis).join() === 'bitte_gelungen,fracht_geladen,fracht_gescheitert', 'das Gedaechtnis schreibt fracht_gescheitert (BEA-01 C1: nicht nur das Laden): ' + f.nsc.gedaechtnis.map((x) => x.ereignis).join());
    ok(P3.notrufText(f.nsc, { parameter: { text_key: 'notruf_standard' } }) === 'notruf_erinnert_fracht', 'ein spaeterer Notruf erinnert sich an die verlorene Ladung');
  });

  await section('(3) Verweigern, Notsprung, Frist', async () => {
    {   // ablehnen
      const p = partie(521);
      const f = await bisBitte(p);
      const h0 = f.nsc.haltung;
      Bitte.beantworten(p.g, 'ablehnen', Bitte.offen(p.g).nr);
      ok(!f.fracht && f.nsc.haltung < h0, `Ablehnen: keine Ware, Haltung sinkt (${h0} -> ${f.nsc.haltung}, bitte_abgelehnt)`);
      await keineWirkung(p, f, 'Ablehnen');
    }
    {   // später / unbeantwortet: die Bitte verfällt ohne Annahme
      const p = partie(522);
      const f = await bisBitte(p);
      for (let i = 0; i < 14 && f.beat === 0; i++) await runde(p.g);
      ok(!f.fracht && f.beat === ZIEL_BEAT, 'unbeantwortet: die Bitte verfällt, keine Ware, der Faden geht in den Abschluss');
      await keineWirkung(p, f, 'Bitte unbeantwortet');
    }
    {   // Notsprung
      const p = partie(523);
      const f = await bisBitte(p);
      await annehmenBisWare(p, f);
      ok(!!f.fracht, 'Testlage: Ware an Bord');
      ab(p.g); stille(p.g);
      const ids = Fracht.notsprung(p.g);
      ok(ids.includes(f.id) && !f.fracht, 'Notsprung: die Ware ist verloren');
      await keineWirkung(p, f, 'Notsprung');
    }
    {   // Frist
      const p = partie(524);
      const f = await bisBitte(p);
      await annehmenBisWare(p, f);
      ok(!!f.fracht, 'Testlage: Ware an Bord');
      stille(p.g);
      for (let i = 0; i < 12 && !(f.phase === 'laeuft' && f.laufend && f.laufend.beat === 'b_forderung'); i++) await runde(p.g);   // BEA-01 C1: die Ware geht erst im Beat danach verloren: die Forderung laeuft, niemand antwortet
      ok(f.phase === 'laeuft' && !!f.fracht, 'Testlage: die Forderung laeuft, die Ware ist noch an Bord');
      X.grenzen(p.g, BEAT_FRIST + 1);
      ok(!f.fracht && f.nsc.gedaechtnis.some((x) => x.ereignis === 'fracht_gescheitert'), 'Frist abgelaufen: Ware weg, fracht_gescheitert');
      await keineWirkung(p, f, 'Frist');
    }
    {   // die direkte Probe am Prüfer: der Weg b_fracht gescheitert führt nie zur Enthüllung
      const w = klon(FH); w.id = 'haendler_probe'; beat(w, 'b_fracht').aus.gescheitert.weiter = 'b_enthuell';
      const r = Pruefer.pruefeVorlage(w);
      ok(!r.ok && r.fehler.some((t) => t.startsWith('SIM_BEFEHL_OHNE_TAT')), 'Gegenprobe Prüfer: führt b_fracht gescheitert in die Enthüllung, lehnt der Prüfer ab (SIM_BEFEHL_OHNE_TAT)');
    }
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  await section('(4) Hinweis h_schmuggel vor der Enthüllung', async () => {
    const { p, g, f } = await vorEnthuellung(531);
    const text = FH.hinweise.h_schmuggel.text.replace('{name}', f.nsc.name);
    const iH = p.ereig.findIndex((e) => e.k === 'radio' && e.x.text === text);
    ok(iH >= 0 && p.ereig[iH].x.from === D.WERTE.hinweis_sprecher[FH.hinweise.h_schmuggel.kanal] && p.ereig[iH].x.lage === 1, `der Hinweis ging als Lagefunk raus (Kanal ${FH.hinweise.h_schmuggel.kanal}, Sprecher ${iH >= 0 && p.ereig[iH].x.from})`);
    ok(f.hinweise.includes('h_schmuggel') && f.hinweise.includes('h_papiere') && f.hinweise.includes('h_gerucht'), 'alle drei Hinweise sind gestreut (' + f.hinweise.join(',') + ')');
    const iAnk = p.ereig.findIndex((e) => e.k === 'radio' && e.x.from === 'Hafenfunk' && e.x.text === text);
    weiter(g, f);
    const iEnth = p.ereig.findIndex((e) => e.k === 'radio' && /^Ich bin Germane/.test(String(e.x.text)));
    ok(iH >= 0 && iEnth > iH && iAnk === iH, `Reihenfolge der Funk-Events: Hinweis (${iH}) vor der Enthüllung (${iEnth})`);
    const iFracht = p.ereig.findIndex((e) => e.k === 'radio' && /^Ware an Bord/.test(String(e.x.text)));
    ok(iFracht >= 0 && iH > iFracht - 5, 'der Hinweis gehört zum Fracht-Beat (kommt mit dessen Beginn, Funk „Ware an Bord“ bei ' + iFracht + ')');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  await section('(5) Weitere Händlerfäden: Abkühlzeit der Invasion, dann eine andere Flotte, nie dieselbe zweimal', async () => {
    const abk = lies('content/welt/regie-werte.json').werte.abkuehlung.wert.invasion;
    const e1 = await vorEnthuellung(541);
    const { p, g, f } = e1;
    ok(weiter(g, f).ok, 'erste Invasion angekündigt');
    for (let i = 0; i < 8 && !hochgestuft(g).length; i++) p.tick();
    const erste = hochgestuft(g).map((fl) => fl.id);
    ok(erste.length === 1, 'erste Flotte hochgestuft (' + erste.join() + ')');
    // Hilfe: der Vorgänger läuft zu Ende, ein weiterer Händler öffnet sich in derselben Welt und steht vor der Enthüllung
    const naechster = async (vorgaenger) => {
      vorgaenger.phase = 'abgeschlossen'; vorgaenger.ausgang = { art: 'gescheitert', status: vorgaenger.nsc.status, tick: g.weltsim.tickZahl };
      const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'falscher_haendler', parameter: { angebot: notrufOhneOrt(g, 'notruf_havarie_konvoi', ORT, 'gelungen').nr } });
      if (!r.ok) throw new Error('weiterer Händlerfaden nicht geöffnet: ' + r.grund);
      const h = r.faden;
      for (let i = 0; i < 8 && !Bitte.offen(g); i++) await runde(g);
      await annehmenBisWare(p, h);
      if (!h.fracht) throw new Error('keine Ware an Bord');
      await abliefern(p, h);
      stille(g);
      h.zaehler = h.abstand;
      return h;
    };
    // (a) zweiter Faden WÄHREND der Abkühlzeit: die Invasion wird abgelehnt (Grund Abkühlzeit), nichts vorgemerkt, der Faden scheitert sauber
    const h = await naechster(f);
    ok(feindBefehle(g).length === 0 && hochgestuft(g).map((fl) => fl.id).join() === erste.join() && germ(g).length >= 2, 'zweiter Faden: die erste Flotte trägt das Feld hochgestuft weiter (' + erste.join() + '), mehrere germanische Flotten da (' + germ(g).length + ')');
    ok(weiter(g, h).ok, 'faden_weiter angenommen (der Beat scheitert, der Faden geht weiter)');
    const lb = logbuch(g).filter((e) => e.art === 'faden_baustein').pop();
    ok(feindBefehle(g).length === 0 && h.nsc.status === 'geflohen' && lb && lb.ausgang === 'sim_befehl_abgelehnt' && /Abkühlzeit/.test(lb.begruendung), 'in der Abkühlzeit: nichts vorgemerkt, NSC geflohen, Logbuch sim_befehl_abgelehnt mit Grund Abkühlzeit (' + (lb && lb.begruendung) + ')');
    const t2 = nscFunk(p, h, /Ich bin Germane/).pop();
    ok(!!t2 && t2.text === String(TX.texte.enthuellung_invasion_ohne).replace('{ort}', nameVon(ORT)), 'Fallback-Text enthuellung_invasion_ohne wird gesprochen (' + (t2 && t2.text) + ')');
    ok(!/Ziel/.test(t2.text), 'der Text behauptet keinen Grund (kein "Ziel"), er stimmt für die Abkühlzeit ebenso wie für alle anderen Ablehnungen');
    // (b) dritter Faden NACH der Abkühlzeit (der Stand der letzten Annahme liegt abk Ticks zurück): angenommen, eine ANDERE Flotte
    const h3 = await naechster(h);
    g.weltsim.regie.letzte['invasion:ger'] = g.weltsim.tickZahl - abk;
    const stark = Object.fromEntries(germ(g).map((fl) => [fl.id, fl.staerke]));
    ok(weiter(g, h3).ok, 'dritter Faden: faden_weiter angenommen');
    const inv = feindBefehle(g).find((e) => e.b.typ === 'invasion');
    ok(!!inv && !erste.includes(inv.b.flotte), 'nach der Abkühlzeit: die Invasion wechselt die Flotte, vorgemerkt wird ' + (inv && inv.b.flotte) + ' (nicht ' + erste.join() + ')');
    for (let i = 0; i < 8; i++) p.tick();
    ok(hochgestuft(g).length === 2 && germ(g).filter((fl) => fl.hochgestuft).every((fl) => fl.staerke <= (stark[fl.id] || fl.kap) * 1.3 + 1e-6 || erste.includes(fl.id)), 'zwei verschiedene Flotten hochgestuft, jede höchstens einmal');
    ok(hochgestuft(g).every((fl, _, arr) => arr.filter((x) => x.id === fl.id).length === 1), 'keine Flotte wird zweimal gezählt');
    // alle germanischen Flotten schon hochgestuft: keine weitere Hochstufung, die Invasion scheitert sauber (Fallback-Text, Faden geht als gescheitert weiter)
    const e3 = await vorEnthuellung(542);
    for (const fl of germ(e3.g)) fl.hochgestuft = true;
    ok(weiter(e3.g, e3.f).ok, 'weiterer Faden: faden_weiter angenommen, obwohl keine Flotte mehr frei ist');
    const lb3 = logbuch(e3.g).filter((e) => e.art === 'faden_baustein').pop();
    const t3 = nscFunk(e3.p, e3.f, /Ich bin Germane/).pop();
    ok(feindBefehle(e3.g).length === 0 && e3.f.nsc.status === 'geflohen' && lb3 && lb3.ausgang === 'sim_befehl_abgelehnt' && /hochgestuft|keine bereite/.test(lb3.begruendung), 'alle Flotten schon hochgestuft: nichts vorgemerkt, NSC geflohen, Logbuch sim_befehl_abgelehnt (' + (lb3 && lb3.begruendung) + ')');
    ok(!!t3 && t3.text === String(TX.texte.enthuellung_invasion_ohne).replace('{ort}', nameVon(ORT)), 'Fallback-Text enthuellung_invasion_ohne (' + (t3 && t3.text) + ')');
    ok(e3.f.beat === ENTH_BEAT + 1, 'der Faden geht weiter (b_jagd)');
  });

  console.log(`\n${n - fails}/${n} Prüfungen ok`);
  if (fails) { console.log('FADEN-HAENDLER-INVASION FEHLER: ' + fails); process.exit(1); }
  console.log('FADEN-HAENDLER-INVASION OK');
})().catch((e) => { console.log('ABSTURZ Ausnahme: ' + (e && e.stack)); process.exit(1); });
