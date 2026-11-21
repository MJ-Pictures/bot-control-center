"use strict";
// 9.25.6: Schutz vor toten oder veralteten Social-Media-Meldungen (zunächst nur TikTok).
// Reine Logik ohne Zugriff auf Discord oder Dateien, damit sie einzeln testbar ist.

const SOCIAL_LINK_MAX_TRIES = 3;
const SOCIAL_LINK_TIMEOUT_MS = 10000;

function normalizeMaxAgeHours(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(720, Math.round(Number(fallback) || 0)));
  return Math.max(0, Math.min(720, Math.round(n)));
}

// true, wenn der Beitrag älter als die erlaubte Zeit ist. 0 = keine Grenze.
// Ohne bekanntes Veröffentlichungsdatum wird nichts verworfen.
function isTooOld(item, maxAgeHours, nowMs = Date.now()) {
  const limit = Number(maxAgeHours) || 0;
  if (limit <= 0) return false;
  const published = Date.parse(item?.publishedAt || "");
  if (!Number.isFinite(published)) return false;
  return nowMs - published > limit * 3600 * 1000;
}

// Prüft über die offizielle oEmbed-Schnittstelle von TikTok, ob der Link öffentlich abrufbar ist.
// Ergebnis: {ok:true} oder {ok:false, definitive, reason}.
// definitive=true  → TikTok kennt den Link nicht (gelöscht, privat, nie öffentlich).
// definitive=false → Prüfung selbst war nicht möglich (Netzwerk, Limit, Serverfehler).
async function checkTikTokLink(url, { fetchImpl = globalThis.fetch, userAgent = "BotControlCenter", timeoutMs = SOCIAL_LINK_TIMEOUT_MS } = {}) {
  const link = String(url || "").trim();
  if (!link) return { ok: false, definitive: true, reason: "Kein Link vorhanden" };
  let parsed;
  try { parsed = new URL(link); } catch { return { ok: false, definitive: true, reason: "Link ist ungültig" }; }
  if (!/^https:$/.test(parsed.protocol)) return { ok: false, definitive: true, reason: "Link ist ungültig" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link)}`, {
      signal: controller.signal,
      headers: { "User-Agent": userAgent, Accept: "application/json" }
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (response.ok) {
      if (body && typeof body === "object" && (body.html || body.title !== undefined || body.author_name)) return { ok: true };
      return { ok: false, definitive: false, reason: "TikTok-Prüfung lieferte keine verwertbare Antwort" };
    }
    if (response.status === 429 || response.status >= 500) {
      return { ok: false, definitive: false, reason: `TikTok-Prüfung vorübergehend nicht möglich (HTTP ${response.status})` };
    }
    return { ok: false, definitive: true, reason: `TikTok-Link nicht erreichbar (HTTP ${response.status})` };
  } catch (err) {
    const why = err?.name === "AbortError" ? "Zeitüberschreitung" : String(err?.message || "Netzwerkfehler").slice(0, 120);
    return { ok: false, definitive: false, reason: `TikTok-Prüfung nicht möglich (${why})` };
  } finally {
    clearTimeout(timer);
  }
}

// Entscheidet für einen neuen Beitrag, ob er gesendet wird.
// tries = bisherige erfolglose Linkprüfungen. Rückgabe:
//  {action:"send", note?}  senden (note = Hinweis, wenn trotz unklarer Prüfung gesendet wird)
//  {action:"skip-old", reason}  nie senden (zu alt)
//  {action:"wait", reason, tries}  später erneut prüfen
//  {action:"skip-link", reason, tries}  endgültig verwerfen (Link blieb unerreichbar)
async function decideSocialItem({ item, cfg = {}, tries = 0, nowMs = Date.now(), checkLink }) {
  if (isTooOld(item, cfg.maxAgeHours, nowMs)) {
    return { action: "skip-old", reason: `Älter als ${Number(cfg.maxAgeHours)} Stunden, nicht mehr angekündigt` };
  }
  if (cfg.checkLink !== true || typeof checkLink !== "function") return { action: "send" };
  const result = await checkLink(item.url);
  if (result.ok) return { action: "send" };
  const nextTries = Number(tries || 0) + 1;
  if (nextTries < SOCIAL_LINK_MAX_TRIES) {
    return { action: "wait", reason: `${result.reason} (Versuch ${nextTries}/${SOCIAL_LINK_MAX_TRIES})`, tries: nextTries };
  }
  if (result.definitive) {
    return { action: "skip-link", reason: `${result.reason}, nach ${SOCIAL_LINK_MAX_TRIES} Versuchen verworfen`, tries: nextTries };
  }
  // Prüfung selbst war dauerhaft nicht möglich: kein Beleg für einen toten Link, daher senden.
  return { action: "send", note: `${result.reason}, ohne Prüfergebnis gesendet` };
}

module.exports = { SOCIAL_LINK_MAX_TRIES, SOCIAL_LINK_TIMEOUT_MS, normalizeMaxAgeHours, isTooOld, checkTikTokLink, decideSocialItem };
