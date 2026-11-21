// 9.4.0: Modulstand für den Discord-Bot und Modul Social Media.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const reg = require("../shared/modules");
const {createModuleStateClient} = require("../shared/module-state-client");
const web = fs.readFileSync("app/server.js", "utf8");
const dc = fs.readFileSync("discord-app/discord-server.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");
const SECRET = "x".repeat(40);
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ms940-")), "module-state.json");
const okFetch = modules => async (url, opts) => ({ok: true, status: 200, json: async () => ({ok: true, modules}), url, opts});

test("Registrierung: Social Media ist ein Discord-Modul, Standard an, mit allen fünf Reitern", () => {
  const m = reg.getModule("socialMedia");
  assert.equal(m.platform, "discord");
  assert.equal(m.defaultEnabled, true);
  assert.deepEqual([...m.tabs], ["socialOverview", "socialInstagram", "socialTikTok", "socialPublications", "socialSettings"]);
  assert.match(m.offNote, /Instagram-Zugangstoken wird weiter automatisch verlängert/);
  assert.deepEqual(reg.routeModule("/api/social/config"), {module: "socialMedia", kind: "api"});
  assert.deepEqual(reg.routeModule("/auth/tiktok/callback"), {module: "socialMedia", kind: "api"});
  assert.equal(reg.routeModule("/api/socialX"), null);
});

test("Client: ohne bekannten Stand gelten die Standardwerte (nichts wird abgeschaltet)", () => {
  const c = createModuleStateClient({url: null, secret: null});
  assert.equal(c.isOn("socialMedia"), true);
  assert.equal(c.isOn("lurkReturn"), false, "neue Module bleiben aus");
  assert.equal(c.isOn("gibtEsNicht"), true, "unbekannte Kennungen nie abschalten");
  assert.equal(c.snapshot().known, false);
});

test("Client: Abruf übernimmt den Stand, schickt das Dienst-Geheimnis und speichert in der Datei", async () => {
  const file = tmpFile();
  let seen;
  const c = createModuleStateClient({url: "http://web:3000", secret: SECRET, file, intervalMs: 0, fetchImpl: async (u, o) => { seen = {u, o}; return okFetch({socialMedia: false})(); }});
  assert.equal(await c.refresh(), true);
  assert.equal(seen.u, "http://web:3000/internal/modules");
  assert.equal(seen.o.headers["X-BWK-Service-Secret"], SECRET);
  assert.equal(c.isOn("socialMedia"), false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).modules.socialMedia, false);
});

test("Client: Ausfall der Weboberfläche behält den letzten Stand (auch nach Neustart aus der Datei)", async () => {
  const file = tmpFile();
  const a = createModuleStateClient({url: "http://web:3000", secret: SECRET, file, intervalMs: 0, fetchImpl: okFetch({socialMedia: false})});
  await a.refresh();
  const b = createModuleStateClient({url: "http://web:3000", secret: SECRET, file, intervalMs: 0, fetchImpl: async () => { throw new Error("ECONNREFUSED"); }});
  b.load();
  assert.equal(await b.refresh(), false);
  assert.equal(b.isOn("socialMedia"), false, "letzter Stand aus der Datei");
  assert.match(b.snapshot().lastError, /ECONNREFUSED/);
  const c = createModuleStateClient({url: "http://web:3000", secret: SECRET, file, intervalMs: 0, fetchImpl: async () => ({ok: false, status: 500})});
  c.load();
  await c.refresh();
  assert.equal(c.isOn("socialMedia"), false);
});

test("Client: set() übernimmt sofort, meldet Änderungen und weist Unsinn ab", () => {
  const changes = [];
  const c = createModuleStateClient({onChange: (snap, src) => changes.push([snap.modules.socialMedia, src])});
  assert.equal(c.set({socialMedia: false}), true);
  assert.equal(c.isOn("socialMedia"), false);
  assert.equal(c.set({socialMedia: false}), true);
  assert.equal(changes.length, 1, "gleicher Stand löst keine Änderung aus");
  assert.equal(c.set({socialMedia: true}, "pull"), true);
  assert.deepEqual(changes, [[false, "push"], [true, "pull"]]);
  assert.equal(c.set(null), false);
  assert.equal(c.set([1]), false);
  assert.equal(c.isOn("socialMedia"), true, "ungültige Eingaben ändern nichts");
  c.set({socialMedia: "nein", fremd: true});
  assert.equal(c.isOn("socialMedia"), true, "Nicht-Boolesches → Standard");
  assert.ok(!("fremd" in c.snapshot().modules));
});

test("Weboberfläche: GET /internal/modules nur mit Dienst-Geheimnis; Änderung wird an den Discord-Bot geschickt", () => {
  const i = web.indexOf('if(req.url==="/internal/modules") {');
  assert.ok(i > 0);
  const block = web.slice(i, i + 400);
  assert.match(block, /if\(req\.method!=="GET"\)return json\(res,405/);
  assert.match(block, /if\(!internalDiscordAdminAuth\(req\)\)return json\(res,401/);
  assert.match(block, /modules:s\.modules,features:controlFeatures\(s\)/); // ab 9.6.0 mit features
  const put = web.slice(web.indexOf('u.pathname === "/api/admin/modules" && req.method === "PUT"'));
  assert.match(put.slice(0, 2000), /pushControlStateToDiscord\("Modulschalter"\);/); // ab 9.6.0 gemeinsamer Push
  assert.match(web, /discordServiceRequest\("\/internal\/modules",\{method:"PUT",body:JSON\.stringify\(\{modules:s\.modules,features:controlFeatures\(s\)\}\)\}\)\.catch\(/);
});

test("Discord-Bot: Modulstand wird geladen, angenommen und sperrt Social-Abfrage und -Verwaltung", () => {
  assert.match(dc, /const moduleState = createModuleStateClient\(\{/);
  assert.match(dc, /file: require\("path"\)\.join\(DATA_DIR, "module-state\.json"\)/);
  assert.match(dc, /moduleState\.start\(\);/);
  assert.match(dc, /async function pollSocialAll\(\{manual=false\}=\{\}\)\{\n  if\(!moduleState\.isOn\("socialMedia"\)\)return \{ok:true,status:"module_disabled"\};/);
  assert.match(dc, /if\(!socialConfig\.enabled\)return;\n  if\(!moduleState\.isOn\("socialMedia"\)\)return;/);
  const auth = dc.indexOf("if(!serviceAuthValid(req))");
  const internal = dc.indexOf('if(requestUrl.pathname==="/internal/modules"){');
  const block = dc.indexOf('if(requestUrl.pathname.startsWith("/social")&&!moduleState.isOn("socialMedia"))');
  const firstSocial = dc.indexOf('requestUrl.pathname==="/social');
  assert.ok(auth > 0 && auth < internal && internal < block && block < firstSocial, "Reihenfolge: Auth → /internal/modules → Sperre → Social-Routen");
  // Token-Verlängerung bleibt bewusst unabhängig vom Modul.
  const refresh = dc.slice(dc.indexOf("async function checkInstagramRefreshDue(){"), dc.indexOf("async function refreshTikTokTokenIfNeeded"));
  assert.doesNotMatch(refresh, /moduleState/);
});

test("Oberfläche: alle Social-Reiter, Schnellzugriff und Lagebild-Karte hängen am Modul", () => {
  for (const t of ["socialOverview", "socialInstagram", "socialTikTok", "socialPublications", "socialSettings"])
    assert.match(ui, new RegExp(`\\{tab:"${t}",label:"[^"]+",ownerOnly:true,module:"socialMedia"\\}`), t);
  assert.match(ui, /if\(isGlobalOwner\(\)&&d\.social&&moduleEnabledUi\("socialMedia"\)\)quick\.push/);
  assert.match(ui, /\$\{isGlobalOwner\(\)&&d\.social&&moduleEnabledUi\("socialMedia"\)\?`<div class="card">/);
});
