// SL8 (CONCEPT-SL8): Notrufe – Captain-Reiter „Aufträge“ (SPT-02 5, vorher „Notrufe“), Ops-Knopf zum Entschlüsseln, Ruf-Ort in der Taktikkarte. Globales `NotrufView`.
// Frontend-Layer: liest Snapshot nr ([{ i, h, k: 'k'|'v', z, r, f? }], f nur für den Fokus: { b: Behauptung, n: Absender, q: [Fragen], a: [[i, Antwort]],
// s: Messwerte, e: Entschlüssel-Qualität }) und space.nro ({ x, y, p, r }); schickt captain.notruf.* bzw. weapons.notruf.entschluesseln.
// Alle Regeln liegen im Server (server/sim/notrufe.js). Die Marke auf der Hexkarte zeichnet starmap.js aus world.marken.
// SPT-02 5: Der Reiter hat zwei Tabs. „Aktive Missionen“: laufende Fäden/Abenteuer (Brett-Block laufend, auch Notruf-Fäden), aktive klassische Missionen (Missionsbuch,
//   Consoles.bookEntries) und der Pseudo-Eintrag „zuletzt beendet“. „Notrufe“: Kampagnen-Notrufe (nr) und Takt-Notrufe (Marke reise:nN aus world.marken, dazu das Brett-Angebot bzw. der
//   Notruf-Faden am selben Hex). JEDE Notruf-Marke hat so einen Eintrag (die Marken sind die Quelle der Liste, nicht das Brett). Takt-Notrufe sind hier nicht annehmbar (Annahme am Brett).
//   oeffne(id) (Karten-Klick auf eine Marke) öffnet den Tab „Notrufe“ und wählt den Eintrag. Keine neuen Snapshot-Felder.
// Captain: W/S oder Pfeile wählen, A/D (oder Pfeile links/rechts) Tab wechseln, Q/E/R/F fragen, Enter hinfliegen, X ablehnen. Ops: I öffnet das verschlüsselte Signal des gewählten/ersten Rufs.
(function () {
  'use strict';
  const R = window.Render;
  const PAL = R.PAL;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  const ZUSTAND = ['offen', 'angenommen', 'vor Ort'];
  const FRAKTION = { rom: 'Rom', ger: 'Germanen', kon: 'Konkordat' };
  const TXT = { aktivLeer: 'Keine aktiven Missionen. Laufende Abenteuer und Missionen stehen hier.', notrufLeer: 'Keine Notrufe. Rufe erscheinen hier und auf der Hexkarte; man muss keinem folgen.' };
  const KIND = { mission: 'Mission', nebenauftrag: 'Nebenauftrag', hinweis: 'Hinweis' };
  const txt = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]+/g, ' ').slice(0, max) : '');
  const kurz = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const jetzt = () => (window.performance && performance.now ? performance.now() : Date.now());

  // SPT-02 2 (B2): Pseudo-Eintrag „zuletzt beendeter Faden“ aus world.abenteuer.zuletzt (Brett.store, nur der Server schreibt): { i: 'zuletzt', pseudo: true, k: 'z', ausgang, titel, text, w }.
  // Er steht am Ende der Liste „Aktive Missionen“, ist nur zum Lesen da (kein Fokus-, Hinfliegen-, Ablehnen-, Frage-Befehl: pseudo).
  function pseudoEintraege() {
    const b = window.Brett && window.Brett.store && window.Brett.store.abenteuer;
    const z = b && typeof b === 'object' ? b.zuletzt : null;
    if (!z || typeof z !== 'object' || !txt(z.titel, 60)) return [];
    const w = (Array.isArray(z.w) ? z.w : []).filter((m) => m && typeof m === 'object' && isFinite(m.d) && m.d !== 0).slice(0, 4).map((m) => ({ art: m.art === 'haltung' ? 'haltung' : 'ruf', f: txt(m.f, 8), d: m.d }));
    return [{ i: 'zuletzt', pseudo: true, k: 'z', ausgang: z.ausgang === 'gelungen' ? 'gelungen' : 'gescheitert', titel: txt(z.titel, 60), text: txt(z.text, 160), w }];
  }
  function wirkungText(w) { return w.map((m) => (m.art === 'haltung' ? 'Haltung ' : 'Ruf ' + (FRAKTION[m.f] || m.f) + ' ') + (m.d > 0 ? '+' : '') + m.d).join(' · '); }
  function hexName(h) { const S = window.Shared_Sektoren; return S && S.hexName ? S.hexName(h) : h; }
  function zeit(s) { s = Math.max(0, Math.round(num(s))); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  // Lebensdauer einer Notruf-Marke (Kampagne und Takt gleich): m:ss. Die Frist eines angenommenen Takt-Notrufs steht dagegen in Ticks wie im Brett (SPT-02 5b)
  const markeDauer = (s) => 'noch ' + zeit(s);
  const istHex = (h) => /^\d{4}$/.test(String(h || ''));
  const ortName = (h) => (istHex(h) ? hexName(h) : txt(h, 30));
  function ortText(h) { if (!istHex(h)) return txt(h, 30); const n = hexName(h); return n.indexOf(h) >= 0 ? n : n + ' (' + h + ')'; }   // unbenannte Hexe heißen schon „Leerraum 0404“: kein zweites „(0404)“
  const ohneNotruf = (t) => String(t || '').replace(/^Notruf: */, '');   // im Tab „Notrufe“ steht „Notruf“ schon im Tab
  // Zeile aus Teilen („a · b · c“) auf die Breite der Liste: passt sie nicht, entfallen die Teile in der Reihenfolge `weg`, zuletzt wird gekürzt
  const LW = 230, BREIT = LW - 8;   // Breite der Liste (SPT-02 5b: 230 statt 190, damit „Notruf · Kantenstein · Schritt 1 von 3“ mit Bake in eine Zeile passt)
  function passend(teile, weg) {
    let t = teile.map((s, i) => ({ s, i })).filter((o) => o.s);
    for (const k of weg || []) { if (R.measure(t.map((o) => o.s).join(' · '), 1) <= BREIT) break; t = t.filter((o) => o.i !== k); }
    let r = t.map((o) => o.s).join(' · '); while (r.length > 1 && R.measure(r, 1) > BREIT) r = r.slice(0, -2) + '…';
    return r;
  }

  // ---- Daten der Tabs (alles aus dem, was der Client schon hat: nr, Brett-Block, world.marken, Missionsbuch)
  function liste(st) { return (st && st.nr) || []; }   // Kampagnen-Notrufe (Server-Snapshot nr); auch für den Ops-Knopf
  function brettModell() { try { return window.Brett && window.Brett.modell ? window.Brett.modell() : null; } catch (e) { return null; } }
  function marken() { try { const S = window.StarMap; return (S && S.marken) || []; } catch (e) { return []; } }
  function laufendeFaeden() {
    const m = brettModell();
    return ((m && m.laufend) || []).map((l) => ({ i: 'f:' + l.id, art: 'faden', notruf: !!l.notruf, titel: l.titel, anlass: l.anlass, ort: l.ort, schritt: l.schritt, gesamt: l.schritte_gesamt, schrittText: l.schritt_text, gefahr: !!l.gefahr, ph: l.ph, rest: l.rest }));
  }
  function aktiveListe(view) {
    const st = (view && view.state) || {};
    let buch = [];
    try { const C = window.Consoles; buch = C && C.bookEntries ? C.bookEntries(st).list : []; } catch (e) { buch = []; }
    const mis = buch.filter((e) => e && !e.pseudo && e.state === 'aktiv').slice(0, 8).map((e) => ({ i: 'm:' + e.id, art: 'mission', titel: txt(String(e.title || e.id), 60), kind: e.kind, von: txt(e.von || e.from || '', 30), ziel: typeof e.ziel === 'string' ? txt(e.ziel, 40) : e.ziel && typeof e.ziel === 'object' ? txt(e.ziel.text || e.ziel.name || '', 60) : '', briefing: txt(e.briefing || '', 200), verfolgt: !!(st.mission && st.mission.book && st.mission.book.focus === e.id) }));
    return laufendeFaeden().concat(mis, pseudoEintraege());
  }
  // Notrufe: Kampagne (nr) zuerst, dann alles, wofür eine Notruf-Marke steht (Takt-Notrufe reise:nN), dann Brett-Notruf-Angebote ohne Marke (Marke gekürzt/abgelaufen)
  function notrufListe(view) {
    const out = liste(view && view.state).map((r) => Object.assign({ art: 'kampagne' }, r));
    const belegt = new Set(out.map((r) => 'notruf:' + r.i));
    const m = brettModell();
    const frei = ((m && m.angebote) || []).filter((a) => a.notruf);
    const faeden = ((m && m.laufend) || []).filter((l) => l.notruf);
    for (const mk of marken()) {
      if (!mk || mk.t !== 'notruf' || typeof mk.id !== 'string' || belegt.has(mk.id)) continue;
      belegt.add(mk.id);
      const ai = frei.findIndex((a) => a.ort === mk.h);
      const a = ai >= 0 ? frei.splice(ai, 1)[0] : null;
      const f = a ? null : faeden.find((l) => l.ort === mk.h) || null;
      out.push({ i: mk.id, art: 'takt', h: mk.h, b: mk.b != null ? num(mk.b) : null, angebot: a, faden: f });
    }
    for (const a of frei) out.push({ i: 'a:' + a.id, art: 'takt', h: a.ort, b: null, angebot: a, faden: null });
    return out;
  }
  const eintraege = (view, tab) => (tab === 'notruf' ? notrufListe(view) : aktiveListe(view));

  const FRAGE_TASTEN = ['KeyQ', 'KeyE', 'KeyR', 'KeyF'];   // Fragen 1–4 (die Ziffern schalten die Reiter)
  const V = { tab: 'aktiv', wahl: { aktiv: null, notruf: null }, puls: null, ask: 0 };
  const idx = (l, tab) => { const i = V.wahl[tab] == null ? -1 : l.findIndex((e) => String(e.i) === String(V.wahl[tab])); return i; };
  function aktuell(view, tab) {
    const l = eintraege(view, tab), i = idx(l, tab);
    if (i >= 0) return l[i];
    return (tab === 'notruf' && l.find((r) => r.f)) || l[0] || null;   // Standard: der Fokus des Servers (Kampagnen-Notruf), sonst der erste
  }
  function waehle(tab, e, cmd) { V.wahl[tab] = e.i; if (tab === 'notruf' && e.art === 'kampagne' && cmd) cmd('captain.notruf.fokus', { id: e.i }); }
  // Karten-Klick auf eine Notruf-Marke (starmap.js markeAn): Tab „Notrufe“, Eintrag gewählt und kurz hervorgehoben. -> true, wenn die Marke einen Eintrag hat (immer, solange sie in world.marken steht)
  // Die Marke eines Kampagnen-Notrufs heißt notruf:<id> (server/sim/notrufe.js), sein Eintrag <id>; die Marke eines Takt-Notrufs (reise:nN) ist zugleich die Id des Eintrags.
  const markeId = (e) => (e.art === 'kampagne' ? 'notruf:' + e.i : e.i);
  function oeffne(id) {
    id = String(id == null ? '' : id).replace(/^notruf:/, '');
    V.tab = 'notruf'; V.wahl.notruf = id; V.puls = { id, t: jetzt() };
    return true;
  }
  function setzeTab(tab) { if (tab === 'aktiv' || tab === 'notruf') V.tab = tab; return V.tab; }
  function zustand() { return { tab: V.tab, wahl: { aktiv: V.wahl.aktiv, notruf: V.wahl.notruf } }; }

  const PA = () => window.PultAuftrag;
  function fristText(e) {
    const P = PA();
    if (e.ph !== 'laeuft') return P ? P.beginnt(e.rest) : 'beginnt in ' + num(e.rest) + ' Ticks';
    return num(e.rest) <= 1 ? (P ? P.text('fristBald') : 'Frist läuft ab') : (P ? P.text('frist', { n: e.rest }) : 'Frist noch ' + e.rest + ' Ticks');
  }
  // Frist des Fadens kurz („noch 6 Ticks“); wartet er noch auf den Beginn, ist rest keine Frist („beginnt in 2 Ticks“)
  function fristKurz(e) {
    const P = PA();
    if (e.ph !== 'laeuft') return P ? P.beginnt(e.rest) : 'beginnt in ' + num(e.rest) + ' Ticks';
    return num(e.rest) <= 1 ? (P ? P.text('fristBald') : 'Frist läuft ab') : 'noch ' + num(e.rest) + ' Ticks';
  }
  function schrittText(e) { const P = PA(); return P ? P.text('schritt', { i: e.schritt, n: e.gesamt }) : 'Schritt ' + e.schritt + ' von ' + e.gesamt; }

  // ---- Zeichnen
  const ROW = 28, LEISTE = 14;
  function absatz(ctx, t, x, y, w, farbe, max) { let n = 0; for (const l of R.wrap(t, w, 1).slice(0, max || 3)) { R.text(ctx, l, x, y, { color: farbe }); y += 10; n++; } return y; }
  function zeile1(e, istSel) {
    const k = PAL.star || '#F4EEDC';
    if (e.art === 'faden') return { t: kurz(e.titel, 24), c: istSel ? PAL.amber : k };
    if (e.art === 'mission') return { t: kurz(e.titel, 24), c: istSel ? PAL.amber : k };
    if (e.pseudo) return { t: kurz(e.titel, 24), c: istSel ? PAL.amber : k };
    if (e.art === 'takt') return { t: '! ' + kurz(e.angebot ? ohneNotruf(e.angebot.titel) : e.faden ? ohneNotruf(e.faden.titel) : 'Hilferuf', 22), c: istSel ? PAL.amber : k };   // SPT-02 5b: ohne „Notruf:“ (steht im Tab); ein Hilferuf ohne Auftrag heißt so, nicht wie der Kampagnen-Ruf am selben Ort; der Ort steht in Zeile 2
    return { t: (e.k === 'k' ? '! ' : '? ') + hexName(e.h), c: istSel ? PAL.amber : k };
  }
  // SPT-02 5b: Rot nur für echte Dringlichkeit (Frist läuft ab); Gefahr steht als schraffierte Bake vor dem Text (wie im Brett) und der Text bleibt Mint, „gescheitert“ ist grau
  function zeile2(e) {
    if (e.art === 'faden') return { t: passend([e.notruf ? 'Notruf' : 'Abenteuer', ortName(e.ort), schrittText(e)], [0]), c: PAL.mint, bake: e.gefahr };
    if (e.art === 'mission') return { t: (KIND[e.kind] || 'Mission') + (e.verfolgt ? ' · verfolgt' : ' · aktiv'), c: PAL.ice || PAL.panelLight };
    if (e.pseudo) return { t: e.ausgang === 'gelungen' ? 'erledigt' : 'gescheitert', c: e.ausgang === 'gelungen' ? PAL.mint : PAL.panelLight };
    if (e.art === 'takt') {
      const st = e.angebot ? 'am Brett' : e.faden ? 'angenommen' : 'offen';
      if (e.faden && !e.angebot) {   // angenommen: die Frist des Fadens in Ticks, wie im Brett
        const f = e.faden, bald = f.ph === 'laeuft' && num(f.rest) <= 1;
        return { t: passend([ortName(e.h), st, fristKurz(f)], [1]), c: bald ? PAL.red : PAL.panelLight };
      }
      return { t: passend([ortName(e.h), st, e.b != null ? markeDauer(e.b) : ''], [1]), c: e.b != null && e.b < 90 ? PAL.red : PAL.panelLight };
    }
    return { t: ZUSTAND[e.z] + (e.r != null ? ' · ' + markeDauer(e.r) : ''), c: e.r != null && e.r < 90 ? PAL.red : PAL.panelLight };
  }
  function tabLeiste(ctx, area, anz) {
    const T = [['aktiv', 'Aktive Missionen', 'captain.notruf.tabAktiv', 'A'], ['notruf', 'Notrufe', 'captain.notruf.tabNotruf', 'D']];
    let x = area.x;
    for (const [id, name, aktion, hk] of T) {
      const label = name + ' ' + anz[id];
      const w = Math.ceil(R.measure(label, 1)) + 30;
      R.button(ctx, x, area.y, w, 14, label, { hotkey: hk, aktion, fn: 'nav', active: V.tab === id, onClick: () => { V.tab = id; } });
      x += w + 4;
    }
  }
  function detailFaden(ctx, e, px, pw, py) {
    R.text(ctx, e.notruf ? 'NOTRUF-ABENTEUER' : 'LAUFENDES ABENTEUER', px, py, { color: PAL.mint }); py += 14;
    for (const t of R.wrap(e.titel, pw, 1)) { R.text(ctx, t, px, py, { color: PAL.star || '#F4EEDC' }); py += 10; }
    py += 3;
    if (e.anlass) py = absatz(ctx, e.anlass, px, py, pw, PAL.panelLight, 3) + 3;
    R.text(ctx, schrittText(e) + (e.schrittText ? ': ' + e.schrittText : ''), px, py, { color: PAL.star || '#F4EEDC' }); py += 11;   // SPT-02 5b: neutral, Rot nur für die Gefahr darunter
    if (e.ort) { R.text(ctx, 'Ort: ' + ortText(e.ort), px, py, { color: PAL.panelLight }); py += 11; }
    R.text(ctx, fristText(e), px, py, { color: e.ph === 'laeuft' && num(e.rest) <= 1 ? PAL.red : PAL.amber }); py += 11;
    if (e.gefahr) {
      const T = window.PultTerminal; let gx = px; if (T && T.zeichneGefahrGlyph) { T.zeichneGefahrGlyph(ctx, px, py + 1); gx += T.gefahrGlyphBreite; }
      R.text(ctx, 'Gefahr in diesem Schritt', gx, py, { color: PAL.red }); py += 11;
    }
    return 'W/S wählen · A/D Tab · läuft von allein, nichts zu tun';
  }
  function detailMission(ctx, e, px, pw, py) {
    R.text(ctx, 'MISSION', px, py, { color: PAL.mint }); py += 14;
    for (const t of R.wrap(e.titel, pw, 1)) { R.text(ctx, t, px, py, { color: PAL.star || '#F4EEDC' }); py += 10; }
    py += 3;
    R.text(ctx, (KIND[e.kind] || 'Mission') + (e.verfolgt ? ' · wird verfolgt' : ' · aktiv'), px, py, { color: PAL.ice || PAL.panelLight }); py += 11;
    if (e.von) { R.text(ctx, 'Auftraggeber: ' + e.von, px, py, { color: PAL.star || '#F4EEDC' }); py += 11; }
    if (e.ziel) py = absatz(ctx, 'Ziel: ' + e.ziel, px, py, pw, PAL.star || '#F4EEDC', 2);
    if (e.briefing) py = absatz(ctx, e.briefing, px, py + 3, pw, PAL.panelLight, 4);
    return 'W/S wählen · A/D Tab · Verfolgen im Missionsbuch am Planungstisch';
  }
  function detailPseudo(ctx, sel, px, pw, py) {   // beendeter Faden mit Abschlusstext (kein Befehl, keine Knöpfe)
    R.text(ctx, sel.ausgang === 'gelungen' ? 'AUFTRAG ERLEDIGT' : 'AUFTRAG GESCHEITERT', px, py, { color: sel.ausgang === 'gelungen' ? PAL.mint : PAL.red }); py += 14;
    for (const t of R.wrap(sel.titel, pw, 1)) { R.text(ctx, t, px, py, { color: PAL.star || '#F4EEDC' }); py += 10; }
    py += 4;
    for (const t of R.wrap(sel.text, pw, 1)) { R.text(ctx, t, px, py, { color: PAL.panelLight }); py += 10; }
    if (sel.w.length) { py += 4; for (const t of R.wrap('Wirkung: ' + wirkungText(sel.w), pw, 1)) { R.text(ctx, t, px, py, { color: PAL.amber }); py += 10; } }
    return 'W/S wählen · A/D Tab · beendeter Auftrag, nichts zu tun';
  }
  function detailTakt(ctx, e, px, pw, py) {
    R.text(ctx, 'NOTRUF · ' + hexName(e.h), px, py, { color: PAL.amber }); py += 14;
    const a = e.angebot || e.faden;
    if (a) {
      for (const t of R.wrap(a.titel, pw, 1)) { R.text(ctx, t, px, py, { color: PAL.star || '#F4EEDC' }); py += 10; }
      if (a.anlass) py = absatz(ctx, a.anlass, px, py + 3, pw, PAL.panelLight, 3);
      py += 3;
    } else { py = absatz(ctx, 'Ein Hilferuf aus ' + hexName(e.h) + '. Dazu liegt kein Auftrag am Brett.', px, py, pw, PAL.panelLight, 3) + 3; }
    R.text(ctx, 'Ort: ' + ortText(e.h), px, py, { color: PAL.panelLight }); py += 11;
    // SPT-02 5b: angenommen: die Frist des Fadens in Ticks (wie im Brett); offen oder am Brett: die Lebensdauer der Marke in m:ss (wie beim Kampagnen-Notruf)
    if (e.faden && !e.angebot) R.text(ctx, fristText(e.faden), px, py, { color: e.faden.ph === 'laeuft' && num(e.faden.rest) <= 1 ? PAL.red : PAL.amber }), py += 11;
    else if (e.b != null) { R.text(ctx, 'Frist: ' + markeDauer(e.b), px, py, { color: e.b < 90 ? PAL.red : PAL.amber }); py += 11; }
    if (e.angebot) py = absatz(ctx, 'Angeboten am Auftragsbrett. Annehmen dort (Terminal, Bereich Brett), hier nicht.', px, py + 3, pw, PAL.mint, 3);
    else if (e.faden) py = absatz(ctx, 'Angenommen: läuft unter „Aktive Missionen“.', px, py + 3, pw, PAL.mint, 2);
    else py = absatz(ctx, 'Man muss keinem Ruf folgen.', px, py + 3, pw, PAL.panelLight, 2);
    return 'W/S wählen · A/D Tab · Annahme am Auftragsbrett';
  }
  function detailKampagne(ctx, view, sel, cmd, area, px, pw, py) {
    if (!sel.f && performance.now() - (V.ask || 0) > 500) { V.ask = performance.now(); cmd('captain.notruf.fokus', { id: sel.i }); }   // Details nur für den Fokus
    const f = sel.f || {};
    R.text(ctx, (sel.k === 'k' ? 'KLARER RUF' : 'VERSCHLÜSSELTER RUF') + ' · ' + hexName(sel.h), px, py, { color: PAL.amber }); py += 14;
    if (f.b) {
      R.text(ctx, (f.n || 'Absender') + ':', px, py, { color: PAL.mint }); py += 11;
      for (const t of R.wrap(f.b, pw, 1)) { R.text(ctx, t, px, py, { color: PAL.star || '#F4EEDC' }); py += 10; }
    } else { for (const t of R.wrap('Der Absender ist nicht zu verstehen. Die Ops muss das Signal entschlüsseln (Taktik, Taste I).', pw, 1)) { R.text(ctx, t, px, py, { color: PAL.panelLight }); py += 10; } py += 2; }
    if (f.e != null) { R.text(ctx, 'Signalqualität ' + f.e + ' von 3 – Indizien bei der Ops.', px, py, { color: PAL.panelLight }); py += 11; }
    if (f.s) { for (const t of R.wrap('Sonde: ' + f.s, pw, 1)) { R.text(ctx, t, px, py, { color: PAL.mint }); py += 10; } }
    py += 4;
    (f.q || []).forEach((q, i) => {
      const done = (f.a || []).some((a) => a[0] === i);
      R.button(ctx, px, py, pw, 14, q + (done ? ' (gefragt)' : ''), { hotkey: FRAGE_TASTEN[i].slice(3), onClick: () => cmd('captain.notruf.befragen', { id: sel.i, i }) });
      py += 16;
    });
    for (const a of (f.a || []).slice(-2)) { for (const t of R.wrap('„' + (f.q || [])[a[0]] + '“ – ' + a[1], pw, 1).slice(0, 2)) { R.text(ctx, t, px, py, { color: PAL.panelLight }); py += 10; } }
    const by = area.y + area.h - 18;
    R.button(ctx, px, by, 120, 15, 'Hinfliegen', { hotkey: 'Enter', onClick: () => cmd('captain.notruf.hinfliegen', { id: sel.i }) });
    R.button(ctx, px + 126, by, 120, 15, 'Ignorieren', { hotkey: 'X', disabled: sel.z === 2, onClick: () => cmd('captain.notruf.ablehnen', { id: sel.i }) });
    return 'W/S wählen · A/D Tab · Q/E/R/F fragen · Enter hinfliegen · X ignorieren (kostet nichts)';
  }

  // Captain-Reiter „Aufträge“. area { x, y, w, h }; cmd(c, extra) schickt Befehle. -> Hilfetext
  function drawCaptain(ctx, view, area, cmd) {
    const L = { aktiv: aktiveListe(view), notruf: notrufListe(view) };
    tabLeiste(ctx, area, { aktiv: L.aktiv.length, notruf: L.notruf.length });
    const tab = V.tab, l = L[tab], top = area.y + 20;
    const ar = { x: area.x, y: top, w: area.w, h: area.h - (top - area.y) - LEISTE };   // unten bleibt die Fracht-/Rangleiste der Konsole frei
    if (!l.length) { R.text(ctx, tab === 'notruf' ? TXT.notrufLeer : TXT.aktivLeer, ar.x + 4, ar.y + 2, { color: PAL.panelLight }); return 'A/D Tab wechseln'; }
    const lw = LW, sel = aktuell(view, tab);
    const rows = Math.max(1, Math.floor((ar.h + 2) / ROW)), si = Math.max(0, l.findIndex((e) => sel && e.i === sel.i));
    const ab = si >= rows ? si - rows + 1 : 0;
    let y = ar.y;
    l.slice(ab, ab + rows).forEach((e) => {
      const isSel = !!sel && sel.i === e.i;
      ctx.fillStyle = isSel ? 'rgba(255,198,107,0.18)' : 'rgba(255,255,255,0.04)'; ctx.fillRect(ar.x, y - 2, lw, 24);
      if (V.puls && V.puls.id === String(e.i)) {   // Karten-Klick: der Eintrag blinkt kurz (1,6 s)
        const dt = (jetzt() - V.puls.t) / 1000;
        if (dt < 1.6 && Math.floor(dt * 5) % 2 === 0) { ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1; ctx.strokeRect(ar.x + 0.5, y - 1.5, lw - 1, 23); }
      }
      const z1 = zeile1(e, isSel), z2 = zeile2(e);
      R.text(ctx, z1.t, ar.x + 4, y, { color: z1.c });
      let x2 = ar.x + 4;
      if (z2.bake) { const T = window.PultTerminal; if (T && T.zeichneGefahrGlyph) { T.zeichneGefahrGlyph(ctx, x2, y + 11); x2 += T.gefahrGlyphBreite; } else R.text(ctx, '!', x2, y + 10, { color: PAL.red }), x2 += 8; }
      R.text(ctx, z2.t, x2, y + 10, { color: z2.c });
      if (R.ui && R.ui.buttons) R.ui.buttons.push({ x: ar.x, y: y - 2, w: lw, h: 24, label: '', disabled: false, onClick: () => waehle(tab, e, cmd) });
      y += ROW;
    });
    if (l.length > rows) { R.text(ctx, (ab > 0 ? '▲ ' : '') + (si + 1) + '/' + l.length + (ab + rows < l.length ? ' ▼' : ''), ar.x + lw - 4, ar.y + ar.h - 8, { color: PAL.panelLight, align: 'right' }); }
    if (!sel) return 'W/S wählen';
    const px = ar.x + lw + 12, pw = ar.w - lw - 14;
    if (sel.art === 'faden') return detailFaden(ctx, sel, px, pw, ar.y);
    if (sel.art === 'mission') return detailMission(ctx, sel, px, pw, ar.y);
    if (sel.pseudo) return detailPseudo(ctx, sel, px, pw, ar.y);
    if (sel.art === 'takt') return detailTakt(ctx, sel, px, pw, ar.y);
    return detailKampagne(ctx, view, sel, cmd, ar, px, pw, ar.y);
  }

  function key(code, view, cmd) {
    if (code === 'ArrowLeft' || code === 'KeyA') { V.tab = 'aktiv'; return true; }
    if (code === 'ArrowRight' || code === 'KeyD') { V.tab = 'notruf'; return true; }
    const tab = V.tab, l = eintraege(view, tab);
    if (!l.length) return false;
    const sel = aktuell(view, tab);
    const i = Math.max(0, l.findIndex((e) => sel && e.i === sel.i));
    const geh = (n) => { const e = l[(i + n + l.length) % l.length]; waehle(tab, e, cmd); V.puls = null; return true; };
    if (code === 'ArrowUp' || code === 'KeyW') return geh(-1);
    if (code === 'ArrowDown' || code === 'KeyS') return geh(1);
    if (tab !== 'notruf' || !sel || sel.art !== 'kampagne') return false;   // SPT-02 2/5: Pseudo-Eintrag, Fäden, Missionen und Takt-Notrufe: weder Enter (hinfliegen) noch X noch Fragen
    if (code === 'Enter' || code === 'NumpadEnter') { cmd('captain.notruf.hinfliegen', { id: sel.i }); return true; }
    if (code === 'KeyX' && sel.z !== 2) { cmd('captain.notruf.ablehnen', { id: sel.i }); return true; }
    const fi = FRAGE_TASTEN.indexOf(code); if (fi >= 0 && sel.f && sel.f.q && sel.f.q[fi]) { cmd('captain.notruf.befragen', { id: sel.i, i: fi }); return true; }   // Ziffern wechseln den Reiter
    return false;
  }

  // Ops: Knopf „Notruf entschlüsseln“ für den ersten verschlüsselten, noch ungeöffneten Ruf (oder den Fokus)
  function opsZiel(st) { return liste(st).find((r) => r.k === 'v' && r.z < 3 && !(r.f && r.f.e != null) && !(r.f && r.f.b)) || null; }
  function drawButton(ctx, view, rect, cmd) {
    const st = view.state; const r = opsZiel(st); if (!r) return;
    const busy = !!(st.en && st.en.z !== 2);
    R.button(ctx, rect.x + rect.w - 154, rect.y + rect.h - 32, 150, 13, 'Notruf ' + r.h + ' öffnen', { hotkey: 'I', disabled: busy, reason: busy ? 'Ein Signal wird gerade abgestimmt' : null, onClick: () => cmd('weapons.notruf.entschluesseln', { id: r.i }) });
  }
  function opsKey(code, view, cmd) {
    if (code !== 'KeyI') return false;
    const r = opsZiel(view.state); if (!r) return false;
    cmd('weapons.notruf.entschluesseln', { id: r.i }); return true;
  }

  // Ruf-Ort in der Taktik-/Lagekarte (neutral, ohne Wahrheit): Ring mit Bergungsradius und Fortschritt
  function draw(ctx, st, toS, zoom, t) {
    const o = st && st.space && st.space.nro; if (!o) return;
    const p = toS(o.x, o.y);
    ctx.strokeStyle = 'rgba(255,107,94,' + (0.5 + 0.3 * Math.sin(t * 4)) + ')'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(6, num(o.r, 140) * zoom), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#FF6B5E'; ctx.fillRect(p.x - 1.5, p.y - 5, 3, 7); ctx.fillRect(p.x - 1.5, p.y + 4, 3, 3);
    if (num(o.p) > 0) { ctx.strokeStyle = PAL.mint; ctx.beginPath(); ctx.arc(p.x, p.y, 10, -Math.PI / 2, -Math.PI / 2 + num(o.p) * Math.PI * 2); ctx.stroke(); }
    R.text(ctx, 'Notruf', p.x + 12, p.y - 4, { color: '#FF6B5E' });
  }

  window.NotrufView = { drawCaptain, key, drawButton, opsKey, draw, liste, pseudoEintraege, aktiveListe, notrufListe, oeffne, setzeTab, zustand, markeId };
})();
