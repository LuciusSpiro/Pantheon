'use strict';
// TEL-01 D1: Gefechtsprofil als SVG (String, keine Abhaengigkeit). profil(protokoll, kz) -> SVG-Text.
// profil.js ZEICHNET NUR: die Reihen kommen EINMAL gerechnet (mit Raumfilter) aus kz.listen.reihen (kennzahlen.js), Hitzegrenze eingeschlossen.
//   Raum:  Systemintegrität (Summe r_integ in % ihres Maximums; die Lerche hat keinen Hüllenwert), Schild (Summe r_schild in % ihres Maximums), Hitze (größte r_hitze in % der Hitzegrenze)
//   Boden: Bodenschild (Segmente, Mittel und Minimum der Spieler draussen, in % des Sessionmaximums)
//   senkrecht: Szenengrenzen (kz.listen.szenen), darunter je Panel ein Streifen mit Verlusten (kz.listen.verluste) als Marken; Marken derselben Art in derselben Pixelspalte werden
//   zu EINER Marke zusammengefasst (Titel nennt die Zahl), es wird keine Liste abgeschnitten.
// Eine Zeitachse ueber die ganze Session. Feste helle Fläche, damit das Bild in hellen und dunklen Notizen gleich gut lesbar ist.
// Ein Panel erscheint nur, wenn der Lauf Daten dafuer hat (Raumlauf ohne Boden: kein Boden-Panel).

const B = 920, LINKS = 62, RECHTS = 24, PH = 150, KOPF = 34, LUECKE = 64;
const { HITZEGRENZE } = require('./kennzahlen.js');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const f1 = (v) => (Math.round(v * 10) / 10).toString();

const FARBE = { huelle: '#1b7f3b', schild: '#1f6fd1', hitze: '#d9480f', bodenMittel: '#1f6fd1', bodenMin: '#9b2fae' };
const MARKE = {   // art -> Farbe, Name
  zone_aus: ['#d9480f', 'Zone aus'], notfall: ['#9b2fae', 'Notfallprotokoll'], schiff_zerstoert: ['#111111', 'Schiff zerstört'],
  gefallen: ['#c92a2a', 'gefallen'], bodenschild_leer: ['#e8a400', 'Bodenschild leer'], notrueckholung: ['#9b2fae', 'Notrückholung'], szene_neustart: ['#111111', 'Neustart'],
};

function profil(protokoll, kz) {
  const re = (kz && kz.listen && kz.listen.reihen) || { raum: { t: [], integ: [], schild: [], hitze: [] }, boden: { t: [], mittel: [], min: [] }, hitzegrenze: HITZEGRENZE };
  const letzte = (a) => (a.length ? a[a.length - 1] : 0);
  const tMax = Math.max(1, kz && kz.kopf && num(kz.kopf.dauer) ? kz.kopf.dauer : 0, letzte(re.raum.t), letzte(re.boden.t));
  const kennung = (kz && kz.kopf && kz.kopf.sitzung) || (protokoll && protokoll.kennung) || '';
  const x = (t) => LINKS + ((B - LINKS - RECHTS) * Math.min(Math.max(t, 0), tMax)) / tMax;

  // Reihen: nur normieren (die Zahlen selbst kommen aus kennzahlen.js)
  const maxV = (arr) => { let m = 0; for (const v of arr) if (v > m) m = v; return m; };
  const norm = (ts, vs, mx) => ts.map((t, i) => ({ t, v: mx > 0 ? Math.min(100, (100 * vs[i]) / mx) : 0 }));
  const panels = [];
  if (re.raum.t.length >= 2) panels.push({ name: 'Schiff (Raum)', verlust: ['zone_aus', 'notfall', 'schiff_zerstoert'], reihen: [
    { name: 'Systemintegrität (% vom Max.)', farbe: FARBE.huelle, pts: norm(re.raum.t, re.raum.integ, maxV(re.raum.integ)) },
    { name: 'Schild (% vom Maximum)', farbe: FARBE.schild, pts: norm(re.raum.t, re.raum.schild, maxV(re.raum.schild)) },
    { name: 'Hitze (% der Hitzegrenze)', farbe: FARBE.hitze, pts: norm(re.raum.t, re.raum.hitze, re.hitzegrenze) },
  ] });
  if (re.boden.t.length >= 2) {
    const mx = Math.max(maxV(re.boden.mittel), maxV(re.boden.min));
    panels.push({ name: 'Boden', verlust: ['gefallen', 'bodenschild_leer', 'notrueckholung', 'szene_neustart'], reihen: [
      { name: 'Bodenschild Mittel (% vom Maximum)', farbe: FARBE.bodenMittel, pts: norm(re.boden.t, re.boden.mittel, mx) },
      { name: 'Bodenschild Minimum eines Spielers', farbe: FARBE.bodenMin, pts: norm(re.boden.t, re.boden.min, mx) },
    ] });
  }

  const szenen = (kz && kz.listen && kz.listen.szenen) || [];
  const verluste = (kz && kz.listen && kz.listen.verluste) || [];
  // Verlustmarken je Panel: gleiche Art in derselben Pixelspalte zu einer Marke zusammenfassen
  const marken = (arten) => {
    const grp = new Map();
    for (const v of verluste) {
      if (!arten.includes(v.art) || !num(v.t)) continue;
      const k = v.art + '|' + Math.round(x(v.t));
      const g = grp.get(k);
      if (g) g.n++; else grp.set(k, { art: v.art, px: Math.round(x(v.t)), t: v.t, n: 1 });
    }
    return [...grp.values()];
  };

  const h = KOPF + Math.max(1, panels.length) * (PH + LUECKE) + 34;
  const o = [];
  o.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + B + '" height="' + h + '" viewBox="0 0 ' + B + ' ' + h + '" font-family="Segoe UI, Arial, sans-serif" font-size="11">');
  o.push('<rect x="0" y="0" width="' + B + '" height="' + h + '" fill="#ffffff"/>');
  o.push('<text x="' + LINKS + '" y="18" font-size="13" font-weight="bold" fill="#222222">Gefechtsprofil ' + esc(kennung) + '</text>');
  o.push('<text x="' + (B - RECHTS) + '" y="18" text-anchor="end" font-size="10" fill="#555555">Systemintegrität ersetzt die Hülle (die Lerche hat keinen Hüllenwert)</text>');
  if (!panels.length) {
    o.push('<text x="' + LINKS + '" y="' + (KOPF + 40) + '" fill="#555555">keine Zeitreihe mit Raum- oder Bodendaten in dieser Session</text>');
  }
  panels.forEach((p, i) => {
    const y0 = KOPF + i * (PH + LUECKE) + 22;   // Oberkante der Zeichenflaeche (darueber Titel und Legende)
    const y1 = y0 + PH;
    const y = (v) => y1 - (PH * v) / 100;
    o.push('<text x="' + LINKS + '" y="' + (y0 - 10) + '" font-weight="bold" fill="#222222">' + esc(p.name) + '</text>');
    // Legende rechts neben dem Titel
    let lx = LINKS + 110;
    for (const r of p.reihen) {
      o.push('<rect x="' + lx + '" y="' + (y0 - 19) + '" width="12" height="4" fill="' + r.farbe + '"/><text x="' + (lx + 16) + '" y="' + (y0 - 10) + '" fill="#333333">' + esc(r.name) + '</text>');
      lx += 28 + r.name.length * 5.4;
    }
    o.push('<rect x="' + LINKS + '" y="' + y0 + '" width="' + (B - LINKS - RECHTS) + '" height="' + PH + '" fill="#f8f9fa" stroke="#adb5bd"/>');
    for (const g of [0, 50, 100]) {
      o.push('<line x1="' + LINKS + '" y1="' + f1(y(g)) + '" x2="' + (B - RECHTS) + '" y2="' + f1(y(g)) + '" stroke="#dee2e6"/>');
      o.push('<text x="' + (LINKS - 6) + '" y="' + f1(y(g) + 4) + '" text-anchor="end" fill="#555555">' + g + ' %</text>');
    }
    // Szenengrenzen
    szenen.forEach((s, k) => {
      const t0 = s.start == null ? s.ende : s.start;
      if (!num(t0)) return;
      o.push('<line x1="' + f1(x(t0)) + '" y1="' + y0 + '" x2="' + f1(x(t0)) + '" y2="' + (y1 + 22) + '" stroke="#495057" stroke-dasharray="4 3"/>');
      o.push('<text x="' + (f1(x(t0) + 3)) + '" y="' + (y0 + 11 + (k % 2) * 11) + '" font-size="9" fill="#495057">' + esc(String(s.szene || s.modus || '').slice(0, 16)) + '</text>');
    });
    for (const r of p.reihen) {
      if (r.pts.length < 2) continue;
      o.push('<polyline fill="none" stroke="' + r.farbe + '" stroke-width="1.5" points="' + r.pts.map((q) => f1(x(q.t)) + ',' + f1(y(q.v))).join(' ') + '"/>');
    }
    // Verlust-Streifen unter der Fläche
    o.push('<text x="' + (LINKS - 6) + '" y="' + (y1 + 19) + '" text-anchor="end" fill="#555555">Verluste</text>');
    for (const v of marken(p.verlust)) {
      const m = MARKE[v.art] || ['#111111', v.art];
      const cx = v.px, cy = y1 + 14, w = Math.min(3 + Math.floor(Math.log2(v.n)), 6);   // mehrere Verluste in einer Spalte: groessere Marke
      o.push('<polygon points="' + f1(cx - w) + ',' + (cy - 5) + ' ' + f1(cx + w) + ',' + (cy - 5) + ' ' + f1(cx) + ',' + (cy + 3) + '" fill="' + m[0] + '"><title>' + esc((v.n > 1 ? v.n + '× ' : '') + m[1] + ' ' + f1(v.t) + ' s') + '</title></polygon>');
    }
    // Legende der Marken
    let mx = LINKS;
    for (const art of p.verlust) {
      const m = MARKE[art];
      o.push('<polygon points="' + mx + ',' + (y1 + 33) + ' ' + (mx + 7) + ',' + (y1 + 33) + ' ' + f1(mx + 3.5) + ',' + (y1 + 40) + '" fill="' + m[0] + '"/><text x="' + (mx + 11) + '" y="' + (y1 + 40) + '" fill="#333333">' + esc(m[1]) + '</text>');
      mx += 24 + m[1].length * 5.6;
    }
    // Zeitachse (beim letzten Panel beschriftet, sonst nur Teilstriche)
    const n = 6;
    for (let k = 0; k <= n; k++) {
      const t = (tMax * k) / n;
      o.push('<line x1="' + f1(x(t)) + '" y1="' + y1 + '" x2="' + f1(x(t)) + '" y2="' + (y1 + 4) + '" stroke="#868e96"/>');
      if (i === panels.length - 1) o.push('<text x="' + f1(x(t)) + '" y="' + (y1 + 54) + '" text-anchor="middle" fill="#555555">' + (t >= 120 ? f1(t / 60) + ' min' : f1(t) + ' s') + '</text>');
    }
  });
  if (panels.length) o.push('<text x="' + (B - RECHTS) + '" y="' + (h - 4) + '" text-anchor="end" fill="#555555">Spielzeit (eine Zeitachse über die Session; gestrichelt: Szenengrenzen)</text>');
  o.push('</svg>');
  return o.join('\n') + '\n';
}

module.exports = { profil };
