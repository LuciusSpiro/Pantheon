'use strict';
// EK2 (Raum-Alarm): Bausteine für Alarmstufe, Patrouillen, Minen und Schleichfahrt. Laufzeit: server/sim/alarm.js.
//   raum_alarm_an     { wissen?, einsprung?, jaeger? }    Alarmstufen in dieser Szene einschalten (Gegner wissen von der Lerche: ja/nein)
//   spawn_patrouille  { kind?, n?, tag?, x, y, x2?, y2?, sensor?, tempo? }   Patrouille auf einer Strecke (ohne x2/y2: Wache); greift erst bei Alarm an
//   minenfeld         { n, x?, y?, radius?, besitzer?, ohne_strom?, tag? }   Minen (Weitscan zeigt sie, Annäherung zündet, abschießbar)
//   schleichfahrt_an  { ziel_x, ziel_y, ziel_r?, patrouillen?, minen?, ohne_strom?, wissen?, einsprung?, jaeger?, kind? }   Schleichfahrt A13 in einem Zug
//   alarm_stufe       { min }                             Prüfung: Stufe der Szene mindestens misstrauisch|alarmiert
//   schiff_bei        { x, y, r? }                        Prüfung: Lerche im Kreis (Ziel einer Schleichfahrt)
//   rueckzug          { loc }                             Prüfung: seit Beginn dieses Schritts gab es einen Notfallsprung aus dem Ort (Ausgang „Rückzug“)
//   minen_uebrig      { max? }                            Prüfung: höchstens max Minen in der Szene (Standard 0)
// Nur am Ort des Schritts wirksam (wie spawn); schwere Module werden erst beim Aufruf geladen.
function alarm() { return require('../../sim/alarm.js'); }
const atLoc = (m) => !(m.step && m.step.loc && m.game.ship.scene !== m.step.loc);

module.exports = (Registry) => {
  Registry.define({ id: 'raum_alarm_an', art: 'aktion', effekt: 'gegner', ereignisse: ['raumAlarm', 'einsprung', 'einsprungAnsage'],
    beschreibung: 'Raum-Alarm für diese Szene einschalten: Stufen ruhig, misstrauisch, alarmiert (Lärm, Entdeckung, Minen). wissen: Gegner wissen von der Lerche (Start misstrauisch, größere Sensorkreise, Lärm alarmiert sofort). einsprung: ohne Patrouille springen nach 5 s jaeger (Standard 2) Jäger am nächsten Sprungpunkt ein',
    params: { wissen: { typ: 'bool' }, einsprung: { typ: 'bool' }, jaeger: { typ: 'number', min: 1, max: 4 } },
    run(m, a) { if (atLoc(m)) alarm().an(m.game, { wissen: a.wissen, einsprung: a.einsprung, jaeger: a.jaeger }); } });
  Registry.define({ id: 'spawn_patrouille', art: 'aktion', effekt: 'gegner', ereignisse: ['enemySpawn', 'entdeckt', 'raumAlarm'],
    beschreibung: 'Patrouille im Raum: n Schiffe laufen die Strecke (x,y)–(x2,y2) ab (ohne x2,y2 stehen sie Wache). Ein Sensorkreis wächst mit der Signatur der Lerche; wer ihn betritt, löst Alarm aus, dann greifen alle Patrouillen an. Im Snapshot erst nah oder nach dem Weitscan sichtbar',
    params: { kind: { typ: 'string', werte: ['raider', 'korvette'] }, n: { typ: 'number', min: 1, max: 4 }, tag: { typ: 'string' },
      x: { typ: 'number', pflicht: true, min: 0 }, y: { typ: 'number', pflicht: true, min: 0 }, x2: { typ: 'number', min: 0 }, y2: { typ: 'number', min: 0 },
      sensor: { typ: 'number', min: 100, max: 900 }, tempo: { typ: 'number', min: 0, max: 120 } },
    run(m, a) { if (atLoc(m)) alarm().patrouilleSetzen(m.game, a); } });
  Registry.define({ id: 'minenfeld', art: 'aktion', effekt: 'gegner', ereignisse: ['mineGezuendet', 'mineAbgeschossen', 'mineExploded', 'raumAlarm'],
    beschreibung: 'Minenfeld: n Minen (zufällig in einem Kreis um x,y mit radius, sonst in der Szenenmitte). Der Weitscan zeigt ihre Position; Annäherung zündet (nicht bei ihrem Besitzer): ignoriert Schilde, 6 Punkte Systemschaden, löst Alarm aus. Abschießbar (Explosion auf Distanz, macht trotzdem Alarm). ohne_strom: Blindgänger (zünden nicht, kein Alarm)',
    params: { n: { typ: 'number', pflicht: true, min: 1, max: 24 }, x: { typ: 'number', min: 0 }, y: { typ: 'number', min: 0 }, radius: { typ: 'number', min: 50, max: 3000 },
      besitzer: { typ: 'string', werte: ['gegner', 'lerche'] }, ohne_strom: { typ: 'bool' }, tag: { typ: 'string' } },
    run(m, a) { if (atLoc(m)) alarm().minenSetzen(m.game, { n: a.n, x: a.x, y: a.y, radius: a.radius, besitzer: a.besitzer, ohneStrom: a.ohne_strom, tag: a.tag }); } });
  Registry.define({ id: 'schleichfahrt_an', art: 'aktion', effekt: 'gegner', ereignisse: ['entdeckt', 'raumAlarm', 'mineExploded', 'einsprung'],
    beschreibung: 'Schleichfahrt (A13) einrichten: Raum-Alarm mit Signatur (Tempo, Schilde unten, Asteroiden dämpfen; Weitscan verrät die Lerche 4 s), Zielkreis (Captain-Marker), patrouillen Patrouillen quer zur Strecke, minen Minen im Korridor. Schilde hoch/runter an der Taktik. Kein Zeitlimit',
    params: { ziel_x: { typ: 'number', pflicht: true, min: 0 }, ziel_y: { typ: 'number', pflicht: true, min: 0 }, ziel_r: { typ: 'number', min: 40, max: 600 },
      patrouillen: { typ: 'number', min: 0, max: 6 }, minen: { typ: 'number', min: 0, max: 24 }, ohne_strom: { typ: 'bool' },
      wissen: { typ: 'bool' }, einsprung: { typ: 'bool' }, jaeger: { typ: 'number', min: 1, max: 4 }, kind: { typ: 'string', werte: ['raider', 'korvette'] } },
    run(m, a) { if (atLoc(m)) alarm().schleichfahrtEinrichten(m.game, a); } });
  Registry.define({ id: 'alarm_stufe', art: 'pruefung', beschreibung: 'Der Raum-Alarm der Szene steht mindestens auf misstrauisch bzw. alarmiert',
    params: { min: { typ: 'string', pflicht: true, werte: ['misstrauisch', 'alarmiert'] } },
    test: (m, a) => alarm().stufe(m.game) >= (a.min === 'alarmiert' ? 2 : 1) });
  Registry.define({ id: 'schiff_bei', art: 'pruefung', beschreibung: 'Die Lerche ist höchstens r Pixel (Standard 150) vom Punkt x,y entfernt (Ziel einer Schleichfahrt)',
    params: { x: { typ: 'number', pflicht: true, min: 0 }, y: { typ: 'number', pflicht: true, min: 0 }, r: { typ: 'number', min: 10, max: 1000 } },
    test: (m, a) => alarm().amZiel(m.game, a.x, a.y, a.r != null ? a.r : 150) });
  Registry.define({ id: 'rueckzug', art: 'pruefung', beschreibung: 'Seit Beginn dieses Schritts gab es einen Notfallsprung aus dem Ort loc (Rückzug, ohne das Ziel zu werten)',
    params: { loc: { typ: 'loc', pflicht: true } },
    test: (m, a) => { const g = m.game; return g.notsprungVon === a.loc && g.ship.scene !== a.loc && g.notsprungT >= g.time - (m.stepTime || 0) - 1e-6; } });
  Registry.define({ id: 'minen_uebrig', art: 'pruefung', beschreibung: 'In der Szene liegen höchstens max Minen (Standard 0)',
    params: { max: { typ: 'number', min: 0 } },
    test: (m, a) => (m.game.space.minen || []).length <= (a.max || 0) });
};
