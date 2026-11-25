"use strict";
// 9.28.0: Chat-Befehl „!clip“. Der Bot erstellt auf Zuruf einen Twitch-Clip und schreibt den Link in den Chat.
// Die Logik ist von Twitch, Dateien und Uhr getrennt (alles kommt über deps) und deshalb einzeln testbar.
// Der Clip wird über das Kanal-Konto erstellt (Recht clips:edit); welcher Bot die Antwort schreibt, ist einstellbar.

const CLIP_CHANNEL_SCOPES = Object.freeze(["clips:edit"]);
const CLIP_COMMAND_ALLOWED = Object.freeze(["everyone", "subscribers", "vips", "moderators", "broadcaster"]);
const CLIP_COMMAND_ALLOWED_LABELS = Object.freeze({
  everyone: "Alle Zuschauer",
  subscribers: "Abonnenten, VIPs, Moderatoren",
  vips: "VIPs und Moderatoren",
  moderators: "Moderatoren",
  broadcaster: "Nur Kanalinhaber"
});
const CLIP_POLL_INTERVAL_MS = 2500;
const CLIP_POLL_MAX_MS = 60000; // laut Twitch gilt der Clip nach 60 Sekunden ohne Ergebnis als fehlgeschlagen

const DEFAULTS = Object.freeze({
  cmdEnabled: false,
  cmdName: "!clip",
  cmdAllowed: "everyone",
  cmdCooldownUser: 60,
  cmdCooldownGlobal: 15,
  cmdDuration: 30,
  cmdBot: "",
  cmdDiscord: true,
  cmdMessage: "🎬 @{user} hat einen Clip erstellt: {url}",
  cmdOfflineMessage: "@{user} Clips gehen nur im Livestream – der Kanal ist gerade nicht live.",
  cmdFailMessage: "@{user} Der Clip konnte leider nicht erstellt werden. Bitte später noch einmal versuchen."
});

const int = (v, min, max, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const text = (v, dflt, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : dflt);

// Befehlsname: ein Wort, in Kleinbuchstaben, mit „!“ am Anfang; sonst Standard.
function normalizeCommandName(v) {
  let s = String(v ?? "").trim().toLowerCase();
  if (!s) return DEFAULTS.cmdName;
  if (!/^[!/]/.test(s)) s = "!" + s;
  return /^[!/][\p{L}\p{N}_-]{1,29}$/u.test(s) ? s : DEFAULTS.cmdName;
}

// Ergänzt Standardwerte und begrenzt Zahlen (verändert und liefert das Objekt clipSharing).
function normalizeClipCommandSettings(c) {
  c.cmdEnabled = typeof c.cmdEnabled === "boolean" ? c.cmdEnabled : DEFAULTS.cmdEnabled;
  c.cmdName = normalizeCommandName(c.cmdName);
  c.cmdAllowed = CLIP_COMMAND_ALLOWED.includes(c.cmdAllowed) ? c.cmdAllowed : DEFAULTS.cmdAllowed;
  c.cmdCooldownUser = int(c.cmdCooldownUser, 0, 3600, DEFAULTS.cmdCooldownUser);
  c.cmdCooldownGlobal = int(c.cmdCooldownGlobal, 0, 600, DEFAULTS.cmdCooldownGlobal);
  c.cmdDuration = int(c.cmdDuration, 5, 60, DEFAULTS.cmdDuration);
  c.cmdBot = typeof c.cmdBot === "string" ? c.cmdBot.trim().slice(0, 60) : DEFAULTS.cmdBot;
  c.cmdDiscord = typeof c.cmdDiscord === "boolean" ? c.cmdDiscord : DEFAULTS.cmdDiscord;
  c.cmdMessage = text(c.cmdMessage, DEFAULTS.cmdMessage, 400);
  c.cmdOfflineMessage = text(c.cmdOfflineMessage, DEFAULTS.cmdOfflineMessage, 400);
  c.cmdFailMessage = text(c.cmdFailMessage, DEFAULTS.cmdFailMessage, 400);
  return c;
}

// Rollen aus den Chat-Abzeichen von Twitch.
function chatRoles(ev, channelId) {
  const badges = new Set((Array.isArray(ev?.badges) ? ev.badges : []).map(b => String(b?.set_id || "").toLowerCase()));
  const broadcaster = (!!channelId && String(ev?.chatter_user_id || "") === String(channelId)) || badges.has("broadcaster");
  return {
    broadcaster,
    moderator: badges.has("moderator"),
    vip: badges.has("vip"),
    subscriber: badges.has("subscriber") || badges.has("founder")
  };
}

function isAllowed(level, roles) {
  switch (level) {
    case "broadcaster": return roles.broadcaster;
    case "moderators": return roles.broadcaster || roles.moderator;
    case "vips": return roles.broadcaster || roles.moderator || roles.vip;
    case "subscribers": return roles.broadcaster || roles.moderator || roles.vip || roles.subscriber;
    default: return true;
  }
}

const fill = (tpl, vars) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`)).replace(/\s+/g, " ").trim();
const clean = s => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

// deps:
//   now()                      aktuelle Zeit in ms
//   sleep(ms)                  Warten
//   channelId()                Kanal-ID (für die Rolle „Kanalinhaber“)
//   createClip({title,duration}) → {ok, id, reason, error}   reason: offline | scope | forbidden | rate | error
//   getClip(id)                → Clip-Objekt von Twitch oder null (noch nicht bereit)
//   sendChat(botKey, message, opts) → {ok, dropped}
//   botKey(cfg)                Bot, der antwortet
//   reserveClip(clip)          merkt die ID vor (damit der Clip-Monitor sie nicht noch einmal teilt)
//   markShared(clip, info)     Clip als geteilt vermerken (Zustand, Datenbank)
//   markError(id, message)
//   enqueueDiscord(clipPayload) Discord-Ankündigung einreihen
//   audit(event, data)
function createClipCommand(deps) {
  const lastUse = new Map(); // Person → Zeit der letzten Nutzung
  let lastGlobal = 0;

  function release(userId, prevUser, prevGlobal) {
    if (prevUser === undefined) lastUse.delete(userId); else lastUse.set(userId, prevUser);
    lastGlobal = prevGlobal;
  }

  // Liefert {handled:false} oder {handled:true, done:Promise}. Die Arbeit läuft im Hintergrund,
  // damit die Chatverarbeitung nicht bis zu einer Minute auf Twitch wartet.
  function handle(ev, cfg, firstWord) {
    if (!cfg?.cmdEnabled || firstWord !== cfg.cmdName) return { handled: false };
    const roles = chatRoles(ev, deps.channelId?.());
    if (!isAllowed(cfg.cmdAllowed, roles)) return { handled: true, done: Promise.resolve({ ok: false, ignored: "role" }) };

    const now = deps.now();
    const userId = String(ev.chatter_user_id || ev.chatter_user_login || "");
    const prevUser = lastUse.get(userId);
    const prevGlobal = lastGlobal;
    const bypassUser = roles.broadcaster || roles.moderator;
    if (!bypassUser && cfg.cmdCooldownUser > 0 && prevUser !== undefined && now - prevUser < cfg.cmdCooldownUser * 1000) return { handled: true, done: Promise.resolve({ ok: false, ignored: "cooldown-user" }) };
    if (cfg.cmdCooldownGlobal > 0 && prevGlobal && now - prevGlobal < cfg.cmdCooldownGlobal * 1000) return { handled: true, done: Promise.resolve({ ok: false, ignored: "cooldown-global" }) };
    lastUse.set(userId, now);
    lastGlobal = now;

    const done = run(ev, cfg, () => release(userId, prevUser, prevGlobal));
    return { handled: true, done };
  }

  async function run(ev, cfg, giveBackCooldown) {
    const user = clean(ev.chatter_user_name || ev.chatter_user_login || "Zuschauer");
    const bot = deps.botKey(cfg);
    const say = message => deps.sendChat(bot, message, { source: "clip" }).catch(() => ({ ok: false }));
    const fail = async (reason, error, id) => {
      giveBackCooldown();
      deps.audit("clip.command.failed", { section: "clips", user, reason, error: String(error || "").slice(0, 300), clipId: id || null });
      await say(fill(reason === "offline" ? cfg.cmdOfflineMessage : cfg.cmdFailMessage, { user }));
      return { ok: false, reason, error };
    };

    let created;
    try {
      created = await deps.createClip({ title: clean(`Clip von ${user}`).slice(0, 100), duration: cfg.cmdDuration });
    } catch (e) {
      created = { ok: false, reason: "error", error: e?.message || String(e) };
    }
    if (!created?.ok || !created.id) return fail(created?.reason || "error", created?.error, null);

    const id = String(created.id);
    const nowIso = new Date(deps.now()).toISOString();
    const url = `https://clips.twitch.tv/${id}`;
    // Sofort vormerken: der Clip-Monitor darf diesen Clip nicht zusätzlich melden.
    try { deps.reserveClip({ id, created_at: nowIso, title: `Clip von ${user}`, url, creator_name: user }); } catch {}

    let clip = null;
    const deadline = deps.now() + CLIP_POLL_MAX_MS;
    while (true) {
      try { clip = await deps.getClip(id); } catch { clip = null; }
      if (clip) break;
      if (deps.now() + CLIP_POLL_INTERVAL_MS > deadline) break;
      await deps.sleep(CLIP_POLL_INTERVAL_MS);
    }
    if (!clip) {
      try { deps.markError(id, "Twitch lieferte den Clip nicht innerhalb von 60 Sekunden."); } catch {}
      return fail("not-ready", "Twitch lieferte den Clip nicht innerhalb von 60 Sekunden.", id);
    }

    const clipUrl = clip.url || url;
    const title = clean(clip.title || `Clip von ${user}`);
    const message = fill(cfg.cmdMessage, { user, url: clipUrl, title, clip_id: id, duration: String(cfg.cmdDuration) });
    const sent = await say(message);
    const sharedAt = new Date(deps.now()).toISOString();
    if (cfg.cmdDiscord) {
      try {
        deps.enqueueDiscord({ clipId: id, title, url: clipUrl, creator: user, createdAt: clip.created_at || nowIso, thumbnailUrl: clip.thumbnail_url || "" });
      } catch {}
    }
    try { deps.markShared({ ...clip, id, url: clipUrl, title, creator_name: user }, { sharedAt, requestedBy: user, chatDropped: !!sent?.dropped }); } catch {}
    deps.audit("clip.command.created", { section: "clips", clipId: id, user, url: clipUrl, durationSeconds: cfg.cmdDuration, chatSent: sent?.ok !== false && !sent?.dropped, discord: !!cfg.cmdDiscord });
    return { ok: true, id, url: clipUrl, message };
  }

  return { handle, _state: () => ({ lastUse, lastGlobal }) };
}

module.exports = {
  createClipCommand, normalizeClipCommandSettings, normalizeCommandName, chatRoles, isAllowed,
  CLIP_CHANNEL_SCOPES, CLIP_COMMAND_ALLOWED, CLIP_COMMAND_ALLOWED_LABELS, CLIP_POLL_INTERVAL_MS, CLIP_POLL_MAX_MS, DEFAULTS
};
