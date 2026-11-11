'use strict';
// MON-01 P1: Kreaturen-Rahmen. Ein Typ für alle künftigen Monster (Rudeltier, Schwarm, Energiewesen). Action-Layer; Zustand lebt in der Außenkarte
// (game.away.kreaturen, mit der Karte zurückgesetzt), nie im Weltstand. Das Station-Monster (server/sim/monster.js, aw.monster) bleibt davon getrennt und unverändert.
//
// Alles Verhalten kommt aus Daten (content/kampf/kreaturen.json): Zustandstabelle (Zustände, Auslöser, Dauer, Übergang), Wahrnehmung, Tempo je Zustand, Werte für
// Schild/Wunden/Frontbogen und eingeschaltete Bausteine mit Parametern. Der Server kennt keinen Typnamen: kein `if (typ === …)`.
//
//   update(game, dt)                         je Tick (aus combat.update, nach dem Station-Monster); ohne Kreaturen sofort zurück, ohne Zufallsverbrauch
//   kreaturBausteinAnmelden(name, def)       Registry der Bausteine. def = { beiTick?, beiAbgleich?, beiTreffer?, beiLaerm?, beiErzeugen?, beiAusruesten?, modi?, ausloeser?, pruefen? } -> Abmelder
//       beiTick(game, K, dt, par, ctx)        je Tick vor dem Zustandswechsel (ctx = { E, m, typ, ziel, k })
//       beiAbgleich(game, K, dt, par)         je Tick für jede lebende Kreatur, auch betäubt oder ohne Außenteam (vor der Handlungsfähigkeit); Bindungen (P3), ruft aufloesen
//       beiTreffer(game, K, treffer, par)     Aufruf über bausteinTreffer (Treffer-Hooks kommen in P2)
//       beiLaerm(game, K, laerm, par)         Aufruf über bausteinLaerm (jedes neue Lärmereignis, aus dem Lärm-Leser in update, P2b)
//       beiErzeugen(game, K, par) / beiAusruesten(game, K, par)   einmalig beim Anlegen (beiErzeugen darf werfen: dann entsteht keine Kreatur) bzw. im Kämpfer-Vertrag (Felder aus den Parametern in die Kreatur übernehmen, P2b)
//       beiWechsel(game, K, von, nach, par)   bei jedem Zustandswechsel einer schon laufenden Kreatur, VOR dem Zurücksetzen der Zustandsfelder (K.rammTreffer, K.blockiert des alten Zustands sind noch da; MON-02 P1, Baustein aufgeben)
//       modi: { name: { betreten?(game, K, ctx, par, zustand), tick(game, K, dt, ctx, par, zustand) } }   Bewegungsmodi, die Zustände der Tabelle verwenden dürfen
//       ausloeser: { name(game, K, ctx, par, uebergang) -> bool }                                         zusätzliche Auslöser für `uebergang[].auf`
//       pruefen(par) -> [Fehlertext]          Parameter-Prüfung des Validators
//   Eingebaut: Modi steht, zielen, streife, verfolge; Auslöser sieht, verloren, ablauf, nah (abstand), blockiert; Baustein `zyklus` (Modus `ramme`).
//   Teamregeln (P2b, je Baustein, nur über Daten eingeschaltet): `ruecken` {bogen, faktor}, `aufladung` {max, zerfallNach, zerfallSchritt, tempoFaktor, rammFaktor},
//   `koeder` {faktor, dauer} (Modus `zumKoeder`, Auslöser `laerm`, `koederEnde`), `rammschaden` {radius} (Auslöser `getroffen`).
//   Bindung (P3, nur über Daten): `bindung` {quelle, bedingung, folge}: Kopplungsabfrage (alle Anker im Zustand, Eintritte im Fenster) und Folge `aufloesen`; Details am Baustein.
//   ziele(aw)                                Drohnen + Kreaturen für Treffer-Schleifen; ohne Kreaturen DIESELBE Referenz aw.drones (P2a)
//   ausruesten(game, K)                      Kämpfer-Vertrag (aus combat.kaempfer): Schild, Wunden, Frontbogen, Blickrichtung, Trefferradius aus dem Typ (P2a)
//   raeumen(aw)                              Kreaturen einer Karte entfernen (Szenario-Start, P2a)
//   daten() / pruefen(daten)                 Laden und Validator (lazy beim ersten Gebrauch, damit sich Bausteine vorher anmelden können; Fehler = Exception mit allen Befunden)
//   erzeugen(game, typ, x, y) / debugKreatur(game, p, typ)   Anlegen; Debug `kreatur <typ>` (nur Server --debug)
//   erzeugenAuf(game, aw, typ, { x, y, gruppe? })            Anlegen auf einer gegebenen Außenkarte (Missionsaktionen laufen vor der Landung; MON-02 P1)
//   rudelSetzen(game, { map, bereich?, typ, anzahl, gruppe }) Rudel mit Kennung K.gruppe anlegen (Aktion kreatur_besetzen), Buchführung aw.kreaturGruppen[gruppe] = { erschienen, typ }
//   nestSetzen(game, { map, typ, gruppe, x, y }) eine Quelle (Königin) an der Kachel (x, y) anlegen, Buchführung wie rudelSetzen (MON-03 A); Baustein `brut` {typ, anfang, max, takt, radius}: die Quelle bringt ihr gebundenes Gefolge hervor
//   nestBesetzen(game, { map, typ, gruppe })  die Quelle an den (verdeckten) Anker der Rolle nest der Karte setzen (MON-03 B); laermHoeren(game, { x, y, radius })  Lärm als Push an die Kreaturen, ohne aw.laerm; Baustein `gefolge` {hort, fern, daheim}: Modi umkreise, zumHort, Auslöser fern, daheim; Baustein `streuung` {abstand, tempo}: Träger weichen einander aus (Nacharbeit A)
//   ausgefallenMelden(game, K)             Ereignis kreaturAusgefallen {id, typ, gruppe, x, y} bei endgültigem Ausfall (aus combat.faellt; bewusstlos meldet nichts; einmal je Kreatur; MON-02 P2)
//   rudelErledigt(game, map, { gruppe | typ })  Prüfung des Bausteins kreaturen_erledigt; nichtEndgueltigErledigt(K) ist die gemeinsame Regel (lebend oder erholbar liegend, nicht aufgelöst)
//   Baustein `aufgeben` { anlaeufe }: Auslöser `aufgegeben` nach n erfolglosen Rammen in Folge (Hook beiWechsel)
//
// Größe (MON-02 G): groesse 1 oder 2 (Kanten des Fußabdrucks in Kacheln). Die Mitte des Tieres liegt bei Größe 1 in der Kachelmitte, bei Größe 2 auf der Kachelecke (shared/monster.js mitteVon/ankerVonPosition);
// die Maske, der Pfad, die Tür-Prüfung und die Position beim Anlegen benutzen denselben Fußabdruck (typ.groesse; die Instanz bekommt kein Feld, hbVon trägt ihn). Kollisionsbox und Trefferradius stehen je Typ in den Daten (kollision.box, hitRadius).
// Zufall NUR über aw.rng (nie game.rng, sonst verschiebt sich der Strom des Station-Monsters). Wahrnehmung wie Station: Sicht in Kacheln, Sichtlinie über combat.losBetween.
const Mon = require('../../shared/monster.js');
const Physics = require('../../shared/physics.js');
const Los = require('../../shared/los.js');
const Monster = require('./monster.js');
const Tel = require('../telemetrie/gefecht.js');
const KREATUREN = require('../../content/kampf/kreaturen.json');

let combatMod = null;
const combat = () => combatMod || (combatMod = require('./combat.js'));
let waffenMod = null;
const waffen = () => waffenMod || (waffenMod = require('./waffen.js'));
const TILE = Physics.TILE;
const GROESSEN = [1, 2];   // erlaubte Kanten des Fußabdrucks in Kacheln (Mitte je Größe: shared/monster.js mitteVon); 3 und 4 sind nicht gebaut
const KOERPER_PRO_FUSS = 14;   // Rückfall der Kollisionsbox: px je Kachel Fußabdruck (Größe 2 = 28×28 = Station), wenn der Typ kein Feld kollision.box hat
// Körper eines Typs für die Bewegung: Kollisionsbox aus den Daten (kollision.box, px, quadratisch), sonst der Rückfall groesse × 14, dazu der Fußabdruck (fuss = groesse) für Mitte und Türprüfung
const hbVon = (typ) => { const b = typ.kollision && typ.kollision.box != null ? typ.kollision.box : typ.groesse * KOERPER_PRO_FUSS; return { w: b, h: b, fuss: typ.groesse }; };

// ---------- Registry der Bausteine ----------
const bausteine = new Map();
let zwischenDaten = null;   // geprüfte Daten (lazy), wird beim Anmelden/Abmelden eines Bausteins verworfen
function kreaturBausteinAnmelden(name, def) {
  if (typeof name !== 'string' || !name) throw new Error('kreaturBausteinAnmelden: Name fehlt');
  if (!def || typeof def !== 'object') throw new Error('kreaturBausteinAnmelden: Definition fehlt (' + name + ')');
  if (bausteine.has(name)) throw new Error('kreaturBausteinAnmelden: Baustein bereits angemeldet (' + name + ')');
  for (const k of ['beiTick', 'beiAbgleich', 'beiTreffer', 'beiLaerm', 'beiErzeugen', 'beiAusruesten', 'beiWechsel', 'pruefen']) if (def[k] !== undefined && typeof def[k] !== 'function') throw new Error('kreaturBausteinAnmelden: ' + k + ' muss eine Funktion sein (' + name + ')');
  for (const [gruppe, fn] of [['modi', 'tick'], ['ausloeser', null]]) {
    for (const [n, f] of Object.entries(def[gruppe] || {})) if (fn ? !f || typeof f[fn] !== 'function' : typeof f !== 'function') throw new Error('kreaturBausteinAnmelden: ' + gruppe + '.' + n + ' ungültig (' + name + ')');
  }
  const eintrag = def;
  bausteine.set(name, eintrag);
  zwischenDaten = null;   // Validierung beim nächsten Gebrauch neu
  return () => { if (bausteine.get(name) === eintrag) { bausteine.delete(name); zwischenDaten = null; } };
}

// ---------- Kern: Modi und Auslöser ----------
const KERN_MODI = {
  steht: { tick() {} },
  // Blick zum letzten bekannten Ziel drehen, stehen bleiben (Aufladen)
  zielen: { tick(game, K) { if (K.letzte) K.facing = Math.atan2(K.letzte.y - K.y, K.letzte.x - K.x); } },
  // Zufälliges Ziel im Umkreis (zustand.radius Kacheln) über aw.rng, dorthin gehen
  streife: {
    tick(game, K, dt, ctx, par, z) {
      if (!K.pfad.length && K.replan <= 0) {
        const aw = game.away; const r = z.radius || 8;
        const base = Mon.ankerVonPosition(K.x, K.y, ctx.m.fuss);
        for (let i = 0; i < 12; i++) {
          const cx = base.cx + Math.round((aw.rng() * 2 - 1) * r), cy = base.cy + Math.round((aw.rng() * 2 - 1) * r);
          if (ctx.m.geht(cx, cy)) { Monster.setzePfad(K, ctx.m, { cx, cy }); break; }
        }
        K.replan = 1.2;
      }
      gehe(game, K, dt, ctx, tempoVon(K, z));
    },
  },
  // Dem letzten bekannten Ziel folgen (Pfad über dieselbe Maske wie die Kollision)
  verfolge: {
    tick(game, K, dt, ctx, par, z) {
      if (K.letzte && (K.replan <= 0 || !K.pfad.length)) {
        const a = Mon.naechster(ctx.m, Math.floor(K.letzte.x / TILE), Math.floor(K.letzte.y / TILE), 3);
        if (a) Monster.setzePfad(K, ctx.m, a);
        K.replan = ctx.typ.replan;
      }
      gehe(game, K, dt, ctx, tempoVon(K, z));
    },
  },
};
// Tempo eines Zustands mit dem Faktor aus Bausteinen (aufladung); ohne Faktor der Wert aus der Tabelle
const tempoVon = (K, z) => z.tempo * (K.tempoF || 1);
function gehe(game, K, dt, ctx, tempo) {
  const r = ctx.typ.tuerenAufbrechen ? Monster.gehenMitAufbrechen(game, ctx.E, K, dt, tempo, hbVon(ctx.typ), ctx.typ.rammZeit) : Monster.gehenOhneAufbrechen(game, ctx.E, K, dt, tempo, hbVon(ctx.typ));
  if (r === 'tuer') { K.pfad = []; K.replan = Math.max(K.replan, 1); K.tuerGesperrt = true; }   // Tür bleibt zu: Pfad verwerfen, später neu planen
  else if (r === 'blockiert') sperreMerken(game, K, ctx);
  return r;
}
// MON-03 Nacharbeit B: Die Maske der Kreaturen kennt nur das Raster. Ein Hindernis, das nur die Physik kennt (z. B. eine Ader, fest bis zum Abbau), liegt für sie mitten im Weg: der Pfad führt hindurch,
// die Kollision hält die Kreatur davor, und sie bliebe für immer dort (ein Spieler dahinter hätte einen sicheren Standplatz). Hält die Physik die Kreatur am nächsten Pfadpunkt auf und ist dessen Fußabdruck fest,
// merkt sie sich diesen Ankerpunkt für SPERRE_ZEIT s (lazy K.sperre, nur nach so einem Vorfall) und plant ohne ihn neu (sperrMaske). Kein Typname, für alle Typen gleich.
const SPERRE_ZEIT = 20;   // s, danach darf der Weg wieder versucht werden (die Ader kann inzwischen abgebaut sein)
function sperreMerken(game, K, ctx) {
  const n = K.pfad[0]; if (!n) return;
  if (!Mon.fussKacheln(n, ctx.typ.groesse).some((t) => ctx.E.solid(t.x, t.y))) return;
  (K.sperre || (K.sperre = {}))[n.cx + ',' + n.cy] = game.time + SPERRE_ZEIT;
  K.pfad = []; K.replan = 0;
}
function sperrMaske(m, K, zeit) {
  let rest = 0;
  for (const key of Object.keys(K.sperre)) { if (K.sperre[key] <= zeit) delete K.sperre[key]; else rest++; }
  if (!rest) { delete K.sperre; return m; }
  const S = K.sperre;
  return { w: m.w, h: m.h, fuss: m.fuss, geht: (cx, cy) => m.geht(cx, cy) && !(S[cx + ',' + cy] > zeit) };
}
const KERN_AUSLOESER = {
  sieht: (game, K, ctx) => !!ctx.ziel,
  verloren: (game, K, ctx) => K.verlust >= ctx.typ.verlustZeit,
  ablauf: (game, K) => K.t != null && K.t <= 0,
  nah: (game, K, ctx, par, u) => !!ctx.ziel && Math.hypot(ctx.ziel.x - K.x, ctx.ziel.y - K.y) <= u.abstand * TILE,
  blockiert: (game, K) => !!K.blockiert,
};
const KERN_NAMEN = { modi: Object.keys(KERN_MODI), ausloeser: Object.keys(KERN_AUSLOESER) };

// ---------- Baustein zyklus: Aufladen → Rammen → Pause ----------
// Die Zustände und Dauern stehen in der Tabelle des Typs; der Baustein liefert den Modus `ramme`: geradeaus in Blickrichtung mit dem Tempo des Zustands.
// Hindernis (Wand, Tür, Möbel): kommt die Kreatur in Blickrichtung weniger als `hindernisAb` des Schritts voran, gilt sie als blockiert (Auslöser `blockiert`).
kreaturBausteinAnmelden('zyklus', {
  modi: {
    ramme: {
      betreten(game, K) { K.pfad = []; },
      tick(game, K, dt, ctx, par, z) {
        const s = tempoVon(K, z) * dt; if (s <= 0) return;
        const dx = Math.cos(K.facing), dy = Math.sin(K.facing);
        const res = Physics.moveWithCollision(ctx.E.solid, K.x, K.y, dx * s, dy * s, hbVon(ctx.typ));
        const voran = (res.x - K.x) * dx + (res.y - K.y) * dy;
        K.x = res.x; K.y = res.y;
        if (voran < s * par.hindernisAb) K.blockiert = true;
      },
    },
  },
  pruefen(par) {
    const F = [];
    if (!par || typeof par.hindernisAb !== 'number' || !(par.hindernisAb > 0 && par.hindernisAb <= 1)) F.push('hindernisAb muss eine Zahl in (0, 1] sein');
    return F;
  },
});

// ---------- Teamregeln (P2b) ----------
const jagend = (K, typ) => !!K.letzte && K.verlust < typ.verlustZeit;   // hat einen Spieler gesehen und ihn noch nicht verloren

// Baustein ruecken: Treffer von hinten (Bogen in Grad um die Rückseite) machen Schildschaden × faktor. Die Auswertung steht in waffen.js trefferWirkung und
// liest nur das Feld ziel.ruecken; der Kämpfer-Vertrag setzt es aus den Parametern (Drohnen haben das Feld nie). Gilt nur für Schildschaden.
kreaturBausteinAnmelden('ruecken', {
  beiAusruesten(game, K, par) { if (K.ruecken == null) K.ruecken = { bogen: par.bogen, faktor: par.faktor }; },
  pruefen(par) {
    const F = [];
    if (!par || !zahl(par.bogen, 1, 360)) F.push('bogen muss eine Zahl in [1, 360] sein (Grad um die Rückseite)');
    if (!par || !zahl(par.faktor, 0.1)) F.push('faktor muss eine Zahl >= 0,1 sein');
    return F;
  },
});

// Baustein aufladung: jeder Treffer (auch abgelenkte) erhöht die Stufe K.aufladung.stufe (0..max); ohne Treffer sinkt sie nach zerfallNach s alle zerfallSchritt s.
// Die Stufe erhöht das Tempo aller Zustände (K.tempoF) und die Rammreichweite (K.rammF), nicht den Schaden: Wunde ist Wunde. Betäubt/liegend zählt der Zerfall nicht mit.
function aufladungWirkung(K, par) { const s = K.aufladung.stufe; K.tempoF = 1 + s * par.tempoFaktor; K.rammF = 1 + s * par.rammFaktor; }
const aufladungVon = (K) => K.aufladung || (K.aufladung = { stufe: 0, ruhe: 0, zerfallT: 0 });
kreaturBausteinAnmelden('aufladung', {
  beiTreffer(game, K, treffer, par) {
    const a = aufladungVon(K);
    a.stufe = Math.min(par.max, a.stufe + 1); a.ruhe = 0; a.zerfallT = 0;
    aufladungWirkung(K, par);
  },
  beiTick(game, K, dt, par) {
    const a = K.aufladung; if (!a || a.stufe <= 0) return;
    a.ruhe += dt;
    if (a.ruhe >= par.zerfallNach) {
      a.zerfallT += dt;
      while (a.zerfallT >= par.zerfallSchritt && a.stufe > 0) { a.zerfallT -= par.zerfallSchritt; a.stufe--; }
      if (a.stufe <= 0) a.zerfallT = 0;
      aufladungWirkung(K, par);
    }
  },
  pruefen(par) {
    const F = [];
    if (!par || !Number.isInteger(par.max) || par.max < 1) F.push('max muss eine ganze Zahl >= 1 sein (Stufen)');
    if (!par || !zahl(par.zerfallNach, 0)) F.push('zerfallNach muss eine Zahl >= 0 sein (s ohne Treffer)');
    if (!par || !zahl(par.zerfallSchritt, 0.05)) F.push('zerfallSchritt muss eine Zahl >= 0,05 sein (s je Stufe)');
    if (!par || !zahl(par.tempoFaktor, 0)) F.push('tempoFaktor muss eine Zahl >= 0 sein (Zuwachs je Stufe)');
    if (!par || !zahl(par.rammFaktor, 0)) F.push('rammFaktor muss eine Zahl >= 0 sein (Zuwachs je Stufe)');
    return F;
  },
});

// Baustein koeder: Lärm lesen (der zentrale Leser in update ruft beiLaerm je neuem Ereignis). Liegt der Lärm innerhalb ev.radius × faktor, merkt sich die Kreatur den Ort
// (K.koeder) und wechselt über den Auslöser `laerm` in einen Zustand mit dem Modus `zumKoeder`: Pfad zum Ort, dort `dauer` s suchen, dann Auslöser `koederEnde`.
// Sie reagiert nur in Zuständen, deren Tabelle einen Übergang `laerm` (oder den Modus selbst) hat, und nie, solange sie einen Spieler jagt.
const KOEDER_MODUS = 'zumKoeder';
kreaturBausteinAnmelden('koeder', {
  beiLaerm(game, K, ev, par) {
    const typ = typVon(K.typ); const z = typ.zustaende[K.z];
    if (z.modus !== KOEDER_MODUS && !z.uebergang.some((u) => u.auf === 'laerm')) return;
    if (jagend(K, typ)) return;
    if (Math.hypot(ev.x - K.x, ev.y - K.y) > ev.radius * par.faktor) return;
    K.koeder = { x: ev.x, y: ev.y, neu: true, da: false, rest: par.dauer, fertig: false };
  },
  beiTick(game, K, dt, par, ctx) { if (K.koeder && jagend(K, ctx.typ)) K.koeder = null; },   // Jagd geht vor
  modi: {
    [KOEDER_MODUS]: {
      tick(game, K, dt, ctx, par, z) {
        const o = K.koeder; if (!o || o.fertig) return;
        if (o.neu) {
          o.neu = false; o.da = false; o.rest = par.dauer;
          const a = Mon.naechster(ctx.m, Math.floor(o.x / TILE), Math.floor(o.y / TILE), 4);
          if (!a || !Monster.setzePfad(K, ctx.m, a)) o.da = true;   // unerreichbar: am Ort der Kreatur suchen
        }
        if (!o.da) { gehe(game, K, dt, ctx, tempoVon(K, z)); if (!K.pfad.length && !K.ramm) o.da = true; }
        else if ((o.rest -= dt) <= 0) o.fertig = true;
      },
    },
  },
  ausloeser: {
    laerm: (game, K) => !!K.koeder && !K.koeder.fertig,
    koederEnde: (game, K) => !K.koeder || K.koeder.fertig,
  },
  pruefen(par) {
    const F = [];
    if (!par || !zahl(par.faktor, 0.1)) F.push('faktor muss eine Zahl >= 0,1 sein (Hörweite = Lärmradius × faktor)');
    if (!par || !zahl(par.dauer, 0.05)) F.push('dauer muss eine Zahl >= 0,05 sein (s Suche am Ort)');
    return F;
  },
});

// Baustein rammschaden: im Zustand mit dem Modus `ramme` verwundet die Kreatur den ersten Spieler, den sie berührt (Abstand <= radius × K.rammF px): derselbe Weg wie der Biss des
// Station-Monsters (woundPlayer), aber game.god schützt wie in combat.hitPlayer. Der Treffer setzt K.rammTreffer (Auslöser `getroffen`), die Tabelle entscheidet, wohin es weitergeht.
// Die Stärke der Ladung wirkt über die Reichweite (rammF) und das Tempo, nicht über mehr Schaden.
kreaturBausteinAnmelden('rammschaden', {
  beiTick(game, K, dt, par, ctx) {
    if (ctx.typ.zustaende[K.z].modus !== 'ramme' || game.god) return;
    if (K.rammTreffer) return;   // ein Rammen trifft höchstens einmal, auch wenn die Tabelle den Übergang `getroffen` nicht hat
    const r = par.radius * (K.rammF || 1);
    for (const p of game.players) {
      if (p.zone !== 'away' || p.connected === false || p.downed || p.lift) continue;
      if (Math.hypot(p.x - K.x, p.y - K.y) > r) continue;
      if (!Los.lineOfSight(ctx.E.shotBlocked, K.x, K.y, p.x, p.y)) continue;   // Berührung geht nicht durch Wand oder Fenster (wie Schüsse)
      combat().woundPlayer(game, p, 'kreatur');
      if (p.downed) Tel.gefallenOhneTreffer(game, p.id, 'kreatur', K.typ);
      game.emit('kreaturTreffer', { pid: p.id, id: K.id, x: Math.round(p.x), y: Math.round(p.y) });
      game.missionEvent('kreaturTreffer', { pid: p.id, id: K.id });
      game.emit('sfx', { name: 'hull_hit', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
      K.rammTreffer = true;
      break;
    }
  },
  ausloeser: { getroffen: (game, K) => !!K.rammTreffer },
  pruefen(par) { return !par || !zahl(par.radius, 1) ? ['radius muss eine Zahl >= 1 sein (px, Mittelpunktabstand)'] : []; },
});

// ---------- Baustein aufgeben (MON-02 P1): erfolgloses Rammen gibt irgendwann auf ----------
// Zählt Anläufe in Folge ohne Treffer auf einen Spieler: jedes Verlassen eines Zustands mit dem Modus `ramme`, bei dem K.rammTreffer nicht gesetzt ist (steckt, blockiert, ins Leere, Zeit um).
// Hook beiWechsel: läuft vor dem Zurücksetzen der Zustandsfelder, K.rammTreffer des alten Zustands ist also noch da. Ist der Zähler bei `anlaeufe`, wird der Auslöser `aufgegeben` wahr; die Tabelle führt dann
// in einen Zustand ohne Angriff (suche, patrouille). Der Auslöser VERBRAUCHT den Zähler (zurück auf 0): wird er wahr, nimmt die Tabelle den Übergang, danach beginnt eine neue Runde mit `anlaeufe` Versuchen.
// Zähler zurück bei: Treffer auf einen Spieler (rammschaden setzt K.rammTreffer; mit game.god trifft nichts, dann zählt jeder Anlauf), Verlust des Ziels (nicht mehr `jagend`), Auslösen.
// Ohne den Baustein bleibt eine Kreatur, die ihr Ziel sieht und nie erreicht (Wasser, Lava, Fels dazwischen), für immer im Zyklus Aufladen, Rammen, steckt, Pause (gemessen: 12 von 12 Paaren am Wasser).
//   anlaeufe  ganze Zahl >= 1: erfolglose Anläufe in Folge, dann `aufgegeben`
const AUFGEBEN_FELDER = ['anlaeufe'];
const aufgebenVon = (K) => K.aufgeben || (K.aufgeben = { n: 0 });
kreaturBausteinAnmelden('aufgeben', {
  beiWechsel(game, K, von, nach, par) {
    if (typVon(K.typ).zustaende[von].modus !== 'ramme') return;
    const a = aufgebenVon(K);
    a.n = K.rammTreffer ? 0 : a.n + 1;
  },
  beiTick(game, K, dt, par, ctx) { if (K.aufgeben && K.aufgeben.n > 0 && !jagend(K, ctx.typ)) K.aufgeben.n = 0; },
  ausloeser: {
    aufgegeben(game, K, ctx, par) {
      const a = K.aufgeben; if (!a || a.n < par.anlaeufe) return false;
      a.n = 0; return true;
    },
  },
  pruefen(par) {
    const F = [];
    if (!par || typeof par !== 'object' || Array.isArray(par)) return ['Objekt { anlaeufe } erwartet'];
    for (const k of Object.keys(par)) if (!AUFGEBEN_FELDER.includes(k)) F.push(k + ': unbekanntes Feld');
    if (!Number.isInteger(par.anlaeufe) || par.anlaeufe < 1 || par.anlaeufe > 50) F.push('anlaeufe muss eine ganze Zahl 1 bis 50 sein (erfolglose Anläufe in Folge)');
    return F;
  },
});

// ---------- Baustein bindung (P3): Kreatur hängt an einer Quelle ----------
// Fällt die Bindung weg, löst sich die Kreatur auf (Folge `aufloesen`): sauber aus aw.kreaturen entfernt, kein Fall, kein droneKilled, kein knockOut; Ereignis `kreaturAufgeloest {id, typ, x, y}`
// und Missionsereignis gleichen Namens. Gebunden bleibt sie auch betäubt, bewusstlos oder ohne Außenteam (der Abgleich läuft vor der Handlungsfähigkeit); endgültig erledigte Kreaturen (verwundet/aus) werden nicht mehr geprüft.
// Als Kreatur-Quelle zählt, wer nicht endgültig erledigt ist: lebend oder bewusstlos/gefesselt (steht wieder auf), nicht verwundet/aus und nicht aufgelöst.
//   quelle    { art: 'anker', ids: [...] } | { art: 'anker', rolle } (alle Anker der Karte dieser Rolle) | { art: 'kreatur', typ } | { art: 'kreatur', id: 'K…' }
//   bedingung Anker-Quelle (Pflicht): { zustand, fenster? }  gelöst, wenn ALLE Anker der Quelle im Zustand sind und jeder Eintritt höchstens `fenster` s zurückliegt (fehlt/0: nur gleichzeitig).
//             Kreatur-Quelle: keine Bedingung; gelöst, sobald keine nicht endgültig erledigte Kreatur der Quelle (ohne die gebundene selbst) mehr existiert.
//   folge     { art: 'aufloesen', verzoegerung? }  nach `verzoegerung` s (Standard 0) entfernen. Ist die Folge ausgelöst, gilt sie endgültig (Wiederkehr ist MON-03).
// Der Baustein liest Anker nur über Anker.zustand (Karte ohne Neuaufbau, je Anker ein Lookup) und beobachtet den Eintritt je Anker pro Tick; er schreibt nie in Anker. Ein Anker, der schon beim
// Anlegen im Zustand ist, hat einen unbekannten Eintritt: mit Fenster zählt er erst nach Verlassen und erneutem Eintritt, ohne Fenster zählt er sofort.
// Fehlt die Quelle beim Anlegen (Anker-ID oder Rolle nicht auf der Karte, unbekannter Zustand für die Rolle, Karte ohne Anker, keine lebende Kreatur der Quelle), wirft erzeugen() mit klarer Meldung.
const BINDUNG_FELDER = ['quelle', 'bedingung', 'folge'];
const ankerMod = () => require('./anker.js');
const ankerRollen = () => { try { return require('../../shared/buehne.js').daten().anker.rollen || {}; } catch (e) { return {}; } };
// Zustände, aus denen eine liegende Kreatur wieder aufsteht (bewusstlos nach bewusstBis, gefesselt nach Befreiung); verwundet/aus ist endgültig (Ausbluten)
const LIEGT_ERHOLBAR = { bewusstlos: 1, gefesselt: 1 };
// Kreatur ist nicht endgültig erledigt: lebend oder liegend in einem erholbaren Zustand (combat.faellt setzt dabei alive=false), und nicht aufgelöst
const nichtEndgueltigErledigt = (o) => !o.weg && (o.alive || !!LIEGT_ERHOLBAR[o.zustand] || (o.liegt === true && o.zustand === 'ok'));
const quelleLebt = (aw, K, q) => {
  for (const o of aw.kreaturen) if (o !== K && nichtEndgueltigErledigt(o) && (q.id ? o.id === q.id : o.typ === q.typ)) return true;
  return false;
};
function bindungAnkerLesen(game, K, par) {
  const aw = game.away; const k = (require('../world.js').AWAY_MAPS[aw.map] || {}).karte;
  if (!k || !Array.isArray(k.anker)) throw new Error('bindung: Karte ' + aw.map + ' hat keine Anker (' + K.typ + ')');
  const q = par.quelle;
  const ids = q.ids ? q.ids.slice() : k.anker.filter((a) => a.rolle === q.rolle).map((a) => a.id);
  if (!ids.length) throw new Error('bindung: Karte ' + aw.map + ' hat keinen Anker der Rolle ' + q.rolle + ' (' + K.typ + ')');
  const R = ankerRollen();
  for (const id of ids) {
    const a = k.anker.find((x) => x.id === id);
    if (!a) throw new Error('bindung: Anker ' + id + ' gibt es auf der Karte ' + aw.map + ' nicht (' + K.typ + ')');
    const erlaubt = (R[a.rolle] && R[a.rolle].zustaende) || [];
    if (!erlaubt.includes(par.bedingung.zustand)) throw new Error('bindung: Zustand ' + par.bedingung.zustand + ' gibt es für Anker ' + id + ' (Rolle ' + a.rolle + ') nicht (' + erlaubt.join(', ') + ')');
  }
  return ids;
}
// Eintritt je Anker beobachten: Zeit des Eintritts (game.time), null = nicht im Zustand, -Infinity = schon beim Anlegen im Zustand (Eintritt unbekannt)
function bindungBeobachten(game, B, zustand, erstmals) {
  const Ank = ankerMod();
  for (let i = 0; i < B.ids.length; i++) {
    const drin = Ank.zustand(game, B.map, B.ids[i]) === zustand;
    if (!drin) B.eintritt[i] = null;
    else if (B.eintritt[i] == null) B.eintritt[i] = erstmals ? -Infinity : game.time;
  }
}
function bindungGeloest(game, B, bed) {
  const f = bed.fenster || 0;
  for (const t of B.eintritt) if (t == null || (f > 0 && game.time - t > f)) return false;
  return true;
}
kreaturBausteinAnmelden('bindung', {
  beiErzeugen(game, K, par) {
    const aw = game.away; const q = par.quelle;
    if (q.art === 'kreatur') {
      if (!quelleLebt(aw, K, q)) throw new Error('bindung: keine lebende Kreatur der Quelle ' + (q.id || q.typ) + ' beim Anlegen (' + K.typ + ')');
      K.bindung = { art: 'kreatur', loesT: null };
      return;
    }
    const ids = bindungAnkerLesen(game, K, par);
    K.bindung = { art: 'anker', map: aw.map, ids, eintritt: ids.map(() => null), loesT: null };
    bindungBeobachten(game, K.bindung, par.bedingung.zustand, true);
  },
  beiAbgleich(game, K, dt, par) {
    const B = K.bindung; if (!B || K.weg) return;
    if (B.loesT == null) {
      let geloest;
      if (B.art === 'kreatur') geloest = !quelleLebt(game.away, K, par.quelle);
      else { bindungBeobachten(game, B, par.bedingung.zustand, false); geloest = bindungGeloest(game, B, par.bedingung); }
      if (!geloest) return;
      B.loesT = par.folge.verzoegerung || 0;
    } else B.loesT -= dt;
    if (B.loesT <= 0) aufloesen(game, K);
  },
  pruefen(par) {
    const F = [];
    if (!par || typeof par !== 'object' || Array.isArray(par)) return ['Objekt { quelle, bedingung, folge } erwartet'];
    for (const k of Object.keys(par)) if (!BINDUNG_FELDER.includes(k)) F.push(k + ': unbekanntes Feld');
    const nur = (o, erlaubt, pfad) => { for (const k of Object.keys(o)) if (!erlaubt.includes(k)) F.push(pfad + '.' + k + ': unbekanntes Feld'); };
    const q = par.quelle;
    let anker = false;
    if (!q || typeof q !== 'object' || Array.isArray(q)) F.push('quelle: Objekt erwartet');
    else if (q.art === 'anker') {
      anker = true; nur(q, ['art', 'ids', 'rolle'], 'quelle');
      if ((q.ids === undefined) === (q.rolle === undefined)) F.push('quelle: genau eines von ids und rolle');
      else if (q.ids !== undefined && (!Array.isArray(q.ids) || !q.ids.length || q.ids.some((i) => typeof i !== 'string' || !i) || new Set(q.ids).size !== q.ids.length)) F.push('quelle.ids: nichtleere Liste verschiedener Anker-IDs (Strings)');
      else if (q.rolle !== undefined && !ankerRollen()[q.rolle]) F.push('quelle.rolle: unbekannte Anker-Rolle "' + q.rolle + '"');
    } else if (q.art === 'kreatur') {
      nur(q, ['art', 'typ', 'id'], 'quelle');
      if ((q.typ === undefined) === (q.id === undefined)) F.push('quelle: genau eines von typ und id');
      else if (q.typ !== undefined && ('string' !== typeof q.typ || !KREATUREN.typen[q.typ])) F.push('quelle.typ: unbekannter Kreaturentyp "' + q.typ + '"');
      else if (q.id !== undefined && !(typeof q.id === 'string' && /^K\d+$/.test(q.id))) F.push('quelle.id: Instanz-ID der Form K<Zahl> erwartet');
    } else F.push('quelle.art: "anker" oder "kreatur"');
    const b = par.bedingung;
    if (anker) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) F.push('bedingung: { zustand, fenster? } erwartet (Anker-Quelle)');
      else {
        nur(b, ['zustand', 'fenster'], 'bedingung');
        if (typeof b.zustand !== 'string' || !b.zustand) F.push('bedingung.zustand: Ankerzustand (String) erwartet');
        else if (q.rolle !== undefined && ankerRollen()[q.rolle] && !(ankerRollen()[q.rolle].zustaende || []).includes(b.zustand)) F.push('bedingung.zustand: "' + b.zustand + '" gibt es für die Rolle ' + q.rolle + ' nicht');
        if (b.fenster !== undefined && !zahl(b.fenster, 0)) F.push('bedingung.fenster: Zahl >= 0 (s), 0 = kein Zeitfenster');
      }
    } else if (b !== undefined && q && q.art === 'kreatur') F.push('bedingung: gibt es bei einer Kreatur-Quelle nicht (gelöst = keine lebende Kreatur der Quelle)');
    const f = par.folge;
    if (!f || typeof f !== 'object' || Array.isArray(f)) F.push('folge: { art: "aufloesen", verzoegerung? } erwartet');
    else {
      nur(f, ['art', 'verzoegerung'], 'folge');
      if (f.art !== 'aufloesen') F.push('folge.art: nur "aufloesen"');
      if (f.verzoegerung !== undefined && !zahl(f.verzoegerung, 0)) F.push('folge.verzoegerung: Zahl >= 0 (s)');
    }
    return F;
  },
});

// ---------- Baustein brut (MON-03 A): die Quelle bringt ihr Gefolge selbst hervor ----------
// Eingeschaltet nur am Typ der Quelle (z. B. der Königin), Parameter nennen den Typ des Nachwuchses; der Server kennt keinen Typnamen. Der Nachwuchs hat in seinem eigenen Typ eine `bindung` an die Quelle
// (Folge `aufloesen`): ohne Quelle löst er sich auf und kehrt nicht wieder, weil eine endgültig erledigte Quelle nicht mehr abgeglichen wird (nichtEndgueltigErledigt). Läuft in beiAbgleich, also auch bei
// betäubter oder bewusstloser Quelle, aber nur mit Außenteam (wie alles in update, sonst stünde die Karte still).
//   typ     Kreaturen-Typ des Nachwuchses (muss in kreaturen.json stehen, eine `bindung` tragen und selbst keine `brut`)
//   anfang  Startbesatz beim ersten Abgleich mit Außenteam (0 bis max)
//   max     höchstens so viele nicht endgültig erledigte Nachkommen gleichzeitig (1 bis BRUT_MAX); NUR dieser Baustein legt Nachwuchs an, kein Lärm, keine Wiederkehr-Folge
//   takt    Sekunden zwischen zwei Neuzugängen, solange unter max (ab dem Fall eines Nachkommen; bei max steht die Uhr)
//   radius  Kacheln um die Quelle, in denen der Nachwuchs erscheint (freie Ankerpunkte der Maske des Nachwuchses, Zufall nur aw.rng)
// Tote Nachkommen (endgültig erledigt) werden still aus aw.kreaturen entfernt (K.weg ohne Ereignis; sie wären sonst nie mehr weg: die Liste wüchse mit jeder Wiederkehr). Bewusstlose zählen als lebend.
// Zähler: K.brut = { t, rest } entsteht lazy nur an der Quelle (die Instanz anderer Kreaturen bleibt unverändert). Nachkommen = gleicher Typ und gleiche Gruppe wie die Quelle (ohne Gruppe: nur der Typ).
const BRUT_FELDER = ['typ', 'anfang', 'max', 'takt', 'radius'];
const BRUT_MAX = 30;           // Deckel im Validator (gemessen MON-03 Erkundung: Tick und Snapshot sind bei 30 kein Problem, Optik ungemessen)
const BRUT_ABSTAND = 1.5;      // Kacheln, Mindestabstand des Nachwuchses zur Mitte der Quelle (er erscheint nicht in ihr)
const BRUT_NACHBAR = 1;        // Kacheln, Mindestabstand des Nachwuchses zu jeder anderen lebenden Kreatur (gemessen ohne: 8 Paare exakt übereinander in 8 Seeds)
const BRUT_VERSUCHE = 12;
const brutNachkomme = (K, O, par) => O !== K && O.kreatur && O.typ === par.typ && (K.gruppe == null || O.gruppe === K.gruppe);
function brutAnlegen(game, aw, K, par, typ, m) {
  const base = Mon.ankerVonPosition(K.x, K.y, typVon(K.typ).groesse);
  for (let i = 0; i < BRUT_VERSUCHE; i++) {
    const cx = base.cx + Math.round((aw.rng() * 2 - 1) * par.radius), cy = base.cy + Math.round((aw.rng() * 2 - 1) * par.radius);
    if (!m.geht(cx, cy)) continue;
    const pos = Mon.mitteVon({ cx, cy }, typ.groesse);
    if (Math.hypot(pos.x - K.x, pos.y - K.y) < BRUT_ABSTAND * TILE) continue;
    if (aw.kreaturen.some((O) => !O.weg && O.alive && Math.hypot(pos.x - O.x, pos.y - O.y) < BRUT_NACHBAR * TILE)) continue;
    try { const N = anlegen(game, aw, par.typ, pos.x, pos.y, K.gruppe != null ? K.gruppe : null); N.facing = aw.rng() * Math.PI * 2; return true; }
    catch (e) { if (game.countError) game.countError('kreatur-brut', e); return false; }
  }
  return false;
}
kreaturBausteinAnmelden('brut', {
  beiAbgleich(game, K, dt, par) {
    const aw = game.away; if (!aw || !aw.kreaturen || K.weg) return;
    let lebend = 0;
    for (const O of aw.kreaturen) {
      if (O.weg || !brutNachkomme(K, O, par)) continue;
      if (nichtEndgueltigErledigt(O)) lebend++; else O.weg = true;   // still: update entfernt nach der Schleife
    }
    if (!game.players.some((p) => p.zone === 'away')) return;
    const k = game.karteOf ? game.karteOf(aw.map) : null; if (!k || typeof aw.rng !== 'function') return;
    const B = K.brut || (K.brut = { t: 0, rest: par.anfang });
    const typ = typVon(par.typ), m = Monster.maskeVonGroesse(k, typ.groesse);
    while (B.rest > 0 && lebend < par.max) { if (!brutAnlegen(game, aw, K, par, typ, m)) return; B.rest--; lebend++; }   // Startbesatz; findet sich kein Platz, im nächsten Abgleich weiter
    if (lebend >= par.max) { B.rest = 0; B.t = 0; return; }
    if (B.rest > 0) return;
    B.t += dt;
    if (B.t < par.takt) return;
    if (brutAnlegen(game, aw, K, par, typ, m)) B.t -= par.takt; else B.t = par.takt;   // kein Platz: beim nächsten Abgleich wieder versuchen
  },
  pruefen(par) {
    const F = [];
    if (!par || typeof par !== 'object' || Array.isArray(par)) return ['Objekt { typ, anfang, max, takt, radius } erwartet'];
    for (const k of Object.keys(par)) if (!BRUT_FELDER.includes(k)) F.push(k + ': unbekanntes Feld');
    const t = hat(KREATUREN.typen, par.typ) ? KREATUREN.typen[par.typ] : null;
    if (!t) F.push('typ: unbekannter Kreaturentyp "' + par.typ + '"');
    else {
      if (!t.bausteine || !t.bausteine.bindung) F.push('typ: "' + par.typ + '" hat keine bindung (der Nachwuchs muss an die Quelle gebunden sein, sonst zerfällt er nie)');
      if (t.bausteine && t.bausteine.brut) F.push('typ: "' + par.typ + '" hat selbst eine brut (Nachwuchs, der Nachwuchs bringt, ist nicht begrenzt)');
    }
    if (!Number.isInteger(par.max) || par.max < 1 || par.max > BRUT_MAX) F.push('max muss eine ganze Zahl 1 bis ' + BRUT_MAX + ' sein (gleichzeitig lebende Nachkommen)');
    if (!Number.isInteger(par.anfang) || par.anfang < 0 || (Number.isInteger(par.max) && par.anfang > par.max)) F.push('anfang muss eine ganze Zahl 0 bis max sein (Startbesatz)');
    if (!zahl(par.takt, 0.5)) F.push('takt muss eine Zahl >= 0,5 sein (s je Neuzugang)');
    if (!zahl(par.radius, 1, 12)) F.push('radius muss eine Zahl 1 bis 12 sein (Kacheln um die Quelle)');
    return F;
  },
});

// ---------- Baustein gefolge (MON-03 B): Heimweg zum Hort und Umkreisen des Horts ----------
// Das Gefolge hängt räumlich an einer Quelle (dem Hort): ohne Ziel (nach Lockung oder Jagd) läuft es zurück, das ist die "Spur zum Nest". Rein datengetrieben: der Typ des Horts steht in par.hort
// (Datenwert, kein Typname im Server), keine Instanzfelder (der Hort wird je Aufruf aus aw.kreaturen gesucht: nächste nicht endgültig erledigte Kreatur des Typs, bevorzugt gleiche Gruppe).
//   hort    Kreaturen-Typ des Horts (muss in kreaturen.json stehen)
//   fern    Kacheln: weiter vom Hort entfernt gilt der Auslöser `fern`
//   daheim  Kacheln: höchstens so weit vom Hort entfernt gilt der Auslöser `daheim` (auch ohne Hort: nichts zum Heimlaufen)
// Modi:  `umkreise`  wie `streife` (zustand.radius Kacheln, aw.rng), Mitte = Position des Horts statt der eigenen;  `zumHort`  Pfad zum Hort (Neuplan über typ.replan), bei Ankunft läuft der Auslöser `daheim`.
// `daheim` muss größer sein als der weiteste Abstand, den der Pfad zum Hort hergeben kann, sonst bliebe das Tier am Hort hängen (Auslöser daheim nie wahr, Neuplan in jedem Tick). Der Suchradius um den Hort (Mon.naechster)
// ist deshalb an daheim gekoppelt (gefolgeSuchradius: weiteste Kachelmitte im Ring liegt höchstens sqrt(2) * (Radius + 0,5) Kacheln vom Hort, das bleibt unter daheim), der Validator verlangt fern > daheim >= 3.
const GEFOLGE_FELDER = ['hort', 'fern', 'daheim'];
const GEFOLGE_SUCHE_MAX = 4;   // Kacheln, Ring um den Hort höchstens (bei großem daheim)
const gefolgeSuchradius = (par) => Math.max(1, Math.min(GEFOLGE_SUCHE_MAX, Math.ceil(par.daheim / Math.SQRT2 - 0.5) - 1));
function hortVon(aw, K, par) {
  let best = null, bd = Infinity;
  for (const O of aw.kreaturen) {
    if (O === K || O.typ !== par.hort || !nichtEndgueltigErledigt(O)) continue;
    const d = Math.hypot(O.x - K.x, O.y - K.y) + (K.gruppe != null && O.gruppe !== K.gruppe ? 1e6 : 0);
    if (d < bd) { bd = d; best = O; }
  }
  return best;
}
kreaturBausteinAnmelden('gefolge', {
  modi: {
    umkreise: {
      tick(game, K, dt, ctx, par, z) {
        if (!K.pfad.length && K.replan <= 0) {
          const aw = game.away; const r = z.radius || 5;
          const H = hortVon(aw, K, par);
          const base = Mon.ankerVonPosition(H ? H.x : K.x, H ? H.y : K.y, ctx.m.fuss);
          for (let i = 0; i < 12; i++) {
            const cx = base.cx + Math.round((aw.rng() * 2 - 1) * r), cy = base.cy + Math.round((aw.rng() * 2 - 1) * r);
            if (ctx.m.geht(cx, cy)) { Monster.setzePfad(K, ctx.m, { cx, cy }); break; }
          }
          K.replan = 1.2;
        }
        gehe(game, K, dt, ctx, tempoVon(K, z));
      },
    },
    zumHort: {
      tick(game, K, dt, ctx, par, z) {
        if (K.replan <= 0 || !K.pfad.length) {
          const H = hortVon(game.away, K, par);
          if (H) { const a = Mon.naechster(ctx.m, Math.floor(H.x / TILE), Math.floor(H.y / TILE), gefolgeSuchradius(par)); if (a) Monster.setzePfad(K, ctx.m, a); }
          K.replan = ctx.typ.replan;
        }
        gehe(game, K, dt, ctx, tempoVon(K, z));
      },
    },
  },
  ausloeser: {
    fern(game, K, ctx, par) { const H = hortVon(game.away, K, par); return !!H && Math.hypot(H.x - K.x, H.y - K.y) > par.fern * TILE; },
    daheim(game, K, ctx, par) { const H = hortVon(game.away, K, par); return !H || Math.hypot(H.x - K.x, H.y - K.y) <= par.daheim * TILE; },
  },
  pruefen(par) {
    const F = [];
    if (!par || typeof par !== 'object' || Array.isArray(par)) return ['Objekt { hort, fern, daheim } erwartet'];
    for (const k of Object.keys(par)) if (!GEFOLGE_FELDER.includes(k)) F.push(k + ': unbekanntes Feld');
    if (typeof par.hort !== 'string' || !hat(KREATUREN.typen, par.hort)) F.push('hort: unbekannter Kreaturentyp "' + par.hort + '"');
    if (!zahl(par.daheim, 3, 20)) F.push('daheim muss eine Zahl 3 bis 20 sein (Kacheln, Ankunft am Hort)');
    else if (!(Math.SQRT2 * (gefolgeSuchradius(par) + 0.5) < par.daheim)) F.push('daheim muss größer sein als der Suchradius um den Hort (Pfadziel höchstens ' + (Math.SQRT2 * (gefolgeSuchradius(par) + 0.5)).toFixed(1) + ' Kacheln vom Hort)');
    if (!zahl(par.fern, 4, 40) || (zahl(par.daheim, 3, 20) && par.fern <= par.daheim)) F.push('fern muss eine Zahl 4 bis 40 und größer als daheim sein (Kacheln)');
    return F;
  },
});

// ---------- Baustein streuung (MON-03 Nacharbeit A): Kreaturen, die ihn tragen, stapeln sich nicht ----------
// Ohne Abstoßung laufen viele Tiere desselben Typs auf denselben Pfadendpunkt und stehen dort auf einem Punkt (gemessen: 18 von 20 in einer 6-px-Zelle, im Bild 2 bis 3). Jede Kreatur mit diesem Baustein weicht
// den anderen Kreaturen MIT diesem Baustein aus, die näher als `abstand` stehen (Mittelpunktabstand): Weg nach außen mit `tempo` bei Abstand 0, linear abnehmend bis `abstand`, über dieselbe Kollision wie die
// Bewegung (nie in eine Wand). Tiere ohne den Baustein (Rudeltier, Station) bleiben unberührt und sehen die Träger nicht als Hindernis. Keine Instanzfelder, kein Zufall (bei gleichem Ort entscheidet die
// Nummer der Instanz über die Richtung, die beiden Partner weichen entgegengesetzt aus), Wirkung nur auf die eigene Position. Während des Rammens (Modus ramme) steht der Baustein still: der Biss bleibt exakt.
//   abstand  px, Mindestabstand der Mitten (etwa Kollisionsbox + Luft)
//   tempo    px/s, Ausweichtempo bei Abstand 0
const STREUUNG_FELDER = ['abstand', 'tempo'];
const STREUUNG_GOLD = 2.399963;   // Goldener Winkel (rad): gleichmäßig verteilte Richtungen aus den Nummern
const nummerVon = (K) => Number(String(K.id).slice(1)) || 0;
kreaturBausteinAnmelden('streuung', {
  beiTick(game, K, dt, par, ctx) {
    if (ctx.typ.zustaende[K.z].modus === 'ramme') return;
    const L = game.away.kreaturen; let vx = 0, vy = 0;
    const nK = nummerVon(K);
    for (const O of L) {
      if (O === K || O.weg || !O.alive) continue;
      const dx = K.x - O.x, dy = K.y - O.y;
      if (dx > par.abstand || dx < -par.abstand || dy > par.abstand || dy < -par.abstand) continue;
      const d = Math.hypot(dx, dy); if (d >= par.abstand) continue;
      const tO = typVon(O.typ); if (!tO || !tO.bausteine.streuung) continue;
      const w = 1 - d / par.abstand;
      if (d > 1e-6) { vx += dx / d * w; vy += dy / d * w; }
      else { const nO = nummerVon(O); const a = (Math.min(nK, nO) * 7 + Math.max(nK, nO) * 13) * STREUUNG_GOLD, s = nK > nO ? 1 : -1; vx += Math.cos(a) * s * w; vy += Math.sin(a) * s * w; }
    }
    const v = Math.hypot(vx, vy); if (v < 1e-9) return;
    const f = Math.min(v, 1) * par.tempo * dt / v;
    const res = Physics.moveWithCollision(ctx.E.solid, K.x, K.y, vx * f, vy * f, hbVon(ctx.typ));
    K.x = res.x; K.y = res.y;
  },
  pruefen(par) {
    const F = [];
    if (!par || typeof par !== 'object' || Array.isArray(par)) return ['Objekt { abstand, tempo } erwartet'];
    for (const k of Object.keys(par)) if (!STREUUNG_FELDER.includes(k)) F.push(k + ': unbekanntes Feld');
    if (!zahl(par.abstand, 4, 32)) F.push('abstand muss eine Zahl 4 bis 32 sein (px, Mittelpunktabstand)');
    if (!zahl(par.tempo, 1, 200)) F.push('tempo muss eine Zahl 1 bis 200 sein (px/s)');
    return F;
  },
});

// MON-02 P2: Kreatur fällt endgültig aus (verwundet/aus, nicht bewusstlos): Ereignis `kreaturAusgefallen {id, typ, gruppe, x, y}` (Spiel- und Missionsereignis), höchstens einmal je Kreatur.
// Aufrufer: combat.faellt nach knockOut. Bewusstlose Kreaturen melden nichts (sie stehen wieder auf); fällt eine aufgewachte später verwundet, meldet sie dann. Der Merker K.ausgefallenGemeldet entsteht erst bei der Meldung (nicht in anlegen).
function ausgefallenMelden(game, K) {
  if (!K || !K.kreatur || K.weg || K.ausgefallenGemeldet || nichtEndgueltigErledigt(K)) return false;
  K.ausgefallenGemeldet = true;
  const d = { id: K.id, typ: K.typ, gruppe: K.gruppe != null ? K.gruppe : null, x: Math.round(K.x), y: Math.round(K.y) };
  game.emit('kreaturAusgefallen', d);
  game.missionEvent('kreaturAusgefallen', d);
  return true;
}
// MON-02 P2: Prüfung für den Baustein kreaturen_erledigt. Erledigt = mindestens ein Tier erschien (Buchführung aw.kreaturGruppen) und kein Tier der Gruppe (oder des Typs) ist mehr nicht endgültig erledigt.
// Aufgelöste Tiere (Bindung) zählen als erledigt, bewusstlose und liegende (erholbare) nicht. Unbekannte Karte oder Gruppe (nie erschienen): nicht erfüllt. opts { gruppe } oder { typ } (genau eines).
// Fehler der Parameter von kreaturen_erledigt (Prüfer und Laufzeit teilen sie): genau eines von gruppe/typ, typ muss in kreaturen.json stehen. Liefert Texte ([] = in Ordnung).
function erledigtOptionenFehler(opts) {
  const o = opts || {};
  if (o.gruppe == null && o.typ == null) return ["braucht genau eines von 'gruppe' oder 'typ' (beide fehlen)"];
  if (o.gruppe != null && o.typ != null) return ["braucht genau eines von 'gruppe' oder 'typ' (beide gesetzt)"];
  if (o.typ != null && !hat(daten().typen, o.typ)) return ["Typ '" + o.typ + "' gibt es in content/kampf/kreaturen.json nicht (" + Object.keys(daten().typen).join(', ') + ")"];
  return [];
}
const erledigtFehlerGemeldet = new WeakSet();   // je Spiel höchstens eine Laufzeitmeldung (die Prüfung läuft jeden Tick)
function rudelErledigt(game, map, opts) {
  const o = opts || {};
  const F = erledigtOptionenFehler(o);
  if (F.length) {
    if (game && game.countError && !erledigtFehlerGemeldet.has(game)) { erledigtFehlerGemeldet.add(game); game.countError('mission-kreatur', new Error('kreaturen_erledigt: ' + F[0])); }
    return false;
  }
  const aw = game && game.aways && hat(game.aways, map) ? game.aways[map] : null;
  const G = aw && aw.kreaturGruppen;
  if (!G) return false;
  let erschienen = 0;
  if (o.gruppe != null) { if (hat(G, o.gruppe)) erschienen = G[o.gruppe].erschienen; }
  else for (const k of Object.keys(G)) if (G[k].typ === o.typ) erschienen += G[k].erschienen;
  if (!(erschienen > 0)) return false;
  for (const K of aw.kreaturen || []) if ((o.gruppe != null ? K.gruppe === o.gruppe : K.typ === o.typ) && nichtEndgueltigErledigt(K)) return false;
  return true;
}

// Kreatur sauber auflösen: hier nur markiert (update() entfernt nach der Schleife), Ereignisse sofort. Kein Fall, kein droneKilled, kein knockOut.
function aufloesen(game, K) {
  if (K.weg) return;
  K.weg = true;
  const d = { id: K.id, typ: K.typ, x: Math.round(K.x), y: Math.round(K.y) };
  game.emit('kreaturAufgeloest', d);
  game.missionEvent('kreaturAufgeloest', d);
}

// ---------- Daten laden und prüfen ----------
const TYP_FELDER = ['name', 'groesse', 'kollision', 'sicht', 'verlustZeit', 'replan', 'hitRadius', 'schild', 'schildRegen', 'wunden', 'frontArc', 'tuerenAufbrechen', 'rammZeit', 'start', 'zustaende', 'bausteine'];
const ZUSTAND_FELDER = ['modus', 'tempo', 'dauer', 'radius', 'uebergang'];
const UEBERGANG_FELDER = ['auf', 'nach', 'abstand'];
const KOLLISION_FELDER = ['box'];
const SCHILD_FELDER = ['seg', 'max'];
const SCHILDREGEN_FELDER = ['verzoegerung', 'schritt'];
const zahl = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && (max === undefined || v <= max);

function pruefen(d) {
  const F = [];
  const f = (pfad, text) => F.push(pfad + ': ' + text);
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['kreaturen.json: Objekt erwartet'];
  if (d.version !== 1) f('version', 'muss 1 sein');
  if (!d.typen || typeof d.typen !== 'object' || Array.isArray(d.typen)) { f('typen', 'Objekt erwartet'); return F; }
  for (const [id, t] of Object.entries(d.typen)) {
    const P = 'typen.' + id;
    if (!t || typeof t !== 'object' || Array.isArray(t)) { f(P, 'Objekt erwartet'); continue; }
    for (const k of Object.keys(t)) if (!TYP_FELDER.includes(k)) f(P + '.' + k, 'unbekanntes Feld');
    if (typeof t.name !== 'string' || !t.name) f(P + '.name', 'Name-Schlüssel (String) fehlt');
    if (!GROESSEN.includes(t.groesse)) f(P + '.groesse', 'muss ' + GROESSEN.join(' oder ') + ' sein (Kanten des Fußabdrucks in Kacheln; 3 und 4 gibt es nicht)');
    // kollision.box: Kante der quadratischen Kollisionsbox in px, um die Mitte des Tieres (Größe 1: Kachelmitte, Größe 2: Kachelecke). Obergrenze: 8 px Luft zum Fußabdruck, damit die Box nie in eine feste Kachel ragt, die die Maske nicht prüft.
    if (t.kollision !== undefined) {
      if (!t.kollision || typeof t.kollision !== 'object' || Array.isArray(t.kollision)) f(P + '.kollision', 'optional: { box } (Objekt)');
      else {
        for (const k of Object.keys(t.kollision)) if (!KOLLISION_FELDER.includes(k)) f(P + '.kollision.' + k, 'unbekanntes Feld');
        if (!zahl(t.kollision.box, 4, GROESSEN.includes(t.groesse) ? t.groesse * TILE - 8 : undefined)) f(P + '.kollision.box', 'Zahl 4 bis ' + (GROESSEN.includes(t.groesse) ? t.groesse * TILE - 8 : 'Größe × 32 − 8') + ' (px Kantenlänge der Kollisionsbox)');
      }
    }
    if (!zahl(t.sicht, 0.1)) f(P + '.sicht', 'Zahl > 0 (Kacheln)');
    if (!zahl(t.verlustZeit, 0)) f(P + '.verlustZeit', 'Zahl >= 0 (s)');
    if (!zahl(t.replan, 0.05)) f(P + '.replan', 'Zahl >= 0,05 (s)');
    if (!zahl(t.hitRadius, 1)) f(P + '.hitRadius', 'Zahl >= 1 (px)');
    if (!t.schild || !zahl(t.schild.seg, 0) || !zahl(t.schild.max, 1) || t.schild.seg > t.schild.max || !Number.isInteger(t.schild.seg) || !Number.isInteger(t.schild.max)) f(P + '.schild', '{ seg, max } ganze Zahlen, 0 <= seg <= max, max >= 1');
    if (t.schild && typeof t.schild === 'object') for (const k of Object.keys(t.schild)) if (!SCHILD_FELDER.includes(k)) f(P + '.schild.' + k, 'unbekanntes Feld');
    if (t.schildRegen && typeof t.schildRegen === 'object') for (const k of Object.keys(t.schildRegen)) if (!SCHILDREGEN_FELDER.includes(k)) f(P + '.schildRegen.' + k, 'unbekanntes Feld');
    if (t.schildRegen !== undefined && (!t.schildRegen || !zahl(t.schildRegen.verzoegerung, 0) || !zahl(t.schildRegen.schritt, 0.05))) f(P + '.schildRegen', 'optional: { verzoegerung (s ohne Treffer) >= 0, schritt (s je Segment) >= 0,05 }; fehlt = keine Regeneration');
    if (!Number.isInteger(t.wunden) || t.wunden < 1) f(P + '.wunden', 'ganze Zahl >= 1');
    if (!zahl(t.frontArc, 0, 360)) f(P + '.frontArc', 'Zahl 0..360 (Grad, 0 = keine Frontpanzerung)');
    if (typeof t.tuerenAufbrechen !== 'boolean') f(P + '.tuerenAufbrechen', 'true oder false');
    if (!zahl(t.rammZeit, 0.05)) f(P + '.rammZeit', 'Zahl >= 0,05 (s)');
    const bs = t.bausteine;
    if (!bs || typeof bs !== 'object' || Array.isArray(bs)) f(P + '.bausteine', 'Objekt erwartet (leer erlaubt)');
    const aktiv = bs && typeof bs === 'object' ? Object.keys(bs) : [];
    for (const b of aktiv) {
      const def = bausteine.get(b);
      if (!def) { f(P + '.bausteine.' + b, 'unbekannter Baustein (angemeldet: ' + [...bausteine.keys()].join(', ') + ')'); continue; }
      if (def.pruefen) for (const m of def.pruefen(bs[b])) f(P + '.bausteine.' + b, m);
    }
    const modi = new Set(KERN_NAMEN.modi), ausl = new Set(KERN_NAMEN.ausloeser);
    for (const b of aktiv) { const def = bausteine.get(b); if (def) { for (const n of Object.keys(def.modi || {})) modi.add(n); for (const n of Object.keys(def.ausloeser || {})) ausl.add(n); } }
    // Namen der Bausteine dürfen sich nicht überdecken: weder untereinander noch mit den Kernnamen (sonst gewinnt still einer)
    for (const [gruppe, kern] of [['modi', KERN_NAMEN.modi], ['ausloeser', KERN_NAMEN.ausloeser]]) {
      const von = new Map();
      for (const b of aktiv) {
        const def = bausteine.get(b); if (!def) continue;
        for (const n of Object.keys(def[gruppe] || {})) {
          if (kern.includes(n)) f(P + '.bausteine.' + b, (gruppe === 'modi' ? 'Modus "' : 'Auslöser "') + n + '" ist ein Kernname und darf nicht überdeckt werden');
          else if (von.has(n)) f(P + '.bausteine.' + b, (gruppe === 'modi' ? 'Modus "' : 'Auslöser "') + n + '" gibt es schon im Baustein ' + von.get(n));
          else von.set(n, b);
        }
      }
    }
    const Z = t.zustaende;
    if (!Z || typeof Z !== 'object' || Array.isArray(Z) || !Object.keys(Z).length) { f(P + '.zustaende', 'mindestens ein Zustand'); continue; }
    if (typeof t.start !== 'string' || !Z[t.start]) f(P + '.start', 'muss ein Zustand der Tabelle sein');
    for (const [zn, z] of Object.entries(Z)) {
      const ZP = P + '.zustaende.' + zn;
      if (!z || typeof z !== 'object' || Array.isArray(z)) { f(ZP, 'Objekt erwartet'); continue; }
      for (const k of Object.keys(z)) if (!ZUSTAND_FELDER.includes(k)) f(ZP + '.' + k, 'unbekanntes Feld');
      if (!modi.has(z.modus)) f(ZP + '.modus', 'unbekannter Modus "' + z.modus + '" (bekannt bei diesem Typ: ' + [...modi].join(', ') + ')');
      if (!zahl(z.tempo, 0)) f(ZP + '.tempo', 'Zahl >= 0 (px/s)');
      if (z.dauer !== undefined && !zahl(z.dauer, 0.05)) f(ZP + '.dauer', 'Zahl >= 0,05 (s)');
      if (z.radius !== undefined && !zahl(z.radius, 1)) f(ZP + '.radius', 'Zahl >= 1 (Kacheln)');
      if (!Array.isArray(z.uebergang)) { f(ZP + '.uebergang', 'Liste erwartet (leer erlaubt)'); continue; }
      z.uebergang.forEach((u, i) => {
        const UP = ZP + '.uebergang[' + i + ']';
        if (!u || typeof u !== 'object') { f(UP, 'Objekt erwartet'); return; }
        for (const k of Object.keys(u)) if (!UEBERGANG_FELDER.includes(k)) f(UP + '.' + k, 'unbekanntes Feld');
        if (!ausl.has(u.auf)) f(UP + '.auf', 'unbekannter Auslöser "' + u.auf + '" (bekannt bei diesem Typ: ' + [...ausl].join(', ') + ')');
        if (typeof u.nach !== 'string' || !Z[u.nach]) f(UP + '.nach', 'Zustand "' + u.nach + '" gibt es nicht');
        if (u.auf === 'ablauf' && z.dauer === undefined) f(UP, 'Auslöser ablauf braucht eine dauer im Zustand');
        if (u.auf === 'nah' && !zahl(u.abstand, 0.1)) f(UP + '.abstand', 'Auslöser nah braucht abstand > 0 (Kacheln)');
        if (u.auf !== 'nah' && u.abstand !== undefined) f(UP + '.abstand', 'abstand gilt nur für den Auslöser nah');
      });
      // Sackgasse: der Modus ramme mit Tempo 0 bewegt sich nie, `blockiert` kann daher nie auslösen; gibt es keinen anderen Ausgang, bleibt die Kreatur dort für immer
      if (z.modus === 'ramme' && z.tempo === 0 && z.uebergang.every((u) => u && u.auf === 'blockiert')) f(ZP, 'Sackgasse: Modus ramme mit tempo 0 kann nie blockieren, und es gibt keinen anderen Ausgang');
    }
    // unerreichbare Zustände: von `start` aus über die Übergänge nicht zu betreten
    if (typeof t.start === 'string' && Z[t.start]) {
      const gesehen = new Set([t.start]); const rest = [t.start];
      while (rest.length) {
        const z = Z[rest.pop()];
        for (const u of (z && Array.isArray(z.uebergang) ? z.uebergang : [])) if (u && typeof u.nach === 'string' && Z[u.nach] && !gesehen.has(u.nach)) { gesehen.add(u.nach); rest.push(u.nach); }
      }
      for (const zn of Object.keys(Z)) if (!gesehen.has(zn)) f(P + '.zustaende.' + zn, 'unerreichbar (von start "' + t.start + '" führt kein Übergang dorthin)');
    }
  }
  return F;
}

function daten() {
  if (zwischenDaten) return zwischenDaten;
  const F = pruefen(KREATUREN);
  if (F.length) throw new Error('content/kampf/kreaturen.json ungültig (' + F.length + ' Fehler):\n  ' + F.join('\n  '));
  zwischenDaten = KREATUREN;
  return zwischenDaten;
}
const typVon = (id) => { const t = daten().typen[id]; return t || null; };
const typIds = () => Object.keys(daten().typen);

// ---------- Instanzen ----------
const kreaturen = (game) => { const aw = game.away; return aw && aw.kreaturen ? aw.kreaturen : null; };
function betreten(game, K, zn, ctx) {
  const typ = typVon(K.typ); const z = typ.zustaende[zn];
  if (K.z != null) bausteinWechsel(game, K, K.z, zn);   // MON-02 P1: Hook vor dem Zurücksetzen (K.rammTreffer, K.blockiert des alten Zustands gelten noch)
  K.z = zn; K.zt = 0; K.t = z.dauer !== undefined ? z.dauer : null; K.blockiert = false; K.rammTreffer = false; K.ramm = null; K.pfad = []; K.replan = 0; K.tuerGesperrt = false;
  const modus = modusVon(typ, z.modus);
  if (modus && modus.betreten) modus.betreten(game, K, ctx || null, parVon(typ, z.modus), z);
}
function modusVon(typ, name) {
  if (KERN_MODI[name]) return KERN_MODI[name];
  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.modi && def.modi[name]) return def.modi[name]; }
  return null;
}
function parVon(typ, modusName) {
  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.modi && def.modi[modusName]) return typ.bausteine[b]; }
  return null;
}
function ausloeserVon(typ, name) {
  if (KERN_AUSLOESER[name]) return { fn: KERN_AUSLOESER[name], par: null };
  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.ausloeser && def.ausloeser[name]) return { fn: def.ausloeser[name], par: typ.bausteine[b] }; }
  return null;
}

// Zustand von außen setzen (Szenenbausteine, Tests): durchläuft dieselbe Eintrittsroutine wie ein Übergang der Tabelle
function zustandSetzen(game, K, zustand) {
  const typ = typVon(K.typ);
  if (!typ.zustaende[zustand]) throw new Error('zustandSetzen: Zustand ' + zustand + ' gibt es bei ' + K.typ + ' nicht');
  betreten(game, K, zustand, null);
}

// Neue Kreatur auf einer Außenkarte. Gemeinsamer Kern von erzeugen (game.away) und erzeugenAuf (gegebene Karte). `gruppe` (MON-02 P1) ist die Rudel-Kennung K.gruppe, nur gesetzt, wenn angegeben.
function anlegen(game, aw, typId, x, y, gruppe) {
  if (!aw) throw new Error('erzeugen: keine Außenkarte');
  const typ = typVon(typId); if (!typ) throw new Error('erzeugen: unbekannter Typ ' + typId);
  // beiErzeugen-Hooks (bindung) lesen game.away: auf einer anderen als der aktiven Karte wären sie falsch. Lieber laut abbrechen als still die falsche Karte lesen.
  if (aw !== game.away) for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiErzeugen) throw new Error('erzeugenAuf: Baustein ' + b + ' liest die aktive Außenkarte, Typ ' + typId + ' nur auf game.away anlegen'); }
  if (!aw.kreaturen) aw.kreaturen = [];
  aw.kreaturSeq = (aw.kreaturSeq || 0) + 1;
  const K = { id: 'K' + aw.kreaturSeq, kind: 'kreatur', kreatur: true, typ: typId, x, y, facing: 0, alive: true, team: 'feind',
    seg: typ.schild.seg, max: typ.schild.max, hp: typ.schild.seg, lastHitAt: -99, regenT: 0, wunden: { n: typ.wunden, max: typ.wunden }, frontArc: typ.frontArc, hitRadius: typ.hitRadius,
    z: null, zt: 0, t: null, pfad: [], ziel: null, ramm: null, replan: 0, blockiert: false, tuerGesperrt: false, verlust: 0, letzte: null, stuckT: 0, ref: { x, y } };
  if (gruppe != null) K.gruppe = gruppe;
  K.laermCursor = laermCursorAnlegen(aw);   // Altlast im Lärmpuffer nicht lesen
  betreten(game, K, typ.start, null);
  try { for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiErzeugen) def.beiErzeugen(game, K, typ.bausteine[b]); } }
  catch (e) { aw.kreaturSeq--; throw e; }   // Quelle fehlt o. ä.: keine halbe Kreatur, Nummer wieder frei
  aw.kreaturen.push(K);
  return K;
}
// Neue Kreatur in game.away. Liefert die Instanz. Nur über Debug oder über Karten-/Szenenbausteine aufrufen.
function erzeugen(game, typId, x, y) { return anlegen(game, game.away, typId, x, y, null); }
// Neue Kreatur auf einer gegebenen Außenkarte aw (MON-02 P1): für Missionsaktionen, die VOR der Landung laufen (game.away ist dann eine andere oder keine Karte). opts { x, y, gruppe? }.
// Typen mit einem Baustein, dessen beiErzeugen game.away liest (bindung), gehen nur auf der aktiven Karte (Fehler sonst).
function erzeugenAuf(game, aw, typId, opts) {
  const o = opts || {};
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) throw new Error('erzeugenAuf: x und y (Zahlen) fehlen');
  if (o.gruppe != null && (typeof o.gruppe !== 'string' || !GRUPPE_FORM.test(o.gruppe))) throw new Error('erzeugenAuf: gruppe muss ein Text der Form ' + GRUPPE_FORM + ' sein');
  return anlegen(game, aw, typId, o.x, o.y, o.gruppe != null ? o.gruppe : null);
}

// ---------- Rudel (MON-02 P1) ----------
// rudelSetzen(game, { map, bereich?, typ, anzahl, gruppe }) -> { n, ids, fehler }: legt ein Rudel (Kennung K.gruppe) auf einer Außenkarte an (Aufrufer: Missionsaktion kreatur_besetzen).
// Plätze: nur Ankerpunkte der Maske des Typs (Fußabdruck frei), die vom Abholpunkt aus erreichbar sind, im Bereich (ohne bereich: ganze Karte) und mindestens RUDEL_ABHOLPUNKT Kacheln vom Abholpunkt.
// Das Rudel steht kompakt um einen Mittelpunkt (zufällig aus aw.rng, höchstens RUDEL_VERSUCHE Zufallswahlen, danach der Reihe nach, insgesamt höchstens RUDEL_MITTELPUNKTE; „kein Platz“ heißt dann: keiner gefunden) mit mindestens
// RUDEL_ABSTAND Kacheln Abstand der Tiere untereinander (auch zu schon vorhandenen Kreaturen). Fehler (unbekannter Typ, Bereich, Karte, Anzahl, Karte ohne Abholpunkt, kein erreichbarer Platz) kommen als Text zurück, es entsteht dann nichts
// (auch kein halbes Rudel, wenn das Anlegen eines Tiers wirft: schon angelegte Tiere werden wieder entfernt).
// aw.kreaturGruppen[gruppe] = { erschienen, typ } (Buchführung je Karte, in aw, nie im Weltstand; raeumen räumt sie mit).
const RUDEL_MAX = 12;           // Tiere je Aufruf
const RUDEL_ABSTAND = 1.5;      // Kacheln, Mindestabstand der Tiere beim Start (Mitte zu Mitte)
const RUDEL_ABHOLPUNKT = 10;    // Kacheln, Mindestabstand zum Abholpunkt
const RUDEL_VERSUCHE = 60;      // Zufallswahlen des Mittelpunkts, bevor der Reihe nach gesucht wird
const RUDEL_MITTELPUNKTE = 100; // Deckel: so viele Mittelpunkte werden höchstens probiert (jeder kostet einen Durchlauf über alle Kandidaten), danach Fehler statt Blockade im Tick
const GRUPPE_FORM = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
const hat = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const weltMod = () => require('../world.js');
// Karte registrieren wie combat.besetzen (F1): nicht registrierte Landepunkt-Karte aus dem Cache holen, nie bauen
function karteRegistriert(game, map) {
  let aw = game.aways && game.aways[map];
  if ((!aw || !weltMod().AWAY_MAPS[map]) && map) {
    try { const L = require('./landepunkte.js'); if (L && typeof L.bereit === 'function' && L.bereit(game, map)) aw = game.aways[map]; } catch (e) { /* ohne Landepunkte: unbekannt */ }
  }
  return aw && weltMod().AWAY_MAPS[map] ? aw : null;
}
function rudelSetzen(game, o) {
  const fehl = (t) => ({ n: 0, ids: [], fehler: 'kreatur_besetzen: ' + t });
  const p = o || {};
  let typ = null;
  try { typ = hat(daten().typen, p.typ) ? typVon(p.typ) : null; } catch (e) { return fehl(e.message.split('\n')[0]); }
  if (!typ) return fehl('unbekannter Typ "' + p.typ + '"');
  const n = p.anzahl;
  if (!Number.isInteger(n) || n < 1 || n > RUDEL_MAX) return fehl('anzahl muss eine ganze Zahl von 1 bis ' + RUDEL_MAX + ' sein (' + n + ')');
  if (typeof p.gruppe !== 'string' || !GRUPPE_FORM.test(p.gruppe)) return fehl('gruppe muss ein Text der Form ' + GRUPPE_FORM + ' sein (' + p.gruppe + ')');
  const aw = karteRegistriert(game, p.map);
  if (!aw) return fehl('Karte ' + p.map + ' unbekannt');
  const k = game.karteOf ? game.karteOf(p.map) : null;
  if (!k) return fehl('Karte ' + p.map + ' hat keine Kartendaten');
  let rects = null;
  if (p.bereich != null) {   // ein unbekannter Bereich fällt NICHT still auf die ganze Karte zurück
    const b = hat(k.bereiche, p.bereich) ? k.bereiche[p.bereich] : null;
    if (!b || !Array.isArray(b.rects)) return fehl('Bereich "' + p.bereich + '" gibt es auf der Karte ' + p.map + ' nicht (' + Object.keys(k.bereiche || {}).join(', ') + ')');
    rects = b.rects;
  }
  const alt = hat(aw.kreaturGruppen, p.gruppe) ? aw.kreaturGruppen[p.gruppe] : null;
  if (alt && alt.typ !== p.typ) return fehl('Gruppe "' + p.gruppe + '" besteht schon mit dem Typ ' + alt.typ);
  combat().ensureV2(game, aw, p.map);   // aw.rng
  const m = Monster.maskeVonGroesse(k, typ.groesse);
  const abhol = (k.anker || []).filter((a) => a.rolle === 'abholpunkt');
  const ref = abhol.find((a) => a.ankunft) || abhol[0] || null;
  // Ohne Abholpunkt gäbe es weder Erreichbarkeit noch Abstand (karte.ankunft ist selbst die Kennung eines Abholpunkts, taugt also nicht als Ersatz): laut scheitern statt still prüfen zu lassen
  if (!ref) return fehl('Karte ' + p.map + ' hat keinen Abholpunkt: Erreichbarkeit und Abstand zum Landeplatz sind nicht prüfbar');
  const start = Mon.naechster(m, ref.x, ref.y, 4);
  if (!start) return fehl('kein erreichbarer Platz: am Abholpunkt hat ein Tier der Größe ' + typ.groesse + ' keinen Platz');
  const dist = Mon.bfs(m, [start]);
  const kand = [];
  for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
    if (!m.geht(cx, cy) || dist[cy * m.w + cx] < 0) continue;
    const pos = Mon.mitteVon({ cx, cy }, typ.groesse);
    const tx = Math.floor(pos.x / TILE), ty = Math.floor(pos.y / TILE);
    if (rects && !rects.some((r) => tx >= r[0] && tx < r[0] + r[2] && ty >= r[1] && ty < r[1] + r[3])) continue;
    if (abhol.some((a) => Math.hypot(tx - a.x, ty - a.y) < RUDEL_ABHOLPUNKT)) continue;
    kand.push(pos);
  }
  const R2 = Math.pow(Math.max(4, Math.ceil(Math.sqrt(n) * 2)) * TILE, 2), D2 = Math.pow(RUDEL_ABSTAND * TILE, 2);
  const vorhanden = (aw.kreaturen || []).filter((K) => K.alive);
  const rudelUm = (c) => {   // die n Plätze, die der Mitte am nächsten liegen und je RUDEL_ABSTAND auseinander (greedy), sonst null
    const d = (q) => (q.x - c.x) * (q.x - c.x) + (q.y - c.y) * (q.y - c.y);
    const nah = kand.filter((q) => d(q) <= R2);
    nah.sort((a, b) => d(a) - d(b));
    const wahl = [];
    for (const q of nah) {
      if (wahl.some((w) => (w.x - q.x) * (w.x - q.x) + (w.y - q.y) * (w.y - q.y) < D2)) continue;
      if (vorhanden.some((K) => (K.x - q.x) * (K.x - q.x) + (K.y - q.y) * (K.y - q.y) < D2)) continue;
      wahl.push(q);
      if (wahl.length === n) return wahl;
    }
    return null;
  };
  const pool = kand.slice();
  let wahl = null;
  let probiert = 0;
  for (let v = 0; pool.length && !wahl && v < RUDEL_MITTELPUNKTE; v++) {
    const i = v < RUDEL_VERSUCHE ? Math.floor(aw.rng() * pool.length) : 0;
    const c = pool[i]; pool[i] = pool[pool.length - 1]; pool.pop();
    wahl = rudelUm(c); probiert++;
  }
  if (!wahl) return fehl('kein erreichbarer Platz für ' + n + ' Tiere (Größe ' + typ.groesse + ', Abstand ' + RUDEL_ABSTAND + ' Kacheln) in ' + (p.bereich != null ? 'Bereich ' + p.bereich : 'der Karte') + ' von Karte ' + p.map + ' (' + kand.length + ' erreichbare Ankerpunkte, ' + probiert + ' Mittelpunkte probiert' + (probiert < kand.length ? ', Suche beim Deckel ' + RUDEL_MITTELPUNKTE + ' abgebrochen' : '') + ')');
  const ids = [];
  const seq0 = aw.kreaturSeq || 0, laenge0 = (aw.kreaturen || []).length;
  try {
    for (const q of wahl) { const K = anlegen(game, aw, p.typ, q.x, q.y, p.gruppe); K.facing = aw.rng() * Math.PI * 2; ids.push(K.id); }
  } catch (e) {   // kein halbes Rudel: schon angelegte Tiere zurücknehmen (Nummern wieder frei), keine Buchführung
    if (aw.kreaturen) aw.kreaturen.length = laenge0;
    aw.kreaturSeq = seq0;
    return fehl(e.message);
  }
  const G = aw.kreaturGruppen || (aw.kreaturGruppen = {});
  G[p.gruppe] = { erschienen: (alt ? alt.erschienen : 0) + n, typ: p.typ };
  return { n, ids, fehler: null };
}

// ---------- Nest (MON-03 A) ----------
// nestSetzen(game, { map, typ, gruppe, x, y }) -> { n, ids, fehler }: legt EINE Quelle (z. B. die Königin eines Schwarms) an der Maskenposition nächst der Kachel (x, y) an (Kacheln, wie ein Anker; Suchradius NEST_SUCHE)
// und führt die Buchführung aw.kreaturGruppen[gruppe] wie rudelSetzen, damit `kreaturen_erledigt { typ }` stimmt. Der Nachwuchs entsteht danach über den Baustein `brut` des Typs, nicht hier.
// Eigene Funktion statt Parameter an rudelSetzen (Rudel: viele, gestreut, mit Abholpunkt-Abstand; Nest: eines, an einem festen Ort). Der Anker `nest` kommt mit MON-03 B und ruft diese Funktion mit seiner Kachel.
// Fehler als Text, dann entsteht nichts. Die Karte muss die aktive sein, wenn der Typ eine bindung trägt (die Quelle selbst hat keine; sie darf vor der Landung angelegt werden, ihr Nachwuchs erst im Spiel).
const NEST_SUCHE = 3;
function nestSetzen(game, o) {
  const fehl = (t) => ({ n: 0, ids: [], fehler: 'nest_setzen: ' + t });
  const p = o || {};
  let typ = null;
  try { typ = hat(daten().typen, p.typ) ? typVon(p.typ) : null; } catch (e) { return fehl(e.message.split('\n')[0]); }
  if (!typ) return fehl('unbekannter Typ "' + p.typ + '"');
  if (typeof p.gruppe !== 'string' || !GRUPPE_FORM.test(p.gruppe)) return fehl('gruppe muss ein Text der Form ' + GRUPPE_FORM + ' sein (' + p.gruppe + ')');
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return fehl('x und y (Kacheln, Zahlen) fehlen');
  const aw = karteRegistriert(game, p.map);
  if (!aw) return fehl('Karte ' + p.map + ' unbekannt');
  const k = game.karteOf ? game.karteOf(p.map) : null;
  if (!k) return fehl('Karte ' + p.map + ' hat keine Kartendaten');
  const alt = hat(aw.kreaturGruppen, p.gruppe) ? aw.kreaturGruppen[p.gruppe] : null;
  if (alt && alt.typ !== p.typ) return fehl('Gruppe "' + p.gruppe + '" besteht schon mit dem Typ ' + alt.typ);
  combat().ensureV2(game, aw, p.map);   // aw.rng
  const a = Mon.naechster(Monster.maskeVonGroesse(k, typ.groesse), Math.floor(p.x), Math.floor(p.y), NEST_SUCHE);
  if (!a) return fehl('kein freier Platz für Größe ' + typ.groesse + ' innerhalb von ' + NEST_SUCHE + ' Kacheln um (' + p.x + ',' + p.y + ') auf Karte ' + p.map);
  const pos = Mon.mitteVon(a, typ.groesse);
  let K;
  try { K = anlegen(game, aw, p.typ, pos.x, pos.y, p.gruppe); } catch (e) { return fehl(e.message); }
  const G = aw.kreaturGruppen || (aw.kreaturGruppen = {});
  G[p.gruppe] = { erschienen: (alt ? alt.erschienen : 0) + 1, typ: p.typ };
  return { n: 1, ids: [K.id], fehler: null };
}

// nestBesetzen(game, { map, typ, gruppe }) -> { n, ids, fehler }: setzt die Quelle (Königin) an den Anker der Rolle `nest` der Karte (verdeckt, steht nicht im Payload; die Position kennt nur der Server) und ruft nestSetzen.
// Hat die Karte keinen Anker der Rolle: Fehler als Text, es entsteht nichts. Mehrere Anker: der erste der Karte (Reihenfolge der Anker, deterministisch). Eigene Funktion statt Parameter an nestSetzen.
const NEST_ROLLE = 'nest';
function nestBesetzen(game, o) {
  const p = o || {};
  const k = game.karteOf && p.map ? game.karteOf(p.map) : null;
  if (!k) return { n: 0, ids: [], fehler: 'nest_setzen: Karte ' + p.map + ' hat keine Kartendaten' };
  const a = (k.anker || []).find((x) => x.rolle === NEST_ROLLE);
  if (!a) return { n: 0, ids: [], fehler: 'nest_setzen: Karte ' + p.map + ' hat keinen Anker der Rolle ' + NEST_ROLLE };
  return nestSetzen(game, { map: p.map, typ: p.typ, gruppe: p.gruppe, x: a.x, y: a.y });
}

// ---------- Tick ----------
function wahrnehmung(game, E, K, typ) { return Monster.ziel(game, E, K, { sicht: typ.sicht }); }

function tickEine(game, E, k, K, dt) {
  const typ = typVon(K.typ);
  const m0 = Monster.maskeVonGroesse(k, typ.groesse);
  const m = K.sperre ? sperrMaske(m0, K, game.time) : m0;
  K.zt += dt; if (K.t != null) K.t -= dt; K.replan -= dt;
  const ziel = wahrnehmung(game, E, K, typ);
  if (ziel) { K.verlust = 0; K.letzte = { x: ziel.x, y: ziel.y }; K.zielId = ziel.id; }
  else K.verlust += dt;
  const ctx = { game, E, m, typ, ziel, k };
  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiTick) def.beiTick(game, K, dt, typ.bausteine[b], ctx); }
  // Zustandswechsel: der erste zutreffende Übergang der Tabelle (einmal je Tick)
  const z0 = typ.zustaende[K.z];
  for (const u of z0.uebergang) {
    const a = ausloeserVon(typ, u.auf);
    if (a && a.fn(game, K, ctx, a.par, u)) { betreten(game, K, u.nach, ctx); break; }
  }
  const z = typ.zustaende[K.z];
  const modus = modusVon(typ, z.modus);
  if (modus) modus.tick(game, K, dt, ctx, parVon(typ, z.modus), z);
  // Anti-Hängen (Pfadmodi): bewegt sich die Kreatur 3 s nicht, obwohl sie einen Pfad hat, Pfad verwerfen
  if (K.pfad.length) {
    if (Math.hypot(K.x - K.ref.x, K.y - K.ref.y) > 6) { K.ref = { x: K.x, y: K.y }; K.stuckT = 0; }
    else if ((K.stuckT += dt) >= 3) { K.pfad = []; K.replan = 0; K.stuckT = 0; }
  } else { K.stuckT = 0; K.ref = { x: K.x, y: K.y }; }
}

function update(game, dt) {
  const aw = game.away; if (!aw || !aw.kreaturen || !aw.kreaturen.length) return;
  const team = game.players.some((p) => p.zone === 'away');   // ohne Außenteam steht alles still (wie die Station)
  const k = team && game.karteOf ? game.karteOf(aw.map) : null;
  const E = k ? combat().env(game) : null;
  const Wf = waffen();
  let entfernen = false;
  for (const K of aw.kreaturen) {
    const neu = laermLesen(aw, K);   // der Cursor läuft immer mit (auch bei Stillstand), damit nichts Altes nachgeholt wird
    if (nichtEndgueltigErledigt(K)) bausteinAbgleich(game, K, dt);   // P3: Bindungen auch bei Betäubung, Bewusstlosigkeit und Stillstand
    if (K.weg) { entfernen = true; continue; }
    if (!k || !K.alive) continue;    // gefallen/liegend: tot oder bewusstlos, keine Bewegung (Aufstehen zieht combat.folgenAbgleich nach)
    schildRegeneration(game, K, dt);
    if (Wf && !Wf.handlungsfaehig(game, K)) continue;   // betäubt/bewusstlos: steht still
    for (const ev of neu) bausteinLaerm(game, K, ev);
    tickEine(game, E, k, K, dt);
  }
  if (entfernen) { const L = aw.kreaturen; let w = 0; for (let i = 0; i < L.length; i++) if (!L[i].weg) L[w++] = L[i]; L.length = w; }   // aufgelöste Kreaturen erst nach der Schleife entfernen
}

// ---------- Lärm-Leser (P2b) ----------
// Zweiter Leser von aw.laerm (Puffer von waffen.laerm, höchstens 32 Ereignisse, nach Zeit geordnet) mit eigenem Cursor { t, n }: n = schon gelesene Ereignisse der Zeit t.
// So gehen Ereignisse gleicher Tickzeit nicht verloren (anders als `ev.t > cursor` in squad.js, das hier bewusst nicht angefasst ist). Schreibt nur K.laermCursor, nie aw.laerm.
const KEINE_EREIGNISSE = [];
function laermCursorAnlegen(aw) {
  const L = aw.laerm; if (!Array.isArray(L) || !L.length) return { t: -1e9, n: 0 };
  const t = L[L.length - 1].t; let n = 0;
  for (const ev of L) if (ev.t === t) n++;
  return { t, n };
}
function laermLesen(aw, K) {
  const L = aw.laerm; const c = K.laermCursor;
  if (!c || !Array.isArray(L) || !L.length) return KEINE_EREIGNISSE;
  let out = null, gleich = 0;
  for (const ev of L) {
    if (ev.t < c.t) continue;
    if (ev.t === c.t) { if (++gleich <= c.n) continue; c.n++; }
    else { c.t = ev.t; c.n = 1; gleich = 1; }
    (out || (out = [])).push(ev);
  }
  return out || KEINE_EREIGNISSE;
}

// ---------- Lärm als Push (MON-03 B) ----------
// laermHoeren(game, { x, y, radius, stufe? }) -> Zahl der erreichten Kreaturen: ein Lärm an (x, y) (px) mit radius (px) geht an die Kreaturen der aktiven Außenkarte (lebend, handlungsfähig),
// über dieselben Hooks (bausteinLaerm, Baustein koeder) wie der Leser in update. Eigene Quelle ohne Lärmpuffer: schreibt NICHT in aw.laerm (sonst weckte squad.js alle Drohnentrupps im Radius) und braucht
// keinen Cursor und kein Instanzfeld. Aufrufer: Abbau (anker.abbauLaerm, Reichweite aus rollen.abbau.laermStufe (content/buehnen/anker.json)). Wer das Ereignis hört, entscheidet der Typ über koeder { faktor } und die Zustandstabelle.
// MON-03 Nacharbeit B: Der Lärm kommt oft von einem festen Feld (die Ader ist bis zum Abbau fest): der Köder läge dann in einer Wand, die Kreaturen stünden an ihrem Rand. Er rückt auf die nächste Kachel,
// die die Physik betreten lässt (innerhalb KOEDER_SUCHE Kacheln, Kachelmitte; Gleichstand: die erste in Zeilenfolge, deterministisch); liegt keine in der Nähe, bleibt der Ort.
const KOEDER_SUCHE = 2;
function koederOrt(E, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (!E.solid(tx, ty)) return { x, y };
  let best = null, bd = Infinity;
  for (let dy = -KOEDER_SUCHE; dy <= KOEDER_SUCHE; dy++) for (let dx = -KOEDER_SUCHE; dx <= KOEDER_SUCHE; dx++) {
    if (E.solid(tx + dx, ty + dy)) continue;
    const c = { x: (tx + dx + 0.5) * TILE, y: (ty + dy + 0.5) * TILE }, d = Math.hypot(c.x - x, c.y - y);
    if (d < bd) { bd = d; best = c; }
  }
  return best || { x, y };
}
function laermHoeren(game, o) {
  const aw = game.away; if (!aw || !aw.kreaturen || !aw.kreaturen.length) return 0;
  if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.radius) || o.radius <= 0) return 0;
  const Wf = waffen();
  const E = game.karteOf && game.karteOf(aw.map) ? combat().env(game) : null;
  const ort = E ? koederOrt(E, o.x, o.y) : { x: o.x, y: o.y };
  const ev = { x: ort.x, y: ort.y, stufe: o.stufe || null, kacheln: o.radius / TILE, radius: o.radius, t: game.time };
  let n = 0;
  for (const K of aw.kreaturen) {
    if (K.weg || !K.alive || !nichtEndgueltigErledigt(K)) continue;
    if (Wf && !Wf.handlungsfaehig(game, K)) continue;
    bausteinLaerm(game, K, ev); n++;
  }
  return n;
}

// ---------- Kampf-Anbindung (P2a) ----------
// Treffer-Schleifen (Projektil, Orbitalschlag, Folgen, Waffen-Update): Drohnen und Kreaturen. Ohne Kreaturen dieselbe Referenz wie aw.drones (kein neues Array, gleiche Reihenfolge).
function ziele(aw) { return aw.kreaturen && aw.kreaturen.length ? aw.drones.concat(aw.kreaturen) : aw.drones; }
// Kämpfer-Vertrag für waffen.js: Felder kommen vom Typ der Kreatur selbst (nie aus den Rollen-Tabellen der Drohnen)
function ausruesten(game, K) {
  const typ = typVon(K.typ); if (!typ) return K;
  if (K.max == null) K.max = typ.schild.max;
  if (K.seg == null) K.seg = typ.schild.seg;
  if (K.hp == null) K.hp = K.seg;
  if (!K.wunden) K.wunden = { n: typ.wunden, max: typ.wunden };
  if (K.frontArc == null) K.frontArc = typ.frontArc;
  if (!Number.isFinite(K.facing)) K.facing = 0;
  if (K.hitRadius == null) K.hitRadius = typ.hitRadius;
  if (K.lastHitAt == null) K.lastHitAt = -99;
  if (K.regenT == null) K.regenT = 0;
  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiAusruesten) def.beiAusruesten(game, K, typ.bausteine[b]); }
  return K;
}
// Eigene Schildregeneration je Typ (Datenfeld schildRegen { verzoegerung, schritt }); ohne Feld keine Regeneration (nie die Plünderer-Werte von updateEnemyShields)
function schildRegeneration(game, K, dt) {
  const typ = typVon(K.typ); const r = typ && typ.schildRegen;
  if (!r || K.seg >= K.max) { K.regenT = 0; return; }
  if (game.time - K.lastHitAt < r.verzoegerung) { K.regenT = 0; return; }
  K.regenT += dt;
  if (K.regenT < r.schritt) return;
  K.regenT = 0; K.seg++; K.hp = K.seg;
}
// Alle Kreaturen einer Außenkarte entfernen (Szenario-Start räumt die Karte wie aw.drones)
function raeumen(aw) { if (aw && aw.kreaturGruppen) delete aw.kreaturGruppen; if (aw && aw.kreaturen && aw.kreaturen.length) aw.kreaturen = []; }

// Dispatcher für die Hooks der Bausteine (Aufrufer: Treffer-Auswertung P2, Lärm-Leser P2b)
function bausteinTreffer(game, K, treffer) { const typ = typVon(K.typ); for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiTreffer) def.beiTreffer(game, K, treffer, typ.bausteine[b]); } }
function bausteinWechsel(game, K, von, nach) { const typ = typVon(K.typ); for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiWechsel) def.beiWechsel(game, K, von, nach, typ.bausteine[b]); } }
function bausteinAbgleich(game, K, dt) { const typ = typVon(K.typ); for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiAbgleich) def.beiAbgleich(game, K, dt, typ.bausteine[b]); } }
function bausteinLaerm(game, K, laerm) { const typ = typVon(K.typ); for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiLaerm) def.beiLaerm(game, K, laerm, typ.bausteine[b]); } }

// ---------- Debug ----------
// `kreatur <typ>`: eine Kreatur in etwa 6 Kacheln Abstand vom Spieler (nächster freier Ankerpunkt ihrer Maske). Ohne Typ: Liste der Typen.
function debugKreatur(game, p, typId) {
  if (!game.debug) return 'kreatur: nur mit Server --debug.';
  if (p.zone !== 'away' || !game.away) return 'kreatur: nur am Boden.';
  let ids;
  try { ids = typIds(); } catch (e) { return 'kreatur: ' + e.message.split('\n')[0]; }
  if (!typId) return 'kreatur <typ>: ' + ids.join(', ');
  if (!ids.includes(typId)) return 'kreatur: unbekannter Typ "' + typId + '" (' + ids.join(', ') + ').';
  const k = game.karteOf ? game.karteOf(game.away.map) : null;
  if (!k) return 'kreatur: keine Karte.';
  combat().ensureV2(game, game.away);   // aw.rng u. a. vorhanden
  const typ = typVon(typId);
  const m = Monster.maskeVonGroesse(k, typ.groesse);
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  let a = null;
  for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, 4], [4, -4], [-4, -4], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
    a = Mon.naechster(m, tx + dx, ty + dy, 2); if (a) break;
  }
  if (!a) return 'kreatur: kein freier Platz in der Nähe.';
  const pos = Mon.mitteVon(a, typ.groesse);
  const K = erzeugen(game, typId, pos.x, pos.y);
  if (game.notice) game.notice(p, 'kreatur: ' + typId + ' ' + K.id + ' bei (' + a.cx + ',' + a.cy + ').');
  return null;
}

// GEL-03 Nacharbeit W1: Kantenlänge der Kollisionsbox einer Kreatur in px (für die Überlappungsprüfung des Ader-Wechsels, anker.js)
const koerperBox = (K) => { const t = typVon(K.typ); return t ? hbVon(t).w : 14; };
module.exports = { koerperBox, gefolgeSuchradius, update, kreaturBausteinAnmelden, bausteinTreffer, bausteinLaerm, daten, pruefen, typVon, erzeugen, erzeugenAuf, rudelSetzen, nestSetzen, nestBesetzen, laermHoeren, zustandSetzen, debugKreatur, kreaturen, ziele, ausruesten, raeumen, nichtEndgueltigErledigt, ausgefallenMelden, rudelErledigt, erledigtOptionenFehler };

// ---------- Anzeige und Scanner (MON-01 P4) ----------
// Scanner: Art `monster`, billig (nur die lebenden Kreaturen mit aktueller Position, keine Karte). Typ-ID aus kreaturen.json; der Name steht im Client-Content (datenblaetter.json).
require('./scanbar.js').scanbarAnmelden('monster', {
  ziele(game, aw) {
    const out = [];
    for (const K of (aw && aw.kreaturen) || []) if (K.alive) out.push({ id: K.id, x: K.x, y: K.y, typ: K.typ, nachrang: !!(K.bindung && K.bindung.art === 'kreatur') });   // Gefolge (an eine Kreatur gebunden) rückt nach: der Schwarm verdrängt die Königin nicht aus den Scan-Plätzen (MON-03 C)
    return out;
  },
  tiefen: { position: 3 },
});

// Snapshot-Feld away.kr: [[nr, typCode, x, y, f, bits], …] oder null (ohne lebende, sichtbare Kreatur gibt es kein Feld).
//   nr       Zahl hinter dem K der Instanz-ID (K7 -> 7); der Client bildet 'K' + nr und findet so den Scan-Eintrag `monster:K7` in away.sc
//   typCode  Index des Typs in der Reihenfolge von kreaturen.json (deterministisch, nur für den Client-Wiedererkennen; Namen kommen aus dem Scan)
//   x, y     px, 1 Nachkommastelle (wie mo);  f  Blickrichtung rad, 2 Nachkommastellen
//   bits     0-1 Ladung 0..3 (Baustein aufladung), 2 Pause/steht (Modus `steht`), 3 rammt (Modus `ramme`), 4-5 Größe-1 (Kacheln, 0..3), 6 zielt (Modus `zielen`, Aufladen; MON-02 O3a)
// Nur lebende Kreaturen, die jemand im Team sieht (gemeinsame Regel combat.sichtbarFuerTeam wie updateVisibility: Sichtradius, Lanzenkegel, Sensor, Captain-Fokus; Kreaturen sind kein Fokusziel, focusUntil bleibt 0). Tote werden nicht gesendet.
const BIT_PAUSE = 4, BIT_RAMMT = 8, BIT_ZIELT = 64;
// MON-03 C: Eine Kreatur der Größe >= 2 hat ihre Mitte auf einer Kachelecke; die Sichtlinie zu genau diesem Punkt streift an Wandecken (die Zielkachel ist nur eine der vier Körperkacheln) und wurde in engen Höhlen oft
// grundlos blockiert, obwohl ein Teil des Körpers frei zu sehen war. Sicht ist Sicht: gesehen, sobald die Mitte oder eine Körperkachel (Kachelmitte der g x g Kacheln) im Team gesehen wird. Größe 1: unverändert nur die Mitte.
function koerperSichtbar(game, C, E, team, R, K, sensor) {
  if (C.sichtbarFuerTeam(game, E, team, R, K, sensor)) return true;
  const g = typVon(K.typ).groesse;
  if (!(g >= 2)) return false;
  for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) {
    const p = { x: K.x + (i - (g - 1) / 2) * TILE, y: K.y + (j - (g - 1) / 2) * TILE, focusUntil: K.focusUntil };
    if (C.sichtbarFuerTeam(game, E, team, R, p, false)) return true;
  }
  return false;
}
function snap(game) {
  const aw = game.away; const L = aw && aw.kreaturen;
  if (!L || !L.length || !L.some((K) => K.alive)) return null;
  const C = combat();
  const team = C.teamOf(game);
  if (!team.length) return null;
  const E = C.env(game);
  const R = game.C.awayCombat.sightTiles * TILE;
  const sensor = game.time < aw.sensorUntil;
  const ids = Object.keys(daten().typen);
  const out = [];
  for (const K of L) {
    if (!K.alive) continue;
    if (!koerperSichtbar(game, C, E, team, R, K, sensor)) continue;   // dieselbe Regel wie combat.updateVisibility (Radius, Lanzenkegel, Sensor, Fokus), bei Größe >= 2 für jede Körperkachel
    const typ = typVon(K.typ); const modus = typ.zustaende[K.z].modus;
    const ladung = K.aufladung ? Math.min(3, K.aufladung.stufe) : 0;
    const bits = ladung | (modus === 'steht' ? BIT_PAUSE : 0) | (modus === 'ramme' ? BIT_RAMMT : 0) | (modus === 'zielen' ? BIT_ZIELT : 0) | ((typ.groesse - 1) << 4);
    out.push([Number(K.id.slice(1)), ids.indexOf(K.typ), Math.round(K.x * 10) / 10, Math.round(K.y * 10) / 10, Math.round(K.facing * 100) / 100, bits]);
  }
  return out.length ? out : null;
}
Object.assign(module.exports, { snap });
// Fürs Snapshot-Spread in game.js: { kr } oder {} (ohne Kreaturen kein Feld, nie ein leeres Array)
function snapFeld(game) { const kr = snap(game); return kr ? { kr } : {}; }
Object.assign(module.exports, { snapFeld });
