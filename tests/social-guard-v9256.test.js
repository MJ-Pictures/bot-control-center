"use strict";
// 9.25.6: TikTok-Linkprüfung, Altersgrenze und Zeitangaben in der Veröffentlichungsliste.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { isTooOld, normalizeMaxAgeHours, checkTikTokLink, decideSocialItem, SOCIAL_LINK_MAX_TRIES } = require("../discord-app/social-guard");

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

(async () => {
  // Altersgrenze
  const now = Date.parse("2026-11-21T12:00:00Z");
  assert.strictEqual(isTooOld({ publishedAt: "2026-11-19T11:00:00Z" }, 48, now), true);
  assert.strictEqual(isTooOld({ publishedAt: "2026-11-20T13:00:00Z" }, 48, now), false);
  assert.strictEqual(isTooOld({ publishedAt: "2020-01-01T00:00:00Z" }, 0, now), false, "0 = unbegrenzt");
  assert.strictEqual(isTooOld({ publishedAt: null }, 48, now), false, "ohne Datum nichts verwerfen");
  assert.strictEqual(normalizeMaxAgeHours("abc", 48), 48);
  assert.strictEqual(normalizeMaxAgeHours(-5, 48), 0);
  assert.strictEqual(normalizeMaxAgeHours(99999, 48), 720);
  assert.strictEqual(normalizeMaxAgeHours(12.4, 48), 12);

  // Linkprüfung
  const ok = await checkTikTokLink("https://www.tiktok.com/@x/video/1", { fetchImpl: async () => resp(200, { title: "t", html: "<blockquote>" }) });
  assert.deepStrictEqual(ok, { ok: true });
  let calledUrl = "";
  await checkTikTokLink("https://www.tiktok.com/@x/video/1?a=b&c=d", { fetchImpl: async u => { calledUrl = u; return resp(200, { title: "t" }); } });
  assert(calledUrl.startsWith("https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com"), "Link wird kodiert übergeben");
  const gone = await checkTikTokLink("https://www.tiktok.com/@x/video/1", { fetchImpl: async () => resp(400, { code: 1 }) });
  assert.strictEqual(gone.ok, false); assert.strictEqual(gone.definitive, true);
  const notFound = await checkTikTokLink("https://www.tiktok.com/@x/video/1", { fetchImpl: async () => resp(404, "nope") });
  assert.strictEqual(notFound.definitive, true);
  const limited = await checkTikTokLink("https://www.tiktok.com/@x/video/1", { fetchImpl: async () => resp(429, "") });
  assert.strictEqual(limited.definitive, false);
  const server = await checkTikTokLink("https://www.tiktok.com/@x/video/1", { fetchImpl: async () => resp(503, "") });
  assert.strictEqual(server.definitive, false);
  const net = await checkTikTokLink("https://www.tiktok.com/@x/video/1", { fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  assert.strictEqual(net.ok, false); assert.strictEqual(net.definitive, false);
  const odd = await checkTikTokLink("https://www.tiktok.com/@x/video/1", { fetchImpl: async () => resp(200, "<html>Login</html>") });
  assert.strictEqual(odd.ok, false); assert.strictEqual(odd.definitive, false, "unerwartete Antwort ist kein Beleg");
  const none = await checkTikTokLink("", { fetchImpl: async () => { throw new Error("darf nicht aufgerufen werden"); } });
  assert.strictEqual(none.definitive, true);
  const http = await checkTikTokLink("http://www.tiktok.com/x", { fetchImpl: async () => { throw new Error("nicht aufrufen"); } });
  assert.strictEqual(http.ok, false);

  // Entscheidung
  const cfg = { checkLink: true, maxAgeHours: 48 };
  const item = { id: "1", url: "https://www.tiktok.com/@x/video/1", publishedAt: "2026-11-21T10:00:00Z" };
  const good = async () => ({ ok: true });
  const dead = async () => ({ ok: false, definitive: true, reason: "TikTok-Link nicht erreichbar (HTTP 400)" });
  const flaky = async () => ({ ok: false, definitive: false, reason: "TikTok-Prüfung vorübergehend nicht möglich (HTTP 503)" });
  assert.strictEqual((await decideSocialItem({ item, cfg, nowMs: now, checkLink: good })).action, "send");
  assert.strictEqual((await decideSocialItem({ item: { ...item, publishedAt: "2026-11-10T00:00:00Z" }, cfg, nowMs: now, checkLink: good })).action, "skip-old");
  const w1 = await decideSocialItem({ item, cfg, tries: 0, nowMs: now, checkLink: dead });
  assert.strictEqual(w1.action, "wait"); assert.strictEqual(w1.tries, 1); assert(w1.reason.includes(`1/${SOCIAL_LINK_MAX_TRIES}`));
  assert.strictEqual((await decideSocialItem({ item, cfg, tries: 1, nowMs: now, checkLink: dead })).action, "wait");
  const w3 = await decideSocialItem({ item, cfg, tries: SOCIAL_LINK_MAX_TRIES - 1, nowMs: now, checkLink: dead });
  assert.strictEqual(w3.action, "skip-link");
  const f3 = await decideSocialItem({ item, cfg, tries: SOCIAL_LINK_MAX_TRIES - 1, nowMs: now, checkLink: flaky });
  assert.strictEqual(f3.action, "send"); assert(f3.note, "Hinweis bei Versand ohne Prüfergebnis");
  assert.strictEqual((await decideSocialItem({ item, cfg: { ...cfg, checkLink: false }, nowMs: now, checkLink: dead })).action, "send", "Schalter aus = keine Prüfung");
  assert.strictEqual((await decideSocialItem({ item, cfg, nowMs: now })).action, "send", "ohne Prüfer (Instagram) unverändert");
  assert.strictEqual((await decideSocialItem({ item: { ...item, publishedAt: "2020-01-01T00:00:00Z" }, cfg: { checkLink: false, maxAgeHours: 0 }, nowMs: now })).action, "send", "Instagram-Standard unverändert");

  // Einbindung im Server und in der Oberfläche
  const srv = read("discord-app/discord-server.js");
  assert(srv.includes('require("./social-guard")'));
  const defaults = srv.slice(srv.indexOf("const DEFAULT_SOCIAL_CONFIG"), srv.indexOf("const DEFAULT_SOCIAL_STATE"));
  const igPart = defaults.slice(defaults.indexOf("instagram:"), defaults.indexOf("tiktok:"));
  const ttPart = defaults.slice(defaults.indexOf("tiktok:"));
  assert(/checkLink:true,\s*maxAgeHours:48/.test(ttPart), "TikTok-Standard: Prüfung an, 48 h");
  assert(/checkLink:false,\s*maxAgeHours:0/.test(igPart), "Instagram unverändert");
  assert(srv.includes("const socialLinkCheckers={tiktok:"), "nur TikTok hat einen Linkprüfer");
  assert(!/socialLinkCheckers=\{[^}]*instagram/.test(srv));
  assert(srv.includes('row.status==="waiting"'), "wartende Beiträge werden erneut geprüft");
  assert(srv.includes('"waiting","skipped"'), "Statusfilter kennt neue Status");
  const ui = read("public/app.js");
  assert(ui.includes("data-social-checklink"));
  assert(ui.includes("data-social-maxage"));
  assert(ui.includes("Wartet auf Link") && ui.includes("Übersprungen"));
  assert(ui.includes("Erkannt ") && ui.includes("Gesendet "));
  const setup = read("SOCIAL-MEDIA-SETUP.md");
  assert(setup.includes("Linkprüfung und Altersgrenze"));
  assert(JSON.parse(read("public/changelog.json")).versions.some(v => v.version === "9.25.6"), "Changelog-Eintrag 9.25.6");
  console.log("social-guard-v9256.test.js: OK");
})().catch(e => { console.error(e); process.exit(1); });
