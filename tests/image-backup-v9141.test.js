"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const src = fs.readFileSync("app/server.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");

test("Bilder sind ein eigener, abwählbarer Sicherungsbereich", () => {
  assert.match(src, /images: \{\s*label:"Bilder[^"]*",\s*read:\(\)=>imageBackupRead\(\)/);
  assert.match(ui, /class="backup-export-section" value="images"/);
});

test("Wiederherstellung prüft jedes Bild erneut und verändert vorher nichts", () => {
  assert.match(src, /function imageBackupPlan/);
  assert.match(src, /imageKit\.validateUpload\(slot,buf\)/);
  assert.match(src, /key==="images"\)\{\s*imageBackupPlan\(data\.images\);/);
  assert.match(src, /unbekannter Bildplatz/);
  assert.match(src, /\^\[A-Za-z0-9\+\/\]\*=\{0,2\}\$/);
});

test("Größenlimit der Sicherung reicht für vier Bilder à 5 MB", () => {
  const m = /BACKUP_BODY_LIMIT = (\d+) \* 1024 \* 1024/.exec(src);
  assert.ok(m && Number(m[1]) >= 40);
});
