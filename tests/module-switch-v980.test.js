// 9.8.0: Discord-Ankündigungen und Einladungslink hängen am Modulschalter.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const reg = require("../shared/modules");
const {createDiscordInviteService} = require("../shared/discord-invite-service");
const rt = fs.readFileSync("shared/twitch-runtime.js", "utf8");
const dc = fs.readFileSync("discord-app/discord-server.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");

test("Registrierung: Ankündigungen und Einladungslink, Plattform beide, Standard an", () => {
  for (const id of ["discordAnnouncements", "discordInvite"]) {
    const m = reg.getModule(id);
    assert.ok(m, id);
    assert.equal(m.platform, "both");
    assert.equal(m.defaultEnabled, true);
    assert.notEqual(m.critical, true);
  }
  assert.deepEqual(reg.routeModule("/api/discord/announcements/test"), {module: "discordAnnouncements", kind: "api"});
  assert.deepEqual(reg.routeModule("/api/discord/invite"), {module: "discordInvite", kind: "api"});
  assert.equal(reg.routeModule("/api/discord/invites"), null);
});

test("Twitch-Bot: bei ausgeschalteten Ankündigungen wird nichts eingereiht", () => {
  const fn = rt.slice(rt.indexOf("function enqueueDiscordAnnouncement(type,key,payload){"), rt.indexOf("let discordBridgeBusy"));
  assert.match(fn, /if\(!isModuleEnabled\(readJson\(FILES\.settings, DEFAULT_SETTINGS\),"discordAnnouncements"\)\)return;\n  const state=readDiscordBridgeState\(\);/);
});

test("Discord-Bot: Ankündigungen werden bei „aus“ angenommen, aber nicht gepostet; Einladungslink-Verwaltung gesperrt", () => {
  const ingest = dc.slice(dc.indexOf('if(req.url==="/announcements/ingest"&&req.method==="POST"){'));
  assert.ok(ingest.indexOf('moduleState.isOn("discordAnnouncements")') < ingest.indexOf("await ingestAnnouncement("));
  assert.match(ingest.slice(0, 600), /status:"module_disabled"/);
  assert.match(dc, /isActive:\(\)=>moduleState\.isOn\("discordInvite"\)\}\);/);
  assert.match(dc, /requestUrl\.pathname\.startsWith\("\/invite"\)&&requestUrl\.pathname!=="\/invite\/twitch"&&!moduleState\.isOn\("discordInvite"\)/);
});

function service(active, saved = {enabled: true, channelId: "C", status: "valid", inviteUrl: "https://discord.gg/abc", code: "abc"}) {
  let calls = 0;
  const s = createDiscordInviteService({guildId: "G", read: () => saved, write: () => {}, api: async () => { calls++; throw new Error("kein Netz"); }, isActive: () => active.value});
  return {s, calls: () => calls};
}

test("Einladungslink-Dienst: bei „aus“ meldet Twitch „nicht aktiv“, keine Prüfung beim Start", async () => {
  const active = {value: false};
  const {s, calls} = service(active);
  assert.deepEqual(s.twitch(), {enabled: false, invite: null, moduleDisabled: true});
  s.start();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls(), 0, "keine Discord-Abfrage bei ausgeschaltetem Modul");
  s.stop();
  active.value = true;
  // Nach dem Start gilt ein gespeicherter Link als „ungeprüft“ (bestehendes Verhalten) → Ersatztext bis zur Prüfung.
  assert.deepEqual(s.twitch(), {enabled: true, invite: null});
});

test("Einladungslink-Dienst: ohne isActive bleibt das bisherige Verhalten", () => {
  const s = createDiscordInviteService({guildId: "G", read: () => ({enabled: true, channelId: "C"}), write: () => {}, api: async () => ({})});
  assert.deepEqual(s.twitch(), {enabled: true, invite: null});
  const off = createDiscordInviteService({guildId: "G", read: () => ({enabled: false}), write: () => {}, api: async () => ({})});
  assert.deepEqual(off.twitch(), {enabled: false, invite: null});
});

test("Oberfläche: Reiter am Modul", () => {
  assert.match(ui, /\{tab:"discordInvite",label:"Einladungslink",capability:"discord\.channels\.view",module:"discordInvite"\}/);
  assert.match(ui, /\{tab:"discordAnnouncements",label:"Ankündigungen",capability:"discord\.announcements\.view",module:"discordAnnouncements"\}/);
});
