"use strict";
// Event-Profile ab 8.9.8: vollständiger Schnappschuss aller schaltbaren Funktionen.
//
// Ein Profil legt für JEDE Funktion einen festen Zustand fest (an/aus, bei Bedarf Bot).
// Damit kann ein Profilwechsel nichts mehr "vom vorherigen Profil übrig lassen".
//
// live = { settings, extras:{ stubenkontrolle:{enabled}, followerAlert:{enabled} } }
//
// Schnappschuss (Version 2):
// { version:2,
//   lists:{ commands:{id:{enabled,bot}}, timers:{…}, autoReplies:{…}, greetings:{…}, teamMembers:{id:{enabled}} },
//   switches:{ followEvent:{enabled,bot}, raidEvent:{…}, followage:{…}, watchtime:{…}, teamTimer:{enabled}, … } }

// Team-Commands (!team, !mario …) und der Team-Timer werden aus den Team-Einstellungen erzeugt
// (managedBy:"team"). Sie werden nur über "Team-Timer" und "Team-Mitglieder" geschaltet.
const own=list=>(Array.isArray(list)?list:[]).filter(x=>x?.managedBy!=="team");
const LISTS=[
  {key:"commands",group:"Commands",hasBot:true,get:s=>own(s.commands),label:x=>x.command||x.description||"Command"},
  {key:"timers",group:"Timer",hasBot:true,get:s=>own(s.timers),label:x=>x.description||x.name||String(x.text||x.message||"").slice(0,60)||"Timer"},
  {key:"autoReplies",group:"Auto-Replies",hasBot:true,get:s=>s.autoReplies,label:x=>x.name||x.trigger||(Array.isArray(x.triggers)?x.triggers.join(", "):"")||"Auto-Reply"},
  {key:"greetings",group:"Begrüßungen",hasBot:true,get:s=>s.greetings,label:x=>x.login?`@${x.login}`:"Begrüßung"},
  {key:"teamMembers",group:"Team",hasBot:false,get:s=>s.team?.members,label:x=>`${x.name||x.id}${x.command?` (${x.command})`:""}`}
];

const obj=(root,path)=>{let o=root;for(const p of path){o[p]||={};o=o[p];}return o;};
const SWITCHES=[
  {key:"followEvent",group:"Ereignisse & Community",label:"Follow-Meldung",hasBot:true,get:l=>l.settings.events?.follow,target:l=>obj(l.settings,["events","follow"])},
  {key:"raidEvent",group:"Ereignisse & Community",label:"Raid-Meldung",hasBot:true,get:l=>l.settings.events?.raid,target:l=>obj(l.settings,["events","raid"])},
  {key:"followage",group:"Ereignisse & Community",label:"!followage",hasBot:true,get:l=>l.settings.communityCommands?.followage,target:l=>obj(l.settings,["communityCommands","followage"])},
  {key:"watchtime",group:"Ereignisse & Community",label:"!watchtime",hasBot:true,get:l=>l.settings.communityCommands?.watchtime,target:l=>obj(l.settings,["communityCommands","watchtime"])},
  {key:"teamTimer",group:"Team",label:"Team-Timer",hasBot:false,get:l=>l.settings.team?.timer,target:l=>obj(l.settings,["team","timer"])},
  {key:"clipSharing",module:"clips",group:"Spiele & Overlays",label:"Clip-Sharing",hasBot:false,get:l=>l.settings.clipSharing,target:l=>obj(l.settings,["clipSharing"])},
  {key:"stubenkontrolle",module:"stubenkontrolle",group:"Spiele & Overlays",label:"Stubenkontrolle",hasBot:false,get:l=>l.extras?.stubenkontrolle,target:l=>obj(l,["extras","stubenkontrolle"])},
  {key:"followerAlert",module:"followerAlert",group:"Spiele & Overlays",label:"Follower-Alert",hasBot:false,get:l=>l.extras?.followerAlert,target:l=>obj(l,["extras","followerAlert"])},
  {key:"modLinks",module:"twitchChatFilter",group:"Moderation",label:"Link-Filter",hasBot:false,get:l=>l.settings.moderation?.links,target:l=>obj(l.settings,["moderation","links"])},
  {key:"modEmotes",module:"twitchChatFilter",group:"Moderation",label:"Emote-Filter",hasBot:false,get:l=>l.settings.moderation?.emotes,target:l=>obj(l.settings,["moderation","emotes"])},
  {key:"modSymbols",module:"twitchChatFilter",group:"Moderation",label:"Satzzeichen-Filter",hasBot:false,get:l=>l.settings.moderation?.symbols,target:l=>obj(l.settings,["moderation","symbols"])},
  {key:"modCaps",module:"twitchChatFilter",group:"Moderation",label:"Großbuchstaben-Filter",hasBot:false,get:l=>l.settings.moderation?.caps,target:l=>obj(l.settings,["moderation","caps"])},
  // 9.6.0: Wortfilter je Plattform. Ältere Profile ohne diese Schalter übernehmen beim Normalisieren den aktuellen Stand.
  {key:"wordFilterTwitch",module:"wordFilter",group:"Moderation",label:"Wortfilter (Twitch)",hasBot:false,get:l=>l.settings.wordFilterActive?.twitch||{enabled:true},target:l=>obj(l.settings,["wordFilterActive","twitch"])},
  {key:"wordFilterDiscord",module:"wordFilter",group:"Moderation",label:"Wortfilter (Discord)",hasBot:false,get:l=>l.settings.wordFilterActive?.discord||{enabled:true},target:l=>obj(l.settings,["wordFilterActive","discord"])}
];

const arr=v=>Array.isArray(v)?v:[];
// 9.2.0: Schalter, die zu einem ausgeschalteten Modul gehören, werden nicht angewendet, nicht geprüft und nicht angezeigt.
// opts.moduleOff(id) liefert true für ausgeschaltete Module. Gespeicherte Werte im Profil bleiben erhalten.
const skipSwitch=(S,opts)=>!!(S.module&&typeof opts?.moduleOff==="function"&&opts.moduleOff(S.module));
function stateOf(item,hasBot){
  const st={enabled:!!item?.enabled};
  if(hasBot)st.bot=item?.bot||null;
  return st;
}

function capture(live){
  const snap={version:2,lists:{},switches:{}};
  for(const L of LISTS){
    snap.lists[L.key]={};
    for(const x of arr(L.get(live.settings||{})))if(x?.id)snap.lists[L.key][String(x.id)]=stateOf(x,L.hasBot);
  }
  for(const S of SWITCHES)snap.switches[S.key]=stateOf(S.get(live)||{},S.hasBot);
  return snap;
}

// Ältere Profile (vor 8.9.8) hatten nur commands/timers/autoReplies/greetings/events/communityCommands.
function fromLegacy(old){
  const s={version:2,lists:{},switches:{}};
  for(const k of ["commands","timers","autoReplies","greetings"])if(old?.[k]&&typeof old[k]==="object")s.lists[k]={...old[k]};
  if(old?.events?.follow)s.switches.followEvent=old.events.follow;
  if(old?.events?.raid)s.switches.raidEvent=old.events.raid;
  if(old?.communityCommands?.followage)s.switches.followage=old.communityCommands.followage;
  if(old?.communityCommands?.watchtime)s.switches.watchtime=old.communityCommands.watchtime;
  return s;
}

// Bringt einen Schnappschuss auf den aktuellen Stand:
// - fehlende Einträge (neu angelegt): im aktiven Profil wie live, in allen anderen AUS (Marios Regel)
// - fehlende Schalter (Bereich war früher nicht im Profil): Wert wie live, also wie bisher wirksam
// - gelöschte Einträge werden entfernt
// Rückgabe: { snapshot, changed, added:[{group,label}] }
function normalize(snapshot,live,{isActive=false}={}){
  const src=snapshot?.version===2?snapshot:fromLegacy(snapshot||{});
  const out={version:2,lists:{},switches:{}};
  const added=[];
  for(const L of LISTS){
    const saved=src.lists?.[L.key]||{};
    out.lists[L.key]={};
    for(const x of arr(L.get(live.settings||{}))){
      if(!x?.id)continue;
      const id=String(x.id),st=saved[id];
      if(st){out.lists[L.key][id]={enabled:!!st.enabled,...(L.hasBot?{bot:st.bot||x.bot||null}:{})};continue;}
      out.lists[L.key][id]=isActive?stateOf(x,L.hasBot):{enabled:false,...(L.hasBot?{bot:x.bot||null}:{})};
      added.push({group:L.group,label:L.label(x)});
    }
  }
  for(const S of SWITCHES){
    const st=src.switches?.[S.key],cur=S.get(live)||{};
    out.switches[S.key]=st?{enabled:!!st.enabled,...(S.hasBot?{bot:st.bot||cur.bot||null}:{})}:stateOf(cur,S.hasBot);
  }
  const changed=JSON.stringify(out)!==JSON.stringify(snapshot);
  return {snapshot:out,changed,added};
}

// Überträgt den (normalisierten) Schnappschuss auf live. Jeder Eintrag bekommt einen festen Zustand.
function apply(live,snapshot,opts={}){
  const snap=normalize(snapshot,live,{isActive:false}).snapshot;
  for(const L of LISTS){
    for(const x of arr(L.get(live.settings||{}))){
      if(!x?.id)continue;
      const st=snap.lists[L.key][String(x.id)];
      x.enabled=!!st.enabled;
      if(L.hasBot&&st.bot)x.bot=st.bot;
    }
  }
  for(const S of SWITCHES){
    if(skipSwitch(S,opts))continue;
    const st=snap.switches[S.key],t=S.target(live);
    t.enabled=!!st.enabled;
    if(S.hasBot&&st.bot)t.bot=st.bot;
  }
  return live;
}

// Soll/Ist-Abgleich nach dem Umschalten. Leere Liste = alles korrekt übernommen.
function verify(live,snapshot,opts={}){
  const snap=normalize(snapshot,live,{isActive:false}).snapshot;
  const now=capture(live),diff=[];
  const cmp=(group,label,want,have,hasBot)=>{
    if(!!want.enabled!==!!have.enabled)diff.push({group,label,field:"enabled",expected:!!want.enabled,actual:!!have.enabled});
    else if(hasBot&&want.bot&&want.bot!==have.bot)diff.push({group,label,field:"bot",expected:want.bot,actual:have.bot});
  };
  for(const L of LISTS)for(const x of arr(L.get(live.settings||{}))){
    if(!x?.id)continue;const id=String(x.id);
    cmp(L.group,L.label(x),snap.lists[L.key][id],now.lists[L.key][id],L.hasBot);
  }
  for(const S of SWITCHES)if(!skipSwitch(S,opts))cmp(S.group,S.label,snap.switches[S.key],now.switches[S.key],S.hasBot);
  return diff;
}

// Für die Oberfläche: alle Schalter eines Profils, gruppiert.
function describe(live,snapshot,opts={}){
  const snap=normalize(snapshot,live,{isActive:false}).snapshot;
  const groups=new Map();
  const push=(group,row)=>{if(!groups.has(group))groups.set(group,[]);groups.get(group).push(row);};
  for(const S of SWITCHES)if(!skipSwitch(S,opts))push(S.group,{kind:"switch",key:S.key,id:null,label:S.label,hasBot:S.hasBot,...snap.switches[S.key]});
  for(const L of LISTS)for(const x of arr(L.get(live.settings||{}))){
    if(!x?.id)continue;
    push(L.group,{kind:"list",key:L.key,id:String(x.id),label:L.label(x),hasBot:L.hasBot,...snap.lists[L.key][String(x.id)]});
  }
  const order=["Ereignisse & Community","Commands","Timer","Auto-Replies","Begrüßungen","Team","Spiele & Overlays","Moderation"];
  return order.filter(g=>groups.has(g)).map(g=>({group:g,items:groups.get(g)}));
}

// Übernimmt Änderungen aus der Oberfläche in einen Schnappschuss. Unbekannte Schlüssel und Bots werden ignoriert.
function patch(snapshot,live,changes,validBots,opts={}){
  const snap=normalize(snapshot,live,{isActive:false}).snapshot;
  const okBot=b=>b&&validBots.includes(String(b));
  for(const c of arr(changes)){
    if(c?.kind==="switch"){
      const S=SWITCHES.find(x=>x.key===c.key);if(!S||skipSwitch(S,opts))continue;
      const st=snap.switches[S.key];
      if(typeof c.enabled==="boolean")st.enabled=c.enabled;
      if(S.hasBot&&okBot(c.bot))st.bot=String(c.bot);
    }else if(c?.kind==="list"){
      const L=LISTS.find(x=>x.key===c.key);if(!L)continue;
      const st=snap.lists[L.key][String(c.id)];if(!st)continue;
      if(typeof c.enabled==="boolean")st.enabled=c.enabled;
      if(L.hasBot&&okBot(c.bot))st.bot=String(c.bot);
    }
  }
  return snap;
}

function counts(snapshot){
  const on=o=>Object.values(o||{}).filter(x=>x?.enabled).length;
  const s=snapshot?.version===2?snapshot:fromLegacy(snapshot||{});
  const sw=k=>!!s.switches?.[k]?.enabled;
  return {
    commands:on(s.lists?.commands),timers:on(s.lists?.timers),autoReplies:on(s.lists?.autoReplies),greetings:on(s.lists?.greetings),
    teamMembers:on(s.lists?.teamMembers),
    follow:sw("followEvent"),raid:sw("raidEvent"),followage:sw("followage"),watchtime:sw("watchtime"),
    teamTimer:sw("teamTimer"),clipSharing:sw("clipSharing"),stubenkontrolle:sw("stubenkontrolle"),followerAlert:sw("followerAlert"),
    moderation:["modLinks","modEmotes","modSymbols","modCaps"].filter(sw).length
  };
}

module.exports={LISTS,SWITCHES,capture,normalize,apply,verify,describe,patch,counts};
