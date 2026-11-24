"use strict";
// Verbindung zwischen Weboberfläche und Twitch-Bot im getrennten Betrieb (Entkopplung Schritt 3b, 8.9.22).
//
// Im Ein-Container-Betrieb ruft die Weboberfläche die Twitch-Laufzeit direkt auf und die Laufzeit
// meldet Ereignisse direkt an die Übergabestelle. Im getrennten Betrieb laufen dieselben Aufrufe über
// das interne Docker-Netz:
//   Weboberfläche → Twitch-Bot:  POST /internal/twitch/call   {method,args}     (createRemoteTwitchRuntime)
//   Twitch-Bot → Weboberfläche:  POST /internal/twitch/event  {id,type,payload} (createRemoteTwitchEvents)
//                                POST /internal/twitch/chat-command, GET /internal/twitch/chat-commands
// Jede Anfrage trägt das gemeinsame Dienst-Geheimnis (wie beim Discord-Bot). Es gibt keine
// veröffentlichten Ports; die Adressen sind nur im Docker-Netz erreichbar.
const crypto = require("crypto");

const SECRET_HEADER = "x-bwk-service-secret";

// Methoden der Schnittstelle twitchRuntime, die über das Netz aufgerufen werden dürfen.
// start/stop/resolveIds gehören nicht dazu: Der Twitch-Bot steuert seinen Lebenszyklus selbst.
const CALLABLE_METHODS = Object.freeze([
  "channelId", "hasToken", "tokenPresence", "connectionStatus", "storeAuthorizedToken", "eventSubStatus",
  "sendChat", "reconcileTwitchBlockedTerms", "getFollowerPage", "messageCounterDiagnostics",
  "readDiscordBridgeState", "checkNewClips", "wordFilterChanged", "streamInfo", "findUserByLogin", "subathonStatus", "subathonEnsure"
]);
// Zeitgrenzen je Aufruf (ms). Abgleich, Clip-Prüfung und Follower-Liste sprechen selbst mit Twitch.
const CALL_TIMEOUTS = Object.freeze({ reconcileTwitchBlockedTerms: 30000, checkNewClips: 30000, getFollowerPage: 20000, connectionStatus: 12000, sendChat: 12000 });
const DEFAULT_CALL_TIMEOUT = 8000;

function secretUsable(secret) {
  const s = String(secret || "");
  return s.length >= 32 && !/^HIER_|^CHANGE_ME/i.test(s);
}
// Vergleich in konstanter Zeit; ein zu kurzes oder fehlendes Geheimnis passt nie.
function secretMatches(supplied, expected) {
  const a = String(supplied || ""), b = String(expected || "");
  if (!secretUsable(b) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function postJson({ fetchImpl, url, secret, body, timeoutMs, method = "POST" }) {
  if (!secretUsable(secret)) throw new Error("INTERNAL_SERVICE_SECRET fehlt, ist zu kurz oder enthält noch den Platzhalter.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-BWK-Service-Secret": secret },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) })
    });
    const text = await response.text();
    let parsed = null;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
    return { status: response.status, body: parsed };
  } catch (e) {
    if (e?.name === "AbortError") { const err = new Error(`Keine Antwort innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden.`); err.unreachable = true; throw err; }
    const err = new Error(e?.message || "Verbindung fehlgeschlagen."); err.unreachable = true; throw err;
  } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------------------------------------
// Seite Twitch-Bot: nimmt Aufrufe der Weboberfläche entgegen und führt sie auf der Laufzeit aus.
// ---------------------------------------------------------------------------------------------
function createTwitchCallHandler(twitchRuntime) {
  return async function handleCall(body) {
    const method = String(body?.method || "");
    if (!CALLABLE_METHODS.includes(method)) return { status: 400, body: { ok: false, error: "Unbekannte Methode." } };
    const args = Array.isArray(body?.args) ? body.args : [];
    if (args.length > 4) return { status: 400, body: { ok: false, error: "Zu viele Argumente." } };
    try {
      const result = await twitchRuntime[method](...args);
      return { status: 200, body: { ok: true, result: result === undefined ? null : result } };
    } catch (e) {
      // Fachliche Fehler (z. B. „Twitch hat das Wort abgelehnt“) gehen mit ihrer Meldung zurück.
      return { status: 200, body: { ok: false, error: String(e?.message || "Fehler im Twitch-Bot.").slice(0, 500), status: Number(e?.status || 0) || undefined } };
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Seite Weboberfläche: dieselbe Schnittstelle wie twitchRuntime, aber über das interne Netz.
// ---------------------------------------------------------------------------------------------
function unreachableEventSubStatus() {
  return {
    reachable: false, socketOpen: false, socketReadyState: null, socketState: "nicht erreichbar", sessionReady: false, connected: false,
    runtime: { state: "unreachable", lastError: "Twitch-Bot nicht erreichbar" }, subscriptions: {}
  };
}
function createRemoteTwitchRuntime({ baseUrl, secret, fetchImpl = (...a) => fetch(...a), log = console, now = () => Date.now() }) {
  if (!baseUrl) throw new Error("Adresse des Twitch-Bots fehlt.");
  let lastChannelId = null, lastOkAt = 0, lastError = null, lastErrorAt = 0;
  async function call(method, args = []) {
    let r;
    try {
      r = await postJson({ fetchImpl, url: `${baseUrl}/internal/twitch/call`, secret, body: { method, args }, timeoutMs: CALL_TIMEOUTS[method] || DEFAULT_CALL_TIMEOUT });
    } catch (e) {
      lastError = e.message; lastErrorAt = now();
      const err = new Error("Twitch-Bot nicht erreichbar: " + e.message); err.unreachable = true; err.status = 503; throw err;
    }
    if (r.status !== 200 || !r.body) {
      lastError = `HTTP ${r.status}`; lastErrorAt = now();
      const err = new Error(r.status === 401 ? "Twitch-Bot lehnt das Dienst-Geheimnis ab." : `Twitch-Bot antwortet mit HTTP ${r.status}.`); err.unreachable = true; err.status = 503; throw err;
    }
    lastOkAt = now(); lastError = null;
    if (!r.body.ok) { const err = new Error(r.body.error || "Fehler im Twitch-Bot."); if (r.body.status) err.status = r.body.status; throw err; }
    return r.body.result === null ? undefined : r.body.result;
  }
  // Nur Anzeige-Abfragen bekommen einen Ersatzwert, damit Systemstatus und Übersicht auch dann laden,
  // wenn der Twitch-Bot gerade neu startet. Aktionen und Datensicherung melden den Fehler.
  async function withFallback(method, args, fallback) {
    try { return await call(method, args); }
    catch (e) { if (!e.unreachable) throw e; return typeof fallback === "function" ? fallback(e) : fallback; }
  }
  return Object.freeze({
    async channelId() { const id = await withFallback("channelId", [], () => lastChannelId); if (id) lastChannelId = id; return id || null; },
    async hasToken(name) { return !!(await withFallback("hasToken", [name], false)); },
    async tokenPresence() { return (await withFallback("tokenPresence", [], {})) || {}; },
    async eventSubStatus() { const s = await withFallback("eventSubStatus", [], unreachableEventSubStatus); return s && s.reachable === undefined ? { reachable: true, ...s } : s; },
    async messageCounterDiagnostics() { return await withFallback("messageCounterDiagnostics", [], e => ({ available: false, error: e.message })); },
    async streamInfo() { return await withFallback("streamInfo", [], { live: false, streamId: null, startedAt: null }); },
    async connectionStatus(name) { return call("connectionStatus", [name]); },
    async storeAuthorizedToken(account, token, userId) { return call("storeAuthorizedToken", [account, token, userId ?? null]); },
    async sendChat(bot, text, options) { return call("sendChat", options === undefined ? [bot, text] : [bot, text, options]); },
    async reconcileTwitchBlockedTerms(before, next, actor) { return call("reconcileTwitchBlockedTerms", [{ blockedWords: before?.blockedWords || [] }, { blockedWords: next?.blockedWords || [] }, actor ?? null]); },
    async getFollowerPage(query) { return call("getFollowerPage", [query ?? {}]); },
    async readDiscordBridgeState() { return call("readDiscordBridgeState", []); },
    async checkNewClips(options) { return call("checkNewClips", [options ?? {}]); },
    async wordFilterChanged() { return call("wordFilterChanged", []); },
    async subathonStatus() { return await withFallback("subathonStatus", [], e => ({ moduleOn: false, hasToken: false, running: false, state: "unreachable", connected: false, subscriptions: {}, lastError: e.message })); },
    async subathonEnsure() { return call("subathonEnsure", []); },
    async findUserByLogin(login) { const u = await call("findUserByLogin", [login]); return u === undefined ? null : u; },
    // Lebenszyklus: Der Twitch-Bot startet und stoppt sich selbst.
    async resolveIds() { return { ok: true, remote: true }; },
    async start() { try { log.log("ℹ️ Der Twitch-Bot läuft als eigener Dienst."); } catch {} return { ok: true, remote: true }; },
    async stop() { return { ok: true, remote: true }; },
    // Nur für Statusanzeigen der Weboberfläche (keine Methode der Laufzeit).
    // 8.9.23: Laufzeitangaben des Twitch-Bot-Dienstes für die Dienste-Übersicht; null, wenn er nicht antwortet.
    async serviceStatus() {
      try {
        const r = await postJson({ fetchImpl, url: `${baseUrl}/internal/twitch/status`, secret, method: "GET", timeoutMs: 4000 });
        if (r.status !== 200 || !r.body?.ok) return null;
        const b = r.body;
        return { startedAt: b.startedAt || null, runtimeStarted: b.runtimeStarted === true, waitingFor: b.waitingFor || null, pendingEvents: Number(b.pendingEvents || 0),
          uptimeSeconds: Number(b.uptimeSeconds || 0), memoryRss: Number(b.memoryRss || 0), nodeVersion: String(b.nodeVersion || "") };
      } catch { return null; }
    },
    linkStatus() { return { mode: "remote", baseUrl, lastOkAt: lastOkAt || null, lastError, lastErrorAt: lastErrorAt || null }; },
    async restart() { const r = await postJson({ fetchImpl, url: `${baseUrl}/internal/twitch/restart`, secret, body: {}, timeoutMs: 5000 }); if (r.status !== 200) throw new Error(`Twitch-Bot antwortet mit HTTP ${r.status}.`); return { ok: true }; }
  });
}

// ---------------------------------------------------------------------------------------------
// Seite Twitch-Bot: meldet Ereignisse an die Weboberfläche (ersetzt dort die lokale Übergabestelle).
// ---------------------------------------------------------------------------------------------
function createRemoteTwitchEvents({ baseUrl, secret, fetchImpl = (...a) => fetch(...a), log = console, now = () => Date.now(),
  setTimer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, maxQueue = 200, maxAgeMs = 10 * 60 * 1000, commandRefreshMs = 30000 }) {
  if (!baseUrl) throw new Error("Adresse der Weboberfläche fehlt.");
  const queue = [];            // noch nicht zugestellte Ereignisse (nur im Speicher)
  let retryScheduled = false, retryDelay = 2000, commands = new Set(), commandsLoadedAt = 0, commandsLoading = null;
  const chatCommandOf = message => (String(message || "").trim().split(/\s+/)[0] || "").toLowerCase();

  async function deliver(entry) {
    const r = await postJson({ fetchImpl, url: `${baseUrl}/internal/twitch/event`, secret, body: { id: entry.id, type: entry.type, payload: entry.payload }, timeoutMs: 5000 });
    if (r.status !== 200 || !r.body?.ok) throw new Error(`Weboberfläche antwortet mit HTTP ${r.status}.`);
    return Number(r.body.delivered || 0);
  }
  function scheduleRetry() {
    if (retryScheduled || !queue.length) return;
    retryScheduled = true;
    setTimer(async () => {
      retryScheduled = false;
      while (queue.length) {
        const entry = queue[0];
        if (now() - entry.createdAt > maxAgeMs) { queue.shift(); try { log.error(`⚠️ Ereignis ${entry.type} nach 10 Minuten nicht zustellbar, verworfen.`); } catch {} continue; }
        try { await deliver(entry); queue.shift(); retryDelay = 2000; }
        catch { retryDelay = Math.min(30000, retryDelay * 2); break; }
      }
      scheduleRetry();
    }, retryDelay);
  }
  // Liefert die Zahl der Empfänger; 0, wenn die Weboberfläche gerade nicht erreichbar ist –
  // das Ereignis wird dann bis zu 10 Minuten lang erneut versucht (mit gleicher Kennung, damit
  // die Weboberfläche eine doppelte Zustellung erkennt).
  async function emit(type, payload) {
    const entry = { id: crypto.randomUUID(), type: String(type), payload: payload === undefined ? null : JSON.parse(JSON.stringify(payload)), createdAt: now() };
    if (queue.length) { enqueue(entry); return 0; }   // Reihenfolge wahren
    try { return await deliver(entry); }
    catch (e) { try { log.error(`⚠️ Ereignis ${entry.type} noch nicht zugestellt (${e.message}); wird wiederholt.`); } catch {} enqueue(entry); return 0; }
  }
  function enqueue(entry) { if (queue.length >= maxQueue) queue.shift(); queue.push(entry); scheduleRetry(); }
  // 9.27.0: Flüchtige Ereignisse (z. B. Chat-Overlay) werden genau einmal versucht. Sie kommen nie in die
  // Warteschlange: Ein veraltetes Chat-Ereignis wäre wertlos und würde wichtige Ereignisse (Follow, Raid) verdrängen.
  async function emitTransient(type, payload) {
    const entry = { id: crypto.randomUUID(), type: String(type), payload: payload === undefined ? null : JSON.parse(JSON.stringify(payload)), createdAt: now() };
    try { return await deliver(entry); } catch { return 0; }
  }

  async function refreshCommands(force = false) {
    if (!force && now() - commandsLoadedAt < commandRefreshMs) return;
    if (commandsLoading) return commandsLoading;
    commandsLoading = (async () => {
      try {
        const r = await postJson({ fetchImpl, url: `${baseUrl}/internal/twitch/chat-commands`, secret, method: "GET", timeoutMs: 4000 });
        if (r.status === 200 && Array.isArray(r.body?.commands)) { commands = new Set(r.body.commands.map(c => String(c).toLowerCase()).filter(c => /^!\S+$/.test(c)).slice(0, 100)); commandsLoadedAt = now(); }
      } catch { /* alte Liste behalten */ }
      finally { commandsLoading = null; }
    })();
    return commandsLoading;
  }
  function claimsChat(message) { return commands.has(chatCommandOf(message)); }
  // true = die Weboberfläche hat die Nachricht übernommen. Ist sie nicht erreichbar, gilt die
  // Nachricht als nicht übernommen und wird wie jede andere Chat-Nachricht behandelt.
  async function dispatchChatCommand(event, message) {
    if (!commandsLoadedAt) await refreshCommands(true); else refreshCommands().catch(() => {});
    if (!claimsChat(message)) return false;
    try {
      const r = await postJson({ fetchImpl, url: `${baseUrl}/internal/twitch/chat-command`, secret, body: { event, message: String(message || "") }, timeoutMs: 6000 });
      if (r.status !== 200 || !r.body?.ok) throw new Error(`HTTP ${r.status}`);
      return r.body.handled === true;
    } catch (e) { try { log.error(`⚠️ Chat-Befehl ${chatCommandOf(message)} nicht an die Weboberfläche zustellbar: ${e.message}`); } catch {} return false; }
  }
  const unsupported = name => () => { throw new Error(`${name} ist nur in der Weboberfläche verfügbar.`); };
  return { emit, emitTransient, dispatchChatCommand, claimsChat, refreshCommands, pending: () => queue.length, on: unsupported("on"), registerChatCommands: unsupported("registerChatCommands") };
}

// Weboberfläche: erkennt doppelt zugestellte Ereignisse an ihrer Kennung (kleiner Umlaufspeicher).
function createEventDeduper(limit = 500) {
  const seen = new Set(), order = [];
  return function firstTime(id) {
    const key = String(id || "");
    if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return true;   // ohne brauchbare Kennung nicht verwerfen
    if (seen.has(key)) return false;
    seen.add(key); order.push(key);
    if (order.length > limit) seen.delete(order.shift());
    return true;
  };
}

module.exports = { SECRET_HEADER, CALLABLE_METHODS, CALL_TIMEOUTS, secretUsable, secretMatches, createTwitchCallHandler, createRemoteTwitchRuntime, createRemoteTwitchEvents, createEventDeduper, unreachableEventSubStatus };
