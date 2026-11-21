"use strict";
// 9.25.5 · Lizenzangabe der MCP-Bibliotheken ist bestätigt (Apache-2.0, Übergang von MIT) und steht in den Drittkomponenten.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const doc = fs.readFileSync(path.join(__dirname, "..", "public", "legal", "THIRD_PARTY_LICENSES.md"), "utf8");

test("Drittkomponenten: MCP-Bibliotheken mit Apache-2.0, MIT-Anteil und CC-BY-4.0 ausgewiesen, kein offener Vorbehalt", () => {
  assert.doesNotMatch(doc, /zu bestätigen|vor der ersten Veröffentlichung/);
  const row = doc.split("\n").find(l => l.includes("@modelcontextprotocol/server"));
  assert.match(row, /Apache License 2\.0/);
  assert.match(doc, /### Model Context Protocol/);
  for (const s of ["Apache License, Version 2.0", "MIT-Lizenz", "CC-BY-4.0", "NOTICE", "LF Projects, LLC"]) assert.ok(doc.includes(s), s);
});
test("Drittkomponenten: Versionen entsprechen mcp-app/package.json", () => {
  const dir = path.join(__dirname, "..", "mcp-app", "package.json");
  if (!fs.existsSync(dir)) return; // im Export vorhanden, sonst nichts zu prüfen
  const d = JSON.parse(fs.readFileSync(dir, "utf8")).dependencies;
  assert.ok(doc.includes(`2.4.0`) && d["@modelcontextprotocol/server"] === "2.4.0");
  assert.ok(doc.includes(`2.1.2`) && d["@modelcontextprotocol/node"] === "2.1.2");
});
