'use strict';
// SPT-02 4 (A Notrufe: Zaehlung): Notruf-Faeden (Herkunft f.notruf, P.notrufBrettFaden) zaehlen NICHT in aktiv_max und NICHT in laufend_max, sondern nur in notruf_aktiv_max (content/faeden/notruf-brett.json, 3).
// Bei Erreichen entsteht kein weiterer Notruf (reise-ereignis.js taktNotruf, abenteuer-brett.js notrufAnbieten); ein vorhandenes Notruf-Angebot meldet beim Annehmen notruf_voll. Pruefreihenfolge: ein Notruf-Angebot
// scheitert nie an laeuft_schon oder kein_platz, ein regulaeres Angebot nie an notruf_voll.
//   A: Daten   B: drei laufende Abenteuer + drei Notrufe zugleich   C: ein vierter Notruf entsteht nicht (Takt und Brett)   D: Reihenfolge der Pruefungen beim Annehmen   E: umgekehrt (Notrufe belegen keinen Platz der Abenteuer)
//   F: Speichern und Laden verwirft keinen Notruf-Faden   G: Snapshot (laufend mit notruf, max)   H: ein beendeter Notruf-Faden hinterlaesst zuletzt   I: Notruf-Faden mit Modell im Abschluss wird abgeschlossen (SPT-02 4b)
//   node tools/test-notruf-zaehlung.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Besitz = require('../server/sim/besitz.js');
const Ruf = require('../server/sim/ruf.js');
const RE = require('../server/sim/reise-ereignis.js');
const Sprung = require('../server/sim/sprung.js');
const Faden = require('../server/sim/faden.js');
const D = require('../server/sim/faden-daten.js');
const P = require('../server/sim/faden-pruefer.js');
const Brett = require('../server/sim/abenteuer-brett.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); f(); };
const HZ = CONFIG.tickHz;
const W = RE.WERTE;
const SCHWELLE = Math.round(W.takt_s * HZ);
const NBD = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content/faeden/notruf-brett.json'), 'utf8'));
const NB = Object.fromEntries(Object.entries(NBD.werte).map(([k, v]) => [k, v.wert]));
const BRD = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content/faeden/abenteuer-brett.json'), 'utf8'));
const NOTRUF = RE.KATALOG.find((e) => e.art === 'notruf' && !e.gefahr);
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };
const Fz = (g) => Faden.zustandVon(g);
const R = (g) => g.weltsim.reise;
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const setzeHex = (g, h) => { g.ship.scene = Sektoren.ortVonHex(h); };
const plan = (i) => ({ format: 'faden-bauplan/1', titel: 'Auftrag Nummer ' + i, anlass: 'Ein Test ohne Namen fuer das Brett.', beats: [{ typ: 'geruecht' }, { typ: 'abschluss' }], volk_erlaubt: ['rom'] });
const NOTRUF_HEXE = ['0603', '0504', '0403', '0105', '0803'];

function neu(env) {
  const g = F.neuesSpiel({ crew: 1, seed: 7, env: env || ENV }).g;
  g.weltsim.zustand.flotten = [];
  setzeHex(g, '0305');
  Fz(g).abenteuerAngebote.length = 0;
  return g;
}
// ein regulaeres Abenteuer anbieten und annehmen -> Faden | { code }
function regulaer(g, i) {
  const r = Faden.abenteuerAnbieten(g, plan(i), { hex: Sektoren.hexVonOrt(g.ship.scene) });
  if (!r.ok) return { code: 'anbieten:' + r.grund };
  const e = Brett.annehmen(g, 'a' + r.angebot.nr);
  return e === null ? Fz(g).liste.find((x) => x.plan && !x.notruf && x.vorlage === r.angebot.ref) : e;
}
// ein Notruf-Angebot am Brett (wie ausloesenTaktNotruf, aber ohne Eintrag in R.offen: so steht der Zustand NACH der Ankunft, der Eintrag ist beantwortet, der Faden laeuft weiter) -> Angebot | null
function notrufAn(g, i, hex) {
  return Brett.notrufAnbieten(g, { nr: -(200 + i), id: NOTRUF.id, hex: hex || NOTRUF_HEXE[i % NOTRUF_HEXE.length], variante: NOTRUF.parameter.variante, sprecher: 'Probeschiff ' + i, marke: 'reise:n-' + (200 + i), ankunft: '0305' });
}
const notrufAnnehmen = (g, a) => Brett.annehmen(g, 'a' + a.nr);
const nFaden = (g) => P.notrufAktiv(Fz(g)).length;

section('A: Daten und Pruefer-Funktionen', () => {
  ok(NB.notruf_aktiv_max === 3 && P.NOTRUF_AKTIV_MAX === NB.notruf_aktiv_max, 'notruf_aktiv_max 3 in notruf-brett.json, der Pruefer liest den Wert (' + P.NOTRUF_AKTIV_MAX + ')');
  ok(D.WERTE.aktiv_max === 3 && D.WERTE.abenteuer.laufend_max === 3, 'aktiv_max 3 und laufend_max 3 unveraendert');
  ok(typeof BRD.weigerungen.notruf_voll === 'string' && BRD.weigerungen.notruf_voll.length > 10 && !/\{/.test(BRD.weigerungen.notruf_voll), 'Weigerung notruf_voll steht in den Daten (ohne Platzhalter): ' + BRD.weigerungen.notruf_voll);
  const g = neu();
  ok(P.aktiveRegulaer(Fz(g)).length === 0 && P.notrufAktiv(Fz(g)).length === 0 && !P.notrufGrenzeErreicht(Fz(g)) && Brett.notrufGrenzeErreicht(g) === false, 'leere Welt: nichts aktiv, Grenze nicht erreicht');
});

section('B: drei laufende Abenteuer + Notrufe: der Notruf bekommt Platz, drei Notrufe zugleich', () => {
  const g = neu();
  const reg = [1, 2, 3].map((i) => regulaer(g, i));
  ok(reg.every((f) => f && f.plan), 'drei regulaere Abenteuer angenommen');
  ok(P.abenteuerLaufend(Fz(g)) === 3 && P.abenteuerGrenzeErreicht(Fz(g)) === true && P.aktive(Fz(g)).length === 3, 'abenteuerLaufend 3, laufend_max erreicht, aktive 3 (= aktiv_max)');
  const x = regulaer(g, 4);
  ok(x && x.code === 'laeuft_schon', 'ein viertes regulaeres Abenteuer meldet laeuft_schon (' + (x && x.code) + ')');
  for (let i = 0; i < 3; i++) {
    const a = notrufAn(g, i);
    ok(!!a, 'Notruf-Angebot ' + (i + 1) + ' am Brett (bei drei laufenden Abenteuern)');
    const r = a && notrufAnnehmen(g, a);
    ok(r === null, 'Notruf ' + (i + 1) + ' angenommen, kein laeuft_schon, kein kein_platz (' + (r && r.code) + ')');
  }
  const Fs = Fz(g);
  ok(P.aktive(Fs).length === 6 && P.aktiveRegulaer(Fs).length === 3 && P.notrufAktiv(Fs).length === 3 && P.abenteuerLaufend(Fs) === 3, 'sechs aktive Faeden: 3 regulaer (aktiv_max), 3 Notruf; abenteuerLaufend bleibt 3');
  ok(Fs.liste.filter((f) => P.notrufBrettFaden(f)).every((f) => f.plan && f.notruf && typeof f.notruf.marke === 'string'), 'jeder Notruf-Faden traegt die Herkunft notruf { marke }');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('C: der vierte gleichzeitige Notruf entsteht nicht', () => {
  const g = neu();
  const reg = [1, 2, 3].map((i) => regulaer(g, i));
  for (let i = 0; i < 3; i++) notrufAnnehmen(g, notrufAn(g, i));
  ok(nFaden(g) === 3 && P.notrufGrenzeErreicht(Fz(g)) && Brett.notrufGrenzeErreicht(g) === true, 'drei Notruf-Faeden laufen, die Grenze ist erreicht');
  const vor = P.notrufAngebote(Fz(g)).length;
  const a4 = notrufAn(g, 3);
  ok(a4 === null && P.notrufAngebote(Fz(g)).length === vor, 'Brett: kein viertes Notruf-Angebot (notrufAnbieten liefert null)');
  // Takt: ein Hex, an dem ein Takt-Notruf moeglich ist (Gegenprobe in einer Welt ohne Notruf-Faden), dann dasselbe mit drei Notruf-Faeden
  Ruf.debug(g, ['rom', '30']);
  const g0 = neu(); Ruf.debug(g0, ['rom', '30']);
  const kant = (gg, hex) => { for (const e of Sektoren.kantenVon(hex)) { if (e.art === 'locked') gg.explore.offenExtra.add(Sektoren.kanteId(e.a, e.b)); else if (e.art === 'hidden' && e.key) gg.explore.linksOpen.add(e.key); } };
  const nur = (fn) => { const kopie = RE.KATALOG.slice(); RE.KATALOG.length = 0; RE.KATALOG.push(NOTRUF); try { return fn(); } finally { RE.KATALOG.length = 0; RE.KATALOG.push(...kopie); } };
  const hexe = Object.keys(Sektoren.KARTE.hexe).filter((h) => Sektoren.spielbar(h) && !Sektoren.istLeerraum(h) && Sektoren.hatSzene(h) && (Besitz.besitzer(g0, h) || 'frei') === (NOTRUF.bedingungen.besitzer || ['rom'])[0]).sort();
  let hex = null;
  for (const h of hexe) { setzeHex(g0, h); kant(g0, h); R(g0).offen = []; R(g0).taktIds = []; if (nur(() => RE.taktNotruf(g0))) { hex = h; break; } }
  ok(!!hex, 'Gegenprobe: in der Welt ohne Notruf-Faden kann ein Takt-Notruf entstehen (Hex ' + hex + ')');
  setzeHex(g, hex); kant(g, hex); R(g).offen = []; R(g).taktIds = [];   // offen leer: takt_offen_max sperrt NICHT, nur die Grenze der Notruf-Faeden
  ok(nur(() => RE.taktNotruf(g)) === null, 'mit drei laufenden Notruf-Faeden liefert taktNotruf keinen weiteren Notruf');
  nur(() => { R(g).takt = SCHWELLE - 1; g.step(); });
  ok(R(g).offen.length === 0 && P.notrufAngebote(Fz(g)).length === vor && nFaden(g) === 3, 'ein Takt-Tick auf der Schwelle: kein Eintrag, keine Marke, kein Angebot');
  // endet einer, entsteht wieder einer (die Grenze ist kein Dauerzustand)
  const f = Fz(g).liste.find((x) => P.notrufBrettFaden(x));
  f.phase = 'abgeschlossen';
  ok(nFaden(g) === 2 && !P.notrufGrenzeErreicht(Fz(g)) && !!nur(() => RE.taktNotruf(g)), 'endet ein Notruf-Faden, ist wieder Platz und ein Takt-Notruf moeglich');
  ok(!!notrufAn(g, 4), 'und das Brett nimmt wieder ein Notruf-Angebot an');
});

section('D: Reihenfolge der Pruefungen beim Annehmen', () => {
  // D1: Abenteuer voll UND Notrufe voll: regulaer -> laeuft_schon (vor kein_platz), Notruf -> notruf_voll (nie laeuft_schon, nie kein_platz)
  const g = neu();
  const anNotruf = [0, 1, 2].map((i) => notrufAn(g, i));   // drei Angebote zugleich (notruf_angebote_max)
  ok(anNotruf.every(Boolean), 'drei Notruf-Angebote zugleich am Brett');
  [1, 2, 3].forEach((i) => regulaer(g, i));
  notrufAnnehmen(g, anNotruf[0]); notrufAnnehmen(g, anNotruf[1]);
  ok(nFaden(g) === 2 && P.abenteuerLaufend(Fz(g)) === 3, 'zwei Notrufe angenommen, drei Abenteuer laufen');
  const r3 = notrufAnnehmen(g, anNotruf[2]);
  ok(r3 === null && nFaden(g) === 3, 'der dritte Notruf bei drei laufenden Abenteuern: angenommen (' + (r3 && r3.code) + ')');
  // vierter vorhandener Notruf: dafuer ein Angebot unter der Grenze anlegen, dann die Grenze fuellen
  const g2 = neu();
  const b = [0, 1, 2].map((i) => notrufAn(g2, i));
  [1, 2, 3].forEach((i) => regulaer(g2, i));
  notrufAnnehmen(g2, b[0]); notrufAnnehmen(g2, b[1]);
  const aE = notrufAn(g2, 3, '0403');   // unter der Grenze (2 aktiv) entsteht noch ein viertes Angebot: das dritte ist noch nicht angenommen
  notrufAnnehmen(g2, b[2]);   // das dritte: Grenze erreicht
  ok(nFaden(g2) === 3 && !!aE, 'Grenze erreicht (3 Notruf-Faeden), ein weiteres Notruf-Angebot liegt noch am Brett');
  const e = aE && notrufAnnehmen(g2, aE);
  ok(e && e.code === 'notruf_voll' && e.text === BRD.weigerungen.notruf_voll, 'bei drei Abenteuern UND drei Notrufen meldet das Notruf-Angebot notruf_voll, nicht laeuft_schon oder kein_platz (' + (e && e.code) + ')');
  ok(Fz(g2).abenteuerAngebote.includes(aE) && nFaden(g2) === 3, 'das Angebot bleibt, kein vierter Faden');
  const rg = regulaer(g2, 9);
  ok(rg && rg.code === 'laeuft_schon', 'ein regulaeres Angebot meldet bei vollen Abenteuern laeuft_schon, nie notruf_voll (' + (rg && rg.code) + ')');
  // Pruefer direkt: das Notruf-Angebot scheitert nur mit NOTRUF_VOLL, nie mit OBERGRENZE oder ABENTEUER_LAUFEND
  const pg = aE ? P.pruefeAbenteuerOeffnen(Fz(g2), aE.nr, {}) : null;
  ok(typeof pg === 'string' ? /^NOTRUF_VOLL/.test(pg) : !!pg && /^NOTRUF_VOLL/.test(pg.text || pg.toString()), 'Pruefer: ' + JSON.stringify(pg));
  // D2: Abenteuer voll, Notruf NICHT voll: der Pruefer laesst das Notruf-Angebot zu
  const g3 = neu();
  [1, 2, 3].forEach((i) => regulaer(g3, i));
  const a = notrufAn(g3, 0);
  ok(P.abenteuerGrenzeErreicht(Fz(g3)) && P.pruefeAbenteuerOeffnen(Fz(g3), a.nr, {}) === null, 'Pruefer: bei drei Abenteuern ist das Notruf-Angebot annehmbar (null)');
  ok(notrufAnnehmen(g3, a) === null, 'Annehmen: ok');
  // D3: kein Spielleiter bleibt die erste Pruefung
  const g4 = neu();
  const a4 = notrufAn(g4, 0);
  g4.lageSpielleiter.rueckfallBetrieb = false; g4.lageSpielleiter.mode = 'off';
  const ks = notrufAnnehmen(g4, a4);
  ok(ks && ks.code === 'kein_spielleiter', 'ohne Spielleiter bleibt kein_spielleiter die erste Absage (' + (ks && ks.code) + ')');
});

section('E: umgekehrt: Notruf-Faeden belegen keinen Platz der Abenteuer', () => {
  const g = neu();
  for (let i = 0; i < 3; i++) notrufAnnehmen(g, notrufAn(g, i));
  ok(nFaden(g) === 3 && P.abenteuerLaufend(Fz(g)) === 0 && !P.abenteuerGrenzeErreicht(Fz(g)) && P.aktiveRegulaer(Fz(g)).length === 0, 'drei Notrufe, null laufende Abenteuer, laufend_max nicht erreicht');
  const rs = [1, 2, 3].map((i) => regulaer(g, i));
  ok(rs.every((f) => f && f.plan), 'danach lassen sich drei regulaere Abenteuer annehmen (aktive Faeden insgesamt ' + P.aktive(Fz(g)).length + ')');
  ok(P.aktive(Fz(g)).length === 6 && P.abenteuerLaufend(Fz(g)) === 3, 'sechs aktive Faeden, drei Abenteuer');
  const pa = Faden.abenteuerAnbieten(g, plan(7), { hex: Sektoren.hexVonOrt(g.ship.scene) });
  ok(pa.ok && P.pruefeAbenteuerOeffnen(Fz(g), pa.angebot.nr, {}) !== null && /^(ABENTEUER_LAUFEND|OBERGRENZE)/.test(String(P.pruefeAbenteuerOeffnen(Fz(g), pa.angebot.nr, {}))), 'das vierte regulaere Abenteuer scheitert am Pruefer: ' + P.pruefeAbenteuerOeffnen(Fz(g), pa.angebot.nr, {}));
  // Faden-Oeffnen des Lage-Spielleiters (faden_oeffnen, pruefeOeffnen) und der Hook ausgangMitPerson zaehlen nur regulaere Faeden
  const g2 = neu();
  for (let i = 0; i < 3; i++) notrufAnnehmen(g2, notrufAn(g2, i));
  const ctx = P.neuerKontext();
  const pf = P.pruefeOeffnen(Fz(g2), { typ: 'faden_oeffnen', vorlage: D.vorlagenIds()[0], parameter: {} }, ctx);
  ok(!(pf && /^OBERGRENZE/.test(String(pf))), 'faden_oeffnen: drei Notruf-Faeden sind keine OBERGRENZE (' + JSON.stringify(pf) + ')');
  const blk = Faden.ausschnittBlock(g2);
  ok(blk && blk.platz === D.WERTE.aktiv_max && blk.aktiv.length === 3, 'Ausschnitt des Spielleiters: 3 Notruf-Faeden sichtbar (er muss sie weiterfuehren), platz bleibt ' + (blk && blk.platz));
  const g3 = neu();
  [1, 2, 3].forEach((i) => regulaer(g3, i));
  for (let i = 0; i < 3; i++) notrufAnnehmen(g3, notrufAn(g3, i));
  const b3 = Faden.ausschnittBlock(g3);
  ok(b3 && b3.platz === 0 && b3.aktiv.length === 6, 'Ausschnitt: 3 regulaere + 3 Notruf = 6 Eintraege, platz 0 (' + (b3 && b3.aktiv.length) + ', platz ' + (b3 && b3.platz) + ')');
});

section('F: Speichern und Laden verwirft keinen Notruf-Faden', () => {
  const g = neu();
  [1, 2, 3].forEach((i) => regulaer(g, i));
  for (let i = 0; i < 3; i++) notrufAnnehmen(g, notrufAn(g, i));
  const save = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim)));
  const F2 = Faden.lesen(save);
  ok(F2.liste.length === 6 && F2.ladeFehler.length === 0, 'sechs aktive Faeden geladen, keine Ladefehler (' + F2.liste.length + ', ' + JSON.stringify(F2.ladeFehler) + ')');
  ok(P.notrufAktiv(F2).length === 3 && P.aktiveRegulaer(F2).length === 3 && P.abenteuerLaufend(F2) === 3, 'nach dem Laden: 3 Notruf-Faeden erkannt (an f.notruf), 3 regulaer');
  // Muell: ein vierter Notruf-Faden im Stand wird geklemmt (eigene Grenze), ein vierter regulaerer ebenfalls
  const s4 = JSON.parse(JSON.stringify(save));
  const nf = s4.liste.filter((x) => x.notruf)[0];
  const k = JSON.parse(JSON.stringify(nf)); k.id = 'f90'; k.nsc.id = 'n90'; k.notruf = { marke: 'reise:n-90' };
  s4.liste.push(k);
  const F4 = Faden.lesen(s4);
  ok(P.notrufAktiv(F4).length === 3 && F4.ladeFehler.some((x) => /aktive Notrufe/.test(x)), 'ein vierter Notruf-Faden im Stand wird geklemmt: ' + JSON.stringify(F4.ladeFehler));
  const s5 = JSON.parse(JSON.stringify(save));
  const rg = JSON.parse(JSON.stringify(s5.liste.filter((x) => !x.notruf)[0])); rg.id = 'f91'; rg.nsc.id = 'n91';
  s5.liste.push(rg);
  const F5 = Faden.lesen(s5);
  ok(P.aktiveRegulaer(F5).length === 3 && P.notrufAktiv(F5).length === 3 && F5.ladeFehler.length === 1, 'ein vierter regulaerer Faden wird geklemmt, die Notruf-Faeden bleiben: ' + JSON.stringify(F5.ladeFehler));
});

section('G: Snapshot: laufend traegt notruf, max bleibt laufend_max', () => {
  const g = neu();
  [1, 2].forEach((i) => regulaer(g, i));
  notrufAnnehmen(g, notrufAn(g, 0));
  const s = Brett.snapshot(g);
  ok(s && s.laufend.length === 3 && s.max === D.WERTE.abenteuer.laufend_max, 'drei laufende (2 Abenteuer + 1 Notruf), max ' + (s && s.max));
  ok(s.laufend.filter((l) => l.notruf === 1).length === 1 && s.laufend.filter((l) => l.notruf === undefined).length === 2, 'nur der Notruf-Faden traegt notruf: 1 (die anderen kein Feld)');
});

section('H: ein beendeter Notruf-Faden hinterlaesst zuletzt', () => {
  const g = neu();
  const a = notrufAn(g, 0, '0603');
  notrufAnnehmen(g, a);
  const f = Fz(g).liste.find((x) => P.notrufBrettFaden(x));
  ok(Brett.snapshot(g).zuletzt === undefined, 'laeuft noch: kein zuletzt');
  f.phase = 'abgeschlossen'; f.ausgang = { art: 'abschluss', status: 'gescheitert', tick: 1 };
  Brett.beiEnde(g, f, 'gescheitert');
  const z = Brett.snapshot(g);
  ok(z && z.zuletzt && z.zuletzt.ausgang === 'gescheitert' && z.zuletzt.titel.length > 3 && z.zuletzt.text.length > 3, 'beiEnde merkt auch den Notruf-Faden: zuletzt { titel "' + (z && z.zuletzt && z.zuletzt.titel) + '", ausgang ' + (z && z.zuletzt && z.zuletzt.ausgang) + ' }');
  ok(!JSON.stringify(z.zuletzt).includes(f.nsc.name), 'der Name des NSC steht nie im zuletzt (der Titel nennt nur den Sprecher des Katalog-Notrufs, wie das Angebot)');
});

section('I: SPT-02 4b: ein Notruf-Faden mit Modell im faelligen Abschluss wird abgeschlossen (notrufAbschlussWeiter), nie mitten im Kampf, nie vor dem Abstand', () => {
  const FP3 = require('../server/sim/faden-p3.js');
  // ein angenommener Notruf-Faden im Betrieb mit Modell, im Abschluss-Beat, faellig
  const abschlussFaden = (i) => {
    const g = neu();
    const a = notrufAn(g, i, '0603');
    notrufAnnehmen(g, a);
    const f = Fz(g).liste.find((x) => P.notrufBrettFaden(x));
    const letzter = D.vorlage(f.vorlage).beats.length - 1;
    g.lageSpielleiter.rueckfallBetrieb = false; g.lageSpielleiter.mode = 'mock';   // Betrieb mit Modell: nur der Lage-Spielleiter fuehrt Faeden weiter
    f.beat = letzter; f.phase = 'wartet'; f.laufend = null; f.zaehler = f.abstand;
    return { g, f, a };
  };
  const { g, f } = abschlussFaden(0);
  const typ = D.vorlage(f.vorlage).beats[f.beat].typ;
  ok(D.BEATS[typ].abschluss === true, 'der letzte Beat des Notruf-Plans ist ein Abschluss-Beat (' + typ + ')');
  ok(Brett.abenteuerAbschlussWeiter(g) === 0 && f.phase === 'wartet', 'abenteuerAbschlussWeiter fasst den Notruf-Faden weiterhin nicht an (regulaere Faeden)');
  ok(Brett.notrufRueckfallWeiter(g) === 0 && f.phase === 'wartet', 'notrufRueckfallWeiter tut mit Modell nichts');
  // Gefahr laeuft noch: Eintrag in R.laufend am Ort des Fadens -> kein Abschluss mitten im Kampf
  const ort = f.parameter.ort;
  R(g).laufend.push({ nr: 900, id: 'x', phase: 'kampf', notruf: true, ev: { hex: ort } });
  ok(Brett.notrufAbschlussWeiter(g) === 0 && f.phase === 'wartet', 'Notruf mitten im Kampf (Gefahr laeuft am Ort): unberuehrt');
  R(g).laufend.length = 0;
  // Abstand nicht umgangen
  f.zaehler = f.abstand - 1;
  ok(Brett.notrufAbschlussWeiter(g) === 0 && f.phase === 'wartet', 'vor dem Abstand startet der Abschluss nicht (Zaehler ' + f.zaehler + ', Abstand ' + f.abstand + ')');
  f.zaehler = f.abstand;
  // Spielleiter aus: kein Auftrag zum Abschliessen
  g.lageSpielleiter.mode = 'off';
  ok(Brett.notrufAbschlussWeiter(g) === 0 && f.phase === 'wartet', 'Spielleiter aus: der Abschluss bleibt stehen');
  g.lageSpielleiter.mode = 'mock';
  // Rueckfall-Betrieb: nie doppelt treiben (dort fuehrt notrufRueckfallWeiter)
  g.lageSpielleiter.rueckfallBetrieb = true;
  ok(Brett.notrufAbschlussWeiter(g) === 0 && f.phase === 'wartet', 'Rueckfall-Betrieb: notrufAbschlussWeiter tut nichts (Sache von notrufRueckfallWeiter)');
  g.lageSpielleiter.rueckfallBetrieb = false;
  ok(Brett.notrufAbschlussWeiter(g) === 1 && f.phase === 'abgeschlossen' && P.notrufAktiv(Fz(g)).length === 0, 'Gefahr vorbei, Abstand erreicht, mit Modell: der Notruf-Faden schliesst ab und gibt seinen Platz in notruf_aktiv_max frei');
  ok(Brett.notrufAbschlussWeiter(g) === 0, 'ein abgeschlossener Faden wird nicht noch einmal angefasst');

  // drei haengende Notrufe sind keine Falle mehr: nach dem Abschluss entsteht wieder ein Notruf-Angebot
  const g3 = neu();
  for (let i = 0; i < 3; i++) notrufAnnehmen(g3, notrufAn(g3, i));
  g3.lageSpielleiter.rueckfallBetrieb = false; g3.lageSpielleiter.mode = 'mock';
  for (const x of P.notrufAktiv(Fz(g3))) { x.beat = D.vorlage(x.vorlage).beats.length - 1; x.phase = 'wartet'; x.laufend = null; x.zaehler = x.abstand; }
  ok(Brett.notrufGrenzeErreicht(g3) === true && notrufAn(g3, 3) === null, 'drei haengende Notrufe: kein weiterer Notruf');
  ok(Brett.notrufAbschlussWeiter(g3) === 3 && nFaden(g3) === 0 && !!notrufAn(g3, 3), 'nach notrufAbschlussWeiter: alle drei abgeschlossen, ein neuer Notruf entsteht wieder');

  // im Stich gelassen: die Strafe bleibt, der Abschluss wertet "gescheitert" (kein Umgehen ohne Spielerentscheidung)
  const s = abschlussFaden(1);
  const marke = s.f.notruf.marke;
  s.f.beat = 1; s.f.phase = 'wartet';   // vor dem Abschluss (rettung o. ae.), Crew springt weg
  ok(D.BEATS[D.vorlage(s.f.vorlage).beats[1].typ].abschluss !== true && Brett.notrufAbschlussWeiter(s.g) === 0 && s.f.phase === 'wartet' && s.f.beat === 1, 'ein faelliger Beat VOR dem Abschluss (' + D.vorlage(s.f.vorlage).beats[1].typ + ') bleibt Sache des Modells');
  ok(FP3.notrufImStich(s.g, marke) === true, 'notrufImStich verbucht den Faden als im Stich gelassen');
  ok(s.f.beat === D.vorlage(s.f.vorlage).beats.length - 1 && s.f.phase === 'wartet', 'im Stich gelassen: der Plan springt zum Abschluss');
  ok(Brett.notrufAbschlussWeiter(s.g) === 1 && s.f.phase === 'abgeschlossen' && s.f.ausgang && s.f.ausgang.art === 'gescheitert', 'der Abschluss kommt nach dem Im-Stich-Lassen und endet gescheitert (' + (s.f.ausgang && s.f.ausgang.art) + ')');

  // im Betrieb verdrahtet: der Takt (g.step) schliesst den haengenden Notruf-Faden ab, ohne dass ein Test die Funktion selbst ruft
  const v = abschlussFaden(2);
  lauf(v.g, 3);
  ok(v.f.phase === 'abgeschlossen' && nFaden(v.g) === 0, 'Takt: der haengende Notruf-Faden wird im Betrieb abgeschlossen (Phase ' + v.f.phase + ')');

  // Gegenprobe: derselbe Zustand bei einem REGULAEREN Faden wird von abenteuerAbschlussWeiter geschlossen, notrufAbschlussWeiter fasst ihn nicht an
  const g2 = neu();
  const r = regulaer(g2, 1);
  g2.lageSpielleiter.rueckfallBetrieb = false; g2.lageSpielleiter.mode = 'mock';
  r.beat = D.vorlage(r.vorlage).beats.length - 1; r.phase = 'wartet'; r.laufend = null; r.zaehler = r.abstand;
  ok(Brett.notrufAbschlussWeiter(g2) === 0 && r.phase === 'wartet', 'regulaerer Faden: notrufAbschlussWeiter fasst ihn nicht an');
  ok(Brett.abenteuerAbschlussWeiter(g2) === 1 && r.phase === 'abgeschlossen', 'Gegenprobe: derselbe Zustand bei einem regulaeren Faden: abenteuerAbschlussWeiter schliesst ab');
});

section('K: Hook ausgangMitPerson (Notruf je Sprung bewaeltigt): drei Notruf-Faeden sind kein Grund fuer "kein Platz", drei regulaere schon', () => {
  const FX = require('./faden-fixture.js');
  const r = FX.registriere(FX.vorlageTest());
  ok(r.ok, 'Testvorlage mit Ausloeser notruf registriert');
  const hook = (g, i) => Faden.ausgangMitPerson(g, { art: 'notruf', id: 'notruf_hook' + i, hex: '0305', sprecher: 'Sprecher', ausgang: 'gelungen' });
  const g1 = neu();
  ok(!!hook(g1, 1), 'Gegenprobe: leere Welt, der Hook macht ein Angebot');
  const g2 = neu();
  for (let i = 0; i < 3; i++) notrufAnnehmen(g2, notrufAn(g2, i));
  ok(nFaden(g2) === 3 && !!hook(g2, 2), 'drei Notruf-Faeden laufen: der Hook macht trotzdem ein Angebot (Notruf-Faeden belegen keinen Platz)');
  const g3 = neu();
  [1, 2, 3].forEach((i) => regulaer(g3, i));
  ok(hook(g3, 3) === null, 'drei regulaere Faeden: kein Platz, kein Angebot');
});

section('J: Client (public/js/brett.js): voll zaehlt nur die regulaeren Abenteuer, das Notruf-Angebot traegt notruf', () => {
  const BC = require('../public/js/brett.js');
  const g = neu();
  [1, 2].forEach((i) => regulaer(g, i));
  notrufAnnehmen(g, notrufAn(g, 0));
  const a = notrufAn(g, 1);
  const m = BC.modellAus(JSON.parse(JSON.stringify(Brett.snapshot(g))));
  ok(m.laufend.length === 3 && m.laufend.filter((l) => l.notruf).length === 1 && m.laufendMax === 3, 'Client: drei laufende, einer davon Notruf (laufendMax ' + m.laufendMax + ')');
  ok(m.voll === false, 'zwei Abenteuer + ein Notruf: das Brett ist NICHT voll (der Server liesse ein drittes Abenteuer zu)');
  ok(m.angebote.length === 1 && m.angebote[0].notruf === true, 'das Notruf-Angebot traegt notruf (Annehmen wird nie am Hinweis "laeuft schon" gesperrt)');
  regulaer(g, 3);
  const m2 = BC.modellAus(JSON.parse(JSON.stringify(Brett.snapshot(g))));
  ok(m2.laufend.length === 4 && m2.voll === true, 'drei Abenteuer + ein Notruf: voll (4 laufende, aber nur die 3 regulaeren zaehlen)');
  ok(BC.antwortText('notruf_voll', 'x') === BRD.weigerungen.notruf_voll, 'Kurztext notruf_voll im Client gleich dem Datentext (ohne Platzhalter)');
  ok(a && true, 'Notruf-Angebot vorhanden');
});

console.log('\n' + (n - fails) + '/' + n + ' Pruefungen ok');
if (fails) { console.log('NOTRUF-ZAEHLUNG: ' + fails + ' FEHLER'); process.exit(1); }
console.log('NOTRUF-ZAEHLUNG OK');
