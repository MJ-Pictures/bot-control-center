# Update 9.25.7 – Öffentliche Veröffentlichung auch nachträglich auslösbar

## Neu
- Neuer manueller Workflow `publish-public` (`.github/workflows/publish-public.yml`, GitHub → Actions → publish-public → Run workflow, Eingabe: Version, z. B. `9.25.7`). Er veröffentlicht ein bereits gebautes privates Release nachträglich im öffentlichen Repository, mit denselben Prüfungen und Bedingungen wie der Job im Release-Workflow (Variable `PUBLIC_RELEASE` = `on`, Secret `PUBLIC_REPO_TOKEN`).
- Ein erneuter Lauf des Release-Workflows ist dafür nicht geeignet: Er bricht ab, weil ein vorhandenes Release nie überschrieben wird.

## Bestandsinstallation
- Keine Änderung am Programm, an der Datenbank oder an der `compose.yaml` (automatisch einspielbar).
