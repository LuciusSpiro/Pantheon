'use strict';
// Weltsimulation Freie Fahrt Sund: Tick und Regeln. Port von Vault/Pantheon/Welt/sim_sund.py (Prototyp), alle Zahlen aus den Werten.
//
// Reines Modul: kein Timer, kein Thread, kein Math.random, kein Date.now, keine Dateizugriffe. Nur tick() ändert den Zustand.
//
// Zustand (reine JSON-Daten, keine Objektverweise, JSON.parse(JSON.stringify(z)) ist verlustfrei):
//   { version, seed, tick, zufall, werte, karte, hexe: {code: {besitzer, posten, garnison, abwehr, anspruch: {fraktion: n}}},
//     flotten: [{id, fraktion, heimat, ort, staerke, kap, befehl, ziel, warte, versorgung, angriff: id|null}], naechsteId,
//     angriffe: [{id, t0, ziel, von, art, relevant, zielArt, t_an, t_ende, ausgang, phase, t_marsch, stuetz, flotten: [flotten-ids]}],
//     vorrat: {rom|ger|kon: {T,M,U,E,N}}, marken: {rom,ger,kon}, absichten: {fraktion: {p_act?, aggr?, max_active?}} }
//   befehl: 'heim' | 'sammeln' | 'angriff' | 'anspruch' | 'rueckzug'.   fraktion der Flotten: rom | ger | kon | pirat.
//   angriffe enthält alle Feldzüge (auch beendete): Grundlage der Kennzahlen, wächst langsam (einige je 100 Ticks).
//
// tick(zustand, {wirkungen, absichten, messung}) VERÄNDERT den Zustand und gibt { zustand, ereignisse } zurück (derselbe Zustand, kein Klon).
//   Wer den alten Stand braucht, klont vorher (structuredClone / JSON). Der Zufallsstrom liegt im Zustand (zustand.zufall).
//   messung: optionales Objekt für Zähler (nur Werkzeuge und Tests), gehört nicht zum Zustand und ändert nichts am Lauf.
const Daten = require('./daten.js');
const Zufall = require('./zufall.js');
const Ereignisse = require('./ereignisse.js');

const GUETER = ['T', 'M', 'U', 'E', 'N'];
const FRAKTIONEN = Daten.FRAKTIONEN;                        // rom, ger, kon: Reiche und Konkordat (Piraten haben keine Wirtschaft)
const BEFEHLE_FELD = ['angriff', 'anspruch', 'rueckzug'];   // Befehle, bei denen die Flotte im Feld unterwegs ist

// Erweiterungspunkt für SUND-02: Wirkungen der Crew auf die Welt. Typ -> (kontext, wirkung) => void. Leer in SUND-01.
const WIRKUNGEN = {};

// ---------- Zustand erzeugen
function erzeuge({ karte, werte, seed = 0 }) {
  const w = Daten.werteFlach(werte);
  Daten.pruefeKarte(karte, w);
  const kartenKopie = { karte: karte.karte, hexe: JSON.parse(JSON.stringify(karte.hexe)), kanten: JSON.parse(JSON.stringify(karte.kanten)) };
  const d = Daten.baue(kartenKopie);
  const z = {
    version: 1, seed, tick: 0, zufall: Zufall.startzustand(seed), werte: w, karte: kartenKopie,
    hexe: {}, flotten: [], naechsteId: 1, angriffe: [], vorrat: {}, marken: {}, absichten: {},
  };
  for (const code of d.codes) {
    const h = d.hex[code];
    z.hexe[code] = { besitzer: h.fraktion, posten: false, garnison: 0, abwehr: w.base_def[h.hafen] || 0, anspruch: {} };
  }
  for (const code of d.codes) {
    const h = d.hex[code], nd = z.hexe[code];
    if (h.hafen && FRAKTIONEN.includes(nd.besitzer)) {
      const kap = w.cap[h.hafen];
      neueFlotte(z, nd.besitzer, code, w.init_frac * kap, kap);
    }
    if (nd.besitzer === 'pirat') neueFlotte(z, 'pirat', code, w.pirat_cap, w.pirat_cap);
  }
  for (const f of FRAKTIONEN) {
    z.vorrat[f] = {};
    for (const g of GUETER) z.vorrat[f][g] = 20;
    z.marken[f] = 100;
  }
  return z;
}

function neueFlotte(z, fraktion, ort, staerke, kap) {
  const fl = { id: z.naechsteId++, fraktion, heimat: ort, ort, staerke, kap, befehl: 'heim', ziel: null, warte: 0, versorgung: 1, angriff: null };
  z.flotten.push(fl);
  return fl;
}

// ---------- Hilfen
const feindlich = (a, b) => a !== b && (a === 'pirat' || b === 'pirat' || (a === 'rom' && b === 'ger') || (a === 'ger' && b === 'rom'));
const mz = (c, key, n = 1) => { if (c.mess) c.mess[key] = (c.mess[key] || 0) + n; };
const rund = (x) => Math.round(x * 100) / 100;
const dd = (c, a, b) => Daten.abstand(c.d, a, b);
const istHafen = (c, code) => c.d.hex[code].hafen !== '';
const istStuetzknoten = (c, code) => istHafen(c, code) || c.z.hexe[code].posten;

// Stärkeklasse als Zahl: 1 klein, 2 mittel, 3 groß. Schwellen aus werte.staerkeklassen (zustand.werte).
function staerkeKlasse(wert, werte) {
  const s = werte.staerkeklassen;
  return wert >= s.gross ? 3 : wert >= s.mittel ? 2 : 1;
}

function melde(c, typ, fraktion, felder) {
  c.ev.push(Ereignisse.bauen(typ, c.z.tick, fraktion, felder, (code) => c.d.hex[code].name));
}
const summeStaerke = (liste) => liste.reduce((s, fl) => s + fl.staerke, 0);

const besitzer = (z, hex) => z.hexe[hex].besitzer;
const istPosten = (z, hex) => z.hexe[hex].posten;
const flottenAm = (z, hex) => z.flotten.filter((fl) => fl.ort === hex);
const abstand = Daten.abstand;

const fraktionsKnoten = (c, f) => c.d.codes.filter((code) => c.z.hexe[code].besitzer === f && istStuetzknoten(c, code));
function bevoelkerung(c, f) {
  let s = 0;
  for (const code of c.d.codes) {
    const nd = c.z.hexe[code];
    if (nd.besitzer === f && (istHafen(c, code) || nd.posten)) s += istHafen(c, code) ? c.w.bevoelkerung[c.d.hex[code].hafen] : c.w.bevoelkerung.P;
  }
  return s;
}
function ortsbonus(c, code, f) {
  const nd = c.z.hexe[code];
  if (nd.besitzer !== f) return 0;
  return istHafen(c, code) ? c.w.bonus[c.d.hex[code].hafen] : (nd.posten ? c.w.bonus.P : 0);
}
const wirksam = (c, fl) => fl.staerke * fl.versorgung * (1 + ortsbonus(c, fl.ort, fl.fraktion));
const flotteMitId = (c, id) => c.z.flotten.find((fl) => fl.id === id);
const angriffMitId = (c, id) => c.z.angriffe.find((a) => a.id === id);
const feindAm = (c, f, ort, minStaerke) => c.z.flotten.some((o) => feindlich(f, o.fraktion) && o.ort === ort && o.staerke > minStaerke);

// ---------- Tick (Reihenfolge wie step() im Prototyp)
function schritt(c) {
  c.z.tick += 1;
  wirtschaft(c);
  ki(c);
  bewegung(c);
  sammeln(c);
  gefecht(c);
  anspruecheAuswerten(c);
  regeneration(c);
  angriffeSchliessen(c);
}

function wirtschaft(c) {
  const { z, d, w } = c;
  for (const f of FRAKTIONEN) {
    for (const code of d.codes) {
      const nd = z.hexe[code];
      if (nd.besitzer === f && istStuetzknoten(c, code)) for (const g of d.hex[code].quellen) z.vorrat[f][g] = Math.min(50, z.vorrat[f][g] + w.prod);
    }
  }
  if (w.trade) handel(c);
  for (const f of FRAKTIONEN) {
    const st = z.vorrat[f];
    const pop = bevoelkerung(c, f);
    let ndef = false, mdef = false;
    st.N -= pop * w.civil_n;
    if (st.N < 0) { st.N = 0; ndef = true; }
    st.M -= pop * w.civil_m;
    if (st.M < 0) { st.M = 0; mdef = true; }
    mz(c, 'ndef_' + f, ndef ? 1 : 0); mz(c, 'mdef_' + f, mdef ? 1 : 0);
    z.marken[f] += pop * w.tax * (ndef ? 0.5 : 1);
    const sup = new Set(fraktionsKnoten(c, f));
    for (const fl of z.flotten) {
      if (fl.fraktion !== f) continue;
      let dsup = sup.size ? Infinity : 6;
      for (const s of sup) dsup = Math.min(dsup, dd(c, fl.ort, s));
      let mult;
      if (w.stuetz) {
        const unterwegs = BEFEHLE_FELD.includes(fl.befehl) || (fl.befehl === 'sammeln' && fl.ort !== fl.ziel);
        mult = (unterwegs ? w.active_mult : 1) * (1 + w.overext * dsup);
        if (fl.befehl === 'sammeln' && fl.ort === fl.ziel) mz(c, 'stage_ticks');
      } else {
        mult = (fl.befehl !== 'heim' ? w.active_mult : 1) * (1 + w.overext * dsup);
      }
      if (w.feld_decay > 0 && BEFEHLE_FELD.includes(fl.befehl) && !sup.has(fl.ort)) {
        const loss = fl.staerke * w.feld_decay;
        fl.staerke = Math.max(0.5, fl.staerke - loss);
        mz(c, 'feld_loss', loss);
      }
      const nu = fl.staerke * w.up_u * mult, nt = fl.staerke * w.up_t * mult;
      if (st.U >= nu && st.T >= nt) {
        st.U -= nu; st.T -= nt; fl.versorgung = 1;
      } else {
        st.U = Math.max(0, st.U - nu); st.T = Math.max(0, st.T - nt);
        fl.versorgung = w.mangel_malus;
        fl.staerke = Math.max(0.5, fl.staerke * (1 - w.decay));
      }
      mz(c, 'fleet_ticks_' + f);
      mz(c, 'unsupplied_' + f, fl.versorgung < 1 ? 1 : 0);
      if (mdef) {
        fl.versorgung *= 0.85;
        fl.staerke = Math.max(0.5, fl.staerke * (1 - w.mdef_decay));
      }
    }
    for (const code of d.codes) {
      const nd = z.hexe[code];
      if (nd.besitzer === f && nd.posten && !istHafen(c, code)) st.U = Math.max(0, st.U - nd.garnison * w.up_u);
    }
    for (const fl of z.flotten) {
      if (fl.fraktion === f && fl.befehl === 'heim' && fl.ort === fl.heimat && fl.staerke < fl.kap && !ndef && !feindAm(c, f, fl.ort, 0.6)) {
        const rate = w.neubau[d.hex[fl.heimat].hafen] * (mdef ? w.mdef_neubau : 1);
        const amt = Math.min(rate, fl.kap - fl.staerke, st.E / w.cost_e, st.U / w.cost_u);
        if (amt > 0) { st.E -= amt * w.cost_e; st.U -= amt * w.cost_u; fl.staerke += amt; }
      }
    }
  }
  for (const fl of z.flotten) {
    if (fl.fraktion === 'pirat' && fl.befehl === 'heim') fl.staerke = Math.min(fl.kap, fl.staerke + 0.3);
    if (fl.fraktion === 'pirat') fl.versorgung = 1;
  }
}

// Abstrakter Handel des Konkordats (kein Konvoi-Objekt). Embargo (Daten): { from, fac, goods } sperrt Güter ab einem Tick.
// Erzeugt höchstens ein zusammenfassendes Ereignis je Tick, nur wenn mehr als werte.konvoi.min_menge gehandelt wurde.
function handel(c) {
  const { z, w } = c;
  const emb = w.embargo;
  const reihe = Zufall.mische(z, ['rom', 'ger']);
  const summe = {};
  for (const r of reihe) {
    const st = z.vorrat[r], kon = z.vorrat.kon;
    const s = summe[r] = { verkauf: {}, kauf: {} };
    for (const [g, ziel] of [['M', 6], ['T', 12], ['E', 8]]) {
      if (emb && z.tick >= emb.from && emb.fac === r && emb.goods.includes(g)) continue;
      const want = Math.min(w.trade_cap, Math.max(0, ziel - st[g]));
      const qty = Math.min(want, Math.max(0, kon[g] - 3), z.marken[r] / w.price_sell);
      st[g] += qty; kon[g] -= qty;
      z.marken[r] -= qty * w.price_sell; z.marken.kon += qty * w.price_sell;
      if (qty > 0) s.verkauf[g] = rund(qty);
    }
    for (const [g, ziel] of [['N', 15], ['U', 15]]) {
      const want = Math.min(w.trade_cap, Math.max(0, ziel - kon[g]));
      const qty = Math.min(want, Math.max(0, st[g] - 15), z.marken.kon / w.price_buy);
      kon[g] += qty; st[g] -= qty;
      z.marken.kon -= qty * w.price_buy; z.marken[r] += qty * w.price_buy;
      if (qty > 0) s.kauf[g] = rund(qty);
    }
  }
  let menge = 0;
  const handelOut = {};
  for (const r of ['rom', 'ger']) {
    const s = summe[r];
    const m = Object.values(s.verkauf).concat(Object.values(s.kauf)).reduce((a, b) => a + b, 0);
    if (m > 0) { handelOut[r] = s; menge += m; }
  }
  if (menge > w.konvoi.min_menge) melde(c, 'konvoi', 'kon', { handel: handelOut, menge: rund(menge) });
}

// ---------- KI
function verteidigung(c, code) {
  const nd = c.z.hexe[code];
  const fl = c.z.flotten.filter((x) => x.ort === code && x.fraktion === nd.besitzer);
  if (fl.length) return fl.reduce((s, x) => s + wirksam(c, x), 0);
  return istHafen(c, code) ? nd.abwehr : nd.garnison;
}

function neuerAngriff(z, felder) {
  const rec = { id: z.angriffe.length + 1, t0: z.tick, t_an: null, t_ende: null, ausgang: null, phase: null, t_marsch: null, stuetz: null, ...felder };
  z.angriffe.push(rec);
  return rec;
}

function ki(c) {
  const { z, d, w } = c;
  for (const fl of z.flotten) {
    if (FRAKTIONEN.includes(fl.fraktion) && (fl.befehl === 'anspruch' || fl.befehl === 'angriff')) {
      const st = z.vorrat[fl.fraktion];
      if (fl.staerke < w.retreat * fl.kap || st.U < 3 || st.T < 3) { fl.befehl = 'rueckzug'; fl.ziel = fl.heimat; }
    }
  }
  for (const f of FRAKTIONEN) {
    // Absichten (SUND-03): zustand.absichten[fraktion] überschreibt p_act, aggr, max_active der Standard-KI, sonst gelten die Werte.
    const ab = z.absichten[f] || {};
    const pAct = ab.p_act !== undefined ? ab.p_act : w.p_act;
    const aggr = ab.aggr !== undefined ? ab.aggr : w.aggr;
    const maxActive = ab.max_active !== undefined ? ab.max_active : w.max_active[f];
    const mine = z.flotten.filter((fl) => fl.fraktion === f);
    const active = mine.filter((fl) => fl.befehl !== 'heim');
    const st = z.vorrat[f];
    if (active.length >= maxActive || Zufall.zahl(z) > pAct) continue;
    const ready = mine.filter((fl) => fl.befehl === 'heim' && fl.ort === fl.heimat && fl.staerke >= 0.7 * fl.kap);
    if (!ready.length || st.U < 10 || st.T < 10) continue;
    const slots = maxActive - active.length;
    if (f !== 'kon' && w.war && Zufall.zahl(z) < aggr) {
      let best = null;
      for (const code of d.codes) {
        const nd = z.hexe[code];
        if (FRAKTIONEN.includes(nd.besitzer) && feindlich(f, nd.besitzer) && istStuetzknoten(c, code)) {
          const need = w.attack_ratio * Math.max(verteidigung(c, code), 1);
          const cand = ready.filter((fl) => dd(c, fl.ort, code) <= 8).sort((a, b) => b.staerke - a.staerke).slice(0, slots);
          let tot = 0;
          const chosen = [];
          for (const fl of cand) { chosen.push(fl); tot += fl.staerke * 0.9; if (tot >= need) break; }
          if (tot >= need && (best === null || need < best.need)) best = { need, code, chosen };
        }
      }
      if (best) {
        const rec = neuerAngriff(z, { ziel: best.code, von: f, art: 'reich', relevant: true, zielArt: istHafen(c, best.code) ? 'hafen' : 'posten', flotten: best.chosen.map((fl) => fl.id) });
        const summe = summeStaerke(best.chosen);
        if (w.stuetz && stuetzpunktWaehlen(c, f, rec, best.code, best.chosen)) {
          melde(c, 'flotte_sammelt', f, { stuetzpunkt: rec.stuetz, ziel: best.code, staerke: rund(summe), klasse: staerkeKlasse(summe, w), flotten: best.chosen.length, angriff: rec.id });
        } else {
          for (const fl of best.chosen) { fl.befehl = 'angriff'; fl.ziel = best.code; fl.angriff = rec.id; }
          melde(c, 'flotte_aufbruch', f, { art: 'angriff', von: best.chosen[0].ort, ziel: best.code, staerke: rund(summe), klasse: staerkeKlasse(summe, w), angriff: rec.id });
        }
        mz(c, 'attacks');
        continue;
      }
    }
    if (st.E >= w.posten_e) {
      let fl = null;
      for (const x of ready) if (fl === null || x.staerke > fl.staerke) fl = x;
      if (fl.staerke >= w.garrison + 1) {
        let best = null;
        for (const code of d.codes) {
          const nd = z.hexe[code];
          if (nd.besitzer === null && !istHafen(c, code) && dd(c, fl.ort, code) <= 6) {
            if (z.flotten.some((o) => feindlich(f, o.fraktion) && o.ort === code)) continue;
            const wants = d.hex[code].quellen.some((g) => st[g] < 15) ? 3 : 1;
            if ((nd.anspruch[f] || 0) >= 0) {
              const score = wants / (1 + dd(c, fl.ort, code));
              if (best === null || score > best.score) best = { score, code };
            }
          }
        }
        if (best) {
          fl.befehl = 'anspruch'; fl.ziel = best.code;
          mz(c, 'claims');
          melde(c, 'flotte_aufbruch', f, { art: 'beanspruchen', von: fl.ort, ziel: best.code, staerke: rund(fl.staerke), klasse: staerkeKlasse(fl.staerke, w), angriff: null });
        }
      }
    }
  }
  for (const fl of z.flotten) {
    if (fl.fraktion === 'pirat' && fl.befehl === 'heim' && fl.staerke >= 0.8 * fl.kap && Zufall.zahl(z) < w.pirat_raid) {
      const tg = d.nbrP[fl.heimat].filter((code) => z.hexe[code].besitzer !== 'pirat');
      if (tg.length) {
        const ziel = Zufall.waehle(z, tg);
        const rec = neuerAngriff(z, { ziel, von: 'pirat', art: 'pirat', relevant: z.hexe[ziel].besitzer !== null, zielArt: 'posten', flotten: [fl.id] });
        fl.befehl = 'angriff'; fl.ziel = ziel; fl.warte = 0; fl.angriff = rec.id;
        melde(c, 'flotte_aufbruch', 'pirat', { art: 'raubzug', von: fl.ort, ziel, staerke: rund(fl.staerke), klasse: staerkeKlasse(fl.staerke, w), angriff: rec.id });
      }
    }
  }
}

// Phase 1 des Angriffs: Sammeln in einem eigenen Hafen oder Posten nahe am Ziel (Stützpunkt). false = kein Platz, dann marschieren die Flotten direkt.
function stuetzpunktWaehlen(c, f, rec, ziel, flotten) {
  const { z, d, w } = c;
  const tot = summeStaerke(flotten);
  const ids = new Set(flotten.map((fl) => fl.id));
  let best = null;
  for (const code of d.codes) {
    const nd = z.hexe[code];
    if (nd.besitzer !== f || !istStuetzknoten(c, code)) continue;
    if (flotten.some((fl) => dd(c, fl.ort, code) > 8)) continue;
    if (feindAm(c, f, code, 0.6)) continue;
    const occ = summeStaerke(z.flotten.filter((x) => x.fraktion === f && x.ort === code && !ids.has(x.id)));
    const cap = istHafen(c, code) ? w.cap[d.hex[code].hafen] : w.stuetz_cap;
    if (occ + tot > cap + 1e-9) continue;
    const k1 = dd(c, code, ziel), k2 = flotten.reduce((s, fl) => s + dd(c, fl.ort, code), 0);
    if (best === null || k1 < best.k1 || (k1 === best.k1 && k2 < best.k2)) best = { k1, k2, code };
  }
  if (best === null) return false;
  rec.phase = 'sammeln'; rec.stuetz = best.code;
  for (const fl of flotten) { fl.befehl = 'sammeln'; fl.ziel = best.code; fl.angriff = rec.id; }
  return true;
}

// Phase 1 -> 2: alle am Stützpunkt und Mindestdauer um = Marsch. Zu lange Sammelzeit oder ein Ziel, das nicht mehr feindlich ist, bricht ab.
function sammeln(c) {
  const { z, w } = c;
  for (const rec of z.angriffe) {
    if (rec.phase !== 'sammeln') continue;
    const fls = rec.flotten.map((id) => flotteMitId(c, id)).filter((fl) => fl && fl.angriff === rec.id);
    const nd = z.hexe[rec.ziel];
    const alter = z.tick - rec.t0;
    const keine = !fls.length, nichtMehrFeind = !(FRAKTIONEN.includes(nd.besitzer) && feindlich(rec.von, nd.besitzer)), zuLang = alter > w.sammeln_max;
    if (keine || nichtMehrFeind || zuLang) {
      for (const fl of fls) { fl.befehl = 'rueckzug'; fl.ziel = fl.heimat; fl.angriff = null; }
      rec.phase = 'abgebrochen'; rec.ausgang = 'abgebrochen'; rec.t_ende = z.tick;
      mz(c, 'abort');
      melde(c, 'angriff_abgebrochen', rec.von, { ziel: rec.ziel, grund: keine ? 'keine_flotte' : (nichtMehrFeind ? 'ziel' : 'zeit'), angriff: rec.id });
      continue;
    }
    if (alter >= w.sammeln_min && fls.every((fl) => fl.befehl === 'sammeln' && fl.ort === fl.ziel)) {
      for (const fl of fls) { fl.befehl = 'angriff'; fl.ziel = rec.ziel; }
      rec.phase = 'marsch'; rec.t_marsch = z.tick;
      const summe = summeStaerke(fls);
      melde(c, 'flotte_marsch', rec.von, { stuetzpunkt: rec.stuetz, ziel: rec.ziel, staerke: rund(summe), klasse: staerkeKlasse(summe, w), angriff: rec.id });
    }
  }
}

function bewegung(c) {
  const { z, d } = c;
  for (const fl of z.flotten) {
    if (fl.befehl === 'heim' || fl.ziel === null) continue;
    const nx = fl.fraktion === 'pirat' ? d.nxtP : d.nxt;
    if (fl.ort !== fl.ziel) fl.ort = nx[fl.ort][fl.ziel];
    const rec = fl.angriff !== null ? angriffMitId(c, fl.angriff) : null;
    if (rec && fl.befehl === 'angriff' && fl.ort === fl.ziel && rec.t_an === null) {
      rec.t_an = z.tick;
      meldeAnkunft(c, rec);
    }
    if (fl.befehl === 'rueckzug' && fl.ort === fl.heimat) {
      fl.befehl = 'heim'; fl.ziel = null;
    } else if (fl.fraktion === 'pirat' && fl.befehl === 'angriff' && fl.ort === fl.ziel) {
      fl.warte += 1;
      if (fl.warte >= 2) { fl.befehl = 'rueckzug'; fl.ziel = fl.heimat; }
    }
  }
}

// Erste Flotte eines Feldzugs am Ziel: Belagerung beginnt (Reichsangriff) bzw. Piratenüberfall; beides löst bei Bedarf einen Notruf aus.
function meldeAnkunft(c, rec) {
  const { z, w } = c;
  const nd = z.hexe[rec.ziel];
  const summe = summeStaerke(z.flotten.filter((fl) => fl.angriff === rec.id && fl.befehl === 'angriff'));
  const klasse = staerkeKlasse(summe, w);
  if (rec.art === 'reich') {
    melde(c, 'flotte_belagert', rec.von, { ziel: rec.ziel, zielArt: rec.zielArt, besitzer: nd.besitzer, staerke: rund(summe), klasse, angriff: rec.id });
    if (rec.zielArt === 'hafen') melde(c, 'notruf', nd.besitzer, { art: 'belagerung', ort: rec.ziel, opfer: nd.besitzer, angreifer: rec.von, staerke: rund(summe), klasse, angriff: rec.id });
  } else if (nd.besitzer !== null) {
    melde(c, 'notruf', nd.besitzer, { art: 'piratenueberfall', ort: rec.ziel, opfer: nd.besitzer, angreifer: 'pirat', staerke: rund(summe), klasse, angriff: rec.id });
  }
}

// ---------- Gefecht
function gefecht(c) {
  const { z, d, w } = c;
  for (const code of d.codes) {
    const nd = z.hexe[code];
    const hier = z.flotten.filter((fl) => fl.ort === code && fl.staerke > 0.6);
    const facs = [...new Set(hier.map((fl) => fl.fraktion))].sort();
    if (!facs.length) continue;
    const owner = nd.besitzer;
    const feindHier = facs.some((a) => facs.some((b) => feindlich(a, b)));
    const angreifer = hier.filter((fl) => owner && feindlich(fl.fraktion, owner));
    let gekaempft = false;
    if (feindHier) {
      gekaempft = true;
      const effs = {};
      for (const a of facs) effs[a] = hier.filter((fl) => fl.fraktion === a).reduce((s, fl) => s + wirksam(c, fl), 0);
      for (const a of facs) {
        let feind = 0;
        for (const b of facs) if (feindlich(a, b)) feind += effs[b];
        const loss = w.k * feind * Zufall.gleichverteilt(z, 0.85, 1.15);
        const mine = hier.filter((fl) => fl.fraktion === a);
        const tot = summeStaerke(mine);
        if (tot > 0 && loss > 0) for (const fl of mine) fl.staerke = Math.max(0, fl.staerke - loss * fl.staerke / tot);
      }
    } else if (angreifer.length && istStuetzknoten(c, code)) {
      // Verteidigung ohne Flotte: Abwehr des Hafens (abwehr) bzw. Garnison des Postens (garnison)
      gekaempft = true;
      const hafen = istHafen(c, code);
      const dval = hafen ? nd.abwehr : nd.garnison;
      const aeff = angreifer.reduce((s, fl) => s + wirksam(c, fl), 0);
      const lossA = w.k * dval * Zufall.gleichverteilt(z, 0.85, 1.15);
      const lossD = w.k * aeff * Zufall.gleichverteilt(z, 0.85, 1.15);
      const tot = summeStaerke(angreifer);
      for (const fl of angreifer) fl.staerke = Math.max(0, fl.staerke - lossA * fl.staerke / Math.max(tot, 1e-9));
      if (hafen) nd.abwehr = Math.max(0, nd.abwehr - lossD); else nd.garnison = Math.max(0, nd.garnison - lossD);
      if ((hafen ? nd.abwehr : nd.garnison) <= 0.5) {
        const sieger = angreifer.filter((fl) => fl.staerke > 0.01);
        if (sieger.length) {
          let top = null, topS = -Infinity;
          for (const a of [...new Set(sieger.map((fl) => fl.fraktion))].sort()) {
            const s = summeStaerke(sieger.filter((x) => x.fraktion === a));
            if (s > topS) { top = a; topS = s; }
          }
          if (hafen && top !== 'pirat') {
            erobern(c, code, top);
          } else if (hafen) {
            nd.abwehr = 0.5;
          } else {
            mz(c, 'posten_lost'); mz(c, 'plost_pirat', top === 'pirat' ? 1 : 0); mz(c, 'plost_reich', top !== 'pirat' ? 1 : 0);
            melde(c, 'posten_verloren', owner, { ort: code, besitzer: owner, durch: top });
            nd.posten = false; nd.besitzer = null; nd.garnison = 0; nd.anspruch = {};
          }
        }
      }
    }
    if (gekaempft) {
      mz(c, 'rr', facs.includes('rom') && facs.includes('ger') ? 1 : 0);
      mz(c, 'pb', facs.includes('pirat') ? 1 : 0);
      mz(c, 'battles');
      if (c.mess && c.mess.first_battle == null) c.mess.first_battle = z.tick;
    }
  }
  for (const fl of z.flotten) {
    if (fl.staerke < 0.5) {
      fl.staerke = 0.5; fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null;
    } else if ((fl.befehl === 'anspruch' || fl.befehl === 'angriff') && fl.staerke < w.retreat * fl.kap && fl.fraktion !== 'pirat') {
      fl.befehl = 'rueckzug'; fl.ziel = fl.heimat;
    }
  }
}

function erobern(c, code, neu) {
  const { z, d, w } = c;
  const nd = z.hexe[code];
  const alt = nd.besitzer;
  mz(c, 'captures');
  nd.besitzer = neu; nd.abwehr = 0.3 * (w.base_def[d.hex[code].hafen] || 0); nd.anspruch = {};
  const meine = z.flotten.filter((x) => x.fraktion === alt && x.heimat === code);
  const andere = fraktionsKnoten(c, alt).filter((h) => istHafen(c, h) && h !== code);
  for (const fl of meine) {
    if (andere.length) {
      let best = null, bd = Infinity;
      for (const h of andere) { const dh = dd(c, fl.ort, h); if (dh < bd) { bd = dh; best = h; } }
      fl.heimat = best; fl.befehl = 'rueckzug'; fl.ziel = best;
    } else {
      z.flotten.splice(z.flotten.indexOf(fl), 1);
    }
  }
  neueFlotte(z, neu, code, 1, w.cap[d.hex[code].hafen]);
  melde(c, 'hafen_gefallen', neu, { ort: code, alt, neu });
  if (d.hauptwelten[alt] === code) melde(c, 'hauptwelt_gefallen', neu, { ort: code, alt, neu });
}

function anspruecheAuswerten(c) {
  const { z, w } = c;
  for (const fl of z.flotten) {
    if (fl.befehl !== 'anspruch' || fl.ort !== fl.ziel) continue;
    const nd = z.hexe[fl.ziel];
    const f = fl.fraktion;
    if (nd.besitzer !== null) { fl.befehl = 'rueckzug'; fl.ziel = fl.heimat; continue; }
    if (feindAm(c, f, fl.ort, 0.5)) continue;
    nd.anspruch[f] = (nd.anspruch[f] || 0) + 1;
    if (nd.anspruch[f] >= w.claim_ticks) {
      if (z.vorrat[f].E >= w.posten_e && fl.staerke >= w.garrison + 1) {
        z.vorrat[f].E -= w.posten_e;
        fl.staerke -= w.garrison;
        nd.posten = true; nd.besitzer = f; nd.garnison = w.garrison;
        mz(c, 'posten');
        melde(c, 'posten_gegruendet', f, { ort: fl.ziel });
        fl.befehl = 'rueckzug'; fl.ziel = fl.heimat;
      } else if (nd.anspruch[f] > w.claim_ticks + 5) {
        fl.befehl = 'rueckzug'; fl.ziel = fl.heimat;
      }
    }
  }
}

function angriffeSchliessen(c) {
  const { z } = c;
  for (const rec of z.angriffe) {
    if (rec.t_ende !== null || rec.phase === 'sammeln') continue;
    const nd = z.hexe[rec.ziel];
    const aktiv = z.flotten.some((fl) => fl.angriff === rec.id && fl.befehl === 'angriff');
    let abgewehrt = false;
    if (rec.art === 'reich') {
      if (nd.besitzer === rec.von) { rec.ausgang = 'capture'; rec.t_ende = z.tick; }
      else if (nd.besitzer === null && !istHafen(c, rec.ziel)) { rec.ausgang = 'posten'; rec.t_ende = z.tick; }
      else if (!aktiv) { rec.ausgang = 'abgewehrt'; rec.t_ende = z.tick; abgewehrt = true; }
    } else if (!aktiv) {
      rec.ausgang = nd.besitzer === null && rec.relevant ? 'posten' : 'abgewehrt'; rec.t_ende = z.tick;
      abgewehrt = rec.ausgang === 'abgewehrt';
    }
    if (abgewehrt) melde(c, 'angriff_abgewehrt', nd.besitzer === null ? rec.von : nd.besitzer, { art: rec.art, ziel: rec.ziel, zielArt: rec.zielArt, besitzer: nd.besitzer, angriff: rec.id });
  }
}

function regeneration(c) {
  const { z, d, w } = c;
  for (const code of d.codes) {
    const nd = z.hexe[code];
    if (FRAKTIONEN.includes(nd.besitzer) && istHafen(c, code)) nd.abwehr = Math.min(w.base_def[d.hex[code].hafen], nd.abwehr + w.regen);
    else if (nd.posten) nd.garnison = Math.min(w.garrison, nd.garnison + 0.2);
  }
}

// ---------- Öffentliche Schnittstelle
function tick(zustand, { wirkungen = [], absichten, messung } = {}) {
  for (const wk of wirkungen) {
    if (!wk || typeof wk.typ !== 'string' || !(wk.typ in WIRKUNGEN)) throw new Error(`Weltsim: unbekannte Wirkung "${wk && wk.typ}"`);
  }
  if (absichten) zustand.absichten = JSON.parse(JSON.stringify(absichten));
  const c = { z: zustand, d: Daten.datenVon(zustand), w: zustand.werte, ev: [], mess: messung || null };
  for (const wk of wirkungen) WIRKUNGEN[wk.typ](c, wk);
  schritt(c);
  return { zustand, ereignisse: c.ev };
}

module.exports = { erzeuge, tick, besitzer, istPosten, flottenAm, abstand, staerkeKlasse, feindlich, datenVon: Daten.datenVon, WIRKUNGEN, GUETER, FRAKTIONEN };
