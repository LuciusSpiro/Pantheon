'use strict';
// LIV-01 A2: Kontingent-Meldung im Client, ohne Browser.
//  1. public/js/kontingent.js (Modell): kein Block / unter der Schwelle -> nichts, erreicht -> Meldung mit Verbrauch, Hinweisen, nur Captain-Konsole bedient, Doppelklick, Antworten (ok, Absage),
//     Verschwinden bei erreicht falsch, welcome, Wartezeit, Müll im Block, Befehl im Protokollformat
//  2. Tastenbelegung (tasten.js): Aktion allgemein.kontingentFreigeben, Standard frei in allen Gruppen (keine Kollision), umbelegbar, Kappe zeigt die echte Taste
//  3. Modell gegen einen ECHTEN Server (Game im Live-Modus, Zähler per addUsage auf 54 000 von 60 000): Snapshot -> Modell, Befehl des Captains -> Antwort -> Snapshot,
//     Nicht-Captain bekommt die Absage, ohne Live-Schalter kein Block
// Die Erwartungen stehen hier selbst. Aufruf: node tools/test-kontingent-ui.js   (npm run test:kontingent-ui)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback';
const Protocol = require('../shared/protocol.js');
const K = require('../public/js/kontingent.js');
global.window = { localStorage: null };   // tasten.js hängt sich an window; danach wieder weg (die Server-Module sollen keinen Browser sehen)
require('../public/js/tasten.js');
const Tasten = global.window.Tasten;
delete global.window;

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const blank = (s) => String(s).replace(/ /g, ' ');
const snap = (k) => ({ t: 'snap', phase: 'play', world: k === undefined ? {} : { kontingent: k } });
const reset = () => { K.lesen({ t: 'welcome' }); };
const antwort = (o) => K.lesen(Object.assign({ t: 'event', kind: 'kontingentAntwort', pid: 1 }, o));
const gesendet = () => { const l = []; l.send = (m) => { l.push(m); return true; }; return l; };
const ERREICHT = { used: 54000, limit: 60000, schwelle: 54000, erreicht: true };

section('Modell: nichts ohne Block, nichts unter der Schwelle');
reset();
ok(K.modell('captain', 0) === null && !K.offen(), 'ohne Block: kein Modell');
K.lesen(snap());
ok(K.modell('captain', 0) === null, 'Snapshot ohne world.kontingent: bleibt ohne Modell (Feld fehlt im Nicht-Live-Modus)');
K.lesen(snap({ used: 20000, limit: 60000, schwelle: 54000, erreicht: false }));
ok(K.modell('captain', 0) === null && !K.offen(), 'erreicht falsch: kein Modell');
K.lesen({ t: 'snap', phase: 'play', world: { andere: 1 } });
ok(K.store.block && K.store.block.used === 20000, 'ein Snapshot ohne das Feld behält den letzten Stand (der Server sendet nur bei Änderung)');

section('Modell: erreicht');
K.lesen(snap(ERREICHT));
let m = K.modell('captain', 0);
ok(m && m.titel === 'Kontingent aufgebraucht', 'Titel "Kontingent aufgebraucht"');
ok(m && blank(m.verbrauch) === '54 000 / 60 000', 'Verbrauch used/limit: ' + (m && blank(m.verbrauch)));
ok(m && /Spiel läuft weiter/.test(m.text), 'Hinweis: das Spiel läuft weiter');
ok(m && m.knopf === '500 000 Tokens freigeben', 'Knopfbeschriftung');
ok(m && m.bedienbar && m.aktiv && m.hinweis === '' && m.antwort === null, 'Captain-Konsole: Knopf aktiv, kein Hinweis');
for (const kons of ['helm', 'weapons', 'technik', 'shop', null, undefined]) {
  const x = K.modell(kons, 0);
  ok(x && !x.bedienbar && !x.aktiv && /Captain/.test(x.hinweis), 'Konsole ' + kons + ': Meldung sichtbar, Knopf inaktiv, Hinweis "nur Captain"');
}
{ const l = gesendet(); ok(K.freigeben(l.send, 'helm', 0) === false && l.length === 0 && !K.store.wartet, 'Nicht-Captain: Taste/Knopf sendet nichts und merkt sich nichts'); }
{ const l = gesendet(); ok(K.freigeben(l.send, null, 0) === false && l.length === 0, 'Zuschauer (keine Konsole): sendet nichts'); }

section('Befehl, Doppelklick, Antwort');
{
  const l = gesendet();
  ok(K.freigeben(l.send, 'captain', 1000) === true && l.length === 1, 'Captain: ein Befehl gesendet');
  ok(l[0].t === 'cmd' && l[0].c === Protocol.CMD_KONTINGENT_FREIGEBEN && l[0].c === 'kontingent.freigeben' && Object.keys(l[0]).length === 2, 'Befehl { t: cmd, c: kontingent.freigeben }, sonst nichts');
  ok(K.freigeben(l.send, 'captain', 1100) === false && l.length === 1, 'Doppelklick: kein zweiter Befehl');
  m = K.modell('captain', 1200);
  ok(m.wartet && !m.aktiv && /gesendet/.test(m.hinweis), 'während der Wartezeit: Knopf gesperrt, Hinweis "gesendet"');
  m = K.modell('captain', 1000 + K.WARTE_MS + 1);
  ok(!m.wartet && m.aktiv, 'bleibt die Antwort aus: nach der Wartezeit wieder frei');
  ok(K.freigeben(l.send, 'captain', 1000 + K.WARTE_MS + 2) === true && l.length === 2, 'danach ist ein neuer Versuch möglich');
  antwort({ ok: true });
  m = K.modell('captain', 6000);
  ok(!m.wartet && m.freigegeben && !m.aktiv && m.antwort && m.antwort.ok && /Freigegeben/.test(m.antwort.text), 'Antwort ok: Zustand "freigegeben", Knopf bleibt gesperrt bis der Snapshot kommt');
  ok(K.freigeben(l.send, 'captain', 6001) === false && l.length === 2, 'nach ok kein weiterer Befehl, solange der Snapshot noch "erreicht" sagt');
  K.lesen(snap({ used: 54000, limit: 560000, schwelle: 504000, erreicht: false }));
  ok(K.modell('captain', 6100) === null && !K.offen() && K.store.antwort === null, 'Snapshot erreicht falsch (Limit 560 000): Meldung weg, Rückmeldung gelöscht');
}

section('Absage des Servers');
{
  reset(); K.lesen(snap(ERREICHT));
  const l = gesendet(); K.freigeben(l.send, 'captain', 0);
  antwort({ ok: false, code: 'nicht_erreicht', text: 'Das Kontingent ist noch nicht aufgebraucht.' });
  m = K.modell('captain', 10);
  ok(m.antwort && m.antwort.ok === false && m.antwort.text === 'Das Kontingent ist noch nicht aufgebraucht.', 'Klartext der Absage wird angezeigt');
  ok(!m.wartet && m.aktiv, 'nach einer Absage ist der Knopf wieder frei (Antwort da, Zustand sichtbar)');
  K.freigeben(l.send, 'captain', 20); antwort({ ok: false, code: 'fehler' });
  ok(K.modell('captain', 30).antwort.text === 'Die Freigabe ging nicht durch. Noch einmal versuchen.', 'Absage ohne Text: Ersatztext');
  antwort({ ok: false, text: 'x'.repeat(500) });
  ok(K.modell('captain', 40).antwort.text.length <= 120, 'Text der Antwort ist begrenzt');
  antwort({ ok: false, text: '<img src=x onerror=1>' });
  ok(K.modell('captain', 50).antwort.text === '<img src=x onerror=1>', 'Servertext bleibt Text (die Anzeige setzt textContent, nie HTML)');
}

section('Zweite Schwelle, welcome, Müll');
{
  reset(); K.lesen(snap(ERREICHT));
  const l = gesendet(); K.freigeben(l.send, 'captain', 0); antwort({ ok: true });
  K.lesen(snap({ used: 54000, limit: 560000, schwelle: 504000, erreicht: false }));
  K.lesen(snap({ used: 504000, limit: 560000, schwelle: 504000, erreicht: true }));
  m = K.modell('captain', 5);
  ok(m && m.aktiv && m.antwort === null && blank(m.verbrauch) === '504 000 / 560 000', 'erneut erreicht: Meldung wieder da, frei, ohne alte Rückmeldung');
  K.lesen({ t: 'welcome', pid: 1 });
  ok(K.modell('captain', 0) === null && K.store.block === null, 'welcome (neue Verbindung) leert den Stand');
  for (const muell of [null, 5, 'x', [], {}, { used: 'a', limit: 1 }, { used: 1 }, { used: NaN, limit: 1 }]) K.lesen(snap(muell));
  ok(K.modell('captain', 0) === null, 'Müll im Block: kein Modell, kein Absturz');
  K.lesen(snap({ used: -5, limit: 60000, schwelle: 54000, erreicht: 1 }));
  ok(K.modell('captain', 0).used === 0, 'negativer Zähler wird auf 0 geklemmt');
  K.lesen(null); K.lesen('x'); K.lesen({}); K.lesen({ t: 'snap' }); K.lesen({ t: 'snap', world: null });
  ok(true, 'Nachrichten ohne Inhalt werfen nicht');
  ok(K.tausend(500000) === '500 000' && K.tausend(999) === '999' && K.tausend(1234567) === '1 234 567', 'Tausendertrennung');
}

section('Tastenbelegung');
{
  const ID = 'allgemein.kontingentFreigeben';
  const a = Tasten.aktion(ID);
  ok(a && a.gruppe === 'allgemein' && /500 000/.test(a.name), 'Aktion ' + ID + ' steht in der Tastenliste (das Menü zeigt sie)');
  ok(Tasten.belegung(ID).join() === 'Shift+KeyK', 'Standard Umschalt+K');
  const kollision = Tasten.GRUPPEN.flatMap((g) => Tasten.konflikte(g.id)).filter((k) => k.ids.indexOf(ID) >= 0);
  ok(kollision.length === 0, 'keine Kollision in irgendeiner Gruppe');
  ok(Tasten.passt({ code: 'KeyK', shiftKey: true }, ID) && !Tasten.passt({ code: 'KeyK', shiftKey: false }, ID), 'Umschalt+K passt, K allein nicht');
  ok(Tasten.kappe(ID) === 'Sh+K', 'Tastenkappe: ' + Tasten.kappe(ID));
  Tasten.setze(ID, 0, 'F10');
  ok(Tasten.passt({ code: 'F10', shiftKey: false }, ID) && !Tasten.passt({ code: 'KeyK', shiftKey: true }, ID) && Tasten.kappe(ID) === 'F10', 'umbelegt auf F10: neue Taste wirkt, alte nicht, Kappe zeigt F10');
  Tasten.zuruecksetzen(ID);
  ok(Tasten.kappe(ID) === 'Sh+K', 'zurückgesetzt: Standard');
}

section('Gegen den echten Server (Live-Modus, Zähler 54 000 von 60 000)');
(async () => {
  const LLM = require('../server/mission/llm.js');
  const X = require('./faden-fixture.js');
  const LIVE = { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'live', LLM_LIVE: '1', FAEDEN: '1', ABENTEUER_ANSCHLUSS: '0' };
  process.env.LLM_LIVE = '1';
  const feed = (g) => { for (let i = 0; i < 40; i++) K.lesen({ t: 'snap', phase: 'play', world: g.snapshot().world }); };
  const feedEvents = (c) => { for (const e of c.inbox.splice(0)) if (e.t === 'event') K.lesen(e); };   // das welcome vom Beitritt liegt auch im Postfach: nur Ereignisse einspielen
  try {
    LLM.resetBudget(); LLM.setBudgetLimit(60000); LLM.addUsage(54000);
    reset();
    const t = X.spiel({ names: ['ZEBRAKAI', 'Mireille_Kas'], crew: 2, env: LIVE });
    t.g.players.forEach((p) => { p.zone = 'ship'; });
    t.g.players[0].console = 'captain'; t.g.players[1].console = 'helm';
    t.g.step(); feed(t.g);
    m = K.modell('captain', 0);
    ok(m && blank(m.verbrauch) === '54 000 / 60 000' && m.aktiv, 'Server -> Client: Meldung mit 54 000 / 60 000');
    t.g.handleMessage(t.cs[1], { t: 'cmd', c: 'kontingent.freigeben' });
    ok(LLM.budget().limit === 60000 && t.cs[1].inbox.some((e) => e.kind === 'notice'), 'Server: Helm wird abgewiesen (Absage über notice), Limit unverändert');
    const l = gesendet();
    ok(K.freigeben(l.send, 'captain', 0) && !K.freigeben(l.send, 'captain', 1) && l.length === 1, 'Client: Captain sendet einmal, Doppelklick nichts');
    t.g.handleMessage(t.cs[0], l[0]);
    ok(LLM.budget().limit === 560000, 'Server: Limit 560 000');
    feedEvents(t.cs[0]);
    m = K.modell('captain', 2);
    ok(m && m.freigegeben && m.antwort && m.antwort.ok, 'Antwort-Ereignis -> "freigegeben"');
    feed(t.g);
    ok(K.modell('captain', 3) === null && K.store.block.limit === 560000 && K.store.block.schwelle === 554000, 'nächster Snapshot: Meldung weg, Limit 560 000, Schwelle 554 000 (Schwelle +500 000 wie im Vertrag)');
    t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'kontingent.freigeben' });
    feedEvents(t.cs[0]);
    ok(LLM.budget().limit === 560000, 'Server: ein weiterer Befehl hebt nichts');
    LLM.resetBudget(); LLM.setBudgetLimit(60000); LLM.addUsage(59000); reset();
    const u = X.spiel({ names: ['ZEBRAKAI'], env: Object.assign({}, LIVE, { SPIELLEITER_LLM: 'off' }) });
    u.g.players[0].console = 'captain'; u.g.step(); feed(u.g);
    ok(K.store.block === null && K.modell('captain', 0) === null, 'ohne Live-Schalter: nie ein Block, nie ein Modell');
    // ---- M3: der Client leitet die Rolle wie der Server ab (Consoles.stationOf = Station.stationOf: p.station || p.console), nie aus console allein
    {
      const Station = require('../server/sim/station.js');
      const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'consoles.js'), 'utf8');
      const zeile = /stationOf\(me\) \{[^\n]*\}/.exec(src);   // die ECHTE Zeile aus consoles.js, nicht eine Kopie im Test
      ok(!!zeile, 'consoles.js: Consoles.stationOf gefunden');
      const Consoles = new Function('return ({ ' + zeile[0] + ' })')();
      const befehle = [];
      const stub = () => { const st = {}; const f = function () {}; const p = new Proxy(f, { get: (t, k) => (k === 'style' ? st : k in t ? t[k] : p), apply: () => p, set: (t, k, v) => { t[k] = v; return true; } }); return p; };
      const lokal = (me) => ({ pid: 7, state: { phase: 'play', players: [Object.assign({ id: 7 }, me)] } });
      const laden = (me) => {
        const c = lokal(me);
        global.window = { Kontingent: K, Client: Object.assign({ pid: 7 }, { state: c.state }), Net: { on() {}, send: (m) => { befehle.push(m); return true; } }, Tasten, Consoles };
        global.Client = global.window.Client; global.Consoles = Consoles; global.Net = global.window.Net; global.Tasten = Tasten;
        global.document = { createElement: stub, head: { appendChild() {} }, body: { appendChild() {} } };
        delete require.cache[require.resolve('../public/js/kontingent-ui.js')];
        require('../public/js/kontingent-ui.js');
        return global.window.KontingentUi;
      };
      const UI = laden({ console: 'captain', station: 'helm' });
      LLM.resetBudget(); LLM.setBudgetLimit(60000); LLM.addUsage(54000);
      const S = X.spiel({ names: ['ZEBRAKAI', 'Mireille_Kas'], crew: 2, env: LIVE });
      S.g.players.forEach((p) => { p.zone = 'ship'; });
      const pCap = S.g.players[0], pHelm = S.g.players[1];
      // (a) Captain-Konsole, aber Tab auf dem Steuer-Interface: der Server weist ab, der Client darf nicht freigeben
      pCap.console = 'captain'; pCap.station = 'helm';
      let ui = laden({ console: 'captain', station: 'helm' });
      reset(); K.lesen(snap(ERREICHT));
      ok(ui.konsole() === 'helm' && ui.konsole() === Station.stationOf(pCap), '(a) Captain-Konsole mit Tab Steuer-Interface: Client-Rolle helm = Server-Rolle');
      befehle.length = 0;
      ok(ui.taste({ code: 'KeyK', shiftKey: true, preventDefault() {}, repeat: false }) === true && befehle.length === 0, '(a) Taste Umschalt+K: nichts gesendet (Server würde absagen)');
      ok(K.modell(ui.konsole(), 0).bedienbar === false, '(a) Meldung zeigt den Hinweis "nur Captain", Knopf gesperrt');
      S.g.handleMessage(S.cs[0], { t: 'cmd', c: 'kontingent.freigeben' });
      ok(LLM.budget().limit === 60000, '(a) Server-Gegenprobe: Captain-Konsole auf dem Steuer-Interface darf nicht freigeben');
      // (b) Helm-Spieler mit Tab auf dem Captain-Interface: der Server gibt frei, also muss der Client senden
      pHelm.console = 'helm'; pHelm.station = 'captain';
      ui = laden({ console: 'helm', station: 'captain' });
      reset(); K.lesen(snap(ERREICHT));
      ok(ui.konsole() === 'captain' && ui.konsole() === Station.stationOf(pHelm), '(b) Helm-Konsole mit Tab Captain-Interface: Client-Rolle captain = Server-Rolle');
      befehle.length = 0;
      ok(ui.taste({ code: 'KeyK', shiftKey: true, preventDefault() {}, repeat: false }) === true && befehle.length === 1 && befehle[0].c === 'kontingent.freigeben', '(b) Taste Umschalt+K: Befehl gesendet');
      S.g.handleMessage(S.cs[1], befehle[0]);
      ok(LLM.budget().limit === 560000, '(b) Server-Gegenprobe: Freigabe wirkt (Limit 560 000)');
      // ohne station wie bisher: nur die Konsole zählt
      ui = laden({ console: 'captain' });
      ok(ui.konsole() === 'captain', 'ohne p.station: console captain -> captain');
      ui = laden({ console: null, station: 'captain' });
      ok(ui.konsole() === null, 'ohne Konsole zählt ein veraltetes station nie (wie der Server)');
      delete global.window; delete global.Client; delete global.Consoles; delete global.Net; delete global.Tasten; delete global.document;
    }
    // ---- M3: lehnt der Server per notice ab (kein kontingentAntwort), zeigt der Streifen die Absage, der Knopf hängt nicht im Wartezustand
    {
      reset(); K.lesen({ t: 'welcome', pid: 7 }); K.lesen(snap(ERREICHT));
      const l = gesendet(); K.freigeben(l.send, 'captain', 0);
      K.lesen({ t: 'event', kind: 'notice', pid: 9, text: 'fremde Meldung' });
      ok(K.modell('captain', 10).wartet && K.modell('captain', 10).antwort === null, 'notice an einen anderen Spieler: ändert nichts');
      K.lesen({ t: 'event', kind: 'notice', pid: 7, text: 'Dafür musst du an der passenden Konsole sein.' });
      m = K.modell('captain', 20);
      ok(!m.wartet && m.aktiv && m.antwort && m.antwort.ok === false && m.antwort.text === 'Dafür musst du an der passenden Konsole sein.', 'notice des Servers nach dem Befehl: Absage als Text sichtbar, Knopf wieder frei');
      reset(); K.lesen({ t: 'welcome', pid: 7 }); K.lesen(snap(ERREICHT));
      K.lesen({ t: 'event', kind: 'notice', pid: 7, text: 'irgendein notice' });
      ok(K.modell('captain', 0).antwort === null, 'notice ohne laufenden Befehl: nicht als Absage gezeigt');
    }
  } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
  LLM.resetBudget();
  console.log(`\n${n - fails}/${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})();
