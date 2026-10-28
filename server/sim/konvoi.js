'use strict';
// EK3 Teil B (CONTRACT-EK3B): Konvoi-Szene. 1–3 Transporter (Klasse frachter, Gegnerseite, unbewaffnet) fahren eine Route aus Wegpunkten und springen
// am Ende; Eskorte aus Jäger und Korvette fährt mit. Zwei Siegbedingungen: aufhalten (alle Transporter zerstören, bevor sie springen) und
// pluendern (zerstörte Transporter lassen Fracht fallen, die Ops beamt sie an Bord, siehe fracht.js).
//
// Zustand (nur im Raum, je Szene neu): game.space.konvoi = null | { sieg, art, nWunsch, beuteMin, wiederholung, route [{x,y}], ids [Transporter-ID],
//   fertig { id: 'zerstoert'|'gesprungen' }, pos { id: {x,y} } (letzte Lage), pods [Fracht-ID], alarm, ausgang, neuAt, versuch, szene, ansagt [s] }.
//   Transporter und Eskorte sind gewöhnliche Gegner in space.enemies (kind frachter | raider | korvette) mit e.kv = 'f' | 'e'; Transporter fahren über
//   Flight.stepBody (shipClasses.frachter) und Pilot.escort (Wegpunkt-Steuerung), Hülle und Schilde kommen aus CONFIG.enemies/enemyShields wie bei jedem
//   Gegner (Schaden, Zerstörung, Marken: space.damageEnemy). Die Eskorte (e.wache) fährt mit dem Konvoi und schießt nicht, bis die Lerche näher als
//   konvoi.wachRadius kommt oder ein Konvoi-Schiff getroffen wird; danach gilt die Klassen-KI (space.updateEnemies) wie bei jedem Gegner.
// Ausgänge (Kennungen): 'gepluendert' (Fracht an Bord) | 'aufgehalten' (alle Transporter zerstört) | 'entkommen' (Konvoi springt, Szene gescheitert,
//   bei wiederholung kommt nach neuNach s ein neuer Konvoi) – Prüfungen konvoi_ausgang / konvoi_erfolg (Bausteine).
// Haken in space.js: updateEnemies (faehrt/fahre), update (update), enemySnapExtra (snapExtra). Sonst nichts.
const Flight = require('../../shared/flight.js');
const Pilot = require('./pilot.js');
const Fracht = require('./fracht.js');
const Zielsysteme = require('./zielsysteme.js');

let spaceMod = null;   // lazy (Zirkelbezug space -> konvoi)
const space = () => spaceMod || (spaceMod = require('./space.js'));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const r2 = (v) => Math.round(v * 100) / 100;

const SIEGE = ['aufhalten', 'pluendern'];
const ESKORTEN = ['voll', 'jaeger', 'korvette', 'keine'];
const AUSGAENGE = ['gepluendert', 'aufgehalten', 'entkommen'];
const ZAHL = ['', 'ein', 'zwei', 'drei', 'vier'];
const ARTNAME = { sprengstoff: 'Sprengstoff', fracht: 'Fracht' };

function cfg(game) { return game.C.konvoi || {}; }
function st(game) { return (game.space && game.space.konvoi) || null; }
const lebt = (game, id) => game.space.enemies.find((e) => e.id === id) || null;
const mitglieder = (game, kv) => game.space.enemies.filter((e) => e.kv && (!kv || e.kv === kv));
function transporter(game) { const k = st(game); return k ? k.ids.map((id) => lebt(game, id)).filter(Boolean) : []; }

// ---------- Abfragen (Bausteine, Tests, Bots) ----------
function aktiv(game) { return !!st(game); }
function ausgang(game) { const k = st(game); return k ? k.ausgang : null; }
function erfolg(game) { const k = st(game); return !!(k && (k.ausgang === 'gepluendert' || k.ausgang === 'aufgehalten')); }
function ausgangIst(game, was) { return ausgang(game) === was; }
function faehrt(e) { return !!e && (e.kv === 'f' || e.wache === true); }
function uebrig(game) { return transporter(game).length; }
function gesprungen(game) { const k = st(game); return k ? k.ids.filter((id) => k.fertig[id] === 'gesprungen').length : 0; }
function zerstoert(game) { const k = st(game); return k ? k.ids.filter((id) => k.fertig[id] === 'zerstoert').length : 0; }

// ---------- Route ----------
// Wegpunkte aus Anteilen (Länge × Breite der Szene); der Konvoi fährt von der Seite der Lerche weg (gespiegelt, wenn sie in der zweiten Hälfte steht)
function routeFuer(game) {
  const sp = game.space; const L = game.ship; const C = cfg(game); const M = Number(C.rand) || 250;
  const horiz = sp.w >= sp.h;
  const lang = horiz ? sp.w : sp.h, kurz = horiz ? sp.h : sp.w;
  const vonUnten = (horiz ? L.x : L.y) < lang / 2;
  return (C.route || [[0.3, 0.75], [0.5, 0.25], [0.7, 0.8], [0.94, 0.5]]).map(([u, v]) => {
    const a = clamp((vonUnten ? u : 1 - u) * lang, M, lang - M), b = clamp(v * kurz, M, kurz - M);
    return horiz ? { x: a, y: b } : { x: b, y: a };
  });
}
function restStrecke(k, e) {
  let d = 0; let px = e.x, py = e.y;
  for (let i = Math.min(e.wp || 1, k.route.length - 1); i < k.route.length; i++) { d += dist(px, py, k.route[i].x, k.route[i].y); px = k.route[i].x; py = k.route[i].y; }
  return d;
}

// ---------- Einrichten ----------
// o: { n (1–3), eskorte ('voll'|'jaeger'|'korvette'|'keine'), sieg ('aufhalten'|'pluendern'), ladung ('sprengstoff'|'fracht'), tempo?, beute_min?, wiederholung?,
//      volk? (Kennung aller Konvoi-Schiffe; sonst space.volkFuer: Fraktion des Sektors bzw. Standard) }
function an(game, o) {
  const q = o || {}; const C = cfg(game);
  const nW = clamp(Math.round(Number(q.n != null ? q.n : C.n) || 2), 1, C.nMax || 3);
  const art = game.C.fracht.arten.includes(q.ladung) ? q.ladung : game.C.fracht.artDefault;
  const sieg = SIEGE.includes(q.sieg) ? q.sieg : 'pluendern';
  const eskorte = ESKORTEN.includes(q.eskorte) ? q.eskorte : 'voll';
  const cap = Math.max(1, Fracht.capacity(game));
  const beuteMin = clamp(Math.round(Number(q.beute_min) || Math.min(nW, cap)), 1, Math.min(nW, cap));
  game.space.konvoi = {
    sieg, art, nWunsch: nW, beuteMin, eskorte, wiederholung: q.wiederholung !== false, volk: q.volk || null, tempo: q.tempo != null ? Number(q.tempo) : null,
    route: routeFuer(game), ids: [], fertig: {}, pos: {}, pods: [], alarm: false, ausgang: null, neuAt: null, versuch: 1, szene: game.ship.scene, ansagt: [],
  };
  spawnen(game);
  return game.space.konvoi;
}
function spawnen(game) {
  const k = st(game); const C = cfg(game); const S = space();
  // Plündern: schon an Bord liegende Ladung dieser Art zählt (eine Ladung bleibt bis zum Systemwechsel an Bord), der Rest des Konvois ist kleiner
  const schonDa = k.sieg === 'pluendern' ? Math.min(Fracht.anBord(game, k.art), k.beuteMin - 1) : 0;
  const nT = Math.max(1, k.nWunsch - schonDa);
  k.beuteMin = Math.min(k.beuteMin, Math.max(1, Fracht.capacity(game)));
  const a = k.route[0], b = k.route[1];
  const head = Math.atan2(b.y - a.y, b.x - a.x);
  const ux = Math.cos(head), uy = Math.sin(head);
  k.ids = []; k.fertig = {}; k.pos = {}; k.pods = []; k.alarm = false; k.ausgang = null; k.neuAt = null; k.ansagt = []; k.t0 = game.time;
  for (let i = 0; i < nT; i++) {
    const off = i * (C.abstand || 130); const lat = (i % 2 ? 1 : -1) * Math.min(1, i) * 45;
    const e = S.spawnEnemy(game, 'frachter', { x: a.x - ux * off - uy * lat, y: a.y - uy * off + ux * lat, facing: head, tag: 'konvoi', volk: k.volk || undefined });
    e.kv = 'f'; e.wp = 1; e.sprung = null;
    const c = klasse(game, e.kind);
    const v = c ? Flight.stageSpeed(c, stufeFuer(c, tempoFuer(game, k, c))) : 0;
    e.vx = Math.cos(head) * v; e.vy = Math.sin(head) * v; e.stage = c ? stufeFuer(c, tempoFuer(game, k, c)) : 0; e.turnVel = 0;
    k.ids.push(e.id); k.pos[e.id] = { x: e.x, y: e.y };
  }
  const kor = k.eskorte === 'voll' || k.eskorte === 'korvette'; const jag = k.eskorte === 'voll' || k.eskorte === 'jaeger';
  const sp0 = { x: a.x, y: a.y };
  const E = [];
  if (kor) E.push('korvette');
  if (jag) E.push('raider');
  E.forEach((kind, i) => {
    const side = i % 2 ? -1 : 1;
    const e = S.spawnEnemy(game, kind, { x: sp0.x + (-uy * side) * (C.flankAbstand || 170) - ux * 40, y: sp0.y + (ux * side) * (C.flankAbstand || 170) - uy * 40, facing: head, tag: 'konvoi_eskorte', volk: k.volk || undefined });
    e.kv = 'e'; e.wache = true; e.kvSide = side;
    const c = klasse(game, kind);
    if (c) { e.stage = Flight.agileStage(c); const v = Math.max(c.minSpeed || 0, Flight.stageSpeed(c, e.stage)); e.vx = Math.cos(head) * v; e.vy = Math.sin(head) * v; e.turnVel = 0; }
  });
  // Kontakt (Funktext Rabenpass): Zusammensetzung des Konvois
  const teile = [];
  if (jag) teile.push('ein Jäger');
  if (kor) teile.push('eine Korvette');
  teile.push(`${ZAHL[nT] || nT} Transporter`);
  game.oda(`Konvoi voraus: ${teile.join(', ')}.`, null);
  game.missionEvent('konvoiKontakt', { n: nT, eskorte: k.eskorte, sieg: k.sieg, versuch: k.versuch });
}
function klasse(game, kind) { const SC = game.C.shipClasses; return SC ? SC[kind] || null : null; }
function tempoFuer(game, k, c) { return (k.tempo != null ? k.tempo : (cfg(game).tempo || 0.45)) * c.maxSpeed; }
function stufeFuer(c, speed) {
  let best = Flight.stopStage(c), bd = Infinity;
  (c.stages || [0]).forEach((s, i) => { if (s < 0) return; const d = Math.abs(s * c.maxSpeed - speed); if (d < bd) { bd = d; best = i; } });
  return best;
}
// Wiederholung: Reste des Konvois (Eskorte, Transporter) weg, neuer Konvoi am Start. Fracht, die schon an Bord ist, bleibt.
function neu(game) {
  const k = st(game); if (!k) return;
  game.space.enemies = game.space.enemies.filter((e) => !e.kv);
  if (game.ship.target && !game.space.enemies.some((e) => e.id === game.ship.target)) game.ship.target = null;
  k.versuch++;
  k.route = routeFuer(game);
  game.oda('Ein neuer Konvoi rollt auf derselben Route an – diesmal nicht entkommen lassen.', null);
  spawnen(game);
}

// ---------- Fahren (aus space.updateEnemies, nur für Konvoi-Schiffe) ----------
function fahre(game, e, dt) {
  const k = st(game);
  if (!k) { e.kv = null; e.wache = false; return; }
  if (e.kv === 'f') return void fahreTransporter(game, k, e, dt);
  return void fahreEskorte(game, k, e, dt);
}
function steuern(game, e, c, goal, dt) {
  const input = Pilot.escort(game, e, c, goal);
  Flight.stepBody(e, input, c, { speedFactor: e.tempoAn ? Zielsysteme.tempoFaktor(e) : 1 }, dt);   // SUND-04a-1 A: Antrieb des Transporters (ohne e.zs 1)
  const sp = game.space; const m = 40;
  if (e.x < m) { e.x = m; e.vx = Math.max(0, e.vx); }
  if (e.x > sp.w - m) { e.x = sp.w - m; e.vx = Math.min(0, e.vx); }
  if (e.y < m) { e.y = m; e.vy = Math.max(0, e.vy); }
  if (e.y > sp.h - m) { e.y = sp.h - m; e.vy = Math.min(0, e.vy); }
}
function fahreTransporter(game, k, e, dt) {
  const C = cfg(game); const c = klasse(game, e.kind);
  const last = k.route.length - 1;
  // Regeneration der Schilde wie bei jedem Gegner läuft in space.updateEnemies (vor diesem Aufruf)
  const wp = k.route[Math.min(e.wp, last)];
  const zuLang = game.time - k.t0 > (C.springSpaetestens || 180);   // Notbremse: ein Konvoi, der sich festfährt, springt trotzdem
  if (e.sprung == null && ((e.wp >= last && dist(e.x, e.y, wp.x, wp.y) < (C.wpRadius || 90)) || zuLang)) {
    e.sprung = 0; e.sprungDauer = C.springDauer || 4;
    game.emit('sfx', { name: 'jump_charge' });
    game.oda('Ein Transporter lädt den Sprung auf!', null);
    game.missionEvent('konvoiSprungStart', { enemy: e });
  } else if (e.sprung == null && e.wp < last && dist(e.x, e.y, wp.x, wp.y) < (C.wpRadius || 90)) e.wp++;
  let goal;
  let speed = tempoFuer(game, k, c);
  if (k.alarm) speed = Math.min(c.maxSpeed, speed * (1 + 0.5 * (Number(C.eilig) || 0)));
  if (e.sprung != null) {
    e.sprung += dt;
    goal = { x: e.x + Math.cos(e.angle) * 400, y: e.y + Math.sin(e.angle) * 400, speed, stopDist: 0 };
  } else goal = { x: wp.x, y: wp.y, speed, stopDist: 0 };
  steuern(game, e, c, goal, dt);
  // Brocken: wie bei jedem Gegner (hinausschieben, Treffer)
  const S = space();
  if (game.space.asteroids.length) {
    S.brockenStoss(game, e, c.radius || 34, (a) => {
      const im = e.brockenImmun || (e.brockenImmun = {});
      if ((im[a.id] || 0) > game.time) return;
      im[a.id] = game.time + game.C.flight.asteroidImmunity;
      S.brockenStats(game).gegner++;
      const h0 = e.hitT;   // ein Brocken ist kein Angriff der Lerche: löst keinen Alarm der Eskorte aus
      S.damageEnemy(game, e, game.C.asteroid.damage, a.x, a.y);
      e.hitT = h0;
    });
  }
}
function fahreEskorte(game, k, e, dt) {
  const T = transporter(game).filter((t) => t.sprung == null);
  const lead = T[0] || transporter(game)[0];
  if (!lead || !e.wache) { e.wache = false; return; }
  const C = cfg(game); const c = klasse(game, e.kind);
  let goal;
  if (e.kind === 'raider') {
    // Jäger kreisen um den Konvoi (Mindesttempo, kein Stehen)
    const th = Math.atan2(e.y - lead.y, e.x - lead.x);
    const R = C.orbitR || 250;
    goal = { x: lead.x + Math.cos(th + 0.7) * R, y: lead.y + Math.sin(th + 0.7) * R, speed: c.maxSpeed * 0.7, stopDist: 0 };
  } else {
    // Korvette hält Platz querab des führenden Transporters
    const side = e.kvSide || 1; const f = C.flankAbstand || 170;
    const gx = lead.x + Math.cos(lead.angle + side * Math.PI / 2) * f, gy = lead.y + Math.sin(lead.angle + side * Math.PI / 2) * f;
    const lv = Math.hypot(lead.vx || 0, lead.vy || 0);
    goal = { x: gx, y: gy, speed: clamp(lv * 1.05 + dist(e.x, e.y, gx, gy) * 0.5, 0, c.maxSpeed), stopDist: 20 };
  }
  steuern(game, e, c, goal, dt);
}

// ---------- Tick (aus space.update, nach updateEnemies) ----------
function update(game, dt) {
  const k = st(game);
  if (!k) return;
  const sp = game.space; const C = cfg(game);
  if (k.szene !== game.ship.scene) { sp.konvoi = null; return; }   // Szene verlassen: Konvoi ist weg
  // Lage der Transporter merken, Zerstörte und Gesprungene erkennen
  for (const id of k.ids) {
    const e = lebt(game, id);
    if (e) { k.pos[id] = { x: e.x, y: e.y }; if (e.sprung != null && e.sprung >= (C.springDauer || 4) && !k.fertig[id]) springen(game, k, e); continue; }
    if (k.fertig[id]) continue;
    k.fertig[id] = 'zerstoert';
    verloren(game, k, id);
  }
  // Alarm: Lerche nah oder ein Konvoi-Schiff getroffen -> Eskorte greift an, Transporter fahren schneller
  if (!k.alarm) {
    const L = game.ship; const ms = mitglieder(game);
    const getroffen = ms.some((e) => e.hitT > 0) || k.ids.some((id) => k.fertig[id] === 'zerstoert');
    const nah = ms.some((e) => e.kv === 'f' && dist(e.x, e.y, L.x, L.y) < (C.wachRadius || 520));
    if (ms.length && (getroffen || nah)) {
      k.alarm = true;
      const esk = ms.filter((e) => e.kv === 'e');
      for (const e of esk) e.wache = false;
      if (esk.length) game.oda('Die Eskorte hat uns bemerkt – sie greift an!', null);
      game.missionEvent('konvoiAlarm', { grund: getroffen ? 'treffer' : 'nah' });
    }
  }
  // Eskorte ohne Konvoi greift an
  if (!transporter(game).length) for (const e of mitglieder(game, 'e')) e.wache = false;
  // Ansagen vor dem Sprung (Zeit bis zum Sprung des vordersten Transporters)
  if (!k.ausgang) {
    const T = transporter(game);
    if (T.length) {
      let eta = Infinity;
      for (const e of T) {
        const v = Math.max(10, Math.hypot(e.vx || 0, e.vy || 0));
        eta = Math.min(eta, e.sprung != null ? Math.max(0, (C.springDauer || 4) - e.sprung) : restStrecke(k, e) / v + (C.springDauer || 4));
      }
      for (const s of C.ansagen || []) if (eta <= s && !k.ansagt.includes(s)) { k.ansagt.push(s); game.oda(`Der Konvoi springt in etwa ${s} s!`, null); }
    }
  }
  bewerten(game, k);
  if (k.ausgang === 'entkommen' && k.wiederholung && k.neuAt != null && game.time >= k.neuAt) neu(game);
}
function springen(game, k, e) {
  k.fertig[e.id] = 'gesprungen';
  game.space.enemies = game.space.enemies.filter((o) => o !== e);
  if (game.ship.target === e.id) game.ship.target = null;
  game.emit('sfx', { name: 'jump' });
  game.emit('konvoiSprung', { x: Math.round(e.x), y: Math.round(e.y) });
  game.oda('Transporter gesprungen – weg ist er.', null);
  game.missionEvent('konvoiSprung', { id: e.id, x: e.x, y: e.y });
}
function verloren(game, k, id) {
  const p = k.pos[id] || { x: game.ship.x, y: game.ship.y };
  const pod = Fracht.fracht_abwerfen(game, p.x, p.y, k.art);
  if (pod) {
    k.pods.push(pod.id);
    if (k.sieg === 'pluendern') game.oda('Fracht in Reichweite. Ops, beamen!', null);
  }
  game.missionEvent('konvoiTransporterZerstoert', { id, art: k.art, x: p.x, y: p.y, pod: pod ? pod.id : null });
}
function podsDa(game, k) { const d = Fracht.draussen(game); return k.pods.filter((id) => d.some((q) => q.id === id)).length; }
function podsGeholt(game, k) { const d = Fracht.draussen(game); return k.pods.filter((id) => !d.some((q) => q.id === id)).length; }
// Siegbedingungen prüfen (einmal je Versuch)
function bewerten(game, k) {
  if (k.ausgang) return;
  const alive = uebrig(game);
  let neuer = null;
  if (k.sieg === 'aufhalten') {
    if (k.ids.some((id) => k.fertig[id] === 'gesprungen')) neuer = 'entkommen';
    else if (k.ids.length && alive === 0) neuer = 'aufgehalten';
  } else {
    const an = Fracht.anBord(game, k.art);
    if (an >= k.beuteMin && podsGeholt(game, k) >= 1) neuer = 'gepluendert';
    else if (an + podsDa(game, k) + alive < k.beuteMin) neuer = 'entkommen';
  }
  if (neuer) setzeAusgang(game, k, neuer);
}
function setzeAusgang(game, k, was) {
  k.ausgang = was;
  const text = {
    gepluendert: 'Das war\'s. Beute an Bord – nichts wie weg, bevor die Eskorte Verstärkung ruft.',
    aufgehalten: 'Alle Transporter zerstört – dieser Konvoi kommt nirgends mehr an.',
    entkommen: k.sieg === 'pluendern' ? 'Der Konvoi ist durch – die Beute ist weg.' : 'Der Konvoi ist durch! Sie sind gesprungen.',
  }[was];
  game.oda(text, null);
  game.emit('konvoiAusgang', { was });
  game.missionEvent('konvoiAusgang', { was, sieg: k.sieg, versuch: k.versuch });
  if (was === 'entkommen' && k.wiederholung) k.neuAt = game.time + (cfg(game).neuNach || 8);
}
// Regiebuch-Überspringen (Baustein konvoi_ende): Szene als geschafft werten, Eskorte raus
function erzwingen(game) {
  const k = st(game); if (!k) return false;
  if (!k.ausgang || k.ausgang === 'entkommen') { k.neuAt = null; setzeAusgang(game, k, k.sieg === 'aufhalten' ? 'aufgehalten' : 'gepluendert'); }
  return true;
}

// ---------- Snapshot ----------
// Ergänzung je Gegner: sj = Fortschritt der Sprungaufladung 0..1 (nur Transporter beim Sprung)
function snapExtra(e) {
  if (!e || e.kv !== 'f' || e.sprung == null) return null;
  return { sj: r2(Math.min(1, e.sprung / (e.sprungDauer || 4))) };
}

// ---------- Debug: konvoi [n] [aufhalten|pluendern] [keine|jaeger|korvette] ----------
function debug(game, args) {
  const a = Array.isArray(args) ? args.map(String) : [];
  if (game.ship.docked) return 'Nicht angedockt.';
  const n = a.map(Number).find((x) => Number.isFinite(x) && x > 0);
  an(game, { n, sieg: a.find((x) => SIEGE.includes(x)), eskorte: a.find((x) => ESKORTEN.includes(x)) });
  return null;
}

module.exports = {
  an, neu, fahre, faehrt, update, snapExtra, erzwingen, debug,
  aktiv, ausgang, erfolg, ausgangIst, uebrig, gesprungen, zerstoert, transporter, mitglieder,
  SIEGE, ESKORTEN, AUSGAENGE, ARTNAME,
};
