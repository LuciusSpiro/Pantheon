'use strict';
// TEL-01 D1: Gefechtsprofil als SVG (String, keine Abhaengigkeit). profil(protokoll, kz) -> SVG-Text.
//   Raum:  Hülle (Systemintegrität, Summe r_integ in % ihres Sessionmaximums), Schild (Summe r_schild in % ihres Maximums), Hitze (größte r_hitze in % der Hitzegrenze)
//   Boden: Bodenschild (Segmente, Mittel und Minimum der Spieler draussen, in % des Sessionmaximums)
//   senkrecht: Szenengrenzen (kz.listen.szenen), darunter je Panel ein Streifen mit Verlusten (kz.listen.verluste) als Marken.
// Eine Zeitachse ueber die ganze Session. Feste helle Fläche, damit das Bild in hellen und dunklen Notizen gleich gut lesbar ist.
// Ein Panel erscheint nur, wenn der Lauf Daten dafuer hat (Raumlauf ohne Boden: kein Boden-Panel).

const HITZEGRENZE = 100;   // shared/config.js power.heatLimit
const B = 920, LINKS = 62, RECHTS = 24, PH = 150, KOPF = 34, LUECKE = 64;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const f1 = (v) => (Math.round(v * 10) / 10).toString();

const FARBE = { huelle: '#1b7f3b', schild: '#1f6fd1', hitze: '#d9480f', bodenMittel: '#1f6fd1', bodenMin: '#9b2fae' };
const MARKE = {   // art -> Farbe, Name
  zone_aus: ['#d9480f', 'Zone aus'], notfall: ['#9b2fae', 'Notfallprotokoll'], schiff_zerstoert: ['#111111', 'Schiff zerstört'],
  gefallen: ['#c92a2a', 'gefallen'], bodenschild_leer: ['#e8a400', 'Bodenschild leer'], notrueckholung: ['#9b2fae', 'Notrückholung'], szene_neustart: ['#111111', 'Neustart'],
};

function profil(protokoll, kz) {
  const zr = (protokoll.zeilen || []).filter((z) => z.typ === 'zeitreihe' && num(z.t));
  const tMax = Math.max(1, kz && kz.kopf && num(kz.kopf.dauer) ? kz.kopf.dauer : 0, zr.length ? zr[zr.length - 1].t : 0);
  const kennung = (kz && kz.kopf && kz.kopf.sitzung) || protokoll.kennung || '';
  const x = (t) => LINKS + ((B - LINKS - RECHTS) * Math.min(Math.max(t, 0), tMax)) / tMax;

  // Reihen
  const raum = zr.filter((r) => Array.isArray(r.r_integ) && r.r_integ.every(num) && Array.isArray(r.r_schild) && r.r_schild.every(num) && Array.isArray(r.r_hitze) && r.r_hitze.every(num) && Array.isArray(r.ort) && r.ort.includes('raum'));
  const sum = (a) => a.reduce((p, q) => p + q, 0);
  const rHülle = raum.map((r) => ({ t: r.t, v: sum(r.r_integ) }));
  const rSchild = raum.map((r) => ({ t: r.t, v: sum(r.r_schild) }));
  const rHitze = raum.map((r) => ({ t: r.t, v: Math.max(...r.r_hitze) }));
  const boden = [];
  for (const r of zr) {
    if (!Array.isArray(r.b_schild)) continue;
    const w = r.b_schild.filter(num);
    if (w.length) boden.push({ t: r.t, mittel: sum(w) / w.length, min: Math.min(...w) });
  }
  const panels = [];
  if (rHülle.length >= 2) panels.push({ name: 'Schiff (Raum)', verlust: ['zone_aus', 'notfall', 'schiff_zerstoert'], reihen: [
    { name: 'Hülle (Systemintegrität, % vom Maximum)', farbe: FARBE.huelle, pts: norm(rHülle, Math.max(...rHülle.map((p) => p.v))) },
    { name: 'Schild (% vom Maximum)', farbe: FARBE.schild, pts: norm(rSchild, Math.max(...rSchild.map((p) => p.v))) },
    { name: 'Hitze (% der Hitzegrenze)', farbe: FARBE.hitze, pts: norm(rHitze, HITZEGRENZE) },
  ] });
  if (boden.length >= 2) {
    const mx = Math.max(...boden.map((p) => p.mittel), ...boden.map((p) => p.min));
    panels.push({ name: 'Boden', verlust: ['gefallen', 'bodenschild_leer', 'notrueckholung', 'szene_neustart'], reihen: [
      { name: 'Bodenschild Mittel (% vom Maximum)', farbe: FARBE.bodenMittel, pts: norm(boden.map((p) => ({ t: p.t, v: p.mittel })), mx) },
      { name: 'Bodenschild Minimum eines Spielers', farbe: FARBE.bodenMin, pts: norm(boden.map((p) => ({ t: p.t, v: p.min })), mx) },
    ] });
  }
  function norm(pts, mx) { return pts.map((p) => ({ t: p.t, v: mx > 0 ? Math.min(100, (100 * p.v) / mx) : 0 })); }

  const h = KOPF + Math.max(1, panels.length) * (PH + LUECKE) + 34;
  const o = [];
  o.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + B + '" height="' + h + '" viewBox="0 0 ' + B + ' ' + h + '" font-family="Segoe UI, Arial, sans-serif" font-size="11">');
  o.push('<rect x="0" y="0" width="' + B + '" height="' + h + '" fill="#ffffff"/>');
  o.push('<text x="' + LINKS + '" y="18" font-size="13" font-weight="bold" fill="#222222">Gefechtsprofil ' + esc(kennung) + '</text>');
  if (!panels.length) {
    o.push('<text x="' + LINKS + '" y="' + (KOPF + 40) + '" fill="#555555">keine Zeitreihe mit Raum- oder Bodendaten in dieser Session</text>');
  }
  const szenen = (kz && kz.listen && kz.listen.szenen) || [];
  const verluste = (kz && kz.listen && kz.listen.verluste) || [];
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
    const alle = verluste.filter((v) => p.verlust.includes(v.art));
    const mv = alle.slice(0, 600);
    if (alle.length > mv.length) o.push('<text x="' + (B - RECHTS) + '" y="' + (y1 + 40) + '" text-anchor="end" fill="#c92a2a">nur die ersten ' + mv.length + ' von ' + alle.length + ' Verlusten eingezeichnet</text>');
    for (const v of mv) {
      const m = MARKE[v.art] || ['#111111', v.art];
      const cx = x(v.t), cy = y1 + 14;
      o.push('<polygon points="' + f1(cx - 3) + ',' + (cy - 5) + ' ' + f1(cx + 3) + ',' + (cy - 5) + ' ' + f1(cx) + ',' + (cy + 3) + '" fill="' + m[0] + '"><title>' + esc(m[1] + ' ' + f1(v.t) + ' s') + '</title></polygon>');
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
