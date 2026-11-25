"use strict";
const textPackKit=require("../shared/text-pack");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { NEUTRAL_GAME, FIXED_GAME_COMMANDS, normalizeGame } = require("../shared/installation-profile");

const OVERLAY_ANCHORS = ["top-left","top-center","top-right","middle-left","middle-center","middle-right","bottom-left","bottom-center","bottom-right"];
// 9.28.1: Layout-Einstellungen, wie das Overlay sie bekommt (Zustandsnachricht und Test-Szenarien).
function overlayLayout(cfg){
  return {scale:cfg.overlayScale,anchor:cfg.overlayAnchor,margin:cfg.overlayMargin,detail:cfg.overlayDetail};
}

const DEFAULT_CONFIG = {
  enabled: true,
  bot: "", // 9.15.0: leer = Haupt-Bot der Installation (die Twitch-Laufzeit löst die Bot-Wahl auf)
  starterPoints: 1000,
  dailyPoints: 100,
  minBet: 50,
  maxBet: 500,
  registrationSeconds: 60,
  cooldownMinutes: 15,
  baseFactor: 1.5,
  factorPerParticipant: 0.1,
  maxFactor: 3.0,
  individualModePct: 75,
  allPassModePct: 10,
  allCaughtModePct: 15,
  individualPassPct: 40,
  controlAnimationSeconds: 7,
  resultDisplaySeconds: 15,
  // 9.11.0: leer = aus der öffentlichen Adresse der Installation abgeleitet (wss://ADRESSE/ws/stubenkontrolle).
  overlayPublicUrl: "",
  overlayKey: "",
  overlayStatusDisplay: "problem",
  // 9.28.1: Lage und Größe des Panels im Overlay. Größe in Prozent (100 = bisherige Breite 1180 px),
  // Anker = eines von neun Feldern, Rand in Pixel (bezogen auf 1920×1080), Detailstufe full = wie bisher, compact = nur Kopfzeile und Ergebnistext.
  overlayScale: 80,
  overlayAnchor: "bottom-center",
  overlayMargin: 60,
  overlayDetail: "full",
  // 8.9.6: Beitritts-Meldungen im Chat. auto = die ersten N einzeln, danach Sammelmeldung;
  // all = jeden einzeln; everyNth = nur jeden N-ten; off = keine. Die Eröffnung der Runde kommt immer.
  joinChatMode: "auto",
  joinChatAutoSingles: 5,
  joinChatSummarySeconds: 10,
  joinChatEveryNth: 3,
  // 9.10.0: !gift NICK BETRAG – Punkte verschenken, ohne das eigene Guthaben zu belasten.
  // Wer darf: Kanalinhaber (Broadcaster) und/oder Owner des Control Centers (über ihr verknüpftes Twitch-Konto).
  // Höchstbetrag je Geschenk; 0 = unbegrenzt.
  giftAllowBroadcaster: true,
  giftAllowControlOwners: false,
  giftMaxAmount: 10000,
  // 9.13.0: Standardphrasen kommen aus dem Textpaket (neutral; Bestandsinstallation: bisherige Texte).
  phrases: textPackKit.clone(textPackKit.NEUTRAL.gamePhrases)
};

function deepClone(v){ return JSON.parse(JSON.stringify(v)); }
function nowIso(){ return new Date().toISOString(); }
function uid(prefix="r"){ return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`; }
function clamp(n,min,max){ n=Number(n); return Number.isFinite(n)?Math.min(max,Math.max(min,n)):min; }
function int(n,min,max){ return Math.round(clamp(n,min,max)); }
function money(n){ return Math.max(0,Math.round(Number(n)||0)); }
function factorFor(config,count){
  return Math.min(Number(config.maxFactor||3), Number(config.baseFactor||1.5) + Number(config.factorPerParticipant||0.1)*Math.max(0,count-1));
}
// 9.9.1: Tageskennung „JJJJ-MM-TT“ aus allem, was die Datenbank liefern kann (Text, Date-Objekt, ISO-Zeitstempel).
// Ein DATE-Feld kam bisher als Date-Objekt zurück, der Vergleich mit dem Text schlug fehl → !daily beliebig oft.
function dateKeyOf(v){
  if(!v)return null;
  if(typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v.trim()))return v.trim();
  const d=v instanceof Date?v:new Date(v);
  return Number.isFinite(d.getTime())?berlinDateKey(d):null;
}
function berlinDateKey(date=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${x.year}-${x.month}-${x.day}`;
}
function pick(list){ return Array.isArray(list)&&list.length ? list[Math.floor(Math.random()*list.length)] : ""; }
function render(text,vars){
  return String(text||"").replace(/\{([a-zA-Z0-9_]+)\}/g,(_,k)=>vars[k]===undefined?`{${k}}`:String(vars[k]));
}
function normalizeConfig(input={},phraseDefaults=DEFAULT_CONFIG.phrases,titleDefaults=textPackKit.NEUTRAL.gameOverlayTitles){
  const c={...deepClone(DEFAULT_CONFIG),...(input||{})};
  c.phrases={...deepClone(phraseDefaults),...((input||{}).phrases||{})};
  for(const k of Object.keys(c.phrases)){
    c.phrases[k]=Array.isArray(c.phrases[k])?c.phrases[k].map(x=>String(x||"").trim()).filter(Boolean):deepClone(phraseDefaults[k]||[]);
  }
  c.starterPoints=int(c.starterPoints,0,10_000_000);
  c.dailyPoints=int(c.dailyPoints,0,1_000_000);
  c.minBet=int(c.minBet,1,10_000_000);
  c.maxBet=int(c.maxBet,c.minBet,10_000_000);
  c.registrationSeconds=int(c.registrationSeconds,10,600);
  c.cooldownMinutes=int(c.cooldownMinutes,0,1440);
  c.baseFactor=clamp(c.baseFactor,1,20);
  c.factorPerParticipant=clamp(c.factorPerParticipant,0,5);
  c.maxFactor=Math.max(c.baseFactor,clamp(c.maxFactor,1,50));
  c.individualModePct=clamp(c.individualModePct,0,100);
  c.allPassModePct=clamp(c.allPassModePct,0,100);
  c.allCaughtModePct=clamp(c.allCaughtModePct,0,100);
  c.individualPassPct=clamp(c.individualPassPct,0,100);
  c.controlAnimationSeconds=int(c.controlAnimationSeconds,1,60);
  c.resultDisplaySeconds=int(c.resultDisplaySeconds,3,120);
  // 9.18.0: Überschriften im Overlay (leer = Vorgabe des Textpakets)
  c.overlayTitles={};for(const k of ["registration","control","result"]){const v=String(input?.overlayTitles?.[k]??"").trim().slice(0,60);c.overlayTitles[k]=v||String(titleDefaults?.[k]||textPackKit.NEUTRAL.gameOverlayTitles[k]);}
  c.overlayPublicUrl=String(c.overlayPublicUrl||DEFAULT_CONFIG.overlayPublicUrl).trim();
  c.overlayKey=String(c.overlayKey||"").trim();
  c.overlayStatusDisplay=["problem","always","never"].includes(c.overlayStatusDisplay)?c.overlayStatusDisplay:"problem";
  c.overlayScale=int(c.overlayScale,40,100);
  c.overlayAnchor=OVERLAY_ANCHORS.includes(c.overlayAnchor)?c.overlayAnchor:DEFAULT_CONFIG.overlayAnchor;
  c.overlayMargin=int(c.overlayMargin,0,300);
  c.overlayDetail=["full","compact"].includes(c.overlayDetail)?c.overlayDetail:"full";
  c.joinChatMode=["auto","all","everyNth","off"].includes(c.joinChatMode)?c.joinChatMode:"auto";
  c.joinChatAutoSingles=int(c.joinChatAutoSingles,1,50);
  c.joinChatSummarySeconds=int(c.joinChatSummarySeconds,3,60);
  c.joinChatEveryNth=int(c.joinChatEveryNth,2,100);
  c.giftAllowBroadcaster=c.giftAllowBroadcaster!==false;
  c.giftAllowControlOwners=c.giftAllowControlOwners===true;
  c.giftMaxAmount=int(c.giftMaxAmount,0,100_000_000);
  c.bot=String(c.bot||"");
  c.enabled=c.enabled!==false;
  return c;
}
function freshStateWith(phraseDefaults,titleDefaults){
  return {
    schemaVersion:1,
    config:normalizeConfig({...DEFAULT_CONFIG,phrases:{}},phraseDefaults(),titleDefaults()),
    accounts:{},
    rounds:[],
    transactions:[],
    activeRound:null,
    nextRoundAllowedAt:null,
    resetGeneration:0,
    lastReset:null,
    updatedAt:nowIso()
  };
}
function normalizeStateWith(s,phraseDefaults,titleDefaults){
  const x=s&&typeof s==="object"&&!Array.isArray(s)?s:freshStateWith(phraseDefaults,titleDefaults);
  x.schemaVersion=1;
  x.config=normalizeConfig(x.config||{},phraseDefaults(),titleDefaults());
  x.accounts=x.accounts&&typeof x.accounts==="object"&&!Array.isArray(x.accounts)?x.accounts:{};
  // 9.9.1: lastDailyDate immer als „JJJJ-MM-TT“ führen (beim Lesen und beim Zurückschreiben).
  for(const a of Object.values(x.accounts))if(a&&typeof a==="object")a.lastDailyDate=dateKeyOf(a.lastDailyDate);
  x.rounds=Array.isArray(x.rounds)?x.rounds:[];
  x.transactions=Array.isArray(x.transactions)?x.transactions:[];
  x.activeRound=x.activeRound||null;
  x.nextRoundAllowedAt=x.nextRoundAllowedAt||null;
  x.resetGeneration=Number(x.resetGeneration||0);
  x.lastReset=x.lastReset||null;
  return x;
}

// Chat-Befehle des Moduls; die Twitch-Laufzeit leitet nur diese Nachrichten an das Modul weiter.
// 9.11.0: Feste Befehle (für jedes Spiel passend). Die vier übrigen (Runde, Kontostand, Rangliste, Hilfe)
// kommen aus dem Installationsprofil und sind anpassbar; siehe chatCommands().
const CHAT_COMMANDS=Object.freeze([...FIXED_GAME_COMMANDS]);
function createStubenkontrolle({dataDir,storage=null,storageKey="stubenkontrolle",sendChat,resolveUser,audit,isActive=()=>true,controlOwnerTwitchIds=()=>[],naming=()=>NEUTRAL_GAME,publicBaseUrl=()=>"",textPack=()=>textPackKit.NEUTRAL}){
  const gameLines=()=>{try{return textPack().gameLines||textPackKit.NEUTRAL.gameLines;}catch{return textPackKit.NEUTRAL.gameLines;}};
  const freshState=()=>freshStateWith(phraseDefaults,titleDefaults);
  const normalizeState=s=>normalizeStateWith(s,phraseDefaults,titleDefaults);
  const titleDefaults=()=>{try{return textPack().gameOverlayTitles||textPackKit.NEUTRAL.gameOverlayTitles;}catch{return textPackKit.NEUTRAL.gameOverlayTitles;}};
  const phraseDefaults=()=>{try{return textPack().gamePhrases||textPackKit.NEUTRAL.gamePhrases;}catch{return textPackKit.NEUTRAL.gamePhrases;}};
  // 9.11.0: Spielname, Punktename und Befehle (Installationsprofil). Fehler → neutrale Werte.
  function names(){ try{ return normalizeGame(naming()); }catch{ return normalizeGame(NEUTRAL_GAME); } }
  const gameNames=names; // Alias für Stellen, an denen ein lokales „names“ den Namen verdeckt
  function chatCommands(){ const n=names(); return [...new Set([...Object.values(n.commands),...CHAT_COMMANDS])]; }
  function nameVars(){ const n=names(); return {game:n.name,GAME:n.name.toUpperCase(),points:n.pointsName,startCommand:n.commands.start}; }
  function overlayUrl(s){
    const own=String(s?.config?.overlayPublicUrl||"").trim(); if(own) return own;
    try{ const b=new URL(String(publicBaseUrl()||"")); return `${b.protocol==="http:"?"ws":"wss"}://${b.host}/ws/stubenkontrolle`; }catch{ return ""; }
  }
  const file=path.join(dataDir,"stubenkontrolle.json");
  const resetBackupDir=path.join(dataDir,"spindpunkte-backups");
  const clients=new Set();
  let roundTimer=null;
  let phaseTimer=null;
  let overlayTestTimer=null;
  let overlayTestState=null;
  let lastOverlayConnectAt=null;

  function attachDbRevision(state,revision){
    try{Object.defineProperty(state,"_dbRevision",{value:Number(revision||0),writable:true,configurable:true,enumerable:false});}catch{}
    return state;
  }
  function read(){
    try {
      if(storage?.enabled&&typeof storage.getSpindState==="function"){
        const r=storage.getSpindState();
        if(!r?.found){ensureFile();return read();}
        return attachDbRevision(normalizeState(r.state),r.revision);
      }
      if(storage?.enabled)return normalizeState(storage.getDocument(storageKey,freshState()));
      return normalizeState(JSON.parse(fs.readFileSync(file,"utf8")));
    }
    catch(e){
      if(storage?.enabled)throw e;
      const s=freshState(); write(s); return s;
    }
  }
  function write(s,{replace=false}={}){
    s=normalizeState(s); s.updatedAt=nowIso();
    if(storage?.enabled&&typeof storage.putSpindState==="function"){
      const expected=Number.isFinite(Number(s._dbRevision))?Number(s._dbRevision):null;
      const clean=deepClone(s);
      const r=storage.putSpindState(clean,expected,{replace});
      return attachDbRevision(s,r?.revision);
    }
    if(storage?.enabled){storage.putDocument(storageKey,s);return s;}
    fs.mkdirSync(dataDir,{recursive:true});
    const tmp=`${file}.tmp`;
    fs.writeFileSync(tmp,JSON.stringify(s,null,2));
    fs.renameSync(tmp,file);
    return s;
  }
  function ensureFile(){
    if(storage?.enabled&&typeof storage.getSpindState==="function"){
      const current=storage.getSpindState();
      if(current?.found)return;
      let legacy=freshState(),source="fresh";
      if(typeof storage.hasDocument==="function"&&storage.hasDocument(storageKey)){
        legacy=normalizeState(storage.getDocument(storageKey,freshState())); source="postgres-jsonb";
      }else if(fs.existsSync(file)){
        try{legacy=normalizeState(JSON.parse(fs.readFileSync(file,"utf8")));source="legacy-json";}catch{}
      }
      const imported=storage.importSpindStateIfEmpty(deepClone(legacy));
      if(imported?.inserted&&typeof storage.markImport==="function"){
        try{storage.markImport(`relational:${storageKey}`,null,{kind:"relational-spindpunkte",source,accounts:Object.keys(legacy.accounts||{}).length,rounds:(legacy.rounds||[]).length+(legacy.activeRound?1:0),transactions:(legacy.transactions||[]).length});}catch{}
      }
      return;
    }
    if(storage?.enabled){if(!storage.hasDocument(storageKey))write(freshState());return;}
    if(!fs.existsSync(file)) write(freshState());
  }
  function tx(s,type,{userId=null,otherUserId=null,amount=0,roundId=null,note="",actor=null,meta=null}={}){
    s.transactions.push({id:uid("tx"),ts:nowIso(),type,userId,otherUserId,amount:Math.round(Number(amount)||0),roundId,note,actor,meta});
  }
  function account(s,user,{grantStarter=false}={}){
    const id=String(user.id||user.userId||"");
    if(!id) throw new Error("Twitch User-ID fehlt.");
    if(!s.accounts[id]){
      s.accounts[id]={userId:id,login:String(user.login||"").toLowerCase(),name:String(user.name||user.display_name||user.login||id),balance:0,reserved:0,starterGranted:false,lastDailyDate:null,createdAt:nowIso(),updatedAt:nowIso()};
    }
    const a=s.accounts[id];
    if(user.login) a.login=String(user.login).toLowerCase();
    if(user.name||user.display_name) a.name=String(user.name||user.display_name);
    a.balance=money(a.balance); a.reserved=money(a.reserved);
    if(grantStarter && !a.starterGranted){
      const amount=money(s.config.starterPoints);
      a.balance+=amount; a.starterGranted=true;
      tx(s,"starter",{userId:id,amount,note:"Einmaliges Startguthaben"});
    }
    a.updatedAt=nowIso();
    return a;
  }
  function userFromEvent(ev){ return {id:String(ev.chatter_user_id||""),login:String(ev.chatter_user_login||"").toLowerCase(),name:String(ev.chatter_user_name||ev.chatter_user_login||"")}; }
  function publicGamePhrase(text){
    return String(text||"")
      .replace(/\bRunde\s+\{round\}/gi,"Runde")
      .replace(/\bStubenkontrolle\s+\{round\}/gi,"Stubenkontrolle")
      .replace(/\{game\}\s+\{round\}/gi,"{game}")
      .replace(/\s*\{round\}/gi,"")
      // 8.9.2: nur Leerraum vor Satzzeichen am Wortende entfernen ("Mit !stube" bleibt erhalten).
      .replace(/\s+([.,:;!?])(?=\s|$)/g,"$1")
      .replace(/\s{2,}/g," ")
      .trim();
  }
  function phrase(s,key,vars){
    const template=publicGamePhrase(pick(s.config.phrases?.[key]||[]));
    const safeVars={...nameVars(),...(vars||{})};
    delete safeVars.round;
    return render(template,safeVars);
  }
  // priority: "high" (Kontrolle, Ergebnis, Eröffnung), "normal" (Standard), "low" (Beitritts-Meldungen).
  function chat(s,text,priority){ if(text) return sendChat(s.config.bot||"",text,{priority:priority||"normal",source:"stubenkontrolle"}); }
  function participantById(r,id){ return r?.participants?.find(p=>String(p.userId)===String(id)); }
  function roundPublic(r){
    if(!r) return null;
    return {
      id:r.id,status:r.status,createdAt:r.createdAt,joinEndsAt:r.joinEndsAt,controlEndsAt:r.controlEndsAt,endedAt:r.endedAt,cooldownEndsAt:r.cooldownEndsAt,
      factor:r.factor,mode:r.mode||null,overlayPhrase:r.overlayPhrase||"",
      participants:(r.participants||[]).map(p=>({userId:p.userId,login:p.login,name:p.name,bet:p.bet,outcome:p.outcome||null,payout:p.payout||0,delta:p.delta||0}))
    };
  }
  function overlayState(){
    const s=read();
    const r=s.activeRound || s.rounds.at(-1) || null;
    let phase="idle";
    if(overlayTestState) return overlayTestState;
    if(s.activeRound?.status==="open") phase="registration";
    else if(s.activeRound?.status==="control") phase="control";
    else if(r?.status==="completed" && r?.overlayHideAt && Date.now()<new Date(r.overlayHideAt).getTime()) phase="result";
    return {type:"stubenkontrolle.state",serverTime:Date.now(),phase,round:roundPublic(r),nextRoundAllowedAt:s.nextRoundAllowedAt,config:{minBet:s.config.minBet,maxBet:s.config.maxBet,command:`${names().commands.start} BETRAG`,gameName:names().name,pointsName:names().pointsName,resultDisplaySeconds:s.config.resultDisplaySeconds,statusDisplay:s.config.overlayStatusDisplay,titles:s.config.overlayTitles,layout:overlayLayout(s.config)}};
  }
  function wsFrame(text){
    const payload=Buffer.from(String(text));
    let header;
    if(payload.length<126){ header=Buffer.from([0x81,payload.length]); }
    else if(payload.length<65536){ header=Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(payload.length,2); }
    else { header=Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(payload.length),2); }
    return Buffer.concat([header,payload]);
  }
  function sendWs(client,obj){
    try { client.socket.write(wsFrame(JSON.stringify(obj))); return true; }
    catch { clients.delete(client); try{client.socket.destroy();}catch{} return false; }
  }
  function broadcast(){ const state=overlayState(); for(const c of [...clients]) sendWs(c,state); }
  function overlayStatus(){ return {connectedClients:clients.size,lastConnectAt:lastOverlayConnectAt,endpoint:"/ws/stubenkontrolle",testActive:!!overlayTestState}; }

  function scheduleRound(){
    if(roundTimer){ clearTimeout(roundTimer); roundTimer=null; }
    if(phaseTimer){ clearTimeout(phaseTimer); phaseTimer=null; }
    const s=read(); const r=s.activeRound;
    if(!r) return;
    if(r.status==="open"){
      const ms=Math.max(0,new Date(r.joinEndsAt).getTime()-Date.now());
      roundTimer=setTimeout(()=>beginControl().catch(console.error),ms);
    }else if(r.status==="control"){
      const ms=Math.max(0,new Date(r.controlEndsAt).getTime()-Date.now());
      phaseTimer=setTimeout(()=>settleRound().catch(console.error),ms);
    }
  }
  function modeFor(c){
    const a=Math.max(0,Number(c.individualModePct||0)), b=Math.max(0,Number(c.allPassModePct||0)), d=Math.max(0,Number(c.allCaughtModePct||0));
    const total=a+b+d||1, x=Math.random()*total;
    if(x<a) return "individual";
    if(x<a+b) return "allPass";
    return "allCaught";
  }
  async function beginControl(){
    const s=read(), r=s.activeRound;
    if(!r||r.status!=="open") return;
    r.factor=Number(factorFor(s.config,r.participants.length).toFixed(2));
    r.mode=modeFor(s.config);
    r.status="control";
    r.controlStartedAt=nowIso();
    r.controlEndsAt=new Date(Date.now()+s.config.controlAnimationSeconds*1000).toISOString();
    const controlText=phrase(s,"control",{count:r.participants.length,factor:r.factor,round:r.id});
    const modeText=publicGamePhrase(r.mode==="allPass" ? pick(s.config.phrases.allPass) : r.mode==="allCaught" ? pick(s.config.phrases.allCaught) : pick(s.config.phrases.individual));
    r.overlayPhrase=modeText||controlText;
    write(s); broadcast();
    clearJoinBatch(r.id);
    await chat(s,controlText,"high");
    await chat(s,modeText,"high");
    scheduleRound();
  }
  async function settleRound(){
    const s=read(), r=s.activeRound;
    if(!r||r.status!=="control") return;
    const winners=[],caught=[];
    for(const p of r.participants){
      const a=account(s,{id:p.userId,login:p.login,name:p.name});
      let pass=false;
      if(r.mode==="allPass") pass=true;
      else if(r.mode==="allCaught") pass=false;
      else pass=Math.random()*100<Number(s.config.individualPassPct||40);
      a.reserved=Math.max(0,a.reserved-p.bet);
      if(pass){
        p.outcome="passed"; p.payout=Math.round(p.bet*r.factor); p.delta=p.payout-p.bet; a.balance+=p.payout; winners.push(p);
        tx(s,"round_payout",{userId:p.userId,amount:p.payout,roundId:r.id,note:`Bestanden · Faktor x${r.factor}`});
      }else{
        p.outcome="caught"; p.payout=0; p.delta=-p.bet; caught.push(p);
        tx(s,"round_loss",{userId:p.userId,amount:-p.bet,roundId:r.id,note:`${gameNames().name} nicht bestanden`});
      }
      a.updatedAt=nowIso();
    }
    r.status="completed"; r.endedAt=nowIso();
    r.cooldownEndsAt=new Date(Date.now()+s.config.cooldownMinutes*60_000).toISOString();
    r.overlayHideAt=new Date(Date.now()+s.config.resultDisplaySeconds*1000).toISOString();
    s.nextRoundAllowedAt=r.cooldownEndsAt;
    // 8.9.3: Gewinner mit Nettogewinn „@Name (+250)“, Erwischte mit Verlust „@Name (-500)“, jeweils nach Punkten sortiert
    // (größter Gewinn bzw. Verlust zuerst). Mehr als 8 Personen: „und N weitere“, damit „+N“ nicht wie Punkte aussieht.
    const sorted=list=>[...list].sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta));
    const names=list=>list.length?sorted(list).slice(0,8).map(x=>`@${x.name} (${x.delta>=0?"+":"-"}${Math.abs(x.delta)})`).join(", ")+(list.length>8?` und ${list.length-8} weitere`:""):"niemand";
    const resultText=phrase(s,"result",{round:r.id,winners:names(winners),caught:names(caught)});
    r.overlayPhrase=resultText;
    s.rounds.push(r); s.activeRound=null;
    write(s); broadcast();
    await chat(s,resultText,"high");
    setTimeout(broadcast,s.config.resultDisplaySeconds*1000+200);
  }
  async function abortActive({reason="technical",refund=true,actor="system"}={}){
    const s=read(),r=s.activeRound;
    if(!r) return null;
    for(const p of r.participants||[]){
      const a=account(s,{id:p.userId,login:p.login,name:p.name});
      const reserved=Math.min(a.reserved,p.bet);
      a.reserved-=reserved;
      if(refund){ a.balance+=reserved; p.refundedAt=nowIso(); tx(s,"round_abort_refund",{userId:p.userId,amount:reserved,roundId:r.id,note:reason,actor}); }
      else tx(s,"round_reset_forfeit",{userId:p.userId,amount:-reserved,roundId:r.id,note:reason,actor});
    }
    r.status=refund?"aborted":"reset_aborted"; r.abortReason=reason; r.endedAt=nowIso(); r.invalidatedByReset=!refund;
    s.rounds.push(r); s.activeRound=null;
    if(!refund) s.nextRoundAllowedAt=null;
    write(s); broadcast(); scheduleRound();
    return r;
  }
  async function recoverOnStartup(){
    ensureFile();
    const s=read();
    if(s.activeRound){
      const id=s.activeRound.id;
      await abortActive({reason:"Technischer Neustart – Einsätze automatisch zurückgegeben",refund:true,actor:"system"});
      audit("system","stubenkontrolle.round.recovered",{section:"stubenkontrolle",roundId:id});
    }
    scheduleRound();
  }

  async function startOrJoin(ev,betRaw){
    let s=read(); const u=userFromEvent(ev); const a=account(s,u,{grantStarter:true});
    if(!s.config.enabled){ await chat(s,`🧹 ${names().name} ist derzeit deaktiviert.`); write(s); return; }
    const bet=Number(betRaw);
    if(!Number.isInteger(bet)||bet<s.config.minBet||bet>s.config.maxBet){ await chat(s,`@${u.name}: Erlaubter Einsatz: ${s.config.minBet} bis ${s.config.maxBet} ${names().pointsName}.`); write(s); return; }
    const active=s.activeRound;
    if(!active && s.nextRoundAllowedAt && Date.now()<new Date(s.nextRoundAllowedAt).getTime()){
      const sec=Math.ceil((new Date(s.nextRoundAllowedAt).getTime()-Date.now())/1000);
      await chat(s,render(gameLines().cooldown,{game:names().name,minutes:Math.ceil(sec/60)})); write(s); return;
    }
    if(a.balance<bet){ await chat(s,`@${u.name}: Dafür fehlen ${names().pointsName}. Verfügbar: ${a.balance}.`); write(s); return; }
    if(active && active.status!=="open"){ await chat(s,gameLines().closed); write(s); return; }
    if(active && participantById(active,u.id)){ await chat(s,`@${u.name}: Du bist in dieser Runde schon dabei.`); write(s); return; }

    if(!s.activeRound){
      const r={id:uid("stube"),generation:s.resetGeneration,status:"open",createdAt:nowIso(),joinEndsAt:new Date(Date.now()+s.config.registrationSeconds*1000).toISOString(),factor:Number(factorFor(s.config,1).toFixed(2)),mode:null,participants:[]};
      s.activeRound=r;
    }
    const r=s.activeRound;
    a.balance-=bet; a.reserved+=bet;
    r.participants.push({userId:u.id,login:u.login,name:u.name,bet,joinedAt:nowIso(),outcome:null,payout:0,delta:0,adminRefundedAt:null});
    r.factor=Number(factorFor(s.config,r.participants.length).toFixed(2));
    tx(s,"round_reserve",{userId:u.id,amount:-bet,roundId:r.id,note:"Einsatz reserviert"});
    const roundMessage=r.participants.length===1
      ? phrase(s,"roundOpened",{user:u.name,bet,seconds:s.config.registrationSeconds,round:r.id,factor:r.factor,count:1})
      : phrase(s,"joined",{user:u.name,bet,count:r.participants.length,factor:r.factor,round:r.id});
    r.overlayPhrase=roundMessage;
    write(s); broadcast(); scheduleRound();
    // Das Overlay zeigt immer alle. Im Chat entscheidet die Einstellung "Beitritts-Meldungen".
    if(r.participants.length===1) await chat(s,roundMessage,"high");
    else await announceJoin(s,r,roundMessage);
  }

  // 8.9.6: Beitritts-Meldungen im Chat dosieren, damit bei 200+ Anmeldungen der Bot
  // nicht in Twitchs Sendelimit läuft und Kontrolle/Ergebnis nicht untergehen.
  const joinBatches=new Map();
  function clearJoinBatch(roundId){
    const b=joinBatches.get(roundId);
    if(b?.timer) clearTimeout(b.timer);
    joinBatches.delete(roundId);
  }
  async function flushJoinBatch(roundId){
    const b=joinBatches.get(roundId); joinBatches.delete(roundId);
    if(!b||!b.added) return;
    const s=read(),r=s.activeRound;
    if(!r||r.id!==roundId||r.status!=="open") return;
    try{ await chat(s,phrase(s,"joinedBatch",{added:b.added,count:r.participants.length,factor:r.factor,round:r.id}),"low"); }
    catch(e){ console.error("Stubenkontrolle Sammelmeldung:",e); }
  }
  async function announceJoin(s,r,roundMessage){
    const c=s.config,count=r.participants.length;
    if(c.joinChatMode==="off") return;
    if(c.joinChatMode==="all") return chat(s,roundMessage,"low");
    if(c.joinChatMode==="everyNth") return count%c.joinChatEveryNth===0?chat(s,roundMessage,"low"):undefined;
    // auto: die ersten N einzeln, danach gesammelt.
    if(count<=c.joinChatAutoSingles) return chat(s,roundMessage,"low");
    let b=joinBatches.get(r.id);
    if(!b){ b={added:0,timer:null}; joinBatches.set(r.id,b); }
    b.added++;
    if(!b.timer){ b.timer=setTimeout(()=>{flushJoinBatch(r.id);},c.joinChatSummarySeconds*1000); b.timer.unref?.(); }
  }
  async function handleDaily(ev){
    const s=read(),u=userFromEvent(ev),a=account(s,u,{grantStarter:true}),today=berlinDateKey();
    if(dateKeyOf(a.lastDailyDate)===today){ await chat(s,`@${u.name}: Dein !daily hast du heute schon abgeholt. Morgen gibt's Nachschub.`); write(s); return; }
    a.lastDailyDate=today; a.balance+=s.config.dailyPoints; a.updatedAt=nowIso();
    tx(s,"daily",{userId:u.id,amount:s.config.dailyPoints,note:`Daily ${today}`}); write(s);
    await chat(s,`🎁 @${u.name} erhält ${s.config.dailyPoints} ${names().pointsName}. Guthaben: ${a.balance}.`);
  }
  async function handleBalance(ev){
    const s=read(),u=userFromEvent(ev),a=account(s,u,{grantStarter:true}); write(s);
    await chat(s,`🪙 @${u.name}: ${a.balance} ${names().pointsName} verfügbar${a.reserved?` · ${a.reserved} reserviert`:""}.`);
  }
  async function handleGive(ev,args){
    const u=userFromEvent(ev);
    const login=String(args[0]||"").replace(/^@/,"").toLowerCase(); const amount=Number(args[1]);
    if(!login||!Number.isInteger(amount)||amount<=0){ const s=read(); account(s,u,{grantStarter:true}); write(s); await chat(s,`@${u.name}: Nutzung: !give NICK BETRAG`); return; }
    if(login===u.login){ const s=read(); account(s,u,{grantStarter:true}); write(s); await chat(s,`@${u.name}: Selbstüberweisungen sind nicht möglich.`); return; }
    const target=await resolveUser(login);
    if(!target){ const s=read(); account(s,u,{grantStarter:true}); write(s); await chat(s,`@${u.name}: Twitch-Nutzer @${login} wurde nicht gefunden.`); return; }
    if(String(target.id)===u.id){ const s=read(); account(s,u,{grantStarter:true}); write(s); await chat(s,`@${u.name}: Selbstüberweisungen sind nicht möglich.`); return; }
    const s=read(),a=account(s,u,{grantStarter:true});
    if(a.balance<amount){ write(s); await chat(s,`@${u.name}: Nicht genug verfügbare ${names().pointsName}.`); return; }
    const b=account(s,{id:target.id,login:target.login,name:target.display_name||target.login},{grantStarter:false});
    a.balance-=amount; b.balance+=amount;
    tx(s,"transfer_out",{userId:u.id,otherUserId:b.userId,amount:-amount,note:`an @${b.login}`});
    tx(s,"transfer_in",{userId:b.userId,otherUserId:u.id,amount:amount,note:`von @${u.login}`});
    write(s);
    await chat(s,`🤝 @${u.name} überweist @${b.name} ${amount} ${names().pointsName}.`);
  }
  // 9.10.0: Darf diese Person !gift nutzen? Unberechtigte werden stillschweigend ignoriert (Entscheidung Mario).
  function giftAllowed(ev,c){
    const id=String(ev?.chatter_user_id||"");
    if(!id)return false;
    if(c.giftAllowBroadcaster&&id===String(ev?.broadcaster_user_id||""))return true;
    if(c.giftAllowControlOwners){let ids=[];try{ids=(controlOwnerTwitchIds()||[]).map(String);}catch{ids=[];}if(ids.includes(id))return true;}
    return false;
  }
  // Rückgabe false = nicht berechtigt → Nachricht gilt als nicht übernommen (eigene Commands mit gleichem Namen greifen).
  async function handleGift(ev,args){
    const s0=read();
    if(!giftAllowed(ev,s0.config))return false;
    const u=userFromEvent(ev);
    const login=String(args[0]||"").replace(/^@/,"").toLowerCase(); const amount=Number(args[1]);
    if(!login||!Number.isInteger(amount)||amount<=0){ await chat(s0,`@${u.name}: Nutzung: !gift NICK BETRAG`); return true; }
    const max=s0.config.giftMaxAmount;
    if(max>0&&amount>max){ await chat(s0,`@${u.name}: Höchstens ${max} ${names().pointsName} pro !gift.`); return true; }
    const target=await resolveUser(login);
    if(!target){ await chat(s0,`@${u.name}: Twitch-Nutzer @${login} wurde nicht gefunden.`); return true; }
    const s=read();
    const b=account(s,{id:target.id,login:target.login,name:target.display_name||target.login},{grantStarter:false});
    b.balance+=amount; b.updatedAt=nowIso();
    tx(s,"gift",{userId:b.userId,otherUserId:u.id,amount,note:`Geschenk von @${u.login}`});
    write(s);
    try{audit?.(u.login||u.name||"twitch","stubenkontrolle.gift",{section:"stubenkontrolle",target:b.login,targetId:b.userId,amount});}catch{}
    await chat(s,`🎁 @${u.name} schenkt @${b.name} ${amount} ${names().pointsName}. Guthaben: ${b.balance}.`);
    return true;
  }
  async function handleTop(ev){
    const s=read(); account(s,userFromEvent(ev),{grantStarter:true}); write(s);
    const top=Object.values(s.accounts).sort((a,b)=>(b.balance+b.reserved)-(a.balance+a.reserved)).slice(0,5);
    const text=top.length?top.map((a,i)=>`${i+1}. ${a.name} ${a.balance+a.reserved}`).join(" · "):"noch keine Konten";
    await chat(s,`🏆 Top ${names().pointsName}: ${text}`);
  }
  async function handleHelp(ev){
    const s=read(); account(s,userFromEvent(ev),{grantStarter:true}); write(s);
    const n=names(),c=n.commands;
    await chat(s,`🧹 ${n.name}: ${c.start} BETRAG (${s.config.minBet}-${s.config.maxBet}) · ${c.balance} · !daily · !give NICK BETRAG · ${c.top} · ${c.help}. Einsatz wird reserviert; Bestehen zahlt Einsatz × Faktor aus.`);
  }
  async function handleChat(ev,msg){
    const parts=String(msg||"").trim().split(/\s+/),cmd=(parts.shift()||"").toLowerCase();
    // 9.11.0: feste Befehle haben Vorrang; die vier anpassbaren kommen aus dem Installationsprofil.
    const c=names().commands;
    if(!chatCommands().includes(cmd)) return false;
    try{
      if(cmd==="!daily") await handleDaily(ev);
      else if(cmd==="!give") await handleGive(ev,parts);
      else if(cmd==="!gift") return await handleGift(ev,parts);
      else if(cmd===c.start) await startOrJoin(ev,parts[0]);
      else if(cmd===c.balance) await handleBalance(ev);
      else if(cmd===c.top) await handleTop(ev);
      else await handleHelp(ev);
    }catch(e){ console.error("Punktespiel Command Fehler:",e); const s=read(); await chat(s,`⚠️ ${names().name} hat gerade einen technischen Fehler. Es wurden keine zusätzlichen Punkte abgezogen.`); }
    return true;
  }

  function publicConfig(s){ const c=deepClone(s.config); c.overlayEffectiveUrl=overlayUrl(s); c.naming=names(); c.overlayKey=c.overlayKey?`${c.overlayKey.slice(0,4)}…${c.overlayKey.slice(-4)}`:""; return c; }
  function summary(){
    const s=read();
    return {config:publicConfig(s),activeRound:roundPublic(s.activeRound),nextRoundAllowedAt:s.nextRoundAllowedAt,accounts:Object.keys(s.accounts).length,rounds:s.rounds.length,transactions:s.transactions.length,overlay:overlayStatus(),lastReset:s.lastReset};
  }
  function listAccounts({search="",limit=100}={}){
    const s=read(),q=String(search||"").toLowerCase().trim();
    return Object.values(s.accounts).filter(a=>!q||a.login.includes(q)||a.name.toLowerCase().includes(q)||a.userId.includes(q)).sort((a,b)=>(b.balance+b.reserved)-(a.balance+a.reserved)).slice(0,Math.min(500,Math.max(1,limit))).map(a=>({...a,total:a.balance+a.reserved}));
  }
  function listRounds(limit=50){ const s=read(); return [...s.rounds].reverse().slice(0,Math.min(200,Math.max(1,limit))).map(roundPublic); }
  function transactions(limit=100){
    const s=read(),accountView=id=>{
      const a=s.accounts?.[String(id||"")];
      return a?{userId:a.userId,login:a.login,name:a.name}:null;
    };
    return [...s.transactions].reverse().slice(0,Math.min(500,Math.max(1,limit))).map(t=>({
      ...t,user:accountView(t.userId),otherUser:accountView(t.otherUserId)
    }));
  }
  function updateConfig(patch){
    const s=read(); const key=s.config.overlayKey;
    s.config=normalizeConfig({...s.config,...patch,overlayKey:key,phrases:{...s.config.phrases,...(patch.phrases||{})},overlayTitles:{...s.config.overlayTitles,...(patch.overlayTitles||{})}},phraseDefaults(),titleDefaults()); write(s); broadcast(); return publicConfig(s);
  }
  function setOverlayAccess({url,key,generate=false}){
    const s=read(),previousKey=String(s.config.overlayKey||"");
    if(url!==undefined) s.config.overlayPublicUrl=String(url||"").trim();
    if(generate||!s.config.overlayKey) s.config.overlayKey=crypto.randomBytes(24).toString("hex");
    else if(key!==undefined) s.config.overlayKey=String(key||"").trim();
    write(s);
    if(previousKey!==String(s.config.overlayKey||"")){
      for(const c of [...clients]){try{c.socket.end();}catch{}clients.delete(c);}
    }
    return {overlayPublicUrl:s.config.overlayPublicUrl,overlayEffectiveUrl:overlayUrl(s),overlayKey:s.config.overlayKey,status:overlayStatus()};
  }
  async function adminCredit({login,amount,note,actor}){
    const n=Number(amount); if(!Number.isInteger(n)||n<=0) throw new Error("Betrag muss eine positive ganze Zahl sein.");
    const target=await resolveUser(String(login||"").replace(/^@/,"").toLowerCase()); if(!target) throw new Error("Twitch-Nutzer nicht gefunden.");
    const s=read(),a=account(s,{id:target.id,login:target.login,name:target.display_name||target.login},{grantStarter:false}); a.balance+=n;
    tx(s,"admin_credit",{userId:a.userId,amount:n,note:String(note||"Admin-Gutschrift"),actor}); write(s);
    return {...a,total:a.balance+a.reserved};
  }
  function refundRound({roundId,userId=null,actor}){
    const s=read(); const r=s.rounds.find(x=>x.id===roundId); if(!r) throw new Error("Runde nicht gefunden.");
    if(r.invalidatedByReset||Number(r.generation||0)<Number(s.resetGeneration||0)) throw new Error(`Diese Runde wurde durch einen ${names().pointsName}-Reset endgültig ungültig gemacht.`);
    if(r.status!=="completed") throw new Error("Nur abgeschlossene Runden können administrativ erstattet werden.");
    const targets=(r.participants||[]).filter(p=>(!userId||String(p.userId)===String(userId))&&p.outcome==="caught");
    if(userId&&!targets.length) throw new Error("Teilnehmer nicht gefunden, hat bestanden oder wurde bereits anderweitig behandelt.");
    let count=0,total=0;
    for(const p of targets){
      if(p.adminRefundedAt) continue;
      const a=account(s,{id:p.userId,login:p.login,name:p.name},{grantStarter:false}); a.balance+=p.bet; p.adminRefundedAt=nowIso(); count++; total+=p.bet;
      tx(s,"admin_round_refund",{userId:p.userId,amount:p.bet,roundId:r.id,note:"Verlorener Einsatz erstattet",actor});
    }
    write(s); return {count,total,round:roundPublic(r)};
  }
  function createResetBackup(s){
    fs.mkdirSync(resetBackupDir,{recursive:true});
    const stamp=new Date().toISOString().replace(/[:.]/g,"-"); const target=path.join(resetBackupDir,`stubenkontrolle-pre-reset-${stamp}.json`);
    fs.writeFileSync(target,JSON.stringify(s,null,2)); return target;
  }
  async function resetAll({actor,confirmation}){
    if(String(confirmation)!=="RESET") throw new Error("Zur Bestätigung muss exakt RESET eingegeben werden.");
    let s=read(); const backupPath=createResetBackup(s); const activeId=s.activeRound?.id||null;
    if(s.activeRound){
      const r=s.activeRound;
      for(const p of r.participants||[]){ const a=account(s,{id:p.userId,login:p.login,name:p.name}); const reserved=Math.min(a.reserved,p.bet); a.reserved-=reserved; tx(s,"round_reset_forfeit",{userId:p.userId,amount:-reserved,roundId:r.id,note:`Expliziter ${names().pointsName}-Gesamtreset`,actor}); }
      r.status="reset_aborted"; r.abortReason=`${names().pointsName}-Gesamtreset`; r.endedAt=nowIso(); r.invalidatedByReset=true; s.rounds.push(r); s.activeRound=null;
    }
    let totalBurned=0,accounts=0;
    for(const a of Object.values(s.accounts)){ totalBurned+=money(a.balance)+money(a.reserved); a.balance=0; a.reserved=0; a.updatedAt=nowIso(); accounts++; }
    s.resetGeneration=Number(s.resetGeneration||0)+1; s.nextRoundAllowedAt=null;
    s.lastReset={ts:nowIso(),actor,accounts,totalBurned,backupPath};
    tx(s,"reset_all",{amount:-totalBurned,note:`Alle ${names().pointsName} auf 0 gesetzt (${accounts} Konten)`,actor,meta:{backupPath,activeRoundId:activeId}});
    write(s); overlayTestState=null; broadcast(); scheduleRound();
    audit(actor,"stubenkontrolle.reset",{section:"stubenkontrolle",accounts,totalBurned,backupPath,activeRoundId:activeId});
    return {ok:true,accounts,totalBurned,backupPath,lastReset:s.lastReset};
  }
  function exportBackup(){ const s=deepClone(read()); if(s.config) s.config.overlayKey=""; return s; }
  function restoreBackup(data){
    const current=read(),incoming=normalizeState(deepClone(data)); incoming.config.overlayKey=current.config.overlayKey;
    if(storage?.enabled&&typeof storage.putSpindState==="function") attachDbRevision(incoming,current._dbRevision);
    write(incoming,{replace:true}); overlayTestState=null; broadcast(); scheduleRound(); return true;
  }
  function testOverlay(requested="registration"){
    // 8.9.0: nur bekannte Szenarien; "caught" zeigt ein Ergebnis, in dem alle erwischt werden.
    const known=["registration","control","result","caught"];
    const choice=known.includes(String(requested))?String(requested):"registration";
    const allCaught=choice==="caught";
    const scenario=allCaught?"result":choice;
    // Testdauer: Anmeldung 20 s, Kontrolle und Ergebnis so lange wie im echten Spiel eingestellt.
    const cfg=read().config;
    const testMs=scenario==="result"?cfg.resultDisplaySeconds*1000:scenario==="control"?cfg.controlAnimationSeconds*1000:20_000;
    const end=new Date(Date.now()+testMs).toISOString();
    const sample=[
      {userId:"1",login:"alpha",name:"Alpha",bet:100,outcome:scenario==="result"?(allCaught?"caught":"passed"):null,payout:allCaught?0:180,delta:allCaught?-100:80},
      {userId:"2",login:"bravo",name:"Bravo",bet:200,outcome:scenario==="result"?"caught":null,payout:0,delta:-200},
      {userId:"3",login:"charlie",name:"Charlie",bet:150,outcome:scenario==="result"?(allCaught?"caught":"passed"):null,payout:allCaught?0:270,delta:allCaught?-150:120}
    ];
    overlayTestState={type:"stubenkontrolle.state",serverTime:Date.now(),phase:scenario,round:{id:"TEST-RUNDE-"+crypto.randomBytes(4).toString("hex"),status:scenario==="registration"?"open":scenario==="result"?"completed":scenario,factor:1.8,joinEndsAt:end,controlEndsAt:end,participants:sample,mode:scenario==="result"?(allCaught?"allCaught":"individual"):null},config:{minBet:50,maxBet:500,command:`${names().commands.start} BETRAG`,gameName:names().name,pointsName:names().pointsName,resultDisplaySeconds:cfg.resultDisplaySeconds,statusDisplay:cfg.overlayStatusDisplay,layout:overlayLayout(cfg)},test:true};
    broadcast(); if(overlayTestTimer) clearTimeout(overlayTestTimer); overlayTestTimer=setTimeout(()=>{overlayTestState=null;broadcast();},testMs); overlayTestTimer.unref?.(); return overlayTestState;
  }

  function attachWebSocket(server){
    server.on("upgrade",(req,socket)=>{
      try{
        const u=new URL(req.url,"http://localhost");
        if(u.pathname!=="/ws/stubenkontrolle"){socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");socket.destroy();return;}
        // 9.3.0: Modul ausgeschaltet → kein Overlay-Anschluss.
        if(!isActive()){socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");socket.destroy();return;}
        if(clients.size>=8){socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");socket.destroy();return;}
        const allowedOrigins=String(process.env.STUBENKONTROLLE_ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
        const origin=String(req.headers.origin||"");
        if(allowedOrigins.length&&!allowedOrigins.includes(origin)){socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");socket.destroy();return;}
        const s=read(),provided=String(u.searchParams.get("key")||"");
        if(!s.config.overlayKey||!provided||!crypto.timingSafeEqual(Buffer.from(provided.padEnd(Math.max(provided.length,s.config.overlayKey.length),"\0")),Buffer.from(s.config.overlayKey.padEnd(Math.max(provided.length,s.config.overlayKey.length),"\0")))){ socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
        const key=req.headers["sec-websocket-key"]; if(!key){socket.destroy();return;}
        const accept=crypto.createHash("sha1").update(key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+accept+"\r\n\r\n");
        const client={socket,connectedAt:nowIso()}; clients.add(client); lastOverlayConnectAt=client.connectedAt; sendWs(client,overlayState());
        socket.on("close",()=>clients.delete(client)); socket.on("end",()=>clients.delete(client)); socket.on("error",()=>clients.delete(client));
        socket.on("data",buf=>{ if(buf?.length && (buf[0]&0x0f)===0x8){ clients.delete(client); try{socket.end();}catch{} } });
      }catch{ try{socket.destroy();}catch{} }
    });
    setInterval(()=>{ for(const c of [...clients]) sendWs(c,overlayState()); },20_000).unref?.();
  }

  return {ensureFile,recoverOnStartup,handleChat,chatCommands,names,summary,listAccounts,listRounds,transactions,updateConfig,setOverlayAccess,adminCredit,refundRound,resetAll,exportBackup,restoreBackup,testOverlay,overlayStatus,attachWebSocket,readState:read};
}

module.exports={createStubenkontrolle,DEFAULT_CONFIG,CHAT_COMMANDS};
