"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSubathon } = require("../app/subathon");
const { twitchAccountDefs, SUBATHON_CHANNEL_SCOPES } = require("../shared/twitch-accounts");
const { MODULES } = require("../shared/modules");

function make(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-"));
  let ended = 0;
  const sa = createSubathon({ file: path.join(dir, "s.json"), beforeStart: async () => { ended++; }, ...extra });
  return { sa, ended: () => ended };
}
const input = (o = {}) => ({ name: "T", startDurationSeconds: 3600, rates: { sub1: 300, sub2: 600, sub3: 1500, bitsPer100: 60, follow: 30 }, counting: { subs: true, gifts: true, bits: true, follows: false }, ...o });
async function running(o) { const m = make(); await m.sa.createEvent(input(o), "t"); await m.sa.action("start", {}, "t"); return m; }
const rem = async (sa) => (await sa.getAdminState()).event.remainingSeconds;

test("Start beendet laufenden Followathon (beforeStart wird aufgerufen)", async () => {
  const m = await running(); assert.equal(m.ended(), 1);
});
test("Abo, Resub, Geschenkabos und Bits verlängern die Zeit", async () => {
  const { sa } = await running();
  await sa.handleSubscribe({ tier: "1000", user_id: "1", user_name: "a" }, { message_id: "m1" });
  await sa.handleResub({ tier: "2000", user_id: "2", user_name: "b" }, { message_id: "m2" });
  await sa.handleGift({ tier: "1000", total: 5, user_name: "c" }, { message_id: "m3" });
  await sa.handleCheer({ bits: 200, user_name: "d" }, { message_id: "m4" });
  const e = (await sa.getAdminState()).event;
  assert.equal(e.creditedSeconds, 300 + 600 + 1500 + 120);
  assert.deepEqual(e.tallies, { subs: 2, gifts: 5, bits: 200, follows: 0 });
});
test("Empfänger geschenkter Abos werden nicht doppelt gezählt", async () => {
  const { sa } = await running();
  const r = await sa.handleSubscribe({ tier: "1000", is_gift: true, user_id: "9" }, { message_id: "g1" });
  assert.equal(r.decision, "gift-recipient-ignored");
  assert.equal((await sa.getAdminState()).event.creditedSeconds, 0);
});
test("Doppelte message_id wird nur einmal gezählt", async () => {
  const { sa } = await running();
  await sa.handleCheer({ bits: 100 }, { message_id: "x" });
  const r = await sa.handleCheer({ bits: 100 }, { message_id: "x" });
  assert.equal(r.decision, "duplicate-message");
  assert.equal((await sa.getAdminState()).event.creditedSeconds, 60);
});
test("Follows zählen nur, wenn eingeschaltet, und je Konto einmal", async () => {
  const off = await running();
  assert.equal((await off.sa.handleFollow({ user_id: "1" }, {})).decision, "counting-off");
  const on = await running({ counting: { subs: true, gifts: true, bits: true, follows: true } });
  await on.sa.handleFollow({ user_id: "1", user_name: "f" }, {});
  assert.equal((await on.sa.handleFollow({ user_id: "1" }, {})).decision, "duplicate-user");
  assert.equal((await on.sa.getAdminState()).event.creditedSeconds, 30);
});
test("Maximale Restzeit und Tageslimit kürzen die Gutschrift", async () => {
  const cap = await running({ maxRemainingSeconds: 3700 });
  await cap.sa.handleSubscribe({ tier: "1000" }, { message_id: "a" });
  assert.equal((await cap.sa.getAdminState()).event.creditedSeconds, 100);
  const day = await running({ dailyLimitSeconds: 400 });
  await day.sa.handleSubscribe({ tier: "1000" }, { message_id: "a" });
  await day.sa.handleSubscribe({ tier: "1000" }, { message_id: "b" });
  const e = (await day.sa.getAdminState()).event;
  assert.equal(e.creditedSeconds, 400);
  assert.ok(e.log.some(x => x.decision === "partial-credit"));
});
test("Pause, Fortsetzen, manuelle Korrektur und Ende", async () => {
  const { sa } = await running();
  await sa.action("pause", {}, "t"); assert.ok((await rem(sa)) > 3590);
  await sa.action("resume", {}, "t");
  await sa.action("adjust", { seconds: 600, direction: "subtract", reason: "x" }, "t");
  assert.ok((await rem(sa)) <= 3000);
  await sa.action("end", {}, "t");
  assert.equal((await sa.getAdminState()).event.status, "ended");
  assert.equal((await sa.handleCheer({ bits: 100 }, { message_id: "z" })).decision, "no-active-event");
});
test("Neues Event nur nach Beenden; Simulation verändert nichts", async () => {
  const { sa } = await running();
  await assert.rejects(sa.createEvent(input(), "t"), /beendet/);
  const before = (await sa.getAdminState()).event.creditedSeconds;
  const r = await sa.simulate({ kind: "bits", bits: 100 }, "t");
  assert.equal(r.creditedSeconds, 60);
  assert.equal((await sa.getAdminState()).event.creditedSeconds, before);
});
test("Twitch-Rechte werden nur mit eingeschaltetem Modul angefordert", () => {
  const off = twitchAccountDefs("kanal", null, {}), on = twitchAccountDefs("kanal", null, { subathon: true });
  const scopes = (defs) => JSON.stringify(defs);
  for (const sc of SUBATHON_CHANNEL_SCOPES) { assert.ok(!scopes(off).includes(sc)); assert.ok(scopes(on).includes(sc)); }
});
test("Modul ist standardmäßig aus und hat Reiter, Overlay und Schnittstellen", () => {
  const list = Array.isArray(MODULES) ? MODULES : Object.values(MODULES);
  const m = list.find(x => x.id === "subathon");
  assert.ok(m); assert.equal(m.defaultEnabled, false);
  assert.ok(m.overlayPages.includes("/subathon/overlay"));
});
test("Subathon-Dateien enthalten keine BWK-Begriffe", () => {
  for (const f of ["app/subathon.js", "public/subathon-overlay.js", "public/subathon-overlay.html"]) {
    const t = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(!/BWK|Behörde|Polizei|Hanno/i.test(t), f);
  }
});

// 9.20.1: Einstellungen nur vor dem Start änderbar, optionales Logo
test("Entwurf lässt sich bearbeiten, ab Start sind Einstellungen gesperrt", async () => {
  const { sa } = make();
  await sa.createEvent(input(), "t");
  await sa.updateEvent(input({ name: "Neu", startDurationSeconds: 1800, overlay: { textColor: "#ff0000", accentColor: "#00ff00", label: "MARATHON" } }), "t");
  let e = (await sa.getAdminState()).event;
  assert.equal(e.name, "Neu"); assert.equal(e.startDurationSeconds, 1800);
  assert.equal(e.overlay.textColor, "#ff0000"); assert.equal(e.overlay.label, "MARATHON");
  await sa.action("start", {}, "t");
  await assert.rejects(sa.updateEvent(input({ name: "X" }), "t"), /gesperrt/);
  await sa.action("pause", {}, "t");
  await assert.rejects(sa.updateEvent(input({ name: "X" }), "t"), /gesperrt/);
  assert.equal((await sa.getAdminState()).event.name, "Neu");
});
test("Ungültige Farben fallen auf die Standardfarben zurück", async () => {
  const { sa } = make();
  await sa.createEvent(input({ overlay: { textColor: "red;}</style>", accentColor: "#zzzzzz" } }), "t");
  const o = (await sa.getAdminState()).event.overlay;
  assert.equal(o.textColor, "#ffffff"); assert.equal(o.accentColor, "#9146ff");
});
test("Subathon-Logo: eigener Bildplatz, Overlay lädt ihn, Route zum Bearbeiten ist nur für den Inhaber", () => {
  const kit = require("../shared/image-slots");
  assert.ok(kit.isSlot("subathonLogo"));
  assert.ok(kit.FILE_RE.test("subathonLogo-0123456789ab.png"));
  assert.match(fs.readFileSync(path.join(__dirname, "..", "public/subathon-overlay.js"), "utf8"), /images\.subathonLogo/);
  const srv = fs.readFileSync(path.join(__dirname, "..", "app/server.js"), "utf8");
  assert.match(srv, /\/api\/subathon\/event\/update[\s\S]{0,120}requireGlobalOwner/);
});
