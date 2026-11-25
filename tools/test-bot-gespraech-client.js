'use strict';
// BOT-05 B2: Gespraech im Client (public/js/bot-sprache.js, Kern und Browser-Anschluss) ohne Browser, Mikrofon und Netz (Fake-Umgebung, echter Matcher).
//  1 Tasten: eigene Gespraechstasten (Standard, Umbelegung, keine Konflikte), im Browser-Anschluss ohne Bots wirkungslos und ohne Schlucken
//  2 Adressat: Name vorn (auch unscharf), letzter Gespraechspartner, zuletzt per Befehl angesprochener Bot, erster Bot, Figur nicht an Bord
//  3 Kein Befehl: Text und Sprache ueber die Gespraechswege senden NUR bot.gespraech (auch bei Befehlswortlaut), der Befehlsmatcher laeuft nicht
//  4 Anzeige: denkt nach -> Saetze -> Ende, nicht erreichbar, abgelehnt (rate, kein_bot), ersetzt, veraltete Nachrichten
//  5 Ton: je gid in nr-Reihenfolge, nicht bei gehaltener Taste, ersetzt stoppt, fehlende/ungueltige audio, Ausfall
//  6 bot.status mit Stimme: nach dem Bestaetigungs-Clip, kein zweiter Untertitel, mehrere Bots nacheinander
//   node tools/test-bot-gespraech-client.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BS = require('../public/js/bot-sprache.js');
const Matcher = require('../shared/bot-matcher.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');
const tick = () => new Promise((r) => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const BOTS = [{ botId: 'b0', name: 'Livia' }, { botId: 'b1', name: 'Cassius' }, { botId: 'b2', name: 'Titus' }];
const URL_A = (i) => '/api/bot-rede/' + String(i).repeat(32) + '.wav';
const gid = (i) => 'g' + i;

// Fake-Umgebung: zaehlt alles, was nach aussen geht
function fake(o) {
  o = o || {};
  const L = { mik: 0, stt: 0, matchAufrufe: 0, send: [], untertitel: [], weg: [], meldung: [], clips: [], spiele: [], stopp: 0, stumm: [], halt: [] };
  let zeit = 0, idZ = 0;
  const bots = o.bots === undefined ? BOTS : o.bots;
  const env = {
    uhr: () => (zeit += 10),
    transport: { send: (m) => { L.send.push(m); return o.sendOk === false ? false : true; }, onMessage: (fn) => { L.fn = fn; return () => {}; } },
    partie: () => ({ bots }),
    matcher: () => ({ match: (t) => { L.matchAufrufe++; return Matcher.match(t); }, figurAnrede: (t) => Matcher.figurAnrede(t) }),
    stt: () => { L.stt++; return Promise.resolve(o.text === undefined ? 'Livia, wie steht es?' : o.text); },
    mikrofon: { start: () => { L.mik++; return Promise.resolve({ stop: async () => ({ blob: { size: 5000 }, mime: 'audio/webm', dauerMs: 800 }), abbruch() {} }); } },
    audio: {
      spiele: (urls, cb) => { const e = { urls, cb, p: null }; L.spiele.push(e); e.p = Promise.resolve(o.spieleErgebnis ? o.spieleErgebnis(urls, L.spiele.length) : urls[0]); return e.p; },
      stumm: (b) => { L.stumm.push(b); }, stopp: () => { L.stopp++; },
    },
    anzeige: {
      aufnahme() {}, meldung: (t) => { L.meldung.push(t); },
      untertitel: (t, info) => { const id = ++idZ; L.untertitel.push({ id, t, info: info || {} }); return id; },
      untertitelWeg: (id) => { L.weg.push(id); },
      clip: (id, an) => { L.halt.push([id, an]); },
    },
  };
  const k = BS.erzeuge(env);
  k.schalte(true);
  return { k, L, env };
}
const rede = (k, o) => k.empfange(Object.assign({ t: 'bot.rede', botId: 'b1' }, o));
const sprechenGespraech = async (k) => { k.gespraechSprechenRunter(); await tick(); return k.gespraechSprechenHoch(); };
const letzte = (L) => L.send[L.send.length - 1];

(async () => {
  // ------------------------------------------------------------------------------------------ 1 Tasten
  section('1 Tasten');
  {
    const win = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tasten.js'), 'utf8'), { window: win, console });
    const T = win.Tasten;
    ok(eq(T.belegung('allgemein.gespraechText'), ['Semicolon']) && eq(T.belegung('allgemein.gespraechSprechen'), ['Quote']), 'Standard: Gespraech tippen = Ö (Semicolon), Gespraech sprechen = Ä (Quote)');
    ok(T.aktion('allgemein.gespraechText').gruppe === 'allgemein' && T.aktion('allgemein.gespraechSprechen').gruppe === 'allgemein', 'beide in der Gruppe Allgemein (Menue zeigt sie)');
    ok(T.passt({ code: 'Semicolon', shiftKey: false }, 'allgemein.gespraechText') && T.passt({ code: 'Quote', shiftKey: false }, 'allgemein.gespraechSprechen') && !T.passt({ code: 'Quote', shiftKey: true }, 'allgemein.gespraechSprechen'), 'passt: Shift muss exakt stimmen');
    ok(T.GRUPPEN.every((g) => T.konflikte(g.id).length === 0), 'keine Tastenkonflikte in keiner Gruppe');
    const belegt = new Map();
    for (const a of T.AKTIONEN) for (const t of T.belegung(a.id)) (belegt.get(t) || belegt.set(t, []).get(t)).push(a.id);
    ok(eq(belegt.get('Semicolon'), ['allgemein.gespraechText']) && eq(belegt.get('Quote'), ['allgemein.gespraechSprechen']), 'Ö und Ä sind in keiner anderen Gruppe belegt');
    ok(T.setze('allgemein.gespraechSprechen', 0, 'F9') && T.passt({ code: 'F9' }, 'allgemein.gespraechSprechen'), 'umbelegbar');
    ok(T.kappeVon('Semicolon') === 'Ö' && T.kappeVon('Quote') === 'Ä', 'Beschriftung Ö und Ä');
  }

  // ------------------------------------------------------------------------------------------ 1b Browser-Anschluss
  section('1b Browser-Anschluss (starte mit Fake-Fenster): ohne Bots wirkungslos');
  {
    const tw = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tasten.js'), 'utf8'), { window: tw, console });
    const mk = (tag) => { const e = { tag, style: {}, children: [], listeners: {}, textContent: '', attrs: {}, value: '', appendChild(c) { this.children.push(c); }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute(k, v) { this.attrs[k] = v; }, focus() { doc.activeElement = this; }, blur() { doc.activeElement = null; }, remove() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) }; return e; };
    const canvas = mk('canvas');
    const doc = { createElement: mk, body: mk('body'), head: mk('head'), activeElement: null, getElementById: (id) => (id === 'game' ? canvas : null) };
    const inhalt = (u) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', u.replace(/^\//, '')), 'utf8'));
    const lauf = async (spieler) => {
      const hud = { sprech: { aktiv: false, bots: false, aufnahme: false, verarbeitet: false, zeile: null }, notices: [], titel: [],
        sprechAn(b) { hud.sprech.aktiv = !!b; }, sprechBereit: () => true, pushNotice(t) { hud.notices.push(t); }, pushCrewFunk(t, wer) { hud.titel.push({ t, wer }); return hud.titel.length; }, crewFunkHalte() {}, crewFunkWeg() {} };
      const gesendet = [], hand = {};
      const win = {
        location: { search: '' }, document: doc, Hud: hud, Tasten: tw.Tasten, Shared_BotMatcher: Matcher, Menue: { TOKENS: { FN: { sensor: '#A', warn: '#B' }, FARBE: {} } },
        Client: { scale: 1, state: { phase: 'play', players: spieler }, eingabeFrei: () => true, tastenFreigeben() {} },
        Net: { isOpen: () => true, send: (m) => { gesendet.push(m); return true; }, on: () => () => {} },
        fetch: (u) => Promise.resolve({ ok: true, json: async () => inhalt(u) }),
        addEventListener(t, f) { (hand[t] = hand[t] || []).push(f); }, removeEventListener() {},
      };
      const k = await BS.starte(win);
      const taste = (code) => { let vorbei = 0; const e = { code, shiftKey: false, repeat: false, preventDefault: () => { vorbei++; } }; for (const f of hand.keydown) f(e); return { geschluckt: vorbei }; };
      return { win, hud, gesendet, taste, k, stop: () => BS.stoppe() };
    };
    // ohne Bots
    let r = await lauf([{ id: 'p1', name: 'Kai' }]);
    const zeileForm = () => doc.body.children[0] && doc.body.children[0].children[0];
    let a = r.taste('Semicolon'), b = r.taste('Quote');
    ok(a.geschluckt === 0 && b.geschluckt === 0, 'ohne Bots: Ö und Ä werden nicht geschluckt (preventDefault bleibt aus)');
    ok(r.hud.sprech.zeile && !r.hud.sprech.zeile.offen && !r.hud.notices.some((t) => /Mikrofon/.test(t)), 'ohne Bots: keine Zeile, kein Mikrofonversuch');
    ok(r.taste('Backslash').geschluckt === 1 && r.hud.sprech.zeile.offen, 'Gegenprobe: # (Befehlszeile) geht weiterhin, auch ohne Bots');
    r.hud.sprech.zeile.schliessen();
    r.stop();
    // mit Bots, aber Lobby: ebenfalls nichts
    r = await lauf([{ id: 'p1', name: 'Kai' }, { id: 'p2', name: 'Livia', bot: 1, botId: 'b0', rolle: 'navigation' }]);
    r.win.Client.state.phase = 'lobby';
    ok(r.taste('Semicolon').geschluckt === 0 && !r.hud.sprech.zeile.offen, 'Lobby (kein Spiel): Taste tut nichts');
    r.win.Client.state.phase = 'play';
    // mit Bots
    a = r.taste('Semicolon');
    ok(a.geschluckt === 1 && r.hud.sprech.zeile.offen && r.hud.sprech.zeile.platzhalter === BS.TEXT.platzhalterGespraech, 'mit Bots: Ö oeffnet die Gespraechszeile (eigener Platzhalter)');
    const feld = r.hud.sprech.zeile.feld; feld.value = 'Schilde Steuerbord';
    doc.body.children.at(-1).children[0].listeners.submit[0]({ preventDefault() {} });
    await tick(); await tick(); await tick();
    ok(r.gesendet.length === 1 && r.gesendet[0].t === 'bot.gespraech' && r.gesendet[0].an === 'b0' && r.gesendet[0].text === 'Schilde Steuerbord' && r.gesendet[0].quelle === 'text', 'Enter in der Gespraechszeile: bot.gespraech an b0 (nie bot.befehl): ' + JSON.stringify(r.gesendet));
    ok(r.hud.titel.some((x) => x.t === 'Schilde Steuerbord' && x.wer === 'DU'), 'die eigene Zeile steht kurz als "DU:" in der Sprechspalte');
    // Befehlszeile (#) bleibt der Befehlsweg
    r.taste('Backslash'); r.hud.sprech.zeile.feld.value = 'Schilde Steuerbord';
    doc.body.children.at(-1).children[0].listeners.submit[0]({ preventDefault() {} });
    await tick(); await tick(); await tick();
    ok(r.gesendet.length === 2 && r.gesendet[1].t === 'bot.befehl' && r.gesendet[1].quelle === 'text', 'Gegenprobe: dieselbe Zeile ueber # sendet weiter bot.befehl');
    // Ä: Aufnahme wird versucht (kein Mikrofon im Fake-Fenster -> Mikrofon-Meldung)
    b = r.taste('Quote');
    await tick(); await tick();
    ok(b.geschluckt === 1 && r.hud.notices.some((t) => /Mikrofon/.test(t)), 'mit Bots: Ä startet die Aufnahme (Fake-Fenster ohne Mikrofon: Meldung)');
    r.stop();
  }

  // ------------------------------------------------------------------------------------------ 2 Adressat
  section('2 Adressat');
  {
    const { k, L } = fake();
    ok((await k.sendeGespraechText('Livia, wie steht es?')) === true && eq(letzte(L), { t: 'bot.gespraech', an: 'b0', text: 'Livia, wie steht es?', quelle: 'text' }), 'Name vorn mit Komma: an b0, der Name bleibt im Text');
    await k.sendeGespraechText('cassius wie weit sind wir'); ok(letzte(L).an === 'b1' && letzte(L).text === 'cassius wie weit sind wir', 'ohne Komma, klein geschrieben: b1');
    await k.sendeGespraechText('Tidus hast du Zeit'); ok(letzte(L).an === 'b2', 'unscharf (Tidus): b2, wie beim Matcher');
    await k.sendeGespraechText('Und wie sieht es mit der Fracht aus?'); ok(letzte(L).an === 'b2' && k.partner() === 'b2', 'ohne Namen: der letzte Gespraechspartner (b2)');
    await k.sendeGespraechText('Hallo Livia'); ok(letzte(L).an === 'b2', 'Name nicht am Anfang zaehlt nicht: weiter der letzte Partner');
    const f2 = fake();
    f2.k.empfange({ t: 'bot.antwort', botId: 'b1', befehl: 'ops.scan', status: 'ok', textId: 'ops.scan.ok', text: 'Scan' });
    await f2.k.sendeGespraechText('Wie geht es dir?'); ok(letzte(f2.L).an === 'b1', 'ohne Gespraech: der zuletzt per Befehl angesprochene Bot (b1)');
    const f3 = fake();
    await f3.k.sendeGespraechText('Wie geht es dir?'); ok(letzte(f3.L).an === 'b0', 'sonst der erste Bot der Partie');
    const f4 = fake({ bots: [{ botId: 'b1', name: 'Cassius' }, { botId: 'b2', name: 'Titus' }] });
    f4.k.empfange({ t: 'bot.rede', botId: 'b0', gid: gid(1), zustand: 'denkt' });   // alter Partner b0 ist weg
    await f4.k.sendeGespraechText('Wie geht es dir?'); ok(letzte(f4.L).an === 'b1', 'Partner nicht mehr an Bord: weiter zum naechsten Kriterium (erster Bot)');
    const f5 = fake({ bots: [{ botId: 'b1', name: 'Cassius' }] });
    ok((await f5.k.sendeGespraechText('Livia, bist du da?')) === false && f5.L.send.length === 0, 'Figur nicht an Bord: nichts gesendet');
    ok(f5.L.untertitel.length === 1 && f5.L.untertitel[0].t === 'Livia ist nicht an Bord.' && !f5.L.untertitel[0].info.botId, 'lokaler Untertitel "Livia ist nicht an Bord."');
    const f6 = fake();
    ok((await f6.k.sendeGespraechText('   ')) === false && f6.L.send.length === 0, 'leerer Text: nichts');
    const lang = 'a'.repeat(300); await f6.k.sendeGespraechText(lang); ok(letzte(f6.L).text.length === 200, 'auf 200 Zeichen gekuerzt (Server-Grenze)');
    const f7 = fake({ sendOk: false });
    ok((await f7.k.sendeGespraechText('Hallo')) === false && f7.L.meldung.at(-1) === BS.TEXT.keinBotServer && f7.L.untertitel.length === 0, 'Sendefehler: Meldung "Kein Bot-Server verbunden", kein DU-Untertitel');
  }

  // ------------------------------------------------------------------------------------------ 3 Gespraech ist nie ein Befehl
  section('3 Kein Befehl');
  {
    const { k, L } = fake({ text: 'Schilde Steuerbord' });
    ok(Matcher.match('Schilde Steuerbord') && Matcher.match('Schilde Steuerbord').befehl, 'Vorbedingung: der Matcher erkennt den Wortlaut als Befehl');
    await k.sendeGespraechText('Schilde Steuerbord');
    ok(L.send.length === 1 && L.send[0].t === 'bot.gespraech' && L.send[0].quelle === 'text', 'Text "Schilde Steuerbord" ueber die Gespraechszeile: bot.gespraech');
    ok((await sprechenGespraech(k)) === true && L.send.length === 2 && L.send[1].t === 'bot.gespraech' && L.send[1].quelle === 'sprache' && L.send[1].text === 'Schilde Steuerbord', 'Sprache "Schilde Steuerbord" ueber die Gespraechstaste: bot.gespraech, quelle sprache');
    for (const t of ['Feuer frei', 'Alle Maschinen stopp', 'Livia, Schilde Steuerbord', 'Titus Kurs 270']) { await k.sendeGespraechText(t); }
    ok(L.send.every((m) => m.t === 'bot.gespraech') && !L.send.some((m) => m.t === 'bot.befehl' || 'befehl' in m), 'alle Nachrichten sind bot.gespraech, keine bot.befehl, kein Feld "befehl" (' + L.send.length + ' gesendet)');
    ok(L.matchAufrufe === 0, 'der Befehlsmatcher (match) wird fuer Gespraeche nie aufgerufen');
    // Gegenprobe: die Befehlswege bleiben
    const g = fake({ text: 'Schilde Steuerbord' });
    await g.k.sendeText('Schilde Steuerbord');
    ok(g.L.send.length === 1 && g.L.send[0].t === 'bot.befehl' && g.L.send[0].quelle === 'text', 'Gegenprobe: sendeText (Befehlszeile) sendet weiter bot.befehl');
    const h = fake({ text: 'Schilde Steuerbord' });
    h.k.tasteRunter(); await tick(); await h.k.tasteHoch();
    ok(h.L.send.length === 1 && h.L.send[0].t === 'bot.befehl' && h.L.send[0].quelle === 'sprache', 'Gegenprobe: Sprechtaste (^) sendet weiter bot.befehl');
  }

  // ------------------------------------------------------------------------------------------ 3b Wirkungslos ohne Bots / ohne Sprache
  section('3b Ohne Bots und ohne Sprache');
  {
    const a = fake({ bots: [] });
    ok(a.k.botsDa() === false && a.k.gespraechSprechenRunter() === false && (await a.k.sendeGespraechText('Hallo')) === false, 'ohne Bots: Gespraechstasten tun nichts');
    ok(a.L.mik === 0 && a.L.stt === 0 && a.L.send.length === 0 && a.L.untertitel.length === 0 && a.L.meldung.length === 0 && a.L.stumm.length === 0, 'ohne Bots: kein Mikrofon, kein STT, nichts gesendet, nichts angezeigt');
    ok(a.k.lies().aufnahme === false, 'ohne Bots: keine Aufnahme (Befehlstaste frei)');
    a.k.schalte(false);
    const b = fake();
    b.k.schalte(false);
    ok(b.k.botsDa() === false && b.k.gespraechSprechenRunter() === false && (await b.k.sendeGespraechText('Hallo')) === false && b.L.send.length === 0 && b.L.mik === 0, 'Sprache aus: nichts');
    ok(b.k.empfange({ t: 'bot.rede', botId: 'b1', gid: gid(1), zustand: 'denkt' }) === false && b.L.untertitel.length === 0, 'Sprache aus: bot.rede wird nicht angezeigt');
    const c = fake({ bots: undefined });
    c.env.partie = undefined;   // Umgebung ohne partie(): wie ohne Bots
    const k2 = BS.erzeuge(Object.assign({}, c.env)); k2.schalte(true);
    ok(k2.botsDa() === false && k2.gespraechSprechenRunter() === false, 'ohne env.partie: keine Bots');
  }

  // ------------------------------------------------------------------------------------------ 4 Anzeige
  section('4 Anzeige');
  {
    const { k, L } = fake();
    await k.sendeGespraechText('Cassius, Lage?');
    ok(L.untertitel.length === 1 && L.untertitel[0].t === 'Cassius, Lage?' && L.untertitel[0].info.sprecher === 'DU', 'eigene Zeile als "DU: ..."');
    rede(k, { gid: gid(1), zustand: 'denkt' });
    const denkt = L.untertitel[1];
    ok(denkt.t === 'denkt nach …' && denkt.info.botId === 'b1' && denkt.info.dauerS > 20, '"<NAME>: denkt nach …" (Sprecher = Figur b1), bleibt bis zum ersten Satz');
    rede(k, { gid: gid(1), zustand: 'satz', nr: 0, text: 'Kurs 270 Grad, Captain.' });
    ok(eq(L.weg, [denkt.id]) && L.untertitel[2].t === 'Kurs 270 Grad, Captain.' && L.untertitel[2].info.botId === 'b1', 'erster Satz: "denkt nach" weg, Satz als Untertitel mit dem Namen der Figur');
    rede(k, { gid: gid(1), zustand: 'satz', nr: 1, text: 'Die Schilde stehen bei 100 Prozent.' });
    ok(L.untertitel[3].t === 'Die Schilde stehen bei 100 Prozent.' && L.weg.length === 1, 'zweiter Satz: weiterer Untertitel, denkt nicht doppelt entfernt');
    rede(k, { gid: gid(1), zustand: 'ende' });
    ok(L.untertitel.length === 4 && L.meldung.length === 0, 'ende: nichts Neues');
    // Untertitel laufen auch mit Ton mit
    rede(k, { gid: gid(2), zustand: 'denkt' }); rede(k, { gid: gid(2), zustand: 'satz', nr: 0, text: 'Zweite Antwort, Captain.' }); rede(k, { gid: gid(2), zustand: 'ton', nr: 0, audio: URL_A('a') });
    ok(L.untertitel.at(-1).t === 'Zweite Antwort, Captain.' && L.spiele.length === 1, 'Untertitel immer, auch wenn Ton kommt');
    rede(k, { gid: gid(2), zustand: 'ende' });
    // nicht erreichbar
    const e = fake(); await e.k.sendeGespraechText('Titus, Lage?');
    rede(e.k, { botId: 'b2', gid: gid(3), zustand: 'denkt' });
    rede(e.k, { botId: 'b2', gid: gid(3), zustand: 'nicht_erreichbar', grund: 'llm' });
    ok(e.L.meldung.at(-1) === 'Titus ist nicht erreichbar.' && e.L.weg.length === 1, 'nicht_erreichbar: "Titus ist nicht erreichbar.", denkt weg');
    for (const grund of ['zeit', 'leer']) { rede(e.k, { botId: 'b2', gid: gid(4), zustand: 'denkt' }); rede(e.k, { botId: 'b2', gid: gid(4), zustand: 'nicht_erreichbar', grund }); }
    ok(e.L.meldung.filter((m) => m === 'Titus ist nicht erreichbar.').length === 3, 'auch bei Zeitlimit und leerer Antwort');
    // abgelehnt ohne denkt
    const r = fake();
    rede(r.k, { botId: 'b1', gid: gid(5), zustand: 'abgelehnt', grund: 'rate' });
    ok(r.L.untertitel.at(-1).t === 'Einen Moment, Captain.' && r.L.untertitel.at(-1).info.botId === 'b1', 'abgelehnt/rate: "Einen Moment, Captain." von der Figur');
    rede(r.k, { botId: null, gid: gid(6), zustand: 'abgelehnt', grund: 'kein_bot' });
    ok(/nicht an Bord/.test(r.L.untertitel.at(-1).t), 'abgelehnt/kein_bot: Hinweis');
    const nU = r.L.untertitel.length;
    rede(r.k, { botId: 'b1', gid: gid(7), zustand: 'abgelehnt', grund: 'phase' }); rede(r.k, { botId: 'b1', gid: gid(8), zustand: 'abgelehnt', grund: 'quelle' });
    ok(r.L.untertitel.length === nU, 'abgelehnt/phase und quelle: still');
    // ersetzt beendet die alte Anzeige still
    const s = fake();
    rede(s.k, { gid: gid(9), zustand: 'denkt' });
    const d9 = s.L.untertitel[0].id;
    rede(s.k, { gid: gid(9), zustand: 'abgelehnt', grund: 'ersetzt' });
    ok(eq(s.L.weg, [d9]) && s.L.meldung.length === 0 && s.L.untertitel.length === 1, 'ersetzt: "denkt nach" weg, keine Meldung, kein Untertitel');
    rede(s.k, { gid: gid(10), zustand: 'denkt' }); rede(s.k, { gid: gid(10), zustand: 'satz', nr: 0, text: 'Neue Antwort, Captain.' });
    rede(s.k, { gid: gid(9), zustand: 'satz', nr: 1, text: 'Alter Satz, der nicht mehr gilt.' });
    ok(s.L.untertitel.at(-1).t === 'Neue Antwort, Captain.' && !s.L.untertitel.some((u) => /Alter Satz/.test(u.t)), 'Nachzuegler der ersetzten Anfrage werden ignoriert');
    // ersetzt nach schon gezeigten Saetzen: Saetze bleiben stehen (laufen aus), Ton stoppt
    const t = fake();
    rede(t.k, { gid: gid(11), zustand: 'denkt' }); rede(t.k, { gid: gid(11), zustand: 'satz', nr: 0, text: 'Erster Satz, Captain.' });
    rede(t.k, { gid: gid(11), zustand: 'abgelehnt', grund: 'ersetzt' });
    ok(t.L.meldung.length === 0 && t.L.untertitel.length === 2, 'ersetzt nach einem Satz: keine Meldung');
    // Nachrichten ohne gid / unbekannter Zustand schaden nicht
    ok(rede(t.k, { zustand: 'denkt' }) === false && rede(t.k, { gid: gid(12), zustand: 'quatsch' }) === false, 'ohne gid oder mit unbekanntem Zustand: ignoriert');
    ok(!/undefined/.test(JSON.stringify(t.L.untertitel)), 'keine undefined-Texte');
  }

  // ------------------------------------------------------------------------------------------ 5 Ton
  section('5 Ton');
  {
    const { k, L } = fake();
    rede(k, { gid: gid(1), zustand: 'denkt' });
    rede(k, { gid: gid(1), zustand: 'satz', nr: 0, text: 'Satz null, Captain.' }); rede(k, { gid: gid(1), zustand: 'satz', nr: 1, text: 'Satz eins, Captain.' }); rede(k, { gid: gid(1), zustand: 'satz', nr: 2, text: 'Satz zwei, Captain.' });
    rede(k, { gid: gid(1), zustand: 'ton', nr: 1, audio: URL_A('1') });
    ok(L.spiele.length === 0, 'Ton 1 vor Ton 0 angekommen: wartet');
    rede(k, { gid: gid(1), zustand: 'ton', nr: 2, audio: URL_A('2') });
    ok(L.spiele.length === 0, 'Ton 2 ebenfalls');
    rede(k, { gid: gid(1), zustand: 'ton', nr: 0, audio: URL_A('0') });
    ok(L.spiele.length === 1 && eq(L.spiele[0].urls, [URL_A('0')]), 'Ton 0 da: spielt zuerst');
    L.spiele[0].cb.start(); ok(eq(L.halt.at(-1), [L.untertitel.find((u) => u.t === 'Satz null, Captain.').id, true]), 'Untertitel des Satzes bleibt, solange sein Ton laeuft');
    await tick(); ok(L.spiele.length === 1, 'solange Ton 0 laeuft, kein zweiter');
    L.spiele[0].cb.ende(); ok(L.spiele.length === 2 && eq(L.spiele[1].urls, [URL_A('1')]), 'Ende von Ton 0: Ton 1 folgt');
    L.spiele[1].cb.ende(); ok(L.spiele.length === 3 && eq(L.spiele[2].urls, [URL_A('2')]), 'danach Ton 2');
    L.spiele[2].cb.ende(); rede(k, { gid: gid(1), zustand: 'ende' });
    ok(L.spiele.length === 3, 'Reihenfolge 0, 1, 2 trotz vertauschter Ankunft');
  }
  {
    // kein Ton bei gehaltener Taste (Befehlstaste und Gespraechstaste)
    for (const taste of ['befehl', 'gespraech']) {
      const { k, L } = fake();
      rede(k, { gid: gid(1), zustand: 'denkt' }); rede(k, { gid: gid(1), zustand: 'satz', nr: 0, text: 'Satz null, Captain.' });
      if (taste === 'befehl') k.tasteRunter(); else k.gespraechSprechenRunter();
      await tick();
      rede(k, { gid: gid(1), zustand: 'ton', nr: 0, audio: URL_A('0') });
      ok(L.spiele.length === 0 && L.untertitel.some((u) => u.t === 'Satz null, Captain.'), 'gehaltene ' + taste + '-Sprechtaste: kein Ton, Untertitel bleibt');
      ok(L.stumm[0] === true && L.stopp >= 1, 'Aufnahme stellt stumm und stoppt laufenden Ton');
      await k.tasteHoch(); await tick();
      const toene = () => L.spiele.filter((e) => /bot-rede/.test(e.urls[0])).length;   // (die Befehlstaste spielt dabei ihren Rueckfrage-Clip)
      ok(toene() === 0, 'nach dem Loslassen wird der verpasste Ton nicht nachgeholt');
      rede(k, { gid: gid(1), zustand: 'satz', nr: 1, text: 'Satz eins, Captain.' }); rede(k, { gid: gid(1), zustand: 'ton', nr: 1, audio: URL_A('1') });
      ok(toene() === 1, 'danach spielt der naechste Ton wieder');
    }
    // Ton laeuft, Taste wird gedrueckt: Rest der Bahn entfaellt
    const { k, L } = fake();
    rede(k, { gid: gid(1), zustand: 'denkt' }); rede(k, { gid: gid(1), zustand: 'ton', nr: 0, audio: URL_A('0') }); rede(k, { gid: gid(1), zustand: 'ton', nr: 1, audio: URL_A('1') });
    ok(L.spiele.length === 1, 'Ton 0 laeuft');
    k.gespraechSprechenRunter(); await tick();
    L.spiele[0].cb.ende();
    ok(L.spiele.length === 1, 'Taste gedrueckt waehrend Ton 0: Ton 1 wird nicht gestartet');
    await k.tasteHoch();
  }
  {
    // ersetzt / neuer gid stoppt die alte Wiedergabe
    const { k, L } = fake();
    rede(k, { gid: gid(1), zustand: 'denkt' }); rede(k, { gid: gid(1), zustand: 'ton', nr: 0, audio: URL_A('0') }); rede(k, { gid: gid(1), zustand: 'ton', nr: 1, audio: URL_A('1') });
    L.spiele[0].cb.start();
    const stopp0 = L.stopp;
    rede(k, { gid: gid(1), zustand: 'abgelehnt', grund: 'ersetzt' });
    ok(L.stopp === stopp0 + 1, 'ersetzt: die laufende Wiedergabe wird gestoppt');
    L.spiele[0].cb.ende();
    ok(L.spiele.length === 1, 'der Rest der ersetzten Anfrage wird nicht mehr gespielt');
    rede(k, { gid: gid(2), zustand: 'denkt' }); rede(k, { gid: gid(2), zustand: 'ton', nr: 0, audio: URL_A('2') });
    ok(L.spiele.length === 2 && eq(L.spiele[1].urls, [URL_A('2')]), 'die neue Anfrage spielt');
    // neuer gid ohne vorheriges ersetzt (nach ende der alten, Ton laeuft noch)
    const stopp1 = L.stopp;
    rede(k, { gid: gid(2), zustand: 'ende' });
    rede(k, { botId: 'b1', gid: gid(3), zustand: 'denkt' });
    ok(L.stopp === stopp1 + 1, 'neuer gid vom selben Bot: alte Wiedergabe gestoppt, auch nach ende');
    L.spiele[1].cb.ende();
    rede(k, { botId: 'b1', gid: gid(3), zustand: 'ton', nr: 0, audio: URL_A('3') });
    ok(L.spiele.length === 3, 'danach spielt der neue Ton');
  }
  {
    // fehlende / ungueltige audio, Ladefehler
    const { k, L } = fake({ spieleErgebnis: (urls, i) => (i === 1 ? null : urls[0]) });
    rede(k, { gid: gid(1), zustand: 'denkt' });
    rede(k, { gid: gid(1), zustand: 'satz', nr: 0, text: 'Satz null, Captain.' });
    rede(k, { gid: gid(1), zustand: 'ton', nr: 0 });
    rede(k, { gid: gid(1), zustand: 'ton', nr: 1, audio: 'https://boese.example/a.wav' });
    rede(k, { gid: gid(1), zustand: 'ton', nr: 2, audio: '/api/bot-rede/../../x.wav' });
    ok(L.spiele.length === 0 && L.untertitel.some((u) => u.t === 'Satz null, Captain.'), 'ton ohne audio / fremde oder ungueltige URL: nur Untertitel, nichts abgespielt');
    rede(k, { gid: gid(1), zustand: 'ton', nr: 3, audio: URL_A('3') });
    ok(L.spiele.length === 1, 'danach spielt ein gueltiger Ton (Bahn nicht blockiert)');
    await tick(); await tick();
    ok(L.spiele.length === 1, 'Ladefehler (spiele liefert null) ohne weiteren Ton: nichts bricht');
    rede(k, { gid: gid(1), zustand: 'ton', nr: 4, audio: URL_A('4') });
    ok(L.spiele.length === 2, 'Bahn laeuft nach dem Ladefehler weiter');
    const w = fake({ spieleErgebnis: () => { throw new Error('kaputt'); } });
    rede(w.k, { gid: gid(1), zustand: 'denkt' });
    let wirft = false; try { rede(w.k, { gid: gid(1), zustand: 'ton', nr: 0, audio: URL_A('0') }); rede(w.k, { gid: gid(1), zustand: 'ende' }); } catch (e) { wirft = true; }
    ok(!wirft, 'Ausnahme im Audio-Adapter bricht nichts ab');
    // Sprache aus: Wiedergabe gestoppt
    const x = fake();
    rede(x.k, { gid: gid(1), zustand: 'denkt' }); rede(x.k, { gid: gid(1), zustand: 'ton', nr: 0, audio: URL_A('0') });
    const st = x.L.stopp; x.k.schalte(false);
    ok(x.L.stopp > st, 'Sprache aus: laufender Gespraechston wird gestoppt');
  }

  // ------------------------------------------------------------------------------------------ 5b Sprachweg
  section('5b Gespraechs-Sprechtaste');
  {
    const { k, L } = fake({ text: 'Titus, wie ist der Zustand?' });
    ok((await sprechenGespraech(k)) === true, 'aufnehmen, STT, senden');
    ok(L.stt === 1 && L.mik === 1 && eq(letzte(L), { t: 'bot.gespraech', an: 'b2', text: 'Titus, wie ist der Zustand?', quelle: 'sprache' }), 'STT-Ergebnis geht als bot.gespraech mit quelle sprache an die genannte Figur');
    ok(L.stumm[0] === true && L.stumm.at(-1) === false, 'Echo-Schutz wie bei ^: waehrend der Aufnahme stumm');
    ok(L.untertitel.at(-1).info.sprecher === 'DU' && L.untertitel.at(-1).t === 'Titus, wie ist der Zustand?', 'die erkannte Zeile steht als "DU:" da');
    const e = fake({ text: '   ' });
    ok((await sprechenGespraech(e.k)) === false && e.L.send.length === 0 && e.L.meldung.at(-1) === BS.TEXT.nichtsVerstanden, 'leeres STT-Ergebnis: nichts gesendet, kurzer Hinweis');
    const v = fake();
    v.env.mikrofon.start = () => { v.L.mik++; return Promise.resolve({ stop: async () => ({ blob: { size: 5000 }, mime: 'audio/webm', dauerMs: 800, pegel: 0.001 }), abbruch() {} }); };
    const k3 = BS.erzeuge(v.env); k3.schalte(true);
    ok((await sprechenGespraech(k3)) === false && v.L.stt === 0 && v.L.meldung.at(-1) === BS.TEXT.stille, 'Stille-Schranke wie bei ^: kein STT, Meldung');
    const kurz = fake(); kurz.env.mikrofon.start = () => Promise.resolve({ stop: async () => ({ blob: { size: 5000 }, dauerMs: 100 }), abbruch() {} });
    const k4 = BS.erzeuge(kurz.env); k4.schalte(true);
    ok((await sprechenGespraech(k4)) === false && kurz.L.meldung.at(-1) === BS.TEXT.zuKurz && kurz.L.send.length === 0, 'zu kurze Aufnahme: Meldung, nichts gesendet');
    const f = fake({ text: 'Hallo' }); f.env.stt = () => Promise.reject(Object.assign(new Error('503'), { status: 503 }));
    const k5 = BS.erzeuge(f.env); k5.schalte(true);
    ok((await sprechenGespraech(k5)) === false && f.L.send.length === 0 && f.L.meldung.at(-1) === BS.TEXT.sttAus, 'STT-Ausfall: Meldung, nichts gesendet');
    // zweite Taste waehrend einer Aufnahme
    const d = fake();
    d.k.tasteRunter(); ok(d.k.gespraechSprechenRunter() === false, 'laeuft schon eine Aufnahme (^), startet die Gespraechstaste keine zweite');
    await d.k.tasteHoch();
  }

  // ------------------------------------------------------------------------------------------ 6 bot.status mit Stimme
  section('6 bot.status mit Stimme');
  {
    const antwortStatus = (botId, text) => ({ t: 'bot.antwort', botId, befehl: 'bot.status', status: 'ok', textId: 'bot.status.ok', variante: 0, text });
    const { k, L } = fake({ spieleErgebnis: (urls) => urls[0] });
    k.empfange(antwortStatus('b0', 'Kurs 270, Captain.'));
    ok(L.spiele.length === 1 && /stimmen\/b0\/bot\.status\.ok/.test(L.spiele[0].urls[0]) && L.untertitel.length === 1 && L.untertitel[0].t === 'Kurs 270, Captain.', 'bot.antwort fuer bot.status: Untertitel und Bestaetigungs-Clip wie bisher');
    rede(k, { botId: 'b0', gid: 's1', zustand: 'ton', nr: 0, audio: URL_A('a'), zu: 'bot.status' });
    rede(k, { botId: 'b0', gid: 's1', zustand: 'ende', zu: 'bot.status' });
    ok(L.spiele.length === 1, 'der Statuston wartet, bis der Bestaetigungs-Clip zu Ende ist');
    ok(L.untertitel.length === 1 && L.meldung.length === 0, 'kein zweiter Untertitel zum Statuston');
    L.spiele[0].cb.start(); L.spiele[0].cb.ende();
    ok(L.spiele.length === 2 && eq(L.spiele[1].urls, [URL_A('a')]), 'nach dem Clip spielt der Statuston');
    L.spiele[1].cb.ende();
    ok(L.spiele.length === 2 && L.untertitel.length === 1, 'danach ist Ruhe');
    // mehrere Bots: Clips laufen, Statustoene danach nacheinander
    const m = fake({ spieleErgebnis: (urls) => urls[0] });
    m.k.empfange(antwortStatus('b0', 'Livia meldet sich.')); m.k.empfange(antwortStatus('b1', 'Cassius meldet sich.')); m.k.empfange(antwortStatus('b2', 'Titus meldet sich.'));
    ok(m.L.spiele.length === 3 && m.L.untertitel.length === 3, 'drei Antworten: drei Untertitel, drei Clips');
    for (const [i, b] of ['b0', 'b1', 'b2'].entries()) rede(m.k, { botId: b, gid: 's' + (i + 1), zustand: 'ton', nr: 0, audio: URL_A(i + 1), zu: 'bot.status' });
    ok(m.L.spiele.length === 3, 'Statustoene warten auf alle Bestaetigungs-Clips');
    for (const e of m.L.spiele.slice(0, 3)) e.cb.ende();
    ok(m.L.spiele.length === 4 && eq(m.L.spiele[3].urls, [URL_A(1)]), 'danach der erste Statuston');
    m.L.spiele[3].cb.ende(); ok(m.L.spiele.length === 5 && eq(m.L.spiele[4].urls, [URL_A(2)]), 'dann der zweite (nacheinander)');
    m.L.spiele[4].cb.ende(); ok(m.L.spiele.length === 6 && eq(m.L.spiele[5].urls, [URL_A(3)]), 'dann der dritte');
    // kein Clip im Vorrat (spiele liefert null): Ton sofort
    const o = fake({ spieleErgebnis: (urls, i) => (i === 1 ? null : urls[0]) });
    o.k.empfange(antwortStatus('b1', 'Alles ruhig.'));
    await tick(); await tick();
    rede(o.k, { botId: 'b1', gid: 's9', zustand: 'ton', nr: 0, audio: URL_A('9'), zu: 'bot.status' });
    ok(o.L.spiele.length === 2 && eq(o.L.spiele[1].urls, [URL_A('9')]), 'fehlt der Bestaetigungs-Clip, spielt der Statuston gleich');
    // Statuston kommt vor dem Clip-Ende, Clip bleibt haengen: Sicherung
    const h = fake({ spieleErgebnis: (urls) => urls[0] });
    let timer = null; const e2 = Object.assign({}, h.env, { setTimeout: (f) => { timer = f; return 1; }, clearTimeout() {} });
    const k2 = BS.erzeuge(e2); k2.schalte(true);
    k2.empfange(antwortStatus('b0', 'Text.'));
    rede(k2, { botId: 'b0', gid: 's1', zustand: 'ton', nr: 0, audio: URL_A('1'), zu: 'bot.status' });
    ok(h.L.spiele.length === 1, 'Vorbedingung: Statuston wartet');
    timer(); ok(h.L.spiele.length === 2, 'Sicherung: bleibt das Clip-Ende aus, spielt der Statuston nach der Wartegrenze');
    // Statuston ohne Untertitel auch ohne Clip, Statuston bei gehaltener Taste: still
    const g = fake({ spieleErgebnis: (urls) => urls[0] });
    g.k.tasteRunter(); await tick();
    rede(g.k, { botId: 'b0', gid: 's1', zustand: 'ton', nr: 0, audio: URL_A('1'), zu: 'bot.status' });
    ok(g.L.spiele.length === 0 && g.L.untertitel.length === 0, 'Statuston bei gehaltener Sprechtaste: still');
    await g.k.tasteHoch();
    // andere Befehle: keine Wartezeit
    const a = fake({ spieleErgebnis: (urls) => urls[0] });
    a.k.empfange({ t: 'bot.antwort', botId: 'b0', befehl: 'ops.scan', status: 'ok', textId: 'ops.scan.ok', variante: 0, text: 'Scan.' });
    rede(a.k, { botId: 'b0', gid: 'sx', zustand: 'ton', nr: 0, audio: URL_A('7'), zu: 'bot.status' });
    ok(a.L.spiele.length === 2, 'nur bot.status haelt den Statuston zurueck (ein anderer Clip laeuft nicht dagegen an)');
  }

  console.log(`\n${n - fails}/${n} Pruefungen ok` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
