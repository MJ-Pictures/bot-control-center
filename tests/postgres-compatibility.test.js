"use strict";

const assert = require("assert");
const { createFollowathon } = require("../app/followathon");
const { createPgSyncStore } = require("../shared/pg-sync-store");

class MemoryDocumentStore {
  constructor(){ this.enabled=true; this.docs=new Map(); this.writes=0; }
  getDocument(key,fallback={}){
    if(!this.docs.has(key)) return JSON.parse(JSON.stringify(fallback));
    return JSON.parse(JSON.stringify(this.docs.get(key)));
  }
  putDocument(key,value){ this.docs.set(key,JSON.parse(JSON.stringify(value))); this.writes++; return {ok:true}; }
}

(async()=>{
  // The compatibility module must remain usable in legacy/json mode without pg installed.
  const disabled=createPgSyncStore({backend:"json",namespace:"test",service:"test"});
  assert.strictEqual(disabled.enabled,false);
  assert.deepStrictEqual(disabled.status(),{enabled:false,backend:"json"});

  // Followathon must persist through the injected database interface instead of the file.
  const store=new MemoryDocumentStore();
  const fa=createFollowathon({file:"/definitely/not/used/followathon.json",storage:store,storageKey:"followathon",audit:()=>{}});
  await fa.createEvent({name:"DB Test",startDurationSeconds:300,secondsPerFollow:60,creditAcceptance:true},"tester");
  await fa.action("start",{},"tester");
  const before=await fa.getAdminState();
  assert.strictEqual(before.event.name,"DB Test");
  assert.strictEqual(before.event.status,"running");

  const followedAt=new Date().toISOString();
  const result=await fa.handleFollow({user_id:"42",user_name:"TestFollower",followed_at:followedAt},{message_id:"msg-42"});
  assert.strictEqual(result.decision,"credited");
  assert.strictEqual(result.creditedSeconds,60);
  assert.ok(store.writes>=3,"Followathon should persist state in the injected store");

  // A fresh module instance must recover the exact stored event state.
  const fa2=createFollowathon({file:"/definitely/not/used/followathon.json",storage:store,storageKey:"followathon",audit:()=>{}});
  const after=await fa2.getAdminState();
  assert.strictEqual(after.event.followCount,1);
  assert.strictEqual(after.event.creditedSeconds,60);
  const stored=store.getDocument("followathon",{});
  const rawEvent=(stored.events||[]).find(e=>e.id===stored.currentEventId);
  assert.ok(rawEvent?.users?.["42"]);

  console.log("postgres-compatibility.test.js: OK");
})().catch(err=>{ console.error(err); process.exit(1); });
