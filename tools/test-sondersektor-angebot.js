'use strict';
// SON-01 C: der Angebotsweg des Sondersektors Helix im STANDARD (Rueckfall ohne Modell: FAEDEN=1, REISE_EREIGNISSE=1, LAGE_SPIELLEITER=1, SPIELLEITER_RUECKFALL=1, 0 Komponisten-Aufrufe), der Ausgang und das Aufraeumen.
// Der Weg: anschluss.json hat den siebten Plan "Helix ruft um Hilfe" (Beat sondersektor, nur_inszenierer: nie im Prompt-Katalog des Modells); der Rueckfall des Bretts waehlt ihn wie jeden Plan, aber nur, wo die Lage passt
// (faden-pruefer.js pruefeLage fragt jeden Baustein, der angebotFehler kennt: Pulverhorn in hoechstens 3 Spruengen vom Hafen, nicht schon gelungen). Im Modus Absichten (ABENTEUER_ABSICHTEN) ist dieselbe Lage die Welt-Bedingung der
// Absicht forschungsstation (absichten.json, Standard-Parametrierung = derselbe Plan).
//   A  Daten und Pruefer: Plan und Absicht, Lage am Hafen (nah, weit, nach Erfolg, nach Verlust), Prompt (Katalog mit und ohne den Beat gleich, kein Helix im Plan-Katalog, Absichten-Zeile)
//   B  Brett im Standard: Helix liegt (Seeds) in Haefen bis 3 Spruenge von Pulverhorn, nie weiter weg; der Ort des Angebots ist nie Helix; Zielwahl anderer Angebote unberuehrt (100 Wuerfe je Hafen)
//   C  Bot-Lauf Brett -> Annehmen -> Beat -> Buch bis abliefern -> Faden gelungen: Crew 1 und Crew 3 (220 Marken, Flag, errors 0, pending 0, 0 Komponisten-Aufrufe), Ortsangabe, Einmaligkeit nach Erfolg
//   D  Folgebeat liest den Hex (Plan sondersektor, notruf, abschluss)
//   E  Ausgang verloren: Faden gescheitert, Buch endet, kein Neustart; danach ist wieder ein Angebot moeglich
//   F  Voraussetzungen ueber den Angebotsweg: Pulverhorn zu weit (kein Angebot, Angebot veraltet), Szene, andere Mission
//   G  Speichern und Laden ueber den Brett-Weg: Angebot am Brett, Beat mitten im Buch
//   H  Haltefeld nach Fristablauf mitten im Finale
//   node tools/test-sondersektor-angebot.js [--nur A,B,C1,C3,D,E,F,G,H]      Mutationsprobe: tools/mutation-sondersektor-angebot.js
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const R = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Zonen = require('../shared/zonen.js');
const Mon = require('../shared/monster.js');
const Locations = require('../shared/locations.js');
const Sektoren = require('../shared/sektoren.js');
const away = require('../server/sim/away.js');
const Anker = require('../server/sim/anker.js');
const Monster = require('../server/sim/monster.js');
const ZonenSim = require('../server/sim/zonen.js');
const Lpscan = require('../server/sim/lpscan.js');
const Faden = require('../server/sim/faden.js');
const D = require('../server/sim/faden-daten.js');
const P = require('../server/sim/faden-pruefer.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const BP = require('../server/sim/faden-bauplan.js');
const AP = require('../server/sim/absicht-pruefer.js');
const INS = require('../server/sim/inszenierer.js');
const Absicht = require('../server/sim/abenteuer-absicht.js');
const Sond = require('../server/sim/sondersektoren.js');
const SB = require('../server/sim/faden-sondersektor.js');
const B1 = require('../server/sim/faden-b1.js');
const Ziel = require('../server/sim/abenteuer-ziel.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');
const Mock = require('../server/sim/abenteuer-mock.js');
const Dat = require('../server/weltsim/daten.js');
const Fz = (g) => Faden.zustandVon(g);

const DT = 1 / CONFIG.tickHz;
const NUR = (process.argv.indexOf('--nur') > 0 ? process.argv[process.argv.indexOf('--nur') + 1] : '').split(',').filter(Boolean);
const gewollt = (k) => !NUR.length || NUR.includes(k);
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const frei = () => new Promise((r) => setImmediate(r));
async function abschnitt(name, key, body) {
  if (!gewollt(key)) return;
  console.log('\n[' + name + ']');
  try { await body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund', 'Dara_Voss'];
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };   // der Standard des Servers im Rueckfall, kein Modell
const BUCH = 'sl_forschung';
const HELIX = Sond.sektor('helix');
const KAT = AP.katalogStandard();
const AD = require('../server/sim/abenteuer-daten.js').WERTE;
const lies = (rel) => JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const ANS = lies('content/faeden/anschluss.json');

function neuesSpiel(crew, seed, o) {
  const t = R.neuesSpiel(Object.assign({ crew, seed, names: NAMEN.slice(0, crew), env: ENV }, o || {}));
  Fz(t.g).abenteuerAngebote.length = 0;   // der Spielstart legt schon ein Angebot: leeres Brett, dann fuellt das Andocken
  return t;
}
const sl = (g) => g.lageSpielleiter;
const liste = (g) => Fz(g).liste;
const istHelix = (a) => a.vorlage.beats.some((b) => b.typ === 'sondersektor');
const helixAngebot = (g) => P.regulaereAngebote(Fz(g)).find(istHelix) || null;
const mStand = (g) => g.mission.missions[BUCH] || null;
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const sbLog = (g) => logbuch(g).filter((e) => e.art === 'faden_baustein' && e.key === 'sondersektor');
function funkMit(g) {
  const out = []; const orig = g.emit.bind(g);
  g.emit = (...a) => { if (a[0] === 'radio' && a[1]) out.push(a[1]); return orig(...a); };
  return out;
}
// Das Brett fuellen wie das Andocken (game.js missionEvent docked): zuerst leeren, dann beiAndocken
function andocken(g) { Fz(g).abenteuerAngebote.length = 0; Brett.beiAndocken(g); return helixAngebot(g); }
// ein Spiel, in dem beim ersten Andocken ein Helix-Angebot liegt (Seeds der Reihe nach); Rueckgabe { t, seed, versuche }
// (Mit o.dir: erst ohne Weltstand-Verzeichnis suchen, dann denselben Seed dort neu aufbauen: ein Verzeichnis gehoert nur einem Spiel.)
function mitHelixAngebot(crew, o) {
  for (let seed = 1; seed <= 80; seed++) {
    const t = neuesSpiel(crew, seed);
    if (!andocken(t.g)) continue;
    if (!o) return { t, seed, versuche: seed };
    const t2 = neuesSpiel(crew, seed, o);
    return andocken(t2.g) ? { t: t2, seed, versuche: seed } : null;
  }
  return null;
}
// Takt wie im Betrieb: eine Taetigkeit (Andocken), danach ein paar Ticks; der Rueckfall fuehrt den Faden
const takt = (g, schritte) => { Faden.taetigkeit(g, 'andocken'); for (let i = 0; i < (schritte || 3); i++) g.step(); };
const beatsGestartet = (g, f) => logbuch(g).filter((e) => e.art === 'faden_ereignis' && e.ausgang === 'beat_start' && e.key === f.id).length;
const faedenVon = (g) => liste(g).filter((f) => f.plan);
// Ein Ort, von dem aus Pulverhorn mehr als 3 Spruenge entfernt ist (Ortsname der Szene)
function weitOrt() {
  const t = neuesSpiel(1, 1).g;
  for (const h of Object.keys(t.weltsim.zustand.hexe)) { const o = Sektoren.ortVonHex(h); if (o && Sektoren.spielbar(h) && !B1.erreichbar(t, h, 3).has(HELIX.von) && B1.erreichbar(t, h, 20).has(HELIX.von) && Sektoren.hatSzene(h)) return o; }
  return null;
}
const WEIT = weitOrt();

// ---------- Bot (Muster tools/test-sondersektor-beat.js und tools/test-forschungsstation.js; der Rueckfall hat keinen Mock-Spielleiter, die Schleife bleibt async wie dort)
function hilfe(g, cs) {
  g.god = true;
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  const HZ = Math.max(1, Math.round(CONFIG.tickHz));
  const T = { g, cs, mev };
  T.run = async (sec, each) => { const ticks = Math.round(sec / DT); for (let k = 0; k < ticks; k++) { if (each && each(k * DT) === true) return true; g.step(); if (k % HZ === 0) await frei(); } return false; };
  T.cmd = (cmd, f) => { cs[0].inbox.length = 0; g.handleMessage(cs[0], Object.assign({ t: 'cmd', c: cmd }, f || {})); return cs[0].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.rolle = (r) => { g.players[0].console = r; };
  T.energie = (o) => { Object.assign(g.ship.powerIntent || (g.ship.powerIntent = {}), o); Object.assign(g.ship.power, o); };
  T.fliege = (ziele, grenzeS, abbruch) => {
    T.rolle('helm');
    let i = 0; let prev = { x: g.ship.x, y: g.ship.y };
    return T.run(grenzeS, () => {
      const sh = g.ship; const z = ziele[i];
      if (!z) return true;
      const sx = z.x - prev.x, sy = z.y - prev.y, sl2 = Math.hypot(sx, sy) || 1;
      if (((sh.x - z.x) * sx + (sh.y - z.y) * sy) / sl2 >= -30) { prev = z; i++; return false; }
      const dd = Math.max(1, Math.hypot(z.x - sh.x, z.y - sh.y)); const ux = (z.x - sh.x) / dd, uy = (z.y - sh.y) / dd;
      const v = Zonen.wirkung(ZonenSim.szeneZonen(g), sh.x + ux * 120, sh.y + uy * 120);
      const e = ((sh.x - prev.x) * -sy + (sh.y - prev.y) * sx) / sl2; const nx = -sy / sl2, ny = sx / sl2;
      const want = Math.atan2(uy * 140 - v.vy - ny * e * 0.5, ux * 140 - v.vx - nx * e * 0.5);
      let d = want - sh.angle; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      sh.helm.stage = 5; sh.helm.turn = Math.max(-1, Math.min(1, d * 2.5));
      return abbruch ? abbruch() : false;
    });
  };
  return T;
}
// Vom Schritt anflug_helix (nach dem Auftrag) bis zur Ablieferung in Concordia. bis = 'finale': nur bis in das Haltefeld (Schritt finale)
async function buchSpielen(T, pre, bis) {
  const g = T.g, m = g.mission, p = pre ? pre + ': ' : '';
  await T.run(5);
  ok(m.step && m.step.id === 'anflug_helix', p + 'Schritt anflug_helix (nach dem Auftrag)');
  ok(!!g.explore.tempKante(Sektoren.kanteId('0605', '0506')), p + 'der temporaere Sprungpunkt Pulverhorn -> Helix ist offen (das Buch oeffnet ihn)');
  g.debugGoto('helix', false); await T.run(2);
  ok(m.step && m.step.id === 'gravimetrie', p + 'am Helix: Schritt gravimetrie');
  const gv = Locations.get('helix').scene.gravimetrie;
  g.ship.x = gv.start.x; g.ship.y = gv.start.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0;
  T.energie({ engines: 3, shields: 2, weapons: 1 });
  T.rolle('weapons'); await T.run(0.2);
  ok(T.cmd('weapons.zonenscan').length === 0, p + 'Ops startet den Zonen-Scan');
  await T.run(3.5);
  ok(ZonenSim.istBekannt(g, 'gravi_feld0'), p + 'Scan fertig: gravi_feld0 bekannt');
  await T.fliege(gv.weg.slice(1), 90, () => m.step && m.step.id === 'station');
  await T.run(1);
  ok(m.step && m.step.id === 'station' && !T.mev.some((e) => e.kind === 'zoneRuecksetzen'), p + 'Station erreicht ohne Ruecksetzer, Schritt station');
  g.ship.helm.stage = 1; g.ship.helm.turn = 0; g.ship.vx = 0; g.ship.vy = 0;
  T.rolle('weapons'); g.ship.vx = 0; g.ship.vy = 0; await T.run(0.3);
  if (!Lpscan.gescannt(g, 'helix.station')) {
    ok(Lpscan.ziele(g).some((q) => q.id === 'helix.station'), p + 'Landepunkt helix.station in Scanreichweite');
    ok(T.cmd('weapons.landescan').length === 0, p + 'Ops startet den Landepunkt-Scan');
    await T.run(4.5);
    ok(Lpscan.gescannt(g, 'helix.station'), p + 'Landepunkt gescannt');
  }
  const err = g.chooseLandepunkt(g.players[0], 'helix.station');
  away.executeBeam(g, g.players.map((q) => q.id), 'down');
  await T.run(1);
  const aw = g.away;
  ok(!err && aw.map === 'helix.station' && aw.monster && aw.monsterPulte, p + 'Team auf der Station, Monster und Pulte eingerichtet');
  const k = g.karteOf(aw.map); const mk = Monster.maskeVon(k); const PU = aw.monsterPulte;
  const hacken = async (id) => {
    const pos = PU.pos[id]; const pa = Mon.naechster(mk, pos[0], pos[1], 2); const pc = Mon.mitte(pa);
    g.players[0].x = pc.x; g.players[0].y = pc.y;
    Anker.setzen(g, aw.map, id, 'laedt', g.players[0].id);
    const dp = Mon.bfs(mk, [pa]); let fern = null, fd = -1;
    for (let cy = 1; cy < mk.h; cy++) for (let cx = 1; cx < mk.w; cx++) { const d = dp[cy * mk.w + cx]; if (d > fd) { fd = d; fern = { cx, cy }; } }
    const M = aw.monster; const fp = Mon.mitte(fern);
    await T.run(6.2, () => { M.laerm = { x: fp.x, y: fp.y, t: g.time, w: 900, art: 'fertig' }; if (M.z === 'jagd') { M.z = 'laerm'; M.verlust = 0; } M.x = fp.x; M.y = fp.y; M.pfad = []; return false; });
    Anker.completeHold(g, g.players[0], { kind: 'anker:terminal', anker: id, op: 'download', tx: pos[0], ty: pos[1] });
    await T.run(0.5);
  };
  for (let i = 0; i < 4; i++) { await hacken(PU.order[i]); if (g.players[0].downed) break; }
  ok(PU.erledigt === 4 && PU.fertig, p + 'vier Pulte gehackt (' + PU.erledigt + '/4)');
  await T.run(1.5);
  ok(m.step && m.step.id === 'rueckbeamen' && ZonenSim.szeneZonen(g).some((z) => z.id === 'halt_feld'), p + 'Haltefeld an, Schritt rueckbeamen');
  away.executeBeam(g, g.players.map((q) => q.id), 'up'); g.players.forEach((q) => { q.zone = 'ship'; });
  await T.run(2);
  ok(m.step && m.step.id === 'finale', p + 'Team an Bord: Schritt finale');
  if (bis === 'finale') return;
  g.ship.x = gv.station.x; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0;
  T.energie({ engines: 4, shields: 1, weapons: 1 });
  await T.fliege(gv.fluchtweg, 60, () => m.step && m.step.id === 'abliefern_anflug');
  await T.run(1);
  ok(m.step && m.step.id === 'abliefern_anflug', p + 'aus dem Haltefeld heraus: Schritt abliefern_anflug');
  const m0 = g.inventory.marks;
  g.debugGoto('concordia', true); await T.run(3);
  const ms = mStand(g);
  ok(ms && ms.state === 'done' && ms.ausgang === 'erfolg', p + 'in Concordia angedockt: Buch fertig, Ausgang erfolg');
  ok(g.inventory.marks >= m0 + 220 && m.state.flags && m.state.flags.forschungFertig === true, p + 'Lohn 220 Marken, Flag forschungFertig');
}
async function buchVerlieren(T) {
  const g = T.g, m = g.mission;
  await T.run(4);
  g.debugGoto('helix', false); await T.run(1.5);
  const gv = Locations.get('helix').scene.gravimetrie;
  g.ship.x = gv.station.x - 100; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0;
  m.forceStep(BUCH, 'station'); await T.run(1);
  Lpscan.markieren(g, 'helix.station');
  g.chooseLandepunkt(g.players[0], 'helix.station'); away.executeBeam(g, g.players.map((q) => q.id), 'down'); await T.run(1);
  const k = g.karteOf(g.away.map); const mk = Monster.maskeVon(k); const p = g.players[0];
  const a = Mon.naechster(mk, Math.floor(p.x / 32), Math.floor(p.y / 32), 2); const pc = Mon.mitte(a); p.x = pc.x; p.y = pc.y;
  const dn = Mon.bfs(mk, [a]); let mp = null;
  for (let cy = 1; cy < mk.h && !mp; cy++) for (let cx = 1; cx < mk.w; cx++) if (dn[cy * mk.w + cx] === 3) { mp = { cx, cy }; break; }
  const M = g.away.monster; const mpos = Mon.mitte(mp); M.x = mpos.x; M.y = mpos.y; M.pfad = []; M.pause = 0;
  await T.run(15, () => mStand(g).state === 'done' || (m.step && m.step.id !== 'station'));
}
// Das Angebot annehmen (Brett-Befehl) und den Rueckfall den Beat starten lassen (ein Takt). -> { fehler, f }
// direkt: der Rueckfall startet den Beat ohne Sim-Tick (Aufruf wie der Takt, ohne dass eine vorgetaeuschte Szene den Tick der Sim stoert)
function annehmenUndStarten(g, a, direkt) {
  const fehler = Brett.annehmen(g, 'a' + a.nr);
  const f = faedenVon(g).find((x) => x.vorlage === a.ref) || null;
  if (direkt) Brett.abenteuerRueckfallWeiter(g); else g.step();
  return { fehler, f };
}
// Den Faden nach dem Buch bis zum Abschluss fuehren (der Rueckfall startet den Abschluss-Beat, sobald er faellig ist)
function bisAbschluss(g, f) { for (let i = 0; i < 80 && f.phase !== 'abgeschlossen'; i++) takt(g); return f.phase === 'abgeschlossen'; }
// Andere Abenteuer spielen (Beat-Typ je Abenteuer, ueber das Brett angenommen und ueber die echten Ausgaenge beendet; Muster tools/test-abenteuer-rueckfall.js): die Wiederholungsregel Folge (abenteuer-brett.json folge_zuletzt)
// laesst dieselbe Typenfolge erst wieder zu, wenn drei andere Abenteuer dazwischen lagen
function andereAbenteuer(g, typen) {
  typen.forEach((typ, i) => {
    const r = Faden.abenteuerAnbieten(g, { format: 'faden-bauplan/1', titel: 'Probe Auftrag ' + typ, anlass: 'Ein Probeanlass ohne Namen fuer das Brett.', beats: [{ typ }, { typ: 'abschluss' }], volk_erlaubt: ['rom'] }, { hex: '0305' });
    if (!r.ok) throw new Error('Probe-Abenteuer ' + typ + ': ' + r.grund);
    if (Brett.annehmen(g, 'a' + r.angebot.nr) !== null) throw new Error('Probe-Abenteuer ' + typ + ' nicht annehmbar');
    const f = faedenVon(g).find((x) => x.vorlage === r.angebot.ref), v = D.vorlage(f.vorlage);
    for (let k = f.beat; k < v.beats.length && f.phase !== 'abgeschlossen'; k++) { f.beat = k; f.phase = 'laeuft'; f.laufend = { beat: v.beats[k].id, n: 0, seit: 0 }; Faden.beatAusgang(g, f.id, 'gelungen'); }
  });
}
const komponist0 = (g) => sl(g).aufrufe === 0 && sl(g).abenteuer.aufrufe === 0 && (sl(g).llm == null || sl(g).llm.mode === 'off');

(async () => {
  // ---------------- A: Daten und Pruefer
  await abschnitt('A  Daten, Lage, Prompt', 'A', async () => {
    const plan = ANS.plaene.find((p) => p.beats[0].typ === 'sondersektor');
    ok(!!plan && plan.beats.length === 2 && plan.beats[1].typ === 'abschluss' && !plan.beats[0].parameter, 'anschluss.json: der Plan "' + (plan && plan.titel) + '" (sondersektor, abschluss), der Sektor kommt aus dem Standard des Beats (helix)');
    const r = BP.pruefe(plan);
    ok(r.ok && r.vorlage.beats[0].parameter.sektor === 'helix', 'der Plan besteht Expander und Pruefer (sektor ' + (r.ok && r.vorlage.beats[0].parameter.sektor) + ')');
    const e = KAT.absichten.forschungsstation;
    ok(!!e && e.standard.titel === plan.titel && e.standard.bogen.einsatz === plan.anlass && e.inszenierung.skelett.beats[0].typ === 'sondersektor', 'absichten.json: die Absicht forschungsstation hat dieselbe Standard-Parametrierung (Titel, Anlass, Beat)');
    // die Lage des Angebots
    const t = neuesSpiel(1, 5), g = t.g;
    ok(P.pruefeLage(g, r.vorlage) === null && SB.voraussetzungen(g, HELIX) === null, 'im Hafen Ostia Nova (3 Spruenge bis Pulverhorn): die Lage passt');
    ok(Brett.neuAnbieten(g, plan, { hex: '0305' }).ok, 'Brett.neuAnbieten legt das Angebot an');
    g.ship.scene = WEIT;
    const weit = P.pruefeLage(g, r.vorlage);
    ok(/^LAGE_SONDERSEKTOR: .*nicht in hoechstens 3 Spruengen/.test(weit || ''), 'weit weg (' + WEIT + '): die Lage verweigert (' + weit + ')');
    ok(!Brett.neuAnbieten(g, plan, { hex: '0305' }).ok, 'weit weg: kein Angebot ueber das Brett');
    g.ship.scene = 'ostia_nova';
    g.mission.missions[BUCH] = { state: 'done', ausgang: 'erfolg' };
    ok(/schon gelungen/.test(P.pruefeLage(g, r.vorlage) || ''), 'nach einem Erfolg: die Lage verweigert (schon gelungen)');
    g.mission.missions[BUCH] = { state: 'done', ausgang: 'verloren' };
    ok(P.pruefeLage(g, r.vorlage) === null, 'nach einem Verlust: die Lage passt wieder (einmal bei_erfolg)');
    // die Absicht: derselbe Plan ueber den Inszenierer, und dieselben Neins
    const abs = { format: 'absicht/1', absicht: 'forschungsstation', titel: e.standard.titel, parameter: {}, bezug: {}, bogen: JSON.parse(JSON.stringify(e.standard.bogen)), ton: e.standard.ton };
    delete g.mission.missions[BUCH];
    Fz(g).abenteuerAngebote.length = 0;   // die Wiederholungsregel (Folge) laesst keine zwei gleiche Plaene zugleich am Brett zu
    const a1 = INS.anbietenAusAbsicht(g, abs, KAT);
    ok(a1.ok && istHelix(a1.angebot) && a1.angebot.vorlage.id === r.vorlage.id, 'Absicht forschungsstation: der Inszenierer bietet denselben Plan an (Vorlagen-Id gleich)');
    g.ship.scene = WEIT;
    const a2 = INS.anbietenAusAbsicht(g, abs, KAT);
    ok(!a2.ok && a2.fehler.some((f) => /LAGE_SONDERSEKTOR/.test(f.grund)), 'Absicht weit weg: Nein mit dem Grund der Lage');
    g.ship.scene = 'ostia_nova'; g.mission.missions[BUCH] = { state: 'done', ausgang: 'erfolg' };
    const a3 = INS.anbietenAusAbsicht(g, abs, KAT);
    ok(!a3.ok && a3.fehler.some((f) => /schon gelungen/.test(f.grund)), 'Absicht nach Erfolg: Nein (schon gelungen)');
    // Prompt: der Beat ist nur ueber den Inszenierer erreichbar
    const kat = Prompt.katalogText();
    const katOhne = (() => { const alle = Object.entries(D.BEATS); try { delete D.BEATS.sondersektor; Prompt.katalogNeuLesen(); return Prompt.katalogText(); } finally { for (const k of Object.keys(D.BEATS)) delete D.BEATS[k]; for (const [k, v] of alle) D.BEATS[k] = v; Prompt.katalogNeuLesen(); } })();   // PAR-01 Empfehlung 7: Mengenbeziehung statt fester Zahl
    ok(kat === katOhne && Prompt.katalogText() === kat && !/sondersektor|Sondersektor|Helix/.test(kat), 'Prompt-Katalog des Modells: mit und ohne den Eintrag sondersektor im Speicher derselbe Text (' + kat.length + ' Zeichen), ohne sondersektor und Helix');
    let mitBeat = 0;
    for (let i = 0; i < 300; i++) { const p = Mock.gueltigerPlan(Mock.rngVon('son01c-' + i), {}); if (JSON.stringify(p).includes('sondersektor')) mitBeat++; }
    ok(mitBeat === 0, 'Mock-Plankette: in 300 Zufallsplaenen kein Beat sondersektor');
    const ka = Prompt.katalogTextAbsicht(KAT);
    ok(/^forschungsstation: /m.test(ka) && e.prompt_zeile.length <= KAT.werte.prompt_zeile_max.wert, 'Absichten-Katalog: die Zeile forschungsstation steht darin (' + e.prompt_zeile.length + ' Zeichen)');
    const q = Absicht.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: AD });
    ok(!q.fehler && q.zeichen <= AD.prompt_max_zeichen, 'Absichten-Prompt mit dem Rezept: ' + (q.fehler || q.zeichen + ' Zeichen, Katalog ' + q.katalogZeichen + ', Kontext ' + q.kontextZeichen) + ' (Grenze ' + AD.prompt_max_zeichen + ')');
    info('MESSUNG Katalog des Modells ' + kat.length + ' Zeichen; Absichten-Katalog ' + ka.length + '; Absichten-Prompt ' + q.zeichen);
    ok(g.errors === 0, 'Serverfehler 0');
  });

  // ---------------- B: das Brett im Standard
  await abschnitt('B  Brett im Standard (Rueckfall, kein Modell)', 'B', async () => {
    let nah = 0; const orte = new Set(); const herk = new Set(); let falsch = 0, ohneBrett = 0, ersteSeeds = 0, snapOk = 0, snapFalsch = 0, kompo = 0;
    const N = 40;
    for (let seed = 1; seed <= N; seed++) {
      const t = neuesSpiel(1 + (seed % 3), seed), g = t.g;
      Brett.beiAndocken(g);
      const a = helixAngebot(g);
      if (!a) continue;
      nah++; if (seed <= 10) ersteSeeds++;
      orte.add(a.hex); herk.add(a.herkunft && a.herkunft.hex);
      if (a.hex === '0506' || !a.herkunft || !B1.erreichbar(g, a.herkunft.hex, 3).has('0605')) falsch++;
      const s = Brett.snapshot(g), e = s && s.angebote.find((x) => x.id === 'a' + a.nr);
      if (e && e.ort_offen === true && e.ort === '' && e.titel === a.vorlage.titel && e.typen.includes('sondersektor') && e.hafen) snapOk++; else snapFalsch++;
      if (!komponist0(g)) kompo++;
    }
    ok(nah >= 5, 'Haefen bis 3 Spruenge von Pulverhorn: in ' + nah + ' von ' + N + ' Seeds liegt beim ersten Andocken ein Helix-Angebot am Brett (' + ersteSeeds + ' davon in den ersten zehn Seeds)');
    ok(falsch === 0, 'jedes Helix-Angebot: Herkunft = Hafen in hoechstens 3 Spruengen von Pulverhorn, Ort des Angebots nie Helix (' + Array.from(orte).sort().join(',') + ' bei ' + Array.from(herk).sort().join(',') + ')');
    ok(snapFalsch === 0 && snapOk === nah, 'Snapshot: die Karte nennt den Hafen, keinen Ort (ort_offen), Titel und Typen stimmen (' + snapOk + ' Karten)');
    ok(kompo === 0, '0 Komponisten-Aufrufe in allen Laeufen (kein Modell)');
    // Modus Absichten (Opt-in ABENTEUER_ABSICHTEN=1, derselbe Rueckfall ueber den Inszenierer): die Absicht forschungsstation kommt vor, ebenfalls nur in Reichweite
    {
      let nahA = 0, weitA = 0, planOk = 0;
      for (let seed = 1; seed <= N; seed++) {
        const t = neuesSpiel(1, seed, { env: Object.assign({}, ENV, { ABENTEUER_ABSICHTEN: '1' }) }), g = t.g;
        Brett.beiAndocken(g);
        const a = helixAngebot(g);
        if (a) { nahA++; if (a.absicht && a.absicht.absicht === 'forschungsstation' && a.vorlage.id === BP.pruefe(ANS.plaene.find((p) => p.beats[0].typ === 'sondersektor')).vorlage.id) planOk++; }
        Fz(g).abenteuerAngebote.length = 0; g.ship.scene = WEIT; Brett.beiAndocken(g);
        if (helixAngebot(g)) weitA++;
      }
      ok(nahA >= 3 && planOk === nahA && weitA === 0, 'Modus Absichten: in ' + nahA + ' von ' + N + ' Seeds kommt die Absicht forschungsstation (derselbe Plan, Absicht am Angebot), weit weg nie (' + weitA + ')');
    }
    // weit weg: nie
    let weitAngebote = 0;
    for (let seed = 1; seed <= N; seed++) { const t = neuesSpiel(1, seed), g = t.g; g.ship.scene = WEIT; for (let i = 0; i < 3; i++) { Brett.beiAndocken(g); if (helixAngebot(g)) weitAngebote++; Fz(g).abenteuerAngebote.length = 0; } }
    ok(weitAngebote === 0, 'weit weg (' + WEIT + '): in ' + N + ' Seeds mit je 3 Fuellungen nie ein Helix-Angebot (' + weitAngebote + ')');
    // Zielwahl der anderen Angebote unberuehrt: 100 Wuerfe je Hafen, auch mit offenem Sprungpunkt und offenem Helix-Angebot
    const { t } = mitHelixAngebot(1) || {};
    ok(!!t, 'ein Spiel mit Helix-Angebot am Brett');
    const g = t.g, d = Dat.datenVon(g.weltsim.zustand);
    g.mission.startMission(BUCH);
    for (let i = 0; i < 400; i++) g.step();
    ok(!!g.explore.tempKante(Sektoren.kanteId('0605', '0506')), 'der Sprungpunkt nach Helix ist offen');
    const haefen = Object.keys(g.weltsim.zustand.hexe).filter((h) => d.hex[h] && d.hex[h].hafen).sort();
    let wuerfe = 0, helix = 0, ziele = 0;
    for (const h of haefen) {
      if (Ziel.kandidaten(g, h).includes('0506')) helix++;
      for (let i = 0; i < 100; i++) { Fz(g).angNr = i; const z = Ziel.zielImUmkreis(g, h, { belegt: [] }); wuerfe++; if (z === '0506') helix++; if (z) ziele++; }
    }
    ok(haefen.length >= 3 && wuerfe === haefen.length * 100 && ziele > 0 && helix === 0, wuerfe + ' Zielwuerfe in ' + haefen.length + ' Haefen (' + ziele + ' mit Ziel): Helix nie Ziel, nie Kandidat');
    ok(!B1.erreichbar(g, '0605', 3).has('0506'), 'erreichbar() kennt die temporaere Kante weiterhin nicht (unveraendert)');
  });

  // ---------------- C: Bot-Lauf ueber das Brett, Crew 1 und 3
  for (const crew of [1, 3]) {
    await abschnitt('C  Bot-Lauf Brett -> Annehmen -> Beat -> Buch -> gelungen, Crew ' + crew, 'C' + crew, async () => {
      const gef = mitHelixAngebot(crew);
      ok(!!gef, 'Crew ' + crew + ': ein Helix-Angebot am Brett (Seed ' + (gef && gef.seed) + ')');
      const { t } = gef, g = t.g;
      const funk = funkMit(g);
      const T = hilfe(g, t.cs);
      const a = helixAngebot(g);
      const marks0 = g.inventory.marks;
      ok(Fz(g).abenteuerAngebote.includes(a) && sl(g).rueckfallBetrieb === true && !g.mission.activeId, 'Standard: Rueckfall-Betrieb ohne Modell, keine Mission');
      const { fehler, f } = annehmenUndStarten(g, a);
      ok(fehler === null && !!f, 'Annehmen ueber das Brett (kein Fehler, Faden da)');
      ok(f.phase === 'laeuft' && f.laufend && f.laufend.beat === D.vorlage(f.vorlage).beats[0].id && g.mission.activeId === BUCH && mStand(g).state === 'active', 'der Rueckfall hat Beat 0 gestartet: der Beat laeuft, das Buch ' + BUCH + ' ist aktiv');
      ok(funk.some((r) => /Hier Forschungsstation Helix/.test(r.text) && /0506/.test(r.text)), 'die Station spricht zum Start');
      await buchSpielen(T, 'Crew ' + crew);
      await T.run(1);
      const ort0 = f.parameter.ort;
      ok(ort0 === HELIX.ausgang.hex, 'Ausgang gebucht: faden.parameter.ort = ausgang.hex (' + ort0 + ')');
      const ausg = funk.find((r) => /Die Daten sind raus/.test(r.text));
      ok(!!ausg && ausg.text.includes(HELIX.ausgang.hex) && ausg.text.includes(Sektoren.hexName(HELIX.ausgang.hex)) && !/[{}]/.test(ausg.text) && ausg.from === 'Forschungsstation Helix', 'der Funk nennt Ort und Koordinate des Ausgangs ("' + (ausg && ausg.text) + '")');
      ok(funk.indexOf(ausg) > funk.findIndex((r) => /Messreihe ist gerettet/.test(r.text)), 'erst der Erfolg der Station, dann der Ausgang');
      ok(bisAbschluss(g, f) && f.ausgang && f.ausgang.art === 'gelungen', 'der Faden endet gelungen (' + (f.ausgang && f.ausgang.art) + ')');
      ok(g.inventory.marks >= marks0 + 220 && g.mission.state.flags.forschungFertig === true, 'Marken +220 (' + (g.inventory.marks - marks0) + '), Flag forschungFertig');
      // Chronik und Fakt des Buchausgangs stehen im Weltstand-Block data (g.weltstand.data.fakten / .chronik, nicht g.weltstand.fakten: das war der Auslesefehler im Mess-Skript m5 der Erkundung)
      const wd = g.weltstand && g.weltstand.data;
      ok(!!wd && wd.fakten.forschungFertig === 'ja' && wd.faktenQuelle.forschungFertig === 'Forschungsstation Helix', 'Weltstand-Fakt forschungFertig = ja (Quelle Forschungsstation Helix): die Freie Fahrt schreibt ihn');
      ok(!!wd && wd.chronik.some((c) => c.mission === BUCH && c.ausgang === 'erfolg' && /Forschungsstation Helix/.test(c.text)), 'Chronik: der Eintrag des Buchausgangs steht in weltstand.data.chronik (' + (wd && wd.chronik.length) + ' Eintraege)');
      ok(g.errors === 0 && (g.mission.pending || []).length === 0 && P.abenteuerLaufend(Fz(g)) === 0, 'errors 0, pending 0, kein Abenteuer laeuft mehr (das Brett ist frei)');
      ok(komponist0(g), '0 Komponisten-Aufrufe');
      ok(f.parameter.ort === HELIX.ausgang.hex, 'der Ortsparameter bleibt bis zum Ende des Fadens (' + f.parameter.ort + ')');
      // Einmaligkeit je Partie: kein zweites Angebot, der Beat startet nicht erneut (Brett UND direkter Start). Die Ablieferung liegt in Concordia, weit von Pulverhorn: erst zurueck in den Hafen, damit die Einmaligkeit (nicht die Reichweite) das Angebot verweigert
      g.debugGoto('ostia_nova', true); await T.run(3);
      ok(SB.voraussetzungen(g, HELIX) !== null && /schon gelungen/.test(SB.voraussetzungen(g, HELIX)) && !/Spruengen/.test(P.pruefeLage(g, BP.pruefe(ANS.plaene.find((p) => p.beats[0].typ === 'sondersektor')).vorlage) || ''), 'im Hafen Ostia Nova: Pulverhorn ist in Reichweite, nur die Einmaligkeit verweigert');
      let neu = 0;
      for (let i = 0; i < 40; i++) { Fz(g).angNr += 1; Fz(g).abenteuerAngebote.length = 0; Brett.beiAndocken(g); if (helixAngebot(g)) neu++; Brett.beiTaetigkeit(g); if (helixAngebot(g)) neu++; }
      ok(neu === 0, 'nach gelungen: in 40 Fuellungen des Bretts nie wieder ein Helix-Angebot (' + neu + ')');
      const plan = ANS.plaene.find((p) => p.beats[0].typ === 'sondersektor');
      ok(!Brett.neuAnbieten(g, plan, { hex: '0305' }).ok && !INS.anbietenAusAbsicht(g, { format: 'absicht/1', absicht: 'forschungsstation', titel: 'Helix ruft um Hilfe', parameter: {}, bezug: {}, bogen: JSON.parse(JSON.stringify(KAT.absichten.forschungsstation.standard.bogen)), ton: 'dringlich' }, KAT).ok, 'nach gelungen: weder Brett noch Absicht bieten Helix an');
      // direkter Start (ein Faden mit dem Beat, am Pruefer vorbei geoeffnet wie ein Test es tut): der Beat meldet gescheitert, das Buch startet nicht
      const stand0 = JSON.stringify(mStand(g)), starts = T.mev.filter((e) => e.kind === 'missionStart').length;
      const SBres = SB.starten(g, f, { beat: { id: 'x', typ: 'sondersektor', parameter: { sektor: 'helix' } } });
      ok(SBres.ausgang === 'gescheitert' && /schon gelungen/.test(sbLog(g).filter((e) => e.ausgang === 'abgelehnt').pop().begruendung), 'direkter Start nach Erfolg: gescheitert, Logbuch nennt den Grund');
      ok(JSON.stringify(mStand(g)) === stand0 && g.mission.activeId === null && T.mev.filter((e) => e.kind === 'missionStart').length === starts, 'das Buch wurde nicht neu gestartet');
      // ein altes Angebot, das vor dem Erfolg am Brett lag, ist veraltet (kein totes Angebot): Plan manuell am Pruefer vorbei einlegen und annehmen
      Fz(g).abenteuerAngebote.length = 0;
      const r = Faden.abenteuerAnbieten(g, plan, { hex: '0305' });
      ok(!r.ok && /LAGE_SONDERSEKTOR/.test(r.grund || ''), 'Faden.abenteuerAnbieten verweigert den Plan nach dem Erfolg (' + String(r.grund).slice(0, 60) + ')');
    });
  }

  // ---------------- D: ein Folgebeat liest den Hex
  await abschnitt('D  Folgebeat (notruf) liest den Ausgangs-Hex', 'D', async () => {
    const t = neuesSpiel(1, 33), g = t.g, funk = funkMit(g), T = hilfe(g, t.cs);
    const plan = { format: 'faden-bauplan/1', titel: 'Helix und danach', anlass: 'Erst die Station, dann ein Hilferuf vom Ausgang.', beats: [{ typ: 'sondersektor' }, { typ: 'notruf' }, { typ: 'abschluss' }], volk_erlaubt: ['rom'] };
    const bp = BP.pruefe(plan);
    ok(bp.ok, 'der Plan sondersektor, notruf, abschluss besteht Expander und Pruefer' + (bp.ok ? '' : ': ' + bp.fehler.join('; ')));
    const r = Brett.neuAnbieten(g, plan, { hex: '0305', herkunft: '0305' });
    ok(r.ok, 'als Angebot am Brett');
    const { fehler, f } = annehmenUndStarten(g, r.angebot);
    ok(fehler === null && g.mission.activeId === BUCH, 'angenommen, das Buch laeuft');
    await buchSpielen(T, 'Folge');
    await T.run(1);
    ok(f.parameter.ort === HELIX.ausgang.hex, 'nach dem Buch ist der Ort des Fadens der Ausgang (' + f.parameter.ort + ')');
    let notrufBeat = null;
    for (let i = 0; i < 80 && !notrufBeat; i++) { takt(g); notrufBeat = logbuch(g).find((e) => e.art === 'faden_baustein' && e.key === 'notruf' && e.plan && e.plan.faden === f.id); }
    ok(!!notrufBeat && notrufBeat.ausgang === 'notruf' && notrufBeat.plan.hex === HELIX.ausgang.hex, 'der Folgebeat notruf liest den Hex vom Faden: Logbuch hex ' + (notrufBeat && notrufBeat.plan && notrufBeat.plan.hex));
    ok(funk.some((r2) => r2.text.includes('Notruf von ' + Sektoren.hexName(HELIX.ausgang.hex))), 'der Notruf nennt den Namen des Ausgangs (' + Sektoren.hexName(HELIX.ausgang.hex) + ')');
    ok(g.errors === 0, 'Serverfehler 0');
  });

  // ---------------- E: verloren
  await abschnitt('E  Ausgang verloren: gescheitert, kein Neustart, danach wieder ein Angebot', 'E', async () => {
    const gef = mitHelixAngebot(1);
    const { t } = gef, g = t.g, funk = funkMit(g), T = hilfe(g, t.cs);
    const a = helixAngebot(g);
    const { fehler, f } = annehmenUndStarten(g, a);
    ok(fehler === null && g.mission.activeId === BUCH, 'angenommen, das Buch laeuft');
    await buchVerlieren(T);
    const ms = mStand(g);
    ok(ms && ms.state === 'done' && ms.ausgang === 'verloren', 'alle am Boden: Ausgang verloren des Buchs');
    await T.run(2);
    const gedaechtnis = f.nsc.gedaechtnis.map((x) => x.ereignis);
    ok(gedaechtnis.includes('sondersektor_gescheitert') && !gedaechtnis.includes('sondersektor_gelungen'), 'der Beat meldet gescheitert (Gedaechtnis ' + gedaechtnis.slice(-2).join(',') + ')');
    ok(funk.some((r) => /Messreihe ist verloren/.test(r.text)) && !funk.some((r) => /Die Daten sind raus/.test(r.text)), 'die Station meldet den Verlust, kein Ausgangsfunk');
    ok(f.parameter.ort !== HELIX.ausgang.hex, 'der Ort des Fadens wurde nicht zum Ausgang gesetzt (' + f.parameter.ort + ')');
    const starts = T.mev.filter((e) => e.kind === 'missionStart').length;
    ok(bisAbschluss(g, f) && f.ausgang && f.ausgang.art === 'gescheitert', 'der Rueckfall fuehrt den Faden zu Ende: gescheitert (' + (f.ausgang && f.ausgang.art) + ')');
    await T.run(40);
    ok(g.mission.activeId === null && mStand(g).state === 'done' && mStand(g).ausgang === 'verloren' && T.mev.filter((e) => e.kind === 'missionStart').length === starts, 'kein Neustart des Buchs (40 s spaeter noch Ende verloren, keine aktive Mission)');
    ok(g.errors === 0 && P.abenteuerLaufend(Fz(g)) === 0 && komponist0(g), 'errors 0, das Brett ist frei, 0 Komponisten-Aufrufe');
    // nach dem Verlust ist ein neues Angebot moeglich: die Lage passt, Brett und Absicht bieten es an
    g.debugGoto('ostia_nova', true); await T.run(3);
    const plan = ANS.plaene.find((p) => p.beats[0].typ === 'sondersektor');
    ok(P.pruefeLage(g, BP.pruefe(plan).vorlage) === null, 'nach dem Verlust: die Lage passt');
    const wd = require('../server/sim/abenteuer-wiederholung.js').pruefe(g, BP.pruefe(plan).vorlage, '0305');
    ok(/^WIEDERHOLUNG_FOLGE/.test(wd || ''), 'direkt nach dem Verlust haelt nur die Wiederholungsregel Folge (letzte 3 Abenteuer) den Plan zurueck (' + String(wd).slice(0, 40) + '), nicht die Einmaligkeit');
    Fz(g).abenteuerAngebote.length = 0;
    andereAbenteuer(g, ['geruecht', 'spur', 'konvoi']);
    let neu = 0;
    for (let i = 0; i < 60 && !neu; i++) { Fz(g).angNr += 1; Fz(g).abenteuerAngebote.length = 0; Brett.beiAndocken(g); if (helixAngebot(g)) neu++; }
    ok(neu === 1, 'nach dem Verlust und drei anderen Abenteuern bietet das Brett Helix wieder an (Rueckfall, ohne Modell)');
    const a2 = helixAngebot(g);
    const er = annehmenUndStarten(g, a2);
    ok(er.fehler === null && g.mission.activeId === BUCH && mStand(g).state === 'active' && mStand(g).ausgang === undefined, 'zweiter Anlauf: angenommen, das Buch startet neu (Missionsstand neu, ohne alten Ausgang)');
  });

  // ---------------- F: Voraussetzungen ueber den Angebotsweg
  await abschnitt('F  Voraussetzungen ueber den Angebotsweg', 'F', async () => {
    // Pulverhorn zu weit: das Angebot ist veraltet, nichts startet
    {
      const { t } = mitHelixAngebot(1), g = t.g, funk = funkMit(g);
      const a = helixAngebot(g);
      g.debugGoto(WEIT, false);
      const e = Brett.annehmen(g, 'a' + a.nr);
      ok(e && e.code === 'veraltet', 'Crew woanders (' + WEIT + '): Annehmen -> veraltet (' + (e && e.code) + ')');
      ok(!Fz(g).abenteuerAngebote.includes(a) && !mStand(g) && !g.mission.activeId && !funk.some((r) => /Forschungsstation Helix/.test(r.text)), 'das Angebot ist vom Brett, das Buch nie gestartet, keine Ansage');
      ok(logbuch(g).some((l) => l.ausgang === 'abenteuer_veraltet' && /LAGE_SONDERSEKTOR/.test(l.begruendung)), 'Regie-Logbuch: abenteuer_veraltet mit dem Grund der Lage');
      ok(P.abenteuerLaufend(Fz(g)) === 0, 'nichts laeuft, nichts blockiert');
    }
    // Angebot nach Erfolg (anderer Weg): veraltet, kein totes Angebot
    {
      const { t } = mitHelixAngebot(1), g = t.g;
      const a = helixAngebot(g);
      g.mission.missions[BUCH] = { state: 'done', ausgang: 'erfolg' };   // das Buch ist ueber einen anderen Weg gelungen, waehrend das Angebot am Brett lag
      const e = Brett.annehmen(g, 'a' + a.nr);
      ok(e && e.code === 'veraltet' && !Fz(g).abenteuerAngebote.includes(a), 'Angebot lag am Brett, das Buch ist inzwischen gelungen: Annehmen -> veraltet, vom Brett genommen');
    }
    // Szene und andere Mission: der Faden startet, der Beat scheitert sauber, Logbuch, das Brett bleibt frei
    for (const [name, vorbereiten, muster, aufraeumen] of [
      ['Sim-Szene laeuft', (g) => { g.simSzene = { phase: 'kampf' }; }, /Szene oder Gefahr/, (g) => { g.simSzene = null; }],
      ['Faden-Szene laeuft', (g) => { g.fadenSzene = { phase: 'kampf' }; }, /Szene oder Gefahr/, (g) => { g.fadenSzene = null; }],
      ['andere Mission laeuft', (g) => { g.mission.activeId = 'fremd'; }, /andere Mission/, (g) => { g.mission.activeId = null; }],
    ]) {
      const { t } = mitHelixAngebot(1), g = t.g, funk = funkMit(g);
      const a = helixAngebot(g);
      vorbereiten(g);
      const starts = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { starts.push(k); return me0(k, d); };
      const aktiv = g.mission.activeId;
      const { fehler, f } = annehmenUndStarten(g, a, true);
      const l = sbLog(g).filter((e) => e.ausgang === 'abgelehnt');
      ok(fehler === null && !!f && f.nsc.gedaechtnis.some((x) => x.ereignis === 'sondersektor_gescheitert'), name + ': der Beat ist gescheitert');
      ok(l.length === 1 && muster.test(l[0].begruendung), name + ': Logbuch nennt den Grund (' + (l[0] && l[0].begruendung.slice(0, 70)) + ')');
      ok(!mStand(g) && g.mission.activeId === aktiv && !starts.includes('missionStart') && !funk.some((r) => /Forschungsstation Helix/.test(r.text)), name + ': Buch nicht gestartet, keine Ansage');
      aufraeumen(g);
      ok(bisAbschluss(g, f) && P.abenteuerLaufend(Fz(g)) === 0 && g.errors === 0, name + ': der Faden endet, das Brett ist frei, errors 0');
    }
  });

  // ---------------- G: Speichern und Laden ueber den Brett-Weg
  await abschnitt('G  Speichern und Laden ueber den Brett-Weg', 'G', async () => {
    const dir = R.freshDir();
    // 1. das Angebot liegt am Brett
    {
      const { t, seed } = mitHelixAngebot(1, { dir }), g = t.g;
      const a = helixAngebot(g);
      const r = g.saveWorld('test', { sync: true });
      ok(r && r.ok !== false && !r.error, 'angedockt speichern mit Helix-Angebot am Brett (' + JSON.stringify(r && { ok: r.ok, error: r.error }) + ')');
      const id = g.weltstand && g.weltstand.id;
      const t2 = R.neuesSpiel({ crew: 1, seed: seed + 100, names: NAMEN.slice(0, 1), env: ENV, dir, world: id });
      const a2 = helixAngebot(t2.g);
      ok(!!a2 && a2.hex === a.hex && a2.vorlage.titel === a.vorlage.titel && istHelix(a2), 'nach dem Laden liegt das Helix-Angebot noch am Brett (der Plan lief erneut durch den Pruefer)');
      const e = annehmenUndStarten(t2.g, a2);
      ok(e.fehler === null && t2.g.mission.activeId === BUCH, 'das geladene Angebot laesst sich annehmen, das Buch startet');
      ok(t2.g.errors === 0, 'errors 0');
    }
    // 2. mitten im Beat
    {
      const gef = mitHelixAngebot(1, { dir }), t = gef.t, g = t.g, T = hilfe(g, t.cs);
      const a = helixAngebot(g);
      const { fehler, f } = annehmenUndStarten(g, a);
      ok(fehler === null, 'angenommen');
      await T.run(5);
      ok(g.mission.step && g.mission.step.id === 'anflug_helix' && g.ship.docked, 'Buch laeuft (Schritt anflug_helix), die Crew liegt im Hafen');
      const kante = Sektoren.kanteId('0605', '0506');
      const n0 = f.laufend.n;
      const r = g.saveWorld('test', { sync: true });
      ok(r && r.ok !== false && !r.error, 'angedockt speichern mitten im Beat');
      const id = g.weltstand && g.weltstand.id;
      const t2 = R.neuesSpiel({ crew: 1, seed: gef.seed + 200, names: NAMEN.slice(0, 1), env: ENV, dir, world: id }), g2 = t2.g;
      const T2 = hilfe(g2, t2.cs);
      const s = liste(g2).find((x) => x.id === f.id);
      ok(!!s && s.phase === 'laeuft' && s.laufend && s.beat === 0 && s.laufend.n === n0, 'nach dem Laden: der Faden steht im Beat (laeuft, Frist-Zaehler ' + (s && s.laufend && s.laufend.n) + ')');
      ok(g2.mission.activeId === BUCH && g2.mission.step && g2.mission.step.id === 'anflug_helix' && !!g2.explore.tempKante(kante), 'Mission, Schritt und temporaere Kante bleiben');
      g2.step(); g2.step();
      ok(beatsGestartet(g2, s) <= 1 && s.phase === 'laeuft', 'der Rueckfall treibt den laufenden Beat nicht doppelt');
      await buchSpielen(T2, 'geladen');
      await T2.run(1);
      ok(bisAbschluss(g2, s) && s.ausgang && s.ausgang.art === 'gelungen' && s.parameter.ort === HELIX.ausgang.hex, 'der Faden endet nach dem Laden gelungen, Ort = Ausgang');
      ok(g2.errors === 0 && komponist0(g2), 'errors 0, 0 Komponisten-Aufrufe');
    }
  });

  // ---------------- H: Haltefeld nach Fristablauf
  await abschnitt('H  Haltefeld nach Fristablauf mitten im Finale', 'H', async () => {
    const { t } = mitHelixAngebot(1), g = t.g, funk = funkMit(g), T = hilfe(g, t.cs);
    const a = helixAngebot(g);
    const { fehler, f } = annehmenUndStarten(g, a);
    ok(fehler === null, 'angenommen');
    await buchSpielen(T, 'Finale', 'finale');
    ok(!ZonenSim.istAus(g, 'halt') && g.mission.step.id === 'finale' && ZonenSim.szeneZonen(g).some((z) => z.id === 'halt_feld'), 'Crew im Finale: das Haltefeld ist eingeschaltet (Gruppe halt)');
    const gv = Locations.get('helix').scene.gravimetrie;
    g.ship.x = gv.station.x; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0;
    await T.run(1);
    ok(Zonen.wirkung(ZonenSim.szeneZonen(g), g.ship.x, g.ship.y).ids.includes('halt_feld'), 'das Schiff liegt im Haltefeld');
    const frist = D.BEATS.sondersektor.frist;
    for (let i = 0; i < frist + 1 && f.phase === 'laeuft'; i++) Faden.taetigkeit(g, 'andocken');
    await T.run(2);
    ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'sondersektor_gescheitert') && g.mission.activeId === null && !mStand(g), 'die Frist ist abgelaufen: Beat gescheitert, das Buch abgeraeumt');
    ok(ZonenSim.istAus(g, 'halt') && !Zonen.wirkung(ZonenSim.szeneZonen(g), g.ship.x, g.ship.y).ids.some((id) => /^halt/.test(id)), 'das Haltefeld ist ausgeschaltet: die Crew sitzt nicht mehr darin fest');
    ok(sbLog(g).some((e) => e.ausgang === 'abgeraeumt') && funk.some((r) => /Messreihe ist verloren/.test(r.text)), 'Logbuch: abgeraeumt, die Station meldet sich');
    // die Crew kommt hinaus: der Fluchtweg und der Notsprung gehen
    T.energie({ engines: 4, shields: 1, weapons: 1 });
    await T.fliege(gv.fluchtweg, 60, () => false);
    const ende = gv.fluchtweg[gv.fluchtweg.length - 1];
    ok(Math.hypot(g.ship.x - ende.x, g.ship.y - ende.y) < 120 && g.errors === 0, 'die Crew fliegt den Fluchtweg aus der Station (Ende ' + Math.round(g.ship.x) + ',' + Math.round(g.ship.y) + ')');
  });

  console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})();
