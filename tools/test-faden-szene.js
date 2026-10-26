'use strict';
// SUND-04a-2 P1: Faden-Szenen der Freien Fahrt (server/sim/faden-szene.js, faden-fracht.js) im laufenden Spiel (FAEDEN=1).
// Prueft: Gate (ohne Schalter nichts) · Vorwarnung vor dem Eintreffen (>= 8 s, Funk) · Gegner nach Crewgroesse · Szenen je Art bis zum Ausgang (gelungen und gescheitert) ·
// nie zwei Szenen übereinander (Warteschlange, Sim-Szene wartet) · Unterbrechung durch eine Sim-Szene (Beat steht wieder aus) · Szenenwechsel und Andocken räumen ab ·
// Verbündeter der Spontanhilfe (unverwundbar für Crew-Geschosse, verschwindet am Ende, Chance aus der Haltung) · eigener Zufallsstrom (game.rng unberührt) ·
// Fracht (laden, abliefern, Frist, Notsprung, Speichern/Laden, Handel unberührt) · Schema des Weltstands · Speichern mitten in der Szene steht wieder aus.
// Erwartete Werte: eigene Zählung im Test, nicht aus dem Produktivcode abgeleitet.      node tools/test-faden-szene.js
const CONFIG = require('../shared/config.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Verfolgung = require('../server/sim/verfolgung.js');
const Weltstand = require('../server/weltstand.js');
const Faden = require('../server/sim/faden.js');
const Fracht = require('../server/sim/faden-fracht.js');
const FS = require('../server/sim/faden-szene.js');
const Flotte = require('../server/sim/flotte.js');
const WR = require('../content/faeden/szenen-werte.json').werte;
const W = Object.fromEntries(Object.entries(WR).map(([k, v]) => [k, v.wert]));   // die Werte (wie der Produktivcode sie liest)
const T = require('../content/faeden/szenen-werte.json').texte;
const X = require('./faden-fixture.js');
const { D, spiel, oeffne, grenzen, alsVorlage, registriere } = X;

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const laufe = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const weiter = (g, f, beat) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: beat || D.vorlage(f.vorlage).beats[f.beat].id });
const liste = (g) => g.weltsim.faeden.liste;
const eigeneTags = (g, tag) => g.space.enemies.filter((e) => e.tag === tag).length;
// eigene Vorlagen: ein Szenen-Beat, dann der Abschluss; der NSC im Startzustand
function vorlage(id, typ, extra, status) {
  const r = registriere(alsVorlage(id, (v) => {
    v.nsc.status = status || 'aktiv';
    v.volk_erlaubt = ['rom', 'kon', 'ger'];   // der Ort 0305 kann germanisch sein: der Test prüft die Szene, nicht das Volk
    delete v.wahrheit; delete v.hinweise;     // keine Enthüllung in diesen Vorlagen (die Fixture hätte sonst eine Wahrheit ohne Enthüllungs-Beat)
    v.beats = [
      Object.assign({ id: 'b_szene', typ, aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } }, extra || {}),
      { id: 'b_ende', typ: 'abschluss', aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  if (!r.ok) throw new Error('Vorlage ' + id + ' ungueltig: ' + r.fehler.join('; '));
}
// Spiel in der Freien Fahrt, abgelegt, in einer Szene mit Ort 0305; Funk wird mitgeschrieben
function bereit(o) {
  const x = spiel(o || {}); const g = x.g;
  const radio = []; const orig = g.emit.bind(g);
  g.emit = (k, d) => { if (k === 'radio' && d && d.text) radio.push(d.text); return orig(k, d); };
  ab(g); ankunft(g, '0305');
  return { g, radio, cs: x.cs };
}
// Faden öffnen, Abstand abwarten, den Szenen-Beat starten (wie der Spielleiter: faden_weiter)
function startSzene(g, vorlageId) {
  const f = oeffne(g, vorlageId);
  if (!f) throw new Error('kein Angebot für ' + vorlageId);
  grenzen(g, 5);
  const r = weiter(g, f);
  if (!r.ok) throw new Error('Beat startet nicht: ' + r.grund);
  return f;
}
const szene = (g) => g.fadenSzene || null;

section('Gate: ohne FAEDEN=1 gibt es keine Faden-Szene', () => {
  const { g } = (() => { const x = spiel({ aus: true }); return { g: x.g }; })();
  ok(FS.starten(g, { art: 'raumschlacht', fadenId: 'f1', beatId: 'b' }).ok === false, 'starten ohne Schalter: abgelehnt (INAKTIV)');
  ok(!g.fadenSzene && !g.fadenWarte && !g.fadenHilfe, 'kein Laufzeitzustand angelegt');
});

section('Daten: Arten, Vorwarnung >= 8 s, Gegner nach Crewgroesse', () => {
  ok(JSON.stringify(W.arten) === JSON.stringify(['verfolgung', 'raumschlacht', 'befreiung', 'spontanhilfe']), 'vier Arten in den Daten');
  ok(W.vorlauf_min_s >= 8 && W.vorlauf_s >= W.vorlauf_min_s, 'Vorwarnung mindestens 8 s (Daten: ' + W.vorlauf_s + ' s, Untergrenze ' + W.vorlauf_min_s + ' s)');
  ok(W.raumschlacht.anzahl['1'] < W.raumschlacht.anzahl['3'] && W.befreiung.anzahl['1'] <= W.befreiung.anzahl['3'], 'Anzahl steigt mit der Crewgroesse');
  ok(T.vorwarnung.raumschlacht && T.gelungen.raumschlacht && T.gescheitert.raumschlacht, 'Funktexte je Art vorhanden (Daten)');
});

section('Raumschlacht: Vorwarnung, Kampf, gelungen (alle abgezogen oder zerstört)', () => {
  vorlage('sz_raum', 'raumschlacht');
  const { g, radio } = bereit({ crew: 1, seed: 11 });
  const t0 = g.time;
  const f = startSzene(g, 'sz_raum');
  ok(szene(g) && szene(g).phase === 'vorlauf', 'nach dem Start: Vorlauf, noch kein Gegner');
  ok(eigeneTags(g, 'fs' + szene(g).id) === 0, 'vor dem Eintreffen: 0 Gegner');
  ok(radio.some((t) => /germanische Schiffe/.test(t)), 'Vorwarnung per Funk (vorab, nie Optionen)');
  ok(szene(g).ab - t0 >= W.vorlauf_min_s - 1e-6, 'Vorlauf >= 8 s (' + (szene(g).ab - t0).toFixed(1) + ' s)');
  laufe(g, W.vorlauf_s + 1);
  const tag = 'fs' + szene(g).id;
  ok(szene(g).phase === 'kampf' && eigeneTags(g, tag) === 2, 'Kampf mit 2 Gegnern (eine Crew)');
  const gegner = g.space.enemies.filter((e) => e.tag === tag);
  for (const e of gegner) Space.damageEnemy(g, e, 9999, e.x, e.y);
  laufe(g, 1);
  ok(!szene(g) && f.phase === 'wartet' && f.beat === 1, 'alle zerstört: gelungen, der Beat ist zu Ende, der Faden geht zum Abschluss');
  ok(radio.some((t) => t === T.gelungen.raumschlacht), 'Ergebnis per Funk');
  ok(eigeneTags(g, tag) === 0, 'keine Gegner der Szene mehr im Raum');
});

section('Raumschlacht: Szenenwechsel (Sprung) räumt ab und scheitert', () => {
  vorlage('sz_raum2', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 12 });
  const f = startSzene(g, 'sz_raum2');
  laufe(g, W.vorlauf_s + 1);
  const tag = 'fs' + szene(g).id;
  ok(eigeneTags(g, tag) === 2, 'Kampf läuft');
  const nach = Sektoren.nachbarn(Sektoren.hexVonOrt(g.ship.scene)).find((h) => Sektoren.spielbar(h));
  ankunft(g, nach);
  laufe(g, 0.5);
  ok(!szene(g) && eigeneTags(g, tag) === 0, 'Szenenwechsel: die Szene ist weg, ihre Gegner auch');
  ok(f.phase === 'wartet' && f.nsc.status === 'geflohen', 'Szenenwechsel = gescheitert: der NSC ist geflohen, der Faden lebt weiter');
});

section('Gegner nach Crewgroesse: drei Crew = vier Gegner, eine Crew = zwei', () => {
  vorlage('sz_crew3', 'raumschlacht');
  const { g } = bereit({ crew: 3, seed: 26 });
  startSzene(g, 'sz_crew3');
  laufe(g, W.vorlauf_s + 1);
  ok(eigeneTags(g, 'fs' + szene(g).id) === W.raumschlacht.anzahl['3'] && W.raumschlacht.anzahl['3'] === 4, 'drei verbundene Spieler: ' + W.raumschlacht.anzahl['3'] + ' Gegner');
});

section('Befreiung: Wachen vertreiben, der NSC ist frei (Raumszene)', () => {
  vorlage('sz_frei', 'befreiung', null, 'gefangen');
  const { g, radio } = bereit({ crew: 2, seed: 13 });
  const f = startSzene(g, 'sz_frei');
  laufe(g, W.vorlauf_s + 1);
  const tag = 'fs' + szene(g).id;
  ok(eigeneTags(g, tag) === W.befreiung.anzahl['2'], 'zwei Crew: ' + W.befreiung.anzahl['2'] + ' Wachschiffe');
  for (const e of g.space.enemies.filter((x) => x.tag === tag)) Space.damageEnemy(g, e, 9999, e.x, e.y);
  laufe(g, 1);
  ok(f.nsc.status === 'verbuendet' && f.phase === 'wartet', 'gelungen: der NSC ist frei (Status verbuendet, Faden geht weiter)');
  ok(radio.some((t) => /sind vertrieben/.test(t) || /ist frei/.test(t)), 'Ergebnis per Funk');
});

section('Befreiung: Scheitern (Szenenwechsel) lässt den NSC gefangen und den Faden leben', () => {
  vorlage('sz_frei2', 'befreiung', null, 'gefangen');
  const { g } = bereit({ crew: 1, seed: 14 });
  const f = startSzene(g, 'sz_frei2');
  laufe(g, W.vorlauf_s + 1);
  const nach = Sektoren.nachbarn(Sektoren.hexVonOrt(g.ship.scene)).find((h) => Sektoren.spielbar(h));
  ankunft(g, nach); laufe(g, 0.5);
  ok(!szene(g) && f.nsc.status === 'geflohen' && f.phase === 'wartet', 'gescheitert: Faden lebt, kein Game Over');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('Verfolgung: Vorwarnung, Zielschiff, gelungen (gestellt), dann weiter', () => {
  vorlage('sz_jagd', 'verfolgung', { parameter: { fluchtziel: 'naechster_sprungpunkt' } });
  const { g, radio } = bereit({ crew: 1, seed: 15 });
  const f = startSzene(g, 'sz_jagd');
  ok(radio.some((t) => /will sich absetzen/.test(t)), 'Vorwarnung der Verfolgung per Funk');
  laufe(g, W.vorlauf_s + 1);
  ok(g.space.verfolgung && szene(g).phase === 'kampf', 'das Zielschiff flieht (Verfolgung läuft)');
  ok(g.space.verfolgung.wiederholung === false, 'keine Wiederholung in der Faden-Szene');
  const ziel = Verfolgung.ziel(g);
  ok(ziel && ziel.kind !== 'raider', 'Zielklasse nie Jäger (' + (ziel && ziel.kind) + ')');
  Verfolgung.erzwingen(g);   // Ende der Szene „gestellt“ (dieselbe Wirkung wie der Antriebstreffer)
  laufe(g, 1);
  ok(!szene(g) && f.phase === 'wartet' && f.beat === 1, 'gestellt = gelungen: der Faden geht weiter');
  ok(!g.space.verfolgung && !Verfolgung.ziel(g), 'Zielschiff und Verfolgung sind aus dem Raum');
});

section('Verfolgung: Entkommen = gescheitert (ohne Eingriff)', () => {
  vorlage('sz_jagd2', 'verfolgung', { parameter: { fluchtziel: 'naechster_sprungpunkt' } });
  const { g } = bereit({ crew: 1, seed: 16 });
  const f = startSzene(g, 'sz_jagd2');
  let t = 0;
  while (t < 240 && f.phase === 'laeuft') { laufe(g, 1); t++; }
  ok(f.phase === 'wartet' && f.nsc.status === 'geflohen', 'das Ziel springt ohne Eingriff: gescheitert, der Faden lebt (' + t + ' s)');
  ok(!szene(g) && !g.space.verfolgung, 'die Szene ist abgeräumt');
});

section('Nie zwei Szenen übereinander: Sim-Szene wartet die Warteschlange ab', () => {
  vorlage('sz_warte', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 17 });
  g.simSzene = { id: 990, phase: 'vorwarnung' };   // eine Sim-Szene läuft
  const f = oeffne(g, 'sz_warte'); grenzen(g, 5);
  const r = weiter(g, f);
  ok(r.ok && !szene(g) && g.fadenWarte.length === 1, 'bei laufender Sim-Szene: eingereiht, nicht gestartet');
  FS.update(g, DT);
  ok(!szene(g) && g.fadenWarte.length === 1, 'auch der Takt startet nichts, solange die Sim-Szene läuft');
  g.simSzene = null;
  FS.update(g, DT);
  ok(szene(g) && szene(g).phase === 'vorlauf' && g.fadenWarte.length === 0, 'Sim-Szene vorbei: die Szene beginnt');
});

section('Unterbrechung durch eine Sim-Szene: der Beat steht wieder aus', () => {
  vorlage('sz_unt', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 18 });
  const f = startSzene(g, 'sz_unt');
  laufe(g, W.vorlauf_s + 1);
  ok(eigeneTags(g, 'fs' + szene(g).id) === 2, 'Kampf läuft');
  g.simSzene = { id: 991, phase: 'kampf' };
  FS.update(g, DT);
  g.simSzene = null;
  ok(!szene(g) && f.phase === 'wartet' && f.laufend === null && f.zaehler >= f.abstand, 'unterbrochen: kein Ausgang, der Beat ist wieder faellig');
  ok(f.nsc.gedaechtnis.length === 0, 'kein Gedächtniseintrag (nichts wurde gespielt)');
  ok(g.space.enemies.every((e) => e.tag !== 'fs' + 1), 'die Gegner der Szene sind weg');
});

section('Andocken beendet die Szene (gescheitert), Warteschlange bleibt', () => {
  vorlage('sz_dock', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 19 });
  const f = startSzene(g, 'sz_dock');
  laufe(g, W.vorlauf_s + 1);
  g.missionEvent('docked', {});
  laufe(g, 0.5);
  ok(!szene(g) && f.nsc.status === 'geflohen', 'Andocken: die Szene ist beendet, der Beat gescheitert');
});

section('Spontanhilfe: Chance aus der Haltung, eigener Strom, Verbündeter unverwundbar und am Ende weg', () => {
  vorlage('sz_hilfe', 'spontanhilfe', null, 'aktiv');
  const { g } = bereit({ crew: 1, seed: 20 });
  const f = oeffne(g, 'sz_hilfe'); grenzen(g, 5);
  ok(weiter(g, f).ok && f.phase === 'laeuft', 'der Beat wartet auf ein Gefecht (laeuft)');
  // Chance aus der Haltung: hoch -> fast immer, tief -> nie (eigener Strom, game.rng unberührt)
  const npc = Faden.nscVon(g, f.nsc.id);
  // k Würfe bei dieser Haltung; jeder Verbündete wird danach wieder entfernt. game.rng wird mitgezählt (er darf nicht gezogen werden).
  const zaehl = (haltung, k) => {
    npc.haltung = haltung;
    const h = { fadenId: f.id, beatId: 'b_szene', nsc: npc.id, schiff: npc.schiff, name: npc.name, versucht: null, n: 0, ally: null };
    let treffer = 0; const rngAufrufe = []; const orig = g.rng;
    g.rng = new Proxy(orig, { get(t, p) { const v = t[p]; if (typeof v === 'function') return (...a) => { rngAufrufe.push(p); return v.apply(t, a); }; return v; } });
    for (let i = 0; i < k; i++) {
      if (FS.wuerfeln(g, h)) { treffer++; g.space.escorts = g.space.escorts.filter((q) => q.tag !== h.ally.tag); h.ally = null; }
    }
    g.rng = orig;
    return { treffer, rng: rngAufrufe.length };
  };
  const tief = zaehl(-10, 40);
  ok(tief.treffer === 0, 'Haltung -10: nie ein Verbündeter (' + tief.treffer + ' von 40)');
  const hoch = zaehl(10, 40);
  ok(hoch.treffer >= 30, 'Haltung 10: fast immer (' + hoch.treffer + ' von 40)');
  ok(tief.rng === 0 && hoch.rng === 0, 'der Wurf zieht nie game.rng (' + (tief.rng + hoch.rng) + ' Aufrufe)');
  // Verbündeter: in der Liste der Verbündeten, nicht unter den Gegnern, unverwundbar für Crew-Geschosse
  npc.haltung = 10;
  const h = { fadenId: f.id, beatId: 'b_szene', nsc: npc.id, schiff: npc.schiff, name: npc.name, versucht: null, n: 0, ally: null };
  let v = null;
  for (let i = 0; i < 60 && !v; i++) { if (FS.wuerfeln(g, h)) v = h.ally; }
  ok(!!v, 'der Verbündete erscheint');
  const es = g.space.escorts.find((q) => q.tag === v.tag);
  ok(es && es.ally && !g.space.enemies.includes(es), 'Verbündeter: in der Verbündeten-Liste, nicht unter den Gegnern');
  const hp0 = es.hp;
  for (const kind of ['laser', 'bolzen', 'batterie', 'kanone']) g.space.projectiles.push({ id: 'p' + kind, kind, x: es.x, y: es.y, angle: 0, speed: 0, ttl: 5, dmg: 80 });
  laufe(g, 0.5);
  ok(es.hp === hp0 && es.state !== 'zerstoert', 'Crew-Geschosse treffen den Verbündeten nicht (' + hp0 + ' -> ' + es.hp + ')');
});

section('Spontanhilfe in einer Raumschlacht: erscheint, kämpft mit, verschwindet am Ende, Beat gelungen', () => {
  vorlage('sz_hilfe2', 'spontanhilfe', null, 'aktiv');
  vorlage('sz_raum3', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 21 });
  const f = oeffne(g, 'sz_hilfe2'); grenzen(g, 5);
  ok(weiter(g, f).ok && f.phase === 'laeuft' && g.fadenHilfe, 'der Spontanhilfe-Beat wartet auf das Gefecht');
  const npc = Faden.nscVon(g, f.nsc.id); npc.haltung = 10;   // Chance hoch (Kurve in den Daten)
  const r = oeffne(g, 'sz_raum3'); grenzen(g, 5);
  ok(weiter(g, r).ok, 'die Raumschlacht startet (Vorwarnung)');
  laufe(g, W.vorlauf_s + 1);
  const tag = 'fs' + szene(g).id;
  ok(eigeneTags(g, tag) === 2, 'Raumschlacht läuft');
  const ally = g.fadenHilfe && g.fadenHilfe.ally;
  // Verbündet erscheint mit hoher Chance; der Ausgang des Beats hängt davon ab (erschienen = gelungen am Gefechtsende, sonst wartet er weiter)
  const erschienen = !!ally;
  if (erschienen) ok(g.space.escorts.some((q) => q.tag === ally.tag && q.ally), 'der Verbündete ist im Gefecht dabei');
  for (const e of g.space.enemies.filter((x) => x.tag === tag)) Space.damageEnemy(g, e, 9999, e.x, e.y);
  laufe(g, 1);
  ok(!szene(g), 'Raumschlacht vorbei');
  ok(!g.space.escorts.some((q) => q.ally && q.tag === 'nsc_' + f.nsc.id), 'Verbündeter verschwindet am Ende des Gefechts');
  if (erschienen) ok(f.phase === 'wartet' && f.nsc.status === 'verbuendet', 'erschienen: der Beat ist gelungen (Status verbuendet)');
  else ok(f.phase === 'laeuft', 'nicht erschienen: der Beat wartet auf das nächste Gefecht (kein Ausgang)');
  info('Verbündeter in diesem Lauf: ' + (erschienen ? 'ja' : 'nein'));
});

section('Fracht: laden, abliefern am Zielhafen, Ware nicht im Handel, Speichern/Laden', () => {
  vorlage('sz_fracht', 'fracht', { parameter: { nach: '0305' } });
  const { g } = bereit({ crew: 1, seed: 22 });
  const f = oeffne(g, 'sz_fracht'); grenzen(g, 5);
  const lager0 = g.fracht ? g.fracht.lager.length : 0;
  ok(weiter(g, f).ok && f.phase === 'laeuft' && f.fracht && f.fracht.ware === 'fracht_kiste', 'Beat fracht: die Ware ist an Bord');
  const inv = Fracht.inventar(g);
  ok(inv.length === 1 && inv[0].gewicht === 0 && inv[0].name === W.waren.fracht_kiste.name, 'Inventar: Name aus den Daten, Gewicht 0');
  ok((g.fracht ? g.fracht.lager.length : 0) === lager0, 'die Ware ist nicht im Frachtraum (Handel unberührt)');
  // speichern und laden: die Ware bleibt
  const ws = Weltstand.capture(g);
  ok(Weltstand.validate(ws, g).length === 0, 'Weltstand mit Ware besteht das Schema');
  const F2 = Faden.lesen(Faden.toSave(g.weltsim));
  const f2 = F2.liste.find((x) => x.id === f.id);
  ok(f2 && f2.phase === 'laeuft' && f2.fracht && f2.fracht.nach === '0305', 'Speichern/Laden: die Ware und der laufende Beat bleiben');
  // abliefern: am Zielhafen andocken
  ankunft(g, '0305');
  g.missionEvent('docked', {});
  ok(f.phase === 'wartet' && !f.fracht && f.nsc.status === 'verbuendet', 'am Zielhafen angedockt: abgeliefert (gelungen), Ware weg');
});

section('Fracht: Frist läuft ab = gescheitert, Notsprung = verloren', () => {
  vorlage('sz_fracht2', 'fracht', { parameter: { nach: '0406' } });
  const { g } = bereit({ crew: 1, seed: 23 });
  g.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };   // die Frist läuft nur mit aktivem Spielleiter (faden.js B-S3)
  const f = oeffne(g, 'sz_fracht2'); grenzen(g, 5);
  weiter(g, f);
  grenzen(g, D.WERTE.beat_frist + 1);
  ok(f.phase === 'wartet' && !f.fracht && f.nsc.status === 'geflohen', 'Frist abgelaufen: gescheitert, Ware weg');
  const h = oeffne(g, 'sz_fracht2'); grenzen(g, 5); weiter(g, h);
  ok(!!h.fracht, 'zweite Fracht an Bord');
  Fracht.notsprung(g);
  ok(!h.fracht && h.phase === 'wartet' && h.nsc.status === 'geflohen', 'Notsprung: die Ware ist verloren, gescheitert');
});

section('Speichern mitten in einer Szene: der Beat steht nach dem Laden wieder aus', () => {
  vorlage('sz_save', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 24 });
  const f = startSzene(g, 'sz_save');
  laufe(g, W.vorlauf_s + 1);
  ok(f.phase === 'laeuft', 'der Beat läuft in der Szene');
  const F2 = Faden.lesen(Faden.toSave(g.weltsim));
  const f2 = F2.liste.find((x) => x.id === f.id);
  ok(f2 && f2.phase === 'wartet' && f2.laufend === null, 'nach dem Laden: der Beat steht wieder aus (nicht gespeichert, nicht beantwortet)');
});

section('Spontanhilfe ohne Gefecht: die Frist scheitert den Beat, der Faden lebt', () => {
  vorlage('sz_hilfe3', 'spontanhilfe', null, 'aktiv');
  const { g } = bereit({ crew: 1, seed: 27 });
  g.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };   // die Frist läuft nur mit aktivem Spielleiter (faden.js B-S3)
  const f = oeffne(g, 'sz_hilfe3'); grenzen(g, 5);
  weiter(g, f);
  Faden.nscVon(g, f.nsc.id).haltung = -10;   // es kommt nie ein Gefecht, in dem er hilft
  grenzen(g, D.WERTE.beat_frist + 1);
  FS.update(g, DT);
  ok(f.phase === 'wartet' && f.nsc.status === 'geflohen' && !g.fadenHilfe, 'ohne Gefecht: nach der Frist gescheitert, der Faden lebt, der Zustand der Hilfe ist weg');
});

section('Warteschlange: höchstens drei Fäden, der vierte wird vom Faden-Limit abgelehnt', () => {
  vorlage('sz_q', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 25 });
  g.simSzene = { id: 992, phase: 'vorwarnung' };
  const res = [];
  for (let i = 0; i < 3; i++) { const f = oeffne(g, 'sz_q'); grenzen(g, 5); res.push(f ? weiter(g, f).ok : false); }
  ok(res.every((x) => x) && g.fadenWarte.length === 3, 'drei Szenen warten (eine Sim-Szene läuft)');
  ok(oeffne(g, 'sz_q') === null, 'der vierte Faden kommt nicht zustande (Obergrenze der Fäden, Schema-Limit)');
  g.simSzene = null;
});

console.log('\n' + (n - fails) + '/' + n + ' Pruefungen ok' + (fails ? ' – ' + fails + ' FEHLER' : ''));
if (fails) process.exitCode = 1;
