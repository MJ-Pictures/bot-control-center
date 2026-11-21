"use strict";
// 9.15.0 · Dynamische Bot-Liste (Profil & Branding).
// Eine Installation hat genau ein Kanal-Konto und mindestens einen Bot: den Haupt-Bot (Moderationsrechte).
// Weitere Bots lassen sich hinzufügen und entfernen. Jede Funktion wählt ihren sendenden Bot; ist der gewählte
// Bot nicht (mehr) vorhanden, sendet der Haupt-Bot (resolveBotKey).
// Gespeichert in settings.installation.bots = { bots:[{key,tokenKey,login,displayName,purpose,main}], channel:{...} }.
// Bestandsinstallation: dieselben fünf Bots und Schlüssel wie bisher (legacyRoster in legacy-bwk-migration.js), damit gespeicherte Einstellungen,
// Token-Dateien und Bot-Verweise unverändert weiterlaufen. Neue Installation: ein neutraler Haupt-Bot.
const KEY_RE = /^[a-z][a-z0-9_]{2,24}$/;
const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const MAX_BOTS = 10;
const RESERVED_KEYS = new Set(["channel", "bw", "helper", "giveaway", "clips", "live", "settings", "undefined", "null"]);

const NEUTRAL_MAIN_KEY = "mainbot";
const BOT_CHAT_SCOPES = ["user:read:chat", "user:write:chat", "user:bot"];

function clean(v, max) { return String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max); }
function freezeDeep(o) { return Object.freeze(o); }

function freshRoster() {
  return {
    bots: [{ key: NEUTRAL_MAIN_KEY, tokenKey: NEUTRAL_MAIN_KEY, login: "", displayName: "Haupt-Bot", purpose: "Haupt-Bot / technische Moderation / Antworten", main: true, roles: [] }],
    channel: { key: "channel", tokenKey: "channel", login: "", displayName: "Kanal-Konto" }
  };
}

// Bereinigt eine gespeicherte oder übergebene Liste. Garantiert: ein Kanal-Konto, mindestens ein Bot, genau ein Haupt-Bot,
// eindeutige Schlüssel und Logins. Unbrauchbare Einträge werden verworfen; ist nichts Brauchbares da, gilt der Standard.
function normalizeRoster(raw, fallback = freshRoster) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const seenKeys = new Set(), seenLogins = new Set(), bots = [];
  for (const b of Array.isArray(src.bots) ? src.bots : []) {
    if (!b || typeof b !== "object") continue;
    const key = String(b.key || "").toLowerCase();
    const login = String(b.login ?? "").toLowerCase().trim();
    if (!KEY_RE.test(key) || seenKeys.has(key) || RESERVED_KEYS.has(key)) continue;
    if (login && (!LOGIN_RE.test(login) || seenLogins.has(login))) continue;
    seenKeys.add(key); if (login) seenLogins.add(login);
    const tokenKey = String(b.tokenKey || key);
    if (!/^[a-z][a-z0-9_]{1,24}$/.test(tokenKey)) continue;
    bots.push({ key, tokenKey, login, displayName: clean(b.displayName, 40) || login || key, purpose: clean(b.purpose, 120), main: b.main === true, roles: (Array.isArray(b.roles) ? b.roles : []).map(r => String(r)).filter(r => /^[a-z]{3,12}$/.test(r)).slice(0, 4) });
    if (bots.length >= MAX_BOTS) break;
  }
  if (!bots.length) return normalizeRoster(fallback(), freshRoster);
  const mainIndex = Math.max(0, bots.findIndex(b => b.main));
  bots.forEach((b, i) => { b.main = i === mainIndex; });
  const c = src.channel && typeof src.channel === "object" ? src.channel : {};
  const cl = String(c.login ?? "").toLowerCase().trim();
  const channel = {
    key: KEY_RE.test(String(c.key || "").toLowerCase()) && !seenKeys.has(String(c.key).toLowerCase()) ? String(c.key).toLowerCase() : "channel",
    tokenKey: "channel",
    login: LOGIN_RE.test(cl) ? cl : "",
    displayName: clean(c.displayName, 40) || "Kanal-Konto"
  };
  // legacyFiles: Token-Dateien der Bestandsinstallation (FILES in bcc-core) bleiben in Gebrauch.
  return { bots, channel, legacyFiles: src.legacyFiles === true };
}

function mainBot(roster) { return roster.bots.find(b => b.main) || roster.bots[0]; }
function botKeys(roster) { return roster.bots.map(b => b.key); }
// Gewählter Bot oder – wenn es ihn nicht gibt (entfernt, nie vorhanden) – der Haupt-Bot.
function resolveBotKey(roster, key) {
  const k = String(key || "");
  return roster.bots.some(b => b.key === k) ? k : mainBot(roster).key;
}
// Voreinstellung für eine Funktion: der Bot mit dieser Rolle (nur Bestandsinstallation: helper, giveaway, clips, live),
// sonst der Haupt-Bot. Vorbelegung, keine Pflicht – jede Funktion kann ihren Bot selbst wählen.
function defaultBotFor(roster, role) {
  const b = roster.bots.find(x => (x.roles || []).includes(role));
  return (b || mainBot(roster)).key;
}
function hasBot(roster, key) { return roster.bots.some(b => b.key === String(key || "")); }

// Kontenliste im Format von twitchAccountDefs (Weboberfläche und Twitch-Laufzeit).
function accountDefsFromRoster(roster, mainScopes, channelLoginFallback = "", extraChannelScopes = []) {
  const main = mainBot(roster);
  const defs = roster.bots.map(b => ({
    key: b.key, tokenKey: b.tokenKey, login: b.login, displayName: b.displayName, type: "bot",
    purpose: b.purpose || (b.main ? "Haupt-Bot" : "Bot"),
    requiredScopes: b.key === main.key ? [...mainScopes] : [...BOT_CHAT_SCOPES]
  }));
  defs.push({
    key: roster.channel.key, tokenKey: roster.channel.tokenKey, login: String(channelLoginFallback || "") || roster.channel.login,
    displayName: roster.channel.displayName, type: "channel",
    purpose: "Kanal-Berechtigungen / Follow-Events / Bot-Zulassung", requiredScopes: ["channel:bot", "moderator:read:followers", ...extraChannelScopes]
  });
  return defs.map(d => Object.freeze({ ...d, requiredScopes: Object.freeze([...d.requiredScopes]) }));
}

// Prüfung einer Eingabe aus der Oberfläche (Hinzufügen/Entfernen/Umbenennen). Liefert { errors, value }.
function validateRosterInput(raw, current) {
  const errors = [];
  const src = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(src.bots) ? src.bots : [];
  if (!list.length) errors.push("Es muss mindestens ein Bot (der Haupt-Bot) vorhanden sein.");
  if (list.length > MAX_BOTS) errors.push(`Höchstens ${MAX_BOTS} Bots.`);
  const keys = new Set(), logins = new Set();
  let mains = 0;
  list.forEach((b, i) => {
    const n = i + 1;
    const login = String(b?.login ?? "").toLowerCase().trim();
    if (!LOGIN_RE.test(login)) errors.push(`Bot ${n}: Twitch-Login fehlt oder ist ungültig (3–25 Zeichen: a–z, 0–9, _).`);
    else if (logins.has(login)) errors.push(`Bot ${n}: Login „${login}“ kommt doppelt vor.`);
    logins.add(login);
    if (b?.main === true) mains++;
    const key = String(b?.key || "").toLowerCase();
    if (key) { if (keys.has(key)) errors.push(`Bot ${n}: Schlüssel doppelt.`); keys.add(key); }
  });
  if (list.length && mains !== 1) errors.push("Genau ein Bot muss der Haupt-Bot sein.");
  const cl = String(src.channel?.login ?? "").toLowerCase().trim();
  if (cl && !LOGIN_RE.test(cl)) errors.push("Kanal-Login ist ungültig.");
  if (errors.length) return { errors, value: current };
  // Neue Bots (ohne Schlüssel) bekommen einen neutralen Schlüssel aus dem Login; bestehende behalten ihren Schlüssel und Token.
  const currentByKey = new Map((current?.bots || []).map(b => [b.key, b]));
  const taken = new Set([...currentByKey.keys(), ...keys]);
  const prepared = list.map(b => {
    let key = String(b.key || "").toLowerCase();
    if (!key || !currentByKey.has(key)) {
      let base = ("b_" + String(b.login).toLowerCase()).slice(0, 24).replace(/_+$/, "");
      key = KEY_RE.test(base) ? base : "bot_" + Math.random().toString(36).slice(2, 8);
      let n = 2; while (taken.has(key) || RESERVED_KEYS.has(key)) key = (base.slice(0, 21) + "_" + n++);
      taken.add(key);
      return { ...b, key, tokenKey: key, roles: [] };
    }
    return { ...b, key, tokenKey: currentByKey.get(key).tokenKey, roles: currentByKey.get(key).roles || [] };
  });
  const value = normalizeRoster({ bots: prepared, legacyFiles: current?.legacyFiles === true, channel: { ...(current?.channel || {}), ...(src.channel || {}), key: current?.channel?.key, tokenKey: "channel" } }, () => current || freshRoster());
  return { errors: [], value };
}

// Welche bisherigen Bot-Verweise würden beim Entfernen auf den Haupt-Bot fallen? (für die Warnung)
function removedKeys(before, after) {
  const now = new Set(botKeys(after));
  return botKeys(before).filter(k => !now.has(k));
}

// Bot-Liste und Haupt-Bot aus den Einstellungen (settings.installation.bots); ohne Profil: neutral.
function rosterOfSettings(settings) {
  const inst = settings && typeof settings === "object" ? settings.installation : null;
  return require("./installation-profile").normalizeInstallation(inst || {}).bots;
}
function mainKeyOfSettings(settings) { return mainBot(rosterOfSettings(settings)).key; }

module.exports = { rosterOfSettings, mainKeyOfSettings, KEY_RE, LOGIN_RE, MAX_BOTS, NEUTRAL_MAIN_KEY, BOT_CHAT_SCOPES, freshRoster, normalizeRoster, mainBot, botKeys, resolveBotKey, defaultBotFor, hasBot, accountDefsFromRoster, validateRosterInput, removedKeys };
