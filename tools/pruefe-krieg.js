'use strict';
// FRE-04 A/B: Prüfwerkzeug „Krieg Rom gegen Germanen sichtbar?“ (kein Spielcode, nur Beobachter und Treiber).
// Treibt die echte Freie Fahrt Sund mit echten Sprüngen (Bot wie tools/sim-freie-fahrt.js, Zufallsgang), aber mit der Szenario-Umgebung des echten
// Servers (Game-Option szenarioSchalter: Rückfall-Spielleiter, Brett, Reise-Ereignisse; kein Live-Claude, kein Mock) und MITSCHNITT=1.
// Beobachtet je Tick: Besitz je Hex (Wahrheit der Sim) und Wissen von Rom (world.lage), Flotten, Funk (Game.emit radio), Chronik, Roh-Ereignisse
// der Sim, Hafenfälle, Postenverluste, Hauptwelt. Daraus die Bilanz „Wahrheit gegen Funk und Karte“ mit Liste der Lücken.
// Paket B: echter Server + echter Browser-Client (Playwright), Captain-Übersichtskarte zu festen Ticks, Funk-Reiter, Nachweis zur „ORT“-Zeile.
//
//   node tools/pruefe-krieg.js --seed 7 --ticks 300 --out <Ordner> [--radius 2] [--ohne-bilder] [--bildticks 0,60,110,225] [--port 0]
//
//   --seed N          Seed des Spiels und des Zufallsgangs (Standard 7)
//   --ticks N         Lauflänge in Sim-Ticks = Sprünge (Standard 300)
//   --out <Ordner>    Wurzel der Ausgabe; der Lauf liegt in <out>/s<seed> bzw. <out>/s<seed>-r<radius>. NIE ins Repo oder ins Vault.
//   --radius N        Bot springt nur höchstens N Sprünge um den Startort (Ostia Nova) herum (Standard: überall hin, Zufallsgang über alle Kanten)
//   --ohne-bilder     kein Browser (headless Game wie sim-freie-fahrt, schneller; Test und Läufe ohne Playwright)
//   --bildticks a,b   Ticks der Übersichtskarten (Standard 0,60,110,225)
// Ausgabe im Laufordner: verlauf.json (alles), verlauf.txt (lesbar), bilanz.txt (+ bilanz.json), mitschnitt/ (Recorder des Spiels), telemetrie/, regie/,
// bilder/ (karte-tNNN.png, funk-reiter.png, ort-*.png). TELEMETRIE_DIR, REGIE_DIR, MITSCHNITT_DIR zeigen in den Laufordner, nie ins Repo.
// Exit: 0 gelaufen (Lücken sind ein Befund, kein Fehler), 1 Server-/Sim-Fehler oder Lauf zu kurz, 2 Playwright fehlt.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ==================================================================================================================== reine Logik (getestet)

// Besitzzeichen je Hex: Besitzer-Buchstabe (r g k p, - = niemand) + 'P' für Posten
const art = (von, nach) => {
  const a = String(von || '').replace('P', ''), b = String(nach || '').replace('P', '');
  if (a === '-' || a === '.' || a === '') return 'gruendung';
  if (b === '-' || b === '.' || b === '') return 'verlust';
  if (a !== b) return 'eroberung';
  return 'postenaenderung';
};

// Besitzwechsel der Wahrheit zwischen zwei Ständen { code: 'rP' }
function besitzwechsel(tick, min, vorher, nachher) {
  const out = [];
  for (const c of Object.keys(nachher)) if (vorher[c] !== undefined && vorher[c] !== nachher[c]) out.push({ tick, min, hex: c, von: vorher[c], nach: nachher[c], art: art(vorher[c], nachher[c]) });
  return out;
}

const MELDET_WECHSEL = /gefallen|verloren|gegründet|gegruendet|gehisst|erobert|besetzt|übernommen/i;   // Funktext, der einen Besitzwechsel meldet
const MELDET_PLAN = { hafenfall: /gefallen/i, postenverlust: /verloren|gefallen/i, besitzwechsel: MELDET_WECHSEL };

// Fraktion als Buchstabe (r g k p); null = niemand/unbekannt. Nimmt Fraktionsnamen (rom, ger, ...) und Besitzzeichen (rP, g, -)
const FK_BUCHSTABE = { rom: 'r', ger: 'g', kon: 'k', pirat: 'p' };
const buchstabe = (x) => { if (x == null) return null; const s = String(x).replace('P', ''); if (FK_BUCHSTABE[s]) return FK_BUCHSTABE[s]; return /^[rgkp]$/.test(s) ? s : null; };

// Fälle der Bilanz: Hafenfall (hafen_gefallen), Postenverlust (posten_verloren), sonst reiner Besitzwechsel. Ein Besitzwechsel, den ein Hafenfall oder
// Postenverlust im selben Tick am selben Hex schon trägt, ist derselbe Fall (Spezialart gewinnt, nur einmal gezählt; die Art des Wechsels hängt als kind dran).
// Jeder Fall trägt verlierer/gewinner (Fraktionsbuchstabe) und seite aus Sicht von Rom: gewinn, verlust, fremd.
function faelleBauen(v) {
  const N = v.namen || {}, faelle = [], sonder = [];
  for (const e of v.ereignisse || []) {
    if (e.typ === 'hafen_gefallen') sonder.push({ art: 'hafenfall', tick: e.tick, min: e.min, hex: e.ort, name: N[e.ort] || e.ort, von: e.alt, nach: e.neu, verlierer: buchstabe(e.alt), gewinner: buchstabe(e.neu) });
    if (e.typ === 'posten_verloren') sonder.push({ art: 'postenverlust', tick: e.tick, min: e.min, hex: e.ort, name: N[e.ort] || e.ort, von: e.besitzer, nach: e.durch || null, verlierer: buchstabe(e.besitzer), gewinner: buchstabe(e.durch) });
  }
  for (const w of v.besitzwechsel || []) {
    const s = sonder.find((x) => x.tick === w.tick && x.hex === w.hex);
    if (s) { s.kind = s.kind || w.art; if (s.gewinner == null) s.gewinner = buchstabe(w.nach); if (s.verlierer == null) s.verlierer = buchstabe(w.von); continue; }
    faelle.push({ art: 'besitzwechsel', kind: w.art, tick: w.tick, min: w.min, hex: w.hex, name: N[w.hex] || w.hex, von: w.von, nach: w.nach, verlierer: buchstabe(w.von), gewinner: buchstabe(w.nach) });
  }
  for (const f of faelle.concat(sonder)) f.seite = f.gewinner === 'r' ? 'gewinn' : f.verlierer === 'r' ? 'verlust' : 'fremd';
  return faelle.concat(sonder).sort((a, b) => a.tick - b.tick || a.hex.localeCompare(b.hex) || a.art.localeCompare(b.art));
}

// Erster Funk, der den Fall im Fenster [tick, tick+fenster] meldet: nennt den Ortsnamen und das passende Verb
function funkZu(fall, funk, fenster) {
  const n = String(fall.name).toLowerCase(), re = MELDET_PLAN[fall.art];
  return (funk || []).find((f) => f.tick >= fall.tick && f.tick <= fall.tick + fenster && String(f.text).toLowerCase().includes(n) && re.test(String(f.text))) || null;
}
// Chronik-Eintrag zum Fall (Chronik schreibt Hafen gefallen / Posten gefallen mit ref = Hex)
function chronikZu(fall, chronik, fenster) {
  return (chronik || []).find((c) => c.t >= fall.tick && c.t <= fall.tick + fenster && c.ref === fall.hex) || null;
}
// Tick, ab dem die Karte von Rom (Wissen) den neuen Besitz des Hexes zeigt; null = bis zum nächsten Wechsel oder Laufende nie
function karteKenntAb(fall, ticks, naechsterWechsel) {
  // Soll: Besitzzeichen der Wahrheit nach dem Fall (Hafenfall und Postenverlust tragen kein Zeichen, nur Besitzwechsel)
  const stand = ticks.find((t) => t.tick === fall.tick);
  const soll = stand && stand.wahr && stand.wahr[fall.hex] != null ? stand.wahr[fall.hex] : fall.nach;
  for (const t of ticks) {
    if (t.tick < fall.tick) continue;
    if (naechsterWechsel != null && t.tick >= naechsterWechsel) break;
    const w = t.wissen && t.wissen[fall.hex];
    if (w && String(w).split('@')[0] === soll) return t.tick;
  }
  return null;
}

const FENSTER = 2;   // Ticks, in denen ein Funk als Meldung des Falls gilt (fremde Ereignisse kommen einen Tick später)
const SAGT_VERLUST = /verloren|gefallen/i;
// Funk sagt „verloren/gefallen“, obwohl Rom der Gewinner war (und die Gegenseite verlor): aus Sicht von Rom falsch herum oder unklar
const funkSinnfehler = (f) => !!(f.funk && f.gewinner === 'r' && f.verlierer && f.verlierer !== 'r' && SAGT_VERLUST.test(String(f.funk.text)));
function bilanzBauen(v, fenster) {
  const fe = fenster == null ? FENSTER : fenster;
  const faelle = faelleBauen(v);
  const wechselTicks = {};
  for (const w of v.besitzwechsel || []) (wechselTicks[w.hex] = wechselTicks[w.hex] || []).push(w.tick);
  for (const f of faelle) {
    const fk = funkZu(f, v.funk, fe), ch = chronikZu(f, v.chronik, fe);
    f.funk = fk ? { tick: fk.tick, von: fk.von, text: fk.text } : null;
    f.chronik = ch ? { t: ch.t, kurz: ch.kurz } : null;
    const nxt = (wechselTicks[f.hex] || []).filter((t) => t > f.tick).sort((a, b) => a - b)[0];
    f.karteAb = karteKenntAb(f, v.ticks || [], nxt == null ? null : nxt);
    f.karteVerzug = f.karteAb == null ? null : f.karteAb - f.tick;
    f.funkSinnfehler = funkSinnfehler(f);
  }
  // jeder Fall steht genau einmal in faelle, also auch genau einmal in den Lücken
  const luecken = faelle.filter((f) => !f.funk).map((f) => ({ art: f.art, kind: f.kind || null, tick: f.tick, hex: f.hex, name: f.name, von: f.von, nach: f.nach, seite: f.seite, karteAb: f.karteAb, chronik: !!f.chronik }));
  const sinnfehler = faelle.filter((f) => f.funkSinnfehler).map((f) => ({ art: f.art, tick: f.tick, hex: f.hex, name: f.name, von: f.von, nach: f.nach, verlierer: f.verlierer, gewinner: f.gewinner, funk: f.funk }));
  const zaehleListe = (l) => ({ n: l.length, mitFunk: l.filter((f) => f.funk).length, ohneFunk: l.filter((f) => !f.funk).length, ohneFunkUndKarteNie: l.filter((f) => !f.funk && f.karteAb == null).length, mitChronik: l.filter((f) => f.chronik).length, funkSinnfehler: l.filter((f) => f.funkSinnfehler).length });
  const zaehle = (art2) => zaehleListe(faelle.filter((f) => f.art === art2));
  const gruendung = faelle.filter((f) => f.art === 'besitzwechsel' && f.kind === 'gruendung');
  const zaehlung = { besitzwechsel: zaehle('besitzwechsel'), hafenfall: zaehle('hafenfall'), postenverlust: zaehle('postenverlust'), gruendungEigene: zaehleListe(gruendung.filter((f) => f.gewinner === 'r')), gruendungFremde: zaehleListe(gruendung.filter((f) => f.gewinner !== 'r')) };
  const nachKind = {};
  for (const f of faelle) if (f.kind) { const k = nachKind[f.kind] = nachKind[f.kind] || { n: 0, mitFunk: 0 }; k.n++; if (f.funk) k.mitFunk++; }
  const mitKarte = faelle.filter((f) => f.karteVerzug != null && f.karteVerzug <= 1).length;
  const gesamt = { faelle: faelle.length, besitzwechselGesamt: (v.besitzwechsel || []).length, luecken: luecken.length, lueckenRom: luecken.filter((l) => l.seite !== 'fremd').length, lueckenFremd: luecken.filter((l) => l.seite === 'fremd').length, funkSinnfehler: sinnfehler.length, karteBisEinTick: mitKarte };
  return { fenster: fe, zaehlung, gesamt, besitzwechselNachArt: nachKind, faelle, luecken, sinnfehler, sicht: sichtBauen(v) };
}

// Sichtreichweite: wie viel vom echten Verlauf sieht Rom?
const KRIEGS_ROH = ['flotte_sammelt', 'flotte_belagert', 'flotte_marsch', 'flotte_aufbruch', 'flotte_verlegt', 'angriff_abgewehrt', 'angriff_abgebrochen', 'hafen_gefallen', 'posten_verloren', 'posten_gegruendet', 'posten_gehisst', 'notruf'];
function sichtBauen(v) {
  const ticks = v.ticks || [];
  const stand = (t) => {
    let gleich = 0, abw = 0, unbekannt = 0, n = 0, richtigBekannt = 0;
    for (const c of Object.keys(t.wahr || {})) {
      const w = t.wissen && t.wissen[c]; if (!w) continue;
      n++;
      const [f, al] = String(w).split('@');
      if (al === '?') unbekannt++;
      if (f === t.wahr[c]) { gleich++; if (al !== '?') richtigBekannt++; } else abw++;
    }
    // gleich zählt auch nie gesehene Hexe (Kartenstand zu Spielbeginn); richtigBekannt nur Hexe, die Rom gesehen hat; anteilRichtigGesehen teilt durch die gesehenen
    const gesehen = n - unbekannt;
    return { tick: t.tick, hexe: n, gleich, abweichung: abw, unbekannt, gesehen, richtigBekannt, anteilRichtig: n ? +(gleich / n).toFixed(3) : null, anteilRichtigGesehen: gesehen ? +(richtigBekannt / gesehen).toFixed(3) : null, anteilGesehen: n ? +(gesehen / n).toFixed(3) : null };
  };
  const stande = ticks.map(stand);
  const mittel = (k) => { const w = stande.map((x) => x[k]).filter((x) => x != null); return w.length ? +(w.reduce((a, x) => a + x, 0) / w.length).toFixed(3) : null; };
  const marken = {}; for (const t of (v.bildticks || [0, 60, 110, 225])) { const s = stande.find((x) => x.tick >= t); if (s) marken['t' + s.tick] = s; }
  if (stande.length) marken.ende = stande[stande.length - 1];
  const roh = {}; for (const e of v.ereignisse || []) roh[e.typ] = (roh[e.typ] || 0) + 1;
  const funkArt = { gefallen: 0, verloren: 0, belagert: 0, sammelt: 0, feindkontakt: 0, stimmung: 0, andere: 0 };
  for (const f of v.funk || []) {
    if (!f.lage) { funkArt.andere++; continue; }
    const t = String(f.text);
    if (/Stimmung|gewonnen als verloren/i.test(t)) funkArt.stimmung++; else if (/gefallen/i.test(t)) funkArt.gefallen++; else if (/verloren/i.test(t)) funkArt.verloren++; else if (/belagert/i.test(t)) funkArt.belagert++; else if (/sammelt/i.test(t)) funkArt.sammelt++; else if (/feindkontakt/i.test(t)) funkArt.feindkontakt++; else funkArt.andere++;
  }
  const kriegRoh = KRIEGS_ROH.reduce((a, k) => a + (roh[k] || 0), 0);
  return { radius: v.radius == null ? null : v.radius, besuchteHexe: v.lauf ? v.lauf.besuchteHexe : null, anteilRichtigMittel: mittel('anteilRichtig'), anteilRichtigGesehenMittel: mittel('anteilRichtigGesehen'), anteilGesehenMittel: mittel('anteilGesehen'), unbekanntMittel: mittel('unbekannt'), stande: marken, rohEreignisse: roh, kriegsRohEreignisse: kriegRoh, funkNachArt: funkArt, lageFunk: (v.funk || []).filter((f) => f.lage).length };
}

// ---- Textausgaben
const dez1 = (x) => (x == null ? '-' : Number(x).toFixed(1).replace('.', ','));
const prozent = (x) => (x == null ? '-' : Math.round(x * 100) + ' %');
const fmtMin = (m) => (m == null ? '-' : Number(m).toFixed(1));
function textVerlauf(v) {
  const zeilen = [];
  const add = (tick, min, art2, text, ord) => zeilen.push({ tick, min, art2, text, ord });
  for (const w of v.besitzwechsel || []) add(w.tick, w.min, 'BESITZ', `${(v.namen || {})[w.hex] || w.hex} (${w.hex}) ${w.von} -> ${w.nach} [${w.art}]`, 1);
  for (const e of v.ereignisse || []) { const { tick, min, typ, ...rest } = e; add(tick, min, 'KRIEG', typ + ' ' + JSON.stringify(rest), 0); }
  for (const f of v.funk || []) add(f.tick, f.min, f.lage ? 'FUNK-LAGE' : 'FUNK', `${f.von}: ${f.text}`, 2);
  for (const c of v.chronik || []) add(c.t, c.min, 'CHRONIK', `${c.art} ${c.ref}: ${c.kurz}`, 3);
  zeilen.sort((a, b) => a.tick - b.tick || a.ord - b.ord);
  const kopf = [`Verlauf Freie Fahrt Sund, Seed ${v.seed}${v.radius != null ? ', Radius ' + v.radius : ', Zufallsgang über alle Kanten'}, ${v.lauf.ticks} Ticks, ${fmtMin(v.lauf.minuten)} min Spielzeit`, 'Tick | Minute | Art | Ereignis / Funk', '-'.repeat(60)];
  return kopf.concat(zeilen.map((z) => `${String(z.tick).padStart(4)} | ${fmtMin(z.min).padStart(5)} | ${z.art2.padEnd(9)} | ${z.text}`)).join('\n') + '\n';
}
function textBilanz(v, b) {
  const L = [];
  L.push(`Bilanz Wahrheit gegen Funk und Karte, Seed ${v.seed}${v.radius != null ? ', Radius ' + v.radius + ' (Bot bleibt nahe Ostia Nova)' : ', Zufallsgang über alle Kanten'}, ${v.lauf.ticks} Ticks, ${fmtMin(v.lauf.minuten)} min`);
  L.push(`Funk gilt als Meldung, wenn er im Fenster Tick bis Tick+${b.fenster} den Ortsnamen im Text und ein Verb des Falls nennt (gefallen / verloren / gegründet / gehisst / erobert). Der Absender zählt nicht.`);
  L.push('Ein Fall zählt einmal: Hafenfall und Postenverlust schlucken den gleichzeitigen Besitzwechsel am selben Hex (Besitzwechsel = die übrigen).');
  L.push('Funk falsch herum: Funk sagt verloren/gefallen, obwohl Rom der Gewinner war (Verlierer die Gegenseite).');
  L.push('');
  L.push('Art              | Fälle | mit Funk | ohne Funk | davon Karte nie | mit Chronik | Funk falsch herum');
  const zeile = (name, z) => `${name.padEnd(16)} | ${String(z.n).padStart(5)} | ${String(z.mitFunk).padStart(8)} | ${String(z.ohneFunk).padStart(9)} | ${String(z.ohneFunkUndKarteNie).padStart(15)} | ${String(z.mitChronik).padStart(11)} | ${String(z.funkSinnfehler).padStart(17)}`;
  for (const k of ['besitzwechsel', 'hafenfall', 'postenverlust']) L.push(zeile(k, b.zaehlung[k]));
  L.push(zeile('  Gründung Rom', b.zaehlung.gruendungEigene) + '   (Teil von besitzwechsel)');
  L.push(zeile('  Gründung fremd', b.zaehlung.gruendungFremde) + '   (Teil von besitzwechsel)');
  L.push('');
  const g = b.gesamt;
  L.push(`Besitzwechsel der Wahrheit gesamt: ${g.besitzwechselGesamt}, Fälle (je einmal): ${g.faelle}; Karte von Rom zeigt den Fall nach 0 bis 1 Tick: ${g.karteBisEinTick} von ${g.faelle}`);
  L.push('Besitzwechsel nach Art: ' + Object.keys(b.besitzwechselNachArt).map((k) => `${k} ${b.besitzwechselNachArt[k].mitFunk}/${b.besitzwechselNachArt[k].n} gefunkt`).join(', '));
  L.push('');
  L.push(`Lücken (Fälle ohne Funkmeldung, je Fall einmal): ${g.luecken} (Rom beteiligt ${g.lueckenRom}, ohne Rom ${g.lueckenFremd}; Gründungen Rom ${b.zaehlung.gruendungEigene.ohneFunk}, fremd ${b.zaehlung.gruendungFremde.ohneFunk})`);
  for (const l of b.luecken) L.push(`  Tick ${String(l.tick).padStart(4)} | ${l.art}${l.kind ? ' (' + l.kind + ')' : ''} | ${l.name} (${l.hex}) ${l.von} -> ${l.nach} | ${l.seite} | Karte ab ${l.karteAb == null ? 'nie' : 'Tick ' + l.karteAb} | Chronik ${l.chronik ? 'ja' : 'nein'}`);
  L.push('');
  L.push(`Funk falsch herum (gefunkt, Sinn aus Sicht von Rom unklar oder verkehrt): ${g.funkSinnfehler}`);
  for (const l of b.sinnfehler) L.push(`  Tick ${String(l.tick).padStart(4)} | ${l.art} | ${l.name} (${l.hex}) Verlierer ${l.verlierer}, Gewinner ${l.gewinner} | Funk Tick ${l.funk.tick}: ${l.funk.von}: ${l.funk.text}`);
  L.push('');
  const s = b.sicht;
  L.push(`Sichtreichweite: besuchte Hexe ${s.besuchteHexe}, Karte stimmt im Mittel zu ${prozent(s.anteilRichtigMittel)} der Hexe; gesehen sind im Mittel ${prozent(s.anteilGesehenMittel)} der Hexe, unter den gesehenen Hexen stimmt die Karte zu ${prozent(s.anteilRichtigGesehenMittel)}; nie gesehen (Altstand ?) im Mittel ${dez1(s.unbekanntMittel)} Hexe`);
  for (const k of Object.keys(s.stande)) { const x = s.stande[k]; L.push(`  ${k.padEnd(6)} Tick ${x.tick}: ${x.gleich} von ${x.hexe} richtig (davon ${x.richtigBekannt} von ${x.gesehen} gesehenen), ${x.abweichung} falsch/veraltet, ${x.unbekannt} nie gesehen`); }
  L.push(`  Kriegs-Roh-Ereignisse (${KRIEGS_ROH.join(', ')}): ${s.kriegsRohEreignisse}`);
  L.push(`  Roh-Ereignisse der Sim: ${JSON.stringify(s.rohEreignisse)}`);
  L.push(`  Funk (Lage) nach Art: ${JSON.stringify(s.funkNachArt)}, Lagefunk gesamt ${s.lageFunk}`);
  return L.join('\n') + '\n';
}

// ==================================================================================================================== Lauf

// Liegt ein Pfad im Repo (oder ist es selbst)? Prüft den aufgelösten Pfad und den echten Pfad (Junction/Symlink) des tiefsten vorhandenen Vorfahren.
function echterPfad(p) {
  const rest = []; let cur = path.resolve(p);
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch (e) { const up = path.dirname(cur); if (up === cur) return path.resolve(p); rest.push(path.basename(cur)); cur = up; }
  }
}
function imRepo(out) {
  const norm = (x) => (process.platform === 'win32' ? x.toLowerCase() : x);
  const wurzeln = [path.resolve(ROOT), echterPfad(ROOT)].map(norm), kandidaten = [path.resolve(out), echterPfad(out)].map(norm);
  return kandidaten.some((c) => wurzeln.some((r) => c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep)));
}

const argVal = (a, k, d) => { const i = a.indexOf(k); return i >= 0 && i + 1 < a.length && !String(a[i + 1]).startsWith('--') ? a[i + 1] : d; };
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } return null; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lauf(o) {
  const SEED = Number(o.seed) | 0, TICKS = Math.max(1, Number(o.ticks) | 0), RADIUS = o.radius == null ? null : Math.max(1, Number(o.radius) | 0);
  const BILDER = o.bilder !== false;
  const BILDTICKS = (o.bildticks || [0, 60, 110, 225]).map(Number).sort((a, b) => a - b);
  const dir = path.resolve(o.out, 's' + SEED + (RADIUS != null ? '-r' + RADIUS : ''));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-pruefe-krieg-'));
  // Umgebung VOR dem Laden der Spielmodule: alle Ausgaben in den Laufordner, nie ins Repo; kein Live-Claude
  const P = process.env;
  P.MISSION_SOURCE = 'fallback'; P.MITSCHNITT = '1';
  P.MITSCHNITT_DIR = path.join(dir, 'mitschnitt'); P.TELEMETRIE_DIR = path.join(dir, 'telemetrie'); P.REGIE_DIR = path.join(dir, 'regie'); P.ERZEUGT_DIR = path.join(tmp, 'erzeugt');
  for (const k of ['LLM_LIVE', 'SPIELLEITER_LLM', 'SPIELLEITER_RUECKFALL', 'LAGE_SPIELLEITER', 'FAEDEN', 'REISE_EREIGNISSE']) delete P[k];
  process.chdir(ROOT);
  const { Game } = require('../server/game.js');
  const Sektoren = require('../shared/sektoren.js');
  const Sprung = require('../server/sim/sprung.js');
  const Kern = require('../server/weltsim/kern.js');
  const Wissen = require('../server/sim/kriegslage-wissen.js');
  const Kriegslage = require('../server/sim/kriegslage.js');
  const KT = require('../public/js/karte-tokens.js');
  const CODES = Wissen.karte().codes;
  const FK = { rom: 'r', ger: 'g', kon: 'k', pirat: 'p' };

  let srv = null, browser = null, page = null, g;
  const fehlerBrowser = [];
  if (BILDER) {
    const pw = playwright();
    if (!pw) { const e = new Error('playwright-core nicht gefunden (PLAYWRIGHT_CORE oder C:/tmp/pw-test/node_modules/playwright-core); --ohne-bilder läuft ohne Browser'); e.code = 'KEIN_PLAYWRIGHT'; throw e; }
    const { startServer } = require('../server/index.js');
    srv = await startServer({ port: Number(o.port) || 0, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(tmp, 'worlds') });
    g = srv.game;
    g.fixedSeed = SEED; g.reset();   // der Server kennt kein Seed-Flag: gleicher Seed wie im Headless-Lauf
    browser = await pw.chromium.launch();
    page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage();
    page.on('pageerror', (e) => fehlerBrowser.push('pageerror: ' + e.message));
    await page.goto(`http://127.0.0.1:${srv.port}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(800);
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain' })); await sleep(600);
    await page.keyboard.press('Digit2'); await sleep(500);
  } else {
    g = new Game({ szenarioSchalter: true, noStore: true, worlds: true, worldSaveSync: true, worldDir: path.join(tmp, 'worlds'), seed: SEED, debug: true, log: () => {} });
    const conn = { inbox: [], send() {}, sendRaw() {} };
    g.addConnection(conn);
    g.handleMessage(conn, { t: 'hello', clientId: 'PK0', name: 'Bot', color: 0 });
    g.handleMessage(conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
    g.handleMessage(conn, { t: 'ready', ready: true });
    for (let k = 0; k < 30; k++) g.step();
  }
  if (!g.weltsim || g.phase !== 'play') throw new Error('Modus Freie Fahrt nicht gestartet (Phase ' + g.phase + ')');
  if (g.mitschnitt) g.mitschnitt.lauf({ werkzeug: 'pruefe-krieg', seed: SEED, modus: 'freie_fahrt', regel: 'Bot-Zufallsgang' + (RADIUS != null ? ', Radius ' + RADIUS : ''), quelle: 'fallback' });
  const szenario = { lageSpielleiter: !!g.lageSpielleiter, lageSchalter: !!g.lageSchalter, FAEDEN: g.env.FAEDEN || null, REISE_EREIGNISSE: g.env.REISE_EREIGNISSE || null, LAGE_SPIELLEITER: g.env.LAGE_SPIELLEITER || null, SPIELLEITER_RUECKFALL: g.env.SPIELLEITER_RUECKFALL || null, SPIELLEITER_LLM: g.env.SPIELLEITER_LLM || null, LLM_LIVE: g.env.LLM_LIVE || null };

  // ---- Beobachter
  const ws0 = g.weltsim, t0 = g.time;
  const minNow = () => +((g.time - t0) / 60).toFixed(2);
  const funk = [], ereignisse = [], chronik = [], ticks = [], wechsel = [];
  const emitOrig = g.emit.bind(g);
  g.emit = function (kind, data) { if (kind === 'radio') funk.push({ tick: data.tick != null ? data.tick : g.weltsim.tickZahl, min: minNow(), von: data.from, text: data.text, lage: !!data.lage }); return emitOrig(kind, data); };
  let kernTick = 0; const kernOrig = Kern.tick;
  Kern.tick = function (...a) { kernTick++; const r = kernOrig.apply(this, a); for (const e of (r && r.ereignisse) || []) ereignisse.push(Object.assign({ tick: kernTick, min: minNow() }, e)); return r; };
  const gesehen = new WeakSet();
  const chronikNachziehen = () => { for (const c of g.weltsim.chronik || []) if (!gesehen.has(c)) { gesehen.add(c); chronik.push(Object.assign({ min: minNow() }, c)); } };
  const wahrheit = () => { const z = g.weltsim.zustand, hx = {}; for (const c of CODES) { const h = z.hexe[c]; if (h) hx[c] = (FK[h.besitzer] || '-') + (h.posten ? 'P' : ''); } return hx; };
  const wissen = () => {
    const l = Kriegslage.lage(g); if (!l) return null;
    const hx = KT.hxLesen(l.hx, CODES), w = {};
    for (const c of CODES) { const r = hx[c]; if (r) w[c] = (r.f + (r.posten ? 'P' : '')) + '@' + (r.alter == null ? '?' : r.alter); }
    return w;
  };
  const hexHier = () => Sektoren.hexVonOrt(g.ship.scene);
  const startHex = hexHier();
  let letzt = wahrheit();
  const festhalten = () => {
    const W = wahrheit(), z = g.weltsim.zustand, tick = g.weltsim.tickZahl;
    if (tick > 0) for (const w of besitzwechsel(tick, minNow(), letzt, W)) wechsel.push(w);
    letzt = W;
    chronikNachziehen();
    ticks.push({ tick, min: minNow(), lerche: hexHier(), wahr: W, wissen: wissen(), flotten: z.flotten.map((f) => [f.id, FK[f.fraktion] || f.fraktion, f.ort, f.befehl, f.ziel, +f.staerke.toFixed(1)].join(':')), angriffe: z.angriffe.filter((a) => !a.t_ende).map((a) => [a.id, a.von, a.ziel, a.phase].join(':')), hauptweltGefallen: g.weltsim.hauptweltGefallen ? true : false });
  };

  // ---- Fahrzeug (Muster tools/sim-freie-fahrt.js)
  const place = (x, y) => { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
  const geeignet = (h) => Sektoren.spielbar(h) && Sektoren.ortVonHex(h) && !Sektoren.istLeerraum(h);
  // Abstand in Sprüngen vom Startort über geeignete Hexe (für --radius)
  const abstand = { [startHex]: 0 };
  { const q = [startHex]; for (let i = 0; i < q.length; i++) for (const h of Sektoren.nachbarn(q[i])) if (geeignet(h) && !(h in abstand)) { abstand[h] = abstand[q[i]] + 1; q.push(h); } }
  function nachbarn() {
    const von = hexHier(), out = [];
    for (const h of Sektoren.nachbarn(von)) {
      if (!geeignet(h)) continue;
      if (RADIUS != null && !(abstand[h] != null && abstand[h] <= RADIUS)) continue;
      g.explore.markBoje(Sektoren.kanteId(von, h));
      if (Sprung.hexGrund(g, von, h)) continue;
      out.push(h);
    }
    return out;
  }
  function springe(hex) {
    const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return e;
    const p = Sprung.sprungpunkt(g, hex); if (!p) return 'kein Sprungpunkt';
    place(p.x - 80, p.y);
    for (let k = 0; k < 900 && !g.ship.jump.ready; k++) { g.space.enemies = []; g.step(); }
    g.space.enemies = [];
    return Sprung.doJump(g);
  }
  let zs = (SEED * 2654435761) >>> 0;
  const zufall = () => { zs = (zs + 0x6D2B79F5) >>> 0; let t = zs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // ---- Bilder (Paket B)
  const bilderDir = path.join(dir, 'bilder');
  const bilder = [];
  const KARTE_SPALTE = { x: 125, y: 15, width: 1150, height: 475 }, SPALTE = { x: 965, y: 15, width: 310, height: 200 };
  const hexPos = (code) => page.evaluate((c) => { const m = StarMap.hexMitte(c); const cv = document.getElementById('game'); const r = cv.getBoundingClientRect(); return m ? { x: r.x + m.x * r.width / 640, y: r.y + m.y * r.height / 360 } : null; }, code);
  const knipsen = async (name, clip) => { const f = path.join(bilderDir, name + '.png'); await page.screenshot({ path: f, clip }); bilder.push(f); return f; };
  let ortNachweis = null;
  async function bild(tick) {
    fs.mkdirSync(bilderDir, { recursive: true });
    await page.keyboard.press('Digit2'); await sleep(1200);
    await knipsen('karte-t' + String(tick).padStart(3, '0'), KARTE_SPALTE);
    // Nachweis zur ORT-Zeile: Lerche steht nicht mehr am Startort -> Ort-Zeile vor und nach einem Klick auf das Lerchen-Hex, danach Auswahl zurück
    if (!ortNachweis && tick >= 60 && hexHier() !== startHex) {
      const lerche = hexHier();
      ortNachweis = { tick, lerche, lerchenOrt: Sektoren.hexName(lerche), startHex, startOrt: Sektoren.hexName(startHex) };
      await knipsen('ort-vorher-t' + String(tick).padStart(3, '0'), SPALTE);
      const q = await hexPos(lerche); if (q) { await page.mouse.click(q.x, q.y); await sleep(1300); await knipsen('ort-nach-klick-auf-lerche-t' + String(tick).padStart(3, '0'), SPALTE); }
      const q2 = await hexPos(startHex); if (q2) { await sleep(500); await page.mouse.click(q2.x, q2.y); await sleep(1000); }
    }
  }

  // ---- Lauf
  const tStart = Date.now();
  festhalten();
  const gemacht = new Set();
  const bildFaellig = async () => { for (const bt of BILDTICKS) if (!gemacht.has(bt) && g.weltsim.tickZahl >= bt) { gemacht.add(bt); if (BILDER) await bild(g.weltsim.tickZahl); } };
  await bildFaellig();
  const besucht = new Set([startHex]);
  const probleme = [];
  let sp = 0, fehlSpruenge = 0;
  while (g.weltsim.tickZahl < TICKS && !g.weltsim.hauptweltGefallen) {
    const kand = nachbarn();
    if (!kand.length) { probleme.push('Sackgasse bei ' + hexHier()); break; }
    const neu = kand.filter((h) => !besucht.has(h));
    const pool = neu.length && zufall() < 0.7 ? neu : kand;
    const ziel = pool[Math.floor(zufall() * pool.length)];
    const r = springe(ziel);
    if (r || hexHier() !== ziel) { fehlSpruenge++; probleme.push(`Sprung ${hexHier()} -> ${ziel} misslang: ${r || 'Szene unverändert'}`); if (fehlSpruenge > 5) break; continue; }
    sp++; besucht.add(ziel);
    festhalten();
    await bildFaellig();
  }
  if (BILDER) {
    fs.mkdirSync(bilderDir, { recursive: true });
    await page.keyboard.press('Digit1'); await sleep(1300);
    await knipsen('funk-reiter', { x: 0, y: 0, width: 1280, height: 720 });
    await page.keyboard.press('Digit2'); await sleep(800);
    await knipsen('karte-ende-t' + String(g.weltsim.tickZahl).padStart(3, '0'), KARTE_SPALTE);
  }

  // ---- Ergebnis
  const z = g.weltsim.zustand;
  const namen = {}; for (const c of CODES) namen[c] = Sektoren.hexName(c) || c;
  const mitschnittOrdner = g.mitschnitt ? g.mitschnitt.ende() : null;
  const v = {
    format: 'pruefe-krieg/1', werkzeug: 'tools/pruefe-krieg.js', seed: SEED, radius: RADIUS, bildticks: BILDTICKS, modus: BILDER ? 'server+browser' : 'headless',
    szenario,
    lauf: { spruenge: sp, ticks: g.weltsim.tickZahl, ticksSoll: TICKS, minuten: minNow(), realSekunden: +((Date.now() - tStart) / 1000).toFixed(1), startHex, besuchteHexe: besucht.size, hauptweltGefallen: g.weltsim.hauptweltGefallen || null, feldzuege: z.angriffe.length, fehler: { server: g.errors, sim: g.weltsim.fehler, browser: fehlerBrowser.length }, probleme, mitschnitt: mitschnittOrdner },
    hexe: CODES, namen, ticks, besitzwechsel: wechsel, ereignisse, funk, chronik, ortNachweis, bilder,
  };
  v.bilanz = bilanzBauen(v);
  const j = (x) => JSON.stringify(x);
  const kopf = Object.keys(v).filter((k) => k !== 'ticks');
  fs.writeFileSync(path.join(dir, 'verlauf.json'), '{\n' + kopf.map((k) => `${j(k)}: ${j(v[k])}`).concat([`"ticks": [\n${ticks.map(j).join(',\n')}\n]`]).join(',\n') + '\n}\n');
  fs.writeFileSync(path.join(dir, 'verlauf.txt'), textVerlauf(v));
  fs.writeFileSync(path.join(dir, 'bilanz.txt'), textBilanz(v, v.bilanz));
  fs.writeFileSync(path.join(dir, 'bilanz.json'), JSON.stringify(v.bilanz, null, 1));

  if (browser) await browser.close();
  if (srv) await srv.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }
  return { dir, v };
}

// ==================================================================================================================== CLI

async function main() {
  const a = process.argv.slice(2);
  const out = argVal(a, '--out', null);
  if (!out) { console.error('--out <Ordner> fehlt (Ausgabe nie ins Repo)'); return 2; }
  if (imRepo(out)) { console.error('--out liegt im Repo: abgelehnt'); return 2; }
  let r;
  try {
    r = await lauf({ seed: argVal(a, '--seed', 7), ticks: argVal(a, '--ticks', 300), out, radius: argVal(a, '--radius', null), bilder: !a.includes('--ohne-bilder'), bildticks: argVal(a, '--bildticks', null) ? argVal(a, '--bildticks').split(',') : null, port: argVal(a, '--port', 0) });
  } catch (e) { console.error(e.message); return e.code === 'KEIN_PLAYWRIGHT' ? 2 : 1; }
  const { v, dir } = r, b = v.bilanz, z = b.zaehlung;
  console.log(`pruefe-krieg: Seed ${v.seed}${v.radius != null ? ' Radius ' + v.radius : ''}, ${v.lauf.ticks} Ticks (${v.lauf.minuten} min), ${v.lauf.spruenge} Sprünge, ${v.lauf.realSekunden} s, ${v.modus}`);
  console.log(`  Besitzwechsel gesamt ${b.gesamt.besitzwechselGesamt}, davon reine ${z.besitzwechsel.n} (${z.besitzwechsel.mitFunk} gefunkt), Hafenfälle ${z.hafenfall.n} (${z.hafenfall.mitFunk}), Postenverluste ${z.postenverlust.n} (${z.postenverlust.mitFunk}), Funk ${v.funk.length}, Chronik ${v.chronik.length}, Fälle ${b.gesamt.faelle}, Lücken ${b.gesamt.luecken} (Rom ${b.gesamt.lueckenRom}, fremd ${b.gesamt.lueckenFremd}), Funk falsch herum ${b.gesamt.funkSinnfehler}, Hauptwelt ${v.lauf.hauptweltGefallen ? 'gefallen' : 'hält'}`);
  console.log(`  Ausgabe: ${dir} (verlauf.json, verlauf.txt, bilanz.txt, bilanz.json${v.bilder.length ? ', ' + v.bilder.length + ' Bilder' : ''})`);
  if (v.lauf.fehler.server || v.lauf.fehler.sim) { console.log(`  FEHLER: Server ${v.lauf.fehler.server}, Sim ${v.lauf.fehler.sim}`); return 1; }
  if (v.lauf.ticks < v.lauf.ticksSoll && !v.lauf.hauptweltGefallen) { console.log(`  FEHLER: Lauf endete bei Tick ${v.lauf.ticks} von ${v.lauf.ticksSoll}: ${v.lauf.probleme.slice(0, 2).join('; ')}`); return 1; }
  return 0;
}

module.exports = { imRepo, dez1, KRIEGS_ROH, art, besitzwechsel, faelleBauen, funkZu, chronikZu, karteKenntAb, bilanzBauen, sichtBauen, textVerlauf, textBilanz, lauf, FENSTER };
if (require.main === module) main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
