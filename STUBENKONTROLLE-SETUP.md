# Punktespiel (Modul „Stubenkontrolle“) einrichten

Das Punktespiel ist ein Chat-Spiel für Twitch mit Konten, Einsätzen, Runden und einem Overlay für OBS oder Moblin. Intern heißt das Modul weiterhin „stubenkontrolle“ (Adressen, Dateinamen, Rechte); in der Oberfläche und in den Chat-Antworten erscheinen die Namen, die du in der Ersteinrichtung oder unter Administration → Profil & Branding festlegst (Spielname, Punktename, Befehle).

## Überblick

- Das Control Center führt die Spiellogik aus. Konten, Punktestände, Runden, Teilnehmer und Buchungen liegen relational in PostgreSQL.
- Das Overlay liefert das Control Center selbst aus. Es funktioniert in jeder Browserquelle (OBS am PC oder Mac, Moblin am iPhone) und öffnet nur eine verschlüsselte WebSocket-Verbindung zum Control Center.
- Der Overlay-Schlüssel erlaubt nur Lesen: keine Verwaltungsfunktionen, keine Schreibzugriffe.

## Overlay einrichten

1. Control Center → Live-Betrieb → Stubenkontrolle → **Externer Overlay-Zugang**: Die WSS-Adresse prüfen (`wss://bot.example.org/ws/stubenkontrolle`) und **Neuen Schlüssel erzeugen**.
2. Die angezeigte **Overlay-Adresse** kopieren: `https://bot.example.org/stubenkontrolle/overlay#key=…`
3. OBS: Quelle hinzufügen → Browser → **URL** (nicht „Lokale Datei“) = Overlay-Adresse, 1920 × 1080, Hintergrund transparent lassen.
4. Moblin: Widget „Browser“ mit derselben Adresse, 1920 × 1080.
5. Mit den Test-Schaltflächen prüfen (Anmeldung, Kontrolle, Ergebnis, Ergebnis „alle bestehen“).

Hinweise:

- Ein neuer Schlüssel trennt alle alten Verbindungen.
- Ist `STUBENKONTROLLE_ALLOWED_ORIGINS` gesetzt, muss deine Adresse (z. B. `https://bot.example.org`) enthalten sein.
- Safari/WebKit (Moblin) zeichnet die Figur live statt per Video. Erzwingen lässt sich ein Modus mit `&render=svg` oder `&render=video` an der Adresse.
- Vorschau ohne laufende Runde: `…/stubenkontrolle/overlay#demo=registration&n=100` (auch `control`, `passed`, `caught`; `&bg=274a6b` für einen farbigen Hintergrund).
- Die **Figur** des Overlays kannst du unter Administration → Profil & Branding hochladen („Figur des Punktespiels“). Ohne Upload zeigt das Overlay keine Figur.
- Der Ordner `overlay/` mit der lokalen HTML-Datei ist ein alter Weg. Er bleibt bestehen, bekommt aber keine neuen Grafiken.

## Reverse-Proxy (Synology DSM 7)

Das Overlay braucht WebSocket-Unterstützung. Zeigt `https://bot.example.org` bereits auf `http://192.168.1.10:3000`, genügt dieselbe Regel mit diesen Ergänzungen:

1. DSM → Systemsteuerung → Anmeldeportal → Erweitert → Reverse Proxy.
2. Bestehende Regel für `bot.example.org` bearbeiten: Quelle HTTPS, Port 443; Ziel HTTP, Adresse des Control Centers, Port 3000.
3. Unter **Benutzerdefinierter Header** → Erstellen → **WebSocket**. DSM legt `Upgrade` und `Connection` an.
4. In den erweiterten Einstellungen HTTP/1.1 für das Proxy-Ziel verwenden.
5. Für `bot.example.org` muss ein gültiges TLS-Zertifikat zugeordnet sein.
6. Im Control Center unter Live-Betrieb → Stubenkontrolle die WSS-Adresse `wss://bot.example.org/ws/stubenkontrolle` eintragen und einen neuen Schlüssel erzeugen.

Es muss kein zusätzlicher Port aus dem Internet freigegeben werden. Andere Reverse-Proxys (Caddy, nginx) brauchen ebenfalls die Weiterleitung von WebSocket-Verbindungen.

## Spielregeln – Startwerte

- Startguthaben: 1.000 Punkte, genau einmal je Twitch-ID.
- Täglicher Bonus (`!daily`): 100 Punkte pro Kalendertag (Zeitzone Europe/Berlin).
- Einsatz: 50 bis 500.
- Anmeldung zur Runde: 60 Sekunden.
- Pause zwischen Runden: 15 Minuten.
- Faktor: 1,5 + 0,1 je weitere Person, höchstens 3,0.
- Verlauf einer Runde: 75 % individuelle Auswertung, 10 % alle bestehen, 15 % alle scheitern.
- Individuelles Bestehen: 40 %.

Die individuelle Auswertung ist der Normalfall, die beiden Gruppeneffekte sind bewusst seltener, und der steigende Faktor wird bei größeren Runden spürbar. **Alle Werte sind im Control Center änderbar.**

Feste Befehle sind `!daily`, `!give` und `!gift`. Start, Kontostand, Rangliste und Hilfe haben frei wählbare Befehle (Standard: `!spiel`, `!punkte`, `!top`, `!spielhilfe`).

## Reset und Sicherheit

Der Gesamtreset verlangt serverseitig die exakte Zeichenfolge `RESET`. Vorher legt das Control Center automatisch eine vollständige lokale Sicherung im Datenverzeichnis an. Danach sind alle Kontostände und Reservierungen 0; eine laufende Runde wird ohne Erstattung ungültig. Runden aus einer früheren Reset-Generation können anschließend nicht mehr administrativ erstattet werden. Die Markierung „Startguthaben erhalten“ und der Verlauf des täglichen Bonus bleiben erhalten.

Ein technischer Neustart erstattet die reservierten Einsätze einer laufenden Runde.
