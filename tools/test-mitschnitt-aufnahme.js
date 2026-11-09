'use strict';
// MIT-01 A: Test des Recorders (server/telemetrie/mitschnitt.js) – ohne Netz, ohne LLM (Mock-Spielleiter), Fäden-Szenario mit Bitte.
//   node tools/test-mitschnitt-aufnahme.js
// Prüft: aus = keine Datei/kein Ordner; Verlaufs-Hash (snapshot, rng, Fäden, Ruf, Chronik) mit und ohne MITSCHNITT=1 und mit einem Empfänger, der in jedem Eingang wirft, gleich;
// Vollständigkeit/Reihenfolge (nr lückenlos, Funkzeilen = radio-Ereignisse einer Beobachter-Verbindung, Optionen und Wahl der Bitte); Namensfilter (Spieler „Bo“, Ganzwort); Ende/Renderer-Stub/Fallback.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const F = require('./regie-fixture.js');
const Faden = require('../server/sim/faden.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const { Mitschnitt, gruppeIstLeer } = require('../server/telemetrie/mitschnitt.js');
const Sektoren = require('../shared/sektoren.js');
const Sprung = require('../server/sim/sprung.js');
const RE = require('../server/sim/reise-ereignis.js');
const FA = require('../server/sim/funk-antwort.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mit-'));
let zaehler = 0;
const neuesVerz = () => path.join(root, 'm' + (++zaehler));
const frei = () => new Promise((r) => setImmediate(r));
const alleDateien = (d, out) => { out = out || []; if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) alleDateien(f, out); else out.push(f); } return out; };

// Funk-Antwort (SUND-03b): Angebot erzwingen (Katalog auf einen Eintrag mit antworten, Wahrscheinlichkeit 1) und eine Option wählen
function funkAntwortProbe(g, wahl) {
  g.weltsim.zustand.flotten = []; g.space.enemies = [];
  const kopie = RE.KATALOG.slice(); const id = 'patrouille_rom_gruss';
  const alt = RE.WERTE.wahrscheinlichkeit; RE.WERTE.wahrscheinlichkeit = 1;
  RE.KATALOG.length = 0; RE.KATALOG.push(kopie.find((e) => e.id === id));
  try { const R = g.weltsim.reise; R.letzter = null; R.letzte = []; Sprung.springeNach(g, Sektoren.ortVonHex('0305')); } finally { RE.WERTE.wahrscheinlichkeit = alt; RE.KATALOG.length = 0; RE.KATALOG.push(...kopie); }
  const off = g.weltsim.funkwahl && g.weltsim.funkwahl.offen;
  if (off) FA.beantworten(g, wahl === 'ignorieren' ? 'ignorieren' : off.optionen[0].id, off.lfd);
  return off;
}
// Befund N1/3: Funk-Antwort (Angebot + Wahl) mit/ohne Mitschnitt/werfendem Empfänger; Hash über Snapshot, rng, Ruf, Chronik
function funkSzenario(modus, dir, wahl) {
  const env = { REISE_EREIGNISSE: '1', REGIE_DIR: path.join(dir, 'regie') };
  if (modus !== 'aus') { env.MITSCHNITT = '1'; env.MITSCHNITT_DIR = path.join(dir, 'mit'); }
  const t = F.neuesSpiel({ crew: 1, seed: 7, names: ['Ada'], env });
  const g = t.g;
  if (modus === 'wirft') { const boese = () => { throw new Error('Mutationsprobe'); }; const m = g.mitschnitt; m._neu = boese; m._lesen = boese; m._filter = boese; m._funkOptionen = boese; }
  const off = funkAntwortProbe(g, wahl);
  for (let i = 0; i < 400; i++) g.step();
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(g.snapshot())); h.update(String(g.rng())); h.update(JSON.stringify(g.weltsim.ruf)); h.update(JSON.stringify(g.weltsim.chronik));
  return { g, off, hash: h.digest('hex') };
}

// Szenario der Erkundung: Notruf -> Faden -> Bitte -> Antwort -> Fristen -> Abschluss. modus: 'aus' | 'an' | 'wirft'
async function szenario(modus, dir, names) {
  const env = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: '1', REGIE_DIR: path.join(dir, 'regie') };
  if (modus !== 'aus') { env.MITSCHNITT = '1'; env.MITSCHNITT_DIR = path.join(dir, 'mit'); }
  const t = F.neuesSpiel({ crew: 2, seed: 7, names: names || ['Ada', 'Bo'], env });
  const g = t.g, cs = t.cs;
  const radios = [];
  const w = { send(o) { if (o && o.t === 'event' && o.kind === 'radio') radios.push(o); } };
  g.addConnection(w); w.observer = true;
  const startNr = g.mitschnitt ? g.mitschnitt.nr : 0;   // ab hier zählt die Beobachter-Verbindung mit
  if (modus === 'wirft') {   // jeder Eingang des Empfängers wirft (innen, hinter _sicher) und die Senke der Telemetrie auch
    const boese = () => { throw new Error('Mutationsprobe'); };
    const m = g.mitschnitt;
    m._neu = boese; m._lesen = boese; m._filter = boese; m._fadenEreignis = boese; m._bauplan = boese; m._brett = boese; m._szeneStart = boese; m._szeneEnde = boese; m._funkOptionen = boese;   // _funkOptionen: Weg der neuen Haken funkAntwortGestellt/-Gewaehlt
    g.telemetrie.senken = [boese];
  }
  Faden.ausgangMitPerson(g, { art: 'notruf', id: 'notruf_pirat_frachter', hex: '0403', sprecher: 'Frachter Aurelia', ausgang: 'gelungen' });
  let faden = null, gemeldet = 0;
  for (let i = 0; i < 600; i++) {
    Kriegslage.tick(g, 'spiel');
    g.lageGrenze('szene_ende');
    for (let k = 0; k < 3; k++) g.step();
    await frei();
    faden = faden || g.weltsim.faeden.liste.find((f) => f.vorlage === 'dankbarer_captain') || null;
    const off = Bitte.offen(g);
    if (off && off.nr !== gemeldet) {
      gemeldet = off.nr;
      const a = off.optionen.find((o) => o.id === 'annehmen') || off.optionen[0];
      g.handleMessage(cs[0], { t: 'cmd', c: 'faden.bitte', id: a.id, nr: off.nr });
    }
    if (faden && faden.phase === 'abgeschlossen') break;
  }
  for (let i = 0; i < 40; i++) { Kriegslage.tick(g, 'spiel'); g.lageGrenze('szene_ende'); g.step(); await frei(); }
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(g.snapshot())); h.update(String(g.rng())); h.update(JSON.stringify(g.weltsim.faeden.liste.map((f) => [f.id, f.phase, f.beat, f.ausgang, f.nsc.haltung, f.nsc.status])));
  h.update(JSON.stringify(g.weltsim.ruf)); h.update(JSON.stringify(g.weltsim.chronik));
  return { g, hash: h.digest('hex'), radios, faden, startNr };
}

(async () => {
  // ---------- 1. aus = aus ----------
  console.log('Aus');
  const d1 = neuesVerz();
  const aus = await szenario('aus', d1);
  ok(aus.g.mitschnitt === null, 'ohne MITSCHNITT=1: game.mitschnitt ist null');
  ok(!aus.g.telemetrie.offen && !fs.existsSync(path.join(d1, 'mit')), 'ohne Schalter: Telemetrie nicht offen, kein Ordner');
  const vorherEnv = process.env.MITSCHNITT_DIR;
  ok(alleDateien(path.join(d1, 'mit')).length === 0, 'ohne Schalter: keine Datei');
  ok(aus.g.telemetrie.aktiv === false && aus.g.telemetrie.senke === false, 'TELEMETRIE-Verhalten ohne Mitschnitt unverändert (inaktiv, keine Senke)');

  // ---------- 2. Verlaufs-Hash ----------
  console.log('Verlaufs-Hash');
  const d2 = neuesVerz();
  const an = await szenario('an', d2);
  const d3 = neuesVerz();
  const wirft = await szenario('wirft', d3);
  ok(aus.faden && aus.faden.phase === 'abgeschlossen', 'Szenario: Faden bis zum Abschluss gespielt');
  ok(an.hash === aus.hash, 'Hash mit MITSCHNITT=1 = ohne (' + an.hash.slice(0, 8) + ')');
  ok(wirft.hash === aus.hash, 'Hash mit werfendem Empfänger = ohne');
  ok(wirft.g.mitschnitt.fehler > 0, 'Mutationsprobe: der Empfänger hat tatsächlich geworfen (' + wirft.g.mitschnitt.fehler + ' gezählt)');
  ok(wirft.g.errors === aus.g.errors, 'Mutationsprobe: Fehlerzähler des Spiels unverändert');

  // Funk-Antwort: Hash gleich, Haken im Verlauf
  const fA = funkSzenario('aus', neuesVerz()), fB = funkSzenario('an', neuesVerz()), fC = funkSzenario('wirft', neuesVerz()), fD = funkSzenario('an', neuesVerz(), 'ignorieren'), fE = funkSzenario('aus', neuesVerz(), 'ignorieren');
  ok(fA.off && fA.off.optionen.length >= 2, 'Funk-Szenario: ein Angebot mit Optionen entstand');
  ok(fA.hash === fB.hash && fA.hash === fC.hash && fD.hash === fE.hash, 'Funk-Antwort: Hash mit Schalter = ohne = mit werfendem Empfänger (auch Ignorieren)');
  ok(fC.g.mitschnitt.fehler > 0, 'Funk-Antwort: der werfende Empfänger hat tatsächlich geworfen (' + fC.g.mitschnitt.fehler + ')');
  {
    const ev = fB.g.mitschnitt.verlauf().eintraege;
    const q = ev.find((e) => e.art === 'entscheidung' && e.quelle === 'funk'), w = ev.find((e) => e.art === 'wahl' && e.quelle === 'funk');
    const ids = fB.off.optionen.map((o) => o.id);
    ok(q && q.id === fB.off.id && q.von === fB.off.von && ids.every((i) => q.optionen.some((o) => o.id === i && o.text)) && q.optionen.some((o) => o.id === 'ignorieren'), 'Funk-Angebot im Verlauf: entscheidung quelle funk mit Optionen (id, text) inkl. ignorieren');
    ok(w && w.option === ids[0] && w.id === ids[0] && w.text === fB.off.optionen[0].text && w.optionen.length === q.optionen.length && q.nr < w.nr, 'Funk-Wahl im Verlauf: wahl quelle funk, option = gewählte Id, gleiche Optionsliste, nach dem Angebot');
    ok(ev.some((e) => e.art === 'funk' && e.text === w.text), 'der Antworttext steht als Funkzeile im Verlauf (Wahl und Funk stimmen überein)');
    const wi = fD.g.mitschnitt.verlauf().eintraege.find((e) => e.art === 'wahl' && e.quelle === 'funk');
    ok(wi && wi.option === 'ignorieren', 'Ignorieren wird als Wahl aufgenommen');
  }

  // ---------- 3. Vollständigkeit und Reihenfolge ----------
  console.log('Vollständigkeit');
  const m = an.g.mitschnitt; const v = m.verlauf();
  ok(v.format === 'mitschnitt/1' && v.eintraege.length > 20, 'Verlauf hat Format und Einträge (' + v.eintraege.length + ')');
  ok(v.eintraege.every((e, i) => e.nr === i + 1), 'nr lückenlos und aufsteigend');
  ok(v.eintraege.every((e, i) => i === 0 || e.spielzeit >= v.eintraege[i - 1].spielzeit), 'spielzeit nicht fallend');
  const funk = v.eintraege.filter((e) => e.art === 'funk' && e.nr > an.startNr);
  ok(funk.length === an.radios.length && funk.length > 5, 'Funkzeilen = radio-Ereignisse der Beobachter-Verbindung (' + funk.length + ')');
  ok(funk.every((e, i) => e.text === an.radios[i].text && e.von === an.radios[i].from), 'Funk in gleicher Reihenfolge und gleichem Text');
  const bitte = v.eintraege.find((e) => e.art === 'bitte'), wahl = v.eintraege.find((e) => e.art === 'wahl' && e.quelle === 'bitte');
  ok(bitte && bitte.optionen.length >= 2 && bitte.optionen.every((o) => o.id && o.text) && Number.isInteger(bitte.bitte_nr), 'Bitte mit Optionsliste (id, text) und bitte_nr');
  ok(wahl && bitte.optionen.some((o) => o.id === wahl.id) && wahl.option === wahl.id && wahl.optionen.length === bitte.optionen.length, 'Wahl der Bitte mit gewählter Option und Liste');
  ok(wahl && bitte.nr < wahl.nr, 'Bitte steht vor der Wahl');
  const gf = v.gruppen.find((g) => g.id === 'f1');
  ok(gf && gf.von_nr <= gf.bis_nr && gf.ausgang !== 'offen' && gf.nsc.length === 1 && gf.nsc[0].name, 'Faden f1: Gruppe mit Ausgang und NSC (' + (gf && gf.ausgang) + ')');
  ok(v.eintraege.some((e) => e.art === 'faden' && e.ausgang === 'geoeffnet') && v.eintraege.some((e) => e.art === 'faden' && e.ausgang === 'abgeschlossen'), 'Faden-Ereignisse geoeffnet und abgeschlossen');
  ok(v.eintraege.some((e) => e.art === 'chronik' && e.chronik_art), 'Chronik mit chronik_art');
  ok(v.eintraege.some((e) => e.art === 'taetigkeit' && e.taetigkeit_art === 'szene_ende'), 'Tätigkeitsgrenzen');
  ok(v.angebote.length > 0 && v.angebote.every((a) => a.angebot > 0 && a.ausgang), 'angebote[] gefüllt (' + v.angebote.length + ')');
  ok(!/"status"\s*:/.test(JSON.stringify(v.lauf)), 'lauf trägt kein status');
  ok(an.g.telemetrie.senke && an.g.telemetrie.stand().datei === null, 'Telemetrie läuft nur als Senke (kein Protokoll)');
  ok(alleDateien(path.join(d2, 'mit')).length === 0, 'ohne ende(): bisher keine Datei');

  // ---------- 4. Namenstest ----------
  console.log('Namen');
  ok(!/\bBo\b|\bAda\b/.test(JSON.stringify(v.eintraege)), 'Szenario: weder „Bo“ noch „Ada“ im Verlauf');
  const d4 = neuesVerz();
  const n = F.neuesSpiel({ crew: 2, seed: 3, names: ['Bo', 'Cem'], env: { MITSCHNITT: '1', MITSCHNITT_DIR: path.join(d4, 'mit'), REGIE_DIR: path.join(d4, 'regie') } });
  const mn = n.g.mitschnitt;
  n.g.oda('Bordintelligenz ODA: Bo ist verwundet, Cem hilft; Cemetery.');
  n.g.emit('radio', { from: 'Lerche', text: 'Bo, bitte kommen. Bos Schiff, bo!' });
  n.g.notice(n.g.players[0], 'Bordintelligenz: Bo, du bist dran.');
  n.g.removeConnection(n.cs[0]);   // Bo geht, der Name bleibt im Filter
  n.g.oda('Bo ist von Bord gegangen.');
  const t4 = mn.verlauf().eintraege.filter((e) => ['oda', 'funk', 'anzeige'].includes(e.art)).map((e) => e.text);
  ok(t4.includes('Bordintelligenz ODA: Crew ist verwundet, Crew hilft; Cemetery.'), 'Ganzwort: Bordintelligenz bleibt, Bo/Cem werden Crew, Cemetery bleibt (' + t4[0] + ')');
  ok(t4.includes('Crew, bitte kommen. Bos Schiff, Crew!'), 'Funk: „Bos“ bleibt (kein ganzes Wort), „bo“ wird Crew');
  ok(t4.includes('Bordintelligenz: Crew, du bist dran.'), 'notice als anzeige gefiltert');
  ok(t4[t4.length - 1] === 'Crew ist von Bord gegangen.', 'ausgeschiedener Spieler bleibt gefiltert');
  const Aus = require('../server/sim/lage-ausschnitt.js');
  ok(Aus.ohneNamen('Bordintelligenz', ['Bo']) === 'Crew' && Aus.ohneNamenGanzwort('Bordintelligenz', ['Bo']) === 'Bordintelligenz', 'ohneNamen unverändert, ohneNamenGanzwort neu daneben');

  // Befund N1/4: Ganzwort-Filter auf ALLE Strings (rekursiv), technische Ids bleiben
  {
    const x = mn._filter({ id: 'Bo', key: 'Bo', kennung: 'Bo', ref: 'Bo', faden: 'Bo', pid: 'Bo', ausgang: 'Bo', art: 'Bo', typ: 'Bo', chronik_art: 'Bo', titel: 'Bo und Bordintelligenz', frei: 'Bo wartet', tief: { liste: [{ y: 'Bo ruft', z: 3 }, 'Bo'] }, zahl: 4 });
    ok(x.id === 'Bo' && x.key === 'Bo' && x.kennung === 'Bo' && x.ref === 'Bo' && x.faden === 'Bo' && x.pid === 'Bo' && x.ausgang === 'Bo' && x.art === 'Bo' && x.typ === 'Bo' && x.chronik_art === 'Bo', 'plan-Filter: technische Ids bleiben unverändert');
    ok(x.titel === 'Crew und Bordintelligenz' && x.frei === 'Crew wartet' && x.tief.liste[0].y === 'Crew ruft' && x.tief.liste[0].z === 3 && x.tief.liste[1] === 'Crew' && x.zahl === 4, 'plan-Filter: Spieler „Bo“ wird Crew in beliebigen Feldern und Tiefen, Bordintelligenz bleibt');
    const e = mn._neu('faden', { id: 'f9', plan: { titel: 'Bo hilft', schritte: [{ beat: 'b1', ziel_x: 'Bo trifft Cem', unbekannt_feld: 'Bo' }] } }, { keine: true });
    ok(e.plan.titel === 'Crew hilft' && e.plan.schritte[0].unbekannt_feld === 'Crew' && e.plan.schritte[0].beat === 'b1' && e.id === 'f9', 'plan im Eintrag: auch unbekannte Felder gefiltert, Ids nicht');
  }
  // Befund N1/1: Regel für leere Gruppen
  {
    const gr = (o) => Object.assign({ id: 'g', art: 'mission', von_nr: 1, bis_nr: 5, ausgang: 'abgebrochen' }, o || {});
    const rahmen = [{ nr: 1, spielzeit: 0, art: 'mission' }, { nr: 2, spielzeit: 0, art: 'szene', ereignis: 'start' }, { nr: 3, spielzeit: 0, art: 'oda', text: 'Ankündigung' }, { nr: 4, spielzeit: 0, art: 'oda', text: 'Ankündigung 2' }, { nr: 5, spielzeit: 0, art: 'szene', ereignis: 'ende', ausgang: 'abgebrochen' }];
    ok(gruppeIstLeer(gr(), rahmen), 'leer: abgebrochen, 0 s, nur Rahmen + ODA-Ankündigung (Vorversuch)');
    ok(gruppeIstLeer(gr({ ausgang: 'offen' }), rahmen), 'leer: Schlussstart (offen, 0 s)');
    ok(!gruppeIstLeer(gr({ ausgang: 'erfolg' }), rahmen), 'nicht leer: inhaltlicher Ausgang');
    ok(!gruppeIstLeer(gr(), rahmen.map((e) => (e.nr === 5 ? Object.assign({}, e, { spielzeit: 6 }) : e))), 'nicht leer: Dauer ab 5 s');
    for (const art of ['funk', 'anzeige', 'entscheidung', 'wahl', 'wirkung', 'faden', 'bitte']) ok(!gruppeIstLeer(gr(), rahmen.concat([{ nr: 5, spielzeit: 0, art }])), 'nicht leer: enthält ' + art);
    ok(!gruppeIstLeer(gr({ art: 'faden' }), rahmen), 'Fäden/Abenteuer mit abgebrochenem Ausgang sind nie leer (N2: nur offene, ungespielte)');
    const d6 = neuesVerz();
    const m2 = F.neuesSpiel({ crew: 1, seed: 2, names: ['Zed'], env: { MITSCHNITT: '1', MITSCHNITT_DIR: path.join(d6, 'mit'), REGIE_DIR: path.join(d6, 'regie') } }).g.mitschnitt;
    m2.v.eintraege.push(...rahmen.map((e) => Object.assign({}, e, { nr: e.nr + 1005 })), { nr: 1011, spielzeit: 0, art: 'mission' }, { nr: 1020, spielzeit: 30, art: 'funk', text: 't' });
    m2.v.gruppen.push(gr({ id: 'mission-x', von_nr: 1006, bis_nr: 1010, kennung: 'x' }), gr({ id: 'mission-x-2', von_nr: 1011, bis_nr: 1020, kennung: 'x', ausgang: 'erfolg' }));
    m2._leereMarkieren();
    ok(m2.v.gruppen[0].leer === true && m2.v.gruppen[0].ersetzt_durch === 'mission-x-2' && !m2.v.gruppen[1].leer && m2.v.eintraege.length >= 7, 'Recorder: leer + ersetzt_durch gesetzt, Einträge bleiben');
    m2.nr = 0; m2.ende();   // ohne Einträge: schreibt nichts, entfernt den Mitschnitt aus dem Exit-Haken
  }

  // ---------- 5. Ende, Renderer-Stub, Fallback ----------
  console.log('Ende');
  const stubAufrufe = [];
  Mitschnitt.renderLader = () => ({ schreibeLauf(verlauf, dir, opts) { stubAufrufe.push({ dir, opts }); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'verlauf.json'), JSON.stringify(verlauf)); fs.writeFileSync(path.join(dir, 'index.md'), 'stub'); return { dir, dateien: [] }; } });
  m.lauf({ werkzeug: 'test-mitschnitt', regel: 'Bitte: annehmen', seed: 7, crew: 2, modus: 'faeden', kuenstlich: ['teleport', 'teleport'] });
  const o1 = m.ende();
  ok(o1 && o1.startsWith(path.join(d2, 'mit')) && /_test-mitschnitt-s7-c2-faeden$/.test(o1), 'ende() gibt den Lauf-Ordner unter MITSCHNITT_DIR (' + (o1 && path.basename(o1)) + ')');
  ok(stubAufrufe.length === 1 && stubAufrufe[0].opts && stubAufrufe[0].opts.jetzt, 'Renderer-Stub einmal mit { jetzt } gerufen');
  ok(m.ende() === o1 && stubAufrufe.length === 1, 'ende() idempotent');
  const vj = JSON.parse(fs.readFileSync(path.join(o1, 'verlauf.json'), 'utf8'));
  ok(vj.lauf.werkzeug === 'test-mitschnitt' && vj.lauf.regel === 'Bitte: annehmen' && vj.lauf.kuenstlich.length === 1 && vj.lauf.beendet && vj.lauf.id === path.basename(o1), 'lauf-Kopf gefüllt, kuenstlich ohne Doppel');
  ok(vj.gruppen.every((g) => g.bis_nr >= g.von_nr), 'Gruppen mit gültiger Spanne');
  m.vonEmit('oda', { text: 'zu spät' });
  ok(m.verlauf().eintraege.length === vj.eintraege.length, 'nach ende() nimmt der Mitschnitt nichts mehr auf');
  // ohne Renderer: nur verlauf.json, nie werfen
  Mitschnitt.renderLader = () => { throw new Error('Renderer fehlt'); };
  const d5 = neuesVerz();
  const r = F.neuesSpiel({ crew: 1, seed: 5, names: ['Zed'], env: { MITSCHNITT: '1', MITSCHNITT_DIR: path.join(d5, 'mit'), REGIE_DIR: path.join(d5, 'regie') } });
  r.g.oda('Ein Text.');
  const o5 = r.g.mitschnitt.lauf({ werkzeug: 'x' }).ende();
  ok(o5 && fs.existsSync(path.join(o5, 'verlauf.json')) && alleDateien(o5).length === 1, 'ohne Renderer: nur verlauf.json, kein Wurf');
  const leer = F.neuesSpiel({ crew: 1, seed: 6, names: ['Zed'], env: { MITSCHNITT: '1', MITSCHNITT_DIR: path.join(d5, 'leer'), REGIE_DIR: path.join(d5, 'regie') } });
  leer.g.mitschnitt.nr = 0;
  ok(leer.g.mitschnitt.ende() === null && !fs.existsSync(path.join(d5, 'leer')), 'Lauf ohne Einträge schreibt nichts');
  ok(process.env.MITSCHNITT_DIR === vorherEnv, 'process.env unverändert');

  // ---------- Nacharbeit N2 ----------
  console.log('N2: leerer offener Faden');
  {
    const fg = (o) => Object.assign({ id: 'f10', art: 'faden', von_nr: 1, bis_nr: 6, ausgang: 'offen' }, o || {});
    const kopf = [{ nr: 1, spielzeit: 204.1, art: 'faden', ausgang: 'geoeffnet', gruppe: 'f10' }, { nr: 2, spielzeit: 204.2, art: 'regie' }, { nr: 3, spielzeit: 204.8, art: 'funk', von: 'Hafen', text: 'Ulfsvakt ist gefallen.' },
      { nr: 4, spielzeit: 205.2, art: 'faden', ausgang: 'beat_start', gruppe: 'f10' }, { nr: 5, spielzeit: 205.2, art: 'funk', von: 'Hafenfunk', text: 'Gerücht', gruppe: 'f10', zuordnung: 'heuristik' }, { nr: 6, spielzeit: 205.2, art: 'chronik', gruppe: 'f10', zuordnung: 'heuristik' }];
    ok(gruppeIstLeer(fg(), kopf), 'leer: offener Faden, nie gespielt (nur Faden-Zeilen, heuristischer Funk, fremder Funk im Bereich)');
    ok(gruppeIstLeer(fg({ art: 'abenteuer' }), kopf), 'leer: offenes Abenteuer ohne Inhalt');
    ok(!gruppeIstLeer(fg({ ausgang: 'gelungen' }), kopf) && !gruppeIstLeer(fg({ ausgang: 'abgebrochen' }), kopf), 'nie leer: abgeschlossener Faden (Ausgang nicht offen)');
    for (const art of ['funk', 'anzeige', 'oda', 'entscheidung', 'wahl', 'bitte', 'wirkung']) ok(!gruppeIstLeer(fg(), kopf.concat([{ nr: 6, spielzeit: 205.2, art, gruppe: 'f10' }])), 'nie leer: offener Faden mit eigenem Eintrag ' + art);
    ok(!gruppeIstLeer(fg(), kopf.map((e) => (e.nr === 6 ? Object.assign({}, e, { spielzeit: 220 }) : e))), 'nie leer: offener Faden, der länger als 5 s lief');
    const d7 = neuesVerz();
    const m7 = F.neuesSpiel({ crew: 1, seed: 3, names: ['Zed'], env: { MITSCHNITT: '1', MITSCHNITT_DIR: path.join(d7, 'mit'), REGIE_DIR: path.join(d7, 'regie') } }).g.mitschnitt;
    m7.v.eintraege.push(...kopf.map((e) => Object.assign({}, e, { nr: e.nr + 100 })));
    m7.v.gruppen.push(fg({ von_nr: 101, bis_nr: 106, kennung: 'falscher-handler' }));
    m7._leereMarkieren();
    ok(m7.v.gruppen[0].leer === true && m7.v.eintraege.length >= 6, 'Recorder: leerer offener Faden bekommt leer: true, die Einträge bleiben im Verlauf');
    const dR = neuesVerz();
    Mitschnitt.renderLader = () => require('../server/telemetrie/mitschnitt-render.js');
    const m8 = F.neuesSpiel({ crew: 1, seed: 3, names: ['Zed'], env: { MITSCHNITT: '1', MITSCHNITT_DIR: path.join(dR, 'mit'), REGIE_DIR: path.join(dR, 'regie') } }).g.mitschnitt;
    m8.lauf({ werkzeug: 'n2' });
    m8.v.eintraege.push(...kopf.map((e) => Object.assign({}, e, { nr: e.nr + 100 })));
    m8.v.gruppen.push(fg({ von_nr: 101, bis_nr: 106, kennung: 'falscher-handler', titel: 'Falscher Händler' }));
    m8.nr = 106;
    const o8 = m8.ende();
    const ix8 = o8 && fs.readFileSync(path.join(o8, 'index.md'), 'utf8');
    ok(o8 && !fs.existsSync(path.join(o8, '01_falscher-handler')) && ix8.includes('## Leere Versuche') && ix8.includes('| Falscher Händler | offen |'), 'Renderer: leerer offener Faden ohne eigenes mission.md, im Index unter Leere Versuche');
  }

  console.log('N2: Modell der Gruppe (Mock-Spielleiter, kein LLM)');
  {
    const Brett = require('../server/sim/abenteuer-brett.js');
    const modellSzenario = async (anschluss) => {
      const d = neuesVerz();
      const env = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: anschluss, MITSCHNITT: '1', MITSCHNITT_DIR: path.join(d, 'mit'), REGIE_DIR: path.join(d, 'regie') };
      const t = F.neuesSpiel({ crew: 1, seed: 7, names: ['Ada'], env });
      const g = t.g;
      const Z = Faden.zustandVon(g);
      const pumpen = async (k) => { for (let i = 0; i < k; i++) { g.step(); await frei(); } };
      await pumpen(20);
      for (let k = 0; k < 40 && !Z.abenteuerAngebote.length; k++) { if (anschluss === '0') g.lageSpielleiter.abenteuer.erzwingen(); await pumpen(4); }
      const a = Z.abenteuerAngebote[0];
      const antwort = a ? Brett.annehmen(g, 'a' + a.nr) : 'kein Angebot';
      await pumpen(5);
      const v = g.mitschnitt.verlauf();
      return { g, v, a, antwort, gruppe: a && v.gruppen.find((x) => x.angebot === a.nr), bau: v.eintraege.filter((e) => e.art === 'bauplan') };
    };
    const gut = await modellSzenario('0');
    ok(gut.a && gut.antwort === null && gut.gruppe && gut.gruppe.art === 'abenteuer', 'gültiger Fall: Angebot des Mock-Spielleiters angenommen, Gruppe vorhanden');
    const mg = gut.gruppe && gut.gruppe.modell;
    const gu = gut.bau.find((e) => e.ausgang === 'gueltig' && e.angebot === gut.a.nr);
    ok(gu && mg && mg.stufe === 'bauplan' && mg.anbieter === 'mock' && mg.modell === 'mock' && mg.quelle === 'mock' && mg.rueckfall === false && typeof mg.tokens === 'number' && mg.dauer_s != null && mg.vorlage === gu.vorlage, 'gültiger Fall: gruppe.modell gefüllt (Anbieter, Modell, Quelle, Rückfall false, Tokens, Dauer, Vorlage)');
    ok(mg && Array.isArray(mg.aufrufe) && mg.aufrufe.length >= 1 && mg.aufrufe[mg.aufrufe.length - 1].ausgang === 'gueltig', 'gültiger Fall: aufrufe endet mit dem gültigen Aufruf (abgelehnte Vorläufer zählen mit)');
    const rf = await modellSzenario('1');
    ok(rf.a && rf.antwort === null && rf.gruppe, 'Rückfall-Fall: Standardplan der Anschluss-Garantie angenommen, Gruppe vorhanden');
    const mr = rf.gruppe && rf.gruppe.modell;
    ok(mr && mr.rueckfall === true && mr.anbieter === null && mr.modell === null && mr.quelle === 'rueckfall' && mr.tokens === 0 && /^abenteuer_/.test(String(mr.vorlage)) && !rf.bau.some((e) => e.ausgang === 'gueltig'), 'Rückfall-Fall: gruppe.modell mit rueckfall true, ohne Anbieter und Modell, mit Vorlage-Key; kein Bauplan-Aufruf');
    const R2 = require('../server/telemetrie/mitschnitt-render.js');
    ok(R2.renderMission(gut.v, gut.gruppe).includes('Anbieter mock · Modell mock · Quelle mock · Rückfall: nein') && R2.renderMission(rf.v, rf.gruppe).includes('Rückfall: ja (kein Modell, Anschluss-Vorlage ' + mr.vorlage + ')'), 'Dokument: Modellweg-Zeile zeigt beide Fälle');
    for (const s of [gut, rf]) s.g.mitschnitt.ende();
  }

  // Aufräumen: keine offenen Mitschnitte beim Prozessende (der Exit-Haken würde sonst ins Temp schreiben)
  for (const g of [wirft.g, n.g]) g.mitschnitt.ende();
  console.log(fails ? `\n${fails} FEHLER` : '\nalle ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER ' + (e && e.stack)); process.exit(1); });
