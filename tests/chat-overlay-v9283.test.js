"use strict";
// 9.28.3: Chat-Overlay – Deckkraft, Textschatten, Spielmeldungen im Chat ausblendbar.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const {createChatOverlay,normalizeConfig,DEFAULT_CONFIG}=require("../app/chat-overlay");
const root=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");

test("Standardwerte entsprechen dem bisherigen Verhalten",()=>{
  assert.equal(DEFAULT_CONFIG.bubbleOpacity,100);
  assert.equal(DEFAULT_CONFIG.textShadow,"off");
  assert.equal(DEFAULT_CONFIG.gameMessages,"show");
});
test("Normalisierung prüft die neuen Felder",()=>{
  const c=normalizeConfig({bubbleOpacity:"55",textShadow:"strong",gameMessages:"hide"});
  assert.equal(c.bubbleOpacity,55); assert.equal(c.textShadow,"strong"); assert.equal(c.gameMessages,"hide");
  for(const bad of [{bubbleOpacity:5},{bubbleOpacity:101},{textShadow:"x"},{gameMessages:"x"}]) assert.throws(()=>normalizeConfig(bad));
});
test("Overlay bekommt Deckkraft und Textschatten, Spielmeldungen nicht",()=>{
  const src=read("app/chat-overlay.js");
  assert.match(src,/bubbleOpacity: config\.bubbleOpacity, textShadow: config\.textShadow/);
  assert.doesNotMatch(src.slice(src.indexOf("const publicConfig"),src.indexOf("const IMAGE_URL")),/gameMessages/);
});
function make(cfg){
  const sent=[];
  const o=createChatOverlay({read:()=>cfg,write:()=>{},now:()=>Date.now()});
  o.addSseClient({writeHead(){},write(f){sent.push(f);},on(){},end(){},writableLength:0},{on(){}},"1.1.1.1");
  return {o,sent};
}
test("Spielmeldungen: hide blendet nur das Chat-Spiel aus",()=>{
  const {o:hide}=make({botMessages:"all",gameMessages:"hide"});
  assert.equal(hide.handleBotMessage({source:"stubenkontrolle",name:"Bot",text:"Runde"}),false);
  assert.equal(hide.handleBotMessage({source:"anderes",name:"Bot",text:"Hallo"}),true);
  const {o:show}=make({botMessages:"game",gameMessages:"show"});
  assert.equal(show.handleBotMessage({source:"stubenkontrolle",name:"Bot",text:"Runde"}),true);
  const {o:old}=make({botMessages:"game"});
  assert.equal(old.handleBotMessage({source:"stubenkontrolle",name:"Bot",text:"Runde"}),true);
});
test("Overlay-Seite: Blasen nutzen --bo, Namensleiste nicht, Textschatten vorhanden",()=>{
  const h=read("public/chat-overlay.html");
  assert.match(h,/rgba\(22,25,30,calc\(\.9\*var\(--bo,1\)\)\)/);
  assert.match(h,/rgba\(247,247,244,var\(--bo,1\)\)/);
  assert.match(h,/rgba\(244,244,240,var\(--bo,1\)\)/);
  assert.doesNotMatch(h,/\.tab\{[^}]*--bo/);
  assert.match(h,/body\[data-tshadow="strong"\] \.bubble/);
  const j=read("public/chat-overlay.js");
  assert.match(j,/setProperty\("--bo"/); assert.match(j,/dataset\.tshadow/);
});
test("Admin-Oberfläche speichert die neuen Felder",()=>{
  const a=read("public/app.js");
  for(const k of ["coBubOpacity","coTextShadow","coGameMsgs","bubbleOpacity:Number","gameMessages:$"]) assert.ok(a.includes(k),k);
});
test("Release-Dateien",()=>{
  assert.match(read("VERSION"),/^9\.(28|29)\./);
  assert.ok(JSON.parse(read("public/changelog.json")).versions.some(v=>v.version==="9.28.3"));
});
