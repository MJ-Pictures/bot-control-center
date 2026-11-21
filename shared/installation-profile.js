"use strict";
// 9.11.0 · D1 Schritt 1: Installationsprofil (Produktname, öffentliche Adresse, Ersteinrichtung, Spielbezeichnungen).
// Rein funktional und ohne Zugriff auf process.env oder Dateien, damit alles ohne laufenden Server testbar ist.
// Gespeichert wird das Profil in settings.installation (Datenbank). Die öffentliche Adresse aus der
// Umgebung (PUBLIC_BASE_URL) hat immer Vorrang; dann ist das Feld in der Oberfläche gesperrt.
const crypto = require("crypto");

const NEUTRAL_PRODUCT_NAME = "Bot Control Center";
// Neutrale Bezeichnungen des Punktespiels (intern weiter Modul „stubenkontrolle“).
const NEUTRAL_GAME = Object.freeze({
  name: "Punktespiel",
  pointsName: "Punkte",
  commands: Object.freeze({ start: "!spiel", balance: "!punkte", top: "!top", help: "!spielhilfe" })
});
// Feste, für jedes Spiel passende Befehle (Entscheidung Mario 17.11.2026).
const FIXED_GAME_COMMANDS = Object.freeze(["!daily", "!give", "!gift"]);
const GAME_COMMAND_KEYS = Object.freeze(["start", "balance", "top", "help"]);
const GAME_COMMAND_LABELS = Object.freeze({ start: "Runde starten / beitreten", balance: "Kontostand", top: "Rangliste", help: "Hilfe" });
// Übliche private Netze als Standard für „lokal“ (statt eines festen Heimnetzes).
const DEFAULT_LOCAL_NETWORK_CIDRS = Object.freeze(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.1/32"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Öffentliche Adresse prüfen: https, nur für localhost auch http; ohne Pfad, Anmeldedaten, Query oder Anker.
function normalizeBaseUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, url: "" };
  let u;
  try { u = new URL(text); } catch { return { ok: false, error: "Die Adresse ist ungültig (Beispiel: https://bot.example.org)." }; }
  const host = u.hostname.toLowerCase();
  const local = LOCAL_HOSTS.has(host);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local))
    return { ok: false, error: local ? "Nur http:// oder https:// ist erlaubt." : "Die öffentliche Adresse muss mit https:// beginnen (http:// nur für localhost)." };
  if (u.username || u.password) return { ok: false, error: "Die Adresse darf keine Anmeldedaten enthalten." };
  if (u.search || u.hash) return { ok: false, error: "Die Adresse darf keine Parameter (? oder #) enthalten." };
  if (u.pathname && u.pathname !== "/") return { ok: false, error: "Die Adresse darf keinen Pfad enthalten, nur Protokoll, Name und ggf. Port." };
  return { ok: true, url: `${u.protocol}//${u.host}`.toLowerCase(), local };
}

function normalizeCommand(raw) {
  let c = String(raw ?? "").trim().toLowerCase();
  if (c && !c.startsWith("!")) c = `!${c}`;
  return c;
}
function commandError(c) {
  if (!c) return "Befehl fehlt.";
  if (!/^![a-z0-9äöüß_-]{2,24}$/.test(c)) return `„${c}“ ist kein gültiger Befehl (2–24 Zeichen: Buchstaben, Ziffern, - oder _).`;
  return null;
}

function normalizeGame(src, fallback = NEUTRAL_GAME) {
  const g = src && typeof src === "object" ? src : {};
  const out = {
    name: cleanText(g.name, 40) || fallback.name,
    pointsName: cleanText(g.pointsName, 30) || fallback.pointsName,
    commands: {}
  };
  for (const key of GAME_COMMAND_KEYS) {
    const c = normalizeCommand(g.commands?.[key]);
    out.commands[key] = commandError(c) ? fallback.commands[key] : c;
  }
  return out;
}

// Prüft die Spielbefehle gegen feste Spielbefehle, untereinander und gegen weitere belegte Befehle.
// taken: [{command:"!lurk", owner:"Lurk-Rückkehr"}, …]
function validateGameCommands(commands, taken = []) {
  const errors = [];
  const seen = new Map();
  for (const key of GAME_COMMAND_KEYS) {
    const c = normalizeCommand(commands?.[key]);
    const err = commandError(c);
    if (err) { errors.push(`${GAME_COMMAND_LABELS[key]}: ${err}`); continue; }
    if (FIXED_GAME_COMMANDS.includes(c)) errors.push(`${GAME_COMMAND_LABELS[key]}: ${c} ist bereits ein fester Spielbefehl.`);
    if (seen.has(c)) errors.push(`${GAME_COMMAND_LABELS[key]}: ${c} ist schon für „${GAME_COMMAND_LABELS[seen.get(c)]}“ vergeben.`);
    seen.set(c, key);
    const hit = (taken || []).find(t => normalizeCommand(t?.command) === c);
    if (hit) errors.push(`${GAME_COMMAND_LABELS[key]}: ${c} ist bereits belegt (${hit.owner}).`);
  }
  return errors;
}

// 9.12.0 · Discord: Server und Rollenfunktionen. Gespeichert werden nur IDs.
// Funktionen (neutral): Administrator = volles Team, Moderator = vertrauenswürdig/Moderation, Member = Freischaltrolle;
// „bot“ ist die eigene Rolle des Bots (für die Rollenhierarchie).
const DISCORD_ROLE_KEYS = Object.freeze(["administrator", "moderator", "member", "bot"]);
const DISCORD_ROLE_LABELS = Object.freeze({
  administrator: "Administrator",
  moderator: "Moderator",
  member: "Member (Freischaltrolle)",
  bot: "Rolle des Bots"
});
const DISCORD_ID = /^\d{15,22}$/;
// Ältere Umgebungsvariablen (vor 9.12.0) bleiben gültig: S1 = Administrator, OVWA = Moderator, REKRUT = Member.
const DISCORD_ENV_NAMES = Object.freeze({
  guild: ["DISCORD_GUILD_ID"],
  administrator: ["DISCORD_ROLE_ADMINISTRATOR_ID", "DISCORD_ROLE_S1_ID"],
  moderator: ["DISCORD_ROLE_MODERATOR_ID", "DISCORD_ROLE_OVWA_ID"],
  member: ["DISCORD_ROLE_MEMBER_ID", "DISCORD_ROLE_REKRUT_ID"],
  bot: ["DISCORD_ROLE_BOT_ID"]
});

function cleanDiscordId(value) {
  const v = String(value ?? "").trim();
  return DISCORD_ID.test(v) ? v : "";
}

function normalizeDiscord(src) {
  const s = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  const roles = {};
  for (const key of DISCORD_ROLE_KEYS) roles[key] = cleanDiscordId(s.roles?.[key]);
  return { guildId: cleanDiscordId(s.guildId), roles };
}

// Prüft Eingaben aus der Oberfläche; leere Felder sind erlaubt (noch nicht eingerichtet). Rückgabe { errors, value }.
function validateDiscord(src, current = normalizeDiscord({})) {
  const errors = [];
  const out = { guildId: current.guildId, roles: { ...current.roles } };
  const s = src && typeof src === "object" ? src : {};
  if (Object.prototype.hasOwnProperty.call(s, "guildId")) {
    const v = String(s.guildId ?? "").trim();
    if (v && !DISCORD_ID.test(v)) errors.push("Die Discord-Server-ID muss aus 15 bis 22 Ziffern bestehen.");
    else out.guildId = v;
  }
  if (s.roles && typeof s.roles === "object") {
    for (const key of DISCORD_ROLE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(s.roles, key)) continue;
      const v = String(s.roles[key] ?? "").trim();
      if (v && !DISCORD_ID.test(v)) errors.push(`Die Rollen-ID für „${DISCORD_ROLE_LABELS[key]}“ ist ungültig.`);
      else out.roles[key] = v;
    }
  }
  const used = new Map();
  for (const key of DISCORD_ROLE_KEYS) {
    const id = out.roles[key];
    if (!id) continue;
    if (used.has(id)) errors.push(`„${DISCORD_ROLE_LABELS[used.get(id)]}“ und „${DISCORD_ROLE_LABELS[key]}“ dürfen nicht dieselbe Rolle sein.`);
    else used.set(id, key);
  }
  return { errors, value: out };
}

// Wirksame Discord-Werte: Umgebung vor Profil (wie bei der öffentlichen Adresse). sources = je Wert "env" | "profile" | "none".
function resolveDiscord({ env = {}, installation = null } = {}) {
  const prof = normalizeDiscord(installation?.discord || installation);
  const pick = (names, fromProfile) => {
    for (const name of names) {
      const v = cleanDiscordId(env[name]);
      if (v) return { id: v, source: "env" };
    }
    return fromProfile ? { id: fromProfile, source: "profile" } : { id: "", source: "none" };
  };
  const guild = pick(DISCORD_ENV_NAMES.guild, prof.guildId);
  const roles = {}, sources = { guild: guild.source, roles: {} };
  for (const key of DISCORD_ROLE_KEYS) {
    const r = pick(DISCORD_ENV_NAMES[key], prof.roles[key]);
    roles[key] = r.id;
    sources.roles[key] = r.source;
  }
  return { guildId: guild.id, roles, sources };
}

// Fehlende Pflichtwerte (Klartext) – ohne sie startet der Discord-Dienst nicht.
function missingDiscord(resolved) {
  const out = [];
  if (!resolved?.guildId) out.push("Discord-Server-ID");
  for (const key of DISCORD_ROLE_KEYS) if (!resolved?.roles?.[key]) out.push(`Rolle „${DISCORD_ROLE_LABELS[key]}“`);
  return out;
}

function normalizeOperatorLegal(src) {
  const s = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  const label = String(s.label ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
  let url = "";
  try { const u = new URL(String(s.url ?? "").trim()); if (u.protocol === "https:" && !u.username && !u.password) url = u.toString(); } catch { /* leer */ }
  return url ? { label: label || "Impressum", url } : { label: "", url: "" };
}

// Prüft die Eingabe für das Betreiber-Impressum; leere Adresse = nichts anzeigen. Rückgabe { errors, value }.
function validateOperatorLegal(src, current = normalizeOperatorLegal({})) {
  const errors = [];
  const s = src && typeof src === "object" ? src : {};
  const out = { ...current };
  if (Object.prototype.hasOwnProperty.call(s, "url")) {
    const raw = String(s.url ?? "").trim();
    if (!raw) { out.url = ""; out.label = ""; }
    else {
      let ok = false;
      try { const u = new URL(raw); ok = u.protocol === "https:" && !u.username && !u.password; } catch { /* ungültig */ }
      if (!ok) errors.push("Die Adresse des Impressums muss mit https:// beginnen.");
      else out.url = raw;
    }
  }
  if (Object.prototype.hasOwnProperty.call(s, "label")) out.label = String(s.label ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
  return errors.length ? { errors, value: current } : { errors, value: normalizeOperatorLegal(out) };
}

function normalizeBots(s) {
  const roster = require("./bot-roster");
  if (s.bots && typeof s.bots === "object") return roster.normalizeRoster(s.bots);
  return roster.normalizeRoster(String(s.source || "").startsWith("migration") ? require("./legacy-bwk-migration").legacyRoster() : roster.freshRoster());
}

function normalizeInstallation(src) {
  const s = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  const base = normalizeBaseUrl(s.publicBaseUrl);
  return {
    productName: cleanText(s.productName, 80) || NEUTRAL_PRODUCT_NAME,
    publicBaseUrl: base.ok ? base.url : "",
    setupCompletedAt: s.setupCompletedAt ? String(s.setupCompletedAt) : null,
    setupCompletedBy: s.setupCompletedBy ? cleanText(s.setupCompletedBy, 80) : null,
    source: cleanText(s.source, 40) || null,
    game: normalizeGame(s.game),
    discord: normalizeDiscord(s.discord),
    // 9.13.0: Textpaket. Nur die Übernahme einer Bestandsinstallation setzt „legacy-bwk“; es gibt keine Auswahl.
    textPack: s.textPack === "legacy-bwk" ? "legacy-bwk" : "neutral",
    // Betreiber-Impressum (optional, nur https). Der Urheberhinweis „Mario Janssen“ ist fest und hier nicht änderbar.
    operatorLegal: normalizeOperatorLegal(s.operatorLegal),
    // 9.14.0: hochgeladene Bilder je Bildplatz (Dateien liegen unter /data/uploads)
    images: require(require("path").join(__dirname, "image-slots")).normalizeImages(s.images),
    // 9.15.0: Bot-Liste (Haupt-Bot, weitere Bots, Kanal-Konto). Fehlt sie bei einer übernommenen Bestandsinstallation
    // (z. B. alte Sicherung), gelten deren bisherige fünf Bots; sonst der neutrale Haupt-Bot.
    bots: normalizeBots(s),
    // 9.22.0: Dokumentation der angenommenen Lizenz (Version, Zeitpunkt, Prüfsumme); null, solange die Ersteinrichtung offen ist.
    license: require("./license").normalizeAcceptance(s.license)
  };
}

function freshInstallation() {
  return normalizeInstallation({});
}

// Umgebung vor Oberfläche. locked = Feld in der Oberfläche gesperrt.
function resolvePublicBaseUrl({ envValue = "", installation = null } = {}) {
  const env = normalizeBaseUrl(envValue);
  if (String(envValue || "").trim()) {
    if (env.ok && env.url) return { url: env.url, source: "env", locked: true, warning: env.local ? "Nur lokal erreichbar (localhost)." : null };
    // Ungültiger Umgebungswert: wie bisher verwenden (abschließenden Schrägstrich entfernen), aber warnen.
    return { url: String(envValue).trim().replace(/\/$/, ""), source: "env", locked: true, warning: env.error || "PUBLIC_BASE_URL ist ungültig." };
  }
  const p = normalizeInstallation(installation).publicBaseUrl;
  if (p) return { url: p, source: "profile", locked: false, warning: normalizeBaseUrl(p).local ? "Nur lokal erreichbar (localhost)." : null };
  return { url: "", source: "none", locked: false, warning: "Es ist keine öffentliche Adresse eingerichtet. Overlays und Anmeldung über Twitch/Discord funktionieren erst danach." };
}

function isSetupPending(installation) {
  return !normalizeInstallation(installation).setupCompletedAt;
}

// Weiterleitungsadressen, die in den Entwicklerkonsolen von Twitch und Discord eingetragen werden müssen.
function redirectUrls(baseUrl) {
  const b = String(baseUrl || "").replace(/\/$/, "");
  if (!b) return null;
  return {
    twitchLogin: `${b}/auth/twitch/callback`,
    twitchConnect: `${b}/auth/connect/callback`,
    discord: `${b}/auth/discord/callback`,
    tiktok: `${b}/auth/tiktok/callback`
  };
}

// Einmaliger Einrichtungscode (ohne leicht verwechselbare Zeichen), z. B. „K7QF-2MXP-9RHC“.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function createSetupCode() {
  const bytes = crypto.randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}
function setupCodeMatches(input, code) {
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const a = Buffer.from(norm(input)), b = Buffer.from(norm(code));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Adresse aus der Browser-Adresszeile vorschlagen (nur als Vorschlag im Assistenten).
function suggestBaseUrl({ host = "", https = false } = {}) {
  const h = String(host || "").trim().toLowerCase();
  if (!/^[a-z0-9.\-:[\]]{1,255}$/.test(h)) return "";
  const hostname = h.replace(/:\d+$/, "");
  const local = LOCAL_HOSTS.has(hostname);
  const r = normalizeBaseUrl(`${https || !local ? "https" : "http"}://${h}`);
  return r.ok ? r.url : "";
}

// Kopfzeile: „XYZ Bot Control Center“ → „XYZ“ fett, Rest normal (so wie bisher); sonst alles fett.
function headerParts(productName) {
  const name = cleanText(productName, 80) || NEUTRAL_PRODUCT_NAME;
  const suffix = " Bot Control Center";
  if (name.length > suffix.length && name.endsWith(suffix)) return { strong: name.slice(0, -suffix.length), rest: suffix };
  return { strong: name, rest: "" };
}

module.exports = {
  NEUTRAL_PRODUCT_NAME, NEUTRAL_GAME, FIXED_GAME_COMMANDS, GAME_COMMAND_KEYS, GAME_COMMAND_LABELS, DEFAULT_LOCAL_NETWORK_CIDRS,
  normalizeBaseUrl, normalizeCommand, normalizeGame, validateGameCommands, normalizeInstallation, freshInstallation,
  resolvePublicBaseUrl, isSetupPending, redirectUrls, createSetupCode, setupCodeMatches, suggestBaseUrl, headerParts,
  normalizeOperatorLegal, validateOperatorLegal,
  DISCORD_ROLE_KEYS, DISCORD_ROLE_LABELS, DISCORD_ENV_NAMES, normalizeDiscord, validateDiscord, resolveDiscord, missingDiscord
};
