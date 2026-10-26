'use strict';
// SUND-03b I: Informationshandel des Konkordats (Action-Layer, nur Freie Fahrt Sund, game.weltsim, nur an Häfen des Konkordats). Das Konkordat verkauft Themen in zwei Stufen:
//   Gerücht (billig, Text, kann FALSCH sein, immer gekennzeichnet, Zuverlässigkeit 'gerucht', keine Wirkung auf die Karte, wird nicht gespeichert: nur Funkzeile an alle und Antwort an den Käufer)
//   Beleg   (teuer, exakt aus der Sim zum Kaufzeitpunkt, Zuverlässigkeit 'beleg', wirkt als Kartensicht: das Wissensmodell von Rom sieht die betroffenen Hexe `beleg_dauer` Ticks lang
//            exakt und ohne Verzögerung, über den Erweiterungspunkt zusatzSicht in kriegslage-wissen.js; Wissen.belege, additives Feld, kein neuer Weltstand-Block)
// Ein Thema ist eine Wendepunkt-Zeile der Sim (wie lage-ausschnitt.js): belagerter Ort, Marsch oder Sammeln einer Flotte, gefallener Hafen (wechselt den Besitzer: `gefallen`, Neuer Herr) oder verlorener Posten
// (wird FREI, niemand hält ihn: `verloren`, ohne neuen Herrn). Die Fakten eines Themas: ort (Hex), fraktion (Angreifer, neuer Besitzer bzw. Zerstörer), klasse (Stärkeklasse 1..3, nur Flotten), zeit (Sprünge seit
// Belagerung bzw. Fall, mindestens 1). Der Beleg zeigt sie wie die Sim sie hat; Flotten und Feldzug-Phasen zählen wie in der Sim (Kern.feldzugFlotten, Wirkungen.belagerungen), nie als Kopie. Ein falsches Gerücht
// vertauscht genau EIN Faktum aus `falsch_felder`, nur gegen PLAUSIBLE Kandidaten (thema.plausibel, aus der Sim abgeleitet; ein falsches Gerücht ist nie schon an sich widerspruchsvoll): ort -> Nachbar-Hex, der zum
// Thema passt, fraktion -> ein möglicher Angreifer (nie der Besitzer des Ziels, nie Konkordat), klasse -> ±1, zeit -> verschoben: nie ein erfundenes Ereignis.
// Zufall: eigener, zählerbasierter Strom (wie reise-ereignis.js strom: Sim-Seed, Zähler, Salz), nie game.rng und nie der Strom der Sim. Zähler des Gerüchts = Wissen.gz (Zahl der gekauften Gerüchte, wird mit
// dem Wissen gespeichert); Zähler des Angebots = der Sim-Tick (ein Besuch = ein Sprung): gleicher Sim-Zustand und gleicher Tick = gleiche Liste. Kein LLM, keine Spielernamen.
// Der Sim-Zustand wird nie verändert (nur gelesen). Käufe sind atomar: erst steht das Ergebnis fest und wirkt (Rollback des Wissens bei Fehler), dann werden die Marken abgebucht.
//
//   themenAus(ctx)                          alle Themen des Zustands { key, art, fakten, sicht: { h, an } } (rein; ctx = { z, d, tickZahl, ereignisse })
//   angebotAus(ctx, hex)                    die 2–3 angebotenen Themen für den Hafen hex [{ id: 't0', key, art, fakten, sicht }] (rein, deterministisch)
//   ergebnisAus(ctx, thema, stufe, n)       { stufe, fakten (angezeigt), wahr, feld, text } (rein; n = Zähler des Gerüchts)
//   rahmenFuer(thema, stufe)                BENANNTE STELLE für den Rahmentext: Pool von Paket T (setzeRahmenQuelle), sonst der Datentext
//   kaufen(game, p, themaId, stufe, gezeigt?)  Befehl info.kaufen -> { ok: true, stufe, text, preis, ... } | { ok: false, code, text }. gezeigt = { art, k }: Art und Kennung des Themas, wie die Anzeige sie hatte;
//                                           stimmt das Thema unter dieser Id inzwischen nicht mehr (Angebot hat sich geändert), wird nichts gekauft (Code unbekannt)
//   kennung(key)                            kurze Kennung eines Themas für die Anzeige (nur Buchstaben, verrät nichts vom Thema)
//   snapshot(game) / schluessel(game)       Anzeigeblock world.info (nur an einem Konkordat-Hafen, solange jemand am Terminal sitzt) und sein Änderungsschlüssel
const Daten = require('../weltsim/daten.js');
const Kern = require('../weltsim/kern.js');
const Wirkungen = require('../weltsim/wirkungen.js');
const Zufall = require('../weltsim/zufall.js');
const Sektoren = require('../../shared/sektoren.js');
const KT = require('../../public/js/karte-tokens.js');
const Wissen = require('./kriegslage-wissen.js');

// Zwei Dateien: die Regeln des Handels (nur Server) und die Anzeige (Preise, Texte, Überschriften: die einzige Datei, die der Client bekommt, server/index.js)
const W = Object.fromEntries(Object.entries(Object.assign({}, require('../../content/welt/handel-info-werte.json').werte, require('../../content/welt/handel-info-anzeige.json').werte)).map(([k, v]) => [k, v.wert]));
const STUFEN = ['gerucht', 'beleg'];
const ARTEN = Object.keys(W.themen);
const klon = (v) => JSON.parse(JSON.stringify(v));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------------------------------------------------------- Zufallsstrom (wie reise-ereignis.js, ohne gemeinsamen Zustand)
const seedVon = (z) => ((Number(z.seed) | 0) ^ 0x494E464F) >>> 0;   // „INFO“
function mix(a, b) {
  let h = (a ^ Math.imul((b | 0) + 0x9E3779B9, 0x85EBCA6B)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297A2D39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
const salzVon = (s) => { let h = 0x811C9DC5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h; };
function strom(seed, n, salz) {
  const z = { zufall: Zufall.startzustand(mix(mix(seed, n), salzVon(salz))) };
  return () => Zufall.zahl(z);
}
function mischen(liste, s) {
  for (let i = liste.length - 1; i >= 1; i--) { const j = Math.floor(s() * (i + 1)); const t = liste[i]; liste[i] = liste[j]; liste[j] = t; }
  return liste;
}
const waehle = (liste, s) => liste[Math.floor(s() * liste.length)];
function kennung(key) { let h = salzVon('kennung:' + String(key)), t = ''; for (let i = 0; i < 5; i++) { t += String.fromCharCode(97 + (h % 26)); h = Math.floor(h / 26); } return t; }

// ---------------------------------------------------------------------------------------------------------------- Themen (Wahrheit der Sim, nur gelesen)
const summe = (liste) => liste.reduce((s, fl) => s + fl.staerke, 0);
const nachbarn = (d, ort) => (d.nbr[ort] || []).filter((c) => c !== ort && d.hex[c]);
function themenAus(ctx) {
  const { z, d } = ctx, out = [];
  for (const rec of z.angriffe) {
    if (rec.t_ende !== null || rec.phase === 'abgebrochen' || typeof rec.von !== 'string' || !d.hex[rec.ziel]) continue;
    const fl = Kern.feldzugFlotten(z, rec);   // die Flotten des Feldzugs, wie die Sim sie rechnet (Rückzieher zählen nicht)
    if (!fl.length) continue;
    const art = Wirkungen.belagerungen(z, rec.ziel, rec.id).length ? 'belagert' : rec.phase === 'sammeln' ? 'sammeln' : 'marsch';
    const fakten = { ort: rec.ziel, fraktion: rec.von, klasse: Kern.staerkeKlasse(summe(fl), z.werte) };
    if (art === 'belagert') fakten.zeit = Math.max(1, z.tick - rec.t_an + 1);
    const besitzer = z.hexe[rec.ziel] && z.hexe[rec.ziel].besitzer;
    const gegner = (a, b) => typeof b !== 'string' || Kern.feindlich(a, b);   // ohne Besitzer (freies Ziel) ist jeder Angreifer denkbar
    const plausibel = {
      fraktion: (W.tausch_kandidaten[art] || []).filter((x) => x !== rec.von && x !== besitzer && gegner(x, besitzer)),   // nie der Besitzer des Ziels (greift sich nicht selbst an), nur Feinde des Besitzers
      ort: nachbarn(d, rec.ziel).filter((c) => { const bz = z.hexe[c] && z.hexe[c].besitzer; return typeof bz === 'string' && Kern.feindlich(rec.von, bz); }),   // ein Ziel, das der Angreifer überhaupt angreifen könnte
    };
    out.push({ key: art + ':' + rec.id, art, fakten, plausibel, sicht: { h: [rec.ziel], an: rec.id } });
  }
  for (const ev of ctx.ereignisse || []) {
    if (ev.typ !== 'hafen_gefallen' && ev.typ !== 'posten_verloren') continue;
    const hafen = ev.typ === 'hafen_gefallen', art = hafen ? 'gefallen' : 'verloren';
    const fraktion = hafen ? ev.neu : ev.durch;
    const zeit = ctx.tickZahl - ev.n + 1;
    if (typeof fraktion !== 'string' || !d.hex[ev.ort] || !(zeit >= 1 && zeit <= W.gefallen_fenster)) continue;
    const key = 'gefallen:' + ev.typ + ':' + ev.ort + ':' + ev.n;
    if (out.some((t) => t.key === key)) continue;
    const plausibel = {
      fraktion: (W.tausch_kandidaten[art] || []).filter((x) => x !== fraktion && x !== ev.besitzer),   // Hafen: die Karte zeigt den Besitzer (keine Auswahl); Posten: nie der Verlierer selbst
      ort: nachbarn(d, ev.ort).filter((c) => (d.hex[c].hafen !== '') === hafen),   // ein Hafen-Gerücht nennt einen Hafen, ein Posten-Gerücht einen Ort ohne Hafen
    };
    out.push({ key, art, fakten: { ort: ev.ort, fraktion, zeit }, plausibel, sicht: { h: [ev.ort], an: null } });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Angebot für den Hafen hex: 2–3 Themen, gewählt mit dem eigenen Strom (Sim-Seed, Tick, Hafen). Kein Thema = leere Liste.
function angebotAus(ctx, hex) {
  const alle = themenAus(ctx);
  if (!alle.length) return [];
  const s = strom(seedVon(ctx.z), ctx.tickZahl, 'angebot:' + hex);
  const anz = Math.min(alle.length, W.angebot.min + Math.floor(s() * (W.angebot.max - W.angebot.min + 1)));
  const wahl = mischen(alle.slice(), s).slice(0, anz).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return wahl.map((t, i) => Object.assign({ id: 't' + i }, t));
}

// ---------------------------------------------------------------------------------------------------------------- Falsch: genau ein Faktum vertauschen
// Kandidaten kommen aus der Sim (thema.plausibel); ein Thema ohne (von Hand gebaut) fällt auf Nachbar-Hexe und die Kandidaten der Daten zurück.
function alternative(feld, f, d, s, pl, art) {
  switch (feld) {
    case 'ort': { const nb = pl && pl.ort ? pl.ort : nachbarn(d, f.ort); return nb.length ? waehle(nb, s) : undefined; }
    case 'fraktion': { const c = (pl && pl.fraktion ? pl.fraktion : (W.tausch_kandidaten[art] || []).filter((x) => x !== f.fraktion)).filter((x) => x !== f.fraktion); return c.length ? waehle(c, s) : undefined; }
    case 'klasse': { const c = [f.klasse - 1, f.klasse + 1].filter((k) => k >= 1 && k <= 3); return c.length ? waehle(c, s) : undefined; }
    case 'zeit': { const A = W.zeit_abweichung, dz = A.min + Math.floor(s() * (A.max - A.min + 1)); const v = f.zeit + (s() < 0.5 ? -dz : dz); return v < 1 ? f.zeit + dz : v; }
    default: return undefined;
  }
}
function verfaelsche(f, art, d, s, pl) {
  const reihe = mischen((W.falsch_felder[art] || []).filter((k) => f[k] !== undefined), s);
  for (const feld of reihe) {
    const neu = alternative(feld, f, d, s, pl, art);
    if (neu !== undefined && neu !== f[feld]) return { fakten: Object.assign({}, f, { [feld]: neu }), feld };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------- Text: Rahmen aus Daten (oder Pool von Paket T), Fakten vom Code
let rahmenQuelle = null;
// Paket T: setzeRahmenQuelle(fn) mit fn({ art, key }, stufe) -> Rahmentext | null (vorab erzeugte Varianten); null löscht die Quelle
function setzeRahmenQuelle(fn) { rahmenQuelle = typeof fn === 'function' ? fn : null; }
const platzhalterVon = (t) => [...new Set([...String(t).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
// Ein Rahmen gilt nur mit GENAU den Platzhaltern des Themas: fehlt einer (unvollständig) oder steht ein unbekannter darin, wird er abgelehnt
function rahmenGueltig(text, art) {
  if (typeof text !== 'string' || !text.trim() || text.length > 240 || !has(W.themen, art)) return false;
  const soll = W.themen[art].platzhalter.slice().sort(), ist = platzhalterVon(text);
  return soll.length === ist.length && soll.every((x, i) => x === ist[i]);
}
function rahmenFuer(thema, stufe) {
  const T = W.themen[thema.art];
  if (!T || !STUFEN.includes(stufe)) return '';
  if (rahmenQuelle) {
    try { const r = rahmenQuelle({ art: thema.art, key: thema.key }, stufe); if (rahmenGueltig(r, thema.art)) return r; } catch (e) { /* Rückfall: Datentext */ }
  }
  return T[stufe];
}
function zeitText(n) { return (n === 1 ? W.zeit.eins : W.zeit.mehr).replace('{n}', String(n)); }
function einsetzen(rahmen, f, d) {
  const w = { ort: f.ort && d.hex[f.ort] ? d.hex[f.ort].name : '', fraktion: W.fraktionen[f.fraktion] || f.fraktion || '', klasse: f.klasse ? KT.staerkeName(f.klasse) : '', zeit: f.zeit ? zeitText(f.zeit) : '' };
  return String(rahmen).replace(/\{(\w+)\}/g, (m, k) => (has(w, k) ? w[k] : m));
}

// Ergebnis eines Kaufs (rein): Beleg = die Fakten der Sim, Gerücht = mit Wahrscheinlichkeit `falschquote` genau ein vertauschtes Faktum. Die Kennzeichnung setzt immer der Code, nie der Rahmen.
function ergebnisAus(ctx, thema, stufe, n) {
  let fakten = klon(thema.fakten), wahr = true, feld = null;
  if (stufe === 'gerucht') {
    const s = strom(seedVon(ctx.z), n | 0, 'gerucht:' + thema.key);
    if (s() < W.falschquote) { const v = verfaelsche(thema.fakten, thema.art, ctx.d, s, thema.plausibel); if (v) { fakten = v.fakten; wahr = false; feld = v.feld; } }
  }
  const text = W.kennzeichnung[stufe] + ': ' + einsetzen(rahmenFuer(thema, stufe), fakten, ctx.d);
  return { stufe, zuverlaessigkeit: W.zuverlaessigkeit[stufe], fakten, wahr, feld, text };
}

// ---------------------------------------------------------------------------------------------------------------- Spiel
const fehl = (code, extra) => Object.assign({ ok: false, code, text: W.texte[code] || code }, extra || {});
const zustandVon = (game) => { const ws = game && game.weltsim; return ws && ws.zustand && ws.wissen ? ws : null; };
function ctxVon(game) {
  const ws = game.weltsim, z = ws.zustand;
  return { z, d: Daten.datenVon(z), tickZahl: ws.tickZahl, ereignisse: ws.ereignisse || [] };
}
// Hex des Konkordat-Hafens, an dem die Lerche liegt, sonst null (mit Grund-Code)
function konkordatHex(game) {
  const ws = zustandVon(game);
  if (!ws) return { code: 'kein_weltsim' };
  if (!game.ship || !game.ship.docked || !game.ship.dockedAt) return { code: 'nicht_angedockt' };
  const hex = Sektoren.hexVonOrt(game.ship.dockedAt), d = Daten.datenVon(ws.zustand), h = hex && ws.zustand.hexe[hex];
  if (!h || !d.hex[hex] || d.hex[hex].hafen === '' || !W.haefen_besitzer.includes(h.besitzer)) return { code: 'kein_konkordat' };
  return { hex };
}
const gekauftVon = (ws) => { if (!ws.infoGekauft || ws.infoGekauft.t !== ws.tickZahl) ws.infoGekauft = { t: ws.tickZahl, keys: {} }; return ws.infoGekauft.keys; };
const letzteVon = (ws) => (ws.infoLetzte || (ws.infoLetzte = []));

function angebotFuer(game) {
  const k = konkordatHex(game);
  if (!k.hex) return { fehler: k.code, themen: [] };
  return { hex: k.hex, themen: angebotAus(ctxVon(game), k.hex) };
}

function kaufen(game, p, themaId, stufe, gezeigt) {
  const ws = zustandVon(game);
  if (!ws) return fehl('kein_weltsim');
  const k = konkordatHex(game);
  if (!k.hex) return fehl(k.code);
  if (!STUFEN.includes(stufe)) return fehl('stufe_unbekannt');
  const ctx = ctxVon(game), angebot = angebotAus(ctx, k.hex);
  if (!angebot.length) return fehl('kein_angebot');
  const thema = angebot.find((t) => t.id === themaId);
  if (!thema) return fehl('unbekannt');
  if (gezeigt !== undefined && (!gezeigt || gezeigt.art !== thema.art || gezeigt.k !== kennung(thema.key))) return fehl('unbekannt');   // das Angebot hat sich seit der Anzeige geändert: nie ein anderes Thema kaufen als das gezeigte
  const gekauft = gekauftVon(ws), gkey = k.hex + ':' + thema.key + ':' + stufe;
  if (gekauft[gkey]) return fehl('gekauft');
  const preis = W.preise[stufe];
  if (!(game.inventory.marks >= preis)) return fehl('zu_wenig_marken');
  // 1) Ergebnis steht fest (rein), 2) es wirkt (Rollback des Wissens bei Fehler), 3) erst dann die Marken
  const vorher = ws.wissen, gz = Number.isFinite(vorher.gz) ? vorher.gz : 0;
  let erg;
  try {
    erg = ergebnisAus(ctx, thema, stufe, gz);
    if (stufe === 'beleg') {
      const belege = (Array.isArray(vorher.belege) ? vorher.belege : []).concat([{ h: thema.sicht.h.slice(), an: thema.sicht.an, bis: ws.tickZahl + W.beleg_dauer }]).slice(-W.beleg_max);
      ws.wissen = Object.assign({}, vorher, { belege });
      Wissen.sondeGesichtet(game, null);   // der Beleg wirkt sofort, ohne Verzögerung (zusatzSicht liefert seine Hexe)
    } else {
      ws.wissen = Object.assign({}, vorher, { gz: gz + 1 });
    }
  } catch (e) {
    ws.wissen = vorher;
    if (game.countError) game.countError('handel-info', e);
    return fehl('fehler');
  }
  game.inventory.marks -= preis;
  gekauft[gkey] = 1; ws.infoZahl = (ws.infoZahl || 0) + 1;
  const letzte = letzteVon(ws); letzte.unshift({ s: stufe === 'beleg' ? 'b' : 'g', x: erg.text, a: thema.art }); if (letzte.length > 2) letzte.length = 2;
  try {
    game.emit('radio', { from: W.von, text: erg.text, lage: 1, r: 1, tick: ws.tickZahl });
    game.emit('sfx', { name: 'buy' });
  } catch (e) { if (game.countError) game.countError('handel-info-funk', e); }
  return { ok: true, stufe, preis, text: erg.text, zuverlaessigkeit: erg.zuverlaessigkeit, fakten: erg.fakten, intern: { wahr: erg.wahr, feld: erg.feld, key: thema.key, art: thema.art } };
}

// ---------------------------------------------------------------------------------------------------------------- Anzeige (nur Daten)
// world.info = { th: [{ i: 't0', a: Art, g?: 1 (Gerücht gekauft), b?: 1 (Beleg gekauft) }], l?: [{ s: 'g'|'b', x: Text }] } nur an einem Konkordat-Hafen und solange jemand am Terminal sitzt
const nutzerAmTerminal = (game) => { try { return !!require('./werft.js').nutzer(game); } catch (e) { return false; } };
function sichtbar(game) { const ws = zustandVon(game); return !!ws && nutzerAmTerminal(game) && !!konkordatHex(game).hex; }
function snapshot(game) {
  if (!sichtbar(game)) return null;
  const ws = game.weltsim, a = angebotFuer(game), gek = gekauftVon(ws);
  const th = a.themen.map((t) => { const o = { i: t.id, a: t.art, k: kennung(t.key) }; if (gek[a.hex + ':' + t.key + ':gerucht']) o.g = 1; if (gek[a.hex + ':' + t.key + ':beleg']) o.b = 1; return o; });
  const b = { th };
  if (ws.infoLetzte && ws.infoLetzte.length) b.l = ws.infoLetzte.map((q) => ({ s: q.s, x: q.x, a: q.a }));
  return b;
}
function schluessel(game) {
  if (!sichtbar(game)) return null;
  const ws = game.weltsim, k = konkordatHex(game), gek = gekauftVon(ws);
  return [ws.tickZahl, k.hex, Object.keys(gek).length, ws.infoZahl || 0].join('|');
}

module.exports = { kennung, WERTE: W, STUFEN, ARTEN, themenAus, angebotAus, ergebnisAus, verfaelsche, rahmenFuer, rahmenGueltig, setzeRahmenQuelle, einsetzen, kaufen, snapshot, schluessel, angebotFuer, konkordatHex, ctxVon, strom };
