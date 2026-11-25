# Update 9.28.2 – Punktespiel-Overlay: Punkte-Übersicht, Kasten, Deckkraft

## Neu
- Stubenkontrolle → Spielregeln → „Overlay: …“:
  - **Punkte-Übersicht:** „Karten“ (wie bisher, Standard) oder „Chips mit Punkten“. Im Ergebnis zeigen die Chips `+Punkte Name` bzw. `-Einsatz Name`, sortiert (Gewinner zuerst nach Betrag, dann Erwischte), Namen nie abgeschnitten; höchstens 12 Chips, der Rest als „und N weitere“. Erwischte bekommen mindestens 4 Plätze. In Anmeldung und Kontrolle zeigen die Chips Name und Einsatz.
  - **Kasten hinter dem Panel:** „An“ (wie bisher, Standard) oder „Aus“ (nur Text mit Schatten direkt im Bild).
  - **Deckkraft des Kastens:** 10–100 % (Standard 100).
- Zusammenspiel mit der Detailstufe: „Ausführlich“ zeigt alles wie bisher (Chips statt Karten, wenn gewählt). „Kompakt“ mit Chips zeigt die Chips nur im Ergebnis und lässt dort die Textzeile mit denselben Punkten weg. „Kompakt“ mit Karten bleibt wie in 9.28.1.
- Zum Ausprobieren in der Overlay-Adresse überschreibbar: `…&points=chips&box=off&boxopacity=60`.

## Nach dem Update
1. Dateien ersetzen bzw. Update einspielen, Container `bcc-web` neu starten (kein Neustart des Twitch- oder Discord-Bots nötig).
2. In OBS bzw. Moblin die Browserquelle des Punktespiel-Overlays **neu laden**.
3. Mit „Test“ im Control Center Anmeldung, Kontrolle und Ergebnis prüfen; Optionen ausprobieren.

## Hinweise
- Ohne Änderung der Einstellungen sieht das Overlay aus wie in 9.28.1.
- Keine Änderung an der Datenbank oder an der `compose.yaml`.

## Weiter aus 9.28.1 und 9.28.0 (unverändert)
- Lage, Größe, Abstand und Detailstufe des Panels; Chat-Befehl `!clip`.
