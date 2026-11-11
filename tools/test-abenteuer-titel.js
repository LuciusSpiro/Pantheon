'use strict';
// FRE-02 T (Befund 4): Brett-Titel gleicht dem Plan-Titel. Der Namensfilter des Brettes ersetzt nur GANZE Woerter (ohneNamenGanzwort), nicht jedes Wort mit einem Spielernamen als Praefix:
// Spieler „Bo“ macht aus „Die verborgene Boje“ keine „Crew“. Ein Spielername als ganzes Wort wird weiter ersetzt (kein Spielername an ein LLM).
// Geprueft ueber die echten Wege: Brett.snapshot (Titel, Anlass) und Brett.hinweisAnbieten (Funktext).
// Aufruf: node tools/test-abenteuer-titel.js        (npm run test:abenteuer-titel)
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const { Faden, F } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

function neu(seed, names) {
  const t = F.neuesSpiel({ crew: names.length, seed, names, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  return t;
}
const plan = (titel, anlass) => ({ format: 'faden-bauplan/1', titel, anlass: anlass || 'Ein Probeanlass ohne Namen fuer den Test', beats: [{ typ: 'geruecht' }, { typ: 'abschluss' }] });
const funk = (t) => t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio' && typeof m.text === 'string' && m.text.startsWith('Neuer Auftrag am Brett: ')).map((m) => m.text);
function block(g) { for (let i = 0; i < 40; i++) { const s = g.snapshot(); if ('abenteuer' in s.world) return s.world.abenteuer; } return undefined; }
// ein Titel durch Snapshot und Funk; liefert { titel, anlass, funk }
function probe(seed, names, titel, anlass) {
  const t = neu(seed, names), g = t.g;
  const a = Faden.abenteuerAnbieten(g, plan(titel, anlass), { hex: '0305' });
  const b = block(g);
  const e = b && b.angebote.find((x) => x.id === 'a' + (a.angebot && a.angebot.nr));
  Brett.hinweisAnbieten(g, a.angebot);
  return { ok: a.ok, titel: e && e.titel, anlass: e && e.anlass, funk: funk(t).pop(), fehler: g.errors };
}

console.log('\nTitel mit Namenspraefix bleibt unveraendert (Ada, Bo, Cem)');
{
  const r = probe(61, ['Ada', 'Bo', 'Cem'], 'Die verborgene Boje');
  ok(r.ok && r.titel === 'Die verborgene Boje', 'Snapshot-Titel ist „Die verborgene Boje“ (nicht „Crew“): ' + JSON.stringify(r.titel));
  ok(r.funk === 'Neuer Auftrag am Brett: Die verborgene Boje', 'Funktext traegt „Boje“ unveraendert: ' + JSON.stringify(r.funk));
  const r2 = probe(62, ['Ada', 'Bo', 'Cem'], 'Cemento und Adagio', 'Die Boje bei Ada-Hafen, Cemal wartet');
  ok(r2.titel === 'Cemento und Adagio', 'Cem und Ada als Praefix von Cemento, Adagio: Titel gleich Plan-Titel: ' + JSON.stringify(r2.titel));
  ok(r2.anlass === 'Die Boje bei Crew-Hafen, Cemal wartet', 'Anlass: „Ada-Hafen“ (ganzes Wort vor Bindestrich) wird ersetzt, Boje und Cemal bleiben: ' + JSON.stringify(r2.anlass));
}

console.log('\nRueckfall- und Mock-Titel');
{
  const r = probe(63, ['Ein', 'Bo', 'Cem'], 'Ein Gerücht am Hafen');
  ok(r.titel === 'Crew Gerücht am Hafen', 'Spieler „Ein“ ist als GANZES Wort im Titel und wird ersetzt (Schutz bleibt): ' + JSON.stringify(r.titel));
  const r2 = probe(64, ['Eins', 'Bo', 'Cem'], 'Ein Gerücht am Hafen');
  ok(r2.titel === 'Ein Gerücht am Hafen' && r2.funk === 'Neuer Auftrag am Brett: Ein Gerücht am Hafen', 'Spieler „Eins“: „Ein“ im Titel bleibt, Snapshot und Funk gleich Plan-Titel: ' + JSON.stringify([r2.titel, r2.funk]));
  const r3 = probe(65, ['Ein', 'Ada', 'Cem'], 'Einsatz am Hafen');
  ok(r3.titel === 'Einsatz am Hafen' && r3.funk === 'Neuer Auftrag am Brett: Einsatz am Hafen', 'Spieler „Ein“, Titel „Einsatz am Hafen“: unveraendert in Snapshot und Funk: ' + JSON.stringify([r3.titel, r3.funk]));
  // der echte Rueckfall (anschluss.json, Mock-Spielleiter): Titel am Brett = Plan-Titel, auch mit Spielern, die Titelpraefixe treffen
  const ANS = require('../content/faeden/anschluss.json').plaene;
  const woerter = new Set();
  for (const p of ANS) for (const w of p.titel.split(/\s+/)) if (w.length >= 4) woerter.add(w.slice(0, 2));
  const namen = [...woerter].slice(0, 3);
  const t = neu(66, namen), g = t.g;
  delete g.env.ABENTEUER_ANSCHLUSS;   // wie test-abenteuer-brett: das Spiel entsteht ohne Rueckfall, danach gilt der Standard (an)
  for (let i = 0; i < 250; i++) g.step();
  const b = block(g);
  const aus = Faden.zustandVon(g).abenteuerAngebote;
  ok(namen.length === 3 && aus.length >= 1 && b && b.angebote.length === aus.length && aus.every((a, i) => b.angebote[i].titel === Brett.kuerzen(a.vorlage.titel, 40)), 'Rueckfall-Angebot mit Spielern ' + JSON.stringify(namen) + ' (Praefixe der Anschluss-Titel): Brett-Titel = Plan-Titel ' + JSON.stringify(b && b.angebote.map((x) => x.titel)));
  const f = funk(t);
  ok(f.length >= 1 && f[0] === 'Neuer Auftrag am Brett: ' + Brett.kuerzen(aus[0].vorlage.titel, 36), 'Rueckfall-Funk: Titel = Plan-Titel ' + JSON.stringify(f[0]));
}

console.log('\nGegenprobe: Spielername als ganzes Wort wird ersetzt');
{
  const r = probe(67, ['Ada', 'Bo', 'Cem'], 'Bo in Not', 'Bo braucht Hilfe, Ada auch; Cem zahlt.');
  ok(r.titel === 'Crew in Not' && r.funk === 'Neuer Auftrag am Brett: Crew in Not', 'Titel „Bo in Not“ -> „Crew in Not“ in Snapshot und Funk: ' + JSON.stringify([r.titel, r.funk]));
  ok(r.anlass === 'Crew braucht Hilfe, Crew auch; Crew zahlt.', 'Anlass: Namen mit Satzzeichen ersetzt: ' + JSON.stringify(r.anlass));
  const r2 = probe(68, ['Ada', 'Bo', 'Cem'], 'bo und BO');
  ok(r2.titel === 'Crew und Crew', 'Gross/klein egal: ' + JSON.stringify(r2.titel));
  ok(![r, r2].some((x) => /\b(Ada|Bo|Cem)\b/i.test((x.titel || '') + (x.funk || '') + (x.anlass || ''))), 'kein Spielername als Wort in Titel, Anlass, Funk');
  ok(r.fehler === 0 && r2.fehler === 0, 'keine Serverfehler');
}

console.log('\nGenitiv-s, Flexion und gekuerzte Namen (Schutz vor Spielernamen)');
{
  const r = probe(71, ['Ada', 'Bo', 'Cem'], 'Bos Schiff', 'Bo’s Schiff und Adas Boje');
  ok(r.titel === 'Crew Schiff' && r.funk === 'Neuer Auftrag am Brett: Crew Schiff', 'Spieler „Bo“, Titel „Bos Schiff“ -> „Crew Schiff“ in Snapshot und Funk: ' + JSON.stringify([r.titel, r.funk]));
  ok(r.anlass === 'Crew Schiff und Crew Boje', 'Anlass „Bo’s Schiff und Adas Boje“ -> Namen samt Genitiv weg, Boje bleibt: ' + JSON.stringify(r.anlass));
  const r2 = probe(72, ['Ada', 'Bo', 'Cem'], "Bo's Schiff und Boje");
  ok(r2.titel === 'Crew Schiff und Boje', 'Titel mit geradem Apostroph „Bo\'s“: ' + JSON.stringify(r2.titel));
  const r3 = probe(73, ['Ada', 'Bo', 'Cem'], 'Boje und Bordintelligenz', 'Adagio, Bordkante und Cemento');
  ok(r3.titel === 'Boje und Bordintelligenz' && r3.anlass === 'Adagio, Bordkante und Cemento', 'Boje, Bordintelligenz, Adagio bleiben: ' + JSON.stringify([r3.titel, r3.anlass]));
  const lang = 'Mireille_Kas';
  ok(Array.from(lang).length === 12, 'Testname hat genau 12 Zeichen (gekuerzte Speicherung): ' + lang.length);
  const r4 = probe(74, [lang, 'Bo', 'Cem'], 'Mireille_Kassandra', 'Mireille_Kassandras Schiff');
  ok(r4.titel === 'Crew' && r4.anlass === 'Crew Schiff' && !/Mireille/.test(r4.funk || ''), 'Langer Name (12 Zeichen): voller Name im Plan wird ganz ersetzt, nicht „Crewsandra“: ' + JSON.stringify([r4.titel, r4.anlass, r4.funk]));
  const r5 = probe(75, ['Ada', 'Bo', 'Cem'], 'Adagio');
  ok(r5.titel === 'Adagio', 'Spieler „Ada“, Titel „Adagio“ bleibt: ' + JSON.stringify(r5.titel));
  ok(![r, r2, r3, r4, r5].some((x) => x.fehler), 'keine Serverfehler');
}

console.log(`\n${n - fails} von ${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
