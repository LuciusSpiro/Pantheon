'use strict';
// TEL-01 D1: Sessionbericht als Markdown. bericht(kz, opt) -> Text, HOECHSTENS ZEILEN_MAX = 60 Zeilen (ein harter Deckel, Test und Mutationsprobe halten ihn fest),
// keine Zeile ueber ZEILE_MAX_ZEICHEN = 160 Zeichen (laengere werden an einem Trenner umgebrochen und eingerueckt).
//   kz   Kennzahlen-Objekt aus kennzahlen.js (der Vertrag)
//   opt  { basis, ziele, svg }
//          basis  Kennzahlen-Objekt (oder flache Map { schluessel: zahl }) einer früheren Session: Abweichungen kommen oben in die Auffälligkeiten
//          ziele  { schluessel: { min, max } } (Datei tools/fixtures/telemetrie/ziele.json, Format unten); leer -> keine Ampel
//          svg    Dateiname des Gefechtsprofils, relativ eingebunden: ![Gefechtsprofil](<svg>)
//
// bericht.js STELLT NUR DAR. Was auffaellig ist (Basis-Abweichung, Ziele, Ampel, Leerlauf, Verluste, Technik, Daten), entscheidet bewertung.js; D2 nutzt dieselbe Bewertung.
// Reihenfolge der Auffaelligkeiten: Daten, Basis-Abweichungen (mit Zielen), Technik, Verluste, Leerlauf. Daten und Technik werden nie weggekuerzt; zuerst kuerzen sich die
// einzelnen Basis-Zeilen, dann (nur wenn es immer noch zu viele sind) Leerlauf, Ziele, Verluste.
//
// ZIELDATEI tools/fixtures/telemetrie/ziele.json: { "version": 1, "ziele": { "<Kennzahl-Schlüssel>": { "min": <Zahl>, "max": <Zahl> } } }
//   min und max sind einzeln optional. Leer ({ "version": 1, "ziele": {} }) -> keine Ampeln. Kai legt die Werte fest; es stehen keine erfundenen Werte darin.
//   Mit Eintrag: Block "Ziele" mit Ampel je Kennzahl ([gruen] im Bereich, [rot] außerhalb, [grau] kein Wert im Lauf), rote Eintraege auch oben in den Auffälligkeiten.
//
// Keine Namen: der Bericht nennt nur Slots (p1..p4) und Rollen. Nichts davon geht an ein LLM.

const { bewerten } = require('./bewertung.js');

const ZEILEN_MAX = 60;
const ZEILE_MAX_ZEICHEN = 160;
const AUFFAELLIG_MAX = 8;             // Zeilen im Auffälligkeiten-Abschnitt (ohne Ueberschrift)
const BASIS_ZEILEN_MAX = 3;           // einzelne Basis-Abweichungen, die einzeln genannt werden

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const n = (v, d) => (num(v) ? (Math.round(v * Math.pow(10, d == null ? 1 : d)) / Math.pow(10, d == null ? 1 : d)).toString().replace('.', ',') : '-');
function zeit(s) {
  if (!num(s)) return '-';
  if (s < 120) return n(s, 1) + ' s';
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return (r === 60 ? m + 1 : m) + ':' + String(r === 60 ? 0 : r).padStart(2, '0') + ' min';
}
const wert = (v, einheit) => (einheit === '%' ? n(v, 1) + ' %' : einheit === 's' ? zeit(v) : einheit === 'ms' ? n(v, 2) + ' ms' : einheit === 'mb/h' ? n(v, 1) + ' MB/h' : n(v, 2));
const get = (o, pfad) => { let c = o; for (const k of pfad.split('.')) { if (c == null || typeof c !== 'object') return undefined; c = c[k]; } return c; };
const keys = (o) => (o && typeof o === 'object' ? Object.keys(o).sort() : []);
const vz = (v) => (v > 0 ? '+' : '') + n(v, 0);

// K12: eine Zeile hoechstens max Zeichen. Umbruch an ' · ', ', ' oder Leerzeichen; Folgezeilen werden eingerueckt (Markdown-Listenpunkt bleibt zusammen)
function umbrechen(zeile, max) {
  if (zeile.length <= max) return [zeile];
  const einzug = ' '.repeat(/^(s*)(- )?/.exec(zeile)[0].length);
  const out = [];
  let rest = zeile;
  while (rest.length > max) {
    let i = -1, laenge = 0, behalte = 0;   // behalte: Zeichen des Trenners, die am Ende der Zeile bleiben (das Komma)
    for (const [trenner, bleibt] of [[' · ', 0], [', ', 1], [' ', 0]]) {
      const k = rest.lastIndexOf(trenner, max - trenner.length);
      if (k > einzug.length + 20) { i = k; laenge = trenner.length; behalte = bleibt; break; }
    }
    if (i < 0) { out.push(rest.slice(0, max)); rest = einzug + rest.slice(max); continue; }   // kein Trenner: hart schneiden
    out.push(rest.slice(0, i + behalte));
    rest = einzug + rest.slice(i + laenge);
  }
  out.push(rest);
  return out;
}

// ---------- Auffälligkeiten (Darstellung der Bewertung) ----------
function zielText(z) { return (num(z.min) ? 'min ' + n(z.min, 2) : '') + (num(z.min) && num(z.max) ? ', ' : '') + (num(z.max) ? 'max ' + n(z.max, 2) : ''); }

function auffaelligkeiten(kz, opt) {
  opt = opt || {};
  const b = opt.bewertung || bewerten(kz, opt);
  // Gruppen in der festen Reihenfolge; fest = wird nie gekuerzt
  const daten = b.daten.length ? ['Daten: ' + b.daten.map((x) => (x.k === 'schema_version' || x.k === 'warnung' || x.k === 'f6.daten.ohne_ende' ? x.name : x.n + ' ' + x.name)).join(', ') + ' (Kennzahlen unvollständig möglich)'] : [];
  const basisKopf = [];
  let devs = [];
  if (!b.basis) basisKopf.push('Basis: keine Basis angegeben (kein Vergleich; --basis <json> vergleicht mit einer früheren Session)');
  else {
    basisKopf.push('Basis: ' + b.basis.verglichen + ' Kennzahlen verglichen, ' + b.basis.liste.length + ' wesentlich anders (>= 25 % und Mindestmenge je Kennzahl)' + (b.basis.fehlt ? ', ' + b.basis.fehlt + ' nur in der Basis' : ''));
    devs = b.basis.liste.map((x) => {
      const e = x.info.einheit;
      return '  ' + x.k + ': ' + wert(x.a, e) + ' statt ' + wert(x.b, e) + (x.b !== 0 ? ' (' + (x.a >= x.b ? '+' : '-') + n(100 * Math.abs(x.a - x.b) / Math.abs(x.b), 0) + ' %)' : '') + (x.info.richtung === 'neutral' ? '' : x.schlechter ? ', schlechter' : ', besser');
    });
  }
  const ziele = b.ziele.filter((x) => x.status === 'rot').slice(0, 2).map((x) => 'Ziel verfehlt: ' + x.k + ' = ' + wert(x.w, x.info && x.info.einheit) + ' (Ziel ' + zielText(x.z) + ')');
  const technik = b.technik.length ? ['Technik: ' + b.technik.map((x) => (x.k === 'f6.tick.ueber33' ? x.n + ' ' + x.name + ' (max ' + n(x.max, 1) + ' ms)' : x.k === 'f6.kappung.n' ? x.name + ' ' + x.n + '× (' + x.ticks + ' Ticks verworfen)' : x.n + ' ' + x.name)).join(', ')] : [];
  const verl = b.verluste.length ? ['Verluste: ' + b.verluste.map((x) => x.n + ' ' + x.name).join(', ') + (num(b.erster) ? ' (erster bei ' + zeit(b.erster) + ')' : '')] : [];
  const leer = b.leerlauf.length ? ['Leerlauf (>= 30 s ohne Eingabe): ' + b.leerlauf.map((x) => x.slot + ' ' + zeit(x.dauer) + ' (' + n(x.anteil, 0) + ' %)').join(', ')] : [];

  // Zu viele Zeilen: zuerst die einzelnen Basis-Zeilen kuerzen, dann Leerlauf, Ziele, Verluste; Daten und Technik bleiben
  let rest = { leer, ziele, verl };
  const fest = () => daten.length + basisKopf.length + technik.length;
  const frei = () => AUFFAELLIG_MAX - fest() - rest.leer.length - rest.ziele.length - rest.verl.length;
  for (const k of ['leer', 'ziele', 'verl']) { while (frei() < 0 && rest[k].length) rest[k] = rest[k].slice(0, -1); }
  let zeigen = Math.min(BASIS_ZEILEN_MAX, devs.length, Math.max(0, frei()));
  if (devs.length > zeigen && zeigen > 0 && zeigen === frei()) zeigen--;   // Platz fuer die Restzeile
  const devZeilen = devs.slice(0, zeigen);
  const mehr = devs.length - zeigen;
  if (mehr > 0 && frei() - zeigen >= 1) devZeilen.push('  (+' + mehr + ' weitere Abweichungen)');
  const z = [].concat(daten, basisKopf, devZeilen, rest.ziele, technik, rest.verl, rest.leer);
  if (!daten.length && !technik.length && !verl.length && !leer.length && !devs.length && !ziele.length) z.push('sonst keine Auffälligkeiten');
  return z;
}

// ---------- Bloecke ----------
const liste = (o, fn, trenn) => keys(o).map((k) => fn(k, o[k])).filter(Boolean).join(trenn || ' · ');

function kopfBlock(kz) {
  const k = kz.kopf || {};
  const sz = (kz.listen && kz.listen.szenen) || [];
  const f1 = kz.f1 || {};
  const sp = f1.spieler || {};
  const szenen = sz.slice(0, 4).map((s) => String(s.szene || s.modus) + ' ' + zeit(s.start == null ? 0 : s.start) + '-' + zeit(s.ende) + (num(s.spielerzahl) ? ' (' + s.spielerzahl + ' Sp.)' : '')).join(', ') + (sz.length > 4 ? ' +' + (sz.length - 4) + ' weitere' : '');
  return [
    '# Sessionbericht ' + (k.sitzung || '?'),
    'Quelle ' + (k.quelle || '?') + ' · Commit ' + (k.commit ? String(k.commit).slice(0, 8) : '?') + ' · ' + (k.plattform || '?') + ' · Modus ' + (k.modus || '?') + (k.szenario ? ' (' + k.szenario + ')' : '') + ' · Seed ' + (k.seed == null ? '?' : k.seed) + ' · Spieler ' + n(sp.start, 0) + ' (Start) / ' + n(sp.max, 0) + ' (max) · Dauer ' + zeit(k.dauer) + (k.grund ? ' · Ende: ' + k.grund : ''),
    'Szenen: ' + (szenen || 'keine') + ' · Regielog: ' + (k.regielog || '-') + (k.weltstand ? ' (Weltstand ' + k.weltstand + ')' : ''),
  ];
}
function f1Block(kz) {
  const f1 = kz.f1 || {};
  const z = ['## F1 Dauer und Ausgang'];
  const modi = keys(f1.dauer).filter((m) => m !== 'session');
  const d = liste(f1.dauer, (m, v) => (m === 'session' ? null : m + ' ' + n(v.n, 0) + '× Ø ' + zeit(v.mittel)));
  const a = liste(f1.ausgang, (k, v) => k + ' ' + v);
  z.push('- Szenen je Modus: ' + (modi.length ? d : 'keine') + (a ? ' · Ausgang: ' + a : ''));
  const sp = f1.spieler || {};
  z.push('- Spieler: Start ' + n(sp.start, 0) + ', max ' + n(sp.max, 0) + ', Nachzügler (nach dem ersten Zeitreihenfenster) ' + n(sp.nachzuegler, 0) + ', Abgänge ' + n(sp.abgaenge, 0) + (f1.wellen ? ' · Wellen geschafft ' + n(f1.wellen.geschafft, 0) + ' (Ø ' + zeit(f1.wellen.dauer_mittel) + ')' : '') + (f1.neustarts ? ' · Neustarts ' + f1.neustarts : ''));
  return z;
}
// Schadenszeile je Ort: Raum und Boden haben verschiedene Bedeutung von Schild und wirkt (KENNZAHL_INFO f2.schaden.*): getrennte Posten, nie addieren
function schadenText(ort, r) {
  if (!r) return '-';
  return ort === 'boden'
    ? 'roh ' + n(r.roh, 1) + ' · Schildsegmente ' + n(r.schild, 1) + ' · Körper ' + n(r.wirkt, 1)
    : 'roh ' + n(r.roh, 1) + ' · Schildverlust ' + n(r.schild, 1) + ' · darüber hinaus ' + n(r.wirkt, 1);
}
function f2Block(kz) {
  const f2 = kz.f2 || {};
  const z = ['## F2 Gefecht'];
  const gd = liste(f2.gefecht, (k, v) => k + ' ' + zeit(v));
  if (gd) z.push('- Gefechtsdauer: ' + gd);
  for (const ort of keys(f2.schaden)) {
    const s = f2.schaden[ort];
    z.push('- Schaden ' + ort + ' (Posten getrennt, nicht addieren): aus ' + schadenText(ort, s.aus) + ' / ein ' + schadenText(ort, s.ein));
  }
  let hinweis = true;   // die Erklaerung der Wirkungsquote steht nur einmal
  for (const [name, sg] of [['Quote', ''], ['Quote Gegner', '_gegner']]) {
    const q = f2['quote' + sg];
    for (const ort of keys(q)) {
      const text = liste(q[ort], (w, v) => {
        const wq = get(f2, 'quote_wirkt' + sg + '.' + ort + '.' + w);
        const anders = num(wq) && n(wq, 0) !== n(v, 0);   // Wirkungsquote nur, wenn sie sichtbar abweicht
        return w + ' ' + n(v, 0) + ' %' + (anders ? ' (wirkt ' + n(wq, 0) + ' %)' : '') + ' (' + n(get(f2, 'schuesse' + sg + '.' + ort + '.' + w), 0) + ' Sch., ' + n(get(f2, 'treffer_je_schuss' + sg + '.' + ort + '.' + w), 2) + ' Tr/Sch)';
      });
      if (text) { z.push('- ' + name + ' ' + ort + (hinweis ? ' (wirkt = nicht abgeprallt/ausgewichen)' : '') + ': ' + text); hinweis = false; }
    }
  }
  for (const ort of keys(f2.kills)) {
    const ks = f2.kills[ort];
    const text = liste(ks, (r, v) => (r === 'gesamt' ? null : r + ' ' + v + (get(f2, 'zeit_bis_kill.' + ort + '.' + r) != null ? ' (Ø ' + zeit(get(f2, 'zeit_bis_kill.' + ort + '.' + r)) + ')' : '')));
    z.push('- Kills ' + ort + ' (' + ks.gesamt + '), Zeit bis Kill je Rolle (Median): ' + text);
  }
  const ue = liste(f2.ueberhitzt, (ort, v) => liste(v, (s, c) => ort + ' ' + s + ' ' + c, ', '));
  if (ue) z.push('- Überhitzung: ' + ue);
  if (z.length === 1) z.push('- keine Daten (kein Gefecht)');
  return z;
}
function f2bBlock(kz) {
  const f = kz.f2b || {};
  const z = ['## F2b Deckung'];
  const dk = liste(f.deckung, (s, v) => (v.cv_s === 0 && !v.geduckt_s && !v.verdeckt_s ? s + ' 0 s in Deckung' : s + ' ' + zeit(v.cv_s) + (v.cv_anteil != null ? ' (' + n(v.cv_anteil, 1) + ' %)' : '') + ', geduckt ' + zeit(v.geduckt_s) + ', verdeckt ' + zeit(v.verdeckt_s)), ' · ');
  if (dk) z.push('- In Deckung (cv > 0), geduckt, verdeckt je Slot: ' + dk);
  if (f.verlassen) z.push('- Deckung verlassen: ' + f.verlassen.n + '× (davon bewegt ' + n(f.verlassen.bewegt_n, 0) + '), davon ' + f.verlassen.mit_treffer + ' mit Treffer, bis Treffer (Median) ' + zeit(f.verlassen.bis_treffer_median) + ' · Peek-and-Shoot: ' + f.peek.mit_schuss + ' von ' + f.peek.episoden + ' kurzen Episoden (< 3 s) mit Schuss');
  const t = [];
  if (f.treffer_auf_spieler) t.push('Treffer auf Spieler in Deckung ' + n(f.treffer_auf_spieler.in_deckung_anteil, 1) + ' % (n ' + f.treffer_auf_spieler.n + ')');
  if (f.treffer_von_spieler) t.push('eigene Treffer aus Deckung ' + n(f.treffer_von_spieler.aus_deckung_anteil, 1) + ' % (n ' + f.treffer_von_spieler.n + ')');
  if (f.schuesse_spieler) t.push('Spielerschüsse aus Deckung ' + n(f.schuesse_spieler.aus_deckung_anteil, 1) + ' %');
  if (f.schuesse_gegner) t.push('Gegnerschüsse aus Deckung ' + n(f.schuesse_gegner.aus_deckung_anteil, 1) + ' %');
  if (t.length) z.push('- ' + t.join(' · '));
  if (f.gegner_abstand) z.push('- Gegnerabstand: Ø nächster Nachbar ' + n(f.gegner_abstand.nn_mittel, 1) + ' Kacheln, kleinster ' + n(f.gegner_abstand.min, 1) + ' · Gegner geduckt ' + n(f.gegner_geduckt_anteil, 1) + ' %');
  if (z.length === 1) z.push('- keine Daten (kein Gefecht am Boden)');
  return z;
}
function f3Block(kz) {
  const f = kz.f3 || {};
  const z = ['## F3 Verluste'];
  const v = [];
  const add = (txt, c) => { if (c > 0) v.push(txt + ' ' + c); };
  add('gefallen', get(f, 'gefallen.n')); add('Bodenschild leer', get(f, 'bodenschild_leer.n')); add('Notrückholung', get(f, 'notrueckholung.n'));
  add('Notfallprotokoll', get(f, 'notfall.n')); add('Zonenausfall', get(f, 'zone_aus.n')); add('Schiff zerstört', get(f, 'schiff_zerstoert.n')); add('Neustart', f.neustarts);
  z.push('- ' + (v.length ? v.join(' · ') : 'keine Verluste') + (f.integritaet ? ' · Systemintegrität min ' + n(f.integritaet.min, 0) + ' % (Ersatz für die Hülle: die Lerche hat keinen Hüllenwert)' : ''));
  const l = ((kz.listen && kz.listen.verluste) || []);
  if (l.length) {
    const kurz = l.filter((x) => x.art !== 'bodenschild_leer').slice(0, 6).map((x) => x.art + (x.slot ? ' ' + x.slot : '') + (x.system ? ' ' + x.system : '') + ' ' + zeit(x.t)).join(', ');
    if (kurz) z.push('- Zeitpunkte: ' + kurz + (l.length > 6 ? ', ...' : ''));
  }
  return z;
}
function f4Block(kz) {
  const f = kz.f4 || {};
  const bot = kz.kopf && kz.kopf.quelle === 'bot';
  const z = ['## F4 Menschen: Rollen, Leerlauf, Reparatur' + (bot ? ' (Bot-Lauf: Leerlauf nicht aussagekräftig, Bots erzeugen keine Eingaben)' : '')];
  const ro = (kz.listen && kz.listen.rollen) || {};
  for (const s of keys(f.dabei)) {
    const r = f.rolle && f.rolle[s] ? liste(f.rolle[s], (k, v) => k + ' ' + zeit(v), ', ') : '-';
    const l = (f.leerlauf || {})[s];
    const info = ro[s] || {};
    const x = (info.nachzuegler ? ' · Nachzügler ab ' + zeit(info.erstes_fenster) : '') + (info.abgang != null ? ' · Abgang bei ' + zeit(info.abgang) : '');
    z.push('- ' + s + ': dabei ' + zeit(f.dabei[s]) + ' · ' + r + ' · Leerlauf ' + (l ? zeit(l.dauer) + ' (' + l.episoden + '×, ' + n(l.anteil, 0) + ' %)' : '-') + ' · Wechsel ' + n(get(f, 'wechsel.' + s), 0) + x);
  }
  if (z.length === 1 && !f.reparatur) z.push('- keine Daten');
  if (f.reparatur) z.push('- Reparaturspiele: ' + f.reparatur.n + ', Erfolg ' + n(f.reparatur.erfolg_anteil, 0) + ' %, Ø ' + zeit(f.reparatur.dauer_mittel) + ', Notflicken ' + n(f.reparatur.notflicken, 0));
  return z;
}
function f5Block(kz) {
  const f = kz.f5 || {};
  const z = ['## F5 Wirtschaft'];
  const m = get(f, 'konto.marks');
  const sets = get(f, 'stand.marks');
  const buch = get(f, 'buchung.marks');
  if (m || sets) {
    const st = keys(sets);
    const standText = st.length === 1 ? 'Stand gesetzt (' + st[0] + ') auf ' + n(sets[st[0]], 0) : st.length ? 'Stand gesetzt (' + st.map((g) => g + ' auf ' + n(sets[g], 0)).join(', ') + ')' : null;
    const buchText = 'Buchungen: ' + (buch && keys(buch).length ? liste(buch, (g, v) => g + ' ' + vz(v), ', ') : 'keine');
    const bil = m && buch && keys(buch).length ? 'Anfang ' + n(m.anfang, 0) + ' → Ende ' + n(m.ende, 0) + ' (netto ' + vz(m.netto) + (m.gesetzt ? ', gesetzt ' + vz(m.gesetzt) : '') + ')' : null;
    z.push('- Marken: ' + [standText, buchText, bil].filter(Boolean).join(' · '));
  }
  const gut = liste(f.buchung, (k, v) => (k === 'marks' ? null : k + ' ' + liste(v, (g, c) => g + ' ' + vz(c), '/')), ' · ');
  if (gut) z.push('- Verbrauchsgüter (Stück, Summe je Grund): ' + gut);
  const ru = liste(f.ruf, (k, v) => k + ' ' + vz(v), ', ');
  if (ru) z.push('- Ruf: ' + ru);
  if (f.energie) z.push('- Energieverteilung (Mittel): Antrieb ' + n(f.energie.engines_anteil, 0) + ' %, Schild ' + n(f.energie.shields_anteil, 0) + ' %, Waffen ' + n(f.energie.weapons_anteil, 0) + ' %' + (f.energie.technik_n != null || f.energie.automatik_n != null ? ' · Änderungen: Konsole ' + n(f.energie.technik_n || 0, 0) + ', Automatik ' + n(f.energie.automatik_n || 0, 0) : ''));
  if (z.length === 1) z.push('- keine Wirtschaftsereignisse');
  return z;
}
function f6Block(kz) {
  const f = kz.f6 || {};
  const z = ['## F6 Technik'];
  if (f.tick) z.push('- Tickzeit: Median ' + n(f.tick.med, 3) + ' ms, längster ' + n(f.tick.max, 2) + ' ms · Ticks > 5/16/33 ms: ' + n(f.tick.ueber5, 0) + '/' + n(f.tick.ueber16, 0) + '/' + n(f.tick.ueber33, 0) + (f.snap ? ' · Snapshot Median ' + n(f.snap.med, 2) + ' ms, max ' + n(f.snap.max, 2) + ' ms' : ' · kein Snapshot (Bot-Lauf)') + ' · Kappung ' + n(get(f, 'kappung.n'), 0) + '× (nachgeholt ' + n(get(f, 'kappung.nachholt'), 0) + ')');
  if (f.spielleiter) z.push('- Spielleiter-Wartezeit: ' + f.spielleiter.n + '×, Median ' + zeit(f.spielleiter.dauer_median) + ', max ' + zeit(f.spielleiter.dauer_max) + ', Timeouts ' + n(f.spielleiter.timeout, 0));
  z.push('- Protokoll: ' + n(get(f, 'protokoll.zeilen'), 0) + ' Zeilen (' + n(get(f, 'protokoll.zeilen_je_min'), 0) + '/min, ' + n(get(f, 'protokoll.mb_je_h'), 1) + ' MB/h) · Schreibfehler ' + n(get(f, 'fehler.schreiben'), 0) + ', verworfen ' + n(get(f, 'fehler.verworfen'), 0));
  return z;
}
function zieleBlock(b) {
  if (!b.ziele.length) return null;
  const z = ['## Ziele'];
  for (const x of b.ziele) z.push('- [' + (x.status === 'gruen' ? 'grün' : x.status) + '] ' + x.k + ' = ' + (num(x.w) ? wert(x.w, x.info && x.info.einheit) : 'kein Wert') + ' (' + zielText(x.z) + ')');
  return z;
}

// Deckel: von hinten (unwichtigste Bloecke zuerst) je eine Zeile entfernen, bis es passt; Ueberschrift und erste Zeile bleiben. Bloecke mit fest: true (Kopf, Auffaelligkeiten, Bild) bleiben unangetastet.
function begrenzen(bloecke, max) {
  const gesamt = () => bloecke.reduce((s, b) => s + b.zeilen.length, 0);
  let gekuerzt = false;
  while (gesamt() > max) {
    const b = bloecke.filter((x) => !x.fest && x.zeilen.length > 2).sort((x, y) => y.prio - x.prio)[0];
    if (!b) break;
    b.zeilen.pop(); gekuerzt = true;
  }
  const out = [];
  for (const b of bloecke) out.push(...b.zeilen);
  if (out.length > max) { out.length = max; gekuerzt = true; }   // notfalls hart
  if (gekuerzt && out.length) out[out.length - 1] += ' (Bericht auf ' + max + ' Zeilen gekürzt)';
  return out;
}

function bericht(kz, opt) {
  opt = opt || {};
  const ziele = opt.ziele && typeof opt.ziele === 'object' ? (opt.ziele.ziele || (opt.ziele.version ? {} : opt.ziele)) : {};
  const o = { basis: opt.basis || null, ziele };
  const b = bewerten(kz, o);
  o.bewertung = b;
  const bl = [];
  bl.push({ prio: 0, fest: true, zeilen: kopfBlock(kz) });
  bl.push({ prio: 1, fest: true, zeilen: ['## Auffälligkeiten'].concat(auffaelligkeiten(kz, o).map((l) => (l.startsWith('  ') ? '  - ' + l.trim() : '- ' + l))) });
  const zb = zieleBlock(b);
  if (zb) bl.push({ prio: 2, zeilen: zb });
  bl.push({ prio: 3, zeilen: f1Block(kz) });
  bl.push({ prio: 4, zeilen: f2Block(kz) });
  bl.push({ prio: 5, zeilen: f2bBlock(kz) });
  bl.push({ prio: 6, zeilen: f3Block(kz) });
  bl.push({ prio: 7, zeilen: f4Block(kz) });
  bl.push({ prio: 9, zeilen: f5Block(kz) });
  bl.push({ prio: 8, zeilen: f6Block(kz) });
  bl.push({ prio: 0, fest: true, zeilen: ['## Gefechtsprofil', opt.svg ? '![Gefechtsprofil](' + opt.svg + ')' : '(kein Bild)'] });
  for (const x of bl) x.zeilen = [].concat(...x.zeilen.map((l) => umbrechen(l, ZEILE_MAX_ZEICHEN)));   // K12
  return begrenzen(bl, ZEILEN_MAX).join('\n') + '\n';
}

module.exports = { bericht, auffaelligkeiten, umbrechen, ZEILEN_MAX, ZEILE_MAX_ZEICHEN, AUFFAELLIG_MAX };
