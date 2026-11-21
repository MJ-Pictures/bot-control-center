# Sicherheit

## Unterstützte Versionen

Sicherheitskorrekturen gibt es nur für das **neueste Release**. Bitte aktualisiere vor einer Meldung auf den aktuellen Stand und prüfe, ob das Problem dort noch auftritt.

## Schwachstellen melden

Melde Sicherheitslücken **nicht öffentlich** (keine Issues, keine Pull Requests, keine Beiträge in Chats). Nutze stattdessen die Kontaktmöglichkeiten im Impressum des Lizenzgebers: https://www.mj-pictures.de/Kontakt-Impressum – Betreff „Sicherheitslücke Bot Control Center“.

Hilfreich sind:

- betroffene Version (Datei `VERSION`) und Art des Betriebs (NAS, Server, Docker Desktop),
- eine kurze Beschreibung und die Schritte zum Nachstellen,
- die vermutete Auswirkung (zum Beispiel Zugriff ohne Anmeldung, Rechteausweitung, Datenabfluss),
- keine echten Zugangsdaten, Tokens oder Daten Dritter im Bericht.

Der Lizenzgeber bemüht sich, Meldungen zeitnah zu prüfen und zu beantworten. Feste Fristen können nicht zugesagt werden. Bitte gib ihm angemessen Zeit für eine Korrektur, bevor du Einzelheiten veröffentlichst.

## Erlaubte Prüfung

Die Untersuchung der Software auf Sicherheitslücken ist an **eigenen** oder ausdrücklich dafür freigegebenen Installationen gestattet (siehe Ziffer 13 der Lizenz). Greife keine fremden Installationen, keine Dienste Dritter (Twitch, Discord, GitHub) und keine Daten anderer Personen an.

## Härtung im Betrieb

Empfehlungen für den Betrieb stehen in [`SECURITY-HARDENING.md`](SECURITY-HARDENING.md), die zugehörigen Prüfungen in [`SECURITY-TESTS.md`](SECURITY-TESTS.md). Kurz:

- Zugangsdaten nur als Dateien im Ordner `secrets/` (Modus 400), nie in Compose-Dateien, Chats oder Repositories.
- `INTERNAL_SERVICE_SECRET` in allen Diensten gleich, mindestens 32 zufällige Zeichen.
- Das Control Center nur über https und einen Reverse-Proxy erreichbar machen; nur dessen Ports nach außen öffnen.
- Regelmäßig aktualisieren und vor jedem Update die Datei `UPDATE-<Version>.md` lesen.
- Datenbank und Einstellungen regelmäßig sichern (`scripts/`, Administration → Backup / Restore).
