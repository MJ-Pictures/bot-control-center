"use strict";
// Entkopplung Schritt 1b: Übergabestelle Twitch-Laufzeit → Web-Kern.
// Die Twitch-Laufzeit kennt die Overlay-Module (Stubenkontrolle, Followathon, Follower-Alert)
// nicht mehr direkt. Sie meldet Ereignisse an diese Stelle; der Web-Kern meldet dort an,
// wer sie verarbeitet. Heute sind das Funktionsaufrufe im selben Prozess; später wird daraus
// ein interner HTTP-Aufruf vom Twitch-Bot-Container an die Weboberfläche. Deshalb werden nur
// einfache Daten übergeben (Ereignis, Nachrichtentext, Metadaten) und keine Laufzeitobjekte.
function createTwitchEventHub({log=console}={}){
  const listeners=new Map();      // Ereignistyp -> [{label,fn}] in Anmeldereihenfolge
  const chatCommands=new Map();   // "!befehl" -> {label,fn}
  const dynamicCommands=[];       // 9.11.0: [{list:()=>["!befehl",…],label,fn}] – Namen können sich zur Laufzeit ändern

  function on(type,label,fn){
    if(typeof type!=="string"||!type)throw new Error("Ereignistyp fehlt.");
    if(typeof fn!=="function")throw new Error("Verarbeitung fehlt.");
    if(!listeners.has(type))listeners.set(type,[]);
    listeners.get(type).push({label:String(label||type),fn});
  }
  // Verarbeitet alle Empfänger nacheinander. Ein Fehler eines Empfängers hält die anderen
  // und den Aufrufer (z. B. die Follow-Begrüßung im Chat) nicht auf.
  async function emit(type,payload){
    let delivered=0;
    for(const {label,fn} of listeners.get(type)||[]){
      try{await fn(payload);delivered++;}
      catch(e){try{log.error(`⚠️ ${label}:`,e?.message||e);}catch{}}
    }
    return delivered;
  }
  // 9.27.0: Flüchtige Ereignisse (Chat-Overlay): Hier ohne Unterschied zu emit; im getrennten Betrieb
  // (createRemoteTwitchEvents) ohne Warteschlange und ohne Wiederholung.
  function emitTransient(type,payload){return emit(type,payload);}
  function registerChatCommands(commands,label,fn){
    if(typeof fn!=="function")throw new Error("Verarbeitung fehlt.");
    for(const raw of commands||[]){
      const cmd=String(raw||"").trim().toLowerCase();
      if(!/^!\S+$/.test(cmd))throw new Error(`Ungültiger Chat-Befehl: ${raw}`);
      if(chatCommands.has(cmd))throw new Error(`Chat-Befehl doppelt angemeldet: ${cmd}`);
      chatCommands.set(cmd,{label:String(label||cmd),fn});
    }
  }
  // 9.11.0: Befehle, deren Namen aus Einstellungen kommen (z. B. anpassbare Spielbefehle).
  // Fest angemeldete Befehle haben immer Vorrang.
  function registerDynamicChatCommands(list,label,fn){
    if(typeof list!=="function")throw new Error("Befehlsliste fehlt.");
    if(typeof fn!=="function")throw new Error("Verarbeitung fehlt.");
    dynamicCommands.push({list,label:String(label||"dynamisch"),fn});
  }
  function dynamicNames(entry){
    try{return (entry.list()||[]).map(x=>String(x||"").trim().toLowerCase()).filter(x=>/^!\S+$/.test(x));}catch{return [];}
  }
  function targetOf(cmd){
    if(chatCommands.has(cmd))return chatCommands.get(cmd);
    for(const entry of dynamicCommands)if(dynamicNames(entry).includes(cmd))return entry;
    return null;
  }
  function chatCommandOf(message){return (String(message||"").trim().split(/\s+/)[0]||"").toLowerCase();}
  function claimsChat(message){return !!targetOf(chatCommandOf(message));}
  // true = die Nachricht gehört einem angemeldeten Modul und wurde dorthin übergeben.
  // Fehler des Moduls werden wie bisher an den Aufrufer weitergegeben.
  async function dispatchChatCommand(event,message){
    const target=targetOf(chatCommandOf(message));
    if(!target)return false;
    return (await target.fn(event,message))!==false;
  }
  function describe(){
    const commands=Object.fromEntries([...chatCommands].map(([c,t])=>[c,t.label]));
    for(const entry of dynamicCommands)for(const c of dynamicNames(entry))if(!(c in commands))commands[c]=entry.label;
    return {events:Object.fromEntries([...listeners].map(([t,l])=>[t,l.map(x=>x.label)])),chatCommands:commands};
  }
  return {on,emit,emitTransient,registerChatCommands,registerDynamicChatCommands,claimsChat,dispatchChatCommand,describe};
}
module.exports={createTwitchEventHub};
