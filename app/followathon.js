const fs = require('fs');
const crypto = require('crypto');
const { createSseLimiter, rejectTooMany } = require('../shared/sse-limits');

function createFollowathon({file, storage=null, storageKey='followathon', audit=()=>{}, publicBaseUrl='', getTwitchStatus=async()=>({}), retentionDays=90}) {
  const clients = new Set();
  const sseLimiter = createSseLimiter({max:20,perIp:4});
  let tx = Promise.resolve();
  let lastBroadcast = '';

  const nowIso = () => new Date().toISOString();
  const id = (prefix='fa') => `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
  const clampInt = (v,min,max,def=min) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, Math.round(n)));
  };
  const atomicWrite = (p,obj) => {
    const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(obj,null,2));
    fs.renameSync(tmp,p);
  };
  const defaults = () => ({
    schema:1,
    currentEventId:null,
    events:[],
    seenMessageIds:{},
    config:{retentionDays, anomalyThreshold:15, anomalyWindowSeconds:60}
  });
  const attachDbRevision = (s,revision) => {
    if(Number.isFinite(Number(revision))) Object.defineProperty(s,"_dbRevision",{value:Number(revision),writable:true,configurable:true,enumerable:false});
    return s;
  };
  const normalize = (input) => {
    const s={...defaults(),...(input&&typeof input==='object'?input:{})};
    if(!Array.isArray(s.events))s.events=[];
    if(!s.seenMessageIds||typeof s.seenMessageIds!=='object'||Array.isArray(s.seenMessageIds))s.seenMessageIds={};
    s.config={...defaults().config,...(s.config||{})};
    return s;
  };
  const ensureRelational = () => {
    if(!(storage?.enabled&&typeof storage.getFollowathonState==='function')) return;
    const current=storage.getFollowathonState();
    if(current?.found)return;
    let legacy=defaults(),source='fresh';
    try {
      if(typeof storage.hasDocument==='function'&&storage.hasDocument(storageKey)){legacy=normalize(storage.getDocument(storageKey,defaults()));source='postgres-jsonb';}
      else if(fs.existsSync(file)){legacy=normalize(JSON.parse(fs.readFileSync(file,'utf8')));source='legacy-json';}
    } catch {}
    const imported=storage.importFollowathonStateIfEmpty(legacy);
    if(imported?.inserted&&typeof storage.markImport==='function'){
      try{storage.markImport(`relational:${storageKey}`,null,{kind:'relational-followathon',source,events:(legacy.events||[]).length,users:(legacy.events||[]).reduce((n,e)=>n+Object.keys(e.users||{}).length,0),logs:(legacy.events||[]).reduce((n,e)=>n+(e.log||[]).length,0)});}catch{}
    }
  };
  // 9.25.3: Zwischenspeicher für den Zustand. Der Zeitgeber ruft read() jede Sekunde auf; früher wurde dabei jedes
  // Mal der komplette Stand (sieben Abfragen, ca. 150 KB) aus PostgreSQL geladen. Jetzt genügt eine kleine
  // Revisionsabfrage, geladen wird nur bei geänderter Revision. Jeder Aufrufer erhält eine eigene Kopie, weil er
  // den Zustand verändert. Schlägt die Revisionsabfrage fehl, wird wie bisher vollständig geladen.
  let cache = null;
  const cachedRead = () => {
    if(!cache||typeof storage.getFollowathonRevision!=='function')return null;
    try{
      const rv=storage.getFollowathonRevision();
      if(rv?.found&&Number(rv.revision)===cache.revision)return attachDbRevision(structuredClone(cache.state),cache.revision);
    }catch{}
    cache=null;
    return null;
  };
  const read = () => {
    try {
      if(storage?.enabled&&typeof storage.getFollowathonState==='function'){
        const hit=cachedRead();
        if(hit)return hit;
        let r=storage.getFollowathonState();
        if(!r?.found){ensureRelational();r=storage.getFollowathonState();}
        if(r?.found){
          const s=attachDbRevision(normalize(r.state),r.revision);
          if(typeof storage.getFollowathonRevision==='function'&&Number.isFinite(Number(r.revision)))cache={revision:Number(r.revision),state:structuredClone(s)};
          return s;
        }
      }
      if(storage?.enabled)return normalize(storage.getDocument(storageKey,defaults()));
      if(fs.existsSync(file))return normalize(JSON.parse(fs.readFileSync(file,'utf8')));
    } catch (e) {
      if(storage?.enabled) throw e;
    }
    return defaults();
  };
  const clean = (s) => {
    const cutoff=Date.now()-clampInt(s.config.retentionDays,7,365,90)*86400000;
    for(const [k,v] of Object.entries(s.seenMessageIds||{})){
      if(new Date(v).getTime()<cutoff) delete s.seenMessageIds[k];
    }
    for(const e of s.events){
      if(Array.isArray(e.log)) e.log=e.log.filter(x=>new Date(x.at||0).getTime()>=cutoff).slice(-2500);
    }
    s.events=s.events.slice(-50);
    return s;
  };
  const write = (s,{replace=false}={}) => {
    s=clean(s);
    cache=null;
    if(storage?.enabled&&typeof storage.putFollowathonState==='function'){
      const expected=Number.isFinite(Number(s._dbRevision))?Number(s._dbRevision):null;
      const r=storage.putFollowathonState(s,expected,{replace});
      if(Number.isFinite(Number(r?.revision)))Object.defineProperty(s,'_dbRevision',{value:Number(r.revision),writable:true,configurable:true,enumerable:false});
      return s;
    }
    if(storage?.enabled){storage.putDocument(storageKey,s);return s;}
    atomicWrite(file,s);return s;
  };
  const current = (s) => s.events.find(x=>x.id===s.currentEventId)||null;
  const remaining = (e,at=Date.now()) => {
    if(!e) return 0;
    if(e.status==='paused') return Math.max(0,Number(e.pausedRemainingSeconds||0));
    if(e.status==='running') return Math.max(0,Math.ceil((new Date(e.countdownEndAt).getTime()-at)/1000));
    return 0;
  };
  const hardRemaining = (e,at=Date.now()) => e?.hardEndAt ? Math.max(0,Math.floor((new Date(e.hardEndAt).getTime()-at)/1000)) : Infinity;
  const maxAllowedRemaining = (e,at=Date.now()) => Math.max(0,Math.min(
    e?.maxRemainingSeconds==null?Infinity:Number(e.maxRemainingSeconds),
    hardRemaining(e,at)
  ));
  const closeAcceptance = (e,at=nowIso()) => {
    const p=e?.acceptancePeriods?.[e.acceptancePeriods.length-1];
    if(p&&!p.end) p.end=at;
  };
  const openAcceptance = (e,at=nowIso()) => {
    e.acceptancePeriods ||= [];
    const p=e.acceptancePeriods[e.acceptancePeriods.length-1];
    if(!p||p.end) e.acceptancePeriods.push({start:at,end:null});
  };
  const acceptedAt = (e,followedAt) => {
    const t=new Date(followedAt).getTime();
    if(!Number.isFinite(t)) return false;
    return (e.acceptancePeriods||[]).some(p=>{
      const a=new Date(p.start).getTime(),b=p.end?new Date(p.end).getTime():Infinity;
      return t>=a&&t<=b;
    });
  };
  const eventLog = (e,entry) => {
    e.log ||= [];
    const row={id:id('log'),at:nowIso(),...entry};
    e.log.push(row);
    if(e.log.length>2500)e.log=e.log.slice(-2500);
    return row;
  };
  const endEvent = (e,reason='countdown-zero',at=nowIso()) => {
    if(!e||e.status==='ended')return false;
    e.status='ended';e.endedAt=at;e.endReason=reason;e.countdownEndAt=null;e.pausedRemainingSeconds=0;
    e.creditAcceptance=false;closeAcceptance(e,at);
    eventLog(e,{source:'system',decision:'ended',creditedSeconds:0,reason});
    return true;
  };
  const reconcile = (s,at=Date.now()) => {
    const e=current(s); if(!e)return false;
    let changed=false;
    if(e.status==='running' && remaining(e,at)<=0){ changed=endEvent(e,e.hardEndAt&&new Date(e.hardEndAt).getTime()<=at?'hard-end-reached':'countdown-zero',new Date(at).toISOString())||changed; }
    else if(e.status==='paused' && e.hardEndAt && new Date(e.hardEndAt).getTime()<=at){ changed=endEvent(e,'hard-end-reached',new Date(at).toISOString())||changed; }
    return changed;
  };
  const expectedEnd = (e,at=Date.now()) => {
    if(!e||e.status==='ended')return e?.endedAt||null;
    if(e.status==='running')return e.countdownEndAt||null;
    if(e.status==='paused')return null;
    return null;
  };
  const publicStateFrom = (s) => {
    const e=current(s),at=Date.now();
    if(!e)return {exists:false,serverNow:new Date(at).toISOString()};
    return {
      exists:true,id:e.id,name:e.name,status:e.status,serverNow:new Date(at).toISOString(),
      remainingSeconds:remaining(e,at),expectedEndAt:expectedEnd(e,at),hardEndAt:e.hardEndAt||null,
      followCount:Number(e.followCount||0),creditedSeconds:Math.max(0,Number(e.creditedSeconds||0)-Number(e.reversedSeconds||0)),
      label:e.overlay?.label||'FOLLOWATHON',fontSize:clampInt(e.overlay?.fontSize,24,180,72),
      textColor:(!e.overlay?.textColor||String(e.overlay.textColor).toLowerCase()==='#ffffff')?'#fab70a':e.overlay.textColor,accentColor:e.overlay?.accentColor||'#fab70a',
      showFollowerNames:e.overlay?.showFollowerNames===true,
      lastCredit:e.lastPublicCredit?{...e.lastPublicCredit,userName:e.overlay?.showFollowerNames===true?e.lastPublicCredit.userName:null}:null
    };
  };
  const adminStateFrom = async (s) => {
    const e=current(s),at=Date.now();
    const twitch=await getTwitchStatus().catch(err=>({error:err.message}));
    return {
      event:e?{
        ...e,remainingSeconds:remaining(e,at),expectedEndAt:expectedEnd(e,at),
        creditedNetSeconds:Math.max(0,Number(e.creditedSeconds||0)-Number(e.reversedSeconds||0)),
        users:undefined,
        log:(e.log||[]).slice(-300).reverse(),
        held:(e.held||[]).filter(x=>x.status==='pending').slice(-200).reverse()
      }:null,
      config:s.config,
      twitch,
      // 9.11.0: Adresse kann eine Funktion sein (Installationsprofil ändert sich zur Laufzeit).
      overlayUrl: (b => b ? `${b}/followathon/overlay` : '/followathon/overlay')(typeof publicBaseUrl === 'function' ? publicBaseUrl() : publicBaseUrl),
      serverNow:new Date(at).toISOString()
    };
  };
  // 9.25.3: ohne verbundene Overlay-Clients wird nichts berechnet; der Zustand kann vom Aufrufer mitgegeben
  // werden, damit der Zeitgeber ihn nicht ein zweites Mal lesen muss.
  const broadcast = (force=false,state=null) => {
    if(!clients.size){lastBroadcast='';return;}
    const payload=JSON.stringify(publicStateFrom(state||read()));
    if(!force&&payload===lastBroadcast)return;
    lastBroadcast=payload;
    for(const res of [...clients]){try{res.write(`event: state\ndata: ${payload}\n\n`);}catch{clients.delete(res);}}
  };
  const transact = (fn,{broadcastAfter=true}={}) => {
    const job=tx.then(async()=>{
      const s=read();reconcile(s);
      const out=await fn(s);
      write(s);
      if(broadcastAfter)setImmediate(()=>broadcast(true));
      return out;
    });
    tx=job.catch(()=>{});
    return job;
  };

  ensureRelational();

  function berlinLocalToUtc(local){
    const m=String(local||'').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if(!m)return null;
    const parts=m.slice(1).map(Number), naive=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]||0);
    const offsetAt=(ms)=>{
      const p=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',timeZoneName:'shortOffset',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
      const z=p.find(x=>x.type==='timeZoneName')?.value||'GMT';
      const zM=z.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);if(!zM)return 0;
      const mins=Number(zM[2])*60+Number(zM[3]||0);return (zM[1]==='-'?-1:1)*mins*60000;
    };
    let utc=naive-offsetAt(naive);utc=naive-offsetAt(utc);
    return new Date(utc).toISOString();
  }

  async function createEvent(input,actor){
    return transact(async s=>{
      const old=current(s);if(old&&['running','paused'].includes(old.status)) throw new Error('Das aktuelle Followathon-Event muss zuerst beendet werden.');
      const start=clampInt(input.startDurationSeconds,1,31_536_000,3600);
      const per=clampInt(input.secondsPerFollow,1,86_400,60);
      const max=input.maxRemainingSeconds==null||input.maxRemainingSeconds===''?null:clampInt(input.maxRemainingSeconds,1,31_536_000,start);
      const hard=input.hardEndLocal?berlinLocalToUtc(input.hardEndLocal):null;
      if(hard&&new Date(hard).getTime()<=Date.now())throw new Error('Die feste späteste Endzeit muss in der Zukunft liegen.');
      const e={id:id(),name:String(input.name||'Followathon').trim().slice(0,120)||'Followathon',createdAt:nowIso(),createdBy:actor,
        status:'draft',startDurationSeconds:start,secondsPerFollow:per,maxRemainingSeconds:max,hardEndAt:hard,
        creditAcceptance:input.creditAcceptance!==false,acceptancePeriods:[],followCount:0,creditedSeconds:0,reversedSeconds:0,users:{},held:[],log:[],
        anomaly:{threshold:clampInt(input.anomalyThreshold,2,500,s.config.anomalyThreshold),windowSeconds:clampInt(input.anomalyWindowSeconds,10,3600,s.config.anomalyWindowSeconds)},
        overlay:{label:String(input.overlay?.label||'FOLLOWATHON').slice(0,40),fontSize:clampInt(input.overlay?.fontSize,24,180,72),textColor:String(input.overlay?.textColor||'#fab70a').slice(0,20),accentColor:String(input.overlay?.accentColor||'#fab70a').slice(0,20),showFollowerNames:input.overlay?.showFollowerNames===true}
      };
      eventLog(e,{source:'admin',decision:'created',creditedSeconds:0,reason:`Event angelegt von ${actor}`});
      s.events.push(e);s.currentEventId=e.id;
      audit(actor,'followathon.created',{eventId:e.id,name:e.name});return e;
    });
  }

  async function action(kind,body,actor){
    return transact(async s=>{
      const e=current(s);if(!e)throw new Error('Kein Followathon-Event vorhanden.');
      const now=Date.now(),at=new Date(now).toISOString();
      if(kind==='start'){
        if(e.status!=='draft')throw new Error('Nur ein neues Event kann gestartet werden.');
        e.startedAt=at;e.status='running';
        const rem=Math.min(e.startDurationSeconds,maxAllowedRemaining(e,now));
        if(rem<=0){endEvent(e,'limit-at-start',at);}else{e.countdownEndAt=new Date(now+rem*1000).toISOString();if(e.creditAcceptance)openAcceptance(e,at);eventLog(e,{source:'admin',decision:'started',creditedSeconds:0,reason:`Gestartet von ${actor}`});}
      } else if(kind==='pause'){
        if(e.status!=='running')throw new Error('Der Countdown läuft nicht.');
        e.pausedRemainingSeconds=Math.min(remaining(e,now),maxAllowedRemaining(e,now));e.countdownEndAt=null;e.status='paused';eventLog(e,{source:'admin',decision:'paused',creditedSeconds:0,reason:`Pausiert von ${actor}`});
      } else if(kind==='resume'){
        if(e.status!=='paused')throw new Error('Der Countdown ist nicht pausiert.');
        const rem=Math.min(Number(e.pausedRemainingSeconds||0),maxAllowedRemaining(e,now));e.pausedRemainingSeconds=0;
        if(rem<=0)endEvent(e,'limit-on-resume',at);else{e.status='running';e.countdownEndAt=new Date(now+rem*1000).toISOString();eventLog(e,{source:'admin',decision:'resumed',creditedSeconds:0,reason:`Fortgesetzt von ${actor}`});}
      } else if(kind==='end'){
        endEvent(e,'manual-end',at);eventLog(e,{source:'admin',decision:'manual-end',creditedSeconds:0,reason:`Beendet von ${actor}`});
      } else if(kind==='acceptance'){
        if(e.status==='ended')throw new Error('Ein beendetes Event nimmt keine Follow-Gutschriften mehr an.');
        const enabled=body.enabled===true;e.creditAcceptance=enabled;if(enabled)openAcceptance(e,at);else closeAcceptance(e,at);
        eventLog(e,{source:'admin',decision:enabled?'acceptance-on':'acceptance-off',creditedSeconds:0,reason:`Follow-Gutschriften ${enabled?'aktiviert':'gestoppt'} von ${actor}`});
      } else if(kind==='adjust'){
        if(e.status==='draft')throw new Error('Das Event wurde noch nicht gestartet.');
        const requested=clampInt(Math.abs(body.seconds),1,604800,60)*(body.direction==='subtract'?-1:1);
        let actual=0;
        if(e.status==='ended'){
          if(requested<0){actual=-Math.min(Math.abs(requested),Math.max(0,Number(e.creditedSeconds||0)-Number(e.reversedSeconds||0)));e.reversedSeconds=Number(e.reversedSeconds||0)+Math.abs(actual);}
        } else {
          const before=remaining(e,now),cap=maxAllowedRemaining(e,now),after=Math.max(0,Math.min(cap,before+requested));actual=after-before;
          if(e.status==='running')e.countdownEndAt=after>0?new Date(now+after*1000).toISOString():null;else e.pausedRemainingSeconds=after;
          if(actual>0)e.creditedSeconds=Number(e.creditedSeconds||0)+actual;else e.reversedSeconds=Number(e.reversedSeconds||0)+Math.abs(actual);
          if(after<=0)endEvent(e,'manual-adjustment-zero',at);
        }
        eventLog(e,{source:'manual',decision:'adjusted',requestedSeconds:requested,creditedSeconds:actual,reason:String(body.reason||'Manuelle Zeitkorrektur').slice(0,240),actor});
      } else throw new Error('Unbekannte Aktion.');
      audit(actor,`followathon.${kind}`,{eventId:e.id});return e;
    });
  }

  function applyCredit(e,{requested,userId,userName,messageId,source='follow',followedAt,reasonPrefix=''}){
    const now=Date.now(),before=remaining(e,now),cap=maxAllowedRemaining(e,now),after=Math.max(0,Math.min(cap,before+requested)),actual=after-before;
    if(e.status==='running')e.countdownEndAt=after>0?new Date(now+after*1000).toISOString():null;else if(e.status==='paused')e.pausedRemainingSeconds=after;
    e.followCount=Number(e.followCount||0)+1;e.creditedSeconds=Number(e.creditedSeconds||0)+Math.max(0,actual);
    e.users[userId]={userId,userName,followedAt,messageId,decision:'credited',creditedSeconds:actual};
    const partial=actual<requested;
    const reason=actual<=0?'Grenze erreicht – keine Zeit gutgeschrieben.':partial?'Gutschrift an der konfigurierten Grenze gekürzt.':`${requested} Sekunden gutgeschrieben.`;
    const row=eventLog(e,{source,decision:actual>0?(partial?'partial-credit':'credited'):'limit-no-credit',userId,userName,messageId,followedAt,requestedSeconds:requested,creditedSeconds:actual,reason:`${reasonPrefix}${reason}`});
    e.lastPublicCredit={id:row.id,at:row.at,userName,seconds:actual};
    if(after<=0&&e.status!=='ended')endEvent(e,'countdown-zero');
    return {actual,row};
  }

  async function handleFollow(ev,metadata={}){
    const messageId=String(metadata.message_id||'').trim();
    return transact(async s=>{
      const e=current(s),followedAt=String(ev?.followed_at||''),userId=String(ev?.user_id||''),userName=String(ev?.user_name||ev?.user_login||'').slice(0,80);
      if(messageId&&s.seenMessageIds[messageId])return {decision:'duplicate-message'};
      if(messageId)s.seenMessageIds[messageId]=nowIso();
      if(!e||!['running','paused'].includes(e.status))return {decision:'no-active-event'};
      if(!e.creditAcceptance||!acceptedAt(e,followedAt)){eventLog(e,{source:'follow',decision:'not-in-acceptance-window',userId,userName,messageId,followedAt,creditedSeconds:0,reason:'Followzeitpunkt liegt außerhalb eines aktiven Annahmezeitraums.'});return {decision:'not-in-acceptance-window'};}
      if(e.users?.[userId]){eventLog(e,{source:'follow',decision:'duplicate-user',userId,userName,messageId,followedAt,creditedSeconds:0,reason:'Dieser Twitch-Account wurde für dieses Event bereits berücksichtigt.'});return {decision:'duplicate-user'};}
      e.users ||= {};e.held ||= [];
      const win=clampInt(e.anomaly?.windowSeconds,10,3600,60),threshold=clampInt(e.anomaly?.threshold,2,500,15),t=new Date(followedAt).getTime();
      const recent=(e.log||[]).filter(x=>x.source==='follow'&&x.followedAt&&Math.abs(t-new Date(x.followedAt).getTime())<=win*1000&&['credited','partial-credit','limit-no-credit'].includes(x.decision)).length;
      if(recent>=threshold){
        const held={id:id('held'),status:'pending',createdAt:nowIso(),userId,userName,messageId,followedAt,requestedSeconds:e.secondsPerFollow,reason:`Auffälligkeit: mehr als ${threshold} Follows innerhalb von ${win} Sekunden.`};
        e.held.push(held);e.users[userId]={userId,userName,followedAt,messageId,decision:'held',heldId:held.id,creditedSeconds:0};
        eventLog(e,{source:'follow',decision:'held-anomaly',userId,userName,messageId,followedAt,creditedSeconds:0,reason:held.reason});
        audit('eventsub-system','followathon.follow.held',{eventId:e.id,userId});return {decision:'held'};
      }
      const out=applyCredit(e,{requested:e.secondsPerFollow,userId,userName,messageId,followedAt});
      audit('eventsub-system','followathon.follow.processed',{eventId:e.id,userId,creditedSeconds:out.actual});return {decision:'credited',creditedSeconds:out.actual};
    });
  }

  async function reviewHeld(heldId,approve,actor){
    return transact(async s=>{
      const e=current(s);if(!e)throw new Error('Kein Event vorhanden.');
      const h=(e.held||[]).find(x=>x.id===heldId);if(!h||h.status!=='pending')throw new Error('Zurückgehaltener Follow nicht gefunden oder bereits geprüft.');
      h.reviewedAt=nowIso();h.reviewedBy=actor;h.status=approve?'approved':'rejected';
      if(!approve){eventLog(e,{source:'review',decision:'held-rejected',userId:h.userId,userName:h.userName,messageId:h.messageId,followedAt:h.followedAt,creditedSeconds:0,reason:`Von ${actor} abgelehnt.`});return h;}
      if(e.status==='ended'){eventLog(e,{source:'review',decision:'approved-no-credit-ended',userId:h.userId,userName:h.userName,messageId:h.messageId,followedAt:h.followedAt,creditedSeconds:0,reason:'Freigegeben, aber Event bereits beendet; keine Reaktivierung.'});return h;}
      const out=applyCredit(e,{requested:h.requestedSeconds,userId:h.userId,userName:h.userName,messageId:h.messageId,followedAt:h.followedAt,source:'review',reasonPrefix:'Manuell geprüft. '});h.creditedSeconds=out.actual;return h;
    });
  }

  async function retract(body,actor){
    return transact(async s=>{
      const e=current(s);if(!e)throw new Error('Kein Event vorhanden.');
      const targets=[];
      if(body.logId){const row=(e.log||[]).find(x=>x.id===body.logId);if(row)targets.push(row);}
      else if((body.from||body.fromLocal)&&(body.to||body.toLocal)){const a=new Date(body.from||berlinLocalToUtc(body.fromLocal)).getTime(),b=new Date(body.to||berlinLocalToUtc(body.toLocal)).getTime();for(const row of e.log||[]){const t=new Date(row.followedAt||row.at).getTime();if(t>=a&&t<=b&&Number(row.creditedSeconds)>0)targets.push(row);}}
      const unique=targets.filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i&&!x.retractedAt);
      const wanted=unique.reduce((n,x)=>n+Math.max(0,Number(x.creditedSeconds||0)),0);
      let actual=0;const now=Date.now();
      if(e.status!=='ended'){
        const before=remaining(e,now),after=Math.max(0,before-wanted);actual=before-after;
        if(e.status==='running')e.countdownEndAt=after>0?new Date(now+after*1000).toISOString():null;else if(e.status==='paused')e.pausedRemainingSeconds=after;
        if(after<=0)endEvent(e,'retraction-zero');
      }
      e.reversedSeconds=Number(e.reversedSeconds||0)+wanted;
      for(const row of unique){row.retractedAt=nowIso();row.retractedBy=actor;row.retractionAppliedSeconds=Number(row.creditedSeconds||0);}
      eventLog(e,{source:'manual',decision:'retracted',creditedSeconds:-wanted,timerAdjustedSeconds:-actual,requestedSeconds:-wanted,reason:e.status==='ended'?'Gutschrift protokollarisch vollständig zurückgenommen; ein beendeter Timer wurde nicht reaktiviert.':`${unique.length} Gutschrift(en) zurückgenommen; laufender Timer um ${actual} Sekunden korrigiert.`,actor});
      audit(actor,'followathon.retracted',{eventId:e.id,count:unique.length,reversedSeconds:wanted,timerAdjustedSeconds:actual});return {count:unique.length,seconds:wanted,timerSeconds:actual};
    });
  }

  async function reset(actor){
    return transact(async s=>{
      const e=current(s);
      if(e&&e.status!=="ended")endEvent(e,"owner-reset");
      s.currentEventId=null;
      audit(actor,"followathon.reset",{previousEventId:e?.id||null});
      return {ok:true};
    });
  }

  async function testFollow(input,actor){
    const s=read();reconcile(s);const e=current(s);if(!e)return {ok:true,decision:'no-event',note:'Kein produktiver Zustand wurde verändert.'};
    const clone=JSON.parse(JSON.stringify(e)),fakeId=`test_${crypto.randomBytes(5).toString('hex')}`,followedAt=input.followedAt||nowIso();
    if(!['running','paused'].includes(clone.status))return {ok:true,decision:'no-active-event',note:'Testmodus: keine produktive Änderung.'};
    if(!clone.creditAcceptance||!acceptedAt(clone,followedAt))return {ok:true,decision:'not-in-acceptance-window',note:'Testmodus: keine produktive Änderung.'};
    const out=applyCredit(clone,{requested:clone.secondsPerFollow,userId:fakeId,userName:String(input.userName||'TestFollower'),messageId:id('testmsg'),followedAt,source:'test'});
    audit(actor,'followathon.test.simulated',{eventId:e.id,creditedSeconds:out.actual});return {ok:true,decision:out.actual<clone.secondsPerFollow?'partial-credit':'credited',creditedSeconds:out.actual,note:'Simulation בלבד – keine produktive Gutschrift oder Followerstatistik wurde verändert.'};
  }

  function addSseClient(res,ip){
    const release=sseLimiter.tryAcquire(ip);
    if(!release)return rejectTooMany(res);
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write(`event: state\ndata: ${JSON.stringify(publicStateFrom(read()))}\n\n`);clients.add(res);
    const ping=setInterval(()=>{try{res.write(': keepalive\n\n');}catch{}},15000);
    ping.unref?.();
    res.on('close',()=>{clearInterval(ping);clients.delete(res);release();});
  }

  async function getAdminState(){const s=read();if(reconcile(s))write(s);return adminStateFrom(s);}
  function getPublicState(){const s=read();if(reconcile(s))write(s);return publicStateFrom(s);}
  function tick(){const s=read();if(reconcile(s)){write(s);broadcast(true,s);}else broadcast(false,s);}

  return {createEvent,action,handleFollow,reviewHeld,retract,reset,testFollow,getAdminState,getPublicState,addSseClient,tick,broadcast,berlinLocalToUtc};
}
module.exports={createFollowathon};
