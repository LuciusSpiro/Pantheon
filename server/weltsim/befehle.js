'use strict';
// Gezielte Befehle an die Weltsimulation (SUND-03 A): Katalog, Prüfer, Anwender, Ablauf. Muster wie wirkungen.js.
//
// Ein Befehl ist ein reines JSON-Objekt { typ, ...Felder }. tick(zustand, { befehle }) prüft jeden Befehl gegen den Zustand NACH der Wirtschaft des Ticks und wendet ihn dort an,
// bevor die Standard-KI plant (die KI sieht die befohlenen Flotten als aktiv und plant um sie herum). Ungültige Befehle werden abgelehnt, nie halb gespielt; der Grund geht zurück
// an den Aufrufer (Regie-Logbuch). Der Kern bleibt rein (kein I/O, kein Zufall): die Befehle ziehen KEINE Zufallszahl, ohne Befehle und ohne Zustandsfelder (embargo, regie, miete)
// ändert sich am Lauf nichts (Bit-Parität zum Prototyp, Test in tools/test-befehle.js).
//
// Katalog (Felder, Wirkung; alle Zahlen und Grenzen in content/welt/befehle-werte.json):
//   angreifen         { fraktion: rom|ger, ziel: Hex, flotten?: [ids] | flotte?: id | von?: Hex }  Reichsangriff auf einen feindlichen Hafen/Posten wie die Standard-KI, nur mit festem Ziel
//                     (Sammeln am Stützpunkt, Ereignisse flotte_sammelt/flotte_aufbruch). Ohne flotten wählt der Kern die stärksten bereiten Flotten (nie Mietflotten); mit flotten nimmt er genau diese.
//   beanspruchen      { fraktion, sektor: Hex }        freies Hex ohne Hafen mit einem Posten belegen (Kern: Befehl 'anspruch').
//   verstaerken       { fraktion, flotte: id, hafen: Hex }  eine Flotte im Heimathafen wechselt in einen anderen eigenen Hafen (neue Heimat, Ereignis flotte_verlegt).
//   rueckzug          { fraktion, flotte: id }         eine Flotte im Einsatz (angriff, anspruch, sammeln) bricht ab (Kern: Befehl 'rueckzug').
//   nachschub         { an: rom|ger, gut: T|U, menge, hafen? }  abstrakter Konvoi des Konkordats (Vorrat des Konkordats gegen Marken, Ereignis konvoi), kein Objekt auf der Karte.
//   embargo           { von: 'kon', gegen: rom|ger, waren: [M|T|E], dauer }  das Konkordat sperrt den Kauf; zustand.embargo[gegen] = { waren, von, bis, ... }, endet von selbst.
//   soeldner          { von: 'kon', an: rom|ger, flotten: [ids], dauer }  Flotten des Konkordats dienen für die Dauer unter einem Reich (flotte.miete), Marken an das Konkordat.
//   piratenueberfall  { ort: Hex }                     bereite Piratenflotte im Piratennetz greift einen Ort mit Besitzer an (pirat_raid ohne Würfel).
//   fokus             { fraktion: rom|ger, hex, radius, dauer }  Überlagerung zustand.regie[fraktion].fokus: Angriffsziele der Standard-KI nur im Umkreis.
//   regler            { fraktion: rom|ger|kon, p_act?, aggr?, max_active?, dauer }  die drei Regler der Standard-KI als Überlagerung zustand.regie[fraktion].
// Zustandsfelder (alle optional, reines JSON, werden mit dem Sim-Zustand gespeichert; ohne Befehle erscheint keines davon, der Kern bleibt bitgleich zum Prototyp):
//   zustand.embargo { fraktion: { waren, von, from, bis } }                              Embargo je Ziel-Fraktion (handel() liest es), endet bei bis von selbst
//   zustand.regie { fraktion: { p_act?, aggr?, max_active?, regler_bis?, fokus?: { hex, radius, bis }, ruhe_bis? } }   Überlagerung der Regie, eigener Namensraum neben zustand.absichten (Strategische Optionen, absicht.js)
//   flotte.miete { von, an, bis, preis }                                                 Söldner: die Flotte dient bis bis einer anderen Fraktion
//   angriff.befohlen: true                                                               Feldzug auf Befehl (Kennzahlen)
// Schichtung: zustand.absichten (Wahl der Crew) gilt für ihre Felder vor zustand.regie vor den Werten (wirksam()); ruhe_bis setzt aggr der Standard-KI auf 0 (der Befehl ersetzt einen Angriff der KI,
// content/welt/befehle-werte.json ruhe, gemessen). Keine Quelle schreibt in den Namensraum der anderen: der Rückbau der einen lässt die andere stehen.
const Daten = require('./daten.js');

const W = require('../../content/welt/befehle-werte.json').werte;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const REICH = ['rom', 'ger'];
const REGLER_FELDER = ['p_act', 'aggr', 'max_active'];
let H = null;   // Helfer des Kerns (melde, rund, dd, ...), von installiere() gesetzt

// ---------- Hilfen
const istHex = (z, x) => typeof x === 'string' && has(z.hexe, x);
const istId = (x) => Number.isInteger(x) && x >= 1;
const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);
const flotteMit = (c, id) => c.z.flotten.find((fl) => fl.id === id);
// die wirksamen Regler einer Fraktion: Wahl der Crew (zustand.absichten, SUND-02b D) vor der Überlagerung der Regie (zustand.regie) vor den Werten. Eigene Namensräume je Quelle:
// keine Quelle schreibt in die der anderen, der Rückbau der einen lässt die andere stehen. Ohne beide Felder genau die Werte (Bit-Parität). -> { p_act, aggr, max_active, fokus | null }
function wirksam(z, f) {
  const w = z.werte, ab = (z.absichten && z.absichten[f]) || {}, rg = (z.regie && z.regie[f]) || {};
  return {
    p_act: ab.p_act !== undefined ? ab.p_act : (rg.p_act !== undefined ? rg.p_act : w.p_act),
    // ruhe_bis (SUND-03 A): nach einem Befehl der Regie für diese Fraktion beginnt die Standard-KI keine eigenen Reichsangriffe, solange die Ruhe gilt (der Befehl ersetzt sie, kein Gratis-Ertrag);
    // die Wahl der Crew gilt auch hier vor allem anderen
    aggr: ab.aggr !== undefined ? ab.aggr : (rg.ruhe_bis !== undefined && z.tick < rg.ruhe_bis ? 0 : (rg.aggr !== undefined ? rg.aggr : w.aggr)),
    max_active: ab.max_active !== undefined ? ab.max_active : (rg.max_active !== undefined ? rg.max_active : w.max_active[f]),
    fokus: rg.fokus || null,
  };
}
const maxActive = (c, f) => wirksam(c.z, f).max_active;
// Crew vor Regie auch bei Befehlen: hat die Crew für Rom eine Absicht gewählt (zustand.absichten.rom), die zurückhaltender ist als die Regie-/Standardwerte, bekommt Rom keine Offensiv-Befehle.
// feld: aggr (Angriffe) oder p_act (Ansprüche, sie hängen an p_act). Gilt nur für Rom: die Crew spielt für Rom.
function crewBremst(z, f, feld) {
  if (f !== 'rom') return false;
  const ab = z.absichten && z.absichten.rom;
  if (!ab || !Number.isFinite(ab[feld])) return false;
  const rg = (z.regie && z.regie.rom) || {};
  const ohne = rg[feld] !== undefined ? rg[feld] : z.werte[feld];
  return ab[feld] < ohne;
}
const aktive = (c, f) => c.z.flotten.filter((fl) => fl.fraktion === f && fl.befehl !== 'heim');
// bereit für einen Auftrag: im Heimathafen, ruhig, mindestens 70 % der Kapazität (wie ki())
const istBereit = (fl) => fl.befehl === 'heim' && fl.ort === fl.heimat && fl.staerke >= 0.7 * fl.kap;
const bereit = (c, f) => c.z.flotten.filter((fl) => fl.fraktion === f && istBereit(fl));
const dauerFehler = (typ, dauer) => {
  const r = W.dauer.wert[typ];
  return Number.isInteger(dauer) && dauer >= r.min && dauer <= r.max ? null : `dauer muss eine ganze Zahl von ${r.min} bis ${r.max} Ticks sein`;
};
const runde1 = (x) => Math.round(x * 10) / 10;
const embargoAktiv = (z, f) => !!(z.embargo && z.embargo[f] && z.tick < z.embargo[f].bis);
// erlaubte Felder je Typ (Fremdfelder lehnt der Prüfer ab: ein Tippfehler im Plan darf nie still etwas anderes bedeuten)
const FELDER = {
  angreifen: ['typ', 'fraktion', 'ziel', 'flotten', 'flotte', 'von'], beanspruchen: ['typ', 'fraktion', 'sektor'], verstaerken: ['typ', 'fraktion', 'flotte', 'hafen'], rueckzug: ['typ', 'fraktion', 'flotte'],
  nachschub: ['typ', 'an', 'gut', 'menge', 'hafen'], embargo: ['typ', 'von', 'gegen', 'waren', 'dauer'], soeldner: ['typ', 'von', 'an', 'flotten', 'dauer'], piratenueberfall: ['typ', 'ort'], sabotage: ['typ', 'ort'],
  fokus: ['typ', 'fraktion', 'hex', 'radius', 'dauer'], regler: ['typ', 'fraktion', 'p_act', 'aggr', 'max_active', 'dauer'],
};
function felderFehler(b) {
  for (const k of Object.keys(b)) if (!FELDER[b.typ].includes(k)) return `unbekanntes Feld "${k}"`;
  return null;
}

// ---------- Angriffswahl wie ki(), mit festem Ziel
// Flotten für einen Angriff von f auf ziel. Explizit (ids): genau diese. Sonst die stärksten bereiten Flotten (ohne Mietflotten) bis die Stärke reicht.
function angriffswahl(c, b) {
  const f = b.fraktion, A = W.angreifen.wert;
  const slots = maxActive(c, f) - aktive(c, f).length;
  const need = c.w.attack_ratio * Math.max(H.verteidigung(c, b.ziel), 1);
  const ids = idsVon(b);
  let chosen;
  if (ids !== null) chosen = ids.map((id) => flotteMit(c, id));
  else {
    const cand = bereit(c, f).filter((fl) => !fl.miete && (b.von === undefined || fl.ort === b.von) && H.dd(c, fl.ort, b.ziel) <= A.reichweite)
      .sort((x, y) => y.staerke - x.staerke).slice(0, Math.max(0, Math.min(slots, A.flotten_max)));
    chosen = [];
    let tot = 0;
    for (const fl of cand) { chosen.push(fl); tot += fl.staerke * 0.9; if (tot >= need) break; }
  }
  const tot = chosen.reduce((s, fl) => s + (fl ? fl.staerke * 0.9 : 0), 0);
  return { slots, need, tot, chosen };
}
function idsVon(b) {
  if (b.flotten !== undefined) return b.flotten;
  if (b.flotte !== undefined) return [b.flotte];
  return null;
}

// ---------- Voraussetzungen als benannte Regeln (SUND-03 F2): dieselben Funktionen prüft der Katalog UND liest der Ausschnitt des Lage-Spielleiters (befehle_frei), nie zwei Regeln pflegen
// Vorrat der Fraktion f für einen Angriff (Munition U, Treibstoff T) -> null | Grund
function angriffVorratFehler(z, f) {
  const A = W.angreifen.wert, st = z.vorrat[f];
  return st.U < A.min_munition || st.T < A.min_treibstoff ? `Munition oder Treibstoff unter ${A.min_munition}` : null;
}
// Vorrat des Konkordats und Marken der Fraktion an für einen Nachschub von menge Einheiten gut -> null | Grund
function nachschubVorratFehler(z, w, an, gut, menge) {
  const N = W.nachschub.wert;
  if (z.vorrat.kon[gut] - N.kon_reserve < menge) return `Konkordat hat nicht genug ${gut} (es behält ${N.kon_reserve})`;
  if (z.marken[an] < menge * w.price_sell * N.preis_faktor) return 'Marken reichen nicht';
  return null;
}
// größte Menge, die nachschubVorratFehler noch durchlässt (0 = keine); Embargo gegen an: 0
function nachschubMengeMax(z, w, an, gut) {
  const N = W.nachschub.wert;
  if (embargoAktiv(z, an)) return 0;
  let m = 0;
  for (let k = N.menge.min; k <= N.menge.max; k++) { if (nachschubVorratFehler(z, w, an, gut, k)) break; m = k; }
  return m;
}
// eine freie, vermietbare Flotte des Konkordats (zu Hause, nicht vermietet)
const mietbar = (fl) => fl.fraktion === 'kon' && !fl.miete && fl.befehl === 'heim' && fl.ort === fl.heimat;

// ---------- Katalog
const KATALOG = {
  angreifen: {
    pruefe(c, b) {
      const { z, w, d } = c, A = W.angreifen.wert;
      if (!REICH.includes(b.fraktion)) return 'fraktion muss rom oder ger sein';
      if (!w.war) return 'Krieg ist aus';
      if (crewBremst(z, b.fraktion, 'aggr')) return 'Crew-Absicht aktiv: Rom hält sich auf Wunsch der Crew zurück';
      if (!istHex(z, b.ziel)) return 'unbekanntes Ziel';
      const nd = z.hexe[b.ziel];
      if (!(H.FRAKTIONEN.includes(nd.besitzer) && H.feindlich(b.fraktion, nd.besitzer) && H.istStuetzknoten(c, b.ziel))) return 'Ziel ist kein feindlicher Hafen oder Posten';
      if (!A.hauptwelt_erlaubt && Object.values(d.hauptwelten).includes(b.ziel)) return 'Hauptwelten sind kein Ziel eines Befehls';
      if (z.angriffe.some((r) => r.t_ende === null && r.ziel === b.ziel && r.von === b.fraktion)) return 'Feldzug auf dieses Ziel läuft schon';
      const st = z.vorrat[b.fraktion];
      const vf = angriffVorratFehler(z, b.fraktion); if (vf) return vf;
      const ids = idsVon(b);
      if (b.von !== undefined && !istHex(z, b.von)) return 'von ist kein Hex';
      if (b.flotten !== undefined && b.flotte !== undefined) return 'flotte und flotten schließen sich aus';
      if (ids !== null) {
        if (!Array.isArray(ids) || !ids.length || ids.length > A.flotten_max || !ids.every(istId) || new Set(ids).size !== ids.length) return `flotten: 1 bis ${A.flotten_max} verschiedene Ids`;
        for (const id of ids) {
          const fl = flotteMit(c, id);
          if (!fl || fl.fraktion !== b.fraktion) return `Flotte ${id} gehört nicht zu ${b.fraktion}`;
          if (!istBereit(fl)) return `Flotte ${id} ist nicht bereit (unterwegs oder zu schwach)`;
          if (H.dd(c, fl.ort, b.ziel) > A.reichweite) return `Flotte ${id} ist zu weit vom Ziel (über ${A.reichweite} Sprünge)`;
        }
      }
      const a = angriffswahl(c, b);
      if (a.slots <= 0) return 'keine freie Flotte (max_active erreicht)';
      if (ids !== null && ids.length > a.slots) return 'mehr Flotten als freie Plätze (max_active)';
      if (!a.chosen.length) return `keine bereite Flotte im Umkreis von ${A.reichweite} Sprüngen`;
      if (a.tot < a.need) return `zu schwach (${runde1(a.tot)} von ${runde1(a.need)})`;
      return null;
    },
    anwenden(c, b) {
      const { z, w } = c, f = b.fraktion, a = angriffswahl(c, b);
      const rec = H.neuerAngriff(z, { ziel: b.ziel, von: f, art: 'reich', relevant: true, zielArt: H.istHafen(c, b.ziel) ? 'hafen' : 'posten', flotten: a.chosen.map((fl) => fl.id), befohlen: true });
      const summe = H.summeStaerke(a.chosen);
      if (w.stuetz && H.stuetzpunktWaehlen(c, f, rec, b.ziel, a.chosen)) {
        H.melde(c, 'flotte_sammelt', f, { stuetzpunkt: rec.stuetz, ziel: b.ziel, staerke: H.rund(summe), klasse: H.staerkeKlasse(summe, w), flotten: a.chosen.length, angriff: rec.id });
      } else {
        for (const fl of a.chosen) { fl.befehl = 'angriff'; fl.ziel = b.ziel; fl.angriff = rec.id; }
        H.melde(c, 'flotte_aufbruch', f, { art: 'angriff', von: a.chosen[0].ort, ziel: b.ziel, staerke: H.rund(summe), klasse: H.staerkeKlasse(summe, w), angriff: rec.id });
      }
      H.mz(c, 'attacks');
    },
  },

  beanspruchen: {
    pruefe(c, b) {
      const { z, w } = c;
      if (!H.FRAKTIONEN.includes(b.fraktion)) return 'fraktion muss rom, ger oder kon sein';
      if (crewBremst(z, b.fraktion, 'p_act')) return 'Crew-Absicht aktiv: Rom hält sich auf Wunsch der Crew zurück';
      if (!istHex(z, b.sektor)) return 'unbekannter Sektor';
      if (z.hexe[b.sektor].besitzer !== null || H.istHafen(c, b.sektor)) return 'Sektor ist nicht frei';
      if (z.flotten.some((o) => H.feindlich(b.fraktion, o.fraktion) && o.ort === b.sektor)) return 'feindliche Flotte im Sektor';
      if (z.flotten.some((o) => o.fraktion === b.fraktion && o.befehl === 'anspruch' && o.ziel === b.sektor)) return 'ein Anspruch auf diesen Sektor läuft schon';
      if (z.vorrat[b.fraktion].E < w.posten_e) return 'zu wenig Ersatzteile';
      if (aktive(c, b.fraktion).length >= maxActive(c, b.fraktion)) return 'keine freie Flotte (max_active erreicht)';
      if (!anspruchFlotte(c, b)) return `keine bereite Flotte im Umkreis von ${W.beanspruchen.wert.reichweite} Sprüngen`;
      return null;
    },
    anwenden(c, b) {
      const fl = anspruchFlotte(c, b);
      fl.befehl = 'anspruch'; fl.ziel = b.sektor; H.mz(c, 'claims');
      H.melde(c, 'flotte_aufbruch', b.fraktion, { art: 'beanspruchen', von: fl.ort, ziel: b.sektor, staerke: H.rund(fl.staerke), klasse: H.staerkeKlasse(fl.staerke, c.w), angriff: null });
    },
  },

  verstaerken: {
    pruefe(c, b) {
      const { z } = c, fl = istId(b.flotte) ? flotteMit(c, b.flotte) : null;
      if (!fl || fl.fraktion !== b.fraktion || !H.FRAKTIONEN.includes(fl.fraktion)) return 'unbekannte Flotte';
      if (fl.miete) return 'Mietflotten werden nicht verlegt';
      if (fl.befehl !== 'heim' || fl.ort !== fl.heimat) return 'Flotte ist unterwegs';
      if (!istHex(z, b.hafen)) return 'unbekannter Hafen';
      if (z.hexe[b.hafen].besitzer !== fl.fraktion || !H.istHafen(c, b.hafen)) return 'Ziel ist kein eigener Hafen';
      if (b.hafen === fl.heimat) return 'Flotte liegt dort schon';
      if (H.dd(c, fl.ort, b.hafen) > W.verstaerken.wert.reichweite) return `Ziel zu weit (über ${W.verstaerken.wert.reichweite} Sprünge)`;
      if (H.feindAm(c, fl.fraktion, b.hafen, 0.6)) return 'feindliche Flotte am Ziel';
      return null;
    },
    anwenden(c, b) {
      const fl = flotteMit(c, b.flotte), von = fl.ort;
      fl.heimat = b.hafen; fl.befehl = 'rueckzug'; fl.ziel = b.hafen;
      H.melde(c, 'flotte_verlegt', fl.fraktion, { von, ziel: b.hafen, staerke: H.rund(fl.staerke), klasse: H.staerkeKlasse(fl.staerke, c.w) });
    },
  },

  rueckzug: {
    pruefe(c, b) {
      const fl = istId(b.flotte) ? flotteMit(c, b.flotte) : null;
      if (!fl || fl.fraktion !== b.fraktion || !H.FRAKTIONEN.includes(fl.fraktion)) return 'unbekannte Flotte';
      if (!['angriff', 'anspruch', 'sammeln'].includes(fl.befehl)) return 'Flotte steht nicht im Einsatz';
      return null;
    },
    anwenden(c, b) {
      const fl = flotteMit(c, b.flotte), rec = fl.angriff !== null ? c.z.angriffe.find((r) => r.id === fl.angriff) : null;
      fl.befehl = 'rueckzug'; fl.ziel = fl.heimat;
      if (rec && rec.phase === 'sammeln') fl.angriff = null;   // wie sammeln() beim Abbruch
    },
  },

  nachschub: {
    pruefe(c, b) {
      const { z, w } = c, N = W.nachschub.wert;
      if (!REICH.includes(b.an)) return 'an muss rom oder ger sein';
      if (typeof b.gut !== 'string' || !N.guete.includes(b.gut)) return `gut muss ${N.guete.join(' oder ')} sein`;
      if (!Number.isInteger(b.menge) || b.menge < N.menge.min || b.menge > N.menge.max) return `menge muss eine ganze Zahl von ${N.menge.min} bis ${N.menge.max} sein`;
      if (b.hafen !== undefined && (!istHex(z, b.hafen) || z.hexe[b.hafen].besitzer !== b.an || !H.istHafen(c, b.hafen))) return 'hafen ist kein Hafen von an';
      if (embargoAktiv(z, b.an)) return `Embargo gegen ${b.an}: das Konkordat liefert nicht`;
      return nachschubVorratFehler(z, w, b.an, b.gut, b.menge);
    },
    anwenden(c, b) {
      const { z, w } = c, preis = b.menge * w.price_sell * W.nachschub.wert.preis_faktor;
      z.vorrat[b.an][b.gut] += b.menge; z.vorrat.kon[b.gut] -= b.menge;
      z.marken[b.an] -= preis; z.marken.kon += preis;
      H.melde(c, 'konvoi', 'kon', { handel: { [b.an]: { verkauf: { [b.gut]: b.menge }, kauf: {} } }, menge: b.menge });
    },
  },

  embargo: {
    pruefe(c, b) {
      const { z } = c, E = W.embargo.wert;
      if (!E.von.includes(b.von)) return 'nur das Konkordat verhängt ein Embargo (von: kon)';
      if (typeof b.gegen !== 'string' || !E.gegen.includes(b.gegen)) return 'gegen muss rom oder ger sein';
      if (!Array.isArray(b.waren) || !b.waren.length || new Set(b.waren).size !== b.waren.length || !b.waren.every((g) => E.waren.includes(g))) return `waren: eine Liste aus ${E.waren.join(', ')}`;
      const df = dauerFehler('embargo', b.dauer);
      if (df) return df;
      if (embargoAktiv(z, b.gegen)) return `gegen ${b.gegen} läuft schon ein Embargo (eines je Ziel)`;
      return null;
    },
    anwenden(c, b) {
      const { z } = c;
      if (!z.embargo) z.embargo = {};
      z.embargo[b.gegen] = { waren: b.waren.slice(), von: b.von, from: z.tick, bis: z.tick + b.dauer + 1 };   // die Befehle wirken nach dem Handel des Tick: wirksam sind die Handels-Ticks tick+1 bis tick+dauer, bis = erster Tick ohne Embargo
      H.melde(c, 'embargo_verhaengt', 'kon', { gegen: b.gegen, waren: b.waren.slice(), dauer: b.dauer });
    },
  },

  soeldner: {
    pruefe(c, b) {
      const { z } = c, S = W.soeldner.wert;
      if (b.von !== 'kon') return 'nur das Konkordat vermietet (von: kon)';
      if (!REICH.includes(b.an)) return 'an muss rom oder ger sein';
      const df = dauerFehler('soeldner', b.dauer);
      if (df) return df;
      if (!Array.isArray(b.flotten) || !b.flotten.length || b.flotten.length > S.flotten_max || !b.flotten.every(istId) || new Set(b.flotten).size !== b.flotten.length) return `flotten: 1 bis ${S.flotten_max} verschiedene Ids`;
      if (embargoAktiv(z, b.an)) return `Embargo gegen ${b.an}: das Konkordat vermietet nicht`;
      if (z.flotten.filter((fl) => fl.miete && fl.miete.an === b.an).length + b.flotten.length > S.aktiv_max_je_an) return `${b.an} hat schon ${S.aktiv_max_je_an} Mietflotten (höchstens ${S.aktiv_max_je_an} zugleich)`;
      let preis = 0;
      for (const id of b.flotten) {
        const fl = flotteMit(c, id);
        if (!fl || fl.fraktion !== 'kon' || fl.miete) return `Flotte ${id} ist keine freie Flotte des Konkordats`;
        if (fl.befehl !== 'heim' || fl.ort !== fl.heimat) return `Flotte ${id} ist unterwegs`;
        preis += mietPreis(fl, b.dauer);
      }
      if (z.marken[b.an] < preis) return `Marken reichen nicht (${preis} nötig)`;
      return null;
    },
    anwenden(c, b) {
      const { z } = c;
      let summe = 0;
      for (const id of b.flotten) {
        const fl = flotteMit(c, id), preis = mietPreis(fl, b.dauer);
        z.marken[b.an] -= preis; z.marken.kon += preis;
        fl.miete = { von: 'kon', an: b.an, bis: z.tick + b.dauer, preis }; fl.fraktion = b.an;
        summe += fl.staerke;
      }
      H.melde(c, 'soeldner_vermietet', 'kon', { an: b.an, flotten: b.flotten.length, staerke: H.rund(summe), dauer: b.dauer });
    },
  },

  // SUND-04a-2 P3: germanische Sprengung eines römischen POSTENS (Station), nur aus einer Enthüllung eines Fadens (regie-befehle fadenSabotage, nie aus einem Plan des Spielleiters).
  // Ein Hafen ist keine Sprengziel (Abwehr-Verlust eines Hafens ist eine Wirkung im Gefecht, nicht dieser Befehl).
  sabotage: {
    pruefe(c, b) {
      const { z } = c;
      if (!istHex(z, b.ort)) return 'unbekannter Ort';
      if (H.istHafen(c, b.ort)) return 'Sprengung trifft nur einen Posten, nicht einen Hafen';
      if (!z.hexe[b.ort].posten) return 'Ort hat keinen Posten';
      if (z.hexe[b.ort].besitzer !== 'rom') return 'Posten gehört nicht Rom';
      if (z.hexe[b.ort].crew === true) return 'Posten der Crew ist kein Sprengziel';   // SUND-04a-2 Nacharbeit L12
      return null;
    },
    anwenden(c, b) {
      H.postenVerlieren(c, b.ort, 'rom', 'ger');
    },
  },

  piratenueberfall: {
    pruefe(c, b) {
      const { z } = c;
      if (!istHex(z, b.ort)) return 'unbekannter Ort';
      if (z.hexe[b.ort].besitzer === 'pirat') return 'Ort gehört den Piraten';
      if (z.hexe[b.ort].besitzer === null) return 'Ort hat keinen Besitzer';
      if (z.angriffe.some((r) => r.t_ende === null && r.ziel === b.ort && r.art === 'pirat')) return 'ein Überfall auf diesen Ort läuft schon';
      if (!piratFuer(c, b.ort)) return `keine bereite Piratenflotte im Piratennetz (höchstens ${W.piratenueberfall.wert.netz_sprunge} Sprünge)`;
      return null;
    },
    anwenden(c, b) {
      const { z } = c, fl = piratFuer(c, b.ort);
      const rec = H.neuerAngriff(z, { ziel: b.ort, von: 'pirat', art: 'pirat', relevant: z.hexe[b.ort].besitzer !== null, zielArt: 'posten', flotten: [fl.id], befohlen: true });
      fl.befehl = 'angriff'; fl.ziel = b.ort; fl.warte = 0; fl.angriff = rec.id;
      H.melde(c, 'flotte_aufbruch', 'pirat', { art: 'raubzug', von: fl.ort, ziel: b.ort, staerke: H.rund(fl.staerke), klasse: H.staerkeKlasse(fl.staerke, c.w), angriff: rec.id });
    },
  },

  fokus: {
    pruefe(c, b) {
      const { z } = c, F = W.fokus.wert;
      if (typeof b.fraktion !== 'string' || !F.fraktionen.includes(b.fraktion)) return `fraktion muss ${F.fraktionen.join(', ')} sein`;
      if (!istHex(z, b.hex)) return 'unbekanntes Hex';
      if (!Number.isInteger(b.radius) || b.radius < F.radius.min || b.radius > F.radius.max) return `radius muss eine ganze Zahl von ${F.radius.min} bis ${F.radius.max} sein`;
      return dauerFehler('fokus', b.dauer);
    },
    anwenden(c, b) {
      const rg = regieEintrag(c.z, b.fraktion);
      rg.fokus = { hex: b.hex, radius: b.radius, bis: c.z.tick + b.dauer };
    },
  },

  regler: {
    pruefe(c, b) {
      const R = W.regler.wert;
      if (typeof b.fraktion !== 'string' || !R.fraktionen.includes(b.fraktion)) return `fraktion muss ${R.fraktionen.join(', ')} sein`;
      const df = dauerFehler('regler', b.dauer);
      if (df) return df;
      let n = 0;
      for (const k of REGLER_FELDER) {
        if (b[k] === undefined) continue;
        n++;
        if (!istZahl(b[k]) || b[k] < R[k].min || b[k] > R[k].max) return `${k} muss eine Zahl von ${R[k].min} bis ${R[k].max} sein`;
        if (k === 'max_active' && !Number.isInteger(b[k])) return 'max_active muss ganzzahlig sein';
      }
      return n ? null : 'mindestens einer der Regler p_act, aggr, max_active';
    },
    anwenden(c, b) {
      const rg = regieEintrag(c.z, b.fraktion);
      for (const k of REGLER_FELDER) if (b[k] !== undefined) rg[k] = b[k];
      rg.regler_bis = c.z.tick + b.dauer;
    },
  },
};

// Die Standard-KI der betroffenen Fraktion hält sich nach einem Befehl für ruhe[typ] Ticks mit eigenen Reichsangriffen zurück (Daten ruhe): ein befohlener Angriff ersetzt einen der KI, statt zu ihr
// hinzuzukommen. Ohne Eintrag für den Typ geschieht nichts. Die Fraktion: fraktion (angreifen, beanspruchen, verstaerken, rueckzug), an (nachschub, soeldner) oder gegen (embargo).
function ruheSetzen(c, b) {
  const t = Math.min(W.ruhe && W.ruhe.wert[b.typ], W.ruhe_max.wert), f = b.fraktion || b.an || b.gegen;   // nie länger als ruhe_max (und die Daten-Prüfung verlangt: nie länger als die Abkühlzeit des Befehls)
  if (!(t > 0) || !REICH.includes(f)) return;
  const rg = regieEintrag(c.z, f);
  rg.ruhe_bis = Math.max(rg.ruhe_bis || 0, c.z.tick + t);
}
const mietPreis = (fl, dauer) => Math.round(fl.staerke * dauer * W.soeldner.wert.preis_je_staerke_tick);
function regieEintrag(z, f) {
  if (!z.regie) z.regie = {};
  if (!z.regie[f]) z.regie[f] = {};
  return z.regie[f];
}
function anspruchFlotte(c, b) {
  const R = W.beanspruchen.wert;
  return bereit(c, b.fraktion).filter((x) => !x.miete && x.staerke >= c.w.garrison + 1 && H.dd(c, x.ort, b.sektor) <= R.reichweite).sort((x, y) => y.staerke - x.staerke)[0] || null;
}
function piratFuer(c, ziel) {
  const { z, d } = c, P = W.piratenueberfall.wert;
  return z.flotten.filter((fl) => fl.fraktion === 'pirat' && fl.befehl === 'heim' && fl.staerke >= P.bereit_anteil * fl.kap && d.distP[fl.heimat][ziel] !== undefined && d.distP[fl.heimat][ziel] <= P.netz_sprunge)
    .sort((x, y) => y.staerke - x.staerke)[0] || null;
}

// ---------- Schnittstelle
// Prüft einen Befehl gegen den Kontext (Zustand c.z). -> { ok, grund }
function pruefeIn(c, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, grund: 'kein Befehl' };
  if (typeof b.typ !== 'string' || !has(KATALOG, b.typ)) return { ok: false, grund: `unbekannter Typ "${b.typ}"` };
  let g = felderFehler(b);
  if (!g) { try { g = KATALOG[b.typ].pruefe(c, b); } catch (e) { g = 'Prüfung fehlgeschlagen: ' + e.message; } }
  return g ? { ok: false, grund: g } : { ok: true, grund: null };
}
const kontext = (z) => ({ z, d: Daten.datenVon(z), w: z.werte, ev: [], mess: null });
function pruefe(zustand, befehl) { return pruefeIn(kontext(zustand), befehl); }

// Probelauf für den Spielaufsatz (wie Kern.filtereWirkungen): prüft der Reihe nach gegen eine Kopie, jeder gültige wird dort angewandt, so dass spätere Befehle den Stand der
// früheren sehen (z. B. zwei Angriffe auf dasselbe Ziel). Der Zustand selbst bleibt unberührt. -> { gueltig: [befehl], verworfen: [{ befehl, grund }] }
function filtere(zustand, liste) {
  const rest = Object.fromEntries(Object.entries(zustand).filter(([k]) => k !== 'werte' && k !== 'karte'));
  const probe = Object.assign(JSON.parse(JSON.stringify(rest)), { werte: zustand.werte, karte: zustand.karte });
  const c = kontext(probe);
  const gueltig = [], verworfen = [];
  for (const b of liste) {
    if (gueltig.length >= W.je_tick_max.wert) { verworfen.push({ befehl: b, grund: `mehr als ${W.je_tick_max.wert} Befehle in einem Tick` }); continue; }
    const p = pruefeIn(c, b);
    if (!p.ok) { verworfen.push({ befehl: b, grund: p.grund }); continue; }
    try { KATALOG[b.typ].anwenden(c, b); gueltig.push(b); } catch (e) { verworfen.push({ befehl: b, grund: 'Anwendung wirft: ' + e.message }); }
  }
  return { gueltig, verworfen };
}

// Im Tick: prüft erneut (der Stand hat sich durch die Wirtschaft geändert) und wendet an. Abgelehnte gehen nach c.abgelehnt, nie halb ausgeführt (Prüfung vor jeder Änderung).
function anwenden(c) {
  let n = 0;
  for (const b of c.befehle) {
    if (n >= W.je_tick_max.wert) { c.abgelehnt.push({ befehl: b, grund: `mehr als ${W.je_tick_max.wert} Befehle in einem Tick` }); continue; }
    const p = pruefeIn(c, b);
    if (!p.ok) { c.abgelehnt.push({ befehl: b, grund: p.grund }); continue; }
    KATALOG[b.typ].anwenden(c, b);
    ruheSetzen(c, b);
    c.angewandt.push(b); n++;
  }
}

// Jeden Tick, direkt nach tick += 1. Ohne embargo, regie und miete geschieht nichts. Alles Zeitliche endet hier von selbst.
function ablauf(c) {
  const z = c.z;
  if (z.embargo) {
    for (const f of Object.keys(z.embargo)) {
      if (z.tick < z.embargo[f].bis) continue;
      delete z.embargo[f];
      H.melde(c, 'embargo_beendet', 'kon', { gegen: f });
    }
    if (!Object.keys(z.embargo).length) delete z.embargo;
  }
  if (z.regie) {
    for (const f of Object.keys(z.regie)) {
      const rg = z.regie[f];
      if (rg.fokus && z.tick >= rg.fokus.bis) delete rg.fokus;
      if (rg.ruhe_bis !== undefined && z.tick >= rg.ruhe_bis) delete rg.ruhe_bis;
      if (rg.regler_bis !== undefined && z.tick >= rg.regler_bis) { for (const k of REGLER_FELDER) delete rg[k]; delete rg.regler_bis; }
      if (!Object.keys(rg).length) delete z.regie[f];
    }
    if (!Object.keys(z.regie).length) delete z.regie;
  }
  for (const fl of z.flotten) {
    if (!fl.miete || z.tick < fl.miete.bis) continue;
    const m = fl.miete;
    fl.fraktion = m.von; delete fl.miete;
    if (fl.befehl !== 'heim') {
      const rec = fl.angriff !== null ? z.angriffe.find((r) => r.id === fl.angriff) : null;
      fl.befehl = 'rueckzug'; fl.ziel = fl.heimat;
      if (rec && rec.phase === 'sammeln') fl.angriff = null;
    }
    H.melde(c, 'soeldner_zurueck', 'kon', { an: m.an, staerke: H.rund(fl.staerke) });
  }
}

// Bereinigt die Zustandsfelder der Befehle nach dem Laden aus einer Datei (embargo, regie, flotte.miete): Unsinniges fällt weg, bevor ein Tick darüber stolpert (ein wirfender Tick friert die Sim ein),
// Werte werden auf die Bereiche aus befehle-werte.json geklemmt, Zeitpunkte auf höchstens Tick + größte Dauer (kein „bis in alle Ewigkeit“ aus einer manipulierten Datei), Fraktionen nur aus der erlaubten
// Menge. Gültiges bleibt unverändert; ohne die Felder geschieht nichts.
const klemme = (v, min, max) => Math.min(max, Math.max(min, v));
function bereinige(z) {
  const t = Number.isInteger(z.tick) && z.tick >= 0 ? z.tick : 0;
  const ganzZahl = (v) => Number.isInteger(v) && v >= 0;
  const objekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const D = W.dauer.wert, RUHE_MAX = W.ruhe_max.wert;
  const FRAKTIONEN = ['rom', 'ger', 'kon'];
  if (z.embargo !== undefined) {
    const out = {};
    if (objekt(z.embargo)) {
      for (const [f, e] of Object.entries(z.embargo)) {
        if (!W.embargo.wert.gegen.includes(f) || !objekt(e) || !Array.isArray(e.waren) || !ganzZahl(e.from) || !ganzZahl(e.bis)) continue;
        const waren = e.waren.filter((g, i, l) => W.embargo.wert.waren.includes(g) && l.indexOf(g) === i);
        if (waren.length) out[f] = { waren, von: 'kon', from: Math.min(e.from, t), bis: Math.min(e.bis, t + D.embargo.max + 1) };
      }
    }
    if (Object.keys(out).length) z.embargo = out; else delete z.embargo;
  }
  if (z.regie !== undefined) {
    const out = {};
    if (objekt(z.regie)) {
      for (const [f, e] of Object.entries(z.regie)) {
        if (!FRAKTIONEN.includes(f) || !objekt(e)) continue;
        const x = {};
        for (const k of REGLER_FELDER) if (istZahl(e[k])) x[k] = klemme(e[k], W.regler.wert[k].min, W.regler.wert[k].max);
        if (x.max_active !== undefined) x.max_active = Math.round(x.max_active);
        if (ganzZahl(e.regler_bis) && Object.keys(x).length) x.regler_bis = Math.min(e.regler_bis, t + D.regler.max); else for (const k of REGLER_FELDER) delete x[k];
        if (ganzZahl(e.ruhe_bis) && RUHE_MAX > 0) x.ruhe_bis = Math.min(e.ruhe_bis, t + RUHE_MAX);
        const fk = e.fokus;
        if (W.fokus.wert.fraktionen.includes(f) && objekt(fk) && typeof fk.hex === 'string' && has(z.hexe, fk.hex) && istZahl(fk.radius) && ganzZahl(fk.bis)) {
          x.fokus = { hex: fk.hex, radius: klemme(Math.round(fk.radius), W.fokus.wert.radius.min, W.fokus.wert.radius.max), bis: Math.min(fk.bis, t + D.fokus.max) };
        }
        if (Object.keys(x).length) out[f] = x;
      }
    }
    if (Object.keys(out).length) z.regie = out; else delete z.regie;
  }
  for (const fl of z.flotten || []) {
    if (fl.miete === undefined) continue;
    const m = fl.miete;
    if (!objekt(m) || m.von !== 'kon' || !REICH.includes(m.an) || fl.fraktion !== m.an || !ganzZahl(m.bis) || !istZahl(m.preis) || m.preis < 0) delete fl.miete;
    else fl.miete = { von: 'kon', an: m.an, bis: Math.min(m.bis, t + D.soeldner.max), preis: m.preis };
  }
}

// Rückbau einer Überlagerung der Regie (Rückfall des Spielleiters): nur zustand.regie, nie zustand.absichten.
function regieRaeumen(z) { delete z.regie; }

function installiere(helfer) { H = helfer; }

module.exports = { angriffVorratFehler, nachschubVorratFehler, nachschubMengeMax, mietbar, KATALOG, FELDER, WERTE: W, REGLER_FELDER, wirksam, pruefe, pruefeIn, filtere, anwenden, ablauf, bereinige, regieRaeumen, installiere, embargoAktiv };
