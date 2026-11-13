'use strict';
// SON-01 B: der Baustein sondersektor der Geschichtsfaeden (Freie Fahrt Sund, Schalter FAEDEN=1). Der Beat schickt die Crew in einen Sondersektor (Daten content/welt/sondersektoren.json, heute die Forschungsstation Helix)
// und startet dessen UNVERAENDERTES Regiebuch (Mission-Engine, g.mission.startMission). Er ist speicherbar (der Faden SELBST ist der Zustand, dazu der Missionsstand des Buchs), hat keine eigene Szene und ist nur ueber den
// Inszenierer planbar (beats.json nur_inszenierer). Action-Layer wie faden-b1.js; Zahlen und Texte stehen in den Sondersektor-Daten und in beats.json (frist), kein Satz im Code.
//
//   starten  Voraussetzungen (jede scheitert mit Beat gescheitert und Eintrag im Regie-Logbuch, das Buch wird nie gestartet): der Sektor steht in den Daten; Einmaligkeit (einmal bei_erfolg: das Buch ist in dieser Partie schon mit
//            Ausgang erfolg beendet); keine Szene und keine andere Mission laeuft; der Hex `von` (Pulverhorn) ist in hoechstens ziel.erreichbar_max Spruengen ueber offene Kanten erreichbar (faden-b1.js erreichbar, unveraendert:
//            es zaehlt temporaere Kanten nie, und der Sprungpunkt nach Helix ist eine). Dann spricht die Station (funk.start) und das Buch beginnt. Den Sprungpunkt oeffnet das Buch selbst (Schritt auftrag), nie dieser Baustein.
//            Ein frueherer Verlust steht dem nicht im Weg: startMission legt den Missionsstand neu an, der Schritt station setzt Monster und Pulte zurueck.
//   update   Takt (Aufrufer: reise-ereignis.update). Das Buch meldet kein Faden-Ereignis, der Takt liest den Missionsstand: state done mit Ausgang erfolg -> Beat gelungen, jeder andere Ausgang (verloren) -> Beat gescheitert,
//            ohne Neustart des Buchs. Fehlt der Missionsstand des laufenden Beats, gilt er als gescheitert.
//   Frist    Laeuft die Frist des Beats (beats.json frist, Taetigkeiten, Faden-Takt) ab, endet der Beat gescheitert; der Takt erkennt das und verwirft das dann verwaiste Buch (mission.abbrechen: kein Ausgang, keine Folgen,
//            der Missionsstand faellt weg, ein neuer Start bleibt moeglich) und die Station meldet sich (funk.verlust). Es bleibt kein Zombie-Buch ohne Beat. Der Sprungpunkt bleibt offen (das Buch laesst ihn immer offen).
//   Ausgang gelungen: Ortsparameter und Funk zur Folge schreibt Paket C, hier wird nur der Ausgang gemeldet.
//
//   starten(game, faden, ctx)   Schnittstelle der Bausteine (faden-bausteine.js)     update(game)   Takt
//   voraussetzungen(game, sektor) -> null | Grund   alle Voraussetzungen, ohne etwas zu tun (Tests, spaeter das Brett)
const Sektoren = require('../../shared/sektoren.js');
const D = require('./faden-daten.js');
const S = require('./sondersektoren.js');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const Regie = () => require('./regie-befehle.js');
const Bausteine = () => require('./faden-bausteine.js');
const B1 = () => require('./faden-b1.js');
const Szene = () => require('./faden-szene.js');
const Reise = () => require('./reise-ereignis.js');
const BAUSTEIN = 'sondersektor';
const fmt = (t, v) => String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const hierHex = (game) => (game && game.ship ? Sektoren.hexVonOrt(game.ship.scene) : null);
const logbuch = (game, e) => { try { Regie().schreibe(game, Object.assign({ art: 'faden_baustein', quelle: 'regie', key: BAUSTEIN }, e)); } catch (err) { if (game && game.countError) game.countError('faden-sondersektor-logbuch', err); } };
const baustLog = (game, faden, beat, ausgang, begruendung, plan) => logbuch(game, { ausgang, begruendung, plan: Object.assign({ faden: faden.id, beat: beat.id }, plan || {}) });
// Die Station spricht (Sprecher = Name des Sektors); {hex} die Koordinate, {ort} der Name des Sondersektors
const sagen = (game, s, zeile) => Bitte().funkSprecher(game, hexName(s.hex), fmt(zeile, { hex: s.hex, ort: hexName(s.hex) }));

// ---------- Voraussetzungen
const mission = (game) => (game && game.mission) || null;
const buchStand = (game, s) => { const m = mission(game); return m && m.missions && has(m.missions, s.buch) ? m.missions[s.buch] : null; };
const szeneLaeuft = (game) => !!(game.simSzene || game.fadenSzene || Szene().verfolgungLaeuft(game) || Reise().gefahrLaeuft(game));
function voraussetzungen(game, s) {
  const m = mission(game);
  if (!m || !game.ship || !game.explore) return 'kein Missionsstand oder keine Karte in diesem Modus';
  if (s.einmal === 'bei_erfolg') { const st = buchStand(game, s); if (st && st.state === 'done' && st.ausgang === 'erfolg') return `das Buch ${s.buch} ist in dieser Partie schon gelungen (einmal ${s.einmal})`; }
  if (szeneLaeuft(game)) return 'eine Szene oder Gefahr laeuft';
  if (m.activeId) return `eine andere Mission laeuft (${m.activeId})`;
  if (!B1().erreichbar(game, hierHex(game), s.ziel.erreichbar_max).has(s.von)) return `${hexName(s.von)} (${s.von}) ist nicht in hoechstens ${s.ziel.erreichbar_max} Spruengen erreichbar`;
  return null;
}

// ---------- Baustein
const sondersektor = {
  id: BAUSTEIN,
  starten(game, faden, ctx) {
    const id = ctx.beat.parameter && ctx.beat.parameter.sektor;
    const s = typeof id === 'string' ? S.sektor(id) : null;
    const ab = (grund, hex) => { baustLog(game, faden, ctx.beat, 'abgelehnt', 'Sondersektor: ' + grund + ': der Beat gilt als gescheitert', { sektor: s ? s.id : null, hex: hex || null }); return { ausgang: 'gescheitert' }; };
    if (!s) return ab('unbekannter Sektor');
    const g = voraussetzungen(game, s);
    if (g) return ab(g, s.hex);
    if (!sagen(game, s, s.funk.start)) return ab('kein Funk', s.hex);   // ohne Funk kein Beat (wie spur): das Buch beginnt nicht ohne Ansage
    mission(game).startMission(s.buch);
    if (mission(game).activeId !== s.buch) return ab(`das Buch ${s.buch} liess sich nicht starten`, s.hex);
    baustLog(game, faden, ctx.beat, 'sondersektor', `Buch ${s.buch} fuer ${hexName(s.hex)} gestartet`, { sektor: s.id, buch: s.buch, hex: s.hex });
    return { laeuft: true };
  },
};

// ---------- Takt
const LAUFEND = new WeakMap();   // Laufzeit je Spiel: Faden -> { buch, sektor }, damit ein nach Fristablauf verwaistes Buch abgeraeumt wird (nach dem Laden entsteht der Eintrag aus dem Faden neu)
function laufender(f) {   // Sektor des laufenden sondersektor-Beats eines Fadens (nur der echte Baustein, kein Platzhalter), sonst null
  if (!f || f.phase !== 'laeuft' || !f.laufend) return null;
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat || beat.id !== f.laufend.beat || !has(D.BEATS, beat.typ) || D.BEATS[beat.typ].baustein !== BAUSTEIN) return null;
  if (Bausteine().vonId(BAUSTEIN) !== sondersektor) return null;
  return S.sektor(beat.parameter && beat.parameter.sektor);
}
function update(game) {
  if (!game || !game.ship || !Faden().aktiv(game)) return;
  const F = Faden().zustandVon(game);
  let reg = LAUFEND.get(game);
  if (!reg) LAUFEND.set(game, reg = new Map());
  for (const f of F.liste.slice()) {
    const s = laufender(f);
    if (!s) continue;
    reg.set(f.id, s);
    const st = buchStand(game, s);
    if (st && st.state === 'done') {
      const gelungen = st.ausgang === 'erfolg';
      sagen(game, s, gelungen ? s.funk.erfolg : s.funk.verlust);
      Faden().beatAusgang(game, f.id, gelungen ? 'gelungen' : 'gescheitert');
    } else if (!st) {
      sagen(game, s, s.funk.verlust);   // der Missionsstand ist weg (nie ohne Eingriff von aussen): der Beat gilt als gescheitert
      Faden().beatAusgang(game, f.id, 'gescheitert');
    }
  }
  for (const [fid, s] of Array.from(reg)) {
    const f = F.liste.find((x) => x.id === fid);
    if (f && laufender(f) === s) continue;
    reg.delete(fid);   // der Beat ist zu Ende (Ausgang oder Frist) oder der Faden ist weg: ein noch aktives Buch dieses Sektors wird verworfen
    const m = mission(game);
    if (m && m.activeId === s.buch) {
      m.abbrechen();
      sagen(game, s, s.funk.verlust);
      logbuch(game, { ausgang: 'abgeraeumt', begruendung: `Beat sondersektor ohne Ausgang beendet (Frist): das Buch ${s.buch} wird verworfen`, plan: { faden: fid, sektor: s.id, buch: s.buch } });
    }
  }
}

module.exports = { sondersektor, starten: sondersektor.starten, update, voraussetzungen };
