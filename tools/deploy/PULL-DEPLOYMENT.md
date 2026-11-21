# Pull-Deployment (Deploy-Werkzeug, Stand 1.8.0)

Neues Host-Werkzeug `deploy/bwk_pull.py`: Die NAS fragt GitHub **ausgehend** nach neuen Releases, lädt und prüft sie und **meldet** sie. Installiert wird erst nach deiner ausdrücklichen Freigabe, und zwar vom bestehenden `bwk_deploy.py` (Backup, pg_dump, Austausch, Neustart, automatischer Datei-Rollback bei Fehler). Es wird kein Port geöffnet.

**Was Phase 1 kann:** Releases finden, laden, prüfen (SHA256, Manifest, Tiefenprüfung), Hinweise schreiben, Freigabe/Ablehnung per Befehl, Installation nach Freigabe, Ergebnisdatei schreiben.
**Was erst Phase 2 bringt:** Freigabe per Discord-Button und Seite „Updates“ im Control Center. Bis dahin gibst du per Befehl auf der NAS frei (wie bisher per SSH, nur kürzer).
**Nichts ändert sich** an Control Center, `compose.yaml`, MCP-Server oder Datenbank. `bwk_deploy.py` bleibt unverändert.

## 1. Einmalige Einrichtung auf der NAS

Pfade wie bisher (Anpassen, falls deine abweichen):

```bash
MCP='/volume1/@appdata/ContainerManager/all_shares/docker/bwk-mcp'
CONTROL='/volume2/docker/bcc'
PY=/var/packages/python314/target/bin/python3.14
```

**a) Dateien kopieren** (aus dem ZIP in `bwk-deploy-v1.4.0/deploy/` nach `$MCP/deploy/`):

```bash
sudo cp bwk_pull.py make_release_manifest.py test_bwk_pull.py "$MCP/deploy/"
sudo chown root:root "$MCP/deploy/bwk_pull.py" "$MCP/deploy/make_release_manifest.py" "$MCP/deploy/test_bwk_pull.py"
sudo chmod 755 "$MCP/deploy/bwk_pull.py"
```

`bwk_deploy.py` **nicht** ersetzen. Das MCP-Paket (`server.mjs`, `compose.yaml`) wird in Phase 1 nicht angefasst, ein Neubau von `bwk-mcp` ist nicht nötig.

**b) Selbsttest** (ändert nichts am Produktivsystem, nutzt temporäre Ordner und eine Docker-Attrappe, dauert etwa 40 Sekunden; nutzt dein echtes `bwk_deploy.py`):

```bash
cd "$MCP/deploy" && sudo "$PY" -m unittest test_bwk_pull 2>&1 | tail -5
```

Erwartet: `OK`. Bitte die letzten Zeilen zurückmelden.

**c) GitHub-Lesetoken anlegen** (nur lesend, nur dieses Repository):
GitHub → Profilbild → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
- Resource owner: dein Konto; Expiration: z. B. 1 Jahr (Erinnerung im Kalender setzen)
- Repository access: **Only select repositories** → `bwk-control-center-app`
- Permissions → Repository permissions → **Contents: Read-only** (Metadata: Read-only kommt automatisch). Sonst nichts.

**d) Token ablegen** (nie im Chat zeigen). Das folgende Kommando fragt den Token unsichtbar ab:

```bash
sudo mkdir -p "$MCP/deploy-work/pull"
sudo bash -c 'umask 177; read -rsp "Token: " T; printf %s "$T" > "$1"; echo' _ "$MCP/deploy-work/pull/github_token"
sudo ls -l "$MCP/deploy-work/pull/github_token"    # erwartet: -rw------- root root
```

**e) Verzeichnisse und Konfiguration anlegen:**

```bash
sudo "$PY" "$MCP/deploy/bwk_pull.py" --work "$MCP/deploy-work" \
  --project "$CONTROL" --compose "$CONTROL/compose.yaml" \
  --token-file "$MCP/deploy-work/pull/github_token" init
sudo cat "$MCP/deploy-work/pull/config.json"
```

`config.json` enthält `repo` (`MJ-Pictures/bot-control-center`), `token_file`, `project`, `compose`, `db_container`, `db_user`, `db_name`. Alles prüfen; Datenbank-Werte nur ändern, wenn sie bei dir anders heißen.

Ab 1.5.0 optional: `services` (Liste der Compose-Dienste, die beim Einspielen gestoppt und neu gestartet werden). Fehlt der Eintrag, gilt wie bisher `["twitchbot", "discordbot"]`. Erst ändern, wenn die Dienste in der `compose.yaml` umbenannt werden, zum Beispiel:

```json
"services": ["web", "twitch", "discord"],
"db_container": "bcc-db"
```

Nennt `services` einen Dienst, den die `compose.yaml` nicht kennt, bricht das Werkzeug vor jeder Änderung ab.

**f) Probelauf von Hand:**

```bash
sudo "$PY" "$MCP/deploy/bwk_pull.py" --work "$MCP/deploy-work" run
```

Erwartet, solange kein neueres Release existiert: `Kein neueres Release (produktiv 8.9.8)` oder `Keine Änderung bei GitHub`. Fehler wie `HTTP 401`/`404` weisen auf Token, Repository-Name oder fehlende Berechtigung hin.

**g) Aufgabenplaner (erst nach erfolgreichem Probelauf):**
DSM → Systemsteuerung → Aufgabenplaner → Erstellen → Geplante Aufgabe → Benutzerdefiniertes Skript.
- Benutzer: **root**; Name: `BWK Pull-Deployment`
- Zeitplan: täglich, **Wiederholung alle 5 Minuten**, Letzte Ausführung 23:55
- Skript (der `PATH` ist wichtig, damit `docker` im Aufgabenplaner gefunden wird):

```bash
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH
/var/packages/python314/target/bin/python3.14 '/volume1/@appdata/ContainerManager/all_shares/docker/bwk-mcp/deploy/bwk_pull.py' --work '/volume1/@appdata/ContainerManager/all_shares/docker/bwk-mcp/deploy-work' run
```

Das Werkzeug führt selbst Protokoll (`deploy-work/pull/pull.log`, Rotation bei 1 MiB). Ein belegter Lauf (Sperre) beendet sich ohne Fehler.

## 2. Alltag

```bash
PULL="sudo $PY $MCP/deploy/bwk_pull.py --work $MCP/deploy-work"
$PULL status                                   # Stand: offene Anfragen, Ergebnisse
$PULL approve 8.9.9 --confirm 8.9.9 --by Mario # freigeben
$PULL reject  8.9.9 --confirm 8.9.9 --by Mario # ablehnen
```

1. Der Entwickler baut das Release und nennt dir die **SHA256** auf einem zweiten Kanal (zum Beispiel im Chat).
2. Innerhalb von etwa 5 Minuten erscheint das Release unter `status` als `awaiting-approval` mit kurzem Hash. **Vergleiche den Hash mit dem aus dem Chat.**
3. `approve …` schreibt die Freigabe. Beim nächsten Lauf (≤ 5 Minuten) installiert das Werkzeug. Sofort: `$PULL run` von Hand.
4. Ergebnis unter `status` bzw. in `deploy-work/approvals/results/<Version>.json`.

Eine Freigabe gilt **nur für genau diese Datei** (SHA256), **24 Stunden** und **einmal**. Neuere Versionen ersetzen offene ältere. Muss ein Release manuell installiert werden (Status `manual-required`), steht der Grund im Hinweis; dann wie bisher per `bwk_deploy.py`.

**Statuswerte** (Hinweis in `approvals/pending/`, Ergebnis in `approvals/results/`):

| Status | Bedeutung |
|---|---|
| `awaiting-approval` | geprüft, wartet auf deine Freigabe |
| `manual-required` | geprüft, aber Compose/Docker/Abhängigkeiten/Migration betroffen: nur manuell |
| `check-failed` | Prüfung fehlgeschlagen (Grund im Hinweis); es wird nichts installiert, nächste Versionsnummer nötig |
| `deploying` / `deployed` | Installation läuft / erfolgreich |
| `failed-rolled-back` | Fehler, Dateien automatisch zurückgesetzt |
| `failed-manual-recovery-required` | Fehler oder Abbruch, **manuell prüfen** (Backup-ID im Ergebnis) |
| `not-started` | Installation startete nicht (z. B. Sperre belegt); Freigabe war verbraucht, einfach erneut freigeben |
| `approval-expired` / `approval-invalid` | Freigabe abgelaufen bzw. unzulässig; erneut freigeben |
| `rejected` / `superseded` | abgelehnt / durch neuere Version ersetzt |

Ein fehlgeschlagenes Release verbraucht seine Versionsnummer (wie bisher). Rollback weiter per `bwk_deploy.py rollback … --confirm`.

## 3. Release veröffentlichen (Seite des Entwicklers)

Pro Release entstehen auf GitHub ein **Release `vX.Y.Z`** (kein Entwurf, keine Vorabversion) mit genau zwei Dateien:
- `bwk-control-center-vX.Y.Z.zip` (dasselbe ZIP, das du bisher bekommst, unverändert)
- `release-manifest.json`, erzeugt mit

```bash
python3 deploy/make_release_manifest.py --zip bwk-control-center-vX.Y.Z.zip --version X.Y.Z \
  --previous-zip bwk-control-center-vVORGAENGER.zip --tests N --summary "Kurztext" --out release-manifest.json
```

Das Skript nutzt dieselbe Prüfung wie die NAS und setzt `auto_deploy: false`, wenn sich `compose.yaml`, `docker/*`, `package.json` oder `package-lock.json` gegenüber dem Vorgänger ändern. Weitere Gründe: `--db-migration`, `--manual-reason "…"`. Ohne Vorgänger-ZIP (`none`) gilt vorsichtshalber „manuell“.

Ob das Release automatisch angelegt werden kann (GitHub-Zugriff in der Arbeitsumgebung), ist vor dem Probelauf zu klären. Rückfall: ZIP und Manifest über „Releases → Draft a new release → Publish“ auf github.com hochladen.

## 4. Sicherheit (kurz)

- Nur ausgehende HTTPS-Verbindungen zu GitHub; Weiterleitungen nur zu `github.com` und `*.githubusercontent.com`; Token geht nur an `api.github.com`, nie an Download-Server.
- Token nur lesend, nur dieses Repository; Datei muss `600` und root gehören, sonst bricht das Werkzeug ab.
- Download nur bis 16 MiB; SHA256 gegen Manifest, danach dieselbe Tiefenprüfung wie bei manueller Installation (Pfade, Symlinks, Allowlist, Größen, CRC, `VERSION` im ZIP).
- Freigabedateien: keine Symlinks, höchstens 16 KiB, strenge Felder, 24 Stunden, einmalig, SHA256-gebunden; vor der Installation wird das ZIP erneut gehasht.
- `compose.yaml`, `secrets/`, `data/`, `discord-data/`, `postgres-data/`, `backups/` werden nie berührt (Allowlist in `bwk_deploy.py`).
- Restrisiko: Wer dein GitHub-Konto **und** deine Freigabe-Möglichkeit übernimmt, könnte ein Schad-Release freigeben. Deshalb: 2FA am GitHub-Konto, Hash im Chat abgleichen.

## 5. Dateiformate (für Phase 2: Discord und Control Center)

`approvals/pending/<Version>.json` (schreibt der Host): `schema`, `version`, `status`, `approvable`, `sha256`, `sha256_short`, `production_version`, `created_at`, `size`, `files_count`, `tests`, `manual_reasons`, `summary`, `files` (bis 300), `files_total`, `release_url`, `published_at`, `error`.

`approvals/granted/<Version>.json` (schreibt Discord/Control Center/CLI):
```json
{"version": "8.9.9", "sha256": "<64 Hex>", "approved_by": "Mario", "via": "discord", "approved_at": "2026-11-12T22:00:00.000Z"}
```
`via`: `discord`, `control-center` oder `cli`. Ablehnung: gleiche Felder ohne `sha256` in `approvals/rejected/<Version>.json`.

`approvals/results/<Version>.json`: `version`, `sha256`, `status`, `message`, `by`, `via`, `at`, optional `backup_id`.
`approvals/used/`: verbrauchte Freigaben (Protokoll).

## 5a. Startdatei und Selbstupdate (ab Werkzeug 1.7.0)

Aufbau (Ordner `deploy/` im Projektordner; Einrichtung: `UPGRADE-1.7.0.md`):

| Pfad | Zweck |
|---|---|
| `launcher.py` | Startdatei. Der Aufgabenplaner ruft immer sie auf. Wird nie vom Werkzeug ersetzt, kein Netzzugriff. |
| `state.json` | `current` (aktive Fassung), `previous` (Rückfall), `pending` (freigegeben, noch nicht aktiv), `trial` (erster Lauf läuft), `failed` (fehlgeschlagene Fassungen), `last_switch`, `last_fallback`. |
| `versions/<x.y.z>/` | `bwk_pull.py`, `bwk_deploy.py`, `make_release_manifest.py` einer Fassung. |

Release-Seite: Der Workflow hängt `bwk-tools-vX.Y.Z.zip` an und trägt es als `tools` (`version`, `zip`, `sha256`, `size`) ins Manifest ein. Ist die Fassung nicht neuer als die aktive, wird das Paket nicht einmal geladen.

Zusätzliche Felder (nur der Host schreibt):
- Hinweis `pending/<x.y.z>.json`: `tools_update` (`version`, `from`, `sha256`, `size`, `mode` = `auto` oder `manual`, bei `manual` ein `reason`) und `deep_check_deferred` (Dateiprüfung folgt mit der neuen Fassung nach der Freigabe).
- Ergebnis `results/<x.y.z>.json`: Status `tools-pending` (Werkzeug bereitgelegt, Installation folgt im nächsten Lauf) mit `tools_version`.
- `approvals/updater.json`: `tool_version`, `launcher`, `current`, `previous`, `pending`, `failed`, `last_switch`, `last_fallback`, `warnings`.

Ab 1.8.0 liegt der Arbeitsordner im Projektordner (`deploy/work/` mit `approvals`, `backups`, `pull`, `staging`); der Aufgabenplaner ruft nur noch `launcher.py run` auf. Die Weboberfläche bindet `./deploy/work/approvals` als `/approvals` ein. Ob der Aufgabenplaner die Startdatei benutzt, zeigt `approvals/updater.json` (`updated_at` läuft weiter).

Vereinbarungen zwischen Startdatei und Werkzeug (gelten für alle künftigen Fassungen):
- Globale Optionen stehen vor dem Befehl und haben immer einen Wert.
- `bwk_pull.py selftest` braucht keine Konfiguration und gibt als letzte Zeile JSON mit `ok` und `version` aus.
- Ein unerwarteter Abbruch endet mit Code 70. Gewöhnliche Fehler (Code 1) gelten nicht als defektes Werkzeug.
- Umgeschaltet wird nur bei `run`, unter der Sperre der Startdatei, nie während einer Installation.

## 6. Außerbetriebnahme

Aufgabe im Aufgabenplaner deaktivieren. Alles andere bleibt unberührt; die manuelle Installation per `bwk_deploy.py` funktioniert unverändert weiter.
