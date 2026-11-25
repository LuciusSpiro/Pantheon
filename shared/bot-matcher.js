// BOT-04 A3: Matcher Text -> Bot-Befehl (UMD: window.Shared_BotMatcher / require). Reines JS ohne Abhaengigkeiten, Browser und Node.
// Vertrag: vault Pantheon/Vertrag Bot-Befehle (Katalog v1). Kein LLM, keine freie Auslegung. match() liefert { an, befehl, args, konfidenz }
// oder null (null = unklar, der Client spielt den Rueckfrage-Clip bot.unklar). Falsch erkannt ist schlimmer als nicht erkannt: im Zweifel null.
//
// Leitbild: Ein Captain lernt feste Sprechformen (content/bots/kanon.json, einzige Quelle; Taste, Menue und Sprache zeigen dieselbe Form).
// Der Matcher ist auf diese Formen optimiert, freie Formulierungen sind ein Zusatz mit niedrigerer Konfidenz.
//
// Vorbereitung: Normalisierung (klein, Umlaute, Satzzeichen), optionale Adressierung ("Navigation, ...") abtrennen, Fuellwoerter weg,
// "<Zahl> Meter" ziehen (nur nav.abstand).
// Stufe 1 (Kanon): Abgleich der Tokens gegen alle Sprechformen und Kurzformen des Kanons als Token-Alignment (Damerau-Levenshtein je Wort,
//   Koelner Phonetik bei kleinem Zeichenabstand, Zusammenziehen/Trennen benachbarter Woerter). Ein Zusatzwort kostet ein ganzes Wort:
//   Stufe 1 ist tolerant gegen Hoerfehler, nicht gegen zusaetzliche Woerter. Konfidenz = 1 - Kosten / Wortzahl, mindestens SCHWELLE.
// Stufe 2 (frei): Schluesselwort-und-Slot-Abgleich ohne Phrasenaufzaehlung (content/bots/muster.json, "befehle"): je Befehl eine Wortfamilie
//   (Verb/Substantiv), optional ein Pflichtwort ("und"), erlaubte Begleitwoerter ("mit") und Argument-Slots (Pflicht oder optional).
//   Ein Befehl gilt nur, wenn die Familie vorkommt, jedes Pflichtargument genau einen Wert hat, KEIN Wort uebrig bleibt, das keiner dieser
//   Gruppen gehoert, und genau ein Befehl diese Bedingungen erfuellt. Konfidenz hoechstens 0,92 (Kanon 1,0), darunter bei Hoerfehlern.
// Null bei: Negation, Fragewort oder Frageform ("Kannst du ...?"), Fremdsprache (fremdwoerter), mehr als 10 Woertern, Konfidenz unter der
//   Schwelle, Mehrdeutigkeit, fehlendem oder mehrdeutigem Pflichtargument (auch "Schilde Bug Heck"), Adressierung an die falsche Rolle,
//   Zahl mit "Meter" bei einem anderen Befehl als nav.abstand.
// Immer null (Review A3): Fragezeichen, Minus vor Zahl, Dezimalzahl, Meter ausserhalb 1..100000; mehrteilige Aeusserung mit unerkanntem Rest, der ein Befehls-/Slotwort
//   eines anderen Befehls traegt. Einwort-Formen (nach Fuellwoertern, z. B. "Dock an") tolerieren Auslassen/Einfuegen/Dreher/gleichklingenden Tausch, keine Phonetik allein.
//   Stufe 2: Zusammenziehen ohne Phonetik (>= 0,9), 'stamm*' nur mit Verbendung (e, en, n, ne, nen, st), Imperativ Plural (-t) nur als erstes Wort ("Waffen repariert" = Meldung).
// Nicht per Sprache waehlbar: nav.sprung, hex:<id>, objekt:<id> (weder Kanon noch Familie darf sie enthalten, Test).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else root.Shared_BotMatcher = factory(null);
})(typeof self !== 'undefined' ? self : this, function (req) {
  'use strict';

  const SCHWELLE = 0.85;
  const MARGE = 0.05;            // Abstand zwischen bestem und zweitbestem (anderen) Treffer, sonst null
  const METER_MIN = 1, METER_MAX = 100000;   // sinnvoller Bereich der Meterangabe, sonst null
  const MAX_TOKENS = 10;         // laengere Texte sind Plaudern
  const KOSTE_EXTRA_TEXT = 1;    // zusaetzliches Wort im Text (Stufe 1: ein ganzes Wort)
  const KOSTE_FEHLT = 1;         // Wort der Sprechform fehlt im Text
  const SIM_MIN = 0.7;           // darunter gilt ein Wort als falsch (Kosten 1)
  const SIM_MIN_SLOT = 0.75;     // Argumentwoerter strenger (darunter Kosten 1,5)
  const SIM_FREI = 0.85;         // Stufe 2: Mindestaehnlichkeit eines Wortes (Woerter bis 4 Zeichen aus Familie/mit: nur exakt)
  const KONF_FREI = 0.92;        // Stufe 2: Konfidenz bei lauter exakten Woertern
  // 'stamm*': nur Infinitiv-/Imperativendungen (scan -> scannen, scanne). Kein Partizip (repariert), keine Ableitung (scanner, ausweichung, ausweichend), kein Plural (scanns)
  const STAMM_ENDUNG = /^(e|en|n|ne|nen|st)?$/;
  // Imperativ Plural (repariert, kuemmert) nur als erstes Wort: Verb vorn = Befehl, Verb hinten ("Waffen repariert") = Zustandsmeldung, im Zweifel null
  const STAMM_T = /^(t|et)$/;

  // ---------- Normalisierung ----------
  function norm(s) {
    let t = String(s == null ? '' : s).toLowerCase();
    t = t.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');   // Akzente (Cours, Capitaine)
    t = t.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');            // 1.000 -> 1000
    t = t.replace(/[^a-z0-9]+/g, ' ').trim();
    return t;
  }
  let SYN = Object.create(null);   // Synonyme auf ein Leitwort (z.B. voran -> voraus), gilt fuer Text, Kanon und Familien
  function tokens(s) { const n = norm(s); return n ? n.split(' ').map((t) => SYN[t] || t) : []; }

  // ---------- Aehnlichkeit ----------
  // Damerau-Levenshtein (optimal string alignment): Buchstabendreher (zeil/ziel) kosten 1
  function lev(a, b) {
    const n = a.length, m = b.length;
    if (!n) return m; if (!m) return n;
    let pp = new Array(m + 1).fill(0), prev = new Array(m + 1), cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      for (let j = 1; j <= m; j++) {
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
        cur[j] = v;
      }
      const t = pp; pp = prev; prev = cur; cur = t;
    }
    return prev[m];
  }
  // Koelner Phonetik (Postel 1969) auf normalisierten Woertern (nur a-z, Ziffern bleiben)
  function koelner(w) {
    const s = w.replace(/[^a-z]/g, '');
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i], p = i ? s[i - 1] : '', n = s[i + 1] || '';
      let code;
      if ('aeijouy'.includes(c)) code = '0';
      else if (c === 'h') code = '';
      else if (c === 'b') code = '1';
      else if (c === 'p') code = n === 'h' ? '3' : '1';
      else if ('dt'.includes(c)) code = 'csz'.includes(n) ? '8' : '2';
      else if ('fvw'.includes(c)) code = '3';
      else if ('gkq'.includes(c)) code = '4';
      else if (c === 'c') {
        if (!i) code = 'ahkloqrux'.includes(n) ? '4' : '8';
        else code = 'sz'.includes(p) ? '8' : ('ahkoqux'.includes(n) ? '4' : '8');
      } else if (c === 'x') code = 'ckq'.includes(p) ? '8' : '48';
      else if (c === 'l') code = '5';
      else if ('mn'.includes(c)) code = '6';
      else if (c === 'r') code = '7';
      else if ('sz'.includes(c)) code = '8';
      else code = '';
      out.push(code);
    }
    let r = '';
    for (const code of out) for (const ch of code) if (ch !== r[r.length - 1]) r += ch;   // Doppelte zusammenfassen
    return r ? r[0] + r.slice(1).replace(/0/g, '') : '';
  }
  // unten/hinten klingen gleich, sind aber zwei Woerter: Phonetik gilt nur, wenn der Anfang (ohne h) gleich klingt (Vokal = derselbe Vokal)
  function anfangOk(a, b) {
    const x = a.replace(/^h/, '')[0], y = b.replace(/^h/, '')[0];
    return x === y || (!'aeiou'.includes(x) && !'aeiou'.includes(y));
  }
  function teilfolge(kurz, lang) { let i = 0; for (const c of lang) if (c === kurz[i]) i++; return i === kurz.length; }
  let NIE_AEHNLICH = new Set();   // Woerter, die nur exakt gelten (z.B. "back": Bug oder Backbord, nie raten)
  const simCache = new Map();
  // Aehnlichkeit zweier Woerter 0..1. Kurze Woerter (bis 3 Zeichen) nur exakt; Ziffern nur exakt.
  function wortSim(a, b, ohnePhon) {
    if (a === b) return 1;
    const key = a + '|' + b + (ohnePhon ? '|l' : '');
    const c = simCache.get(key);
    if (c !== undefined) return c;
    let r;
    const mn = Math.min(a.length, b.length), mx = Math.max(a.length, b.length);
    if (/\d/.test(a) || /\d/.test(b) || NIE_AEHNLICH.has(a) || NIE_AEHNLICH.has(b)) r = 0;
    else if (mn <= 3) {
      // Kurze Woerter: nur exakt, ausser bei genau 3 Zeichen, gleichem Anfangsbuchstaben und (gleicher Klang oder genau eine Auslassung:
      // "buk"/"bug", "nul"/"null", "fei"/"frei"). Anderer Anfangsbuchstabe (unten/hinten) zaehlt nie.
      r = 0;
      if (mn === 3 && mx <= 5 && a[0] === b[0]) {
        const ka = koelner(a);
        if (!ohnePhon && ka.length >= 2 && ka === koelner(b)) r = 0.88;
        else if (mx === 4 && (a.length === 3 ? teilfolge(a, b) : teilfolge(b, a))) r = 0.8;
      }
    } else {
      const l = 1 - lev(a, b) / mx;
      r = l;
      if (!ohnePhon && l >= 0.6 && anfangOk(a, b)) { const ka = koelner(a); if (ka.length >= 2 && ka === koelner(b)) r = Math.max(r, 0.88); }
    }
    if (simCache.size > 50000) simCache.clear();
    simCache.set(key, r);
    return r;
  }

  // ---------- Daten laden und bauen ----------
  let MUSTER = null;     // roh (muster.json)
  let KANON = null;      // roh (kanon.json)
  let FIGUREN = null;    // roh (figuren.json, BOT-05 A2): die Figurnamen sind Adressen fuer ihre botId; einzige Quelle der Namen
  let GEL = null;        // gebaut
  let nodeLaden = null;  // in Node: Dateien laden, wenn nichts gesetzt wurde
  if (req) {
    nodeLaden = function (name) {
      const fs = req('fs'), path = req('path');
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', name), 'utf8'));
    };
  }

  function zuWert(w) { return isNaN(Number(w)) || w === '' ? w : Number(w); }
  function sortiert(o) { const r = {}; for (const k of Object.keys(o || {}).sort()) r[k] = o[k]; return r; }

  // Kanon -> flache Liste konkreter Sprechformen: { befehl, an, args, anzeige, kurz[], meter }. Schablone {name} in args/anzeige/kurz
  // wird je Wert aus 'werte.<name>' ausgefuellt (wort = Hauptform, kurz = ganze Kurzformen des Wertes). Auch fuer Menue/Tastenbeschriftung.
  function kanonFormen(kanon) {
    const out = [];
    for (const e of (kanon && kanon.befehle) || []) {
      const schablonen = Object.keys(e.args || {}).filter((k) => typeof e.args[k] === 'string' && /^\{[a-z_]+\}$/.test(e.args[k]));
      if (schablonen.length > 1) throw new Error('Kanon: mehr als eine Schablone in ' + e.befehl);
      const basis = { befehl: e.befehl, an: e.an, meter: !!e.meter };
      if (!schablonen.length) { out.push(Object.assign(basis, { args: Object.assign({}, e.args || {}), anzeige: e.anzeige, kurz: (e.kurz || []).slice() })); continue; }
      const key = schablonen[0], name = e.args[key].slice(1, -1);
      const werte = e.werte && e.werte[name];
      if (!werte) throw new Error('Kanon: keine werte.' + name + ' in ' + e.befehl);
      for (const wert of Object.keys(werte)) {
        const w = werte[wert];
        const args = Object.assign({}, e.args); args[key] = zuWert(wert);
        const ein = (t) => t.split('{' + name + '}').join(w.wort);
        out.push(Object.assign({}, basis, { args, anzeige: ein(e.anzeige), kurz: (e.kurz || []).map(ein).concat(w.kurz || []) }));
      }
    }
    return out;
  }

  // Wortmuster der Familien: 'stamm*' (Wortanfang), 'a b' (Gruppe: alle Woerter)
  function wortMuster(p) {
    const out = [];
    for (const roh of p.trim().split(/\s+/)) {
      const stamm = /\*$/.test(roh);
      for (const t of tokens(roh.replace(/\*/g, ''))) out.push({ w: t, stamm, strikt: true });
    }
    return out;
  }
  function gruppen(liste) { return (liste || []).map((p) => wortMuster(p)).filter((g) => g.length); }

  // BOT-05 A2: { b0: ['livia'], ... } normalisiert aus figuren.json (eine Figur = ein Name = ein Adresswort)
  function figurNamen(figuren) {
    const out = {};
    for (const f of (figuren && figuren.figuren) || []) { const w = norm(f.name); if (w) out[f.botId] = [w]; }
    return out;
  }

  function bauen(muster, kanon, figuren) {
    SYN = Object.create(null); for (const k of Object.keys(muster.synonyme || {})) SYN[norm(k)] = norm(muster.synonyme[k]);
    const fuell = new Set((muster.fuellwoerter || []).map(norm));
    const neg = new Set((muster.negation || []).map(norm));
    const frage = new Set((muster.fragewoerter || []).map(norm));
    const modal = new Set((muster.fragemodale || []).map(norm));
    const fremd = new Set((muster.fremdwoerter || []).map(norm));
    NIE_AEHNLICH = new Set((muster.nie_aehnlich || []).map(norm));
    const hinten = new Set((muster.adressierung_hinten || []).map(norm));
    const adressen = [];
    for (const rolle of Object.keys(muster.adressierung || {})) for (const w of muster.adressierung[rolle]) adressen.push({ w: norm(w), an: rolle, name: false });
    const namen = figurNamen(figuren);   // Namen sind Adressen, keine Sprechformen: sie kommen aus figuren.json, nicht aus dem Kanon
    for (const id of Object.keys(muster.namen || {})) for (const w of muster.namen[id]) adressen.push({ w: norm(w), an: id, name: true });
    for (const id of Object.keys(namen)) for (const w of namen[id]) { adressen.push({ w, an: id, name: true }); hinten.add(w); }   // ein Name steht auch ohne Komma hinten ("Schilde Steuerbord Titus"): so eindeutig wie ein Rollenwort
    const ohneFuell = (arr) => arr.filter((t) => !fuell.has(t));

    // Slots (Argumentvokabular): Aliase als Tokenfolgen, laengste zuerst
    const slots = {};
    for (const k of Object.keys(muster.slots || {})) {
      const s = muster.slots[k]; const aliase = [];
      for (const wert of Object.keys(s.werte)) for (const al of s.werte[wert]) {
        const t = ohneFuell(tokens(al)); if (t.length) aliase.push({ wert, toks: t });
      }
      aliase.sort((x, y) => y.toks.length - x.toks.length);
      slots[k] = { arg: s.arg, aliase };
    }

    // Stufe 1: Sprechformen des Kanons
    const formen = []; const seen = new Set();
    for (const f of kanonFormen(kanon)) {
      const texte = [f.anzeige].concat(f.kurz);
      texte.forEach((text, idx) => {
        const toks = [];
        // Woerter der Hauptform, die ein Argument sind, werden strenger verglichen: in der Hauptform steht das Argumentwort am Ende der Schablone
        for (const raw of ohneFuell(tokens(text))) toks.push({ w: raw, slot: false });
        if (!toks.length) return;
        // Argumentwoerter markieren: Woerter, die in einem Alias eines Slots des Befehls stehen
        for (const t of toks) if (Object.keys(f.args).length && argWort(slots, f.args, t.w)) t.slot = true;
        const key = f.befehl + '|' + toks.map((t) => t.w).join(' ') + '|' + JSON.stringify(sortiert(f.args));
        if (seen.has(key)) return; seen.add(key);
        formen.push({ befehl: f.befehl, an: f.an, meter: f.meter, toks, args: f.args, argKey: JSON.stringify(sortiert(f.args)), haupt: idx === 0 });
      });
    }

    // Stufe 2: Wortfamilien
    const fam = {};
    for (const befehl of Object.keys(muster.befehle || {})) {
      const d = muster.befehle[befehl];
      fam[befehl] = {
        an: d.an || 'alle', familie: gruppen(d.familie), und: gruppen(d.und), mit: gruppen(d.mit).filter((g) => g.length === 1),
        pflicht: d.pflicht || [], optional: d.optional || [], mind: d.mind || 1, meterErsetztUnd: !!d.meter_ersetzt_und,
      };
      for (const s of fam[befehl].pflicht.concat(fam[befehl].optional)) if (!slots[s]) throw new Error('Muster: unbekannter Slot ' + s + ' in ' + befehl);
    }
    // Kennwoerter: alles, was zum Vokabular irgendeines Befehls gehoert (Familienwoerter, Slot-Aliase). Ein unerkannter Teil einer mehrteiligen
    // Aeusserung darf keines enthalten (sonst wuerde still nur der andere Teil ausgefuehrt).
    const kenn = [];
    for (const b of Object.keys(fam)) for (const gr of fam[b].familie) if (gr.length === 1 && gr[0].w.length > 3) kenn.push(gr[0]);   // kurze Familienwoerter (los, aus) sind Fuellsel am Satzende   // Mehrwortgruppen (feuer aus) nur als Ganzes, ihre Einzelwoerter (aus) sind kein Befehlsbeleg
    for (const k of Object.keys(slots)) for (const al of slots[k].aliase) for (const w of al.toks) kenn.push({ w, stamm: false, strikt: true });
    return { fuell, neg, frage, modal, fremd, adressen, hinten, formen, fam, slots, kenn };
  }
  // Ist das Wort Teil eines Alias, dessen Wert zu einem Argument des Befehls passt? Grob: Wort kommt in irgendeinem Slot-Alias vor, dessen Wert
  // (als Text) in den Argumenten des Befehls steht.
  function argWort(slots, args, w) {
    const werte = Object.keys(args).map((k) => String(args[k]));
    for (const k of Object.keys(slots)) for (const al of slots[k].aliase) if (werte.includes(al.wert) && al.toks.includes(w)) return true;
    return false;
  }

  function setzeKanon(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.befehle)) throw new Error('setzeKanon: ungueltige Kanondaten');
    kanonFormen(obj);   // prueft die Struktur
    KANON = obj; GEL = null;
  }
  function setzeFiguren(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.figuren)) throw new Error('setzeFiguren: ungueltige Figurendaten');
    for (const f of obj.figuren) if (!f || typeof f.botId !== 'string' || typeof f.name !== 'string') throw new Error('setzeFiguren: Figur ohne botId oder Name');
    FIGUREN = obj; GEL = null;
  }
  // setzeMuster(obj): obj kann zusaetzlich 'kanon' und 'figuren' tragen (Browser: ein Aufruf mit allen Dateien)
  function setzeMuster(obj) {
    if (!obj || typeof obj !== 'object' || !obj.befehle) throw new Error('setzeMuster: ungueltige Musterdaten');
    if (obj.kanon) setzeKanon(obj.kanon);
    if (obj.figuren) setzeFiguren(obj.figuren);
    MUSTER = obj; GEL = null; simCache.clear();
  }
  function geladen() {
    if (!GEL) {
      if (!MUSTER) { if (!nodeLaden) throw new Error('Bot-Matcher: keine Muster gesetzt (setzeMuster)'); MUSTER = nodeLaden('muster.json'); }
      if (!KANON) { if (!nodeLaden) throw new Error('Bot-Matcher: kein Kanon gesetzt (setzeKanon)'); KANON = nodeLaden('kanon.json'); }
      if (!FIGUREN) { if (!nodeLaden) throw new Error('Bot-Matcher: keine Figuren gesetzt (setzeFiguren)'); FIGUREN = nodeLaden('figuren.json'); }
      GEL = bauen(MUSTER, KANON, FIGUREN);
    }
    return GEL;
  }

  // ---------- Stufe 1: Kanon ----------
  // Einwort-Formen: Auslassen, Einfuegen und Dreher sind Hoerfehler (andocke, andcoken), ein Buchstabentausch ist meist ein anderes Wort (abdocken, scanner)
  function einwortOk(a, b) {
    if (a === b) return true;
    if (a.length > b.length && /end$/.test(a) && !/end$/.test(b)) return false;   // Partizip I (ausweichend)
    if (a.length !== b.length) return true;
    let d = 0, k = -1; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { d++; k = i; }
    return d !== 1 || gleichKlang(a[k], b[k]);   // Dreher (d = 2) und gleichklingender Tausch (k/c, o/u, n/m) sind Hoerfehler
  }
  const KLANG = { b: 1, p: 1, d: 2, t: 2, f: 3, v: 3, w: 3, c: 4, k: 4, g: 4, q: 4, l: 5, m: 6, n: 6, r: 7, s: 8, z: 8 };
  function gleichKlang(x, y) { const vx = 'aeiouy'.includes(x), vy = 'aeiouy'.includes(y); if (vx || vy) return vx && vy; return KLANG[x] !== undefined && KLANG[x] === KLANG[y]; }
  function subKosten(a, b, slot, ohnePhon, vorn) {
    if (ohnePhon && !einwortOk(a, b)) return 1;
    // Zustandsmeldung statt Befehl: "repariert" (Partizip, auf -t) gegen die Kanonform "reparieren" gilt nur als erstes Wort ("Repariert den Antrieb", Imperativ Plural)
    if (!vorn && a.length > 3 && a.endsWith('t') && /(en|n)$/.test(b) && a.slice(0, -1) === b.slice(0, b.endsWith('en') ? -2 : -1)) return 1;
    const s = wortSim(a, b, ohnePhon);
    if (slot) return s >= SIM_MIN_SLOT ? 1 - s : 1.5;
    return s >= SIM_MIN ? 1 - s : 1;
  }
  // maxKosten: Abbruch (Infinity), sobald zwei aufeinanderfolgende Zeilen alle darueber liegen
  function ausrichten(T, P, maxKosten) {
    // Einwort-Form (Fuellwoerter wie "an" sind weg, "Dock an" -> "dock"): kein Zusatzwort stuetzt den Treffer, Phonetik allein reicht nicht (Deck != Dock)
    const ohnePhon = P.length === 1;
    const n = T.length, m = P.length;
    const D = [];
    for (let i = 0; i <= n; i++) { D.push(new Array(m + 1).fill(Infinity)); }
    D[0][0] = 0;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= m; j++) {
        if (i === 0 && j === 0) continue;
        let best = Infinity;
        if (i > 0) best = Math.min(best, D[i - 1][j] + KOSTE_EXTRA_TEXT);
        if (j > 0) best = Math.min(best, D[i][j - 1] + KOSTE_FEHLT);
        if (i > 0 && j > 0) best = Math.min(best, D[i - 1][j - 1] + subKosten(T[i - 1], P[j - 1].w, P[j - 1].slot, ohnePhon, i === 1));
        if (i > 1 && j > 0) {   // zwei Textwoerter = ein Formwort ("steuer bord")
          const s = wortSim(T[i - 2] + T[i - 1], P[j - 1].w, true);
          if (s >= 0.85) best = Math.min(best, D[i - 2][j - 1] + (1 - s) + 0.05);
        }
        if (i > 0 && j > 1) {   // ein Textwort = zwei Formwoerter ("zieldrehen")
          const s = wortSim(T[i - 1], P[j - 2].w + P[j - 1].w, true);
          if (s >= 0.85) best = Math.min(best, D[i - 1][j - 2] + (1 - s) + 0.05);
        }
        D[i][j] = best;
      }
      if (i > 0) { let mn = Infinity; for (let j = 0; j <= m; j++) { if (D[i][j] < mn) mn = D[i][j]; if (D[i - 1][j] < mn) mn = D[i - 1][j]; } if (mn > maxKosten) return Infinity; }
    }
    return D[n][m];
  }
  // Ergebnis: { score, p } | 'mehrdeutig' | null
  function stufe1(g, toks, mz, schwelle) {
    const beste = new Map();
    const n = toks.length;
    const wortOk = new Map();   // Formwort -> kommt im Text (oder zusammengezogen/als Teil eines Textworts) ungefaehr vor
    const ok = (w) => {
      let r = wortOk.get(w);
      if (r === undefined) {
        r = false;
        for (let i = 0; i < n && !r; i++) {
          if (wortSim(toks[i], w) >= SIM_MIN || (w.length >= 3 && toks[i].includes(w))) r = true;
          else if (i + 1 < n && wortSim(toks[i] + toks[i + 1], w) >= 0.8) r = true;
        }
        wortOk.set(w, r);
      }
      return r;
    };
    for (const p of g.formen) {
      if (mz.meter != null && !p.meter) continue;   // mit Meterangabe nur nav.abstand
      const m = p.toks.length;
      if (Math.abs(m - n) > 3) continue;
      let fehlt = 0; const erlaubt = Math.floor((1 - (schwelle - MARGE)) * Math.max(m, n)) + 1;
      for (const t of p.toks) if (!ok(t.w) && ++fehlt > erlaubt) break;
      if (fehlt > erlaubt) continue;
      const kosten = ausrichten(toks, p.toks, (1 - (schwelle - MARGE)) * Math.max(m, n));
      const score = 1 - kosten / Math.max(m, n);
      if (score < schwelle - MARGE) continue;   // nur Kandidaten, die die Mehrdeutigkeitspruefung betreffen koennen
      const key = p.befehl + '|' + p.argKey;
      const alt = beste.get(key);
      if (!alt || score > alt.score) beste.set(key, { score, p });
    }
    if (!beste.size) return null;
    const liste = Array.from(beste.values()).sort((a, b) => b.score - a.score);
    const top = liste[0];
    if (top.score < schwelle) return null;
    if (liste.length > 1 && top.score - liste[1].score < MARGE) return 'mehrdeutig';
    return top;
  }

  // ---------- Stufe 2: Schluesselwort und Slot ----------
  // Passt Textwort t auf Muster w? Rueckgabe Aehnlichkeit 0..1
  function passt(t, m, pos) {
    if (m.stamm) { if (m.w.length < 3 || !t.startsWith(m.w)) return 0; const rest = t.slice(m.w.length); return STAMM_ENDUNG.test(rest) || (pos === 0 && STAMM_T.test(rest)) ? 1 : 0; }
    if (m.strikt && m.w.length <= 4) return t === m.w ? 1 : 0;   // kurze Strukturwoerter (alle, kurs, halt) nie raten ("all" ist nicht "alle")
    const s = wortSim(t, m.w);
    return s >= SIM_FREI ? s : 0;
  }
  // Beste Fundstelle eines Wortmusters: { idx:[...], sim } | null (einzelnes Textwort oder zwei zusammengezogene)
  function finde(toks, m) {
    let best = null;
    for (let i = 0; i < toks.length; i++) {
      const s = passt(toks[i], m, i);
      if (s && (!best || s > best.sim)) best = { idx: [i], sim: s };
      if (!m.stamm && i + 1 < toks.length && m.w.length >= 6) {
        const z = wortSim(toks[i] + toks[i + 1], m.w, true);
        if (z >= 0.9 && (!best || z - 0.05 > best.sim)) best = { idx: [i, i + 1], sim: z - 0.05 };
      }
    }
    return best;
  }
  // Gruppe: alle Wortmuster muessen vorkommen (verschiedene Textwoerter)
  function findeGruppe(toks, gruppe) {
    const idx = []; let sim = 1;
    for (const m of gruppe) {
      const r = finde(toks, m);
      if (!r) return null;
      idx.push(...r.idx); sim = Math.min(sim, r.sim);
    }
    return { idx, sim };
  }
  // Alle Alias-Fundstellen eines Slots, laengste zuerst, ohne Ueberlappung. Rueckgabe { werte:Set, idx:Set, sim }
  function findeSlot(slot, toks) {
    const kand = [];
    for (const al of slot.aliase) {
      const L = al.toks.length;
      for (let i = 0; i + L <= toks.length; i++) {
        let sim = 1, gut = true;
        for (let j = 0; j < L && gut; j++) { const s = passt(toks[i + j], { w: al.toks[j], stamm: false }); if (!s) gut = false; else sim = Math.min(sim, s); }
        if (gut) kand.push({ wert: al.wert, i, len: L, sim });
      }
      if (L === 1) for (let i = 0; i + 1 < toks.length; i++) {   // "steuer bord"
        const z = wortSim(toks[i] + toks[i + 1], al.toks[0], true);
        if (al.toks[0].length >= 6 && z >= 0.9) kand.push({ wert: al.wert, i, len: 2, sim: z - 0.05 });
      }
    }
    kand.sort((a, b) => b.len - a.len || b.sim - a.sim || a.i - b.i);
    const belegt = new Set(); const werte = new Set(); let sim = 1;
    for (const k of kand) {
      let frei = true; for (let j = 0; j < k.len; j++) if (belegt.has(k.i + j)) frei = false;
      if (!frei) continue;
      for (let j = 0; j < k.len; j++) belegt.add(k.i + j);
      werte.add(k.wert); sim = Math.min(sim, k.sim);
    }
    return { werte, idx: belegt, sim };
  }
  // Liefert { befehl, an, args, konfidenz } | null; mehrere erfuellte Befehle oder Argumentkonflikt -> 'mehrdeutig'
  function stufe2(g, toks, mz) {
    const erg = new Map();
    for (const befehl of Object.keys(g.fam)) {
      const f = g.fam[befehl];
      if (mz.meter != null && befehl !== 'nav.abstand') continue;
      const erklaert = new Set(); let sim = 1;
      // Familie: mindestens eine Gruppe; alle zutreffenden Gruppen erklaeren ihre Woerter
      let famOk = false;
      for (const gr of f.familie) { const r = findeGruppe(toks, gr); if (r) { famOk = true; r.idx.forEach((i) => erklaert.add(i)); sim = Math.min(sim, r.sim); } }
      if (!famOk) continue;
      if (f.und.length && !(f.meterErsetztUnd && mz.meter != null)) {
        let undOk = false;
        for (const gr of f.und) { const r = findeGruppe(toks, gr); if (r) { undOk = true; r.idx.forEach((i) => erklaert.add(i)); sim = Math.min(sim, r.sim); } }
        if (!undOk) continue;
      }
      const args = {}; let gut = true;
      for (const [liste, pflicht] of [[f.pflicht, true], [f.optional, false]]) {
        for (const sn of liste) {
          const r = findeSlot(g.slots[sn], toks);
          if (r.werte.size > 1 || (pflicht && r.werte.size === 0)) { gut = false; break; }
          if (r.werte.size === 1) { args[g.slots[sn].arg] = zuWert(Array.from(r.werte)[0]); r.idx.forEach((i) => erklaert.add(i)); sim = Math.min(sim, r.sim); }
        }
        if (!gut) break;
      }
      if (!gut) continue;
      for (let i = 0; i < toks.length; i++) {
        if (erklaert.has(i)) continue;
        for (const gr of f.mit) { const s = passt(toks[i], gr[0], i); if (s) { erklaert.add(i); sim = Math.min(sim, s); break; } }
      }
      if (erklaert.size < toks.length || erklaert.size < f.mind) continue;   // Rest = Wort ausserhalb der Befehlsgruppen: im Zweifel null
      const konf = KONF_FREI - 0.3 * (1 - sim);
      erg.set(befehl + '|' + JSON.stringify(sortiert(args)), { befehl, an: f.an, args, konf });
    }
    if (!erg.size) return null;
    if (erg.size > 1) return 'mehrdeutig';
    return Array.from(erg.values())[0];
  }

  // ---------- Zahlwoerter ----------
  // Deutsche Zahlwoerter 1..9999 ("fuenfzig", "zweihundertzwanzig", "tausendfuenfhundert", "einundzwanzig"); sonst null
  const EINER = Object.assign(Object.create(null), { ein: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 });
  const ZEHNER = Object.assign(Object.create(null), { zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 });
  function zahlwort(w) {
    if (!w) return null;
    let rest = w, summe = 0;
    const m = /^(.*?)tausend/.exec(rest);
    if (m) { const f = m[1] === '' ? 1 : unter100(m[1]) || hunderter(m[1]); if (!f) return null; summe += f * 1000; rest = rest.slice(m[0].length); }
    if (rest) { const h = hunderter(rest); if (h == null) return null; summe += h; }
    return summe > 0 ? summe : null;
  }
  function hunderter(s) {
    const m = /^(.*?)hundert(.*)$/.exec(s);
    if (!m) return unter100(s);
    const f = m[1] === '' ? 1 : EINER[m[1]];
    if (!f) return null;
    const r = m[2] === '' ? 0 : unter100(m[2]);
    return r == null ? null : f * 100 + r;
  }
  function unter100(s) {
    if (s in EINER) return EINER[s];
    if (s in ZEHNER) return ZEHNER[s];
    const m = /^(.+)und(.+)$/.exec(s);
    if (m && EINER[m[1]] && ZEHNER[m[2]] >= 20) return EINER[m[1]] + ZEHNER[m[2]];
    return null;
  }
  // Meter aus dem Text ziehen ("500 meter", "fuenfhundert meter"); liefert { rest, meter } (meter null, wenn keine Angabe)
  function meterZiehen(toks) {
    for (let i = 0; i < toks.length - 1; i++) {
      if (toks[i + 1] !== 'meter' && toks[i + 1] !== 'metern') continue;
      let v = null;
      if (/^\d+$/.test(toks[i])) v = Number(toks[i]);
      else v = zahlwort(toks[i]);
      if (v != null && v > 0) return { ungueltig: v < METER_MIN || v > METER_MAX, rest: toks.slice(0, i).concat(toks.slice(i + 2)), meter: v };
    }
    return { rest: toks, meter: null };
  }

  // ---------- match ----------
  // Mehrteilige Aeusserung ("Maschinen aus, Stopp", "Anlegen und andocken", "Nach Hause, Kurs auf die Basis"): erst der ganze Text, sonst
  // die Teile (Komma/Satzzeichen/"und"). Gilt nur, wenn mindestens ein Teil trifft, alle treffenden Teile denselben Befehl mit denselben
  // Argumenten liefern und die nicht treffenden Teile hoechstens drei Inhaltswoerter haben (sonst Plaudern: null).
  // Immer null: Fragezeichen (Rueckfrage ist billiger als ein falscher Befehl; Whisper setzt es nach Intonation), Minus vor einer Zahl
  // ("Schub -1": das Minus darf nicht verschluckt werden), Dezimalzahl ("2,5 Meter"; Tausenderpunkt 1.000 ist schon normalisiert).
  function unzulaessig(roh) {
    return roh.indexOf('?') >= 0 || /(^|[^0-9a-zA-Z])[-−–—]\s?\d/.test(roh) || /\d[.,]\d/.test(roh.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2'));
  }
  function match(text, opts) {
    if (unzulaessig(String(text == null ? '' : text))) return null;
    const r = matchGanz(text, opts);
    if (r) return r;
    const g = geladen();
    const roh = String(text == null ? '' : text);
    if (!/[,;.!?]|\bund\b/i.test(roh)) return null;
    for (const t of tokens(roh)) if (g.neg.has(t) || g.frage.has(t) || g.fremd.has(t)) return null;
    const teile = roh.split(/\s*(?:[,;.!?]+|\bund\b)\s*/i).filter((p) => norm(p));
    if (teile.length < 2 || teile.length > 3) return null;
    let erg = null, kmin = 1, rolle = null, nameAn = null; const unklar = [];
    for (const teil of teile) {
      const tt = tokens(teil);
      if (tt.length === 1) {   // reines Rollenwort ("Technik, ..."): gilt fuer den ganzen Text
        const a = g.adressen.find((x) => !x.name && wortSim(tt[0], x.w) >= 0.85);
        if (a) { rolle = a.an; continue; }
        const nm = g.adressen.find((x) => x.name && wortSim(tt[0], x.w) >= 0.85);   // BOT-05 A2: ein Name allein als Teil ("Livia, bitte, Schilde Steuerbord") adressiert wie vorn: die Figur, nie still eine Rolle
        if (nm) { if (nameAn && nameAn !== nm.an) return null; nameAn = nm.an; continue; }
      }
      const x = matchGanz(teil, opts);
      if (x) {
        if (erg && (erg.befehl !== x.befehl || JSON.stringify(sortiert(erg.args)) !== JSON.stringify(sortiert(x.args)))) return null;
        if (!erg || (x.an !== 'alle' && erg.an === 'alle')) erg = x;
        kmin = Math.min(kmin, x.konfidenz);
      } else {
        const rest = tokens(teil).filter((t) => !g.fuell.has(t));
        if (rest.length > 3) return null;
        unklar.push(rest);
      }
    }
    // Ein nicht erkannter Teil darf kein Befehls- oder Argumentwort enthalten, weder des erkannten noch eines anderen Befehls ("Energie auf Antrieb
    // und Kurs auf das Ziel": der erste Teil ist unklar, enthaelt aber Energie/Antrieb, also null statt nur Kurs). "Torpedo klar und Feuer frei": Torpedo gehoert zum Befehl.
    if (erg && g.fam[erg.befehl]) {
      const f = g.fam[erg.befehl];
      for (const rest of unklar) for (const sn of f.pflicht.concat(f.optional)) if (findeSlot(g.slots[sn], rest).werte.size) return null;
      const eigen = [].concat(f.familie, f.und, f.mit).reduce((x, y) => x.concat(y), []);
      for (const rest of unklar) for (let i = 0; i < rest.length; i++) {
        if (eigen.some((m) => passt(rest[i], m, i))) continue;
        if (g.kenn.some((m) => passt(rest[i], m, i))) return null;
      }
    } else if (erg) for (const rest of unklar) for (let i = 0; i < rest.length; i++) if (g.kenn.some((m) => passt(rest[i], m, i))) return null;
    if (erg && !nameAn && rolle && erg.an !== 'alle' && rolle !== 'alle' && rolle !== erg.an) return null;   // falsche Rolle angesprochen (ein Name geht ohne Rollenpruefung durch: der Server lehnt eine falsche Rolle ab)
    if (erg && nameAn) return Object.assign({}, erg, { an: nameAn, konfidenz: kmin });
    return erg ? Object.assign({}, erg, { konfidenz: kmin }) : null;
  }
  function matchGanz(text, opts) {
    const g = geladen();
    const schwelle = opts && typeof opts.schwelle === 'number' ? opts.schwelle : SCHWELLE;
    const roh = String(text == null ? '' : text);
    let toks = tokens(roh);
    const nachKomma = /,\s*([^,\s]+)\s*[.!?]*\s*$/.exec(roh);   // "..., Navigation": Adressierung hinten, nur mit Komma ("an Bord" bleibt Inhalt)
    if (!toks.length || toks.length > MAX_TOKENS + 3) return null;
    if (unzulaessig(roh)) return null;
    for (const t of toks) if (g.neg.has(t) || g.frage.has(t) || g.fremd.has(t)) return null;   // fremd: englische Funktionswoerter ("stop the engines")

    // Adressierung (erstes oder letztes Wort)
    let an = null, anName = false;
    if (nachKomma && toks.length > 1) {
      const w = norm(nachKomma[1]);
      let bestT = null, sT = 0.85;
      for (const a of g.adressen) { const s = wortSim(w, a.w); if (s >= sT) { sT = s; bestT = a; } }
      if (bestT && toks[toks.length - 1] === w) { an = bestT.an; anName = bestT.name; toks = toks.slice(0, -1); }
    }
    if (!an && toks.length > 2 && g.hinten.has(toks[toks.length - 1])) {   // "Feuer frei Ops": nur eindeutige Rollenwoerter, mindestens zwei Woerter davor
      const a = g.adressen.find((x) => x.w === toks[toks.length - 1]);
      if (a) { an = a.an; anName = a.name; toks = toks.slice(0, -1); }
    }
    if (!an && toks.length > 1) {
      let bestA = null, bestS = 0.85;
      for (const a of g.adressen) { const s = wortSim(toks[0], a.w); if (s >= bestS) { bestS = s; bestA = a; } }
      if (bestA) { an = bestA.an; anName = bestA.name; toks = toks.slice(1); }
    }
    const mz = meterZiehen(toks);
    if (mz.ungueltig) return null;
    toks = mz.rest.filter((t) => !g.fuell.has(t));
    if (!toks.length || toks.length > MAX_TOKENS) return null;

    // Stufe 1 (Kanon), dann Stufe 2 (frei)
    let befehl, hanAn, args, konf;
    const s1 = stufe1(g, toks, mz, schwelle);
    if (s1 === 'mehrdeutig') return null;
    if (s1) { befehl = s1.p.befehl; hanAn = s1.p.an; args = Object.assign({}, s1.p.args); konf = Math.round(s1.score * 1000) / 1000; }
    else {
      const s2 = stufe2(g, toks, mz);
      if (!s2 || s2 === 'mehrdeutig') return null;
      if (s2.konf < schwelle) return null;
      befehl = s2.befehl; hanAn = s2.an; args = s2.args; konf = Math.round(s2.konf * 1000) / 1000;
    }
    // Rolle
    if (an && !anName && hanAn !== 'alle' && an !== hanAn) return null;
    if (an && !anName && hanAn === 'alle' && an === 'alle') an = 'alle';
    if (mz.meter != null) { if (befehl !== 'nav.abstand') return null; args.meter = mz.meter; }
    return { an: an || hanAn, befehl, args, konfidenz: konf };
  }

  // Test/Menue: Sprechformen (flach) und Anzahl je Befehl
  function formen() { return kanonFormen(geladen() && KANON); }
  function info() { const g = geladen(); const b = {}; for (const p of g.formen) b[p.befehl] = (b[p.befehl] || 0) + 1; return { muster: g.formen.length, befehle: b, familien: Object.keys(g.fam) }; }

  return { match, SCHWELLE, setzeMuster, setzeKanon, setzeFiguren, formen, kanonFormen, info, _intern: { norm, koelner, wortSim } };
});
