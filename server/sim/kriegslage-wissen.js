'use strict';
// SUND-01 C: Wissensmodell von Rom (Action-Layer) für den Modus „Freie Fahrt Sund“. Die Karte des Captains zeigt nicht den Sim-Zustand,
// sondern das, was Rom weiß. Der Aufrufer (kriegslage.js) ruft nur starten / nachTick / sondeGesichtet / toSave / restore / lage auf.
//
// Sensorknoten: römische Häfen, römische Posten, römische Flotten (aus der Sim) und die Lerche (Hex des Schiffs).
// Sichtweite: `werte.sicht.weite` Sprünge über Kanten des Flottennetzes (Daten.abstand), Verzögerung `werte.sicht.verzoegerung` Ticks:
//   eigene Gebiete und Flotten exakt (Alter 0) · fremde Flotten und fremder Besitz in Sicht aus dem Zustand des VOR-Ticks (Alter = Verzögerung)
//   · außerhalb der Sicht der letzte bekannte Stand mit Alter in Ticks · nie gesehen = Kartenstand (Besitz der Karte, Alter null).
// Die Verzögerung ist keine Zeitschleife: kriegslage.js übergibt den Zustand vor dem Tick (`vor`), das Wissen liest fremde Daten dort.
// Rom erfährt nie mehr, als es sieht: die Anzeige nutzt von der Sim nur Daten sichtbarer Hexe (und eigene Daten). Das wahre Ziel einer
// feindlichen Flotte wird nie gelesen; `z` ist eine Schätzung aus öffentlichen Daten (erstes römisches Ziel in Marschrichtung).
//
// Wissen (Zustand, wird mit welt.sim gespeichert, Schema ergänzt, keine Versionserhöhung):
//   { v, t, hexe: { <hex>: { f, p, a } }, flotten: [ { f, h, k, p, a, n?, z?, d?, an?, ids } ], erst: { <angriff>: Tick }, gesehen: [ 'sa:3' ... ],
//     meldungen: [ { e, h, t, f?, k? } ], wartend: [ Ereignis ], notrufe: [ { an, h } ] }
//   f Fraktion r g k p - v · p (Hex) Posten 0|1 · a Tick der Daten (null = Kartenstand) · k Stärkeklasse 1..3 · p (Flotte) Phase h u s m b r
// `gesehen` sind die gemerkten Ids (Feldzug + Phase): Funkmeldungen kommen einmal je Feldzug, auch nach Speichern und Laden.
//
//   starten(game)                       Wissen beim Modusstart
//   nachTick(game, vor, ereignisse, nachOrt)   ein Tick der Sim ist gelaufen; vor = Abbild des Sim-Zustands davor, nachOrt = Ort/Hex der Lerche danach
//   sondeGesichtet(game, hex)           Hook von Sektorplan.sichten (Sonde): Hex sofort, ohne Verzögerung
//   zusatzSicht(game, seit)             Erweiterungspunkt SUND-03 (Sonden, Weitscan, Konkordat-Belege): Hexe, die Rom über die Sensorknoten hinaus sieht
//   lage(game) / schluessel(game)       Anzeigeblock world.lage (nur Darstellung) und sein Änderungsschlüssel
//   toSave(ws) / restore(game, block) / neuLeer()
const Daten = require('../weltsim/daten.js');
const Kern = require('../weltsim/kern.js');
const Sektoren = require('../../shared/sektoren.js');
const Marken = require('./marken.js');
const KT = require('../../public/js/karte-tokens.js');

const FK = { rom: 'r', ger: 'g', kon: 'k', pirat: 'p' };
const KARTEN_FK = { rom: 'r', ger: 'g', saum: 'k', pirat: 'p', frei: '-', vorl: 'v', neutral: '-' };
const fk = (b) => (b ? FK[b] || '-' : '-');
const PH_RANG = { b: 0, m: 1, s: 2, u: 3, r: 3, h: 4 };
const GESEHEN_MAX = 80, ERST_MAX = 24, WARTEND_MAX = 24, NOTRUF_MAX = 4;
const klon = (v) => JSON.parse(JSON.stringify(v));
const KARTE_ID = 'sund_frei';

// ---------------------------------------------------------------------------------------------------------------- Karte (Anzeigehexe)
let kartenCache = null;
function karte() {
  if (kartenCache) return kartenCache;
  let k = Sektoren.KARTE && Sektoren.KARTE.id === KARTE_ID ? Sektoren.KARTE : null;
  if (!k) k = require('../../content/welt/sund_frei.json');
  const codes = KT.hexReihenfolge(k);
  const statisch = {};
  for (const c of codes) statisch[c] = KARTEN_FK[k.hexe[c].fraktion] || '-';
  kartenCache = { codes, statisch };
  return kartenCache;
}
const hexVon = (ref) => Marken.hexVon(ref);

function neuLeer() { return { v: 1, t: 0, ver: 0, sondeT: 0, hexe: {}, flotten: [], erst: {}, gesehen: [], meldungen: [], wartend: [], notrufe: [] }; }

// ---------------------------------------------------------------------------------------------------------------- Sicht
const istHafen = (d, code) => !!(d.hex[code] && d.hex[code].hafen);
const abstandKnoten = (d, a, b) => (a === b ? 0 : Daten.abstand(d, a, b));

// Sensorknoten von Rom: { h, art: hafen | posten | flotte | lerche }
function sensorKnoten(z, d, lerche) {
  const out = [];
  for (const code of d.codes) {
    const nd = z.hexe[code];
    if (nd.besitzer !== 'rom') continue;
    if (istHafen(d, code)) out.push({ h: code, art: 'hafen' });
    else if (nd.posten) out.push({ h: code, art: 'posten' });
  }
  for (const fl of z.flotten) if (fl.fraktion === 'rom') out.push({ h: fl.ort, art: 'flotte' });
  if (lerche) out.push({ h: lerche, art: 'lerche' });
  return out;
}
// Abstand eines Hex zum nächsten Sensorknoten (Sprünge im Flottennetz; 99 = außer Reichweite des Netzes)
function knotenAbstand(d, knoten, hex) {
  let best = 99;
  for (const k of knoten) { const a = abstandKnoten(d, k.h, hex); if (a < best) best = a; }
  return best;
}

// Erweiterungspunkt für SUND-03: Hexe, die Rom über die Sensorknoten hinaus sieht und zwar ohne Verzögerung. Heute nur die Sonden-Sichtung:
// ein Hex, den eine Sonde seit `seit` (Spielzeit) im Sektorplan gesichtet hat (q 'sonde'). Weitscan der Lerche und Konkordat-Belege folgen in
// SUND-03; sie hängen sich hier ein und liefern weiter nur eine Menge von Hex-Codes.
function zusatzSicht(game, seit) {
  const out = new Set();
  const g = (game.sektorplan && game.sektorplan.gesichtet) || {};
  for (const [hex, s] of Object.entries(g)) if (s && s.q === 'sonde' && Number(s.t) > (Number(seit) || 0)) out.add(hex);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- Flotten
function phaseVon(fl) {
  switch (fl.befehl) {
    case 'sammeln': return fl.ort === fl.ziel ? 's' : 'u';
    case 'angriff': return fl.ort === fl.ziel ? 'b' : 'm';
    case 'anspruch': return fl.ort === fl.ziel ? 'h' : 'u';
    case 'rueckzug': return fl.ort === fl.heimat ? null : 'r';   // am Heimathafen angekommen = daheim, nicht auf der Karte
    default: return null;   // heim: nicht auf der Karte
  }
}
const naechster = (d, fl) => {
  if (!fl.ziel || fl.ort === fl.ziel) return null;
  const nx = fl.fraktion === 'pirat' ? d.nxtP : d.nxt;
  return (nx[fl.ort] && nx[fl.ort][fl.ziel]) || null;
};
const summe = (liste) => liste.reduce((s, fl) => s + fl.staerke, 0);

// Gruppen (eine Plakette je Fraktion und Hex) aus einer Flottenliste. q = Zustand, aus dem die Liste stammt (Vor-Tick oder jetzt).
function gruppenBilden(q, d, werte, flotten) {
  const map = new Map();
  for (const fl of flotten) {
    const p = phaseVon(fl);
    if (!p) continue;
    const key = fl.fraktion + '@' + fl.ort;
    if (!map.has(key)) map.set(key, { fraktion: fl.fraktion, h: fl.ort, fl: [] });
    map.get(key).fl.push({ fl, p });
  }
  const out = [];
  for (const g of map.values()) {
    let p = 'h';
    for (const x of g.fl) if (PH_RANG[x.p] < PH_RANG[p]) p = x.p;
    const dom = g.fl.filter((x) => x.p === p);
    const mitN = dom.map((x) => ({ x, n: naechster(d, x.fl) })).find((y) => y.n);
    const gr = { fraktion: g.fraktion, f: fk(g.fraktion), h: g.h, p, k: Kern.staerkeKlasse(summe(g.fl.map((x) => x.fl)), werte), ids: g.fl.map((x) => x.fl.id), an: [] };
    if (p === 'm' || p === 'u' || p === 'r') { if (mitN) gr.n = mitN.n; else if (p !== 'm') gr.p = 'h'; }
    for (const x of g.fl) if (x.fl.angriff != null && !gr.an.includes(x.fl.angriff)) gr.an.push(x.fl.angriff);
    if (p === 'm' && !gr.n) gr.p = 'h';
    out.push(gr);
  }
  return out;
}

// Verteidiger eines belagerten Hex (zweite Plakette): Flotten des Besitzers dort, sonst Abwehr bzw. Garnison
function verteidiger(q, d, werte, hex) {
  const nd = q.hexe[hex];
  if (!nd || !nd.besitzer) return null;
  const hier = q.flotten.filter((fl) => fl.ort === hex && fl.fraktion === nd.besitzer);
  const st = hier.length ? summe(hier) : (istHafen(d, hex) ? nd.abwehr : nd.garnison);
  return { fraktion: nd.besitzer, f: fk(nd.besitzer), h: hex, p: 'h', k: Kern.staerkeKlasse(st, werte), ids: hier.map((fl) => fl.id), an: [] };
}

// Vermutetes Ziel eines marschierenden fremden Verbands: erstes römisches Ziel (Hafen oder Posten) auf einem kürzesten Weg über das nächste Hex.
// Nutzt nur öffentliche Daten (Position, nächstes Hex, römische Knoten), nie die Absicht der KI.
function vermutetesZiel(z, d, h, n) {
  let best = null;
  for (const code of d.codes) {
    const nd = z.hexe[code];
    if (nd.besitzer !== 'rom' || !(istHafen(d, code) || nd.posten)) continue;
    const dh = abstandKnoten(d, h, code), dn = abstandKnoten(d, n, code);
    if (dh < 1 || dh > 6 || dn !== dh - 1) continue;
    if (!best || dh < best.dh || (dh === best.dh && code < best.code)) best = { dh, code };
  }
  return best ? best.code : null;
}

const rangVon = (q, T) => {
  const al = T - q.a;
  if (q.f !== 'r' && al > 1) return 20 + al;
  return (q.f === 'r' ? 10 : 0) + PH_RANG[q.p];
};

// ---------------------------------------------------------------------------------------------------------------- Text und Funk
const hexName = (d, h) => (d.hex[h] ? d.hex[h].name : (Sektoren.hexName ? Sektoren.hexName(h) : h));
const ortId = (h) => { try { return Sektoren.ortVonHex(h) || null; } catch (e) { return null; } };

function absender(d, knoten, hex) {
  let best = null;
  const prio = { lerche: 0, hafen: 1, posten: 2, flotte: 3 };
  for (const k of knoten) {
    const a = abstandKnoten(d, k.h, hex);
    if (a > 99) continue;
    if (!best || a < best.a || (a === best.a && prio[k.art] < prio[best.art])) best = { a, art: k.art, h: k.h };
  }
  if (!best) return KT.TEXT.funk.von.lerche.toUpperCase();
  const t = KT.vorlage('funk.von.' + best.art, { ort: hexName(d, best.h) });
  return (t || KT.TEXT.funk.von.lerche).toUpperCase();
}

// ---------------------------------------------------------------------------------------------------------------- Kern: Wissen aktualisieren
// o: { z, d, T, vor (Zustand vor `verzoegerung` Ticks | null = jetzt), prev (Zustand des Vor-Ticks | null), lerche (Hex | null), sofort (Set | null: nur diese Hexe, ohne Tick), ereignisse }
function berechne(W0, o) {
  const W = klon(W0);
  const { z, d, T } = o;
  const w = z.werte, vz = w.sicht.verzoegerung, weite = w.sicht.weite;
  const kt = karte();
  const vor = o.vor || z;
  const tick = !o.sofort;
  const knoten = tick ? sensorKnoten(z, d, o.lerche) : [];
  const zusatz = o.sofort || new Set();
  const aus = { funk: [], markenSetzen: [], markenEntfernen: [] };

  const eigen = (code) => { const a = z.hexe[code]; const b = o.prev && o.prev.hexe[code]; return !!((a && a.besitzer === 'rom') || (b && b.besitzer === 'rom')); };
  const inSicht = (code) => (tick && knotenAbstand(d, knoten, code) <= weite);
  const sichtbar = new Set();   // Hexe mit neuem Stand in diesem Aufruf (ohne die eigenen Gebiete)

  // 1) Besitz je Hex
  for (const code of kt.codes) {
    const sim = z.hexe[code];
    let rec = null;
    if (sim) {
      if (tick && eigen(code)) { rec = { f: fk(sim.besitzer), p: sim.posten ? 1 : 0, a: T }; if (inSicht(code)) sichtbar.add(code); }
      else if (zusatz.has(code)) { rec = { f: fk(sim.besitzer), p: sim.posten ? 1 : 0, a: T }; sichtbar.add(code); }
      else if (inSicht(code)) { const v = vor.hexe[code] || sim; rec = { f: fk(v.besitzer), p: v.posten ? 1 : 0, a: T - vz }; sichtbar.add(code); }
    } else if (zusatz.has(code) || inSicht(code)) { rec = { f: kt.statisch[code], p: 0, a: T - vz }; sichtbar.add(code); }
    if (rec) W.hexe[code] = rec;
    else if (!W.hexe[code]) W.hexe[code] = { f: sim ? fk(d.hex[code].fraktion) : kt.statisch[code], p: 0, a: null };
  }

  // 2) Flotten: eigene exakt (jetzt), fremde in Sicht aus dem Vor-Tick (oder bei Zusatzsicht aus dem jetzigen Zustand)
  const neu = [];
  const eigeneFl = z.flotten.filter((fl) => fl.fraktion === 'rom');
  if (tick) for (const g of gruppenBilden(z, d, w, eigeneFl)) {
    g.a = T;
    if (g.p === 'm') { const fl = eigeneFl.find((x) => x.ort === g.h && phaseVon(x) === 'm'); if (fl && fl.ziel) g.z = fl.ziel; }
    neu.push(g);
  }
  const fremdAus = (q, hexe, a) => {
    const fl = q.flotten.filter((x) => x.fraktion !== 'rom' && hexe.has(x.ort));
    for (const g of gruppenBilden(q, d, w, fl)) {
      g.a = a;
      if (g.p === 'm' && g.n) { const zz = vermutetesZiel(z, d, g.h, g.n); if (zz) g.z = zz; }
      neu.push(g);
    }
  };
  const inSichtMenge = new Set([...sichtbar].filter((c) => !zusatz.has(c)));
  fremdAus(vor, inSichtMenge, T - vz);
  if (zusatz.size) fremdAus(z, zusatz, T);
  // Verteidiger belagerter Hexe (zweite Plakette); eigene Hexe aus dem jetzigen, fremde aus dem Vor-Tick-Zustand
  for (const g of neu.slice()) {
    if (g.p !== 'b') continue;
    const quelle = zusatz.has(g.h) ? z : (eigen(g.h) ? z : vor);
    const v = verteidiger(quelle, d, w, g.h);
    if (v && v.fraktion !== g.fraktion) { v.a = zusatz.has(g.h) || v.fraktion === 'rom' ? T : T - vz; neu.push(v); }
  }
  // zusammenführen: alte Einträge an jetzt sichtbaren Hexen und eigene fallen weg, Einträge derselben Flotte ebenfalls; Altstand bleibt bis altMax
  const neueIds = new Set();
  for (const g of neu) for (const id of g.ids) neueIds.add(id);
  const sichtAlle = new Set([...sichtbar]);
  const alte = [];
  for (const r of W.flotten) {
    if (r.f === 'r' && tick) continue;
    if (sichtAlle.has(r.h)) continue;
    const ids = (r.ids || []).filter((id) => !neueIds.has(id));
    if (!ids.length && (r.ids || []).length) continue;
    if (T - r.a > KT.WERTE.altMax) continue;
    alte.push(Object.assign({}, r, { ids }));
  }
  W.flotten = alte.concat(neu.map((g) => { const r = { f: g.f, h: g.h, k: g.k, p: g.p, a: g.a, ids: g.ids }; if (g.n) r.n = g.n; if (g.z) r.z = g.z; if (g.an.length) r.an = g.an; return r; }));

  // 3) Meldungen und Funk aus dem, was Rom jetzt sieht (Zustand, nicht Ereignisse: nie doppelt, nie verloren, auch im Schnellsprung)
  const merke = (key) => { if (W.gesehen.includes(key)) return false; W.gesehen.push(key); if (W.gesehen.length > GESEHEN_MAX) W.gesehen.splice(0, W.gesehen.length - GESEHEN_MAX); return true; };
  const meldung = (e, h, f, k) => { const m = { e, h, t: T }; if (f) m.f = f; if (k) m.k = k; W.meldungen.unshift(m); };
  const fkn = tick ? knoten : sensorKnoten(z, d, o.lerche);
  const klasseName = (k) => KT.staerkeName(k);
  for (const g of neu) {
    if (g.f === 'r' || !g.an.length || !['s', 'm', 'b'].includes(g.p)) continue;
    for (const an of g.an) {
      if (!merke(g.p + ':' + an)) continue;
      const kind = { s: 'sa', m: 'ma', b: 'be' }[g.p];
      meldung(kind, g.h, g.f, g.k);
      if (g.p === 's') W.erst[an] = g.a;
      if (g.f !== 'g' || g.p === 'm') continue;
      const von = absender(d, fkn, g.h);
      if (g.p === 's') aus.funk.push({ von, text: KT.vorlage('funk.sammeln', { ort: hexName(d, g.h), klasse: klasseName(g.k) }), loc: ortId(g.h), t: T, log: KT.vorlage('funk.log.sammeln', { klasse: klasseName(g.k), t: T }) });
      else aus.funk.push({ von, text: KT.vorlage('funk.belagerung', { ziel: hexName(d, g.h), klasse: klasseName(g.k) }), loc: ortId(g.h), t: T, log: KT.vorlage('funk.log.belagerung', { klasse: klasseName(g.k), t: T }) });
    }
  }
  // Zähler „Ticks im Sammeln“ (d): seit der ersten Sicht
  for (const r of W.flotten) if (r.p === 's' && r.an) { const e = r.an.map((an) => W.erst[an]).filter((x) => x != null); if (e.length) r.d = Math.max(1, r.a - Math.min(...e) + 1); else delete r.d; } else delete r.d;
  for (const an of Object.keys(W.erst)) { const rec = z.angriffe.find((x) => x.id === Number(an)); if (!rec || rec.t_ende !== null) delete W.erst[an]; }
  if (Object.keys(W.erst).length > ERST_MAX) for (const an of Object.keys(W.erst).slice(0, Object.keys(W.erst).length - ERST_MAX)) delete W.erst[an];

  // 4) Ereignisse (Hafen gefallen, Posten verloren und gegründet, Angriff abgewehrt, Notruf): eigene sofort, fremde einen Tick später und nur, wenn gesehen
  if (tick) {
    const geprueft = W.wartend; W.wartend = [];
    const sieht = (h) => eigen(h) || knotenAbstand(d, knoten, h) <= weite;
    const zeige = (ev, sofort) => {
      const key = ev.e + ':' + ev.h + ':' + ev.t0;
      if (!sofort && !sieht(ev.h)) return;
      if (!merke(key)) return;
      if (ev.e === 'nr') {
        if (!W.notrufe.some((x) => x.an === ev.an)) { W.notrufe.push({ an: ev.an, h: ev.h }); aus.markenSetzen.push({ id: 'lage:a' + ev.an, h: ev.h }); }
        if (W.notrufe.length > NOTRUF_MAX) { const weg = W.notrufe.shift(); aus.markenEntfernen.push('lage:a' + weg.an); }
        return;
      }
      meldung(ev.e, ev.h, ev.f);
      if (ev.e === 'hf' || ev.e === 'pv') {
        const ziel = ev.e === 'pv' ? 'Posten ' + hexName(d, ev.h) : hexName(d, ev.h);
        aus.funk.push({ von: absender(d, knoten, ev.h), text: KT.vorlage('funk.gefallen', { ziel }), loc: ortId(ev.h), t: T, log: KT.vorlage('funk.log.gefallen', { t: T }) });
      }
    };
    for (const ev of geprueft) zeige(ev, false);
    for (const ev of o.ereignisse || []) {
      const x = ereignisVon(ev, T);
      if (!x) continue;
      if (x.eigen) zeige(x, true); else W.wartend.push(x);
    }
    if (W.wartend.length > WARTEND_MAX) W.wartend.splice(0, W.wartend.length - WARTEND_MAX);
    // Notruf-Marken enden mit dem Feldzug
    for (const nr of W.notrufe.slice()) {
      const rec = z.angriffe.find((x) => x.id === nr.an);
      if (!rec || rec.t_ende !== null) { W.notrufe.splice(W.notrufe.indexOf(nr), 1); aus.markenEntfernen.push('lage:a' + nr.an); }
    }
  }
  // alte Meldungen fallen weg: Flottenmeldungen nach einem Tick, Ereignisse nach meldungAlter Ticks
  W.meldungen = W.meldungen.filter((m) => (['sa', 'ma', 'be'].includes(m.e) ? T - m.t < KT.WERTE.neuTicks : T - m.t < KT.WERTE.meldungAlter)).slice(0, KT.WERTE.meldungenMax);
  if (tick) W.t = T;
  W.ver++;
  return { W, aus };
}

// Sim-Ereignis -> internes Ereignis { e, h, f, an?, t0, eigen } | null. eigen: Rom ist Beteiligter (sofort bekannt), sonst einen Tick später und nur gesehen.
function ereignisVon(ev, T) {
  switch (ev.typ) {
    case 'hafen_gefallen': return { e: 'hf', h: ev.ort, f: fk(ev.neu), t0: T, eigen: ev.alt === 'rom' || ev.neu === 'rom' };
    case 'posten_verloren': return { e: 'pv', h: ev.ort, f: fk(ev.besitzer), t0: T, eigen: ev.besitzer === 'rom' };
    case 'posten_gegruendet': return { e: 'pg', h: ev.ort, f: fk(ev.fraktion), t0: T, eigen: ev.fraktion === 'rom' };
    case 'angriff_abgewehrt': return { e: 'hh', h: ev.ziel, f: fk(ev.besitzer || ev.fraktion), t0: T, eigen: ev.besitzer === 'rom' };
    case 'notruf': return { e: 'nr', h: ev.ort, f: fk(ev.opfer), an: ev.angriff, t0: T, eigen: ev.opfer === 'rom' };
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------- Ausgabe (Seiteneffekte)
function ausgeben(game, aus) {
  for (const id of aus.markenEntfernen) { try { Marken.entferne(game, id); } catch (e) { if (game.countError) game.countError('lage-marke', e); } }
  for (const m of aus.markenSetzen) { try { const f = Marken.setze(game, { id: m.id, typ: 'notruf', hex: m.h }); if (f && game.countError) game.countError('lage-marke', new Error(f)); } catch (e) { if (game.countError) game.countError('lage-marke', e); } }
  for (const f of aus.funk) {
    try {
      game.emit('radio', { from: f.von, text: f.text, lage: 1, tick: f.t });
      if (game.explore && f.log) game.explore.addLog(f.log, f.loc, null);
    } catch (e) { if (game.countError) game.countError('lage-funk', e); }
  }
}

// ---------------------------------------------------------------------------------------------------------------- Schnittstelle
const lerchenHex = (game, nachOrt) => {
  const h = hexVon(nachOrt) || (game.ship ? hexVon(game.ship.scene) : null);
  return h;
};
function dat(ws) { return { z: ws.zustand, d: Daten.datenVon(ws.zustand), T: ws.tickZahl }; }

function starten(game) {
  const ws = game.weltsim;
  const { z, d, T } = dat(ws);
  const r = berechne(neuLeer(), { z, d, T, vor: null, lerche: lerchenHex(game, null), ereignisse: [] });
  ws.wissen = r.W;
  ws.wissen.sondeT = game.time;
  return ws.wissen;
}

function nachTick(game, vor, ereignisse, nachOrt) {
  const ws = game.weltsim;
  if (!ws.wissen) { starten(game); return; }
  const { z, d, T } = dat(ws);
  // Zustände der letzten Ticks (nur Arbeitsspeicher, nicht gespeichert): fremde Daten kommen aus dem Zustand von vor `verzoegerung` Ticks
  const prev = Object.assign({}, vor, { werte: z.werte, karte: z.karte });
  const ring = ws.vorher || (ws.vorher = []);
  ring.push(prev);
  const vz = z.werte.sicht.verzoegerung;
  while (ring.length > Math.max(1, vz)) ring.shift();
  const r = berechne(ws.wissen, { z, d, T, vor: vz <= 0 ? null : ring[0], prev, lerche: lerchenHex(game, nachOrt), ereignisse });
  r.W.sondeT = game.time;
  ws.wissen = r.W;
  ausgeben(game, r.aus);
}

function sondeGesichtet(game) {
  const ws = game.weltsim;
  if (!ws || !ws.wissen) return;
  const zus = zusatzSicht(game, ws.wissen.sondeT);
  if (!zus.size) return;
  const { z, d, T } = dat(ws);
  const r = berechne(ws.wissen, { z, d, T, vor: null, lerche: null, sofort: zus, ereignisse: [] });
  r.W.sondeT = game.time;
  ws.wissen = r.W;
  ausgeben(game, r.aus);
}

// ---------------------------------------------------------------------------------------------------------------- Anzeigeblock
const alterZeichen = (a, T) => KT.alterZeichen(a == null ? null : T - a);
function lage(game) {
  const ws = game.weltsim;
  if (!ws || !ws.wissen) return null;
  const W = ws.wissen;
  if (ws._lage && ws._lage.ver === W.ver) return ws._lage.block;
  const T = W.t, w = ws.zustand.werte, vz = w.sicht.verzoegerung, kt = karte();
  let hx = '';
  for (const c of kt.codes) { const r = W.hexe[c] || { f: '-', p: 0, a: null }; hx += (r.p ? r.f.toUpperCase() : r.f) + alterZeichen(r.a, T); }
  const f = W.flotten.filter((r) => T - r.a <= KT.WERTE.altMax)
    .sort((a, b) => rangVon(a, T) - rangVon(b, T) || (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).slice(0, KT.WERTE.flottenMax)
    .map((r) => { const o = { f: r.f, h: r.h, k: r.k, p: r.p, a: Math.max(0, T - r.a) }; if (r.n) o.n = r.n; if (r.z) o.z = r.z; if (r.d) o.d = r.d; return o; });
  const m = W.meldungen.map((x) => { const o = { e: x.e, h: x.h, t: x.t }; if (x.f) o.f = x.f; if (x.k) o.k = x.k; return o; });
  const block = { t: T, vz, sw: w.sicht.weite, hx, f, m };
  ws._lage = { ver: W.ver, block };
  return block;
}
function schluessel(game) { const ws = game.weltsim; return ws && ws.wissen ? ws.wissen.t + ':' + ws.wissen.ver : null; }

// ---------------------------------------------------------------------------------------------------------------- Speichern und Laden
function toSave(ws) {
  const W = ws && ws.wissen;
  if (!W) return null;
  const b = klon(W);
  delete b.ver; delete b.sondeT;
  return b;
}
const ZEICHEN = /^[rgkpv-]$/;
function gueltig(b, tickZahl, d) {
  if (!b || typeof b !== 'object' || b.v !== 1 || b.t !== tickZahl) return false;
  if (!b.hexe || typeof b.hexe !== 'object' || !Array.isArray(b.flotten) || !Array.isArray(b.gesehen) || !Array.isArray(b.meldungen) || !Array.isArray(b.wartend) || !Array.isArray(b.notrufe)) return false;
  if (!b.erst || typeof b.erst !== 'object') return false;
  for (const c of karte().codes) { const r = b.hexe[c]; if (!r || !ZEICHEN.test(r.f) || (r.p !== 0 && r.p !== 1) || (r.a !== null && !Number.isFinite(r.a))) return false; }
  for (const q of b.flotten) if (!q || !ZEICHEN.test(q.f) || !(q.h in d.hex || /^\d{4}$/.test(q.h)) || !Number.isFinite(q.k) || !(q.p in PH_RANG) || !Number.isFinite(q.a) || !Array.isArray(q.ids)) return false;
  return true;
}
// block: welt.sim.wissen | undefined (Altstand ohne den Teil: beginnt leer, d. h. mit dem Kartenstand und der Sicht des Ladezeitpunkts)
function restore(game, block) {
  const ws = game.weltsim;
  const { z, d, T } = dat(ws);
  if (gueltig(block, T, d)) {
    const W = klon(block);
    W.ver = 1; W.sondeT = game.time;
    ws.wissen = W;
    return true;
  }
  if (block !== undefined && game.countError) game.countError('kriegslage-wissen', new Error('welt.sim.wissen unbrauchbar – Wissen beginnt neu'));
  starten(game);
  return false;
}
// Notruf-Marken werden nicht im Weltstand gespeichert: nach dem Laden aus dem gemerkten Zustand neu setzen
function markenNeu(game) {
  const ws = game.weltsim;
  if (!ws || !ws.wissen) return;
  for (const nr of ws.wissen.notrufe) Marken.setze(game, { id: 'lage:a' + nr.an, typ: 'notruf', hex: nr.h });
}

module.exports = { neuLeer, starten, nachTick, sondeGesichtet, zusatzSicht, lage, schluessel, toSave, restore, markenNeu, berechne, sensorKnoten, knotenAbstand, vermutetesZiel, gruppenBilden, karte };
