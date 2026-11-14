'use strict';
// BEA-03 B: Bot-Laeufer fuer den Beat hinterhalt am ECHTEN Server (Muster tools/spiel-rettung.js: startServer, WebSocket-Clients, Rueckfall ohne Modell). FAEDEN=1, LAGE_SPIELLEITER=1, SPIELLEITER_RUECKFALL=1, kein
// SPIELLEITER_LLM: 0 Komponisten-Aufrufe. REISE_EREIGNISSE=off (kein zufaelliges Reise-Ereignis bricht den Schnellsprung ab; Hinterhalt im selben Hop wie ein Ereignis: tools/test-faden-hinterhalt.js). Der Plan Hinterhalt -> abschluss wird als Angebot eingespeist (Faden.abenteuerAnbieten, Pruefer inklusive), die Crew nimmt es ueber den Befehl abenteuer.annehmen an, der
// Rueckfall-Spielleiter startet den Beat; der Code waehlt den Sektor (faden-hinterhalt.js hexWaehlen, 1 bis 3 Spruenge entfernt). Die Crew kaempft allein, ohne andere Beats und ohne Unterstuetzung.
//
// Der Bot geht die echten Wege: Captain waehlt das Ziel (captain.selectDest { hex }), Navigation loest aus (helm.schnellsprung: alle Hops der Route) oder springt einzeln (weapons.widescan, helm.jump).
//   schnell   Schnellsprung DURCH den Hinterhalt-Sektor (Route ueber ihn hinaus): der Schnellsprung haelt dort an (Meldung "Schnellsprung angehalten"), die Szene steht im selben Takt mit allen Gegnern (kein Vorlauf),
//             im Hop mit Hinterhalt wird nicht abgefangen (das Zufalls-Abfangen ist ab dem Hop davor SICHER eingeschaltet: kaeme der Hop in abfangen(), stuenden Jaeger mit Tag abfang da)
//   einzel    ein echter Einzelsprung (Weitscan, helm.jump) vom Nachbarsektor auf der Route in den Hinterhalt-Sektor: dieselbe Szene
//   fremd     Schnellsprung ueber eine Route OHNE den Hinterhalt-Sektor: kein Halt, keine Szene, der Beat wartet weiter
// Ausgang (nicht bei fremd):
//   gelungen    KUENSTLICH: die Bots haben keine Bordkanone, ein TESTHELFER zerstoert die Gegner mit dem Tag der Szene (gegner-testhilfe, im Mitschnitt als testhelfer-kill gezaehlt)
//   gescheitert wie flucht (Standard: die Crew springt per Einzelsprung in den Nachbarsektor, Szenenwechsel) oder wie frist (die Crew bleibt, die Frist laeuft ueber Taetigkeitsgrenzen ab)
// Danach fuehrt der Rueckfall den Faden zum Abschluss; Faden und Gedaechtnis (hinterhalt_gelungen / hinterhalt_gescheitert) werden geprueft, nichts bleibt stehen (Szene, Warteschlange, Gegner, Sektor des Beats).
// Kuenstlich (im Mitschnitt von k(...) gezaehlt): alle Sektoren erkundet, Teleport (Start, Vorsektor beim Einzelsprung), Ort des Schiffs am Sprungpunkt, Spieler an Konsolen setzen, testhelfer-kill, Zufalls-Abfangen
// am Vorsektor auf sicher.
//
//   node tools/spiel-hinterhalt.js [--modus schnell|einzel|fremd] [--ausgang gelungen|gescheitert] [--wie flucht|frist] [--crew 1|3] [--seed N] [--laden-s S] [--json datei] [--verlauf]     (npm run spiel:hinterhalt)
//   Standard: --modus schnell --ausgang gelungen --crew 1.   --wie gilt nur bei --ausgang gescheitert.
//   --laden-s S  KUENSTLICH (als laden-kurz gezaehlt): Ladezeit des Sprungantriebs auf S Sekunden statt C.ship.jumpCharge (rund 10 s je Sprung); nur fuer die Laufzeit des Tests, ohne die Flagge laedt der Antrieb echt
//   --json   schreibt die gemessenen Werte (Faden, Gedaechtnis, Verlauf, Gegner, Funk, Aufrufe, Fehler, Mitschnitt) als Datei: der Test zaehlt selbst nach
//   Exit 0: Soll erfuellt; Exit 1: Abweichung; Exit 2: falscher Aufruf.   Ausgabe knapp: eine Zeile, bei Abweichung die letzten Zeilen des Verlaufs.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const args = process.argv.slice(2);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined && !String(args[i + 1]).startsWith('--') ? args[i + 1] : undefined; };
const hat = (n) => args.includes('--' + n);
const MODUS = wert('modus') || 'schnell';
const AUSGANG = wert('ausgang') || 'gelungen';
const WIE = wert('wie') || 'flucht';
const CREW = Number(wert('crew') || 1);
const SEED = Number(wert('seed') || 7);
const JSON_DATEI = wert('json');
const LADEN_S = wert('laden-s') === undefined ? null : Number(wert('laden-s'));
const bekannt = ['--modus', '--ausgang', '--wie', '--crew', '--seed', '--json', '--verlauf', '--laden-s'];
if (!['schnell', 'einzel', 'fremd'].includes(MODUS) || (LADEN_S !== null && !(LADEN_S > 0)) || !['gelungen', 'gescheitert'].includes(AUSGANG) || !['flucht', 'frist'].includes(WIE) || ![1, 3].includes(CREW) || !Number.isFinite(SEED)
  || args.some((a) => a.startsWith('--') && !bekannt.includes(a)) || (hat('wie') && AUSGANG !== 'gescheitert') || (MODUS === 'fremd' && (hat('ausgang') || hat('wie')))) {
  console.error('Aufruf: node tools/spiel-hinterhalt.js [--modus schnell|einzel|fremd] [--ausgang gelungen|gescheitert] [--wie flucht|frist] [--crew 1|3] [--seed N] [--laden-s S] [--json datei] [--verlauf]');
  console.error('   --wie nur mit --ausgang gescheitert; bei --modus fremd gibt es keinen Ausgang');
  process.exit(2);
}
for (const k of ['SPIELLEITER_LLM', 'LLM_LIVE']) delete process.env[k];
process.env.MISSION_SOURCE = 'fallback'; process.env.LAGE_SPIELLEITER = '1'; process.env.REISE_EREIGNISSE = 'off'; process.env.FAEDEN = '1'; process.env.SPIELLEITER_RUECKFALL = '1';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Faden = require('../server/sim/faden.js');
const FD = require('../server/sim/faden-daten.js');
const Reise = require('../server/sim/reise.js');
const HH = require('../server/sim/faden-hinterhalt.js');
const Sektoren = require('../shared/sektoren.js');
const Bot = require('./lib/bot-crew.js');
const Testhilfe = require('./gegner-testhilfe.js');

const CODE = 'HINT';
const NAMEN = ['Ada', 'Bo', 'Cem'].slice(0, CREW);
const SZD = JSON.parse(fs.readFileSync(path.join('content', 'faeden', 'szenen-werte.json'), 'utf8'));
const HW = SZD.werte.hinterhalt.wert;
const SOLL_GEGNER = Number(HW.anzahl[String(CREW)]);   // aus den Daten, nie ein Literal
const ALLE_HEXE = Object.keys(JSON.parse(fs.readFileSync(path.join('content', 'welt', 'sund_frei.json'), 'utf8')).hexe);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
const zeile = (s) => { const t = new Date().toISOString().slice(11, 19); zeilen.push(`${t}  ${s}`); if (hat('verlauf')) console.log(`${t}  ${s}`); };
const kz = {};
const k = (...arten) => { for (const a of arten) kz[a] = (kz[a] || 0) + 1; };
const plan = () => ({
  format: 'faden-bauplan/1', titel: 'Ein Hinterhalt an der Strecke', anlass: 'Piraten lauern irgendwo in der Naehe auf Schiffe, die den Sektor durchfliegen.',
  beats: [{ typ: 'hinterhalt' }, { typ: 'abschluss' }],
});

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiel-hinterhalt-'));
  const srv = await startServer({ port: 0, quiet: true, noStore: true, worlds: true, worldDir: dir, roomCode: CODE });
  const g = srv.game, port = srv.port;
  g.fixedSeed = SEED; g.reset();
  const t0 = Date.now();
  const abw = [];
  const pruef = (c, t) => { zeile(`${c ? 'ok     ' : 'FEHLER '} ${t}`); if (!c) abw.push(t); };
  const sl = () => g.lageSpielleiter;
  const aufrufe = () => (sl() ? (sl().aufrufe || 0) + ((sl().abenteuer && sl().abenteuer.aufrufe) || 0) : 0);
  zeile(`Server auf Port ${port}, Seed ${g.seed}, Modus ${MODUS}${MODUS === 'fremd' ? '' : ', Ausgang ' + AUSGANG + (AUSGANG === 'gescheitert' ? ' (' + WIE + ')' : '')}, Crew ${CREW}; Rueckfall ohne Modell (Lage-Spielleiter ${sl() ? 'Modus ' + sl().mode : 'fehlt'})`);
  const cl = [];
  for (let i = 0; i < CREW; i++) cl.push(await Bot.client(WebSocket, port, CODE, { clientId: 'ABC'[i], name: NAMEN[i], color: i }, NAMEN[i], NAMEN));
  await sleep(300);
  cl[0].send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of cl) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  const w = Bot.werkzeug({ g, cl, zeile: (s) => zeile(`BOT      ${s}`), k });
  pruef(!!sl() && require('../server/sim/lage-spielleiter.js').rueckfallAn(g.env), `Rueckfall-Betrieb ohne Modell (Lage-Spielleiter ist da: ${!!sl()}, rueckfallAn)`);
  zeile(`Crew im Spiel: ${g.players.filter((p) => p.connected).length} verbunden, Phase ${g.phase}`);

  // ---- Beobachtung: Funk, Bordanzeige, Faden-Verlauf aus dem Logbuch der Regie
  const funk = [], oda = [];
  const emit0 = g.emit.bind(g); g.emit = (...a) => { if (a[0] === 'radio' && a[1]) { funk.push(String(a[1].text)); zeile(`FUNK     ${String(a[1].from || '?').padEnd(16)} ${a[1].text}`); } return emit0(...a); };
  const oda0 = g.oda.bind(g); g.oda = (t, kk) => { oda.push(String(t)); zeile('ODA      ' + t); return oda0(t, kk); };
  // Takt der Funkmeldung: wie viele Gegner stehen am ENDE desselben Ticks (der Hinterhalt hat keinen Vorlauf: Meldung und Gegner im selben Takt)
  let gegnerImTakt = null;
  const step0 = g.step.bind(g);
  g.step = function (...a) { const nf = funk.length; const r = step0(...a); if (gegnerImTakt === null && funk.slice(nf).some((t) => /Hinterhalt im Sektor/.test(t))) gegnerImTakt = g.space.enemies.length; return r; };
  const logbuch = () => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
  const beobachtet = new Set(); const verlauf = [];
  const sync = () => { for (const e of logbuch()) if (!beobachtet.has(e)) { beobachtet.add(e); if (e.art === 'faden_ereignis' && (e.ausgang === 'beat_start' || e.ausgang === 'beat_ende')) { const t = `${e.ausgang === 'beat_start' ? 'beginnt' : 'endet'} ${e.plan && e.plan.beat}${e.ausgang === 'beat_ende' && e.begruendung ? ' (' + String(e.begruendung).slice(0, 60) + ')' : ''}`; zeile(`BEAT     ${t}`); verlauf.push(t); } } };
  const grenze = async () => { g.lageGrenze('szene_ende'); sync(); await sleep(80); };   // zaehlt EINE Taetigkeit (Frist, Abstand der Beats); der Rueckfall-Spielleiter startet an der Grenze den faelligen Beat
  const wartenAuf = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; sync(); await sleep(50); } return !!fn(); };
  const typ = (f) => { const v = FD.vorlage(f.vorlage); return v && v.beats[f.beat] && v.beats[f.beat].typ; };
  const tags = () => g.space.enemies.map((e) => e.tag);
  const hier = () => w.hierHex();
  const abfangC = (p) => { const r = g.C.reise; r.neutralChance = p; r.neutralPlus = 0; r.neutralMax = p; r.feindChance = p; };
  if (LADEN_S !== null) { k('laden-kurz'); g.C.ship.jumpCharge = LADEN_S; }
  abfangC(0);   // sonst wuerfelt der Zufall mit: der Lauf soll nur den Hinterhalt zeigen

  // ---- kuenstlich: alle Sektoren erkundet (der Schnellsprung braucht bekannte Strecken)
  k('erkunden'); for (const h of ALLE_HEXE) g.explore.erkunde(h);
  const start = hier();

  // ---- Angebot einspeisen, die Crew nimmt an, der Rueckfall-Spielleiter startet den Beat
  k('plan-eingespeist');
  const a = Faden.abenteuerAnbieten(g, plan(), { hex: start });
  if (!a.ok) throw new Error('Angebot abgelehnt: ' + (a.fehler || [a.grund]).join('; '));
  const id = 'a' + a.angebot.nr;
  await wartenAuf(() => cl.every((c) => ((c.abenteuer && c.abenteuer.angebote) || []).some((x) => x.id === id)), 4000);
  cl[0].send({ t: 'cmd', c: 'abenteuer.annehmen', id });
  const f = await (async () => { for (let i = 0; i < 60; i++) { const x = g.weltsim.faeden.liste.find((q) => q.vorlage === a.angebot.ref); if (x) return x; await sleep(100); } return null; })();
  if (!f) throw new Error('Abenteuer nicht geoeffnet');
  zeile(`FADEN    ${f.id} (${f.vorlage}) geoeffnet, Beats ${FD.vorlage(f.vorlage).beats.map((b) => b.typ).join(' > ')}, NSC ${f.nsc.name}; Crew in ${start}`);
  let ok1 = false;
  for (let i = 0; i < 300 && !(f.phase === 'laeuft' && typ(f) === 'hinterhalt'); i++) { await grenze(); if (f.phase === 'abgeschlossen') break; }
  ok1 = f.phase === 'laeuft' && typ(f) === 'hinterhalt';
  if (!ok1) throw new Error(`hinterhalt startet nicht (Phase ${f.phase}, Beat ${f.beat})`);
  const H = f.laufend && f.laufend.hex;
  pruef(/^\d{4}$/.test(H || '') && H !== start, `der Beat laeuft und wartet an Sektor ${H} (${Sektoren.hexName(H)}), die Crew ist in ${hier()}: keine Szene, nichts eingeplant`);
  pruef(!g.fadenSzene && !(g.fadenWarte || []).length && tags().length === 0 && hier() === start, 'vor der Ankunft: keine Faden-Szene, keine Warteschlange, keine Gegner');
  const ortGeschichte = f.parameter.ort;
  const dist = require('../server/sim/faden-b1.js').erreichbar(g, start, HW.ziel.max);
  pruef(dist.get(H) >= HW.ziel.min && dist.get(H) <= HW.ziel.max, `der Code hat einen Sektor ${dist.get(H)} Spruenge entfernt gewaehlt (Daten ${HW.ziel.min} bis ${HW.ziel.max})`);

  // ---- Routen (echte Planung der Reise): durch H hindurch / ohne H
  const alle = ALLE_HEXE.filter((h) => h !== start);
  const routen = alle.map((z) => ({ z, hops: Reise.planen(g, start, z) })).filter((r) => r.hops && r.hops.length);
  const durch = routen.filter((r) => r.hops.includes(H) && r.hops.indexOf(H) < r.hops.length - 1).sort((x, y) => x.hops.length - y.hops.length || x.hops.indexOf(H) - y.hops.indexOf(H))[0];
  const ohne = routen.filter((r) => !r.hops.includes(H) && r.hops.length >= 2).sort((x, y) => x.hops.length - y.hops.length)[0];
  const pos = (r) => r.hops.indexOf(H);
  const vorH = durch ? (pos(durch) === 0 ? start : durch.hops[pos(durch) - 1]) : null;   // der Sektor vor dem Hinterhalt-Sektor auf der Route
  if (MODUS !== 'fremd' && !durch) throw new Error('keine Route durch ' + H + ' gefunden');
  if (MODUS === 'fremd' && !ohne) throw new Error('keine Route ohne ' + H + ' gefunden');
  zeile(`ROUTE    ${MODUS === 'fremd' ? 'ohne ' + H + ': ' + start + ' > ' + ohne.hops.join(' > ') : 'durch ' + H + ': ' + start + ' > ' + durch.hops.join(' > ') + ' (Vorsektor ' + vorH + ')'}`);

  // ---- Schnellsprung: Captain waehlt, Navigation loest aus (Schiff am ersten Sprungpunkt, Antrieb laedt)
  const schnell = async (r) => {
    await w.konsole('captain');
    cl[0].send({ t: 'cmd', c: 'captain.selectDest', hex: r.z });
    await wartenAuf(() => g.reisePlan && g.reisePlan.ziel === r.z, 3000);
    const Sprung = require('../server/sim/sprung.js');
    const p = Sprung.sprungpunkt(g, g.reisePlan.hops[0]); k('ort-setzen');
    const s = g.ship; s.docked = false; s.dockedAt = null; s.x = p.x - 80; s.y = p.y; s.vx = 0; s.vy = 0; s.speed = 0;
    await w.konsole('helm');
    const bereit = await wartenAuf(() => s.jump.ready, 60000);
    if (!bereit) throw new Error('Sprungantrieb nicht bereit: ' + (s.jump.blockedReason || 'unbekannt'));
    zeile(`BOT      Ziel ${r.z} gewaehlt (captain.selectDest), Route ${g.reisePlan.hops.join(' > ')}, Antrieb bereit; Schnellsprung ausloesen (helm.schnellsprung)`);
    cl[0].send({ t: 'cmd', c: 'helm.schnellsprung' });
    return g.reisePlan.hops.slice();
  };
  // Zufalls-Abfangen im Sektor VOR dem Hinterhalt sicher einschalten (ab dem naechsten Hop): kaeme der Hop in abfangen(), stuenden Jaeger mit Tag abfang da
  const wache = setInterval(() => { try { if (g.reise && hier() === vorH) abfangC(1); } catch (e) { /* egal */ } }, 25);

  let fs0 = null;   // die Szene des Hinterhalts, sobald sie steht
  if (MODUS === 'fremd') {
    await schnell(ohne);
    const fertig = await wartenAuf(() => !g.reise && hier() === ohne.z, 60000);
    pruef(fertig, `der Schnellsprung ueber eine Route ohne den Hinterhalt-Sektor kommt durch (Sektor ${hier()}, Ziel ${ohne.z})`);
    pruef(oda.some((m) => /Schnellsprung abgeschlossen/.test(m)) && !oda.some((m) => /Schnellsprung angehalten/.test(m)), 'keine Halt-Meldung: ein anderer Sektor loest nicht aus');
    await sleep(1500);
    pruef(!g.fadenSzene && !(g.fadenWarte || []).length && tags().length === 0 && !funk.some((t) => /Hinterhalt im Sektor/.test(t)), 'keine Szene, keine Gegner, kein Funk: ein anderer Sektor loest nicht aus');
    pruef(f.phase === 'laeuft' && f.laufend && f.laufend.hex === H && HH.halt(g, H) !== null, `der Beat wartet weiter an ${H}`);
    fs0 = null;
  } else {
    if (MODUS === 'schnell') {
      const hops = await schnell(durch);
      const da = await wartenAuf(() => !g.reise && hier() === H, 60000);
      pruef(da, `der Schnellsprung haelt im Hinterhalt-Sektor (Sektor ${hier()}, Soll ${H}, Route ${hops.join(' > ')}, Reise ${!!g.reise})`);
      pruef(oda.some((m) => /Schnellsprung angehalten/.test(m) && /Hinterhalt/.test(m) && m.includes(Sektoren.hexName(H))), 'die Bordanzeige meldet den Halt, nennt den Hinterhalt und den Sektor');
      pruef(g.reisePlan && g.reisePlan.hops.join() === hops.slice(hops.indexOf(H) + 1).join(), `die Rest-Route bleibt gewaehlt (${g.reisePlan && g.reisePlan.hops.join(' > ')})`);
    } else {
      w.flieg(vorH);   // Teleport an den Vorsektor (kuenstlich), dann EIN echter Einzelsprung
      await sleep(300);
      pruef(!g.fadenSzene && tags().length === 0 && hier() === vorH, `Crew im Vorsektor ${vorH}: nichts ausgeloest`);
      abfangC(1);   // das Zufalls-Abfangen ist ab jetzt sicher: der Hop in den Hinterhalt darf trotzdem nur den Hinterhalt zeigen
      const ok = await w.springe(H);
      pruef(ok && hier() === H, `echter Einzelsprung (Weitscan, helm.jump) von ${vorH} nach ${H}`);
    }
    // Szene sofort: Meldung und Gegner stehen im Takt der Ankunft (kein Vorlauf)
    await wartenAuf(() => g.fadenSzene && g.fadenSzene.art === 'hinterhalt', 3000);
    fs0 = g.fadenSzene;
    pruef(!!fs0 && fs0.phase === 'kampf' && fs0.sek === 0, `die Szene steht sofort im Kampf (Art ${fs0 && fs0.art}, Phase ${fs0 && fs0.phase}, Vorlauf ${fs0 && fs0.sek} s)`);
    pruef(gegnerImTakt === SOLL_GEGNER, `Meldung und Gegner im selben Takt: am Ende des Ticks der Funkmeldung standen ${gegnerImTakt} Gegner (Soll ${SOLL_GEGNER})`);
    pruef(!!fs0 && tags().filter((t) => t === fs0.tag).length === SOLL_GEGNER && tags().every((t) => t === fs0.tag), `Gegner sofort: ${tags().length} (Soll ${SOLL_GEGNER} fuer Crew ${CREW}, aus den Daten), alle mit dem Tag der Szene, keine Zufalls-Jaeger (${Array.from(new Set(tags())).join(',')})`);
    pruef(!oda.some((m) => /Abgefangen/.test(m)), 'im Hop mit Hinterhalt kein Zufalls-Abfangen (keine Meldung Abgefangen), obwohl es ab dem Vorsektor sicher eingeschaltet war');
    const hh = funk.find((t) => /Hinterhalt im Sektor/.test(t));
    pruef(!!hh && hh.includes(Sektoren.hexName(H)) && hh.includes(String(SOLL_GEGNER)), `die Funkmeldung kommt bei der Ankunft (${hh})`);
    pruef(f.parameter.ort === ortGeschichte && f.parameter.ort !== H, `der Ort der Geschichte bleibt (${f.parameter.ort}), der Sektor des Hinterhalts steht nur im laufenden Beat`);
    abfangC(0);

    // ---- Ausgang
    if (AUSGANG === 'gelungen') {
      k('testhelfer-kill');   // KUENSTLICH: die Bots haben keine Bordkanone, ein Testhelfer zerstoert die Gegner mit dem Tag der Szene
      zeile(`KUENSTL  Testhelfer zerstoert die ${SOLL_GEGNER} Gegner der Szene (die Bots haben keine Bordkanone)`);
      for (let i = 0; i < 60 && g.space.enemies.some((e) => e.tag === fs0.tag); i++) { for (const e of g.space.enemies.filter((x) => x.tag === fs0.tag)) Testhilfe.toetenSofort(g, e); await sleep(100); }
    } else if (WIE === 'flucht') {
      // Flucht: Szenenwechsel in einen Nachbarsektor (wie ein Sprung oder Notsprung), die Gegner bleiben im alten Sektor. Teleport (kuenstlich): unter Beschuss laedt der Antrieb nicht verlaesslich,
      // ein echter Einzelsprung aus dem Gefecht scheiterte im Probelauf (Schiff zerschossen); der Sprung selbst ist im Modus einzel (hinein) echt belegt
      const nach = Array.from(require('../server/sim/faden-b1.js').erreichbar(g, H, 1)).filter(([h, s]) => s === 1 && h !== H).map(([h]) => h).sort().find((h) => w.wegNach(h));
      zeile(`BOT      Flucht: Szenenwechsel ${H} > ${nach} (Teleport)`);
      w.flieg(nach); await sleep(300);
      pruef(hier() === nach, `Flucht: die Crew ist im Nachbarsektor ${nach}`);
    } else {
      zeile(`BOT      die Crew bleibt im Sektor, die Frist ${FD.BEATS.hinterhalt.frist} Taetigkeiten laeuft ab`);
    }
  }
  clearInterval(wache);

  // ---- Ausgang: Frist, dann fuehrt der Rueckfall den Faden zu Ende (hinterhalt > abschluss)
  if (MODUS !== 'fremd') {
    for (let i = 0; i < 600 && f.phase !== 'abgeschlossen'; i++) { await grenze(); if (i % 100 === 99) zeile(`WARTEN   Faden steht bei Beat ${f.beat} (${f.phase}), Zaehler ${f.zaehler}/${f.abstand}`); }
    for (let i = 0; i < 6; i++) await grenze();
    await sleep(400);
  }
  const ged = f.nsc.gedaechtnis.map((e) => e.ereignis);
  const soll = AUSGANG === 'gelungen' ? 'hinterhalt_gelungen' : 'hinterhalt_gescheitert', gegen = AUSGANG === 'gelungen' ? 'hinterhalt_gescheitert' : 'hinterhalt_gelungen';
  if (MODUS === 'fremd') {
    pruef(!ged.some((e) => /^hinterhalt_/.test(e)), `Gedaechtnis ohne Hinterhalt (${ged.join(', ') || '-'})`);
  } else {
    pruef(f.phase === 'abgeschlossen', `Faden abgeschlossen (Phase ${f.phase}, Beat ${f.beat})`);
    pruef(ged.filter((e) => e === soll).length === 1 && !ged.includes(gegen), `Gedaechtnis: genau ${soll}, einmal (${ged.join(', ')})`);
    pruef(verlauf.some((v) => v.includes(`endet`) && v.includes(AUSGANG)), `der Beat hinterhalt endet ${AUSGANG} (${verlauf.join(' > ')})`);
    pruef(!!f.ausgang && ['gelungen', 'gescheitert'].includes(f.ausgang.art), `Ausgang des Fadens: ${f.ausgang && f.ausgang.art}`);
    pruef(!g.fadenSzene && !(g.fadenWarte || []).length && g.space.enemies.length === 0, `nichts bleibt am Ort stehen: keine Szene, keine Warteschlange, keine Gegner (${g.space.enemies.length})`);
    pruef(!f.laufend && HH.halt(g, H) === null && !(g.weltsim.faeden.liste.some((x) => x.laufend && x.laufend.hex)), 'der Sektor des Beats ist weg (laufend, Halt), nichts wartet mehr');
    if (AUSGANG === 'gescheitert' && WIE === 'flucht') pruef(funk.some((t) => t === SZD.texte.szenenwechsel), 'der Funk meldet den Szenenwechsel (Sektor verlassen)');
    if (AUSGANG === 'gelungen') pruef(funk.some((t) => t === SZD.texte.gelungen.hinterhalt), 'der Funk meldet den Sieg (Text aus den Daten)');
    if (AUSGANG === 'gescheitert') pruef(funk.some((t) => t.includes(f.nsc.name)),'der Faden meldet das Ende des Beats (Funk des NSC)');
  }
  pruef(aufrufe() === 0, `Komponisten-Aufrufe ${aufrufe()} (Rueckfall ohne Modell)`);
  pruef(g.errors === 0, `g.errors ${g.errors}`);
  const sek = Math.round((Date.now() - t0) / 100) / 10;
  const ok = abw.length === 0;
  const kurz = `${ok ? 'ok' : 'FEHLER'} ${MODUS}${MODUS === 'fremd' ? '' : ' ' + AUSGANG + (AUSGANG === 'gescheitert' ? ' ' + WIE : '')} crew ${CREW} seed ${SEED}: Hinterhalt-Sektor ${H}, Gegner ${fs0 ? SOLL_GEGNER : 0}; Gedaechtnis ${ged.filter((e) => /^hinterhalt_/.test(e)).join(',') || '-'}; Komponisten-Aufrufe ${aufrufe()}; g.errors ${g.errors}; ${sek} s; kuenstlich ${JSON.stringify(kz)}`;
  if (JSON_DATEI) fs.writeFileSync(JSON_DATEI, JSON.stringify({ modus: MODUS, ausgang: MODUS === 'fremd' ? null : AUSGANG, wie: AUSGANG === 'gescheitert' ? WIE : null, crew: CREW, seed: g.seed, ok, abweichungen: abw, hex: H, start, gegnerImTakt, szene: fs0 ? { art: fs0.art, phase: fs0.phase, sek: fs0.sek, n: fs0.n } : null, soll: SOLL_GEGNER, faden: { phase: f.phase, ausgang: f.ausgang && f.ausgang.art, gedaechtnis: ged, verlauf }, funk, oda, komponistenAufrufe: aufrufe(), errors: g.errors, sekunden: sek, kuenstlich: kz }, null, 1) + '\n', 'utf8');
  for (const x of cl) { try { x.ws.close(); } catch (e) { /* egal */ } }
  if (!ok) for (const z of zeilen.slice(-40)) console.log(z);
  console.log(kurz);
  if (!ok) for (const x of abw) console.log('FEHLER ' + x);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FEHLER: ' + (e && e.stack)); for (const z of zeilen.slice(-30)) console.log(z); process.exit(1); });
