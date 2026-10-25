'use strict';
// SUND-03b T: Live-Texte über Sleipnir (Pool, Prüfer, Prompt; server/sim/texte-pool.js, texte-pruefer.js, Daten content/texte/texte-werte.json). Kein Netz (Fake-Ollama auf 127.0.0.1, Fake-LLM). Prüft:
//   Daten (Katalogtexte bestehen den eigenen Prüfer, Slots, Fakten) · Prüfer (jede Regel mit Ablehnung und Annahme) · Prompt (nie ein Spielername, auch nicht aus Freitext des Aufrufers) ·
//   Pool (jeder Text einmal, FIFO, leer → Katalogtext, Nachfüllen bis zum Ziel, höchstens ein Job zugleich, Leerlauf und Grenze, Wiederholungsversuch, Müll abgelehnt) · toter Transport blockiert nichts ·
//   echter Weg über Router und Ollama (think:false, format, nie Claude, Token-Zähler unberührt) · Zufallsstrom und Sim-Zustand byte-gleich mit und ohne Pool · Schalter aus = nichts passiert ·
//   Slots: textFuer (Reise), Söldner-Funk, Verlust-Funk, Schnittstelle für Paket A (reaktion, antwort).        node tools/test-texte-pool.js
const fs = require('fs');
const path = require('path');
const F = require('./regie-fixture.js');
const H = require('./transport-testhilfe.js');
const Sektoren = require('../shared/sektoren.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Wissen = require('../server/sim/kriegslage-wissen.js');
const Sprung = require('../server/sim/sprung.js');
const RE = require('../server/sim/reise-ereignis.js');
const Regie = require('../server/sim/regie-befehle.js');
const LLM = require('../server/mission/llm.js');
const Router = require('../server/mission/transport-router.js');
const Pool = require('../server/sim/texte-pool.js');
const Pruefer = require('../server/sim/texte-pruefer.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const W = Pruefer.WERTE;
const ws = (g) => g.weltsim;
const ENV = { REISE_EREIGNISSE: '1', TEXTE_POOL: '1' };
const SPL = { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' };   // Lage-Spielleiter an (Befehle, Funk beim Vermieten)
const spiel = (o) => F.neuesSpiel(Object.assign({ crew: 1, seed: 7, env: ENV }, o || {}));
const funkTexte = (t, i) => t.cs[i || 0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
const abbild = (g) => JSON.stringify(Kriegslage.abbild(ws(g).zustand));
const springe = (g, hex) => Sprung.springeNach(g, Sektoren.ortVonHex(hex));
const sicher = (fn, p) => { const alt = RE.WERTE.wahrscheinlichkeit; RE.WERTE.wahrscheinlichkeit = p == null ? 1 : p; try { return fn(); } finally { RE.WERTE.wahrscheinlichkeit = alt; } };
const KAT = RE.KATALOG;
function nur(ids, fn) { const kopie = KAT.slice(); KAT.length = 0; for (const e of kopie) if (ids.includes(e.id)) KAT.push(e); try { return fn(); } finally { KAT.length = 0; KAT.push(...kopie); } }
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) g.step(); };
const section = async (t, f) => { console.log('\n' + t); await f(); };

// ---------- Fake-LLM: antwortet wie das Modell mit { text }, liest Platzhalter und Pflichtwörter aus dem Prompt
const WOERTER = ['Nord', 'Süd', 'Ost', 'West', 'Eis', 'Rost', 'Salz', 'Glut'];
function gueltigerText(prompt, nr) {
  const pf = /im Text müssen vorkommen: ([^.]*)\./.exec(prompt);
  const pflicht = pf ? pf[1].split(',').map((x) => x.trim()).join(' ') : '';
  const wort = (/Der (Hafen|Posten) /.exec(prompt) || [null, ''])[1];
  const k = nr % 512;
  return `Funker ${WOERTER[k % 8]} ${WOERTER[Math.floor(k / 8) % 8]} ${WOERTER[Math.floor(k / 64) % 8]} ruft die Lerche und bleibt wachsam ${wort} ${pflicht}.`.replace(/\s+/g, ' ');
}
function fakeLlm(o) {
  const opt = o || {};
  const calls = [], held = [];
  const llm = {
    mode: 'live', calls, held,
    async ask(kind, input, ao) {
      const nr = calls.length + 1;
      calls.push({ kind, input, ao });
      if (opt.hold) await new Promise((res) => held.push(res));
      if (opt.fehler) throw Object.assign(new Error('Fake: ' + opt.fehler), { code: opt.fehler });
      const text = opt.antwort ? opt.antwort(input.prompt, nr) : (/Textart: antwort/.test(input.prompt) ? 'Wir helfen gern ' + String.fromCharCode(97 + (nr % 26)) + String.fromCharCode(97 + (Math.floor(nr / 26) % 26)) : gueltigerText(input.prompt, nr));
      return { text: JSON.stringify({ text }), tokens: 10, sec: 0.01, anbieter: 'ollama', modell: 'fake' };
    },
    freigeben() { while (held.length) held.shift()(); },
  };
  return llm;
}
// Pool vollständig füllen (jede Runde: Grenze, ein Schritt, auf den Job warten)
async function fuellen(g, max) {
  for (let i = 0; i < (max || 400); i++) {
    const vorher = Pool.stand().zaehler.jobs;
    Pool.beiGrenze(g); Pool.update(g, 0.1);
    await Pool.jobFertig();
    if (Pool.stand().zaehler.jobs === vorher) break;
  }
}
const pruefe = (text, c) => Pruefer.pruefe(text, Object.assign({ slot: 'ankuendigung', platzhalter: ['ort'], pflicht: [], stimme: 'rom', namen: [] }, c || {}));

(async () => {
  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Daten: Format, Slots, Fakten, Katalogtexte bestehen den eigenen Prüfer', () => {
    const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'texte', 'texte-werte.json'), 'utf8'));
    ok(D.format === 'texte-werte/1' && Object.values(D.werte).every((v) => v && 'wert' in v && typeof v.einheit === 'string' && typeof v._hinweis === 'string'), 'Format texte-werte/1, jeder Wert mit Einheit und Hinweis');
    ok(W.standard_an === false, 'Standard aus (standard_an false)');
    ok(W.ziel >= 2 && W.ziel <= 3 && W.versuche === 2 && W.gesamt_max >= 41 * W.ziel && W.leerlauf_s > 0 && W.job_timeout_s > 0 && W.fehler_pause_s.max >= W.fehler_pause_s.start, `Zahlen: Ziel ${W.ziel} Varianten, ${W.versuche} Versuche (einer plus ein Wiederholungsversuch), Leerlauf ${W.leerlauf_s} s, Zeitlimit ${W.job_timeout_s} s`);
    ok(['ankuendigung', 'eintreffen', 'dank', 'soeldner', 'verlust', 'reaktion', 'antwort'].every((s) => W.slots[s] && W.slots[s].min >= 1 && W.slots[s].max > W.slots[s].min && W.slots[s].aufgabe), 'alle sieben Slot-Arten mit Länge und Aufgabe');
    ok(W.slots.antwort.max === 40, 'Optionstext höchstens 40 Zeichen (Paket A)');
    ok(KAT.every((e) => W.fakten[e.id] && W.fakten[e.id].fakt && W.stimmen[W.fakten[e.id].stimme]), `alle ${KAT.length} Katalogeinträge haben Fakt und Stimme`);
    const specs = Pool.katalogSpecs();
    const sollSlots = KAT.reduce((s, e) => s + Object.keys(e.texte).length + (e.antworten || []).length, 0) + Object.keys(W.zusatz).length;   // SUND-03b A: je Antwortoption ein Schlüssel (reaktion; die Beschriftung kommt nie aus dem Pool)
    ok(specs.length === sollSlots && new Set(specs.map((s) => Pool.keyVon(s.art, s.id, s.slot, s.optionId))).size === specs.length, `${specs.length} angemeldete Schlüssel = alle Slots der 16 Einträge plus ${Object.keys(W.zusatz).length} Zusatz-Einträge, eindeutig`);
    const schlecht = [];
    for (const sp of specs) for (const t of sp.beispiele) { const r = Pruefer.pruefe(t, { slot: sp.slot, platzhalter: sp.platzhalter.concat(['ort', 'n']), pflicht: [], stimme: sp.stimme }); if (!r.ok) schlecht.push(sp.id + '/' + sp.slot + ': ' + r.fehler.join(', ')); }
    ok(schlecht.length === 0, 'alle Katalogtexte und Vorlagen bestehen den Prüfer der Pool-Texte (' + schlecht.join(' | ') + ')');
    const sp = (id, slot) => specs.find((x) => x.id === id && x.slot === slot);
    ok(JSON.stringify(sp('piraten_hinterhalt', 'ankuendigung').pflicht) === '["n"]' && sp('piraten_hinterhalt', 'eintreffen').platzhalter.length === 0 && JSON.stringify(sp('notruf_pirat_frachter', 'ankuendigung').pflicht) === '["ort"]' && sp('notruf_pirat_frachter', 'dank').platzhalter.length === 0, 'Platzhalter folgen den Katalogtexten: {n} Pflicht in der Gefahr-Ankündigung, {ort} im Notruf, keiner im Dank');
    ok(sp('posten_verloren', 'verlust').muss[0] === 'Posten' && sp('hafen_gefallen', 'verlust').nicht[0] === 'Posten' && sp('soeldner_an_rom', 'soeldner').platzhalter[0] === 'n', 'Zusatz-Einträge: Verlust (Posten/Hafen getrennt), Söldner');
    ok(fs.existsSync(Pruefer.SYSTEM_DATEI) && LLM.systemPromptFile('text') === Pruefer.SYSTEM_DATEI, 'Systemprompt text.system.md liegt dort, wo llm.js ihn für kind text sucht');
    const sys = fs.readFileSync(Pruefer.SYSTEM_DATEI, 'utf8');
    ok(/Figurensprache statt Meldung/.test(sys) && /Keine Ziffern/.test(sys) && /Rate nie zum Springen/.test(sys) && /Streife/.test(sys) && /Aufklärung/.test(sys), 'Systemprompt: Figurensprache, Germane klingt nicht römisch, kein Ausweichen, keine erfundenen Kriegsfolgen, keine Ziffern');
    for (const s of Object.keys(W.slots)) { const sc = Pruefer.schemaFuer(s); ok(sc.type === 'object' && sc.required[0] === 'text' && sc.properties.text.type === 'string' && sc.additionalProperties === false, 'Schema ' + s + ': Objekt { text }'); }
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Prüfer: jede Regel lehnt ab und nimmt an', () => {
    const gut = 'Hier Frachter Aurelia, ein Räuber hängt bei {ort} am Heck. Wer kommt?';
    ok(pruefe(gut).ok, 'Ausgangstext ist gültig');
    const nein = (text, c, muster, name) => { const r = pruefe(text, c); ok(!r.ok && r.fehler.some((f) => muster.test(f)), 'abgelehnt: ' + name + ' (' + r.fehler.join('; ').slice(0, 70) + ')'); };
    nein('Zu kurz.', {}, /zu kurz/, 'zu kurz');
    nein('Hier spricht der Funker. ' + 'Es geht weiter und weiter und weiter. '.repeat(8), {}, /zu lang/, 'zu lang');
    nein('Hier Aurelia, ein Räuber hängt bei {ort} am Heck, wer kommt, bitte, jetzt gleich', {}, /Satzende/, 'kein Satzende');
    nein('Hier Aurelia, ein Räuber hängt bei {{lex.ort:die}} am Heck. Wer kommt?', {}, /doppelte Klammern/, '{{…}}');
    nein('Hier Aurelia, ein Räuber hängt bei {schiff} am Heck. Wer kommt?', {}, /nicht erlaubt/, 'unbekannter Platzhalter');
    nein('Hier Aurelia, ein Räuber hängt bei {n} am Heck. Wer kommt?', { platzhalter: ['ort'] }, /nicht erlaubt/, 'Platzhalter {n} dort, wo er nicht vorgesehen ist');
    nein('Hier Aurelia, ein Räuber hängt am Heck, kein Ort. Wer kommt?', { pflicht: ['ort'] }, /fehlt/, 'Pflicht-Platzhalter fehlt');
    nein('Hier Aurelia, ein Räuber hängt bei {ort am Heck. Wer kommt?', {}, /lose geschweifte Klammer/, 'lose Klammer');
    nein('Hier Aurelia, in zwölf Sekunden, nein in 12 Sekunden, bei {ort}. Wer kommt?', {}, /Ziffern/, 'Ziffern');
    nein('Hier Aurelia, Mireille_Kas hängt bei {ort} am Heck. Wer kommt?', { namen: ['Mireille_Kas'] }, /Spielernamen/, 'Spielername');
    nein('Hier Aurelia, Räuber hängen bei {ort} am Heck 😀. Wer kommt?', {}, /Emoji/, 'Emoji');
    nein('Hier Aurelia, **Räuber** hängen bei {ort} am Heck. Wer kommt?', {}, /Markdown/, 'Markdown');
    for (const [wort, text] of [['ausweichen', 'Ihr könnt dem Räuber bei {ort} noch ausweichen, Lerche. Wer kommt?'], ['springen', 'Räuber bei {ort}, springt einfach weg, Lerche. Wer kommt?'], ['entkommen', 'Räuber bei {ort}, ihr entkommt ihnen nicht leicht. Wer kommt?'], ['fliehen', 'Räuber bei {ort}, fliehen lohnt sich nicht, Lerche. Wer kommt?']]) nein(text, {}, /ausweichen/, 'Ausweich-Versprechen: ' + wort);
    ok(pruefe('Wir haben den Kahn zurück erobert, Lerche, danke dafür, Rom hört davon.').ok, 'die Gruppe „sieger“ gilt nur für den Verlustspruch (im Dank ist „erobert“ erlaubt)');
    ok(pruefe('Verflucht sei der Räuber bei {ort}, er klebt am Heck, Lerche. Wer kommt?').ok, 'kein Fehlalarm: „Verflucht“ enthält nicht „Flucht“');
    nein('Der Posten {ort} wurde einfach überrannt, Lerche, so schnell ging das.', { slot: 'verlust' }, /kriegsfolgen/, 'erfundene Kriegsfolge (überrannt)');
    nein('Die ganze Wache von {ort} ist ausgelöscht, Lerche, so ein Jammer.', { slot: 'verlust' }, /kriegsfolgen/, 'erfundene Kriegsfolge (ausgelöscht)');
    nein('Wieder ein Stein weg, {ort} ist erobert, Lerche. Verdammt noch eins.', { slot: 'verlust' }, /sieger/, 'Sieger im Verlustspruch');
    // SUND-03b Fix S3: Lücken der Reviewer (bestanden den Prüfer, verletzten die Regeln): Ausweichen/Rückzug als Rat, Sieger und Besatzungsschicksal im Verlustspruch
    for (const text of ['Weicht aus!', 'Dreht ab, solange ihr noch könnt!', 'Kehrt um, dann passiert euch nichts.', 'Zieht euch zurück, Lerche.', 'Macht euch davon, Lerche.', 'Haltet Abstand und lasst sie ziehen.']) {
      for (const slot of ['ankuendigung', 'eintreffen', 'reaktion']) nein(text, { slot, platzhalter: [] }, /ausweichen/, `Ausweich-Rat (${slot}): „${text}“`);
    }
    for (const text of ['Haltet Abstand, Lerche.', 'Lasst sie ziehen, Lerche.']) for (const slot of ['ankuendigung', 'reaktion']) nein(text, { slot, platzhalter: [] }, /ausweichen/, `Ausweich-Rat einzeln (${slot}): „${text}“`);
    for (const text of ['Der Posten {ort} ist verloren, die Germanen waren stärker.', 'Der Posten {ort} ist verloren, der Feind war stärker.', 'Der Posten {ort} ist verloren, jemand hält ihn jetzt.', 'Der Posten {ort} ist verloren, jemand besetzt ihn.']) nein(text, { slot: 'verlust', muss: ['Posten'], nicht: ['Hafen'] }, /sieger/, 'Sieger beim Verlust (einzeln): ' + text);
    for (const text of ['Der Posten {ort} ist verloren, die Germanen halten ihn jetzt.', 'Der Posten {ort} ist verloren, Rom hält ihn nicht mehr, der Feind sitzt drin.', 'Der Posten {ort} ist verloren, und dort sitzt jetzt jemand anderes, besetzt für immer.']) nein(text, { slot: 'verlust', muss: ['Posten'], nicht: ['Hafen'] }, /sieger/, 'Sieger beim Verlust: ' + text);
    nein('Posten {ort} ist gefallen, alle tot.', { slot: 'verlust', muss: ['Posten'], nicht: ['Hafen'] }, /besatzung/, 'erfundenes Besatzungsschicksal (alle tot)');
    nein('Posten {ort} ist verloren, keiner hat überlebt, Lerche.', { slot: 'verlust', muss: ['Posten'], nicht: ['Hafen'] }, /besatzung/, 'erfundenes Besatzungsschicksal (überlebt)');
    ok(pruefe('Wir haben den Kahn zurück erobert, Lerche, und die Germanen ziehen sich zurück, danke.', { slot: 'dank' }).ok, 'S3: „Sieger“ und „Besatzung“ gelten nur für den Verlustspruch (im Dank bleiben sie erlaubt)');
    ok(pruefe('Posten {ort} ist verloren. Es ist so still dort, ich mag das nicht, Lerche.', { slot: 'verlust', muss: ['Posten'], nicht: ['Hafen'] }).ok, 'kein Fehlalarm bei einem guten Verlustspruch ohne Sieger und Besatzung');
    nein('Meldung an die Lerche: Der Posten {ort} ist verloren. Ende der Meldung.', { slot: 'verlust' }, /meldungston/, 'Meldungston');
    nein('Wir haben keine weiteren Informationen, {ort} ist verloren, Lerche, leider.', { slot: 'verlust' }, /meldungston/, 'Hinweis auf fehlende Information');
    nein('Die Legion wird euch alle holen, Lerche, und die Streife gleich mit dazu.', { slot: 'reaktion', stimme: 'ger', platzhalter: [] }, /Stimme/, 'Germane klingt römisch');
    nein('Euer Walhall ruft euch bald, Lerche, und Odin lacht darüber.', { slot: 'reaktion', stimme: 'rom', platzhalter: [] }, /Stimme/, 'Römer klingt germanisch');
    nein('Hafen oder Posten, {ort} ist verloren, Lerche, und das tut weh.', { slot: 'verlust', muss: ['Posten'], nicht: ['Hafen'] }, /darf/, 'verbotenes Eintragswort (Hafen im Postenspruch)');
    nein('{ort} ist verloren, Lerche, und das tut sehr weh heute.', { slot: 'verlust', muss: ['Posten'] }, /muss/, 'Pflichtwort fehlt (Posten)');
    nein(gut, { vorhanden: [gut.toUpperCase().replace('?', '!')] }, /Duplikat/, 'Duplikat eines vorhandenen Textes');
    nein('Wir bleiben und halten Wort und Ehre für alle Zeiten, bis zum Ende hin', { slot: 'antwort', platzhalter: [] }, /zu lang/, 'Optionstext über 40 Zeichen');
    ok(Pruefer.pruefe('Wir bleiben und halten Wort', { slot: 'antwort', platzhalter: [] }).ok, 'Optionstext ohne Satzende ist gültig (kurz, 40 Zeichen)');
    ok(pruefe('„Hier Frachter Aurelia, ein Räuber hängt bei {ort} am Heck. Wer kommt?“').ok && pruefe('„Hier Frachter Aurelia, ein Räuber hängt bei {ort} am Heck. Wer kommt?“').text.startsWith('Hier'), 'äußere Anführungszeichen werden abgestreift');
    ok(pruefe('Hier Aurelia, Räuber hängen bei {ort} am Heck.\nWer kommt?').ok, 'ein Zeilenumbruch wird zum Leerzeichen');
    ok(Pruefer.textAusAntwort('{"text":"Hallo"}') === 'Hallo' && Pruefer.textAusAntwort('```json\n{"text":"Hallo"}\n```') === 'Hallo' && Pruefer.textAusAntwort('{"x":1}') === null && Pruefer.textAusAntwort('{kaputt') === null && Pruefer.textAusAntwort('') === null && Pruefer.textAusAntwort('Blanker Text') === 'Blanker Text', 'Antwort lesen: JSON, Codezaun, falsches Feld, kaputt, leer, blanker Text');
    ok(Pruefer.pruefe(null, { slot: 'antwort', platzhalter: [] }).fehler[0] === 'kein Text' && Pruefer.pruefe({}, { slot: 'antwort', platzhalter: [] }).fehler[0] === 'kein Text', 'kein Text: ausdrücklich abgelehnt (null, Objekt)');
    ok(Pruefer.textAusAntwort('{"text":12}') === null && Pruefer.textAusAntwort('{"text":null}') === null, 'Antwort: ein Text, der kein String ist, zählt nicht');
    const mull = [null, undefined, 42, {}, [], '', '   '].map((x) => Pruefer.pruefe(x, { slot: 'ankuendigung', platzhalter: [] }).ok);
    ok(mull.every((x) => x === false), 'Müll (null, Zahl, Objekt, leer) wird abgelehnt, ohne zu werfen');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Prompt: nie ein Spielername, Freitext läuft durch den Namensfilter', async () => {
    const namen = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
    const alle = Pool.katalogSpecs().map((s) => Pruefer.promptBauen(Object.assign({}, s, { namen }), { vorhanden: [] })).join('\n');
    ok(alle.length > 20000 && !namen.some((x) => alle.includes(x)), `alle ${Pool.katalogSpecs().length} Prompts der Anmeldungen enthalten keinen Spielernamen (${alle.length} Zeichen geprüft)`);
    const p = Pruefer.promptBauen({ art: 'npc', id: 'x', slot: 'reaktion', sprecher: 'Mireille_Kas', stimme: 'ger', fakt: 'Ouzo_Brandt hat Tzvi_Lund gerettet.', antwort: 'Mireille_Kas bleibt hier', beispiele: ['Grüße von Ouzo_Brandt!'], platzhalter: [], pflicht: [], namen }, { vorhanden: ['Tzvi_Lund sagt Danke.'], vorher: { antwort: 'x', fehler: ['y'] } });
    ok(!namen.some((x) => p.includes(x)) && /Crew/.test(p), 'Freitext des Aufrufers (Sprecher, Fakt, Antwort, Vorlagen, vorhandene Texte): Spielernamen sind durch „Crew“ ersetzt');
    ok(/<figur>/.test(p) && /<lage>/.test(p) && /<spieler_antwort>/.test(p) && /<aufgabe>/.test(p) && /<stilvorlagen>/.test(p) && /<schon_vorhanden>/.test(p) && /<deine_antwort>/.test(p) && /<pruefer>/.test(p), 'Prompt-Teile: figur, lage, spieler_antwort, aufgabe, stilvorlagen, schon_vorhanden, deine_antwort, pruefer');
    // durch das ganze Spiel: drei Spieler mit auffälligen Namen, Prompts aus echten Jobs
    Pool.zuruecksetzen();
    const t = spiel({ crew: 3, names: namen }); const g = t.g;
    const llm = fakeLlm(); Pool.setLlm(llm);
    Pool.poolBefuellenAnfordern({ art: 'npc', id: 'giftig', slot: 'reaktion', sprecher: 'Händler', fakt: 'Mireille_Kas hat dem Händler geholfen.', antwort: 'Danke an Ouzo_Brandt', platzhalter: [], pflicht: [] });
    await fuellen(g);
    ok(llm.calls.length >= 40 && llm.calls.every((c) => c.kind === 'text' && !namen.some((x) => c.input.prompt.includes(x))), `${llm.calls.length} Jobs mit drei Spielern im Raum: kein Prompt enthält einen Namen`);
    ok(llm.calls.some((c) => /Crew/.test(c.input.prompt) && /giftig/.test(c.input.id)), 'der angemeldete Freitext kam gefiltert an („Crew“ statt Namen)');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Pool: verbrauchen (einmal, FIFO), leer → Katalogtext, Nachfüllen bis zum Ziel', async () => {
    Pool.zuruecksetzen();
    { const g0 = spiel().g; Pool.setLlm(fakeLlm()); const nSchl = Pool.katalogSpecs().length;   // der am wenigsten gefüllte Schlüssel zuerst (kein Schlüssel verhungert hinter einem anderen)
      for (let i = 0; i < nSchl; i++) { Pool.beiGrenze(g0); Pool.update(g0, 0.1); await Pool.jobFertig(); }
      const st0 = Pool.stand();
      ok(Object.keys(st0.pool).length === nSchl && Object.values(st0.pool).every((x) => x === 1), 'Reihenfolge: nach genau so vielen Jobs wie Schlüsseln hat jeder Schlüssel einen Text (der am wenigsten gefüllte kommt zuerst)');
      Pool.zuruecksetzen(); }
    ok(Pool.poolEntnehmen('reise', 'piraten_hinterhalt', 'ankuendigung') === null && Pool.stand().gesamt === 0, 'leerer Pool: nichts');
    const t = spiel(); const g = t.g;
    const llm = fakeLlm(); Pool.setLlm(llm);
    await fuellen(g);
    const st = Pool.stand(), specs = Pool.katalogSpecs();
    ok(st.gesamt === specs.length * W.ziel && Object.values(st.pool).every((x) => x === W.ziel), `Pool gefüllt: ${st.gesamt} Texte = ${specs.length} Schlüssel × Ziel ${W.ziel}`);
    ok(st.zaehler.gueltig_1 === st.gesamt && st.zaehler.fehler === 0 && st.job === null, 'alle Jobs im 1. Versuch gültig, keiner läuft mehr');
    const a = Pool.poolEntnehmen('reise', 'piraten_hinterhalt', 'ankuendigung'), b = Pool.poolEntnehmen('reise', 'piraten_hinterhalt', 'ankuendigung'), c = Pool.poolEntnehmen('reise', 'piraten_hinterhalt', 'ankuendigung');
    ok(a && b && c && new Set([a, b, c]).size === 3 && /\{n\}/.test(a), 'drei verschiedene Texte, {n} als Platzhalter stehen noch drin');
    const cs = llm.calls.filter((k) => k.input.id === 'piraten_hinterhalt' && k.input.slot === 'ankuendigung');
    ok(!/<schon_vorhanden>/.test(cs[0].input.prompt) && cs[1].input.prompt.includes('<schon_vorhanden>') && cs[1].input.prompt.includes(a) && cs[2].input.prompt.includes(a) && cs[2].input.prompt.includes(b), 'der Prompt nennt die schon vorhandenen Texte des Schlüssels („schreibe etwas anderes“)');
    const idx = (x) => { const m = /Funker (\S+) (\S+) (\S+) /.exec(x); return WOERTER.indexOf(m[1]) + 8 * WOERTER.indexOf(m[2]) + 64 * WOERTER.indexOf(m[3]); };
    ok(idx(a) < idx(b) && idx(b) < idx(c), 'FIFO: der älteste Text zuerst (Erzeugungsreihenfolge ' + [a, b, c].map(idx).join(' < ') + ')');
    ok(Pool.poolEntnehmen('reise', 'piraten_hinterhalt', 'ankuendigung') === null && !('reise|piraten_hinterhalt|ankuendigung|' in Pool.stand().pool), 'jeder Text wird genau einmal verbraucht: der vierte Griff ist leer');
    ok(Pool.poolEntnehmen('reise', 'piraten_hinterhalt', 'eintreffen') !== null && Pool.poolEntnehmen('reise', 'piraten_hinterhalt', 'dank') === null && Pool.poolEntnehmen('reise', 'gibt_es_nicht', 'ankuendigung') === null, 'Schlüssel getrennt: anderer Slot gefüllt, Slot ohne Katalogtext und unbekannte Id leer');
    // Nachfüllen bis zum Ziel
    const jobs0 = Pool.stand().zaehler.jobs;
    await fuellen(g);
    ok(Pool.stand().zaehler.jobs === jobs0 + 4 && Pool.stand().pool['reise|piraten_hinterhalt|ankuendigung|'] === W.ziel && Pool.stand().pool['reise|piraten_hinterhalt|eintreffen|'] === W.ziel, 'verbrauchte Texte werden bis zum Ziel nachgefüllt (4 Jobs: 3 + 1)');
    const eins = Pool.einsetzen('Räuber bei {ort}, {n} Sekunden, {x}.', { ort: 'Ostia', n: 10 });
    ok(eins === 'Räuber bei Ostia, 10 Sekunden, {x}.', 'einsetzen: {ort}, {n}, Unbekanntes bleibt stehen');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Takt: höchstens ein Job zugleich, Leerlauf, Grenze, Spiel wartet nie', async () => {
    Pool.zuruecksetzen();
    const g = spiel().g;
    const llm = fakeLlm({ hold: true }); Pool.setLlm(llm);
    Pool.update(g, W.leerlauf_s - 2);
    ok(llm.calls.length === 0, `vor dem Leerlauf (${W.leerlauf_s} s) startet nichts`);
    const t0 = Date.now();
    Pool.update(g, 3);
    ok(llm.calls.length === 1 && Date.now() - t0 < 1000, 'nach dem Leerlauf startet EIN Job, update kehrt sofort zurück (der Job hängt, das Spiel wartet nicht)');
    for (let i = 0; i < 20; i++) { Pool.beiGrenze(g, 'andocken'); Pool.update(g, 5); }
    ok(llm.calls.length === 1 && Pool.stand().job, 'solange der Job hängt: kein zweiter (Grenzen und Zeit ändern nichts), höchstens EIN Text-Job zugleich');
    for (let i = 0; i < 30; i++) g.step();   // das Spiel läuft weiter
    llm.freigeben(); await Pool.jobFertig();
    ok(Pool.stand().job === null && Pool.stand().gesamt === 1, 'nach der Antwort ist der Job zu Ende, ein Text im Pool');
    Pool.update(g, 1);
    ok(llm.calls.length === 1, 'nach dem Job gilt der Leerlauf neu (keine Serie im Sekundentakt)');
    Pool.beiGrenze(g, 'szene_ende'); Pool.update(g, 0.05);
    ok(llm.calls.length === 2, 'eine Tätigkeitsgrenze hebt die Wartezeit auf');
    llm.freigeben(); await Pool.jobFertig();
    // Hook im Spiel: game.lageGrenze ruft den Pool (auch ohne Lage-Spielleiter)
    const calls = llm.calls.length;
    ok(g.lageSpielleiter === null || g.lageSpielleiter === undefined, 'kein Lage-Spielleiter im Raum (nur der Pool)');
    g.lageGrenze('andocken'); lauf(g, 0.2);
    ok(llm.calls.length === calls + 1, 'game.lageGrenze(andocken) stößt den Pool an, der Step startet den Job (Hook in game.js)');
    llm.freigeben(); await Pool.jobFertig();
    // die anderen Grenzen: Andocken und Ende einer Sim-Szene (ohne Lage-Spielleiter)
    Pool.zuruecksetzen(); const l3 = fakeLlm(); Pool.setLlm(l3);
    g.missionEvent('docked'); Pool.update(g, 0.05);
    ok(l3.calls.length === 1, 'Andocken (missionEvent docked) ist eine Grenze für den Pool');
    await Pool.jobFertig();
    Pool.zuruecksetzen(); const l4 = fakeLlm(); Pool.setLlm(l4);
    Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'szene' }); Pool.update(g, 0.05);
    ok(l4.calls.length === 1, 'Ende einer Sim-Szene (szeneAbschliessen) ist eine Grenze für den Pool');
    await Pool.jobFertig();
    // Spielzeit läuft im Step: Leerlauf über g.step
    Pool.zuruecksetzen(); const l2 = fakeLlm(); Pool.setLlm(l2);
    lauf(g, W.leerlauf_s + 2);
    await Pool.jobFertig();
    ok(l2.calls.length >= 1, 'der Step des Spiels treibt update (texteUpdate): nach dem Leerlauf entsteht ein Job');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Prüfer im Betrieb: Wiederholungsversuch, Müll bleibt draußen, danach der Katalogtext', async () => {
    Pool.zuruecksetzen();
    const g = spiel().g;
    let llm = fakeLlm({ antwort: (p, nr) => (nr === 1 ? 'Platzhalter (mock)' : gueltigerText(p, nr)) }); Pool.setLlm(llm);
    Pool.beiGrenze(g); Pool.update(g, 0.1); await Pool.jobFertig();
    const z = Pool.stand().zaehler;
    ok(llm.calls.length === 2 && z.gueltig_2 === 1 && z.gueltig_1 === 0 && Pool.stand().gesamt === 1, 'ungültig im 1. Versuch, gültig im 2. (genau ein Wiederholungsversuch): ein Text im Pool');
    ok(/<deine_antwort>/.test(llm.calls[1].input.prompt) && /<pruefer>/.test(llm.calls[1].input.prompt) && /zu kurz/.test(llm.calls[1].input.prompt), 'der Wiederholungsversuch trägt die Fehler des Prüfers im Prompt');
    ok(llm.calls.every((c) => c.ao.timeoutMs === W.job_timeout_s * 1000 && c.ao.schema && c.ao.schema.required[0] === 'text'), 'jeder Aufruf mit Zeitlimit und Schema');
    // beide Versuche Müll
    Pool.zuruecksetzen();
    llm = fakeLlm({ antwort: () => 'Nach {{lex.x:die}} 12 Sekunden könnt ihr ausweichen!' }); Pool.setLlm(llm);
    Pool.beiGrenze(g); Pool.update(g, 0.1); await Pool.jobFertig();
    ok(llm.calls.length === W.versuche && Pool.stand().gesamt === 0 && Pool.stand().zaehler.ungueltig === 1, `Müll in beiden Versuchen: nichts im Pool, ${W.versuche} Aufrufe, nie ein dritter`);
    const erster = llm.calls[0].input.id + '/' + llm.calls[0].input.slot;
    Pool.beiGrenze(g); Pool.update(g, 0.1); await Pool.jobFertig();
    const zweiter = llm.calls[llm.calls.length - 1].input.id + '/' + llm.calls[llm.calls.length - 1].input.slot;
    ok(erster !== zweiter, 'der Schlüssel mit Müll pausiert (' + erster + ' → ' + zweiter + '), es kommt ein anderer dran');
    // jeder Müll-Typ geht nie in den Pool
    for (const muell of ['', 'x', JSON.stringify({ text: 12 }), '{"text":"Mireille_Kas ruft die Lerche bei {ort}, bleibt wachsam und hofft."}', 'Das ist ein Satz ohne Platzhalter und ohne alles, aber lang genug dafür.']) {
      Pool.zuruecksetzen();
      const l = { mode: 'live', async ask() { return { text: muell, tokens: 1, sec: 0.01 }; } }; Pool.setLlm(l);
      Pool.beiGrenze(g); Pool.update(g, 0.1); await Pool.jobFertig();
      ok(Pool.stand().gesamt === 0, 'Antwort „' + String(muell).slice(0, 30) + '…“ kommt nicht in den Pool');
    }
    // den Katalogtext abzuschreiben gilt als Duplikat
    Pool.zuruecksetzen();
    const erstes = Pool.katalogSpecs()[0];
    llm = fakeLlm({ antwort: () => erstes.beispiele[0] }); Pool.setLlm(llm);
    Pool.beiGrenze(g); Pool.update(g, 0.1); await Pool.jobFertig();
    ok(llm.calls[0].input.id === erstes.id && Pool.stand().gesamt === 0 && llm.calls.length === 2, 'ein abgeschriebener Katalogtext kommt nicht in den Pool (Duplikat)');
    // Obergrenze des ganzen Pools
    Pool.zuruecksetzen();
    const alt = W.gesamt_max; W.gesamt_max = 5;
    try { Pool.setLlm(fakeLlm()); await fuellen(g); ok(Pool.stand().gesamt === 5, 'Obergrenze gesamt_max: bei 5 Texten ist Schluss (' + Pool.stand().gesamt + ')'); } finally { W.gesamt_max = alt; }
    // textFuer: der Katalogtext bleibt, wenn der Pool leer ist
    Pool.zuruecksetzen(); Pool.update(g, 0.1);
    const ev = { id: 'piraten_hinterhalt', textIdx: 1, hex: '0602' };
    const t = RE.textFuer(ev, 'ankuendigung');
    ok(t.von === 'Aufklärung' && /Piratenrümpfe/.test(t.text) && /10 Sekunden/.test(t.text), 'leerer Pool: der Katalogtext (textIdx 1) mit eingesetzten Platzhaltern, wie in 03a');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Toter Transport blockiert nichts', async () => {
    Pool.zuruecksetzen();
    const tot = await H.toterPort();
    const altLive = process.env.LLM_LIVE; process.env.LLM_LIVE = '1';
    try {
      const t = spiel({ env: Object.assign({}, ENV, { LLM_LIVE: '1', OLLAMA_URL: 'http://127.0.0.1:' + tot, OLLAMA_MODEL: 'fake:1b' }) }); const g = t.g;
      const t0 = Date.now();
      Pool.beiGrenze(g); Pool.update(g, 0.1);
      const sync = Date.now() - t0;
      ok(sync < 1000 && Pool.stand().job !== null, `update kehrt sofort zurück (${sync} ms), der Job läuft im Hintergrund`);
      lauf(g, 2);   // das Spiel läuft weiter, während der Job scheitert
      await Pool.jobFertig();
      const z = Pool.stand().zaehler;
      ok(z.fehler === 1 && Pool.stand().gesamt === 0 && Pool.stand().fehlerFolge === 1, 'toter Port: ein Fehler gezählt, nichts im Pool');
      const ev = { id: 'notruf_pirat_frachter', textIdx: 0, hex: '0305' };
      ok(/Frachter Aurelia/.test(RE.textFuer(ev, 'ankuendigung').text), 'textFuer liefert weiter den Katalogtext');
      const pause = Pool.stand().pauseBis;
      ok(pause > 0, `Pause nach dem Ausfall (bis Spielzeit ${pause} s)`);
      Pool.beiGrenze(g); Pool.update(g, 1);
      ok(Pool.stand().zaehler.jobs === 1 && Pool.stand().job === null, 'in der Pause startet auch eine Grenze nichts (kein Dauerfeuer auf einen toten Dienst)');
      Pool.update(g, W.fehler_pause_s.start + 1); await Pool.jobFertig();
      const st2 = Pool.stand();
      ok(st2.zaehler.jobs === 2 && st2.fehlerFolge === 2 && Math.abs((st2.pauseBis - st2.zeit) - 2 * W.fehler_pause_s.start) < 0.01, `nach der Pause ein neuer Versuch, die Pause verdoppelt sich (Rest ${(st2.pauseBis - st2.zeit).toFixed(1)} s = 2 × ${W.fehler_pause_s.start})`);
      lauf(g, 1);
    } finally { if (altLive === undefined) delete process.env.LLM_LIVE; else process.env.LLM_LIVE = altLive; }
    // Fehlerarten: Zeitlimit, EXIT, OFF: alle nur Fehler, nie ein Wurf nach außen
    for (const code of ['ETIMEDOUT', 'EXIT', 'OFFLINE', 'EMPTY', 'RATE_LIMIT']) {
      Pool.zuruecksetzen(); const g2 = spiel().g; Pool.setLlm(fakeLlm({ fehler: code }));
      let geworfen = false; try { Pool.beiGrenze(g2); Pool.update(g2, 0.1); await Pool.jobFertig(); } catch (e) { geworfen = true; }
      ok(!geworfen && Pool.stand().zaehler.fehler === 1 && Pool.stand().gesamt === 0, 'Fehler ' + code + ': gezählt, nichts geworfen, nichts im Pool');
    }
    // der Modus off (kein LLM_LIVE): keine Jobs
    Pool.zuruecksetzen(); const g3 = spiel().g;
    Pool.beiGrenze(g3); Pool.update(g3, 99);
    ok(Pool.stand().zaehler.jobs === 0 && Pool.stand().job === null && Pool.modus({}) === 'off' && Pool.modus({ LLM_LIVE: '1' }) === 'live', 'ohne LLM_LIVE=1 (Modus off) startet kein Job');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Echter Weg: Router → Ollama (Fake-Server), nie Claude, Token-Zähler unberührt', async () => {
    Pool.zuruecksetzen();
    let nr = 0;
    const srv = await H.fakeOllama((req, res, body) => {
      if (req.url === '/api/version') return H.antwort(res, 200, { version: 'fake-1' });
      nr++;
      const user = body.messages[body.messages.length - 1].content;
      const text = nr === 1 ? 'Das ist leider Müll {{lex.x}} 12' : gueltigerText(user, nr);
      H.antwort(res, 200, { model: body.model, message: { role: 'assistant', content: JSON.stringify({ text }) }, done: true, prompt_eval_count: 800, eval_count: 30 });
    });
    const altLive = process.env.LLM_LIVE; process.env.LLM_LIVE = '1';
    try {
      const b0 = LLM.budget();
      const g = spiel({ crew: 3, names: ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'], env: Object.assign({}, ENV, { LLM_LIVE: '1', OLLAMA_URL: srv.url, OLLAMA_MODEL: 'fake:1b', LLM_MODELL_TEXT: 'fake:2b' }) }).g;
      const llm = Pool.getLlm(g);
      ok(llm && llm.mode === 'live' && llm.anbieterFuer('text') === 'ollama' && llm.eskalationMoeglich('text') === false, 'der Pool nutzt Ollama für kind text und hat KEINE Eskalation (kein Claude)');
      Pool.beiGrenze(g); Pool.update(g, 0.1); await Pool.jobFertig();
      const posts = srv.requests.filter((q) => q.method === 'POST');
      ok(posts.length === 2 && posts.every((q) => q.url === '/api/chat' && q.body.think === false && q.body.stream === false && q.body.model === 'fake:2b'), 'zwei Anfragen an /api/chat (Versuch und Wiederholung), think:false, Modell aus LLM_MODELL_TEXT');
      ok(posts.every((q) => q.body.format && q.body.format.type === 'object' && q.body.format.required[0] === 'text'), 'format = kleines JSON-Schema { text }');
      ok(posts.every((q) => q.body.messages[0].role === 'system' && /Genau ein JSON-Objekt/.test(q.body.messages[0].content)), 'Systemprompt text.system.md');
      ok(posts.every((q) => !/Mireille|Ouzo|Tzvi/.test(JSON.stringify(q.body))), 'kein Spielername in den Anfragen an Sleipnir');
      ok(/<deine_antwort>/.test(posts[1].body.messages[1].content) && Pool.stand().zaehler.gueltig_2 === 1 && Pool.stand().gesamt === 1, 'Wiederholung bei Gemma (nicht Claude): zweite Anfrage mit den Prüferfehlern, ein Text im Pool');
      const b1 = LLM.budget();
      ok(b1.used === b0.used && b1.calls === b0.calls, 'der Claude-Token-Zähler wurde nicht belastet (lokale Läufe zählen nicht)');
    } finally { if (altLive === undefined) delete process.env.LLM_LIVE; else process.env.LLM_LIVE = altLive; await srv.close(); }
    const r = Router.routeTransport({ text: { anbieter: 'ollama' } }, { eskalation: null });
    ok(r.anbieterFuer('text') === 'ollama' && r.eskalationFuer('text') === null, 'Router: text → ollama, Eskalation null');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('textFuer: Pool-Text, Platzhalter beim Verbrauch, Rückfall Katalogtext', async () => {
    Pool.zuruecksetzen();
    const t = spiel(); const g = t.g;
    Pool.setLlm(fakeLlm()); await fuellen(g);
    const ev = { id: 'piraten_hinterhalt', textIdx: 0, hex: '0602', nr: 1 };
    const a = RE.textFuer(ev, 'ankuendigung');
    ok(a.von === 'Aufklärung' && /^Funker /.test(a.text) && /10/.test(a.text) && !/\{/.test(a.text) && /\b10\b/.test(a.text), 'Pool-Text: Sprecher des Katalogs, {n} (Vorlauf 10) eingesetzt: ' + a.text.slice(0, 60));
    const notruf = RE.textFuer({ id: 'notruf_pirat_frachter', textIdx: 0, hex: '0305' }, 'ankuendigung');
    ok(new RegExp(Sektoren.hexName('0305')).test(notruf.text) && !/\{ort\}/.test(notruf.text), '{ort} wird beim Verbrauch durch den Ortsnamen ersetzt (' + Sektoren.hexName('0305') + ')');
    ok(RE.textFuer({ id: 'funk_lage_rom', textIdx: 0, hex: '0305' }, 'dank') === null && Pool.stand().zaehler.verbraucht === 2, 'Slot ohne Katalogtext: null, nichts verbraucht');
    // leer lesen → Katalog
    for (let i = 0; i < 5; i++) RE.textFuer(ev, 'eintreffen');
    const katalog = RE.textFuer(ev, 'eintreffen');
    ok(/Kontakt|Räuber/.test(katalog.text) && !/^Funker/.test(katalog.text), 'ist der Pool leer gelesen, kommt der Katalogtext (Rückfall)');
    // Raum ohne Schalter bekommt nie Pool-Text, auch wenn der Pool gefüllt ist
    Pool.zuruecksetzen(); Pool.setLlm(fakeLlm()); await fuellen(g);
    const g2 = spiel({ env: { REISE_EREIGNISSE: '1', TEXTE_POOL: 'off' } }).g;
    Pool.update(g2, 0.1);
    ok(Pool.stand().gesamt > 0 && !/^Funker/.test(RE.textFuer(ev, 'ankuendigung').text) && Pool.freigegeben() === false, 'Schalter aus: der gefüllte Pool wird nicht gelesen');
    Pool.update(g, 0.1);
    ok(/^Funker/.test(RE.textFuer(ev, 'ankuendigung').text), 'Schalter an: wieder gelesen');
    // Fix K1: die Freigabe ist prozessweit (der zuletzt laufende Raum), der Raum entscheidet selbst: ein Raum OHNE Schalter bekommt nie Pool-Text, auch wenn gerade ein anderer Raum den Pool freigegeben hat
    Pool.update(g, 0.1);
    ok(Pool.freigegeben() === true && !/^Funker/.test(RE.textFuer(ev, 'ankuendigung', g2).text) && /^Funker/.test(RE.textFuer(ev, 'ankuendigung', g).text), 'K1: Pool prozessweit freigegeben, trotzdem: der Raum ohne Schalter bekommt den Katalogtext, der Raum mit Schalter den Pooltext');
    // Fix K1: beim Ziehen greift der Namensfilter des ziehenden Raums (der Pool wurde mit den Namen eines anderen Raums erzeugt)
    Pool.zuruecksetzen(); Pool.setLlm(fakeLlm({ antwort: (p, nr) => `Hier Funker Quirin ${WOERTER[nr % 8]}, ein Räuber hängt bei {ort} am Heck, Lerche. Wer kommt?` })); await fuellen(g);
    const gq = spiel({ names: ['Quirin'] }).g;
    Pool.update(gq, 0.1);
    const evq = { id: 'notruf_pirat_frachter', textIdx: 0, hex: '0305' };
    const vorV = Pool.stand().zaehler.verbraucht;
    const zq = RE.textFuer(evq, 'ankuendigung', gq);
    ok(!/Quirin/.test(zq.text) && Pool.stand().zaehler.verbraucht === vorV + 1, 'K1: ein Pooltext mit dem Spielernamen des ziehenden Raums wird verworfen (verbraucht), es gilt der Katalogtext: ' + zq.text.slice(0, 50));
    Pool.update(g, 0.1);
    ok(/Quirin/.test(RE.textFuer(evq, 'ankuendigung', g).text), 'K1: im Raum ohne diesen Namen ist derselbe Pool-Text in Ordnung (der Filter gilt dem ziehenden Raum)');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Zufallsstrom und Sim-Zustand byte-gleich mit und ohne Pool', async () => {
    const reihe = (g) => {
      const hexe = ['0305', '0304', '0204', '0305', '0105', '0203', '0305', '0405', '0305', '0304'];
      for (let r = 0; r < 12; r++) for (const h of hexe) { sicher(() => springe(g, h), 0.3); if (r % 4 === 0) lauf(g, 0.3); }
    };
    Pool.zuruecksetzen();
    const b = spiel({ seed: 21, env: { REISE_EREIGNISSE: '1' } }).g;   // ohne Pool
    reihe(b);
    const a = spiel({ seed: 21 }).g;   // mit Pool, vorher gefüllt
    Pool.setLlm(fakeLlm()); await fuellen(a);
    const gefuellt = Pool.stand().gesamt;
    reihe(a);
    const verbraucht = Pool.stand().zaehler.verbraucht;
    ok(gefuellt > 100 && verbraucht >= 5, `Ausgangslage: Pool mit ${gefuellt} Texten gefüllt, im Spiel A ${verbraucht} Texte verbraucht (Spiel B ohne Pool)`);
    ok(ws(a).reise.n === 120 && ws(b).reise.n === 120, '120 Sprünge in beiden Spielen');
    ok(abbild(a) === abbild(b) && ws(a).tickZahl === ws(b).tickZahl, 'Sim-Zustand byte-gleich mit und ohne Pool');
    ok(ws(a).zustand.zufall === ws(b).zustand.zufall, 'der Zufallsstrom der Sim ist unberührt (zustand.zufall gleich)');
    ok(JSON.stringify(RE.toSave(ws(a))) === JSON.stringify(RE.toSave(ws(b))) && JSON.stringify(ws(a).chronik) === JSON.stringify(ws(b).chronik), 'Ereignisse (Zähler, Wiederholungsring) und Chronik byte-gleich: der Pool verändert die Reise-Entscheidungen nicht');
    ok(a.rng() === b.rng() && a.rng() === b.rng(), 'game.rng gleich (nicht verbraucht)');
    const wa = JSON.stringify(Kriegslage.toSave(ws(a))), wb = JSON.stringify(Kriegslage.toSave(ws(b)));
    ok(wa === wb && !/Funker/.test(wa), 'Weltstand byte-gleich, der Pool steht nicht darin');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Schalter aus = nichts passiert', async () => {
    Pool.zuruecksetzen();
    const llm = fakeLlm(); Pool.setLlm(llm);
    const gs = [spiel({ env: { REISE_EREIGNISSE: '1' } }).g, spiel({ env: { REISE_EREIGNISSE: '1', TEXTE_POOL: '0' } }).g, spiel({ env: { REISE_EREIGNISSE: '1', TEXTE_POOL: 'off' } }).g];
    ok(gs.every((g) => !Pool.aktiv(g)) && Pool.aktiv(spiel({ env: { TEXTE_POOL: '1' } }).g) && Pool.aktiv(spiel({ env: { TEXTE_POOL: 'on' } }).g) && W.standard_an === false, 'Standard aus; TEXTE_POOL=1/on an, 0/off/leer aus');
    for (const g of gs) { Pool.beiGrenze(g, 'andocken'); Pool.update(g, 999); g.lageGrenze('andocken'); lauf(g, 2); }
    ok(llm.calls.length === 0 && Pool.stand().gesamt === 0 && Pool.stand().zaehler.jobs === 0, 'ohne Schalter: kein Job, kein Aufruf, kein Text, auch nicht bei Grenzen und langer Zeit');
    ok(Pool.beiGrenze(gs[0], 'x') === false, 'beiGrenze ohne Schalter: nichts');
    // Standard an (Datum): TEXTE_POOL=off und 0 schalten trotzdem aus, ohne Variable gilt der Standard
    const std = W.standard_an; W.standard_an = true;
    try { ok(Pool.aktiv(spiel({ env: { REISE_EREIGNISSE: '1' } }).g) && !Pool.aktiv(spiel({ env: { TEXTE_POOL: 'off' } }).g) && !Pool.aktiv(spiel({ env: { TEXTE_POOL: '0' } }).g), 'Datum standard_an=true: ohne Variable an, TEXTE_POOL=0 und off schalten aus'); } finally { W.standard_an = std; }
    // ein gefüllter Pool wird ohne Schalter nicht über poolText gelesen
    const an = spiel().g; Pool.setLlm(fakeLlm()); await fuellen(an);
    const voll = Pool.stand().gesamt;
    ok(voll > 100 && Pool.poolText(gs[0], 'lage', 'posten_verloren', 'verlust', { ort: 'A' }) === null && Pool.stand().gesamt === voll && typeof Pool.poolText(an, 'lage', 'posten_verloren', 'verlust', { ort: 'A' }) === 'string', 'poolText ohne Schalter: nichts (der Pool bleibt voll), mit Schalter: der Text');
    // Funk byte-gleich zu 03a: Söldner-Befehl ohne Schalter kein Funk, Verlust-Funk der Vorlage
    const g = gs[0];
    const kon = ws(g).zustand.flotten.find((f) => Regie && f.fraktion === 'kon');
    const plan = { befehle: [{ typ: 'soeldner', von: 'kon', an: 'rom', flotten: [kon.id], dauer: 12 }] };
    const r = Regie.planAnwenden(g, plan);
    ok(r.ok && r.angenommen.length === 1 && r.funk.length === 0, 'Söldner-Befehl ohne Schalter: angenommen, kein Funk (wie 03a)');
    const radio = [];
    const alt = g.emit.bind(g); g.emit = (k, d) => { if (k === 'radio') radio.push(d); return alt(k, d); };
    Wissen.ausgeben(g, { markenEntfernen: [], markenSetzen: [], funk: [{ von: 'OSTIA', text: 'Posten Ostia verloren.', verlust: { id: 'posten_verloren', ort: 'Ostia' }, loc: null, t: 1 }] });
    ok(radio.length === 1 && radio[0].text === 'Posten Ostia verloren.', 'Verlust-Funk ohne Schalter: die heutige Vorlage');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Neue Slots: Söldner-Funk und Verlust-Funk', async () => {
    Pool.zuruecksetzen();
    const t = spiel({ env: Object.assign({}, ENV, SPL) }); const g = t.g;
    const kon = () => ws(g).zustand.flotten.find((f) => f.fraktion === 'kon' && !f.miete && f.befehl === 'heim');
    const befehl = (an, id) => ({ befehle: [{ typ: 'soeldner', von: 'kon', an, flotten: [id], dauer: 12 }] });
    // der Funk kommt mit dem Sim-Ereignis soeldner_vermietet (nicht beim Vormerken): vormerken, dann Ticks bis zum Wirksamwerden
    const vermieten = (gg, an, id) => {
      const radio = [];
      const alt = gg.emit.bind(gg); gg.emit = (k, d) => { if (k === 'radio' && d.from === 'Händlerfunk') radio.push(d); return alt(k, d); };
      try {
        ws(gg).regie.letzte = {}; ws(gg).regie.rate = [];
        const r = Regie.planAnwenden(gg, befehl(an, id));
        const vorher = radio.length;
        const ab = ws(gg).regie.vorgemerkt[ws(gg).regie.vorgemerkt.length - 1].ab;
        while (ws(gg).tickZahl < ab) Kriegslage.tick(gg, 'test');
        return { r, beimVormerken: vorher, radio };
      } finally { gg.emit = alt; }
    };
    // Pool leer, Schalter an: Katalogtext aus lage-befehle.json, erst nach dem Ereignis
    const f0 = kon();
    const v0 = vermieten(g, 'rom', f0.id);
    ok(v0.r.ok && v0.r.funk.length === 0 && v0.beimVormerken === 0, 'beim Vormerken des Befehls: kein Funk (die Sim hat noch nichts vermietet)');
    ok(v0.radio.length === 1 && /Kriegsschiffe an Rom/.test(v0.radio[0].text) && ws(g).zustand.flotten.some((f) => f.id === f0.id && f.miete), 'nach dem Ereignis soeldner_vermietet: Katalogtext des Konkordats (an Rom), die Flotte ist wirklich vermietet');
    ok(funkTexte(t).some((x) => /Kriegsschiffe an Rom/.test(x)), 'der Funk ging an die Spieler');
    // mit Pool: Pool-Text, {n} = Zahl der Flotten
    Pool.setLlm(fakeLlm()); await fuellen(g);
    const f1 = ws(g).zustand.flotten.find((f) => f.fraktion === 'kon' && !f.miete && f.befehl === 'heim' && f.id !== f0.id);
    Pool.update(g, 0.1);
    const v1 = vermieten(g, 'ger', f1.id);
    ok(v1.radio.length === 1 && /^Funker /.test(v1.radio[0].text) && !/\{/.test(v1.radio[0].text), 'mit Pool: Pool-Text für Söldner an die Germanen' + (v1.radio[0] ? ' (' + v1.radio[0].text.slice(0, 40) + ')' : ''));
    ok(Pool.stand().pool['lage|soeldner_an_ger|soeldner|'] === W.ziel - 1 && Pool.stand().pool['lage|soeldner_an_rom|soeldner|'] === W.ziel, 'der Text kam aus dem Pool-Schlüssel des Reichs (soeldner_an_ger), der andere blieb voll');
    ok(ws(g).zustand.flotten.some((f) => f.id === f1.id && f.miete), 'die Sim hat die Flotte vermietet (der Funk ändert nichts an der Sim)');
    // Pool leer, Söldner an die Germanen: der Katalogtext der Germanen
    Pool.zuruecksetzen(); Pool.update(g, 0.1);
    const f2 = ws(g).zustand.flotten.find((f) => f.fraktion === 'kon' && !f.miete && f.befehl === 'heim' && f.id !== f0.id && f.id !== f1.id);
    if (f2) {
      const v2 = vermieten(g, 'ger', f2.id);
      ok(v2.radio.length === 1 && /Kriegsschiffe an die Germanen/.test(v2.radio[0].text), 'Pool leer, Söldner an die Germanen: Katalogtext „… an die Germanen“');
    } else ok(true, 'keine dritte freie Konkordat-Flotte im Testspiel (Germanen-Katalogtext übersprungen)');
    // Fix S4: scheitert der Kern beim Ausführen (hier: Flotte inzwischen unterwegs), wird nie „vermietet“ gefunkt
    const gf = spiel({ env: Object.assign({}, ENV, SPL) }).g;
    const kf = ws(gf).zustand.flotten.find((f) => f.fraktion === 'kon' && !f.miete && f.befehl === 'heim');
    const radioF = []; const altF = gf.emit.bind(gf); gf.emit = (k, d) => { if (k === 'radio' && d.from === 'Händlerfunk') radioF.push(d); return altF(k, d); };
    const rf = Regie.planAnwenden(gf, befehl('rom', kf.id));
    kf.befehl = 'angriff';   // nach der Annahme ändert sich der Stand: der Kern lehnt die Miete beim Ausführen ab
    const abF = ws(gf).regie.vorgemerkt[0].ab;
    while (ws(gf).tickZahl < abF) Kriegslage.tick(gf, 'test');
    ok(rf.ok && radioF.length === 0 && !ws(gf).zustand.flotten.some((f) => f.miete), 'scheiternder Befehl (Kern lehnt beim Ausführen ab): kein Funk, nichts vermietet');
    // Schalter-Matrix: der Funk hängt nur am Lage-Spielleiter-Schalter, der Pool-Schalter ändert nur den Text
    const matrix = [];
    for (const [name, env] of [['nur Pool', ENV], ['nur Spielleiter', Object.assign({ REISE_EREIGNISSE: '1' }, SPL)], ['beide', Object.assign({}, ENV, SPL)], ['keiner', { REISE_EREIGNISSE: '1' }]]) {
      Pool.zuruecksetzen();
      const gg = spiel({ env }).g;
      const kk = ws(gg).zustand.flotten.find((f) => f.fraktion === 'kon' && !f.miete && f.befehl === 'heim');
      ws(gg).regie.vorgemerkt.push({ b: { typ: 'soeldner', von: 'kon', an: 'rom', flotten: [kk.id], dauer: 12 }, ab: ws(gg).tickZahl + 1 });   // ohne Spielleiter gäbe es den Befehl nicht: direkt vormerken (der Kern führt ihn aus)
      const rad = []; const al = gg.emit.bind(gg); gg.emit = (k, d) => { if (k === 'radio' && d.from === 'Händlerfunk') rad.push(d); return al(k, d); };
      Kriegslage.tick(gg, 'test'); Kriegslage.tick(gg, 'test');
      matrix.push(name + ': ' + rad.length);
    }
    ok(matrix.join(' | ') === 'nur Pool: 0 | nur Spielleiter: 1 | beide: 1 | keiner: 0', 'Schalter-Matrix: Funk nur mit dem Lage-Spielleiter (TEXTE_POOL allein funkt nie, ändert nur den Text): ' + matrix.join(' | '));
    // Verlust-Funk
    Pool.setLlm(fakeLlm()); await fuellen(g);
    const radio = [];
    const alt = g.emit.bind(g); g.emit = (k, d) => { if (k === 'radio') radio.push(d); return alt(k, d); };
    const verlust = (id, text) => Wissen.ausgeben(g, { markenEntfernen: [], markenSetzen: [], funk: [{ von: 'OSTIA NOVA', text, verlust: { id, ort: 'Ulfsvakt' }, loc: null, t: 5 }] });
    verlust('posten_verloren', 'Posten Ulfsvakt verloren.');
    verlust('hafen_gefallen', 'Ulfsvakt ist gefallen.');
    ok(radio.length === 2 && radio.every((r) => /^Funker /.test(r.text) && r.from === 'OSTIA NOVA' && r.lage === 1), 'Verlust-Funk mit Pool: Pool-Text, Absender (nächster eigener Ort) bleibt');
    ok(radio.every((r) => !/\{ort\}/.test(r.text)) && radio[0].text.includes('Posten') && radio[1].text.includes('Hafen'), '{ort} ist eingesetzt, Posten- und Hafen-Spruch getrennt');
    Pool.zuruecksetzen(); Pool.update(g, 0.1);
    verlust('posten_verloren', 'Posten Ulfsvakt verloren.');
    ok(radio[2].text === 'Posten Ulfsvakt verloren.', 'Pool leer: die heutige Vorlage (Rückfall)');
    // der echte Weg: Sim-Ereignisse hafen_gefallen und posten_verloren durch das Wissen von Rom (Funk sofort, Rom ist Beteiligter)
    const tickMit = (ev) => { const vor = Kriegslage.abbild(ws(g).zustand); ws(g).tickZahl++; ws(g).zustand.tick++; Wissen.nachTick(g, vor, ev, '0305'); };
    const hf = { typ: 'hafen_gefallen', tick: 1, fraktion: 'ger', ort: '0403', ortName: 'Speculum', alt: 'rom', neu: 'ger' };
    const pv = { typ: 'posten_verloren', tick: 1, fraktion: 'rom', ort: '0603', ortName: 'Kantenstein', besitzer: 'rom', durch: 'pirat' };
    radio.length = 0;
    tickMit([hf]); tickMit([pv]);
    ok(radio.length === 2 && /Speculum ist gefallen\./.test(radio[0].text) && /Kantenstein verloren\./.test(radio[1].text), 'echter Weg, Pool leer: die heutigen Vorlagen („… ist gefallen“, „… verloren“)');
    Pool.setLlm(fakeLlm()); await fuellen(g);
    radio.length = 0;
    const hf2 = Object.assign({}, hf, { ort: '0404', ortName: 'x' }), pv2 = Object.assign({}, pv, { ort: '0604' });
    tickMit([hf2]); tickMit([pv2]);
    ok(radio.length === 2 && radio.every((r) => /^Funker /.test(r.text) && !/\{/.test(r.text)) && /Hafen/.test(radio[0].text) && /Posten/.test(radio[1].text), 'echter Weg, Pool gefüllt: Pool-Text, {ort} eingesetzt' + (radio[0] ? ' (' + radio[0].text.slice(-30) + ')' : ''));
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Schnittstelle für Paket A: reaktion und antwort', async () => {
    Pool.zuruecksetzen();
    const g = spiel().g;
    ok(Pool.poolBefuellenAnfordern({}).ok === false && Pool.poolBefuellenAnfordern({ art: 'npc', id: 'x', slot: 'unbekannt', fakt: 'f' }).ok === false && Pool.poolBefuellenAnfordern({ art: 'npc', id: 'x', slot: 'reaktion' }).ok === false, 'ungültige Anmeldungen werden abgelehnt (Pflichtfelder, bekannter Slot, Fakt)');
    const r = Pool.poolBefuellenAnfordern({ art: 'npc', id: 'livia', slot: 'reaktion', optionId: 'o1', sprecher: 'Optio Livia Rufa', stimme: 'rom', fakt: 'Die Lerche hat den Gegenangriff abgewehrt.', antwort: 'Sektor gesichert.', platzhalter: ['ort', 'schiff'], ziel: 2 });
    ok(r.ok && r.key === 'npc|livia|reaktion|o1' && r.vorhanden === 0 && r.ziel === 2, 'Anmeldung: Schlüssel art|id|slot|optionId, Ziel 2, nur erlaubte Platzhalter bleiben');
    const r2 = Pool.poolBefuellenAnfordern({ art: 'npc', id: 'livia', slot: 'antwort', optionId: 'o1', fakt: 'Livia fragt die Crew nach dem Sektor.', option: 'die Crew bestätigt knapp', ziel: 1 });
    ok(r2.ok && r2.key === 'npc|livia|antwort|o1', 'Slot antwort desselben NSC und derselben Option: eigener Schlüssel');
    const llm = fakeLlm({ antwort: (p, nr) => (/Textart: antwort/.test(p) ? 'Wir halten den Sektor' : gueltigerText(p, nr)) }); Pool.setLlm(llm);
    // nur die angemeldeten Schlüssel zählen: Katalog zuerst voll, dann die Anmeldungen
    await fuellen(g);
    ok(Pool.stand().pool['npc|livia|reaktion|o1'] === 2 && Pool.stand().pool['npc|livia|antwort|o1'] === 1, 'Hintergrund-Füllung bis zum Ziel: 2 Reaktionen, 1 Antworttext');
    const re = Pool.poolEntnehmen('npc', 'livia', 'reaktion', 'o1'), an = Pool.poolEntnehmen('npc', 'livia', 'antwort', 'o1');
    ok(/^Funker /.test(re) && an === 'Wir halten den Sektor' && an.length <= 40, 'poolEntnehmen(art, id, slot, optionId): Text oder null; Optionstext höchstens 40 Zeichen');
    ok(Pool.poolEntnehmen('npc', 'livia', 'reaktion', 'o2') === null && Pool.poolEntnehmen('npc', 'livia', 'reaktion') === null, 'andere Option oder keine Option: leer');
    const antwortPrompt = llm.calls.find((c) => /Textart: antwort/.test(c.input.prompt) && /die Crew bestätigt knapp/.test(c.input.prompt)).input.prompt;
    ok(/<option>/.test(antwortPrompt) && /die Crew bestätigt knapp/.test(antwortPrompt) && /Länge: 8 bis 40 Zeichen/.test(antwortPrompt), 'Prompt der Antwortoption: Absicht der Option und die 40-Zeichen-Grenze');
    const reaPrompt = llm.calls.find((c) => /Textart: reaktion/.test(c.input.prompt) && /Optio Livia Rufa/.test(c.input.prompt)).input.prompt;
    ok(/<spieler_antwort>\nSektor gesichert\./.test(reaPrompt) && /Optio Livia Rufa/.test(reaPrompt), 'Prompt der Reaktion: Antwort der Spieler und Sprecher');
    ok(/Erlaubte Platzhalter: \{ort\}\./.test(reaPrompt) && !/\{schiff\}/.test(reaPrompt), 'unbekannte Platzhalter der Anmeldung fallen weg (nur {ort} und {n} sind möglich)');
    // zu langer Optionstext wird abgelehnt
    Pool.zuruecksetzen();
    Pool.poolBefuellenAnfordern({ art: 'npc', id: 'z', slot: 'antwort', optionId: 'a', fakt: 'f', option: 'x', ziel: 1 });
    const lang = fakeLlm({ antwort: () => 'Das ist eine viel zu lange Antwortoption für die Funkauswahl' }); Pool.setLlm(lang);
    for (let i = 0; i < 3; i++) { Pool.beiGrenze(g); Pool.update(g, 0.1); await Pool.jobFertig(); }
    ok(Pool.poolEntnehmen('npc', 'z', 'antwort', 'a') === null && Pool.stand().zaehler.ungueltig >= 1, 'Optionstext über 40 Zeichen kommt nie in den Pool');
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  await section('Funk-Antworten mit ECHTEM Pool: angeklickter Text = Funk = Chronik, Beschriftung nie aus dem Pool (Fix M1, M2)', async () => {
    const FA = require('../server/sim/funk-antwort.js');
    Pool.zuruecksetzen(); FA.setzePool(null);
    const t = spiel(); const g = t.g;
    const llm = fakeLlm({ antwort: (p, nr) => (/Textart: reaktion/.test(p) ? 'Pool-Reaktion Nummer ' + WOERTER[nr % 8] + ' wird gesendet.' : gueltigerText(p, nr)) }); Pool.setLlm(llm);
    await fuellen(g);
    ok(Pool.stand().gesamt > 0 && Object.keys(Pool.stand().pool).every((k) => !/\|antwort\|/.test(k)), 'der Pool enthält keinen einzigen Schlüssel für die Beschriftung einer Option (Slot antwort)');
    ok(Pool.katalogSpecs().every((s) => s.slot !== 'antwort') && !llm.calls.some((c) => /Textart: antwort/.test(c.input.prompt)), 'keine angemeldete Spec und kein Modellaufruf für Beschriftungen');
    const reaktionen = Pool.katalogSpecs().filter((s) => s.slot === 'reaktion');
    ok(reaktionen.length === KAT.reduce((s, e) => s + (e.antworten || []).length, 0) && reaktionen.length > 0 && reaktionen.every((s) => s.antwort && s.beispiele.length === 1 && s.fakt.includes(W.reaktion_regel)), 'alle Reaktions-Specs (eine je Antwortoption) tragen die Regel aus den Daten (bestätigen, nichts versprechen, nicht widersprechen) im Fakt');
    const spec = reaktionen.find((s) => s.id === 'patrouille_rom_gruss' && s.optionId === 'saum');
    const pr = Pruefer.promptBauen(Object.assign({}, spec, { namen: [] }), {});
    ok(pr.includes('<spieler_antwort>\n' + spec.antwort + '\n</spieler_antwort>') && /Wir fliegen für den Saum\./.test(pr) && /kein Versprechen/.test(pr) && /widerspricht ihr nicht/.test(pr), 'Prompt der Reaktion kennt den Katalogtext der gewählten Option und die Regel (kein Gegenteil, kein Versprechen)');
    Pool.update(g, 0.1);
    ok(Pool.freigegeben(), 'Pool freigegeben (TEXTE_POOL=1 im Raum)');
    sicher(() => nur(['patrouille_rom_gruss'], () => { ws(g).zustand.flotten = []; g.space.enemies = []; ws(g).reise.letzter = null; ws(g).reise.letzte = []; springe(g, '0305'); }));
    const FW = ws(g).funkwahl, off = FW && FW.offen;
    ok(!!off && off.optionen.length === 2, 'Angebot da (Streife, zwei Optionen)');
    const gezeigt = off.optionen.find((o) => o.id === 'saum').text;
    const vorStand = JSON.stringify(Pool.stand().pool);
    const vorherFunk = funkTexte(t).length;
    ok(FA.beantworten(g, 'saum', off.lfd) === null, 'Antwort angenommen');
    const nachStand = Pool.stand().pool;
    const verbraucht = Object.keys(JSON.parse(vorStand)).filter((k) => (JSON.parse(vorStand)[k] || 0) !== (nachStand[k] || 0));
    ok(verbraucht.length === 1 && /^patrouille\|patrouille_rom_gruss\|reaktion\|saum$/.test(verbraucht[0]), 'beim Antworten wird genau EIN Pooltext verbraucht: die Reaktion (' + verbraucht.join(',') + ')');
    lauf(g, RE.WERTE.antwort_reaktion_s + 1);
    const neu = funkTexte(t).slice(vorherFunk);
    ok(neu[0] === gezeigt && gezeigt === 'Wir fliegen für den Saum.', 'angeklickter Text = gesendeter Funk: ' + neu[0]);
    ok(/^Pool-Reaktion Nummer /.test(neu[1] || ''), 'danach die Reaktion des Sprechers aus dem Pool');
    ok((ws(g).chronik || []).some((c) => c.kurz === 'Funkantwort an Römische Streife: ' + gezeigt), 'Chronik trägt denselben Text');
  });

  console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('  FEHLER Ausnahme: ' + (e && e.stack)); process.exit(1); });
