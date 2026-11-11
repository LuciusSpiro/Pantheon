'use strict';
// FRE-02 B1: Herkunft (Hafen), Absicht und Anzeige am Angebot (server/sim/abenteuer-brett.js: neuAnbieten, angebotAusstatten, snapshot, toSave, lesen). Das Angebot traegt `herkunft: { hex }` (der Hafen, an dem die Crew es
// bekam; das Ziel steht in angebot.hex) und, wo der Weg ueber eine Absicht lief, `absicht` (absicht/1, nur im Weltstand, nie im Snapshot: Voraussetzung fuer den Vorrat, Paket C). Der Snapshot nennt `hafen` (Name) und
// kennzeichnet ein Angebot, dessen Beat den Ort selbst waehlt (beats.json verlegt_ort), mit ort_offen (ort/ortname leer): ein angezeigtes Ziel waere dort irrefuehrend. Auftraggeber bleibt `von` (Fraktion).
// Geprueft ueber die echten Wege: Rueckfall (Standardplaene und Absichten, game.lageGrenze('andocken')), Komponist (Mock, Beat-Plan und Absichten), anbietenAusAbsicht, Weltstand (capture/restore), Snapshot.
// Die Erwartungen stehen hier selbst: Haefen und Beat-Flags von Hand und aus den Daten, die Obergrenze aus content/faeden/absichten.json.
// Aufruf: node tools/test-abenteuer-herkunft.js        (npm run test:abenteuer-herkunft)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Ziel = require('../server/sim/abenteuer-ziel.js');
const INS = require('../server/sim/inszenierer.js');
const AP = require('../server/sim/absicht-pruefer.js');
const Daten = require('../server/sim/faden-daten.js');
const { D, Faden, F } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const KAT = AP.katalogStandard();
const BEATS = lies('content/faeden/beats.json').beats;
const ABS_MAX = lies('content/faeden/absichten.json').werte.absicht_max_zeichen.wert;
const BRETT = lies('content/faeden/abenteuer-brett.json').werte;
const HAEFEN = [['0305', 'Ostia Nova'], ['0603', 'Kantenstein'], ['0105', 'Carrara']];
const hexname = (h) => Sektoren.hexName(h);
const SPIELER = 'Bo';
const TEXT = { titel: 'Zebrafalke Probe Titel', einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', preis: 'Ein Preis ohne Namen fuer den Test.' };
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const frei = () => new Promise((r) => setImmediate(r));
const FOLGEN = [['konvoi'], ['spur'], ['geruecht'], ['konvoi', 'spur'], ['spur', 'konvoi'], ['geruecht', 'spur'], ['konvoi', 'geruecht'], ['geruecht', 'konvoi'], ['spur', 'geruecht']];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function neu(seed, o) {
  o = o || {};
  const env = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' };
  if (o.absichten) env.ABENTEUER_ABSICHTEN = '1';
  const t = F.neuesSpiel({ crew: 1, seed, names: [SPIELER], env });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: o.komponist ? { cooldown_grenzen: 1 } : { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  if (o.rueckfall) delete t.g.env.ABENTEUER_ANSCHLUSS;
  return t;
}
const zust = (g) => Faden.zustandVon(g);
const angebote = (g) => zust(g).abenteuerAngebote;
const hafenSetzen = (g, hex) => { g.ship.scene = Sektoren.ortVonHex(hex); };
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats }, o || {});
const rueckfall = (seed, hafen, o) => {
  const t = neu(seed, Object.assign({ rueckfall: true }, o || {})), g = t.g;
  angebote(g).length = 0; hafenSetzen(g, hafen);
  g.lageGrenze('andocken');
  return { t, g, a: angebote(g)[0] || null };
};
const sim = (g) => JSON.parse(JSON.stringify(Weltstand.capture(g).welt.sim));
const laden = (s, seed, o) => { const t2 = neu(seed, o); Kriegslage.restore(t2.g, s); return t2; };

console.log('\nRueckfall mit Standardplaenen (anschluss.json): Herkunft ist der Hafen, nie das Ziel');
{
  for (const [hafen, name] of HAEFEN) {
    const { g, a } = rueckfall(31, hafen);
    ok(!!a && eq(a.herkunft, { hex: hafen }), `${name}: angebot.herkunft = { hex: ${hafen} } (${JSON.stringify(a && a.herkunft)})`);
    ok(a && a.hex !== hafen && a.herkunft.hex !== a.hex, `${name}: Herkunft ist nicht das Ziel (${a && a.hex})`);
    ok(a && a.absicht === undefined, `${name}: ein Standardplan hat keine Absicht`);
    ok(g.errors === 0, `${name}: keine Serverfehler`);
  }
  // Garantie: ohne Ziel im Umkreis liegt das Angebot am Hafen, die Herkunft bleibt der Hafen
  const alt = Daten.WERTE.abenteuer.angebot_radius_spruenge;
  Daten.WERTE.abenteuer.angebot_radius_spruenge = 0;
  try { const { a } = rueckfall(31, '0305'); ok(!!a && a.hex === '0305' && eq(a.herkunft, { hex: '0305' }), 'Radius 0: das Angebot liegt am Hafen, die Herkunft ist der Hafen'); } finally { Daten.WERTE.abenteuer.angebot_radius_spruenge = alt; }
}

console.log('\nRueckfall im Modus Absichten: Herkunft = Hafen, die Absicht bleibt am Angebot');
{
  const umgestellt = ['konvoi', 'geleit'], orig = {};
  let anzahl = 0, ziel = 0, fehler = 0, ohneAbsicht = 0;
  for (const k of umgestellt) { orig[k] = KAT.absichten[k].inszenierung.ort; KAT.absichten[k].inszenierung.ort = { regel: 'ziel_im_umkreis' }; }   // damit Ziel und Hafen auseinanderfallen (wie test-abenteuer-ziel-absichten)
  try {
    for (const [hafen] of HAEFEN) for (let seed = 60; seed < 70; seed++) {
      const { g, a } = rueckfall(seed, hafen, { absichten: true });
      if (!a) continue;
      anzahl++;
      if (!eq(a.herkunft, { hex: hafen })) fehler++;
      if (!a.absicht || a.absicht.format !== 'absicht/1' || typeof a.absicht.absicht !== 'string' || !KAT.absichten[a.absicht.absicht]) ohneAbsicht++;
      if (a.hex !== hafen) ziel++;
      if (g.errors) fehler++;
    }
  } finally { for (const k of umgestellt) KAT.absichten[k].inszenierung.ort = orig[k]; }
  ok(anzahl >= 20 && fehler === 0, `${anzahl} Rueckfaelle in drei Haefen: jede Herkunft ist der Hafen, keine Serverfehler`);
  ok(ohneAbsicht === 0, 'jedes Angebot des Rueckfalls traegt seine Absicht (absicht/1, Name aus dem Katalog)');
  ok(ziel >= 3, `mindestens drei Angebote liegen an einem Ziel, das nicht die Herkunft ist (${ziel})`);
}

console.log('\nanbietenAusAbsicht: Herkunft und Absicht am Angebot');
{
  const absichten = [];
  for (const [hafen, name, wort] of [['0305', 'Ostia Nova', 'Eins'], ['0603', 'Kantenstein', 'Zwei'], ['0105', 'Carrara', 'Drei']]) {
    const t = neu(8, { absichten: true }), g = t.g;
    angebote(g).length = 0; hafenSetzen(g, hafen);
    const a = ab('notruf', { titel: 'Zebrafalke Probe ' + wort });
    const r = INS.anbietenAusAbsicht(g, a);
    ok(r.ok && eq(r.angebot.herkunft, { hex: hafen }) && r.angebot.hex !== hafen, `${name}: Herkunft = Hafen (${hafen}), das Ziel ist ein anderer Sektor (${r.ok && r.angebot.hex})`);
    ok(r.ok && eq(r.angebot.absicht, a) && r.angebot.absicht !== a, `${name}: die Absicht liegt als Kopie am Angebot`);
    absichten.push(r);
  }
  // das Brett prueft die Absicht selbst: zu gross, Muell und Prototyp-Schluessel werden nicht behalten, das Angebot bleibt
  const g = neu(9, { absichten: true }).g;
  angebote(g).length = 0;
  let zaehler = 0;   // jedes Probeangebot hat eine andere Typenfolge (die Wiederholungsregel lehnt dieselbe Folge der letzten drei ab)
  const probe = (absicht, hex, herkunft) => Brett.neuAnbieten(g, plan(FOLGEN[zaehler++ % FOLGEN.length].map((typ) => ({ typ })).concat([{ typ: 'abschluss' }]), { titel: 'Probe ' + hex }), { hex, herkunft: herkunft === undefined ? '0305' : herkunft, absicht });
  const ziele = Ziel.zielFolge(g, '0305', { belegt: [] });
  const gross = ab('notruf', { titel: 'x'.repeat(ABS_MAX) });
  const grenzeOk = ab('notruf'); grenzeOk.titel = 'y'.repeat(ABS_MAX - JSON.stringify(grenzeOk).length + grenzeOk.titel.length);
  const grenzeZu = Object.assign({}, grenzeOk, { titel: grenzeOk.titel + 'y' });
  ok(JSON.stringify(grenzeOk).length === ABS_MAX && JSON.stringify(grenzeZu).length === ABS_MAX + 1, `Probe: genau ${ABS_MAX} und ${ABS_MAX + 1} Zeichen (absicht_max_zeichen aus content/faeden/absichten.json)`);
  const r1 = probe(grenzeOk, ziele[0]), r2 = probe(grenzeZu, ziele[1]), r3 = probe(gross, ziele[2]);
  ok(r1.ok && !!r1.angebot.absicht && r2.ok && r2.angebot.absicht === undefined && r3.ok && r3.angebot.absicht === undefined, 'Obergrenze: genau absicht_max_zeichen bleibt am Angebot, ein Zeichen mehr nicht; das Angebot bleibt gueltig');
  const muell = [['Text', 'x'], ['Liste', []], ['Zahl', 5], ['ohne Format', { absicht: 'notruf' }], ['falsches Format', ab('notruf', { format: 'absicht/2' })], ['Proto', JSON.parse('{"__proto__":{"x":1},"format":"absicht/1","absicht":"notruf","titel":"t","ton":"n"}')]];
  const nr = []; angebote(g).length = 0;
  const ziele2 = Ziel.zielFolge(g, '0305', { belegt: [] });
  muell.forEach(([name, m], i) => { const r = probe(m, ziele2[i]); nr.push([name, r.ok && r.angebot.absicht === undefined]); angebote(g).length = 0; });
  ok(nr.every(([, v]) => v), 'Muell als Absicht (' + nr.map(([k]) => k).join(', ') + '): nicht behalten, das Angebot bleibt gueltig');
  ok(g.errors === 0, 'keine Serverfehler');
  // ohne Herkunft und ohne Absicht: ein Angebot wie bisher
  angebote(g).length = 0;
  const r4 = probe(undefined, ziele[0], null);
  ok(r4.ok && r4.angebot.herkunft === undefined && r4.angebot.absicht === undefined, 'ohne herkunft und absicht: beide Felder fehlen');
  const r5 = probe(undefined, ziele[1], { hex: 'zzzz' }), r6 = probe(undefined, ziele[2], '0000');
  ok(r5.ok && r5.angebot.herkunft === undefined && r6.ok && r6.angebot.herkunft === undefined, 'eine Herkunft, die kein spielbarer Sektor ist, wird nicht behalten');
}

console.log('\nKomponist (Mock): Herkunft = job.herkunftHex (Hafen beim Start des Aufrufs)');
(async () => {
  {   // Beat-Plan: die Crew fliegt nach dem Start weiter, die Herkunft bleibt der Hafen vom Start
    let a = null, seedOk = null;
    for (let seed = 51; seed < 70 && !a; seed++) {
      const t = neu(seed, { komponist: true }), g = t.g, abt = g.lageSpielleiter.abenteuer;
      angebote(g).length = 0; hafenSetzen(g, '0305');
      const r = abt.beiGrenze('andocken');
      if (!r || !r.gestartet) continue;
      hafenSetzen(g, '0105');
      for (let i = 0; i < 8 && angebote(g).length === 0; i++) { g.step(); await frei(); }
      if (angebote(g).length) { a = angebote(g)[0]; seedOk = seed; }
    }
    ok(!!a && eq(a.herkunft, { hex: '0305' }) && a.hex !== '0305', `Beat-Plan: das Angebot (Seed ${seedOk}) hat die Herkunft 0305 (Hafen beim Start), das Ziel ${a && a.hex}`);
    ok(!!a && a.absicht === undefined, 'Beat-Plan: keine Absicht');
  }
  {   // Modus Absichten: die crew_hex-Rezepte stehen vorueber auf ziel_im_umkreis, damit Ziel und Hafen auseinanderfallen
    const orig = {};
    for (const [k, e] of Object.entries(KAT.absichten)) if (e.inszenierung.ort.regel === 'crew_hex') { orig[k] = e.inszenierung.ort; e.inszenierung.ort = { regel: 'ziel_im_umkreis' }; }
    try {
      let mit = 0;
      for (const [hafen, name] of HAEFEN) {
        const t = neu(81, { komponist: true, absichten: true }), g = t.g, abt = g.lageSpielleiter.abenteuer;
        angebote(g).length = 0; hafenSetzen(g, hafen);
        abt.beiGrenze('andocken');
        const jobHex = abt.job && abt.job.hex;
        for (let i = 0; i < 10 && angebote(g).length === 0; i++) { g.step(); await frei(); }
        const a = angebote(g)[0];
        ok(!!a && jobHex === hafen && eq(a.herkunft, { hex: hafen }) && a.hex !== hafen, `${name}: Absichten, Herkunft = Hafen = job.hex, das Ziel ist ${a && a.hex}`);
        ok(!!a && !!a.absicht && a.absicht.format === 'absicht/1', `${name}: die Absicht des Modells liegt am Angebot`);
        if (a && a.hex !== a.herkunft.hex) mit++;
      }
      ok(mit === 3, 'in allen drei Haefen ist Herkunft nicht gleich Ziel');
    } finally { for (const k of Object.keys(orig)) KAT.absichten[k].inszenierung.ort = orig[k]; }
  }

  console.log('\nSnapshot: hafen, ort_offen, kein Spielername, keine Absicht');
  {
    const t = neu(21, { absichten: true }), g = t.g;
    angebote(g).length = 0;
    const ziele = Ziel.zielFolge(g, '0305', { belegt: [] });
    // Erwartung aus den Daten: je Beat-Typ ein Plan aus Beat und Abschluss; ort_offen genau bei verlegt_ort
    const offenTypen = Object.keys(BEATS).filter((k) => BEATS[k].verlegt_ort === true);
    const festTypen = ['konvoi', 'geleit', 'bitte'].filter((k) => BEATS[k] && BEATS[k].verlegt_ort !== true);
    ok(offenTypen.length >= 1 && festTypen.length >= 1, 'beats.json: es gibt Beat-Typen mit und ohne verlegt_ort (' + offenTypen.join(', ') + ' | ' + festTypen.join(', ') + ')');
    const typen = [offenTypen[0], festTypen[0], festTypen[1]];
    const p = typen.map((ty, i) => plan([{ typ: ty }, { typ: 'abschluss' }], { titel: i === 0 ? SPIELER + ' trifft Boje ' + i : 'Titel ' + i + ' ' + SPIELER, anlass: 'Ein Probeanlass Nummer ' + i + ' ohne Namen' }));
    const res = p.map((pl, i) => Brett.neuAnbieten(g, pl, { hex: ziele[i], herkunft: '0305', absicht: i === 1 ? ab('notruf') : undefined }));
    ok(res.every((r) => r.ok), 'drei Angebote (' + typen.join(', ') + ')' + (res.every((r) => r.ok) ? '' : ' ' + JSON.stringify(res.map((r) => r.grund))));
    const s = Brett.snapshot(g), alle = JSON.stringify(s);
    const e = s ? s.angebote : [];
    ok(e.length === 3 && e.every((x) => x.hafen === hexname('0305').slice(0, BRETT.ort_max.wert)), 'jedes Angebot nennt den Hafen mit Namen (' + hexname('0305') + ')');
    ok(e.length === 3 && e[0].ort === '' && e[0].ortname === '' && e[0].ort_offen === true, 'Beat mit verlegt_ort (' + typen[0] + '): ort und ortname leer, ort_offen: true');
    ok(e.length === 3 && [1, 2].every((i) => e[i].ort === ziele[i] && e[i].ortname === hexname(ziele[i]) && e[i].ort_offen === undefined), 'Beat ohne verlegt_ort (' + typen[1] + ', ' + typen[2] + '): ort und ortname sind das Ziel, kein ort_offen');
    ok(e.every((x) => x.von === 'rom' || x.von === 'ger' || x.von === 'kon' || typeof x.von === 'string'), 'von bleibt die Fraktion des Auftraggebers');
    ok(!new RegExp('\\b' + SPIELER + '\\b').test(alle), 'der Spielername "' + SPIELER + '" steht nirgends im Snapshot (Titel: ' + (e[0] && e[0].titel) + ')');
    ok(!/"absicht"|absicht\/1|nuechtern|Zebrafalke/.test(alle), 'die Absicht steht nicht im Snapshot');
    ok(!('herkunft' in (e[0] || {})), 'der Snapshot kennt kein Feld herkunft (nur hafen)');
    // ohne Herkunft (Altstand) kein Hafen
    angebote(g).length = 0;
    Brett.neuAnbieten(g, plan([{ typ: festTypen[0] }, { typ: 'abschluss' }], { titel: 'Alt' }), { hex: ziele[0] });
    const s2 = Brett.snapshot(g);
    ok(s2 && s2.angebote.length === 1 && !('hafen' in s2.angebote[0]), 'ein Angebot ohne bekannte Herkunft zeigt keinen Hafen');
    // Groesse im Maximalfall: drei Angebote (lange Namen) und ein laufendes Abenteuer; was die neuen Felder kosten
    angebote(g).length = 0;
    const lang = (i) => plan(FOLGEN[3 + i].map((typ) => ({ typ })).concat([{ typ: 'abschluss' }]), { titel: 'Titel ' + i + ' ' + 'a'.repeat(30), anlass: 'Ein Probeanlass Nummer ' + i + ' ' + 'b'.repeat(90) });
    ziele.slice(0, 3).forEach((z, i) => Brett.neuAnbieten(g, lang(i), { hex: z, herkunft: '0305', absicht: ab('notruf') }));
    const voll = Brett.snapshot(g), mit = JSON.stringify(voll).length;
    const ohne = JSON.stringify(voll, (k, v) => (k === 'hafen' || k === 'ort_offen' ? undefined : v)).length;
    ok(voll.angebote.length === 3 && mit - ohne <= 3 * 70, `die neuen Felder kosten im Maximalfall ${mit - ohne} Zeichen (hoechstens 210): Block ${mit} Zeichen`);
    ok(Math.max(...HAEFEN.map(([h]) => hexname(h).length)) <= BRETT.ort_max.wert, 'der Hafenname ist hoechstens ort_max (' + BRETT.ort_max.wert + ') lang');
  }

  console.log('\nWeltstand: Roundtrip, Altstand, Muell');
  {
    const t = neu(71, { absichten: true }), g = t.g;
    angebote(g).length = 0; hafenSetzen(g, '0305');
    const a1 = INS.anbietenAusAbsicht(g, ab('notruf', { titel: 'Zebrafalke Eins' })), a2 = INS.anbietenAusAbsicht(g, ab('lieferung', { titel: 'Zebrafalke Zwei' }));
    const a3 = Brett.neuAnbieten(g, plan([{ typ: 'spur' }, { typ: 'abschluss' }], { titel: 'Ohne Absicht' }), { hex: Ziel.zielFolge(g, '0305', { belegt: Ziel.belegt(g) })[0] });
    ok(a1.ok && a2.ok && a3.ok, 'drei Angebote (zwei aus Absichten, eines ohne Herkunft und Absicht)');
    const data = Weltstand.capture(g), s = JSON.parse(JSON.stringify(data.welt.sim)), blk = s.faeden.abenteuer;
    ok(data.version === 3 && Weltstand.validate(data, g).length === 0, 'Weltstand-Version bleibt 3, schemagueltig');
    ok(blk.angebote.length === 3 && eq(blk.angebote[0].herkunft, { hex: '0305' }) && eq(blk.angebote[0].absicht, a1.angebot.absicht) && eq(blk.angebote[1].herkunft, { hex: '0305' }) && !('herkunft' in blk.angebote[2]) && !('absicht' in blk.angebote[2]), 'toSave: Herkunft und Absicht stehen im Block, das dritte Angebot hat keines von beiden');
    D.zuruecksetzen();   // wie ein neuer Prozess
    const t2 = laden(JSON.parse(JSON.stringify(s)), 72, { absichten: true }), o2 = angebote(t2.g);
    ok(o2.length === 3 && eq(o2[0].herkunft, { hex: '0305' }) && eq(o2[0].absicht, a1.angebot.absicht) && eq(o2[1].absicht, a2.angebot.absicht) && o2[2].herkunft === undefined && o2[2].absicht === undefined, 'nach dem Laden: Herkunft und Absicht sind da (Angebot 3 hat keine)');
    ok(zust(t2.g).ladeFehler.length === 0 && t2.g.errors === 0, 'keine Ladefehler');
    ok(eq(Faden.toSave(t2.g.weltsim), s.faeden), 'Speichern nach dem Laden ergibt denselben Block');
    const sn = Brett.snapshot(t2.g);
    ok(sn && sn.angebote[0].hafen === hexname('0305') && !('hafen' in sn.angebote[2]) && !/absicht\/1|nuechtern|"absicht"/.test(JSON.stringify(sn)), 'Snapshot nach dem Laden: hafen da (ohne Herkunft keiner), keine Absicht');
    // Altstand: Angebote ohne die neuen Felder
    const alt = JSON.parse(JSON.stringify(s)); alt.faeden.abenteuer.angebote.forEach((x) => { delete x.herkunft; delete x.absicht; });
    D.zuruecksetzen();
    const t3 = laden(alt, 73, { absichten: true });
    ok(angebote(t3.g).length === 3 && angebote(t3.g).every((x) => x.herkunft === undefined && x.absicht === undefined) && zust(t3.g).ladeFehler.length === 0 && t3.g.errors === 0, 'Altstand ohne die Felder: laedt unveraendert, keine Ladefehler');
    // Muell
    const muell = [
      ['herkunft Text', (x) => { x.herkunft = 'x'; }], ['herkunft Zahl', (x) => { x.herkunft = 5; }], ['herkunft Liste', (x) => { x.herkunft = []; }], ['herkunft ohne Hex', (x) => { x.herkunft = {}; }],
      ['herkunft kein Sektor', (x) => { x.herkunft = { hex: '9999' }; }], ['herkunft Hex Zahl', (x) => { x.herkunft = { hex: 305 }; }],
      ['absicht Text', (x) => { x.absicht = 'x'; }], ['absicht Liste', (x) => { x.absicht = []; }], ['absicht Zahl', (x) => { x.absicht = 7; }], ['absicht ohne Name', (x) => { x.absicht = { format: 'absicht/1', titel: 't', ton: 'n' }; }],
      ['absicht zu gross', (x) => { x.absicht = Object.assign({}, x.absicht, { titel: 'z'.repeat(ABS_MAX) }); }],
      ['absicht Proto', (x) => { x.absicht = JSON.parse('{"__proto__":{"a":1},"format":"absicht/1","absicht":"notruf","titel":"t","ton":"n"}'); }],
    ];
    let schlecht = [];
    for (const [name, aend] of muell) {
      const s2 = JSON.parse(JSON.stringify(s)); aend(s2.faeden.abenteuer.angebote[0]);
      D.zuruecksetzen();
      let t4 = null;
      try { t4 = laden(s2, 74, { absichten: true }); } catch (e) { schlecht.push(name + ' (Absturz)'); continue; }
      const x = angebote(t4.g)[0], feld = name.split(' ')[0];
      if (!(angebote(t4.g).length === 3 && x && x[feld] === undefined && t4.g.errors === 0 && zust(t4.g).ladeFehler.some((m) => new RegExp(feld).test(m)))) schlecht.push(name);
      if (feld === 'absicht' && x && x.herkunft === undefined) schlecht.push(name + ' (Herkunft verloren)');
      if (feld === 'herkunft' && x && x.absicht === undefined) schlecht.push(name + ' (Absicht verloren)');
    }
    ok(schlecht.length === 0, 'Muell in herkunft/absicht (' + muell.length + ' Faelle): faellt weg, das Angebot bleibt, kein Absturz, Ladefehler genannt' + (schlecht.length ? ': ' + schlecht.join('; ') : ''));
    const gr = JSON.parse(JSON.stringify(s)); gr.faeden.abenteuer.angebote[0].absicht = Object.assign({}, gr.faeden.abenteuer.angebote[0].absicht); gr.faeden.abenteuer.angebote[0].absicht.titel = 'q'.repeat(ABS_MAX - JSON.stringify(Object.assign({}, gr.faeden.abenteuer.angebote[0].absicht, { titel: '' })).length);
    D.zuruecksetzen();
    const t5 = laden(gr, 75, { absichten: true });
    ok(JSON.stringify(gr.faeden.abenteuer.angebote[0].absicht).length === ABS_MAX && !!angebote(t5.g)[0].absicht, 'Obergrenze beim Laden: genau absicht_max_zeichen bleibt');
  }

  console.log('\nOhne Schalter: kein Brett, nichts');
  {
    const t = F.neuesSpiel({ crew: 1, seed: 5, names: [SPIELER], env: {} }), g = t.g;
    ok(Brett.snapshot(g) === null && Brett.toSave(null) === null, 'ohne FAEDEN: kein Snapshot');
    const r = Brett.neuAnbieten(g, plan([{ typ: 'spur' }, { typ: 'abschluss' }]), { hex: '0305', herkunft: '0305', absicht: ab('notruf') });
    ok(r.ok === false, 'ohne FAEDEN: neuAnbieten bietet nichts an (' + (r.grund || '').slice(0, 30) + ')');
  }

  console.log(`\n${n - fails}/${n} gruen`);
  process.exit(fails ? 1 : 0);
})();
