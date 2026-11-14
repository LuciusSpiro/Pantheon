'use strict';
// SPL-02 C: der echte Katalog der Absichten (content/faeden/absichten.json, nur DATEN) und der Weg Absicht -> Inszenierer -> Plan fuer jeden Eintrag.
// Die Erwartungen stehen hier selbst (von Hand gerechnet an einer eigenen Welt: Crew bei Ostia Nova 0305, Hoehlen bei Vulcania 0205 und Porta Australis 0405 je einen Sprung entfernt, drei NSC mit Namen),
// nie aus dem Produktivcode abgeleitet. Welten wie in tools/test-inszenierer.js: `neu` ohne Vorgeschichte, `welt` mit drei abgeschlossenen Abenteuern (Quintus Varro, Titus Calder, Gaius Fabrin).
// Geprueft wird: Katalog und Daten stimmig (Struktur, Rezepte, jede Stufe und Wendung ergibt einen Plan, den der Expander annimmt) · prompt_zeile (Laenge, Name, Parameter, Bezug, Wendung; Summe gegen den Beat-Katalog) ·
// jede Absicht mit Standardparametern: gueltiger Plan oder ein dokumentiertes Nein · Pilot Rache (Quintus bis zum Angebot, zur Szene, Wendungen, Stufen) · Pilot Bergbau (Huelle: Nein mit Gegenvorschlag,
// angenommen: gueltiger Plan) · je Beat-Familie die Beat-Folge mit Parametern, Wendungen und Skalierung nach Stufe · die sechs Rueckfall-Plaene aus anschluss.json (gleicher Plan, gleiche Vorlage, gleiches Nein) ·
// Vielfalt · der Spielleiter-Prompt liest den Katalog nicht · kein Absichts- oder Beat-Name im Code.
// Aufruf: node tools/test-absichten-katalog.js [begriff ...]        (npm run test:absichten-katalog)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const CONFIG = require('../shared/config.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Bauplan = require('../server/sim/faden-bauplan.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');
const AP = require('../server/sim/absicht-pruefer.js');
const INS = require('../server/sim/inszenierer.js');
const Ziel = require('../server/sim/abenteuer-ziel.js');
const V = require('../server/sim/absicht-verhandlung.js');
const Lager = require('../server/sim/fracht.js');   // BEA-01 C2: Ladung im Frachtraum (Bedingung ladung_mindestens)
const Modul = require('../server/sim/module.js');
const Ausbau = require('../server/sim/ausbau.js');

const { D, Faden, F } = X;
const C = INS.CODES;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];

const KAT = lies('content/faeden/absichten.json');
const ANSCHLUSS = lies('content/faeden/anschluss.json');
const EINTRAEGE = Object.entries(KAT.absichten);
const NAMEN_KAT = Object.keys(KAT.absichten);

// ---------------------------------------------------------------- Welt (wie test-inszenierer.js)
function neu(seed) {
  const t = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  return t;
}
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats }, o || {});
const einzel = (typ, i) => plan([{ typ }, { typ: 'abschluss' }], { titel: typ + ' ' + i, anlass: 'Probeanlass ' + typ + ' Nummer ' + i + ' ohne Namen' });
const zust = (g) => Faden.zustandVon(g);
function beende(g, f, ausgang) {
  const v = D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) {
    f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 };
    Faden.beatAusgang(g, f.id, ausgang);
  }
}
function spiele(g, p) {
  const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  beende(g, r.faden, 'gelungen');
  return r.faden;
}
function nenne(g, f, name) {
  f.nsc.name = name; f.nsc.fraktion = 'rom';
  const e = zust(g).kanon.find((x) => x.f === f.id);
  e.name = name; e.volk = 'rom';
}
function welt(seed) {   // drei abgeschlossene Abenteuer: A (Quintus Varro), B (Titus Calder), C (Gaius Fabrin, die Hauptfigur des letzten)
  const t = neu(seed), g = t.g;
  const typen = ['notruf', 'spontanhilfe', 'fracht'], namen = ['Quintus Varro', 'Titus Calder', 'Gaius Fabrin'];
  t.f = typen.map((typ, i) => { const f = spiele(g, einzel(typ, i + 1)); nenne(g, f, namen[i]); return f; });
  return t;
}
const verstimmt = (f, haltung) => { f.nsc.status = 'aktiv'; f.nsc.haltung = haltung === undefined ? -2 : haltung; };
const stufe = (g, ruf, schiff) => { g.weltsim.ruf.rom = ruf; g.ship.stufe = schiff || 0; };   // 0: miles/0, 35 = centurio (Stufe 1), 200 und Schiff 3 = Stufe 2
const posten = (g, hex) => {
  Object.assign(g.weltsim.zustand.hexe[hex], { besitzer: 'ger', posten: true, garnison: 4, anspruch: {} });
  if (g.weltBesitz && g.weltBesitz.hexe[hex]) g.weltBesitz.hexe[hex] = { besitzer: 'ger', posten: true };
};

// BEA-01 C2: ein Frachtraum mit einem Platz Ladung (Fracht, nicht verkaufbar zu pruefen: nur der Stand des Frachtraums zaehlt)
const beladen = (g) => {
  Ausbau.setStufe(g, 3); g.ship.module = [{ id: 'frachtraum', raum: 1, an: true, lauf: true }]; Modul.verteilungSetzen(g);
  g.fracht.lager = []; g.fracht.draussen = []; g.fracht.halt = null;
  const r = Lager.lagerAufnehmen(g, { art: 'fracht', quelle: 'debug' }); if (!r.ok) throw new Error('Einlagern: ' + r.text);
};
const TEXT = { titel: 'Eine Probe Absicht', einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', preis: 'Ein Preis ohne Namen fuer den Test.' };
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const mitW = (w) => ({ bogen: { einsatz: TEXT.einsatz, wendung: w, preis: TEXT.preis } });
const standardAbsicht = (name) => { const s = KAT.absichten[name].standard; return { format: 'absicht/1', absicht: name, titel: s.titel, parameter: {}, bezug: {}, bogen: klon(s.bogen), ton: s.ton || KAT.absichten[name].ton_standard }; };
const folge = (r) => r.plan.beats.map((b) => b.typ).join();
const codes = (r) => r.fehler.map((x) => x.code);
const fe = (r, code) => r.fehler.find((x) => x.code === code);
const ins = (g, a, k) => INS.inszeniere(g, a, k || KAT);

// ======================================================================
section('Katalog und Daten stimmig', () => {
  ok(KAT.format === 'absichten-katalog/1' && NAMEN_KAT.length >= 14, 'der Katalog hat Eintraege: ' + NAMEN_KAT.length + ' Absichten');
  ok(AP.katalogFehler(KAT).length === 0, 'katalogFehler (Strukturregeln, Paket A) ist leer (' + AP.katalogFehler(KAT).join(' | ').slice(0, 200) + ')');
  ok(AP.katalogFehler().length === 0 && INS.katalogFehler().length === 0, 'auch der Standardkatalog (katalogStandard) besteht Struktur und Rezepte (Paket A und B)');
  ok(INS.katalogFehler(KAT).length === 0, 'katalogFehler des Inszenierers ist leer: jedes Rezept, jede Stufe und jede Wendung ergibt einen Plan, den der Expander annimmt (' + INS.katalogFehler(KAT).join(' | ').slice(0, 200) + ')');
  ok(INS.werteFehler().length === 0 && Bauplan.katalogFehler().length === 0, 'die Daten des Inszenierers und des Beat-Katalogs sind stimmig');
  ok(EINTRAEGE.every(([, e]) => e.inszenierung && typeof e.zweck === 'string' && Array.isArray(e.wendungen) && e.wendungen.includes('keine') && typeof e.ton_standard === 'string'), 'jeder Eintrag: Rezept, Zweck, Wendungen mit keine, Standardton');
  ok(KAT.absichten.rache && KAT.absichten.bergbau, 'die Piloten rache und bergbau stehen im Katalog');
  const schlecht = (mut, re, was) => { const k = klon(KAT); mut(k.absichten); const f = AP.katalogFehler(k).concat(INS.katalogFehler(k)); ok(f.some((x) => re.test(x)), 'Strukturregel: ' + was + ' (' + (f.find((x) => re.test(x)) || 'kein Fehler').slice(0, 90) + ')'); };
  schlecht((a) => { a.geruecht.prompt_zeile = 'geruecht: ' + 'x'.repeat(500); }, /prompt_zeile hat/, 'prompt_zeile hoechstens prompt_zeile_max');
  schlecht((a) => { a.geruecht.prompt_zeile = 'spur: eine andere Absicht'; }, /der mit "geruecht:" beginnt/, 'prompt_zeile beginnt mit dem Namen');
  schlecht((a) => { a.geruecht.standard = { titel: 3 }; }, /standard ist/, 'standard hat die Form { titel, bogen, ton }');
  schlecht((a) => { a.geruecht._hinweis = 3; }, /_hinweis/, '_hinweis ist ein Text');
  schlecht((a) => { a.rache.inszenierung.skelett.beats[0].typ = 'wiedersehen'; }, /kandidat rache/, 'der Kandidaten-Typ von rache ist der erste Beat');
  schlecht((a) => { delete a.konvoi.inszenierung.wendungen.nachschub; }, /nicht im Rezept/, 'jede Wendung hat ein Rezept');
});

section('prompt_zeile: die Katalogzeile fuer den Prompt (Vorbereitung Paket E)', () => {
  const max = KAT.werte.prompt_zeile_max.wert, ziel = KAT.werte.prompt_summe_ziel.wert;
  ok(EINTRAEGE.every(([, e]) => typeof e.prompt_zeile === 'string'), 'jeder Eintrag hat eine prompt_zeile');
  ok(EINTRAEGE.every(([name, e]) => e.prompt_zeile.startsWith(name + ':') && e.prompt_zeile.length <= max && e.prompt_zeile.length >= 40 && !/\n/.test(e.prompt_zeile)), 'jede Zeile beginnt mit "<name>:", hat 40 bis ' + max + ' Zeichen (prompt_zeile_max aus den Daten), eine Zeile');
  const luecken = [];
  for (const [name, e] of EINTRAEGE) {
    const z = e.prompt_zeile;
    for (const p of Object.keys(e.parameter || {})) if (!z.includes(p)) luecken.push(name + ': Parameter ' + p);
    for (const b of e.bezug || []) if (!z.includes('Bezug ' + b.name)) luecken.push(name + ': Bezug ' + b.name);
    for (const w of (e.wendungen || []).filter((x) => x !== 'keine')) if (!z.includes(w)) luecken.push(name + ': Wendung ' + w);
    for (const [p, d] of Object.entries(e.parameter || {})) if (d.art === 'liste') for (const w of d.erlaubt) if (!z.includes(w)) luecken.push(name + ': Wert ' + p + '=' + w);
  }
  ok(luecken.length === 0, 'jede Zeile nennt jeden Parameter (mit allen Werten), jeden Bezug und jede Wendung ihres Eintrags (Luecken: ' + luecken.join('; ') + ')');
  ok(!EINTRAEGE.some(([, e]) => /[{}]|\n/.test(e.prompt_zeile)), 'keine Platzhalter und keine Zeilenumbrueche in den Zeilen');
  const summe = EINTRAEGE.reduce((s, [, e]) => s + e.prompt_zeile.length, 0);
  const mitUmbruch = summe + EINTRAEGE.length - 1;   // eine Zeile je Absicht, Zeilenumbrueche dazwischen
  const beats = Prompt.katalogText().length;
  console.log(`  info Summe der prompt_zeile: ${summe} Zeichen (${mitUmbruch} mit Zeilenumbruechen), ${EINTRAEGE.length} Zeilen, laengste ${Math.max(...EINTRAEGE.map(([, e]) => e.prompt_zeile.length))}; Beat-Katalog im Prompt heute: ${beats} Zeichen; Zielgroesse ${ziel}`);
  ok(mitUmbruch <= ziel, 'Summe ' + mitUmbruch + ' <= Zielgroesse ' + ziel + ' (prompt_summe_ziel aus den Daten; Hochrechnung der Erkundung 4000 bis 4500)');
  ok(mitUmbruch < beats, 'der Absichts-Katalog ist kleiner als der heutige Beat-Katalog (' + mitUmbruch + ' < ' + beats + ')');
});

section('Standardparametrierung: jede Absicht ergibt einen gueltigen Plan oder ein dokumentiertes Nein', () => {
  // Erwartetes Nein je Absicht (Welt ohne Vorgeschichte, ohne Posten): der Grund steht in den Daten oder in der Welt
  const ZIEL_IM_UMKREIS = ['rettung', 'lieferung', 'falscher_haendler', 'notruf', 'bergung'];   // BEA-02 C: bergung dazu; FRE-02 A2: Ortsregel ziel_im_umkreis (Beschluss der Daten, nicht des Codes)
  const NEIN = {
    rache: [C.BEZUG_FEHLT, 'Pflichtbezug: ohne grollenden NSC keine Rache'],
    bergbau: [C.NICHT_AUSDRUECKBAR, 'Abbau-Huelle (Standardziel abbau)'],
    wiedersehen: [C.WELT_BEDINGUNG, 'kein Kandidat (WIEDERHOLUNG_NSC): ohne frueheren NSC kein Wiedersehen'],
    sabotage: [C.WELT_BEDINGUNG, 'kein germanischer Posten in Reichweite (LAGE_ZIEL_FEHLT)'],
    forderung: [C.WELT_BEDINGUNG, 'leerer Frachtraum und Rang Miles (BEA-01 C2: Bedingungen ladung_mindestens und rang_mindestens)'],
  };
  for (const [name, e] of EINTRAEGE) {
    const g = neu(11).g;
    const a = e.standard ? standardAbsicht(name) : ab(name, { ton: e.ton_standard });
    const r = ins(g, a);
    if (NEIN[name]) {
      ok(!r.ok && r.fehler.some((f) => f.code === NEIN[name][0]), name + ': Nein ' + NEIN[name][0] + ' (' + NEIN[name][1] + ')' + (r.ok ? ' [kam aber ok]' : ' [' + codes(r).join() + ']'));
    } else {
      // FRE-02 A2: vier Rezepte spielen an einem Ziel im Umkreis (1 bis Radius Spruenge, nie der Hafen), die uebrigen im Sektor der Crew
      const ortOk = ZIEL_IM_UMKREIS.includes(name) ? r.ok === true && r.hex !== '0305' && Ziel.kandidaten(g, '0305').includes(r.hex) : r.ok === true && r.hex === '0305';
      ok(ortOk && r.plan.format === 'faden-bauplan/1' && Bauplan.pruefe(r.plan).ok && Bauplan.expandiere(r.plan).ok, name + ': gueltiger Plan (' + (r.ok ? folge(r) : codes(r).join() + ' ' + r.fehler[0].grund.slice(0, 80)) + ')');
    }
  }
  // Die Nein-Faelle gehen bei erfuellter Welt durch (ausser der Huelle)
  const t = welt(11), g = t.g;
  verstimmt(t.f[0]);
  posten(g, '0703');
  const sab = ins(g, standardAbsicht('sabotage'));
  ok(sab.ok && folge(sab) === 'sabotage,abschluss', 'sabotage mit einem germanischen Posten bei 0703: gueltiger Plan');
  const wi = ins(g, standardAbsicht('wiedersehen'));
  ok(wi.ok && folge(wi) === 'wiedersehen,abschluss' && wi.bezug === undefined && wi.locker === undefined, 'wiedersehen mit frueheren NSC: gueltiger Plan, ohne Bezug (das Brett waehlt) und ohne locker');
  const ra = ins(g, ab('rache', { bezug: { nsc: 'Quintus Varro' } }));
  ok(ra.ok && folge(ra) === 'rache,abschluss', 'rache mit Quintus Varro (grollt): gueltiger Plan');
});

section('Pilot Rache: Quintus bis zum Angebot, zur Szene und die Wendungen', () => {
  const t = welt(11), g = t.g;
  const [q, ti, ga] = t.f;
  verstimmt(q); verstimmt(ga);
  const RA = (o) => ab('rache', Object.assign({ bezug: { nsc: 'Quintus Varro' }, ton: 'bitter' }, o || {}));
  const r = ins(g, RA());
  ok(r.ok && folge(r) === 'rache,abschluss' && r.hex === '0305' && r.bezug.nsc === 'Quintus Varro' && r.locker === true, 'Stellung: rache, abschluss am Ort der Crew, Bezug Quintus Varro, locker (Fortsetzung)');
  ok(Bauplan.pruefe(r.plan).ok && Bauplan.expandiere(r.plan).vorlage.nsc.status === 'feindlich', 'der Plan besteht Expander und Pruefer; die Vorlage startet den NSC feindlich');
  const v = ins(g, RA(mitW('verfolgung')));
  ok(v.ok && folge(v) === 'rache,verfolgung,abschluss' && v.notizen.some((x) => /Wendung verfolgung/.test(x)), 'Wendung verfolgung: rache, verfolgung, abschluss');
  const w = ins(g, RA(mitW('zweite_welle')));
  ok(w.ok && folge(w) === 'rache,raumschlacht,abschluss', 'Wendung zweite_welle (Stufe 0): rache, raumschlacht, abschluss');
  ok(!ins(g, RA({ bezug: {} })).ok && fe(ins(g, RA({ bezug: {} })), C.BEZUG_FEHLT), 'ohne Bezug: BEZUG_FEHLT (Pflicht)');
  const titus = ins(g, RA({ bezug: { nsc: 'Titus Calder' } }));
  ok(!titus.ok && codes(titus).join() === C.BEZUG_UNBEKANNT, 'Titus Calder (verbuendet) ist kein Kandidat fuer eine Rache: BEZUG_UNBEKANNT mit Gegenvorschlag ' + (titus.ok ? '' : JSON.stringify(titus.fehler[0].gegenvorschlag && titus.fehler[0].gegenvorschlag.patch)));
  ti.nsc.status = 'verbuendet';
  const unb = ins(g, RA({ bezug: { nsc: 'Quintus' } }));
  ok(!unb.ok && /BEZUG/.test(codes(unb).join()), 'der Vorname allein gilt nicht');
  verstimmt(q, 1);
  const gut = ins(g, RA());
  ok(!gut.ok && codes(gut).join() === C.WELT_BEDINGUNG && /Haltung 1/.test(gut.fehler[0].grund) && /wohlgesinnt/.test(gut.fehler[0].grund), 'Haltung 1: wer der Crew wohlgesinnt ist, stellt sie nicht (WELT_BEDINGUNG mit Grund aus den Daten)');
  verstimmt(q, -2);
  // Fortsetzung: die Hauptfigur des letzten Abenteuers
  const fo = ins(g, RA({ bezug: { nsc: 'Gaius Fabrin' } }));
  ok(fo.ok && fo.locker === true, 'die Hauptfigur des letzten Abenteuers (Gaius Fabrin): als Fortsetzung erlaubt (locker)');
  const streng = klon(KAT); streng.absichten.rache.fortsetzung = false;
  const zf = ins(g, RA({ bezug: { nsc: 'Gaius Fabrin' } }), streng);
  ok(!zf.ok && codes(zf).join() === C.BEZUG_ZU_FRISCH, 'ohne fortsetzung im Katalog: BEZUG_ZU_FRISCH (die Eigenschaft kommt aus den Daten)');
  // durch das Spiel: Angebot, Oeffnen mit dem NSC, Szene
  const an = INS.anbietenAusAbsicht(g, RA({ bezug: { nsc: 'Gaius Fabrin' } }), KAT);
  ok(an.ok && an.angebot.bezug.nsc === 'Gaius Fabrin' && an.angebot.locker === true && an.angebot.hex === '0305', 'Angebot am Brett: bezug und locker (Fortsetzung)');
  const kand = Faden.wiedersehenKandidaten(g, an.angebot.vorlage);
  const id = kand.find((x) => Faden.nscVon(g, x).name === 'Gaius Fabrin');
  const o = Faden.abenteuerOeffnen(g, an.angebot.nr, { nsc_von: id });
  ok(o.ok && o.faden.nsc.name === 'Gaius Fabrin' && o.faden.nsc.status === 'feindlich' && o.faden.nsc.haltung === -2, 'geoeffnet: derselbe NSC kehrt zurueck, Zustand feindlich, Haltung bleibt');
  const funk = []; const orig = g.emit.bind(g); g.emit = (k, d) => { if (k === 'radio' && d && d.text) funk.push(d.text); return orig(k, d); };
  for (let i = 0; i < 5; i++) g.lageGrenze('andocken');
  const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0;
  Space.enterScene(g, Sektoren.ortVonHex('0305'), {});
  const wr = Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: o.faden.id, beat: D.vorlage(o.faden.vorlage).beats[0].id });
  for (let i = 0; i < Math.round(14 * CONFIG.tickHz); i++) g.step();
  ok(wr.ok && g.fadenSzene && g.fadenSzene.art === 'raumschlacht' && g.space.enemies.length > 0 && funk.some((x) => /germanische Schiffe/.test(x)), 'der Beat startet die Szene der Raumschlacht (Vorwarnung, Gegner): ohne Codeaenderung an der Fadenmaschine');
  // Verhandlung mit dem Inszenierer: ein Nein (Haltung) ist endgueltig nach einer Runde, wenn der Patch nichts aendert
  const t2 = welt(11); verstimmt(t2.f[0], 1);
  const vh = V.verhandlungStart(t2.g, RA(), KAT);
  ok(vh.stand === 'offen' && /WELT_BEDINGUNG/.test(vh.text), 'Verhandlung: das Nein der Welt kommt als Klartext (offen)');
  // Stufen: Rang und Schiff
  const t3 = welt(11); verstimmt(t3.f[0]);
  stufe(t3.g, 35, 0);
  const s1 = ins(t3.g, RA());
  ok(s1.ok && folge(s1) === 'rache,raumschlacht,abschluss' && s1.notizen.some((x) => /Stufe 1/.test(x)), 'Stufe 1 (Rang centurio): eine Schlacht mehr hinter der Stellung');
  stufe(t3.g, 200, 3);
  const s2 = ins(t3.g, RA(mitW('zweite_welle')));
  ok(s2.ok && folge(s2) === 'rache,raumschlacht,raumschlacht,raumschlacht,abschluss', 'Stufe 2 (legat, Schiff 3) mit zweite_welle: rache und drei Schlachten (zwei aus der Wendung, eine aus der Stufe)');
  stufe(t3.g, 0, 0);
});

section('Pilot Bergbau: Huelle mit ehrlichem Nein, spielbar nur als Lieferung', () => {
  const g = welt(11).g;
  const B0 = KAT.absichten.bergbau;
  ok(/BEA-02/.test(B0._hinweis) && /AST-01/.test(B0._hinweis) && /SPL-01 d/.test(B0._hinweis) && /LAD-01/.test(B0._hinweis) && /HUELLE/.test(B0._hinweis), 'der _hinweis des Eintrags nennt BEA-02, AST-01, SPL-01 d und LAD-01 und dass es eine Huelle ist');
  ok(B0.parameter.ziel.standard === 'abbau' && B0.inszenierung.nicht_ausdrueckbar.length === 1 && B0.inszenierung.nicht_ausdrueckbar[0].wenn.ist === 'abbau', 'das Abbau-Ziel steht in nicht_ausdrueckbar (Daten), Standardziel ist abbau');
  ok(!/abbau/i.test(B0.inszenierung.anlass_vorlage) && !/abbau/i.test(JSON.stringify(B0.inszenierung.skelett)) && /gefoerdert wird nicht/.test(B0.inszenierung.anlass_vorlage), 'der Standard-Anlass und das Skelett taeuschen keinen Abbau vor (der Anlass sagt: gefoerdert wird nicht)');
  const r = ins(g, ab('bergbau', { titel: 'Erz von der Ader', bogen: { einsatz: 'Ein Auftraggeber braucht Erz von einer Ader in der Hoehle.', wendung: 'keine', preis: 'Ohne Erz steht seine Schmiede still.' } }));
  ok(!r.ok && r.fehler.length === 1 && r.fehler[0].code === C.NICHT_AUSDRUECKBAR && r.fehler[0].feld === 'parameter.ziel' && /kein Abbau-Beat/.test(r.fehler[0].grund), 'Standardziel abbau: NICHT_AUSDRUECKBAR, Grund "kein Abbau-Beat"');
  const gv = r.fehler[0].gegenvorschlag;
  ok(gv && gv.patch.length === 1 && gv.patch[0].feld === 'parameter.ziel' && gv.patch[0].wert === 'lieferung' && /ohne Abbau/.test(gv.text), 'Gegenvorschlag: ziel lieferung, ehrlich benannt (ohne Abbau)');
  const alle = ['keine', 'hinterhalt'].map((w) => ins(g, ab('bergbau', mitW(w), { parameter: { ziel: 'abbau' } })));
  ok(alle.every((x) => !x.ok && codes(x).join() === C.NICHT_AUSDRUECKBAR), 'auch mit Wendung bleibt abbau ein Nein');
  const v = V.verhandlungStart(g, ab('bergbau'), KAT);
  ok(v.stand === 'offen' && /NICHT_AUSDRUECKBAR/.test(v.text) && /Abbau-Beat/.test(v.text) && /Patch:/.test(v.text), 'Verhandlung: das Nein kommt als Klartext mit Grund und Patch');
  const v2 = V.verhandlungAntwort(g, v, AP.gegenvorschlagPatch(v.ergebnis), KAT);
  ok(v2.stand === 'angenommen' && v2.inszenierung && v2.inszenierung.ok && folge(v2.inszenierung) === 'bitte,fracht,abschluss' && v2.inszenierung.hex === '0205', 'der angenommene Patch: bitte, fracht, abschluss bei Vulcania 0205 (ein Sprung)');
  const p = v2.inszenierung.plan;
  ok(p.landeplaetze.length === 1 && p.landeplaetze[0].art === 'hoehle' && p.landeplaetze[0].name === 'Erzader' && p.beats[0].parameter.landeplatz === p.landeplaetze[0].id && p.beats[1].parameter.ware === 'erz', 'Plan: Landeplatz Erzader (Hoehle), Ware erz aus dem Parameter');
  ok(Bauplan.pruefe(p).ok && !p.beats.some((b) => /abbau/i.test(b.typ)), 'der Plan besteht Expander und Pruefer und enthaelt keinen Abbau');
  const lief = ins(g, ab('bergbau', { parameter: { ziel: 'lieferung', ware: 'fracht_kiste', reichweite: 1 }, bogen: { einsatz: 'Ein Auftraggeber braucht eine Kiste von der Ader.', wendung: 'hinterhalt', preis: 'Ohne die Kiste bleibt sein Schiff am Boden.' } }));
  ok(lief.ok && folge(lief) === 'bitte,raumschlacht,fracht,abschluss' && lief.plan.beats[2].parameter.ware === 'fracht_kiste', 'lieferung mit Wendung hinterhalt: bitte, raumschlacht, fracht, abschluss');
  const fern = ins(g, ab('bergbau', { parameter: { ziel: 'lieferung', reichweite: 0 } }));
  ok(!fern.ok && codes(fern).join() === C.ORT_KEIN_ZIEL && fern.fehler[0].gegenvorschlag.patch[0].wert === 1, 'lieferung mit reichweite 0: ORT_KEIN_ZIEL, Gegenvorschlag Vulcania (reichweite 1)');
  const ank = INS.anbietenAusAbsicht(g, ab('bergbau', { parameter: { ziel: 'lieferung' } }), KAT);
  ok(ank.ok && ank.angebot.hex === '0205', 'das Angebot am Brett liegt bei Vulcania');
});

section('Je Beat-Familie: Beat-Folge, Parameter, Wendungen (Stufe 0)', () => {
  const t = welt(11), g = t.g;
  const [q] = t.f; verstimmt(q);
  posten(g, '0703');
  const F0 = (name, o, soll, was, welt0) => { const r = ins(welt0 || g, ab(name, o)); ok(r.ok && folge(r) === soll, name + ' ' + (was || '') + ': ' + soll + (r.ok ? '' : ' [' + codes(r).join() + ': ' + r.fehler[0].grund.slice(0, 90) + ']')); return r; };
  const beatPar = (r, typ, k) => (r.plan.beats.find((b) => b.typ === typ) || { parameter: {} }).parameter[k];
  let r;
  r = F0('geruecht', {}, 'geruecht,abschluss', '(standard)'); ok(beatPar(r, 'geruecht', 'text_key') === 'geruecht_standard', 'geruecht: text_key aus dem Standard');
  r = F0('geruecht', { parameter: { text_key: 'geruecht_handel' } }, 'geruecht,abschluss'); ok(beatPar(r, 'geruecht', 'text_key') === 'geruecht_handel', 'geruecht: text_key geruecht_handel');
  F0('geruecht', mitW('falle'), 'geruecht,raumschlacht,abschluss', 'falle');
  r = F0('spur', { parameter: { spur: 'fundort' } }, 'spur,abschluss'); ok(beatPar(r, 'spur', 'spur') === 'fundort', 'spur: Parameter fundort');
  F0('spur', mitW('flucht'), 'spur,verfolgung,abschluss', 'flucht');
  F0('spur', mitW('ueberfall'), 'spur,raumschlacht,abschluss', 'ueberfall');
  r = F0('wiedersehen', { bezug: { nsc: 'Quintus Varro' } }, 'wiedersehen,abschluss', 'mit Bezug'); ok(r.bezug && r.bezug.nsc === 'Quintus Varro' && r.locker === undefined, 'wiedersehen: Bezug gesetzt, nicht locker (keine Fortsetzung)');
  F0('wiedersehen', mitW('neue_spur'), 'wiedersehen,spur,abschluss', 'neue_spur');
  F0('wiedersehen', mitW('ueberfall'), 'wiedersehen,raumschlacht,abschluss', 'ueberfall');
  const zuFrisch = ins(g, ab('wiedersehen', { bezug: { nsc: 'Gaius Fabrin' } }));
  ok(!zuFrisch.ok && codes(zuFrisch).join() === C.BEZUG_ZU_FRISCH, 'wiedersehen mit der Hauptfigur des letzten Abenteuers: BEZUG_ZU_FRISCH (keine Fortsetzung)');
  r = F0('konvoi', { parameter: { sieg: 'pluendern' } }, 'konvoi,abschluss'); ok(beatPar(r, 'konvoi', 'sieg') === 'pluendern', 'konvoi: sieg pluendern');
  F0('konvoi', mitW('nachschub'), 'konvoi,raumschlacht,abschluss', 'nachschub');
  r = F0('geleit', { parameter: { modus: 'havarist' } }, 'geleit,abschluss'); ok(beatPar(r, 'geleit', 'modus') === 'havarist', 'geleit: modus havarist');
  F0('geleit', mitW('angriff'), 'geleit,raumschlacht,abschluss', 'angriff');
  F0('sabotage', mitW('entdeckt'), 'sabotage,raumschlacht,abschluss', 'entdeckt (Posten steht)');
  r = F0('rettung', {}, 'notruf,befreiung,abschluss'); ok(beatPar(r, 'notruf', 'text_key') === 'notruf_entfuehrt' && r.plan.beats[0].verzweigung.gescheitert === 'ende', 'rettung: Notruf der Entfuehrung, Scheitern fuehrt zum Abschluss');
  r = F0('jagd', { parameter: { fluchtziel: 'heimat' } }, 'verfolgung,abschluss'); ok(beatPar(r, 'verfolgung', 'fluchtziel') === 'heimat', 'jagd: fluchtziel heimat');
  F0('jagd', mitW('stellung'), 'verfolgung,raumschlacht,abschluss', 'stellung');
  F0('hinterhalt', {}, 'bitte,raumschlacht,abschluss');
  F0('hinterhalt', mitW('beistand'), 'bitte,raumschlacht,spontanhilfe,abschluss', 'beistand');
  r = F0('hinterhalt', { parameter: { text_key: 'hilfe_kon' } }, 'bitte,raumschlacht,abschluss'); ok(beatPar(r, 'bitte', 'text_key') === 'hilfe_kon', 'hinterhalt: text_key hilfe_kon');
  r = F0('lieferung', { parameter: { ware: 'erz' } }, 'bitte,fracht,abschluss'); ok(beatPar(r, 'fracht', 'ware') === 'erz', 'lieferung: ware erz');
  F0('lieferung', mitW('ueberfall'), 'bitte,raumschlacht,fracht,abschluss', 'ueberfall');
  F0('falscher_haendler', {}, 'bitte,fracht,enthuellung,verfolgung,raumschlacht,abschluss');
  ok(Bauplan.expandiere(ins(g, ab('falscher_haendler')).plan).vorlage.wahrheit.id === 'ist_germane', 'falscher_haendler: die Vorlage traegt die Wahrheit ist_germane (Hinweise vor der Enthuellung)');
  const g0 = neu(11).g;   // ohne Vorgeschichte: in `welt` war schon ein Notruf-Abenteuer (WIEDERHOLUNG_FOLGE bei notruf,abschluss)
  r = F0('notruf', { parameter: { text_key: 'notruf_entfuehrt' } }, 'notruf,abschluss', '', g0); ok(beatPar(r, 'notruf', 'text_key') === 'notruf_entfuehrt', 'notruf: text_key notruf_entfuehrt');
  F0('notruf', mitW('piraten'), 'notruf,raumschlacht,abschluss', 'piraten');
  const wd = ins(g, ab('notruf'));
  ok(!wd.ok && /WIEDERHOLUNG_FOLGE/.test(wd.fehler[0].grund), 'notruf,abschluss gleich nach einem Notruf-Abenteuer: WIEDERHOLUNG_FOLGE (die Wiederholungsregel des Bretts gilt auch hier)');
  // Parameter und Wendungen ausserhalb des Katalogs: Nein von Paket A
  const falsch = ins(g, ab('konvoi', { parameter: { sieg: 'ausrauben' } }));
  ok(!falsch.ok && codes(falsch).join() === C.PARAMETER && falsch.fehler[0].gegenvorschlag.patch[0].wert, 'ein Wert ausserhalb der Liste: PARAMETER mit Gegenvorschlag');
  const keineW = ins(g, ab('rettung', mitW('verfolgung')));
  ok(!keineW.ok && codes(keineW).join() === C.BOGEN_UNVOLLSTAENDIG, 'rettung kennt nur die Wendung keine: BOGEN_UNVOLLSTAENDIG');
});

section('Skalierung nach Stufe (Rang und Schiff der Crew, Daten in inszenierer-werte.json)', () => {
  const t = welt(11), g = t.g;
  verstimmt(t.f[0]);
  const bei = (rufwert, schiff, name, o) => { stufe(g, rufwert, schiff); return ins(g, ab(name, o)); };
  ok(folge(bei(0, 0, 'jagd')) === 'verfolgung,abschluss' && folge(bei(35, 0, 'jagd')) === 'raumschlacht,verfolgung,abschluss' && folge(bei(200, 3, 'jagd')) === 'raumschlacht,verfolgung,abschluss', 'jagd: ab Stufe 1 sichert eine Schlacht die Flucht');
  ok(folge(bei(0, 0, 'hinterhalt')) === 'bitte,raumschlacht,abschluss' && folge(bei(35, 0, 'hinterhalt')) === 'bitte,raumschlacht,raumschlacht,abschluss', 'hinterhalt: ab Stufe 1 eine zweite Schlacht');
  ok(folge(bei(0, 0, 'falscher_haendler')).split(',').length === 6 && folge(bei(35, 0, 'falscher_haendler')).split(',').length === 7, 'falscher_haendler: ab Stufe 1 eine Schlacht mehr');
  ok(folge(bei(0, 0, 'konvoi', mitW('nachschub'))) === 'konvoi,raumschlacht,abschluss' && folge(bei(35, 0, 'konvoi', mitW('nachschub'))) === 'konvoi,raumschlacht,abschluss' && folge(bei(200, 3, 'konvoi', mitW('nachschub'))) === 'konvoi,raumschlacht,raumschlacht,abschluss', 'konvoi mit nachschub: die zweite Welle erst ab Stufe 2');
  ok(folge(bei(200, 3, 'geleit', mitW('angriff'))) === 'geleit,raumschlacht,raumschlacht,abschluss' && folge(bei(200, 3, 'notruf', mitW('piraten'))) === 'notruf,raumschlacht,raumschlacht,abschluss', 'geleit mit angriff und notruf mit piraten: ab Stufe 2 eine zweite Welle');
  ok(folge(bei(200, 3, 'lieferung', mitW('ueberfall'))) === 'bitte,raumschlacht,raumschlacht,fracht,abschluss', 'lieferung mit ueberfall: ab Stufe 2 zwei Wellen');
  stufe(g, 200, 3);
  const sw = ins(g, ab('spur', mitW('ueberfall')));
  ok(sw.ok && folge(sw) === 'spur,raumschlacht,raumschlacht,abschluss' && sw.notizen.some((x) => /Stufe 2/.test(x)), 'spur mit ueberfall bei Stufe 2: zwei Wellen (Notiz nennt die Stufe)');
  // alle Plaene aller Stufen bestehen Expander und Pruefer
  let alle = 0, gut = 0;
  const frisch = neu(11).g;   // ohne Vorgeschichte: keine Wiederholungsregel im Weg
  beladen(frisch);   // BEA-01 C2: die Absicht forderung braucht Ladung an Bord
  for (const [rw, sh] of [[0, 0], [35, 0], [200, 3]]) {
    stufe(frisch, rw, sh);
    for (const [name, e] of EINTRAEGE) {
      if (['rache', 'bergbau', 'sabotage', 'wiedersehen'].includes(name)) continue;
      if (name === 'forderung' && rw < 8) continue;   // BEA-01 C2: ab Rang Optio (Ruf 8) und mit Ladung an Bord (unten beladen); unter Optio ist es ein Nein (siehe NEIN)
      for (const w of e.wendungen) { alle++; const r = ins(frisch, ab(name, mitW(w))); if (r.ok && Bauplan.pruefe(r.plan).ok) gut++; else console.log('    kein Plan: ' + name + ' ' + w + ' Stufe ' + rw + '/' + sh + ' ' + (r.ok ? '' : codes(r).join() + ' ' + r.fehler[0].grund.slice(0, 80))); }
    }
  }
  ok(alle > 20 && gut === alle, 'jede Absicht mit jeder Wendung auf jeder Stufe ergibt einen Plan, den Expander und Pruefer annehmen (' + gut + ' von ' + alle + ')');
  stufe(g, 0, 0);
});

section('Die sieben Rueckfall-Plaene aus anschluss.json: derselbe Plan ueber den Inszenierer', () => {
  // BEA-03 C: der achte Plan (Hinterhalt) hat keine Absicht: im Absichten-Modus waehlt der Rueckfall nur unter den Absichten mit standard, der Hinterhalt kommt dort nur ueber anschluss.json (die Garantie)
  const OHNE_ABSICHT = ['hinterhalt'];
  ok(ANSCHLUSS.plaene.length === 8 && ANSCHLUSS.plaene.filter((p) => OHNE_ABSICHT.includes(p.beats[0].typ)).length === 1 && !EINTRAEGE.some(([name, e]) => e.standard && OHNE_ABSICHT.includes(name)), 'anschluss.json hat acht Plaene, der achte (Hinterhalt, BEA-03 C) ohne Absicht');
  const plaene = ANSCHLUSS.plaene.filter((p) => !OHNE_ABSICHT.includes(p.beats[0].typ));
  ok(plaene.length === 7, 'sieben Plaene mit Absicht (SON-01 C: dazu Helix ruft um Hilfe)');
  const zuordnung = plaene.map((p) => EINTRAEGE.filter(([, e]) => e.standard && e.standard.titel === p.titel).map(([name]) => name));
  ok(zuordnung.every((z) => z.length === 1), 'zu jedem Plan gibt es genau eine Absicht mit gleichem Titel im Feld standard: ' + zuordnung.map((z) => z.join('/')).join(', '));
  ok(new Set(zuordnung.map((z) => z[0])).size === 7 && EINTRAEGE.filter(([, e]) => e.standard).length === 7, 'sieben verschiedene Absichten, und nur diese sieben haben ein standard');
  const stufen = [[0, 0], [35, 0], [200, 3]];
  plaene.forEach((p, i) => {
    const name = zuordnung[i][0];
    // eine Welt, in der der Plan zur Lage passt (Wiedersehen: fruehere NSC; Sabotage: ein Posten)
    const t = welt(11), g = t.g;
    verstimmt(t.f[0]);
    posten(g, '0703');
    const soll = Bauplan.pruefe(p);
    ok(soll.ok, name + ': der Plan aus anschluss.json besteht Expander und Pruefer (' + p.beats.map((b) => b.typ).join(',') + ')');
    for (const [rw, sh] of stufen) {
      stufe(g, rw, sh);
      const r = ins(g, standardAbsicht(name));
      const gleichePlan = r.ok && gleich(r.plan.beats.map((b) => b.typ), p.beats.map((b) => b.typ)) && r.plan.titel === p.titel && r.plan.anlass === p.anlass;
      const vor = r.ok ? Bauplan.pruefe(r.plan) : null;
      const gleicheVorlage = !!vor && vor.ok && gleich(vor.vorlage, soll.vorlage) && vor.vorlage.id === soll.vorlage.id;
      ok(gleichePlan && gleicheVorlage && r.hex === '0305', name + ' (Stufe ' + INS.weltStufe(g) + '): gleiche Beat-Folge, Titel und Anlass; die expandierte Vorlage ist gleich, auch die Id' + (r.ok ? '' : ' [' + codes(r).join() + ' ' + r.fehler[0].grund.slice(0, 80) + ']'));
    }
    stufe(g, 0, 0);
  });
  // Passt die Lage nicht, sagt der Inszenierer Nein, wo auch das Brett den Plan ablehnt (Wirkung wie heute)
  for (const name of ['sabotage', 'wiedersehen']) {
    const p = plaene[zuordnung.findIndex((z) => z[0] === name)];
    const t = neu(11), g = t.g;
    const r = ins(g, standardAbsicht(name));
    const brett = Brett.neuAnbieten(g, p, { hex: '0305' });
    ok(!r.ok && r.fehler[0].code === C.WELT_BEDINGUNG && !brett.ok, name + ': ohne passende Lage Nein beim Inszenierer (' + (r.ok ? 'ok' : r.fehler[0].grund.slice(0, 40)) + ') und beim Brett (' + String(brett.grund || '').slice(0, 40) + ')');
  }
  // Anbieten ueber den Inszenierer legt dasselbe Angebot an wie der Plan aus anschluss.json
  const t = welt(11), g = t.g; verstimmt(t.f[0]);
  const p = plaene[zuordnung.findIndex((z) => z[0] === 'konvoi')];
  const a1 = INS.anbietenAusAbsicht(g, standardAbsicht('konvoi'), KAT);
  ok(a1.ok && a1.angebot.vorlage.id === Bauplan.pruefe(p).vorlage.id && a1.angebot.hex === '0305', 'anbietenAusAbsicht(konvoi): das Angebot hat die Vorlagen-Id des Plans aus anschluss.json, am Ort der Crew');
});

section('Vielfalt: aus zehn Absichten und Parametrierungen mindestens acht verschiedene Beat-Folgen', () => {
  const t = welt(11), g = t.g;
  verstimmt(t.f[0]); posten(g, '0703');
  const faelle = [
    ['geruecht', mitW('falle')], ['spur', mitW('flucht')], ['wiedersehen', mitW('neue_spur')], ['konvoi', mitW('nachschub')], ['geleit', { parameter: { modus: 'panne' } }],
    ['sabotage', mitW('entdeckt')], ['rettung', {}], ['jagd', mitW('stellung')], ['hinterhalt', mitW('beistand')], ['lieferung', mitW('ueberfall')], ['falscher_haendler', {}], ['notruf', mitW('piraten')],
    ['rache', { bezug: { nsc: 'Quintus Varro' } }], ['bergbau', { parameter: { ziel: 'lieferung' } }],
  ];
  const folgen = new Set(); let gut = 0;
  for (const [name, o] of faelle) { const r = ins(g, ab(name, o)); if (r.ok) { gut++; folgen.add(folge(r)); } else console.log('    Nein: ' + name + ' ' + codes(r).join() + ' ' + r.fehler[0].grund.slice(0, 80)); }
  ok(gut >= 10 && folgen.size >= 8, gut + ' von ' + faelle.length + ' Absichten ergeben einen Plan, ' + folgen.size + ' verschiedene Beat-Folgen (verlangt: mindestens 10 Plaene, mindestens 8 Folgen)');
  const typenGesamt = new Set([].concat(...Array.from(folgen).map((f) => f.split(','))));
  ok(typenGesamt.size >= 10, 'die Plaene nutzen mindestens zehn verschiedene Beat-Typen (' + typenGesamt.size + ': ' + Array.from(typenGesamt).join(', ') + ')');
  // Lueckenliste: was der Katalog bewusst nicht ausdrueckt, steht im Test als Nein
  ok(!ins(g, ab('bergbau')).ok, 'Luecke Abbau: bleibt ein Nein, kein Sonderfall');
});

section('Der Spielleiter-Prompt liest den Katalog der Absichten nicht (Umstellung ist Paket E)', () => {
  const srcDir = path.join(__dirname, '..', 'server');
  const alle = [];
  (function lauf(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lauf(p); else if (e.name.endsWith('.js')) alle.push(p); } })(srcDir);
  const code = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n').replace(/\/\/.*$/gm, '');
  const lesen = alle.filter((f) => /require\([^)]*(absicht-pruefer|inszenierer|absicht-verhandlung)/.test(code(f)));
  const rel = lesen.map((f) => path.relative(srcDir, f).replace(/\\/g, '/'));
  ok(rel.every((f) => ['sim/abenteuer-absicht.js', 'sim/abenteuer-brett.js', 'sim/abenteuer-rueckfall.js', 'sim/abenteuer-vorrat.js', 'sim/absicht-verhandlung.js', 'sim/inszenierer.js'].includes(f)), 'nur das Brett (nur CODES), die Verhandlung, der Inszenierer, die Anbindung des Betriebsmodus Absichten (abenteuer-absicht.js, SPL-02 E1) und der Rueckfall und der Vorrat (abenteuer-rueckfall.js, abenteuer-vorrat.js, SPL-02 F) laden Pruefer, Inszenierer oder Verhandlung; Prompt, Mock, Spielleiter und Lage nicht: ' + rel.join(', '));
  const liest = alle.filter((f) => /(D\.DIR|faeden)[^\n]*absichten\.json/.test(code(f))).map((f) => path.relative(srcDir, f).replace(/\\/g, '/'));
  ok(liest.join() === 'sim/absicht-pruefer.js', 'nur server/sim/absicht-pruefer.js liest content/faeden/absichten.json (gefunden: ' + liest.join(', ') + ')');
  const text = Prompt.katalogText();
  const zeilenInPrompt = EINTRAEGE.filter(([, e]) => text.includes(e.prompt_zeile.slice(0, 50)));
  ok(zeilenInPrompt.length === 0, 'der Prompt-Katalog des Spielleiters enthaelt keine prompt_zeile (er baut weiter aus beats.json)');
  ok(Object.keys(D.BEATS).filter((k) => !D.BEATS[k].nur_inszenierer && D.BEATS[k].bauplan && !D.BEATS[k].abschluss).every((k) => text.includes('- ' + k)) && !/- rache/.test(text), 'der Prompt-Katalog nennt alle planbaren Beat-Typen und rache nicht (nur_inszenierer)');
  const mock = require('../server/sim/abenteuer-mock.js');
  ok(typeof mock === 'object', 'der Mock laedt mit dem gefuellten Katalog');
});

section('Quelltext: kein Absichtsname, kein Beat-Typ, keine Zahl', () => {
  const dateien = ['inszenierer.js', 'absicht-verhandlung.js', 'absicht-pruefer.js'];
  const src = dateien.map((f) => fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', f), 'utf8')).join('\n');
  const quoted = (w) => new RegExp('[\'"`]' + w + '[\'"`]').test(src);
  const treffer = NAMEN_KAT.filter(quoted);
  ok(treffer.length === 0, 'kein Absichtsname des Katalogs als Zeichenkette in Inszenierer, Verhandlung und Pruefer (geprueft: ' + NAMEN_KAT.length + (treffer.length ? '; Treffer: ' + treffer.join(', ') : '') + ')');
  const bt = Object.keys(D.BEATS).filter(quoted);
  ok(bt.length === 0, 'kein Beat-Typ als Zeichenkette (geprueft: ' + Object.keys(D.BEATS).length + (bt.length ? '; Treffer: ' + bt.join(', ') : '') + ')');
  const wend = [].concat(...EINTRAEGE.map(([, e]) => e.wendungen || [])).filter((w, i, a) => w !== 'keine' && a.indexOf(w) === i).filter(quoted);
  ok(wend.length === 0, 'kein Wendungs-Symbol des Katalogs als Zeichenkette im Code');
  const param = [].concat(...EINTRAEGE.map(([, e]) => Object.values(e.parameter || {}).flatMap((d) => (d.art === 'liste' ? d.erlaubt : [])))).filter((w, i, a) => typeof w === 'string' && a.indexOf(w) === i).filter(quoted);
  ok(param.length === 0, 'kein Parameterwert des Katalogs als Zeichenkette im Code' + (param.length ? ' (Treffer: ' + param.join(', ') + ')' : ''));
});

// ======================================================================
for (const [name, fn] of abschnitte) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
  console.log('\n== ' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
console.log(`\n${n - fails}/${n} gruen`);
process.exit(fails ? 1 : 0);
