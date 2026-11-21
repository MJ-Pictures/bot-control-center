"use strict";
// 9.22.0 · Lizenz: Bot Control Center Community License (BCC-CL 1.0).
// Der vollständige Text liegt unter public/license/BCC-CL-1.0.md (wird mit der Software ausgeliefert). Dieses Modul kennt die
// Kenndaten der Lizenz, berechnet die Prüfsumme des Textes und verwaltet die Dokumentation der Annahme in der Installation.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LICENSE = Object.freeze({
  id: "BCC-CL",
  name: "Bot Control Center Community License",
  version: "1.0",
  spdx: "LicenseRef-BCC-CL-1.0",           // projektspezifischer Bezeichner, keine offizielle SPDX-Lizenz
  licensor: "Mario Janssen",
  provider: "MJ-Pictures",
  copyright: "Copyright © 2026 Mario Janssen (MJ-Pictures)",
  type: "Proprietary / Source Available",
  language: "Deutsch",
  file: "BCC-CL-1.0.md",
  contactUrl: "https://www.mj-pictures.de/Kontakt-Impressum"
});

// Kurzfassung für den Installationsassistenten (maßgeblich ist immer der vollständige Text).
const SUMMARY = Object.freeze({
  allowed: "Kostenlose Eigennutzung, monetarisierte Streaming-Kanäle, dienstliche Nutzung und individuelle Anpassungen.",
  forbidden: "Weiterverkauf, kommerzielles Bot-Hosting, unautorisierte Weitergabe und Entfernung verpflichtender Urheberhinweise."
});

const SOURCES = Object.freeze(["wizard", "bestandsinstallation", "bestaetigung"]);

function textFile(publicDir) { return path.join(publicDir, "license", LICENSE.file); }

// Zeilenenden vereinheitlichen, damit die Prüfsumme auf jedem System gleich ist.
function normalizeText(text) { return String(text || "").replace(/\r\n/g, "\n"); }
function sha256Of(text) { return crypto.createHash("sha256").update(normalizeText(text), "utf8").digest("hex"); }

function readText(publicDir) {
  try { return normalizeText(fs.readFileSync(textFile(publicDir), "utf8")); } catch { return null; }
}

function info(publicDir) {
  const text = readText(publicDir);
  return { ...LICENSE, sha256: text ? sha256Of(text) : null, available: !!text, summary: { ...SUMMARY } };
}

// Dokumentation der Annahme (bleibt in der Installation; es wird nichts an den Lizenzgeber übermittelt).
function createAcceptance({ version = LICENSE.version, sha256 = null, by = "", source = "wizard", now = new Date() } = {}) {
  return normalizeAcceptance({ version, sha256, acceptedAt: new Date(now).toISOString(), acceptedBy: by, source });
}

function normalizeAcceptance(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const version = String(a.version || "").trim().slice(0, 20);
  const acceptedAt = a.acceptedAt ? String(a.acceptedAt).slice(0, 40) : "";
  if (!version || !acceptedAt) return null;
  const sha = String(a.sha256 || "").toLowerCase();
  return {
    id: LICENSE.id,
    version,
    sha256: /^[0-9a-f]{64}$/.test(sha) ? sha : null,
    acceptedAt,
    acceptedBy: String(a.acceptedBy || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80),
    source: SOURCES.includes(a.source) ? a.source : "wizard"
  };
}

// Gültig ist die Annahme, wenn sie die aktuelle Lizenzversion betrifft (Textkorrekturen derselben Version verlangen keine neue Zustimmung).
function isCurrent(acceptance, version = LICENSE.version) {
  const a = normalizeAcceptance(acceptance);
  return !!a && a.version === version;
}

module.exports = { LICENSE, SUMMARY, SOURCES, textFile, normalizeText, sha256Of, readText, info, createAcceptance, normalizeAcceptance, isCurrent };
