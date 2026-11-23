"use strict";
// 9.26.1: Clip-Monitor übersteht Netzausfälle; Ursache statt „fetch failed“; Verzögerung sichtbar.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describeFetchError, clipLookbackMinutes, clipDelaySeconds, CLIP_BASE_LOOKBACK_MINUTES, CLIP_MAX_LOOKBACK_MINUTES } = require("../shared/clip-resilience");
const rd = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("Fehlertext nennt die Ursache statt nur „fetch failed“", () => {
  const dns = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo EAI_AGAIN api.twitch.tv"), { code: "EAI_AGAIN" }) });
  assert.match(describeFetchError(dns, "Twitch"), /Keine Verbindung zu Twitch: Name konnte nicht aufgelöst werden \(DNS\) \(EAI_AGAIN\)/);
  const to = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT", message: "Connect Timeout Error" } });
  assert.match(describeFetchError(to), /Zeitüberschreitung beim Verbinden/);
  const unknown = Object.assign(new TypeError("fetch failed"), { cause: { code: "EXYZ", message: "komisch" } });
  assert.match(describeFetchError(unknown), /: EXYZ – komisch/);
  assert.match(describeFetchError(new TypeError("fetch failed")), /\(fetch failed\)/);
  assert.equal(describeFetchError(new Error("Channel-ID fehlt.")), "Channel-ID fehlt.", "Fehler ohne Netzbezug bleiben unverändert");
  assert.match(describeFetchError(Object.assign(new Error("x"), { name: "AbortError" })), /ETIMEDOUT/);
});

test("Suchfenster: normal 15 Minuten, nach Ausfall ab letztem Erfolg, höchstens 60", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  assert.equal(CLIP_BASE_LOOKBACK_MINUTES, 15);
  assert.equal(clipLookbackMinutes(null, now), 15);
  assert.equal(clipLookbackMinutes("unsinn", now), 15);
  assert.equal(clipLookbackMinutes("2026-11-23T12:30:00Z", now), 15, "Zeit in der Zukunft ignorieren");
  assert.equal(clipLookbackMinutes("2026-11-23T11:59:40Z", now), 15, "laufender Betrieb");
  assert.equal(clipLookbackMinutes("2026-11-23T11:30:00Z", now), 32, "30 Minuten Ausfall + 2 Puffer");
  assert.equal(clipLookbackMinutes("2026-11-22T21:00:00Z", now), CLIP_MAX_LOOKBACK_MINUTES, "lange Ausfälle begrenzt");
});

test("Verzögerung zwischen Erstellung und Erkennung", () => {
  const now = Date.parse("2026-11-23T12:05:00Z");
  assert.equal(clipDelaySeconds("2026-11-23T12:00:00Z", now), 300);
  assert.equal(clipDelaySeconds("2026-11-23T12:10:00Z", now), 0);
  assert.equal(clipDelaySeconds(null, now), null);
  assert.equal(clipDelaySeconds("kaputt", now), null);
});

test("Einbindung im Clip-Monitor, in den Einstellungen und in der Oberfläche", () => {
  const rt = rd("shared/twitch-runtime.js");
  assert.match(rt, /require\("\/shared\/clip-resilience"\)/);
  assert.match(rt, /fetchRecentClips\(clipLookbackMinutes\(clipLastSuccessAt \|\| state\.lastSuccessAt\)\)/);
  assert.match(rt, /clipLastSuccessAt = state\.lastCheckedAt;/);
  assert.match(rt, /throw new Error\(describeFetchError\(e, "Twitch \(api\.twitch\.tv\)"\)\)/);
  assert.match(rt, /detectedAfterSeconds/);
  assert.match(rt, /Math\.max\(5, Number\(cfg\.intervalSeconds \|\| 10\)\) \* 1000/);
  // Erfolgszeit wird erst nach erfolgreichem Abruf gesetzt, nie im Fehlerfall
  const catchPart = rt.slice(rt.indexOf("clip.monitor.failed") - 400, rt.indexOf("clip.monitor.failed"));
  assert.doesNotMatch(catchPart, /clipLastSuccessAt\s*=/);
  const data = rd("shared/twitch-data.js");
  assert.match(data, /c\.intervalSeconds = 10;/);
  assert.match(data, /Math\.min\(120, Math\.max\(5, Number\(c\.intervalSeconds \|\| 10\)\)\)/);
  const ui = rd("public/app.js");
  assert.match(ui, /id="clipInterval" type="number" min="5" max="120"/);
  assert.match(ui, /Twitch lieferte den Clip/);
  assert.ok(JSON.parse(rd("public/changelog.json")).versions.some(v => v.version === "9.26.1"));
});
