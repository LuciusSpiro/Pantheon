'use strict';
// BOT-05 A4: Gedaechtnis der Bot-Figuren (server/bots/gedaechtnis.js, Block crew.botFiguren im Weltstand).
//   node tools/test-bot-gedaechtnis.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const G = require('../server/bots/gedaechtnis.js');
const BotSpieler = require('../server/bots/spieler.js');
const Context = require('../server/mission/context.js');
const Interior = require('../server/sim/interior.js');
const Katalog = require('./katalog.js');
const ANLASS = require('./test-spielleiter.js').ANLASS;

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botged-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const klon = (o) => JSON.parse(JSON.stringify(o));
const MAIN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weltstand-main.schema.json'), 'utf8'));
const ENV = () => ({ MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') });

// Partie mit einem Menschen (Name o.mensch), drei Bots und Weltstand
function partie(o) {
  o = o || {};
  const dir = o.dir || freshDir();
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: ENV(), log: () => {} });
  g.botZufall = () => 0.5;
  const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: o.mensch || 'Kai', color: 0 });
  g.handleMessage(c, Object.assign({ t: 'lobbyOpt', startMission: 'm1' }, o.world ? { world: o.world } : {}));
  for (const r of ['navigation', 'ops', 'technik']) BotSpieler.botHinzufuegen(g, null, r);
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 12; i++) g.step();
  return { g, c, dir };
}
const bots = (g) => g.players.filter((p) => p.bot);

// ---------------------------------------------------------------------------------------------
section('(a) Altstaende laden unveraendert, Save ohne Eintraege ohne Block');
for (const f of ['v1.nach-tutorial.json', 'v2.mitten-m2.json']) {
  const dir = freshDir();
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weltstand', f), 'utf8'));
  fs.writeFileSync(path.join(dir, raw.id + '.json'), JSON.stringify(raw));
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, env: ENV(), log: () => {} });
  const r = Weltstand.load(dir, raw.id, g);
  ok(r.ok, f + ': laedt');
  if (!r.ok) continue;
  Weltstand.apply(g, r.data);
  for (const id of G.BOT_IDS) ok(G.lesen(g, id).length === 0, f + ': Gedaechtnis ' + id + ' leer');
  const cap = Weltstand.capture(g);
  ok(cap.version === 3 && !('botFiguren' in cap.crew), f + ': Save ohne Eintraege hat keinen Block, Version 3');
  ok(Weltstand.validate(cap, g).length === 0 && Weltstand.fallbackValidate(cap, MAIN).length === 0, f + ': Save gueltig gegen eigenes und eingefrorenes Schema');
}

// ---------------------------------------------------------------------------------------------
section('(b) Rundreise merken -> capture -> speichern -> laden -> lesen');
let rund;
{
  const t = partie();
  const g = t.g;
  ok(!!g.weltstand && bots(g).length === 3, 'Partie mit Weltstand und drei Bots');
  ok(G.merken(g, 'b0', { ereignis: 'test', text: 'Erster Eintrag', gewicht: 2 }) && G.merken(g, 'b0', { ereignis: 'test', text: 'Zweiter Eintrag' }) && G.merken(g, 'b2', { ereignis: 'test', text: 'Titus-Eintrag' }), 'merken ok');
  ok(G.merken(g, 'b9', { ereignis: 'x', text: 'y' }) === false && G.merken(g, 'b3', { ereignis: 'x', text: 'y' }) === false && G.merken(g, null, { ereignis: 'x', text: 'y' }) === false, 'unbekannte botId (auch b3): nichts');
  const v0 = G.lesen(g, 'b0');
  ok(v0.length === 2 && G.lesen(g, 'b1').length === 0 && G.lesen(g, 'b2').length === 1 && v0[1].text === 'Zweiter Eintrag', 'lesen: neueste zuletzt, je Figur getrennt');
  v0[0].text = 'veraendert';
  ok(G.lesen(g, 'b0')[0].text === 'Erster Eintrag', 'lesen liefert Kopie');
  const cap = Weltstand.capture(g);
  ok(cap.version === 3 && cap.crew.botFiguren && cap.crew.botFiguren.b0.gedaechtnis.length === 2 && !cap.crew.botFiguren.b1, 'capture: crew.botFiguren nur fuer Figuren mit Eintraegen');
  ok(Weltstand.validate(cap, g).length === 0, 'Schema gueltig mit Block (eigenes Schema)');
  ok(Weltstand.fallbackValidate(cap, MAIN).some((e) => /botFiguren/.test(e)), 'eingefrorenes main-Schema lehnt den Block ab (Pruefung hat Zaehne; Saves ohne Block bleiben gueltig, siehe (a))');
  ok(Weltstand.save(g, { sync: true }).ok, 'save');
  ok(Weltstand.load(t.dir, g.weltstand.id).data.crew.botFiguren.b0.gedaechtnis.length === 2, 'Datei enthaelt den Block');
  const t2 = partie({ dir: t.dir, world: g.weltstand.id });
  ok(t2.g.weltstand && t2.g.weltstand.id === g.weltstand.id, 'Stand fortgesetzt');
  ok(JSON.stringify(G.lesen(t2.g, 'b0')) === JSON.stringify(G.lesen(g, 'b0')) && JSON.stringify(G.lesen(t2.g, 'b2')) === JSON.stringify(G.lesen(g, 'b2')) && G.lesen(t2.g, 'b0').length === 2, 'Rundreise: dieselben Eintraege');
  rund = { g, cap };
}

// ---------------------------------------------------------------------------------------------
section('(c) Obergrenze 12 je Figur, hohe Gewichte bleiben');
{
  const g = partie().g;
  ok(G.MAX_JE_FIGUR === 12, 'Obergrenze je Figur = 12 (Konstante in gedaechtnis.js, kein Config-Schluessel wegen Tuning-Hash)');
  for (let i = 0; i < 50; i++) G.merken(g, 'b1', { ereignis: 'e' + i, text: 'Ereignis ' + i, gewicht: (i === 7 || i === 23 || i === 41) ? 3 : 1 });
  const l = G.lesen(g, 'b1');
  ok(l.length === 12, '50 Ereignisse -> genau 12 (' + l.length + ')');
  ok(['e7', 'e23', 'e41'].every((e) => l.some((x) => x.ereignis === e)), 'die drei Eintraege mit Gewicht 3 bleiben');
  ok(l.filter((x) => x.gewicht === 1).map((x) => x.ereignis).join() === ['e40'].concat(Array.from({ length: 8 }, (_, i) => 'e' + (42 + i))).join(), 'bei Gleichstand faellt der aelteste: von Gewicht 1 bleiben die neuesten neun (e40, e42 bis e49)');
  ok(G.lesen(g, 'b0').length === 0, 'andere Figur unberuehrt');
  G.merken(g, 'b1', { ereignis: 'lang', text: 'x'.repeat(500), gewicht: 3 });
  ok(G.lesen(g, 'b1').pop().text.length === 120, 'Text auf 120 Zeichen begrenzt');
}

// ---------------------------------------------------------------------------------------------
section('(d) Schema mit Block, Ablehnung ungueltiger Bloecke');
{
  const cap = klon(rund.cap);
  ok(Weltstand.validate(cap, rund.g).length === 0, 'gueltig');
  const k1 = klon(cap); k1.crew.botFiguren.b3 = { gedaechtnis: [] };
  ok(Weltstand.validate(k1, rund.g).length > 0, 'unbekannte Figur b3 abgelehnt');
  const k2 = klon(cap); k2.crew.botFiguren.b0.gedaechtnis[0].text = 'x'.repeat(121);
  ok(Weltstand.validate(k2, rund.g).length > 0, 'Text ueber 120 Zeichen abgelehnt');
  const k3 = klon(cap); k3.crew.botFiguren.b0.gedaechtnis[0].name = 'Kai';
  ok(Weltstand.validate(k3, rund.g).length > 0, 'unbekanntes Feld im Eintrag abgelehnt');
}

// ---------------------------------------------------------------------------------------------
section('(e) Spielleiter-Kontext unveraendert durch das Bot-Gedaechtnis');
{
  const katalog = Katalog.load({});
  for (const name of ['mitten-m2', 'nach-m1', 'frisch']) {
    const w = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'context', name + '.weltstand.json'), 'utf8'));
    const anlass = ANLASS[name] || { art: 'test' };
    const ohne = JSON.stringify(Context.build(klon(w), anlass, katalog));
    const mit = klon(w);
    mit.crew = Object.assign({}, mit.crew, { botFiguren: { b0: { gedaechtnis: [{ ereignis: 'mission', text: 'GEHEIMER-BOT-TEXT Mission beendet', spielzeit_s: 12, gewicht: 2 }] }, b2: { gedaechtnis: [{ ereignis: 'gespraech', text: 'GEHEIMER-BOT-TEXT', spielzeit_s: 30 }] } } });
    const mitCtx = JSON.stringify(Context.build(mit, anlass, katalog));
    ok(ohne === mitCtx, name + ': Kontext identisch mit und ohne Block');
    ok(!mitCtx.includes('GEHEIMER-BOT-TEXT') && !/botFiguren/.test(mitCtx), name + ': kein Bot-Gedaechtnistext im Kontext');
  }
}

// ---------------------------------------------------------------------------------------------
section('(f) kein Menschenname in Eintraegen');
{
  const NAME = 'Zephyrine';
  const g = partie({ mensch: NAME }).g;
  ok(g.players.some((p) => !p.bot && p.name === NAME), 'Mensch heisst ' + NAME);
  G.merken(g, 'b0', { ereignis: 'test', text: NAME + ' hat das Schiff gerettet, danke ' + NAME + '!' });
  ok(!JSON.stringify(G.lesen(g, 'b0')).includes(NAME) && G.lesen(g, 'b0')[0].text.includes('jemand'), 'merken: Name im Text entfernt');
  G.beiMissionEnde(g, 'test-mission', 'Rettet ' + NAME, 'erfolg');
  ok(G.lesen(g, 'b1').length === 1 && !G.lesen(g, 'b1')[0].text.includes(NAME), 'Name im Missionstitel entfernt');
  ok(!JSON.stringify(Weltstand.capture(g).crew).includes(NAME), 'crew-Block des Weltstands ohne Menschennamen');
}

// ---------------------------------------------------------------------------------------------
section('(g) Ereignisquellen im Lauf');
{
  const g = partie().g;
  const mid = g.mission.activeId;
  ok(!!mid, 'Mission laeuft: ' + mid);
  g.mission.completeMission('geliefert');
  for (const id of G.BOT_IDS) {
    const e = G.lesen(g, id);
    ok(e.length === 1 && e[0].ereignis === 'mission' && e[0].gewicht === 2 && e[0].mission === mid && !/Kai/.test(e[0].text), id + ': Missionsende, Gewicht 2 (' + (e[0] && e[0].text) + ')');
  }

  const bot1 = bots(g).find((p) => p.botId === 'b1');
  const vor = G.lesen(g, 'b1').length;
  Interior.downPlayer(g, bot1, 'test'); bot1.downed = false;
  Interior.downPlayer(g, bot1, 'test'); bot1.downed = false;
  const l = G.lesen(g, 'b1');
  ok(l.length === vor + 1 && l[l.length - 1].ereignis === 'bewusstlos' && l[l.length - 1].gewicht === 1, 'bewusstlos: genau ein Eintrag, zweites Mal in derselben Mission entprellt');
  const vor0 = G.lesen(g, 'b0').length;
  Interior.downPlayer(g, g.players.find((p) => !p.bot), 'test');
  ok(G.lesen(g, 'b0').length === vor0 && G.lesen(g, 'b1').length === vor + 1, 'Mensch unten erzeugt keinen Bot-Eintrag');

  const a = G.lesen(g, 'b0').length;
  Interior.damageSystem(g, 'weapon_bow', 'broken', { quiet: true });
  Interior.damageSystem(g, 'shields', 'broken', { quiet: true });
  const b = G.lesen(g, 'b0');
  ok(b.length === a + 1 && b[b.length - 1].ereignis === 'schiffstreffer' && b[b.length - 1].gewicht === 1, 'Systemausfall: ein Eintrag, zweiter Ausfall direkt danach entprellt');

  G.gespraech(g, 'b2');
  const gz = G.lesen(g, 'b2').pop();
  ok(gz.ereignis === 'gespraech' && gz.text === 'Sprach mit dem Captain.', 'Haken gespraech: nur „Sprach mit dem Captain“');
  ok(g.errors === 0, 'keine Serverfehler');

  const g2 = new Game({ noStore: true, seed: 7, env: ENV(), log: () => {} });
  ok(!(g2.weltstand && g2.weltstand.persistent) && G.merken(g2, 'b0', { ereignis: 'x', text: 'y' }) === false && G.lesen(g2, 'b0').length === 0 && G.toSave(g2) === null, 'ohne Weltstand: merken tut nichts, lesen leer, toSave null');
  G.beiMissionEnde(g2, 'm1', 'T', 'erfolg'); G.beiSystemAusfall(g2, 'x'); G.gespraech(g2, 'b0');
  ok(g2.errors === 0, 'Ereignisquellen ohne Weltstand werfen nicht');
}

// ---------------------------------------------------------------------------------------------
section('(h) W1: Missionen belegen hoechstens 8 von 12 Plaetzen, neuer Eintrag wird nie sofort verdraengt');
{
  const g = partie().g;
  for (let i = 0; i < 20; i++) G.beiMissionEnde(g, 'mx' + i, 'Titel ' + i, 'erfolg');
  let l = G.lesen(g, 'b0');
  ok(l.length === 8 && l.every((x) => x.ereignis === 'mission'), '20 Missionen -> 8 Eintraege, alle Mission (' + l.length + ')');
  ok(l[0].mission === 'mx12' && l[7].mission === 'mx19', 'der aelteste Missionseintrag weicht zuerst: mx12 bis mx19 bleiben');
  const bot0 = bots(g).find((p) => p.botId === 'b0');
  Interior.downPlayer(g, bot0, 'test');
  ok(G.gespraech(g, 'b0') === true, 'gespraech meldet true');
  l = G.lesen(g, 'b0');
  ok(l.some((x) => x.ereignis === 'bewusstlos') && l.some((x) => x.ereignis === 'gespraech'), 'bewusstlos und Gespraech sind gespeichert');
  ok(l.filter((x) => x.ereignis === 'mission').length <= 8 && l.length === 10, 'Missionen <= 8, insgesamt 10 bis hierher (' + l.length + ')');
  for (let i = 0; i < 6; i++) G.merken(g, 'b0', { ereignis: 'e' + i, text: 'Ereignis ' + i, gewicht: 1 });
  l = G.lesen(g, 'b0');
  ok(l.length === 12 && l.filter((x) => x.ereignis === 'mission').length <= 8, 'voll: genau 12, Missionen <= 8');
  ok(l[l.length - 1].ereignis === 'e5', 'der neueste Eintrag steht und wurde nicht verdraengt');
  G.beiMissionEnde(g, 'mneu', 'Neu', 'erfolg');
  l = G.lesen(g, 'b0');
  ok(l.length === 12 && l[l.length - 1].mission === 'mneu' && l.filter((x) => x.ereignis === 'mission').length === 8, 'neue Mission bei vollem Speicher: bleibt, 12 insgesamt, 8 Missionen');
  // Eintrag mit kleinerem Gewicht als alle anderen: bleibt trotzdem
  const g2 = partie().g;
  for (let i = 0; i < 12; i++) G.merken(g2, 'b1', { ereignis: 'hoch' + i, text: 'h', gewicht: 5 });
  ok(G.merken(g2, 'b1', { ereignis: 'leicht', text: 'l', gewicht: 1 }) === true && G.lesen(g2, 'b1').pop().ereignis === 'leicht', 'leichter Eintrag unter lauter schweren: wird gespeichert, nicht sofort verdraengt');
}

// ---------------------------------------------------------------------------------------------
section('(i) Namensfilter: Wortgrenzen, Gross/Klein, Sonderzeichen, kurze Namen');
{
  let g = partie({ mensch: 'Kai' }).g;
  G.merken(g, 'b0', { ereignis: 't', text: 'Rettet KAI und kai, die Kaiserin nicht' });
  ok(G.lesen(g, 'b0')[0].text === 'Rettet jemand und jemand, die Kaiserin nicht', 'KAI und kai ersetzt, Kaiserin bleibt (' + G.lesen(g, 'b0')[0].text + ')');
  g = partie({ mensch: 'er' }).g;
  G.merken(g, 'b0', { ereignis: 't', text: 'Der Erfolg: er kam, erfolg bleibt' });
  ok(G.lesen(g, 'b0')[0].text === 'Der Erfolg: jemand kam, erfolg bleibt', 'Mensch "er": ganzes Wort ersetzt, erfolg/Erfolg bleiben (' + G.lesen(g, 'b0')[0].text + ')');
  g = partie({ mensch: 'x' }).g;
  G.merken(g, 'b0', { ereignis: 't', text: 'x marks the box' });
  ok(G.lesen(g, 'b0')[0].text === 'x marks the box', 'Name mit einem Buchstaben wird ignoriert');
  g = partie({ mensch: 'Al(x)+' }).g;
  G.merken(g, 'b0', { ereignis: 't', text: 'Alx und Al(x)+ gehen' });
  ok(G.lesen(g, 'b0')[0].text === 'Alx und jemand gehen', 'Regex-Sonderzeichen im Namen sind escaped (' + G.lesen(g, 'b0')[0].text + ')');
  g = partie({ mensch: 'Jürgen' }).g;
  G.merken(g, 'b0', { ereignis: 't', text: 'JÜRGEN und Jürgens Hund' });
  ok(G.lesen(g, 'b0')[0].text === 'jemand und Jürgens Hund', 'Umlaute: JÜRGEN ersetzt, Jürgens bleibt (' + G.lesen(g, 'b0')[0].text + ')');
}

// ---------------------------------------------------------------------------------------------
section('(j) Texte und Konfig: bewusstlos behauptet keine Rettung, Obergrenze nicht aus Config');
{
  const g = partie().g;
  Interior.downPlayer(g, bots(g).find((p) => p.botId === 'b2'), 'test');
  const t = G.lesen(g, 'b2').find((x) => x.ereignis === 'bewusstlos').text;
  ok(t === 'Ging im Einsatz zu Boden.' && !/gerettet|beine|wieder/i.test(t), 'Text bewusstlos: ' + t);
  g.C.weltstand.botMemoryMax = 40;
  for (let i = 0; i < 30; i++) G.merken(g, 'b2', { ereignis: 'e' + i, text: 'x', gewicht: 1 });
  ok(G.lesen(g, 'b2').length === 12 && Weltstand.validate(Weltstand.capture(g), g).length === 0, 'C.weltstand.botMemoryMax = 40 wird ignoriert: 12, Save gueltig');
  delete g.C.weltstand.botMemoryMax;
}

console.log('\n' + (n - fails) + '/' + n + ' ok');
if (fails) { console.log(fails + ' FEHLER'); process.exit(1); }
