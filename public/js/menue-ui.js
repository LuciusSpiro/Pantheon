// CHA-01 E: Oberfläche des Startmenüs nach MEN-01 Richtung A „Rampe“ (Frontend-Layer, Kais 3-Layer-Regel): Titelbild, Hauptmenü, Crew-Lobby, Einladung.
// Zeichnet nur und bildet Tasten auf Actions ab: Zustand und Regeln stehen in MenueFluss (public/js/menue.js), Charakterzustand in Charaktere,
// Lobby-Zusatzoptionen sind die Actions von Client.actions (toggleWellenKarte, laborWahl …). Gestaltung ausschließlich aus Menue.TOKENS (menue-tokens.js)
// und der Referenzzeichnung public/kammer-preview.html (Titel, Hauptmenü, Lobby); die Einladung folgt dem Mockup MEN-01 a-rampe-beitritt.
// Das Key-Art liegt als eigene Bildebene unter dem Canvas (<img id="keyart">, Client schaltet sie über ebene()); der Canvas ist hier durchsichtig und zeichnet
// nur Abdunklung (VERLAUF) und Daten.
// Globales `MenueUi`: zeichne(ctx, view), taste(e, view) -> true wenn verbraucht, ebene(view) -> { datei, hell, schirm } (Bildebene des aktuellen Bildschirms).
(function () {
  'use strict';
  const R = window.Render, P = window.Pult, ME = window.Menue, F = window.MenueFluss, H = window.Hud;
  const MT = ME.TOKENS, MF = MT.FARBE, MM = MT.MASS, MX = MT.TEXT, MS = MT.SCHRIFT, T = F.TEXT;
  const VW = 640, VH = 360;

  // ---------------------------------------------------------------- Grundformen (Referenz kammer-preview.html)
  const rect = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const rand = (c, x, y, w, h, col) => { rect(c, x, y, w, 1, col); rect(c, x, y + h - 1, w, 1, col); rect(c, x, y, 1, h, col); rect(c, x + w - 1, y, 1, h, col); };
  const rand2 = (c, x, y, w, h, col, d) => { for (let i = 0; i < d; i++) rand(c, x + i, y + i, w - 2 * i, h - 2 * i, col); };
  const dash = (c, x, y, w, h, col, s) => { c.fillStyle = col; for (let i = 0; i < w; i += s) { c.fillRect(x + i, y, 1, 1); c.fillRect(x + i, y + h - 1, 1, 1); } for (let i = 0; i < h; i += s) { c.fillRect(x, y + i, 1, 1); c.fillRect(x + w - 1, y + i, 1, 1); } };
  const hatch = (c, x, y, w, h, col, s) => { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.fillStyle = col; for (let d = -h; d < w; d += s) for (let r = 0; r < h; r++) c.fillRect(x + d + r, y + r, 1, 1); c.restore(); };
  const txt = (c, s, x, y, col, align, scale) => { R.text(c, String(s), x, y, { color: col, align: align || 'left', scale: scale || 1, shadow: false }); return x + R.measure(String(s), scale || 1); };
  function txtSp(c, s, x, y, col, sp, scale, align) {
    const L = ME.sperrung(s, sp, scale || 1, (z, sk) => R.measure(z, sk));
    const x0 = align === 'center' ? x - Math.round(L.w / 2) : align === 'right' ? x - L.w : x;
    for (const z of L.zeichen) R.text(c, z.z, x0 + z.x, y, { color: col, scale: scale || 1, shadow: false });
    return x0 + L.w;
  }
  const breite = (s, sk) => R.measure(String(s), sk || 1);
  const fit = (s, w, sk) => H.fit(s, w, sk || 1);
  function raster(c, zeilen, x, y, s, col, kern) { for (const r of ME.raster(zeilen, s)) rect(c, x + r.x, y + r.y, r.w, r.h, r.kern ? kern : col); }
  const klick = (r, label, fn) => R.ui.buttons.push({ x: r.x, y: r.y, w: r.w, h: r.h, label, onClick: fn });

  // ---------------------------------------------------------------- Bausteine
  const kachelM = (c, x, y, w, h) => { rect(c, x, y, w, h, P.rgba(MF.kachel, MM.kachelDeckkraft)); rand(c, x, y, w, h, MF.kachelRand); };
  function kappeM(c, x, y, k, bg, ink) {
    const K = MM.kappe, w = Math.max(K.minW, breite(k) + K.innen);
    P.cham(c, x, y, w, K.h, bg || MF.kappe, K.schraeg, 0, K.schraeg, 0); txt(c, k, x + w / 2, y + 3, ink || MF.kappeText, 'center');
    return x + w;
  }
  // Hinweisreihe: [Kappe Text] …; hoechstens bis maxX (was nicht mehr passt, entfällt). Gibt das Ende zurück
  function hinweise(c, x, y, liste, maxX) {
    for (const [k, t] of liste) {
      const w = Math.max(MM.kappe.minW, breite(k) + MM.kappe.innen) + 4 + breite(t);
      if (maxX && x + w > maxX) break;
      x = kappeM(c, x, y, k) + 4; x = txt(c, t, x, y + 3, MF.dim) + 12;
    }
    return x;
  }
  function knopfGold(c, x, y, w, k, t, onClick) {
    const K = MM.knopf; P.cham(c, x, y, w, K.h, MF.gold, K.schraeg, 0, K.schraeg, 0);
    const kw = Math.max(15, breite(k) + 8); P.cham(c, x + K.kappeInnen, y + K.kappeInnen, kw, K.kappeH, MF.tinte, 3, 0, 3, 0);
    txt(c, k, x + K.kappeInnen + kw / 2, y + 6, MF.gold, 'center'); txt(c, t, x + kw + 9, y + 7, MF.tinte);
    if (onClick) klick({ x, y, w, h: K.h }, t, onClick);
  }
  function lockup(c) { const L = MM.lockup; raster(c, MT.MARKE, L.x, L.y, L.marke, MF.messing, MF.gold); raster(c, MT.SCHRIFTZUG.raster, L.x + 16 * L.marke + L.abstand, L.y + L.schriftzugY, 1, MF.text); }
  // Stempel: Rand 2 px (durchgezogen bzw. gestrichelt) + Wort; voll = Fläche + Tinte. links = linke Kante statt Mitte
  function stempel(c, art, x, y, links) {
    const S = MT.STEMPEL, st = S[art], col = MF[st.farbe], tw = ME.sperrung(st.wort, 1, 1, (z, sk) => R.measure(z, sk)).w, w = tw + 2 * S.innen;
    if (!links) x = Math.round(x - w / 2);
    if (st.voll) { rect(c, x, y, w, S.h, col); txtSp(c, st.wort, x + S.innen, y + S.textY, MF.tinte, 1); return; }
    rect(c, x, y, w, S.h, MF.karte);
    if (st.gestrichelt) { c.fillStyle = col; for (let i = 0; i < w; i += S.strich) { c.fillRect(x + i, y, Math.min(2, w - i), S.rand); c.fillRect(x + i, y + S.h - S.rand, Math.min(2, w - i), S.rand); } for (let i = 0; i < S.h; i += S.strich) { c.fillRect(x, y + i, S.rand, Math.min(2, S.h - i)); c.fillRect(x + w - S.rand, y + i, S.rand, Math.min(2, S.h - i)); } }
    else rand2(c, x, y, w, S.h, col, S.rand);
    txtSp(c, st.wort, x + S.innen, y + S.textY, col, 1);
  }
  // Abdunklung über dem Bild (VERLAUF): von links und von unten; das Bild selbst ist die Ebene darunter
  function verlauf(c, schirm) {
    const v = MT.VERLAUF[schirm];
    const gl = c.createLinearGradient(0, 0, VW, 0); v.links.forEach(([p, a]) => gl.addColorStop(p, P.rgba(MF.grund, a))); c.fillStyle = gl; c.fillRect(0, 0, VW, VH);
    const gu = c.createLinearGradient(0, v.unten.ab, 0, VH); gu.addColorStop(0, P.rgba(MF.grund, 0)); gu.addColorStop(1, P.rgba(MF.grund, v.unten.bis)); c.fillStyle = gu; c.fillRect(0, v.unten.ab, VW, VH - v.unten.ab);
  }

  // ---------------------------------------------------------------- Daten aus Spiel und Charakteren (nur lesen)
  const proto = () => window.Shared_Protocol || {};
  const lobbyVon = (view) => (view.state && view.state.lobby) || {};
  const spielerVon = (view) => ((view.state && view.state.players) || []);
  const ichVon = (view) => spielerVon(view).find((p) => p.id === view.pid) || null;
  const label = (modus) => (proto().START_LABELS && proto().START_LABELS[modus]) || String(modus || '');
  const hinweisText = (modus) => (proto().START_HINTS && proto().START_HINTS[modus]) || '';
  const code = () => (window.Net && Net.serverRoomCode) || null;
  const kartenMap = () => (window.Client && Client.karten) || {};
  const aktiveKarte = () => (window.Charaktere ? Charaktere.aktiveKarte() : null);
  const spielerFarbe = (p) => ME.spieler(p && p.color != null ? p.color : 0);
  function portraet(c, r, karte) { if (window.KammerBausteine) KammerBausteine.portraetIn(c, r, karte, MF.formPlatte); else rect(c, r.x, r.y, r.w, r.h, MF.formPlatte); }
  const oberteil = (karte) => (karte && karte.outfit && window.Charaktere ? Charaktere.teilName('oberteil', karte.outfit.oberteil) : '');

  // Modus der Lobby als Anzeigetext: { art, titel, satz }; mit gewähltem Weltstand der Weltstand
  function modusAnzeige(lob) {
    const welt = F.welten(lob).find((w) => w.id === lob.world) || null;
    if (welt) return { art: T.lobby.fortsetzenVon + ' · ' + String(H.missionLabel(welt.mission, welt.step)).toUpperCase(), titel: String(welt.name || welt.id), satz: H.playLabel(welt.playTime) + ' · ' + H.locLabel(welt.loc), welt };
    const modus = lob.startMission || 'm1', e = F.eintragZuModus(modus), ws = F.weltstaende(lob);
    const mitWelt = e && e.weltstand, voll = !!(mitWelt && ws.voll);
    const wert = mitWelt ? (voll ? ME.text(T.detail.weltstandVollKurz, { max: ws.max }) : ME.text(T.detail.neuerWeltstand, { n: ws.naechste, max: ws.max })) : T.detail.keinWeltstand;
    const m = { art: (e ? e.art : T.lobby.gruppeModus) + ' · ' + wert.toUpperCase(), titel: label(modus), satz: [hinweisText(modus)].concat(zusatzSatz(modus, lob)).filter(Boolean).join(' · '), welt: null, warnung: voll ? ME.text(T.detail.weltstandVollLang, { max: ws.max }) : null };
    if (modus === 'labor') {   // Labor: die gewählte Umsetzung steht als Titel (voller Name), Position und Einzelheiten darunter
      const la = F.laborAuswahl(lob), le = la.eintrag;
      if (le) {
        m.art = e.art + ' · ' + label(modus).toUpperCase() + ' · ' + la.position + '/' + la.n; m.titel = le.name || le.id;
        m.satz = [le.schauplatz === 'aussen' ? T.opt.laborBoden : T.opt.laborRaum, le.kartenarten && le.kartenarten.length ? le.kartenarten.join('/') : '', le.landepunkt || (le.ort ? H.locLabel(le.ort) : ''), le.startzustand ? ME.text(T.opt.laborStart, { z: le.startzustand }) : ''].filter(Boolean).join(' · ');
      }
    }
    return m;
  }
  // Was die Lobby zum Modus noch zeigte (Hinweiszeile unter dem Titel): Wellen Seed fest / neu je Start und letzter Stand (Abschnitte des Grabenangriffs mit nur einer Variante stehen als Text in der Chipzeile)
  function zusatzSatz(modus, lob) {
    const letzter = (schluessel) => { const l = H.wellenErgebnis; return l && schluessel && l.karte === schluessel ? ME.text(T.opt.zuletzt, { n: l.welle }) : ''; };
    if (modus === 'arena_away') {
      const url = lob.arena && lob.arena.art ? lob.arena : null, k = lob.wellen || null;
      return [url && k ? ME.text(T.opt.seedFest, { n: url.seed }) : k ? T.opt.seedNeu : '', letzter(url ? url.art : k)];
    }
    if (modus === 'arena_space') return [letzter(lob.szene ? 'all:' + lob.szene : null)];
    return [];
  }
  // Wert einer Zusatzoption (Lobby-Snapshot): nur Darstellung
  function optionWert(o, lob, ich) {
    switch (o.aktion) {
      case 'toggleWellenKarte':
        { const rek = (H.wellenRekorde || {}), zusatz = (k) => (rek[k] ? ' · ' + ME.text(T.opt.rekord, { n: rek[k].welle }) : '');   // bester Stand je Karte (nur in diesem Browser)
          if (lob.startMission === 'arena_space') { const z = lob.szene ? H.allSzene(lob.szene) : null; return z ? z.name + zusatz('all:' + z.id) : T.opt.altweg; }
          const k = lob.arena && lob.arena.art ? lob.arena.art : lob.wellen;
          return k ? H.wellenKarteName(k) + zusatz(k) : T.opt.keschKlassisch; }
      case 'toggleGraben': { const a = (lob.grabenListe || [])[o.arg], v = a && ((a.varianten || []).find((x) => x.id === (lob.graben || {})[a.abschnitt]) || (a.varianten || [])[0]); return v ? v.name : T.opt.leer; }
      case 'lobbyWaffe': { const w = ich && lob.waffen && lob.waffen[ich.id]; return w ? (H.WAFFE_NAME[w] || w) : T.opt.standard; }
      case 'laborWahl': { const la = F.laborAuswahl(lob); return la.n ? la.position + '/' + la.n : T.opt.leer; }   // der volle Name steht als Titel der Lobby
      case 'laborStaerke': return (lob.labor && lob.labor.staerke) || T.opt.standard;
      case 'laborSeed': return lob.labor && lob.labor.seed != null ? String(lob.labor.seed) : T.opt.zufaellig;
      case 'laborGod': return lob.labor && lob.labor.god ? T.opt.an : T.opt.aus;
      case 'menue.tutorialRunde': return lob.startMission === 'eisenwald' ? T.detail.an : T.detail.aus;   // in der Lobby gilt der Modus der Runde
      case 'toggleSkipDrill': return lob.skipDrill ? T.detail.an : T.detail.aus;
      default: return '';
    }
  }
  const sichtOptionen = (modus, lob, welt) => F.optionenFuer(modus, lob, welt).filter((o) => !o.versteckt);
  // Klick und Taste einer Lobby-Option lösen dieselbe Action aus
  function optionAusfuehren(o, view, lob) {
    if (o.aktion === 'menue.tutorialRunde') return F.schalteTutorialDerRunde(lob);
    const fn = view.actions[o.aktion]; return fn ? fn(o.arg) : null;
  }

  // ---------------------------------------------------------------- Bildebene
  function schirmVon(view) {
    const s = F.lies().schirm;
    return s === 'menue' || s === 'titel' || s === 'einladung' ? (s === 'einladung' ? 'beitritt' : s === 'titel' ? 'titel' : 'menue') : 'lobby';
  }
  function ebene(view) {
    const s = schirmVon(view);
    return { datei: MT.BILD.datei, hell: MT.BILD.hell[s], schirm: s };
  }

  // ---------------------------------------------------------------- Titelbild
  function charakterOben(c, view) {
    const K = MM.charakter; kachelM(c, K.x, K.y, K.w, K.h);
    const karte = aktiveKarte(), name = window.Charaktere ? Charaktere.aktiverName() : null;
    portraet(c, { x: K.x + 1, y: K.y + 1, w: K.bild, h: K.bild }, karte);
    txtSp(c, fit(String(name || '–').toUpperCase(), K.w - K.bild - 12, 1), K.x + K.bild + 6, K.y + 5, MF.text, 1); txt(c, MX.charakterWechseln, K.x + K.bild + 6, K.y + 17, MF.dim);
    klick(K, 'Charakter wechseln', () => view.actions.openKammer && view.actions.openKammer());
  }
  function titel(c, view) {
    const Tt = MM.titel;
    raster(c, MT.MARKE, Tt.x, Tt.marke.y, Tt.marke.s, MF.messing, MF.gold);
    raster(c, MT.SCHRIFTZUG.raster, Tt.x, Tt.schriftzug.y, Tt.schriftzug.s, MF.text);
    txtSp(c, MX.claim, Tt.x, Tt.claim, MF.gold, MS.claim.sp);
    txt(c, MX.unterzeile, Tt.x, Tt.unterzeile, MF.dim);
    knopfGold(c, Tt.x, Tt.knopf.y, Tt.knopf.w, T.tasten.enter, T.titel.knopf, () => F.weiter());
    hinweise(c, Tt.x, Tt.hinweise, [['C', T.hinweise.charakter], ['O', T.hinweise.optionen], ['H', T.hinweise.hilfe]]);
    txt(c, MX.fuss, Tt.x, Tt.fuss, MF.dim);
    charakterOben(c, view);
  }

  // ---------------------------------------------------------------- Hauptmenü (und Moduswahl-Überlagerung der Lobby)
  function welteZeile(w) { return H.playLabel(w.playTime) + ' · ' + H.missionLabel(w.mission, w.step) + (w.savedAt ? ' · ' + H.relDate(w.savedAt) : ''); }
  function liste(c, view, lob) {
    const M = MM.menue, x = M.x, w = M.w, gs = F.gruppen(lob), auswahl = F.auswahlEintrag(lob);
    let y = M.y;
    function gruppe(t, rechts) {
      rect(c, x, y + 3, 3, 3, MF.messing); const e = txtSp(c, t, x + 8, y, MF.messing, MS.gruppe.sp);
      if (rechts) txt(c, rechts, x + w, y, MF.dim, 'right');
      rect(c, e + 6, y + 3, x + w - (rechts ? breite(rechts) + 6 : 0) - e - 6, 1, P.rgba(MF.messing, 0.35)); y += M.gruppe;
    }
    function zeile(e, text, sub) {
      const an = auswahl && auswahl.id === e.id, h = sub ? M.zeileSub : M.zeile;
      if (an) { rect(c, x, y - 1, w, h, P.rgba(MF.gold, MM.auswahl.deckkraft)); rect(c, x, y - 1, MM.auswahl.balken, h, MF.gold); }
      const k = kappeM(c, x + 8, y, e.taste, an ? MF.gold : MF.kappe, an ? MF.tinte : MF.kappeText);
      txt(c, fit(text, w - (k - x) - 8, 1), k + 6, y + 3, an ? MF.gold : MF.text);
      if (sub) txt(c, fit(sub, w - 27, 1), x + 27, y + 13, MF.dim);
      klick({ x, y: y - 1, w, h }, text, () => { F.waehleEintragId(e.id, lob); });
      y += h + M.fuge;
    }
    for (const g of gs) {
      if (g.id === 'spielen') { gruppe(T.gruppen.spielen); g.eintraege.forEach((e) => zeile(e, label(F.modusVon(e)))); }
      else if (g.id === 'fortsetzen') {
        y += M.gruppenAbstand; const ws = F.welten(lob); gruppe(T.gruppen.fortsetzen, F.weltstaende(lob).zaehler);
        const neu = F.neuesteWelt(lob);
        if (neu) {
          zeile(g.eintraege[0], neu.name || neu.id, welteZeile(neu));
          if (ws.length > 1) { txt(c, fit(ME.text(T.fortsetzen.weitere, { n: ws.length - 1 }), w - 8, 1), x + 8, y, MF.dim); y += 14; }
        } else { txt(c, T.fortsetzen.keiner, x + 8, y, MF.dim); y += 14; }
      } else if (g.id === 'uebung') { y += M.gruppenAbstand; gruppe(T.gruppen.uebung, MX.uebungRechts); g.eintraege.forEach((e) => zeile(e, label(F.modusVon(e)))); }
      else if (g.id === 'debug') { y += M.gruppenAbstand; gruppe(T.gruppen.debug); g.eintraege.forEach((e) => zeile(e, label(F.modusVon(e)))); }
    }
  }
  function detail(c, view, lob, e, knopfText, knopfFn) {
    const D = MM.menue.detail; kachelM(c, D.x, D.y, D.w, D.h); rect(c, D.x, D.y, D.w, 2, MF.gold);
    if (!e) return;
    const welt = e.fortsetzen ? F.neuesteWelt(lob) : null, modus = F.modusVon(e), ws = F.weltstaende(lob);
    txtSp(c, e.art, D.x + 10, D.y + 10, MF.messing, MS.gruppe.sp);
    const dt = String(welt ? (welt.name || welt.id) : label(modus)).toUpperCase(), dsk = breite(dt, MS.detail.skala) <= D.w - 20 ? MS.detail.skala : 1;   // zu lang für Skala 2 (z. B. DIE SCHULD DER LERCHE): Skala 1
    txt(c, fit(dt, D.w - 20, dsk), D.x + 10, D.y + (dsk === 1 ? 27 : 24), MF.text, 'left', dsk);
    const beschr = welt ? welteZeile(welt) : hinweisText(modus);
    R.wrap(beschr, D.w - 20, 1).slice(0, 2).forEach((z, i) => txt(c, z, D.x + 10, D.y + 46 + i * 11, MF.dim));
    const crewListe = welt && Array.isArray(welt.spieler) && welt.spieler.length ? T.detail.crew + ': ' + welt.spieler.join(', ') : null;
    const voll = !e.fortsetzen && e.weltstand && ws.voll;
    const meta = e.fortsetzen ? (crewListe || T.detail.spieler) : voll ? ME.text(T.detail.weltstandVoll, { max: ws.max }) : T.detail.spieler + ' · ' + (e.weltstand ? ME.text(T.detail.neuerWeltstand, { n: ws.naechste, max: ws.max }) : T.detail.keinWeltstand);
    txt(c, fit(meta, D.w - 20, 1), D.x + 10, D.y + 70, voll ? MF.nichtBereit : MF.text);
    const opt = e.tutorial ? [{ taste: 'U', label: T.detail.tutorial }] : sichtOptionen(modus, lob, welt);
    if (opt.length) {   // Tutorial-Schalter im Hauptmenü; die übrigen Optionen gelten in der Lobby (gleiche Tasten)
      const mitText = opt.map((o) => o.taste + ' ' + o.label).join(' · '), nurTasten = opt.map((o) => o.taste).join(' ');
      const werte = breite(T.detail.inLobby + ': ' + mitText) <= D.w - 20 ? mitText : nurTasten;
      if (e.tutorial) { const k = kappeM(c, D.x + 10, D.y + 79, 'U'); txt(c, T.detail.tutorial + ': ' + (F.lies().tutorial ? T.detail.an : T.detail.aus), k + 5, D.y + 82, MF.text); klick({ x: D.x + 10, y: D.y + 79, w: 120, h: 13 }, 'Tutorial', () => F.schalteTutorialMerker()); }
      else txt(c, fit(T.detail.inLobby + ': ' + werte, D.w - 20, 1), D.x + 10, D.y + 82, MF.dim);
    }
    knopfGold(c, D.x + 10, D.y + 98, 170, T.tasten.enter, knopfText, knopfFn);
  }
  function hauptmenue(c, view) {
    const lob = lobbyVon(view); lockup(c);
    liste(c, view, lob);
    const e = F.auswahlEintrag(lob);
    detail(c, view, lob, e, e && e.fortsetzen ? T.detail.fortsetzen : T.detail.raumOeffnen, () => F.bestaetige(lob));
    hinweise(c, MM.menue.x, MM.menue.hinweise, [[T.tasten.auswahl, T.hinweise.waehlen], ['C', T.hinweise.charakter], ['O', T.hinweise.optionen], ['H', T.hinweise.hilfe], [T.tasten.esc, T.hinweise.zurueck]]);
    charakterOben(c, view);
  }
  function modusWahl(c, view) {
    const lob = lobbyVon(view);
    rect(c, 0, 0, VW, VH, P.rgba(MF.grund, 0.985)); rect(c, 0, MM.menue.hinweise - 6, VW, VH - MM.menue.hinweise + 6, MF.grund);   // die Lobby dahinter ist nur noch zu ahnen; unten ganz zu (Hinweise der Überlagerung)
    txtSp(c, T.modus.titel, MM.lockup.x, MM.lockup.y + 2, MF.messing, MS.gruppe.sp);
    liste(c, view, lob);
    const e = F.auswahlEintrag(lob);
    detail(c, view, lob, e, T.modus.knopf, () => F.bestaetige(lob));
    hinweise(c, MM.menue.x, MM.menue.hinweise, [[T.tasten.auswahl, T.hinweise.waehlen], [T.tasten.enter, T.modus.enter], ['F', T.modus.weltstaende], [T.tasten.esc, T.modus.esc]]);
  }

  // ---------------------------------------------------------------- Crew-Lobby
  function kartenFlaeche(c, x, y, w, h, i, p, view) {   // eine Crew-Karte (Charakterliste, schmaler)
    const CR = MM.lobby.crew, KK = MM.karte, sp = spielerFarbe(p), karte = kartenMap()[p.id] || (p.id === view.pid ? aktiveKarte() : null);
    rect(c, x, y, w, h, MF.karte);
    portraet(c, { x: x + 1, y: y + 1, w: w - 2, h: CR.bild }, karte);
    kappeM(c, x + 4, y + 4, String(i + 1));
    rect(c, x + w - KK.formPlatte - 4, y + 4, KK.formPlatte, KK.formPlatte, P.rgba(MF.formPlatte, KK.formDeckkraft));
    R.shape(c, sp.form, x + w - 4 - KK.formPlatte / 2, y + 4 + KK.formPlatte / 2, 2 * KK.form + 1, sp.farbe);
    if (p.gastgeber) stempel(c, 'gastgeber', x + 1, y + 1 + CR.bild - MT.STEMPEL.h, true);
    const ty = y + CR.bild + 1 + KK.nameY, ich = p.id === view.pid;
    txtSp(c, fit(String(p.name || '?').toUpperCase(), w - 10 - (ich ? 20 : 0), 1), x + 5, ty, sp.farbe, MS.name.sp);
    if (ich) txt(c, T.karte.du, x + w - 6, ty, MF.dim, 'right');
    txt(c, fit(oberteil(karte), w - 10, 1), x + 5, y + CR.bild + 1 + KK.zeileY, MF.text);
    if (p.waffe) txt(c, fit(T.opt.waffe + ': ' + p.waffe, w - 10, 1), x + 5, y + CR.bild + 1 + KK.zeileY + 11, MF.dim);   // Wellen Boden, Grabenangriff, Labor: Waffe je Spieler
    stempel(c, p.ready ? 'anBord' : 'nichtBereit', x + w / 2, y + h - MT.STEMPEL.h - 7);
    rand(c, x, y, w, h, MF.karteRand);
  }
  function lobbyChips(c, view, lob, ich) {   // Zeile(n) unter dem Modus: M Modus ändern + Zusatzoptionen des Modus mit Werten
    const L = MM.lobby, maxX = 436, x0 = L.modus.x;
    let x = x0, y = L.modus.y + 51, zeile = 0;
    const chip = (k, t, w2, fn) => {
      const w = (k ? Math.max(MM.kappe.minW, breite(k) + MM.kappe.innen) + 4 : 0) + breite(t);   // k = null: nur Text (kein wählbarer Wert)
      if (x + w > maxX) { if (zeile >= 1 || x === x0) return; zeile++; x = x0; y += 13; if (x + w > maxX) return; }
      rect(c, x - 2, y - 1, w + 4, 15, P.rgba(MF.kachel, MM.kachelDeckkraft));   // deckende Unterlage: die Optionen laufen über die Textzone des Tokens hinaus
      const x1 = x; if (k) x = kappeM(c, x, y, k) + 4; x = txt(c, t, x, y + 3, w2 || MF.dim) + 12;
      if (fn) klick({ x: x1, y, w: x - x1 - 12, h: 13 }, t, fn);
    };
    chip('M', T.lobby.modusAendern, MF.dim, () => F.oeffneModusWahl(lob));
    if (!ich) return;
    const m = modusAnzeige(lob);
    for (const o of sichtOptionen(lob.startMission, lob, m.welt)) chip(o.taste, o.label + ' ' + fit(optionWert(o, lob, ich), 120, 1), MF.dim, () => optionAusfuehren(o, view, lob));
    if (lob.startMission === 'arena_graben' && !m.welt) for (const a of Array.isArray(lob.grabenListe) ? lob.grabenListe : []) {   // Abschnitte mit nur einer Variante: reine Textzeile ohne Taste
      if ((a.varianten || []).length >= 2) continue;
      const v = (a.varianten || [])[0]; chip(null, fit((a.name || T.opt.abschnitt) + ': ' + (v ? v.name : T.opt.leer), 150, 1), MF.dim);
    }
  }
  // Farbe der Crew per Maus (die Tasten 1–4 gelten weiter): Kappe 1–4 und die vier Formen; vergebene Farben gedimmt, die eigene umrandet. Gibt das Ende zurück
  function farbWahl(c, view, ich, x, y) {
    const belegt = new Set(F.verbunden(spielerVon(view)).filter((p) => p.id !== view.pid).map((p) => p.color));
    x = kappeM(c, x, y, T.tasten.ziffern) + 5;
    for (let i = 0; i < 4; i++) {
      const sp = ME.spieler(i), cx = x + i * 11 + 5, mein = !!(ich && ich.color === i), weg = belegt.has(i);
      if (mein) rand(c, cx - 5, y + 1, 11, 11, MF.gold);
      R.shape(c, sp.form, cx, y + 6, 7, weg ? MF.dim : sp.farbe);
      klick({ x: cx - 5, y, w: 11, h: 13 }, 'Farbe ' + (i + 1), () => { if (!weg && view.actions.setColor) view.actions.setColor(i); });
    }
    return x + 4 * 11 + 8;
  }
  function lobby(c, view) {
    const lob = lobbyVon(view), L = MM.lobby, players = F.verbunden(spielerVon(view)).slice(0, 4), ich = ichVon(view);
    const gast = F.gastgeber(spielerVon(view)), z = F.zaehlung(spielerVon(view)), link = code() ? (window.Net ? Net.inviteLink() : '') : '';
    lockup(c);
    const m = modusAnzeige(lob), mitWaffe = !m.welt && ['arena_away', 'arena_graben', 'labor'].includes(lob.startMission);
    txtSp(c, fit(m.art, 248, 1), L.modus.x, L.modus.y, MF.messing, MS.gruppe.sp);   // Textzone des Tokens: bis x 280
    const tit = String(m.titel).toUpperCase(), tsk = [MS.modus.skala, 2].find((k) => breite(tit, k) <= 400) || 1;   // lange Namen (Labor): Skala 3, 2, sonst 1 – nichts wird abgeschnitten, solange es auf eine Zeile passt
    txt(c, fit(tit, 400, tsk), L.modus.x, L.modus.y + 13, MF.text, 'left', tsk);
    { const satz = fit(m.warnung || m.satz, 400, 1); rect(c, L.modus.x - 3, L.modus.y + 36, breite(satz) + 6, 11, P.rgba(MF.kachel, MM.kachelDeckkraft)); txt(c, satz, L.modus.x, L.modus.y + 38, m.warnung ? MF.nichtBereit : MF.dim); }   // lange Hinweise laufen über die Textzone hinaus: deckende Unterlage
    lobbyChips(c, view, lob, ich);
    // Raumcode-Kachel
    const RC = L.raumcode; kachelM(c, RC.x, RC.y, RC.w, RC.h);
    txtSp(c, MX.raumcode, RC.x + 10, RC.y + 9, MF.messing, MS.gruppe.sp);
    if (code()) {
      txtSp(c, code(), RC.x + RC.w / 2, RC.y + 25, MF.gold, MS.raumcode.sp, MS.raumcode.skala, 'center');
      rect(c, RC.x + 10, RC.y + 60, RC.w - 20, 1, MF.kachelRand);
      const kopiert = window.Client && Client.inviteCopiedT && performance.now() - Client.inviteCopiedT < 2500;
      const e2 = kappeM(c, RC.x + 10, RC.y + 66, 'L'); txt(c, kopiert ? T.karte.linkKopiert : MX.linkKopieren, e2 + 6, RC.y + 69, kopiert ? MF.bereit : MF.text);
      const kurz = String(link).replace(/^https?:\/\//, ''); let s = kurz; while (s.length > 4 && breite('…' + s) > RC.w - 20 && s !== kurz.slice(-s.length + 1)) s = s.slice(1); if (s !== kurz) while (breite('…' + s) > RC.w - 20) s = s.slice(1);
      txt(c, s === kurz ? s : '…' + s, RC.x + 10, RC.y + 81, MF.dim);
      klick({ x: RC.x, y: RC.y + 62, w: RC.w, h: 16 }, 'Link kopieren', () => view.actions.copyInvite && view.actions.copyInvite());
    } else { txt(c, T.lobby.ohneCode, RC.x + RC.w / 2, RC.y + 30, MF.text, 'center'); txt(c, MX.laedtEin.replace(/^L /, ''), RC.x + RC.w / 2, RC.y + 46, MF.dim, 'center'); }
    // Crew
    const CR = L.crew;
    txtSp(c, ME.text(MX.crew, { n: players.length }), CR.x, CR.y - 9, MF.messing, MS.gruppe.sp);
    for (let i = 0; i < 4; i++) {
      const p = players[i], x = CR.x + i * (CR.w + CR.fuge), y = CR.y;
      if (!p) {
        rect(c, x, y, CR.w, CR.h, MF.karte); hatch(c, x, y, CR.w, CR.h, MF.freiSchraffur, 4); dash(c, x, y, CR.w, CR.h, MF.karteRand, 3);
        kappeM(c, x + 4, y + 4, String(i + 1), MF.karteRand, MF.dim);
        txtSp(c, MX.frei, x + CR.w / 2, y + CR.h / 2 - 14, MF.dim, 1, MS.detail.skala, 'center'); if (code()) txt(c, MX.laedtEin, x + CR.w / 2, y + CR.h / 2 + 6, MF.dim, 'center');
        continue;
      }
      kartenFlaeche(c, x, y, CR.w, CR.h, i, Object.assign({ gastgeber: gast && gast.id === p.id, waffe: mitWaffe ? ((lob.waffen && lob.waffen[p.id]) ? (H.WAFFE_NAME[lob.waffen[p.id]] || lob.waffen[p.id]) : T.opt.waffeStandard) : null }, p), view);
    }
    if (!spielerVon(view).length) txt(c, (window.Net && Net.status === 'open') ? T.lobby.warteServer : T.lobby.verbindet, CR.x, CR.y + 20, MF.dim);
    // START-Kachel
    const ST = L.start; kachelM(c, ST.x, ST.y, ST.w, ST.h);
    txtSp(c, MX.start, ST.x + 8, ST.y + 8, MF.messing, MS.gruppe.sp);
    txt(c, MX.startSatz[0], ST.x + 8, ST.y + 22, MF.text); txt(c, MX.startSatz[1], ST.x + 8, ST.y + 32, MF.text);
    if (z.wartend.length) { txt(c, MX.wartetAuf, ST.x + 8, ST.y + 50, MF.nichtBereit); z.wartend.slice(0, 4).forEach((p, i) => txt(c, fit(p.name || '?', ST.w - 14, 1), ST.x + 8, ST.y + 60 + i * 10, spielerFarbe(p).farbe)); }
    else if (z.an) txt(c, T.lobby.alleBereit, ST.x + 8, ST.y + 50, MF.bereit);
    const bereit = !!(ich && ich.ready);
    P.cham(c, ST.x + 6, ST.y + 98, ST.w - 12, 24, MF.bereit, 4, 0, 4, 0);
    txtSp(c, T.lobby.bereit, ST.x + ST.w / 2, ST.y + 103, MF.tinte, 1, 1, 'center'); txt(c, bereit ? T.lobby.bereitZurueck : T.lobby.bereitMelden, ST.x + ST.w / 2, ST.y + 113, MF.tinte, 'center');
    klick({ x: ST.x + 6, y: ST.y + 98, w: ST.w - 12, h: 24 }, 'Bereit', () => view.actions.toggleReady && view.actions.toggleReady());
    T.karte.escZeile.forEach((z, i) => txt(c, z, ST.x + 8, ST.y + 134 + i * 10, MF.dim));
    // Hinweise und Statuszeile
    const kappeBreite = (k) => Math.max(MM.kappe.minW, breite(k) + MM.kappe.innen);
    let rx = VW - 8; const rechts = [['H', T.hinweise.hilfe], ['O', T.hinweise.optionen]].map(([k, t]) => { const w = kappeBreite(k) + 4 + breite(t); rx -= w; const x0 = rx; rx -= 12; return { k, t, w, x: x0 }; });
    let hx = hinweise(c, L.modus.x, L.hinweise, [[T.tasten.enter, T.hinweise.bereit]], rx);
    hx = farbWahl(c, view, ich, hx, L.hinweise);
    hinweise(c, hx, L.hinweise, [['C', T.hinweise.charakter], ['M', T.hinweise.modus], ['L', T.hinweise.link], [T.tasten.esc, T.hinweise.menue]], rx);
    for (const r of rechts) { rect(c, r.x - 2, L.hinweise - 1, r.w + 4, 15, P.rgba(MF.kachel, MM.kachelDeckkraft)); kappeM(c, r.x, L.hinweise, r.k); txt(c, r.t, r.x + kappeBreite(r.k) + 4, L.hinweise + 3, MF.dim); }
    const SZ = MM.statuszeile; rect(c, 0, SZ.y, VW, SZ.h, MF.statuszeile); rect(c, 0, SZ.y, VW, 1, MF.kachelRand);
    let x = SZ.innen; const ty = SZ.y + Math.floor((SZ.h - 7) / 2);
    [[MX.status.modus, fit(m.welt ? String(m.titel) : label(lob.startMission || 'm1'), 200, 1), MF.text], [MX.status.crew, z.an + T.status.crewEinheit, MF.text], [MX.status.bereit, z.bereit + '/' + z.an, z.alleBereit ? MF.bereit : MF.nichtBereit], [MX.status.raum, code() || '–', MF.gold]].forEach(([l, v, col]) => {
      x = txtSp(c, l, x, ty, MF.dim, 1) + 6; x = txt(c, v, x, ty, col) + SZ.feldAbstand;
    });
    if (gast) { const gx = VW - SZ.innen - breite(gast.name || '?'); txt(c, gast.name || '?', gx, ty, spielerFarbe(gast).farbe); txtSp(c, MX.status.gastgeber, gx - 6, ty, MF.dim, 1, 1, 'right'); }
    if (!view.audioOn) { const w = breite(T.ton.hinweis); rect(c, L.crew.x - 3, 307, w + 6, 11, P.rgba(MF.kachel, MM.kachelDeckkraft)); txt(c, T.ton.hinweis, L.crew.x, 309, MF.nichtBereit); }   // der Ton startet erst nach einer Eingabe (deckende Unterlage: liegt auf dem Bild)
  }

  // ---------------------------------------------------------------- Einladung (Beitritt per Link): Einladung → Charakter wählen → Lobby
  function einladung(c, view) {
    const lob = lobbyVon(view), players = F.verbunden(spielerVon(view)), ich = ichVon(view), andere = players.filter((p) => p.id !== view.pid), gast = andere[0] || null;
    const C = window.Charaktere, cs = C ? C.lies() : { liste: [], gewaehlt: null }, cur = F.lies().einladungCursor;
    lockup(c);
    txtSp(c, T.einladung.gruppe, 32, 50, MF.messing, MS.gruppe.sp);
    if (gast) {
      const e = txt(c, fit(String(gast.name || '?').toUpperCase(), 290, MS.modus.skala), 32, 63, spielerFarbe(gast).farbe, 'left', MS.modus.skala); txt(c, T.einladung.holtDich, e + 6, 73, MF.text);
    } else txt(c, T.einladung.niemand, 32, 66, MF.text, 'left', 2);
    const m = modusAnzeige(lob); let y = 90;
    [[T.einladung.modus, fit(m.titel, 220, 1)], [T.einladung.raum, code() || (window.Net && Net.roomCode) || '–'], [T.einladung.anBord, ME.text(T.karte.vonVier, { n: players.length })]].forEach(([k, v]) => { txt(c, k, 32, y, MF.dim); txt(c, v, 104, y, MF.text); y += 11; });
    if (andere.length) {   // wer schon an Bord ist: kleines Porträt, Form und Name, auf einer deckenden Kachel
      rect(c, 28, 124, 300, 26, P.rgba(MF.kachel, MM.kachelDeckkraft));
      let ax = 32;
      andere.slice(0, 3).forEach((p) => { const sp = spielerFarbe(p); portraet(c, { x: ax, y: 127, w: 20, h: 20 }, kartenMap()[p.id]); R.shape(c, sp.form, ax + 28, 137, 7, sp.farbe); ax = txt(c, fit(p.name || '?', 62, 1), ax + 35, 134, sp.farbe) + 12; });
    }
    txtSp(c, T.einladung.wem, 32, 160, MF.messing, MS.gruppe.sp);
    // eigene Charaktere (die Liste liegt in diesem Browser)
    const cw = 82, ch = 140, cx0 = 32, cy = 174, fuge = 8, KK = MM.karte;
    for (let i = 0; i < 4; i++) {
      const x = cx0 + i * (cw + fuge), k = cs.liste[i], an = i === cur;
      klick({ x, y: cy, w: cw, h: ch }, 'Charakter ' + (i + 1), () => { F.setzeEinladungCursor(i); });
      if (!k) {
        rect(c, x, cy, cw, ch, MF.karte); hatch(c, x, cy, cw, ch, MF.freiSchraffur, 4); dash(c, x, cy, cw, ch, MF.karteRand, 3);
        kappeM(c, x + 4, cy + 4, String(i + 1), an ? MF.gold : MF.karteRand, an ? MF.tinte : MF.dim);
        txtSp(c, T.einladung.frei, x + cw / 2, cy + ch / 2 - 10, MF.dim, 1, MS.detail.skala, 'center'); txt(c, T.einladung.neuHinweis, x + cw / 2, cy + ch / 2 + 10, MF.dim, 'center');
        if (an) rand2(c, x, cy, cw, ch, MF.gold, 2);
        continue;
      }
      const getragen = k.id === cs.gewaehlt;
      rect(c, x, cy, cw, ch, MF.karte);
      portraet(c, { x: x + 1, y: cy + 1, w: cw - 2, h: 82 }, k.karte);
      kappeM(c, x + 4, cy + 4, String(i + 1), an ? MF.gold : MF.kappe, an ? MF.tinte : MF.kappeText);
      txtSp(c, fit(String(k.karte.name).toUpperCase(), cw - 10, 1), x + 5, cy + 87 + KK.nameY, MF.text, MS.name.sp);
      txt(c, fit(oberteil(k.karte), cw - 10, 1), x + 5, cy + 87 + KK.zeileY + 2, MF.dim);
      if (getragen) txtSp(c, T.lobby.gewaehlt.toUpperCase(), x + 5, cy + ch - 12, MF.bereit, 1);
      if (an) rand2(c, x, cy, cw, ch, MF.gold, 2); else rand(c, x, cy, cw, ch, MF.karteRand);
    }
    // „Dein Platz“
    const tx = cx0 + 4 * (cw + fuge) + 8, tw = 624 - tx; kachelM(c, tx, cy, tw, ch);
    txtSp(c, T.einladung.deinPlatz, tx + 10, cy + 10, MF.messing, MS.gruppe.sp);
    const farbe = ich && ich.color != null ? ME.spieler(ich.color) : null;
    if (farbe) { R.shape(c, farbe.form, tx + 14, cy + 28, 9, farbe.farbe); txt(c, T.einladung.farbe + ' S' + (ich.color + 1), tx + 26, cy + 25, MF.text); }
    txt(c, T.einladung.nameCharakter, tx + 10, cy + 42, MF.text);
    R.wrap(T.einladung.crewWaehlt, tw - 20, 1).forEach((z, i) => txt(c, z, tx + 10, cy + 62 + i * 11, MF.dim));
    const k = cs.liste[cur];
    if (k) knopfGold(c, tx + 10, cy + 100, tw - 20, T.tasten.enter, fit(ME.text(T.einladung.anBordMit, { name: k.karte.name }), tw - 56, 1), () => F.einladungAnnehmen());
    else txt(c, T.einladung.neuHinweis, tx + 10, cy + 104, MF.dim);
    txt(c, T.einladung.nichtBeitreten, tx + 10, cy + 126, MF.dim); klick({ x: tx + 10, y: cy + 124, w: tw - 20, h: 11 }, 'Einladung ablehnen', () => F.einladungAblehnen());
    hinweise(c, 32, 340, [[T.tasten.ziffern, T.hinweisEinladung.charakter], ['N', T.hinweisEinladung.neu], ['C', T.hinweisEinladung.liste], [T.tasten.enter, T.hinweisEinladung.anBord], [T.tasten.esc, T.hinweisEinladung.abbrechen]], 560);
  }

  // ---------------------------------------------------------------- zeichnen
  function zeichne(ctx, view) {
    const s = F.lies().schirm, sk = schirmVon(view);
    if (s === 'menue' || s === 'lobby') F.synchronisiere(lobbyVon(view));
    verlauf(ctx, sk);
    if (s === 'titel') titel(ctx, view);
    else if (s === 'menue') hauptmenue(ctx, view);
    else if (s === 'einladung') einladung(ctx, view);
    else { lobby(ctx, view); if (F.lies().modusOffen) modusWahl(ctx, view); }
  }

  // ---------------------------------------------------------------- Tasten
  // true = Taste verbraucht. Navigation über MenueFluss, Lobby-Aktionen über view.actions; hier steht nur, welche Taste was auslöst.
  function taste(e, view) {
    const code = e.code, s = F.lies().schirm, lob = lobbyVon(view), ich = ichVon(view), a = view.actions, rep = e.repeat;
    const ton = (n) => { if (a.sfx) a.sfx(n); };
    const hilfe = code === 'KeyH' || !!(window.Tasten && Tasten.passt(e, 'allgemein.hilfe'));   // H wie bisher, ? wie an den Pulten
    const gemeinsam = () => {   // Optionen, Hilfe, Charakter – auf jedem Bildschirm
      if (rep) return code === 'KeyO' || hilfe || code === 'KeyC';
      if (code === 'KeyO') { a.openOptions && a.openOptions(); return true; }
      if (hilfe) { a.openHilfe && a.openHilfe(); return true; }
      if (window.Tasten && Tasten.passt(e, 'charakter.oeffnen')) { a.openKammer && a.openKammer(); return true; }
      return false;
    };
    if (s === 'titel') {
      if (gemeinsam()) return true;
      if ((code === 'Enter' || code === 'NumpadEnter' || code === 'Space') && !rep) { F.weiter(); ton('ui_click'); return true; }
      return true;
    }
    if (s === 'menue' || (s === 'lobby' && F.lies().modusOffen)) {
      if (gemeinsam()) return true;
      if (code === 'ArrowUp' || code === 'ArrowDown') { F.bewege(code === 'ArrowUp' ? -1 : 1, lob); ton('ui_click'); return true; }
      if (rep) return true;
      if (code === 'Enter' || code === 'NumpadEnter') { const r = F.bestaetige(lob); ton(r.ok ? 'ui_click' : 'error'); return true; }
      if (code === 'Escape') { F.zurueck(ich); ton('ui_back'); return true; }
      if (code === 'KeyF') { a.openWorlds && a.openWorlds('list'); return true; }
      if (code === 'KeyU') { const en = F.auswahlEintrag(lob); if (en && en.tutorial) { F.schalteTutorialMerker(); ton('ui_click'); } return true; }
      const d = /^(?:Digit|Numpad)(\d)$/.exec(code);
      if (d) { const r = F.waehleTaste(d[1], lob); if (r.ok) ton('ui_click'); return true; }
      return true;
    }
    if (s === 'einladung') {
      if (gemeinsam()) return true;
      if (code === 'ArrowLeft' || code === 'ArrowRight') { F.bewegeEinladung(code === 'ArrowLeft' ? -1 : 1); ton('ui_click'); return true; }
      if (rep) return true;
      const d = /^(?:Digit|Numpad)([1-4])$/.exec(code);
      if (d) { F.setzeEinladungCursor(+d[1] - 1); ton('ui_click'); return true; }
      if (code === 'KeyN') { if (a.openKammer) { a.openKammer(); if (window.Charaktere) Charaktere.neuAnlegen(); } return true; }
      if (code === 'Enter' || code === 'NumpadEnter') { const r = F.einladungAnnehmen(); ton(r.ok ? 'ui_click' : 'error'); return true; }
      if (code === 'Escape') { F.einladungAblehnen(); ton('ui_back'); return true; }
      return true;
    }
    // Lobby
    if (gemeinsam()) return true;
    if (code === 'Escape') { if (!rep) { F.zurueck(ich); ton('ui_back'); } return true; }
    if (code === 'Enter' || code === 'NumpadEnter') { if (!rep) a.toggleReady(); return true; }
    if (code === 'KeyM') { if (ich && !rep) { F.oeffneModusWahl(lob); ton('ui_click'); } return true; }
    if (code === 'KeyF') { if (ich && !rep) a.openWorlds && a.openWorlds('list'); return true; }
    if (code === 'KeyL') { if (ich && !rep && a.copyInvite && window.Net && Net.serverRoomCode) a.copyInvite(); return true; }
    const farbe = /^Digit([1-4])$/.exec(code);
    if (farbe) { if (!rep) a.setColor(+farbe[1] - 1); return true; }
    if (ich) {
      const welt = F.welten(lob).find((w) => w.id === lob.world) || null;
      const o = F.optionFuerTaste(code, lob.startMission, lob, welt);
      if (o && !(rep && code !== 'ArrowUp' && code !== 'ArrowDown')) { optionAusfuehren(o, view, lob); return true; }
    }
    return code.indexOf('Arrow') === 0 || code === 'Space';
  }

  window.MenueUi = { zeichne, taste, ebene };
})();
