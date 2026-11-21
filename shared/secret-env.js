"use strict";
// Secrets aus Dateien (Docker-Secrets) in process.env laden – seit 8.7.3.
//
// Für jeden Namen NAME gilt: Ist NAME_FILE gesetzt und die Datei lesbar und nicht leer,
// wird ihr Inhalt (ohne Zeilenumbruch am Ende) als NAME verwendet. Die Datei hat Vorrang.
// Ist NAME_FILE nicht gesetzt, bleibt NAME aus der Umgebung unverändert (Rückfall).
// Ist die Datei nicht lesbar oder leer, bleibt eine vorhandene Umgebungsvariable erhalten
// und der Fehler wird gemeldet. Geheimnisse selbst werden nie zurückgegeben oder geloggt.
const fs = require("fs");

const MAX_SECRET_BYTES = 16 * 1024;

const CONTROL_CENTER_SECRETS = ["TWITCH_CLIENT_SECRET", "LOCAL_ADMIN_PASSWORD", "INTERNAL_SERVICE_SECRET"];
// 8.9.22: eigener Twitch-Bot-Dienst (getrennter Betrieb) – braucht kein Admin-Passwort der Oberfläche.
const TWITCH_SERVICE_SECRETS = ["TWITCH_CLIENT_SECRET", "INTERNAL_SERVICE_SECRET"];
const DISCORD_SECRETS = [
  "DISCORD_BOT_TOKEN", "DISCORD_CLIENT_SECRET", "INTERNAL_SERVICE_SECRET",
  "INSTAGRAM_ACCESS_TOKEN", "TIKTOK_ACCESS_TOKEN", "TIKTOK_REFRESH_TOKEN", "TIKTOK_CLIENT_SECRET"
];

// Rückgabe: { NAME: "datei" | "umgebung" | "fehlt" | "datei-fehler" } – ohne Werte.
function applySecretFiles(names, options = {}) {
  const env = options.env || process.env;
  const readFile = options.readFile || (p => fs.readFileSync(p));
  const log = options.log || (() => {});
  const result = {};
  for (const name of names) {
    const filePath = String(env[`${name}_FILE`] || "").trim();
    const hasEnv = String(env[name] || "") !== "";
    if (!filePath) { result[name] = hasEnv ? "umgebung" : "fehlt"; continue; }
    let value = "";
    let problem = "";
    try {
      const buf = readFile(filePath);
      if (buf.length > MAX_SECRET_BYTES) problem = "Datei ist zu groß";
      else value = buf.toString("utf8").replace(/^﻿/, "").replace(/[\r\n]+$/, "");
      if (!problem && !value.trim()) problem = "Datei ist leer";
    } catch (err) {
      problem = `Datei nicht lesbar (${err.code || "Fehler"})`;
    }
    if (problem) {
      result[name] = "datei-fehler";
      log(`⚠️ ${name}_FILE: ${problem}${hasEnv ? "; Umgebungsvariable wird weiter verwendet" : ""}.`);
      continue;
    }
    env[name] = value;
    result[name] = "datei";
  }
  return result;
}

function describeSecretSources(sources) {
  return Object.entries(sources).map(([k, v]) => `${k}=${v}`).join(", ");
}

module.exports = { applySecretFiles, describeSecretSources, CONTROL_CENTER_SECRETS, DISCORD_SECRETS, MAX_SECRET_BYTES, TWITCH_SERVICE_SECRETS };
