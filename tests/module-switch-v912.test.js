// 9.1.2: Ausgeschaltete Module sind auch über globale Suche, Favoriten und Direktaufruf nicht erreichbar.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const ui = fs.readFileSync("public/app.js", "utf8");
const slice = (a, b) => { const i = ui.indexOf(a), j = ui.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return ui.slice(i, j); };

function context(modules) {
  const ctx = {settings: {modules}, currentUser: {}, currentPlatform: "twitch", minigameReady: true,
    isGlobalOwner: () => true, isGlobalAdmin: () => true, hasCapability: () => true, platformAvailable: p => p === "twitch"};
  vm.createContext(ctx);
  vm.runInContext(slice("const NAV_GROUPS={", "let activeNavGroup=").replace("const NAV_GROUPS", "var NAV_GROUPS").replace("const PLATFORM_NAV", "var PLATFORM_NAV"), ctx);
  vm.runInContext(slice("function moduleEnabledUi(", "async function renderModules()"), ctx);
  vm.runInContext(slice("// 9.1.2: Modul eines Reiters", "async function loadNavFavorites()"), ctx);
  vm.runInContext(slice("function globalSearchIndex(){", "\n}\n") + "\n}", ctx);
  return ctx;
}

test("Favoriten-Prüfung: Reiter eines ausgeschalteten Moduls ist nicht erlaubt, eingeschaltet schon", () => {
  const item = {tab: "lurk", capability: "twitch.community.view", module: "lurkReturn"};
  assert.equal(context({lurkReturn: false}).navFavoriteAllowed(item, "twitch"), false);
  assert.equal(context({}).navFavoriteAllowed(item, "twitch"), false);
  assert.equal(context({lurkReturn: true}).navFavoriteAllowed(item, "twitch"), true);
  assert.equal(context({lurkReturn: false}).navFavoriteAllowed({tab: "events", capability: "twitch.community.view"}, "twitch"), true, "andere Reiter unberührt");
});

test("Globale Suche findet ausgeschaltete Module nicht, eingeschaltete schon", () => {
  const off = context({lurkReturn: false}).globalSearchIndex().map(x => x.tab);
  assert.ok(!off.includes("lurk"));
  assert.ok(off.includes("events"));
  const on = context({lurkReturn: true}).globalSearchIndex().map(x => x.tab);
  assert.ok(on.includes("lurk"));
});

test("tabModuleOf/tabModuleOff kennen den Modul-Reiter", () => {
  const c = context({lurkReturn: false});
  assert.equal(c.tabModuleOf("lurk"), "lurkReturn");
  assert.equal(c.tabModuleOf("events"), null);
  assert.equal(c.tabModuleOff("lurk"), true);
  assert.equal(c.tabModuleOff("events"), false);
  assert.equal(context({lurkReturn: true}).tabModuleOff("lurk"), false);
});

test("openNavTab öffnet den Reiter eines ausgeschalteten Moduls nicht, sondern den ersten erlaubten", () => {
  const head = slice("async function openNavTab(tab,{persist=true}={}){", "stopCommandAutoRefresh();");
  assert.match(head, /if\(tabModuleOff\(tab\)\)\{[^\n]*availableNavItems\(g\)\[0\][^\n]*tab=first\?\.tab\|\|"help";\}/);
});
