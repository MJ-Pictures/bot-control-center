// Entkopplung Schritt 1d: Die Twitch-Laufzeit ist ein eigenes Modul mit ausdrücklich benannten Abhängigkeiten.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const web=fs.readFileSync("app/server.js","utf8"),rt=fs.readFileSync("shared/twitch-runtime.js","utf8");
test("Modul prüft seine Abhängigkeiten, bevor irgendetwas startet",()=>{
  // Laden ohne Nebenwirkung: /shared-Module werden erst innerhalb der Fabrik angefordert.
  const {createTwitchRuntime,REQUIRED_DEPS}=require("../shared/twitch-runtime");
  assert.equal(typeof createTwitchRuntime,"function");
  assert.ok(REQUIRED_DEPS.length>=15);
  assert.throws(()=>createTwitchRuntime({}),/Abhängigkeit fehlt: matchWordFilter/);
  assert.throws(()=>createTwitchRuntime(),/Abhängigkeit fehlt/);
});
test("Twitch-Bot-Dienst übergibt genau die verlangten Abhängigkeiten (seit 9.0.0 der einzige Aufrufer)",()=>{
  const {REQUIRED_DEPS}=require("../shared/twitch-runtime");
  const dataNames=require("../shared/twitch-data").REQUIRED_DEPS;assert.ok(dataNames.includes("getStreamInfo"));
  const bot=fs.readFileSync("twitch-app/twitch-server.js","utf8");
  const i=bot.indexOf("const { twitchRuntime } = createTwitchRuntime({");assert.ok(i>0);const call=bot.slice(i,bot.indexOf("\n});",i));
  assert.match(call,/\.\.\.twitchData/);   // Datenfunktionen kommen gesammelt aus /shared/twitch-data.js
  const fromData=["readGiveawayState","writeGiveawayState","berlinDateKey","readUsageStats","emptyUsageStat","readWatchtime","writeWatchtime","prepareSettings","normalizeClipSettings","readClipState"];
  for(const dep of REQUIRED_DEPS){
    if(fromData.includes(dep))continue;
    assert.match(call,new RegExp("(?<![\\w$])"+dep+"(?![\\w$])"),`Abhängigkeit ${dep} wird nicht übergeben`);
  }
  assert.match(call,/discordServiceRequest: core\.discordServiceRequest/);
});
test("Twitch-Laufzeit steht nicht mehr in server.js",()=>{
  for(const fn of ["function handleChat","function connectEventSub","function handleNotification","function sendChat","function refreshToken","function loadToken","function startTimers","const accountMap"])
    {assert.ok(!web.includes(fn),`${fn} steht noch in server.js`);assert.ok(rt.includes(fn),`${fn} fehlt in twitch-runtime.js`);}
});
test("Twitch-Laufzeit kennt keine Web-Interna (Sitzungen, Rechte, HTTP-Server)",()=>{
  const code=rt.split("\n").map(l=>l.replace(/\/\/.*$/,"")).join("\n");
  assert.doesNotMatch(code,/http\.createServer|sessionStore\(|requireUser\(|requireGlobalAdmin\(|requireCapability\(|parseCookies\(|server\.listen/);
  assert.doesNotMatch(code,/require\(["']\.\/server["']\)/);
});
test("Web-Kern nutzt aus der Laufzeit nur die Schnittstelle; Datenfunktionen kommen aus dem Datenmodul",()=>{
  assert.match(web,/const twitchRuntime = twitchLink\.createRemoteTwitchRuntime\(/);
  const i=web.indexOf("const {\n  twitchBlockedTermsChanged,"),names=web.slice(i,web.indexOf("} = twitchData;",i)).match(/[A-Za-z_$][\w$]*/g).filter(n=>n!=="const");
  assert.deepEqual(names,["twitchBlockedTermsChanged","readGiveawayState","writeGiveawayState","publicGiveaway","archiveCurrentGiveaway","giveawayStartMessage","giveawayWinnerMessage","prepareSettings","readUsageStats","buildUsageStatsView","readWatchtime","queryWatchtime","setWatchtimeSeconds","normalizeClipSettings","readClipState"]);
  assert.match(web,/getStreamInfo: \(\) => twitchRuntime\.streamInfo\(\)/);
});

