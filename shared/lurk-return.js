"use strict";
// Modul „Lurk-Rückkehr“ (9.1.0).
// Wer einen Lurk-Command schreibt (Standard !lurk), wird mit Startzeit registriert. Die nächste
// Chatnachricht derselben Person meldet sie zurück, mit einem Text je nach Dauer des Lurks.
// Reine Logik ohne Twitch-Verbindung: Zeit, Speicherort und Senden kommen von außen, damit alles
// ohne Netzwerk testbar ist. Der bestehende Command (Antworttext der Command-Seite) bleibt unberührt.

// Neutrale Standardtexte für neue Installationen (9.18.0). Die Bestandsinstallation (Textpaket „legacy-bwk“) behält ihre bisherigen Texte.
const DEFAULT_TIERS = Object.freeze([
  {id: "t1", untilMinutes: 2, text: "{user} ist nach {dauer} schon wieder da – schnelles Comeback! 👋"},
  {id: "t2", untilMinutes: 10, text: "{user} meldet sich nach {dauer} von der kurzen Pause zurück."},
  {id: "t3", untilMinutes: 30, text: "{user} hat die Pause nach {dauer} beendet – willkommen zurück!"},
  {id: "t4", untilMinutes: 60, text: "{user} ist nach {dauer} zurück – Pause vorbei!"},
  {id: "t5", untilMinutes: 180, text: "{user} ist nach {dauer} aus dem Lurk zurück – ausgeschlafen? 👋"}
]);
const DEFAULT_FALLBACK_TEXT = "{user} ist nach {dauer} wieder aufgetaucht – die Vermisstenmeldung wird zurückgezogen.";
const LEGACY_TIERS = Object.freeze([
  {id: "t1", untilMinutes: 2, text: "{user} ist nach {dauer} schon wieder da – Schnelles Comeback! 🫡"},
  {id: "t2", untilMinutes: 10, text: "{user} meldet sich nach {dauer} vom kurzen Wegtreten zurück."},
  {id: "t3", untilMinutes: 30, text: "{user} hat die Pause nach {dauer} beendet – wieder im Dienst!"},
  {id: "t4", untilMinutes: 60, text: "{user} ist nach {dauer} zurück – Mittagspause vorbei, Antreten!"},
  {id: "t5", untilMinutes: 180, text: "{user} ist nach {dauer} aus dem Lurk zurück – ausgeschlafen? 🫡"}
]);
const MAX_TIERS = 12;
const MAX_TEXT = 300;
const MAX_ENTRIES = 5000;

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const cleanText = (value, fallback) => {
  const t = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  return t || fallback;
};

// Bringt settings.lurkReturn in Form und ergänzt Standardwerte (idempotent, ändert nur das Übergebene).
function normalizeLurkSettings(settings) {
  const target = settings && typeof settings === "object" ? settings : {};
  const src = target.lurkReturn && typeof target.lurkReturn === "object" && !Array.isArray(target.lurkReturn) ? target.lurkReturn : {};
  const out = {};
  out.enabled = src.enabled === true;
  out.bot = /^[a-z0-9_]{3,40}$/.test(String(src.bot || "")) ? String(src.bot) : require("./bot-roster").mainKeyOfSettings(target);
  out.commands = cleanText(src.commands, "!lurk").toLowerCase().slice(0, 120);
  out.maxHours = Math.round(clamp(src.maxHours, 1, 48, 12));
  out.minGapSeconds = Math.round(clamp(src.minGapSeconds, 0, 60, 3));
  const rawTiers = Array.isArray(src.tiers) ? src.tiers : (target.installation?.textPack === "legacy-bwk" ? LEGACY_TIERS : DEFAULT_TIERS);
  const seen = new Set();
  const tiers = rawTiers.slice(0, MAX_TIERS).map((t, i) => {
    let id = String(t?.id || "");
    if (!/^[\w-]{1,40}$/.test(id) || seen.has(id)) id = `t${i + 1}-${Math.random().toString(36).slice(2, 6)}`;
    seen.add(id);
    return {id, untilMinutes: Math.round(clamp(t?.untilMinutes, 1, 2880, 10)), text: cleanText(t?.text, DEFAULT_FALLBACK_TEXT)};
  });
  tiers.sort((a, b) => a.untilMinutes - b.untilMinutes);
  out.tiers = tiers;
  out.fallbackText = cleanText(src.fallbackText, DEFAULT_FALLBACK_TEXT);
  target.lurkReturn = out;
  return out;
}

// "wenige Sekunden", "1 Minute", "7 Minuten", "1 Std. 20 Min.", "3 Std."
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (totalSeconds < 60) return "weniger als einer Minute";
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return totalMinutes === 1 ? "1 Minute" : `${totalMinutes} Minuten`;
  const h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

function pickTier(cfg, minutes) {
  const tier = (cfg.tiers || []).find(t => minutes < t.untilMinutes);
  return tier ? {id: tier.id, text: tier.text} : {id: "fallback", text: cfg.fallbackText};
}

function commandSet(cfg) {
  return new Set(String(cfg.commands || "").toLowerCase().split(/[\s,]+/).filter(Boolean));
}

function createLurkReturn({now = () => Date.now(), load = () => null, save = () => {}, logger = () => {}} = {}) {
  const entries = new Map();   // userId -> {login, name, startedAt}
  const stats = {registered: 0, returned: 0, droppedGap: 0, expired: 0, cleared: 0};
  let dirty = false, lastAnnounceAt = 0;

  try {
    const stored = load();
    for (const [id, e] of Object.entries(stored?.entries || {})) {
      if (e && Number.isFinite(Number(e.startedAt))) entries.set(String(id), {login: String(e.login || ""), name: String(e.name || ""), startedAt: Number(e.startedAt)});
    }
  } catch (err) { logger("load", err); }

  function trim() {
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  }

  // Wird je Chatnachricht aufgerufen. Gibt null zurück oder {bot, text, minutes, tier}.
  function observe({userId, login, name, text}, cfg) {
    if (!cfg || cfg.enabled !== true) return null;
    const id = String(userId || "");
    if (!id) return null;
    const firstWord = String(text || "").trim().toLowerCase().split(/\s+/)[0] || "";
    if (firstWord && commandSet(cfg).has(firstWord)) {
      entries.delete(id);
      entries.set(id, {login: String(login || ""), name: String(name || login || ""), startedAt: now()});
      stats.registered++; dirty = true; trim();
      return null;
    }
    const entry = entries.get(id);
    if (!entry) return null;
    entries.delete(id); dirty = true;
    const t = now();
    const elapsed = Math.max(0, t - entry.startedAt);
    if (elapsed > cfg.maxHours * 3600 * 1000) { stats.expired++; return null; }
    if (cfg.minGapSeconds > 0 && t - lastAnnounceAt < cfg.minGapSeconds * 1000) { stats.droppedGap++; return null; }
    lastAnnounceAt = t;
    const minutes = elapsed / 60000;
    const tier = pickTier(cfg, minutes);
    stats.returned++;
    const vars = {user: name || login || entry.name || entry.login, dauer: formatDuration(elapsed), minuten: String(Math.floor(minutes))};
    return {bot: cfg.bot, text: tier.text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m), minutes, tier: tier.id};
  }

  function prune(cfg) {
    const limit = (cfg?.maxHours || 12) * 3600 * 1000, t = now();
    let n = 0;
    for (const [id, e] of entries) if (t - e.startedAt > limit) { entries.delete(id); n++; }
    if (n) { stats.expired += n; dirty = true; }
    return n;
  }

  function clear() {
    const n = entries.size;
    if (n) { entries.clear(); stats.cleared += n; dirty = true; }
    return n;
  }

  function flush() {
    if (!dirty) return false;
    try {
      save({version: 1, entries: Object.fromEntries(entries)});
      dirty = false; return true;
    } catch (err) { logger("save", err); return false; }
  }

  return {observe, prune, clear, flush, size: () => entries.size, stats: () => ({...stats, waiting: entries.size})};
}

// Verbindung zum Chat-Ereignis: registriert/meldet und sendet ohne zu warten, mit niedrigem Vorrang.
// Gibt den gesendeten Text zurück (oder null). Fehler bleiben im Modul, der Chat läuft weiter.
function handleLurkChat(lurk, ev, msg, cfg, send, warn = () => {}) {
  try {
    const back = lurk.observe({userId: ev?.chatter_user_id, login: ev?.chatter_user_login, name: ev?.chatter_user_name, text: msg}, cfg);
    if (!back) return null;
    Promise.resolve(send(back.bot, back.text, {priority: "low"})).catch(e => warn(e));
    return back.text;
  } catch (e) { warn(e); return null; }
}

module.exports = {createLurkReturn, handleLurkChat, normalizeLurkSettings, formatDuration, pickTier, DEFAULT_TIERS, DEFAULT_FALLBACK_TEXT};
