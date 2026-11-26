# Update 9.29.2 – Chat-Overlay: Gesamtgröße, Schrift und Grafiken einstellbar

## Neu
- **Administration → Live-Zentrale → Chat-Overlay → Aussehen:** drei Größenregler.
  - **Gesamtgröße (30–200 %):** verkleinert oder vergrößert alles zusammen – Schrift, Grafiken, Abstände und die automatische Breite der Blasen. Der schnellste Weg, wenn der Chat zu dominant wirkt.
  - **Schriftgröße (50–200 %):** nur der Text (bisher 70–160 %).
  - **Größe der Grafiken (50–200 %):** nur Emotes, Abzeichen, Kartensymbole und der Namenspunkt, unabhängig von der Schrift.
- Alle Werte stehen auf 100 %, das entspricht der bisherigen Größe. **Bestehende Einstellungen bleiben unverändert**; ein bereits eingestellter Schriftwert gilt weiter.
- Eine unter „Anpassung“ **eigens eingestellte Breite** bleibt, wie eingestellt (nur die automatische Breite folgt der Gesamtgröße). Abstände zum Rand (Pixel) bleiben ebenfalls unverändert.
- **Vorschau:** „Vorschau mit Beispielnachrichten“ zeigt die gespeicherten Werte. Zum schnellen Ausprobieren lassen sich die Größen auch an die Vorschau-Adresse hängen: `…/chat-overlay/overlay?demo=1&overall=60&text=100&graphics=100`.

## Nach dem Update
1. Update einspielen; **Browserquelle in OBS bzw. Moblin aktualisieren** (Cache der Quelle leeren, „Cache der aktuellen Seite aktualisieren“), damit die neue Overlay-Seite geladen wird.
2. Unter Chat-Overlay → Aussehen z. B. **Gesamtgröße 70** probieren, speichern, in OBS prüfen und bei Bedarf in 5er-Schritten nachstellen.

## Hinweise
- Keine Änderung an `compose.yaml`, Datenbank oder Rechten. Kein Neustart nötig (optional `bcc-web`).
- Nicht in echtem OBS (CEF) oder Moblin geprüft; in Chrome mit 1920 × 1080 gerendert (100 %, Gesamtgröße 60 %, Grafiken 160 %).
