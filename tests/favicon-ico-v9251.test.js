"use strict";
// 9.25.1 · Bugfix: Das Browser-Symbol darf auch eine ICO-Datei sein (bisher wurde .ico abgelehnt).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const kit = require("../shared/image-slots");

// ICO mit den angegebenen Bildgrößen (Nutzdaten leer; geprüft werden Kopf und Verzeichnis).
function ico(sizes, extra = 32) {
  const b = Buffer.alloc(6 + 16 * sizes.length + extra);
  b.writeUInt16LE(0, 0); b.writeUInt16LE(1, 2); b.writeUInt16LE(sizes.length, 4);
  sizes.forEach((s, i) => { const o = 6 + 16 * i; b[o] = s >= 256 ? 0 : s; b[o + 1] = s >= 256 ? 0 : s; b.writeUInt16LE(1, o + 4); b.writeUInt16LE(32, o + 6); });
  return b;
}

test("ICO mit 16/32/48/64 Pixeln wird für das Favicon angenommen (größtes Bild zählt)", () => {
  const r = kit.validateUpload("favicon", ico([16, 32, 48, 64]));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.mime, "image/x-icon"); assert.equal(r.ext, "ico");
  assert.equal(r.width, 64); assert.equal(r.height, 64);
  assert.ok(kit.FILE_RE.test("favicon-0123456789ab.ico"));
  assert.deepEqual(kit.slotInfo("favicon").formats.slice(-1), ["ICO"]);
});
test("ICO mit 256 Pixeln (Wert 0 im Verzeichnis) wird als 256 gelesen", () => {
  assert.deepEqual(kit.imageSize(ico([256]), "image/x-icon"), { width: 256, height: 256 });
});
test("ICO ist nur für das Favicon erlaubt, zu kleine und beschädigte Dateien werden abgelehnt", () => {
  for (const slot of ["banner", "emblem", "gameFigure", "subathonLogo", "logo"]) assert.equal(kit.validateUpload(slot, ico([64, 256])).ok, false, slot);
  assert.match(kit.validateUpload("logo", ico([256])).error, /nur für das Browser-Symbol/);
  assert.equal(kit.validateUpload("favicon", ico([16])).ok, false);
  const kaputt = ico([64]).subarray(0, 10);
  assert.equal(kit.validateUpload("favicon", kaputt).ok, false);
  const nichtQuadratisch = ico([64]); nichtQuadratisch[6 + 1] = 16;
  assert.equal(kit.validateUpload("favicon", nichtQuadratisch).ok, false);
});
test("Gespeicherte ICO-Angabe bleibt beim Bereinigen erhalten, andere Plätze behalten PNG-Regeln", () => {
  const n = kit.normalizeImages({ favicon: { file: "favicon-0123456789ab.ico", width: 64, height: 64, bytes: 100 }, logo: { file: "logo-0123456789ab.ico" } });
  assert.equal(n.favicon.mime, "image/x-icon");
  // Ein ICO-Dateiname ist auch bei anderen Plätzen formal gültig, wird aber nie hochgeladen (siehe oben).
  assert.deepEqual(kit.slotInfo("logo").formats, ["PNG", "WebP", "JPG", "GIF"]);
});
test("Server und Oberfläche: ICO wird ausgeliefert und im Dateidialog angeboten", () => {
  const web = fs.readFileSync("app/server.js", "utf8"), ui = fs.readFileSync("public/app.js", "utf8");
  assert.match(web, /png\|jpeg\|gif\|webp\|x-icon/);
  assert.match(ui, /sl\.key==="favicon"\?",image\/x-icon,\.ico"/);
  assert.match(ui, /zusätzlich ICO/);
});
