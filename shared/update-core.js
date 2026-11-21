"use strict";
// Updates ab 8.9.10: Schnittstelle zum Pull-Deployment (Deploy-Werkzeug 1.4.0 auf der NAS).
//
// Das Host-Werkzeug (bwk_pull.py) schreibt Hinweise und Ergebnisse in ein Verzeichnis, das hier als
// `dir` (im Container /approvals) eingebunden ist:
//   pending/<x.y.z>.json   Hinweis (nur der Host schreibt)      -> wird hier nur gelesen
//   results/<x.y.z>.json   Ergebnis (nur der Host schreibt)     -> wird hier nur gelesen
//   granted/<x.y.z>.json   Freigabe (das Control Center schreibt)
//   rejected/<x.y.z>.json  Ablehnung (das Control Center schreibt)
// Dieses Modul enthält die reine Logik (Lesen mit Prüfungen, Freigabedateien, Ablaufplanung) und ist
// ohne Server testbar. Es installiert nichts: Installieren darf ausschließlich das Host-Werkzeug.
const fs=require("node:fs");
const path=require("node:path");

const VERSION_RE=/^\d+\.\d+\.\d+$/;
const SHA_RE=/^[a-f0-9]{64}$/;
const MAX_JSON=256*1024;
const MINUTE=60*1000;
// So lange darf das Host-Werkzeug brauchen, um eine Freigabe aufzugreifen (Aufgabenplaner: alle 5 Minuten).
const WAIT_START_MS=20*MINUTE;
// So lange darf eine Installation laufen, bevor wir "Eingriff nötig" melden (Host-Zeitlimit: 30 Minuten).
const WAIT_DEPLOY_MS=60*MINUTE;
const CLOCK_SKEW_MS=5*MINUTE;

// Ergebnisse, nach denen die Bots wieder laufen (alter oder neuer Stand) oder nichts installiert wurde:
// der Wartungsmodus kann beendet werden.
const END_MAINTENANCE=new Set(["deployed","failed-rolled-back","failed-before-change","not-started","approval-invalid","approval-expired","rejected","superseded"]);
// Hier ist der Zustand unklar: Wartungsmodus bleibt an, ein Mensch muss prüfen.
const NEEDS_ATTENTION=new Set(["failed-manual-recovery-required"]);
const RUNNING=new Set(["deploying"]);
// 8.11.0: Das Release bringt eine neuere Fassung des Update-Werkzeugs mit; sie wird zuerst gewechselt,
// die Installation folgt im nächsten Lauf des Host-Werkzeugs.
const TOOLS_PENDING="tools-pending";
const FAILED=new Set(["failed-rolled-back","failed-before-change","failed-manual-recovery-required"]);

function vtuple(v){return String(v).split(".").map(Number);}
function compareVersions(a,b){
  const x=vtuple(a),y=vtuple(b);
  for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]<y[i]?-1:1;}
  return 0;
}

// Liest eine kleine JSON-Datei: keine Symlinks, nur reguläre Dateien, Größenlimit. Bei Problemen null.
function readJsonSafe(file,limit=MAX_JSON){
  let fd=null;
  try{
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>limit)return null;
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const obj=JSON.parse(fs.readFileSync(fd,"utf8"));
    return obj&&typeof obj==="object"&&!Array.isArray(obj)?obj:null;
  }catch{return null;}
  finally{if(fd!==null)try{fs.closeSync(fd);}catch{}}
}

function listVersions(dir){
  let names=[];
  try{names=fs.readdirSync(dir);}catch{return [];}
  return names.map(n=>/^(\d+\.\d+\.\d+)\.json$/.exec(n)).filter(Boolean).map(m=>m[1]).sort(compareVersions).reverse();
}

function isConfigured(dir){
  try{return ["pending","results","granted","rejected"].every(s=>fs.statSync(path.join(dir,s)).isDirectory());}
  catch{return false;}
}

function str(v,max){return typeof v==="string"?v.replace(/[\u0000-\u001f\u007f]/g," ").slice(0,max):"";}

// Hinweis des Host-Werkzeugs, auf die Felder reduziert, die die Oberfläche braucht.
function readNotice(dir,version){
  if(!VERSION_RE.test(version))return null;
  const raw=readJsonSafe(path.join(dir,"pending",`${version}.json`));
  if(!raw||raw.version!==version||typeof raw.status!=="string")return null;
  const sha=typeof raw.sha256==="string"&&SHA_RE.test(raw.sha256)?raw.sha256:null;
  const files=Array.isArray(raw.files)?raw.files.filter(f=>typeof f==="string").slice(0,300).map(f=>str(f,200)):[];
  return {
    version,status:str(raw.status,40),approvable:raw.approvable===true&&raw.status==="awaiting-approval"&&!!sha,
    sha256:sha,sha256Short:sha?sha.slice(0,12):null,
    productionVersion:str(raw.production_version,20),
    size:Number.isFinite(raw.size)?raw.size:null,filesCount:Number.isFinite(raw.files_count)?raw.files_count:null,
    filesTotal:Number.isFinite(raw.files_total)?raw.files_total:files.length,files,
    tests:Number.isFinite(raw.tests)?raw.tests:null,
    manualReasons:Array.isArray(raw.manual_reasons)?raw.manual_reasons.slice(0,20).map(x=>str(x,300)):[],
    summary:str(raw.summary,500),error:str(raw.error,600),
    releaseUrl:typeof raw.release_url==="string"&&raw.release_url.startsWith("https://github.com/")?raw.release_url.slice(0,300):null,
    publishedAt:str(raw.published_at,40),createdAt:str(raw.created_at,40),
    toolsUpdate:readToolsUpdate(raw.tools_update),deepCheckDeferred:raw.deep_check_deferred===true
  };
}
// 8.11.0: Hinweis auf ein mitgeliefertes Werkzeug-Update (nur Anzeige; entschieden wird auf dem Host).
function readToolsUpdate(raw){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||typeof raw.version!=="string"||!VERSION_RE.test(raw.version))return null;
  return {version:raw.version,from:typeof raw.from==="string"&&VERSION_RE.test(raw.from)?raw.from:null,
    mode:raw.mode==="auto"?"auto":"manual",reason:str(raw.reason,300)};
}
// 8.11.0: Stand des Update-Werkzeugs (approvals/updater.json, nur der Host schreibt). Bei Problemen null.
function readUpdater(dir){
  const raw=readJsonSafe(path.join(dir,"updater.json"),64*1024);
  if(!raw||raw.schema!==1||typeof raw.tool_version!=="string"||!VERSION_RE.test(raw.tool_version))return null;
  const ver=v=>typeof v==="string"&&VERSION_RE.test(v)?v:null;
  const entry=e=>e&&typeof e==="object"&&!Array.isArray(e)&&ver(e.version)?{version:e.version,at:str(e.at,40),reason:str(e.reason,600),stage:str(e.stage,30),active:ver(e.active)}:null;
  const sw=raw.last_switch&&typeof raw.last_switch==="object"&&ver(raw.last_switch.to)?{from:ver(raw.last_switch.from),to:raw.last_switch.to,at:str(raw.last_switch.at,40)}:null;
  return {
    toolVersion:raw.tool_version,launcher:raw.launcher===true,launcherVersion:str(raw.launcher_version,20)||null,
    current:ver(raw.current),previous:ver(raw.previous),pending:ver(raw.pending),
    failed:Array.isArray(raw.failed)?raw.failed.slice(-10).map(entry).filter(Boolean):[],
    lastSwitch:sw,lastFallback:entry(raw.last_fallback),
    warnings:Array.isArray(raw.warnings)?raw.warnings.slice(0,5).map(w=>str(w,300)).filter(Boolean):[],
    updatedAt:str(raw.updated_at,40)
  };
}
// Ein fehlgeschlagenes Werkzeug-Update gilt als offen, solange die aktive Fassung älter ist als die fehlgeschlagene.
function openToolsFallback(updater){
  const f=updater&&updater.lastFallback;
  if(!f)return null;
  return compareVersions(updater.toolVersion,f.version)<0?f:null;
}
function readNotices(dir){return listVersions(path.join(dir,"pending")).map(v=>readNotice(dir,v)).filter(Boolean);}

function readResult(dir,version){
  if(!VERSION_RE.test(version))return null;
  const raw=readJsonSafe(path.join(dir,"results",`${version}.json`));
  if(!raw||raw.version!==version||typeof raw.status!=="string")return null;
  return {
    version,status:str(raw.status,50),sha256:typeof raw.sha256==="string"&&SHA_RE.test(raw.sha256)?raw.sha256:null,
    message:str(raw.message,1000),by:str(raw.by,100)||null,via:str(raw.via,30)||null,at:str(raw.at,40),
    backupId:str(raw.backup_id,80)||null
  };
}
function readResults(dir,limit=15){return listVersions(path.join(dir,"results")).slice(0,limit).map(v=>readResult(dir,v)).filter(Boolean);}

function writeNew(file,body){
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o644);
  try{fs.writeFileSync(fd,JSON.stringify(body,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function checkBy(by){
  const name=str(by,100).trim();
  if(!name)throw new Error("Name des Freigebenden fehlt.");
  return name;
}

// Schreibt die Freigabe. Gilt für genau diese Datei (SHA256), 24 Stunden, einmal (Prüfung im Host-Werkzeug).
function writeGrant(dir,{version,sha256,by,now=new Date()}){
  const notice=readNotice(dir,version);
  if(!notice)throw new Error("Für diese Version gibt es keine offene Anfrage.");
  if(!notice.approvable)throw new Error("Diese Version ist nicht zur Freigabe vorgesehen (Status: "+notice.status+").");
  if(notice.sha256!==sha256)throw new Error("Die Prüfsumme passt nicht zur geprüften Datei.");
  const file=path.join(dir,"granted",`${version}.json`);
  try{writeNew(file,{version,sha256,approved_by:checkBy(by),via:"control-center",approved_at:now.toISOString()});}
  catch(e){
    if(e.code==="EEXIST")throw new Error("Für diese Version liegt bereits eine Freigabe vor.");
    if(e.code==="EACCES"||e.code==="EROFS"||e.code==="EPERM")throw new Error("Das Freigabe-Verzeichnis ist nicht beschreibbar (Rechte auf der NAS prüfen).");
    throw e;
  }
}
function writeReject(dir,{version,by,now=new Date()}){
  const notice=readNotice(dir,version);
  if(!notice)throw new Error("Für diese Version gibt es keine offene Anfrage.");
  const file=path.join(dir,"rejected",`${version}.json`);
  try{writeNew(file,{version,approved_by:checkBy(by),via:"control-center",approved_at:now.toISOString()});}
  catch(e){
    if(e.code==="EEXIST")throw new Error("Für diese Version liegt bereits eine Ablehnung vor.");
    if(e.code==="EACCES"||e.code==="EROFS"||e.code==="EPERM")throw new Error("Das Ablehnungs-Verzeichnis ist nicht beschreibbar (Rechte auf der NAS prüfen).");
    throw e;
  }
}
// Zieht eine noch nicht abgeholte Freigabe zurück. Gibt true zurück, wenn eine Datei entfernt wurde.
function withdrawGrant(dir,version){
  if(!VERSION_RE.test(version))return false;
  try{fs.unlinkSync(path.join(dir,"granted",`${version}.json`));return true;}catch{return false;}
}

// Legt kurz eine Probedatei im Freigabeordner an und löscht sie wieder. Wirft eine verständliche Meldung, wenn das nicht geht.
function probeWritable(dir){
  const file=path.join(dir,"granted",`.probe-${process.pid}-${Date.now()}`);
  try{fs.writeFileSync(file,"",{flag:"wx",mode:0o644});fs.unlinkSync(file);}
  catch(e){
    if(e.code==="EACCES"||e.code==="EROFS"||e.code==="EPERM")throw new Error("Das Freigabe-Verzeichnis ist nicht beschreibbar (Rechte auf der NAS prüfen). Der Wartungsmodus wurde nicht aktiviert.");
    throw new Error("Das Freigabe-Verzeichnis ist nicht nutzbar: "+(e.code||e.message));
  }
}

// Entscheidet anhand des laufenden Updates und des Host-Ergebnisses, was als Nächstes zu tun ist.
// active: {version,sha256,approvedAt (ISO),maintenance:{startedByUpdate}}
// Rückgabe: {action:"wait"|"finish"|"attention"|"timeout", status, endMaintenance, withdrawGrant, outcome, message}
//   outcome: "installed" | "failed" | "not-started" | null
function plan(active,result,nowMs=Date.now()){
  const approvedMs=Date.parse(active.approvedAt);
  const age=Number.isFinite(approvedMs)?nowMs-approvedMs:0;
  const started=!!active.maintenance?.startedByUpdate;
  const fresh=result&&(!Number.isFinite(approvedMs)||Date.parse(result.at)>=approvedMs-CLOCK_SKEW_MS)
    &&(result.sha256===null||result.sha256===active.sha256);
  if(!fresh){
    if(age>WAIT_START_MS){
      return {action:"timeout",status:"not-started",endMaintenance:started,withdrawGrant:true,outcome:"not-started",
        message:"Das Host-Werkzeug hat die Freigabe nicht innerhalb von 20 Minuten aufgegriffen. Die Freigabe wurde zurückgezogen."};
    }
    return {action:"wait",status:"waiting",endMaintenance:false,withdrawGrant:false,outcome:null,message:"Warte auf das Host-Werkzeug (Prüfung alle 5 Minuten)."};
  }
  const st=result.status;
  if(st===TOOLS_PENDING){
    if(age>WAIT_DEPLOY_MS){
      return {action:"attention",status:st,endMaintenance:false,withdrawGrant:false,outcome:"failed",
        message:"Das Update-Werkzeug wurde vorbereitet, die Installation hat aber seit über 60 Minuten nicht begonnen. Bitte auf der NAS prüfen. Der Wartungsmodus bleibt aktiv."};
    }
    return {action:"wait",status:st,endMaintenance:false,withdrawGrant:false,outcome:null,
      message:"Das Update-Werkzeug wird zuerst aktualisiert; die Installation folgt im nächsten Lauf (etwa 5 Minuten)."};
  }
  if(RUNNING.has(st)){
    if(age>WAIT_DEPLOY_MS){
      return {action:"attention",status:st,endMaintenance:false,withdrawGrant:false,outcome:"failed",
        message:"Die Installation meldet seit über 60 Minuten „läuft“. Bitte auf der NAS prüfen. Der Wartungsmodus bleibt aktiv."};
    }
    return {action:"wait",status:st,endMaintenance:false,withdrawGrant:false,outcome:null,message:"Installation läuft."};
  }
  if(NEEDS_ATTENTION.has(st)){
    return {action:"attention",status:st,endMaintenance:false,withdrawGrant:false,outcome:"failed",
      message:(result.message||"Die Installation wurde unterbrochen.")+" Manueller Eingriff nötig, der Wartungsmodus bleibt aktiv."+(result.backupId?` Backup: ${result.backupId}.`:"")};
  }
  if(END_MAINTENANCE.has(st)){
    return {action:"finish",status:st,endMaintenance:started,withdrawGrant:false,
      outcome:st==="deployed"?"installed":FAILED.has(st)?"failed":"not-started",message:result.message||""};
  }
  // Unbekannter Status: abwarten, nach der Installationsfrist Eingriff melden.
  if(age>WAIT_DEPLOY_MS){
    return {action:"attention",status:st,endMaintenance:false,withdrawGrant:false,outcome:"failed",message:`Unbekannter Status „${st}“. Bitte auf der NAS prüfen.`};
  }
  return {action:"wait",status:st,endMaintenance:false,withdrawGrant:false,outcome:null,message:""};
}

module.exports={VERSION_RE,SHA_RE,WAIT_START_MS,WAIT_DEPLOY_MS,END_MAINTENANCE,compareVersions,readJsonSafe,listVersions,isConfigured,
  readNotice,readNotices,readResult,readResults,probeWritable,writeGrant,writeReject,withdrawGrant,plan,
  TOOLS_PENDING,readUpdater,openToolsFallback};
