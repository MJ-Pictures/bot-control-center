"use strict";
const DEFAULT_TEXT=require("./text-pack").NEUTRAL.discord.inviteTeaser; // 9.13.0: Texte kommen aus dem Textpaket
const LIVE_TEXT=require("./text-pack").NEUTRAL.discord.inviteLive;
const CHECK_MS=6*60*60*1000;
function createDiscordInviteService({guildId,read,write,api,log=()=>{},isActive=()=>true}){
 const initial={enabled:false,channelId:"",inviteUrl:"",code:"",status:"unchecked",expiresAt:null,uses:null,lastCheckedAt:null,lastSuccessfulCheckAt:null,lastError:null};
 let state={...initial,...(read()||{})};
 // Default remains off for installations without an explicit saved enabled flag.
 if(typeof state.enabled!=="boolean")state.enabled=false;
 // A previously persisted valid status is not trusted after a restart.
 state.status="unchecked";
 let ongoing=null,interval=null;
 function persist(){write(state);}
 function publicState(){return {...state,inviteUrl:state.inviteUrl||""};}
 // 9.8.0: Modul „Einladungslink“ aus → Twitch bekommt „nicht aktiv“ und nutzt den Ersatztext.
 function twitchState(){if(!isActive())return {enabled:false,invite:null,moduleDisabled:true};return {enabled:state.enabled,invite:state.enabled&&state.status==="valid"?state.inviteUrl:null};}
 const codeFrom=(inv)=>String(inv?.code||"").trim();
 function matches(inv){return String(inv?.guild?.id||"")===String(guildId)&&String(inv?.channel?.id||"")===String(state.channelId);}
 function setValid(inv){const code=codeFrom(inv);if(!code||!matches(inv))throw Error("Invite gehört nicht zum ausgewählten Server/Kanal.");state.code=code;state.inviteUrl=`https://discord.gg/${code}`;state.status="valid";state.expiresAt=inv.expires_at??null;state.uses=Number.isFinite(inv.uses)?inv.uses:null;state.lastSuccessfulCheckAt=new Date().toISOString();state.lastError=null;}
 async function validate(code){return api(`/invites/${encodeURIComponent(code)}?with_counts=true`);}
 async function run({allowCreate=false,forceNew=false}={}){
  if(ongoing)return ongoing;
  ongoing=(async()=>{
   state.lastCheckedAt=new Date().toISOString();
   if(!state.channelId){state.status="unchecked";state.lastError="Bitte zuerst den Einladungskanal auswählen.";persist();return publicState();}
   if(!forceNew&&state.code){
    try{const inv=await validate(state.code);if(!matches(inv)){state.status="invalid";state.lastError="Gespeicherter Invite gehört nicht zum gewählten Server/Kanal.";persist();return publicState();}setValid(inv);persist();return publicState();}
    catch(e){if(e.status!==404&&e.status!==410){state.status="error";state.lastError=`Invite-Prüfung fehlgeschlagen: ${e.message}`;persist();return publicState();}state.status="invalid";state.lastError="Gespeicherter Invite ist nicht mehr gültig.";persist();}
   }
   if(!allowCreate||!state.enabled){persist();return publicState();}
   try{
    // Reuse only a confirmed, unlimited invitation for the correct server/channel.
    const existing=await api(`/guilds/${guildId}/invites`);
    if(!Array.isArray(existing))throw Error("Einladungen konnten nicht zuverlässig aufgelistet werden.");
    const reused=existing.find(i=>matches(i)&&Number(i.max_age)===0&&Number(i.max_uses)===0&&!i.temporary&&codeFrom(i));
    if(reused){const valid=await validate(codeFrom(reused));setValid(valid);persist();return publicState();}
    const created=await api(`/channels/${state.channelId}/invites`,"POST",{max_age:0,max_uses:0,temporary:false,unique:false});
    if(!matches(created))throw Error("Discord hat einen Invite für einen unerwarteten Kanal geliefert.");
    setValid(created);persist();log("Discord-Invite wurde erstellt",{code:created.code,channelId:state.channelId});return publicState();
   }catch(e){state.status="error";state.lastError=`Invite konnte nicht erstellt werden: ${e.message}`;persist();return publicState();}
  })().finally(()=>{ongoing=null;});
  return ongoing;
 }
 function configure(body){
  if(typeof body.enabled!=="boolean")throw Error("Aktivierung muss explizit als Schalter gesetzt werden.");
  const channelId=String(body.channelId||"").trim();if(channelId&&!/^\d{15,22}$/.test(channelId))throw Error("Ungültige Kanal-ID.");
  if(body.enabled&&!channelId)throw Error("Für die Aktivierung ist ein Einladungskanal erforderlich.");
  const changed=channelId!==state.channelId;
  const newlyEnabled=body.enabled&&!state.enabled;
  state.enabled=body.enabled;state.channelId=channelId;
  if(changed){state.status="unchecked";state.lastError="Einladungskanal geändert. Invite muss geprüft werden.";}
  else if(newlyEnabled){state.status="unchecked";state.lastError=null;}
  persist();return publicState();
 }
 // 9.8.0: Prüfung/Erneuerung nur bei eingeschaltetem Modul.
 function start(){if(interval)return;if(isActive())run({allowCreate:state.enabled}).catch(e=>log("Invite Startprüfung",e.message));interval=setInterval(()=>{if(!isActive())return;run({allowCreate:state.enabled}).catch(e=>log("Invite Intervallprüfung",e.message));},CHECK_MS);interval.unref?.();}
 function stop(){if(interval)clearInterval(interval);interval=null;}
 return {get:publicState,twitch:twitchState,configure,check:()=>run({allowCreate:state.enabled}),create:()=>{if(!state.enabled)throw Error("Automatische Freigabe ist deaktiviert.");return run({allowCreate:true,forceNew:true});},start,stop};
}
module.exports={createDiscordInviteService,DEFAULT_TEXT,LIVE_TEXT,CHECK_MS};
