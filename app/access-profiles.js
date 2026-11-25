"use strict";
// 9.29.0: Zugriffsprofile – benannte, wiederverwendbare Rechtesätze (live verknüpft), die Benutzern zugewiesen
// oder automatisch (Twitch-Moderator, Discord-Rolle) zugeordnet werden. Reine Funktionen ohne Zugriff auf Dateien.
const crypto = require("crypto");

const MAX_PROFILES = 50;
const MAX_RULES = 50;
const RULE_TYPES = Object.freeze(["twitch-moderator", "discord-role"]);

function fail(message) { const e = new Error(message); e.status = 400; throw e; }
const text = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// sanitize: Funktion des Aufrufers (nur bekannte Rechte, Bearbeiten ⇒ Ansehen)
function normalizeStore(raw, sanitize = x => x) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const profiles = [];
  const seen = new Set();
  for (const p of Array.isArray(src.profiles) ? src.profiles : []) {
    const id = text(p?.id, 40);
    const name = text(p?.name, 60);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    profiles.push({
      id, name, description: text(p?.description, 200), capabilities: sanitize(Array.isArray(p?.capabilities) ? p.capabilities : []),
      createdAt: text(p?.createdAt, 40) || null, updatedAt: text(p?.updatedAt, 40) || null, updatedBy: text(p?.updatedBy, 80) || null
    });
    if (profiles.length >= MAX_PROFILES) break;
  }
  const assignments = {};
  if (src.assignments && typeof src.assignments === "object" && !Array.isArray(src.assignments)) {
    for (const [uid, ids] of Object.entries(src.assignments)) {
      const list = [...new Set((Array.isArray(ids) ? ids : []).map(x => String(x)).filter(x => seen.has(x)))];
      if (list.length) assignments[String(uid).slice(0, 120)] = list;
    }
  }
  const rules = [];
  for (const r of Array.isArray(src.rules) ? src.rules : []) {
    const type = String(r?.type || "");
    const profileId = String(r?.profileId || "");
    const roleId = text(r?.roleId, 40);
    if (!RULE_TYPES.includes(type) || !seen.has(profileId)) continue;
    if (type === "discord-role" && !/^\d{5,25}$/.test(roleId)) continue;
    const rule = { id: text(r?.id, 40) || crypto.randomBytes(5).toString("hex"), type, profileId };
    if (type === "discord-role") rule.roleId = roleId;
    if (!rules.some(x => x.type === rule.type && x.profileId === rule.profileId && (x.roleId || "") === (rule.roleId || ""))) rules.push(rule);
    if (rules.length >= MAX_RULES) break;
  }
  return { profiles, assignments, rules };
}

function profileInput(body, store, sanitize, currentId = null) {
  const name = text(body?.name, 60);
  if (!name) fail("Bitte einen Namen für das Profil angeben.");
  if (store.profiles.some(p => p.id !== currentId && p.name.toLowerCase() === name.toLowerCase())) fail("Ein Profil mit diesem Namen gibt es schon.");
  return { name, description: text(body?.description, 200), capabilities: sanitize(Array.isArray(body?.capabilities) ? body.capabilities : []) };
}

function createProfile(store, body, sanitize, by = "") {
  if (store.profiles.length >= MAX_PROFILES) fail(`Höchstens ${MAX_PROFILES} Profile.`);
  const input = profileInput(body, store, sanitize);
  const now = new Date().toISOString();
  const profile = { id: "p" + crypto.randomBytes(6).toString("hex"), ...input, createdAt: now, updatedAt: now, updatedBy: text(by, 80) || null };
  store.profiles.push(profile);
  return profile;
}

function updateProfile(store, id, body, sanitize, by = "") {
  const profile = store.profiles.find(p => p.id === id);
  if (!profile) { const e = new Error("Profil nicht gefunden."); e.status = 404; throw e; }
  Object.assign(profile, profileInput(body, store, sanitize, id), { updatedAt: new Date().toISOString(), updatedBy: text(by, 80) || null });
  return profile;
}

// Entfernt ein Profil samt Zuweisungen und Regeln; liefert, wie viele Benutzer und Regeln betroffen waren.
function deleteProfile(store, id) {
  const idx = store.profiles.findIndex(p => p.id === id);
  if (idx < 0) { const e = new Error("Profil nicht gefunden."); e.status = 404; throw e; }
  store.profiles.splice(idx, 1);
  const users = [];
  for (const [uid, ids] of Object.entries(store.assignments)) {
    if (!ids.includes(id)) continue;
    users.push(uid);
    const rest = ids.filter(x => x !== id);
    if (rest.length) store.assignments[uid] = rest; else delete store.assignments[uid];
  }
  const before = store.rules.length;
  store.rules = store.rules.filter(r => r.profileId !== id);
  return { users, rules: before - store.rules.length };
}

function assign(store, userId, profileIds) {
  const known = new Set(store.profiles.map(p => p.id));
  const list = [...new Set((Array.isArray(profileIds) ? profileIds : []).map(String))];
  if (list.some(x => !known.has(x))) fail("Unbekanntes Profil in der Auswahl.");
  if (list.length) store.assignments[String(userId)] = list; else delete store.assignments[String(userId)];
  return list;
}

function setRules(store, rules) {
  const list = Array.isArray(rules) ? rules : [];
  if (list.length > MAX_RULES) fail(`Höchstens ${MAX_RULES} Regeln.`);
  // Jede Regel einzeln prüfen: unvollständige melden wir, Doppelte entfallen still.
  for (const r of list) if (normalizeStore({ profiles: store.profiles, rules: [r] }, x => x).rules.length !== 1) fail("Eine Regel ist unvollständig: Profil wählen, bei Discord die Rollen-ID (nur Ziffern) angeben.");
  store.rules = normalizeStore({ profiles: store.profiles, rules: list }, x => x).rules;
  return store.rules;
}

// Rechte, die Profile einem Benutzer geben: manuell zugewiesen + automatisch (Twitch-Moderator, Discord-Rollen).
function profileIdsFor(store, { userId = null, twitchModerator = false, guildRoles = [] } = {}) {
  const ids = new Set(userId ? (store.assignments[String(userId)] || []) : []);
  for (const r of store.rules) {
    if (r.type === "twitch-moderator" && twitchModerator) ids.add(r.profileId);
    else if (r.type === "discord-role" && Array.isArray(guildRoles) && guildRoles.includes(r.roleId)) ids.add(r.profileId);
  }
  return [...ids];
}

function capabilitiesFor(store, ctx, sanitize = x => x) {
  const ids = new Set(profileIdsFor(store, ctx));
  const caps = [];
  for (const p of store.profiles) if (ids.has(p.id)) caps.push(...p.capabilities);
  return sanitize(caps);
}

module.exports = { normalizeStore, createProfile, updateProfile, deleteProfile, assign, setRules, profileIdsFor, capabilitiesFor, MAX_PROFILES, MAX_RULES, RULE_TYPES };
