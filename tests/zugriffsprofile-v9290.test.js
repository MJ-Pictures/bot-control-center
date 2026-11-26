"use strict";
// 9.29.0: Zugriffsprofile (benannte Rechtesätze, live verknüpft, Zuweisung und automatische Regeln).
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const ap=require("../app/access-profiles");
const root=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ALLOWED=new Set(["twitch.dashboard.view","twitch.commands.view","twitch.commands.edit","discord.members.view"]);
const sanitize=l=>{const out=new Set((l||[]).map(String).filter(x=>ALLOWED.has(x)));for(const x of [...out])if(x.endsWith(".edit"))out.add(x.replace(/\.edit$/,".view"));return [...out].filter(x=>ALLOWED.has(x));};
const empty=()=>ap.normalizeStore({}, sanitize);

test("Leerer Speicher ist gültig",()=>{ assert.deepEqual(empty(),{profiles:[],assignments:{},rules:[]}); assert.deepEqual(ap.normalizeStore(null,sanitize),{profiles:[],assignments:{},rules:[]}); });

test("Profil anlegen: Name Pflicht und eindeutig, Rechte bereinigt, Bearbeiten ⇒ Ansehen",()=>{
  const s=empty();
  assert.throws(()=>ap.createProfile(s,{name:"  "},sanitize),/Namen/);
  const p=ap.createProfile(s,{name:"Mods",description:"Team",capabilities:["twitch.commands.edit","unbekannt"]},sanitize,"mario");
  assert.deepEqual(p.capabilities.sort(),["twitch.commands.edit","twitch.commands.view"]);
  assert.equal(p.updatedBy,"mario"); assert.match(p.id,/^p[0-9a-f]{12}$/);
  assert.throws(()=>ap.createProfile(s,{name:"mods"},sanitize),/schon/);
});

test("Profil ändern wirkt auf alle Zugewiesenen (live), Duplikatname gegen sich selbst erlaubt",()=>{
  const s=empty();
  const a=ap.createProfile(s,{name:"A",capabilities:["twitch.dashboard.view"]},sanitize);
  const b=ap.createProfile(s,{name:"B"},sanitize);
  ap.assign(s,"u1",[a.id]); ap.assign(s,"u2",[a.id,b.id]);
  assert.deepEqual(ap.capabilitiesFor(s,{userId:"u1"},sanitize),["twitch.dashboard.view"]);
  ap.updateProfile(s,a.id,{name:"A",capabilities:["twitch.commands.view"]},sanitize);
  assert.deepEqual(ap.capabilitiesFor(s,{userId:"u1"},sanitize),["twitch.commands.view"]);
  assert.deepEqual(ap.capabilitiesFor(s,{userId:"u2"},sanitize),["twitch.commands.view"]);
  assert.throws(()=>ap.updateProfile(s,a.id,{name:"b"},sanitize),/schon/);
  assert.throws(()=>ap.updateProfile(s,"nix",{name:"X"},sanitize),/nicht gefunden/);
});

test("Mehrere Profile werden vereinigt",()=>{
  const s=empty();
  const a=ap.createProfile(s,{name:"A",capabilities:["twitch.dashboard.view"]},sanitize);
  const b=ap.createProfile(s,{name:"B",capabilities:["discord.members.view"]},sanitize);
  ap.assign(s,"u",[a.id,b.id]);
  assert.deepEqual(ap.capabilitiesFor(s,{userId:"u"},sanitize).sort(),["discord.members.view","twitch.dashboard.view"]);
  assert.deepEqual(ap.capabilitiesFor(s,{userId:"niemand"},sanitize),[]);
});

test("Zuweisung prüft unbekannte Profile und entfernt bei leerer Liste",()=>{
  const s=empty(); const a=ap.createProfile(s,{name:"A"},sanitize);
  assert.throws(()=>ap.assign(s,"u",["fehlt"]),/Unbekannt/);
  ap.assign(s,"u",[a.id,a.id]); assert.deepEqual(s.assignments.u,[a.id]);
  ap.assign(s,"u",[]); assert.equal(s.assignments.u,undefined);
});

test("Löschen räumt Zuweisungen und Regeln auf und meldet Betroffene",()=>{
  const s=empty(); const a=ap.createProfile(s,{name:"A"},sanitize); const b=ap.createProfile(s,{name:"B"},sanitize);
  ap.assign(s,"u1",[a.id]); ap.assign(s,"u2",[a.id,b.id]);
  ap.setRules(s,[{type:"twitch-moderator",profileId:a.id},{type:"discord-role",roleId:"123456789",profileId:b.id}]);
  const r=ap.deleteProfile(s,a.id);
  assert.deepEqual(r.users.sort(),["u1","u2"]); assert.equal(r.rules,1);
  assert.equal(s.assignments.u1,undefined); assert.deepEqual(s.assignments.u2,[b.id]);
  assert.equal(s.rules.length,1); assert.equal(s.rules[0].profileId,b.id);
  assert.throws(()=>ap.deleteProfile(s,a.id),/nicht gefunden/);
});

test("Automatische Regeln: Twitch-Moderator und Discord-Rolle",()=>{
  const s=empty(); const a=ap.createProfile(s,{name:"Mods",capabilities:["twitch.commands.view"]},sanitize); const b=ap.createProfile(s,{name:"Disc",capabilities:["discord.members.view"]},sanitize);
  ap.setRules(s,[{type:"twitch-moderator",profileId:a.id},{type:"discord-role",roleId:"111222333",profileId:b.id}]);
  assert.deepEqual(ap.capabilitiesFor(s,{twitchModerator:true},sanitize),["twitch.commands.view"]);
  assert.deepEqual(ap.capabilitiesFor(s,{twitchModerator:false},sanitize),[]);
  assert.deepEqual(ap.capabilitiesFor(s,{guildRoles:["999","111222333"]},sanitize),["discord.members.view"]);
  assert.deepEqual(ap.capabilitiesFor(s,{guildRoles:["999"]},sanitize),[]);
  // zusätzlich zu manueller Zuweisung, ohne Doppelungen
  ap.assign(s,"u",[a.id]);
  assert.deepEqual(ap.capabilitiesFor(s,{userId:"u",twitchModerator:true},sanitize),["twitch.commands.view"]);
});

test("Regeln werden geprüft",()=>{
  const s=empty(); const a=ap.createProfile(s,{name:"A"},sanitize);
  assert.throws(()=>ap.setRules(s,[{type:"discord-role",roleId:"abc",profileId:a.id}]),/unvollständig/);
  assert.throws(()=>ap.setRules(s,[{type:"x",profileId:a.id}]),/unvollständig/);
  assert.throws(()=>ap.setRules(s,[{type:"twitch-moderator",profileId:"fehlt"}]),/unvollständig/);
  assert.throws(()=>ap.setRules(s,Array.from({length:51},(_, i)=>({type:"discord-role",roleId:String(100000+i),profileId:a.id}))),/Höchstens/);
  assert.deepEqual(ap.setRules(s,[]),[]);
  const r=ap.setRules(s,[{type:"twitch-moderator",profileId:a.id},{type:"twitch-moderator",profileId:a.id}]);
  assert.equal(r.length,1);                                    // Doppelte Regel entfällt
});

test("Normalisierung verwirft Kaputtes aus dem Dokument",()=>{
  const s=ap.normalizeStore({profiles:[{id:"p1",name:"A",capabilities:["twitch.dashboard.view","kaputt"]},{id:"p1",name:"Doppelt"},{name:"ohne id"},{id:"p2",name:""}],
    assignments:{u:["p1","weg"],v:["weg"]},rules:[{id:"r",type:"twitch-moderator",profileId:"p1"},{type:"twitch-moderator",profileId:"weg"}]},sanitize);
  assert.equal(s.profiles.length,1); assert.deepEqual(s.profiles[0].capabilities,["twitch.dashboard.view"]);
  assert.deepEqual(s.assignments,{u:["p1"]}); assert.equal(s.rules.length,1);
});

test("Begrenzungen: höchstens 50 Profile",()=>{
  const s=empty(); for(let i=0;i<ap.MAX_PROFILES;i++)ap.createProfile(s,{name:"P"+i},sanitize);
  assert.throws(()=>ap.createProfile(s,{name:"zu viel"},sanitize),/Höchstens/);
});

test("Server: Dokument registriert, Rechte in effectiveSessionUser, Routen nur für Administratoren",()=>{
  assert.match(read("shared/bcc-core.js"),/accessProfiles: path\.join\(DATA_DIR, "access-profiles\.json"\)/);
  assert.match(read("shared/bcc-core.js"),/\[FILES\.accessProfiles,"access-profiles"\]/);
  const s=read("app/server.js");
  assert.match(s,/accessProfiles\.capabilitiesFor\(readAccessProfiles\(\),\{/);
  assert.match(s,/twitchModerator:externalFresh&&raw\.authProvider!=="discord"&&!!raw\.isModerator/);
  assert.match(s,/p\.startsWith\("\/api\/access-profiles\/"\)\)return"admin"/);
  for(const route of ['"/api/access-profiles" && req.method === "GET"','"/api/access-profiles" && req.method === "POST"','"/api/access-profiles/rules" && req.method === "PUT"','endsWith("/profiles") && req.method === "PUT"'])
    assert.ok(s.includes(route),route);
  const handlers=s.slice(s.indexOf("// 9.29.0: Zugriffsprofile\n    if (u.pathname"),s.indexOf('endsWith("/capabilities") && req.method === "PUT"'));
  assert.equal((handlers.match(/requireGlobalAdmin\(req,res\)/g)||[]).length,5);
  assert.match(s,/profileIds:list/); assert.match(s,/user\.profiles\.updated/);
  assert.match(s,/accessProfiles:readAccessProfiles\(\)/);
});

test("Oberfläche, Release-Dateien",()=>{
  const a=read("public/app.js");
  for(const k of ["renderProfilesPanel","profileRow","save-user-profiles","/api/access-profiles/rules","Zusätzliche Einzelrechte","matrixHtml("]) assert.ok(a.includes(k),k);
  assert.match(read("VERSION"),/^9\.29\./);
  assert.ok(!fs.existsSync(path.join(root,"UPDATE-9.28.4.md")));
  assert.ok(JSON.parse(read("public/changelog.json")).versions.some(v=>v.version==="9.29.0"));
  assert.match(read("public/style.css"),/\.rule-row\{/);
});
