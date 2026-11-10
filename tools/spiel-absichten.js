'use strict';
// SPL-02 E1 (Bot-Beleg): echter Server (wie tools/spiel-faden.js) mit FAEDEN=1, Lage-Spielleiter (Mock, kein Claude) und dem Betriebsmodus ABENTEUER_ABSICHTEN=1, drei WebSocket-Clients, der Bot spielt mit tools/lib/bot-beats.js.
// Ablauf: Vorgeschichte (ein NSC bittet, die Crew lehnt ab: das Gedaechtnis der Crew) > der Abenteuer-Spielleiter ruft den Mock (Absicht statt Beat-Plan; Nein der Welt gehen in die Verhandlung) bis ein Angebot aus einer
// Absicht steht > die Crew nimmt es an (abenteuer.annehmen) > das Abenteuer wird bis zum Abschluss gespielt. Ausgabe: ein Protokoll (Zeile je Ereignis) auf der Konsole und in --out.
// Kuenstlich (steht im Protokoll): der Name der Vorgeschichte (abenteuerOeffnen name), der Aufruf des Spielleiters per erzwingen() (ohne Cooldown, wie Debug), Ortswechsel und Testhelfer des Bots (wie spiel-faden).
// Aufruf: node tools/spiel-absichten.js [--out datei.txt] [--versuche n]        (npm run spiel:absichten)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'mock'; process.env.LAGE_SPIELLEITER = '1'; process.env.REISE_EREIGNISSE = '1'; process.env.FAEDEN = '1'; process.env.ABENTEUER_ABSICHTEN = '1'; process.env.ABENTEUER_ANSCHLUSS = '0';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Faden = require('../server/sim/faden.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Bot = require('./lib/bot-crew.js');
const Beats = require('./lib/bot-beats.js');

const CODE = 'SPLA';
const NAMEN = ['Ada', 'Bo', 'Cem'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const protokoll = [];
const zeile = (s) => { const t = new Date().toISOString().slice(11, 19); protokoll.push(`${t}  ${s}`); console.log(`${t}  ${s}`); };
const arg = (name, std) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : std; };
const outDatei = arg('--out', path.join(os.tmpdir(), 'spiel-absichten-protokoll.txt'));
const versucheMax = Number(arg('--versuche', '12'));
const J = (x) => JSON.stringify(x);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiel-absichten-'));
  const srv = await startServer({ port: 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game, port = srv.port;
  zeile(`Server auf Port ${port}, FAEDEN=1, ABENTEUER_ABSICHTEN=1, Spielleiter Mock (kein Claude)`);
  const cl = [];
  for (let i = 0; i < 3; i++) cl.push(await Bot.client(WebSocket, port, CODE, { clientId: 'ABC'[i], name: NAMEN[i], color: i }, NAMEN[i], NAMEN));
  await sleep(300);
  cl[0].send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of cl) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  const kz = {};
  const k = (...arten) => { for (const a of arten) kz[a] = (kz[a] || 0) + 1; };
  const w = Bot.werkzeug({ g, cl, zeile, k });
  const grenze = () => { k('grenze-gesetzt'); Kriegslage.tick(g, 'spiel'); g.lageGrenze('szene_ende'); if (g.lageSpielleiter && g.lageSpielleiter.aufrufe > 4) g.lageSpielleiter.aufrufe = 0; return true; };
  const B = Beats.neu({ g, cl, w, zeile, k, kz, opts: { testhelfer: true }, grenze, ereignis: () => {} });
  const F0 = () => g.weltsim.faeden;
  const SL = () => g.lageSpielleiter.abenteuer;
  const ergebnis = [];
  zeile(`Schalter im Spiel: ABENTEUER_ABSICHTEN=${g.env && g.env.ABENTEUER_ABSICHTEN}`);

  // Vorgeschichte: ein NSC bittet, die Crew lehnt ab (echter Weg: Bitte > Option ablehnen). Kuenstlich: der Name.
  zeile('--- Vorgeschichte: Quintus Varro bittet, die Crew lehnt ab ---');
  k('name-gesetzt');
  const planV = { format: 'faden-bauplan/1', titel: 'Eine Bitte am Hafen', anlass: 'Ein Haendler bittet die Crew um Geleit durch den Sektor.', beats: [{ typ: 'bitte', verzweigung: { gescheitert: 'e' } }, { typ: 'fracht' }, { id: 'e', typ: 'abschluss' }] };
  const aV = Faden.abenteuerAnbieten(g, planV, { hex: w.hierHex() });
  const rV = Faden.abenteuerOeffnen(g, aV.angebot.nr, { name: 'Quintus Varro', volk: 'rom' });
  const fV = rV.faden;
  let geantwortet = false;
  for (let i = 0; i < 400 && fV.phase !== 'abgeschlossen'; i++) {
    grenze(); await sleep(100);
    const off = Bitte.offen(g);
    if (off && !off.gemeldet) { off.gemeldet = true; zeile(`Bitte: ${off.text}`); cl[0].send({ t: 'cmd', c: 'faden.bitte', id: 'ablehnen', nr: off.nr }); geantwortet = true; zeile('Crew lehnt ab'); }
  }
  zeile(`Vorgeschichte Ende: Phase ${fV.phase}, NSC ${fV.nsc.name} ${fV.nsc.status}, Haltung ${fV.nsc.haltung}`);
  ergebnis.push(['Vorgeschichte abgeschlossen', fV.phase === 'abgeschlossen' && geantwortet]);

  // der Abenteuer-Spielleiter ruft den Mock im Modus Absichten, bis ein Angebot steht
  zeile('--- Abenteuer-Spielleiter (Mock, Modus Absichten) ---');
  const logN = () => g.lageRegie.log.entries.filter((e) => e.art === 'abenteuer_bauplan').length;
  const gesehen = new Set();
  let angebot = null, versuche = 0;
  while (!angebot && versuche < versucheMax) {
    versuche++;
    while (SL().zustand !== 'idle') { Kriegslage.tick(g, 'spiel'); await sleep(50); }
    k('erzwingen');   // Debug-Weg: kein Cooldown (der Deckel der Sitzung gilt dem echten Claude)
    const n0 = logN();
    const r = SL().erzwingen();
    if (!r.gestartet) { zeile(`Versuch ${versuche}: kein Aufruf (${r.grund})`); await sleep(200); continue; }
    for (let i = 0; i < 200 && (SL().zustand !== 'idle' || logN() === n0); i++) await sleep(50);
    for (const e of g.lageRegie.log.entries.filter((x) => x.art === 'abenteuer_bauplan')) {
      if (gesehen.has(e)) continue; gesehen.add(e);
      zeile(`Logbuch: ausgang ${e.ausgang}${e.grund ? ' (' + e.grund + ')' : ''}, modus ${e.modus}, absicht ${e.absicht}, bezug_art ${e.bezug_art}, verhandlung ${e.verhandlung}, tokens ${e.tokens}, quelle ${e.quelle}${e.plan && e.plan.vorlage ? ', Vorlage ' + e.plan.vorlage + ' ' + J(e.plan.typen) : ''}${e.fehler && e.fehler.length ? ', Fehler ' + J(e.fehler) : ''}`);
    }
    angebot = F0().abenteuerAngebote.slice().pop() || null;
  }
  ergebnis.push(['Angebot aus einer Absicht', !!angebot]);
  if (!angebot) { zeile('KEIN Angebot nach ' + versuche + ' Versuchen'); }
  else {
    zeile(`Angebot a${angebot.nr}: Vorlage ${angebot.ref}, Beats ${angebot.vorlage.beats.map((b) => b.typ).join(' > ')}, Ort ${angebot.hex}${angebot.bezug ? ', Bezug (Wiedersehen) ' + angebot.bezug.nsc : ''}${angebot.locker ? ', locker' : ''}`);
    const id = 'a' + angebot.nr;
    const n1 = cl[0].abAntw.length;
    cl[0].send({ t: 'cmd', c: 'abenteuer.annehmen', id });
    await w.wartenAuf(() => cl[0].abAntw.length > n1, 50);
    const f = F0().liste.find((x) => x.plan && x.vorlage === angebot.ref) || null;
    zeile(`Annehmen: ${J(cl[0].abAntw[n1])}; Abenteuer ${f ? f.id + ' NSC ' + f.nsc.name + ' (' + f.nsc.fraktion + ')' : 'KEINS'}`);
    ergebnis.push(['angenommen', !!f]);
    if (f) {
      const bis = Date.now() + 360000;
      while (f.phase !== 'abgeschlossen' && Date.now() < bis) {
        if (f.phase === 'laeuft') { const x = await B.spieleBeat(f); zeile(`Beat ${x.typ}: ${x.wie}, Ausgang ${x.ausgang}${x.notiz ? ' (' + x.notiz + ')' : ''}${Object.keys(x.kuenstlich).length ? ' [kuenstlich: ' + Object.keys(x.kuenstlich).join(', ') + ']' : ''}`); continue; }
        await B.leerlauf(150);
        if (f.zaehler >= f.abstand && f.phase === 'wartet') { B.nachhilfe(f); k('nachhilfe'); await sleep(300); }
      }
      await sleep(500);
      zeile(`Ende ${f.id}: Phase ${f.phase}, Ausgang ${f.ausgang && f.ausgang.art}, NSC ${f.nsc.status}, Haltung ${f.nsc.haltung}, Gedaechtnis ${f.nsc.gedaechtnis.map((x) => x.ereignis).join(',')}`);
      ergebnis.push(['Abenteuer zu Ende gespielt', f.phase === 'abgeschlossen']);
    }
  }
  zeile('Ergebnisse: ' + ergebnis.map(([n, ok]) => n + ' ' + (ok ? 'ok' : 'FEHLT')).join('; ') + '; Serverfehler ' + g.errors);
  zeile('Kuenstlich gesetzt (Bot): ' + J(kz));
  fs.writeFileSync(outDatei, protokoll.join('\n') + '\n');
  for (const x of cl) x.ws.close();
  process.exit(ergebnis.every(([, ok]) => ok) && g.errors === 0 ? 0 : 1);
})().catch((e) => { console.log('FEHLER: ' + (e && e.stack)); try { fs.writeFileSync(outDatei, protokoll.join('\n') + '\nFEHLER ' + (e && e.stack) + '\n'); } catch (e2) { /* egal */ } process.exit(1); });
