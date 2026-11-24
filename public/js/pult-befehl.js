// BOT-01 C3: Befehlsmenü der Bots am Captain-Pult – Frontend und Anschluss (Spezifikation docs-bot01c-menue.md). Globales `PultBefehl`.
// Zustand und Regeln stecken in public/js/bot-menue.js (ohne DOM, getestet in tools/test-bot-menue.js); Maße, Farben, Texte und Plätze der Felder in public/js/pult-befehl-tokens.js;
// die Sprechformen kommen aus content/bots/kanon.json (hier per fetch geholt, wie der Matcher der Sprache). Dieses Modul
//   - zeichnet Crew-Zeile und Befehlstafel aus bot-menue.js (Pult-Baukasten: Pult.knopf, Pult.titel – keine neue Formsprache),
//   - fängt die Tasten (B, Sh+X/A/D/F/G/S, Q W E A S D Z X C R Rück, Esc) für Consoles.keyDown ab, BEVOR der Reiter-Zweig sie bekommt,
//   - sendet über Net (bot.befehl) und verarbeitet bot.antwort ohne Bot-Sprache: Untertitel über Hud.pushCrewFunk, Quittung am Knopf „Befehle“, „gilt“ je Rolle,
//   - schaltet die Sprechspalte für Bot-Antworten an, sobald Bots im Spiel sind (Hud.sprech.bots), auch wenn die Sprache aus ist.
// Reine Menschenpartie (keine Bots im Snapshot): nichts davon ist aktiv – kein Zeichnen, keine Tasten, keine Nachrichten, keine Zuteilung je Bild.
// Bot-Sprache an: verarbeitet sie die Antworten selbst (BotSprache.netAntworten()), zeigt dieses Modul sie nicht noch einmal (der Zustand bleibt trotzdem hier: Quittung und „gilt“ gelten für jeden Eingang).
(function () {
  'use strict';
  const R = window.Render, P = window.Pult, K0 = window.Consoles, H = window.Hud, T = window.Tasten, TK = window.PultBefehlTokens, BM = window.BotMenue;
  if (!R || !P || !K0 || !TK || !BM) return;
  const PROTO = window.Shared_Protocol || {};
  const C = PROTO.C || {};
  const TX = TK.TEXT, M = TK.MASS;
  const sfx = (n) => { try { const v = K0.view; if (v && v.actions && v.actions.sfx) v.actions.sfx(n); } catch (e) { /* Ton ist Beiwerk */ } };

  // ---------------------------------------------------------------- Werte vom Schiff (leere Felder, Zustandsworte)
  function schiff() { const v = K0.view; return v && v.state && v.state.ship ? v.state.ship : null; }
  function wertFrei(key, id) {
    const ship = schiff();
    if (!ship) return true;
    if (key === 'nav.schub:stufe' && /^\d+$/.test(id)) { const hi = K0.helmInfo(ship); return +id <= hi.stages.length - 1 - hi.stop; }   // Schubstufe über der Höchststufe: leeres Feld
    let m = /^lafette_(\d)$/.exec(id);
    if (m && K0.waffeAmPlatz) return !!K0.waffeAmPlatz(K0.view, +m[1]);   // Lafette ohne Waffe
    m = /^modul_(\d)$/.exec(id);
    if (m) return !!(ship.mod || [])[+m[1] - 1];   // leerer Modulraum
    return true;
  }
  function wertInfo(key, id) {
    if (key !== 'tech.reparieren:system' && key !== 'tech.prio:ziel') return null;
    const ship = schiff(), sys = ship && ship.systems ? ship.systems[id] : undefined;
    if (sys === undefined) return null;
    if (sys === 'broken') return { text: TX.zustandZer, stil: 'zer' };
    if (R.fragileOf && R.fragileOf(K0.view.state, id)) return { text: TX.zustandBesch, stil: 'besch' };
    return null;
  }

  // ---------------------------------------------------------------- Anschluss
  const menue = BM.erzeuge({
    kanon: { befehle: [] },   // kommt per fetch (ladeKanon)
    tokens: TK,
    uhr: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    senden: (m) => { try { return window.Net && Net.send ? Net.send(m) !== false : false; } catch (e) { return false; } },
    anzeige: {
      untertitel(text, info) { if (H && H.pushCrewFunk) H.pushCrewFunk(text, info && info.sprecher, P.FN.sensor); },
      denied(text) { K0.denied(text); },
      ton: sfx,
    },
    antwortenAnzeigen: () => !(window.BotSprache && BotSprache.netAntworten && BotSprache.netAntworten()),   // Sprache an und am Spielnetz: sie zeigt die Antwort, hier bleibt es still
    sprache: () => !!(window.BotSpracheStart && BotSpracheStart.an && BotSpracheStart.an()),
    kappe: (id) => (T && T.kappe ? T.kappe(id) : ''),
    stationVon: (p) => K0.stationOf(p),
    wertFrei, wertInfo,
    befehlTyp: C.BOT_BEFEHL || 'bot.befehl',
  });

  // Antworten des Servers: genau ein Verarbeiter je Antwort (dieses Modul für Zustand und, sofern die Sprache sie nicht zeigt, Untertitel)
  const ANTWORT = C.BOT_ANTWORT || 'bot.antwort';
  if (window.Net && Net.on) Net.on((m) => { if (m && m.t === ANTWORT) menue.antwort(m); });

  // Kanon laden (einmal, erst wenn Bots im Spiel sind; bei Fehlern nach 5 s noch einmal)
  let kanonLaedt = false, kanonFehlerT = 0;
  function ladeKanon() {
    if (kanonLaedt || menue.geladen() || typeof fetch !== 'function') return;
    const jetzt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (kanonFehlerT && jetzt - kanonFehlerT < 5000) return;
    kanonLaedt = true;
    fetch('/content/bots/kanon.json').then((r) => { if (!r.ok) throw new Error('kanon ' + r.status); return r.json(); })
      .then((k) => { menue.setzeKanon(k); kanonLaedt = false; })
      .catch(() => { kanonLaedt = false; kanonFehlerT = jetzt; });
  }

  // ---------------------------------------------------------------- Zeichnen
  const fnFarbe = (f) => P.FN[f] || f;
  const kuerze = (s, w) => { s = String(s); if (P.tw(s) <= w) return s; while (s.length > 2 && P.tw(s + '.') > w) s = s.slice(0, -1); return s + '.'; };   // wie Pult.zelle mit opts.rechts

  function crewZeile(c, K) {
    const CR = M.crew;
    c.fillStyle = P.rgba(K.dim, CR.trennerAlpha); c.fillRect(CR.x, CR.trenner, 572, 1);
    menue.crew().forEach((z, i) => {
      let text = z.text;
      if (z.textKurz) {   // Quittung: passt „NAVIGATION abgelehnt“ nicht neben die Kappe, die Kurzform der Rolle, sonst gekürzt
        const frei = CR.zw - Math.max(13, P.tw(P.kappe(null, z.aktion)) + 7) - 7;
        text = P.tw(text) <= frei ? text : P.tw(z.textKurz) <= frei ? z.textKurz : kuerze(z.textKurz, frei);
      }
      const onClick = i === 0 ? () => { sfxBefehl(menue.umschalten()); } : () => { const r = menue.taste(z.aktion, 'menu'); if (r.ok) sfx('ui_click'); };
      P.knopf(c, CR.x + i * (CR.zw + CR.sx), CR.y, CR.zw, CR.zh, z.label, { aktion: z.aktion, fn: z.fn, text, disabled: z.gesperrt, reason: z.grund, active: !!z.active, onClick });
    });
  }
  const sfxBefehl = (ok) => { if (ok) sfx('ui_click'); };

  function tafel(c, K, a) {
    const TA = M.tafel, RA = M.raster, F = TK.FARBE;
    if (R.ui.mouse && R.ui.mouse.x >= TA.x && R.ui.mouse.x < TA.x + TA.w && R.ui.mouse.y >= TA.y && R.ui.mouse.y < TA.y + TA.h) R.ui.tooltip = null;   // verdeckte Knöpfe darunter melden nichts
    c.fillStyle = K.bg; c.fillRect(TA.x - TA.deckeRand, TA.y - 1, TA.w + 2 * TA.deckeRand, TA.h + 1);
    const FG = a.faenger; R.ui.buttons.push({ x: FG.x, y: FG.y, w: FG.w, h: FG.h, label: '', disabled: false, onClick: null, hotkey: null });   // Klickfänger: vor den Feldern registriert, Klicks auf leere Felder und Lücken verpuffen hier (clickUi nimmt den zuletzt registrierten Treffer), nicht im verdeckten Reiter-Knopf
    const col = fnFarbe(a.fn), titelCol = a.fn === 'weapon' ? F.titelRot : col;   // roter TEXT nie in FN.weapon
    P.titel(c, TA.x, TA.y, TA.w, a.pfad, titelCol);
    // Restzeit: die Titellinie selbst läuft ab (voll = gerade bedient); rechts im Titel der Hinweis (mit Grund, damit die Linie nicht durch ihn läuft)
    const lx = TA.x + 6 + P.tw(a.pfad) + 4 + (K.id === 'germanen' ? 2 : 0), rw = P.tw(a.rechts.text) + 10, lEnde = TA.x + TA.w - rw;
    c.fillStyle = K.bg; c.fillRect(lEnde, TA.y, rw, 9);
    c.fillStyle = col; c.fillRect(lx, TA.y + 4, Math.max(0, Math.round((lEnde - 4 - lx) * a.rest)), 1);
    P.txt(c, a.rechts.text, TA.x + TA.w, TA.y + 1, a.rechts.stil === 'rot' ? F.titelRot : a.rechts.stil === 'warn' ? P.FN[F.sperrGrund] : K.dim, 'right');
    a.zellen.forEach((z, i) => {
      const r = Math.floor(i / RA.spalten), s = i % RA.spalten;
      if (a.fuss && r === 2) return;   // Fußzeile ersetzt Reihe 3
      const x = RA.x + s * (RA.zw + RA.sx), y = RA.y + r * (RA.zh + RA.sy);
      if (z.zustand === 'leer') { P.knopf(c, x, y, RA.zw, RA.zh, '', { aktion: z.aktion, disabled: true }); R.ui.buttons.pop(); return; }   // Raster bleibt sichtbar, ist aber kein Knopf (keine leeren Zeilen in der Hilfe)
      const aus = z.zustand === 'aus', zfn = z.zustand === 'frage' ? 'weapon' : z.fn;
      P.knopf(c, x, y, RA.zw, RA.zh, TX.labelVorsatz + z.text, { aktion: z.aktion, fn: zfn, text: z.text, disabled: aus, reason: aus ? TX.grundLang[z.grund] : undefined, active: z.zustand === 'gewaehlt' || z.zustand === 'frage', onClick: () => klick(z.feld) });
      if (z.info) {
        const zc = fnFarbe(zfn);
        let farbe = aus ? K.dim : K.id === 'rom' ? (zfn === 'weapon' ? K.ink : P.mix(K.ink, zc, F.infoMisch)) : (zfn === 'weapon' ? F.titelRot : zc);
        if (z.infoStil === 'zer') farbe = F.titelRot; else if (z.infoStil === 'besch') farbe = P.FN.warn;
        const kw = Math.max(13, P.tw(P.kappe(null, z.aktion)) + 7), frei = RA.zw - kw - 5 - P.tw(z.text) - 8 - RA.infoRechts;
        P.txt(c, kuerze(z.info, Math.max(0, frei)), x + RA.zw - RA.infoRechts, y + 3, farbe, 'right');
      }
    });
    if (a.fuss) P.txt(c, a.fuss, RA.x + 2, RA.y + 2 * (RA.zh + RA.sy) + 3, K.dim);
  }
  function klick(feld) { const r = menue.waehle(feld); if (r.art === 'stufe' || r.art === 'frage' || r.art === 'gesendet') sfx('ui_click'); return r; }

  // ---------------------------------------------------------------- Tasten (aus Consoles.keyDown, Station captain; e ist schon auf die Standardtaste der Aktion umgesetzt, Tasten.tastenKanon)
  const istStd = (e, id) => { const a = T && T.aktion ? T.aktion(id) : null, t = T && T.ausEvent ? T.ausEvent(e) : null; return !!(a && t && a.std.indexOf(t) >= 0); };
  function taste(e) {   // die Entscheidung trifft der Kern (menue.tastenDruck); hier nur die Zuordnung Ereignis -> Standardtaste und der Ton
    const r = menue.tastenDruck((id) => istStd(e, id));
    if (r.ton) sfx('ui_click');
    return r.geschluckt;
  }

  window.PultBefehl = {
    menue, taste,
    escape(e) { return menue.escape(!!(e && e.repeat)); },   // Esc: offene Tafel zu, die Konsole bleibt; gehaltenes Esc (Wiederholung) tut nichts; sonst darf die Konsole verlassen werden
    schliessen() { menue.schliessen(); },   // Station gewechselt oder verlassen (Consoles.stationAbbau)
    statusY() { return menue.hatBots() ? M.S.mitBots : M.S.ohneBots; },
    // je Bild aus client.js: Crew-Lage aus dem Snapshot, Sprechspalte für Antworten, Kanon laden. Ohne Bots nur eine Schleife über die Spieler.
    rahmen(state) {
      if (!state) return;
      menue.synchron(state.players, state.phase);
      const b = menue.hatBots();
      if (H && H.sprech && H.sprech.bots !== b) H.sprech.bots = b;
      if (b && !menue.geladen()) ladeKanon();
    },
    zeichne(c, view, g) {
      if (!menue.hatBots()) return;
      crewZeile(c, g.skin);
      const a = menue.ansicht();
      if (a) tafel(c, g.skin, a);
    },
    hatBots() { return menue.hatBots(); },
    sichtbar() { return menue.hatBots() && menue.istOffen(); },
    // Ego-Sitz, Blick VORN/CREW: das Pult ist nicht zu sehen, die offene Tafel erscheint als Einblendung am unteren Rand (Tafel und Crew-Zeile aus dem Pult-Puffer)
    einblenden(ctx, puffer) {
      if (!menue.hatBots() || !menue.istOffen()) return;
      ctx.save(); ctx.globalAlpha = M.einblendung.deckung;
      ctx.drawImage(puffer, 60, M.tafel.y - 1, 576, 346 - (M.tafel.y - 1), 60, M.tafel.y - 1, 576, 346 - (M.tafel.y - 1));
      ctx.restore();
    },
  };
})();
