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
//   Ausgang gelungen (SON-01 C): faden.parameter.ort wird der Ausgangs-Hex der Daten (ausgang.hex), die Station spricht ausgang.funk, dann meldet der Takt gelungen (ausgangBuchen). Bei Fristablauf schaltet szeneFreigeben das
//            Haltefeld (Gruppen aus scene.zonenAus) wieder aus, wenn die Crew im Sondersektor ist.
//   Angebot (SON-01 C): angebotFehler(game, beat) ist die Lagen-Pruefung des Angebots (faden-pruefer.js pruefeLage fragt jeden Baustein, der sie hat): nicht schon gelungen, Pulverhorn in Reichweite des Hafens.
//
//   starten(game, faden, ctx)   Schnittstelle der Bausteine (faden-bausteine.js)     update(game)   Takt
//   voraussetzungen(game, sektor) -> null | Grund   alle Voraussetzungen des Starts, ohne etwas zu tun     angebotFehler(game, beat) -> null | 'LAGE_SONDERSEKTOR: Grund'   nur die dauerhaften (Einmaligkeit, Reichweite)
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');
const D =require('./faden-daten.js');
const S = require('./sondersektoren.js');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const Regie = () => require('./regie-befehle.js');
const Bausteine = () => require('./faden-bausteine.js');
const B1 = () => require('./faden-b1.js');
const Szene = () => require('./faden-szene.js');
const Reise = () => require('./reise-ereignis.js');
const ZonenSim = () => require('./zonen.js');
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
const keinKartenModus = (game) => !mission(game) || !game.ship || !game.explore;
function einmalFehler(game, s) {   // Einmaligkeit je Partie: nach einem Erfolg nie wieder, nach einem Verlust ist ein neuer Anlauf moeglich
  if (s.einmal === 'bei_erfolg') { const st = buchStand(game, s); if (st && st.state === 'done' && st.ausgang === 'erfolg') return `das Buch ${s.buch} ist in dieser Partie schon gelungen (einmal ${s.einmal})`; }
  return null;
}
function reichweiteFehler(game, s) {   // der Hex `von` (Pulverhorn) in hoechstens ziel.erreichbar_max Spruengen ueber offene Kanten von hier
  if (!B1().erreichbar(game, hierHex(game), s.ziel.erreichbar_max).has(s.von)) return `${hexName(s.von)} (${s.von}) ist nicht in hoechstens ${s.ziel.erreichbar_max} Spruengen erreichbar`;
  return null;
}
function voraussetzungen(game, s) {
  const m = mission(game);
  if (keinKartenModus(game)) return 'kein Missionsstand oder keine Karte in diesem Modus';
  const e = einmalFehler(game, s);
  if (e) return e;
  if (szeneLaeuft(game)) return 'eine Szene oder Gefahr laeuft';
  if (m.activeId) return `eine andere Mission laeuft (${m.activeId})`;
  return reichweiteFehler(game, s);
}
// SON-01 C: die Voraussetzungen, die ein ANGEBOT haelt (Brett, Inszenierer): nur was nicht in Sekunden vergeht (nicht schon gelungen, Pulverhorn in Reichweite des Hafens). Eine laufende Szene oder Mission gehoert dem Start (voraussetzungen):
// sie nimmt kein Angebot vom Brett, der Beat scheitert dann sauber mit Logbuch. Aufrufer: faden-pruefer.js pruefeLage ueber den Baustein (angebotFehler), beim Anbieten, beim Annehmen und im Inszenierer. beat = ein Beat der Vorlage (parameter.sektor). -> null | 'LAGE_SONDERSEKTOR: Grund'
function angebotFehler(game, beat) {
  const id = beat && beat.parameter && beat.parameter.sektor;
  const s = typeof id === 'string' ? S.sektor(id) : null;
  if (!s) return 'LAGE_SONDERSEKTOR: unbekannter Sondersektor';
  const g = keinKartenModus(game) ? 'kein Missionsstand oder keine Karte in diesem Modus' : einmalFehler(game, s) || reichweiteFehler(game, s);
  return g ? 'LAGE_SONDERSEKTOR: ' + g : null;
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
  angebotFehler,
};

// ---------- Ausgang und Aufraeumen
// Ausgang gelungen: der Ort der Geschichte wandert zum Ausgangs-Hex der Daten (faden.parameter.ort, wie geruecht und wiedersehen in faden-b1.js ortFuer; ein Folgebeat liest ihn dort), die Station nennt ihn.
// {hex} und {ort} der Ausgangszeile sind der Ausgangs-Hex (die Koordinate und der Name des Orts, an dem die Crew wieder herauskommt), nicht der Sondersektor.
function ausgangBuchen(game, f, s) {
  f.parameter.ort = s.ausgang.hex;
  Bitte().funkSprecher(game, hexName(s.hex), fmt(s.ausgang.funk, { hex: s.ausgang.hex, ort: hexName(s.ausgang.hex) }));
}
// Fristablauf mitten im Buch: das Buch ist verworfen, was es an der Szene geschaltet hat, bliebe aber stehen. Die Gruppen, die die Szene erst durch ein Regiebuch einschalten laesst (Daten der Szene: zonenAus, bei Helix das Haltefeld
// des Finales), gehen wieder aus, solange die Crew im Sondersektor ist (verlaesst sie ihn, setzt der naechste Eintritt die Gruppen aus den Daten zurueck). Sonst sitzt die Crew im Haltefeld ohne Buch, ohne Tipps und ohne Ausgang.
function szeneFreigeben(game, s) {
  if (hierHex(game) !== s.hex) return;
  const loc = Locations.get(game.ship.scene), aus = loc && loc.scene && loc.scene.zonenAus;
  for (const gruppe of Array.isArray(aus) ? aus : []) ZonenSim().schalten(game, gruppe, false);
}

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
      if (gelungen) ausgangBuchen(game, f, s);
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
      szeneFreigeben(game, s);
      sagen(game, s, s.funk.verlust);
      logbuch(game, { ausgang: 'abgeraeumt', begruendung: `Beat sondersektor ohne Ausgang beendet (Frist): das Buch ${s.buch} wird verworfen`, plan: { faden: fid, sektor: s.id, buch: s.buch } });
    }
  }
}

module.exports = { sondersektor, starten: sondersektor.starten, update, voraussetzungen };
