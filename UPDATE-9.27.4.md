# Update 9.27.4 – Chat-Overlay: Emotes von 7TV, BetterTTV und FrankerFaceZ

## Neu
- **Drei neue Schalter** unter Live-Zentrale → Chat-Overlay → Anzeige: „7TV-Emotes“, „BetterTTV-Emotes“ und „FrankerFaceZ-Emotes“. Jeder Dienst lässt sich einzeln einschalten; **alle sind standardmäßig aus**.
- Das Control Center lädt die Emote-Listen (global und die des eigenen Twitch-Kanals) im Hintergrund und erneuert sie alle drei Stunden. Ein Dienst, der nicht antwortet, wird nach zwei Minuten erneut versucht; bis dahin bleiben seine Emote-Namen Text.
- Haben mehrere Dienste ein Emote gleichen Namens, gilt die Reihenfolge 7TV, BetterTTV, FrankerFaceZ.
- 7TV-Emotes mit dem Zero-Width-Merkmal werden über das davor stehende Emote gelegt.
- Pro Nachricht werden höchstens 30 Fremd-Emotes als Bild gezeigt. „Twitch-Emotes als Bilder anzeigen“ aus bedeutet weiterhin: alles als Text.
- **Übersichtlichere Einstellungen:** Felder, Haken und Farben stehen in Spalten nebeneinander (passt sich der Fensterbreite an).

## Datenschutz und Sicherheit
- Die Overlay-Quelle (OBS, Moblin) lädt die Bilder direkt von `cdn.7tv.app`, `cdn.betterttv.net` bzw. `cdn.frankerfacez.com`. Die Dienste sehen dabei die IP-Adresse des Geräts; deshalb sind die Schalter aus. Das Control Center selbst fragt nur `7tv.io`, `api.betterttv.net` und `api.frankerfacez.com` ab (feste Liste, keine Weiterleitungen, Zeitlimit, Größenlimit).
- Die Inhaltssicherheitsrichtlinie der Overlay-Seite erlaubt zusätzlich nur Bilder dieser drei Bildserver, keine Skripte und keine weiteren Verbindungen.
- Ins Overlay gelangen nur Dienstname und eine streng geprüfte Kennung; die Bildadressen baut die Seite aus festen Vorlagen.

## Bestandsinstallation
- Keine Änderung an der Datenbank oder an der `compose.yaml`. Ohne eingeschaltete Schalter erfolgt keine Anfrage an die Dienste, das Overlay verhält sich wie bisher.
