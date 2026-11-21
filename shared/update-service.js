"use strict";
// Ablaufsteuerung der Updates-Seite (8.9.10): Freigabe, Discord-Wartungsmodus, Beobachtung des Ergebnisses.
// Alle Abhängigkeiten werden übergeben, damit der Ablauf ohne Server und ohne Discord testbar ist.
//   dir          Freigabe-Verzeichnis (im Container /approvals)
//   stateFile    Zustandsdatei (im Container /data/update-state.json)
//   discord      async (pathname, {method, body}) => {body} | wirft Fehler (Discord-Dienst des Control Centers)
//   audit        (user, action, detail) => void
//   appVersion   () => laufende Version
const fs=require("node:fs");
const core=require("./update-core");

function createUpdateService({dir,stateFile,discord,audit=()=>{},appVersion,now=()=>Date.now()}){
  let busy=false;

  function loadState(){
    const s=core.readJsonSafe(stateFile,512*1024)||{};
    return {
      active:s.active&&typeof s.active==="object"?s.active:null,
      announced:Array.isArray(s.announced)?s.announced.filter(v=>core.VERSION_RE.test(v)).slice(-50):[],
      history:Array.isArray(s.history)?s.history.slice(0,20):[],
      // 8.11.0: bereits gemeldete Rückfälle des Update-Werkzeugs ("Fassung|Zeitpunkt").
      toolsFallbacks:Array.isArray(s.toolsFallbacks)?s.toolsFallbacks.filter(v=>typeof v==="string").slice(-20):[]
    };
  }
  function saveState(s){
    const tmp=stateFile+".tmp";
    fs.writeFileSync(tmp,JSON.stringify(s,null,2),{mode:0o600});
    fs.renameSync(tmp,stateFile);
  }
  async function event(eventKey,data){
    try{await discord("/system/update-event",{method:"POST",body:JSON.stringify({eventKey,data})});}catch(e){audit("system","update.discord-event-failed",{eventKey,error:String(e.message||e).slice(0,200)});}
  }
  async function maintenanceActive(){
    const r=await discord("/channel-times");
    return r?.body?.maintenance?.active===true;
  }
  async function setMaintenance(active){
    // Nur {active} senden: sonst würden gespeicherte Sperr-/Entsperrtexte überschrieben.
    await discord("/channel-times/maintenance",{method:"PUT",body:JSON.stringify({active})});
  }

  function view(){
    const configured=core.isConfigured(dir);
    const st=loadState();
    const current=appVersion();
    const notices=configured?core.readNotices(dir):[];
    const results=configured?core.readResults(dir):[];
    const newer=notices.filter(n=>core.VERSION_RE.test(current)?core.compareVersions(n.version,current)>0:true);
    return {configured,currentVersion:current,notices:newer,results,active:st.active,history:st.history,updater:updater()};
  }
  // 8.11.0: Stand des Update-Werkzeugs samt offenem Rückfall (für Updates-Seite und Systemstatus).
  function updater(){
    if(!core.isConfigured(dir))return null;
    const u=core.readUpdater(dir);
    return u?{...u,openFallback:core.openToolsFallback(u)}:null;
  }

  async function approve({version,confirmVersion,confirmSha,by,skipMaintenance=false}){
    if(!configured())throw httpError(503,"Das Freigabe-Verzeichnis ist nicht eingebunden (siehe UPDATE-8.9.10.md).");
    if(busy)throw httpError(409,"Es läuft bereits eine Freigabe. Bitte kurz warten.");
    busy=true;
    try{
      const st=loadState();
      if(st.active)throw httpError(409,`Es läuft bereits ein Update (${st.active.version}).`);
      const notice=core.readNotice(dir,version);
      if(!notice)throw httpError(404,"Für diese Version gibt es keine offene Anfrage.");
      if(!notice.approvable)throw httpError(409,"Diese Version kann hier nicht freigegeben werden (Status: "+notice.status+").");
      if(String(confirmVersion)!==version)throw httpError(400,"Die Versionsnummer wurde nicht korrekt bestätigt.");
      if(String(confirmSha).toLowerCase()!==notice.sha256Short)throw httpError(400,"Die Prüfsumme (erste 12 Zeichen) wurde nicht korrekt bestätigt.");
      // Vorab prüfen, ob die Freigabe überhaupt geschrieben werden kann, damit der Wartungsmodus nicht umsonst läuft.
      try{core.probeWritable(dir);}catch(e){throw httpError(503,e.message);}
      let startedByUpdate=false;
      if(!skipMaintenance){
        let already;
        try{already=await maintenanceActive();}
        catch(e){throw httpError(502,"Der Discord-Dienst ist nicht erreichbar, der Wartungsmodus kann nicht geprüft werden: "+e.message);}
        if(!already){
          try{await setMaintenance(true);startedByUpdate=true;}
          catch(e){throw httpError(502,"Der Wartungsmodus konnte nicht aktiviert werden, das Update wurde nicht freigegeben: "+e.message);}
        }
      }
      const approvedAt=new Date(now());
      st.active={version,sha256:notice.sha256,approvedAt:approvedAt.toISOString(),approvedBy:by,phase:"waiting",
        maintenance:{startedByUpdate,skipped:skipMaintenance===true}};
      saveState(st);
      try{core.writeGrant(dir,{version,sha256:notice.sha256,by,now:approvedAt});}
      catch(e){
        st.active=null;saveState(st);
        if(startedByUpdate){try{await setMaintenance(false);}catch{}}
        throw httpError(e.message.includes("nicht beschreibbar")?503:409,e.message);
      }
      audit(by,"update.approve",{version,sha256:notice.sha256Short,maintenanceStarted:startedByUpdate,maintenanceSkipped:skipMaintenance===true});
      await event("system.update_started",{version,actor:by});
      return {ok:true,active:st.active};
    }finally{busy=false;}
  }

  async function reject({version,by}){
    if(!configured())throw httpError(503,"Das Freigabe-Verzeichnis ist nicht eingebunden.");
    const st=loadState();
    if(st.active&&st.active.version===version)throw httpError(409,"Dieses Update läuft bereits.");
    try{core.writeReject(dir,{version,by});}catch(e){throw httpError(e.message.includes("nicht beschreibbar")?503:409,e.message);}
    audit(by,"update.reject",{version});
    return {ok:true};
  }

  // Bestätigt eine Störung. Optional wird der Wartungsmodus beendet (nur wenn das Update ihn gestartet hat).
  async function acknowledge({version,by,endMaintenance=false}){
    const st=loadState();
    if(!st.active||st.active.version!==version)throw httpError(404,"Für diese Version ist keine Störung offen.");
    if(st.active.phase==="waiting"&&!st.active.attention)throw httpError(409,"Das Update läuft noch, es gibt nichts zu bestätigen.");
    if(endMaintenance&&st.active.maintenance?.startedByUpdate){
      try{await setMaintenance(false);}catch(e){throw httpError(502,"Der Wartungsmodus konnte nicht beendet werden: "+e.message);}
    }
    pushHistory(st,{version,outcome:"acknowledged",status:st.active.attention?.status||"",message:"Störung bestätigt von "+by,at:new Date(now()).toISOString()});
    core.withdrawGrant(dir,version);
    st.active=null;saveState(st);
    audit(by,"update.acknowledge",{version,maintenanceEnded:endMaintenance===true});
    return {ok:true};
  }

  function pushHistory(st,entry){st.history=[entry,...st.history].slice(0,20);}
  function configured(){return core.isConfigured(dir);}
  function httpError(status,message){const e=new Error(message);e.status=status;return e;}

  // Wird regelmäßig aufgerufen (Server: alle 30 Sekunden und beim Start).
  async function tick(){
    if(busy||!configured())return {skipped:true};
    busy=true;
    try{
      const st=loadState();
      const current=appVersion();
      // 1) Neue freigabefähige Hinweise einmalig in Discord melden.
      for(const n of core.readNotices(dir)){
        if(!n.approvable||st.announced.includes(n.version))continue;
        if(core.VERSION_RE.test(current)&&core.compareVersions(n.version,current)<=0)continue;
        st.announced=[...st.announced,n.version].slice(-50);
        saveState(st);
        await event("system.update_available",{version:n.version,currentVersion:current,summary:n.summary});
      }
      // 1b) 8.11.0: Rückfall des Update-Werkzeugs einmalig melden (Protokoll und Discord).
      const u=core.readUpdater(dir);
      if(u&&u.lastFallback){
        const key=`${u.lastFallback.version}|${u.lastFallback.at}`;
        if(!st.toolsFallbacks.includes(key)){
          st.toolsFallbacks=[...st.toolsFallbacks,key].slice(-20);
          saveState(st);
          audit("system","update.tools-fallback",{version:u.lastFallback.version,active:u.toolVersion,stage:u.lastFallback.stage,reason:u.lastFallback.reason.slice(0,200)});
          await event("system.update_tools_fallback",{version:u.lastFallback.version,currentVersion:u.toolVersion,message:u.lastFallback.reason});
        }
      }
      // 2) Laufendes Update beobachten.
      const a=st.active;
      if(a&&!a.attention){
        const result=core.readResult(dir,a.version);
        if(a.phase==="ending"){
          await finish(st,a,a.pending||{outcome:"not-started",status:"unknown",message:""});
        }else{
          const p=core.plan(a,result,now());
          if(p.action==="timeout"||p.action==="finish"){
            if(p.withdrawGrant)core.withdrawGrant(dir,a.version);
            a.pending={outcome:p.outcome,status:p.status,message:p.message,endMaintenance:p.endMaintenance};
            a.phase="ending";saveState(st);
            await finish(st,a,a.pending);
          }else if(p.action==="attention"){
            a.attention={status:p.status,message:p.message,at:new Date(now()).toISOString()};
            saveState(st);
            audit("system","update.attention",{version:a.version,status:p.status});
            await event("system.update_attention",{version:a.version,status:p.status,message:p.message});
          }
        }
      }
      return {ok:true};
    }catch(e){
      audit("system","update.tick-failed",{error:String(e.message||e).slice(0,200)});
      return {ok:false,error:e.message};
    }finally{busy=false;}
  }

  async function finish(st,a,pending){
    if(pending.endMaintenance){
      try{await setMaintenance(false);}
      catch(e){audit("system","update.maintenance-end-failed",{version:a.version,error:String(e.message||e).slice(0,200)});return;} // nächster Durchlauf versucht es erneut
    }
    pushHistory(st,{version:a.version,outcome:pending.outcome,status:pending.status,message:String(pending.message||"").slice(0,500),at:new Date(now()).toISOString(),approvedBy:a.approvedBy});
    st.active=null;saveState(st);
    audit("system","update.finish",{version:a.version,outcome:pending.outcome,status:pending.status});
    if(pending.outcome==="installed")await event("system.update_finished",{version:a.version});
    else await event("system.update_failed",{version:a.version,status:pending.status,message:pending.message});
  }

  return {view,approve,reject,acknowledge,tick,updater};
}

module.exports={createUpdateService};
