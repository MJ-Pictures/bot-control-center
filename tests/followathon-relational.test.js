"use strict";

const assert = require("assert");
const { createFollowathon } = require("../app/followathon");

function clone(v){return JSON.parse(JSON.stringify(v));}
class FakeFollowathonStore {
  constructor(legacy){this.enabled=true;this.legacy=legacy;this.state=null;this.revision=0;this.imports=[];}
  getFollowathonState(){return this.state?{found:true,state:clone(this.state),revision:this.revision}:{found:false};}
  hasDocument(key){return key==="followathon"&&!!this.legacy;}
  getDocument(){return clone(this.legacy);}
  importFollowathonStateIfEmpty(state){if(this.state)return {inserted:false,revision:this.revision};this.state=clone(state);this.revision=1;return {inserted:true,revision:1};}
  putFollowathonState(state,expectedRevision){
    if(expectedRevision!==null&&expectedRevision!==undefined&&Number(expectedRevision)!==this.revision){const e=new Error("revision conflict");e.code="FOLLOWATHON_REVISION_CONFLICT";throw e;}
    this.state=clone(state);this.revision+=1;return {revision:this.revision};
  }
  markImport(sourceKey,sourceSha256,details){this.imports.push({sourceKey,sourceSha256,details});return {inserted:true};}
}

(async()=>{
  const legacy={schema:1,currentEventId:null,events:[],seenMessageIds:{},config:{retentionDays:90,anomalyThreshold:15,anomalyWindowSeconds:60}};
  const store=new FakeFollowathonStore(legacy);
  const fa=createFollowathon({file:"/not-used/followathon.json",storage:store,storageKey:"followathon",audit:()=>{}});
  assert.strictEqual(store.revision,1,"legacy JSONB should be imported once");
  assert.strictEqual(store.imports.length,1);

  const event=await fa.createEvent({name:"Relational Test",startDurationSeconds:300,secondsPerFollow:60,creditAcceptance:true},"owner");
  await fa.action("start",{},"owner");
  const followedAt=new Date().toISOString();
  const first=await fa.handleFollow({user_id:"42",user_name:"Alpha",followed_at:followedAt},{message_id:"msg-1"});
  assert.strictEqual(first.decision,"credited");
  assert.strictEqual(first.creditedSeconds,60);

  const duplicate=await fa.handleFollow({user_id:"42",user_name:"Alpha",followed_at:new Date().toISOString()},{message_id:"msg-2"});
  assert.strictEqual(duplicate.decision,"duplicate-user");
  const duplicateMessage=await fa.handleFollow({user_id:"99",user_name:"Bravo",followed_at:new Date().toISOString()},{message_id:"msg-1"});
  assert.strictEqual(duplicateMessage.decision,"duplicate-message");

  const beforeRestart=await fa.getAdminState();
  assert.strictEqual(beforeRestart.event.followCount,1);
  assert.strictEqual(beforeRestart.event.creditedSeconds,60);

  const fa2=createFollowathon({file:"/not-used/followathon.json",storage:store,storageKey:"followathon",audit:()=>{}});
  const afterRestart=await fa2.getAdminState();
  assert.strictEqual(afterRestart.event.id,event.id);
  assert.strictEqual(afterRestart.event.followCount,1);
  assert(afterRestart.event.log.some(x=>x.decision==="credited"));

  const snapshot=store.getFollowathonState();
  store.revision+=1;
  let conflict=false;
  try{store.putFollowathonState(snapshot.state,snapshot.revision);}catch(e){conflict=e.code==="FOLLOWATHON_REVISION_CONFLICT";}
  assert(conflict,"stale followathon revision must be rejected");

  console.log("followathon-relational.test.js: OK");
})().catch(e=>{console.error(e);process.exit(1);});
