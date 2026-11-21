"use strict";
// Ausgangs-Warteschlange für Twitch-Chatnachrichten, getrennt pro Bot-Account.
//
// Twitch begrenzt das Senden pro Account (20 Nachrichten / 30 s, mit Moderator-,
// VIP- oder Broadcaster-Status 100 / 30 s). Ohne Warteschlange verwirft Twitch
// Nachrichten, sobald das Limit erreicht ist. Diese Schlange sendet in einem
// festen Takt, hält das Fenster-Limit ein, wiederholt bei Rate-Limit und gibt
// jedem Aufrufer ein Ergebnis zurück, damit er weiß, ob seine Antwort rausging.
//
// Vorrang (enqueue(bot,text,{priority})): "high" geht allen anderen voraus, wird nie
// wegen Alter und als Letztes bei voller Schlange verworfen (Ergebnis, Kontrolle).
// "normal" ist der Standard. "low" (zum Beispiel Beitritts-Begrüßungen) kommt nach
// allen anderen, verfällt früher und wird bei Stau zuerst geopfert.
//
// Ergebnis-Objekt von enqueue(): { ok, dropped, reason }
//   ok       – Nachricht wurde von Twitch angenommen
//   dropped  – Nachricht wurde durch die Schlange verworfen (voll, zu alt,
//              Rate-Limit nach allen Wiederholungen). Der Aufrufer darf dann
//              zum Beispiel einen Cooldown wieder freigeben.
//   reason   – "sent" | "failed" | "queue-full" | "stale" | "rate-limit" | "no-sender"

function createChatSendQueue({
  send,
  limitsFor,
  now=()=>Date.now(),
  setTimer=(fn,ms)=>setTimeout(fn,ms),
  clearTimer=h=>clearTimeout(h),
  logger=()=>{},
  maxQueue=200,
  maxAgeMs=45000,
  lowMaxAgeMs=15000,
  maxRetries=3,
  retryDelayMs=2000
}={}){
  if(typeof send!=="function"||typeof limitsFor!=="function")throw new Error("Sende-Warteschlange: send und limitsFor sind Pflicht");
  const bots=new Map();
  const totals={sent:0,failed:0,retried:0,rateLimited:0,droppedFull:0,droppedStale:0,droppedRateLimit:0};
  const RANK={high:0,normal:1,low:2};
  const rankOf=item=>RANK[item.priority]??1;
  function maxAgeFor(item){return item.priority==="high"?Infinity:item.priority==="low"?lowMaxAgeMs:maxAgeMs;}

  function stateOf(bot){
    let s=bots.get(bot);
    if(!s){s={bot,items:[],sentAt:[],lastSentAt:0,pausedUntil:0,timer:null,busy:false,sent:0,dropped:0};bots.set(bot,s);}
    return s;
  }
  function finish(item,result){try{item.resolve(result);}catch{}}
  function dropItem(s,item,reason){
    s.dropped++;
    if(reason==="queue-full")totals.droppedFull++;
    else if(reason==="stale")totals.droppedStale++;
    else totals.droppedRateLimit++;
    logger(`Chat-Antwort verworfen (${reason}) für ${s.bot}`);
    finish(item,{ok:false,dropped:true,reason});
  }
  function schedule(s,ms){
    if(s.timer)clearTimer(s.timer);
    const h=setTimer(()=>{s.timer=null;pump(s);},Math.max(1,Math.ceil(ms)));
    if(h&&typeof h.unref==="function")h.unref();
    s.timer=h;
  }

  async function pump(s){
    if(s.busy)return;
    s.busy=true;
    try{
      while(s.items.length){
        const t=now();
        const limits=limitsFor(s.bot)||{};
        const windowMs=limits.windowMs||30000;
        const windowMax=Math.max(1,limits.windowMax||17);
        const minInterval=Math.max(0,limits.minIntervalMs||0);
        while(s.sentAt.length&&t-s.sentAt[0]>=windowMs)s.sentAt.shift();

        // Zu alte Antworten lohnen sich nicht mehr (je nach Vorrang).
        if(s.items.some(it=>t-it.queuedAt>maxAgeFor(it))){
          const keep=[];
          for(const it of s.items){if(t-it.queuedAt>maxAgeFor(it))dropItem(s,it,"stale");else keep.push(it);}
          s.items=keep;
        }
        if(!s.items.length)break;

        let wait=0;
        if(s.pausedUntil>t)wait=Math.max(wait,s.pausedUntil-t);
        if(s.sentAt.length>=windowMax)wait=Math.max(wait,s.sentAt[0]+windowMs-t);
        if(s.lastSentAt&&minInterval)wait=Math.max(wait,s.lastSentAt+minInterval-t);
        if(wait>0){schedule(s,wait);return;}

        const item=s.items.shift();
        s.lastSentAt=now();
        s.sentAt.push(s.lastSentAt);
        let r;
        try{r=await send(item.bot,item.message);}
        catch(e){r={ok:false,reason:"failed",error:e&&e.message};}
        r=r||{ok:false,reason:"failed"};

        if(r.ok){s.sent++;totals.sent++;finish(item,{ok:true,dropped:false,reason:"sent"});continue;}
        if(r.rateLimited){
          totals.rateLimited++;
          if(item.attempts<maxRetries){
            item.attempts++;totals.retried++;
            s.items.unshift(item);
            // Twitch hat das Limit gemeldet: Bot kurz ruhen lassen, dann erneut.
            s.pausedUntil=now()+retryDelayMs*item.attempts;
            continue;
          }
          dropItem(s,item,"rate-limit");
          continue;
        }
        totals.failed++;
        finish(item,{ok:false,dropped:false,reason:r.reason||"failed"});
      }
    }finally{
      s.busy=false;
      // Falls beim Warten neue Einträge kamen und kein Timer läuft.
      if(s.items.length&&!s.timer&&!s.busy)schedule(s,1);
    }
  }

  function enqueue(bot,message,opts){
    const name=String(bot||"").toLowerCase();
    if(!name||!message)return Promise.resolve({ok:false,dropped:false,reason:"no-sender"});
    const s=stateOf(name);
    const priority=opts&&RANK[opts.priority]!==undefined?opts.priority:"normal";
    return new Promise(resolve=>{
      const item={bot:name,message:String(message),priority,queuedAt:now(),attempts:0,resolve};
      if(s.items.length>=maxQueue){
        // Voll: die älteste Nachricht mit dem niedrigsten Vorrang opfern. Ist die neue
        // niedriger als alles in der Schlange, wird sie selbst verworfen.
        const worst=Math.max(...s.items.map(rankOf));
        if(rankOf(item)>worst){dropItem(s,item,"queue-full");return;}
        const idx=s.items.findIndex(it=>rankOf(it)===worst);
        dropItem(s,s.items.splice(idx,1)[0],"queue-full");
      }
      // Einsortieren hinter allen Einträgen mit gleichem oder höherem Vorrang.
      let at=s.items.length;
      while(at>0&&rankOf(s.items[at-1])>rankOf(item))at--;
      s.items.splice(at,0,item);
      if(!s.busy&&!s.timer)pump(s);
    });
  }

  function stats(){
    const t=now();
    const perBot={};
    let queued=0,oldest=0;
    for(const [name,s] of bots){
      const age=s.items.length?t-s.items[0].queuedAt:0;
      queued+=s.items.length;oldest=Math.max(oldest,age);
      perBot[name]={queued:s.items.length,sent:s.sent,dropped:s.dropped,oldestWaitMs:age};
    }
    return {queued,oldestWaitMs:oldest,...totals,droppedTotal:totals.droppedFull+totals.droppedStale+totals.droppedRateLimit,bots:perBot};
  }

  return {enqueue,stats};
}

module.exports={createChatSendQueue};
