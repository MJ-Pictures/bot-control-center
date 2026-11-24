# Update 9.27.3 – Chat-Overlay: Anpassung von Farben, Position, Schrift und Bildern

## Neu
- **Karte „Anpassung“** unter Live-Zentrale → Chat-Overlay:
  - Position oben oder unten, Abstand zum Rand (seitlich, oben/unten), Breite in Prozent der Quelle (0 = automatisch).
  - Eigene Farben für Namensleiste und Nachricht, je mit Textfarbe. Ohne gesetzten Haken gilt die Farbe des gewählten Looks.
  - Stärke der Textur (nur wirksam, wenn eine Textur hochgeladen ist).
- **Eigene Schrift:** Bei „Schrift“ die Auswahl „Eigene Schrift“ wählen und den Namen eintragen. Die Schrift muss auf dem Gerät installiert sein, auf dem OBS oder Moblin läuft; sonst gilt die Systemschrift. Es wird keine Schriftdatei geladen.
- **Neue Bildplätze** unter Administration → Profil & Branding: Symbole für Follower, Raid, Abo, Geschenkabo, Bits und Kanalpunkte (quadratisch, empfohlen 256 × 256, PNG mit transparentem Hintergrund) und eine kachelbare Textur (quadratisch, empfohlen 512 × 512). Ohne Upload erscheinen die eingebauten Symbole und keine Textur.
- Geöffnete Quellen übernehmen geänderte Einstellungen und Bilder sofort; die Quelle muss dafür nicht neu geladen werden.

## Bestandsinstallation
- Keine Änderung an der Datenbank oder an der `compose.yaml`; alle bisherigen Einstellungen bleiben unverändert (neue Felder haben Standardwerte, die dem bisherigen Aussehen entsprechen).
- Eigene Symbole werden in voller Farbe gezeigt (nicht in der Akzentfarbe eingefärbt). Die eingebauten Symbole folgen weiter der Akzentfarbe.
- Nicht enthalten: Drittanbieter-Emotes (7TV, BTTV, FFZ).
