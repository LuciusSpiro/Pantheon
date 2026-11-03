-- TEL-01 D2: gespeicherte Beispielabfragen für `npm run abfrage -- --beispiel <name>` (Tabellen und Views: tools/auswertung/abfrage.js, `npm run abfrage -- --schema`).
-- Format: "-- @name <name>", Kommentarzeilen darunter = Beschreibung, dann das SQL (eine Anweisung). Nur lesend.

-- @name quote_je_waffe_nach_spielerzahl
-- Trefferquote je Waffe nach Spielerzahl, über alle geladenen Läufe (eigene Seite: Spieler, Lerche, Crew). Quote = Schüsse mit mindestens einem Treffer / Schüsse, wie f2.quote.* in kennzahlen.js: ein Schuss trifft, wenn er selbst treffer = 1 trägt (Lanze im Raum) oder ein Treffer mit gleicher pid, gleichem Ort und eigener Seite existiert; Schüsse ohne pid und ohne Ergebnis zählen nicht. Die Quote ist über alle Läufe der Zeile gepoolt, nicht der Median der Läufe.
WITH treffer_pid AS (
  SELECT DISTINCT kennung, ort, pid FROM v_treffer
  WHERE pid IS NOT NULL AND (von GLOB 'p[1-4]' OR von IN ('lerche', 'crew'))
), schuss_eigen AS (
  SELECT sh.kennung, sh.ort, sh.waffe, CASE WHEN sh.treffer = 1 OR (sh.kennung, sh.ort, sh.pid) IN (SELECT kennung, ort, pid FROM treffer_pid) THEN 1 ELSE 0 END AS getroffen
  FROM v_schuss sh
  WHERE (sh.von GLOB 'p[1-4]' OR sh.von IN ('lerche', 'crew')) AND (sh.pid IS NOT NULL OR sh.treffer IS NOT NULL)
)
SELECT s.spielerzahl, se.ort, se.waffe, COUNT(DISTINCT se.kennung) AS laeufe, COUNT(*) AS schuesse, SUM(se.getroffen) AS mit_treffer,
       ROUND(100.0 * SUM(se.getroffen) / COUNT(*), 2) AS quote_prozent
FROM schuss_eigen se JOIN sessions s ON s.kennung = se.kennung
GROUP BY s.spielerzahl, se.ort, se.waffe
ORDER BY s.spielerzahl, se.ort, se.waffe

-- @name lanze_quote_dritte_szenen_drei_spieler
-- Trefferquote der Lanze, nur dritte Szenen (szene_nr = 3: die dritte Szene einer Session), nur Sessions mit drei Spielern (das Beispiel aus dem Konzept). Gleiche Quotenregel wie quote_je_waffe_nach_spielerzahl (der Treffer-Nachschlag laeuft ueber IN statt ueber einen Join: der Join ohne Index brauchte bei 190 Sessions ueber eine Minute, so 1,6 s). Leer, wenn keine geladene Session eine dritte Szene mit Lanzenschuss hat (die Bot-Läufe der Basis: nur m1 hat drei Szenen, in der dritten fällt kein Lanzenschuss; ersetze 'lanze' und die Spielerzahl, um andere Schnitte zu fragen).
WITH treffer_pid AS (
  SELECT DISTINCT kennung, ort, pid FROM v_treffer
  WHERE pid IS NOT NULL AND (von GLOB 'p[1-4]' OR von IN ('lerche', 'crew'))
)
SELECT sh.ort, COUNT(DISTINCT sh.kennung) AS laeufe, COUNT(*) AS schuesse,
       SUM(CASE WHEN sh.treffer = 1 OR (sh.kennung, sh.ort, sh.pid) IN (SELECT kennung, ort, pid FROM treffer_pid) THEN 1 ELSE 0 END) AS mit_treffer,
       ROUND(100.0 * SUM(CASE WHEN sh.treffer = 1 OR (sh.kennung, sh.ort, sh.pid) IN (SELECT kennung, ort, pid FROM treffer_pid) THEN 1 ELSE 0 END) / COUNT(*), 2) AS quote_prozent
FROM v_schuss sh
JOIN sessions s ON s.kennung = sh.kennung
WHERE sh.waffe = 'lanze' AND sh.szene_nr = 3 AND s.spielerzahl = 3
  AND (sh.von GLOB 'p[1-4]' OR sh.von IN ('lerche', 'crew')) AND (sh.pid IS NOT NULL OR sh.treffer IS NOT NULL)
GROUP BY sh.ort
ORDER BY sh.ort

-- @name dauer_je_gruppe
-- Sessiondauer (Spielzeit in s) je Gruppe (Modus, Szenario, Spielerzahl): Läufe, Mittel, Kleinste, Größte. Aus den Kennzahlen (f1.dauer.session); der Median steht im Vergleich und in der Basis (SQLite hat keinen).
SELECT s.gruppe, COUNT(*) AS laeufe, ROUND(AVG(k.wert), 1) AS mittel_s, ROUND(MIN(k.wert), 1) AS min_s, ROUND(MAX(k.wert), 1) AS max_s
FROM sessions s JOIN kennzahlen k ON k.kennung = s.kennung AND k.schluessel = 'f1.dauer.session'
GROUP BY s.gruppe
ORDER BY s.gruppe

-- @name verluste_je_gruppe
-- Verluste je Lauf und Gruppe (Mittel): gefallene Spieler, Notfallprotokolle, Zonenausfälle. Ein Lauf ohne die Kennzahl zählt mit 0 (Zähler fehlen, wenn nichts passierte).
SELECT s.gruppe, COUNT(*) AS laeufe,
  ROUND(AVG(COALESCE((SELECT wert FROM kennzahlen k WHERE k.kennung = s.kennung AND k.schluessel = 'f3.gefallen.n'), 0)), 2) AS gefallen_je_lauf,
  ROUND(AVG(COALESCE((SELECT wert FROM kennzahlen k WHERE k.kennung = s.kennung AND k.schluessel = 'f3.notfall.n'), 0)), 2) AS notfall_je_lauf,
  ROUND(AVG(COALESCE((SELECT wert FROM kennzahlen k WHERE k.kennung = s.kennung AND k.schluessel = 'f3.zone_aus.n'), 0)), 2) AS zone_aus_je_lauf
FROM sessions s
GROUP BY s.gruppe
ORDER BY s.gruppe

-- @name kills_je_rolle_nach_spielerzahl
-- Abschüsse je Gegnerrolle und Ort nach Spielerzahl, mit der mittleren Lebenszeit bis zum Abschuss (kill.lebte in s). Boden: ein Gegner kann mehrfach "abgeschossen" werden (nr zählt, Wiederaufstehen), hier zählt jede Zeile.
SELECT s.spielerzahl, k.ort, k.rolle, COUNT(*) AS kills, COUNT(DISTINCT k.kennung) AS laeufe, ROUND(AVG(k.lebte), 1) AS lebte_mittel_s
FROM v_kill k JOIN sessions s ON s.kennung = k.kennung
GROUP BY s.spielerzahl, k.ort, k.rolle
ORDER BY s.spielerzahl, k.ort, kills DESC

-- @name schaden_je_waffe_boden
-- Schaden der Spieler am Boden je Waffe (Treffer auf Gegner): Treffer, Schaden roh (vor Schild) und Schaden, der den Körper erreichte; je Treffer im Mittel. Nur Zeilen mit eigener Seite als Schütze.
SELECT t.waffe, COUNT(*) AS treffer, ROUND(SUM(t.schaden_roh), 1) AS schaden_roh, ROUND(SUM(t.schaden), 1) AS schaden_wirkt, ROUND(AVG(t.schaden_roh), 2) AS roh_je_treffer
FROM v_treffer t
WHERE t.ort = 'boden' AND t.von GLOB 'p[1-4]' AND t.ziel = 'gegner'
GROUP BY t.waffe
ORDER BY schaden_roh DESC
