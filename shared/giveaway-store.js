"use strict";

const fs = require("fs");

function clone(v){ return JSON.parse(JSON.stringify(v)); }

function createGiveawayStore({file,storage=null,storageKey="giveaways"}={}){
  const defaults=()=>({current:null,history:[]});

  function normalizeGiveaway(g){
    if(!g)return g;
    if(!g.entries||typeof g.entries!=="object"||Array.isArray(g.entries))g.entries={};
    if(!Array.isArray(g.winners))g.winners=g.winner?[g.winner]:[];
    if(typeof g.excludeModerators!=="boolean")g.excludeModerators=true;
    if(typeof g.excludeBroadcaster!=="boolean")g.excludeBroadcaster=true;
    if(typeof g.excludeVIPs!=="boolean")g.excludeVIPs=false;
    return g;
  }

  function normalizeState(input){
    const s=input&&typeof input==="object"&&!Array.isArray(input)?input:defaults();
    if(!Array.isArray(s.history))s.history=[];
    s.current=normalizeGiveaway(s.current||null);
    s.history=s.history.map(normalizeGiveaway).filter(Boolean);
    return s;
  }

  function attachRevision(state,revision){
    if(Number.isFinite(Number(revision)))Object.defineProperty(state,"_dbRevision",{value:Number(revision),writable:true,configurable:true,enumerable:false});
    return state;
  }

  function readLegacy(){
    try{return normalizeState(JSON.parse(fs.readFileSync(file,"utf8")));}
    catch{return defaults();}
  }

  function ensureRelational(){
    if(!(storage?.enabled&&typeof storage.getGiveawayState==="function"))return;
    const current=storage.getGiveawayState();
    if(current?.found)return;
    let legacy=defaults(),source="fresh";
    try{
      if(typeof storage.hasDocument==="function"&&storage.hasDocument(storageKey)){
        legacy=normalizeState(storage.getDocument(storageKey,defaults()));
        source="postgres-jsonb";
      }else if(file&&fs.existsSync(file)){
        legacy=readLegacy();
        source="legacy-json";
      }
    }catch{}
    const imported=storage.importGiveawayStateIfEmpty(clone(legacy));
    if(imported?.inserted&&typeof storage.markImport==="function"){
      const all=[...(legacy.history||[])]; if(legacy.current)all.push(legacy.current);
      const ids=new Set(all.map(x=>x?.id).filter(Boolean));
      const entries=all.reduce((n,g)=>n+Object.keys(g?.entries||{}).length,0);
      const draws=all.reduce((n,g)=>n+(g?.winners||[]).length,0);
      try{storage.markImport(`relational:${storageKey}`,null,{kind:"relational-giveaways",source,giveaways:ids.size,entries,draws});}catch{}
    }
  }

  function read(){
    try{
      if(storage?.enabled&&typeof storage.getGiveawayState==="function"){
        let r=storage.getGiveawayState();
        if(!r?.found){ensureRelational();r=storage.getGiveawayState();}
        if(r?.found)return attachRevision(normalizeState(r.state),r.revision);
      }
      if(storage?.enabled)return normalizeState(storage.getDocument(storageKey,defaults()));
      return readLegacy();
    }catch(e){
      if(storage?.enabled)throw e;
      return defaults();
    }
  }

  function write(state,{replace=false}={}){
    const s=normalizeState(state);
    s.history=s.history.slice(-50);
    if(storage?.enabled&&typeof storage.putGiveawayState==="function"){
      const expected=Number.isFinite(Number(s._dbRevision))?Number(s._dbRevision):null;
      const result=storage.putGiveawayState(clone(s),expected,{replace});
      return attachRevision(s,result?.revision);
    }
    if(storage?.enabled){storage.putDocument(storageKey,s);return s;}
    const tmp=file+".tmp";
    fs.writeFileSync(tmp,JSON.stringify(s,null,2),{mode:0o600});
    fs.renameSync(tmp,file);
    return s;
  }

  function publicGiveaway(g){
    if(!g)return null;
    return {...g,entries:Object.values(g.entries||{})};
  }

  function archiveCurrent(state){
    if(!state.current)return;
    const g=state.current;
    if(!g.archived&&g.endedAt){
      state.history.push({...g,archived:true});
      g.archived=true;
    }
  }

  return {read,write,normalizeGiveaway,normalizeState,publicGiveaway,archiveCurrent,ensureRelational};
}

module.exports={createGiveawayStore};
