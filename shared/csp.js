"use strict";

// N-4: Content-Security-Policy je Seitenart.
//  - "overlay": öffentliche OBS-Browserquellen (Followathon, Follower-Alert) – ohne Inline-Skripte, nur eigene Verbindungen.
//  - "app": Hauptoberfläche und serverseitige Anmeldeseiten – seit 8.6.9 erzwungen ohne Inline-Skripte und ohne Inline-Handler.
//    Verstöße werden weiterhin an /csp-report gemeldet (und blockiert). Inline-Styles bleiben vorerst erlaubt.
const OVERLAY_PATHS=new Set(["/follower-alert/overlay","/followathon/overlay","/subathon/overlay"]);
// 8.9.0: Stubenkontrolle-Overlay als gehostete Browserquelle (OBS, Mac, Moblin). Braucht zusätzlich Videos und den WebSocket.
const STUBE_OVERLAY_PATH="/stubenkontrolle/overlay";
// 9.27.0: Chat-Overlay zeigt Emotes und Abzeichen; Bilder nur vom Twitch-Bildserver, sonst wie die anderen Overlays.
const CHAT_OVERLAY_PATH="/chat-overlay/overlay";
const REPORT_PATH="/csp-report";

function kindForPath(pathname){
  const p=String(pathname||"");
  if(p===STUBE_OVERLAY_PATH)return "stube-overlay";
  if(p===CHAT_OVERLAY_PATH)return "chat-overlay";
  return OVERLAY_PATHS.has(p)?"overlay":"app";
}
const FORM_ACTION="form-action 'self' https://id.twitch.tv https://discord.com";
const APP_ENFORCED="default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "+FORM_ACTION+"; report-uri "+REPORT_PATH;
const OVERLAY_ENFORCED="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// WebSocket-Ziele für connect-src: 'self' deckt ws/wss nicht in jedem Browser ab (ältere WebKit-Versionen),
// daher wird die öffentliche Adresse ausdrücklich ergänzt. Nur saubere Ursprünge (Schema://Host[:Port]) werden übernommen.
function wsOriginFor(publicBaseUrl){
  try{
    const u=new URL(String(publicBaseUrl||""));
    if(u.protocol!=="https:"&&u.protocol!=="http:")return "";
    if(!/^[a-z0-9.-]+(:[0-9]{1,5})?$/i.test(u.host))return "";
    return (u.protocol==="https:"?"wss://":"ws://")+u.host;
  }catch{return "";}
}
function stubeOverlayCsp(publicBaseUrl){
  const ws=wsOriginFor(publicBaseUrl);
  return "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'"+(ws?" "+ws:"")+"; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
}
const CHAT_OVERLAY_ENFORCED="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data: https://static-cdn.jtvnw.net; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function cspHeaders(pathname,{publicBaseUrl=""}={}){
  const kind=kindForPath(pathname);
  if(kind==="chat-overlay")return {"Content-Security-Policy":CHAT_OVERLAY_ENFORCED};
  if(kind==="stube-overlay")return {"Content-Security-Policy":stubeOverlayCsp(publicBaseUrl)};
  if(kind==="overlay")return {"Content-Security-Policy":OVERLAY_ENFORCED};
  return {"Content-Security-Policy":APP_ENFORCED};
}

// Meldungen normalisieren (alte report-uri-Form und Reporting-API-Form).
function parseReports(raw){
  let data;
  try{data=typeof raw==="string"?JSON.parse(raw):raw;}catch{return [];}
  const list=Array.isArray(data)?data.map(x=>x?.body||x):[data?.["csp-report"]||data];
  return list.filter(x=>x&&typeof x==="object").slice(0,5);
}
function clean(v,max=120){return String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").slice(0,max);}
function signature(r){
  const directive=clean(r["effective-directive"]||r.effectiveDirective||r["violated-directive"]||r.violatedDirective,60).split(" ")[0]||"unbekannt";
  let blocked=clean(r["blocked-uri"]||r.blockedURL||r.blockedUri,200);
  if(!blocked||blocked==="inline")blocked="inline";
  else if(blocked==="eval")blocked="eval";
  else if(blocked.startsWith("data:"))blocked="data:";
  else{try{const u=new URL(blocked);blocked=u.origin+u.pathname;}catch{blocked=blocked.split("?")[0];}}
  let doc=clean(r["document-uri"]||r.documentURL||r.documentUri,300);
  try{doc=new URL(doc).pathname;}catch{doc=doc.split("?")[0];}
  return {directive,blocked:clean(blocked,120),doc:clean(doc,80)};
}

function createCspReportCollector({maxKeys=60,maxPerWindow=60,windowMs=60000,log=()=>{}}={}){
  const counts=new Map();
  const windows=new Map();
  let total=0,dropped=0;
  function allow(ip,now=Date.now()){
    const key=String(ip||"unknown");
    const w=windows.get(key);
    if(!w||now-w.start>=windowMs){
      if(windows.size>500)windows.clear();
      windows.set(key,{start:now,n:1});return true;
    }
    w.n++;return w.n<=maxPerWindow;
  }
  function record(raw){
    let added=0;
    for(const report of parseReports(raw)){
      const sig=signature(report);
      const key=`${sig.directive} | ${sig.blocked} | ${sig.doc}`;
      total++;added++;
      if(counts.has(key)){counts.get(key).count++;continue;}
      if(counts.size>=maxKeys){dropped++;continue;}
      counts.set(key,{...sig,count:1,firstAt:new Date().toISOString()});
      log(`CSP-Verstoß: ${key}`);
    }
    return added;
  }
  function summary(){
    return {total,dropped,signatures:[...counts.values()].sort((a,b)=>b.count-a.count)};
  }
  return {allow,record,summary};
}
module.exports={REPORT_PATH,STUBE_OVERLAY_PATH,CHAT_OVERLAY_PATH,CHAT_OVERLAY_ENFORCED,kindForPath,cspHeaders,wsOriginFor,stubeOverlayCsp,parseReports,signature,createCspReportCollector,APP_ENFORCED,OVERLAY_ENFORCED};
