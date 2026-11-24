"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const { createEmoteCache } = require("../app/chat-emotes");
const { createChatOverlay, DEFAULT_CONFIG } = require("../app/chat-overlay");
const csp = require("../shared/csp");

const ID7 = "01FCY771D800007PQ2DF3GDTN6", IDB = "54fa8f1401e468494b85b537";
const feeds = {
  "https://7tv.io/v3/emote-sets/global": { emotes: [{ id: ID7, name: "RainTime", flags: 1, data: { flags: 256, animated: true } }, { id: "<script>", name: "Boese", flags: 0 }] },
  "https://7tv.io/v3/users/twitch/42": { emote_set: { emotes: [{ id: "01FE3XY508000AA32JP519W2EW", name: "KanalEmote", flags: 0, data: { flags: 0 } }] } },
  "https://api.betterttv.net/3/cached/emotes/global": [{ id: IDB, code: "CiGrip", imageType: "png" }, { id: IDB, code: "KanalEmote" }],
  "https://api.betterttv.net/3/cached/users/twitch/42": { channelEmotes: [{ id: "54fa8fce01e468494b85b53c", code: "BKanal" }], sharedEmotes: [] },
  "https://api.frankerfacez.com/v1/set/global": { default_sets: [3], sets: { 3: { emoticons: [{ id: 9, name: "ZrehplaR" }, { id: "x/../", name: "Kaputt" }] } } },
  "https://api.betterttv.net/3/cached/frankerfacez/users/twitch/42": [{ id: 77, code: "FfzKanal" }]
};
const make = (on, extra = {}) => {
  const calls = [];
  const cache = createEmoteCache({ fetchJson: async u => { calls.push(u); if (!(u in feeds)) throw new Error("404"); return structuredClone(feeds[u]); }, channelId: async () => "42", enabled: () => on, ...extra });
  return { cache, calls };
};
const text = v => ({ t: "text", v });

test("Standard: alle drei Dienste sind aus", () => {
  assert.equal(DEFAULT_CONFIG.emotes7tv, false); assert.equal(DEFAULT_CONFIG.emotesBttv, false); assert.equal(DEFAULT_CONFIG.emotesFfz, false);
});
test("ausgeschaltete Dienste werden nie abgefragt", async () => {
  const { cache, calls } = make({ "7tv": false, bttv: false, ffz: false });
  assert.equal(cache.ensure(), null); assert.equal(calls.length, 0);
});
test("nur eingeschaltete Dienste werden geladen, global und Kanal", async () => {
  const { cache, calls } = make({ "7tv": true });
  await cache.ensure();
  assert.deepEqual(calls.sort(), ["https://7tv.io/v3/emote-sets/global", "https://7tv.io/v3/users/twitch/42"]);
  assert.equal(cache.lookup("RainTime").id, ID7); assert.equal(cache.lookup("RainTime").zw, true);
  assert.equal(cache.lookup("KanalEmote").p, "7tv"); assert.equal(cache.lookup("CiGrip"), null);
});
test("ungültige Kennungen und Namen werden verworfen", async () => {
  const { cache } = make({ "7tv": true, bttv: true, ffz: true });
  await cache.ensure();
  assert.equal(cache.lookup("Boese"), null); assert.equal(cache.lookup("Kaputt"), null);
  assert.equal(cache.lookup("ZrehplaR").id, "9"); assert.equal(cache.lookup("FfzKanal").id, "77"); assert.equal(cache.lookup("BKanal").p, "bttv");
});
test("Reihenfolge bei gleichem Namen: 7TV vor BetterTTV", async () => {
  const { cache } = make({ "7tv": true, bttv: true });
  await cache.ensure();
  assert.equal(cache.lookup("KanalEmote").p, "7tv");
  const only = make({ bttv: true }); await only.cache.ensure();
  assert.equal(only.cache.lookup("KanalEmote").p, "bttv");
});
test("Ausfall eines Dienstes lässt die anderen laufen; Wiederholung erst nach Wartezeit", async () => {
  const t = { v: 1000 }; const calls = [];
  const cache = createEmoteCache({ fetchJson: async u => { calls.push(u); if (u.includes("7tv.io")) throw new Error("down"); return structuredClone(feeds[u]); }, channelId: async () => "42", enabled: () => ({ "7tv": true, bttv: true }), now: () => t.v });
  await cache.ensure();
  assert.ok(cache.lookup("CiGrip")); assert.equal(cache.lookup("RainTime"), null);
  const n = calls.length; assert.equal(cache.ensure(), null); assert.equal(calls.length, n);
  t.v = 1000 + 121000; await cache.ensure(); assert.ok(calls.length > n);
});
test("ohne Kanalkennung gibt es nur globale Emotes", async () => {
  const calls = [];
  const cache = createEmoteCache({ fetchJson: async u => { calls.push(u); return structuredClone(feeds[u]); }, channelId: async () => null, enabled: () => ({ bttv: true }) });
  await cache.ensure(); assert.deepEqual(calls, ["https://api.betterttv.net/3/cached/emotes/global"]);
});
test("expand: Text wird an Emote-Namen aufgeteilt, Leerraum bleibt erhalten", async () => {
  const { cache } = make({ "7tv": true, bttv: true }); await cache.ensure();
  const out = cache.expand([text("hi CiGrip und RainTime, KanalEmote!")]);
  assert.equal(out.map(p => p.v).join(""), "hi CiGrip und RainTime, KanalEmote!");
  assert.deepEqual(out.filter(p => p.t === "ext").map(p => p.v), ["CiGrip"]);   // Satzzeichen hängen am Wort: kein Treffer
  const zw = cache.expand([text("CiGrip RainTime")]).find(p => p.v === "RainTime");
  assert.equal(zw.zw, true); assert.equal(zw.p, "7tv");
});
test("expand: Twitch-Emotes bleiben, höchstens 30 Fremd-Emotes pro Nachricht", async () => {
  const { cache } = make({ bttv: true }); await cache.ensure();
  const parts = [{ t: "emote", id: "25", v: "Kappa" }, text(Array(40).fill("CiGrip").join(" "))];
  const out = cache.expand(parts);
  assert.deepEqual(out[0], parts[0]); assert.equal(out.filter(p => p.t === "ext").length, 30);
  assert.equal(out.map(p => p.v).join(""), "Kappa" + Array(40).fill("CiGrip").join(" "));
});
test("expand ohne Treffer oder ohne geladene Daten gibt die Teile unverändert zurück", async () => {
  const { cache } = make({ bttv: true });
  const parts = [text("CiGrip")]; assert.equal(cache.expand(parts), parts);
  await cache.ensure(); const same = [text("nichts hier")]; assert.deepEqual(cache.expand(same), same);
});

// Einbindung ins Overlay
function overlayWith() {
  let o;
  const calls = [];
  const cache = createEmoteCache({ fetchJson: async u => { calls.push(u); if (!(u in feeds)) throw new Error("404"); return structuredClone(feeds[u]); }, channelId: async () => "42",
    enabled: () => { const c = o.getConfig(); return { "7tv": c.emotes7tv, bttv: c.emotesBttv, ffz: c.emotesFfz }; } });
  let stored = {};
  o = createChatOverlay({ read: () => structuredClone(stored), write: v => { stored = structuredClone(v); }, emotes: cache, setTimer: () => 1, clearTimer: () => {} });
  const res = new EventEmitter(), frames = []; res.writableLength = 0; res.writeHead = () => {}; res.write = f => frames.push(f); res.end = () => {};
  o.addSseClient(res, new EventEmitter(), "1.2.3.4");
  const events = n => frames.filter(f => f.includes(`event: ${n}\n`)).map(f => JSON.parse(f.split("data: ")[1]));
  return { o, cache, events, calls };
}
const chat = (v) => ({ id: "m1", uid: "11", login: "anna", name: "Anna", color: "#3C8DFF", parts: [text(v)], badges: [], kind: "chat", at: Date.now() });
test("Overlay: Nachricht enthält Fremd-Emote nur mit Dienst und Kennung", async () => {
  const s = overlayWith(); s.o.configure({ delaySeconds: 0, emotesBttv: true }); await s.cache.ensure();
  s.o.handleChat(chat("Hallo CiGrip"));
  const m = s.events("message").at(-1);
  assert.deepEqual(m.parts.find(p => p.t === "ext"), { t: "ext", p: "bttv", id: IDB, v: "CiGrip" });
});
test("Overlay: Schalter aus oder Emotes als Text → Nachricht bleibt Text", async () => {
  const s = overlayWith(); s.o.configure({ delaySeconds: 0, emotesBttv: true }); await s.cache.ensure();
  s.o.configure({ emotesBttv: false }); s.o.handleChat(chat("Hallo CiGrip"));
  assert.ok(s.events("message").at(-1).parts.every(p => p.t === "text"));
  s.o.configure({ emotesBttv: true, showEmotes: false }); s.o.handleChat({ ...chat("Hallo CiGrip"), id: "m2" });
  assert.ok(s.events("message").at(-1).parts.every(p => p.t === "text"));
});
test("Overlay: Konfiguration nimmt nur Wahrheitswerte für die Schalter an", () => {
  const s = overlayWith();
  assert.throws(() => s.o.configure({ emotes7tv: "ja" }));
  assert.equal(s.o.configure({ emotes7tv: true }).emotes7tv, true);
});

test("Sicherheit: CSP erlaubt nur die drei Bildserver zusätzlich, keine Skripte", () => {
  const c = csp.CHAT_OVERLAY_ENFORCED;
  for (const h of ["https://cdn.7tv.app", "https://cdn.betterttv.net", "https://cdn.frankerfacez.com"]) assert.ok(c.includes(h), h);
  assert.match(c, /script-src 'self'/); assert.match(c, /connect-src 'self'/);
  assert.ok(!/api\.betterttv|7tv\.io/.test(c));
});
test("Sicherheit: Server fragt nur feste Hosts ab, Overlay-Seite baut Adressen nur aus Vorlagen", () => {
  const server = fs.readFileSync(__dirname + "/../app/server.js", "utf8");
  assert.match(server, /EMOTE_HOSTS=new Set\(\["7tv\.io","api\.betterttv\.net","api\.frankerfacez\.com"\]\)/);
  assert.match(server, /redirect:"error"/);
  const page = fs.readFileSync(__dirname + "/../public/chat-overlay.js", "utf8");
  assert.match(page, /EXT_ID\[p\.p\]\.test/); assert.ok(!/innerHTML/.test(page));
});
