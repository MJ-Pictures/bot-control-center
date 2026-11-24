"use strict";
// 9.27.0: Gemeinsame Bausteine des Chat-Overlays. Wird vom Twitch-Bot (Verdichten einer Chat-Nachricht)
// und von der Weboberfläche (erneutes Prüfen aller eingehenden Daten) benutzt. Keine Abhängigkeiten.
//
// Sicherheitsgrundsatz: In das Overlay gelangt nie fremdes HTML. Texte bleiben Text, Emotes und Abzeichen
// sind nur über streng geprüfte Kennungen bzw. Adressen des Twitch-Bildservers erlaubt.

const MAX_TEXT = 500;
const MAX_PARTS = 120;
const MAX_BADGES = 8;
const MAX_NAME = 40;
const EMOTE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const BADGE_KEY = /^[a-z0-9_-]{1,40}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const BADGE_URL = /^https:\/\/static-cdn\.jtvnw\.net\/badges\/v1\/[0-9a-f-]{36}\/[1-4]$/i;
const USER_ID = /^[0-9]{1,20}$/;
const LOGIN = /^[a-z0-9_]{1,25}$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "").slice(0, max);

// Prüft eine (verdichtete) Nachricht und gibt die bereinigte Form zurück, sonst null.
// Form: { id, uid, login, name, color, badges:[{s,i}], parts:[{t:"text",v}|{t:"emote",id,v}], reply, kind, at }
function sanitizeMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? "");
  if (!MESSAGE_ID.test(id)) return null;
  const name = clean(raw.name, MAX_NAME).trim();
  if (!name) return null;
  const parts = [];
  let total = 0;
  for (const p of Array.isArray(raw.parts) ? raw.parts.slice(0, MAX_PARTS) : []) {
    if (!p || typeof p !== "object") continue;
    const text = clean(p.v, MAX_TEXT);
    if (p.t === "emote" && EMOTE_ID.test(String(p.id ?? ""))) {
      if (total + text.length > MAX_TEXT) break;
      total += text.length; parts.push({ t: "emote", id: String(p.id), v: text });
    } else if (p.t === "text") {
      const room = MAX_TEXT - total;
      if (room <= 0) break;
      const piece = text.slice(0, room);
      if (!piece) continue;
      total += piece.length;
      const last = parts[parts.length - 1];
      if (last && last.t === "text") last.v += piece; else parts.push({ t: "text", v: piece });
    }
  }
  if (!parts.length) return null;
  const badges = [];
  for (const b of Array.isArray(raw.badges) ? raw.badges.slice(0, MAX_BADGES) : []) {
    if (b && BADGE_KEY.test(String(b.s ?? "")) && BADGE_KEY.test(String(b.i ?? ""))) badges.push({ s: String(b.s), i: String(b.i) });
  }
  const login = String(raw.login ?? "").toLowerCase();
  const at = Number(raw.at);
  return {
    id,
    uid: USER_ID.test(String(raw.uid ?? "")) ? String(raw.uid) : null,
    login: LOGIN.test(login) ? login : "",
    name,
    color: COLOR.test(String(raw.color ?? "")) ? String(raw.color).toLowerCase() : null,
    badges,
    parts,
    reply: raw.reply ? clean(raw.reply, MAX_NAME).trim() || null : null,
    kind: raw.kind === "bot" ? "bot" : "chat",
    at: Number.isFinite(at) && at > 0 ? at : 0
  };
}

// Bot-Seite: macht aus dem EventSub-Ereignis „channel.chat.message“ eine kleine, bereinigte Nachricht.
function compactChatEvent(ev, now = Date.now()) {
  if (!ev || typeof ev !== "object") return null;
  const parts = [];
  const fragments = Array.isArray(ev.message?.fragments) ? ev.message.fragments : [];
  if (fragments.length) {
    for (const f of fragments) {
      const type = String(f?.type || "text").toLowerCase();
      const text = String(f?.text ?? "");
      if (type === "emote" && f?.emote?.id) parts.push({ t: "emote", id: String(f.emote.id), v: text });
      else parts.push({ t: "text", v: text });
    }
  } else if (ev.message?.text) {
    parts.push({ t: "text", v: String(ev.message.text) });
  }
  return sanitizeMessage({
    id: ev.message_id,
    uid: ev.chatter_user_id,
    login: ev.chatter_user_login,
    name: ev.chatter_user_name || ev.chatter_user_login,
    color: ev.color,
    badges: (Array.isArray(ev.badges) ? ev.badges : []).map(b => ({ s: b?.set_id, i: b?.id })),
    parts,
    reply: ev.reply?.parent_user_name || null,
    kind: "chat",
    at: now
  });
}

// Bot-Seite: Löschereignisse in eine kleine Form bringen (message_delete, clear, clear_user_messages).
function compactDeleteEvent(type, ev) {
  const t = String(type || "");
  if (t === "channel.chat.message_delete") {
    const id = String(ev?.message_id ?? "");
    return MESSAGE_ID.test(id) ? { kind: "message", id } : null;
  }
  if (t === "channel.chat.clear_user_messages") {
    const uid = String(ev?.target_user_id ?? "");
    return USER_ID.test(uid) ? { kind: "user", uid } : null;
  }
  if (t === "channel.chat.clear") return { kind: "clear" };
  return null;
}

// 9.27.1: Ereigniskarten (Follow, Raid). Es werden nur Name und Zahl übernommen, nie Freitext.
const EVENT_KINDS = Object.freeze(["follow", "raid"]);
function sanitizeEvent(raw) {
  if (!raw || typeof raw !== "object" || !EVENT_KINDS.includes(raw.event)) return null;
  const id = String(raw.id ?? "");
  if (!MESSAGE_ID.test(id)) return null;
  const name = clean(raw.name, MAX_NAME).trim();
  if (!name) return null;
  const viewers = Number(raw.viewers);
  const at = Number(raw.at);
  return {
    id, kind: "event", event: raw.event, name,
    viewers: raw.event === "raid" && Number.isInteger(viewers) && viewers >= 0 && viewers <= 10000000 ? viewers : null,
    at: Number.isFinite(at) && at > 0 ? at : 0
  };
}
// Web-Seite: macht aus dem EventSub-Ereignis (channel.follow bzw. channel.raid) die kleine Form für die Karte.
function compactEvent(kind, ev, id, now = Date.now()) {
  if (!ev || typeof ev !== "object") return null;
  if (kind === "follow") return sanitizeEvent({ id, event: "follow", name: ev.user_name || ev.user_login, at: now });
  if (kind === "raid") return sanitizeEvent({ id, event: "raid", name: ev.from_broadcaster_user_name || ev.from_broadcaster_user_login, viewers: ev.viewers, at: now });
  return null;
}

function plainText(message) {
  return (message?.parts || []).map(p => p.v).join("");
}

module.exports = { MAX_TEXT, BADGE_URL, EVENT_KINDS, sanitizeMessage, sanitizeEvent, compactEvent, compactChatEvent, compactDeleteEvent, plainText, clean };
