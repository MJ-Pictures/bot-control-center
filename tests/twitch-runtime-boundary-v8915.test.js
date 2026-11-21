// Entkopplung Schritt 1a: Der Web-Kern greift nur über twitchRuntime auf die Twitch-Laufzeit zu.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
// Seit 8.9.18 (1d) liegt die Twitch-Laufzeit in shared/twitch-runtime.js; server.js ist der Web-Kern.
const web=fs.readFileSync("app/server.js","utf8"),rt=fs.readFileSync("shared/twitch-runtime.js","utf8");
const START="// ===== 8.9.15 · Entkopplung Schritt 1a",END="// ===== Ende Schnittstelle Twitch-Laufzeit =====";
const facade=rt.slice(rt.indexOf(START));
const RUNTIME_ONLY=["ws","wsSessionId","eventSubRuntime","eventSubSubscriptions","eventSubSocketState","ids","resolveIds","sendChat","sendChatNow","chatSendQueue","saveToken","refreshToken","loadToken","accountMap","validateUserToken","connectionStatus","reconcileTwitchBlockedTerms","getFollowerPage","messageCounterDiagnostics","readDiscordBridgeState","checkNewClips","connectEventSub","startTimers","startClipMonitor","startDiscordBridge","startWatchtimeTracker","startMessageCounter","stopMessageCounter","handleChat","handleNotification","twitchFetch"];
test("Schnittstelle existiert genau einmal, in der Twitch-Laufzeit",()=>{
  assert.equal(rt.split(START).length,2);assert.equal(web.split(START).length,1);
  assert.match(facade,/const twitchRuntime = Object\.freeze\(\{/);
  // Seit 9.0.0 erzeugt nur noch der Twitch-Bot-Dienst die Laufzeit; die Weboberfläche lädt das Modul nicht mehr.
  const bot=fs.readFileSync("twitch-app/twitch-server.js","utf8");
  assert.match(bot,/const \{ twitchRuntime \} = createTwitchRuntime\(\{/);
  assert.doesNotMatch(web,/createTwitchRuntime|shared\/twitch-runtime/);
  assert.ok(web.indexOf("twitchLink.createRemoteTwitchRuntime(")>0&&web.indexOf("twitchLink.createRemoteTwitchRuntime(")<web.indexOf("const server = http.createServer"));
});
test("Web-Kern nutzt keine Twitch-Laufzeit-Interna direkt",()=>{
  const code=web.split("\n").map(l=>l.replace(/\/\/.*$/,""));
  const hits=[];
  for(const name of RUNTIME_ONLY){
    const rx=new RegExp("(?<![\\w$.\"'`-])"+name.replace("$","\\$")+"(?![\\w$\"'`:-])");
    code.forEach((l,i)=>{if(rx.test(l)&&!new RegExp("[\"'`][^\"'`]*\\b"+name+"\\b[^\"'`]*[\"'`]").test(l))hits.push(name+" @ +"+(i+1)+": "+l.trim().slice(0,90));});
  }
  assert.deepEqual(hits,[]);
});
test("eventSubStatus liefert eine Kopie aus einfachen Werten",()=>{
  assert.match(facade,/runtime:\{\.\.\.eventSubRuntime\}/);
  assert.match(facade,/async eventSubStatus\(\)\{[\s\S]*?return plain\(\{[\s\S]*?subscriptions:eventSubSubscriptions\s*\}\);/);
  assert.match(facade,/const plain = value => value === undefined \? undefined : JSON\.parse\(JSON\.stringify\(value\)\);/);
  assert.doesNotMatch(facade,/socket:ws|ws:ws/);
});
test("Start und Stopp der Twitch-Laufzeit laufen über die Schnittstelle",()=>{
  assert.match(web,/await twitchRuntime\.resolveIds\(\);/);assert.match(web,/await twitchRuntime\.start\(\);/);assert.match(web,/twitchRuntime\.stop\(\);/);
  for(const fn of ["connectEventSub","startTimers","startClipMonitor","startDiscordBridge","startWatchtimeTracker","startMessageCounter"])assert.match(facade,new RegExp(fn+"\\(\\);"));
});
