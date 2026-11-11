'use strict';
// BEA-01 D (Pruefung): der Bot spielt die Wege der Forderung am ECHTEN Server (wie tools/spiel-faden.js: drei WebSocket-Clients, FAEDEN=1, Mock-Spielleiter, Debug-Weg) und schreibt je Weg einen lesbaren Mitschnitt mit Belegzeilen.
// Die Wahl der Crew kommt ueber den Bot-Schalter --wahl (tools/lib/bot-beats.js, opts.wahl: Rangfolge der Option-Ids; datengetrieben, kein Beat- oder Absichtsname im Servercode). Marken und Schmuggelware stellt der Bot per Debug-Befehl bereit
// (marken <n>, fracht an <art> illegal getarnt=<art>), der Faden wird ueber den Befehl faden_oeffnen nach einem bewaeltigten Notruf geoeffnet (kuenstlich, im Mitschnitt ausgewiesen). Szenen-Beats spielt der Testhelfer (Gegner zerstoeren).
//
//   node tools/spiel-forderung.js [--weg <name>[,<name>...]|alle] [--seed <n>] [--out <ordner>] [--mitschnitt-dir <ordner>] [--parallel <n>] [--wahl <id,id>]   (npm run spiel:forderung)
//   --out         Ablage der Mitschnitte (Standard <Temp>/bea01-mitschnitt): <weg>.txt (lesbarer Verlauf mit Belegzeilen), <weg>.json (Belege), uebersicht.md (Pfad > erwartete Folge > beobachtete Folge > Beleg), <weg>-mitschnitt/ (MIT-01)
//   --wahl        ueberschreibt die Rangfolge des Wegs (Probe; ohne Schalter gilt die des Wegs)
//   Exit 0: alle gewaehlten Wege haben die erwartete Folge; Exit 1: mindestens eine Abweichung; Exit 2: falscher Aufruf.
//   --intern <weg>   (Kindprozess: ein Weg, ein Server)
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
process.chdir(path.join(__dirname, '..'));
const args = process.argv.slice(2);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined && !String(args[i + 1]).startsWith('--') ? args[i + 1] : undefined; };
const lies = (...p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

// ---------------------------------------------------------------------------------------------- die Wege (Daten)
// wahl: Rangfolge der Option-Ids des Bots; vorlage, start (Ort der Lerche), ort (Ort des Notrufs = Ziel der Ware); fracht: Schmuggelware, die der Bot per Debug-Weg einlagert (im Vorlauf: vor dem Faden oder nach dem Laden)
// erwartet: Aussagen, die der Lauf belegen muss (Werte aus den Dateien content/faeden/*.json gelesen, nie aus dem Produktivcode abgeleitet)
const WEGE = {
  ausliefern:       { titel: 'Ausliefern (Piraten bekommen die Ware)', vorlage: 'falscher_haendler', ort: '0203', start: '0305', wahl: ['annehmen', 'ausliefern'], seed: 605,
                      kurz: 'Haendler bittet, Crew laedt, Piraten fordern, AUSLIEFERN: Ware weg, Faden gescheitert, keine Enthuellung, keine Invasion' },
  verweigern:       { titel: 'Verweigern, Kampf gewonnen, Beispiel 1 komplett (Haendler)', vorlage: 'falscher_haendler', ort: '0203', start: '0305', wahl: ['annehmen', 'nicht_ausliefern', 'verweigern'], seed: 605,
                      kurz: 'Haendler bittet, Crew laedt, Piraten fordern, nicht ausliefern, VERWEIGERN (Kampf gegen die Piraten, gewonnen), Ablieferung beim Haendler, Enthuellung, Invasion' },
  bestechen:        { titel: 'Bestechen (Marken weg, kein Kampf), Ablieferung, Enthuellung, Invasion', vorlage: 'falscher_haendler', ort: '0203', start: '0305', wahl: ['annehmen', 'nicht_ausliefern', 'bestechen'], seed: 605,
                      kurz: 'Haendler bittet, Crew laedt, Piraten fordern, nicht ausliefern, BESTECHEN (Marken abgebucht, kein Kampf), Ablieferung beim Haendler, Enthuellung, Invasion' },
  verweigern_kern_lehnt_ab: { titel: 'Beispiel 1 mit schwacher Welt: der Kern lehnt die Invasion ab (Enthuellung ohne Invasion)', vorlage: 'falscher_haendler', ort: '0203', start: '0305', wahl: ['annehmen', 'nicht_ausliefern', 'verweigern'], seed: 601, invasion: false,
                      kurz: 'wie verweigern, aber Seed 601: Ablieferung, Enthuellung, der Kern lehnt den Befehl invasion ab (Germanen zu schwach), keine Invasion, Faden endet trotzdem gelungen' },
  durchsuchung_voll:  { titel: 'Durchsuchung mit Schmuggelware, Tiefe voll (offene und getarnte Ware gefunden)', vorlage: 'zollkontrolle', ort: '0305', start: '0305', wahl: ['dulden'], seed: 611, tiefe: 'voll',
                      fracht: [{ art: 'sprengstoff', eig: ['illegal'] }, { art: 'waffen', eig: ['illegal', 'getarnt=fracht'] }, { art: 'hilfsgueter', eig: [] }],
                      kurz: 'Zollschiff fordert, Crew DULDET, Tiefe voll: Sprengstoff (offen) und Waffen (getarnt als Fracht) beschlagnahmt, Hilfsgueter bleiben, Bussgeld, Ruf-Folge' },
  durchsuchung_scan:  { titel: 'Durchsuchung mit Schmuggelware, Tiefe scan (getarnte Ware bleibt unentdeckt)', vorlage: 'zollkontrolle_scan', ort: '0305', start: '0305', wahl: ['dulden'], seed: 612, tiefe: 'scan',
                      fracht: [{ art: 'sprengstoff', eig: ['illegal'] }, { art: 'waffen', eig: ['illegal', 'getarnt=fracht'] }, { art: 'hilfsgueter', eig: [] }],
                      kurz: 'Zollschiff fordert, Crew DULDET, Tiefe scan: nur der offene Sprengstoff beschlagnahmt, die getarnten Waffen bleiben an Bord, Bussgeld und Ruf-Folge fuer einen Platz' },
  durchsuchung_sauber: { titel: 'Durchsuchung ohne Schmuggelware (sauberer Frachtraum)', vorlage: 'zollkontrolle', ort: '0305', start: '0305', wahl: ['dulden'], seed: 613, tiefe: 'voll',
                      fracht: [{ art: 'hilfsgueter', eig: [] }],
                      kurz: 'Zollschiff fordert, Crew DULDET, nichts Illegales an Bord: nichts gefunden, kein Bussgeld, kein Ruf-Abzug, Ware bleibt' },
  zoll_bestechen:   { titel: 'Zollkontrolle: nicht dulden, bestechen (Marken weg, Ware bleibt)', vorlage: 'zollkontrolle', ort: '0305', start: '0305', wahl: ['nicht_dulden', 'bestechen'], seed: 614, tiefe: 'voll',
                      fracht: [{ art: 'sprengstoff', eig: ['illegal'] }, { art: 'waffen', eig: ['illegal', 'getarnt=fracht'] }],
                      kurz: 'Zollschiff fordert, Crew duldet NICHT und BESTICHT: Marken abgebucht, keine Durchsuchung, Schmuggelware bleibt an Bord, kein Kampf' },
};
const REIHE = Object.keys(WEGE);

// ---------------------------------------------------------------------------------------------- Aufruf (Hauptprozess)
if (!args.includes('--intern')) {
  const fehler = (m) => { console.error(m); process.exit(2); };
  const w = wert('weg');
  const namen = !w || w === 'alle' ? REIHE : w.split(',').map((x) => x.trim());
  for (const n of namen) if (!WEGE[n]) fehler(`Unbekannter Weg "${n}". Bekannt: ${REIHE.join(', ')}`);
  const out = path.resolve(wert('out') || path.join(os.tmpdir(), 'bea01-mitschnitt'));
  const par = Math.max(1, Math.min(8, Number(wert('parallel') || 1)));
  fs.mkdirSync(out, { recursive: true });
  const mit = wert('mitschnitt-dir') ? path.resolve(wert('mitschnitt-dir')) : null;
  const laufe = (n) => new Promise((resolve) => {
    const a = [__filename, '--intern', n, '--out', out];
    if (mit) a.push('--mitschnitt-dir', mit);
    if (wert('wahl')) a.push('--wahl', wert('wahl'));
    if (wert('seed')) a.push('--seed', wert('seed'));
    const p = cp.spawn(process.execPath, a, { cwd: path.join(__dirname, '..'), env: process.env });
    let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; });
    const t = setTimeout(() => { try { p.kill(); } catch (e) { /* egal */ } }, 600000);
    p.on('exit', (code) => { clearTimeout(t); resolve({ n, code, o }); });
  });
  (async () => {
    const erg = []; const warteschlange = namen.slice();
    await Promise.all(Array.from({ length: Math.min(par, namen.length) }, async () => { while (warteschlange.length) { const n = warteschlange.shift(); const r = await laufe(n); erg.push(r); console.log(`${r.code === 0 ? 'ok    ' : 'FEHLER'} ${n} (Exit ${r.code})`); if (r.code !== 0) console.log(r.o.split('\n').filter((l) => /FEHLER|Fehler|ABWEICHUNG/.test(l)).slice(0, 8).join('\n')); } }));
    // Uebersicht
    const L = ['# BEA-01 D: Uebersicht der Bot-Wege', '', `Erzeugt von tools/spiel-forderung.js (echter Server, drei Clients, Mock-Spielleiter, Bot-Wahl --wahl). Ordner: ${out}`, '',
      '| Pfad | Wahl des Bots | Erwartete Folge | Beobachtete Folge | Urteil | Belegdatei |', '|---|---|---|---|---|---|'];
    for (const n of namen) {
      const f = path.join(out, n + '.json');
      if (!fs.existsSync(f)) { L.push(`| ${WEGE[n].titel} | ${WEGE[n].wahl.join(', ')} | ${WEGE[n].kurz} | (kein Ergebnis) | FEHLER | ${n}.txt |`); continue; }
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      L.push(`| ${j.titel} | ${j.wahl.join(', ')} | ${j.erwartet_text} | ${j.beobachtet_text} | ${j.ok ? 'ok' : 'ABWEICHUNG: ' + j.abweichungen.join('; ')} | ${n}.txt |`);
    }
    fs.writeFileSync(path.join(out, 'uebersicht.md'), L.join('\n') + '\n', 'utf8');
    console.log('Uebersicht: ' + path.join(out, 'uebersicht.md'));
    process.exit(erg.every((r) => r.code === 0) ? 0 : 1);
  })();
  return;
}

// ---------------------------------------------------------------------------------------------- ein Weg (Kindprozess)
const WEG = args[args.indexOf('--intern') + 1];
const W = WEGE[WEG];
if (!W) { console.error('Unbekannter Weg ' + WEG); process.exit(2); }
const OUT = path.resolve(wert('out'));
if (wert('seed')) W.seed = Number(wert('seed'));
const DATEI = WEG + (wert('seed') ? '-seed' + W.seed : '');
const WAHL = wert('wahl') ? wert('wahl').split(',').map((x) => x.trim()).filter(Boolean) : W.wahl;
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'mock'; process.env.LAGE_SPIELLEITER = '1'; process.env.REISE_EREIGNISSE = '1'; process.env.FAEDEN = '1';
const MitLauf = require('./lib/mitschnitt-lauf.js');
MitLauf.einschalten(['--mitschnitt', '--mitschnitt-dir', wert('mitschnitt-dir') ? path.join(path.resolve(wert('mitschnitt-dir')), WEG + (wert('seed') ? '-seed' + wert('seed') : '')) : path.join(OUT, '_mitschnitt-' + WEG)]);
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Faden = require('../server/sim/faden.js');
const FD = require('../server/sim/faden-daten.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const Ruf = require('../server/sim/ruf.js');
const Bot = require('./lib/bot-crew.js');
const Beats = require('./lib/bot-beats.js');

const FW = lies('content/faeden/forderung-werte.json').werte;
const FT = lies('content/faeden/forderung-texte.json');
const CODE = 'FORD';
const NAMEN = ['Ada', 'Bo', 'Cem'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
const zeile = (s) => { const t = new Date().toISOString().slice(11, 19); zeilen.push(`${t}  ${s}`); };
const sektorName = (h) => Sektoren.hexName(h) || h;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiel-forderung-'));
  const srv = await startServer({ port: 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game, port = srv.port;
  g.fixedSeed = W.seed; g.reset();
  MitLauf.anmelden(g, { werkzeug: 'spiel-forderung', modus: 'faeden', seed: g.seed, crew: NAMEN.length, quelle: 'bot',
    regel: `Bitte und Forderung: die erste Option aus --wahl (${WAHL.join(', ')}), die das Angebot kennt, sonst annehmen, sonst die erste; Szenen: Gegner per Testhelfer; Schmuggelware und Marken per Debug-Befehl; der Faden wird nach einem bewaeltigten Notruf per Befehl geoeffnet` });
  const kz = {};
  const k = (...arten) => { for (const a of arten) kz[a] = (kz[a] || 0) + 1; MitLauf.kuenstlich(g, ...arten); };
  // Beobachtung (nur Mitschnitt dieses Prozesses): Funk, Ereignisse der Mission, ODA-Zeilen
  const funk = [], oda = [], mev = [];
  const emit0 = g.emit.bind(g); g.emit = (...a) => { if (a[0] === 'radio' && a[1]) { funk.push({ von: a[1].from, text: a[1].text }); zeile(`FUNK     ${String(a[1].from || '?').padEnd(16)} ${a[1].text}`); } return emit0(...a); };
  const oda0 = g.oda.bind(g); g.oda = (t, kk) => { oda.push(t); zeile(`BORD     ${t}`); return oda0(t, kk); };
  const me0 = g.missionEvent.bind(g); g.missionEvent = (kk, d) => { if (['frachtDurchsucht', 'frachtBeschlagnahmt', 'frachtAbgeliefert', 'frachtAnBord'].includes(kk)) { mev.push({ k: kk, d }); zeile(`EREIGNIS ${kk} ${JSON.stringify(d)}`); } return me0(kk, d); };
  if (typeof g.notice === 'function') { const n0 = g.notice.bind(g); g.notice = (pp, t, ...r) => { zeile(`HINWEIS  ${t}`); return n0(pp, t, ...r); }; }
  zeile(`Server auf Port ${port}, Seed ${g.seed}, Weg ${WEG}: ${W.titel}`);
  const cl = [];
  for (let i = 0; i < 3; i++) cl.push(await Bot.client(WebSocket, port, CODE, { clientId: 'ABC'[i], name: NAMEN[i], color: i }, NAMEN[i], NAMEN));
  await sleep(300);
  cl[0].send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of cl) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  const w = Bot.werkzeug({ g, cl, zeile: (s) => zeile(`BOT      ${s}`), k });
  const debug = async (cmd, args2) => { k('debug-befehl'); cl[0].send({ t: 'debug', cmd, args: args2 }); await sleep(150); };

  // Vorbereitung: Marken, Ort, Schmuggelware (Debug-Weg; der Bot hat keinen Handel)
  const MARKEN0 = 500;
  await debug('marken', String(MARKEN0));
  w.flieg(W.start);
  await sleep(300);
  zeile(`CREW     in ${sektorName(w.hierHex())} (${w.hierHex()}), Marken ${g.inventory.marks}`);
  const lagerStr = () => g.fracht.lager.map((l) => l.art + (l.eig && l.eig.getarnt ? `(getarnt als ${l.eig.getarnt}${l.eig.aufgedeckt ? ', aufgedeckt' : ''})` : '') + (l.eig && l.eig.illegal ? '[illegal]' : '') + (l.eig && l.eig.auftrag ? '[Auftrag]' : '')).join(', ') || '(leer)';
  const frachtraeume = async () => { await debug('ausbau', '3'); for (const r of [4, 3, 2, 1]) await debug('modul', `bau frachtraum ${r}`); zeile(`CREW     Frachtraeume gebaut (Debug: ausbau 3, modul bau frachtraum 4 bis 1): Kapazitaet ${require('../server/sim/fracht.js').capacity(g)}`); };
  const einlagern = async () => { await frachtraeume(); await debug('ruf', 'rom 20'); zeile(`CREW     Ruf Rom ${Ruf.ruf(g, 'rom')} (Debug: ruf rom 20, damit eine Strafe nicht am Boden der Skala verpufft)`); for (const x of W.fracht || []) await debug('fracht', ['an', x.art, ...x.eig].join(' ')); zeile(`CREW     Frachtraum: ${lagerStr()}`); };
  const FOLGE = require('../server/sim/faden-daten.js');
  void FOLGE;

  // Faden oeffnen: Notruf bewaeltigt (Hook), faden_oeffnen (Befehl der Fadenmaschine)
  const ausloeser = { falscher_haendler: 'notruf_havarie_konvoi', zollkontrolle: 'notruf_zollkontrolle', zollkontrolle_scan: 'notruf_zollkontrolle' }[W.vorlage];
  let vorlageId = W.vorlage;
  if (W.vorlage === 'zollkontrolle_scan') {   // die Zoll-Vorlage der Daten mit tiefe scan, nur fuer diesen Prozess registriert (der Parameter ist in der Vorlage Daten, kein Code)
    const v = JSON.parse(JSON.stringify(FD.vorlage('zollkontrolle'))); v.id = 'zollkontrolle_scan'; v.beats[0].parameter.tiefe = 'scan';
    const r = FD.registriere(v); if (!r.ok) throw new Error('Vorlage zollkontrolle_scan ungueltig: ' + r.fehler.join('; '));
    vorlageId = 'zollkontrolle_scan';
  }
  if (!W.fracht || W.vorlage === 'falscher_haendler') { /* der Haendler-Weg hat die Ware des Fadens, Schmuggelware nur bei den Zoll-Wegen */ } else await einlagern();
  const vor = { marken: g.inventory.marks, ruf_rom: Ruf.ruf(g, 'rom'), lager: g.fracht.lager.length, lagerText: lagerStr() };
  k('faden-oeffnen-befehl');
  const a = Faden.ausgangMitPerson(g, { art: 'notruf', id: ausloeser, hex: W.ort, sprecher: '', ausgang: 'gelungen' });
  if (!a) throw new Error('Notruf ' + ausloeser + ' bietet keinen Faden an');
  const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: vorlageId, parameter: { angebot: a.nr } });
  if (!r.ok) throw new Error('Faden nicht geoeffnet: ' + r.grund);
  const f = r.faden;
  zeile(`CREW     Notruf bewaeltigt (${ausloeser}) bei ${sektorName(W.ort)}: der Spielleiter oeffnet den Faden ${f.id} (${vorlageId}), Haendler/NSC ${f.nsc.name} (${f.nsc.schiff})`);

  const wahlen = [];
  const bitteAlt = [];
  const B = Beats.neu({ g, cl, w, zeile: (s) => zeile(`BOT      ${s}`), k, kz, opts: { testhelfer: true, wahl: WAHL }, grenze: () => { Kriegslage.tick(g, 'spiel'); g.lageGrenze('szene_ende'); return true; }, ereignis: (art, d) => { if (art === 'bitte') wahlen.push(Object.assign({ marken_vorher: g.inventory.marks }, d)); } });
  const beatsGespielt = [];
  const beobachtet = new Set();
  const logbuch = () => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
  const sync = () => { for (const e of logbuch()) if (!beobachtet.has(e)) { beobachtet.add(e); if (e.art === 'faden_ereignis' && (e.ausgang === 'beat_start' || e.ausgang === 'beat_ende')) zeile(`BEAT     ${e.ausgang === 'beat_start' ? 'beginnt' : 'endet  '} ${e.plan && e.plan.beat} ${e.begruendung ? '(' + String(e.begruendung).slice(0, 100) + ')' : ''}`); else if (e.art === 'lage_befehl' && e.key === 'invasion') zeile(`BEFEHL   ${e.key || ''} ${e.ausgang}: ${String(e.begruendung || '').slice(0, 120)}${e.fehler && e.fehler.length ? ' [' + e.fehler.join('; ').slice(0, 140) + ']' : ''}`);
      else if (e.art === 'faden_baustein') zeile(`KERN     ${e.ausgang}: ${String(e.begruendung || '').slice(0, 140)}`); } };
  const marksAt = {}; let invSeen = null;
  const hochNow = () => g.weltsim.zustand.flotten.filter((fl) => fl.hochgestuft === true);
  const t0 = Date.now(); let faellig = null; let spielt = false;
  let zwischen = null;   // Zustand nach dem Laden (Zoll-Weg nicht noetig)
  while (f.phase !== 'abgeschlossen' && Date.now() - t0 < 420000) {
    Kriegslage.tick(g, 'spiel'); g.lageGrenze('szene_ende'); sync();
    if (f.fracht && !zwischen) { zwischen = { marken: g.inventory.marks, lager: g.fracht.lager.length, lagerText: lagerStr() }; zeile(`BELEG    Ware am Faden und im Frachtraum nach dem Laden: ${zwischen.lagerText} (${zwischen.lager} Plaetze, Marken ${zwischen.marken})`); }
    if (!invSeen && hochNow().length && logbuch().some((e) => e.art === 'faden_baustein' && e.ausgang === 'sim_befehl')) { invSeen = { flotten: hochNow().length, fraktionen: hochNow().map((fl) => fl.fraktion), angriffe: g.weltsim.zustand.angriffe.filter((x) => x.befohlen === true).length }; zeile(`BELEG    Invasion wirkt in der Sim: ${invSeen.flotten} Flotte(n) hochgestuft (${invSeen.fraktionen.join(',')}), ${invSeen.angriffe} befohlene(r) Feldzug`); }
    if (f.phase === 'laeuft' && !spielt) {
      spielt = true;
      const id = f.laufend.beat;
      zeile(`BEAT     ${id} laeuft (${B.typVon(f)})`);
      marksAt[id] = g.inventory.marks;
      const m0 = g.inventory.marks, l0 = g.fracht.lager.length;
      const res = await B.spieleBeat(f);
      beatsGespielt.push(Object.assign({ id, marken_vorher: m0, marken_nachher: g.inventory.marks, lager_vorher: l0, lager_nachher: g.fracht.lager.length }, res));
      zeile(`BOT      Beat ${res.typ} (${id}): ${res.wie}, Ausgang ${res.ausgang}${res.notiz ? ' (' + res.notiz + ')' : ''}`);
      spielt = false; faellig = null;
      continue;
    }
    if (f.phase === 'wartet' && f.zaehler >= f.abstand) {
      if (faellig === null) faellig = Date.now();
      if (Date.now() - faellig > 500) { const rr = B.nachhilfe(f); zeile(`BOT      der Spielleiter startet den faelligen Beat nicht: der Bot startet ihn selbst (faden_weiter, kuenstlich): ${rr && rr.ok ? 'ok' : 'abgelehnt ' + (rr && rr.grund)}`); faellig = null; }
    }
    await sleep(60);
  }
  // Nachlauf: Invasion wirkt in der Sim (Standard-KI der Welt weiter aktiv)
  for (let i = 0; i < 12; i++) { Kriegslage.tick(g, 'spiel'); sync(); await sleep(50); }
  await sleep(300);
  const z = g.weltsim.zustand;
  const hoch = z.flotten.filter((fl) => fl.hochgestuft === true), befohlen = z.angriffe.filter((x) => x.befohlen === true);
  const kern = logbuch().filter((e) => e.art === 'faden_baustein' && e.plan && e.plan.beat === 'b_enthuell');
  const enthuellt = funk.some((x) => /^Ich bin Germane/.test(String(x.text)));
  const invasion = !!kern.find((e) => e.ausgang === 'sim_befehl') && !!invSeen;
  const enthuell_beat = logbuch().some((e) => e.art === 'faden_ereignis' && e.plan && e.plan.beat === 'b_enthuell');
  const ger = !!invSeen && invSeen.fraktionen.every((x) => x === 'ger');
  const nachher = { marken: g.inventory.marks, ruf_rom: Ruf.ruf(g, 'rom'), lager: g.fracht.lager.length, lagerText: lagerStr() };
  const ged = f.nsc.gedaechtnis.map((x) => x.ereignis);
  const beatsIds = logbuch().filter((e) => e.art === 'faden_ereignis' && e.key === f.id && e.ausgang === 'beat_start').map((e) => e.plan && e.plan.beat).filter(Boolean);
  zeile('');
  const belege = {
    ware_vor: vor.lagerText, ware_nach: nachher.lagerText, marken: `${vor.marken} -> ${nachher.marken}`, ruf_rom: `${vor.ruf_rom} -> ${nachher.ruf_rom}`,
    faden: `${f.phase}${f.ausgang ? ', Ausgang ' + f.ausgang.art : ''}, NSC ${f.nsc.status}`, gedaechtnis: ged.join(', '),
    invasion: invasion ? `ja (${invSeen.flotten} germanische Flotte(n) hochgestuft, ${invSeen.angriffe} befohlene Feldzuege)` : 'nein',
  };
  for (const [kk, v] of Object.entries(belege)) zeile(`BELEG    ${kk.padEnd(12)} ${v}`);
  zeile(`BELEG    Beats        ${beatsIds.join(' > ')}`);
  zeile(`BELEG    kuenstlich   ${JSON.stringify(kz)}`);
  zeile(`BELEG    Wahlen       ${wahlen.map((x) => `${x.beat}: ${x.gewaehlt} (Marken vorher ${x.marken_vorher})`).join('; ')}`);

  // ---------------- Erwartung je Weg: eigene Zaehlung aus den Datendateien
  const PREIS = FW.bestechung_marken.wert[(lies('content/faeden/vorlagen/' + (W.vorlage === 'zollkontrolle_scan' ? 'zollkontrolle' : W.vorlage) + '.json').beats.find((b) => b.typ === 'schmiergeld') || { parameter: {} }).parameter.staerke || FW.staerke_standard.wert] || FW.bestechung_marken.wert[FW.staerke_standard.wert];
  const BUSSE = FW.bestechung_marken.wert && FW.bussgeld_marken.wert[(lies('content/faeden/vorlagen/zollkontrolle.json').beats[0].parameter.staerke)];
  const RUFD = lies('content', 'welt', 'ruf-werte.json').werte.quellen.wert[FW.fund_ruf.wert.rom].delta;
  const gate = []; const abw = [];
  const pruef = (c, t) => { gate.push({ ok: !!c, t }); if (!c) abw.push(t); zeile(`${c ? 'ok     ' : 'FEHLER '} ${t}`); };
  const folge = (ids) => ids.every((x, i) => beatsIds.includes(x) && (i === 0 || beatsIds.indexOf(x) > beatsIds.indexOf(ids[i - 1])));   // die Beats kamen in dieser Reihenfolge (weitere dazwischen erlaubt)
  const hatEchte = (txt) => /waffen/i.test(txt);
  let erwartet = '';
  const invasionErw = W.invasion !== false;
  if (WEG === 'ausliefern') {
    erwartet = 'Ware aus dem Frachtraum (nach dem Laden +1, am Ende +0), Faden abgeschlossen gescheitert, keine Enthuellung, keine Invasion, Marken unveraendert';
    pruef(zwischen && zwischen.lager === vor.lager + 1, `die Ware war geladen (Frachtraum ${vor.lager} -> ${zwischen && zwischen.lager})`);
    pruef(nachher.lager === vor.lager, `Ware aus dem Frachtraum (${nachher.lager} Plaetze, vorher ${vor.lager})`);
    pruef(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', `Faden gescheitert (${belege.faden})`);
    pruef(ged.includes('forderung_gescheitert') && ged.includes('fracht_geladen'), `Gedaechtnis: geladen, Forderung gescheitert (${ged.join(', ')})`);
    pruef(!enthuell_beat && !enthuellt && !invasion && !invSeen && hoch.length === 0 && befohlen.length === 0, 'keine Enthuellung, keine Invasion (keine hochgestufte Flotte, kein befohlener Feldzug)');
    pruef(!beatsIds.includes('b_schmier') && !beatsIds.includes('b_kampf') && !beatsIds.includes('b_abgabe'), `kein Schmiergeld, kein Kampf, keine Abgabe (${beatsIds.join(' > ')})`);
    pruef(nachher.marken === vor.marken, 'Ausliefern kostet keine Marken');
  } else if (WEG === 'verweigern' || WEG === 'verweigern_kern_lehnt_ab') {
    erwartet = 'Forderung abgelehnt, Verweigern kostet nichts, Beat Raumschlacht (Kampf gewonnen), Ware bleibt bis zur Ablieferung, Ablieferung beim Haendler, Enthuellung, ' + (invasionErw ? 'Invasion' : 'der Kern lehnt die Invasion ab (zu schwach), keine Invasion');
    pruef(folge(['b_forderung', 'b_schmier', 'b_kampf', 'b_abgabe']), `Beats in der Reihenfolge Forderung, Schmiergeld, Kampf, Abgabe (${beatsIds.join(' > ')})`);
    const kampf = beatsGespielt.find((x) => x.id === 'b_kampf');
    pruef(!!kampf && kampf.typ === 'raumschlacht', 'Verweigern fuehrt in den Beat raumschlacht');
    pruef(!!kampf && kampf.lager_vorher === vor.lager + 1, 'vor dem Kampf liegt die Ware noch im Frachtraum');
    pruef(wahlen.some((x) => x.gewaehlt === 'verweigern' && x.marken_vorher === vor.marken), 'Verweigern kostet keine Marken');
    pruef(marksAt.b_kampf === marksAt.b_schmier && marksAt.b_schmier === vor.marken, `Marken von der Forderung bis zum Kampf unveraendert (${vor.marken} -> Schmiergeld ${marksAt.b_schmier} -> Kampf ${marksAt.b_kampf}); am Ende ${nachher.marken} (Belohnungen aus Kampf und Abschluss)`);
    pruef(nachher.lager === vor.lager && ged.includes('fracht_gelungen'), `die Ware ist beim Haendler abgeliefert (Frachtraum ${nachher.lager}, Gedaechtnis ${ged.join(', ')})`);
    pruef(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', `Faden gelungen (${belege.faden})`);
    pruef(enthuell_beat && enthuellt, 'Enthuellung: der Haendler gibt sich als Germane zu erkennen');
    if (invasionErw) pruef(invasion && ger, `Invasion: Befehl angenommen, ${invSeen ? invSeen.flotten : 0} germanische Flotte(n) hochgestuft (Kern: ${kern.map((e) => e.ausgang).join(',')})`);
    else pruef(!invasion && hoch.length === 0 && befohlen.length === 0 && kern.some((e) => e.ausgang === 'sim_befehl_abgelehnt'), `keine Invasion: der Kern lehnt den Befehl ab (${kern.map((e) => e.ausgang + ' ' + String(e.begruendung).slice(0, 80)).join('; ')}), keine hochgestufte Flotte`);
  } else if (WEG === 'bestechen') {
    erwartet = `Bestechen kostet ${PREIS} Marken (staerke mittel, aus forderung-werte.json), kein Kampf, Ablieferung, Enthuellung, Invasion`;
    pruef(!beatsIds.includes('b_kampf') && folge(['b_forderung', 'b_schmier', 'b_abgabe']), `kein Beat b_kampf, die Piraten werden nicht bekaempft (${beatsIds.join(' > ')})`);
    const bw = wahlen.find((x) => x.gewaehlt === 'bestechen');
    pruef(!!bw && bw.marken_vorher === vor.marken, `Marken vor dem Bestechen ${vor.marken}`);
    pruef(marksAt.b_abgabe === vor.marken - PREIS, `Marken abgebucht: ${vor.marken} vor der Forderung -> ${marksAt.b_abgabe} bei der Ablieferung (Preis ${PREIS}); am Ende ${nachher.marken} (Belohnung des Abschlusses)`);
    pruef(nachher.lager === vor.lager && ged.includes('fracht_gelungen'), `Ware beim Haendler abgeliefert (Frachtraum ${nachher.lager})`);
    pruef(ged.includes('schmiergeld_gelungen') && f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', `Faden gelungen, Schmiergeld gelungen (${ged.join(', ')})`);
    pruef(enthuell_beat && enthuellt, 'Enthuellung: der Haendler gibt sich als Germane zu erkennen');
    pruef(invasion && ger, `Invasion: Befehl angenommen, ${invSeen ? invSeen.flotten : 0} germanische Flotte(n) hochgestuft`);
  } else if (WEG === 'zoll_bestechen') {
    const PG = FW.bestechung_marken.wert.mittel;
    erwartet = `Bestechen kostet ${PG} Marken, die Durchsuchung entfaellt, Schmuggelware bleibt, kein Kampf, Ruf unveraendert`;
    pruef(!mev.some((e) => e.k === 'frachtDurchsucht') && !mev.some((e) => e.k === 'frachtBeschlagnahmt' && e.d.n > 0), 'keine Durchsuchung, keine Beschlagnahme');
    pruef(nachher.marken === vor.marken - PG, `Marken abgebucht: ${vor.marken} -> ${nachher.marken} (Preis ${PG})`);
    pruef(nachher.lager === vor.lager, `Schmuggelware bleibt an Bord (${nachher.lagerText})`);
    pruef(nachher.ruf_rom === vor.ruf_rom, `Ruf unveraendert (${belege.ruf_rom})`);
    pruef(!beatsIds.includes('b_kampf') && f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', `Abschluss gelungen ohne Kampf (${beatsIds.join(' > ')}; ${belege.faden})`);
  } else {   // durchsuchung_*
    const voll = W.tiefe === 'voll';
    const anzahlSchmuggel = (W.fracht || []).filter((x) => x.eig.includes('illegal')).length;
    const erwartetN = WEG === 'durchsuchung_sauber' ? 0 : voll ? anzahlSchmuggel : (W.fracht || []).filter((x) => x.eig.includes('illegal') && !x.eig.some((e) => e.startsWith('getarnt'))).length;
    const rest = (W.fracht || []).length - erwartetN;
    erwartet = erwartetN === 0 ? 'nichts gefunden, kein Bussgeld, kein Ruf-Abzug, alle Ware bleibt, Abschluss' : `${erwartetN} Platz/Plaetze beschlagnahmt (${voll ? 'auch die getarnte Ware' : 'nur ungetarnte, die getarnte bleibt'}), Bussgeld ${BUSSE} Marken je Platz, Ruf ${RUFD} (Grund ${FW.fund_ruf.wert.rom}), ${rest} Platz/Plaetze bleiben`;
    const ds = mev.filter((e) => e.k === 'frachtDurchsucht'), bs = mev.filter((e) => e.k === 'frachtBeschlagnahmt');
    pruef(ds.length === 1 && ds[0].d.tiefe === W.tiefe, `genau eine Durchsuchung mit Tiefe ${W.tiefe} (${ds.map((e) => e.d.tiefe).join(',')})`);
    pruef(bs.length === 1 && bs[0].d.n === erwartetN, `beschlagnahmt: ${erwartetN} Platz/Plaetze (${bs.map((e) => e.d.n).join(',')})`);
    pruef(nachher.lager === vor.lager - erwartetN, `Frachtraum ${vor.lager} -> ${nachher.lager} Plaetze (${nachher.lagerText})`);
    pruef(nachher.marken === vor.marken - BUSSE * erwartetN, `Bussgeld: Marken ${vor.marken} -> ${nachher.marken} (erwartet ${BUSSE} je Platz, ${erwartetN} Platz/Plaetze)`);
    pruef(nachher.ruf_rom === vor.ruf_rom + (erwartetN > 0 ? RUFD : 0), `Ruf Rom ${vor.ruf_rom} -> ${nachher.ruf_rom} (erwartet ${erwartetN > 0 ? RUFD : 'keine Aenderung'})`);
    if (WEG === 'durchsuchung_voll') pruef(!nachher.lagerText.includes('waffen') && !nachher.lagerText.includes('sprengstoff') && nachher.lagerText.includes('hilfsgueter'), 'Sprengstoff und die getarnten Waffen sind weg, das Hilfsgueter bleiben');
    if (WEG === 'durchsuchung_scan') pruef(nachher.lagerText.includes('waffen(getarnt als fracht)') && !nachher.lagerText.includes('sprengstoff') && nachher.lagerText.includes('hilfsgueter'), 'bei Tiefe scan: nur der offene Sprengstoff ist weg, die getarnten Waffen bleiben getarnt');
    if (WEG === 'durchsuchung_sauber') pruef(nachher.lagerText === vor.lagerText && funk.some((x) => String(x.text) === FT.durchsuchung.sauber), `Funk: der Zoll meldet "${FT.durchsuchung.sauber}"`);
    pruef(f.phase === 'abgeschlossen', `Faden abgeschlossen (${belege.faden}; Ausgang gescheitert = geduldet, wie Ausliefern)`);
    pruef(!beatsIds.includes('b_kampf') && !beatsIds.includes('b_schmier'), `kein Schmiergeld, kein Kampf (${beatsIds.join(' > ')})`);
    // Tarnung: nichts, was die Crew liest, nennt die echte Art der getarnten Ware (Funk, Bordtexte vor und nach dem Fund)
    if (WEG !== 'durchsuchung_sauber') {
      const geleakt = funk.filter((x) => hatEchte(x.text)).map((x) => x.text);
      pruef(geleakt.length === 0, `Funk nennt die echte Art der getarnten Ware nie (${geleakt.length} Treffer)`);
      zeile(`BELEG    Bordtexte (ODA) zum Fund: ${oda.filter((t) => /Durchsuchung|Beschlagnahmt/.test(t)).join(' | ')}`);
    }
  }
  const antwortBeats = beatsGespielt.filter((x) => (FD.BEATS[x.typ] || {}).baustein === 'forderung');
  pruef(antwortBeats.length === beatsIds.filter((id) => ['b_forderung', 'b_schmier'].includes(id)).length && antwortBeats.every((x) => x.wie === 'gespielt' && x.ausgang !== 'offen'), `der Bot spielt die Beats der Forderung (Baustein forderung) als gespielt: ${antwortBeats.map((x) => x.id + ' ' + x.wie + ' ' + x.ausgang).join('; ') || '-'}`);
  pruef(g.errors === 0, `Serverfehler: ${g.errors}`);

  const ok = gate.every((x) => x.ok);
  const beobachtet_text = `${belege.faden}; Beats ${beatsIds.join(' > ')}; Ware ${vor.lager} -> ${nachher.lager} Plaetze; Marken ${belege.marken}; Ruf Rom ${belege.ruf_rom}; Invasion ${invasion ? 'ja' : 'nein'}`;
  fs.mkdirSync(OUT, { recursive: true });
  const kopf = [`BEA-01 D, Weg ${WEG}: ${W.titel}`, `Wahl des Bots (--wahl): ${WAHL.join(', ')}   Seed ${g.seed}   Werkzeug tools/spiel-forderung.js (echter Server, drei Clients, Mock-Spielleiter)`, `Erwartete Folge: ${erwartet}`, `Urteil: ${ok ? 'ok, alle Pruefungen erfuellt' : 'ABWEICHUNG: ' + abw.join('; ')}`, '='.repeat(100)];
  fs.writeFileSync(path.join(OUT, DATEI + '.txt'), kopf.concat(zeilen).join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT, DATEI + '.json'), JSON.stringify({ weg: WEG, titel: W.titel, wahl: WAHL, seed: g.seed, ok, abweichungen: abw, erwartet_text: erwartet, beobachtet_text, belege, beats: beatsIds, gedaechtnis: ged, invasion, enthuellung: enthuell_beat && enthuellt, marken: { vorher: vor.marken, nachher: nachher.marken }, ruf_rom: { vorher: vor.ruf_rom, nachher: nachher.ruf_rom }, lager: { vorher: vor.lager, nachher: nachher.lager, text_nachher: nachher.lagerText }, kuenstlich: kz, marken_bei_beat: marksAt, ware_nach_laden: zwischen, pruefungen: gate }, null, 1) + '\n', 'utf8');
  for (const x of cl) x.ws.close();
  const mit = MitLauf.beenden(g, () => {});
  if (mit) fs.appendFileSync(path.join(OUT, DATEI + '.txt'), `\nMitschnitt (MIT-01): ${mit}\n`);
  console.log(`${ok ? 'ok' : 'FEHLER'} ${WEG}: ${beobachtet_text}`);
  if (!ok) for (const a2 of abw) console.log('FEHLER ' + a2);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FEHLER: ' + (e && e.stack)); try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, DATEI + '-absturz.txt'), zeilen.join('\n') + '\n' + (e && e.stack) + '\n'); } catch (x) { /* egal */ } process.exit(1); });
