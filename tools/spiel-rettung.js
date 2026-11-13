'use strict';
// BEA-02 D: Bot-Laeufer fuer den Beat rettung am ECHTEN Server (Muster tools/spiel-landung.js: startServer, WebSocket-Clients, Bots, Plan fest eingespeist). Rueckfall ohne Modell
// (FAEDEN=1, REISE_EREIGNISSE=1, LAGE_SPIELLEITER=1, SPIELLEITER_RUECKFALL=1, kein SPIELLEITER_LLM): 0 Komponisten-Aufrufe.
// Der Plan Geruecht -> rettung (Landeplatz schiff, anzahl 3, Besetzung, ende) -> abschluss wird als Angebot eingespeist (Faden.abenteuerAnbieten, Pruefer inklusive; der Plan Notruf > rettung > abschluss entsteht erst in
// BEA-02 C und wird hier NICHT benutzt), die Crew nimmt es ueber den Befehl abenteuer.annehmen an.
// Der Bot geht die echten Wege: Gruppe fliegt zum Hex des Geruechts (Teleport), Ops sitzt an der Konsole weapons und scannt den Ort (weapons.landescan, Halten), die Crew sitzt an der Konsole transfer und waehlt den Landepunkt
// (transfer.ziel, game.chooseLandepunkt), verlaesst die Konsole (leave), steht auf den Pads und beamt per E-Halten (act, selfbeam) runter, wartet kurz und beamt wieder hoch (Crew 1: der einzige Bot, Crew 3: die zwei anderen,
// die Ops bleibt oben). Danach sitzt die Ops an der Konsole weapons und holt die Ueberlebenden einzeln hoch (weapons.person, Halteprozess, Ladungsart person, Betten 0 bis 2). Bei ende abgegeben fliegt die Crew zur Station
// Ostia Nova und die Ops gibt die Personen einzeln ab (weapons.person_ab, Halteprozess).
// Kuenstlich (im Mitschnitt von k(...) gezaehlt): Teleport zum Hex und zur Station, Ort des Schiffs am Beam-Punkt bzw. an der Station, Spieler an Konsole und Pads setzen (der Bot laeuft nicht), im Fall
// --frachtraum-belegt das Erz im Frachtmodul (Fracht.lagerAufnehmen, vor dem Plan). Die Zeit im Faden zaehlt der Lauf selbst ueber lageGrenze (Taetigkeiten), solange die Crew nicht gerade am Boden oder beim Beamen ist
// (die Frist zaehlt Taetigkeiten, am Boden zaehlt keine).
// Gegner am Boden: Die Bots schiessen nicht (keine Bordkanone). Sie bleiben kurz unten (--unten-ms, Standard 1500) und beamen wieder hoch; wer dabei bewusstlos wuerde, wird gemeldet (Lauf rot).
//
//   node tools/spiel-rettung.js --besetzung ruhig|raeuber|belagerer --ende an_bord|abgegeben [--crew 1|3] [--seed N] [--anzahl 1..3] [--frist-lauf | --frachtraum-belegt] [--unten-ms N] [--json datei] [--verlauf]     (npm run spiel:rettung)
//   --json              schreibt die gemessenen Werte (Faden, Gedaechtnis, Verlauf, Personen mit Namen und Betten, Lager, Weltstand, Orte, Aufrufe, Fehler) als Datei: der Test zaehlt selbst nach
//   --frist-lauf        Die Crew bleibt oben: die Frist laeuft ab, Beat scheitert, Verzweigung -> ende, Abschluss, Ort weg (Gedaechtnis rettung_gescheitert)
//   --frachtraum-belegt Erz liegt im einzigen Frachtmodul: Funk-Hinweis beim Start, die Ops kann niemanden hochbeamen, nichts wird geraeumt, der Beat scheitert an der Frist
//   --brett             BEA-02 D, Beispiel 2: statt des eingespeisten Plans der Weg des Bretts (node tools/spiel-rettung.js --brett --variante havarie|piratenueberfall --ort wildnis|schiff [--crew 1|3]): im Takt entsteht ein Katalog-Notruf
//                       der Variante (echter taktUpdate, KUENSTLICH: Katalog auf den einen Eintrag eingeengt, Takt-Zaehler auf die Schwelle, Crew-Hex so gewaehlt, dass der Notruf-Hex die gewuenschte Ort-Art hat, offene Kanten, Ruf rom 30,
//                       keine Flotten), das Brett legt das Angebot mit dem ECHTEN Standardplan aus notruf-brett.json an (nichts eingespeist: kein 'plan-eingespeist' im Mitschnitt), die Crew nimmt per Befehl abenteuer.annehmen an
//                       (Brett.annehmen), fliegt hin (Teleport), die Rettung entsteht (der Rueckfall fuehrt den Faden), danach wie sonst: scannen, Landepunkt, runter, Ueberlebende per Ops, hoch, Station, abgeben. Besetzung folgt der
//                       Variante (havarie ruhig, piratenueberfall raeuber), Ende ist immer abgegeben. Am Ende greift ein Wiedersehen den NSC auf (Gedaechtnis rettung_gelungen).
//   Exit 0: Soll erfuellt; Exit 1: Abweichung; Exit 2: falscher Aufruf.   Ausgabe knapp: Faden-Verlauf, Personen, Komponisten-Aufrufe, g.errors, Orte vorher/nachher.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const args = process.argv.slice(2);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined && !String(args[i + 1]).startsWith('--') ? args[i + 1] : undefined; };
const hat = (n) => args.includes('--' + n);
const BRETT = hat('brett');   // BEA-02 D (Beispiel 2): statt des eingespeisten Plans der Weg des Bretts (Takt-Notruf, Standardplan aus notruf-brett.json, Annehmen am Brett)
const KETTE = hat('kette');   // BEA-02 D (d): Plan notruf > landung > rettung > abschluss EINGESPEIST, ein Landeplatz fuer beide (der Standardplan des Bretts nutzt landung nicht); die Crew steigt zweimal ab
const VARIANTE = wert('variante') || 'havarie';
const ORT_ART = wert('ort') || 'wildnis';
const BES = BRETT ? { havarie: 'ruhig', piratenueberfall: 'raeuber' }[VARIANTE] : wert('besetzung');   // mit --brett folgt die Besetzung der Variante (notruf-brett.json besetzung_je_variante), nicht dem Aufruf
const ENDE = BRETT ? 'abgegeben' : wert('ende');   // der Standardplan des Bretts endet mit Abgabe an einer Station
const CREW = Number(wert('crew') || 1);
const SEED = Number(wert('seed') || 7);
const ANZAHL = Number(wert('anzahl') || 3);
const UNTEN_MS = Number(wert('unten-ms') || 1500);
const FRIST_LAUF = hat('frist-lauf');
const BELEGT = hat('frachtraum-belegt');
const JSON_DATEI = wert('json');
if (!['ruhig', 'raeuber', 'belagerer'].includes(BES) || !['an_bord', 'abgegeben'].includes(ENDE) || ![1, 3].includes(CREW) || ![1, 2, 3].includes(ANZAHL) || !Number.isFinite(SEED) || !Number.isFinite(UNTEN_MS) || (FRIST_LAUF && BELEGT) || (KETTE && (BRETT || FRIST_LAUF || BELEGT || ENDE !== 'abgegeben' || ANZAHL !== 3)) || (BRETT &&(!['havarie', 'piratenueberfall'].includes(VARIANTE) || !['wildnis', 'schiff'].includes(ORT_ART) || ANZAHL !== 3 || FRIST_LAUF || BELEGT || hat('besetzung') || hat('ende')))) {
  console.error('Aufruf: node tools/spiel-rettung.js --besetzung ruhig|raeuber|belagerer --ende an_bord|abgegeben [--crew 1|3] [--seed N] [--anzahl 1..3] [--frist-lauf | --frachtraum-belegt] [--unten-ms N] [--verlauf]');
  console.error('   oder: node tools/spiel-rettung.js --kette --besetzung ruhig|raeuber|belagerer --ende abgegeben [--crew 1|3] [--seed N]   (Plan notruf > landung > rettung > abschluss eingespeist)');
  console.error('   oder: node tools/spiel-rettung.js --brett --variante havarie|piratenueberfall --ort wildnis|schiff [--crew 1|3] [--seed N] [--unten-ms N] [--json datei] [--verlauf]   (Standardplan des Bretts, Besetzung und Ende folgen den Daten)');
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
const Fracht = require('../server/sim/fracht.js');
const PB = require('../server/sim/personen-bord.js');
const Space = require('../server/sim/space.js');
const Weltstand = require('../server/weltstand.js');
const Locations = require('../shared/locations.js');
const interior = require('../server/sim/interior.js');
const Sektoren = require('../shared/sektoren.js');
const Bot = require('./lib/bot-crew.js');
const RE = require('../server/sim/reise-ereignis.js');
const Ruf = require('../server/sim/ruf.js');
const P = require('../server/sim/faden-pruefer.js');
const Bauplan = require('../server/sim/faden-bauplan.js');

const CODE = 'RETT';
const STATION = 'ostia_nova';
const NAMEN = ['Ada', 'Bo', 'Cem'].slice(0, CREW);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
const zeile = (s) => { const t = new Date().toISOString().slice(11, 19); zeilen.push(`${t}  ${s}`); if (hat('verlauf')) console.log(`${t}  ${s}`); };
const kz = {};
const k = (...arten) => { for (const a of arten) kz[a] = (kz[a] || 0) + 1; };

const plan = () => ({
  format: 'faden-bauplan/1', titel: 'Schiffbruch im Sektor', anlass: 'Ein Geruecht spricht von Schiffbruechigen, niemand weiss wo.',
  landeplaetze: [{ id: 'absturz', art: 'schiff', besitz: 'herrenlos', name: 'Absturzstelle' }],
  beats: [{ typ: 'geruecht' }, { typ: 'rettung', parameter: { landeplatz: 'absturz', anzahl: ANZAHL, besetzung: BES, ende: ENDE }, verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }],
});

const planKette = () => ({
  format: 'faden-bauplan/1', titel: 'Schiffbruch mit Landung', anlass: 'Ein Notruf meldet Schiffbruechige, die Crew soll landen und sie bergen.',
  landeplaetze: [{ id: 'absturz', art: 'schiff', besitz: 'herrenlos', name: 'Absturzstelle' }],
  beats: [{ typ: 'notruf', verzweigung: { gescheitert: 'ende' } }, { typ: 'landung', parameter: { landeplatz: 'absturz', besetzung: BES }, verzweigung: { gescheitert: 'ende' } },
    { typ: 'rettung', parameter: { landeplatz: 'absturz', anzahl: ANZAHL, besetzung: BES, ende: ENDE }, verzweigung: { gescheitert: 'ende' } }, { id: 'ende', typ: 'abschluss' }],
});

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiel-rettung-'));
  const srv = await startServer({ port: 0, quiet: true, noStore: true, worlds: true, worldDir: dir, roomCode: CODE });
  const g = srv.game, port = srv.port;
  g.fixedSeed = SEED; g.reset();
  const t0 = Date.now();
  const abw = [];
  const pruef = (c, t) => { zeile(`${c ? 'ok     ' : 'FEHLER '} ${t}`); if (!c) abw.push(t); };
  const sl = () => g.lageSpielleiter;
  const aufrufe = () => (sl() ? (sl().aufrufe || 0) + ((sl().abenteuer && sl().abenteuer.aufrufe) || 0) : 0);
  const modus = FRIST_LAUF ? ', Frist-Lauf (Crew bleibt oben)' : BELEGT ? ', Frachtraum belegt (Erz)' : '';
  zeile(`Server auf Port ${port}, Seed ${g.seed}, Besetzung ${BES}, Ende ${ENDE}, Crew ${CREW}, Ueberlebende ${ANZAHL}${modus}; Rueckfall ohne Modell (Lage-Spielleiter ${sl() ? 'Modus ' + sl().mode : 'fehlt'})`);
  const cl = [];
  for (let i = 0; i < CREW; i++) cl.push(await Bot.client(WebSocket, port, CODE, { clientId: 'ABC'[i], name: NAMEN[i], color: i }, NAMEN[i], NAMEN));
  await sleep(300);
  cl[0].send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of cl) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  const w = Bot.werkzeug({ g, cl, zeile: (s) => zeile(`BOT      ${s}`), k });
  pruef(!!sl() && require('../server/sim/lage-spielleiter.js').rueckfallAn(g.env), `Rueckfall-Betrieb ohne Modell (Lage-Spielleiter ist da: ${!!sl()}, rueckfallAn)`);
  zeile(`Crew im Spiel: ${g.players.filter((p) => p.connected).length} verbunden, Phase ${g.phase}`);

  // ---- Beobachtung: Funk, Hinweise, Faden-Verlauf aus dem Logbuch der Regie, Ereignisse am Boden und an Bord
  const funk = [];
  const emit0 = g.emit.bind(g); g.emit = (...a) => { if (a[0] === 'radio' && a[1]) { funk.push(String(a[1].text)); zeile(`FUNK     ${String(a[1].from || '?').padEnd(16)} ${a[1].text}`); } return emit0(...a); };
  const me0 = g.missionEvent.bind(g); const boden = [];
  const BEOB = ['beamedDown', 'beamedUp', 'npcRescued', 'personAnBord', 'personAbgegeben', 'notsprung'];
  g.missionEvent = (kk, d) => { if (BEOB.includes(kk)) { boden.push({ k: kk, map: d && d.map, person: d && d.person, n: d && d.players ? d.players.length : 0, notrueckholung: !!(d && d.notrueckholung) }); zeile(`EREIGNIS ${kk} ${d && d.map ? d.map : ''} ${d && d.person ? d.person : ''} ${d && d.players ? d.players.length + ' Spieler' : ''}${d && d.notrueckholung ? ' Notrueckholung' : ''}`); } return me0(kk, d); };
  const hinweise = [];
  if (typeof g.notice === 'function') { const n0 = g.notice.bind(g); g.notice = (pp, t2, ...r) => { hinweise.push(String(t2)); zeile('HINWEIS  ' + t2); return n0(pp, t2, ...r); }; }
  const logbuch = () => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
  const beobachtet = new Set(); const verlauf = [];
  const sync = () => { for (const e of logbuch()) if (!beobachtet.has(e)) { beobachtet.add(e); if (e.art === 'faden_ereignis' && (e.ausgang === 'beat_start' || e.ausgang === 'beat_ende')) { const t = `${e.ausgang === 'beat_start' ? 'beginnt' : 'endet'} ${e.plan && e.plan.beat}${e.ausgang === 'beat_ende' && e.begruendung ? ' (' + String(e.begruendung).slice(0, 60) + ')' : ''}`; zeile(`BEAT     ${t}`); verlauf.push(t); } else if (e.art === 'faden_baustein' && e.key === 'rettung') zeile(`BAUSTEIN ${e.ausgang}: ${String(e.begruendung).slice(0, 120)}`); } };
  const orte = () => ({ dyn: Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).filter((i) => AO.parse(i)), scan: Array.from((g.explore && g.explore.lpScan) || []).filter((i) => AO.parse(i)), aways: Object.keys(g.aways || {}).filter((i) => AO.parse(i)), awayMap: g.away && AO.parse(g.away.map) ? g.away.map : null });
  const zahlOrte = (o) => o.dyn.length + o.scan.length + o.aways.length + (o.awayMap ? 1 : 0);
  const orteVor = orte();
  const grenze = async () => { g.lageGrenze('szene_ende'); sync(); await sleep(80); };   // zaehlt EINE Taetigkeit (Frist, Abstand der Beats); der Rueckfall-Spielleiter startet an der Grenze den faelligen Beat
  const wartenAuf = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; sync(); await sleep(60); } return !!fn(); };
  const typ = (f) => { const v = FD.vorlage(f.vorlage); return v && v.beats[f.beat] && v.beats[f.beat].typ; };
  const lager = () => Fracht.state(g).lager;
  const personen = () => PB.personenAnBord(g).map((q) => ({ id: q.id, name: q.name, bett: q.bett }));

  // ---- kuenstlich: Erz im einzigen Frachtmodul (vor dem Plan: der Beat prueft den Frachtraum beim Start)
  if (BELEGT) { k('erz-setzen'); const r = Fracht.lagerAufnehmen(g, { art: 'erz', quelle: 'skript' }); if (!r.ok) throw new Error('Erz liess sich nicht einlagern'); zeile('KUENSTL  Erz im Frachtmodul (Fracht.lagerAufnehmen)'); }
  const lagerVorher = JSON.stringify(lager());

  // ---- Angebot einspeisen (Plan Geruecht > rettung > abschluss) oder, mit --brett, der Weg des Bretts; die Crew nimmt an
  let f, ziel, ok1, brettInfo = null;
  if (BRETT) {
    // Beispiel 2: im Takt entsteht ein Katalog-Notruf (echter taktUpdate). KUENSTLICH, im Mitschnitt gezaehlt: der Katalog der Notrufe ist auf EINEN Eintrag der Variante eingeengt (nie mehr als ein Eintrag, keine Ruecknahme noetig:
    // der Prozess lebt nur fuer diesen Lauf), der Crew-Hex wird so gewaehlt, dass der vorhergesagte Notruf-Hex die gewuenschte Ort-Art hat (taktNotruf rechnet ohne Verbrauch), offene Kanten rund um den Crew-Hex, Ruf rom 30,
    // keine Flotten der Sim, der Takt-Zaehler steht auf der Schwelle (statt 300 s Spielzeit zu warten). Das Angebot legt dann das Brett selbst an (notrufAnbieten, Plan aus content/faeden/notruf-brett.json).
    const R = g.weltsim.reise, F = Faden.zustandVon(g);
    const kat = RE.KATALOG, kopie = kat.slice();
    const eintraege = kopie.filter((e) => e.art === 'notruf' && (e.parameter || {}).variante === VARIANTE);
    const arten = (h) => AO.moeglicheArten(h);
    const ortPasst = (h) => (ORT_ART === 'wildnis' ? arten(h).includes('wildnis') : arten(h).includes('schiff') && !arten(h).includes('wildnis'));
    const startHexe = Object.keys(Sektoren.KARTE.hexe).filter((h) => Sektoren.spielbar(h) && !Sektoren.istLeerraum(h) && Sektoren.hatSzene(h)).sort();
    const oeffneKanten = (hex) => { for (const e of Sektoren.kantenVon(hex)) { if (e.art === 'locked') g.explore.offenExtra.add(Sektoren.kanteId(e.a, e.b)); else if (e.art === 'hidden' && e.key) g.explore.linksOpen.add(e.key); } };
    k('ruf-setzen', 'flotten-leeren'); Ruf.debug(g, ['rom', '30']); g.weltsim.zustand.flotten = [];
    const szene0 = g.ship.scene; let fund = null;
    for (const e of eintraege) {
      for (const h of startHexe) {
        g.ship.scene = Sektoren.ortVonHex(h); R.offen = []; R.taktIds = []; oeffneKanten(h);
        kat.length = 0; kat.push(e);
        let ev = null; try { ev = RE.taktNotruf(g); } finally { kat.length = 0; kat.push(...kopie); }
        if (ev && ev.id === e.id && ortPasst(ev.hex)) { fund = { e, h, ev }; break; }
      }
      if (fund) break;
    }
    g.ship.scene = szene0;
    if (!fund) throw new Error(`kein Notruf der Variante ${VARIANTE} mit Ort-Art ${ORT_ART} gefunden`);
    zeile(`KUENSTL  Notruf ${fund.e.id} (${VARIANTE}) erzwungen: Crew in ${fund.h}, Notruf-Hex ${fund.ev.hex} (Arten ${arten(fund.ev.hex).join('/')}), Katalog auf den einen Eintrag, Takt-Zaehler auf der Schwelle`);
    k('katalog-einengen', 'takt-schwelle', 'kanten-oeffnen');
    w.flieg(fund.h); await sleep(200);
    kat.length = 0; kat.push(fund.e);
    R.offen = []; R.taktIds = []; R.takt = Math.max(1, Math.round(Number(RE.WERTE.takt_s) * g.C.tickHz)) - 1;
    await wartenAuf(() => R.offen.length >= 1, 10000);
    const o = R.offen[0];
    pruef(!!o && o.id === fund.e.id && o.hex === fund.ev.hex && o.takt === true, `der Takt hat den Notruf ausgeloest (${o ? o.id + ' bei ' + o.hex : 'keiner'}), nicht von Hand angelegt`);
    if (!o) throw new Error('im Takt entstand kein Notruf (Phase ' + g.phase + ', ruhig ' + require('../server/sim/funk-antwort.js').ruhig(g) + ')');
    const a = P.notrufAngebote(F).find((x) => x.notruf.marke === o.marke);
    pruef(!!a, `das Brett hat das Angebot angelegt (${a ? 'a' + a.nr + ', Variante ' + a.variante + ', Absicht ' + (a.absicht && a.absicht.absicht) : 'keines'})`);
    if (!a) throw new Error('kein Brett-Angebot zum Notruf');
    const vl = a.vorlage, rb = vl.beats.find((b) => b.typ === 'rettung');
    brettInfo = { katalogId: o.id, variante: a.variante, crewHex: fund.h, notrufHex: o.hex, artenImHex: arten(o.hex), plan: vl.beats.map((b) => b.typ).join(','), landeplatzArt: vl.landeplaetze && vl.landeplaetze[0] && vl.landeplaetze[0].art, besetzungAmBeat: rb && rb.parameter.besetzung, endeAmBeat: rb && rb.parameter.ende, absicht: a.absicht && a.absicht.absicht, textKey: vl.beats[0].parameter.text_key };
    zeile(`ANGEBOT  a${a.nr}: Plan ${brettInfo.plan}, Landeplatz ${brettInfo.landeplatzArt}, Besetzung ${brettInfo.besetzungAmBeat}, ende ${brettInfo.endeAmBeat}, Absicht ${brettInfo.absicht}`);
    const id = 'a' + a.nr;
    await wartenAuf(() => cl.every((c) => ((c.abenteuer && c.abenteuer.angebote) || []).some((x) => x.id === id)), 4000);
    pruef(cl.every((c) => ((c.abenteuer && c.abenteuer.angebote) || []).some((x) => x.id === id)), 'das Angebot steht im Snapshot aller Clients (Brett)');
    cl[0].send({ t: 'cmd', c: 'abenteuer.annehmen', id });
    f = await (async () => { for (let i = 0; i < 60; i++) { const x = g.weltsim.faeden.liste.find((q) => q.vorlage === a.ref); if (x) return x; await sleep(100); } return null; })();
    if (!f) throw new Error('Abenteuer nicht geoeffnet');
    zeile(`FADEN    ${f.id} (${f.vorlage}) angenommen, Beats ${FD.vorlage(f.vorlage).beats.map((b) => b.typ).join(' > ')}, NSC ${f.nsc.name}; Phase ${f.phase}, Beat ${typ(f)}`);
    ziel = f.parameter.ort;
    pruef(ziel === o.hex && f.phase === 'laeuft' && typ(f) === 'notruf', `Annehmen startet den Beat notruf am Hex des Notrufs (${ziel}, Phase ${f.phase})`);
    zeile(`CREW     fliegt zum Notruf-Hex ${Sektoren.hexName(ziel) || ziel} (${ziel}, Teleport)`);
    w.flieg(ziel); await sleep(300);
  } else {
  zeile(`CREW     in ${w.hierHex()}; der Plan Geruecht > rettung (Besetzung ${BES}, Ende ${ENDE}, ${ANZAHL} Ueberlebende, Landeplatz schiff) > abschluss wird als Angebot eingespeist (kuenstlich: kein Komponist)`);
  k('plan-eingespeist');
  // Der Hex der Kette ist fest (Wrack im Raum moeglich, Szene da): am Beam-Punkt von Carrara (0105) nahm die Lerche im Lauf Schaden (Systeme gingen schrittweise auf damaged/broken, Transfer kaputt, kein Beamen; Seed 7 und 11), 0503 ist ruhig
  const kettenHex = KETTE ? '0503' : null;
  if (KETTE && !(Sektoren.spielbar(kettenHex) && Sektoren.hatSzene(kettenHex) && AO.moeglicheArten(kettenHex).includes('schiff') && kettenHex !== w.hierHex())) throw new Error('Hex der Kette ' + kettenHex + ' taugt nicht (Wrack/Szene)');
  const a = Faden.abenteuerAnbieten(g, KETTE ? planKette() : plan(), { hex: KETTE ? kettenHex : w.hierHex() });
  if (!a.ok) throw new Error('Angebot abgelehnt: ' + (a.fehler || [a.grund]).join('; '));
  const id = 'a' + a.angebot.nr;
  await wartenAuf(() => cl.every((c) => ((c.abenteuer && c.abenteuer.angebote) || []).some((x) => x.id === id)), 4000);
  cl[0].send({ t: 'cmd', c: 'abenteuer.annehmen', id });
  f = await (async () => { for (let i = 0; i < 60; i++) { const x = g.weltsim.faeden.liste.find((q) => q.vorlage === a.angebot.ref); if (x) return x; await sleep(100); } return null; })();
  if (!f) throw new Error('Abenteuer nicht geoeffnet');
  zeile(`FADEN    ${f.id} (${f.vorlage}) geoeffnet, Beats ${FD.vorlage(f.vorlage).beats.map((b) => b.typ).join(' > ')}, NSC ${f.nsc.name}`);

  // ---- Geruecht: der Rueckfall-Spielleiter startet den Beat; die Crew fliegt zum genannten Hex
  const erster = KETTE ? 'notruf' : 'geruecht';
  ok1 = await (async () => { for (let i = 0; i < 300 && !(f.phase === 'laeuft' && typ(f) === erster); i++) { await grenze(); if (f.phase === 'abgeschlossen') return false; } return f.phase === 'laeuft' && typ(f) === erster; })();
  if (!ok1) throw new Error(`${erster} startet nicht (Phase ${f.phase}, Beat ${f.beat})`);
  ziel = f.parameter.ort;
  zeile(`${KETTE ? 'NOTRUF  ' : 'GERUECHT'} der ${KETTE ? 'Notruf' : 'Hafenfunk'} nennt ${Sektoren.hexName(ziel) || ziel} (${ziel}); die Crew fliegt hin`);
  w.flieg(ziel); await sleep(300);
  }
  const startTyp = KETTE ? 'landung' : 'rettung';   // die Kette beginnt am Boden mit der Landung, die Rettung folgt nach dem ersten Hochbeamen
  const beatStartet = async (t) => { for (let i = 0; i < 300 && !(f.phase === 'laeuft' && typ(f) === t); i++) { await grenze(); if (f.phase === 'abgeschlossen') return false; } return f.phase === 'laeuft' && typ(f) === t; };
  ok1 = await beatStartet(startTyp);
  if (!ok1) throw new Error(`${startTyp} startet nicht (Phase ${f.phase}, Beat ${f.beat})`);
  const lpId = Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).find((i) => { const m = AO.parse(i); return m && m.faden === f.id; });
  pruef(!!lpId, `der Ort ist bestellt (${lpId || 'keiner'}), Beat ${startTyp} laeuft`);
  const lpDyn = (g.landepunkte && g.landepunkte.dyn && g.landepunkte.dyn[lpId]) || {};
  if (BRETT) pruef(lpDyn.art === ORT_ART && lpDyn.art === brettInfo.landeplatzArt, `die Ort-Art folgt dem Hex ${ziel} (Arten ${brettInfo.artenImHex.join('/')}): bestellt ${brettInfo.landeplatzArt}, entstanden ${lpDyn.art}, Soll ${ORT_ART}`);
  const orteWaehrend = orte();
  pruef(zahlOrte(orteWaehrend) >= 1, `der Ort steht im Lauf (dyn ${orteWaehrend.dyn.length}, lpScan ${orteWaehrend.scan.length}, aways ${orteWaehrend.aways.length})`);
  if (!KETTE) await wartenAuf(() => !!g.aways[lpId] && require('../server/sim/away.js').offenePersonen(g.aways[lpId]).length > 0, 4000);
  const am = () => { const aw = g.aways[lpId]; return aw ? require('../server/sim/away.js').offenePersonen(aw).filter((n) => n.person) : []; };
  let amOrtStart = KETTE ? 0 : am().length;
  if (!KETTE) pruef(amOrtStart === ANZAHL, `${amOrtStart} Ueberlebende stehen am Ort (Soll ${ANZAHL})`);
  else pruef(am().length === 0, 'waehrend der Landung stehen noch keine Ueberlebenden am Ort (die Rettung setzt sie erst)');
  let gegner = 0, gegnerArten = '';
  const zaehleGegner = () => { const aw = g.aways[lpId]; gegner = aw ? (aw.drones || []).length : 0; gegnerArten = aw ? Array.from(new Set((aw.drones || []).map((d) => d.kind || d.rolle || '?'))).join(',') : ''; return gegner; };
  zaehleGegner();

  let unten = [];
  let beamPunkt = null;
  let personenAnBordMax = [];
  const halteSek = [];
  const abgegebenIds = [];
  let weltFracht = null;
  let aufnehmenFehler = null;
  let fruehEnde = false;
  const kette = {};   // nur mit --kette: gegnerLandung, landungGelungen, selberOrt
  if (FRIST_LAUF) {
    zeile(`CREW     bleibt oben; Frist ${FD.BEATS.rettung.frist} Taetigkeiten laufen ab`);
    await sleep(300);
  } else {
    // ---- Ops scannt den Ort (echter Befehl weapons.landescan, Halten): das Schiff steht am Beam-Punkt
    await wartenAuf(() => !!LP.info(g, lpId), 8000);
    const info = LP.info(g, lpId);
    if (!info || !info.beam) throw new Error('Landepunkt ohne Beam-Punkt: ' + lpId);
    beamPunkt = { x: info.beam.x + 20, y: info.beam.y };
    let ort = beamPunkt, stehtSchon = false;
    const stehen = () => { if (!stehtSchon) { stehtSchon = true; k('ort-setzen'); } const s = g.ship; s.docked = false; s.dockedAt = null; s.x = ort.x; s.y = ort.y; s.vx = 0; s.vy = 0; s.speed = 0; if (s.helm) { s.helm.thrust = 0; s.helm.turn = 0; } };
    stehen();
    await w.konsole('weapons');
    cl[0].send({ t: 'cmd', c: 'weapons.landescan' });
    const gescannt = await wartenAuf(() => { stehen(); return Lpscan.gescannt(g, lpId); }, 15000);
    zeile(`OPS      weapons.landescan: Ort gescannt ${gescannt}`);
    pruef(gescannt, 'der Ort ist gescannt (Ops, weapons.landescan)');
    // ---- Transfer-Konsole: Landepunkt waehlen (transfer.ziel), Konsole verlassen
    cl[0].send({ t: 'leave' }); await sleep(250);
    await w.konsole('transfer');
    cl[0].send({ t: 'cmd', c: 'transfer.ziel', landepunkt: lpId });
    await wartenAuf(() => g.away && g.away.map === lpId, 3000);
    pruef(g.away && g.away.map === lpId && g.transferZiel && g.transferZiel.lp === lpId, `Landepunkt gewaehlt (transfer.ziel): away.map ${g.away && g.away.map}`);
    cl[0].send({ t: 'leave' }); await sleep(250);

    // ---- Pads: Crew 1 der einzige Bot, Crew 3 die zwei anderen (die Ops bleibt oben), E halten (selfbeam), alle auf Pads beamen zusammen
    const mannschaft = CREW === 1 ? [g.players[0]] : g.players.slice(1, 3);
    const halte = async (richtung, zone) => {
      for (const p of mannschaft) cl[g.players.indexOf(p)].send({ t: 'act', down: true });
      const da = await wartenAuf(() => { stehen(); return mannschaft.every((p) => p.zone === zone); }, 15000);
      for (const p of mannschaft) cl[g.players.indexOf(p)].send({ t: 'act', down: false });
      zeile(`BOT      ${richtung}: ${mannschaft.map((p) => p.name + ' ' + p.zone).join(', ')} (E halten, selfbeam)`);
      return da;
    };
    if (KETTE) {
      // ---- erster Abstieg: die Landung (der Beat landung endet beim ersten Hochbeamen gelungen), danach setzt die Rettung am selben Ort ihre Ueberlebenden
      k('spieler-setzen');
      mannschaft.forEach((p, i) => interior.placeOnShipPad(g, p, i));
      stehen(); await sleep(200);
      const runter1 = await halte('runter (Landung)', 'away');
      pruef(runter1, `Landung: Crew unten (${mannschaft.length} von ${CREW} Bots, away.map ${g.away && g.away.map})`);
      zaehleGegner();
      zeile(`BODEN    ${gegner} Gegner am Ort (${gegnerArten || '-'}), Besetzung ${BES} aus der Landung; die Bots schiessen nicht, warten ${UNTEN_MS} ms`);
      kette.gegnerLandung = gegner;
      await sleep(UNTEN_MS);
      const bewusstlos1 = mannschaft.filter((p) => p.downed);
      pruef(bewusstlos1.length === 0 && f.phase === 'laeuft' && typ(f) === 'landung', `Landung: niemand bewusstlos, der Beat landung laeuft, solange die Crew unten ist (Phase ${f.phase}, Beat ${typ(f)})`);
      if (bewusstlos1.length) fruehEnde = true;
      else {
        const hoch1 = await halte('hoch (Landung)', 'ship');
        pruef(hoch1, 'Landung: Crew wieder oben');
        const gedLandung = await wartenAuf(() => f.nsc.gedaechtnis.some((e) => e.ereignis === 'landung_gelungen'), 6000);
        pruef(gedLandung, 'der Beat landung endet beim ersten Hochbeamen gelungen (Gedaechtnis landung_gelungen)');
        kette.landungGelungen = gedLandung;
        ok1 = await beatStartet('rettung');
        pruef(ok1, `danach startet die Rettung (Beat ${typ(f)}, Phase ${f.phase})`);
        const lpId2 = Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).find((i) => { const m = AO.parse(i); return m && m.faden === f.id; });
        pruef(lpId2 === lpId, `die Rettung arbeitet am selben Ort (${lpId2})`);
        kette.selberOrt = lpId2 === lpId;
        await wartenAuf(() => am().length > 0, 4000);
        amOrtStart = am().length;
        pruef(amOrtStart === ANZAHL, `${amOrtStart} Ueberlebende stehen nach dem Start der Rettung am Ort (Soll ${ANZAHL})`);
        // zweiter Abstieg: der Landepunkt ist neu zu waehlen, falls er mit dem Ende der Landung zurueckgesetzt wurde
        if (!(g.away && g.away.map === lpId && g.transferZiel && g.transferZiel.lp === lpId)) {
          await w.konsole('transfer');
          cl[0].send({ t: 'cmd', c: 'transfer.ziel', landepunkt: lpId });
          await wartenAuf(() => g.away && g.away.map === lpId, 3000);
          pruef(g.away && g.away.map === lpId, `Landepunkt fuer den zweiten Abstieg gewaehlt (away.map ${g.away && g.away.map})`);
          cl[0].send({ t: 'leave' }); await sleep(250);
        }
        k('spieler-setzen'); mannschaft.forEach((p, i) => interior.placeOnShipPad(g, p, i)); stehen(); await sleep(200);
      }
    }
    if (!BELEGT && !fruehEnde) {
      if (!KETTE) { k('spieler-setzen'); mannschaft.forEach((p, i) => interior.placeOnShipPad(g, p, i)); stehen(); await sleep(200); }
      const runter = await halte('runter', 'away');
      pruef(runter, `Crew unten (${mannschaft.length} von ${CREW} Bots, away.map ${g.away && g.away.map})`);
      unten = mannschaft;
      zaehleGegner();
      zeile(`BODEN    ${gegner} Gegner am Ort (${gegnerArten || '-'}), Besetzung ${BES}, ${am().length} Ueberlebende; die Bots schiessen nicht, warten ${UNTEN_MS} ms`);
      await sleep(UNTEN_MS);
      const bewusstlos = mannschaft.filter((p) => p.downed);
      pruef(bewusstlos.length === 0, `niemand bewusstlos beim Warten (${bewusstlos.map((p) => p.name).join(',') || '-'})`);
      pruef(f.phase === 'laeuft', `der Beat laeuft, solange die Crew unten ist (Phase ${f.phase})`);
      pruef(am().length === ANZAHL, `die Ueberlebenden stehen noch am Ort (${am().length} von ${ANZAHL}, noch keiner gerettet)`);
      if (bewusstlos.length) fruehEnde = true;
      else {
        const hoch = await halte('hoch', 'ship');
        pruef(hoch, 'Crew wieder oben');
        const geholt = mannschaft.filter((p) => p.zone === 'away');
        if (geholt.length) fruehEnde = true;
      }
    }

    if (!fruehEnde) {
      // ---- Ops: Konsole weapons, die Ueberlebenden einzeln hochholen (Halteprozess); Schiff bleibt am Beam-Punkt
      await w.konsole('weapons');
      stehen();
      const dauer = g.C.ship.beamTime;
      const bamt = () => { const s = Fracht.state(g); return s.halt ? s.halt.kind + ':' + s.halt.id : null; };
      if (BELEGT) {
        const grund = PB.aufnehmenGrund(g, null);
        zeile(`OPS      Frachtraum belegt: aufnehmenGrund "${grund}"`);
        cl[0].send({ t: 'cmd', c: 'weapons.person' }); await sleep(600);
        aufnehmenFehler = grund;
        pruef(typeof grund === 'string' && /Kein Bett frei/.test(grund), `Beamen wird abgelehnt (Bordanzeige: ${String(grund).slice(0, 60)})`);
        pruef(!bamt(), 'kein Halteprozess gestartet');
        pruef(PB.personenAnBord(g).length === 0 && JSON.stringify(lager()) === lagerVorher, 'nichts geraeumt, nichts aufgenommen: das Erz liegt unveraendert im Lager');
        pruef(am().length === ANZAHL, `die Ueberlebenden stehen weiter am Ort (${am().length})`);
        pruef(f.phase === 'laeuft', 'der Beat wartet (noch keine Frist)');
      } else {
        for (let i = 0; i < ANZAHL; i++) {
          const vor = PB.personenAnBord(g).length;
          const ts = Date.now();
          cl[0].send({ t: 'cmd', c: 'weapons.person' });
          await sleep(250); stehen();
          const laeuft = bamt();
          pruef(!!laeuft && /^person_an:/.test(laeuft), `Aufnahme ${i + 1}: Halteprozess laeuft (${laeuft}, ${dauer} s)`);
          const da = await wartenAuf(() => { stehen(); return PB.personenAnBord(g).length > vor; }, 20000);
          halteSek.push(Math.round((Date.now() - ts) / 100) / 10);
          pruef(da, `Aufnahme ${i + 1}: Person im Frachtraum (${personen().map((q) => q.name + '/Bett ' + q.bett).join(', ')}, ${halteSek[halteSek.length - 1]} s)`);
          if (!da) break;
          await sleep(150);
        }
        personenAnBordMax = personen();
        if (ENDE === 'an_bord') pruef(personenAnBordMax.length === ANZAHL, `alle ${ANZAHL} an Bord (${personenAnBordMax.length})`);
        else pruef(personenAnBordMax.length === ANZAHL && f.phase === 'laeuft', `alle ${ANZAHL} an Bord, ende abgegeben: der Beat laeuft noch (Phase ${f.phase})`);
        if (ENDE === 'abgegeben') {
          // ---- zur Station Ostia Nova (Teleport wie flieg), Andocken zaehlt eine Taetigkeit (Flug), die Ops gibt eine Person nach der anderen ab
          const st = Locations.get(STATION).scene.station;
          k('teleport'); Space.enterScene(g, STATION, {}); g.explore.location = STATION;
          ort = { x: st.x + 40, y: st.y }; stehen();
          zeile(`BOT      Flug zur Station ${STATION} (Teleport), Schiff an der Station`);
          await sleep(300); await grenze();
          await w.konsole('weapons');
          stehen();
          pruef(f.phase === 'laeuft', `an der Station angekommen: noch nichts abgegeben, der Beat laeuft (Phase ${f.phase})`);
          for (const p of personenAnBordMax) {
            cl[0].send({ t: 'cmd', c: 'weapons.person_ab', id: p.id });
            await sleep(250); stehen();
            const laeuft = bamt();
            pruef(!!laeuft && /^person_ab:/.test(laeuft), `Abgabe ${p.name}: Halteprozess laeuft (${laeuft})`);
            const weg = await wartenAuf(() => { stehen(); return !PB.personAnBord(g, p.id); }, 20000);
            pruef(weg, `Abgabe ${p.name}: nicht mehr im Frachtraum`);
            if (weg) abgegebenIds.push(p.id); else break;
            if (abgegebenIds.length < personenAnBordMax.length) pruef(f.phase === 'laeuft', `Abgabe ${p.name}: der Beat laeuft weiter, bis alle abgegeben sind (Phase ${f.phase})`);
            await sleep(150);
          }
        }
      }
    }
  }

  // ---- Ausgang: der Rueckfall fuehrt den Faden zu Ende (rettung gelungen > Abschluss; Frist-Lauf und belegter Frachtraum: Frist > gescheitert > Verzweigung ende > Abschluss)
  const sollScheitern = FRIST_LAUF || BELEGT;
  for (let i = 0; i < 600 && f.phase !== 'abgeschlossen'; i++) { await grenze(); if (i % 100 === 99) zeile(`WARTEN   Faden steht bei Beat ${f.beat} (${f.phase}), Zaehler ${f.zaehler}/${f.abstand}`); }
  for (let i = 0; i < 12; i++) { await grenze(); }
  await sleep(500);
  try { const ws = JSON.parse(JSON.stringify(Weltstand.capture(g))); weltFracht = (ws.schiff && ws.schiff.fracht) || []; } catch (e) { zeile('Weltstand nicht lesbar: ' + (e && e.message)); }
  const ged = f.nsc.gedaechtnis.map((e) => e.ereignis);
  const orteNach = orte();
  const personNachher = lager().filter((l) => l.art === 'person').length;
  pruef(f.phase === 'abgeschlossen', `Faden abgeschlossen (Phase ${f.phase}, Beat ${f.beat})`);
  pruef(sollScheitern ? (!!f.ausgang && ['gelungen', 'gescheitert'].includes(f.ausgang.art)) : (!!f.ausgang && f.ausgang.art === 'gelungen'), `Ausgang des Fadens ${sollScheitern ? '(Abschluss nach Verzweigung)' : 'gelungen'}: ${f.ausgang && f.ausgang.art}`);
  pruef(sollScheitern ? (ged.includes('rettung_gescheitert') && !ged.includes('rettung_gelungen')) : (ged.includes('rettung_gelungen') && !ged.includes('rettung_gescheitert')), `Gedaechtnis: ${ged.join(', ')}`);
  const downs = boden.filter((e) => e.k === 'beamedDown' && e.map === lpId), ups = boden.filter((e) => e.k === 'beamedUp' && e.map === lpId);
  if (sollScheitern) pruef(downs.length === 0 && ups.length === 0, 'nie unten gewesen (kein beamedDown/-Up am Ort)');
  else pruef(downs.length >= 1 && ups.length >= 1 && !ups.some((e) => e.notrueckholung) && unten.length >= 1, `beamedDown ${downs.length}x (${downs.map((e) => e.n).join('+')} Spieler), beamedUp ${ups.length}x, ohne Notrueckholung`);
  const BW = JSON.parse(fs.readFileSync(path.join('content', 'faeden', 'boden-werte.json'), 'utf8')).werte.besetzung.wert;
  const minG = BES === 'ruhig' ? 0 : BES === 'raeuber' ? 1 : 2;
  if (BES === 'ruhig') pruef(gegner === 0 && Object.keys(BW.ruhig).length === 0, `ruhig: 0 Gegner am Ort (${gegner})`);
  else pruef(gegner >= minG, `${BES}: mindestens ${minG} Gegner am Ort (${gegner}: ${gegnerArten})`);
  if (!sollScheitern) {
    const namen = personenAnBordMax.map((q) => q.name);
    pruef(namen.length === ANZAHL && new Set(namen).size === ANZAHL, `${ANZAHL} Ueberlebende ohne Doppelte (${namen.join(', ')})`);
    pruef(personenAnBordMax.map((q) => q.bett).sort().join() === Array.from({ length: ANZAHL }, (_, i) => i).join(), `Betten ${personenAnBordMax.map((q) => q.bett).sort().join(',')}`);
    if (ENDE === 'abgegeben') pruef(abgegebenIds.length === ANZAHL && personNachher === 0 && Array.isArray(weltFracht) && weltFracht.length === 0, `abgegeben: ${abgegebenIds.length} abgegeben, Lager ohne Personen (${personNachher}), Weltstand schiff.fracht ${JSON.stringify(weltFracht)}`);
    else pruef(personNachher === ANZAHL && Array.isArray(weltFracht) && weltFracht.filter((x) => /\.u\d$/.test(String(x.p))).length === ANZAHL, `an Bord: ${personNachher} Personen im Lager, Weltstand schiff.fracht traegt ${weltFracht && weltFracht.length} Eintraege`);
  } else if (BELEGT) {
    pruef(JSON.stringify(lager()) === lagerVorher && personNachher === 0, 'nach dem Scheitern liegt das Erz weiter unveraendert, keine Person an Bord');
    pruef(funk.some((t) => /kein Bett frei/i.test(t)), 'der Funk-Hinweis zum belegten Frachtraum kam');
  }
  // ---- Beispiel 2: die Hauptfigur steht im Weltstand mit Gedaechtnis rettung_gelungen, Nebenfiguren ohne Fadenzustand; ein Wiedersehen greift sie auf; der Brett-Plan war der Standardplan
  let gedaechtnisErg = null;
  if (BRETT) {
    const ws = JSON.parse(JSON.stringify(Weltstand.capture(g)));
    const mitGed = []; const gehe = (x) => { if (Array.isArray(x)) x.forEach(gehe); else if (x && typeof x === 'object') { if (typeof x.name === 'string' && Array.isArray(x.gedaechtnis)) mitGed.push(x); Object.values(x).forEach(gehe); } };
    gehe(ws);
    const haupt = mitGed.filter((x) => x.name === f.nsc.name);
    const neben = personenAnBordMax.slice(1).map((q) => q.name);
    gedaechtnisErg = { imWeltstand: haupt.length, rettungGelungen: haupt.some((x) => x.gedaechtnis.some((e) => e.ereignis === 'rettung_gelungen')), nebenfigurenMitZustand: mitGed.filter((x) => neben.includes(x.name)).length, nebenfiguren: neben };
    pruef(gedaechtnisErg.imWeltstand >= 1 && gedaechtnisErg.rettungGelungen, `Weltstand: der Faden-NSC ${f.nsc.name} steht mit Gedaechtnis rettung_gelungen (${haupt.length} Eintrag/Eintraege)`);
    pruef(neben.length === 2 && gedaechtnisErg.nebenfigurenMitZustand === 0, `Nebenfiguren (${neben.join(', ')}) ohne Fadenzustand im Weltstand (${gedaechtnisErg.nebenfigurenMitZustand})`);
    const B1T = JSON.parse(fs.readFileSync(path.join('content', 'faeden', 'b1-texte.json'), 'utf8'));
    const pw = { format: 'faden-bauplan/1', titel: 'Wiedersehen mit Geretteten', anlass: 'Ein Geretteter meldet sich bei der Crew.', beats: [{ typ: 'wiedersehen' }, { typ: 'abschluss' }] };
    const kand = Faden.wiedersehenKandidaten(g, Bauplan.expandiere(pw).vorlage);
    pruef(kand.includes(f.nsc.id), `Wiedersehen: der gerettete NSC ist Kandidat (${kand.length} Kandidaten)`);
    const F2 = Faden.zustandVon(g); F2.abenteuerAngebote = [];
    const a2 = Faden.abenteuerAnbieten(g, pw, { hex: w.hierHex() });
    const r2 = a2.ok ? Faden.abenteuerOeffnen(g, a2.angebot.nr, { nsc_von: f.nsc.id }) : { ok: false, grund: (a2.fehler || []).join(' | ') };
    pruef(r2.ok, 'Wiedersehen mit nsc_von eroeffnet' + (r2.ok ? '' : ': ' + r2.grund));
    if (r2.ok) {
      const f2 = r2.faden; k('wiedersehen-starten');
      f2.zaehler = Math.max(f2.zaehler, f2.abstand);
      const br = Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f2.id, beat: FD.vorlage(f2.vorlage).beats[f2.beat].id });
      const soll = String(B1T.texte.wiedersehen_rettung_gelungen).replace('{ort}', Sektoren.hexName(f2.parameter.ort));
      await wartenAuf(() => funk.some((t) => t === soll), 3000);
      gedaechtnisErg.wiedersehenFunk = funk.some((t) => t === soll);
      pruef(br.ok && gedaechtnisErg.wiedersehenFunk, `der Funk des Wiedersehens nennt die Rettung (wiedersehen_rettung_gelungen): ${gedaechtnisErg.wiedersehenFunk}`);
    }
    pruef(!kz['plan-eingespeist'], 'der Plan wurde nicht eingespeist (der Standardplan des Bretts)');
    pruef(brettInfo.plan === 'notruf,rettung,abschluss' && brettInfo.endeAmBeat === 'abgegeben' && brettInfo.besetzungAmBeat === BES && brettInfo.absicht === 'bergung', `Standardplan des Bretts: ${brettInfo.plan}, ende ${brettInfo.endeAmBeat}, Besetzung ${brettInfo.besetzungAmBeat}, Absicht ${brettInfo.absicht}`);
  }
  pruef(zahlOrte(orteNach) === 0, `Ort restlos abgeraeumt: ${zahlOrte(orteVor)} Orte vorher, nachher dyn ${orteNach.dyn.length}, lpScan ${orteNach.scan.length}, aways ${orteNach.aways.length}, away.map ${orteNach.awayMap || 'nicht der Ort'}`);
  pruef(g.players.every((p) => p.zone !== 'away'), 'niemand mehr unten');
  pruef(aufrufe() === 0, `Komponisten-Aufrufe ${aufrufe()} (Rueckfall ohne Modell)`);
  pruef(g.errors === 0, `g.errors ${g.errors}`);
  const sek = Math.round((Date.now() - t0) / 100) / 10;
  const ok = abw.length === 0;
  const kurz = `${ok ? 'ok' : 'FEHLER'} ${BES} ${ENDE} crew ${CREW} seed ${SEED}${FRIST_LAUF ? ' frist-lauf' : ''}${BELEGT ? ' frachtraum-belegt' : ''}: Ausgang ${f.ausgang && f.ausgang.art}, Verlauf ${verlauf.join(' > ')}; Personen ${personenAnBordMax.length}${ENDE === 'abgegeben' ? ' (abgegeben ' + abgegebenIds.length + ')' : ''}; Gegner ${gegner}; unten ${unten.length}; Komponisten-Aufrufe ${aufrufe()}; g.errors ${g.errors}; Orte ${zahlOrte(orteVor)} vorher, ${zahlOrte(orteWaehrend)} im Lauf, ${zahlOrte(orteNach)} nachher; ${sek} s; kuenstlich ${JSON.stringify(kz)}`;
  if (JSON_DATEI) fs.writeFileSync(JSON_DATEI, JSON.stringify({ besetzung: BES, ende: ENDE, crew: CREW, seed: g.seed, anzahl: ANZAHL, fristLauf: FRIST_LAUF, frachtraumBelegt: BELEGT, ok, abweichungen: abw, faden: { phase: f.phase, ausgang: f.ausgang && f.ausgang.art, gedaechtnis: ged, verlauf }, nsc: f.nsc.name, brett: brettInfo, kette: KETTE ? kette : null, ortArt: lpDyn.art || null, gedaechtnisErg, personen: personenAnBordMax, abgegeben: abgegebenIds, amOrtStart, halteSek, lagerPersonenNachher: personNachher, lagerNachher: lager().length,lagerVorherGleich: JSON.stringify(lager()) === lagerVorher, weltFracht, aufnehmenFehler, funk, hinweise, gegner, gegnerArten, unten: unten.length, komponistenAufrufe: aufrufe(), errors: g.errors, orte: { vor: zahlOrte(orteVor), lauf: zahlOrte(orteWaehrend), nach: zahlOrte(orteNach), nachDetail: orteNach }, boden: boden.filter((e) => !e.map || e.map === lpId), sekunden: sek, kuenstlich: kz }, null, 1) + '\n', 'utf8');
  for (const x of cl) { try { x.ws.close(); } catch (e) { /* egal */ } }
  if (!ok) for (const z of zeilen.slice(-40)) console.log(z);
  console.log(kurz);
  if (!ok) for (const x of abw) console.log('FEHLER ' + x);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FEHLER: ' + (e && e.stack)); for (const z of zeilen.slice(-30)) console.log(z); process.exit(1); });
