# V6.3.1 – Social Media Syndication / TikTok Login Kit

## Grundsatz

Das Control Center ist **kein Posting-Zentrum**. TikTok- und Instagram-Inhalte werden weiterhin über die bestehenden redaktionellen Prozesse veröffentlicht. Das Control Center erkennt neue Veröffentlichungen und kündigt sie in Discord an.

Der Social-Media-Bereich ist ausschließlich für Owner sichtbar und erscheint in beiden Hauptansichten (Twitch und Discord) als derselbe Bereich.

## TikTok – benötigte Produkte und Scopes

Für die implementierte Funktion werden ausschließlich benötigt:
- Login Kit (Web)
- Display API
- `user.info.basic`
- `video.list`

Keine Publishing- oder Upload-Berechtigung wird angefordert.

## Serverseitige Konfiguration

Im `discordbot`-Service:

```yaml
TIKTOK_CLIENT_KEY: "DEIN_CLIENT_KEY"
TIKTOK_CLIENT_SECRET: "DEIN_CLIENT_SECRET"
TIKTOK_ENVIRONMENT: "sandbox"
```

`TIKTOK_ENVIRONMENT` kann später auf `production` gesetzt werden. Client Secret und Tokens werden niemals an das Browser-Frontend ausgeliefert.

Die älteren Felder `TIKTOK_ACCESS_TOKEN` und `TIKTOK_REFRESH_TOKEN` bleiben als Migrations-/Fallback-Möglichkeit erhalten. Sobald der neue Login-Kit-Ablauf einmal verwendet wurde, verwaltet das Control Center die Verbindung selbst und fällt nach einem bewussten Disconnect nicht auf alte Environment-Tokens zurück.

## OAuth-Ablauf

1. Owner öffnet Social Media → TikTok.
2. Das Control Center zeigt die feste Redirect URI aus `PUBLIC_BASE_URL` an.
3. Owner startet `TikTok verbinden`.
4. Ein kryptografisch zufälliger State wird intern gespeichert, läuft nach 10 Minuten ab und ist nur einmal verwendbar.
5. TikTok autorisiert `user.info.basic,video.list`.
6. Der öffentliche Callback `/auth/tiktok/callback` reicht Code und State intern an den Discord-Service weiter.
7. Erst dort wird der Code mit Client Key/Secret serverseitig gegen Access-/Refresh-Token getauscht.
8. Gewährte Scopes und verbundener Account werden im Owner-Bereich angezeigt.
9. Refresh Tokens werden für die automatische Token-Erneuerung verwendet.
10. `Verbindung trennen` versucht den Access Token bei TikTok zu widerrufen und entfernt die lokal verwalteten Tokens.

Bereits an Discord gesendete Social-Media-Nachrichten werden beim Disconnect nicht gelöscht.

## Tatsächliche TikTok-Datenverarbeitung

Profil: `open_id`, `display_name`, `avatar_url`.

Videos: `id`, `title`, `video_description`, `duration`, `cover_image_url`, `share_url`, `create_time`.

Persistent gespeichert werden im Discord-Datenvolume Tokens/Ablaufdaten/open_id/Scopes, Profilstatus, erkannte Video-IDs/Dedup-Status sowie die Veröffentlichungshistorie. Ein Vorschaubild wird beim Discord-Versand kurzfristig heruntergeladen und direkt als Discord-Anhang hochgeladen; es wird nicht zusätzlich lokal als Bilddatei archiviert.

`Lokale TikTok-Daten löschen` entfernt den lokalen Dedup-/Verlaufsbestand und setzt die TikTok-Baseline zurück. Es entfernt keine Discord-Nachrichten.

## Öffentliche TikTok-Prüfseiten

Owner verwalten unter Administration → Öffentliche Webseiten:
- `/app`
- `/terms`
- `/privacy`
- `/imprint`

Entwürfe sind nicht öffentlich. Erst `Veröffentlichen` erzeugt eine getrennte öffentliche Fassung. Offene Pflichtplatzhalter blockieren die Veröffentlichung.

## Website-Verifizierung

Für URL Properties kann TikTok eine heruntergeladene Signaturdatei verlangen. Im Owner-Bereich kann genau eine statische `.txt`-Datei bis 10 KB ohne Pfadangaben veröffentlicht werden. Es gibt kein allgemeines Datei-Hosting.

## Zentrale Stammdaten für Terms / Privacy / Impressum

Unter **Administration → Öffentliche Webseiten → Stammdaten** werden die organisatorischen Angaben einmal gepflegt. Die Entwürfe dürfen Variablen wie `[[BETREIBER_NAME]]` behalten. Vorschau und Veröffentlichung setzen die Werte automatisch ein.

Eine Stammdatenänderung verändert eine bereits veröffentlichte Fassung nicht. Erst beim nächsten ausdrücklichen Veröffentlichen wird eine neue Momentaufnahme erzeugt.

## TikTok-App-Review: vorhandenes Reel manuell senden

Unter **Social Media → TikTok** und **Social Media → Veröffentlichungen** haben Owner bei TikTok-Einträgen zwei zusätzliche Möglichkeiten:

- **Nachträglich veröffentlichen**: für einen Baseline- oder Fehler-Eintrag. Der echte Beitrag wird mit seinen gespeicherten Metadaten, Original-Link und Thumbnail nach Discord gesendet und anschließend als versendet markiert.
- **Demo senden**: sendet einen bestehenden TikTok-Eintrag erneut nach Discord, ohne dessen Dedup-/Baseline-Status zu verändern. Diese Funktion ist für das TikTok-App-Review-Demovideo gedacht.

Damit lässt sich der vollständige Ablauf im Sandbox-/Review-Video demonstrieren, ohne ein neues TikTok nur für die Aufnahme veröffentlichen zu müssen.

## Instagram – automatische Token-Erneuerung

Die Instagram-Anbindung verwendet **Instagram API with Instagram Login** und weiterhin ausschließlich `instagram_business_basic`.

Owner tragen den Long-Lived Token unter **Social Media → Instagram** ein. Der Token wird serverseitig validiert und danach persistent in `/discord-data/social-token-state.json` gespeichert. Der Browser erhält den gespeicherten Token nicht zurück.

Die Erneuerung verwendet:

`GET https://graph.instagram.com/refresh_access_token`

mit `grant_type=ig_refresh_token` und dem aktuellen Long-Lived Access Token. Der Token muss noch gültig und mindestens 24 Stunden alt sein. Nach erfolgreicher Erneuerung werden der zurückgegebene `access_token` und das aus `expires_in` berechnete Ablaufdatum gespeichert und sofort verwendet.

Planung:
- automatische Erneuerung alle 30 Tage
- Fälligkeitsprüfung täglich
- zusätzliche Prüfung nach Containerstart
- begrenzter Fehler-Retry mit 1 Stunde, 6 Stunden und danach 24 Stunden Abstand
- parallele Refresh-Aufrufe werden blockiert

Bei einem abgelaufenen/widerrufenen beziehungsweise von Meta als ungültig gemeldeten Token wird **Erneute Autorisierung erforderlich** angezeigt. Ein Refresh stellt keine separat abgelaufenen oder entzogenen Kontoberechtigungen wieder her.

## Manuelle Discord-Auslieferung

In **Instagram**, **TikTok** und **Veröffentlichungen** können Owner vorhandene Beiträge:
- **Nachträglich veröffentlichen** – einen Baseline-/Fehler-Eintrag an Discord senden und als versendet markieren.
- **Demo senden** – denselben echten Beitrag erneut an Discord senden, ohne den Dedup-/Baseline-Status zu verändern.

Die Listen sind nach `publishedAt` absteigend sortiert, der neueste Beitrag steht oben.

## Primärquellen

- Login Kit Web: https://developers.tiktok.com/docs/en/login-kit-web
- Display API: https://developers.tiktok.com/docs/en/display-api-overview
- Display API Get Started: https://developers.tiktok.com/docs/en/display-api-get-started
- User Access Token Management: https://developers.tiktok.com/docs/en/login-kit-manage-user-access-tokens
- App Review Guidelines: https://developers.tiktok.com/docs/en/app-review-guidelines
- App registration / URL verification: https://developers.tiktok.com/docs/en/getting-started-create-an-app

TikTok prüft Produktionsanträge manuell. Öffentliche App-/Terms-/Privacy-Seiten und URL-Verifizierung sind wichtige Anforderungen, garantieren aber keine Freigabe.

## Linkprüfung und Altersgrenze (TikTok, ab 9.25.6)
- Neue TikTok-Beiträge werden nur gesendet, wenn der Link bei TikTok abrufbar ist (oEmbed-Prüfung). Nicht abrufbare Beiträge – etwa gelöschte oder nur als Werbung angelegte – bleiben „Wartet auf Link“ und werden nach drei Abfragen als „Übersprungen“ vermerkt.
- Die Altersgrenze (Standard 48 Stunden, 0 = unbegrenzt) verhindert späte Ankündigungen alter Beiträge.
- Beides steht unter Social Media → Einstellungen → TikTok. Instagram wird nicht geprüft.
