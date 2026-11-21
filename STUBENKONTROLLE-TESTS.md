# Punktespiel – geprüfte Fälle

Mit isolierten Testdaten wurden geprüft:

- einmaliges Startguthaben von 1.000 Punkten,
- `!daily` nur einmal am selben Kalendertag (Europe/Berlin),
- sofortige Einsatzreservierung,
- doppelte Teilnahme derselben Twitch-ID in einer Runde wird verhindert,
- Faktorberechnung bei mehreren Teilnehmern (2 Teilnehmer = ×1,6 bei Standardwerten),
- `!give` als gemeinsame Abzug-/Gutschrift-Buchung,
- negative Übertragung, Selbstübertragung und Überziehung verändern kein Guthaben,
- technischer Neustart erstattet reservierte Einsätze einer laufenden Runde,
- Rundenabschluss und Auszahlung im erzwungenen Szenario „alle bestehen“,
- einmalige Admin-Erstattung eines verlorenen Einsatzes; Wiederholung erzeugt keine zweite Gutschrift,
- Gesamtreset setzt alle Konten auf 0,
- Startguthaben-Markierung und Verlauf des täglichen Bonus bleiben beim Reset erhalten,
- automatische lokale Sicherung vor dem Reset wird angelegt,
- Runden aus einer früheren Reset-Generation können danach nicht mehr erstattet werden,
- WebSocket-Handshake mit gültigem Nur-Lesen-Schlüssel und vollständige Anfangssynchronisierung des Status.

Die automatischen Tests liegen unter `tests/` und laufen mit `node --test tests/*.test.js`.
