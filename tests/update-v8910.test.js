const appSource=require("./helpers/app-source");
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const core=require("../shared/update-core");
const {createUpdateService}=require("../shared/update-service");

const SHA="a".repeat(64);
function setup(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"upd-"));
  const dir=path.join(root,"approvals");
  for(const s of ["pending","results","granted","rejected"])fs.mkdirSync(path.join(dir,s),{recursive:true});
  return {root,dir,stateFile:path.join(root,"update-state.json")};
}
function notice(dir,v,extra={}){
  fs.writeFileSync(path.join(dir,"pending",`${v}.json`),JSON.stringify({version:v,status:"awaiting-approval",approvable:true,sha256:SHA,production_version:"8.9.9",summary:"Test",files:["a","b"],files_total:2,...extra}));
}
function result(dir,v,status,at=new Date().toISOString(),extra={}){
  fs.writeFileSync(path.join(dir,"results",`${v}.json`),JSON.stringify({version:v,status,sha256:SHA,message:"m",at,...extra}));
}
function fakeDiscord(opts={}){
  const calls=[];let maint=opts.maintenance===true;
  const fn=async(p,o={})=>{
    calls.push({p,body:o.body?JSON.parse(o.body):null,method:o.method||"GET"});
    if(p==="/channel-times")return {body:{maintenance:{active:maint}}};
    if(p==="/channel-times/maintenance"){
      if(opts.failMaintenance&&JSON.parse(o.body).active===opts.failMaintenance.active&&opts.failMaintenance.times-->0)throw new Error("Discord weg");
      maint=JSON.parse(o.body).active;return {body:{ok:true}};
    }
    if(opts.unreachable)throw new Error("down");
    return {body:{ok:true}};
  };
  fn.calls=calls;fn.maint=()=>maint;return fn;
}
function svc(env,discord,now){
  return createUpdateService({dir:env.dir,stateFile:env.stateFile,discord,appVersion:()=>"8.9.9",now:now||Date.now});
}

test("update-core: Hinweis wird gelesen, ungültige Dateien werden ignoriert",()=>{
  const e=setup();notice(e.dir,"8.9.10");
  fs.writeFileSync(path.join(e.dir,"pending","8.9.11.json"),"kein json");
  fs.writeFileSync(path.join(e.dir,"pending","8.9.12.json"),JSON.stringify({version:"8.9.99",status:"x"}));
  const n=core.readNotices(e.dir);
  assert.equal(n.length,1);assert.equal(n[0].version,"8.9.10");assert.equal(n[0].approvable,true);assert.equal(n[0].sha256Short,"a".repeat(12));
});
test("update-core: Symlinks und übergroße Dateien werden nicht gelesen",()=>{
  const e=setup();
  fs.writeFileSync(path.join(e.root,"x.json"),JSON.stringify({version:"8.9.10",status:"awaiting-approval"}));
  fs.symlinkSync(path.join(e.root,"x.json"),path.join(e.dir,"pending","8.9.10.json"));
  assert.equal(core.readNotice(e.dir,"8.9.10"),null);
  fs.writeFileSync(path.join(e.dir,"pending","8.9.11.json"),"{"+" ".repeat(300*1024)+"}");
  assert.equal(core.readNotice(e.dir,"8.9.11"),null);
  assert.equal(core.readNotice(e.dir,"../../etc/passwd"),null);
});
test("update-core: manual-required ist nicht freigabefähig",()=>{
  const e=setup();notice(e.dir,"8.9.10",{status:"manual-required",approvable:true});
  assert.equal(core.readNotice(e.dir,"8.9.10").approvable,false);
  assert.throws(()=>core.writeGrant(e.dir,{version:"8.9.10",sha256:SHA,by:"Mario"}),/nicht zur Freigabe/);
});
test("update-core: Freigabe-Datei hat das erwartete Format und lässt sich nicht überschreiben",()=>{
  const e=setup();notice(e.dir,"8.9.10");
  core.writeGrant(e.dir,{version:"8.9.10",sha256:SHA,by:"Mario"});
  const g=JSON.parse(fs.readFileSync(path.join(e.dir,"granted","8.9.10.json"),"utf8"));
  assert.deepEqual(Object.keys(g).sort(),["approved_at","approved_by","sha256","version","via"]);
  assert.equal(g.via,"control-center");assert.equal(g.sha256,SHA);
  assert.throws(()=>core.writeGrant(e.dir,{version:"8.9.10",sha256:SHA,by:"Mario"}),/bereits/);
  assert.equal(core.withdrawGrant(e.dir,"8.9.10"),true);
});
test("update-core: falsche Prüfsumme wird abgewiesen",()=>{
  const e=setup();notice(e.dir,"8.9.10");
  assert.throws(()=>core.writeGrant(e.dir,{version:"8.9.10",sha256:"b".repeat(64),by:"Mario"}),/Prüfsumme/);
});
test("plan: Warten, Abschluss, Zeitüberschreitung, Eingriff",()=>{
  const t0=Date.parse("2026-11-13T10:00:00Z");
  const active={version:"8.9.10",sha256:SHA,approvedAt:new Date(t0).toISOString(),maintenance:{startedByUpdate:true}};
  assert.equal(core.plan(active,null,t0+60e3).action,"wait");
  const timeout=core.plan(active,null,t0+21*60e3);
  assert.equal(timeout.action,"timeout");assert.equal(timeout.withdrawGrant,true);assert.equal(timeout.endMaintenance,true);
  const ok=core.plan(active,{version:"8.9.10",status:"deployed",sha256:SHA,at:new Date(t0+120e3).toISOString()},t0+130e3);
  assert.equal(ok.action,"finish");assert.equal(ok.outcome,"installed");assert.equal(ok.endMaintenance,true);
  const rb=core.plan(active,{version:"8.9.10",status:"failed-rolled-back",sha256:SHA,at:new Date(t0+120e3).toISOString()},t0+130e3);
  assert.equal(rb.outcome,"failed");assert.equal(rb.endMaintenance,true);
  const bad=core.plan(active,{version:"8.9.10",status:"failed-manual-recovery-required",sha256:SHA,at:new Date(t0+120e3).toISOString()},t0+130e3);
  assert.equal(bad.action,"attention");assert.equal(bad.endMaintenance,false);
  const run=core.plan(active,{version:"8.9.10",status:"deploying",sha256:SHA,at:new Date(t0+120e3).toISOString()},t0+10*60e3);
  assert.equal(run.action,"wait");
  assert.equal(core.plan(active,{version:"8.9.10",status:"deploying",sha256:SHA,at:new Date(t0+120e3).toISOString()},t0+61*60e3).action,"attention");
});
test("plan: alte Ergebnisse oder andere Prüfsumme gelten nicht für diese Freigabe",()=>{
  const t0=Date.parse("2026-11-13T10:00:00Z");
  const active={version:"8.9.10",sha256:SHA,approvedAt:new Date(t0).toISOString(),maintenance:{startedByUpdate:false}};
  assert.equal(core.plan(active,{version:"8.9.10",status:"failed-rolled-back",sha256:SHA,at:new Date(t0-3600e3).toISOString()},t0+60e3).action,"wait");
  assert.equal(core.plan(active,{version:"8.9.10",status:"deployed",sha256:"c".repeat(64),at:new Date(t0+1e3).toISOString()},t0+60e3).action,"wait");
});

test("Dienst: Freigabe aktiviert erst den Wartungsmodus, dann entsteht die Freigabedatei",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord();const s=svc(e,d);
  await s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"});
  assert.equal(d.maint(),true);
  assert.ok(fs.existsSync(path.join(e.dir,"granted","8.9.10.json")));
  const put=d.calls.find(c=>c.p==="/channel-times/maintenance");
  assert.deepEqual(put.body,{active:true},"nur {active} senden, damit Texte nicht überschrieben werden");
  assert.ok(d.calls.some(c=>c.p==="/system/update-event"&&c.body.eventKey==="system.update_started"));
  assert.equal(s.view().active.maintenance.startedByUpdate,true);
});
test("Dienst: Wartungsmodus nicht aktivierbar => keine Freigabe",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord({failMaintenance:{active:true,times:1}});const s=svc(e,d);
  await assert.rejects(()=>s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"}),/Wartungsmodus/);
  assert.ok(!fs.existsSync(path.join(e.dir,"granted","8.9.10.json")));
  assert.equal(s.view().active,null);
});
test("Dienst: falsche Bestätigung wird abgewiesen, nichts passiert",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord();const s=svc(e,d);
  await assert.rejects(()=>s.approve({version:"8.9.10",confirmVersion:"8.9.9",confirmSha:"a".repeat(12),by:"Mario"}),/Versionsnummer/);
  await assert.rejects(()=>s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"b".repeat(12),by:"Mario"}),/Prüfsumme/);
  assert.equal(d.calls.length,0);
});
test("Dienst: bereits aktiver Wartungsmodus bleibt nach dem Update bestehen",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord({maintenance:true});const s=svc(e,d);
  await s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"});
  assert.equal(s.view().active.maintenance.startedByUpdate,false);
  result(e.dir,"8.9.10","deployed",new Date(Date.now()+1000).toISOString());
  await s.tick();
  assert.equal(d.maint(),true);assert.equal(s.view().active,null);
});
test("Dienst: erfolgreiches Update beendet den Wartungsmodus und meldet Abschluss",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord();const s=svc(e,d);
  await s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"});
  await s.tick();assert.equal(d.maint(),true,"ohne Ergebnis bleibt der Wartungsmodus an");
  result(e.dir,"8.9.10","deployed",new Date(Date.now()+1000).toISOString());
  await s.tick();
  assert.equal(d.maint(),false);assert.equal(s.view().active,null);
  assert.ok(d.calls.some(c=>c.body?.eventKey==="system.update_finished"));
  assert.equal(s.view().history[0].outcome,"installed");
});
test("Dienst: Rollback beendet den Wartungsmodus und meldet den Fehlschlag",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord();const s=svc(e,d);
  await s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"});
  result(e.dir,"8.9.10","failed-rolled-back",new Date(Date.now()+1000).toISOString());
  await s.tick();
  assert.equal(d.maint(),false);
  assert.ok(d.calls.some(c=>c.body?.eventKey==="system.update_failed"));
});
test("Dienst: manueller Eingriff hält den Wartungsmodus und lässt sich bestätigen",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord();const s=svc(e,d);
  await s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"});
  result(e.dir,"8.9.10","failed-manual-recovery-required",new Date(Date.now()+1000).toISOString());
  await s.tick();await s.tick();
  assert.equal(d.maint(),true);assert.ok(s.view().active.attention);
  assert.equal(d.calls.filter(c=>c.body?.eventKey==="system.update_attention").length,1,"nur einmal melden");
  await assert.rejects(()=>s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"}),/läuft bereits/);
  await s.acknowledge({version:"8.9.10",by:"Mario",endMaintenance:true});
  assert.equal(d.maint(),false);assert.equal(s.view().active,null);
});
test("Dienst: Zeitüberschreitung zieht die Freigabe zurück und beendet den Wartungsmodus",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord();
  let t=Date.now();const s=svc(e,d,()=>t);
  await s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"});
  t+=21*60e3;await s.tick();
  assert.equal(d.maint(),false);
  assert.ok(!fs.existsSync(path.join(e.dir,"granted","8.9.10.json")));
  assert.ok(d.calls.some(c=>c.body?.eventKey==="system.update_failed"));
});
test("Dienst: Wartungsmodus-Ende scheitert => nächster Durchlauf versucht es erneut",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord({failMaintenance:{active:false,times:1}});const s=svc(e,d);
  await s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"});
  result(e.dir,"8.9.10","deployed",new Date(Date.now()+1000).toISOString());
  await s.tick();assert.equal(d.maint(),true);assert.ok(s.view().active);
  await s.tick();assert.equal(d.maint(),false);assert.equal(s.view().active,null);
});
test("Dienst: neue Version wird genau einmal in Discord angekündigt",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord();const s=svc(e,d);
  await s.tick();await s.tick();
  assert.equal(d.calls.filter(c=>c.body?.eventKey==="system.update_available").length,1);
});
test("Dienst: ohne eingebundenes Verzeichnis keine Freigabe",async()=>{
  const e=setup();fs.rmSync(path.join(e.dir,"granted"),{recursive:true});
  const s=svc(e,fakeDiscord());
  assert.equal(s.view().configured,false);
  await assert.rejects(()=>s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"}),/nicht eingebunden/);
});
test("Dienst: Ablehnung schreibt die Ablehnungsdatei",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const s=svc(e,fakeDiscord());
  await s.reject({version:"8.9.10",by:"Mario"});
  assert.ok(fs.existsSync(path.join(e.dir,"rejected","8.9.10.json")));
});

test("Server: Routen sind Owner-only eingetragen, Quelltext bindet Dienst, Timer und UI ein",()=>{
  const server=appSource();
  assert.match(server,/p==="\/api\/updates"\|\|p\.startsWith\("\/api\/updates\/"\)\)return"owner"/);
  assert.match(server,/createUpdateService\(/);
  assert.match(server,/updateService\.tick\(\)/);
  const ui=fs.readFileSync(path.join(__dirname,"../public/app.js"),"utf8");
  assert.match(ui,/tab:"updates",label:"Updates",ownerOnly:true/);
  assert.match(ui,/function renderUpdates/);
  assert.doesNotMatch(ui.slice(ui.indexOf("// ===== Updates (8.9.10)")),/onclick=/,"CSP: keine Inline-Handler");
  assert.match(fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8"),/<section id="updates"/);
});
test("Discord: Update-Ereignisse und Endpunkt vorhanden",()=>{
  const d=fs.readFileSync(path.join(__dirname,"../discord-app/discord-server.js"),"utf8");
  for(const k of ["available","started","finished","failed","attention"])assert.match(d,new RegExp(`"system\\.update_${k}"`));
  assert.match(d,/\/system\/update-event/);
});

test("8.9.11 Dienst: Freigabe ohne Wartungsmodus fasst den Discord-Dienst nicht für den Wartungsmodus an",async()=>{
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord();const s=svc(e,d);
  await s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario",skipMaintenance:true});
  assert.ok(fs.existsSync(path.join(e.dir,"granted","8.9.10.json")));
  assert.ok(!d.calls.some(c=>c.p.startsWith("/channel-times")));
  assert.equal(s.view().active.maintenance.skipped,true);
  result(e.dir,"8.9.10","deployed",new Date(Date.now()+1000).toISOString());
  await s.tick();
  assert.ok(!d.calls.some(c=>c.p==="/channel-times/maintenance"),"kein Beenden, weil nie gestartet");
  assert.equal(s.view().active,null);
});
test("8.9.11 UI: Knopf „Ohne Wartungsmodus freigeben“ sendet skipMaintenance und hat eigene Bestätigung",()=>{
  const ui=fs.readFileSync(path.join(__dirname,"../public/app.js"),"utf8");
  assert.match(ui,/Ohne Wartungsmodus freigeben/);
  assert.match(ui,/confirmSha:sha,skipMaintenance/);
  assert.match(ui,/Der Discord-Wartungsmodus wird NICHT aktiviert/);
});

test("8.9.12 Dienst: nicht beschreibbarer Freigabeordner => Abbruch VOR dem Wartungsmodus",async(t)=>{
  if(typeof process.getuid==="function"&&process.getuid()===0){t.skip("als root nicht prüfbar (Rechte werden ignoriert)");return;}
  const e=setup();notice(e.dir,"8.9.10");const d=fakeDiscord();const s=svc(e,d);
  fs.chmodSync(path.join(e.dir,"granted"),0o555);
  await assert.rejects(()=>s.approve({version:"8.9.10",confirmVersion:"8.9.10",confirmSha:"a".repeat(12),by:"Mario"}),/nicht beschreibbar/);
  assert.equal(d.calls.length,0,"Discord darf nicht angefasst werden");
  fs.chmodSync(path.join(e.dir,"granted"),0o755);
});
test("8.9.12 Probe: schreibbarer Ordner besteht, Probedatei bleibt nicht liegen",()=>{
  const e=setup();core.probeWritable(e.dir);
  assert.deepEqual(fs.readdirSync(path.join(e.dir,"granted")),[]);
});
test("8.9.12 Dienst: Probe läuft vor dem Wartungsmodus (Quelltext-Reihenfolge)",()=>{
  const src=fs.readFileSync(path.join(__dirname,"../shared/update-service.js"),"utf8");
  assert.ok(src.indexOf("probeWritable")<src.indexOf("already=await maintenanceActive()"),"probeWritable muss vor dem Wartungsmodus stehen");
});
test("8.9.12 UI: Fehler der Updates-Seite erscheinen als Fehlermeldung, Administration hat eigene Kopfzeile",()=>{
  const ui=fs.readFileSync(path.join(__dirname,"../public/app.js"),"utf8");
  const part=ui.slice(ui.indexOf("// ===== Updates (8.9.10)"));
  assert.equal((part.match(/"error",8000/g)||[]).length,3);
  assert.match(ui,/classList\.toggle\("admin-header"/);
  assert.match(fs.readFileSync(path.join(__dirname,"../public/style.css"),"utf8"),/\.section-nav-header\.admin-header\{flex-direction:column/);
});
