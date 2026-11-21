// 9.5.0: Levelsystem / Dienstgrade (Discord-Minigame) hängt am Modulschalter.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const reg = require("../shared/modules");
const dc = fs.readFileSync("discord-app/discord-server.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");

test("Registrierung: Levelsystem ist ein Discord-Modul, Standard an, mit allen sechs Minigame-Reitern", () => {
  const m = reg.getModule("levelsystem");
  assert.equal(m.platform, "discord");
  assert.equal(m.defaultEnabled, true);
  assert.equal(m.tabs.length, 6);
  assert.match(m.offNote, /niemand verliert seine Rang-Rolle/);
  assert.deepEqual(reg.routeModule("/api/discord/levelsystem/config"), {module: "levelsystem", kind: "api"});
  assert.deepEqual(reg.routeModule("/api/discord/members/levels"), {module: "levelsystem", kind: "api"});
  assert.equal(reg.routeModule("/api/discord/members"), null, "Mitgliederverwaltung bleibt erreichbar");
  for (const t of m.tabs) assert.match(ui, new RegExp(`\\{tab:"${t}"[^}]*module:"levelsystem"\\}`), t);
});

test("Discord-Bot: XP-Vergabe und XP-Rücknahme nur bei eingeschaltetem Modul", () => {
  assert.match(dc, /measuredLevelOperation\(\(\)=>levelModuleOn\(\)\?levelEngine\.award\(payload\.d\):\{awarded:0\}\)/);
  assert.equal((dc.match(/levelModuleOn\(\)\?levelEngine\.retract\([^)]*\):\{retracted:false\}/g) || []).length, 3);
  assert.equal((dc.match(/levelEngine\.(award|retract)\(/g) || []).length, 4, "keine ungesicherten Aufrufe");
});

test("Discord-Bot: Rollen, Slash-Command-Pflege und Topliste ruhen bei „aus“", () => {
  assert.match(dc, /const levelActive=\(\)=>levelEngine\.config\.enabled&&levelModuleOn\(\);/);
  assert.match(dc, /async function levelSyncRoles\(userId\)\{\n if\(!levelActive\(\)\)return;/);
  assert.match(dc, /async function ensureLevelCommands\(\)\{\n if\(!levelActive\(\)\)return;/);
  assert.match(dc, /async function levelPeriodicTop\(\)\{\n if\(!levelActive\(\)\|\|levelTopRunning/);
});

test("Discord-Bot: Slash-Commands und Knöpfe antworten bei „aus“ mit „derzeit deaktiviert“, andere Interaktionen bleiben unberührt", async () => {
  const i = dc.indexOf("function levelInteractionOf(i){"), j = dc.indexOf("\n", i);
  const head = dc.slice(dc.indexOf("async function levelInteraction(i){"), dc.indexOf("\nif(!levelEngine.config.enabled||i.guild_id!==IDS.guild)return false;"));
  const replies = [];
  const ctx = {on: false, IDS: {guild: "G"}, replies,
    interactionRespond: async (x, type, body) => { replies.push(body.content); }};
  vm.createContext(ctx);
  vm.runInContext(dc.slice(i, j) + "\nconst levelModuleOn=()=>on;\n" + head + "\nreturn null;}", ctx);
  const cmd = name => ({type: 2, guild_id: "G", data: {name}});
  assert.equal(await ctx.levelInteraction(cmd("rang")), true);
  assert.match(replies.at(-1), /derzeit deaktiviert/);
  assert.equal(await ctx.levelInteraction({type: 3, guild_id: "G", data: {custom_id: "level:share"}}), true, "Knöpfe ebenso");
  assert.equal(await ctx.levelInteraction(cmd("melden")), null, "fremder Befehl → normale Verarbeitung");
  assert.equal(await ctx.levelInteraction({type: 3, guild_id: "G", data: {custom_id: "report:open"}}), null);
  assert.equal(await ctx.levelInteraction({...cmd("rang"), guild_id: "anders"}), null, "anderer Server → unverändert");
  ctx.on = true;
  vm.runInContext("on=true", ctx);
  const before = replies.length;
  assert.equal(await ctx.levelInteraction(cmd("rang")), null, "an → normale Verarbeitung");
  assert.equal(replies.length, before);
});

test("Discord-Bot: Verwaltung /levelsystem* bei „aus“ gesperrt (nach Dienst-Auth, vor den Routen)", () => {
  const auth = dc.indexOf("if(!serviceAuthValid(req))");
  const block = dc.indexOf('if((requestUrl.pathname==="/levelsystem"||requestUrl.pathname.startsWith("/levelsystem/"))&&!levelModuleOn())');
  const first = dc.indexOf('requestUrl.pathname==="/levelsystem/setup"&&req.method==="GET"');
  assert.ok(auth > 0 && auth < block && block < first);
});
