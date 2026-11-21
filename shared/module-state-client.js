"use strict";
// 9.4.0: Modulstand für Dienste ohne eigene Web-Einstellungen (Discord-Bot).
// Die Weboberfläche ist die Quelle (settings.modules). Der Dienst
//  - holt den Stand beim Start und danach regelmäßig von GET <url>/internal/modules,
//  - nimmt Änderungen sofort über set() entgegen (PUT /internal/modules von der Weboberfläche),
//  - merkt sich den letzten bekannten Stand in einer Datei, damit ein Neustart bei nicht erreichbarer
//    Weboberfläche nicht auf Standardwerte zurückfällt.
// Ist nie ein Stand bekannt geworden, gelten die Standardwerte der Registrierung (bestehende Module an).
// Ein Ausfall der Weboberfläche schaltet also nie Module ab.
const fs = require("fs");
const path = require("path");
const registry = require("./modules");

function createModuleStateClient({ url, secret, file = null, fetchImpl = globalThis.fetch, intervalMs = 60000, timeoutMs = 4000, log = console, onChange = null } = {}) {
  let modules = null;      // letzter bekannter Stand { id: boolean } oder null
  let features = {};       // 9.6.0: weitere Schalter der Weboberfläche { name: boolean }, z. B. wordFilterDiscord
  let lastSyncAt = null;   // ISO-Zeit des letzten erfolgreichen Abgleichs
  let lastError = null;
  let timer = null;

  function sanitize(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const s = { modules: input };
    registry.normalizeModuleSettings(s);
    return s.modules;
  }
  function sanitizeFeatures(input) {
    const out = {};
    if (input && typeof input === "object" && !Array.isArray(input))
      for (const [k, v] of Object.entries(input)) if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k) && typeof v === "boolean") out[k] = v;
    return out;
  }
  function load() {
    if (!file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const v = sanitize(raw?.modules); if (v) modules = v;
      features = sanitizeFeatures(raw?.features);
    } catch {}
  }
  function save() {
    if (!file || !modules) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ modules, features, savedAt: new Date().toISOString() }, null, 2));
      fs.renameSync(tmp, file);
    } catch (e) { try { log.warn?.("⚠️ Modulstand konnte nicht gespeichert werden:", e.message); } catch {} }
  }
  function set(input, source = "push", nextFeatures) {
    const next = sanitize(input);
    if (!next) return false;
    const before = JSON.stringify([modules, features]);
    modules = next;
    if (nextFeatures !== undefined) features = sanitizeFeatures(nextFeatures);
    lastSyncAt = new Date().toISOString();
    lastError = null;
    if (before !== JSON.stringify([modules, features])) {
      save();
      try { onChange?.(snapshot(), source); } catch (e) { try { log.warn?.("⚠️ Modulstand-Änderung:", e.message); } catch {} }
    }
    return true;
  }
  async function refresh() {
    if (!url || !secret || typeof fetchImpl !== "function") { lastError = "nicht konfiguriert"; return false; }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetchImpl(`${url}/internal/modules`, { headers: { "X-BWK-Service-Secret": secret }, signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      if (body?.ok !== true) throw new Error("ungültige Antwort");
      return set(body.modules, "pull", body.features);
    } catch (e) {
      lastError = e?.name === "AbortError" ? "Zeitüberschreitung" : (e?.message || String(e));
      return false;
    } finally { clearTimeout(t); }
  }
  function isOn(id) {
    if (!registry.isKnownModule(id)) return true; // unbekannte Kennungen werden nie abgeschaltet
    return registry.isModuleEnabled({ modules: modules || undefined }, id);
  }
  // 9.6.0: weiterer Schalter; ohne bekannten Wert gilt fallback (nie stillschweigend „aus“).
  function feature(name, fallback = true) { return typeof features[name] === "boolean" ? features[name] : fallback; }
  function snapshot() { return { modules: modules ? { ...modules } : null, features: { ...features }, lastSyncAt, lastError, known: !!modules }; }
  function start() {
    load();
    refresh().catch(() => {});
    if (intervalMs > 0 && !timer) { timer = setInterval(() => refresh().catch(() => {}), intervalMs); timer.unref?.(); }
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  return { start, stop, refresh, set, isOn, feature, snapshot, load };
}

module.exports = { createModuleStateClient };
