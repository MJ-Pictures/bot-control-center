// Entkopplung Schritt 3b (Teil 1): gemeinsames Fundament, Datenmodul und Twitch-Laufzeit liegen in /shared.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const web=fs.readFileSync("app/server.js","utf8"),core=fs.readFileSync("shared/bcc-core.js","utf8"),data=fs.readFileSync("shared/twitch-data.js","utf8"),rt=fs.readFileSync("shared/twitch-runtime.js","utf8");
test("Module laden ohne Nebenwirkung und prüfen ihre Abhängigkeiten",()=>{
  const {createCore}=require("../shared/bcc-core");assert.equal(typeof createCore,"function");
  const d=require("../shared/twitch-data");
  assert.throws(()=>d.createTwitchData({}),/Twitch-Daten: Abhängigkeit fehlt: FILES/);
  assert.deepEqual([...d.REQUIRED_DEPS],["FILES","DEFAULT_SETTINGS","pgStore","giveawayStore","readJson","writeJson","audit","getStreamInfo"]);
  const r=require("../shared/twitch-runtime");
  for(const n of ["prepareSettings","readWatchtime","writeWatchtime","readClipState","readGiveawayState"])assert.ok(r.REQUIRED_DEPS.includes(n),n);
});
test("Datenmodul arbeitet mit übergebenem Speicher (Verhalten)",async()=>{
  const {createTwitchData}=require("../shared/twitch-data");
  const docs=new Map(),FILES={settings:"s",watchtime:"w",usageStats:"u",clipState:"c",giveaways:"g"};
  const d=createTwitchData({FILES,DEFAULT_SETTINGS:{commands:[],autoReplies:[],timers:[]},pgStore:{enabled:false},
    giveawayStore:{read:()=>({current:null,history:[]}),write(){}},readJson:(f,fb)=>docs.has(f)?docs.get(f):fb,writeJson:(f,v)=>docs.set(f,v),audit(){},
    getStreamInfo:async()=>({live:true,streamId:"s1",startedAt:null})});
  assert.equal(d.twitchBlockedTermsChanged({blockedWords:[]},{blockedWords:[]}),false);
  assert.equal(d.twitchBlockedTermsChanged({blockedWords:[]},{blockedWords:[{id:"1",word:"abc",action:"twitch_block",enabled:true}]}),true);
  const s=d.prepareSettings({commands:[],autoReplies:[],timers:[]});
  assert.ok(s&&Array.isArray(s.commands));
  const view=await d.buildUsageStatsView();
  assert.equal(view.currentStream.live,true,"Live-Status kommt über getStreamInfo");
});
test("Fundament enthält, was beide Prozesse brauchen – und nichts von der Oberfläche",()=>{
  for(const name of ["FILES","DEFAULT_SETTINGS","pgStore","readJson","writeJson","audit","twitchAppFetch","discordServiceRequest","wordFilterRefresh","giveawayStore"])
    assert.match(core,new RegExp("(?<![\\w$])"+name+"(?![\\w$])"),name);
  const code=core.split("\n").map(l=>l.replace(/\/\/.*$/,"")).join("\n");
  assert.doesNotMatch(code,/http\.createServer|sessionStore|requireUser|LOCAL_ADMIN_PASSWORD|createTwitchRuntime|createStubenkontrolle/);
  assert.doesNotMatch(code,/applySecretFiles\(/,"Secrets übernimmt das jeweilige Startprogramm, bevor das Fundament entsteht");
  assert.ok(web.indexOf("applySecretFiles(CONTROL_CENTER_SECRETS")<web.indexOf("const core = createCore();"));
});
test("Wortfilter-Zustand ist im Fundament gekapselt",()=>{
  assert.match(core,/wordFilterCentralReady: \(\) => wordFilterCentralReady/);
  assert.doesNotMatch(web,/(?<![\w$.])(wordFilterCompiled|wordFilterCheckedAt|wordFilterRepeatState)\b/);
});
test("Twitch-Laufzeit und Datenmodul hängen nicht am Ordner der Oberfläche",()=>{
  for(const [name,src] of [["twitch-runtime",rt],["twitch-data",data],["bcc-core",core]]){
    assert.doesNotMatch(src,/require\(["']\.\.?\//,`${name} lädt nur aus /shared oder Node`);
    assert.doesNotMatch(src,/require\(["']\/app\//,name);
  }
  assert.ok(!fs.existsSync("app/twitch-runtime.js")&&!fs.existsSync("app/giveaway-store.js"));
});
