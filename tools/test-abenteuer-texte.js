'use strict';
// SPL-02 E2: Dramaturgie im Text. Der Bogen (Einsatz, Wendung, Preis) und die Bezuege einer Absicht gehen als Fakten in die Specs des Text-Pools (server/sim/abenteuer-texte.js), die neuen Slots der Abenteuer-Zeilen stehen als Daten,
// der Pruefer fuer Zeilen mit Bezug (texte-pruefer.js: Namen nur als Platzhalter, keine Erfindungen, Anrede) und der Rueckfall der Absicht (Daten, nie erzwungener Dank). Kein Netz, kein Claude: ein Fake-Transport liefert die Zeilen.
// Die Erwartungen stehen hier selbst (eigene Welt: acht abgeschlossene Abenteuer an der Station 0305, Quintus Varro ist feindlich), nie aus dem Produktivcode abgeleitet. Geprueft wird:
// Daten (Slots, Laengen, Katalog stimmig, Quelltext ohne Absichts-, Beat- und Slotnamen) · Pruefer (gute Zeile, Klartextname, Ort, Erfindung Legio, Platzhalter statt Namen, Sie-Form, Dank in der Rache, Altverhalten ohne bezug) ·
// Dramaturgie-Beleg (Plan mit Bogen: Wendung ist Beat der Folge UND der Bogen steht in den Specs der passenden Beats; Rache-Fakten statt Dank; Namen nur als Platzhalter; Spielername und Klartextname im Bogen fallen weg) ·
// Pool mit Fake-Transport (gute Zeilen durch, Erfindung/Klartextname/Sie/Dank abgelehnt und im Wiederholungsversuch geheilt, nie ein Name im Pool-Text) · Haken zeile (Pool-Zeile mit eingesetzten Namen, Rueckfall bei leerem Pool,
// bei abgelehnten Zeilen und ohne Schalter, kein Dank im Rueckfall der Rache) · Katalog-Rueckfall bedingt durch Zustand und Haltung (Daten).
// Aufruf: node tools/test-abenteuer-texte.js [begriff ...]        (npm run test:abenteuer-texte)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const Absicht = require('../server/sim/abenteuer-absicht.js');
const AT = require('../server/sim/abenteuer-texte.js');
const AP = require('../server/sim/absicht-pruefer.js');
const G = require('../server/sim/abenteuer-geschichte.js');
const Pool = require('../server/sim/texte-pool.js');
const Pruefer = require('../server/sim/texte-pruefer.js');
const Stufen = require('../server/mission/stufen.js');

const { D, Faden, F } = X;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const KAT = lies('content/faeden/absichten.json');
const TW = lies('content/texte/texte-werte.json').werte;
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' };
const ENV_POOL = Object.assign({}, ENV, { TEXTE_POOL: '1', LLM_LIVE: '1', OLLAMA_URL: 'http://127.0.0.1:1', OLLAMA_MODEL: 'fake:1b' });

// ---------------------------------------------------------------- Welt (wie test-abenteuer-absichten.js)
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
function spiele(g, p) {
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
  PERSONEN.forEach(([name, st, h], i) => { const f = spiele(g, i === 2 ? einzel('fracht', 3, { parameter: { ware: 'erz' } }) : einzel(typen[i], i + 1)); setze(g, f, name, st, h); if (i === 0) zust(g).kanon.find((x) => x.f === f.id).ausgang = 'gescheitert'; });
  return g;
}
const TEXT = { titel: 'Zebrafalke Probe Titel', einsatz: 'Quintus Varro will Genugtuung fuer den verlorenen Auftrag.', preis: 'Wer Quintus nicht stellt, verliert Ansehen.' };
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', wendung: 'keine', preis: 'Ein Preis ohne Namen fuer den Test.' }, ton: 'nuechtern' }, o || {});
const kennungVon = (g, name) => Object.keys(G.geschichteZeilen(g).kennungen).find((k) => G.geschichteZeilen(g).kennungen[k] === name);
const rache = (g, o) => Absicht.ersterVersuch(g, ab('rache', Object.assign({ bezug: { nsc: kennungVon(g, 'Quintus Varro') }, bogen: { einsatz: TEXT.einsatz, wendung: 'verfolgung', preis: TEXT.preis }, ton: 'bitter' }, o || {})), G.geschichteZeilen(g).kennungen);
// die Karte der Freien Fahrt Sund setzt erst ein Spiel (Namenslisten des Pruefers: Ortsnamen); darum zuerst eines
neu(1);
const specs = (g, a, i, an) => AT.specsFuer(g, a, i, an, KAT);
const specVon = (r, slot) => r.eintraege.find((e) => e.slot === slot);

// ---------------------------------------------------------------- Fake-Transport fuer den Text-Pool
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
      const text = s ? (k <= s.length ? s[k - 1] : s.gut(k)) : '(fake)';
      return { text: JSON.stringify({ text }), tokens: 10, sec: 0.01, anbieter: 'ollama', modell: 'fake' };
    },
  };
}
const mitGut = (liste, gut) => Object.assign(liste, { gut });
async function fuellen(g, max) {
  for (let i = 0; i < (max || 600); i++) {
    const vorher = Pool.stand().zaehler.jobs;
    Pool.beiGrenze(g); Pool.update(g, 0.1);
    await Pool.jobFertig();
    if (Pool.stand().zaehler.jobs === vorher) break;
  }
}

// ======================================================================
section('Daten: Slots, Laengen, Katalog, Quelltext', () => {
  const roh = TW.slots.wert, neuSlots = TW.slots_abenteuer.wert;
  ok(Object.keys(roh).length === 7 && !('bitte' in roh), 'die sieben Slots des Reise-Funks bleiben unveraendert (ein Test des Pools fixiert sie)');
  ok(['bitte', 'wendung', 'abschluss_gelungen', 'abschluss_gescheitert'].every((s) => neuSlots[s] && neuSlots[s].min >= 15 && neuSlots[s].max > neuSlots[s].min && neuSlots[s].max <= 230 && neuSlots[s].aufgabe.length > 30), 'die vier neuen Slots stehen als Daten mit Laengen und Aufgabe (texte-werte.json slots_abenteuer)');
  ok(Object.keys(Pruefer.WERTE.slots).length === 11 && Pool.SLOTS.includes('bitte') && Pool.SLOTS.includes('abschluss_gescheitert'), 'der Pool kennt beide Gruppen (elf Slots)');
  ok(TW.platzhalter_erlaubt.wert.includes('nsc') && TW.platzhalter_erlaubt.wert.includes('ware'), 'Platzhalter nsc und ware sind erlaubt (Daten)');
  ok(Object.keys(Pruefer.WERTE.slots_abenteuer).every((s) => Pruefer.schemaFuer(s).properties.text.minLength === Pruefer.WERTE.slots[s].min), 'das Schema je neuem Slot kennt die Mindestlaenge');
  ok(AP.katalogFehler().length === 0, 'der Katalog der Absichten ist stimmig, auch die `texte` (Slots, Beats, Platzhalter, Rueckfalltexte bestehen den Pruefer)');
  ok(AT.werteFehler().length === 0, 'die Daten abenteuer-texte.json sind stimmig');
  const mit = Object.entries(KAT.absichten).filter(([, e]) => e.texte).map(([k]) => k);
  ok(mit.includes('rache') && mit.includes('wiedersehen') && mit.length >= 3, 'mindestens rache, wiedersehen und eine Absicht ohne Bezug tragen `texte` (' + mit.join(', ') + ')');
  const schlecht = klon(KAT); schlecht.absichten.rache.texte.slots.wendung.beat = 'irgendwo';
  schlecht.absichten.rache.texte.slots.bitte.platzhalter = ['nsc', 'ort', 'ware'];
  schlecht.absichten.rache.texte.slots.abschluss_gelungen.rueckfall[0].text = 'Hier spricht Quintus Varro, ich danke euch.';
  schlecht.absichten.wiedersehen.texte.slots.dank = { beat: 'erster', szene: 'x' };
  const f = AP.katalogFehler(schlecht).join('\n');
  ok(/beat ist einer von/.test(f) && /platzhalter: Liste erlaubter/.test(f) && /besteht den Pruefer nicht/.test(f) && /kein Slot der Abenteuer-Zeilen/.test(f), 'ein kaputter Eintrag wird gefunden: falscher Beat, Platzhalter ware ohne Parameter, Klartextname im Rueckfall, unbekannter Slot');
  const sim = path.join(__dirname, '..', 'server', 'sim');
  const src = ['abenteuer-texte.js'].map((fn) => fs.readFileSync(path.join(sim, fn), 'utf8')).join('\n').split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n').replace(/\/\/.*$/gm, '');
  const quoted = (w) => new RegExp('[\'"`]' + w + '[\'"`]').test(src);
  const namen = Object.keys(KAT.absichten).concat(Object.keys(D.BEATS), Object.keys(neuSlots), [].concat(...Object.values(KAT.absichten).map((e) => e.wendungen || [])).filter((w) => w !== 'keine'));
  const treffer = namen.filter((w, i) => namen.indexOf(w) === i && quoted(w));
  ok(treffer.length === 0, 'kein Absichtsname, Beat-Typ, Slotname oder Wendungs-Symbol als Zeichenkette in abenteuer-texte.js (geprueft: ' + new Set(namen).size + (treffer.length ? '; Treffer: ' + treffer.join(', ') : '') + ')');
  ok(Stufen.stufeFuerSlot(Stufen.lade({}), 'bitte') === null, 'die neuen Slots haben keine Stufe in stufen.json: sie laufen wie die Art text (Ollama), kein Weg zu Claude');
});

section('Pruefer fuer Zeilen mit Bezug', () => {
  const FAKT = '{nsc} funkt die Lerche an. Die Crew ist {nsc} etwas schuldig geblieben. Ton: bitter.';
  const c = (o) => Object.assign({ slot: 'bitte', platzhalter: ['nsc', 'ort'], pflicht: ['nsc'], stimme: 'rom', namen: [], bezug: true, fakt: FAKT, ausnahmen: KAT.werte.gewoehnliche_woerter.wert, anrede: 'ihr', nicht: ['dank'] }, o || {});
  const p = (t, o) => Pruefer.pruefe(t, c(o));
  const gut = p('Hier spricht {nsc}. Ihr schuldet mir noch eine Abrechnung, und ich erwarte euch bei {ort}.');
  ok(gut.ok, 'eine gute Zeile mit Platzhaltern besteht (' + gut.fehler.join('; ') + ')');
  const kn = p('Hier spricht Quintus Varro. Ihr schuldet mir noch eine Abrechnung bei {ort}, {nsc}.');
  ok(!kn.ok && kn.fehler.some((e) => /Eigenname im Klartext/.test(e)), 'Klartextname (Vor- und Nachname) wird abgelehnt: ' + kn.fehler.join('; '));
  const kn2 = p('{nsc} wartet bei Vulcania auf euch und will seine Abrechnung.');
  ok(!kn2.ok && kn2.fehler.some((e) => /Eigenname im Klartext/.test(e) && /Vulcania/.test(e)), 'ein Ortsname im Klartext wird abgelehnt (Orte sind {ort})');
  const kn3 = p('Hier spricht {nsc}. Ihr schuldet Dorn nichts, aber ich erwarte euch bei {ort}.');
  ok(kn3.ok, 'ein gewoehnliches Wort aus den Namenslisten (Dorn, gewoehnliche_woerter in absichten.json) ist kein Eigenname (' + kn3.fehler.join('; ') + ')');
  const er = p('Hier spricht {nsc}. Die Legio wird euch bei {ort} richten und eure Abrechnung bekommen.');
  ok(!er.ok && er.fehler.some((e) => /erfunden/.test(e) && /Legio/.test(e)), 'die erfundene Legio (Erkundung) wird abgelehnt: ' + er.fehler.join('; '));
  ok(p('Hier spricht {nsc}. Die Legio will euch bei {ort}.', { fakt: FAKT + ' Die Legio steht hinter {nsc}.' }).ok, 'steht die Legio im fakt, ist sie keine Erfindung');
  const er2 = p('Hier spricht {nsc}. Ihr habt bei {ort} den Hof Kaltenbruch verloren, Abrechnung folgt.');
  ok(!er2.ok && er2.fehler.some((e) => /Kaltenbruch/.test(e)), 'ein beliebiger erfundener Eigenname wird abgelehnt (gross, mitten im Satz, nicht im fakt): ' + er2.fehler.join('; '));
  const ohneNsc = p('Ihr schuldet mir noch eine Abrechnung, und ich erwarte euch bei {ort}.');
  ok(!ohneNsc.ok && ohneNsc.fehler.some((e) => /Platzhalter \{nsc\} fehlt/.test(e)), 'der Bezug muss als Platzhalter {nsc} vorkommen (pflicht), nicht als Name');
  const sie = p('Hier spricht {nsc}. Denken Sie an die Abrechnung, ich erwarte euch bei {ort}.');
  ok(!sie.ok && sie.fehler.some((e) => /falsche Anrede/.test(e)), 'die Sie-Form wird abgelehnt (Erkundung: Zeile siezte): ' + sie.fehler.join('; '));
  ok(p('Hier spricht {nsc}. Wenn sie kommt, ist das ihre Sache, ich erwarte euch bei {ort}.').ok, 'sie (dritte Person, klein) ist keine Sie-Form');
  const dank = p('Danke, ihr habt mich bei {ort} geschlagen. {nsc} vergisst das nicht.');
  ok(!dank.ok && dank.fehler.some((e) => /darf .*nicht enthalten/.test(e)), 'Dank in der Zeile der Rache wird abgelehnt (nicht-Regel der Absicht)');
  const alt = Pruefer.pruefe('Hier spricht Quintus Varro und die Legio erwartet Sie bei {ort}.', { slot: 'ankuendigung', platzhalter: ['ort'], pflicht: [], stimme: 'rom', namen: [] });
  ok(alt.ok, 'ohne bezug in der Spec bleibt der Pruefer wie vorher: Klartextnamen, Erfindung und Sie-Form sind dort keine Fehler (Reise-Funk byte-gleich)');
  const sp = Pruefer.pruefe('Hier spricht {nsc} bei {ort} und erwartet Mireille_Kas.', c({ namen: ['Mireille_Kas'] }));
  ok(!sp.ok && sp.fehler.some((e) => /Spielernamen/.test(e)), 'ein Spielername wird weiter abgelehnt');
  // alle Rueckfalltexte des Katalogs (mit denselben Platzhaltern) bestehen den Pruefer: das prueft auch der Katalog-Test, hier als Zaehlung
  let zahl = 0;
  for (const [, e] of Object.entries(KAT.absichten)) for (const s of Object.values((e.texte && e.texte.slots) || {})) zahl += (s.rueckfall || []).length;
  ok(zahl >= 5, 'der Katalog traegt Rueckfalltexte (' + zahl + '), alle mit Platzhaltern statt Namen');
});

section('Dramaturgie-Beleg: Bogen in der Beat-Folge UND in den Specs der passenden Beats', () => {
  const g = welt8(71, ENV);
  const st = rache(g);
  ok(st.stand === 'angenommen', 'Vorbedingung: die Rache an Quintus wird angenommen (Plan mit Wendung verfolgung)');
  const typen = st.angebot.vorlage.beats.map((b) => b.typ);
  ok(typen[0] === 'rache' && typen[1] === 'verfolgung' && typen[typen.length - 1] === 'abschluss', 'die Wendung ist ein Beat der Folge: ' + typen.join(' > '));
  const r = specs(g, st.absicht, st.inszenierung, st.angebot);
  const slots = r.eintraege.map((e) => e.slot).sort().join();
  ok(r.fehler.length === 0 && slots === 'abschluss_gelungen,abschluss_gescheitert,bitte,wendung', 'vier Specs: Bitte, Wendung, Abschluss gelungen und gescheitert (' + slots + ')');
  const b = specVon(r, 'bitte'), w = specVon(r, 'wendung'), a1 = specVon(r, 'abschluss_gelungen'), a2 = specVon(r, 'abschluss_gescheitert');
  ok(b.beat.nr === 0 && b.beat.typ === 'rache' && w.beat.nr === 1 && w.beat.typ === 'verfolgung' && a1.beat.nr === typen.length - 1 && a1.beat.typ === 'abschluss' && a2.beat.nr === a1.beat.nr, 'die Specs haengen an den passenden Beats: Bitte am ersten, Wendung am Beat der Wendung, Abschluss am letzten');
  ok(/feindlich/.test(b.spec.fakt) && /schuldig geblieben/.test(b.spec.fakt) && /gescheitert/.test(b.spec.fakt) && /Groll/.test(b.spec.fakt), 'Bitte: der fakt nennt Zustand feindlich, den frueheren Ausgang (gescheitert, schuldig geblieben) und den Groll (Haltung -2)');
  ok(/bitter/.test(b.spec.fakt) && /Genugtuung/.test(b.spec.fakt) && !/Quintus|Varro/.test(b.spec.fakt) && /\{nsc\}/.test(b.spec.fakt) && /\{ort\}/.test(b.spec.fakt), 'Bitte: Ton und Einsatz des Bogens stehen im fakt, der Name des Einsatzes nur als {nsc}');
  ok(/setzt sich ab/.test(w.spec.fakt) && /jagen/.test(w.spec.fakt) && w.spec.optionId.includes('verfolgung'), 'Wendung: der fakt traegt die Fakten der Wendung verfolgung (aus den Daten), die Variante nennt sie');
  ok(/Ansehen/.test(a1.spec.fakt) && /Ansehen/.test(a2.spec.fakt) && /Preis/.test(a2.spec.fakt) && /Ausgang/.test(a2.spec.fakt) && !/Quintus/.test(a2.spec.fakt), 'Abschluss: der Preis des Bogens steht im fakt, Name als Platzhalter');
  ok(r.eintraege.every((e) => !/dank/i.test(e.spec.fakt)) && [b, w, a1, a2].every((e) => e.spec.nicht.includes('dank')), 'die Specs einer Rache nennen Rache-Fakten, nie Dank (und verbieten ihn im Text)');
  ok(r.eintraege.every((e) => e.spec.bezug === true && e.spec.anrede === 'ihr' && e.spec.art === 'abenteuer' && e.spec.id === 'rache' && e.spec.stimme === 'rom' && !/Quintus|Varro/.test(e.spec.sprecher + e.spec.fakt + e.spec.beispiele.join(' '))), 'jede Spec: bezug, Anrede, Pool-Art und Absicht als Id; weder Sprecher noch fakt noch Stilvorlagen nennen einen Namen');
  ok(r.eintraege.every((e) => !/Mireille|Ouzo|Tzvi/.test(JSON.stringify(e.spec))), 'kein Spielername in einer Spec');
  // ohne Wendung: kein Slot wendung; zweite_welle: der Beat der Wendung ist eine Schlacht
  const g2 = welt8(72, ENV);
  const s0 = rache(g2, { bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis } });
  const r0 = specs(g2, s0.absicht, s0.inszenierung, s0.angebot);
  ok(s0.stand === 'angenommen' && r0.eintraege.map((e) => e.slot).sort().join() === 'abschluss_gelungen,abschluss_gescheitert,bitte', 'ohne Wendung im Bogen gibt es keinen Slot wendung');
  const g3 = welt8(73, ENV);
  const s3 = rache(g3, { bogen: { einsatz: TEXT.einsatz, wendung: 'zweite_welle', preis: TEXT.preis } });
  const r3 = specs(g3, s3.absicht, s3.inszenierung, s3.angebot);
  ok(s3.stand === 'angenommen' && specVon(r3, 'wendung').beat.typ === 'raumschlacht' && /Verstaerkung/.test(specVon(r3, 'wendung').spec.fakt), 'zweite_welle: der Slot haengt an der eingebauten Schlacht, der fakt nennt die Verstaerkung');
  // Gegenprobe: ein Wiedersehen mit einer Verbuendeten spricht von Sympathie, nicht von Groll, und verbietet den Dank nicht
  const g4 = welt8(74, ENV);
  const s4 = Absicht.ersterVersuch(g4, ab('wiedersehen', { bezug: { nsc: kennungVon(g4, 'Livia Serran') }, ton: 'hoffnungsvoll' }), G.geschichteZeilen(g4).kennungen);
  const r4 = specs(g4, s4.absicht, s4.inszenierung, s4.angebot);
  const b4 = specVon(r4, 'bitte'), z4 = specVon(r4, 'abschluss_gelungen');
  ok(s4.stand === 'angenommen' && /verbuendet/.test(b4.spec.fakt) && /Sympathie/.test(b4.spec.fakt) && !/Groll|feindlich/.test(b4.spec.fakt) && !z4.spec.nicht.includes('dank'), 'Wiedersehen mit Livia Serran: Verbuendete, Sympathie, kein Verbot von Dank (die Absicht steuert die Zeile)');
  ok(b.spec.optionId !== b4.spec.optionId && b.spec.id !== b4.spec.id, 'die Schluessel im Pool unterscheiden Absicht und Variante');
  // Spielername und Klartextname im Freitext des Bogens: das Feld faellt weg, nie in den fakt
  const roh = klon(st.absicht); roh.bogen = { einsatz: 'Mireille_Kas hat Gaius Fabrin enttaeuscht.', wendung: 'verfolgung', preis: 'Quintus nimmt sich, was ihm zusteht.' };
  const r5 = specs(g, roh, st.inszenierung, st.angebot);
  const b5 = specVon(r5, 'bitte'), a5 = specVon(r5, 'abschluss_gescheitert');
  ok(b5.weggelassen && b5.weggelassen.includes('einsatz') && !/Mireille|Fabrin/.test(b5.spec.fakt), 'ein Einsatz mit Spielername und fremdem Klartextnamen faellt aus dem fakt');
  ok(!/Quintus/.test(a5.spec.fakt) && /\{nsc\} nimmt sich/.test(a5.spec.fakt), 'der Preis mit dem Vornamen des Bezugs wird zu {nsc} (Namen nur als Platzhalter)');
  // ein Bezug, den die Welt nicht kennt: BEZUG_UNBEKANNT, keine Spec
  const fremd = klon(st.absicht); fremd.bezug = { nsc: 'Nemo Unbekannt' };
  const r6 = specs(g, fremd, st.inszenierung, st.angebot);
  ok(r6.eintraege.length === 0 && r6.fehler.length === 1 && r6.fehler[0].code === AP.CODES.BEZUG_UNBEKANNT, 'ein Bezug ohne Kanon-Eintrag: BEZUG_UNBEKANNT und keine Spec (der Katalog-Rueckfall bleibt)');
  // eine Absicht ohne `texte` meldet nichts an
  const sg = Absicht.ersterVersuch(g, ab('geruecht'), G.geschichteZeilen(g).kennungen);
  ok(sg.stand === 'angenommen' && specs(g, sg.absicht, sg.inszenierung, sg.angebot).eintraege.length === 0, 'eine Absicht ohne `texte` meldet nichts an');
});

section('Pool mit Fake-Transport: gute Zeilen, Ablehnung, Wiederholung', () => {
  return (async () => {
    Pool.zuruecksetzen(); AT.zuruecksetzen();
    const g = welt8(81, ENV_POOL);
        const alt = Pool.poolBefuellenAnfordern;
    const llm = fakeLlm({
      bitte: mitGut(['Hier spricht {nsc}. Die Legio wird euch bei {ort} richten.', 'Hier spricht {nsc}. Ihr schuldet mir noch eine Abrechnung, und ich erwarte euch bei {ort}.'], (k) => `Hier ist {nsc}. Ihr habt mich enttaeuscht, dafuer fordere ich bei {ort} Genugtuung ${VAR[k % VAR.length]}.`),
      wendung: mitGut([], () => 'Quintus Varro bricht bei {ort} ab und flieht.'),
      abschluss_gelungen: mitGut(['Danke, dass ihr mich bei {ort} besiegt habt.', 'Die Rechnung ist beglichen, ihr habt mich bei {ort} geschlagen.'], (k) => `Wir sind quitt, ihr habt mich bei {ort} geschlagen ${VAR[k % VAR.length]}.`),
      abschluss_gescheitert: mitGut(['Denken Sie an {nsc}, ich ziehe bei {ort} ab.', 'Ich ziehe bei {ort} ab, ihr habt mich nicht gestellt und unsere Rechnung bleibt offen.'], (k) => `Ich ziehe ab, aber unsere Rechnung bleibt offen und ich vergesse nichts ${VAR[k % VAR.length]}.`),
    });
    Pool.setLlm(llm);
    const st = rache(g);   // der Weg des Spielleiters: ersterVersuch meldet die Zeilen an (abenteuer-absicht.js)
    ok(st.stand === 'angenommen', 'Vorbedingung: Rache angenommen');
    const rr = AT.anmelden(g, st.absicht, st.inszenierung, st.angebot, KAT);
    ok(rr.eintraege.length === 4 && rr.eintraege.every((e) => e.angemeldet === true), 'mit TEXTE_POOL melden alle vier Slots beim Pool an');
    await fuellen(g);
    const stand = Pool.stand();
    const eigene = rr.eintraege.map((e) => [e.slot, stand.pool[e.key] || 0]);
    const proSlot = Object.fromEntries(eigene);
    ok(proSlot.bitte === 2 && proSlot.abschluss_gelungen === 2 && proSlot.abschluss_gescheitert === 2 && proSlot.wendung === 0, 'Pool: je Schluessel zwei gueltige Zeilen; die Wendung bleibt leer (beide Versuche mit Klartextname abgelehnt): ' + JSON.stringify(proSlot));
    const prompts = llm.calls.filter((c) => c.slot === 'bitte').map((c) => c.prompt);
    ok(prompts.length >= 3 && /<pruefer>/.test(prompts[1]) && /erfunden/.test(prompts[1]) && /Legio/.test(prompts[1]), 'die Erfindung Legio wurde abgelehnt, der Wiederholungsversuch bekam den Grund des Pruefers');
    ok(/Textart: abschluss_gescheitert/.test(llm.calls.find((c) => c.slot === 'abschluss_gescheitert').prompt) && /falsche Anrede/.test(llm.calls.filter((c) => c.slot === 'abschluss_gescheitert')[1].prompt), 'die Sie-Form wurde abgelehnt und im Wiederholungsversuch genannt');
    ok(/darf .*nicht enthalten/.test(llm.calls.filter((c) => c.slot === 'abschluss_gelungen')[1].prompt), 'der Dank im Abschluss der Rache wurde abgelehnt');
    const erster = llm.calls.find((c) => c.slot === 'bitte').prompt;
    ok(/<lage>/.test(erster) && /feindlich/.test(erster) && /schuldig geblieben/.test(erster) && /\{nsc\}/.test(erster) && !/Quintus|Varro|Mireille|Ouzo|Tzvi/.test(erster) && /Erlaubte Platzhalter: \{nsc\}, \{ort\}; im Text m.ssen vorkommen: \{nsc\}/.test(erster), 'der Prompt des Pools traegt den Bogen und die Bezug-Fakten, nur Platzhalter, nie einen Namen');
    const z = Pool.stand().zaehler;
    ok(z.gueltig_2 >= 3 && z.ungueltig >= 1, 'Zaehler: gueltig im zweiten Versuch ' + z.gueltig_2 + ', ungueltig ' + z.ungueltig);
    // was im Pool liegt, besteht den Pruefer und nennt keinen Namen
    const keys = rr.eintraege.map((e) => e.key);
    let alle = 0, sauber = true;
    for (const e of rr.eintraege) {
      const spec = specVon(specs(g, st.absicht, st.inszenierung, st.angebot), e.slot).spec;
      for (let i = 0; i < (stand.pool[e.key] || 0); i++) {
        const t = Pool.poolEntnehmen(spec.art, spec.id, spec.slot, spec.optionId);
        alle++;
        const p = AT.pruefeZeile(t, Object.assign({}, spec, { beispiele: [] }), NAMEN);
        if (!p.ok || /Legio|Quintus|Varro|\bSie\b/.test(t)) sauber = false;
      }
    }
    ok(alle === 6 && sauber && keys.length === 4, 'alle sechs Pool-Texte bestehen den Pruefer erneut, keiner enthaelt Legio, einen Namen oder die Sie-Form');
    Pool.poolBefuellenAnfordern = alt;
  })();
});

section('Haken zeile: Pool, Rueckfall, Schalter aus', () => {
  return (async () => {
    // Faden mit dem NSC der Rache: das Oeffnen wie im Katalog-Test (nsc_von)
    const oeffne = (g, st, name) => {
      const id = Faden.wiedersehenKandidaten(g, st.angebot.vorlage).find((x) => Faden.nscVon(g, x).name === name);
      const o = Faden.abenteuerOeffnen(g, st.angebot.nr, { nsc_von: id });
      return o.ok ? o.faden : null;
    };
    Pool.zuruecksetzen(); AT.zuruecksetzen();
    const g = welt8(91, ENV_POOL);
    const llm = fakeLlm({
      bitte: mitGut([], (k) => `Hier spricht {nsc}. Ihr schuldet mir noch eine Abrechnung, ich erwarte euch bei {ort} ${VAR[k % VAR.length]}.`),
      wendung: mitGut([], () => 'Quintus Varro bricht bei {ort} ab und flieht.'),
    });
    Pool.setLlm(llm);
    const st = rache(g);
    const f = oeffne(g, st, 'Quintus Varro');
    ok(f && f.vorlage === st.angebot.ref && f.nsc.name === 'Quintus Varro', 'Vorbedingung: der geoeffnete Faden traegt die Vorlage-Id des Angebots (die Zuordnung der Zeilen haengt daran)');
    const beats = D.vorlage(f.vorlage).beats;
    const bid = (i) => beats[i].id;
    // Pool leer: der Rueckfall der Absicht (Katalog, Daten) mit eingesetzten Namen
    const r0 = AT.zeile(g, f, bid(0), 'bitte');
    ok(r0 && r0.quelle === 'rueckfall' && /^Hier spricht Quintus Varro\. Ihr schuldet mir noch etwas/.test(r0.text) && !/\{/.test(r0.text), 'Pool leer: der Rueckfall der Absicht mit Namen eingesetzt (' + (r0 && r0.text) + ')');
    await fuellen(g);
    const r1 = AT.zeile(g, f, bid(0), 'bitte');
    ok(r1 && r1.quelle === 'pool' && /^Hier spricht Quintus Varro\. Ihr schuldet mir noch eine Abrechnung, ich erwarte euch bei /.test(r1.text) && !/\{/.test(r1.text) && /bei Ostia Nova/.test(r1.text), 'Pool-Zeile mit eingesetztem Vollnamen und Ortsnamen (' + (r1 && r1.text) + ')');
    // die Wendung: der Pool lehnte beide Versuche ab, also der Rueckfall der Wendung (aus den Daten der Wendung)
    const rw = AT.zeile(g, f, bid(1), 'wendung');
    ok(rw && rw.quelle === 'rueckfall' && /Hier ist Quintus Varro\. Ich breche ab/.test(rw.text), 'Pruefer lehnt ab, Pool leer: der Rueckfall der Wendung greift (' + (rw && rw.text) + ')');
    // Abschluss: der Rueckfall der Rache erzwingt keinen Dank (der Text der Fadenmaschine fuer den Abschluss waere: Danke, dass ihr mit mir gegangen seid)
    const ra = AT.zeile(g, f, bid(beats.length - 1), 'abschluss_gelungen');
    ok(ra && ra.quelle === 'rueckfall' && !/dank/i.test(ra.text) && /Rechnung/.test(ra.text), 'Abschluss gelungen bei feindlichem NSC: Rueckfall ohne Dank (' + (ra && ra.text) + ')');
    const rb = AT.zeile(g, f, bid(beats.length - 1), 'abschluss_gescheitert');
    ok(rb && !/dank/i.test(rb.text) && /Rechnung/.test(rb.text), 'Abschluss gescheitert: Rueckfall nennt die offene Rechnung (' + (rb && rb.text) + ')');
    // falscher Beat oder Slot: kein Eintrag (die Fadenmaschine behaelt ihren Text)
    ok(AT.zeile(g, f, bid(0), 'abschluss_gelungen') === null && AT.zeile(g, f, bid(0), 'unbekannt') === null && AT.zeile(g, { vorlage: 'v_gibt_es_nicht' }, bid(0), 'bitte') === null && AT.zeile(g, null, 'x', 'bitte') === null, 'ein Slot an einem anderen Beat, ein unbekannter Slot, ein fremder Plan: null');
    // der Zustand steuert den Rueckfall (Daten): ein Katalog mit einer Bedingung auf Verbuendete, danach der Standard
    const kat = klon(KAT);
    kat.absichten.rache.texte.slots.abschluss_gelungen.rueckfall = [{ wenn: { nsc_status: ['verbuendet'] }, text: 'Wir sind Freunde geworden.' }, { wenn: { haltung_hoechstens: -1 }, text: 'Der Groll bleibt, aber die Rechnung ist beglichen.' }, { text: 'Es ist vorbei.' }];
    const g2 = welt8(92, ENV_POOL);
    const s2 = Absicht.ersterVersuch(g2, ab('rache', { bezug: { nsc: kennungVon(g2, 'Quintus Varro') }, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'bitter' }), G.geschichteZeilen(g2).kennungen);
    AT.anmelden(g2, s2.absicht, s2.inszenierung, s2.angebot, kat);
    const f2 = oeffne(g2, s2, 'Quintus Varro');
    const l2 = D.vorlage(f2.vorlage).beats.length - 1;
    ok(AT.zeile(g2, f2, D.vorlage(f2.vorlage).beats[l2].id, 'abschluss_gelungen').text === 'Der Groll bleibt, aber die Rechnung ist beglichen.', 'Rueckfall nach Haltung: feindlich mit Haltung -2 waehlt den Eintrag mit haltung_hoechstens (nicht den fuer Verbuendete)');
    f2.nsc.status = 'verbuendet'; f2.nsc.haltung = 2;
    ok(AT.zeile(g2, f2, D.vorlage(f2.vorlage).beats[l2].id, 'abschluss_gelungen').text === 'Wir sind Freunde geworden.', 'Rueckfall nach Zustand: als Verbuendeter der erste Eintrag');
    // Wiedersehen mit einer Verbuendeten: kein Rueckfall fuer den gelungenen Abschluss (null: der Dank der Fadenmaschine ist dort richtig)
    const g3 = welt8(93, ENV_POOL);
    const s3 = Absicht.ersterVersuch(g3, ab('wiedersehen', { bezug: { nsc: kennungVon(g3, 'Livia Serran') }, ton: 'hoffnungsvoll' }), G.geschichteZeilen(g3).kennungen);
    const f3 = oeffne(g3, s3, 'Livia Serran');
    const b3 = D.vorlage(f3.vorlage).beats;
    ok(AT.zeile(g3, f3, b3[b3.length - 1].id, 'abschluss_gelungen') === null, 'Wiedersehen, Abschluss gelungen: kein Rueckfall in den Daten, null (der Dank der Fadenmaschine bleibt)');
    // Schalter aus: kein Pool-Aufruf, kein Anmelden beim Pool, aber der Rueckfall der Absicht gilt
    Pool.zuruecksetzen(); AT.zuruecksetzen();
    const g4 = welt8(94, ENV);
    const alt = Pool.poolBefuellenAnfordern; let angefordert = 0;
    Pool.poolBefuellenAnfordern = (...a) => { angefordert++; return alt(...a); };
    const s4 = rache(g4);
    Pool.poolBefuellenAnfordern = alt;
    const f4 = oeffne(g4, s4, 'Quintus Varro');
    const z4 = AT.zeile(g4, f4, D.vorlage(f4.vorlage).beats[0].id, 'bitte');
    ok(angefordert === 0 && !Pool.aktiv(g4) && z4 && z4.quelle === 'rueckfall', 'ohne TEXTE_POOL: nichts beim Pool angemeldet, der Rueckfall der Absicht gilt (' + (z4 && z4.quelle) + ')');
    Pool.zuruecksetzen(); AT.zuruecksetzen();
  })();
});

// ======================================================================
(async () => {
  for (const [name, fn] of abschnitte) {
    if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
    console.log('\n== ' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme in ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
  }
  console.log(`\n${n - fails}/${n} Pruefungen gruen` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})();
