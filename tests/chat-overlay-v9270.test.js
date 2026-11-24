"use strict";
// 9.27.0 · Chat-Overlay: Konfiguration, Verzögerung/Löschen, Bot-Nachrichten, Filter, Sicherheit, Verdrahtung.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { EventEmitter } = require("node:events");
const { createChatOverlay, normalizeConfig, DEFAULT_CONFIG, MAX_AGE_MS } = require("../app/chat-overlay");
const core = require("../shared/chat-overlay-core");
const { MODULES } = require("../shared/modules");

function setup(initial = {}, nowRef = { t: 1_000_000 }) {
  let stored = initial; const timers = new Map(); let seq = 0;
  const overlay = createChatOverlay({
    read: () => structuredClone(stored), write: v => { stored = structuredClone(v); },
    now: () => nowRef.t, setTimer: (fn, ms) => { const h = ++seq; timers.set(h, { fn, ms }); return h; }, clearTimer: h => timers.delete(h)
  });
  const req = new EventEmitter(), res = new EventEmitter(), frames = [];
  res.writableLength = 0; res.writeHead = () => {}; res.write = f => { frames.push(f); }; res.end = () => {};
  overlay.addSseClient(res, req, "1.2.3.4");
  const events = name => frames.filter(f => f.includes(`event: ${name}\n`)).map(f => JSON.parse(f.split("data: ")[1]));
  const fire = () => { for (const [h, t] of [...timers]) { timers.delete(h); t.fn(); } };
  return { overlay, frames, events, timers, fire, getStored: () => stored, now: nowRef };
}
const msg = (o = {}) => ({ id: "m1", uid: "11", login: "anna", name: "Anna", color: "#3C8DFF", parts: [{ t: "text", v: "Hallo" }], badges: [], kind: "chat", at: 1_000_000, ...o });

test("Standardwerte: Verzögerung 2 s, dunkler Look, Bots aus, Befehle verborgen", () => {
  assert.equal(DEFAULT_CONFIG.delaySeconds, 2); assert.equal(DEFAULT_CONFIG.theme, "dark");
  assert.equal(DEFAULT_CONFIG.botMessages, "none"); assert.equal(DEFAULT_CONFIG.hideCommands, true); assert.equal(DEFAULT_CONFIG.font, "system");
});
test("Konfiguration: ungültige Werte werden abgewiesen, gültige gespeichert und gesendet", () => {
  const s = setup();
  for (const bad of [{ theme: "neon" }, { delaySeconds: 9 }, { accentColor: "red" }, { botMessages: "x" }, { maxMessages: 99 }, { font: "comic" }])
    assert.throws(() => s.overlay.configure(bad), undefined, JSON.stringify(bad));
  s.overlay.configure({ theme: "angular", delaySeconds: 0 });
  assert.equal(s.getStored().theme, "angular"); assert.equal(s.events("config").at(-1).theme, "angular");
  assert.equal(normalizeConfig({}, DEFAULT_CONFIG, false).theme, "dark");
});
test("Speicherfehler: Konfiguration wird nicht live übernommen", () => {
  const o = createChatOverlay({ read: () => ({}), write: () => { throw Error("DB aus"); } });
  assert.throws(() => o.configure({ theme: "light" }), /DB aus/); assert.equal(o.getConfig().theme, "dark");
});
test("Verzögerung: Nachricht erscheint erst nach Ablauf", () => {
  const s = setup(); assert.equal(s.overlay.handleChat(msg()), true);
  assert.equal(s.events("message").length, 0); assert.equal(s.overlay.pendingCount(), 1);
  assert.equal([...s.timers.values()][0].ms, 2000); s.fire();
  assert.equal(s.events("message").length, 1); assert.equal(s.overlay.pendingCount(), 0);
});
test("Gelöschte Nachricht, gesperrter Nutzer und geleerter Chat erscheinen nie", () => {
  let s = setup(); s.overlay.handleChat(msg()); s.overlay.handleDelete({ kind: "message", id: "m1" }); s.fire(); assert.equal(s.events("message").length, 0);
  s = setup(); s.overlay.handleChat(msg()); s.overlay.handleDelete({ kind: "user", uid: "11" }); s.fire(); assert.equal(s.events("message").length, 0);
  s = setup(); s.overlay.handleChat(msg()); s.overlay.handleDelete({ kind: "clear" }); s.fire(); assert.equal(s.events("message").length, 0);
});
test("Löschen nach der Anzeige sendet remove, Sperre sendet remove mit Nutzer, Leeren sendet clear", () => {
  const s = setup({ delaySeconds: 0 });
  s.overlay.handleChat(msg()); s.overlay.handleChat(msg({ id: "m2", uid: "12", login: "bert", name: "Bert" }));
  assert.equal(s.events("message").length, 2);
  s.overlay.handleDelete({ kind: "message", id: "m1" }); assert.deepEqual(s.events("remove").at(-1), { id: "m1" });
  s.overlay.handleDelete({ kind: "user", uid: "12" }); assert.deepEqual(s.events("remove").at(-1), { uid: "12" });
  s.overlay.handleDelete({ kind: "clear" }); assert.equal(s.events("clear").length, 1);
});
test("Filter: Befehle, Fremd-Bots, zu alte und ungültige Nachrichten", () => {
  const s = setup({ delaySeconds: 0 });
  assert.equal(s.overlay.handleChat(msg({ id: "c1", parts: [{ t: "text", v: "  !lurk" }] })), false);
  assert.equal(s.overlay.handleChat(msg({ id: "c2", login: "nightbot", name: "Nightbot" })), false);
  assert.equal(s.overlay.handleChat(msg({ id: "c3", at: s.now.t - MAX_AGE_MS - 1 })), false);
  assert.equal(s.overlay.handleChat({ id: "!!", name: "x", parts: [] }), false);
  assert.equal(s.overlay.handleChat(null), false);
  s.overlay.configure({ hideCommands: false });
  assert.equal(s.overlay.handleChat(msg({ id: "c4", parts: [{ t: "text", v: "!so" }] })), true);
});
test("Bot-Nachrichten: keine / nur Spiel / alle", () => {
  const s = setup();
  assert.equal(s.overlay.handleBotMessage({ source: "stubenkontrolle", name: "Bot", text: "Hallo" }), false);
  s.overlay.configure({ botMessages: "game" });
  assert.equal(s.overlay.handleBotMessage({ source: "andere", name: "Bot", text: "Hallo" }), false);
  assert.equal(s.overlay.handleBotMessage({ source: "stubenkontrolle", name: "Bot", text: "Hallo" }), true);
  s.overlay.configure({ botMessages: "all" });
  assert.equal(s.overlay.handleBotMessage({ source: "andere", name: "Bot", text: "Hi" }), true);
  assert.equal(s.overlay.handleBotMessage({ text: "  " }), false);
  assert.equal(s.events("message").filter(m => m.kind === "bot").length, 2);
});
test("Neu geöffnete Quelle bekommt Konfiguration und Verlauf (nur Nicht-Abgelaufenes)", () => {
  const s = setup({ delaySeconds: 0, displaySeconds: 60 });
  s.overlay.handleChat(msg()); s.now.t += 30_000;
  const req = new EventEmitter(), res = new EventEmitter(), got = [];
  res.writableLength = 0; res.writeHead = () => {}; res.write = f => got.push(f); res.end = () => {};
  s.overlay.addSseClient(res, req, "5.6.7.8");
  assert.ok(got[0].includes("event: config")); const hist = JSON.parse(got[1].split("data: ")[1]);
  assert.equal(hist.length, 1); assert.equal(hist[0].ageMs, 30_000);
  s.now.t += 40_000; const got2 = [], res2 = Object.assign(new EventEmitter(), { writableLength: 0, writeHead() {}, write: f => got2.push(f), end() {} });
  s.overlay.addSseClient(res2, new EventEmitter(), "9.9.9.9"); assert.deepEqual(JSON.parse(got2[1].split("data: ")[1]), []);
});
test("Testnachrichten umgehen Filter und Verzögerung", () => {
  const s = setup(); assert.equal(s.overlay.test(), 5); assert.equal(s.events("message").length, 5);   // seit 9.27.1: zwei Ereigniskarten und drei Nachrichten
  assert.ok(s.events("message").every(m => m.id.startsWith("test-")));
});
test("Sicherheit: kein HTML, nur geprüfte Emote-Kennungen, Abzeichen nur mit Adresse des Bildservers", () => {
  const m = core.sanitizeMessage(msg({ name: "<b>Eve</b>‮", parts: [{ t: "emote", id: "a\"onerror=x", v: "X" }, { t: "text", v: "<img src=x onerror=1>" }, { t: "emote", id: "emotesv2_abc", v: "Kappa" }], badges: [{ s: "x y", i: "1" }, { s: "moderator", i: "1" }] }));
  assert.ok(!m.name.includes("‮")); assert.deepEqual(m.parts.filter(p => p.t === "emote").map(p => p.id), ["emotesv2_abc"]);
  assert.deepEqual(m.badges, [{ s: "moderator", i: "1" }]);
  assert.ok(core.BADGE_URL.test("https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/2"));
  assert.ok(!core.BADGE_URL.test("https://evil.example/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/2"));
  assert.equal(core.sanitizeMessage(msg({ id: "a b" })), null); assert.equal(core.sanitizeMessage(msg({ parts: [] })), null);
  assert.equal(core.plainText(core.sanitizeMessage(msg({ parts: [{ t: "text", v: "x".repeat(900) }] }))).length, core.MAX_TEXT);
});
test("Twitch-Ereignis wird verdichtet: Befehle bleiben Text, Emotes werden Kennungen, Löschereignisse erkannt", () => {
  const c = core.compactChatEvent({ message_id: "abc", chatter_user_id: "5", chatter_user_login: "Anna", chatter_user_name: "Anna", color: "#112233", message_type: "text",
    message: { text: "Hi Kappa", fragments: [{ type: "text", text: "Hi " }, { type: "emote", text: "Kappa", emote: { id: "25" } }] }, badges: [{ set_id: "moderator", id: "1" }] }, 5);
  assert.equal(c.id, "abc"); assert.equal(c.login, "anna"); assert.deepEqual(c.parts.map(p => p.t), ["text", "emote"]);
  assert.deepEqual(core.compactDeleteEvent("channel.chat.message_delete", { message_id: "abc" }), { kind: "message", id: "abc" });
  assert.deepEqual(core.compactDeleteEvent("channel.chat.clear_user_messages", { target_user_id: "5" }), { kind: "user", uid: "5" });
  assert.deepEqual(core.compactDeleteEvent("channel.chat.clear", {}), { kind: "clear" });
});

test("Modul: standardmäßig aus, mit Seite, Schnittstelle und Strom", () => {
  const m = MODULES.find(x => x.id === "chatOverlay");
  assert.ok(m); assert.equal(m.defaultEnabled, false); assert.deepEqual(m.overlayPages, ["/chat-overlay/overlay"]);
  assert.deepEqual(m.apiPrefixes, ["/api/chat-overlay"]); assert.deepEqual(m.publicStreams, ["/api/chat-overlay/public/stream"]);
});
test("Verdrahtung: Bot sendet gefilterte Nachrichten ohne Warteschlange, Web reagiert nur bei eingeschaltetem Modul", () => {
  const rt = fs.readFileSync("shared/twitch-runtime.js", "utf8"), web = fs.readFileSync("app/server.js", "utf8");
  assert.match(rt, /isModuleEnabled\(settings,\s*"chatOverlay"\)/); assert.match(rt, /emitTransient/);
  for (const t of ["channel.chat.message_delete", "channel.chat.clear_user_messages", "channel.chat.clear"]) assert.ok(rt.includes(t), t);
  assert.ok(rt.indexOf('emitChatOverlay("chat", compact)') > rt.indexOf("legacy") || rt.includes('emitChatOverlay("chat"'));
  for (const ev of ['"chat"', '"chat-sent"', '"chat-delete"']) assert.ok(web.includes(`twitchEvents.on(${ev}`), ev);
  assert.match(web, /moduleOn\("chatOverlay"\)/);
  assert.match(fs.readFileSync("app/stubenkontrolle.js", "utf8"), /source:\s*"stubenkontrolle"/);
});
test("Ereignis-Hub: emitTransient wird nicht in die Warteschlange gestellt", async () => {
  const { createRemoteTwitchEvents } = require("../shared/twitch-link");
  let calls = 0, timers = 0;
  const ev = createRemoteTwitchEvents({ baseUrl: "http://web:3000", secret: "s".repeat(40), log: { error() {}, warn() {}, log() {} },
    fetchImpl: async () => { calls++; throw Error("offline"); }, setTimer: () => { timers++; return 0; } });
  assert.equal(typeof ev.emitTransient, "function");
  const r = await ev.emitTransient("chat", { id: "x" });
  assert.ok(!r); assert.equal(calls, 1); assert.equal(timers, 0, "kein erneuter Versuch geplant");
});
test("Overlay-Seite: nur Text, Bilder nur vom Twitch-Bildserver, eigene CSP", () => {
  const js = fs.readFileSync("public/chat-overlay.js", "utf8"), html = fs.readFileSync("public/chat-overlay.html", "utf8");
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/); assert.doesNotMatch(html, /<script>[^<]/);
  assert.ok(js.includes("static-cdn.jtvnw.net/emoticons/v2/")); assert.ok(html.includes('src="/chat-overlay.js"'));
  const csp = require("../shared/csp"); assert.ok(JSON.stringify(csp).length > 0);
  assert.match(fs.readFileSync("shared/csp.js", "utf8"), /img-src 'self' data: https:\/\/static-cdn\.jtvnw\.net/);
});
test("Oberfläche: Navigationspunkt, Bereich und Einstellungsseite vorhanden", () => {
  const app = fs.readFileSync("public/app.js", "utf8"), idx = fs.readFileSync("public/index.html", "utf8");
  assert.match(app, /tab:"chatOverlay",label:"Chat-Overlay"/); assert.match(app, /function renderChatOverlay|renderChatOverlay\s*=/); assert.ok(idx.includes('id="chatOverlay"'));
});

// ---- 9.27.1: Ereigniskarten ----
test("Ereigniskarten: Follow und Raid erscheinen sofort, ohne Verzögerung, nur mit Name und Zuschauerzahl", () => {
  const s = setup();   // Standard: Verzögerung 2 s gilt nur für Chat-Text
  assert.equal(s.overlay.handleEvent({ id: "f1", event: "follow", name: "Anna", at: s.now.t }), true);
  assert.equal(s.overlay.handleEvent({ id: "r1", event: "raid", name: "Kanal", viewers: 12, at: s.now.t }), true);
  const ev = s.events("message"); assert.equal(ev.length, 2);
  assert.deepEqual(ev[0], { id: "f1", kind: "event", event: "follow", name: "Anna", viewers: null });
  assert.deepEqual(ev[1], { id: "r1", kind: "event", event: "raid", name: "Kanal", viewers: 12 });
});
test("Ereigniskarten: Schalter, Dopplungen, ungültige und ältere Ereignisse", () => {
  const s = setup();
  assert.equal(s.overlay.handleEvent({ id: "f1", event: "follow", name: "Anna", at: s.now.t }), true);
  assert.equal(s.overlay.handleEvent({ id: "f1", event: "follow", name: "Anna", at: s.now.t }), false, "gleiche Kennung nur einmal");
  assert.equal(s.overlay.handleEvent({ id: "x", event: "sub", name: "A" }), false);
  assert.equal(s.overlay.handleEvent({ id: "x y", event: "follow", name: "A" }), false);
  assert.equal(s.overlay.handleEvent({ id: "f2", event: "follow", name: "  ‮ " }), false);
  assert.equal(s.overlay.handleEvent({ id: "f3", event: "follow", name: "Alt", at: s.now.t - MAX_AGE_MS * 4 - 1 }), false);
  s.overlay.configure({ followCards: false });
  assert.equal(s.overlay.handleEvent({ id: "f4", event: "follow", name: "B", at: s.now.t }), false);
  assert.equal(s.overlay.handleEvent({ id: "r2", event: "raid", name: "C", viewers: 3, at: s.now.t }), true);
  s.overlay.configure({ raidCards: false });
  assert.equal(s.overlay.handleEvent({ id: "r3", event: "raid", name: "D", viewers: 3, at: s.now.t }), false);
  assert.throws(() => s.overlay.configure({ raidCards: "ja" }));
});
test("Ereigniskarten: aus EventSub-Daten gebaut, Zuschauerzahl geprüft, Karten bleiben im Verlauf und lassen sich leeren", () => {
  const c = core.compactEvent("raid", { from_broadcaster_user_name: "<i>Kanal</i>", viewers: "x" }, "r9", 5);
  assert.equal(c.viewers, null); assert.equal(c.name, "<i>Kanal</i>", "Name bleibt Text, wird im Overlay nur per textContent gesetzt");
  assert.equal(core.compactEvent("follow", { user_name: "Anna", user_login: "anna" }, "f9", 5).name, "Anna");
  assert.equal(core.compactEvent("sub", {}, "z", 1), null);
  const s = setup(); s.overlay.handleEvent({ id: "f1", event: "follow", name: "Anna", at: s.now.t });
  const got = [], res = Object.assign(new EventEmitter(), { writableLength: 0, writeHead() {}, write: f => got.push(f), end() {} });
  s.overlay.addSseClient(res, new EventEmitter(), "7.7.7.7"); assert.equal(JSON.parse(got[1].split("data: ")[1])[0].event, "follow");
  s.overlay.handleDelete({ kind: "clear" }); assert.equal(s.events("clear").length, 1);
});
test("Ereigniskarten: Verdrahtung (Raid wird gemeldet, Web hört auf Follow und Raid) und Seite nutzt nur Text und lokale Symbole", () => {
  const rt = fs.readFileSync("shared/twitch-runtime.js", "utf8"), web = fs.readFileSync("app/server.js", "utf8");
  assert.match(rt, /twitchEvents\.emit\("raid"/); assert.ok(web.includes('twitchEvents.on("raid","Chat-Overlay-Raid"')); assert.ok(web.includes('twitchEvents.on("follow","Chat-Overlay-Follow"'));
  const js = fs.readFileSync("public/chat-overlay.js", "utf8"), html = fs.readFileSync("public/chat-overlay.html", "utf8");
  assert.match(js, /function buildCard/); assert.doesNotMatch(js, /innerHTML/);
  for (const f of ["herz", "raid"]) { assert.ok(fs.existsSync(`public/chat-overlay-icons/${f}.png`), f); assert.ok(html.includes(`/chat-overlay-icons/${f}.png`), f); }
  assert.match(fs.readFileSync("public/app.js", "utf8"), /coFollowCards[\s\S]*coRaidCards/);
});
