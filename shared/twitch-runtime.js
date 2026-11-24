"use strict";
// Twitch-Laufzeit des Control Centers (Entkopplung 1d/3b).
// Enthält alles, was im Twitch-Bot läuft: Konten und Tokens, Chat-Versand, Moderation,
// Chat-Verarbeitung, EventSub, Timer, Follower-Cache, Watchtime-Erfassung, Nachrichtenzähler,
// Clip-Monitor und die Discord-Brücke. Erzeugt wird sie über createTwitchRuntime(deps):
// im Ein-Container-Betrieb von der Weboberfläche (app/server.js), im getrennten Betrieb vom
// Twitch-Bot (twitch-app/twitch-server.js). Nach außen gibt es nur das Objekt twitchRuntime.
// Die Datei liegt in /shared, weil dieser Ordner in beiden Containern eingebunden ist.
// Was die Laufzeit braucht, steht ausschließlich in "deps" (siehe REQUIRED_DEPS).
// Der Inhalt wurde unverändert aus server.js übernommen; deshalb ist er nicht eingerückt.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

// 9.13.0: erst bei Gebrauch laden (/shared-Module werden nicht beim Laden der Datei angefordert)
const textPack = { get: (...a) => require("/shared/text-pack").get(...a) };
const REQUIRED_DEPS = Object.freeze(["matchWordFilter", "CLIENT_ID", "CLIENT_SECRET", "CHANNEL_LOGIN", "DATA_DIR", "FILES", "DEFAULT_SETTINGS", "pgStore", "wordFilterCentralReady", "twitchWordFilterEscalation", "wordFilterRefresh", "wordFilterAction", "twitchEvents", "giveawayStore", "readJson", "writeJson", "audit", "twitchAppFetch", "discordServiceRequest", "readGiveawayState", "writeGiveawayState", "berlinDateKey", "readUsageStats", "emptyUsageStat", "readWatchtime", "writeWatchtime", "prepareSettings", "normalizeClipSettings", "readClipState"]);

function createTwitchRuntime(deps) {
  for (const name of REQUIRED_DEPS) if (deps?.[name] === undefined) throw new Error(`Twitch-Laufzeit: Abhängigkeit fehlt: ${name}`);
  const {matchWordFilter, CLIENT_ID, CLIENT_SECRET, CHANNEL_LOGIN, DATA_DIR, FILES, DEFAULT_SETTINGS, pgStore, wordFilterCentralReady, twitchWordFilterEscalation, wordFilterRefresh, wordFilterAction, twitchEvents, giveawayStore, readJson, writeJson, audit, twitchAppFetch, discordServiceRequest,
    // Datenfunktionen aus /shared/twitch-data.js (8.9.21)
    readGiveawayState, writeGiveawayState, berlinDateKey, readUsageStats, emptyUsageStat, readWatchtime, writeWatchtime, prepareSettings, normalizeClipSettings, readClipState} = deps;

// 8.9.20: Stammdaten kommen aus /shared/twitch-accounts.js (gemeinsam mit der Weboberfläche);
// nur hier, beim Besitzer der Tokens, kommt der Pfad der Token-Datei dazu.
const {twitchAccountDefs} = require("/shared/twitch-accounts");
const botRoster = require("/shared/bot-roster");
const {describeFetchError, clipLookbackMinutes, clipDelaySeconds} = require("/shared/clip-resilience");
// 9.15.0 · Dynamische Bot-Liste: Die Konten kommen aus settings.installation.bots (Haupt-Bot, weitere Bots, Kanal-Konto).
// accountMap wird bei Änderungen der Liste an Ort und Stelle neu aufgebaut (syncAccounts); Token-Dateien der Bestandsinstallation
// bleiben in FILES, neue Bots bekommen <schlüssel>-token.json im Datenordner.
const accountMap = {};
let rosterSignature = "";
let currentRoster = botRoster.freshRoster();
function rosterFromSettings() {
  const st = readJson(FILES.settings, DEFAULT_SETTINGS) || {};
  if (st.installation && typeof st.installation === "object") return require("/shared/installation-profile").normalizeInstallation(st.installation).bots;
  // Profil noch nicht angelegt (Web-Dienst startet später): Bestehen die bisherigen Token-Dateien, gilt die Bestandsliste.
  return fs.existsSync(FILES.bw) ? botRoster.normalizeRoster(require("/shared/legacy-bwk-migration").legacyRoster()) : botRoster.freshRoster();
}
function tokenFileFor(roster, tokenKey) {
  return roster.legacyFiles && FILES[tokenKey] ? FILES[tokenKey] : require("path").join(DATA_DIR, `${tokenKey}-token.json`);
}
// 9.20.0: Modul „Subathon“ an? (beim ersten Aufruf beim Laden noch nicht lesbar → aus)
function subathonModuleOn() { try { return isModuleEnabled(normalizeModuleSettings(prepareSettings(readJson(FILES.settings, DEFAULT_SETTINGS))), "subathon"); } catch { return false; } }
function syncAccounts(force) {
  let roster;
  try { roster = rosterFromSettings(); } catch { return false; }
  const subathonOn = subathonModuleOn();
  const sig = JSON.stringify(roster) + "|" + CHANNEL_LOGIN + "|subathon:" + subathonOn;
  if (!force && sig === rosterSignature) return false;
  rosterSignature = sig; currentRoster = roster;
  for (const k of Object.keys(accountMap)) delete accountMap[k];
  for (const d of twitchAccountDefs(CHANNEL_LOGIN, roster, {subathon: subathonOn})) {
    accountMap[d.key] = {tokenFile: tokenFileFor(roster, d.tokenKey), login: d.login, displayName: d.displayName, type: d.type, purpose: d.purpose, requiredScopes: [...d.requiredScopes]};
  }
  return true;
}
syncAccounts(true);
const mainBotKey = () => botRoster.mainBot(currentRoster).key;
const mainBotName = () => botRoster.mainBot(currentRoster).displayName || "Haupt-Bot";
const resolveBot = key => botRoster.resolveBotKey(currentRoster, key);
const clipBotKey = () => resolveBot(readJson(FILES.settings, DEFAULT_SETTINGS)?.clipSharing?.bot || botFor("clips"));
const botFor = role => botRoster.defaultBotFor(currentRoster, role);
const channelLogin = () => accountMap[currentRoster.channel.key]?.login || CHANNEL_LOGIN;

function loadToken(name) {
  const a = accountMap[name];
  if (!a || !fs.existsSync(a.tokenFile)) throw new Error(`Token fehlt für ${name}`);
  return readJson(a.tokenFile);
}
function saveToken(name, token) {
  writeJson(accountMap[name].tokenFile, token);
}
async function refreshToken(name) {
  const old = loadToken(name);
  if (!old.refresh_token) throw new Error(`Kein Refresh Token für ${name}`);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: old.refresh_token
  });
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {"Content-Type":"application/x-www-form-urlencoded"},
    body: params
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Token refresh fehlgeschlagen ${name}: ${r.status} ${JSON.stringify(j)}`);
  const merged = {
    ...old,
    ...j,
    refresh_token: j.refresh_token || old.refresh_token,
    scope: j.scope || old.scope || [],
    refreshed_at: new Date().toISOString()
  };
  saveToken(name, merged);
  console.log(`✅ Token aktualisiert: ${name}`);
  return merged;
}
async function twitchFetch(name, url, options={}) {
  let token = loadToken(name);
  const doFetch = (t) => fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${t.access_token}`,
      "Client-Id": CLIENT_ID
    }
  });
  let r = await doFetch(token);
  if (r.status === 401) {
    token = await refreshToken(name);
    r = await doFetch(token);
  }
  return r;
}

// 8.9.17 · Entkopplung 1c: Token-Prüfung und Verbindungsstatus gehören zur Twitch-Laufzeit (Besitzer der Tokens).
async function validateUserToken(accessToken) {
  const r = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` }
  });
  if (!r.ok) return null;
  return r.json();
}

async function connectionStatus(name) {
  syncAccounts();
  const meta = accountMap[name];
  if (!meta) return null;

  const base = {
    key: name,
    login: meta.login,
    displayName: meta.displayName,
    purpose: meta.purpose,
    type: meta.type,
    requiredScopes: meta.requiredScopes,
    moderationCapable: name === mainBotKey(),
    connected: false,
    valid: false,
    authorizedLogin: null,
    authorizedUserId: null,
    scopes: [],
    missingScopes: [...meta.requiredScopes],
    expiresIn: null
  };

  if (!fs.existsSync(meta.tokenFile)) return base;

  let token = readJson(meta.tokenFile, {});
  if (!token.access_token) return base;

  let validation = await validateUserToken(token.access_token);

  if (!validation && token.refresh_token) {
    try {
      token = await refreshToken(name);
      validation = await validateUserToken(token.access_token);
    } catch (e) {
      return {...base, connected:true, error:e.message};
    }
  }

  if (!validation) return {...base, connected:true, error:"Token ungültig"};

  const scopes = validation.scopes || token.scope || [];
  const missingScopes = meta.requiredScopes.filter(s => !scopes.includes(s));

  return {
    ...base,
    connected: true,
    valid: validation.login?.toLowerCase() === meta.login.toLowerCase() && missingScopes.length === 0,
    authorizedLogin: validation.login || null,
    authorizedUserId: validation.user_id || null,
    scopes,
    missingScopes,
    expiresIn: validation.expires_in ?? null,
    wrongAccount: !!validation.login && validation.login.toLowerCase() !== meta.login.toLowerCase()
  };
}

async function getSelf(name) {
  const r = await twitchFetch(name, "https://api.twitch.tv/helix/users");
  const j = await r.json();
  if (!r.ok || !j.data?.[0]) throw new Error(`User-ID nicht ermittelbar für ${name}: ${JSON.stringify(j)}`);
  return j.data[0];
}
async function getUserByLogin(authName, login) {
  const r = await twitchFetch(authName, `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`);
  const j = await r.json();
  if (!r.ok || !j.data?.[0]) throw new Error(`User nicht gefunden: ${login}`);
  return j.data[0];
}

const ids = {};
async function resolveIds() {
  syncAccounts();
  const main = mainBotKey();
  ids[main] = (await getSelf(main)).id;
  ids.channel = (await getUserByLogin(main, channelLogin())).id;

  for (const name of currentRoster.bots.map(b => b.key).filter(k => k !== main)) {
    try {
      if (fs.existsSync(accountMap[name].tokenFile)) {
        ids[name] = (await getSelf(name)).id;
      }
    } catch (e) {
      console.error(`⚠️ ID für ${name} konnte nicht geladen werden:`, e.message);
    }
  }

  console.log("✅ Twitch IDs geladen", ids);
}
// Twitch begrenzt das Senden pro Bot-Account: 20 Nachrichten / 30 s, mit
// Moderator-, VIP- oder Broadcaster-Status 100 / 30 s. Die Warteschlange hält
// bewusst etwas Abstand zu diesen Grenzen. Moderator-Bots per Umgebungsvariable
// CHAT_SEND_MOD_BOTS (kommagetrennt, Standard: der Haupt-Bot).
const {createChatSendQueue} = require("/shared/chat-send-queue");
const CHAT_SEND_MOD_BOTS = new Set(String(process.env.CHAT_SEND_MOD_BOTS || "").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean));
function chatSendLimits(bot) {
  const isMod = CHAT_SEND_MOD_BOTS.size ? CHAT_SEND_MOD_BOTS.has(String(bot || "").toLowerCase()) : String(bot || "") === mainBotKey();
  return isMod
    ? { windowMax: 90, windowMs: 30000, minIntervalMs: 350 }
    : { windowMax: 17, windowMs: 30000, minIntervalMs: 1200 };
}

// Der eigentliche Twitch-Aufruf. Gibt zurück, ob Twitch die Nachricht angenommen
// hat und ob ein Rate-Limit gemeldet wurde (dann wiederholt die Warteschlange).
async function sendChatNow(bot, message) {
  if (!ids[bot] && accountMap[bot] && fs.existsSync(accountMap[bot].tokenFile)) { try { ids[bot] = (await getSelf(bot)).id; } catch {} }
  const senderId = ids[bot];
  if (!senderId || !ids.channel) return { ok: false, reason: "no-sender" };

  // Für den offiziellen Twitch Chat Bot Badge muss die Nachricht mit
  // einem App Access Token über Send Chat Message gesendet werden.
  const r = await twitchAppFetch(
    "https://api.twitch.tv/helix/chat/messages",
    {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        broadcaster_id: ids.channel,
        sender_id: senderId,
        message: String(message).slice(0, 500)
      })
    }
  );

  const j = await r.json().catch(()=>({}));
  const entry = j?.data?.[0];
  if (r.ok && entry?.is_sent) return { ok: true };

  const dropText = `${entry?.drop_reason?.code || ""} ${entry?.drop_reason?.message || ""}`;
  const rateLimited = r.status === 429 || r.status >= 500 || /rate/i.test(dropText);
  console.error(`Chat nicht gesendet (${bot}, HTTP ${r.status}${rateLimited ? ", Rate-Limit/Serverfehler" : ""}):`, j);
  return { ok: false, rateLimited, reason: "failed" };
}

const chatSendQueue = createChatSendQueue({
  send: sendChatNow,
  limitsFor: chatSendLimits,
  logger: msg => console.warn("⚠️", msg)
});

// Reiht die Nachricht in die Warteschlange des Bots ein und wartet, bis sie
// gesendet oder verworfen wurde. Rückgabe: { ok, dropped, reason }.
async function sendChat(bot, message, opts) {
  if (!message) return { ok: false, dropped: false, reason: "no-sender" };
  syncAccounts();
  bot = resolveBot(bot);
  const result = await chatSendQueue.enqueue(bot, message, opts);
  // 9.27.0: Gesendete Bot-Nachrichten gehen (ohne Warten) an das Chat-Overlay; ob sie dort erscheinen, entscheidet dessen Einstellung.
  if (result?.ok) {
    try {
      const a = accountMap[bot] || {};
      emitChatOverlay("chat-sent", { source: String(opts?.source || "bot").slice(0, 40), name: a.displayName || a.login || "Bot", text: String(message).slice(0, 500) });
    } catch {}
  }
  return result;
}

// 9.27.0: Chat-Overlay-Ereignisse laufen nacheinander (Reihenfolge bleibt erhalten), werden genau einmal versucht und
// nie in die Wiederholungs-Warteschlange gelegt. Staut sich etwas, fallen die neuesten Ereignisse weg.
let chatOverlayChain = Promise.resolve(), chatOverlayDepth = 0;
function emitChatOverlay(type, payload) {
  if (chatOverlayDepth >= 50) return;
  chatOverlayDepth++;
  const send = typeof twitchEvents.emitTransient === "function" ? twitchEvents.emitTransient.bind(twitchEvents) : twitchEvents.emit.bind(twitchEvents);
  chatOverlayChain = chatOverlayChain.then(() => send(type, payload)).catch(() => {}).finally(() => { chatOverlayDepth--; });
}


function normalizeBlockedWord(item) {
  if (!item || typeof item !== "object") return item;
  if (!["detect","delete","twitch_block"].includes(String(item.action || ""))) item.action = "detect";
  if (typeof item.enabled !== "boolean") item.enabled = true;
  if (typeof item.response !== "string") item.response = "";
  if (!item.bot) item.bot = botFor("main");
  return item;
}

async function listTwitchBlockedTerms() {
  if (!ids.channel || !ids[mainBotKey()]) throw new Error("Twitch IDs für Blocked Terms fehlen.");

  let after = null;
  const items = [];

  do {
    const url = new URL("https://api.twitch.tv/helix/moderation/blocked_terms");
    url.searchParams.set("broadcaster_id", ids.channel);
    url.searchParams.set("moderator_id", ids[mainBotKey()]);
    url.searchParams.set("first", "100");
    if (after) url.searchParams.set("after", after);

    const r = await twitchFetch(mainBotKey(), url.toString());
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(`Blocked Terms konnten nicht geladen werden (${r.status}): ${JSON.stringify(j)}`);

    items.push(...(j.data || []));
    after = j.pagination?.cursor || null;
  } while (after && items.length < 500);

  return items;
}

async function addTwitchBlockedTerm(text) {
  const url = new URL("https://api.twitch.tv/helix/moderation/blocked_terms");
  url.searchParams.set("broadcaster_id", ids.channel);
  url.searchParams.set("moderator_id", ids[mainBotKey()]);

  const r = await twitchFetch(mainBotKey(), url.toString(), {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({text:String(text || "").trim()})
  });
  const j = await r.json().catch(()=>({}));
  if (!r.ok || !j.data?.[0]) throw new Error(`Blocked Term konnte nicht angelegt werden (${r.status}): ${JSON.stringify(j)}`);

  return j.data[0];
}

async function removeTwitchBlockedTerm(termId) {
  if (!termId) return;

  const url = new URL("https://api.twitch.tv/helix/moderation/blocked_terms");
  url.searchParams.set("broadcaster_id", ids.channel);
  url.searchParams.set("moderator_id", ids[mainBotKey()]);
  url.searchParams.set("id", termId);

  const r = await twitchFetch(mainBotKey(), url.toString(), {method:"DELETE"});
  if (r.status !== 204) {
    const body = await r.text();
    throw new Error(`Blocked Term konnte nicht entfernt werden (${r.status}): ${body}`);
  }
}


async function reconcileTwitchBlockedTerms(beforeSettings, afterSettings, actor) {
  const before = (beforeSettings.blockedWords || []).map(x => normalizeBlockedWord({...x}));
  const after = (afterSettings.blockedWords || []).map(x => normalizeBlockedWord({...x}));
  afterSettings.blockedWords = after;

  const oldById = new Map(before.map(x => [String(x.id || ""), x]));
  const remoteTerms = await listTwitchBlockedTerms();
  const remoteByText = new Map(remoteTerms.map(x => [String(x.text || "").trim().toLowerCase(), x]));

  for (const oldItem of before) {
    const oldId = String(oldItem.id || "");
    const next = after.find(x => String(x.id || "") === oldId);

    const wasTwitch = oldItem.action === "twitch_block" && oldItem.enabled;
    const staysTwitch =
      next &&
      next.action === "twitch_block" &&
      next.enabled &&
      String(next.word || "").trim().toLowerCase() === String(oldItem.word || "").trim().toLowerCase();

    if (wasTwitch && !staysTwitch) {
      const termId = oldItem.twitchTermId || remoteByText.get(String(oldItem.word || "").trim().toLowerCase())?.id;
      if (termId) {
        await removeTwitchBlockedTerm(termId);
        audit(actor,"blocked-term.removed",{section:"blockedWords",word:oldItem.word,twitchTermId:termId});
      }
    }
  }

  for (const item of after) {
    item.twitchTermId = item.twitchTermId || null;
    item.twitchSyncStatus = null;
    item.twitchSyncError = null;

    if (!(item.enabled && item.action === "twitch_block")) {
      item.twitchTermId = null;
      continue;
    }

    const word = String(item.word || "").trim();
    if (word.length < 2) {
      item.twitchSyncStatus = "error";
      item.twitchSyncError = "Twitch Blocked Terms benötigen mindestens 2 Zeichen.";
      continue;
    }

    const old = oldById.get(String(item.id || ""));
    const unchanged =
      old &&
      old.action === "twitch_block" &&
      old.enabled &&
      String(old.word || "").trim().toLowerCase() === word.toLowerCase() &&
      old.twitchTermId;

    if (unchanged) {
      item.twitchTermId = old.twitchTermId;
      item.twitchSyncStatus = "synced";
      continue;
    }

    const existing = remoteByText.get(word.toLowerCase());
    const term = existing || await addTwitchBlockedTerm(word);

    item.twitchTermId = term.id;
    item.twitchSyncStatus = "synced";
    remoteByText.set(word.toLowerCase(), term);

    audit(actor,"blocked-term.synced",{section:"blockedWords",word,twitchTermId:term.id});
  }
}

const cooldowns = new Map();
// 9.13.0: Einladungstexte aus dem Textpaket der Installation
const discordInviteTexts=()=>textPack.get(readJson(FILES.settings, DEFAULT_SETTINGS)).discord;
function render(template, vars={}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}
function isBotUser(login) {
  const wanted=String(login||"").toLowerCase();
  return Object.values(accountMap).some(a=>a?.type==="bot"&&String(a.login||"").toLowerCase()===wanted);
}


function chatBadges(ev) {
  return Array.isArray(ev?.badges) ? ev.badges : [];
}

function hasChatBadge(ev, badgeId) {
  const wanted = String(badgeId || "").toLowerCase();
  return chatBadges(ev).some(b => String(b.set_id || "").toLowerCase() === wanted);
}

function isModeratorMessage(ev) {
  return hasChatBadge(ev,"moderator");
}

function isVipMessage(ev) {
  return hasChatBadge(ev,"vip");
}

function isBroadcasterMessage(ev) {
  return String(ev?.chatter_user_id || "") === String(ids.channel || "");
}

// Ab 8.9.4 in shared/link-detect.js: echte Domain-Endungen, keine Satzanfänge wie "toll.Und".
const {extractUrls} = require("/shared/link-detect");
// 9.27.0: Chat-Overlay – Nachrichten und Löschereignisse verdichten (gemeinsam mit der Weboberfläche genutzt).
const {compactChatEvent, compactDeleteEvent} = require("/shared/chat-overlay-core");
// 9.1.0: Lurk-Rückkehr. Zustand liegt in einer kleinen Datei (kein PostgreSQL nötig) und überlebt Neustarts.
const {createLurkReturn, handleLurkChat, normalizeLurkSettings} = require("/shared/lurk-return");
// 9.1.1: Modulschalter. Ist das Modul aus, läuft nichts (kein Erfassen, keine Pflege, kein Schreiben); die Daten bleiben erhalten.
const {normalizeModuleSettings, isModuleEnabled, wordFilterActiveFor} = require("/shared/modules");
const lurkModuleOn = () => isModuleEnabled(normalizeModuleSettings(normalizeLurkSettings(prepareSettings(readJson(FILES.settings, DEFAULT_SETTINGS)))), "lurkReturn");
const lurkReturn = createLurkReturn({
  load: () => readJson(FILES.lurkReturn, null),
  save: state => writeJson(FILES.lurkReturn, state),
  logger: (what, err) => console.warn(`⚠️ Lurk-Rückkehr (${what}):`, err?.message || err)
});
const lurkTimer = setInterval(() => {
  try { if (!lurkModuleOn()) return; lurkReturn.prune(normalizeLurkSettings(prepareSettings(readJson(FILES.settings, DEFAULT_SETTINGS)))); lurkReturn.flush(); }
  catch (e) { console.warn("⚠️ Lurk-Rückkehr (Pflege):", e.message); }
}, 30_000);
if (typeof lurkTimer.unref === "function") lurkTimer.unref();

function normalizeDomainFromUrl(raw) {
  try {
    let value = String(raw || "").trim();
    if (!/^https?:\/\//i.test(value)) value = "https://" + value.replace(/^www\./i, "");
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host;
  } catch {
    return "";
  }
}

function domainAllowed(host, whitelist) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  return (whitelist || []).some(entry => {
    const w = String(entry || "").trim().toLowerCase().replace(/^www\./, "");
    return w && (h === w || h.endsWith("." + w));
  });
}

function userWhitelisted(ev, whitelistUsers) {
  const login = String(ev?.chatter_user_login || "").toLowerCase();
  return (whitelistUsers || []).some(u => String(u || "").trim().toLowerCase() === login);
}

function countEmotes(ev) {
  const fragments = Array.isArray(ev?.message?.fragments) ? ev.message.fragments : [];
  return fragments.filter(f => String(f?.type || "").toLowerCase() === "emote").length;
}

function countSymbols(text) {
  // Punkt und Komma zählen bewusst NICHT als Sonderzeichen,
  // damit normale Zeichensetzung den Filter nicht auslöst.
  // Gezählt werden z. B. ! ? # $ % & * + = usw.
  const matches = String(text || "").match(/[^\p{L}\p{N}\s.,]/gu);
  return matches ? matches.length : 0;
}

function countCaps(text) {
  // Nicht alle Großbuchstaben eines normalen Satzes aufsummieren.
  // Entscheidend ist die längste zusammenhängende Folge von Großbuchstaben.
  // Beispiel bei Limit 12:
  // "Hallo Mario, Das Ist Normal" => 1
  // "DASISTJETZTWIRKLICHLAUT" => 22
  const runs = String(text || "").match(/\p{Lu}+/gu) || [];
  return runs.reduce((max, run) => Math.max(max, [...run].length), 0);
}

const moderationFilterLabels = {
  links: "Links",
  emotes: "Zu viele Emotes",
  symbols: "Zu viele Sonderzeichen",
  caps: "Zu viele Großbuchstaben"
};

async function deleteChatMessageWithMainBot(messageId) {
  if (!messageId) throw new Error("message_id fehlt.");
  if (!ids.channel || !ids[mainBotKey()]) throw new Error("Twitch IDs für Moderation fehlen.");

  const url = new URL("https://api.twitch.tv/helix/moderation/chat");
  url.searchParams.set("broadcaster_id", ids.channel);
  url.searchParams.set("moderator_id", ids[mainBotKey()]);
  url.searchParams.set("message_id", messageId);

  const r = await twitchFetch(mainBotKey(), url.toString(), { method:"DELETE" });
  if (r.status !== 204) {
    const body = await r.text();
    throw new Error(`Nachricht löschen fehlgeschlagen (${r.status}): ${body}`);
  }
}

async function timeoutUserWithMainBot(userId, duration, reason) {
  if (!userId) throw new Error("user_id fehlt.");
  if (!ids.channel || !ids[mainBotKey()]) throw new Error("Twitch IDs für Moderation fehlen.");

  const seconds = Math.min(1_209_600, Math.max(1, Number(duration || 1)));
  const url = new URL("https://api.twitch.tv/helix/moderation/bans");
  url.searchParams.set("broadcaster_id", ids.channel);
  url.searchParams.set("moderator_id", ids[mainBotKey()]);

  const r = await twitchFetch(mainBotKey(), url.toString(), {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      data:{
        user_id:String(userId),
        duration:seconds,
        reason:String(reason || "Automatischer Chat-Filter").slice(0,500)
      }
    })
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Timeout fehlgeschlagen (${r.status}): ${body}`);
  }

  return r.json().catch(()=>({}));
}

async function handleModerationDetection(ev, filterName, filter, detail={}) {
  const targetLogin = ev.chatter_user_login || ev.chatter_user_name || "unknown";
  const label = moderationFilterLabels[filterName] || filterName;
  const messageId = ev.message_id || null;
  const userId = ev.chatter_user_id || null;

  audit(mainBotName(), `moderation.${filterName}.detected`, {
    section:"moderation",
    target:targetLogin,
    targetUserId:userId,
    messageId,
    message:ev.message?.text || "",
    filterLabel:label,
    ...detail
  });

  // 1) Regelwidrige Nachricht sofort entfernen.
  try {
    await deleteChatMessageWithMainBot(messageId);
    audit(mainBotName(),"moderation.message.deleted",{
      section:"moderation",
      target:targetLogin,
      targetUserId:userId,
      messageId,
      filter:filterName,
      filterLabel:label
    });
  } catch (e) {
    console.error("⚠️ Moderations-Löschung fehlgeschlagen:", e.message);
    audit(mainBotName(),"moderation.action.failed",{
      section:"moderation",
      action:"delete",
      target:targetLogin,
      messageId,
      filter:filterName,
      error:e.message
    });
  }

  // 2) Hinweis kann weiterhin über den pro Filter gewählten Bot kommen.
  if (filter.timeoutMessageEnabled && filter.timeoutMessage) {
    await sendChat(
      filter.reactionBot || mainBotKey(),
      render(filter.timeoutMessage, { user: ev.chatter_user_name })
    );
  }

  // 3) Timeout ist pro Filter optional.
  if (filter.timeoutEnabled !== false) {
    const delayMs = Math.max(0, Number(filter.warningSeconds || 0)) * 1000;
    const timeoutSeconds = Math.min(1_209_600, Math.max(1, Number(filter.timeoutSeconds || 1)));

    setTimeout(async()=>{
      try {
        await timeoutUserWithMainBot(
          userId,
          timeoutSeconds,
          `Automatischer Filter: ${label}`
        );
        audit(mainBotName(),"moderation.timeout.applied",{
          section:"moderation",
          target:targetLogin,
          targetUserId:userId,
          filter:filterName,
          filterLabel:label,
          timeoutSeconds,
          warningSeconds:Number(filter.warningSeconds || 0)
        });
      } catch (e) {
        console.error("⚠️ Moderations-Timeout fehlgeschlagen:", e.message);
        audit(mainBotName(),"moderation.action.failed",{
          section:"moderation",
          action:"timeout",
          target:targetLogin,
          targetUserId:userId,
          filter:filterName,
          error:e.message
        });
      }
    }, delayMs);
  } else {
    audit(mainBotName(),"moderation.delete.only",{
      section:"moderation",
      target:targetLogin,
      targetUserId:userId,
      filter:filterName,
      filterLabel:label
    });
  }

  return true;
}

function ensureModerationSettings(settings) {
  settings.moderation ||= {};

  settings.moderation.global ||= {};
  const global = settings.moderation.global;

  if (!Array.isArray(global.whitelistUsers)) global.whitelistUsers = [];
  if (typeof global.exemptModerators !== "boolean") global.exemptModerators = true;
  if (typeof global.exemptBroadcaster !== "boolean") global.exemptBroadcaster = true;

  // 9.13.0: Standardtexte und Linkfreigaben aus dem Textpaket der Installation (neutral; Bestandsinstallation: bisherige Werte).
  const packModeration = textPack.get(settings).defaultSettings.moderation;
  const defaults = {
    links: {
      enabled:false,
      whitelistDomains:[...packModeration.links.whitelistDomains],
      reactionBot:botFor("main"),
      timeoutEnabled:true,
      timeoutSeconds:600,
      warningSeconds:5,
      timeoutMessageEnabled:true,
      timeoutMessage:"Freut uns, dass du etwas mit uns teilen möchtest, aber Links sind hier nicht erlaubt."
    },
    emotes: {
      enabled:false,
      limit:5,
      reactionBot:botFor("helper"),
      timeoutEnabled:true,
      timeoutSeconds:600,
      warningSeconds:5,
      timeoutMessageEnabled:true,
      timeoutMessage:packModeration.emotes.timeoutMessage
    },
    symbols: {
      enabled:false,
      limit:8,
      reactionBot:botFor("helper"),
      timeoutEnabled:true,
      timeoutSeconds:600,
      warningSeconds:5,
      timeoutMessageEnabled:true,
      timeoutMessage:packModeration.symbols.timeoutMessage
    },
    caps: {
      enabled:false,
      limit:12,
      reactionBot:botFor("helper"),
      timeoutEnabled:true,
      timeoutSeconds:600,
      warningSeconds:5,
      timeoutMessageEnabled:true,
      timeoutMessage:packModeration.caps.timeoutMessage
    }
  };

  for (const [name, def] of Object.entries(defaults)) {
    settings.moderation[name] ||= {};
    const f = settings.moderation[name];

    for (const [k,v] of Object.entries(def)) {
      if (f[k] === undefined || f[k] === null) {
        f[k] = Array.isArray(v) ? [...v] : v;
      }
    }

    if (!botRoster.hasBot(currentRoster, String(f.reactionBot || "").toLowerCase())) {
      f.reactionBot = def.reactionBot;
    }

    if (name === "links" && !Array.isArray(f.whitelistDomains)) {
      f.whitelistDomains = [...def.whitelistDomains];
    }

    if ("limit" in def && !Number.isFinite(Number(f.limit))) {
      f.limit = def.limit;
    }

    if (typeof f.timeoutEnabled !== "boolean") f.timeoutEnabled = def.timeoutEnabled ?? true;
    if (!Number.isFinite(Number(f.timeoutSeconds))) f.timeoutSeconds = def.timeoutSeconds;
    if (!Number.isFinite(Number(f.warningSeconds))) f.warningSeconds = def.warningSeconds;
    if (typeof f.enabled !== "boolean") f.enabled = def.enabled;
    if (typeof f.timeoutMessageEnabled !== "boolean") f.timeoutMessageEnabled = def.timeoutMessageEnabled;
    if (typeof f.timeoutMessage !== "string") f.timeoutMessage = def.timeoutMessage;
  }

  return settings.moderation;
}


function normalizeGiveaway(g) { return giveawayStore.normalizeGiveaway(g); }

function giveawayEntryFromEvent(ev) {
  return {
    userId:String(ev.chatter_user_id || ""),
    login:String(ev.chatter_user_login || ""),
    name:String(ev.chatter_user_name || ev.chatter_user_login || ""),
    isModerator:isModeratorMessage(ev),
    isVip:isVipMessage(ev),
    badges:chatBadges(ev).map(b=>String(b.set_id || "")),
    joinedAt:new Date().toISOString()
  };
}

function maybeJoinGiveaway(ev, messageText) {
  const state = readGiveawayState();
  const g = state.current;
  if (!g?.active) return false;

  const userId = String(ev.chatter_user_id || "");
  if (!userId || g.entries?.[userId]) return false;

  // Ausschlüsse sind getrennt. VIP ist ausdrücklich nicht gleich Moderator.
  if (g.excludeBroadcaster && isBroadcasterMessage(ev)) {
    audit("giveaway-system","giveaway.entry.rejected",{section:"giveaway",giveawayId:g.id,user:ev.chatter_user_login,reason:"broadcaster"});
    return false;
  }

  if (g.excludeModerators && isModeratorMessage(ev)) {
    audit("giveaway-system","giveaway.entry.rejected",{
      section:"giveaway",
      giveawayId:g.id,
      user:ev.chatter_user_login,
      reason:"moderator",
      badges:chatBadges(ev).map(b=>String(b.set_id || ""))
    });
    return false;
  }

  if (g.excludeVIPs && isVipMessage(ev)) {
    audit("giveaway-system","giveaway.entry.rejected",{section:"giveaway",giveawayId:g.id,user:ev.chatter_user_login,reason:"vip"});
    return false;
  }

  const text = String(messageText || "").trim();
  let eligible = false;

  if (g.type === "random") {
    eligible = !!text;
  } else if (g.type === "keyword") {
    eligible = text.toLowerCase() === String(g.keyword || "").trim().toLowerCase();
  }

  if (!eligible) return false;

  g.entries ||= {};
  g.entries[userId] = giveawayEntryFromEvent(ev);
  g.updatedAt = new Date().toISOString();
  writeGiveawayState(state);

  // Erfolgreiche Teilnahmen werden bewusst nicht protokolliert.
  // Dadurch bleibt das Activity Board kompakt und das Audit wächst nicht unnötig.
  return true;
}



let chatLineCount = 0;
let streamWasLive = false;
const timerLineBaseline = new Map();






const timerStartedAt = new Map();





function writeUsageStats(data) {
  data.updatedAt=new Date().toISOString();
  if(pgStore.enabled){pgStore.replaceUsageStats(data);return;}
  writeJson(FILES.usageStats,data);
}


async function recordUsageStat(kind, itemId, {user=null,input=null}={}) {
  if(!itemId || !["commands","autoReplies"].includes(kind)) return;

  const today=berlinDateKey();
  let streamInfo={live:false,streamId:null};
  try { streamInfo=await getStreamInfo(); } catch {}

  if(pgStore.enabled){
    pgStore.recordUsageStat(kind,itemId,{today,streamId:streamInfo.live&&streamInfo.streamId?String(streamInfo.streamId):null,user:user||null,input:input||null,ts:new Date().toISOString()});
    return;
  }

  const data=readUsageStats();
  const bucket=data[kind];
  const stat=bucket[itemId] || emptyUsageStat();
  if(stat.todayDate!==today){stat.todayDate=today;stat.todayCount=0;}
  if(streamInfo.live && streamInfo.streamId){
    if(String(stat.streamId||"")!==String(streamInfo.streamId)){stat.streamId=String(streamInfo.streamId);stat.streamCount=0;}
    stat.streamCount=Number(stat.streamCount||0)+1;
  }
  stat.total=Number(stat.total||0)+1;
  stat.todayCount=Number(stat.todayCount||0)+1;
  stat.lastTriggeredAt=new Date().toISOString();
  stat.lastUser=user||null;
  stat.lastInput=input||null;
  bucket[itemId]=stat;
  writeUsageStats(data);
}



function ensureCommunityCommands(settings) {
  settings.communityCommands ||= {};
  settings.communityCommands.followage ||= {
    enabled:true,
    bot:botFor("main"),
    cooldownSeconds:30,
    text:textPack.get(settings).defaultSettings.communityCommands.followage.text,
    notFollowingText:"{user} folgt dem Kanal aktuell nicht."
  };
  settings.communityCommands.watchtime ||= {
    enabled:true,
    bot:botFor("main"),
    cooldownSeconds:30,
    text:"{user}, deine erfasste Watchtime beträgt {watchtime}.",
    noDataText:"{user}, für dich wurde bisher noch keine Watchtime erfasst."
  };
  return settings.communityCommands;
}

function formatDurationSeconds(totalSeconds) {
  let s = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const days = Math.floor(s / 86400); s %= 86400;
  const hours = Math.floor(s / 3600); s %= 3600;
  const minutes = Math.floor(s / 60);

  const parts=[];
  if(days) parts.push(`${days} ${days===1?"Tag":"Tage"}`);
  if(hours) parts.push(`${hours} ${hours===1?"Stunde":"Stunden"}`);
  if(minutes || !parts.length) parts.push(`${minutes} ${minutes===1?"Minute":"Minuten"}`);
  return parts.slice(0,2).join(", ");
}

function formatFollowage(followedAt) {
  const start = new Date(followedAt);
  const end = new Date();
  if (Number.isNaN(start.getTime())) return "unbekannter Zeit";

  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    days += prevMonthDays;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const parts=[];
  if(years) parts.push(`${years} ${years===1?"Jahr":"Jahre"}`);
  if(months) parts.push(`${months} ${months===1?"Monat":"Monate"}`);
  if(days || !parts.length) parts.push(`${days} ${days===1?"Tag":"Tage"}`);
  return parts.slice(0,2).join(", ");
}



function readFollowerCache() {
  if(pgStore.enabled)return pgStore.exportFollowerCache();
  const data=readJson(FILES.followerCache,{items:[],total:0,updatedAt:null});
  if(!Array.isArray(data.items)) data.items=[];
  data.total=Number(data.total||data.items.length||0);
  return data;
}

function writeFollowerCache(data) {
  const normalized={
    items:Array.isArray(data.items)?data.items:[],
    total:Number(data.total||0),
    updatedAt:data.updatedAt||new Date().toISOString()
  };
  if(pgStore.enabled){pgStore.replaceFollowerCache(normalized);return;}
  writeJson(FILES.followerCache,normalized);
}


async function resolveTwitchUserByLogin(login) {
  const search=String(login||"").trim().toLowerCase();
  if(!search) return null;

  const ur=await twitchAppFetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(search)}`);
  const uj=await ur.json().catch(()=>({}));
  if(!ur.ok) throw new Error(`Twitch-Nutzer konnte nicht gesucht werden (${ur.status}).`);
  return uj.data?.[0]||null;
}

async function fetchAllFollowersFromTwitch() {
  if(!ids.channel) throw new Error("Channel-ID fehlt.");

  const items=[];
  let after=null;
  let total=0;

  do{
    const url=new URL("https://api.twitch.tv/helix/channels/followers");
    url.searchParams.set("broadcaster_id",ids.channel);
    url.searchParams.set("first","100");
    if(after) url.searchParams.set("after",after);

    const r=await twitchFetch(mainBotKey(),url.toString());
    const j=await r.json().catch(()=>({}));
    if(!r.ok){
      throw new Error(`Follower konnten nicht geladen werden (${r.status}): ${JSON.stringify(j)}`);
    }

    if(Number.isFinite(Number(j.total))) total=Number(j.total);

    for(const x of (j.data||[])){
      items.push({
        userId:String(x.user_id||""),
        login:String(x.user_login||""),
        name:String(x.user_name||x.user_login||""),
        followedAt:x.followed_at||null
      });
    }

    after=j.pagination?.cursor||null;
  }while(after);

  const cache={
    items,
    total:total||items.length,
    updatedAt:new Date().toISOString()
  };
  writeFollowerCache(cache);
  return cache;
}

async function getFollowerCache({force=false}={}) {
  const current=readFollowerCache();
  const age=current.updatedAt ? Date.now()-new Date(current.updatedAt).getTime() : Infinity;
  const valid=current.items.length>0 && age < 15*60*1000;

  if(!force && valid) return current;
  return fetchAllFollowersFromTwitch();
}

function followerSort(items, sort="newest") {
  const copy=[...items];

  if(sort==="oldest"){
    copy.sort((a,b)=>String(a.followedAt||"").localeCompare(String(b.followedAt||"")));
  }else if(sort==="az"){
    copy.sort((a,b)=>String(a.name||a.login||"").localeCompare(String(b.name||b.login||""),"de",{sensitivity:"base"}));
  }else if(sort==="za"){
    copy.sort((a,b)=>String(b.name||b.login||"").localeCompare(String(a.name||a.login||""),"de",{sensitivity:"base"}));
  }else{
    copy.sort((a,b)=>String(b.followedAt||"").localeCompare(String(a.followedAt||"")));
  }

  return copy;
}

let followerRefreshPromise=null;

function refreshFollowerCacheInBackground(){
  if(followerRefreshPromise) return followerRefreshPromise;
  followerRefreshPromise=fetchAllFollowersFromTwitch()
    .catch(err=>{
      console.error(`[followage] Hintergrund-Aktualisierung fehlgeschlagen: ${err?.message||err}`);
      return null;
    })
    .finally(()=>{ followerRefreshPromise=null; });
  return followerRefreshPromise;
}

async function getFollowerPage({after=null,login="",sort="newest",page=1,refresh=false}={}) {
  if(!ids.channel) throw new Error("Channel-ID fehlt.");

  const search=String(login||"").trim().toLowerCase();

  if(search){
    const resolvedUser=await resolveTwitchUserByLogin(search);
    if(!resolvedUser){
      return {total:null,data:[],pagination:{},search:true,foundUser:false};
    }

    const url=new URL("https://api.twitch.tv/helix/channels/followers");
    url.searchParams.set("broadcaster_id",ids.channel);
    url.searchParams.set("user_id",resolvedUser.id);

    const r=await twitchFetch(mainBotKey(),url.toString());
    const j=await r.json().catch(()=>({}));
    if(!r.ok){
      throw new Error(`Follower konnten nicht geladen werden (${r.status}): ${JSON.stringify(j)}`);
    }

    const data=(j.data||[]).map(x=>{
      const userId=String(x.user_id||"");
      const mc=pgStore.enabled?pgStore.getMessageCount(String(ids.channel),userId):{total:0};
      return {userId,login:String(x.user_login||""),name:String(x.user_name||x.user_login||""),followedAt:x.followed_at||null,followage:formatFollowage(x.followed_at),messageCount:Number(mc.total||0)};
    });

    return {
      total:Number.isFinite(Number(j.total)) ? Number(j.total) : null,
      data,
      pagination:{},
      page:1,
      totalPages:1,
      search:true,
      foundUser:true,
      resolvedUser:{id:resolvedUser.id,login:resolvedUser.login,name:resolvedUser.display_name},
      messageTrackingStartedAt:pgStore.enabled?pgStore.messageCountMeta(String(ids.channel)).trackingStartedAt:null
    };
  }

  // Für die sortierbare Gesamtliste liegt der 15-Minuten-Cache ab V7.2.17 relational in PostgreSQL.
  if(pgStore.enabled){
    const meta=pgStore.followerCacheMeta();
    const age=meta.updatedAt ? Date.now()-new Date(meta.updatedAt).getTime() : Infinity;
    const hasRows=Number(meta.rows||0)>0;
    const valid=hasRows && age < 15*60*1000;
    if(refresh){
      // Explizite Aktualisierung darf warten: Der Nutzer hat Twitch-Daten aktualisieren angefordert.
      await fetchAllFollowersFromTwitch();
    }else if(!valid){
      if(hasRows){
        // Stale-while-revalidate: vorhandene Daten sofort anzeigen und Twitch im Hintergrund aktualisieren.
        // So blockiert das Öffnen der Followage-Seite nicht auf sämtlichen Twitch-Paginierungsrequests.
        refreshFollowerCacheInBackground();
      }else{
        // Nur beim wirklich leeren Erstbestand muss einmal synchron geladen werden.
        await fetchAllFollowersFromTwitch();
      }
    }
    const result=pgStore.queryFollowerCache({page:Number(page||1),pageSize:100,sort,channelId:String(ids.channel)});
    return {
      total:result.total||result.rows||0,
      data:(result.data||[]).map(x=>({...x,followage:formatFollowage(x.followedAt)})),
      pagination:{},
      page:result.page||1,
      pageSize:result.pageSize||100,
      totalPages:result.totalPages||1,
      sort,
      search:false,
      cacheUpdatedAt:result.updatedAt||null,
      cacheStale:!valid,
      cacheRefreshing:!refresh && !valid && hasRows && !!followerRefreshPromise,
      latestFollow:result.latest?{...result.latest,followage:formatFollowage(result.latest.followedAt)}:null,
      messageTrackingStartedAt:result.messageTrackingStartedAt||null
    };
  }

  const cache=await getFollowerCache({force:!!refresh});
  const sorted=followerSort(cache.items,sort);
  const safePage=Math.max(1,Number(page||1));
  const pageSize=100;
  const total=sorted.length;
  const totalPages=Math.max(1,Math.ceil(total/pageSize));
  const finalPage=Math.min(safePage,totalPages);
  const start=(finalPage-1)*pageSize;
  const data=sorted.slice(start,start+pageSize).map(x=>({...x,followage:formatFollowage(x.followedAt)}));
  const latestFollow=followerSort(cache.items,"newest")[0]||null;
  return {total:cache.total||total,data,pagination:{},page:finalPage,pageSize,totalPages,sort,search:false,cacheUpdatedAt:cache.updatedAt,latestFollow:latestFollow?{...latestFollow,followage:formatFollowage(latestFollow.followedAt)}:null};
}


async function getFollowInfo(userId) {
  const url = new URL("https://api.twitch.tv/helix/channels/followers");
  url.searchParams.set("broadcaster_id", ids.channel);
  url.searchParams.set("user_id", userId);
  const r = await twitchFetch(mainBotKey(), url.toString());
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(`Followage konnte nicht geladen werden (${r.status}): ${JSON.stringify(j)}`);
  return j.data?.[0] || null;
}







async function getAllChatters() {
  const result=[];
  let after=null;

  do {
    const url = new URL("https://api.twitch.tv/helix/chat/chatters");
    url.searchParams.set("broadcaster_id", ids.channel);
    url.searchParams.set("moderator_id", ids[mainBotKey()]);
    url.searchParams.set("first","1000");
    if(after) url.searchParams.set("after",after);

    const r = await twitchFetch(mainBotKey(), url.toString());
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(`Chatters konnten nicht geladen werden (${r.status}): ${JSON.stringify(j)}`);

    result.push(...(j.data||[]));
    after=j.pagination?.cursor||null;
  } while(after);

  return result;
}

let watchtimeLastTickAt = 0;
let watchtimeBusy = false;

async function updateWatchtime() {
  if(watchtimeBusy) return;
  watchtimeBusy=true;

  try{
    const live=await isStreamLive();
    const now=Date.now();

    if(!live){
      watchtimeLastTickAt=now;
      return;
    }

    const chatters=await getAllChatters();
    const elapsed = watchtimeLastTickAt
      ? Math.min(90, Math.max(30, Math.round((now-watchtimeLastTickAt)/1000)))
      : 60;
    watchtimeLastTickAt=now;

    if(pgStore.enabled){
      pgStore.addWatchtimeBatch(chatters.map(u=>({userId:String(u.user_id||""),login:u.user_login||"",name:u.user_name||u.user_login||""})).filter(u=>u.userId),elapsed,new Date(now).toISOString());
    }else{
      const data=readWatchtime();
      for(const u of chatters){
        const id=String(u.user_id||"");
        if(!id) continue;
        data.users[id] ||= {seconds:0,login:u.user_login||"",name:u.user_name||"",lastSeenAt:null};
        data.users[id].seconds = Number(data.users[id].seconds||0) + elapsed;
        data.users[id].login = u.user_login || data.users[id].login;
        data.users[id].name = u.user_name || data.users[id].name;
        data.users[id].lastSeenAt = new Date(now).toISOString();
      }
      writeWatchtime(data);
    }
  }catch(e){
    console.error("⚠️ Watchtime-Tracker:",e.message);
    audit("community-system","watchtime.tracker.failed",{section:"events",error:e.message});
  }finally{
    watchtimeBusy=false;
  }
}

function startWatchtimeTracker(){
  setInterval(updateWatchtime,60_000);
  setTimeout(updateWatchtime,15_000);
}

async function handleCommunityCommand(ev, settings, firstWord) {
  const cc=ensureCommunityCommands(settings);
  const now=Date.now();

  if(firstWord==="!followage" && cc.followage?.enabled){
    const key=`community:followage:${ev.chatter_user_id}`;
    const until=Number(cooldowns.get(key)||0);
    if(now<until) return true;
    cooldowns.set(key,now+Math.max(0,Number(cc.followage.cooldownSeconds||0))*1000);

    try{
      const follow=await getFollowInfo(String(ev.chatter_user_id||""));
      if(follow){
        const text=String(cc.followage.text||"")
          .replaceAll("{user}",ev.chatter_user_name||ev.chatter_user_login||"User")
          .replaceAll("{date}",new Date(follow.followed_at).toLocaleDateString("de-DE"))
          .replaceAll("{followage}",formatFollowage(follow.followed_at));
        const sentFollow=await sendChat(cc.followage.bot||mainBotKey(),text);
        if(sentFollow&&sentFollow.dropped)cooldowns.delete(key);
      }else{
        const sentFollowNo=await sendChat(
          cc.followage.bot||mainBotKey(),
          String(cc.followage.notFollowingText||"{user} folgt dem Kanal aktuell nicht.")
            .replaceAll("{user}",ev.chatter_user_name||ev.chatter_user_login||"User")
        );
        if(sentFollowNo&&sentFollowNo.dropped)cooldowns.delete(key);
      }
    }catch(e){
      console.error("⚠️ !followage:",e.message);
      audit("community-system","community.followage.failed",{section:"events",user:ev.chatter_user_login,error:e.message});
    }
    return true;
  }

  if(firstWord==="!watchtime" && cc.watchtime?.enabled){
    const key=`community:watchtime:${ev.chatter_user_id}`;
    const until=Number(cooldowns.get(key)||0);
    if(now<until) return true;
    cooldowns.set(key,now+Math.max(0,Number(cc.watchtime.cooldownSeconds||0))*1000);

    const entry=pgStore.enabled?pgStore.getWatchtime(String(ev.chatter_user_id||"")):readWatchtime().users?.[String(ev.chatter_user_id||"")];
    let sentWatch;
    if(entry && Number(entry.seconds||0)>0){
      sentWatch=await sendChat(
        cc.watchtime.bot||mainBotKey(),
        String(cc.watchtime.text||"")
          .replaceAll("{user}",ev.chatter_user_name||ev.chatter_user_login||"User")
          .replaceAll("{watchtime}",formatDurationSeconds(entry.seconds))
      );
    }else{
      sentWatch=await sendChat(
        cc.watchtime.bot||mainBotKey(),
        String(cc.watchtime.noDataText||"")
          .replaceAll("{user}",ev.chatter_user_name||ev.chatter_user_login||"User")
      );
    }
    // Von der Warteschlange verworfen: Cooldown zurückgeben, damit die Person es erneut versuchen kann.
    if(sentWatch&&sentWatch.dropped)cooldowns.delete(key);
    return true;
  }

  return false;
}

async function processGreetings(ev, settings) {
  const now = Date.now();

  for (const g of settings.greetings || []) {
    if (!g.enabled) continue;
    if ((g.login || "").toLowerCase() !== (ev.chatter_user_login || "").toLowerCase()) continue;

    const key = `greet:${g.id}:${ev.chatter_user_id}`;
    const until = Number(cooldowns.get(key) || 0);

    if (now < until) continue;

    cooldowns.set(key, now + 12 * 60 * 60 * 1000);

    try {
      await sendChat(
        g.bot || botFor("helper"),
        render(g.text, {user: ev.chatter_user_name})
      );
      audit("greeting-system","greeting.sent",{
        section:"greetings",
        login:ev.chatter_user_login,
        greetingId:g.id,
        bot:g.bot || botFor("helper")
      });
    } catch (e) {
      console.error("⚠️ Begrüßung konnte nicht gesendet werden:",e.message);
      audit("greeting-system","greeting.failed",{
        section:"greetings",
        login:ev.chatter_user_login,
        greetingId:g.id,
        error:e.message
      });
    }
  }
}


const {createDurableBatchQueue}=require("/shared/durable-batch-queue");
const messageCountPending=new Map();
let messageCountFlushTimer=null;
const messageCountSeenIds=new Map();
const MESSAGE_COUNT_DEDUP_TTL_MS=10*60*1000;
const MESSAGE_COUNT_DEDUP_MAX=50000;
let messageCountBatchSeq=0;
const chatPerformance={received:0,windowStart:Date.now(),lastRate:0,lastLatencyMs:null,failedWrites:0,retries:0,lastError:null,lastFlush:null,lastDbLatencyMs:null};
const messageCountQueue=createDurableBatchQueue({directory:path.join(DATA_DIR,"message-count-spool"),apply:batch=>pgStore.applyMessageCountBatch(String(ids.channel),batch.batchId,batch.rows),logger:(message)=>console.error("⚠️ Twitch-Nachrichtenzähler:",message)});
function recordChatPerformance(start){
 chatPerformance.received++;
 const elapsed=Date.now()-chatPerformance.windowStart;
 if(elapsed>=5000){chatPerformance.lastRate=Math.round(chatPerformance.received*1000/elapsed*10)/10;chatPerformance.received=0;chatPerformance.windowStart=Date.now();}
 if(Number.isFinite(start))chatPerformance.lastLatencyMs=Math.max(0,Date.now()-start);
}
function pruneMessageCountDedup(now=Date.now()){
  for(const [id,ts] of messageCountSeenIds){if(now-ts<=MESSAGE_COUNT_DEDUP_TTL_MS)break;messageCountSeenIds.delete(id);}
  while(messageCountSeenIds.size>MESSAGE_COUNT_DEDUP_MAX){messageCountSeenIds.delete(messageCountSeenIds.keys().next().value);}
}
function queueMessageCount(ev){
  if(!pgStore.enabled||!ids.channel||!ev?.chatter_user_id||isBotUser(ev.chatter_user_login))return;
  const messageId=String(ev.message_id||"");
  const now=Date.now();
  pruneMessageCountDedup(now);
  if(messageId&&messageCountSeenIds.has(messageId))return;
  if(messageId)messageCountSeenIds.set(messageId,now);
  const userId=String(ev.chatter_user_id);
  const dayParts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const day=`${dayParts.year}-${dayParts.month}-${dayParts.day}`;
  const key=`${userId}:${day}`;
  const cur=messageCountPending.get(key)||{userId,day,login:"",name:"",delta:0,firstCountedAt:new Date(now).toISOString(),lastCountedAt:new Date(now).toISOString(),lastMessageId:null};
  cur.delta+=1;cur.login=String(ev.chatter_user_login||cur.login||"");cur.name=String(ev.chatter_user_name||cur.name||cur.login||"");cur.lastCountedAt=new Date(now).toISOString();cur.lastMessageId=messageId||cur.lastMessageId;
  messageCountPending.set(key,cur);
}
function makeMessageCountBatch(rows){return {batchId:`${Date.now()}-${crypto.randomUUID()}-${++messageCountBatchSeq}`,rows};}
function flushMessageCounts(){
 if(!pgStore.enabled||!ids.channel)return;
 // Persist before removing RAM counters. If the atomic spool write fails, retain them in RAM.
 if(messageCountPending.size){
  const batch=makeMessageCountBatch([...messageCountPending.values()]);
  try{messageCountQueue.enqueue(batch);messageCountPending.clear();}
  catch(e){chatPerformance.failedWrites++;chatPerformance.lastError="Zwischenspeicherung fehlgeschlagen";console.error("⚠️ Zähler-Batch bleibt im Arbeitsspeicher:",e.message);return;}
 }
 const start=Date.now();
 const stats=messageCountQueue.drain();
 chatPerformance.retries+=stats.retries;
 if(stats.failed){chatPerformance.failedWrites++;chatPerformance.lastError=stats.error||"Datenbankspeicherung fehlgeschlagen";}
 if(stats.succeeded){chatPerformance.lastFlush=new Date().toISOString();chatPerformance.lastDbLatencyMs=Date.now()-start;chatPerformance.lastError=null;}
}
function startMessageCounter(){
 if(!pgStore.enabled||!ids.channel)return;
 try{pgStore.ensureMessageCountTracking(String(ids.channel));}catch(e){console.error("⚠️ Nachrichtenzähler-Initialisierung:",e.message);}
 try{messageCountQueue.recover();}catch(e){chatPerformance.lastError="Recovery fehlgeschlagen";console.error("⚠️ Zähler-Recovery:",e.message);}
 if(!messageCountFlushTimer)messageCountFlushTimer=setInterval(flushMessageCounts,20_000);
 // The first retry starts at launch instead of waiting for the first regular interval.
 setImmediate(flushMessageCounts);
}
function stopMessageCounter(){
 if(messageCountFlushTimer){clearInterval(messageCountFlushTimer);messageCountFlushTimer=null;}
 try{flushMessageCounts();}catch(e){console.error("⚠️ Shutdown-Flush:",e.message);}
}
function messageCounterDiagnostics(){
 const q=messageCountQueue.stats();
 return {chatSend:chatSendQueue.stats(),ratePerSecond:chatPerformance.lastRate,processingLatencyMs:chatPerformance.lastLatencyMs,pendingBatches:q.pendingBatches+(messageCountPending.size?1:0),queuedRows:q.queuedRows+messageCountPending.size,queueCapacity:q.capacity,failedWrites:chatPerformance.failedWrites,retries:chatPerformance.retries,lastError:chatPerformance.lastError,lastFlush:chatPerformance.lastFlush,dbLatencyMs:chatPerformance.lastDbLatencyMs,spoolBytes:q.bytes};
}

async function handleChat(ev) {
  const performanceStart=Date.now();
  if (!ev || isBotUser(ev.chatter_user_login)) return;
  recordChatPerformance(performanceStart);
  queueMessageCount(ev);

  // Nightbot-ähnliche "Lines"-Bedingung:
  // Jede echte Chatnachricht zählt als eine Chat-Zeile.
  chatLineCount += 1;

  const settings = readJson(FILES.settings, DEFAULT_SETTINGS);
  prepareSettings(settings);
  normalizeLurkSettings(settings);
  normalizeModuleSettings(settings);
  const msg = (ev.message?.text || "").trim();
  const lower = msg.toLowerCase();

  // Aktive Gewinnspiele sammeln eindeutige Teilnehmer direkt aus dem Twitch-Chat.
  if (isModuleEnabled(settings, "giveaway")) maybeJoinGiveaway(ev, msg); // 9.2.0: Modulschalter

  const moderation = ensureModerationSettings(settings);
  const globalMod = moderation.global;

  const exemptBecauseBroadcaster = globalMod.exemptBroadcaster && isBroadcasterMessage(ev);
  const exemptBecauseModerator = globalMod.exemptModerators && isModeratorMessage(ev);
  const exemptBecauseWhitelist = userWhitelisted(ev, globalMod.whitelistUsers);
  const moderationExempt = exemptBecauseBroadcaster || exemptBecauseModerator || exemptBecauseWhitelist;

  // 9.6.0: Modul „Twitch-Chat-Filter“ aus → Link-, Emote-, Satzzeichen- und Großbuchstaben-Filter ruhen.
  if (!moderationExempt && isModuleEnabled(settings, "twitchChatFilter")) {
    const linkSettings = moderation.links;

    if (linkSettings.enabled) {
      const urls = extractUrls(msg);
      const disallowed = urls.find(raw => {
        const host = normalizeDomainFromUrl(raw);
        return host && !domainAllowed(host, linkSettings.whitelistDomains);
      });

      if (disallowed) {
        await handleModerationDetection(ev, "links", linkSettings, { link: disallowed });
        return;
      }
    }

    const emoteSettings = moderation.emotes;
    if (emoteSettings.enabled) {
      const count = countEmotes(ev);
      if (count >= Math.max(1, Number(emoteSettings.limit || 5))) {
        await handleModerationDetection(ev, "emotes", emoteSettings, { count });
        return;
      }
    }

    const symbolSettings = moderation.symbols;
    if (symbolSettings.enabled) {
      const count = countSymbols(msg);
      if (count >= Math.max(1, Number(symbolSettings.limit || 8))) {
        await handleModerationDetection(ev, "symbols", symbolSettings, { count });
        return;
      }
    }

    const capsSettings = moderation.caps;
    if (capsSettings.enabled) {
      const count = countCaps(msg);
      if (count >= Math.max(1, Number(capsSettings.limit || 12))) {
        await handleModerationDetection(ev, "caps", capsSettings, { count });
        return;
      }
    }
  }

  let centralWordFilterHandled=false,centralWordFilterMatched=false;
  // 9.6.0: Wortfilter nur, wenn Modul „Wortfilter“ an und der Twitch-Schalter des Wortfilters an ist.
  const wordFilterOnTwitch=wordFilterActiveFor(settings,"twitch");
  if(pgStore.enabled && !moderationExempt && wordFilterOnTwitch){
    const compiled=wordFilterRefresh();
    const hit=matchWordFilter(compiled,"twitch",msg);
    if(hit){
      centralWordFilterMatched=true;
      const policy=wordFilterAction(hit,"twitch");
      const effectiveAction=hit.term.test_only?"log":policy.action;
      try{pgStore.recordWordFilterHit({term_id:hit.term.term_id,platform:"twitch",category_id:hit.term.category_id,action:effectiveAction,user_id:ev.chatter_user_id||null});}catch(e){console.error("⚠️ Wortfilter-Trefferstatistik:",e.message);}
      audit(mainBotName(),"word-filter.hit",{section:"wordFilter",platform:"twitch",termId:hit.term.term_id,term:hit.term.term,category:hit.term.category_id,severity:hit.term.severity,action:effectiveAction,testOnly:hit.term.test_only===true,targetUserId:ev.chatter_user_id||null,messageId:ev.message_id||null});
      if(effectiveAction==="delete"||effectiveAction==="timeout"){
        try{await deleteChatMessageWithMainBot(ev.message_id);}catch(e){audit(mainBotName(),"word-filter.action.failed",{section:"wordFilter",action:"delete",termId:hit.term.term_id,error:e.message});}
      }
      if(effectiveAction==="warn"){
        const tpl=policy.messageTemplate||"@{user} bitte beachte unsere Chatregeln.";
        try{await sendChat(mainBotKey(),render(tpl,{user:ev.chatter_user_name,term:hit.term.term,category:hit.term.category_id,severity:hit.term.severity}));}catch(e){audit(mainBotName(),"word-filter.action.failed",{section:"wordFilter",action:"warn",termId:hit.term.term_id,error:e.message});}
      }
      if(effectiveAction==="notify"){
        try{
          const n=await discordServiceRequest("/word-filter/notify",{method:"POST",body:JSON.stringify({platform:"twitch",user:ev.chatter_user_name||ev.chatter_user_login||"unbekannt",userId:ev.chatter_user_id||null,channel:"Twitch",term:hit.term.term,category:hit.term.category_id,severity:hit.term.severity,messageId:ev.message_id||null})});
          audit(mainBotName(),"word-filter.moderator-notified",{section:"wordFilter",platform:"twitch",termId:hit.term.term_id,targetChannelId:n.body?.channelId||null,targetChannelName:n.body?.channelName||null});
        }catch(e){audit(mainBotName(),"word-filter.action.failed",{section:"wordFilter",action:"notify",termId:hit.term.term_id,error:e.message});}
      }
      const legacyResponse=String(hit.term.metadata?.response||"").trim();
      if(!hit.term.test_only&&legacyResponse){
        try{await sendChat(hit.term.metadata?.responseBot||mainBotKey(),render(legacyResponse,{user:ev.chatter_user_name}));}catch{}
      }
      if(effectiveAction==="timeout"){
        try{await timeoutUserWithMainBot(ev.chatter_user_id,Math.max(1,policy.timeoutSeconds||600),`Zentraler Wortfilter: ${hit.term.category_id}`);}catch(e){audit(mainBotName(),"word-filter.action.failed",{section:"wordFilter",action:"timeout",termId:hit.term.term_id,error:e.message});}
      }else if(policy.escalate&&!hit.term.test_only){
        const stage=twitchWordFilterEscalation(ev.chatter_user_id,hit.term.category_id);
        if(stage>0){
          const seconds=Math.min(1209600,Math.max(1,policy.timeoutSeconds||600)*stage);
          try{await timeoutUserWithMainBot(ev.chatter_user_id,seconds,`Wiederholter Wortfilter-Verstoß: ${hit.term.category_id}`);audit(mainBotName(),"word-filter.escalation.timeout",{section:"wordFilter",termId:hit.term.term_id,targetUserId:ev.chatter_user_id,stage,seconds});}catch(e){audit(mainBotName(),"word-filter.action.failed",{section:"wordFilter",action:"escalation-timeout",termId:hit.term.term_id,error:e.message});}
        }
      }
      centralWordFilterHandled=effectiveAction!=="allow"&&effectiveAction!=="log"&&effectiveAction!=="notify";
      if(centralWordFilterHandled)return;
    }
  }

  // Legacy-Fallback nur, solange noch kein zentraler PostgreSQL-Wortbestand aktiv ist.
  if(wordFilterOnTwitch && !wordFilterCentralReady() && !centralWordFilterMatched && !moderationExempt) for (const rawItem of settings.blockedWords || []) {
    const item = normalizeBlockedWord(rawItem);
    if (!item.enabled) continue;
    const needle = String(item.word || "").trim().toLowerCase();
    if (!needle) continue;
    if (lower.includes(needle)) {
      if (item.action === "delete" || item.action === "twitch_block") {
        try {
          await deleteChatMessageWithMainBot(ev.message_id);
          audit(mainBotName(),"blocked-word.message.deleted",{section:"blockedWords",word:item.word,target:ev.chatter_user_login || ev.chatter_user_name || "unknown",action:item.action,messageId:ev.message_id || null});
        } catch (e) {
          console.error("⚠️ Wortfilter-Löschung fehlgeschlagen:",e.message);
          audit(mainBotName(),"blocked-word.action.failed",{section:"blockedWords",word:item.word,target:ev.chatter_user_login || ev.chatter_user_name || "unknown",error:e.message});
        }
      }
      if (item.response) await sendChat(item.bot || mainBotKey(), render(item.response, {user: ev.chatter_user_name}));
      return;
    }
  }

  // 9.27.0: Chat-Overlay. Erst hier, nach allen Filtern: Was gelöscht oder sanktioniert wurde, ist oben schon ausgestiegen.
  if (isModuleEnabled(settings, "chatOverlay")) {
    try { const compact = compactChatEvent(ev); if (compact) emitChatOverlay("chat", compact); } catch {}
  }

  // 9.1.0: Lurk-Command registrieren bzw. Rückkehr melden. Läuft vor den Commands, damit der
  // bestehende !lurk-Command (Antworttext, Cooldown) unverändert weiterläuft. Gesendet wird ohne
  // Warten und mit niedrigem Vorrang; bei Stau fällt die Meldung zuerst weg.
  if (isModuleEnabled(settings, "lurkReturn")) handleLurkChat(lurkReturn, ev, msg, settings.lurkReturn, sendChat, e => console.warn("⚠️ Lurk-Rückkehr:", e?.message || e));

  // Begrüßungen dürfen nicht durch Commands oder Auto-Replies unterdrückt werden.
  await processGreetings(ev, settings);

  const firstWord = lower.split(/\s+/)[0];

  if (await twitchEvents.dispatchChatCommand(ev, msg)) return;
  if (await handleCommunityCommand(ev, settings, firstWord)) return;

  const cmd = (settings.commands || []).find(x => {
    if (!x.enabled) return false;

    const names = [
      String(x.command || "").trim().toLowerCase(),
      ...String(x.aliases || "")
        .split(",")
        .map(a => a.trim().toLowerCase())
        .filter(Boolean)
    ].filter(Boolean);

    return names.includes(firstWord);
  });
  if (cmd) {
    const key = `${cmd.id}:${ev.chatter_user_id}`;
    const now = Date.now();

    // Twitch-Moderatoren sowie Broadcaster/Owner sind von Command-Cooldowns ausgenommen.
    const bypassCooldown = isModeratorMessage(ev) || isBroadcasterMessage(ev);
    const until = bypassCooldown ? 0 : (cooldowns.get(key) || 0);

    if (bypassCooldown || now >= until) {
      if (!bypassCooldown) {
        cooldowns.set(key, now + Number(cmd.cooldownSeconds || 0) * 1000);
      }

      let reply=cmd.response;
      const isDc=[cmd.command,...String(cmd.aliases||"").split(",")].some(x=>["!dc","/dc","dc"].includes(String(x||"").trim().toLowerCase()));
      if(isDc||String(reply).includes("{discord_invite}")){
        let invite=null;
        try{const r=await discordServiceRequest("/invite/twitch");if(r.body?.enabled&&typeof r.body?.invite==="string"&&/^https:\/\/discord\.gg\/[A-Za-z0-9-]+$/.test(r.body.invite))invite=r.body.invite;}catch(e){console.warn("Discord-Invite derzeit nicht verfügbar:",e.message);}
        if(isDc)reply=invite?discordInviteTexts().inviteLive:discordInviteTexts().inviteTeaser;
        else reply=invite?reply:String(reply).replace(/\{discord_invite\}/g,"").trim();
        reply=render(reply,{discord_invite:invite||""});
      }
      const sentCmd=await sendChat(cmd.bot, render(reply, {user: ev.chatter_user_name, command: cmd.command}));
      // Wurde die Antwort von der Warteschlange verworfen, bekommt die Person ihren Cooldown zurück.
      if(sentCmd&&sentCmd.dropped){cooldowns.delete(key);return;}
      await recordUsageStat("commands",cmd.id,{
        user:ev.chatter_user_login || ev.chatter_user_name || null,
        input:firstWord
      });
    }
    return;
  }

  for (const ar of settings.autoReplies || []) {
    if (!ar.enabled) continue;

    const triggers = Array.isArray(ar.triggers)
      ? ar.triggers
      : String(ar.trigger || "").split(/[\n,]+/);

    const needles = triggers
      .map(x=>String(x||"").trim().toLowerCase())
      .filter(Boolean);

    const matched = needles.some(needle =>
      ar.match === "exact" ? lower === needle : lower.includes(needle)
    );

    if (matched) {
      const key=`autoreply:${ar.id}:${ev.chatter_user_id}`;
      const now=Date.now();
      const until=Number(cooldowns.get(key)||0);
      if(now<until) return;

      cooldowns.set(key,now+Math.max(0,Number(ar.cooldownSeconds||0))*1000);
      const sentAuto=await sendChat(ar.bot || mainBotKey(), render(ar.response, {user: ev.chatter_user_name}));
      if(sentAuto&&sentAuto.dropped){cooldowns.delete(key);return;}

      const matchedTrigger=needles.find(needle =>
        ar.match === "exact" ? lower === needle : lower.includes(needle)
      ) || null;

      await recordUsageStat("autoReplies",ar.id,{
        user:ev.chatter_user_login || ev.chatter_user_name || null,
        input:matchedTrigger
      });
      return;
    }
  }

}


function getAutomodMessageText(ev){
  if(typeof ev?.message==="string") return ev.message;
  return String(ev?.message?.text || "");
}

function isTrustedClipBotMessage(ev){
  const senderId=String(ev?.user_id||"");
  const login=String(ev?.user_login||"").toLowerCase();

  // Primär über die stabile Twitch User ID prüfen; Login nur als Fallback.
  const trustedSender =
    (ids[clipBotKey()] && senderId===String(ids[clipBotKey()])) ||
    (!!accountMap[clipBotKey()]?.login && login===String(accountMap[clipBotKey()].login).toLowerCase());

  if(!trustedSender) return false;

  const text=getAutomodMessageText(ev).trim();

  // Nicht mehr vom exakten Nachrichtentext/Emoji abhängig machen.
  // Ausschließlich echte Twitch-Clip-URLs des vertrauenswürdigen Bot-Accounts zulassen.
  return (
    /https?:\/\/(?:www\.)?twitch\.tv\/[^/\s]+\/clip\/[A-Za-z0-9_-]+(?:[?#][^\s]*)?/i.test(text) ||
    /https?:\/\/clips\.twitch\.tv\/[A-Za-z0-9_-]+(?:[?#][^\s]*)?/i.test(text)
  );
}

async function allowHeldAutomodMessage(messageId){
  const r=await twitchFetch(mainBotKey(),"https://api.twitch.tv/helix/moderation/automod/message",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      user_id:ids[mainBotKey()],
      msg_id:messageId,
      action:"ALLOW"
    })
  });

  if(r.status!==204){
    const body=await r.text();
    throw new Error(`AutoMod-Freigabe fehlgeschlagen (${r.status}): ${body}`);
  }
}


const DEFAULT_DISCORD_BRIDGE_STATE = {queue:[],lastDeliveredAt:null,lastError:null};
let discordBridgeRevision=0;
function normalizeDiscordBridgeState(raw={}){return {queue:Array.isArray(raw.queue)?raw.queue.slice(-500):[],lastDeliveredAt:raw.lastDeliveredAt||null,lastError:raw.lastError||null};}
function readDiscordBridgeState(){
  if(pgStore.enabled){const r=pgStore.getDiscordBridgeState();discordBridgeRevision=Number(r?.revision||0);return normalizeDiscordBridgeState(r?.state||DEFAULT_DISCORD_BRIDGE_STATE);}
  return normalizeDiscordBridgeState(readJson(FILES.discordBridge,DEFAULT_DISCORD_BRIDGE_STATE));
}
function writeDiscordBridgeState(state){
  state=normalizeDiscordBridgeState(state);
  if(pgStore.enabled){const r=pgStore.putDiscordBridgeState(state,discordBridgeRevision);discordBridgeRevision=Number(r?.revision||discordBridgeRevision+1);return;}
  writeJson(FILES.discordBridge,state);
}
function enqueueDiscordAnnouncement(type,key,payload){
  // 9.8.0: Modul „Discord-Ankündigungen“ aus → nichts einreihen.
  if(!isModuleEnabled(readJson(FILES.settings, DEFAULT_SETTINGS),"discordAnnouncements"))return;
  const state=readDiscordBridgeState();
  const id=`${type}:${key}`;
  if(!state.queue.some(x=>x.id===id)){
    state.queue.push({id,type,key,payload,createdAt:new Date().toISOString(),attempts:0,lastError:null});
    writeDiscordBridgeState(state);
  }
}
let discordBridgeBusy=false;
const DISCORD_BRIDGE_REPORT_AT=5;
const DISCORD_BRIDGE_MAX_ATTEMPTS=40; // ca. 10 Minuten bei 15 s Takt
async function flushDiscordBridge(){
  if(discordBridgeBusy)return;
  discordBridgeBusy=true;
  try{
    const state=readDiscordBridgeState();
    if(!state.queue.length)return;
    const item=state.queue[0];
    try{
      const result=await discordServiceRequest("/announcements/ingest",{
        method:"POST",body:JSON.stringify({type:item.type,key:item.key,payload:item.payload,attempts:Number(item.attempts||0)})
      });
      if(!result?.body?.ok)throw new Error(result?.body?.error||"Discord-Ankündigung abgelehnt.");
      state.queue.shift();
      state.lastDeliveredAt=new Date().toISOString();
      state.lastError=null;
      writeDiscordBridgeState(state);
      audit("discord-bridge","discord.announcement.delivered",{type:item.type,key:item.key,status:result.body?.status||"sent",messageId:result.body?.messageId||null,channelId:result.body?.channelId||null});
    }catch(e){
      item.attempts=Number(item.attempts||0)+1;
      item.lastError=e.message;
      state.lastError=e.message;
      // 9.26.2: Eine Meldung, die Discord dauerhaft ablehnt, blockiert nicht mehr alles dahinter.
      // Fehler erst ab dem 5. Versuch melden (kurzes Warten auf das Clip-Vorschaubild ist normal).
      if(item.attempts===DISCORD_BRIDGE_REPORT_AT)audit("discord-bridge","discord.announcement.failed",{section:"discord",type:item.type,key:item.key,error:e.message,attempts:item.attempts});
      if(item.attempts>=DISCORD_BRIDGE_MAX_ATTEMPTS){
        state.queue.shift();
        state.lastError=`Aufgegeben nach ${item.attempts} Versuchen (${item.type}:${item.key}): ${e.message}`;
        audit("discord-bridge","discord.announcement.dropped.failed",{section:"discord",type:item.type,key:item.key,error:state.lastError,attempts:item.attempts});
      }
      writeDiscordBridgeState(state);
    }
  }finally{discordBridgeBusy=false;}
}
function startDiscordBridge(){setInterval(flushDiscordBridge,15000);setTimeout(flushDiscordBridge,5000);}

async function currentLiveAnnouncementPayload(ev){
  try{
    const r=await twitchFetch(mainBotKey(),`https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(ids.channel)}`);
    const j=await r.json().catch(()=>({}));
    const stream=Array.isArray(j.data)?j.data[0]:null;
    return {
      streamId:String(stream?.id||ev?.id||ev?.stream_id||""),
      broadcasterName:stream?.user_name||ev?.broadcaster_user_name||channelLogin(),
      title:stream?.title||"",
      gameName:stream?.game_name||"",
      startedAt:stream?.started_at||ev?.started_at||new Date().toISOString(),
      url:`https://www.twitch.tv/${channelLogin()}`
    };
  }catch{
    return {
      streamId:String(ev?.id||ev?.stream_id||ev?.started_at||Date.now()),
      broadcasterName:ev?.broadcaster_user_name||channelLogin(),
      title:"",gameName:"",startedAt:ev?.started_at||new Date().toISOString(),
      url:`https://www.twitch.tv/${channelLogin()}`
    };
  }
}

const EVENTSUB_BASE_URL = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";

let ws = null;
let wsSessionId = null;
let pendingReconnectSocket = null;
let reconnectTimer = null;
let keepaliveTimer = null;

const eventSubRuntime = {
  state:"disconnected",
  reconnectAttempts:0,
  lastConnectedAt:null,
  lastMessageAt:null,
  lastDisconnectedAt:null,
  lastError:null,
  lastCloseCode:null,
  lastCloseReason:null,
  nextRetryAt:null,
  keepaliveTimeoutSeconds:null
};

const eventSubSubscriptions = {};

async function createEventSub(type, version, condition, tokenAccount) {
  const r = await twitchFetch(tokenAccount, "https://api.twitch.tv/helix/eventsub/subscriptions", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      type, version, condition,
      transport: { method: "websocket", session_id: wsSessionId }
    })
  });

  const text = await r.text();

  if (!r.ok && r.status !== 409) {
    eventSubSubscriptions[type] = {
      ok:false,
      status:r.status,
      error:text,
      tokenAccount,
      updatedAt:new Date().toISOString()
    };
    console.error(`EventSub ${type} fehlgeschlagen:`, r.status, text);
    audit("eventsub-system","eventsub.subscription.failed",{
      section:"events",
      type,
      status:r.status,
      tokenAccount,
      error:text
    });
    return false;
  }

  eventSubSubscriptions[type] = {
    ok:true,
    status:r.status,
    tokenAccount,
    updatedAt:new Date().toISOString()
  };
  console.log(`✅ EventSub: ${type}`);
  return true;
}

async function subscribeAll() {
  await createEventSub(
    "channel.chat.message",
    "1",
    { broadcaster_user_id: ids.channel, user_id: ids[mainBotKey()] },
    mainBotKey()
  );

  // Follow wird über den echten Moderator (Haupt-Bot) abonniert.
  // Bei WebSocket-EventSub muss moderator_user_id zum User-Token passen.
  await createEventSub(
    "channel.follow",
    "2",
    { broadcaster_user_id: ids.channel, moderator_user_id: ids[mainBotKey()] },
    mainBotKey()
  );

  // Raid benötigt keinen speziellen Scope; der Haupt-Bot dient als technischer EventSub-Account.
  await createEventSub(
    "channel.raid",
    "1",
    { to_broadcaster_user_id: ids.channel },
    mainBotKey()
  );

  await createEventSub(
    "stream.online",
    "1",
    { broadcaster_user_id: ids.channel },
    mainBotKey()
  );

  await createEventSub(
    "automod.message.hold",
    "1",
    { broadcaster_user_id: ids.channel, moderator_user_id: ids[mainBotKey()] },
    mainBotKey()
  );

  // 9.27.0: Löschereignisse für das Chat-Overlay. Gleiche Berechtigung (user:read:chat) und Bedingung wie der Chat-Empfang.
  // Schlägt eines fehl, läuft alles andere weiter; das Overlay blendet gelöschte Nachrichten dann nur nach Ablauf der Anzeigedauer aus.
  for (const deleteType of ["channel.chat.message_delete", "channel.chat.clear_user_messages", "channel.chat.clear"]) {
    await createEventSub(deleteType, "1", { broadcaster_user_id: ids.channel, user_id: ids[mainBotKey()] }, mainBotKey());
  }
}

let followMessageCursor=0;

function followMessagesFromSettings(follow){
  const list=Array.isArray(follow?.messages)
    ? follow.messages.map(x=>String(x||"").trim()).filter(Boolean)
    : [];

  if(!list.length && String(follow?.text||"").trim()){
    list.push(String(follow.text).trim());
  }

  return list;
}

function nextFollowMessage(follow){
  const list=followMessagesFromSettings(follow);
  if(!list.length) return "";

  const index=followMessageCursor % list.length;
  followMessageCursor=(followMessageCursor+1) % list.length;
  return list[index];
}

async function handleNotification(payload) {
  const type = payload.metadata?.subscription_type;
  const ev = payload.payload?.event;
  if (type === "channel.chat.message") return handleChat(ev);

  // 9.27.0: Löschereignisse für das Chat-Overlay (gelöschte Nachricht, gelöschte Nachrichten eines Nutzers, Chat geleert).
  if (type === "channel.chat.message_delete" || type === "channel.chat.clear_user_messages" || type === "channel.chat.clear") {
    try {
      const settings = readJson(FILES.settings, DEFAULT_SETTINGS);
      normalizeModuleSettings(settings);
      if (isModuleEnabled(settings, "chatOverlay")) { const d = compactDeleteEvent(type, ev); if (d) emitChatOverlay("chat-delete", d); }
    } catch {}
    return;
  }

  if (type === "automod.message.hold") {
    const trusted = isTrustedClipBotMessage(ev);

    // Diagnose nur für gehaltene Nachrichten des Clip-Bots bzw. passende Clip-URLs.
    // So wird das Audit nicht mit allen AutoMod-Holds geflutet.
    const heldText=getAutomodMessageText(ev);
    const looksLikeClip=/https?:\/\/(?:(?:www\.)?twitch\.tv\/[^/\s]+\/clip\/|clips\.twitch\.tv\/)/i.test(heldText);

    if (trusted || String(ev?.user_login||"").toLowerCase()===String(accountMap[clipBotKey()]?.login||"").toLowerCase() || looksLikeClip) {
      audit(mainBotName(),"automod.hold.detected",{
        section:"moderation",
        user:ev.user_login,
        userId:ev.user_id,
        messageId:ev.message_id,
        trusted,
        message:heldText
      });
    }

    if (trusted) {
      try {
        await allowHeldAutomodMessage(ev.message_id);
        audit(mainBotName(),"automod.auto-allowed",{
          section:"moderation",
          user:ev.user_login,
          userId:ev.user_id,
          messageId:ev.message_id,
          reason:"trusted-clip-bot"
        });
      } catch (e) {
        console.error("⚠️ AutoMod Auto-Allow fehlgeschlagen:",e.message);
        audit(mainBotName(),"automod.auto-allow.failed",{
          section:"moderation",
          user:ev.user_login,
          userId:ev.user_id,
          messageId:ev.message_id,
          error:e.message
        });
      }
    }
    return;
  }

  if (type === "stream.online") {
    try { if (lurkModuleOn()) { lurkReturn.clear(); lurkReturn.flush(); } } catch {}
    const live=await currentLiveAnnouncementPayload(ev);
    enqueueDiscordAnnouncement("live",live.streamId||live.startedAt,live);
    audit("eventsub-system","event.stream.online.received",{section:"events",streamId:live.streamId,title:live.title});
    setTimeout(flushDiscordBridge,250);
    return;
  }

  const s = readJson(FILES.settings, DEFAULT_SETTINGS);

  if (type === "channel.follow") {
    audit("eventsub-system","event.follow.received",{
      section:"events",
      user:ev.user_login || ev.user_name
    });

    // Followathon verarbeitet dasselbe echte EventSub-Ereignis. Die bestehende
    // Follow-Begrüßung bleibt davon unabhängig und wird weiterhin genau einmal ausgeführt.
    await twitchEvents.emit("follow",{event:ev,metadata:payload.metadata||{}});

    if (s.events?.follow?.enabled) {
      const followText=nextFollowMessage(s.events.follow);
      if(!followText){
        console.warn("⚠️ Follow-Ereignis aktiv, aber keine Follow-Nachricht hinterlegt.");
        return;
      }

      return sendChat(
        s.events.follow.bot,
        render(followText, {user: ev.user_name})
      );
    }
    return;
  }

  if (type === "channel.raid") {
    audit("eventsub-system","event.raid.received",{
      section:"events",
      user:ev.from_broadcaster_user_login || ev.from_broadcaster_user_name,
      viewers:ev.viewers
    });

    // 9.27.1: Die Weboberfläche zeigt den Raid (Chat-Overlay-Karte); ein Fehler dabei darf die Raid-Nachricht nicht verhindern.
    try { await twitchEvents.emit("raid",{event:ev,metadata:payload.metadata||{}}); } catch (e) { console.warn("⚠️ Raid konnte nicht an die Weboberfläche gemeldet werden:", e?.message || e); }

    if (s.events?.raid?.enabled) {
      return sendChat(
        s.events.raid.bot,
        render(s.events.raid.text, {
          user: ev.from_broadcaster_user_name,
          viewers: ev.viewers
        })
      );
    }
  }
}


function clearEventSubReconnectTimer(){
  if(reconnectTimer){
    clearTimeout(reconnectTimer);
    reconnectTimer=null;
  }
  eventSubRuntime.nextRetryAt=null;
}

function clearEventSubKeepaliveTimer(){
  if(keepaliveTimer){
    clearInterval(keepaliveTimer);
    keepaliveTimer=null;
  }
}

function eventSubSocketState(socket){
  if(!socket) return "none";
  if(socket.readyState===WebSocket.CONNECTING) return "connecting";
  if(socket.readyState===WebSocket.OPEN) return "open";
  if(socket.readyState===WebSocket.CLOSING) return "closing";
  if(socket.readyState===WebSocket.CLOSED) return "closed";
  return "unknown";
}

function scheduleEventSubReconnect(reason="connection-lost"){
  if(reconnectTimer) return;
  if(ws && (ws.readyState===WebSocket.OPEN || ws.readyState===WebSocket.CONNECTING)) return;

  eventSubRuntime.state="waiting";
  eventSubRuntime.reconnectAttempts=Math.max(0,Number(eventSubRuntime.reconnectAttempts||0))+1;

  const delays=[4000,8000,15000,30000,60000];
  const delay=delays[Math.min(eventSubRuntime.reconnectAttempts-1,delays.length-1)];
  eventSubRuntime.nextRetryAt=new Date(Date.now()+delay).toISOString();

  console.warn(`⚠️ EventSub getrennt (${reason}). Neuer Versuch in ${Math.round(delay/1000)}s.`);
  reconnectTimer=setTimeout(()=>{
    reconnectTimer=null;
    eventSubRuntime.nextRetryAt=null;
    connectEventSub();
  },delay);
}

function startEventSubKeepaliveWatch(socket,timeoutSeconds){
  clearEventSubKeepaliveTimer();
  const timeout=Math.max(10,Number(timeoutSeconds||30));
  eventSubRuntime.keepaliveTimeoutSeconds=timeout;

  keepaliveTimer=setInterval(()=>{
    if(socket!==ws || socket.readyState!==WebSocket.OPEN) return;
    const last=eventSubRuntime.lastMessageAt ? new Date(eventSubRuntime.lastMessageAt).getTime() : 0;
    if(!last) return;

    const maxSilence=(timeout+8)*1000;
    if(Date.now()-last>maxSilence){
      console.warn(`⚠️ EventSub Keepalive seit ${Math.round((Date.now()-last)/1000)}s ausgeblieben. Verbindung wird neu aufgebaut.`);
      eventSubRuntime.lastError="Keepalive-Timeout";
      try{ socket.close(4000,"keepalive timeout"); }catch{}
    }
  },5000);
}

function handleEventSubClose(socket,event,{gracefulReconnect=false}={}){
  const code=Number(event?.code||0);
  const reason=String(event?.reason||"");

  // Ein alter Socket darf nach erfolgreichem Twitch-Reconnect keinen zweiten Reconnect starten.
  if(socket!==ws){
    if(socket===pendingReconnectSocket) pendingReconnectSocket=null;
    return;
  }

  ws=null;
  wsSessionId=null;
  clearEventSubKeepaliveTimer();

  eventSubRuntime.lastDisconnectedAt=new Date().toISOString();
  eventSubRuntime.lastCloseCode=code||null;
  eventSubRuntime.lastCloseReason=reason||null;

  if(gracefulReconnect) return;

  eventSubRuntime.state="disconnected";
  scheduleEventSubReconnect(code ? `Close ${code}${reason?`: ${reason}`:""}` : "Socket geschlossen");
}

function openEventSubSocket(url,{twitchReconnect=false,previousSocket=null}={}){
  const target=String(url||EVENTSUB_BASE_URL);

  if(twitchReconnect){
    if(pendingReconnectSocket && [WebSocket.CONNECTING,WebSocket.OPEN].includes(pendingReconnectSocket.readyState)){
      return pendingReconnectSocket;
    }
    eventSubRuntime.state="reconnecting";
  }else{
    if(ws && [WebSocket.CONNECTING,WebSocket.OPEN].includes(ws.readyState)){
      return ws;
    }
    clearEventSubReconnectTimer();
    eventSubRuntime.state="connecting";
  }

  console.log(twitchReconnect ? "🔄 EventSub wechselt Twitch-Endpunkt..." : "🔌 EventSub verbindet...");
  const socket=new WebSocket(target);

  if(twitchReconnect) pendingReconnectSocket=socket;
  else ws=socket;

  socket.addEventListener("message",async event=>{
    try{
      eventSubRuntime.lastMessageAt=new Date().toISOString();
      const payload=JSON.parse(event.data);
      const t=payload.metadata?.message_type;

      if(t==="session_welcome"){
        const session=payload.payload?.session||{};
        const timeout=Number(session.keepalive_timeout_seconds||30);

        if(twitchReconnect){
          // Twitch übernimmt bestehende Abos auf die neue Reconnect-Verbindung.
          // Erst nach Welcome wird der alte Socket geschlossen.
          const old=previousSocket;
          ws=socket;
          pendingReconnectSocket=null;
          wsSessionId=session.id||null;
          eventSubRuntime.state="connected";
          eventSubRuntime.reconnectAttempts=0;
          eventSubRuntime.lastConnectedAt=new Date().toISOString();
          eventSubRuntime.lastError=null;
          clearEventSubReconnectTimer();
          startEventSubKeepaliveWatch(socket,timeout);

          console.log("✅ EventSub Reconnect erfolgreich.");
          if(old && old!==socket && [WebSocket.OPEN,WebSocket.CONNECTING].includes(old.readyState)){
            try{ old.close(1000,"reconnected"); }catch{}
          }
        }else{
          if(socket!==ws) return;
          wsSessionId=session.id||null;
          eventSubRuntime.state="connected";
          eventSubRuntime.reconnectAttempts=0;
          eventSubRuntime.lastConnectedAt=new Date().toISOString();
          eventSubRuntime.lastError=null;
          clearEventSubReconnectTimer();
          startEventSubKeepaliveWatch(socket,timeout);

          // Bei einer komplett neuen Session müssen die Abos neu erstellt werden.
          for(const key of Object.keys(eventSubSubscriptions)) delete eventSubSubscriptions[key];
          await subscribeAll();
          console.log("✅ EventSub verbunden.");
        }
      }else if(t==="notification"){
        const messageId=String(payload.metadata?.message_id||"").trim();
        if(pgStore.enabled&&messageId){
          const first=pgStore.reserveEventSub(messageId,payload.metadata?.subscription_type||null,payload.metadata?.message_timestamp||null);
          if(!first){
            audit("eventsub-system","eventsub.duplicate.ignored",{section:"events",messageId,type:payload.metadata?.subscription_type||null});
            return;
          }
        }
        await handleNotification(payload);
      }else if(t==="session_keepalive"){
        // lastMessageAt wurde bereits aktualisiert.
      }else if(t==="session_reconnect"){
        const nextUrl=payload.payload?.session?.reconnect_url;
        if(!nextUrl){
          eventSubRuntime.lastError="Twitch-Reconnect ohne reconnect_url";
          try{ socket.close(4007,"missing reconnect url"); }catch{}
          return;
        }

        // Laut Twitch bleibt die alte Verbindung offen, bis die neue Welcome sendet.
        openEventSubSocket(nextUrl,{twitchReconnect:true,previousSocket:socket});
      }else if(t==="revocation"){
        const sub=payload.payload?.subscription||{};
        if(sub.type){
          eventSubSubscriptions[sub.type]={
            ok:false,
            status:sub.status||"revoked",
            error:`Subscription revoked: ${sub.status||"unknown"}`,
            tokenAccount:eventSubSubscriptions[sub.type]?.tokenAccount||null,
            updatedAt:new Date().toISOString()
          };
        }
        console.error("⚠️ EventSub Subscription widerrufen:",sub.type,sub.status);
      }
    }catch(e){
      eventSubRuntime.lastError=e.message||String(e);
      console.error("EventSub message error",e);
    }
  });

  socket.addEventListener("close",event=>{
    if(twitchReconnect){
      if(socket===pendingReconnectSocket) pendingReconnectSocket=null;

      // Falls die neue Reconnect-Verbindung scheitert, aber die alte noch lebt,
      // starten wir keinen zweiten normalen Socket parallel.
      if(ws===previousSocket && previousSocket?.readyState===WebSocket.OPEN){
        eventSubRuntime.state="connected";
        eventSubRuntime.lastError=`Reconnect-Verbindung geschlossen${event?.code?` (${event.code})`:""}`;
        setTimeout(()=>{
          if(ws===previousSocket && previousSocket.readyState===WebSocket.OPEN && !pendingReconnectSocket){
            // Twitch-Reconnect-URL nur erneut verwenden, solange die alte Session noch aktiv ist.
            openEventSubSocket(target,{twitchReconnect:true,previousSocket});
          }
        },4000);
        return;
      }
    }

    handleEventSubClose(socket,event);
  });

  socket.addEventListener("error",e=>{
    const msg=e?.message||"WebSocket-Netzwerkfehler";
    eventSubRuntime.lastError=String(msg);
    console.error("EventSub socket error",msg);
  });

  return socket;
}

// 9.20.3: Subathon – eigene EventSub-Verbindung mit dem Token des Kanal-Kontos (Abos, Geschenkabos, Resubs, Bits).
// Läuft nur, solange das Modul eingeschaltet ist und das Kanal-Konto verbunden wurde. Ereignisnamen ohne Punkt, weil der
// Weg zur Weboberfläche nur [a-z0-9-] erlaubt.
const SUBATHON_EVENT_NAMES = Object.freeze({"channel.subscribe":"subathon-subscribe","channel.subscription.gift":"subathon-gift","channel.subscription.message":"subathon-resub","channel.cheer":"subathon-cheer"});
const subathonChannelKey = () => currentRoster.channel.key;
let subathonConn = null, subathonTick = null;
function subathonConnection() {
  if (subathonConn) return subathonConn;
  const {createChannelEventSub} = require("/shared/twitch-channel-eventsub");
  subathonConn = createChannelEventSub({
    createSubscription: async (type, version, sessionId) => {
      if (!ids.channel) await resolveIds();
      const r = await twitchFetch(subathonChannelKey(), "https://api.twitch.tv/helix/eventsub/subscriptions", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({type, version, condition: {broadcaster_user_id: ids.channel}, transport: {method: "websocket", session_id: sessionId}})
      });
      const text = await r.text();
      if (!r.ok && r.status !== 409) {
        console.error(`Subathon-EventSub ${type} fehlgeschlagen:`, r.status, text);
        audit("eventsub-system", "subathon.subscription.failed", {section: "events", type, status: r.status});
        return {ok: false, status: r.status, error: text};
      }
      return {ok: true, status: r.status};
    },
    onNotification: async (type, event, metadata) => {
      const name = SUBATHON_EVENT_NAMES[type]; if (!name) return;
      audit("eventsub-system", `event.${type}.received`, {section: "events", user: event.user_login || event.user_name || null});
      await twitchEvents.emit(name, {event, metadata});
    }
  });
  return subathonConn;
}
let subathonScopeSig = "";
async function ensureSubathonConnection() {
  syncAccounts();
  const conn = subathonConnection();
  const on = subathonModuleOn();
  let tok = null; try { tok = loadToken(subathonChannelKey()); } catch {}
  const hasToken = !!tok?.access_token;
  const sig = JSON.stringify(tok?.scope ?? tok?.scopes ?? []);
  if (conn.isWanted()) {
    // Neu starten, wenn das Konto mit anderen Rechten neu verbunden wurde oder Abos seit über 2 Minuten fehlgeschlagen sind.
    const subs = Object.values(conn.status().subscriptions || {});
    const stale = subs.some(x => !x.ok && Date.now() - new Date(x.updatedAt || 0).getTime() > 120000);
    if (!on || !hasToken || sig !== subathonScopeSig || stale) conn.stop();
  }
  if (on && hasToken && !conn.isWanted()) {
    try { if (!ids.channel) await resolveIds(); } catch (e) { console.warn("⚠️ Subathon: Kanal-ID nicht ermittelt:", e.message); }
    subathonScopeSig = sig; conn.start();
  }
  return subathonStatus();
}
function subathonStatus() {
  const on = subathonModuleOn();
  let hasToken = false; try { hasToken = !!loadToken(subathonChannelKey())?.access_token; } catch {}
  return {moduleOn: on, hasToken, ...subathonConnection().status()};
}
function startSubathonWatcher() { if (!subathonTick) { subathonTick = setInterval(() => ensureSubathonConnection().catch(e => console.warn("⚠️ Subathon-Verbindung:", e.message)), 15000); subathonTick.unref?.(); setTimeout(() => ensureSubathonConnection().catch(() => {}), 3000); } }

function connectEventSub(){
  return openEventSubSocket(EVENTSUB_BASE_URL);
}




function writeClipState(state) {
  const entries = Object.entries(state.seen || {})
    .sort((a,b)=>String(b[1]?.createdAt || "").localeCompare(String(a[1]?.createdAt || "")))
    .slice(0,500);
  state.seen = Object.fromEntries(entries);
  if(pgStore.enabled){pgStore.putClipState(state);return;}
  writeJson(FILES.clipState, state);
}

function renderClipMessage(template, clip, showCreator=true) {
  const creator = String(clip.creator_name || clip.creator_id || "unbekannt");
  let message = String(template || "")
    .replaceAll("{title}", String(clip.title || "Neuer Clip"))
    .replaceAll("{url}", String(clip.url || ""))
    .replaceAll("{creator}", creator)
    .replaceAll("{clip_id}", String(clip.id || ""));

  if (!showCreator) {
    message = message
      .replace(/\s*[–-]\s*erstellt von\s*@?\{?creator\}?\s*/gi, " ")
      .replace(/\s*erstellt von\s*@?[^ ]+\s*/gi, " ");
  }

  return message.replace(/\s+/g, " ").trim();
}

async function fetchRecentClips(minutes=10) {
  if (!ids.channel) throw new Error("Channel-ID fehlt.");

  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - Math.max(2, minutes) * 60_000);

  const url = new URL("https://api.twitch.tv/helix/clips");
  url.searchParams.set("broadcaster_id", ids.channel);
  url.searchParams.set("first", "100");
  url.searchParams.set("started_at", startedAt.toISOString());
  url.searchParams.set("ended_at", endedAt.toISOString());

  let r;
  try {
    r = await twitchAppFetch(url.toString());
  } catch (e) {
    // 9.26.1: statt „fetch failed“ die Ursache nennen (DNS, Zeitüberschreitung, …)
    throw new Error(describeFetchError(e, "Twitch (api.twitch.tv)"));
  }
  const j = await r.json().catch(()=>({}));

  if (!r.ok) {
    throw new Error(`Clips konnten nicht geladen werden (${r.status}): ${JSON.stringify(j)}`);
  }

  return (j.data || []).sort((a,b)=>String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

let clipMonitorBusy = false;
let clipMonitorLastTickAt = 0;
// 9.26.1: Zeitpunkt des letzten erfolgreichen Twitch-Abrufs. Im Prozess gemerkt, weil der Datenbank-Zustand
// nur feste Spalten kennt; nach einem Neustart gilt wieder das normale Suchfenster.
let clipLastSuccessAt = null;

async function checkNewClips({manual=false}={}) {
  if (clipMonitorBusy) return {ok:true, skipped:"busy"};
  clipMonitorBusy = true;

  try {
    const settings = readJson(FILES.settings, DEFAULT_SETTINGS);
    const cfg = normalizeClipSettings(settings);
    const state = readClipState();

    const shareToTwitch = cfg.enabled && (!cfg.onlyLive || await isStreamLive());

    // 9.26.1: nach einem Ausfall ab dem letzten erfolgreichen Abruf suchen (bisher fest 10 Minuten).
    const clips = await fetchRecentClips(clipLookbackMinutes(clipLastSuccessAt || state.lastSuccessAt));
    state.lastCheckedAt = new Date().toISOString();
    state.lastSuccessAt = state.lastCheckedAt;
    clipLastSuccessAt = state.lastCheckedAt;
    state.lastError = null;

    // Beim allerersten Lauf nur den aktuellen Bestand markieren.
    // So wird beim Aktivieren nicht plötzlich ein alter Clip gespammt.
    if (!state.initialized) {
      for (const clip of clips) {
        state.seen[clip.id] = {
          createdAt:clip.created_at,
          title:clip.title,
          url:clip.url,
          creator:clip.creator_name || ""
        };
      }
      state.initialized = true;
      writeClipState(state);
      audit("clip-system","clip.monitor.initialized",{
        section:"clips",
        knownClips:clips.length
      });
      return {ok:true, initialized:true, found:0};
    }

    const fresh = [];

    for (const clip of clips) {
      if(!clip?.id) continue;
      const isFresh = pgStore.enabled ? !!pgStore.reserveClip(clip)?.inserted : !state.seen[clip.id];
      if(!isFresh) continue;
      fresh.push(clip);
      const detectedAfterSeconds = clipDelaySeconds(clip.created_at);
      enqueueDiscordAnnouncement("clip",clip.id,{
        clipId:clip.id,
        title:clip.title||"Neuer Twitch-Clip",
        url:clip.url||"",
        creator:clip.creator_name||"",
        createdAt:clip.created_at||null,
        thumbnailUrl:clip.thumbnail_url||""
      });
      setTimeout(flushDiscordBridge,250);

      // Vor dem Chat-Senden markieren, damit ein Fehler/Restart nicht doppelt postet.
      state.seen[clip.id] = {
        createdAt:clip.created_at,
        title:clip.title,
        url:clip.url,
        creator:clip.creator_name || ""
      };
      writeClipState(state);

      const message = renderClipMessage(cfg.message, clip, cfg.showCreator);

      try {
        if (shareToTwitch) {
          await sendChat(clipBotKey(), message);
        }

        const sharedAt=new Date().toISOString();
        state.lastShared = {id:clip.id,title:clip.title,url:clip.url,creator:clip.creator_name || "",createdAt:clip.created_at,sharedAt,detectedAfterSeconds};
        if(pgStore.enabled)pgStore.markClipShared(clip,sharedAt);
        writeClipState(state);

        audit(botRoster.resolveBotKey(currentRoster,clipBotKey()),"clip.shared",{
          section:"clips",
          clipId:clip.id,
          title:clip.title,
          url:clip.url,
          creator:clip.creator_name || "",
          detectedAfterSeconds
        });
      } catch (e) {
        console.error("⚠️ Clip konnte nicht geteilt werden:",e.message);
        state.lastError = e.message;
        if(pgStore.enabled)pgStore.markClipError(clip.id,e.message);
        writeClipState(state);

        audit(botRoster.resolveBotKey(currentRoster,clipBotKey()),"clip.share.failed",{
          section:"clips",
          clipId:clip.id,
          title:clip.title,
          error:e.message
        });
      }
    }

    writeClipState(state);
    return {ok:true, found:fresh.length, clips:fresh};
  } catch (e) {
    const state = readClipState();
    state.lastCheckedAt = new Date().toISOString();
    state.lastError = e.message;
    writeClipState(state);

    console.error("⚠️ Clip-Monitor:",e.message);
    audit("clip-system","clip.monitor.failed",{section:"clips",error:e.message});
    return {ok:false,error:e.message};
  } finally {
    clipMonitorBusy = false;
  }
}

function startClipMonitor() {
  setInterval(async()=>{
    const settings = readJson(FILES.settings, DEFAULT_SETTINGS);
    if (!isModuleEnabled(settings, "clips")) return; // 9.7.0: Modul „Clips“ aus → keine Suche, kein Teilen, keine Discord-Meldung
    const cfg = normalizeClipSettings(settings);

    const now = Date.now();
    const intervalMs = Math.max(5, Number(cfg.intervalSeconds || 10)) * 1000;
    if (now - clipMonitorLastTickAt < intervalMs) return;

    clipMonitorLastTickAt = now;
    await checkNewClips();
  }, 2000);
}

let streamLiveCache = {
  value:false,
  live:false,
  streamId:null,
  startedAt:null,
  checkedAt:0
};

async function getStreamInfo() {
  const now=Date.now();

  // Nicht bei jedem Chat-Trigger Twitch neu abfragen.
  if(now-streamLiveCache.checkedAt < 60_000){
    return {
      live:!!streamLiveCache.live,
      streamId:streamLiveCache.streamId||null,
      startedAt:streamLiveCache.startedAt||null
    };
  }

  try{
    const r=await twitchFetch(
      mainBotKey(),
      `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(ids.channel)}`
    );
    const j=await r.json();

    if(!r.ok){
      throw new Error(`Live-Status fehlgeschlagen: ${r.status} ${JSON.stringify(j)}`);
    }

    const stream=Array.isArray(j.data) ? j.data[0] : null;
    streamLiveCache={
      value:!!stream,
      live:!!stream,
      streamId:stream?.id ? String(stream.id) : null,
      startedAt:stream?.started_at||null,
      checkedAt:now
    };

    return {
      live:!!stream,
      streamId:streamLiveCache.streamId,
      startedAt:streamLiveCache.startedAt
    };
  }catch(e){
    console.error("⚠️ Live-Status konnte nicht geprüft werden:",e.message);
    streamLiveCache={value:false,live:false,streamId:null,startedAt:null,checkedAt:now};
    return {live:false,streamId:null,startedAt:null};
  }
}

async function isStreamLive() {
  const info=await getStreamInfo();
  return info.live;
}

function startTimers() {
  setInterval(async () => {
    const s = readJson(FILES.settings, DEFAULT_SETTINGS);
    prepareSettings(s);
    const now = Date.now();

    const enabledTimers = (s.timers || []).filter(t => t.enabled);
    if (!enabledTimers.length) return;

    // Timer-Nachrichten werden ausschließlich gesendet, wenn der Kanal live ist.
    const live = await isStreamLive();

    if (!live) {
      // Keine Chat-Zeilen aus Offline-Zeiten in den nächsten Stream übernehmen.
      if (streamWasLive) {
        chatLineCount = 0;
        timerLineBaseline.clear();
        timerStartedAt.clear();
      }
      streamWasLive = false;
      return;
    }

    // Frischer Stream / frischer Bot-Start:
    // Der Intervall-Timer beginnt ab jetzt; es wird nicht sofort beim Start gesendet.
    if (!streamWasLive) {
      streamWasLive = true;
      chatLineCount = 0;
      timerLineBaseline.clear();
      timerStartedAt.clear();
    }

    for (const t of enabledTimers) {
      const everyMs = Math.max(1, Number(t.everyMinutes || 30)) * 60_000;
      const minLines = Math.max(0, Number(t.minLines || 0));
      const conditionMode = String(t.conditionMode || "and").toLowerCase();
      const key = `timer:${t.id}`;

      if (!timerStartedAt.has(t.id)) {
        timerStartedAt.set(t.id, now);
        timerLineBaseline.set(t.id, chatLineCount);
      }

      const lastSent = cooldowns.get(key);
      const timeBase = lastSent || timerStartedAt.get(t.id);
      const elapsedEnough = now - timeBase >= everyMs;

      const baseline = timerLineBaseline.get(t.id) ?? 0;
      const linesSinceLastSend = Math.max(0, chatLineCount - baseline);
      const linesEnough = linesSinceLastSend >= minLines;

      const shouldSend = conditionMode === "or"
        ? (elapsedEnough || linesEnough)
        : (elapsedEnough && linesEnough);

      // UND: Zeit und Zeilen müssen erfüllt sein.
      // ODER: Eine der beiden Bedingungen reicht.
      if (shouldSend) {
        await sendChat(t.bot || mainBotKey(), t.text);

        cooldowns.set(key, now);
        timerLineBaseline.set(t.id, chatLineCount);

        // Nach jedem Senden beginnt für beide Bedingungen ein neuer Zyklus.
        timerStartedAt.set(t.id, now);
      }
    }
  }, 30_000);
}



// ===== 8.9.15 · Entkopplung Schritt 1a: Schnittstelle Web-Kern → Twitch-Laufzeit =====
// Der Web-Kern (alles unterhalb dieser Stelle: Sitzungen, Rechte, Routen, Systemstatus, Backup)
// greift auf die Twitch-Laufzeit (EventSub, Chat, Tokens, Zähler, Follower-Cache) nur noch über
// dieses Objekt zu. Heute sind es direkte Funktionsaufrufe im selben Prozess; später wird daraus
// die interne HTTP-API des eigenen Twitch-Bot-Containers. Deshalb liefert eventSubStatus() eine
// Kopie aus einfachen Werten und keine Verweise auf Socket oder Laufzeitobjekte.
// 8.9.20 · Entkopplung 3a: Jede Methode ist asynchron und nimmt/liefert nur einfache, übertragbare
// Werte (JSON). Damit verhält sich die Schnittstelle im selben Prozess genauso wie später über die
// interne HTTP-API; ein vergessenes "await" im Web-Kern fällt schon heute auf.
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const twitchRuntime = Object.freeze({
  async channelId(){return ids.channel||null;},
  // Tokens gehören allein der Twitch-Laufzeit (1c). Der Web-Kern bekommt nur Status, nie Token-Inhalte
  // oder Dateipfade; ein neu autorisiertes Token wird einmalig übergeben (storeAuthorizedToken).
  async hasToken(name){syncAccounts();const a=Object.prototype.hasOwnProperty.call(accountMap,name)?accountMap[name]:null;return !!a&&fs.existsSync(a.tokenFile);},
  async tokenPresence(){syncAccounts();return Object.fromEntries(Object.keys(accountMap).map(k=>[k,fs.existsSync(accountMap[k].tokenFile)]));},
  async connectionStatus(name){syncAccounts();return plain(await connectionStatus(name));},
  async storeAuthorizedToken(account,token,userId){
    syncAccounts();
    if(!Object.prototype.hasOwnProperty.call(accountMap,account))throw new Error("Unbekannter Twitch-Account.");
    if(!token||typeof token.access_token!=="string"||!token.access_token)throw new Error("Token fehlt.");
    saveToken(account,token);
    if(userId)ids[account]=String(userId);
    return {ok:true};
  },
  async subathonStatus(){return plain(subathonStatus());},
  async subathonEnsure(){return plain(await ensureSubathonConnection());},
  async eventSubStatus(){
    const open=ws?.readyState===WebSocket.OPEN;
    return plain({
      socketOpen:open,
      socketReadyState:ws?.readyState ?? null,
      socketState:eventSubSocketState(ws),
      sessionReady:!!wsSessionId,
      connected:open&&eventSubRuntime.state==="connected",
      runtime:{...eventSubRuntime},
      subscriptions:eventSubSubscriptions
    });
  },
  async sendChat(bot,text,options){return plain(await sendChat(bot,text,options));},
  // Arbeitet auf Kopien und gibt die abgeglichene Liste zurück (mit Twitch-IDs und Abgleichstatus);
  // der Aufrufer übernimmt sie ausdrücklich. So ist der Vertrag über Prozessgrenzen derselbe.
  async reconcileTwitchBlockedTerms(before,next,actor){
    const b={blockedWords:plain(before?.blockedWords||[])},n={blockedWords:plain(next?.blockedWords||[])};
    await reconcileTwitchBlockedTerms(b,n,actor);
    return {blockedWords:plain(n.blockedWords||[])};
  },
  async getFollowerPage(query){return plain(await getFollowerPage(query));},
  async messageCounterDiagnostics(){return plain(messageCounterDiagnostics());},
  async readDiscordBridgeState(){return plain(readDiscordBridgeState());},
  async checkNewClips(options){return plain(await checkNewClips(options));},
  // Der Wortfilter wurde in der Oberfläche geändert: sofort neu laden (sonst spätestens nach 5 s).
  async wordFilterChanged(){const c=wordFilterRefresh(true);return {revision:Number(c?.revision||0)};},
  // Live-Status des Kanals (für die Nutzungsstatistik der Oberfläche); intern 60 s zwischengespeichert.
  async streamInfo(){return plain(await getStreamInfo());},
  async findUserByLogin(login){
    const r=await twitchAppFetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(String(login||"").toLowerCase())}`);
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(`Twitch-Nutzer konnte nicht gesucht werden (${r.status}).`);
    return plain(j.data?.[0]||null);
  },
  async resolveIds(){await resolveIds();return {ok:true};},
  async start(){
    connectEventSub();
    startSubathonWatcher();
    startTimers();
    startClipMonitor();
    startDiscordBridge();
    startWatchtimeTracker();
    startMessageCounter();
    return {ok:true};
  },
  async stop(){stopMessageCounter();try{subathonConnection().stop();}catch{}return {ok:true};}
});

  return {twitchRuntime};
}

module.exports = { createTwitchRuntime, REQUIRED_DEPS };
