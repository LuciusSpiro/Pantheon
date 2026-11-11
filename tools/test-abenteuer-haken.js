'use strict';
// SPL-02 E3: die Haken der Fadenmaschine. Ein Abenteuer aus einer Absicht (Rache) spricht seine Bitte (Vorwarnung des ersten Beats), seine Wendung (Vorwarnung des Beats der Wendung) und seinen Abschluss
// (faden-p3 abschluss, nur bei nicht totem NSC) mit den Zeilen der Absicht: Pool-Zeile (Fake-Transport als Pool-Modell), sonst der Rueckfall der Absicht (Daten), sonst der Text der Fadenmaschine. Geprueft wird am
// echten Spiel (Szene, Gefecht, Abschluss-Baustein, Funk): Pool-Zeilen mit eingesetztem Namen und Ort (kein {nsc} im Funktext) · Pool leer und Pruefer lehnt ab: Rueckfall, nie der Dank der Fadenmaschine ("Danke, dass ihr
// mit mir gegangen seid") · ohne Absicht: der Funk ist BYTE-GLEICH zu einem Lauf, in dem der Haken fehlt (Vorlagen-Faden) · eine Ausnahme im Pool stoert das Spiel nicht (Text der Fadenmaschine, Fehler gezaehlt) ·
// Wiedersehen: die Bitte der Absicht (faden-bitte) · Quelltext: die Fadenmaschine ruft nur den Haken.
// Erwartete Werte stehen hier selbst (eigene Welt: acht abgeschlossene Abenteuer, Quintus Varro ist feindlich).      node tools/test-abenteuer-haken.js   (npm run test:abenteuer-haken)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Testhilfe = require('./gegner-testhilfe.js');
const X = require('./faden-fixture.js');
const Absicht = require('../server/sim/abenteuer-absicht.js');
const AT = require('../server/sim/abenteuer-texte.js');
const G = require('../server/sim/abenteuer-geschichte.js');
const Pool = require('../server/sim/texte-pool.js');
const Bitte = require('../server/sim/faden-bitte.js');
const WS = require('../content/faeden/szenen-werte.json').werte;

const { D, Faden, F } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' };
const ENV_POOL = Object.assign({}, ENV, { TEXTE_POOL: '1', LLM_LIVE: '1', OLLAMA_URL: 'http://127.0.0.1:1', OLLAMA_MODEL: 'fake:1b' });
const DANK = /Danke, dass ihr mit mir gegangen seid/;   // der Text der Fadenmaschine fuer einen gelungenen Abschluss (content/faeden/p3-texte.json)

// ---------------------------------------------------------------- Welt (wie test-abenteuer-texte.js)
const neu = (seed, env) => F.neuesSpiel({ crew: NAMEN.length, seed: seed || 11, names: NAMEN, env: Object.assign({}, ENV, env || {}) }).g;
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
function spielt(g, p) {
  const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  beende(g, r.faden, 'gelungen');
  return r.faden;
}
function setze(g, f, name, status, haltung) {
  f.nsc.name = name; f.nsc.fraktion = 'rom'; f.nsc.status = status; f.nsc.haltung = haltung;
  const e = zust(g).kanon.find((x) => x.f === f.id);
  e.name = name; e.volk = 'rom'; e.status = status;
}
const PERSONEN = [
  ['Quintus Varro', 'feindlich', -2], ['Titus Calder', 'tot', 0], ['Gaius Fabrin', 'aktiv', 1], ['Livia Serran', 'verbuendet', 1],
  ['Aurelia Vex', 'aktiv', 0], ['Marcus Nerva', 'aktiv', 0], ['Julia Pavo', 'aktiv', 0], ['Decimus Rufo', 'aktiv', 0],
];
function welt8(seed, env) {
  const g = neu(seed, env);
  const typen = ['notruf', 'spontanhilfe', 'fracht', 'notruf', 'spontanhilfe', 'notruf', 'spontanhilfe', 'notruf'];
  PERSONEN.forEach(([name, st, h], i) => { const f = spielt(g, i === 2 ? einzel('fracht', 3, { parameter: { ware: 'erz' } }) : einzel(typen[i], i + 1)); setze(g, f, name, st, h); if (i === 0) zust(g).kanon.find((x) => x.f === f.id).ausgang = 'gescheitert'; });
  return g;
}
const TEXT = { titel: 'Zebrafalke Probe Titel', einsatz: 'Quintus Varro will Genugtuung fuer den verlorenen Auftrag.', preis: 'Wer Quintus nicht stellt, verliert Ansehen.' };
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', wendung: 'keine', preis: 'Ein Preis ohne Namen fuer den Test.' }, ton: 'nuechtern' }, o || {});
const kennungVon = (g, name) => Object.keys(G.geschichteZeilen(g).kennungen).find((k) => G.geschichteZeilen(g).kennungen[k] === name);
const rache = (g) => Absicht.ersterVersuch(g, ab('rache', { bezug: { nsc: kennungVon(g, 'Quintus Varro') }, bogen: { einsatz: TEXT.einsatz, wendung: 'zweite_welle', preis: TEXT.preis }, ton: 'bitter' }), G.geschichteZeilen(g).kennungen);
const oeffne = (g, st, name) => {
  const id = Faden.wiedersehenKandidaten(g, st.angebot.vorlage).find((x) => Faden.nscVon(g, x).name === name);
  const o = Faden.abenteuerOeffnen(g, st.angebot.nr, { nsc_von: id });
  return o.ok ? o.faden : null;
};
neu(1);   // die Karte der Freien Fahrt Sund setzt erst ein Spiel (Namenslisten des Pruefers)

// ---------------------------------------------------------------- Fake-Transport als Pool-Modell
const VAR = ['sofort', 'heute', 'bald', 'ohne Umweg', 'wie versprochen', 'zur vollen Stunde'];
function fakeLlm(skript) {
  const calls = [], zaehler = {};
  return {
    mode: 'live', calls,
    async ask(kind, input) {
      const slot = (/Textart: (\w+)\./.exec(input.prompt) || [])[1];
      const k = zaehler[slot] = (zaehler[slot] || 0) + 1;
      calls.push({ slot, prompt: input.prompt });
      const s = skript[slot];
      const text = s ? s(k) : '(fake)';
      return { text: JSON.stringify({ text }), tokens: 10, sec: 0.01, anbieter: 'ollama', modell: 'fake' };
    },
  };
}
async function fuellen(g, max) {
  for (let i = 0; i < (max || 600); i++) {
    const vorher = Pool.stand().zaehler.jobs;
    Pool.beiGrenze(g); Pool.update(g, 0.1);
    await Pool.jobFertig();
    if (Pool.stand().zaehler.jobs === vorher) break;
  }
}
const GUT = {
  bitte: (k) => `Hier spricht {nsc}. Ihr schuldet mir noch eine Abrechnung, ich erwarte euch bei {ort} ${VAR[k % VAR.length]}.`,
  wendung: (k) => `Hier ist {nsc}. Meine Verstaerkung trifft bei {ort} ein, das war erst der Anfang ${VAR[k % VAR.length]}.`,
  abschluss_gelungen: (k) => `Die Rechnung ist beglichen, ihr habt mich bei {ort} besiegt, {nsc} fordert nichts mehr ${VAR[k % VAR.length]}.`,
  abschluss_gescheitert: (k) => `Ich ziehe bei {ort} ab, aber unsere Rechnung bleibt offen und ich vergesse nichts ${VAR[k % VAR.length]}.`,
};
const SCHLECHT = { bitte: () => 'Quintus Varro verlangt Genugtuung.', wendung: () => 'Quintus Varro kommt zurueck.', abschluss_gelungen: () => 'Danke, dass ihr mich bei {ort} besiegt habt.', abschluss_gescheitert: () => 'Ich danke euch, {nsc} zieht ab.' };

// laufende Pool-Jobs des Spiels abwarten (sie schreiben in den Zustand des Pools), dann Pool und Zuordnung leeren
const leer = async () => { await Pool.jobFertig(); Pool.zuruecksetzen(); AT.zuruecksetzen(); };

// ---------------------------------------------------------------- Spiel treiben (echte Szene, echter Funk)
const laufe = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
function funkMitschreiben(g) { const l = []; const orig = g.emit.bind(g); g.emit = (k, d) => { if (k === 'radio' && d && d.text) l.push({ von: d.from, text: d.text }); return orig(k, d); }; return l; }
function ausrichten(g) {
  const s = g.ship; s.docked = false; s.dockedAt = null; s.vx = 0; s.vy = 0; s.speed = 0;
  Space.enterScene(g, Sektoren.ortVonHex('0305'), {});
  s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.helm.thrust = 0; s.helm.turn = 0;
}
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
// spielt den Faden bis zum Abschluss: jeder Szenen-Beat bis zum Ausgang (siegt: Gegner fallen, sonst bricht der Beat als gescheitert ab), der Abschluss spricht
function durchspielen(g, f, siegt, vorAbschluss) {
  for (let i = 0; i < 12 && f.phase !== 'abgeschlossen'; i++) {
    if (f.phase === 'wartet') for (let k = 0; k < 6; k++) g.lageGrenze('andocken');
    const beat = D.vorlage(f.vorlage).beats[f.beat];
    if (beat.typ === 'abschluss' && vorAbschluss) vorAbschluss(g, f);
    const r = weiter(g, f);
    if (!r.ok) throw new Error('Beat ' + beat.id + ' startet nicht: ' + r.grund);
    if (g.fadenSzene) {
      laufe(g, WS.vorlauf_s.wert + 1);
      if (siegt) { const tag = 'fs' + g.fadenSzene.id; for (const e of g.space.enemies.filter((x) => x.tag === tag)) Testhilfe.toeten(g, e); laufe(g, 1); }
      else { Faden.beatAusgang(g, f.id, 'gescheitert'); laufe(g, 1); }
    }
  }
}
// ueberlebt: der NSC lebt beim Abschluss (kuenstlich gesetzt: gewinnt die Crew den letzten Beat, stirbt er laut Vorlage und der Text der Fadenmaschine abschluss_tot gilt)
// Rache bis zum Abschluss; der Rueckgabewert: der Funk dieses Laufs und der Faden
async function racheLauf(seed, llm, o) {
  o = o || {};
  await leer();
  const g = welt8(seed, o.env || ENV_POOL);
  if (llm) Pool.setLlm(llm);
  const st = rache(g);
  if (st.stand !== 'angenommen') throw new Error('Rache nicht angenommen: ' + st.stand);
  if (llm) await fuellen(g);
  const f = oeffne(g, st, 'Quintus Varro');
  const funk = funkMitschreiben(g);
  ausrichten(g);
  for (let k = 0; k < 6; k++) g.lageGrenze('andocken');
  funk.length = 0;
  if (o.vorher) o.vorher(g, f);
  durchspielen(g, f, o.siegt !== false, o.ueberlebt ? (x, y) => { y.nsc.status = 'feindlich'; } : null);
  return { g, f, funk, texte: funk.map((x) => x.text) };
}
const vonNsc = (r) => r.funk.filter((x) => x.von === 'Quintus Varro').map((x) => x.text);
const aufklaerung = (r) => r.funk.filter((x) => x.von === 'Aufklärung' && /^Achtung/.test(x.text)).map((x) => x.text);

// ======================================================================
section('Rache mit Pool-Zeilen (Fake-Transport): Bitte, Wendung, Abschluss gelungen aus dem Pool, Namen eingesetzt', () => (async () => {
  const llm = fakeLlm(GUT);
  const r = await racheLauf(81, llm, { siegt: true, ueberlebt: true });
  const nsc = vonNsc(r);
  ok(r.f.phase === 'abgeschlossen' && r.f.ausgang && r.f.ausgang.art === 'gelungen', 'Vorbedingung: das Abenteuer ist gelungen abgeschlossen (' + (r.f.ausgang && r.f.ausgang.art) + ', NSC ' + r.f.nsc.status + ')');
  ok(nsc.length === 3, 'Quintus Varro spricht dreimal: Bitte, Wendung, Abschluss (' + nsc.length + ')');
  ok(/^Hier spricht Quintus Varro\. Ihr schuldet mir noch eine Abrechnung, ich erwarte euch bei Ostia Nova/.test(nsc[0] || ''), 'Bitte: die Pool-Zeile mit Vollname und Ortsname (' + nsc[0] + ')');
  ok(/^Hier ist Quintus Varro\. Meine Verstaerkung trifft bei Ostia Nova ein/.test(nsc[1] || ''), 'Wendung: die Pool-Zeile am Beat der Wendung (' + nsc[1] + ')');
  ok(/^Die Rechnung ist beglichen, ihr habt mich bei Ostia Nova besiegt, Quintus Varro fordert nichts mehr/.test(nsc[2] || ''), 'Abschluss gelungen: die Pool-Zeile (' + nsc[2] + ')');
  ok(r.texte.every((t) => !/\{\w+\}/.test(t)), 'kein Platzhalter im Funk (kein {nsc}, {ort})');
  ok(!r.texte.some((t) => DANK.test(t)) && !nsc.some((t) => /dank/i.test(t)), 'nirgends der Dank der Fadenmaschine');
  ok(NAMEN.every((nm) => !r.texte.join(' ').includes(nm)), 'kein Spielername im Funk');
  const vor = aufklaerung(r);
  ok(vor.length >= 2 && vor.every((t) => /Sekunden/.test(t)) && /germanische Schiffe/.test(vor[0]), 'die Vorwarnung der Aufklaerung (Zahl, Sekunden) bleibt vor jeder Szene erhalten (' + vor.length + ')');
  ok(r.funk.findIndex((x) => x.text === nsc[0]) < r.funk.findIndex((x) => x.text === vor[0]), 'die Bitte kommt vor der Vorwarnung');
  ok(r.g.errors === 0, 'keine Serverfehler (' + r.g.errors + ')');
  await leer();
})());

section('Rache gelungen, der NSC stirbt: der Text abschluss_tot der Fadenmaschine bleibt (kein Haken)', () => (async () => {
  const r = await racheLauf(80, fakeLlm(GUT), { siegt: true });
  const letzte = r.funk[r.funk.length - 1];
  ok(r.f.nsc.status === 'tot' && r.f.ausgang.art === 'gelungen', 'Vorbedingung: der NSC ist tot (die Vorlage laesst ihn im letzten Gefecht sterben)');
  ok(/ist tot\./.test(letzte.text) && letzte.von !== 'Quintus Varro' && vonNsc(r).length === 2, 'der Abschluss ist der Text der Fadenmaschine (ein Toter spricht nie selbst), nur Bitte und Wendung sprechen aus dem Pool (' + letzte.von + ': ' + letzte.text + ')');
  await leer();
})());

section('Rache gescheitert: Abschluss gescheitert aus dem Pool, nie der Dank', () => (async () => {
  const r = await racheLauf(82, fakeLlm(GUT), { siegt: false });
  const nsc = vonNsc(r);
  const letzte = nsc[nsc.length - 1] || '';
  ok(r.f.phase === 'abgeschlossen' && r.f.ausgang && r.f.ausgang.art === 'gescheitert', 'Vorbedingung: gescheitert abgeschlossen (' + (r.f.ausgang && r.f.ausgang.art) + ')');
  ok(/^Ich ziehe bei Ostia Nova ab, aber unsere Rechnung bleibt offen und ich vergesse nichts/.test(letzte), 'Abschluss gescheitert: die Pool-Zeile (' + letzte + ')');
  ok(!r.texte.some((t) => DANK.test(t)) && !/dank/i.test(letzte) && !/besiegt|bezwungen/i.test(letzte), 'kein Dank, kein Sieg im Abschluss');
  ok(r.texte.every((t) => !/\{\w+\}/.test(t)) && r.g.errors === 0, 'kein Platzhalter im Funk, keine Serverfehler');
  await leer();
})());

section('Pool leer oder Pruefer lehnt ab: der Rueckfall der Absicht, nie der Dank', () => (async () => {
  // a) Pool leer (Schalter TEXTE_POOL aus): Rueckfall; die Wendung hat ihren Rueckfall in den Daten der Wendung
  const a = await racheLauf(83, null, { env: ENV, siegt: true, ueberlebt: true });
  const na = vonNsc(a);
  ok(/^Hier spricht Quintus Varro\. Ihr schuldet mir noch etwas, und ich hole es mir bei Ostia Nova\.$/.test(na[0] || ''), 'Bitte ohne Pool: der Rueckfall (' + na[0] + ')');
  ok(/^Hier ist Quintus Varro\. Das war erst der Anfang, meine zweite Welle ist da!$/.test(na[1] || ''), 'Wendung ohne Pool: der Rueckfall der Wendung (' + na[1] + ')');
  ok(/^Die Rechnung zwischen uns ist beglichen\. Mehr habe ich euch nicht zu sagen\.$/.test(na[2] || ''), 'Abschluss gelungen ohne Pool: der Rueckfall (' + na[2] + ')');
  ok(!a.texte.some((t) => DANK.test(t)) && a.g.errors === 0, 'kein Dank der Fadenmaschine, keine Serverfehler');
  // b) der Pruefer lehnt jede Zeile ab (Klartextname, Dank): der Pool bleibt leer, es gilt derselbe Rueckfall
  const llm = fakeLlm(SCHLECHT);
  const b = await racheLauf(84, llm, { siegt: true, ueberlebt: true });
  const nb = vonNsc(b);
  ok(llm.calls.length >= 4 && Pool.stand().zaehler.ungueltig >= 4, 'der Pool wurde befragt, der Pruefer lehnte ab (ungueltig ' + Pool.stand().zaehler.ungueltig + ')');
  ok(nb.length === 3 && nb[0] === na[0] && nb[1] === na[1] && nb[2] === na[2], 'abgelehnte Zeilen: derselbe Rueckfall wie ohne Pool (' + nb.join(' | ') + ')');
  ok(!b.texte.some((t) => DANK.test(t)) && !nb.some((t) => /dank/i.test(t)), 'noch immer kein Dank');
  // c) gescheitert ohne Pool
  const c = await racheLauf(85, null, { env: ENV, siegt: false });
  const nc = vonNsc(c);
  ok(/^Das war es fuer heute, ich ziehe ab\. Unsere Rechnung bleibt offen, und ich vergesse nichts\.$/.test(nc[nc.length - 1] || ''), 'Abschluss gescheitert ohne Pool: der Rueckfall (' + nc[nc.length - 1] + ')');
  await leer();
})());

section('Ohne Absicht byte-gleich: Vorlagen-Faden, Szene und Abschluss sprechen den Text der Fadenmaschine', () => (async () => {
  // Referenz: dieselbe Welt, derselbe Lauf, aber der Haken liefert nie etwas (so verhielt sich die Fadenmaschine vor E3). Verglichen wird der gesamte Funk.
  const lauf = async (seed, ohneHaken, siegt, ueberlebt) => {
    await leer();
    const g = welt8(seed, ENV_POOL);
    const alt = AT.haken;
    if (ohneHaken) AT.haken = () => null;
    try {
      const a = Faden.abenteuerAnbieten(g, plan([{ typ: 'raumschlacht' }, { typ: 'abschluss' }], { titel: 'Vorlagenfaden', anlass: 'Ein Vorlagenfaden ohne Absicht' }), { hex: '0305' });
      const f = Faden.abenteuerOeffnen(g, a.angebot.nr, {}).faden;
      const funk = funkMitschreiben(g);
      ausrichten(g); for (let k = 0; k < 6; k++) g.lageGrenze('andocken'); funk.length = 0;
      durchspielen(g, f, siegt, ueberlebt ? (x, y) => { y.nsc.status = 'aktiv'; } : null);
      return { funk: JSON.stringify(funk), f, g };
    } finally { AT.haken = alt; }
  };
  const faelle = [['gelungen, NSC tot', true, false], ['gescheitert', false, false], ['gelungen, NSC lebt', true, true]];
  const texte = [];
  let mit0 = null;
  for (const [name, siegt, ueber] of faelle) {
    const mit = await lauf(86, false, siegt, ueber), ohne = await lauf(86, true, siegt, ueber);
    const zeilen = JSON.parse(mit.funk);
    texte.push(zeilen.map((x) => x.text));
    ok(mit.f.phase === 'abgeschlossen' && zeilen.length >= 2, name + ': der Vorlagen-Faden lief bis zum Abschluss (Funkzeilen ' + zeilen.length + ')');
    ok(mit.funk === ohne.funk, name + ': der gesamte Funk ist byte-gleich zum Lauf ohne Haken');
    ok(mit.g.errors === 0, name + ': keine Serverfehler');
    mit0 = mit0 || mit;
  }
  ok(texte.every((t) => /^Achtung: \d+ germanische Schiffe/.test(t[0])) && /ist tot\./.test(texte[0][texte[0].length - 1]) && /h.rt ihr nichts mehr/.test(texte[1][texte[1].length - 1]) && DANK.test(texte[2][texte[2].length - 1]), 'die Texte sind die der Fadenmaschine: Vorwarnung der Aufklaerung, abschluss_tot, abschluss_gescheitert und abschluss_gelungen mit dem Dank (' + texte.map((t) => t[t.length - 1]).join(' | ') + ')');
  const mit = mit0;
  const f = mit.f;
  ok(AT.haken(mit.g, f, D.vorlage(f.vorlage).beats[0].id, ['bitte', 'wendung', 'abschluss_gelungen']) === null && AT.haken(mit.g, f.id, 'x', ['bitte']) === null && AT.haken(mit.g, 'f_gibt_es_nicht', 'x', ['bitte']) === null && AT.haken(mit.g, null, 'x', ['bitte']) === null, 'haken ohne angemeldeten Plan, mit Faden-Id, unbekannter Id oder ohne Faden: null');
  await leer();
})());

section('Ein Fehler im Pool stoert das Spiel nicht', () => (async () => {
  const ref = await racheLauf(87, null, { env: ENV, siegt: true });
  const alt = Pool.poolFuer;
  let r;
  try { r = await racheLauf(87, null, { env: ENV, siegt: true, ueberlebt: true, vorher: () => { Pool.poolFuer = () => { throw new Error('Pool kaputt'); }; } }); } finally { Pool.poolFuer = alt; }
  ok(r.f.phase === 'abgeschlossen' && r.f.ausgang.art === 'gelungen', 'das Abenteuer laeuft trotz Ausnahme im Pool bis zum gelungenen Abschluss');
  ok(r.texte.some((t) => /^Achtung: \d+ germanische Schiffe/.test(t)) && !r.texte.some((t) => /Ihr schuldet mir noch etwas/.test(t)), 'es gilt der Text der Fadenmaschine (Vorwarnung), keine Zeile der Absicht');
  ok(r.g.errors >= 3, 'die Fehler sind gezaehlt (' + r.g.errors + ' Serverfehler)');
  ok(ref.g.errors === 0, 'Gegenprobe: derselbe Lauf ohne Fehler zaehlt keinen');
  await leer();
})());

section('Wiedersehen: die Bitte der Absicht in der Antwortleiste (faden-bitte)', () => (async () => {
  await leer();
  const g = welt8(88, ENV_POOL);
  Pool.setLlm(fakeLlm({ bitte: (k) => `Hier ist {nsc}, ich bitte euch um ein Treffen bei {ort} ${VAR[k % VAR.length]}, es ist lange her.` }));
  const st = Absicht.ersterVersuch(g, ab('wiedersehen', { bezug: { nsc: kennungVon(g, 'Livia Serran') }, ton: 'hoffnungsvoll' }), G.geschichteZeilen(g).kennungen);
  await fuellen(g);
  const f = oeffne(g, st, 'Livia Serran');
  const beat = D.vorlage(f.vorlage).beats[0];
  ok(!!f && beat.typ === 'wiedersehen', 'Vorbedingung: Faden mit dem Beat wiedersehen als erstem');
  const hook = AT.haken(g, f, beat.id, ['bitte']);
  ok(typeof hook === 'string' && /^Hier ist Livia Serran, ich bitte euch um ein Treffen bei Ostia Nova/.test(hook), 'der Haken liefert die Pool-Zeile mit eingesetzten Namen (' + hook + ')');
  const r = Bitte.angebotAusVorlage(g, f.id);
  ok(r.ok ? r.bitte.text.startsWith('Hier ist Livia Serran, ich bitte euch um ein Treffen bei Ostia Nova') : ['kein_beat', 'text', 'kein_faden'].includes(r.code), 'angebotAusVorlage: Text der Bitte ist die Pool-Zeile, oder der Beat ist keine Bitte (' + (r.ok ? r.bitte.text : r.code) + ')');
  await leer();
})());

section('Quelltext: die Fadenmaschine ruft nur den Haken, die Slots stehen in den Daten', () => {
  for (const d of ['faden-bitte.js', 'faden-szene.js', 'faden-p3.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server/sim', d), 'utf8');
    const zeilen = src.split('\n').filter((l) => /abenteuer-texte/.test(l));
    ok(zeilen.length === 1 && /\.haken\(/.test(zeilen[0]), d + ': genau ein lazy require, der den Haken `haken` ruft');
    ok(!/Quintus|rache|wiedersehen/i.test(zeilen.join('\n')), d + ': keine Absicht in der Hakenzeile');
  }
  const szene = fs.readFileSync(path.join(__dirname, '..', 'server/sim/faden-szene.js'), 'utf8');
  const slotsDaten = Object.keys(lies('content/texte/texte-werte.json').werte.slots_abenteuer.wert);
  const gerufen = [...szene.matchAll(/it\.beatId, \[([^\]]*)\]/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')));
  ok(gerufen.length === 2 && gerufen.every((s) => slotsDaten.includes(s)), 'faden-szene: die uebergebenen Slots stehen in den Daten (slots_abenteuer): ' + gerufen.join(', '));
});

// ======================================================================
(async () => {
  for (const [name, fn] of abschnitte) {
    console.log('\n== ' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme in ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e)); }
  }
  console.log(`\n${n - fails}/${n} Pruefungen gruen` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})();
