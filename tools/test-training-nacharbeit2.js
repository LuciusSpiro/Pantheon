'use strict';
// TRA-01 Nacharbeit Runde 2 (Befunde des Prüfers und des Designer-Reviews), Server-Seite.
//   node tools/test-training-nacharbeit2.js
//   P1  Reihenfolge   Captain Tafel und Sprache: ein Befehl zählt für ein Ziel nur, wenn er NACH Beginn des Schritts kam; "Alle Maschinen stopp" nur nach der Ankunft an der Marke
//                     (ein Stopp aus dem Tab-Schritt oder unterwegs zählt nicht), die Marke zählt nur, wenn das Schiff nach dem Kursbefehl gefahren ist (Marke zu nah: kein Anflug)
//   P2  Sprache      Start der Sprachvariante schaltet die Bot-Sprache ein (nur dann); ist sie aus, melden ^ und # im Training, wie es weitergeht (sonst schweigen sie)
//   P3  Menü          Training zeigt „1 Spieler · kein Weltstand“; die Trainings-Lobby zeigt weder Raumcode noch Bot-Plätze noch „lädt ein“
//   K4-K6 Unterseite  „S Eingabe“ nur beim Captain; gesperrte Kacheln auf der Grundlinie der anderen; Titel „FLIEGEN“ statt „TRAINING FLIEGEN“
//   P4  Ziele         abstand / scan versprechen nur den Befehl (Text), status / automatik haken über die Befehlstafel (Tafel) und die Textzeile (Sprache) ab
const Erk = require('../server/sim/training-erkennung.js');
const Station = require('../server/sim/station.js');
const Gen = require('./gen-tra-captain.js');
const Sim = require('./sim-training-captain.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const VAR = { tafel: { sprache: false, q: 'taste', nav: 'navigation' }, sprache: { sprache: true, q: 'text', nav: 'b0' } };

function bereit(seed, v) {
  const P = Sim.partie(seed, VAR[v].sprache);
  P.run(20, () => ['helm', 'weapons', 'technik'].every((k) => P.g.players.some((p) => p.bot && Station.stationOf(p) === k)));
  P.hat = (id) => Erk.erreicht(P.g, id);
  P.ob = (id) => (P.g.mission.state.objectives.find((o) => o.id === id) || {}).done;
  P.schritt = () => (P.g.mission.step ? P.g.mission.step.id : null);
  return P;
}
// Stand abschließen: Sprungziel, Marker, Tab; vorher gibt der Spieler "Alle Maschinen stopp" (der Tab-Hinweis verlangt Allstopp)
function standMitStopp(P, v, marker) {
  const x = VAR[v];
  Sim.befehlen(P, x.nav, 'nav.stopp', x.q);
  P.cmd({ c: 'captain.selectDest', dest: 'splitter' });
  P.cmd({ c: 'captain.marker', x: marker.x, y: marker.y }); P.run(0.5);
  for (let i = 0; i < 4; i++) { P.cmd({ c: 'station.tab', dir: 1 }); P.run(1); }
  Sim.warten(P, 'Schritt kurs', 10, () => P.schritt() === 'kurs');
  P.run(0.5);
}

for (const v of ['tafel', 'sprache']) {
  const x = VAR[v];
  section('P1 ' + v + ': Stopp aus dem Tab-Schritt zählt im Schritt kurs nicht', () => {
    const P = bereit(5, v);
    standMitStopp(P, v, { x: 1100, y: 450 });
    ok(!P.hat('bot_befehl:nav.stopp') && !P.hat('bot_befehl:nav.stopp:' + x.q), 'Stopp von vorher ist beim Eintritt in kurs vergessen');
    Sim.befehlen(P, x.nav, 'nav.kurs', x.q, { ziel: 'marke' });
    Sim.warten(P, 'Anflug', 120, () => P.hat('marke_erreicht'));
    P.run(1);
    ok(P.ob('kurs') && P.ob('anflug'), 'Kurs und Anflug erfüllt');
    ok(!P.ob('stopp') && P.schritt() === 'kurs', 'Stopp nach der Ankunft noch offen (nichts hakt vorher ab)');
    Sim.befehlen(P, x.nav, 'nav.stopp', x.q);
    P.run(2);
    ok(P.schritt() === 'ziele', 'Stopp nach der Ankunft zählt: weiter zu ziele (Schritt ' + P.schritt() + ')');
  });
  section('P1 ' + v + ': Stopp unterwegs zählt nicht, nur nach der Ankunft', () => {
    const P = bereit(6, v);
    standMitStopp(P, v, { x: 1100, y: 450 });
    Sim.befehlen(P, x.nav, 'nav.kurs', x.q, { ziel: 'marke' });
    Sim.warten(P, 'Fahrt', 60, () => P.g.ship.speed >= Erk.FAHRT_MIN);
    Sim.befehlen(P, x.nav, 'nav.stopp', x.q);   // unterwegs: Livia hält an
    P.run(6);
    ok(P.hat('bot_befehl:nav.stopp') && !P.hat('marke_erreicht'), 'Stopp unterwegs angenommen, Marke noch nicht erreicht');
    Sim.befehlen(P, x.nav, 'nav.kurs', x.q, { ziel: 'marke' });
    Sim.warten(P, 'Anflug', 120, () => P.hat('marke_erreicht'));
    P.run(1);
    ok(!P.hat('bot_befehl:nav.stopp') && !P.ob('stopp') && P.schritt() === 'kurs', 'Mit der Ankunft ist der Stopp von unterwegs vergessen, das Ziel stopp ist offen');
    Sim.befehlen(P, x.nav, 'nav.stopp', x.q); P.run(2);
    ok(P.schritt() === 'ziele', 'Stopp nach der Ankunft erfüllt das Ziel: weiter zu ziele (Schritt ' + P.schritt() + ')');
  });
  section('P1 ' + v + ': Marke zu nah, das Schiff fährt kaum: kein Anflug, kein Stopp-Ziel', () => {
    const P = bereit(7, v);
    const sh = P.g.ship;
    sh.x = 1300; sh.y = 500; sh.docked = false;   // abgelegt, weit vom Dock; die Marke liegt in ANFLUG_R
    standMitStopp(P, v, { x: sh.x + 90, y: sh.y + 40 });
    Sim.befehlen(P, x.nav, 'nav.kurs', x.q, { ziel: 'marke' });
    P.run(4);
    ok(P.hat('bot_befehl:nav.kurs') && !P.hat('marke_erreicht'), 'weniger als ' + Erk.KURS_MIN_STRECKE + ' px gefahren: keine "Marke erreicht" (gefahren ' + Math.round(Math.hypot(sh.x - 1300, sh.y - 500)) + ' px)');
    Sim.befehlen(P, x.nav, 'nav.stopp', x.q); P.run(2);
    ok(!P.ob('stopp') && !P.ob('anflug') && P.schritt() === 'kurs', 'weder anflug noch stopp abgehakt');
  });
  section('P1 ' + v + ': spätere Schritte verlangen frische Befehle', () => {
    const buch = Gen.buch(v);
    const enter = (id) => JSON.stringify((buch.steps.find((s) => s.id === id) || {}).enter || []);
    for (const [sid, p] of [['kurs', 'bot_befehl:nav.kurs'], ['kurs', 'bot_befehl:nav.stopp'], ['kurs', 'marke_erreicht'], ['reparatur', 'bot_befehl:tech.reparieren'], ['reparatur', 'repariert'],
      ['sprung', 'bot_befehl:nav.sprung'], ['sprung', 'schnellsprung']]) ok(enter(sid).includes('"' + p + '"'), sid + ': enter vergisst ' + p);
  });
}

section('P4 Texte und optionale Ziele', () => {
  for (const v of ['tafel', 'sprache']) {
    const t = Gen.buch(v).texte;
    ok(/befehlen/.test(t['ziel.abstand']) && !/Schussbogen\)?$/.test(t['ziel.abstand'].replace(/ \(für den Schussbogen\)$/, 'x')) && /befehlen/.test(t['ziel.scan']), v + ': abstand/scan sagen ehrlich "befehlen" (' + t['ziel.abstand'] + ' | ' + t['ziel.scan'] + ')');
  }
  for (const v of ['tafel', 'sprache']) {
    const x = VAR[v];
    const P = bereit(4, v);
    P.g.mission.setStep('reparatur'); P.run(1);
    ok(!P.ob('status') && !P.ob('automatik'), v + ': status/automatik zu Beginn offen');
    Sim.befehlen(P, 'alle', 'bot.status', x.q); P.run(1);
    ok(P.ob('status') === true, v + ': Statusbericht hakt status ab');
    Sim.befehlen(P, 'alle', 'bot.automatik', x.q); P.run(1);
    ok(P.ob('automatik') === true, v + ': Automatik hakt automatik ab');
  }
});

// ---------- Client: Menü (Node, mit aufzeichnendem Render) ----------
const fs = require('fs');
const path = require('path');
const Protocol = require('../shared/protocol.js');
const TOKENS = require('../public/js/menue-tokens.js');
const MenueApi = require('../public/js/menue.js');
const PUB = path.join(__dirname, '..', 'public', 'js');
const QUELLE_UI = fs.readFileSync(path.join(PUB, 'menue-ui.js'), 'utf8');
const noop = () => {};

// Menü mit echtem MenueFluss und echter MenueUi; texte = alle gezeichneten Zeichenketten { s, x, y }; botSprache = Schalter der Bot-Sprache (Spion)
function menue(o) {
  o = o || {};
  const gesendet = [];
  const F = MenueApi.erzeuge({ protokoll: Protocol, senden: (m) => { gesendet.push(m); return true; }, debug: false, szenenIds: () => [], weltstandMax: 5, verlasseRaum: () => true, oeffneKammer: () => true, charaktere: null, botSprache: o.botSprache });
  const texte = [];
  const Render = new Proxy({ text: (c, s, x, y) => { texte.push({ s: String(s), x, y }); }, measure: (s) => String(s).length * 6, wrap: (s) => [String(s)], ui: { buttons: [], mouse: null }, PAL: {} }, { get: (t, k) => (k in t ? t[k] : noop) });
  const Pult = new Proxy({ rgba: () => '#000' }, { get: (t, k) => (k in t ? t[k] : noop) });
  const win = { Render, Pult, Menue: TOKENS, MenueFluss: F, Hud: { fit: (s) => s }, Net: { serverRoomCode: 'AB', status: 'open', inviteLink: () => 'x' }, Tasten: { passt: () => false } };
  new Function('window', 'Net', 'Tasten', QUELLE_UI)(win, win.Net, win.Tasten);
  const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }) }, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
  const lob = { startMission: o.modus || 'm1', worlds: [], laborAn: true };
  const view = { actions: {}, pid: 'p1', state: { lobby: lob, players: [{ id: 'p1', name: 'A', ready: false, connected: true, color: 0 }] } };
  F.starte({}); F.weiter(); F.synchronisiere(lob);
  const m = { F, gesendet, texte, lob, view };
  m.zeichne = () => { texte.length = 0; win.MenueUi.zeichne(ctx, view); return texte.map((x) => x.s); };
  m.trainingSeite = () => { F.waehleEintragId('training', lob); F.bestaetige(lob); return m; };
  return m;
}
const erstes = (m, s) => m.texte.find((x) => x.s === s);

section('P3 Menü: Training ist ein Ein-Spieler-Modus', () => {
  { const m = menue(); m.F.waehleEintragId('training', m.lob); const t = m.zeichne();
    ok(t.includes('1 Spieler · kein Weltstand') && !t.includes('1–4 Spieler · kein Weltstand'), 'Hauptmenü, Eintrag TRAINING: „1 Spieler · kein Weltstand“'); }
  { const m = menue(); m.F.waehleEintragId('arena_forschung', m.lob); const t = m.zeichne();
    ok(t.includes('1–4 Spieler · kein Weltstand'), 'Gegenprobe: andere Übungsszene (Forschungsstation) bleibt „1–4 Spieler · kein Weltstand“'); }
  { const m = menue().trainingSeite(); const t = m.zeichne();
    ok(t.includes('1 Spieler · kein Weltstand') && !t.some((s) => /1–4/.test(s)), 'Trainingsunterseite: „1 Spieler · kein Weltstand“'); }
});
section('P3 Lobby: im Training keine Einladung', () => {
  const lobby = (modus) => { const m = menue({ modus }); m.F.waehleEintragId(modus === 'm1' ? 'm1' : 'training', m.lob); if (modus !== 'm1') m.F.trainingStarte(); else m.F.bestaetige(m.lob); m.lob.startMission = modus; m.F.synchronisiere(m.lob); return m; };
  const tr = lobby('training_fliegen'); const t = tr.zeichne();
  const T = TOKENS.TOKENS.TEXT;
  ok(tr.F.lies().schirm === 'lobby' && tr.F.istTrainingLobby(tr.lob), 'Lobby im Trainingsmodus');
  ok(t.includes('Training: allein') && !t.includes('Link') && !t.includes(T.linkKopieren) && !t.includes(T.laedtEin.replace(/^L /, '')) && !t.includes('AB') && !t.includes('RAUM'), 'Trainings-Lobby: „Training: allein“, weder Raumcode (Kachel und Statuszeile) noch Link noch „lädt ein“');
  ok(!t.some((s) => /BOT HINZUF|Bot hinzuf/i.test(s)) && !t.includes('Bot'), 'Trainings-Lobby: keine Bot-Plätze, kein Hinweis „P Bot“ (' + t.filter((s) => /Bot/.test(s)).join('|') + ')');
  const ka = lobby('m1'); const tk = ka.zeichne();
  ok(!tk.includes('Training: allein') && tk.some((s) => /Bot|BOT/.test(s)) && tk.includes('Link kopieren'), 'Gegenprobe: Kampagnen-Lobby zeigt weiter Raumcode-Kachel, Link und Bot-Plätze');
});
section('K4-K6 Trainings-Unterseite', () => {
  const fl = menue().trainingSeite(); const tf = fl.zeichne();
  ok(!tf.includes('Eingabe'), 'K4: Fliegen: die Hinweisleiste hat kein „S Eingabe“');
  fl.F.trainingWaehleId('captain'); const tc = fl.zeichne();
  ok(tc.filter((s) => s === 'Eingabe').length === 1 && tc.includes('Eingabe:'), 'K4: Captain: „S Eingabe“ in der Hinweisleiste (und die Wahl in der Detailkachel)');
  fl.F.trainingWaehleId('fliegen'); fl.zeichne();
  ok(fl.texte.some((x) => x.s === 'FLIEGEN') && !fl.texte.some((x) => /TRAINING FLIEGEN|TRAINING CAPTAIN/.test(x.s)), 'K6: Titel „FLIEGEN“, der Kicker TRAINING steht schon darüber (nicht „TRAINING FLIEGEN“)');
  const buchstabe = (m, b, nachZiffer) => { const i = m.texte.findIndex((x) => x.s === nachZiffer); return m.texte.slice(i + 1).find((x) => x.s === b); };
  const f = buchstabe(fl, 'F', '1'), o = buchstabe(fl, 'O', '3');
  ok(f && o && f.y === o.y, 'K5: Titelzeile der gesperrten Kachel (OPS, y ' + (o && o.y) + ') auf der Grundlinie von FLIEGEN (y ' + (f && f.y) + ')');
});

// ---------- Client: P2 Start der Sprachvariante schaltet die Bot-Sprache ein ----------
section('P2 Sprachvariante: Start schaltet die Bot-Sprache an', () => {
  const schalter = (an) => { const s = { an: () => an, aufrufe: [], setze(b) { this.aufrufe.push(b); return Promise.resolve(); } }; return s; };
  const start = (kachel, sprache, an) => { const sp = schalter(an); const m = menue({ botSprache: sp }).trainingSeite(); m.F.trainingWaehleId(kachel); if (sprache) m.F.setzeTrainingSprache(true); const r = m.F.trainingStarte(); return { sp, r, m }; };
  { const x = start('captain', true, false); ok(x.r.ok && x.sp.aufrufe.length === 1 && x.sp.aufrufe[0] === true, 'Captain mit Sprache, Sprache aus: Start schaltet sie an'); }
  { const x = start('captain', false, false); ok(x.r.ok && x.sp.aufrufe.length === 0, 'Captain mit Befehlstafel: Sprache bleibt aus (unberührt)'); }
  { const x = start('captain', true, true); ok(x.r.ok && x.sp.aufrufe.length === 0, 'Sprache schon an: nichts zu tun'); }
  { const x = start('fliegen', false, false); ok(x.r.ok && x.sp.aufrufe.length === 0, 'Fliegen: Sprache bleibt aus'); }
  { const m = menue({ botSprache: { an: () => false, setze() { throw new Error('kaputt'); } } }).trainingSeite(); m.F.trainingWaehleId('captain'); m.F.setzeTrainingSprache(true); let e = null, r = null; try { r = m.F.trainingStarte(); } catch (x) { e = x; }
    ok(e === null && r.ok && m.gesendet.some((g) => g.trainingSprache === true), 'wirft der Schalter, startet das Training trotzdem (mit Sprachvariante)'); }
  { const m = menue().trainingSeite(); m.F.trainingWaehleId('captain'); m.F.setzeTrainingSprache(true); const r = m.F.trainingStarte(); ok(r.ok, 'ohne Schalter im Browser (Modul nicht geladen) startet das Training'); }
});
section('P2 Rückmeldung ^ und # bei ausgeschalteter Sprache', () => {
  const vm = require('vm');
  const TH = require('../public/js/training-hud.js');
  const baue = (o) => {
    const notizen = []; const speicher = { pantheon_botsprache: o.an ? '1' : null };
    const win = { location: { search: '' }, localStorage: { getItem: () => (o.an ? '1' : null), setItem: noop }, document: { activeElement: o.tippt ? { tagName: 'INPUT' } : null, createElement: () => ({}), head: { appendChild: noop } }, TrainingHud: TH.erzeuge({ R: () => ({}), jetzt: () => 0 }),
      Client: { state: { mission: { active: o.id ? { id: o.id } : null } } }, Hud: { pushNotice: (t) => notizen.push(t) }, Render: { PAL: { warn: '#w' } }, Tasten: { passt: (e, id) => (id === 'allgemein.sprechen' && e.code === 'Backquote') || (id === 'allgemein.botText' && e.code === 'Backslash') }, addEventListener: noop };
    win.URLSearchParams = URLSearchParams; win.Date = Date; win.window = win; vm.createContext(win); vm.runInContext(fs.readFileSync(path.join(PUB, 'bot-sprache-start.js'), 'utf8'), win);
    return { S: win.BotSpracheStart, notizen };
  };
  { const x = baue({ id: 'tra_captain_sprache' }); x.S.ausMeldung({ code: 'Backslash' }); x.S.ausMeldung({ code: 'Backquote' });
    ok(x.notizen.length === 1 && /Bot-Sprache ist aus/.test(x.notizen[0]) && /Befehlstafel/.test(x.notizen[0]), 'Training, Sprache aus: # meldet, wie es weitergeht (eine Meldung, nicht bei jedem Druck): ' + JSON.stringify(x.notizen)); }
  { const x = baue({ id: 'tra_captain_sprache' }); x.S.ausMeldung({ code: 'KeyW' }); x.S.ausMeldung({ code: 'Backslash', repeat: true }); ok(x.notizen.length === 0, 'andere Tasten und Tastenwiederholung: keine Meldung'); }
  { const x = baue({ id: 'm1' }); x.S.ausMeldung({ code: 'Backslash' }); ok(x.notizen.length === 0, 'Kampagne: keine Meldung'); }
  { const x = baue({ id: 'tra_captain_sprache', tippt: true }); x.S.ausMeldung({ code: 'Backslash' }); ok(x.notizen.length === 0, 'beim Tippen in einem Eingabefeld: keine Meldung'); }
  { const x = baue({ id: 'tra_captain_sprache', an: true }); x.S.ausMeldung({ code: 'Backslash' }); ok(x.notizen.length === 0, 'Sprache an: keine Meldung (die Textzeile öffnet sich selbst)'); }
});

// ---------- Client: K3 und S4 (Befehlstafel) ----------
section('K3 und S4: Befehlstafel', () => {
  const TK = require('../public/js/pult-befehl-tokens.js');
  ok(TK.TEXT.rechts.sonst === 'B zurück · Esc schließt' && TK.TEXT.rechts.stufe1 === 'B / Esc schließt', 'K3: Kopfzeile der Tafel „B zurück · Esc schließt“ (kein abgeschnittenes „Esc zu“)');
  const bw = TK.MASS.crew.breiten; const summe = bw.reduce((s, b) => s + b, 0) + (bw.length - 1) * TK.MASS.crew.sx;
  ok(bw.length === 7 && summe === 572 && TK.LAGE.direkt.some((d) => d.aktion === 'captain.bot.sprung'), 'S4: Shift+J Sprung in der Crew-Zeile, sieben Knöpfe füllen 572 px (' + summe + ')');
});

console.log('\nTEST-TRAINING-NACHARBEIT2: ' + (fails ? fails + ' FEHLER von ' + n : 'alle ' + n + ' bestanden'));
process.exit(fails ? 1 : 0);
