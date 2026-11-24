'use strict';
// BOT-02 B6: Messmodus --bord der Laeufer tools/spiel-landung.js und tools/spiel-wrack.js (Abnahme 5 und 7 von BOT-02): Mensch-Ersatz unten, die Server-Bots (navigation, ops, technik) tun oben die Arbeit des Bord-Dienstes.
//   Der Mensch-Ersatz scannt den Landepunkt NICHT und stoppt das Schiff NICHT: er waehlt den Landepunkt an der Transfer-Konsole (transfer.ziel), geht zum Pad (kuenstliche Gehzeit, gezaehlt) und haelt E.
//   Scan (Ops-Bot), Stopp (Navigations-Bot) und Posten am Transfer (Bord-Bot: Technik, sonst Ops) uebernehmen die Server-Bots. Das Schiff FAEHRT dazu vorher (Stufe 3 = halbe Fahrt, ueber beamMaxSpeed), es wird nie festgehalten.
//   pruefArgs(opts)               reine Pruefung der Aufrufkombination (null = in Ordnung, sonst Text fuer Exit 2)
//   messung({ g, cl, Station, k, jetzt })   haengt Messfuehler an das Spiel (nur lesen: Zaehler, Abtastung alle 50 ms) und liefert { fahren, gewaehlt, ereignis, beenden, daten }
//   auswerten(d)                  reine Pruefungen auf den Messdaten -> [{ ok, text }] (Gruende siehe Funktionskopf)
//   zusatz(d)                     die Zusatzmessung fuer Kai (Ansagen je Art, ODA: alle Meldungen und davon die Codehilfe "Niemand an Bord? ... Codetabelle", Rueckholung) als kleines Objekt
// Kuenstlich (vom Laeufer im Zaehler k gezaehlt): Schiff am Anfang in Fahrt setzen (einmal), Mensch an Konsole und Pad setzen, die Gehzeit des Menschen vom Transfer zum Pad.
const Flight = require('../../shared/flight.js');
const STUFE = 3;            // Stufe des Schiffs am Start (halbe Fahrt, schneller als beamMaxSpeed 30: der Navigations-Bot MUSS stoppen)
const VOR_PUNKT = 280;      // Abstand vor dem Beam-Punkt in Fahrtrichtung (px), das Schiff liegt dabei 100 px seitlich: in Beamreichweite (320), faehrt am Punkt vorbei
const SEITE = 100;
const GEHZEIT_MS = 4000;    // kuenstlich: der Mensch geht von der Transfer-Konsole zum Pad (BOT-02 B3: ca. 4 s)
const NACH_BEAM_MS = 3000;  // der Bord-Bot darf bis zu so lange NACH dem Beam am Transfer ankommen ("beim Beam/kurz danach")

function pruefArgs(o) {
  if (!o.bord) return null;
  if (o.crew !== 1) return '--bord nur mit --crew 1';
  const r = o.serverBots;
  if (!r || ['navigation', 'ops', 'technik'].some((x) => !r.includes(x))) return '--bord braucht --server-bots navigation,ops,technik (Navigation stoppt, Ops scannt, Technik haelt den Transfer)';
  if (o.fristLauf) return '--bord nicht mit --frist-lauf (die Crew bleibt dort oben, es gibt keinen Beam)';
  return null;
}

// Mensch-Befehle, die zu Ops oder Steuer gehoeren
const OPS_STEUER = /^(weapons|helm)\./;

function messung({ g, cl, Station, k, jetzt, zeile }) {
  const t0 = jetzt || Date.now();
  const rel = () => Date.now() - t0;
  const beamMax = g.C.ship.beamMaxSpeed;
  const d = {
    beamMax, startSpeed: null, maxSpeed: 0, stufe: STUFE,
    tWahl: null, tScan: null, tStopp: null, tBeam: null, tBordTransfer: null,
    speedBeam: null, gescanntBeam: null, bordAmTransferBeam: null, bordRolle: null,
    menschBefehleOpsSteuer: 0, menschBefehleOpsSteuerArten: [], menschStationen: [],
    abweisungen: 0, ansagen: [], oda: [], notrueckholungen: 0, rueckholAbklingzeit: false, lpId: null,
  };
  // Mensch-Befehle zaehlen (der Mensch-Ersatz ist cl[0]); der Sendeweg bleibt unveraendert
  const send0 = cl[0].send.bind(cl[0]);
  cl[0].send = (m, ...r) => { if (m && m.t === 'cmd' && OPS_STEUER.test(String(m.c))) { d.menschBefehleOpsSteuer++; if (!d.menschBefehleOpsSteuerArten.includes(m.c)) d.menschBefehleOpsSteuerArten.push(m.c); } return send0(m, ...r); };
  // Ansagen des Bord-Bots (bot.antwort bord.ansage.*) und die ODA mitzaehlen
  const sendTo0 = g.sendTo.bind(g);
  g.sendTo = (conn, msg, ...r) => { if (msg && msg.befehl === 'bord.ansage') d.ansagen.push({ art: String(msg.textId || '').replace('bord.ansage.', ''), t: rel() }); return sendTo0(conn, msg, ...r); };
  const oda0 = g.oda.bind(g);
  g.oda = (text, key, ...r) => { d.oda.push({ text: String(text).slice(0, 60), codehilfe: /Codetabelle/.test(String(text)), t: rel() }); return oda0(text, key, ...r); };
  const notice0 = typeof g.notice === 'function' ? g.notice.bind(g) : null;
  if (notice0) g.notice = (pp, t2, ...r) => { if (pp === g.players[0] && /schnell|Zu weit/i.test(String(t2))) d.abweisungen++; return notice0(pp, t2, ...r); };
  const bordBot = () => { for (const rolle of ['technik', 'ops']) { const b = g.players.find((p) => p.bot && p.rolle === rolle && p.zone === 'ship' && !p.downed); if (b) return b; } return null; };
  const amTransfer = (p) => !!p && Station.stationOf(p) === 'transfer';
  let lastZ = -1e9;
  const timer = setInterval(() => {
    const s = g.ship, v = s.speed || 0, t = rel();
    if (v > d.maxSpeed) d.maxSpeed = v;
    if (d.tWahl != null && d.tStopp == null && d.maxSpeed > beamMax && v <= beamMax) d.tStopp = t;
    const b = bordBot();
    if (d.tWahl != null && d.tBordTransfer == null && amTransfer(b)) { d.tBordTransfer = t; d.bordRolle = b.rolle; }
    const me = g.players[0], st = me && me.zone === 'ship' ? Station.stationOf(me) : null;
    if (st && ['helm', 'weapons'].includes(st) && !d.menschStationen.includes(st)) d.menschStationen.push(st);
    if (g.support && g.support.recall > 0) d.rueckholAbklingzeit = true;
    if (zeile && t - lastZ >= 1000) { lastZ = t; const BL = require('../../server/bots/lauf.js'), LG = require('../../server/bots/bordlage.js'); zeile(`BORD     t ${(t / 1000).toFixed(1)} v${Math.round(v)} Stufe ${s.helm && s.helm.stage} reichweite ${LG.beamInReichweite(g)} (Abst. ${d.beamPunkt ? Math.round(Math.hypot(s.x - d.beamPunkt.x, s.y - d.beamPunkt.y)) + '/' + d.beamPunkt.range : '-'}) vorlauf ${BL.vorlaufLaeuft(g)} stoppNoetig ${BL.stoppNoetig(g)} ziel ${g.transferZiel && g.transferZiel.lp || '-'} gescannt ${d.lpId ? require('../../server/sim/lpscan.js').gescannt(g, d.lpId) : '-'} lpscan ${!!g.lpscan}`); }
  }, 50);
  return {
    d,
    // Schiff in Fahrt setzen (einmal): in Beamreichweite, seitlich zum Beam-Punkt, Kurs +x, Stufe 3; die Simulation beschleunigt von selbst
    fahren(beam) {
      k('ort-setzen');
      const s = g.ship, spd = Flight.stageSpeed(g.C.shipClasses.lerche, STUFE);
      s.docked = false; s.dockedAt = null; s.x = beam.x - VOR_PUNKT; s.y = beam.y - SEITE; s.angle = 0; s.vx = spd; s.vy = 0; s.speed = spd; s.turnVel = 0;
      if (s.helm) { s.helm.stage = STUFE; s.helm.thrust = 0; s.helm.turn = 0; s.helm.autoStop = false; }
      d.startSpeed = spd; d.beamPunkt = { x: Math.round(beam.x), y: Math.round(beam.y), range: beam.range };
    },
    gewaehlt(lpId) { d.tWahl = rel(); d.lpId = lpId; },
    // missionEvent-Fuehler des Laeufers: beamedDown (Zustand genau jetzt), landepunktGescannt, beamedUp mit Notrueckholung
    ereignis(kk, dd) {
      if (kk === 'landepunktGescannt' && d.tScan == null) d.tScan = rel();
      if (kk === 'beamedDown' && d.tBeam == null) {
        d.tBeam = rel(); d.speedBeam = g.ship.speed || 0;
        d.gescanntBeam = !!(d.lpId && require('../../server/sim/lpscan.js').gescannt(g, d.lpId));
        d.bordAmTransferBeam = amTransfer(bordBot());
      }
      if (kk === 'beamedUp' && dd && dd.notrueckholung) d.notrueckholungen++;
    },
    beenden() { clearInterval(timer); cl[0].send = send0; return d; },
  };
}

// reine Pruefung (Gruende: Abnahme 5 und 7). nGebeamtBots, botsDown und g.errors prueft der Laeufer selbst wie im Modus --server-bots
function auswerten(d) {
  const p = [];
  const sek = (ms) => (ms == null ? '-' : (ms / 1000).toFixed(1) + ' s');
  p.push({ ok: d.startSpeed != null && d.startSpeed > d.beamMax && d.maxSpeed > d.beamMax, text: `Schiff fuhr vor dem Beam ueber der Beamgrenze (Start ${Math.round(d.startSpeed || 0)}, hoechstes Tempo ${Math.round(d.maxSpeed)}, Grenze ${d.beamMax}, Stufe ${d.stufe})` });
  p.push({ ok: d.tScan != null && d.menschBefehleOpsSteuerArten.every((c) => c !== 'weapons.landescan'), text: `Landepunkt gescannt durch den Ops-Bot (landepunktGescannt nach ${sek(d.tScan)} ab Wahl, Mensch-Ersatz sandte kein weapons.landescan)` });
  p.push({ ok: d.tBeam != null && d.gescanntBeam === true && d.tScan != null && d.tScan <= d.tBeam, text: `Landepunkt war beim Beam gescannt (Scan ${sek(d.tScan)}, Beam ${sek(d.tBeam)} nach Laufstart)` });
  p.push({ ok: d.speedBeam != null && d.speedBeam <= d.beamMax && d.tStopp != null && d.tBeam != null && d.tStopp <= d.tBeam, text: `Schiff stand beim Beam (Tempo ${d.speedBeam == null ? '-' : Math.round(d.speedBeam * 10) / 10}, Grenze ${d.beamMax}; Navigations-Bot hat gestoppt: Tempo ab ${sek(d.tStopp)}, Beam ${sek(d.tBeam)}; ${d.abweisungen} abgewiesene Beamversuche des Menschen)` });
  p.push({ ok: d.tBeam != null && d.tBordTransfer != null && (d.bordAmTransferBeam === true || d.tBordTransfer <= d.tBeam + NACH_BEAM_MS), text: `Bord-Bot (${d.bordRolle || '?'}) stand am Transfer beim Beam oder kurz danach (am Transfer ab ${sek(d.tBordTransfer)}, Beam ${sek(d.tBeam)}, beim Beam dort: ${d.bordAmTransferBeam})` });
  p.push({ ok: d.menschBefehleOpsSteuer === 0, text: `Mensch-Ersatz bediente nie Ops oder Steuer (Befehle weapons.*/helm.*: ${d.menschBefehleOpsSteuer}${d.menschBefehleOpsSteuerArten.length ? ' ' + d.menschBefehleOpsSteuerArten.join(',') : ''}; Stationen unterwegs: ${d.menschStationen.join(',') || '-'})` });
  p.push({ ok: d.notrueckholungen === 0 && !d.rueckholAbklingzeit, text: `Notrueckholungen 0 (${d.notrueckholungen}, Abklingzeit der Rueckholung gesehen: ${d.rueckholAbklingzeit})` });
  return p;
}

function zusatz(d) {
  const arten = {};
  for (const a of d.ansagen) arten[a.art] = (arten[a.art] || 0) + 1;
  return { ansagen: d.ansagen.length, ansagenArten: arten, odaFunk: d.oda.length, odaCodehilfe: d.oda.filter((o) => o.codehilfe).length, odaTexte: d.oda.map((o) => o.text), rueckholung: d.notrueckholungen > 0 || d.rueckholAbklingzeit };
}

module.exports = { pruefArgs, messung, auswerten, zusatz, STUFE, VOR_PUNKT, SEITE, GEHZEIT_MS, NACH_BEAM_MS };
