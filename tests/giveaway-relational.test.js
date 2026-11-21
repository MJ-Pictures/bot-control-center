"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {createGiveawayStore}=require("../shared/giveaway-store");
function clone(v){return JSON.parse(JSON.stringify(v));}

class FakeGiveawayStore{
  constructor(legacy){this.enabled=true;this.legacy=legacy;this.state=null;this.revision=0;this.imports=[];}
  getGiveawayState(){return this.state?{found:true,state:clone(this.state),revision:this.revision}:{found:false};}
  hasDocument(key){return key==="giveaways"&&!!this.legacy;}
  getDocument(){return clone(this.legacy);}
  importGiveawayStateIfEmpty(state){if(this.state)return {inserted:false,revision:this.revision};this.state=clone(state);this.revision=1;return {inserted:true,revision:1};}
  putGiveawayState(state,expectedRevision,{replace=false}={}){if(expectedRevision!==null&&expectedRevision!==undefined&&Number(expectedRevision)!==this.revision){const e=new Error("revision conflict");e.code="GIVEAWAY_REVISION_CONFLICT";throw e;}this.state=clone(state);this.revision+=1;return {revision:this.revision,replace};}
  markImport(sourceKey,sourceSha256,details){this.imports.push({sourceKey,sourceSha256,details});return {inserted:true};}
}

(()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"bwk-giveaway-"));
  const file=path.join(dir,"giveaways.json");
  const legacy={current:{id:"g1",type:"keyword",keyword:"TEST",title:"Test",active:true,createdAt:new Date().toISOString(),createdBy:"owner",startedAt:new Date().toISOString(),endedAt:null,winner:null,winners:[],excludeModerators:true,excludeBroadcaster:true,excludeVIPs:false,entries:{"42":{userId:"42",login:"alpha",name:"Alpha",isModerator:false,isVip:false,badges:[],joinedAt:new Date().toISOString()}},archived:false},history:[]};
  const backing=new FakeGiveawayStore(legacy);
  const store=createGiveawayStore({file,storage:backing,storageKey:"giveaways"});
  const first=store.read();
  assert.strictEqual(backing.revision,1,"legacy giveaway JSONB should be imported once");
  assert.strictEqual(first.current.entries["42"].login,"alpha");
  first.current.winners.push(first.current.entries["42"]);first.current.winner=first.current.winners[0];
  store.write(first);
  assert.strictEqual(backing.revision,2);
  const after=store.read();
  assert.strictEqual(after.current.winners.length,1);
  const stale=store.read();backing.revision+=1;
  let conflict=false;try{store.write(stale);}catch(e){conflict=e.code==="GIVEAWAY_REVISION_CONFLICT";}
  assert(conflict,"stale giveaway revision must be rejected");
  const restore={current:null,history:[{...legacy.current,active:false,endedAt:new Date().toISOString(),archived:true}]};
  store.write(restore,{replace:true});
  assert.strictEqual(store.read().history.length,1);

  const pgSource=fs.readFileSync(path.join(__dirname,"..","shared","pg-sync-store.js"),"utf8");
  assert(pgSource.includes("CREATE TABLE IF NOT EXISTS giveaway_entries"));
  assert(pgSource.includes("PRIMARY KEY(namespace,giveaway_id,twitch_user_id)"));
  assert(pgSource.includes("UNIQUE(namespace,giveaway_id,winner_user_id)"));
  fs.rmSync(dir,{recursive:true,force:true});
  console.log("giveaway-relational.test.js: OK");
})();
