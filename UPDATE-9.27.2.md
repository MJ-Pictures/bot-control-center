# Update 9.27.2 – Chat-Overlay: Karten für Abos, Bits und Kanalpunkte

## Neu
- **Abo-Karten:** neuer Abonnent (mit Stufe oder Prime), Verlängerung (mit Monatszahl), Geschenkabo und Sammel-Geschenkabos („verschenkt 50 Abos“, nur eine Karte pro Aktion). Anonyme Spender erscheinen als „Anonym“.
- **Bits-Karte:** Name und Anzahl der Bits. Die Nachricht dazu erscheint wie bisher als normale Chat-Nachricht.
- **Kanalpunkte-Karte:** Name und Name der Belohnung („löst „10 Liegestütze“ ein“). Die Eingabe des Zuschauers wird nie angezeigt.
- Jede Art hat ein eigenes Symbol und folgt dem gewählten Look und der Akzentfarbe. Vorschau und Testnachrichten enthalten Beispiele für alle Karten.
- **Einstellungen** unter Live-Zentrale → Chat-Overlay: Karten für Abos, Bits und Kanalpunkte lassen sich einzeln abschalten.

## Bestandsinstallation
- Keine Änderung an der Datenbank oder an der `compose.yaml`.
- Abo- und Bits-Karten funktionieren ohne neue Rechte (Standard: an). Der Twitch-Bot abonniert dafür beim Start eine weitere Chat-Benachrichtigung; schlägt das fehl, steht es im Protokoll und die übrigen Funktionen laufen weiter.
- **Kanalpunkte-Karte (Standard: aus):** Beim Einschalten braucht das Kanal-Konto das Recht „Einlösungen lesen“ (`channel:read:redemptions`). Unter Administration → Verbindungen das Kanal-Konto einmal neu verbinden; danach startet die Verbindung von selbst. Ohne das Recht bleibt die Karte stumm.
- Browserquelle in OBS oder Moblin nach dem Update einmal neu laden (neue Symbole).
- Hinweis: Die Karten für Abos, Bits und Kanalpunkte konnten ohne einen monetarisierten Kanal nicht live geprüft werden; Darstellung und Datenaufbereitung sind getestet, die echten Twitch-Ereignisse nicht.
