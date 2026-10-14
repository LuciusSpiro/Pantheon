# CONCEPT-SL11 – Kette „Die Schuld der Lerche“: freie Reihenfolge, Geldziel, Verzweigung, Lobby

Grundlage: Briefing `Die Schuld der Lerche` (SL11, SL3, SL9), CONTRACT-EK8 (Kapitelsteuerung), Vault `Kampagne Die Schuld der Lerche`; Kais Entscheidungen 2026-10-14. Konzept, nicht gebaut. Code-Angaben: Prüfbericht 2026-10-13 plus Nachprüfung 2026-10-14 („ungeprüft“ markiert).
Abhängigkeiten: SL0–SL10 liefern die Szenen als Regiebücher; SL11 verdrahtet sie. SL1 (Karte, `tutorial` optional, Lobby-Modus, `welt.startOrt`) ist Voraussetzung, SL1B (Marken) und SL2 (Gespräch) werden genutzt.

## 1. Befund (Kette heute, `server/mission/kampagne.js`, `kampagne.schema.json`, `eisenwald.json`)
| Punkt | Stand |
|---|---|
| Struktur | Kapitel → Regiebuch(er) in Reihenfolge (`buecher[]`, `kampagne.js:238`: Erfolg → nächstes Buch, anderer Ausgang wiederholt dasselbe). Genau ein aktives Buch zugleich. Ausgang des letzten Buchs → Folge `weiter`/`wiederholen` |
| Bedingung `wenn` | an `folge` (`schema:119-125`), ausgewertet über `m.cond` beim Buchende (`kampagne.js:251`); Liste von Folgen, erste gültige gilt, letzte ohne `wenn` Pflicht (:122). **In Eisenwald nie benutzt** (nur Abspann-`wenn`), also ungetestet. `cond` kennt `flag`, `missionDone`, `all/any/not`, `check` (Registry), `marks_below n` (`registry.js:338`) – Geld als „mindestens n“ = `not: { marks_below: n }` |
| Fortschritt | `weiter` nur aus `erfolg` (`kampagne.js:117`, KETTE-FORTSCHRITT); andere Ausgänge müssen `wiederholen` |
| Freie Reihenfolge | in der Kette **nicht** möglich (sequenziell). Ein Buch ist ein Zustandsautomat: Schritte mit `objectives`, `next [{if, goto}]`, globale Handler `on` (z. B. Ereignisse setzen Flags). Parallel = ein Schritt mit zwei `objectives`, deren `done` Flags sind, `next` bei beiden. **Ob `check-kette`/Checker das ohne Warnungen schluckt, ist ungeprüft** (Spike 0,5 T) |
| Tutorial | `tutorial` Pflichtfeld, `tutorialUeberspringen` ruft `openTutorialMap` mit Limes-Orten – für Sund ausgelassen, `tutorial` wird in SL1 optional |
| Fortsetzen | `Kette.fortsetzen` (`:270`) rekonstruiert aus Fakten `kapitel`, `kapitel_buch`; Weltstand speichert Fakten, Bücher, Flags bei jedem Missionsende und Andocken. Zufallsort Kapitel 4: nicht abgebildet – braucht Ist-Ort des Schiffs |
| Einstieg (Labor) | `einstieg {ort, flags, fakten, fracht, marken, oeffnet}` je Kapitel (:294); `ort` muss ein **bekannter Ort** sein (`ortIds`, :94 – nutzt `Locations.LOCATIONS` + `Sektoren.datenOrte()`; Sund-Orte mit `gen:true` gehen, Leerraum `leer-<hex>` nicht) |
| Notrufe | Szenen außerhalb der Kette; Kapitelfluss darf nicht auf sie warten |

## 2. Entwurf
### 2.1 Dateien
- `content/kampagne/schuld-der-lerche.json` (`format: kampagne/1`, `tutorial` entfällt, `welt:'sund'` neu optional im Schema, `npc: { evert, bote, wirt, …}`), `start: 'k1_kantenstein'`.
- Regiebücher `content/regiebuecher/sl_*.regiebuch.json` (je Kapitel, `kopf.art:'kapitel'`, jeder mit Ausgang `erfolg`; Prüfer verlangt das, :103). Texte (Funk, Gespräch, Kapitelkarten, Abspann) schreibt das Studio als Entwurf, Kai passt an.
- Schema: `tutorial` optional, `welt` optional; neu **`bedingung` am Kapitel** (siehe 2.3) statt eines Eingriffs in die Buchlogik.

### 2.2 Kapitel und Flüsse (Zeilennummern = Briefing)
| Nr | Kapitel-ID | Buch | Ausgänge → Folge |
|---|---|---|---|
| 1 | `k1_kantenstein` | Gespräch Evert (SL2), Anheuern | `erfolg` → k2 |
| 2 | `k2_ueberfahrt` | Evert als Fracht, Sprünge über Concordia nach Pulverhorn (SL0, SL3) | `erfolg` → k3 |
| 3 | `k3_falle` | Evert abgeben, Falle (SL3) | `erfolg` (Notfallsprung **oder** Sprungpunkt erreicht) → k4; `zerstoert` → wiederholen. **Kein `rueckzug`** (Kais Default: Ausgänge `erfolg`/`zerstoert`). Der Buchausgang `erfolg` entsteht in der Schrittlogik: Schritt-Bedingung `{any:[ {event:'emergencyJump'}, {check: sprungpunkt_erreicht} ]}` → `complete erfolg`; `lerche_zerstoert` → `complete zerstoert` |
| 4 | `k4_gestrandet` | Reaktor, Sonde, nach Concordia (SL4) | `erfolg` → k5 |
| 5 | `k5_forderung` | Bote, Signal entschlüsseln (SL5) | `erfolg` → k6 |
| 6 | `k6_spur` | Spur bis verborgene Kante (SL5, SL1) – `kante_enthuellen` am Ende | `erfolg` → k7 |
| 7 | `k7_geld` | **ein** Buch, Schritt `verdienen` mit Zielen 7a (Deuterium verkauft), 7b (Forschungsdaten abgeliefert), 7c freiwillig | `erfolg` → k8 sobald **7a und 7b erledigt UND Geldziel erreicht** |
| 8 | `k8_entscheidung` | Wahl A/B in Concordia | `lösegeld` → k9a, `soeldner` → k9b (Ausgänge des Buchs, nicht `erfolg`/Flags) |
| 9A/9B | `k9a_uebergabe`, `k9b_soeldner` | SL9 | `erfolg` → k10 |
| 10 | `k10_boje` | Boje (SL10); Wettlauf-Variante per Flag `weg_a` | `erfolg` → `ende` |

Kapitel 8 → 9A/9B: Das Schema verlangt, dass jeder Buchausgang eine Folge hat und `weiter` nur aus `erfolg` (:117). **Konflikt:** zwei Ausgänge `loesegeld`/`soeldner` sind verboten. Lösung ohne Schemaaufweichung: Buch k8 endet **immer** mit `erfolg` und setzt Flag `weg_a` bzw. `weg_b`; die Kette verzweigt per `wenn` am Ausgang `erfolg`:
`"erfolg": [ { "weiter": "k9a_uebergabe", "wenn": { "flag": "weg_a" } }, { "weiter": "k9b_soeldner" } ]` – nutzt die vorhandene Mehrfach-Folge (:96, :119). Das ist **erster Einsatz** dieses Mechanismus; Test und Fehlerfall (kein Flag) → Rückfall `k9b` bzw. `wiederholen`.

### 2.3 Freie Reihenfolge, Geldziel
- **Reihenfolge 7a/7b**: ein Buch `k7_geld`, Schritt `verdienen` mit `objectives [{id:'gas', done:{flag:'gasVerkauft'}}, {id:'forschung', done:{flag:'forschungFertig'}}]`, `on`-Handler setzen die Flags aus den Szenenereignissen (SL6, SL7 geben Ereignisse `deuteriumVerkauft`, `datenAbgeliefert`). `next` auf `{all:[…beide Flags…]}` → Schritt `geld`. Szenen 7a/7b selbst sind eigene **Missions-/Szenenbücher oder Schritt-Gruppen** im selben Buch (kein Kapitelwechsel); Wiederholung einer gescheiterten Szene ist Sache der Szene (Rückkehr zum Ort), nicht des Kapitels. Prüfung: `check-kette` muss Schritte mit mehreren offenen Zielen zulassen (ungeprüft; Spike).
- **Geldziel** = Bedingung beim **Eintritt in Kapitel 8** (Kai): Schritt `geld` wartet auf `{ not: { marks_below: GELDZIEL } }`; erst dann Wechsel (Folge `weiter: k8`). Zahl `GELDZIEL` aus `config.campaign.sund.geldziel` (Studio, nach Spieleabend nachgestellt). Geld wird erst **bei der Wahl in k8 abgebucht** (Lösegeld 130 %, Söldner 100 % des ursprünglichen Lösegelds – Briefing SL9, Zahlen Studio). Fehlen die Marken nach der Wahl: Rückfall `verdienen` (zurück in k7-ähnlichen Schritt), nie Sackgasse; neuer Baustein `marken_abbuchen`.
- **Notrufe freiwillig**: laufen als allgemeine Mechanik (SL8) unabhängig vom Buch, nur Zeitfenster-Flag `notrufeFrei` ab Kapitel 6.

### 2.4 Layer-Schnitt (CLAUDE.md)
- **Storage**: Weltstand (Fakten `kapitel`, `kapitel_buch`, Flags `weg_a/weg_b/…`, `welt_karte`, Marken) bleibt einzige Quelle; Kette speichert nichts zusätzlich. Zustände für mehrere Konsumenten (`weg`) im Weltstand-Fakt `weg` (`loesegeld|soeldner`), nicht nur als Flag.
- **Action**: `server/mission/kampagne.js` (Kette) bekommt nur das Nötige: `folge()` bleibt; neu intention-benannte Prüfer `pruefenParallel…` (falls Spike es verlangt) statt Parameter. Geld/Wahl: `server/sim/geld.js`? (ungeprüft, ob es ein Geld-Modul gibt – `g.inventory.marks`) mit `geld.abbuchen(game, n)`, `geld.genug(game, n)` als benannte Funktionen, Regiebuch-Bausteine `marken_abbuchen`, Prüfung `marken_mind`. Texte/Bausteine pro Entität (Evert, Wahl).
- **Frontend**: Kapitelkarten, Funktexte, Abspann kommen aus Daten (vorhanden). Lobby: ein Modus `schuld_der_lerche` (SL1 baut Plumbing), Anzeige „Neu: Die Schuld der Lerche“ aus `START_LABELS`. Abspann-Blöcke `wenn { flag }` (vorhanden, `abspannBloecke` :264).

### 2.5 Lobby
`protocol.js`: `LOBBY_MODI` + `schuld_der_lerche`, `CAMPAIGN_KETTEN.schuld_der_lerche = { kampagne:'schuld-der-lerche', tutorial:false, welt:'sund' }` (SL1). Ohne Tutorial: `Kette.starten()` direkt, Start am Boden (SL1).

## 3. Schnittstellen / Flags
`weg_a|weg_b` (Weltstand-Fakt `weg`), `evertAngeheuert`, `gasVerkauft`, `forschungFertig`, `notrufeFrei`, `notrufe_gelöst` (Zähler für Abspann), `koordinatenPiraten` (nach 9A, Folge in k10), Ereignisse `emergencyJump`, `lerche_zerstoert`, `deuteriumVerkauft`, `datenAbgeliefert`. `schnittstelle.flags` der Kette listet Flags, die erst fremde Pakete setzen (Prüfer warnt sonst).

## 4. Entscheidungen
| Nr | Entscheidung | Begründung |
|---|---|---|
| D1 | k3 hat Ausgänge `erfolg`/`zerstoert`, kein `rueckzug` (Kai) | „Rückzug = Erfolg“ ohne Schemaänderung |
| D2 | Verzweigung per `wenn` am `erfolg` von k8 | Schema verbietet `weiter` aus anderen Ausgängen; Mehrfach-Folge ist vorhanden |
| D3 | 7a/7b/7c ein Buch, kein Kapitelpaar | Kette bleibt linear, Engine unberührt |
| D4 | Geldziel als Bedingung beim Eintritt in k8, Abbuchung bei der Wahl (Kai) | verhindert Ausgeben vor der Entscheidung |
| D5 | Tutorial im Schema optional, kein Überspringen (Kai) | Sund hat kein Tutorial |
| D6 | Kapitel 4 startet am Ist-Ort des Schiffs | Notfallsprung landet zufällig |

## 5. Abnahme
Ganze Kette per Bot auf beiden Wegen (A und B) bis zum Abspann; `npm run check:kette`: 0 Fehler, Platzhalter-Liste leer; `test-kette` für Sund; Speichern/Laden an **jedem** Übergang (auch mitten in k7, mit einem von zwei Zielen); Labor-`einstieg` je Kapitel; Geld reicht / reicht nicht (Rückfall); Eisenwald läuft durch (`sim:kette`, Golden, `npm test`).

## 6. Schätzung
**3–4 Studio-Tage** (wie Briefing, ungeprüfter Spike obenauf +0,5 bei Problemen mit parallelen Zielen). Verteilung: Kette + Schema 1, Bücher/Verdrahtung k1–k10 1,5, Geld/Marken-Bausteine 0,5, Bots/Tests 1. Texte laufen separat (Entwurf, ~1 T, nicht eingerechnet).

## 7. Offene Fragen (nur Kai)
- K1: Zahlen: Geldziel/Lösegeld/Söldner/Sondenpreis legt das Studio fest, stellt nach Spieleabend 3 nach (Default: wie Briefing; erste Werte aus Gasfeld-/Forschungs-Ertrag so, dass Pflichtaufträge die Söldner knapp tragen).
- K2: Wer wählt A/B – Captain allein oder Crew-Abstimmung? (Default: Captain wählt am Funk/Pult, Crew sieht die Wahl.)
- K3: Nach dem Abspann: Hauptmenü wie Eisenwald (Default), freies Spiel erst später.
- K4: Zählt das Gasfeld-Deuterium im Frachtraum auch, wenn Evert (Fracht) an Bord ist? (2 Plätze, SL0.) Default: Evert belegt einen Platz nur Kapitel 2–3, danach frei.
