"use strict";
// 9.14.0: Bildplätze der Installation (Banner, Emblem, Spielfigur, Logo) und Prüfung hochgeladener Bilder.
// Reine Funktionen ohne Dateizugriff, damit sie getestet werden können.
// Erlaubt: PNG, JPEG, GIF, WebP; 9.25.1: für das Browser-Symbol (favicon) zusätzlich ICO. Nie SVG (kann Skripte enthalten). Die Art wird an den Dateianfangsbytes erkannt,
// nicht am Dateinamen oder am vom Browser gemeldeten Typ.

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 4096 * 4096; // Schutz vor übergroßen Bildern (Speicherbedarf beim Dekodieren)

// recommended/min in Pixeln; ratio = Breite/Höhe, tolerance = erlaubte relative Abweichung.
const SLOTS = Object.freeze({
  banner: Object.freeze({
    key: "banner", label: "Follower-Alert-Banner", hint: "Hintergrund der Follower-Anzeige im Stream",
    recommended: { width: 2126, height: 387 }, min: { width: 1063, height: 194 }, ratio: 2126 / 387, tolerance: 0.12
  }),
  emblem: Object.freeze({
    key: "emblem", label: "Follower-Alert-Emblem", hint: "Kleines Zeichen für Follower-Meldungen",
    recommended: { width: 256, height: 256 }, min: { width: 128, height: 128 }, ratio: 1, tolerance: 0.15
  }),
  gameFigure: Object.freeze({
    key: "gameFigure", label: "Figur des Punktespiels", hint: "Wird im Overlay des Punktespiels neben der Anzeige gezeigt; ohne Upload erscheint die eingebaute Standardfigur (ein Lehrer)",
    recommended: { width: 512, height: 512 }, min: { width: 256, height: 256 }, ratio: 1, tolerance: 0.15
  }),
  subathonLogo: Object.freeze({
    key: "subathonLogo", label: "Subathon-Logo", hint: "Optionales Bild neben dem Countdown im Subathon-Overlay",
    recommended: { width: 512, height: 512 }, min: { width: 128, height: 128 }, ratio: 1, tolerance: 0.15
  }),
  favicon: Object.freeze({
    key: "favicon", label: "Browser-Symbol (Favicon)", hint: "Kleines Symbol im Browser-Tab und bei Lesezeichen (PNG, WebP, JPG, GIF oder ICO); ohne Upload erscheint ein neutrales Standardsymbol",
    recommended: { width: 256, height: 256 }, min: { width: 64, height: 64 }, ratio: 1, tolerance: 0.15
  }),
  logo: Object.freeze({
    key: "logo", label: "Logo der Weboberfläche", hint: "Erscheint links in der Kopfzeile",
    recommended: { width: 512, height: 512 }, min: { width: 128, height: 128 }, ratio: 1, tolerance: 0.15
  })
});
const SLOT_KEYS = Object.freeze(Object.keys(SLOTS));
const EXT = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/x-icon": "ico" });

function isSlot(key) { return typeof key === "string" && Object.prototype.hasOwnProperty.call(SLOTS, key); }

function sniffMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  const six = buf.subarray(0, 6).toString("ascii");
  if (six === "GIF87a" || six === "GIF89a") return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  // 9.25.1: Windows-Symboldatei (ICO): 00 00 01 00, danach Anzahl der Bilder.
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf.readUInt16LE(4) > 0) return "image/x-icon";
  return null;
}

function pngSize(b) { return b.length >= 24 && b.subarray(12, 16).toString("ascii") === "IHDR" ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null; }
function gifSize(b) { return b.length >= 10 ? { width: b.readUInt16LE(6), height: b.readUInt16LE(8) } : null; }
function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
function webpSize(b) {
  if (b.length < 30) return null;
  const kind = b.subarray(12, 16).toString("ascii");
  if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  return null;
}
// ICO: größtes enthaltenes Bild (Breite/Höhe 0 bedeutet 256).
function icoSize(b) {
  const n = b.readUInt16LE(4);
  if (n < 1 || n > 64 || b.length < 6 + 16 * n) return null;
  let best = null;
  for (let i = 0; i < n; i++) {
    const o = 6 + 16 * i, w = b[o] || 256, h = b[o + 1] || 256;
    if (!best || w * h > best.width * best.height) best = { width: w, height: h };
  }
  return best;
}
function imageSize(buf, mime) {
  try {
    if (mime === "image/x-icon") return icoSize(buf);
    if (mime === "image/png") return pngSize(buf);
    if (mime === "image/gif") return gifSize(buf);
    if (mime === "image/jpeg") return jpegSize(buf);
    if (mime === "image/webp") return webpSize(buf);
  } catch { /* unlesbar → null */ }
  return null;
}

// Prüft ein hochgeladenes Bild für einen Platz. Rückgabe: { ok:true, mime, ext, width, height, bytes } oder { ok:false, error }.
function validateUpload(slotKey, buf) {
  if (!isSlot(slotKey)) return { ok: false, error: "Unbekannter Bildplatz." };
  const slot = SLOTS[slotKey];
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, error: "Es wurde keine Datei übertragen." };
  if (buf.length > MAX_BYTES) return { ok: false, error: "Die Datei ist größer als 5 MB." };
  const head = buf.subarray(0, 512).toString("latin1").toLowerCase();
  if (head.includes("<svg") || head.includes("<?xml")) return { ok: false, error: "SVG-Dateien sind nicht erlaubt. Bitte PNG, WebP, JPG oder GIF verwenden." };
  const mime = sniffMime(buf);
  if (!mime) return { ok: false, error: "Das Dateiformat wird nicht unterstützt. Erlaubt sind PNG, WebP, JPG und GIF (beim Browser-Symbol auch ICO)." };
  if (mime === "image/x-icon" && slotKey !== "favicon") return { ok: false, error: "ICO-Dateien sind nur für das Browser-Symbol (Favicon) erlaubt. Bitte PNG, WebP, JPG oder GIF verwenden." };
  const size = imageSize(buf, mime);
  if (!size || !size.width || !size.height) return { ok: false, error: "Die Bildgröße konnte nicht gelesen werden. Die Datei scheint beschädigt zu sein." };
  if (size.width * size.height > MAX_PIXELS) return { ok: false, error: "Das Bild ist zu groß (höchstens 4096 × 4096 Pixel)." };
  // ICO: Das Symbol enthält meist mehrere Größen (16 bis 64); es genügt, wenn das größte mindestens 32 Pixel hat.
  const minW = mime === "image/x-icon" ? Math.min(slot.min.width, 32) : slot.min.width, minH = mime === "image/x-icon" ? Math.min(slot.min.height, 32) : slot.min.height;
  if (size.width < minW || size.height < minH) {
    return { ok: false, error: `Das Bild ist zu klein (${size.width} × ${size.height}). Mindestens ${slot.min.width} × ${slot.min.height} Pixel, empfohlen ${slot.recommended.width} × ${slot.recommended.height}.` };
  }
  const ratio = size.width / size.height;
  if (Math.abs(ratio - slot.ratio) / slot.ratio > slot.tolerance) {
    return { ok: false, error: `Das Seitenverhältnis passt nicht (${size.width} × ${size.height}). Empfohlen: ${slot.recommended.width} × ${slot.recommended.height} Pixel.` };
  }
  return { ok: true, mime, ext: EXT[mime], width: size.width, height: size.height, bytes: buf.length };
}

const FILE_RE = /^(banner|emblem|gameFigure|subathonLogo|favicon|logo)-[0-9a-f]{12}\.(png|jpg|gif|webp|ico)$/;

// Gespeicherte Angaben je Platz bereinigen (nur bekannte Plätze, nur gültige Dateinamen).
function normalizeImages(src) {
  const out = {};
  const s = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  for (const key of SLOT_KEYS) {
    const e = s[key];
    if (!e || typeof e !== "object") continue;
    const file = String(e.file || "");
    const m = FILE_RE.exec(file);
    if (!m || m[1] !== key) continue;
    const mime = Object.keys(EXT).find(k => EXT[k] === m[2]);
    out[key] = {
      file, mime,
      width: Math.max(0, Math.min(65535, Math.trunc(Number(e.width) || 0))),
      height: Math.max(0, Math.min(65535, Math.trunc(Number(e.height) || 0))),
      bytes: Math.max(0, Math.min(MAX_BYTES, Math.trunc(Number(e.bytes) || 0))),
      updated: e.updated ? String(e.updated).slice(0, 40) : null
    };
  }
  return out;
}

function slotInfo(slotKey) {
  const s = SLOTS[slotKey];
  return { key: s.key, label: s.label, hint: s.hint, recommended: { ...s.recommended }, min: { ...s.min }, maxBytes: MAX_BYTES, formats: slotKey === "favicon" ? ["PNG", "WebP", "JPG", "GIF", "ICO"] : ["PNG", "WebP", "JPG", "GIF"] };
}

module.exports = { SLOTS, SLOT_KEYS, MAX_BYTES, MAX_PIXELS, EXT, isSlot, sniffMime, imageSize, validateUpload, normalizeImages, slotInfo, FILE_RE };
