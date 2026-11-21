# Update-Werkzeug 1.7.0 einrichten: Startdatei und Selbstupdate (einmalig, von Hand)

Dauer etwa 10 Minuten. Control Center, Bots, Datenbank und MCP-Server laufen währenddessen weiter.
Ab dann kommt das Werkzeug mit den Releases und muss nicht mehr von Hand getauscht werden.

**Was sich ändert:** Der Aufgabenplaner ruft nicht mehr `bwk_pull.py` direkt auf, sondern die Startdatei
`launcher.py` im Projektordner. Der Arbeitsordner (`deploy-work` mit Sicherungen, Freigaben, Token und
`config.json`) bleibt, wo er ist.

## 1. Startpaket in den Projektordner legen
`bwk-updater-start-v1.7.0.zip` entpacken und den Ordner `deploy` in den Projektordner kopieren, so dass es
`/volume2/docker/bcc/deploy/launcher.py` gibt. Inhalt:

```
deploy/launcher.py
deploy/state.json
deploy/UPGRADE-1.7.0.md
deploy/versions/1.7.0/bwk_pull.py
deploy/versions/1.7.0/bwk_deploy.py
deploy/versions/1.7.0/make_release_manifest.py
```

## 2. Rechte setzen und prüfen (SSH)
```bash
PROJECT='/volume2/docker/bcc'
WORK='/volume1/@appdata/ContainerManager/all_shares/docker/bwk-mcp/deploy-work'
PY='/var/packages/python314/target/bin/python3.14'

sudo chown -R root:root "$PROJECT/deploy"
sudo chmod -R u=rwX,go=rX "$PROJECT/deploy"

sudo "$PY" "$PROJECT/deploy/versions/1.7.0/bwk_pull.py" selftest
sudo "$PY" "$PROJECT/deploy/launcher.py" --work "$WORK" status
```
Erwartet: Der Selbsttest endet mit `{"ok": true, "version": "1.7.0", "problems": []}`. `status` zeigt die
produktive Version und die Zeile `Update-Werkzeug: 1.7.0 (Startdatei aktiv; …)`.

## 3. Aufgabenplaner umstellen
Aufgabe „BWK Pull-Deployment“ (Benutzer root, alle 5 Minuten) – neuer Befehl:

```bash
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH
/var/packages/python314/target/bin/python3.14 '/volume2/docker/bcc/deploy/launcher.py' --work '/volume1/@appdata/ContainerManager/all_shares/docker/bwk-mcp/deploy-work' run
```
Nur der Pfad des Skripts ändert sich; `--work` bleibt unverändert.

## 4. Prüfen
- Aufgabe einmal von Hand ausführen oder 5 Minuten warten.
- Control Center → Updates: Karte „Update-Werkzeug“ zeigt „Fassung 1.7.0 · Startdatei aktiv“ (ab Control Center 8.11.0).
- `sudo grep updated_at "$WORK/approvals/updater.json"` zeigt eine Zeit (UTC), die alle 5 Minuten weiterläuft. Die Datei schreibt nur das neue Werkzeug bei einem `run`; `pull.log` unterscheidet altes und neues Werkzeug nicht.

## Rückweg
Im Aufgabenplaner den alten Befehl wieder eintragen (`…/bwk-mcp/deploy/bwk_pull.py --work … run`). Das bisherige
Werkzeug 1.5.0 bleibt dafür im MCP-Ordner liegen. Der Ordner `deploy` im Projektordner kann dann gelöscht werden.

## Notfall
- Aktiven Stand ansehen: `sudo "$PY" "$PROJECT/deploy/launcher.py" --launcher-info`
- Auf eine bestimmte Fassung zurück: in `deploy/state.json` den Wert `current` auf die gewünschte Fassung setzen
  (sie muss unter `deploy/versions/` liegen), `pending` und `trial` auf `null`.
- Eine bestimmte Fassung direkt starten: `sudo "$PY" "$PROJECT/deploy/versions/<Fassung>/bwk_pull.py" --work "$WORK" status`

## Hinweise
- Der Ordner `deploy` wird von keinem Container eingebunden und von keinem Update-ZIP verändert.
- Werkzeug-Updates sind Programme, die als root auf der NAS laufen. Sie werden nie automatisch eingespielt,
  sondern nur zusammen mit dem Release, das du freigibst; im Hinweis steht dann „Enthält ein Werkzeug-Update“.
