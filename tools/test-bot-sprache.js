'use strict';
// BOT-04 C: Client-Kern der Bot-Sprache (public/js/bot-sprache.js) ohne Browser, Mikrofon und Netz (Fake-Umgebung, Fake-Matcher).
//  a) Sprache aus (Standard): kein getUserMedia, kein fetch, kein Zuhoerer, der Lader bindet nichts ein
//  b) Matcher null (unklar): KEIN bot.befehl, Rueckfrage-Clip bot.unklar, fehlt er: Untertitel "Bitte wiederholen"
//  c) Aufnahme nur zwischen Tastendruck und -loslassen (Fokusverlust, zu kurz, zu frueh losgelassen, Echo-Stummschaltung)
//  d) STT faellt aus / Mikrofon fehlt: sichtbare Meldung, Textzeile und Tasten laufen weiter
//  e) Clipwahl, Texteingabe, Messmodus, Tastenbelegung, DOM-Anzeige (Fake-DOM, nur Rauchprobe)
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
      spiele: (urls) => { L.ereignisse.push('clip'); L.clips.push(urls); return Promise.resolve(o.clipDa ? urls[0] : null); },
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
    ok(L.clips.length === 1 && L.clips[0].some((u) => /\/b0\/|\/navigation\/bot\.unklar\.ogg$/.test(u)) && L.clips[0][0].endsWith('/bot.unklar.ogg'), 'Clip bot.unklar wird versucht: ' + L.clips[0]);
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
    ok(eq(BS.clipKandidaten('nav.stopp.ok', 'navigation', 1), ['/assets/bots/stimmen/navigation/nav.stopp.ok.1.ogg', '/assets/bots/stimmen/navigation/nav.stopp.ok.1.wav', '/assets/bots/stimmen/navigation/nav.stopp.ok.ogg', '/assets/bots/stimmen/navigation/nav.stopp.ok.wav']), 'Clipwahl mit Variante: Variante zuerst (ogg vor wav), dann ohne Variante');
    ok(eq(BS.clipKandidaten('bot.unklar', 'ops'), ['/assets/bots/stimmen/ops/bot.unklar.ogg', '/assets/bots/stimmen/ops/bot.unklar.wav']), 'Clipwahl ohne Variante');
    const { env, L } = fake(); const k = BS.erzeuge(env); k.schalte(true);
    k.empfange({ t: 'bot.antwort', botId: 'b1', befehl: 'ops.scan', status: 'ok', textId: 'ops.scan.ok', text: 'Aye, scanne.', variante: 0 });
    ok(L.clips[0][0] === '/assets/bots/stimmen/b1/ops.scan.ok.0.ogg' && L.ereignisse.join() === 'untertitel,clip', 'bot.antwort: Untertitel und Clip im selben Schritt, Stimme nach botId');
    k.empfange({ t: 'bot.antwort', botId: 'b9', textId: 'x.ok', stimme: 'kara' });
    ok(L.clips.at(-1)[0] === '/assets/bots/stimmen/kara/x.ok.ogg' && L.untertitel.at(-1) === 'x.ok', 'msg.stimme hat Vorrang; ohne text zeigt der Untertitel die textId');
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

    // Anzeige (Fake-DOM, nur Rauchprobe: baut auf, zeigt Aufnahme nur auf Zuruf, Textzeile verschluckt Tasten)
    const elemente = [];
    const mk = (tag) => { const e = { tag, style: {}, children: [], listeners: {}, textContent: '', attrs: {}, value: '', appendChild(c) { this.children.push(c); }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute(k, v) { this.attrs[k] = v; }, focus() { this.fokus = true; }, blur() { this.fokus = false; }, remove() { this.entfernt = true; } }; elemente.push(e); return e; };
    const doc = { createElement: mk, body: mk('body') };
    const gesendet = [];
    const an = BS.baueAnzeige({ document: doc }, (t) => gesendet.push(t), () => {});
    ok(an.wurzel.style.pointerEvents === 'none', 'Anzeige faengt keine Mausklicks ab (nur die Textzeile)');
    const rec = an.wurzel.children[2];
    ok(rec.style.display === 'none' && /AUFNAHME/.test(rec.textContent), 'Aufnahme-Anzeige: zunaechst unsichtbar, Wort statt nur Farbe');
    an.aufnahme(true); ok(rec.style.display === 'block', 'Aufnahme-Anzeige an'); an.aufnahme(false); ok(rec.style.display === 'none', 'Aufnahme-Anzeige aus');
    an.untertitel('Aye'); ok(an.wurzel.children[0].textContent === 'Aye' && an.wurzel.children[0].style.display === 'block', 'Untertitel sichtbar');
    an.meldung('Fehler'); ok(an.wurzel.children[1].style.display === 'block'); an.meldung(null); ok(an.wurzel.children[1].style.display === 'none', 'Meldung ein und aus');
    let gestoppt = 0; an.feld.listeners.keydown[0]({ stopPropagation: () => { gestoppt++; }, key: 'w' });
    ok(gestoppt === 1, 'Tasten in der Textzeile erreichen das Spiel nicht (stopPropagation)');
    an.feld.value = 'Feuer frei'; an.wurzel.children[3].listeners.submit[0]({ preventDefault() {} });
    ok(gesendet[0] === 'Feuer frei' && an.feld.value === '', 'Absenden gibt den Text weiter und leert das Feld');
    an.messung({ index: 0, phrasen: [{ id: 'p1', text: 'Alle stopp' }], eintraege: [] }); ok(elemente.some((x) => /MESSUNG/.test(x.textContent)), 'Messansicht wird aufgebaut');
  }

  console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})();
