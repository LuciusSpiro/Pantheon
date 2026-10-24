'use strict';
// SUND-03 B (d): Reparaturen der Referenzfehler kleiner Modelle (Szenenbau.repairGrobplanReferenzen): Kennung statt Id, "null" als
// Text, doppelter Umsetzungs-Präfix. Je Fall Positiv- und Negativfall (nicht eindeutig → keine Reparatur), dazu der Weg durch den
// Spielleiter bis ins Regie-Logbuch (`reparaturen`).   node tools/test-reparaturen-ref.js
const H = require('./transport-testhilfe.js');
const LLM = require('../server/mission/llm.js');
const SB = require('../server/mission/szenenbau.js');
const Katalog = require('../server/mission/katalog.js');
const Archiv = require('../server/mission/archiv.js');
const Spielleiter = require('../server/mission/spielleiter.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

const T = H.runner('Referenz-Reparaturen');
const clone = (o) => JSON.parse(JSON.stringify(o));
const katalog = Katalog.load({});
const env = SB.buildEnv(katalog);
const plan = (...szenen) => ({ szenen });
const rep = (g, e) => SB.repairGrobplanReferenzen(g, e || env);

(async () => {
  // ---- Kennung statt Id ----
  const ids = Object.values(katalog.szenentypen);
  const hafen = ids.find((s) => s.id === 'hafen'); const abl = ids.find((s) => s.id === 'ablieferung');
  T.check('Katalog: hafen hat Kennung D1, ablieferung A12', hafen && hafen.kennung === 'D1' && abl && abl.kennung === 'A12', `${hafen && hafen.kennung} ${abl && abl.kennung}`);
  {
    const g = plan({ id: 's1', szenentyp: 'D1' }, { id: 's2', szenentyp: 'A12' }, { id: 's3', szenentyp: 'a12 ' });
    const r = rep(g);
    T.check('Kennung D1/A12 (auch klein/mit Leerraum) → Id, je Reparatur gemeldet', g.szenen[0].szenentyp === 'hafen' && g.szenen[1].szenentyp === 'ablieferung' && g.szenen[2].szenentyp === 'ablieferung' && r.length === 3 && r.every((x) => /Kennung/.test(x)), JSON.stringify(r));
  }
  {
    const g = plan({ id: 's1', szenentyp: 'ablieferung' }, { id: 's2', szenentyp: 'Z99' }, { id: 's3', szenentyp: 'erfundener_typ' });
    const r = rep(g);
    T.check('Negativ: gültige Id, unbekannte Kennung, erfundener Typ bleiben unverändert, keine Meldung', g.szenen.map((s) => s.szenentyp).join() === 'ablieferung,Z99,erfundener_typ' && r.length === 0, JSON.stringify(r));
  }
  {
    // nicht eindeutig: zwei Szenentypen mit derselben Kennung (z. B. aus einer Mod)
    const kat = clone({ szenentypen: { a: { id: 'a', kennung: 'X1' }, b: { id: 'b', kennung: 'X1' }, c: { id: 'c', kennung: 'X2' } }, molekuele: {} });
    const g = plan({ id: 's1', szenentyp: 'X1' }, { id: 's2', szenentyp: 'X2' });
    const r = rep(g, { katalog: kat });
    T.check('Negativ: doppelt vergebene Kennung → keine Reparatur; eindeutige daneben schon', g.szenen[0].szenentyp === 'X1' && g.szenen[1].szenentyp === 'c' && r.length === 1, JSON.stringify(r));
  }

  // ---- "null" als Text ----
  {
    const g = plan({ id: 's1', karte: 'null', landepunkt: 'NULL' }, { id: 's2', karte: ' null ' });
    const r = rep(g);
    T.check('"null" (Text, auch NULL/mit Leerraum) bei karte und landepunkt → null, gemeldet', g.szenen[0].karte === null && g.szenen[0].landepunkt === null && g.szenen[1].karte === null && r.length === 3, JSON.stringify(r));
  }
  {
    const g = plan({ id: 's1', karte: null, landepunkt: 'kesh.aussenposten-1' }, { id: 's2', karte: 'relais_map' }, { id: 's3', karte: 'nullpunkt' }, { id: 's4' });
    const r = rep(g);
    T.check('Negativ: echtes null, echte/erfundene Karte, "nullpunkt", fehlendes Feld bleiben', g.szenen[0].karte === null && g.szenen[0].landepunkt === 'kesh.aussenposten-1' && g.szenen[1].karte === 'relais_map' && g.szenen[2].karte === 'nullpunkt' && !('karte' in g.szenen[3]) && r.length === 0, JSON.stringify(r));
  }

  // ---- doppelter Umsetzungs-Präfix ----
  {
    const g = plan({ id: 's1', molekuele: [{ id: 'verhandeln', umsetzung: 'verhandeln/verhandeln/funkduell' }, { id: 'verhandeln', umsetzung: 'verhandeln/funkduell' }, { id: 'verhandeln', umsetzung: 'funkduell' }] });
    const r = rep(g);
    T.check('verhandeln/verhandeln/funkduell und verhandeln/funkduell → funkduell; gültiges bleibt', g.szenen[0].molekuele.every((m) => m.umsetzung === 'funkduell') && r.length === 2 && r.every((x) => /Präfix/.test(x)), JSON.stringify(r));
  }
  {
    const g = plan({ id: 's1', molekuele: [
      { id: 'verhandeln', umsetzung: 'verhandeln/erfunden' },        // Rest ist keine Umsetzung des Moleküls
      { id: 'verhandeln', umsetzung: 'schmuggeln/funkduell' },       // Präfix eines anderen Moleküls
      { id: 'erfunden', umsetzung: 'erfunden/funkduell' },           // Molekül unbekannt
      { id: 'verhandeln', umsetzung: 'a/b/c' }, { id: 'verhandeln', umsetzung: '' }, { id: 'verhandeln' }, 'kein Objekt'] });
    const vorher = JSON.stringify(g);
    const r = rep(g);
    T.check('Negativ: nicht eindeutig oder unbekannt → nichts verändert, nichts gemeldet', JSON.stringify(g) === vorher && r.length === 0, JSON.stringify(r));
  }
  T.check('Negativ: kein Plan / keine Szenenliste → leer, kein Wurf', rep(null).length === 0 && rep({}).length === 0 && rep({ szenen: 'x' }).length === 0 && rep(plan(null, 5)).length === 0, '');
  {
    // an echten Plänen: Reparatur lässt gültige Grobpläne unangetastet
    let n = 0; let verändert = 0;
    for (const e of Archiv.load().entries) { n++; const g = clone(e.grobplan); if (rep(g).length || JSON.stringify(g) !== JSON.stringify(e.grobplan)) verändert++; }
    T.check(`gültige Archiv-Grobpläne (${n}) bleiben unverändert`, n >= 5 && verändert === 0, `${verändert} verändert`);
  }

  // ---- durch den Spielleiter ins Logbuch ----
  await T.safe('Spielleiter: Grobplan mit allen drei Fehlern wird repariert und angeboten, Reparaturen stehen im Logbuch', async () => {
    const ctx = H.kontextNachTutorial();
    const g = LLM.mockGrobplan({ kontext: ctx }, katalog);
    const kennung = (id) => katalog.szenentypen[id].kennung;
    const s2 = g.szenen[1]; const s3 = g.szenen[2];
    s2.szenentyp = kennung(s2.szenentyp); s2.karte = 'null';
    const m3 = s3.molekuele[0]; m3.umsetzung = `${m3.id}/${m3.umsetzung}`;
    const F = H.fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: { grobplan: [{ json: g }] } }), kontext: () => ctx, archiv: Archiv.load().entries, regieDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-ref-')), katalog, memoryLog: true, ablage: null, config: { offers: 1 } });
    sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
    await H.ticks(sl, F.g, 10, 0.25, () => sl.offers().some((o) => o.origin === 'sl'));
    const e = sl.regie.entries.find((x) => x.art === 'grobplan' && x.quelle === 'llm');
    const reps = (e && e.reparaturen) || [];
    T.check('SL-Angebot entstanden (kein Neuversuch nötig), Versuch 1', sl.offers().some((o) => o.origin === 'sl') && e && e.versuch === 1 && !e.fehler.length, JSON.stringify(e && e.fehler));
    T.check('Logbuch: Kennung, "null" und Präfix unter reparaturen', reps.some((x) => /Kennung/.test(x)) && reps.some((x) => /"null"/.test(x)) && reps.some((x) => /Präfix/.test(x)), JSON.stringify(reps));
    T.check('kein gezählter Fehler', !F.errors.length, F.errors.join(' | '));
  });

  // ---- B2: fehlendes loc und erfundene Lexikon-Platzhalter in Szenen-Antworten ----
  {
    const szene = { id: 's2_x', ort: 'kesh', molekuele: [{ id: 'verhandeln', umsetzung: 'funkduell' }], weiter: [{ nach: 'ausgang:erfolg' }] };
    const g = { id: 'g', szenen: [szene] };
    const u = katalog.molekuele.verhandeln.umsetzungen.find((x) => x.id === 'funkduell');
    const locName = Object.keys(u.params).find((p) => u.params[p].typ === 'loc');
    const textName = Object.keys(u.params).find((p) => u.params[p].typ === 'text');
    const lex = (t) => SB.repairSceneAnswerLexLoc(g, szene, { molekuele: [{ id: 'verhandeln', umsetzung: 'funkduell', params: { npc: 'tesk', [locName]: 'kesh', [textName]: t } }], verzweigung: [], wendung: null }, env);
    const txt = (r) => r.answer.molekuele[0].params[textName];
    const r1 = lex('Die {{lex.lerche:die}} Lerche fliegt zu {{lex.kesh.grabung:den}} Ruinen.');
    T.check('erfundene Platzhalter → Artikelform, doppelte Artikel zusammengezogen, gemeldet', txt(r1) === 'Die Lerche fliegt zu den Ruinen.' && r1.repairs.some((x) => /2 erfundene/.test(x)), txt(r1) + ' | ' + JSON.stringify(r1.repairs));
    const bek = [...require('../server/mission/lexikon.js').bekannt()][0];
    const r2 = lex(`Der {{lex.${bek}:der}} bleibt, {{neu:Herold}} spricht.`);
    T.check('bekannter Schlüssel bleibt, {{neu:Name}} → Name', txt(r2).includes(`{{lex.${bek}:der}}`) && txt(r2).includes('Herold spricht') && !txt(r2).includes('{{neu'), txt(r2));
    for (const t of ['Fliegt zu {{lex.kesh}}.', 'Dort {{lex.lerche:blau}} hin', 'Offen {{lex.kaputt', '{{fund_name}} liegt dort']) {
      const r = lex(t);
      T.check(`nicht eindeutig → unverändert: ${t}`, txt(r) === t && !r.repairs.length, txt(r));
    }
    const l1 = SB.repairSceneAnswerLexLoc(g, szene, { molekuele: [{ id: 'verhandeln', umsetzung: 'funkduell', params: { npc: 'tesk' } }] }, env);
    T.check('fehlendes loc (Typ loc ohne Werteliste) → Ort der Szene, gemeldet', !locName || (l1.answer.molekuele[0].params[locName] === 'kesh' && l1.repairs.some((x) => /aus der Szene ergänzt/.test(x))), JSON.stringify(l1));
    const l2 = SB.repairSceneAnswerLexLoc(g, szene, { molekuele: [{ id: 'verhandeln', umsetzung: 'funkduell', params: { [locName || 'loc']: 'anders' } }] }, env);
    T.check('vorhandenes loc bleibt (auch ein falsches: das meldet der Prüfer)', !locName || (l2.answer.molekuele[0].params[locName] === 'anders' && !l2.repairs.length), JSON.stringify(l2));
    const l3 = SB.repairSceneAnswerLexLoc(g, szene, { molekuele: [] }, env);
    const l4 = SB.repairSceneAnswerLexLoc(g, szene, null, env);
    T.check('falsche Molekülzahl / keine Antwort → nichts erfunden, kein Wurf', !l3.repairs.length && !l4.repairs.length && l3.answer.molekuele.length === 0, JSON.stringify([l3, l4]));
    const orig = { molekuele: [{ id: 'verhandeln', umsetzung: 'funkduell', params: { [textName]: '{{lex.x:die}} Y' } }] };
    const kopie = JSON.stringify(orig); SB.repairSceneAnswerLexLoc(g, szene, orig, env);
    T.check('die Antwort selbst wird nicht verändert', JSON.stringify(orig) === kopie, '');
  }
  T.finish();
})();
