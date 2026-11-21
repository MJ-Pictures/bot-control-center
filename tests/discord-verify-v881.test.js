const appSource=require("./helpers/app-source");
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const src=appSource();
const handler=(()=>{
  const i=src.indexOf('u.pathname === "/api/discord/verify" && req.method === "POST"');
  assert.ok(i>0,"verify-Handler fehlt");
  // Kommentarzeilen ausblenden, damit nur ausführbarer Code geprüft wird.
  const rest=src.slice(i);
  const end=rest.indexOf("\n    if (u.pathname",10);
  return rest.slice(0,end>0?end:1600).split("\n").filter(l=>!l.trim().startsWith("//")).join("\n");
})();

test("8.8.1: /api/discord/verify prüft das Dashboard-Recht ausdrücklich, nicht mehr jedes discord.*-Recht",()=>{
  assert.match(handler,/requireCapability\(req,res,"discord\.dashboard\.view"\)/);
  assert.ok(!/requireDiscordRole/.test(handler),"requireDiscordRole darf im verify-Handler nicht mehr vorkommen");
});
test("8.8.1: /api/discord/verify ist gedrosselt und antwortet mit 429 und Retry-After",()=>{
  assert.match(handler,/discordVerifyThrottle\.check\(\)/);
  assert.match(handler,/json\(res,429,/);
  assert.match(handler,/"Retry-After"/);
  assert.ok(handler.indexOf("discordVerifyThrottle.check()")<handler.indexOf("discordServiceRequest"),"Drosselung muss vor dem Discord-Aufruf stehen");
});
test("8.8.1: Matrix ordnet die Route weiter dem Dashboard-Recht zu",()=>{
  assert.match(src,/p==="\/api\/discord\/status"\|\|p==="\/api\/discord\/verify"\)return"discord\.dashboard\.view"/);
});
test("8.8.1: Drosselung lässt nach dem Mindestabstand wieder zu",()=>{
  const m=/const DISCORD_VERIFY_MIN_INTERVAL_MS = (\d+);\nconst discordVerifyThrottle = (\{[\s\S]*?\n\});/.exec(src);
  assert.ok(m,"Drosselung nicht gefunden");
  const interval=Number(m[1]);
  const t=new Function(`const DISCORD_VERIFY_MIN_INTERVAL_MS=${interval};return ${m[2]};`)();
  const base=1.7e12; // realistische Epoche in ms
  assert.equal(t.check(base),0,"erste Prüfung erlaubt");
  assert.equal(t.check(base+interval-1),1,"1 ms vor Ablauf gesperrt");
  assert.equal(t.check(base+interval),0,"nach dem Mindestabstand wieder erlaubt");
  assert.ok(t.check(base+interval+5)>0,"direkt danach wieder gesperrt");
  assert.ok(interval>=10000&&interval<=60000,"Abstand im sinnvollen Bereich");
});
