'use strict';
// LIV-01 D: Beat-Handler der Bot-Crew fuer beliebige Abenteuer (aus den Beat-Handlern von tools/spiel-faden.js, dort fest verdrahtet je Beat; hier nach dem Typ des LAUFENDEN Beats gewaehlt,
// weil die Plaene von Claude kommen und jede Reihenfolge der Katalog-Beats vorkommen kann). Verwendet von tools/live-abend.js.
//
//   const B = Beats.neu({ g, cl, w, zeile, k, kz, opts, grenze, ereignis })
//     g, cl, w   Game, drei Clients (tools/lib/bot-crew.js client), w = bot-crew.werkzeug(...)
//     k(...arten)  meldet kuenstlich gesetzte Schritte; kz = Zaehler je Art (der Aufrufer fuehrt ihn in k)
//     grenze()     EINE Taetigkeitsgrenze (Aufrufer: gebremst, nie schneller als der Spielleiter antworten kann) -> true, wenn sie ausgeloest wurde
//     opts         { testhelfer: true|false (Gegner per Testhelfer zerstoeren; false: Szenen-Beats laufen in die Frist) }
//     ereignis(art, daten)  Protokoll (Bitte-Antwort usw.)
//   B.typVon(f)            Typ des LAUFENDEN Beats (Variante eines feindlichen NSC zaehlt)
//   B.leerlauf(ms)         warten: beantwortet Bitten, loest gebremst Grenzen aus (Fristen laufen nur ueber Taetigkeiten)
//   B.spieleBeat(f)        den laufenden Beat spielen, soweit der Bot es kann -> { typ, id, wie, ausgang, kuenstlich, sekunden, notiz }
//   B.nachhilfe(f)         der Beat wartet, ist faellig und der Spielleiter bringt ihn nicht weiter: faden_weiter ueber den Befehlsweg der Fäden (kuenstlich gesetzt)
//
// Was der Bot kann: geruecht, wiedersehen, notruf (hinfliegen, echte Spruenge), spur (lesen, Teilung abstimmen), bitte (annehmen), sabotage (echte Spruenge, Posten sprengen), fracht (hinfliegen,
// Andocken wird gesetzt), enthuellung und abschluss (laufen von selbst). Er hat KEINE Bordkanone: Szenen-Beats (konvoi, geleit, raumschlacht, verfolgung, befreiung) spielt er mit dem Testhelfer
// (Gegner zerstoeren, im Verlauf als kuenstlich ausgewiesen) oder, mit opts.testhelfer false, gar nicht (Frist). spontanhilfe wartet auf ein Gefecht, das der Bot nicht ausloest: Frist.
const Sektoren = require('../../shared/sektoren.js');
const Faden = require('../../server/sim/faden.js');
const FD = require('../../server/sim/faden-daten.js');
const Bitte = require('../../server/sim/faden-bitte.js');
const Spur = require('../../server/sim/spur.js');
const Testhilfe = require('../gegner-testhilfe.js');

const SZENEN = ['konvoi', 'geleit', 'raumschlacht', 'verfolgung', 'befreiung', 'spontanhilfe'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function neu(ctx) {
  const { g, cl, w, zeile, k, kz, opts, grenze, ereignis } = ctx;
  const beatVon = (f) => { const v = FD.vorlage(f.vorlage); return v && v.beats[f.beat] ? v.beats[f.beat] : null; };
  const typVon = (f) => { const b = beatVon(f); return f.laufend && f.laufend.variante ? f.laufend.variante : (b ? b.typ : null); };
  const laeuft = (f, id) => f.phase === 'laeuft' && f.laufend && f.laufend.beat === id;
  let bitteNr = null;

  // Bitte: die Crew antwortet (Regel: Option annehmen, sonst die erste; ein zweiter Client antwortet gleichzeitig ablehnen: wird verworfen), Reaktionszeit ab dem ersten Sehen
  const bitteSpielen = () => {
    const off = Bitte.offen(g);
    if (!off || off.gemeldet || off.nr === bitteNr) return false;
    bitteNr = off.nr; off.gemeldet = true;
    const antwort = off.optionen.find((o) => o.id === 'annehmen') || off.optionen[0];
    cl[0].send({ t: 'cmd', c: 'faden.bitte', id: antwort.id, nr: off.nr });
    cl[1].send({ t: 'cmd', c: 'faden.bitte', id: 'ablehnen', nr: off.nr });
    ereignis('bitte', { nr: off.nr, beat: off.beatId, gewaehlt: antwort.id, text: antwort.text });
    zeile(`Bitte ${off.nr} (${off.beatId}) an alle drei: ${off.text} [${off.optionen.map((o) => o.text).join(' | ')}]; Crew antwortet „${antwort.text}“`);
    return true;
  };
  const leerlauf = async (ms) => { bitteSpielen(); grenze(); await sleep(ms || 100); };

  // N2: testhelfer-kill zaehlt ABSCHUESSE, nicht Schleifendurchlaeufe: ein Gegner wird einmal vermerkt, wenn der Testhelfer ihn trifft, und gezaehlt, sobald er tatsaechlich aus dem Raum ist (Countdown/Treiben kann dauern)
  const getroffen = new Set();
  const abgaenge = () => { for (const e of [...getroffen]) if (!g.space.enemies.includes(e)) { getroffen.delete(e); k('testhelfer-kill'); } };
  const schlage = (e) => { getroffen.add(e); Testhilfe.toeten(g, e); };
  const alleGegner = () => { abgaenge(); for (const e of g.space.enemies.slice()) schlage(e); abgaenge(); };
  const hin = async (hex, text) => {   // echte Spruenge; gibt es keinen Weg ueber offene Kanten: der Ort wird gesetzt (kuenstlich)
    if (!hex) return false;
    if (w.hierHex() === hex) return true;
    let ok = false;
    try { ok = await w.springe(hex); } catch (e) { zeile(`${text}: Sprung fehlgeschlagen (${e && e.message})`); }
    if (!ok && w.hierHex() !== hex) { zeile(`${text}: kein gelungener Sprung nach ${hex}, der Ort wird gesetzt (kuenstlich)`); w.flieg(hex); await sleep(300); }
    return w.hierHex() === hex;
  };
  const warteBeatEnde = async (f, id, ms, jeSchritt) => {
    const bis = Date.now() + ms;
    while (Date.now() < bis && laeuft(f, id)) { if (jeSchritt) await jeSchritt(); else await leerlauf(100); }
    return !laeuft(f, id);
  };

  // ---------- die Beats
  async function ankunft(f, b) {   // geruecht, wiedersehen, notruf: der Beat nennt einen Ort, die Ankunft beendet ihn
    const p = b.parameter || {};
    const ziel = (typeof p.hex === 'string' && /^\d{4}$/.test(p.hex) ? p.hex : null) || (f.parameter && f.parameter.ort);
    await w.sleep(300);
    zeile(`${b.typ}: die Crew will nach ${ziel ? Sektoren.hexName(ziel) + ' (' + ziel + ')' : '?'}`);
    await hin(ziel, b.typ);
    await warteBeatEnde(f, b.id, 6000);
  }
  async function spur(f, b) {
    const lese = async () => {
      const kern = Spur.kern(g.spur.id, w.hierHex()); k('ort-setzen'); g.ship.x = kern.x + 40; g.ship.y = kern.y;
      cl[0].send({ t: 'cmd', c: 'weapons.spur.lesen', on: true });
      for (let i = 0; i < 200 && !(g.spur.gelesen || g.spur.fertig || g.spur.wartet); i++) await sleep(100);
      if (g.spur.wartet) {   // Teilung: die Ops stimmt das Signal ab (Qualitaet 3)
        cl[0].send({ t: 'cmd', c: 'weapons.entschl.start' });
        for (let i = 0; i < 1200 && g.entschl && g.entschl.z === 1; i++) { const e = g.entschl, d = Math.abs(e.f - e.ziel) < 0.02 ? 0 : (e.ziel > e.f ? 1 : -1); if (d !== e.dir) cl[0].send({ t: 'cmd', c: 'weapons.entschl.stimme', dir: d }); await sleep(100); }
        await sleep(500);
      }
    };
    await w.konsole('weapons');
    for (let n = 0; n < 8 && laeuft(f, b.id) && g.spur && !g.spur.fertig; n++) {
      const d = Spur.datei(g.spur.id); if (!d) break;
      const ziel = g.spur.gelesen ? d.weg[g.spur.idx + 1] : d.weg[g.spur.idx];
      if (!ziel) break;
      if (w.hierHex() !== ziel) { w.flieg(ziel); await sleep(300); await w.konsole('weapons'); }   // wie spiel-faden: der Ort der Spurkerne wird gesetzt (das Anfliegen ist in test-spur geprueft)
      zeile(`Spur: Crew in ${Sektoren.hexName(ziel)}, Ops liest`);
      await lese();
    }
    await warteBeatEnde(f, b.id, 4000);
  }
  async function sabotage(f, b) {
    const Besitz = require('../../server/sim/besitz.js');
    const Locations = require('../../shared/locations.js');
    const z = g.weltsim.zustand, ziel = f.parameter && f.parameter.ort;
    if (!ziel) return;
    const da = await hin(ziel, 'Sabotage');
    if (!da || !laeuft(f, b.id)) return;
    await w.konsole('weapons');
    const p = Besitz.postenLage(Locations.get(Sektoren.ortVonHex(ziel)).scene);
    const halte = () => { k('ort-setzen'); Object.assign(g.ship, { x: p.x, y: p.y, vx: 0, vy: 0, speed: 0 }); };
    const szeneAbwarten = async () => { for (let i = 0; i < 1800 && g.simSzene; i++) { alleGegner(); await sleep(100); } await sleep(300); };
    await szeneAbwarten();
    let gesprengt = !(z.hexe[ziel] && z.hexe[ziel].posten);
    for (let versuch = 1; versuch <= 3 && !gesprengt && laeuft(f, b.id); versuch++) {
      halte();
      cl[0].send({ t: 'cmd', c: 'weapons.posten.angreifen' });
      let angriff = false;
      for (let i = 0; i < 300 && !angriff; i++) { halte(); angriff = !!(g.simSzene && g.simSzene.modus === 'angriff'); if (!angriff) await sleep(100); }
      for (let i = 0; i < 1800 && g.simSzene; i++) { alleGegner(); await sleep(100); }
      await sleep(600);
      gesprengt = !(z.hexe[ziel] && z.hexe[ziel].posten);
      if (!gesprengt) await szeneAbwarten();
    }
    zeile(`Sabotage am Ziel ${ziel}: Posten gesprengt ${gesprengt}`);
    await warteBeatEnde(f, b.id, 4000);
  }
  async function fracht(f, b) {
    const nach = f.fracht && f.fracht.nach;
    if (!nach) { await warteBeatEnde(f, b.id, 3000); return; }
    const da = await hin(nach, 'Fracht');
    if (da && laeuft(f, b.id)) { k('andocken-gesetzt'); g.missionEvent('docked', { loc: 'x' }); await sleep(400); }   // Andocken am Zielhafen wird gesetzt (kein Anflug an die Station)
    await warteBeatEnde(f, b.id, 4000);
  }
  async function szene(f, b, typ) {
    const szeneDa = () => g.fadenSzene && g.fadenSzene.fadenId === f.id;
    if (typ === 'befreiung') await hin(f.parameter && f.parameter.ort, 'Befreiung');
    if (g.ship.docked) { w.flieg(w.hierHex()); await sleep(300); }   // eine Szene beginnt nie im Hafen (Andocken beendet sie): das Schiff liegt im Raum, abseits der Route des Konvois (wie neuerOrt in spiel-faden)
    if (typ !== 'befreiung') { k('ort-setzen'); Object.assign(g.ship, { x: 300, y: 300, vx: 0, vy: 0, speed: 0 }); }
    if (typ === 'spontanhilfe') { zeile('spontanhilfe: der Beat wartet auf ein Gefecht, das der Bot nicht ausloest (Frist)'); return; }
    // Vorlauf (Vorwarnung per Funk, mindestens 8 s Spielzeit), dann Kampf
    let kampf = false;
    for (let i = 0; i < 300 && laeuft(f, b.id) && !kampf; i++) { kampf = szeneDa() && g.fadenSzene.phase === 'kampf'; if (!kampf) { bitteSpielen(); await sleep(100); } }
    zeile(`${typ}: Kampf ${kampf}`);
    if (!kampf || !opts.testhelfer) return;   // ohne Testhelfer bleibt der Beat stehen: die Frist beendet ihn
    await sleep(1500);
    const es = () => (g.space.escorts || []).find((q) => g.fadenSzene && q.tag === g.fadenSzene.tag);
    const modus = (b.parameter && b.parameter.modus) || 'geleit';
    await warteBeatEnde(f, b.id, 90000, async () => {
      if (typ === 'konvoi') { const Konvoi = require('../../server/sim/konvoi.js'); for (const e of Konvoi.transporter(g)) schlage(e); }
      alleGegner();
      if (typ === 'geleit') {
        const q = es();
        if (q && modus === 'geleit' && q.ziel) { k('schuetzling-versetzt'); q.x = q.ziel.x; q.y = q.ziel.y; q.vx = 0; q.vy = 0; }
        if (q && modus === 'panne') { k('ort-setzen'); g.ship.x = q.x + 90; g.ship.y = q.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0; }
      }
      await sleep(500);
    });
  }

  // Der laufende Beat. Rueckgabe beschreibt, was der Bot getan hat; das Ergebnis des Beats steht im Gedaechtnis des NSC
  async function spieleBeat(f) {
    const b = beatVon(f), typ = typVon(f), t0 = Date.now(), vor = Object.assign({}, kz), gedVor = f.nsc.gedaechtnis.length;
    let notiz = null, versucht = true;
    try {
      if (typ === 'geruecht' || typ === 'wiedersehen' || typ === 'notruf') await ankunft(f, b);
      else if (typ === 'spur') await spur(f, b);
      else if (typ === 'sabotage') await sabotage(f, b);
      else if (typ === 'fracht') await fracht(f, b);
      else if (typ === 'bitte') { await warteBeatEnde(f, b.id, 60000); }
      else if (typ === 'enthuellung' || typ === 'abschluss') { await warteBeatEnde(f, b.id, 5000); }
      else if (SZENEN.includes(typ)) { await szene(f, b, typ); versucht = typ !== 'spontanhilfe' && !!opts.testhelfer; if (typ !== 'spontanhilfe' && !opts.testhelfer) notiz = 'ohne Testhelfer: nicht gespielt'; if (typ === 'spontanhilfe') notiz = 'wartet auf ein Gefecht: nicht spielbar'; }
      else { versucht = false; notiz = 'keine Bot-Logik fuer diesen Beat'; }
      // laeuft er noch (Szene ohne Testhelfer, spontanhilfe, unbekannter Typ, Ort nicht erreicht): die Frist beendet ihn ueber Taetigkeiten
      if (laeuft(f, b.id)) { for (let i = 0; i < 800 && laeuft(f, b.id); i++) await leerlauf(150); if (laeuft(f, b.id)) notiz = (notiz ? notiz + '; ' : '') + 'Beat laeuft nach 2 Minuten noch'; else if (versucht) notiz = (notiz ? notiz + '; ' : '') + 'Frist ablief'; else notiz = (notiz ? notiz + '; ' : '') + 'Frist lief ab'; }
    } catch (e) { notiz = 'Fehler im Bot: ' + (e && e.message); zeile(`Beat ${typ}: ${notiz}`); }
    await sleep(200);
    abgaenge();
    const kuenstlich = {}; for (const [a, n] of Object.entries(kz)) if (n > (vor[a] || 0)) kuenstlich[a] = n - (vor[a] || 0);
    const neuGed = f.nsc.gedaechtnis.slice(gedVor).map((x) => x.ereignis).filter((x) => String(x).startsWith(typ + '_'));
    const ausgang = neuGed.find((x) => /_gelungen$/.test(x)) ? 'gelungen' : neuGed.find((x) => /_gescheitert$/.test(x)) ? 'gescheitert' : (neuGed[0] || (laeuft(f, b.id) ? 'offen' : 'ohne Eintrag'));
    delete kuenstlich['spieler-setzen'];   // das Setzen an eine Konsole ist Bedienung, keine Abkuerzung im Beat
    // K1 c: grenze-gesetzt (vom Bot gesetzte Taetigkeiten WAEHREND des Beats) bleibt sichtbar: sie treiben die Beat-Frist. Sie machen den Beat aber nicht zu "teils kuenstlich" (kein Spielschritt)
    const eigene = Object.keys(kuenstlich).filter((a) => a !== 'ort-setzen' && a !== 'grenze-gesetzt');   // ort-setzen: der Anflug an Sprungpunkt oder Spurkern wird gesetzt (das Anfliegen ist in test-flight geprueft), die Spruenge selbst sind echt
    const wie = !versucht ? 'nicht gespielt' : eigene.length ? 'teils kuenstlich' : (ausgang === 'gescheitert' && notiz && /Frist/.test(notiz) ? 'nicht gespielt' : (kuenstlich['ort-setzen'] ? 'gespielt (Anflug gesetzt)' : 'gespielt'));
    return { typ, id: b.id, wie, ausgang, kuenstlich, sekunden: Math.round((Date.now() - t0) / 100) / 10, notiz };
  }

  function nachhilfe(f) {
    const b = beatVon(f);
    if (!b) return null;
    k('faden-weiter-bot');
    return Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: b.id });
  }
  return { typVon, beatVon, leerlauf, bitteSpielen, spieleBeat, nachhilfe, alleGegner };
}

module.exports = { neu, SZENEN };
