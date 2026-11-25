# Update 9.28.0 – Clips: Chat-Befehl „!clip“

## Neu
- Twitch → Clips → Karte „Clip-Befehl im Chat“: Der Befehl (Standard `!clip`) erstellt einen Clip des laufenden Streams und der gewählte Bot schreibt den Link mit dem Namen der Person in den Chat.
- Einstellbar: Berechtigung (alle, Abonnenten, VIPs, Moderatoren, nur Kanalinhaber), Pause pro Person und für alle, Clip-Länge (5–60 s, Standard 30), antwortender Bot, Texte für Erfolg, „Kanal nicht live“ und Fehler.
- Auf Wunsch (Standard ja) wird der Clip auch in Discord gemeldet, mit Vorschaubild. Der Clip-Monitor meldet ihn nicht doppelt.
- AutoMod-Auto-Allow gilt auch für den antwortenden Bot.

## Nach dem Update (einmalig)
1. Twitch → Clips: „Clip-Befehl aktiv“ einschalten, Bot wählen, speichern.
2. Administration → Twitch-Verbindungen: das **Kanal-Konto** einmal neu verbinden (neues Recht `clips:edit`). Die Clips-Seite zeigt danach „Kanal-Konto ist verbunden und darf Clips erstellen“.
3. Im nächsten Stream `!clip` testen. Clips gehen nur, solange der Kanal live ist.

## Hinweise
- Der Clip wird über das Kanal-Konto erstellt (nicht über den Bot).
- Ein eigener Command mit demselben Namen wird vom Clip-Befehl überdeckt.
- Keine Änderung an der Datenbank oder an der `compose.yaml`.

## Weiter aus 9.27.5 (unverändert)
- Chat-Overlay mit Emotes von 7TV, BetterTTV und FrankerFaceZ.
