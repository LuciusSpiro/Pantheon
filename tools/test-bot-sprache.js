'use strict';
// BOT-04 C: Client-Kern der Bot-Sprache (public/js/bot-sprache.js) ohne Browser, Mikrofon und Netz (Fake-Umgebung, Fake-Matcher).
//  a) Sprache aus (Standard): kein getUserMedia, kein fetch, kein Zuhoerer, der Lader bindet nichts ein
//  b) Matcher null (unklar): KEIN bot.befehl, Rueckfrage-Clip bot.unklar, fehlt er: Untertitel "Bitte wiederholen"
//  c) Aufnahme nur zwischen Tastendruck und -loslassen (Fokusverlust, zu kurz, zu frueh losgelassen, Echo-Stummschaltung)
//  d) STT faellt aus / Mikrofon fehlt: sichtbare Meldung, Textzeile und Tasten laufen weiter
//  e) Clipwahl, Texteingabe, Messmodus, Tastenbelegung, HUD-Anzeige-Adapter (Fake-DOM, Fake-Hud: Textzeile Enter/Esc/Fokusverlust, Lage, Meldungen)
//  g) BOT-04 C2 Kern-Schnittstelle (verarbeitet, Untertitel-Kennung, Clip-Rueckruf, STT-503), h) Sprechspalte im HUD (sprechSlot, Stapel, Dauer, Zeichnen, Einbindung)
//   node tools/test-bot-sprache.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BS = require('../public/js/bot-sprache.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');
const tick = () => new Promise((r) => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Fake-Umgebung: zaehlt alles, was nach aussen geht
function fake(o) {
  o = o || {};
  const L = { mik: 0, stt: 0, matcher: 0, send: [], untertitel: [], meldung: [], aufnahme: [], clips: [], stumm: [], abbruch: 0, zuhoerer: 0, abgemeldet: 0, ereignisse: [] };
  let zeit = 0;
  const env = {
    uhr: () => (zeit += 10),
    transport: {
      send: (m) => { L.send.push(m); return o.sendOk === false ? false : true; },
      onMessage: (fn) => { L.zuhoerer++; L.fn = fn; return () => { L.abgemeldet++; }; },
    },
    matcher: () => { L.matcher++; return o.matcher === undefined ? { match: (t) => (/schild/i.test(t) ? { an: 'technik', befehl: 'tech.schild', args: { sektor: 'stb' }, konfidenz: 0.97 } : null) } : o.matcher; },
    stt: (blob, mime) => { L.stt++; if (o.sttFehler) return Promise.reject(new Error('503')); return Promise.resolve(o.text === undefined ? 'Schilde Steuerbord' : o.text); },
    mikrofon: {
      start: () => {
        L.mik++;
        if (o.mikFehler) return Promise.reject(new Error('NotAllowedError'));
        const h = { stop: async () => ({ blob: { size: o.leer ? 0 : 5000 }, mime: 'audio/webm;codecs=opus', dauerMs: o.dauer == null ? 800 : o.dauer }), abbruch: () => { L.abbruch++; } };
        return o.mikLangsam ? o.mikLangsam.then(() => h) : Promise.resolve(h);
      },
    },
    audio: {
      spiele: (urls, cb) => { L.ereignisse.push('clip'); L.clips.push(urls); L.cb = cb; return Promise.resolve(o.clipDa ? urls[0] : null); },
      stumm: (b) => { L.stumm.push(b); }, stopp: () => {},
    },
    anzeige: {
      aufnahme: (b) => { L.aufnahme.push(b); }, untertitel: (t) => { L.ereignisse.push('untertitel'); L.untertitel.push(t); }, meldung: (t) => { L.meldung.push(t); },
    },
  };
  return { env, L };
}
const sprechen = async (k) => { k.tasteRunter(); await tick(); return k.tasteHoch(); };

(async () => {
  section('a) Sprache aus: nichts geht nach aussen');
  {
    const { env, L } = fake();
    const k = BS.erzeuge(env);
    ok(k.istAn() === false, 'Standard: aus');
    ok(k.tasteRunter() === false && (await k.tasteHoch()) === false, 'Sprechtaste tut nichts');
    ok((await k.sendeText('Schilde Steuerbord')) === false, 'Textzeile sendet nichts');
    ok(k.empfange({ t: 'bot.antwort', textId: 'x.ok', text: 'Aye' }) === false && L.untertitel.length === 0, 'bot.antwort ohne Sprache: kein Untertitel');
    ok(L.mik === 0 && L.stt === 0 && L.matcher === 0 && L.send.length === 0 && L.zuhoerer === 0 && L.clips.length === 0, 'kein Mikrofon, kein STT, kein Matcher, kein Zuhoerer, keine Nachricht, kein Clip');
    k.schalte(true); ok(L.zuhoerer === 1, 'an: genau ein Zuhoerer');
    k.schalte(false); ok(L.abgemeldet === 1 && !k.istAn(), 'aus: Zuhoerer abgemeldet');
    await sprechen(k); ok(L.mik === 0, 'nach dem Ausschalten wieder kein Mikrofon');

    // Lader: ohne Wunsch kein Skript, kein fetch, kein getUserMedia
    const lauf = (search, ls) => {
      const c = { skripte: [], fetch: 0, gum: 0, ls: Object.assign({}, ls) };
      const win = {
        location: { search },
        localStorage: { getItem: (k) => (k in c.ls ? c.ls[k] : null), setItem: (k, v) => { c.ls[k] = String(v); } },
        fetch: () => { c.fetch++; return Promise.reject(new Error('kein Netz')); },
        navigator: { mediaDevices: { getUserMedia: () => { c.gum++; return Promise.reject(new Error('x')); } } },
        BotSprache: null,
      };
      const doc = { createElement: () => { const s = {}; c.skripte.push(s); return s; }, head: { appendChild: () => {} } };
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'bot-sprache-start.js'), 'utf8'), { window: win, document: doc, URLSearchParams, console });
      return { c, S: win.BotSpracheStart };
    };
    const aus = lauf('', {});
    ok(aus.S.an() === false && aus.c.skripte.length === 0 && aus.c.fetch === 0 && aus.c.gum === 0, 'Lader ohne Wunsch: nichts eingebunden, kein fetch, kein getUserMedia');
    ok(lauf('?botmock=ws://localhost:8710', {}).c.skripte.length === 1, 'Lader mit ?botmock: Modul wird nachgeladen');
    ok(lauf('?botmessung=1', {}).c.skripte.length === 1, 'Lader mit ?botmessung=1: Modul wird nachgeladen');
    ok(lauf('', { 'pantheon.botsprache': '1' }).c.skripte.length === 1, 'Lader mit gemerktem Opt-in: Modul wird nachgeladen');
    ok(lauf('', { 'pantheon.botsprache': '0' }).c.skripte.length === 0, 'Lader mit gemerktem Aus: nichts');
  }

  section('b) Matcher unklar: kein bot.befehl, Rueckfrage');
  {
    const { env, L } = fake({ text: 'Quatsch mit Sosse' });
    const k = BS.erzeuge(env); k.schalte(true);
    await sprechen(k);
    ok(L.send.length === 0, 'kein bot.befehl bei Matcher null');
    ok(L.clips.length === 1 && L.clips[0].every((u) => /\/b0\/bot\.unklar(\.0)?\.(ogg|wav)$/.test(u)) && L.clips[0][0].endsWith('/b0/bot.unklar.0.wav'), 'Clip bot.unklar wird versucht (Variante 0, Stimme b0 wenn noch keiner angesprochen): ' + L.clips[0]);
    ok(eq(L.untertitel, ['Bitte wiederholen']), 'Clip fehlt: Untertitel "Bitte wiederholen"');
    const b = fake({ text: 'Quatsch', clipDa: true }); const kb = BS.erzeuge(b.env); kb.schalte(true);
    await sprechen(kb);
    ok(b.L.send.length === 0 && b.L.untertitel.length === 0 && b.L.clips.length === 1, 'Clip da: Ton statt Untertitel, weiterhin kein bot.befehl');
    const l = fake({ text: '   ' }); const kl = BS.erzeuge(l.env); kl.schalte(true);
    await sprechen(kl);
    ok(l.L.send.length === 0 && l.L.matcher === 0 && l.L.clips.length === 1, 'leerer STT-Text: kein Matcher-Aufruf, Rueckfrage, nichts gesendet');
    const m = fake({ text: 'Schilde', matcher: { match: () => { throw new Error('kaputt'); } } }); const km = BS.erzeuge(m.env); km.schalte(true);
    await sprechen(km);
    ok(m.L.send.length === 0 && m.L.clips.length === 1, 'Matcher wirft: wie unklar, nichts gesendet');
    const ok1 = fake(); const k1 = BS.erzeuge(ok1.env); k1.schalte(true);
    await sprechen(k1);
    ok(eq(ok1.L.send, [{ t: 'bot.befehl', an: 'technik', befehl: 'tech.schild', quelle: 'sprache', args: { sektor: 'stb' } }]), 'erkannt: genau ein bot.befehl mit quelle sprache');
    const o2 = fake({ sendOk: false }); const k2 = BS.erzeuge(o2.env); k2.schalte(true);
    await sprechen(k2);
    ok(o2.L.meldung.includes(BS.TEXT.keinBotServer), 'Transport nimmt nichts an: Meldung "Kein Bot-Server verbunden"');
  }

  section('c) Aufnahme nur zwischen Druck und Loslassen');
  {
    const { env, L } = fake();
    const k = BS.erzeuge(env); k.schalte(true);
    ok(!k.lies().aufnahme && L.mik === 0, 'vor dem Druck: keine Aufnahme, kein Mikrofon');
    ok((await k.tasteHoch()) === false && L.send.length === 0 && L.mik === 0, 'Loslassen ohne Druck: nichts');
    k.tasteRunter(); await tick();
    ok(k.lies().aufnahme === true && L.mik === 1 && L.aufnahme.at(-1) === true, 'gedrueckt: Aufnahme laeuft, Anzeige an');
    ok(L.stumm[0] === true, 'gedrueckt: Wiedergabe stumm (Echo)');
    k.tasteRunter(); await tick(); ok(L.mik === 1, 'Tastenwiederholung startet keine zweite Aufnahme');
    // waehrend der Taste: bot.antwort -> Untertitel ja, Clip nein
    k.empfange({ t: 'bot.antwort', botId: 'b2', befehl: 'tech.schild', status: 'ok', textId: 'tech.schild.ok', text: 'Aye' });
    ok(L.untertitel.at(-1) === 'Aye' && L.clips.length === 0, 'Antwort bei gehaltener Taste: Untertitel, aber kein Clip');
    const fertig = k.tasteHoch();
    ok(!k.lies().aufnahme && L.aufnahme.at(-1) === false && L.stumm.at(-1) === false, 'losgelassen: Aufnahme aus, Anzeige aus, Wiedergabe wieder frei');
    await fertig;
    ok(L.send.length === 1 && L.stt === 1, 'erst nach dem Loslassen: STT und bot.befehl (je einmal)');
    ok((await k.tasteHoch()) === false && L.send.length === 1 && L.mik === 1, 'weiteres Loslassen: nichts');

    // Fokusverlust waehrend der Aufnahme: verwerfen, nichts senden
    const f = fake(); const kf = BS.erzeuge(f.env); kf.schalte(true);
    kf.tasteRunter(); await tick(); kf.abbrechen(); await tick();
    ok(!kf.lies().aufnahme && f.L.abbruch === 1 && f.L.stt === 0 && f.L.send.length === 0 && f.L.aufnahme.at(-1) === false, 'Fokusverlust: Aufnahme verworfen, nichts an STT oder Transport');
    ok((await kf.tasteHoch()) === false && f.L.stt === 0, 'Loslassen nach Abbruch: nichts');

    // zu frueh losgelassen, Mikrofon noch nicht offen: sofort wieder zu
    let frei; const langsam = new Promise((r) => { frei = r; });
    const z = fake({ mikLangsam: langsam }); const kz = BS.erzeuge(z.env); kz.schalte(true);
    kz.tasteRunter(); const lauf = kz.tasteHoch(); frei(); await lauf; await tick();
    ok(z.L.abbruch === 1 && z.L.stt === 0 && z.L.send.length === 0 && !z.L.aufnahme.includes(true), 'Loslassen vor Mikrofonstart: Aufnahme sofort beendet, Anzeige nie an, nichts gesendet');

    // zu kurz
    const kurz = fake({ dauer: 120 }); const kk = BS.erzeuge(kurz.env); kk.schalte(true);
    await sprechen(kk);
    ok(kurz.L.stt === 0 && kurz.L.send.length === 0 && kurz.L.meldung.includes(BS.TEXT.zuKurz), 'zu kurze Aufnahme: kein STT, Hinweis');
    const leer = fake({ leer: true }); const kle = BS.erzeuge(leer.env); kle.schalte(true);
    await sprechen(kle);
    ok(leer.L.stt === 0 && leer.L.send.length === 0, 'leere Aufnahme: kein STT');

    // Sprache waehrend der Aufnahme ausschalten: verwerfen
    const w = fake(); const kw = BS.erzeuge(w.env); kw.schalte(true);
    kw.tasteRunter(); await tick(); kw.schalte(false); await tick();
    ok(w.L.abbruch === 1 && w.L.stt === 0 && w.L.send.length === 0, 'Ausschalten waehrend der Aufnahme: verworfen');
  }

  section('d) STT-Ausfall und Mikrofon-Ausfall: Meldung, Rest laeuft');
  {
    const { env, L } = fake({ sttFehler: true });
    const k = BS.erzeuge(env); k.schalte(true);
    await sprechen(k);
    ok(L.meldung.includes(BS.TEXT.sttAus) && L.send.length === 0, 'STT nicht erreichbar: sichtbare Meldung, nichts gesendet');
    ok(!k.lies().aufnahme && L.stumm.at(-1) === false, 'danach wieder bereit, nicht stumm haengengeblieben');
    ok((await k.sendeText('Schilde Steuerbord')) === true && L.send.length === 1 && L.send[0].quelle === 'text', 'Textzeile laeuft trotzdem (quelle text)');
    ok(k.empfange({ t: 'bot.antwort', textId: 'tech.schild.ok', text: 'Aye' }) === true && L.untertitel.at(-1) === 'Aye', 'Untertitel laufen weiter');
    await sprechen(k); ok(L.stt === 2, 'naechster Versuch geht wieder an den STT (keine Sperre)');

    const m = fake({ mikFehler: true }); const km = BS.erzeuge(m.env); km.schalte(true);
    await sprechen(km);
    ok(m.L.meldung.includes(BS.TEXT.mikro) && m.L.send.length === 0 && !km.lies().aufnahme, 'Mikrofon verweigert: Meldung, nichts gesendet, nicht in Aufnahme haengen');
    ok((await km.sendeText('Schilde')) === true, 'Textzeile geht ohne Mikrofon');

    const nm = fake({ matcher: null }); const knm = BS.erzeuge(nm.env); knm.schalte(true);
    await sprechen(knm);
    ok(nm.L.meldung.includes(BS.TEXT.keinMatcher) && nm.L.send.length === 0, 'Matcher nicht ladbar: Meldung, nichts gesendet');
  }

  section('e) Clipwahl, Messmodus, Tasten, Anzeige');
  {
    ok(eq(BS.clipKandidaten('nav.stopp.ok', 'navigation', 1), ['/assets/bots/stimmen/navigation/nav.stopp.ok.1.wav', '/assets/bots/stimmen/navigation/nav.stopp.ok.1.ogg', '/assets/bots/stimmen/navigation/nav.stopp.ok.wav', '/assets/bots/stimmen/navigation/nav.stopp.ok.ogg']), 'Clipwahl mit Variante: Variante zuerst (wav vor ogg), dann ohne Variante');
    ok(eq(BS.clipKandidaten('bot.unklar', 'ops'), ['/assets/bots/stimmen/ops/bot.unklar.0.wav', '/assets/bots/stimmen/ops/bot.unklar.0.ogg', '/assets/bots/stimmen/ops/bot.unklar.wav', '/assets/bots/stimmen/ops/bot.unklar.ogg']), 'Clipwahl ohne Variante (S4): zuerst .0, dann ohne Variante');
    ok(eq(BS.clipKandidaten('nav.stopp.ok', 'b0', null).slice(0, 2), ['/assets/bots/stimmen/b0/nav.stopp.ok.0.wav', '/assets/bots/stimmen/b0/nav.stopp.ok.0.ogg']), 'null wie fehlende Variante');
    const { env, L } = fake(); const k = BS.erzeuge(env); k.schalte(true);
    k.empfange({ t: 'bot.antwort', botId: 'b1', befehl: 'ops.scan', status: 'ok', textId: 'ops.scan.ok', text: 'Aye, scanne.', variante: 0 });
    ok(L.clips[0][0] === '/assets/bots/stimmen/b1/ops.scan.ok.0.wav' && L.ereignisse.join() === 'untertitel,clip', 'bot.antwort: Untertitel und Clip im selben Schritt, Stimme nach botId');
    k.empfange({ t: 'bot.antwort', botId: 'b9', textId: 'x.ok', stimme: 'kara' });
    ok(L.clips.at(-1)[0] === '/assets/bots/stimmen/kara/x.ok.0.wav' && L.untertitel.at(-1) === 'x.ok', 'msg.stimme hat Vorrang; ohne text zeigt der Untertitel die textId');
    ok(k.empfange({ t: 'snap' }) === false && k.empfange(null) === false, 'fremde Nachrichten werden ignoriert');
    const wirft = fake(); wirft.env.audio.spiele = () => { throw new Error('Audio kaputt'); };
    const kw = BS.erzeuge(wirft.env); kw.schalte(true);
    ok(kw.empfange({ t: 'bot.antwort', botId: 'b0', textId: 'a.ok', text: 'Aye' }) === true && wirft.L.untertitel[0] === 'Aye', 'Audio wirft: Untertitel steht, nichts bricht');

    ok((await k.sendeText('  ')) === false && L.send.length === 0, 'leere Textzeile sendet nichts');
    ok((await k.sendeText('Unsinn')) === false && L.send.length === 0 && L.untertitel.at(-1) === 'Bitte wiederholen', 'Text unklar: kein bot.befehl, Rueckfrage');

    // Messmodus
    const msg = [];
    const mm = fake(); const km = BS.erzeuge(mm.env); km.schalte(true);
    km.setzeMessmodus({ phrasen: [{ id: 'p1', text: 'Schilde Steuerbord', erwartet: { befehl: 'tech.schild', args: { sektor: 'stb' } } }, { id: 'p2', text: 'Alle stopp', erwartet: { befehl: 'nav.stopp' } }], sitzung: 's1', post: async (s, e) => { msg.push([s, e]); } });
    await sprechen(km);
    ok(mm.L.send.length === 0, 'Messmodus sendet KEIN bot.befehl');
    const e = msg[0] && msg[0][1];
    ok(msg.length === 1 && msg[0][0] === 's1' && e.phraseId === 'p1' && e.rohtext === 'Schilde Steuerbord' && e.richtig === true && e.konfidenz === 0.97 && e.ergebnis.befehl === 'tech.schild', 'Messeintrag: Phrase, Rohtext, Ergebnis, Konfidenz, richtig');
    ok(Number.isFinite(e.t_text_ms) && Number.isFinite(e.t_matcher_ms) && e.t_matcher_ms >= e.t_text_ms && e.t_text_ms > 0 && e.dauer_aufnahme_ms === 800, 'Messzeiten: Loslassen->Text und Loslassen->Matcher (Matcher nach Text)');
    km.messeWeiter(1); ok(km.aktuellePhrase().id === 'p2', 'Messmodus: naechste Phrase');
    km.messeWeiter(1); ok(km.aktuellePhrase().id === 'p2', 'Messmodus: am Ende bleibt es stehen');
    await sprechen(km);
    ok(msg[1][1].phraseId === 'p2' && msg[1][1].richtig === false, 'falscher Befehl wird als nicht richtig gezaehlt');
    const pf = fake(); const kpf = BS.erzeuge(pf.env); kpf.schalte(true);
    kpf.setzeMessmodus({ phrasen: [{ id: 'p1', text: 'x', erwartet: { befehl: 'tech.schild' } }], sitzung: 's2', post: async () => { throw new Error('404'); } });
    await sprechen(kpf);
    ok(pf.L.meldung.includes(BS.TEXT.messungFehler), 'Speichern der Messung scheitert: Meldung');
    ok(BS.erwartungErfuellt({ befehl: 'a', args: { x: 1 } }, { befehl: 'a', args: { x: '1', y: 2 } }) && !BS.erwartungErfuellt({ befehl: 'a', an: 'ops' }, { befehl: 'a', an: 'bord' }) && !BS.erwartungErfuellt({ befehl: 'a' }, null), 'Messvergleich: Argumente als Text, Adressat, null');

    // Tastenbelegung (Standardtaste frei, umbelegbar)
    const T = (() => { const win = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tasten.js'), 'utf8'), { window: win, console }); return win.Tasten; })();
    ok(T.belegung('allgemein.sprechen').join() === 'Backquote' && T.belegung('allgemein.botText').join() === 'Backslash', 'Standardtasten: Sprechtaste ^ (Backquote), Textzeile # (Backslash)');
    const alle = T.AKTIONEN.filter((a) => a.id !== 'allgemein.sprechen' && (a.std.includes('Backquote') || a.std.includes('Shift+Backquote')));
    const alle2 = T.AKTIONEN.filter((a) => a.id !== 'allgemein.botText' && (a.std.includes('Backslash') || a.std.includes('Shift+Backslash')));
    ok(alle.length === 0 && alle2.length === 0, 'Standardtasten sind von keiner anderen Aktion belegt');
    ok(T.GRUPPEN.every((g) => T.konflikte(g.id).length === 0), 'keine Tastenkonflikte in keiner Gruppe');
    ok(T.passt({ code: 'Backquote', shiftKey: false }, 'allgemein.sprechen') && T.setze('allgemein.sprechen', 0, 'F9') && T.passt({ code: 'F9' }, 'allgemein.sprechen') && T.loslassen({ code: 'F9' }, 'allgemein.sprechen'), 'frei belegbar (Tasten.setze), Loslassen folgt der Belegung');

    // Anzeige im HUD (BOT-04 C2, Fake-DOM und Fake-Hud): Untertitel, Aufnahme und Meldung laufen ueber das HUD, im DOM bleibt nur das unsichtbare <input> der Textzeile
    const elemente = [];
    const mk = (tag) => { const e = { tag, style: {}, children: [], listeners: {}, textContent: '', attrs: {}, value: '', appendChild(c) { this.children.push(c); }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute(k, v) { this.attrs[k] = v; }, focus() { this.fokus = true; doc.activeElement = this; }, blur() { this.fokus = false; if (doc.activeElement === this) doc.activeElement = null; (this.listeners.blur || []).forEach((f) => f({})); }, remove() { this.entfernt = true; } }; elemente.push(e); return e; };
    const canvas = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 1920, height: 1080 }) };
    const doc = { createElement: mk, body: mk('body'), activeElement: null, getElementById: (id) => (id === 'game' ? canvas : null) };
    const fakeHud = (bereit) => {
      const h = { sprech: { aktiv: false, aufnahme: false, verarbeitet: false, zeile: null }, notices: [], titel: [], halt: [], bereit: bereit !== false,
        sprechAn(b) { h.sprech.aktiv = !!b; if (!b) h.sprech.zeile = null; }, sprechBereit: () => h.bereit,
        pushNotice(t, f, dd) { h.notices.push({ text: t, color: f, d: dd }); },
        pushCrewFunk(t, wer, farbe, dauer) { h.titel.push({ t, wer, farbe, dauer }); return h.titel.length; }, crewFunkHalte(id, an) { h.halt.push([id, an]); } };
      return h;
    };
    const FNT = { sensor: '#A9D6E5', warn: '#F2C94C' };
    const gesendet = [];
    const hud = fakeHud();
    const win = { document: doc, Hud: hud, Client: { scale: 3 }, Menue: { TOKENS: { FN: FNT, FARBE: {} } } };
    const an = BS.anzeigeHud(win, (t) => gesendet.push(t), () => {});
    ok(hud.sprech.aktiv && hud.sprech.zeile === an.zeile, 'Anzeige meldet sich beim HUD an (Sprechspalte aktiv, Textzeile eingehaengt)');
    ok(an.wurzel.style.pointerEvents === 'none' && an.zeile.offen === false && an.wurzel.children[0].style.display === 'none' && an.wurzel.children[0].style.pointerEvents === 'none', 'DOM: faengt keine Mausklicks ab, Textzeile zu');
    ok(an.feld.attrs.maxlength === '120' && an.feld.type === 'text' && an.wurzel.children[0].style.opacity === '0', 'Textzeile: echtes <input maxlength=120>, unsichtbar (opacity 0)');
    ok(!elemente.some((x) => /AUFNAHME|FUNK OFFEN/.test(x.textContent)) && elemente.filter((x) => x.tag === 'div').length === 1, 'keine DOM-Kacheln mehr fuer Aufnahme, Untertitel, Meldung');
    an.aufnahme(true); ok(hud.sprech.aufnahme === true, 'Aufnahme-Anzeige an'); an.aufnahme(false); ok(hud.sprech.aufnahme === false, 'Aufnahme-Anzeige aus');
    an.verarbeitet(true); ok(hud.sprech.verarbeitet === true, 'Zwischenzustand an'); an.aufnahme(true); ok(hud.sprech.verarbeitet === false, 'neue Aufnahme beendet den Zwischenzustand'); an.aufnahme(false);
    const idU = an.untertitel('Aye', { botId: 'b1' });
    ok(idU === 1 && eq(hud.titel[0], { t: 'Aye', wer: 'OPS', farbe: FNT.sensor, dauer: undefined }), 'Untertitel: HUD-Eintrag, Name = Rolle des Bots (b1 OPS), Farbe sensor');
    ok(['b0', 'b1', 'b2', 'b3', null, undefined, 'x'].map(BS.sprecherName).join() === 'NAVIGATION,OPS,TECHNIK,BORD,BORD,BORD,BORD', 'Sprechername: b0 NAVIGATION, b1 OPS, b2 TECHNIK, sonst BORD');
    an.clip(idU, true); an.clip(idU, false); an.clip(null, true);
    ok(eq(hud.halt, [[1, true], [1, false]]), 'Clip-Rueckruf haelt/loest den Untertitel (ohne Kennung nichts)');
    an.meldung('Fehler'); ok(eq(hud.notices.at(-1), { text: 'Fehler', color: FNT.warn, d: 6 }), 'Meldung = Hud.pushNotice(text, FN.warn, 6)');
    an.meldung(null); ok(hud.notices.length === 0, 'meldung(null) nimmt die Meldung wieder weg');
    an.meldung(BS.TEXT.maxDauer); ok(hud.notices.at(-1).d === 3600, '"Aufnahme nach 60 s beendet." bleibt stehen');
    an.meldung('Anderes'); ok(hud.notices.some((x) => x.text === BS.TEXT.maxDauer), 'bleibt auch neben anderen Meldungen');
    an.aufnahme(true); ok(!hud.notices.some((x) => x.text === BS.TEXT.maxDauer), 'bis zur naechsten Aufnahme'); an.aufnahme(false);
    an.hinweis('Hallo'); ok(eq(hud.notices.at(-1), { text: 'Hallo', color: FNT.sensor, d: 6 }), 'Hinweis beim Einschalten: pushNotice, 6 s');
    ok(BS.startHinweis({ kappe: (id) => ({ 'allgemein.sprechen': '^', 'allgemein.botText': '#' }[id]) }) === 'Bot-Sprache an: ^ halten = sprechen, # = tippen', 'Startnotiz mit den echten Tastenbeschriftungen');
    ok(BS.startHinweis({ kappe: (id) => (id === 'allgemein.sprechen' ? 'F9' : '–') }) === 'Bot-Sprache an: F9 halten = sprechen, # = tippen', 'Startnotiz: umbelegte Taste, Ersatz bei fehlender Belegung');
    // Textzeile: offen nur mit Spielbild; Enter sendet und schliesst, Esc schliesst ohne Senden, Fokusverlust schliesst nur, wenn leer
    const zf = an.wurzel.children[0];
    hud.bereit = false; ok(an.textzeile(true) === false && !an.zeile.offen, 'Textzeile oeffnet nicht ohne Spielbild (Lobby/Menue)'); hud.bereit = true;
    ok(an.textzeile(true) === true && an.zeile.offen && zf.style.display === 'block' && zf.style.pointerEvents === 'auto' && an.feld.fokus === true, 'Textzeile oeffnet und fokussiert, nimmt dann Mausklicks');
    let gestoppt = 0; for (const t of ['keydown', 'keyup', 'keypress']) an.feld.listeners[t][0]({ stopPropagation: () => { gestoppt++; }, key: 'w' });
    ok(gestoppt === 3 && an.zeile.offen, 'Tasten in der Textzeile erreichen das Spiel nicht (keydown, keyup, keypress)');
    an.feld.value = 'Feuer frei'; zf.listeners.submit[0]({ preventDefault() {} });
    ok(eq(gesendet, ['Feuer frei']) && !an.zeile.offen && an.feld.value === '' && zf.style.display === 'none' && zf.style.pointerEvents === 'none', 'Enter: Text geht an den Kern, Zeile schliesst und leert sich');
    an.textzeile(true); an.feld.value = 'nicht senden'; let eg = 0;
    an.feld.listeners.keydown[0]({ stopPropagation: () => { gestoppt++; }, preventDefault: () => { eg++; }, key: 'Escape' });
    ok(!an.zeile.offen && an.feld.value === '' && gesendet.length === 1 && eg === 1, 'Esc: schliesst ohne zu senden');
    an.textzeile(true); an.feld.blur(); ok(!an.zeile.offen, 'Fokusverlust bei leerer Zeile: schliesst');
    an.textzeile(true); an.feld.value = 'halber Satz'; an.feld.blur(); ok(an.zeile.offen && an.feld.value === 'halber Satz', 'Fokusverlust mit Text: Zeile bleibt offen');
    an.zeile.schliessen(); ok(!an.zeile.offen, 'schliessen() (HUD: kein Spielbild) schliesst');
    // S1: gehaltene Spieltasten werden ueber Client.tastenFreigeben freigegeben (keyup in der Zeile erreicht das Spiel nicht)
    {
      const gehalten = { KeyW: true, ShiftLeft: true }; let frei = 0;
      win.Client.tastenFreigeben = () => { frei++; for (const k of Object.keys(gehalten)) delete gehalten[k]; };
      an.textzeile(true); ok(frei === 1 && !gehalten.KeyW && !gehalten.ShiftLeft, 'Oeffnen gibt die gehaltenen Spieltasten frei (W, Umschalt)');
      an.feld.listeners.keyup[0]({ stopPropagation() {}, code: 'KeyW' });
      gehalten.Backslash = true;   // das Spiel sieht das # selbst noch (keydown vor dem Oeffnen), sein keyup bleibt in der Zeile
      an.zeile.schliessen(); ok(frei === 2 && !gehalten.Backslash, 'Schliessen gibt ebenfalls frei: nichts bleibt haengen');
      an.zeile.schliessen(); ok(frei === 2, 'schon zu: keine weitere Freigabe');
      an.feld.value = 'x'; an.textzeile(true); zf.listeners.submit[0]({ preventDefault() {} }); ok(frei === 4, 'Enter schliesst und gibt frei');
      delete win.Client.tastenFreigeben;
      ok(an.textzeile(true) === true && (an.zeile.schliessen(), true), 'ohne Client.tastenFreigeben (aelterer Client) kein Absturz');
      // H2: kein Oeffnen hinter einem Overlay
      let eingabeFrei = false; win.Client.eingabeFrei = () => eingabeFrei; win.Client.tastenFreigeben = () => { frei++; };
      const vor = frei; ok(an.textzeile(true) === false && !an.zeile.offen && zf.style.display === 'none' && frei === vor, 'Pausenmenue/Minispiel/Terminal-Zusehen: die Zeile oeffnet nicht (und gibt nichts frei)');
      eingabeFrei = true; ok(an.textzeile(true) === true && an.zeile.offen, 'ohne Overlay oeffnet sie'); an.zeile.schliessen();
      delete win.Client.eingabeFrei; delete win.Client.tastenFreigeben;
      const cj = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'client.js'), 'utf8');
      ok(/Client\.tastenFreigeben = releaseAll;/.test(cj) && /Client\.eingabeFrei = \(\) => \{[^\n]*uiTop\(\)[^\n]*Client\.chapter[^\n]*Client\.minigame[^\n]*TerminalUI\.zusehend/.test(cj), 'client.js bietet tastenFreigeben (= die Freigabe bei Fokusverlust) und eingabeFrei (Menue, Kapitel, Minispiel, Zusehen)');
    }
    // Lage: Rasterrechteck * Client.scale + Canvas-Versatz (wie #lobbyCode)
    an.textzeile(true); an.zeile.platziere({ x: 178, y: 300, w: 284, h: 14 });
    ok(zf.style.left === (100 + 178 * 3) + 'px' && zf.style.top === (50 + 300 * 3) + 'px' && zf.style.width === '852px' && zf.style.height === '42px', 'Eingabefeld liegt im Rastermass ueber dem Kasten (Skala 3)');
    win.Client.scale = 2; canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 }); an.zeile.platziere({ x: 178, y: 300, w: 284, h: 14 });
    ok(zf.style.left === '356px' && zf.style.top === '600px' && zf.style.width === '568px' && zf.style.height === '28px', 'Skala 2: gleiche Rasterwerte, andere Pixel');
    an.zeile.schliessen();
    an.messung({ index: 0, phrasen: [{ id: 'p1', text: 'Alle stopp' }], eintraege: [] }); ok(elemente.some((x) => /MESSUNG/.test(x.textContent)), 'Messansicht bleibt DOM (Entwicklerwerkzeug)');
    an.textzeile(true); ok(an.zeile.offen, 'Textzeile fuer aus() offen');
    an.aus(); ok(!an.zeile.offen && zf.style.display === 'none' && zf.style.pointerEvents === 'none', 'aus(): eine offene Textzeile wird geschlossen');
    an.aus(); ok(hud.sprech.aktiv === false && !hud.notices.some((x) => x.text === 'Anderes' || x.text === BS.TEXT.maxDauer) && an.wurzel.entfernt === true, 'aus(): HUD abgemeldet, eigene Meldungen weg, DOM entfernt');
  }

  section('f) Nacharbeit: bot.unklar, Hoechstdauer, 413, Ausschalten, Mikrofon, Mock-Adresse');
  {
    // S4: bot.unklar wechselt die Variante und nimmt die Stimme des zuletzt aktiven Bots
    const { env, L } = fake({ text: 'Quatsch' }); const k = BS.erzeuge(env); k.schalte(true);
    await sprechen(k); await sprechen(k); await sprechen(k);
    ok(L.clips.length === 3 && L.clips.map((c) => c[0].match(/bot\.unklar\.(\d)\./)[1]).join() === '0,1,0', 'bot.unklar: Varianten 0, 1, 0 abwechselnd (' + L.clips.map((c) => c[0]).join(' ') + ')');
    ok(eq(L.untertitel, ['Bitte wiederholen', BS.TEXT.unklar2, 'Bitte wiederholen']) && BS.TEXT.unklar2 === 'Das habe ich nicht verstanden', 'ohne Clip: Untertitel passend zur Variante');
    ok(L.clips.every((c) => c[0].includes('/b0/')), 'ohne angesprochenen Bot: Stimme b0');
    k.empfange({ t: 'bot.antwort', botId: 'b2', befehl: 'ops.scan', status: 'ok', textId: 'ops.scan.ok', text: 'Aye' });
    const n0 = L.clips.length;
    await sprechen(k);
    ok(L.clips[n0].every((u) => u.includes('/b2/bot.unklar.')), 'nach Antwort von b2: bot.unklar in der Stimme b2 (' + L.clips[n0][0] + ')');
    const w = fake({ matcher: { match: () => ({ an: 'b1', befehl: 'ops.scan', konfidenz: 0.9 }) } }); const kw = BS.erzeuge(w.env); kw.schalte(true);
    await sprechen(kw);
    const w2 = fake({ text: 'Quatsch' }); w2.env.matcher = () => (w2.L.matcher++, { match: (t) => (t === 'Quatsch' ? null : { an: 'b1', befehl: 'ops.scan' }) });
    const kw2 = BS.erzeuge(w2.env); kw2.schalte(true);
    await kw2.sendeText('scan'); await kw2.sendeText('Quatsch');
    ok(w2.L.clips.at(-1).every((u) => u.includes('/b1/')), 'nach Befehl an b1 (botId im Matcher-Ergebnis): bot.unklar in der Stimme b1');
    // Stimme aus env.stimmen (b3 faellt auf b0)
    const b3 = fake({ text: 'Quatsch' }); const k3 = BS.erzeuge(b3.env); k3.schalte(true);
    k3.empfange({ t: 'bot.antwort', botId: 'b3', textId: 'x.ok' }); await sprechen(k3);
    ok(b3.L.clips.at(-1)[0].includes('/b0/bot.unklar.'), 'b3 spricht mit der Stimme b0');

    // H6: Hoechstdauer 60 s (Auto-Stop mit Anzeige), Timer wird beim Loslassen geraeumt
    const timers = []; let geraeumt = 0;
    const tz = fake({ dauer: 60000 }); tz.env.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; }; tz.env.clearTimeout = () => { geraeumt++; };
    const kt = BS.erzeuge(tz.env); kt.schalte(true);
    kt.tasteRunter(); await tick();
    ok(timers.length === 1 && timers[0].ms === 60000 && BS.MAX_MS === 60000, 'Aufnahme startet einen 60-s-Timer');
    timers[0].f(); await kt.warte(); await tick(); await kt.warte();
    ok(tz.L.meldung.includes(BS.TEXT.maxDauer) && tz.L.meldung.at(-1) === BS.TEXT.maxDauer && !kt.lies().aufnahme && tz.L.aufnahme.at(-1) === false && tz.L.stt === 1 && tz.L.send.length === 1, 'nach 60 s: Auto-Stop, Anzeige "Aufnahme nach 60 s beendet" bleibt, Aufnahme wird ausgewertet');
    ok((await kt.tasteHoch()) === false && tz.L.stt === 1, 'Loslassen nach dem Auto-Stop: nichts doppelt');
    const t2 = fake(); const tm2 = []; t2.env.setTimeout = (f) => { tm2.push(f); return 1; }; t2.env.clearTimeout = () => { geraeumt++; };
    const kt2 = BS.erzeuge(t2.env); kt2.schalte(true);
    const g0 = geraeumt; await sprechen(kt2);
    ok(geraeumt > g0 && t2.L.stt === 1, 'Loslassen raeumt den Timer');
    tm2[0](); await tick();
    ok(t2.L.stt === 1 && t2.L.send.length === 1, 'alter Timer nach Loslassen tut nichts');
    const t3 = fake(); const tm3 = []; t3.env.setTimeout = (f) => { tm3.push(f); return 1; }; t3.env.clearTimeout = () => {};
    const kt3 = BS.erzeuge(t3.env); kt3.schalte(true);
    kt3.tasteRunter(); await tick(); kt3.abbrechen(); tm3[0](); await tick();
    ok(t3.L.stt === 0 && t3.L.send.length === 0, 'Timer nach Abbruch (Fokusverlust) tut nichts');
    // 413 vom Server: eigene Meldung, nicht "nicht erreichbar"
    const e413 = fake(); e413.env.stt = () => { const e = new Error('stt 413'); e.status = 413; return Promise.reject(e); };
    const k413 = BS.erzeuge(e413.env); k413.schalte(true); await sprechen(k413);
    ok(e413.L.meldung.at(-1) === 'Aufnahme zu lang.' && !e413.L.meldung.includes(BS.TEXT.sttAus) && e413.L.send.length === 0, '413: Meldung "Aufnahme zu lang.", nicht "nicht erreichbar"');
    const e502 = fake({ sttFehler: true }); const k502 = BS.erzeuge(e502.env); k502.schalte(true); await sprechen(k502);
    ok(e502.L.meldung.at(-1) === BS.TEXT.sttAus, 'anderer STT-Fehler bleibt "nicht erreichbar"');

    // H7: nach dem Ausschalten geht nichts mehr an STT oder an den Server
    const a1 = fake(); const ka1 = BS.erzeuge(a1.env); ka1.schalte(true);
    ka1.tasteRunter(); await tick();
    const fertig = ka1.tasteHoch(); ka1.schalte(false);   // ausgeschaltet, bevor die Aufnahme ausgewertet wird
    await fertig;
    ok(a1.L.stt === 0 && a1.L.send.length === 0, 'Ausschalten zwischen Loslassen und Auswertung: kein STT-Aufruf, nichts gesendet');
    let weiter; const a2 = fake(); a2.env.stt = () => { a2.L.stt++; return new Promise((r) => { weiter = r; }); };
    const ka2 = BS.erzeuge(a2.env); ka2.schalte(true);
    ka2.tasteRunter(); await tick(); const f2 = ka2.tasteHoch(); await tick(); await tick();
    ka2.schalte(false); weiter('Schilde Steuerbord'); await f2;
    ok(a2.L.stt === 1 && a2.L.send.length === 0 && a2.L.clips.length === 0, 'Ausschalten waehrend der Erkennung: Ergebnis wird verworfen, nichts gesendet');

    // H4: ?botmock= nur lokal
    const M = BS.mockUrlErlaubt;
    ok(M('ws://localhost:8710') && M('ws://127.0.0.1:8710') && M('ws://[::1]:8710') && M('wss://localhost'), 'botmock: localhost, 127.0.0.1, [::1] erlaubt');
    ok(!M('ws://evil.example:8710') && !M('ws://localhost.evil.example') && !M('ws://127.0.0.1.evil.example') && !M('ws://192.168.1.5:8710') && !M('http://localhost') && !M('javascript:alert(1)') && !M('') && !M('ws://user@evil.example/') && !M('ws://localhost@evil.example'), 'botmock: fremde Hosts, Tricks, andere Protokolle und Muell abgelehnt');
    const quelle = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'bot-sprache.js'), 'utf8');
    ok(/mockUrlErlaubt\(mockUrl\)/.test(quelle) && /transportWebSocket\(mockUrl, win\.WebSocket\)/.test(quelle) && /mockOk[^\n]*transportWebSocket|transportWebSocket[^\n]*mockOk|mockUrl !== null && mockOk/.test(quelle) && /TEXT\.mockVerboten/.test(quelle), 'starte(): Mock-Transport nur nach Pruefung, sonst Meldung');

    // H5: Mikrofonstream wird gestoppt, wenn Recorder oder start() wirft
    for (const [name, wirftBei] of [['new MediaRecorder', 'ctor'], ['rec.start()', 'start']]) {
      let gestoppt = 0;
      const stream = { getTracks: () => [{ stop: () => { gestoppt++; } }, { stop: () => { gestoppt++; } }] };
      function MR() { if (wirftBei === 'ctor') throw new Error('MediaRecorder kaputt'); this.start = () => { throw new Error('start kaputt'); }; }
      MR.isTypeSupported = () => true;
      const win = { MediaRecorder: MR, Blob, navigator: { mediaDevices: { getUserMedia: async () => stream } } };
      let fehler = null; try { await BS.mikrofonBrowser(win).start(); } catch (e) { fehler = e; }
      ok(fehler && gestoppt === 2, name + ' wirft: Fehler geht weiter, beide Spuren des Mikrofonstreams gestoppt');
    }
    // Normalfall bleibt: Recorder laeuft, Stream erst beim Stoppen frei
    {
      let gestoppt = 0; const stream = { getTracks: () => [{ stop: () => { gestoppt++; } }] };
      function MR2() { this.mimeType = 'audio/webm'; this.start = () => {}; this.stop = () => { this.ondataavailable({ data: { size: 3 } }); this.onstop(); }; }
      MR2.isTypeSupported = () => true;
      const h = await BS.mikrofonBrowser({ MediaRecorder: MR2, Blob, navigator: { mediaDevices: { getUserMedia: async () => stream } } }).start();
      ok(gestoppt === 0, 'Normalfall: Stream offen waehrend der Aufnahme');
      const aufn = await h.stop();
      ok(gestoppt === 1 && aufn && aufn.mime === 'audio/webm', 'Normalfall: Stoppen gibt Stream frei und liefert die Aufnahme');
    }
    // sttBrowser: 413 traegt den Status
    const sb = BS.sttBrowser({ fetch: async () => ({ ok: false, status: 413 }) });
    let st = null; try { await sb(new Blob(['x']), 'audio/webm'); } catch (e) { st = e.status; }
    ok(st === 413, 'sttBrowser: Fehler tragen den HTTP-Status (413)');
  }

  section('g) BOT-04 C2: Kern-Schnittstelle (verarbeitet, Untertitel-Kennung, Clip-Rueckruf, STT-503)');
  {
    const { env, L } = fake({ text: 'Quatsch' });
    L.verarb = []; L.info = []; L.clipRuf = [];
    const zeit = [];
    env.anzeige.verarbeitet = (b) => { L.verarb.push(b); zeit.push('v' + b); };
    env.anzeige.untertitel = (t, info) => { L.untertitel.push(t); L.info.push(info); zeit.push('u'); return L.untertitel.length; };
    env.anzeige.clip = (id, b) => { L.clipRuf.push([id, b]); };
    env.anzeige.aufnahme = (b) => { L.aufnahme.push(b); zeit.push('a' + b); };
    env.audio.spiele = (urls, cb) => { L.cb = cb; L.clips.push(urls); return Promise.resolve(null); };
    const k = BS.erzeuge(env); k.schalte(true);
    await sprechen(k);
    ok(zeit.join() === 'atrue,afalse,vtrue,vfalse,u', 'Loslassen: Aufnahme aus, dann Zwischenzustand an, vor dem Ergebnis wieder aus (' + zeit.join() + ')');
    ok(L.verarb.join() === 'true,false', 'verarbeitet(true) beim Loslassen, verarbeitet(false) mit dem Ergebnis');
    ok(L.info.length === 1 && L.info[0].dauerS === BS.UNKLAR_DAUER_S && BS.UNKLAR_DAUER_S === 2.5 && L.info[0].botId == null, '"Bitte wiederholen": 2,5 s, ohne angesprochenen Bot kein Rollenname (BORD)');
    k.empfange({ t: 'bot.antwort', botId: 'b2', textId: 'tech.ok', text: 'Aye' });
    ok(L.info.at(-1).botId === 'b2' && L.info.at(-1).dauerS === undefined, 'Antwort: botId geht an die Anzeige, Dauer nach Formel (kein dauerS)');
    ok(L.cb && typeof L.cb.start === 'function' && typeof L.cb.ende === 'function', 'Audio bekommt Start-/Ende-Rueckruf');
    L.cb.start(); L.cb.ende();
    ok(eq(L.clipRuf, [[L.untertitel.length, true], [L.untertitel.length, false]]), 'Rueckruf meldet der Anzeige Kennung des Untertitels, nicht eines frueheren');
    // Fehlerfaelle beenden den Zwischenzustand ebenfalls
    for (const [name, o] of [['STT-Fehler', { sttFehler: true }], ['zu kurz', { dauer: 100 }], ['Mikrofon', { mikFehler: true }], ['Matcher fehlt', { matcher: null }]]) {
      const f = fake(o); f.L.verarb = []; f.env.anzeige.verarbeitet = (b) => { f.L.verarb.push(b); };
      const kk = BS.erzeuge(f.env); kk.schalte(true); await sprechen(kk);
      ok(f.L.verarb.at(-1) === false || f.L.verarb.length === 0, name + ': Zwischenzustand endet nicht haengend');
    }
    // H3: ueberlappende Ablaeufe: "..." bleibt, bis der letzte fertig ist (Zaehler statt Flag); ein Text-Befehl dazwischen loescht es nicht
    {
      const f = fake({ text: 'Quatsch' }); f.L.verarb = []; f.env.anzeige.verarbeitet = (b) => { f.L.verarb.push(b); };
      const offen = []; f.env.stt = () => new Promise((r) => offen.push(r));
      const kk = BS.erzeuge(f.env); kk.schalte(true);
      kk.tasteRunter(); await tick(); const p1 = kk.tasteHoch(); await tick(); await tick();
      kk.tasteRunter(); await tick(); const p2 = kk.tasteHoch(); await tick(); await tick();
      ok(offen.length === 2 && f.L.verarb.join() === 'true', 'zwei Ablaeufe laufen: "..." steht (einmal gemeldet)');
      await kk.sendeText('Quatsch'); ok(f.L.verarb.join() === 'true', 'ein Text-Befehl daneben beendet das "..." der Aufnahmen nicht');
      offen[0]('Quatsch'); await p1; ok(f.L.verarb.join() === 'true', 'der erste Ablauf ist fertig, der zweite laeuft noch: "..." bleibt');
      offen[1]('Quatsch'); await p2; ok(f.L.verarb.join() === 'true,false', 'erst mit dem letzten Ergebnis endet das "..."');
    }
    // STT 503 { fehler: 'stt-aus' } -> eigene Meldung, sonst "nicht erreichbar"
    const sb = BS.sttBrowser({ fetch: async () => ({ ok: false, status: 503, json: async () => ({ fehler: 'stt-aus', text: 'x' }) }) });
    let fe = null; try { await sb(new Blob(['x']), 'audio/webm'); } catch (e) { fe = e; }
    ok(fe && fe.status === 503 && fe.fehler === 'stt-aus', 'sttBrowser: 503 { fehler: stt-aus } wird erkannt');
    const sb2 = BS.sttBrowser({ fetch: async () => ({ ok: false, status: 503, json: async () => { throw new Error('kein json'); } }) });
    fe = null; try { await sb2(new Blob(['x']), 'audio/webm'); } catch (e) { fe = e; }
    ok(fe && fe.status === 503 && !fe.fehler, 'sttBrowser: 503 ohne JSON bleibt "nicht erreichbar"');
    const ne = fake(); ne.env.stt = () => { const e = new Error('stt 503'); e.status = 503; e.fehler = 'stt-aus'; return Promise.reject(e); };
    const kne = BS.erzeuge(ne.env); kne.schalte(true); await sprechen(kne);
    ok(ne.L.meldung.at(-1) === 'Sprache nicht eingerichtet (STT_URL fehlt).' && ne.L.meldung.at(-1) === BS.TEXT.sttNichtEingerichtet, 'nicht eingerichtet: "Sprache nicht eingerichtet (STT_URL fehlt)."');
    const ng = fake({ sttFehler: true }); const kng = BS.erzeuge(ng.env); kng.schalte(true); await sprechen(kng);
    ok(ng.L.meldung.at(-1) === 'Sprache nicht erreichbar – Menü, Tasten und Textzeile laufen weiter.', 'sonstiger Ausfall: "Sprache nicht erreichbar – Menü, Tasten und Textzeile laufen weiter."');
    // Clipwahl: .wav zuerst (der Vorrat hat nur WAV, sonst 404 auf .ogg je Clip)
    ok(BS.clipKandidaten('x.ok', 'b0', 0).map((u) => u.split('.').pop()).join() === 'wav,ogg,wav,ogg', 'Clipwahl: zuerst wav, dann ogg');
  }

  section('h) BOT-04 C2: Sprechspalte im HUD (hud.js gegen Render-Stub)');
  {
    let tMs = 1000;
    const calls = [];
    const R = {
      PAL: new Proxy({}, { get: (t, k) => '#' + String(k) }),
      measure: (t) => String(t == null ? '' : t).length * 6,
      wrap(str, maxW) { const out = []; let line = ''; for (const w of String(str).split(' ')) { const test = line ? line + ' ' + w : w; if (test.length * 6 > maxW && line) { out.push(line); line = w; } else line = test; } if (line) out.push(line); return out; },
      backdrop: (c, x, y, w, h, a) => calls.push({ n: 'backdrop', x, y, w, h, a, ga: ctx.globalAlpha }),
      text: (c, s, x, y, o) => calls.push({ n: 'text', s, x, y, o }),
    };
    const ctx = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect(x, y, w, h) { calls.push({ n: 'fillRect', x, y, w, h, c: this.fillStyle }); }, strokeRect(x, y, w, h) { calls.push({ n: 'strokeRect', x, y, w, h, c: this.strokeStyle }); } };
    const neu = (extra) => {
      const w = Object.assign({ Render: R, Shared_Maps: {}, Shared_Config: {}, Shared_Protocol: {}, Net: { guard: (nm, f) => f(), on() {} }, performance: { now: () => tMs }, Menue: { TOKENS: { FN: { drive: '#FFC66B', sensor: '#A9D6E5', cmd: '#F4EEDC', warn: '#F2C94C', neutral: '#8EA3B5' } } } }, extra || {});
      w.window = w; vm.createContext(w);
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hud.js'), 'utf8'), w, { filename: 'hud.js' });
      return w;
    };
    const fuss = (o) => Object.assign({ time: 1, self: { zone: 'ship' }, me: {}, state: { phase: 'play' } }, o || {});
    const konsole = (o) => Object.assign({ time: 1, self: { zone: 'ship' }, me: { console: 'helm' }, state: { phase: 'play' } }, o || {});
    const sl = (w, v) => w.Hud.sprechSlot(v);
    const oda = (w, text) => { w.Hud.oda.cur = { text, shown: text.length, hold: 0 }; };
    const eins = 'Kurzer Text', drei = 'a'.repeat(39) + ' ' + 'b'.repeat(39) + ' ' + 'c'.repeat(30);   // 1 bzw. 3 Zeilen bei 240 px Umbruchbreite (6 px je Zeichen)
    {
      const w = neu();
      ok(eq(sl(w, fuss()), { x: 178, w: 284, y: 354, richtung: 'hoch' }), 'zu Fuss ohne alles: Spalte x 178 (= ODA-Spalte), 284 breit, Unterkante VH - 6, waechst nach oben');
      oda(w, eins); ok(sl(w, fuss()).y === 354 - 20 - 4, 'zu Fuss mit ODA (1 Zeile): 4 px ueber der ODA');
      oda(w, drei); ok(sl(w, fuss()).y === 354 - 40 - 4, 'zu Fuss mit ODA (3 Zeilen): 4 px ueber der hoeheren ODA');
      w.Hud.oda.cur = null;
      ok(w.Hud.odaHoehe(fuss()) === 0 && w.Hud.odaHoehe(konsole()) === 0, 'odaHoehe: ohne ODA und an der Konsole 0 (unveraendert)');
      oda(w, eins); ok(w.Hud.odaHoehe(konsole()) === 0 && w.Hud.odaHoeheOben() === 20, 'odaHoeheOben: Hoehe der oben stehenden ODA, odaHoehe an der Konsole bleibt 0');
    }
    {
      const w = neu({ Scanner: { aktiv: () => true, rechteck: () => ({ x: 200, y: 268, w: 240, h: 84 }) } });
      ok(sl(w, fuss()).y === 268 - 4, 'Scanner-Overlay: 4 px ueber Scanner.rechteck()');
      oda(w, eins); ok(sl(w, fuss()).y === 268 - 14 - 4, 'Scanner mit ODA: ueber der Marke "ODA +n" (14 px ueber dem Overlay)');
    }
    {
      const w = neu({ Funkwahl: { offen: () => true, rechteck: () => ({ x: 0, y: 200, w: 280, h: 100 }) } });
      ok(sl(w, fuss()).y === 196, 'Funkwahl-Antwortleiste offen: 4 px ueber ihrer Oberkante');
      oda(w, eins); ok(sl(w, fuss()).y === 196, 'Funkwahl hoeher als die ODA: sie entscheidet');
      const w2 = neu({ Funkwahl: { offen: () => false, rechteck: () => ({ y: 10 }) } }); ok(sl(w2, fuss()).y === 354, 'Funkwahl zu: kein Einfluss');
    }
    {
      const w = neu({ Gespraech: { rechteck: (st) => (st.gp ? { y: 150 } : null) } });
      ok(sl(w, fuss({ state: { phase: 'play', gp: { n: 'x' } } })).y === 146 && sl(w, fuss()).y === 354, 'Gespraechsfenster: 4 px darueber, ohne Gespraech kein Einfluss');
      const w2 = neu({ KontingentFrage: { offen: () => true } });
      ok(sl(w2, fuss()).y === 343 - 4, 'Kontingent-Frage offen (Leiste x 356..630, y 343): Spalte darueber');
    }
    {
      const w = neu();
      ok(eq(sl(w, konsole()), { x: 178, w: 284, y: 20, richtung: 'runter' }), 'Konsole ohne ODA: Spalte ab y 20, waechst nach unten');
      // H1: nur im Voxel-Sitz steht die ODA (y 16) sichtbar; an der Konsole des 2D-Bilds deckt die Konsole sie zu, dort gilt der Mindestwert
      oda(w, eins); ok(sl(w, konsole()).y === 20 && sl(w, konsole()).richtung === 'runter', 'Konsole (2D) mit verdeckter ODA: Mindestwert y 20, kein leerer Streifen');
      oda(w, drei); ok(sl(w, konsole()).y === 20, 'Konsole (2D) mit 3-zeiliger verdeckter ODA: ebenso y 20');
      const wv = neu({ Sitz: { station: true } }), voxel = (o) => konsole(Object.assign({ voxel: true }, o));
      oda(wv, eins); ok(sl(wv, voxel()).y === 16 + 20 + 4 && sl(wv, voxel()).richtung === 'runter', 'Voxel-Sitz mit ODA oben (y 16, 1 Zeile): Spalte 4 px darunter');
      oda(wv, drei); ok(sl(wv, voxel()).y === 16 + 40 + 4, 'Voxel-Sitz mit 3-zeiliger ODA: darunter');
      const wv2 = neu({ Sitz: { station: false } }); oda(wv2, eins); ok(sl(wv2, voxel()).y === 20, 'Voxel-Bild ohne Sitz-Station: die ODA liegt unter der Konsole, Mindestwert');
    }
    {
      // S2: unter der Lagetafel (ab LAGEFUNK_Y) und der Ausweich-Anzeige der Steuer, wenn sie stehen
      const voxel = (o) => konsole(Object.assign({ voxel: true }, o));
      const lage = { from: 'Oberkommando', text: 'Raeuber gesichtet bei Hex 4-4, drei Schiffe, Kurs auf Euch zu', lage: true, mehr: 0 };
      const w = neu({ Consoles: { tab: 2 } }); w.Hud.radioAktuell = () => lage;
      const cap = konsole({ me: { console: 'captain' } }), tafel = 44 + w.Hud.funkTafelHoehe(lage, null);
      ok(w.Hud.lagefunkTafelUnten(cap) === tafel && tafel > 44 + 16, 'Captain: Lagetafel steht ab y 44, Unterkante ' + tafel);
      ok(sl(w, cap).y === tafel + 4 && sl(w, cap).richtung === 'runter', 'Captain mit Lagetafel: Spalte 4 px unter der Tafel');
      const w0 = neu({ Consoles: { tab: 0 } }); w0.Hud.radioAktuell = () => lage;
      ok(sl(w0, cap).y === 20, 'Captain im Funk-Reiter (die Tafel wird dort nicht gezeichnet): Mindestwert');
      const wo = neu({ Consoles: { tab: 0 } }); wo.Hud.radioAktuell = () => lage;
      ok(sl(wo, konsole({ me: { console: 'weapons' } })).y === 20 && sl(wo, konsole()).y === 20, 'Ops und Steuer: Lagezeile einzeilig oben (y 0-11), die Spalte bleibt bei y 20');
      const wk = neu({ Consoles: { tab: 2 } }); ok(sl(wk, cap).y === 20, 'Captain ohne Lagemeldung: Mindestwert');
      const wh = neu({ Consoles: { helmAlertUnten: () => 84 } });
      ok(sl(wh, konsole()).y === 88, 'Steuer mit Ausweich-Anzeige (Unterkante 84): Spalte 4 px darunter');
      const wh0 = neu({ Consoles: { helmAlertUnten: () => 0 } }); ok(sl(wh0, konsole()).y === 20, 'Steuer ohne Anzeige: Mindestwert');
      const wvh = neu({ Sitz: { station: true }, Consoles: { helmAlertUnten: () => 84 } }); oda(wvh, eins); ok(sl(wvh, voxel()).y === 88, 'Voxel-Sitz: Ausweich-Anzeige tiefer als die ODA entscheidet');
      // die echte Funktion in consoles.js: gilt nur fuer das Bild, in dem die Steuer gezeichnet wurde
      const cs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'consoles.js'), 'utf8').split(String.fromCharCode(13)).join('');
      const mH = /helmAlertUnten\(view\) \{[^\n]*\}/.exec(cs);
      const K = mH ? vm.runInNewContext('({ helmAlertStand: { zeit: 5, unten: 84 }, ' + mH[0] + ' })') : null;
      ok(K && K.helmAlertUnten({ time: 5 }) === 84 && K.helmAlertUnten({ time: 6 }) === 0 && K.helmAlertUnten(null) === 0, 'Consoles.helmAlertUnten: Unterkante nur im selben Bild (view.time), sonst 0');
      ok(cs.includes('this.helmAlertStand = { zeit: view.time, unten };') && (cs.match(/unten = y/g) || []).length === 3, 'consoles.js helmAlerts merkt sich die Unterkante von Ausweichen, Ladung und Lanze');
    }
    {
      // 1280 und 1920: dieselben Rasterwerte (die Spalte kennt keine Pixel)
      const a = neu({ Client: { scale: 2 } }), b = neu({ Client: { scale: 3 } });
      oda(a, drei); oda(b, drei);
      ok(eq(sl(a, fuss()), sl(b, fuss())) && eq(sl(a, konsole()), sl(b, konsole())), '1280 (Skala 2) und 1920 (Skala 3): sprechSlot liefert dieselben Rasterwerte');
      ok(!/innerWidth|innerHeight|devicePixelRatio|Client\.scale/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hud.js'), 'utf8').split('BOT-04 C2: Sprechspalte')[1].split('M1: Ortsname bei Ankunft')[0]), 'hud.js-Sprechspalte rechnet nirgends mit Pixeln oder Skala');
    }
    // Dauer und Stapel
    {
      const w = neu(), H = w.Hud;
      const dauer = (n) => H.crewFunkDauer('x'.repeat(n));
      ok(dauer(1) === 3 && dauer(7) === 3 && Math.abs(dauer(60) - 6.5) < 1e-9 && dauer(150) === 8 && dauer(400) === 8, 'Dauer = clamp(2,5 + Zeichen/15, 3, 8): ' + [1, 7, 60, 150, 400].map(dauer).join('/'));
      H.sprechAn(true);
      const i1 = H.pushCrewFunk('Eins', 'OPS', '#fff'), i2 = H.pushCrewFunk('Zwei', 'OPS', '#fff'), i3 = H.pushCrewFunk('Drei', 'OPS', '#fff');
      ok(H.sprech.eintraege.map((e) => e.text).join() === 'Zwei,Drei' && i1 < i2 && i2 < i3, 'Stapel hoechstens 2 Eintraege, der aelteste faellt raus');
      H.pushCrewFunk('Zwei', 'OPS', '#fff'); ok(H.sprech.eintraege.map((e) => e.text).join() === 'Drei,Zwei', 'derselbe Text wiederholt sich nicht doppelt, sondern rueckt nach vorn');
      const e = H.sprech.eintraege.at(-1); ok(e.d === 3 && e.lines.length === 1 && e.w === 10 + R.measure('OPS:') + R.measure('Zwei') + 6, 'Eintrag: Dauer 3 s, Breite = Inhalt + 16');
      const lang = H.pushCrewFunk(('wort ').repeat(80), 'TECHNIK', '#fff'); const el = H.sprech.eintraege.at(-1);
      ok(el.id === lang && el.lines.length === 2 && el.w <= 284 && el.h === 22, 'langer Text: hoechstens 2 Zeilen, Breite hoechstens 284');
      H.pushCrewFunk('Bitte wiederholen', 'BORD', '#fff', 2.5); ok(H.sprech.eintraege.at(-1).d === 2.5, 'Dauer 2,5 s fuer "Bitte wiederholen" (explizit)');
      H.sprechAn(false); ok(H.sprech.eintraege.length === 0 && H.sprech.aktiv === false, 'sprechAn(false) raeumt auf');
    }
    // S3a: Dedupe ohne Stapelueberlauf (zwei gleiche Eintraege nebeneinander wuerden sonst bleiben), nur bei gleichem Sprecher
    {
      const w = neu(), H = w.Hud; H.sprechAn(true);
      const a1 = H.pushCrewFunk('Aye', 'OPS', '#fff'), a2 = H.pushCrewFunk('Aye', 'OPS', '#fff');
      ok(H.sprech.eintraege.length === 1 && H.sprech.eintraege[0].id === a2 && a2 > a1, 'derselbe Text vom selben Sprecher: ein Eintrag (der neue), auch ohne Ueberlauf');
      H.pushCrewFunk('Aye', 'TECHNIK', '#fff'); ok(H.sprech.eintraege.length === 2, 'derselbe Text von einem anderen Sprecher: zwei Eintraege');
    }
    // S3b: der Clip-Halt trifft nur den Eintrag mit der Kennung
    {
      const w = neu(), H = w.Hud; H.sprechAn(true); tMs = 100000;
      const ia = H.pushCrewFunk('Erster', 'OPS', '#fff'), ib = H.pushCrewFunk('Zweiter', 'OPS', '#fff');
      H.crewFunkHalte(ia, true);
      ok(H.sprech.eintraege.find((e) => e.id === ia).halt === true && H.sprech.eintraege.find((e) => e.id === ib).halt === false, 'Halt: nur der Eintrag mit der Kennung ist gehalten, der andere nicht');
      tMs += 20000; calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      ok(calls.some((c) => c.s === 'Erster') && !calls.some((c) => c.s === 'Zweiter'), '20 s spaeter: der gehaltene steht noch, der andere ist abgelaufen');
      H.crewFunkHalte(ia, false); ok(H.sprech.eintraege.find((e) => e.id === ia).halt === false, 'Ende loest nur den eigenen Eintrag');
    }
    // H4: sehr lange Server-Texte: gekappt, nicht O(n^2) im Messen, zweite Zeile nicht mitten im Wort
    {
      let zaehl = 0;
      const Rz = Object.assign({}, R, { measure: (t) => { zaehl++; return String(t == null ? '' : t).length * 6; } });
      const w = neu({ Render: Rz }), H = w.Hud; H.sprechAn(true);
      H.pushCrewFunk('x'.repeat(100000), 'OPS', '#fff'); const m1 = zaehl;
      ok(H.sprech.eintraege.at(-1).text.length === 300 && m1 < 1500, 'ein Wort mit 100000 Zeichen: auf 300 gekappt, ' + m1 + ' Messungen (< 1500)');
      zaehl = 0; H.pushCrewFunk('wort '.repeat(5000), 'TECHNIK', '#fff'); const m2 = zaehl, el = H.sprech.eintraege.at(-1);
      ok(el.text.length === 300 && m2 < 1500 && el.lines.length === 2, '5000 Woerter: auf 300 gekappt, ' + m2 + ' Messungen (< 1500), zwei Zeilen');
      H.pushCrewFunk('abcdefg '.repeat(5000), 'TECHNIK', '#fff'); const l2 = H.sprech.eintraege.at(-1).lines[1];
      ok(/^(abcdefg )*abcdefg …$/.test(l2), 'zweite Zeile endet am Wortende mit "…", nicht mitten im Wort: "' + l2 + '"');
      H.pushCrewFunk('Kurz', 'OPS', '#fff'); ok(H.sprech.eintraege.at(-1).lines.join() === 'Kurz', 'kurzer Text bleibt unveraendert');
    }
    // Ablauf: Ausblenden, Clip haelt den Untertitel
    {
      const w = neu(), H = w.Hud; H.sprechAn(true); tMs = 10000;
      const id = H.pushCrewFunk('Aye', 'OPS', '#fff');   // 3 s
      const stand = (dt) => { tMs = 10000 + dt * 1000; calls.length = 0; H.zeichneSprechspalte(ctx, fuss()); return calls.some((c) => c.n === 'text' && c.s === 'Aye'); };
      ok(stand(0.1) && stand(2.5), 'Untertitel steht seine Dauer');
      tMs = 10000 + 2800; calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      const ga = calls.filter((c) => c.n === 'backdrop').map((c) => c.ga);
      ok(ga.length === 1 && Math.abs(ga[0] - 0.5) < 1e-6, 'letzte 0,4 s: ausblenden (bei 0,2 s Rest halbe Deckkraft)');
      ok(!stand(3.05), 'nach der Dauer ist er weg');
      const id2 = H.pushCrewFunk('Lang', 'OPS', '#fff'); tMs = 10000 + 3050; const t0 = tMs;
      H.crewFunkHalte(id2, true); tMs = t0 + 20000; calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      ok(calls.some((c) => c.s === 'Lang'), 'Clip laeuft laenger: Untertitel bleibt (20 s spaeter noch da)');
      H.crewFunkHalte(id2, false); tMs += 400; calls.length = 0; H.zeichneSprechspalte(ctx, fuss()); ok(calls.some((c) => c.s === 'Lang'), 'nach Clip-Ende noch 0,5 s (bei 0,4 s noch da)');
      tMs += 200; calls.length = 0; H.zeichneSprechspalte(ctx, fuss()); ok(!calls.some((c) => c.s === 'Lang'), 'und dann weg (0,6 s)');
      const id3 = H.pushCrewFunk('Kurzer Clip', 'OPS', '#fff'); const t1 = tMs; H.crewFunkHalte(id3, true); tMs = t1 + 1000; H.crewFunkHalte(id3, false); tMs = t1 + 2900;
      calls.length = 0; H.zeichneSprechspalte(ctx, fuss()); ok(calls.some((c) => c.s === 'Kurzer Clip'), 'kuerzer als die Grunddauer: Grunddauer gilt (3 s)');
      const id4 = H.pushCrewFunk('Haengt', 'OPS', '#fff'); const t2 = tMs; H.crewFunkHalte(id4, true); tMs = t2 + 31000; calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      ok(!calls.some((c) => c.s === 'Haengt'), 'bleibt das Clip-Ende aus, haelt der Untertitel hoechstens 30 s');
    }
    // Zeichnen: Reihenfolge, Spalte, Aufnahme ersetzt den untersten Platz, Textzeile
    {
      const w = neu(), H = w.Hud; H.sprechAn(true); tMs = 50000;
      calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      ok(calls.length === 0, 'aktiv, aber nichts zu zeigen: es wird nichts gezeichnet');
      H.pushCrewFunk('Erster', 'OPS', '#A9D6E5'); H.pushCrewFunk('Zweiter', 'OPS', '#A9D6E5');
      calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      const bd = calls.filter((c) => c.n === 'backdrop');
      ok(bd.length === 2 && bd.every((b) => b.a === 0.85 && b.x >= 178 && b.x + b.w <= 462), '2 Untertitel, Untergrund 0,85, innerhalb der Spalte x 178..462');
      const tz = (s) => calls.find((c) => c.n === 'text' && c.s === s);
      ok(tz('Zweiter').y > tz('Erster').y && tz('Zweiter').y + 10 <= 354, 'zu Fuss: der neueste unten, der aeltere darueber, nichts unter VH - 6');
      ok(tz('OPS:').o.color === '#A9D6E5' && tz('Zweiter').o.color === '#F4EEDC' && tz('Zweiter').o.shadow === false, 'Name in Sprecherfarbe, Text Creme, ohne Schatten');
      ok(calls.some((c) => c.n === 'fillRect' && c.w === 2 && c.c === '#A9D6E5'), '2-px-Farbbalken links');
      // Aufnahme ersetzt den untersten Untertitel-Platz
      H.sprech.aufnahme = true; calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      ok(!tz('Erster') && !!tz('Zweiter') && !!tz('FUNK OFFEN') && tz('FUNK OFFEN').o.color === '#FFC66B', 'Aufnahme: "FUNK OFFEN" in Gold, ersetzt den untersten Platz (nur 1 Untertitel daneben)');
      ok(tz('FUNK OFFEN').y > tz('Zweiter').y, 'Aufnahme-Anzeige steht unten (zu Fuss), Untertitel darueber');
      ok(calls.some((c) => c.n === 'strokeRect' && c.c === '#FFC66B' && c.h === 11) && calls.some((c) => c.n === 'backdrop' && c.h === 12), '1-px-Goldrahmen, Hoehe 12 (Rahmenlinie y + 0,5, Hoehe 11)');
      H.sprech.aufnahme = false; H.sprech.verarbeitet = true; calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      ok(!!tz('…') && tz('…').o.color === '#8EA3B5', 'nach dem Loslassen: "…" in neutral');
      H.sprech.verarbeitet = false;
      // Textzeile
      const platz = []; const feld = { value: '', selectionStart: 0 };
      H.sprech.zeile = { offen: true, feld, platzhalter: 'Befehl an die Crew · Enter senden · Esc zu', platziere: (r) => platz.push(r) };
      calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      ok(eq(platz.at(-1), { x: 178, y: 354 - 14, w: 284, h: 14 }), 'Textzeile ganz unten in der Spalte (Unterkante VH - 6), 284 breit, 14 hoch; platziere() bekommt das Rasterrechteck');
      ok(!!tz(H.sprech.zeile.platzhalter) && tz(H.sprech.zeile.platzhalter).o.color === '#8EA3B5', 'leer: Platzhalter in neutral');
      ok(calls.some((c) => c.n === 'strokeRect' && c.c === '#FFC66B' && c.h === 13 && c.w === 283), 'Kasten mit 1-px-Rahmen in Gold');
      ok(tz('Zweiter').y + 10 <= platz.at(-1).y, 'Untertitel stapeln sich von der Textzeile weg (darueber)');
      feld.value = 'Schilde'; feld.selectionStart = 7; calls.length = 0; H.zeichneSprechspalte(ctx, fuss(Object.assign({ time: 0 })));
      ok(!!tz('Schilde') && tz('Schilde').o.color === '#F4EEDC' && calls.some((c) => c.n === 'fillRect' && c.w === 4 && c.h === 7 && c.x === 178 + 5 + 7 * 6 + 1), 'Text creme, Block-Cursor 4x7 an selectionStart');
      feld.value = 'x'.repeat(120); feld.selectionStart = 120; calls.length = 0; H.zeichneSprechspalte(ctx, fuss({ time: 0 }));
      const cur = calls.find((c) => c.n === 'fillRect' && c.w === 4 && c.h === 7);
      ok(cur && cur.x + 4 <= 178 + 284 - 1, 'lange Eingabe (120 Zeichen): Cursor bleibt im Kasten');
      H.sprech.zeile.offen = false; feld.value = '';
      // Konsole: Spalte oben, Textzeile ganz oben, Untertitel darunter
      calls.length = 0; platz.length = 0; H.sprech.zeile.offen = true; H.zeichneSprechspalte(ctx, konsole());
      ok(eq(platz.at(-1), { x: 178, y: 20, w: 284, h: 14 }) && tz('Zweiter').y > platz.at(-1).y + 14, 'Konsole: Textzeile ganz oben (y 20), Untertitel darunter');
      H.sprech.zeile.offen = false; H.sprech.aufnahme = true; calls.length = 0; H.zeichneSprechspalte(ctx, konsole());
      ok(tz('FUNK OFFEN').y < tz('Zweiter').y, 'Konsole: Aufnahme-Anzeige oben, Untertitel darunter');
      // Nichts ueberdeckt: alles unterhalb der ODA (zu Fuss) bzw. ab Spaltenanfang (Konsole)
      H.sprech.aufnahme = false; oda(w, eins); calls.length = 0; H.zeichneSprechspalte(ctx, fuss());
      ok(calls.filter((c) => c.n === 'backdrop').every((b) => b.y + b.h <= 354 - 20 - 4), 'zu Fuss mit ODA: alle Kacheln enden 4 px ueber der ODA');
      const wvz = neu({ Sitz: { station: true } }), Hv = wvz.Hud; Hv.sprechAn(true); Hv.pushCrewFunk('Eins', 'OPS', '#fff'); Hv.pushCrewFunk('Zwei', 'OPS', '#fff'); oda(wvz, eins);
      calls.length = 0; Hv.zeichneSprechspalte(ctx, konsole({ voxel: true }));
      ok(calls.filter((c) => c.n === 'backdrop').length === 2 && calls.filter((c) => c.n === 'backdrop').every((b) => b.y >= 16 + 20 + 4), 'Voxel-Sitz mit ODA: alle Kacheln beginnen 4 px unter der ODA');
    }
    // Einbindung in draw(): auch an der Konsole, ohne Bot-Sprache nichts
    {
      const w = neu(), H = w.Hud; const n = { sprech: 0, barks: 0 };
      for (const k of ['drawAwayHud', 'drawShipHud', 'drawObjectives', 'drawAbenteuerStreifen', 'drawPlanningLine', 'drawInteraction', 'drawCarry', 'drawRadio', 'drawEscortStrip', 'drawAlliesStrip', 'drawBefehlStrip', 'drawReactorHint', 'drawArrival', 'drawOda', 'drawNotices', 'drawCrew', 'drawWellen']) H[k] = () => 0;
      H.drawBarks = () => { n.barks++; }; H.zeichneSprechspalte = () => { n.sprech++; };
      H.draw(ctx, fuss()); H.draw(ctx, konsole());
      ok(n.sprech === 0 && n.barks === 1, 'Sprache aus (Standard): die Sprechspalte wird nie aufgerufen; Barks wie bisher nur zu Fuss');
      H.sprechAn(true); H.draw(ctx, fuss()); H.draw(ctx, konsole());
      ok(n.sprech === 1 && n.barks === 2, 'Sprache an: Sprechspalte in draw() nur zu Fuss (Barks bleiben an der Konsole aus)');
      const cl = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'client.js'), 'utf8').split(String.fromCharCode(13)).join('');
      const iK = cl.indexOf("Net.guard('Hud.sprechspalteKonsole', () => H.zeichneSprechspalte(ctx, v))");
      ok(iK > cl.indexOf("Net.guard('Sitz.draw'") && iK > cl.indexOf("Net.guard('Consoles.draw'") && cl.slice(iK - 70, iK).includes('if (H.sprech.aktiv || H.sprech.bots)') && cl.indexOf('if (v.me.console) {') < iK && iK < cl.indexOf("Net.guard('Funkwahl.zeichne'"), 'client.js: an der Konsole wird die Sprechspalte NACH der Konsole gezeichnet (nur mit Sprache an oder Bots im Spiel, BOT-01 C3), sonst laege die Konsole darueber');
      H.sprech.tFrame = tMs; ok(H.sprechBereit(), 'sprechBereit: nach einem gezeichneten Bild bereit'); tMs += 600; ok(!H.sprechBereit(), 'und nicht mehr, wenn kein Bild mehr gezeichnet wird');
      const w3 = neu(); const H3 = w3.Hud; ok(H3.sprech.aktiv === false && H3.sprech.eintraege.length === 0 && H3.sprech.zeile === null && !H3.sprechBereit(), 'Standardzustand: aus, leer, nicht bereit');
      // update: Textzeile ohne Spielbild schliesst
      const w4 = neu(), H4 = w4.Hud; H4.sprechAn(true); let zu = 0; H4.sprech.zeile = { offen: true, schliessen: () => { zu++; } }; H4.sprech.tFrame = 0; tMs = 5000;
      H4.update(0.016); ok(zu === 1, 'ohne gezeichnetes Spielbild (Lobby/Menue) schliesst update() die Textzeile');
      // S3d: die Grenze liegt bei 1500 ms ohne Spielbild
      const w5 = neu(), H5 = w5.Hud; H5.sprechAn(true); let zu5 = 0; H5.sprech.zeile = { offen: true, schliessen: () => { zu5++; } }; H5.sprech.tFrame = 10000; tMs = 11400;
      H5.update(0.016); const bei1400 = zu5; tMs = 11600; H5.update(0.016);
      ok(bei1400 === 0 && zu5 === 1, 'Textzeile: bei 1,4 s ohne Spielbild noch offen, bei 1,6 s geschlossen');
      // H2: ein Overlay (Menue, Minispiel, Terminal-Zusehen) schliesst die offene Zeile, auch mit gezeichnetem Spielbild
      let ef = true; const w6 = neu({ Client: { eingabeFrei: () => ef } }), H6 = w6.Hud; H6.sprechAn(true); let zu6 = 0; H6.sprech.zeile = { offen: true, schliessen: () => { zu6++; } }; tMs = 20000; H6.sprech.tFrame = tMs;
      H6.update(0.016); ok(zu6 === 0, 'Eingabe frei: die Zeile bleibt offen'); ef = false; H6.update(0.016); ok(zu6 === 1, 'ein Overlay ging auf: update() schliesst die Textzeile');
    }
  }

  console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})();
