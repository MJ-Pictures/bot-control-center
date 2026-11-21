"use strict";
const { createSseLimiter, rejectTooMany } = require("../shared/sse-limits");
// Persistente Konfiguration; Live-Namen werden ausschließlich an die offene OBS-Quelle gesendet.
const DEFAULT_CONFIG=Object.freeze({enabled:false,durationSeconds:7});
function cleanName(value){
  const name=String(value||"").trim();
  if(!name||name.length>48||!/^[\p{L}\p{N}_\-. ]+$/u.test(name))throw new Error("Ungültiger Twitch-Nickname.");
  return name;
}
function createFollowerAlert({read,write}){
  let config={...DEFAULT_CONFIG,...(read()||{})};
  config.enabled=config.enabled===true;
  if(!Number.isInteger(config.durationSeconds)||config.durationSeconds<5||config.durationSeconds>20)config.durationSeconds=7;
  const clients=new Set();
  const sseLimiter=createSseLimiter({max:20,perIp:4});
  let nextId=0;
  function broadcast(event,data){
    const frame=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for(const res of clients){try{if(res.writableLength>65536){clients.delete(res);res.end();continue;}res.write(frame);}catch{clients.delete(res);}}
  }
  function configure(body){
    if(typeof body?.enabled!=="boolean")throw new Error("Der Ein-/Ausschalter muss explizit gesetzt werden.");
    const durationSeconds=body.durationSeconds===undefined?config.durationSeconds:Number(body.durationSeconds);
    if(!Number.isInteger(durationSeconds)||durationSeconds<5||durationSeconds>20)throw new Error("Die Anzeigedauer muss zwischen 5 und 20 Sekunden liegen.");
    const next={enabled:body.enabled,durationSeconds};
    write(next); // erst persistent speichern, dann live wirksam
    config=next;
    broadcast("config",getConfig());
    return getConfig();
  }
  function getConfig(){return {...config};}
  function emit(name,{force=false}={}){
    if(!force&&!config.enabled)return false;
    const userName=cleanName(name);
    broadcast("follow",{id:++nextId,userName});
    return true;
  }
  function handleFollow(ev){return emit(ev?.user_name||ev?.user_login);}
  function test(name){return emit(name,{force:true});}
  function addSseClient(res,req,ip){
    const release=sseLimiter.tryAcquire(ip);
    if(!release)return rejectTooMany(res);
    res.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});
    res.write(`retry: 3000\nevent: config\ndata: ${JSON.stringify(getConfig())}\n\n`);
    clients.add(res);
    const timer=setInterval(()=>{try{res.write(": ping\n\n");}catch{cleanup();}},25000);
    timer.unref?.();
    let done=false;
    function cleanup(){if(done)return;done=true;clearInterval(timer);clients.delete(res);release();}
    req.on("close",cleanup);
    res.on("close",cleanup);
  }
  return {configure,getConfig,handleFollow,test,addSseClient};
}
module.exports={createFollowerAlert,cleanName};
