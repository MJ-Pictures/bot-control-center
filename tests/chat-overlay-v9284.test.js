"use strict";
// 9.28.4: Chat-Overlay weicht dem Punktespiel aus.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const {createChatOverlay,normalizeConfig,DEFAULT_CONFIG}=require("../app/chat-overlay");
const root=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");

test("Standard: nichts tun",()=>{
  assert.equal(DEFAULT_CONFIG.gameDodge,"none"); assert.equal(DEFAULT_CONFIG.gameDodgeDim,30); assert.equal(DEFAULT_CONFIG.gameDodgeShift,360);
});
test("Normalisierung",()=>{
  const c=normalizeConfig({gameDodge:"up",gameDodgeDim:"10",gameDodgeShift:"500"});
  assert.equal(c.gameDodge,"up"); assert.equal(c.gameDodgeDim,10); assert.equal(c.gameDodgeShift,500);
  for(const bad of [{gameDodge:"x"},{gameDodgeDim:91},{gameDodgeShift:901},{gameDodgeShift:-1}]) assert.throws(()=>normalizeConfig(bad));
  for(const m of ["none","dim","hide","up"]) assert.equal(normalizeConfig({gameDodge:m}).gameDodge,m);
});
function sse(o){
  const frames=[];
  o.addSseClient({writeHead(){},write(f){frames.push(String(f));return true;},end(){},on(){},writableLength:0},{on(){}},"2.2.2.2");
  return frames;
}
test("Spielphase: Start, Wechsel und neue Verbindung",()=>{
  const o=createChatOverlay({read:()=>({}),write:()=>{},now:()=>Date.now()});
  const a=sse(o);
  assert.ok(a.some(f=>f.includes("event: game")&&f.includes('"idle"')));
  assert.equal(o.setGamePhase("registration"),true);
  assert.ok(a.at(-1).includes("event: game")&&a.at(-1).includes("registration"));
  assert.equal(o.setGamePhase("registration"),false);         // kein doppeltes Senden
  assert.equal(o.setGamePhase("control"),true);
  assert.equal(o.setGamePhase("result"),true);
  assert.equal(o.setGamePhase("quatsch"),true);               // unbekannt gilt als idle
  assert.ok(a.at(-1).includes('"idle"'));
  o.setGamePhase("control");
  const b=sse(o);
  assert.ok(b.some(f=>f.includes("event: game")&&f.includes("control")));
});
test("Konfiguration enthält die Ausweichwerte für das Overlay",()=>{
  assert.match(read("app/chat-overlay.js"),/gameDodge: config\.gameDodge, gameDodgeDim: config\.gameDodgeDim, gameDodgeShift: config\.gameDodgeShift/);
});
test("Stubenkontrolle meldet nur Phasenwechsel",()=>{
  const os=require("os");
  const {createStubenkontrolle}=require("../app/stubenkontrolle");
  const seen=[];
  const e=createStubenkontrolle({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),"stube-")),sendChat(){},resolveUser(){return null;},audit(){},onPhase:p=>seen.push(p)});
  assert.equal(typeof e,"object");
  const src=read("app/stubenkontrolle.js");
  assert.match(src,/function notifyPhase\(phase\)\{ if\(!onPhase\|\|phase===lastPhase\) return;/);
  assert.match(src,/notifyPhase\(isActive\(\)\?state\.phase:"idle"\)/);
  assert.match(read("app/server.js"),/onPhase:phase=>\{try\{chatOverlay\.setGamePhase\(phase\);\}catch\{\}\}/);
});
test("Overlay-Seite und Skript",()=>{
  const h=read("public/chat-overlay.html");
  for(const m of ["dim","hide","up"]) assert.ok(h.includes(`body[data-dodge="${m}"] #chat`),m);
  assert.match(h,/body\[data-dodge="up"\]\[data-anchor="top"\] #chat\{transform:translateY\(var\(--dodge-shift/);
  const j=read("public/chat-overlay.js");
  assert.match(j,/addEventListener\("game"/); assert.match(j,/dataset\.dodge = active \? mode : "none"/);
  assert.match(j,/gamePhase !== "idle"/);
});
test("Admin-Oberfläche",()=>{
  const a=read("public/app.js");
  for(const k of ["coDodge","coDodgeDim","coDodgeShift","gameDodge:$(\"coDodge\")"]) assert.ok(a.includes(k),k);
});
test("Release-Dateien",()=>{
  assert.match(read("VERSION"),/^9\.(28\.4|29\.)/);
  assert.ok(!fs.existsSync(path.join(root,"UPDATE-9.28.3.md")));
  assert.ok(JSON.parse(read("public/changelog.json")).versions.some(v=>v.version==="9.28.4"));
});
