# V7.0.1 – Security Hardening & Deployment

Diese Version setzt die Befunde der Sicherheitsprüfung vom 17.10.2026 um. Die Sicherheitsmigration ist absichtlich strenger als frühere Updates.

## Vor dem ersten Start zwingend

### 1. Internes Dienstgeheimnis setzen

In `compose.yaml` gibt es **zwei** Einträge `INTERNAL_SERVICE_SECRET`: einen für `twitchbot` und einen für `discordbot`.

Ersetze in **beiden** Diensten den Platzhalter durch **denselben** zufälligen Wert mit mindestens 32 Zeichen.

Beispiel zum lokalen Erzeugen:

```bash
openssl rand -hex 32
```

Den erzeugten Wert nicht im Chat, in Screenshots, Git, Backups oder Dokumentationen veröffentlichen.

Der Platzhalter wird vom Code bewusst als ungültig erkannt. Solange er nicht ersetzt wurde, verweigert der Discord-Dienst Verwaltungsaufrufe des Control Centers.

### 2. Compose-Projekt neu erstellen

`compose.yaml` wurde gehärtet. Ein bloßer Neustart alter Container reicht deshalb nicht.

Geändert wurden unter anderem:

- App-Code-Mounts nur lesbar
- `no-new-privileges`
- alle Linux-Capabilities entfernt
- PID- und RAM-Limits
- privates benanntes Docker-Netz
- zusätzliche Sicherheitsvariablen
- interne Dienstauthentifizierung

Das Projekt nach dem Kopieren der neuen Dateien im Synology Container Manager **neu erstellen / übernehmen**.

### 3. Erneuter Login ist gewollt

V7.0.1 erhöht die interne Session-Sicherheitsrevision. Bereits vor dem Update bestehende Sitzungen werden dadurch absichtlich ungültig.

Nach dem Update müssen sich alle Benutzer erneut anmelden. Das ist kein Fehler.

## Autorisierung

Privilegierte Funktionen verwenden jetzt explizite globale Guards:

- Backup Export / Inspect / Restore: **Owner**
- Benutzerverwaltung: **Admin / Owner**
- Systemstatus und Dienst-Neustart: **Admin / Owner**
- Owner-Ziele besitzen zusätzlichen Schutz

Zusätzlich existiert eine zentrale API-Matrix mit **Default Deny**: neue `/api/`-Routen, die weder einer Capability noch einem expliziten Guard zugeordnet wurden, werden serverseitig abgelehnt.

Eine Domainzugehörigkeit wie `twitch.dashboard.view` genügt nicht mehr als Ersatz für eine konkrete Admin-/Owner-Berechtigung.

## Sitzungen und Rechteentzug

- deaktivierte verwaltete Twitch-Zugänge erhalten keine gespeicherten Privilegien mehr
- sicherheitsrelevante Benutzeränderungen invalidieren betroffene Sitzungen
- Restore der Benutzerverwaltung invalidiert bestehende Sitzungen
- automatisch aus Twitch-Mod-/Discord-Rollen abgeleitete Rechte besitzen nur einen begrenzten Rollen-Snapshot
- Logout löscht die aktive Sitzung serverseitig
- „Alle Sitzungen abmelden“ entfernt alle Sitzungen der aktuellen Identität
- Sessions ohne gültigen Erstellungszeitpunkt oder mit alter Sicherheitsrevision werden abgewiesen

## OAuth

Twitch-, Discord- und Verbindungs-OAuth wurden gehärtet:

- State ist kurzlebig
- State ist einmalig verwendbar
- State-Maps werden begrenzt und bereinigt
- State wird an eine Browser-Transaktion beziehungsweise bei Verbindungen an die konkrete Sitzung gebunden
- PKCE S256 wird in den unterstützten Login-/Verbindungsflows verwendet
- abgelaufene, fremde und wiederverwendete States werden abgelehnt
- OAuth-Starts besitzen ein einfaches Rate-Limit

## Lokaler Admin und Reverse Proxy

`Host` wird **nicht mehr** als LAN-Nachweis verwendet.

LAN-Erkennung erfolgt anhand von IP/CIDR:

```yaml
LOCAL_NETWORK_CIDRS: "192.168.1.0/24,127.0.0.1/32"
```

Proxyheader werden nur akzeptiert, wenn der direkte Peer in `TRUSTED_PROXY_CIDRS` enthalten ist.

`ALLOWED_HOSTS` begrenzt akzeptierte Hostnamen.

### Synology Reverse Proxy – nötige Prüfung

In DSM typischerweise unter **Systemsteuerung → Anmeldeportal → Erweitert → Reverse Proxy** den Eintrag für `bot.example.org` prüfen.

1. **Quelle ausschließlich HTTPS** für die produktive Anwendung verwenden.
2. HTTP auf HTTPS umleiten. Falls die Weiterleitung nicht dort erfolgt, sie am vorgeschalteten Webserver/Router erzwingen.
3. Eingehende Clientwerte für `X-Forwarded-For` und `X-Forwarded-Proto` nicht ungeprüft durchreichen. Der Proxy soll diese Header selbst mit den tatsächlichen Werten setzen/überschreiben.
4. Erst wenn die tatsächliche Peer-IP beziehungsweise das Docker-/Proxy-Netz bekannt ist, `TRUSTED_PROXY_CIDRS` **so eng wie möglich** konfigurieren. Keine pauschalen privaten Netze eintragen, wenn nur eine einzelne Proxy-IP nötig ist.
5. `ALLOWED_HOSTS` auf die wirklich verwendeten Namen/IPs beschränken.
6. Danach lokalen Adminzugang sowohl direkt im LAN als auch über den vorgesehenen Weg testen.

### HSTS

Die Anwendung setzt bei als HTTPS erkannten Requests bereits:

```text
Strict-Transport-Security: max-age=31536000
```

Am Synology/nginx-Edge kann HSTS ebenfalls gesetzt werden. Zunächst **ohne** `includeSubDomains`, bis sicher ist, dass alle Subdomains ausschließlich per HTTPS erreichbar sein sollen.

HTTP→HTTPS-Weiterleitung und HSTS müssen direkt am echten öffentlichen Edge getestet werden.

## Interne Discord-API

Port 3001 bleibt ohne Host-Portmapping im Docker-Netz.

Zusätzlich benötigen jetzt alle internen Discord-Verwaltungsrouten außer `/health`:

```text
X-BWK-Service-Secret
```

Der Wert wird mit Timing-Safe-Comparison geprüft. Ohne korrektes gemeinsames Secret werden die internen Verwaltungsaufrufe abgelehnt.

Das Secret wird nie an den Browser ausgegeben.

## Meldungsanhänge

Archivierte Discord-Anhänge werden nicht mehr anhand des von Discord gelieferten MIME-Typs blind inline ausgeliefert.

Inline erlaubt sind nur anhand ihrer Magic Bytes erkannte:

- PNG
- JPEG
- GIF
- WebP

HTML, SVG, XML und unbekannte Inhalte werden als Download mit `application/octet-stream` ausgegeben.

Zusätzlich:

- `Content-Disposition`
- `X-Content-Type-Options: nosniff`
- Sandbox-CSP
- `X-Frame-Options: DENY`
- `Cache-Control: private, no-store`

## Größenlimits und Downloads

JSON-Bodies werden streamingbasiert begrenzt.

- normale JSON-Anfragen: begrenztes Standardlimit
- Backup Restore/Inspect: eigenes größeres Backup-Limit
- zu große Bodies: HTTP 413
- ungültiges JSON: HTTP 400

Externe Downloads werden ebenfalls während des Streams begrenzt und besitzen Timeouts und Parallelitätsgrenzen. Meldungsanhänge werden nur von den vorgesehenen Discord-CDN-Hosts geladen.

## Browser-Sicherheitsheader

Das Control Center setzt zentral:

- Content-Security-Policy
- `frame-ancestors 'none'`
- `base-uri 'none'`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- restriktive Permissions-Policy
- HSTS bei erkanntem HTTPS

Die CSP lässt die bestehenden eigenen Inline-Anteile und benötigte HTTPS/WSS-Kommunikation weiterhin zu.

## Overlay / WebSocket

Die Stubenkontrolle wurde gehärtet:

- unbekannte Upgradepfade werden aktiv geschlossen
- maximal 8 gleichzeitige Overlay-Clients
- Origin-Allowlist
- Schlüsselrotation trennt bereits verbundene Clients
- externer OBS-Zugriff bleibt über die konfigurierte Origin beziehungsweise `null` für lokale `file://`-Overlays möglich

## Container-Härtung

Aktiv:

- Code-Mounts read-only
- `no-new-privileges`
- `cap_drop: ALL`
- PID-Limit
- RAM-Limit
- separates Docker-Netz

Bewusst **noch nicht erzwungen**: `user: node`. Auf Synology können vorhandene Volume-Dateirechte dadurch den Schreibzugriff auf `/data` beziehungsweise `/discord-data` verhindern. Non-root sollte erst nach Prüfung und Korrektur der NAS-Dateirechte aktiviert werden.

Das Image bleibt `node:22-alpine`. Für den Betrieb sollte es regelmäßig kontrolliert aktualisiert werden; einen unverifizierten Digest trägt V7.0.1 bewusst nicht ein.

## Backup

Das V2-Backup bleibt migrationskompatibel.

Weiterhin ausgeschlossen:

- Twitch OAuth-/Refresh-Tokens
- Discord Bot Token / Client Secret
- Instagram/TikTok Access-/Refresh-Tokens
- Login-Sessions
- internes Dienstgeheimnis
- aktive Rechte-Snapshots von Kanalzeiten und Notfallmodus

## Nach dem Update testen

1. Beide Container sind grün.
2. Neu einloggen.
3. Discord-Dashboard öffnet.
4. Backup kann als Owner exportiert werden.
5. Admin ohne Owner-Recht kann kein Backup exportieren/restoren.
6. Neustart funktioniert für Twitch, Discord und beide Dienste.
7. Kanalzeiten, Notfallmodus und Logs laden.
8. Social Media lädt für Owner.
9. Regeln/Freischaltung funktionieren.
10. OBS-Overlay verbindet sich weiterhin.
