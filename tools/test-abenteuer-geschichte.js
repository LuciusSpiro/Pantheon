'use strict';
// SPL-02 D: Gedaechtnis als Eingabe (server/sim/abenteuer-geschichte.js, Daten content/faeden/geschichte.json, Kanon-Felder taten und ware in abenteuer-kanon.js, Kennungen im Bezug in absicht-pruefer.js,
// Schalter im Prompt in abenteuer-prompt.js). Die Erwartungen stehen hier selbst (von Hand gerechnet an einer eigenen Welt: acht abgeschlossene Abenteuer an der Station 0305, die Namen und Zustaende
// setzt der Test), nie aus dem Produktivcode abgeleitet. Geprueft wird:
// Kanon additiv (taten aus dem Gedaechtnis des Abschlusses nur dieses Abenteuers, begrenzt durch kanon_taten_max; ware aus dem Plan; Weltstand: Schema, Laden, Altstand, Muell nur am Feld) ·
// geschichteZeilen (4 bis 6 Zeilen, Rangfolge, Tote fehlen, Ortsname, Zeilenform, Groesse, deterministisch) · Kennungen und bezugAufloesen (auch ueber pruefeAbsicht) ·
// Spielernamen (nie im Klartext; Kollision Quintus/Varro: nur Kennung, Volk, Rolle; Anna: der Name steht da) · Fortsetzung (zwei Faeden nacheinander: derselbe NSC, locker, Taten im Kanon; unbekannter NSC) ·
// Prompt (Standard aus: byte-gleich; mit Schalter: Zeilen im Kontext, Groesse) · Daten stimmig · Quelltext ohne Beat- und Absichtsnamen.
// Aufruf: node tools/test-abenteuer-geschichte.js [begriff ...]        (npm run test:abenteuer-geschichte)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Kanon = require('../server/sim/abenteuer-kanon.js');
const Wdh = require('../server/sim/abenteuer-wiederholung.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');
const AP = require('../server/sim/absicht-pruefer.js');
const INS = require('../server/sim/inszenierer.js');
const G = require('../server/sim/abenteuer-geschichte.js');

const { D, Faden, F } = X;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const BRETT = lies('content/faeden/abenteuer-brett.json');
const SCHEMA = lies('content/schema/weltstand.schema.json');
const GD = lies('content/faeden/geschichte.json');
const KAT = lies('content/faeden/absichten.json');
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const TATEN_MAX = BRETT.werte.kanon_taten_max.wert;

// ---------------------------------------------------------------- Welt
function neu(seed) {
  const t = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  return t;
}
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats }, o || {});
const einzel = (typ, i, beat) => plan([Object.assign({ typ }, beat || {}), { typ: 'abschluss' }], { titel: typ + ' ' + i, anlass: 'Probeanlass ' + typ + ' Nummer ' + i + ' ohne Namen' });
const zust = (g) => Faden.zustandVon(g);
function beende(g, f, ausgang) {
  const v = D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) {
    f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 };
    Faden.beatAusgang(g, f.id, ausgang);
  }
}
function spiele(g, p, ausgang, parameter) {
  const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, parameter || {});
  beende(g, r.faden, ausgang || 'gelungen');
  return r.faden;
}
// Name, Zustand und Haltung setzen (der Kanon haelt den Namen mit, wie in test-absichten-katalog.js)
function setze(g, f, name, status, haltung) {
  f.nsc.name = name; f.nsc.fraktion = 'rom'; f.nsc.status = status; f.nsc.haltung = haltung;
  const e = zust(g).kanon.find((x) => x.f === f.id);
  e.name = name; e.volk = 'rom'; e.status = status;
}
const PERSONEN = [   // [Name, Zustand, Haltung]; Index = Reihenfolge der Abenteuer (der letzte ist der juengste)
  ['Quintus Varro', 'feindlich', -2], ['Titus Calder', 'tot', 0], ['Gaius Fabrin', 'aktiv', 1], ['Livia Serran', 'verbuendet', 1],
  ['Aurelia Vex', 'aktiv', 0], ['Marcus Nerva', 'aktiv', 0], ['Julia Pavo', 'aktiv', 0], ['Decimus Rufo', 'aktiv', 0],
];
function welt8(seed) {
  const t = neu(seed), g = t.g;
  const typen = ['notruf', 'spontanhilfe', 'fracht', 'notruf', 'spontanhilfe', 'notruf', 'spontanhilfe', 'notruf'];
  t.f = PERSONEN.map(([name, st, h], i) => {
    const f = spiele(g, i === 2 ? einzel('fracht', 3, { parameter: { ware: 'erz' } }) : einzel(typen[i], i + 1));
    setze(g, f, name, st, h);
    return f;
  });
  t.f[7].nsc.gedaechtnis = [];   // Decimus Rufo (der juengste) erinnert sich an keine Tat der Crew: kein Kandidat einer Fortsetzung
  return t;
}
const TEXT = { titel: 'Eine Probe Absicht', einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', preis: 'Ein Preis ohne Namen fuer den Test.' };
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const namenIn = (zeilen) => PERSONEN.map((p) => p[0]).filter((nm) => zeilen.join('\n').includes(nm));
const kennungVon = (r, name) => Object.keys(r.kennungen).find((k) => r.kennungen[k] === name);
const speichern = (g) => klon(Weltstand.capture(g).welt.sim);
function laden(sim, seed) { D.zuruecksetzen(); const t = neu(seed); Kriegslage.restore(t.g, klon(sim)); return t; }

// ======================================================================
section('Kanon: taten und ware additiv', () => {
  const t = neu(21), g = t.g;
  const f1 = spiele(g, einzel('notruf', 1));
  const e1 = zust(g).kanon.find((x) => x.f === f1.id);
  ok(JSON.stringify(e1.taten) === JSON.stringify(['notruf_gelungen', 'abschluss_gelungen']) && e1.ware === undefined, 'ein Abenteuer ohne Fracht: taten = die Ereignisse des Gedaechtnisses beim Abschluss (notruf_gelungen, abschluss_gelungen), keine ware');
  const f2 = spiele(g, einzel('fracht', 2, { parameter: { ware: 'erz' } }), 'gescheitert');
  const e2 = zust(g).kanon.find((x) => x.f === f2.id);
  ok(e2.ware === 'erz' && e2.taten[0] === 'fracht_ohne_ware', 'ein Abenteuer mit Fracht: ware = erz (aus dem Plan, nicht aus faden.js); taten nennt, dass nie geladen wurde (fracht_ohne_ware, kein Hafen in Reichweite: ' + JSON.stringify(e2.taten) + ')');
  const f3 = spiele(g, einzel('fracht', 3));
  ok(zust(g).kanon.find((x) => x.f === f3.id).ware === 'fracht_kiste', 'ohne Parameter gilt der Standard der Daten (fracht_kiste)');
  // ware steht ab dem Beginn, taten erst beim Abschluss
  const a = Faden.abenteuerAnbieten(g, einzel('fracht', 4, { parameter: { ware: 'erz' } }), { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  const e4 = zust(g).kanon.find((x) => x.f === r.faden.id);
  ok(e4.ware === 'erz' && e4.taten === undefined && e4.ausgang === undefined, 'im laufenden Abenteuer steht ware schon, taten noch nicht');
  beende(g, r.faden, 'gelungen');
  // ein Wiedersehen bringt das alte Gedaechtnis mit: nur die Taten ab dem Beginn des neuen Fadens zaehlen
  g.weltsim.tickZahl = 500;
  const nsc = f1.nsc;
  nsc.status = 'aktiv'; nsc.haltung = -2;
  const w = Faden.abenteuerAnbieten(g, einzel('wiedersehen', 5), { hex: '0305' });
  const o = Faden.abenteuerOeffnen(g, w.angebot.nr, { nsc_von: nsc.id });
  ok(o.ok && o.faden.nsc.gedaechtnis.length >= 2, 'Wiedersehen: der NSC bringt sein Gedaechtnis mit');
  beende(g, o.faden, 'gelungen');
  const ew = zust(g).kanon.find((x) => x.f === o.faden.id);
  ok(ew.wieder === true && ew.taten.join() === 'wiedersehen_gelungen,abschluss_gelungen', 'das Wiedersehen: taten nur aus DIESEM Abenteuer (' + JSON.stringify(ew.taten) + '), nicht die des ersten');
  ok(JSON.stringify(zust(g).kanon.find((x) => x.f === f1.id).taten) === JSON.stringify(['notruf_gelungen', 'abschluss_gelungen']), 'der erste Eintrag desselben NSC behaelt seine Taten');
  // Begrenzung durch den Datenwert
  const t2 = neu(22), g2 = t2.g;
  const a2 = Faden.abenteuerAnbieten(g2, einzel('notruf', 1), { hex: '0305' });
  const r2 = Faden.abenteuerOeffnen(g2, a2.angebot.nr, {});
  for (let i = 0; i < 7; i++) r2.faden.nsc.gedaechtnis.push({ tick: 0, ereignis: 'tat_' + String.fromCharCode(97 + i), text_key: 'x' });
  beende(g2, r2.faden, 'gelungen');
  const e5 = zust(g2).kanon.find((x) => x.f === r2.faden.id);
  ok(e5.taten.length === TATEN_MAX && e5.taten[TATEN_MAX - 1] === 'abschluss_gelungen' && e5.taten.join() === 'tat_f,tat_g,notruf_gelungen,abschluss_gelungen' && TATEN_MAX === 4, `hoechstens kanon_taten_max (${TATEN_MAX}) Taten, die juengsten`);
  ok(Kanon.pruefe(zust(g2)).length === 0 && Kanon.pruefe(zust(g)).length === 0, 'der Pruefer des Kanons ist mit den neuen Feldern still');
  // Weltstand: ein Stand mit verdraengten Abenteuern (die Liste fasst 9, der erste lebt nur noch im Kanon: der Block steht im Stand)
  const ts = neu(26), gs = ts.g;
  const erstes = spiele(gs, einzel('fracht', 1, { parameter: { ware: 'erz' } }));
  for (let i = 2; i <= 11; i++) spiele(gs, einzel('notruf', i));
  const sim = speichern(gs);
  const ek = sim.faeden.kanon.find((x) => x.f === erstes.id);
  ok(!zust(gs).liste.some((x) => x.id === erstes.id) && ek && ek.ware === 'erz' && ek.taten.join() === 'fracht_gelungen,abschluss_gelungen', 'ein verdraengter Faden lebt im Kanon weiter, mit ware und taten (' + JSON.stringify(ek) + ')');
  ok(Weltstand.capture(gs).version === 3 && Weltstand.validate(Weltstand.capture(gs), gs).filter((x) => /faeden|kanon/.test(String(x))).length === 0, 'Weltstand bleibt Version 3 und schemagueltig mit taten und ware');
  const kp = SCHEMA.properties.welt.properties.sim.properties.faeden.properties.kanon.items.properties;
  ok(kp.taten && kp.taten.maxItems === TATEN_MAX && kp.ware && kp.taten.items.pattern === '^[a-z_]{1,40}$', 'Schema: taten (maxItems = kanon_taten_max) und ware stehen im Kanon-Eintrag');
  const t3 = laden(sim, 23);
  ok(JSON.stringify(Kanon.liste(zust(t3.g))) === JSON.stringify(Kanon.liste(zust(gs))), 'nach dem Laden ist der Kanon derselbe, auch taten und ware');
  ok(JSON.stringify(Faden.toSave(t3.g.weltsim)) === JSON.stringify(sim.faeden), 'Speichern nach dem Laden ergibt denselben Block');
  // Altstand: ohne die Felder laden, taten und ware werden aus der Liste abgeleitet; der Eintrag bleibt
  const alt = klon(sim);
  for (const e of alt.faeden.kanon || []) { delete e.taten; delete e.ware; }
  const t4 = laden(alt, 24);
  ok(Kanon.liste(zust(t4.g)).length === Kanon.liste(zust(gs)).length && zust(t4.g).ladeFehler.length === 0 && Kanon.pruefe(zust(t4.g)).length === 0, 'Altstand ohne die Felder laedt unveraendert (gleich viele Eintraege, keine Ladefehler)');
  // Muell nur am Feld: der Eintrag bleibt, das Feld faellt
  const muell = klon(sim);
  const k = muell.faeden.kanon;
  const laenge = k.length;
  k[0].taten = 'muell'; k[1].ware = 'goldbarren'; k[2].taten = ['A B', 'x'];
  const t5 = laden(muell, 25);
  const l5 = Kanon.liste(zust(t5.g));
  ok(l5.length === laenge && l5[0].taten !== 'muell' && l5[1].ware !== 'goldbarren' && !(l5[2].taten || []).includes('A B'), 'Muell in taten oder ware verwirft nur das Feld, nie den Eintrag');
  ok(Kanon.pruefe(zust(t5.g)).length === 0 && t5.g.errors === 0, 'danach ist der Kanon stimmig, kein Fehler gezaehlt');
  const streng = klon(zust(gs).kanon); streng[0].taten = ['A B'];
  const kk = { liste: zust(gs).liste, kanon: streng, ladeFehler: [] };
  ok(Kanon.pruefe(kk).some((x) => /^KANON_FORM/.test(x) && /Taten/.test(x)), 'der Pruefer pruefe() bleibt streng: KANON_FORM (Taten)');
});

section('geschichteZeilen: Auswahl, Rang, Form, Groesse', () => {
  const t = welt8(31), g = t.g;
  const r = G.geschichteZeilen(g);
  const lang = r.zeilen.join('\n').length;
  console.log('  info ' + r.zeilen.length + ' Zeilen, ' + lang + ' Zeichen:\n' + r.zeilen.map((z) => '       ' + z).join('\n'));
  ok(r.zeilen.length >= 4 && r.zeilen.length <= 6, 'vier bis sechs Zeilen (' + r.zeilen.length + ')');
  ok(lang <= GD.werte.zeichen_ziel.wert && r.zeilen.every((z) => z.length <= GD.werte.zeile_max.wert), `alle Zeilen zusammen hoechstens ${GD.werte.zeichen_ziel.wert} Zeichen (${lang}), jede hoechstens ${GD.werte.zeile_max.wert}`);
  ok(r.zeichen === lang, 'zeichen = Laenge der Zeilen mit Zeilenumbruechen');
  ok(JSON.stringify(Object.keys(r.kennungen)) === JSON.stringify(r.zeilen.map((z, i) => 'K' + (i + 1))) && r.zeilen.every((z, i) => z.startsWith('K' + (i + 1) + ' ')), 'Kennungen K1 bis Kn in der Reihenfolge der Zeilen, jede Zeile beginnt mit ihrer Kennung');
  // Rangfolge von Hand: Fortsetzung zuerst (alle ausser Decimus, der sich an nichts erinnert, und dem Toten), darunter feindlich/verbuendet vor aktiv, dann der juengste Faden zuerst
  const erwartet = ['Quintus Varro', 'Livia Serran', 'Julia Pavo', 'Marcus Nerva', 'Aurelia Vex', 'Gaius Fabrin'];
  const namen = Object.values(r.kennungen);
  ok(JSON.stringify(namen) === JSON.stringify(erwartet.slice(0, namen.length)), 'Rang: Quintus (feindlich), Livia (verbuendet), dann die juengsten Faeden (Julia, Marcus, Aurelia, Gaius): ' + namen.join(', '));
  ok(!namen.includes('Titus Calder'), 'der Tote (Titus Calder) fehlt');
  ok(!namen.includes('Decimus Rufo'), 'der juengste NSC ohne Erinnerung an eine Tat (kein Kandidat) steht hinter den Kandidaten und faellt weg');
  const zq = r.zeilen[0];
  ok(/^K1 Quintus Varro \(rom\), Ostia Nova: gescheitert|^K1 Quintus Varro \(rom\), Ostia Nova: gelungen/.test(zq), 'Zeilenform: Kennung, Vollname, (Volk), Ortsname statt Hex, Ausgang: "' + zq + '"');
  ok(/jetzt feindlich, Haltung -2, Taten notruf_gelungen abschluss_gelungen$/.test(zq), 'Zustand, Haltung und Taten stehen in der Zeile (feindlich, -2, die zwei Taten)');
  ok(!/0305/.test(r.zeilen.join('\n')), 'der Ort steht als Name, nicht als Hex');
  const zg = r.zeilen.find((z) => z.includes('Gaius Fabrin'));
  ok(zg === undefined || /Ware erz/.test(zg), 'die Ware steht in der Zeile, wenn der Faden Fracht hatte (Gaius Fabrin: erz)');
  ok(JSON.stringify(G.geschichteZeilen(g)) === JSON.stringify(r), 'derselbe Zustand ergibt dieselben Zeilen und Kennungen');
  // weniger Personen als zeilen_min: nur die, die es gibt; ohne Abenteuer: leer
  const t0 = neu(32), r0 = G.geschichteZeilen(t0.g);
  ok(r0.zeilen.length === 0 && Object.keys(r0.kennungen).length === 0, 'ohne Abenteuer: keine Zeilen');
  const t2 = neu(33); const f = spiele(t2.g, einzel('notruf', 1)); setze(t2.g, f, 'Quintus Varro', 'aktiv', 0);
  ok(G.geschichteZeilen(t2.g).zeilen.length === 1, 'eine Person: eine Zeile (zeilen_min ist keine Pflicht zu erfinden)');
  // Datenwerte wirken: zeilen_max und zeichen_ziel kommen aus den Daten
  const eng = klon(G.werte()); eng.zeilen_max = 4;
  ok(G.geschichteZeilen(g, { werte: eng }).zeilen.length === 4, 'zeilen_max aus den Daten: 4 Zeilen');
  const knapp = klon(G.werte()); knapp.zeichen_ziel = 200;
  ok(G.geschichteZeilen(g, { werte: knapp }).zeilen.length === GD.werte.zeilen_min.wert, 'zeichen_ziel aus den Daten: nur zeilen_min Zeilen (' + GD.werte.zeilen_min.wert + ')');
  // ohne Fadenmaschine (Schalter aus): leer
  const t6 = F.neuesSpiel({ crew: 1, seed: 5, names: ['Eins_A'], env: {} });
  ok(G.geschichteZeilen(t6.g).zeilen.length === 0, 'ohne FAEDEN=1: leer, kein Fehler');
});

section('Spielernamen: nie im Klartext, Kollision mit NSC-Namen', () => {
  const t = welt8(41), g = t.g;
  const ohne = G.geschichteZeilen(g);
  g.players[0].name = 'Quintus';
  const r = G.geschichteZeilen(g);
  const zq = r.zeilen.find((z) => /^K\d+ \(rom/.test(z));
  ok(!r.zeilen.join('\n').includes('Quintus') && !r.zeilen.join('\n').includes('Varro') && !!zq, 'Spieler heisst "Quintus": die Zeile des NSC "Quintus Varro" nennt keinen Klartextnamen (' + (zq || 'keine Zeile') + ')');
  ok(zq && /^K1 \(rom, [A-Za-z]+\), Ostia Nova: /.test(zq), 'sie nennt nur Kennung, Volk und Rolle (Schiffsklasse), dazu Ort und Zustand');
  ok(r.kennungen.K1 === 'Quintus Varro' && JSON.stringify(Object.keys(r.kennungen)) === JSON.stringify(Object.keys(ohne.kennungen)), 'die Kennung loest weiter zum Vollnamen auf (nur der Server kennt ihn), die Auswahl bleibt gleich');
  ok(r.zeilen.slice(1).join('\n') === ohne.zeilen.slice(1).join('\n'), 'die anderen Zeilen sind unveraendert');
  g.players[0].name = 'Varro';
  const r2 = G.geschichteZeilen(g);
  ok(!r2.zeilen.join('\n').includes('Varro') && !r2.zeilen.join('\n').includes('Quintus'), 'auch der Nachname als Spielername ("Varro") nimmt den Namen aus der Zeile');
  g.players[0].name = 'Anna';
  const r3 = G.geschichteZeilen(g);
  ok(r3.zeilen[0].startsWith('K1 Quintus Varro (rom)') && JSON.stringify(r3) === JSON.stringify(ohne), 'Spieler "Anna": kein Zusammenfall, der Name steht in der Zeile (wie ohne Spieler)');
  g.players[0].name = 'Quintus';
  const p = Prompt.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [], geschichte: true });
  ok(!p.fehler && !p.prompt.includes('Varro') && !p.prompt.includes('Quintus'), 'der ganze Prompt mit Geschichte nennt weder Quintus noch Varro, solange ein Spieler so heisst');
  ok(p.kennungen && p.kennungen.K1 === 'Quintus Varro', 'baue gibt die Kennungen mit zurueck (fuer die Aufloesung)');
  for (const nm of NAMEN) ok(!G.geschichteZeilen(g).zeilen.join('\n').includes(nm), 'der Spielername ' + nm + ' steht nie in den Zeilen');
});

section('Kennungen und Bezug', () => {
  const t = welt8(51), g = t.g;
  const r = G.geschichteZeilen(g);
  const kq = kennungVon(r, 'Quintus Varro'), kl = kennungVon(r, 'Livia Serran');
  const a = G.bezugAufloesen(r.kennungen, { nsc: kl });
  ok(a.ok && a.bezug.nsc === 'Livia Serran', 'bezugAufloesen: ' + kl + ' wird zum Vollnamen (Livia Serran)');
  const v = G.bezugAufloesen(r.kennungen, { nsc: 'Livia Serran' });
  ok(v.ok && v.bezug.nsc === 'Livia Serran', 'ein Vollname bleibt, wie er ist');
  const o = G.bezugAufloesen(r.kennungen, { ort: '0305' });
  ok(o.ok && o.bezug.ort === '0305', 'ein Bezug ohne nsc bleibt unberuehrt');
  const u = G.bezugAufloesen(r.kennungen, { nsc: 'K9' });
  ok(!u.ok && u.fehler[0].code === 'BEZUG_UNBEKANNT' && u.fehler[0].feld === 'bezug.nsc' && /K9/.test(u.fehler[0].grund) && u.fehler[0].gegenvorschlag.patch[0].wert === 'K1', 'eine unbekannte Kennung: BEZUG_UNBEKANNT im Format des Pruefers, Gegenvorschlag K1');
  ok(!G.bezugAufloesen({}, { nsc: 'K1' }).ok, 'ohne Geschichte ist jede Kennung unbekannt');
  ok(G.istKennung('K2') && !G.istKennung('Quintus Varro') && !G.istKennung('k2') && !G.istKennung('K0') && !G.istKennung('K123'), 'istKennung: K plus Zahl von 1 bis 99');
  // durch pruefeAbsicht
  const RA = (nsc) => ab('rache', { bezug: { nsc }, ton: 'bitter' });
  const mitK = AP.pruefeAbsicht(g, RA(kq));
  ok(mitK.ok && mitK.absicht.bezug.nsc === 'Quintus Varro', 'pruefeAbsicht: Bezug ' + kq + ' ergibt ok, die Absicht traegt den Vollnamen');
  const mitName = AP.pruefeAbsicht(g, RA('Quintus Varro'));
  ok(mitName.ok && mitName.absicht.bezug.nsc === 'Quintus Varro', 'pruefeAbsicht: Bezug Vollname ergibt ebenso ok');
  const falsch = AP.pruefeAbsicht(g, RA('K9'));
  ok(!falsch.ok && falsch.fehler.some((x) => x.code === 'BEZUG_UNBEKANNT' && /K9/.test(x.grund)) && falsch.fehler.filter((x) => x.feld === 'bezug.nsc').length === 1, 'pruefeAbsicht: Kennung K9 gibt es nicht: genau ein Fehler BEZUG_UNBEKANNT');
  const leer = neu(52);
  const k1 = AP.pruefeAbsicht(leer.g, RA('K1'));
  ok(!k1.ok && k1.fehler.some((x) => x.code === 'BEZUG_UNBEKANNT'), 'in einer Welt ohne Geschichte ist K1 BEZUG_UNBEKANNT');
  const fremd = AP.pruefeAbsicht(g, RA('Nero Fremdling'));
  ok(!fremd.ok && fremd.fehler.some((x) => x.code === 'BEZUG_UNBEKANNT'), 'ein NSC, den die Welt nicht kennt (Vollname): BEZUG_UNBEKANNT');
  const tot = AP.pruefeAbsicht(g, RA('Titus Calder'));
  ok(!tot.ok && tot.fehler.some((x) => x.code === 'BEZUG_UNBEKANNT'), 'der Tote (Vollname) ist kein Bezug');
  // Kennungen sind pro Zustand stabil: Prompt und Aufloesung gehoeren zusammen
  const p = Prompt.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [], geschichte: true });
  ok(JSON.stringify(p.kennungen) === JSON.stringify(r.kennungen), 'die Kennungen aus baue sind die der Aufloesung (derselbe Zustand)');
  const ins = INS.inszeniere(g, RA(kq), KAT);
  ok(ins.ok && ins.bezug.nsc === 'Quintus Varro', 'der Inszenierer bekommt den Vollnamen aus der Kennung (Plan gueltig)');
  const unb = INS.inszeniere(g, RA('K9'), KAT);
  ok(!unb.ok && unb.fehler.some((x) => /BEZUG_UNBEKANNT/.test(x.code + x.grund)), 'der Inszenierer lehnt die unbekannte Kennung ab');
});

section('Fortsetzung: zwei Faeden nacheinander (Abnahme 5)', () => {
  const t = neu(61), g = t.g;
  const typen = ['notruf', 'spontanhilfe', 'fracht'], namen = ['Quintus Varro', 'Titus Calder', 'Gaius Fabrin'];
  t.f = typen.map((typ, i) => { const f = spiele(g, typ === 'fracht' ? einzel('fracht', 3, { parameter: { ware: 'erz' } }) : einzel(typ, i + 1)); setze(g, f, namen[i], 'aktiv', 0); return f; });
  const [q, ti, ga] = t.f;
  q.nsc.status = 'aktiv'; q.nsc.haltung = -2; ga.nsc.status = 'aktiv'; ga.nsc.haltung = -2; ti.nsc.status = 'verbuendet'; ti.nsc.haltung = 1;
  zust(g).kanon.find((e) => e.f === ga.id).status = 'aktiv';
  ok(Wdh.kandidatenFrisch(g, { beats: [{ typ: Object.keys(D.BEATS).find((k) => D.BEATS[k].braucht && D.BEATS[k].braucht.nsc_alt === true && D.BEATS[k].braucht.nsc_status && D.BEATS[k].braucht.nsc_status.includes('feindlich')) }], volk_erlaubt: ['rom'] }).length >= 1, 'Vorbedingung: ein frischer Kandidat fuer eine Rache existiert (nicht Gaius, die Hauptfigur des letzten Abenteuers)');
  const z = G.geschichteZeilen(g);
  const kg = kennungVon(z, 'Gaius Fabrin'), kqn = kennungVon(z, 'Quintus Varro');
  ok(!!kg && !!kqn, 'beide stehen in der Geschichte (' + kqn + ', ' + kg + ')');
  const zgz = z.zeilen.find((x) => x.startsWith(kg + ' '));
  ok(/Taten fracht_gelungen abschluss_gelungen/.test(zgz) && /Ware erz/.test(zgz), 'Abenteuer 1 mit Gaius: Gedaechtnis und Ware stehen in seiner Zeile (' + zgz + ')');
  // Fortsetzung mit Bezug auf die Hauptfigur des LETZTEN Abenteuers (nicht der juengste frische Kandidat = Quintus)
  g.weltsim.tickZahl = 700;
  const absicht = ab('rache', { bezug: { nsc: kg }, ton: 'bitter' });
  const an = INS.anbietenAusAbsicht(g, absicht, KAT);
  ok(an.ok && an.angebot.bezug.nsc === 'Gaius Fabrin' && an.angebot.locker === true, 'Absicht rache mit Bezug ' + kg + ': Angebot am Brett mit bezug Gaius Fabrin und locker');
  ok(Wdh.kandidatenFrisch(g, an.angebot.vorlage).every((id) => Faden.nscVon(g, id).name !== 'Gaius Fabrin') && Wdh.kandidatenFrisch(g, an.angebot.vorlage).length === 1, 'ohne locker waere Gaius gesperrt (Wiederholungsregel nsc_zuletzt), der jueengste frische Kandidat waere ein anderer');
  const anz = Faden.zustandVon(g).liste.length;
  const fehl = Brett.annehmen(g, 'a' + an.angebot.nr);
  const f2 = zust(g).liste[zust(g).liste.length - 1];
  ok(fehl === null && zust(g).liste.length === anz + 1 && f2.nsc.name === 'Gaius Fabrin' && f2.id !== ga.id, 'annehmen: der Faden laeuft mit Gaius Fabrin (derselbe Vollname, nicht Quintus, nicht der juengste frische Kandidat), locker greift');
  ok(f2.nsc.haltung === -2 && f2.nsc.gedaechtnis.some((x) => x.ereignis === 'fracht_gelungen'), 'derselbe NSC: Haltung und Gedaechtnis des ersten Abenteuers sind da');
  beende(g, f2, 'gelungen');
  const kanon = zust(g).kanon;
  const e1 = kanon.find((e) => e.f === ga.id), e2 = kanon.find((e) => e.f === f2.id);
  ok(e2.wieder === true && e2.name === 'Gaius Fabrin' && e2.taten.length >= 1 && !e2.taten.includes('fracht_gelungen') && e2.taten.every((x) => !e1.taten.includes(x) || x === 'abschluss_gelungen'), 'Taten im Kanon: das Abenteuer 2 traegt nur seine eigenen Taten (' + JSON.stringify(e2.taten) + '), Abenteuer 1 behaelt seine (' + JSON.stringify(e1.taten) + ')');
  ok(e1.ware === 'erz' && e2.ware === undefined, 'ware: Abenteuer 1 erz, Abenteuer 2 keine');
  ok(Kanon.pruefe(zust(g)).length === 0, 'der Kanon ist stimmig');
  const z2 = G.geschichteZeilen(g);
  ok(zust(g).liste.some((x) => x.nsc.name === 'Gaius Fabrin' && x.nsc.status === 'tot'), 'Vorbedingung: die Rache hat Gaius Fabrin das Leben gekostet (Zustand tot)');
  console.log('  info Gaius nach der Fortsetzung: ' + zust(g).liste.filter((x) => x.nsc.name === 'Gaius Fabrin').map((x) => x.id + ':' + x.nsc.status).join(' ') + ' | Zeilen: ' + JSON.stringify(z2.zeilen));
  ok(!Object.values(z2.kennungen).includes('Gaius Fabrin') && z2.zeilen.length === 2, 'danach ist Gaius Fabrin tot und steht nicht mehr in der Geschichte (zwei Zeilen: Titus, Quintus)');
  // Wiedersehen mit Bezug auf einen NSC, der nicht der juengste frische ist
  const zw = G.geschichteZeilen(g);
  const kt = kennungVon(zw, 'Titus Calder');
  const wa = INS.anbietenAusAbsicht(g, ab('wiedersehen', { bezug: { nsc: kt } }), KAT);
  ok(!kt || (wa.ok ? wa.angebot.bezug.nsc === 'Titus Calder' : /BEZUG|WELT|ANGEBOT|WIEDERHOLUNG/.test(wa.fehler.map((x) => x.code).join())), 'Wiedersehen mit Bezug ' + kt + ': Angebot mit Titus Calder oder ein dokumentiertes Nein (' + (wa.ok ? 'Angebot' : wa.fehler.map((x) => x.code).join()) + ')');
  // der NSC existiert nicht
  const nein = INS.anbietenAusAbsicht(g, ab('rache', { bezug: { nsc: 'K9' } }), KAT);
  ok(!nein.ok && nein.fehler.some((x) => /BEZUG_UNBEKANNT/.test(x.code + x.grund)), 'Bezug auf eine Kennung, die es nicht gibt: abgelehnt, kein Angebot');
  const nein2 = INS.anbietenAusAbsicht(g, ab('rache', { bezug: { nsc: 'Nero Fremdling' } }), KAT);
  ok(!nein2.ok && nein2.fehler.some((x) => /BEZUG_UNBEKANNT/.test(x.code + x.grund)), 'Bezug auf einen NSC, der nicht existiert (Vollname): abgelehnt');
});

section('Prompt: Standard aus, mit Schalter Zeilen im Kontext', () => {
  const t = welt8(71), g = t.g;
  const ohne = Prompt.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [] });
  const aus = Prompt.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [], geschichte: false });
  ok(!ohne.fehler && ohne.prompt === aus.prompt && !/crew_geschichte/.test(ohne.prompt) && ohne.kennungen === undefined, 'Standard: der Prompt hat kein crew_geschichte, byte-gleich zu geschichte: false');
  ok(G.imPromptStandard() === false && GD.werte.im_prompt.wert === false, 'der Datenwert im_prompt steht auf false');
  const mit = Prompt.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [], geschichte: true });
  ok(!mit.fehler && /"crew_geschichte":\["K1 /.test(mit.prompt), 'mit geschichte: true steht crew_geschichte im Kontext, die Zeilen beginnen mit K1');
  const z = G.geschichteZeilen(g).zeilen;
  ok(z.every((x) => mit.prompt.includes(JSON.stringify(x).slice(1, -1))), 'alle Zeilen stehen unveraendert im Prompt');
  const diff = mit.zeichen - ohne.zeichen;
  console.log(`  info Prompt ohne Geschichte ${ohne.zeichen} Zeichen (Kontext ${ohne.kontextZeichen}), mit ${mit.zeichen} (Kontext ${mit.kontextZeichen}), Unterschied ${diff} Zeichen, ${z.length} Zeilen; Obergrenze ${Prompt.WERTE.prompt_max_zeichen}, Katalog ${Prompt.katalogText().length}`);
  ok(diff > 0 && diff <= GD.werte.zeichen_ziel.wert + 40 && mit.zeichen <= Prompt.WERTE.prompt_max_zeichen, 'der Zuwachs ist hoechstens zeichen_ziel plus Feldname und Anfuehrungszeichen (' + diff + ') und der Prompt bleibt unter der Obergrenze');
  // kontextVon ohne Schalter: byte-gleich zu vorher (kein Feld)
  const k = Prompt.kontextVon(g, Prompt.WERTE, [], 0, '0305');
  ok(!('crew_geschichte' in k), 'kontextVon ohne Schalter: kein Feld crew_geschichte');
  // Datenwert gilt ohne Option
  const roh = klon(GD); roh.werte.im_prompt.wert = true;
  ok(G.werteFehler(roh).length === 0, 'ein Datensatz mit im_prompt true ist stimmig (der Schalter ist ein Datenwert)');
});

section('Daten stimmig', () => {
  ok(G.werteFehler().length === 0, 'geschichte.json ist stimmig (' + G.werteFehler().join(' | ') + ')');
  const schlecht = (mut, re, was) => { const k = klon(GD); mut(k); const f = G.werteFehler(k); ok(f.some((x) => re.test(x)), 'Strukturregel: ' + was + ' (' + (f.find((x) => re.test(x)) || 'kein Fehler').slice(0, 80) + ')'); };
  schlecht((k) => { k.werte.zeilen_min.wert = 9; }, /zeilen_min liegt ueber/, 'zeilen_min hoechstens zeilen_max');
  schlecht((k) => { k.werte.zeile_max.wert = 5000; }, /zeile_max liegt ueber/, 'zeile_max hoechstens zeichen_ziel');
  schlecht((k) => { k.werte.im_prompt.wert = 'ja'; }, /im_prompt/, 'im_prompt ist ein Wahrheitswert');
  schlecht((k) => { delete k.texte.ware; }, /texte.ware/, 'alle Texte da');
  schlecht((k) => { k.werte.kennung_praefix.wert = 'k1'; }, /kennung_praefix/, 'Praefix aus Grossbuchstaben');
  ok(Number.isInteger(TATEN_MAX) && TATEN_MAX >= 1 && TATEN_MAX <= 12 && BRETT.werte.kanon_taten_max.einheit === 'Taten' && typeof BRETT.werte.kanon_taten_max._hinweis === 'string', 'kanon_taten_max ist ein Datenwert mit Einheit und Hinweis (' + TATEN_MAX + ', hoechstens die 12 Eintraege des Gedaechtnisses)');
  ok(BRETT.werte.kanon_max.wert === 40, 'kanon_max bleibt 40 Eintraege (Datenwert)');
});

section('Quelltext: kein Beat- und kein Absichtsname', () => {
  const src = ['abenteuer-geschichte.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', f), 'utf8')).join('\n');
  const quoted = (w) => new RegExp('[\'"`]' + w + '[\'"`]').test(src);
  const bt = Object.keys(D.BEATS).filter(quoted);
  ok(bt.length === 0, 'kein Beat-Typ als Zeichenkette in der Geschichte (geprueft: ' + Object.keys(D.BEATS).length + (bt.length ? '; Treffer: ' + bt.join(', ') : '') + ')');
  const ab2 = Object.keys(KAT.absichten).filter(quoted);
  ok(ab2.length === 0, 'kein Absichtsname des Katalogs als Zeichenkette (geprueft: ' + Object.keys(KAT.absichten).length + ')');
  const zahlen = src.match(/[^\w.][1-9]\d{2,}[^\w]/g) || [];
  ok(zahlen.length === 0, 'keine Zahl ab drei Stellen im Code (Zahlen sind Daten)' + (zahlen.length ? ': ' + zahlen.join(' ') : ''));
});

// ======================================================================
for (const [name, fn] of abschnitte) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
  console.log('\n== ' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
console.log(`\n${n - fails}/${n} gruen`);
process.exit(fails ? 1 : 0);
