# CONTRACT-S2B – Spielleiter live tauglich + Kampf nach Kais Spielrunde

Ergänzung zu `CONTRACT-S2.md` (inkl. §8b–§8d). Vorhandene Feldnamen werden nicht gebrochen. Bei Widerspruch gilt der Code.
Abweichungen und Namenskonflikte meldet jedes Team an die Studioleitung (SendMessage an "main"), nicht selbst auflösen.

## 0. Ziel und Entscheidungen

**Auftrag Kai (2026-10-08, nach seiner ersten S2-Runde: „sieht echt gut aus“):**
1. **Gegner zu schwach / Waffen zu stark:** Ein Jäger stirbt heute an einer Salve – er soll **3× so viel aushalten**.
2. **Kanonenboot braucht mehr Feuerkraft.** Der angekündigte **Ladeschuss bleibt** („super“). Dazu kommt eine
   **Sperrfeuer-Waffe**: eine Projektilwaffe, die **oft schießt**, dafür **langsame Geschosse**, denen man **leicht
   ausweichen** kann. (Lesart der Studioleitung: Waffe des Kanonenboots, nicht der Lerche – im Bericht an Kai benannt.)
3. **S2b „Spielleiter live tauglich“** wie vorgeschlagen: Rohfassung plan-treu, Szenen billiger, Szenen öfter gültig,
   Live-Aufnahmen nachholen.

**Nicht in S2b:** Inhalt pro Minute (Kai bewertet die Zeiten am Spieleabend), neue Orte, neue Mechaniken außer Sperrfeuer.

**Gewollte Änderung am Tutorial:** Die stärkeren Jäger und das Sperrfeuer gelten auch in m1–m3. Der Golden-Vergleich gegen
`tools/fixtures/golden/base` wird deshalb **bewusst neu aufgenommen** (QA, Welle 2); vorher ein Vergleich, der zeigt, dass
nur Kampfdauer/Hülle abweichen, nicht die Schrittfolge.

## 1. Dateibesitz und Wellen

| Welle | Team | Dateien |
|---|---|---|
| 0 | Studioleitung | `CONTRACT-S2B.md`, `shared/config.js` Startwerte (`enemies.raider.hp`, Block `spaceS2b`) |
| 1 | KAMPF | `server/sim/{space,pilot,damage,escort}.js`, `shared/config.js` (nur Blöcke `enemies`, `enemyShields`, `spaceM3.tele`, `spaceS2b`, `escorts`), `shared/protocol.js` (nur ergänzen), `tools/test-{combat,flight,escort}.js` |
| 1 | DARSTELLUNG | `public/js/{art,audio,render,client}.js`, `public/{art,audio}-preview.html` |
| 1 | SPIELLEITER | `server/mission/{spielleiter,szenenbau,llm,context,archiv}.js`, `content/spielleiter/prompts/**`, `tools/test-spielleiter.js`, `tools/test-llm-live.js`, `tools/fixtures/{llm,context}/**` |
| 2 | QA-INTEGRATION | alle; Golden neu, BOTS-Messungen (`tools/sim-headless.js`), Balancing nachziehen |
| 3 | QA-ABNAHME | alle; Live-Aufnahmen, Browser-Runde, README |

Testserver: KAMPF 3350–3352, DARSTELLUNG 3353–3355, SPIELLEITER 3356–3358, QA 3360–3369, immer `ROOM_CODE=off`, eigenes
`WORLD_DIR`/`REGIE_DIR`. **Nie 3300/3301/3310 (Demo) und nie 3389 (RDP).** Nur Edit/Write. PowerShell. Nicht committen.

## 2. Kampf (KAMPF)

- **Jäger:** `enemies.raider.hp` 12 → **36** (Studioleitung setzt den Startwert). Schildsektoren bleiben; KAMPF prüft, dass
  „eine volle Salve“ (Lanze voll + beide Batterien) einen Jäger nicht mehr zerstört, drei aber schon (Test).
- **Kanonenboot Feuerkraft:** Ladeschuss bleibt (Ankündigung `tele`); Schaden moderat anheben (`spaceM3.tele.gunboat.damage`
  3 → 4 als Startwert, KAMPF darf abstimmen).
- **Sperrfeuer** (neu, Kanonenboot): Projektil-Art **`sperrfeuer`** in `game.space.projectiles` (Feld `kind`):
  - feuert in Feuerstößen aus der Breitseite (z. B. 3 Geschosse je Stoß, Stoß alle ~3 s, Werte in `spaceS2b.sperrfeuer`),
  - **langsam** (Geschwindigkeit deutlich unter Lerche-Reisetempo, Startwert 110 px/s), begrenzte Lebensdauer/Reichweite,
  - **ausweichbar**: kein Zielsuchen, kein Vorhalt über 0,5 s; Kurswechsel oder Ausweichen der Lerche bringt sie vorbei,
  - kleiner Schaden je Treffer über `damage.resolveHit` (Schildfilter wie gehabt; volle Schilde fangen fast alles),
  - zielt auf das aktuelle Ziel (`targetOf`), also auch auf Schützlinge (dort gilt Breitseite als Schild wie bei Ladungen),
  - während ein Ladeschuss lädt, schießt das Kanonenboot kein Sperrfeuer (lesbar halten).
  - Lanze/Batterien können Sperrfeuer-Geschosse **nicht** abschießen (S2b; später vielleicht).
- **Snapshot:** Projektile `{ id, kind: 'sperrfeuer', x, y, angle }` wie die vorhandenen; Ereignis `sfx sperrfeuer` je Stoß.
- **Balancing-Ziel** (mit Bots, QA misst): Arena-Welle Kanonenboot + 2 Jäger zu dritt dauert länger als heute, Hüllenverlust
  „Nase drauf“ vs. „Manöver“ bleibt ≥ 1,4×; Ausweichen gegen Sperrfeuer spart messbar Hülle. Tests in `test-combat`.

## 3. Darstellung (DARSTELLUNG)

- Sperrfeuer-Geschoss: deutlich sichtbar, langsam, z. B. glühender Bernstein-Bolzen `#FFC66B` mit kurzer Spur; im Voxel- und
  2D-Raumkampf (Raumkampf ist 2D). Mündungsblitz an der Breitseite.
- Ton `sperrfeuer` (dumpfes Wummern, kurz, nicht lauter als `hull_hit`), vor `init()` No-op.
- Jäger-Trefferanzeige: Da Jäger jetzt mehr aushalten, braucht der HP-Balken des Gegners Segmente/Lesbarkeit prüfen.

## 4. Spielleiter live tauglich (SPIELLEITER)

1. **Rohfassung plan-treu:** Standardtexte einer Umsetzung bekommen aus dem Grobplan Auftraggeber, Funk-Sprecher (z. B.
   `stimme` je Szene), Ziel-/Sachverhaltsnamen und Belohnungsangaben. Kein Fremd-NSC in der Rohfassung (Fall „Sela funkt in
   Grauzahns Mission“). Prüfregel: Funk-Sprecher einer Szene ∈ Besetzung der Mission.
2. **Szenen billiger:** Prompt je Szene enthält nur den Auszug der betroffenen Umsetzung(en) + Grobplan-Kurzform + Kontext-
   auszug, nicht den ganzen Katalog. **Ziel < 8k Tokens je Szene** (gemessen).
3. **Szenen öfter gültig:** Selbstprüfungs-Liste im Szenen-Prompt, automatische Reparatur einfacher Fehler (Anführungszeichen,
   Verzweigung ohne Einträge, Flag ohne setzende Folge → Standardweg), zweiter Versuch mit Prüferfehlern. **Ziel ≥ 70 %
   gültig beim ersten oder zweiten Versuch**, gemessen über ≥ 10 Live-Szenen.
4. **Vorlauf:** Beim Annehmen alle Szenen bis einschließlich der zweiten anfragen; Szenen am selben Ort ohne Anflug ebenfalls
   vorab. Ziel: keine Szene geht als Rohfassung, nur weil sie zu spät kam (Grund im Regie-Logbuch).
5. **Grobplan:** Belohnungen nur als lesbare Felder (`belohnung_marken`), Erinnerungen gegen Fakten prüfen (Fall „Datenkern an
   Bord“, obwohl beim Konkordat) – Prüfregel `ERINNERUNG-WIDERSPRUCH`.
6. **Live-Messung** (nur SPIELLEITER, Budget **≤ 120 000 Tokens**, `LLM_LIVE=1`): ≥ 10 Szenen + 2 Grobpläne, Tokens und
   Gültigkeit je Aufruf berichten. Aufnahmen landen über die Ablage in `content/spielleiter/erzeugt/` (Status `offen`).
   **Nie `--archiv`** auf die handgeschriebenen Archiv-Dateien.

## 5. Welle 2/3

- **QA-INTEGRATION:** alles zusammenführen; Golden m1–m3 bewusst neu aufnehmen (vorher Vergleich: gleiche Schrittfolge);
  BOTS-Messungen `sim:arena`, `sim-headless escort --seeds 10`, `archiv --seeds 5`, Schützling-Balancing nachziehen (Ziel
  weiter zu dritt 70–90 % / solo 50–70 % heil); `npm test` grün.
- **QA-ABNAHME:** Live-Aufnahmen nachholen (Tesk, Sela mit Geleit, Melk, Grauzahn, `melk-klausel`; Budget **≤ 200 000
  Tokens**), eine live erzeugte Mission zu dritt im Browser mit ausgearbeiteten Szenen spielen, sceneWait messen, README.

## 6. Abnahme

1. Jäger hält 3 Salven aus (Test), Kanonenboot hat Sperrfeuer, das man sichtbar ausweichen kann (Browser-Screenshot + Messung
   Hülle mit/ohne Ausweichen).
2. Rohfassung ohne Fremd-NSC; Prüfregeln Sprecher/Erinnerung greifen (Testfälle).
3. Live: Szene < 8k Tokens im Median, ≥ 70 % gültig (≥ 10 Szenen), mindestens eine Mission mit ausgearbeiteten Szenen gespielt.
4. 5 Live-Aufnahmen zum Review in `content/spielleiter/erzeugt/` (Status `offen`), md vollständig.
5. Alles grün inkl. neuer Golden-Basis; Schützling-Balancing im Ziel; README aktualisiert.
