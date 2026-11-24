// Entkopplung Schritt 3a: Der Web-Kern wartet bei jedem Zugriff auf die Twitch-Laufzeit auf die Antwort.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const web=fs.readFileSync("app/server.js","utf8"),rt=fs.readFileSync("shared/twitch-runtime.js","utf8");
const facade=rt.slice(rt.indexOf("const twitchRuntime = Object.freeze({"),rt.indexOf("  return {twitchRuntime};"));
test("Jede Methode der Schnittstelle ist asynchron",()=>{
  const methods=[...facade.matchAll(/^  (async )?([A-Za-z]+)\s*[(:]/gm)].map(m=>({name:m[2],async:!!m[1]}));
  assert.ok(methods.length>=17,"Methoden gefunden: "+methods.length);
  assert.deepEqual(methods.filter(m=>!m.async).map(m=>m.name),[]);
  assert.deepEqual(methods.map(m=>m.name).sort(),["channelId","checkNewClips","connectionStatus","eventSubStatus","findUserByLogin","getFollowerPage","hasToken","messageCounterDiagnostics","readDiscordBridgeState","reconcileTwitchBlockedTerms","resolveIds","sendChat","start","stop","storeAuthorizedToken","streamInfo","subathonEnsure","subathonStatus","tokenPresence","wordFilterChanged"]);
});
test("Jeder Aufruf im Web-Kern ist mit await versehen (bis auf vier benannte Durchreichungen)",()=>{
  const lines=web.split("\n"),missing=[],passthrough=[];
  lines.forEach((line,i)=>{
    for(const m of line.matchAll(/twitchRuntime\.([A-Za-z]+)\(/g)){
      const before=line.slice(0,m.index);
      if(/await\s*\(?$/.test(before))continue;
      if(m[1]==="linkStatus")continue;   // synchrone Statusabfrage der Fern-Verbindung, keine Methode der Laufzeit
      if(/=>\s*\{?$/.test(before)){passthrough.push(m[1]);continue;}   // gibt das Promise unverändert weiter
      missing.push(`${i+1}: ${m[1]}`);
    }
  });
  assert.deepEqual(missing,[]);
  assert.deepEqual(passthrough.sort(),["findUserByLogin","sendChat","stop","streamInfo"]);
});
test("Abgleich gesperrter Begriffe: Ergebnis wird ausdrücklich übernommen (keine stille Änderung am übergebenen Objekt)",()=>{
  assert.match(web,/next\.blockedWords=\(await twitchRuntime\.reconcileTwitchBlockedTerms\(before,next,me\.login\|\|me\.name\)\)\.blockedWords;/);
  assert.match(web,/restored\.blockedWords=\(await twitchRuntime\.reconcileTwitchBlockedTerms\(current,restored,actor\)\)\.blockedWords;/);
  assert.match(facade,/const b=\{blockedWords:plain\(before\?\.blockedWords\|\|\[\]\)\},n=\{blockedWords:plain\(next\?\.blockedWords\|\|\[\]\)\};/);
  assert.match(facade,/return \{blockedWords:plain\(n\.blockedWords\|\|\[\]\)\};/);
});
test("Stammdaten der Konten: Weboberfläche und Twitch-Laufzeit nutzen dasselbe Modul",()=>{
  assert.match(web,/const twitchAccounts = \(\) => publicTwitchAccounts\(CHANNEL_LOGIN, botRosterNow\(\), \{subathon:moduleOn\("subathon"\),redemptions:moduleOn\("chatOverlay"\)&&chatOverlayRedeemWanted\(\)\}\);/);
  assert.match(rt,/for \(const d of twitchAccountDefs\(CHANNEL_LOGIN, roster, \{subathon: subathonOn, redemptions: redeemOn\}\)\)/);
  assert.doesNotMatch(web,/twitchRuntime\.accounts\(|twitchRuntime\.account\(/);
});
test("Wortfilter-Änderung: eigener Stand sofort, Twitch-Laufzeit wird benachrichtigt, Fehler dabei blockiert nicht",()=>{
  const i=web.indexOf("async function wordFilterChanged(){"),body=web.slice(i,web.indexOf("\n}\n",i));
  assert.match(body,/const compiled=wordFilterRefresh\(true\);/);
  assert.match(body,/try\{await twitchRuntime\.wordFilterChanged\(\);\}catch\(e\)\{console\.warn/);
  assert.doesNotMatch(web,/twitchRuntime\.wordFilterRefresh/);
  assert.equal((web.match(/await wordFilterChanged\(\)/g)||[]).length,11);
});
