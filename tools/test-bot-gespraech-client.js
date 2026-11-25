'use strict';
// BOT-05 B2: Gespraech im Client (public/js/bot-sprache.js, Kern und Browser-Anschluss) ohne Browser, Mikrofon und Netz (Fake-Umgebung, echter Matcher).
//  1 Tasten: eigene Gespraechstasten (Standard, Umbelegung, keine Konflikte), im Browser-Anschluss ohne Bots wirkungslos und ohne Schlucken
//  2 Adressat: Name vorn (auch unscharf), letzter Gespraechspartner, zuletzt per Befehl angesprochener Bot, erster Bot, Figur nicht an Bord
//  3 Kein Befehl: Text und Sprache ueber die Gespraechswege senden NUR bot.gespraech (auch bei Befehlswortlaut), der Befehlsmatcher laeuft nicht
//  4 Anzeige: denkt nach -> Saetze -> Ende, nicht erreichbar, abgelehnt (rate, kein_bot), ersetzt, veraltete Nachrichten
//  5 Ton: je gid in nr-Reihenfolge, nicht bei gehaltener Taste, ersetzt stoppt, fehlende/ungueltige audio, Ausfall
//  6 bot.status mit Stimme: nach dem Bestaetigungs-Clip, kein zweiter Untertitel, mehrere Bots nacheinander
//  7 BOT-05 B-Nacharbeit: a W1 geteilte Textzeile, b K3 Kreuz-Loslassen, c W2 Untertitel mit dem Ton (echtes hud.js, Fake-Zeit), d W3 Status-Runden, e Farben (Designer), f Startnotiz
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
  const L = { mik: 0, stt: 0, matchAufrufe: 0, send: [], untertitel: [], weg: [], meldung: [], clips: [], spiele: [], stopp: 0, stumm: [], halt: [], frei: [] };
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
      frei: (id, ausfall) => { L.frei.push([id, ausfall]); },   // BOT-05 B-Nacharbeit W2: der wartende Untertitel wird frei (ausfall: kein Ton kam)
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
    ok(e.L.untertitel.at(-1).t === 'Titus ist nicht erreichbar.' && !e.L.untertitel.at(-1).info.botId && e.L.weg.length === 1 && e.L.meldung.length === 0, 'nicht_erreichbar: Untertitel "Titus ist nicht erreichbar." (Sprecher BORD), denkt weg');
    for (const grund of ['zeit', 'leer']) { rede(e.k, { botId: 'b2', gid: gid(4), zustand: 'denkt' }); rede(e.k, { botId: 'b2', gid: gid(4), zustand: 'nicht_erreichbar', grund }); }
    ok(e.L.untertitel.filter((u) => u.t === 'Titus ist nicht erreichbar.').length === 3, 'auch bei Zeitlimit und leerer Antwort');
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

  // ------------------------------------------------------------------------------------------ 7 BOT-05 B-Nacharbeit
  section('7a W1: geteilte Textzeile (Gespraechstext geht nie als Befehl hinaus), Art der Zeile sichtbar');
  const PLAYER_COLORS = ['#56B4E9', '#E69F00', '#CC79A7', '#7FE0C2'];
  const FNT = { drive: '#FFC66B', sensor: '#A9D6E5', cmd: '#F4EEDC', warn: '#F2C94C', neutral: '#8EA3B5' };
  const mkDom = () => {
    const mk = (tag) => { const e = { tag, style: {}, children: [], listeners: {}, textContent: '', attrs: {}, value: '', appendChild(c) { this.children.push(c); }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute(k, v) { this.attrs[k] = v; }, focus() { doc.activeElement = this; }, blur() { doc.activeElement = null; }, remove() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) }; return e; };
    const canvas = mk('canvas');
    const doc = { createElement: mk, body: mk('body'), head: mk('head'), activeElement: null, getElementById: (id) => (id === 'game' ? canvas : null) };
    return doc;
  };
  const tastenWelt = () => { const tw = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tasten.js'), 'utf8'), { window: tw, console }); return tw.Tasten; };
  const inhalt = (u) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', u.replace(/^\//, '')), 'utf8'));
  const SPIELER = [{ id: 'p1', name: 'Kai', color: 0 }, { id: 'p2', name: 'Livia', bot: 1, botId: 'b0', rolle: 'navigation', color: 1 }, { id: 'p3', name: 'Cassius', bot: 1, botId: 'b1', rolle: 'ops', color: 2 }, { id: 'p4', name: 'Titus', bot: 1, botId: 'b2', rolle: 'technik', color: 3 }];
  // Fenster mit Fake-Hud (o.hud) oder dem echten (o.hud = echtes Hud-Objekt); Net.on faengt den Zuhoerer; o.mikrofon: Fake-MediaRecorder
  const fenster = async (o) => {
    o = o || {};
    const doc = mkDom(), T = tastenWelt(), gesendet = [], hand = {}; let netFn = null;
    const hud = o.hud || { sprech: { aktiv: false, bots: false, aufnahme: false, verarbeitet: false, zeile: null }, notices: [], titel: [],
      sprechAn(b) { hud.sprech.aktiv = !!b; }, sprechBereit: () => true, pushNotice(t) { hud.notices.push(t); }, pushCrewFunk(t, wer, farbe, dauer, opt) { hud.titel.push({ t, wer, farbe, dauer, opt }); return hud.titel.length; }, crewFunkHalte() {}, crewFunkWeg() {}, crewFunkFrei() {} };
    const win = {
      location: { search: '' }, document: doc, Hud: hud, Tasten: T, Shared_BotMatcher: Matcher, Menue: { TOKENS: { FN: FNT, FARBE: {} }, spieler: (i) => ({ farbe: PLAYER_COLORS[i] }) },
      Client: { scale: 1, pid: 'p1', state: { phase: 'play', players: o.spieler || SPIELER }, eingabeFrei: () => true, tastenFreigeben() {} },
      Net: { isOpen: () => true, send: (m) => { gesendet.push(m); return true; }, on: (fn) => { netFn = fn; return () => {}; } },
      fetch: (u) => Promise.resolve({ ok: true, json: async () => inhalt(u) }),
      addEventListener(t, f) { (hand[t] = hand[t] || []).push(f); }, removeEventListener() {},
    };
    if (o.audio) win.Audio = o.audio;
    if (o.mikrofon) { win.navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } }; win.MediaRecorder = class { constructor() { this.mimeType = 'audio/webm'; } start() {} stop() { if (this.onstop) this.onstop(); } static isTypeSupported() { return true; } }; win.Blob = class { constructor(p) { this.size = 5000; } }; }
    const k = await BS.starte(win);
    const taste = (code, art) => { let vorbei = 0; const e = { code, shiftKey: false, repeat: false, preventDefault: () => { vorbei++; } }; for (const f of hand[art || 'keydown'] || []) f(e); return vorbei; };
    const absenden = () => { const form = doc.body.children.at(-1).children[0]; form.listeners.submit[0]({ preventDefault() {} }); };
    return { win, doc, hud, k, gesendet, taste, absenden, rein: (m) => netFn(m), zeile: () => hud.sprech.zeile, stop: () => BS.stoppe() };
  };
  {
    const r = await fenster();
    const z = r.zeile();
    // Ablauf des Reviews: Ö, Text, Klick ins Bild (die Zeile bleibt offen), dann #, Enter
    r.taste('Semicolon');
    ok(z.offen && z.kopf === 'GESPRÄCH' && z.kopfArt === 'gespraech', 'Ö: offene Zeile traegt den Kopf GESPRAECH');
    z.feld.value = 'Schilde Steuerbord'; z.feld.blur();
    ok(z.offen && z.feld.value === 'Schilde Steuerbord', 'Fokusverlust mit Text: die Zeile bleibt offen (wie bisher)');
    r.taste('Backslash');
    ok(z.offen && z.kopf === 'BEFEHL' && z.kopfArt === 'befehl' && z.platzhalter === BS.TEXT.platzhalter, '#: die Zeile wechselt zu BEFEHL (Kopf und Platzhalter)');
    ok(z.feld.value === '', 'der Gespraechstext ist beim Wechsel der Art geleert (W1)');
    r.absenden(); await tick(); await tick();
    ok(r.gesendet.length === 0, 'Enter nach dem Wechsel sendet nichts (vorher: bot.befehl tech.schild): ' + JSON.stringify(r.gesendet));
    // umgekehrt: Befehlstext, dann Ö
    r.taste('Backslash'); z.feld.value = 'Schilde Steuerbord'; z.feld.blur();
    r.taste('Semicolon');
    ok(z.kopf === 'GESPRÄCH' && z.feld.value === '' && z.offen, 'umgekehrt (# dann Ö): Befehlstext geleert, Kopf GESPRAECH');
    z.feld.value = 'Wie geht es dir?'; r.absenden(); await tick(); await tick(); await tick();
    ok(r.gesendet.length === 1 && r.gesendet[0].t === 'bot.gespraech' && r.gesendet[0].text === 'Wie geht es dir?', 'neu getippter Gespraechstext geht als bot.gespraech hinaus');
    // gleiche Art erneut gedrueckt: Text bleibt
    r.taste('Semicolon'); z.feld.value = 'halber Satz'; z.feld.blur(); r.taste('Semicolon');
    ok(z.offen && z.feld.value === 'halber Satz' && z.kopf === 'GESPRÄCH', 'dieselbe Taste noch einmal: der Text bleibt (kein Wechsel der Art)');
    z.schliessen();
    ok(r.gesendet.every((m) => m.t !== 'bot.befehl'), 'in diesem ganzen Ablauf geht kein Gespraechstext als bot.befehl hinaus');
    r.stop();
  }

  section('7b K3: Kreuz-Loslassen beendet nur die Aufnahme der eigenen Art');
  {
    const { k, L } = fake({ text: 'Titus, wie ist der Zustand?' });
    k.tasteRunter(); await tick();
    ok(k.gespraechSprechenRunter() === false, 'Vorbedingung: Befehlsaufnahme laeuft, die Gespraechstaste startet keine zweite');
    ok((await k.tasteHoch('gespraech')) === false && L.stt === 0, 'Loslassen der Gespraechstaste beendet die Befehlsaufnahme NICHT');
    const ok2 = await k.tasteHoch('befehl');
    ok(L.stt === 1 && ok2 !== undefined, 'Loslassen der eigenen Taste beendet sie (STT laeuft)');
    const g = fake({ text: 'Titus, wie ist der Zustand?' });
    g.k.gespraechSprechenRunter(); await tick();
    ok((await g.k.tasteHoch('befehl')) === false && g.L.stt === 0, 'umgekehrt: Loslassen der Befehlstaste beendet die Gespraechsaufnahme nicht');
    ok((await g.k.gespraechSprechenHoch()) === true && g.L.stt === 1 && g.L.send.at(-1).t === 'bot.gespraech', 'die Gespraechstaste beendet sie und sendet bot.gespraech');
    const e = fake({ text: 'Hallo' });
    e.k.tasteRunter(); await tick(); await e.k.tasteHoch(); ok(e.L.stt === 1, 'ohne Art (Auto-Stop nach 60 s) endet die laufende Aufnahme wie bisher');
    // im Browser-Anschluss: der keyup-Zuhoerer reicht die Art weiter
    const r = await fenster({ mikrofon: true });
    r.taste('Backquote'); await tick(); await tick(); await tick();
    ok(r.hud.sprech.aufnahme === true, 'Browser: ^ gedrueckt, Aufnahme laeuft');
    r.taste('Quote'); r.taste('Quote', 'keyup'); await tick(); await tick();
    ok(r.hud.sprech.aufnahme === true, 'Browser: Ä gedrueckt und losgelassen waehrend ^ gehalten wird: die Aufnahme laeuft weiter');
    r.taste('Backquote', 'keyup'); await tick(); await tick();
    ok(r.hud.sprech.aufnahme === false, 'Browser: ^ losgelassen beendet die Aufnahme');
    r.stop();
  }

  section('7c W2: Untertitel laufen mit dem Ton mit (echtes hud.js, Fake-Zeit, Fake-Audio)');
  const hudWelt = (zeit) => {
    const calls = [];
    const R = {
      PAL: new Proxy({}, { get: (t, k) => '#' + String(k) }),
      measure: (t) => String(t == null ? '' : t).length * 6,
      wrap(str, maxW) { const out = []; let line = ''; for (const w of String(str).split(' ')) { const test = line ? line + ' ' + w : w; if (test.length * 6 > maxW && line) { out.push(line); line = w; } else line = test; } if (line) out.push(line); return out; },
      backdrop: (c, x, y, w, h, a) => calls.push({ n: 'backdrop', x, y, w, h, a }),
      art: () => true,
      text: (c, s, x, y, o) => calls.push({ n: 'text', s, x, y, o }),
    };
    const ctx = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect(x, y, w, h) { calls.push({ n: 'fillRect', x, y, w, h, c: this.fillStyle }); }, strokeRect() {} };
    const w = { Render: R, Shared_Maps: {}, Shared_Config: {}, Shared_Protocol: {}, Net: { guard: (nm, f) => f(), on() {} }, performance: { now: () => zeit.ms }, Menue: { TOKENS: { FN: FNT } } };
    w.window = w; vm.createContext(w);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hud.js'), 'utf8'), w, { filename: 'hud.js' });
    const ansicht = { time: 1, self: { zone: 'ship' }, me: {}, state: { phase: 'play' } };
    return { Hud: w.Hud, calls, ctx, texte: () => { calls.length = 0; w.Hud.zeichneSprechspalte(ctx, ansicht); return calls.filter((c) => c.n === 'text').map((c) => c.s); } };
  };
  const FakeAudio = () => {
    const reg = [];
    class A { constructor() { this.l = {}; this.pre = ''; reg.push(this); }
      addEventListener(t, f, o) { (this.l[t] = this.l[t] || []).push({ f, once: !!(o && o.once) }); }
      emit(t) { for (const x of (this.l[t] || []).slice()) { if (x.once) this.l[t] = this.l[t].filter((y) => y !== x); x.f(); } }
      set preload(v) { this.pre = v; }
      set src(v) { this.url = v; Promise.resolve().then(() => this.emit('canplay')); }
      play() { return Promise.resolve(); }
      pause() { this.emit('pause'); } }
    return { Klasse: A, reg };
  };
  const SATZ = ['Kurs 270 Grad, Captain.', 'Schilde bei 100 Prozent.', 'Alles ruhig an Bord.'];
  {
    const zeit = { ms: 1000 }, T = (s) => { zeit.ms = 1000 + Math.round(s * 1000); };
    const W = hudWelt(zeit), fa = FakeAudio();
    W.Hud.sprech.bots = true;
    const r = await fenster({ hud: W.Hud, audio: fa.Klasse });
    T(0);
    await r.k.sendeGespraechText('Cassius, wie ist die Lage?');
    ok(W.texte().includes('Cassius, wie ist die Lage?'), 'die eigene Zeile steht als DU da');
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'denkt' });
    ok(W.texte().includes('denkt nach …'), 'denkt nach … steht');
    // K2 (Client): denkt nach bleibt, solange die Anfrage wartet oder laeuft: weit ueber 35 s (Warte- plus Laufzeitlimit des Servers 20 + 30 s)
    T(40); ok(W.texte().includes('denkt nach …'), 'K2: denkt nach steht nach 40 s noch (nicht mehr fest 35 s)');
    T(2.0);
    SATZ.forEach((t, i) => r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'satz', nr: i, text: t }));
    ok(!W.texte().includes('denkt nach …') && SATZ.every((t) => W.texte().includes(t)), 'die drei Saetze stehen, denkt nach ist weg');
    // Toene: je 3,5 s ab 2,6 s
    T(2.6);
    SATZ.forEach((t, i) => r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'ton', nr: i, audio: '/api/bot-rede/' + String(i + 1).repeat(32) + '.wav' }));
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'ende' });
    await tick(); await tick(); await tick();
    ok(fa.reg.length === 1, 'Ton 0 spielt (' + fa.reg.length + ' Audio-Element)');
    const sichtbar = () => SATZ.map((t) => (W.texte().includes(t) ? 1 : 0)).join('');
    T(5.0); ok(sichtbar() === '111', 'Ton 0 laeuft (2,6 bis 6,1 s): alle drei Saetze stehen, auch 2 und 3 obwohl ihr Ton noch nicht laeuft (' + sichtbar() + ')');
    T(6.1); fa.reg[0].emit('ended'); await tick(); await tick();
    ok(fa.reg.length === 2, 'Ton 1 startet nach dem Ende von Ton 0');
    T(6.4); ok(sichtbar() === '111', '0,3 s nach Ton 0: Satz 0 steht noch (Nachlauf 0,5 s)');
    T(6.7); ok(sichtbar() === '011', '0,6 s nach Ton 0: Satz 0 ist weg, Satz 1 (spielt) und Satz 2 (wartet) stehen (' + sichtbar() + ')');
    T(9.0); ok(sichtbar() === '011', 'Ton 1 laeuft (6,1 bis 9,6 s): Satz 1 steht (nach 4 s Grunddauer waere er weg), Satz 2 auch (' + sichtbar() + ')');
    T(9.6); fa.reg[1].emit('ended'); await tick(); await tick();
    ok(fa.reg.length === 3, 'Ton 2 startet');
    T(10.3); ok(sichtbar() === '001', 'Satz 1 nach seinem Ton (0,7 s) weg, Satz 2 steht (' + sichtbar() + ')');
    T(12.9); ok(sichtbar() === '001', 'Ton 2 laeuft (9,6 bis 13,1 s): Satz 2 steht');
    T(13.1); fa.reg[2].emit('ended'); await tick(); await tick();
    T(13.4); ok(sichtbar() === '001', '0,3 s nach Ton 2: Satz 2 steht noch');
    T(13.7); ok(sichtbar() === '000', '0,6 s nach Ton 2: alles weg (' + sichtbar() + ')');
    // Farben (Designer): Name und Balken in Spielerfarbe, DU eigene Farbe, Satztext cmd
    const E = W.Hud.sprech.eintraege;
    ok(E.length === 0, 'Spalte leer nach dem Ablauf');
    r.stop();
  }
  {
    // kein Ton (kein audio): die normale Dauer gilt ab dem Ausfall, nicht ab dem Eintreffen des Satzes
    const zeit = { ms: 1000 }, T = (s) => { zeit.ms = 1000 + Math.round(s * 1000); };
    const W = hudWelt(zeit), fa = FakeAudio();
    W.Hud.sprech.bots = true;
    const r = await fenster({ hud: W.Hud, audio: fa.Klasse });
    T(0);
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'denkt' });
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'satz', nr: 0, text: SATZ[0] });
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'satz', nr: 1, text: SATZ[1] });
    const d = W.Hud.crewFunkDauer(SATZ[0]), d1 = W.Hud.crewFunkDauer(SATZ[1]);
    T(20);   // lange nach dem Eintreffen: die Sicherung haelt noch, der Ton ist nicht ausgefallen (Server noch bei der Sprachausgabe)
    ok(W.texte().includes(SATZ[0]) && W.texte().includes(SATZ[1]), 'Ton noch ausstehend: die Saetze stehen weiter (20 s)');
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'ton', nr: 0 });   // Voicebox ausgefallen: ton ohne audio
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'ton', nr: 1 });
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'ende' });
    await tick();
    T(20 + d - 0.3); ok(W.texte().includes(SATZ[0]), 'ton ohne audio: Satz 0 steht noch die normale Dauer ab dem Ausfall (' + d.toFixed(2) + ' s)');
    T(20 + d + 0.2); ok(!W.texte().includes(SATZ[0]), 'danach ist er weg');
    T(20 + d1 + 0.2); ok(!W.texte().includes(SATZ[1]), 'Satz 1 ebenso');
    ok(fa.reg.length === 0, 'kein Ton gespielt');
    r.stop();
  }

  {
    // der Ausfall wirkt sofort, auch wenn der Strom noch offen ist (kein ende): ton ohne audio gibt nur diesen Satz frei
    const { k, L } = fake();
    rede(k, { gid: gid(1), zustand: 'denkt' });
    rede(k, { gid: gid(1), zustand: 'satz', nr: 0, text: 'Satz null, Captain.' }); rede(k, { gid: gid(1), zustand: 'satz', nr: 1, text: 'Satz eins, Captain.' });
    ok(L.untertitel.filter((u) => u.info.halten === true).length === 2 && L.frei.length === 0, 'Saetze warten auf ihren Ton (halten), noch nichts frei');
    rede(k, { gid: gid(1), zustand: 'ton', nr: 0 });
    ok(eq(L.frei, [[L.untertitel.find((u) => u.t === 'Satz null, Captain.').id, true]]), 'ton ohne audio (Strom noch offen): genau dieser Satz wird sofort mit Ausfall frei');
    // Ende des Stroms: ein Satz, zu dem nie ein Ton kam, wird dabei frei (Ausfall)
    rede(k, { gid: gid(1), zustand: 'ton', nr: 2, audio: URL_A('2') });   // Ton 2 kommt, Ton 1 nie
    rede(k, { gid: gid(1), zustand: 'ende' });
    const n1 = L.frei.length;
    L.spiele[0].cb.start(); L.spiele[0].cb.ende();
    ok(L.frei.length > n1 && L.frei.some((f) => f[0] === L.untertitel.find((u) => u.t === 'Satz eins, Captain.').id && f[1] === true), 'Ende des Stroms: der Satz ohne jeden Ton wird mit Ausfall frei (nicht erst nach 60 s)');
  }

  section('7d W3 (Client): Status-Ton, der Antworttext wartet auf den Ton; eine neue Runde verwirft die alte');
  {
    const antw = (botId, text, runde) => Object.assign({ t: 'bot.antwort', botId, befehl: 'bot.status', status: 'ok', textId: 'bot.status.ok', variante: 0, text }, runde ? { tonRunde: runde } : {});
    const stat = (botId, gid, runde, audio) => Object.assign({ botId, gid, zustand: 'ton', nr: 0, zu: 'bot.status', runde }, audio ? { audio } : {});
    // Antworttext haelt bis zum Ton
    {
      const { k, L } = fake({ spieleErgebnis: (urls) => urls[0] });
      k.empfange(antw('b0', 'Kurs 270, Captain.', 'r1'));
      ok(L.untertitel[0].info.halten === true, 'bot.antwort mit tonRunde: der Untertitel wartet auf den Statuston (halten)');
      rede(k, stat('b0', 's1', 'r1', URL_A('a')));
      rede(k, { botId: 'b0', gid: 's1', zustand: 'ende', zu: 'bot.status', runde: 'r1' });
      L.spiele[0].cb.start(); L.spiele[0].cb.ende();   // Bestaetigungs-Clip
      ok(L.frei.length === 0, 'Clip-Ende gibt den Untertitel NICHT frei (der Statuston kommt noch)');
      L.spiele[1].cb.start(); L.spiele[1].cb.ende();   // Statuston
      ok(eq(L.frei, [[1, false]]), 'nach dem Statuston: frei mit Nachlauf (ausfall false)');
    }
    // ohne tonRunde (Server ohne Voicebox): nichts wartet
    {
      const { k, L } = fake({ spieleErgebnis: (urls) => urls[0] });
      k.empfange(antw('b0', 'Kurs 270, Captain.'));
      ok(L.untertitel[0].info.halten === false && L.frei.length === 0, 'ohne tonRunde: der Untertitel wartet auf nichts (halten false)');
    }
    // ton ohne audio: ausgefallen
    {
      const { k, L } = fake({ spieleErgebnis: (urls) => urls[0] });
      k.empfange(antw('b0', 'Kurs 270, Captain.', 'r1'));
      rede(k, stat('b0', 's1', 'r1', null));
      L.spiele[0].cb.start(); L.spiele[0].cb.ende();
      ok(eq(L.frei, [[1, true]]), 'Statuston ohne audio: frei mit Ausfall (normale Dauer ab jetzt)');
    }
    // neue Runde verwirft die alte: Strom und wartende Untertitel
    {
      const { k, L } = fake({ spieleErgebnis: (urls) => urls[0] });
      k.empfange(antw('b0', 'Erste Runde, Bot 0.', 'r1')); k.empfange(antw('b1', 'Erste Runde, Bot 1.', 'r1'));
      rede(k, stat('b0', 's1', 'r1', URL_A('a')));   // Ton von Bot 0 liegt schon da, Bot 1 fehlt noch
      ok(L.spiele.length === 2, 'Vorbedingung: zwei Bestaetigungs-Clips, der Statuston wartet');
      k.empfange(antw('b0', 'Zweite Runde, Bot 0.', 'r2'));
      ok(L.frei.some((f) => f[0] === 1 && f[1] === true) && L.frei.some((f) => f[0] === 2 && f[1] === true), 'neue Runde: die Untertitel der alten (mit und ohne Strom) werden freigegeben (ausfall)');
      rede(k, stat('b0', 's9', 'r2', URL_A('7')));
      for (const e of L.spiele.slice(0, 3)) { e.cb.start(); e.cb.ende(); }
      const toene = L.spiele.filter((e) => /bot-rede/.test(e.urls[0])).map((e) => e.urls[0]);
      ok(eq(toene, [URL_A('7')]), 'abgespielt wird nur der Ton der neuen Runde, nie der der alten (' + toene.length + ' Ton)');
      // Ausfallmeldung des Servers fuer den Rest der Runde
      const m = fake({ spieleErgebnis: (urls) => urls[0] });
      m.k.empfange(antw('b0', 'A.', 'r3')); m.k.empfange(antw('b1', 'B.', 'r3')); m.k.empfange(antw('b2', 'C.', 'r3'));
      rede(m.k, stat('b0', 's1', 'r3', URL_A('1')));
      rede(m.k, { botId: 'b1', gid: 's2', zustand: 'ausfall', zu: 'bot.status', runde: 'r3' });
      ok(m.L.frei.length === 2 && m.L.frei.every((f) => f[1] === true) && eq(m.L.frei.map((f) => f[0]).sort(), [2, 3]), 'ausfall des Servers: die Untertitel der Bots ohne Ton (b1, b2) werden frei, der von b0 wartet auf seinen Ton');
    }
  }

  section('7e Designer: Farben und Untertitel-Anzeige im HUD-Adapter');
  {
    const zeit = { ms: 1000 };
    const W = hudWelt(zeit);
    W.Hud.sprech.bots = true;
    const r = await fenster({ hud: W.Hud, audio: FakeAudio().Klasse });
    await r.k.sendeGespraechText('Cassius, Lage?');
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'denkt' });
    let E = W.Hud.sprech.eintraege;
    const du = E.find((e) => e.who === 'DU'), denkt = E.find((e) => e.text === 'denkt nach …');
    ok(du && du.farbe === PLAYER_COLORS[0], '"DU" in der eigenen Spielerfarbe (' + (du && du.farbe) + ')');
    ok(denkt && denkt.who === 'CASSIUS' && denkt.farbe === PLAYER_COLORS[2] && denkt.textFarbe === FNT.neutral, '"denkt nach …": Name in der Spielerfarbe des Bot-Spielers (Cassius, Farbe 3), Text in FN.neutral');
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'satz', nr: 0, text: 'Kurs 270 Grad, Captain.' });
    E = W.Hud.sprech.eintraege;
    const satz = E.find((e) => e.text === 'Kurs 270 Grad, Captain.');
    ok(satz && satz.farbe === PLAYER_COLORS[2] && !satz.textFarbe, 'Satz: Name und Balken in der Spielerfarbe, Text bleibt FN.cmd (kein textFarbe)');
    r.rein({ t: 'bot.rede', botId: 'b1', gid: 'g1', zustand: 'ende' });
    // BORD: nicht erreichbar -> Sprecher BORD in FN.neutral
    await r.k.sendeGespraechText('Livia, Lage?');
    r.rein({ t: 'bot.rede', botId: 'b0', gid: 'g2', zustand: 'denkt' });
    r.rein({ t: 'bot.rede', botId: 'b0', gid: 'g2', zustand: 'nicht_erreichbar', grund: 'zeit' });
    const bord = W.Hud.sprech.eintraege.find((e) => /nicht erreichbar/.test(e.text));
    ok(bord && bord.who === 'BORD' && bord.farbe === FNT.neutral, 'Meldung "nicht erreichbar": Sprecher BORD in FN.neutral (' + (bord && bord.who + ' ' + bord.farbe) + ')');
    r.stop();
  }

  section('7f Startnotiz im Browser-Anschluss: mit Bots mit Gespraech, ohne Bots nur der Befehl, spaeter nachgereicht');
  {
    const ohne = await fenster({ spieler: [{ id: 'p1', name: 'Kai', color: 0 }] });
    ok(ohne.hud.notices.includes('Befehl ^ halten, # tippen'), 'ohne Bots: "Befehl ^ halten, # tippen" (' + JSON.stringify(ohne.hud.notices) + ')');
    ohne.stop();
    const mit = await fenster();
    ok(mit.hud.notices.includes('Befehl ^ halten, # tippen · Gespräch Ä halten, Ö tippen'), 'mit Bots: Befehl und Gespraech (' + JSON.stringify(mit.hud.notices) + ')');
    mit.stop();
  }

  console.log(`\n${n - fails}/${n} Pruefungen ok` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
