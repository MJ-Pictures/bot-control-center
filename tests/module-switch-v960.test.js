// 9.6.0: Moderation getrennt nach System (Twitch-Chat-Filter, Wortfilter, Discord-Moderation),
// verschärfte Warnung, Wortfilter je Plattform (Seite + Event-Profile + Discord-Steuerstand).
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const reg = require("../shared/modules");
const core = require("../shared/event-profile-core");
const {createModuleStateClient} = require("../shared/module-state-client");
const web = fs.readFileSync("app/server.js", "utf8");
const rt = fs.readFileSync("shared/twitch-runtime.js", "utf8");
const dc = fs.readFileSync("discord-app/discord-server.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");

test("Registrierung: drei Moderationsmodule, Standard an, als Schutzfunktion markiert; Notfallmodus gehört nicht dazu", () => {
  const ids = ["twitchChatFilter", "wordFilter", "discordModeration"];
  const plat = {twitchChatFilter: "twitch", wordFilter: "both", discordModeration: "discord"};
  for (const id of ids) {
    const m = reg.getModule(id);
    assert.ok(m, id);
    assert.equal(m.defaultEnabled, true);
    assert.equal(m.critical, true);
    assert.equal(m.platform, plat[id]);
    assert.match(m.offNote, /^Achtung:/);
  }
  assert.ok(!reg.MODULES.some(m => m.tabs.includes("discordEmergency")), "Notfallmodus bleibt immer verfügbar");
  assert.match(reg.getModule("discordModeration").offNote, /Notfallmodus/);
  const d = reg.describeModules({});
  assert.equal(d.find(x => x.id === "wordFilter").critical, true);
  assert.equal(d.find(x => x.id === "giveaway").critical, false);
});

test("routeModule: Wortfilter-Schnittstellen gehören zum Modul; Discord-Moderationsschnittstellen bleiben offen (Protokoll & Test)", () => {
  assert.deepEqual(reg.routeModule("/api/word-filter"), {module: "wordFilter", kind: "api"});
  assert.deepEqual(reg.routeModule("/api/word-filter/active"), {module: "wordFilter", kind: "api"});
  assert.equal(reg.routeModule("/api/discord/moderation"), null);
  assert.equal(reg.routeModule("/api/discord/moderation/sanctions"), null);
  const r = reg.createModuleRegistry([{id: "x", label: "X", requires: [], tabs: [], apiPaths: ["/api/genau"], offNote: ""}]);
  assert.deepEqual(r.routeModule("/api/genau"), {module: "x", kind: "api"});
  assert.equal(r.routeModule("/api/genau/mehr"), null, "apiPaths = nur genauer Pfad");
});

test("Wortfilter je Plattform: Standard an, Modul aus schlägt alles, Plattform-Schalter einzeln", () => {
  const s = {};
  reg.normalizeWordFilterActive(s);
  assert.deepEqual(s.wordFilterActive, {twitch: {enabled: true}, discord: {enabled: true}});
  assert.equal(reg.wordFilterActiveFor({}, "twitch"), true, "ohne Angabe an");
  assert.equal(reg.wordFilterActiveFor({wordFilterActive: {twitch: {enabled: false}}}, "twitch"), false);
  assert.equal(reg.wordFilterActiveFor({wordFilterActive: {twitch: {enabled: false}}}, "discord"), true);
  assert.equal(reg.wordFilterActiveFor({modules: {wordFilter: false}}, "discord"), false);
  const t = {wordFilterActive: {twitch: {enabled: "nein"}, fremd: 1}};
  reg.normalizeWordFilterActive(t);
  assert.deepEqual(t.wordFilterActive, {twitch: {enabled: true}, discord: {enabled: true}});
});

test("Event-Profile: Wortfilter Twitch und Discord als eigene Schalter, Chat-Filter am Modul", () => {
  const sw = Object.fromEntries(core.SWITCHES.map(x => [x.key, x]));
  assert.equal(sw.wordFilterTwitch.module, "wordFilter");
  assert.equal(sw.wordFilterDiscord.module, "wordFilter");
  for (const k of ["modLinks", "modEmotes", "modSymbols", "modCaps"]) assert.equal(sw[k].module, "twitchChatFilter", k);
  const live = () => ({settings: {moderation: {links: {enabled: true}}, wordFilterActive: {twitch: {enabled: true}, discord: {enabled: true}}}, extras: {}});
  const snap = core.capture(live());
  snap.switches.wordFilterTwitch.enabled = false;
  snap.switches.modLinks.enabled = false;
  const l = live();
  core.apply(l, snap);
  assert.equal(l.settings.wordFilterActive.twitch.enabled, false, "Profil schaltet Twitch-Wortfilter aus");
  assert.equal(l.settings.wordFilterActive.discord.enabled, true, "Discord bleibt");
  assert.equal(l.settings.moderation.links.enabled, false, "und den Link-Filter");
  const labels = core.describe(live(), snap).flatMap(g => g.items.map(x => x.label));
  assert.ok(labels.includes("Wortfilter (Twitch)") && labels.includes("Wortfilter (Discord)"));
});

test("Event-Profile: ältere Profile ohne Wortfilter-Schalter übernehmen den aktuellen Stand; fehlender Stand gilt als an", () => {
  const old = {version: 2, lists: {}, switches: {modLinks: {enabled: true}}};
  const n = core.normalize(old, {settings: {}, extras: {}}).snapshot;
  assert.deepEqual(n.switches.wordFilterTwitch, {enabled: true});
  assert.deepEqual(n.switches.wordFilterDiscord, {enabled: true});
  assert.deepEqual(core.capture({settings: {}, extras: {}}).switches.wordFilterDiscord, {enabled: true});
});

test("Event-Profile: Modul aus → Schalter der Moderationsmodule werden übersprungen", () => {
  const snap = core.capture({settings: {moderation: {links: {enabled: true}}, wordFilterActive: {twitch: {enabled: true}, discord: {enabled: true}}}, extras: {}});
  snap.switches.modLinks.enabled = false;
  snap.switches.wordFilterDiscord.enabled = false;
  const l = {settings: {moderation: {links: {enabled: true}}, wordFilterActive: {twitch: {enabled: true}, discord: {enabled: true}}}, extras: {}};
  core.apply(l, snap, {moduleOff: id => id === "twitchChatFilter" || id === "wordFilter"});
  assert.equal(l.settings.moderation.links.enabled, true);
  assert.equal(l.settings.wordFilterActive.discord.enabled, true);
});

test("Twitch-Bot: Chat-Filter am Modul, Wortfilter (zentral und Legacy) an Modul + Twitch-Schalter", () => {
  assert.match(rt, /if \(!moderationExempt && isModuleEnabled\(settings, "twitchChatFilter"\)\) \{\n    const linkSettings = moderation\.links;/);
  assert.match(rt, /const wordFilterOnTwitch=wordFilterActiveFor\(settings,"twitch"\);\n  if\(pgStore\.enabled && !moderationExempt && wordFilterOnTwitch\)\{/);
  assert.match(rt, /if\(wordFilterOnTwitch && !wordFilterCentralReady\(\) && !centralWordFilterMatched && !moderationExempt\) for \(const rawItem of settings\.blockedWords/);
  assert.equal((rt.match(/matchWordFilter\(compiled,"twitch",msg\)/g) || []).length, 1);
});

test("Discord-Bot: Spam-Schutz und Link-Filter am Modul Discord-Moderation; Wortfilter an Modul + Discord-Schalter", () => {
  assert.match(dc, /const autoModerationOn=moduleState\.isOn\("discordModeration"\);/);
  assert.match(dc, /const wordFilterOnDiscord=moduleState\.isOn\("wordFilter"\)&&moduleState\.feature\("wordFilterDiscord",true\);/);
  assert.match(dc, /if\(autoModerationOn&&await handleSpamProtect\(message\)\)return;/);
  assert.match(dc, /if\(autoModerationOn&&!isStaffLinkExempt\(message\)\)\{\n    const blockedLinks=/);
  assert.match(dc, /if\(wordFilterOnDiscord&&pgStore\.enabled&&!isStaffLinkExempt\(message\)\)\{\n    const hit=matchWordFilter/);
  assert.match(dc, /if\(wordFilterOnDiscord && !wordFilterCentralReady && !centralWordFilterMatched/);
  assert.equal((dc.match(/await handleSpamProtect\(/g) || []).length, 1);
  assert.match(dc, /req\.method==="PUT"&&!moduleState\.isOn\("discordModeration"\)\)\{res\.statusCode=409/);
  assert.match(dc, /if\(!moduleState\.isOn\("wordFilter"\)\)\{if\(autocomplete\)/, "/add bei ausgeschaltetem Wortfilter");
  assert.match(dc, /moduleState\.set\(body\?\.modules,"push",body\?\.features\)/);
});

test("Steuerstand-Client: Schalter (features) werden übernommen, gespeichert und haben einen sicheren Rückfall", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ms960-")), "s.json");
  const c = createModuleStateClient({url: "http://web:3000", secret: "x".repeat(40), file, intervalMs: 0,
    fetchImpl: async () => ({ok: true, json: async () => ({ok: true, modules: {}, features: {wordFilterDiscord: false, "böse key": true, n: 1}})})});
  assert.equal(c.feature("wordFilterDiscord", true), true, "vor dem Abgleich: Rückfall");
  await c.refresh();
  assert.equal(c.feature("wordFilterDiscord", true), false);
  assert.deepEqual(c.snapshot().features, {wordFilterDiscord: false});
  const d = createModuleStateClient({file});
  d.load();
  assert.equal(d.feature("wordFilterDiscord", true), false, "aus der Datei nach Neustart");
  const changes = [];
  const e = createModuleStateClient({onChange: () => changes.push(1)});
  e.set({}, "push", {wordFilterDiscord: true});
  e.set({}, "push", {wordFilterDiscord: false});
  e.set({}, "push");
  assert.equal(changes.length, 2, "Änderung nur an den Schaltern löst onChange aus; ohne features bleibt der Stand");
  assert.equal(e.feature("wordFilterDiscord"), false);
});

test("Weboberfläche: Steuerstand mit features, Push nach Modulschalter, Event-Profil und Wortfilter-Schalter", () => {
  assert.match(web, /function controlFeatures\(settings\)\{return \{wordFilterDiscord:wordFilterActiveFor\(settings,"discord"\)\};\}/);
  assert.match(web, /return json\(res,200,\{ok:true,modules:s\.modules,features:controlFeatures\(s\)\}\);/);
  assert.match(web, /pushControlStateToDiscord\("Modulschalter"\);/);
  assert.match(web, /function writeLiveProfileState\(live\) \{\n  writeJson\(FILES\.settings,live\.settings\);\n  pushControlStateToDiscord\("Event-Profil"\);/);
  assert.match(web, /if\(platform==="discord"\)pushControlStateToDiscord\("Wortfilter Discord"\);/);
  assert.match(web, /normalizeModuleSettings\(settings\);normalizeWordFilterActive\(settings\);return settings;/);
});

test("Weboberfläche: Wortfilter-Schalter prüft Rechte je Plattform; Einstellungen ausgeschalteter Module bleiben unverändert", () => {
  const i = web.indexOf('u.pathname === "/api/word-filter/active" && req.method === "PUT"');
  const block = web.slice(i, i + 1400);
  assert.match(block, /platform==="twitch"\?\["twitch\.moderation\.edit","twitch\.blocked\.edit"\]:\["discord\.moderation\.edit"\]/);
  assert.match(block, /typeof body\?\.enabled!=="boolean"/);
  assert.match(block, /word-filter\.platform\.enabled/);
  assert.match(web, /if\(isModuleEnabled\(next,"twitchChatFilter"\)\)set\("moderation","twitch\.moderation\.edit"\);/);
  assert.match(web, /if\(isModuleEnabled\(next,"wordFilter"\)\)set\("blockedWords","twitch\.blocked\.edit"\);/);
});

test("Oberfläche: Reiter am Modul, Notfallmodus ohne Modul, verschärfte Bestätigung mit Eintippen", () => {
  assert.match(ui, /\{tab:"moderation",label:"Chat-Filter",capability:"twitch\.moderation\.view",module:"twitchChatFilter"\}/);
  assert.equal((ui.match(/\{tab:"wordFilter",[^}]*module:"wordFilter"\}/g) || []).length, 2);
  assert.match(ui, /\{tab:"blocked",label:"Legacy-Wortliste",capability:"twitch\.blocked\.view",module:"wordFilter"\}/);
  assert.match(ui, /\{tab:"discordModeration",label:"Moderation",capability:"discord\.moderation\.view",module:"discordModeration"\}/);
  assert.doesNotMatch(ui, /\{tab:"discordEmergency"[^}]*module:/);
  assert.match(ui, /typeToConfirm:mod\.label/);
  assert.match(ui, /if\(value&&\$\("confirmYes"\)\?\.disabled\)return;/);
  assert.match(ui, /data-wf-active="\$\{p\}"/);
});

test("Verschärfte Bestätigung: Knopf erst frei, wenn der Name genau stimmt", () => {
  // askConfirm mit einer kleinen DOM-Attrappe ausführen.
  const els = {};
  const mk = id => (els[id] = {id, textContent: "", disabled: false, value: "", classList: {toggle() {}, remove() {}, add() {}}, focus() {}, listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; }, after(n) { els[n.id] = n; n._inserted = true; }, remove() { delete els[this.id]; }, set innerHTML(h) { mk("confirmTypeInput"); }});
  ["confirmModal", "confirmYes", "confirmNo", "confirmTitle", "confirmText"].forEach(mk);
  const ctx = {esc: x => x, document: {createElement: () => ({id: "", className: "", set innerHTML(h) { mk("confirmTypeInput"); }, remove() { delete els.confirmTypeWrap; }})},
    $: id => els[id], confirmResolver: null};
  vm.createContext(ctx);
  const src = ui.slice(ui.indexOf("function askConfirm("), ui.indexOf("// 8.9.7: askDelete"));
  vm.runInContext(src.replace(/confirmResolver=resolve/g, "globalThis.confirmResolver=resolve"), ctx);
  ctx.askConfirm({title: "t", text: "x", typeToConfirm: "Wortfilter"});
  assert.equal(els.confirmYes.disabled, true);
  const input = els.confirmTypeInput;
  input.value = "wortfilter"; input.listeners.input();
  assert.equal(els.confirmYes.disabled, true, "Groß-/Kleinschreibung zählt");
  input.value = " Wortfilter "; input.listeners.input();
  assert.equal(els.confirmYes.disabled, false);
});
