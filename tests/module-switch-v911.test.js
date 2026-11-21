// 9.1.1: Modulschalter (Administration → Integrationen → Module): Registrierung, Standardwerte,
// Abhängigkeiten, Altbestand, Server-Endpunkte, Laufzeit-Abschaltung und Oberfläche.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const reg = require("../shared/modules");
const {createModuleRegistry, MODULES, normalizeModuleSettings, isModuleEnabled, setModuleEnabled, describeModules, getModule} = reg;

test("Registrierung: Lurk-Rückkehr ist eingetragen, standardmäßig aus, mit Reiter und Hinweistext", () => {
  const m = getModule("lurkReturn");
  assert.ok(m);
  assert.equal(m.label, "Lurk-Rückkehr");
  assert.equal(m.defaultEnabled, false);
  assert.deepEqual([...m.tabs], ["lurk"]);
  assert.deepEqual([...m.requires], []);
  assert.match(m.offNote, /bleiben gespeichert/);
  assert.equal(new Set(MODULES.map(x => x.id)).size, MODULES.length, "Kennungen eindeutig");
  assert.ok(Object.isFrozen(MODULES));
});

test("Standardwerte: neue Module aus, bestehende Fachmodule an (ab 9.2.0); Normalisierung ist idempotent", () => {
  const s = {};
  normalizeModuleSettings(s);
  assert.equal(s.modules.lurkReturn, false);
  for (const m of MODULES) assert.equal(s.modules[m.id], m.defaultEnabled, m.id);
  const first = JSON.stringify(s);
  normalizeModuleSettings(s);
  assert.equal(JSON.stringify(s), first);
});

test("Normalisierung: unbekannte Schlüssel und Nicht-Boolesche Werte werden bereinigt", () => {
  const defaults = Object.fromEntries(MODULES.map(m => [m.id, m.defaultEnabled]));
  const s = {modules: {lurkReturn: "ja", gibtEsNicht: true}};
  normalizeModuleSettings(s);
  assert.deepEqual(s.modules, defaults);
  assert.ok(!("gibtEsNicht" in s.modules));
  const t = {modules: [1, 2]};
  normalizeModuleSettings(t);
  assert.deepEqual(t.modules, defaults);
  assert.equal(normalizeModuleSettings(null), null);
});

test("Altbestand: war Lurk-Rückkehr in 9.1.0 schon aktiv, bleibt es an; ausdrücklich Aus gewinnt", () => {
  const a = {lurkReturn: {enabled: true}};
  normalizeModuleSettings(a);
  assert.equal(a.modules.lurkReturn, true);
  assert.equal(isModuleEnabled({lurkReturn: {enabled: true}}, "lurkReturn"), true, "auch ohne Normalisierung");
  const b = {lurkReturn: {enabled: true}, modules: {lurkReturn: false}};
  normalizeModuleSettings(b);
  assert.equal(b.modules.lurkReturn, false);
  assert.equal(isModuleEnabled(b, "lurkReturn"), false);
  const c = {lurkReturn: {enabled: false}};
  normalizeModuleSettings(c);
  assert.equal(c.modules.lurkReturn, false);
});

test("isModuleEnabled: unbekannte Module gelten als aus, fehlende Einstellungen auch", () => {
  assert.equal(isModuleEnabled({modules: {lurkReturn: true}}, "lurkReturn"), true);
  assert.equal(isModuleEnabled({modules: {lurkReturn: false}}, "lurkReturn"), false);
  assert.equal(isModuleEnabled({}, "lurkReturn"), false);
  assert.equal(isModuleEnabled(null, "lurkReturn"), false);
  assert.equal(isModuleEnabled({modules: {x: true}}, "x"), false);
});

test("setModuleEnabled: schaltet, meldet Änderung, lehnt Unbekanntes und Ungültiges ab", () => {
  const s = {};
  assert.deepEqual(setModuleEnabled(s, "lurkReturn", true), {ok: true, changed: true});
  assert.equal(s.modules.lurkReturn, true);
  assert.deepEqual(setModuleEnabled(s, "lurkReturn", true), {ok: true, changed: false});
  assert.deepEqual(setModuleEnabled(s, "lurkReturn", false), {ok: true, changed: true});
  assert.equal(setModuleEnabled(s, "gibtEsNicht", true).ok, false);
  assert.equal(setModuleEnabled(s, "lurkReturn", "ja").ok, false);
  assert.equal(setModuleEnabled(s, "lurkReturn", 1).ok, false);
});

test("Ausschalten lässt die Moduldaten unverändert (Variante A: Daten bleiben)", () => {
  const lurk = {enabled: true, commands: "!lurk", tiers: [{id: "a", untilMinutes: 5, text: "Hallo {user}"}], fallbackText: "x"};
  const s = {lurkReturn: JSON.parse(JSON.stringify(lurk)), modules: {lurkReturn: true}};
  setModuleEnabled(s, "lurkReturn", false);
  assert.deepEqual(s.lurkReturn, lurk, "Einstellungen bleiben bestehen");
  setModuleEnabled(s, "lurkReturn", true);
  assert.deepEqual(s.lurkReturn, lurk, "nach Wiedereinschalten alles wie vorher");
});

test("Abhängigkeiten: Einschalten braucht Voraussetzungen, Ausschalten wird gesperrt, solange es gebraucht wird", () => {
  const r = createModuleRegistry([
    {id: "basis", label: "Basis", description: "", platform: "twitch", defaultEnabled: false, requires: [], tabs: [], offNote: ""},
    {id: "aufbau", label: "Aufbau", description: "", platform: "twitch", defaultEnabled: false, requires: ["basis"], tabs: [], offNote: ""}
  ]);
  const s = {};
  const noGo = r.setModuleEnabled(s, "aufbau", true);
  assert.equal(noGo.ok, false);
  assert.match(noGo.error, /Basis/);
  assert.equal(s.modules.aufbau, false, "bei Fehler unverändert");
  assert.equal(r.setModuleEnabled(s, "basis", true).ok, true);
  assert.equal(r.setModuleEnabled(s, "aufbau", true).ok, true);
  const blocked = r.setModuleEnabled(s, "basis", false);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Aufbau/);
  assert.equal(s.modules.basis, true);
  assert.equal(r.setModuleEnabled(s, "aufbau", false).ok, true);
  assert.equal(r.setModuleEnabled(s, "basis", false).ok, true);
});

test("describeModules liefert nur Daten für die Oberfläche (keine Funktionen, boolesches enabled)", () => {
  const d = describeModules({modules: {lurkReturn: true}});
  assert.equal(d.length, MODULES.length);
  assert.equal(d[0].id, "lurkReturn");
  assert.equal(d[0].enabled, true);
  assert.equal(typeof d[0].offNote, "string");
  assert.ok(Object.values(d[0]).every(v => typeof v !== "function"));
  assert.equal(describeModules({})[0].enabled, false);
});

// --- Einhängepunkte (Quelltext) ---
const web = fs.readFileSync("app/server.js", "utf8");
const rt = fs.readFileSync("shared/twitch-runtime.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");

test("Server: Modul-Endpunkte nur für globale Administration, mit Protokoll im Activity Board und ausdrücklichem Schutz", () => {
  const get = web.indexOf('u.pathname === "/api/admin/modules" && req.method === "GET"');
  const put = web.indexOf('u.pathname === "/api/admin/modules" && req.method === "PUT"');
  assert.ok(get > 0 && put > get);
  assert.match(web.slice(get, get + 200), /requireGlobalAdmin\(req,res\)/);
  assert.match(web.slice(put, put + 200), /requireGlobalAdmin\(req,res\)/);
  const putBody = web.slice(put, put + 1400);
  assert.match(putBody, /typeof body\?\.enabled!=="boolean"/);
  assert.match(putBody, /body\.enabled\?"module\.enabled":"module\.disabled"/);
  assert.match(putBody, /section:"modules"/);
  assert.doesNotMatch(putBody, /unlink|rmSync|writeJson\(FILES\.lurkReturn/, "Ausschalten löscht keine Daten");
  assert.match(web, /"\/api\/admin\/modules",/);
  assert.match(web, /modules:"@admin"/);
});

test("Server: Modulstand geht an die Oberfläche; Lurk-Einstellungen werden bei ausgeschaltetem Modul nicht überschrieben", () => {
  assert.match(web, /out\.modules=JSON\.parse\(JSON\.stringify\(current\.modules\|\|out\.modules\)\);/);
  assert.match(web, /key==="lurkReturn"&&!isModuleEnabled\(next,"lurkReturn"\)\)continue;/);
  assert.doesNotMatch(web, /for\(const key of\[[^\]]*"modules"/, "modules kommt nie über die allgemeinen Einstellungen");
  assert.ok((web.match(/normalizeModuleSettings\(settings\)/g) || []).length >= 1);
});

test("Twitch-Bot: ausgeschaltetes Modul erfasst nichts, pflegt nichts, schreibt nichts", () => {
  assert.match(rt, /if \(isModuleEnabled\(settings, "lurkReturn"\)\) handleLurkChat\(lurkReturn/);
  assert.match(rt, /try \{ if \(!lurkModuleOn\(\)\) return; lurkReturn\.prune/);
  assert.match(rt, /if \(lurkModuleOn\(\)\) \{ lurkReturn\.clear\(\); lurkReturn\.flush\(\); \}/);
  // Das Modul wird vor dem Chat-Hook normalisiert (Altbestand-Regel greift).
  assert.ok(rt.indexOf("normalizeModuleSettings(settings);") < rt.indexOf('isModuleEnabled(settings, "lurkReturn")'));
});

test("Oberfläche: ausgeschaltete Module sind nirgends sichtbar; Schalter mit Warnung beim Ausschalten", () => {
  assert.match(ui, /function navRoleAllowed\(item\)\{\n  if\(item\?\.module&&!moduleEnabledUi\(item\.module\)\)return false;/);
  assert.match(ui, /function moduleEnabledUi\(id\)\{return settings\?\.modules\?\.\[id\]===true;\}/);
  assert.match(ui, /\{tab:"modules",label:"Module",adminOnly:true,adminSection:"Integrationen"\}/);
  assert.match(ui, /if\(tab==="modules"\)renderModules\(\);/);
  assert.match(html, /<section id="modules" class="pane hidden"><\/section>/);
  const fn = ui.slice(ui.indexOf("async function renderModules()"), ui.indexOf("async function renderConnections()"));
  assert.match(fn, /isGlobalAdmin\(\)/);
  assert.match(fn, /role="switch"/);
  assert.match(fn, /Datenverlusten/);
  assert.match(fn, /if\(!want\)\{[\s\S]*askConfirm\(/, "Warnung nur beim Ausschalten");
  assert.match(fn, /if\(!ok\)\{box\.checked=true;return;\}/, "Abbrechen lässt den Schalter an");
  assert.match(fn, /refreshNavigationPermissions\(\)/);
  assert.match(css, /\.module-switch/);
});

test("Oberfläche: der zusätzliche Schalter auf der Lurk-Seite bleibt erhalten", () => {
  assert.match(ui, /id="lurkEnabled" type="checkbox"/);
  assert.match(ui, /Rückkehr-Meldungen aktiv/);
});

test("Activity Board kennt Bereich und Aktionen der Modulschalter", () => {
  assert.match(ui, /modules:"Module"/);
  assert.match(ui, /"module\.enabled":"Modul eingeschaltet","module\.disabled":"Modul ausgeschaltet"/);
});

// --- Verhalten (Funktionen aus dem Quelltext herausgelöst und mit Attrappen ausgeführt) ---
const vm = require("node:vm");
function extract(source, startMarker, endMarker) {
  const i = source.indexOf(startMarker), j = source.indexOf(endMarker, i);
  assert.ok(i >= 0 && j > i, `Abschnitt ${startMarker} nicht gefunden`);
  return source.slice(i, j);
}

test("Verhalten Server: Lurk-Einstellungen werden bei ausgeschaltetem Modul nicht überschrieben, bei eingeschaltetem schon; modules nie über die Einstellungen", () => {
  const ctx = {JSON, Object, hasCapability: () => true, prepareSettingsFull: s => reg.normalizeModuleSettings(s), isModuleEnabled};
  vm.createContext(ctx);
  vm.runInContext(extract(web, "function mergeSettingsForUser(", "function apiAnyCapabilitiesFor"), ctx);
  const base = on => ({lurkReturn: {enabled: true, commands: "!lurk"}, modules: {lurkReturn: on}, greetings: {a: 1}, events: {}, communityCommands: {}});
  const incoming = {lurkReturn: {enabled: false, commands: "!x"}, modules: {lurkReturn: !false}, greetings: {a: 2}};
  const off = ctx.mergeSettingsForUser(base(false), incoming, {});
  assert.deepEqual(JSON.parse(JSON.stringify(off.lurkReturn)), {enabled: true, commands: "!lurk"}, "aus: unverändert");
  assert.equal(off.modules.lurkReturn, false, "modules lässt sich nicht über PUT /api/settings ändern");
  assert.equal(off.greetings.a, 2, "andere Community-Einstellungen funktionieren weiter");
  const on = ctx.mergeSettingsForUser(base(true), {lurkReturn: {enabled: false, commands: "!x"}, modules: {lurkReturn: false}}, {});
  assert.equal(on.lurkReturn.commands, "!x", "an: wird übernommen");
  assert.equal(on.modules.lurkReturn, true);
});

test("Verhalten Oberfläche: Reiter eines ausgeschalteten Moduls fehlt in der Navigation, bei eingeschaltetem ist er da", () => {
  const ctx = {settings: {modules: {lurkReturn: false}}, minigameReady: true, currentPlatform: "twitch", currentUser: {}, isGlobalOwner: () => true, isGlobalAdmin: () => true, hasCapability: () => true};
  vm.createContext(ctx);
  vm.runInContext(extract(ui, "function moduleEnabledUi(", "async function renderModules()"), ctx);
  vm.runInContext(extract(ui, "function navRoleAllowed(item){", "function availableNavItems("), ctx);
  const lurkItem = {tab: "lurk", label: "Lurk-Rückkehr", capability: "twitch.community.view", module: "lurkReturn"};
  const other = {tab: "events", label: "Community", capability: "twitch.community.view"};
  assert.equal(ctx.navRoleAllowed(lurkItem), false, "aus: nicht sichtbar");
  assert.equal(ctx.navRoleAllowed(other), true, "andere Reiter unberührt");
  ctx.settings = {modules: {lurkReturn: true}};
  assert.equal(ctx.navRoleAllowed(lurkItem), true, "an: sichtbar");
  ctx.settings = {};
  assert.equal(ctx.navRoleAllowed(lurkItem), false, "ohne Angabe: nicht sichtbar");
  ctx.settings = undefined;
  assert.equal(ctx.navRoleAllowed(lurkItem), false, "Einstellungen noch nicht geladen: nicht sichtbar");
});
