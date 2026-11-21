// 9.2.0: Fundament 2 der Modulschalter (Schnittstellen-Sperre, leere Overlays, Ereignisweg, Event-Profile,
// laufende Vorgänge, Favoriten) sowie die Module Gewinnspiel und Follower-Alert.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const reg = require("../shared/modules");
const core = require("../shared/event-profile-core");
const web = fs.readFileSync("app/server.js", "utf8");
const rt = fs.readFileSync("shared/twitch-runtime.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");

test("Registrierung: Gewinnspiel und Follower-Alert sind eingetragen und standardmäßig an (BWK ändert sich nicht)", () => {
  for (const id of ["giveaway", "followerAlert"]) {
    const m = reg.getModule(id);
    assert.ok(m, id);
    assert.equal(m.defaultEnabled, true);
    assert.equal(m.platform, "twitch");
    assert.ok(m.offNote.length > 20);
    assert.ok(m.runsIn);
  }
  const s = {};
  reg.normalizeModuleSettings(s);
  assert.equal(s.modules.giveaway, true);
  assert.equal(s.modules.followerAlert, true);
  assert.equal(s.modules.lurkReturn, false, "neue Module bleiben aus");
});

test("routeModule ordnet Adressen zu (Overlay, öffentlicher Zustand, Strom, Verwaltung)", () => {
  assert.deepEqual(reg.routeModule("/follower-alert/overlay"), {module: "followerAlert", kind: "overlay"});
  assert.deepEqual(reg.routeModule("/api/follower-alert/public/state"), {module: "followerAlert", kind: "state"});
  assert.deepEqual(reg.routeModule("/api/follower-alert/public/stream"), {module: "followerAlert", kind: "stream"});
  assert.deepEqual(reg.routeModule("/api/follower-alert"), {module: "followerAlert", kind: "api"});
  assert.deepEqual(reg.routeModule("/api/follower-alert/test"), {module: "followerAlert", kind: "api"});
  assert.deepEqual(reg.routeModule("/api/giveaway"), {module: "giveaway", kind: "api"});
  assert.deepEqual(reg.routeModule("/api/giveaway/draw"), {module: "giveaway", kind: "api"});
  assert.equal(reg.routeModule("/api/giveawayX"), null, "nur ganze Pfadteile");
  assert.equal(reg.routeModule("/api/followathonX"), null);
  assert.equal(reg.routeModule("/api/settings"), null);
  assert.equal(reg.routeModule(undefined), null);
});

// --- Server: zentrale Sperre mit Attrappen ausführen ---
function guardContext(modules) {
  const out = {};
  const ctx = {
    routeModule: reg.routeModule,
    moduleOff: id => reg.isKnownModule(id) && !reg.isModuleEnabled({modules}, id),
    EMPTY_OVERLAY_HTML: "<leer>",
    send: (res, code, body, type) => { out.code = code; out.body = body; out.type = type; return "sent"; },
    json: (res, code, body) => { out.code = code; out.json = body; return "json"; },
    res: {writeHead: code => { out.code = code; }, end: () => { out.ended = true; return "ended"; }}
  };
  const i = web.indexOf("    // 9.2.0: Ausgeschaltete Module sind nicht erreichbar.");
  const j = web.indexOf('    if (u.pathname === "/health")', i);
  assert.ok(i > 0 && j > i);
  const body = web.slice(i, j);
  vm.createContext(ctx);
  vm.runInContext(`function guard(u){${body}\nreturn "weiter";}`, ctx);
  return {run: p => ctx.guard({pathname: p}), out};
}

test("Server-Sperre: ausgeschaltet → Overlay leer, Zustand „aus“, Strom ohne Inhalt, Verwaltung 404", () => {
  const g = guardContext({followerAlert: false, giveaway: false, lurkReturn: false});
  g.run("/follower-alert/overlay");
  assert.equal(g.out.code, 200); assert.equal(g.out.body, "<leer>"); assert.match(g.out.type, /text\/html/);
  g.run("/api/follower-alert/public/state");
  assert.equal(g.out.code, 200); assert.equal(g.out.json.enabled, false);
  g.run("/api/follower-alert/public/stream");
  assert.equal(g.out.code, 204); assert.equal(g.out.ended, true);
  g.run("/api/giveaway/draw");
  assert.equal(g.out.code, 404); assert.equal(g.out.json.module, "giveaway");
  g.run("/api/follower-alert");
  assert.equal(g.out.code, 404);
});

test("Server-Sperre: eingeschaltet oder fremde Adresse → normale Verarbeitung", () => {
  const g = guardContext({followerAlert: true, giveaway: true});
  for (const p of ["/follower-alert/overlay", "/api/follower-alert/public/state", "/api/giveaway", "/api/settings", "/api/followathon"]) {
    assert.equal(g.run(p), "weiter", p);
  }
  assert.equal(guardContext({}).run("/api/giveaway"), "weiter", "ohne Eintrag gilt der Standard (an)");
});

test("Server-Sperre steht nach der Rechteprüfung und vor allen Modul-Routen", () => {
  const guard = web.indexOf("const route=routeModule(u.pathname);");
  assert.ok(guard > web.indexOf("access.default-deny"));
  for (const r of ['u.pathname === "/api/giveaway" && req.method === "GET"', 'u.pathname === "/follower-alert/overlay"', 'u.pathname === "/api/follower-alert/public/stream"'])
    assert.ok(guard < web.indexOf(r), r);
  assert.match(web, /const EMPTY_OVERLAY_HTML='<!doctype html>[^']*background:transparent[^']*'/);
});

test("Laufendes Gewinnspiel sperrt das Ausschalten; Einschalten bleibt immer möglich", () => {
  const put = web.slice(web.indexOf('u.pathname === "/api/admin/modules" && req.method === "PUT"'));
  assert.match(put.slice(0, 900), /if\(body\.enabled===false\)\{const busy=MODULE_BUSY_CHECKS\[mod\.id\]\?\.\(\);if\(busy\)return json\(res,409,\{error:busy\}\);\}/);
  const i = web.indexOf("const MODULE_BUSY_CHECKS={"), j = web.indexOf("};", i);
  const ctx = {state: null, readGiveawayState: () => ctx.state};
  vm.createContext(ctx);
  vm.runInContext(web.slice(i, j + 2).replace("const MODULE_BUSY_CHECKS", "var MODULE_BUSY_CHECKS"), ctx);
  ctx.state = {current: {active: true}};
  assert.match(ctx.MODULE_BUSY_CHECKS.giveaway(), /Gewinnspiel läuft/);
  ctx.state = {current: {active: false}};
  assert.equal(ctx.MODULE_BUSY_CHECKS.giveaway(), null);
  ctx.state = {current: null};
  assert.equal(ctx.MODULE_BUSY_CHECKS.giveaway(), null);
  ctx.readGiveawayState = () => { throw new Error("db"); };
  assert.equal(ctx.MODULE_BUSY_CHECKS.giveaway(), null, "Lesefehler sperrt nicht dauerhaft");
});

test("Ereignisweg und Twitch-Bot: ausgeschaltete Module bekommen keine Follows bzw. keine Chat-Teilnahme", () => {
  assert.match(web, /twitchEvents\.on\("follow","Follower-Alert",\(\{event\}\)=>\{if\(!moduleOn\("followerAlert"\)\)return;return followerAlert\.handleFollow\(event\);\}\)/);
  assert.match(rt, /if \(isModuleEnabled\(settings, "giveaway"\)\) maybeJoinGiveaway\(ev, msg\);/);
  assert.ok(rt.indexOf("normalizeModuleSettings(settings);") < rt.indexOf('isModuleEnabled(settings, "giveaway")'));
});

// --- Event-Profile ---
function live(alertOn) {
  return {settings: {events: {follow: {enabled: true}}}, extras: {stubenkontrolle: {enabled: true}, followerAlert: {enabled: alertOn}}};
}
const off = {moduleOff: id => id === "followerAlert"};

test("Event-Profile: Schalter eines ausgeschalteten Moduls wird nicht angewendet, nicht geprüft, nicht angezeigt, nicht geändert", () => {
  const snap = core.capture(live(true));
  snap.switches.followerAlert.enabled = false;
  const l = live(true);
  core.apply(l, snap, off);
  assert.equal(l.extras.followerAlert.enabled, true, "apply lässt den Follower-Alert unberührt");
  assert.deepEqual(core.verify(l, snap, off).filter(d => d.label === "Follower-Alert"), [], "verify meldet keine Abweichung");
  const labels = core.describe(l, snap, off).flatMap(g => g.items.map(x => x.label));
  assert.ok(!labels.includes("Follower-Alert"));
  const patched = core.patch(snap, l, [{kind: "switch", key: "followerAlert", enabled: true}], [], off);
  assert.equal(patched.switches.followerAlert.enabled, false, "gespeicherter Profilwert bleibt");
});

test("Event-Profile: ohne Optionen bzw. bei eingeschaltetem Modul wie bisher", () => {
  const snap = core.capture(live(true));
  snap.switches.followerAlert.enabled = false;
  const l = live(true);
  core.apply(l, snap);
  assert.equal(l.extras.followerAlert.enabled, false);
  const l2 = live(true);
  core.apply(l2, snap, {moduleOff: () => false});
  assert.equal(l2.extras.followerAlert.enabled, false);
  assert.ok(core.describe(l2, snap).flatMap(g => g.items.map(x => x.label)).includes("Follower-Alert"));
  assert.equal(core.SWITCHES.find(x => x.key === "followerAlert").module, "followerAlert");
});

test("Server reicht die Moduloptionen an alle Event-Profil-Aufrufe weiter", () => {
  assert.match(web, /const PROFILE_MODULE_OPTS=\{moduleOff\};/);
  for (const fn of ["apply", "verify", "describe", "patch"]) {
    const calls = web.match(new RegExp(`eventProfileCore\\.${fn}\\([^\\n]*`, "g")) || [];
    assert.ok(calls.length > 0, fn);
    for (const c of calls) assert.match(c, /PROFILE_MODULE_OPTS/, c);
  }
  assert.match(web, /function moduleOff\(id\)\{return isKnownModule\(id\)&&!moduleOn\(id\);\}/, "unbekannte Module gelten nie als aus");
});

// --- Oberfläche ---
test("Oberfläche: Gewinnspiel- und Follower-Alert-Reiter hängen am Modul; Modulseite nach Plattform gegliedert", () => {
  assert.equal((ui.match(/\{tab:"giveaway",label:"Gewinnspiel",capability:"twitch\.giveaway\.view",module:"giveaway"\}/g) || []).length, 2);
  assert.match(ui, /\{tab:"followerAlert",label:"Follower-Alert",capability:"twitch\.followathon\.view",module:"followerAlert"\}/);
  const fn = ui.slice(ui.indexOf("async function renderModules()"), ui.indexOf("async function renderConnections()"));
  assert.match(fn, /\["twitch","Twitch"\],\["discord","Discord"\],\["both","Twitch und Discord"\]/);
  assert.match(fn, /läuft in:/);
});

// --- Favoriten (Nebenbefund aus 9.1.2) ---
test("Favoriten: jeder Reiter der Navigation ist in der Server-Liste erlaubt; Listen = eines der Rechte", () => {
  const a = ui.indexOf("const NAV_GROUPS={"), b = ui.indexOf("const PLATFORM_NAV");
  const NAV = new Function(ui.slice(a, b).replace("const NAV_GROUPS=", "return "))();
  const i = web.indexOf("const allowed={", web.indexOf("user-favorites")), j = web.indexOf("};", i);
  const allowed = new Function("return " + web.slice(i + 14, j + 1))();
  const missing = [];
  for (const g of Object.values(NAV)) for (const it of g.items) if (!(it.tab in allowed)) missing.push(it.tab);
  assert.deepEqual(missing, []);
  assert.deepEqual(allowed.statistics, ["twitch.statistics.view", "discord.statistics.view"]);
  assert.match(web, /if\(Array\.isArray\(cap\)\)return cap\.some\(c=>hasCapability\(me,c\)\);/);
});
