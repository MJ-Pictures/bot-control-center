# Changelog

Seit Control Center 8.12.0 hat der MCP-Server keine eigene Versionsnummer mehr: Er ist ein Dienst des Control Centers (`mcp-app/`, Container `bcc-mcp`) und meldet dessen Version. Änderungen stehen ab dann im Changelog des Control Centers. Die Einträge unten sind der Stand bis 1.6.0.

## Control Center 9.0.0
- Die Namen des früheren Ein-Container-Betriebs sind aus den Freigaben entfernt: Health-Abfragen gehen nur noch an `web`/`bcc-web`/`twitch`/`bcc-twitch` und `discord`/`bcc-discord`; erreichbar ist der Dienst als `mcp:3100` und `bcc-mcp:3100` (nicht mehr `bwk-mcp:3100`).

## Control Center 8.12.0
- Der MCP-Server wird mit dem Update-ZIP ausgeliefert und über die Updates-Seite aktualisiert (kein eigener Ordner, kein Neubau von Hand mehr).
- **Rein lesend:** Die Update-Funktionen `stage_update_chunk`, `validate_update`, `request_deployment`, `request_rollback` und `get_deployment_status` sind entfernt; Updates laufen ausschließlich über das Pull-Deployment. Der Container hat keine Schreib-Mounts mehr.
- Geheimnisse als Dateien (`MCP_TOKEN_FILE`, `PGPASSWORD_FILE`), wie bei den anderen Diensten; die Angabe direkt in der Umgebung bleibt möglich.
- `TWITCH_HEALTH_HOST` ist nicht mehr auf eine feste Domain begrenzt (jeder gültige Hostname; er wird nur als Host-Header an die freigegebenen internen Adressen gesendet).
- Erreichbar im Docker-Netz als `mcp:3100` und `bcc-mcp:3100` (der bisherige Name `bwk-mcp:3100` bleibt erlaubt). Standard für die Datenbank ist `db`.

## 1.6.0
- Der MCP-Server liegt jetzt im Git-Repository (`tools/mcp/`) und wird bei jedem Release mitgeprüft (Tests im Control-Center-Testlauf). Er ist **nicht** Teil des Update-ZIPs und wird weiter getrennt betrieben und von Hand neu gebaut.
- `get_bot_health`: erlaubte Hosts für die Health-Abfragen um die Namen des getrennten Betriebs erweitert (`web`, `bcc-web`, `twitch`, `bcc-twitch`, `discord`, `bcc-discord`); die alten Namen bleiben erlaubt. Der Standardwert für `DISCORD_HEALTH_URL` ist jetzt `http://discord:3001/health` (vorher `discordbot`).
- Neu: `.env.example` ohne Werte; `README.md` mit Hinweisen zum getrennten Betrieb und zur Ordnerzuordnung Repository ↔ NAS.
- Die Versionsnummer 1.6.0 gilt für das gesamte Paket (MCP-Server und Deploy-Werkzeug). `bwk_deploy.py`, `bwk_pull.py` und `make_release_manifest.py` sind inhaltlich unverändert (`bwk_deploy.py --version` zeigt weiter 1.5.0).
- Unverändert: alle MCP-Tools, SQL-Views, Docker-Mounts, Netz, Sicherheitseinstellungen des Containers.

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
