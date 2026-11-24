const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { createStubenkontrolle, CHAT_COMMANDS: STUBENKONTROLLE_CHAT_COMMANDS } = require("./stubenkontrolle");
const { createFollowathon } = require("./followathon");
const { createSubathon } = require("./subathon");
const { createFollowerAlert } = require("./follower-alert");
const { createChatOverlay, createBadgeCache } = require("./chat-overlay");
const { compactEvent: compactChatEventCard } = require("../shared/chat-overlay-core");
// 9.11.0 · D1: Installationsprofil (Produktname, öffentliche Adresse, Ersteinrichtung, Spielbezeichnungen).
const installationKit = require("/shared/installation-profile");
const textPackKit=require("/shared/text-pack");
const imageKit = require("/shared/image-slots");
const licenseKit = require("/shared/license");
const legalDocs = require("/shared/legal-docs");
const legacyBwk = require("/shared/legacy-bwk-migration");
const { createClientIpResolver } = require("/shared/client-ip");
const { mayManageTarget } = require("/shared/admin-hierarchy");
const csp = require("/shared/csp");
const cspReports = csp.createCspReportCollector({log:msg=>console.warn(`⚠️ ${msg}`)});

const { applySecretFiles, describeSecretSources, CONTROL_CENTER_SECRETS } = require("/shared/secret-env");
// Secrets bevorzugt aus Dateien (NAME_FILE, z. B. /run/secrets/…), sonst aus der Umgebung. Muss vor den Konstanten stehen.
const SECRET_SOURCES = applySecretFiles(CONTROL_CENTER_SECRETS, { log: msg => console.warn(msg) });

// 8.9.21 · Entkopplung 3b: Das gemeinsame Fundament (Konfiguration, Speicher, Audit, Wortfilter,
// Twitch-App-Zugang, Discord-Dienst) liegt in /shared/bcc-core.js und wird auch vom Twitch-Bot genutzt.
const { createCore } = require("/shared/bcc-core");
const core = createCore();
const {
  createGiveawayStore, createPgSyncStore, readLegacyJson, readLegacyJsonl, compileWordFilter, matchWordFilter,
  validateWordFilterRegex, diagnoseWordFilterCandidate, diagnoseWordFilter, CLIENT_ID, CLIENT_SECRET, CHANNEL_LOGIN,
  INTERNAL_SERVICE_SECRET, internalBaseUrl, serviceLabel, DISCORD_SERVICE_URL, DATA_DIR, FILES,
  DEFAULT_SETTINGS, ensureFiles, pgStore, wordFilterRefresh, wordFilterAction,
  PG_DOCUMENT_FILES, pgDocKey, giveawayStore, readJson, writeJson, audit,
  appTokenStillValid, createAppAccessToken, getAppAccessToken, twitchAppFetch, internalServiceSecretReady, internalServiceHeaders,
  discordServiceRequest,
  wordFilterCentralReady
} = core;

const PORT = Number(process.env.PORT || 3000);
// 9.11.0: Weiterleitungsadressen aus der Umgebung oder, falls dort nicht gesetzt, aus der öffentlichen Adresse.
function twitchRedirectUri(){const env=String(process.env.TWITCH_REDIRECT_URI||"").trim();if(env)return env;const b=publicBaseUrl();return b?`${b}/auth/twitch/callback`:"";}
function connectionRedirectUri(){
  const env=String(process.env.TWITCH_CONNECTION_REDIRECT_URI||"").trim();if(env)return env;
  const login=twitchRedirectUri();
  return login?login.replace(/\/auth\/twitch\/callback$/, "/auth/connect/callback"):"";
}
const LOCAL_ADMIN_ENABLED = String(process.env.LOCAL_ADMIN_ENABLED || "false").toLowerCase() === "true";
// V8.6.6: Host-Fallback nur für direkte LAN-Verbindungen ohne Proxy-Header (Docker-NAT). "false" schaltet ihn ab.
const LOCAL_ADMIN_HOST_FALLBACK = String(process.env.LOCAL_ADMIN_HOST_FALLBACK || "true").toLowerCase() !== "false";
const LOCAL_ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD || "";
const LOCAL_NETWORK_PREFIX = process.env.LOCAL_NETWORK_PREFIX || ""; // legacy display only
// 9.11.0: Standard = übliche private Netze statt eines festen Heimnetzes; eigener Wert über LOCAL_NETWORK_CIDRS.
const LOCAL_NETWORK_CIDRS = String(process.env.LOCAL_NETWORK_CIDRS || installationKit.DEFAULT_LOCAL_NETWORK_CIDRS.join(",")).split(",").map(x=>x.trim()).filter(Boolean);
const TRUSTED_PROXY_CIDRS = String(process.env.TRUSTED_PROXY_CIDRS || "").split(",").map(x=>x.trim()).filter(Boolean);
const ALLOWED_HOSTS = new Set(String(process.env.ALLOWED_HOSTS || "").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean));
const DISCORD_SERVICE_LABEL = serviceLabel(process.env.DISCORD_SERVICE_LABEL,"bcc-discord");
// 9.11.0: Öffentliche Adresse – Umgebung (PUBLIC_BASE_URL) vor Installationsprofil (Oberfläche).
const ENV_PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "");
let installationCache = null, installationCacheAt = 0;
// Bewusst ohne Fehlerabfang: Ist die Datenbank nicht lesbar, wird nichts angelegt (sonst würde eine
// Bestandsinstallation fälschlich als neu erkannt).
function countSessions(){return Object.keys(sessionStore()||{}).length;}
function countUsers(){return (readUsers().users||[]).length;}
// Liest settings.installation; fehlt es (Installation vor 9.11.0 oder neu), wird es einmalig angelegt:
// mit vorhandenen Benutzern/Sitzungen = Bestandsinstallation (bisherige Werte), sonst neue Installation (neutral, Einrichtung offen).
function installationProfile({fresh=false}={}){
  if(!fresh&&installationCache&&Date.now()-installationCacheAt<30000)return installationCache;
  const settingsNow=readJson(FILES.settings,DEFAULT_SETTINGS);
  // Ging das Profil verloren (z. B. Einstellungen von außen ersetzt), den zuletzt bekannten Stand zurückschreiben.
  if((!settingsNow.installation||typeof settingsNow.installation!=="object")&&installationCache){
    settingsNow.installation=installationCache;writeJson(FILES.settings,settingsNow);
    console.warn("⚠️ Installationsprofil fehlte in den Einstellungen und wurde wiederhergestellt.");
  }
  if(!settingsNow.installation||typeof settingsNow.installation!=="object"){
    const existing=legacyBwk.isExistingInstallation({users:countUsers(),sessions:countSessions()});
    settingsNow.installation=existing?legacyBwk.legacyInstallation():installationKit.freshInstallation();
    writeJson(FILES.settings,settingsNow);
    try{audit("system","installation.profile.created",{section:"installation",source:existing?"migration-9.11.0":"neu",productName:settingsNow.installation.productName});}catch{}
    console.log(existing?"ℹ️ Installationsprofil aus den bisherigen Werten übernommen (9.11.0).":"ℹ️ Neues Installationsprofil angelegt – Ersteinrichtung ausstehend.");
  }
  // 9.12.0: Profile aus 9.11.0 haben keinen Discord-Abschnitt. Eine übernommene Bestandsinstallation bekommt ihre
  // bisherigen Werte einmalig eingetragen; eine neue Installation bleibt leer (Einrichtung in Profil & Branding).
  // 9.13.0: Eine übernommene Bestandsinstallation behält ihre bisherigen Standardtexte (Textpaket „legacy-bwk“, nicht wählbar).
  if(settingsNow.installation&&typeof settingsNow.installation==="object"&&settingsNow.installation.textPack===undefined){
    const migrated=String(settingsNow.installation.source||"").startsWith("migration");
    settingsNow.installation.textPack=migrated?"legacy-bwk":"neutral";
    writeJson(FILES.settings,settingsNow);
    if(migrated)console.log("ℹ️ Bisherige Standardtexte als Textpaket der Installation übernommen (9.13.0).");
  }
  if(settingsNow.installation&&typeof settingsNow.installation==="object"&&!settingsNow.installation.discord){
    const migrated=String(settingsNow.installation.source||"").startsWith("migration");
    settingsNow.installation.discord=migrated?legacyBwk.legacyDiscord():installationKit.normalizeDiscord({});
    writeJson(FILES.settings,settingsNow);
    if(migrated){try{audit("system","installation.profile.discord-migrated",{section:"installation"});}catch{}console.log("ℹ️ Discord-Server und Rollen aus den bisherigen Werten in das Profil übernommen (9.12.0).");}
  }
  // 9.15.0: Bot-Liste. Bestandsinstallation: bisherige fünf Bots mit unveränderten Schlüsseln; neue Installation: neutraler Haupt-Bot.
  if(settingsNow.installation&&typeof settingsNow.installation==="object"&&!settingsNow.installation.bots){
    const migrated=String(settingsNow.installation.source||"").startsWith("migration");
    settingsNow.installation.bots=migrated?legacyBwk.legacyRoster():botRoster.freshRoster();
    writeJson(FILES.settings,settingsNow);
    if(migrated){try{audit("system","installation.profile.bots-migrated",{section:"installation"});}catch{}console.log("ℹ️ Bisherige Bots als Bot-Liste der Installation übernommen (9.15.0).");}
  }
  // 9.22.0: Lizenz (BCC-CL). Eine bestehende Installation (Einrichtung abgeschlossen oder übernommene Bestandsinstallation) gilt als angenommen;
  // das wird einmalig mit Version, Zeitpunkt und Prüfsumme festgehalten. Eine neue Installation nimmt die Lizenz in der Ersteinrichtung an.
  if(settingsNow.installation&&typeof settingsNow.installation==="object"&&!licenseKit.normalizeAcceptance(settingsNow.installation.license)
    &&(settingsNow.installation.setupCompletedAt||String(settingsNow.installation.source||"").startsWith("migration"))){
    const li=licenseInfo();
    settingsNow.installation.license=licenseKit.createAcceptance({version:li.version,sha256:li.sha256,by:"Bestandsinstallation (automatisch)",source:"bestandsinstallation"});
    writeJson(FILES.settings,settingsNow);
    try{audit("system","installation.license.accepted",{section:"installation",license:li.id,version:li.version,sha256:li.sha256,source:"bestandsinstallation"});}catch{}
    console.log(`ℹ️ Lizenz ${li.id} ${li.version} für die bestehende Installation als angenommen vermerkt (9.22.0).`);
  }
  installationCache=installationKit.normalizeInstallation(settingsNow.installation);installationCacheAt=Date.now();
  return installationCache;
}
// 9.22.0: Kenndaten und Prüfsumme der Lizenz (Text unter public/license).
function licenseInfo(){return licenseKit.info(PUBLIC_DIR);}
// 9.12.0: Discord-Werte aus dem Profil (Rollenfunktionen Administrator/Moderator/Member, Bot-Rolle, Server-ID).
function discordProfile(){return installationProfile().discord;}
// An den Discord-Dienst melden; er speichert die Werte und nutzt sie, solange die Umgebung nichts vorgibt.
async function pushDiscordInstallation(){
  const d=discordProfile();
  const result=await discordServiceRequest("/installation",{method:"PUT",body:JSON.stringify({discord:d,textPack:installationProfile().textPack})});
  return result.body||{ok:true};
}
function saveInstallationProfile(next){
  const settingsNow=readJson(FILES.settings,DEFAULT_SETTINGS);
  settingsNow.installation=installationKit.normalizeInstallation(next);
  writeJson(FILES.settings,settingsNow);
  installationCache=settingsNow.installation;installationCacheAt=Date.now();
  try{chatOverlay.refresh();}catch{}   // 9.27.3: geänderte Bilder (Symbole, Textur) sofort an geöffnete Overlay-Quellen melden
  return installationCache;
}
function publicBaseInfo(){return installationKit.resolvePublicBaseUrl({envValue:ENV_PUBLIC_BASE_URL,installation:installationProfile()});}
function publicBaseUrl(){return publicBaseInfo().url;}
function tiktokRedirectUri(){const b=publicBaseUrl();return b?`${b}/auth/tiktok/callback`:"";}
function productName(){return installationProfile().productName;}

const PUBLIC_DIR = "/public";



// Einstellungen für „Sauberer Start“: Standardtexte kommen aus dem Textpaket der Installation (9.13.0).
function cleanSettingsNow(){return textPackKit.clone(textPackKit.get(installationProfile()).cleanSettings);}



function migrateLegacyTwitchWordFilter(){
  if(!pgStore.enabled)return;
  try{
    const snap=pgStore.wordFilterSnapshot();
    if((snap.imports||[]).some(x=>x.import_id==="legacy-twitch-v8"))return;
    const legacy=pgStore.getDocument("settings",DEFAULT_SETTINGS);
    const rows=(legacy.blockedWords||[]).map((x,i)=>({
      term_id:`legacy-twitch-${x.id||i+1}`,
      term:String(x.word||"").trim(),
      category_id:"benutzerdefiniert",
      severity:2,
      detection_type:"substring",
      enabled:x.enabled!==false,
      test_only:false,
      metadata:{legacyAction:x.action||"detect",response:x.response||"",responseBot:x.bot||"",twitchTermId:x.twitchTermId||null},
      platforms:[{platform:"twitch",enabled:x.enabled!==false,action:x.action==="delete"||x.action==="twitch_block"?"delete":"log"},{platform:"discord",enabled:false}]
    })).filter(x=>x.term);
    pgStore.importWordFilter({import_id:"legacy-twitch-v8",source_name:"Legacy Twitch blockedWords",source_license:null,filename:"settings.blockedWords",format:"internal",created_by:"migration",merge_platforms_on_duplicate:true,terms:rows});
    wordFilterRefresh(true);
  }catch(e){console.error("⚠️ Legacy-Twitch-Wortfilter konnte nicht migriert werden:",e.message);}
}
setImmediate(()=>{migrateLegacyTwitchWordFilter();try{if(pgStore.enabled)pgStore.cleanupWordFilterHits();}catch{}});
setInterval(()=>{try{if(pgStore.enabled)pgStore.cleanupWordFilterHits();}catch{}},6*60*60*1000).unref();


function legacyFileSha256(file){
  try{return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");}catch{return null;}
}
function importPgDocument(file,key,fallback={}){
  if(!pgStore.enabled||!fs.existsSync(file))return;
  const value=readLegacyJson(file,fallback);
  const result=pgStore.putDocumentIfAbsent(key,value);
  if(result?.inserted)pgStore.markImport(path.basename(file),legacyFileSha256(file),{kind:"json-document",key});
}

if(pgStore.enabled){
  for(const [file,key] of PG_DOCUMENT_FILES)importPgDocument(file,key,{});
  const legacyWatchtime=readLegacyJson(FILES.watchtime,{users:{}});
  if(Number(pgStore.counts().twitch_watchtime||0)===0 && legacyWatchtime?.users){
    const result=pgStore.importWatchtime(legacyWatchtime.users);
    pgStore.markImport(path.basename(FILES.watchtime),legacyFileSha256(FILES.watchtime),{kind:"relational-watchtime",rows:Number(result?.imported||0)});
  }
  const legacyUsers=pgStore.getDocument("users",readLegacyJson(FILES.users,{users:[]}));
  const userImport=pgStore.importControlUsersIfEmpty(legacyUsers&&Array.isArray(legacyUsers.users)?legacyUsers:{users:[]});
  if(userImport?.inserted)pgStore.markImport(path.basename(FILES.users),legacyFileSha256(FILES.users),{kind:"relational-control-users",rows:Number(legacyUsers?.users?.length||0)});
  const legacySessions=pgStore.getDocument("sessions",readLegacyJson(FILES.sessions,{}));
  const sessionImport=pgStore.importControlSessionsIfEmpty(legacySessions&&typeof legacySessions==="object"&&!Array.isArray(legacySessions)?legacySessions:{});
  if(sessionImport?.inserted)pgStore.markImport(path.basename(FILES.sessions),legacyFileSha256(FILES.sessions),{kind:"relational-control-sessions",rows:Object.keys(legacySessions||{}).length});
  const legacyBridge=pgStore.getDocument("discord-bridge",readLegacyJson(FILES.discordBridge,{queue:[],lastDeliveredAt:null,lastError:null}));
  const bridgeImport=pgStore.importDiscordBridgeStateIfEmpty(legacyBridge&&typeof legacyBridge==="object"?legacyBridge:{queue:[],lastDeliveredAt:null,lastError:null});
  if(bridgeImport?.inserted)pgStore.markImport("discord-bridge-relational",legacyFileSha256(FILES.discordBridge),{kind:"relational-state",source:pgStore.hasDocument("discord-bridge")?"postgres-jsonb":"discord-bridge.json"});
  const legacyFollowers=pgStore.getDocument("follower-cache",readLegacyJson(FILES.followerCache,{items:[],total:0,updatedAt:null}));
  const followerImport=pgStore.importFollowerCacheIfEmpty(legacyFollowers&&typeof legacyFollowers==="object"?legacyFollowers:{items:[],total:0,updatedAt:null});
  if(followerImport?.inserted)pgStore.markImport("follower-cache-relational",legacyFileSha256(FILES.followerCache),{kind:"relational-follower-cache",rows:Number(followerImport?.rows||0),source:pgStore.hasDocument("follower-cache")?"postgres-jsonb":"follower-cache.json"});
  const legacyClips=pgStore.getDocument("clip-state",readLegacyJson(FILES.clipState,{initialized:false,seen:{},lastCheckedAt:null,lastShared:null,lastError:null}));
  const clipImport=pgStore.importClipStateIfEmpty(legacyClips&&typeof legacyClips==="object"?legacyClips:{initialized:false,seen:{},lastCheckedAt:null,lastShared:null,lastError:null});
  if(clipImport?.inserted)pgStore.markImport("clip-state-relational",legacyFileSha256(FILES.clipState),{kind:"relational-clip-state",rows:Number(clipImport?.rows||0),source:pgStore.hasDocument("clip-state")?"postgres-jsonb":"clip-state.json"});
  const legacyUsage=pgStore.getDocument("usage-stats",readLegacyJson(FILES.usageStats,{commands:{},autoReplies:{},updatedAt:null}));
  const usageImport=pgStore.importUsageStatsIfEmpty(legacyUsage&&typeof legacyUsage==="object"?legacyUsage:{commands:{},autoReplies:{},updatedAt:null});
  if(usageImport?.inserted)pgStore.markImport("usage-stats-relational",legacyFileSha256(FILES.usageStats),{kind:"relational-usage-stats",rows:Number(usageImport?.rows||0),source:pgStore.hasDocument("usage-stats")?"postgres-jsonb":"usage-stats.json"});
  const legacyDiscordAnalytics=pgStore.getDocument("discord-analytics",readLegacyJson(FILES.discordAnalytics,{snapshots:[],updatedAt:null}));
  const analyticsImport=pgStore.importDiscordAnalyticsIfEmpty(legacyDiscordAnalytics&&typeof legacyDiscordAnalytics==="object"?legacyDiscordAnalytics:{snapshots:[],updatedAt:null});
  if(analyticsImport?.inserted)pgStore.markImport("discord-analytics-relational",legacyFileSha256(FILES.discordAnalytics),{kind:"relational-discord-analytics",rows:Number(analyticsImport?.rows||0),source:pgStore.hasDocument("discord-analytics")?"postgres-jsonb":"discord-analytics.json"});
}


// 8.9.16 · Entkopplung 1b: Übergabestelle Twitch-Laufzeit → Web-Kern (Overlays), siehe /shared/twitch-event-hub.js
const {createTwitchEventHub}=require("/shared/twitch-event-hub");
const twitchEvents=createTwitchEventHub();



// Einmalige Datenmigration des früheren Beispiel-Commands. Sie läuft auch nach
// einem bereits erfolgten PostgreSQL-Import gegen den jeweils aktiven Speicher.
try {
  const current = readJson(FILES.settings,DEFAULT_SETTINGS);
  if (Array.isArray(current.commands)) {
    const before = current.commands.length;
    current.commands = current.commands.filter(
      x => String(x?.command || "").trim().toLowerCase() !== "!beratung"
    );
    if (current.commands.length !== before) {
      writeJson(FILES.settings,current);
      console.log("✅ Legacy-Command !beratung entfernt.");
    }
  }
} catch (e) {
  console.error("⚠️ Legacy-Command-Migration fehlgeschlagen:", e.message);
}


function authLog({platform="Unbekannt",username="unbekannt",userId=null,result="failed",reason=null,source=null,detail={}}={}) {
  const entry={ts:new Date().toISOString(),platform:String(platform||"Unbekannt"),username:String(username||"unbekannt"),userId:userId?String(userId):null,result:String(result||"failed"),reason:reason?String(reason):null,source:source?String(source):null,detail:detail&&typeof detail==="object"?detail:{}};
  if(pgStore.enabled){pgStore.appendEvent("auth",entry);return;}
  fs.appendFileSync(FILES.authLog,JSON.stringify(entry)+"\n",{mode:0o600});
}
function isAuthAuditAction(action){
  const a=String(action||"");
  return a.startsWith("login.")||a.startsWith("discord.login.");
}
function authResultFromAction(action){
  const a=String(action||"");
  if(a.endsWith(".success")) return "success";
  if(a.endsWith(".denied")) return "denied";
  if(a.endsWith(".logout")) return "logout";
  return "failed";
}
function migrateLegacyAuthLogs(){
  if(fs.existsSync(FILES.authLog)) return;
  let old=[];
  try{
    old=fs.readFileSync(FILES.audit,"utf8").split("\n").filter(Boolean)
      .map(line=>{try{return JSON.parse(line)}catch{return null}})
      .filter(Boolean).filter(x=>isAuthAuditAction(x.action));
  }catch{}
  const rows=old.map(x=>{
    const d=x.detail||{},a=String(x.action||"");
    const platform=a.startsWith("discord.")?"Discord":String(d.source||"").includes("local")?"Lokal":"Twitch";
    return JSON.stringify({ts:x.ts||new Date().toISOString(),platform,username:String(x.user||"unbekannt"),userId:d.discordUserId||d.twitchUserId||null,result:authResultFromAction(a),reason:d.reason||d.error||null,source:d.source||null,detail:{migrated:true}});
  });
  fs.writeFileSync(FILES.authLog,rows.length?rows.join("\n")+"\n":"",{mode:0o600});
}
migrateLegacyAuthLogs();

if(pgStore.enabled){
  if(pgStore.queryEvents("audit",1).length===0){const rows=readLegacyJsonl(FILES.audit);if(rows.length){const r=pgStore.importEvents("audit",rows);pgStore.markImport(path.basename(FILES.audit),legacyFileSha256(FILES.audit),{kind:"event-stream",stream:"audit",rows:Number(r?.inserted||0)});}}
  if(pgStore.queryEvents("auth",1).length===0){const rows=readLegacyJsonl(FILES.authLog);if(rows.length){const r=pgStore.importEvents("auth",rows);pgStore.markImport(path.basename(FILES.authLog),legacyFileSha256(FILES.authLog),{kind:"event-stream",stream:"auth",rows:Number(r?.inserted||0)});}}
  try{pgStore.cleanupEventSub(90);}catch(e){console.warn("⚠️ EventSub-Deduplizierungsbereinigung:",e.message);}
}

function readAuthLog(){
  if(pgStore.enabled)return pgStore.queryEvents("auth",50000);
  try{
    return fs.readFileSync(FILES.authLog,"utf8").split("\n").filter(Boolean)
      .map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean).reverse();
  }catch{return[];}
}
function queryAuthLog({page=1,pageSize=100,platform="",result="",search=""}={}){
  const raw=readAuthLog();
  // PostgreSQL liefert bereits absteigend; JSON wird oben ebenfalls normalisiert.
  let items=[...raw];
  const q=String(search||"").trim().toLowerCase();
  items=items.filter(x=>{
    if(platform&&String(x.platform)!==platform)return false;
    if(result&&String(x.result)!==result)return false;
    if(q&&!`${x.username||""} ${x.userId||""} ${x.reason||""}`.toLowerCase().includes(q))return false;
    return true;
  });
  const ps=Math.min(100,Math.max(1,Number(pageSize||100)));
  const total=items.length,totalPages=Math.max(1,Math.ceil(total/ps)),pg=Math.min(totalPages,Math.max(1,Number(page||1))),from=(pg-1)*ps;
  return{items:items.slice(from,from+ps),total,page:pg,pageSize:ps,totalPages,file:pgStore.enabled?null:safeFileInfo(FILES.authLog),storage:pgStore.enabled?"postgres":"jsonl",allEntries:raw.length,facets:{platforms:[...new Set(raw.map(x=>x.platform).filter(Boolean))].sort(),results:[...new Set(raw.map(x=>x.result).filter(Boolean))].sort()}};
}
function deleteAuthLogsOlderThan(days=30){
  if(pgStore.enabled)return{...pgStore.deleteEventsOlderThan("auth",days),file:null,storage:"postgres"};
  const cutoff=Date.now()-Math.max(1,Number(days||30))*86400000;
  const all=readAuthLog();
  const keep=all.filter(x=>{const ts=Date.parse(x.ts||"");return !Number.isFinite(ts)||ts>=cutoff;});
  const removed=all.length-keep.length;
  // readAuthLog liefert neueste zuerst; für JSONL wieder chronologisch schreiben.
  const chron=[...keep].reverse();
  fs.writeFileSync(FILES.authLog,chron.map(x=>JSON.stringify(x)).join("\n")+(chron.length?"\n":""),{mode:0o600});
  return{removed,remaining:keep.length,file:safeFileInfo(FILES.authLog),storage:"jsonl"};
}


function itemLabel(section, item) {
  if (!item) return "";
  if (section === "commands") return item.command || "(Command)";
  if (section === "timers") return item.description || item.text || "(Timer)";
  if (section === "greetings") return item.login || "(Begrüßung)";
  if (section === "blockedWords") return item.word || "(Wort/Phrase)";
  if (section === "autoReplies") return item.name || item.trigger || "(Auto-Reply)";
  return item.id || "";
}

function logSettingsDiff(user, before, after) {
  const sections = ["commands", "timers", "greetings", "blockedWords", "autoReplies"];

  for (const section of sections) {
    const oldList = Array.isArray(before?.[section]) ? before[section] : [];
    const newList = Array.isArray(after?.[section]) ? after[section] : [];

    const oldMap = new Map(oldList.map(x => [x.id, x]));
    const newMap = new Map(newList.map(x => [x.id, x]));

    for (const [id, item] of newMap) {
      if (!oldMap.has(id)) {
        audit(user, "item.created", {
          section,
          label: itemLabel(section, item),
          after: item
        });
      } else {
        const oldItem = oldMap.get(id);
        if (JSON.stringify(oldItem) !== JSON.stringify(item)) {
          audit(user, "item.updated", {
            section,
            label: itemLabel(section, item),
            before: oldItem,
            after: item
          });
        }
      }
    }

    for (const [id, item] of oldMap) {
      if (!newMap.has(id)) {
        audit(user, "item.deleted", {
          section,
          label: itemLabel(section, item),
          before: item
        });
      }
    }
  }

  const oldEvents = before?.events || {};
  const newEvents = after?.events || {};
  for (const key of ["follow", "raid"]) {
    if (JSON.stringify(oldEvents[key] || {}) !== JSON.stringify(newEvents[key] || {})) {
      audit(user, "event.updated", {
        section: "events",
        label: key,
        before: oldEvents[key] || null,
        after: newEvents[key] || null
      });
    }
  }

  if (JSON.stringify(before?.lurkReturn || {}) !== JSON.stringify(after?.lurkReturn || {})) {
    audit(user, "event.updated", {
      section: "events",
      label: "lurkReturn",
      before: before?.lurkReturn || null,
      after: after?.lurkReturn || null
    });
  }

  const oldModeration = before?.moderation || {};
  const newModeration = after?.moderation || {};

  const fieldLabels = {
    enabled: "Aktiv",
    whitelistDomains: "Domain-Whitelist",
    whitelistUsers: "User-Whitelist",
    exemptModerators: "Moderatoren ausnehmen",
    exemptBroadcaster: "Kanalinhaber ausnehmen",
    reactionBot: "Reagierender Bot",
    timeoutEnabled: "Timeout aktiv",
    timeoutSeconds: "Timeout-Dauer",
    warningSeconds: "Verzögerung vor Timeout",
    timeoutMessageEnabled: "Hinweis-Nachricht aktiv",
    timeoutMessage: "Hinweis-Nachricht",
    limit: "Limit"
  };

  const groupLabels = {
    global: "Globale Ausnahmen",
    links: "Links",
    emotes: "Zu viele Emotes",
    symbols: "Zu viele Sonderzeichen",
    caps: "Zu viele Großbuchstaben"
  };

  for (const group of ["global", "links", "emotes", "symbols", "caps"]) {
    const oldGroup = oldModeration[group] || {};
    const newGroup = newModeration[group] || {};

    const keys = new Set([
      ...Object.keys(oldGroup),
      ...Object.keys(newGroup)
    ]);

    for (const key of keys) {
      const beforeValue = oldGroup[key];
      const afterValue = newGroup[key];

      if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;

      audit(user, "moderation.field.updated", {
        section: "moderation",
        group,
        groupLabel: groupLabels[group] || group,
        field: key,
        fieldLabel: fieldLabels[key] || key,
        before: beforeValue ?? null,
        after: afterValue ?? null
      });
    }
  }
}

function auditSection(item) {
  if (String(item?.action || "").startsWith("user.access.")) return "users";
  return item?.detail?.section || "";
}

function queryAudit({
  type="changes",
  platform="twitch",
  page=1,
  pageSize=100,
  user="",
  section="",
  action=""
}={}) {
  let items=[];
  if(pgStore.enabled){
    try{items=pgStore.queryEvents("audit",50000)}catch{items=[];}
  }else{
    try{
      items=fs.readFileSync(FILES.audit,"utf8").split("\n").filter(Boolean)
        .map(line=>{try{return JSON.parse(line)}catch{return null}})
        .filter(Boolean);
      items.reverse();
    }catch{items=[];}
  }
  items=items.filter(item=>item.action!=="settings.saved").filter(item=>!isAuthAuditAction(item.action));
  const auditPlatform=item=>String(item?.action||"").startsWith("discord.")||String(item?.detail?.section||"").startsWith("discord")?"discord":"twitch";
  const platformItems=items.filter(item=>platform==="all"||auditPlatform(item)===platform);
  const facets={
    users:[...new Set(platformItems.map(x=>x.user).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"de")),
    actions:[...new Set(platformItems.map(x=>x.action).filter(Boolean))].sort(),
    sections:[...new Set(platformItems.map(x=>auditSection(x)).filter(Boolean))].sort()
  };
  const filtered=platformItems.filter(item=>{
    if(user&&item.user!==user)return false;
    if(action&&item.action!==action)return false;
    if(section&&auditSection(item)!==section)return false;
    return true;
  });
  const ps=Math.min(100,Math.max(1,Number(pageSize||100)));
  const total=filtered.length,totalPages=Math.max(1,Math.ceil(total/ps)),pg=Math.min(totalPages,Math.max(1,Number(page||1))),from=(pg-1)*ps;
  return{items:filtered.slice(from,from+ps),total,page:pg,pageSize:ps,totalPages,facets,platform};
}





// 8.9.20 · Entkopplung 3a: Stammdaten der Twitch-Konten sind feste Konfiguration (gemeinsames Modul).
const {publicTwitchAccounts} = require("/shared/twitch-accounts");
// 9.15.0: Konten und Bots kommen aus der Bot-Liste der Installation (Profil & Branding), nicht mehr fest aus dem Code.
const botRoster = require("/shared/bot-roster");
const botRosterNow = () => installationProfile().bots;
const twitchAccounts = () => publicTwitchAccounts(CHANNEL_LOGIN, botRosterNow(), {subathon:moduleOn("subathon"),redemptions:moduleOn("chatOverlay")&&chatOverlayRedeemWanted()});
// Kanal-Login: Umgebung (TWITCH_CHANNEL_LOGIN) vor Profil. Er bestimmt auch, wer Besitzer ist.
const channelLoginNow = () => CHANNEL_LOGIN || botRosterNow().channel.login || "";
// Für Vergleiche: ist kein Kanal-Login gesetzt, passt kein Benutzer (leer darf nie Besitzer ergeben).
const channelLoginCmp = () => channelLoginNow() || "\u0000kein-kanal";
const twitchAccount = name => twitchAccounts().find(a=>a.key===name)||null;
const mainBotKeyNow = () => botRoster.mainBot(botRosterNow()).key;
const botForRoleNow = role => botRoster.defaultBotFor(botRosterNow(), role);
// Wortfilter geändert: eigenen Stand sofort neu laden und den Twitch-Bot benachrichtigen. Erreicht
// die Nachricht ihn nicht, lädt er spätestens nach 5 Sekunden selbst nach.
async function wordFilterChanged(){
  const compiled=wordFilterRefresh(true);
  try{await twitchRuntime.wordFilterChanged();}catch(e){console.warn("⚠️ Wortfilter-Hinweis an die Twitch-Laufzeit fehlgeschlagen:",e.message);}
  return compiled;
}

// 8.9.21 · Entkopplung 3b: Datenfunktionen (Gewinnspiel, Einstellungen/Team, Nutzungsstatistik,
// Watchtime, Clips) liegen in /shared/twitch-data.js; sie brauchen keine laufende Twitch-Verbindung.
const { createTwitchData } = require("/shared/twitch-data");
// 9.1.0: Lurk-Rückkehr-Einstellungen (settings.lurkReturn) bekommen beim Lesen/Speichern ihre Standardwerte.
const { normalizeLurkSettings } = require("/shared/lurk-return");
// 9.1.1: Zentrale Modulregistrierung (Schieberegler unter Administration → Integrationen → Module).
const { normalizeModuleSettings, isModuleEnabled, setModuleEnabled, describeModules, getModule, isKnownModule, routeModule, normalizeWordFilterActive, wordFilterActiveFor } = require("/shared/modules");
// 9.6.0: Steuerstand für den Discord-Bot (Module + Schalter, die der Discord-Bot selbst nicht lesen kann).
function controlFeatures(settings){return {wordFilterDiscord:wordFilterActiveFor(settings,"discord")};}
function pushControlStateToDiscord(reason){
  const s=currentModuleSettings();normalizeWordFilterActive(s);
  discordServiceRequest("/internal/modules",{method:"PUT",body:JSON.stringify({modules:s.modules,features:controlFeatures(s)})}).catch(e=>console.warn(`⚠️ Steuerstand an Discord-Bot (${reason}):`,e?.message||e));
}
// 9.2.0: aktueller Modulstand (frisch aus den Einstellungen, damit Schalter sofort wirken).
function currentModuleSettings(){const s=readJson(FILES.settings,DEFAULT_SETTINGS);normalizeModuleSettings(s);return s;}
function moduleOn(id){return isModuleEnabled(currentModuleSettings(),id);}
// Nur registrierte, ausgeschaltete Module gelten als „aus“ (unbekannte Kennungen werden nicht angefasst).
function moduleOff(id){return isKnownModule(id)&&!moduleOn(id);}
// Leere, transparente Seite für OBS-Quellen ausgeschalteter Module (Entscheidung Mario 16.11.2026).
const EMPTY_OVERLAY_HTML='<!doctype html><html lang="de"><head><meta charset="utf-8"><title></title><style>html,body{margin:0;background:transparent}</style></head><body></body></html>';
const twitchData = createTwitchData({
  FILES, DEFAULT_SETTINGS, pgStore, giveawayStore, readJson, writeJson, audit,
  getStreamInfo: () => twitchRuntime.streamInfo()
});
const {
  twitchBlockedTermsChanged, readGiveawayState, writeGiveawayState, publicGiveaway, archiveCurrentGiveaway,
  giveawayStartMessage, giveawayWinnerMessage, prepareSettings, readUsageStats, buildUsageStatsView,
  readWatchtime, queryWatchtime, setWatchtimeSeconds, normalizeClipSettings, readClipState
} = twitchData;

// 9.0.0 · Entkopplung abgeschlossen: Der Twitch-Bot läuft immer als eigener Dienst (twitch-app/twitch-server.js).
// Dieser Prozess enthält keinen Bot mehr und spricht ihn über das interne Netz an (Schnittstelle twitchRuntime).
// Den früheren Betrieb mit dem Bot in diesem Prozess gibt es nicht mehr.
// TWITCH_SERVICE_URL: Adresse des Twitch-Bots im Docker-Netz; fehlt sie, gilt der Standard des Compose-Projekts.
// Eine gesetzte, aber ungültige Adresse beendet den Start (ein Tippfehler soll nicht unbemerkt bleiben).
const { parseInternalBaseUrl } = require("/shared/internal-url");
const twitchLink = require("/shared/twitch-link");
const TWITCH_SERVICE_DEFAULT_URL = "http://twitch:3002";
const TWITCH_SERVICE_URL = (() => {
  const raw = String(process.env.TWITCH_SERVICE_URL || "").trim();
  if (!raw) console.warn(`⚠️ TWITCH_SERVICE_URL ist nicht gesetzt; verwendet wird ${TWITCH_SERVICE_DEFAULT_URL}.`);
  const parsed = parseInternalBaseUrl(raw || TWITCH_SERVICE_DEFAULT_URL);
  if (!parsed.ok) { console.error(`❌ TWITCH_SERVICE_URL ist ungültig (${parsed.reason}). Start abgebrochen.`); process.exit(1); }
  if (!twitchLink.secretUsable(INTERNAL_SERVICE_SECRET)) { console.error("❌ Die Verbindung zum Twitch-Bot braucht ein gültiges INTERNAL_SERVICE_SECRET. Start abgebrochen."); process.exit(1); }
  return parsed.url;
})();
const twitchRuntime = twitchLink.createRemoteTwitchRuntime({ baseUrl: TWITCH_SERVICE_URL, secret: INTERNAL_SERVICE_SECRET });
const twitchEventFirstTime = twitchLink.createEventDeduper();


// 8.9.10: Updates-Seite (Pull-Deployment). Der Dienst wird weiter unten nach discordServiceRequest angelegt.
const {createUpdateService} = require("/shared/update-service");

function parseCookies(req) {
  const out={};
  for(const part of String(req.headers.cookie||"").split(";")){
    const p=part.trim();if(!p)continue;
    const i=p.indexOf("=");if(i<=0)continue;
    const key=p.slice(0,i).trim(),raw=p.slice(i+1);
    try{out[key]=decodeURIComponent(raw);}catch{continue;}
  }
  return out;
}

// ===== Ende Schnittstelle Twitch-Laufzeit =====

// ===== 8.9.16 · Entkopplung 1b: Overlay-Module gehören zum Web-Kern =====
// Sie erhalten Ereignisse der Twitch-Laufzeit nur über twitchEvents und sprechen die
// Twitch-Laufzeit nur über twitchRuntime an (Followathon wird weiter unten erzeugt).
const followerAlert = createFollowerAlert({
  read:()=>readJson(FILES.followerAlert,{}),
  write:value=>writeJson(FILES.followerAlert,value)
});
// 9.27.0: Chat-Overlay. Abzeichen-Bilder werden mit dem App-Token von Twitch geholt und zwischengespeichert.
const chatBadgeCache = createBadgeCache({
  fetchJson: async url => { const r = await twitchAppFetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
  channelId: async () => await twitchRuntime.channelId()
});
// 9.27.2: Kanalpunkte-Karten brauchen ein zusätzliches Recht des Kanal-Kontos; nur anfordern, wenn die Karte eingeschaltet ist.
function chatOverlayRedeemWanted(){try{return chatOverlay.getConfig().redeemCards===true;}catch{return false;}}
const chatOverlay = createChatOverlay({
  read:()=>readJson(FILES.chatOverlay,{}),
  write:value=>writeJson(FILES.chatOverlay,value),
  badges:chatBadgeCache,
  // 9.27.3: eigene Symbole und Textur aus den Bildplätzen der Installation
  images:()=>{const b=brandingImages();return Object.fromEntries(imageKit.CHAT_OVERLAY_SLOTS.filter(k=>b[k]?.mode==="upload").map(k=>[k,b[k].url]));}
});
const stubenkontrolle = createStubenkontrolle({
  dataDir:DATA_DIR,
  storage:pgStore,
  storageKey:"stubenkontrolle",
  sendChat:(...a)=>twitchRuntime.sendChat(...a),
  audit,
  resolveUser:login=>twitchRuntime.findUserByLogin(login),
  isActive:()=>moduleOn("stubenkontrolle"), // 9.3.0: Modulschalter (Overlay-Anschluss)
  // 9.10.0: Twitch-Konten der Control-Center-Owner (für !gift, falls in den Einstellungen freigegeben).
  controlOwnerTwitchIds:()=>(readUsers().users||[]).filter(x=>x&&x.enabled!==false&&(x.globalOwner||x.role==="owner")&&x.twitchUserId).map(x=>String(x.twitchUserId)),
  // 9.11.0: Spielname, Punktename und anpassbare Befehle aus dem Installationsprofil; Overlay-Adresse aus der öffentlichen Adresse.
  naming:()=>installationProfile().game,
  textPack:()=>textPackKit.get(installationProfile()),
  publicBaseUrl:()=>publicBaseUrl()
});
stubenkontrolle.ensureFile();
// 9.3.0: Modul aus → false, die Nachricht geht an die normale Command-Verarbeitung weiter.
twitchEvents.registerChatCommands(STUBENKONTROLLE_CHAT_COMMANDS,"Stubenkontrolle",(ev,msg)=>moduleOn("stubenkontrolle")?stubenkontrolle.handleChat(ev,msg):false);
// 9.11.0: Die vier anpassbaren Spielbefehle (Runde, Kontostand, Rangliste, Hilfe) kommen aus dem Installationsprofil.
twitchEvents.registerDynamicChatCommands(()=>Object.values(installationProfile().game.commands),"Stubenkontrolle",(ev,msg)=>moduleOn("stubenkontrolle")?stubenkontrolle.handleChat(ev,msg):false);
twitchEvents.on("follow","Follower-Alert",({event})=>{if(!moduleOn("followerAlert"))return;return followerAlert.handleFollow(event);}); // 9.2.0: Modulschalter
// 9.27.0: Chat-Overlay (Modulschalter). Nachrichten, gesendete Bot-Nachrichten und Löschereignisse kommen vom Twitch-Bot.
twitchEvents.on("chat","Chat-Overlay",payload=>{if(!moduleOn("chatOverlay"))return;return chatOverlay.handleChat(payload);});
twitchEvents.on("chat-sent","Chat-Overlay",payload=>{if(!moduleOn("chatOverlay"))return;return chatOverlay.handleBotMessage(payload);});
twitchEvents.on("chat-delete","Chat-Overlay",payload=>{if(!moduleOn("chatOverlay"))return;return chatOverlay.handleDelete(payload);});
// 9.27.1: Ereigniskarten im Chat-Overlay. Die Kennung stammt aus den Metadaten der Twitch-Nachricht (dedupliziert Wiederholungen).
const chatOverlayEvent=(kind,{event,metadata})=>{if(!moduleOn("chatOverlay"))return;const id=String(metadata?.message_id||`${kind}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`).replace(/[^A-Za-z0-9_-]/g,"").slice(0,64);return chatOverlay.handleEvent(compactChatEventCard(kind,event,id));};
twitchEvents.on("follow","Chat-Overlay-Follow",payload=>chatOverlayEvent("follow",payload));
twitchEvents.on("raid","Chat-Overlay-Raid",payload=>chatOverlayEvent("raid",payload));
// 9.27.2: Abos (Chat-Benachrichtigung), Bits (Cheer-Nachricht) und Kanalpunkte (Kanal-Konto, nur mit Recht channel:read:redemptions)
twitchEvents.on("chat-notice","Chat-Overlay-Abo",payload=>chatOverlayEvent("notice",payload));
twitchEvents.on("chat-bits","Chat-Overlay-Bits",payload=>chatOverlayEvent("bits",payload));
twitchEvents.on("chat-redeem","Chat-Overlay-Kanalpunkte",payload=>chatOverlayEvent("redeem",payload));
// 9.2.0: Laufende Vorgänge, die das Ausschalten eines Moduls sperren. Rückgabe = Meldung oder null.
const MODULE_BUSY_CHECKS={
  giveaway:()=>{try{return readGiveawayState()?.current?.active?"Ein Gewinnspiel läuft noch. Bitte erst beenden, dann das Modul ausschalten.":null;}catch{return null;}},
  // 9.3.0 (followathon/stubenkontrolle werden später im Code erzeugt; Aufruf erst beim Schalten)
  followathon:()=>{try{const st=followathon.getPublicState();return st?.exists&&(st.status==="running"||st.status==="paused")?"Ein Followathon läuft oder ist pausiert. Bitte erst beenden, dann das Modul ausschalten.":null;}catch{return null;}},
  subathon:()=>{try{const st=subathon.getPublicState();return st?.exists&&(st.status==="running"||st.status==="paused")?"Ein Subathon läuft oder ist pausiert. Bitte erst beenden, dann das Modul ausschalten.":null;}catch{return null;}},
  stubenkontrolle:()=>{try{const r=stubenkontrolle.summary()?.activeRound;return r&&(r.status==="open"||r.status==="control")?`Eine Runde ${(()=>{try{return installationProfile().game.name;}catch{return "des Spiels";}})()} läuft noch. Bitte erst abwarten, dann das Modul ausschalten.`:null;}catch{return null;}}
};
// V8.6.6: Client-IP- und Lokalitätslogik liegt in /shared/client-ip.js (testbar, ohne process.env).
// Host-Header allein gilt nicht mehr als Herkunftsnachweis; X-Forwarded-For wird nur von
// vertrauten Proxys und von rechts ausgewertet.
const clientNet=createClientIpResolver({
  trustedProxyCidrs:TRUSTED_PROXY_CIDRS,
  localNetworkCidrs:LOCAL_NETWORK_CIDRS,
  hostFallback:LOCAL_ADMIN_HOST_FALLBACK
});
function peerIp(req){return clientNet.peerIp(req);}
function trustedProxy(req){return clientNet.trustedProxy(req);}
function clientIp(req){return clientNet.clientIp(req);}
function isLocalRequest(req){return clientNet.isLocalRequest(req);}
function requestIsHttps(req){
  if(req.socket?.encrypted)return true;
  try{
    const configured=publicBaseUrl()?new URL(publicBaseUrl()):null;
    const host=String(req.headers.host||"").toLowerCase().split(":")[0];
    if(configured?.protocol==="https:"&&configured.hostname.toLowerCase()===host)return true;
  }catch{}
  return trustedProxy(req)&&String(req.headers["x-forwarded-proto"]||"").toLowerCase()==="https";
}
function hostAllowed(req){
  const host=String(req.headers.host||"").toLowerCase().split(":")[0];
  if(!host)return false;
  // 9.11.0: Solange die Ersteinrichtung offen ist, gibt es noch keine Adresse zum Vergleichen (z. B. VPS über IP
  // oder Domain). Zugriff auf die Einrichtung schützt der Einrichtungscode.
  if(setupPendingNow())return true;
  if(!ALLOWED_HOSTS.size){
    try{if(publicBaseUrl()&&host===new URL(publicBaseUrl()).hostname.toLowerCase())return true;}catch{}
    if(isLocalRequest(req))return true;
    return false;
  }
  return ALLOWED_HOSTS.has(host);
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}
function sessionCookie(req,sid,maxAge=43200){
  const secure=requestIsHttps(req);
  return`bwksid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?"; Secure":""}`;
}
function oauthTransactionCookie(req,value,maxAge=600){
  const secure=requestIsHttps(req);
  return`bwkoauth=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?"; Secure":""}`;
}
function clearOauthTransactionCookie(req){return oauthTransactionCookie(req,"",0);}
function csrfRequestAllowed(req){
  if(!["POST","PUT","PATCH","DELETE"].includes(req.method))return true;
  const fetchSite=String(req.headers["sec-fetch-site"]||"").toLowerCase();if(fetchSite==="cross-site")return false;
  const origin=String(req.headers.origin||"");if(!origin)return true;
  try{const o=new URL(origin);return o.host===String(req.headers.host||"");}catch{return false;}
}
function securityHeaders(req){
  const pathname=String(req.url||"/").split("?")[0];
  const headers={
    "X-Content-Type-Options":"nosniff",
    "X-Frame-Options":"DENY",
    "Referrer-Policy":"no-referrer",
    "Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    ...csp.cspHeaders(pathname,{publicBaseUrl:publicBaseUrl()})
  };
  if(requestIsHttps(req))headers["Strict-Transport-Security"]="max-age=31536000";
  return headers;
}
class HttpInputError extends Error{constructor(message,status=400){super(message);this.status=status;}}
async function readBody(req,maxBytes=JSON_BODY_LIMIT){
  const declared=Number(req.headers["content-length"]||0);
  if(Number.isFinite(declared)&&declared>maxBytes)throw new HttpInputError("Request ist zu groß.",413);
  const chunks=[];let total=0;
  for await(const c of req){
    total+=c.length;if(total>maxBytes)throw new HttpInputError("Request ist zu groß.",413);
    chunks.push(c);
  }
  if(!total)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new HttpInputError("Ungültiges JSON.",400);}
}
function sessionStore(){const data=pgStore.enabled?pgStore.getControlSessions():readJson(FILES.sessions,{});return data&&typeof data==="object"&&!Array.isArray(data)?data:{};}
const { sessionKey, sessionRawFor, migrateSessions } = require("/shared/session-keys");
// Einmalig beim Start und stündlich: Altbestand (Klartext-IDs) auf Hash-Schlüssel umstellen, Abgelaufenes entfernen.
function migrateAndPruneSessions(){
  const result=migrateSessions(sessionStore(),SESSION_MAX_AGE_MS);
  if(result.migrated||result.pruned)writeSessions(result.sessions);
  return {migrated:result.migrated,pruned:result.pruned,remaining:result.remaining};
}
function writeSessions(data){
  const sessions=data&&typeof data==="object"&&!Array.isArray(data)?data:{};
  if(pgStore.enabled){pgStore.replaceControlSessions(sessions);return;}
  // N-7: früher rief sich diese Funktion im Dateimodus selbst auf (Endlosrekursion).
  writeJson(FILES.sessions,sessions);
}
function invalidateSessionsForManaged(managed){
  if(!managed)return 0;
  const sessions=sessionStore();let removed=0;
  for(const [sid,raw] of Object.entries(sessions)){
    const sameTwitch=managed.twitchUserId&&String(raw?.id||"")===String(managed.twitchUserId);
    const sameDiscord=managed.discordUserId&&String(raw?.discordId||"")===String(managed.discordUserId);
    const sameInternal=managed.id&&String(raw?.internalUserId||"")===String(managed.id);
    if(sameTwitch||sameDiscord||sameInternal){delete sessions[sid];removed++;}
  }
  if(removed)writeSessions(sessions);
  return removed;
}
function invalidateAllSessions(reason="security-migration"){
  const sessions=sessionStore(),count=Object.keys(sessions).length;
  if(count)writeSessions({});
  audit("system","sessions.invalidated",{reason,count});
  return count;
}
const ROLE_LEVEL = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const EXTERNAL_ROLE_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
const SECURITY_SESSION_REVISION = 2;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_MAX = 200;
const JSON_BODY_LIMIT = 1024 * 1024;
// 9.14.1: Bilder (bis 4 × 5 MB, als Base64 etwa ein Drittel größer) sind Teil der Sicherung.
const BACKUP_BODY_LIMIT = 64 * 1024 * 1024;

const ACCESS_CATALOG = [
  {group:"Dashboard",key:"twitch-dashboard",label:"Dashboard",view:"twitch.dashboard.view"},
  {group:"Automatisierung",key:"commands",label:"Commands",view:"twitch.commands.view",edit:"twitch.commands.edit"},
  {group:"Automatisierung",key:"timers",label:"Timer",view:"twitch.timers.view",edit:"twitch.timers.edit"},
  {group:"Automatisierung",key:"autoreplies",label:"Auto-Replies",view:"twitch.autoreplies.view",edit:"twitch.autoreplies.edit"},
  {group:"Community",key:"community",label:"Community",view:"twitch.community.view",edit:"twitch.community.edit"},
  {group:"Community",key:"watchtime",label:"Watchtime",view:"twitch.watchtime.view",edit:"twitch.watchtime.edit"},
  {group:"Community",key:"followage",label:"Followage",view:"twitch.followage.view"},
  {group:"Community",key:"team",label:"Team",view:"twitch.team.view",edit:"twitch.team.edit"},
  {group:"Live-Betrieb",key:"eventprofiles",label:"Event-Profile",view:"twitch.eventprofiles.view",edit:"twitch.eventprofiles.edit"},
  {group:"Live-Betrieb",key:"followathon",label:"Followathon",view:"twitch.followathon.view",edit:"twitch.followathon.edit"},
  {group:"Live-Betrieb",key:"subathon",label:"Subathon",view:"twitch.subathon.view",edit:"twitch.subathon.edit"},
  {group:"Live-Betrieb",key:"stubenkontrolle",label:"Stubenkontrolle",view:"twitch.stubenkontrolle.view",edit:"twitch.stubenkontrolle.edit"},
  {group:"Live-Betrieb",key:"clips",label:"Clips",view:"twitch.clips.view",edit:"twitch.clips.edit"},
  {group:"Moderation",key:"moderation",label:"Chat-Filter",view:"twitch.moderation.view",edit:"twitch.moderation.edit"},
  {group:"Moderation",key:"blocked",label:"Verbotene Wörter",view:"twitch.blocked.view",edit:"twitch.blocked.edit"},
  {group:"Gewinnspiel",key:"giveaway",label:"Gewinnspiel",view:"twitch.giveaway.view",edit:"twitch.giveaway.edit"},
  {group:"Auswertung",key:"statistics",label:"Statistiken",view:"twitch.statistics.view"},
  {group:"Auswertung",key:"activity",label:"Activity Board",view:"twitch.activity.view"},
  {group:"Discord",key:"discord-dashboard",label:"Übersicht",view:"discord.dashboard.view"},
  {group:"Discord",key:"discord-channels",label:"Kanäle",view:"discord.channels.view",edit:"discord.channels.edit"},
  {group:"Discord",key:"discord-channel-times",label:"Kanalzeiten",view:"discord.channel-times.view",edit:"discord.channel-times.edit"},
  {group:"Discord",key:"discord-roles",label:"Rollen",view:"discord.roles.view"},
  {group:"Discord",key:"discord-members",label:"Mitglieder",view:"discord.members.view",actions:[
    {id:"discord.member.remove",label:"Freischaltrolle entziehen"},
    {id:"discord.member.assign",label:"Freischaltrolle vergeben"}
  ]},
  {group:"Discord",key:"discord-announcements",label:"Ankündigungen",view:"discord.announcements.view",edit:"discord.announcements.edit"},
  {group:"Discord",key:"discord-moderation",label:"Moderation",view:"discord.moderation.view",edit:"discord.moderation.edit"},
  {group:"Discord",key:"discord-onboarding",label:"Freischaltung",view:"discord.onboarding.view",edit:"discord.onboarding.edit"},
  {group:"Discord",key:"discord-access",label:"Zugriffsrechte",view:"discord.access.view",edit:"discord.access.edit"},
  {group:"Discord",key:"discord-reports",label:"Meldungen",view:"discord.reports.view",edit:"discord.reports.edit"},
  {group:"Social Media",key:"social-overview",label:"Übersicht",view:"social.overview.view"},
  {group:"Social Media",key:"social-instagram",label:"Instagram",view:"social.instagram.view",edit:"social.instagram.edit"},
  {group:"Social Media",key:"social-tiktok",label:"TikTok",view:"social.tiktok.view",edit:"social.tiktok.edit"},
  {group:"Social Media",key:"social-publications",label:"Veröffentlichungen",view:"social.publications.view"},
  {group:"Social Media",key:"social-settings",label:"Einstellungen",view:"social.settings.view",edit:"social.settings.edit"},
  {group:"Discord",key:"discord-statistics",label:"Statistiken",view:"discord.statistics.view"},
  {group:"Discord",key:"discord-activity",label:"Activity Board",view:"discord.activity.view"}
];

const ALL_CAPABILITIES=[...new Set(ACCESS_CATALOG.flatMap(x=>[x.view,x.edit,...(x.actions||[]).map(a=>a.id)].filter(Boolean)))];

const LEGACY_CAPABILITY_MAP={
  // 9.18.0: Umbenennung der Rollen-Berechtigungen (bestehende Zuweisungen bleiben gültig)
  "discord.rekrut.remove":["discord.member.remove"],
  "discord.rekrut.assign":["discord.member.assign"],
  "twitch.dashboard":["twitch.dashboard.view"],
  "twitch.commands":["twitch.commands.view","twitch.commands.edit"],
  "twitch.timers":["twitch.timers.view","twitch.timers.edit"],
  "twitch.autoreplies":["twitch.autoreplies.view","twitch.autoreplies.edit"],
  "twitch.community":["twitch.community.view","twitch.community.edit"],
  "twitch.watchtime":["twitch.watchtime.view","twitch.watchtime.edit"],
  "twitch.followage":["twitch.followage.view"],
  "twitch.team":["twitch.team.view","twitch.team.edit"],
  "twitch.eventprofiles":["twitch.eventprofiles.view","twitch.eventprofiles.edit"],
  "twitch.followathon":["twitch.followathon.view","twitch.followathon.edit"],
  "twitch.subathon":["twitch.subathon.view","twitch.subathon.edit"],
  "twitch.stubenkontrolle":["twitch.stubenkontrolle.view","twitch.stubenkontrolle.edit"],
  "twitch.clips":["twitch.clips.view","twitch.clips.edit"],
  "twitch.moderation":["twitch.moderation.view","twitch.moderation.edit"],
  "twitch.blocked":["twitch.blocked.view","twitch.blocked.edit"],
  "twitch.giveaway":["twitch.giveaway.view","twitch.giveaway.edit"],
  "twitch.statistics":["twitch.statistics.view"],
  "twitch.activity":["twitch.activity.view"],
  "discord.dashboard":["discord.dashboard.view"],
  "discord.channels":["discord.channels.view","discord.channels.edit"],
  "discord.channel-times":["discord.channel-times.view","discord.channel-times.edit"],
  "discord.roles":["discord.roles.view"],
  "discord.members":["discord.members.view"],
  "discord.announcements":["discord.announcements.view","discord.announcements.edit"],
  "discord.moderation":["discord.moderation.view","discord.moderation.edit"],
  "discord.onboarding":["discord.onboarding.view","discord.onboarding.edit"],
  "discord.access":["discord.access.view","discord.access.edit"],
  "discord.reports":["discord.reports.view","discord.reports.edit"],
  "social.overview":["social.overview.view"],
  "social.instagram":["social.instagram.view","social.instagram.edit"],
  "social.tiktok":["social.tiktok.view","social.tiktok.edit"],
  "social.publications":["social.publications.view"],
  "social.settings":["social.settings.view","social.settings.edit"]
};
const TWITCH_MOD_DEFAULT=["twitch.dashboard.view"];
// Rechte, die Discord-Rollen von sich aus mitbringen (9.12.0: Rollen-IDs kommen aus Profil & Branding).
const DISCORD_MODERATOR_DEFAULT=["discord.dashboard.view","discord.reports.view","discord.reports.edit"];
const DISCORD_ADMINISTRATOR_DEFAULT=["discord.dashboard.view","discord.reports.view","discord.reports.edit"];
function hasDiscordRole(guildRoles,roleId){return !!roleId&&Array.isArray(guildRoles)&&guildRoles.includes(roleId);}

function migrateCapabilities(list){
  const out=[];
  for(const raw of Array.isArray(list)?list:[]){
    const id=String(raw);
    if(LEGACY_CAPABILITY_MAP[id]) out.push(...LEGACY_CAPABILITY_MAP[id]);
    else out.push(id);
  }
  return out;
}
function normalizeRole(role){const r=String(role||"").toLowerCase();return ROLE_LEVEL[r]?r:"viewer";}
function roleAtLeast(role,needed){return(ROLE_LEVEL[normalizeRole(role)]||0)>=(ROLE_LEVEL[normalizeRole(needed)]||0);}
function highestRole(...roles){return roles.filter(Boolean).map(normalizeRole).sort((a,b)=>(ROLE_LEVEL[b]||0)-(ROLE_LEVEL[a]||0))[0]||"viewer";}
function managedUserId(seed){return`usr_${crypto.createHash("sha256").update(String(seed||crypto.randomBytes(16).toString("hex"))).digest("hex").slice(0,20)}`;}
function sanitizeCapabilities(list){
  const allowed=new Set(ALL_CAPABILITIES);
  return [...new Set(migrateCapabilities(list).map(String).filter(x=>allowed.has(x)))];
}
function legacyCapabilityPreset(role,domain){
  const r=normalizeRole(role);
  if(r==="admin"||r==="owner") return ALL_CAPABILITIES.slice();
  const entries=ACCESS_CATALOG.filter(x=>domain==="twitch"?String(x.view||"").startsWith("twitch."):String(x.view||"").startsWith("discord."));
  if(r==="editor") return entries.flatMap(x=>[x.view,x.edit,...(x.actions||[]).map(a=>a.id)].filter(Boolean));
  if(r==="viewer") return entries.filter(x=>x.key.endsWith("dashboard")||x.key==="twitch-dashboard").map(x=>x.view);
  return [];
}
function normalizeManagedUser(x={}){
  const twitchUserId=String(x.twitchUserId||"").trim()||null;
  const discordUserId=String(x.discordUserId||"").trim()||null;
  const legacyRole=normalizeRole(x.role||"editor");
  const globalOwner=x.globalOwner===true||legacyRole==="owner";
  const globalAdmin=!globalOwner&&(x.globalAdmin===true||legacyRole==="admin");
  const customized=x.capabilitiesCustomized===true;
  let capabilities=sanitizeCapabilities(x.capabilities);
  if(!customized){
    if(twitchUserId&&x.enabled!==false)capabilities.push(...legacyCapabilityPreset(legacyRole,"twitch"));
    if(discordUserId&&x.discordBackendEnabled===true)capabilities.push(...legacyCapabilityPreset(x.discordRole||"editor","discord"));
    capabilities=sanitizeCapabilities(capabilities);
  }
  return{
    ...x,id:String(x.id||managedUserId(twitchUserId||discordUserId||x.login||crypto.randomBytes(8).toString("hex"))),
    twitchUserId,login:String(x.login||"").trim().toLowerCase()||null,displayName:String(x.displayName||x.login||"").trim()||null,
    role:globalOwner?"owner":globalAdmin?"admin":legacyRole,enabled:x.enabled!==false&&!!twitchUserId,
    discordUserId,discordUsername:String(x.discordUsername||"").trim()||null,
    discordDisplayName:String(x.discordDisplayName||x.discordUsername||"").trim()||null,
    discordAvatar:String(x.discordAvatar||"").trim()||null,discordBackendEnabled:x.discordBackendEnabled===true,
    discordRole:normalizeRole(x.discordRole||"editor"),capabilities,capabilitiesCustomized:customized,globalOwner,globalAdmin
  };
}
function readUsers(){const raw=pgStore.enabled?pgStore.getControlUsers().data:readJson(FILES.users,{users:[]});const data=raw&&typeof raw==="object"?raw:{users:[]};if(!Array.isArray(data.users))data.users=[];data.users=data.users.map(normalizeManagedUser);return data;}
function writeUsers(data){data.users=(Array.isArray(data.users)?data.users:[]).map(normalizeManagedUser);if(pgStore.enabled){pgStore.putControlUsers({users:data.users});return;}writeJson(FILES.users,data);}
function findManagedUserByTwitchId(userId){const id=String(userId||"");return readUsers().users.find(x=>String(x.twitchUserId||"")===id)||null;}
function findManagedUserByDiscordId(userId){const id=String(userId||"");return readUsers().users.find(x=>String(x.discordUserId||"")===id)||null;}
function findManagedUser(userId){return findManagedUserByTwitchId(userId);}
function findManagedUserByInternalId(userId){
  const id=String(userId||"");
  return readUsers().users.find(x=>String(x.id||"")===id)||null;
}
function invalidateDiscordSessions(discordUserId){
  const id=String(discordUserId||"");
  if(!id)return 0;
  const sessions=sessionStore();
  let removed=0;
  for(const [sid,raw] of Object.entries(sessions)){
    if(raw?.authProvider==="discord"&&String(raw.discordId||"")===id){
      delete sessions[sid];
      removed++;
    }
  }
  if(removed)writeSessions(sessions);
  return removed;
}
function unlinkDiscordIdentityFromUser(data,target,actor){
  if(!target?.discordUserId)throw new Error("Mit diesem Benutzer ist kein Discord-Konto verknüpft.");
  const previous={
    discordUserId:String(target.discordUserId),
    discordUsername:target.discordUsername||null,
    discordDisplayName:target.discordDisplayName||null
  };
  target.discordUserId=null;
  target.discordUsername=null;
  target.discordDisplayName=null;
  target.discordAvatar=null;
  target.discordBackendEnabled=false;
  target.discordRole="viewer";
  target.updatedAt=new Date().toISOString();
  target.updatedBy=actor||"unlink";
  return previous;
}
function hasCapability(user,cap){if(!user)return false;if(user.localAdmin||user.globalOwner||user.globalAdmin||user.role==="owner"||user.role==="admin")return true;return Array.isArray(user.capabilities)&&user.capabilities.includes(cap);}
function anyCapability(user,prefix){if(!user)return false;if(user.localAdmin||user.globalOwner||user.globalAdmin||user.role==="owner"||user.role==="admin")return true;return(user.capabilities||[]).some(x=>String(x).startsWith(prefix));}

function effectiveSessionUser(raw){
  if(!raw||Number(raw.securityRevision||0)!==SECURITY_SESSION_REVISION)return null;
  const createdAt=Date.parse(raw.created||raw.createdAt||"");
  if(!Number.isFinite(createdAt)||Date.now()-createdAt<0||Date.now()-createdAt>SESSION_MAX_AGE_MS)return null;
  if(raw.localAdmin)return{...raw,role:"owner",globalOwner:true,globalAdmin:false,capabilities:ALL_CAPABILITIES.slice(),accessSource:"local-admin"};
  if(raw.authProvider!=="discord"&&String(raw.login||"").toLowerCase()===channelLoginCmp())return{...raw,role:"owner",globalOwner:true,globalAdmin:false,capabilities:ALL_CAPABILITIES.slice(),accessSource:"broadcaster",twitchLinked:true};

  const managed=raw.authProvider==="discord"?findManagedUserByDiscordId(raw.discordId):findManagedUserByTwitchId(raw.id);
  if(managed&&raw.authProvider!=="discord"&&managed.enabled===false)return null;
  if(managed?.globalOwner)return{...raw,internalUserId:managed.id,role:"owner",globalOwner:true,globalAdmin:false,capabilities:ALL_CAPABILITIES.slice(),accessSource:"global-owner",twitchLinked:!!managed.twitchUserId,discordLinked:!!managed.discordUserId};
  if(managed?.globalAdmin)return{...raw,internalUserId:managed.id,role:"admin",globalOwner:false,globalAdmin:true,capabilities:ALL_CAPABILITIES.slice(),accessSource:"global-admin",twitchLinked:!!managed.twitchUserId,discordLinked:!!managed.discordUserId};

  const hasStoredTwitchCapabilities=Array.isArray(managed?.capabilities)&&managed.capabilities.length>0;
  const roleDerivedTwitch=raw.authProvider!=="discord"&&managed?.createdBy==="twitch-moderator-login"&&(!managed.updatedBy||managed.updatedBy==="twitch-moderator-login")&&!hasStoredTwitchCapabilities;
  const caps=new Set(roleDerivedTwitch?[]:(managed?.capabilities||[]));
  const externalFresh=Date.now()-createdAt<=EXTERNAL_ROLE_SNAPSHOT_MAX_AGE_MS;
  if(externalFresh&&raw.authProvider!=="discord"&&raw.isModerator)TWITCH_MOD_DEFAULT.forEach(x=>caps.add(x));
  if(externalFresh&&raw.authProvider==="discord"&&hasDiscordRole(raw.guildRoles,discordProfile().roles.moderator))DISCORD_MODERATOR_DEFAULT.forEach(x=>caps.add(x));
  if(externalFresh&&raw.authProvider==="discord"&&hasDiscordRole(raw.guildRoles,discordProfile().roles.administrator))DISCORD_ADMINISTRATOR_DEFAULT.forEach(x=>caps.add(x));
  if(raw.authProvider==="discord"&&managed&&!managed.discordBackendEnabled){
    for(const cap of [...caps])if(cap.startsWith("discord.")&&!DISCORD_MODERATOR_DEFAULT.includes(cap))caps.delete(cap);
  }
  const capabilities=sanitizeCapabilities([...caps]);
  if(!capabilities.length)return null;
  return{
    ...raw,internalUserId:managed?.id||null,
    name:managed?.displayName||managed?.discordDisplayName||raw.name||raw.login||raw.discordUsername,
    role:"viewer",globalOwner:false,globalAdmin:false,capabilities,
    accessSource:managed?"capability-user":(raw.authProvider==="discord"?"discord-role":"twitch-moderator"),
    twitchLinked:!!managed?.twitchUserId||raw.authProvider!=="discord",
    discordLinked:!!managed?.discordUserId||raw.authProvider==="discord",
    discordBackendEnabled:managed?.discordBackendEnabled===true
  };
}
// N-3: Nur Felder an den Browser geben, die die Oberfläche braucht.
function publicSessionView(me){
  const {ip,securityRevision,guildRoles,...rest}=me||{};
  return rest;
}
function isAdminLevel(me){return !!(me&&(me.localAdmin||me.globalOwner||me.globalAdmin||me.role==="owner"||me.role==="admin"));}
function sessionUser(req){
  const sid=parseCookies(req).bwksid,sessions=sessionStore(),raw=sid?sessionRawFor(sessions,sid):null,user=effectiveSessionUser(raw);
  if(raw&&!user&&sid){delete sessions[sessionKey(sid)];writeSessions(sessions);}
  return user;
}
function send(res,code,body,type="application/json; charset=utf-8",headers={}){
  const noStore=type.startsWith("application/json")?{"Cache-Control":"no-store, no-cache, must-revalidate, proxy-revalidate","Pragma":"no-cache","Expires":"0"}:{};
  res.writeHead(code,{"Content-Type":type,...noStore,...headers});res.end(body);
}
function json(res,code,obj,headers={}){send(res,code,JSON.stringify(obj),"application/json; charset=utf-8",headers);}
function requireUser(req,res){const u=sessionUser(req);if(!u){json(res,401,{error:"Nicht angemeldet oder Zugriff entzogen"});return null;}return u;}
function requireCapability(req,res,cap){const u=requireUser(req,res);if(!u)return null;if(!hasCapability(u,cap)){audit(u.login||u.discordUsername||u.name||"unknown","access.denied",{capability:cap,path:req.url});json(res,403,{error:"Für diesen Bereich fehlt die erforderliche Berechtigung.",capability:cap});return null;}return u;}
function requireAnyCapability(req,res,caps){const u=requireUser(req,res);if(!u)return null;if(!caps.some(cap=>hasCapability(u,cap))){json(res,403,{error:"Für diesen Bereich fehlt die erforderliche Berechtigung."});return null;}return u;}
function requireDomainRole(req,res,domain,neededRole="viewer"){
  const u=requireUser(req,res);if(!u)return null;
  if(neededRole==="owner")return requireGlobalOwner(req,res);
  if(neededRole==="admin")return requireGlobalAdmin(req,res);
  if(u.globalOwner||u.globalAdmin||u.localAdmin)return u;
  const prefix=domain==="discord"?"discord.":"twitch.";
  if(!anyCapability(u,prefix)){json(res,403,{error:`Keine ${domain==="discord"?"Discord-":"Twitch-"}Berechtigung.`});return null;}
  return u;
}
function requireRole(req,res,neededRole){return requireDomainRole(req,res,"twitch",neededRole);}
function requireDiscordRole(req,res,neededRole){return requireDomainRole(req,res,"discord",neededRole);}
function requireGlobalAdmin(req,res){const u=requireUser(req,res);if(!u)return null;if(!(u.globalOwner||u.globalAdmin||u.localAdmin||u.role==="owner"||u.role==="admin")){json(res,403,{error:"Nur globale Owner oder Administratoren dürfen diese Aktion ausführen."});return null;}return u;}
function requireGlobalOwner(req,res){const u=requireUser(req,res);if(!u)return null;if(!(u.globalOwner||u.localAdmin||u.role==="owner")){json(res,403,{error:"Nur globale Owner dürfen diese Aktion ausführen."});return null;}return u;}
function privilegedRouteRequirement(pathname,method){
  const p=String(pathname||""),m=String(method||"GET").toUpperCase();
  if(p.startsWith("/api/backup/"))return"owner";
  if(p.startsWith("/api/database/"))return"owner";
  if(p==="/api/updates"||p.startsWith("/api/updates/"))return"owner";
  if(p==="/api/system/restart")return"admin";
  if(p==="/api/system-status")return"admin";
  // 8.9.5: Diagnose-Karte im Systemstatus. Der Handler prüft requireGlobalAdmin; ohne Eintrag hier sperrte die Default-Deny-Prüfung die Route.
  if(p==="/api/admin/performance")return"admin";
  if(p==="/api/users"||p.startsWith("/api/users/"))return"admin";
  return null;
}

const PUBLIC_API_ROUTES=new Set([
  "/api/me",
  "/api/local-login-available",
  // 9.11.0: Name der Oberfläche und Ersteinrichtung (Einrichtung selbst ist durch den Einrichtungscode geschützt).
  "/api/branding",
  "/api/setup/status",
  "/api/setup/complete",
  // 9.22.0: Lizenztext und Kenndaten (vor der Anmeldung nötig, damit der Assistent sie anzeigen kann).
  "/api/license",
  "/api/license/text",
  // 9.24.0: Begleitdokumente unter Hilfe → Rechtliches (Liste und Text über ?doc=…).
  "/api/legal",
  "/api/followathon/public/state",
  "/api/subathon/public/state",
  "/api/subathon/public/stream",
  "/api/followathon/public/stream",
  "/api/follower-alert/public/stream",
  "/api/follower-alert/public/state",
  "/api/chat-overlay/public/stream",
  "/api/chat-overlay/public/state"
]);

const EXPLICIT_GUARD_API_PREFIXES=[
  "/api/settings",
  "/api/activity",
  "/api/admin/login-logs",
  "/api/admin/modules",
  "/api/admin/profile",
  "/api/connections",
  "/api/reset-settings",
  "/api/discord/dashboard",
  "/api/discord/emergency",
  "/api/discord/logs",
  "/api/discord/members/role",
  "/api/discord-analytics",
  "/api/public-pages",
  "/api/database",
  "/api/account/discord/unlink",
  "/api/user-favorites"
];

function apiRouteExplicitlyGuarded(pathname){
  const p=String(pathname||"");
  if(PUBLIC_API_ROUTES.has(p))return true;
  if(EXPLICIT_GUARD_API_PREFIXES.some(prefix=>p===prefix||p.startsWith(`${prefix}/`)))return true;
  return false;
}

const localLoginAttempts = new Map();
function localLoginAllowed(ip) {
  const now = Date.now(),rec=localLoginAttempts.get(ip);
  if(!rec)return true;
  if(now-rec.windowStart>15*60*1000){localLoginAttempts.delete(ip);return true;}
  return rec.count<5;
}
function recordLocalLoginFailure(ip) {
  const now=Date.now(),rec=localLoginAttempts.get(ip);
  if(!rec||now-rec.windowStart>15*60*1000)localLoginAttempts.set(ip,{count:1,windowStart:now});
  else{rec.count+=1;localLoginAttempts.set(ip,rec);}
}

// ===== 9.11.0 · D1: Ersteinrichtung und Profil & Branding =====
// Einrichtungscode: wird beim Start erzeugt, solange die Ersteinrichtung offen ist, und nur ins
// Container-Protokoll geschrieben. Nach Abschluss der Einrichtung ist er ungültig.
let setupCode=null;
const setupAttempts=new Map();
function setupPendingNow(){try{return installationKit.isSetupPending(installationProfile());}catch{return false;}}
function ensureSetupCode(){
  if(!setupPendingNow()){setupCode=null;return null;}
  if(!setupCode){
    setupCode=installationKit.createSetupCode();
    console.log("======================================");
    console.log(" 🔑 ERSTEINRICHTUNG – Einrichtungscode:");
    console.log(`    ${setupCode}`);
    console.log(" Im Browser die Weboberfläche öffnen und den Code im Einrichtungsassistenten eingeben.");
    console.log(" Der Code gilt, bis die Einrichtung abgeschlossen ist (nach einem Neustart gibt es einen neuen).");
    console.log("======================================");
  }
  return setupCode;
}
function setupAttemptAllowed(ip){const now=Date.now(),rec=setupAttempts.get(ip);if(!rec)return true;if(now-rec.windowStart>15*60*1000){setupAttempts.delete(ip);return true;}return rec.count<10;}
function recordSetupFailure(ip){const now=Date.now(),rec=setupAttempts.get(ip);if(!rec||now-rec.windowStart>15*60*1000)setupAttempts.set(ip,{count:1,windowStart:now});else rec.count++;}
// Befehle, die anderswo schon belegt sind (für die Kollisionsprüfung der Spielbefehle).
function takenChatCommands(){
  const out=[],add=(command,owner)=>{const c=installationKit.normalizeCommand(command);if(/^!\S+$/.test(c))out.push({command:c,owner});};
  let settingsNow={};try{settingsNow=readJson(FILES.settings,DEFAULT_SETTINGS)||{};}catch{}
  try{for(const [c,label] of Object.entries(twitchEvents.describe().chatCommands||{}))if(label!=="Stubenkontrolle")add(c,label);}catch{}
  add("!followage","Community-Befehl !followage");add("!watchtime","Community-Befehl !watchtime");
  for(const c of String(settingsNow.lurkReturn?.commands||"!lurk").split(/[\s,]+/))if(c)add(c,"Lurk");
  for(const cmd of Array.isArray(settingsNow.commands)?settingsNow.commands:[]){
    const label=`eigener Command ${String(cmd?.command||"").trim()||"?"}`;
    add(cmd?.command,label);
    for(const a of String(cmd?.aliases||"").split(","))if(a.trim())add(a.trim(),label);
  }
  return out;
}
// 9.11.0: Platzhalter der Modultexte ({game}, {points}, {commands}) aus dem Installationsprofil füllen.
function brandModules(list){
  let g;try{g=installationProfile().game;}catch{g=installationKit.NEUTRAL_GAME;}
  const commands=[g.commands.start,g.commands.balance,"!daily","!give",g.commands.top].join(", ");
  const fill=v=>typeof v==="string"?v.replaceAll("{game}",g.name).replaceAll("{points}",g.pointsName).replaceAll("{commands}",commands):v;
  return (list||[]).map(m=>({...m,label:fill(m.label),description:fill(m.description),offNote:fill(m.offNote)}));
}
function brandingPublic(){
  const p=installationProfile();
  return {productName:p.productName,header:installationKit.headerParts(p.productName),setupPending:installationKit.isSetupPending(p),
    game:{name:p.game.name,pointsName:p.game.pointsName,commands:{...p.game.commands},fixedCommands:[...installationKit.FIXED_GAME_COMMANDS]},
    texts:textsPublic(),
    images:brandingImages(),
    footer:{author:AUTHOR_NOTICE,source:SOURCE_NOTICE,operatorLegal:p.operatorLegal.url?{...p.operatorLegal}:null}};
}
// 9.14.0: Bilder der Installation. Hochgeladene Dateien liegen unter /data/uploads (Volume ./data); in den Einstellungen steht nur die Zuordnung.
const UPLOAD_DIR=path.join(DATA_DIR,"uploads");
const LEGACY_DEFAULT_IMAGES=Object.freeze({banner:"follower-alert-banner.png",emblem:"follower-alert-emblem.png"});
function imageDefaultMode(slot){
  const legacy=installationProfile().textPack==="legacy-bwk";
  if(legacy&&LEGACY_DEFAULT_IMAGES[slot])return"default";   // bisheriges Bild der Bestandsinstallation
  if(legacy&&slot==="gameFigure")return"legacy";            // bisherige Figuren-Animation im Overlay
  if(slot==="gameFigure")return"builtin";                   // 9.24.0: neutrale Standardfigur (Lehrer), solange nichts hochgeladen ist
  return"none";
}
function brandingImages(){
  const p=installationProfile(),out={};
  for(const slot of imageKit.SLOT_KEYS){
    const up=p.images?.[slot];
    if(up)out[slot]={mode:"upload",url:`/branding/image/${slot}?v=${(/-([0-9a-f]{12})\./.exec(up.file)||[])[1]||"u"}`};
    else{const mode=imageDefaultMode(slot);out[slot]=mode==="default"?{mode,url:`/branding/image/${slot}?v=d`}:{mode};}
  }
  return out;
}
async function readRawBody(req,maxBytes){
  const declared=Number(req.headers["content-length"]||0);
  if(Number.isFinite(declared)&&declared>maxBytes)throw new HttpInputError("Die Datei ist größer als 5 MB.",413);
  const chunks=[];let total=0;
  for await(const c of req){total+=c.length;if(total>maxBytes)throw new HttpInputError("Die Datei ist größer als 5 MB.",413);chunks.push(c);}
  return Buffer.concat(chunks);
}
// 9.14.1: Bilder in der Sicherung: Dateien als Base64 samt Zuordnung. Beim Wiederherstellen wird jedes Bild erneut geprüft (wie ein Upload).
function imageBackupRead(){
  const files={},images=installationProfile().images||{};
  for(const slot of imageKit.SLOT_KEYS){
    const e=images[slot];if(!e||!imageKit.FILE_RE.test(e.file))continue;
    try{
      const buf=fs.readFileSync(path.join(UPLOAD_DIR,e.file));
      files[slot]={mime:e.mime,width:e.width,height:e.height,bytes:buf.length,updated:e.updated||null,data:buf.toString("base64")};
    }catch{/* Datei fehlt: wird nicht gesichert */}
  }
  return {schema:1,files};
}
function imageBackupPlan(section){
  if(!section||typeof section!=="object"||Array.isArray(section)||!section.files||typeof section.files!=="object"||Array.isArray(section.files))throw new Error("Bilder im Backup sind ungültig.");
  const plan=[],maxB64=Math.ceil(imageKit.MAX_BYTES*4/3)+16;
  for(const [slot,e] of Object.entries(section.files)){
    if(!imageKit.isSlot(slot))throw new Error(`Bilder im Backup: unbekannter Bildplatz „${String(slot).slice(0,40)}“.`);
    if(!e||typeof e.data!=="string"||e.data.length>maxB64||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.data))throw new Error(`Bilder im Backup: Datei für „${slot}“ ist ungültig.`);
    const buf=Buffer.from(e.data,"base64"),checked=imageKit.validateUpload(slot,buf);
    if(!checked.ok)throw new Error(`Bilder im Backup („${slot}“): ${checked.error}`);
    plan.push({slot,buf,checked});
  }
  return plan;
}
function removeUploadFile(file){
  if(!imageKit.FILE_RE.test(String(file||"")))return;
  try{fs.unlinkSync(path.join(UPLOAD_DIR,file));}catch{/* schon weg */}
}
function saveImage(slot,buf,checked){
  const hash=crypto.createHash("sha256").update(buf).digest("hex").slice(0,12);
  const file=`${slot}-${hash}.${checked.ext}`;
  fs.mkdirSync(UPLOAD_DIR,{recursive:true});
  const tmp=path.join(UPLOAD_DIR,`.${file}.${process.pid}.tmp`),dest=path.join(UPLOAD_DIR,file);
  fs.writeFileSync(tmp,buf,{mode:0o640});fs.renameSync(tmp,dest);
  const before=installationProfile({fresh:true}),old=before.images?.[slot]?.file;
  const next=JSON.parse(JSON.stringify(before));
  next.images={...(next.images||{}),[slot]:{file,mime:checked.mime,width:checked.width,height:checked.height,bytes:checked.bytes,updated:new Date().toISOString()}};
  saveInstallationProfile(next);
  if(old&&old!==file)removeUploadFile(old);
  return next.images[slot];
}
function clearImage(slot){
  const before=installationProfile({fresh:true}),old=before.images?.[slot]?.file;
  if(!old)return false;
  const next=JSON.parse(JSON.stringify(before));delete next.images[slot];
  saveInstallationProfile(next);removeUploadFile(old);
  return true;
}
// Urheberhinweis: fest im Code, nicht über Profil, Umgebung oder Sicherung änderbar (Mario, 17.11.2026).
const AUTHOR_NOTICE=Object.freeze({name:"Mario Janssen",url:"https://www.mj-pictures.de/Kontakt-Impressum"});
const SOURCE_NOTICE=Object.freeze({label:"Quellcode & Lizenz",url:"https://github.com/MJ-Pictures/bot-control-center"});
// Standardtexte des Textpakets für die Oberfläche (Vorbelegungen neuer Einträge, Platzhalter).
function textsPublic(){
  const pack=textPackKit.get(installationProfile()),d=pack.defaultSettings;
  return {
    followText:d.events.follow.text,followMessages:[...d.events.follow.messages],followageText:d.communityCommands.followage.text,
    teamCommandText:d.team.teamCommandText,teamTimerText:d.team.timer.text,teamMemberPrefix:pack.teamMemberPrefix,teamMemberSuffix:pack.teamMemberSuffix,teamMemberSince:pack.teamMemberSince,
    linkWhitelist:[...d.moderation.links.whitelistDomains],linkDomains:[...pack.linkDomains],linkLinks:[...pack.linkLinks],
    emotesMessage:d.moderation.emotes.timeoutMessage,symbolsMessage:d.moderation.symbols.timeoutMessage,capsMessage:d.moderation.caps.timeoutMessage,
    greeting:d.events.follow.text,
    level:{...pack.level},roleLabels:{...pack.roleLabels},roleTitles:{...pack.roleTitles},testName:pack.testName,teamRankLabel:pack.teamRankLabel
  };
}
function profileAdminView(){
  const p=installationProfile(),base=publicBaseInfo();
  return {installation:p,license:licenseInfo(),licenseCurrent:licenseKit.isCurrent(p.license),publicBase:base,redirects:installationKit.redirectUrls(base.url),
    commandLabels:installationKit.GAME_COMMAND_LABELS,fixedCommands:[...installationKit.FIXED_GAME_COMMANDS],
    discordRoleLabels:installationKit.DISCORD_ROLE_LABELS,
    authorNotice:AUTHOR_NOTICE,sourceNotice:SOURCE_NOTICE,
    imageSlots:imageKit.SLOT_KEYS.map(imageKit.slotInfo),imageState:brandingImages(),
    env:{channelLogin:!!CHANNEL_LOGIN,twitchRedirectUri:!!String(process.env.TWITCH_REDIRECT_URI||"").trim(),twitchConnectionRedirectUri:!!String(process.env.TWITCH_CONNECTION_REDIRECT_URI||"").trim()},
    effective:{channelLogin:channelLoginNow()||"",twitchLogin:twitchRedirectUri()||null,twitchConnect:connectionRedirectUri()||null,tiktok:tiktokRedirectUri()||null}};
}
// Prüft Produktname, Adresse und Spielbezeichnungen. Rückgabe {errors, next}.
function validateProfileInput(body,current){
  const errors=[],next=JSON.parse(JSON.stringify(current));
  if(body&&Object.prototype.hasOwnProperty.call(body,"productName")){
    const name=String(body.productName??"").trim();
    if(!name)errors.push("Der Name der Oberfläche darf nicht leer sein.");else if(name.length>80)errors.push("Der Name der Oberfläche ist zu lang (höchstens 80 Zeichen).");
    next.productName=name;
  }
  if(body&&Object.prototype.hasOwnProperty.call(body,"publicBaseUrl")){
    if(publicBaseInfo().locked){
      if(String(body.publicBaseUrl||"").trim()&&installationKit.normalizeBaseUrl(body.publicBaseUrl).url!==publicBaseInfo().url)errors.push("Die öffentliche Adresse ist durch die Installation (PUBLIC_BASE_URL) vorgegeben und kann hier nicht geändert werden.");
    }else{
      const r=installationKit.normalizeBaseUrl(body.publicBaseUrl);
      if(!r.ok)errors.push(r.error);else next.publicBaseUrl=r.url;
    }
  }
  if(body?.operatorLegal&&typeof body.operatorLegal==="object"){
    const r=installationKit.validateOperatorLegal(body.operatorLegal,next.operatorLegal);
    errors.push(...r.errors);
    next.operatorLegal=r.value;
  }
  if(body?.bots&&typeof body.bots==="object"){
    const r=botRoster.validateRosterInput(body.bots,next.bots);
    errors.push(...r.errors);
    next.bots=r.value;
  }
  if(body?.discord&&typeof body.discord==="object"){
    const r=installationKit.validateDiscord(body.discord,next.discord);
    errors.push(...r.errors);
    next.discord=r.value;
  }
  if(body?.game&&typeof body.game==="object"){
    const g=body.game,game={...next.game,commands:{...next.game.commands}};
    if(Object.prototype.hasOwnProperty.call(g,"name")){const v=String(g.name??"").trim();if(!v)errors.push("Der Spielname darf nicht leer sein.");else if(v.length>40)errors.push("Der Spielname ist zu lang (höchstens 40 Zeichen).");game.name=v;}
    if(Object.prototype.hasOwnProperty.call(g,"pointsName")){const v=String(g.pointsName??"").trim();if(!v)errors.push("Der Punktename darf nicht leer sein.");else if(v.length>30)errors.push("Der Punktename ist zu lang (höchstens 30 Zeichen).");game.pointsName=v;}
    if(g.commands&&typeof g.commands==="object")for(const key of installationKit.GAME_COMMAND_KEYS)if(Object.prototype.hasOwnProperty.call(g.commands,key))game.commands[key]=installationKit.normalizeCommand(g.commands[key]);
    errors.push(...installationKit.validateGameCommands(game.commands,takenChatCommands()));
    next.game=game;
  }
  return {errors,next};
}

const prepareSettingsFull=settings=>{prepareSettings(settings);normalizeLurkSettings(settings);normalizeModuleSettings(settings);normalizeWordFilterActive(settings);return settings;};
function filteredSettingsForUser(current,user){
  const out=JSON.parse(JSON.stringify(DEFAULT_SETTINGS));prepareSettingsFull(out);
  out.modules=JSON.parse(JSON.stringify(current.modules||out.modules));
  const copy=(key,cap)=>{if(hasCapability(user,cap))out[key]=JSON.parse(JSON.stringify(current[key]));};
  copy("commands","twitch.commands.view");copy("timers","twitch.timers.view");copy("autoReplies","twitch.autoreplies.view");
  if(hasCapability(user,"twitch.community.view")){out.greetings=JSON.parse(JSON.stringify(current.greetings));out.events=JSON.parse(JSON.stringify(current.events));out.communityCommands=JSON.parse(JSON.stringify(current.communityCommands));if(current.lurkReturn)out.lurkReturn=JSON.parse(JSON.stringify(current.lurkReturn));}
  copy("team","twitch.team.view");copy("clipSharing","twitch.clips.view");copy("moderation","twitch.moderation.view");copy("blockedWords","twitch.blocked.view");
  return out;
}
function mergeSettingsForUser(before,incoming,user){
  const next=JSON.parse(JSON.stringify(before));
  const set=(key,cap)=>{if(hasCapability(user,cap)&&Object.prototype.hasOwnProperty.call(incoming,key))next[key]=incoming[key];};
  set("commands","twitch.commands.edit");set("timers","twitch.timers.edit");set("autoReplies","twitch.autoreplies.edit");
  if(hasCapability(user,"twitch.community.edit"))for(const key of["greetings","events","communityCommands","lurkReturn"]){
    if(key==="lurkReturn"&&!isModuleEnabled(next,"lurkReturn"))continue; // 9.1.1: Modul aus = Einstellungen bleiben unverändert
    if(Object.prototype.hasOwnProperty.call(incoming,key))next[key]=incoming[key];
  }
  set("team","twitch.team.edit");
  if(isModuleEnabled(next,"clips"))set("clipSharing","twitch.clips.edit"); // 9.7.0: Modul aus = Einstellungen bleiben unverändert
  // 9.6.0: Einstellungen ausgeschalteter Moderationsmodule bleiben unverändert.
  if(isModuleEnabled(next,"twitchChatFilter"))set("moderation","twitch.moderation.edit");
  if(isModuleEnabled(next,"wordFilter"))set("blockedWords","twitch.blocked.edit");
  prepareSettingsFull(next);return next;
}

function apiAnyCapabilitiesFor(pathname,method){
  const p=String(pathname||""),m=String(method||"GET").toUpperCase();
  if(!p.startsWith("/api/word-filter"))return null;
  const write=!["GET","HEAD","OPTIONS"].includes(m);
  return write
    ? ["twitch.moderation.edit","twitch.blocked.edit","discord.moderation.edit"]
    : ["twitch.moderation.view","twitch.blocked.view","discord.moderation.view"];
}

function apiCapabilityFor(pathname,method){
  const p=String(pathname||""),m=String(method||"GET").toUpperCase();
  const write=!["GET","HEAD","OPTIONS"].includes(m);
  if(p==="/api/status"||p==="/api/dashboard-summary")return"twitch.dashboard.view";
  if(p.startsWith("/api/followathon"))return p.includes("/public/")?null:"twitch.followathon.view";
  if(p.startsWith("/api/subathon"))return p.includes("/public/")?null:"twitch.subathon.view";
  if(p==="/api/follower-alert")return write?"twitch.followathon.edit":"twitch.followathon.view";
  if(p==="/api/follower-alert/test")return"twitch.followathon.edit";
  if(p.startsWith("/api/chat-overlay"))return p.includes("/public/")?null:(write?"twitch.followathon.edit":"twitch.followathon.view");
  if(p==="/api/activity")return null;
  if(p==="/api/usage-stats")return"twitch.statistics.view";
  if(p.startsWith("/api/watchtime"))return write?"twitch.watchtime.edit":"twitch.watchtime.view";
  if(p.startsWith("/api/followers")||p==="/api/twitch/chat-leaderboard")return"twitch.followage.view";
  if(p.startsWith("/api/event-profiles"))return write?"twitch.eventprofiles.edit":"twitch.eventprofiles.view";
  if(p.startsWith("/api/stubenkontrolle"))return write?"twitch.stubenkontrolle.edit":"twitch.stubenkontrolle.view";
  if(p.startsWith("/api/clips"))return write?"twitch.clips.edit":"twitch.clips.view";
  if(p.startsWith("/api/giveaway"))return write?"twitch.giveaway.edit":"twitch.giveaway.view";
  if(p==="/api/test")return"twitch.commands.edit";
  if(p.startsWith("/api/discord/invite"))return write?"discord.channels.edit":"discord.channels.view";
  if(p.startsWith("/api/discord/levelsystem"))return write?"discord.moderation.edit":"discord.moderation.view";
  if(p==="/api/discord/status"||p==="/api/discord/verify")return"discord.dashboard.view";
  if(p==="/api/discord/members/levels")return"discord.members.view";
  if(p==="/api/discord/members")return"discord.members.view";
  if(p.startsWith("/api/discord/channel-times"))return write?"discord.channel-times.edit":"discord.channel-times.view";
  if(p.startsWith("/api/discord/announcements"))return write?"discord.announcements.edit":"discord.announcements.view";
  if(p.startsWith("/api/discord/moderation")){if(p.endsWith("/test")||p.endsWith("/logs")||p.endsWith("/history"))return"discord.moderation.view";return write?"discord.moderation.edit":"discord.moderation.view";}
  if(p.startsWith("/api/discord/reports"))return write?"discord.reports.edit":"discord.reports.view";
  if(p.startsWith("/api/social/config"))return write?"social.settings.edit":"social.settings.view";
  if(p.startsWith("/api/social/test")||p.startsWith("/api/social/poll")||p.startsWith("/api/social/retry"))return"social.settings.edit";
  if(p.startsWith("/api/social"))return"social.overview.view";
  if(p==="/api/discord/access/preview")return"discord.access.view";
  if(p==="/api/discord/access/apply")return"discord.access.edit";
  if(p.startsWith("/api/discord/onboarding"))return write?"discord.onboarding.edit":"discord.onboarding.view";
  return null;
}





function readEventProfiles() {
  const data=readJson(FILES.eventProfiles,{profiles:[],activeProfileId:null,updatedAt:null});
  if(!Array.isArray(data.profiles)) data.profiles=[];
  return data;
}

function writeEventProfiles(data) {
  data.updatedAt=new Date().toISOString();
  writeJson(FILES.eventProfiles,data);
}

// 8.9.8: Event-Profile erfassen alle schaltbaren Funktionen (shared/event-profile-core.js).
const eventProfileCore = require("/shared/event-profile-core");
// 9.2.0: Event-Profile lassen Schalter ausgeschalteter Module unberührt (siehe shared/modules.js).
const PROFILE_MODULE_OPTS={moduleOff};
const profileBots = () => twitchAccounts().filter(a=>a.type==="bot").map(a=>a.key);

// Aktueller Zustand aller schaltbaren Funktionen (Einstellungen + Stubenkontrolle + Follower-Alert).
function liveProfileState() {
  const settings=readJson(FILES.settings,DEFAULT_SETTINGS);
  prepareSettings(settings);
  return {
    settings,
    extras:{
      stubenkontrolle:{enabled:stubenkontrolle.summary().config.enabled!==false},
      followerAlert:{enabled:followerAlert.getConfig().enabled===true}
    }
  };
}

// Schreibt einen geänderten Live-Zustand zurück (nur was sich wirklich geändert hat).
function writeLiveProfileState(live) {
  writeJson(FILES.settings,live.settings);
  pushControlStateToDiscord("Event-Profil"); // 9.6.0: Wortfilter-Schalter für Discord sofort weitergeben
  const stube=!!live.extras?.stubenkontrolle?.enabled;
  if((stubenkontrolle.summary().config.enabled!==false)!==stube) stubenkontrolle.updateConfig({enabled:stube});
  const alert=!!live.extras?.followerAlert?.enabled;
  if((followerAlert.getConfig().enabled===true)!==alert) followerAlert.configure({enabled:alert});
}

// Nach jeder gespeicherten Änderung: aktives Profil übernimmt den neuen Stand automatisch,
// in allen anderen Profilen werden neue Einträge als AUS ergänzt und gelöschte entfernt.
function syncEventProfilesAfterChange(actor="system",reason="settings") {
  if(!moduleOn("eventProfiles"))return; // 9.7.0: Modul „Event-Profile“ aus → Profile bleiben unverändert
  try{
    const data=readEventProfiles();
    if(!data.profiles.length) return;
    const live=liveProfileState();
    let changed=false;
    const updatedActive=[];
    for(const profile of data.profiles){
      const isActive=String(profile.id)===String(data.activeProfileId||"");
      const next=isActive?eventProfileCore.capture(live):eventProfileCore.normalize(profile.snapshot,live,{isActive:false}).snapshot;
      if(JSON.stringify(next)!==JSON.stringify(profile.snapshot)){
        profile.snapshot=next;
        changed=true;
        if(isActive){profile.updatedAt=new Date().toISOString();profile.updatedBy=actor;updatedActive.push(profile.name);}
      }
    }
    if(changed){
      writeEventProfiles(data);
      if(updatedActive.length) audit(actor,"event-profile.autosync",{section:"eventProfiles",profileName:updatedActive[0],reason});
    }
  }catch(e){
    console.error("⚠️ Event-Profile konnten nicht abgeglichen werden:",e.message);
  }
}

function eventProfileCounts(snapshot) {
  return eventProfileCore.counts(snapshot);
}

function publicEventProfile(profile, activeProfileId=null) {
  const counts=eventProfileCounts(profile.snapshot||{});
  return {
    id:profile.id,
    name:profile.name,
    description:profile.description||"",
    createdAt:profile.createdAt||null,
    createdBy:profile.createdBy||null,
    updatedAt:profile.updatedAt||null,
    updatedBy:profile.updatedBy||null,
    active:String(activeProfileId||"")===String(profile.id||""),
    counts
  };
}

function eventProfilesResponse() {
  const data=readEventProfiles();
  return {
    activeProfileId:data.activeProfileId||null,
    updatedAt:data.updatedAt||null,
    profiles:data.profiles.map(p=>publicEventProfile(p,data.activeProfileId))
  };
}

function appVersionValue() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR,"version.json"),"utf8")).version || "unbekannt";
  } catch {
    return "unbekannt";
  }
}

const updateService=createUpdateService({
  dir:process.env.UPDATE_APPROVALS_DIR||"/approvals",
  stateFile:path.join(DATA_DIR,"update-state.json"),
  discord:(p,o)=>discordServiceRequest(p,o),
  audit:(u,a,d)=>audit(u,a,d),
  appVersion:()=>appVersionValue()
});


const PUBLIC_PAGE_DEFS = {
  app:{path:"/app",get title(){return productName();},label:"App-Informationen"}, // 9.11.0: Name aus dem Installationsprofil
  terms:{path:"/terms",title:"Nutzungsbedingungen",label:"Nutzungsbedingungen"},
  privacy:{path:"/privacy",title:"Datenschutzhinweise",label:"Datenschutz"},
  imprint:{path:"/imprint",title:"Impressum / Anbieterangaben",label:"Impressum"}
};
const DEFAULT_PUBLIC_PAGES = {
  pages:{
    app:{draftTitle:"{{PRODUKTNAME}}",draftContent:`# {{PRODUKTNAME}}

Das {{PRODUKTNAME}} ist eine interne Steueroberfläche für die eingesetzten Twitch- und Discord-Bots.

## TikTok-Anbindung

Die TikTok-Anbindung wird ausschließlich durch berechtigte Owner autorisiert. Sie nutzt TikTok Login Kit sowie die Display API mit den Berechtigungen user.info.basic und video.list.

Nach ausdrücklicher Autorisierung ruft die Anwendung grundlegende Profilinformationen und Metadaten der öffentlichen Videos des verbundenen TikTok-Accounts ab. Neue Veröffentlichungen werden erkannt und mit Beschreibung, Original-Link und optionalem Vorschaubild im zugeordneten Discord-Kanal angekündigt.

Die Veröffentlichung der Videos auf TikTok selbst erfolgt weiterhin über die bestehenden redaktionellen Prozesse. Das Control Center lädt keine Videos zu TikTok hoch und veröffentlicht keine TikTok-Beiträge.

## Weitere Informationen

- [Nutzungsbedingungen](/terms)
- [Datenschutzhinweise](/privacy)
- [Impressum](/imprint)`,updatedAt:null,updatedBy:null,published:null},
    terms:{draftTitle:"Nutzungsbedingungen",draftContent:`# Nutzungsbedingungen

## Anbieter

[[BETREIBER_NAME]]
[[BETREIBER_ANSCHRIFT]]

## Geltungsbereich

Diese Informationsseiten beschreiben das {{PRODUKTNAME}} und die dafür eingesetzten technischen Anbindungen. Der Verwaltungsbereich des Control Centers ist nicht öffentlich zugänglich und nur für autorisierte Nutzer bestimmt.

## Nutzung der öffentlichen Informationsseiten

Die öffentlichen Seiten dienen ausschließlich der Information über die Anwendung, ihre technischen Funktionen und die zugehörigen Hinweise. Aus den öffentlichen Seiten entsteht kein Anspruch auf Zugang zum internen Control Center.

## Verantwortlicher Kontakt

[[BETREIBER_KONTAKT]]

## Weitere Angaben

Vor Veröffentlichung sind die organisatorisch und rechtlich erforderlichen Bedingungen durch den Betreiber zu prüfen. Dieser Entwurf stellt keine automatische rechtliche Freigabe dar.

- [App-Informationen](/app)
- [Datenschutzhinweise](/privacy)
- [Impressum](/imprint)`,updatedAt:null,updatedBy:null,published:null},
    privacy:{draftTitle:"Datenschutzhinweise",draftContent:`# Datenschutzhinweise

## Verantwortliche Stelle

[[BETREIBER_NAME]]
[[BETREIBER_ANSCHRIFT]]
Datenschutzkontakt: [[DATENSCHUTZ_KONTAKT]]

## TikTok-Autorisierung

Die TikTok-Verbindung wird durch einen berechtigten Owner über TikTok Login Kit gestartet. Der Autorisierungscode wird serverseitig gegen Access- und Refresh-Token getauscht. Token und Client Secret werden nicht an den Browser des Control Centers ausgeliefert.

## Abgerufene TikTok-Daten

Die aktuelle Implementierung ruft über die Display API grundlegende Profildaten des ausdrücklich autorisierten Accounts ab: open_id, Anzeigename und Avatar-URL.

Für öffentliche Videos werden aktuell folgende Felder abgerufen: Video-ID, Titel, Videobeschreibung, Dauer, Cover-/Vorschaubild-URL, Original-/Share-Link und Veröffentlichungszeitpunkt.

## Lokale Speicherung

Im persistenten Discord-Service werden der Verbindungsstatus, die TikTok open_id, gewährte Scopes sowie Access- und Refresh-Token mit Ablaufdaten gespeichert. Zusätzlich werden zur Erkennung neuer Beiträge Video-IDs und Statusinformationen gespeichert. Die Veröffentlichungshistorie enthält unter anderem Video-ID, Typ, Titel beziehungsweise Beschreibung, Original-Link, Vorschaubild-URL, Veröffentlichungszeit und Discord-Auslieferungsstatus.

## Übertragung an Discord

Bei einer neu erkannten Veröffentlichung werden Beschreibung, Original-Link und – sofern aktiviert – ein Vorschaubild an den festgelegten Discord-Kanal übertragen. Das Vorschaubild wird dazu kurzfristig serverseitig von der Quell-URL abgerufen und als Discord-Anhang hochgeladen. Die aktuelle Implementierung speichert dieses Social-Media-Vorschaubild nicht zusätzlich als lokale Bilddatei.

Nach erfolgreicher Übertragung liegt die Discord-Nachricht einschließlich eines dort hochgeladenen Bildanhangs im verwendeten Discord-Server. Ein Trennen der TikTok-Verbindung löscht bereits versendete Discord-Nachrichten nicht automatisch.

## Protokollierung

Das Control Center protokolliert administrative Aktionen wie Verbindungsaufbau, Trennung und manuelle Prüfungen im internen Audit-Protokoll. Fehler des Social-Media-Abrufs werden im internen Status gespeichert und können außerdem in Container-Logs erscheinen. Diese Bereiche sind nicht öffentlich zugänglich.

## Trennung und Löschung

Owner können die TikTok-Verbindung trennen. Dabei werden die lokal verwalteten TikTok-Zugangstokens entfernt und – soweit möglich – bei TikTok widerrufen. Lokal gespeicherte TikTok-Erkennungs- und Verlaufsdaten können separat gelöscht werden. Bereits nach Discord übertragene Nachrichten oder Anhänge werden dadurch nicht automatisch entfernt.

## Rechtsgrundlagen und Aufbewahrung

Rechtsgrundlage(n): [[RECHTSGRUNDLAGE_TIKTOK]]

Organisatorische Aufbewahrungs- und Löschfristen: [[AUFBEWAHRUNGSREGELN]]

## Weitere Informationen

- [App-Informationen](/app)
- [Nutzungsbedingungen](/terms)
- [Impressum](/imprint)`,updatedAt:null,updatedBy:null,published:null},
    imprint:{draftTitle:"Impressum / Anbieterangaben",draftContent:`# Impressum / Anbieterangaben

## Anbieter

[[BETREIBER_NAME]]

[[BETREIBER_ANSCHRIFT]]

## Vertretung

[[VERTRETUNGSBERECHTIGTE_PERSON]]

## Kontakt

[[BETREIBER_KONTAKT]]

## Weitere gesetzlich erforderliche Angaben

[[WEITERE_IMPRESSUMSANGABEN]]

- [App-Informationen](/app)
- [Nutzungsbedingungen](/terms)
- [Datenschutzhinweise](/privacy)`,updatedAt:null,updatedBy:null,published:null}
  },
  masterData:{
    BETREIBER_NAME:"",
    BETREIBER_ANSCHRIFT:"",
    BETREIBER_KONTAKT:"",
    VERTRETUNGSBERECHTIGTE_PERSON:"",
    DATENSCHUTZ_KONTAKT:"",
    RECHTSGRUNDLAGE_TIKTOK:"",
    AUFBEWAHRUNGSREGELN:"",
    WEITERE_IMPRESSUMSANGABEN:""
  },
  masterDataUpdatedAt:null,
  masterDataUpdatedBy:null,
  verification:{draftFilename:"",draftContent:"",published:null,updatedAt:null,updatedBy:null},
  history:[]
};
function brandText(text){return String(text??"").replaceAll("{{PRODUKTNAME}}",productName());}
function publicPagesStore(){
  const raw=readJson(FILES.publicPages,DEFAULT_PUBLIC_PAGES),pages={};
  for(const [slug] of Object.entries(PUBLIC_PAGE_DEFS)){
    const src=raw.pages?.[slug]||{},fallback=DEFAULT_PUBLIC_PAGES.pages[slug];
    pages[slug]={
      // 9.11.0: {{PRODUKTNAME}} wird durch den Namen aus dem Installationsprofil ersetzt.
      draftTitle:brandText(src.draftTitle??fallback.draftTitle).slice(0,160),
      draftContent:brandText(src.draftContent??fallback.draftContent).slice(0,50000),
      updatedAt:src.updatedAt||null,updatedBy:src.updatedBy||null,
      published:src.published&&typeof src.published==="object"?src.published:null
    };
  }
  const masterData={};
  for(const key of Object.keys(DEFAULT_PUBLIC_PAGES.masterData)){
    masterData[key]=String(raw.masterData?.[key]??DEFAULT_PUBLIC_PAGES.masterData[key]).slice(0,10000);
  }
  return {
    pages,
    masterData,
    masterDataUpdatedAt:raw.masterDataUpdatedAt||null,
    masterDataUpdatedBy:raw.masterDataUpdatedBy||null,
    verification:{
      draftFilename:String(raw.verification?.draftFilename||"").slice(0,128),
      draftContent:String(raw.verification?.draftContent||"").slice(0,12000),
      published:raw.verification?.published&&typeof raw.verification.published==="object"?raw.verification.published:null,
      updatedAt:raw.verification?.updatedAt||null,updatedBy:raw.verification?.updatedBy||null
    },
    history:Array.isArray(raw.history)?raw.history.slice(-1000):[]
  };
}
function savePublicPages(store){writeJson(FILES.publicPages,store);}
function pagePlaceholders(text){
  return [...new Set((String(text||"").match(/\[\[[A-Z0-9_:-]+\]\]/g)||[]))];
}
function placeholderKey(token){return String(token||"").replace(/^\[\[|\]\]$/g,"");}
function resolvePublicVariables(text,masterData){
  return String(text||"").replace(/\[\[([A-Z0-9_:-]+)\]\]/g,(full,key)=>{
    const value=String(masterData?.[key]??"").trim();
    return value||full;
  });
}
function unresolvedPublicVariables(text,masterData){
  const tokens=pagePlaceholders(text);
  return tokens.filter(token=>!String(masterData?.[placeholderKey(token)]??"").trim());
}
function validatePublicDraft(slug,page,masterData){
  const errors=[];
  if(!PUBLIC_PAGE_DEFS[slug])errors.push("Unbekannte Seite.");
  if(!String(page?.draftTitle||"").trim())errors.push("Titel fehlt.");
  if(!String(page?.draftContent||"").trim())errors.push("Inhalt fehlt.");
  const placeholders=pagePlaceholders(`${page?.draftTitle||""}\n${page?.draftContent||""}`);
  const unresolved=unresolvedPublicVariables(`${page?.draftTitle||""}\n${page?.draftContent||""}`,masterData);
  if(unresolved.length)errors.push(`Fehlende Stammdaten: ${unresolved.join(", ")}`);
  return {ok:errors.length===0,errors,placeholders,unresolved};
}
function publicResolvedDraft(page,masterData){
  return {
    title:resolvePublicVariables(page?.draftTitle||"",masterData),
    content:resolvePublicVariables(page?.draftContent||"",masterData)
  };
}
function escHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function safePublicHref(raw){const href=String(raw||"").trim();if(/^https:\/\/[^\s]+$/i.test(href)||/^mailto:[^<>"\s]+$/i.test(href)||/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(href))return href;return "#";}
function renderInlinePublic(text){
  const src=String(text||"");let out="",last=0;const rx=/\[([^\]]{1,200})\]\(([^)\s]{1,1000})\)/g;let m;
  while((m=rx.exec(src))){out+=escHtml(src.slice(last,m.index));const href=safePublicHref(m[2]);out+=href==="#"?escHtml(m[1]):`<a href="${escHtml(href)}"${href.startsWith("https://")?' rel="noopener noreferrer"':""}>${escHtml(m[1])}</a>`;last=rx.lastIndex;}
  return out+escHtml(src.slice(last));
}
function renderRestrictedContent(content){
  const lines=String(content||"").replace(/\r/g,"").split("\n"),out=[];let list=[],paragraph=[];
  const flushList=()=>{if(list.length){out.push(`<ul>${list.map(x=>`<li>${renderInlinePublic(x)}</li>`).join("")}</ul>`);list=[];}};
  const flushP=()=>{if(paragraph.length){out.push(`<p>${paragraph.map(x=>renderInlinePublic(x)).join("<br>")}</p>`);paragraph=[];}};
  for(const raw of lines){const line=raw.trimEnd();if(/^-\s+/.test(line)){flushP();list.push(line.replace(/^-\s+/,""));continue;}flushList();
    if(/^##\s+/.test(line)){flushP();out.push(`<h2>${renderInlinePublic(line.replace(/^##\s+/,""))}</h2>`);continue;}
    if(/^#\s+/.test(line)){flushP();out.push(`<h1>${renderInlinePublic(line.replace(/^#\s+/,""))}</h1>`);continue;}
    if(!line.trim()){flushP();continue;}paragraph.push(line);}
  flushList();flushP();return out.join("\n");
}
function publicSiteHtml(slug,snapshot,{preview=false}={}){
  const def=PUBLIC_PAGE_DEFS[slug],nav=Object.entries(PUBLIC_PAGE_DEFS).map(([key,x])=>`<a href="${preview?`/owner-preview/public/${key}`:x.path}"${key===slug?' aria-current="page"':""}>${escHtml(x.label)}</a>`).join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escHtml(snapshot.title||def.title)}</title><style>:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:#10151c;color:#edf1f5;line-height:1.65}a{color:#f7c744}.wrap{max-width:900px;margin:auto;padding:24px}.top{border-bottom:1px solid #38414c;background:#19212b}.brand{font-weight:800;font-size:1.05rem}.nav{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px}.nav a[aria-current=page]{font-weight:800}.content{background:#19212b;border:1px solid #38414c;border-radius:14px;margin-top:28px;padding:clamp(20px,4vw,42px)}h1{line-height:1.2;font-size:clamp(1.8rem,5vw,2.7rem)}h2{margin-top:2rem;line-height:1.3}p,li{max-width:75ch}.preview{background:#7a4d00;padding:10px 16px;text-align:center;font-weight:800}.footer{color:#aeb7c2;font-size:.9rem;padding-bottom:36px}@media(prefers-color-scheme:light){body{background:#f4f6f8;color:#17202a}.top,.content{background:#fff;border-color:#d5dbe1}.footer{color:#5f6b76}}</style></head><body>${preview?'<div class="preview">Geschützte Entwurfsvorschau – nicht öffentlich veröffentlicht</div>':""}<header class="top"><div class="wrap"><div class="brand">${escHtml(productName())}</div><nav class="nav" aria-label="Informationsseiten">${nav}</nav></div></header><main class="wrap"><article class="content">${renderRestrictedContent(snapshot.content||"")}</article></main><footer class="wrap footer">Informationsseite: ${escHtml(productName())} · Keine Tracker oder Werbeeinbindungen.</footer></body></html>`;
}
function publicPageAdminView(){
  const store=publicPagesStore(),base=publicBaseUrl()||null;
  const pages=Object.entries(PUBLIC_PAGE_DEFS).map(([slug,def])=>{
    const p=store.pages[slug],v=validatePublicDraft(slug,p,store.masterData);
    return {slug,...def,draftTitle:p.draftTitle,draftContent:p.draftContent,updatedAt:p.updatedAt,updatedBy:p.updatedBy,
      validation:v,published:!!p.published,publishedAt:p.published?.publishedAt||null,publishedBy:p.published?.publishedBy||null,
      publicUrl:base?`${base}${def.path}`:def.path,previewUrl:`/owner-preview/public/${slug}`};
  });
  return {
    ok:true,baseUrl:base,pages,
    masterData:store.masterData,masterDataUpdatedAt:store.masterDataUpdatedAt,masterDataUpdatedBy:store.masterDataUpdatedBy,
    verification:store.verification,history:store.history.slice(-100).reverse(),
    urls:{website:base?`${base}/app`:"/app",terms:base?`${base}/terms`:"/terms",privacy:base?`${base}/privacy`:"/privacy",imprint:base?`${base}/imprint`:"/imprint",redirect:tiktokRedirectUri()||null}
  };
}
function recordPublicPageHistory(store,entry){store.history.push({at:new Date().toISOString(),...entry});store.history=store.history.slice(-1000);}
function validateVerificationDraft(v){const filename=String(v?.draftFilename||"").trim(),content=String(v?.draftContent||""),errors=[];if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.txt$/.test(filename))errors.push("Dateiname muss eine einfache .txt-Datei ohne Pfadangabe sein.");if(!content.trim())errors.push("Verifizierungsinhalt fehlt.");if(Buffer.byteLength(content,"utf8")>10000)errors.push("Verifizierungsdatei ist größer als 10 KB.");return {ok:errors.length===0,errors};}
const tiktokReviewDescription=()=>`${productName()} is an internal management application for our Twitch and Discord bots. An authorized owner can connect the official TikTok account through TikTok Login Kit. The application requests only user.info.basic and video.list. It reads basic profile information and metadata for the authorized account's public videos in order to detect newly published videos. New videos are announced in the designated Discord channel with the video description, original TikTok link and, when enabled, a preview image. Videos are created and published to TikTok through our existing editorial workflow; this application does not upload or publish TikTok content.`;
const TIKTOK_DEMO_FLOW=["Open the authenticated Control Center as an Owner and show Social Media → TikTok.","Show the fixed HTTPS redirect URI and the requested scopes user.info.basic and video.list.","Start Connect TikTok and complete consent in TikTok Sandbox with the authorized test account.","Return to the Control Center and show the connected account plus the granted scopes.","Trigger Jetzt prüfen and show the Display API result/status for public videos.","Publish a new test video through the normal TikTok editorial process, run the next check, then show the resulting Discord announcement with description, original link and preview image.","Show Disconnect TikTok and explain that existing Discord messages are not automatically deleted."];

const BACKUP_SCHEMA_VERSION = 2;
const BACKUP_SECTIONS = {
  settings: {
    label:"Einstellungen",
    read:()=>readJson(FILES.settings,DEFAULT_SETTINGS)
  },
  wordFilter: {
    label:"Zentraler Wortfilter",
    read:()=>pgStore.wordFilterSnapshot()
  },
  users: {
    label:"Benutzer & Rollen",
    read:()=>readUsers()
  },
  giveaways: {
    label:"Gewinnspiele",
    read:()=>readGiveawayState()
  },
  watchtime: {
    label:"Watchtime",
    read:()=>readWatchtime()
  },
  usageStats: {
    label:"Command- / Auto-Reply-Statistiken",
    read:()=>readUsageStats()
  },
  discordAnalytics: {
    label:"Discord · Analytics-Snapshots",
    read:()=>readDiscordAnalytics()
  },
  clipState: {
    label:"Clip-Status",
    read:()=>readClipState()
  },
  eventProfiles: {
    label:"Event-Profile",
    read:()=>readEventProfiles()
  },
  stubenkontrolle: {
    get label(){const g=installationProfile().game;return `${g.name} / ${g.pointsName}`;},
    read:()=>stubenkontrolle.exportBackup()
  },
  followathon: {
    label:"Followathon",
    read:()=>readJson(FILES.followathon,{schema:1,currentEventId:null,events:[],seenMessageIds:{},config:{}})
  },
  images: {
    label:"Bilder (Logo, Banner, Figur, Emblem)",
    read:()=>imageBackupRead()
  },
  publicPages: {
    label:"Öffentliche Webseiten",
    read:()=>publicPagesStore()
  },
  discordCommunity: {
    label:"Discord · Community & Ankündigungen",
    discord:true
  },
  discordModeration: {
    label:"Discord · Moderation & Userhistorie",
    discord:true
  },
  discordReports: {
    label:"Discord · Meldesystem",
    discord:true
  },
  discordChannelTimes: {
    label:"Discord · Kanalzeiten",
    discord:true
  },
  discordEmergency: {
    label:"Discord · Notfallmodus-Konfiguration",
    discord:true
  },
  discordLogs: {
    label:"Discord · Logs & Benachrichtigungen",
    discord:true
  },
  discordSocial: {
    label:"Discord · Social Media",
    discord:true
  }
};

function normalizeBackupInclude(input) {
  const requested=Array.isArray(input) ? input : Object.keys(BACKUP_SECTIONS);
  return [...new Set(requested.map(String).filter(key=>BACKUP_SECTIONS[key]))];
}

async function buildBackup(include) {
  const selected=normalizeBackupInclude(include);
  const data={};
  const discordKeys=selected.filter(key=>BACKUP_SECTIONS[key]?.discord===true);

  for(const key of selected.filter(key=>!BACKUP_SECTIONS[key]?.discord)){
    data[key]=BACKUP_SECTIONS[key].read();
  }

  if(discordKeys.length){
    const result=await discordServiceRequest("/backup/export");
    const sections=result.body?.sections||{};
    for(const key of discordKeys){
      if(!sections[key])throw new Error(`Discord-Backup-Bereich ${BACKUP_SECTIONS[key].label} konnte nicht gelesen werden.`);
      data[key]=sections[key];
    }
  }

  return {
    meta:{
      type:BACKUP_TYPE, // 9.11.0: neutral; ältere Sicherungen werden weiter erkannt
      schemaVersion:BACKUP_SCHEMA_VERSION,
      appVersion:appVersionValue(),
      createdAt:new Date().toISOString(),
      channelLogin:channelLoginNow(),
      includes:selected,
      secretsExcluded:true
    },
    data
  };
}

const BACKUP_TYPE="Bot Control Center Backup";
const BACKUP_TYPES_ACCEPTED=[BACKUP_TYPE,...legacyBwk.LEGACY_BACKUP_TYPES];
function validateBackupPayload(payload) {
  if(!payload || typeof payload!=="object" || Array.isArray(payload)){
    throw new Error("Backup-Datei ist kein gültiges Objekt.");
  }
  if(!BACKUP_TYPES_ACCEPTED.includes(payload?.meta?.type)){
    throw new Error("Die Datei ist kein gültiges Bot-Control-Center-Backup.");
  }
  const schemaVersion=Number(payload?.meta?.schemaVersion);
  if(![1,BACKUP_SCHEMA_VERSION].includes(schemaVersion)){
    throw new Error(`Backup-Schema ${payload?.meta?.schemaVersion ?? "unbekannt"} wird nicht unterstützt.`);
  }
  if(!payload.data || typeof payload.data!=="object" || Array.isArray(payload.data)){
    throw new Error("Backup enthält keinen gültigen Datenbereich.");
  }

  const available=Object.keys(payload.data).filter(key=>BACKUP_SECTIONS[key]);
  if(!available.length){
    throw new Error("Backup enthält keine wiederherstellbaren Bereiche.");
  }

  return available;
}

function backupSummary(payload) {
  const available=validateBackupPayload(payload);
  const data=payload.data||{};

  return {
    meta:{
      schemaVersion:payload.meta.schemaVersion,
      appVersion:payload.meta.appVersion||null,
      createdAt:payload.meta.createdAt||null,
      channelLogin:payload.meta.channelLogin||null,
      includes:available
    },
    sections:available.map(key=>{
      let detail="";
      if(key==="settings"){
        detail=`${Array.isArray(data.settings?.commands)?data.settings.commands.length:0} Commands, ${Array.isArray(data.settings?.autoReplies)?data.settings.autoReplies.length:0} Auto-Replies, ${Array.isArray(data.settings?.timers)?data.settings.timers.length:0} Timer`;
      }else if(key==="wordFilter"){
        detail=`${Array.isArray(data.wordFilter?.terms)?data.wordFilter.terms.length:0} Begriffe, ${Array.isArray(data.wordFilter?.allowlist)?data.wordFilter.allowlist.length:0} Allowlist-Einträge`;
      }else if(key==="users"){
        detail=`${Array.isArray(data.users?.users)?data.users.users.length:0} Benutzer`;
      }else if(key==="giveaways"){
        detail=`${Array.isArray(data.giveaways?.history)?data.giveaways.history.length:0} historische Gewinnspiele`;
      }else if(key==="watchtime"){
        detail=`${Object.keys(data.watchtime?.users||{}).length} Watchtime-Nutzer`;
      }else if(key==="usageStats"){
        detail=`${Object.keys(data.usageStats?.commands||{}).length} Command-Statistiken, ${Object.keys(data.usageStats?.autoReplies||{}).length} Auto-Reply-Statistiken`;
      }else if(key==="discordAnalytics"){
        detail=`${Array.isArray(data.discordAnalytics?.snapshots)?data.discordAnalytics.snapshots.length:0} Mitglieder-Snapshots`;
      }else if(key==="clipState"){
        detail=`${Object.keys(data.clipState?.seen||{}).length} bekannte Clips`;
      }else if(key==="eventProfiles"){
        detail=`${Array.isArray(data.eventProfiles?.profiles)?data.eventProfiles.profiles.length:0} Event-Profile`;
      }else if(key==="stubenkontrolle"){
        detail=`${Object.keys(data.stubenkontrolle?.accounts||{}).length} Konten, ${Array.isArray(data.stubenkontrolle?.rounds)?data.stubenkontrolle.rounds.length:0} Runden, ${Array.isArray(data.stubenkontrolle?.transactions)?data.stubenkontrolle.transactions.length:0} Buchungen`;
      }else if(key==="followathon"){
        detail=`${Array.isArray(data.followathon?.events)?data.followathon.events.length:0} Followathon-Events`;
      }else if(key==="images"){
        const n=Object.keys(data.images?.files||{}).length;detail=n?`${n} ${n===1?"Bild":"Bilder"} (${Object.keys(data.images.files).join(", ")})`:"keine eigenen Bilder";
      }else if(key==="publicPages"){
        detail=`${Object.values(data.publicPages?.pages||{}).filter(x=>x?.published).length}/4 Seiten veröffentlicht`;
      }else if(key==="discordCommunity"){
        detail=`Freischaltung, ${Object.keys(data.discordCommunity?.onboardingState?.members||{}).length} Member-Zustände, Ankündigungen`;
      }else if(key==="discordModeration"){
        detail=`${Object.keys(data.discordModeration?.state?.users||{}).length} User-Zustände, ${Array.isArray(data.discordModeration?.log)?data.discordModeration.log.length:0} Moderationsereignisse`;
      }else if(key==="discordReports"){
        detail=`${Array.isArray(data.discordReports?.tickets?.tickets)?data.discordReports.tickets.tickets.length:0} Meldungen / Tickets`;
      }else if(key==="discordChannelTimes"){
        detail=`${Array.isArray(data.discordChannelTimes?.config?.profiles)?data.discordChannelTimes.config.profiles.length:0} Zeitprofile · aktive Rechte-Snapshots ausgeschlossen`;
      }else if(key==="discordEmergency"){
        detail=`3 Notfallstufen · aktiver Zustand und Rechte-Snapshots ausgeschlossen`;
      }else if(key==="discordLogs"){
        detail=`${Object.keys(data.discordLogs?.config?.events||{}).length} Log-Ereignisse`;
      }else if(key==="discordSocial"){
        detail=`Social-Konfiguration und ${Array.isArray(data.discordSocial?.history?.items)?data.discordSocial.history.items.length:0} Verlaufseinträge · Tokens ausgeschlossen`;
      }
      return {key,label:BACKUP_SECTIONS[key].label,detail};
    })
  };
}

async function restoreBackup(payload, include, actor) {
  const available=validateBackupPayload(payload);
  const selected=normalizeBackupInclude(include).filter(key=>available.includes(key));
  if(!selected.length){
    throw new Error("Es wurde kein wiederherstellbarer Bereich ausgewählt.");
  }

  const data=payload.data||{};
  const discordSelected=selected.filter(key=>BACKUP_SECTIONS[key]?.discord===true);
  const localSelected=selected.filter(key=>!BACKUP_SECTIONS[key]?.discord);

  // Discord-Bereiche zuerst vollständig validieren, bevor lokale Dateien verändert werden.
  if(discordSelected.length){
    const discordData=Object.fromEntries(discordSelected.map(key=>[key,data[key]]));
    await discordServiceRequest("/backup/restore",{
      method:"POST",
      body:JSON.stringify({data:discordData,include:discordSelected,dryRun:true})
    });
  }

  // Lokale Bereiche vollständig validieren, bevor irgendeine Datei überschrieben wird.
  for(const key of localSelected){
    if(key==="settings"){
      if(!data.settings||typeof data.settings!=="object"||Array.isArray(data.settings))throw new Error("Einstellungen im Backup sind ungültig.");
    }else if(key==="wordFilter"){
      if(!data.wordFilter||!Array.isArray(data.wordFilter.terms)||!Array.isArray(data.wordFilter.categories))throw new Error("Wortfilter-Daten im Backup sind ungültig.");
    }else if(key==="users"){
      if(!data.users||!Array.isArray(data.users.users))throw new Error("Benutzer-Daten im Backup sind ungültig.");
    }else if(key==="giveaways"){
      if(!data.giveaways||typeof data.giveaways!=="object"||Array.isArray(data.giveaways))throw new Error("Gewinnspiel-Daten im Backup sind ungültig.");
    }else if(key==="watchtime"){
      if(!data.watchtime||typeof data.watchtime.users!=="object"||Array.isArray(data.watchtime.users))throw new Error("Watchtime-Daten im Backup sind ungültig.");
    }else if(key==="usageStats"){
      if(!data.usageStats||typeof data.usageStats!=="object"||Array.isArray(data.usageStats))throw new Error("Statistik-Daten im Backup sind ungültig.");
    }else if(key==="discordAnalytics"){
      if(!data.discordAnalytics||!Array.isArray(data.discordAnalytics.snapshots))throw new Error("Discord-Analytics-Daten im Backup sind ungültig.");
    }else if(key==="clipState"){
      if(!data.clipState||typeof data.clipState!=="object"||Array.isArray(data.clipState))throw new Error("Clip-Status im Backup ist ungültig.");
    }else if(key==="eventProfiles"){
      if(!data.eventProfiles||!Array.isArray(data.eventProfiles.profiles))throw new Error("Event-Profile im Backup sind ungültig.");
    }else if(key==="stubenkontrolle"){
      if(!data.stubenkontrolle||typeof data.stubenkontrolle!=="object"||Array.isArray(data.stubenkontrolle))throw new Error("Stubenkontrolle-Daten im Backup sind ungültig.");
    }else if(key==="followathon"){
      if(!data.followathon||typeof data.followathon!=="object"||!Array.isArray(data.followathon.events))throw new Error("Followathon-Daten im Backup sind ungültig.");
    }else if(key==="publicPages"){
      if(!data.publicPages||typeof data.publicPages!=="object"||!data.publicPages.pages)throw new Error("Öffentliche Webseiten im Backup sind ungültig.");
    }else if(key==="images"){
      imageBackupPlan(data.images); // wirft bei ungültigen Bildern, bevor irgendetwas verändert wird
    }
  }

  // Settings zuerst validieren und ggf. Twitch Blocked Terms synchronisieren.
  if(localSelected.includes("settings")){
    const restored=data.settings;
    if(!restored || typeof restored!=="object" || Array.isArray(restored)){
      throw new Error("Einstellungen im Backup sind ungültig.");
    }

    const current=readJson(FILES.settings,DEFAULT_SETTINGS);
    if(twitchBlockedTermsChanged(current,restored)){
      restored.blockedWords=(await twitchRuntime.reconcileTwitchBlockedTerms(current,restored,actor)).blockedWords;
    }
  }

  const restored=[];

  for(const key of localSelected){
    if(key==="settings"){
      // 9.11.0: Das Installationsprofil gehört zur Installation, nicht zur Sicherung – es bleibt beim Wiederherstellen unverändert.
      const keep=readJson(FILES.settings,DEFAULT_SETTINGS)?.installation;
      const incoming={...data.settings};delete incoming.installation;
      if(keep)incoming.installation=keep;
      writeJson(FILES.settings,incoming);
      installationCache=null;
    }else if(key==="wordFilter"){
      if(!pgStore.enabled)throw new Error("Der zentrale Wortfilter benötigt PostgreSQL.");
      pgStore.replaceWordFilter(data.wordFilter);
      await wordFilterChanged();
    }else if(key==="users"){
      const users=data.users;
      if(!users || !Array.isArray(users.users)) throw new Error("Benutzer-Daten im Backup sind ungültig.");
      writeUsers({users:users.users});
      invalidateAllSessions("backup-users-restored");
    }else if(key==="giveaways"){
      const giveaways=data.giveaways;
      if(!giveaways || typeof giveaways!=="object") throw new Error("Gewinnspiel-Daten im Backup sind ungültig.");
      writeGiveawayState({
        current:giveaways.current ?? null,
        history:Array.isArray(giveaways.history)?giveaways.history:[]
      },{replace:true});
    }else if(key==="watchtime"){
      const wt=data.watchtime;
      if(!wt || typeof wt.users!=="object" || Array.isArray(wt.users)) throw new Error("Watchtime-Daten im Backup sind ungültig.");
      if(pgStore.enabled)pgStore.replaceWatchtime(wt.users);
      else writeJson(FILES.watchtime,{users:wt.users,updatedAt:wt.updatedAt||new Date().toISOString()});
    }else if(key==="usageStats"){
      const stats=data.usageStats;
      if(!stats || typeof stats!=="object") throw new Error("Statistik-Daten im Backup sind ungültig.");
      const restoredStats={
        commands:(stats.commands && typeof stats.commands==="object" && !Array.isArray(stats.commands)) ? stats.commands : {},
        autoReplies:(stats.autoReplies && typeof stats.autoReplies==="object" && !Array.isArray(stats.autoReplies)) ? stats.autoReplies : {},
        updatedAt:stats.updatedAt||new Date().toISOString()
      };
      if(pgStore.enabled)pgStore.replaceUsageStats(restoredStats); else writeJson(FILES.usageStats,restoredStats);
    }else if(key==="discordAnalytics"){
      const analytics=data.discordAnalytics;
      const restoredAnalytics={snapshots:Array.isArray(analytics.snapshots)?analytics.snapshots:[],updatedAt:analytics.updatedAt||new Date().toISOString()};
      if(pgStore.enabled)pgStore.replaceDiscordAnalytics(restoredAnalytics); else writeJson(FILES.discordAnalytics,restoredAnalytics);
    }else if(key==="clipState"){
      const clip=data.clipState;
      if(!clip || typeof clip!=="object") throw new Error("Clip-Status im Backup ist ungültig.");
      const restoredClipState={initialized:!!clip.initialized,seen:(clip.seen && typeof clip.seen==="object" && !Array.isArray(clip.seen)) ? clip.seen : {},lastCheckedAt:clip.lastCheckedAt||null,lastShared:clip.lastShared||null,lastError:null};
      if(pgStore.enabled)pgStore.replaceClipState(restoredClipState); else writeJson(FILES.clipState,restoredClipState);
    }else if(key==="eventProfiles"){
      const profiles=data.eventProfiles;
      if(!profiles || !Array.isArray(profiles.profiles)) throw new Error("Event-Profile im Backup sind ungültig.");
      writeJson(FILES.eventProfiles,{
        profiles:profiles.profiles,
        activeProfileId:profiles.activeProfileId||null,
        updatedAt:profiles.updatedAt||new Date().toISOString()
      });
    }else if(key==="stubenkontrolle"){
      if(!data.stubenkontrolle || typeof data.stubenkontrolle!=="object") throw new Error("Stubenkontrolle-Daten im Backup sind ungültig.");
      stubenkontrolle.restoreBackup(data.stubenkontrolle);
    }else if(key==="followathon"){
      const fa=data.followathon;
      if(!fa || typeof fa!=="object" || !Array.isArray(fa.events)) throw new Error("Followathon-Daten im Backup sind ungültig.");
      if(pgStore.enabled&&typeof pgStore.putFollowathonState==="function")pgStore.putFollowathonState(fa,null,{replace:true});
      else writeJson(FILES.followathon,fa);
    }else if(key==="images"){
      // Nur die im Backup enthaltenen Plätze werden ersetzt; andere bleiben unverändert.
      for(const item of imageBackupPlan(data.images))saveImage(item.slot,item.buf,item.checked);
    }else if(key==="publicPages"){
      const pp=data.publicPages;
      if(!pp || typeof pp!=="object" || !pp.pages) throw new Error("Öffentliche Webseiten im Backup sind ungültig.");
      savePublicPages(pp);
    }
    restored.push(key);
  }

  if(discordSelected.length){
    const discordData=Object.fromEntries(discordSelected.map(key=>[key,data[key]]));
    const result=await discordServiceRequest("/backup/restore",{
      method:"POST",
      body:JSON.stringify({data:discordData,include:discordSelected,dryRun:false})
    });
    for(const key of (result.body?.restored||discordSelected))if(!restored.includes(key))restored.push(key);
  }

  audit(actor,"backup.restored",{
    section:"backup",
    backupVersion:payload.meta?.appVersion||null,
    backupCreatedAt:payload.meta?.createdAt||null,
    restored
  });

  return restored;
}

function humanBytes(bytes) {
  const n=Number(bytes||0);
  if(n < 1024) return `${n} B`;
  if(n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  if(n < 1024*1024*1024) return `${(n/1024/1024).toFixed(1)} MB`;
  return `${(n/1024/1024/1024).toFixed(2)} GB`;
}

function safeFileInfo(file) {
  try {
    const st=fs.statSync(file);
    return {
      exists:true,
      sizeBytes:st.size,
      size:humanBytes(st.size),
      modifiedAt:st.mtime.toISOString()
    };
  } catch {
    return {exists:false,sizeBytes:0,size:"0 B",modifiedAt:null};
  }
}

async function postgresStorageStatus(){
  const twitch=pgStore.status();
  let discord=null;
  try{discord=(await discordServiceRequest("/storage/postgres/status")).body||null;}catch(e){discord={ok:false,error:e.message};}
  return {ok:(!pgStore.enabled||twitch.ok)&&(!discord||discord.ok!==false),backend:pgStore.enabled?"postgres":"json",twitch,discord};
}

async function postgresLegacyExport(actor="owner"){
  if(!pgStore.enabled)throw new Error("PostgreSQL ist nicht aktiv.");
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const root=path.join(DATA_DIR,"postgres-rollback",stamp);
  fs.mkdirSync(root,{recursive:true});
  const files=[];
  for(const [file,key] of PG_DOCUMENT_FILES){
    if(key==="followathon"||key==="giveaways"||key==="users"||key==="sessions"||key==="discord-bridge"||key==="follower-cache"||key==="clip-state"||key==="usage-stats"||key==="discord-analytics")continue; // relationale Bereiche werden unten aus den Tabellen rekonstruiert
    const out=path.join(root,path.basename(file));
    fs.writeFileSync(out,JSON.stringify(pgStore.getDocument(key,{}),null,2)+"\n",{mode:0o600});
    files.push(path.basename(out));
  }
  const bridgeOut=path.join(root,path.basename(FILES.discordBridge));
  fs.writeFileSync(bridgeOut,JSON.stringify(await twitchRuntime.readDiscordBridgeState(),null,2)+"\n",{mode:0o600});
  files.push(path.basename(bridgeOut));
  const followerOut=path.join(root,path.basename(FILES.followerCache));
  fs.writeFileSync(followerOut,JSON.stringify(pgStore.exportFollowerCache(),null,2)+"\n",{mode:0o600});
  files.push(path.basename(followerOut));
  if(await twitchRuntime.channelId()){
    const messageCountsOut=path.join(root,"twitch-message-counts.json");
    fs.writeFileSync(messageCountsOut,JSON.stringify(pgStore.exportMessageCounts(String(await twitchRuntime.channelId())),null,2)+"\n",{mode:0o600});
    files.push(path.basename(messageCountsOut));
  }
  const clipOut=path.join(root,path.basename(FILES.clipState));
  fs.writeFileSync(clipOut,JSON.stringify(pgStore.getClipState().state,null,2)+"\n",{mode:0o600});
  files.push(path.basename(clipOut));
  const usageOut=path.join(root,path.basename(FILES.usageStats));
  fs.writeFileSync(usageOut,JSON.stringify(pgStore.exportUsageStats(),null,2)+"\n",{mode:0o600});
  files.push(path.basename(usageOut));
  const analyticsOut=path.join(root,path.basename(FILES.discordAnalytics));
  fs.writeFileSync(analyticsOut,JSON.stringify(pgStore.exportDiscordAnalytics(),null,2)+"\n",{mode:0o600});
  files.push(path.basename(analyticsOut));
  // Control-Center-Benutzer, Rechte und Sessions liegen ab V7.2.6 relational
  // und werden für einen Legacy-Rollback wieder in users.json / sessions.json rekonstruiert.
  const usersOut=path.join(root,path.basename(FILES.users));
  fs.writeFileSync(usersOut,JSON.stringify(readUsers(),null,2)+"\n",{mode:0o600});
  files.push(path.basename(usersOut));
  const sessionsOut=path.join(root,path.basename(FILES.sessions));
  fs.writeFileSync(sessionsOut,JSON.stringify(sessionStore(),null,2)+"\n",{mode:0o600});
  files.push(path.basename(sessionsOut));
  // Punktespiel-Daten liegen ab V7.2.1 relational und müssen für einen Legacy-Rollback
  // explizit wieder in die frühere stubenkontrolle.json-Struktur exportiert werden.
  const spindOut=path.join(root,path.basename(FILES.stubenkontrolle));
  fs.writeFileSync(spindOut,JSON.stringify(stubenkontrolle.exportBackup(),null,2)+"\n",{mode:0o600});
  files.push(path.basename(spindOut));
  // Followathon liegt ab V7.2.2 relational und wird für einen Legacy-Rollback
  // wieder in die bisherige followathon.json-Struktur rekonstruiert.
  const faState=pgStore.getFollowathonState();
  const faOut=path.join(root,path.basename(FILES.followathon));
  fs.writeFileSync(faOut,JSON.stringify(faState?.found?faState.state:{schema:1,currentEventId:null,events:[],seenMessageIds:{},config:{}},null,2)+"\n",{mode:0o600});
  files.push(path.basename(faOut));
  // Gewinnspiele liegen ab V7.2.3 relational und werden für einen Legacy-Rollback
  // wieder in die bisherige giveaways.json-Struktur rekonstruiert.
  const gwState=pgStore.getGiveawayState();
  const gwOut=path.join(root,path.basename(FILES.giveaways));
  fs.writeFileSync(gwOut,JSON.stringify(gwState?.found?gwState.state:{current:null,history:[]},null,2)+"\n",{mode:0o600});
  files.push(path.basename(gwOut));
  const wt=pgStore.exportWatchtime();
  fs.writeFileSync(path.join(root,path.basename(FILES.watchtime)),JSON.stringify(wt,null,2)+"\n",{mode:0o600});
  files.push(path.basename(FILES.watchtime));
  const auditRows=[...pgStore.queryEvents("audit",50000)].reverse();
  const authRows=[...pgStore.queryEvents("auth",50000)].reverse();
  fs.writeFileSync(path.join(root,path.basename(FILES.audit)),auditRows.map(x=>JSON.stringify(x)).join("\n")+(auditRows.length?"\n":""),{mode:0o600});
  fs.writeFileSync(path.join(root,path.basename(FILES.authLog)),authRows.map(x=>JSON.stringify(x)).join("\n")+(authRows.length?"\n":""),{mode:0o600});
  files.push(path.basename(FILES.audit),path.basename(FILES.authLog));
  fs.writeFileSync(path.join(root,"README-ROLLBACK.txt"),`PostgreSQL-Rollback-Export für ${productName()}.\nErstellt: ${new Date().toISOString()}\nAusgeführt durch: ${actor}\n\nFür einen Rollback auf V7.1.1 zuerst Bot-Container stoppen. Danach die exportierten JSON/JSONL-Dateien kontrolliert in data/ zurückkopieren. Twitch-Token bleiben im ursprünglichen data-Verzeichnis und wurden bewusst nicht in PostgreSQL verschoben.\n`,"utf8");
  let discord=null;
  try{discord=(await discordServiceRequest("/storage/postgres/export-legacy",{method:"POST",body:"{}"})).body||null;}catch(e){discord={ok:false,error:e.message};}
  audit(actor,"database.legacy-export.created",{section:"database",path:root,discordPath:discord?.path||null});
  return {ok:true,twitch:{path:root,files},discord};
}

function readAuditRawNewestFirst() {
  if(pgStore.enabled){try{return pgStore.queryEvents("audit",50000);}catch{return[];}}
  try {
    return fs.readFileSync(FILES.audit,"utf8")
      .split("\n").filter(Boolean)
      .map(line=>{ try{return JSON.parse(line);}catch{return null;} })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

function latestAuditByActions(items, actions) {
  const wanted=new Set(actions);
  return items.find(x=>wanted.has(String(x.action||""))) || null;
}

function recentSystemErrors(items, limit=20) {
  const rows=items.filter(x=>{
    const action=String(x.action||"").toLowerCase();
    return action.includes("failed") || action.includes("error") || action==="access.denied";
  });
  const out=[];
  const byKey=new Map();
  for(const row of rows){
    const detail=row?.detail||{};
    const key=[String(row?.action||""),String(row?.user||""),String(detail.error||detail.reason||detail.status||"")].join("\u0000");
    const existing=byKey.get(key);
    if(existing){existing.occurrences=(existing.occurrences||1)+1;continue;}
    const copy={...row,occurrences:1};
    byKey.set(key,copy);out.push(copy);
    if(out.length>=limit)break;
  }
  return out;
}

function publicDiagnosticAudit(item) {
  if(!item) return null;
  const detail=item.detail||{};
  return {
    ts:item.ts||null,
    user:item.user||null,
    action:item.action||null,
    occurrences:Number(item.occurrences||1),
    detail:{
      section:detail.section||null,
      type:detail.type||null,
      status:detail.status||null,
      tokenAccount:detail.tokenAccount||null,
      user:detail.user||null,
      viewers:detail.viewers??null,
      clipId:detail.clipId||null,
      title:detail.title||null,
      creator:detail.creator||null,
      error:detail.error||null,
      reason:detail.reason||null,
      target:detail.target||null
    }
  };
}


function readDiscordAnalytics(){
  const raw=pgStore.enabled?pgStore.exportDiscordAnalytics():readJson(FILES.discordAnalytics,{snapshots:[],updatedAt:null});
  return{snapshots:Array.isArray(raw.snapshots)?raw.snapshots:[],updatedAt:raw.updatedAt||null};
}
function writeDiscordAnalytics(data){
  data.snapshots=(Array.isArray(data.snapshots)?data.snapshots:[]).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  data.updatedAt=new Date().toISOString();
  if(pgStore.enabled){pgStore.replaceDiscordAnalytics(data);return;}
  writeJson(FILES.discordAnalytics,data);
}
async function collectDiscordAnalyticsSnapshot(){
  try{
    const result=await discordServiceRequest("/verify",{method:"POST"});
    const count=Number(result.body?.guild?.memberCount);
    if(!Number.isFinite(count))throw new Error("Discord-Mitgliederzahl nicht verfügbar.");
    const now=new Date(),date=now.toISOString().slice(0,10);
    if(pgStore.enabled){pgStore.upsertDiscordAnalyticsSnapshot(date,count,now.toISOString());}
    else{
      const data=readDiscordAnalytics();
      const existing=data.snapshots.find(x=>x.date===date);
      if(existing){existing.memberCount=count;existing.capturedAt=now.toISOString();}
      else data.snapshots.push({date,memberCount:count,capturedAt:now.toISOString()});
      writeDiscordAnalytics(data);
    }
    return count;
  }catch(e){
    audit("discord-analytics","discord.analytics.snapshot.failed",{section:"discord.statistics",error:e.message});
    return null;
  }
}
function analyticsDayKey(ts){
  const d=new Date(ts);
  return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;
}
function buildDiscordAnalytics(){
  const data=readDiscordAnalytics();
  const auditItems=readAuditRawNewestFirst();
  const shared=auditItems.filter(x=>x.action==="discord.announcement.delivered"&&String(x.detail?.status||"sent")==="sent");
  const violations=auditItems.filter(x=>{
    const a=String(x.action||"");
    return a.startsWith("discord.moderation.")||a.startsWith("discord.violation.")||a==="discord.report.confirmed";
  });
  const byDay=new Map();
  const ensure=date=>{
    if(!date)return null;
    if(!byDay.has(date))byDay.set(date,{date,memberCount:null,violations:0,shared:0});
    return byDay.get(date);
  };
  for(const snap of data.snapshots){const row=ensure(snap.date);if(row)row.memberCount=Number.isFinite(Number(snap.memberCount))?Number(snap.memberCount):null;}
  for(const x of shared){const row=ensure(analyticsDayKey(x.ts));if(row)row.shared++;}
  for(const x of violations){const row=ensure(analyticsDayKey(x.ts));if(row)row.violations++;}
  const rows=[...byDay.values()].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const snaps=[...data.snapshots].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const current=snaps.length?Number(snaps[snaps.length-1].memberCount):null;
  const summary=days=>{
    const cutoff=days?Date.now()-(days-1)*86400000:null;
    const selected=rows.filter(r=>!cutoff||new Date(`${r.date}T23:59:59Z`).getTime()>=cutoff);
    const period=snaps.filter(x=>!cutoff||new Date(`${x.date}T23:59:59Z`).getTime()>=cutoff);
    const first=period.length?Number(period[0].memberCount):current;
    return{members:current,memberDelta:(current!==null&&Number.isFinite(first))?current-first:null,violations:selected.reduce((n,x)=>n+Number(x.violations||0),0),shared:selected.reduce((n,x)=>n+Number(x.shared||0),0)};
  };
  return{ok:true,summary:{days7:summary(7),days30:summary(30),all:summary(null)},rows,updatedAt:data.updatedAt,note:"Verstöße werden aus Discord-Moderationsereignissen gezählt. Bis die Discord-Moderation aktiv ist, kann dieser Wert 0 bleiben."};
}
function startDiscordAnalyticsCollector(){
  setTimeout(()=>collectDiscordAnalyticsSnapshot(),8000);
  setInterval(()=>collectDiscordAnalyticsSnapshot(),6*60*60*1000);
}

async function buildSystemStatus() {
  const es=await twitchRuntime.eventSubStatus();
  const connectionItems=[];
  for(const acc of twitchAccounts()){
    const name=acc.key;
    try{
      connectionItems.push(await twitchRuntime.connectionStatus(name));
    }catch(e){
      connectionItems.push({
        key:name,
        login:acc.login||name,
        displayName:acc.displayName||name,
        purpose:acc.purpose||"",
        connected:await twitchRuntime.hasToken(name),
        valid:false,
        scopes:[],
        missingScopes:[...(acc.requiredScopes||[])],
        error:e.message
      });
    }
  }

  const appToken=await appTokenStatus().catch(e=>({valid:false,error:e.message}));
  const clipState=readClipState();
  const watchtime=readWatchtime();
  const auditItems=readAuditRawNewestFirst();
  const settings=readJson(FILES.settings,DEFAULT_SETTINGS);

  const eventEntries=Object.entries(es.subscriptions).map(([type,s])=>({
    type,
    ok:!!s?.ok,
    status:s?.status??null,
    tokenAccount:s?.tokenAccount||null,
    updatedAt:s?.updatedAt||null,
    error:s?.error||null
  }));

  const expectedEventTypes=[
    "channel.chat.message",
    "channel.follow",
    "channel.raid",
    "stream.online",
    "automod.message.hold"
  ];

  const watchtimeUsers=Object.keys(watchtime.users||{}).length;
  const mem=process.memoryUsage();

  let appVersion="unbekannt";
  try {
    appVersion=JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR,"version.json"),"utf8")).version || appVersion;
  } catch {}

  const lastEvents={
    follow:publicDiagnosticAudit(latestAuditByActions(auditItems,["event.follow.received"])),
    raid:publicDiagnosticAudit(latestAuditByActions(auditItems,["event.raid.received"])),
    automodHold:publicDiagnosticAudit(latestAuditByActions(auditItems,["automod.hold.detected"])),
    automodAllow:publicDiagnosticAudit(latestAuditByActions(auditItems,["automod.auto-allowed"])),
    clip:publicDiagnosticAudit(latestAuditByActions(auditItems,["clip.shared","clip.share.failed"])),
    moderation:publicDiagnosticAudit(latestAuditByActions(auditItems,[
      "moderation.message.deleted",
      "moderation.timeout.applied",
      "moderation.action.failed",
      "blocked-word.message.deleted",
      "blocked-word.action.failed"
    ]))
  };

  const files={
    settings:safeFileInfo(FILES.settings),
    users:safeFileInfo(FILES.users),
    giveaways:safeFileInfo(FILES.giveaways),
    clipState:safeFileInfo(FILES.clipState),
    watchtime:safeFileInfo(FILES.watchtime),
    usageStats:safeFileInfo(FILES.usageStats),
    eventProfiles:safeFileInfo(FILES.eventProfiles),
    followerCache:safeFileInfo(FILES.followerCache),
    stubenkontrolle:safeFileInfo(FILES.stubenkontrolle),
    followathon:safeFileInfo(FILES.followathon),
    audit:safeFileInfo(FILES.audit)
  };

  const tokenOk=connectionItems.filter(x=>x.valid).length;
  const eventOk=expectedEventTypes.filter(type=>es.subscriptions[type]?.ok).length;

  const warnings=[];
  if(!es.socketOpen){
    if(["connecting","reconnecting","waiting"].includes(es.runtime.state)){
      warnings.push(`EventSub ist aktuell ${es.runtime.state==="waiting"?"im Wiederverbindungs-Wartefenster":es.runtime.state==="reconnecting"?"im Twitch-Reconnect":"im Verbindungsaufbau"}.`);
    }else{
      warnings.push("EventSub-WebSocket ist nicht verbunden.");
    }
  }
  if(eventOk < expectedEventTypes.length) warnings.push(`Nur ${eventOk} von ${expectedEventTypes.length} erwarteten EventSub-Abos sind aktiv.`);
  if(tokenOk < connectionItems.length) warnings.push(`${connectionItems.length-tokenOk} Twitch-Verbindung(en) sind nicht vollständig gültig.`);
  if(!appToken?.valid) warnings.push("App Access Token ist nicht aktiv.");
  if(!internalServiceSecretReady())warnings.push("INTERNAL_SERVICE_SECRET ist nicht sicher konfiguriert; Discord-Verwaltungsfunktionen bleiben blockiert.");
  if(clipState.lastError) warnings.push(`Clip-Monitor meldet: ${clipState.lastError}`);
  const proxyObservation=clientNet.observation();
  if(!TRUSTED_PROXY_CIDRS.length&&proxyObservation.untrustedForwardedRequests>0)warnings.push(`Proxy-Header von nicht vertrauter Adresse ${proxyObservation.lastUntrustedPeer} gesehen (${proxyObservation.untrustedForwardedRequests} Anfragen seit Start). Client-IPs und Rate-Limits gelten dadurch gemeinsam für alle Besucher. Proxy-Adresse prüfen und dann TRUSTED_PROXY_CIDRS setzen (siehe UPDATE-8.6.6.md).`);
  // Erreichbarkeit des Twitch-Bots (eigener Dienst).
  const twitchBot={mode:"remote",reachable:es.reachable!==false,link:twitchRuntime.linkStatus()};
  if(!twitchBot.reachable)warnings.push("Der Twitch-Bot ist nicht erreichbar. Chat, Ereignisse und Zähler stehen, bis er wieder läuft.");
  const database=pgStore.status();
  // 8.9.23: Dienste-Übersicht – welche Teile laufen, in welcher Betriebsart, seit wann.
  const services=[];
  services.push({key:"web",name:"Weboberfläche",ok:true,state:"läuft",uptimeSeconds:Math.floor(process.uptime()),memoryRss:process.memoryUsage().rss,detail:"Oberfläche, Anmeldung, Overlays, Updates"});
  {
    const st=await twitchRuntime.serviceStatus();
    const state=!st?"nicht erreichbar":!st.runtimeStarted?(st.waitingFor==="getrennter-betrieb"?"wartet auf getrennten Betrieb":"wartet auf die Weboberfläche"):es.connected?"läuft":"läuft, EventSub nicht verbunden";
    services.push({key:"twitch",name:"Twitch-Bot",ok:!!st&&st.runtimeStarted&&es.connected===true,state,separate:true,uptimeSeconds:st?.uptimeSeconds??null,memoryRss:st?.memoryRss??null,pendingEvents:st?.pendingEvents??null,detail:"eigener Dienst (Chat, EventSub, Moderation, Zähler)"});
    if(st&&st.pendingEvents>0)warnings.push(`${st.pendingEvents} Ereignis(se) des Twitch-Bots warten auf Zustellung an die Weboberfläche.`);
  }
  try{
    const d=(await discordServiceRequest("/status")).body||{};
    const ready=d.gateway?.ready===true;
    services.push({key:"discord",name:"Discord-Bot",ok:ready,state:ready?"läuft":"läuft, Gateway nicht bereit",separate:true,uptimeSeconds:Number(d.uptimeSeconds||0),memoryRss:null,label:typeof d.service==="string"?d.service.slice(0,63):null,detail:"eigener Dienst (Discord, Social Media)"});
  }catch(e){
    services.push({key:"discord",name:"Discord-Bot",ok:false,state:"nicht erreichbar",separate:true,uptimeSeconds:null,memoryRss:null,detail:"eigener Dienst (Discord, Social Media)"});
  }
  services.push({key:"db",name:"Datenbank",ok:pgStore.enabled?!!database.ok:true,state:pgStore.enabled?(database.ok?"verbunden":"Fehler"):"Datei-Modus (ohne PostgreSQL)",separate:pgStore.enabled,uptimeSeconds:null,memoryRss:null,detail:pgStore.enabled?"PostgreSQL":"JSON-Dateien"});
  if(pgStore.enabled&&!database.ok)warnings.push(`PostgreSQL meldet einen Fehler: ${database.lastError||"unbekannt"}`);
  // 8.11.0: Stand des Update-Werkzeugs auf dem Host (Fassung, Startdatei, fehlgeschlagenes Werkzeug-Update).
  const updater=updateService.updater();
  if(updater?.openFallback)warnings.push(`Das Werkzeug-Update ${updater.openFallback.version} ist fehlgeschlagen; das bisherige Update-Werkzeug ${updater.toolVersion} läuft weiter. Grund: ${updater.openFallback.reason||"unbekannt"}`);

  return {
    updater,
    generatedAt:new Date().toISOString(),
    version:appVersion,
    nodeVersion:process.version,
    uptimeSeconds:Math.floor(process.uptime()),
    twitchBot,
    operatingMode:"getrennt",
    services,
    database,
    memory:{
      rssBytes:mem.rss,
      rss:humanBytes(mem.rss),
      heapUsedBytes:mem.heapUsed,
      heapUsed:humanBytes(mem.heapUsed),
      heapTotalBytes:mem.heapTotal,
      heapTotal:humanBytes(mem.heapTotal)
    },
    localAdminEnabled:LOCAL_ADMIN_ENABLED,
    secretSources:SECRET_SOURCES,
    localAdmin:{
      enabled:LOCAL_ADMIN_ENABLED,
      trustedProxyCidrsConfigured:TRUSTED_PROXY_CIDRS.length>0,
      mode:TRUSTED_PROXY_CIDRS.length?"lan-and-trusted-proxy":"direct-lan-only",
      localNetworkCidrs:LOCAL_NETWORK_CIDRS,
      hostFallback:LOCAL_ADMIN_HOST_FALLBACK,
      proxyObservation:clientNet.observation()
    },
    cspViolations:cspReports.summary(),
    channel:{
      login:channelLoginNow(),
      id:await twitchRuntime.channelId()
    },
    websocket:{
      connected:es.connected,
      state:es.socketReadyState,
      socketState:es.socketState,
      runtimeState:es.runtime.state,
      sessionReady:es.sessionReady,
      lastConnectedAt:es.runtime.lastConnectedAt,
      lastMessageAt:es.runtime.lastMessageAt,
      lastDisconnectedAt:es.runtime.lastDisconnectedAt,
      lastError:es.runtime.lastError,
      lastCloseCode:es.runtime.lastCloseCode,
      lastCloseReason:es.runtime.lastCloseReason,
      reconnectAttempts:es.runtime.reconnectAttempts,
      nextRetryAt:es.runtime.nextRetryAt,
      keepaliveTimeoutSeconds:es.runtime.keepaliveTimeoutSeconds
    },
    eventSub:{
      expected:expectedEventTypes.length,
      ok:eventOk,
      items:eventEntries
    },
    tokens:{
      ok:tokenOk,
      total:connectionItems.length,
      items:connectionItems
    },
    appToken,
    clip:{
      initialized:!!clipState.initialized,
      knownCount:Number(clipState.knownCount ?? Object.keys(clipState.seen||{}).length),
      lastCheckedAt:clipState.lastCheckedAt||null,
      lastShared:clipState.lastShared||null,
      lastError:clipState.lastError||null,
      enabled:!!settings.clipSharing?.enabled
    },
    watchtime:{
      users:watchtimeUsers,
      updatedAt:watchtime.updatedAt||null,
      file:files.watchtime
    },
    files,
    lastEvents,
    recentErrors:recentSystemErrors(auditItems,20).map(publicDiagnosticAudit),
    warnings,
    healthy:warnings.length===0
  };
}

const connectionOauthStates = new Map();

function cleanupConnectionStates() {
  const now = Date.now();
  for (const [state, entry] of connectionOauthStates.entries()) {
    if (!entry || entry.expiresAt < now) connectionOauthStates.delete(state);
  }
  if(connectionOauthStates.size>100){
    for(const key of [...connectionOauthStates.keys()].slice(0,connectionOauthStates.size-100))connectionOauthStates.delete(key);
  }
}



const followathon = createFollowathon({
  file: FILES.followathon,
  storage: pgStore,
  storageKey: "followathon",
  audit,
  publicBaseUrl: ()=>publicBaseUrl(), // 9.11.0: zur Laufzeit (Profil kann sich ändern)
  getTwitchStatus: async () => {
    const es=await twitchRuntime.eventSubStatus();
    const connection=await twitchRuntime.connectionStatus(mainBotKeyNow());
    const sub=es.subscriptions["channel.follow"]||null;
    return {
      account: connection ? {
        expectedLogin: connection.login,
        authorizedLogin: connection.authorizedLogin,
        authorizedUserId: connection.authorizedUserId,
        connected: connection.connected,
        valid: connection.valid,
        scopes: connection.scopes,
        missingScopes: connection.missingScopes,
        wrongAccount: connection.wrongAccount||false
      } : null,
      requiredScope:"moderator:read:followers",
      eventSub:{
        state:es.runtime.state,
        connected:es.connected,
        subscription:sub,
        lastConnectedAt:es.runtime.lastConnectedAt,
        lastDisconnectedAt:es.runtime.lastDisconnectedAt,
        lastMessageAt:es.runtime.lastMessageAt,
        lastError:es.runtime.lastError,
        possibleGap:es.runtime.state!=="connected" ? {from:es.runtime.lastDisconnectedAt||es.runtime.lastMessageAt||null,to:null} : (es.runtime.lastDisconnectedAt&&es.runtime.lastConnectedAt&&new Date(es.runtime.lastConnectedAt)>new Date(es.runtime.lastDisconnectedAt)?{from:es.runtime.lastDisconnectedAt,to:es.runtime.lastConnectedAt}:null)
      }
    };
  }
});

twitchEvents.on("follow","Followathon-Follow konnte nicht verarbeitet werden",({event,metadata})=>{if(!moduleOn("followathon"))return;return followathon.handleFollow(event,metadata);}); // 9.3.0: Modulschalter
// 9.20.0: Subathon. Beim Start endet ein laufender Followathon; solange ein Subathon läuft, sind Followathon-Start/-Anlage gesperrt.
const subathon = createSubathon({
  file: path.join(DATA_DIR,"subathon.json"),
  storage: pgStore,
  storageKey: "subathon",
  audit,
  publicBaseUrl: ()=>publicBaseUrl(),
  getTwitchStatus: async () => {
    // 9.20.3: Kanal-Konto über den Schlüssel der Bot-Liste (nicht "channel"); Verbindung kommt aus der eigenen Subathon-Verbindung.
    const ch=botRosterNow().channel,conn=await twitchRuntime.connectionStatus(ch.key).catch(()=>null);
    const live=await twitchRuntime.subathonStatus().catch(e=>({running:false,state:"unreachable",connected:false,subscriptions:{},lastError:e.message}));
    const need=["channel:read:subscriptions","bits:read"];
    return {
      requiredScopes:need,
      channelAccount:{key:ch.key,displayName:ch.displayName||ch.login||ch.key,login:ch.login||null,connected:conn?.connected===true,valid:conn?.valid===true,authorizedLogin:conn?.authorizedLogin||null,missingScopes:(conn?.missingScopes||[]).filter(x=>need.includes(x))},
      connection:{moduleOn:live.moduleOn===true,hasToken:live.hasToken===true,state:live.state||"stopped",connected:live.connected===true,lastError:live.lastError||null,lastConnectedAt:live.lastConnectedAt||null},
      subscriptions:live.subscriptions||{}
    };
  },
  beforeStart: async (actor) => {
    const st=followathon.getPublicState();
    if(st?.exists&&(st.status==="running"||st.status==="paused"))await followathon.action("end",{},actor);
  }
});
const subathonActive=()=>{try{const st=subathon.getPublicState();return st?.exists&&(st.status==="running"||st.status==="paused");}catch{return false;}};
twitchEvents.on("subathon-subscribe","Subathon-Abo konnte nicht verarbeitet werden",({event,metadata})=>{if(!moduleOn("subathon"))return;return subathon.handleSubscribe(event,metadata);});
twitchEvents.on("subathon-gift","Subathon-Geschenkabo konnte nicht verarbeitet werden",({event,metadata})=>{if(!moduleOn("subathon"))return;return subathon.handleGift(event,metadata);});
twitchEvents.on("subathon-resub","Subathon-Resub konnte nicht verarbeitet werden",({event,metadata})=>{if(!moduleOn("subathon"))return;return subathon.handleResub(event,metadata);});
twitchEvents.on("subathon-cheer","Subathon-Bits konnten nicht verarbeitet werden",({event,metadata})=>{if(!moduleOn("subathon"))return;return subathon.handleCheer(event,metadata);});
twitchEvents.on("follow","Subathon-Follow konnte nicht verarbeitet werden",({event,metadata})=>{if(!moduleOn("subathon"))return;return subathon.handleFollow(event,metadata);});

function connectionCallbackHtml(title, body, ok=true) {
  const safeTitle = String(title).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const safeBody = String(body).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title><style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#15191f;color:#eef2f5;display:grid;place-items:center;min-height:100vh;margin:0}
  .box{max-width:620px;background:#1d232b;border:1px solid #343d47;border-radius:14px;padding:28px;box-shadow:0 20px 60px #0007}
  h1{margin-top:0}.ok{color:#9be0aa}.bad{color:#ff9e9e}a{color:#fab70a}
  </style></head><body><div class="box"><h1 class="${ok?"ok":"bad"}">${safeTitle}</h1><p>${safeBody}</p><p><a href="/">Zurück zum Control Center</a></p></div><script src="/auth-callback.js"></script></body></html>`;
}


function discordDeniedHtml(title, body, seconds=10) {
  const esc = (v) => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]));
  const safeTitle=esc(title), safeBody=esc(body);
  const wait=Math.max(1,Number(seconds)||10);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title><style>
  :root{color-scheme:dark}body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#15191f;color:#eef2f5;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box}.box{width:min(680px,100%);background:#1d232b;border:1px solid #343d47;border-radius:16px;padding:30px;box-shadow:0 20px 60px #0007}.icon{font-size:42px}.bad{color:#ff9e9e}.count{font-weight:800;color:#c9d2dc}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;font-weight:800;border-radius:10px;padding:12px 18px;background:#5865F2;color:white}.btn.secondary{background:#2b313a;color:#eef2f5;border:1px solid #46505c}p{line-height:1.55}
  </style></head><body><div class="box"><div class="icon">⚠️</div><h1 class="bad">${safeTitle}</h1><p>${safeBody}</p><p>Du wirst in <span id="count" class="count" data-seconds="${wait}">${wait}</span> Sekunden automatisch zur Anmeldeseite zurückgeleitet.</p><div class="actions"><a class="btn" href="/">Jetzt zurück zur Anmeldung</a></div></div><script src="/auth-denied.js"></script></body></html>`;
}

const oauthStates = new Map();
const discordOauthStates = new Map();
const oauthStartRate = new Map();
function oauthStartAllowed(ip){
  const key=String(ip||"unknown"),now=Date.now(),windowMs=15*60*1000;
  let rec=oauthStartRate.get(key);
  if(!rec||now-rec.startedAt>windowMs){rec={startedAt:now,count:0};}
  rec.count++;oauthStartRate.set(key,rec);
  return rec.count<=20;
}
function oauthTxHash(value){return crypto.createHash("sha256").update(String(value||"")).digest("hex");}
function newOauthTransaction(req){
  const nonce=crypto.randomBytes(32).toString("hex");
  return {nonce,hash:oauthTxHash(nonce),cookie:oauthTransactionCookie(req,nonce,600)};
}
function oauthTransactionMatches(req,entry){
  const nonce=parseCookies(req).bwkoauth||"";
  return !!entry?.txHash&&!!nonce&&safeEqual(oauthTxHash(nonce),entry.txHash);
}
function cleanupOauthStates(){
  const cutoff=Date.now()-OAUTH_STATE_TTL_MS;
  for(const [k,v] of oauthStates)if(Number(v?.createdAt||0)<cutoff)oauthStates.delete(k);
  for(const [k,v] of discordOauthStates)if(Number(v?.createdAt||0)<cutoff)discordOauthStates.delete(k);
  if(oauthStates.size>OAUTH_STATE_MAX)for(const k of [...oauthStates.keys()].slice(0,oauthStates.size-OAUTH_STATE_MAX))oauthStates.delete(k);
  if(discordOauthStates.size>OAUTH_STATE_MAX)for(const k of [...discordOauthStates.keys()].slice(0,discordOauthStates.size-OAUTH_STATE_MAX))discordOauthStates.delete(k);
}
function pkcePair(){
  const verifier=crypto.randomBytes(48).toString("base64url");
  const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
  return {verifier,challenge};
}

function discordRedirectUri(){const b=publicBaseUrl();return b?installationKit.redirectUrls(b).discord:"";}
async function discordOAuthConfig(){
  const result=await discordServiceRequest(`/oauth/config?redirectUri=${encodeURIComponent(discordRedirectUri())}`);
  if(!result.body?.clientId || !result.body?.redirectUri) throw new Error("Discord OAuth ist nicht vollständig konfiguriert.");
  return result.body;
}
async function discordOAuthExchange(code,codeVerifier){
  const result=await discordServiceRequest("/oauth/exchange",{method:"POST",body:JSON.stringify({code,codeVerifier,redirectUri:discordRedirectUri()})});
  if(!result.body?.ok || !result.body?.user) throw new Error(result.body?.error||"Discord OAuth fehlgeschlagen.");
  return result.body;
}
function upsertDiscordIdentityForManagedUser(data,target,user){
  const existingOther=data.users.find(x=>String(x.discordUserId||"")===String(user.id)&&x.id!==target.id);
  if(existingOther) throw new Error("Dieses Discord-Konto ist bereits einem anderen Control-Center-Konto zugeordnet.");
  target.discordUserId=String(user.id);
  target.discordUsername=String(user.username||"");
  target.discordDisplayName=String(user.global_name||user.username||"");
  target.discordAvatar=String(user.avatar||"");
  target.updatedAt=new Date().toISOString();
  return target;
}
function ensureManagedFromTwitchSession(raw,actor="system"){
  const data=readUsers();
  let target=findManagedUserByTwitchId(raw.id);
  if(!target){
    target=normalizeManagedUser({
      twitchUserId:raw.id,
      login:raw.login,
      displayName:raw.name||raw.login,
      role:String(raw.login||"").toLowerCase()===channelLoginCmp()?"owner":(raw.isModerator?"editor":"viewer"),
      enabled:true,
      globalOwner:String(raw.login||"").toLowerCase()===channelLoginCmp(),
      createdAt:new Date().toISOString(),
      createdBy:actor
    });
    data.users.push(target);
    writeUsers(data);
  }
  return target;
}
async function getTwitchIdentity(accessToken) {
  const meR = await fetch("https://api.twitch.tv/helix/users", {
    headers:{Authorization:`Bearer ${accessToken}`,"Client-Id":CLIENT_ID}
  });
  const meJ = await meR.json();
  return meJ.data?.[0] || null;
}

async function isChannelModerator(accessToken, me) {
  if (!me) return false;
  if (me.login.toLowerCase() === channelLoginCmp()) return true;

  const r = await fetch(`https://api.twitch.tv/helix/moderation/channels?user_id=${encodeURIComponent(me.id)}&first=100`, {
    headers:{Authorization:`Bearer ${accessToken}`,"Client-Id":CLIENT_ID}
  });
  const j = await r.json();
  if (!r.ok) return false;

  return !!j.data?.some(x => x.broadcaster_login?.toLowerCase() === channelLoginCmp());
}

function resolveLoginAccess(me, isModerator) {
  if (!me) return null;

  if (me.login.toLowerCase() === channelLoginCmp()) {
    return {role:"owner", source:"broadcaster"};
  }

  const managed = findManagedUser(me.id);
  if (managed) {
    if(!managed.enabled)return null;
    const hasStoredTwitchCapabilities=Array.isArray(managed.capabilities)&&managed.capabilities.length>0;
    const roleDerived=managed.createdBy==="twitch-moderator-login"&&(!managed.updatedBy||managed.updatedBy==="twitch-moderator-login")&&!hasStoredTwitchCapabilities;
    if(roleDerived)return isModerator?{role:"editor",source:"twitch-moderator"}:null;
    return {role:normalizeRole(managed.role), source:"allowlist"};
  }

  if (isModerator) {
    return {role:"editor", source:"twitch-moderator"};
  }

  return null;
}


async function appTokenStatus() {
  try {
    const token = await getAppAccessToken();
    return {
      present: true,
      valid: appTokenStillValid(token),
      expiresAt: token.expires_at || null
    };
  } catch (e) {
    return {
      present: fs.existsSync(FILES.app),
      valid: false,
      error: e.message
    };
  }
}



async function discordServiceBinary(pathname){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
    if(!internalServiceSecretReady())throw new Error("INTERNAL_SERVICE_SECRET fehlt, ist zu kurz oder enthält noch den Platzhalter.");
    const response=await fetch(`${DISCORD_SERVICE_URL}${pathname}`,{signal:controller.signal,headers:internalServiceHeaders()});
    const maxBytes=20*1024*1024,declared=Number(response.headers.get("content-length")||0);
    if(Number.isFinite(declared)&&declared>maxBytes)throw new Error("Discord-Binärantwort ist zu groß.");
    const chunks=[];let total=0;
    for await(const chunk of response.body){total+=chunk.length;if(total>maxBytes){controller.abort();throw new Error("Discord-Binärantwort ist zu groß.");}chunks.push(Buffer.from(chunk));}
    const buffer=Buffer.concat(chunks);
    if(!response.ok){
      let detail="";try{detail=JSON.parse(buffer.toString("utf8")).error||""}catch{}
      throw new Error(detail||`Discord-Service HTTP ${response.status}`);
    }
    return {status:response.status,buffer,contentType:response.headers.get("content-type")||"application/octet-stream",contentLength:String(buffer.length)};
  }catch(e){
    if(e.name==="AbortError")throw new Error("Discord-Service antwortet nicht innerhalb von 5 Sekunden.");
    throw e;
  }finally{clearTimeout(timer);}
}


function safeAttachmentName(value){
  return String(value||"attachment.bin").replace(/[^A-Za-z0-9._-]/g,"_").slice(-120)||"attachment.bin";
}
function rasterMimeFromBuffer(buf){
  if(!Buffer.isBuffer(buf)||buf.length<12)return null;
  if(buf.slice(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return"image/png";
  if(buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)return"image/jpeg";
  const six=buf.slice(0,6).toString("ascii");if(six==="GIF87a"||six==="GIF89a")return"image/gif";
  if(buf.slice(0,4).toString("ascii")==="RIFF"&&buf.slice(8,12).toString("ascii")==="WEBP")return"image/webp";
  return null;
}

const { discordControlCenterAllowed } = require("/shared/discord-admin-access");
function internalDiscordAdminAuth(req){
  const supplied=String(req.headers["x-bwk-service-secret"]||"");
  if(INTERNAL_SERVICE_SECRET.length<32||supplied.length!==INTERNAL_SERVICE_SECRET.length)return false;
  return crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(INTERNAL_SERVICE_SECRET));
}

// 8.8.1: Mindestabstand für die Discord-Konfigurationsprüfung (gemeinsam für alle Benutzer).
const DISCORD_VERIFY_MIN_INTERVAL_MS = 15000;
const discordVerifyThrottle = {
  last: 0,
  check(now = Date.now()) {
    const wait = this.last + DISCORD_VERIFY_MIN_INTERVAL_MS - now;
    if (wait > 0) return wait;
    this.last = now;
    return 0;
  }
};

const server = http.createServer(async (req, res) => {
  try {
    // Internal container-only Discord permission lookup. No session or public API access.
    if(req.url==="/internal/discord/admin-access") {
      if(req.method!=="POST")return json(res,405,{ok:false});
      if(!internalDiscordAdminAuth(req))return json(res,401,{ok:false});
      const body=await readBody(req);
      const id=String(body?.discordUserId||"");
      if(!/^\d{15,22}$/.test(id))return json(res,400,{ok:false});
      const member=findManagedUserByDiscordId(id);
      const allowed=discordControlCenterAllowed(member);
      return json(res,200,{ok:true,allowed,url:allowed&&/^https:\/\//.test(publicBaseUrl())?`${publicBaseUrl()}/auth/discord`:null});
    }
    // 9.4.0: Modulstand für den Discord-Bot (nur Docker-Netz, nur mit Dienst-Geheimnis).
    if(req.url==="/internal/modules") {
      if(req.method!=="GET")return json(res,405,{ok:false});
      if(!internalDiscordAdminAuth(req))return json(res,401,{ok:false});
      const s=currentModuleSettings();normalizeWordFilterActive(s);
      return json(res,200,{ok:true,modules:s.modules,features:controlFeatures(s)});
    }
    // 8.9.22: interne Gegenstelle für den eigenen Twitch-Bot-Dienst (nur Docker-Netz, nur mit Dienst-Geheimnis).
    if(req.url.startsWith("/internal/twitch/")) {
      if(!internalDiscordAdminAuth(req))return json(res,401,{ok:false});
      const internalPath=req.url.split("?")[0];
      // Der Twitch-Bot fragt vor dem Start, ob die Weboberfläche ihn als eigenen Dienst erwartet. Seit 9.0.0 immer;
      // die Abfrage bleibt, damit ein neuer Bot neben einer älteren Weboberfläche (mit eingebautem Bot) untätig bleibt.
      if(internalPath==="/internal/twitch/mode"&&req.method==="GET")return json(res,200,{ok:true,mode:"remote"});
      if(internalPath==="/internal/twitch/chat-commands"&&req.method==="GET")return json(res,200,{ok:true,commands:Object.keys(twitchEvents.describe().chatCommands)});
      if(internalPath==="/internal/twitch/event"&&req.method==="POST"){
        const body=await readBody(req);
        const type=String(body?.type||"");
        if(!/^[a-z][a-z0-9-]{0,39}$/.test(type))return json(res,400,{ok:false});
        if(!twitchEventFirstTime(body?.id))return json(res,200,{ok:true,delivered:0,duplicate:true});
        return json(res,200,{ok:true,delivered:await twitchEvents.emit(type,body?.payload??null)});
      }
      if(internalPath==="/internal/twitch/chat-command"&&req.method==="POST"){
        const body=await readBody(req);
        if(!body?.event||typeof body.event!=="object"||typeof body.message!=="string"||body.message.length>2000)return json(res,400,{ok:false});
        return json(res,200,{ok:true,handled:await twitchEvents.dispatchChatCommand(body.event,body.message)});
      }
      return json(res,404,{ok:false});
    }
    for(const [k,v] of Object.entries(securityHeaders(req)))res.setHeader(k,v);
    clientNet.observe(req);
    if(!hostAllowed(req))return json(res,400,{error:"Ungültiger Host."});
    const u = new URL(req.url, `http://${req.headers.host}`);
    if(!csrfRequestAllowed(req)) return json(res,403,{error:"Cross-Site-Anfrage blockiert."});
    const privileged=privilegedRouteRequirement(u.pathname,req.method);
    if(privileged==="owner"&&!requireGlobalOwner(req,res))return;
    if(privileged==="admin"&&!requireGlobalAdmin(req,res))return;
    const routeCapability=apiCapabilityFor(u.pathname,req.method);
    const routeAnyCapabilities=apiAnyCapabilitiesFor(u.pathname,req.method);
    if(routeCapability && !requireCapability(req,res,routeCapability)) return;
    if(routeAnyCapabilities && !requireAnyCapability(req,res,routeAnyCapabilities)) return;
    if(
      u.pathname.startsWith("/api/") &&
      !routeCapability &&
      !routeAnyCapabilities &&
      !privileged &&
      !apiRouteExplicitlyGuarded(u.pathname)
    ){
      audit(sessionUser(req)?.login||sessionUser(req)?.discordUsername||"anonymous","access.default-deny",{path:u.pathname,method:req.method});
      return json(res,403,{error:"API-Route ist nicht in der Autorisierungsmatrix freigegeben."});
    }
    // 9.2.0: Ausgeschaltete Module sind nicht erreichbar. OBS-Seiten bleiben leer, öffentliche Zustände melden „aus“,
    // Ereignisströme werden ohne Inhalt beendet, Verwaltungsschnittstellen antworten mit 404. Daten bleiben unberührt.
    {
      const route=routeModule(u.pathname);
      if(route&&moduleOff(route.module)){
        if(route.kind==="overlay")return send(res,200,EMPTY_OVERLAY_HTML,"text/html; charset=utf-8",{"Cache-Control":"no-store"});
        if(route.kind==="state")return json(res,200,{enabled:false,moduleDisabled:true});
        if(route.kind==="stream"){res.writeHead(204,{"Cache-Control":"no-store"});return res.end();}
        return json(res,404,{error:"Modul ist ausgeschaltet.",module:route.module});
      }
    }
    if (u.pathname === "/health") return json(res, 200, {ok:true});
    if (u.pathname === csp.REPORT_PATH && req.method === "POST") {
      // N-4: CSP-Meldungen des Testmodus. Ohne Anmeldung erreichbar, daher klein, begrenzt und nur aggregiert.
      if(!cspReports.allow(clientIp(req))){res.writeHead(429);return res.end();}
      try{
        const chunks=[];let total=0;
        for await(const c of req){total+=c.length;if(total>8192){res.writeHead(413);return res.end();}chunks.push(c);}
        cspReports.record(Buffer.concat(chunks).toString("utf8"));
      }catch{}
      res.writeHead(204);return res.end();
    }

    // 9.6.0: Wortfilter je Plattform ein-/ausschalten (zweite Ebene unter dem Modul „Wortfilter“).
    if (u.pathname === "/api/word-filter/active" && req.method === "PUT") {
      const me=sessionUser(req);const body=await readBody(req);
      const platform=String(body?.platform||"");
      if(!["twitch","discord"].includes(platform)||typeof body?.enabled!=="boolean")return json(res,400,{ok:false,error:"Ungültige Angabe."});
      const caps=platform==="twitch"?["twitch.moderation.edit","twitch.blocked.edit"]:["discord.moderation.edit"];
      if(!me||!caps.some(c=>hasCapability(me,c)))return json(res,403,{ok:false,error:"Keine Berechtigung für diese Plattform."});
      const current=readJson(FILES.settings,DEFAULT_SETTINGS);prepareSettingsFull(current);
      const before=current.wordFilterActive[platform].enabled;
      current.wordFilterActive[platform].enabled=body.enabled;
      writeJson(FILES.settings,current);
      if(before!==body.enabled)audit(me.login||me.discordUsername||me.name||"admin",body.enabled?"word-filter.platform.enabled":"word-filter.platform.disabled",{section:"wordFilter",platform,before,after:body.enabled});
      if(platform==="discord")pushControlStateToDiscord("Wortfilter Discord");
      try{syncEventProfilesAfterChange(me.login||me.name||"admin","word-filter-active");}catch{}
      return json(res,200,{ok:true,active:current.wordFilterActive});
    }
    if (u.pathname === "/api/word-filter" && req.method === "GET") {
      try{
        const snapshot=pgStore.wordFilterSnapshot();
        snapshot.hits=pgStore.wordFilterHits(100);
        const s=readJson(FILES.settings,DEFAULT_SETTINGS);normalizeWordFilterActive(s);
        return json(res,200,{ok:true,...snapshot,active:s.wordFilterActive});
      }catch(e){return json(res,500,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/term" && req.method === "POST") {
      try{
        const body=await readBody(req),me=sessionUser(req),term=body.term||{};
        if(String(term.detection_type||"")==="regex"){const v=validateWordFilterRegex(term.term);if(!v.ok)return json(res,400,{ok:false,error:`Regex ungültig: ${v.error}`});}
        term.term_id=String(term.term_id||crypto.randomUUID());term.created_by=me?.login||me?.name||"admin";
        pgStore.upsertWordFilterTerm(term);await wordFilterChanged();
        audit(term.created_by,"word-filter.term.saved",{section:"wordFilter",termId:term.term_id,term:term.term,category:term.category_id});
        return json(res,200,{ok:true,termId:term.term_id,revision:wordFilterRefresh().revision});
      }catch(e){return json(res,e.code==="23505"?409:400,{ok:false,error:e.code==="23505"?"Begriff ist mit dieser Erkennungsart bereits vorhanden.":e.message});}
    }
    if (u.pathname === "/api/word-filter/term" && req.method === "DELETE") {
      try{
        const body=await readBody(req),me=sessionUser(req);pgStore.deleteWordFilterTerm(body.termId);await wordFilterChanged();
        audit(me?.login||me?.name||"admin","word-filter.term.deleted",{section:"wordFilter",termId:body.termId});
        return json(res,200,{ok:true});
      }catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/category" && req.method === "POST") {
      try{const body=await readBody(req),me=sessionUser(req),c=body.category||{};c.category_id=String(c.category_id||c.name||"").toLocaleLowerCase("de-DE").replace(/[^a-z0-9äöüß]+/g,"-").replace(/^-|-$/g,"");pgStore.upsertWordFilterCategory(c);await wordFilterChanged();audit(me?.login||me?.name||"admin","word-filter.category.saved",{section:"wordFilter",categoryId:c.category_id});return json(res,200,{ok:true,categoryId:c.category_id});}catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/policy" && req.method === "POST") {
      try{const body=await readBody(req),me=sessionUser(req);pgStore.setWordFilterPolicy(body.policy||{});await wordFilterChanged();audit(me?.login||me?.name||"admin","word-filter.policy.saved",{section:"wordFilter",policy:body.policy});return json(res,200,{ok:true});}catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/allow" && req.method === "POST") {
      try{const body=await readBody(req),me=sessionUser(req),item=body.item||{};item.allow_id=String(item.allow_id||crypto.randomUUID());item.created_by=me?.login||me?.name||"admin";pgStore.upsertWordFilterAllow(item);await wordFilterChanged();audit(item.created_by,"word-filter.allow.saved",{section:"wordFilter",allowId:item.allow_id,value:item.value});return json(res,200,{ok:true,allowId:item.allow_id});}catch(e){return json(res,e.code==="23505"?409:400,{ok:false,error:e.code==="23505"?"Allowlist-Eintrag ist bereits vorhanden.":e.message});}
    }
    if (u.pathname === "/api/word-filter/allow" && req.method === "DELETE") {
      try{const body=await readBody(req);pgStore.deleteWordFilterAllow(body.allowId);await wordFilterChanged();return json(res,200,{ok:true});}catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/import" && req.method === "POST") {
      try{
        const body=await readBody(req),me=sessionUser(req),rows=Array.isArray(body.terms)?body.terms:[];
        if(rows.length>5000)return json(res,400,{ok:false,error:"Maximal 5.000 Begriffe pro Import."});
        const importData={import_id:crypto.randomUUID(),source_name:String(body.sourceName||"Manueller Import").slice(0,160),source_license:body.sourceLicense?String(body.sourceLicense).slice(0,160):null,source_version:body.sourceVersion||null,filename:body.filename||null,format:body.format||"txt",created_by:me?.login||me?.name||"admin",terms:rows.map((x,i)=>({...x,term_id:x.term_id||crypto.randomUUID(),enabled:x.enabled===true,test_only:x.test_only!==false}))};
        const result=pgStore.importWordFilter(importData);await wordFilterChanged();audit(importData.created_by,"word-filter.imported",{section:"wordFilter",importId:result.importId,source:importData.source_name,inserted:result.inserted,duplicates:result.duplicates,total:result.total});return json(res,200,result);
      }catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/import/ldnoobw-de" && req.method === "POST") {
      try{
        const me=sessionUser(req),file="/shared/ldnoobw-de.txt",rows=fs.readFileSync(file,"utf8").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
        const importData={import_id:crypto.randomUUID(),source_name:"LDNOOBW/de",source_license:"CC BY 4.0",source_version:"Repository master, geprüft 2026-10-18",filename:"de",format:"txt",created_by:me?.login||me?.name||"admin",terms:rows.map(term=>({term_id:crypto.randomUUID(),term,category_id:"benutzerdefiniert",severity:2,detection_type:"whole_word",enabled:false,test_only:true,platforms:[{platform:"twitch",enabled:false},{platform:"discord",enabled:false}]}))};
        const result=pgStore.importWordFilter(importData);await wordFilterChanged();audit(importData.created_by,"word-filter.imported",{section:"wordFilter",importId:result.importId,source:"LDNOOBW/de",inserted:result.inserted,duplicates:result.duplicates,total:result.total});return json(res,200,{...result,license:"CC BY 4.0",source:"LDNOOBW/de"});
      }catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/import/rollback" && req.method === "POST") {
      try{const body=await readBody(req),me=sessionUser(req);const result=pgStore.rollbackWordFilterImport(body.importId);await wordFilterChanged();audit(me?.login||me?.name||"admin","word-filter.import.rollback",{section:"wordFilter",importId:body.importId});return json(res,200,result);}catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/test" && req.method === "POST") {
      try{
        const body=await readBody(req),platform=body.platform==="discord"?"discord":"twitch",snapshot=pgStore.wordFilterSnapshot(),compiled=compileWordFilter(snapshot),content=String(body.content||""),hit=matchWordFilter(compiled,platform,content);
        if(!hit)return json(res,200,{ok:true,matched:false,platform,input:{raw:content,normalized:content.normalize("NFKC").toLocaleLowerCase("de-DE")},suggestions:diagnoseWordFilter(compiled,platform,content)});
        const policy=wordFilterAction(hit,platform),effectiveAction=hit.term.test_only?"log":policy.action;
        const categoryPolicy=(snapshot.policies||[]).find(p=>p.category_id===hit.term.category_id&&p.platform===platform)||{};
        const override=hit.platformRule||{};
        const actionSource=hit.term.test_only?"test-mode":(override.action?"term-override":(categoryPolicy.action?"category-policy":"default"));
        let notificationTarget=null;
        if(effectiveAction==="notify"){try{const lr=await discordServiceRequest("/logs");const cfg=lr.body?.config||{},ev=cfg.events?.["moderation.violation"]||{},id=ev.channelId||cfg.defaultChannelId||null,ch=(lr.body?.catalog?.channels||[]).find(x=>String(x.id)===String(id));notificationTarget=id?{channelId:id,channelName:ch?.name||null}:null;}catch{}}
        const diag=diagnoseWordFilterCandidate(hit.term,platform,content,compiled);
        const actionPlan={deleteMessage:["delete","timeout"].includes(effectiveAction),warnUser:effectiveAction==="warn",notifyModerator:effectiveAction==="notify",timeoutUser:effectiveAction==="timeout",logOnly:["log","allow"].includes(effectiveAction),escalation:!hit.term.test_only&&policy.escalate===true};
        return json(res,200,{ok:true,matched:true,platform,term:{id:hit.term.term_id,term:hit.term.term,category:hit.term.category_id,severity:hit.term.severity,testOnly:hit.term.test_only,detectionType:hit.term.detection_type,leetspeak:!!hit.term.leetspeak,repeatLetters:!!hit.term.repeat_letters,flexSeparators:!!hit.term.flex_separators,source:hit.term.source_name||hit.term.origin||"manuell"},action:effectiveAction,actionSource,categoryAction:categoryPolicy.action||"log",termOverrideAction:override.action||null,timeoutSeconds:policy.timeoutSeconds,messageTemplate:policy.messageTemplate||null,notificationTarget,actionPlan,diagnostics:diag,legacyFallbackActive:!wordFilterCentralReady});
      }catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/hit/false-positive" && req.method === "POST") {
      try{const body=await readBody(req);pgStore.markWordFilterFalsePositive(body.hitId);return json(res,200,{ok:true});}catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/retention" && req.method === "POST") {
      try{const body=await readBody(req),days=Math.max(1,Math.min(3650,Number(body.days||90))),me=sessionUser(req);const result=pgStore.setWordFilterRetention(days);const cleanup=pgStore.cleanupWordFilterHits(days);audit(me?.login||me?.name||"admin","word-filter.retention.updated",{section:"wordFilter",days,deleted:cleanup.deleted});await wordFilterChanged();return json(res,200,{ok:true,days,deleted:cleanup.deleted});}catch(e){return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/word-filter/export" && req.method === "GET") {
      try{const snapshot=pgStore.wordFilterSnapshot();return json(res,200,{version:1,exportedAt:new Date().toISOString(),categories:snapshot.categories,policies:snapshot.policies,terms:snapshot.terms,allowlist:snapshot.allowlist});}catch(e){return json(res,500,{ok:false,error:e.message});}
    }

    const publicSlug=Object.entries(PUBLIC_PAGE_DEFS).find(([,def])=>def.path===u.pathname)?.[0]||null;
    if(publicSlug && req.method==="GET"){
      const store=publicPagesStore(),snapshot=store.pages[publicSlug]?.published;
      if(!snapshot)return send(res,404,"Not found","text/plain; charset=utf-8",{"X-Robots-Tag":"noindex, nofollow, noarchive"});
      return send(res,200,publicSiteHtml(publicSlug,snapshot,{preview:false}),"text/html; charset=utf-8",{"X-Robots-Tag":"noindex, nofollow, noarchive","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"});
    }
    if(req.method==="GET"){
      const store=publicPagesStore(),vf=store.verification?.published;
      if(vf?.filename && u.pathname===`/${vf.filename}`)return send(res,200,String(vf.content||""),"text/plain; charset=utf-8",{"X-Robots-Tag":"noindex, nofollow, noarchive","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"});
    }
    if(u.pathname.startsWith("/owner-preview/public/")&&req.method==="GET"){
      const me=requireGlobalOwner(req,res);if(!me)return;
      const slug=u.pathname.split("/").filter(Boolean).pop(),def=PUBLIC_PAGE_DEFS[slug],store=publicPagesStore();
      if(!def||!store.pages[slug])return send(res,404,"Not found","text/plain");
      const resolved=publicResolvedDraft(store.pages[slug],store.masterData);
      return send(res,200,publicSiteHtml(slug,resolved,{preview:true}),"text/html; charset=utf-8",{"X-Robots-Tag":"noindex, nofollow, noarchive","Cache-Control":"no-store","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'","X-Content-Type-Options":"nosniff"});
    }
    if(u.pathname==="/api/public-pages"&&req.method==="GET"){
      const me=requireGlobalOwner(req,res);if(!me)return;
      return json(res,200,{...publicPageAdminView(),review:{description:tiktokReviewDescription(),demoFlow:TIKTOK_DEMO_FLOW}});
    }
    if(u.pathname==="/api/public-pages/master-data"&&req.method==="PUT"){
      const me=requireGlobalOwner(req,res);if(!me)return;
      const body=await readBody(req),store=publicPagesStore(),actor=me.login||me.discordUsername||me.name||"Owner";
      for(const key of Object.keys(DEFAULT_PUBLIC_PAGES.masterData)){
        store.masterData[key]=String(body?.[key]??"").trim().slice(0,10000);
      }
      store.masterDataUpdatedAt=new Date().toISOString();store.masterDataUpdatedBy=actor;
      recordPublicPageHistory(store,{action:"master-data.saved",actor,fields:Object.keys(DEFAULT_PUBLIC_PAGES.masterData)});
      savePublicPages(store);audit(actor,"public-page.master-data.saved",{fields:Object.keys(DEFAULT_PUBLIC_PAGES.masterData)});
      return json(res,200,{ok:true,masterData:store.masterData,masterDataUpdatedAt:store.masterDataUpdatedAt,masterDataUpdatedBy:store.masterDataUpdatedBy});
    }
    if(u.pathname==="/api/public-pages/save"&&req.method==="POST"){
      const me=requireGlobalOwner(req,res);if(!me)return;const body=await readBody(req),slug=String(body.slug||""),store=publicPagesStore(),page=store.pages[slug];
      if(!page)return json(res,404,{error:"Unbekannte Seite."});const actor=me.login||me.discordUsername||me.name||"Owner";
      page.draftTitle=String(body.title||"").trim().slice(0,160);page.draftContent=String(body.content||"").slice(0,50000);page.updatedAt=new Date().toISOString();page.updatedBy=actor;
      recordPublicPageHistory(store,{action:"draft.saved",slug,actor});savePublicPages(store);audit(actor,"public-page.draft.saved",{slug});
      return json(res,200,{ok:true,page:publicPageAdminView().pages.find(x=>x.slug===slug)});
    }
    if(u.pathname==="/api/public-pages/publish"&&req.method==="POST"){
      const me=requireGlobalOwner(req,res);if(!me)return;const body=await readBody(req),slug=String(body.slug||""),store=publicPagesStore(),page=store.pages[slug],actor=me.login||me.discordUsername||me.name||"Owner";
      if(!page)return json(res,404,{error:"Unbekannte Seite."});const validation=validatePublicDraft(slug,page,store.masterData);if(!validation.ok)return json(res,400,{error:"Veröffentlichung blockiert.",details:validation.errors});
      const resolved=publicResolvedDraft(page,store.masterData);
      page.published={title:resolved.title,content:resolved.content,publishedAt:new Date().toISOString(),publishedBy:actor,masterDataSnapshot:{...store.masterData}};
      recordPublicPageHistory(store,{action:"page.published",slug,actor});savePublicPages(store);audit(actor,"public-page.published",{slug,path:PUBLIC_PAGE_DEFS[slug].path});
      return json(res,200,{ok:true});
    }
    if(u.pathname==="/api/public-pages/unpublish"&&req.method==="POST"){
      const me=requireGlobalOwner(req,res);if(!me)return;const body=await readBody(req),slug=String(body.slug||""),store=publicPagesStore(),page=store.pages[slug],actor=me.login||me.discordUsername||me.name||"Owner";
      if(!page)return json(res,404,{error:"Unbekannte Seite."});page.published=null;recordPublicPageHistory(store,{action:"page.unpublished",slug,actor});savePublicPages(store);audit(actor,"public-page.unpublished",{slug});return json(res,200,{ok:true});
    }
    if(u.pathname==="/api/public-pages/verification/save"&&req.method==="POST"){
      const me=requireGlobalOwner(req,res);if(!me)return;const body=await readBody(req),store=publicPagesStore(),actor=me.login||me.discordUsername||me.name||"Owner";
      store.verification.draftFilename=String(body.filename||"").trim().slice(0,128);store.verification.draftContent=String(body.content||"").slice(0,12000);store.verification.updatedAt=new Date().toISOString();store.verification.updatedBy=actor;
      recordPublicPageHistory(store,{action:"verification.draft.saved",actor,filename:store.verification.draftFilename});savePublicPages(store);audit(actor,"public-verification.draft.saved",{filename:store.verification.draftFilename});
      return json(res,200,{ok:true,validation:validateVerificationDraft(store.verification)});
    }
    if(u.pathname==="/api/public-pages/verification/publish"&&req.method==="POST"){
      const me=requireGlobalOwner(req,res);if(!me)return;const store=publicPagesStore(),actor=me.login||me.discordUsername||me.name||"Owner",validation=validateVerificationDraft(store.verification);
      if(!validation.ok)return json(res,400,{error:"Veröffentlichung blockiert.",details:validation.errors});store.verification.published={filename:store.verification.draftFilename,content:store.verification.draftContent,publishedAt:new Date().toISOString(),publishedBy:actor};
      recordPublicPageHistory(store,{action:"verification.published",actor,filename:store.verification.published.filename});savePublicPages(store);audit(actor,"public-verification.published",{filename:store.verification.published.filename});
      return json(res,200,{ok:true,url:publicBaseUrl()?`${publicBaseUrl()}/${store.verification.published.filename}`:`/${store.verification.published.filename}`});
    }
    if(u.pathname==="/api/public-pages/verification/unpublish"&&req.method==="POST"){
      const me=requireGlobalOwner(req,res);if(!me)return;const store=publicPagesStore(),actor=me.login||me.discordUsername||me.name||"Owner";store.verification.published=null;recordPublicPageHistory(store,{action:"verification.unpublished",actor});savePublicPages(store);audit(actor,"public-verification.unpublished",{});return json(res,200,{ok:true});
    }

    if(u.pathname==="/auth/tiktok/callback"&&req.method==="GET"){
      if(!tiktokRedirectUri())return send(res,500,"Die öffentliche Adresse (PUBLIC_BASE_URL bzw. Profil & Branding) ist nicht eingerichtet.","text/plain; charset=utf-8");
      try{
        const body={redirectUri:tiktokRedirectUri(),state:u.searchParams.get("state"),code:u.searchParams.get("code"),error:u.searchParams.get("error"),errorDescription:u.searchParams.get("error_description"),scopes:u.searchParams.get("scopes")};
        const result=await discordServiceRequest("/social/tiktok/oauth/callback",{method:"POST",body:JSON.stringify(body)}),ok=result.status>=200&&result.status<300&&result.body?.ok,title=ok?"TikTok verbunden":"TikTok-Verbindung fehlgeschlagen";
        const detail=ok?`Autorisierung abgeschlossen. Gewährte Scopes: ${(result.body?.grantedScopes||[]).join(", ")||"keine Angabe"}`:(result.body?.error||"Unbekannter OAuth-Fehler.");
        if(ok)audit(result.body?.initiatedBy||"owner","social.tiktok.oauth.completed",{scopes:result.body?.grantedScopes||[],missingScopes:result.body?.missingScopes||[]});
        return send(res,ok?200:400,`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escHtml(title)}</title></head><body style="font-family:system-ui;max-width:700px;margin:60px auto;padding:20px"><h1>${escHtml(title)}</h1><p>${escHtml(detail)}</p><p>Dieses Fenster kann geschlossen werden. Aktualisiere anschließend das Control Center.</p></body></html>`,"text/html; charset=utf-8",{"X-Robots-Tag":"noindex, nofollow","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"});
      }catch(err){return send(res,400,`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"></head><body><h1>TikTok-Verbindung fehlgeschlagen</h1><p>${escHtml(err.message)}</p></body></html>`,"text/html; charset=utf-8",{"X-Robots-Tag":"noindex, nofollow"});}
    }

    // 9.11.0: öffentlicher Name der Oberfläche (für Anmeldeseite und Kopfzeile) und Stand der Ersteinrichtung.
    if (u.pathname === "/api/branding" && req.method === "GET") {
      return json(res,200,brandingPublic());
    }
    // 9.22.0: Lizenz (BCC-CL): Kenndaten und vollständiger Text, öffentlich lesbar.
    if (u.pathname === "/api/license" && req.method === "GET") {
      const acc=installationProfile().license;
      return json(res,200,{license:licenseInfo(),current:licenseKit.isCurrent(installationProfile().license),
        acceptance:acc?{version:acc.version,acceptedAt:acc.acceptedAt,source:acc.source}:null});
    }
    // 9.24.0: Begleitdokumente (Datenschutz, Sicherheit, Drittkomponenten, Mitwirken, Urheberhinweis), öffentlich lesbar.
    if (u.pathname === "/api/legal" && req.method === "GET") {
      const key=u.searchParams.get("doc");
      if(!key)return json(res,200,{documents:legalDocs.list()});
      const text=legalDocs.read(PUBLIC_DIR,key);
      if(text===null)return send(res,404,"Dokument nicht gefunden.","text/plain; charset=utf-8");
      return send(res,200,text,"text/markdown; charset=utf-8",{"Cache-Control":"no-cache"});
    }
    if (u.pathname === "/api/license/text" && req.method === "GET") {
      const text=licenseKit.readText(PUBLIC_DIR);
      if(!text)return send(res,404,"Lizenztext nicht gefunden.","text/plain; charset=utf-8");
      return send(res,200,text,"text/markdown; charset=utf-8",{"Cache-Control":"no-cache"});
    }
    if (u.pathname === "/api/setup/status" && req.method === "GET") {
      if(!setupPendingNow())return json(res,200,{pending:false});
      ensureSetupCode();
      const base=publicBaseInfo();
      return json(res,200,{pending:true,license:licenseInfo(),productName:installationProfile().productName,
        publicBase:{locked:base.locked,url:base.locked?base.url:"",suggestion:base.locked?base.url:installationKit.suggestBaseUrl({host:req.headers.host,https:requestIsHttps(req)})},
        bots:{mainLogin:botRoster.mainBot(botRosterNow()).login,mainName:botRoster.mainBot(botRosterNow()).displayName,channelLogin:channelLoginNow(),channelLocked:!!CHANNEL_LOGIN},
        discord:{guildId:installationProfile().discord?.guildId||""},
        game:installationProfile().game,commandLabels:installationKit.GAME_COMMAND_LABELS,fixedCommands:[...installationKit.FIXED_GAME_COMMANDS]});
    }
    if (u.pathname === "/api/setup/complete" && req.method === "POST") {
      if(!setupPendingNow())return json(res,409,{error:"Die Ersteinrichtung ist bereits abgeschlossen."});
      const ip=clientIp(req);
      if(!setupAttemptAllowed(ip))return json(res,429,{error:"Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen."});
      const body=await readBody(req);
      const code=ensureSetupCode();
      if(!installationKit.setupCodeMatches(body?.code,code)){
        recordSetupFailure(ip);
        authLog({platform:"Lokal",username:"ersteinrichtung",result:"failed",reason:"Einrichtungscode falsch",source:"setup"});
        return json(res,401,{error:"Der Einrichtungscode stimmt nicht. Er steht im Protokoll des Containers bcc-web."});
      }
      // 9.22.0: Ohne Annahme der Lizenzbedingungen (aktuelle Version) wird nichts eingerichtet.
      const lic=licenseInfo();
      if(!lic.available)return json(res,500,{error:"Der Lizenztext fehlt in dieser Installation (public/license). Bitte die Installation neu einspielen."});
      if(body?.licenseAccepted!==true||String(body?.licenseVersion||"")!==lic.version)return json(res,400,{error:`Bitte die Lizenzbedingungen (${lic.name}, Version ${lic.version}) lesen und akzeptieren.`});
      const current=installationProfile({fresh:true});
      const input={productName:body?.productName,game:body?.game};
      if(!publicBaseInfo().locked)input.publicBaseUrl=body?.publicBaseUrl;
      // 9.15.0: Haupt-Bot und Kanal-Konto gehören zur Ersteinrichtung (ohne Kanal-Login gibt es keinen Besitzer über Twitch).
      const mainNow=botRoster.mainBot(current.bots);
      input.bots={bots:[{key:mainNow.key,login:body?.mainBotLogin,displayName:String(body?.mainBotName||"").trim()||undefined,main:true}],channel:{login:CHANNEL_LOGIN?"":body?.channelLogin}};
      // 9.15.1: Discord-Server-ID ist optional; die Rollen folgen später unter Discord → Rollen (der Bot muss den Server dafür sehen).
      if(String(body?.discordGuildId||"").trim())input.discord={guildId:body.discordGuildId};
      const {errors,next}=validateProfileInput(input,current);
      if(!CHANNEL_LOGIN&&!String(body?.channelLogin||"").trim())errors.push("Bitte den Twitch-Login des Kanals angeben (der Kanal, in dem die Bots arbeiten; sein Konto erhält Owner-Rechte).");
      if(!publicBaseInfo().locked&&!String(body?.publicBaseUrl||"").trim())errors.push("Bitte die öffentliche Adresse angeben (z. B. https://bot.example.org oder http://localhost:3000).");
      if(errors.length)return json(res,400,{error:errors.join(" "),errors});
      next.setupCompletedAt=new Date().toISOString();next.setupCompletedBy="Einrichtungsassistent";next.source="setup";
      next.license=licenseKit.createAcceptance({version:lic.version,sha256:lic.sha256,by:"Einrichtungsassistent",source:"wizard"});
      const saved=saveInstallationProfile(next);
      setupCode=null;setupAttempts.delete(ip);
      audit("ersteinrichtung","installation.setup.completed",{section:"installation",productName:saved.productName,publicBaseUrl:publicBaseUrl(),game:saved.game});
      audit("ersteinrichtung","installation.license.accepted",{section:"installation",license:lic.id,version:lic.version,sha256:lic.sha256,source:"wizard"});
      console.log(`✅ Ersteinrichtung abgeschlossen (${saved.productName}, ${publicBaseUrl()||"ohne Adresse"}).`);
      return json(res,200,{ok:true,productName:saved.productName,publicBaseUrl:publicBaseUrl(),redirects:installationKit.redirectUrls(publicBaseUrl()),
        localAdminEnabled:LOCAL_ADMIN_ENABLED,channelLogin:channelLoginNow()||null});
    }

    if (u.pathname === "/api/local-login-available" && req.method === "GET") {
      return json(res, 200, {
        enabled: LOCAL_ADMIN_ENABLED && isLocalRequest(req),
        local: isLocalRequest(req)
      });
    }

    if (u.pathname === "/auth/local" && req.method === "POST") {
      const ip = clientIp(req);

      if (!LOCAL_ADMIN_ENABLED) {
        return json(res, 403, { error: "Lokaler Admin-Login ist deaktiviert." });
      }

      if (!isLocalRequest(req)) {
        authLog({platform:"Lokal",username:"local-admin",result:"denied",reason:"nonlocal",source:"local-admin"});
        return json(res, 403, { error: "Lokaler Admin-Login ist nur aus dem lokalen Netz erlaubt." });
      }

      if (!LOCAL_ADMIN_PASSWORD) {
        return json(res, 503, { error: "LOCAL_ADMIN_PASSWORD ist nicht gesetzt." });
      }

      if (!localLoginAllowed(ip)) {
        authLog({platform:"Lokal",username:"local-admin",result:"denied",reason:"rate-limited",source:"local-admin"});
        return json(res, 429, { error: "Zu viele Fehlversuche. Bitte später erneut versuchen." });
      }

      const body = await readBody(req);
      if (!safeEqual(body.password || "", LOCAL_ADMIN_PASSWORD)) {
        recordLocalLoginFailure(ip);
        authLog({platform:"Lokal",username:"local-admin",result:"failed",reason:"Falsches Passwort",source:"local-admin"});
        return json(res, 401, { error: "Falsches Passwort." });
      }

      localLoginAttempts.delete(ip);

      const sid = crypto.randomBytes(32).toString("hex");
      const sessions = sessionStore();
      sessions[sessionKey(sid)] = {
        id: "local-admin",
        login: "local-admin",
        name: "Lokaler Admin",
        localAdmin: true,
        role: "owner",
        accessSource: "local-admin",
        created: new Date().toISOString(),
        securityRevision:SECURITY_SESSION_REVISION,
        ip
      };
      writeSessions(sessions);
      authLog({platform:"Lokal",username:"local-admin",result:"success",source:"local-admin",detail:{role:"owner"}});

      return json(
        res,
        200,
        { ok: true },
        { "Set-Cookie": sessionCookie(req,sid) }
      );
    }

    if (u.pathname === "/api/connections" && req.method === "GET") {
      const me = requireGlobalAdmin(req,res); if (!me) return;
      const items = [];
      for (const acc of twitchAccounts()) {
        items.push(await twitchRuntime.connectionStatus(acc.key));
      }
      return json(res,200,{items,redirectUri:connectionRedirectUri()});
    }

    if (u.pathname.startsWith("/api/connections/") && u.pathname.endsWith("/authorize") && req.method === "POST") {
      const me = requireGlobalAdmin(req,res); if (!me) return;

      cleanupConnectionStates();

      const parts = u.pathname.split("/").filter(Boolean);
      const name = parts[2];
      const meta = twitchAccount(name);

      if (!meta) return json(res,404,{error:"Unbekannter Twitch-Account."});
      if (!connectionRedirectUri()) return json(res,500,{error:"Weiterleitungsadresse fehlt: öffentliche Adresse einrichten (Administration → Profil & Branding) oder TWITCH_CONNECTION_REDIRECT_URI setzen."});

      const state = crypto.randomBytes(32).toString("hex"),pkce=pkcePair(),sid=parseCookies(req).bwksid||null;
      if(!sid)return json(res,401,{error:"Aktive Sitzung fehlt."});
      connectionOauthStates.set(state,{
        account:name,
        initiatedBy:me.login,
        createdAt:Date.now(),
        expiresAt:Date.now()+OAUTH_STATE_TTL_MS,
        sid,
        securityRevision:SECURITY_SESSION_REVISION,
        codeVerifier:pkce.verifier
      });

      const q = new URLSearchParams({
        response_type:"code",
        client_id:CLIENT_ID,
        redirect_uri:connectionRedirectUri(),
        scope:meta.requiredScopes.join(" "),
        state,
        force_verify:"true",
        code_challenge:pkce.challenge,
        code_challenge_method:"S256"
      });

      audit(me.login,"connection.oauth.started",{account:name,login:meta.login,scopes:meta.requiredScopes});
      return json(res,200,{url:`https://id.twitch.tv/oauth2/authorize?${q.toString()}`});
    }

    if (u.pathname === "/auth/connect/callback") {
      cleanupConnectionStates();

      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      const oauthError = u.searchParams.get("error");

      if (!state || !connectionOauthStates.has(state)) {
        return send(res,400,connectionCallbackHtml("Autorisierung fehlgeschlagen","OAuth-State ist ungültig oder abgelaufen.",false),"text/html; charset=utf-8");
      }

      const entry = connectionOauthStates.get(state);
      connectionOauthStates.delete(state);
      const currentSid=parseCookies(req).bwksid||null;
      const currentSessions=sessionStore(),currentRaw=currentSid?sessionRawFor(currentSessions,currentSid):null,currentEffective=effectiveSessionUser(currentRaw);
      if(!currentSid||!entry.sid||!safeEqual(currentSid,entry.sid)||!currentEffective||Number(entry.securityRevision)!==SECURITY_SESSION_REVISION){
        return send(res,401,connectionCallbackHtml("Autorisierung fehlgeschlagen","Die ursprüngliche Control-Center-Sitzung ist nicht mehr gültig.",false),"text/html; charset=utf-8");
      }
      const meta = twitchAccount(entry.account);

      if (oauthError) {
        audit(entry.initiatedBy,"connection.oauth.failed",{account:entry.account,error:oauthError});
        return send(res,400,connectionCallbackHtml("Autorisierung abgebrochen",u.searchParams.get("error_description") || oauthError,false),"text/html; charset=utf-8");
      }

      if (!code || !meta) {
        return send(res,400,connectionCallbackHtml("Autorisierung fehlgeschlagen","Code oder Account-Zuordnung fehlt.",false),"text/html; charset=utf-8");
      }

      const params = new URLSearchParams({
        client_id:CLIENT_ID,
        client_secret:CLIENT_SECRET,
        code,
        grant_type:"authorization_code",
        redirect_uri:connectionRedirectUri(),
        code_verifier:entry.codeVerifier
      });

      const tr = await fetch("https://id.twitch.tv/oauth2/token",{
        method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:params
      });
      const token = await tr.json();

      if (!tr.ok) {
        audit(entry.initiatedBy,"connection.oauth.failed",{account:entry.account,status:tr.status});
        return send(res,400,connectionCallbackHtml("Autorisierung fehlgeschlagen","Twitch konnte den Authorization Code nicht in ein Token umwandeln.",false),"text/html; charset=utf-8");
      }

      const me = await getTwitchIdentity(token.access_token);

      if (!me) {
        return send(res,400,connectionCallbackHtml("Autorisierung fehlgeschlagen","Twitch-Account konnte nicht ermittelt werden.",false),"text/html; charset=utf-8");
      }

      if (me.login.toLowerCase() !== meta.login.toLowerCase()) {
        audit(entry.initiatedBy,"connection.oauth.wrong-account",{
          account:entry.account,
          expected:meta.login,
          actual:me.login
        });
        return send(res,403,connectionCallbackHtml(
          "Falscher Twitch-Account",
          `Erwartet wurde ${meta.displayName} (${meta.login}), angemeldet war aber ${me.display_name} (${me.login}). Bitte erneut starten und den richtigen Twitch-Account wählen.`,
          false
        ),"text/html; charset=utf-8");
      }

      const saved = {
        ...token,
        user_id:me.id,
        login:me.login,
        display_name:me.display_name,
        authorized_at:new Date().toISOString(),
        authorized_by:entry.initiatedBy
      };
      await twitchRuntime.storeAuthorizedToken(entry.account,saved,me.id);

      audit(entry.initiatedBy,"connection.oauth.success",{
        account:entry.account,
        login:me.login,
        userId:me.id,
        scopes:token.scope || []
      });

      return send(res,200,connectionCallbackHtml(
        "Autorisierung erfolgreich",
        `${meta.displayName} ist jetzt mit dem Bot Control Center verbunden.`,
        true
      ),"text/html; charset=utf-8");
    }

    if (u.pathname === "/auth/discord" || u.pathname === "/auth/discord/link") {
      if(!oauthStartAllowed(clientIp(req)))return send(res,429,"Zu viele OAuth-Starts. Bitte später erneut versuchen.","text/plain");
      const linkMode=u.pathname.endsWith("/link");
      let sid=null;
      if(linkMode){
        const me=requireUser(req,res); if(!me)return;
        sid=parseCookies(req).bwksid||null;
        if(!sid) return send(res,400,"Keine aktive Sitzung.","text/plain");
      }
      try{
        cleanupOauthStates();
        const cfg=await discordOAuthConfig();
        const state=crypto.randomBytes(24).toString("hex"),tx=newOauthTransaction(req),pkce=pkcePair();
        discordOauthStates.set(state,{createdAt:Date.now(),mode:linkMode?"link":"login",sid,txHash:tx.hash,codeVerifier:pkce.verifier});
        const q=new URLSearchParams({
          response_type:"code",
          client_id:cfg.clientId,
          redirect_uri:cfg.redirectUri,
          scope:"identify guilds.members.read",
          state,
          prompt:"consent",
          code_challenge:pkce.challenge,
          code_challenge_method:"S256"
        });
        res.writeHead(302,{"Set-Cookie":tx.cookie,Location:`https://discord.com/oauth2/authorize?${q.toString()}`}); return res.end();
      }catch(e){
        return send(res,502,`Discord OAuth konnte nicht gestartet werden: ${e.message}`,"text/plain");
      }
    }

    if (u.pathname === "/auth/discord/callback") {
      const code=u.searchParams.get("code"), state=u.searchParams.get("state");
      const entry=state?discordOauthStates.get(state):null;
      if(!code||!entry||Date.now()-entry.createdAt>OAUTH_STATE_TTL_MS||!oauthTransactionMatches(req,entry)){
        if(state) discordOauthStates.delete(state);
        authLog({platform:"Discord",username:"unbekannt",result:"failed",reason:"oauth-state-invalid",source:"oauth"});
        return send(res,400,discordDeniedHtml("Discord-Anmeldung fehlgeschlagen","Der Anmeldevorgang ist ungültig oder abgelaufen. Bitte starte die Discord-Anmeldung erneut."),"text/html; charset=utf-8");
      }
      discordOauthStates.delete(state);

      try{
        const identity=await discordOAuthExchange(code,entry.codeVerifier);
        const du=identity.user;
        if(!identity.member || String(identity.member.user?.id||du.id)!==String(du.id)){
          authLog({platform:"Discord",username:du.username||du.id,userId:du.id,result:"denied",reason:"not-guild-member",source:"oauth"});
          return send(res,403,discordDeniedHtml("Discord-Zugang nicht möglich","Dieser Discord-Account ist kein Mitglied des Discord-Servers dieser Installation."),"text/html; charset=utf-8");
        }

        if(entry.mode==="link"){
          const sessions=sessionStore();
          const raw=sessionRawFor(sessions,entry.sid);
          const effective=effectiveSessionUser(raw);
          if(!raw||!effective) return send(res,401,"Die ursprüngliche Sitzung ist nicht mehr gültig.","text/plain");

          const data=readUsers();
          let target=raw.authProvider==="discord"
            ? findManagedUserByDiscordId(raw.discordId)
            : findManagedUserByTwitchId(raw.id);

          if(!target && raw.authProvider!=="discord"){
            target=normalizeManagedUser({
              twitchUserId:raw.id,login:raw.login,displayName:raw.name||raw.login,
              role:String(raw.login||"").toLowerCase()===channelLoginCmp()?"owner":(raw.isModerator?"editor":"viewer"),
              enabled:true,
              globalOwner:String(raw.login||"").toLowerCase()===channelLoginCmp(),
              createdAt:new Date().toISOString(),createdBy:effective.login||"self-link"
            });
            data.users.push(target);
          }else if(target){
            target=data.users.find(x=>x.id===target.id)||target;
          }else{
            return send(res,400,"Für diese Sitzung kann kein Konto verknüpft werden.","text/plain");
          }

          upsertDiscordIdentityForManagedUser(data,target,du);
          if(effective.globalOwner) target.globalOwner=true;
          writeUsers(data);
          audit(effective.login||effective.name||"user","account.discord.linked",{discordUserId:du.id,discordUsername:du.username,internalUserId:target.id});
          return send(res,200,connectionCallbackHtml("Discord verknüpft",`${du.global_name||du.username} ist jetzt mit deinem Control-Center-Konto verknüpft.`,true),"text/html; charset=utf-8",{"Set-Cookie":clearOauthTransactionCookie(req)});
        }

        let managed=findManagedUserByDiscordId(du.id);
        if(!managed){
          const data=readUsers();
          managed=normalizeManagedUser({
            discordUserId:String(du.id),discordUsername:String(du.username||""),
            discordDisplayName:String(du.global_name||du.username||""),discordAvatar:String(du.avatar||""),
            discordBackendEnabled:false,discordRole:"viewer",capabilities:[],capabilitiesCustomized:true,
            createdAt:new Date().toISOString(),createdBy:"discord-self-identification"
          });
          data.users.push(managed);writeUsers(data);
        }

        const sid=crypto.randomBytes(32).toString("hex");
        const sessions=sessionStore();
        const raw={
          authProvider:"discord",
          discordId:String(du.id),
          discordUsername:String(du.username||""),
          discordName:String(du.global_name||du.username||""),
          name:String(du.global_name||du.username||""),
          guildRoles:Array.isArray(identity.member.roles)?identity.member.roles:[],
          created:new Date().toISOString(),
          securityRevision:SECURITY_SESSION_REVISION
        };
        const effective=effectiveSessionUser(raw);
        if(!effective){
          authLog({platform:"Discord",username:du.username||du.id,userId:du.id,result:"denied",reason:"backend-disabled",source:"oauth"});
          return send(res,403,discordDeniedHtml("Backend nicht freigegeben","Dein Discord-Konto wurde erkannt und gespeichert, besitzt aber aktuell keine Backend-Berechtigung. Ein Owner oder Administrator kann dir gezielt Bereiche freigeben."),"text/html; charset=utf-8");
        }
        sessions[sessionKey(sid)]=raw;
        writeSessions(sessions);
        authLog({platform:"Discord",username:du.username||du.id,userId:du.id,result:"success",source:"oauth",detail:{globalOwner:!!effective.globalOwner}});
        res.writeHead(302,{"Set-Cookie":[sessionCookie(req,sid),clearOauthTransactionCookie(req)],Location:"/"}); return res.end();
      }catch(e){
        authLog({platform:"Discord",username:"unbekannt",result:"failed",reason:e.message,source:"oauth"});
        return send(res,502,discordDeniedHtml("Discord-Anmeldung fehlgeschlagen",`Die Anmeldung konnte nicht abgeschlossen werden: ${e.message}`),"text/html; charset=utf-8");
      }
    }

    if (u.pathname === "/auth/login") {
      if(!oauthStartAllowed(clientIp(req)))return send(res,429,"Zu viele OAuth-Starts. Bitte später erneut versuchen.","text/plain");
      cleanupOauthStates();
      const state=crypto.randomBytes(24).toString("hex"),tx=newOauthTransaction(req),pkce=pkcePair();
      oauthStates.set(state,{createdAt:Date.now(),txHash:tx.hash,codeVerifier:pkce.verifier});
      const q = new URLSearchParams({
        response_type:"code", client_id:CLIENT_ID, redirect_uri:twitchRedirectUri(),
        scope:"user:read:moderated_channels", state, force_verify:"true",
        code_challenge:pkce.challenge,code_challenge_method:"S256"
      });
      res.writeHead(302, {"Set-Cookie":tx.cookie,Location:`https://id.twitch.tv/oauth2/authorize?${q.toString()}`}); return res.end();
    }
    if (u.pathname === "/auth/twitch/callback") {
      cleanupOauthStates();
      const code = u.searchParams.get("code"), state = u.searchParams.get("state"),entry=state?oauthStates.get(state):null;
      if (!code || !state || !entry || Date.now()-entry.createdAt>OAUTH_STATE_TTL_MS || !oauthTransactionMatches(req,entry)) {
        if(state)oauthStates.delete(state);
        authLog({platform:"Twitch",username:"unbekannt",result:"failed",reason:"oauth-state-invalid",source:"oauth"});
        return send(res,400,"OAuth state ungültig oder Browserbindung fehlgeschlagen","text/plain",{"Set-Cookie":clearOauthTransactionCookie(req)});
      }
      oauthStates.delete(state);
      const params = new URLSearchParams({client_id:CLIENT_ID,client_secret:CLIENT_SECRET,code,grant_type:"authorization_code",redirect_uri:twitchRedirectUri(),code_verifier:entry.codeVerifier});
      const tr = await fetch("https://id.twitch.tv/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:params});
      const tj = await tr.json();
      if (!tr.ok) {
        authLog({platform:"Twitch",username:"unbekannt",result:"failed",reason:`oauth-token-${tr.status}`,source:"oauth"});
        return send(res,400,"OAuth fehlgeschlagen","text/plain");
      }
      const me = await getTwitchIdentity(tj.access_token);
      if (!me) {
        authLog({platform:"Twitch",username:"unbekannt",result:"failed",reason:"identity",source:"oauth"});
        return send(res,403,"Twitch-Identität konnte nicht geprüft werden.","text/plain");
      }

      const moderator = await isChannelModerator(tj.access_token, me);
      const access = resolveLoginAccess(me, moderator);

      // Twitch-Moderatoren dürfen sich standardmäßig anmelden und das Dashboard sehen.
      // Damit Owner/Admin anschließend individuelle Capabilities vergeben können,
      // wird ihre verifizierte Twitch-Identität beim ersten erfolgreichen Login
      // dauerhaft als interner Benutzer gespeichert.
      if (moderator) {
        const data=readUsers();
        let managed=data.users.find(x=>String(x.twitchUserId||"")===String(me.id));
        if(!managed){
          managed=normalizeManagedUser({
            twitchUserId:String(me.id),
            login:String(me.login||"").toLowerCase(),
            displayName:String(me.display_name||me.login||""),
            role:"editor",
            enabled:true,
            capabilities:[],
            capabilitiesCustomized:true,
            globalOwner:false,
            globalAdmin:false,
            createdAt:new Date().toISOString(),
            createdBy:"twitch-moderator-login"
          });
          data.users.push(managed);
          writeUsers(data);
          audit(me.login,"user.identity.created",{source:"twitch-moderator-login",twitchUserId:me.id});
        } else {
          const target=data.users.find(x=>x.id===managed.id);
          if(target){
            target.login=String(me.login||target.login||"").toLowerCase();
            target.displayName=String(me.display_name||target.displayName||target.login||"");
            target.updatedAt=new Date().toISOString();
            if(target.createdBy==="twitch-moderator-login"&&(!target.updatedBy||target.updatedBy==="twitch-moderator-login"))target.updatedBy="twitch-moderator-login";
            writeUsers(data);
          }
        }
      }

      if (!access) {
        authLog({platform:"Twitch",username:me.login,userId:me.id,result:"denied",reason:"not-authorized",source:"oauth"});
        return send(res,403,"Für diesen Account ist kein Zugriff auf das Control Center freigegeben.","text/plain");
      }

      const sid = crypto.randomBytes(32).toString("hex");
      const sessions = sessionStore();
      sessions[sessionKey(sid)] = {
        id:me.id,
        login:me.login,
        name:me.display_name,
        role:access.role,
        accessSource:access.source,
        isModerator:moderator,
        created:new Date().toISOString(),
        securityRevision:SECURITY_SESSION_REVISION
      };
      writeSessions(sessions);
      authLog({platform:"Twitch",username:me.login,userId:me.id,result:"success",source:access.source,detail:{role:access.role}});
      res.writeHead(302, {"Set-Cookie":[sessionCookie(req,sid),clearOauthTransactionCookie(req)],Location:"/"}); return res.end();
    }
    if (u.pathname === "/auth/logout") {
      if(req.method!=="POST")return json(res,405,{error:"Logout erfordert POST."},{"Allow":"POST"});
      const sid=parseCookies(req).bwksid||null;
      const sessions=sessionStore();
      const raw=sid?sessionRawFor(sessions,sid):null;
      const me=effectiveSessionUser(raw);
      if(raw){delete sessions[sessionKey(sid)];writeSessions(sessions);}
      if(me){
        const platform=me.localAdmin?"Lokal":me.authProvider==="discord"?"Discord":"Twitch";
        authLog({platform,username:me.login||me.discordUsername||me.name||"unknown",userId:me.discordId||me.id||null,result:"logout",source:me.accessSource||null});
      }
      return json(res,200,{ok:true},{"Set-Cookie":sessionCookie(req,"",0)});
    }
    if (u.pathname === "/auth/logout-all") {
      if(req.method!=="POST")return json(res,405,{error:"Logout erfordert POST."},{"Allow":"POST"});
      const me=requireUser(req,res);if(!me)return;
      const sessions=sessionStore();let removed=0;
      for(const [sid,raw] of Object.entries(sessions)){
        const sameLocal=me.localAdmin&&raw?.localAdmin;
        const sameTwitch=!me.localAdmin&&me.authProvider!=="discord"&&String(raw?.id||"")===String(me.id||"");
        const sameDiscord=!me.localAdmin&&me.authProvider==="discord"&&String(raw?.discordId||"")===String(me.discordId||"");
        if(sameLocal||sameTwitch||sameDiscord){delete sessions[sid];removed++;}
      }
      writeSessions(sessions);
      authLog({platform:me.localAdmin?"Lokal":me.authProvider==="discord"?"Discord":"Twitch",username:me.login||me.discordUsername||me.name||"unknown",userId:me.discordId||me.id||null,result:"logout-all",source:me.accessSource||null,detail:{removed}});
      return json(res,200,{ok:true,removed},{"Set-Cookie":sessionCookie(req,"",0)});
    }
    // Persönliche Navigationsfavoriten: persistiert im bestehenden PostgreSQL-Dokumentenspeicher.
    if (u.pathname === "/api/user-favorites" && ["GET","PUT"].includes(req.method)) {
      const me=requireUser(req,res);if(!me)return;
      const identity=String(me.internalUserId||((me.authProvider||"user")+":"+(me.discordId||me.id||"")));
      if(!identity||identity.endsWith(":"))return json(res,403,{error:"Keine stabile Benutzerkennung vorhanden."});
      const key="navigation-favorites:"+crypto.createHash("sha256").update(identity).digest("hex");
      const file=path.join(DATA_DIR,"navigation-favorites.json");
      const storageRead=()=>pgStore.enabled?pgStore.getDocument(key,[]):(readJson(file,{})[key]||[]);
      const storageWrite=value=>{if(pgStore.enabled)pgStore.putDocument(key,value);else{const all=readJson(file,{});all[key]=value;writeJson(file,all);}};
      // Gespeicherte IDs erlauben niemals direkten Zugriff ohne die bestehende Seiten-Autorisierung.
      const allowed={
        dashboard:"twitch.dashboard.view",commands:"twitch.commands.view",timers:"twitch.timers.view",
        autoReplies:"twitch.autoreplies.view",watchtime:"twitch.community.view",followage:"twitch.community.view",
        team:"twitch.team.view",eventprofiles:"twitch.eventprofiles.view",stubenkontrolle:"twitch.stubenkontrolle.view",
        // 9.2.0: fehlende Reiter ergänzt (Stern war sichtbar, Speichern scheiterte); Listen = eines der Rechte genügt.
        autoreplies:"twitch.autoreplies.view",events:"twitch.community.view",chatters:"twitch.followage.view",lurk:"twitch.community.view",
        followerAlert:"twitch.followathon.view",chatOverlay:"twitch.followathon.view",wordFilter:["twitch.moderation.view","twitch.blocked.view","discord.moderation.view"],
        discordInvite:"discord.channels.view",discordLevelPlayers:"discord.moderation.view",discordUserHistory:"discord.moderation.view",
        discordEmergency:"@admin",discordLogsAdmin:"@admin",updates:"@owner",
        socialOverview:"@owner",socialInstagram:"@owner",socialTikTok:"@owner",socialPublications:"@owner",socialSettings:"@owner",
        followathon:"twitch.followathon.view",subathon:"twitch.subathon.view",clips:"twitch.clips.view",giveaway:"twitch.giveaway.view",
        moderation:"twitch.moderation.view",blocked:"twitch.blocked.view",discordOverview:"discord.dashboard.view",
        discordChannels:"discord.channels.view",discordRoles:"discord.roles.view",discordMembers:"discord.members.view",
        discordChannelTimes:"discord.channel-times.view",discordWelcome:"discord.onboarding.view",
        discordAnnouncements:"discord.announcements.view",discordLevelsystem:"discord.moderation.view",
        discordLevelXpRules:"discord.moderation.view",discordLevelRanks:"discord.moderation.view",discordLevelMissions:"discord.moderation.view",discordLevelStatistics:"discord.moderation.view",
        discordModeration:"discord.moderation.view",discordModerationLog:"discord.moderation.view",
        discordSanctions:"discord.moderation.view",discordReports:"discord.reports.view",
        discordAccess:"discord.access.view",statistics:["twitch.statistics.view","discord.statistics.view"],activity:["twitch.activity.view","discord.activity.view"],
        help:null,users:"@admin",loginlogs:"@admin",connections:"@admin",modules:"@admin",profileBranding:"@admin",addressLogin:"@admin",system:"@admin",
        backup:"@owner",database:"@owner",publicWebsites:"@owner"
      };
      const permitted=tab=>{const cap=allowed[tab];if(!(tab in allowed))return false;
        if(cap==="@owner")return !!(me.globalOwner||me.localAdmin||me.role==="owner");
        if(cap==="@admin")return !!(me.globalOwner||me.globalAdmin||me.localAdmin||me.role==="owner"||me.role==="admin");
        if(Array.isArray(cap))return cap.some(c=>hasCapability(me,c));
        return !cap||hasCapability(me,cap);
      };
      if(req.method==="GET")return json(res,200,{items:(Array.isArray(storageRead())?storageRead():[]).filter(x=>typeof x==="string"&&permitted(x)).slice(0,20)});
      const body=await readBody(req);const items=body?.items;
      if(!Array.isArray(items)||items.length>20||items.some(x=>typeof x!=="string"||!permitted(x)))return json(res,400,{error:"Ungültige oder nicht berechtigte Favoriten."});
      const unique=[...new Set(items)];storageWrite(unique);return json(res,200,{ok:true,items:unique});
    }
    if (u.pathname === "/api/me") {
      const me=sessionUser(req);
      if(!me)return json(res,200,{user:null});
      let managed=null;
      if(me.internalUserId)managed=findManagedUserByInternalId(me.internalUserId);
      if(!managed&&me.authProvider==="discord")managed=findManagedUserByDiscordId(me.discordId);
      if(!managed&&me.id)managed=findManagedUserByTwitchId(me.id);
      const linkedAccounts={
        twitch:managed?.twitchUserId?{
          id:String(managed.twitchUserId),login:managed.login||null,displayName:managed.displayName||managed.login||null
        }:(me.authProvider!=="discord"&&me.id?{id:String(me.id),login:me.login||null,displayName:me.name||me.login||null}:null),
        discord:managed?.discordUserId?{
          id:String(managed.discordUserId),username:managed.discordUsername||null,displayName:managed.discordDisplayName||managed.discordUsername||null
        }:(me.authProvider==="discord"&&me.discordId?{id:String(me.discordId),username:me.discordUsername||null,displayName:me.discordName||me.discordUsername||null}:null)
      };
      return json(res,200,{user:{...publicSessionView(me),linkedAccounts},bots:botRosterNow().bots.map(({key,displayName,main,roles})=>({key,displayName,main,roles:roles||[]}))});
    }
    if (u.pathname === "/api/stubenkontrolle" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.view"); if(!me) return;
      return json(res,200,{...stubenkontrolle.summary(),role:me.role});
    }
    if (u.pathname === "/api/stubenkontrolle/config" && req.method === "PUT") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.view"); if(!me) return;
      const body=await readBody(req)||{};
      // 9.10.0: Wer !gift nutzen darf und der Höchstbetrag sind Owner-Sache; andere Werte bleiben beim Speichern unverändert.
      if(!(me.globalOwner||me.localAdmin||me.role==="owner"))for(const k of ["giftAllowBroadcaster","giftAllowControlOwners","giftMaxAmount"])delete body[k];
      const config=stubenkontrolle.updateConfig(body);
      audit(me.login,"stubenkontrolle.config.updated",{section:"stubenkontrolle"});
      syncEventProfilesAfterChange(me.login,"stubenkontrolle");
      return json(res,200,{ok:true,config});
    }
    if (u.pathname === "/api/stubenkontrolle/accounts" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.view"); if(!me) return;
      return json(res,200,{accounts:stubenkontrolle.listAccounts({search:u.searchParams.get("search")||"",limit:Number(u.searchParams.get("limit")||100)})});
    }
    if (u.pathname === "/api/stubenkontrolle/rounds" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.view"); if(!me) return;
      return json(res,200,{rounds:stubenkontrolle.listRounds(Number(u.searchParams.get("limit")||50))});
    }
    if (u.pathname === "/api/stubenkontrolle/transactions" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.view"); if(!me) return;
      return json(res,200,{transactions:stubenkontrolle.transactions(Number(u.searchParams.get("limit")||100))});
    }
    if (u.pathname === "/api/stubenkontrolle/admin/credit" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.view"); if(!me) return;
      const body=await readBody(req);
      try{
        const account=await stubenkontrolle.adminCredit({login:body.login,amount:body.amount,note:body.note,actor:me.login});
        audit(me.login,"stubenkontrolle.admin.credit",{section:"stubenkontrolle",target:account.login,amount:Number(body.amount)});
        return json(res,200,{ok:true,account});
      }catch(e){ return json(res,Number(e?.status)||400,{error:e.message}); }
    }
    if (u.pathname === "/api/stubenkontrolle/admin/refund" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.edit"); if(!me) return;
      const body=await readBody(req);
      try{
        const result=stubenkontrolle.refundRound({roundId:String(body.roundId||""),userId:body.userId||null,actor:me.login});
        audit(me.login,"stubenkontrolle.admin.refund",{section:"stubenkontrolle",roundId:body.roundId,userId:body.userId||null,count:result.count,total:result.total});
        return json(res,200,{ok:true,...result});
      }catch(e){ return json(res,Number(e?.status)||400,{error:e.message}); }
    }
    if (u.pathname === "/api/stubenkontrolle/overlay-access" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.edit"); if(!me) return;
      const body=await readBody(req);
      const result=stubenkontrolle.setOverlayAccess({url:body.url,key:body.key,generate:body.generate===true});
      audit(me.login,"stubenkontrolle.overlay.access.updated",{section:"stubenkontrolle",url:result.overlayPublicUrl,keyRotated:body.generate===true});
      return json(res,200,{ok:true,...result});
    }
    if (u.pathname === "/api/stubenkontrolle/test-overlay" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.edit"); if(!me) return;
      const body=await readBody(req);
      const state=stubenkontrolle.testOverlay(String(body.scenario||"registration"));
      audit(me.login,"stubenkontrolle.overlay.test",{section:"stubenkontrolle",scenario:body.scenario||"registration"});
      return json(res,200,{ok:true,state});
    }
    if (u.pathname === "/api/stubenkontrolle/reset" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.stubenkontrolle.view"); if(!me) return;
      const body=await readBody(req);
      try{
        const result=await stubenkontrolle.resetAll({actor:me.login,confirmation:body.confirmation});
        return json(res,200,result);
      }catch(e){ return json(res,Number(e?.status)||400,{error:e.message}); }
    }

    if (u.pathname === "/api/settings" && req.method === "GET") {
      const me=requireUser(req,res); if(!me)return;
      if(!anyCapability(me,"twitch.")) return json(res,403,{error:"Kein Twitch-Backend-Zugriff."});
      const current=readJson(FILES.settings,DEFAULT_SETTINGS); const beforeJson=JSON.stringify(current); prepareSettingsFull(current);
      if(JSON.stringify(current)!==beforeJson) writeJson(FILES.settings,current);
      return json(res,200,filteredSettingsForUser(current,me));
    }
    if (u.pathname === "/api/settings" && req.method === "PUT") {
      const me=requireUser(req,res); if(!me)return;
      if(!anyCapability(me,"twitch.")) return json(res,403,{error:"Kein Twitch-Backend-Zugriff."});
      const body=await readBody(req); const before=readJson(FILES.settings,DEFAULT_SETTINGS); prepareSettingsFull(before);
      const next=mergeSettingsForUser(before,body,me);
      if(twitchBlockedTermsChanged(before,next)){
        if(!hasCapability(me,"twitch.blocked.edit")) return json(res,403,{error:"Keine Berechtigung für verbotene Wörter."});
        try{next.blockedWords=(await twitchRuntime.reconcileTwitchBlockedTerms(before,next,me.login||me.name)).blockedWords;}
        catch(e){audit(me.login||me.name||"unknown","blocked-term.sync.failed",{section:"blockedWords",error:e.message});return json(res,409,{error:"Twitch Blocked Terms konnten nicht synchronisiert werden.",detail:e.message});}
      }
      writeJson(FILES.settings,next); logSettingsDiff(me.login||me.name||"unknown",before,next);
      syncEventProfilesAfterChange(me.login||me.name||"unknown","settings");
      return json(res,200,{ok:true,settings:filteredSettingsForUser(next,me)});
    }
    if (u.pathname === "/api/activity" && req.method === "GET") {
      const platform=String(u.searchParams.get("platform") || "twitch")==="discord"?"discord":"twitch";
      const me=requireCapability(req,res,platform==="discord"?"discord.activity.view":"twitch.activity.view"); if(!me)return;

      const result=queryAudit({
        type:"changes",
        platform,
        page:Number(u.searchParams.get("page") || 1),
        pageSize:100,
        user:String(u.searchParams.get("user") || ""),
        section:String(u.searchParams.get("section") || ""),
        action:String(u.searchParams.get("action") || "")
      });

      return json(res,200,{
        ...result,
        auditFileExists:fs.existsSync(FILES.audit)
      });
    }

    // 9.1.1: Modulschalter (Administration → Integrationen → Module). Nur globale Administration.
    // Daten bleiben beim Ausschalten erhalten; die Oberfläche blendet ausgeschaltete Module aus.
    // 9.11.0: Administration → Profil & Branding. Lesen: globale Administration; Ändern: nur Owner.
    if (u.pathname === "/api/admin/profile" && req.method === "GET") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      return json(res,200,{...profileAdminView(),canEdit:!!(me.globalOwner||me.localAdmin||me.role==="owner")});
    }
    if (u.pathname === "/api/admin/profile" && req.method === "PUT") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      const body=await readBody(req);
      const before=installationProfile({fresh:true});
      const {errors,next}=validateProfileInput(Object.fromEntries(["productName","publicBaseUrl","game","discord","operatorLegal","bots"].filter(k=>body&&Object.prototype.hasOwnProperty.call(body,k)).map(k=>[k,body[k]])),before);
      if(errors.length)return json(res,400,{error:errors.join(" "),errors});
      const saved=saveInstallationProfile(next);
      const changes={};
      if(before.productName!==saved.productName)changes.productName={before:before.productName,after:saved.productName};
      if(before.publicBaseUrl!==saved.publicBaseUrl)changes.publicBaseUrl={before:before.publicBaseUrl||null,after:saved.publicBaseUrl||null};
      if(JSON.stringify(before.game)!==JSON.stringify(saved.game))changes.game={before:before.game,after:saved.game};
      if(JSON.stringify(before.operatorLegal)!==JSON.stringify(saved.operatorLegal))changes.operatorLegal={before:before.operatorLegal,after:saved.operatorLegal};
      if(JSON.stringify(before.bots)!==JSON.stringify(saved.bots)){
        changes.bots={before:before.bots.bots.map(b=>b.login),after:saved.bots.bots.map(b=>b.login),main:botRoster.mainBot(saved.bots).login,channel:saved.bots.channel.login,removed:botRoster.removedKeys(before.bots,saved.bots)};
      }
      const discordChanged=JSON.stringify(before.discord)!==JSON.stringify(saved.discord);
      if(discordChanged)changes.discord={before:before.discord,after:saved.discord};
      if(Object.keys(changes).length)audit(me.login||me.discordUsername||me.name||"owner","installation.profile.updated",{section:"installation",...changes});
      let discordPush=null;
      if(discordChanged){try{discordPush={ok:true,...(await pushDiscordInstallation())};}catch(e){discordPush={ok:false,error:e.message};}}
      return json(res,200,{ok:true,...profileAdminView(),canEdit:true,discordPush});
    }

    // 9.14.0: Bilder hochladen / auf Standard zurücksetzen (nur Owner). Der Inhalt wird an den Dateianfangsbytes geprüft, nie am Namen.
    const imageRoute=/^\/api\/admin\/profile\/image\/([A-Za-z]+)$/.exec(u.pathname);
    if (imageRoute && (req.method==="PUT"||req.method==="DELETE")) {
      const me=requireGlobalOwner(req,res);if(!me)return;
      const slot=imageRoute[1];
      if(!imageKit.isSlot(slot))return json(res,404,{error:"Unbekannter Bildplatz."});
      const who=me.login||me.discordUsername||me.name||"owner";
      if(req.method==="DELETE"){
        const removed=clearImage(slot);
        if(removed)audit(who,"installation.image.reset",{section:"installation",slot});
        return json(res,200,{ok:true,removed,...profileAdminView(),canEdit:true});
      }
      const buf=await readRawBody(req,imageKit.MAX_BYTES+1024);
      const checked=imageKit.validateUpload(slot,buf);
      if(!checked.ok)return json(res,400,{error:checked.error});
      const meta=saveImage(slot,buf,checked);
      audit(who,"installation.image.uploaded",{section:"installation",slot,width:meta.width,height:meta.height,bytes:meta.bytes,mime:meta.mime});
      return json(res,200,{ok:true,...profileAdminView(),canEdit:true});
    }

    // 9.12.0: Rollenliste des Discord-Servers für die Auswahl in Profil & Branding (nur Lesen, globale Administration).
    if (u.pathname === "/api/admin/profile/discord-roles" && req.method === "GET") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{const result=await discordServiceRequest("/roles");return json(res,200,result.body||{ok:false,roles:[]});}
      catch(e){return json(res,502,{ok:false,error:e.message,roles:[]});}
    }

    if (u.pathname === "/api/admin/modules" && req.method === "GET") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      const current=readJson(FILES.settings,DEFAULT_SETTINGS);prepareSettingsFull(current);
      return json(res,200,{modules:brandModules(describeModules(current))});
    }
    if (u.pathname === "/api/admin/modules" && req.method === "PUT") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      const body=await readBody(req);
      const mod=getModule(body?.id);
      if(!mod||typeof body?.enabled!=="boolean")return json(res,400,{error:"Ungültige Modulangabe."});
      // 9.2.0: laufende Vorgänge sperren das Ausschalten (Entscheidung Mario 16.11.2026).
      if(body.enabled===false){const busy=MODULE_BUSY_CHECKS[mod.id]?.();if(busy)return json(res,409,{error:busy});}
      const current=readJson(FILES.settings,DEFAULT_SETTINGS);prepareSettingsFull(current);
      const result=setModuleEnabled(current,mod.id,body.enabled);
      if(!result.ok)return json(res,409,{error:result.error});
      if(result.changed){
        writeJson(FILES.settings,current);
        audit(me.login||me.discordUsername||me.name||"admin",body.enabled?"module.enabled":"module.disabled",{section:"modules",label:brandModules([mod])[0].label,module:mod.id,before:!body.enabled,after:body.enabled});
        // 9.4.0: Discord-Bot sofort informieren; scheitert das, holt er den Stand spätestens nach 60 s selbst.
        pushControlStateToDiscord("Modulschalter");
      }
      return json(res,200,{ok:true,changed:result.changed,modules:brandModules(describeModules(current))});
    }
    if (u.pathname === "/api/admin/login-logs" && req.method === "GET") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      return json(res,200,queryAuthLog({page:Number(u.searchParams.get("page")||1),pageSize:100,platform:String(u.searchParams.get("platform")||""),result:String(u.searchParams.get("result")||""),search:String(u.searchParams.get("search")||"")}));
    }
    if (u.pathname === "/api/admin/login-logs/cleanup" && req.method === "POST") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      const result=deleteAuthLogsOlderThan(30);
      audit(me.login||me.discordUsername||me.name||"admin","authlog.cleanup",{section:"users",removed:result.removed,remaining:result.remaining});
      return json(res,200,{ok:true,...result});
    }
    if (u.pathname === "/api/discord-analytics" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.statistics.view");if(!me)return;
      await collectDiscordAnalyticsSnapshot();
      let moderationStats=null;try{moderationStats=(await discordServiceRequest("/moderation/stats")).body||null;}catch{}
      const analytics=buildDiscordAnalytics();
      if(moderationStats){analytics.summary.days7.violations=Number(moderationStats.days7||0);analytics.summary.days30.violations=Number(moderationStats.days30||0);analytics.summary.all.violations=Number(moderationStats.total||0);analytics.note="Verstöße werden aus dem Discord-Moderationsprotokoll gezählt (Discord AutoMod + Control-Center-Filter).";}
      return json(res,200,analytics);
    }

    if (u.pathname === "/api/account/discord/unlink" && req.method === "POST") {
      const me=requireUser(req,res); if(!me)return;
      try{
        const data=readUsers();
        let target=null;
        if(me.internalUserId)target=data.users.find(x=>String(x.id)===String(me.internalUserId));
        if(!target&&me.authProvider==="discord")target=data.users.find(x=>String(x.discordUserId||"")===String(me.discordId||""));
        if(!target&&me.id)target=data.users.find(x=>String(x.twitchUserId||"")===String(me.id));
        if(!target||!target.discordUserId)return json(res,404,{error:"Mit deinem Control-Center-Konto ist kein Discord-Konto verknüpft."});

        const actor=me.login||me.discordUsername||me.name||"self";
        const previous=unlinkDiscordIdentityFromUser(data,target,actor);
        writeUsers(data);
        const invalidated=invalidateDiscordSessions(previous.discordUserId);
        audit(actor,"account.discord.unlinked.self",{internalUserId:target.id,discordUserId:previous.discordUserId,invalidatedSessions:invalidated});

        const currentWasDiscord=me.authProvider==="discord"&&String(me.discordId||"")===previous.discordUserId;
        return json(res,200,{ok:true,loggedOut:currentWasDiscord,discordUserId:previous.discordUserId},
          currentWasDiscord?{"Set-Cookie":"bwksid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"}:{});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname.startsWith("/api/users/") && u.pathname.endsWith("/discord/unlink") && req.method === "POST") {
      const me=requireGlobalAdmin(req,res); if(!me)return;
      try{
        const parts=u.pathname.split("/").filter(Boolean);
        const targetId=decodeURIComponent(parts[2]||"");
        const data=readUsers();
        const target=data.users.find(x=>String(x.id)===String(targetId));
        if(!target)return json(res,404,{error:"Benutzer nicht gefunden."});
        { const gate=mayManageTarget(me,target); if(!gate.ok) return json(res,403,{error:gate.error}); }
        const actor=me.login||me.discordUsername||me.name||"admin";
        const previous=unlinkDiscordIdentityFromUser(data,target,actor);
        writeUsers(data);
        const invalidated=invalidateDiscordSessions(previous.discordUserId);
        audit(actor,"account.discord.unlinked.admin",{internalUserId:target.id,discordUserId:previous.discordUserId,invalidatedSessions:invalidated});
        return json(res,200,{ok:true,invalidatedSessions:invalidated});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/users/discord/backend" && req.method === "POST") {
      const me=requireGlobalAdmin(req,res); if(!me)return;
      try{
        const body=await readBody(req);
        const discordUserId=String(body.discordUserId||"").trim();
        const enabled=body.enabled===true;
        const discordRole=normalizeRole(body.discordRole||"editor");
        if(!/^\d{15,22}$/.test(discordUserId)) return json(res,400,{error:"Ungültige Discord User ID."});
        if(discordRole==="owner") return json(res,400,{error:"Globale Owner-Rechte werden nicht über die Discord-Backend-Freigabe vergeben."});

        const memberResult=await discordServiceRequest(`/members?query=${encodeURIComponent(discordUserId)}&limit=1`);
        const member=(memberResult.body?.members||[]).find(x=>String(x.id)===discordUserId);
        if(!member) return json(res,404,{error:"Discord-Mitglied nicht gefunden."});

        const data=readUsers();
        let target=data.users.find(x=>String(x.discordUserId||"")===discordUserId);
        if(!target){
          target=normalizeManagedUser({
            discordUserId,
            discordUsername:member.username,
            discordDisplayName:member.displayName,
            discordAvatar:member.userAvatar||member.guildAvatar||null,
            discordBackendEnabled:enabled,
            discordRole,
            globalOwner:false,
            createdAt:new Date().toISOString(),
            createdBy:me.login||me.name||"owner"
          });
          data.users.push(target);
        }else{
          { const gate=mayManageTarget(me,target); if(!gate.ok) return json(res,403,{error:gate.error}); }
          target.discordUsername=member.username||target.discordUsername;
          target.discordDisplayName=member.displayName||target.discordDisplayName;
          target.discordAvatar=member.userAvatar||member.guildAvatar||target.discordAvatar;
          target.discordBackendEnabled=enabled;
          target.discordRole=discordRole;
          target.updatedAt=new Date().toISOString();
          target.updatedBy=me.login||me.name||"owner";
        }
        writeUsers(data);
        invalidateSessionsForManaged(target);
        audit(me.login||me.name||"owner","user.discord.backend.updated",{discordUserId,enabled,discordRole,internalUserId:target.id});
        return json(res,200,{ok:true,user:target});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/users" && req.method === "GET") {
      const me = requireGlobalAdmin(req,res); if (!me) return;
      const users = readUsers().users;
      return json(res,200,{users,accessCatalog:ACCESS_CATALOG});
    }

    if (u.pathname.startsWith("/api/users/") && u.pathname.endsWith("/capabilities") && req.method === "PUT") {
      const me=requireGlobalAdmin(req,res); if(!me)return;
      const parts=u.pathname.split("/").filter(Boolean); const targetId=decodeURIComponent(parts[2]||"");
      const body=await readBody(req); const data=readUsers(); const target=data.users.find(x=>String(x.id)===String(targetId));
      if(!target) return json(res,404,{error:"Benutzer nicht gefunden."});
      { const gate=mayManageTarget(me,target); if(!gate.ok) return json(res,403,{error:gate.error}); }
      const capabilities=sanitizeCapabilities(body.capabilities); target.capabilities=capabilities; target.capabilitiesCustomized=true;
      target.discordBackendEnabled=capabilities.some(x=>x.startsWith("discord."));
      target.updatedAt=new Date().toISOString(); target.updatedBy=me.login||me.name||"admin"; writeUsers(data); invalidateSessionsForManaged(target);
      audit(me.login||me.name||"admin","user.capabilities.updated",{targetId:target.id,capabilities});
      return json(res,200,{ok:true,user:target});
    }

    if (u.pathname === "/api/users" && req.method === "POST") {
      const me = requireGlobalAdmin(req,res); if (!me) return;
      const body = await readBody(req);
      const login = String(body.login || "").trim().toLowerCase();
      const role = normalizeRole(body.role || "editor");

      if (!login) return json(res,400,{error:"Twitch-Login fehlt."});
      if (role === "owner" && me.role !== "owner" && !me.globalOwner && !me.localAdmin) {
        return json(res,403,{error:"Nur Owner dürfen die Rolle Owner vergeben."});
      }
      { const gate=mayManageTarget(me,{},role); if(!gate.ok) return json(res,403,{error:gate.error}); }

      const r = await twitchAppFetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`);
      const j = await r.json();
      const twitchUser = j.data?.[0];
      if (!r.ok || !twitchUser) return json(res,404,{error:"Twitch-User nicht gefunden."});

      const data = readUsers();
      const existing = data.users.find(x => String(x.twitchUserId) === String(twitchUser.id));

      if (existing) {
        { const gate=mayManageTarget(me,existing,role); if(!gate.ok) return json(res,403,{error:gate.error}); }
        existing.login = twitchUser.login;
        existing.displayName = twitchUser.display_name;
        existing.role = role;
        existing.globalOwner = role==="owner";
        existing.globalAdmin = role==="admin";
        existing.enabled = true;
        existing.updatedAt = new Date().toISOString();
        existing.updatedBy = me.login;
      } else {
        data.users.push({
          id:managedUserId(twitchUser.id),
          twitchUserId:twitchUser.id,
          login:twitchUser.login,
          displayName:twitchUser.display_name,
          role,
          enabled:true,
          globalOwner:role==="owner",
          globalAdmin:role==="admin",
          createdAt:new Date().toISOString(),
          createdBy:me.login
        });
      }

      writeUsers(data);
      if(existing)invalidateSessionsForManaged(existing);
      audit(me.login,"user.access.updated",{
        target:twitchUser.login,
        twitchUserId:twitchUser.id,
        role,
        enabled:true
      });

      return json(res,200,{ok:true,users:data.users});
    }

    if (u.pathname.startsWith("/api/users/") && req.method === "PUT") {
      const me = requireGlobalAdmin(req,res); if (!me) return;
      const targetId = decodeURIComponent(u.pathname.split("/").pop());
      const body = await readBody(req);
      const data = readUsers();
      const target = data.users.find(x => String(x.id) === String(targetId) || String(x.twitchUserId||"") === String(targetId));
      if (!target) return json(res,404,{error:"Benutzer nicht gefunden."});

      const newRole = normalizeRole(body.role || target.role);
      const newEnabled = body.enabled !== undefined ? !!body.enabled : !!target.enabled;

      { const gate=mayManageTarget(me,target,newRole); if(!gate.ok) return json(res,403,{error:gate.error}); }

      const before = {role:target.role,enabled:target.enabled};
      target.role = newRole;
      target.enabled = newEnabled;
      target.globalOwner = newRole==="owner";
      target.globalAdmin = newRole==="admin";
      target.updatedAt = new Date().toISOString();
      target.updatedBy = me.login;
      writeUsers(data);
      invalidateSessionsForManaged(target);

      audit(me.login,"user.access.updated",{
        target:target.login,
        twitchUserId:target.twitchUserId,
        before,
        after:{role:target.role,enabled:target.enabled}
      });

      return json(res,200,{ok:true,user:target});
    }

    if (u.pathname.startsWith("/api/users/") && req.method === "DELETE") {
      const me = requireRole(req,res,"admin"); if (!me) return;
      const targetId = decodeURIComponent(u.pathname.split("/").pop());
      const data = readUsers();
      const target = data.users.find(x => String(x.id) === String(targetId) || String(x.twitchUserId||"") === String(targetId));
      if (!target) return json(res,404,{error:"Benutzer nicht gefunden."});

      { const gate=mayManageTarget(me,target); if(!gate.ok) return json(res,403,{error:gate.error}); }

      invalidateSessionsForManaged(target);
      data.users = data.users.filter(x => String(x.id) !== String(targetId) && String(x.twitchUserId||"") !== String(targetId));
      writeUsers(data);
      audit(me.login,"user.access.deleted",{
        target:target.login,
        twitchUserId:target.twitchUserId,
        role:target.role
      });

      return json(res,200,{ok:true});
    }

    if (u.pathname === "/api/reset-settings" && req.method === "POST") {
      const me = requireUser(req,res); if (!me) return;

      // Sicherheitsgrenze: Reset ist ausschließlich für die lokale Admin-Session erlaubt.
      // Twitch-Moderatoren und normale Twitch-Logins erhalten immer 403.
      if (!me.localAdmin) {
        audit(me.login || "unknown", "settings.reset.denied");
        return json(res,403,{error:"Konfiguration zurücksetzen ist nur im lokalen Admin-Modus erlaubt."});
      }

      const before = readJson(FILES.settings, DEFAULT_SETTINGS);
      writeJson(FILES.settings, cleanSettingsNow());

      audit(me.login, "settings.reset", {
        removed: {
          commands: Array.isArray(before.commands) ? before.commands.length : 0,
          timers: Array.isArray(before.timers) ? before.timers.length : 0,
          greetings: Array.isArray(before.greetings) ? before.greetings.length : 0,
          blockedWords: Array.isArray(before.blockedWords) ? before.blockedWords.length : 0,
          autoReplies: Array.isArray(before.autoReplies) ? before.autoReplies.length : 0
        }
      });

      return json(res,200,{ok:true,settings:cleanSettingsNow()});
    }

    if (u.pathname === "/api/giveaway" && req.method === "GET") {
      const me = requireUser(req,res); if (!me) return;
      const state = readGiveawayState();
      return json(res,200,{
        current:publicGiveaway(state.current),
        history:(state.history || []).slice(-10).reverse().map(publicGiveaway)
      });
    }

    if (u.pathname === "/api/giveaway/create" && req.method === "POST") {
      const me = requireCapability(req,res,"twitch.giveaway.view"); if (!me) return;
      const body = await readBody(req);
      const type = String(body.type || "keyword").toLowerCase();
      const keyword = String(body.keyword || "").trim();
      const title = String(body.title || "").trim().slice(0,120);
      const excludeModerators = body.excludeModerators !== false;
      const excludeBroadcaster = body.excludeBroadcaster !== false;
      const excludeVIPs = body.excludeVIPs === true;

      if (!["random","keyword"].includes(type)) {
        return json(res,400,{error:"Unbekannter Gewinnspiel-Typ."});
      }
      if (type === "keyword" && !keyword) {
        return json(res,400,{error:"Für ein Keyword-Gewinnspiel ist ein Code-Wort erforderlich."});
      }

      const state = readGiveawayState();
      if (state.current?.active) {
        return json(res,409,{error:"Es läuft bereits ein Gewinnspiel. Bitte zuerst beenden oder auslosen."});
      }

      archiveCurrentGiveaway(state);

      state.current = {
        id:crypto.randomUUID(),
        type,
        keyword:type === "keyword" ? keyword : "",
        title,
        active:false,
        createdAt:new Date().toISOString(),
        createdBy:me.login,
        startedAt:null,
        endedAt:null,
        winner:null,
        winners:[],
        excludeModerators,
        excludeBroadcaster,
        excludeVIPs,
        entries:{},
        archived:false
      };
      writeGiveawayState(state);

      audit(me.login,"giveaway.created",{
        section:"giveaway",
        giveawayId:state.current.id,
        type,
        keyword:type === "keyword" ? keyword : null,
        title,
        excludeModerators,
        excludeBroadcaster,
        excludeVIPs
      });

      return json(res,200,{ok:true,current:publicGiveaway(state.current)});
    }

    if (u.pathname === "/api/giveaway/options" && req.method === "PUT") {
      const me = requireCapability(req,res,"twitch.giveaway.edit"); if (!me) return;
      const state = readGiveawayState();
      const g = state.current;

      if (!g) return json(res,404,{error:"Kein Gewinnspiel vorbereitet."});
      if (g.active) return json(res,409,{error:"Teilnahmeoptionen können während eines laufenden Gewinnspiels nicht geändert werden."});
      if (g.endedAt) return json(res,409,{error:"Dieses Gewinnspiel ist bereits beendet."});

      const body = await readBody(req);
      g.excludeModerators = body.excludeModerators !== false;
      g.excludeBroadcaster = body.excludeBroadcaster !== false;
      g.excludeVIPs = body.excludeVIPs === true;
      g.updatedAt = new Date().toISOString();
      writeGiveawayState(state);

      audit(me.login,"giveaway.options.updated",{
        section:"giveaway",
        giveawayId:g.id,
        excludeModerators:g.excludeModerators,
        excludeBroadcaster:g.excludeBroadcaster,
        excludeVIPs:g.excludeVIPs
      });

      return json(res,200,{ok:true,current:publicGiveaway(g)});
    }

    if (u.pathname === "/api/giveaway/start" && req.method === "POST") {
      const me = requireCapability(req,res,"twitch.giveaway.edit"); if (!me) return;
      const state = readGiveawayState();
      const g = state.current;

      if (!g) return json(res,404,{error:"Kein Gewinnspiel vorbereitet."});
      if (g.active) return json(res,409,{error:"Das Gewinnspiel läuft bereits."});
      if (g.endedAt) return json(res,409,{error:"Dieses Gewinnspiel ist bereits beendet. Bitte ein neues erstellen."});

      g.active = true;
      g.startedAt = new Date().toISOString();
      g.entries = {};
      g.winners = [];
      g.winner = null;
      writeGiveawayState(state);

      await twitchRuntime.sendChat(botForRoleNow("giveaway"), giveawayStartMessage(g));

      audit(me.login,"giveaway.started",{
        section:"giveaway",
        giveawayId:g.id,
        type:g.type,
        keyword:g.keyword || null,
        title:g.title || null
      });

      return json(res,200,{ok:true,current:publicGiveaway(g)});
    }

    if (u.pathname === "/api/giveaway/draw" && req.method === "POST") {
      const me = requireCapability(req,res,"twitch.giveaway.edit"); if (!me) return;
      const state = readGiveawayState();
      const g = state.current;

      if (!g) return json(res,404,{error:"Kein Gewinnspiel vorhanden."});
      if (!g.active) return json(res,409,{error:"Das Gewinnspiel läuft nicht."});

      g.winners ||= [];
      const winnerIds = new Set(g.winners.map(x => String(x.userId || "")));
      const eligible = Object.values(g.entries || {}).filter(x => !winnerIds.has(String(x.userId || "")));

      if (!eligible.length) {
        return json(res,409,{error:g.winners.length
          ? "Alle Teilnehmenden wurden bereits als Gewinner gezogen."
          : "Noch keine Teilnehmer im Lostopf."});
      }

      const winner = eligible[crypto.randomInt(eligible.length)];
      g.winners.push(winner);
      g.winner = winner; // Abwärtskompatibilität / zuletzt gezogener Gewinner
      g.updatedAt = new Date().toISOString();
      writeGiveawayState(state);

      const winnerNumber = g.winners.length;
      await twitchRuntime.sendChat(botForRoleNow("giveaway"), giveawayWinnerMessage(g, winner, winnerNumber));

      audit(me.login,"giveaway.drawn",{
        section:"giveaway",
        giveawayId:g.id,
        title:g.title || null,
        entries:Object.keys(g.entries || {}).length,
        winner:winner.login,
        winnerUserId:winner.userId,
        winnerNumber,
        remaining:eligible.length - 1
      });

      return json(res,200,{
        ok:true,
        current:publicGiveaway(g),
        winner,
        winnerNumber,
        remaining:eligible.length - 1
      });
    }

    if (u.pathname === "/api/giveaway/end" && req.method === "POST") {
      const me = requireCapability(req,res,"twitch.giveaway.edit"); if (!me) return;
      const state = readGiveawayState();
      const g = state.current;

      if (!g) return json(res,404,{error:"Kein Gewinnspiel vorhanden."});
      if (g.endedAt) return json(res,409,{error:"Das Gewinnspiel ist bereits beendet."});

      g.active = false;
      g.endedAt = new Date().toISOString();
      archiveCurrentGiveaway(state);
      writeGiveawayState(state);

      audit(me.login,"giveaway.ended",{
        section:"giveaway",
        giveawayId:g.id,
        title:g.title || null,
        entries:Object.keys(g.entries || {}).length,
        winners:(g.winners || []).length
      });

      return json(res,200,{ok:true,current:publicGiveaway(g)});
    }

    if (u.pathname === "/api/clips/status" && req.method === "GET") {
      const me = requireCapability(req,res,"twitch.clips.view"); if (!me) return;
      const settings = readJson(FILES.settings, DEFAULT_SETTINGS);
      const cfg = normalizeClipSettings(settings);
      const state = readClipState();

      return json(res,200,{
        config:cfg,
        state:{
          initialized:!!state.initialized,
          knownCount:Number(state.knownCount ?? Object.keys(state.seen || {}).length),
          lastCheckedAt:state.lastCheckedAt || null,
          lastShared:state.lastShared || null,
          lastError:state.lastError || null
        }
      });
    }

    if (u.pathname === "/api/clips/check" && req.method === "POST") {
      const me = requireCapability(req,res,"twitch.clips.edit"); if (!me) return;
      const result = await twitchRuntime.checkNewClips({manual:true});
      return json(res,result.ok?200:500,result);
    }

    if (u.pathname === "/api/event-profiles" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.eventprofiles.view"); if(!me) return;
      return json(res,200,eventProfilesResponse());
    }

    if (u.pathname === "/api/event-profiles" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.eventprofiles.edit"); if(!me) return;
      const body=await readBody(req);
      const name=String(body.name||"").trim();
      const description=String(body.description||"").trim();

      if(!name) return json(res,400,{error:"Profilname fehlt."});
      if(name.length>80) return json(res,400,{error:"Profilname ist zu lang."});

      const data=readEventProfiles();
      if(data.profiles.some(p=>String(p.name||"").trim().toLowerCase()===name.toLowerCase())){
        return json(res,409,{error:"Ein Event-Profil mit diesem Namen existiert bereits."});
      }

      const now=new Date().toISOString();
      const profile={
        id:crypto.randomBytes(12).toString("hex"),
        name,
        description,
        createdAt:now,
        createdBy:me.login,
        updatedAt:now,
        updatedBy:me.login,
        snapshot:eventProfileCore.capture(liveProfileState())
      };

      data.profiles.push(profile);
      writeEventProfiles(data);

      audit(me.login,"event-profile.created",{
        section:"eventProfiles",
        profileId:profile.id,
        profileName:profile.name,
        counts:eventProfileCounts(profile.snapshot)
      });

      return json(res,201,{ok:true,profile:publicEventProfile(profile,data.activeProfileId),...eventProfilesResponse()});
    }

    if (u.pathname.startsWith("/api/event-profiles/") && u.pathname.endsWith("/apply") && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.eventprofiles.edit"); if(!me) return;
      const parts=u.pathname.split("/").filter(Boolean);
      const profileId=decodeURIComponent(parts[2]||"");
      const data=readEventProfiles();
      const profile=data.profiles.find(p=>String(p.id)===String(profileId));
      if(!profile) return json(res,404,{error:"Event-Profil nicht gefunden."});

      // Vor dem Wechsel: Das bisher aktive Profil merkt sich den aktuellen Stand.
      syncEventProfilesAfterChange(me.login,"before-switch");
      const fresh=readEventProfiles();
      const target=fresh.profiles.find(p=>String(p.id)===String(profileId));

      const live=liveProfileState();
      target.snapshot=eventProfileCore.normalize(target.snapshot,live,{isActive:false}).snapshot;
      eventProfileCore.apply(live,target.snapshot,PROFILE_MODULE_OPTS);
      writeLiveProfileState(live);
      fresh.activeProfileId=target.id;
      writeEventProfiles(fresh);

      // Soll/Ist-Prüfung gegen den tatsächlich gespeicherten Stand.
      const mismatches=eventProfileCore.verify(liveProfileState(),target.snapshot,PROFILE_MODULE_OPTS);
      const counts=eventProfileCounts(target.snapshot);
      audit(me.login,"event-profile.applied",{section:"eventProfiles",profileId:target.id,profileName:target.name,counts,mismatches:mismatches.length});

      const next=readJson(FILES.settings,DEFAULT_SETTINGS);
      return json(res,200,{ok:true,settings:filteredSettingsForUser(next,me),mismatches,...eventProfilesResponse()});
    }

    // 8.9.8: Alle Schalter eines Profils lesen …
    if (u.pathname.startsWith("/api/event-profiles/") && u.pathname.endsWith("/switches") && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.eventprofiles.view"); if(!me) return;
      const profileId=decodeURIComponent(u.pathname.split("/").filter(Boolean)[2]||"");
      const data=readEventProfiles();
      const profile=data.profiles.find(p=>String(p.id)===String(profileId));
      if(!profile) return json(res,404,{error:"Event-Profil nicht gefunden."});
      return json(res,200,{ok:true,active:String(data.activeProfileId||"")===String(profile.id),bots:profileBots(),groups:eventProfileCore.describe(liveProfileState(),profile.snapshot,PROFILE_MODULE_OPTS)});
    }
    // … und ändern, ohne das Profil zu aktivieren. Ist es aktiv, gilt die Änderung sofort.
    if (u.pathname.startsWith("/api/event-profiles/") && u.pathname.endsWith("/switches") && req.method === "PUT") {
      const me=requireCapability(req,res,"twitch.eventprofiles.edit"); if(!me) return;
      const profileId=decodeURIComponent(u.pathname.split("/").filter(Boolean)[2]||"");
      const body=await readBody(req);
      const data=readEventProfiles();
      const profile=data.profiles.find(p=>String(p.id)===String(profileId));
      if(!profile) return json(res,404,{error:"Event-Profil nicht gefunden."});
      const live=liveProfileState();
      profile.snapshot=eventProfileCore.patch(profile.snapshot,live,body?.changes,profileBots(),PROFILE_MODULE_OPTS);
      profile.updatedAt=new Date().toISOString();
      profile.updatedBy=me.login;
      const active=String(data.activeProfileId||"")===String(profile.id);
      writeEventProfiles(data);
      let mismatches=[];
      if(active){
        eventProfileCore.apply(live,profile.snapshot,PROFILE_MODULE_OPTS);
        writeLiveProfileState(live);
        mismatches=eventProfileCore.verify(liveProfileState(),profile.snapshot,PROFILE_MODULE_OPTS);
      }
      audit(me.login,"event-profile.switches.updated",{section:"eventProfiles",profileId:profile.id,profileName:profile.name,changes:Array.isArray(body?.changes)?body.changes.length:0,active});
      return json(res,200,{ok:true,active,mismatches,groups:eventProfileCore.describe(liveProfileState(),profile.snapshot,PROFILE_MODULE_OPTS),settings:active?filteredSettingsForUser(readJson(FILES.settings,DEFAULT_SETTINGS),me):undefined,...eventProfilesResponse()});
    }

    if (u.pathname.startsWith("/api/event-profiles/") && req.method === "PUT") {
      const me=requireCapability(req,res,"twitch.eventprofiles.edit"); if(!me) return;
      const profileId=decodeURIComponent(u.pathname.split("/").pop()||"");
      const body=await readBody(req);
      const data=readEventProfiles();
      const profile=data.profiles.find(p=>String(p.id)===String(profileId));
      if(!profile) return json(res,404,{error:"Event-Profil nicht gefunden."});

      const name=String(body.name??profile.name).trim();
      const description=String(body.description??profile.description??"").trim();

      if(!name) return json(res,400,{error:"Profilname fehlt."});
      if(data.profiles.some(p=>String(p.id)!==String(profile.id) && String(p.name||"").trim().toLowerCase()===name.toLowerCase())){
        return json(res,409,{error:"Ein Event-Profil mit diesem Namen existiert bereits."});
      }

      profile.name=name;
      profile.description=description;
      if(body.captureCurrent===true){
        profile.snapshot=eventProfileCore.capture(liveProfileState());
      }
      profile.updatedAt=new Date().toISOString();
      profile.updatedBy=me.login;
      writeEventProfiles(data);

      audit(me.login,body.captureCurrent===true?"event-profile.snapshot.updated":"event-profile.updated",{
        section:"eventProfiles",
        profileId:profile.id,
        profileName:profile.name,
        counts:eventProfileCounts(profile.snapshot)
      });

      return json(res,200,{ok:true,...eventProfilesResponse()});
    }

    if (u.pathname.startsWith("/api/event-profiles/") && req.method === "DELETE") {
      const me=requireCapability(req,res,"twitch.eventprofiles.edit"); if(!me) return;
      const profileId=decodeURIComponent(u.pathname.split("/").pop()||"");
      const data=readEventProfiles();
      const profile=data.profiles.find(p=>String(p.id)===String(profileId));
      if(!profile) return json(res,404,{error:"Event-Profil nicht gefunden."});

      data.profiles=data.profiles.filter(p=>String(p.id)!==String(profileId));
      if(String(data.activeProfileId||"")===String(profileId)) data.activeProfileId=null;
      writeEventProfiles(data);

      audit(me.login,"event-profile.deleted",{
        section:"eventProfiles",
        profileId,
        profileName:profile.name
      });

      return json(res,200,{ok:true,...eventProfilesResponse()});
    }

    if (u.pathname === "/api/twitch/chat-leaderboard" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.followage.view"); if(!me)return;
      try{
        if(!pgStore.enabled||!await twitchRuntime.channelId())return json(res,503,{error:"Nachrichtenzähler ist nicht verfügbar."});
        const days=u.searchParams.get("days")==="30"?30:0;
        const channelId=String(await twitchRuntime.channelId());
        const result=await pgStore.messageCountLeaderboardAsync(channelId,days,50);
        const meta=await pgStore.messageCountMetaAsync(channelId);
        return json(res,200,{ok:true,...result,trackingStartedAt:meta.trackingStartedAt});
      }catch(e){return json(res,500,{error:e.message});}
    }

    if (u.pathname === "/api/followers" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.followage.view"); if(!me) return;
      try{
        const result=await twitchRuntime.getFollowerPage({
          login:String(u.searchParams.get("login")||""),
          sort:String(u.searchParams.get("sort")||"newest"),
          page:Number(u.searchParams.get("page")||1),
          refresh:String(u.searchParams.get("refresh")||"") === "1"
        });
        return json(res,200,result);
      }catch(e){
        return json(res,500,{error:e.message});
      }
    }

    if (u.pathname === "/api/usage-stats" && req.method === "GET") {
      const me=requireUser(req,res); if(!me) return;
      const result=await buildUsageStatsView();
      return json(res,200,result);
    }

    if (u.pathname === "/api/watchtime" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.watchtime.view"); if(!me) return;
      const result=queryWatchtime({
        page:Number(u.searchParams.get("page")||1),
        pageSize:100,
        search:String(u.searchParams.get("search")||""),
        sort:String(u.searchParams.get("sort")||"desc")
      });
      return json(res,200,result);
    }

    if (u.pathname.startsWith("/api/watchtime/") && req.method === "PUT") {
      const me=requireCapability(req,res,"twitch.watchtime.edit"); if(!me) return;
      const userId=decodeURIComponent(u.pathname.split("/").pop()||"");
      const body=await readBody(req);
      if(body.seconds===undefined) return json(res,400,{error:"seconds fehlt."});

      const seconds=Number(body.seconds);
      if(!Number.isFinite(seconds) || seconds<0){
        return json(res,400,{error:"Watchtime muss eine Zahl größer oder gleich 0 sein."});
      }

      const item=setWatchtimeSeconds(userId,seconds,me.login,"manual-correction");
      if(!item) return json(res,404,{error:"Watchtime-Nutzer nicht gefunden."});
      return json(res,200,{ok:true,item});
    }

    if (u.pathname.startsWith("/api/watchtime/") && req.method === "DELETE") {
      const me=requireCapability(req,res,"twitch.watchtime.edit"); if(!me) return;
      const userId=decodeURIComponent(u.pathname.split("/").pop()||"");
      const item=setWatchtimeSeconds(userId,0,me.login,"manual-reset");
      if(!item) return json(res,404,{error:"Watchtime-Nutzer nicht gefunden."});
      audit(me.login,"watchtime.reset",{
        section:"watchtime",
        userId,
        login:item.login||"",
        name:item.name||""
      });
      return json(res,200,{ok:true,item});
    }

    if (u.pathname === "/api/database/status" && req.method === "GET") {
      const me=requireGlobalOwner(req,res); if(!me) return;
      try{return json(res,200,await postgresStorageStatus());}
      catch(e){return json(res,500,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/database/export-legacy" && req.method === "POST") {
      const me=requireGlobalOwner(req,res); if(!me) return;
      try{return json(res,200,await postgresLegacyExport(me.login||me.name||"owner"));}
      catch(e){audit(me.login||"owner","database.legacy-export.failed",{section:"database",error:e.message});return json(res,500,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/updates" && req.method === "GET") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      return json(res,200,updateService.view());
    }
    {
      const um=/^\/api\/updates\/(\d+\.\d+\.\d+)\/(approve|reject|acknowledge)$/.exec(u.pathname);
      if(um&&req.method==="POST"){
        const me=requireGlobalOwner(req,res);if(!me)return;
        const by=me.login||me.discordUsername||me.name||"Owner";
        try{
          const body=await readBody(req)||{};
          const version=um[1];
          if(um[2]==="approve")return json(res,200,await updateService.approve({version,confirmVersion:body.confirmVersion,confirmSha:body.confirmSha,by,skipMaintenance:body.skipMaintenance===true}));
          if(um[2]==="reject")return json(res,200,await updateService.reject({version,by}));
          return json(res,200,await updateService.acknowledge({version,by,endMaintenance:body.endMaintenance===true}));
        }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
      }
    }
    if (u.pathname === "/api/backup/export" && req.method === "POST") {
      const me=requireRole(req,res,"owner"); if(!me) return;
      const body=await readBody(req);
      const include=normalizeBackupInclude(body.include);
      const backup=await buildBackup(include);

      audit(me.login,"backup.exported",{
        section:"backup",
        include
      });

      return json(res,200,backup,{
        "Content-Disposition":`attachment; filename="bwk-control-center-backup-${new Date().toISOString().slice(0,10)}.json"`
      });
    }

    if (u.pathname === "/api/backup/inspect" && req.method === "POST") {
      const me=requireRole(req,res,"owner"); if(!me) return;
      const body=await readBody(req,BACKUP_BODY_LIMIT);
      try{
        return json(res,200,backupSummary(body.backup));
      }catch(e){
        return json(res,Number(e?.status)||400,{error:e.message});
      }
    }

    if (u.pathname === "/api/backup/restore" && req.method === "POST") {
      const me=requireRole(req,res,"owner"); if(!me) return;
      const body=await readBody(req,BACKUP_BODY_LIMIT);

      try{
        const restored=await restoreBackup(body.backup,body.include,me.login);
        return json(res,200,{ok:true,restored});
      }catch(e){
        console.error("⚠️ Backup-Restore fehlgeschlagen:",e.message);
        audit(me.login,"backup.restore.failed",{
          section:"backup",
          error:e.message
        });
        return json(res,Number(e?.status)||400,{error:e.message});
      }
    }

    if (u.pathname === "/api/system/restart" && req.method === "POST") {
      const me=requireGlobalAdmin(req,res); if(!me) return;
      const body=await readBody(req);
      // 9.0.0: Ziele sind die einzelnen Dienste: "web" (Weboberfläche), "twitchbot" (Twitch-Bot), "discord", "all".
      // Das frühere Ziel "twitch" (Weboberfläche samt eingebautem Bot) gibt es nicht mehr.
      const target=String(body.target||"");
      if(!["web","twitchbot","discord","all"].includes(target))return json(res,400,{ok:false,error:"Unbekanntes Neustart-Ziel."});

      try{
        if(target==="discord"||target==="all"){
          await discordServiceRequest("/system/restart",{method:"POST",body:"{}"});
        }
        if(target==="twitchbot"||target==="all"){
          await twitchRuntime.restart();
        }

        audit(me.login,"system.restart.requested",{section:"system",target});

        if(target==="discord"){
          return json(res,200,{ok:true,target,message:"Discord-Dienst wird neu gestartet."});
        }
        if(target==="twitchbot"){
          return json(res,200,{ok:true,target,message:"Twitch-Bot wird neu gestartet."});
        }

        json(res,200,{
          ok:true,target,
          message:target==="all"?"Alle Dienste werden neu gestartet.":"Weboberfläche wird neu gestartet."
        });

        setTimeout(()=>{
          console.log(`🔄 Dienst-Neustart (${target}) durch ${me.login} angefordert.`);
          // Exit 75 is reserved for an intentional in-container app restart.
          // supervisor.js remains PID 1 and relaunches server.js without stopping the Docker container.
          process.exit(75);
        },1200);
        return;
      }catch(e){
        audit(me.login,"system.restart.failed",{section:"system",target,error:e.message});
        return json(res,502,{ok:false,error:e.message});
      }
    }

    if(u.pathname==="/api/discord/invite"&&req.method==="GET"){try{const r=await discordServiceRequest("/invite");return json(res,r.status||200,r.body);}catch(e){return json(res,502,{error:e.message});}}
    if(["/api/discord/invite/config","/api/discord/invite/check","/api/discord/invite/create"].includes(u.pathname)&&["PUT","POST"].includes(req.method)){
      if(!requireGlobalAdmin(req,res))return;
      try{const b=await readBody(req),route=u.pathname.replace("/api/discord","");const r=await discordServiceRequest(route,{method:req.method,body:JSON.stringify(b||{})});audit(sessionUser(req)?.login||"admin","discord.invite."+route.split("/").pop(),{channelId:b?.channelId||null});return json(res,r.status||200,r.body);}catch(e){return json(res,502,{error:e.message});}
    }
    if(u.pathname==="/api/discord/levelsystem/setup"&&["GET","POST"].includes(req.method)){try{const r=await discordServiceRequest("/levelsystem/setup",{method:req.method});return json(res,r.status||200,r.body);}catch(e){return json(res,502,{error:e.message});}}
    if(u.pathname==="/api/discord/levelsystem/publish"&&req.method==="POST"){try{const b=await readBody(req),r=await discordServiceRequest("/levelsystem/publish",{method:"POST",body:JSON.stringify(b)});return json(res,r.status||200,r.body);}catch(e){return json(res,502,{error:e.message});}}
    if(u.pathname==="/api/discord/levelsystem"&&req.method==="GET"){try{const r=await discordServiceRequest("/levelsystem");return json(res,200,r.body);}catch(e){return json(res,502,{error:e.message});}}
    if(u.pathname==="/api/discord/levelsystem/config"&&req.method==="PUT"){try{const b=await readBody(req),r=await discordServiceRequest("/levelsystem/config",{method:"PUT",body:JSON.stringify(b||{})});return json(res,200,r.body);}catch(e){return json(res,400,{error:e.message});}}
    if(u.pathname==="/api/discord/levelsystem/statistics"&&req.method==="GET"){try{const days=Number(u.searchParams.get('days')||30);if(![0,7,30,90].includes(days))return json(res,400,{error:'Ungültiger Zeitraum'});const r=await discordServiceRequest(`/levelsystem/statistics?days=${days}`);return json(res,r.status||200,r.body);}catch(e){return json(res,502,{error:e.message});}}
    if(u.pathname==="/api/discord/levelsystem/mission-history"&&req.method==="GET"){
      const me=requireCapability(req,res,"discord.moderation.view");if(!me)return;
      const id=String(u.searchParams.get('userId')||'');
      if(!/^\d{17,22}$/.test(id))return json(res,400,{error:'Ungültige Discord-ID'});
      try{const r=await discordServiceRequest(`/levelsystem/mission-history?userId=${encodeURIComponent(id)}`);return json(res,r.status||200,r.body);}catch(e){return json(res,503,{error:e.message});}
    }
    if(u.pathname==="/api/discord/levelsystem/rank-history"&&req.method==="GET"){
      const me=requireCapability(req,res,"discord.moderation.view");if(!me)return;
      const id=String(u.searchParams.get('userId')||'');
      if(!/^\d{17,22}$/.test(id))return json(res,400,{error:'Ungültige Discord-ID'});
      try{const r=await discordServiceRequest(`/levelsystem/rank-history?userId=${encodeURIComponent(id)}`);return json(res,r.status||200,r.body);}
      catch(e){return json(res,503,{error:e.message});}
    }
    if(u.pathname==="/api/discord/levelsystem/xp-history"&&req.method==="GET"){
      const me=requireCapability(req,res,"discord.moderation.view");if(!me)return;
      const id=String(u.searchParams.get('userId')||'');
      if(!/^\d{17,22}$/.test(id))return json(res,400,{error:"Ungültige Discord-ID"});
      try{const r=await discordServiceRequest(`/levelsystem/xp-history?userId=${encodeURIComponent(id)}`);return json(res,r.status||200,r.body);}
      catch(e){return json(res,502,{error:e.message});}
    }
    if(u.pathname==="/api/discord/levelsystem/xp"&&req.method==="POST"){try{const b=await readBody(req),r=await discordServiceRequest("/levelsystem/xp",{method:"POST",body:JSON.stringify(b||{})});audit(sessionUser(req)?.login||"admin","discord.levelsystem.xp",{userId:b.userId,mode:b.mode,amount:b.amount});return json(res,200,r.body);}catch(e){return json(res,400,{error:e.message});}}
    if (u.pathname === "/api/discord/dashboard" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.dashboard.view");if(!me)return;
      try{
        const result=await discordServiceRequest("/dashboard-summary"),payload=result.body||{ok:true};
        if(!(me.globalOwner||me.localAdmin||me.role==="owner"))delete payload.social;
        return json(res,200,payload);
      }catch(e){return json(res,502,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/status" && req.method === "GET") {
      const me=requireDiscordRole(req,res,"viewer"); if(!me) return;
      try {
        const result=await discordServiceRequest("/status");
        return json(res,200,{ok:true,serviceReachable:true,...(result.body||{})});
      } catch (e) {
        return json(res,200,{
          ok:false,
          serviceReachable:false,
          error:e.message,
          service:DISCORD_SERVICE_LABEL
        });
      }
    }

    if (u.pathname === "/api/discord/verify" && req.method === "POST") {
      // 8.8.1: Recht ausdrücklich prüfen (Dashboard-Ansicht, wie in der Matrix; vorher genügte jedes discord.*-Recht
      // über requireDiscordRole) und die Prüfung drosseln: sie löst mehrere Discord-API-Abrufe aus.
      const me=requireCapability(req,res,"discord.dashboard.view"); if(!me) return;
      const waitMs=discordVerifyThrottle.check();
      if(waitMs>0)return json(res,429,{ok:false,error:`Bitte ${Math.ceil(waitMs/1000)} Sekunden warten, die letzte Prüfung läuft noch oder ist gerade erst erfolgt.`,retryAfterSeconds:Math.ceil(waitMs/1000)},{"Retry-After":String(Math.ceil(waitMs/1000))});
      try {
        const result=await discordServiceRequest("/verify",{method:"POST"});
        audit(me,"discord.verify",{ok:true});
        return json(res,200,{ok:true,serviceReachable:true,...(result.body||{})});
      } catch (e) {
        audit(me,"discord.verify",{ok:false,error:e.message});
        return json(res,502,{ok:false,error:e.message});
      }
    }

    // Lesende XP-Übersicht nur mit der vorhandenen Discord-Mitgliederberechtigung.
    // Keine Konfigurationswerte, Ereignisse oder administrativen Endpunkte freigeben.
    if (u.pathname === "/api/discord/members/levels" && req.method === "GET") {
      const me=requireDiscordRole(req,res,"viewer"); if(!me)return;
      try {
        const result=await discordServiceRequest("/levelsystem");
        if(result.status>=400) return json(res,502,{ok:false,error:"Minigame-Daten derzeit nicht verfügbar."});
        const body=result.body||{}, ranks=body.config?.ranks||[];
        const players=(body.players||[]).map(u=>{
          const branch=["heer","luftwaffe","marine"].includes(u.branch)?u.branch:"heer";
          const xp=Number.isSafeInteger(u.xp)&&u.xp>=0?u.xp:0;
          const current=ranks.filter(r=>r.active!==false&&Number(r.xp)<=xp).at(-1);
          return {id:String(u.id),xp,branch,rank:String(current?.[branch]||textsPublic().level.noRank)};
        });
        return json(res,200,{ok:true,enabled:body.config?.enabled===true,players});
      }catch(e){return json(res,502,{ok:false,error:"Minigame-Daten derzeit nicht verfügbar."});}
    }

    if (u.pathname === "/api/discord/members" && req.method === "GET") {
      const me=requireDiscordRole(req,res,"viewer"); if(!me) return;
      try {
        const query=u.searchParams.get("query")||"";
        const limit=u.searchParams.get("limit")||"50";
        const result=await discordServiceRequest(`/members?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`);
        const payload=result.body||{ok:true,members:[],roles:[]};
        payload.guildId=discordProfile().guildId||payload.guildId||"";payload.memberRoleId=discordProfile().roles.member||"";
        const users=readUsers().users;
        payload.members=(payload.members||[]).map(m=>{
          const record=users.find(x=>String(x.discordUserId||"")===String(m.id));
          return {...m,backendAccess:record?.discordBackendEnabled===true,backendRole:record?.discordRole||null,linkedTwitch:!!record?.twitchUserId,globalOwner:record?.globalOwner===true};
        });
        return json(res,200,payload);
      } catch(e) { return json(res,502,{ok:false,error:e.message}); }
    }

    if (u.pathname === "/api/discord/members/role" && req.method === "POST") {
      const me=requireUser(req,res); if(!me)return;
      try {
        const body=await readBody(req);
        const memberRoleId=discordProfile().roles.member, adminRoleId=discordProfile().roles.administrator;
        const action=String(body.action||""), roleId=String(body.roleId||"");
        const full=me.globalOwner||me.globalAdmin||me.localAdmin||me.role==="owner"||me.role==="admin";
        if(!full){
          if(memberRoleId&&roleId===memberRoleId&&action==="remove"){
            if(!hasCapability(me,"discord.member.remove")) return json(res,403,{error:"Dir fehlt die Berechtigung, die Freischaltrolle zu entziehen."});
          }else if(memberRoleId&&roleId===memberRoleId&&action==="add"){
            if(!hasCapability(me,"discord.member.assign")) return json(res,403,{error:"Dir fehlt die Berechtigung, die Freischaltrolle zu vergeben."});
          }else if(adminRoleId&&roleId===adminRoleId){
            return json(res,403,{error:"Die Administrator-Rolle darf ausschließlich durch Owner oder Administratoren verwaltet werden."});
          }else return json(res,403,{error:"Diese Rollenänderung ist nur Ownern oder Administratoren erlaubt."});
        }
        const result=await discordServiceRequest("/members/role",{method:"POST",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"discord.member.role",{ok:true,userId:body.userId,roleId:body.roleId,action:body.action,changed:result.body?.changed===true});
        return json(res,200,result.body||{ok:true});
      } catch(e) {
        audit(me?.login||me?.discordUsername||me?.name||"unknown","discord.member.role",{ok:false,error:e.message});
        return json(res,400,{ok:false,error:e.message});
      }
    }

    if (u.pathname === "/api/social/tiktok/oauth-info" && req.method === "GET") {
      const me=requireGlobalOwner(req,res);if(!me)return;if(!tiktokRedirectUri())return json(res,500,{error:"Öffentliche Adresse fehlt (PUBLIC_BASE_URL bzw. Profil & Branding); Redirect-URI kann nicht sicher abgeleitet werden."});
      try{const result=await discordServiceRequest(`/social/tiktok/oauth-info?redirectUri=${encodeURIComponent(tiktokRedirectUri())}`);return json(res,200,result.body||{});}catch(e){return json(res,502,{error:e.message});}
    }
    if (u.pathname === "/api/social/tiktok/connect" && req.method === "POST") {
      const me=requireGlobalOwner(req,res);if(!me)return;if(!tiktokRedirectUri())return json(res,500,{error:"Öffentliche Adresse fehlt (PUBLIC_BASE_URL bzw. Profil & Branding); Redirect-URI kann nicht sicher abgeleitet werden."});
      try{const actor=me.login||me.discordUsername||me.name||"Owner",result=await discordServiceRequest("/social/tiktok/oauth/start",{method:"POST",body:JSON.stringify({redirectUri:tiktokRedirectUri(),initiatedBy:actor})});audit(actor,"social.tiktok.oauth.started",{redirectUri:tiktokRedirectUri()});return json(res,200,result.body||{});}catch(e){return json(res,Number(e?.status)||400,{error:e.message});}
    }
    if (u.pathname === "/api/social/tiktok/disconnect" && req.method === "POST") {
      const me=requireGlobalOwner(req,res);if(!me)return;try{const actor=me.login||me.discordUsername||me.name||"Owner",result=await discordServiceRequest("/social/tiktok/disconnect",{method:"POST"});audit(actor,"social.tiktok.disconnected",{revokeError:result.body?.revokeError||null});return json(res,200,result.body||{ok:true});}catch(e){return json(res,Number(e?.status)||400,{error:e.message});}
    }
    if (u.pathname === "/api/social/tiktok/clear-data" && req.method === "POST") {
      const me=requireGlobalOwner(req,res);if(!me)return;try{const actor=me.login||me.discordUsername||me.name||"Owner",result=await discordServiceRequest("/social/tiktok/clear-data",{method:"POST"});audit(actor,"social.tiktok.local-data-cleared",{discordMessagesRemoved:false});return json(res,200,result.body||{ok:true});}catch(e){return json(res,Number(e?.status)||400,{error:e.message});}
    }

    if (u.pathname === "/api/social" && req.method === "GET") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      try{
        const q=new URLSearchParams();
        for(const key of["platform","status","search","page","pageSize"]){const v=u.searchParams.get(key);if(v!==null)q.set(key,v);}
        const result=await discordServiceRequest(`/social?${q.toString()}`);
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,502,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/social/instagram/token" && req.method === "PUT") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      try{
        const body=await readBody(req);
        if(!body?.token)return json(res,400,{ok:false,error:"Bitte einen Instagram Access Token eintragen."});
        const result=await discordServiceRequest("/social/instagram/token",{method:"PUT",body:JSON.stringify({token:String(body.token)})});
        audit(me.login||me.discordUsername||me.name,"social.instagram.token.replaced",{section:"social.instagram"});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/social/instagram/refresh" && req.method === "POST") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      try{
        const result=await discordServiceRequest("/social/instagram/refresh",{method:"POST"});
        audit(me.login||me.discordUsername||me.name,"social.instagram.token.refreshed",{section:"social.instagram"});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/social/config" && req.method === "PUT") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/social/config",{method:"PUT",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"social.config",{section:"social.settings",ok:true});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/social/poll" && req.method === "POST") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      try{
        const result=await discordServiceRequest("/social/poll",{method:"POST"});
        audit(me.login||me.discordUsername||me.name,"social.poll",{section:"social.settings",ok:true});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/social/test" && req.method === "POST") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/social/test",{method:"POST",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"social.test",{section:"social.settings",platform:body.platform,ok:true});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/social/retry" && req.method === "POST") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/social/retry",{method:"POST",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"social.retry",{section:"social.publications",key:body.key,ok:true});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/social/history-send" && req.method === "POST") {
      const me=requireGlobalOwner(req,res);if(!me)return;
      try{
        const body=await readBody(req),mode=String(body.mode||"test"),result=await discordServiceRequest("/social/history-send",{method:"POST",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"social.history-send",{section:"social.publications",key:body.key,mode,messageId:result.body?.messageId||null,ok:true});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/emergency" && req.method === "GET") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{
        const result=await discordServiceRequest("/emergency");
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,502,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/emergency/config" && req.method === "PUT") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/emergency/config",{method:"PUT",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"discord.emergency.config",{section:"discord.emergency"});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/emergency/activate" && req.method === "POST") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{
        const body=await readBody(req),actor=me.login||me.discordUsername||me.name||"Administrator";
        const payload={level:String(body.level||""),reason:String(body.reason||""),durationMinutes:Number(body.durationMinutes||0),actor};
        const result=await discordServiceRequest("/emergency/activate",{method:"POST",body:JSON.stringify(payload)});
        audit(actor,"discord.emergency.activated",{section:"discord.emergency",level:payload.level,reason:payload.reason,durationMinutes:payload.durationMinutes});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/emergency/level" && req.method === "POST") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{
        const body=await readBody(req),actor=me.login||me.discordUsername||me.name||"Administrator";
        const payload={level:String(body.level||""),reason:String(body.reason||""),actor};
        const result=await discordServiceRequest("/emergency/level",{method:"POST",body:JSON.stringify(payload)});
        audit(actor,"discord.emergency.level-changed",{section:"discord.emergency",level:payload.level,reason:payload.reason});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/emergency/deactivate" && req.method === "POST") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{
        const body=await readBody(req),actor=me.login||me.discordUsername||me.name||"Administrator",reason=String(body.reason||"manuell beendet");
        const result=await discordServiceRequest("/emergency/deactivate",{method:"POST",body:JSON.stringify({actor,reason})});
        audit(actor,"discord.emergency.deactivated",{section:"discord.emergency",reason});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/logs" && req.method === "GET") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{
        const result=await discordServiceRequest("/logs");
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,502,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/logs/config" && req.method === "PUT") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/logs/config",{method:"PUT",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"discord.logs.config",{section:"discord.logs",enabled:body?.enabled!==false,defaultChannelId:body?.defaultChannelId||null});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/logs/test" && req.method === "POST") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/logs/test",{method:"POST",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"discord.logs.test",{section:"discord.logs",eventKey:body?.eventKey||null});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/logs/reset" && req.method === "POST") {
      const me=requireGlobalAdmin(req,res);if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/logs/reset",{method:"POST",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"discord.logs.reset",{section:"discord.logs",eventKey:body?.eventKey||null});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/channel-times" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.channel-times.view");if(!me)return;
      try{
        const result=await discordServiceRequest("/channel-times");
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,502,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/channel-times/maintenance" && req.method === "PUT") {
      const me=requireCapability(req,res,"discord.channel-times.edit");if(!me)return;
      try{const body=await readBody(req),result=await discordServiceRequest("/channel-times/maintenance",{method:"PUT",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"discord.channel-times.maintenance",{active:body?.active===true});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/channel-times/config" && req.method === "PUT") {
      const me=requireCapability(req,res,"discord.channel-times.edit");if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/channel-times/config",{method:"PUT",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"discord.channel-times.config",{section:"discord.channel-times",profileCount:Array.isArray(body?.profiles)?body.profiles.length:0,enabled:body?.enabled===true});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/channel-times/action" && req.method === "POST") {
      const me=requireCapability(req,res,"discord.channel-times.edit");if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/channel-times/action",{method:"POST",body:JSON.stringify(body||{})});
        audit(me.login||me.discordUsername||me.name,"discord.channel-times.action",{section:"discord.channel-times",profileId:body?.profileId||null,action:body?.action||null});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/announcements" && req.method === "GET") {
      const me=requireDiscordRole(req,res,"viewer"); if(!me)return;
      try{const result=await discordServiceRequest("/announcements");return json(res,200,result.body||{ok:true});}
      catch(e){return json(res,502,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/announcements" && req.method === "PUT") {
      const me=requireDiscordRole(req,res,"editor"); if(!me)return;
      try{
        const body=await readBody(req);
        const result=await discordServiceRequest("/announcements/config",{method:"PUT",body:JSON.stringify(body||{})});
        audit(me,"discord.announcements.config",{ok:true});
        return json(res,200,result.body||{ok:true});
      }catch(e){audit(me,"discord.announcements.config",{ok:false,error:e.message});return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/announcements/test" && req.method === "POST") {
      const me=requireDiscordRole(req,res,"editor"); if(!me)return;
      try{
        const body=await readBody(req);
        const result=await discordServiceRequest("/announcements/test",{method:"POST",body:JSON.stringify(body||{})});
        audit(me,"discord.announcements.test",{type:body.type,ok:true});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/reports" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.reports.view");if(!me)return;
      try{
        const q=new URLSearchParams();
        for(const key of["status","search","page","pageSize"]){const v=u.searchParams.get(key);if(v!==null)q.set(key,v);}
        const result=await discordServiceRequest(`/reports?${q.toString()}`);
        return json(res,200,result.body||{ok:true,items:[]});
      }catch(e){return json(res,502,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/reports/config" && req.method === "PUT") {
      const me=requireCapability(req,res,"discord.reports.edit");if(!me)return;
      try{
        const body=await readBody(req),result=await discordServiceRequest("/reports/config",{method:"PUT",body:JSON.stringify(body||{})});
        const actor=me.login||me.discordUsername||me.name||"Moderator";
        audit(actor,"discord.reports.config",{section:"discord.reports"});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/reports/button/publish" && req.method === "POST") {
      const me=requireCapability(req,res,"discord.reports.edit");if(!me)return;
      try{
        const result=await discordServiceRequest("/reports/button/publish",{method:"POST"});
        const actor=me.login||me.discordUsername||me.name||"Moderator";
        audit(actor,"discord.reports.button.publish",{section:"discord.reports",messageId:result.body?.messageId||null});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/reports/action" && req.method === "POST") {
      const me=requireCapability(req,res,"discord.reports.edit");if(!me)return;
      try{
        const body=await readBody(req),actorName=me.name||me.discordUsername||me.login||"Moderator",actorId=me.internalUserId||me.discordId||me.id||"";
        const result=await discordServiceRequest("/reports/action",{method:"POST",body:JSON.stringify({...body,actorName,actorId})});
        audit(actorName,"discord.reports.action",{section:"discord.reports",ticketId:body.ticketId,action:body.action,targetUserId:result.body?.ticket?.targetUser?.id||null});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/reports/attachment" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.reports.view");if(!me)return;
      try{
        const q=new URLSearchParams({ticketId:String(u.searchParams.get("ticketId")||""),file:String(u.searchParams.get("file")||"")});
        const result=await discordServiceBinary(`/reports/attachment?${q.toString()}`);
        const filename=safeAttachmentName(u.searchParams.get("file")||"attachment.bin");
        const rasterType=rasterMimeFromBuffer(result.buffer);
        const inline=!!rasterType;
        res.writeHead(200,{
          "Content-Type":inline?rasterType:"application/octet-stream",
          "Content-Length":String(result.buffer.length),
          "Content-Disposition":`${inline?"inline":"attachment"}; filename="${filename}"`,
          "Cache-Control":"private, no-store, max-age=0",
          "X-Content-Type-Options":"nosniff",
          "Content-Security-Policy":"sandbox; default-src 'none'; img-src 'self' data:",
          "X-Frame-Options":"DENY"
        });
        res.end(result.buffer);return;
      }catch(e){return json(res,404,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/moderation" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.moderation.view");if(!me)return;
      try{const result=await discordServiceRequest("/moderation");return json(res,200,result.body||{ok:true});}catch(e){return json(res,502,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/moderation" && req.method === "PUT") {
      const me=requireCapability(req,res,"discord.moderation.edit");if(!me)return;
      try{const body=await readBody(req);const result=await discordServiceRequest("/moderation/config",{method:"PUT",body:JSON.stringify(body||{})});audit(me.login||me.discordUsername||me.name||"unknown","discord.moderation.config",{section:"discord.moderation",ok:true,rules:Array.isArray(body.rules)?body.rules.length:0,enabled:body.enabled===true});return json(res,200,result.body||{ok:true});}
      catch(e){audit(me?.login||me?.discordUsername||me?.name||"unknown","discord.moderation.config",{section:"discord.moderation",ok:false,error:e.message});return json(res,400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/moderation/test" && req.method === "POST") {
      const me=requireCapability(req,res,"discord.moderation.view");if(!me)return;
      try{const body=await readBody(req);const result=await discordServiceRequest("/moderation/test",{method:"POST",body:JSON.stringify(body||{})});return json(res,200,result.body||{ok:true});}catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/moderation/member-history" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.moderation.view");if(!me)return;
      const userId=String(u.searchParams.get("userId")||"").trim();
      if(!/^\d{16,22}$/.test(userId))return json(res,400,{ok:false,error:"Ungültige Discord-ID."});
      try{const result=await discordServiceRequest(`/moderation/member-history?userId=${encodeURIComponent(userId)}`);return json(res,200,result.body||{ok:true,events:[]});}
      catch(e){return json(res,502,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/moderation/history" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.moderation.view");if(!me)return;
      try{
        const query=u.searchParams.get("query")||"";
        const result=await discordServiceRequest(`/moderation/history?query=${encodeURIComponent(query)}`);
        return json(res,200,result.body||{ok:true,items:[]});
      }catch(e){return json(res,502,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/moderation/logs" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.moderation.view");if(!me)return;
      try{const result=await discordServiceRequest(`/moderation/logs?limit=${encodeURIComponent(u.searchParams.get("limit")||"50")}`);return json(res,200,result.body||{ok:true,items:[]});}catch(e){return json(res,502,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/moderation/sanctions" && req.method === "GET") {
      const me=requireCapability(req,res,"discord.moderation.view");if(!me)return;
      try{const result=await discordServiceRequest("/moderation/sanctions");return json(res,200,result.body||{ok:true,warned:[],bans:[]});}catch(e){return json(res,502,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/moderation/untimeout" && req.method === "POST") {
      const me=requireCapability(req,res,"discord.moderation.edit");if(!me)return;
      try{
        const body=await readBody(req);
        const actor=me.login||me.discordUsername||me.name||"Moderator";
        const result=await discordServiceRequest("/moderation/untimeout",{method:"POST",body:JSON.stringify({userId:body.userId,actor,resetEscalation:body.resetEscalation===true})});
        audit(actor,"discord.moderation.untimeout",{section:"discord.moderation",userId:body.userId,resetEscalation:body.resetEscalation===true});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/moderation/unban" && req.method === "POST") {
      const me=requireCapability(req,res,"discord.moderation.edit");if(!me)return;
      try{
        const body=await readBody(req);
        const actor=me.login||me.discordUsername||me.name||"Moderator";
        const result=await discordServiceRequest("/moderation/unban",{method:"POST",body:JSON.stringify({userId:body.userId,actor})});
        audit(actor,"discord.moderation.unban",{section:"discord.moderation",userId:body.userId});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }
    if (u.pathname === "/api/discord/moderation/reset-user" && req.method === "POST") {
      const me=requireCapability(req,res,"discord.moderation.edit");if(!me)return;
      try{
        const body=await readBody(req);
        const actor=me.login||me.discordUsername||me.name||"Moderator";
        const result=await discordServiceRequest("/moderation/reset-user",{method:"POST",body:JSON.stringify({userId:body.userId})});
        audit(actor,"discord.moderation.user-reset",{section:"discord.moderation",userId:body.userId});
        return json(res,200,result.body||{ok:true});
      }catch(e){return json(res,Number(e?.status)||400,{ok:false,error:e.message});}
    }

    if (u.pathname === "/api/discord/access/preview" && req.method === "GET") {
      const me=requireDiscordRole(req,res,"viewer"); if(!me) return;
      try { const result=await discordServiceRequest("/access/preview"); return json(res,200,result.body||{ok:true}); }
      catch(e) { return json(res,502,{ok:false,error:e.message}); }
    }

    if (u.pathname === "/api/discord/access/apply" && req.method === "POST") {
      const me=requireGlobalAdmin(req,res); if(!me) return;
      try {
        const body=await readBody(req);
        const result=await discordServiceRequest("/access/apply",{method:"POST",body:JSON.stringify(body||{})});
        audit(me,"discord.access.apply",{ok:true,changed:result.body?.applied?.length||0});
        return json(res,200,result.body||{ok:true});
      } catch(e) {
        audit(me,"discord.access.apply",{ok:false,error:e.message});
        return json(res,400,{ok:false,error:e.message});
      }
    }

    if (u.pathname === "/api/discord/onboarding" && req.method === "GET") {
      const me=requireDiscordRole(req,res,"viewer"); if(!me) return;
      try {
        const result=await discordServiceRequest("/onboarding");
        return json(res,200,result.body||{ok:true});
      } catch (e) {
        return json(res,502,{ok:false,error:e.message});
      }
    }

    if (u.pathname === "/api/discord/onboarding" && req.method === "PUT") {
      const me=requireDiscordRole(req,res,"editor"); if(!me) return;
      try {
        const body=await readBody(req);
        const result=await discordServiceRequest("/onboarding/config",{method:"PUT",body:JSON.stringify(body)});
        audit(me,"discord.onboarding.config",{enabled:body.enabled,logEnabled:body.logEnabled,newMemberTimeoutMinutes:body.newMemberTimeoutMinutes});
        return json(res,200,result.body||{ok:true});
      } catch (e) {
        audit(me,"discord.onboarding.config",{ok:false,error:e.message});
        return json(res,502,{ok:false,error:e.message});
      }
    }

    if (u.pathname === "/api/discord/onboarding/activate" && req.method === "POST") {
      const me=requireDiscordRole(req,res,"editor"); if(!me) return;
      try {
        const result=await discordServiceRequest("/onboarding/activate",{method:"POST"});
        audit(me,"discord.onboarding.activate",{ok:true});
        return json(res,200,result.body||{ok:true});
      } catch (e) {
        audit(me,"discord.onboarding.activate",{ok:false,error:e.message});
        return json(res,400,{ok:false,error:e.message});
      }
    }

    if (u.pathname === "/api/discord/onboarding/deactivate" && req.method === "POST") {
      const me=requireDiscordRole(req,res,"editor"); if(!me) return;
      try {
        const result=await discordServiceRequest("/onboarding/deactivate",{method:"POST"});
        audit(me,"discord.onboarding.deactivate",{ok:true});
        return json(res,200,result.body||{ok:true});
      } catch (e) {
        audit(me,"discord.onboarding.deactivate",{ok:false,error:e.message});
        return json(res,400,{ok:false,error:e.message});
      }
    }

    if (u.pathname === "/api/discord/onboarding/test" && req.method === "POST") {
      const me=requireDiscordRole(req,res,"editor"); if(!me) return;
      try {
        const result=await discordServiceRequest("/onboarding/test",{method:"POST"});
        audit(me,"discord.onboarding.test",{ok:true});
        return json(res,200,result.body||{ok:true});
      } catch (e) {
        audit(me,"discord.onboarding.test",{ok:false,error:e.message});
        return json(res,502,{ok:false,error:e.message});
      }
    }

    if (u.pathname === "/api/discord/onboarding/rules/publish" && req.method === "POST") {
      const me=requireDiscordRole(req,res,"editor"); if(!me) return;
      try {
        const result=await discordServiceRequest("/onboarding/rules/publish",{method:"POST"});
        audit(me,"discord.onboarding.rules.publish",{ok:true,messageId:result.body?.messageId||null});
        return json(res,200,result.body||{ok:true});
      } catch (e) {
        audit(me,"discord.onboarding.rules.publish",{ok:false,error:e.message});
        return json(res,502,{ok:false,error:e.message});
      }
    }

    if (u.pathname === "/api/discord/onboarding/rules/update" && req.method === "POST") {
      const me=requireDiscordRole(req,res,"editor"); if(!me) return;
      try {
        const result=await discordServiceRequest("/onboarding/rules/update",{method:"POST"});
        audit(me,"discord.onboarding.rules.update",{ok:true,messageId:result.body?.messageId||null});
        return json(res,200,result.body||{ok:true});
      } catch (e) {
        audit(me,"discord.onboarding.rules.update",{ok:false,error:e.message});
        return json(res,502,{ok:false,error:e.message});
      }
    }

    // Followathon: öffentliche Overlay-Endpunkte sind strikt lesend und enthalten nur Overlaydaten.
    // Live-Follower-Alert: öffentliche Browserquelle, Konfiguration nur für Berechtigte.
    // 8.9.0: Stubenkontrolle-Overlay als gehostete Browserquelle. Die Seite selbst enthält keine Daten;
    // der lesende Overlay-Schlüssel steht im URL-Fragment (#key=…) und erreicht den Server nur beim WebSocket-Aufbau.
    if (u.pathname === "/stubenkontrolle/overlay" && req.method === "GET") {
      return send(res,200,fs.readFileSync(path.join(PUBLIC_DIR,"stubenkontrolle-overlay.html")),"text/html; charset=utf-8",{"Cache-Control":"no-cache"});
    }
    if (u.pathname === "/follower-alert/overlay" && req.method === "GET") {
      return send(res,200,fs.readFileSync(path.join(PUBLIC_DIR,"follower-alert-overlay.html")),"text/html; charset=utf-8");
    }
    if (u.pathname === "/api/follower-alert/public/state" && req.method === "GET") {
      return json(res,200,{enabled:followerAlert.getConfig().enabled});
    }
    if (u.pathname === "/api/follower-alert/public/stream" && req.method === "GET") {
      return followerAlert.addSseClient(res,req,clientIp(req));
    }
    if (u.pathname === "/api/follower-alert" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.followathon.view");if(!me)return;
      return json(res,200,{ok:true,config:followerAlert.getConfig(),overlayUrl:publicBaseUrl()?`${publicBaseUrl()}/follower-alert/overlay`:"/follower-alert/overlay"});
    }
    if (u.pathname === "/api/follower-alert" && req.method === "PUT") {
      const me=requireCapability(req,res,"twitch.followathon.edit");if(!me)return;
      try {
        const body=await readBody(req);const config=followerAlert.configure(body);
        audit(me.login||me.name||"admin","follower-alert.config",{section:"followathon",enabled:config.enabled});
        syncEventProfilesAfterChange(me.login||me.name||"admin","follower-alert");
        return json(res,200,{ok:true,config});
      }catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/follower-alert/test" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.followathon.edit");if(!me)return;
      try {
        const body=await readBody(req);followerAlert.test(body.userName||textsPublic().testName);
        return json(res,200,{ok:true});
      }catch(e){return json(res,400,{error:e.message});}
    }

    // 9.27.0: Chat-Overlay. Die Seite lädt Bilder nur vom Twitch-Bildserver (eigene Schutzregel in shared/csp.js).
    if (u.pathname === "/chat-overlay/overlay" && req.method === "GET") {
      return send(res,200,fs.readFileSync(path.join(PUBLIC_DIR,"chat-overlay.html")),"text/html; charset=utf-8",{"Cache-Control":"no-cache"});
    }
    if (u.pathname === "/api/chat-overlay/public/state" && req.method === "GET") return json(res,200,{enabled:true});
    if (u.pathname === "/api/chat-overlay/public/stream" && req.method === "GET") return chatOverlay.addSseClient(res,req,clientIp(req));
    if (u.pathname === "/api/chat-overlay" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.followathon.view");if(!me)return;
      return json(res,200,{ok:true,config:chatOverlay.getConfig(),overlayUrl:publicBaseUrl()?`${publicBaseUrl()}/chat-overlay/overlay`:"/chat-overlay/overlay"});
    }
    if (u.pathname === "/api/chat-overlay" && req.method === "PUT") {
      const me=requireCapability(req,res,"twitch.followathon.edit");if(!me)return;
      try {
        const body=await readBody(req);const config=chatOverlay.configure(body);
        audit(me.login||me.name||"admin","chat-overlay.config",{section:"followathon",theme:config.theme,botMessages:config.botMessages,delaySeconds:config.delaySeconds});
        return json(res,200,{ok:true,config});
      }catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/chat-overlay/test" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.followathon.edit");if(!me)return;
      return json(res,200,{ok:true,sent:chatOverlay.test()});
    }

    // 9.20.0: Subathon
    if (u.pathname === "/api/subathon/public/state" && req.method === "GET") return json(res,200,subathon.getPublicState());
    if (u.pathname === "/api/subathon/public/stream" && req.method === "GET") return subathon.addSseClient(res,clientIp(req));
    if (u.pathname === "/subathon/overlay" && req.method === "GET") return send(res,200,fs.readFileSync(path.join(PUBLIC_DIR,"subathon-overlay.html")),"text/html; charset=utf-8");
    if (u.pathname === "/api/subathon" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.subathon.view"); if(!me)return;
      return json(res,200,await subathon.getAdminState());
    }
    if (u.pathname === "/api/subathon/event" && req.method === "POST") {
      const me=requireGlobalOwner(req,res); if(!me)return;
      const body=await readBody(req);
      try{return json(res,200,{ok:true,event:await subathon.createEvent(body,me.login||me.name||"owner")});}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/subathon/event/update" && req.method === "POST") {
      const me=requireGlobalOwner(req,res); if(!me)return;
      const body=await readBody(req);
      try{return json(res,200,{ok:true,event:await subathon.updateEvent(body,me.login||me.name||"owner")});}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/subathon/action" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.subathon.edit"); if(!me)return;
      const body=await readBody(req);
      try{return json(res,200,{ok:true,event:await subathon.action(String(body.action||""),body,me.login||me.name||"moderator")});}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/subathon/check" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.subathon.edit"); if(!me)return;
      try{await twitchRuntime.subathonEnsure();return json(res,200,await subathon.getAdminState());}
      catch(e){return json(res,502,{error:"Der Twitch-Bot ist nicht erreichbar: "+e.message});}
    }
    if (u.pathname === "/api/subathon/test" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.subathon.edit"); if(!me)return;
      const body=await readBody(req);
      try{return json(res,200,await subathon.simulate(body,me.login||me.name||"moderator"));}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/subathon/reset" && req.method === "POST") {
      const me=requireGlobalOwner(req,res); if(!me)return;
      try{return json(res,200,await subathon.reset(me.login||me.name||"owner"));}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/followathon/public/state" && req.method === "GET") {
      return json(res,200,followathon.getPublicState());
    }
    if (u.pathname === "/api/followathon/public/stream" && req.method === "GET") {
      return followathon.addSseClient(res,clientIp(req));
    }
    if (u.pathname === "/followathon/overlay" && req.method === "GET") {
      const full=path.join(PUBLIC_DIR,"followathon-overlay.html");
      return send(res,200,fs.readFileSync(full),"text/html; charset=utf-8");
    }
    if (u.pathname === "/api/followathon" && req.method === "GET") {
      const me=requireCapability(req,res,"twitch.followathon.view"); if(!me)return;
      return json(res,200,await followathon.getAdminState());
    }
    if (u.pathname === "/api/followathon/event" && req.method === "POST") {
      const me=requireGlobalOwner(req,res); if(!me)return;
      if(subathonActive())return json(res,409,{error:"Ein Subathon läuft. Bitte zuerst den Subathon beenden, dann einen Followathon anlegen."});
      const body=await readBody(req);
      try{return json(res,200,{ok:true,event:await followathon.createEvent(body,me.login||me.name||"owner")});}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/followathon/action" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.followathon.edit"); if(!me)return;
      const body=await readBody(req);
      if(subathonActive()&&["start","resume"].includes(String(body.action||"")))return json(res,409,{error:"Ein Subathon läuft. Der Followathon ist währenddessen gesperrt."});
      try{return json(res,200,{ok:true,event:await followathon.action(String(body.action||""),body,me.login||me.name||"moderator")});}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/followathon/review" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.followathon.edit"); if(!me)return;
      const body=await readBody(req);
      try{return json(res,200,{ok:true,result:await followathon.reviewHeld(String(body.heldId||""),body.approve===true,me.login||me.name||"moderator")});}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/followathon/retract" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.followathon.edit"); if(!me)return;
      const body=await readBody(req);
      try{return json(res,200,{ok:true,result:await followathon.retract(body,me.login||me.name||"moderator")});}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/followathon/reset" && req.method === "POST") {
      const me=requireGlobalOwner(req,res); if(!me)return;
      try{return json(res,200,await followathon.reset(me.login||me.name||"owner"));}
      catch(e){return json(res,400,{error:e.message});}
    }
    if (u.pathname === "/api/followathon/test" && req.method === "POST") {
      const me=requireCapability(req,res,"twitch.followathon.edit"); if(!me)return;
      const body=await readBody(req);
      try{return json(res,200,await followathon.testFollow(body,me.login||me.name||"moderator"));}
      catch(e){return json(res,400,{error:e.message});}
    }

    if (u.pathname === "/api/admin/performance" && req.method === "GET") {
      const me=requireGlobalAdmin(req,res); if(!me)return;
      let discord=null,discordNote=null;
      try{const r=await discordServiceRequest("/performance");if(r.status===200&&r.body?.ok)discord=r.body.metrics||null;else discordNote="Discord-Diagnose derzeit nicht verfügbar";}
      catch{discordNote="Discord-Dienst nicht erreichbar oder Diagnose nicht verfügbar";}
      return json(res,200,{updatedAt:new Date().toISOString(),twitch:await twitchRuntime.messageCounterDiagnostics(),discord,discordNote});
    }

    if (u.pathname === "/api/system-status" && req.method === "GET") {
      const me=requireGlobalAdmin(req,res); if(!me) return;
      const status=await buildSystemStatus();
      return json(res,200,status);
    }

    if (u.pathname === "/api/dashboard-summary" && req.method === "GET") {
      const me = requireCapability(req,res,"twitch.dashboard.view"); if (!me) return;
      try{
        const current=readJson(FILES.settings,DEFAULT_SETTINGS);prepareSettings(current);
        const wf=pgStore.wordFilterSnapshot();
        const terms=Array.isArray(wf?.terms)?wf.terms:[];
        const platformEnabled=(term,platform)=>Array.isArray(term?.platforms)&&term.platforms.some(p=>p?.platform===platform&&p?.enabled===true);
        const productionTerms=terms.filter(t=>t?.enabled!==false&&t?.test_only!==true&&(platformEnabled(t,"twitch")||platformEnabled(t,"discord")));
        const testTerms=terms.filter(t=>t?.enabled!==false&&t?.test_only===true&&(platformEnabled(t,"twitch")||platformEnabled(t,"discord")));
        return json(res,200,{ok:true,summary:{
          commands:(current.commands||[]).filter(x=>x?.enabled).length,
          timers:(current.timers||[]).filter(x=>x?.enabled).length,
          autoReplies:(current.autoReplies||[]).filter(x=>x?.enabled).length,
          greetings:(current.greetings||[]).filter(x=>x?.enabled).length,
          follow:!!current.events?.follow?.enabled,
          raid:!!current.events?.raid?.enabled,
          clipSharing:!!current.clipSharing?.enabled,
          communityCommands:[current.communityCommands?.followage?.enabled,current.communityCommands?.watchtime?.enabled].filter(Boolean).length,
          wordFilter:{
            active:productionTerms.length,
            test:testTerms.length,
            twitch:productionTerms.filter(t=>platformEnabled(t,"twitch")).length,
            discord:productionTerms.filter(t=>platformEnabled(t,"discord")).length,
            total:terms.length,
            legacyActive:(current.blockedWords||[]).filter(x=>x?.enabled).length,
            revision:Number(wf?.revision||0)
          }
        }});
      }catch(e){return json(res,500,{ok:false,error:"Dashboard-Zusammenfassung konnte nicht geladen werden."});}
    }

    if (u.pathname === "/api/status" && req.method === "GET") {
      const es=await twitchRuntime.eventSubStatus();
      const me = requireUser(req,res); if (!me) return;
      return json(res,200,{
        tokens:await twitchRuntime.tokenPresence(),
        appToken: isAdminLevel(me)?await appTokenStatus():{valid:(await appTokenStatus()).valid===true},
        eventsub: es.connected,
        eventsubStatus:{
          state:es.runtime.state,
          socketState:es.socketState,
          ok:Object.values(es.subscriptions).filter(x=>x?.ok).length,
          expected:5,
          lastConnectedAt:es.runtime.lastConnectedAt,
          lastMessageAt:es.runtime.lastMessageAt,
          reconnectAttempts:es.runtime.reconnectAttempts,
          nextRetryAt:es.runtime.nextRetryAt,
          ...(isAdminLevel(me)?{lastError:es.runtime.lastError}:{})
        },
        ...(isAdminLevel(me)?{eventSubSubscriptions:es.subscriptions,channelId:await twitchRuntime.channelId()}:{})
      });
    }
    if (u.pathname === "/api/test" && req.method === "POST") {
      const me = requireCapability(req,res,"twitch.commands.edit"); if (!me) return;
      const body = await readBody(req);
      await twitchRuntime.sendChat(body.bot || mainBotKeyNow(), body.message || "Bot-Test ✅");
      audit(me.login,"chat.test",{bot:body.bot});
      return json(res,200,{ok:true});
    }

    // 9.20.4: Browser fragen von sich aus nach /favicon.ico – hochgeladenes Symbol, sonst das mitgelieferte.
    if (u.pathname==="/favicon.ico" && req.method==="GET") {
      const up=installationProfile().images?.favicon;
      try{
        if(up&&imageKit.FILE_RE.test(up.file))return send(res,200,fs.readFileSync(path.join(UPLOAD_DIR,up.file)),up.mime,{"X-Content-Type-Options":"nosniff","Cache-Control":"no-cache"});
      }catch{}
      return send(res,200,fs.readFileSync(path.join(PUBLIC_DIR,"favicon-default.svg")),"image/svg+xml",{"Cache-Control":"no-cache"});
    }
    // 9.14.0: Bild eines Bildplatzes (öffentlich, wie die Overlays). Hochgeladen vor Standardbild; ohne beides 404.
    const publicImage=/^\/branding\/image\/([A-Za-z]+)$/.exec(u.pathname);
    if (publicImage && req.method==="GET") {
      const slot=publicImage[1];
      if(!imageKit.isSlot(slot))return send(res,404,"Not found","text/plain");
      const up=installationProfile().images?.[slot];
      let data=null,mime=null;
      if(up&&imageKit.FILE_RE.test(up.file)){try{data=fs.readFileSync(path.join(UPLOAD_DIR,up.file));mime=up.mime;}catch{data=null;}}
      if(!data&&imageDefaultMode(slot)==="default"){try{data=fs.readFileSync(path.join(PUBLIC_DIR,LEGACY_DEFAULT_IMAGES[slot]));mime="image/png";}catch{data=null;}}
      if(!data)return send(res,404,"Not found","text/plain",{"Cache-Control":"no-store"});
      return send(res,200,data,mime,{"X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox","Content-Disposition":"inline",
        "Cache-Control":u.searchParams.get("v")?"public, max-age=86400":"no-cache"});
    }

    let file = u.pathname === "/" ? "/index.html" : u.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
    const full = path.join(PUBLIC_DIR, file);
    if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res,404,"Not found","text/plain");
    const ext = path.extname(full);
    const types = {
      ".html":"text/html; charset=utf-8",
      ".js":"text/javascript; charset=utf-8",
      ".css":"text/css; charset=utf-8",
      ".json":"application/json; charset=utf-8",
      ".png":"image/png",
      ".svg":"image/svg+xml",
      ".webm":"video/webm"
    };
    // 9.11.0: Name der Oberfläche direkt in die Startseite schreiben (kein Aufblitzen des Standardnamens).
    if(file==="/index.html"){
      let html=fs.readFileSync(full,"utf8");
      try{
        const name=productName(),hp=installationKit.headerParts(name);
        html=html.replace("<title>Bot Control Center</title>",`<title>${escHtml(name)}</title>`)
          .replace('<strong id="brandStrong">Bot Control Center</strong><span id="brandRest"></span>',`<strong id="brandStrong">${escHtml(hp.strong)}</strong><span id="brandRest">${escHtml(hp.rest)}</span>`)
          .replace('<span id="brandFooter">Bot Control Center</span>',`<span id="brandFooter">${escHtml(name)}</span>`);
        // 9.20.4: hochgeladenes Browser-Symbol direkt in die Startseite schreiben (sonst bleibt das mitgelieferte Standardsymbol).
        const fav=installationProfile().images?.favicon;
        if(fav&&imageKit.FILE_RE.test(fav.file)&&/^image\/(png|jpeg|gif|webp|x-icon)$/.test(fav.mime)){
          const v=(/-([0-9a-f]{12})\./.exec(fav.file)||[])[1]||"u";
          html=html.replace('<link rel="icon" href="/favicon-default.svg" type="image/svg+xml">',`<link rel="icon" href="/branding/image/favicon?v=${v}" type="${fav.mime}">`);
        }
      }catch{}
      return send(res,200,html,"text/html; charset=utf-8",{"Cache-Control":"no-store"});
    }
    return send(res,200,fs.readFileSync(full),types[ext]||"application/octet-stream");
  } catch (e) {
    console.error(e);
    const status=Number(e?.status||0);
    if(status===400||status===413)return json(res,status,{error:e.message});
    // 8.9.22: getrennter Betrieb – der Twitch-Bot ist gerade nicht erreichbar (klare Meldung statt „Interner Serverfehler“).
    if(e?.unreachable===true)return json(res,503,{ok:false,error:e.message});
    return json(res,500,{error:"Interner Serverfehler."});
  }
});

stubenkontrolle.attachWebSocket(server);

for(const sig of ["SIGTERM","SIGINT"]){process.once(sig,()=>{twitchRuntime.stop();process.exit(0);});}

(async () => {
  console.log("======================================");
  try{console.log(` ${productName()}`);}catch(e){console.log(" Bot Control Center (Installationsprofil noch nicht lesbar: "+e.message+")");}
  console.log(` Twitch-Bot: eigener Dienst unter ${TWITCH_SERVICE_URL}`);
  console.log("======================================");
  try{ensureSetupCode();}catch{} // 9.11.0: Ersteinrichtung offen → Einrichtungscode ins Protokoll
  try {
    await stubenkontrolle.recoverOnStartup();
    await twitchRuntime.resolveIds();

    try {
      await getAppAccessToken();
    } catch (e) {
      console.error("⚠️ App Access Token konnte beim Start nicht erstellt werden:", e.message);
    }

    await twitchRuntime.start();
    startDiscordAnalyticsCollector();
    setInterval(()=>{try{followathon.tick();}catch(e){console.error("Followathon tick:",e.message);}try{if(moduleOn("subathon"))subathon.tick();}catch(e){console.error("Subathon tick:",e.message);}},1000);
  } catch (e) {
    console.error("⚠️ Bot Engine startet eingeschränkt:", e.message);
  }
  try{
    const sessionMigration=migrateAndPruneSessions();
    if(sessionMigration.migrated||sessionMigration.pruned)console.log(`🔐 Sessions: ${sessionMigration.migrated} auf Hash-Schlüssel umgestellt, ${sessionMigration.pruned} abgelaufene entfernt, ${sessionMigration.remaining} aktiv.`);
    setInterval(()=>{try{migrateAndPruneSessions();}catch(e){console.error("Session-Aufräumen:",e.message);}},60*60*1000).unref();
  }catch(e){console.error("⚠️ Session-Migration fehlgeschlagen:",e.message);}
  // 8.9.8: Profile auf das vollständige Format bringen (fehlende Bereiche = bisheriger Live-Wert,
  // neu angelegte Einträge im aktiven Profil wie live, in den übrigen aus).
  try{
    const data=readEventProfiles();
    if(data.profiles.some(p=>p.snapshot?.version!==2)){
      const live=liveProfileState();
      for(const p of data.profiles){
        p.snapshot=eventProfileCore.normalize(p.snapshot,live,{isActive:String(p.id)===String(data.activeProfileId||"")}).snapshot;
      }
      writeEventProfiles(data);
      audit("system","event-profile.migrated",{section:"eventProfiles",profiles:data.profiles.length});
      console.log(`✅ Event-Profile auf vollständiges Format umgestellt (${data.profiles.length}).`);
    }
  }catch(e){console.error("⚠️ Event-Profile-Umstellung fehlgeschlagen:",e.message);}
  // 9.12.0: Discord-Server und Rollen nach dem Start an den Discord-Dienst melden (bei Fehlschlag später erneut).
  {let tries=0;const push=()=>{tries++;pushDiscordInstallation().catch(e=>{if(tries<10)setTimeout(push,60000).unref();else console.warn("⚠️ Discord-Installationswerte konnten nicht gemeldet werden:",e?.message||e);});};setTimeout(push,8000).unref();}
  setTimeout(()=>updateService.tick().catch(()=>{}),15000).unref();
  setInterval(()=>updateService.tick().catch(()=>{}),30000).unref();
  server.listen(PORT, "0.0.0.0", () => { console.log(`🌐 Control Center auf Port ${PORT}`); console.log(`🔐 Secret-Quellen: ${describeSecretSources(SECRET_SOURCES)}`); });
})();
