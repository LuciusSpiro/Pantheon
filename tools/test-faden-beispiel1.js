'use strict';
// BEA-01 C1: das Referenzabenteuer Beispiel 1 (content/faeden/vorlagen/falscher_haendler.json), SIMULIERT durch alle Wege mit dem Mock-Spielleiter (kein Modell, kein Mensch).
//   Kette: bitte > b_fracht (LAEDT die Ware, ende geladen) > forderung (Piraten) > schmiergeld > b_kampf > b_abgabe (LIEFERT ab, ende abgeliefert) > enthuellung (sim_befehl invasion) > verfolgung > raumschlacht > abschluss
//   W1  laden, nicht ausliefern, Verweigern, Kampf gewonnen (echte Szene), abliefern, Enthuellung, Invasion (Standard-KI der Welt AKTIV, mehrere Seeds, nichts abgeschaltet), Verfolgung, Schlussschlacht
//   W2  laden, nicht ausliefern, Bestechen (Marken weg, kein Kampf), abliefern, Enthuellung, Invasion (Standard-KI aktiv)
//   W3  Ausliefern: Ware weg, Abschluss gescheitert, KEINE Enthuellung, KEINE Invasion
//   W4  Schweigen bei der Forderung (Frist): wie W3
//   W5  Kampf verloren (Frist): Ware weg, Abschluss gescheitert
//   W6  Bitte abgelehnt: Abschluss gescheitert, nie eine Ware
//   W7  Speichern und Laden mitten in der Forderung und im Schmiergeld: die Wahl gilt nach dem Laden
// Je Weg entsteht ein lesbarer Verlauf (Crew, Funk, Beats, Gedaechtnis, Ergebnis). Er wird NUR geschrieben, wenn ein Ordner angegeben ist: --verlauf <Ordner> oder Umgebungsvariable BEA01_VERLAUF
// (z. B. C:\Users\Luciu\projects\pantheon-erkundung\bea01-verlauf). Ohne Angabe wird nichts geschrieben, der Test prueft nur. Erwartete Werte stehen hier selbst (Daten gelesen, nie aus dem Produktivcode abgeleitet).
//   node tools/test-faden-beispiel1.js [begriff ...] [--verlauf <Ordner>]
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const V = require('./test-faden-vorlagen.js');   // Hilfen: neu (Spiel mit Mock-Spielleiter), runde, pumpen, notrufOhneOrt
const X = require('./faden-fixture.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Faden = require('../server/sim/faden.js');
const Fracht = require('../server/sim/faden-fracht.js');
const Geld = require('../server/sim/geld.js');
const Weltstand = require('../server/weltstand.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const { D } = X;
const { neu, runde, pumpen, notrufOhneOrt } = V;

const args = process.argv.slice(2);
const iV = args.indexOf('--verlauf');
const VERLAUF_DIR = iV >= 0 ? args[iV + 1] : process.env.BEA01_VERLAUF || '';
const FILTER = args.filter((a, i) => !a.startsWith('--') && (iV < 0 || i !== iV + 1)).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
async function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const FH = lies('content/faeden/vorlagen/falscher_haendler.json');
const TX = lies('content/faeden/p3-texte.json');
const SZ = lies('content/faeden/szenen-werte.json');
const FW = lies('content/faeden/forderung-werte.json').werte;
const FT = lies('content/faeden/forderung-texte.json');
const PREIS = FW.bestechung_marken.wert[FW.staerke_standard.wert];   // Staerke mittel (die Vorlage nennt sie, der Standard ist dieselbe)
const KETTE = ['b_bitte', 'b_fracht', 'b_forderung', 'b_schmier', 'b_kampf', 'b_abgabe', 'b_enthuell', 'b_jagd', 'b_schlacht', 'b_abschluss'];
const ORT = '0203';
const FEIND = ['sabotage', 'invasion'];
const klon = (x) => JSON.parse(JSON.stringify(x));
const beat = (id) => FH.beats.find((b) => b.id === id);
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const hexe = (g) => g.weltsim.zustand.hexe;
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const hochgestuft = (g) => g.weltsim.zustand.flotten.filter((fl) => fl.hochgestuft === true);
const befohleneAngriffe = (g) => g.weltsim.zustand.angriffe.filter((a) => a.befohlen === true);
const vorgemerkt = (g) => g.weltsim.regie.vorgemerkt.filter((e) => FEIND.includes(e.b.typ));
const lager = (g) => (g.fracht ? g.fracht.lager.length : 0);
const nameVon = (hex) => Sektoren.hexName(hex) || hex;
const marken = (g) => g.inventory.marks;

// ---------------------------------------------------------------- eine Partie mit Mitschnitt und Verlauf
function partie(seed) {
  const g = neu(seed);
  const p = { g, seed, zeilen: [], funk: [], gesehen: new WeakSet(), lager0: lager(g), faden: null, szenen: 0, letztesBeat: null };
  const orig = g.emit.bind(g);
  g.emit = (...a) => { if (a[0] === 'radio' && a[1]) { p.funk.push(a[1]); p.zeilen.push(`   FUNK   ${String(a[1].from || '?').padEnd(14)} ${a[1].text}`); } return orig(...a); };
  ankunft(g, '0305');   // die Crew fliegt (in einem Ort, nicht angedockt: sonst kaeme keine Szene)
  Geld.standSetzen(g, 500, 'testmarken');
  p.log = (t) => p.zeilen.push(t);
  p.sync = () => {   // neue Eintraege des Regie-Logbuchs (Beat-Start, Beat-Ende, Befehle) in den Verlauf
    for (const e of logbuch(g)) if (!p.gesehen.has(e)) {
      p.gesehen.add(e);
      if (e.art === 'faden_ereignis' && (e.ausgang === 'beat_start' || e.ausgang === 'beat_ende')) p.zeilen.push(`   BEAT   ${e.ausgang === 'beat_start' ? 'beginnt' : 'endet'} ${e.plan && e.plan.beat} ${e.begruendung ? '(' + String(e.begruendung).slice(0, 90) + ')' : ''}`);
      else if (e.art === 'faden_baustein') p.zeilen.push(`   KERN   ${e.ausgang}: ${String(e.begruendung || '').slice(0, 140)}`);
      else if (e.key === 'invasion') p.zeilen.push(`   KERN   Befehl invasion ${e.ausgang}`);
    }
  };
  return p;
}
const ereignisse = (f) => f.nsc.gedaechtnis.map((x) => x.ereignis);
async function runden(p, k) { for (let i = 0; i < k; i++) { await runde(p.g); p.sync(); } }
async function bisBitte(p) {
  const g = p.g;
  const a = notrufOhneOrt(g, 'notruf_havarie_konvoi', ORT, 'gelungen');
  const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'falscher_haendler', parameter: { angebot: a.nr } });
  if (!r.ok) throw new Error('Faden nicht geoeffnet: ' + r.grund);
  p.faden = r.faden;
  p.log(`CREW   Notruf bei ${nameVon(ORT)} (${a.vorlagen.join(', ')}): der Spielleiter oeffnet den Faden`);
  for (let i = 0; i < 8 && !Bitte.offen(g); i++) await runden(p, 1);
  return p.faden;
}
// die Crew antwortet auf das offene Angebot (Option-Id); wartet, bis es das Angebot des Beats gibt
async function waehle(p, optionId, text) {
  const g = p.g, f = p.faden;
  for (let i = 0; i < 12 && !(Bitte.offen(g) && Bitte.offen(g).fadenId === f.id && Bitte.offen(g).optionen.some((o) => o.id === optionId)); i++) await runden(p, 1);
  const a = Bitte.offen(g);
  if (!a || !a.optionen.some((o) => o.id === optionId)) throw new Error('Angebot ' + optionId + ' nicht da (' + (a && a.optionen.map((o) => o.id).join()) + ')');
  p.log(`CREW   waehlt "${a.optionen.find((o) => o.id === optionId).text}" (${optionId})${text ? ': ' + text : ''}`);
  const vorher = marken(g);
  const r = Bitte.beantworten(g, optionId, a.nr);
  (p.wahlen = p.wahlen || []).push({ id: optionId, vorher, nachher: marken(g) });
  if (r !== null) throw new Error('Antwort ' + optionId + ' abgelehnt: ' + JSON.stringify(r));
  p.sync();
}
async function bisWare(p) { for (let i = 0; i < 12 && !p.faden.fracht; i++) await runden(p, 1); }
// echte Kampfszene: Gegner dieser Szene (oder das Ziel der Verfolgung) abschiessen
async function kaempfen(p, typ) {
  const g = p.g;
  for (let i = 0; i < 900 && !(g.fadenSzene && g.fadenSzene.phase === 'kampf'); i++) await pumpen(g, 1);
  const fs2 = g.fadenSzene;
  if (!fs2 || fs2.phase !== 'kampf') return false;
  const gegner = typ === 'verfolgung' ? (g.space.verfolgung ? g.space.enemies.filter((e) => e.id === g.space.verfolgung.ziel) : []) : g.space.enemies.filter((e) => e.tag === fs2.tag);
  p.log(`CREW   kaempft: ${gegner.length} Gegner (${typ}) werden abgeschossen`);
  for (const e of gegner) Testhilfe.toeten(g, e);
  await pumpen(g, 6);
  p.szenen++;
  return true;
}
function abliefernAnDock(p) {
  const f = p.faden, g = p.g;
  p.log(`CREW   fliegt nach ${nameVon(f.fracht.nach)} und dockt an`);
  ankunft(g, f.fracht.nach); g.missionEvent('docked', {}); ab(g);
  p.sync();
}
// der Bot spielt den Faden: Entscheidungen je Beat aus plan { forderung, schmier, kampf, abliefern }; null = die Crew tut nichts (die Frist greift)
async function spiele(p, plan, o) {
  o = o || {};
  const g = p.g, f = p.faden;
  const v = D.vorlage('falscher_haendler');
  const erledigt = new Set();
  for (let r = 0; r < (o.runden || 900) && f.phase !== 'abgeschlossen'; r++) {
    if (o.vorher) o.vorher(g);
    Kriegslage.tick(g, 'test'); g.lageGrenze('szene_ende'); await pumpen(g, 3); p.sync();
    if (f.phase !== 'laeuft' || !f.laufend) continue;
    const bid = f.laufend.beat, key = bid + ':' + f.laufend.seit;
    if (p.letztesBeat !== key) { p.letztesBeat = key; p.log(`BEAT   ${bid} laeuft (${v.beats.find((b) => b.id === bid).typ})`); }
    if (erledigt.has(key)) continue;
    const typ = v.beats.find((b) => b.id === bid).typ;
    if (bid === 'b_forderung' || bid === 'b_schmier') {
      const wahl = bid === 'b_forderung' ? plan.forderung : plan.schmier;
      if (wahl === null || wahl === undefined) { erledigt.add(key); p.log(`CREW   schweigt (keine Antwort auf die Forderung)`); continue; }
      const a = Bitte.offen(g);
      if (a && a.fadenId === f.id && a.optionen.some((x) => x.id === wahl)) { await waehle(p, wahl); erledigt.add(key); }
    } else if (bid === 'b_kampf') {
      if (plan.kampf === 'gewinnen') { if (await kaempfen(p, typ)) erledigt.add(key); }
      else { erledigt.add(key); p.log('CREW   verliert den Kampf (tut nichts, die Frist des Beats greift)'); }
    } else if (bid === 'b_abgabe') {
      if (f.fracht && plan.abliefern !== false) { abliefernAnDock(p); erledigt.add(key); }
    } else if (['verfolgung', 'raumschlacht'].includes(typ)) { if (await kaempfen(p, typ)) erledigt.add(key); }
    else if (bid === 'b_bitte') {
      const a = Bitte.offen(g);
      if (a && a.fadenId === f.id) { await waehle(p, plan.bitte || 'annehmen'); erledigt.add(key); }
    }
  }
}
function abschluss(p, titel) {
  const f = p.faden, g = p.g;
  p.log('');
  p.log(`ERGEBNIS ${titel}: Faden ${f.phase}${f.ausgang ? ', Ausgang ' + f.ausgang.art : ''}, NSC ${f.nsc.status}, Ware am Faden: ${f.fracht ? 'ja' : 'nein'}, Frachtraum +${lager(g) - p.lager0}, Marken ${marken(g)}`);
  p.log(`ERGEBNIS Gedaechtnis des NSC: ${ereignisse(f).join(', ')}`);
  p.log(`ERGEBNIS Sim: ${hochgestuft(g).length} Flotte(n) hochgestuft, ${befohleneAngriffe(g).length} befohlene Feldzuege, ${vorgemerkt(g).length} vorgemerkte Faden-Befehle`);
}
function schreibe(p, datei, kopf) {
  if (!VERLAUF_DIR) return;
  fs.mkdirSync(VERLAUF_DIR, { recursive: true });
  fs.writeFileSync(path.join(VERLAUF_DIR, datei), kopf + '\n' + '='.repeat(60) + '\n' + p.zeilen.join('\n') + '\n', 'utf8');
}
const beatsGespielt = (p) => p.zeilen.filter((z) => /^BEAT {3}\S+ laeuft/.test(z)).map((z) => z.split(/\s+/)[1]);
const ohneEnthuellung = (p) => !p.funk.some((x) => /^Ich bin Germane/.test(String(x.text))) && vorgemerkt(p.g).length === 0 && hochgestuft(p.g).length === 0 && !befohleneAngriffe(p.g).length && !logbuch(p.g).some((e) => e.art === 'faden_baustein' && e.key === 'enthuellung');

(async () => {
  await section('Daten: die Vorlage ist Beispiel 1 (Kette, Wege, Parameter)', async () => {
    const r = Pruefer.pruefeVorlage(klon(FH));
    ok(r.ok, 'die Vorlage besteht den Pruefer (' + r.fehler.join('; ') + ')');
    ok(FH.beats.map((b) => b.id).join() === KETTE.join() && FH.beats.length === D.WERTE.vorlage_beats_max, 'zehn Beats in dieser Reihenfolge, genau vorlage_beats_max (' + D.WERTE.vorlage_beats_max + '): ' + FH.beats.map((b) => b.id).join(' > '));
    ok(beat('b_fracht').parameter.ende === 'geladen' && beat('b_abgabe').parameter.ende === 'abgeliefert' && FH.beats.filter((b) => b.typ === 'fracht').length === 2, 'ein Lade-Beat (b_fracht, ende geladen) und ein Abliefer-Beat (b_abgabe, ende abgeliefert)');
    const w = (id, ag) => beat(id).aus[ag].weiter;
    ok(w('b_bitte', 'gelungen') === 'b_fracht' && w('b_bitte', 'gescheitert') === 'b_abschluss' && w('b_fracht', 'gelungen') === 'b_forderung' && w('b_fracht', 'gescheitert') === 'b_abschluss', 'Bitte -> Laden; abgelehnt oder nichts geladen -> Abschluss');
    ok(w('b_forderung', 'gelungen') === 'b_schmier' && w('b_forderung', 'gescheitert') === 'b_abschluss', 'Forderung: nicht ausliefern -> Schmiergeld; Ausliefern (und Schweigen) -> Abschluss, nie Enthuellung');
    ok(w('b_schmier', 'gelungen') === 'b_abgabe' && w('b_schmier', 'gescheitert') === 'b_kampf', 'Schmiergeld: Bestechen -> Abliefern (kein Kampf); Verweigern -> Kampf');
    ok(w('b_kampf', 'gelungen') === 'b_abgabe' && w('b_kampf', 'gescheitert') === 'b_abschluss', 'Kampf gewonnen -> Abliefern; verloren -> Abschluss');
    ok(w('b_abgabe', 'gelungen') === 'b_enthuell' && w('b_abgabe', 'gescheitert') === 'b_abschluss', 'nur das Abliefern fuehrt zur Enthuellung');
    ok(beat('b_forderung').aus.gescheitert.status === 'aktiv' && beat('b_kampf').aus.gelungen.status === 'aktiv' && beat('b_kampf').aus.gescheitert.status === 'aktiv' && beat('b_schmier').aus.gescheitert.status === 'aktiv', 'NSC-Zustand: nach Forderung/Kampf bleibt der Haendler aktiv (raumschlacht kennt nur aktiv, feindlich, geflohen); schmiergeld.gescheitert setzt aktiv');
    ok(beat('b_forderung').parameter.staerke === 'mittel' && beat('b_forderung').parameter.text_key === undefined && beat('b_forderung').parameter.art === undefined && beat('b_schmier').parameter.staerke === 'mittel', 'Forderer: Freibeuter (Standardtext), art Standard ware, Staerke mittel');
    ok(beat('b_fracht').parameter.ladung === undefined && beat('b_fracht').parameter.illegal === undefined && beat('b_fracht').parameter.tarnung === undefined, 'die Ladung ist nicht als illegal oder getarnt gesetzt (Option, nicht Teil von C1)');
    ok(JSON.stringify(beat('b_enthuell').aus.gelungen.folge) === '[{"typ":"sim_befehl"}]' && JSON.stringify(beat('b_abschluss').erfolg) === '{"ereignis":["raumschlacht_gelungen"]}', 'sim_befehl nur in der Enthuellung; der Abschluss zaehlt raumschlacht_gelungen');
    ok(D.WERTE.sim_befehl.tat_beats.join() === 'fracht' && D.BEATS.fracht.ende_modi.modi.geladen.tat === false && D.BEATS.fracht.ende_modi.modi.abgeliefert.tat === true, 'Tat = Abliefern (tat_beats fracht, Modus geladen ist keine Tat)');
  });

  await section('Pruefer: Gegenproben der Wege (SIM_BEFEHL_OHNE_TAT, LADE_BEAT_DOPPELT, LADUNG_NICHT_ABGELIEFERT, vorlage_beats_max)', async () => {
    const codes = (v) => Pruefer.pruefeVorlage(v).fehler.map((t) => String(t).split(':')[0]);
    const aender = (id, f) => { const v = klon(FH); v.id = id; f(v); return v; };
    const b = (v, id) => v.beats.find((x) => x.id === id);
    ok(codes(klon(FH)).length === 0, 'die Vorlage selbst: kein Fehler');
    const c1 = codes(aender('bx_ausliefern', (v) => { b(v, 'b_forderung').aus.gescheitert.weiter = 'b_enthuell'; }));
    ok(c1.includes('SIM_BEFEHL_OHNE_TAT'), 'Ausliefern fuehrt in die Enthuellung: SIM_BEFEHL_OHNE_TAT (' + c1.join(',') + ')');
    const c2 = codes(aender('bx_bestechen', (v) => { b(v, 'b_schmier').aus.gelungen.weiter = 'b_enthuell'; }));
    ok(c2.includes('SIM_BEFEHL_OHNE_TAT'), 'Bestechen fuehrt an b_abgabe vorbei in die Enthuellung: SIM_BEFEHL_OHNE_TAT (' + c2.join(',') + ')');
    const c3 = codes(aender('bx_kampf', (v) => { b(v, 'b_kampf').aus.gelungen.weiter = 'b_enthuell'; }));
    ok(c3.includes('SIM_BEFEHL_OHNE_TAT'), 'Kampf gewonnen fuehrt an b_abgabe vorbei in die Enthuellung: SIM_BEFEHL_OHNE_TAT (' + c3.join(',') + ')');
    const c4 = codes(aender('bx_nurladen', (v) => { b(v, 'b_abgabe').parameter.ende = 'geladen'; }));
    ok(c4.includes('SIM_BEFEHL_OHNE_TAT') && c4.includes('LADE_BEAT_DOPPELT'), 'der zweite Fracht-Beat laedt nur (Laden zaehlt nicht als Tat): SIM_BEFEHL_OHNE_TAT und LADE_BEAT_DOPPELT (' + c4.join(',') + ')');
    const c5 = codes(aender('bx_doppelt', (v) => { const x = klon(b(v, 'b_fracht')); x.id = 'b_lade2'; x.hinweise = undefined; delete x.hinweise; v.beats.splice(1, 0, x); b(v, 'b_bitte').aus.gelungen.weiter = 'b_fracht'; b(v, 'b_fracht').aus.gelungen.weiter = 'b_lade2'; b(v, 'b_lade2').aus.gelungen.weiter = 'b_forderung'; v.beats = v.beats.filter((y) => y.id !== 'b_jagd'); b(v, 'b_enthuell').aus.gelungen.weiter = 'b_schlacht'; b(v, 'b_enthuell').aus.gescheitert.weiter = 'b_schlacht'; }));
    ok(c5.includes('LADE_BEAT_DOPPELT'), 'zwei Lade-Beats in einer Vorlage: LADE_BEAT_DOPPELT (' + c5.join(',') + ')');
    const c6 = codes(aender('bx_haengt', (v) => { b(v, 'b_schmier').aus.gelungen.weiter = 'b_abschluss'; }));
    ok(c6.includes('LADUNG_NICHT_ABGELIEFERT'), 'Bestechen fuehrt direkt in den Abschluss: die Ware bleibt haengen, LADUNG_NICHT_ABGELIEFERT (' + c6.join(',') + ')');
    const c7 = codes(aender('bx_haengt2', (v) => { b(v, 'b_kampf').aus.gelungen.weiter = 'b_abschluss'; }));
    ok(c7.includes('LADUNG_NICHT_ABGELIEFERT'), 'Kampf gewonnen fuehrt in den Abschluss: LADUNG_NICHT_ABGELIEFERT (' + c7.join(',') + ')');
    const c8 = codes(aender('bx_verweigern', (v) => { b(v, 'b_schmier').aus.gescheitert.weiter = 'b_abschluss'; }));
    ok(c8.includes('LADUNG_NICHT_ABGELIEFERT'), 'Verweigern fuehrt in den Abschluss (die Ware bleibt, schmiergeld ware_bei_scheitern bleibt): LADUNG_NICHT_ABGELIEFERT (' + c8.join(',') + ')');
    ok(!codes(aender('bx_ok1', (v) => { b(v, 'b_kampf').aus.gescheitert.weiter = 'b_abschluss'; })).includes('LADUNG_NICHT_ABGELIEFERT') && !codes(aender('bx_ok2', (v) => { b(v, 'b_forderung').aus.gescheitert.weiter = 'b_abschluss'; })).includes('LADUNG_NICHT_ABGELIEFERT'), 'Ausliefern und verlorener Kampf fuehren in den Abschluss ohne Fehler (die Ware ist dann weg)');
    ok(!codes(aender('bx_ok3', (v) => { b(v, 'b_abgabe').aus.gescheitert.weiter = 'b_abschluss'; })).includes('LADUNG_NICHT_ABGELIEFERT'), 'Abliefern gescheitert (Frist): die Ware ist weg, kein Fehler');
    const c9 = codes(aender('bx_elf', (v) => { const x = klon(b(v, 'b_bitte')); x.id = 'b_extra'; x.hinweise = []; v.beats.splice(9, 0, { id: 'b_extra', typ: 'raumschlacht', aus: { gelungen: { status: 'tot', weiter: 'b_abschluss' }, gescheitert: { status: 'geflohen', weiter: 'b_abschluss' } } }); }));
    ok(c9.includes('BEATS_ANZAHL'), 'elf Beats: BEATS_ANZAHL (vorlage_beats_max ' + D.WERTE.vorlage_beats_max + ')');
  });

  // ------------------------------------------------------------------------------------------------------------------------------
  const W1_SEEDS = [601, 602, 603];
  const w1 = { angenommen: 0, abgelehnt: 0 };
  for (const seed of W1_SEEDS) {
    await section(`W1 (Seed ${seed}): laden, nicht ausliefern, Verweigern, Kampf gewonnen, abliefern, Enthuellung, Invasion, Verfolgung, Schlussschlacht (Standard-KI aktiv)`, async () => {
      const p = partie(seed), g = p.g;
      const f = await bisBitte(p);
      await waehle(p, 'annehmen');
      await bisWare(p);
      ok(!!f.fracht && f.phase === 'wartet' && f.beat === 2 && lager(g) === p.lager0 + 1 && ereignisse(f).slice(-1)[0] === 'fracht_geladen', 'geladen: die Ware ist am Faden und im Frachtraum, der Faden steht vor der Forderung, Ereignis fracht_geladen');
      const m0 = marken(g);
      const kampfWar = { ware: null };
      await spiele(p, { forderung: 'nicht_ausliefern', schmier: 'verweigern', kampf: 'gewinnen' }, {
        vorher: () => { if (f.phase === 'wartet' && f.beat === 5 && kampfWar.ware === null) kampfWar.ware = !!f.fracht && lager(g) === p.lager0 + 1; },   // nach dem Kampf, vor dem Abliefern: die Ware ist noch da
      });
      ok(kampfWar.ware === true, 'nach dem gewonnenen Kampf ist die Ware noch am Faden und im Frachtraum (Verweigern nimmt sie nicht)');
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'Faden gelungen (' + f.phase + ', ' + (f.ausgang && f.ausgang.art) + ')');
      ok(beatsGespielt(p).join() === ['b_forderung', 'b_schmier', 'b_kampf', 'b_abgabe', 'b_enthuell', 'b_jagd', 'b_schlacht'].join() || beatsGespielt(p).join() === ['b_forderung', 'b_schmier', 'b_kampf', 'b_abgabe', 'b_jagd', 'b_schlacht'].join(), 'Beats in der Reihenfolge der Daten (ohne Bestechen: mit Kampf): ' + beatsGespielt(p).join(' > '));
      const vw = (p.wahlen || []).find((x) => x.id === 'verweigern');
      ok(!!vw && vw.vorher === vw.nachher && vw.vorher === m0, 'Verweigern kostet nichts (Marken ' + (vw && vw.vorher) + ' -> ' + (vw && vw.nachher) + ')');
      const e = ereignisse(f);
      ok(e.slice(0, 6).join() === 'bitte_gelungen,fracht_geladen,forderung_gelungen,schmiergeld_gescheitert,raumschlacht_gelungen,fracht_gelungen', 'Gedaechtnis: Bitte, geladen, Forderung abgelehnt, Schmiergeld verweigert, Kampf gewonnen, abgeliefert (' + e.join(',') + ')');
      ok(!f.fracht && lager(g) === p.lager0 && p.funk.some((x) => x.text === SZ.texte.fracht.abgeliefert.replace('{ware}', SZ.werte.waren.wert.fracht_kiste.name).replace('{hafen}', nameVon(ORT)) || /abgeliefert\.$/.test(String(x.text))), 'abgeliefert: die Ware ist weg, der Frachtraum leer, Funk "abgeliefert"');
      const lb = logbuch(g).find((x) => x.art === 'faden_baustein' && x.plan && x.plan.beat === 'b_enthuell');
      const angenommen = !!lb && lb.ausgang === 'sim_befehl';
      if (angenommen) {
        w1.angenommen++;
        const ziel = lb.plan.ziele.invasion;
        ok(!!ziel && p.funk.some((x) => x.text === TX.texte.enthuellung_invasion.replace('{invasion}', nameVon(ziel))), 'Enthuellung: "die Ladung war Waffe", Invasion gegen ' + nameVon(ziel) + ' angekuendigt');
        for (let i = 0; i < 10 && !hochgestuft(g).length; i++) { Kriegslage.tick(g, 'test'); p.sync(); }
        ok(hochgestuft(g).length >= 1 && hochgestuft(g).every((fl) => fl.fraktion === 'ger'), 'die Invasion wirkt in der Sim: ' + hochgestuft(g).length + ' germanische Flotte(n) hochgestuft (Standard-KI der Welt lief weiter)');
        ok(f.nsc.status === 'tot' || f.nsc.status === 'feindlich' || f.nsc.status === 'geflohen', 'der Haendler ist Feind (' + f.nsc.status + ')');
      } else {
        w1.abgelehnt++;
        ok(!!lb && lb.ausgang === 'sim_befehl_abgelehnt' && f.nsc.status !== 'verbuendet' && /Ich bin Germane/.test(p.funk.map((x) => x.text).join('|')), 'Enthuellung: der Kern lehnt die Invasion ab (' + (lb && lb.begruendung) + '), der Haendler enthuellt sich trotzdem');
      }
      ok(p.szenen >= 3, 'echte Kampfszenen: Kampf gegen die Piraten, Verfolgung, Schlussschlacht (' + p.szenen + ')');
      abschluss(p, 'W1 Seed ' + seed + (angenommen ? ' (Invasion angenommen)' : ' (Invasion vom Kern abgelehnt)'));
      schreibe(p, `W1-verweigern-kampf-abliefern-seed${seed}.txt`, `BEA-01 C1, Weg W1 (Seed ${seed}): Haendler bittet, Crew LAEDT, Piraten fordern, nicht ausliefern, Verweigern, Kampf gewonnen, Crew LIEFERT AB, Enthuellung, Invasion, Verfolgung, Schlussschlacht. Standard-KI der Welt aktiv.`);
    });
  }
  await section('W1: ueber die Seeds greift die Invasion (Standard-KI aktiv, nichts abgeschaltet)', async () => {
    if (FILTER.length && !FILTER.some((x) => 'w1'.includes(x) || x.includes('w1'))) return;
    ok(w1.angenommen + w1.abgelehnt === W1_SEEDS.length && w1.angenommen >= 1, `von ${W1_SEEDS.length} Seeds hat der Kern ${w1.angenommen} Invasion(en) angenommen, ${w1.abgelehnt} abgelehnt (mindestens eine muss wirken; Ablehnungen sind erlaubt und geloggt)`);
  });

  await section('W2: laden, nicht ausliefern, Bestechen, abliefern, Enthuellung, Invasion (kein Kampf)', async () => {
    let angenommen = 0;
    for (const seed of [611, 612, 613]) {
      const p = partie(seed), g = p.g;
      const f = await bisBitte(p);
      await waehle(p, 'annehmen');
      await bisWare(p);
      const m0 = marken(g);
      await spiele(p, { forderung: 'nicht_ausliefern', schmier: 'bestechen' });
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', `Seed ${seed}: Faden gelungen`);
      const bw = (p.wahlen || []).find((x) => x.id === 'bestechen');
      ok(!!bw && bw.vorher - bw.nachher === PREIS && bw.vorher === m0, `Seed ${seed}: Bestechen bucht ${PREIS} Marken (${bw && bw.vorher} -> ${bw && bw.nachher}; der Stand am Ende ${marken(g)} enthaelt Belohnungen des Rests)`);
      ok(!beatsGespielt(p).includes('b_kampf') && beatsGespielt(p).slice(0, 3).join() === 'b_forderung,b_schmier,b_abgabe', `Seed ${seed}: kein Kampf gegen die Piraten (${beatsGespielt(p).join(' > ')})`);
      ok(ereignisse(f).slice(0, 5).join() === 'bitte_gelungen,fracht_geladen,forderung_gelungen,schmiergeld_gelungen,fracht_gelungen', `Seed ${seed}: Gedaechtnis ${ereignisse(f).join(',')}`);
      const lb = logbuch(g).find((x) => x.art === 'faden_baustein' && x.plan && x.plan.beat === 'b_enthuell');
      ok(!!lb && p.funk.some((x) => /^Ich bin Germane/.test(String(x.text))), `Seed ${seed}: Enthuellung nach dem Abliefern (${lb && lb.ausgang})`);
      if (lb && lb.ausgang === 'sim_befehl') { angenommen++; for (let i = 0; i < 10 && !hochgestuft(g).length; i++) { Kriegslage.tick(g, 'test'); p.sync(); } ok(hochgestuft(g).length >= 1, `Seed ${seed}: Invasion wirkt (${hochgestuft(g).length} Flotte hochgestuft)`); }
      abschluss(p, 'W2 Seed ' + seed);
      schreibe(p, `W2-bestechen-abliefern-seed${seed}.txt`, `BEA-01 C1, Weg W2 (Seed ${seed}): Crew LAEDT, Piraten fordern, nicht ausliefern, BESTECHEN (${PREIS} Marken), kein Kampf, Crew LIEFERT AB, Enthuellung, Invasion. Standard-KI der Welt aktiv.`);
    }
    ok(angenommen >= 1, 'mindestens eine der drei Invasionen wurde vom Kern angenommen (' + angenommen + ')');
  });

  await section('W3: Ausliefern: Ware weg, Abschluss gescheitert, keine Enthuellung, keine Invasion', async () => {
    for (const seed of [621, 622]) {
      const p = partie(seed), g = p.g;
      const f = await bisBitte(p);
      await waehle(p, 'annehmen');
      await bisWare(p);
      const m0 = marken(g);
      await spiele(p, { forderung: 'ausliefern' });
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && f.nsc.status === 'aktiv', `Seed ${seed}: Faden endet gescheitert, der Haendler bleibt aktiv (${f.ausgang && f.ausgang.art}, ${f.nsc.status})`);
      ok(!f.fracht && lager(g) === p.lager0 && p.funk.some((x) => x.text === SZ.texte.fracht.verloren.replace('{ware}', SZ.werte.waren.wert.fracht_kiste.name).replace('{hafen}', nameVon(ORT)) || /Die Ware ist verloren/.test(String(x.text))), `Seed ${seed}: Ware weg (Faden und Frachtraum), Funk "verloren"`);
      ok(beatsGespielt(p).join() === 'b_forderung,b_abschluss' || beatsGespielt(p).join() === 'b_forderung', `Seed ${seed}: gespielt nur die Forderung (und der Abschluss): ${beatsGespielt(p).join(' > ')}`);
      ok(ohneEnthuellung(p), `Seed ${seed}: KEINE Enthuellung, KEINE Invasion, kein Faden-Befehl (vorgemerkt ${vorgemerkt(g).length}, hochgestuft ${hochgestuft(g).length})`);
      ok(marken(g) === m0 && ereignisse(f).join() === 'bitte_gelungen,fracht_geladen,fracht_gescheitert,forderung_gescheitert,abschluss_gescheitert', `Seed ${seed}: keine Marken weg; Gedaechtnis ${ereignisse(f).join(',')}`);
      ok(P_notruf(f) === 'notruf_erinnert_fracht', `Seed ${seed}: ein spaeterer Notruf erinnert sich an die verlorene Ladung`);
      abschluss(p, 'W3 Seed ' + seed);
      schreibe(p, `W3-ausliefern-seed${seed}.txt`, `BEA-01 C1, Weg W3 (Seed ${seed}): Crew LAEDT, Piraten fordern, AUSLIEFERN: Ware weg, Abschluss gescheitert, keine Enthuellung, keine Invasion.`);
    }
  });

  await section('W4: Schweigen bei der Forderung (Frist): wie W3', async () => {
    const p = partie(631), g = p.g;
    const f = await bisBitte(p);
    await waehle(p, 'annehmen');
    await bisWare(p);
    await spiele(p, { forderung: null });
    ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && !f.fracht && lager(g) === p.lager0, 'Schweigen gilt als Ausliefern: Faden gescheitert, Ware weg');
    ok(ohneEnthuellung(p), 'KEINE Enthuellung, KEINE Invasion');
    ok(ereignisse(f).slice(0, 5).join() === 'bitte_gelungen,fracht_geladen,fracht_gescheitert,forderung_gescheitert,abschluss_gescheitert', 'Gedaechtnis wie bei Ausliefern (' + ereignisse(f).join(',') + ')');
    abschluss(p, 'W4');
    schreibe(p, 'W4-schweigen-seed631.txt', 'BEA-01 C1, Weg W4 (Seed 631): Crew LAEDT, Piraten fordern, die Crew schweigt (Frist): wie Ausliefern.');
  });

  await section('W5: Kampf verloren: Ware weg, Abschluss gescheitert', async () => {
    const p = partie(641), g = p.g;
    const f = await bisBitte(p);
    await waehle(p, 'annehmen');
    await bisWare(p);
    await spiele(p, { forderung: 'nicht_ausliefern', schmier: 'verweigern', kampf: 'verlieren' });
    ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', 'Faden gescheitert');
    ok(!f.fracht && lager(g) === p.lager0 && p.funk.some((x) => /Die Ware ist verloren/.test(String(x.text))), 'Ware weg (Kampf verloren), Funk "verloren", Frachtraum leer');
    ok(!beatsGespielt(p).includes('b_abgabe') && beatsGespielt(p).includes('b_kampf') && ohneEnthuellung(p), 'kein Abliefern, KEINE Enthuellung, KEINE Invasion (' + beatsGespielt(p).join(' > ') + ')');
    ok(ereignisse(f).join().startsWith('bitte_gelungen,fracht_geladen,forderung_gelungen,schmiergeld_gescheitert,fracht_gescheitert,raumschlacht_gescheitert'), 'Gedaechtnis (' + ereignisse(f).join(',') + ')');
    abschluss(p, 'W5');
    schreibe(p, 'W5-kampf-verloren-seed641.txt', 'BEA-01 C1, Weg W5 (Seed 641): Crew LAEDT, nicht ausliefern, Verweigern, der Kampf geht verloren (Frist): Ware weg, Abschluss gescheitert.');
  });

  await section('W6: Bitte abgelehnt: nie eine Ware, Abschluss gescheitert', async () => {
    const p = partie(651), g = p.g;
    const f = await bisBitte(p);
    const h0 = f.nsc.haltung;
    await waehle(p, 'ablehnen');
    await spiele(p, {});
    ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && !f.fracht && lager(g) === p.lager0 && f.nsc.haltung < h0, `Faden gescheitert, nie eine Ware, Haltung sinkt (${h0} -> ${f.nsc.haltung})`);
    ok(beatsGespielt(p).join() === 'b_abschluss' || beatsGespielt(p).join() === '', 'es lief kein Beat zwischen Bitte und Abschluss (' + beatsGespielt(p).join(' > ') + ')');
    ok(ohneEnthuellung(p) && ereignisse(f).join() === 'bitte_gescheitert,abschluss_gescheitert', 'KEINE Enthuellung, KEINE Invasion; Gedaechtnis ' + ereignisse(f).join(','));
    abschluss(p, 'W6');
    schreibe(p, 'W6-bitte-abgelehnt-seed651.txt', 'BEA-01 C1, Weg W6 (Seed 651): die Crew lehnt die Bitte des Haendlers ab: keine Ware, Abschluss gescheitert.');
  });

  await section('W7: Speichern und Laden mitten in der Forderung und im Schmiergeld', async () => {
    const p = partie(661), g = p.g;
    const f = await bisBitte(p);
    await waehle(p, 'annehmen');
    await bisWare(p);
    for (let i = 0; i < 12 && !(Bitte.offen(g) && Bitte.offen(g).fadenId === f.id); i++) await runden(p, 1);   // der Spielleiter startet die Forderung
    const a = Bitte.offen(g);
    ok(!!a && a.optionen.map((o) => o.id).join() === 'ausliefern,nicht_ausliefern' && f.phase === 'laeuft', 'die Forderung steht offen (Ausliefern, Nicht ausliefern)');
    // Speichern: mitten in der Forderung
    const stand1 = Weltstand.capture(g);
    ok(Weltstand.validate(stand1, g).length === 0, 'der Stand mit offener Forderung besteht das Schema');
    p.log('CREW   speichert mitten in der Forderung und laedt in einer neuen Partie');
    const q = partie(662); const g2 = q.g;
    Weltstand.apply(g2, JSON.parse(JSON.stringify(stand1)));
    const f2 = g2.weltsim.faeden.liste.find((x) => x.id === f.id);
    q.faden = f2; q.lager0 = lager(g2) - (f2.fracht ? 1 : 0);
    const a2 = Bitte.offen(g2);
    ok(!!a2 && a2.optionen.map((o) => o.id).join() === 'ausliefern,nicht_ausliefern' && a2.text === a.text && !!f2.fracht && Fracht.anBord(g2, f2.id), 'nach dem Laden steht dieselbe Forderung (Text, Optionen) und die Ware liegt noch an Bord');
    q.log('CREW   (geladen) die Forderung steht noch');
    await waehle(q, 'nicht_ausliefern');
    for (let i = 0; i < 12 && !(Bitte.offen(g2) && Bitte.offen(g2).optionen.some((o) => o.id === 'bestechen')); i++) await runden(q, 1);
    ok(!!Bitte.offen(g2) && Bitte.offen(g2).optionen.map((o) => o.id).join() === 'bestechen,verweigern', 'nach "Nicht ausliefern" kommt im geladenen Stand das Schmiergeld');
    // Speichern: mitten im Schmiergeld, laden, bestechen
    const stand2 = Weltstand.capture(g2);
    const r = partie(663); const g3 = r.g;
    Weltstand.apply(g3, JSON.parse(JSON.stringify(stand2)));
    const f3 = g3.weltsim.faeden.liste.find((x) => x.id === f.id);
    r.faden = f3; r.lager0 = lager(g3) - 1;
    const m0 = marken(g3);
    ok(Bitte.offen(g3) && Bitte.offen(g3).optionen.map((o) => o.id).join() === 'bestechen,verweigern' && marken(g3) === marken(g2), 'zweites Laden mitten im Schmiergeld: Angebot und Marken wie vor dem Speichern');
    r.log('CREW   speichert mitten im Schmiergeld und laedt noch einmal');
    await waehle(r, 'bestechen');
    ok(marken(g3) === m0 - PREIS && f3.beat === 5 && !!f3.fracht, `Bestechen im geladenen Stand: ${PREIS} Marken gebucht, die Ware bleibt, weiter zum Abliefern`);
    await spiele(r, { abliefern: true });
    ok(f3.phase === 'abgeschlossen' && f3.ausgang.art === 'gelungen' && !f3.fracht, 'der geladene Faden laeuft bis zum Abliefern, zur Enthuellung und zum Abschluss (' + f3.phase + ')');
    ok(r.funk.some((x) => /^Ich bin Germane/.test(String(x.text))), 'die Enthuellung kam nach dem Abliefern');
    abschluss(r, 'W7');
    schreibe(r, 'W7-speichern-laden-seed663.txt', 'BEA-01 C1, Weg W7 (Seed 661 -> 662 -> 663): Speichern und Laden mitten in der Forderung und im Schmiergeld, danach Bestechen, Abliefern, Enthuellung. (Der Verlauf zeigt nur die Zeilen nach dem zweiten Laden.)');
    // Gegenprobe: laden mitten in der Forderung, dann Ausliefern -> gescheitert, keine Enthuellung
    const s = partie(664); const g4 = s.g;
    Weltstand.apply(g4, JSON.parse(JSON.stringify(stand1)));
    s.faden = g4.weltsim.faeden.liste.find((x) => x.id === f.id); s.lager0 = lager(g4) - 1;
    await waehle(s, 'ausliefern');
    await spiele(s, {});
    ok(s.faden.phase === 'abgeschlossen' && s.faden.ausgang.art === 'gescheitert' && !s.faden.fracht && ohneEnthuellung(s), 'geladen mitten in der Forderung, dann Ausliefern: gescheitert, Ware weg, keine Enthuellung');
  });

  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log('FADEN-BEISPIEL1 FEHLER: ' + fails); process.exit(1); }
  console.log('FADEN-BEISPIEL1 OK');
})().catch((e) => { console.log('ABSTURZ Ausnahme: ' + (e && e.stack)); process.exit(1); });

// der Text, den ein spaeterer Notruf dieses NSC nimmt (erinnert sich an die Ladung)
function P_notruf(f) { return require('../server/sim/faden-p3.js').notrufText(f.nsc, { parameter: { text_key: 'notruf_standard' } }); }
