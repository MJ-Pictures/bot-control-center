# Changelog

## 1.9.0
- **Betrieb ohne Token** (öffentliches Repository, Stufe 3 der Verteilung): Fehlt `token_file` in `config.json`, fragt das Werkzeug GitHub ohne Anmeldung ab. Für das eigene private Repository ändert sich nichts.
- `init`: trägt `token_file` nur ein, wenn es angegeben ist; legt unter der Startdatei den Arbeitsordner `deploy/work/` selbst an (`--work` nicht nötig); lässt `project`/`compose` dort leer (Standard: Ordner über der Startdatei) und liest `services`, `db_container`, `db_user`, `db_name` aus der `compose.yaml` (Vorlage: `web`, `twitch`, `discord`, `mcp`, `bcc-db`). Eine vorhandene `config.json` bleibt unverändert.
- Verständliche Meldungen: GitHub-Abfragelimit (403/429, ohne Token 60 Abfragen pro Stunde), 404 ohne Token (Hinweis auf privates Repository), 401 (Token ungültig).
- `status` nennt die Quelle (`mit Token` bzw. `ohne Token, öffentliches Repository`).
- Startpaket (`make_tools_package.py --starter`) enthält zusätzlich `UPDATER-EINRICHTEN.md`; das öffentliche Release hängt das Startpaket an.
- Neue Anleitung für Betreiber: `UPDATER-EINRICHTEN.md`. Die Startdatei `launcher.py` ist unverändert (Fassung 1).

## 1.8.0
- Neuer erlaubter Ordner im Update-ZIP: `mcp-app/` (MCP-Zugang als Dienst des Control Centers, ab Control Center 8.12.0).
- **Arbeitsordner im Projektordner:** Unter der Startdatei ist `--work` nicht mehr nötig; Standard ist `<Ordner der Startdatei>/work` (kein Symlink). Der Aufruf im Aufgabenplaner lautet dann nur noch `launcher.py run`. Eine ausdrückliche Angabe hat weiter Vorrang; ohne Startdatei bleibt `--work` Pflicht.
- `config.json`: `token_file` darf relativ zum Ordner `pull/` angegeben werden; `project` und `compose` haben unter der Startdatei einen Standard (der Ordner über ihr und dessen `compose.yaml`).
- Die Logzeile „Starte Installation …“ nennt die Fassung des Werkzeugs.
- Die Startdatei `launcher.py` ist unverändert (Fassung 1).
- Erstes Werkzeug, das über das Selbstupdate kommt (von 1.7.0 aus, zusammen mit Control Center 8.12.0).
- Tests: 108 (55 in `test_bwk_pull.py`, 53 in `test_launcher.py`).
- Berichtigung zur Anleitung 1.7.0: Ob der Aufgabenplaner die Startdatei benutzt, zeigt nicht `pull.log`, sondern `approvals/updater.json` (`updated_at` läuft alle 5 Minuten weiter).

## 1.7.0
- Neu: **Startdatei `launcher.py`**. Der Aufgabenplaner ruft künftig immer sie auf; sie startet die aktive Fassung des Werkzeugs aus `versions/<Fassung>/`. Sie wird vom Werkzeug nie ersetzt und greift nie aufs Netz zu.
- Neu: **Selbstupdate des Werkzeugs.** Ein Release kann eine neuere Fassung mitbringen (Anhang `bwk-tools-vX.Y.Z.zip`, Eintrag `tools` im Manifest). Ablauf:
  1. Beim Prüfen des Releases wird das Paket nur geladen und geprüft (SHA256 und Größe aus dem Manifest, genau drei Dateien, Fassungsnummer, gültiges Python) – nichts daraus wird ausgeführt.
  2. Erst mit der Freigabe des Releases wird die neue Fassung neben die aktive gelegt (Ergebnis `tools-pending`).
  3. Im nächsten Lauf führt die Startdatei den Selbsttest der neuen Fassung aus und schaltet um; die neue Fassung installiert dann das Release.
  4. Besteht die neue Fassung den Selbsttest nicht oder bricht ihr erster Lauf ab, bleibt bzw. wird die bisherige Fassung aktiv; die fehlgeschlagene wird vermerkt und nicht erneut versucht. Das Control Center wird dann mit der bisherigen Fassung installiert, sofern das ZIP sie nicht voraussetzt.
- Braucht ein ZIP die neue Fassung (z. B. ein neuer erlaubter Ordner), wird die Dateiprüfung nach dem Wechsel nachgeholt – immer vor jeder Änderung.
- Neu: `bwk_pull.py selftest` (ohne Docker, Netz und Konfiguration), `approvals/updater.json` (Stand des Werkzeugs für die Oberfläche), `make_tools_package.py` (Paketbau im Release-Workflow, mit `--starter` das Startpaket für die Ersteinrichtung).
- `make_release_manifest.py`: Option `--tools-zip`; `status` zeigt die Fassung des Werkzeugs und den Stand der Startdatei.
- Ein unerwarteter Abbruch von `bwk_pull.py` endet jetzt mit Code 70 (bisher 1), damit die Startdatei ihn von gewöhnlichen Fehlern unterscheiden kann.
- Ohne Startdatei (bisheriger Aufruf von `bwk_pull.py`) ändert sich nichts; ein mitgeliefertes Werkzeug wird dann nicht automatisch eingespielt.
- Tests: 102 (55 bisherige, 47 neue in `test_launcher.py`).
- Einrichtung: `UPGRADE-1.7.0.md`. Unverändert: MCP-Server (1.6.0, kein Neubau nötig), Freigabe, Dateiformate der Hinweise und Ergebnisse (nur zusätzliche Felder).

## 1.6.0
- Paketnummer für Deploy-Werkzeug **und** MCP-Server. Der MCP-Server (`tools/mcp/`) liegt jetzt im Repository und meldet ebenfalls 1.6.0; Einzelheiten siehe `tools/mcp/CHANGELOG.md`.
- `bwk_deploy.py`, `bwk_pull.py`, `make_release_manifest.py`, `test_bwk_pull.py`: unverändert gegenüber 1.5.0 (`bwk_deploy.py --version` zeigt 1.5.0).
- Die Werkzeug-Dateien liegen nur einmal im Repository (`tools/deploy/`), nicht zusätzlich unter `tools/mcp/deploy/`.

## 1.5.0
- `deploy/bwk_deploy.py`: Die Dienste, die beim Einspielen gestoppt und neu gestartet werden, sind einstellbar (`--services`, kommagetrennt). Standard wie bisher `twitchbot,discordbot`. Der Name des Datenbank-Containers (`--db-container`) wird jetzt geprüft.
- `deploy/bwk_pull.py`: liest `services` (Liste) und `db_container` aus `deploy-work/pull/config.json` und gibt sie an `bwk_deploy.py` weiter. Fehlt `services`, gilt der bisherige Standard; eine bestehende `config.json` muss nicht geändert werden.
- Dienst- und Containernamen werden streng geprüft (nur Buchstaben, Ziffern, `-`, `_`; kein führender Bindestrich; höchstens 8 Dienste), weil sie als Argumente an `docker` übergeben werden. Fehlt ein eingestellter Dienst in der `compose.yaml`, bricht das Werkzeug vor jeder Änderung ab.
- Neuer erlaubter Ordner im Update-ZIP: `twitch-app/` (für den künftigen eigenen Twitch-Bot-Container).
- `bwk_deploy.py --version` zeigt die Werkzeug-Version.
- Tests: 55 (bisher 47), darunter Vertragstests mit eigener Dienstliste, fehlendem Dienst und nicht startendem Dienst (Rollback).
- Unverändert: Ablauf, Dateiformate, Freigabe, MCP-Server-Code, `make_release_manifest.py`. Zweck: Vorbereitung auf die Trennung von Weboberfläche und Twitch-Bot (neue Dienstnamen), ohne dass sich jetzt etwas ändert.

## 1.4.0
- Neu: `deploy/bwk_pull.py` (Pull-Deployment, Phase 1). Fragt GitHub ausgehend ab (alle 5 Minuten per Aufgabenplaner), lädt neue Releases (ZIP + `release-manifest.json`), prüft SHA256, Manifest und Tiefenprüfung, schreibt Hinweise nach `deploy-work/approvals/` und installiert nach Freigabe über das unveränderte `bwk_deploy.py`.
- Freigabe nur für genau das geprüfte ZIP (SHA256), 24 Stunden gültig, einmalig; vorerst per Befehl `approve`/`reject`, Discord und Control Center folgen in Phase 2.
- Neu: `deploy/make_release_manifest.py` erzeugt das Release-Manifest und setzt `auto_deploy: false` bei Änderungen an `compose.yaml`, `docker/*`, `package.json`, `package-lock.json`, bei `--db-migration` oder `--manual-reason`.
- Neu: `deploy/test_bwk_pull.py` (47 Tests gegen simulierten GitHub-Server, davon ein Vertragstest mit dem echten `bwk_deploy.py` und einer Docker-Attrappe).
- Neu: `PULL-DEPLOYMENT.md` (Einrichtung, Bedienung, Dateiformate, Sicherheit).
- Unverändert: `bwk_deploy.py`, MCP-Server-Code (`server.mjs`, weiter 1.3.3), `compose.yaml`, SQL-Views, Control Center. Ein Neubau des MCP-Containers ist nicht nötig. Die Versionsnummer 1.4.0 bezeichnet das Deploy-Paket.

## 1.3.3
- Deployment-Anfrage wird nach Erfolg oder Fehler mit eindeutigem Endzustand aktualisiert.
- Resultat hat Vorrang vor älterem Anfrage-Status.
- Exklusiver Host-Dateilock gegen parallele Deploy-/Rollback-Vorgänge.
- Persistenter Startmarker verhindert unbemerkte Wiederholung nach Unterbrechung.
- Rollback wird ebenfalls als abgeschlossen/fehlgeschlagen dokumentiert und nicht doppelt ausgeführt.
- MCP-Tool `get_deployment_status` zeigt `effective_status` und `processing`.

## 1.3.2
- Host-Deployment erhält bei ersetzten Dateien vorhandene Unix-Modi und Eigentümer, insbesondere Ausführungsrechte von Shell-Skripten.
- Keine Änderung am MCP-Netzwerk, den SQL-Views oder der produktiven Compose-Konfiguration.

## 1.3.1
- Geschützte Compose-Dateien im Control-Center-Archiv werden bei der Host-Validierung explizit übersprungen und niemals übertragen.
- Keine Änderung an SQL-Views, Docker-Mounts, produktiven Diensten oder Secrets.
- Getestet mit vollständigem Control-Center-Archiv v8.6.5 (161 zugelassene Dateien).

# Changelog

## 1.3.0
- 13 bisherige MCP-Tools aus 1.2.2 beibehalten.
- Neue MCP-Tools: `stage_update_chunk`, `validate_update`, `request_deployment`, `request_rollback`, `get_deployment_status`.
- Sichere, explizite NAS-seitige Deployment-/Rollback-Freigabe über `deploy/bwk_deploy.py`.
- Host-seitige ZIP-/CRC-/Pfadprüfung, SHA256-Abgleich, Dateibackup und PostgreSQL-Dump vor Änderungen.
- MCP-Container erhält ausschließlich Schreibrechte auf `deploy-work/staging` und `deploy-work/requests`, **nicht** auf produktiven Code, Backups oder Docker-Socket.
- Produktive `compose.yaml` und `.env` bleiben unverändert.

## 1.2.2
- Node.js-HTTP-Client für Twitch-Healthcheck mit explizitem, geprüftem Host-Header.
