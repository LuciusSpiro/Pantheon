// BOT-04 C: Sprache zu den Bots – Sprechtaste (Push-to-talk), Aufnahme, STT, Matcher, Untertitel und Clips, dazu die Textzeile und der Messmodus (?botmessung=1).
// Schichten (Kais 3-Layer-Regel): `erzeuge(env)` ist der Kern ohne DOM und ohne Netz (Zustand, Regeln, Ablauf) und ohne Browser testbar (tools/test-bot-sprache.js);
// alles Browser-Spezifische (Mikrofon, Audio, fetch, DOM, HUD-Anzeige) steckt in Adaptern am Ende, die `starte()` zusammensetzt. Globales `BotSprache` (nur im Browser, wenn geladen).
// GELADEN WIRD ES NUR AUF WUNSCH: public/js/bot-sprache-start.js bindet das Skript erst ein, wenn die Bot-Sprache in den Optionen an ist (oder ?botsprache=1, ?botmock, ?botmessung=1).
// Ist die Sprache aus, gibt es kein getUserMedia, keinen Netzaufruf und keine Zuhörer.
//
// Ablauf Sprache:  Taste halten (MediaRecorder läuft nur dann) -> loslassen -> POST /api/stt (Audio roh) -> Text -> Matcher -> bot.befehl { an, befehl, args, quelle: 'sprache' }
// Ablauf Text:     Chat-Zeile -> Matcher -> bot.befehl { …, quelle: 'text' }
// Matcher unklar (null): KEIN bot.befehl; stattdessen Clip bot.unklar (Untertitel „Bitte wiederholen“ immer dazu).
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
    sttNichtEingerichtet: 'Sprache nicht eingerichtet (STT_URL fehlt).',   // Server: 503 { fehler: 'stt-aus' }
    mikro: 'Mikrofon nicht verfügbar – Textzeile und Tasten laufen weiter.',
    stille: 'Mikrofon liefert keinen Ton.',   // BOT-04 D2: Pegel unter PEGEL_MIN, es geht nichts an STT
    keinMatcher: 'Befehlsabgleich nicht geladen.',
    keinBotServer: 'Kein Bot-Server verbunden.',
    zuKurz: 'Zu kurz – Taste halten und dabei sprechen.',
    zuLang: 'Aufnahme zu lang.',
    maxDauer: 'Aufnahme nach 60 s beendet.',
    mockVerboten: 'Mock-Server nur auf localhost erlaubt.',
    unklar2: 'Das habe ich nicht verstanden',
    messungFehler: 'Messung nicht gespeichert.',
    platzhalter: 'Befehl an die Crew · Enter senden · Esc zu',
  };
  const ROLLEN = { b0: 'NAVIGATION', b1: 'OPS', b2: 'TECHNIK' };   // Sprechername der Untertitel, bis die Bots eigene Namen und Farben haben (BOT-05); sonst BORD
  const sprecherName = (botId) => ROLLEN[botId] || 'BORD';
  const UNKLAR_DAUER_S = 2.5;                                                   // „Bitte wiederholen“ im Untertitel
  const STIMMEN = { b0: 'b0', b1: 'b1', b2: 'b2', b3: 'b0' };   // Ordnername im Clip-Vorrat je botId (Kai 2026-11-18: drei Stimmen b0 bis b2, mehr als 3 Bots gibt es nicht; b3 fällt auf b0 zurück); env.stimmen oder msg.stimme überschreiben
  const MAX_MS = 60000;                                                        // Höchstdauer einer Aufnahme (Auto-Stop); der Server nimmt ohnehin nur 1 MB
  const UNKLAR_VARIANTEN = 2;                                                  // bot.unklar.0 / .1 im Vorrat (texte.json), abwechselnd
  const MIN_MS = 250;                                                          // kürzere Aufnahmen sind versehentliche Tastenkontakte
  // BOT-04 D2 Stille-Schranke: liegt die SPITZE (größter Betrag der Samples, 0..1) einer Aufnahme unter dieser Grenze, geht kein Audio an STT (Whisper erfindet auf Stille Sätze).
  // ABSICHTLICH SEHR NIEDRIG (0,005 = -46 dBFS): sie fängt nur ein falsches/stummes Eingabegerät (Digital-Stille, Spitze 0; totes Rauschen liegt bei 0,001 bis 0,003), nie leises Sprechen
  // (Flüstern am Mikrofon liegt über 0,02). Ein verworfener echter Befehl im Gefecht ist schlimmer als ein überflüssiger STT-Aufruf. pegel null (kein Web Audio) = ungeprüft senden.
  const PEGEL_MIN = 0.005;
  // Spätstart-Schutz: die Pegelmessung darf die Schranke nur auslösen, wenn sie die Aufnahme auch wirklich abgedeckt hat. Läuft der AudioContext erst spät (suspended, Start-Latenz, Bluetooth A2DP -> HFP),
  // sähe sie nur das Raumrauschen kurz vor dem Loslassen, während der Befehl davor gesprochen wurde: dann gilt die Messung als unbrauchbar (pegel null = senden).
  const PEGEL_TAKT_MS = 30;           // Leseabstand des Analysers (ein Fenster je Takt)
  const PEGEL_START_MAX_MS = 150;     // spätestens so lange nach Aufnahmebeginn muss das erste Fenster gelesen sein (5 Takte Luft; ein normaler Start liegt bei 0 bis 50 ms); wer später startet, hat den Anfang des Befehls verpasst
  // Lücken: der Analyser hält nur die letzten 2048 Samples (≈ 43 ms bei 48 kHz). Blockiert der Hauptthread länger am Stück (Szenenwechsel, GC, Tab im Hintergrund), gehen Samples verloren, und die Spitze stammt nur aus dem Rauschen
  // davor/danach, während der Befehl genau in der Lücke gesprochen worden sein kann (Anzahl der Fenster allein würde das nicht merken). Größte erlaubte Lücke zwischen zwei Lesungen (inkl. letzte Lesung beim Loslassen):
  // 250 ms: gemessen reicht schon der Timer-Jitter eines ruhigen Prozesses auf Windows bis ≈ 85 ms (Takt 30 ms), 100 ms wäre also Dauerrauschen; und ein Befehl ist mindestens ≈ 600 ms lang, eine Lücke bis 250 ms verschluckt höchstens
  // eine Silbe, der Rest wird noch gelesen. Alles darüber heißt „unbekannt, was gesprochen wurde“ -> pegel null = senden (nie einen Befehl auf Verdacht verwerfen).
  const PEGEL_LUECKE_MAX_MS = 250;
  const PEGEL_ABDECKUNG_MIN = 0.5;    // gelesene Fenster mal Takt müssen mindestens diesen Anteil der Aufnahmedauer decken (gedrosselte Timer im Hintergrund, belastetes Spiel: dann lieber senden)
  const CLIP_BASIS = '/assets/bots/stimmen';
  const ENDUNGEN = ['wav', 'ogg'];                                             // der Vorrat hat nur WAV: zuerst wav, sonst erzeugte jeder Clip ein 404 auf .ogg

  // ------------------------------------------------------------------ rein: Clipwahl und Messvergleich
  // Kandidaten in Reihenfolge: die Variante des Untertitels zuerst, dann der Clip ohne Variante; wav vor ogg. Die Wiedergabe nimmt den ersten, der existiert.
  // Ohne Variante (der Vertrag kennt kein Feld `variante`, ein vertragstreuer Server liefert keines): zuerst <textId>.0, dann ohne Variante.
  function clipKandidaten(textId, stimme, variante, basis) {
    const b = (basis || CLIP_BASIS) + '/' + stimme + '/' + textId, out = [];
    const v = Number.isInteger(variante) && variante >= 0 ? variante : 0;
    for (const e of ENDUNGEN) out.push(b + '.' + v + '.' + e);
    for (const e of ENDUNGEN) out.push(b + '.' + e);
    return out;
  }
  // Spitze einer Sample-Folge (Float32Array o. ä., -1..1): größter Betrag, nicht endliche Werte zählen nicht, leer = 0. Reine Rechenlogik der Pegelmessung (der Browser-Teil liefert nur die Samples).
  function spitzeAusSamples(samples) {
    let m = 0;
    if (!samples) return 0;
    for (let i = 0; i < samples.length; i++) { const v = Math.abs(samples[i]); if (v > m && isFinite(v)) m = v; }
    return m;
  }
  // Reine Abdeckungslogik der Pegelmessung (siehe PEGEL_START_MAX_MS): darf ein gemessener Pegel als Aussage über die GANZE Aufnahme gelten?
  // verzugMs = Zeit von Aufnahmebeginn bis zum ersten gelesenen Fenster (null = nie gelesen), fenster = Zahl der gelesenen Fenster, dauerMs = Aufnahmedauer,
  // lueckeMs = größter Abstand zwischen zwei Lesungen (undefined = nicht angegeben, nur die ersten drei Prüfungen; pegelMesser gibt ihn immer an). Im Zweifel false (= senden).
  function pegelAbdeckungReicht(verzugMs, fenster, dauerMs, lueckeMs) {
    if (typeof verzugMs !== 'number' || !isFinite(verzugMs) || !(fenster > 0) || !(dauerMs >= 0)) return false;
    if (verzugMs > PEGEL_START_MAX_MS) return false;
    if (lueckeMs !== undefined && !(typeof lueckeMs === 'number' && lueckeMs >= 0 && lueckeMs <= PEGEL_LUECKE_MAX_MS)) return false;   // Blockade mitten in der Aufnahme: nicht gesehen, was gesprochen wurde
    return fenster * PEGEL_TAKT_MS >= dauerMs * PEGEL_ABDECKUNG_MIN;
  }
  // richtig = gleicher Befehl, GENAU die erwarteten Argumente (als Text verglichen, keine zusätzlichen; nur ein zusätzliches meter zählt nicht) und, falls erwartet, gleicher Adressat.
  // Exakt auch im Messmodus: ein Matcher, der für „Feuer frei“ {waffen:'torpedo'} liefert, ließe den Server nur Torpedos feuern und darf nicht als richtig gelten.
  // erwartet null = bewusst nicht erkennbar (z. B. nav.sprung per Sprache): richtig, wenn der Matcher null liefert
  function erwartungErfuellt(erwartet, res) {
    if (erwartet === null) return !res;
    if (!res || !res.befehl || !erwartet) return false;
    if (res.befehl !== erwartet.befehl) return false;
    if (erwartet.an && res.an !== erwartet.an) return false;
    const ea = erwartet.args || {}, ra = res.args || {};
    if (Object.keys(ra).some((k) => !(k in ea) && k !== 'meter')) return false;
    return Object.keys(ea).every((k) => String(ra[k]) === String(ea[k]));
  }

  // ------------------------------------------------------------------ Kern
  // env: { transport: { send(obj) -> bool, onMessage(fn) -> abmelden }, matcher: () -> { match } | Promise, stt: (blob, mime) -> Promise<text>,
  //        mikrofon: { start() -> Promise<{ stop() -> Promise<{ blob, mime, dauerMs }>, abbruch() }> }, audio: { spiele(urls, { start?, ende? }) -> Promise<url|null>, stumm(bool), stopp() },
  //        vorSenden?(msg) -> Vermerk (BotMenue.sprachBefehl: legt den Eintrag für Quittung und „gilt“ an, BEVOR gesendet wird), verworfen?(vermerk) (Sendefehler: Eintrag zurück), siehe menueAnschluss,
  //        anzeige: { aufnahme(bool), untertitel(text, { botId?, dauerS? }) -> Kennung?, meldung(text|null), verarbeitet?(bool), clip?(kennung, bool), messung?(zustand) }, uhr?: () -> ms, stimmen?, clipBasis?, postMessung?: (sitzung, eintrag) -> Promise }
  function erzeuge(env) {
    const uhr = env.uhr || (() => Date.now());
    const stimmen = Object.assign({}, STIMMEN, env.stimmen || {});
    const A = env.anzeige;
    const s = { an: false, verarbeitet: false, aufnahme: false, gehalten: false, lauf: 0, handle: null, start: null, abmelden: null, letzte: Promise.resolve(), messmodus: null, timer: null, unklarN: 0, letzterBot: null, verarbN: 0 };
    const setzeTimer = env.setTimeout || ((f, ms) => setTimeout(f, ms)), loescheTimer = env.clearTimeout || ((t) => clearTimeout(t));
    const stopTimer = () => { if (s.timer != null) { loescheTimer(s.timer); s.timer = null; } };

    const stimmeFuer = (x) => (x && x.stimme) || stimmen[x && x.botId ? x.botId : x] || String(x && x.botId ? x.botId : x || 'b0');
    const meldung = (t) => { try { A.meldung(t); } catch (e) { /* Anzeige darf den Ablauf nie brechen */ } };
    // „…“ steht, solange mindestens ein Ablauf (Loslassen bis Ergebnis) läuft; je Ablauf eine Marke, damit überlappende Abläufe sich nicht gegenseitig löschen
    const verarbStand = () => { const an = s.verarbN > 0; if (an === s.verarbeitet) return; s.verarbeitet = an; try { if (A.verarbeitet) A.verarbeitet(an); } catch (e) { /* egal */ } };   // nur Wechsel melden
    const verarbBeginn = () => { s.verarbN++; verarbStand(); return { offen: true }; };
    const verarbEnde = (marke) => { if (!marke || !marke.offen) return; marke.offen = false; s.verarbN--; verarbStand(); };   // je Marke höchstens einmal
    const untertitel = (t, info) => { try { return A.untertitel(t, info); } catch (e) { return undefined; } };   // liefert die Kennung des Untertitels (für clip)
    const clipHalt = (id, an) => { try { if (A.clip && id != null) A.clip(id, an); } catch (e) { /* egal */ } };

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
      s.aufnahme = true; s.gehalten = true; s.maxHinweis = false;
      const lauf = ++s.lauf;
      env.audio.stumm(true); env.audio.stopp();   // Echo: nichts abspielen, solange gesprochen wird
      s.start = (async () => {
        try {
          const h = await env.mikrofon.start();
          if (!s.gehalten || s.lauf !== lauf || !s.an) { try { await h.abbruch(); } catch (e) { /* egal */ } return null; }   // schon losgelassen: sofort wieder zu
          s.handle = h; A.aufnahme(true);
          s.timer = setzeTimer(() => {   // Höchstdauer: Auto-Stop mit Anzeige, die Aufnahme wird wie beim Loslassen ausgewertet
            s.timer = null;
            if (s.lauf !== lauf || !s.aufnahme) return;
            s.maxHinweis = true; meldung(TEXT.maxDauer); tasteHoch();
          }, MAX_MS);
          return h;
        } catch (e) {
          if (s.lauf === lauf) { s.aufnahme = false; s.gehalten = false; stopTimer(); env.audio.stumm(false); A.aufnahme(false); }
          meldung(TEXT.mikro);
          return null;
        }
      })();
      return true;
    }
    function tasteHoch() {
      if (!s.aufnahme) return Promise.resolve(false);   // außerhalb der Taste passiert nichts
      s.aufnahme = false; s.gehalten = false; stopTimer();
      A.aufnahme(false); env.audio.stumm(false);
      const t0 = uhr(), start = s.start; s.handle = null;
      const marke = verarbBeginn();   // Zwischenzustand „…“ zwischen Loslassen und Ergebnis
      s.letzte = (async () => {
        try {
          const h = await start;
          if (!h) return false;
          let aufn; try { aufn = await h.stop(); } catch (e) { meldung(TEXT.mikro); return false; }
          return await verarbeiteAufnahme(aufn, t0, marke);
        } finally { verarbEnde(marke); }
      })().catch(() => false);
      return s.letzte;
    }
    function abbrechen() {   // Fokusverlust, Sprache aus: Aufnahme verwerfen, nichts senden
      if (!s.aufnahme) return false;
      s.aufnahme = false; s.gehalten = false; s.lauf++; stopTimer();
      const h = s.handle; s.handle = null;
      A.aufnahme(false); env.audio.stumm(false);
      if (h) { try { h.abbruch(); } catch (e) { /* egal */ } }
      return true;
    }

    async function matcher() { try { return (await env.matcher()) || null; } catch (e) { return null; } }
    async function gleiche(text) { const m = await matcher(); if (!m) return { fehlt: true }; try { return { res: m.match(text) || null }; } catch (e) { return { res: null }; } }

    async function verarbeiteAufnahme(aufn, t0, marke) {
      if (!s.an) return false;   // Sprache inzwischen aus: nichts mehr an STT schicken
      if (!aufn || !aufn.blob || !(aufn.blob.size > 0) || (aufn.dauerMs != null && aufn.dauerMs < MIN_MS)) { meldung(TEXT.zuKurz); return false; }
      if (typeof aufn.pegel === 'number' && aufn.pegel < PEGEL_MIN) {   // D2: kein Ton angekommen: nichts an STT, keine Befehlsauswertung
        if (s.messmodus) await messeStille(aufn);
        meldung(TEXT.stille); return false;
      }
      const tStt0 = uhr();
      let text;
      try { text = await env.stt(aufn.blob, aufn.mime); } catch (e) { meldung(e && e.status === 413 ? TEXT.zuLang : e && e.fehler === 'stt-aus' ? TEXT.sttNichtEingerichtet : TEXT.sttAus); return false; }
      if (!s.an) return false;   // während der Erkennung ausgeschaltet: verwerfen, nichts senden
      const tText = uhr();
      if (!s.maxHinweis) meldung(null);   // Hinweis Aufnahme nach 60 s beendet bleibt stehen
      text = String(text == null ? '' : text).trim();
      const g = text ? await gleiche(text) : { res: null };
      if (g.fehlt) { meldung(TEXT.keinMatcher); return false; }
      const tMatcher = uhr();
      if (s.messmodus) return messeEin({ text, res: g.res, t_stt_ms: tText - tStt0, t_text_ms: tText - t0, t_matcher_ms: tMatcher - t0, dauer_aufnahme_ms: aufn.dauerMs == null ? null : Math.round(aufn.dauerMs), pegel: typeof aufn.pegel === 'number' ? aufn.pegel : null });
      return ergebnis(g.res, 'sprache', marke);
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
    function ergebnis(res, quelle, marke) {
      verarbEnde(marke);   // das Ergebnis ist da (Befehl, Rückfrage oder Fehler)
      if (!res || typeof res.befehl !== 'string' || !res.befehl) return unklar();   // unter der Schwelle: nichts senden
      const msg = { t: 'bot.befehl', an: res.an, befehl: res.befehl, quelle };
      if (res.args !== undefined && res.args !== null) msg.args = res.args;
      let vermerk = null;   // BotMenue legt den Eintrag für Quittung und „gilt“ an (ohne zu senden), BEVOR gesendet wird: die Antwort kann nicht vor dem Eintrag kommen
      if (env.vorSenden) { try { vermerk = env.vorSenden(msg); } catch (e) { vermerk = null; } }
      let ok = false;
      try { ok = env.transport.send(msg) !== false; } catch (e) { ok = false; }
      if (!ok) { if (env.verworfen && vermerk) { try { env.verworfen(vermerk); } catch (e) { /* egal */ } } meldung(TEXT.keinBotServer); return false; }
      if (/^b\d$/.test(String(res.an))) s.letzterBot = res.an;   // zuletzt angesprochener Bot (nur wenn der Matcher eine botId nennt)
      if (!s.maxHinweis) meldung(null);
      return true;
    }
    async function unklar() {
      const v = s.unklarN++ % UNKLAR_VARIANTEN;   // beide Varianten abwechselnd
      let url = null;
      try { url = await env.audio.spiele(clipKandidaten('bot.unklar', stimmeFuer(s.letzterBot || 'b0'), v, env.clipBasis)); } catch (e) { url = null; }   // Stimme des zuletzt angesprochenen/aktiven Bots
      untertitel(v === 0 ? TEXT.unklar : TEXT.unklar2, { botId: s.letzterBot, dauerS: UNKLAR_DAUER_S });   // Untertitel immer, auch wenn der Clip läuft (Kai 2026-11-25)
      return false;
    }

    // ---- bot.antwort: Untertitel und Clip gleichzeitig; fehlt der Clip, bleibt der Untertitel
    function empfange(msg) {
      if (!s.an || !msg || msg.t !== 'bot.antwort') return false;
      if (typeof msg.botId === 'string' && msg.botId) s.letzterBot = msg.botId;
      const id = untertitel(typeof msg.text === 'string' && msg.text ? msg.text : String(msg.textId || ''), { botId: msg.botId });
      if (!s.aufnahme && msg.textId) {   // gehaltene Sprechtaste = Mikrofon offen: nichts abspielen
        const urls = clipKandidaten(msg.textId, stimmeFuer(msg), msg.variante, env.clipBasis);
        // Läuft der Clip länger als die Standarddauer, bleibt der Untertitel bis Clip-Ende (+ 0,5 s in der Anzeige)
        try { Promise.resolve(env.audio.spiele(urls, { start: () => clipHalt(id, true), ende: () => clipHalt(id, false) })).catch(() => null); } catch (e) { /* nur Untertitel */ }
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
        t_stt_ms: Math.round(x.t_stt_ms), t_text_ms: Math.round(x.t_text_ms), t_matcher_ms: Math.round(x.t_matcher_ms), dauer_aufnahme_ms: x.dauer_aufnahme_ms, pegel: x.pegel == null ? null : x.pegel,   // t_text: Loslassen -> Text (Aufnahme beenden + STT), t_matcher: Loslassen -> Matcher fertig
      };
      m.eintraege.push(eintrag);
      zeigeMessung();
      if (m.post) { try { await m.post(m.sitzung, eintrag); } catch (e) { meldung(TEXT.messungFehler); } }
      return eintrag;
    }

    // Stille im Messmodus: eigener Eintrag mit stille: true (kein Rohtext, kein Ergebnis, richtig null). Er zählt NICHT als Messung der Phrase (Stille-Einträge tragen stille: true und richtig: null; wer in der JSONL-Messdatei eine Quote rechnet, muss sie ausfiltern, eine Auswertung gibt es im Repo nicht; das Messfeld zeigt sie als „kein Ton“).
    async function messeStille(aufn) {
      const m = s.messmodus, p = aktuellePhrase();
      const eintrag = { zeit: new Date().toISOString(), phraseId: p ? p.id : null, phrase: p ? p.text : null, erwartet: p ? p.erwartet : null, stille: true, pegel: aufn.pegel, rohtext: null, ergebnis: null, konfidenz: null, richtig: null, t_stt_ms: null, t_text_ms: null, t_matcher_ms: null, dauer_aufnahme_ms: aufn.dauerMs == null ? null : Math.round(aufn.dauerMs) };
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
  // ?botmock= nur auf dem eigenen Rechner (localhost, 127.0.0.1, [::1]) und nur per ws/wss; sonst gingen Befehle und Antworten an einen fremden Server
  function mockUrlErlaubt(url) {
    try { const u = new URL(String(url)); return /^wss?:$/.test(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].indexOf(u.hostname) >= 0; } catch (e) { return false; }
  }
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
  // Der Weg über die Spielverbindung (net.js, BOT-04 D): bot.befehl geht mit Net.send an den Spielserver, bot.antwort kommt über Net.on. Ohne offene Verbindung -> false (Meldung „Kein Bot-Server verbunden“).
  // netz: true -> die Sprache zeigt die Antworten (BotSprache.netAntworten), pult-befehl.js führt dann nur Quittung und „gilt“. schliessen() lässt die Spielverbindung unberührt.
  function transportNet(Net) {
    const offen = () => { try { return !!Net && (typeof Net.isOpen === 'function' ? !!Net.isOpen() : true); } catch (e) { return false; } };
    return {
      send(obj) { if (!offen()) return false; try { return Net.send(obj) !== false; } catch (e) { return false; } },
      onMessage(fn) {
        if (!Net || typeof Net.on !== 'function') return () => {};
        const weg = Net.on((m) => { if (m && m.t === 'bot.antwort') fn(m); });
        return typeof weg === 'function' ? weg : () => {};
      },
      schliessen() {},
      offen,
      netz: true,
    };
  }
  // Rückfall ohne Spielverbindung (kein Net im Fenster, oder ein verbotener ?botmock=): nichts geht hinaus (send -> false)
  function transportNetStub() {
    return { send() { return false; }, onMessage() { return () => {}; }, schliessen() {}, offen: () => false, stub: true };
  }
  // Anschluss an das Befehlsmenü (BotMenue gehört der Zustand): die Sprache meldet jeden Befehl vor dem Senden an (sprachBefehl) und nimmt ihn bei Sendefehler zurück. holeMenue wird je Aufruf gefragt (PultBefehl kann später laden).
  function menueAnschluss(holeMenue) {
    const menue = () => { try { return holeMenue() || null; } catch (e) { return null; } };
    return {
      vorSenden: (msg) => { const m = menue(); return m && m.sprachBefehl ? m.sprachBefehl(msg) : null; },
      verworfen: (vermerk) => { const m = menue(); if (m && m.sprachBefehlVerworfen) m.sprachBefehlVerworfen(vermerk); },
    };
  }

  // D2: misst die Spitze des Mikrofonsignals während der Aufnahme (AudioContext + AnalyserNode, alle 30 ms ein Fenster von 2048 Samples, Rechnung in spitzeAusSamples).
  // ende() liefert die Spitze 0..1 und gibt den Kontext frei; null, wenn kein Web Audio da ist, der Kontext nicht lief, nie ein Fenster gelesen wurde oder die Messung die Aufnahme nicht ausreichend abdeckt
  // (Spätstart, siehe pegelAbdeckungReicht; nie raten: lieber ungeprüft senden als einen Befehl verwerfen).
  const abgefangen = (p) => { try { if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (e) { /* egal */ } };   // abgelehnte Promises von resume()/close() erzeugen keine unbehandelte Ablehnung
  function pegelMesser(win, stream) {
    let ctx = null, an = null, buf = null, timer = null, spitze = 0, fenster = 0, fertig = false, tErst = null, tLetzt = null, luecke = 0;
    const t0 = Date.now();
    const lies = () => { try { an.getFloatTimeDomainData(buf); spitze = Math.max(spitze, spitzeAusSamples(buf)); fenster++; const jetzt = Date.now(); if (tErst === null) tErst = jetzt; if (tLetzt !== null) luecke = Math.max(luecke, jetzt - tLetzt); tLetzt = jetzt; } catch (e) { /* egal */ } };
    try {
      const AC = win.AudioContext || win.webkitAudioContext;
      if (AC) {
        ctx = new AC(); const quelle = ctx.createMediaStreamSource(stream);
        an = ctx.createAnalyser(); an.fftSize = 2048; buf = new Float32Array(an.fftSize); quelle.connect(an);   // nicht an den Ausgang: kein Echo
        try { if (ctx.state === 'suspended' && ctx.resume) abgefangen(ctx.resume()); } catch (e) { /* egal */ }
        timer = setInterval(() => { if (ctx && ctx.state === 'running') lies(); }, PEGEL_TAKT_MS);
      }
    } catch (e) { if (timer) clearInterval(timer); timer = null; try { if (ctx && ctx.close) abgefangen(ctx.close()); } catch (x) { /* egal */ } ctx = null; an = null; }
    return {
      ende() {
        if (fertig || !ctx) return null;
        fertig = true; if (timer) clearInterval(timer); timer = null;
        const lief = ctx.state === 'running'; if (lief) lies();
        const dauer = Date.now() - t0;
        try { if (ctx.close) abgefangen(ctx.close()); } catch (e) { /* egal */ }
        return lief && pegelAbdeckungReicht(tErst === null ? null : tErst - t0, fenster, dauer, luecke) ? spitze : null;
      },
    };
  }

  function mikrofonBrowser(win) {
    const MR = win.MediaRecorder;
    const waehleMime = () => { for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) { try { if (MR.isTypeSupported && MR.isTypeSupported(t)) return t; } catch (e) { /* weiter */ } } return ''; };
    return {
      async start() {   // Mikrofon wird je Tastendruck geöffnet und beim Loslassen wieder freigegeben (Mikrofon-Symbol des Browsers nur während der Aufnahme)
        if (!win.navigator || !win.navigator.mediaDevices || !win.navigator.mediaDevices.getUserMedia || !MR) throw new Error('kein Mikrofon');
        const stream = await win.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const frei = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* egal */ } };
        let rec; const mime = waehleMime(), teile = [], t0 = Date.now();
        const pm = pegelMesser(win, stream);   // D2: Pegel der Aufnahme (null, wenn Web Audio fehlt oder nicht lief)
        const frei2 = () => { frei(); pm.ende(); };
        try {
          rec = new MR(stream, mime ? { mimeType: mime } : {});
          rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) teile.push(ev.data); };
          rec.start();
        } catch (e) { frei2(); throw e; }   // Mikrofonstream nie offen lassen, wenn der Recorder nicht startet
        return {
          stop() { return new Promise((resolve) => { rec.onstop = () => { const pegel = pm.ende(); frei(); const typ = rec.mimeType || mime || 'audio/webm'; resolve({ blob: new win.Blob(teile, { type: typ }), mime: typ, dauerMs: Date.now() - t0, pegel }); }; try { rec.stop(); } catch (e) { frei2(); resolve(null); } }); },
          abbruch() { rec.onstop = null; try { rec.stop(); } catch (e) { /* egal */ } frei2(); },
        };
      },
    };
  }

  function audioBrowser(win) {
    let aktuell = null, stumm = false;
    const versuche = (u, cb) => new Promise((resolve) => {
      const a = new win.Audio(); let fertig = false, laeuft = false;
      const ende = (v) => { if (!fertig) { fertig = true; resolve(v); } };
      const aus = () => { if (laeuft) { laeuft = false; try { if (cb && cb.ende) cb.ende(); } catch (e) { /* egal */ } } };   // Clip-Ende (zu Ende gespielt, angehalten, Fehler)
      a.addEventListener('error', () => { ende(null); aus(); }, { once: true });   // Datei fehlt oder nicht lesbar
      a.addEventListener('ended', aus, { once: true }); a.addEventListener('pause', aus, { once: true });
      a.addEventListener('canplay', () => { if (stumm) return ende(null); aktuell = a; a.play().then(() => { laeuft = true; try { if (cb && cb.start) cb.start(); } catch (e) { /* egal */ } ende(u); }, () => ende(null)); }, { once: true });
      a.preload = 'auto'; a.src = u;
      setTimeout(() => ende(null), 4000);
    });
    return {
      async spiele(urls, cb) { for (const u of urls) { if (stumm) return null; const ok = await versuche(u, cb); if (ok) return ok; } return null; },
      stumm(b) { stumm = !!b; if (stumm) this.stopp(); },
      stopp() { try { if (aktuell) aktuell.pause(); } catch (e) { /* egal */ } aktuell = null; },
    };
  }

  function sttBrowser(win) {
    return async (blob, mime) => {
      const r = await win.fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': mime || 'application/octet-stream' }, body: blob });
      if (!r.ok) {
        const e = new Error('stt ' + r.status); e.status = r.status;
        if (r.status === 503) { try { const j = await r.json(); if (j && j.fehler === 'stt-aus') e.fehler = 'stt-aus'; } catch (x) { /* kein JSON: nicht erreichbar */ } }   // Server: STT_URL nicht gesetzt
        throw e;
      }
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

  // Anzeige im Spiel-HUD (BOT-04 C2): Untertitel, Aufnahme-Anzeige und Meldungen zeichnet das HUD auf dem 640x360-Raster (hud.js Sprechspalte, Hud.pushNotice), nicht mehr das DOM:
  // so skaliert alles mit dem Bild und weicht ODA, Funkwahl, Scanner und Konsolen-Bedienfeldern aus. Im DOM bleiben nur das unsichtbare <input> der Textzeile (Tastatur, IME, maxlength 120) und
  // der Messmodus-Kasten (Entwicklerwerkzeug, ?botmessung=1). Ruhig: keine Animation. Austauschbar: Der Kern kennt nur die Schnittstelle
  // aufnahme(bool), verarbeitet(bool), untertitel(text, { botId?, dauerS? }) -> Kennung, clip(kennung, bool), meldung(text|null), textzeile(bool), messung(stand), aus().
  function anzeigeHud(win, onText, onMesse) {
    const d = win.document, hud = () => win.Hud || null;
    const FN = () => (win.Menue && win.Menue.TOKENS && win.Menue.TOKENS.FN) || { sensor: '#A9D6E5', warn: '#F2C94C' };
    const F = (win.Menue && win.Menue.TOKENS && win.Menue.TOKENS.FARBE) || { kachel: '#09090C', kachelRand: '#3A3428', text: '#F4EEDC', dim: '#B3A48E', gold: '#FFC66B' };
    const el = (tag, stil, text) => { const e = d.createElement(tag); Object.assign(e.style, stil || {}); if (text != null) e.textContent = text; return e; };
    const kachel = { background: F.kachel, border: '1px solid ' + F.kachelRand, color: F.text, font: '13px/1.35 monospace', padding: '4px 10px' };   // nur für den Messmodus-Kasten
    const wurzel = el('div', { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '40', pointerEvents: 'none' });
    // Textzeile: das echte <input> liegt unsichtbar genau über dem vom HUD gezeichneten Kasten; Text und Cursor zeichnet das HUD (liest value und selectionStart)
    const zeileForm = el('form', { position: 'fixed', left: '0', top: '0', width: '0', height: '0', display: 'none', opacity: '0', pointerEvents: 'none', margin: '0', padding: '0' });
    const feld = el('input', { width: '100%', height: '100%', boxSizing: 'border-box', border: '0', outline: 'none', margin: '0', padding: '0 4px', background: 'transparent', font: '16px monospace' });
    feld.type = 'text'; feld.setAttribute('autocomplete', 'off'); feld.setAttribute('maxlength', '120'); feld.setAttribute('aria-label', TEXT.platzhalter);
    zeileForm.appendChild(feld); wurzel.appendChild(zeileForm);
    d.body.appendChild(wurzel);
    let lage = '', stickyText = null, letzteMeldung = null, mess = null;
    const zeile = { offen: false, feld, platzhalter: TEXT.platzhalter, schliessen: () => schliesse(), platziere(r) {   // Rasterrechteck -> Bildschirmpixel wie #lobbyCode in client.js layout() (Raster * Client.scale + Canvas-Versatz)
      const c = d.getElementById && d.getElementById('game'); if (!c || !c.getBoundingClientRect) return;
      const b = c.getBoundingClientRect(), sc = (win.Client && win.Client.scale) || b.width / 640;
      const k = [Math.floor(b.left + r.x * sc), Math.floor(b.top + r.y * sc), Math.floor(r.w * sc), Math.floor(r.h * sc)].join();
      if (k === lage) return;
      lage = k; const [l, t, w, h] = k.split(',');
      zeileForm.style.left = l + 'px'; zeileForm.style.top = t + 'px'; zeileForm.style.width = w + 'px'; zeileForm.style.height = h + 'px';
    } };
    function oeffne() {
      const h = hud();
      if (!h || !h.sprechBereit || !h.sprechBereit()) return false;   // nur mit Spielbild: im Menü/Lobby wäre eine unsichtbare Zeile eine Falle
      const c = win.Client;
      if (c && c.eingabeFrei && !c.eingabeFrei()) return false;   // Pausenmenü, Minispiel, Zusehen am Terminal, Kapitelkarte: dort wäre die Zeile eine Falle
      if (c && c.tastenFreigeben) c.tastenFreigeben();   // gehaltene Spieltasten (WASD, Umschalt, E) loslassen: ihr keyup erreicht das Spiel nicht mehr (die Zeile schluckt es)
      zeile.offen = true; lage = ''; zeileForm.style.display = 'block'; zeileForm.style.pointerEvents = 'auto';
      try { feld.focus(); } catch (e) { /* egal */ }
      return true;
    }
    function schliesse() {
      if (!zeile.offen) return false;
      zeile.offen = false; zeileForm.style.display = 'none'; zeileForm.style.pointerEvents = 'none'; feld.value = '';
      try { if (d.activeElement === feld) feld.blur(); } catch (e) { /* egal */ }
      if (win.Client && win.Client.tastenFreigeben) win.Client.tastenFreigeben();   // was in der Zeile gedrückt wurde (z. B. das # selbst), bleibt nicht im Spiel hängen
      return true;
    }
    // Tasten in der Textzeile gehören der Textzeile, nie dem Spiel (WASD & Co. laufen sonst mit); Esc schließt ohne Senden, Enter (submit) sendet und schließt
    for (const n of ['keydown', 'keyup', 'keypress']) feld.addEventListener(n, (e) => { e.stopPropagation(); if (n === 'keydown' && e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); schliesse(); } });
    feld.addEventListener('blur', () => { if (zeile.offen && !feld.value) schliesse(); });   // Fokusverlust schließt eine leere Zeile; mit Text bleibt sie offen
    zeileForm.addEventListener('submit', (e) => { e.preventDefault(); const t = feld.value; schliesse(); onText(t); });
    const entferne = (text) => { const h = hud(); if (h && text != null) h.notices = h.notices.filter((n) => n.text !== text); };
    const h0 = hud(); if (h0 && h0.sprechAn) { h0.sprechAn(true); h0.sprech.zeile = zeile; }
    return {
      feld, wurzel, zeile,
      aufnahme(an) { const h = hud(); if (!h) return; h.sprech.aufnahme = !!an; if (an) { h.sprech.verarbeitet = false; entferne(stickyText); stickyText = null; entferne(letzteMeldung); letzteMeldung = null; } },   // neue Aufnahme räumt die alte Meldung weg (z. B. „Mikrofon liefert keinen Ton.“)
      verarbeitet(an) { const h = hud(); if (h) h.sprech.verarbeitet = !!an; },
      untertitel(t, info) { const h = hud(); return h ? h.pushCrewFunk(t, sprecherName(info && info.botId), FN().sensor, info && info.dauerS) : 0; },
      clip(id, an) { const h = hud(); if (h && id) h.crewFunkHalte(id, an); },
      meldung(t) {
        const h = hud(); if (!h) return;
        if (!t) { entferne(letzteMeldung); letzteMeldung = null; return; }
        const bleibt = t === TEXT.maxDauer;   // bleibt bis zur nächsten Aufnahme, auch wenn eine andere Meldung kommt
        entferne(letzteMeldung); letzteMeldung = bleibt ? null : t;
        if (bleibt) stickyText = t;
        h.pushNotice(t, FN().warn, t === TEXT.maxDauer ? 3600 : 6);
      },
      hinweis(t) { const h = hud(); if (h) h.pushNotice(t, FN().sensor, 6); },
      textzeile(an) { return an ? oeffne() : schliesse(); },
      fokus() { return oeffne(); },
      messung(stand) {
        if (!stand) { if (mess) { mess.remove(); mess = null; } return; }
        if (!mess) { mess = el('div', Object.assign({}, kachel, { position: 'fixed', right: '16px', top: '16px', width: '340px', maxHeight: '70vh', overflowY: 'auto', pointerEvents: 'auto' })); wurzel.appendChild(mess); }
        mess.textContent = '';
        mess.appendChild(el('div', { color: F.gold, letterSpacing: '1px' }, 'MESSUNG  ' + (stand.index + 1) + '/' + stand.phrasen.length));
        mess.appendChild(el('div', { color: F.dim, margin: '2px 0 6px' }, 'Sprechtaste halten, die markierte Phrase sagen, loslassen. Bild↑/Bild↓ oder Knöpfe wechseln.'));
        const letzte = {}, stille = {}; for (const e of stand.eintraege) { if (e.stille) stille[e.phraseId] = e; else { letzte[e.phraseId] = e; delete stille[e.phraseId]; } }   // Stille zählt nicht als Messung
        stand.phrasen.forEach((p, i) => {
          const e = letzte[p.id], an = i === stand.index;
          const zeile2 = el('div', { color: an ? F.gold : F.text, borderLeft: '2px solid ' + (an ? F.gold : 'transparent'), paddingLeft: '6px' }, (e ? (e.richtig ? '[ok] ' : '[--] ') : '[  ] ') + p.text);
          mess.appendChild(zeile2);
          if (stille[p.id] && an) mess.appendChild(el('div', { color: F.gold, paddingLeft: '6px' }, 'kein Ton (Pegel ' + Number(stille[p.id].pegel).toFixed(4) + ') · nicht gewertet'));
          if (e && an) mess.appendChild(el('div', { color: F.dim, paddingLeft: '6px' }, '„' + e.rohtext + '“ → ' + (e.ergebnis ? e.ergebnis.befehl : 'unklar') + (e.konfidenz != null ? ' ' + e.konfidenz : '') + ' · ' + e.t_matcher_ms + ' ms'));
        });
        const knoepfe = el('div', { marginTop: '6px' });
        for (const [t, dd] of [['◀ zurück', -1], ['weiter ▶', 1]]) { const b = el('button', Object.assign({}, kachel, { cursor: 'pointer', marginRight: '6px' }), t); b.type = 'button'; b.addEventListener('click', () => onMesse(dd)); knoepfe.appendChild(b); }
        mess.appendChild(knoepfe);
      },
      aus() {
        schliesse(); entferne(letzteMeldung); entferne(stickyText);
        const h = hud(); if (h && h.sprechAn) h.sprechAn(false);
        try { wurzel.remove(); } catch (e) { /* egal */ }
      },
    };
  }

  // Einmaliger Hinweis beim Einschalten, mit den echten (umbelegbaren) Tastenbeschriftungen
  function startHinweis(T) {
    const kappe = (id, ersatz) => { try { const k = T && T.kappe ? T.kappe(id) : ''; return k && k !== '–' ? k : ersatz; } catch (e) { return ersatz; } };
    return 'Bot-Sprache an: ' + kappe('allgemein.sprechen', '^') + ' halten = sprechen, ' + kappe('allgemein.botText', '#') + ' = tippen';
  }

  // ---------------------------------------------------------------- Zusammenbau im Browser
  let instanz = null;
  async function starte(win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    if (!win || instanz) return instanz && instanz.kern;
    const params = new URLSearchParams(win.location.search);
    const mockParam = params.get('botmock');
    const mockUrl = mockParam !== null ? (mockParam || 'ws://localhost:8710') : null;
    const mockOk = mockUrl === null || mockUrlErlaubt(mockUrl);
    const transport = mockUrl !== null ? (mockOk ? transportWebSocket(mockUrl, win.WebSocket) : transportNetStub()) : win.Net ? transportNet(win.Net) : transportNetStub();   // ?botmock= hat Vorrang (verboten: Stub, nie still die echte Verbindung)
    const sitzung = 'messung-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    let kern = null;
    const anzeige = anzeigeHud(win, (t) => kern.sendeText(t), (dd) => kern.messeWeiter(dd));
    const env = {
      transport, matcher: () => ladeMatcher(win), stt: sttBrowser(win), mikrofon: mikrofonBrowser(win), audio: audioBrowser(win), anzeige,
      ...(transport.netz === true ? menueAnschluss(() => win.PultBefehl && win.PultBefehl.menue) : {}),   // nur am Spielnetz: nur dort erreichen die Antworten das Menü
      postMessung: (sit, eintrag) => win.fetch('/api/bot-messung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sitzung: sit, eintrag }) }).then((r) => { if (!r.ok) throw new Error('messung ' + r.status); }),
    };
    kern = erzeuge(env);
    if (!mockOk) anzeige.meldung(TEXT.mockVerboten);
    const T = win.Tasten;
    const passt = (e, id, fallback) => (T && T.passt ? T.passt(e, id) : e.code === fallback);
    const tippt = () => { const a = win.document.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')); };
    const runter = (e) => {
      if (!kern.istAn() || tippt()) return;
      if (passt(e, 'allgemein.sprechen', 'Backquote')) { e.preventDefault(); if (!e.repeat) kern.tasteRunter(); return; }
      if (passt(e, 'allgemein.botText', 'Backslash')) { e.preventDefault(); if (!e.repeat) anzeige.textzeile(true); return; }
      if (e.code === 'PageDown' || e.code === 'PageUp') { if (kern.messeWeiter(e.code === 'PageDown' ? 1 : -1)) e.preventDefault(); }
    };
    const hoch = (e) => { if (!kern.istAn()) return; const code = e && e.code; const ids = T && T.belegung ? T.belegung('allgemein.sprechen').map((t) => t.replace(/^Shift\+/, '')) : ['Backquote']; if (ids.indexOf(code) >= 0) kern.tasteHoch(); };
    const weg = () => kern.abbrechen();
    win.addEventListener('keydown', runter, true); win.addEventListener('keyup', hoch, true); win.addEventListener('blur', weg);
    instanz = { kern, anzeige, transport, aufraeumen() { win.removeEventListener('keydown', runter, true); win.removeEventListener('keyup', hoch, true); win.removeEventListener('blur', weg); } };
    kern.schalte(true);
    anzeige.hinweis(startHinweis(T));
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

  // BOT-01 C3: verarbeitet die Sprache die bot.antwort der Spielverbindung selbst? Dann zeigt public/js/pult-befehl.js sie nicht noch einmal (genau ein Verarbeiter je Antwort). Der Net-Transport (transportNet, BOT-04 D) setzt `netz: true`.
  const netAntworten = () => !!(instanz && instanz.transport && instanz.transport.netz === true);
  return { erzeuge, spitzeAusSamples, pegelAbdeckungReicht, PEGEL_MIN, PEGEL_START_MAX_MS, PEGEL_LUECKE_MAX_MS, PEGEL_ABDECKUNG_MIN, PEGEL_TAKT_MS, clipKandidaten, netAntworten, erwartungErfuellt, transportNet, menueAnschluss, mockUrlErlaubt, TEXT, MAX_MS, STIMMEN, CLIP_BASIS, transportWebSocket, transportNetStub, anzeigeHud, sprecherName, startHinweis, UNKLAR_DAUER_S, mikrofonBrowser, audioBrowser, sttBrowser, starte, stoppe, laeuft: () => !!instanz };
});
