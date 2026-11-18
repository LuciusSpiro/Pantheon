// BOT-04 C: Sprache zu den Bots – Sprechtaste (Push-to-talk), Aufnahme, STT, Matcher, Untertitel und Clips, dazu die Chat-Zeile und der Messmodus (?botmessung=1).
// Schichten (Kais 3-Layer-Regel): `erzeuge(env)` ist der Kern ohne DOM und ohne Netz (Zustand, Regeln, Ablauf) und ohne Browser testbar (tools/test-bot-sprache.js);
// alles Browser-Spezifische (Mikrofon, Audio, fetch, DOM) steckt in Adaptern am Ende, die `starte()` zusammensetzt. Globales `BotSprache` (nur im Browser, wenn geladen).
// GELADEN WIRD ES NUR AUF WUNSCH: public/js/bot-sprache-start.js bindet das Skript erst ein, wenn die Bot-Sprache in den Optionen an ist (oder ?botsprache=1, ?botmock, ?botmessung=1).
// Ist die Sprache aus, gibt es kein getUserMedia, keinen Netzaufruf und keine Zuhörer.
//
// Ablauf Sprache:  Taste halten (MediaRecorder läuft nur dann) -> loslassen -> POST /api/stt (Audio roh) -> Text -> Matcher -> bot.befehl { an, befehl, args, quelle: 'sprache' }
// Ablauf Text:     Chat-Zeile -> Matcher -> bot.befehl { …, quelle: 'text' }
// Matcher unklar (null): KEIN bot.befehl; stattdessen Clip bot.unklar (fehlt er: Untertitel „Bitte wiederholen“).
// Antwort:         bot.antwort -> Untertitel immer, Clip assets/bots/stimmen/<stimme>/<textId>[.<variante>].ogg|wav wenn vorhanden (sonst nur Untertitel). Solange die Sprechtaste gehalten wird, bleibt die Wiedergabe stumm (Echo).
// Nachrichten tragen das Typfeld `t` ('bot.befehl' / 'bot.antwort'); der Matcher kommt aus shared/bot-matcher.js: match(text, opts?) -> { an, befehl, args, konfidenz } | null (Global Shared_BotMatcher, UMD wie Shared_Protocol).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BotSprache = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TEXT = {
    unklar: 'Bitte wiederholen',
    sttAus: 'Sprache nicht erreichbar – Menü, Tasten und Textzeile laufen weiter.',
    mikro: 'Mikrofon nicht verfügbar – Textzeile und Tasten laufen weiter.',
    keinMatcher: 'Befehlsabgleich nicht geladen.',
    keinBotServer: 'Kein Bot-Server verbunden.',
    zuKurz: 'Zu kurz – Taste halten und dabei sprechen.',
    messungFehler: 'Messung nicht gespeichert.',
    aufnahme: 'AUFNAHME LÄUFT',
    platzhalter: 'Befehl an die Crew, Enter sendet',
  };
  const STIMMEN = { b0: 'b0', b1: 'b1', b2: 'b2', b3: 'b0' };   // Ordnername im Clip-Vorrat je botId (Kai 2026-11-18: drei Stimmen b0 bis b2, mehr als 3 Bots gibt es nicht; b3 fällt auf b0 zurück); env.stimmen oder msg.stimme überschreiben
  const MIN_MS = 250;                                                          // kürzere Aufnahmen sind versehentliche Tastenkontakte
  const CLIP_BASIS = '/assets/bots/stimmen';
  const ENDUNGEN = ['ogg', 'wav'];

  // ------------------------------------------------------------------ rein: Clipwahl und Messvergleich
  // Kandidaten in Reihenfolge: genau die Variante des Untertitels zuerst, dann der Clip ohne Variante; ogg vor wav. Die Wiedergabe nimmt den ersten, der existiert.
  function clipKandidaten(textId, stimme, variante, basis) {
    const b = (basis || CLIP_BASIS) + '/' + stimme + '/' + textId, out = [];
    if (Number.isInteger(variante) && variante >= 0) for (const e of ENDUNGEN) out.push(b + '.' + variante + '.' + e);
    for (const e of ENDUNGEN) out.push(b + '.' + e);
    return out;
  }
  // richtig = gleicher Befehl, alle erwarteten Argumente (als Text verglichen) und, falls erwartet, gleicher Adressat
  function erwartungErfuellt(erwartet, res) {
    if (!res || !res.befehl || !erwartet) return false;
    if (res.befehl !== erwartet.befehl) return false;
    if (erwartet.an && res.an !== erwartet.an) return false;
    return Object.keys(erwartet.args || {}).every((k) => String(res.args && res.args[k]) === String(erwartet.args[k]));
  }

  // ------------------------------------------------------------------ Kern
  // env: { transport: { send(obj) -> bool, onMessage(fn) -> abmelden }, matcher: () -> { match } | Promise, stt: (blob, mime) -> Promise<text>,
  //        mikrofon: { start() -> Promise<{ stop() -> Promise<{ blob, mime, dauerMs }>, abbruch() }> }, audio: { spiele(urls) -> Promise<url|null>, stumm(bool), stopp() },
  //        anzeige: { aufnahme(bool), untertitel(text), meldung(text|null), messung?(zustand) }, uhr?: () -> ms, stimmen?, clipBasis?, postMessung?: (sitzung, eintrag) -> Promise }
  function erzeuge(env) {
    const uhr = env.uhr || (() => Date.now());
    const stimmen = Object.assign({}, STIMMEN, env.stimmen || {});
    const A = env.anzeige;
    const s = { an: false, aufnahme: false, gehalten: false, lauf: 0, handle: null, start: null, abmelden: null, letzte: Promise.resolve(), messmodus: null };

    const stimmeFuer = (x) => (x && x.stimme) || stimmen[x && x.botId ? x.botId : x] || String(x && x.botId ? x.botId : x || 'b0');
    const meldung = (t) => { try { A.meldung(t); } catch (e) { /* Anzeige darf den Ablauf nie brechen */ } };

    function schalte(an) {
      an = !!an;
      if (an === s.an) return s.an;
      s.an = an;
      if (an) { s.abmelden = env.transport.onMessage(empfange); }
      else { abbrechen(); if (s.abmelden) { s.abmelden(); s.abmelden = null; } meldung(null); if (A.aus) A.aus(); }
      return s.an;
    }

    // ---- Sprechtaste: Aufnahme NUR zwischen Drücken und Loslassen
    function tasteRunter() {
      if (!s.an || s.aufnahme) return false;
      s.aufnahme = true; s.gehalten = true;
      const lauf = ++s.lauf;
      env.audio.stumm(true); env.audio.stopp();   // Echo: nichts abspielen, solange gesprochen wird
      s.start = (async () => {
        try {
          const h = await env.mikrofon.start();
          if (!s.gehalten || s.lauf !== lauf || !s.an) { try { await h.abbruch(); } catch (e) { /* egal */ } return null; }   // schon losgelassen: sofort wieder zu
          s.handle = h; A.aufnahme(true);
          return h;
        } catch (e) {
          if (s.lauf === lauf) { s.aufnahme = false; s.gehalten = false; env.audio.stumm(false); A.aufnahme(false); }
          meldung(TEXT.mikro);
          return null;
        }
      })();
      return true;
    }
    function tasteHoch() {
      if (!s.aufnahme) return Promise.resolve(false);   // außerhalb der Taste passiert nichts
      s.aufnahme = false; s.gehalten = false;
      A.aufnahme(false); env.audio.stumm(false);
      const t0 = uhr(), start = s.start; s.handle = null;
      s.letzte = (async () => {
        const h = await start;
        if (!h) return false;
        let aufn; try { aufn = await h.stop(); } catch (e) { meldung(TEXT.mikro); return false; }
        return verarbeiteAufnahme(aufn, t0);
      })().catch(() => false);
      return s.letzte;
    }
    function abbrechen() {   // Fokusverlust, Sprache aus: Aufnahme verwerfen, nichts senden
      if (!s.aufnahme) return false;
      s.aufnahme = false; s.gehalten = false; s.lauf++;
      const h = s.handle; s.handle = null;
      A.aufnahme(false); env.audio.stumm(false);
      if (h) { try { h.abbruch(); } catch (e) { /* egal */ } }
      return true;
    }

    async function matcher() { try { return (await env.matcher()) || null; } catch (e) { return null; } }
    async function gleiche(text) { const m = await matcher(); if (!m) return { fehlt: true }; try { return { res: m.match(text) || null }; } catch (e) { return { res: null }; } }

    async function verarbeiteAufnahme(aufn, t0) {
      if (!aufn || !aufn.blob || !(aufn.blob.size > 0) || (aufn.dauerMs != null && aufn.dauerMs < MIN_MS)) { meldung(TEXT.zuKurz); return false; }
      const tStt0 = uhr();
      let text;
      try { text = await env.stt(aufn.blob, aufn.mime); } catch (e) { meldung(TEXT.sttAus); return false; }
      const tText = uhr();
      meldung(null);
      text = String(text == null ? '' : text).trim();
      const g = text ? await gleiche(text) : { res: null };
      if (g.fehlt) { meldung(TEXT.keinMatcher); return false; }
      const tMatcher = uhr();
      if (s.messmodus) return messeEin({ text, res: g.res, t_stt_ms: tText - tStt0, t_text_ms: tText - t0, t_matcher_ms: tMatcher - t0, dauer_aufnahme_ms: aufn.dauerMs == null ? null : Math.round(aufn.dauerMs) });
      return ergebnis(g.res, 'sprache');
    }

    // ---- Texteingabe (Chat-Zeile) als Gegenstück
    async function sendeText(text) {
      if (!s.an) return false;
      text = String(text == null ? '' : text).trim();
      if (!text) return false;
      const g = await gleiche(text);
      if (g.fehlt) { meldung(TEXT.keinMatcher); return false; }
      return ergebnis(g.res, 'text');
    }

    // ---- Ergebnis des Matchers: Befehl senden oder (unklar) Rückfrage
    function ergebnis(res, quelle) {
      if (!res || typeof res.befehl !== 'string' || !res.befehl) return unklar();   // unter der Schwelle: nichts senden
      const msg = { t: 'bot.befehl', an: res.an, befehl: res.befehl, quelle };
      if (res.args !== undefined && res.args !== null) msg.args = res.args;
      let ok = false;
      try { ok = env.transport.send(msg) !== false; } catch (e) { ok = false; }
      if (!ok) { meldung(TEXT.keinBotServer); return false; }
      meldung(null);
      return true;
    }
    async function unklar() {
      let url = null;
      try { url = await env.audio.spiele(clipKandidaten('bot.unklar', stimmeFuer('b0'), null, env.clipBasis)); } catch (e) { url = null; }
      if (!url) A.untertitel(TEXT.unklar);   // Clip fehlt: Untertitel statt Ton
      return false;
    }

    // ---- bot.antwort: Untertitel und Clip gleichzeitig; fehlt der Clip, bleibt der Untertitel
    function empfange(msg) {
      if (!s.an || !msg || msg.t !== 'bot.antwort') return false;
      A.untertitel(typeof msg.text === 'string' && msg.text ? msg.text : String(msg.textId || ''));
      if (!s.aufnahme && msg.textId) {   // gehaltene Sprechtaste = Mikrofon offen: nichts abspielen
        const urls = clipKandidaten(msg.textId, stimmeFuer(msg), msg.variante, env.clipBasis);
        try { Promise.resolve(env.audio.spiele(urls)).catch(() => null); } catch (e) { /* nur Untertitel */ }
      }
      return true;
    }

    // ---- Messmodus: je Aufnahme Rohtext, Matcher-Ergebnis, Konfidenz, Zeiten; es wird KEIN bot.befehl gesendet
    function setzeMessmodus(m) {
      s.messmodus = m ? { phrasen: m.phrasen || [], sitzung: m.sitzung, index: 0, eintraege: [], post: m.post || env.postMessung || null } : null;
      zeigeMessung();
    }
    const aktuellePhrase = () => (s.messmodus ? s.messmodus.phrasen[s.messmodus.index] || null : null);
    function zeigeMessung() { if (A.messung) { try { A.messung(messungStand()); } catch (e) { /* egal */ } } }
    function messungStand() {
      const m = s.messmodus; if (!m) return null;
      return { index: m.index, phrasen: m.phrasen, eintraege: m.eintraege.slice() };
    }
    function messeWeiter(d) {
      const m = s.messmodus; if (!m || !m.phrasen.length) return false;
      m.index = Math.max(0, Math.min(m.phrasen.length - 1, m.index + (d < 0 ? -1 : 1)));
      zeigeMessung(); return true;
    }
    async function messeEin(x) {
      const m = s.messmodus, p = aktuellePhrase();
      const res = x.res;
      const eintrag = {
        zeit: new Date().toISOString(), phraseId: p ? p.id : null, phrase: p ? p.text : null, erwartet: p ? p.erwartet : null,
        rohtext: x.text, ergebnis: res ? { an: res.an, befehl: res.befehl, args: res.args || null } : null, konfidenz: res && res.konfidenz != null ? res.konfidenz : null,
        richtig: p ? erwartungErfuellt(p.erwartet, res) : null,
        t_stt_ms: Math.round(x.t_stt_ms), t_text_ms: Math.round(x.t_text_ms), t_matcher_ms: Math.round(x.t_matcher_ms), dauer_aufnahme_ms: x.dauer_aufnahme_ms,   // t_text: Loslassen -> Text (Aufnahme beenden + STT), t_matcher: Loslassen -> Matcher fertig
      };
      m.eintraege.push(eintrag);
      zeigeMessung();
      if (m.post) { try { await m.post(m.sitzung, eintrag); } catch (e) { meldung(TEXT.messungFehler); } }
      return eintrag;
    }

    return {
      schalte, tasteRunter, tasteHoch, abbrechen, sendeText, empfange, setzeMessmodus, messeWeiter, aktuellePhrase,
      istAn: () => s.an, lies: () => ({ an: s.an, aufnahme: s.aufnahme }), warte: () => s.letzte, clipKandidaten: (t, st, v) => clipKandidaten(t, st, v, env.clipBasis),
    };
  }

  // ================================================================== Browser-Adapter (ab hier nur mit window/document, nicht im Kerntest)
  // Transport zum Mock (?botmock=ws://localhost:8710): einfacher WebSocket mit Wiederaufbau; WS wird übergeben (Test: ws-Paket)
  function transportWebSocket(url, WS) {
    const zuhoerer = []; let ws = null, zu = false, timer = null;
    function verbinde() {
      if (zu) return;
      try { ws = new WS(url); } catch (e) { timer = setTimeout(verbinde, 3000); return; }
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } for (const f of zuhoerer.slice()) { try { f(m); } catch (e) { /* ein Zuhörer darf die anderen nicht stoppen */ } } };
      ws.onclose = () => { ws = null; if (!zu) timer = setTimeout(verbinde, 3000); };
      ws.onerror = () => { /* close folgt */ };
    }
    verbinde();
    return {
      send(obj) { if (!ws || ws.readyState !== 1) return false; ws.send(JSON.stringify(obj)); return true; },
      onMessage(fn) { zuhoerer.push(fn); return () => { const i = zuhoerer.indexOf(fn); if (i >= 0) zuhoerer.splice(i, 1); }; },
      schliessen() { zu = true; clearTimeout(timer); try { if (ws) ws.close(); } catch (e) { /* egal */ } },
      offen: () => !!(ws && ws.readyState === 1),
    };
  }
  // STUB für Paket D: der Weg über die Spielverbindung (net.js). Bis BOT-01 C den Server-Teil liefert, geht nichts hinaus (send -> false: Meldung „Kein Bot-Server verbunden“).
  // Paket D ersetzt das durch: send: (obj) => Net.send(obj), onMessage: (fn) => Net.on((m) => m.t === 'bot.antwort' && fn(m)).
  function transportNetStub() {
    return { send() { return false; }, onMessage() { return () => {}; }, schliessen() {}, offen: () => false, stub: true };
  }

  function mikrofonBrowser(win) {
    const MR = win.MediaRecorder;
    const waehleMime = () => { for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) { try { if (MR.isTypeSupported && MR.isTypeSupported(t)) return t; } catch (e) { /* weiter */ } } return ''; };
    return {
      async start() {   // Mikrofon wird je Tastendruck geöffnet und beim Loslassen wieder freigegeben (Mikrofon-Symbol des Browsers nur während der Aufnahme)
        if (!win.navigator || !win.navigator.mediaDevices || !win.navigator.mediaDevices.getUserMedia || !MR) throw new Error('kein Mikrofon');
        const stream = await win.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const mime = waehleMime(), rec = new MR(stream, mime ? { mimeType: mime } : {}), teile = [];
        const frei = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* egal */ } };
        rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) teile.push(ev.data); };
        const t0 = Date.now(); rec.start();
        return {
          stop() { return new Promise((resolve) => { rec.onstop = () => { frei(); const typ = rec.mimeType || mime || 'audio/webm'; resolve({ blob: new win.Blob(teile, { type: typ }), mime: typ, dauerMs: Date.now() - t0 }); }; try { rec.stop(); } catch (e) { frei(); resolve(null); } }); },
          abbruch() { rec.onstop = null; try { rec.stop(); } catch (e) { /* egal */ } frei(); },
        };
      },
    };
  }

  function audioBrowser(win) {
    let aktuell = null, stumm = false;
    const versuche = (u) => new Promise((resolve) => {
      const a = new win.Audio(); let fertig = false;
      const ende = (v) => { if (!fertig) { fertig = true; resolve(v); } };
      a.addEventListener('error', () => ende(null), { once: true });   // Datei fehlt oder nicht lesbar
      a.addEventListener('canplay', () => { if (stumm) return ende(null); aktuell = a; a.play().then(() => ende(u), () => ende(null)); }, { once: true });
      a.preload = 'auto'; a.src = u;
      setTimeout(() => ende(null), 4000);
    });
    return {
      async spiele(urls) { for (const u of urls) { if (stumm) return null; const ok = await versuche(u); if (ok) return ok; } return null; },
      stumm(b) { stumm = !!b; if (stumm) this.stopp(); },
      stopp() { try { if (aktuell) aktuell.pause(); } catch (e) { /* egal */ } aktuell = null; },
    };
  }

  function sttBrowser(win) {
    return async (blob, mime) => {
      const r = await win.fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': mime || 'application/octet-stream' }, body: blob });
      if (!r.ok) throw new Error('stt ' + r.status);
      const d = await r.json();
      return d && d.text;
    };
  }

  function ladeMatcher(win) {
    if (ladeMatcher.p) return ladeMatcher.p;
    const gefunden = () => win.Shared_BotMatcher || win.BotMatcher || null;
    ladeMatcher.p = new Promise((resolve) => {
      const mitDaten = async () => {   // Matcher braucht Kanon und Muster (im Browser kein Dateizugriff): vom Server holen und setzen
        const m = gefunden();
        if (!m) return null;
        try {
          const [mu, ka] = await Promise.all(['/content/bots/muster.json', '/content/bots/kanon.json'].map((u) => win.fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); })));
          m.setzeMuster(Object.assign({}, mu, { kanon: ka }));
          return m;
        } catch (e) { ladeMatcher.p = null; return null; }
      };
      if (gefunden()) return resolve(mitDaten());
      const sk = win.document.createElement('script');
      sk.src = '/shared/bot-matcher.js';
      sk.onload = () => resolve(mitDaten());
      sk.onerror = () => { ladeMatcher.p = null; resolve(null); };
      win.document.head.appendChild(sk);
    });
    return ladeMatcher.p;
  }

  // Anzeige: Farben und Rahmen aus den Menü-Tokens (Menue.TOKENS.FARBE: Kachel, Rand, Creme, Gold, Gelb); Pixelschrift gibt es im DOM nicht, daher monospace. Ruhig: keine Animation.
  function baueAnzeige(win, onText, onMesse) {
    const d = win.document, F = (win.Menue && win.Menue.TOKENS && win.Menue.TOKENS.FARBE) || { kachel: '#09090C', kachelRand: '#3A3428', text: '#F4EEDC', dim: '#B3A48E', gold: '#FFC66B', nichtBereit: '#F2C94C', tinte: '#120D0A' };
    const el = (tag, stil, text) => { const e = d.createElement(tag); Object.assign(e.style, stil || {}); if (text != null) e.textContent = text; return e; };
    const kachel = { background: F.kachel, border: '1px solid ' + F.kachelRand, color: F.text, font: '13px/1.35 monospace', padding: '4px 10px' };
    const wurzel = el('div', { position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '40', pointerEvents: 'none' });
    const unter = el('div', Object.assign({ position: 'absolute', left: '50%', bottom: '44px', transform: 'translateX(-50%)', maxWidth: '70vw', display: 'none', textAlign: 'center' }, kachel));
    const meld = el('div', Object.assign({}, kachel, { position: 'absolute', left: '50%', bottom: '80px', transform: 'translateX(-50%)', maxWidth: '70vw', display: 'none', color: F.nichtBereit, borderColor: F.nichtBereit }));
    const rec = el('div', Object.assign({}, kachel, { position: 'absolute', left: '16px', bottom: '44px', display: 'none', color: F.gold, borderColor: F.gold, borderWidth: '2px', letterSpacing: '1px' }), '● ' + TEXT.aufnahme);
    const zeile = el('form', { position: 'absolute', left: '16px', bottom: '12px', pointerEvents: 'auto' });
    const feld = el('input', Object.assign({}, kachel, { width: '300px', outline: 'none' }));
    feld.type = 'text'; feld.placeholder = TEXT.platzhalter; feld.setAttribute('autocomplete', 'off'); feld.setAttribute('maxlength', '120');
    // Tasten in der Textzeile gehören der Textzeile, nie dem Spiel (WASD & Co. laufen sonst mit)
    for (const n of ['keydown', 'keyup', 'keypress']) feld.addEventListener(n, (e) => { e.stopPropagation(); if (n === 'keydown' && e.key === 'Escape') feld.blur(); });
    zeile.addEventListener('submit', (e) => { e.preventDefault(); const t = feld.value; feld.value = ''; onText(t); });
    zeile.appendChild(feld);
    wurzel.appendChild(unter); wurzel.appendChild(meld); wurzel.appendChild(rec); wurzel.appendChild(zeile);
    d.body.appendChild(wurzel);
    const zeitweise = (e, text, ms, slot) => { clearTimeout(slot.t); e.textContent = text; e.style.display = 'block'; slot.t = setTimeout(() => { e.style.display = 'none'; }, ms); };
    const slotU = {}, slotM = {};
    let mess = null;
    return {
      feld, wurzel,
      aufnahme(an) { rec.style.display = an ? 'block' : 'none'; },
      untertitel(t) { zeitweise(unter, t, 5000, slotU); },
      meldung(t) { if (!t) { clearTimeout(slotM.t); meld.style.display = 'none'; return; } zeitweise(meld, t, 9000, slotM); },
      fokus() { feld.focus(); },
      messung(stand) {
        if (!stand) { if (mess) { mess.remove(); mess = null; } return; }
        if (!mess) { mess = el('div', Object.assign({}, kachel, { position: 'absolute', right: '16px', top: '16px', width: '340px', maxHeight: '70vh', overflowY: 'auto', pointerEvents: 'auto' })); wurzel.appendChild(mess); }
        mess.textContent = '';
        mess.appendChild(el('div', { color: F.gold, letterSpacing: '1px' }, 'MESSUNG  ' + (stand.index + 1) + '/' + stand.phrasen.length));
        mess.appendChild(el('div', { color: F.dim, margin: '2px 0 6px' }, 'Sprechtaste halten, die markierte Phrase sagen, loslassen. Bild↑/Bild↓ oder Knöpfe wechseln.'));
        const letzte = {}; for (const e of stand.eintraege) letzte[e.phraseId] = e;
        stand.phrasen.forEach((p, i) => {
          const e = letzte[p.id], an = i === stand.index;
          const zeile2 = el('div', { color: an ? F.gold : F.text, borderLeft: '2px solid ' + (an ? F.gold : 'transparent'), paddingLeft: '6px' }, (e ? (e.richtig ? '[ok] ' : '[--] ') : '[  ] ') + p.text);
          mess.appendChild(zeile2);
          if (e && an) mess.appendChild(el('div', { color: F.dim, paddingLeft: '6px' }, '„' + e.rohtext + '“ → ' + (e.ergebnis ? e.ergebnis.befehl : 'unklar') + (e.konfidenz != null ? ' ' + e.konfidenz : '') + ' · ' + e.t_matcher_ms + ' ms'));
        });
        const knoepfe = el('div', { marginTop: '6px' });
        for (const [t, dd] of [['◀ zurück', -1], ['weiter ▶', 1]]) { const b = el('button', Object.assign({}, kachel, { cursor: 'pointer', marginRight: '6px' }), t); b.type = 'button'; b.addEventListener('click', () => onMesse(dd)); knoepfe.appendChild(b); }
        mess.appendChild(knoepfe);
      },
      aus() { try { wurzel.remove(); } catch (e) { /* egal */ } },
    };
  }

  // ---------------------------------------------------------------- Zusammenbau im Browser
  let instanz = null;
  async function starte(win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    if (!win || instanz) return instanz && instanz.kern;
    const params = new URLSearchParams(win.location.search);
    const mockParam = params.get('botmock');
    const transport = mockParam !== null ? transportWebSocket(mockParam || 'ws://localhost:8710', win.WebSocket) : transportNetStub();
    const sitzung = 'messung-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    let kern = null;
    const anzeige = baueAnzeige(win, (t) => kern.sendeText(t), (dd) => kern.messeWeiter(dd));
    const env = {
      transport, matcher: () => ladeMatcher(win), stt: sttBrowser(win), mikrofon: mikrofonBrowser(win), audio: audioBrowser(win), anzeige,
      postMessung: (sit, eintrag) => win.fetch('/api/bot-messung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sitzung: sit, eintrag }) }).then((r) => { if (!r.ok) throw new Error('messung ' + r.status); }),
    };
    kern = erzeuge(env);
    const T = win.Tasten;
    const passt = (e, id, fallback) => (T && T.passt ? T.passt(e, id) : e.code === fallback);
    const tippt = () => { const a = win.document.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')); };
    const runter = (e) => {
      if (!kern.istAn() || tippt()) return;
      if (passt(e, 'allgemein.sprechen', 'Backquote')) { e.preventDefault(); if (!e.repeat) kern.tasteRunter(); return; }
      if (passt(e, 'allgemein.botText', 'Backslash')) { e.preventDefault(); if (!e.repeat) anzeige.fokus(); return; }
      if (e.code === 'PageDown' || e.code === 'PageUp') { if (kern.messeWeiter(e.code === 'PageDown' ? 1 : -1)) e.preventDefault(); }
    };
    const hoch = (e) => { if (!kern.istAn()) return; const code = e && e.code; const ids = T && T.belegung ? T.belegung('allgemein.sprechen').map((t) => t.replace(/^Shift\+/, '')) : ['Backquote']; if (ids.indexOf(code) >= 0) kern.tasteHoch(); };
    const weg = () => kern.abbrechen();
    win.addEventListener('keydown', runter, true); win.addEventListener('keyup', hoch, true); win.addEventListener('blur', weg);
    instanz = { kern, anzeige, transport, aufraeumen() { win.removeEventListener('keydown', runter, true); win.removeEventListener('keyup', hoch, true); win.removeEventListener('blur', weg); } };
    kern.schalte(true);
    if (params.get('botmessung') === '1') {
      try {
        const r = await win.fetch('/bot-messung/phrasen.json', { cache: 'no-store' });
        const d = r.ok ? await r.json() : null;
        if (d && Array.isArray(d.phrasen)) kern.setzeMessmodus({ phrasen: d.phrasen, sitzung, post: env.postMessung });
      } catch (e) { anzeige.meldung('Phrasenliste nicht geladen.'); }
    }
    return kern;
  }
  function stoppe() {
    if (!instanz) return;
    const i = instanz; instanz = null;
    i.kern.schalte(false); i.aufraeumen(); i.transport.schliessen();
  }

  return { erzeuge, clipKandidaten, erwartungErfuellt, TEXT, STIMMEN, CLIP_BASIS, transportWebSocket, transportNetStub, baueAnzeige, mikrofonBrowser, audioBrowser, sttBrowser, starte, stoppe, laeuft: () => !!instanz };
});
