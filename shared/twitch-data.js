"use strict";
// Twitch-Daten des Control Centers (Entkopplung Schritt 3b, 8.9.21).
// Funktionen, die nur gespeicherte Daten lesen, schreiben oder aufbereiten und keine laufende
// Twitch-Verbindung brauchen: Gewinnspiel-Zustand, Team-Befehle/Einstellungen, Nutzungsstatistik,
// Watchtime, Clip-Zustand. Weboberfläche und Twitch-Bot erzeugen je eine eigene Instanz über
// createTwitchData(deps); beide lesen und schreiben dieselbe Datenbank.
// Einzige Ausnahme mit Twitch-Bezug: die Nutzungsstatistik zeigt den Live-Status an und bekommt
// ihn über deps.getStreamInfo (in der Weboberfläche: über die Schnittstelle zum Twitch-Bot).
// Der Inhalt wurde unverändert aus der Twitch-Laufzeit übernommen; deshalb ist er nicht eingerückt.

const REQUIRED_DEPS = Object.freeze(["FILES", "DEFAULT_SETTINGS", "pgStore", "giveawayStore", "readJson", "writeJson", "audit", "getStreamInfo"]);

function createTwitchData(deps) {
  for (const name of REQUIRED_DEPS) if (deps?.[name] === undefined) throw new Error(`Twitch-Daten: Abhängigkeit fehlt: ${name}`);
  const {FILES, DEFAULT_SETTINGS, pgStore, giveawayStore, readJson, writeJson, audit, getStreamInfo} = deps;

function twitchBlockedTermsChanged(beforeSettings, afterSettings) {
  const normalize = list => (list || []).map(x => ({
    id:String(x?.id || ""),
    word:String(x?.word || "").trim(),
    enabled:x?.enabled !== false,
    action:String(x?.action || "detect"),
    twitchTermId:x?.twitchTermId || null
  })).sort((a,b)=>a.id.localeCompare(b.id));

  const before = normalize(beforeSettings?.blockedWords);
  const after = normalize(afterSettings?.blockedWords);

  // Nur Änderungen, die Twitch Blocked Terms tatsächlich betreffen, sollen
  // einen API-Sync auslösen. Normale Command-/Timer-/Moderationsänderungen
  // dürfen niemals an fehlenden Blocked-Term-Rechten scheitern.
  const relevant = item => item.action === "twitch_block" || !!item.twitchTermId;

  return JSON.stringify(before.filter(relevant)) !== JSON.stringify(after.filter(relevant));
}

function readGiveawayState() { return giveawayStore.read(); }

function writeGiveawayState(state,opts={}) { return giveawayStore.write(state,opts); }

function publicGiveaway(g) { return giveawayStore.publicGiveaway(g); }

function archiveCurrentGiveaway(state) { return giveawayStore.archiveCurrent(state); }

function giveawayStartMessage(g) {
  const title = g.title ? ` „${g.title}“` : "";
  if (g.type === "keyword") {
    return `🎁 Gewinnspiel${title} gestartet! Schreib ${g.keyword} in den Chat, um teilzunehmen.`;
  }
  return `🎁 Gewinnspiel${title} gestartet! Schreib etwas in den Chat, um im Lostopf zu landen.`;
}

function giveawayWinnerMessage(g, winner, winnerNumber=1) {
  const title = g.title ? ` bei „${g.title}“` : "";
  const prefix = winnerNumber > 1 ? `Gewinner #${winnerNumber}: ` : "";
  return `🎉 ${prefix}Glückwunsch @${winner.name || winner.login}! Du hast${title} gewonnen.`;
}

// 9.13.0: Standard-Teamtexte und -mitglieder kommen aus dem Textpaket der Installation (neutral: keine Mitglieder).
const textPack = require(require("path").join(__dirname, "text-pack")); // gleicher Ordner (/shared), auch ohne Einbindung unter /shared ladbar
const botRoster = require(require("path").join(__dirname, "bot-roster")); // 9.15.0
const DEFAULT_TEAM_MEMBERS = textPack.NEUTRAL.defaultSettings.team.members;

function ensureTeamSettings(settings){
  settings.team ||= {};
  const packTeam = textPack.get(settings).defaultSettings.team;
  settings.team.bot ||= botRoster.mainKeyOfSettings(settings);
  settings.team.teamCommandText ||= packTeam.teamCommandText;
  settings.team.timer ||= {};
  if(settings.team.timer.enabled===undefined) settings.team.timer.enabled=true;
  settings.team.timer.everyMinutes=Math.max(1,Number(settings.team.timer.everyMinutes||30));
  settings.team.timer.minLines=Math.max(0,Number(settings.team.timer.minLines??15));
  settings.team.timer.text ||= packTeam.timer.text;
  if(!Array.isArray(settings.team.members) || !settings.team.members.length){
    settings.team.members=packTeam.members.map(x=>({...x}));
  }
  return settings.team;
}

function normalizeTeamCommand(value){
  const v=String(value||"").trim().toLowerCase();
  if(!v) return "";
  return v.startsWith("!") ? v : `!${v}`;
}

function teamMemberResponse(member,pack=textPack.NEUTRAL){
  const bits=[];
  if(member.rank) bits.push(String(member.rank).trim());
  if(member.since) bits.push(String(pack.teamMemberSince||"Seit {since} dabei").replace("{since}",String(member.since).trim()));
  if(member.role) bits.push(String(member.role).trim());
  if(member.humor) bits.push(String(member.humor).trim());
  const name=String(member.name||"Teammitglied").trim();
  return `${pack.teamMemberPrefix} ${name}${bits.length ? ` | ${bits.join(" | ")}` : ""}${member.humor ? "." : ""}${pack.teamMemberSuffix}`;
}

function syncTeamManagedEntries(settings){
  const team=ensureTeamSettings(settings);
  settings.commands=Array.isArray(settings.commands)?settings.commands:[];
  settings.timers=Array.isArray(settings.timers)?settings.timers:[];

  settings.commands=settings.commands.filter(x=>x?.managedBy!=="team");
  settings.timers=settings.timers.filter(x=>x?.managedBy!=="team");

  const activeMembers=team.members.filter(m=>m && m.enabled!==false && normalizeTeamCommand(m.command));
  const commandList=activeMembers.map(m=>normalizeTeamCommand(m.command)).join(" | ");

  settings.commands.push({
    id:"team-managed-overview",
    managedBy:"team",
    enabled:true,
    command:"!team",
    aliases:"",
    bot:team.bot||botRoster.mainKeyOfSettings(settings),
    cooldownSeconds:30,
    modsOnly:false,
    response:String(team.teamCommandText||"").replaceAll("{commands}",commandList)
  });

  for(const member of activeMembers){
    settings.commands.push({
      id:`team-managed-${String(member.id||member.name||Date.now()).toLowerCase().replace(/[^a-z0-9_-]+/g,"-")}`,
      managedBy:"team",
      enabled:true,
      command:normalizeTeamCommand(member.command),
      aliases:String(member.aliases||"").split(",").map(normalizeTeamCommand).filter(Boolean).join(", "),
      bot:team.bot||botRoster.mainKeyOfSettings(settings),
      cooldownSeconds:30,
      modsOnly:false,
      response:teamMemberResponse(member,textPack.get(settings))
    });
  }

  settings.timers.push({
    id:"team-managed-timer",
    managedBy:"team",
    enabled:!!team.timer.enabled,
    description:"Team-Hinweis",
    bot:team.bot||botRoster.mainKeyOfSettings(settings),
    everyMinutes:Math.max(1,Number(team.timer.everyMinutes||30)),
    minLines:Math.max(0,Number(team.timer.minLines??15)),
    conditionMode:"and",
    text:String(team.timer.text||"")
  });
  return settings;
}

function prepareSettings(settings){
  ensureTeamSettings(settings);
  syncTeamManagedEntries(settings);
  return settings;
}

function berlinDateKey(date=new Date()) {
  try {
    return new Intl.DateTimeFormat("sv-SE",{
      timeZone:"Europe/Berlin",
      year:"numeric",
      month:"2-digit",
      day:"2-digit"
    }).format(date);
  } catch {
    return date.toISOString().slice(0,10);
  }
}

function readUsageStats() {
  const data=pgStore.enabled?pgStore.exportUsageStats():readJson(FILES.usageStats,{commands:{},autoReplies:{},updatedAt:null});
  if(!data.commands || typeof data.commands!=="object" || Array.isArray(data.commands)) data.commands={};
  if(!data.autoReplies || typeof data.autoReplies!=="object" || Array.isArray(data.autoReplies)) data.autoReplies={};
  return data;
}

function emptyUsageStat() {
  return {
    total:0,
    todayDate:null,
    todayCount:0,
    streamId:null,
    streamCount:0,
    lastTriggeredAt:null,
    lastUser:null,
    lastInput:null
  };
}

function normalizedUsageStat(stat, currentStreamId=null) {
  const s=stat || emptyUsageStat();
  const today=berlinDateKey();
  return {
    total:Number(s.total||0),
    today:s.todayDate===today ? Number(s.todayCount||0) : 0,
    currentStream:currentStreamId && String(s.streamId||"")===String(currentStreamId)
      ? Number(s.streamCount||0)
      : 0,
    lastTriggeredAt:s.lastTriggeredAt||null,
    lastUser:s.lastUser||null,
    lastInput:s.lastInput||null
  };
}

async function buildUsageStatsView() {
  const settings=readJson(FILES.settings,DEFAULT_SETTINGS);
  const data=readUsageStats();
  const stream=await getStreamInfo().catch(()=>({live:false,streamId:null}));
  const currentStreamId=stream.live ? stream.streamId : null;

  const commands=(settings.commands||[]).map(item=>({
    id:item.id,
    name:item.command||"(ohne Command)",
    aliases:item.aliases||"",
    enabled:!!item.enabled,
    bot:item.bot||botRoster.mainKeyOfSettings(settings),
    stats:normalizedUsageStat(data.commands?.[item.id],currentStreamId)
  }));

  const autoReplies=(settings.autoReplies||[]).map(item=>({
    id:item.id,
    name:item.name || item.trigger || (Array.isArray(item.triggers)?item.triggers[0]:"") || "Auto-Reply",
    triggers:Array.isArray(item.triggers)
      ? item.triggers
      : String(item.trigger||"").split(/[\n,]+/).map(x=>x.trim()).filter(Boolean),
    enabled:!!item.enabled,
    bot:item.bot||botRoster.mainKeyOfSettings(settings),
    stats:normalizedUsageStat(data.autoReplies?.[item.id],currentStreamId)
  }));

  const combined=[...commands,...autoReplies];
  const summary=combined.reduce((acc,item)=>{
    acc.total+=item.stats.total;
    acc.today+=item.stats.today;
    acc.currentStream+=item.stats.currentStream;
    return acc;
  },{total:0,today:0,currentStream:0});

  return {
    generatedAt:new Date().toISOString(),
    currentStream:{
      live:!!stream.live,
      id:currentStreamId||null,
      startedAt:stream.startedAt||null
    },
    summary:{
      ...summary,
      commandTotal:commands.reduce((n,x)=>n+x.stats.total,0),
      autoReplyTotal:autoReplies.reduce((n,x)=>n+x.stats.total,0)
    },
    commands,
    autoReplies
  };
}

function readWatchtime() {
  if(pgStore.enabled)return pgStore.exportWatchtime();
  const data = readJson(FILES.watchtime,{users:{},updatedAt:null});
  if (!data.users || typeof data.users !== "object" || Array.isArray(data.users)) data.users={};
  return data;
}

function writeWatchtime(data) {
  data.updatedAt = new Date().toISOString();
  if(pgStore.enabled){pgStore.replaceWatchtime(data.users||{});return;}
  writeJson(FILES.watchtime,data);
}

function normalizeWatchtimeEntry(userId, entry={}) {
  return {
    userId:String(userId||""),
    seconds:Math.max(0,Math.floor(Number(entry.seconds||0))),
    login:String(entry.login||""),
    name:String(entry.name||entry.login||""),
    lastSeenAt:entry.lastSeenAt||null
  };
}

function queryWatchtime({page=1,pageSize=100,search="",sort="desc"}={}) {
  if(pgStore.enabled)return pgStore.queryWatchtime({page,pageSize,search,sort});
  const data=readWatchtime();
  const needle=String(search||"").trim().toLowerCase();

  let items=Object.entries(data.users||{})
    .map(([userId,entry])=>normalizeWatchtimeEntry(userId,entry))
    .filter(x=>{
      if(!needle) return true;
      return x.login.toLowerCase().includes(needle) ||
        x.name.toLowerCase().includes(needle) ||
        x.userId.includes(needle);
    });

  if(sort==="asc"){
    items.sort((a,b)=>a.seconds-b.seconds || a.login.localeCompare(b.login,"de"));
  }else if(sort==="name"){
    items.sort((a,b)=>(a.name||a.login).localeCompare(b.name||b.login,"de",{sensitivity:"base"}));
  }else if(sort==="recent"){
    items.sort((a,b)=>String(b.lastSeenAt||"").localeCompare(String(a.lastSeenAt||"")));
  }else{
    items.sort((a,b)=>b.seconds-a.seconds || a.login.localeCompare(b.login,"de"));
  }

  const safeSize=Math.min(100,Math.max(1,Number(pageSize||100)));
  const total=items.length;
  const totalPages=Math.max(1,Math.ceil(total/safeSize));
  const safePage=Math.min(totalPages,Math.max(1,Number(page||1)));
  const start=(safePage-1)*safeSize;

  const allEntries=Object.entries(data.users||{});
  const totalSeconds=allEntries.reduce((sum,[,entry])=>sum+Math.max(0,Number(entry?.seconds||0)),0);

  return {
    items:items.slice(start,start+safeSize),
    page:safePage,
    pageSize:safeSize,
    total,
    totalPages,
    summary:{
      users:allEntries.length,
      totalSeconds:Math.floor(totalSeconds),
      updatedAt:data.updatedAt||null
    }
  };
}

function setWatchtimeSeconds(userId, seconds, actor, reason="manual-correction") {
  const id=String(userId||"");
  if(pgStore.enabled){
    const beforeEntry=pgStore.getWatchtime(id);
    if(!beforeEntry)return null;
    const before=Math.max(0,Math.floor(Number(beforeEntry.seconds||0)));
    const after=Math.max(0,Math.floor(Number(seconds||0)));
    const entry=pgStore.setWatchtime(id,after,actor);
    audit(actor,"watchtime.corrected",{section:"watchtime",userId:id,login:entry?.login||"",name:entry?.name||"",beforeSeconds:before,afterSeconds:after,reason});
    return entry;
  }
  const data=readWatchtime();
  const entry=data.users?.[id];
  if(!entry) return null;

  const before=Math.max(0,Math.floor(Number(entry.seconds||0)));
  const after=Math.max(0,Math.floor(Number(seconds||0)));
  entry.seconds=after;
  entry.correctedAt=new Date().toISOString();
  entry.correctedBy=actor;
  writeWatchtime(data);

  audit(actor,"watchtime.corrected",{
    section:"watchtime",
    userId:id,
    login:entry.login||"",
    name:entry.name||"",
    beforeSeconds:before,
    afterSeconds:after,
    reason
  });

  return normalizeWatchtimeEntry(id,entry);
}

function normalizeClipSettings(settings) {
  settings.clipSharing ||= {};
  const c = settings.clipSharing;

  if (typeof c.enabled !== "boolean") c.enabled = false;
  if (!Number.isFinite(Number(c.intervalSeconds))) c.intervalSeconds = 20;
  c.intervalSeconds = Math.min(120, Math.max(15, Number(c.intervalSeconds || 20)));
  if (typeof c.onlyLive !== "boolean") c.onlyLive = true;
  if (typeof c.showCreator !== "boolean") c.showCreator = true;
  if (typeof c.message !== "string" || !c.message.trim()) {
    c.message = "🎬 Neuer Clip: „{title}“ – erstellt von @{creator} {url}";
  }

  return c;
}

function readClipState() {
  if(pgStore.enabled){
    const r=pgStore.getClipState();
    const s=r?.state||{initialized:false,seen:{},lastCheckedAt:null,lastShared:null,lastError:null,knownCount:0};
    if (!s.seen || typeof s.seen !== "object" || Array.isArray(s.seen)) s.seen = {};
    s.knownCount=Number(r?.knownCount ?? s.knownCount ?? Object.keys(s.seen).length);
    return s;
  }
  const s = readJson(FILES.clipState, {initialized:false,seen:{},lastCheckedAt:null,lastShared:null,lastError:null});
  if (!s.seen || typeof s.seen !== "object" || Array.isArray(s.seen)) s.seen = {};
  s.knownCount=Object.keys(s.seen).length;
  return s;
}

  return {twitchBlockedTermsChanged, readGiveawayState, writeGiveawayState, publicGiveaway, archiveCurrentGiveaway, giveawayStartMessage, giveawayWinnerMessage, DEFAULT_TEAM_MEMBERS, ensureTeamSettings, normalizeTeamCommand, teamMemberResponse, syncTeamManagedEntries, prepareSettings, berlinDateKey, readUsageStats, emptyUsageStat, normalizedUsageStat, buildUsageStatsView, readWatchtime, writeWatchtime, normalizeWatchtimeEntry, queryWatchtime, setWatchtimeSeconds, normalizeClipSettings, readClipState};
}

module.exports = { createTwitchData, REQUIRED_DEPS };
