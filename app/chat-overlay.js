"use strict";
// 9.27.0: Chat-Overlay (OBS-Browserquelle). Der Twitch-Bot meldet jede Nachricht, die alle Filter bestanden hat;
// dieses Modul hält sie kurz zurück (einstellbare Verzögerung), damit später gelöschte Nachrichten nie im Stream
// erscheinen, und schickt sie dann an alle geöffneten Overlay-Quellen. Daten fremder Nutzer werden nicht gespeichert.
const { createSseLimiter, rejectTooMany } = require("../shared/sse-limits");
const { sanitizeMessage, sanitizeEvent, plainText, BADGE_URL, clean } = require("../shared/chat-overlay-core");

const THEMES = Object.freeze(["dark", "light", "angular"]);
const BOT_MODES = Object.freeze(["none", "game", "all"]);
const FONTS = Object.freeze(["system", "akzidenz"]);
const ALIGNS = Object.freeze(["left", "right"]);
// Bekannte Fremdbots, die standardmäßig nicht im Overlay erscheinen sollen (anpassbar).
const DEFAULT_IGNORED = Object.freeze(["nightbot", "streamelements", "streamlabs", "fossabot", "moobot", "wizebot"]);
const DEFAULT_CONFIG = Object.freeze({
  delaySeconds: 2, maxMessages: 8, displaySeconds: 60, theme: "dark", align: "left", fontScale: 100,
  accentColor: "#FAB70A", font: "system", hideCommands: true, botMessages: "none", ignoredUsers: DEFAULT_IGNORED,
  showBadges: true, showEmotes: true, nameColorDot: false, followCards: true, raidCards: true
});
const MAX_AGE_MS = 30000;          // Nachrichten, die länger unterwegs waren, werden nicht mehr gezeigt
const MAX_PENDING = 200;
const MAX_RECENT = 40;

const int = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} muss eine ganze Zahl von ${min} bis ${max} sein.`);
  return n;
};
const bool = (v, label) => {
  if (typeof v !== "boolean") throw new Error(`${label}: ungültiger Wert.`);
  return v;
};
const oneOf = (v, list, label) => {
  if (!list.includes(v)) throw new Error(`${label}: ungültiger Wert.`);
  return v;
};

// Prüft und ergänzt eine Konfiguration. strict=true (Speichern aus der Oberfläche): ungültige Werte sind Fehler.
// strict=false (Laden einer gespeicherten Datei): ungültige Werte fallen auf den Standard zurück.
function normalizeConfig(input, base = DEFAULT_CONFIG, strict = true) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = { ...DEFAULT_CONFIG, ...base };
  const apply = (key, fn) => {
    if (src[key] === undefined) return;
    try { out[key] = fn(src[key]); } catch (e) { if (strict) throw e; }
  };
  apply("delaySeconds", v => int(v, 0, 5, "Die Verzögerung"));
  apply("maxMessages", v => int(v, 3, 15, "Die Anzahl der Nachrichten"));
  apply("displaySeconds", v => int(v, 0, 600, "Die Anzeigedauer"));
  apply("fontScale", v => int(v, 70, 160, "Die Schriftgröße"));
  apply("theme", v => oneOf(v, THEMES, "Der Look"));
  apply("align", v => oneOf(v, ALIGNS, "Die Ausrichtung"));
  apply("font", v => oneOf(v, FONTS, "Die Schrift"));
  apply("botMessages", v => oneOf(v, BOT_MODES, "Bot-Nachrichten"));
  apply("hideCommands", v => bool(v, "Befehle ausblenden"));
  apply("showBadges", v => bool(v, "Abzeichen"));
  apply("showEmotes", v => bool(v, "Emotes"));
  apply("nameColorDot", v => bool(v, "Namensfarbe"));
  apply("followCards", v => bool(v, "Follow-Karten"));
  apply("raidCards", v => bool(v, "Raid-Karten"));
  apply("accentColor", v => { if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) throw new Error("Die Akzentfarbe muss wie #FAB70A aussehen."); return String(v).toUpperCase(); });
  apply("ignoredUsers", v => {
    const list = (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map(x => String(x).trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
    if (list.length > 50) throw new Error("Höchstens 50 ausgeblendete Konten.");
    for (const x of list) if (!/^[a-z0-9_]{1,25}$/.test(x)) throw new Error(`Ungültiger Twitch-Name: ${clean(x, 30)}`);
    return [...new Set(list)];
  });
  return out;
}

// Zwischenspeicher für Abzeichen-Bilder (Helix: Global + Kanal). Lädt im Hintergrund, blockiert nie.
function createBadgeCache({ fetchJson, channelId, now = () => Date.now(), ttlMs = 6 * 3600 * 1000, retryMs = 60 * 1000 } = {}) {
  let map = new Map(), loadedAt = 0, failedAt = 0, loading = null;
  async function load() {
    const next = new Map();
    const add = payload => {
      for (const set of Array.isArray(payload?.data) ? payload.data : []) {
        for (const v of Array.isArray(set?.versions) ? set.versions : []) {
          const url = String(v?.image_url_2x || v?.image_url_1x || "");
          if (set?.set_id && v?.id !== undefined && BADGE_URL.test(url)) next.set(`${set.set_id}/${v.id}`, url);
        }
      }
    };
    add(await fetchJson("https://api.twitch.tv/helix/chat/badges/global"));
    const cid = await channelId?.();
    if (cid) { try { add(await fetchJson(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${encodeURIComponent(String(cid))}`)); } catch { /* Kanal-Abzeichen sind optional */ } }
    map = next; loadedAt = now(); failedAt = 0;
  }
  function ensure() {
    if (loading) return loading;
    const t = now();
    if (loadedAt && t - loadedAt < ttlMs) return null;
    if (failedAt && t - failedAt < retryMs) return null;
    loading = load().catch(() => { failedAt = now(); }).finally(() => { loading = null; });
    return loading;
  }
  return { ensure, url: (set, id) => map.get(`${set}/${id}`) || null, size: () => map.size };
}

function createChatOverlay({ read, write, badges = null, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = h => clearTimeout(h) } = {}) {
  let config = normalizeConfig(read?.() || {}, DEFAULT_CONFIG, false);
  const clients = new Set();
  const sseLimiter = createSseLimiter({ max: 20, perIp: 4 });
  const pending = new Map();          // Nachrichten-ID → { message, timer }
  let recent = [];                    // bereits gezeigte Nachrichten (für neu geöffnete Quellen)
  let botSeq = 0, testSeq = 0;

  function broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try { if (res.writableLength > 65536) { clients.delete(res); res.end(); continue; } res.write(frame); }
      catch { clients.delete(res); }
    }
  }
  const publicConfig = () => ({
    theme: config.theme, align: config.align, fontScale: config.fontScale, maxMessages: config.maxMessages, displaySeconds: config.displaySeconds,
    accentColor: config.accentColor, font: config.font, showBadges: config.showBadges, showEmotes: config.showEmotes, nameColorDot: config.nameColorDot
  });
  const getConfig = () => ({ ...config, ignoredUsers: config.ignoredUsers.slice() });

  function toPublic(m) {
    if (m.kind === "event") return { id: m.id, kind: "event", event: m.event, name: m.name, viewers: m.viewers };
    const out = { id: m.id, uid: m.uid, name: m.name, color: m.color, parts: m.parts, reply: m.reply, kind: m.kind };
    out.badges = config.showBadges ? m.badges.map(b => ({ s: b.s, i: b.i, u: badges?.url?.(b.s, b.i) || null })) : [];
    return out;
  }
  function deliver(m) {
    recent.push({ message: m, at: now() });
    if (recent.length > MAX_RECENT) recent = recent.slice(-MAX_RECENT);
    broadcast("message", toPublic(m));
  }
  function schedule(m) {
    badges?.ensure?.();
    if (config.delaySeconds <= 0) { deliver(m); return true; }
    if (pending.has(m.id)) return false;
    if (pending.size >= MAX_PENDING) { const [oldest] = pending.keys(); const e = pending.get(oldest); clearTimer(e.timer); pending.delete(oldest); }
    const timer = setTimer(() => { pending.delete(m.id); deliver(m); }, config.delaySeconds * 1000);
    timer?.unref?.();
    pending.set(m.id, { message: m, timer });
    return true;
  }

  // Eingang: eine Nachricht, die der Twitch-Bot nach allen Filtern weitergibt.
  function handleChat(raw) {
    const m = sanitizeMessage(raw);
    if (!m || m.kind !== "chat") return false;
    if (m.at && now() - m.at > MAX_AGE_MS) return false;        // zu spät zugestellt (z. B. nach einem Ausfall)
    if (m.login && config.ignoredUsers.includes(m.login)) return false;
    if (config.hideCommands && plainText(m).trimStart().startsWith("!")) return false;
    return schedule(m);
  }

  // Eingang: eine Nachricht, die einer der eigenen Bots gesendet hat. source = "stubenkontrolle" für das Chat-Spiel.
  function handleBotMessage({ source, name, text } = {}) {
    if (config.botMessages === "none") return false;
    if (config.botMessages === "game" && source !== "stubenkontrolle") return false;
    const body = clean(text, 500).trim();
    if (!body) return false;
    const m = sanitizeMessage({ id: `bot-${now().toString(36)}-${++botSeq}`, name: clean(name, 40).trim() || "Bot", parts: [{ t: "text", v: body }], kind: "bot", at: now() });
    if (!m) return false;
    deliver(m);                                                 // eigener Text: keine Prüfung und keine Verzögerung nötig
    return true;
  }

  // Eingang: Ereigniskarte (Follow oder Raid) aus einem echten EventSub-Ereignis. Der Name stammt von Twitch, nicht aus
  // dem Chat; es gibt daher nichts zu verzögern oder zu löschen.
  function handleEvent(raw) {
    const m = sanitizeEvent(raw);
    if (!m) return false;
    if (m.event === "follow" && !config.followCards) return false;
    if (m.event === "raid" && !config.raidCards) return false;
    if (m.at && now() - m.at > MAX_AGE_MS * 4) return false;
    if (recent.some(r => r.message.id === m.id)) return false;
    deliver(m);
    return true;
  }

  function removeMessage(id) {
    let removed = false;
    const p = pending.get(id);
    if (p) { clearTimer(p.timer); pending.delete(id); removed = true; }
    const before = recent.length;
    recent = recent.filter(r => r.message.id !== id);
    if (recent.length !== before) { removed = true; broadcast("remove", { id }); }
    return removed;
  }
  function removeUser(uid) {
    let removed = false;
    for (const [id, p] of [...pending]) if (p.message.uid === uid) { clearTimer(p.timer); pending.delete(id); removed = true; }
    const before = recent.length;
    recent = recent.filter(r => r.message.uid !== uid);
    if (recent.length !== before) { removed = true; broadcast("remove", { uid }); }
    return removed;
  }
  function clearAll() {
    for (const p of pending.values()) clearTimer(p.timer);
    pending.clear(); recent = [];
    broadcast("clear", {});
    return true;
  }
  // Eingang: Löschereignis des Bots (siehe compactDeleteEvent).
  function handleDelete(d) {
    if (!d || typeof d !== "object") return false;
    if (d.kind === "message" && typeof d.id === "string") return removeMessage(d.id);
    if (d.kind === "user" && typeof d.uid === "string") return removeUser(d.uid);
    if (d.kind === "clear") return clearAll();
    return false;
  }

  function configure(body) {
    const next = normalizeConfig(body, config, true);
    write?.(next);                    // erst speichern, dann live wirksam
    config = next;
    broadcast("config", publicConfig());
    return getConfig();
  }

  // Testnachrichten umgehen Filter und Verzögerung und sind an der ID zu erkennen.
  function test() {
    const samples = [
      ["Testnutzer", "#3C8DFF", "Hallo zusammen, das ist eine Testnachricht."],
      ["LangerNameZumTesten", "#E24C4C", "Eine längere Nachricht, damit man sieht, wie der Zeilenumbruch im gewählten Look aussieht und ob alles gut lesbar bleibt."],
      ["Mod_Beispiel", "#2EB87A", "Ton und Bild sind in Ordnung."]
    ];
    let n = 0;
    const cards = [{ event: "follow", name: "Testnutzer" }, { event: "raid", name: "Beispielkanal", viewers: 12 }];
    for (const c of cards) {
      const m = sanitizeEvent({ id: `test-${now().toString(36)}-${++testSeq}`, ...c, at: now() });
      if (m) { deliver(m); n++; }
    }
    for (const [name, color, text] of samples) {
      const m = sanitizeMessage({ id: `test-${now().toString(36)}-${++testSeq}`, name, color, parts: [{ t: "text", v: text }], badges: name === "Mod_Beispiel" ? [{ s: "moderator", i: "1" }] : [], kind: "chat", at: now() });
      if (m) { deliver(m); n++; }
    }
    return n;
  }

  function addSseClient(res, req, ip) {
    const release = sseLimiter.tryAcquire(ip);
    if (!release) return rejectTooMany(res);
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`retry: 3000\nevent: config\ndata: ${JSON.stringify(publicConfig())}\n\n`);
    const limit = config.displaySeconds > 0 ? config.displaySeconds * 1000 : Infinity;
    const t = now();
    const items = recent.filter(r => t - r.at < limit).slice(-config.maxMessages).map(r => ({ ...toPublic(r.message), ageMs: t - r.at }));
    res.write(`event: history\ndata: ${JSON.stringify(items)}\n\n`);
    clients.add(res);
    const timer = setInterval(() => { try { res.write(": ping\n\n"); } catch { cleanup(); } }, 25000);
    timer.unref?.();
    let done = false;
    function cleanup() { if (done) return; done = true; clearInterval(timer); clients.delete(res); release(); }
    req.on("close", cleanup);
    res.on("close", cleanup);
  }

  return { configure, getConfig, handleChat, handleBotMessage, handleEvent, handleDelete, test, addSseClient, pendingCount: () => pending.size, clientCount: () => clients.size };
}

module.exports = { createChatOverlay, createBadgeCache, normalizeConfig, DEFAULT_CONFIG, THEMES, BOT_MODES, MAX_AGE_MS };
