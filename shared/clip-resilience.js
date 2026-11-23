"use strict";
// 9.26.1: Clip-Monitor übersteht Netzausfälle und zeigt, wo die Zeit bis zur Meldung bleibt.
// Reine Hilfsfunktionen ohne Zugriff auf Twitch oder Dateien (einzeln testbar).

const CLIP_BASE_LOOKBACK_MINUTES = 15; // Twitch listet neue Clips erst nach einigen Minuten
const CLIP_MAX_LOOKBACK_MINUTES = 60;  // Obergrenze beim Nachholen nach einem Ausfall

const NETWORK_HINTS = {
  ENOTFOUND: "Name konnte nicht aufgelöst werden (DNS)",
  EAI_AGAIN: "Name konnte nicht aufgelöst werden (DNS)",
  ETIMEDOUT: "Zeitüberschreitung",
  UND_ERR_CONNECT_TIMEOUT: "Zeitüberschreitung beim Verbinden",
  UND_ERR_HEADERS_TIMEOUT: "Zeitüberschreitung bei der Antwort",
  ECONNREFUSED: "Verbindung verweigert",
  ECONNRESET: "Verbindung abgebrochen",
  EHOSTUNREACH: "Server nicht erreichbar",
  ENETUNREACH: "Netzwerk nicht erreichbar",
  CERT_HAS_EXPIRED: "Zertifikat abgelaufen (Uhrzeit des Rechners prüfen)",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "Zertifikat nicht prüfbar"
};

// Node meldet Verbindungsfehler nur als "fetch failed"; die Ursache steckt in err.cause.
function describeFetchError(err, target = "Twitch") {
  const cause = err?.cause || null;
  const code = String(cause?.code || err?.code || (err?.name === "AbortError" || err?.name === "TimeoutError" ? "ETIMEDOUT" : "") || "").slice(0, 60);
  const base = String(err?.message || "Unbekannter Fehler").slice(0, 200);
  if (!code && base !== "fetch failed") return base;
  const hint = NETWORK_HINTS[code];
  const detail = String(cause?.message || "").slice(0, 120);
  const parts = [`Keine Verbindung zu ${target}`];
  parts.push(hint ? `: ${hint}${code ? ` (${code})` : ""}` : code ? `: ${code}` : " (fetch failed)");
  if (!hint && detail && detail !== code) parts.push(` – ${detail}`);
  return parts.join("");
}

// Wie viele Minuten zurück nach Clips gesucht wird: normal 15, nach einem Ausfall ab dem letzten
// erfolgreichen Abruf (plus Puffer), höchstens 60. Doppelte Meldungen verhindert die Clip-Reservierung.
function clipLookbackMinutes(lastSuccessAt, nowMs = Date.now()) {
  const last = Date.parse(lastSuccessAt || "");
  if (!Number.isFinite(last) || last > nowMs) return CLIP_BASE_LOOKBACK_MINUTES;
  const gap = Math.ceil((nowMs - last) / 60000) + 2;
  return Math.min(CLIP_MAX_LOOKBACK_MINUTES, Math.max(CLIP_BASE_LOOKBACK_MINUTES, gap));
}

// Sekunden zwischen Erstellung des Clips bei Twitch und seiner Erkennung (null, wenn unbekannt).
function clipDelaySeconds(createdAt, nowMs = Date.now()) {
  const created = Date.parse(createdAt || "");
  if (!Number.isFinite(created)) return null;
  return Math.max(0, Math.round((nowMs - created) / 1000));
}

module.exports = { CLIP_BASE_LOOKBACK_MINUTES, CLIP_MAX_LOOKBACK_MINUTES, describeFetchError, clipLookbackMinutes, clipDelaySeconds };
