"use strict";
const crypto=require("crypto");

// N-5: Die Session-ID im Cookie ist ein Geheimnis. Gespeichert wird nur ihr SHA-256-Hash
// (Präfix "h1:"). Ein Lesezugriff auf Datenbank oder sessions.json liefert so keine
// übernehmbaren Sitzungen. Ein Cookie, das selbst mit "h1:" beginnt, wird nie akzeptiert.
const SESSION_KEY_PREFIX="h1:";

function sessionKey(sid){
  const v=String(sid||"");
  if(!v||v.startsWith(SESSION_KEY_PREFIX))return"";
  return SESSION_KEY_PREFIX+crypto.createHash("sha256").update(v).digest("hex");
}
function sessionRawFor(sessions,sid){
  const key=sessionKey(sid);
  return key&&Object.prototype.hasOwnProperty.call(sessions,key)?sessions[key]:null;
}
function sessionExpired(raw,maxAgeMs,now=Date.now()){
  const createdAt=Date.parse(raw?.created||raw?.createdAt||"");
  return !Number.isFinite(createdAt)||createdAt>now||now-createdAt>maxAgeMs;
}
// Stellt Altbestand (Klartext-IDs) auf Hash-Schlüssel um und entfernt Abgelaufenes/Ungültiges.
function migrateSessions(sessions,maxAgeMs,now=Date.now()){
  const out={};let migrated=0,pruned=0;
  for(const [key,raw] of Object.entries(sessions||{})){
    if(!raw||typeof raw!=="object"||sessionExpired(raw,maxAgeMs,now)){pruned++;continue;}
    if(key.startsWith(SESSION_KEY_PREFIX)){out[key]=raw;continue;}
    const hashed=sessionKey(key);
    if(!hashed){pruned++;continue;}
    out[hashed]=raw;migrated++;
  }
  return {sessions:out,migrated,pruned,remaining:Object.keys(out).length};
}
module.exports={SESSION_KEY_PREFIX,sessionKey,sessionRawFor,sessionExpired,migrateSessions};
