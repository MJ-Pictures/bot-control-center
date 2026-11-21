"use strict";

// N-1: Begrenzung öffentlicher Langzeitverbindungen (SSE) – gesamt und je Client-IP.
// tryAcquire(ip) liefert eine Freigabefunktion oder null, wenn ein Limit erreicht ist.
function createSseLimiter({max=20,perIp=4}={}){
  const perIpCount=new Map();
  let total=0;
  function tryAcquire(ip){
    const key=String(ip||"unknown");
    const current=perIpCount.get(key)||0;
    if(total>=max||current>=perIp)return null;
    total++;perIpCount.set(key,current+1);
    let released=false;
    return function release(){
      if(released)return;released=true;
      total=Math.max(0,total-1);
      const left=(perIpCount.get(key)||1)-1;
      if(left<=0)perIpCount.delete(key);else perIpCount.set(key,left);
    };
  }
  return {tryAcquire,stats:()=>({total,max,perIp,ips:perIpCount.size})};
}
function rejectTooMany(res){
  res.writeHead(503,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store","Retry-After":"10"});
  res.end("Zu viele Overlay-Verbindungen");
}
module.exports={createSseLimiter,rejectTooMany};
