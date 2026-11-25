# Update 9.28.1 – Punktespiel-Overlay: Lage, Größe, Detailstufe

## Neu
- Stubenkontrolle → Spielregeln → „Overlay: …“: **Lage des Panels** (neun Felder, Standard unten mittig), **Größe** in Prozent (Standard 80; 100 = bisherige Breite), **Abstand zum Rand** (px, bezogen auf 1920×1080) und **Detailstufe**.
- Detailstufe „Ausführlich“ (Standard) zeigt wie bisher Karten, Seitenanzeige und Zusatzzeile; „Kompakt“ zeigt nur Titel, Kopfzeile und Ergebnistext.
- Die Männchen der Anmeldung laufen weiter unten am Bildrand. Bei einer Lage unten lässt das Panel dafür einen festen Streifen von 120 px frei und bleibt in **jeder Phase an derselben Stelle** (kein Anheben).
- Die Kontrollfigur ist kleiner und sitzt am Panel (Lage oben: darunter; Lage rechts: am linken Panelende).
- Zum Ausprobieren lassen sich die Werte in der Overlay-Adresse überschreiben: `…#key=…&scale=70&anchor=bottom-center&margin=60&detail=compact`.

## Nach dem Update
1. Dateien ersetzen bzw. Update einspielen, Container `bcc-web` neu starten (kein Neustart des Twitch- oder Discord-Bots nötig).
2. In OBS bzw. Moblin die Browserquelle des Punktespiel-Overlays **neu laden** (OBS: Eigenschaften → „Cache der aktuellen Seite aktualisieren“).
3. Wurde das Panel in OBS von Hand verkleinert oder verschoben: Quelle auf volle Größe (1920×1080, Position 0/0) zurücksetzen und Lage und Größe im Control Center einstellen. Sonst wird doppelt skaliert.
4. Mit „Test“ im Control Center Anmeldung, Kontrolle und Ergebnis prüfen.

## Hinweise
- Neuer Standard ist unten mittig bei 80 %. Das alte Aussehen (links 80 px, unten 60 px, volle Breite) lässt sich nur annähernd nachstellen: Lage „Unten links“, Größe 100, Abstand 60. Bei einer Lage unten steht das Panel wegen des festen Streifens für die Männchen etwas höher.
- Keine Änderung an der Datenbank oder an der `compose.yaml`.

## Weiter aus 9.28.0 (unverändert)
- Chat-Befehl `!clip`.
