"use strict";
// 9.24.0: Rechtliche Begleitdokumente, die unter Hilfe → Rechtliches lesbar sind. Die Quellen liegen unter public/legal.
// Nur die Schlüssel dieser Liste sind abrufbar (keine freien Dateipfade).
const fs = require("fs");
const path = require("path");

const DOCS = Object.freeze([
  Object.freeze({ key: "datenschutz", title: "Datenschutz und externe Verbindungen", file: "PRIVACY.md" }),
  Object.freeze({ key: "sicherheit", title: "Sicherheit und Meldeweg", file: "SECURITY.md" }),
  Object.freeze({ key: "drittkomponenten", title: "Drittkomponenten und Lizenzhinweise", file: "THIRD_PARTY_LICENSES.md" }),
  Object.freeze({ key: "mitwirken", title: "Mitwirken", file: "CONTRIBUTING.md" }),
  Object.freeze({ key: "urheberhinweis", title: "Urheberhinweis", file: "NOTICE" })
]);

function list() { return DOCS.map(({ key, title }) => ({ key, title })); }

function find(key) { return DOCS.find((d) => d.key === String(key || "")) || null; }

// Liefert den Text oder null (unbekannter Schlüssel, Datei fehlt).
function read(publicDir, key) {
  const d = find(key);
  if (!d) return null;
  try { return fs.readFileSync(path.join(publicDir, "legal", d.file), "utf8"); } catch { return null; }
}

module.exports = { DOCS, list, find, read };
