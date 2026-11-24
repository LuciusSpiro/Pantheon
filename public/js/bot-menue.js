// BOT-01 C3: Befehlsmenü der Bots am Captain-Pult – Zustand und Regeln, ohne DOM, Canvas und Netz (Kern; Node-Test tools/test-bot-menue.js). Globales `BotMenue`.
// Schichten (Kais 3-Layer-Regel), analog bot-sprache.js:
//   Zustand (Storage)   `erzeuge(env)` hält Tafel (offen, Stufe, Rolle, Befehl, Seite, letzte Taste), Nachfrage, Quittung, „gilt“ je Rolle, ausstehende Befehle. EINE Stelle, die Zeichnen, Tasten und Hilfe lesen.
//   Regeln (Action)     benannte Funktionen je Absicht: oeffnen · zurueck · schliessen · waehle(feld) · blaettern · taste(aktion) · antwort(msg) · synchron(players, phase). Menü (quelle 'menu') und Direkttasten
//                       (quelle 'taste') rufen dieselbe Sende-Funktion; Verfügbarkeit (Bot da? Mensch an der Station?) rechnet hier eine Funktion, nicht das Pult.
//   Frontend            public/js/pult-befehl.js zeichnet aus `ansicht()` und `crew()` (Maße, Farben nur aus public/js/pult-befehl-tokens.js) und ruft die Funktionen auf.
// Beschriftung nur aus content/bots/kanon.json (Vertrag Bot-Befehle): Stufe 2 = anzeige mit {x} -> „…“, Stufe 3 = werte.<x>.<id>.wort, Crew-Zeile = kürzeste Form aus anzeige/kurz. Keine Sprechform im Code.
// „gilt“: es gibt kein Snapshot-Feld für die Absicht eines Bots (Vertrag §1: Absichten sind Serverzustand). Der Client merkt sich den zuletzt mit ok quittierten Befehl je Rolle; er verfällt, wenn der Bot weicht
// (Mensch an der Station, Bot weg), bei bot.automatik, bei Reset und beim Verlassen der Partie.
//
// env: { kanon, tokens, uhr?, senden(msg) -> bool, anzeige?: { untertitel(text, { rolle, sprecher, botId }), denied(text), ton?(name) }, antwortenAnzeigen?: () -> bool (false: ein anderer Verarbeiter, z. B. die Sprache, zeigt die
//        Untertitel; der Zustand wird trotzdem geführt), wertFrei?(key, wertId) -> bool (false: leeres Feld, z. B. Schubstufe über der Höchststufe), wertInfo?(key, wertId) -> { text, stil } | null,
//        kappe?(aktionId) -> Tastenname, sprache?: () -> bool (Fußzeile in Stufe 1), stationVon?(spieler) -> Konsole | null, befehlTyp?: 'bot.befehl' }
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BotMenue = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLLEN = ['navigation', 'ops', 'technik', 'bord'];   // Rollen mit Bot im Snapshot (players[].rolle); 'alle' ist keine Rolle
  const PLATZHALTER = /^\{(\w+)\}$/;
  const fuellen = (vorlage, ersatz) => String(vorlage).replace(/\{(\w+)\}/g, (_, k) => (ersatz && ersatz[k] != null ? ersatz[k] : ''));

  // ------------------------------------------------------------------ rein: Kanon
  // Schlüssel eines Eintrags: befehl, ':arg' bei Platzhalter, ':arg=wert' bei festem Wert (Vorrang vor dem Platzhalter), sonst nur der Befehl
  function schluesselVon(e) {
    const args = e.args || {}, namen = Object.keys(args);
    const fest = namen.filter((n) => !PLATZHALTER.test(String(args[n])));
    const platz = namen.filter((n) => PLATZHALTER.test(String(args[n])));
    if (fest.length) return e.befehl + ':' + fest[0] + '=' + args[fest[0]];
    if (platz.length) return e.befehl + ':' + platz[0];
    return e.befehl;
  }
  // Platzhalter-Argument eines Eintrags: { arg, werte } (werte = kanon werte.<name>) oder null
  function platzVon(e) {
    for (const n of Object.keys(e.args || {})) { const m = PLATZHALTER.exec(String(e.args[n])); if (m) return { arg: n, name: m[1], werte: (e.werte || {})[m[1]] || {} }; }
    return null;
  }
  function indexVon(kanon) {
    const m = new Map();
    for (const e of (kanon && kanon.befehle) || []) m.set(schluesselVon(e), e);
    return m;
  }
  const sprechform = (e, wertId) => {   // ganze Sprechform, z. B. „Kurs auf das Ziel“
    const p = platzVon(e);
    return p ? fuellen(e.anzeige, { [p.name]: p.werte[wertId] ? p.werte[wertId].wort : '' }) : e.anzeige;
  };
  const kuerzeste = (e) => [e.anzeige].concat(e.kurz || []).reduce((a, b) => (b.length < a.length ? b : a));
  const zahlWert = (v) => (/^(?:0|[1-9]\d{0,5})$/.test(String(v)) ? Number(v) : v);

  // ------------------------------------------------------------------ Kern
  function erzeuge(env) {
    const T = env.tokens, LAGE = T.LAGE, TX = T.TEXT, Z = T.ZEIT;
    const uhr = env.uhr || (() => Date.now());
    const A = env.anzeige || {};
    const befehlTyp = env.befehlTyp || 'bot.befehl';
    const kappe = (id) => { try { return env.kappe ? env.kappe(id) : ''; } catch (e) { return ''; } };
    const stationVon = env.stationVon || ((p) => (p && p.console ? (p.station || p.console) : null));
    let index = indexVon(env.kanon);
    let befehlEintrag = new Map(); for (const e of index.values()) if (!befehlEintrag.has(e.befehl)) befehlEintrag.set(e.befehl, e);
    const s = { offen: false, stufe: 1, rolle: null, key: null, seite: 0, letzte: 0, frage: null, grund: null, quittung: null, gilt: {}, botsN: 0, aktiv: false, ausstehend: [], botRolle: {} };
    const rollen = {}; for (const r of ROLLEN) rollen[r] = { bot: false, mensch: false };
    const LEER = [];

    function setzeKanon(k) {
      index = indexVon(k);
      befehlEintrag = new Map(); for (const e of index.values()) if (!befehlEintrag.has(e.befehl)) befehlEintrag.set(e.befehl, e);
    }
    const geladen = () => index.size > 0;

    // ---- Lage der Crew aus dem Snapshot (players[].bot === 1, players[].rolle; Menschen tragen diese Felder nicht). Keine Zuteilung je Aufruf, solange keine Bots da sind.
    function synchron(players, phase) {
      let n = 0;
      for (let i = 0; i < ROLLEN.length; i++) { const r = rollen[ROLLEN[i]]; r.bot = false; r.mensch = false; }
      const liste = players || LEER;
      for (let i = 0; i < liste.length; i++) { const p = liste[i]; if (p && p.bot && p.connected !== false) { n++; const r = rollen[p.rolle]; if (r) r.bot = true; } }
      if (n > 0) {
        for (let i = 0; i < liste.length; i++) {
          const p = liste[i];
          if (!p || p.bot || p.connected === false) continue;
          const st = stationVon(p);
          if (!st) continue;
          for (let k = 0; k < ROLLEN.length; k++) if (LAGE.station[ROLLEN[k]] === st) rollen[ROLLEN[k]].mensch = true;
        }
      }
      if (phase != null && phase !== 'play') n = 0;   // Lobby und Ende: keine Crew, nichts senden
      s.botsN = n;
      if (n === 0) { if (s.aktiv) reset(); return; }
      s.aktiv = true;
      for (let k = 0; k < ROLLEN.length; k++) { const r = ROLLEN[k]; if (!rollen[r].bot || rollen[r].mensch) delete s.gilt[r]; }   // der Bot weicht (Mensch an der Station) oder fehlt: seine Absicht gilt nicht mehr
    }
    function reset() {
      s.aktiv = false; schliesse(); s.gilt = {}; s.quittung = null; s.ausstehend.length = 0; s.botRolle = {};
    }

    // ---- Verfügbarkeit: null = möglich, sonst Schlüssel des Grundes (TEXT.grund)
    function sperrGrund(an) {
      if (an === 'alle') return s.botsN > 0 ? null : 'keineBots';
      if (an === 'bord') return rollen.bord.bot ? null : 'aussen';
      const r = rollen[an];
      if (!r || !r.bot) return 'keinBot';
      return r.mensch ? 'mensch' : null;
    }

    // ---- Zeit: abgelaufene Dinge wegräumen (vor jedem Lesen und jeder Aktion)
    const quittungsDauer = (q) => (q.phase === 'gesendet' ? Z.warten + Z.keineAntwort : q.phase === 'aye' ? Z.aye : Z.nein);
    function aktualisiere() {
      const t = uhr();
      if (s.offen && t - s.letzte > Z.autoZu) schliesse();
      if (s.frage && t >= s.frage.bis) s.frage = null;
      if (s.grund && t >= s.grund.bis) s.grund = null;
      if (s.quittung && t - s.quittung.t >= quittungsDauer(s.quittung)) s.quittung = null;
      while (s.ausstehend.length && t - s.ausstehend[0].t > Z.ausstehend) s.ausstehend.shift();
    }
    const beruehrt = () => { s.letzte = uhr(); };

    // ---- Tafel
    function oeffnen() {
      aktualisiere();
      if (s.offen) return false;
      if (s.botsN === 0) { verweigere(TX.grundLang.keineBots); return false; }
      if (!geladen()) { verweigere(TX.grund.laedt); return false; }
      s.offen = true; s.stufe = 1; s.rolle = null; s.key = null; s.seite = 0; s.frage = null; s.grund = null; beruehrt();
      if (A.ton) A.ton('ui_click');
      return true;
    }
    function schliesse() { s.offen = false; s.stufe = 1; s.rolle = null; s.key = null; s.seite = 0; s.frage = null; s.grund = null; }
    function schliessen() { const war = s.offen; schliesse(); return war; }
    // eine Stufe zurück; auf Stufe 1 schließt die Tafel
    function zurueck() {
      aktualisiere();
      if (!s.offen) return false;
      s.frage = null;
      if (s.stufe === 3) { s.stufe = 2; s.key = null; s.seite = 0; beruehrt(); }
      else if (s.stufe === 2) { s.stufe = 1; s.rolle = null; beruehrt(); }
      else schliesse();
      return true;
    }
    // B: zu -> auf, auf -> eine Stufe zurück
    function umschalten() { aktualisiere(); return s.offen ? zurueck() : oeffnen(); }
    function verweigere(text) { s.grund = { text, bis: uhr() + Z.sperrGrund }; if (A.denied) A.denied(text); }

    const seitenVon = (key) => { const l = LAGE.stufe3[key]; return Array.isArray(l) ? l : l ? [l] : []; };
    function blaettern() {
      aktualisiere();
      if (!s.offen || s.stufe !== 3) return false;
      const n = seitenVon(s.key).length;
      if (n < 2) return false;
      s.seite = (s.seite + 1) % n; beruehrt();
      return true;
    }

    // ---- Befehl senden (Menü und Taste rufen dieselbe Funktion)
    function sende(e, wertId, quelle) {
      const grund = sperrGrund(e.an);
      if (grund) { verweigere(TX.grundLang[grund]); return false; }
      const args = {}, p = platzVon(e);
      for (const n of Object.keys(e.args || {})) args[n] = p && n === p.arg ? zahlWert(wertId) : e.args[n];
      const msg = { t: befehlTyp, an: e.an, befehl: e.befehl, quelle };
      if (Object.keys(args).length) msg.args = args;
      let ok = false;
      try { ok = env.senden(msg) !== false; } catch (err) { ok = false; }
      if (!ok) { verweigere('Keine Verbindung zum Spiel'); return false; }
      const jetzt = uhr();
      s.ausstehend.push({ t: jetzt, an: e.an, befehl: e.befehl, erwartet: e.an === 'alle' ? Math.max(1, s.botsN) : 1, ok: 0, nein: 0, fertig: false,
        gilt: { key: schluesselVon(e), wert: p ? String(wertId) : null, sprech: sprechform(e, wertId) } });
      s.quittung = { an: e.an, phase: 'gesendet', t: jetzt };
      return true;
    }
    // Direkttaste (Aktion in tasten.js; quelle 'taste', beim Klick auf den Knopf der Crew-Zeile 'menu'): { ok, grund? }
    function taste(aktionId, quelle) {
      aktualisiere();
      const d = LAGE.direkt.find((x) => x.aktion === aktionId);
      const e = d ? index.get(d.key) : null;
      if (!e) return { ok: false };
      if (s.botsN === 0) { verweigere(TX.grundLang.keineBots); return { ok: false, grund: 'keineBots' }; }
      const grund = sperrGrund(e.an);
      const ok = !grund && sende(e, null, quelle || 'taste');
      if (grund) verweigere(TX.grundLang[grund]);
      if (ok) schliesse();
      return { ok, grund: grund || undefined };
    }

    // ---- Felder der Tafel
    const feldAktion = (f) => T.FELD_AKTION[f];
    const gilt = (rolle) => s.gilt[rolle] || null;
    const name2 = (key, e) => TX.name2[key] || e.anzeige.replace(/\{\w+\}/g, TX.mehr);
    const fnBefehl = (e) => T.FN_BEFEHL[e.befehl] || 'neutral';
    const leerFeld = (f) => ({ feld: f, aktion: feldAktion(f), zustand: 'leer', text: '', fn: 'neutral', info: '' });
    const rolleFn = (r) => T.FARBE.rolle[r];

    function zellen() {
      const out = [];
      if (s.stufe === 1) {
        for (const f of T.FELDER) {
          const r = LAGE.stufe1[f];
          if (!r) { out.push(leerFeld(f)); continue; }
          const grund = sperrGrund(r === 'alle' ? 'alle' : r);
          const g = r === 'alle' ? null : gilt(r);
          const info = grund ? TX.grund[grund] : r === 'alle' ? fuellen(s.botsN === 1 ? TX.bots.eins : TX.bots.mehr, { n: s.botsN }) : g ? g.sprech : '';
          out.push({ feld: f, aktion: feldAktion(f), zustand: grund ? 'aus' : 'bereit', text: TX.rolle[r], fn: rolleFn(r), info, rolle: r, grund: grund || undefined });
        }
      } else if (s.stufe === 2) {
        const plan = LAGE.stufe2[s.rolle] || {}, g = s.rolle === 'alle' ? null : gilt(s.rolle), jetzt = uhr();
        for (const f of T.FELDER) {
          const key = plan[f], e = key ? index.get(key) : null;
          if (!e) { out.push(leerFeld(f)); continue; }
          const frage = TX.frage[key] && s.frage && s.frage.key === key && jetzt < s.frage.bis;
          const istGilt = !!(g && g.key === key);
          out.push({
            feld: f, aktion: feldAktion(f), key, fn: fnBefehl(e),
            zustand: frage ? 'frage' : istGilt ? 'gewaehlt' : 'bereit',
            text: frage ? TX.frage[key] : name2(key, e),
            info: frage ? fuellen(TX.frageInfo, { taste: kappe(feldAktion(f)) }) : istGilt ? TX.gilt : '',
            weiter: !!platzVon(e),
          });
        }
      } else {
        const e = index.get(s.key), p = e ? platzVon(e) : null, seiten = seitenVon(s.key), tabelle = seiten[Math.min(s.seite, Math.max(0, seiten.length - 1))] || {};
        const g = s.rolle === 'alle' ? null : gilt(s.rolle);
        for (const f of T.FELDER) {
          const id = tabelle[f];
          if (!e || !p || id == null || !p.werte[id]) { out.push(leerFeld(f)); continue; }
          if (env.wertFrei && env.wertFrei(s.key, id) === false) { out.push(leerFeld(f)); continue; }   // das Schiff hat den Wert nicht: leeres Feld, der Platz bleibt fest
          const istGilt = !!(g && g.key === s.key && g.wert === String(id));
          const wi = env.wertInfo ? env.wertInfo(s.key, id) : null;
          out.push({ feld: f, aktion: feldAktion(f), zustand: istGilt ? 'gewaehlt' : 'bereit', text: p.werte[id].wort, fn: fnBefehl(e), info: istGilt ? TX.gilt : wi ? wi.text : '', infoStil: istGilt ? undefined : wi ? wi.stil : undefined, wert: id });
        }
      }
      return out;
    }

    // Ansicht der offenen Tafel (null = zu): alles, was das Frontend zum Zeichnen braucht
    function ansicht() {
      aktualisiere();
      if (!s.offen) return null;
      const e = s.stufe === 3 ? index.get(s.key) : null;
      let pfad = TX.titel, fn = 'cmd';
      if (s.stufe >= 2) { pfad += TX.trenner + TX.rolleName[s.rolle]; fn = rolleFn(s.rolle); }
      if (e) { pfad += TX.trenner + name2(s.key, e).toUpperCase(); fn = fnBefehl(e); }
      const seiten = s.stufe === 3 ? seitenVon(s.key) : LEER;
      let rechts = { text: s.stufe === 1 ? TX.rechts.stufe1 : TX.rechts.sonst, stil: 'dim' };
      if (seiten.length > 1) {
        const name = (TX.seiten[s.key] || [])[s.seite] || '';
        rechts = { text: fuellen(name ? TX.rechts.seite : TX.rechts.seiteOhneName, { n: s.seite + 1, m: seiten.length, name }), stil: 'dim' };
      }
      if (s.frage && uhr() < s.frage.bis) rechts = { text: fuellen(TX.rechts.frage, { taste: kappe(s.frage.aktion) }), stil: 'rot' };
      if (s.grund) rechts = { text: s.grund.text, stil: 'warn' };
      const rest = Math.max(0, Math.min(1, 1 - (uhr() - s.letzte) / Z.autoZu));
      return {
        stufe: s.stufe, rolle: s.rolle, pfad, fn, rechts, rest, seite: s.seite, seiten: seiten.length,
        zellen: zellen(), faenger: T.MASS.faenger,
        fuss: s.stufe === 1 && env.sprache && env.sprache() ? fuellen(TX.fussSprache, { taste: kappe('allgemein.sprechen') }) : null,
      };
    }

    // Feld gedrückt (Taste oder Klick): { art: 'zu' | 'leer' | 'sperre' | 'stufe' | 'frage' | 'gesendet' | 'fehlt' }
    function waehle(feld) {
      aktualisiere();
      if (!s.offen) return { art: 'zu' };
      beruehrt();
      const z = zellen().find((x) => x.feld === feld);
      if (!z || z.zustand === 'leer') return { art: 'leer' };
      if (s.stufe === 1) {
        if (z.zustand === 'aus') { verweigere(TX.grundLang[z.grund]); return { art: 'sperre', grund: z.grund }; }
        s.stufe = 2; s.rolle = z.rolle; s.key = null; s.seite = 0;
        return { art: 'stufe' };
      }
      if (s.stufe === 2) {
        const e = index.get(z.key);
        if (z.weiter) { s.stufe = 3; s.key = z.key; s.seite = 0; return { art: 'stufe' }; }
        if (TX.frage[z.key]) {   // Nachfrage (Reaktor überladen): der erste Druck fragt, derselbe Druck binnen 3 s sendet
          if (s.frage && s.frage.key === z.key && uhr() < s.frage.bis) { s.frage = null; return fertig(sende(e, null, 'menu')); }
          s.frage = { key: z.key, aktion: z.aktion, bis: uhr() + Z.frage };
          return { art: 'frage' };
        }
        return fertig(sende(e, null, 'menu'));
      }
      const e = index.get(s.key);
      return fertig(sende(e, z.wert, 'menu'));
    }
    function fertig(ok) { if (ok) { schliesse(); return { art: 'gesendet' }; } return { art: 'fehlt' }; }

    // ---- Tasten (Consoles.keyDown, Station captain): EINE Entscheidung, ohne Tastencodes. ist(aktionId) -> bool sagt, ob die Taste die Standardtaste dieser Aktion ist.
    // Ohne Bots: nichts (die Tasten gehören den Reitern). Tafel offen: Q W E A S D Z X C wählen, R blättert, Rück/B eine Stufe zurück, die Direkttasten gelten weiter,
    // ALLES ANDERE wird geschluckt (der Reiter-Bereich ruht; Ziffern, Zoom, Hilfe, Tab und Esc kommen vorher bzw. nachher in consoles.js und erreichen diese Funktion nicht).
    // Tafel zu: B öffnet, die Direkttasten senden, sonst nichts. Ergebnis { geschluckt, ton }.
    function tastenDruck(ist) {
      if (s.botsN === 0) return { geschluckt: false, ton: false };
      aktualisiere();
      if (s.offen) {
        for (const f of T.FELDER) if (ist(T.FELD_AKTION[f])) { const r = waehle(f); return { geschluckt: true, ton: r.art === 'stufe' || r.art === 'frage' || r.art === 'gesendet' }; }
        if (ist('captain.befehl.weiter')) return { geschluckt: true, ton: blaettern() };
        if (ist('captain.befehl.zurueck') || ist('captain.befehl')) return { geschluckt: true, ton: zurueck() };
      } else if (ist('captain.befehl')) return { geschluckt: true, ton: oeffnen() };
      for (const d of LAGE.direkt) if (ist(d.aktion)) return { geschluckt: true, ton: taste(d.aktion).ok };   // Direkttasten: immer geschluckt, der Reiter-Zweig kennt kein Shift
      return { geschluckt: s.offen, ton: false };
    }
    // Esc: Wiederholung (gehaltene Taste) tut nichts, solange Bots da sind; ein neuer Druck schließt die offene Tafel. true = Esc ist verbraucht, false = die Konsole darf verlassen werden.
    function escape(wiederholt) {
      if (s.botsN === 0) return false;
      if (wiederholt) return true;
      return schliessen();
    }

    // ---- Crew-Zeile (unter den Pult-Spalten, solange Bots da sind): Knopf „Befehle“ (zugleich Quittung) und die Direkttasten
    function quittungJetzt() {
      const q = s.quittung;
      if (!q) return null;
      const dt = uhr() - q.t;
      let phase = q.phase;
      if (phase === 'gesendet' && dt >= Z.warten) phase = 'still';
      if (dt >= quittungsDauer(q)) return null;
      const key = phase === 'still' ? 'still' : phase;
      return { phase, an: q.an, text: fuellen(TX.quittung[key], { ROLLE: TX.rolleName[q.an] || TX.unbekannterSprecher }), textKurz: fuellen(TX.quittung[key], { ROLLE: TX.rolleKurz[q.an] || TX.unbekannterSprecher }), fn: T.FARBE.quittung[phase === 'still' ? 'gesendet' : phase] };
    }
    function crew() {
      aktualisiere();
      const q = quittungJetzt();
      const out = [{ aktion: 'captain.befehl', label: TX.befehleKnopf, text: q ? q.text : TX.befehleKnopf, textKurz: q ? q.textKurz : TX.befehleKnopf, fn: q ? q.fn : 'cmd', active: s.offen, quittung: q ? q.phase : null, gesperrt: false }];
      for (const d of LAGE.direkt) {
        const e = index.get(d.key);
        const grund = !e ? 'laedt' : sperrGrund(e.an);
        out.push({ aktion: d.aktion, label: e ? e.anzeige : '', text: e ? kuerzeste(e) : '', fn: d.fn, gesperrt: !!grund, grund: grund ? (TX.grundLang[grund] || TX.grund[grund]) : undefined, an: e ? e.an : null });
      }
      return out;
    }

    // ---- bot.antwort (vom Server, für jeden Eingang): Quittung, „gilt“ und Untertitel. Genau ein Verarbeiter je Antwort: der Zustand gehört diesem Modul,
    // die Anzeige kann einem anderen Verarbeiter (Sprache) gehören (env.antwortenAnzeigen() === false)
    function antwort(msg) {
      if (!msg || msg.t !== 'bot.antwort') return { verarbeitet: false };
      aktualisiere();
      const jetzt = uhr(), status = msg.status, gut = status === 'ok' || status === 'erledigt';
      let p = null;
      for (let i = s.ausstehend.length - 1; i >= 0; i--) { const q = s.ausstehend[i]; if (!q.fertig && (!msg.befehl || q.befehl === msg.befehl)) { p = q; break; } }
      const e = msg.befehl ? befehlEintrag.get(msg.befehl) : null;
      const an = p ? p.an : e ? e.an : null;
      const rolle = an && an !== 'alle' ? an : null;
      if (rolle && typeof msg.botId === 'string' && msg.botId) s.botRolle[msg.botId] = rolle;
      const sprecher = rolle || (msg.botId && s.botRolle[msg.botId]) || null;
      if (p) { if (gut) p.ok++; else p.nein++; if (p.ok + p.nein >= p.erwartet) p.fertig = true; }
      if (an) {
        const setze = (phase) => { s.quittung = { an, phase, t: jetzt }; };
        if (p && p.an === 'alle') { if (!gut) setze('nein'); else if (p.nein === 0 && p.ok >= p.erwartet) setze('aye'); }
        else setze(gut ? 'aye' : 'nein');
      }
      if (p && status === 'ok') {
        if (p.befehl === 'bot.automatik') s.gilt = {};
        else if (rolle && !/^bot\./.test(p.befehl)) s.gilt[rolle] = p.gilt;
      }
      const text = typeof msg.text === 'string' && msg.text ? msg.text : String(msg.textId || '');
      const zeigen = !!text && (!env.antwortenAnzeigen || env.antwortenAnzeigen() !== false);
      if (zeigen && A.untertitel) { try { A.untertitel(text, { rolle: sprecher, sprecher: TX.rolleName[sprecher] || TX.unbekannterSprecher, botId: msg.botId }); } catch (err) { /* Anzeige darf nie brechen */ } }
      return { verarbeitet: true, angezeigt: zeigen };
    }

    return {
      synchron, reset, setzeKanon, geladen, oeffnen, umschalten, zurueck, schliessen, waehle, blaettern, taste, tastenDruck, escape, antwort, ansicht, crew, aktualisiere,
      istOffen: () => { aktualisiere(); return s.offen; }, hatBots: () => s.botsN > 0, botsZahl: () => s.botsN, rollenStand: () => rollen, giltVon: gilt,
      lies: () => ({ offen: s.offen, stufe: s.stufe, rolle: s.rolle, key: s.key, seite: s.seite, gilt: s.gilt, ausstehend: s.ausstehend.length, aktiv: s.aktiv }),
    };
  }

  return { erzeuge, schluesselVon, platzVon, indexVon, sprechform, kuerzeste, fuellen };
});
