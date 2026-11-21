"use strict";
// Version 8.1 development module. Disabled until deliberately enabled by administrators.
// Neutrale Vorgabe (9.18.1). Die bisherigen Dienstgrade, Kanalnamen und Einsätze der Bestandsinstallation stehen in
// shared/legacy-bwk-migration.js (legacyLevelPreset) und werden nur dort verwendet.
const RANK_NAMES = [
 ['Stufe 1','Stufe 1',50],['Stufe 2','Stufe 2',125],['Stufe 3','Stufe 3',250],['Stufe 4','Stufe 4',450],['Stufe 5','Stufe 5',700],['Stufe 6','Stufe 6',1000],['Stufe 7','Stufe 7',1400],['Stufe 8','Stufe 8',1850],['Stufe 9','Stufe 9',2400],['Stufe 10','Stufe 10',3050]
];
const DEFAULT_LEVEL_NAMES={category:'╭➤ LEVELSYSTEM',regeln:'📜・regeln',topliste:'🏆・topliste',befoerderungen:'🎖️・aufstiege',rangprofile:'🪪・rangprofile'};
function validateChannelNames(names){if(!names||typeof names!=='object'||Array.isArray(names))throw Error('Ungültige Kanalnamen');const result={};for(const key of Object.keys(DEFAULT_LEVEL_NAMES)){const value=names[key];if(typeof value!=='string'||!value.trim()||[...value].length>90||/[\r\n\u0000-\u001f]/u.test(value))throw Error('Ungültiger Name für '+key);result[key]=value.trim();}if(new Set(Object.values(result).slice(1).map(n=>n.toLocaleLowerCase('de-DE'))).size!==4)throw Error('Kanalnamen müssen eindeutig sein');return result;}
const NEUTRAL_MISSIONS=[{id:'erkundung',name:'Erkundung',description:'Finde den richtigen Weg durch das Gelände.',enabled:true},{id:'training',name:'Trainingseinheit',description:'Absolviere eine Übung, um besser zu werden.',enabled:true},{id:'versorgung',name:'Versorgungsauftrag',description:'Bringe Material und Nachschub ans Ziel.',enabled:true},{id:'aufklaerung',name:'Spähmission',description:'Erkunde das Gebiet und melde deine Beobachtungen.',enabled:true}];
const defaultConfig=(preset)=>({noRankLabel:preset?.noRankLabel||'Ohne Rang',channelNames:{...(preset?.channelNames||DEFAULT_LEVEL_NAMES)},enabled:false,chatXp:5,memeXp:10,chatCooldownMs:60000,memeCooldownMs:600000,minChars:5,memeChannelId:null,reverseDeleted:true,announceManualPromotions:false,dailyEnabled:true,dailyMinXp:20,dailyMaxXp:50,missionEnabled:true,missionDailyLimit:2,missionMinHours:3,missionMaxHours:6,missionSuccessPercent:65,missionSuccessMinXp:40,missionSuccessMaxXp:100,missionFailMinXp:5,missionFailMaxXp:15,missionDefinitions:(preset?.missions||NEUTRAL_MISSIONS).map(m=>({...m})),ranks:(preset?.ranks||RANK_NAMES).map(([name,navy,xp],i)=>({id:i+1,heer:name,luftwaffe:name,marine:navy,xp,active:true,roleIds:{}})),channels:{},roleIds:{heer:null,luftwaffe:null,marine:null},shareCooldownMs:86400000,switchCooldownMs:2592000000});
const defaultState=()=>({users:{},grants:{},cooldowns:{},shares:{},xpAdjustments:[],rankEvents:[],dailyClaims:{},missions:{},missionLog:[],bonusGrants:[],updatedAt:null});
function validateRanks(ranks){if(!Array.isArray(ranks)||!ranks.length||ranks.length>100)throw Error('Ungültige Rangliste');let prev=-1;for(const r of ranks){if(!Number.isSafeInteger(r.xp)||r.xp<=prev||r.xp<0)throw Error('XP-Schwellen müssen eindeutig aufsteigen');for(const f of ['heer','luftwaffe','marine'])if(!String(r[f]||'').trim()||String(r[f]).length>80)throw Error('Ungültige Rangbezeichnung');prev=r.xp;}return true;}
function rankFor(xp,config=defaultConfig()){return config.ranks.filter(x=>x.active&&xp>=x.xp).at(-1)||null;}
function rankProfile(xp,branch='heer',config=defaultConfig()){const active=config.ranks.filter(x=>x.active);const current=rankFor(xp,config),next=active.find(x=>x.xp>xp)||null,start=current?.xp||0,end=next?.xp||start;return {xp,branch,rank:current?.[branch]||(config.noRankLabel||'Ohne Rang'),level:current?.id||0,next:next?.[branch]||null,missing:next?next.xp-xp:0,percent:next?Math.min(100,Math.max(0,Math.round((xp-start)/(end-start)*1000)/10)):100};}
function createEngine({load,save,guildId,clock=()=>Date.now(),preset=null}){
 const levelDefaults=defaultConfig(preset);let config={...levelDefaults,...(load('config')||{})};config.channelNames={...levelDefaults.channelNames,...(config.channelNames||{})};let state={...defaultState(),...(load('state')||{})};for(const key of ['dailyClaims','missions'])state[key] ||= {};for(const key of ['missionLog','bonusGrants'])state[key] ||= [];validateRanks(config.ranks);
 const persist=()=>{state.updatedAt=new Date(clock()).toISOString();save('state',state);};
 const member=(id)=>state.users[id]||{xp:0,branch:'heer',lastSwitchAt:null};
 function recordRankChange(id,beforeXp,afterXp,source,details={}){
  const previous=rankFor(beforeXp,config),current=rankFor(afterXp,config);
  if((previous?.id||0)===(current?.id||0))return null;
  const branch=member(String(id)).branch||'heer';
  const event={at:clock(),userId:String(id),source,fromLevel:previous?.id||0,toLevel:current?.id||0,fromRank:previous?.[branch]||(config.noRankLabel||'Ohne Rang'),toRank:current?.[branch]||(config.noRankLabel||'Ohne Rang'),beforeXp,afterXp,direction:(current?.id||0)>(previous?.id||0)?'promotion':'demotion',...details};
  state.rankEvents=Array.isArray(state.rankEvents)?state.rankEvents:[];state.rankEvents.push(event);
  if(state.rankEvents.length>10000)state.rankEvents.splice(0,state.rankEvents.length-10000);
  return event;
 }
 function rankHistory(id,limit=10){return (state.rankEvents||[]).filter(e=>String(e.userId)===String(id)).slice(-Math.max(1,Math.min(100,Number(limit)||10))).reverse();}

 function award(m){if(!config.enabled||String(m.guild_id)!==String(guildId)||!m.id||!m.author?.id||m.author.bot||m.webhook_id||m.type!==undefined&&![0,19].includes(m.type))return {awarded:0};const id=String(m.author.id),key=String(m.id);if(state.grants[key])return {awarded:0};const media=(m.attachments||[]).some(a=>String(a.content_type||'').startsWith('image/')||/\.(png|jpe?g|gif|webp)$/i.test(String(a.filename||'')));const isMeme=media&&String(m.channel_id)===String(config.memeChannelId);const content=String(m.content||'').trim();if(!isMeme&&[...content].length<config.minChars)return {awarded:0};const cooldownKey=`${id}:${isMeme?'meme':'chat'}`,ts=clock(),duration=isMeme?config.memeCooldownMs:config.chatCooldownMs;if(Object.hasOwn(state.cooldowns,cooldownKey)&&ts-state.cooldowns[cooldownKey]<duration)return {awarded:0};const xp=isMeme?config.memeXp:config.chatXp;if(!Number.isSafeInteger(xp)||xp<=0)return {awarded:0};const user=member(id),before=rankFor(user.xp,config);user.name=String(m.member?.nick||m.author?.global_name||m.author?.username||user.name||id).slice(0,80);const beforeXp=user.xp;user.xp+=xp;state.users[id]=user;recordRankChange(id,beforeXp,user.xp,isMeme?'meme':'chat',{messageId:key});state.grants[key]={userId:id,guildId,channelId:m.channel_id,xp,source:isMeme?'meme':'chat',at:ts,reversed:false};state.cooldowns[cooldownKey]=ts;persist();return {awarded:xp,userId:id,oldRank:before,newRank:rankFor(user.xp,config)};}
 function retract(messageId){if(!config.reverseDeleted)return {retracted:0};const g=state.grants[String(messageId)];if(!g||g.reversed)return {retracted:0};const u=member(g.userId);const before=rankFor(u.xp,config);const retracted=Math.min(g.xp,u.xp);const beforeXp=u.xp;u.xp-=retracted;state.users[g.userId]=u;recordRankChange(g.userId,beforeXp,u.xp,'deleted',{messageId:String(messageId)});g.reversed=true;g.reversedAt=clock();persist();return {retracted,userId:g.userId,oldRank:before,newRank:rankFor(u.xp,config)};}
 function reserve(id,command,ttl=300000){const key=`${id}:${command}`,ts=clock(),last=state.cooldowns[key]||0;if(last&&ts-last<ttl)return ttl-(ts-last);state.cooldowns[key]=ts;persist();return 0;}
 function changeBranch(id,branch){if(!['heer','luftwaffe','marine'].includes(branch))throw Error('Unbekannte Teilstreitkraft');const u=member(id),ts=clock();if(u.lastSwitchAt&&ts-u.lastSwitchAt<config.switchCooldownMs)return {ok:false,remaining:config.switchCooldownMs-(ts-u.lastSwitchAt)};u.branch=branch;u.lastSwitchAt=ts;state.users[id]=u;persist();return {ok:true,user:u};}
 function changeXp(id,mode,amount){if(!['add','subtract','set'].includes(mode)||!Number.isSafeInteger(amount)||amount<0)throw Error('Ungültige XP-Korrektur');const u=member(id),before=u.xp;u.xp=mode==='set'?amount:mode==='add'?u.xp+amount:Math.max(0,u.xp-amount);if(!Number.isSafeInteger(u.xp))throw Error('XP-Wert zu groß');state.users[id]=u;recordRankChange(id,before,u.xp,'manual',{mode});state.xpAdjustments=Array.isArray(state.xpAdjustments)?state.xpAdjustments:[];state.xpAdjustments.push({userId:String(id),at:clock(),mode,before,after:u.xp,delta:u.xp-before});if(state.xpAdjustments.length>3000)state.xpAdjustments.splice(0,state.xpAdjustments.length-3000);persist();return {before,after:u.xp};}
 function configure(patch){if(Object.prototype.hasOwnProperty.call(patch,'channelNames'))patch={...patch,channelNames:validateChannelNames(patch.channelNames)};const next={...config,...patch};
  for(const key of ['dailyMinXp','dailyMaxXp','missionDailyLimit','missionMinHours','missionMaxHours','missionSuccessPercent','missionSuccessMinXp','missionSuccessMaxXp','missionFailMinXp','missionFailMaxXp'])if(!Number.isSafeInteger(next[key])||next[key]<0||next[key]>1000000)throw Error(`Ungültige Einstellung: ${key}`);
  if(next.dailyMinXp>next.dailyMaxXp||next.missionMinHours<1||next.missionMaxHours>168||next.missionMinHours>next.missionMaxHours||next.missionSuccessPercent>100||next.missionDailyLimit>20||next.missionSuccessMinXp>next.missionSuccessMaxXp||next.missionFailMinXp>next.missionFailMaxXp)throw Error('Ungültiger Belohnungsbereich oder Einsatzgrenze');
  if(typeof next.dailyEnabled!=='boolean'||typeof next.missionEnabled!=='boolean')throw Error('Ungültiger Spielmodus');
  if(!Array.isArray(next.missionDefinitions)||next.missionDefinitions.length>40||!next.missionDefinitions.length)throw Error('Mindestens eine Mission erforderlich');
  const identifiers=new Set();for(const m of next.missionDefinitions){if(!m||typeof m.id!=='string'||!/^[a-z0-9_-]{1,40}$/.test(m.id)||identifiers.has(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.length>80||typeof m.description!=='string'||m.description.length>500||typeof m.enabled!=='boolean')throw Error('Ungültige Mission');identifiers.add(m.id);}
  if(typeof next.announceManualPromotions!=='boolean')throw Error('Ungültige Einstellung für manuelle Beförderungen');validateRanks(next.ranks);for(const field of ['chatXp','memeXp','chatCooldownMs','memeCooldownMs','minChars'])if(!Number.isSafeInteger(next[field])||next[field]<0)throw Error(`Ungültiger Wert: ${field}`);const previous=config;config=next;try{save('config',config);}catch(error){config=previous;throw error;}return config;}
 function restore(newConfig,newState){if(!newConfig||typeof newConfig!=='object'||Array.isArray(newConfig))throw Error('Ungültige XP-Konfiguration');validateRanks(newConfig.ranks);if(!newState||typeof newState!=='object'||Array.isArray(newState)||!newState.users||typeof newState.users!=='object'||Array.isArray(newState.users)||!newState.grants||typeof newState.grants!=='object'||Array.isArray(newState.grants))throw Error('Ungültiger XP-Datensatz');const nextConfig={...defaultConfig(),...structuredClone(newConfig)};nextConfig.channelNames={...DEFAULT_LEVEL_NAMES,...(nextConfig.channelNames||{})};validateChannelNames(nextConfig.channelNames);const nextState={...defaultState(),...structuredClone(newState)};config=nextConfig;state=nextState;}
 // The daily key uses a calendar day in the configured German community timezone.
 const dayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(clock()));
 const randomInt=(min,max)=>{const crypto=require('node:crypto');return crypto.randomInt(min,max+1);};
 function creditBonus(id,delta,source,reference){
  const u=member(id),before=u.xp;
  if(!Number.isSafeInteger(delta)||delta<0||!Number.isSafeInteger(before+delta))throw Error('Ungültige Bonus-XP');
  u.xp=before+delta;state.users[id]=u;
  recordRankChange(id,before,u.xp,source,{reference});
  state.bonusGrants.push({at:clock(),userId:String(id),delta,source,reference});
  if(state.bonusGrants.length>20000)state.bonusGrants.splice(0,state.bonusGrants.length-20000);
  return {before,after:u.xp,awarded:delta,oldRank:rankFor(before,config),newRank:rankFor(u.xp,config)};
 }
 function claimDaily(id){
  if(!config.enabled||!config.dailyEnabled)throw Error('Tägliche Dienstmeldung ist deaktiviert.');
  const key=dayKey(),uid=String(id);
  if(state.dailyClaims[uid]===key)return {ok:false,reason:'already-claimed',day:key};
  const reward=randomInt(config.dailyMinXp,config.dailyMaxXp);
  const result=creditBonus(uid,reward,'daily',key);state.dailyClaims[uid]=key;persist();return {ok:true,day:key,...result};
 }
 function missionStatus(id){
  const uid=String(id),day=dayKey(),current=state.missions[uid]||null;
  const today=(state.missionLog||[]).filter(e=>e.userId===uid&&e.day===day).length+(current?.day===day?1:0);
  return {current,used:today,limit:config.missionDailyLimit,ready:!!current&&clock()>=current.endsAt,day};
 }
 function startMission(id){
  if(!config.enabled||!config.missionEnabled)throw Error('Einsätze sind deaktiviert.');
  const uid=String(id),status=missionStatus(uid);
  if(status.current)return {ok:false,reason:'active',...status};
  if(status.used>=config.missionDailyLimit)return {ok:false,reason:'limit',...status};
  const available=config.missionDefinitions.filter(m=>m.enabled!==false);
  if(!available.length)throw Error('Keine aktiven Missionen konfiguriert.');
  const definition=available[randomInt(0,available.length-1)],now=clock();
  const duration=randomInt(config.missionMinHours*60,config.missionMaxHours*60)*60000;
  const success=randomInt(1,100)<=config.missionSuccessPercent;
  const reward=success?randomInt(config.missionSuccessMinXp,config.missionSuccessMaxXp):randomInt(config.missionFailMinXp,config.missionFailMaxXp);
  const current={id:require('node:crypto').randomUUID(),missionId:definition.id,name:definition.name,description:definition.description||'',day:status.day,startedAt:now,endsAt:now+duration,success,reward};
  state.missions[uid]=current;persist();return {ok:true,current};
 }
 function claimMission(id){
  const uid=String(id),current=state.missions[uid];
  if(!current)return {ok:false,reason:'missing'};
  if(clock()<current.endsAt)return {ok:false,reason:'not-ready',current};
  const credit=creditBonus(uid,current.reward,'mission',current.id);
  const event={...current,userId:uid,claimedAt:clock()};state.missionLog.push(event);
  if(state.missionLog.length>20000)state.missionLog.splice(0,state.missionLog.length-20000);
  delete state.missions[uid];persist();return {ok:true,event,...credit};
 }
 function statistics(days=30){
  const d=Number(days),since=d===0?0:clock()-Math.max(1,Math.min(365,d))*86400000;
  const sums={chat:0,meme:0,deleted:0,manual:0,daily:0,mission:0};
  for(const g of Object.values(state.grants||{})){if(g.at>=since)sums[g.source==='meme'?'meme':'chat']+=g.xp||0;if(g.reversed&&g.reversedAt>=since)sums.deleted-=g.xp||0;}
  for(const e of state.xpAdjustments||[])if(e.at>=since)sums.manual+=e.delta||0;
  for(const e of state.bonusGrants||[])if(e.at>=since)sums[e.source==='daily'?'daily':'mission']+=e.delta||0;
  const ranks=(state.rankEvents||[]).filter(e=>e.at>=since),missions=(state.missionLog||[]).filter(e=>e.claimedAt>=since),daily=(state.bonusGrants||[]).filter(e=>e.source==='daily'&&e.at>=since);
  const distribution={};for(const u of Object.values(state.users)) {const r=rankFor(u.xp,config);const label=r?.[u.branch||'heer']||(config.noRankLabel||'Ohne Rang');distribution[label]=(distribution[label]||0)+1;}
  return {missionOverview:missionOverview(d),days:d,users:Object.keys(state.users).length,totalXp:Object.values(state.users).reduce((n,u)=>n+(u.xp||0),0),bySource:sums,promotions:ranks.filter(e=>e.direction==='promotion').length,demotions:ranks.filter(e=>e.direction==='demotion').length,dailyClaims:daily.length,missions:missions.length,missionSuccesses:missions.filter(e=>e.success).length,distribution,rankEvents:ranks.slice(-15).reverse()};
 }
 function personalMissionStatistics(id){
  const uid=String(id);
  const completed=(state.missionLog||[]).filter(e=>String(e.userId)===uid);
  const successful=completed.reduce((n,e)=>n+(e.success===true?1:0),0);
  return {completed:completed.length,successful,failed:completed.length-successful,successRate:completed.length?Math.round(successful*1000/completed.length)/10:0};
 }
 function missionHistory(id,limit=10){
  const uid=String(id),n=Math.max(1,Math.min(25,Number(limit)||10));
  return (state.missionLog||[]).filter(e=>String(e.userId)===uid).slice(-n).reverse().map(e=>({id:e.id,name:e.name,success:!!e.success,reward:e.reward,startedAt:e.startedAt,endsAt:e.endsAt,claimedAt:e.claimedAt}));
 }
 function missionOverview(days=30){
  const d=Number(days),since=d===0?0:clock()-Math.max(1,Math.min(365,d))*86400000;
  const completed=(state.missionLog||[]).filter(e=>Number(e.claimedAt)>=since);
  const byMission={};const byPlayer=new Map();let success=0,reward=0;
  for(const e of completed){const key=String(e.name||e.missionId||'Mission');const entry=byMission[key]||(byMission[key]={name:key,completed:0,successes:0,xp:0});entry.completed++;entry.successes+=e.success?1:0;entry.xp+=Number(e.reward)||0;success+=e.success?1:0;reward+=Number(e.reward)||0;const uid=String(e.userId);const player=byPlayer.get(uid)||{userId:uid,name:state.users[uid]?.name||uid,completed:0,successes:0,xp:0};player.completed++;player.successes+=e.success?1:0;player.xp+=Number(e.reward)||0;byPlayer.set(uid,player);}
  const active=Object.entries(state.missions||{}).filter(([,m])=>m&&typeof m==='object');
  return {completed:completed.length,successful:success,failed:completed.length-success,successRate:completed.length?Math.round(success*1000/completed.length)/10:0,rewardXp:reward,active:active.length,ready:active.filter(([,m])=>clock()>=m.endsAt).length,byMission:Object.values(byMission).sort((a,b)=>b.completed-a.completed).slice(0,40),topPlayers:[...byPlayer.values()].sort((a,b)=>b.completed-a.completed||b.successes-a.successes).slice(0,10),recent:completed.slice(-10).reverse().map(e=>({name:e.name,success:e.success,reward:e.reward,claimedAt:e.claimedAt}))};
 }
 function xpHistory(id,limit=10){
  const userId=String(id),items=[];
  for(const [messageId,g] of Object.entries(state.grants||{})){
   if(String(g.userId)!==userId)continue;
   items.push({at:Number(g.at)||0,delta:Number(g.xp)||0,source:g.source==='meme'?'meme':'chat',messageId});
   if(g.reversed)items.push({at:Number(g.reversedAt)||Number(g.at)||0,delta:-(Number(g.xp)||0),source:'deleted',messageId});
  }
  for(const e of state.bonusGrants||[]){if(String(e.userId)===userId)items.push({at:Number(e.at)||0,delta:Number(e.delta)||0,source:e.source,reference:e.reference});}
  for(const e of state.xpAdjustments||[]){if(String(e.userId)===userId)items.push({at:Number(e.at)||0,delta:Number(e.delta)||0,source:'manual',mode:e.mode,before:e.before,after:e.after});}
  return items.sort((a,b)=>b.at-a.at||String(b.messageId||'').localeCompare(String(a.messageId||''))).slice(0,Math.max(1,Math.min(10,Number(limit)||10)));
 }
 function leaderboard(){return Object.entries(state.users).map(([id,u])=>({id,xp:u.xp,branch:u.branch})).sort((a,b)=>b.xp-a.xp||a.id.localeCompare(b.id));}
 // A failed persistence must never leave an uncommitted XP mutation in memory.
 // Synchronous engine operations are serialized by the Node.js event loop within one process.
 function rollbackOnSaveFailure(operation){return (...args)=>{const before=structuredClone(state);try{return operation(...args);}catch(error){state=before;throw error;}};}
 // Chat/message deletion hot path: avoid cloning every member and historical grant.
 // Persist remains synchronous, so durability and moderation ordering do not change.
 function rollbackMessageMutation(operation,affected){
  return (...args)=>{
   const keys=affected(...args),uid=keys.userId,mid=keys.messageId,cd=keys.cooldownKey;
   const hadUser=Object.hasOwn(state.users,uid),oldUser=hadUser?structuredClone(state.users[uid]):null;
   const hadGrant=Object.hasOwn(state.grants,mid),oldGrant=hadGrant?structuredClone(state.grants[mid]):null;
   const hadCooldown=cd!=null&&Object.hasOwn(state.cooldowns,cd),oldCooldown=hadCooldown?state.cooldowns[cd]:undefined;
   const oldUpdatedAt=state.updatedAt;
   const oldRankEvents=state.rankEvents,oldRankCount=oldRankEvents?.length||0;
   const oldFirstRank=oldRankCount>=10000?structuredClone(oldRankEvents[0]):null;
   const oldLastRank=oldRankCount>=10000?oldRankEvents[oldRankCount-1]:null;
   try{return operation(...args);}catch(error){
    if(hadUser)state.users[uid]=oldUser;else delete state.users[uid];
    if(hadGrant)state.grants[mid]=oldGrant;else delete state.grants[mid];
    if(cd!=null){if(hadCooldown)state.cooldowns[cd]=oldCooldown;else delete state.cooldowns[cd];}
    if(oldRankEvents!==state.rankEvents)state.rankEvents=oldRankEvents;
    if(Array.isArray(state.rankEvents)){
     if(oldFirstRank&&state.rankEvents.length===oldRankCount&&state.rankEvents[oldRankCount-1]!==oldLastRank){state.rankEvents.pop();state.rankEvents.unshift(oldFirstRank);}
     while(state.rankEvents.length>oldRankCount)state.rankEvents.pop();
     if(state.rankEvents.length<oldRankCount&&oldFirstRank)state.rankEvents.unshift(oldFirstRank);
    }
    state.updatedAt=oldUpdatedAt;
    throw error;
   }
  };
 }
 const awardKeys=m=>({userId:String(m?.author?.id),messageId:String(m?.id),cooldownKey:`${m?.author?.id}:${(m?.attachments||[]).some(a=>String(a.content_type||'').startsWith('image/')||/\.(png|jpe?g|gif|webp)$/i.test(String(a.filename||'')))&&String(m?.channel_id)===String(config.memeChannelId)?'meme':'chat'}`});
 const retractKeys=mid=>{const g=state.grants[String(mid)];return {userId:String(g?.userId),messageId:String(mid),cooldownKey:null};};
 return {claimDaily:rollbackOnSaveFailure(claimDaily),startMission:rollbackOnSaveFailure(startMission),claimMission:rollbackOnSaveFailure(claimMission),missionStatus,missionHistory,personalMissionStatistics,missionOverview,statistics,award:rollbackMessageMutation(award,awardKeys),retract:rollbackMessageMutation(retract,retractKeys),reserve:rollbackOnSaveFailure(reserve),changeBranch:rollbackOnSaveFailure(changeBranch),changeXp:rollbackOnSaveFailure(changeXp),xpHistory,rankHistory,configure,restore,leaderboard,saveState:rollbackOnSaveFailure(persist),profile:id=>rankProfile(member(id).xp,member(id).branch,config),get config(){return config},get state(){return state}};
}
module.exports={DEFAULT_LEVEL_NAMES,validateChannelNames,defaultConfig,defaultState,validateRanks,rankFor,rankProfile,createEngine};
