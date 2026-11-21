# Automatische Updates einrichten (Update-Werkzeug)

Mit dem Update-Werkzeug holt sich deine Installation neue Versionen selbst von GitHub, prüft sie und **meldet** sie unter Administration → Updates. Installiert wird erst, wenn du dort freigibst. Das Werkzeug läuft auf dem Rechner, auf dem Docker läuft, und fragt GitHub nur **ausgehend** ab; es wird kein Port geöffnet. Ein GitHub-Konto oder Token brauchst du dafür nicht.

Ohne Update-Werkzeug funktioniert alles weiter; Updates spielst du dann von Hand ein (siehe [`INSTALLATION.md`](../compose/INSTALLATION.md), Abschnitt „Sicherung und Updates“).

## Das brauchst du
- Eine fertige Installation nach [`INSTALLATION.md`](../compose/INSTALLATION.md), gestartet aus der dortigen `compose.yaml`-Vorlage. Die Vorlage enthält bereits die Zeile `./deploy/work/approvals:/approvals` beim Dienst `web`; ohne sie zeigt die Seite Updates nichts an.
- **Linux mit Docker** (NAS, eigener Server). Unter Docker Desktop (Windows/Mac) läuft das Werkzeug nicht; dort Updates von Hand einspielen.
- **Python 3.9 oder neuer** auf diesem Rechner (nur die Standardbibliothek). Synology: Paket „Python 3“ aus dem Paketzentrum.
- Root-Rechte (das Werkzeug ruft `docker compose` auf und legt Sicherungen an).

## 1. Startpaket in den Projektordner legen
Auf der Release-Seite der aktuellen Version die Datei `bwk-updater-start-vX.Y.Z.zip` laden und **im Projektordner** entpacken. Danach gibt es dort den Ordner `deploy/`:

```
deploy/launcher.py
deploy/state.json
deploy/UPDATER-EINRICHTEN.md
deploy/versions/X.Y.Z/bwk_pull.py
deploy/versions/X.Y.Z/bwk_deploy.py
deploy/versions/X.Y.Z/make_release_manifest.py
```

`launcher.py` ist die Startdatei. Sie wird nie ersetzt; neuere Fassungen des Werkzeugs kommen später mit den Releases von selbst.

## 2. Rechte setzen und einrichten
```bash
PROJECT=/pfad/zum/projektordner      # z. B. /volume1/docker/bcc oder /opt/bcc
PY=python3                           # Synology z. B. /var/packages/python311/target/bin/python3

sudo chown -R root:root "$PROJECT/deploy"
sudo chmod -R u=rwX,go=rX "$PROJECT/deploy"
sudo "$PY" "$PROJECT/deploy/launcher.py" init
```

`init` legt den Arbeitsordner `deploy/work/` an (Freigaben, Sicherungen, Protokoll) und schreibt `deploy/work/pull/config.json`. Die Dienstnamen und die Datenbank-Werte liest es aus deiner `compose.yaml`; die Ausgabe zeigt, was übernommen wurde. Prüfe:
- `repo`: das Repository, aus dem du das Programm geladen hast.
- `services`: die Programmdienste deiner `compose.yaml` (Vorlage: `web`, `twitch`, `discord`, `mcp`; fehlende Dienste wie `discord` oder `mcp` dürfen nicht drinstehen).
- `db_container`, `db_user`, `db_name`: wie in deiner `compose.yaml` (Vorlage: `bcc-db`, `bwk`, `bwk`).

Eine vorhandene `config.json` wird von `init` nie verändert. Ein Eintrag `token_file` ist nur nötig, wenn du aus einem privaten Repository aktualisierst.

## 3. Prüfen
```bash
sudo "$PY" "$PROJECT/deploy/launcher.py" status
sudo "$PY" "$PROJECT/deploy/launcher.py" run
```
`status` zeigt die laufende Version und `Quelle: … (ohne Token, öffentliches Repository)`. `run` fragt GitHub einmal ab; erwartet ist `Kein neueres Release` oder ein neues Release mit Status `awaiting-approval` bzw. `manual-required`.

## 4. Regelmäßig ausführen
Das Werkzeug soll **alle 5 Minuten als root** laufen.

**Synology:** DSM → Systemsteuerung → Aufgabenplaner → Erstellen → Geplante Aufgabe → Benutzerdefiniertes Skript. Benutzer `root`, Zeitplan täglich, Wiederholung alle 5 Minuten, letzte Ausführung 23:55. Skript (der `PATH` ist nötig, damit `docker` gefunden wird):
```bash
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH
/var/packages/python311/target/bin/python3 /volume1/docker/bcc/deploy/launcher.py run
```
(Python-Pfad und Projektordner an deine anpassen.)

**Linux:** Datei `/etc/cron.d/bot-control-center` mit einer Zeile:
```
*/5 * * * * root /usr/bin/python3 /opt/bcc/deploy/launcher.py run
```

Ob die Aufgabe läuft, zeigt Administration → Updates (Stand des Werkzeugs) oder `deploy/work/approvals/updater.json` (`updated_at` läuft weiter). Protokoll: `deploy/work/pull/pull.log`.

## 5. Updates freigeben
1. Ein neues Release erscheint innerhalb von etwa 5 Minuten unter **Administration → Updates** (nur für den Owner).
2. Den angezeigten Kurz-Hash mit der **SHA256** auf der Release-Seite vergleichen.
3. **Freigeben und installieren.** Der nächste Lauf sichert Dateien und Datenbank, spielt das Update ein und startet die Dienste neu. Bei einem Fehler werden die Dateien automatisch zurückgesetzt.

Eine Freigabe gilt nur für genau diese Datei (SHA256), 24 Stunden und einmal. Steht ein Release auf `manual-required`, nennt der Hinweis den Grund (z. B. geänderte `compose.yaml`-Vorlage oder Docker-Dateien); dann die Hinweise in `UPDATE-<Version>.md` lesen und von Hand einspielen. Freigeben geht auch auf der Kommandozeile:
```bash
sudo "$PY" "$PROJECT/deploy/launcher.py" approve X.Y.Z --confirm X.Y.Z --by DeinName
```

## Gut zu wissen
- **Abfragelimit:** Ohne Token erlaubt GitHub 60 Abfragen pro Stunde je Internetanschluss. Das Werkzeug braucht bei einem Lauf ohne neues Release eine Abfrage; alle 5 Minuten reicht das gut. Wird das Limit trotzdem erreicht, steht das im Protokoll und der nächste Lauf versucht es von selbst wieder.
- **Nie angefasst** werden `compose.yaml`, `secrets/`, `data/`, `discord-data/`, die Datenbankdateien und `backups/`.
- **Sicherheit:** Nur ausgehende HTTPS-Verbindungen zu GitHub; Download höchstens 16 MiB; SHA256 gegen das Manifest und dieselbe Dateiprüfung wie bei einer Installation von Hand.
- **Abschalten:** die geplante Aufgabe deaktivieren bzw. die Cron-Datei löschen. Alles andere bleibt, wie es ist.
- Technische Einzelheiten (Statuswerte, Dateiformate, Startdatei und Selbstupdate): [`PULL-DEPLOYMENT.md`](PULL-DEPLOYMENT.md).
