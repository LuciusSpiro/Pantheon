'use strict';
// FAB-01 C: Bot-Laeufer fuer den Beat landung am ECHTEN Server (Muster tools/spiel-forderung.js: startServer, WebSocket-Clients, Bots, Plan fest eingespeist). Rueckfall ohne Modell
// (FAEDEN=1, REISE_EREIGNISSE=1, LAGE_SPIELLEITER=1, SPIELLEITER_RUECKFALL=1, kein SPIELLEITER_LLM): 0 Komponisten-Aufrufe.
// Der Plan Geruecht -> landung (Landeplatz schiff) -> abschluss wird als Angebot eingespeist (Faden.abenteuerAnbieten, Pruefer inklusive), die Crew nimmt es ueber den Befehl abenteuer.annehmen an.
// Der Bot geht die echten Wege: Gruppe fliegt zum Hex des Geruechts (Teleport, wie spiel-forderung: flieg), Ops sitzt an der Konsole weapons und scannt den Ort (weapons.landescan, Halten), die Crew sitzt an der
// Konsole transfer und waehlt den Landepunkt (transfer.ziel, game.chooseLandepunkt), verlaesst die Konsole (leave), steht auf den Pads und beamt per E-Halten (act, selfbeam), unten wartet sie kurz, danach beamt sie
// per E-Halten wieder hoch. Kuenstlich (im Mitschnitt von k(...) gezaehlt): Teleport zum Hex, Ort des Schiffs am Beam-Punkt, Spieler an Konsole und Pads setzen (der Bot laeuft nicht). Die Zeit im Faden zaehlt der Lauf
// selbst ueber lageGrenze (Taetigkeiten); waehrend der Landung ruft er sie nicht auf (die Frist 12 zaehlt Taetigkeiten, am Boden zaehlt keine).
// Gegner am Boden: Die Bots schiessen nicht. Sie bleiben kurz unten (--unten-ms, Standard 1500) und beamen wieder hoch; wer dabei bewusstlos wuerde, wird gemeldet (Lauf rot: Notrueckholung waere gescheitert).
//
//   node tools/spiel-landung.js --besetzung ruhig|raeuber|belagerer [--crew 1|3] [--seed N] [--frist-lauf] [--unten-ms N] [--json datei] [--verlauf]     (npm run spiel:landung)
//   --json        schreibt die gemessenen Werte (Faden, Gedaechtnis, Verlauf, Gegner, Orte, Aufrufe, Fehler, Ereignisse am Boden) als Datei: der Test zaehlt selbst nach
//   --frist-lauf  Die Crew bleibt oben: die Frist laeuft ab, Beat scheitert, Verzweigung -> ende, Abschluss, Ort weg (Beat landung gescheitert, Gedaechtnis landung_gescheitert, Faden endet ueber die Verzweigung)
//   Exit 0: Soll erfuellt; Exit 1: Abweichung; Exit 2: falscher Aufruf.   Ausgabe knapp: Faden-Verlauf, Komponisten-Aufrufe, g.errors, Orte vorher/nachher.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const args = process.argv.slice(2);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined && !String(args[i + 1]).startsWith('--') ? args[i + 1] : undefined; };
const hat = (n) => args.includes('--' + n);
const BES = wert('besetzung');
const CREW = Number(wert('crew') || 1);
const SEED = Number(wert('seed') || 7);
const UNTEN_MS = Number(wert('unten-ms') || 1500);
const FRIST_LAUF = hat('frist-lauf');
const JSON_DATEI = wert('json');
if (!['ruhig', 'raeuber', 'belagerer'].includes(BES) || ![1, 3].includes(CREW) || !Number.isFinite(SEED) || !Number.isFinite(UNTEN_MS)) {
  console.error('Aufruf: node tools/spiel-landung.js --besetzung ruhig|raeuber|belagerer [--crew 1|3] [--seed N] [--frist-lauf] [--unten-ms N] [--verlauf]');
  process.exit(2);
}
for (const k of ['SPIELLEITER_LLM', 'LLM_LIVE']) delete process.env[k];
process.env.MISSION_SOURCE = 'fallback'; process.env.LAGE_SPIELLEITER = '1'; process.env.REISE_EREIGNISSE = '1'; process.env.FAEDEN = '1'; process.env.SPIELLEITER_RUECKFALL = '1';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Faden = require('../server/sim/faden.js');
const FD = require('../server/sim/faden-daten.js');
const AO = require('../server/sim/abenteuer-orte.js');
const LP = require('../server/sim/landepunkte.js');
const Lpscan = require('../server/sim/lpscan.js');
const interior = require('../server/sim/interior.js');
const Sektoren = require('../shared/sektoren.js');
const Bot = require('./lib/bot-crew.js');

const CODE = 'LAND';
const NAMEN = ['Ada', 'Bo', 'Cem'].slice(0, CREW);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
const zeile = (s) => { const t = new Date().toISOString().slice(11, 19); zeilen.push(`${t}  ${s}`); if (hat('verlauf')) console.log(`${t}  ${s}`); };
const kz = {};
const k = (...arten) => { for (const a of arten) kz[a] = (kz[a] || 0) + 1; };

const plan = () => ({
  format: 'faden-bauplan/1', titel: 'Absturz im Sektor', anlass: 'Ein Geruecht spricht von einem Wrack, niemand weiss wo.',
  landeplaetze: [{ id: 'absturz', art: 'schiff', besitz: 'herrenlos', name: 'Absturzstelle' }],
  beats: [{ typ: 'geruecht' }, { typ: 'landung', parameter: { landeplatz: 'absturz', besetzung: BES }, verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }],
});

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiel-landung-'));
  const srv = await startServer({ port: 0, quiet: true, noStore: true, worlds: true, worldDir: dir, roomCode: CODE });
  const g = srv.game, port = srv.port;
  g.fixedSeed = SEED; g.reset();
  const t0 = Date.now();
  const abw = [];
  const pruef = (c, t) => { zeile(`${c ? 'ok     ' : 'FEHLER '} ${t}`); if (!c) abw.push(t); };
  const sl = () => g.lageSpielleiter;
  const aufrufe = () => (sl() ? (sl().aufrufe || 0) + ((sl().abenteuer && sl().abenteuer.aufrufe) || 0) : 0);
  zeile(`Server auf Port ${port}, Seed ${g.seed}, Besetzung ${BES}, Crew ${CREW}${FRIST_LAUF ? ', Frist-Lauf (Crew bleibt oben)' : ''}; Rueckfall ohne Modell (Lage-Spielleiter ${sl() ? 'Modus ' + sl().mode : 'fehlt'})`);
  const cl = [];
  for (let i = 0; i < CREW; i++) cl.push(await Bot.client(WebSocket, port, CODE, { clientId: 'ABC'[i], name: NAMEN[i], color: i }, NAMEN[i], NAMEN));
  await sleep(300);
  cl[0].send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of cl) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  const w = Bot.werkzeug({ g, cl, zeile: (s) => zeile(`BOT      ${s}`), k });
  pruef(!!sl() && require('../server/sim/lage-spielleiter.js').rueckfallAn(g.env), `Rueckfall-Betrieb ohne Modell (Lage-Spielleiter ist da: ${!!sl()}, rueckfallAn)`);
  zeile(`Crew im Spiel: ${g.players.filter((p) => p.connected).length} verbunden, Phase ${g.phase}`);

  // ---- Beobachtung: Funk, Faden-Verlauf aus dem Logbuch der Regie, Ereignisse am Boden
  const emit0 = g.emit.bind(g); g.emit = (...a) => { if (a[0] === 'radio' && a[1]) zeile(`FUNK     ${String(a[1].from || '?').padEnd(16)} ${a[1].text}`); return emit0(...a); };
  const me0 = g.missionEvent.bind(g); const boden = [];
  g.missionEvent = (kk, d) => { if (['beamedDown', 'beamedUp', 'notsprung'].includes(kk)) { boden.push({ k: kk, map: d && d.map, n: d && d.players ? d.players.length : 0, notrueckholung: !!(d && d.notrueckholung) }); zeile(`EREIGNIS ${kk} ${d && d.map ? d.map : ''} ${d && d.players ? d.players.length + ' Spieler' : ''}${d && d.notrueckholung ? ' Notrueckholung' : ''}`); } return me0(kk, d); };
  if (typeof g.notice === 'function') { const n0 = g.notice.bind(g); g.notice = (pp, t2, ...r) => { zeile('HINWEIS  ' + t2); return n0(pp, t2, ...r); }; }
  const logbuch = () => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
  const beobachtet = new Set(); const verlauf = [];
  const sync = () => { for (const e of logbuch()) if (!beobachtet.has(e)) { beobachtet.add(e); if (e.art === 'faden_ereignis' && (e.ausgang === 'beat_start' || e.ausgang === 'beat_ende')) { const t = `${e.ausgang === 'beat_start' ? 'beginnt' : 'endet'} ${e.plan && e.plan.beat}${e.ausgang === 'beat_ende' && e.begruendung ? ' (' + String(e.begruendung).slice(0, 60) + ')' : ''}`; zeile(`BEAT     ${t}`); verlauf.push(t); } else if (e.art === 'faden_baustein' && e.key === 'landung') zeile(`BAUSTEIN ${e.ausgang}: ${String(e.begruendung).slice(0, 100)}`); } };
  const orte = () => ({ dyn: Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).filter((i) => AO.parse(i)), scan: Array.from((g.explore && g.explore.lpScan) || []).filter((i) => AO.parse(i)), aways: Object.keys(g.aways || {}).filter((i) => AO.parse(i)), awayMap: g.away && AO.parse(g.away.map) ? g.away.map : null });
  const zahlOrte = (o) => o.dyn.length + o.scan.length + o.aways.length + (o.awayMap ? 1 : 0);
  const orteVor = orte();
  const grenze = async () => { g.lageGrenze('szene_ende'); sync(); await sleep(80); };   // zaehlt EINE Taetigkeit (Frist, Abstand der Beats); der Rueckfall-Spielleiter startet an der Grenze den faelligen Beat
  const wartenAuf = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; sync(); await sleep(60); } return !!fn(); };
  const typ = (f) => { const v = FD.vorlage(f.vorlage); return v && v.beats[f.beat] && v.beats[f.beat].typ; };

  // ---- Angebot einspeisen, Crew nimmt an
  zeile(`CREW     in ${w.hierHex()}; der Plan Geruecht > landung (Besetzung ${BES}, Landeplatz schiff) > abschluss wird als Angebot eingespeist (kuenstlich: kein Komponist)`);
  k('plan-eingespeist');
  const a = Faden.abenteuerAnbieten(g, plan(), { hex: w.hierHex() });
  if (!a.ok) throw new Error('Angebot abgelehnt: ' + (a.fehler || [a.grund]).join('; '));
  const id = 'a' + a.angebot.nr;
  await wartenAuf(() => cl.every((c) => ((c.abenteuer && c.abenteuer.angebote) || []).some((x) => x.id === id)), 4000);
  cl[0].send({ t: 'cmd', c: 'abenteuer.annehmen', id });
  const f = await (async () => { for (let i = 0; i < 60; i++) { const x = g.weltsim.faeden.liste.find((q) => q.vorlage === a.angebot.ref); if (x) return x; await sleep(100); } return null; })();
  if (!f) throw new Error('Abenteuer nicht geoeffnet');
  zeile(`FADEN    ${f.id} (${f.vorlage}) geoeffnet, Beats ${FD.vorlage(f.vorlage).beats.map((b) => b.typ).join(' > ')}, NSC ${f.nsc.name}`);

  // ---- Geruecht: der Rueckfall-Spielleiter startet den Beat; die Crew fliegt zum genannten Hex
  let ok1 = await (async () => { for (let i = 0; i < 300 && !(f.phase === 'laeuft' && typ(f) === 'geruecht'); i++) { await grenze(); if (f.phase === 'abgeschlossen') return false; } return f.phase === 'laeuft' && typ(f) === 'geruecht'; })();
  if (!ok1) throw new Error(`Geruecht startet nicht (Phase ${f.phase}, Beat ${f.beat})`);
  const ziel = f.parameter.ort;
  zeile(`GERUECHT der Hafenfunk nennt ${Sektoren.hexName(ziel) || ziel} (${ziel}); die Crew fliegt hin`);
  w.flieg(ziel); await sleep(300);
  // landung startet an der naechsten Grenze (Abstand), der Ort wird bestellt (DYN-01)
  ok1 = await (async () => { for (let i = 0; i < 300 && !(f.phase === 'laeuft' && typ(f) === 'landung'); i++) { await grenze(); if (f.phase === 'abgeschlossen') return false; } return f.phase === 'laeuft' && typ(f) === 'landung'; })();
  if (!ok1) throw new Error(`landung startet nicht (Phase ${f.phase}, Beat ${f.beat})`);
  const lpId = Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).find((i) => { const m = AO.parse(i); return m && m.faden === f.id; });
  pruef(!!lpId, `der Ort ist bestellt (${lpId || 'keiner'}), Beat landung laeuft, Funk beim Start siehe oben`);
  const orteWaehrend = orte();
  pruef(zahlOrte(orteWaehrend) >= 1, `der Ort steht im Lauf (dyn ${orteWaehrend.dyn.length}, lpScan ${orteWaehrend.scan.length}, aways ${orteWaehrend.aways.length})`);
  let gegner = 0, gegnerArten = '';
  const zaehleGegner = () => { const aw = g.aways[lpId]; gegner = aw ? (aw.drones || []).length : 0; gegnerArten = aw ? Array.from(new Set((aw.drones || []).map((d) => d.kind || d.rolle || '?'))).join(',') : ''; return gegner; };

  let unten = [];
  if (FRIST_LAUF) {
    // Crew bleibt oben: nur die Zeit laeuft (Taetigkeiten); die Frist des Beats landung laeuft ab
    zeile(`CREW     bleibt oben; Frist ${FD.BEATS.landung.frist} Taetigkeiten laufen ab`);
    await sleep(300); zaehleGegner();
  } else {
    // ---- Ops scannt den Ort (echter Befehl weapons.landescan, Halten 4 s): das Schiff steht am Beam-Punkt
    await wartenAuf(() => !!LP.info(g, lpId), 8000);
    const info = LP.info(g, lpId);
    if (!info || !info.beam) throw new Error('Landepunkt ohne Beam-Punkt: ' + lpId);
    let stehtSchon = false; const stehen = () => { if (!stehtSchon) { stehtSchon = true; k('ort-setzen'); } const s = g.ship; s.docked = false; s.dockedAt = null; s.x = info.beam.x + 20; s.y = info.beam.y; s.vx = 0; s.vy = 0; s.speed = 0; if (s.helm) { s.helm.thrust = 0; s.helm.turn = 0; } };
    stehen();
    await w.konsole('weapons');
    cl[0].send({ t: 'cmd', c: 'weapons.landescan' });
    const gescannt = await wartenAuf(() => { stehen(); return Lpscan.gescannt(g, lpId); }, 15000);
    zeile(`OPS      weapons.landescan: Ort gescannt ${gescannt}`);
    pruef(gescannt, 'der Ort ist gescannt (Ops, weapons.landescan)');
    // ---- Transfer-Konsole: Landepunkt waehlen (transfer.ziel), Konsole verlassen
    cl[0].send({ t: 'leave' }); await sleep(250);   // die Ops steht auf; an der Transfer-Konsole sitzt sie neu (Tab wechselt nur zwischen Steuer, Ops und den anderen Stationen eines Platzes)
    await w.konsole('transfer');
    cl[0].send({ t: 'cmd', c: 'transfer.ziel', landepunkt: lpId });
    await wartenAuf(() => g.away && g.away.map === lpId, 3000);
    pruef(g.away && g.away.map === lpId && g.transferZiel && g.transferZiel.lp === lpId, `Landepunkt gewaehlt (transfer.ziel): away.map ${g.away && g.away.map}`);
    cl[0].send({ t: 'leave' }); await sleep(250);
    // ---- Pads: die untere Mannschaft steht auf den Pads (gesetzt), E halten (selfbeam), alle auf Pads beamen zusammen
    const mannschaft = g.players.slice(0, CREW === 1 ? 1 : 2);   // Crew 3: zwei Bots gehen runter, der dritte bleibt an Bord (Mehrspieler-Pfad)
    k('spieler-setzen');
    mannschaft.forEach((p, i) => interior.placeOnShipPad(g, p, i));
    stehen(); await sleep(200);
    const halte = async (richtung, ziel) => {   // E halten bis die Zone wechselt
      for (const p of mannschaft) { const c = cl[g.players.indexOf(p)]; c.send({ t: 'act', down: true }); }
      const da = await wartenAuf(() => { stehen(); return mannschaft.every((p) => p.zone === ziel); }, 15000);
      for (const p of mannschaft) { const c = cl[g.players.indexOf(p)]; c.send({ t: 'act', down: false }); }
      zeile(`BOT      ${richtung}: ${mannschaft.map((p) => p.name + ' ' + p.zone).join(', ')} (E halten, selfbeam)`);
      return da;
    };
    const runter = await halte('runter', 'away');
    pruef(runter, `Crew unten (${mannschaft.length} von ${CREW} Bots, away.map ${g.away && g.away.map})`);
    unten = mannschaft;
    zaehleGegner();
    zeile(`BODEN    ${gegner} Gegner am Ort (${gegnerArten || '-'}), Besetzung ${BES}; die Bots schiessen nicht, warten ${UNTEN_MS} ms`);
    await sleep(UNTEN_MS);
    const bewusstlos = mannschaft.filter((p) => p.downed);
    pruef(bewusstlos.length === 0, `niemand bewusstlos beim Warten (${bewusstlos.map((p) => p.name).join(',') || '-'})`);
    pruef(f.phase === 'laeuft', `der Beat laeuft, solange die Crew unten ist (Phase ${f.phase})`);
    if (!bewusstlos.length) {
      const hoch = await halte('hoch', 'ship');
      pruef(hoch, 'Crew wieder oben');
    }
  }

  // ---- Ausgang: der Rueckfall fuehrt den Faden zu Ende (landung gelungen > Abschluss; im Frist-Lauf: Frist > gescheitert > Verzweigung ende > Abschluss)
  for (let i = 0; i < 600 && f.phase !== 'abgeschlossen'; i++) { await grenze(); if (i % 100 === 99) zeile(`WARTEN   Faden steht bei Beat ${f.beat} (${f.phase}), Zaehler ${f.zaehler}/${f.abstand}`); }
  for (let i = 0; i < 12; i++) { await grenze(); }
  await sleep(500);
  const ged = f.nsc.gedaechtnis.map((e) => e.ereignis);
  const orteNach = orte();
  pruef(f.phase === 'abgeschlossen', `Faden abgeschlossen (Phase ${f.phase}, Beat ${f.beat})`);
  // Der Ausgang des Fadens ist der des letzten Beats (abschluss): im Frist-Lauf scheitert nur der Beat landung, die Verzweigung fuehrt in den Abschluss; ob der Faden dort gelungen endet, bestimmt der Plan (Daten)
  pruef(FRIST_LAUF ? (!!f.ausgang && ['gelungen', 'gescheitert'].includes(f.ausgang.art)) : (!!f.ausgang && f.ausgang.art === 'gelungen'), `Ausgang des Fadens ${FRIST_LAUF ? '(Abschluss nach Verzweigung)' : 'gelungen'}: ${f.ausgang && f.ausgang.art}`);
  pruef(FRIST_LAUF ? (ged.includes('landung_gescheitert') && !ged.includes('landung_gelungen')) : (ged.includes('landung_gelungen') && !ged.includes('landung_gescheitert')), `Gedaechtnis: ${ged.join(', ')}`);
  const downs = boden.filter((e) => e.k === 'beamedDown' && e.map === lpId), ups = boden.filter((e) => e.k === 'beamedUp' && e.map === lpId);
  if (FRIST_LAUF) pruef(downs.length === 0 && ups.length === 0, 'nie unten gewesen (kein beamedDown/-Up am Ort)');
  else pruef(downs.length >= 1 && ups.length >= 1 && !ups.some((e) => e.notrueckholung) && unten.length >= (CREW === 1 ? 1 : 2) && downs.reduce((s, e) => s + e.n, 0) >= unten.length, `beamedDown ${downs.length}x (${downs.map((e) => e.n).join('+')} Spieler), beamedUp ${ups.length}x, ohne Notrueckholung`);
  // Besetzung nach Variante (Tabelle aus den Daten gelesen)
  const BW = JSON.parse(fs.readFileSync(path.join('content', 'faeden', 'boden-werte.json'), 'utf8')).werte.besetzung.wert;
  const brauchtGegner = Object.keys(BW[BES]).length > 0;
  const minG = BES === 'ruhig' ? 0 : BES === 'raeuber' ? 1 : 2;
  if (FRIST_LAUF) zeile(`BODEN    Gegner am Ort vor dem Abraeumen: ${gegner}`);
  else if (BES === 'ruhig') pruef(gegner === 0 && !brauchtGegner, `ruhig: 0 Gegner am Ort (${gegner})`);
  else pruef(gegner >= minG, `${BES}: mindestens ${minG} Gegner am Ort (${gegner}: ${gegnerArten})`);
  pruef(zahlOrte(orteNach) === 0, `Ort restlos abgeraeumt: ${orteVor.dyn.length + orteVor.scan.length + orteVor.aways.length} Orte vorher, nachher dyn ${orteNach.dyn.length}, lpScan ${orteNach.scan.length}, aways ${orteNach.aways.length}, away.map ${orteNach.awayMap || 'nicht der Ort'}`);
  pruef(g.players.every((p) => p.zone !== 'away'), 'niemand mehr unten');
  pruef(aufrufe() === 0, `Komponisten-Aufrufe ${aufrufe()} (Rueckfall ohne Modell)`);
  pruef(g.errors === 0, `g.errors ${g.errors}`);
  const sek = Math.round((Date.now() - t0) / 100) / 10;
  const ok = abw.length === 0;
  const kurz = `${ok ? 'ok' : 'FEHLER'} ${BES} crew ${CREW} seed ${SEED}${FRIST_LAUF ? ' frist-lauf' : ''}: Ausgang ${f.ausgang && f.ausgang.art}, Verlauf ${verlauf.join(' > ')}; Gegner ${gegner}; unten ${unten.length}; Komponisten-Aufrufe ${aufrufe()}; g.errors ${g.errors}; Orte ${zahlOrte(orteVor)} vorher, ${zahlOrte(orteWaehrend)} im Lauf, ${zahlOrte(orteNach)} nachher; ${sek} s; kuenstlich ${JSON.stringify(kz)}`;
  if (JSON_DATEI) fs.writeFileSync(JSON_DATEI, JSON.stringify({ besetzung: BES, crew: CREW, seed: g.seed, fristLauf: FRIST_LAUF, ok, abweichungen: abw, faden: { phase: f.phase, ausgang: f.ausgang && f.ausgang.art, gedaechtnis: ged, verlauf }, gegner, gegnerArten, unten: unten.length, komponistenAufrufe: aufrufe(), errors: g.errors, orte: { vor: zahlOrte(orteVor), lauf: zahlOrte(orteWaehrend), nach: zahlOrte(orteNach), nachDetail: orteNach }, boden: boden.filter((e) => e.map === lpId), sekunden: sek, kuenstlich: kz }, null, 1) + '\n', 'utf8');
  for (const x of cl) { try { x.ws.close(); } catch (e) { /* egal */ } }
  if (!ok) for (const z of zeilen.slice(-40)) console.log(z);
  console.log(kurz);
  if (!ok) for (const x of abw) console.log('FEHLER ' + x);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FEHLER: ' + (e && e.stack)); for (const z of zeilen.slice(-30)) console.log(z); process.exit(1); });
