// 9.9.0: Meldungen und Kanalzeiten hängen am Modulschalter (Ende der zweiten Welle).
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const reg = require("../shared/modules");
const dc = fs.readFileSync("discord-app/discord-server.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");

test("Registrierung: Meldungen und Kanalzeiten (Discord, Standard an); Kern bleibt ohne Modul", () => {
  for (const id of ["discordReports", "discordChannelTimes"]) {
    const m = reg.getModule(id);
    assert.ok(m, id);
    assert.equal(m.platform, "discord");
    assert.equal(m.defaultEnabled, true);
  }
  assert.match(reg.getModule("discordChannelTimes").offNote, /bleiben genau in dem Zustand/);
  assert.deepEqual(reg.routeModule("/api/discord/reports/action"), {module: "discordReports", kind: "api"});
  assert.deepEqual(reg.routeModule("/api/discord/channel-times/maintenance"), {module: "discordChannelTimes", kind: "api"});
  // Kern laut Entscheidung Mario (16.11.2026): Freischaltung, Notfallmodus, Sanktionen, Userhistorie, Protokoll & Test.
  for (const p of ["/api/discord/onboarding", "/api/discord/verify", "/api/discord/emergency", "/api/discord/moderation/sanctions", "/api/discord/moderation/history"])
    assert.equal(reg.routeModule(p), null, p);
  const tabs = reg.MODULES.flatMap(m => m.tabs);
  for (const t of ["discordOnboarding", "discordEmergency", "discordSanctions", "discordUserHistory", "discordModerationLog"]) assert.ok(!tabs.includes(t), t);
});

test("Discord-Bot: Kanalzeiten ruhen bei „aus“ (Zeitplan, Start, Ende des Notfallmodus)", () => {
  assert.match(dc, /try\{if\(!moduleState\.isOn\("discordChannelTimes"\)\)\{\}else if\(channelTimesState\.maintenance\?\.active\)await reconcileMaintenance\(\);else await reconcileChannelTimes\(\{source:"scheduler"/);
  assert.match(dc, /setTimeout\(\(\)=>\{if\(!moduleState\.isOn\("discordChannelTimes"\)\)return;reconcileChannelTimes\(\{source:"emergency-end"/);
  assert.match(dc, /setTimeout\(\(\)=>\{if\(!moduleState\.isOn\("discordChannelTimes"\)\)return; \/\/ 9\.9\.0\n\(channelTimesState\.maintenance\?\.active\?reconcileMaintenance\(\):reconcileChannelTimes\(\{source:"startup"/);
});

test("Discord-Bot: Verwaltung /reports* und /channel-times* bei „aus“ gesperrt (nach Auth, vor den Routen)", () => {
  const auth = dc.indexOf("if(!serviceAuthValid(req))");
  const ct = dc.indexOf('(requestUrl.pathname==="/channel-times"||requestUrl.pathname.startsWith("/channel-times/"))&&!moduleState.isOn("discordChannelTimes")');
  const rp = dc.indexOf('(requestUrl.pathname==="/reports"||requestUrl.pathname.startsWith("/reports/"))&&!moduleState.isOn("discordReports")');
  assert.ok(auth > 0 && auth < ct && ct < dc.indexOf('requestUrl.pathname==="/channel-times"&&req.method==="GET"'));
  assert.ok(auth < rp && rp < dc.indexOf('requestUrl.pathname==="/reports"&&req.method==="GET"'));
});

test("Discord-Bot: Melde-Befehle und -Knöpfe antworten bei „aus“ „derzeit deaktiviert“, andere bleiben unberührt", async () => {
  const start = dc.indexOf("function reportInteractionOf(interaction){");
  const head = dc.slice(start, dc.indexOf("\n  const type=Number(interaction.type);\n  if(type===2){", dc.indexOf("async function handleReportInteraction(interaction){")));
  const replies = [];
  const ctx = {IDS: {guild: "G"}, on: false, moduleState: {isOn: () => ctx.on}, interactionRespond: async (i, t, b) => { replies.push(b.content); }};
  vm.createContext(ctx);
  vm.runInContext(head + "\n  return 'weiter';}", ctx);
  const cmd = (name, type) => ({type: 2, guild_id: "G", data: {name, type}});
  assert.equal(await ctx.handleReportInteraction(cmd("melden", 1)), undefined);
  assert.match(replies.at(-1), /Meldesystem ist derzeit deaktiviert/);
  await ctx.handleReportInteraction(cmd("Nachricht melden", 3));
  await ctx.handleReportInteraction({type: 3, guild_id: "G", data: {custom_id: "report_open_general"}});
  await ctx.handleReportInteraction({type: 5, guild_id: "G", data: {custom_id: "report_submit:general:spam"}});
  assert.equal(replies.length, 4);
  await ctx.handleReportInteraction(cmd("rang", 1));
  await ctx.handleReportInteraction({type: 3, guild_id: "G", data: {custom_id: "level:share"}});
  assert.equal(replies.length, 4, "fremde Interaktionen bekommen keine Antwort");
  ctx.on = true;
  assert.equal(await ctx.handleReportInteraction(cmd("melden", 1)), "weiter");
  assert.equal(replies.length, 4);
});

test("Oberfläche: Reiter, Schnellzugriffe und Kennzahl hängen am Modul", () => {
  assert.equal((ui.match(/\{tab:"discordReports",label:"Meldungen",capability:"discord\.reports\.view",module:"discordReports"\}/g) || []).length, 2);
  assert.match(ui, /\{tab:"discordChannelTimes",label:"Kanalzeiten",capability:"discord\.channel-times\.view",module:"discordChannelTimes"\}/);
  assert.match(ui, /hasCapability\("discord\.reports\.view"\)&&moduleEnabledUi\("discordReports"\)\)quick\.push/);
  assert.match(ui, /hasCapability\("discord\.channel-times\.view"\)&&moduleEnabledUi\("discordChannelTimes"\)\)quick\.push/);
  assert.match(ui, /data-dashboard-tab="discordReports" \$\{hasCapability\("discord\.reports\.view"\)&&moduleEnabledUi\("discordReports"\)\?"":"disabled"\}/);
});
