# Followathon – Tests und Betriebsregeln

## Automatisierter Regressionstest

Auf einem System mit Node.js 22 im Projektverzeichnis ausführen:

```sh
node tests/followathon.test.js
```

Der Test prüft mindestens: produktive Gutschrift, erneutes Folgen desselben Twitch-Users, doppelte Twitch-Message-ID, Follow während Pause, Annahmestopp, manuelles Erreichen von null und dass ein beendeter Timer durch spätere Follows nicht wieder startet.

## Manuelle Integrationsprüfungen

1. **Berechtigungen:** Viewer ohne `twitch.followathon.edit` darf Verwaltungsaktionen nicht ausführen. Owner darf Events anlegen und zurücksetzen. Freigeschaltete Moderatoren dürfen Start/Pause/Fortsetzen, Annahmestopp, Prüfungen und Zeitkorrekturen bedienen.
2. **EventSub:** Im UI müssen der Haupt-Bot, `moderator:read:followers`, eine verbundene EventSub-WebSocket-Session und eine erfolgreiche `channel.follow`-v2-Subscription sichtbar sein.
3. **Doppelte Zustellung:** Dasselbe Event mit derselben Twitch-Message-ID darf nur einmal wirken.
4. **Refollow:** Derselbe `user_id` darf im selben Event auch nach Entfolgen/erneutem Folgen nur einmal gutgeschrieben werden.
5. **Parallelität:** Mehrere nahezu gleichzeitige unterschiedliche Follows müssen ohne verlorene Updates seriell in `followathon.json` landen.
6. **Pause:** Der Countdown darf während der Pause nicht sinken. Gültige Follows dürfen bei aktivierter Annahme Zeit addieren. Die feste späteste Endzeit bleibt unverändert.
7. **Annahmestopp:** Follows mit `followed_at` außerhalb eines aktiven Annahmezeitraums erhalten keine Gutschrift.
8. **Grenzen:** Maximale Restzeit und feste späteste Endzeit gemeinsam testen; Teilgutschriften müssen im Log als gekürzt erscheinen. Es darf keine Warteschlange abgeschnittener Zeit entstehen.
9. **Null:** Bei null wird der Status `ended`. Später eintreffende Follows dürfen nicht reaktivieren.
10. **Neustart:** Laufenden Timer notieren, Container stoppen, warten, neu starten. Die verstrichene Ausfallzeit muss vom laufenden Countdown abgezogen sein. Pausierte Events müssen unverändert pausiert bleiben.
11. **Overlay:** Browserquelle neu laden und OBS schließen/öffnen. Der Timerzustand darf sich dadurch nicht verändern. Bei unterbrochener SSE-Verbindung muss `VERBINDUNG UNTERBROCHEN` erscheinen; nach Reconnect wird der vollständige Zustand geladen.
12. **Auffälligkeitsschutz:** Schwelle absichtlich überschreiten, zurückgehaltene Follows freigeben/ablehnen und anschließend Einzel- sowie Zeitraum-Rücknahme testen.
13. **Testmodus:** Ein simulierter Follow darf `followCount`, produktive Gutschriften, User-Deduplizierung und echte Twitch-Followerdaten nicht verändern.
14. **Unberechtigter Zugriff:** Öffentliche Overlay-Endpunkte sind GET-only. Verwaltungsendpunkte müssen ohne Session bzw. ohne Capability 401/403 liefern.

## Verzögerte Events und Verbindungsunterbrechungen

`followed_at` entscheidet, ob ein Follow in einem Annahmezeitraum lag. Ist das Event beim tatsächlichen Empfang bereits beendet, wird es jedoch nicht wieder gestartet. Bei EventSub-Trennungen wird eine mögliche Zähllücke angezeigt. Das System behauptet keine garantierte Wiederherstellung von Follows, die Twitch während der Unterbrechung nicht zustellt.
