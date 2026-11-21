"use strict";
const crypto=require("node:crypto");
function validateAddTerm(input,snapshot){
 const word=String(input.word||"").normalize("NFKC").trim();
 if(word.length<2||word.length>100||/[\u0000-\u001f\u007f]/u.test(word))throw Error("Begriff muss 2–100 Zeichen enthalten (keine Steuerzeichen).");
 const category=String(input.category||"benutzerdefiniert").trim().toLocaleLowerCase("de-DE");
 if(!(snapshot.categories||[]).some(c=>c.category_id===category))throw Error("Kategorie existiert nicht. Die gültigen Kategorie-IDs stehen im Control Center unter Wortfilter → Kategorien.");
 const severity=input.severity===undefined||input.severity===null||input.severity===""?3:Number(input.severity);
 if(!Number.isInteger(severity)||severity<1||severity>5)throw Error("Schweregrad muss zwischen 1 und 5 liegen.");
 const platform=String(input.platform||"discord").trim().toLowerCase();
 if(!["discord","twitch","both"].includes(platform))throw Error("Plattform muss discord, twitch oder both sein.");
 return {word,category,severity,platforms:platform==="both"?["discord","twitch"]:[platform]};
}
function makeAddTerm(v,actorId){
 return {term_id:crypto.randomUUID(),term:v.word,category_id:v.category,severity:v.severity,detection_type:"whole_word",origin:"discord-command",source_name:"Discord /add",created_by:`discord:${actorId}`,enabled:true,test_only:false,leetspeak:true,repeat_letters:false,flex_separators:false,umlauts:true,platforms:["discord","twitch"].map(platform=>({platform,enabled:v.platforms.includes(platform)})),metadata:{createdVia:"discord-add",actorDiscordId:actorId}};
}
// Slash-command autocomplete reads actual categories. Do not hardcode IDs in Discord.
function categorySuggestions(categories,query=""){
 const q=String(query||"").normalize("NFKC").trim().toLocaleLowerCase("de-DE");
 return (Array.isArray(categories)?categories:[])
  .filter(x=>x&&typeof x.category_id==="string")
  .filter(x=>!q||`${x.name||""} ${x.category_id}`.toLocaleLowerCase("de-DE").includes(q))
  .slice(0,25)
  .map(x=>({name:String(x.name||x.category_id).slice(0,100),value:String(x.category_id).slice(0,100)}));
}
function wordAddLogMessage(term,actorId,categoryName){
 const safe=s=>String(s||"").replace(/[\r\n]+/g," ").replace(/[`*_~|<>@]/g,"").slice(0,110);
 const platforms=(term.platforms||[]).filter(p=>p.enabled).map(p=>p.platform).join(" + ");
 return `🛡️ **Wortfilter ergänzt** · ${safe(term.term)} · ${safe(categoryName||term.category_id)} · Grad ${Number(term.severity)} · ${safe(platforms)} · Leetspeak AN · durch <@${String(actorId).replace(/\D/g,"")}>`;
}
module.exports={validateAddTerm,makeAddTerm,categorySuggestions,wordAddLogMessage};
