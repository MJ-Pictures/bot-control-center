"use strict";
// Twitch-Bot als eigener Dienst (Entkopplung Schritt 3b/3c, ab 8.9.22).
//
// Dieser Dienst enthält nur den Twitch-Bot: EventSub, Chat, Moderation, Timer, Zähler, Clips,
// Discord-Brücke. Er hat keine Weboberfläche und keinen veröffentlichten Port. Die Weboberfläche
// spricht ihn über das interne Docker-Netz an (POST /internal/twitch/call), er meldet Ereignisse
// dorthin zurück (siehe /shared/twitch-link.js).
//
// Schutz vor doppeltem Bot: Der Dienst startet die Twitch-Laufzeit erst, wenn die Weboberfläche
// bestätigt hat, dass sie selbst im getrennten Betrieb läuft. Läuft sie noch im Ein-Container-
// Betrieb (mit eingebautem Bot), bleibt dieser Dienst untätig – sonst würden zwei Bots antworten.
const http = require("http");

const { applySecretFiles, TWITCH_SERVICE_SECRETS } = require("/shared/secret-env");
applySecretFiles(TWITCH_SERVICE_SECRETS, { log: msg => console.warn(msg) });

const { internalBaseUrl } = require("/shared/internal-url");
const { createCore } = require("/shared/bcc-core");
const { createTwitchData } = require("/shared/twitch-data");
const { createTwitchRuntime } = require("/shared/twitch-runtime");
const { SECRET_HEADER, secretUsable, secretMatches, createTwitchCallHandler, createRemoteTwitchEvents } = require("/shared/twitch-link");

const PORT = Number(process.env.TWITCH_SERVICE_PORT || 3002);
const CONTROL_CENTER_URL = internalBaseUrl(process.env.CONTROL_CENTER_URL, "http://web:3000", { name: "CONTROL_CENTER_URL", warn: m => console.warn("⚠️ " + m) });
const BODY_LIMIT = 1024 * 1024;

const core = createCore();
const { INTERNAL_SERVICE_SECRET, getAppAccessToken } = core;
if (!secretUsable(INTERNAL_SERVICE_SECRET)) {
  console.error("❌ INTERNAL_SERVICE_SECRET fehlt, ist zu kurz oder enthält noch den Platzhalter. Der Twitch-Bot startet nicht.");
  process.exit(1);
}

const twitchEvents = createRemoteTwitchEvents({ baseUrl: CONTROL_CENTER_URL, secret: INTERNAL_SERVICE_SECRET });
const twitchData = createTwitchData({
  FILES: core.FILES, DEFAULT_SETTINGS: core.DEFAULT_SETTINGS, pgStore: core.pgStore, giveawayStore: core.giveawayStore,
  readJson: core.readJson, writeJson: core.writeJson, audit: core.audit,
  getStreamInfo: () => twitchRuntime.streamInfo()
});
const { twitchRuntime } = createTwitchRuntime({
  matchWordFilter: core.matchWordFilter, CLIENT_ID: core.CLIENT_ID, CLIENT_SECRET: core.CLIENT_SECRET, CHANNEL_LOGIN: core.CHANNEL_LOGIN,
  DATA_DIR: core.DATA_DIR, FILES: core.FILES, DEFAULT_SETTINGS: core.DEFAULT_SETTINGS, pgStore: core.pgStore,
  twitchWordFilterEscalation: core.twitchWordFilterEscalation, wordFilterRefresh: core.wordFilterRefresh,
  wordFilterAction: core.wordFilterAction, wordFilterCentralReady: core.wordFilterCentralReady,
  twitchEvents, giveawayStore: core.giveawayStore, readJson: core.readJson, writeJson: core.writeJson, audit: core.audit,
  twitchAppFetch: core.twitchAppFetch, discordServiceRequest: core.discordServiceRequest,
  ...twitchData
});

const handleCall = createTwitchCallHandler(twitchRuntime);
const state = { startedAt: new Date().toISOString(), runtimeStarted: false, waitingFor: "weboberflaeche", lastModeCheck: null, lastModeError: null };

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(data);
}
async function readBody(req) {
  const declared = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declared) && declared > BODY_LIMIT) { const e = new Error("Request ist zu groß."); e.status = 413; throw e; }
  const chunks = []; let total = 0;
  for await (const c of req) { total += c.length; if (total > BODY_LIMIT) { const e = new Error("Request ist zu groß."); e.status = 413; throw e; } chunks.push(c); }
  if (!total) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { const e = new Error("Ungültiges JSON."); e.status = 400; throw e; }
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = String(req.url || "").split("?")[0];
    // Ohne Geheimnis nur die Lebendprüfung für Docker – ohne Inhalte.
    if (pathname === "/health" && req.method === "GET") return sendJson(res, 200, { ok: true, service: "twitch-bot", runtimeStarted: state.runtimeStarted });
    if (!secretMatches(req.headers[SECRET_HEADER], INTERNAL_SERVICE_SECRET)) return sendJson(res, 401, { ok: false });
    if (pathname === "/internal/twitch/call" && req.method === "POST") {
      if (!state.runtimeStarted) return sendJson(res, 503, { ok: false, error: "Twitch-Bot ist noch nicht gestartet." });
      const r = await handleCall(await readBody(req));
      return sendJson(res, r.status, r.body);
    }
    // 8.9.23: Laufzeitangaben für die Dienste-Übersicht der Weboberfläche (keine Inhalte, keine Tokens).
    if (pathname === "/internal/twitch/status" && req.method === "GET") return sendJson(res, 200, { ok: true, ...state, pendingEvents: twitchEvents.pending(), uptimeSeconds: Math.floor(process.uptime()), memoryRss: process.memoryUsage().rss, nodeVersion: process.version });
    if (pathname === "/internal/twitch/restart" && req.method === "POST") {
      sendJson(res, 200, { ok: true });
      // Exit 75 = gewollter Neustart; supervisor.js startet den Dienst im selben Container neu.
      setTimeout(() => { console.log("🔄 Neustart des Twitch-Bots angefordert."); twitchRuntime.stop().finally(() => process.exit(75)); }, 600);
      return;
    }
    return sendJson(res, 404, { ok: false });
  } catch (e) {
    const status = Number(e?.status || 0);
    if (status === 400 || status === 413) return sendJson(res, status, { ok: false, error: e.message });
    console.error("⚠️ Twitch-Bot interne API:", e?.message || e);
    return sendJson(res, 500, { ok: false, error: "Interner Fehler." });
  }
});

// Fragt die Weboberfläche, in welcher Betriebsart sie läuft. Nur "remote" gibt den Start frei.
async function webMode() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const r = await fetch(`${CONTROL_CENTER_URL}/internal/twitch/mode`, { signal: controller.signal, headers: { "X-BWK-Service-Secret": INTERNAL_SERVICE_SECRET } });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return String(j?.mode || "");
  } finally { clearTimeout(timer); }
}
async function waitForRemoteMode() {
  let announced = "";
  for (;;) {
    try {
      const mode = await webMode();
      state.lastModeCheck = new Date().toISOString(); state.lastModeError = null;
      if (mode === "remote") return;
      state.waitingFor = "getrennter-betrieb";
      if (announced !== "embedded") { announced = "embedded"; console.warn("⏸️ Die Weboberfläche läuft im Ein-Container-Betrieb (eingebauter Twitch-Bot). Dieser Dienst bleibt untätig, damit nicht zwei Bots antworten."); }
    } catch (e) {
      state.lastModeError = e.message; state.waitingFor = "weboberflaeche";
      if (announced !== "down") { announced = "down"; console.warn(`⏳ Weboberfläche unter ${CONTROL_CENTER_URL} noch nicht erreichbar (${e.message}). Der Twitch-Bot wartet.`); }
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, () => { twitchRuntime.stop().finally(() => process.exit(0)); });

server.listen(PORT, async () => {
  console.log("======================================");
  console.log(" Bot Control Center – Twitch-Bot");
  console.log("======================================");
  console.log(`✅ Interne API auf Port ${PORT}; Weboberfläche: ${CONTROL_CENTER_URL}`);
  await waitForRemoteMode();
  state.waitingFor = null;
  try {
    await twitchRuntime.resolveIds();
    try { await getAppAccessToken(); } catch (e) { console.error("⚠️ App Access Token konnte beim Start nicht erstellt werden:", e.message); }
    twitchEvents.refreshCommands(true).catch(() => {});
    await twitchRuntime.start();
    state.runtimeStarted = true;
    console.log("✅ Twitch-Bot gestartet.");
  } catch (e) {
    // Wie bisher: eingeschränkt weiterlaufen (z. B. fehlende Tokens), damit die Oberfläche Verbindungen einrichten kann.
    state.runtimeStarted = true;
    console.error("⚠️ Twitch-Bot startet eingeschränkt:", e.message);
  }
});
