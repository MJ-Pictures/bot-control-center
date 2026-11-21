# Drittkomponenten und Lizenzhinweise

Das Bot Control Center steht unter der Bot Control Center Community License (BCC-CL 1.0, siehe [`LICENSE.md`](LICENSE.md)). Diese Lizenz gilt **nicht** für die folgenden Drittkomponenten; für sie gelten jeweils deren eigene Bedingungen. Dieses Dokument ist keine Rechtsberatung.

## Im Programm enthalten oder beim Bau des Images installiert

| Komponente | Verwendung | Lizenz |
|---|---|---|
| [`pg`](https://github.com/brianc/node-postgres) 8.13.1 | PostgreSQL-Treiber für Node.js; wird beim Bau des Images (`docker/node-pg.Dockerfile`) per npm installiert | MIT |
| [`@modelcontextprotocol/server`](https://github.com/modelcontextprotocol/typescript-sdk) 2.4.0 und `@modelcontextprotocol/node` 2.1.2 | nur im optionalen MCP-Dienst (`mcp-app/`); werden beim Bau seines Images per npm installiert | Apache License 2.0 (laut Lizenzdatei des Projekts; siehe Hinweis unten) |
| [`zod`](https://github.com/colinhacks/zod) 4.x | nur im optionalen MCP-Dienst; Schemaprüfung | MIT |
| [Node.js](https://nodejs.org/) 22 (Image `node:22-alpine`) | Laufzeitumgebung der Dienste | MIT (Node.js) und die Lizenzen der enthaltenen Bibliotheken |
| [Alpine Linux](https://alpinelinux.org/) (Basis der Images) | Betriebssystem-Basis in den Containern | verschiedene Open-Source-Lizenzen je Paket |
| [PostgreSQL](https://www.postgresql.org/) 17 (Image `postgres:17-alpine`) | Datenbank | PostgreSQL License |

Der übrige Code (Weboberfläche, Bots, Overlays) nutzt neben `pg` ausschließlich Module der Node.js-Standardbibliothek und eigenen Code. Der optionale MCP-Dienst bringt seine Abhängigkeiten über `mcp-app/package.json` mit; die jeweils installierten Versionen und deren Lizenzen stehen im Image unter `node_modules`.

### Model Context Protocol (TypeScript SDK)

Die Pakete `@modelcontextprotocol/server` und `@modelcontextprotocol/node` stammen aus dem Repository `modelcontextprotocol/typescript-sdk` (Rechteinhaber laut Lizenzdatei: Model Context Protocol a Series of LF Projects, LLC). Die Lizenzdatei des Projekts beschreibt einen Übergang von der MIT-Lizenz zur **Apache License, Version 2.0**:

- Neue Beiträge sind unter Apache-2.0 lizenziert; die Pakete weisen Apache-2.0 als Lizenz aus.
- Beiträge, für die keine Zustimmung zur Neulizenzierung vorliegt, bleiben unter der MIT-Lizenz (Copyright © 2024–2025 Model Context Protocol a Series of LF Projects, LLC).
- Dokumentation (ohne Spezifikationen) steht unter CC-BY-4.0.
- Apache-2.0-Text: https://www.apache.org/licenses/LICENSE-2.0 · MIT-Text: https://opensource.org/license/mit

Die Pakete werden nicht mit dem Bot Control Center ausgeliefert, sondern beim Bau des MCP-Images per npm installiert; die Lizenzdatei liegt dann im Image unter `node_modules/@modelcontextprotocol/`. Wer ein Image weitergibt, muss den Lizenztext und etwaige Hinweisdateien (NOTICE) der Pakete beilegen.

## Daten und Inhalte

### LDNOOBW – List of Dirty, Naughty, Obscene, and Otherwise Bad Words

Das Programm enthält als optionalen, statischen Import-Bestand die deutsche Wortliste `de` aus [`LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words`](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words).

- Lizenz: Creative Commons Attribution 4.0 International (CC BY 4.0), Text: https://creativecommons.org/licenses/by/4.0/
- Urhebervermerk laut Projekt: © 2012–2020 Shutterstock, Inc.
- Der Bestand wird nicht automatisch aktiviert. Ein Import erfolgt nur auf ausdrückliche Owner-Aktion und legt die Einträge standardmäßig deaktiviert im Testmodus an. Die Einordnung einzelner Begriffe ist kontextabhängig und muss vor dem produktiven Einsatz geprüft werden.

## Schriften

Es werden **keine Schriftdateien mitgeliefert**. Die Overlays verweisen auf Schriften, die auf dem Rechner des Betreibers installiert sind (zum Beispiel über `local()` in CSS). Lizenz und Bezug dieser Schriften liegen beim Betreiber.

## Dienste und Marken Dritter

Twitch, Discord, Instagram, TikTok, GitHub, Docker, PostgreSQL und OBS sind Marken oder Produkte der jeweiligen Inhaber. Das Bot Control Center ist ein unabhängiges Projekt und steht in keiner Verbindung zu diesen Anbietern. Für die Nutzung der Schnittstellen gelten deren Nutzungsbedingungen und Entwicklerrichtlinien.

## Hinweis für Betreiber

Wer die Software weitergibt oder in einem Image bündelt, muss die Lizenzbedingungen der enthaltenen Drittkomponenten selbst prüfen und einhalten.
