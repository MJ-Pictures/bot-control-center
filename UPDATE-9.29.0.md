# Update 9.29.0 – Zugriffsprofile

## Neu
- **Administration → Benutzer & Zugriffe → Zugriffsprofile:** benannte Rechtesätze (z. B. „Moderations-Team“) mit derselben Ansehen/Bearbeiten-Matrix wie bei Benutzern. Anlegen, bearbeiten, duplizieren, löschen.
- **Pro Benutzer:** ein oder mehrere Profile wählen („Profile speichern“). Die Rechte werden zusammengerechnet und um die **Zusätzlichen Einzelrechte** des Benutzers (die bisherige Matrix) ergänzt.
- **Live verknüpft:** Ändert oder löscht du ein Profil, gilt das sofort für alle Zugewiesenen; deren Sitzungen werden dafür beendet, sie melden sich neu an.
- **Automatische Zuordnung:** Regeln „Twitch-Moderator erhält Profil X“ oder „Discord-Rolle (Rollen-ID) erhält Profil Y“. Gilt beim Anmelden zusätzlich zu manuell zugewiesenen Profilen.
- Sicherheit: nur Owner/Administratoren verwalten Profile; Owner und Administratoren haben weiter immer Vollzugriff; alle Änderungen stehen im Audit-Protokoll (`access-profile.*`, `user.profiles.updated`). Ausgeschaltete Module bleiben in der Matrix ausgeblendet; gespeicherte Rechte bleiben erhalten.

## Nach dem Update
1. Dateien ersetzen bzw. Update einspielen, Container `bcc-web` neu starten.
2. Im Control Center unter Benutzer & Zugriffe ein Profil anlegen und einem Testbenutzer zuweisen; mit dessen Anmeldung prüfen.

## Hinweise
- **Keine Rechteänderung durch das Update:** Bestehende Benutzer behalten ihre Einzelrechte, es gibt zunächst keine Profile und keine Regeln.
- Profile liegen in einem eigenen Dokument (`access-profiles`), mit PostgreSQL wie die anderen Einstellungen. Keine Änderung an der Datenbankstruktur oder an der `compose.yaml`.
- Wird ein Benutzer gelöscht, entfallen seine Profilzuweisungen.

## Weiter aus 9.28.x (unverändert)
- Chat-Overlay (Deckkraft, Textschatten, Ausweichen), Punktespiel-Overlay (Lage, Größe, Punkte-Übersicht), Chat-Befehl `!clip`.
