// 9.7.0: Clips und Event-Profile hängen am Modulschalter (zweite Welle).
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const reg = require("../shared/modules");
const core = require("../shared/event-profile-core");
const web = fs.readFileSync("app/server.js", "utf8");
const rt = fs.readFileSync("shared/twitch-runtime.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");

test("Registrierung: Clips und Event-Profile, Standard an, keine Schutzfunktion", () => {
  for (const id of ["clips", "eventProfiles"]) {
    const m = reg.getModule(id);
    assert.ok(m, id);
    assert.equal(m.defaultEnabled, true);
    assert.notEqual(m.critical, true);
    assert.equal(m.platform, "twitch");
  }
  assert.deepEqual(reg.routeModule("/api/clips/check"), {module: "clips", kind: "api"});
  assert.deepEqual(reg.routeModule("/api/event-profiles/abc/apply"), {module: "eventProfiles", kind: "api"});
  assert.equal(reg.routeModule("/api/clipsX"), null);
  assert.match(reg.getModule("eventProfiles").offNote, /zuletzt angewendete Zustand bleibt/);
});

test("Twitch-Bot: Clip-Überwachung ruht bei ausgeschaltetem Modul", () => {
  const fn = rt.slice(rt.indexOf("function startClipMonitor() {"), rt.indexOf("function startClipMonitor() {") + 900);
  assert.match(fn, /const settings = readJson\(FILES\.settings, DEFAULT_SETTINGS\);\n    if \(!isModuleEnabled\(settings, "clips"\)\) return;/);
  assert.ok(fn.indexOf('isModuleEnabled(settings, "clips")') < fn.indexOf("await checkNewClips()"));
});

test("Event-Profile: Clip-Teilen gehört zum Modul Clips und wird bei „aus“ übersprungen", () => {
  assert.equal(core.SWITCHES.find(x => x.key === "clipSharing").module, "clips");
  const live = () => ({settings: {clipSharing: {enabled: true}}, extras: {}});
  const snap = core.capture(live());
  snap.switches.clipSharing.enabled = false;
  const l = live();
  core.apply(l, snap, {moduleOff: id => id === "clips"});
  assert.equal(l.settings.clipSharing.enabled, true);
});

test("Server: Profile werden bei ausgeschalteten Event-Profilen nicht nachgeführt; Clip-Einstellungen geschützt", () => {
  const i = web.indexOf('function syncEventProfilesAfterChange(actor="system",reason="settings") {');
  assert.match(web.slice(i, i + 200), /\{\n  if\(!moduleOn\("eventProfiles"\)\)return;/);
  assert.match(web, /if\(isModuleEnabled\(next,"clips"\)\)set\("clipSharing","twitch\.clips\.edit"\);/);
  // Verhalten: sync kehrt sofort zurück, ohne Profile zu lesen.
  const j = web.indexOf("\n}\n", i);
  let reads = 0;
  const ctx = {moduleOn: () => false, readEventProfiles: () => { reads++; return {profiles: []}; }};
  vm.createContext(ctx);
  vm.runInContext(web.slice(i, j + 3), ctx);
  ctx.syncEventProfilesAfterChange("x", "test");
  assert.equal(reads, 0);
  ctx.moduleOn = () => true;
  vm.runInContext("moduleOn=()=>true", ctx);
});

test("Oberfläche: Reiter Clips und Event-Profile hängen am Modul", () => {
  assert.match(ui, /\{tab:"clips",label:"Clips",capability:"twitch\.clips\.view",module:"clips"\}/);
  assert.match(ui, /\{tab:"eventprofiles",label:"Event-Profile",capability:"twitch\.eventprofiles\.view",module:"eventProfiles"\}/);
});
