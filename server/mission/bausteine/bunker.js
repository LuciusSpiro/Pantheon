'use strict';
// EIS-01 P2: Regiebuch-Bausteine für den Bunker der festen Karte grabenangriff (Registry-Plugin; die Mechanik liegt in server/sim/graben.js, Kampagnen-Einstieg aufbauen/mechanikTick/siegBereit).
// Der Bunker ist hier ein Teil einer Kampagnenszene: KEIN game.arena (Testumgebung, Wellen-Panel, Telemetrie hängen daran). Der Zustand S liegt wie bei endkampf.js in der Außenkarte: aw.graben
// (aw = game.aways[map]). Er gelangt weder in den Snapshot noch in den Weltstand (beide lesen aw nur feldweise), und map_reset verwirft aw samt aw.graben von selbst (landepunkte: delete game.aways[lp]).
//   bunker_aufbauen    { map*, fraktion*, sperre*, ziel_still?, sperre_text?, ziel_offen?, ziel_erreicht?, nachschub? }
//                      Aktion: Wellen aufstellen (Gegner der Fraktion, ruhig, Welle 1 und 2 oben, Welle 3 im Bunker), Sprengpunkt gesperrt bzw. offen. Karte und Seed stammen aus dem Landepunkt (gen.fest, seed).
//                      Keine Beamung (die Crew beamt selbst über die Transfer-Konsole), keine Rüstphase, kein ODA, die Sprengladung im Teaminventar bleibt unberührt (das Regiebuch besitzt sie).
//                      Nur einmal je Karte: ist aw.graben schon da, tut der Aufruf nichts. Nach map_reset baut ein erneuter Aufruf frisch auf.
//                      sperre 'an': der Sprengpunkt bleibt gesperrt, bis die Gegner der Oberfläche (Welle 1 und 2) tot sind; 'aus': nie gesperrt (das Rohr/die Kampfumgehung ist erlaubt).
//                      Texte (alle optional, '@kennung' im Regiebuch, Konvention Präfix bunker.): fehlt einer, gilt der Text aus CONFIG.graben.texte (Rom-Fassung).
//   bunker_welle_tot   { map*, welle* }   Prüfung: alle Gegner der Welle (1 und 2 Oberfläche, 3 Bunker) sind tot. Ohne Bunker false.
//   bunker_offen       { map* }           Prüfung: der Sprengpunkt ist freigegeben (sperre 'aus' von Anfang an, 'an' nach dem Tod der Oberflächenwellen)
//   bunker_gesprengt   { map* }           Prüfung: die Sprengung ist erfolgt (der Knall, nicht das Zünden); der Nachschub (vier Mann oben) ist dann schon gesendet
//   bunker_sieg_bereit { map* }           Prüfung: gesprengt UND alle verbundenen Spieler wieder an Bord (Hochbeamen am Pad des Bunkereingangs oder am Abholpunkt)
//
// TAKT. Die Mechanik (Abschüsse zählen, Sperre öffnen, Knall erkennen, Nachschub senden = graben.mechanikTick) braucht genau einen Aufruf je Spieltick. Ein Tick-Aufruf in game.js ist
// vermieden (wie endkampf.js): JEDE der vier Prüfungen oben führt zuerst den Takt aus, idempotent je Spieltick (S.taktTick === game.tick). Zweimal im selben Tick ausgewertet ändert nichts.
// Folge für das Regiebuch: der Takt läuft nur, solange irgendeine Bunker-Prüfung in jedem Tick ausgewertet wird. Das leisten die Ziele des aktiven Schritts (objectives[].done wird jeden Tick
// ausgewertet) und die ERSTE Bedingung der ersten `next`-Zeile; eine Prüfung hinter einer kurzschließenden Bedingung (all, deren frühere Glieder falsch sind) läuft nicht. Regeln (rules) sind
// einmalig und taugen nicht als Taktgeber. Sicherste Form: die Prüfung bunker_sieg_bereit steht allein oder zuerst im `if` der ersten `next`-Zeile des Bunker-Schritts.
const graben = () => require('../../sim/graben.js');
const landepunkte = () => require('../../sim/landepunkte.js');
const combat = () => require('../../sim/combat.js');
const FEHLER = 'mission-bunker';

// Texte des Szenarios, die in der Kampagne wirken (ODA und Sperrhinweise). Parametername -> Schlüssel in CONFIG.graben.texte (graben.js text()).
const TEXTE = { ziel_still: 'ziel_still', sperre_text: 'sperre', ziel_offen: 'ziel_offen', ziel_erreicht: 'ziel_erreicht', nachschub: 'nachschub' };

const gemeldet = new WeakMap();   // game -> Set(Schlüssel): jede Meldung einmal je Spiel und Fall (nicht je Tick)
function einmal(g, schluessel, text) {
  let s = gemeldet.get(g); if (!s) { s = new Set(); gemeldet.set(g, s); }
  if (s.has(schluessel)) return;
  s.add(schluessel);
  g.countError(FEHLER, new Error(text));
}

// Zustand des Bunkers dieser Karte (null: nicht aufgebaut, z. B. vor bunker_aufbauen oder nach map_reset)
const zustand = (g, map) => { const aw = g.aways && g.aways[map]; return (aw && aw.graben) || null; };
// Takt: genau einmal je Spieltick, solange der Bunker aufgebaut ist -> S | null
function takt(m, map) {
  const g = m.game; const S = zustand(g, map);
  if (!S) return null;
  if (S.taktTick === g.tick) return S;
  S.taktTick = g.tick;
  try { graben().mechanikTick(g, S); } catch (e) { g.countError(FEHLER, e); }
  return S;
}

module.exports = (Registry) => {
  const mapParam = { map: { typ: 'map', pflicht: true } };

  Registry.define({ id: 'bunker_aufbauen', art: 'aktion', effekt: 'gegner', ereignisse: ['squadSpawn'],
    beschreibung: 'Bunker der festen Karte (Landepunkt mit gen.fest) aufbauen: Verteidiger der Fraktion stehen postiert (Welle 1 und 2 oben, Welle 3 im Bunker), der Sprengpunkt im Reaktorraum ist das Ziel. sperre an = '
      + 'gesperrt, bis die Gegner der Oberfläche tot sind, aus = sofort zündbar. Keine Beamung, keine Rüstphase, die Sprengladung im Inventar bleibt unberührt. Nur einmal je Karte (nach map_reset baut ein neuer Aufruf frisch). '
      + 'Nach der Sprengung kommt einmal Nachschub (vier Mann oben am Bunkereingang). Takt und Prüfungen: bunker_sieg_bereit, bunker_gesprengt, bunker_offen, bunker_welle_tot',
    params: Object.assign({}, mapParam, {
      fraktion: { typ: 'string', pflicht: true }, sperre: { typ: 'string', pflicht: true, werte: ['an', 'aus'] },
      ziel_still: { typ: 'text' }, sperre_text: { typ: 'text' }, ziel_offen: { typ: 'text', oda: true }, ziel_erreicht: { typ: 'text', oda: true }, nachschub: { typ: 'text', oda: true } }),
    run(m, a) {
      const g = m.game; const aw = g.aways && g.aways[a.map];
      if (!aw) { g.countError(FEHLER, new Error('bunker_aufbauen: Karte ' + a.map + ' nicht geladen')); return; }
      if (aw.graben) return;   // einmal je Karte
      const e = landepunkte().eintrag(g, a.map); const gen = (e && e.gen) || null;
      if (!gen || !gen.fest) { g.countError(FEHLER, new Error('bunker_aufbauen: Landepunkt ' + a.map + ' hat keine feste Karte (gen.fest)')); return; }
      let F = null; try { F = (combat().katalogDaten(g).fraktionen || {})[a.fraktion]; } catch (x) { F = null; }
      if (!F) { g.countError(FEHLER, new Error("bunker_aufbauen: Fraktion '" + a.fraktion + "' unbekannt")); return; }
      const texte = {};
      for (const [param, key] of Object.entries(TEXTE)) if (typeof a[param] === 'string' && a[param]) texte[key] = String(m.tpl(a[param]));
      try {
        aw.graben = graben().aufbauen(g, { karte: gen.fest, seed: e.seed, lp: a.map, auswahl: gen.abschnitte || null },
          { fraktion: a.fraktion, sperreAktiv: a.sperre === 'an', ladung: 'unberuehrt', texte: Object.keys(texte).length ? texte : null });
      } catch (x) { delete aw.graben; g.countError(FEHLER, x); }
    } });

  Registry.define({ id: 'bunker_welle_tot', art: 'pruefung',
    beschreibung: 'Alle Gegner der Welle des Bunkers sind tot (Welle 1 und 2 stehen oben, Welle 3 im Bunker). Ohne aufgebauten Bunker false. Führt den Takt des Bunkers aus',
    params: Object.assign({}, mapParam, { welle: { typ: 'number', pflicht: true, min: 1, max: 9 } }),
    test(m, a) {
      const S = takt(m, a.map); if (!S) return false;
      const ids = S.ids && S.ids[a.welle];
      if (!ids) { einmal(m.game, 'welle:' + a.map + ':' + a.welle, 'bunker_welle_tot: die Karte ' + a.map + ' hat keine Welle ' + a.welle); return false; }
      const lebt = new Set(ids);
      return !m.game.aways[a.map].drones.some((e) => e.alive && lebt.has(e.id));
    } });

  Registry.define({ id: 'bunker_offen', art: 'pruefung',
    beschreibung: 'Der Sprengpunkt des Bunkers ist freigegeben (sperre aus: von Anfang an; sperre an: nachdem die Gegner der Oberfläche tot sind). Führt den Takt des Bunkers aus',
    params: mapParam,
    test(m, a) { const S = takt(m, a.map); return !!S && S.ziel !== 'gesperrt'; } });

  Registry.define({ id: 'bunker_gesprengt', art: 'pruefung',
    beschreibung: 'Der Bunker ist gesprengt (der Knall der Ladung am Sprengpunkt, nicht erst das Zünden); der einmalige Nachschub oben am Bunkereingang ist dann gesendet. Führt den Takt des Bunkers aus',
    params: mapParam,
    test(m, a) { const S = takt(m, a.map); return !!S && S.ziel === 'erreicht'; } });

  Registry.define({ id: 'bunker_sieg_bereit', art: 'pruefung',
    beschreibung: 'Bunker gesprengt und alle verbundenen Spieler wieder an Bord (nicht verbundene zählen nicht). Führt den Takt des Bunkers aus: als erste Bedingung des next des Bunker-Schritts nutzen, damit er in jedem Tick läuft',
    params: mapParam,
    test(m, a) { const S = takt(m, a.map); return !!S && graben().siegBereit(m.game, S); } });
};
