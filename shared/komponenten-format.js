// TEC-01 B2: Lesepunkt für das Komponentenformat der Schildkette (UMD: window.Shared_KomponentenFormat / require). Rein, ohne Abhängigkeiten.
// Leser: Client (Bedienung der Komponentenwahl, Übersicht TEC-01 D) UND Server: server/sim/komponenten.js nutzt dieses Modul als einzige Quelle für Kodieren/Dekodieren, Namen,
// Zulässigkeit der Ziele, Bruchformel und Konstanten (TEC-01 Nacharbeit 1.2). tools/test-komp-bedienung.js prüft den Roundtrip Server -> Format.
//
// Format (Snapshot ship.komp[sys], Weltstand schiff.komp[sys]): ein Zustandscode je Komponente in Rezeptreihenfolge (o ok, d defekt, g geflickt, - unbekannt),
// bei gesetzten Zählern folgt ';Ausfall1,Ausfall2..;Sprung1,Sprung2..'. Fehlt das System im Snapshot, weicht keine Komponente ab (alles ok).
// Rezepte: config.systemModell.komponenten { rezepte: { name: [Art..] }, systeme: { sys: name }, ausfallSperre }.
//
// Aktionen der Zielwahl: 'flick' (nur defekte), 'swap' (defekte, dann geflickte), 'minigame' (nur das Relais R, nicht verschlissen). Dieselben Regeln wie komponenten.reparaturZiel.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_KomponentenFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const OK = 'ok', DEFEKT = 'defekt', GEFLICKT = 'geflickt';
  const VON_CODE = { o: OK, d: DEFEKT, g: GEFLICKT };
  const CODE = { [OK]: 'o', [DEFEKT]: 'd', [GEFLICKT]: 'g' };
  const NAMEN = { K: 'Steuerkern', S: 'Spannungsregler', R: 'Relais', L: 'Leitung' };
  const MINISPIEL_ART = 'R';
  const AUSFALL_SPERRE = 3;
  const MAX_DEFEKT_BROKEN = 2;

  function name(t) { return NAMEN[t] || String(t); }

  // Rezept (Liste der Arten) eines Systems aus config.systemModell.komponenten; null ohne Rezept
  function rezeptVon(daten, sys) {
    const n = daten && daten.systeme && daten.systeme[sys];
    const r = n && daten.rezepte && daten.rezepte[n];
    return Array.isArray(r) ? r : null;
  }
  function sperreVon(daten) { const v = Number(daten && daten.ausfallSperre); return v >= 1 ? v : AUSFALL_SPERRE; }

  // [{ t, z, n, sp }] -> Text (Gegenstück zu dekodiere): Zustandscodes, bei gesetzten Zählern ';n1,n2..;sp1,sp2..'
  function zaehlerTeil(l) { return l.some((k) => k.n > 0 || k.sp > 0) ? ';' + l.map((k) => k.n | 0).join(',') + ';' + l.map((k) => k.sp | 0).join(',') : ''; }
  function kodiere(l) { return l.map((k) => CODE[k.z] || 'o').join('') + zaehlerTeil(l); }
  // Text -> [{ t, z, n, sp }] in Rezeptreihenfolge (z null bei '-'); null, wenn der Text nicht zum Rezept passt
  function dekodiere(text, rezept) {
    if (!Array.isArray(rezept) || typeof text !== 'string') return null;
    const teile = text.split(';');
    const codes = teile[0];
    if (codes.length !== rezept.length || ![...codes].every((c) => c in VON_CODE || c === '-')) return null;
    const zahlen = (t) => { const a = String(t || '').split(',').map((x) => Math.max(0, Math.min(9999, parseInt(x, 10) || 0))); return a.length === rezept.length ? a : rezept.map(() => 0); };
    const n = zahlen(teile[1]), sp = zahlen(teile[2]);
    return rezept.map((t, i) => ({ t, z: VON_CODE[codes[i]] || null, n: n[i], sp: sp[i] }));
  }
  // Wie der Server ohne Komponentenliste: damaged = letzte Komponente defekt, broken = die letzten zwei (die Rezeptenden fallen zuerst aus)
  function ausZustand(rezept, zustand) {
    const zahl = Math.min(zustand === 'broken' ? MAX_DEFEKT_BROKEN : zustand === 'damaged' ? 1 : 0, rezept.length);
    return rezept.map((t, i) => ({ t, z: i >= rezept.length - zahl ? DEFEKT : OK, n: 0, sp: 0 }));
  }
  // Komponenten eines Systems aus dem Snapshot: st = Snapshot (st.ship.komp, st.ship.systems), daten = config.systemModell.komponenten.
  // null: das System hat kein Rezept. Fehlt der Text (oder passt nicht), gilt der Systemzustand.
  function liste(st, daten, sys) {
    const rezept = rezeptVon(daten, sys);
    if (!rezept) return null;
    const ship = (st && st.ship) || {};
    const text = ship.komp && ship.komp[sys];
    const l = text == null ? null : dekodiere(text, rezept);
    if (l && l.every((k) => k.z)) return l;
    const zust = ship.systems && ship.systems[sys];
    const basis = ausZustand(rezept, zust === 'damaged' || zust === 'broken' ? zust : 'ok');
    if (l) l.forEach((k, i) => { basis[i].n = k.n; basis[i].sp = k.sp; });   // '-' im Text: nur die Zähler gelten
    return basis;
  }

  // Zulässige Ziele (Arten) einer Aktion in Wechselreihenfolge; der erste Eintrag ist der Standard des Servers
  function zulaessigeZiele(l, aktion, sperre) {
    if (!Array.isArray(l)) return [];
    const art = (z) => l.filter((k) => k.z === z).map((k) => k.t);
    if (aktion === 'flick') return art(DEFEKT);
    if (aktion === 'swap') return art(DEFEKT).concat(art(GEFLICKT));
    if (aktion === 'minigame') {
      const k = l.find((q) => q.t === MINISPIEL_ART);
      return k && k.z !== OK && k.z != null && k.n < (sperre >= 1 ? sperre : AUSFALL_SPERRE) ? [MINISPIEL_ART] : [];
    }
    return [];
  }
  function standardZiel(l, aktion, sperre) { return zulaessigeZiele(l, aktion, sperre)[0] || null; }
  // Gewähltes Ziel, solange es zulässig ist; sonst Standard (Rückfall); null, wenn nichts zulässig ist
  function zielWahl(l, aktion, gewaehlt, sperre) {
    const z = zulaessigeZiele(l, aktion, sperre);
    return gewaehlt && z.includes(gewaehlt) ? gewaehlt : (z[0] || null);
  }
  // Wechsel-Taste: das nächste zulässige Ziel nach dem aktuellen (rund herum); null, wenn nichts zulässig ist
  function naechstesZiel(l, aktion, gewaehlt, sperre) {
    const z = zulaessigeZiele(l, aktion, sperre);
    if (!z.length) return null;
    const i = z.indexOf(zielWahl(l, aktion, gewaehlt, sperre));
    return z[(i + 1) % z.length];
  }
  // Aktion des E-Haltens: Ersatzteil in der Hand = Tausch, sonst Flicken
  function aktionFuerHand(traegt) { return traegt === 'ersatzteil' ? 'swap' : 'flick'; }

  // Bedienung an einer Station: was E (Flicken/Tausch) und R (Minispiel) jetzt tun und wie viele Ziele die Wechsel-Taste hat.
  // { aktion, ziel, anzahl, minispiel (R ist zulässig), geflickt: [Arten] } – ziel null: E hat nichts zu tun (nichts defekt bzw. nichts zu tauschen)
  function bedienung(l, traegt, gewaehlt, sperre) {
    const aktion = aktionFuerHand(traegt);
    const z = zulaessigeZiele(l, aktion, sperre);
    return { aktion, ziel: zielWahl(l, aktion, gewaehlt, sperre), anzahl: z.length, minispiel: zulaessigeZiele(l, 'minigame', sperre).length > 0, geflickt: (l || []).filter((k) => k.z === GEFLICKT).map((k) => k.t) };
  }

  // ---------- TEC-01 D: Übersicht (Schadensplan der Technik-Konsole). Nur Texte und Zahlen; gezeichnet wird in public/js/consoles.js ----------
  const BRUCH_GRUND = 0.3, BRUCH_PRO_SPRUNG = 0.1;   // Standard, wenn komponenten.sprungBruch fehlt (der Server nutzt bruchChance von hier)
  const ZUSTAND_TEXT = { ok: 'ok', defekt: 'DEFEKT', geflickt: 'geflickt' };
  const SYSTEM_TEXT = { ok: 'heil', damaged: 'beschädigt', broken: 'zerstört', offline: 'offline (EMP)' };
  const AKTION_NAMEN = { minigame: 'Minispiel', flick: 'Flicken', swap: 'Tausch' };
  const hatZaehler = (t) => t === 'R' || t === 'K';   // Ausfallzähler führen nur Relais und Steuerkern

  // Bruchwahrscheinlichkeit eines Flickens, der sp Sprünge überstanden hat: grund + proSprung * sp, höchstens 1 (Daten: daten.sprungBruch { grund, proSprung })
  function bruchChance(sp, daten) {
    const d = (daten && daten.sprungBruch) || {};
    const grund = Number(d.grund), pro = Number(d.proSprung);
    const g = grund >= 0 ? grund : BRUCH_GRUND, p = pro >= 0 ? pro : BRUCH_PRO_SPRUNG;
    return Math.min(1, g + p * Math.max(0, Math.floor(Number(sp)) || 0));
  }
  function bruchProzent(sp, daten) { return Math.round(bruchChance(sp, daten) * 100); }
  function verschlissen(k, sperre) { return !!k && hatZaehler(k.t) && k.n >= (sperre >= 1 ? sperre : AUSFALL_SPERRE); }
  function zustandText(z) { return ZUSTAND_TEXT[z] || '?'; }
  // Ausfallzähler (nur R und K): „Ausfälle 2/3“, bei Erreichen der Sperre „verschlissen (3/3)“; sonst null
  function ausfallText(k, sperre) {
    if (!k || !hatZaehler(k.t)) return null;
    const s = sperre >= 1 ? sperre : AUSFALL_SPERRE;
    return k.n >= s ? 'verschlissen (' + s + '/' + s + ')' : 'Ausfälle ' + k.n + '/' + s;
  }
  // Hinweis an einer geflickten Komponente: „bricht beim Sprung mit 40 %“; sonst null
  function bruchText(k, daten) { return k && k.z === GEFLICKT ? 'bricht beim Sprung mit ' + bruchProzent(k.sp, daten) + ' %' : null; }
  // Mögliche Aktionen einer Komponente in Klartext (dieselben Regeln wie zulaessigeZiele): „Minispiel · Flicken · Tausch“, „Flicken · Tausch“, „nur Flicken oder Tausch“ (verschlissen), „nur Tausch“; null: nichts zu tun (ok)
  function aktionText(l, art, sperre) {
    const k = Array.isArray(l) ? l.find((q) => q.t === art) : null;
    if (!k || k.z === OK || k.z == null) return null;
    const a = ['minigame', 'flick', 'swap'].filter((x) => zulaessigeZiele(l, x, sperre).includes(art));
    if (a.length === 2 && a[0] === 'flick' && art === MINISPIEL_ART && verschlissen(k, sperre)) return 'nur Flicken oder Tausch';
    if (a.length === 1) return 'nur ' + AKTION_NAMEN[a[0]];
    return a.map((x) => AKTION_NAMEN[x]).join(' · ');
  }
  // Zeilen der Komponentenanzeige in Rezeptreihenfolge: { t, name, z, zustand (Text), ausfall, bruch, aktion, verschlissen }
  function zeilen(l, daten) {
    const sperre = sperreVon(daten);
    return (l || []).map((k) => ({ t: k.t, name: name(k.t), z: k.z, zustand: zustandText(k.z), ausfall: ausfallText(k, sperre), bruch: bruchText(k, daten), aktion: aktionText(l, k.t, sperre), verschlissen: verschlissen(k, sperre) }));
  }
  // Komponenten gleichen Zustands zusammengefasst, defekte zuerst: „Steuerkern, Spannungsregler defekt; Relais geflickt“ (benennen: Art -> Text); leere Liste: null
  function gruppiert(l, benennen) {
    const g = [[DEFEKT, 'defekt'], [GEFLICKT, 'geflickt']].map(([z, w]) => { const t = (l || []).filter((k) => k.z === z).map((k) => benennen(k.t)); return t.length ? t.join(', ') + ' ' + w : null; }).filter(Boolean);
    return g.length ? g.join('; ') : null;
  }
  // Ursache in einem Satz: „Spannungsregler defekt“, „Steuerkern, Spannungsregler defekt; Relais geflickt“; null, wenn alle Komponenten ok sind
  function ursacheText(l) { return gruppiert(l, name); }
  // Zusammenfassung eines Systems: „Schildgenerator: beschädigt – Spannungsregler defekt“. zustand = Systemzustand (ok/damaged/broken/offline); ein heiles System mit Flicken heißt „geflickt“
  function zusammenfassung(sysName, zustand, l) {
    const u = ursacheText(l);
    const flick = (l || []).some((k) => k.z === GEFLICKT);
    const z = zustand === 'ok' && flick ? 'geflickt' : (SYSTEM_TEXT[zustand] || SYSTEM_TEXT.ok);
    return sysName + ': ' + z + (u ? ' – ' + u : '');
  }
  // Einzeilige Form eines Systems ohne Aufklappen: nur die abweichenden Komponenten als Art-Buchstaben mit Zustand („K, S defekt; R geflickt“), sonst „heil“
  function kompaktText(l) { return gruppiert(l, (t) => t) || 'heil'; }
  // Reparaturliste: Modus des Eintrags ('flick' | 'part') -> Aktion der Zielwahl ('flick' | 'swap')
  function aktionFuerModus(mode) { return mode === 'part' ? 'swap' : mode === 'flick' ? 'flick' : null; }
  // Grund, warum eine Komponente für den Modus der Reparaturliste kein Ziel sein kann (Text für die Konsole); null = zulässig
  function ablehnGrund(l, mode, art, sperre) {
    const aktion = aktionFuerModus(mode);
    const k = Array.isArray(l) ? l.find((q) => q.t === art) : null;
    if (!aktion || !k) return 'Keine Komponente gewählt';
    if (zulaessigeZiele(l, aktion, sperre).includes(art)) return null;
    if (k.z === OK || k.z == null) return name(art) + ' ist heil';
    return name(art) + ' ist schon geflickt – für dauerhaft: Tausch';
  }

  // ---------- TEC-01 Nacharbeit: Texte der Bedienung (reine Funktionen, vom Client nur angezeigt) ----------
  // Stationshinweis an einer Schildkette-Station (E-Zeile, R-Zeile, Q-Zeile). kb = { l (Komponenten), b (bedienung), z (zulässige Ziele der E-Aktion), sperre }, sysName = Anzeigename des Systems,
  // sek = { flick, swap } (Dauertexte wie „1,5 s“). Der Aktionsname heißt überall Tausch (Teil/Ersatzteil ist nur der Gegenstand); die Regel „bricht beim Sprung“ gilt für jeden Flicken der Kette.
  function stationsHinweis(kb, sysName, sek) {
    const b = kb.b;
    let r;
    if (b.minispiel) r = { label: 'Minispiel: reparieren (dauerhaft)', ok: true };
    else {
      const rk = kb.l.find((k) => k.t === MINISPIEL_ART);
      r = { label: !rk ? 'kein Minispiel hier' : rk.z === 'ok' ? 'kein Minispiel: Relais ist heil' : 'Relais verschlissen: nur Flicken/Tausch', ok: false };
    }
    const q = kb.z.length > 1 ? { label: 'Ziel wechseln (' + (kb.z.indexOf(b.ziel) + 1) + '/' + kb.z.length + ')', ok: true } : null;
    if (b.ziel == null) return { label: sysName + ': ' + b.geflickt.map(name).join(', ') + ' geflickt – bricht beim Sprung', ok: false, r, q };
    const tausch = b.aktion === 'swap';
    return { label: 'halten: ' + (tausch ? 'Tausch' : 'Flicken') + ' – ' + name(b.ziel) + ' (' + (tausch ? sek.swap + ', dauerhaft' : sek.flick + ', bricht beim Sprung') + ')', ok: true, r, q };
  }
  // Statuszeile eines Eintrags der Reparaturliste: q = { bot, komp } oder null, botName = Anzeigename des Schraubers (nur mit q.bot)
  function listeText(q, botName) {
    if (!q) return 'nicht in der Liste';
    const k = q.komp ? name(q.komp) : null;
    if (q.bot) return (botName || 'Schrauber') + ' arbeitet daran' + (k ? ' · ' + k : '');
    return k ? 'in Liste: ' + k + ' · wartet' : 'in der Liste, wartet auf Schrauber';
  }
  // Auslassungszeilen der Komponentenübersicht (Platz reicht nicht): übrige Komponenten des gewählten Systems; weitere Systeme der Kette mit Schaden
  function mehrText(anzahl) { return '… ' + anzahl + (anzahl === 1 ? ' Komponente' : ' Komponenten') + ' mehr'; }
  function weitereText(anzahl) { return '+' + anzahl + ' weitere (W/S im Plan)'; }
  // Titel des Reparatur-Minispiels: Systemname, an Systemen mit Relais-Minispiel (Schildkette) mit der Komponente: „Backbord-Emitter · Relais“
  function minispielTitel(sysName, daten, sys) {
    const r = rezeptVon(daten, sys);
    return r && r.includes(MINISPIEL_ART) ? sysName + ' · ' + name(MINISPIEL_ART) : sysName;
  }

  return { stationsHinweis, listeText, minispielTitel, mehrText, weitereText, NAMEN, MINISPIEL_ART, AUSFALL_SPERRE, MAX_DEFEKT_BROKEN, kodiere, zaehlerTeil, name, rezeptVon, sperreVon, dekodiere, ausZustand, liste, zulaessigeZiele, standardZiel, zielWahl, naechstesZiel, aktionFuerHand, bedienung,
    bruchChance, bruchProzent, verschlissen, zustandText, ausfallText, bruchText, aktionText, zeilen, ursacheText, zusammenfassung, kompaktText, aktionFuerModus, ablehnGrund };
});
