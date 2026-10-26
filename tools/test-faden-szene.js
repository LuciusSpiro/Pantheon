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
const Reise = require('../server/sim/reise-ereignis.js');
const Sprung = require('../server/sim/sprung.js');
const Protocol = require('../shared/protocol.js');
const WR = require('../content/faeden/szenen-werte.json').werte;
const W = Object.fromEntries(Object.entries(WR).map(([k, v]) => [k, v.wert]));   // die Werte (wie der Produktivcode sie liest)
const T = require('../content/faeden/szenen-werte.json').texte;
const X = require('./faden-fixture.js');
const { D, spiel, oeffne, grenzen, alsVorlage, registriere } = X;

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
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

section('Andocken beendet die Szene (gescheitert), die Warteschlange bleibt und rueckt nach dem Ablegen nach', () => {
  vorlage('sz_dock', 'raumschlacht'); vorlage('sz_dock2', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 19 });
  const f = startSzene(g, 'sz_dock');
  laufe(g, W.vorlauf_s + 1);
  ok(!!szene(g) && szene(g).phase === 'kampf', 'die erste Szene kaempft');
  const f2 = startSzene(g, 'sz_dock2');   // eine zweite Szene wartet (die erste kaempft)
  ok(g.fadenWarte.length === 1 && g.fadenWarte[0].fadenId === f2.id, 'die zweite Szene steht in der Warteschlange');
  g.ship.docked = true; g.ship.dockedAt = g.ship.scene;   // wie beim echten Andocken
  g.missionEvent('docked', {});
  ok(!szene(g) && f.nsc.status === 'geflohen', 'Andocken beendet die Szene sofort (Hook am Ereignis, nicht erst im naechsten Takt): der Beat ist gescheitert');
  laufe(g, 0.5);
  ok(!szene(g) && f.nsc.status === 'geflohen' && f.phase === 'wartet', 'Andocken: die Szene bleibt beendet, der Beat gescheitert'); 
  ok(g.fadenWarte.length === 1 && g.fadenWarte[0].fadenId === f2.id && f2.phase === 'laeuft', 'die Warteschlange bleibt: die zweite Szene wartet weiter (angedockt startet nichts)');
  ab(g); g.ship.x = 400; g.ship.y = 400; laufe(g, 0.5);   // abgelegt und vom Liegeplatz weg (sonst dockt das Schiff gleich wieder an)
  ok(!!szene(g) && szene(g).fadenId === f2.id && g.fadenWarte.length === 0, 'nach dem Ablegen beginnt die wartende Szene');
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
  // Crew-Geschosse genau auf dem Verbuendeten, mit tgt = er (wie die Salven der Gegner auf einen Schuetzling)
  for (const kind of ['laser', 'bolzen', 'batterie', 'kanone']) g.space.projectiles.push({ id: 'p' + kind, kind, x: es.x, y: es.y, angle: 0, speed: 0, ttl: 5, dmg: 80, tgt: es.id });
  laufe(g, 0.5);
  ok(es.hp === hp0 && es.state !== 'zerstoert', 'Crew-Geschosse (mit tgt = Verbuendeter) treffen ihn nicht (' + hp0 + ' -> ' + es.hp + ')');
  // Gegenprobe 1: dasselbe Geschoss als GEGNER-Geschoss (kind enemy, tgt = Verbuendeter) trifft einen Verbuendeten: der Aufbau erkennt Treffer
  const es2 = Flotte.aufstellen(g, { tag: 'gegenprobe', kind: 'korvette', name: 'Probe', rolle: 'angreifer', von: { x: es.x + 400, y: es.y } });
  const hp2 = es2.hp;
  g.space.projectiles.push({ id: 'pg', kind: 'enemy', x: es2.x, y: es2.y, angle: 0, speed: 0, ttl: 5, dmg: 80, tgt: es2.id });
  laufe(g, 0.5);
  ok(es2.hp < hp2, 'Gegenprobe: ein Gegner-Geschoss mit tgt trifft den Verbuendeten (' + hp2 + ' -> ' + es2.hp + ')');
  // Gegenprobe 2: ein Crew-Geschoss trifft einen Gegner
  const gz = Space.spawnEnemy(g, 'raider', { x: es.x - 600, y: es.y + 600, tag: 'probe' });
  const hz = gz.hp;
  g.space.projectiles.push({ id: 'pl', kind: 'laser', x: gz.x, y: gz.y, angle: 0, speed: 0, ttl: 5, dmg: 80 });
  laufe(g, 0.2);
  ok(gz.hp < hz || !g.space.enemies.includes(gz), 'Gegenprobe: ein Crew-Geschoss trifft einen Gegner (' + hz + ' -> ' + gz.hp + ')');
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
  ok(!g.space.escorts.some((q) => q.ally && q.tag.startsWith('nsc_' + f.nsc.id)), 'Verbündeter verschwindet am Ende des Gefechts');
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

// ---------- SUND-04a-2 Nacharbeit, Welle 1: Lebenszyklus, Persistenz, Sabotage (L1 bis L6, K1, K2, K5, L13) ----------
// Erwartete Werte stehen hier als eigene Zaehlung oder aus der Spezifikation (README, Review), nicht aus dem Produktivcode abgeleitet.
const stub = () => ({ disposed: false, mode: 'mock', beiGrenze() {} });   // aktiver Lage-Spielleiter (Fristen laufen nur mit ihm, faden.js B-S3)
const faGegner = (g) => g.space.enemies.filter((e) => /^fs\d+$/.test(e.tag || '')).length;
const reiseGegner = (g, L) => g.space.enemies.filter((e) => e.tag === L.tag).length;
const toeteAlle = (g, tagTest) => { for (const e of g.space.enemies.filter((x) => tagTest(x.tag || ''))) Space.damageEnemy(g, e, 9999, e.x, e.y); };
// eine echte Reise-Gefahr des Katalogs (piraten_hinterhalt: Vorlauf, dann Raeuber) ueber die benannte Ausloese-Funktion, wie nach einem Sprung
function reiseGefahr(g) {
  const nr = Reise.zaehleSprung(g);
  const hex = Sektoren.hexVonOrt(g.ship.scene);
  Reise.ausloesen(g, { nr, id: 'piraten_hinterhalt', art: 'piraten', variante: 'hinterhalt', ort_typ: null, hex, ankunft: hex, sim: null, schluessel: 'pt|' + hex, textIdx: 0 });
  const R = g.weltsim.reise;
  return R.laufend[R.laufend.length - 1];
}

section('L1: Reise-Gefahr und Faden-Szene nie zugleich (die Reise-Gefahr war zuerst)', () => {
  vorlage('sz_l1a', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 41 });
  const L = reiseGefahr(g);
  ok(!!L && L.phase === 'erwartet' && Reise.gefahrLaeuft(g), 'eine echte Reise-Gefahr laeuft (angekuendigt)');
  startSzene(g, 'sz_l1a');
  ok(!szene(g) && g.fadenWarte.length === 1, 'die Faden-Szene wartet, solange die Reise-Gefahr laeuft (nicht gestartet)');
  let beide = 0, reiseErst = -1, faErst = -1;
  for (let i = 0; i < 40 * CONFIG.tickHz; i++) {
    g.step();
    const r = reiseGegner(g, L), s = faGegner(g);
    if (r && s) beide++;
    if (r && reiseErst < 0) { reiseErst = i; toeteAlle(g, (t) => t === L.tag); }
    if (s && faErst < 0) { faErst = i; toeteAlle(g, (t) => /^fs\d+$/.test(t)); }
  }
  ok(reiseErst >= 0 && faErst > reiseErst, 'erst kaempfen die Raeuber der Reise-Gefahr, danach die Gegner der Faden-Szene (Tick ' + reiseErst + ', dann ' + faErst + ')');
  ok(beide === 0, 'nie Gegner beider Kaempfe zugleich im Raum (' + beide + ' Ticks)');
});

section('L1: Faden-Szene und Reise-Gefahr nie zugleich (die Faden-Szene war zuerst)', () => {
  vorlage('sz_l1b', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 42 });
  startSzene(g, 'sz_l1b');   // Vorlauf der Faden-Szene
  const L = reiseGefahr(g);
  let reiseWaehrend = 0;
  for (let i = 0; i < 30 * CONFIG.tickHz; i++) { g.step(); if (reiseGegner(g, L) > 0) reiseWaehrend++; }
  ok(faGegner(g) === 2 && !!szene(g), 'die Faden-Szene kaempft (zwei Gegner, eine Crew)');
  ok(reiseWaehrend === 0 && L.phase === 'erwartet', 'solange die Faden-Szene laeuft, trifft die Reise-Gefahr nicht ein (' + reiseWaehrend + ' Ticks mit Raeubern, Phase ' + L.phase + ')');
  toeteAlle(g, (t) => /^fs\d+$/.test(t));
  laufe(g, 3);
  ok(!szene(g) && reiseGegner(g, L) > 0 && faGegner(g) === 0, 'nach dem Ende der Faden-Szene kommen die Raeuber der Reise-Gefahr');
});

section('L1: der Kampf einer Reise-Gefahr zaehlt fuer die Spontanhilfe als Gefecht', () => {
  vorlage('sz_l1c', 'spontanhilfe', null, 'aktiv');
  let mitHilfe = 0, ohneHilfe = 0, gewuerfelt = 0;
  for (const seed of [51, 52, 53, 54, 55, 56, 57, 58]) {
    const { g } = bereit({ crew: 1, seed });
    const f = oeffne(g, 'sz_l1c'); grenzen(g, 5); weiter(g, f);
    Faden.nscVon(g, f.nsc.id).haltung = 10;
    const L = reiseGefahr(g);
    laufe(g, 12);
    if (L.phase !== 'kampf') { ok(false, 'Seed ' + seed + ': die Reise-Gefahr kaempft'); continue; }
    if (g.fadenHilfe && g.fadenHilfe.n === 1) gewuerfelt++;
    const ally = g.fadenHilfe && g.fadenHilfe.ally;
    toeteAlle(g, (t) => t === L.tag);
    laufe(g, 2);
    if (ally) { mitHilfe++; ok(f.phase === 'wartet' && f.nsc.status === 'verbuendet' && !g.space.escorts.some((q) => q.ally && q.tag === ally.tag), 'Seed ' + seed + ': der Verbuendete kaempfte mit, am Ende des Kampfes ist er weg und der Beat gelungen'); }
    else { ohneHilfe++; ok(f.phase === 'laeuft', 'Seed ' + seed + ': kein Verbuendeter erschienen, der Beat wartet auf das naechste Gefecht'); }
  }
  ok(gewuerfelt === 8, 'in jedem der 8 Kaempfe wurde einmal gewuerfelt (' + gewuerfelt + ')');
  ok(mitHilfe >= 1, 'in mindestens einem Kampf erschien der Verbuendete (' + mitHilfe + ' mit, ' + ohneHilfe + ' ohne)');
});

section('L2: genau mit der letzten Taetigkeit am Ziel andocken liefert ab, die Frist laeuft nicht vorher ab', () => {
  vorlage('sz_fracht3', 'fracht', { parameter: { nach: '0305' } });
  vorlage('sz_fracht4', 'fracht', { parameter: { nach: '0406' } });
  const unterwegs = D.WERTE.beat_frist - 1;   // Taetigkeiten unterwegs; die naechste waere die Frist (Daten)
  const { g } = bereit({ crew: 1, seed: 34 });
  g.lageSpielleiter = stub();
  const f = oeffne(g, 'sz_fracht3'); grenzen(g, 5); weiter(g, f);
  grenzen(g, unterwegs);
  ok(f.phase === 'laeuft' && !!f.fracht && f.laufend.n === unterwegs, 'nach ' + unterwegs + ' Taetigkeiten: Beat laeuft, Ware an Bord');
  g.missionEvent('docked', {});   // das Schiff liegt im Zielhafen 0305: das Andocken ist die Taetigkeit Nummer beat_frist
  ok(f.phase === 'wartet' && !f.fracht && f.nsc.status === 'verbuendet', 'Andocken am Ziel mit der letzten Taetigkeit: abgeliefert (gelungen), nicht an der Frist gescheitert');
  // Gegenprobe: dieselbe Zahl Taetigkeiten, aber der Hafen ist nicht das Ziel: die Frist zaehlt
  const { g: g2 } = bereit({ crew: 1, seed: 35 });
  g2.lageSpielleiter = stub();
  const h = oeffne(g2, 'sz_fracht4'); grenzen(g2, 5); weiter(g2, h);
  grenzen(g2, unterwegs); g2.missionEvent('docked', {});
  ok(h.phase === 'wartet' && !h.fracht && h.nsc.status === 'geflohen', 'Gegenprobe: am falschen Hafen laeuft die Frist ab (gescheitert, Ware weg)');
});

section('L3: der Laufzeitzustand der Faden-Szenen ueberlebt game.reset() nicht', () => {
  vorlage('sz_rs', 'raumschlacht'); vorlage('sz_rs2', 'raumschlacht'); vorlage('sz_rsh', 'spontanhilfe', null, 'aktiv');
  const { g } = bereit({ crew: 1, seed: 43 });
  const fh = oeffne(g, 'sz_rsh'); grenzen(g, 5); weiter(g, fh);
  Faden.nscVon(g, fh.nsc.id).haltung = 10;
  startSzene(g, 'sz_rs'); startSzene(g, 'sz_rs2');   // eine Szene laeuft, die zweite wartet
  laufe(g, W.vorlauf_s + 1);
  g.fadenHilfe.versucht = 'fs' + szene(g).id;
  for (let i = 0; i < 80 && !g.fadenHilfe.ally; i++) FS.wuerfeln(g, g.fadenHilfe);
  ok(!!szene(g) && g.fadenWarte.length === 1 && !!g.fadenHilfe && !!g.fadenHilfe.ally && g.fadenSzeneN > 0, 'Vorbedingung: Szene, Warteschlange, Spontanhilfe mit Verbuendetem, Zaehler');
  g.reset();
  ok(!g.fadenSzene && !g.fadenWarte && !g.fadenHilfe && !g.fadenHilfeWarte && !g.fadenSzeneN, 'nach game.reset(): Szene, Warteschlange, Hilfe, Hilfe-Warteschlange und Szenenzaehler sind weg');
  const radio = []; const orig = g.emit.bind(g); g.emit = (k, d) => { if (k === 'radio') radio.push(d && d.text); return orig(k, d); };
  for (let i = 0; i < 60; i++) FS.update(g, DT);
  ok(radio.length === 0 && !g.fadenSzene && !g.fadenHilfe, 'im neuen Spiel kein Funk und keine Szene aus der alten Partie (Takt)');
  g.emit = orig;
  // Reste ohne Welt (Kampagne, anderer Modus, jede andere Stelle, die reset() nicht erreicht): der Takt raeumt ab und beendet nie eine fremde Flotte
  g.fadenSzene = { id: 7, fadenId: 'f1', beatId: 'b', art: 'raumschlacht', nsc: null, phase: 'kampf', ab: 0, start: 0, szene: g.ship.scene, tag: 'fs7', sek: 10, n: 2 };
  g.fadenWarte = [{ fadenId: 'f1', beatId: 'b', art: 'raumschlacht', nsc: null, parameter: {}, szene: g.ship.scene }];
  g.fadenHilfe = { fadenId: 'f1', beatId: 'b', nsc: 'n1', schiff: 'S', name: 'N', versucht: null, n: 1, ally: { tag: 'nsc_n1_0', kampf: null } };
  g.flotte = { marke: 'fremd' };
  let beenden = 0; const alt = Flotte.beenden; Flotte.beenden = () => { beenden++; };
  const e0 = g.errors, radio2 = []; g.emit = (k, d) => { if (k === 'radio') radio2.push(d && d.text); return orig(k, d); };
  try { for (let i = 0; i < 30; i++) FS.update(g, DT); } finally { Flotte.beenden = alt; g.emit = orig; }
  ok(beenden === 0 && g.flotte && g.flotte.marke === 'fremd', 'ohne Welt: ein stehengebliebener Verbuendeter ruft flotte().beenden nicht auf (die Flotte des neuen Spiels bleibt)');
  ok(radio2.length === 0 && g.errors === e0 && !g.fadenSzene && !g.fadenWarte && !g.fadenHilfe, 'ohne Welt: kein Funk, keine Ausnahme, der Rest ist abgeraeumt');
});

section('L4: die Spontanhilfe wuerfelt je Hilfe eine eigene Folge; gleiche Eingaben = gleiche Folge', () => {
  vorlage('sz_w', 'spontanhilfe', null, 'aktiv');
  const { g } = bereit({ crew: 1, seed: 44 });
  const fa = []; for (let i = 0; i < 3; i++) { const f = oeffne(g, 'sz_w'); grenzen(g, 5); fa.push(f); }   // drei Faeden, je eigener NSC; die Hilfen baut der Test selbst
  let best = 0, bd = 9; for (let hh = -10; hh <= 10; hh += 0.5) { fa[0].nsc.haltung = hh; const d = Math.abs(Faden.chanceSpontanhilfe(fa[0].nsc) - 0.5); if (d < bd) { bd = d; best = hh; } }
  for (const f of fa) f.nsc.haltung = best;   // gleiche Chance fuer alle (um 50 %): nur der Strom unterscheidet
  const folge = (f, k) => {
    const h = { fadenId: f.id, beatId: 'b_szene', nsc: f.nsc.id, schiff: f.nsc.schiff, name: f.nsc.name, versucht: null, n: 0, ally: null };
    let bits = '';
    for (let i = 0; i < k; i++) { const e = FS.wuerfeln(g, h); bits += e ? '1' : '0'; if (e) { g.space.escorts = g.space.escorts.filter((q) => q.tag !== h.ally.tag); h.ally = null; } }
    return bits;
  };
  const a = folge(fa[0], 48), b = folge(fa[1], 48), c = folge(fa[2], 48);
  ok(a.includes('0') && a.includes('1') && b.includes('0') && c.includes('1'), 'die Chance um 50 %: beide Ausgaenge kommen vor');
  ok(a !== b && a !== c && b !== c, 'drei Hilfen (anderer Faden, anderer NSC): drei verschiedene Folgen');
  ok(folge(fa[0], 48) === a && folge(fa[1], 48) === b, 'gleiche Eingaben = gleiche Folge (Wiederholung ergibt dieselben Wuerfe)');
  grenzen(g, 2);   // der Taetigkeitszaehler der Faeden steht im Salz: ein spaeterer Anlauf (beatZurueck, Laden) wuerfelt anders
  ok(folge(fa[0], 48) !== a, 'ein spaeterer Anlauf desselben NSC (anderer Taetigkeitszaehler) wuerfelt eine andere Folge');
});

section('L5: der Notsprung-Hook der Ware haengt am Ereignis (Befehl, Debug, Fehlschlag, Ausnahme)', () => {
  vorlage('sz_fracht5', 'fracht', { parameter: { nach: '0406' } });
  const mitWare = (seed) => { const x = bereit({ crew: 1, seed }); const f = oeffne(x.g, 'sz_fracht5'); grenzen(x.g, 5); weiter(x.g, f); x.f = f; return x; };
  const { g, f } = mitWare(36);
  ok(!!f.fracht, 'Ware an Bord');
  ok(Sprung.notsprung(g) === null && !f.fracht && f.nsc.status === 'geflohen', 'ein gelungener Notsprung (Ereignis, ohne den Befehlspfad) verliert die Ware');
  { const x = mitWare(37); x.g.ship.docked = true; ok(/ablegen/.test(Sprung.notsprung(x.g) || '') && !!x.f.fracht && x.f.phase === 'laeuft', 'ein abgelehnter Notsprung (angedockt) verliert nichts'); }
  { const x = mitWare(38); const p = x.g.players[0]; p.console = 'helm'; x.g.onCmd(p, { c: Protocol.CMD_HELM_NOTSPRUNG });
    ok(!x.f.fracht && x.f.nsc.status === 'geflohen', 'Befehl helm.notsprung: die Ware ist verloren'); }
  { const x = mitWare(39); const p = x.g.players[0]; p.console = 'helm'; const e0 = x.g.errors;
    const alt = Sprung.notsprung; Sprung.notsprung = () => { throw new Error('Notsprung-Probe'); };
    try { x.g.onCmd(p, { c: Protocol.CMD_HELM_NOTSPRUNG }); } finally { Sprung.notsprung = alt; }
    ok(x.g.errors > e0 && !!x.f.fracht && x.f.phase === 'laeuft', 'wirft der Notsprung, ist die Ware nicht verloren (kein Ereignis)'); }
  { const x = mitWare(40); x.g.onDebug(x.g.players[0], { cmd: 'notsprung' }); ok(!x.f.fracht && x.f.nsc.status === 'geflohen', 'Debug-Notsprung: dasselbe Ereignis, die Ware ist verloren'); }
});

section('L6: derselbe NSC kann nach einem verlorenen Verbuendeten wieder helfen; der Beat bleibt gelungen', () => {
  const r = registriere(alsVorlage('sz_zwei', (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    const aus = (w) => ({ gelungen: { status: 'verbuendet', weiter: w }, gescheitert: { status: 'aktiv', weiter: w } });
    v.beats = [{ id: 'b_h1', typ: 'spontanhilfe', aus: aus('b_h2') }, { id: 'b_h2', typ: 'spontanhilfe', aus: aus('b_ende') }, { id: 'b_ende', typ: 'abschluss', aus: { gelungen: {}, gescheitert: {} } }];
  }));
  if (!r.ok) throw new Error(r.fehler.join('; '));
  const { g } = bereit({ crew: 1, seed: 45 });
  const f = oeffne(g, 'sz_zwei'); grenzen(g, 5); weiter(g, f);
  Faden.nscVon(g, f.nsc.id).haltung = 10;
  const h1 = g.fadenHilfe; h1.versucht = 'sim1';
  g.simSzene = { id: 1, phase: 'kampf' };
  for (let i = 0; i < 80 && !h1.ally; i++) FS.wuerfeln(g, h1);
  ok(!!h1.ally, 'der Verbuendete erscheint');
  const es = g.space.escorts.find((q) => q.tag === h1.ally.tag);
  FS.update(g, DT);
  g.space.projectiles.push({ id: 'pz', kind: 'enemy', x: es.x, y: es.y, angle: 0, speed: 0, ttl: 5, dmg: 500, tgt: es.id });   // ein Gegner-Geschoss auf ihn
  laufe(g, 0.5);
  ok(es.state === 'zerstoert', 'der Verbuendete wird im Gefecht zerstoert');
  g.simSzene = null; FS.update(g, DT);
  ok(f.phase === 'wartet' && f.beat === 1 && f.nsc.status === 'verbuendet', 'Entscheidung: die Hilfe gilt als gelungen, auch wenn der Verbuendete fiel (dokumentiert)');
  grenzen(g, 5); weiter(g, f);
  const h2 = g.fadenHilfe; h2.versucht = 'sim2';
  ok(!!h2 && h2 !== h1 && f.phase === 'laeuft', 'die zweite Spontanhilfe desselben NSC laeuft');
  g.simSzene = { id: 2, phase: 'kampf' };
  for (let i = 0; i < 80 && !h2.ally; i++) FS.wuerfeln(g, h2);
  ok(!!h2.ally && g.space.escorts.some((q) => q.tag === h2.ally.tag && q.ally && q.state !== 'zerstoert'), 'die zweite Hilfe desselben NSC erscheint (das Tag des verlorenen Schiffs sperrt nicht mehr)');
  g.simSzene = null;
});

section('K5: eine verwaiste Hilfe wird ersetzt, die Warteschlange behaelt ihre Reihenfolge', () => {
  const r = registriere(alsVorlage('sz_zwei2', (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    const aus = (w) => ({ gelungen: { status: 'verbuendet', weiter: w }, gescheitert: { status: 'aktiv', weiter: w } });
    v.beats = [{ id: 'b_h1', typ: 'spontanhilfe', aus: aus('b_h2') }, { id: 'b_h2', typ: 'spontanhilfe', aus: aus('b_ende') }, { id: 'b_ende', typ: 'abschluss', aus: { gelungen: {}, gescheitert: {} } }];
  }));
  if (!r.ok) throw new Error(r.fehler.join('; '));
  const { g } = bereit({ crew: 1, seed: 46 });
  const fa = []; for (let i = 0; i < 3; i++) { const f = oeffne(g, 'sz_zwei2'); grenzen(g, 5); fa.push(f); weiter(g, f); }
  ok(g.fadenHilfe.fadenId === fa[0].id && g.fadenHilfeWarte.map((h) => h.fadenId).join() === fa[1].id + ',' + fa[2].id, 'Vorbedingung: Hilfe von Faden 1 laeuft, die Faeden 2 und 3 warten');
  Faden.beatAusgang(g, fa[0].id, 'gelungen');   // der Beat des ersten Fadens ist (z. B. durch die Frist) zu Ende: seine Hilfe ist verwaist
  grenzen(g, 5);
  ok(fa[0].phase === 'wartet' && fa[0].beat === 1, 'Faden 1 steht vor seinem zweiten Hilfe-Beat');
  weiter(g, fa[0]);   // die neue Hilfe (Faden 1, Beat 2) stellt sich an
  ok(g.fadenHilfe.fadenId === fa[1].id, 'die verwaiste Hilfe wird ersetzt: als naechste kommt die wartende von Faden 2 (nicht die neue)');
  ok(g.fadenHilfeWarte.map((h) => h.fadenId).join() === fa[2].id + ',' + fa[0].id, 'die Warteschlange behaelt die Reihenfolge: Faden 3, dann die neue Hilfe von Faden 1');
});

section('K1: ein Beat, der im Vorlauf endet, loest keinen Kampf mehr aus', () => {
  vorlage('sz_k1', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 47 });
  const f = startSzene(g, 'sz_k1');
  ok(szene(g) && szene(g).phase === 'vorlauf', 'Vorlauf laeuft');
  Faden.beatAusgang(g, f.id, 'gescheitert');   // die Frist (oder ein anderer Weg) beendet den Beat im Vorlauf
  let maxG = 0;
  for (let i = 0; i < (W.vorlauf_s + 3) * CONFIG.tickHz; i++) { g.step(); maxG = Math.max(maxG, faGegner(g)); }
  ok(maxG === 0 && !szene(g), 'nach dem Vorlauf kein einziger Gegner, die Szene ist abgeraeumt (hoechstens ' + maxG + ' Gegner)');
});

section('K2: die angekuendigte Gegnerzahl kommt, auch wenn sich die Crew im Vorlauf aendert', () => {
  vorlage('sz_k2', 'raumschlacht');
  const zahl = (radio) => { const m = radio.map((t) => /(\d+) germanische Schiffe/.exec(t)).find(Boolean); return m ? Number(m[1]) : -1; };
  { const { g, radio } = bereit({ crew: 3, seed: 48 });
    startSzene(g, 'sz_k2');
    ok(zahl(radio) === 4, 'drei Verbundene: vier Schiffe angekuendigt (' + zahl(radio) + ')');
    g.players[1].connected = false; g.players[2].connected = false;   // zwei gehen im Vorlauf
    laufe(g, W.vorlauf_s + 1);
    ok(faGegner(g) === 4, 'es kommen die angekuendigten vier, nicht weniger (' + faGegner(g) + ')'); }
  { const { g, radio } = bereit({ crew: 3, seed: 49 });
    g.players[1].connected = false; g.players[2].connected = false;
    startSzene(g, 'sz_k2');
    ok(zahl(radio) === 2, 'eine Verbundene: zwei Schiffe angekuendigt (' + zahl(radio) + ')');
    g.players[1].connected = true; g.players[2].connected = true;   // zwei kommen im Vorlauf dazu
    laufe(g, W.vorlauf_s + 1);
    ok(faGegner(g) === 2, 'es kommen die angekuendigten zwei, nicht mehr (' + faGegner(g) + ')'); }
});

section('L13: die Vorwarnung kommt mindestens 8 s vor dem ersten Gegner (an der Spielzeit gemessen, nicht an fs.ab)', () => {
  vorlage('sz_vor', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 28 });
  let tFunk = null; const orig = g.emit.bind(g);
  g.emit = (k, d) => { if (k === 'radio' && d && /germanische Schiffe/.test(d.text || '') && tFunk === null) tFunk = g.time; return orig(k, d); };
  startSzene(g, 'sz_vor');
  let tErster = null, vorher = 0;
  for (let i = 0; i < 25 * CONFIG.tickHz && tErster === null; i++) { g.step(); const n = faGegner(g); if (n > 0) tErster = g.time; else vorher++; }
  ok(tFunk !== null && tErster !== null, 'die Ankuendigung kam und danach die Gegner');
  ok(tErster - tFunk >= 8 - 1e-6, 'Ankuendigung mindestens 8 s vor dem ersten Gegner (' + (tErster - tFunk).toFixed(2) + ' s)');
  ok(vorher >= 8 * CONFIG.tickHz, 'bis dahin kein einziger Gegner (' + vorher + ' Ticks)');
});

section('L13: Warteschlange der Szenen (hoechstens drei) und der Spontanhilfe (hoechstens drei)', () => {
  vorlage('sz_q2', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 29 });
  g.simSzene = { id: 993, phase: 'vorwarnung' };
  const fa = [];
  for (let i = 0; i < 3; i++) { const f = oeffne(g, 'sz_q2'); grenzen(g, 5); fa.push(f); ok(!!f && weiter(g, f).ok, 'Szene ' + (i + 1) + ' wird eingereiht'); }
  ok(g.fadenWarte.map((it) => it.fadenId).join() === fa.map((f) => f.id).join(), 'drei Szenen warten in der Reihenfolge des Einreihens');
  const v = FS.starten(g, { art: 'raumschlacht', fadenId: fa[0].id, beatId: 'b_szene' });
  ok(v.ok === false && v.grund === 'WARTESCHLANGE_VOLL' && g.fadenWarte.length === 3, 'die vierte Szene lehnt die Warteschlange ab (nicht das Faden-Limit)');
  g.simSzene = null; FS.update(g, DT);
  ok(!!szene(g) && szene(g).fadenId === fa[0].id && g.fadenWarte.map((it) => it.fadenId).join() === fa[1].id + ',' + fa[2].id, 'Sim-Szene vorbei: die erste Szene beginnt, zwei warten in ihrer Reihenfolge');
  // Spontanhilfe: eine laeuft, drei warten, die vierte wartende wird abgelehnt
  vorlage('sz_qh', 'spontanhilfe', null, 'aktiv');
  const x = bereit({ crew: 1, seed: 30 }); const gh = x.g;
  const fh = oeffne(gh, 'sz_qh'); grenzen(gh, 5); weiter(gh, fh);
  ok(!!gh.fadenHilfe, 'eine Hilfe laeuft');
  const rs = [1, 2, 3, 4].map((i) => FS.starten(gh, { art: 'spontanhilfe', fadenId: 'fX' + i, beatId: 'b', nsc: { id: 'nX' + i, name: 'N', schiff: 'S' } }));
  ok(rs.slice(0, 3).every((r) => r.ok && r.grund === 'WARTET') && gh.fadenHilfeWarte.length === 3, 'drei weitere Hilfen warten');
  ok(rs[3].ok === false && rs[3].grund === 'HILFE_LAEUFT' && gh.fadenHilfeWarte.length === 3, 'die vierte wartende wird abgelehnt (hoechstens drei)');
});

section('L7: kaputte Fracht im Weltstand verwirft nur das Feld, nie den Faden', () => {
  vorlage('sz_fracht6', 'fracht', { parameter: { nach: '0406' } });
  const { g } = bereit({ crew: 1, seed: 52 });
  const f = oeffne(g, 'sz_fracht6'); grenzen(g, 5); weiter(g, f);
  ok(!!f.fracht && f.phase === 'laeuft', 'Ware an Bord, der Beat laeuft');
  const lies = (aendern) => { const b = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim))); aendern(b.liste[0]); return Faden.lesen(b); };
  const gut = lies(() => {});
  ok(gut.liste.length === 1 && !!gut.liste[0].fracht && gut.liste[0].fracht.nach === '0406' && gut.liste[0].fracht.ware === 'fracht_kiste', 'unveraendert: die Ware bleibt');
  for (const [name, aendern] of [
    ['Text', (x) => { x.fracht = 'kaputt'; }], ['Zahl', (x) => { x.fracht = 5; }], ['Liste', (x) => { x.fracht = [1]; }], ['null (das Schema erlaubt es)', (x) => { x.fracht = null; }],
    ['umbenannte Ware', (x) => { x.fracht.ware = 'alte_ware'; }], ['Ziel kaputt', (x) => { x.fracht.nach = 'xx'; }], ['Felder mit Muell', (x) => { x.fracht = { ware: 5, nach: '0406', tick: 'x' }; }],
  ]) {
    const F = lies(aendern);
    const h = F.liste[0];
    ok(F.liste.length === 1 && h.id === f.id && h.phase === 'laeuft' && !!h.laufend && h.fracht === undefined && F.ladeFehler.length === 0, 'Fracht ' + name + ': nur das Feld faellt weg, der Faden bleibt und laeuft');
  }
  const F2 = lies((x) => { x.phase = 'wartet'; x.laufend = null; });
  ok(F2.liste.length === 1 && F2.liste[0].phase === 'wartet' && F2.liste[0].fracht === undefined, 'Fracht bei Phase wartet: das Feld faellt weg, der Faden bleibt');
  const data = Weltstand.capture(g); data.welt.sim.faeden.liste[0].fracht = null;
  ok(Weltstand.validate(data, g).length === 0, 'Weltstand-Schema: fracht null ist gueltig');
});

section('Gate: Faden-Szenen im Takt nur mit weltsim und Schalter (game.step)', () => {
  vorlage('sz_gate', 'raumschlacht');
  const { g } = bereit({ crew: 1, seed: 31 });
  startSzene(g, 'sz_gate');
  const fs = szene(g);
  laufe(g, W.vorlauf_s + 1);
  ok(fs.phase === 'kampf' && faGegner(g) === 2, 'der Takt in game.step fuehrt die Szene in den Kampf (Hook in game.js)');
  g.env = { FAEDEN: '0' };   // Schalter aus: der Takt tut nichts und raeumt auf
  g.step();
  ok(!g.fadenSzene && !g.fadenWarte, 'ohne Schalter raeumt der Takt die Faden-Szene ab (game.step)');
});

console.log('\n' + (n - fails) + '/' + n + ' Pruefungen ok' + (fails ? ' – ' + fails + ' FEHLER' : ''));
if (fails) process.exitCode = 1;
