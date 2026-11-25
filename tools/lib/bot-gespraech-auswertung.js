'use strict';
// BOT-05 B3: Auswertung der Gespraechsantworten gegen die echten Zustandswerte (reine Funktionen, kein Netz, kein Spiel).
//   zahlen(text)                         alle Zahlen im Text (Ziffern, Dezimalkomma, ausgeschriebene Zahlwoerter bis 999) mit Einheit und Position
//   kursUrteil(antwort, sollGrad)        { urteil: 'richtig'|'falsch'|'ausweichend', genannt, abweichungen }
//   schildeUrteil(antwort, sollSektoren) dasselbe fuer die Schilde (Soll { bug, steuerbord, heck, backbord } in Prozent)
//   zusagen(antwort)                     Fundstellen, die eine Ausfuehrung behaupten oder zusagen (Heuristik, Wortlaut)
//   median(liste), perzentil(liste, p)   fuer die Latenz
// Regeln: Kurs: genannte Zahlen (mit Grad oder ohne Einheit; Prozent, Meter, Sekunden zaehlen nicht) muessen alle dem Soll entsprechen (360 = 0), Abweichung 0.
//   Schilde: je Satzteil (Trennung an , ; . : ! ? und Zeilenumbruch) werden genannte Sektoren und Zahlen zugeordnet (gleich viele: der Reihe nach; eine Zahl: fuer alle
//   Sektoren des Teils); eine Zahl ohne Sektor gilt pauschal fuer alle vier Sektoren. Jeder genannte Wert muss stimmen, mindestens einer muss genannt sein.
//   Ohne genannten Wert (auch "ungefaehr Sueden", "voll", "leer") ist die Antwort ausweichend.
const EINER = { null: 0, eins: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
const ZEHNER = { zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
const HAT = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ohneUmlaut = (w) => w.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const ENTH = { ein: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };

// Zahlwort (ohne Umlaut, klein) -> Zahl oder null. Ein einzelnes "ein/eine" ist keine Zahl ("ein Schild"), nur in Zusammensetzungen.
function wortZahl(w) {
  if (w === 'hundert' || w === 'einhundert') return 100;
  if (HAT(EINER, w)) return EINER[w];
  if (HAT(ZEHNER, w)) return ZEHNER[w];
  let rest = w, summe = 0;
  const h = /^(ein|zwei|drei|vier|fuenf|sechs|sieben|acht|neun)?hundert(.*)$/.exec(rest);
  if (h) { summe = (h[1] ? ENTH[h[1]] : 1) * 100; rest = h[2]; if (!rest) return summe; }
  const u = /^(ein|zwei|drei|vier|fuenf|sechs|sieben|acht|neun)und(zwanzig|dreissig|vierzig|fuenfzig|sechzig|siebzig|achtzig|neunzig)$/.exec(rest);
  if (u) return summe + ENTH[u[1]] + ZEHNER[u[2]];
  if (HAT(ZEHNER, rest)) return summe + ZEHNER[rest];
  if (summe && HAT(EINER, rest) && rest !== 'null') return summe + EINER[rest];
  return null;
}

const EINHEIT = [
  [/^\s*(?:%|prozent)/i, 'prozent'],
  [/^\s*(?:°|grad(?![\p{L}]))/iu, 'grad'],
  [/^\s*(?:meter(?![\p{L}])|m(?![\p{L}])|km(?![\p{L}])|kilometer(?![\p{L}]))/iu, 'meter'],
  [/^\s*(?:sekunden?(?![\p{L}])|sek(?![\p{L}])|s(?![\p{L}])|minuten?(?![\p{L}])|min(?![\p{L}])|uhr(?![\p{L}]))/iu, 'zeit'],
];
const einheitNach = (text, pos) => { const r = text.slice(pos, pos + 14); for (const [re, n] of EINHEIT) if (re.test(r)) return n; return null; };

function zahlen(text) {
  text = String(text == null ? '' : text);
  const out = [];
  const re = /\d+(?:[.,]\d+)?|[A-Za-zÄÖÜäöüß]+/g;
  let m;
  while ((m = re.exec(text))) {
    const roh = m[0];
    let wert = null;
    if (/^\d/.test(roh)) wert = Number(roh.replace(',', '.'));
    else { const w = wortZahl(ohneUmlaut(roh)); if (w != null) wert = w; }
    if (wert == null) continue;
    out.push({ wert, roh, pos: m.index, ende: m.index + roh.length, einheit: einheitNach(text, m.index + roh.length) });
  }
  return out;
}

const norm360 = (a) => ((Math.round(a) % 360) + 360) % 360;
const gleichKurs = (a, b) => Math.abs(a - Math.round(a)) < 1e-9 && norm360(a) === norm360(b);

function kursUrteil(antwort, soll) {
  const alle = zahlen(antwort).filter((z) => z.einheit !== 'prozent' && z.einheit !== 'meter' && z.einheit !== 'zeit');
  const mitGrad = alle.filter((z) => z.einheit === 'grad');
  const kand = mitGrad.length ? mitGrad : alle;
  if (!kand.length) return { urteil: 'ausweichend', genannt: [], abweichungen: [] };
  const abw = kand.filter((z) => !gleichKurs(z.wert, soll)).map((z) => ({ genannt: z.wert, soll }));
  return { urteil: abw.length ? 'falsch' : 'richtig', genannt: kand.map((z) => z.wert), abweichungen: abw };
}

const SEKTOREN = ['bug', 'steuerbord', 'heck', 'backbord'];
const sektorVon = (w) => { w = w.toLowerCase(); return w === 'vorne' || w === 'vorn' ? 'bug' : w === 'hinten' ? 'heck' : w; };

function schildeUrteil(antwort, soll) {
  antwort = String(antwort == null ? '' : antwort);
  const teile = []; let start = 0;
  for (let i = 0; i < antwort.length; i++) {
    const c = antwort[i];
    const dez = (c === ',' || c === '.') && /\d/.test(antwort[i - 1] || '') && /\d/.test(antwort[i + 1] || '');
    if (/[,;.:!?\n]/.test(c) && !dez) { teile.push(antwort.slice(start, i)); start = i + 1; }
  }
  teile.push(antwort.slice(start));
  const genannt = {}, pauschal = [], abw = [];
  for (const t of teile) {
    const zs = zahlen(t).filter((z) => z.einheit !== 'grad' && z.einheit !== 'meter' && z.einheit !== 'zeit');
    if (!zs.length) continue;
    const sek = []; let m;
    const re = /\b(bug|steuerbord|heck|backbord)|\b(vorne|vorn|hinten)\b/gi;   // auch Bugschilde, Heckschild, Backbordseite
    while ((m = re.exec(t))) { const s = sektorVon(m[0]); if (!sek.includes(s)) sek.push(s); }
    if (!sek.length) { for (const z of zs) pauschal.push(z.wert); continue; }
    const nimm = (s, w) => { (genannt[s] = genannt[s] || []).push(w); };
    if (zs.length === 1) sek.forEach((s) => nimm(s, zs[0].wert));
    else sek.forEach((s, i) => { if (zs[i]) nimm(s, zs[i].wert); });
  }
  for (const s of SEKTOREN) for (const w of genannt[s] || []) if (w !== soll[s]) abw.push({ sektor: s, genannt: w, soll: soll[s] });
  for (const w of pauschal) if (SEKTOREN.some((s) => soll[s] !== w)) abw.push({ sektor: 'pauschal', genannt: w, soll: SEKTOREN.map((s) => soll[s]).join('/') });
  if (!Object.keys(genannt).length && !pauschal.length) return { urteil: 'ausweichend', genannt: {}, abweichungen: [] };
  return { urteil: abw.length ? 'falsch' : 'richtig', genannt: Object.assign({}, genannt, pauschal.length ? { pauschal } : {}), abweichungen: abw };
}

// Heuristik: behauptet oder sagt die Antwort die Ausfuehrung eines Befehls zu? Rueckgabe: Fundstellen (Wortlaut)
const ZUSAGE = [
  /\bmach(?:e)? ich\b/i, /\bwird (?:sofort |gleich )?(?:erledigt|gemacht|ausgeführt)\b/i, /\baye\b/i, /\bverstanden\b/i, /\bist (?:schon )?erledigt\b/i, /\bschon dabei\b/i,
  /\bbin (?:schon |gerade )?dabei\b/i, /\bich (?:lege|setze|stelle|schalte|starte|repariere|erfasse|markiere|springe|fahre|drehe|gebe|halte|scanne|feuere|aktiviere|schicke|leite|übernehme|kümmere|docke|stoppe|bremse|beschleunige|verteile|richte|wechsle|ändere|ziele|schieße|lade|führe)\b/i,
  /\bwird gemacht\b/i, /\bsofort,? captain\b/i, /\bkurs (?:wird )?geändert\b/i, /\bjawohl\b/i, /\bzu befehl\b/i, /\bkommt sofort\b/i, /\bist unterwegs\b/i,
];
function zusagen(antwort) {
  const t = String(antwort == null ? '' : antwort); const out = [];
  for (const re of ZUSAGE) { const m = re.exec(t); if (m) out.push(m[0]); }
  return out;
}

const sortiert = (l) => l.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
function perzentil(liste, p) { const s = sortiert(liste); if (!s.length) return null; return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))]; }
function median(liste) { const s = sortiert(liste); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }

module.exports = { zahlen, wortZahl, kursUrteil, schildeUrteil, zusagen, median, perzentil, SEKTOREN };
