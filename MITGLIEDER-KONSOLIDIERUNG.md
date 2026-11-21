# Technischer Bestand / Konsolidierungsplan – 8.1.12

| Bereich | Vorhandener Einstieg | Gemeinsame technische Grundlage | Einordnung |
|---|---|---|---|
| Mitglieder/Suche | Server → Mitglieder | `/api/discord/members` → Discord-Dienst `/members` | Wiederverwendet |
| Rollen | Mitgliederkarte | `/api/discord/members/role` → `/members/role`; Discord-Server-Hierarchie und Onboarding-Schutz | Wiederverwendet |
| Onboarding/Freischaltung | Community → Freischaltung | Discord-Onboarding-State und vorhandene Rollensynchronisation | Getrennt belassen (Ereignislogik) |
| Minigame-XP | Minigame → Spieler | `/api/discord/levelsystem/xp` → zentrale Level-Engine | Gleicher Schreibpfad im Mitgliederprofil |
| XP-Leseansicht | Server → Mitglieder | `/api/discord/members/levels` | Wiederverwendet |
| Backendfreigabe | Mitgliederkarte | `/api/users/discord/backend` und `requireGlobalAdmin` | Gleicher Schreibpfad im Profil |
| Moderationshistorie | Sicherheit → Userhistorie | `/api/discord/moderation/history` mit `discord.moderation.view` | Geschützte Leseansicht im Profil |
| Sanktionen | Sicherheit → Sanktionsübersicht | getrennte Moderations-Endpoints | Getrennt belassen: eigene Berechtigungen und Betriebsprozesse |

## Sicherheitsprinzip
Profile sind kein neues Rechtesystem. Nur berechtigte Abschnitte/Aktionen werden im Frontend angezeigt. Maßgeblich bleibt die separate serverseitige Autorisierung jedes bestehenden Schreib-/Lese-Endpunkts. Nicht zuordenbare Daten werden nicht erfunden.

## Weitere Phasen
1. Bestehende Moderations-/Sanktionsaktionen als gemeinsam nutzbare profilbezogene Komponenten konsolidieren.
2. Vollständige zentrale Mitgliederansicht abnehmen.
3. Erst dann Navigation, Favoriten und globale Suche umsetzen.
