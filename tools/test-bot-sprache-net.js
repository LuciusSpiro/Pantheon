'use strict';
// BOT-04 D1: die Bot-Sprache über die echte Spielverbindung (Net) – Client ohne Browser und ohne Server (Fake-Net, echter Matcher, echtes BotMenue).
//  a) transportNet: send/onMessage/netz/Filter, getrennte Verbindung -> keine falsche Erfolgsmeldung, schliessen() lässt Net in Ruhe
//  b) Sprach- und Textbefehl setzen Quittung und „gilt“ im Menü; Tabelle über ALLE sprechbaren Befehle des Kanons (Sprechform -> Matcher -> bot.befehl -> „gilt“ mit Schlüssel, Wert, Sprechform)
//  c) nicht abbildbare Werte: kein „gilt“ (und die alte Absicht fällt weg), unbekannter Befehl: kein Eintrag; Sendefehler: Eintrag zurück; Adressat botId / Rolle / alle
//  d) Sprache aus: nichts angelegt, kein Net-Zuhörer, kein Net.send, keine Nachladung; starte() am Net, mit ?botmock= (Vorrang), mit verbotenem Mock (Stub)
//  e) genau ein Verarbeiter je Antwort (Sprache an: nur die Sprache zeigt, das Menü führt den Zustand; Sprache aus: das Menü zeigt), letzterBot auch aus Menü-/Tastenantworten
//   node tools/test-bot-sprache-net.js
const fs = require('fs');
const path = require('path');
const BS = require('../public/js/bot-sprache.js');
const BM = require('../public/js/bot-menue.js');
const TK = require('../public/js/pult-befehl-tokens.js');
const M = require('../shared/bot-matcher.js');
const Protocol = require('../shared/protocol.js');
const KANON = require('../content/bots/kanon.json');
const MUSTER = require('../content/bots/muster.json');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');
const tick = () => new Promise((r) => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
M.setzeMuster(Object.assign({}, MUSTER, { kanon: KANON }));

// Fake-Net wie public/js/net.js: send -> false bei geschlossener Verbindung, on(fn) -> abmelden
function fakeNet(o) {
  o = o || {};
  const N = { offen: o.offen !== false, gesendet: [], zuhoerer: [], onAufrufe: 0, sendAufrufe: 0, wirft: !!o.wirft };
  N.isOpen = () => N.offen;
  N.send = (m) => { N.sendAufrufe++; if (N.wirft) throw new Error('kaputt'); if (!N.offen) return false; N.gesendet.push(m); return true; };
  N.on = (fn) => { N.onAufrufe++; N.zuhoerer.push(fn); return () => { const i = N.zuhoerer.indexOf(fn); if (i >= 0) N.zuhoerer.splice(i, 1); }; };
  N.ein = (m) => { for (const f of N.zuhoerer.slice()) f(m); };   // Nachricht vom Server
  return N;
}
const antwort = (befehl, status, extra) => Object.assign({ t: 'bot.antwort', botId: 'b0', befehl, status: status || 'ok', textId: befehl + '.' + (status || 'ok'), text: 'Aye' }, extra);

// Kern + Menü an einem Fake-Net; das Menü sendet über dasselbe Net
let botNr = 0;
const bot = (rolle) => ({ id: 'b' + (botNr++), bot: 1, rolle, connected: true });
function bauen(o) {
  o = o || {};
  const net = o.net || fakeNet();
  const L = { sprUntertitel: [], menUntertitel: [], meldung: [], clips: [] };
  let t = 100000;
  let kern = null;
  const transport = BS.transportNet(net);
  const menue = BM.erzeuge({
    kanon: KANON, tokens: TK, uhr: () => t,
    senden: (m) => net.send(m) !== false,
    anzeige: { untertitel: (text, info) => L.menUntertitel.push({ text, info }), denied() {}, ton() {} },
    antwortenAnzeigen: () => !(kern && kern.istAn() && transport.netz === true),
    befehlTyp: Protocol.C.BOT_BEFEHL,
  });
  menue.synchron(o.crew || [bot('navigation'), bot('ops'), bot('technik'), bot('bord')], 'play');
  net.on((m) => { if (m && m.t === 'bot.antwort') menue.antwort(m); });   // wie pult-befehl.js: das Menü hört selbst an Net (Zustand)
  const text = { v: 'Schilde Steuerbord' };
  const env = Object.assign({
    transport, matcher: () => M, stt: () => Promise.resolve(text.v),
    mikrofon: { start: () => Promise.resolve({ stop: async () => ({ blob: { size: 5000 }, mime: 'audio/webm', dauerMs: 800 }), abbruch() {} }) },
    audio: { spiele: (urls) => { L.clips.push(urls); return Promise.resolve(null); }, stumm() {}, stopp() {} },
    anzeige: { aufnahme() {}, untertitel: (x, info) => { L.sprUntertitel.push({ text: x, info }); }, meldung: (x) => L.meldung.push(x) },
  }, BS.menueAnschluss(() => menue));
  kern = BS.erzeuge(env);
  if (o.an !== false) kern.schalte(true);
  return { net, menue, kern, L, text, transport, zeit: (ms) => { t += ms; } };
}
const sprechen = async (k) => { k.tasteRunter(); await tick(); return k.tasteHoch(); };

// unabhängige Erwartung aus dem Kanon (nicht über BotMenue-Funktionen): Schlüssel, Wert-ID, ganze Sprechform
const ph = (v) => /^\{(\w+)\}$/.exec(String(v));
function erwartung(e, id) {
  const args = e.args || {}, namen = Object.keys(args);
  const fest = namen.filter((a) => !ph(args[a])), platz = namen.filter((a) => ph(args[a]));
  const key = fest.length ? e.befehl + ':' + fest[0] + '=' + args[fest[0]] : platz.length ? e.befehl + ':' + platz[0] : e.befehl;
  const sprech = platz.length ? e.anzeige.replace('{' + ph(args[platz[0]])[1] + '}', e.werte[ph(args[platz[0]])[1]][id].wort) : e.anzeige;
  return { key, wert: platz.length ? String(id) : null, sprech };
}
const sprechbar = [];   // alle Kanon-Einträge mit jedem Wert
for (const e of KANON.befehle) {
  const p = Object.keys(e.args || {}).map((a) => ph(e.args[a])).find((x) => x);
  for (const id of p ? Object.keys(e.werte[p[1]]) : [null]) sprechbar.push({ e, id });
}

(async () => {
  section('a) transportNet: Net.send, Net.on, Filter, getrennte Verbindung');
  {
    const N = fakeNet(), T = BS.transportNet(N);
    ok(T.netz === true && T.stub === undefined, 'netz: true (die Sprache zeigt die Antworten), kein Stub');
    const msg = { t: 'bot.befehl', an: 'ops', befehl: 'ops.scan', quelle: 'text' };
    ok(T.send(msg) === true && eq(N.gesendet, [msg]) && T.offen() === true, 'send geht an Net.send, Ergebnis true');
    const Nu = fakeNet(); Nu.send = () => undefined;   // Net.send ohne Rückgabewert, Verbindung offen
    ok(BS.transportNet(Nu).send(msg) === true, 'Net.send ohne Rückgabewert und offene Verbindung: true');
    const N2 = fakeNet({ offen: false }), T2 = BS.transportNet(N2);
    ok(T2.send(msg) === false && N2.sendAufrufe === 0 && T2.offen() === false, 'Verbindung getrennt (isOpen false): send false, Net.send gar nicht gerufen (keine falsche Erfolgsmeldung)');
    const N3 = fakeNet(); N3.send = () => false;
    ok(BS.transportNet(N3).send(msg) === false, 'Net.send liefert false: send false');
    ok(BS.transportNet(fakeNet({ wirft: true })).send(msg) === false, 'Net.send wirft: send false, keine Ausnahme');
    const N4 = fakeNet(); delete N4.isOpen; N4.send = () => false;
    ok(BS.transportNet(N4).send(msg) === false, 'ohne isOpen zählt das Ergebnis von Net.send');
    const N5 = fakeNet(), T5 = BS.transportNet(N5), got = [];
    const weg = T5.onMessage((m) => got.push(m));
    N5.ein({ t: 'snapshot' }); N5.ein(null); N5.ein({ t: 'event', kind: 'x' }); N5.ein({ t: 'bot.befehl' });
    ok(got.length === 0, 'Filter: nur bot.antwort kommt durch (Snapshot, Ereignis, null, bot.befehl nicht)');
    N5.ein(antwort('ops.scan')); ok(got.length === 1 && got[0].befehl === 'ops.scan', 'bot.antwort kommt durch');
    weg(); N5.ein(antwort('ops.scan')); ok(got.length === 1 && N5.zuhoerer.length === 0, 'abmelden meldet bei Net ab');
    T5.onMessage(() => {}); const vorher = [N5.zuhoerer.length, N5.sendAufrufe, N5.isOpen()];
    T5.schliessen(); ok(eq([N5.zuhoerer.length, N5.sendAufrufe, N5.isOpen()], vorher), 'schliessen() lässt Net unberührt (Verbindung und Zuhörer bleiben)');
    ok(typeof BS.transportNet({}).onMessage(() => {}) === 'function', 'Net ohne on: abmelden ist eine leere Funktion');
  }

  section('b) Sprach- und Textbefehl: Quittung und „gilt“ im Menü');
  {
    const B = bauen();
    ok(await B.kern.sendeText('Schilde Steuerbord') === true, 'Textzeile: gesendet');
    ok(B.net.gesendet.length === 1 && B.net.gesendet[0].t === 'bot.befehl' && B.net.gesendet[0].quelle === 'text' && B.net.gesendet[0].befehl === 'tech.schild' && B.net.gesendet[0].args.sektor === 'stb', 'bot.befehl quelle text, tech.schild stb');
    ok(B.menue.lies().ausstehend === 1 && B.menue.crew()[0].quittung === 'gesendet', 'Eintrag angelegt, Quittung „gesendet“ vor der Antwort');
    B.net.ein(antwort('tech.schild', 'ok', { botId: 'b2' }));
    ok(B.menue.crew()[0].quittung === 'aye', 'Antwort ok: Quittung „aye“');
    ok(eq(B.menue.giltVon('technik'), { key: 'tech.schild:sektor', wert: 'stb', sprech: 'Schilde Steuerbord' }), '„gilt“ Technik: Schilde Steuerbord');
    B.text.v = 'Schub halbe Kraft';
    ok(await sprechen(B.kern) === true && B.net.gesendet[1].quelle === 'sprache' && B.net.gesendet[1].befehl === 'nav.schub' && B.net.gesendet[1].args.stufe === 'halb', 'Sprechtaste: bot.befehl quelle sprache, nav.schub halb');
    B.net.ein(antwort('nav.schub', 'ok'));
    ok(B.menue.giltVon('navigation').key === 'nav.schub:stufe' && B.menue.giltVon('navigation').wert === 'halb', '„gilt“ Navigation: nav.schub halb');
    B.text.v = 'Alle Maschinen stopp'; await sprechen(B.kern); B.net.ein(antwort('nav.stopp', 'ok'));
    ok(eq(B.menue.giltVon('navigation'), { key: 'nav.stopp', wert: null, sprech: 'Alle Maschinen stopp' }), 'Befehl ohne Argument: „gilt“ ohne Wert');
    await B.kern.sendeText('Feuer frei Bugwaffen'); B.net.ein(antwort('ops.feuer_frei', 'ok', { botId: 'b1' }));
    ok(eq(B.menue.giltVon('ops'), { key: 'ops.feuer_frei:waffen', wert: 'bug', sprech: 'Feuer frei Bugwaffen' }), 'Feuer frei Bugwaffen: Schlüssel mit Argument, Wert bug');
    await B.kern.sendeText('Feuer frei'); B.net.ein(antwort('ops.feuer_frei', 'ok', { botId: 'b1' }));
    ok(eq(B.menue.giltVon('ops'), { key: 'ops.feuer_frei', wert: null, sprech: 'Feuer frei' }), 'Feuer frei ohne Waffen: der Eintrag ohne Argument');
    await B.kern.sendeText('Mehr Energie auf Schilde'); B.net.ein(antwort('tech.energie', 'ok', { botId: 'b2' }));
    ok(eq(B.menue.giltVon('technik'), { key: 'tech.energie:delta=1', wert: 'shields', sprech: 'Mehr Energie auf Schilde' }), 'tech.energie: delta=1 im Schlüssel, Wert = System');
    await B.kern.sendeText('Abstand halten 500 Meter'); B.net.ein(antwort('nav.abstand', 'ok'));
    ok(B.menue.giltVon('navigation').key === 'nav.abstand' && B.menue.giltVon('navigation').wert === null, 'nav.abstand mit meter: Eintrag ohne Argument (meter ist kein Menüwert)');
    // Ablehnung: Quittung „nein“, „gilt“ bleibt
    const vor = B.menue.giltVon('ops');
    await B.kern.sendeText('Scannen'); B.net.ein(antwort('ops.scan', 'abgelehnt', { botId: 'b1', textId: 'ops.scan.abgelehnt.nicht_jetzt', text: 'Geht jetzt nicht.' }));
    ok(B.menue.crew()[0].quittung === 'nein' && B.menue.giltVon('ops') === vor, 'Ablehnung: Quittung „nein“, „gilt“ unverändert');
  }

  section('b2) Tabelle: jede Sprechform des Kanons -> Matcher -> bot.befehl -> „gilt“ (Schlüssel, Wert, Sprechform)');
  {
    const B = bauen();
    let falsch = 0, stumm = 0;
    for (const { e, id } of sprechbar) {
      const x = erwartung(e, id);
      B.net.gesendet.length = 0;
      await B.kern.sendeText(x.sprech);
      const m = B.net.gesendet[0];
      if (!m) { stumm++; console.log('  FEHLER kein Befehl für „' + x.sprech + '“'); continue; }
      B.net.ein(antwort(m.befehl, 'ok', { botId: 'b0' }));
      const rolle = e.an, g = rolle === 'alle' ? null : B.menue.giltVon(rolle);
      const richtig = m.befehl === e.befehl && m.quelle === 'text' && (rolle === 'alle' || /^bot\./.test(e.befehl) ? true : !!g && g.key === x.key && g.wert === x.wert && g.sprech === x.sprech);
      if (!richtig) { falsch++; console.log('  FEHLER „' + x.sprech + '“ -> ' + JSON.stringify(m) + ' gilt ' + JSON.stringify(g) + ' erwartet ' + JSON.stringify(x)); }
    }
    ok(sprechbar.length >= 70 && stumm === 0 && falsch === 0, 'alle ' + sprechbar.length + ' Sprechformen des Kanons: richtiger Befehl, „gilt“ mit Schlüssel, Wert und Sprechform (' + falsch + ' falsch, ' + stumm + ' ohne Befehl)');
    ok(sprechbar.filter((s) => s.e.befehl === 'tech.reparieren').length >= 20 && sprechbar.filter((s) => s.e.befehl === 'nav.schub').length === 5, 'die Tabelle enthält alle Werte (tech.reparieren >= 20, nav.schub 5)');
    // direkt: jeder Wert des Kanons als bot.befehl der Sprache (unabhängig vom Matcher)
    const M2 = BM.erzeuge({ kanon: KANON, tokens: TK, senden: () => true }); M2.synchron([bot('navigation'), bot('ops'), bot('technik'), bot('bord')], 'play');
    let direkt = 0;
    for (const { e, id } of sprechbar) {
      const args = {}; for (const a of Object.keys(e.args || {})) args[a] = ph(e.args[a]) ? id : e.args[a];
      const x = erwartung(e, id), v = M2.sprachBefehl({ t: 'bot.befehl', an: e.an, befehl: e.befehl, args, quelle: 'sprache' });
      if (v && v.gilt && v.gilt.key === x.key && v.gilt.wert === x.wert && v.gilt.sprech === x.sprech) direkt++;
      else console.log('  FEHLER direkt ' + JSON.stringify({ e: e.befehl, args }) + ' -> ' + JSON.stringify(v && v.gilt));
    }
    ok(direkt === sprechbar.length, 'ohne Matcher: jedes Argument des Kanons (' + direkt + ' von ' + sprechbar.length + ') wird auf den Menüwert abgebildet');
  }

  section('c) nicht abbildbar, unbekannt, Sendefehler, Adressat');
  {
    const B = bauen();
    await B.kern.sendeText('Schilde Steuerbord'); B.net.ein(antwort('tech.schild', 'ok', { botId: 'b2' }));
    ok(B.menue.giltVon('technik') !== null, 'Ausgangslage: „gilt“ Technik gesetzt');
    const v = B.menue.sprachBefehl({ t: 'bot.befehl', an: 'technik', befehl: 'tech.schild', args: { sektor: 'oben' }, quelle: 'sprache' });
    ok(v && v.gilt === null, 'Wert nicht im Menü (sektor oben): Eintrag ohne „gilt“');
    B.net.ein(antwort('tech.schild', 'ok', { botId: 'b2' }));
    ok(B.menue.giltVon('technik') === null && !('technik' in B.menue.lies().gilt), 'ok ohne abbildbaren Wert: kein falsches „gilt“ (auch kein leerer Eintrag), die alte Absicht fällt weg');
    const w = B.menue.sprachBefehl({ t: 'bot.befehl', an: 'technik', befehl: 'tech.schild', args: { sektor: 'bug', fremd: 1 }, quelle: 'sprache' });
    ok(w && w.gilt === null, 'fremdes Argument: nicht abbildbar, kein „gilt“');
    const z0 = B.menue.lies().ausstehend;
    ok(B.menue.sprachBefehl({ t: 'bot.befehl', an: 'ops', befehl: 'gibt.es.nicht', quelle: 'sprache' }) === null && B.menue.sprachBefehl(null) === null && B.menue.sprachBefehl({ t: 'x', befehl: 'ops.scan' }) === null && B.menue.lies().ausstehend === z0, 'unbekannter Befehl, null, falscher Typ: kein Eintrag');
    // Sendefehler: Eintrag zurück
    const K = bauen({ net: fakeNet({ offen: false }) });
    ok(await K.kern.sendeText('Schilde Steuerbord') === false && K.L.meldung.includes(BS.TEXT.keinBotServer), 'Verbindung zu: „Kein Bot-Server verbunden.“');
    ok(K.menue.lies().ausstehend === 0 && K.menue.crew()[0].quittung === null, 'kein Eintrag, keine Quittung nach Sendefehler');
    const K2 = bauen(); K2.net.send = () => false;
    await K2.kern.sendeText('Schilde Steuerbord'); ok(K2.menue.lies().ausstehend === 0 && K2.menue.crew()[0].quittung === null, 'Net.send false: Eintrag und Quittung zurückgenommen');
    // Adressat botId, Rolle, alle
    const A = bauen();
    const b = A.menue.sprachBefehl({ t: 'bot.befehl', an: 'b1', befehl: 'ops.feuer_frei', args: {}, quelle: 'sprache' });
    ok(b.an === 'ops' && b.erwartet === 1, 'an botId: die Rolle des Befehls, eine Antwort erwartet');
    A.menue.antwort(antwort('ops.feuer_frei', 'ok', { botId: 'b1' }));
    ok(!!A.menue.giltVon('ops') && A.menue.giltVon('ops').key === 'ops.feuer_frei' && A.menue.giltVon('b1') === null && A.menue.crew()[0].quittung === 'aye', '„gilt“ unter der Rolle, nicht unter der botId');
    const al = A.menue.sprachBefehl({ t: 'bot.befehl', an: 'alle', befehl: 'bot.status', args: {}, quelle: 'text' });
    ok(al.erwartet === A.menue.botsZahl() && al.erwartet === 4, 'an alle: so viele Antworten wie Bots');
    A.menue.antwort(antwort('bot.status', 'ok', { botId: 'b0' })); ok(A.menue.crew()[0].quittung !== 'aye', 'an alle: nach der ersten von vier Antworten noch kein „aye“');
    for (const i of [1, 2, 3]) A.menue.antwort(antwort('bot.status', 'ok', { botId: 'b' + i }));
    ok(A.menue.crew()[0].quittung === 'aye', 'an alle: nach der letzten „aye“');
    const ro = A.menue.sprachBefehl({ t: 'bot.befehl', an: 'ops', befehl: 'bot.status', args: {}, quelle: 'text' });
    ok(ro.an === 'ops' && ro.erwartet === 1, 'bot.status an eine Rolle: eine Antwort');
  }

  section('d) Sprache aus: nichts angelegt, kein Net, keine Nachladung');
  {
    const B = bauen({ an: false });
    ok(B.net.onAufrufe === 1 && B.net.zuhoerer.length === 1, 'aus: kein Zuhörer der Sprache an Net (nur der des Menüs)');
    ok(await B.kern.sendeText('Schilde Steuerbord') === false && B.net.sendAufrufe === 0 && B.menue.lies().ausstehend === 0, 'aus: Textzeile sendet nichts, kein Eintrag im Menü');
    ok(await sprechen(B.kern) === false && B.net.sendAufrufe === 0, 'aus: Sprechtaste tut nichts');
    B.net.ein(antwort('tech.schild')); ok(B.L.sprUntertitel.length === 0 && B.L.clips.length === 0, 'aus: Antworten zeigt die Sprache nicht');
    B.kern.schalte(true); ok(B.net.zuhoerer.length === 2, 'an: genau ein Zuhörer der Sprache dazu'); B.kern.schalte(false); ok(B.net.zuhoerer.length === 1, 'wieder aus: abgemeldet');
    const O = bauen({ an: false }); O.net.ein(antwort('ops.scan', 'ok'));
    ok(O.menue.lies().ausstehend === 0 && O.menue.giltVon('ops') === null, 'Antwort ohne Eintrag (Menschenpartie ohne Sprache): kein „gilt“ aus dem Nichts');
    const q = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'bot-sprache.js'), 'utf8').replace(/\r\n/g, '\n');
    const kernText = q.slice(q.indexOf('function erzeuge(env)'), q.indexOf('// ====='));
    ok(!/\bNet\b|fetch|\/api\/stt/.test(kernText.replace(/\/\/.*$/gm, '')), 'Kern greift nie selbst auf Net, fetch oder /api/stt zu (nur über den Transport)');
    const pb = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pult-befehl.js'), 'utf8');
    ok(!/BotSprache\.starte|sprachBefehl/.test(pb), 'pult-befehl.js startet die Sprache nie und legt keine Sprach-Einträge an');
  }

  section('d2) starte() im (Fake-)Fenster: Net, ?botmock= Vorrang, verbotener Mock; e) ein Verarbeiter je Antwort');
  {
    const fensterBauen = (search, o) => {
      o = o || {};
      const net = fakeNet(); const L = { fetch: [], ws: [], titel: [] };
      const elem = () => ({ style: {}, children: [], appendChild() {}, addEventListener() {}, setAttribute() {}, remove() {}, focus() {}, blur() {} });
      const doc = { createElement: elem, body: elem(), activeElement: null, getElementById: () => null, head: elem() };
      class WS { constructor(u) { L.ws.push(u); this.readyState = 0; } send() {} close() {} }
      const hud = { sprech: { aktiv: false, aufnahme: false, verarbeitet: false }, notices: [], sprechAn(b) { this.sprech.aktiv = !!b; }, sprechBereit: () => true, pushNotice() {}, pushCrewFunk(t, wer) { L.titel.push({ t, wer }); return L.titel.length; }, crewFunkHalte() {} };
      const win = {
        location: { search }, document: doc, Net: o.ohneNet ? undefined : net, Hud: hud, WebSocket: WS,
        Shared_BotMatcher: M, addEventListener() {}, removeEventListener() {},
        fetch: (u) => { L.fetch.push(u); const j = /muster/.test(u) ? MUSTER : /kanon/.test(u) ? KANON : null; return Promise.resolve({ ok: !!j, json: () => Promise.resolve(j) }); },
      };
      return { win, net, L, hud };
    };
    // das Menü wie pult-befehl.js: eigener Net.on-Zuhörer, Anzeige nur wenn die Sprache nicht am Spielnetz zeigt
    const menueFuer = (win) => {
      const men = [];
      const m = BM.erzeuge({ kanon: KANON, tokens: TK, uhr: () => 1, senden: (x) => win.Net.send(x) !== false, antwortenAnzeigen: () => !BS.netAntworten(), anzeige: { untertitel: (t) => men.push(t), denied() {}, ton() {} }, befehlTyp: Protocol.C.BOT_BEFEHL });
      m.synchron([bot('navigation'), bot('ops'), bot('technik')], 'play'); win.PultBefehl = { menue: m };
      win.Net.on((x) => { if (x && x.t === 'bot.antwort') m.antwort(x); });
      return { m, men };
    };
    // 1) am Spielnetz
    let F = fensterBauen('?botsprache=1'); let { m, men } = menueFuer(F.win);
    const k = await BS.starte(F.win);
    ok(BS.laeuft() && BS.netAntworten() === true && F.L.ws.length === 0, 'starte am Net: Net-Transport (netz: true), kein WebSocket');
    ok(F.net.zuhoerer.length === 2, 'Net hat genau zwei Zuhörer: das Menü (Zustand) und die Sprache (Anzeige)');
    ok(F.hud.sprech.aktiv === true, 'Sprechspalte an');
    await k.sendeText('Schilde Heck');
    ok(F.net.gesendet.length === 1 && F.net.gesendet[0].quelle === 'text' && F.net.gesendet[0].args.sektor === 'heck' && m.lies().ausstehend === 1, 'Textzeile über starte(): bot.befehl am Net, Eintrag im Menü (PultBefehl.menue)');
    F.net.ein(antwort('tech.schild', 'ok', { botId: 'b2', text: 'Aye, Schilde umgelegt.' }));
    ok(eq(F.L.titel.map((x) => x.t), ['Aye, Schilde umgelegt.']) && men.length === 0, 'e) genau EIN Untertitel je Antwort: die Sprache (HUD), das Menü bleibt still');
    ok(m.crew()[0].quittung === 'aye' && m.giltVon('technik').wert === 'heck' && m.giltVon('technik').sprech === 'Schilde Heck', 'das Menü führt Quittung und „gilt“ für den Sprachbefehl');
    F.net.ein(antwort('nav.stopp', 'ok', { botId: 'b0', text: 'Maschinen stehen.' }));
    ok(F.L.titel.length === 2 && men.length === 0, 'Antwort auf einen Menü-/Tastenbefehl bei Sprache an: ein Untertitel, von der Sprache');
    BS.stoppe();
    ok(!BS.laeuft() && BS.netAntworten() === false && F.net.zuhoerer.length === 1, 'stoppe: die Sprache meldet sich ab, das Menü bleibt an Net');
    F.net.ein(antwort('nav.stopp', 'ok', { botId: 'b0', text: 'Maschinen stehen.' }));
    ok(F.L.titel.length === 2 && men.length === 1, 'Sprache aus: das Menü zeigt die Antwort (wie vorher), die Sprache nicht');
    // 2) ?botmock= hat Vorrang
    F = fensterBauen('?botmock=ws://localhost:8710'); menueFuer(F.win);
    await BS.starte(F.win);
    ok(F.L.ws.length === 1 && F.L.ws[0] === 'ws://localhost:8710' && BS.netAntworten() === false && F.net.zuhoerer.length === 1, '?botmock=: WebSocket zum Mock, KEIN Net-Transport (nur das Menü hört an Net)');
    BS.stoppe();
    // 3) verbotener Mock: nie still die echte Verbindung
    F = fensterBauen('?botmock=ws://fremd.example:8710'); menueFuer(F.win);
    const k3 = await BS.starte(F.win);
    ok(F.L.ws.length === 0 && BS.netAntworten() === false, 'verbotener Mock: kein WebSocket, kein Net-Transport');
    await k3.sendeText('Schilde Heck'); ok(F.net.gesendet.length === 0, 'verbotener Mock: Befehle gehen nicht an den Spielserver');
    BS.stoppe();
    // 4) kein Net im Fenster
    F = fensterBauen('?botsprache=1', { ohneNet: true });
    const k4 = await BS.starte(F.win);
    ok(BS.laeuft() && BS.netAntworten() === false && (await k4.sendeText('Schilde Heck')) === false, 'ohne Net im Fenster: Stub, „Kein Bot-Server verbunden“');
    BS.stoppe();
    ok(!BS.laeuft() && F.L.fetch.every((u) => /^\/content\/bots\//.test(u)) && !F.L.fetch.some((u) => /stt/.test(u)), 'kein Request an /api/stt (nur der Matcher holt Kanon und Muster)');
  }

  section('e) letzterBot aus Antworten des Servers (Menü-/Tastenbefehle), Stimme von bot.unklar');
  {
    const B = bauen();
    B.net.ein(antwort('nav.stopp', 'ok', { botId: 'b2' }));   // vom Menü oder einer Taste ausgelöst: die Sprache hört mit
    ok(B.L.sprUntertitel.length === 1 && B.L.sprUntertitel[0].info.botId === 'b2', 'Antwort ohne Sprachbefehl: Untertitel der Sprache');
    B.text.v = 'Quatsch mit Sosse'; await sprechen(B.kern);
    ok(B.L.clips.length === 2 && /\/b2\/bot\.unklar/.test(B.L.clips[1][0]), 'bot.unklar mit der Stimme des zuletzt antwortenden Bots (b2): ' + (B.L.clips[1] && B.L.clips[1][0]));
    const C = bauen(); C.text.v = 'Quatsch mit Sosse'; await sprechen(C.kern);
    ok(/\/b0\/bot\.unklar/.test(C.L.clips[0][0]), 'ohne Antwort und ohne Anrede: Stimme b0');
    await C.kern.sendeText('Schilde Steuerbord'); C.net.ein(antwort('tech.schild', 'ok', { botId: 'b1' }));
    await C.kern.sendeText('Quatsch mit Sosse'); ok(/\/b1\/bot\.unklar/.test(C.L.clips[C.L.clips.length - 1][0]), 'nach einer Antwort von b1: Stimme b1');
  }

  console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'test-bot-sprache-net: ' + n + ' Pruefungen gruen'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER ' + (e && e.stack || e)); process.exit(1); });
