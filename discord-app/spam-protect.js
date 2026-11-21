"use strict";

const DEFAULT_SPAM_PROTECT_CONFIG = Object.freeze({
  enabled: false,
  exemptStaff: true,
  exemptRoleIds: [],
  exemptChannelIds: [],
  flood: { enabled: true, threshold: 6, windowSeconds: 8 },
  duplicate: { enabled: true, threshold: 3, windowSeconds: 15, minLength: 3 },
  mentions: { enabled: true, threshold: 5 },
  action: {
    deleteMessage: true,
    warnUser: true,
    warningText: "🛡️ {mention}, der Spam-Schutz wurde ausgelöst ({reason}). Bitte reduziere die Nachrichtenfrequenz.",
    repeatWindowMinutes: 1440,
    timeoutMinutes: [1, 5, 15],
    cooldownSeconds: 10
  }
});

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function uniqueStrings(value, limit = 100) {
  const src = Array.isArray(value) ? value : [];
  return [...new Set(src.map(x => String(x || "").trim()).filter(Boolean))].slice(0, limit);
}
function normalizeSpamProtectConfig(raw = {}) {
  const d = DEFAULT_SPAM_PROTECT_CONFIG;
  const flood = raw.flood && typeof raw.flood === "object" ? raw.flood : {};
  const duplicate = raw.duplicate && typeof raw.duplicate === "object" ? raw.duplicate : {};
  const mentions = raw.mentions && typeof raw.mentions === "object" ? raw.mentions : {};
  const action = raw.action && typeof raw.action === "object" ? raw.action : {};
  const timeoutRaw = Array.isArray(action.timeoutMinutes) ? action.timeoutMinutes : d.action.timeoutMinutes;
  return {
    enabled: raw.enabled === true,
    exemptStaff: raw.exemptStaff !== false,
    exemptRoleIds: uniqueStrings(raw.exemptRoleIds),
    exemptChannelIds: uniqueStrings(raw.exemptChannelIds),
    flood: {
      enabled: flood.enabled !== false,
      threshold: Math.round(clampNumber(flood.threshold, 3, 30, d.flood.threshold)),
      windowSeconds: clampNumber(flood.windowSeconds, 2, 120, d.flood.windowSeconds)
    },
    duplicate: {
      enabled: duplicate.enabled !== false,
      threshold: Math.round(clampNumber(duplicate.threshold, 2, 20, d.duplicate.threshold)),
      windowSeconds: clampNumber(duplicate.windowSeconds, 3, 300, d.duplicate.windowSeconds),
      minLength: Math.round(clampNumber(duplicate.minLength, 1, 200, d.duplicate.minLength))
    },
    mentions: {
      enabled: mentions.enabled !== false,
      threshold: Math.round(clampNumber(mentions.threshold, 2, 30, d.mentions.threshold))
    },
    action: {
      deleteMessage: action.deleteMessage !== false,
      warnUser: action.warnUser !== false,
      warningText: String(action.warningText || d.action.warningText).slice(0, 1200),
      repeatWindowMinutes: Math.round(clampNumber(action.repeatWindowMinutes, 1, 10080, d.action.repeatWindowMinutes)),
      timeoutMinutes: [0, 1, 2].map(i => Math.round(clampNumber(timeoutRaw[i], 0, 40320, d.action.timeoutMinutes[i]))),
      cooldownSeconds: Math.round(clampNumber(action.cooldownSeconds, 2, 300, d.action.cooldownSeconds))
    }
  };
}

function normalizeContent(content) {
  return String(content || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}
function countMentions(message) {
  const text = String(message?.content || "");
  const userRoleMentions = text.match(/<@!?\d{15,22}>|<@&\d{15,22}>/g) || [];
  const everyoneHere = text.match(/@(everyone|here)\b/gi) || [];
  return userRoleMentions.length + everyoneHere.length;
}

class SpamDetector {
  constructor() { this.users = new Map(); }
  pruneAll(nowMs = Date.now()) {
    for (const [id, row] of this.users) {
      if ((row.lastSeenAt || 0) < nowMs - 10 * 60 * 1000) this.users.delete(id);
    }
  }
  inspect(message, rawConfig, options = {}) {
    const config = normalizeSpamProtectConfig(rawConfig);
    if (!config.enabled || !message || message.author?.bot || message.webhook_id) return null;
    const userId = String(message.author?.id || "");
    if (!userId) return null;
    const channelId = String(message.channel_id || "");
    if (config.exemptChannelIds.includes(channelId)) return null;
    const roles = new Set((message.member?.roles || []).map(String));
    if (config.exemptRoleIds.some(id => roles.has(String(id)))) return null;
    if (config.exemptStaff && (options.staffRoleIds || []).some(id => id && roles.has(String(id)))) return null;

    const nowMs = Number(options.nowMs || Date.now());
    let row = this.users.get(userId);
    if (!row) row = { messages: [], contents: [], cooldownUntil: 0, lastSeenAt: nowMs };
    row.lastSeenAt = nowMs;
    if (row.cooldownUntil > nowMs) { this.users.set(userId, row); return null; }

    const maxWindowMs = Math.max(config.flood.windowSeconds, config.duplicate.windowSeconds) * 1000;
    row.messages = row.messages.filter(ts => ts >= nowMs - maxWindowMs);
    row.contents = row.contents.filter(x => x.ts >= nowMs - maxWindowMs);
    row.messages.push(nowMs);
    const normalized = normalizeContent(message.content);
    if (normalized) row.contents.push({ ts: nowMs, text: normalized });

    let result = null;
    if (config.mentions.enabled) {
      const mentions = countMentions(message);
      if (mentions >= config.mentions.threshold) result = { type: "mentions", label: "Mention-Spam", detail: `${mentions} Erwähnungen in einer Nachricht`, count: mentions, threshold: config.mentions.threshold };
    }
    if (!result && config.duplicate.enabled && normalized.length >= config.duplicate.minLength) {
      const cutoff = nowMs - config.duplicate.windowSeconds * 1000;
      const duplicates = row.contents.filter(x => x.ts >= cutoff && x.text === normalized).length;
      if (duplicates >= config.duplicate.threshold) result = { type: "duplicate", label: "Wiederholungs-Spam", detail: `${duplicates} gleiche Nachrichten in ${config.duplicate.windowSeconds}s`, count: duplicates, threshold: config.duplicate.threshold };
    }
    if (!result && config.flood.enabled) {
      const cutoff = nowMs - config.flood.windowSeconds * 1000;
      const count = row.messages.filter(ts => ts >= cutoff).length;
      if (count >= config.flood.threshold) result = { type: "flood", label: "Nachrichtenflut", detail: `${count} Nachrichten in ${config.flood.windowSeconds}s`, count, threshold: config.flood.threshold };
    }

    if (result) {
      row.cooldownUntil = nowMs + config.action.cooldownSeconds * 1000;
      row.messages = [];
      row.contents = [];
    }
    this.users.set(userId, row);
    if (this.users.size > 5000) this.pruneAll(nowMs);
    return result;
  }
}

function renderSpamWarning(template, message, detection, offenseCount, timeoutMinutes) {
  return String(template || DEFAULT_SPAM_PROTECT_CONFIG.action.warningText)
    .replaceAll("{mention}", `<@${message?.author?.id || ""}>`)
    .replaceAll("{user}", message?.author?.global_name || message?.author?.username || message?.author?.id || "User")
    .replaceAll("{reason}", detection?.label || "Spam")
    .replaceAll("{detail}", detection?.detail || "")
    .replaceAll("{count}", String(offenseCount || 1))
    .replaceAll("{timeout}", String(timeoutMinutes || 0));
}

module.exports = { DEFAULT_SPAM_PROTECT_CONFIG, normalizeSpamProtectConfig, SpamDetector, countMentions, normalizeContent, renderSpamWarning };
