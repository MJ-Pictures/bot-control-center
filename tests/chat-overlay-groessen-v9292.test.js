"use strict";
// 9.29.2: Chat-Overlay – Gesamtgröße, Schriftgröße und Größe der Grafiken einstellbar.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const {createChatOverlay,normalizeConfig,DEFAULT_CONFIG}=require("../app/chat-overlay");
const root=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");

test("Standardwerte entsprechen dem bisherigen Verhalten (100 %)",()=>{
  assert.equal(DEFAULT_CONFIG.overallScale,100);
  assert.equal(DEFAULT_CONFIG.fontScale,100);
  assert.equal(DEFAULT_CONFIG.graphicScale,100);
});
test("Normalisierung: Gesamtgröße 30–200, Schrift 50–200, Grafiken 50–200",()=>{
  const c=normalizeConfig({overallScale:"45",fontScale:55,graphicScale:200});
  assert.equal(c.overallScale,45); assert.equal(c.fontScale,55); assert.equal(c.graphicScale,200);
  assert.equal(normalizeConfig({overallScale:30}).overallScale,30);
  assert.equal(normalizeConfig({overallScale:200}).overallScale,200);
  assert.equal(normalizeConfig({fontScale:50}).fontScale,50);
  for(const bad of [{overallScale:29},{overallScale:201},{overallScale:"x"},{overallScale:50.5},{fontScale:49},{fontScale:201},{graphicScale:49},{graphicScale:201},{graphicScale:null}])
    assert.throws(()=>normalizeConfig(bad),bad.toString());
});
test("Frühere Werte bleiben gültig (Schrift 70–160), Gespeichertes ohne neue Felder bekommt 100 %",()=>{
  for(const v of [70,100,160]) assert.equal(normalizeConfig({fontScale:v}).fontScale,v);
  const old=normalizeConfig({fontScale:120,theme:"light"},DEFAULT_CONFIG,false);
  assert.equal(old.overallScale,100); assert.equal(old.graphicScale,100); assert.equal(old.fontScale,120);
  // Ungültige gespeicherte Werte fallen beim Laden auf den Standard zurück
  const bad=normalizeConfig({overallScale:5000,graphicScale:-3},DEFAULT_CONFIG,false);
  assert.equal(bad.overallScale,100); assert.equal(bad.graphicScale,100);
});
test("Overlay-Quelle bekommt die Größen; Konfiguration wird gespeichert",()=>{
  const sent=[]; let saved=null;
  const o=createChatOverlay({read:()=>({}),write:c=>{saved=c;},now:()=>Date.now()});
  const cfg=o.configure({overallScale:60,graphicScale:140});
  assert.equal(cfg.overallScale,60); assert.equal(cfg.graphicScale,140); assert.equal(cfg.fontScale,100);
  assert.equal(saved.overallScale,60);
  const src=read("app/chat-overlay.js");
  assert.match(src,/fontScale: config\.fontScale, overallScale: config\.overallScale, graphicScale: config\.graphicScale/);
  o.addSseClient({writeHead(){},write(f){sent.push(String(f));},on(){},end(){},writableLength:0},{on(){}},"1.1.1.1");
  assert.ok(sent.join("").includes('"overallScale":60'));
});
test("Overlay-Seite: Größen werden als CSS-Variablen gesetzt, Grafiken und Breite folgen ihnen",()=>{
  const js=read("public/chat-overlay.js"),css=read("public/chat-overlay.html");
  for(const k of ['"--scale"','"--gr"','"--ov"',"cfg.overallScale","cfg.graphicScale","cfg.fontScale"]) assert.ok(js.includes(k),k);
  assert.match(js,/o \* f \/ 10000/);          // Schriftgröße = Gesamtgröße × Schrift
  assert.match(js,/g \/ f/);                    // Grafiken unabhängig von der Schrift
  assert.match(css,/width:min\(calc\(100% - 2\*var\(--mx,24px\)\),calc\(var\(--ov,1\)\*min\(max\(36vw,380px\),780px\)\)\)/);
  for(const sel of [".dot{",".badge{",".emote{",".stack .zw{",".ico{"]) { const i=css.indexOf(sel); assert.ok(i>=0,sel); assert.match(css.slice(i,i+220),/var\(--gr,1\)/,sel); }
  // Ohne Einstellung (Variablen fehlen) gelten 100 %: Rückfallwert 1 in jeder Verwendung
  assert.doesNotMatch(css,/var\(--gr\)|var\(--ov\)/);
});
test("Vorschau per Adresse: ?overall=…&text=…&graphics=… nur im Vorschaumodus",()=>{
  const js=read("public/chat-overlay.js");
  const i=js.indexOf("if (demo) { // Nur in der Vorschau");
  assert.ok(i>0);
  assert.match(js.slice(i,i+900),/\["overall", "overallScale"\], \["text", "fontScale"\], \["graphics", "graphicScale"\]/);
});
test("Administration: drei Eingabefelder, werden mitgespeichert",()=>{
  const a=read("public/app.js");
  for(const k of ['id="coOverall"','id="coScale"','id="coGraphic"','overallScale:Number($("coOverall").value)','graphicScale:Number($("coGraphic").value)','fontScale:Number($("coScale").value)',"Gesamtgröße in Prozent (30–200)","Schriftgröße in Prozent (50–200)","Größe der Grafiken in Prozent (50–200)"]) assert.ok(a.includes(k),k);
});
test("Release-Dateien",()=>{
  assert.match(read("VERSION"),/^9\.29\.2/);
  assert.equal(JSON.parse(read("public/version.json")).version,"9.29.2");
  assert.ok(fs.existsSync(path.join(root,"UPDATE-9.29.2.md"))); assert.ok(!fs.existsSync(path.join(root,"UPDATE-9.29.1.md")));
  assert.ok(JSON.parse(read("public/changelog.json")).versions.some(v=>v.version==="9.29.2"));
});
