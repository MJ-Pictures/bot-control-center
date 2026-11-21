const appSource=require("./helpers/app-source");
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const root=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const csp=require("../shared/csp");

// Inline-Ereignisattribute wie onclick="…" in HTML/Template-Text (Zuweisungen wie btn.onclick=… sind erlaubt)
const INLINE_ATTR=/<[a-zA-Z][^<>]*\son[a-z]+\s*=\s*\\?["']/;

test("N-4/8.6.9: Hauptoberfläche enthält keine Inline-Ereignisattribute mehr",()=>{
  for(const f of ["public/index.html","public/app.js"]){
    const src=read(f);
    assert.equal(INLINE_ATTR.test(src),false,`${f}: Inline-Handler gefunden`);
    assert.equal(/javascript:/i.test(src),false,`${f}: javascript:-URL gefunden`);
  }
  assert.equal(/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(read("public/index.html")),false,"index.html: Inline-Skript");
});
test("N-4/8.6.9: Alle data-click-Aktionen haben eine Funktion und eine Zuordnung",()=>{
  const html=read("public/index.html"),js=read("public/app.js");
  const used=new Set([...(html+js).matchAll(/data-click="([A-Za-z]+)"/g)].map(m=>m[1]));
  assert.deepEqual([...used].sort(),["addAuto","addBlocked","addCommand","addGreeting","addTimer","saveAll","testMessage"]);
  const map=/const actions=\{([^}]*)\}/.exec(js);
  assert.ok(map,"Aktionstabelle fehlt");
  const mapped=map[1].split(",").map(x=>x.trim());
  for(const name of used){
    assert.ok(mapped.includes(name),`${name} fehlt in der Aktionstabelle`);
    assert.match(js,new RegExp(`(async\\s+)?function ${name}\\(`),`${name} ist nicht definiert`);
  }
  assert.match(js,/document\.addEventListener\("click",ev=>\{\s*const el=ev\.target instanceof Element\?ev\.target\.closest\("\[data-click\]"\)/);
});
test("N-4/8.6.9: Serverseitige Seiten haben keine Inline-Skripte mehr",()=>{
  const s=appSource();
  for(const m of s.matchAll(/<script\b([^>]*)>([\s\S]{0,40})/g)){
    assert.match(m[1],/\bsrc="\/[a-z-]+\.js"/,`Inline-Skript in server.js: <script${m[1]}>${m[2].slice(0,30)}`);
  }
  assert.match(s,/<script src="\/auth-callback\.js"><\/script>/);
  assert.match(s,/<script src="\/auth-denied\.js"><\/script>/);
  assert.match(s,/id="count" class="count" data-seconds="\$\{wait\}"/);
});
test("N-4/8.6.9: Rückmelde-Skripte verhalten sich wie die früheren Inline-Skripte",()=>{
  const calls=[];
  const run=(file,env)=>new Function("window","setTimeout","location","document","setInterval","clearInterval",read(file))(...env);
  // Anmelde-Rückmeldung mit Opener: Nachricht senden, Fenster schließen
  const posted=[];
  run("public/auth-callback.js",[{opener:{postMessage:(m,o)=>posted.push([m,o])},close:()=>calls.push("close")},(fn,ms)=>{calls.push("t"+ms);fn();},{replace:u=>calls.push("replace "+u)},{},()=>{},()=>{}]);
  assert.deepEqual(posted,[[{type:"bwk-auth-linked"},"*"]]);
  assert.deepEqual(calls,["t1200","close"]);
  // ohne Opener: zur Startseite
  calls.length=0;
  run("public/auth-callback.js",[{opener:null,close:()=>calls.push("close")},(fn,ms)=>{calls.push("t"+ms);fn();},{replace:u=>calls.push("replace "+u)},{},()=>{},()=>{}]);
  assert.deepEqual(calls,["t1500","replace /"]);
  // Abgelehnt-Seite: Zähler zählt herunter, leitet bei 0 um
  calls.length=0;
  const el={dataset:{seconds:"2"},textContent:"2"};
  let tick;
  run("public/auth-denied.js",[{},()=>{},{replace:u=>calls.push("replace "+u)},{getElementById:id=>id==="count"?el:null},fn=>{tick=fn;return 1;},()=>calls.push("clear")]);
  tick();assert.equal(el.textContent,1);assert.deepEqual(calls,[]);
  tick();assert.equal(el.textContent,0);assert.deepEqual(calls,["clear","replace /"]);
});
test("N-4/8.6.9: Die erzwungene Policy der Hauptoberfläche hat kein unsafe-inline/unsafe-eval für Skripte",()=>{
  const p=csp.cspHeaders("/")["Content-Security-Policy"];
  assert.match(p,/script-src 'self';/);
  assert.match(p,/script-src-attr 'none'/);
  assert.doesNotMatch(p,/script-src[^;]*unsafe-/);
  assert.doesNotMatch(p,/unsafe-eval/);
  assert.match(p,/connect-src 'self';/);
  assert.equal("Content-Security-Policy-Report-Only" in csp.cspHeaders("/"),false);
  assert.match(appSource(),/cspViolations:cspReports\.summary\(\)/);
});
