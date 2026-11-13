'use strict';
// BEA-02 C: der Notruf-Plan des Bretts ist eine Bergung (content/faeden/notruf-brett.json, server/sim/abenteuer-brett.js notrufAnbieten, Absicht bergung in absichten.json, faden-p3.js notrufImStich).
// Die Erwartungen stehen hier selbst (Daten gelesen, nie aus dem Produktivcode abgeleitet).
//   (a) Daten: Plan notruf > rettung(ende abgegeben) > abschluss, Verzweigung gescheitert > ende, Erfolg nur rettung; Besetzung je Variante aus Schluesseln von boden-werte.json; Absicht je Variante ist bergung, rettung bleibt die Befreiung
//   (b) Ort-Art folgt dem Hex: wildnis nur an Hexen, die sie kennen, sonst schiff (Wrack im Raum); Zaehlung; 100 Wuerfe je Hex (Variante, Sprecher), 0 abgelehnte Plaene
//   (c) Die Besetzung der Variante steht als Schluessel am Beat rettung (Belagerung am Boden: an wildnis und schiff wie der Ueberfall), die Variante steht nicht im Faden, kein Seed im Plan
//   (d) Pruefer: rettung ohne landeplatz wird abgelehnt (Plan, Expander), ein Hex ohne Szene bekommt kein Angebot (reiner Katalog-Notruf)
//   (e) Absicht bergung: Katalog, Prompt-Zeile, Inszenierer baut notruf > rettung > abschluss mit Wrack; Plan aus dem Vorrat (Absichten-Modus); Doppel-Dank-Fall
//   (f) Rueckfall ohne Modell (Planet und Wrack, mehrere Seeds): Notruf, Ankunft, Rettung scheitert ohne Crew an der Frist, Abschluss gescheitert, Ort restlos weg, 0 Komponisten-Aufrufe, 0 Fehler; Notruf gescheitert > ende ohne Rettung;
//       Rettung gelungen > Abschluss gelungen (Erfolg nur rettung); im Stich gelassen waehrend der Gefahr: die Rettung entfaellt
//   (g) Brett-Schritte und Grep-Test: im Servercode steht kein Besetzungsschluessel und keine Fraktion
// Aufruf: node tools/test-notruf-bergung.js [begriff ...]        (npm run test:notruf-bergung)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const space = require('../server/sim/space.js');
const Besitz = require('../server/sim/besitz.js');
const Ruf = require('../server/sim/ruf.js');
const RE = require('../server/sim/reise-ereignis.js');
const Faden = require('../server/sim/faden.js');
const FD = require('../server/sim/faden-daten.js');
const P = require('../server/sim/faden-pruefer.js');
const AO = require('../server/sim/abenteuer-orte.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Bauplan = require('../server/sim/faden-bauplan.js');
const AP = require('../server/sim/absicht-pruefer.js');
const INS = require('../server/sim/inszenierer.js');
const V = require('../server/sim/abenteuer-vorrat.js');
const Absicht2 = require('../server/sim/abenteuer-absicht.js');
const Landung = require('../server/sim/faden-landung.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
async function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { await fn(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); }
}
const lies = (...p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const NBD = lies('content', 'faeden', 'notruf-brett.json');
const NB = Object.fromEntries(Object.entries(NBD.werte).map(([k, v]) => [k, v.wert]));
const BODEN = lies('content', 'faeden', 'boden-werte.json').werte;
const ABS = lies('content', 'faeden', 'absichten.json');
const BEATS = lies('content', 'faeden', 'beats.json').beats;
const P3 = lies('content', 'faeden', 'p3-texte.json');
const RT = lies('content', 'faeden', 'rettung-texte.json').texte;
const BRETT = lies('content', 'faeden', 'abenteuer-brett.json').werte;
const VARIANTEN = ['havarie', 'piratenueberfall', 'belagerung'];
const ERWARTET = { havarie: 'ruhig', piratenueberfall: 'raeuber', belagerung: 'belagerer' };   // Besetzung je Variante, wie Kai sie bestimmt hat; belagerer gilt nur an station/aussenposten
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };   // wie der echte Server im Rueckfall
const HZ = CONFIG.tickHz;
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const Fz = (g) => Faden.zustandVon(g);
const sl = (g) => g.lageSpielleiter;
const aufrufe = (g) => (sl(g) ? (sl(g).aufrufe || 0) + ((sl(g).abenteuer && sl(g).abenteuer.aufrufe) || 0) : 0);
const spiel = (o) => F.neuesSpiel(Object.assign({ crew: 1, seed: 7, env: ENV }, o || {}));
const rng = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

// Spielbare Hexe mit Szene (nur NACH Spielstart stimmt die Karte, siehe Erkundung BEA-02 Frage 3)
function hexe() {
  const alle = [];
  for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) { const c = String(a).padStart(2, '0') + String(b).padStart(2, '0'); if (Sektoren.imRaster(c) && Sektoren.spielbar(c)) alle.push(c); }
  return { alle, mitSzene: alle.filter((h) => Sektoren.hatSzene(h) && !Sektoren.istLeerraum(h)) };
}
const notrufEv = (hex, variante, i, hafen) => ({ nr: -(i + 1), id: 'notruf_probe', hex, variante, sprecher: 'Probeschiff ' + i, marke: 'reise:n-' + (i + 1), ankunft: hafen || '0305' });
const ohneAngebote = (g) => { Fz(g).abenteuerAngebote = []; };
const rettungBeat = (plan) => plan.beats.find((b) => b.typ === 'rettung');
const angebotPlan = (a) => a.vorlage;   // die expandierte Vorlage (Beats, landeplaetze)
const typen = (v) => v.beats.map((b) => b.typ).join(',');

(async () => {

// ---------------------------------------------------------------- (a)
await section('(a) Daten: Plan, Besetzung je Variante, Absichten', () => {
  const plan = NBD.plan;
  ok(plan.beats.map((b) => b.typ).join() === 'notruf,rettung,abschluss', 'Schablone: notruf, rettung, abschluss (ein Abstieg, kein landung)');
  ok(!plan.beats.some((b) => b.typ === 'landung') && plan.landeplaetze === undefined, 'landung ist nicht Teil des Standardplans, die Schablone nennt keinen Landeplatz (das Brett setzt ihn je Angebot)');
  const r = plan.beats[1];
  ok(r.parameter.ende === 'abgegeben' && r.parameter.anzahl === undefined && r.parameter.besetzung === undefined && r.parameter.landeplatz === undefined, 'rettung: ende abgegeben, anzahl aus dem Daten-Standard (nicht im Plan), Besetzung und Landeplatz je Angebot');
  ok(plan.beats[0].verzweigung && plan.beats[0].verzweigung.gescheitert === 'ende' && r.verzweigung && r.verzweigung.gescheitert === 'ende' && plan.beats[2].id === 'ende', 'Scheitern von notruf und rettung fuehrt auf den Abschluss (id ende)');
  ok(Array.isArray(plan.beats[2].erfolg) && plan.beats[2].erfolg.join() === 'rettung', 'Erfolg des Abschlusses ist nur die Rettung (nicht schon die Ankunft)');
  ok(plan.volk_erlaubt.join() === 'rom,kon,ger', 'volk_erlaubt rom, kon, ger');
  ok(VARIANTEN.every((v) => NB.besetzung_je_variante[v] === ERWARTET[v] && Object.prototype.hasOwnProperty.call(BODEN.besetzung.wert, NB.besetzung_je_variante[v])), 'Besetzung je Variante: havarie ruhig, piratenueberfall raeuber, belagerung belagerer; alle Schluessel stehen in boden-werte.json');
  ok(Object.keys(NB.besetzung_arten).concat(Object.values(NB.besetzung_ersatz)).every((k) => Object.prototype.hasOwnProperty.call(BODEN.besetzung.wert, k)) && NB.besetzung_arten.belagerer.join() === 'station,aussenposten' && NB.besetzung_ersatz.belagerer === 'raeuber', 'belagerer gilt nur an station und aussenposten, sonst raeuber (Tabelle in den Daten)');
  ok(NB.besetzung_arten.belagerer.every((a) => AO.DATEN.arten.includes(a)) && NB.landeplatz_arten.every((a) => AO.DATEN.arten.includes(a)), 'alle genannten Ort-Arten sind Kartenarten der Orte');
  ok(NB.landeplatz_arten.join() === 'wildnis,schiff' && NB.ort_beats.join() === 'rettung' && new RegExp('^' + AO.DATEN.platz_muster + '$').test(NB.landeplatz_id), 'Ort-Arten in der Reihenfolge wildnis, schiff; Landeplatz-Id passt zum Muster');
  ok(VARIANTEN.every((v) => NB.absicht_je_variante[v] === 'bergung') && NB.absicht_standard === 'bergung', 'alle drei Varianten tragen die Absicht bergung');
  const k = AP.katalogStandard();
  ok(!!k.absichten.bergung && !!k.absichten.rettung, 'beide Absichten stehen im Katalog');
  const rs = k.absichten.rettung.inszenierung.skelett.beats.map((b) => b.typ).join();
  ok(rs === 'notruf,befreiung,abschluss' && k.absichten.rettung.prompt_zeile.startsWith('rettung: Ein entführter NSC'), 'die Absicht rettung ist unberuehrt (Befreiung eines entfuehrten NSC, Skelett notruf, befreiung, abschluss)');
  const b = k.absichten.bergung;
  ok(b.inszenierung.skelett.beats.map((x) => x.typ).join() === 'notruf,rettung,abschluss' && b.inszenierung.ort.regel === 'ziel_im_umkreis' && b.wendungen.join() === 'keine', 'bergung: Skelett notruf, rettung, abschluss, Ort ziel_im_umkreis, keine Wendungen');
  ok(b.prompt_zeile.length <= 250 && b.prompt_zeile.startsWith('bergung:') && b.prompt_zeile.length <= k.werte.prompt_zeile_max.wert, `bergung: prompt_zeile ${b.prompt_zeile.length} Zeichen (hoechstens 250)`);
  ok(b.inszenierung.skelett.beats[1].parameter.ende === 'abgegeben' && b.inszenierung.skelett.landeplaetze[0].art === 'schiff' && b.inszenierung.skelett.beats[1].parameter.landeplatz === b.inszenierung.skelett.landeplaetze[0].id, 'bergung: ende abgegeben, Landeplatz Wrack (schiff), Beat und Plan nennen dieselbe Id');
  ok(AP.katalogFehler ? AP.katalogFehler(k).length === 0 : true, 'Katalog der Absichten ohne Fehler');
  // Der Funktext je Variante passt zu einer Rettung und der Anlass nennt keine Ueberlebenden (der Katalog-Notruf nennt sie nicht)
  ok(VARIANTEN.every((v) => typeof P3.texte[NB.text_key_je_variante[v]] === 'string') && Object.values(NB.anlass_je_variante).every((t) => !/[Üü]berleb|Wrack/.test(t)), 'Funktexte je Variante vorhanden, kein Anlass spricht von Ueberlebenden oder einem Wrack');
  ok(!/[Üü]berleb/.test(Object.values(NB.text_key_je_variante).map((k2) => P3.texte[k2]).join(' ')), 'kein Funktext des Notrufs nennt Ueberlebende (das sagt erst der Funk der Rettung)');
  ok(typeof RT.rettung_start_abgegeben === 'string' && BEATS.rettung.bauplan.parameter.ende.erlaubt.includes(plan.beats[1].parameter.ende), 'der Funk der Rettung zu ende abgegeben und der Katalog kennen den Wert');
});

// ---------------------------------------------------------------- (b)
await section('(b) Ort-Art folgt dem Hex: wildnis wo der Sektor sie kennt, sonst Wrack im Raum; 100 Wuerfe je Hex', () => {
  const T = spiel(), g = T.g;
  const { alle, mitSzene } = hexe();
  let wild = 0, schiff = 0, ohne = 0, falsch = 0, abgelehnt = 0, wuerfe = 0, ohneSzene = 0, ohneSzeneAngebot = 0;
  const probleme = [];
  for (const h of alle) {
    const arten = AO.moeglicheArten(h);
    if (!mitSzene.includes(h)) { ohneSzene++; ohneAngebote(g); const a0 = Brett.notrufAnbieten(g, notrufEv(h, 'havarie', 1)); if (a0 && a0.vorlage.landeplaetze[0].art === (arten.includes('wildnis') ? 'wildnis' : 'schiff') && arten.includes('schiff')) ohneSzeneAngebot++; continue; }
    const soll = arten.includes('wildnis') ? 'wildnis' : arten.includes('schiff') ? 'schiff' : null;
    if (soll === 'wildnis') wild++; else if (soll === 'schiff') schiff++; else ohne++;
    const r = rng(h.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
    for (let i = 0; i < 100; i++) {
      const variante = VARIANTEN[Math.floor(r() * VARIANTEN.length)];
      ohneAngebote(g);
      const a = Brett.notrufAnbieten(g, notrufEv(h, variante, i + 1));
      wuerfe++;
      if (!a) { abgelehnt++; if (probleme.length < 3) probleme.push(h + '/' + variante); continue; }
      const v = angebotPlan(a);
      if (!v.landeplaetze || v.landeplaetze.length !== 1 || v.landeplaetze[0].art !== soll) { falsch++; if (probleme.length < 3) probleme.push(h + ' Art ' + (v.landeplaetze && v.landeplaetze[0] && v.landeplaetze[0].art)); }
    }
  }
  console.log(`  Messung: ${alle.length} spielbare Hexe, ${mitSzene.length} mit Szene: wildnis ${wild}, nur Wrack (schiff) ${schiff}, keine der Arten ${ohne}; ohne Szene ${ohneSzene}; ${wuerfe} Wuerfe, abgelehnt ${abgelehnt}, falsche Art ${falsch}`);
  ok(wild + schiff + ohne === mitSzene.length && wild > 0 && schiff > 0, `die Hexe teilen sich auf: ${wild} mit Planet (wildnis), ${schiff} nur mit Wrack (schiff), beide Faelle kommen vor`);
  ok(ohne === 0, 'jeder Hex mit Szene kennt wenigstens das Wrack im Raum (schiff): Art-Wahl geht immer auf');
  ok(wuerfe === 100 * mitSzene.length && abgelehnt === 0, `${wuerfe} Wuerfe (100 je Hex mit Szene, Variante gewuerfelt): 0 abgelehnte Plaene (${abgelehnt}${probleme.length ? ': ' + probleme.join(', ') : ''})`);
  ok(falsch === 0, 'die Ort-Art folgt in jedem Wurf dem Hex: wildnis wenn moeglicheArten sie nennt, sonst schiff (' + falsch + ' falsch)');
  ok(ohneSzeneAngebot === ohneSzene, `die uebrigen spielbaren Hexe (${ohneSzene}, Leerraum mit Raumpunkt): auch dort ein Angebot mit Wrack im Raum (${ohneSzeneAngebot} von ${ohneSzene})`);
  ohneAngebote(g);
  ok(Brett.notrufAnbieten(g, notrufEv('xxxx', 'havarie', 1)) === null && Brett.notrufAnbieten(g, notrufEv('0000', 'havarie', 2)) === null, 'ein Hex ohne Sektor bekommt kein Angebot (der Notruf bleibt ein reiner Katalog-Notruf)');
  // jeder Wurf mit wildnis wurde wirklich vom Pruefer als LANDEPLATZ_ART-fest gebaut: der Pruefer lehnt wildnis an einem Hex ohne Planet ab
  const ohneWild = mitSzene.find((h) => !AO.moeglicheArten(h).includes('wildnis'));
  const planW = klon(NBD.plan); planW.titel = 'Notruf: Probe'; planW.anlass = NB.anlass_standard; planW.landeplaetze = [{ id: NB.landeplatz_id, art: 'wildnis' }]; planW.beats[1].parameter.landeplatz = NB.landeplatz_id;
  ohneAngebote(g);
  const rw = Faden.abenteuerNotrufAnbieten(g, planW, { hex: ohneWild });
  ok(!rw.ok && /LANDEPLATZ_ART/.test(String(rw.grund)), 'Gegenprobe: derselbe Plan mit wildnis an einem Hex ohne Planet wird vom Pruefer abgelehnt (LANDEPLATZ_ART)');
});

// ---------------------------------------------------------------- (c)
await section('(c) Besetzung je Variante als Schluessel, Variante nicht im Faden, kein Seed im Plan', () => {
  const T = spiel(), g = T.g;
  const { mitSzene } = hexe();
  const hWild = mitSzene.find((h) => AO.moeglicheArten(h).includes('wildnis')), hSchiff = mitSzene.find((h) => !AO.moeglicheArten(h).includes('wildnis'));
  ok(!!hWild && !!hSchiff, `Hexe fuer beide Arten gefunden (${hWild}, ${hSchiff})`);
  for (const [hex, art] of [[hWild, 'wildnis'], [hSchiff, 'schiff']]) {
    for (const variante of VARIANTEN) {
      ohneAngebote(g);
      const a = Brett.notrufAnbieten(g, notrufEv(hex, variante, 1));
      if (!a) { ok(false, `${art}/${variante}: Angebot`); continue; }
      const v = angebotPlan(a), rb = rettungBeat(v);
      const soll = variante === 'belagerung' ? NB.besetzung_ersatz.belagerer : NB.besetzung_je_variante[variante];   // belagerer nur an station/aussenposten: an wildnis und schiff gilt der Ersatz
      ok(typen(v) === 'notruf,rettung,abschluss' && v.landeplaetze[0].art === art && rb.parameter.landeplatz === v.landeplaetze[0].id, `${art}/${variante}: Plan notruf, rettung, abschluss, Landeplatz ${v.landeplaetze[0].id} (${v.landeplaetze[0].art})`);
      ok(rb.parameter.besetzung === soll && rb.parameter.ende === 'abgegeben', `${art}/${variante}: Besetzung "${rb.parameter.besetzung}" (erwartet ${soll}), ende ${rb.parameter.ende}`);
      ok(v.beats[0].parameter.text_key === NB.text_key_je_variante[variante] && a.variante === variante && a.absicht.absicht === 'bergung', `${art}/${variante}: Funktext ${v.beats[0].parameter.text_key}, Angebot traegt Variante und Absicht bergung`);
      ok(Landung.WERTE.besetzung.wert[rb.parameter.besetzung] !== undefined, `${art}/${variante}: der Schluessel steht in der Besetzungstabelle`);
    }
  }
  // Die Variante steht nicht im Faden; im Plan steht nur ein Schluessel, nie ein Seed oder eine Besetzung
  ohneAngebote(g);
  const a = Brett.notrufAnbieten(g, notrufEv(hSchiff, 'piratenueberfall', 7));
  const roh = JSON.stringify(a.vorlage.beats.map((b) => b.parameter || {}).concat([a.vorlage.landeplaetze]));
  ok(!/seed|fraktion|staerke|raubzug|wach|klein|mittel/i.test(roh), 'Parameter und Landeplaetze des Plans ohne Seed, Fraktion oder Staerke (nur der Schluessel der Besetzung): ' + roh.slice(0, 160));
  ok(Brett.annehmen(g, 'a' + a.nr) === null, 'Annehmen');
  const f = Fz(g).liste.find((x) => x.vorlage === a.ref);
  ok(!!f && !/piratenueberfall|havarie|belagerung/.test(JSON.stringify(f).replace(/notruf_(havarie|ueberfall|belagerung)/g, '')), 'die Variante steht nicht im Faden (nur im Angebot und im text_key des ersten Beats)');
  ok(!!f && f.parameter.volk !== undefined && ['rom', 'kon', 'ger'].includes(f.parameter.volk), 'der NSC hat ein Volk aus volk_erlaubt (' + (f && f.parameter.volk) + ')');
  // Germanengebiet: ohne ger in volk_erlaubt bekaeme ein Notruf dort einen roemischen NSC
  const T2 = spiel(), g2 = T2.g;
  const hGer = hexe().mitSzene.find((h) => (Besitz.besitzer(g2, h) || 'frei') === 'ger');
  if (hGer) {
    ohneAngebote(g2);
    const ag = Brett.notrufAnbieten(g2, notrufEv(hGer, 'havarie', 3));
    Brett.annehmen(g2, 'a' + ag.nr);
    const fg = Fz(g2).liste.find((x) => x.vorlage === ag.ref);
    ok(ag.volk === 'ger' && fg.parameter.volk === 'ger', `Germanengebiet ${hGer}: Angebot und NSC haben das Volk ger`);
  } else ok(false, 'ein Hex im Germanengebiet gefunden');
});

// ---------------------------------------------------------------- (d)
await section('(d) Pruefer: rettung braucht einen Landeplatz', () => {
  const T = spiel(), g = T.g;
  const { mitSzene } = hexe();
  const hex = mitSzene[0];
  const plan = (landeplatz, landeplaetze) => {
    const p = klon(NBD.plan); p.titel = 'Notruf: Probe'; p.anlass = NB.anlass_standard;
    if (landeplaetze) p.landeplaetze = landeplaetze;
    if (landeplatz) rettungBeat(p).parameter.landeplatz = landeplatz;
    return p;
  };
  const gut = plan(NB.landeplatz_id, [{ id: NB.landeplatz_id, art: 'schiff' }]);
  ohneAngebote(g);
  ok(Faden.abenteuerNotrufAnbieten(g, gut, { hex }).ok === true, 'Plan mit Landeplatz besteht den Pruefer (Gegenprobe)');
  const rg = Bauplan.pruefe(gut);
  const vv = klon(rg.vorlage); delete rettungBeat(vv).parameter.landeplatz;
  const pv = P.pruefeVorlage(vv);
  ok(rg.ok && !pv.ok && pv.fehler.some((x) => String(x).startsWith('LANDEPLATZ_PFLICHT')), 'der Pruefer der Vorlage (pruefeVorlage) lehnt rettung ohne landeplatz ab, auch ohne den Expander (LANDEPLATZ_PFLICHT)');
  const ohne = plan(null, [{ id: NB.landeplatz_id, art: 'schiff' }]);
  const e1 = Bauplan.expandiere(ohne), p1 = Bauplan.pruefe(ohne);
  ok(!e1.ok && !p1.ok && /LANDEPLATZ_PFLICHT/.test(JSON.stringify(e1.fehler) + JSON.stringify(p1.fehler)), 'rettung ohne landeplatz: Expander und Pruefer lehnen ab (LANDEPLATZ_PFLICHT)');
  ohneAngebote(g);
  const r2 = Faden.abenteuerNotrufAnbieten(g, ohne, { hex });
  ok(!r2.ok && /LANDEPLATZ_PFLICHT/.test(String(r2.grund) + JSON.stringify(r2.fehler || [])), 'das Brett nimmt einen solchen Plan nicht an (' + String(r2.grund).slice(0, 60) + ')');
  const ohnePlatz = plan(null, null);
  ok(!Bauplan.pruefe(ohnePlatz).ok, 'ohne landeplatz und ohne landeplaetze abgelehnt');
  const unbekannt = plan('gibtsnicht', [{ id: NB.landeplatz_id, art: 'schiff' }]);
  ohneAngebote(g);
  const r3 = Faden.abenteuerNotrufAnbieten(g, unbekannt, { hex });
  ok(!r3.ok && /LANDEPLATZ_UNBEKANNT/.test(String(r3.grund)), 'ein Landeplatz, den der Plan nicht nennt, wird abgelehnt (LANDEPLATZ_UNBEKANNT)');
  const unbekanntBesetzung = plan(NB.landeplatz_id, [{ id: NB.landeplatz_id, art: 'schiff' }]); rettungBeat(unbekanntBesetzung).parameter.besetzung = 'gibtsnicht';
  ok(!Bauplan.expandiere(unbekanntBesetzung).ok, 'eine unbekannte Besetzung lehnt der Expander ab');
  ok(P.katalogFehler ? P.katalogFehler().length === 0 : true, 'Katalogpruefung ohne Fehler');
});

// ---------------------------------------------------------------- (e)
await section('(e) Absicht bergung: Inszenierer, Prompt, Vorrat, Doppel-Dank', () => {
  const T = spiel({ env: Object.assign({ ABENTEUER_ABSICHTEN: '1' }, ENV) }), g = T.g;
  ok(Absicht2.aktiv(g) === true, 'Modus Absichten an');
  const absicht = { format: 'absicht/1', absicht: 'bergung', titel: 'Notruf: Probeschiff', parameter: { text_key: 'notruf_standard' }, bezug: {}, bogen: { einsatz: 'Ein Schiff treibt havariert im All und ruft um Hilfe.', wendung: 'keine', preis: 'Ohne Hilfe bleibt das Schiff liegen.' }, ton: 'dringlich' };
  const r = INS.inszeniere(g, absicht);
  ok(r.ok === true && typen(r.plan) === 'notruf,rettung,abschluss', 'der Inszenierer baut notruf, rettung, abschluss (' + (r.ok ? typen(r.plan) : JSON.stringify((r.fehler || []).map((x) => x.code))) + ')');
  if (r.ok) {
    ok(r.plan.landeplaetze[0].art === 'schiff' && rettungBeat(r.plan).parameter.landeplatz === r.plan.landeplaetze[0].id && rettungBeat(r.plan).parameter.ende === 'abgegeben', 'Plan: Wrack (schiff), Landeplatz am Beat, ende abgegeben');
    ok(r.plan.beats[2].erfolg && r.plan.beats[2].erfolg.join() === 'rettung' && r.plan.beats[0].verzweigung.gescheitert === 'ende' && rettungBeat(r.plan).verzweigung.gescheitert === 'ende', 'Erfolg nur rettung, Scheitern fuehrt auf den Abschluss');
    ok(Bauplan.expandiere(r.plan).ok === true, 'der Plan besteht den Expander');
    ok(r.hex !== undefined && Sektoren.spielbar(r.hex), 'der Ort ist ein spielbarer Sektor im Umkreis (' + r.hex + ')');
  }
  // Prompt: die Absicht steht im Absichten-Katalog (Zeichen)
  const kat = AP.katalogStandard();
  const zeilen = Object.values(kat.absichten).filter((e) => e.prompt_zeile).map((e) => e.prompt_zeile);
  const summe = zeilen.join('\n').length;
  console.log(`  Messung: Absichten-Katalog ${summe} Zeichen mit bergung (${kat.absichten.bergung.prompt_zeile.length}), ohne ${summe - kat.absichten.bergung.prompt_zeile.length - 1}; Ziel ${kat.werte.prompt_summe_ziel.wert}`);
  ok(summe <= kat.werte.prompt_summe_ziel.wert, `Summe der Prompt-Zeilen ${summe} <= prompt_summe_ziel ${kat.werte.prompt_summe_ziel.wert}`);
  ok(Prompt.WERTE.prompt_max_zeichen > 0, 'prompt_max_zeichen aus den Daten (' + Prompt.WERTE.prompt_max_zeichen + ')');
  // Vorrat: ein Notruf-Plan aus dem Vorrat (Absichten-Modus) ist jetzt eine Bergung
  const { mitSzene } = hexe();
  const hex = mitSzene.find((h) => h !== '0305' && AO.moeglicheArten(h).includes('schiff'));
  const e = V.eintrag(g, { absicht, art: BRETT.vorrat_art_notruf.wert });
  ok(e.ok === true, 'Vorrat-Eintrag der Art notruf mit Absicht bergung gebaut' + (e.ok ? '' : ' (' + JSON.stringify(e).slice(0, 120) + ')'));
  if (e.ok) {
    ok(V.hinzufuegen(g, e.eintrag).ok === true && V.liste(g).length === 1, 'in den Vorrat gelegt');
    ohneAngebote(g);
    const a = Brett.notrufAnbieten(g, notrufEv(hex, 'havarie', 1));
    ok(!!a && typen(a.vorlage) === 'notruf,rettung,abschluss' && a.absicht.absicht === 'bergung' && V.liste(g).length === 0, 'der Notruf nimmt den Plan aus dem Vorrat: notruf, rettung, abschluss, Absicht bergung, Vorrat leer (' + (a ? typen(a.vorlage) : 'kein Angebot') + ')');
    ok(sl(g).aufrufe === 0 && sl(g).abenteuer.aufrufe === 0, 'kein Komponisten-Aufruf');
  }
});

// ---------------------------------------------------------------- (e2) Doppel-Dank (Befund aus dem FRE-03-Bericht: im Absichten-Modus kann ein Notruf-Plan aus dem Vorrat Katalog-Dank und abschluss_gelungen doppelt zeigen)
const RE_KAT = RE.KATALOG.filter((e) => e.art === 'notruf');
const OHNE_GEFAHR = RE_KAT.find((e) => !e.gefahr);
const P3TXT = fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'p3-texte.json'), 'utf8');
const txt = (k) => (P3TXT.match(new RegExp('"' + k + '":\\s*"([^"]+)"')) || [])[1];
const Sprung = require('../server/sim/sprung.js');
function kantenOeffnen(g, hex) {
  for (const e of Sektoren.kantenVon(hex)) {
    if (e.art === 'locked') g.explore.offenExtra.add(Sektoren.kanteId(e.a, e.b));
    else if (e.art === 'hidden' && e.key) g.explore.linksOpen.add(e.key);
  }
}
// Einen Takt-Notruf dieses Eintrags erzwingen (nur dieser Eintrag im Katalog, Zaehler auf der Schwelle, ein Tick) in einem Sektor des Besitzers; vorher(g) darf den Vorrat fuellen
function erzwingen(e, spielOpt, vorher) {
  const t = spiel(spielOpt), g = t.g;
  g.weltsim.zustand.flotten = [];
  Ruf.debug(g, ['rom', '30']);
  const b = (e.bedingungen.besitzer || ['rom'])[0];
  const kat = RE.KATALOG, kopie = kat.slice();
  for (const h of Object.keys(Sektoren.KARTE.hexe).filter((x) => Sektoren.spielbar(x) && !Sektoren.istLeerraum(x) && Sektoren.hatSzene(x) && (Besitz.besitzer(g, x) || 'frei') === b).sort()) {
    g.ship.scene = Sektoren.ortVonHex(h);
    g.weltsim.reise.offen = []; g.weltsim.reise.taktIds = []; g.weltsim.reise.takt = Math.round(RE.WERTE.takt_s * HZ) - 1;
    kantenOeffnen(g, h);
    if (vorher) vorher(g);
    kat.length = 0; kat.push(e);
    try { g.step(); } finally { kat.length = 0; kat.push(...kopie); }
    if (g.weltsim.reise.offen.length === 1 && g.weltsim.reise.offen[0].id === e.id) return { t, g, hex: h, o: g.weltsim.reise.offen[0] };
  }
  return null;
}
await section('(e2) Doppel-Dank: Plan aus dem Vorrat und Daten-Plan, Rettung gelungen: genau ein Katalog-Dank, kein abschluss_gelungen', () => {
  const bergungAbsicht = { format: 'absicht/1', absicht: 'bergung', titel: 'Notruf: Probeschiff', parameter: { text_key: 'notruf_standard' }, bezug: {}, bogen: { einsatz: 'Ein Schiff treibt havariert im All und ruft um Hilfe.', wendung: 'keine', preis: 'Ohne Hilfe bleibt das Schiff liegen.' }, ton: 'dringlich' };
  for (const wie of ['Daten-Plan', 'Plan aus dem Vorrat']) {
    const mitVorrat = wie !== 'Daten-Plan';
    const m = erzwingen(OHNE_GEFAHR, { env: Object.assign({}, ENV, mitVorrat ? { ABENTEUER_ABSICHTEN: '1' } : {}) }, mitVorrat ? (g) => { if (V.liste(g).length === 0) V.hinzufuegen(g, V.eintrag(g, { absicht: bergungAbsicht, art: BRETT.vorrat_art_notruf.wert }).eintrag); } : null);
    if (!m) { ok(false, `${wie}: Notruf erzwungen`); continue; }
    const { g, o } = m;
    const funk = []; const em = g.emit.bind(g); g.emit = (ev, d) => { if (ev === 'radio' && d && d.text) funk.push({ von: d.from, text: d.text }); return em(ev, d); };
    const a = P.notrufAngebote(Fz(g)).find((x) => x.notruf.marke === o.marke);
    ok(!!a && typen(a.vorlage) === 'notruf,rettung,abschluss', `${wie}: das Angebot ist eine Bergung (${a && typen(a.vorlage)})`);
    if (!a) continue;
    ok(!mitVorrat || (V.liste(g).length === 0 && a.absicht.parameter.text_key !== undefined && a.vorlage.landeplaetze[0].art === 'schiff'), `${wie}: ` + (mitVorrat ? 'der Eintrag kam aus dem Vorrat (Vorrat leer), der Plan stammt vom Inszenierer (Wrack)' : 'der Plan stammt aus den Daten'));
    ok(Brett.annehmen(g, 'a' + a.nr) === null, `${wie}: angenommen`);
    const f = Fz(g).liste.find((x) => x.vorlage === a.ref);
    Sprung.springeNach(g, Sektoren.ortVonHex(o.hex)); lauf(g, 3);
    for (let i = 0; i < 40 && !(f.beat === 1 && f.phase === 'laeuft'); i++) { Faden.taetigkeit(g, 'andocken'); lauf(g, 1); }
    ok(f.beat === 1 && f.phase === 'laeuft', `${wie}: nach der Ankunft laeuft die Rettung`);
    Faden.beatAusgang(g, f.id, 'gelungen'); lauf(g, 3);
    for (let i = 0; i < 20 && f.phase !== 'abgeschlossen'; i++) { Faden.taetigkeit(g, 'andocken'); lauf(g, 1); }
    const katDank = funk.filter((x) => x.von === OHNE_GEFAHR.sprecher && OHNE_GEFAHR.texte.dank.some((d) => x.text === d.replace(/\{ort\}/g, Sektoren.hexName(o.hex)).replace(/\{n\}/g, OHNE_GEFAHR.parameter.vorlauf_s)));
    const zeilen = (t) => funk.filter((x) => x.text === t);
    const gen = txt('abschluss_gelungen').replace('{name}', f.nsc.name);
    console.log(`  Messung ${wie}: ${funk.length} Funkzeilen, Katalog-Dank ${katDank.length}, NSC-Dank ${zeilen(txt('notruf_dank')).length}, abschluss_gelungen ${zeilen(gen).length}, notruf_abschluss ${zeilen(txt('notruf_abschluss')).length}`);
    ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', `${wie}: Faden gelungen`);
    ok(katDank.length === 1 && zeilen(txt('notruf_dank')).length === 0 && zeilen(gen).length === 0 && zeilen(txt('notruf_abschluss')).length === 1, `${wie}: genau ein Katalog-Dank, kein NSC-Dank, kein abschluss_gelungen, der Abschlusstext ist notruf_abschluss (einmal)`);
    ok(g.errors === 0 && aufrufe(g) === 0, `${wie}: 0 Fehler, 0 Komponisten-Aufrufe`);
  }
});

// ---------------------------------------------------------------- Rueckfall-Hilfen
// Ein Notruf-Angebot des Bretts (variante, Hex) im Rueckfall ohne Modell: annehmen, ankommen, laufen lassen bis zum Ende. -> { g, f, ... }
function rueckfall(o) {
  const T = spiel({ seed: o.seed }), g = T.g;
  const fehler = []; const ce = g.countError.bind(g); g.countError = (wo, e) => { fehler.push(wo + ': ' + (e && e.message)); return ce(wo, e); };
  const funk = []; const em = g.emit.bind(g); g.emit = (ev, d) => { if (ev === 'radio' && d && d.text) funk.push({ von: d.from, text: d.text }); return em(ev, d); };
  const hafen = Sektoren.hexVonOrt(g.ship.scene);
  const { mitSzene } = hexe();
  const ziel = mitSzene.find((h) => h !== hafen && AO.moeglicheArten(h).includes('wildnis') === o.planet && AO.moeglicheArten(h).includes('schiff'));
  const a = Brett.notrufAnbieten(g, notrufEv(ziel, o.variante, 1, hafen));
  if (!a) return { g, fehler, ziel, a: null };
  const r = Brett.annehmen(g, 'a' + a.nr);
  const f = Fz(g).liste.find((x) => x.vorlage === a.ref);
  const R = { g, f, a, ziel, hafen, fehler, funk, annehmen: r, orte: [], verlauf: [], beats: [], T };
  R.schritt = (dann) => {
    g.lageGrenze('andocken'); for (let k = 0; k < 20; k++) g.step();
    R.verlauf.push(f.beat + f.phase[0]);
    for (const [id, d] of Object.entries((g.landepunkte && g.landepunkte.dyn) || {})) if (AO.parse(id) && !R.orte.some((x) => x.id === id)) R.orte.push({ id, art: d.art, bauweise: d.bauweise, besitz: d.besitz });
    if (dann) dann();
  };
  return R;
}
const orteDa = (g) => Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).filter((id) => AO.parse(id));
const restlos = (g) => orteDa(g).length === 0 && Array.from((g.explore && g.explore.lpScan) || []).filter((i) => AO.parse(i)).length === 0 && Object.keys(g.aways || {}).filter((i) => AO.parse(i)).length === 0 && !AO.parse(g.away && g.away.map);

// ---------------------------------------------------------------- (f)
await section('(f) Rueckfall ohne Modell: Planet und Wrack, mehrere Seeds, Notruf > Rettung > Abschluss', () => {
  let laeufe = 0;
  for (const seed of [7, 11, 23]) {
    for (const planet of [true, false]) {
      const variante = VARIANTEN[(laeufe++) % 3];
      const tag = `Seed ${seed}, ${planet ? 'Planet' : 'Wrack'}, ${variante}`;
      const R = rueckfall({ seed, planet, variante });
      if (!R.a) { ok(false, tag + ': Angebot'); continue; }
      const { g, f } = R;
      ok(R.annehmen === null && f.phase === 'laeuft' && P.notrufBrettFaden(f) === true, tag + ': angenommen, Notruf-Faden laeuft');
      space.enterScene(g, Sektoren.ortVonHex(R.ziel), { docked: false });
      for (let i = 0; i < 120 && f.phase !== 'abgeschlossen'; i++) R.schritt();
      const ged = f.nsc.gedaechtnis.map((x) => x.ereignis);
      const art = planet ? 'wildnis' : 'schiff';
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && P.abenteuerLaufend(Fz(g)) === 0, `${tag}: der Faden endet im Rueckfall ohne Crew (Phase ${f.phase}, Ausgang ${f.ausgang && f.ausgang.art}), Verlauf ${Array.from(new Set(R.verlauf)).join(',')}`);
      ok(ged.includes('notruf_gelungen') && ged.includes('rettung_gescheitert') && ged.includes('abschluss_gescheitert') && !ged.includes('abschluss_gelungen'), `${tag}: Gedaechtnis ${ged.join(',')}`);
      ok(R.orte.length === 1 && R.orte[0].art === art, `${tag}: genau ein Ort entstand, Art ${R.orte[0] && R.orte[0].art} (erwartet ${art}), ein Abstieg`);
      ok(!planet ? R.orte.every((x) => x.bauweise === 'germanen') : true, `${tag}: ` + (planet ? 'Planet' : 'das Wrack im Raum baut germanisch (' + (R.orte[0] && R.orte[0].bauweise) + ')'));
      ok(restlos(g), `${tag}: Ort restlos weg (0 Orte, keine lpScan-Reste, kein Ort in aways, away.map nicht der Ort)`);
      ok(aufrufe(g) === 0 && g.errors === 0 && R.fehler.length === 0, `${tag}: 0 Komponisten-Aufrufe, g.errors ${g.errors}, gezaehlte Fehler ${R.fehler.length}${R.fehler.length ? ' (' + R.fehler[0] + ')' : ''}`);
      ok(R.funk.every((x) => !/\bA\d/.test(x.text)) && !R.funk.some((x) => x.text === RT.rettung_gelungen), `${tag}: ohne Crew kein Dank der Rettung (${R.funk.length} Funkzeilen)`);
    }
  }
});

await section('(f2) Notruf scheitert: die Verzweigung fuehrt auf den Abschluss, die Rettung entfaellt', () => {
  for (const seed of [7, 11]) {
    const R = rueckfall({ seed, planet: seed === 7, variante: 'piratenueberfall' });
    const { g, f } = R;
    ok(R.annehmen === null, `Seed ${seed}: angenommen`);
    // nie angekommen: die Frist des Beats notruf laeuft ab (Taetigkeiten)
    for (let i = 0; i < 40 && f.phase !== 'abgeschlossen'; i++) { R.schritt(); }
    const ged = f.nsc.gedaechtnis.map((x) => x.ereignis);
    ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', `Seed ${seed}: der Faden endet gescheitert (Phase ${f.phase}), Verlauf ${Array.from(new Set(R.verlauf)).join(',')}`);
    ok(ged.includes('notruf_gescheitert') && !ged.some((x) => /^rettung_/.test(x)) && ged.includes('abschluss_gescheitert'), `Seed ${seed}: Gedaechtnis ${ged.join(',')}: keine Rettung gespielt`);
    ok(R.orte.length === 0 && restlos(g) && g.errors === 0 && R.fehler.length === 0 && aufrufe(g) === 0, `Seed ${seed}: kein Ort entstanden, 0 Fehler, 0 Komponisten-Aufrufe`);
  }
});

await section('(f3) Rettung gelungen: der Abschluss gelingt nur dann (Erfolg ist die Rettung, nicht die Ankunft)', () => {
  const R = rueckfall({ seed: 7, planet: false, variante: 'havarie' });
  const { g, f } = R;
  space.enterScene(g, Sektoren.ortVonHex(R.ziel), { docked: false });
  for (let i = 0; i < 60 && !(f.beat === 1 && f.phase === 'laeuft'); i++) R.schritt();
  ok(f.beat === 1 && f.phase === 'laeuft' && FD.vorlage(f.vorlage).beats[1].typ === 'rettung', 'die Rettung laeuft (Beat 1)');
  ok(orteDa(g).length === 1, 'der Ort steht (ein Abstieg)');
  const e = Faden.beatAusgang(g, f.id, 'gelungen');
  ok(e.ok === true && f.nsc.gedaechtnis.some((x) => x.ereignis === 'rettung_gelungen'), 'Rettung gelungen (Gedaechtnis rettung_gelungen)');
  for (let i = 0; i < 20 && f.phase !== 'abgeschlossen'; i++) R.schritt();
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', `der Abschluss gelingt (Ausgang ${f.ausgang && f.ausgang.art})`);
  ok(restlos(g) && g.errors === 0 && R.fehler.length === 0 && aufrufe(g) === 0, 'Ort restlos weg, 0 Fehler, 0 Komponisten-Aufrufe');
  // Gegenprobe zum Erfolg: nur die Ankunft (notruf_gelungen) ohne Rettung ist kein Erfolg
  const R2 = rueckfall({ seed: 11, planet: false, variante: 'havarie' });
  space.enterScene(R2.g, Sektoren.ortVonHex(R2.ziel), { docked: false });
  for (let i = 0; i < 120 && R2.f.phase !== 'abgeschlossen'; i++) R2.schritt();
  ok(R2.f.ausgang.art === 'gescheitert' && R2.f.nsc.gedaechtnis.some((x) => x.ereignis === 'notruf_gelungen'), 'Gegenprobe: die Ankunft allein (notruf_gelungen) macht den Abschluss nicht gelungen');
});

await section('(f4) Im Stich gelassen waehrend der Gefahr: die Rettung entfaellt, der Abschluss folgt gescheitert', () => {
  const R = rueckfall({ seed: 7, planet: false, variante: 'piratenueberfall' });
  const { g, f } = R;
  space.enterScene(g, Sektoren.ortVonHex(R.ziel), { docked: false });
  sl(g).rueckfallBetrieb = false; sl(g).mode = 'mock';   // ein Modell steuert die Faeden: der Rueckfall startet den Beat rettung nicht von selbst (wie im Test des Bretts)
  for (let i = 0; i < 30 && !(f.beat === 1); i++) R.schritt();   // Ankunft: Beat notruf gelungen, die Rettung steht an
  sl(g).rueckfallBetrieb = true; sl(g).mode = 'off';
  const alt = f.beat;
  ok(alt === 1 && f.phase === 'wartet' && f.notruf && typeof f.notruf.marke === 'string', 'Ausgangslage: der Faden wartet auf den Beat rettung');
  const FP3 = require('../server/sim/faden-p3.js');
  ok(FP3.notrufImStich(g, f.notruf.marke) === true && f.beat === FD.vorlage(f.vorlage).beats.length - 1, `notrufImStich springt zum Abschluss (Beat ${f.beat} von ${FD.vorlage(f.vorlage).beats.length})`);
  for (let i = 0; i < 10 && f.phase !== 'abgeschlossen'; i++) R.schritt();
  const ged = f.nsc.gedaechtnis.map((x) => x.ereignis);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && !ged.some((x) => /^rettung_/.test(x)) && R.orte.length === 0, `Faden gescheitert ohne Rettung und ohne Ort (Gedaechtnis ${ged.join(',')})`);
});

// ---------------------------------------------------------------- (g)
await section('(g) Brett-Schritte, Grep-Test', () => {
  const T = spiel(), g = T.g;
  const { mitSzene } = hexe();
  ohneAngebote(g);
  const a = Brett.notrufAnbieten(g, notrufEv(mitSzene[0], 'havarie', 1));
  const v = Brett.vorschau(a.vorlage);
  ok(v.schritte.length === 3 && v.schritte.every((s) => typeof s.text === 'string' && s.text.length > 2), 'Vorschau: drei Schritte mit Klartext (' + v.schritte.map((s) => s.text).join(' > ') + ')');
  ok(v.schritte[1].text === BRETT.schritte ? true : v.schritte[1].text === lies('content', 'faeden', 'abenteuer-brett.json').schritte.rettung.text, 'Schritt der Rettung nennt den Klartext aus den Daten');
  ok(v.gefahr === false || v.gefahr === true, 'Vorschau liefert eine Gefahr-Angabe');
  const snap = Brett.snapshot(g), s = snap && snap.angebote.find((x) => x.id === 'a' + a.nr);
  ok(!!s && s.notruf === 1 && s.titel.startsWith('Notruf'), 'das Angebot steht im Snapshot (Titel, notruf 1)');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'abenteuer-brett.js'), 'utf8');
  const namen = Object.keys(BODEN.besetzung.wert).concat(Object.values(BODEN.besetzung.wert).map((e) => e.fraktion).filter(Boolean));
  const treffer = namen.filter((k) => new RegExp("['\"`]" + k + "['\"`]").test(src));
  ok(treffer.length === 0, 'abenteuer-brett.js nennt keinen Besetzungsschluessel und keine Fraktion (' + (treffer.join(',') || 'keiner') + ')');
  ok(!/\b(12|16|3)\b\s*[;,)]/.test(src.split('function notrufPlanBauen')[1].split('function notrufAnbieten')[0]), 'notrufPlanBauen enthaelt keine Zahl');
  const p3 = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-p3.js'), 'utf8');
  ok(!/shared[\\/]charakter/.test(src + p3), 'kein Pfad shared/charakter in den geaenderten Dateien');
});

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log('FEHLER: ' + fails); process.exit(1); }
console.log('test-notruf-bergung: alles ok');
})().catch((e) => { console.error(e); process.exit(2); });
