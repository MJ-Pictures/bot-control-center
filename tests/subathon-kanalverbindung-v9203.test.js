"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { createChannelEventSub, SUBATHON_TYPES } = require("../shared/twitch-channel-eventsub");

class FakeWS {
  static OPEN = 1; static CONNECTING = 0; static all = [];
  constructor(url) { this.url = url; this.readyState = 1; this.closed = null; FakeWS.all.push(this); }
  close(code, reason) { this.readyState = 3; this.closed = { code, reason }; setImmediate(() => this.onclose?.({ code })); }
  emit(type, payload = {}, extra = {}) { return this.onmessage({ data: JSON.stringify({ metadata: { message_id: extra.id || Math.random().toString(36), message_type: type, subscription_type: extra.subType }, payload }) }); }
}
const welcome = (ws, id = "S1") => ws.emit("session_welcome", { session: { id, keepalive_timeout_seconds: 30 } });
function make(over = {}) {
  FakeWS.all = [];
  const subs = [], notes = [], timers = [];
  const c = createChannelEventSub({
    WebSocketImpl: FakeWS, log: { warn() {} },
    createSubscription: async (type, version, sid) => { subs.push({ type, version, sid }); return over.fail ? { ok: false, status: 403, error: "missing scope" } : { ok: true, status: 202 }; },
    onNotification: async (type, ev, meta) => notes.push({ type, ev, meta }),
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: t => { t.cleared = true; },
    setTick: () => ({}), clearTick: () => {}, ...over.deps
  });
  return { c, subs, notes, timers };
}

test("Willkommen: alle vier Abos werden mit der Sitzung des Kanal-Kontos angelegt", async () => {
  const { c, subs } = make(); c.start(); await welcome(FakeWS.all[0]);
  assert.deepEqual(subs.map(x => x.type), SUBATHON_TYPES.map(x => x[0]));
  assert.ok(subs.every(x => x.sid === "S1"));
  const st = c.status(); assert.equal(st.connected, true);
  assert.ok(Object.values(st.subscriptions).every(x => x.ok));
});
test("Fehlende Rechte: Twitch-Antwort steht im Status, Verbindung bleibt bestehen", async () => {
  const { c } = make({ fail: true }); c.start(); await welcome(FakeWS.all[0]);
  const st = c.status(); assert.equal(st.connected, true);
  assert.ok(Object.values(st.subscriptions).every(x => !x.ok && x.status === 403));
});
test("Ereignisse werden weitergegeben und doppelte Nachrichten verworfen", async () => {
  const { c, notes } = make(); c.start(); const ws = FakeWS.all[0]; await welcome(ws);
  await ws.emit("notification", { event: { bits: 100 } }, { id: "m1", subType: "channel.cheer" });
  await ws.emit("notification", { event: { bits: 100 } }, { id: "m1", subType: "channel.cheer" });
  assert.equal(notes.length, 1); assert.equal(notes[0].type, "channel.cheer"); assert.equal(notes[0].ev.bits, 100);
});
test("Verbindungsabbruch: neuer Versuch nach Wartezeit; nach Stopp kein neuer Versuch", async () => {
  const { c, timers } = make(); c.start(); const ws = FakeWS.all[0]; await welcome(ws);
  ws.onclose({ code: 1006 });
  assert.equal(c.status().state, "reconnecting"); assert.equal(timers.length, 1);
  timers[0].fn(); assert.equal(FakeWS.all.length, 2);
  c.stop(); assert.equal(c.status().running, false);
  const n = timers.length; FakeWS.all[1].onclose?.({ code: 1006 }); assert.equal(timers.length, n);
});
test("Twitch-Umzug (session_reconnect): neue Verbindung übernimmt, alte schließt ohne Neuaufbau", async () => {
  const { c, subs, timers } = make(); c.start(); const a = FakeWS.all[0]; await welcome(a);
  await a.emit("session_reconnect", { session: { reconnect_url: "wss://neu" } });
  const b = FakeWS.all[1]; assert.equal(b.url, "wss://neu");
  await welcome(b, "S2");
  assert.equal(a.closed.code, 1000); assert.equal(timers.length, 0);
  assert.equal(subs.length, 4, "Abos werden beim Umzug nicht doppelt angelegt");
  assert.equal(c.status().connected, true);
});
test("Widerruf durch Twitch markiert das Abo als nicht aktiv", async () => {
  const { c } = make(); c.start(); const ws = FakeWS.all[0]; await welcome(ws);
  await ws.emit("revocation", { subscription: { type: "channel.cheer", status: "authorization_revoked" } });
  assert.equal(c.status().subscriptions["channel.cheer"].ok, false);
});
test("Verdrahtung: Ereignisnamen ohne Punkt, Kanal-Konto über den Schlüssel der Bot-Liste, eigener Weg über die Schnittstelle", () => {
  const rt = fs.readFileSync("shared/twitch-runtime.js", "utf8"), web = fs.readFileSync("app/server.js", "utf8"), link = fs.readFileSync("shared/twitch-link.js", "utf8");
  const names = [...rt.matchAll(/"(subathon-[a-z]+)"/g)].map(m => m[1]);
  assert.equal(new Set(names).size, 4);
  for (const n of names) { assert.match(n, /^[a-z][a-z0-9-]{0,39}$/, n); assert.ok(web.includes(`twitchEvents.on("${n}"`), n); }
  assert.doesNotMatch(web, /twitchEvents\.on\("subathon\./);
  assert.doesNotMatch(web, /connectionStatus\("channel"\)/);
  assert.match(web, /connectionStatus\(ch\.key\)/);
  assert.match(link, /"subathonStatus", "subathonEnsure"/);
  assert.match(web, /\/api\/subathon\/check[\s\S]{0,120}twitch\.subathon\.edit/);
  assert.doesNotMatch(rt, /Subathon-EventSub \$\{type\}: \$\{e\.message\}/, "alter Weg über die Haupt-Verbindung ist entfernt");
});
