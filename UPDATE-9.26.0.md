# Update 9.26.0 – Automatische Updates auch für andere Betreiber

## Neu
- **Update-Werkzeug 1.9.0:** Betrieb ohne GitHub-Token aus dem öffentlichen Repository. `launcher.py init` legt `deploy/work/` selbst an, trägt `token_file` nur ein, wenn es angegeben ist, und übernimmt `services`, `db_container`, `db_user` und `db_name` aus der `compose.yaml`.
- Klare Meldungen bei GitHub-Abfragelimit (ohne Token 60 Abfragen pro Stunde), 404 und 401; `status` nennt die Quelle (mit/ohne Token).
- Anleitung für Betreiber: `tools/deploy/UPDATER-EINRICHTEN.md`, verlinkt aus `tools/compose/INSTALLATION.md`.
- Das öffentliche Release enthält zusätzlich das Startpaket `bwk-updater-start-v1.9.0.zip`.

## Bestandsinstallation
- Keine Änderung an Programm, Datenbank oder `compose.yaml`.
- Das Werkzeug 1.9.0 wird per Selbstupdate über die Startdatei eingespielt; eine vorhandene `config.json` (privates Repository mit Token) bleibt unverändert.
