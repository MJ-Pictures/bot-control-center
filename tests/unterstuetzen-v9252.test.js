"use strict";
// 9.25.2 · Freiwillige Unterstützung per PayPal: README-Abschnitt und Sponsor-Knopf (.github/FUNDING.yml) der öffentlichen Fassung.
// Der Export-Teil läuft nur im privaten Repository (Werkzeug, python3 und git-Ordner nötig), sonst wird übersprungen.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const LINK = "https://www.paypal.me/JanssenMario";
const TOOL = path.join(ROOT, ".github", "release-tools", "export_public.py");
const SRC = path.join(ROOT, ".github", "release-tools", "public-funding.yml");

test("README: Abschnitt „Unterstützen“ mit freiwilligem PayPal-Link, ohne Pflicht und ohne Lizenzänderung", () => {
  const md = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const sec = /## Unterstützen\n([\s\S]*?)(?:\n## |$)/.exec(md);
  assert.ok(sec, "Abschnitt fehlt");
  assert.ok(sec[1].includes(`[Unterstützen](${LINK})`));
  assert.match(sec[1], /freiwillig/);
  assert.match(sec[1], /keine Voraussetzung/);
  assert.ok(md.indexOf("## Lizenz") < md.indexOf("## Unterstützen"));
});

const T = { skip: !fs.existsSync(TOOL) || spawnSync("python3", ["--version"]).status !== 0 || !fs.existsSync(path.join(ROOT, ".git")) ? "Export-Werkzeug, python3 oder git-Ordner nicht vorhanden" : false };

test("Sponsor-Knopf: Quelle liegt bei den Release-Werkzeugen und enthält genau den PayPal-Link", T, () => {
  const y = fs.readFileSync(SRC, "utf8").split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  assert.deepEqual(y, [`custom: ["${LINK}"]`]);
});

test("Export: .github/FUNDING.yml ist in der öffentlichen Fassung, Pipeline-Dateien nicht", T, () => {
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bcc-fund-")), "tree");
  const r = spawnSync("python3", ["-I", TOOL, "--out", dest, "--worktree", "--no-tests"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(dest, ".github", "FUNDING.yml"), "utf8"), fs.readFileSync(SRC, "utf8"));
  assert.ok(!fs.existsSync(path.join(dest, ".github", "workflows")));
  assert.ok(!fs.existsSync(path.join(dest, ".github", "release-tools")));
  assert.match(fs.readFileSync(path.join(dest, "README.md"), "utf8"), /## Unterstützen/);
});
