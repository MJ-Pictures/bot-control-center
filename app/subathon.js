"use strict";
// 9.20.0 · Subathon: Countdown, der durch Abos, geschenkte Abos, Bits und (optional) Follows verlängert wird.
// Aufbau wie app/followathon.js (Zustand als Dokument, Overlay per SSE), aber ohne Zurückhalte-Liste.
// Ereignisquellen: EventSub channel.subscribe / channel.subscription.gift / channel.subscription.message / channel.cheer / channel.follow.
const fs = require("fs");
const crypto = require("crypto");
const { createSseLimiter, rejectTooMany } = require("../shared/sse-limits");

const TIER_KEYS = { "1000": "sub1", "2000": "sub2", "3000": "sub3" };
const KINDS = ["sub", "gift", "bits", "follow"];

function createSubathon({ file, storage = null, storageKey = "subathon", audit = () => {}, publicBaseUrl = "", getTwitchStatus = async () => ({}), beforeStart = async () => {}, retentionDays = 90 }) {
  const clients = new Set();
  const sseLimiter = createSseLimiter({ max: 20, perIp: 4 });
  let tx = Promise.resolve();
  let lastBroadcast = "";

  const nowIso = () => new Date().toISOString();
  const id = (prefix = "sa") => `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
  const clampInt = (v, min, max, def = min) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def; };
  const optInt = (v, min, max) => (v == null || v === "" ? null : clampInt(v, min, max, min));
  const berlinDay = (ms = Date.now()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ms));
  const atomicWrite = (p, obj) => { const tmp = `${p}.tmp-${process.pid}-${Date.now()}`; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, p); };

  const defaults = () => ({ schema: 1, currentEventId: null, events: [], seenMessageIds: {}, config: { retentionDays } });
  const normalize = (input) => {
    const s = { ...defaults(), ...(input && typeof input === "object" ? input : {}) };
    if (!Array.isArray(s.events)) s.events = [];
    if (!s.seenMessageIds || typeof s.seenMessageIds !== "object" || Array.isArray(s.seenMessageIds)) s.seenMessageIds = {};
    s.config = { ...defaults().config, ...(s.config || {}) };
    return s;
  };
  const read = () => {
    try {
      if (storage?.enabled) return normalize(storage.getDocument(storageKey, defaults()));
      if (fs.existsSync(file)) return normalize(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (e) { if (storage?.enabled) throw e; }
    return defaults();
  };
  const clean = (s) => {
    const cutoff = Date.now() - clampInt(s.config.retentionDays, 7, 365, 90) * 86400000;
    for (const [k, v] of Object.entries(s.seenMessageIds)) if (new Date(v).getTime() < cutoff) delete s.seenMessageIds[k];
    for (const e of s.events) if (Array.isArray(e.log)) e.log = e.log.filter(x => new Date(x.at || 0).getTime() >= cutoff).slice(-2500);
    s.events = s.events.slice(-50);
    return s;
  };
  const write = (s) => {
    s = clean(s);
    if (storage?.enabled) { storage.putDocument(storageKey, s); return s; }
    atomicWrite(file, s); return s;
  };

  const current = (s) => s.events.find(x => x.id === s.currentEventId) || null;
  const active = (e) => !!e && (e.status === "running" || e.status === "paused");
  const remaining = (e, at = Date.now()) => {
    if (!e) return 0;
    if (e.status === "paused") return Math.max(0, Number(e.pausedRemainingSeconds || 0));
    if (e.status === "running") return Math.max(0, Math.ceil((new Date(e.countdownEndAt).getTime() - at) / 1000));
    return 0;
  };
  const hardRemaining = (e, at = Date.now()) => (e?.hardEndAt ? Math.max(0, Math.floor((new Date(e.hardEndAt).getTime() - at) / 1000)) : Infinity);
  const maxAllowedRemaining = (e, at = Date.now()) => Math.max(0, Math.min(e?.maxRemainingSeconds == null ? Infinity : Number(e.maxRemainingSeconds), hardRemaining(e, at)));
  const eventLog = (e, entry) => {
    e.log ||= [];
    const row = { id: id("log"), at: nowIso(), ...entry };
    e.log.push(row);
    if (e.log.length > 2500) e.log = e.log.slice(-2500);
    return row;
  };
  const endEvent = (e, reason = "countdown-zero", at = nowIso()) => {
    if (!e || e.status === "ended") return false;
    e.status = "ended"; e.endedAt = at; e.endReason = reason; e.countdownEndAt = null; e.pausedRemainingSeconds = 0;
    eventLog(e, { source: "system", decision: "ended", creditedSeconds: 0, reason });
    return true;
  };
  const reconcile = (s, at = Date.now()) => {
    const e = current(s); if (!e) return false;
    if (e.status === "running" && remaining(e, at) <= 0) return endEvent(e, e.hardEndAt && new Date(e.hardEndAt).getTime() <= at ? "hard-end-reached" : "countdown-zero", new Date(at).toISOString());
    if (e.status === "paused" && e.hardEndAt && new Date(e.hardEndAt).getTime() <= at) return endEvent(e, "hard-end-reached", new Date(at).toISOString());
    return false;
  };
  const expectedEnd = (e) => (e?.status === "running" ? e.countdownEndAt || null : e?.status === "ended" ? e.endedAt || null : null);
  const netCredited = (e) => Math.max(0, Number(e.creditedSeconds || 0) - Number(e.reversedSeconds || 0));

  const publicStateFrom = (s) => {
    const e = current(s), at = Date.now();
    if (!e) return { exists: false, serverNow: new Date(at).toISOString() };
    return {
      exists: true, id: e.id, name: e.name, status: e.status, serverNow: new Date(at).toISOString(),
      remainingSeconds: remaining(e, at), expectedEndAt: expectedEnd(e), hardEndAt: e.hardEndAt || null,
      tallies: { ...(e.tallies || {}) }, creditedSeconds: netCredited(e),
      label: e.overlay?.label || "SUBATHON", fontSize: clampInt(e.overlay?.fontSize, 24, 180, 72),
      textColor: e.overlay?.textColor || "#ffffff", accentColor: e.overlay?.accentColor || "#9146ff",
      showNames: e.overlay?.showNames === true,
      lastCredit: e.lastPublicCredit ? { ...e.lastPublicCredit, userName: e.overlay?.showNames === true ? e.lastPublicCredit.userName : null } : null
    };
  };
  const adminStateFrom = async (s) => {
    const e = current(s), at = Date.now();
    const twitch = await getTwitchStatus().catch(err => ({ error: err.message }));
    return {
      event: e ? { ...e, remainingSeconds: remaining(e, at), expectedEndAt: expectedEnd(e), creditedNetSeconds: netCredited(e), users: undefined, seen: undefined, log: (e.log || []).slice(-300).reverse() } : null,
      config: s.config, twitch,
      overlayUrl: (b => (b ? `${b}/subathon/overlay` : "/subathon/overlay"))(typeof publicBaseUrl === "function" ? publicBaseUrl() : publicBaseUrl),
      serverNow: new Date(at).toISOString()
    };
  };
  // 9.25.3: ohne verbundene Overlay-Clients wird nichts berechnet; der Zustand kann mitgegeben werden (kein zweites Lesen im Zeitgeber).
  const broadcast = (force = false, state = null) => {
    if (!clients.size) { lastBroadcast = ""; return; }
    const payload = JSON.stringify(publicStateFrom(state || read()));
    if (!force && payload === lastBroadcast) return;
    lastBroadcast = payload;
    for (const res of [...clients]) { try { res.write(`event: state\ndata: ${payload}\n\n`); } catch { clients.delete(res); } }
  };
  const transact = (fn, { broadcastAfter = true } = {}) => {
    const job = tx.then(async () => { const s = read(); reconcile(s); const out = await fn(s); write(s); if (broadcastAfter) setImmediate(() => broadcast(true)); return out; });
    tx = job.catch(() => {});
    return job;
  };

  function berlinLocalToUtc(local) {
    const m = String(local || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const p = m.slice(1).map(Number), naive = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5] || 0);
    const offsetAt = (ms) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
      const z = parts.find(x => x.type === "timeZoneName")?.value || "GMT";
      const zm = z.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/); if (!zm) return 0;
      return (zm[1] === "-" ? -1 : 1) * (Number(zm[2]) * 60 + Number(zm[3] || 0)) * 60000;
    };
    let utc = naive - offsetAt(naive); utc = naive - offsetAt(utc);
    return new Date(utc).toISOString();
  }

  const normRates = (r = {}) => ({
    sub1: clampInt(r.sub1, 0, 86400, 300), sub2: clampInt(r.sub2, 0, 86400, 600), sub3: clampInt(r.sub3, 0, 86400, 1500),
    bitsPer100: clampInt(r.bitsPer100, 0, 86400, 60), follow: clampInt(r.follow, 0, 86400, 30)
  });
  const normCounting = (c = {}) => ({ subs: c.subs !== false, gifts: c.gifts !== false, bits: c.bits !== false, follows: c.follows === true });

  // Einstellungen eines Events aus der Eingabe (gemeinsam für Anlegen und Bearbeiten).
  const settingsFrom = (input) => ({
    name: String(input.name || "Subathon").trim().slice(0, 120) || "Subathon",
    startDurationSeconds: clampInt(input.startDurationSeconds, 1, 31_536_000, 3600),
    maxRemainingSeconds: optInt(input.maxRemainingSeconds, 1, 31_536_000),
    maxTotalSeconds: optInt(input.maxTotalSeconds, 1, 31_536_000),
    dailyLimitSeconds: optInt(input.dailyLimitSeconds, 1, 31_536_000),
    rates: normRates(input.rates), counting: normCounting(input.counting),
    overlay: { label: String(input.overlay?.label || "SUBATHON").slice(0, 40), fontSize: clampInt(input.overlay?.fontSize, 24, 180, 72), textColor: colorOr(input.overlay?.textColor, "#ffffff"), accentColor: colorOr(input.overlay?.accentColor, "#9146ff"), showNames: input.overlay?.showNames === true }
  });
  const colorOr = (v, def) => (/^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? String(v) : def);

  async function createEvent(input, actor) {
    return transact(async (s) => {
      const old = current(s); if (active(old)) throw new Error("Das aktuelle Subathon-Event muss zuerst beendet werden.");
      const e = {
        id: id(), createdAt: nowIso(), createdBy: actor, status: "draft", ...settingsFrom(input),
        tallies: { subs: 0, gifts: 0, bits: 0, follows: 0 }, creditedSeconds: 0, reversedSeconds: 0, users: {}, daily: { day: berlinDay(), seconds: 0 }, log: []
      };
      eventLog(e, { source: "admin", decision: "created", creditedSeconds: 0, reason: `Event angelegt von ${actor}` });
      s.events.push(e); s.currentEventId = e.id;
      audit(actor, "subathon.created", { eventId: e.id, name: e.name }); return e;
    });
  }

  // 9.20.1: Einstellungen sind nur vor dem Start änderbar; ab dem Start sind sie gesperrt.
  async function updateEvent(input, actor) {
    return transact(async (s) => {
      const e = current(s); if (!e) throw new Error("Kein Subathon-Event vorhanden.");
      if (e.status !== "draft") throw new Error("Die Einstellungen sind ab dem Start gesperrt. Zum Ändern den Subathon beenden und ein neues Event anlegen.");
      Object.assign(e, settingsFrom(input));
      eventLog(e, { source: "admin", decision: "settings-updated", creditedSeconds: 0, reason: `Einstellungen geändert von ${actor}` });
      audit(actor, "subathon.updated", { eventId: e.id }); return e;
    });
  }

  async function action(kind, body, actor) {
    if (kind === "start") await beforeStart(actor); // beendet einen laufenden Followathon (vor der Zustandsänderung; Fehler bricht den Start ab)
    return transact(async (s) => {
      const e = current(s); if (!e) throw new Error("Kein Subathon-Event vorhanden.");
      const now = Date.now(), at = new Date(now).toISOString();
      if (kind === "start") {
        if (e.status !== "draft") throw new Error("Nur ein neues Event kann gestartet werden.");
        e.startedAt = at; e.status = "running"; e.daily = { day: berlinDay(now), seconds: 0 };
        if (e.maxTotalSeconds) e.hardEndAt = new Date(now + e.maxTotalSeconds * 1000).toISOString();
        const rem = Math.min(e.startDurationSeconds, maxAllowedRemaining(e, now));
        if (rem <= 0) endEvent(e, "limit-at-start", at);
        else { e.countdownEndAt = new Date(now + rem * 1000).toISOString(); eventLog(e, { source: "admin", decision: "started", creditedSeconds: 0, reason: `Gestartet von ${actor} mit ${rem} Sekunden.` }); }
      } else if (kind === "pause") {
        if (e.status !== "running") throw new Error("Der Countdown läuft nicht.");
        e.pausedRemainingSeconds = Math.min(remaining(e, now), maxAllowedRemaining(e, now)); e.countdownEndAt = null; e.status = "paused";
        eventLog(e, { source: "admin", decision: "paused", creditedSeconds: 0, reason: `Pausiert von ${actor}` });
      } else if (kind === "resume") {
        if (e.status !== "paused") throw new Error("Der Countdown ist nicht pausiert.");
        const rem = Math.min(Number(e.pausedRemainingSeconds || 0), maxAllowedRemaining(e, now)); e.pausedRemainingSeconds = 0;
        if (rem <= 0) endEvent(e, "limit-on-resume", at);
        else { e.status = "running"; e.countdownEndAt = new Date(now + rem * 1000).toISOString(); eventLog(e, { source: "admin", decision: "resumed", creditedSeconds: 0, reason: `Fortgesetzt von ${actor}` }); }
      } else if (kind === "end") {
        endEvent(e, "manual-end", at); eventLog(e, { source: "admin", decision: "manual-end", creditedSeconds: 0, reason: `Beendet von ${actor}` });
      } else if (kind === "adjust") {
        if (e.status === "draft") throw new Error("Das Event wurde noch nicht gestartet.");
        const requested = clampInt(Math.abs(body.seconds), 1, 604800, 60) * (body.direction === "subtract" ? -1 : 1);
        let actual = 0;
        if (e.status === "ended") {
          if (requested < 0) { actual = -Math.min(Math.abs(requested), netCredited(e)); e.reversedSeconds = Number(e.reversedSeconds || 0) + Math.abs(actual); }
        } else {
          const before = remaining(e, now), after = Math.max(0, Math.min(maxAllowedRemaining(e, now), before + requested)); actual = after - before;
          if (e.status === "running") e.countdownEndAt = after > 0 ? new Date(now + after * 1000).toISOString() : null; else e.pausedRemainingSeconds = after;
          if (actual > 0) e.creditedSeconds = Number(e.creditedSeconds || 0) + actual; else e.reversedSeconds = Number(e.reversedSeconds || 0) + Math.abs(actual);
          if (after <= 0) endEvent(e, "manual-adjustment-zero", at);
        }
        eventLog(e, { source: "manual", decision: "adjusted", requestedSeconds: requested, creditedSeconds: actual, reason: String(body.reason || "Manuelle Zeitkorrektur").slice(0, 240), actor });
      } else throw new Error("Unbekannte Aktion.");
      audit(actor, `subathon.${kind}`, { eventId: e.id }); return e;
    });
  }

  // Zeit gutschreiben: Tageslimit, Restzeit-Obergrenze und Gesamtdauer begrenzen; tatsächliche Sekunden stehen im Protokoll.
  function applyCredit(e, { kind, requested, userName, messageId, detail, source = "event" }) {
    const now = Date.now(), day = berlinDay(now);
    if (!e.daily || e.daily.day !== day) e.daily = { day, seconds: 0 };
    const dailyLeft = e.dailyLimitSeconds == null ? Infinity : Math.max(0, e.dailyLimitSeconds - Number(e.daily.seconds || 0));
    const wanted = Math.min(requested, dailyLeft);
    const before = remaining(e, now), cap = maxAllowedRemaining(e, now), after = Math.max(0, Math.min(cap, before + wanted)), actual = after - before;
    if (e.status === "running") e.countdownEndAt = after > 0 ? new Date(now + after * 1000).toISOString() : null; else if (e.status === "paused") e.pausedRemainingSeconds = after;
    e.creditedSeconds = Number(e.creditedSeconds || 0) + Math.max(0, actual);
    e.daily.seconds = Number(e.daily.seconds || 0) + Math.max(0, actual);
    const reason = actual <= 0 ? (dailyLeft <= 0 ? "Tageslimit erreicht – keine Zeit gutgeschrieben." : "Grenze erreicht – keine Zeit gutgeschrieben.") : actual < requested ? "Gutschrift an einer Grenze gekürzt." : `${requested} Sekunden gutgeschrieben.`;
    const row = eventLog(e, { source, kind, decision: actual > 0 ? (actual < requested ? "partial-credit" : "credited") : "limit-no-credit", userName, messageId, detail, requestedSeconds: requested, creditedSeconds: actual, reason });
    e.lastPublicCredit = { id: row.id, at: row.at, userName, kind, seconds: actual };
    if (after <= 0 && e.status !== "ended") endEvent(e, "countdown-zero");
    return { actual, row };
  }

  const tierKey = (tier) => TIER_KEYS[String(tier || "1000")] || "sub1";
  const nameOf = (ev) => String(ev?.is_anonymous ? "Anonym" : ev?.user_name || ev?.user_login || "Unbekannt").slice(0, 80);

  // Berechnung je Ereignis (rein, damit Test/Simulation und echte Ereignisse dasselbe rechnen).
  function plan(e, kind, ev) {
    const r = e.rates, c = e.counting;
    if (kind === "sub") { if (!c.subs) return { skip: "counting-off" }; const t = tierKey(ev.tier); return { kind: "sub", requested: r[t], detail: `Abo Stufe ${t.slice(3)}${ev.cumulative_months ? ` · ${ev.cumulative_months} Monate` : ""}`, tally: ["subs", 1] }; }
    if (kind === "gift") { if (!c.gifts) return { skip: "counting-off" }; const t = tierKey(ev.tier), n = clampInt(ev.total, 1, 1000, 1); return { kind: "gift", requested: r[t] * n, detail: `${n} geschenkte Abos Stufe ${t.slice(3)}`, tally: ["gifts", n] }; }
    if (kind === "bits") { if (!c.bits) return { skip: "counting-off" }; const b = clampInt(ev.bits, 0, 1_000_000, 0); const sec = Math.floor(b * r.bitsPer100 / 100); return sec > 0 ? { kind: "bits", requested: sec, detail: `${b} Bits`, tally: ["bits", b] } : { skip: "no-seconds" }; }
    if (kind === "follow") { if (!c.follows) return { skip: "counting-off" }; return r.follow > 0 ? { kind: "follow", requested: r.follow, detail: "Follow", tally: ["follows", 1] } : { skip: "no-seconds" }; }
    return { skip: "unknown-kind" };
  }

  async function handle(kind, ev, metadata = {}) {
    const messageId = String(metadata.message_id || "").trim();
    return transact(async (s) => {
      const e = current(s);
      if (messageId && s.seenMessageIds[messageId]) return { decision: "duplicate-message" };
      if (messageId) s.seenMessageIds[messageId] = nowIso();
      if (!active(e)) return { decision: "no-active-event" };
      // Empfänger geschenkter Abos kommen zusätzlich als eigenes Abo-Ereignis: nicht doppelt zählen.
      if (kind === "sub" && ev?.is_gift === true) return { decision: "gift-recipient-ignored" };
      const userName = nameOf(ev), userId = String(ev?.user_id || "");
      if (kind === "follow") {
        if (userId && e.users?.[userId]) return { decision: "duplicate-user" };
      }
      const p = plan(e, kind, ev);
      if (p.skip) return { decision: p.skip };
      if (kind === "follow" && userId) { e.users ||= {}; e.users[userId] = { userName, at: nowIso() }; }
      const out = applyCredit(e, { kind: p.kind, requested: p.requested, userName, messageId, detail: p.detail });
      e.tallies ||= { subs: 0, gifts: 0, bits: 0, follows: 0 };
      e.tallies[p.tally[0]] = Number(e.tallies[p.tally[0]] || 0) + p.tally[1];
      audit("eventsub-system", "subathon.event.processed", { eventId: e.id, kind: p.kind, creditedSeconds: out.actual });
      return { decision: "credited", creditedSeconds: out.actual };
    });
  }

  async function reset(actor) {
    return transact(async (s) => { const e = current(s); if (e && e.status !== "ended") endEvent(e, "owner-reset"); s.currentEventId = null; audit(actor, "subathon.reset", { previousEventId: e?.id || null }); return { ok: true }; });
  }

  // Simulation ohne Änderung des produktiven Zustands (Twitch-Ereignisse lassen sich lokal kaum auslösen).
  async function simulate(input, actor) {
    const s = read(); reconcile(s); const e = current(s);
    if (!e) return { ok: true, decision: "no-event", note: "Kein produktiver Zustand wurde verändert." };
    if (!active(e)) return { ok: true, decision: "no-active-event", note: "Testmodus: keine produktive Änderung." };
    const kind = KINDS.includes(input.kind) ? input.kind : "sub", clone = JSON.parse(JSON.stringify(e));
    const ev = { tier: input.tier || "1000", total: input.total || 1, bits: input.bits || 100, user_name: String(input.userName || "TestZuschauer") };
    const p = plan(clone, kind, ev);
    if (p.skip) return { ok: true, decision: p.skip, note: "Testmodus: keine produktive Änderung." };
    const out = applyCredit(clone, { kind: p.kind, requested: p.requested, userName: ev.user_name, messageId: id("testmsg"), detail: p.detail, source: "test" });
    audit(actor, "subathon.test.simulated", { eventId: e.id, kind, creditedSeconds: out.actual });
    return { ok: true, decision: out.actual < p.requested ? "partial-credit" : "credited", requestedSeconds: p.requested, creditedSeconds: out.actual, note: "Simulation: keine produktive Änderung." };
  }

  function addSseClient(res, ip) {
    const release = sseLimiter.tryAcquire(ip);
    if (!release) return rejectTooMany(res);
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`event: state\ndata: ${JSON.stringify(publicStateFrom(read()))}\n\n`); clients.add(res);
    const ping = setInterval(() => { try { res.write(": keepalive\n\n"); } catch {} }, 15000); ping.unref?.();
    res.on("close", () => { clearInterval(ping); clients.delete(res); release(); });
  }

  async function getAdminState() { const s = read(); if (reconcile(s)) write(s); return adminStateFrom(s); }
  function getPublicState() { const s = read(); if (reconcile(s)) write(s); return publicStateFrom(s); }
  function tick() { const s = read(); if (reconcile(s)) { write(s); broadcast(true, s); } else broadcast(false, s); }

  return {
    createEvent, updateEvent, action, reset, simulate, getAdminState, getPublicState, addSseClient, tick, broadcast, berlinLocalToUtc,
    handleSubscribe: (ev, m) => handle("sub", ev, m), handleGift: (ev, m) => handle("gift", ev, m), handleResub: (ev, m) => handle("sub", ev, m),
    handleCheer: (ev, m) => handle("bits", ev, m), handleFollow: (ev, m) => handle("follow", ev, m),
    plan
  };
}
module.exports = { createSubathon, TIER_KEYS };
