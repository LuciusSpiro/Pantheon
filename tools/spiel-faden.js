'use strict';
// SUND-04a-2 P3 (Spieltest): echter Server (wie npm run debug) mit FAEDEN=1, Lage-Spielleiter (Mock), drei WebSocket-Clients. Der Notruf bewaeltigt
// oeffnet den dankbaren Captain; die Crew (drei Clients) beantwortet die Bitte, die Tätigkeiten laufen ueber die Grenzen des Spielleiters, bis der Faden
// abgeschlossen ist. Ausgabe: ein Protokoll (Zeile je Ereignis) auf der Konsole und in der Datei --out (Standard: Scratchpad-Ordner des Laufs).
// SUND-04b B1: danach spielt dieselbe Crew die drei neuen Beats OHNE Kampfszene, jeweils als Abenteuer (Mock-Plan des Komponisten aus server/sim/abenteuer-mock.js, durch die echte Kette Anbieten > Pruefer > Oeffnen):
// Gerücht (der Hafenfunk nennt einen Sektor, die Crew fliegt hin), Rätsel-Spur fundort (die Ops liest ueber die Verbindung weapons.spur.lesen und entschluesselt die Teilung, die verborgene Kante wird offen) und Wiedersehen
// (der NSC aus dem ersten Faden meldet sich und erinnert an eine konkrete Tat). Der Ort der Crew (ship.scene) und der Platz der Ops werden gesetzt, wie in den Tests: die Mechanik der Beats ist in test-faden-katalog-b1.js geprueft.
// Das Geruecht erreicht die Crew ueber ECHTE Spruenge (Weitscan weapons.widescan, helm.jump, Antrieb 8 s); Spur und Wiedersehen setzen den Ort per Space.enterScene (Luecke, siehe README B1 Nacharbeit H3).
// Aufruf: node tools/spiel-faden.js [--out datei.txt]   (npm run spiel:faden)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'mock'; process.env.LAGE_SPIELLEITER = '1'; process.env.REISE_EREIGNISSE = '1'; process.env.FAEDEN = '1';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Faden = require('../server/sim/faden.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Spur = require('../server/sim/spur.js');
const Sprung = require('../server/sim/sprung.js');
const AM = require('../server/sim/abenteuer-mock.js');
const Physics = require('../shared/physics.js');
const World = require('../server/world.js');

const CODE = 'SPFD';
const NAMEN = ['Ada', 'Bo', 'Cem'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const protokoll = [];
const zeile = (s) => { const t = new Date().toISOString().slice(11, 19); protokoll.push(`${t}  ${s}`); console.log(`${t}  ${s}`); };
const outIdx = process.argv.indexOf('--out');
const outDatei = outIdx > 0 ? process.argv[outIdx + 1] : path.join(os.tmpdir(), 'spiel-faden-protokoll.txt');

function client(port, hello, name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, name, funk: [], antw: 0, bitte: null };
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.t === 'snap') { if (m.world && 'bitte' in m.world) c.bitte = m.world.bitte; return; }
      if (m.t === 'event' && m.kind === 'radio' && name === NAMEN[0]) c.funk.push(`${m.from}: ${m.text}`);
      if (m.t === 'event' && m.kind === 'fadenBitteAntwort') c.antw++;
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiel-faden-'));
  const srv = await startServer({ port: 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game, port = srv.port;
  zeile(`Server auf Port ${port}, Schalter FAEDEN=1`);
  const cl = [await client(port, { clientId: 'A', name: NAMEN[0], color: 0 }, NAMEN[0]), await client(port, { clientId: 'B', name: NAMEN[1], color: 1 }, NAMEN[1]), await client(port, { clientId: 'C', name: NAMEN[2], color: 2 }, NAMEN[2])];
  await sleep(300);
  cl[0].send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of cl) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  zeile(`drei Clients im Spiel: ${g.players.filter((p) => p.connected).length} verbunden, Phase ${g.phase}, Lage-Spielleiter ${g.lageSpielleiter && !g.lageSpielleiter.disposed ? 'aktiv (Mock, Modus ' + g.lageSpielleiter.mode + ')' : 'nicht aktiv'}`);

  // Der Notruf ist bewaeltigt: die Person am Ausgang oeffnet ein Angebot (Hook, wie reise-ereignis)
  const angebot = Faden.ausgangMitPerson(g, { art: 'notruf', id: 'notruf_pirat_frachter', hex: '0403', sprecher: 'Frachter Aurelia', ausgang: 'gelungen' });
  zeile(`Notruf bewaeltigt (notruf_pirat_frachter): Angebot ${angebot ? 'Nr ' + angebot.nr + ' fuer ' + angebot.vorlagen.join(', ') : 'keines'}`);
  let faden = null;
  for (let i = 0; i < 120 && !faden; i++) {   // der Spielleiter (Mock) oeffnet aus dem Angebot an der naechsten Grenze
    Kriegslage.tick(g, 'spiel');
    g.lageGrenze('szene_ende');
    await sleep(120);
    faden = g.weltsim.faeden.liste.find((f) => f.vorlage === 'dankbarer_captain') || null;
  }
  zeile(faden ? `Faden ${faden.id} (dankbarer_captain) geoeffnet, NSC ${faden.nsc.name} (${faden.nsc.schiff}), Abstand ${faden.abstand}` : 'KEIN Faden geoeffnet');
  let gesehen = 0;
  for (let i = 0; i < 1200 && !(faden && faden.phase === 'abgeschlossen'); i++) {
    Kriegslage.tick(g, 'spiel');
    g.lageGrenze('szene_ende');
    await sleep(100);
    const off = Bitte.offen(g);
    if (off && !off.gemeldet) {
      off.gemeldet = true;
      zeile(`Bitte ${off.nr} (${off.beatId}) an alle drei: ${off.text} [${off.optionen.map((o) => o.text).join(' | ')}]`);
      const antwort = off.optionen.find((o) => o.id === 'annehmen') || off.optionen[0];
      cl[0].send({ t: 'cmd', c: 'faden.bitte', id: antwort.id, nr: off.nr });   // Ada antwortet
      cl[1].send({ t: 'cmd', c: 'faden.bitte', id: 'ablehnen', nr: off.nr });   // Bo antwortet gleichzeitig: wird verworfen (die erste gilt)
      zeile(`Crew antwortet: Ada „${antwort.text}“, Bo „Sucht Euch jemand anderen“ (gleichzeitig, nur eine Antwort gilt)`);
    }
    if (faden) {
      const beats = g.lageRegie && g.lageRegie.log ? g.lageRegie.log.entries.filter((e) => e.art === 'faden_ereignis' && e.key === faden.id) : [];
      for (const e of beats.slice(gesehen)) zeile(`Faden: ${e.begruendung}`);
      gesehen = beats.length;
    }
  }
  await sleep(300);
  const fertig = faden && faden.phase === 'abgeschlossen';
  zeile(fertig ? `Faden abgeschlossen: Ausgang ${faden.ausgang.art}, NSC ${faden.nsc.status}, Gedaechtnis ${faden.nsc.gedaechtnis.map((x) => x.ereignis).join(', ')}` : `Faden NICHT abgeschlossen (Phase ${faden && faden.phase}, Beat ${faden && faden.beat})`);
  zeile(`Funk bei Ada (Auswahl): ${cl[0].funk.slice(-6).join(' || ').slice(0, 600)}`);
  zeile(`Bitten-Antworten bei allen drei: ${cl.map((x) => x.antw).join(', ')}`);
  // ---------------------------------------------------------------- SUND-04b B1: Gerücht, Rätsel-Spur, Wiedersehen
  // TEST-ARTEFAKT: der Deckel von 6 Anfragen je Sitzung (lageSpielleiter.aufrufe) gilt dem ECHTEN Claude (Kosten). Der Bot spielt mit dem Mock und setzt den Zaehler zurueck, sonst stuende die Geschichte nach einigen Runden still; im Spiel mit Claude gilt der Deckel unveraendert.
  const runde = async () => { Kriegslage.tick(g, 'spiel'); g.lageGrenze('szene_ende'); if (g.lageSpielleiter && g.lageSpielleiter.aufrufe > 4) g.lageSpielleiter.aufrufe = 0; await sleep(100); };   // der Deckel von 6 Anfragen je Sitzung gilt dem echten Claude: im Bot-Lauf mit dem Mock wird er zurueckgesetzt, sonst stuende die Geschichte still
  const hierHex = () => Sektoren.hexVonOrt(g.ship.scene);
  const flieg = (hex) => { const o = Sektoren.ortVonHex(hex) || ('leer-' + hex); Space.enterScene(g, o, {}); g.explore.location = o; const s = g.ship; s.docked = false; s.dockedAt = null; s.vx = 0; s.vy = 0; s.speed = 0; };
  // Die Crew sitzt an einer Konsole (Platz und Taste Benutzen, wie die Ops bei der Spur): der Sprung geht ueber die echten Befehle weapons.widescan und helm.jump
  const konsole = async (name) => {
    let platz = null;
    for (const t of [].concat(World.CONSOLE_TILES[name])) for (const [dx, dy, dir] of [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']]) { const q = { x: t.x + dx, y: t.y + dy, dir }; if (!platz && !World.ship.solid(q.x, q.y)) platz = q; }
    const mitte = Physics.tileCenter(platz.x, platz.y), me = g.players[0];
    const station = () => require('../server/sim/station.js').stationOf(me);
    if (!me.console) { me.x = mitte.x; me.y = mitte.y; me.dir = platz.dir; cl[0].send({ t: 'act', down: true }); cl[0].send({ t: 'act', down: false }); await sleep(250); }
    for (let i = 0; i < 4 && station() !== name; i++) { cl[0].send({ t: 'cmd', c: 'station.tab', dir: 1 }); await sleep(150); }   // schon an einer Konsole: Tab schaltet das Interface (Steuer, Ops, ...)
  };
  // Weg ueber offene Kanten (kuerzester, Breitensuche) -> [Hex ...] ohne den Start
  const wegNach = (ziel) => {
    const von = hierHex(), vor = new Map([[von, null]]); let rand = [von];
    while (rand.length && !vor.has(ziel)) { const next = []; for (const h of rand) for (const e of Sektoren.kantenVon(h)) { const n = Sektoren.anderes(e, h); if (!vor.has(n) && Sektoren.spielbar(n) && g.explore.kanteOffen(Sektoren.kanteId(e.a, e.b))) { vor.set(n, h); next.push(n); } } rand = next; }
    if (!vor.has(ziel)) return null;
    const weg = []; for (let h = ziel; h !== von; h = vor.get(h)) weg.unshift(h);
    return weg;
  };
  // ECHTE Spruenge statt Space.enterScene: Ops macht den Weitscan am Sprungpunkt (findet die Boje), Helm springt (Antrieb laedt, Sprungpunkt-Automatik waehlt das Ziel). Der Bot setzt das Schiff an den Sprungpunkt
  // (das Anfliegen ist in test-flight geprueft) und kuerzt nichts am Antrieb. -> true, wenn die Crew im Zielsektor ist
  const springe = async (ziel) => {
    const weg = wegNach(ziel);
    if (!weg) { zeile('Sprung: kein Weg ueber offene Sprungpunkte nach ' + ziel); return false; }
    for (const h of weg) {
      const p = Sprung.sprungpunkt(g, h), s = g.ship;
      s.docked = false; s.dockedAt = null; s.x = p.x - 80; s.y = p.y; s.vx = 0; s.vy = 0; s.speed = 0;
      await konsole('weapons'); cl[0].send({ t: 'cmd', c: 'weapons.widescan' }); await sleep(400);
      await konsole('helm');
      for (let i = 0; i < 300 && !s.jump.ready; i++) await sleep(100);
      if (!s.jump.ready) { zeile('Sprung nach ' + h + ' nicht bereit: ' + (s.jump.blockedReason || 'unbekannt')); return false; }
      const vorher = hierHex(), ziel0 = s.jump.dest; cl[0].send({ t: 'cmd', c: 'helm.jump' });
      for (let i = 0; i < 50 && hierHex() === vorher; i++) await sleep(100);
      zeile('Sprung ' + Sektoren.hexName(vorher) + ' > ' + Sektoren.hexName(hierHex()) + ' (Weitscan, Antrieb, helm.jump; Ziel vor dem Sprung ' + ziel0 + ', Station ' + require('../server/sim/station.js').stationOf(g.players[0]) + ', Antrieb bereit ' + s.jump.ready + ', Ort ' + g.ship.scene + ')');
      if (hierHex() !== h) return false;
      s.vx = 0; s.vy = 0; s.speed = 0;
    }
    return true;
  };
  const ergebnisse = [];
  async function abenteuer(name, plan, parameter) {
    let a = Faden.abenteuerAnbieten(g, plan, { hex: hierHex() });
    for (let i = 0; i < 30 && !a.ok && /ABENTEUER_ANGEBOTE/.test(a.grund); i++) { await runde(); a = Faden.abenteuerAnbieten(g, plan, { hex: hierHex() }); }   // offene Angebote des Komponisten verfallen
    if (!a.ok) { zeile(name + ': kein Angebot (' + a.grund + ')'); return null; }
    const r = Faden.abenteuerOeffnen(g, a.angebot.nr, parameter);
    if (!r.ok) { zeile(name + ': Öffnen abgelehnt (' + r.grund + ')'); return null; }
    zeile(name + ': Abenteuer ' + r.faden.id + ' geöffnet (Beats ' + a.angebot.vorlage.beats.map((b) => b.typ).join(' > ') + '), NSC ' + r.faden.nsc.name);
    return r.faden;
  }
  const beatTyp = (f) => require('../server/sim/faden-daten.js').vorlage(f.vorlage).beats[f.beat].typ;
  async function bisBeat(f, typ) {   // der Spielleiter (Mock) bringt den Faden an der Grenze weiter, bis der Beat laeuft
    for (let i = 0; i < 200 && !(f.phase === 'laeuft' && beatTyp(f) === typ); i++) { await runde(); if (f.phase === 'abgeschlossen') break; }
    return f.phase === 'laeuft' && beatTyp(f) === typ;
  }
  const funkSeit = (n) => cl[0].funk.slice(n).map((x) => '„' + x + '“').join(' | ').slice(0, 500);
  // der Mock-Komponist baut einen gueltigen Plan mit dem Typ am Anfang; fuer den Bot auf Beat und Abschluss gekuerzt (die Szenen-Beats der Zufallsplaene braeuchten einen Kaempfer), der Pruefer prueft ihn trotzdem
  const plan = (typ) => { const p = AM.gueltigerPlan(AM.rngVon('b1-' + typ), { mit: typ, min: 2 }); p.beats = [{ typ }, { typ: p.beats[p.beats.length - 1].typ }]; return p; };
  const beatEnde = (f, typ) => f.nsc.gedaechtnis.filter((x) => x.ereignis.startsWith(typ + '_')).map((x) => x.ereignis).join(',');
  const ende = async (f) => {
    for (let i = 0; i < 200 && f.phase !== 'abgeschlossen'; i++) await runde();
    if (f.phase !== 'abgeschlossen') { const l = (g.lageRegie && g.lageRegie.log ? g.lageRegie.log.entries : []).filter((e) => e.art === 'faden_pruefung' || (e.art === 'lage_befehl' && e.ausgang === 'abgelehnt')).slice(-3); zeile('Faden ' + f.id + ' steht bei Beat ' + f.beat + ' (' + f.phase + '), Zähler ' + f.zaehler + '/' + f.abstand + '; letzte Ablehnungen: ' + JSON.stringify(l).slice(0, 400)); }
    return f.phase === 'abgeschlossen';
  };

  // 1. Gerücht
  {
    const n0 = cl[0].funk.length;
    const f = await abenteuer('Gerücht', plan('geruecht'));
    if (f && await bisBeat(f, 'geruecht')) {
      zeile('Gerücht: der Hafenfunk nennt ' + Sektoren.hexName(f.parameter.ort) + ' (' + f.parameter.ort + '); Funk: ' + funkSeit(n0));
      await sleep(300);
      zeile('Die Crew springt nach ' + Sektoren.hexName(f.parameter.ort) + ' (echte Spruenge)');
      const angekommen = await springe(f.parameter.ort); await sleep(400);
      ergebnisse.push(['Gerücht über echte Sprünge', angekommen]);
      zeile('Gerücht nach der Ankunft: Phase ' + f.phase + ', Beat ' + f.beat + ', NSC ' + f.nsc.status + ', Gedächtnis ' + beatEnde(f, 'geruecht'));
      ergebnisse.push(['Gerücht', f.nsc.gedaechtnis.some((x) => x.ereignis === 'geruecht_gelungen')]);
      ergebnisse.push(['Gerücht-Faden zu Ende', await ende(f)]);
    } else ergebnisse.push(['Gerücht', false]);
  }
  flieg('0305'); await sleep(200);

  // 2. Rätsel-Spur (die Ops liest ueber die Verbindung)
  {
    const n0 = cl[0].funk.length;
    const p = plan('spur'); p.beats[0].parameter = { spur: 'fundort' };
    const f = await abenteuer('Rätsel-Spur', p);
    if (f && await bisBeat(f, 'spur')) {
      zeile('Spur ' + g.spur.id + ' läuft, Marke im Sektorplan; Funk: ' + funkSeit(n0));
      await konsole('weapons');   // die Ops sitzt an ihrer Konsole (nach dem Sprung des Geruechts war die Crew am Steuer)
      const lese = async () => {
        const k = Spur.kern(g.spur.id, hierHex()); g.ship.x = k.x + 40; g.ship.y = k.y;
        cl[0].send({ t: 'cmd', c: 'weapons.spur.lesen', on: true });
        for (let i = 0; i < 200 && !(g.spur.gelesen || g.spur.fertig || g.spur.wartet); i++) await sleep(100);
        if (g.spur.wartet) {   // Teilung: die Ops stimmt das Signal ab (Qualität 3)
          cl[0].send({ t: 'cmd', c: 'weapons.entschl.start' });
          for (let i = 0; i < 1200 && g.entschl && g.entschl.z === 1; i++) { const e = g.entschl, d = Math.abs(e.f - e.ziel) < 0.02 ? 0 : (e.ziel > e.f ? 1 : -1); if (d !== e.dir) cl[0].send({ t: 'cmd', c: 'weapons.entschl.stimme', dir: d }); await sleep(100); }
          await sleep(500);
        }
      };
      for (const hex of ['0705', '0605']) { flieg(hex); await sleep(300); zeile('Spur: Crew in ' + Sektoren.hexName(hex) + ', Ops liest'); await lese(); }
      await sleep(600);
      const offen = g.explore.kanteOffen(Sektoren.kanteId('0605', '0706'));
      zeile('Spur nach dem Lesen: fertig ' + !!(g.spur && g.spur.fertig) + ', Kante nach Bojenfeld offen ' + offen + '; Beat: Phase ' + f.phase + ', Gedächtnis ' + beatEnde(f, 'spur') + '; Funk: ' + funkSeit(n0));
      ergebnisse.push(['Rätsel-Spur', f.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gelungen') && offen]);
      ergebnisse.push(['Spur-Faden zu Ende', await ende(f)]);
    } else ergebnisse.push(['Rätsel-Spur', false]);
  }
  flieg('0305'); await sleep(200);

  // 3. Wiedersehen: der NSC aus dem ersten Faden erinnert sich an eine konkrete Tat der Crew
  {
    const n0 = cl[0].funk.length;
    const wp = plan('wiedersehen');
    const kand = Faden.wiedersehenKandidaten(g, require('../server/sim/faden-bauplan.js').expandiere(wp).vorlage);
    zeile('Wiedersehen: Kandidaten (NSC aus abgeschlossenen Fäden): ' + (kand.join(', ') || 'keine'));
    const f = kand.length ? await abenteuer('Wiedersehen', wp, { nsc_von: kand[0] }) : null;
    if (f && await bisBeat(f, 'wiedersehen')) {
      zeile('Wiedersehen: ' + f.nsc.name + ' meldet sich (Gedächtnis: ' + f.nsc.gedaechtnis.map((x) => x.ereignis).join(', ') + '); Funk: ' + funkSeit(n0));
      flieg(f.parameter.ort); await sleep(400);
      zeile('Wiedersehen nach der Ankunft in ' + Sektoren.hexName(f.parameter.ort) + ': Phase ' + f.phase + ', NSC ' + f.nsc.status + ', Gedächtnis ' + beatEnde(f, 'wiedersehen'));
      ergebnisse.push(['Wiedersehen', f.nsc.gedaechtnis.some((x) => x.ereignis === 'wiedersehen_gelungen')]);
      ergebnisse.push(['Wiedersehen-Faden zu Ende', await ende(f)]);
    } else ergebnisse.push(['Wiedersehen', false]);
  }
  const alleB1 = ergebnisse.every(([, ok]) => ok);
  zeile('SUND-04b B1: ' + ergebnisse.map(([k, ok]) => k + ' ' + (ok ? 'ok' : 'FEHLT')).join(', ') + '; Serverfehler ' + g.errors);
  fs.writeFileSync(outDatei, protokoll.join('\n') + '\n');
  zeile(`Protokoll geschrieben: ${outDatei}`);
  for (const x of cl) x.ws.close();
  process.exit(fertig && alleB1 && g.errors === 0 ? 0 : 1);
})().catch((e) => { console.log('FEHLER: ' + (e && e.stack)); process.exit(1); });
