"use strict";
// 9.27.4: Emotes von Drittanbietern (7TV, BetterTTV, FrankerFaceZ) für das Chat-Overlay.
// Der Web-Kern lädt die Emote-Listen (global + Kanal) im Hintergrund und hält sie im Speicher. Nichts davon ist
// notwendig: schlägt ein Dienst fehl, bleiben seine Emote-Namen einfach Text. Es werden nur feste Server abgefragt,
// und ins Overlay gelangen nur Dienstname und streng geprüfte Kennung; die Bildadressen baut die Overlay-Seite selbst.

const PROVIDERS = Object.freeze(["7tv", "bttv", "ffz"]);
const SWITCH = Object.freeze({ "7tv": "emotes7tv", bttv: "emotesBttv", ffz: "emotesFfz" });
const ID_RE = Object.freeze({ "7tv": /^[A-Za-z0-9]{10,40}$/, bttv: /^[a-f0-9]{24}$/i, ffz: /^[0-9]{1,9}$/ });
const NAME_RE = /^[^\s\u0000-\u001f\u007f<>"'`&]{1,40}$/;
const MAX_PER_PROVIDER = 8000;
const MAX_PER_MESSAGE = 30;
const USER_ID = /^[0-9]{1,20}$/;

const list = v => (Array.isArray(v) ? v : []);

// Jeder Parser liefert [{ name, id, zw }] und tut nichts Gefährliches mit unbekannten Formen.
function parseSevenTv(payload) {
  const set = payload?.emote_set || payload;
  return list(set?.emotes).map(e => ({
    name: e?.name, id: e?.id, zw: ((Number(e?.flags) || 0) & 1) === 1 || ((Number(e?.data?.flags) || 0) & 256) === 256
  }));
}
function parseBttv(payload) {
  const rows = Array.isArray(payload) ? payload : [...list(payload?.channelEmotes), ...list(payload?.sharedEmotes)];
  return rows.map(e => ({ name: e?.code, id: e?.id, zw: false }));
}
function parseFfzList(payload) {            // BTTV-Zwischenspeicher für FrankerFaceZ-Kanäle: Liste mit code + id
  return list(payload).map(e => ({ name: e?.code ?? e?.name, id: e?.id, zw: false }));
}
function parseFfzGlobal(payload) {          // https://api.frankerfacez.com/v1/set/global
  const out = [];
  const wanted = list(payload?.default_sets).map(String);
  for (const key of wanted) for (const e of list(payload?.sets?.[key]?.emoticons)) out.push({ name: e?.name, id: e?.id, zw: false });
  return out;
}

const SOURCES = Object.freeze({
  "7tv": [
    { url: () => "https://7tv.io/v3/emote-sets/global", parse: parseSevenTv },
    { url: cid => `https://7tv.io/v3/users/twitch/${cid}`, parse: parseSevenTv, channel: true }
  ],
  bttv: [
    { url: () => "https://api.betterttv.net/3/cached/emotes/global", parse: parseBttv },
    { url: cid => `https://api.betterttv.net/3/cached/users/twitch/${cid}`, parse: parseBttv, channel: true }
  ],
  ffz: [
    { url: () => "https://api.frankerfacez.com/v1/set/global", parse: parseFfzGlobal },
    { url: cid => `https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${cid}`, parse: parseFfzList, channel: true }
  ]
});

// enabled: () => { "7tv": bool, bttv: bool, ffz: bool }
function createEmoteCache({ fetchJson, channelId, enabled = () => ({}), now = () => Date.now(), ttlMs = 3 * 3600 * 1000, retryMs = 120 * 1000 } = {}) {
  const state = Object.fromEntries(PROVIDERS.map(p => [p, { map: new Map(), loadedAt: 0, failedAt: 0, loading: null }]));

  async function loadProvider(p) {
    const next = new Map();
    let cid = null;
    try { const v = await channelId?.(); if (v && USER_ID.test(String(v))) cid = String(v); } catch { /* ohne Kanal nur globale Emotes */ }
    let ok = false;
    for (const src of SOURCES[p]) {
      if (src.channel && !cid) continue;
      let payload;
      try { payload = await fetchJson(src.url(cid)); ok = true; } catch { if (!src.channel) throw new Error("global"); continue; }   // Kanal-Emotes sind optional (Kanal ohne Eintrag liefert oft 404)
      for (const e of src.parse(payload)) {
        const name = String(e?.name ?? ""), id = String(e?.id ?? "");
        if (!NAME_RE.test(name) || !ID_RE[p].test(id)) continue;
        if (next.size >= MAX_PER_PROVIDER && !next.has(name)) continue;
        next.set(name, { p, id, zw: e.zw === true });            // Kanal-Emotes (später geladen) überschreiben globale gleichen Namens
      }
    }
    if (!ok) throw new Error("keine Daten");
    state[p].map = next; state[p].loadedAt = now(); state[p].failedAt = 0;
  }

  // Lädt bei Bedarf nach. Gibt ein Versprechen zurück, wenn gerade geladen wird, sonst null; blockiert nie den Chat.
  function ensure() {
    const on = enabled() || {};
    const jobs = [];
    for (const p of PROVIDERS) {
      if (!on[p]) continue;
      const s = state[p], t = now();
      if (s.loading) { jobs.push(s.loading); continue; }
      if (s.loadedAt && t - s.loadedAt < ttlMs) continue;
      if (s.failedAt && t - s.failedAt < retryMs) continue;
      s.loading = loadProvider(p).catch(() => { s.failedAt = now(); }).finally(() => { s.loading = null; });
      jobs.push(s.loading);
    }
    return jobs.length ? Promise.all(jobs) : null;
  }

  // Sucht den Emote-Namen in den eingeschalteten Diensten (Reihenfolge: 7TV, BetterTTV, FrankerFaceZ).
  function lookup(word) {
    const on = enabled() || {};
    for (const p of PROVIDERS) if (on[p]) { const hit = state[p].map.get(word); if (hit) return hit; }
    return null;
  }

  // Zerlegt Textteile einer Nachricht in Text und Fremd-Emotes. Gibt die ursprünglichen Teile zurück, wenn nichts passt.
  function expand(parts) {
    const on = enabled() || {};
    if (!PROVIDERS.some(p => on[p] && state[p].map.size)) return parts;
    const out = [];
    let used = 0;
    for (const part of parts) {
      if (part.t !== "text" || used >= MAX_PER_MESSAGE) { out.push(part); continue; }
      let buf = "";
      for (const tok of String(part.v).split(/(\s+)/)) {
        const hit = tok && !/^\s+$/.test(tok) && used < MAX_PER_MESSAGE ? lookup(tok) : null;
        if (hit) {
          if (buf) { out.push({ t: "text", v: buf }); buf = ""; }
          out.push({ t: "ext", p: hit.p, id: hit.id, v: tok, ...(hit.zw ? { zw: true } : {}) });
          used++;
        } else buf += tok;
      }
      if (buf) out.push({ t: "text", v: buf });
    }
    return out;
  }
  return { ensure, lookup, expand, size: () => PROVIDERS.reduce((n, p) => n + state[p].map.size, 0) };
}

module.exports = { createEmoteCache, PROVIDERS, SWITCH, ID_RE, MAX_PER_MESSAGE };
