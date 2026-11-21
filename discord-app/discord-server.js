#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createPgSyncStore, readLegacyJson, readLegacyJsonl } = require("/shared/pg-sync-store");
const { compile: compileWordFilter, match: matchWordFilter } = require("/shared/word-filter-engine");
const { applySecretFiles, describeSecretSources, DISCORD_SECRETS } = require("/shared/secret-env");
const installationKit = require("/shared/installation-profile");
const textPackKit = require("/shared/text-pack");
// Secrets bevorzugt aus Dateien (NAME_FILE, z. B. /run/secrets/…), sonst aus der Umgebung. Muss vor den Konstanten stehen.
const SECRET_SOURCES = applySecretFiles(DISCORD_SECRETS, { log: msg => console.warn(msg) });
const { createEngine: createLevelEngine, validateRanks: validateRanksForBackup } = require("./levelsystem");
const { DEFAULT_SPAM_PROTECT_CONFIG, normalizeSpamProtectConfig, SpamDetector, renderSpamWarning } = require("./spam-protect");
const { normalizeMaxAgeHours, checkTikTokLink, decideSocialItem } = require("./social-guard");

const API_BASE = "https://discord.com/api/v10";
const GATEWAY_FALLBACK = "wss://gateway.discord.gg/?v=10&encoding=json";
const SERVICE_PORT = Number(process.env.DISCORD_SERVICE_PORT || 3001);
const INTERNAL_SERVICE_SECRET = String(process.env.INTERNAL_SERVICE_SECRET || "");
// 8.9.19: Adresse der Weboberfläche im Docker-Netz und Anzeigename dieses Dienstes sind einstellbar
// (Standard = bisheriger Wert). Nötig, bevor Weboberfläche und Twitch-Bot eigene Container bekommen.
const {internalBaseUrl,serviceLabel} = require("/shared/internal-url");
const CONTROL_CENTER_URL = internalBaseUrl(process.env.CONTROL_CENTER_URL,"http://web:3000",{name:"CONTROL_CENTER_URL",warn:m=>console.warn("⚠️ "+m)});
const SERVICE_LABEL = serviceLabel(process.env.DISCORD_SERVICE_LABEL,"bcc-discord");
const JSON_BODY_LIMIT = 1024*1024;
const BACKUP_BODY_LIMIT = 25*1024*1024;
const DATA_DIR = process.env.DISCORD_DATA_DIR || "/data";
// 9.4.0: Modulschalter. Quelle ist die Weboberfläche; der letzte bekannte Stand liegt in /data/module-state.json.
// Fällt die Weboberfläche aus, gilt der letzte bekannte Stand – nie „alles aus“.
const {createModuleStateClient} = require("/shared/module-state-client");
const moduleState = createModuleStateClient({
  url: CONTROL_CENTER_URL, secret: INTERNAL_SERVICE_SECRET, file: require("path").join(DATA_DIR, "module-state.json"),
  log: console, onChange: () => { try { scheduleSocialPoll(); } catch {} }
});
// 9.12.0: Discord-Server und Rollen, die das Control Center (Profil & Branding) meldet. Umgebungsvariablen haben Vorrang.
const INSTALLATION_FILE = path.join(DATA_DIR, "installation-discord.json");
const ONBOARDING_CONFIG_FILE = path.join(DATA_DIR, "onboarding-config.json");
const ONBOARDING_STATE_FILE = path.join(DATA_DIR, "onboarding-state.json");
const ANNOUNCEMENTS_CONFIG_FILE = path.join(DATA_DIR, "announcements-config.json");
const ANNOUNCEMENTS_STATE_FILE = path.join(DATA_DIR, "announcements-state.json");
const MODERATION_CONFIG_FILE = path.join(DATA_DIR, "moderation-config.json");
const MODERATION_STATE_FILE = path.join(DATA_DIR, "moderation-state.json");
const MODERATION_LOG_FILE = path.join(DATA_DIR, "moderation-log.jsonl");
const REPORTS_CONFIG_FILE = path.join(DATA_DIR, "reports-config.json");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const REPORTS_STATE_FILE = path.join(DATA_DIR, "reports-state.json");
const REPORT_ATTACHMENTS_DIR = path.join(DATA_DIR, "report-attachments");
const SOCIAL_CONFIG_FILE = path.join(DATA_DIR, "social-config.json");
const SOCIAL_STATE_FILE = path.join(DATA_DIR, "social-state.json");
const SOCIAL_HISTORY_FILE = path.join(DATA_DIR, "social-history.json");
const SOCIAL_TOKEN_FILE = path.join(DATA_DIR, "social-token-state.json");
const SOCIAL_OAUTH_STATE_FILE = path.join(DATA_DIR, "social-oauth-state.json");
const CHANNEL_TIMES_CONFIG_FILE = path.join(DATA_DIR, "channel-times-config.json");
const CHANNEL_TIMES_STATE_FILE = path.join(DATA_DIR, "channel-times-state.json");
const DISCORD_LOG_CONFIG_FILE = path.join(DATA_DIR, "discord-log-config.json");
const EMERGENCY_CONFIG_FILE = path.join(DATA_DIR, "emergency-config.json");
const EMERGENCY_STATE_FILE = path.join(DATA_DIR, "emergency-state.json");
const INVITE_CONFIG_FILE = path.join(DATA_DIR, "discord-invite-config.json");
const {createDiscordInviteService}=require("/shared/discord-invite-service");

const pgStore = createPgSyncStore({namespace:"discord",service:"discord"});
const PG_DOCUMENT_FILES = new Map([
  [INSTALLATION_FILE,"installation-discord"],
  [ONBOARDING_CONFIG_FILE,"onboarding-config"],
  [ONBOARDING_STATE_FILE,"onboarding-state"],
  [ANNOUNCEMENTS_CONFIG_FILE,"announcements-config"],
  [ANNOUNCEMENTS_STATE_FILE,"announcements-state"],
  [MODERATION_CONFIG_FILE,"moderation-config"],
  [MODERATION_STATE_FILE,"moderation-state"],
  [REPORTS_CONFIG_FILE,"reports-config"],
  [REPORTS_FILE,"reports"],
  [REPORTS_STATE_FILE,"reports-state"],
  [SOCIAL_CONFIG_FILE,"social-config"],
  [SOCIAL_STATE_FILE,"social-state"],
  [SOCIAL_HISTORY_FILE,"social-history"],
  [CHANNEL_TIMES_CONFIG_FILE,"channel-times-config"],
  [CHANNEL_TIMES_STATE_FILE,"channel-times-state"],
  [DISCORD_LOG_CONFIG_FILE,"discord-log-config"],
  [EMERGENCY_CONFIG_FILE,"emergency-config"],
  [EMERGENCY_STATE_FILE,"emergency-state"],
  [INVITE_CONFIG_FILE,"discord-invite-config"]
]);
function pgDocKey(file){return PG_DOCUMENT_FILES.get(file)||null;}
function legacyFileSha256(file){
  try{return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");}catch{return null;}
}

const PERM = {
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  ADD_REACTIONS: 1n << 6n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MOVE_MEMBERS: 1n << 24n,
  MANAGE_ROLES: 1n << 28n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n
};

// Pflicht: Anwendung und Bot-Token (Umgebung/Secrets). Server-ID und Rollen kommen aus der Umgebung oder aus
// Profil & Branding (siehe discordConfigMissing); Kategorien und Kanäle sind optional und nur Vorbelegungen.
const REQUIRED = [
  "DISCORD_CLIENT_ID",
  "DISCORD_BOT_TOKEN"
];

// Interne Schlüssel (ab 9.18.0): moderator, administrator, member (Freischaltrolle). Alte Umgebungsvariablen (…_OVWA_ID, …_S1_ID, …_REKRUT_ID) bleiben lesbar.
const IDS = {
  guild: process.env.DISCORD_GUILD_ID,
  roles: {
    moderator: process.env.DISCORD_ROLE_MODERATOR_ID || process.env.DISCORD_ROLE_OVWA_ID,
    bot: process.env.DISCORD_ROLE_BOT_ID,
    administrator: process.env.DISCORD_ROLE_ADMINISTRATOR_ID || process.env.DISCORD_ROLE_S1_ID,
    member: process.env.DISCORD_ROLE_MEMBER_ID || process.env.DISCORD_ROLE_REKRUT_ID
  },
  categories: {
    informationen: process.env.DISCORD_CATEGORY_INFORMATIONEN_ID,
    community: process.env.DISCORD_CATEGORY_COMMUNITY_ID,
    socialMedia: process.env.DISCORD_CATEGORY_SOCIAL_MEDIA_ID,
    funkraum: process.env.DISCORD_CATEGORY_FUNKRAUM_ID,
    intern: process.env.DISCORD_CATEGORY_INTERN_ID
  },
  channels: {
    rules: process.env.DISCORD_CHANNEL_RULES_ID,
    welcome: process.env.DISCORD_CHANNEL_WELCOME_ID,
    talk: process.env.DISCORD_CHANNEL_TALK_ID,
    memes: process.env.DISCORD_CHANNEL_MEMES_ID,
    twitch: process.env.DISCORD_CHANNEL_TWITCH_ID,
    clips: process.env.DISCORD_CHANNEL_CLIPS_ID,
    instagram: process.env.DISCORD_CHANNEL_INSTAGRAM_ID,
    tiktok: process.env.DISCORD_CHANNEL_TIKTOK_ID,
    log: process.env.DISCORD_CHANNEL_LOG_ID,
    stabsraum: process.env.DISCORD_CHANNEL_STABSRAUM_ID,
    waitingRoom: process.env.DISCORD_CHANNEL_WAITING_ROOM_ID,
    bwTalk: process.env.DISCORD_CHANNEL_BWTALK_ID
  }
};

// 9.12.0: Server/Rollen aus Umgebung bzw. gespeichertem Profil – vor allen Vorbelegungen unten laden.
let installationDiscord = installationKit.normalizeDiscord({});
let installationTextPack = "neutral";
const discordTexts = () => textPackKit.get(installationTextPack).discord;
// 9.18.0: Rollenbezeichnungen aus dem Textpaket (neutral: Member/Moderator/Administrator; Bestandsinstallation: eigene Bezeichnungen aus dem Textpaket).
// 9.18.0: Rollen-Flags (member/administrator) lesen auch die alten gespeicherten Schlüssel (rekrut/s1).
const roleFlag = (r, key, old) => (r && typeof r === "object" ? (r[key] !== undefined ? r[key] : r[old]) : undefined);
const RL = k => textPackKit.get(installationTextPack).roleLabelsServer?.[k] || textPackKit.NEUTRAL.roleLabelsServer[k];
const RT = k => textPackKit.get(installationTextPack).roleTitles?.[k] || textPackKit.NEUTRAL.roleTitles[k];
const roleBoth = k => (RT(k) === RL(k) ? RT(k) : `${RT(k)} (${RL(k)})`);
loadDiscordInstallation();

const DEFAULT_ANNOUNCEMENTS_CONFIG = {
  liveEnabled:false,
  clipsEnabled:false,
  liveChannelId:IDS.channels.twitch,
  clipsChannelId:IDS.channels.clips,
  liveText:"🔴 **{broadcaster} ist jetzt LIVE auf Twitch!**\\n{title}\\n{url}",
  clipText:"🎬 **Neuer Twitch-Clip:** {title}\\n{url}",
  mentionRoleId:null,
  useEmbeds:true
};
const DEFAULT_ANNOUNCEMENTS_STATE = {
  liveStreams:{},
  clips:{},
  lastLiveAt:null,
  lastClipAt:null,
  lastError:null
};

const REPORT_REASONS = [
  {value:"beleidigung",label:"Beleidigung"},
  {value:"spam",label:"Spam"},
  {value:"diskriminierung",label:"Diskriminierender Inhalt"},
  {value:"unangemessen",label:"Unangemessener Inhalt / Verhalten"},
  {value:"sonstiges",label:"Sonstiges"}
];
const REPORT_REASON_LABELS = Object.fromEntries(REPORT_REASONS.map(x=>[x.value,x.label]));
const DEFAULT_REPORTS_CONFIG = {
  enabled:true,
  logChannelId:IDS.channels.log,
  buttonChannelId:IDS.channels.welcome,
  buttonMessageId:null,
  buttonMessageChannelId:null,
  buttonText:"Du möchtest einen Inhalt oder ein Verhalten melden? Nutze den Button. Deine Meldung wird ausschließlich intern bearbeitet.",
  buttonLabel:"Meldung erstellen",
  cooldownMinutes:2,
  archiveAttachments:true,
  logNewTicket:true,
  logStatusChanges:true,
  logSanctions:true,
  logContentDeletion:true
};
const DEFAULT_REPORTS_STATE = {
  sequenceByYear:{},
  cooldowns:{},
  lastCreatedAt:null,
  lastError:null,
  commandsRegisteredAt:null
};

const DEFAULT_SOCIAL_CONFIG = {
  enabled:true,
  pollMinutes:10,
  instagram:{
    enabled:true,
    channelId:IDS.channels.instagram,
    text:"📸 **Neu auf Instagram**\n{caption}\n\n{url}",
    useEmbed:true,
    includeThumbnail:true,
    checkLink:false,
    maxAgeHours:0
  },
  tiktok:{
    enabled:true,
    channelId:IDS.channels.tiktok,
    text:"🎵 **Neu auf TikTok**\n{caption}\n\n{url}",
    useEmbed:true,
    includeThumbnail:true,
    checkLink:true,
    maxAgeHours:48
  }
};
const DEFAULT_SOCIAL_STATE = {
  initialized:{instagram:false,tiktok:false},
  seen:{instagram:{},tiktok:{}},
  lastPollAt:null,
  nextPollAt:null,
  platforms:{
    instagram:{lastCheckAt:null,lastSuccessAt:null,lastDetectedAt:null,lastDiscordAt:null,lastError:null,profile:null},
    tiktok:{lastCheckAt:null,lastSuccessAt:null,lastDetectedAt:null,lastDiscordAt:null,lastError:null,profile:null}
  }
};
const DEFAULT_SOCIAL_TOKEN_STATE = {
  instagram:{
    managed:false,accessToken:null,installedAt:null,issuedAt:null,expiresAt:null,
    lastSuccessfulRefreshAt:null,nextRefreshAt:null,lastRefreshAttemptAt:null,
    lastError:null,lastErrorAt:null,retryCount:0,reauthorizationRequired:false,
    username:null,userId:null,updatedAt:null
  },
  tiktok:{
    managed:false,accessToken:null,refreshToken:null,expiresAt:null,refreshExpiresAt:null,
    openId:null,grantedScopes:[],connectedAt:null,updatedAt:null,disconnectedAt:null
  }
};

function normalizeAnnouncementText(value,fallback=""){
  return String(value ?? fallback).replace(/\\n/g,"\n").trim();
}




const DEFAULT_DISCORD_LOG_CONFIG = {
  enabled:true,
  defaultChannelId:IDS.channels.log,
  events:{
    "moderation.violation":{
      category:"moderation",label:"Verstoß erkannt",enabled:true,channelId:null,
      template:"🛡️ **Moderation** · {mention} · {channelMention}\nRegel: **{rule}**{matchedPart}\nAktion: {actions}",
      variables:["mention","user","userId","channel","channelMention","rule","matched","matchedPart","actions","source","timestamp"]
    },
    "moderation.timeout":{
      category:"moderation",label:"Timeout ausgesprochen",enabled:true,channelId:null,
      template:"⏱️ **Timeout ausgesprochen** · {mention} · {channelMention}\nRegel: **{rule}**{matchedPart}\nAktion: {actions}",
      variables:["mention","user","userId","channel","channelMention","rule","matched","matchedPart","actions","timeoutStage","timestamp"]
    },
    "moderation.ban":{
      category:"moderation",label:"Ban ausgesprochen",enabled:true,channelId:null,
      template:"⛔ **User gebannt** · {mention} · {channelMention}\nRegel: **{rule}**{matchedPart}\nAktion: {actions}",
      variables:["mention","user","userId","channel","channelMention","rule","matched","matchedPart","actions","reason","timestamp"]
    },
    "moderation.unban":{
      category:"moderation",label:"Ban aufgehoben",enabled:true,channelId:null,
      template:"✅ **Ban aufgehoben**\nUser: {mention}\nUser-ID: `{userId}`\nAusgeführt durch: **{actor}**\nZeitpunkt: {timestamp}",
      variables:["mention","user","userId","actor","timestamp"]
    },
    "moderation.untimeout":{
      category:"moderation",label:"Timeout aufgehoben",enabled:true,channelId:null,
      template:"✅ **Timeout aufgehoben**\nUser: {mention}\nUser-ID: `{userId}`\nAusgeführt durch: **{actor}**\nEskalation zurückgesetzt: **{resetEscalation}**\nZeitpunkt: {timestamp}",
      variables:["mention","user","userId","actor","resetEscalation","timestamp"]
    },
    "moderation.native":{
      category:"moderation",label:"Discord AutoMod",enabled:true,channelId:null,
      template:"🛡️ **Discord AutoMod** · {mention} · {channelMention}\nRegel: **{rule}**{matchedPart}\nAktion: {actions}",
      variables:["mention","user","userId","channel","channelMention","rule","matched","matchedPart","actions","timestamp"]
    },

    "onboarding.role_changed":{
      category:"onboarding",label:"Rolle manuell geändert",enabled:true,channelId:null,
      template:"👤 Rollenverwaltung: {user} (`{userId}`) → **{role}** {action}.",
      variables:["user","userId","role","action","actor","timestamp"]
    },
    "onboarding.access_applied":{
      category:"onboarding",label:"Zugriffsvorlage angewendet",enabled:true,channelId:null,
      template:"🔐 Discord-Zugriffsvorlage angewendet. {count} Overwrite(s) aktualisiert.",
      variables:["count","actor","timestamp"]
    },
    "onboarding.rules_published":{
      category:"onboarding",label:"Regelnachricht veröffentlicht",enabled:true,channelId:null,
      template:"ℹ️ Zentrale Regelnachricht veröffentlicht (Nachricht `{messageId}`).",
      variables:["messageId","channelMention","actor","timestamp"]
    },
    "onboarding.rules_updated":{
      category:"onboarding",label:"Regelnachricht aktualisiert",enabled:true,channelId:null,
      template:"ℹ️ Zentrale Regelnachricht aktualisiert (Nachricht `{messageId}`).",
      variables:["messageId","channelMention","actor","timestamp"]
    },
    "onboarding.premature_role_removed":{
      category:"onboarding",label:"Vorzeitige Freischaltung verhindert",enabled:true,channelId:null,
      template:"🛡️ Zugangssperre geschützt: Vorzeitige Freischaltrolle bei {user} (`{userId}`) entfernt. Bestätigung per 👍 steht noch aus.",
      variables:["user","userId","timestamp"]
    },
    "onboarding.verified":{
      category:"onboarding",get label(){return `Regeln akzeptiert / ${RT("member")} vergeben`;},enabled:true,channelId:null,
      template:"✅ Freischaltung: {user} (`{userId}`) bestätigte die Regeln mit 👍 und erhielt {roleMention}. Zeitpunkt: {timestamp}",
      variables:["user","userId","role","roleMention","timestamp"]
    },
    "onboarding.failed":{
      category:"onboarding",label:"Freischaltung fehlgeschlagen",enabled:true,channelId:null,
      template:"❌ Freischaltung fehlgeschlagen für `{userId}`: {error}",
      variables:["userId","error","timestamp"]
    },
    "onboarding.repair":{
      category:"onboarding",label:"Freischaltungs-Reparatur",enabled:true,channelId:null,
      template:"🔧 Freischaltungs-Reparatur: {count} gültige Regelbestätigung(en) repariert{detail}.",
      variables:["count","detail","timestamp"]
    },
    "onboarding.enabled":{
      category:"onboarding",label:"Freischaltung aktiviert",enabled:true,channelId:null,
      template:"✅ Regelbasierte Freischaltung aktiviert. Regelkanal {channelMention}, Rolle {roleMention}.",
      variables:["channel","channelMention","role","roleMention","timestamp"]
    },
    "onboarding.disabled":{
      category:"onboarding",label:"Freischaltung deaktiviert",enabled:true,channelId:null,
      template:"ℹ️ Regelbasierte Freischaltung deaktiviert.",
      variables:["timestamp"]
    },

    "reports.new":{
      category:"reports",label:"Neues Ticket",enabled:true,channelId:null,
      template:"🚨 **Neue Meldung · {ticketId}**\nGrund: **{reason}**\nGemeldet: {targetMention}{channelLine}\nBearbeitung im Control Center.",
      variables:["ticketId","reason","targetMention","targetUserId","channel","channelMention","channelLine","reporter","timestamp"]
    },
    "reports.status":{
      category:"reports",label:"Ticket geschlossen / abgewiesen",enabled:true,channelId:null,
      template:"📁 **{ticketId} · {status}**\n{detail}",
      variables:["ticketId","status","detail","actor","timestamp"]
    },
    "reports.sanction":{
      category:"reports",label:"Sanktion aus Ticket",enabled:true,channelId:null,
      template:"⚖️ **{ticketId} · Maßnahme**\n{detail}",
      variables:["ticketId","detail","targetMention","actor","timestamp"]
    },
    "reports.delete":{
      category:"reports",label:"Gemeldeten Inhalt gelöscht",enabled:true,channelId:null,
      template:"🗑️ **{ticketId} · Inhalt gelöscht**\n{detail}",
      variables:["ticketId","detail","actor","timestamp"]
    },

    "channel-times.closed":{
      category:"channel-times",label:"Kanal geschlossen",enabled:true,channelId:null,
      template:"🌙 Kanalzeit: {channelMention} geschlossen ({roles}). Quelle: {source}.",
      variables:["channel","channelMention","roles","source","timestamp"]
    },
    "channel-times.opened":{
      category:"channel-times",label:"Kanal geöffnet",enabled:true,channelId:null,
      template:"☀️ Kanalzeit: {channelMention} wieder geöffnet. Quelle: {source}.",
      variables:["channel","channelMention","source","timestamp"]
    },
    "channel-times.error":{
      category:"channel-times",label:"Fehler bei Kanalzeiten",enabled:true,channelId:null,
      template:"⚠️ Kanal-Zeitsteuerung: {error}",
      variables:["error","source","timestamp"]
    },

    "emergency.activated":{
      category:"emergency",label:"Notfallmodus aktiviert",enabled:true,channelId:null,
      template:"🚨 **Notfallmodus aktiviert**\nStufe: **{levelLabel}**\nGrund: {reason}\nAktiviert durch: **{actor}**\nDauer: {duration}\nZeitpunkt: {timestamp}",
      variables:["level","levelLabel","reason","actor","duration","timestamp"]
    },
    "emergency.level_changed":{
      category:"emergency",label:"Notfallstufe geändert",enabled:true,channelId:null,
      template:"⚠️ **Notfallstufe geändert**\nNeue Stufe: **{levelLabel}**\nGrund: {reason}\nGeändert durch: **{actor}**\nZeitpunkt: {timestamp}",
      variables:["level","levelLabel","reason","actor","timestamp"]
    },
    "emergency.deactivated":{
      category:"emergency",label:"Notfallmodus beendet",enabled:true,channelId:null,
      template:"✅ **Notfallmodus beendet**\nBeendet durch: **{actor}**\nGrund: {reason}\nRechte wiederhergestellt: {restored}\nZeitpunkt: {timestamp}",
      variables:["actor","reason","restored","timestamp"]
    },
    "emergency.error":{
      category:"emergency",label:"Fehler im Notfallmodus",enabled:true,channelId:null,
      template:"❌ **Notfallmodus-Fehler**\n{error}\nQuelle: {source}\nZeitpunkt: {timestamp}",
      variables:["error","source","timestamp"]
    },

    "system.bot_ready":{
      category:"system",label:"Discord-Bot verbunden",enabled:false,channelId:null,
      template:"🟢 Discord-Bot verbunden und bereit. Zeitpunkt: {timestamp}",
      variables:["timestamp"]
    },
    "system.update_available":{
      category:"system",label:"Update verfügbar",enabled:true,channelId:null,
      template:"📦 **Update {version} verfügbar** (aktuell {currentVersion}). Freigabe im Control Center unter „Updates“.\n{summary}",
      variables:["version","currentVersion","summary","timestamp"]
    },
    "system.update_started":{
      category:"system",label:"Update gestartet",enabled:true,channelId:null,
      template:"🔧 **Update auf {version} freigegeben** durch {actor}. Der Server wechselt in den Wartungsmodus, die Installation folgt in wenigen Minuten.",
      variables:["version","actor","timestamp"]
    },
    "system.update_finished":{
      category:"system",label:"Update abgeschlossen",enabled:true,channelId:null,
      template:"✅ **Update auf {version} abgeschlossen.** Der Wartungsmodus wurde beendet.",
      variables:["version","timestamp"]
    },
    "system.update_failed":{
      category:"system",label:"Update fehlgeschlagen",enabled:true,channelId:null,
      template:"⚠️ **Update auf {version} nicht installiert** ({status}). {message}",
      variables:["version","status","message","timestamp"]
    },
    "system.update_attention":{
      category:"system",label:"Update braucht Eingriff",enabled:true,channelId:null,
      template:"🚨 **Update auf {version} braucht manuellen Eingriff** ({status}). Der Wartungsmodus bleibt aktiv. {message}",
      variables:["version","status","message","timestamp"]
    },
    "system.update_tools_fallback":{
      category:"system",label:"Update-Werkzeug zurückgesetzt",enabled:true,channelId:null,
      template:"⚠️ **Werkzeug-Update {version} fehlgeschlagen.** Das bisherige Update-Werkzeug {currentVersion} läuft weiter, Updates des Control Centers bleiben möglich. {message}",
      variables:["version","currentVersion","message","timestamp"]
    }
  }
};
const DISCORD_LOG_CATEGORIES = [
  {id:"moderation",label:"Moderation"},
  {id:"onboarding",label:"Freischaltung & Server"},
  {id:"reports",label:"Meldesystem"},
  {id:"channel-times",label:"Kanalzeiten"},
  {id:"emergency",label:"Notfallmodus"},
  {id:"system",label:"System"}
];
function normalizeDiscordLogConfig(raw={}){
  const out={enabled:raw.enabled!==false,defaultChannelId:cleanId(raw.defaultChannelId,IDS.channels.log),events:{}};
  for(const [key,def] of Object.entries(DEFAULT_DISCORD_LOG_CONFIG.events)){
    const src=raw.events?.[key]||{};
    out.events[key]={
      category:def.category,label:def.label,
      enabled:src.enabled!==undefined?src.enabled!==false:def.enabled,
      channelId:src.channelId?cleanId(src.channelId,null):null,
      template:String(src.template??def.template).slice(0,1900),
      variables:def.variables
    };
  }
  return out;
}
function renderDiscordLogTemplate(template,data={}){
  return String(template||"").replace(/\{([A-Za-z0-9_]+)\}/g,(m,key)=>data[key]===undefined||data[key]===null?"":String(data[key])).slice(0,1950);
}


const DEFAULT_EMERGENCY_CONFIG = {
  noticeChannelId:IDS.channels.talk,
  announceActivation:true,
  announceDeactivation:true,
  activationMessage:"🚨 **Notfallmodus aktiv**\nStufe: **{levelLabel}**\nGrund: {reason}\nDie Schreib- und/oder Sprachrechte sind vorübergehend eingeschränkt. Informationen folgen über das Moderationsteam.",
  deactivationMessage:"✅ **Notfallmodus beendet**\nDie zuvor gesicherten Kanalrechte wurden wiederhergestellt.",
  levels:{
    "1":{
      label:"Stufe 1 · Eingeschränkt",
      textChannelIds:[IDS.channels.talk,IDS.channels.memes].filter(Boolean),
      voiceChannelIds:[],
      denyReactions:false
    },
    "2":{
      label:"Stufe 2 · Lockdown",
      textChannelIds:[IDS.channels.talk,IDS.channels.memes].filter(Boolean),
      voiceChannelIds:[IDS.channels.waitingRoom,IDS.channels.bwTalk].filter(Boolean),
      denyReactions:false
    },
    "3":{
      label:"Stufe 3 · Vollschutz",
      textChannelIds:[IDS.channels.talk,IDS.channels.memes,IDS.channels.twitch,IDS.channels.clips,IDS.channels.instagram,IDS.channels.tiktok].filter(Boolean),
      voiceChannelIds:[IDS.channels.waitingRoom,IDS.channels.bwTalk].filter(Boolean),
      denyReactions:true
    }
  }
};
const DEFAULT_EMERGENCY_STATE = {
  active:false,
  level:null,
  reason:null,
  actor:null,
  startedAt:null,
  endsAt:null,
  snapshots:{},
  affected:{text:[],voice:[]},
  lastError:null,
  history:[]
};
function normalizeEmergencyConfig(raw={}){
  const levels={};
  for(const key of["1","2","3"]){
    const def=DEFAULT_EMERGENCY_CONFIG.levels[key],src=raw.levels?.[key]||{};
    levels[key]={
      label:String(src.label||def.label).slice(0,120),
      textChannelIds:[...new Set((Array.isArray(src.textChannelIds)?src.textChannelIds:def.textChannelIds).map(String).filter(Boolean))].slice(0,100),
      voiceChannelIds:[...new Set((Array.isArray(src.voiceChannelIds)?src.voiceChannelIds:def.voiceChannelIds).map(String).filter(Boolean))].slice(0,100),
      denyReactions:src.denyReactions!==undefined?src.denyReactions===true:def.denyReactions
    };
  }
  return {
    noticeChannelId:cleanId(raw.noticeChannelId,DEFAULT_EMERGENCY_CONFIG.noticeChannelId),
    announceActivation:raw.announceActivation!==false,
    announceDeactivation:raw.announceDeactivation!==false,
    activationMessage:String(raw.activationMessage||DEFAULT_EMERGENCY_CONFIG.activationMessage).slice(0,1800),
    deactivationMessage:String(raw.deactivationMessage||DEFAULT_EMERGENCY_CONFIG.deactivationMessage).slice(0,1800),
    levels
  };
}
let emergencyStateRevision=0;
function normalizeEmergencyState(raw={}){
  return {
    active:raw.active===true,level:["1","2","3"].includes(String(raw.level))?String(raw.level):null,
    reason:raw.reason||null,actor:raw.actor||null,startedAt:raw.startedAt||null,endsAt:raw.endsAt||null,
    snapshots:raw.snapshots&&typeof raw.snapshots==="object"?raw.snapshots:{},
    affected:raw.affected&&typeof raw.affected==="object"?raw.affected:{text:[],voice:[]},
    lastError:raw.lastError||null,
    history:Array.isArray(raw.history)?raw.history.slice(-500):[]
  };
}
function loadEmergencyState(){
  if(pgStore.enabled){
    let legacy=DEFAULT_EMERGENCY_STATE;
    try{legacy=pgStore.hasDocument("emergency-state")?pgStore.getDocument("emergency-state",DEFAULT_EMERGENCY_STATE):readLegacyJson(EMERGENCY_STATE_FILE,DEFAULT_EMERGENCY_STATE);}catch{}
    const normalized=normalizeEmergencyState(legacy);
    const imported=pgStore.importDiscordEmergencyStateIfEmpty(normalized);
    if(imported?.inserted){try{pgStore.markImport("emergency-state-relational",legacyFileSha256(EMERGENCY_STATE_FILE),{kind:"relational-state",source:pgStore.hasDocument("emergency-state")?"postgres-jsonb":"emergency-state.json"});}catch{}}
    const result=pgStore.getDiscordEmergencyState();emergencyStateRevision=Number(result?.revision||0);return normalizeEmergencyState(result?.state||normalized);
  }
  return normalizeEmergencyState(readJsonFile(EMERGENCY_STATE_FILE,DEFAULT_EMERGENCY_STATE));
}

const DEFAULT_CHANNEL_TIMES_CONFIG = {
  enabled:false,
  timezone:"Europe/Berlin",
  logEnabled:true,
  logChannelId:IDS.channels.log,
  profiles:[
    {
      id:"talk",channelId:IDS.channels.talk,enabled:true,closeTime:"22:00",openTime:"06:00",
      roles:{member:true,administrator:false},lockThreads:true,
      announceWarning:true,warningMinutes:30,warningMessage:"⏰ Hinweis: In {warningMinutes} Minuten beginnt die Nachtruhe. Sie gilt von {closeTime} bis {openTime} Uhr. Bitte schließt eure Gespräche rechtzeitig ab.",
      announceClose:true,closeMessage:"🌙 Nachtruhe! Dieser Kanal ist bis {openTime} Uhr für neue Nachrichten geschlossen. Lesen und Reagieren bleibt möglich. Morgen geht's weiter.",
      announceOpen:true,openMessage:"☀️ Guten Morgen! Die Nachtruhe ist beendet – dieser Kanal ist wieder geöffnet." 
    },
    {
      id:"memes",channelId:IDS.channels.memes,enabled:true,closeTime:"22:00",openTime:"06:00",
      roles:{member:true,administrator:false},lockThreads:true,
      announceWarning:true,warningMinutes:30,warningMessage:"⏰ Hinweis: In {warningMinutes} Minuten beginnt die Nachtruhe. Sie gilt von {closeTime} bis {openTime} Uhr. Bitte schließt eure Gespräche rechtzeitig ab.",
      announceClose:true,closeMessage:"🌙 Nachtruhe! Dieser Kanal ist bis {openTime} Uhr für neue Nachrichten geschlossen. Lesen und Reagieren bleibt möglich. Morgen geht's weiter.",
      announceOpen:true,openMessage:"☀️ Guten Morgen! Die Nachtruhe ist beendet – dieser Kanal ist wieder geöffnet." 
    }
  ]
};
const DEFAULT_MAINTENANCE = {
  active:false,
  scope:"profiles",
  channelIds:[],
  roles:{member:true,administrator:false},
  lockMessage:discordTexts().lockMessage,
  unlockMessage:discordTexts().unlockMessage
};
const DEFAULT_CHANNEL_TIMES_STATE = {
  active:{},
  overrides:{},
  lastRunAt:null,
  lastError:null,
  warningNotices:{},
  maintenance:{...DEFAULT_MAINTENANCE,activatedAt:null,snapshots:{},lastError:null},
  events:[]
};

const DEFAULT_MODERATION_CONFIG = {
  enabled:false,
  logEnabled:true,
  logChannelId:IDS.channels.log,
  warningText:"🛡️ {mention}, dieser Inhalt ist auf unserem Server nicht zulässig und wurde entfernt. Bitte beachte unsere Serverregeln.",
  enforcement:{
    deleteMessage:true,
    warnUser:true,
    repeatThreshold:3,
    repeatWindowMinutes:60,
    timeoutMinutes:10
  },
  escalation:{
    enabled:true,
    banAtTimeoutStage:4,
    timeout1:"🟡 {mention}, aufgrund wiederholter Regelverstöße erhältst du deinen 1. Timeout. Bitte nutze die Zeit und beachte anschließend unsere Serverregeln.",
    timeout2:"🟠 {mention}, das ist bereits dein 2. Timeout. Die bisherigen Hinweise waren offensichtlich nicht ausreichend. Bitte halte dich künftig an unsere Serverregeln.",
    timeout3:"🔴 {mention}, dies ist dein 3. und letzter Timeout. Bei einer erneuten Eskalation erfolgt der Ausschluss vom Server.",
    banReason:"Automatischer Ban nach drei vorherigen Timeouts und erneuter Eskalation"
  },
  moderationLog:{
    violations:true,
    timeouts:true,
    bans:true,
    nativeAutoMod:true
  },
  spamProtect: DEFAULT_SPAM_PROTECT_CONFIG,
  linkPolicy:{
    enabled:true,
    warningText:"🔗 {mention}, dieser Link ist auf unserem Server nicht freigegeben und wurde entfernt. Bitte nutze ausschließlich zugelassene Links.",
    allowedDomains:[...textPackKit.get(installationTextPack).linkDomains],
    allowedLinks:[...textPackKit.get(installationTextPack).linkLinks]
  },
  rules:[]
};
function normalizeStringList(value,limit=200){
  const source=Array.isArray(value)?value:String(value||"").split(/\r?\n|,/);
  return [...new Set(source.map(x=>String(x||"").trim()).filter(Boolean))].slice(0,limit);
}
function normalizeModerationRule(raw={}){
  const id=String(raw.id||`mod_${Date.now()}_${Math.random().toString(36).slice(2,8)}`).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80);
  return {
    id:id||`mod_${Date.now()}`,name:String(raw.name||"Neue Regel").trim().slice(0,120)||"Neue Regel",
    enabled:raw.enabled!==false,matchMode:["substring","fullword"].includes(String(raw.matchMode))?String(raw.matchMode):"substring",
    terms:normalizeStringList(raw.terms,500),allowedTerms:normalizeStringList(raw.allowedTerms,500),
    exemptRoleIds:normalizeStringList(raw.exemptRoleIds,100).map(x=>cleanId(x,null)).filter(Boolean),
    exemptChannelIds:normalizeStringList(raw.exemptChannelIds,100).map(x=>cleanId(x,null)).filter(Boolean),
    deleteMessage:raw.deleteMessage!==false,warnUser:raw.warnUser===true,
    repeatThreshold:Math.max(0,Math.min(20,Number(raw.repeatThreshold||0))),
    repeatWindowMinutes:Math.max(1,Math.min(1440,Number(raw.repeatWindowMinutes||10))),
    timeoutMinutes:Math.max(0,Math.min(40320,Number(raw.timeoutMinutes||0)))
  };
}

function stripWww(host){return String(host||"").toLowerCase().replace(/^www\./,"");}
function normalizeAllowedDomain(value){
  let raw=String(value||"").trim().toLowerCase();
  if(!raw)return null;
  raw=raw.replace(/\*+$/,"").trim();
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw))raw=`https://${raw}`;
  try{return stripWww(new URL(raw).hostname);}catch{return null;}
}
function normalizeAllowedLink(value){
  let raw=String(value||"").trim();
  if(!raw)return null;
  raw=raw.replace(/\*+$/,"").trim();
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw))raw=`https://${raw}`;
  try{
    const u=new URL(raw),host=stripWww(u.hostname);
    const path=(u.pathname||"/").replace(/\/+$/,"")||"/";
    return `${host}${path}`;
  }catch{return null;}
}
function normalizeEnforcement(raw={},legacyRule=null,legacyLink=null){
  const defaults=DEFAULT_MODERATION_CONFIG.enforcement;
  const source=raw&&typeof raw==="object"?raw:{};
  return {
    deleteMessage:source.deleteMessage!==undefined?source.deleteMessage!==false:(legacyLink?.deleteMessage!==undefined?legacyLink.deleteMessage!==false:(legacyRule?.deleteMessage!==undefined?legacyRule.deleteMessage!==false:defaults.deleteMessage)),
    warnUser:source.warnUser!==undefined?source.warnUser===true:(legacyLink?.warnUser!==undefined?legacyLink.warnUser===true:(legacyRule?.warnUser!==undefined?legacyRule.warnUser===true:defaults.warnUser)),
    repeatThreshold:Math.max(0,Math.min(20,Number(source.repeatThreshold??legacyRule?.repeatThreshold??defaults.repeatThreshold))),
    repeatWindowMinutes:Math.max(1,Math.min(1440,Number(source.repeatWindowMinutes??legacyRule?.repeatWindowMinutes??defaults.repeatWindowMinutes))),
    timeoutMinutes:Math.max(0,Math.min(40320,Number(source.timeoutMinutes??legacyRule?.timeoutMinutes??defaults.timeoutMinutes)))
  };
}
function normalizeEscalation(raw={}){
  const defaults=DEFAULT_MODERATION_CONFIG.escalation;
  return {
    enabled:raw.enabled!==false,
    banAtTimeoutStage:4,
    timeout1:String(raw.timeout1||raw.warning1||defaults.timeout1).slice(0,1200),
    timeout2:String(raw.timeout2||raw.warning2||defaults.timeout2).slice(0,1200),
    timeout3:String(raw.timeout3||raw.warning3||defaults.timeout3).slice(0,1200),
    banReason:String(raw.banReason||defaults.banReason).slice(0,480)
  };
}
function normalizeModerationLog(raw={}){
  const defaults=DEFAULT_MODERATION_CONFIG.moderationLog;
  return {
    violations:raw.violations!==undefined?raw.violations!==false:defaults.violations,
    timeouts:raw.timeouts!==undefined?raw.timeouts!==false:defaults.timeouts,
    bans:raw.bans!==undefined?raw.bans!==false:defaults.bans,
    nativeAutoMod:raw.nativeAutoMod!==undefined?raw.nativeAutoMod!==false:defaults.nativeAutoMod
  };
}
function normalizeLinkPolicy(raw={}){
  const defaults=DEFAULT_MODERATION_CONFIG.linkPolicy;
  return {
    enabled:raw.enabled!==false,
    warningText:String(raw.warningText||defaults.warningText).slice(0,1200),
    allowedDomains:[...new Set(normalizeStringList(raw.allowedDomains||defaults.allowedDomains,500).map(normalizeAllowedDomain).filter(Boolean))],
    allowedLinks:[...new Set(normalizeStringList(raw.allowedLinks||defaults.allowedLinks,500).map(normalizeAllowedLink).filter(Boolean))]
  };
}
function extractLinksFromMessage(content){
  const text=String(content||""),found=[];
  const re=/(?:https?:\/\/|www\.)[^\s<>()]+|(?:\b[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+)(?:\/[^\s<>()]*)?/giu;
  for(const match of text.matchAll(re)){
    let raw=String(match[0]||"").replace(/[),.;!?]+$/g,"");
    if(!raw)continue;
    if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw))raw=`https://${raw}`;
    try{
      const u=new URL(raw),host=stripWww(u.hostname),path=(u.pathname||"/").replace(/\/+$/,"")||"/";
      found.push({raw:match[0],host,path,normalized:`${host}${path}`});
    }catch{}
  }
  return found;
}
function isWhitelistedLink(link,policy){
  const host=stripWww(link.host);
  if((policy.allowedDomains||[]).some(domain=>host===domain||host.endsWith(`.${domain}`)))return true;
  return (policy.allowedLinks||[]).includes(link.normalized);
}
function disallowedLinks(content,policy){
  if(!policy?.enabled)return[];
  return extractLinksFromMessage(content).filter(link=>!isWhitelistedLink(link,policy));
}

function loadModerationConfig(){
  const raw=readJsonFile(MODERATION_CONFIG_FILE,DEFAULT_MODERATION_CONFIG);
  const legacyRule=Array.isArray(raw.rules)&&raw.rules.length?raw.rules[0]:null;
  return {
    enabled:raw.enabled===true,
    logEnabled:raw.logEnabled!==false,
    logChannelId:cleanId(raw.logChannelId,IDS.channels.log),
    warningText:String(raw.warningText||DEFAULT_MODERATION_CONFIG.warningText).slice(0,1200),
    enforcement:normalizeEnforcement(raw.enforcement||{},legacyRule,raw.linkPolicy||null),
    escalation:normalizeEscalation(raw.escalation||{}),
    moderationLog:normalizeModerationLog(raw.moderationLog||{}),
    spamProtect:normalizeSpamProtectConfig(raw.spamProtect||{}),
    linkPolicy:normalizeLinkPolicy(raw.linkPolicy||{}),
    rules:Array.isArray(raw.rules)?raw.rules.map(normalizeModerationRule).slice(0,100):[]
  };
}
const spamDetector = new SpamDetector();
let moderationStateRevision=0;
function loadModerationState(){
  if(pgStore.enabled){
    const fallback={recent:{},users:{},lastActionAt:null,lastError:null};
    let legacy=fallback;
    try{legacy=pgStore.hasDocument("moderation-state")?pgStore.getDocument("moderation-state",fallback):readLegacyJson(MODERATION_STATE_FILE,fallback);}catch{}
    const imported=pgStore.importDiscordModerationStateIfEmpty(legacy);
    if(imported?.inserted){
      try{pgStore.markImport("moderation-state-relational",legacyFileSha256(MODERATION_STATE_FILE),{kind:"relational-state",source:pgStore.hasDocument("moderation-state")?"postgres-jsonb":"moderation-state.json"});}catch{}
    }
    const result=pgStore.getDiscordModerationState();
    moderationStateRevision=Number(result?.revision||0);
    const raw=result?.state||fallback;
    const users=raw.users&&typeof raw.users==="object"?raw.users:{};
    for(const user of Object.values(users)){
      if(user.timeoutStage===undefined){
        const oldStrikes=Math.max(0,Number(user.strikes||0));
        user.timeoutStage=Math.min(3,Math.floor(oldStrikes/Math.max(1,Number(DEFAULT_MODERATION_CONFIG.enforcement.repeatThreshold||3))));
      }
      user.timeoutCount=Math.max(Number(user.timeoutCount||0),Number(user.timeoutStage||0));
    }
    return {recent:raw.recent&&typeof raw.recent==="object"?raw.recent:{},users,lastActionAt:raw.lastActionAt||null,lastError:raw.lastError||null};
  }
  const raw=readJsonFile(MODERATION_STATE_FILE,{recent:{},users:{},lastActionAt:null,lastError:null});
  const users=raw.users&&typeof raw.users==="object"?raw.users:{};
  for(const user of Object.values(users)){
    if(user.timeoutStage===undefined){
      const oldStrikes=Math.max(0,Number(user.strikes||0));
      user.timeoutStage=Math.min(3,Math.floor(oldStrikes/Math.max(1,Number(DEFAULT_MODERATION_CONFIG.enforcement.repeatThreshold||3))));
    }
    user.timeoutCount=Math.max(Number(user.timeoutCount||0),Number(user.timeoutStage||0));
  }
  return {
    recent:raw.recent&&typeof raw.recent==="object"?raw.recent:{},
    users,
    lastActionAt:raw.lastActionAt||null,
    lastError:raw.lastError||null
  };
}

const DEFAULT_ONBOARDING_CONFIG = {
  enabled: false,
  activatedAt: null,
  welcomeChannelId: IDS.channels.welcome,
  rulesChannelId: IDS.channels.rules,
  unlockRoleId: IDS.roles.member,
  logChannelId: IDS.channels.log,
  logEnabled: true,
  newMemberTimeoutMinutes: 0,
  welcomeMessage: discordTexts().welcomeMessage,
  rulesText: discordTexts().rulesText,
  rulesMessageId: null,
  rulesMessageChannelId: null,
  rulesPublishedAt: null,
  rulesUpdatedAt: null,
  rulesPublishedHash: null
};

function ensureDataDir() { fs.mkdirSync(DATA_DIR, {recursive:true}); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function readJsonFile(file, fallback) {
  const key=pgDocKey(file);
  if(pgStore.enabled&&key){
    if(!pgStore.hasDocument(key)){
      const exists=fs.existsSync(file);
      const inserted=pgStore.putDocumentIfAbsent(key,readLegacyJson(file,fallback));
      if(inserted?.inserted&&exists)pgStore.markImport(path.basename(file),legacyFileSha256(file),{kind:"json-document",key});
    }
    return pgStore.getDocument(key,clone(fallback));
  }
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return clone(fallback); }
}
function writeJsonFile(file, value) {
  const key=pgDocKey(file);
  if(pgStore.enabled&&key){pgStore.putDocument(key,value);return;}
  ensureDataDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}
if(pgStore.enabled){
  try{if(pgStore.queryEvents("moderation",1).length===0){const rows=readLegacyJsonl(MODERATION_LOG_FILE);if(rows.length){const r=pgStore.importEvents("moderation",rows);pgStore.markImport(path.basename(MODERATION_LOG_FILE),legacyFileSha256(MODERATION_LOG_FILE),{kind:"event-stream",stream:"moderation",rows:Number(r?.inserted||0)});}}}
  catch(e){console.error("⚠️ PostgreSQL-Import Moderationsprotokoll:",e.message);}
}

function cleanId(value, fallback=null) {
  const v = String(value || "").trim();
  return /^\d{15,22}$/.test(v) ? v : fallback;
}
function normalizeReportsConfig(raw={}){
  return {
    enabled:raw.enabled!==false,
    logChannelId:cleanId(raw.logChannelId,IDS.channels.log),
    buttonChannelId:cleanId(raw.buttonChannelId,IDS.channels.welcome),
    buttonMessageId:cleanId(raw.buttonMessageId,null),
    buttonMessageChannelId:cleanId(raw.buttonMessageChannelId,null),
    buttonText:String(raw.buttonText||DEFAULT_REPORTS_CONFIG.buttonText).trim().slice(0,1800)||DEFAULT_REPORTS_CONFIG.buttonText,
    buttonLabel:String(raw.buttonLabel||DEFAULT_REPORTS_CONFIG.buttonLabel).trim().slice(0,80)||DEFAULT_REPORTS_CONFIG.buttonLabel,
    cooldownMinutes:Math.max(0,Math.min(1440,Number(raw.cooldownMinutes??DEFAULT_REPORTS_CONFIG.cooldownMinutes))),
    archiveAttachments:raw.archiveAttachments!==false,
    logNewTicket:raw.logNewTicket!==false,
    logStatusChanges:raw.logStatusChanges!==false,
    logSanctions:raw.logSanctions!==false,
    logContentDeletion:raw.logContentDeletion!==false
  };
}
let reportsRevision=0;
let reportsLoadCache=null;
function normalizeReportsStore(raw={}){return {tickets:Array.isArray(raw.tickets)?raw.tickets.slice(-5000):[]};}
function normalizeReportsState(raw={}){return {sequenceByYear:raw.sequenceByYear&&typeof raw.sequenceByYear==="object"?raw.sequenceByYear:{},cooldowns:raw.cooldowns&&typeof raw.cooldowns==="object"?raw.cooldowns:{},lastCreatedAt:raw.lastCreatedAt||null,lastError:raw.lastError||null,commandsRegisteredAt:raw.commandsRegisteredAt||null};}
function loadReportsRelational(){
  if(!pgStore.enabled)return null;
  if(reportsLoadCache)return reportsLoadCache;
  const legacyTickets=pgStore.hasDocument("reports")?pgStore.getDocument("reports",{tickets:[]}):readLegacyJson(REPORTS_FILE,{tickets:[]});
  const legacyState=pgStore.hasDocument("reports-state")?pgStore.getDocument("reports-state",DEFAULT_REPORTS_STATE):readLegacyJson(REPORTS_STATE_FILE,DEFAULT_REPORTS_STATE);
  const imported=pgStore.importDiscordReportsStateIfEmpty(normalizeReportsStore(legacyTickets),normalizeReportsState(legacyState));
  if(imported?.inserted){try{pgStore.markImport("reports-relational",legacyFileSha256(REPORTS_FILE),{kind:"relational-state",source:pgStore.hasDocument("reports")?"postgres-jsonb":"reports.json"});}catch{}}
  const result=pgStore.getDiscordReportsState();reportsRevision=Number(result?.revision||0);reportsLoadCache={store:normalizeReportsStore(result?.tickets||{}),state:normalizeReportsState(result?.state||{})};return reportsLoadCache;
}
function loadReports(){if(pgStore.enabled)return loadReportsRelational().store;return normalizeReportsStore(readJsonFile(REPORTS_FILE,{tickets:[]}));}
function loadReportsState(){if(pgStore.enabled){const x=loadReportsRelational().state;reportsLoadCache=null;return x;}return normalizeReportsState(readJsonFile(REPORTS_STATE_FILE,DEFAULT_REPORTS_STATE));}
function normalizeSocialPlatform(raw={},fallback={}){
  return {
    enabled:raw.enabled!==false,
    channelId:cleanId(raw.channelId,fallback.channelId),
    text:String(raw.text??fallback.text??"").replace(/\\n/g,"\n").trim().slice(0,1800),
    useEmbed:raw.useEmbed!==false,
    includeThumbnail:raw.includeThumbnail!==false,
    // 9.25.6: Linkprüfung vor dem Senden und Altersgrenze (0 = unbegrenzt). Fehlt der Wert, gilt der Standard der Plattform.
    checkLink:raw.checkLink===undefined?fallback.checkLink===true:raw.checkLink===true,
    maxAgeHours:normalizeMaxAgeHours(raw.maxAgeHours??fallback.maxAgeHours,fallback.maxAgeHours)
  };
}
function normalizeSocialConfig(raw={}){
  return {
    enabled:raw.enabled!==false,
    pollMinutes:Math.max(5,Math.min(120,Number(raw.pollMinutes??DEFAULT_SOCIAL_CONFIG.pollMinutes))),
    instagram:normalizeSocialPlatform(raw.instagram||{},DEFAULT_SOCIAL_CONFIG.instagram),
    tiktok:normalizeSocialPlatform(raw.tiktok||{},DEFAULT_SOCIAL_CONFIG.tiktok)
  };
}
let socialRevision=0;
function normalizeSocialState(raw={}){
  return {
    initialized:{instagram:raw.initialized?.instagram===true,tiktok:raw.initialized?.tiktok===true},
    seen:{
      instagram:raw.seen?.instagram&&typeof raw.seen.instagram==="object"?raw.seen.instagram:{},
      tiktok:raw.seen?.tiktok&&typeof raw.seen.tiktok==="object"?raw.seen.tiktok:{}
    },
    lastPollAt:raw.lastPollAt||null,nextPollAt:raw.nextPollAt||null,
    platforms:{
      instagram:{...DEFAULT_SOCIAL_STATE.platforms.instagram,...(raw.platforms?.instagram||{})},
      tiktok:{...DEFAULT_SOCIAL_STATE.platforms.tiktok,...(raw.platforms?.tiktok||{})}
    }
  };
}
function normalizeSocialHistory(raw={}){return {items:Array.isArray(raw.items)?raw.items.slice(-1500):[]};}
function loadSocialBundle(){
  const fallbackState=DEFAULT_SOCIAL_STATE,fallbackHistory={items:[]};
  if(pgStore.enabled){
    let legacyState=fallbackState,legacyHistory=fallbackHistory;
    try{legacyState=pgStore.hasDocument("social-state")?pgStore.getDocument("social-state",fallbackState):readLegacyJson(SOCIAL_STATE_FILE,fallbackState);}catch{}
    try{legacyHistory=pgStore.hasDocument("social-history")?pgStore.getDocument("social-history",fallbackHistory):readLegacyJson(SOCIAL_HISTORY_FILE,fallbackHistory);}catch{}
    const imported=pgStore.importDiscordSocialStateIfEmpty(normalizeSocialState(legacyState),normalizeSocialHistory(legacyHistory));
    if(imported?.inserted){
      try{pgStore.markImport("social-state-history-relational",legacyFileSha256(SOCIAL_STATE_FILE),{kind:"relational-state",sources:[pgStore.hasDocument("social-state")?"postgres-jsonb":"social-state.json",pgStore.hasDocument("social-history")?"postgres-jsonb":"social-history.json"]});}catch{}
    }
    const result=pgStore.getDiscordSocialState();socialRevision=Number(result?.revision||0);
    return {state:normalizeSocialState(result?.state||fallbackState),history:normalizeSocialHistory(result?.history||fallbackHistory)};
  }
  return {state:normalizeSocialState(readJsonFile(SOCIAL_STATE_FILE,fallbackState)),history:normalizeSocialHistory(readJsonFile(SOCIAL_HISTORY_FILE,fallbackHistory))};
}
function loadSocialState(){return loadSocialBundle().state;}
function loadSocialHistory(){return loadSocialBundle().history;}
function loadSocialTokenState(){
  const raw=readJsonFile(SOCIAL_TOKEN_FILE,DEFAULT_SOCIAL_TOKEN_STATE);
  return {
    instagram:{...DEFAULT_SOCIAL_TOKEN_STATE.instagram,...(raw.instagram||{})},
    tiktok:{...DEFAULT_SOCIAL_TOKEN_STATE.tiktok,...(raw.tiktok||{})}
  };
}
function loadSocialOauthState(){
  const raw=readJsonFile(SOCIAL_OAUTH_STATE_FILE,{states:{}});
  return {states:raw.states&&typeof raw.states==="object"?raw.states:{}};
}

function validClock(value,fallback){
  const v=String(value||"");
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)?v:fallback;
}
function normalizeChannelTimeProfile(raw={},fallback={}){
  return {
    id:String(raw.id||fallback.id||`profile-${Date.now()}`).replace(/[^A-Za-z0-9_-]/g,"").slice(0,64)||`profile-${Date.now()}`,
    channelId:String(raw.channelId||fallback.channelId||"").trim(),
    enabled:raw.enabled!==false,
    closeTime:validClock(raw.closeTime,fallback.closeTime||"22:00"),
    openTime:validClock(raw.openTime,fallback.openTime||"06:00"),
    roles:{member:roleFlag(raw.roles,"member","rekrut")!==false,administrator:roleFlag(raw.roles,"administrator","s1")===true},
    lockThreads:raw.lockThreads!==false,
    announceWarning:raw.announceWarning!==false,
    warningMinutes:Math.max(5,Math.min(180,Math.round(Number(raw.warningMinutes??fallback.warningMinutes??30)||30))),
    warningMessage:String(raw.warningMessage??fallback.warningMessage??"⏰ Hinweis: In {warningMinutes} Minuten beginnt die Nachtruhe. Sie gilt von {closeTime} bis {openTime} Uhr. Bitte schließt eure Gespräche rechtzeitig ab.").slice(0,1800),
    announceClose:raw.announceClose!==false,
    closeMessage:String(raw.closeMessage??fallback.closeMessage??"").slice(0,1800),
    announceOpen:raw.announceOpen!==false,
    openMessage:String(raw.openMessage??fallback.openMessage??"").slice(0,1800)
  };
}
function normalizeChannelTimesConfig(raw={}){
  const base=DEFAULT_CHANNEL_TIMES_CONFIG;
  const source=Array.isArray(raw.profiles)?raw.profiles:base.profiles;
  const ids=new Set();
  const profiles=[];
  for(const row of source){
    const fallback=base.profiles.find(x=>x.id===row?.id)||{};
    const p=normalizeChannelTimeProfile(row,fallback);
    if(!p.channelId||ids.has(p.id))continue;
    ids.add(p.id);profiles.push(p);
  }
  return {
    enabled:raw.enabled===true,
    timezone:String(raw.timezone||base.timezone).slice(0,80),
    logEnabled:raw.logEnabled!==false,
    logChannelId:String(raw.logChannelId||base.logChannelId||"").trim(),
    profiles
  };
}
// 8.9.14: Umfang des Wartungsmodus. "profiles" = Kanäle aktiver Zeitprofile (bisheriges Verhalten),
// "custom" = eigene Kanalliste. Rollen sind in beiden Fällen wählbar (Standard: nur Member).
function normalizeMaintenanceScope(raw={}){
  const scope=raw.scope==="custom"?"custom":"profiles";
  const channelIds=[...new Set((Array.isArray(raw.channelIds)?raw.channelIds:[]).map(x=>String(x||"").trim()).filter(x=>/^\d{5,25}$/.test(x)))].slice(0,50);
  const hasRoles=raw.roles&&typeof raw.roles==="object";
  const pick=(k,o)=>raw.roles[k]!==undefined?raw.roles[k]:raw.roles[o];
  const roles={member:hasRoles?pick("member","rekrut")===true:true,administrator:hasRoles?pick("administrator","s1")===true:false};
  return {scope,channelIds,roles};
}
function maintenanceRoleIds(){
  const m=channelTimesState.maintenance||DEFAULT_MAINTENANCE,r=m.roles||{member:true,administrator:false};
  const ids=[];if(roleFlag(r,"member","rekrut")&&IDS.roles.member)ids.push(IDS.roles.member);if(roleFlag(r,"administrator","s1")&&IDS.roles.administrator)ids.push(IDS.roles.administrator);
  return ids;
}
let channelTimesStateRevision=0;
function normalizeChannelTimesState(raw={}){
  return {
    active:raw.active&&typeof raw.active==="object"?raw.active:{},
    overrides:raw.overrides&&typeof raw.overrides==="object"?raw.overrides:{},
    warningNotices:raw.warningNotices&&typeof raw.warningNotices==="object"?raw.warningNotices:{},
    maintenance:{...DEFAULT_MAINTENANCE,...(raw.maintenance||{}),...normalizeMaintenanceScope(raw.maintenance||{}),snapshots:raw.maintenance?.snapshots&&typeof raw.maintenance.snapshots==="object"?raw.maintenance.snapshots:{}},
    lastRunAt:raw.lastRunAt||null,lastError:raw.lastError||null,
    events:Array.isArray(raw.events)?raw.events.slice(-500):[]
  };
}
function loadChannelTimesState(){
  if(pgStore.enabled){
    let legacy=DEFAULT_CHANNEL_TIMES_STATE;
    try{legacy=pgStore.hasDocument("channel-times-state")?pgStore.getDocument("channel-times-state",DEFAULT_CHANNEL_TIMES_STATE):readLegacyJson(CHANNEL_TIMES_STATE_FILE,DEFAULT_CHANNEL_TIMES_STATE);}catch{}
    const normalized=normalizeChannelTimesState(legacy);
    const imported=pgStore.importDiscordChannelTimesStateIfEmpty(normalized);
    if(imported?.inserted){try{pgStore.markImport("channel-times-state-relational",legacyFileSha256(CHANNEL_TIMES_STATE_FILE),{kind:"relational-state",source:pgStore.hasDocument("channel-times-state")?"postgres-jsonb":"channel-times-state.json"});}catch{}}
    const result=pgStore.getDiscordChannelTimesState();channelTimesStateRevision=Number(result?.revision||0);return normalizeChannelTimesState(result?.state||normalized);
  }
  return normalizeChannelTimesState(readJsonFile(CHANNEL_TIMES_STATE_FILE,DEFAULT_CHANNEL_TIMES_STATE));
}
function loadDiscordLogConfig(){
  return normalizeDiscordLogConfig(readJsonFile(DISCORD_LOG_CONFIG_FILE,DEFAULT_DISCORD_LOG_CONFIG));
}
function rulesTextHash(value){return crypto.createHash("sha256").update(String(value||""),"utf8").digest("hex");}
function loadOnboardingConfig() {
  const raw = readJsonFile(ONBOARDING_CONFIG_FILE, DEFAULT_ONBOARDING_CONFIG);
  // Migrate V5.5.0 config without silently enabling the new reaction gate.
  const hasReactionGateFields = Object.prototype.hasOwnProperty.call(raw, "rulesText") || Object.prototype.hasOwnProperty.call(raw, "rulesMessageId");
  return {
    enabled: hasReactionGateFields ? raw.enabled === true : false,
    activatedAt: hasReactionGateFields ? (raw.activatedAt || null) : null,
    welcomeChannelId: cleanId(raw.welcomeChannelId, IDS.channels.welcome),
    rulesChannelId: cleanId(raw.rulesChannelId, IDS.channels.rules),
    unlockRoleId: cleanId(raw.unlockRoleId, IDS.roles.member),
    logChannelId: cleanId(raw.logChannelId, IDS.channels.log),
    logEnabled: raw.logEnabled !== false,
    newMemberTimeoutMinutes: Math.max(0, Math.min(1440, Math.trunc(Number(raw.newMemberTimeoutMinutes) || 0))),
    welcomeMessage: String(raw.welcomeMessage || DEFAULT_ONBOARDING_CONFIG.welcomeMessage).slice(0, 1800),
    rulesText: String(raw.rulesText || DEFAULT_ONBOARDING_CONFIG.rulesText).slice(0, 2000),
    rulesMessageId: cleanId(raw.rulesMessageId, null),
    rulesMessageChannelId: cleanId(raw.rulesMessageChannelId, null),
    rulesPublishedAt: raw.rulesPublishedAt || null,
    rulesUpdatedAt: raw.rulesUpdatedAt || null,
    rulesPublishedHash: String(raw.rulesPublishedHash||((raw.rulesMessageId&&raw.rulesUpdatedAt)?rulesTextHash(String(raw.rulesText||DEFAULT_ONBOARDING_CONFIG.rulesText).slice(0,2000)):"")||"")||null
  };
}
let onboardingStateRevision=0;
function normalizeOnboardingState(raw={}) {
  return {
    members: raw.members && typeof raw.members === "object" ? raw.members : {},
    stats: {
      totalWelcomed: Number(raw.stats?.totalWelcomed || 0),
      totalVerified: Number(raw.stats?.totalVerified || raw.stats?.totalAssigned || 0),
      bypassPrevented: Number(raw.stats?.bypassPrevented || 0),
      lastActionAt: raw.stats?.lastActionAt || null,
      lastError: raw.stats?.lastError || null
    }
  };
}
function loadOnboardingState() {
  const fallback={members:{},stats:{}};
  if(pgStore.enabled){
    let legacy=fallback;
    try{legacy=pgStore.hasDocument("onboarding-state")?pgStore.getDocument("onboarding-state",fallback):readLegacyJson(ONBOARDING_STATE_FILE,fallback);}catch{}
    const imported=pgStore.importDiscordOnboardingStateIfEmpty(legacy);
    if(imported?.inserted){try{pgStore.markImport("onboarding-state-relational",legacyFileSha256(ONBOARDING_STATE_FILE),{kind:"relational-state",source:pgStore.hasDocument("onboarding-state")?"postgres-jsonb":"onboarding-state.json"});}catch{}}
    const result=pgStore.getDiscordOnboardingState();onboardingStateRevision=Number(result?.revision||0);return normalizeOnboardingState(result?.state||fallback);
  }
  return normalizeOnboardingState(readJsonFile(ONBOARDING_STATE_FILE,fallback));
}

let moderationConfig = loadModerationConfig();
let moderationState = loadModerationState();

let wordFilterCompiled={revision:0,terms:[],allow:[]};
let wordFilterCheckedAt=0;
let wordFilterCentralReady=false;
function wordFilterRefresh(force=false){
  if(!pgStore.enabled)return wordFilterCompiled;
  const nowMs=Date.now();if(!force&&nowMs-wordFilterCheckedAt<5000)return wordFilterCompiled;
  wordFilterCheckedAt=nowMs;
  try{
    const rev=pgStore.wordFilterRevision();
    if(force||Number(rev.revision||0)!==Number(wordFilterCompiled.revision||0)){const snapshot=pgStore.wordFilterSnapshot();wordFilterCentralReady=!!((snapshot.terms||[]).length||(snapshot.imports||[]).some(x=>String(x.import_id||"").startsWith("legacy-")||String(x.source_name||"").length));wordFilterCompiled=compileWordFilter(snapshot);}
  }catch(e){console.error("⚠️ Discord-Wortfilter-Refresh:",e.message);}
  return wordFilterCompiled;
}
function wordFilterPolicy(match){
  const policy=(wordFilterCompiled.policies||[]).find(p=>p.category_id===match.term.category_id&&p.platform==="discord")||{};
  const override=match.platformRule||{};
  return {action:override.action||policy.action||"log",timeoutSeconds:Number(override.timeout_seconds??policy.timeout_seconds??0),escalate:override.action?false:policy.escalate===true,messageTemplate:String(policy.message_template||"")};
}
function migrateLegacyDiscordWordFilter(){
  if(!pgStore.enabled)return;
  try{
    const snap=pgStore.wordFilterSnapshot(),alreadyImported=(snap.imports||[]).some(x=>x.import_id==="legacy-discord-v8");
    const rows=[];
    for(const rule of moderationConfig.rules||[])for(const term of rule.terms||[])if(String(term||"").trim())rows.push({
      term_id:`legacy-discord-${crypto.createHash("sha1").update(String(rule.id||rule.name||"rule")+"\0"+String(term)).digest("hex").slice(0,20)}`,
      term:String(term).trim(),category_id:"benutzerdefiniert",severity:2,detection_type:rule.matchMode==="fullword"?"whole_word":"substring",
      enabled:rule.enabled!==false,test_only:false,
      metadata:{legacyRuleId:rule.id||null,legacyRuleName:rule.name||null,legacyEscalate:true,legacyWarningText:moderationConfig.warningText||"",exemptRoleIds:Array.isArray(rule.exemptRoleIds)?rule.exemptRoleIds:[],exemptChannelIds:Array.isArray(rule.exemptChannelIds)?rule.exemptChannelIds:[]},
      platforms:[{platform:"discord",enabled:rule.enabled!==false,action:moderationConfig.enforcement?.deleteMessage===false?"warn":"delete"},{platform:"twitch",enabled:false}]
    });
    if(!alreadyImported)pgStore.importWordFilter({import_id:"legacy-discord-v8",source_name:"Legacy Discord moderation.rules",format:"internal",created_by:"migration",merge_platforms_on_duplicate:true,terms:rows});
    const allowed=[...new Set((moderationConfig.rules||[]).flatMap(r=>r.allowedTerms||[]).map(x=>String(x||"").trim()).filter(Boolean))];
    for(const value of allowed){
      try{pgStore.upsertWordFilterAllow({allow_id:`legacy-discord-allow-${crypto.createHash("sha1").update(value).digest("hex").slice(0,20)}`,value,platform:"discord",match_type:"phrase",enabled:true,note:"Migriert aus Discord allowedTerms",created_by:"migration"});}catch{}
    }
    wordFilterRefresh(true);
  }catch(e){console.error("⚠️ Legacy-Discord-Wortfilter konnte nicht migriert werden:",e.message);}
}
setImmediate(migrateLegacyDiscordWordFilter);
let onboardingConfig = loadOnboardingConfig();
let onboardingState = loadOnboardingState();
let announcementsStateRevision=0;
function loadAnnouncementsState(){
  const fallback=DEFAULT_ANNOUNCEMENTS_STATE;
  if(pgStore.enabled){
    let legacy=fallback;
    try{legacy=pgStore.hasDocument("announcements-state")?pgStore.getDocument("announcements-state",fallback):readLegacyJson(ANNOUNCEMENTS_STATE_FILE,fallback);}catch{}
    const normalized={liveStreams:legacy.liveStreams&&typeof legacy.liveStreams==="object"?legacy.liveStreams:{},clips:legacy.clips&&typeof legacy.clips==="object"?legacy.clips:{},lastLiveAt:legacy.lastLiveAt||null,lastClipAt:legacy.lastClipAt||null,lastError:legacy.lastError||null};
    const imported=pgStore.importDiscordAnnouncementsStateIfEmpty(normalized);
    if(imported?.inserted){try{pgStore.markImport("announcements-state-relational",legacyFileSha256(ANNOUNCEMENTS_STATE_FILE),{kind:"relational-state",source:pgStore.hasDocument("announcements-state")?"postgres-jsonb":"announcements-state.json"});}catch{}}
    const result=pgStore.getDiscordAnnouncementsState();announcementsStateRevision=Number(result?.revision||0);return result?.state||normalized;
  }
  const raw=readJsonFile(ANNOUNCEMENTS_STATE_FILE,fallback);return {liveStreams:raw.liveStreams&&typeof raw.liveStreams==="object"?raw.liveStreams:{},clips:raw.clips&&typeof raw.clips==="object"?raw.clips:{},lastLiveAt:raw.lastLiveAt||null,lastClipAt:raw.lastClipAt||null,lastError:raw.lastError||null};
}
let announcementsConfig = (() => {
  const raw=readJsonFile(ANNOUNCEMENTS_CONFIG_FILE,DEFAULT_ANNOUNCEMENTS_CONFIG);
  return {
    liveEnabled:raw.liveEnabled===true,
    clipsEnabled:raw.clipsEnabled===true,
    liveChannelId:cleanId(raw.liveChannelId,IDS.channels.twitch),
    clipsChannelId:cleanId(raw.clipsChannelId,IDS.channels.clips),
    liveText:normalizeAnnouncementText(raw.liveText,DEFAULT_ANNOUNCEMENTS_CONFIG.liveText).slice(0,1800),
    clipText:normalizeAnnouncementText(raw.clipText,DEFAULT_ANNOUNCEMENTS_CONFIG.clipText).slice(0,1800),
    mentionRoleId:cleanId(raw.mentionRoleId,null),
    useEmbeds:raw.useEmbeds!==false
  };
})();
let announcementsState = loadAnnouncementsState();
let reportsConfig=normalizeReportsConfig(readJsonFile(REPORTS_CONFIG_FILE,DEFAULT_REPORTS_CONFIG));
let reportsStore=loadReports();
let reportsState=loadReportsState();
let socialConfig=normalizeSocialConfig(readJsonFile(SOCIAL_CONFIG_FILE,DEFAULT_SOCIAL_CONFIG));
const initialSocialBundle=loadSocialBundle();
let socialState=initialSocialBundle.state;
let socialHistory=initialSocialBundle.history;
let socialTokenState=loadSocialTokenState();
let socialOauthState=loadSocialOauthState();
let channelTimesConfig=normalizeChannelTimesConfig(readJsonFile(CHANNEL_TIMES_CONFIG_FILE,DEFAULT_CHANNEL_TIMES_CONFIG));
let channelTimesState=loadChannelTimesState();
let emergencyConfig=normalizeEmergencyConfig(readJsonFile(EMERGENCY_CONFIG_FILE,DEFAULT_EMERGENCY_CONFIG));
let emergencyState=loadEmergencyState();
let emergencyTimer=null;
let emergencyRunning=false;
let discordLogConfig=loadDiscordLogConfig();
if(!fs.existsSync(DISCORD_LOG_CONFIG_FILE)){
  // Einmalige Migration der bisherigen verteilten Log-Schalter in die neue zentrale Log-Zentrale.
  discordLogConfig.defaultChannelId=onboardingConfig.logChannelId||moderationConfig.logChannelId||reportsConfig.logChannelId||channelTimesConfig.logChannelId||IDS.channels.log;
  const set=(key,value)=>{if(discordLogConfig.events[key])discordLogConfig.events[key].enabled=!!value;};
  set("moderation.violation",moderationConfig.logEnabled!==false&&moderationConfig.moderationLog?.violations!==false);
  set("moderation.timeout",moderationConfig.logEnabled!==false&&moderationConfig.moderationLog?.timeouts!==false);
  set("moderation.ban",moderationConfig.logEnabled!==false&&moderationConfig.moderationLog?.bans!==false);
  set("moderation.unban",moderationConfig.logEnabled!==false&&moderationConfig.moderationLog?.bans!==false);
  set("moderation.untimeout",moderationConfig.logEnabled!==false&&moderationConfig.moderationLog?.timeouts!==false);
  set("moderation.native",moderationConfig.logEnabled!==false&&moderationConfig.moderationLog?.nativeAutoMod!==false);
  for(const key of ["onboarding.role_changed","onboarding.access_applied","onboarding.rules_published","onboarding.rules_updated","onboarding.premature_role_removed","onboarding.verified","onboarding.failed","onboarding.repair","onboarding.enabled","onboarding.disabled"])set(key,onboardingConfig.logEnabled!==false);
  set("reports.new",reportsConfig.logNewTicket!==false);
  set("reports.status",reportsConfig.logStatusChanges!==false);
  set("reports.sanction",reportsConfig.logSanctions!==false);
  set("reports.delete",reportsConfig.logContentDeletion!==false);
  set("channel-times.closed",channelTimesConfig.logEnabled!==false);
  set("channel-times.opened",channelTimesConfig.logEnabled!==false);
  set("channel-times.error",channelTimesConfig.logEnabled!==false);
  saveDiscordLogConfig();
}
let channelTimesTimer=null;
let channelTimesRunning=false;
let socialPollTimer=null;
let socialPollRunning=false;
let instagramRefreshTimer=null;
let instagramRefreshRunning=false;
function saveAnnouncementsConfig(){writeJsonFile(ANNOUNCEMENTS_CONFIG_FILE,announcementsConfig);}
function saveAnnouncementsState(){
  announcementsState.liveStreams=Object.fromEntries(Object.entries(announcementsState.liveStreams||{}).slice(-100));
  announcementsState.clips=Object.fromEntries(Object.entries(announcementsState.clips||{}).slice(-1000));
  if(pgStore.enabled){const r=pgStore.putDiscordAnnouncementsState(announcementsState,announcementsStateRevision);announcementsStateRevision=Number(r?.revision||announcementsStateRevision+1);return;}
  writeJsonFile(ANNOUNCEMENTS_STATE_FILE,announcementsState);
}
function saveReportsConfig(){writeJsonFile(REPORTS_CONFIG_FILE,reportsConfig);}
function persistReportsRelational({replace=false}={}){
  if(!pgStore.enabled)return false;
  reportsStore.tickets=(reportsStore.tickets||[]).slice(-5000);
  const cutoff=Date.now()-7*86400000;reportsState.cooldowns=Object.fromEntries(Object.entries(reportsState.cooldowns||{}).filter(([,ts])=>Number(ts)>=cutoff));
  const r=pgStore.putDiscordReportsState(reportsStore,reportsState,reportsRevision,{replace});reportsRevision=Number(r?.revision||reportsRevision+1);return true;
}
function saveReports(){reportsStore.tickets=(reportsStore.tickets||[]).slice(-5000);if(persistReportsRelational())return;writeJsonFile(REPORTS_FILE,reportsStore);}
function saveReportsState(){const cutoff=Date.now()-7*86400000;reportsState.cooldowns=Object.fromEntries(Object.entries(reportsState.cooldowns||{}).filter(([,ts])=>Number(ts)>=cutoff));if(persistReportsRelational())return;writeJsonFile(REPORTS_STATE_FILE,reportsState);}
function saveSocialConfig(){writeJsonFile(SOCIAL_CONFIG_FILE,socialConfig);}
function persistSocialRelational({replace=false}={}){
  if(!pgStore.enabled)return false;
  for(const platform of["instagram","tiktok"]){const rows=Object.entries(socialState.seen[platform]||{}).sort((a,b)=>Number(b[1]?.seenAtMs||0)-Number(a[1]?.seenAtMs||0)).slice(0,1000);socialState.seen[platform]=Object.fromEntries(rows);}
  socialHistory.items=(socialHistory.items||[]).slice(-1500);
  const r=pgStore.putDiscordSocialState(socialState,socialHistory,socialRevision,{replace});socialRevision=Number(r?.revision||socialRevision+1);return true;
}
function saveSocialState(){
  for(const platform of["instagram","tiktok"]){const rows=Object.entries(socialState.seen[platform]||{}).sort((a,b)=>Number(b[1]?.seenAtMs||0)-Number(a[1]?.seenAtMs||0)).slice(0,1000);socialState.seen[platform]=Object.fromEntries(rows);}
  if(persistSocialRelational())return;writeJsonFile(SOCIAL_STATE_FILE,socialState);
}
function saveSocialHistory(){
  socialHistory.items=(socialHistory.items||[]).slice(-1500);
  if(persistSocialRelational())return;writeJsonFile(SOCIAL_HISTORY_FILE,socialHistory);
}
function saveSocialTokenState(){writeJsonFile(SOCIAL_TOKEN_FILE,socialTokenState);}
function saveSocialOauthState(){writeJsonFile(SOCIAL_OAUTH_STATE_FILE,socialOauthState);}
function saveChannelTimesConfig(){writeJsonFile(CHANNEL_TIMES_CONFIG_FILE,channelTimesConfig);}
function saveChannelTimesState(){channelTimesState.events=(channelTimesState.events||[]).slice(-500);if(pgStore.enabled){const r=pgStore.putDiscordChannelTimesState(channelTimesState,channelTimesStateRevision);channelTimesStateRevision=Number(r?.revision||channelTimesStateRevision+1);return;}writeJsonFile(CHANNEL_TIMES_STATE_FILE,channelTimesState);}
function saveDiscordLogConfig(){writeJsonFile(DISCORD_LOG_CONFIG_FILE,discordLogConfig);}
function saveEmergencyConfig(){writeJsonFile(EMERGENCY_CONFIG_FILE,emergencyConfig);}
function saveEmergencyState(){emergencyState.history=(emergencyState.history||[]).slice(-500);if(pgStore.enabled){const r=pgStore.putDiscordEmergencyState(emergencyState,emergencyStateRevision);emergencyStateRevision=Number(r?.revision||emergencyStateRevision+1);return;}writeJsonFile(EMERGENCY_STATE_FILE,emergencyState);}

function cleanupSocialOauthStates(){
  const nowMs=Date.now();
  socialOauthState.states=Object.fromEntries(Object.entries(socialOauthState.states||{}).filter(([,x])=>Number(x?.expiresAt||0)>nowMs&&!x?.usedAt));
  saveSocialOauthState();
}

function saveModerationConfig(){ writeJsonFile(MODERATION_CONFIG_FILE, moderationConfig); }
function saveModerationState(){
  const cutoff=Date.now()-24*60*60*1000,compact={};
  for(const [key,values] of Object.entries(moderationState.recent||{})){
    const keep=(Array.isArray(values)?values:[]).filter(ts=>Number(ts)>=cutoff).slice(-50);
    if(keep.length)compact[key]=keep;
  }
  moderationState.recent=compact;
  if(pgStore.enabled){
    const r=pgStore.putDiscordModerationState(moderationState,moderationStateRevision);
    moderationStateRevision=Number(r?.revision||moderationStateRevision);
    return;
  }
  writeJsonFile(MODERATION_STATE_FILE,moderationState);
}
function saveOnboardingConfig() { writeJsonFile(ONBOARDING_CONFIG_FILE, onboardingConfig); }
function saveOnboardingState() {
  if(pgStore.enabled){const r=pgStore.putDiscordOnboardingState(onboardingState,onboardingStateRevision);onboardingStateRevision=Number(r?.revision||onboardingStateRevision+1);return;}
  writeJsonFile(ONBOARDING_STATE_FILE, onboardingState);
}

const INTENTS =
  (1 << 0) |   // GUILDS
  (1 << 1) |   // GUILD_MEMBERS
  (1 << 9) |   // GUILD_MESSAGES
  (1 << 10) |  // GUILD_MESSAGE_REACTIONS
  (1 << 15) |  // MESSAGE_CONTENT
  (1 << 21);   // AUTO_MODERATION_EXECUTION

const state = {
  startedAt: new Date().toISOString(),
  gateway: {connected:false, ready:false, sessionId:null, resumeGatewayUrl:null, sequence:null, reconnects:0, lastEventAt:null, lastError:null},
  bot: {id:null, username:null, discriminator:null},
  guild: {id:IDS.guild || null, found:false, name:null, ownerId:null, memberCount:null, features:[]},
  checks: {config:[], roles:{}, categories:{}, channels:{}, botRoleHierarchy:null, botPermissions:null, completedAt:null},
  cache: {roles:[], channels:[], botMember:null}
};

let ws = null;
let heartbeatTimer = null;
let heartbeatAcked = true;
let reconnectTimer = null;

function now() { return new Date().toISOString(); }
function log(...args) { console.log(now(), ...args); }
function warn(...args) { console.warn(now(), ...args); }
function fail(...args) { console.error(now(), ...args); }
function redact(value) { return value ? "***" : null; }
function discordResolved() { return installationKit.resolveDiscord({ env: process.env, installation: { discord: installationDiscord } }); }
// Wirksame Werte (Umgebung vor Profil) in IDS übernehmen.
function applyDiscordInstallation() {
  const r = discordResolved();
  IDS.guild = r.guildId || undefined;
  IDS.roles.moderator = r.roles.moderator || undefined;
  IDS.roles.administrator = r.roles.administrator || undefined;
  IDS.roles.member = r.roles.member || undefined;
  IDS.roles.bot = r.roles.bot || undefined;
  return r;
}
// 9.13.0: Textpaket des Discord-Dienstes. Das Control Center meldet es mit den Servereinstellungen. Solange noch keines gemeldet wurde
// (erster Start nach dem Update), gilt: sind schon Discord-Daten vorhanden, ist es eine Bestandsinstallation („legacy-bwk“),
// sonst neutral. Die Entscheidung wird gespeichert und danach nur noch vom Control Center geändert.
function documentExists(file) {
  const key = pgDocKey(file);
  if (pgStore.enabled && key) { try { return !!pgStore.hasDocument(key); } catch { return false; } }
  return fs.existsSync(file);
}
function hasExistingDiscordData() {
  for (const [file] of PG_DOCUMENT_FILES) {
    if (file !== INSTALLATION_FILE && documentExists(file)) return true;
  }
  return false;
}
function loadDiscordInstallation() {
  let stored = null;
  if (documentExists(INSTALLATION_FILE)) { try { stored = readJsonFile(INSTALLATION_FILE, {}); } catch { stored = null; } }
  installationDiscord = installationKit.normalizeDiscord(stored || {});
  if (stored && (stored.textPack === "legacy-bwk" || stored.textPack === "neutral")) installationTextPack = stored.textPack;
  else {
    installationTextPack = hasExistingDiscordData() ? "legacy-bwk" : "neutral";
    try { writeJsonFile(INSTALLATION_FILE, { ...installationDiscord, textPack: installationTextPack }); } catch { /* wird beim nächsten Speichern nachgeholt */ }
  }
  return applyDiscordInstallation();
}

function discordConfigMissing() { return installationKit.missingDiscord(discordResolved()); }
function missingConfig() { return [...REQUIRED.filter((key) => !String(process.env[key] || "").trim()), ...discordConfigMissing()]; }

async function discordFetch(apiPath, options = {}) {
  const hasBody = options.body !== undefined && options.body !== null;
  // Discord liefert bei HTTP 429 retry_after in Sekunden. Maximal drei Warteversuche,
  // damit die API keine endlosen Schleifen oder eine blockierte Administration verursacht.
  for(let attempt=0;attempt<4;attempt++){
    const response = await fetch(`${API_BASE}${apiPath}`, {
      ...options,
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        ...(hasBody ? {"Content-Type":"application/json"} : {}),
        "User-Agent": discordTexts().userAgent,
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch { body = text; } }
    if(response.status===429 && attempt<3){
      const seconds=Number(body?.retry_after ?? response.headers.get('retry-after'));
      const waitMs=Number.isFinite(seconds)&&seconds>=0?Math.min(15000,Math.max(250,Math.ceil(seconds*1000)+150)):2000;
      warn(`Discord-Rate-Limit (${apiPath}): erneuter Versuch nach ${waitMs} ms`);
      await new Promise(resolve=>setTimeout(resolve,waitMs));
      continue;
    }
    if (!response.ok) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      const error = new Error(`Discord API ${response.status}: ${detail}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }
}
function discordApi(apiPath, method="GET", body=null, headers={}) {
  return discordFetch(apiPath, {
    method,
    body: body === null ? undefined : JSON.stringify(body),
    headers
  });
}
const inviteService=createDiscordInviteService({guildId:IDS.guild,read:()=>readJsonFile(INVITE_CONFIG_FILE,{}),write:s=>writeJsonFile(INVITE_CONFIG_FILE,s),api:discordApi,log:(...args)=>warn(...args),isActive:()=>moduleState.isOn("discordInvite")});
// Periodic verification is independent of Twitch commands.
inviteService.start();
const LV = () => textPackKit.get(installationTextPack).level || textPackKit.NEUTRAL.level;
const levelEngine=createLevelEngine({guildId:IDS.guild,preset:installationTextPack==="legacy-bwk"?require("/shared/legacy-bwk-migration").legacyLevelPreset():null,
  load:key=>pgStore.enabled?pgStore.getDocument(`levelsystem-${key}`,null):readLegacyJson(path.join(DATA_DIR,`levelsystem-${key}.json`),null),
  save:(key,value)=>{if(pgStore.enabled)pgStore.putDocument(`levelsystem-${key}`,value);else{ensureDataDir();const f=path.join(DATA_DIR,`levelsystem-${key}.json`);fs.writeFileSync(f+".tmp",JSON.stringify(value));fs.renameSync(f+".tmp",f);}}
});
// 9.5.0: Modulschalter „Levelsystem“. Aus = keine XP, keine Rücknahmen, keine Rollenänderungen, keine Topliste,
// Slash-Commands antworten „derzeit deaktiviert“. Vorhandene Rollen und Stände bleiben unverändert.
const levelModuleOn=()=>moduleState.isOn("levelsystem");
const levelActive=()=>levelEngine.config.enabled&&levelModuleOn();
function levelInteractionOf(i){const type=Number(i?.type);if(type===2)return ['rang','toprang','rangliste','teilstreitkraft','dailyxp','einsatz','mission'].includes(String(i.data?.name||''));return String(i?.data?.custom_id||'').startsWith('level:');}
function levelText(id){const p=levelEngine.profile(id);const blocks=Math.floor(p.percent/10);return `🎖️ **${p.rank}**${LV().branches?` (${p.branch})`:''}\nXP: **${p.xp}** | Stufe ${p.level}\n${'█'.repeat(blocks)}${'░'.repeat(10-blocks)} ${p.percent}%\n${p.next?`${LV().nextRank}: **${p.next}** (noch ${p.missing} XP)`:LV().maxRank}`;}
function announceGamePromotion(userId,result){
 if(result.oldRank?.id===result.newRank?.id||!result.newRank||!levelEngine.config.channels?.befoerderungen)return;
 const profile=levelEngine.profile(userId);
 discordApi(`/channels/${levelEngine.config.channels.befoerderungen}/messages`,'POST',{content:`🎖️ **${LV().promotion}**\n<@${userId}> wurde zu **${profile.rank}** befördert.`,allowed_mentions:{parse:[]}}).catch(e=>warn('Minigame Beförderung:',e.message));
}
async function levelInteraction(i){if(!levelModuleOn()&&i?.guild_id===IDS.guild&&levelInteractionOf(i)){await interactionRespond(i,4,{flags:64,content:"⏸️ Das Minigame ist derzeit deaktiviert."});return true;}
if(!levelEngine.config.enabled||i.guild_id!==IDS.guild)return false;const name=String(i.data?.name||'');const type=Number(i.type);if(type===2&&!['rang','toprang','rangliste','teilstreitkraft','dailyxp','einsatz','mission'].includes(name))return false;
 if(type===3&&!String(i.data?.custom_id||'').startsWith('level:'))return false;
 const id=String(i.member?.user?.id||i.user?.id||'');if(!id)return false;
 if(type===2&&name==='dailyxp'){
  try{const r=levelEngine.claimDaily(id);if(r.ok){if(r.oldRank?.id!==r.newRank?.id){queueLevelSync(id);announceGamePromotion(id,r);}await interactionRespond(i,4,{flags:64,content:`📅 **${LV().dailyTitle}:** +${r.awarded} XP! Nächste Meldung ab 00:00 Uhr (Deutschland).`});}else await interactionRespond(i,4,{flags:64,content:LV().dailyDone});}
  catch(error){await interactionRespond(i,4,{flags:64,content:`${LV().dailyFail}: ${error.message}`});}return true;
 }
 if(type===2&&(name==='einsatz'||name==='mission')){
  const action=String(i.data?.options?.[0]?.name||'status');
  try{if(action==='starten'){const r=levelEngine.startMission(id);await interactionRespond(i,4,{flags:64,content:r.ok?`🪖 **${r.current.name}** gestartet. ${r.current.description}\nEnde: <t:${Math.floor(r.current.endsAt/1000)}:F>. ${LV().missionStart}`:r.reason==='active'?LV().missionBusy:LV().missionNone});}
  else if(action==='statistik'){const summary=levelEngine.personalMissionStatistics(id);await interactionRespond(i,4,{flags:64,content:`📊 **${LV().missionStatsTitle}**\n🪖 ${LV().missionDone}: **${summary.completed}**\n✅ Erfolgreich: **${summary.successful}**\n❌ Fehlgeschlagen: **${summary.failed}**\n🎯 Erfolgsquote: **${summary.successRate.toLocaleString('de-DE')} %**`});}
  else if(action==='abholen'){const r=levelEngine.claimMission(id);if(r.ok&&r.oldRank?.id!==r.newRank?.id){queueLevelSync(id);announceGamePromotion(id,r);}await interactionRespond(i,4,{flags:64,content:r.ok?`${r.event.success?LV().missionOk:LV().missionBad}: **${r.event.name}** · +${r.awarded} XP.`:r.reason==='missing'?LV().missionMissing:`${LV().missionRunning} <t:${Math.floor(r.current.endsAt/1000)}:F>.`});}
  else {const s=levelEngine.missionStatus(id);await interactionRespond(i,4,{flags:64,content:s.current?`🪖 **${s.current.name}**\n${s.ready?LV().missionReady:LV().missionWait}\nEnde: <t:${Math.floor(s.current.endsAt/1000)}:F> (<t:${Math.floor(s.current.endsAt/1000)}:R>)\nHeutige Versuche: **${s.used}/${s.limit}**`:`${LV().missionIdle} ${s.used}/${s.limit}. ${LV().missionHint}`});}}
  catch(error){await interactionRespond(i,4,{flags:64,content:`${LV().missionFail}: ${error.message}`});}return true;
 }
 if(type===2){const remaining=levelEngine.reserve(id,`cmd:${name}`);if(remaining){await interactionRespond(i,4,{flags:64,content:`Bitte warte noch ${Math.ceil(remaining/1000)} Sekunden.`});return true;}
 if(name==='rang'){await interactionRespond(i,4,{flags:64,content:levelText(id),components:[{type:1,components:[{type:2,style:1,label:'Rangprofil teilen',custom_id:'level:share'}]}]});return true;}
 if(name==='teilstreitkraft'&&LV().branches){await interactionRespond(i,4,{flags:64,content:'Wähle deine Teilstreitkraft:',components:[{type:1,components:[{type:3,custom_id:'level:branch',options:[{label:'Heer',value:'heer'},{label:'Luftwaffe',value:'luftwaffe'},{label:'Marine',value:'marine'}]}]}]});return true;}
 const entries=levelEngine.leaderboard();const pos=entries.findIndex(x=>x.id===id);let rows=name==='toprang'?entries.slice(0,10):entries.slice(Math.max(0,Math.min(pos<0?0:pos-5,entries.length-10)),Math.max(0,Math.min(pos<0?0:pos-5,entries.length-10))+10);const msg=rows.map(x=>`${entries.indexOf(x)+1}. ${x.id===id?'➤ ':''}<@${x.id}> — ${x.xp} XP`).join('\n')||'Noch keine Platzierungen.';await interactionRespond(i,4,{flags:64,content:msg,allowed_mentions:{parse:[]}});return true;}
 const custom=String(i.data?.custom_id||'');if(custom==='level:branch'){const branch=String(i.data?.values?.[0]||'');const r=levelEngine.changeBranch(id,branch);if(r.ok)queueLevelSync(id);await interactionRespond(i,4,{flags:64,content:r.ok?`Teilstreitkraft: ${branch}. Deine XP bleiben erhalten.`:`Wechsel noch ${Math.ceil(r.remaining/86400000)} Tage gesperrt.`});return true;}
 if(custom==='level:share'){const lastShare=levelEngine.state.shares[id]||0;const remaining=lastShare?Math.max(0,levelEngine.config.shareCooldownMs-(Date.now()-lastShare)):0;if(remaining){await interactionRespond(i,4,{flags:64,content:`Du kannst dein Profil in ${Math.ceil(remaining/3600000)} Stunden erneut teilen.`});return true;}const channel=levelEngine.config.channels?.rangprofile;if(!channel){await interactionRespond(i,4,{flags:64,content:'Profilkanal wurde noch nicht konfiguriert.'});return true;}try{await discordApi(`/channels/${channel}/messages`,'POST',{content:`<@${id}>\n${levelText(id)}`,allowed_mentions:{parse:[]}});levelEngine.state.shares[id]=Date.now();levelEngine.saveState();await interactionRespond(i,4,{flags:64,content:'Dein Profil wurde geteilt.'});}catch(err){await interactionRespond(i,4,{flags:64,content:'Veröffentlichung fehlgeschlagen.'});}return true;}
 return false;}
async function levelSyncRoles(userId){
 if(!levelActive())return;
 const cfg=levelEngine.config,profile=levelEngine.profile(userId);
 const activeRank=cfg.ranks.find(r=>r.id===profile.level);
 const selected=[cfg.roleIds?.[profile.branch],activeRank?.roleIds?.[profile.branch]].filter(Boolean).map(String);
 const managed=new Set([...Object.values(cfg.roleIds||{}),...cfg.ranks.flatMap(r=>Object.values(r.roleIds||{}))].filter(Boolean).map(String));
 if(!managed.size)return;
 const member=await discordApi(`/guilds/${IDS.guild}/members/${userId}`);
 const current=new Set((member.roles||[]).map(String));
 for(const rid of managed){const role=roleById(rid);if(!role||role.managed||Number(role.position)>=botHighestRolePosition())continue;
 const wanted=selected.includes(rid);if(current.has(rid)&&!wanted)await discordApi(`/guilds/${IDS.guild}/members/${userId}/roles/${rid}`,'DELETE');
 if(wanted&&!current.has(rid))await discordApi(`/guilds/${IDS.guild}/members/${userId}/roles/${rid}`,'PUT');}
}
function queueLevelSync(id){if(id)levelSyncRoles(id).catch(err=>warn('Level-Rollensynchronisierung:',err.message));}
async function ensureAdminCommand(){
  const base=`/applications/${process.env.DISCORD_CLIENT_ID}/guilds/${IDS.guild}/commands`;
  const current=await discordApi(base);
  const cmd={name:"admin",type:1,description:"Persönlicher Zugang zum Bot Control Center"};
  const found=(current||[]).find(x=>x.name===cmd.name&&Number(x.type)===1);
  if(!found)await discordApi(base,"POST",cmd);
  else if(found.description!==cmd.description)await discordApi(`${base}/${found.id}`,"PATCH",cmd);
}
async function adminInteraction(i){
  if(Number(i?.type)!==2 || i.guild_id!==IDS.guild || i.data?.name!=="admin")return false;
  const userId=String(i.member?.user?.id||i.user?.id||"");
  if(!/^\d{15,22}$/.test(userId)){
    await interactionRespond(i,4,{flags:64,content:"🔒 Discord-Identität konnte nicht bestätigt werden."});return true;
  }
  // Defer within Discord's response deadline; database lookup may take time.
  await interactionRespond(i,5,{flags:64});
  let content="⚠️ Der Gefechtsstand ist vorübergehend nicht erreichbar. Bitte versuche es später erneut.";
  try{
    if(INTERNAL_SERVICE_SECRET.length<32)throw Error("Interner Dienst nicht konfiguriert");
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);
    try{
      const response=await fetch(`${CONTROL_CENTER_URL}/internal/discord/admin-access`,{
        method:"POST",signal:controller.signal,
        headers:{"Content-Type":"application/json","X-BWK-Service-Secret":INTERNAL_SERVICE_SECRET},
        body:JSON.stringify({discordUserId:userId})
      });
      if(!response.ok)throw Error(`Zugriffsprüfung HTTP ${response.status}`);
      const data=await response.json();
      if(data.ok!==true)throw Error("Ungültige Zugriffsprüfung");
      if(data.allowed===true && typeof data.url==="string" && data.url.startsWith("https://"))
        content=`${discordTexts().accessGrantedMessage}\nDeine Control-Center-Freigabe ist aktiv. Melde Dich über Discord an:\n${data.url}\n\nDeine Berechtigungen werden beim Anmelden erneut geprüft.`;
      else if(data.allowed===false)content=`🔒 **Keine Control-Center-Freigabe**\nFür Deinen Discord-Account ist derzeit kein Zugang freigeschaltet. Wende Dich bei Bedarf an die ${RT("moderator")}.`;
    }finally{clearTimeout(timer);}
  }catch(error){warn("/admin: Zugriffskontrolle vorübergehend nicht erreichbar:",error.message);}
  try{await discordApi(`/webhooks/${process.env.DISCORD_CLIENT_ID}/${i.token}/messages/@original`,"PATCH",{content,allowed_mentions:{parse:[]}});}
  catch(e){warn("/admin: Antwort fehlgeschlagen:",e.message);}
  return true;
}

// Role-scoped central word-filter administration. No Control Center login grants write access.
const {validateAddTerm,makeAddTerm,categorySuggestions,wordAddLogMessage}=require("/shared/discord-word-add");
function wordFilterEditor(i){
  if(String(i.guild_id||"")!==String(IDS.guild))return false;
  const roles=(i.member?.roles||[]).map(String);
  return [IDS.roles.administrator,IDS.roles.moderator].filter(Boolean).some(id=>roles.includes(String(id)));
}
const addOption=(i,name)=>i.data?.options?.find(x=>x.name===name)?.value;
const modalValue=(i,name)=>i.data?.components?.flatMap(row=>row.components||[]).find(x=>x.custom_id===name)?.value;
async function ensureWordAddCommand(){
  const base=`/applications/${process.env.DISCORD_CLIENT_ID}/guilds/${IDS.guild}/commands`;
  const cmd={name:"add",type:1,description:`Begriff in den zentralen Wortfilter aufnehmen (${RL("administrator")}/${RL("moderator")})`,options:[
    {type:3,name:"wort",description:"Begriff oder Phrase",required:false,max_length:100},
    {type:3,name:"kategorie",description:"Kategorie aus zentralem Wortfilter wählen",required:false,autocomplete:true,max_length:100},
    {type:4,name:"schweregrad",description:"Grad 1 bis 5",required:false,min_value:1,max_value:5},
    {type:3,name:"plattform",description:"Wo wird geprüft?",required:false,choices:[{name:"Discord",value:"discord"},{name:"Twitch",value:"twitch"},{name:"Beide",value:"both"}]}
  ]};
  const existing=await discordApi(base);
  const found=(existing||[]).find(x=>x.name===cmd.name&&Number(x.type)===1);
  if(found)await discordApi(`${base}/${found.id}`,"PATCH",cmd);
  else await discordApi(base,"POST",cmd);
}
async function wordAddInteraction(i){
  const slash=Number(i?.type)===2&&i.data?.name==="add";
  const modal=Number(i?.type)===5&&i.data?.custom_id==="wfadd:modal";
  const autocomplete=Number(i?.type)===4&&i.data?.name==="add";
  if(!slash&&!modal&&!autocomplete)return false;
  // 9.6.0: Modul „Wortfilter“ aus → /add nimmt keine Begriffe an (Bestand bleibt unverändert).
  if(!moduleState.isOn("wordFilter")){if(autocomplete){await interactionRespond(i,8,{choices:[]});return true;}await interactionRespond(i,4,{flags:64,content:"⏸️ Der Wortfilter ist derzeit deaktiviert."});return true;}
  if(!wordFilterEditor(i)){
    await interactionRespond(i,autocomplete?8:4,autocomplete?{choices:[]}:{flags:64,content:`🔒 Nur ${roleBoth("administrator")} und ${roleBoth("moderator")} dürfen den Wortfilter ergänzen.`});return true;
  }
  if(autocomplete){
    const focused=(i.data?.options||[]).find(x=>x.name==="kategorie"&&x.focused===true);
    let choices=[];
    if(focused){try{if(pgStore.enabled)choices=categorySuggestions(pgStore.wordFilterSnapshot().categories,focused.value);}catch(error){warn("Wortfilter Kategorien-Autocomplete:",error.message);}}
    await interactionRespond(i,8,{choices});return true;
  }
  if(slash&&!String(addOption(i,"wort")||"").trim()){
    await interactionRespond(i,9,{custom_id:"wfadd:modal",title:"Wortfilter · Begriff hinzufügen",components:[
      {type:1,components:[{type:4,custom_id:"wort",label:"Begriff oder Phrase",style:1,required:true,min_length:2,max_length:100}]},
      {type:1,components:[{type:4,custom_id:"kategorie",label:"Kategorie-ID (z. B. beleidigung)",style:1,required:true,max_length:60}]},
      {type:1,components:[{type:4,custom_id:"schweregrad",label:"Schweregrad von 1 bis 5",style:1,required:true,min_length:1,max_length:1,value:"3"}]},
      {type:1,components:[{type:4,custom_id:"plattform",label:"discord / twitch / both",style:1,required:true,value:"discord"}]}
    ]});return true;
  }
  await interactionRespond(i,5,{flags:64});
  try{
    if(!pgStore.enabled)throw Error("PostgreSQL ist nicht erreichbar.");
    const input={word:modal?modalValue(i,"wort"):addOption(i,"wort"),category:modal?modalValue(i,"kategorie"):addOption(i,"kategorie"),severity:modal?modalValue(i,"schweregrad"):addOption(i,"schweregrad"),platform:modal?modalValue(i,"plattform"):addOption(i,"plattform")};
    const snapshot=pgStore.wordFilterSnapshot();
    const valid=validateAddTerm(input,snapshot);
    const userId=String(i.member?.user?.id||i.user?.id||"");
    const existing=(snapshot.terms||[]).find(t=>String(t.term||"").normalize("NFKC").toLocaleLowerCase("de-DE")===valid.word.normalize("NFKC").toLocaleLowerCase("de-DE")&&String(t.detection_type)==="whole_word"&&(t.platforms||[]).some(x=>x.enabled&&valid.platforms.includes(x.platform)));
    if(existing)throw Error("Der Begriff ist für die gewählte Plattform bereits vorhanden. Bitte im Control Center bearbeiten.");
    const term=makeAddTerm(valid,userId);
    pgStore.upsertWordFilterTerm(term);wordFilterRefresh(true);
    warn("Wortfilter /add:",{actorDiscordId:userId,termId:term.term_id,category:term.category_id,severity:term.severity,platforms:valid.platforms});
    // A failed audit notification must not roll back an already committed word-filter change.
    const categoryName=snapshot.categories.find(c=>c.category_id===valid.category)?.name||valid.category;
    const logChannelId=IDS.channels.log||discordLogConfig.defaultChannelId;
    if(logChannelId){
      try{await sendChannelMessage(logChannelId,wordAddLogMessage(term,userId,categoryName),userId);}
      catch(logError){warn("Wortfilter /add #log fehlgeschlagen:",logError.message);}
    }else warn("Wortfilter /add: kein #log-Kanal konfiguriert.");
    await editInteractionOriginal(i,{content:`✅ **Begriff aufgenommen:** ${term.term.replace(/[`*_~|<>@]/g,"")}\nKategorie: **${valid.category}** · Grad **${valid.severity}** · Plattform: **${valid.platforms.join(" + ")}**\nLeetspeak: **AN** · Erkennung: ganzes Wort.\nEintrag wurde im zentralen Wortfilter gespeichert.`,allowed_mentions:{parse:[]}});
  }catch(error){warn("Wortfilter /add fehlgeschlagen:",error.message);await editInteractionOriginal(i,{content:`⚠️ Kein Eintrag angelegt: ${String(error.message).slice(0,240)}`,allowed_mentions:{parse:[]}}).catch(()=>{});}
  return true;
}

async function ensureLevelCommands(){
 if(!levelActive())return;
 const base=`/applications/${process.env.DISCORD_CLIENT_ID}/guilds/${IDS.guild}/commands`;
 const existing=await discordApi(base);
 const desired=[
  ['rang','Dein privates Rangprofil'],
  ['toprang','Top 10 des Community-Spiels'],
  ['rangliste','Deine Nachbarn in der Rangliste'],
  ...(LV().branches?[['teilstreitkraft','Teilstreitkraft auswählen']]:[]),
  ['dailyxp',LV().dailyDesc]
 ].map(([name,description])=>({name,description,type:1}));
 desired.push({name:LV().missionCmd,description:LV().missionDesc,type:1,options:[
  {type:1,name:'starten',description:LV().missionStartDesc},
  {type:1,name:'status',description:LV().missionStatusDesc},
  {type:1,name:'statistik',description:LV().missionStatsDesc},
  {type:1,name:'abholen',description:LV().missionClaimDesc}
 ]});
 for(const command of desired){
  const found=existing.find(x=>x.name===command.name&&x.type===1);
  const same=found&&found.description===command.description&&
    JSON.stringify((found.options||[]).map(x=>({type:x.type,name:x.name,description:x.description})))===
    JSON.stringify((command.options||[]).map(x=>({type:x.type,name:x.name,description:x.description})));
  if(same)continue; // Ohne inhaltliche Änderung keine PATCH-Anfrage an Discord senden.
  await discordApi(found?`${base}/${found.id}`:base,found?'PATCH':'POST',command);
 }
}


// Version 8.1: Installierbarer Discord-Minigame-Kanalassistent.
const LEVEL_CHANNEL_KEYS=['regeln','topliste','befoerderungen','rangprofile'];
const LEVEL_OLD_NAMES={regeln:'regeln',topliste:'topliste',befoerderungen:'befoerderungen',rangprofile:'rangprofile'};
const levelDesiredNames=()=>({...require('./levelsystem').DEFAULT_LEVEL_NAMES,...levelEngine.config.channelNames});
// Die Live-Abfrage vermeidet widersprüchliche Statusanzeigen durch einen veralteten Gateway-Cache.
async function levelSetupPreview(channelsSnapshot){
 const all=channelsSnapshot||await discordApi(`/guilds/${IDS.guild}/channels`);
 const names=levelDesiredNames(),saved=levelEngine.config.channels||{};
 // Gespeicherte Kategorie zuerst, dann aktueller Name, zuletzt Legacy-Name (Migration 8.1.8).
 const category=all.find(c=>Number(c.type)===4&&String(c.id)===String(saved.category||''))
  ||all.find(c=>Number(c.type)===4&&String(c.name)===names.category)
  ||all.find(c=>Number(c.type)===4&&String(c.name||'').trim().toLocaleLowerCase('de-DE')==='minigame');
 const channels=Object.fromEntries(LEVEL_CHANNEL_KEYS.map(key=>{
  if(!category)return [key,null];
  const inCategory=all.filter(c=>Number(c.type)===0&&String(c.parent_id)===String(category.id));
  const existing=inCategory.find(c=>String(c.id)===String(saved[key]||''))
   ||inCategory.find(c=>c.name===names[key])
   ||inCategory.find(c=>c.name===LEVEL_OLD_NAMES[key]);
  return [key,existing?.id||null];
 }));
 return {category:category?.id||null,channels,names,permissionModel:'@everyone: View Channel verweigert; '+RL('member')+': Lesezugriff; Bot und '+RL('moderator')+': Lese-/Schreibzugriff.'};
}
// Berechtigungen an der Kategorie zentral verwalten, Kanäle exakt synchronisieren.
// Damit werden vorhandene, im Kanal abweichende Overwrites bewusst angeglichen.
function levelPermissionOverwrites(category){
 const everyone=String(IDS.guild),bot=String(IDS.roles.bot||''),ovwa=String(IDS.roles.moderator||''),rekrut=String(onboardingConfig.unlockRoleId||IDS.roles.member||'');
 if(!bot||!ovwa||!rekrut)throw Error('Bot-, '+RL('moderator')+'- oder Freischaltrollen-ID ('+RL('member')+') fehlt in der Discord-Konfiguration.');
 const write=PERM.SEND_MESSAGES|PERM.SEND_MESSAGES_IN_THREADS|PERM.CREATE_PUBLIC_THREADS|PERM.CREATE_PRIVATE_THREADS;
 const read=PERM.VIEW_CHANNEL|PERM.READ_MESSAGE_HISTORY;
 const entries=new Map((category.permission_overwrites||[]).map(o=>[`${Number(o.type)}:${o.id}`,{id:String(o.id),type:Number(o.type),allow:String(o.allow||'0'),deny:String(o.deny||'0')}]));
 const put=(id,type,allowed,denied)=>{
  const key=`${type}:${id}`,old=entries.get(key)||{id,type,allow:'0',deny:'0'};
  let allow=BigInt(old.allow),deny=BigInt(old.deny);
  allow=(allow|allowed)&~denied;deny=(deny|denied)&~allowed;
  entries.set(key,{id,type,allow:String(allow),deny:String(deny)});
 };
 // Vorhandene Fremdrollen dürfen keine Ausnahme von der Schreibsperre erzeugen.
 for(const e of entries.values()){
  if(e.type===0&&e.id!==bot&&e.id!==ovwa&&e.id!==rekrut){
   let allow=BigInt(e.allow),deny=BigInt(e.deny);
   allow&=~(write|PERM.VIEW_CHANNEL);deny|=write;e.allow=String(allow);e.deny=String(deny);
  }
 }
 put(everyone,0,0n,write|PERM.VIEW_CHANNEL);
 // Sichtbarkeit nur für Mitglieder, die die vorhandene Discord-Freischaltung abgeschlossen haben.
 put(rekrut,0,read,write);
 // Identische, explizite Bot- und Moderator-Rechte auf allen Kanälen.
 put(bot,0,read|write|PERM.EMBED_LINKS|PERM.ATTACH_FILES,0n);
 put(ovwa,0,read|write|PERM.EMBED_LINKS|PERM.ATTACH_FILES,0n);
 return [...entries.values()];
}
async function levelSetupChannels(){
 const all=await discordApi(`/guilds/${IDS.guild}/channels`);
 const preview=await levelSetupPreview(all),names=levelDesiredNames();
 let category=preview.category&&all.find(c=>String(c.id)===String(preview.category));
 if(!category)category=await discordApi(`/guilds/${IDS.guild}/channels`,'POST',{name:names.category,type:4});
 const overwrites=levelPermissionOverwrites(category);
 try{
  category=await discordApi(`/channels/${category.id}`,'PATCH',{name:names.category,permission_overwrites:overwrites});
 }catch(err){if(err.status===403)throw Error(`Kategorie ${names.category}: Discord verweigert Namens- oder Berechtigungsänderung (50013). Bot benötigt „Kanäle verwalten“.`);throw err;}
 const managed={...levelEngine.config.channels,category:category.id};
 for(const key of LEVEL_CHANNEL_KEYS){
  const name=names[key];
  let channel=all.find(c=>String(c.id)===String(preview.channels[key])&&Number(c.type)===0&&String(c.parent_id)===String(category.id));
  try{
   if(!channel)channel=await discordApi(`/guilds/${IDS.guild}/channels`,'POST',{name,type:0,parent_id:category.id,permission_overwrites:overwrites});
   else channel=await discordApi(`/channels/${channel.id}`,'PATCH',{name,parent_id:category.id,permission_overwrites:overwrites});
  }catch(err){if(err.status===403)throw Error(`Kanal ${name}: Discord verweigert Umbenennung oder Berechtigungssynchronisierung (50013). Bot benötigt „Kanäle verwalten“.`);throw err;}
  managed[key]=channel.id;
 }
 levelEngine.configure({channels:managed});
 return levelSetupPreview();
}
function levelRulesText(){const c=levelEngine.config;return `${c.rulesIntro||discordTexts().levelRulesIntro}\n\n**XP-Regeln**\n• Qualifizierte Nachricht: +${c.chatXp} XP (alle ${Math.ceil(c.chatCooldownMs/1000)} Sekunden)\n• Bildnachricht in <#${c.memeChannelId||'0'}>: +${c.memeXp} XP (alle ${Math.ceil(c.memeCooldownMs/60000)} Minuten, unabhängig von der Bildanzahl)\n• Gelöschte Nachrichten: ${c.reverseDeleted?'XP werden zurückgenommen':'XP-Rücknahme deaktiviert'}\n\n${c.rulesOutro||discordTexts().levelRulesOutro}`;}
async function levelUpsertMessage(channelKey,content,idKey){
 const channel=levelEngine.config.channels?.[channelKey];if(!channel)return {skipped:true};
 const safe=String(content).slice(0,1950);const lastId=levelEngine.state.messages?.[idKey];let msg;
 if(lastId){try{msg=await discordApi(`/channels/${channel}/messages/${lastId}`,'PATCH',{content:safe,allowed_mentions:{parse:[]}});}catch(e){if(e.status!==404)throw e;}}
 if(!msg){try{msg=await discordApi(`/channels/${channel}/messages`,'POST',{content:safe,allowed_mentions:{parse:[]}});}catch(err){if(err.status===403)throw new Error(`Bot darf nicht in #${channelKey} schreiben (Discord 50013). Prüfe „Kanal ansehen“, „Nachrichten senden“ und gegebenenfalls „Nachrichtenverlauf lesen“. Falls der Kanal für @everyone gesperrt ist, benötigt der Bot eine ausdrückliche Erlaubnis.`);throw err;}}
 levelEngine.state.messages={...(levelEngine.state.messages||{}),[idKey]:msg.id};levelEngine.saveState();return {id:msg.id};
}
const levelRulesSignature=()=>require('node:crypto').createHash('sha256').update(levelRulesText()+JSON.stringify(levelEngine.config.ranks)).digest('hex');
function levelRulesArePublished(){return Boolean(levelEngine.state.messages?.regeln&&levelEngine.state.rulesSignature===levelRulesSignature()&&levelEngine.state.rulesChannelId===levelEngine.config.channels?.regeln);}
async function levelPublishRules(){const result=await levelUpsertMessage('regeln',levelRulesText(),'regeln');if(!result?.id)throw Error('Regeln konnten nicht veröffentlicht werden.');levelEngine.state.rulesSignature=levelRulesSignature();levelEngine.state.rulesChannelId=levelEngine.config.channels?.regeln;levelEngine.saveState();return result;}
const levelTopSignature=()=>require('node:crypto').createHash('sha256').update(JSON.stringify({channel:levelEngine.config.channels?.topliste||null,count:Math.min(25,Math.max(1,Number(levelEngine.config.topCount||25))),top:levelEngine.leaderboard().slice(0,Math.min(25,Math.max(1,Number(levelEngine.config.topCount||25))))})).digest('hex');
async function levelPublishTop(){
 const top=levelEngine.leaderboard().slice(0,Math.min(25,Math.max(1,Number(levelEngine.config.topCount||25))));
 const result=await levelUpsertMessage('topliste',`🏆 **Top ${top.length} – Community-Minigame**\n\n${top.map((u,i)=>`${i+1}. <@${u.id}> — ${u.xp} XP`).join('\n')||'Noch keine Teilnehmer.'}\n\nAktualisiert: ${new Date().toLocaleString('de-DE',{timeZone:'Europe/Berlin'})}`,'topliste');
 if(result?.id){levelEngine.state.topSignature=levelTopSignature();levelEngine.state.topChannelId=levelEngine.config.channels.topliste;levelEngine.saveState();}
 return result;
}
let levelTopRunning=false;
async function levelPeriodicTop(){
 if(!levelActive()||levelTopRunning||!levelEngine.config.channels?.topliste)return;
 levelTopRunning=true;
 try{
  const signature=levelTopSignature(),channel=levelEngine.config.channels.topliste,id=levelEngine.state.messages?.topliste;
  let missing=!id;
  if(!missing&&levelEngine.state.topSignature===signature&&levelEngine.state.topChannelId===channel){
   try{await discordApi(`/channels/${channel}/messages/${id}`);}catch(err){if(err.status===404)missing=true;else throw err;}
  }
  if(missing||levelEngine.state.topSignature!==signature||levelEngine.state.topChannelId!==channel)await levelPublishTop();
 }catch(err){warn('Minigame Topliste (Stundenprüfung):',err.message);}finally{levelTopRunning=false;}
}
// Stundenwechsel in UTC entsprechen auch in Deutschland jeder vollen lokalen Stunde.
// Nach Neustarts wird beim nächsten Bot-READY nachgeholt; kein driftender 60-Minuten-Zähler.
let levelTopTimer=null;
function scheduleLevelTop(){
 if(levelTopTimer)clearTimeout(levelTopTimer);
 const delay=3600000-(Date.now()%3600000)+250;
 levelTopTimer=setTimeout(async()=>{try{await levelPeriodicTop();}finally{scheduleLevelTop();}},delay);
 levelTopTimer.unref?.();
}
scheduleLevelTop();
function roleById(id) { return state.cache.roles.find(r => r.id === id) || null; }
function channelById(id) { return state.cache.channels.find(c => c.id === id) || null; }
function memberDisplay(member) { return member?.nick || member?.user?.global_name || member?.user?.username || member?.user?.id || "Unbekannt"; }


function botHighestRolePosition() {
  const botRole=roleById(IDS.roles.bot);
  return Number(botRole?.position ?? -1);
}
function discordRoleManageability(role) {
  const allowedIds=new Set([IDS.roles.administrator, IDS.roles.member]);
  const botPos=botHighestRolePosition();
  if (!role) return {manageable:false,reason:"Rolle nicht gefunden"};
  if (!allowedIds.has(role.id)) return {manageable:false,reason:"Diese Rolle ist für die Verwaltung im Control Center gesperrt"};
  if (role.managed) return {manageable:false,reason:"Von Discord/Integration verwaltete Rolle"};
  if (role.id===IDS.guild) return {manageable:false,reason:"@everyone kann nicht zugewiesen werden"};
  if (botPos<0 || Number(role.position)>=botPos) return {manageable:false,reason:"Rolle steht nicht unterhalb der Bot-Rolle"};
  return {manageable:true,reason:null};
}
function memberSummary(member) {
  const roles=(member?.roles||[]).map(id=>roleById(id)).filter(Boolean).sort((a,b)=>Number(b.position)-Number(a.position));
  return {
    id:member?.user?.id||null,
    username:member?.user?.username||null,
    globalName:member?.user?.global_name||null,
    displayName:memberDisplay(member),
    nick:member?.nick||null,
    avatar:member?.avatar||member?.user?.avatar||null,
    userAvatar:member?.user?.avatar||null,
    guildAvatar:member?.avatar||null,
    bot:!!member?.user?.bot,
    joinedAt:member?.joined_at||null,
    pending:member?.pending===true,
    onboarding:(()=>{
      const entry=onboardingState.members[member?.user?.id]||null;
      return entry?{
        gated:isGatedMembership(member,entry),
        verified:!!entry.verifiedAt,
        verifiedAt:entry.verifiedAt||null,
        welcomedAt:entry.welcomedAt||null,
        leftAt:entry.leftAt||null,
        lastError:entry.lastError||null
      }:{gated:false,verified:false,verifiedAt:null,welcomedAt:null,leftAt:null,lastError:null};
    })(),
    roles:roles.map(r=>({id:r.id,name:r.name,position:r.position,managed:!!r.managed,color:r.color,...discordRoleManageability(r)}))
  };
}
function discordRoleCatalog() {
  return state.cache.roles.filter(r=>r.id!==IDS.guild).sort((a,b)=>Number(b.position)-Number(a.position)).map(r=>({id:r.id,name:r.name,position:r.position,color:r.color,managed:!!r.managed,...discordRoleManageability(r)}));
}
async function searchDiscordMembers(query="", limit=50) {
  const q=String(query||"").trim();
  const safeLimit=Math.max(1,Math.min(100,Number(limit)||50));
  let members=[];
  if (/^\d{15,22}$/.test(q)) {
    try { members=[await discordFetch(`/guilds/${IDS.guild}/members/${q}`)]; }
    catch(err) { if (String(err.message).includes("404")) members=[]; else throw err; }
  } else if (q) {
    members=await discordFetch(`/guilds/${IDS.guild}/members/search?query=${encodeURIComponent(q)}&limit=${safeLimit}`);
  } else {
    members=await discordFetch(`/guilds/${IDS.guild}/members?limit=${safeLimit}`);
  }
  return {query:q,members:(members||[]).map(memberSummary),roles:discordRoleCatalog()};
}
async function changeDiscordMemberRole(userId, roleId, action) {
  const uid=cleanId(userId,null), rid=cleanId(roleId,null);
  if(!uid||!rid) throw new Error("Ungültige Mitglieds- oder Rollen-ID.");
  if(!["add","remove"].includes(action)) throw new Error("Ungültige Rollenaktion.");
  const role=roleById(rid);
  const access=discordRoleManageability(role);
  if(!access.manageable) throw new Error(access.reason||"Diese Rolle kann nicht verwaltet werden.");
  const member=await discordFetch(`/guilds/${IDS.guild}/members/${uid}`);
  if(member?.user?.bot) throw new Error("Bot-Mitglieder werden über diese Oberfläche nicht verändert.");
  const before=Array.isArray(member.roles)&&member.roles.includes(rid);

  if (rid===onboardingConfig.unlockRoleId && action==="add") {
    const entry=onboardingEntry(member);
    const trustedStaff=(member.roles||[]).includes(IDS.roles.administrator)||(member.roles||[]).includes(IDS.roles.moderator);
    if (isGatedMembership(member,entry) && !entry.verifiedAt && !trustedStaff) {
      throw new Error(RL("member")+" kann bei einem noch nicht bestätigten Mitglied nicht manuell vergeben werden. Erst 👍 auf die Regelnachricht oder zuvor eine Vertrauensrolle S1/OVWA vergeben.");
    }
  }

  if(action==="add"&&!before) await discordApi(`/guilds/${IDS.guild}/members/${uid}/roles/${rid}`,"PUT");
  else if(action==="remove"&&before) await discordApi(`/guilds/${IDS.guild}/members/${uid}/roles/${rid}`,"DELETE");
  const verified=await discordFetch(`/guilds/${IDS.guild}/members/${uid}`);
  const after=Array.isArray(verified.roles)&&verified.roles.includes(rid);
  if(action==="add"&&!after) throw new Error("Discord bestätigte die Rollenvergabe nicht.");
  if(action==="remove"&&after) throw new Error("Discord bestätigte das Entfernen der Rolle nicht.");
  await sendDiscordLogEvent("onboarding.role_changed",{user:memberDisplay(verified),userId:uid,role:role.name,action:action==="add"?"vergeben":"entfernt"});
  return {member:memberSummary(verified),role:{id:role.id,name:role.name},action,changed:before!==after};
}

function sameMembershipJoin(a,b){
  if(!a||!b)return true;
  const ta=Date.parse(a),tb=Date.parse(b);
  if(Number.isFinite(ta)&&Number.isFinite(tb))return Math.abs(ta-tb)<1000;
  return String(a)===String(b);
}
function onboardingEntry(member) {
  const id=member?.user?.id;
  if(!id)return null;
  const joinedAt=member.joined_at||null;
  let entry=onboardingState.members[id];

  if(!entry){
    entry={joinedAt,firstSeenAt:now(),welcomedAt:null,verifiedAt:null,leftAt:null};
    onboardingState.members[id]=entry;
  }else if(joinedAt&&entry.joinedAt&&!sameMembershipJoin(joinedAt,entry.joinedAt)){
    // Echte neue Mitgliedschaft / Rejoin: alte Bestätigung darf nicht übernommen werden.
    entry={joinedAt,firstSeenAt:now(),welcomedAt:null,verifiedAt:null,leftAt:null};
    onboardingState.members[id]=entry;
  }else{
    // WICHTIG: bestehendes Objekt in-place aktualisieren. Ein laufender Reaction-Handler
    // behält dadurch dieselbe Referenz und kann nicht mehr von GUILD_MEMBER_UPDATE
    // "überholt" werden.
    if(joinedAt&&!entry.joinedAt)entry.joinedAt=joinedAt;
    entry.leftAt=null;
  }
  return entry;
}
function isGatedMembership(member, entry) {
  if (!onboardingConfig.enabled || !onboardingConfig.activatedAt) return false;
  const joinedAt = member?.joined_at || entry?.joinedAt;
  if (!joinedAt) return false;
  return new Date(joinedAt).getTime() >= new Date(onboardingConfig.activatedAt).getTime();
}
function renderWelcomeMessage(template, member) {
  return String(template || DEFAULT_ONBOARDING_CONFIG.welcomeMessage)
    .replaceAll("{mention}", `<@${member.user.id}>`)
    .replaceAll("{user}", memberDisplay(member))
    .replaceAll("{rules}", `<#${onboardingConfig.rulesChannelId}>`);
}
async function sendChannelMessage(channelId, content, allowedUserId=null) {
  const body = {content, allowed_mentions: allowedUserId ? {parse:[],users:[allowedUserId],roles:[],replied_user:false} : {parse:[],users:[],roles:[],replied_user:false}};
  return discordApi(`/channels/${channelId}/messages`, "POST", body);
}

async function sendDiscordLogEvent(eventKey,data={},options={}){
  const event=discordLogConfig.events?.[eventKey];
  if(!event)return {sent:false,reason:"unknown_event"};
  if(!options.force&&(!discordLogConfig.enabled||!event.enabled))return {sent:false,reason:"disabled"};
  const channelId=event.channelId||discordLogConfig.defaultChannelId||IDS.channels.log;
  if(!channelId)return {sent:false,reason:"no_channel"};
  const payload={timestamp:now(),...data};
  const text=renderDiscordLogTemplate(event.template,payload)+(options.append||"");
  if(!text.trim())return {sent:false,reason:"empty"};
  try{
    const msg=await sendChannelMessage(channelId,text,null);
    return {sent:true,channelId,messageId:msg?.id||null};
  }catch(err){
    warn(`⚠️ Discord-Log ${eventKey} fehlgeschlagen:`,err.message);
    if(options.throwOnError)throw err;
    return {sent:false,error:err.message};
  }
}
function discordLogsView(){
  const channels=state.cache.channels.filter(c=>[0,5].includes(Number(c.type))).sort((a,b)=>Number(a.position)-Number(b.position)).map(c=>({id:c.id,name:c.name,parentId:c.parent_id||null}));
  return {
    ok:true,config:clone(discordLogConfig),categories:DISCORD_LOG_CATEGORIES,catalog:{channels},
    legacy:{
      moderation:{logChannelId:moderationConfig.logChannelId,logEnabled:moderationConfig.logEnabled},
      onboarding:{logChannelId:onboardingConfig.logChannelId,logEnabled:onboardingConfig.logEnabled},
      reports:{logChannelId:reportsConfig.logChannelId},
      channelTimes:{logChannelId:channelTimesConfig.logChannelId,logEnabled:channelTimesConfig.logEnabled}
    }
  };
}
function updateDiscordLogConfig(raw={}){
  const next=normalizeDiscordLogConfig(raw);
  if(!next.defaultChannelId||!channelById(next.defaultChannelId))throw new Error("Ein gültiger Standard-Logkanal muss ausgewählt sein.");
  for(const [key,event] of Object.entries(next.events||{})){
    if(event.channelId&&!channelById(event.channelId))throw new Error(`${event.label||key}: ausgewählter Zielkanal wurde nicht gefunden.`);
    if(!String(event.template||"").trim())throw new Error(`${event.label||key}: Nachrichtentemplate darf nicht leer sein.`);
  }
  discordLogConfig=next;saveDiscordLogConfig();return discordLogsView();
}
function resetDiscordLogEvent(eventKey){
  const def=DEFAULT_DISCORD_LOG_CONFIG.events[eventKey];if(!def)throw new Error("Unbekanntes Log-Ereignis.");
  discordLogConfig.events[eventKey]={...def,variables:[...def.variables]};saveDiscordLogConfig();return discordLogsView();
}
function sampleDiscordLogData(eventKey){
  const base={timestamp:now(),user:"BwTestUser",userId:"123456789012345678",mention:"<@123456789012345678>",actor:"Mario",
    channel:"talk",channelMention:"<#123456789012345679>",rule:"Beispielregel",matched:"Beispiel",matchedPart:" · Treffer: `Beispiel`",
    actions:"Nachricht gelöscht, Hinweis gesendet",timeoutStage:"1",reason:"Testgrund",role:RT("member"),roleMention:`<@&${IDS.roles.member}>`,
    action:"vergeben",count:"3",messageId:"123456789012345678",error:"Beispiel-Fehler",detail:` · 1 ${RL("member")}-Rolle wiederhergestellt`,
    ticketId:"D-2026-0001",status:"Erledigt",targetMention:"<@123456789012345678>",targetUserId:"123456789012345678",
    reporter:"BwReporter",channelLine:"\nKanal: <#123456789012345679>",roles:RT("member"),source:"Test",
    level:"2",levelLabel:"Stufe 2 · Lockdown",duration:"30 Minuten",restored:"4"};
  return base;
}


const EMERGENCY_PROTECTED_CHANNEL_IDS=new Set([IDS.channels.rules,IDS.channels.welcome,IDS.channels.log,IDS.channels.stabsraum].filter(Boolean));
const EMERGENCY_TEXT_TYPES=new Set([0,5]);
const EMERGENCY_VOICE_TYPES=new Set([2,13]);

function emergencyLevelConfig(level=emergencyState.level){
  return emergencyConfig.levels?.[String(level)]||null;
}
function emergencyLevelLabel(level=emergencyState.level){
  return emergencyLevelConfig(level)?.label||`Stufe ${level||"?"}`;
}
function emergencyRecord(type,extra={}){
  emergencyState.history.push({at:now(),type,level:emergencyState.level,actor:emergencyState.actor,...extra});
  emergencyState.history=emergencyState.history.slice(-500);
  saveEmergencyState();
}
function emergencySnapshotKey(channelId,roleId){return `${channelId}:${roleId}`;}
function emergencyRoleSnapshot(channelId,roleId){
  return emergencyState.snapshots?.[emergencySnapshotKey(channelId,roleId)]||null;
}
function emergencyTextFlags(levelCfg){
  const flags=[PERM.SEND_MESSAGES,PERM.CREATE_PUBLIC_THREADS,PERM.CREATE_PRIVATE_THREADS,PERM.SEND_MESSAGES_IN_THREADS];
  if(levelCfg?.denyReactions)flags.push(PERM.ADD_REACTIONS);
  return flags;
}
function emergencyVoiceFlags(){return [PERM.CONNECT];}
function overwriteFromSnapshotWithDenies(snapshot,flags){
  let allow=BigInt(snapshot?.allow||"0"),deny=BigInt(snapshot?.deny||"0");
  for(const flag of flags){deny|=flag;allow&=~flag;}
  return {allow:allow.toString(),deny:deny.toString()};
}
function emergencyDurationLabel(endsAt){
  if(!endsAt)return "bis zur manuellen Beendigung";
  const ms=Date.parse(endsAt)-Date.now();
  if(ms<=0)return "abgelaufen";
  const mins=Math.ceil(ms/60000);
  return `${mins} Minute${mins===1?"":"n"}`;
}
function renderEmergencyMessage(template,data={}){
  const cfg=emergencyLevelConfig(data.level||emergencyState.level);
  return String(template||"")
    .replaceAll("{level}",String(data.level||emergencyState.level||""))
    .replaceAll("{levelLabel}",String(data.levelLabel||cfg?.label||"Notfallmodus"))
    .replaceAll("{reason}",String(data.reason||emergencyState.reason||"nicht angegeben"))
    .replaceAll("{actor}",String(data.actor||emergencyState.actor||"Control Center"))
    .replaceAll("{duration}",String(data.duration||emergencyDurationLabel(data.endsAt||emergencyState.endsAt)))
    .slice(0,1900);
}
function emergencyChannelCatalog(){
  return state.cache.channels
    .filter(c=>EMERGENCY_TEXT_TYPES.has(Number(c.type))||EMERGENCY_VOICE_TYPES.has(Number(c.type)))
    .map(c=>({
      id:c.id,name:c.name,type:Number(c.type),
      kind:EMERGENCY_TEXT_TYPES.has(Number(c.type))?"text":"voice",
      parentId:c.parent_id||null,parentName:channelById(c.parent_id)?.name||null,
      protected:EMERGENCY_PROTECTED_CHANNEL_IDS.has(c.id)
    }))
    .sort((a,b)=>(a.parentName||"").localeCompare(b.parentName||"")||a.name.localeCompare(b.name));
}
function validateEmergencyConfig(raw={}){
  const next=normalizeEmergencyConfig(raw);
  const catalog=new Map(emergencyChannelCatalog().map(x=>[x.id,x]));
  if(next.noticeChannelId){
    const notice=catalog.get(next.noticeChannelId);
    if(!notice||notice.kind!=="text")throw new Error("Der Hinweis-Kanal muss ein vorhandener Textkanal sein.");
  }
  for(const level of["1","2","3"]){
    const cfg=next.levels[level];
    for(const id of cfg.textChannelIds){
      const ch=catalog.get(id);
      if(!ch||ch.kind!=="text")throw new Error(`${cfg.label}: Textkanal ${id} wurde nicht gefunden.`);
      if(ch.protected)throw new Error(`${cfg.label}: #${ch.name} ist geschützt und darf nicht durch den Notfallmodus gesperrt werden.`);
    }
    for(const id of cfg.voiceChannelIds){
      const ch=catalog.get(id);
      if(!ch||ch.kind!=="voice")throw new Error(`${cfg.label}: Sprachkanal ${id} wurde nicht gefunden.`);
      if(ch.protected)throw new Error(`${cfg.label}: ${ch.name} ist geschützt und darf nicht durch den Notfallmodus gesperrt werden.`);
    }
  }
  return next;
}
async function emergencyEnsureSnapshot(channel,roleId){
  const key=emergencySnapshotKey(channel.id,roleId);
  if(!emergencyState.snapshots[key])emergencyState.snapshots[key]=snapshotOverwrite(channel,roleId);
  return emergencyState.snapshots[key];
}
async function emergencyApplyChannel(channelId,kind,levelCfg){
  let channel=channelById(channelId);
  if(!channel){await verifyGuildConfiguration();channel=channelById(channelId);}
  if(!channel)throw new Error(`Kanal ${channelId} wurde nicht gefunden.`);
  if(EMERGENCY_PROTECTED_CHANNEL_IDS.has(channel.id))throw new Error(`#${channel.name} ist als Schutzkanal vom Notfallmodus ausgenommen.`);
  const roleId=IDS.roles.member;
  const snapshot=await emergencyEnsureSnapshot(channel,roleId);
  const flags=kind==="voice"?emergencyVoiceFlags():emergencyTextFlags(levelCfg);
  const desired=overwriteFromSnapshotWithDenies(snapshot,flags);
  await putRoleOverwrite(channel.id,roleId,desired.allow,desired.deny);
  return {channelId:channel.id,name:channel.name,kind};
}
async function emergencyRestoreChannel(channelId){
  const roleId=IDS.roles.member,key=emergencySnapshotKey(channelId,roleId),snapshot=emergencyState.snapshots[key];
  if(!snapshot)return false;
  await restoreRoleOverwrite(channelId,roleId,snapshot);
  delete emergencyState.snapshots[key];
  return true;
}
async function emergencyApplyLevel(level,{actor=null,reason=null,initial=false}={}){
  const cfg=emergencyLevelConfig(level);if(!cfg)throw new Error("Ungültige Notfallstufe.");
  if(emergencyRunning)throw new Error("Eine Notfallmodus-Aktion läuft bereits.");
  emergencyRunning=true;
  try{
    await verifyGuildConfiguration();
    const targetText=new Set(cfg.textChannelIds),targetVoice=new Set(cfg.voiceChannelIds);
    const oldAffected=new Set([...(emergencyState.affected?.text||[]),...(emergencyState.affected?.voice||[])]);
    const newAffected=new Set([...targetText,...targetVoice]);

    // Kanäle, die in der neuen Stufe nicht mehr betroffen sind, zuerst sauber wiederherstellen.
    for(const channelId of oldAffected){
      if(!newAffected.has(channelId))await emergencyRestoreChannel(channelId);
    }

    const appliedText=[],appliedVoice=[];
    for(const id of cfg.textChannelIds){await emergencyApplyChannel(id,"text",cfg);appliedText.push(id);}
    for(const id of cfg.voiceChannelIds){await emergencyApplyChannel(id,"voice",cfg);appliedVoice.push(id);}
    emergencyState.affected={text:appliedText,voice:appliedVoice};
    emergencyState.level=String(level);
    if(actor)emergencyState.actor=String(actor).slice(0,120);
    if(reason)emergencyState.reason=String(reason).slice(0,500);
    emergencyState.lastError=null;
    saveEmergencyState();
    await verifyGuildConfiguration();
    if(!initial){
      emergencyRecord("level_changed",{level:String(level),actor:emergencyState.actor,reason:emergencyState.reason});
      await sendDiscordLogEvent("emergency.level_changed",{level:String(level),levelLabel:cfg.label,reason:emergencyState.reason||"nicht angegeben",actor:emergencyState.actor||"Control Center"});
    }
    return true;
  }finally{emergencyRunning=false;}
}
async function activateEmergencyMode({level,reason,actor,durationMinutes=0}={}){
  if(channelTimesState.maintenance?.active)throw new Error("Wartungsmodus zuerst beenden, bevor der Notfallmodus aktiviert wird.");
  if(emergencyState.active)throw new Error("Der Notfallmodus ist bereits aktiv. Nutze Stufe ändern oder beende ihn zuerst.");
  const cfg=emergencyLevelConfig(level);if(!cfg)throw new Error("Ungültige Notfallstufe.");
  const cleanReason=String(reason||"").trim().slice(0,500);if(!cleanReason)throw new Error("Bitte einen Grund für den Notfallmodus angeben.");
  const duration=Math.max(0,Math.min(1440,Number(durationMinutes||0)));
  emergencyState={...DEFAULT_EMERGENCY_STATE,active:true,level:String(level),reason:cleanReason,actor:String(actor||"Control Center").slice(0,120),startedAt:now(),endsAt:duration?new Date(Date.now()+duration*60000).toISOString():null,snapshots:{},affected:{text:[],voice:[]},history:emergencyState.history||[]};
  saveEmergencyState();
  try{
    await emergencyApplyLevel(String(level),{actor:emergencyState.actor,reason:cleanReason,initial:true});
    emergencyRecord("activated",{level:String(level),actor:emergencyState.actor,reason:cleanReason,endsAt:emergencyState.endsAt});
    if(emergencyConfig.announceActivation&&emergencyConfig.noticeChannelId){
      await sendChannelMessage(emergencyConfig.noticeChannelId,renderEmergencyMessage(emergencyConfig.activationMessage,{level:String(level),reason:cleanReason,actor:emergencyState.actor,endsAt:emergencyState.endsAt}));
    }
    await sendDiscordLogEvent("emergency.activated",{level:String(level),levelLabel:cfg.label,reason:cleanReason,actor:emergencyState.actor,duration:emergencyDurationLabel(emergencyState.endsAt)});
    scheduleEmergencyCheck();
    return emergencyView();
  }catch(err){
    emergencyState.lastError=err.message;saveEmergencyState();
    try{await deactivateEmergencyMode({actor:"System",reason:"Rollback nach Aktivierungsfehler",announce:false,logEvent:false});}catch{}
    await sendDiscordLogEvent("emergency.error",{error:err.message,source:"activation"});
    throw err;
  }
}
async function changeEmergencyLevel({level,reason,actor}={}){
  if(!emergencyState.active)throw new Error("Der Notfallmodus ist nicht aktiv.");
  const previousLevel=emergencyState.level,previousReason=emergencyState.reason,previousActor=emergencyState.actor;
  const previousAffected=new Set([...(emergencyState.affected?.text||[]),...(emergencyState.affected?.voice||[])]);
  const cleanReason=String(reason||emergencyState.reason||"").trim().slice(0,500);
  try{
    await emergencyApplyLevel(String(level),{actor:String(actor||emergencyState.actor||"Control Center"),reason:cleanReason,initial:false});
    return emergencyView();
  }catch(err){
    // Best effort rollback: neu hinzugekommene Kanäle freigeben und die vorherige Stufe erneut erzwingen.
    try{
      const snapshotChannels=[...new Set(Object.keys(emergencyState.snapshots||{}).map(k=>k.split(":")[0]))];
      for(const channelId of snapshotChannels)if(!previousAffected.has(channelId))await emergencyRestoreChannel(channelId);
      emergencyState.level=previousLevel;emergencyState.reason=previousReason;emergencyState.actor=previousActor;saveEmergencyState();
      if(previousLevel)await emergencyApplyLevel(previousLevel,{actor:previousActor,reason:previousReason,initial:true});
    }catch(rollbackErr){
      emergencyState.lastError=`${err.message} · Rollback: ${rollbackErr.message}`;saveEmergencyState();
      await sendDiscordLogEvent("emergency.error",{error:emergencyState.lastError,source:"level-change-rollback"});
    }
    throw err;
  }
}
async function deactivateEmergencyMode({actor="Control Center",reason="manuell beendet",announce=true,logEvent=true}={}){
  if(!emergencyState.active&&!Object.keys(emergencyState.snapshots||{}).length)return emergencyView();
  if(emergencyRunning)throw new Error("Eine Notfallmodus-Aktion läuft bereits.");
  emergencyRunning=true;
  const restored=[];
  try{
    const channelIds=[...new Set(Object.keys(emergencyState.snapshots||{}).map(k=>k.split(":")[0]))];
    for(const channelId of channelIds){
      await emergencyRestoreChannel(channelId);restored.push(channelId);
    }
    const previous={...emergencyState};
    emergencyState.active=false;emergencyState.level=null;emergencyState.reason=null;emergencyState.actor=null;emergencyState.startedAt=null;emergencyState.endsAt=null;emergencyState.affected={text:[],voice:[]};emergencyState.lastError=null;
    emergencyRecord("deactivated",{actor:String(actor).slice(0,120),reason:String(reason).slice(0,500),restored:restored.length});
    saveEmergencyState();
    await verifyGuildConfiguration();
    if(announce&&emergencyConfig.announceDeactivation&&emergencyConfig.noticeChannelId){
      await sendChannelMessage(emergencyConfig.noticeChannelId,renderEmergencyMessage(emergencyConfig.deactivationMessage,{actor,reason}));
    }
    if(logEvent)await sendDiscordLogEvent("emergency.deactivated",{actor:String(actor),reason:String(reason),restored:String(restored.length)});
    // Kanalzeiten dürfen während des Notfallmodus keine Rechte zurücksetzen. Danach Sollzustand neu anwenden.
    setTimeout(()=>{if(!moduleState.isOn("discordChannelTimes"))return;reconcileChannelTimes({source:"emergency-end",announce:false}).catch(err=>warn("⚠️ Kanalzeiten nach Notfallmodus:",err.message));},1000); // 9.9.0
    return emergencyView();
  }catch(err){
    emergencyState.lastError=err.message;saveEmergencyState();
    await sendDiscordLogEvent("emergency.error",{error:err.message,source:"deactivation"});
    throw err;
  }finally{
    emergencyRunning=false;
    scheduleEmergencyCheck();
  }
}
async function reconcileEmergencyMode({source="scheduler"}={}){
  if(!emergencyState.active)return {ok:true,status:"inactive"};
  if(emergencyState.endsAt&&Date.now()>=Date.parse(emergencyState.endsAt)){
    await deactivateEmergencyMode({actor:"System",reason:"Zeitlimit erreicht",announce:true,logEvent:true});
    return {ok:true,status:"expired"};
  }
  const cfg=emergencyLevelConfig();if(!cfg)throw new Error("Aktiver Notfallmodus hat eine ungültige Stufe.");
  if(emergencyRunning)return {ok:true,status:"busy"};
  emergencyRunning=true;
  try{
    await verifyGuildConfiguration();
    for(const id of cfg.textChannelIds)await emergencyApplyChannel(id,"text",cfg);
    for(const id of cfg.voiceChannelIds)await emergencyApplyChannel(id,"voice",cfg);
    emergencyState.affected={text:[...cfg.textChannelIds],voice:[...cfg.voiceChannelIds]};
    emergencyState.lastError=null;saveEmergencyState();
    return {ok:true,status:"enforced",source};
  }catch(err){
    emergencyState.lastError=err.message;saveEmergencyState();
    await sendDiscordLogEvent("emergency.error",{error:err.message,source});
    throw err;
  }finally{emergencyRunning=false;}
}
function scheduleEmergencyCheck(){
  if(emergencyTimer){clearTimeout(emergencyTimer);emergencyTimer=null;}
  const wait=emergencyState.active&&emergencyState.endsAt?Math.max(5000,Math.min(60000,Date.parse(emergencyState.endsAt)-Date.now())):60000;
  emergencyTimer=setTimeout(async()=>{
    try{await reconcileEmergencyMode({source:"scheduler"});}catch(err){warn("⚠️ Notfallmodus:",err.message);}
    scheduleEmergencyCheck();
  },wait);
  emergencyTimer.unref?.();
}
function emergencyView(){
  const catalog=emergencyChannelCatalog();
  return {
    ok:true,
    config:emergencyConfig,
    state:{
      active:emergencyState.active,level:emergencyState.level,levelLabel:emergencyLevelLabel(),
      reason:emergencyState.reason,actor:emergencyState.actor,startedAt:emergencyState.startedAt,endsAt:emergencyState.endsAt,
      affected:emergencyState.affected,lastError:emergencyState.lastError,
      history:[...(emergencyState.history||[])].reverse().slice(0,100)
    },
    catalog:{channels:catalog,textChannels:catalog.filter(x=>x.kind==="text"&&!x.protected),voiceChannels:catalog.filter(x=>x.kind==="voice"&&!x.protected)},
    safeguards:{
      affectedRole:{id:IDS.roles.member,name:roleById(IDS.roles.member)?.name||RT("member")},
      staffUnaffected:[roleById(IDS.roles.administrator)?.name||RT("administrator"),roleById(IDS.roles.moderator)?.name||RT("moderator"),roleById(IDS.roles.bot)?.name||"Bot"],
      protectedChannelIds:[...EMERGENCY_PROTECTED_CHANNEL_IDS]
    }
  };
}
async function updateEmergencyConfig(raw={}){
  if(emergencyState.active)throw new Error("Die Notfall-Konfiguration kann während eines aktiven Notfallmodus nicht geändert werden.");
  emergencyConfig=validateEmergencyConfig(raw);saveEmergencyConfig();return emergencyView();
}

const CHANNEL_TIME_LOCK_FLAGS_BASE=[PERM.SEND_MESSAGES];
const CHANNEL_TIME_LOCK_FLAGS_THREADS=[PERM.CREATE_PUBLIC_THREADS,PERM.CREATE_PRIVATE_THREADS,PERM.SEND_MESSAGES_IN_THREADS];

function zonedParts(date=new Date(),timeZone=channelTimesConfig.timezone){
  const fmt=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const parts=Object.fromEntries(fmt.formatToParts(date).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour),minute:Number(parts.minute)};
}
function hhmmMinutes(value){const [h,m]=String(value).split(":").map(Number);return h*60+m;}
function scheduledClosed(profile,date=new Date()){
  const z=zonedParts(date),nowMin=z.hour*60+z.minute,close=hhmmMinutes(profile.closeTime),open=hhmmMinutes(profile.openTime);
  if(close===open)return false;
  return close<open ? nowMin>=close&&nowMin<open : nowMin>=close||nowMin<open;
}
function nextScheduledTransition(profile,from=new Date()){
  const current=scheduledClosed(profile,from);
  for(let i=1;i<=60*49;i++){
    const d=new Date(from.getTime()+i*60000);
    if(scheduledClosed(profile,d)!==current)return d.toISOString();
  }
  return null;
}
function channelTimeRoleIds(profile){
  const out=[];
  if(roleFlag(profile.roles,"member","rekrut"))out.push({id:IDS.roles.member,name:roleById(IDS.roles.member)?.name||"Freischaltrolle"});
  if(roleFlag(profile.roles,"administrator","s1"))out.push({id:IDS.roles.administrator,name:roleById(IDS.roles.administrator)?.name||RT("administrator")});
  return out;
}
function channelTimeTargetFlags(profile){
  return profile.lockThreads?[...CHANNEL_TIME_LOCK_FLAGS_BASE,...CHANNEL_TIME_LOCK_FLAGS_THREADS]:CHANNEL_TIME_LOCK_FLAGS_BASE;
}
function renderChannelTimeMessage(template,profile,channel){
  return String(template||"")
    .replaceAll("{channel}",channel?.name?`#${channel.name}`:"Kanal")
    .replaceAll("{closeTime}",profile.closeTime)
    .replaceAll("{openTime}",profile.openTime)
    .replaceAll("{warningMinutes}",String(profile.warningMinutes||30));
}
function recordChannelTimeEvent(type,profile,extra={}){
  const channel=channelById(profile.channelId);
  channelTimesState.events.push({at:now(),type,profileId:profile.id,channelId:profile.channelId,channelName:channel?.name||profile.channelId,...extra});
  channelTimesState.events=channelTimesState.events.slice(-500);
  saveChannelTimesState();
}
async function channelTimeLog(eventKey,data){
  await sendDiscordLogEvent(eventKey,data);
}
function snapshotOverwrite(channel,roleId){
  const o=(channel?.permission_overwrites||[]).find(x=>x.id===roleId&&Number(x.type)===0);
  return o?{exists:true,allow:String(o.allow||"0"),deny:String(o.deny||"0"),type:0}:{exists:false,allow:"0",deny:"0",type:0};
}
function lockedOverwrite(channel,roleId,profile){
  const prev=snapshotOverwrite(channel,roleId),flags=channelTimeTargetFlags(profile);
  let allow=BigInt(prev.allow||"0"),deny=BigInt(prev.deny||"0");
  for(const flag of flags){deny|=flag;allow&=~flag;}
  return {previous:prev,allow:allow.toString(),deny:deny.toString(),type:0};
}
async function putRoleOverwrite(channelId,roleId,allow,deny){
  await discordApi(`/channels/${channelId}/permissions/${roleId}`,"PUT",{type:0,allow:String(allow||"0"),deny:String(deny||"0")});
}
async function restoreRoleOverwrite(channelId,roleId,snapshot){
  if(snapshot?.exists)await putRoleOverwrite(channelId,roleId,snapshot.allow,snapshot.deny);
  else await discordApi(`/channels/${channelId}/permissions/${roleId}`,"DELETE");
}
async function closeChannelTimeProfile(profile,{source="automatic",announce=true}={}){
  if(channelTimesState.active[profile.id])return {changed:false,status:"already_closed"};
  let channel=channelById(profile.channelId);
  if(!channel){await verifyGuildConfiguration();channel=channelById(profile.channelId);}
  if(!channel)throw new Error(`Kanal ${profile.channelId} nicht gefunden.`);
  if(![0,5].includes(Number(channel.type)))throw new Error(`#${channel.name} ist kein unterstützter Textkanal.`);
  const roles=channelTimeRoleIds(profile);
  if(!roles.length)throw new Error(`#${channel.name}: Keine Zielrolle ausgewählt.`);
  const snapshots={};
  const applied=[];
  try{
    for(const role of roles){
      const desired=lockedOverwrite(channel,role.id,profile);
      snapshots[role.id]=desired.previous;
      await putRoleOverwrite(channel.id,role.id,desired.allow,desired.deny);
      applied.push(role);
      // refresh local channel representation incrementally for multiple roles
      const existing=(channel.permission_overwrites||[]).filter(x=>!(x.id===role.id&&Number(x.type)===0));
      channel={...channel,permission_overwrites:[...existing,{id:role.id,type:0,allow:desired.allow,deny:desired.deny}]};
    }
  }catch(err){
    for(const role of applied.reverse()){
      try{await restoreRoleOverwrite(channel.id,role.id,snapshots[role.id]);}catch{}
    }
    throw err;
  }
  channelTimesState.active[profile.id]={closedAt:now(),source,channelId:profile.channelId,snapshots,roles:roles.map(x=>x.id)};
  delete channelTimesState.overrides[profile.id];
  saveChannelTimesState();
  await verifyGuildConfiguration();
  if(announce&&profile.announceClose&&profile.closeMessage)await sendChannelMessage(channel.id,renderChannelTimeMessage(profile.closeMessage,profile,channel));
  recordChannelTimeEvent("closed",profile,{source,roles:roles.map(x=>x.name)});
  await channelTimeLog("channel-times.closed",{channel:channel.name,channelMention:`<#${channel.id}>`,roles:roles.map(x=>x.name).join(", "),source});
  return {changed:true,status:"closed"};
}
async function openChannelTimeProfile(profile,{source="automatic",announce=true}={}){
  const active=channelTimesState.active[profile.id];
  if(!active)return {changed:false,status:"already_open"};
  let channel=channelById(active.channelId||profile.channelId);
  if(!channel){await verifyGuildConfiguration();channel=channelById(active.channelId||profile.channelId);}
  if(!channel)throw new Error(`Kanal ${active.channelId||profile.channelId} nicht gefunden.`);
  const snapshots=active.snapshots||{};
  for(const roleId of Object.keys(snapshots))await restoreRoleOverwrite(channel.id,roleId,snapshots[roleId]);
  delete channelTimesState.active[profile.id];
  delete channelTimesState.overrides[profile.id];
  saveChannelTimesState();
  await verifyGuildConfiguration();
  if(announce&&profile.announceOpen&&profile.openMessage)await sendChannelMessage(channel.id,renderChannelTimeMessage(profile.openMessage,profile,channel));
  recordChannelTimeEvent("opened",profile,{source});
  await channelTimeLog("channel-times.opened",{channel:channel.name,channelMention:`<#${channel.id}>`,source});
  return {changed:true,status:"open"};
}
async function enforceActiveChannelTimeProfile(profile){
  const active=channelTimesState.active[profile.id];if(!active)return;
  let channel=channelById(active.channelId||profile.channelId);if(!channel)return;
  const flags=channelTimeTargetFlags(profile);
  for(const roleId of active.roles||Object.keys(active.snapshots||{})){
    const o=(channel.permission_overwrites||[]).find(x=>x.id===roleId&&Number(x.type)===0);
    let allow=BigInt(o?.allow||"0"),deny=BigInt(o?.deny||"0"),changed=false;
    for(const flag of flags){if((deny&flag)!==flag||(allow&flag)===flag){deny|=flag;allow&=~flag;changed=true;}}
    if(changed)await putRoleOverwrite(channel.id,roleId,allow.toString(),deny.toString());
  }
}
function channelTimeDesiredClosed(profile,date=new Date()){
  const override=channelTimesState.overrides?.[profile.id];
  if(override?.until){
    const until=Date.parse(override.until);
    if(Number.isFinite(until)&&until>Date.now())return override.state==="closed";
    delete channelTimesState.overrides[profile.id];saveChannelTimesState();
  }
  return scheduledClosed(profile,date);
}

function channelTimeWarningKey(profile,date=new Date()){
  const z=zonedParts(date);
  return `${z.year}-${String(z.month).padStart(2,"0")}-${String(z.day).padStart(2,"0")}@${profile.closeTime}`;
}
function channelTimeMinutesUntilClose(profile,date=new Date()){
  const z=zonedParts(date),nowMin=z.hour*60+z.minute,close=hhmmMinutes(profile.closeTime);
  return (close-nowMin+1440)%1440;
}
function channelTimeHasActiveOverride(profile){
  const override=channelTimesState.overrides?.[profile.id];
  if(!override?.until)return false;
  const until=Date.parse(override.until);
  return Number.isFinite(until)&&until>Date.now();
}
async function maybeSendChannelTimeWarning(profile,{source="scheduler"}={}){
  if(source!=="scheduler"||!channelTimesConfig.enabled||!profile.enabled||!profile.announceWarning||!profile.warningMessage)return {sent:false,status:"disabled"};
  if(emergencyState.active||channelTimesState.maintenance?.active||channelTimesState.active[profile.id]||channelTimeHasActiveOverride(profile))return {sent:false,status:"suppressed"};
  if(scheduledClosed(profile,new Date()))return {sent:false,status:"already_closed"};
  const mins=channelTimeMinutesUntilClose(profile,new Date()),lead=Math.max(5,Math.min(180,Number(profile.warningMinutes||30)));
  if(mins!==lead)return {sent:false,status:"not_due"};
  const key=channelTimeWarningKey(profile,new Date());
  if(channelTimesState.warningNotices?.[profile.id]===key)return {sent:false,status:"already_sent"};
  let channel=channelById(profile.channelId);
  if(!channel){await verifyGuildConfiguration();channel=channelById(profile.channelId);}
  if(!channel)throw new Error(`Kanal ${profile.channelId} für Vorwarnung nicht gefunden.`);
  await sendChannelMessage(channel.id,renderChannelTimeMessage(profile.warningMessage,profile,channel));
  channelTimesState.warningNotices={...(channelTimesState.warningNotices||{}),[profile.id]:key};
  recordChannelTimeEvent("warning",profile,{source,warningMinutes:lead});
  return {sent:true,status:"warning_sent"};
}
async function reconcileChannelTimes({source="scheduler",announce=true}={}){
  if(emergencyState.active||channelTimesState.maintenance?.active)return {ok:true,status:"suspended_by_maintenance_or_emergency"};
  if(channelTimesRunning)return {ok:true,status:"already_running"};
  channelTimesRunning=true;channelTimesState.lastRunAt=now();channelTimesState.lastError=null;saveChannelTimesState();
  const results=[];
  try{
    if(!channelTimesConfig.enabled){
      // If the global switch is turned off, restore anything the scheduler currently owns.
      for(const [id] of Object.entries(channelTimesState.active||{})){
        const profile=channelTimesConfig.profiles.find(x=>x.id===id)||{id,channelId:channelTimesState.active[id]?.channelId,announceOpen:false,openMessage:"",roles:{}};
        try{results.push({id,...await openChannelTimeProfile(profile,{source:"system-disabled",announce:false})});}
        catch(err){results.push({id,error:err.message});}
      }
      return {ok:true,results};
    }
    for(const profile of channelTimesConfig.profiles){
      if(!profile.enabled){
        if(channelTimesState.active[profile.id])results.push({id:profile.id,...await openChannelTimeProfile(profile,{source:"profile-disabled",announce:false})});
        continue;
      }
      await maybeSendChannelTimeWarning(profile,{source});
      const shouldClose=channelTimeDesiredClosed(profile,new Date()),isClosed=!!channelTimesState.active[profile.id];
      if(shouldClose&&!isClosed)results.push({id:profile.id,...await closeChannelTimeProfile(profile,{source,announce})});
      else if(!shouldClose&&isClosed)results.push({id:profile.id,...await openChannelTimeProfile(profile,{source,announce})});
      else if(shouldClose&&isClosed){await enforceActiveChannelTimeProfile(profile);results.push({id:profile.id,changed:false,status:"closed"});}
      else results.push({id:profile.id,changed:false,status:"open"});
    }
    saveChannelTimesState();return {ok:true,results};
  }catch(err){
    channelTimesState.lastError=err.message;saveChannelTimesState();throw err;
  }finally{channelTimesRunning=false;}
}
function scheduleChannelTimes(){
  if(channelTimesTimer){clearTimeout(channelTimesTimer);channelTimesTimer=null;}
  const delay=60000-(Date.now()%60000)+1500;
  channelTimesTimer=setTimeout(async()=>{
    // 9.9.0: Modul „Kanalzeiten“ aus → Kanäle bleiben, wie sie sind.
    try{if(!moduleState.isOn("discordChannelTimes")){}else if(channelTimesState.maintenance?.active)await reconcileMaintenance();else await reconcileChannelTimes({source:"scheduler",announce:true});}
    catch(err){warn("⚠️ Kanal-Zeitsteuerung:",err.message);await channelTimeLog("channel-times.error",{error:err.message,source:"scheduler"});}
    scheduleChannelTimes();
  },delay);
  channelTimesTimer.unref?.();
}
function nextChannelTimeView(profile){
  const desired=channelTimeDesiredClosed(profile,new Date()),active=!!channelTimesState.active[profile.id];
  return {
    ...profile,
    channelName:channelById(profile.channelId)?.name||profile.channelId,
    scheduledClosed:scheduledClosed(profile,new Date()),
    effectiveClosed:active,
    desiredClosed:desired,
    nextTransitionAt:nextScheduledTransition(profile,new Date()),
    activeSince:channelTimesState.active[profile.id]?.closedAt||null,
    override:channelTimesState.overrides?.[profile.id]||null
  };
}
function channelTimesView(){
  const channels=state.cache.channels.filter(c=>[0,5].includes(Number(c.type))).map(c=>({id:c.id,name:c.name,parentId:c.parent_id||null,parentName:channelById(c.parent_id)?.name||null})).sort((a,b)=>(a.parentName||"").localeCompare(b.parentName||"")||a.name.localeCompare(b.name));
  return {
    ok:true,config:{...channelTimesConfig,profiles:channelTimesConfig.profiles.map(nextChannelTimeView)},
    maintenance:{...channelTimesState.maintenance,snapshots:undefined,lockedChannels:Object.keys(channelTimesState.maintenance?.snapshots||{}).length},
    state:{lastRunAt:channelTimesState.lastRunAt,lastError:channelTimesState.lastError,events:[...(channelTimesState.events||[])].reverse().slice(0,100)},
    catalog:{channels,roles:{member:{id:IDS.roles.member,name:roleById(IDS.roles.member)?.name||RT("member")},administrator:{id:IDS.roles.administrator,name:roleById(IDS.roles.administrator)?.name||RT("administrator")}}}
  };
}
// Permanent Discord permissions remain effective while the NAS and bot are offline.
// The persisted snapshots are written BEFORE changing an overwrite so a crash is recoverable.
let maintenanceRunning=false;
function maintenanceTargets(){
  const m=channelTimesState.maintenance||DEFAULT_MAINTENANCE;
  const channelIds=m.scope==="custom"?new Set(m.channelIds||[]):new Set(channelTimesConfig.profiles.filter(p=>p.enabled&&p.channelId).map(p=>p.channelId));
  return [...channelIds].map(id=>channelById(id)).filter(c=>c&&[0,5].includes(Number(c.type)));
}
function maintenanceView(){const m=channelTimesState.maintenance;return {active:!!m.active,scope:m.scope||"profiles",channelIds:m.channelIds||[],roles:m.roles||{member:true,administrator:false},lockMessage:m.lockMessage,unlockMessage:m.unlockMessage,activatedAt:m.activatedAt,lastError:m.lastError,lockedChannels:Object.keys(m.snapshots||{}).length};}
async function reconcileMaintenance(){
  const m=channelTimesState.maintenance;if(!m.active||maintenanceRunning)return;
  maintenanceRunning=true;
  try{
    await verifyGuildConfiguration();
    for(const channel of maintenanceTargets()){
      for(const roleId of maintenanceRoleIds()){
        const key=`${channel.id}:${roleId}`;
        if(!m.snapshots[key]){
          m.snapshots[key]=snapshotOverwrite(channel,roleId);
          saveChannelTimesState(); // durable rollback snapshot before the overwrite
        }
        const current=snapshotOverwrite(channel,roleId);
        let allow=BigInt(current.allow),deny=BigInt(current.deny);
        for(const flag of [...CHANNEL_TIME_LOCK_FLAGS_BASE,...CHANNEL_TIME_LOCK_FLAGS_THREADS]){allow&=~flag;deny|=flag;}
        if(current.allow!==allow.toString()||current.deny!==deny.toString())await putRoleOverwrite(channel.id,roleId,allow,deny);
      }
    }
    m.lastError=null;saveChannelTimesState();
  }catch(e){m.lastError=e.message;saveChannelTimesState();throw e;}
  finally{maintenanceRunning=false;}
}
async function setMaintenance(body){
  if(maintenanceRunning||channelTimesRunning)throw new Error("Kanalrechte werden gerade verarbeitet. Bitte erneut versuchen.");
  const m=channelTimesState.maintenance;
  const active=body.active===true;
  if(typeof body.active!=="boolean")throw new Error("Wartungsstatus fehlt.");
  const lockMessage=String(body.lockMessage??m.lockMessage).trim().slice(0,1800);
  const unlockMessage=String(body.unlockMessage??m.unlockMessage).trim().slice(0,1800);
  if(!lockMessage||!unlockMessage)throw new Error("Sperr- und Entsperrtext müssen ausgefüllt sein.");
  // Umfang (Kanäle/Rollen) nur ändern, solange keine Sperre aktiv ist; sonst würden Snapshots verwaist.
  const hasScope=body.scope!==undefined||body.channelIds!==undefined||body.roles!==undefined;
  let nextScope=null;
  if(hasScope){
    nextScope=normalizeMaintenanceScope({scope:body.scope??m.scope,channelIds:body.channelIds??m.channelIds,roles:body.roles??m.roles});
    const changed=JSON.stringify(nextScope)!==JSON.stringify({scope:m.scope,channelIds:m.channelIds||[],roles:m.roles});
    if(m.active&&changed)throw new Error("Kanäle und Rollen des Wartungsmodus können nur geändert werden, solange er nicht aktiv ist.");
    if(nextScope.scope==="custom"){
      if(!nextScope.channelIds.length)throw new Error("Bitte mindestens einen Kanal für den Wartungsmodus auswählen.");
      for(const id of nextScope.channelIds){const c=channelById(id);if(!c)throw new Error(`Kanal ${id} nicht gefunden.`);if(![0,5].includes(Number(c.type)))throw new Error(`#${c.name} ist kein Textkanal.`);}
    }
    if(!nextScope.roles.member&&!nextScope.roles.administrator)throw new Error("Bitte mindestens eine Rolle für den Wartungsmodus auswählen.");
    if((nextScope.roles.member&&!IDS.roles.member)||(nextScope.roles.administrator&&!IDS.roles.administrator))throw new Error("Die gewählte Rolle ist auf dem Server nicht konfiguriert.");
    if(!m.active)Object.assign(m,nextScope);
  }
  if(active&&!m.active){
    if(emergencyState.active)throw new Error("Während des Notfallmodus ist der Wartungsmodus nicht verfügbar.");
    await verifyGuildConfiguration();
    if(!maintenanceTargets().length)throw new Error(m.scope==="custom"?"Bitte mindestens einen Kanal für den Wartungsmodus auswählen.":"Bitte zunächst mindestens ein aktives Kanalprofil einrichten oder im Wartungsmodus eigene Kanäle auswählen.");
    if(!maintenanceRoleIds().length)throw new Error("Bitte mindestens eine Rolle für den Wartungsmodus auswählen.");
    m.active=true;m.activatedAt=now();m.lastError=null;
    m.lockMessage=lockMessage;m.unlockMessage=unlockMessage;
    saveChannelTimesState(); // fail-closed intent before Discord API changes
    try{
      // Announce before denying messages so the notice is visible even with restrictive channel rules.
      for(const ch of maintenanceTargets())await sendChannelMessage(ch.id,lockMessage);
      await reconcileMaintenance();
      channelTimesState.events.push({at:now(),type:"maintenance_on",source:"manual"});saveChannelTimesState();
    }catch(e){m.lastError=e.message;saveChannelTimesState();throw e;}
  }else if(!active&&m.active){
    // Keep active flag until all permissions are restored; retry is possible after partial errors.
    await verifyGuildConfiguration();
    for(const [key,snapshot] of Object.entries({...m.snapshots})){
      const at=key.lastIndexOf(":");const channelId=key.slice(0,at),roleId=key.slice(at+1);
      await restoreRoleOverwrite(channelId,roleId,snapshot);
      delete m.snapshots[key];saveChannelTimesState();
    }
    m.active=false;m.activatedAt=null;m.lastError=null;
    m.lockMessage=lockMessage;m.unlockMessage=unlockMessage;saveChannelTimesState();
    // Apply the current schedule after maintenance; it may need to close a channel again.
    await verifyGuildConfiguration();
    await reconcileChannelTimes({source:"maintenance-end",announce:false});
    for(const ch of maintenanceTargets())await sendChannelMessage(ch.id,unlockMessage);
    channelTimesState.events.push({at:now(),type:"maintenance_off",source:"manual"});saveChannelTimesState();
  }else{m.lockMessage=lockMessage;m.unlockMessage=unlockMessage;saveChannelTimesState();}
  return maintenanceView();
}

async function updateChannelTimesConfig(raw){
  if(channelTimesState.maintenance?.active)throw new Error("Kanalprofile können während des Wartungsmodus nicht geändert werden.");
  const next=normalizeChannelTimesConfig(raw||{});
  // Validate timezone and profiles.
  try{new Intl.DateTimeFormat("de-DE",{timeZone:next.timezone}).format(new Date());}catch{throw new Error("Ungültige Zeitzone.");}
  const ids=new Set();
  for(const p of next.profiles){
    if(ids.has(p.id))throw new Error(`Profil-ID doppelt: ${p.id}`);ids.add(p.id);
    if(p.closeTime===p.openTime)throw new Error(`#${channelById(p.channelId)?.name||p.channelId}: Schließ- und Öffnungszeit dürfen nicht identisch sein.`);
    const ch=channelById(p.channelId);if(!ch)throw new Error(`Kanal ${p.channelId} nicht gefunden.`);
    if(![0,5].includes(Number(ch.type)))throw new Error(`#${ch.name} ist kein Textkanal.`);
    if(!p.roles.member&&!p.roles.administrator)throw new Error(`#${ch.name}: Mindestens eine Rolle muss betroffen sein.`);
  }

  // Restore old snapshots before changing/removing active profile definitions.
  const oldById=new Map(channelTimesConfig.profiles.map(x=>[x.id,x]));
  for(const [id,active] of Object.entries(channelTimesState.active||{})){
    const old=oldById.get(id)||{id,channelId:active.channelId,roles:{},announceOpen:false,openMessage:""};
    const neu=next.profiles.find(x=>x.id===id);
    const relevantChanged=!neu||JSON.stringify({channelId:old.channelId,roles:old.roles,lockThreads:old.lockThreads})!==JSON.stringify({channelId:neu?.channelId,roles:neu?.roles,lockThreads:neu?.lockThreads});
    if(relevantChanged)await openChannelTimeProfile(old,{source:"config-change",announce:false});
  }
  channelTimesConfig=next;saveChannelTimesConfig();
  await reconcileChannelTimes({source:"config-save",announce:false});
  scheduleChannelTimes();
  return channelTimesView();
}
async function manualChannelTimeAction(profileId,action){
  if(channelTimesState.maintenance?.active)throw new Error("Während der Wartung dürfen Kanalzeiten nicht manuell geöffnet werden.");
  const profile=channelTimesConfig.profiles.find(x=>x.id===profileId);if(!profile)throw new Error("Zeitprofil nicht gefunden.");
  if(!["close","open","clear_override"].includes(action))throw new Error("Ungültige Aktion.");
  if(action==="clear_override"){delete channelTimesState.overrides[profile.id];saveChannelTimesState();return reconcileChannelTimes({source:"manual-override-end",announce:false});}
  const desiredState=action==="close"?"closed":"open";
  const until=nextScheduledTransition(profile,new Date())||new Date(Date.now()+24*60*60*1000).toISOString();
  channelTimesState.overrides[profile.id]={state:desiredState,at:now(),until};saveChannelTimesState();
  if(action==="close")return closeChannelTimeProfile(profile,{source:"manual",announce:true});
  return openChannelTimeProfile(profile,{source:"manual",announce:true});
}

function roleBasePermissions(member, roles) {
  const everyone = roles.find(r => r.id === IDS.guild);
  let bits = BigInt(everyone?.permissions || "0");
  for (const roleId of member?.roles || []) {
    const role = roles.find(r => r.id === roleId);
    if (role) bits |= BigInt(role.permissions || "0");
  }
  return bits;
}
function effectiveChannelPermissions(member, channel, roles) {
  let bits = roleBasePermissions(member, roles);
  if ((bits & PERM.ADMINISTRATOR) === PERM.ADMINISTRATOR) return (1n << 62n) - 1n;
  const overwrites = Array.isArray(channel?.permission_overwrites) ? channel.permission_overwrites : [];
  const everyone = overwrites.find(o => o.id === IDS.guild && Number(o.type) === 0);
  if (everyone) {
    bits &= ~BigInt(everyone.deny || "0");
    bits |= BigInt(everyone.allow || "0");
  }
  let roleDeny = 0n, roleAllow = 0n;
  const memberRoleIds = new Set(member?.roles || []);
  for (const o of overwrites) {
    if (Number(o.type) === 0 && memberRoleIds.has(o.id)) {
      roleDeny |= BigInt(o.deny || "0");
      roleAllow |= BigInt(o.allow || "0");
    }
  }
  bits &= ~roleDeny;
  bits |= roleAllow;
  const userOverwrite = overwrites.find(o => Number(o.type) === 1 && o.id === member?.user?.id);
  if (userOverwrite) {
    bits &= ~BigInt(userOverwrite.deny || "0");
    bits |= BigInt(userOverwrite.allow || "0");
  }
  return bits;
}
function hasPerm(bits, flag) { return (bits & flag) === flag || (bits & PERM.ADMINISTRATOR) === PERM.ADMINISTRATOR; }
function permissionNames(bits) {
  const items = [
    [PERM.MANAGE_CHANNELS,"MANAGE_CHANNELS"],[PERM.ADD_REACTIONS,"ADD_REACTIONS"],[PERM.VIEW_CHANNEL,"VIEW_CHANNEL"],[PERM.SEND_MESSAGES,"SEND_MESSAGES"],
    [PERM.MANAGE_MESSAGES,"MANAGE_MESSAGES"],[PERM.EMBED_LINKS,"EMBED_LINKS"],[PERM.ATTACH_FILES,"ATTACH_FILES"],
    [PERM.READ_MESSAGE_HISTORY,"READ_MESSAGE_HISTORY"],[PERM.MOVE_MEMBERS,"MOVE_MEMBERS"],[PERM.MANAGE_ROLES,"MANAGE_ROLES"],[PERM.MODERATE_MEMBERS,"MODERATE_MEMBERS"]
  ];
  return items.filter(([flag]) => hasPerm(bits, flag)).map(([,name]) => name);
}

async function verifyGuildConfiguration() {
  try {
    const currentUser = await discordFetch("/users/@me");
    const [guild, roles, channels, me] = await Promise.all([
      discordFetch(`/guilds/${IDS.guild}?with_counts=true`),
      discordFetch(`/guilds/${IDS.guild}/roles`),
      discordFetch(`/guilds/${IDS.guild}/channels`),
      discordFetch(`/guilds/${IDS.guild}/members/${currentUser.id}`)
    ]);
    state.bot = {id:currentUser.id, username:currentUser.username, discriminator:currentUser.discriminator};
    state.guild = {id:guild.id, found:true, name:guild.name, ownerId:guild.owner_id, memberCount:guild.approximate_member_count ?? guild.member_count ?? null, features:Array.isArray(guild.features)?guild.features:[]};
    state.cache = {roles:roles || [], channels:channels || [], botMember:me};

    const roleMap = new Map((roles || []).map(r => [r.id,r]));
    for (const [key,id] of Object.entries(IDS.roles)) {
      const role = roleMap.get(id);
      state.checks.roles[key] = role ? {ok:true,id:role.id,name:role.name,position:role.position,managed:!!role.managed,color:role.color} : {ok:false,id,error:"Rolle nicht gefunden"};
    }
    const channelMap = new Map((channels || []).map(c => [c.id,c]));
    for (const [key,id] of Object.entries(IDS.categories)) {
      const c=channelMap.get(id); state.checks.categories[key]=c?{ok:c.type===4,id:c.id,name:c.name,type:c.type,parentId:c.parent_id||null}:{ok:false,id,error:"Kategorie nicht gefunden"};
    }
    for (const [key,id] of Object.entries(IDS.channels)) {
      const c=channelMap.get(id); state.checks.channels[key]=c?{ok:true,id:c.id,name:c.name,type:c.type,parentId:c.parent_id||null}:{ok:false,id,error:"Kanal nicht gefunden"};
    }
    const botRole=roleMap.get(IDS.roles.bot), s1=roleMap.get(IDS.roles.administrator), rekrut=roleMap.get(IDS.roles.member), ovwa=roleMap.get(IDS.roles.moderator);
    state.checks.botRoleHierarchy={ok:!!(botRole&&s1&&rekrut&&ovwa&&ovwa.position>botRole.position&&botRole.position>s1.position&&botRole.position>rekrut.position),moderator:ovwa?{name:ovwa.name,position:ovwa.position}:null,bot:botRole?{name:botRole.name,position:botRole.position}:null,administrator:s1?{name:s1.name,position:s1.position}:null,member:rekrut?{name:rekrut.name,position:rekrut.position}:null};
    const guildBits = roleBasePermissions(me, roles || []);
    state.checks.botPermissions={raw:guildBits.toString(),recognized:permissionNames(guildBits)};
    state.checks.completedAt=now();
    log(`✅ Guild gefunden: ${guild.name} (${guild.id})`);
    log(`✅ Rollen geprüft: ${Object.values(state.checks.roles).filter(v=>v.ok).length}/${Object.keys(state.checks.roles).length}`);
    log(`✅ Kategorien geprüft: ${Object.values(state.checks.categories).filter(v=>v.ok).length}/${Object.keys(state.checks.categories).length}`);
    log(`✅ Kanäle geprüft: ${Object.values(state.checks.channels).filter(v=>v.ok).length}/${Object.keys(state.checks.channels).length}`);
    log(`✅ Bot-Rollenhierarchie: ${state.checks.botRoleHierarchy.ok?"OK":"PRÜFEN"}`);
    log(`ℹ️ Erkannte Bot-Rechte: ${state.checks.botPermissions.recognized.join(", ") || "keine"}`);
  } catch (err) {
    state.guild.found=false; state.gateway.lastError=err.message; fail("❌ Guild-/Berechtigungsprüfung fehlgeschlagen:",err.message);
  }
}

function selectedObjects() {
  return {
    welcome: channelById(onboardingConfig.welcomeChannelId),
    rules: channelById(onboardingConfig.rulesChannelId),
    log: channelById(onboardingConfig.logChannelId),
    unlockRole: roleById(onboardingConfig.unlockRoleId),
    botRole: roleById(IDS.roles.bot)
  };
}

function overwriteFor(channel, id) {
  return (channel?.permission_overwrites || []).find(o => o.id === id) || null;
}
function mergeOverwrite(channel, targetId, targetType=0, allowFlags=[], denyFlags=[]) {
  const existing=(channel?.permission_overwrites||[]).find(o=>o.id===targetId && Number(o.type)===Number(targetType)) || null;
  let allow=BigInt(existing?.allow||"0"), deny=BigInt(existing?.deny||"0");
  for(const flag of allowFlags){allow|=flag;deny&=~flag;}
  for(const flag of denyFlags){deny|=flag;allow&=~flag;}
  return {id:targetId,type:targetType,allow:allow.toString(),deny:deny.toString(),previous:existing?{allow:String(existing.allow||"0"),deny:String(existing.deny||"0"),type:Number(existing.type)}:null};
}
function accessTargets(){
  const get=id=>state.cache.channels.find(c=>c.id===id)||null;
  return {
    informationen:get(IDS.categories.informationen),
    community:get(IDS.categories.community),
    social:get(IDS.categories.socialMedia),
    funkraum:get(IDS.categories.funkraum),
    intern:get(IDS.categories.intern),
    rules:get(onboardingConfig.rulesChannelId||IDS.channels.rules),
    welcome:get(onboardingConfig.welcomeChannelId||IDS.channels.welcome),
    waiting:get(IDS.channels.waitingRoom),
    bwtalk:get(IDS.channels.bwTalk)
  };
}
function desiredAccessPlan(){
  const t=accessTargets(),everyone=IDS.guild,rekrut=onboardingConfig.unlockRoleId||IDS.roles.member,botUser=state.bot.id,plan=[];
  const add=(key,ch,targetId,targetType,allow=[],deny=[],reason="")=>{
    if(!ch||!targetId)return;
    const roleName=targetType===1?(state.bot.username||"Bot-Mitglied"):(targetId===everyone?"@everyone":(roleById(targetId)?.name||targetId));
    plan.push({key,channelId:ch.id,channelName:ch.name,channelType:ch.type,roleId:targetId,roleName,targetType,reason,...mergeOverwrite(ch,targetId,targetType,allow,deny)});
  };

  // Wichtig: Der Bot kann seine eigene gemanagte Integrationsrolle nicht ändern.
  // Deshalb sichern wir seinen Zugriff als MEMBER-Overwrite (type=1).
  // Mitglieds-Overwrites haben in Discord Vorrang vor Rollen-Overwrites.
  for (const [key,ch] of [
    ["informationen",t.informationen],["community",t.community],["social",t.social],
    ["funkraum",t.funkraum],["intern",t.intern]
  ]) {
    add(`${key}-bot-member`,ch,botUser,1,[PERM.VIEW_CHANNEL,PERM.MANAGE_CHANNELS],[],`Bot-Mitgliedszugriff auf ${ch?.name||key} erhalten.`);
  }
  add("welcome-bot-member",t.welcome,botUser,1,[PERM.VIEW_CHANNEL,PERM.SEND_MESSAGES,PERM.READ_MESSAGE_HISTORY],[],"Bot darf Begrüßungen im Meldekopf senden.");
  add("rules-bot-member",t.rules,botUser,1,[PERM.VIEW_CHANNEL,PERM.SEND_MESSAGES,PERM.READ_MESSAGE_HISTORY,PERM.ADD_REACTIONS],[],"Bot darf Regeln veröffentlichen/aktualisieren und 👍 setzen.");

  add("informationen-everyone",t.informationen,everyone,0,[],[PERM.VIEW_CHANNEL],"INFORMATIONEN standardmäßig sperren; Meldekopf und Regeln werden gezielt freigegeben.");
  add("community-everyone",t.community,everyone,0,[],[PERM.VIEW_CHANNEL],"COMMUNITY vor Regelbestätigung ausblenden.");
  add("community-member",t.community,rekrut,0,[PERM.VIEW_CHANNEL],[],`COMMUNITY für freigeschaltete ${RL("memberPlural")} sichtbar.`);
  add("social-everyone",t.social,everyone,0,[],[PERM.VIEW_CHANNEL],"SOCIAL MEDIA vor Regelbestätigung ausblenden.");
  add("social-member",t.social,rekrut,0,[PERM.VIEW_CHANNEL,PERM.READ_MESSAGE_HISTORY],[PERM.SEND_MESSAGES,PERM.CREATE_PUBLIC_THREADS,PERM.CREATE_PRIVATE_THREADS,PERM.SEND_MESSAGES_IN_THREADS],`SOCIAL MEDIA für ${RL("member")} lesbar, aber schreibgeschützt.`);
  add("funkraum-everyone",t.funkraum,everyone,0,[],[PERM.VIEW_CHANNEL],"FUNKRAUM vor Regelbestätigung ausblenden.");
  add("funkraum-member",t.funkraum,rekrut,0,[PERM.VIEW_CHANNEL,PERM.CONNECT],[],`FUNKRAUM für ${RL("member")} grundsätzlich sichtbar und betretbar.`);
  add("intern-everyone",t.intern,everyone,0,[],[PERM.VIEW_CHANNEL],"INTERN für @everyone sperren.");
  add("intern-member",t.intern,rekrut,0,[],[PERM.VIEW_CHANNEL],`INTERN bleibt auch für ${RL("member")} gesperrt.`);

  add("welcome-everyone",t.welcome,everyone,0,[PERM.VIEW_CHANNEL,PERM.READ_MESSAGE_HISTORY],
      [PERM.SEND_MESSAGES,PERM.CREATE_PUBLIC_THREADS,PERM.CREATE_PRIVATE_THREADS,PERM.SEND_MESSAGES_IN_THREADS],
      "Meldekopf sichtbar, aber vollständig schreibgeschützt.");

  add("rules-everyone",t.rules,everyone,0,[PERM.VIEW_CHANNEL,PERM.READ_MESSAGE_HISTORY,PERM.ADD_REACTIONS],
      [PERM.SEND_MESSAGES,PERM.CREATE_PUBLIC_THREADS,PERM.CREATE_PRIVATE_THREADS,PERM.SEND_MESSAGES_IN_THREADS],
      "Regeln sichtbar und schreibgeschützt; Reaktionen bleiben erlaubt.");

  add("waiting-member",t.waiting,rekrut,0,[PERM.VIEW_CHANNEL,PERM.CONNECT],[PERM.SPEAK,PERM.STREAM],"Warteraum betretbar, aber ohne Sprechen/Streaming.");
  add("bwtalk-member",t.bwtalk,rekrut,0,[PERM.CONNECT,PERM.SPEAK],[PERM.VIEW_CHANNEL],`BwTalk bleibt für ${RL("member")} unsichtbar; Verbindung für moderiertes Verschieben vorbereitet.`);
  return plan;
}
function accessPlanView(){
  const plan=desiredAccessPlan(),missingTargets=[];
  const expected=[["INFORMATIONEN",IDS.categories.informationen],["COMMUNITY",IDS.categories.community],["SOCIAL MEDIA",IDS.categories.socialMedia],["FUNKRAUM",IDS.categories.funkraum],["INTERN",IDS.categories.intern],["Meldekopf",onboardingConfig.welcomeChannelId],["Regelkanal",onboardingConfig.rulesChannelId],["Warteraum",IDS.channels.waitingRoom],["BwTalk",IDS.channels.bwTalk]];
  for(const [name,id] of expected){if(id&&!channelById(id))missingTargets.push(name);}
  const base=state.cache.botMember?roleBasePermissions(state.cache.botMember,state.cache.roles):0n;
  const canManage=hasPerm(base,PERM.MANAGE_CHANNELS);
  const changes=plan.map(x=>({key:x.key,channelId:x.channelId,channelName:x.channelName,channelType:x.channelType,roleId:x.roleId,roleName:x.roleName,targetType:x.targetType,reason:x.reason,previous:x.previous,desired:{allow:x.allow,deny:x.deny,type:x.targetType},changed:!x.previous||x.previous.allow!==x.allow||x.previous.deny!==x.deny}));
  return {ok:canManage&&missingTargets.length===0,canManageChannels:canManage,missingTargets,changes,changedCount:changes.filter(x=>x.changed).length,note:"Geändert werden nur gezielte Bits in Overwrites von @everyone und der ausgewählten Freischaltrolle. Andere Rollen-, Mitglieds- und sonstige Permission-Bits bleiben erhalten."};
}
async function applyAccessPlan(){
  const preview=accessPlanView();
  if(!preview.canManageChannels)throw new Error("Dem Bot fehlt die Berechtigung Kanäle verwalten.");
  if(preview.missingTargets.length)throw new Error(`Ziele nicht gefunden: ${preview.missingTargets.join(", ")}`);
  const applied=[];
  for(const item of desiredAccessPlan()){
    if(item.previous&&item.previous.allow===item.allow&&item.previous.deny===item.deny)continue;
    try{
      await discordApi(`/channels/${item.channelId}/permissions/${item.roleId}`,"PUT",{type:item.targetType,allow:item.allow,deny:item.deny});
    }catch(err){
      throw new Error(`Berechtigung konnte nicht gesetzt werden: ${item.channelName} → ${item.roleName} (${item.key}): ${err.message}`);
    }
    applied.push({channelId:item.channelId,channelName:item.channelName,roleId:item.roleId,roleName:item.roleName,targetType:item.targetType});
  }
  await verifyGuildConfiguration();
  await sendDiscordLogEvent("onboarding.access_applied",{count:applied.length});
  return {applied,preview:accessPlanView()};
}

function onboardingChecks() {
  const {welcome,rules,log:logChannel,unlockRole,botRole}=selectedObjects();
  const botMember=state.cache.botMember;
  const roles=state.cache.roles;
  const errors=[], warnings=[];
  const checks={};

  checks.nativeRulesScreeningDetected = state.guild.features.includes("MEMBER_VERIFICATION_GATE_ENABLED");
  if (checks.nativeRulesScreeningDetected) errors.push("Discord-Regelscreening ist aktiv. Ausstehende Mitglieder können dort nicht reagieren; für die reine 👍-Freischaltung muss das native Regelscreening deaktiviert werden.");

  checks.channelsFound = !!welcome && !!rules && (!onboardingConfig.logEnabled || !!logChannel);
  if (!welcome) errors.push("Der ausgewählte Meldekopf wurde nicht gefunden.");
  if (!rules) errors.push("Der ausgewählte Regelkanal wurde nicht gefunden.");
  if (onboardingConfig.logEnabled && !logChannel) errors.push("Der ausgewählte Logkanal wurde nicht gefunden.");
  if (welcome && ![0,5].includes(Number(welcome.type))) errors.push("Meldekopf muss ein Text- oder Ankündigungskanal sein.");
  if (rules && ![0,5].includes(Number(rules.type))) errors.push("Regelkanal muss ein Text- oder Ankündigungskanal sein.");
  if (logChannel && ![0,5].includes(Number(logChannel.type))) errors.push("Logkanal muss ein Text- oder Ankündigungskanal sein.");

  checks.unlockRoleFound = !!unlockRole;
  checks.unlockRoleAssignable = !!(unlockRole && botRole && !unlockRole.managed && botRole.position > unlockRole.position && unlockRole.id !== IDS.guild);
  if (!unlockRole) errors.push("Die ausgewählte Freischaltrolle wurde nicht gefunden.");
  else if (unlockRole.managed) errors.push("Die ausgewählte Freischaltrolle wird von einer Integration verwaltet und kann nicht durch den Bot vergeben werden.");
  else if (!botRole || botRole.position <= unlockRole.position) errors.push("Die Bot-Rolle muss oberhalb der Freischaltrolle stehen.");

  const base = botMember ? roleBasePermissions(botMember, roles) : 0n;
  checks.manageRoles = hasPerm(base, PERM.MANAGE_ROLES);
  if (!checks.manageRoles) errors.push("Dem Bot fehlt die Serverberechtigung Rollen verwalten.");
  checks.moderateMembers = hasPerm(base, PERM.MODERATE_MEMBERS);
  if (Number(onboardingConfig.newMemberTimeoutMinutes) > 0 && !checks.moderateMembers) errors.push("Für den Timeout nach der Regelannahme fehlt dem Bot die Serverberechtigung Mitglieder moderieren.");

  function channelPermCheck(name, channel, required) {
    if (!channel || !botMember) return;
    const bits=effectiveChannelPermissions(botMember,channel,roles);
    checks[name]={permissions:permissionNames(bits),missing:required.filter(([flag])=>!hasPerm(bits,flag)).map(([,label])=>label)};
    if (checks[name].missing.length) errors.push(`${name}: fehlende Botberechtigungen: ${checks[name].missing.join(", ")}.`);
  }
  channelPermCheck("Meldekopf", welcome, [[PERM.VIEW_CHANNEL,"Kanal ansehen"],[PERM.SEND_MESSAGES,"Nachrichten senden"]]);
  channelPermCheck("Regelkanal", rules, [[PERM.VIEW_CHANNEL,"Kanal ansehen"],[PERM.SEND_MESSAGES,"Nachrichten senden"],[PERM.ADD_REACTIONS,"Reaktionen hinzufügen"],[PERM.READ_MESSAGE_HISTORY,"Nachrichtenverlauf lesen"]]);
  if (onboardingConfig.logEnabled) channelPermCheck("Logkanal", logChannel, [[PERM.VIEW_CHANNEL,"Kanal ansehen"],[PERM.SEND_MESSAGES,"Nachrichten senden"]]);

  checks.rulesMessageLinked = !!onboardingConfig.rulesMessageId && onboardingConfig.rulesMessageChannelId === onboardingConfig.rulesChannelId;
  if (!checks.rulesMessageLinked) warnings.push("Es ist noch keine Regelnachricht mit dem ausgewählten Regelkanal verknüpft.");

  // Detect common bypasses in known public channels. This is advisory only; no permissions are changed automatically.
  const publicIds=[IDS.channels.talk,IDS.channels.memes,IDS.channels.twitch,IDS.channels.clips,IDS.channels.instagram,IDS.channels.tiktok,IDS.channels.waitingRoom].filter(Boolean);
  const everyoneRole=roleById(IDS.guild);
  if (everyoneRole) {
    const pseudoEveryone={user:{id:"0"},roles:[]};
    const exposed=[];
    for (const id of publicIds) {
      const c=channelById(id); if(!c) continue;
      const bits=effectiveChannelPermissions(pseudoEveryone,c,roles);
      if(hasPerm(bits,PERM.VIEW_CHANNEL)) exposed.push(c.name);
    }
    checks.publicChannelsVisibleToEveryone=exposed;
    if(exposed.length) warnings.push(`@everyone kann derzeit öffentliche Zielkanäle sehen: ${exposed.join(", ")}. Die Zugangssperre wäre damit umgehbar.`);

    const exemptRoleIds=new Set([IDS.guild,onboardingConfig.unlockRoleId,IDS.roles.bot,IDS.roles.administrator,IDS.roles.moderator]);
    const bypassRoles=[];
    for(const role of roles){
      if(exemptRoleIds.has(role.id)||role.managed) continue;
      const pseudo={user:{id:"0"},roles:[role.id]};
      const visible=publicIds.map(id=>channelById(id)).filter(Boolean).filter(c=>hasPerm(effectiveChannelPermissions(pseudo,c,roles),PERM.VIEW_CHANNEL)).map(c=>c.name);
      if(visible.length) bypassRoles.push({id:role.id,name:role.name,channels:visible});
    }
    checks.possibleBypassRoles=bypassRoles;
    if(bypassRoles.length) warnings.push(`Weitere Rollen können die Zugangssperre potenziell umgehen: ${bypassRoles.map(x=>x.name).join(", ")}. Bitte prüfen, ob diese Rollen automatisch an neue Mitglieder vergeben werden.`);
  }

  checks.ok = errors.length===0;
  return {ok:checks.ok,errors,warnings,details:checks};
}

async function onboardingView() {
  if (!state.guild.found || !state.cache.roles.length || !state.cache.channels.length) await verifyGuildConfiguration();
  const roles=state.cache.roles.map(r=>({id:r.id,name:r.name,position:r.position,managed:!!r.managed,color:r.color,assignable:r.id!==IDS.guild&&!r.managed&&!!roleById(IDS.roles.bot)&&roleById(IDS.roles.bot).position>r.position})).sort((a,b)=>b.position-a.position);
  const channels=state.cache.channels.filter(c=>[0,5].includes(Number(c.type))).map(c=>({id:c.id,name:c.name,type:c.type,parentId:c.parent_id||null,parentName:channelById(c.parent_id)?.name||null})).sort((a,b)=>(a.parentName||"").localeCompare(b.parentName||"")||a.name.localeCompare(b.name));
  return {ok:true,onboarding:onboardingSummary(),catalog:{roles,channels},checks:onboardingChecks()};
}
function onboardingSummary() {
  return {
    enabled:onboardingConfig.enabled,
    activatedAt:onboardingConfig.activatedAt,
    welcomeChannelId:onboardingConfig.welcomeChannelId,
    rulesChannelId:onboardingConfig.rulesChannelId,
    unlockRoleId:onboardingConfig.unlockRoleId,
    logChannelId:onboardingConfig.logChannelId,
    logEnabled:onboardingConfig.logEnabled,
    newMemberTimeoutMinutes:onboardingConfig.newMemberTimeoutMinutes,
    welcomeMessage:onboardingConfig.welcomeMessage,
    rulesText:onboardingConfig.rulesText,
    rulesMessageId:onboardingConfig.rulesMessageId,
    rulesMessageChannelId:onboardingConfig.rulesMessageChannelId,
    rulesPublishedAt:onboardingConfig.rulesPublishedAt,
    rulesUpdatedAt:onboardingConfig.rulesUpdatedAt,
    rulesNeedsPublish:!!onboardingConfig.rulesMessageId && onboardingConfig.rulesPublishedHash!==rulesTextHash(onboardingConfig.rulesText),
    totalWelcomed:onboardingState.stats.totalWelcomed,
    totalVerified:onboardingState.stats.totalVerified,
    bypassPrevented:onboardingState.stats.bypassPrevented,
    lastActionAt:onboardingState.stats.lastActionAt,
    lastError:onboardingState.stats.lastError
  };
}

async function ensureRulesReaction() {
  if (!onboardingConfig.rulesMessageId || !onboardingConfig.rulesMessageChannelId) throw new Error("Keine Regelnachricht verknüpft.");
  const emoji=encodeURIComponent("👍");
  await discordApi(`/channels/${onboardingConfig.rulesMessageChannelId}/messages/${onboardingConfig.rulesMessageId}/reactions/${emoji}/@me`,"PUT");
}
async function publishRulesMessage() {
  if (onboardingConfig.rulesMessageId) throw new Error("Es ist bereits eine Regelnachricht verknüpft. Nutze Aktualisieren, damit keine doppelte Nachricht entsteht.");
  const checks=onboardingChecks();
  const blockers=checks.errors.filter(x=>!x.startsWith("Discord-Regelscreening"));
  if (blockers.length) throw new Error(blockers[0]);
  const msg=await sendChannelMessage(onboardingConfig.rulesChannelId,onboardingConfig.rulesText,null);
  onboardingConfig.rulesMessageId=msg.id;
  onboardingConfig.rulesMessageChannelId=onboardingConfig.rulesChannelId;
  onboardingConfig.rulesPublishedAt=now();
  onboardingConfig.rulesUpdatedAt=onboardingConfig.rulesPublishedAt;
  onboardingConfig.rulesPublishedHash=rulesTextHash(onboardingConfig.rulesText);
  saveOnboardingConfig();
  await ensureRulesReaction();
  log(`✅ Regelnachricht veröffentlicht: ${msg.id}`);
  await sendDiscordLogEvent("onboarding.rules_published",{messageId:msg.id,channelMention:`<#${onboardingConfig.rulesChannelId}>`});
  return msg;
}
async function updateRulesMessage() {
  if (!onboardingConfig.rulesMessageId) throw new Error("Es ist noch keine Regelnachricht veröffentlicht.");
  if (onboardingConfig.rulesMessageChannelId !== onboardingConfig.rulesChannelId) throw new Error("Die gespeicherte Regelnachricht gehört zu einem anderen Regelkanal.");
  const msg=await discordApi(`/channels/${onboardingConfig.rulesChannelId}/messages/${onboardingConfig.rulesMessageId}`,"PATCH",{content:onboardingConfig.rulesText,allowed_mentions:{parse:[],users:[],roles:[]}});
  onboardingConfig.rulesUpdatedAt=now();
  onboardingConfig.rulesPublishedHash=rulesTextHash(onboardingConfig.rulesText);
  saveOnboardingConfig();
  await ensureRulesReaction();
  log(`✅ Regelnachricht aktualisiert: ${msg.id}`);
  await sendDiscordLogEvent("onboarding.rules_updated",{messageId:msg.id,channelMention:`<#${onboardingConfig.rulesChannelId}>`});
  return msg;
}

async function sendJoinWelcome(member) {
  if (!onboardingConfig.enabled || !member?.user?.id || member.user.bot) return;
  const entry=onboardingEntry(member);
  if (!isGatedMembership(member,entry) || entry.welcomedAt) { saveOnboardingState(); return; }
  try {
    const content=renderWelcomeMessage(onboardingConfig.welcomeMessage,member);
    await sendChannelMessage(onboardingConfig.welcomeChannelId,content,member.user.id);
    entry.welcomedAt=now();
    onboardingState.stats.totalWelcomed++;
    onboardingState.stats.lastActionAt=entry.welcomedAt;
    onboardingState.stats.lastError=null;
    saveOnboardingState();
    log(`✅ Meldekopf-Willkommen gesendet: ${memberDisplay(member)} (${member.user.id})`);
  } catch(err) {
    entry.lastError=err.message; onboardingState.stats.lastError=err.message; saveOnboardingState();
    fail(`❌ Willkommensnachricht fehlgeschlagen für ${memberDisplay(member)}:`,err.message);
  }
}

async function ensureVerifiedUnlockRole(userId,source="verification-repair"){
  const id=String(userId||"");
  const entry=onboardingState.members[id];
  if(!entry?.verifiedAt)return false;
  try{
    const member=await discordFetch(`/guilds/${IDS.guild}/members/${id}`);
    const hasRole=Array.isArray(member.roles)&&member.roles.includes(onboardingConfig.unlockRoleId);
    if(!hasRole){
      await discordApi(`/guilds/${IDS.guild}/members/${id}/roles/${onboardingConfig.unlockRoleId}`,"PUT");
      entry.roleRestoredAt=now();entry.lastSource=source;entry.lastError=null;saveOnboardingState();
      log(`🔧 ${RL("member")}-Rolle für verifiziertes Mitglied wiederhergestellt: ${memberDisplay(member)} (${id})`);
    }
    return true;
  }catch(err){
    entry.lastError=err.message;onboardingState.stats.lastError=err.message;saveOnboardingState();
    warn(`⚠️ ${RL("member")}-Rolle konnte für verifiziertes Mitglied ${id} nicht sichergestellt werden:`,err.message);
    return false;
  }
}
function scheduleVerifiedRoleCheck(userId){
  // Zwei kurze Nachprüfungen fangen Discord-Event-/REST-Races ab, ohne die Rolle
  // dauerhaft gegen bewusste spätere Admin-Änderungen zu erzwingen.
  setTimeout(()=>ensureVerifiedUnlockRole(userId,"post-verify-1500ms").catch(()=>{}),1500);
  setTimeout(()=>ensureVerifiedUnlockRole(userId,"post-verify-5000ms").catch(()=>{}),5000);
}
async function guardUnlockRole(member, source="member-update") {
  if(!onboardingConfig.enabled||!member?.user?.id||member.user.bot)return;
  const entry=onboardingEntry(member);

  // Eine gültige 👍-Bestätigung ist autoritativ. Ein verifiziertes Mitglied darf
  // niemals vom Bypass-Schutz seine Freischaltrolle wieder entzogen bekommen.
  if(!isGatedMembership(member,entry)||entry.verifiedAt){
    saveOnboardingState();
    return;
  }

  const memberRoles=Array.isArray(member.roles)?member.roles:[];
  const hasRole=memberRoles.includes(onboardingConfig.unlockRoleId);
  if(!hasRole){saveOnboardingState();return;}

  const trustedStaff=memberRoles.includes(IDS.roles.administrator)||memberRoles.includes(IDS.roles.moderator);
  if(trustedStaff){
    entry.staffBypassAt=entry.staffBypassAt||now();entry.lastSource=source;saveOnboardingState();return;
  }

  try{
    await discordApi(`/guilds/${IDS.guild}/members/${member.user.id}/roles/${onboardingConfig.unlockRoleId}`,"DELETE");
    entry.bypassPreventedAt=now();entry.lastSource=source;
    onboardingState.stats.bypassPrevented++;onboardingState.stats.lastActionAt=entry.bypassPreventedAt;
    saveOnboardingState();
    warn(`🛡️ Vorzeitige Freischaltrolle entfernt: ${memberDisplay(member)} (${member.user.id})`);
    await sendDiscordLogEvent("onboarding.premature_role_removed",{user:memberDisplay(member),userId:member.user.id});
  }catch(err){
    entry.lastError=err.message;onboardingState.stats.lastError=err.message;saveOnboardingState();
    fail("❌ Vorzeitige Freischaltrolle konnte nicht entfernt werden:",err.message);
  }
}
async function verifyReaction(payload) {
  if(!onboardingConfig.enabled)return;
  if(payload.guild_id!==IDS.guild)return;
  if(payload.channel_id!==onboardingConfig.rulesChannelId)return;
  if(payload.message_id!==onboardingConfig.rulesMessageId)return;
  if(payload.emoji?.name!=="👍")return;
  if(payload.user_id===state.bot.id||payload.member?.user?.bot)return;

  try{
    const member=payload.member?.user?payload.member:await discordFetch(`/guilds/${IDS.guild}/members/${payload.user_id}`);
    const entry=onboardingEntry(member);
    if(!isGatedMembership(member,entry)){saveOnboardingState();return;}

    if(entry.verifiedAt){
      // Idempotent: gültige Wiederholung darf nichts kaputt machen, stellt aber
      // eine eventuell fehlende Freischaltrolle wieder her.
      saveOnboardingState();
      scheduleVerifiedRoleCheck(payload.user_id);
      return;
    }

    // Autoritativer Zustand ZUERST speichern. Ab jetzt darf kein parallel
    // eintreffendes GUILD_MEMBER_UPDATE die Rolle als Bypass entfernen.
    entry.verifiedAt=now();
    entry.verifiedMessageId=payload.message_id;
    entry.verifiedEmoji="👍";
    entry.lastSource="MESSAGE_REACTION_ADD";
    entry.lastError=null;
    onboardingState.stats.totalVerified++;
    onboardingState.stats.lastActionAt=entry.verifiedAt;
    onboardingState.stats.lastError=null;
    saveOnboardingState();

    const hasRole=Array.isArray(member.roles)&&member.roles.includes(onboardingConfig.unlockRoleId);
    const timeoutResult=await applyNewMemberTimeout(member,payload.user_id);
    if(timeoutResult.applied){entry.newMemberTimeoutUntil=timeoutResult.until;saveOnboardingState();}
    try{
      if(!hasRole)await discordApi(`/guilds/${IDS.guild}/members/${payload.user_id}/roles/${onboardingConfig.unlockRoleId}`,"PUT");
      entry.roleGrantedAt=now();entry.lastError=null;saveOnboardingState();
    }catch(roleErr){
      // Die Regelbestätigung bleibt gültig. Nur die Rollenvergabe wird als Fehler
      // gespeichert und über die Nachprüfung erneut versucht.
      entry.lastError=`Rollenvergabe: ${roleErr.message}`;
      onboardingState.stats.lastError=entry.lastError;
      saveOnboardingState();
      scheduleVerifiedRoleCheck(payload.user_id);
      throw roleErr;
    }

    scheduleVerifiedRoleCheck(payload.user_id);
    log(`✅ Discord-Freischaltung: ${memberDisplay(member)} (${payload.user_id})`);
    await sendDiscordLogEvent("onboarding.verified",{user:memberDisplay(member),userId:payload.user_id,role:roleById(onboardingConfig.unlockRoleId)?.name||RT("member"),roleMention:`<@&${onboardingConfig.unlockRoleId}>`,timestamp:entry.verifiedAt},{append:newMemberTimeoutNote(timeoutResult)});
  }catch(err){
    onboardingState.stats.lastError=err.message;saveOnboardingState();
    fail(`❌ Reaktions-Freischaltung fehlgeschlagen für ${payload.user_id}:`,err.message);
    await sendDiscordLogEvent("onboarding.failed",{userId:payload.user_id,error:err.message});
  }
}
// 9.14.1: Schreibsperre für neue Mitglieder. Discords „Verifizierungsstufe Hoch“ (10 Minuten Mitgliedschaft) gilt nicht für Mitglieder mit
// einer Rolle, daher greift sie nach der Vergabe der Freischaltrolle nicht mehr. Stattdessen setzt der Bot optional einen Timeout.
// Er wird VOR der Rollenvergabe gesetzt, damit es kein Zeitfenster zum Schreiben gibt. Ein Fehler hier blockiert die Freischaltung nicht.
async function applyNewMemberTimeout(member,userId){
  const minutes=Number(onboardingConfig.newMemberTimeoutMinutes||0);
  if(!(minutes>0))return {applied:false,minutes:0};
  const until=Date.now()+minutes*60000;
  const existing=Date.parse(member?.communication_disabled_until||"");
  if(Number.isFinite(existing)&&existing>=until)return {applied:false,minutes,kept:true};
  try{
    await discordApi(`/guilds/${IDS.guild}/members/${userId}`,"PATCH",{communication_disabled_until:new Date(until).toISOString()});
    return {applied:true,minutes,until:new Date(until).toISOString()};
  }catch(err){
    warn(`⚠️ Timeout nach Regelannahme für ${userId} nicht gesetzt:`,err.message);
    return {applied:false,minutes,error:err.message};
  }
}
function newMemberTimeoutNote(r){
  if(!r||!r.minutes)return "";
  if(r.applied)return `\n⏳ Schreibsperre: ${r.minutes} Min. (Timeout)`;
  if(r.kept)return "";
  return `\n⚠️ Timeout (${r.minutes} Min.) konnte nicht gesetzt werden: ${r.error||"unbekannter Fehler"}`;
}
async function repairLegacyVerificationRace(){
  let repaired=0,roleRepairs=0;
  for(const [userId,entry] of Object.entries(onboardingState.members||{})){
    if(entry?.leftAt||entry?.verifiedAt)continue;
    if(entry?.verifiedMessageId!==onboardingConfig.rulesMessageId||entry?.verifiedEmoji!=="👍")continue;
    try{
      const member=await discordFetch(`/guilds/${IDS.guild}/members/${userId}`);
      if(!isGatedMembership(member,entry))continue;
      entry.verifiedAt=entry.verificationPendingAt||entry.firstSeenAt||now();
      entry.verificationPendingAt=null;
      entry.repairedAt=now();
      entry.lastSource="V6.2.2_LEGACY_RACE_REPAIR";
      entry.lastError=null;
      repaired++;
      saveOnboardingState();
      const before=Array.isArray(member.roles)&&member.roles.includes(onboardingConfig.unlockRoleId);
      if(!before){
        const ok=await ensureVerifiedUnlockRole(userId,"V6.2.2_LEGACY_RACE_REPAIR");
        if(ok)roleRepairs++;
      }
    }catch(err){
      // 404 bedeutet typischerweise: User ist nicht mehr auf dem Server. Keine
      // automatische Neuverifikation für spätere Rejoins.
      warn(`⚠️ Legacy-Freischaltung konnte für ${userId} nicht repariert werden:`,err.message);
    }
  }
  if(repaired){
    saveOnboardingState();
    await sendDiscordLogEvent("onboarding.repair",{count:repaired,detail:roleRepairs?`, ${roleRepairs} ${RL("member")}-Rolle(n) wiederhergestellt`:""});
    log(`🔧 Legacy-Verifikationen repariert: ${repaired}, Rollen wiederhergestellt: ${roleRepairs}`);
  }
}
function trackMemberRemove(data) {
  const userId=data?.user?.id; if(!userId) return;
  const entry=onboardingState.members[userId]||{};
  entry.leftAt=now(); entry.verifiedAt=null; entry.verificationPendingAt=null; entry.welcomedAt=null;
  onboardingState.members[userId]=entry; saveOnboardingState();
}
async function trackMemberAdd(member) {
  if (!member?.user?.id || member.user.bot) return;
  onboardingEntry(member); saveOnboardingState();
  await guardUnlockRole(member,"GUILD_MEMBER_ADD");
  await sendJoinWelcome(member);
}
async function trackMemberUpdate(member) {
  if (!member?.user?.id || member.user.bot) return;
  onboardingEntry(member); saveOnboardingState();
  await guardUnlockRole(member,"GUILD_MEMBER_UPDATE");
}


const nativeAutoModMessageIds=new Map();
const recentModeratedMessageIds=new Map();
function rememberModeratedMessage(id){id=String(id||"");if(!id)return;const until=Date.now()+30000;recentModeratedMessageIds.set(id,until);setTimeout(()=>{if((recentModeratedMessageIds.get(id)||0)<=Date.now())recentModeratedMessageIds.delete(id);},31000);}
function wasRecentlyModerated(id){const v=recentModeratedMessageIds.get(String(id||""))||0;if(v>Date.now())return true;if(v)recentModeratedMessageIds.delete(String(id||""));return false;}
function claimModerationMessage(id){id=String(id||"");if(!id)return true;if(wasRecentlyModerated(id))return false;rememberModeratedMessage(id);return true;}
function escapeRegex(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
function stripAllowedTerms(content,allowedTerms=[]){
  let out=String(content||"");
  for(const allowed of allowedTerms){if(allowed)out=out.replace(new RegExp(escapeRegex(allowed),"giu")," ");}
  return out;
}
function moderationCaseFold(value){return String(value||"").normalize("NFKC").toLocaleLowerCase("de-DE");}
function matchModerationRule(rule,content){
  const prepared=stripAllowedTerms(content,rule.allowedTerms);
  for(const term of rule.terms||[]){
    if(!term)continue;
    if(rule.matchMode==="fullword"){
      const rx=new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(term)}(?=$|[^\\p{L}\\p{N}_])`,"iu");
      if(rx.test(prepared))return term;
    }else if(moderationCaseFold(prepared).includes(moderationCaseFold(term)))return term;
  }
  return null;
}
function moderationRuleApplies(rule,message){
  if(!rule?.enabled)return false;
  if((rule.exemptChannelIds||[]).includes(String(message.channel_id||"")))return false;
  const roles=message.member?.roles||[];
  if((rule.exemptRoleIds||[]).some(id=>roles.includes(id)))return false;
  return true;
}
function moderationChecks(){
  const bits=roleBasePermissions(state.cache.botMember,state.cache.roles);
  return {manageMessages:(bits&PERM.MANAGE_MESSAGES)===PERM.MANAGE_MESSAGES,moderateMembers:(bits&PERM.MODERATE_MEMBERS)===PERM.MODERATE_MEMBERS,banMembers:(bits&PERM.BAN_MEMBERS)===PERM.BAN_MEMBERS,messageContentIntent:true,nativeAutoModExecutionIntent:true};
}
function appendModerationLog(entry){
  if(pgStore.enabled){pgStore.appendEvent("moderation",entry);pgStore.trimEvents("moderation",2000);return;}
  ensureDataDir();fs.appendFileSync(MODERATION_LOG_FILE,JSON.stringify(entry)+"\n","utf8");
  try{const lines=fs.readFileSync(MODERATION_LOG_FILE,"utf8").split("\n").filter(Boolean);if(lines.length>2000)fs.writeFileSync(MODERATION_LOG_FILE,lines.slice(-2000).join("\n")+"\n","utf8");}catch{}
}
function readModerationLog(limit=2000){
  if(pgStore.enabled)return pgStore.queryEvents("moderation",Math.max(1,Math.min(2000,Number(limit)||2000)));
  try{return fs.readFileSync(MODERATION_LOG_FILE,"utf8").split("\n").filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean).slice(-Math.max(1,Math.min(2000,Number(limit)||2000))).reverse();}catch{return[];}
}

function moderationUserHistory(query=""){
  const q=String(query||"").trim().toLocaleLowerCase("de-DE");
  const logs=readModerationLog(2000);
  const users=new Map();

  const ensure=(userId,username=null)=>{
    const id=String(userId||"").trim();if(!id)return null;
    if(!users.has(id)){
      const tracked=moderationState.users?.[id]||{};
      users.set(id,{
        userId:id,
        username:username||tracked.username||null,
        timeoutStage:Number(tracked.timeoutStage||0),
        timeoutCount:Number(tracked.timeoutCount||0),
        firstViolationAt:tracked.firstViolationAt||null,
        lastViolationAt:tracked.lastViolationAt||null,
        lastTimeoutAt:tracked.lastTimeoutAt||null,
        bannedAt:tracked.bannedAt||null,
        unbannedAt:tracked.unbannedAt||null,
        banReason:tracked.banReason||null,
        lastRuleName:tracked.lastRuleName||null,
        lastMatchedTerm:tracked.lastMatchedTerm||null,
        currentViolations:currentViolationCount(id),
        events:[]
      });
    }
    const row=users.get(id);
    if(username&&!row.username)row.username=username;
    return row;
  };

  for(const [id,row] of Object.entries(moderationState.users||{}))ensure(id,row?.username||null);

  for(const entry of logs){
    const row=ensure(entry.userId,entry.username);
    if(!row)continue;
    row.events.push({
      ts:entry.ts||null,
      source:entry.source||null,
      eventType:entry.eventType||"violation",
      channelId:entry.channelId||null,
      ruleName:entry.ruleName||entry.ruleId||null,
      matchedTerm:entry.matchedTerm||null,
      timeoutStage:entry.timeoutStage||null,
      repeatCount:entry.repeatCount||null,
      actions:Array.isArray(entry.actions)?entry.actions:[],
      banned:entry.banned===true
    });
  }

  let rows=[...users.values()];
  for(const row of rows){
    row.events.sort((a,b)=>String(b.ts||"").localeCompare(String(a.ts||"")));
    row.eventCount=row.events.length;
    row.lastEventAt=row.events[0]?.ts||row.lastViolationAt||row.lastTimeoutAt||row.bannedAt||row.unbannedAt||null;
  }

  if(q){
    rows=rows.filter(row=>[
      row.userId,row.username,row.lastRuleName,row.lastMatchedTerm,row.banReason
    ].some(v=>String(v||"").toLocaleLowerCase("de-DE").includes(q)) ||
      row.events.some(e=>[e.ruleName,e.matchedTerm,(e.actions||[]).join(" "),e.eventType]
        .some(v=>String(v||"").toLocaleLowerCase("de-DE").includes(q))));
  }

  rows.sort((a,b)=>String(b.lastEventAt||"").localeCompare(String(a.lastEventAt||"")));
  return {ok:true,query:String(query||""),items:rows.slice(0,200),total:rows.length};
}

function moderationStats(){
  const rows=readModerationLog(2000),nowMs=Date.now(),countDays=days=>rows.filter(x=>{const t=Date.parse(x.ts||"");return Number.isFinite(t)&&t>=nowMs-days*86400000;}).length;
  return {total:rows.length,days7:countDays(7),days30:countDays(30),lastActionAt:moderationState.lastActionAt,lastError:moderationState.lastError};
}
function moderationUserState(userId,username=null){
  const id=String(userId||"");
  if(!moderationState.users[id]){
    moderationState.users[id]={
      userId:id,username:username||null,timeoutStage:0,timeoutCount:0,
      firstViolationAt:null,lastViolationAt:null,lastTimeoutAt:null,
      bannedAt:null,unbannedAt:null,lastRuleName:null,lastMatchedTerm:null
    };
  }
  const row=moderationState.users[id];
  if(username)row.username=username;
  row.timeoutStage=Math.max(0,Math.min(3,Number(row.timeoutStage||0)));
  row.timeoutCount=Math.max(0,Number(row.timeoutCount||0));
  return row;
}
function recordViolation(userId,username,ruleName,matchedTerm){
  const row=moderationUserState(userId,username),ts=now();
  if(!row.firstViolationAt)row.firstViolationAt=ts;
  row.lastViolationAt=ts;row.lastRuleName=ruleName||null;row.lastMatchedTerm=matchedTerm||null;
  saveModerationState();return row;
}
function currentViolationCount(userId){
  const key=`${userId}:global-moderation`;
  const cutoff=Date.now()-Math.max(1,Number(moderationConfig.enforcement.repeatWindowMinutes||60))*60000;
  return (moderationState.recent[key]||[]).map(Number).filter(ts=>ts>=cutoff).length;
}
function recordRepeat(userId,ruleId,windowMinutes){
  const key=`${userId}:${ruleId}`,nowMs=Date.now(),cutoff=nowMs-Math.max(1,Number(windowMinutes||10))*60000;
  const recent=(moderationState.recent[key]||[]).map(Number).filter(ts=>ts>=cutoff);
  recent.push(nowMs);moderationState.recent[key]=recent.slice(-50);saveModerationState();return recent.length;
}
function resetRepeatCounter(userId,ruleId="global-moderation"){
  delete moderationState.recent[`${userId}:${ruleId}`];
  saveModerationState();
}
function recordTimeout(userId){
  const row=moderationUserState(userId);
  row.timeoutCount=Math.max(0,Number(row.timeoutCount||0))+1;
  row.timeoutStage=Math.min(3,Math.max(0,Number(row.timeoutStage||0))+1);
  row.lastTimeoutAt=now();saveModerationState();return row;
}
function renderTimeoutMessage(message,stage,reason){
  const cfg=moderationConfig.escalation||DEFAULT_MODERATION_CONFIG.escalation;
  const template=stage===1?cfg.timeout1:stage===2?cfg.timeout2:cfg.timeout3;
  return String(template||"")
    .replaceAll("{mention}",`<@${message.author.id}>`)
    .replaceAll("{user}",message.author.global_name||message.author.username||message.author.id)
    .replaceAll("{timeout}",String(stage))
    .replaceAll("{reason}",String(reason||"Moderationsverstoß"));
}
async function banMember(userId,reason){
  const encoded=encodeURIComponent(String(reason||moderationConfig.escalation?.banReason||"Moderationsverstoß").slice(0,480));
  await discordFetch(`/guilds/${IDS.guild}/bans/${userId}`,{
    method:"PUT",headers:{"X-Audit-Log-Reason":encoded},body:JSON.stringify({delete_message_seconds:0})
  });
  const row=moderationUserState(userId);row.bannedAt=now();row.banReason=reason||moderationConfig.escalation?.banReason||null;saveModerationState();return true;
}
async function listGuildBans(){
  const bans=await discordApi(`/guilds/${IDS.guild}/bans?limit=1000`);
  return (Array.isArray(bans)?bans:[]).map(x=>({
    userId:String(x.user?.id||""),username:x.user?.global_name||x.user?.username||x.user?.id||"Unbekannt",
    accountUsername:x.user?.username||null,reason:x.reason||null,tracked:moderationState.users[String(x.user?.id||"")]||null
  }));
}
async function unbanMember(userId,actor="Control Center"){
  await discordApi(`/guilds/${IDS.guild}/bans/${userId}`,"DELETE",null,{
    "X-Audit-Log-Reason":encodeURIComponent(`Ban aufgehoben durch ${String(actor).slice(0,120)}`)
  });
  const row=moderationUserState(userId);row.unbannedAt=now();row.bannedAt=null;row.timeoutStage=0;row.timeoutCount=0;row.lastTimeoutAt=null;
  resetRepeatCounter(userId);saveModerationState();
  await sendDiscordLogEvent("moderation.unban",{mention:`<@${userId}>`,user:row.username||userId,userId,actor:String(actor||"Control Center")});
  appendModerationLog({ts:now(),source:"control-center",eventType:"unban",userId,username:row.username||null,channelId:null,messageId:null,ruleId:"manual-unban",ruleName:"Ban aufgehoben",matchedTerm:null,actions:[`Ban aufgehoben durch ${String(actor||"Control Center")}`]});
  return true;
}
function resetModerationUser(userId){
  const row=moderationUserState(userId);row.timeoutStage=0;row.timeoutCount=0;row.lastTimeoutAt=null;row.bannedAt=null;
  // Beide Eskalationspfade zurücksetzen: allgemeine Moderation und Spam-Protect.
  resetRepeatCounter(userId);
  resetRepeatCounter(userId,"spam-protect");
  saveModerationState();return row;
}
async function sanctionedUsers(){
  // Nicht nur intern eskalierte Nutzer berücksichtigen. Spam-Protect führt bewusst
  // eine getrennte Eskalation und konnte deshalb bisher einen echten Discord-Timeout
  // setzen, ohne dass der Nutzer in der Sanktionsliste auftauchte.
  const candidates=new Map();
  for(const x of Object.values(moderationState.users||{})){
    if(!x?.userId||x.bannedAt)continue;
    if(Number(x.timeoutStage||0)>0||currentViolationCount(x.userId)>0){
      candidates.set(String(x.userId),{...x,currentViolations:currentViolationCount(x.userId),spamOffenses:spamOffenseCount(x.userId,moderationConfig.spamProtect?.action?.repeatWindowMinutes||1440)});
    }
  }
  // Persistente Moderationslogs als zweite Quelle verwenden. Damit werden auch
  // aktive Spam-Timeouts sichtbar, deren allgemeine Timeout-Stufe absichtlich 0 bleibt.
  for(const entry of readModerationLog(500)){
    if(entry?.eventType!=="timeout"||!entry?.userId)continue;
    const id=String(entry.userId);
    if(candidates.has(id))continue;
    const tracked=moderationState.users?.[id]||{};
    candidates.set(id,{
      userId:id,
      username:entry.username||tracked.username||null,
      timeoutStage:Number(tracked.timeoutStage||0),
      timeoutCount:Number(tracked.timeoutCount||0),
      firstViolationAt:tracked.firstViolationAt||null,
      lastViolationAt:tracked.lastViolationAt||entry.ts||null,
      lastTimeoutAt:tracked.lastTimeoutAt||entry.ts||null,
      lastRuleName:tracked.lastRuleName||entry.ruleName||null,
      lastMatchedTerm:tracked.lastMatchedTerm||entry.matchedTerm||null,
      bannedAt:tracked.bannedAt||null,
      currentViolations:currentViolationCount(id),
      spamOffenses:spamOffenseCount(id,moderationConfig.spamProtect?.action?.repeatWindowMinutes||1440),
      lastTimeoutSource:entry.source||null,
      lastTimeoutRule:entry.ruleName||null
    });
  }
  const rows=[...candidates.values()];
  await Promise.all(rows.map(async row=>{
    try{
      const member=await discordApi(`/guilds/${IDS.guild}/members/${row.userId}`);
      const until=member?.communication_disabled_until||null;
      row.activeTimeoutUntil=until&&new Date(until).getTime()>Date.now()?until:null;
    }catch{row.activeTimeoutUntil=null;}
  }));
  // Historische Spam-Timeouts ohne aktuell laufenden Timeout und ohne sonstige
  // Eskalation nicht unnötig als aktive Sanktion anzeigen.
  return rows
    .filter(row=>row.activeTimeoutUntil||Number(row.timeoutStage||0)>0||Number(row.currentViolations||0)>0)
    .sort((a,b)=>String(b.activeTimeoutUntil||b.lastTimeoutAt||b.lastViolationAt||"").localeCompare(String(a.activeTimeoutUntil||a.lastTimeoutAt||a.lastViolationAt||"")));
}
async function clearTimeoutMember(userId,actor="Control Center",resetEscalation=false){
  if(!moderationChecks().moderateMembers)throw new Error("Dem Bot fehlt die Discord-Berechtigung Mitglieder moderieren.");
  const memberPath=`/guilds/${IDS.guild}/members/${userId}`;
  let before=null;
  try{before=await discordApi(memberPath);}catch(err){
    if(Number(err?.status)===404)throw new Error("Der Nutzer ist aktuell kein Mitglied des Discord-Servers.");
    throw err;
  }
  const currentUntil=before?.communication_disabled_until||null;
  if(!currentUntil||Date.parse(currentUntil)<=Date.now()){
    throw new Error("Für diesen Nutzer ist bei Discord aktuell kein aktiver Timeout vorhanden.");
  }
  let firstError=null;
  try{
    await discordApi(memberPath,"PATCH",{communication_disabled_until:null});
  }catch(err){
    firstError=err;
    // Fallback für Discord/API-Proxies, die null beim PATCH nicht akzeptieren:
    // einen Zeitpunkt knapp in der Vergangenheit setzen, was den Timeout ebenfalls beendet.
    try{await discordApi(memberPath,"PATCH",{communication_disabled_until:new Date(Date.now()-5000).toISOString()});}
    catch(fallbackErr){
      const detail=fallbackErr?.body?.message||firstError?.body?.message||fallbackErr?.message||firstError?.message||"Unbekannter Discord-API-Fehler";
      throw new Error(`Timeout konnte bei Discord nicht aufgehoben werden: ${detail}`);
    }
  }
  const verify=await discordApi(memberPath);
  const afterUntil=verify?.communication_disabled_until||null;
  if(afterUntil&&Date.parse(afterUntil)>Date.now())throw new Error(`Discord meldet den Timeout weiterhin als aktiv bis ${afterUntil}.`);
  const row=moderationUserState(userId,verify?.user?.username||before?.user?.username||null);
  if(resetEscalation){
    row.timeoutStage=0;row.timeoutCount=0;row.lastTimeoutAt=null;resetRepeatCounter(userId);resetRepeatCounter(userId,"spam-protect");
  }else saveModerationState();
  await sendDiscordLogEvent("moderation.untimeout",{mention:`<@${userId}>`,user:row.username||userId,userId,actor:String(actor||"Control Center"),resetEscalation:resetEscalation?"Ja":"Nein"});
  appendModerationLog({ts:now(),source:"control-center",eventType:"untimeout",userId,username:row.username||null,channelId:null,messageId:null,ruleId:"manual-untimeout",ruleName:"Timeout aufgehoben",matchedTerm:null,actions:[`Timeout aufgehoben durch ${String(actor||"Control Center")}${resetEscalation?" · Eskalation zurückgesetzt":""}`]});
  return {ok:true,userId,previousTimeoutUntil:currentUntil,resetEscalation};
}
async function timeoutMember(userId,minutes){
  if(!minutes)return false;
  await discordApi(`/guilds/${IDS.guild}/members/${userId}`,"PATCH",{communication_disabled_until:new Date(Date.now()+Math.max(1,minutes)*60000).toISOString()});return true;
}
function renderLinkWarning(template,message){
  return String(template||DEFAULT_MODERATION_CONFIG.linkPolicy.warningText)
    .replaceAll("{mention}",`<@${message.author.id}>`)
    .replaceAll("{user}",message.author.global_name||message.author.username||message.author.id);
}
function renderModerationWarning(template,message,rule){
  return String(template||DEFAULT_MODERATION_CONFIG.warningText).replaceAll("{mention}",`<@${message.author.id}>`).replaceAll("{user}",message.author.global_name||message.author.username||message.author.id).replaceAll("{rule}",rule.name||"Moderationsregel");
}
async function writeModerationDiscordLog(entry,options={}){
  const eventType=entry.eventType||"violation";
  const map={violation:"moderation.violation",timeout:"moderation.timeout",ban:"moderation.ban",native:"moderation.native"};
  const eventKey=map[eventType];if(!eventKey)return;
  const channel=entry.channelId?channelById(entry.channelId):null;
  const matched=entry.matchedTerm?String(entry.matchedTerm).slice(0,120):"";
  return await sendDiscordLogEvent(eventKey,{
    mention:entry.userId?`<@${entry.userId}>`:"",user:entry.username||entry.userId||"Unbekannt",userId:entry.userId||"",
    channel:channel?.name||entry.channelId||"unbekannt",channelMention:entry.channelId?`<#${entry.channelId}>`:"unbekannter Kanal",
    rule:entry.ruleName||entry.ruleId||"unbekannt",matched,matchedPart:matched?` · Treffer: \`${matched}\``:"",
    actions:(entry.actions||[]).join(", ")||"protokolliert",timeoutStage:entry.timeoutStage||"",reason:entry.reason||"",source:entry.source||""
  },options);
}
async function handleNativeAutoModExecution(ev){
  if(!ev||ev.guild_id!==IDS.guild)return;
  if(ev.message_id&&wasRecentlyModerated(ev.message_id))return;
  if(ev.message_id){nativeAutoModMessageIds.set(String(ev.message_id),Date.now()+15000);setTimeout(()=>nativeAutoModMessageIds.delete(String(ev.message_id)),16000);}
  const entry={ts:now(),source:"native",eventType:"native",userId:String(ev.user_id||""),username:null,channelId:String(ev.channel_id||""),messageId:ev.message_id?String(ev.message_id):null,ruleId:String(ev.rule_id||""),ruleName:"Discord AutoMod",matchedTerm:ev.matched_keyword||null,actions:["Discord AutoMod"]};
  appendModerationLog(entry);moderationState.lastActionAt=entry.ts;saveModerationState();await writeModerationDiscordLog(entry);
}

async function applyEscalation(message,ruleName,matchedTerm,actions,noticeText){
  const row=recordViolation(message.author.id,message.author.username||null,ruleName,matchedTerm);
  const count=recordRepeat(message.author.id,"global-moderation",moderationConfig.enforcement.repeatWindowMinutes);
  const threshold=Math.max(1,Number(moderationConfig.enforcement.repeatThreshold||3));
  const esc=moderationConfig.escalation||DEFAULT_MODERATION_CONFIG.escalation;

  if(count<threshold||!esc.enabled){
    if(moderationConfig.enforcement.warnUser&&noticeText){
      await sendChannelMessage(message.channel_id,noticeText,message.author.id);
      actions.push("Hinweis gesendet");
    }
    return {eventType:"violation",timeoutStage:Number(row.timeoutStage||0),repeatCount:count,banned:false};
  }

  resetRepeatCounter(message.author.id);
  const nextStage=Number(row.timeoutStage||0)+1;
  if(nextStage>=4){
    if(!moderationChecks().banMembers)throw new Error("Ban wäre fällig, aber dem Bot fehlt die Berechtigung Mitglieder bannen.");
    await banMember(message.author.id,esc.banReason);
    actions.push("User gebannt");
    return {eventType:"ban",timeoutStage:3,repeatCount:threshold,banned:true};
  }

  if(!moderationChecks().moderateMembers)throw new Error("Timeout wäre fällig, aber dem Bot fehlt die Berechtigung Mitglieder moderieren.");
  await timeoutMember(message.author.id,moderationConfig.enforcement.timeoutMinutes);
  const updated=recordTimeout(message.author.id);
  const timeoutMessage=renderTimeoutMessage(message,updated.timeoutStage,ruleName);
  await sendChannelMessage(message.channel_id,timeoutMessage,message.author.id);
  actions.push(`${updated.timeoutStage}. Timeout · ${moderationConfig.enforcement.timeoutMinutes} Min.`);
  return {eventType:"timeout",timeoutStage:updated.timeoutStage,repeatCount:threshold,banned:false};
}
async function applyWordFilterEscalation(message,ruleName,matchedTerm,actions,noticeText){
  const row=recordViolation(message.author.id,message.author.username||null,ruleName,matchedTerm);
  const count=recordRepeat(message.author.id,`word-filter:${ruleName}`,moderationConfig.enforcement.repeatWindowMinutes);
  const threshold=Math.max(1,Number(moderationConfig.enforcement.repeatThreshold||3));
  if(moderationConfig.enforcement.warnUser&&noticeText){
    await sendChannelMessage(message.channel_id,noticeText,message.author.id);
    actions.push("Hinweis gesendet");
  }
  if(count<threshold)return {eventType:"violation",timeoutStage:Number(row.timeoutStage||0),repeatCount:count,banned:false};
  resetRepeatCounter(message.author.id,`word-filter:${ruleName}`);
  const stage=Math.max(1,Math.min(3,Number(row.timeoutStage||0)+1));
  row.timeoutStage=stage;saveModerationState();
  if(!moderationChecks().moderateMembers)throw new Error("Wortfilter-Eskalation wäre fällig, aber dem Bot fehlt Mitglieder moderieren.");
  const base=Math.max(1,Number(moderationConfig.enforcement.timeoutMinutes||10));
  const timeoutMinutes=Math.min(40320,base*stage);
  await timeoutMember(message.author.id,timeoutMinutes);recordTimeout(message.author.id);
  actions.push(`Wortfilter-Eskalation: Timeout ${timeoutMinutes} Min.`);
  return {eventType:"timeout",timeoutStage:stage,repeatCount:threshold,banned:false};
}

function isStaffLinkExempt(message){
  const roles=new Set((message?.member?.roles||[]).map(String));
  return roles.has(String(IDS.roles.administrator))||roles.has(String(IDS.roles.moderator));
}

function spamOffenseCount(userId,windowMinutes){
  const key=`${userId}:spam-protect`;
  const cutoff=Date.now()-Math.max(1,Number(windowMinutes||1440))*60000;
  return (moderationState.recent[key]||[]).map(Number).filter(ts=>ts>=cutoff).length;
}
async function handleSpamProtect(message){
  const cfg=moderationConfig.spamProtect||DEFAULT_SPAM_PROTECT_CONFIG;
  if(!cfg.enabled)return false;
  const detection=spamDetector.inspect(message,cfg,{staffRoleIds:[IDS.roles.administrator,IDS.roles.moderator]});
  if(!detection)return false;
  const actions=[];
  try{
    if(cfg.action?.deleteMessage!==false){
      if(!moderationChecks().manageMessages)throw new Error("Spam-Nachricht sollte gelöscht werden, aber dem Bot fehlt die Berechtigung Nachrichten verwalten.");
      await discordApi(`/channels/${message.channel_id}/messages/${message.id}`,"DELETE");
      actions.push("Nachricht gelöscht");
    }
    const offenseCount=recordRepeat(message.author.id,"spam-protect",cfg.action?.repeatWindowMinutes||1440);
    const stages=Array.isArray(cfg.action?.timeoutMinutes)?cfg.action.timeoutMinutes:[1,5,15];
    const stage=Math.max(1,Math.min(3,offenseCount));
    const timeoutMinutes=Math.max(0,Number(stages[Math.min(stage-1,stages.length-1)]||0));
    if(timeoutMinutes>0){
      if(!moderationChecks().moderateMembers)throw new Error("Spam-Timeout wäre fällig, aber dem Bot fehlt die Berechtigung Mitglieder moderieren.");
      await timeoutMember(message.author.id,timeoutMinutes);
      actions.push(`Spam-Timeout ${timeoutMinutes} Min.`);
    }
    if(cfg.action?.warnUser!==false){
      const notice=renderSpamWarning(cfg.action?.warningText,message,detection,offenseCount,timeoutMinutes);
      await sendChannelMessage(message.channel_id,notice,message.author.id);
      actions.push("Hinweis gesendet");
    }
    const entry={
      ts:now(),source:"spam-protect",eventType:timeoutMinutes>0?"timeout":"violation",userId:String(message.author.id),username:message.author.username||null,
      channelId:String(message.channel_id),messageId:String(message.id),ruleId:`spam-${detection.type}`,ruleName:detection.label,
      matchedTerm:detection.detail,actions,timeoutStage:stage,repeatCount:offenseCount,reason:detection.detail,
      spamType:detection.type,spamCount:detection.count,spamThreshold:detection.threshold
    };
    appendModerationLog(entry);moderationState.lastActionAt=entry.ts;moderationState.lastError=null;saveModerationState();await writeModerationDiscordLog(entry);
  }catch(err){
    moderationState.lastError=err.message;saveModerationState();
    appendModerationLog({ts:now(),source:"spam-protect",eventType:"violation",userId:String(message.author.id),username:message.author.username||null,channelId:String(message.channel_id),messageId:String(message.id),ruleId:`spam-${detection.type}`,ruleName:detection.label,matchedTerm:detection.detail,actions:[`Fehler: ${err.message}`]});
  }
  return true;
}

async function moderateMessage(message){
  if(!moderationConfig.enabled||!message||message.guild_id!==IDS.guild||message.author?.bot||message.webhook_id)return;
  if(message.id&&wasRecentlyModerated(message.id))return;
  if((nativeAutoModMessageIds.get(String(message.id||""))||0)>Date.now())return;
  // 9.6.0: Modul „Discord-Moderation“ (Spam-Schutz, Link-Filter) und Modul „Wortfilter“ (+ Discord-Schalter) getrennt.
  const autoModerationOn=moduleState.isOn("discordModeration");
  const wordFilterOnDiscord=moduleState.isOn("wordFilter")&&moduleState.feature("wordFilterDiscord",true);
  if(autoModerationOn&&await handleSpamProtect(message))return;
  if(!String(message.content||"").trim())return;

  if(autoModerationOn&&!isStaffLinkExempt(message)){
    const blockedLinks=disallowedLinks(message.content,moderationConfig.linkPolicy);
    if(blockedLinks.length){
      const actions=[];
      try{
        if(moderationConfig.enforcement.deleteMessage){
          await discordApi(`/channels/${message.channel_id}/messages/${message.id}`,"DELETE");
          actions.push("Nachricht gelöscht");
        }
        const notice=renderLinkWarning(moderationConfig.linkPolicy.warningText,message);
        const escalation=await applyEscalation(message,"Unerlaubter Link",blockedLinks[0].normalized,actions,notice);
        const entry={
          ts:now(),source:"link-policy",eventType:escalation.eventType,userId:String(message.author.id),username:message.author.username||null,
          channelId:String(message.channel_id),messageId:String(message.id),ruleId:"link-whitelist",ruleName:"Link-Whitelist",
          matchedTerm:blockedLinks[0].normalized,actions,timeoutStage:escalation.timeoutStage,repeatCount:escalation.repeatCount||null,
          banned:!!escalation.banned,blockedLinks:blockedLinks.map(x=>x.normalized).slice(0,10)
        };
        appendModerationLog(entry);moderationState.lastActionAt=entry.ts;moderationState.lastError=null;saveModerationState();await writeModerationDiscordLog(entry);
      }catch(err){
        moderationState.lastError=err.message;saveModerationState();
        appendModerationLog({ts:now(),source:"link-policy",eventType:"violation",userId:String(message.author.id),username:message.author.username||null,channelId:String(message.channel_id),messageId:String(message.id),ruleId:"link-whitelist",ruleName:"Link-Whitelist",matchedTerm:blockedLinks[0]?.normalized||null,actions:[`Fehler: ${err.message}`]});
      }
      return;
    }
  }

  let centralWordFilterMatched=false;
  if(wordFilterOnDiscord&&pgStore.enabled&&!isStaffLinkExempt(message)){
    const hit=matchWordFilter(wordFilterRefresh(),"discord",message.content||"");
    if(hit){
      centralWordFilterMatched=true;
      if(message.id&&!claimModerationMessage(message.id))return;
      const meta=hit.term.metadata||{};
      const roles=message.member?.roles||[];
      if((meta.exemptChannelIds||[]).includes(String(message.channel_id||""))||(meta.exemptRoleIds||[]).some(id=>roles.includes(String(id))))return;
      const policy=wordFilterPolicy(hit);
      const effectiveAction=hit.term.test_only?"log":policy.action;
      const actions=[];
      try{pgStore.recordWordFilterHit({term_id:hit.term.term_id,platform:"discord",category_id:hit.term.category_id,action:effectiveAction,user_id:String(message.author.id||"")});}catch(e){console.error("⚠️ Discord-Wortfilter-Trefferstatistik:",e.message);}
      try{
        if(effectiveAction==="delete"||effectiveAction==="timeout"){
          if(!moderationChecks().manageMessages)throw new Error("Nachricht sollte gelöscht werden, aber dem Bot fehlt Nachrichten verwalten.");
          await discordApi(`/channels/${message.channel_id}/messages/${message.id}`,"DELETE");
          actions.push("Nachricht gelöscht");rememberModeratedMessage(message.id);
        }
        if(effectiveAction==="warn"){
          const tpl=policy.messageTemplate||"{mention} bitte beachte unsere Community-Regeln.";
          const notice=String(tpl).replaceAll("{mention}",`<@${message.author.id}>`).replaceAll("{user}",message.author.global_name||message.author.username||message.author.id).replaceAll("{term}",hit.term.term||"").replaceAll("{category}",hit.term.category_id||"").replaceAll("{severity}",String(hit.term.severity||""));
          await sendChannelMessage(message.channel_id,notice,message.author.id);actions.push("Hinweis an Nutzer gesendet");
        }
        if(effectiveAction==="timeout"){
          if(!moderationChecks().moderateMembers)throw new Error("Timeout wäre fällig, aber dem Bot fehlt Mitglieder moderieren.");
          const mins=Math.max(1,Math.ceil((policy.timeoutSeconds||600)/60));
          await timeoutMember(message.author.id,mins);actions.push(`Timeout ${mins} Min.`);
        }
        if(effectiveAction==="notify")actions.push("Moderator-Hinweis angefordert");
        if(effectiveAction==="log"||effectiveAction==="allow")actions.push(effectiveAction==="allow"?"Zugelassen":"Nur protokolliert");
        let escalation=null;
        if(!hit.term.test_only&&(policy.escalate||meta.legacyEscalate)){
          const fakeRule={name:meta.legacyRuleName||`Wortfilter · ${hit.term.category_id}`};
          const notice=renderModerationWarning(meta.legacyWarningText||moderationConfig.warningText,message,fakeRule);
          escalation=await applyWordFilterEscalation(message,fakeRule.name,hit.term.term,actions,null);
        }
        const entry={ts:now(),source:"word-filter",eventType:escalation?.eventType||(effectiveAction==="timeout"?"timeout":"violation"),userId:String(message.author.id),username:message.author.username||null,channelId:String(message.channel_id),messageId:String(message.id),ruleId:hit.term.term_id,ruleName:meta.legacyRuleName||`Wortfilter · ${hit.term.category_id}`,matchedTerm:hit.term.term,actions,reason:`Schweregrad ${hit.term.severity}`,timeoutStage:escalation?.timeoutStage||null,repeatCount:escalation?.repeatCount||null,banned:!!escalation?.banned,testOnly:hit.term.test_only===true};
        if(effectiveAction==="notify"){
          const sent=await writeModerationDiscordLog(entry,{force:true});
          const dest=sent?.channelId?channelById(sent.channelId):null;
          entry.actions=entry.actions.filter(x=>x!=="Moderator-Hinweis angefordert");
          entry.actions.push(sent?.sent?`Moderator-Hinweis → #${dest?.name||sent.channelId}`:`Moderator-Hinweis nicht gesendet (${sent?.reason||sent?.error||"unbekannt"})`);
        }
        appendModerationLog(entry);moderationState.lastActionAt=entry.ts;moderationState.lastError=null;saveModerationState();rememberModeratedMessage(message.id);
        if(effectiveAction!=="notify")await writeModerationDiscordLog(entry);
      }catch(err){
        moderationState.lastError=err.message;saveModerationState();
        appendModerationLog({ts:now(),source:"word-filter",eventType:"violation",userId:String(message.author.id),username:message.author.username||null,channelId:String(message.channel_id),messageId:String(message.id),ruleId:hit.term.term_id,ruleName:"Zentraler Wortfilter",matchedTerm:hit.term.term,actions:[`Fehler: ${err.message}`]});
      }
      return;
    }
  }

  // Legacy-Regeln bleiben vollständig erhalten und greifen, wenn kein zentraler Begriff passt.
  if(wordFilterOnDiscord && !wordFilterCentralReady && !centralWordFilterMatched && !isStaffLinkExempt(message)) for(const rule of moderationConfig.rules||[]){
    if(!moderationRuleApplies(rule,message))continue;
    const matchedTerm=matchModerationRule(rule,message.content);if(!matchedTerm)continue;
    const actions=[];
    try{
      if(moderationConfig.enforcement.deleteMessage){
        await discordApi(`/channels/${message.channel_id}/messages/${message.id}`,"DELETE");
        actions.push("Nachricht gelöscht");
      }
      const notice=renderModerationWarning(moderationConfig.warningText,message,rule);
      const escalation=await applyEscalation(message,rule.name,matchedTerm,actions,notice);
      const entry={
        ts:now(),source:"bot",eventType:escalation.eventType,userId:String(message.author.id),username:message.author.username||null,
        channelId:String(message.channel_id),messageId:String(message.id),ruleId:rule.id,ruleName:rule.name,matchedTerm,actions,
        timeoutStage:escalation.timeoutStage,repeatCount:escalation.repeatCount||null,banned:!!escalation.banned
      };
      appendModerationLog(entry);moderationState.lastActionAt=entry.ts;moderationState.lastError=null;saveModerationState();await writeModerationDiscordLog(entry);
    }catch(err){
      moderationState.lastError=err.message;saveModerationState();
      appendModerationLog({ts:now(),source:"bot",eventType:"violation",userId:String(message.author.id),username:message.author.username||null,channelId:String(message.channel_id),messageId:String(message.id),ruleId:rule.id,ruleName:rule.name,matchedTerm,actions:[`Fehler: ${err.message}`]});
    }
    break;
  }
}
function moderationCatalog(){
  return {channels:state.cache.channels.filter(x=>[0,5,15].includes(Number(x.type))).sort((a,b)=>Number(a.position)-Number(b.position)).map(x=>({id:x.id,name:x.name,parentId:x.parent_id||null})),
    roles:state.cache.roles.filter(x=>x.id!==IDS.guild).sort((a,b)=>Number(b.position)-Number(a.position)).map(x=>({id:x.id,name:x.name,position:x.position}))};
}
function moderationView(){return {ok:true,config:moderationConfig,catalog:moderationCatalog(),checks:moderationChecks(),stats:moderationStats(),logFileExists:pgStore.enabled?true:fs.existsSync(MODERATION_LOG_FILE)};}
function testModeration(content,channelId="",roleIds=[]){
  const fake={channel_id:String(channelId||""),member:{roles:Array.isArray(roleIds)?roleIds.map(String):[]},content:String(content||"")},matches=[];
  const links=extractLinksFromMessage(fake.content),blocked=disallowedLinks(fake.content,moderationConfig.linkPolicy);
  if(moderationConfig.linkPolicy?.enabled&&links.length){
    matches.push({
      ruleId:"link-whitelist",ruleName:"Link-Whitelist",matchedTerm:blocked[0]?.normalized||null,
      linkCheck:{detected:links.map(x=>x.normalized),blocked:blocked.map(x=>x.normalized),allowed:links.filter(x=>isWhitelistedLink(x,moderationConfig.linkPolicy)).map(x=>x.normalized)},
      actions:blocked.length?{deleteMessage:moderationConfig.enforcement.deleteMessage,warnUser:moderationConfig.enforcement.warnUser,repeatThreshold:moderationConfig.enforcement.repeatThreshold,repeatWindowMinutes:moderationConfig.enforcement.repeatWindowMinutes,timeoutMinutes:moderationConfig.enforcement.timeoutMinutes}:{}
    });
  }
  for(const rule of moderationConfig.rules||[]){
    if(!moderationRuleApplies(rule,fake))continue;
    const term=matchModerationRule(rule,fake.content);
    if(term)matches.push({ruleId:rule.id,ruleName:rule.name,matchedTerm:term,actions:{deleteMessage:moderationConfig.enforcement.deleteMessage,warnUser:moderationConfig.enforcement.warnUser,repeatThreshold:moderationConfig.enforcement.repeatThreshold,repeatWindowMinutes:moderationConfig.enforcement.repeatWindowMinutes,timeoutMinutes:moderationConfig.enforcement.timeoutMinutes}});
  }
  return {ok:true,matches};
}

// Lightweight, bounded operational counters: no message content or user identifiers.
const discordPerformance={windowStart:Date.now(),windowReceived:0,ratePerSecond:null,lastLatencyMs:null,processed:0,failedWrites:0,lastError:null,lastErrorAt:null,pendingMessages:0,peakPendingMessages:0,dbLatencyMs:null,dbOperations:0,dbSlowOperations:0,lastDbErrorAt:null};
function recordDiscordArrival(){
 const now=Date.now();discordPerformance.windowReceived++;
 const elapsed=now-discordPerformance.windowStart;
 if(elapsed>=5000){discordPerformance.ratePerSecond=Math.round(discordPerformance.windowReceived*10000/elapsed)/10;discordPerformance.windowReceived=0;discordPerformance.windowStart=now;}
}
function discordPerformanceSnapshot(){return {ratePerSecond:discordPerformance.ratePerSecond,processingLatencyMs:discordPerformance.lastLatencyMs,processed:discordPerformance.processed,failedWrites:discordPerformance.failedWrites,lastError:discordPerformance.lastError,lastErrorAt:discordPerformance.lastErrorAt,pendingBatches:discordPerformance.pendingMessages,peakPendingMessages:discordPerformance.peakPendingMessages,queueCapacity:null,retries:null,lastFlush:null,dbLatencyMs:discordPerformance.dbLatencyMs,dbOperations:discordPerformance.dbOperations,dbSlowOperations:discordPerformance.dbSlowOperations,lastDbErrorAt:discordPerformance.lastDbErrorAt};}
function measuredLevelOperation(fn){const start=process.hrtime.bigint();try{return fn();}catch(e){discordPerformance.lastDbErrorAt=new Date().toISOString();throw e;}finally{const elapsed=Number(process.hrtime.bigint()-start)/1e6;discordPerformance.dbOperations++;discordPerformance.dbLatencyMs=Math.round(elapsed*10)/10;if(elapsed>1000)discordPerformance.dbSlowOperations++;}}
function clearHeartbeat(){if(heartbeatTimer)clearInterval(heartbeatTimer);heartbeatTimer=null;}
function sendGateway(payload){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(payload));}
function startHeartbeat(intervalMs){clearHeartbeat();const beat=()=>{if(!heartbeatAcked){warn("⚠️ Discord Heartbeat ACK fehlt. Gateway wird neu verbunden.");try{ws?.close(4000,"heartbeat timeout");}catch{}return;}heartbeatAcked=false;sendGateway({op:1,d:state.gateway.sequence});};setTimeout(beat,Math.floor(Math.random()*intervalMs));heartbeatTimer=setInterval(beat,intervalMs);}
function identify(){sendGateway({op:2,d:{token:process.env.DISCORD_BOT_TOKEN,intents:INTENTS,properties:{os:"linux",browser:"bot-control-center",device:"bot-control-center"}}});}
function scheduleReconnect(){if(reconnectTimer)return;state.gateway.reconnects++;const delay=Math.min(60000,Math.max(3000,state.gateway.reconnects*5000));log(`🔄 Discord Gateway Reconnect in ${Math.round(delay/1000)}s ...`);reconnectTimer=setTimeout(()=>{reconnectTimer=null;connectGateway().catch(err=>{state.gateway.lastError=err.message;fail("❌ Discord Gateway Reconnect fehlgeschlagen:",err.message);scheduleReconnect();});},delay);}
async function connectGateway(){
  const missing=missingConfig(); state.checks.config=missing; if(missing.length)throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(", ")}`);
  const gatewayInfo=await discordFetch("/gateway/bot"); const gatewayUrl=gatewayInfo?.url?`${gatewayInfo.url}/?v=10&encoding=json`:GATEWAY_FALLBACK;
  log("🔌 Discord Gateway verbindet ..."); ws=new WebSocket(gatewayUrl);
  ws.addEventListener("open",()=>{state.gateway.connected=true;state.gateway.lastError=null;});
  ws.addEventListener("message",async(event)=>{try{const payload=JSON.parse(event.data);state.gateway.lastEventAt=now();if(payload.s!==null&&payload.s!==undefined)state.gateway.sequence=payload.s;switch(payload.op){case 10:{const interval=Number(payload.d?.heartbeat_interval||45000);heartbeatAcked=true;startHeartbeat(interval);identify();break;}case 11:heartbeatAcked=true;break;case 1:heartbeatAcked=true;sendGateway({op:1,d:state.gateway.sequence});break;case 7:warn("⚠️ Discord fordert Reconnect an.");try{ws.close(4000,"server requested reconnect");}catch{}break;case 9:warn("⚠️ Discord Session invalid. Neuidentifizierung folgt.");state.gateway.sessionId=null;state.gateway.ready=false;setTimeout(identify,payload.d?1000:5000);break;case 0:
    if(payload.t==="READY"){state.gateway.ready=true;state.gateway.reconnects=0;state.gateway.sessionId=payload.d?.session_id||null;state.gateway.resumeGatewayUrl=payload.d?.resume_gateway_url||null;state.bot={id:payload.d?.user?.id||null,username:payload.d?.user?.username||null,discriminator:payload.d?.user?.discriminator||null};log(`✅ Discord Bot angemeldet: ${state.bot.username} (${state.bot.id})`);await verifyGuildConfiguration();await repairLegacyVerificationRace();await ensureReportCommands();ensureAdminCommand().catch(e=>warn("Admin-Command:",e.message));ensureWordAddCommand().catch(e=>warn("Wortfilter-Command:",e.message));ensureLevelCommands().catch(e=>warn("Level-Commands:",e.message));levelPeriodicTop().catch(e=>warn("Minigame Topliste beim Start:",e.message));scheduleSocialPoll();scheduleInstagramRefreshCheck();
moduleState.start(); // 9.4.0: Modulstand laden und abgleichen (alle 60 s)
setTimeout(()=>checkInstagramRefreshDue().catch(()=>{}),3000);
setTimeout(()=>pollSocialAll().catch(err=>warn("⚠️ Initialer Social-Poll fehlgeschlagen:",err.message)),5000);
scheduleEmergencyCheck();
setTimeout(()=>reconcileEmergencyMode({source:"startup"}).catch(err=>warn("⚠️ Notfallmodus beim Start:",err.message)),4000);
scheduleChannelTimes();
setTimeout(()=>{if(!moduleState.isOn("discordChannelTimes"))return; // 9.9.0
(channelTimesState.maintenance?.active?reconcileMaintenance():reconcileChannelTimes({source:"startup",announce:false})).catch(async err=>{warn("⚠️ Kanal-Zeitsteuerung beim Start:",err.message);await channelTimeLog("channel-times.error",{error:err.message,source:"startup"});});},8000);
setTimeout(()=>sendDiscordLogEvent("system.bot_ready",{}).catch(()=>{}),10000);}
    else if(payload.t==="INTERACTION_CREATE") {if(!await wordAddInteraction(payload.d)&&!await adminInteraction(payload.d)&&!await levelInteraction(payload.d))await handleReportInteraction(payload.d);}
    else if(payload.t==="GUILD_MEMBER_ADD"&&payload.d?.guild_id===IDS.guild) await trackMemberAdd(payload.d);
    else if(payload.t==="GUILD_MEMBER_UPDATE"&&payload.d?.guild_id===IDS.guild) await trackMemberUpdate(payload.d);
    else if(payload.t==="GUILD_MEMBER_REMOVE"&&payload.d?.guild_id===IDS.guild) trackMemberRemove(payload.d);
    else if(payload.t==="MESSAGE_REACTION_ADD") await verifyReaction(payload.d);
    else if(payload.t==="AUTO_MODERATION_ACTION_EXECUTION") await handleNativeAutoModExecution(payload.d);
    else if(payload.t==="MESSAGE_CREATE") {recordDiscordArrival();discordPerformance.pendingMessages++;discordPerformance.peakPendingMessages=Math.max(discordPerformance.peakPendingMessages,discordPerformance.pendingMessages);const receivedAt=Date.now();setTimeout(async()=>{try{await moderateMessage(payload.d);if(!wasRecentlyModerated(payload.d?.id)){const earned=measuredLevelOperation(()=>levelModuleOn()?levelEngine.award(payload.d):{awarded:0});if(earned.awarded&&earned.oldRank?.id!==earned.newRank?.id){queueLevelSync(earned.userId);if(earned.newRank&&levelEngine.config.channels?.befoerderungen){const profile=levelEngine.profile(earned.userId);discordApi(`/channels/${levelEngine.config.channels.befoerderungen}/messages`,'POST',{content:`🎖️ **${LV().promotion}**\n<@${earned.userId}> wurde zu **${profile.rank}** befördert.${profile.next?`\nNächster Dienstgrad: ${profile.next} (noch ${profile.missing} XP).`:''}`,allowed_mentions:{parse:[]}}).catch(e=>warn('Minigame Beförderung:',e.message));}}}}catch(err){discordPerformance.failedWrites++;discordPerformance.lastError="Nachrichtenverarbeitung fehlgeschlagen";discordPerformance.lastErrorAt=new Date().toISOString();moderationState.lastError=err.message;saveModerationState();}finally{discordPerformance.pendingMessages=Math.max(0,discordPerformance.pendingMessages-1);discordPerformance.processed++;discordPerformance.lastLatencyMs=Math.max(0,Date.now()-receivedAt);}},350);}
    else if(payload.t==="MESSAGE_UPDATE"&&payload.d?.id&&payload.d?.content===""&&Array.isArray(payload.d?.attachments)&&!payload.d.attachments.length){const r=measuredLevelOperation(()=>levelModuleOn()?levelEngine.retract(payload.d.id):{retracted:false});if(r.retracted&&r.oldRank?.id!==r.newRank?.id)queueLevelSync(r.userId);}
    else if(payload.t==="MESSAGE_DELETE") {const r=measuredLevelOperation(()=>levelModuleOn()?levelEngine.retract(payload.d?.id):{retracted:false});if(r.retracted&&r.oldRank?.id!==r.newRank?.id)queueLevelSync(r.userId);}
    else if(payload.t==="MESSAGE_DELETE_BULK") for(const mid of payload.d?.ids||[]){const r=measuredLevelOperation(()=>levelModuleOn()?levelEngine.retract(mid):{retracted:false});if(r.retracted&&r.oldRank?.id!==r.newRank?.id)queueLevelSync(r.userId);}
    // MESSAGE_REACTION_REMOVE deliberately does nothing: once granted, access is not revoked.
    break;}}catch(err){state.gateway.lastError=err.message;fail("❌ Discord Gateway Nachricht konnte nicht verarbeitet werden:",err.message);}});
  ws.addEventListener("close",event=>{clearHeartbeat();state.gateway.connected=false;state.gateway.ready=false;warn(`⚠️ Discord Gateway getrennt${event.code?` (Code ${event.code})`:""}${event.reason?`: ${event.reason}`:""}`);if([4004,4013,4014].includes(Number(event.code))){state.gateway.lastError=`Gateway Close ${event.code}: ${event.reason||"Authentifizierung/Intents prüfen"}`;fail("❌ Kein automatischer Reconnect bei Auth-/Intent-Fehler.");return;}scheduleReconnect();});
  ws.addEventListener("error",event=>{const message=event?.message||"Discord WebSocket Fehler";state.gateway.lastError=message;fail("❌ Discord Gateway Fehler:",message);});
}


async function validateRulesMessageForActivation() {
  if (!onboardingConfig.rulesMessageId || !onboardingConfig.rulesMessageChannelId) {
    throw new Error("Vor dem Aktivieren muss die zentrale Regelnachricht veröffentlicht werden.");
  }
  if (onboardingConfig.rulesMessageChannelId !== onboardingConfig.rulesChannelId) {
    throw new Error("Die gespeicherte Regelnachricht ist nicht mit dem aktuell ausgewählten Regelkanal verknüpft.");
  }

  try {
    await discordApi(`/channels/${onboardingConfig.rulesChannelId}/messages/${onboardingConfig.rulesMessageId}`);
  } catch (err) {
    throw new Error(`Die gespeicherte Regelnachricht konnte in Discord nicht gefunden werden: ${err.message}`);
  }

  // Idempotent: ensures our 👍 is present even after a manual removal.
  await ensureRulesReaction();
}

async function activateOnboarding() {
  await validateRulesMessageForActivation();

  const checks = onboardingChecks();
  if (!checks.ok) {
    const error = new Error(checks.errors[0] || "Freischaltung kann wegen der aktuellen Konfiguration nicht aktiviert werden.");
    error.checks = checks;
    throw error;
  }

  onboardingConfig.enabled = true;
  if (!onboardingConfig.activatedAt) onboardingConfig.activatedAt = now();
  saveOnboardingConfig();

  log("✅ Reaktions-Freischaltung aktiviert.");
  await sendDiscordLogEvent("onboarding.enabled",{channel:onboardingConfig.rulesChannelId,channelMention:`<#${onboardingConfig.rulesChannelId}>`,role:onboardingConfig.unlockRoleId,roleMention:`<@&${onboardingConfig.unlockRoleId}>`});
  return {onboarding:onboardingSummary(), checks:onboardingChecks()};
}

async function deactivateOnboarding() {
  onboardingConfig.enabled = false;
  saveOnboardingConfig();
  log("ℹ️ Reaktions-Freischaltung deaktiviert.");
  await sendDiscordLogEvent("onboarding.disabled",{});
  return {onboarding:onboardingSummary(), checks:onboardingChecks()};
}



function reportActorSummary(interaction){
  const user=interaction?.member?.user||interaction?.user||{};
  return {id:String(user.id||""),username:user.username||null,displayName:user.global_name||interaction?.member?.nick||user.username||null};
}
function reportTargetSummary(user,member=null){
  if(!user)return null;
  return {id:String(user.id||""),username:user.username||null,displayName:member?.nick||user.global_name||user.username||null,avatar:user.avatar||null};
}
function nextReportId(){
  const year=new Date().getFullYear(),current=Number(reportsState.sequenceByYear[year]||0)+1;
  reportsState.sequenceByYear[year]=current;saveReportsState();
  return `D-${year}-${String(current).padStart(4,"0")}`;
}
function reportReasonLabel(value){return REPORT_REASON_LABELS[String(value||"")]||"Sonstiges";}
function reportChannelName(channelId){return channelById(channelId)?.name||null;}
function reportTicketById(id){return (reportsStore.tickets||[]).find(x=>String(x.id)===String(id))||null;}
function reportCounts(){
  const out={open:0,resolved:0,rejected:0,total:(reportsStore.tickets||[]).length};
  for(const t of reportsStore.tickets||[])if(Object.prototype.hasOwnProperty.call(out,t.status))out[t.status]++;
  return out;
}
function safeReportTicket(ticket){
  return clone(ticket);
}
function reportCooldownRemaining(userId){
  const minutes=Math.max(0,Number(reportsConfig.cooldownMinutes||0));if(!minutes)return 0;
  const last=Number(reportsState.cooldowns[String(userId)]||0),remain=last+minutes*60000-Date.now();
  return Math.max(0,Math.ceil(remain/1000));
}
function markReportCooldown(userId){reportsState.cooldowns[String(userId)]=Date.now();saveReportsState();}
function findDuplicateMessageReport(reporterId,messageId){
  const cutoff=Date.now()-24*60*60*1000;
  return (reportsStore.tickets||[]).find(t=>t.reporter?.id===String(reporterId)&&t.source?.messageId===String(messageId)&&Date.parse(t.createdAt||"")>=cutoff)||null;
}
function sanitizeAttachmentFilename(value,index){
  const raw=String(value||`attachment-${index}`).replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120);
  return `${String(index+1).padStart(2,"0")}_${raw||"attachment"}`;
}
async function archiveReportAttachments(ticket){
  if(!reportsConfig.archiveAttachments||!ticket?.source?.attachments?.length)return;
  const dir=path.join(REPORT_ATTACHMENTS_DIR,ticket.id);fs.mkdirSync(dir,{recursive:true});
  let total=0;
  for(let i=0;i<Math.min(6,ticket.source.attachments.length);i++){
    const att=ticket.source.attachments[i];
    if(!att?.url)continue;
    const size=Number(att.size||0);
    if(size>15*1024*1024||total+size>30*1024*1024){att.archiveError="Datei zu groß für Ticket-Archiv";continue;}
    try{
      const downloaded=await fetchBufferLimited(att.url,{maxBytes:15*1024*1024,timeoutMs:10000,allowedHosts:["discordapp.com","discordapp.net"]});
      const buf=downloaded.buffer;
      if(total+buf.length>30*1024*1024)throw new Error("Datei zu groß");
      const file=sanitizeAttachmentFilename(att.filename,i);
      fs.writeFileSync(path.join(dir,file),buf);total+=buf.length;
      att.archived=true;att.localFile=file;att.archivedAt=now();att.archiveSize=buf.length;
    }catch(err){att.archived=false;att.archiveError=err.message;}
  }
  saveReports();
}
async function fetchReportMessage(channelId,messageId){
  return discordApi(`/channels/${channelId}/messages/${messageId}`);
}
async function fetchReportMember(userId){
  try{return await discordApi(`/guilds/${IDS.guild}/members/${userId}`);}catch{return null;}
}
function reportSourceFromMessage(message){
  const author=message?.author||{};
  return {
    type:"message",
    channelId:String(message?.channel_id||""),
    channelName:reportChannelName(message?.channel_id),
    messageId:String(message?.id||""),
    messageUrl:`https://discord.com/channels/${IDS.guild}/${message?.channel_id}/${message?.id}`,
    content:String(message?.content||""),
    author:reportTargetSummary(author,message?.member||null),
    attachments:(message?.attachments||[]).map(a=>({
      id:String(a.id||""),filename:a.filename||"attachment",contentType:a.content_type||null,size:Number(a.size||0),
      width:a.width||null,height:a.height||null,url:a.url||null,proxyUrl:a.proxy_url||null,archived:false,localFile:null
    })),
    embeds:(message?.embeds||[]).slice(0,5).map(e=>({title:e.title||null,description:e.description||null,url:e.url||null,imageUrl:e.image?.url||null,thumbnailUrl:e.thumbnail?.url||null}))
  };
}
async function writeReportLog(kind,ticket,extra=""){
  const map={new:"reports.new",status:"reports.status",sanction:"reports.sanction",delete:"reports.delete"};
  const eventKey=map[kind];if(!eventKey)return;
  const targetId=ticket.targetUser?.id||"";
  const channelId=ticket.source?.channelId||"";
  return await sendDiscordLogEvent(eventKey,{
    ticketId:ticket.id,reason:ticket.reasonLabel||ticket.reason||"Sonstiges",
    targetMention:targetId?`<@${targetId}>`:"ohne konkreten User",targetUserId:targetId,
    channel:channelById(channelId)?.name||channelId,channelMention:channelId?`<#${channelId}>`:"",
    channelLine:channelId?`\nKanal: <#${channelId}>`:"",
    reporter:ticket.reporter?.displayName||ticket.reporter?.username||ticket.reporter?.id||"",
    status:ticket.status==="resolved"?"Erledigt":ticket.status==="rejected"?"Abgewiesen":ticket.status,
    detail:extra,actor:ticket.closedBy?.name||""
  });
}
async function createReportTicket({reporter,reason,description,source,targetUser}){
  if(!reportsConfig.enabled)throw new Error("Das Meldesystem ist derzeit deaktiviert.");
  const duplicate=source?.messageId?findDuplicateMessageReport(reporter.id,source.messageId):null;
  if(duplicate)return {ticket:duplicate,duplicate:true};
  const remaining=reportCooldownRemaining(reporter.id);
  if(remaining>0)throw new Error(`Bitte warte noch ${remaining} Sekunden, bevor du eine weitere Meldung erstellst.`);
  const ticket={
    id:nextReportId(),status:"open",createdAt:now(),updatedAt:now(),reason:String(reason||"sonstiges"),
    reasonLabel:reportReasonLabel(reason),description:String(description||"").trim().slice(0,1800),
    reporter,targetUser:targetUser||source?.author||null,source:source||{type:"general"},
    actions:[],closedAt:null,closedBy:null,closingNote:null
  };
  reportsStore.tickets.push(ticket);markReportCooldown(reporter.id);reportsState.lastCreatedAt=ticket.createdAt;saveReports();saveReportsState();
  await archiveReportAttachments(ticket);
  await writeReportLog("new",ticket);
  return {ticket,duplicate:false};
}
function addTicketAction(ticket,type,actor,detail={}){
  const action={id:`act_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,type,at:now(),actor:actor||{name:"Control Center"},...detail};
  ticket.actions=Array.isArray(ticket.actions)?ticket.actions:[];ticket.actions.push(action);ticket.updatedAt=action.at;saveReports();return action;
}
async function sendReportWarning(userId,text){
  const dm=await discordApi("/users/@me/channels","POST",{recipient_id:userId});
  if(!dm?.id)throw new Error("Discord-DM konnte nicht geöffnet werden.");
  await sendChannelMessage(dm.id,String(text||"").slice(0,1800),userId);
}
async function manualTimeoutMember(userId,minutes,reason){
  const until=new Date(Date.now()+Math.max(1,minutes)*60000).toISOString();
  await discordFetch(`/guilds/${IDS.guild}/members/${userId}`,{
    method:"PATCH",
    headers:{"X-Audit-Log-Reason":encodeURIComponent(String(reason||"Ticket-Maßnahme").slice(0,480))},
    body:JSON.stringify({communication_disabled_until:until})
  });
  return until;
}
async function deleteReportedMessage(ticket,reason){
  if(!ticket.source?.channelId||!ticket.source?.messageId)throw new Error("Dieses Ticket enthält keine konkrete Discord-Nachricht.");
  try{
    await discordFetch(`/channels/${ticket.source.channelId}/messages/${ticket.source.messageId}`,{
      method:"DELETE",
      headers:{"X-Audit-Log-Reason":encodeURIComponent(String(reason||`Ticket ${ticket.id}`).slice(0,480))}
    });
    return "deleted";
  }catch(err){
    if(Number(err.status)===404)return "already_deleted";
    throw err;
  }
}
async function handleReportAction(body){
  const ticket=reportTicketById(body.ticketId);if(!ticket)throw new Error("Ticket nicht gefunden.");
  const actor={id:String(body.actorId||""),name:String(body.actorName||"Moderator").slice(0,120)};
  const action=String(body.action||"");
  if(action==="delete_message"){
    const result=await deleteReportedMessage(ticket,body.reason||`Ticket ${ticket.id}`);
    ticket.source.deletedAt=ticket.source.deletedAt||now();ticket.source.deletedBy=actor;
    addTicketAction(ticket,"content_deleted",actor,{result});
    await writeReportLog("delete",ticket,`${actor.name} · ${result==="already_deleted"?"Nachricht war bereits gelöscht":"Nachricht gelöscht"}.`);
  }else if(action==="warn"){
    if(!ticket.targetUser?.id)throw new Error("Dieses Ticket hat keinen gemeldeten User.");
    const text=String(body.text||"").trim();if(!text)throw new Error("Für eine individuelle Verwarnung ist ein Text erforderlich.");
    await sendReportWarning(ticket.targetUser.id,text);
    addTicketAction(ticket,"warning",actor,{text});
    await writeReportLog("sanction",ticket,`Individuelle Verwarnung an <@${ticket.targetUser.id}> durch **${actor.name}**.`);
  }else if(action==="timeout"){
    if(!ticket.targetUser?.id)throw new Error("Dieses Ticket hat keinen gemeldeten User.");
    const minutes=Math.max(1,Math.min(40320,Number(body.minutes||0)));if(!minutes)throw new Error("Ungültige Timeout-Dauer.");
    const reason=String(body.reason||`Ticket ${ticket.id}`).trim().slice(0,480);
    const until=await manualTimeoutMember(ticket.targetUser.id,minutes,reason);
    addTicketAction(ticket,"timeout",actor,{minutes,reason,until});
    await writeReportLog("sanction",ticket,`Timeout **${minutes} Min.** für <@${ticket.targetUser.id}> durch **${actor.name}** · ${reason}`);
  }else if(action==="ban"){
    if(!ticket.targetUser?.id)throw new Error("Dieses Ticket hat keinen gemeldeten User.");
    const reason=String(body.reason||`Ticket ${ticket.id}`).trim().slice(0,480);
    await banMember(ticket.targetUser.id,reason);
    addTicketAction(ticket,"ban",actor,{reason});
    await writeReportLog("sanction",ticket,`Ban für <@${ticket.targetUser.id}> durch **${actor.name}** · ${reason}`);
  }else if(action==="resolve"||action==="reject"){
    const note=String(body.note||"").trim().slice(0,1000);
    if(action==="reject"&&!note)throw new Error("Bei einer Abweisung ist eine Begründung erforderlich.");
    ticket.status=action==="resolve"?"resolved":"rejected";ticket.closedAt=now();ticket.closedBy=actor;ticket.closingNote=note||null;
    addTicketAction(ticket,action==="resolve"?"resolved":"rejected",actor,{note:note||null});
    await writeReportLog("status",ticket,`${ticket.status==="resolved"?"Erledigt":"Abgewiesen"} durch **${actor.name}**${note?` · ${note}`:""}`);
  }else if(action==="reopen"){
    ticket.status="open";ticket.closedAt=null;ticket.closedBy=null;ticket.closingNote=null;
    addTicketAction(ticket,"reopened",actor,{});
  }else throw new Error("Unbekannte Ticket-Aktion.");
  saveReports();return safeReportTicket(ticket);
}
function reportsCatalog(){
  return {channels:state.cache.channels.filter(c=>[0,5].includes(Number(c.type))).sort((a,b)=>Number(a.position)-Number(b.position)).map(c=>({id:c.id,name:c.name,parentId:c.parent_id||null}))};
}
function reportsView(query={}){
  const status=["open","resolved","rejected"].includes(String(query.status||""))?String(query.status):"open";
  const search=String(query.search||"").trim().toLocaleLowerCase("de-DE");
  const page=Math.max(1,Number(query.page||1)),pageSize=Math.max(1,Math.min(100,Number(query.pageSize||50)));
  let rows=(reportsStore.tickets||[]).filter(t=>t.status===status);
  if(search)rows=rows.filter(t=>[t.id,t.reasonLabel,t.description,t.reporter?.username,t.reporter?.displayName,t.targetUser?.username,t.targetUser?.displayName,t.source?.content].some(v=>String(v||"").toLocaleLowerCase("de-DE").includes(search)));
  rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const total=rows.length,totalPages=Math.max(1,Math.ceil(total/pageSize)),safePage=Math.min(page,totalPages),items=rows.slice((safePage-1)*pageSize,safePage*pageSize).map(safeReportTicket);
  return {ok:true,config:clone(reportsConfig),counts:reportCounts(),catalog:reportsCatalog(),items,total,page:safePage,pageSize,totalPages,reasons:REPORT_REASONS,state:{lastCreatedAt:reportsState.lastCreatedAt,lastError:reportsState.lastError,commandsRegisteredAt:reportsState.commandsRegisteredAt}};
}
async function publishReportButton(){
  if(!reportsConfig.buttonChannelId)throw new Error("Ein Kanal für den Melden-Button muss ausgewählt sein.");
  const body={
    content:reportsConfig.buttonText,
    allowed_mentions:{parse:[],users:[],roles:[]},
    components:[{type:1,components:[{type:2,style:1,label:reportsConfig.buttonLabel,custom_id:"report_open_general",emoji:{name:"🚨"}}]}]
  };
  if(reportsConfig.buttonMessageId&&reportsConfig.buttonMessageChannelId===reportsConfig.buttonChannelId){
    try{
      const msg=await discordApi(`/channels/${reportsConfig.buttonChannelId}/messages/${reportsConfig.buttonMessageId}`,"PATCH",body);
      return msg;
    }catch{}
  }
  if(reportsConfig.buttonMessageId&&reportsConfig.buttonMessageChannelId){
    try{await discordApi(`/channels/${reportsConfig.buttonMessageChannelId}/messages/${reportsConfig.buttonMessageId}`,"DELETE");}catch{}
  }
  const msg=await discordApi(`/channels/${reportsConfig.buttonChannelId}/messages`,"POST",body);
  reportsConfig.buttonMessageId=String(msg.id);reportsConfig.buttonMessageChannelId=String(reportsConfig.buttonChannelId);saveReportsConfig();return msg;
}
async function ensureReportCommands(){
  try{
    const base=`/applications/${process.env.DISCORD_CLIENT_ID}/guilds/${IDS.guild}/commands`;
    const existing=await discordApi(base);
    const wanted=[
      {name:"Nachricht melden",type:3},
      {name:"User melden",type:2},
      {name:"melden",type:1,description:"Allgemeines Verhalten oder einen Vorfall melden"}
    ];
    for(const cmd of wanted){
      const found=(existing||[]).find(x=>x.name===cmd.name&&Number(x.type)===Number(cmd.type));
      if(found)await discordApi(`${base}/${found.id}`,"PATCH",cmd);
      else await discordApi(base,"POST",cmd);
    }
    reportsState.commandsRegisteredAt=now();reportsState.lastError=null;saveReportsState();
    log("✅ Discord-Meldebefehle registriert.");
  }catch(err){reportsState.lastError=`Command-Registrierung: ${err.message}`;saveReportsState();warn("⚠️ Meldebefehle konnten nicht registriert werden:",err.message);}
}
async function interactionRespond(interaction,type,data={}){
  const response=await fetch(`${API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`,{
    method:"POST",headers:{"Content-Type":"application/json","User-Agent":discordTexts().userAgent},
    body:JSON.stringify({type,data})
  });
  if(!response.ok)throw new Error(`Interaction Antwort fehlgeschlagen (${response.status}): ${await response.text()}`);
}
async function editInteractionOriginal(interaction,data){
  const response=await fetch(`${API_BASE}/webhooks/${process.env.DISCORD_CLIENT_ID}/${interaction.token}/messages/@original`,{
    method:"PATCH",headers:{"Content-Type":"application/json","User-Agent":discordTexts().userAgent},
    body:JSON.stringify(data)
  });
  if(!response.ok)throw new Error(`Interaction Aktualisierung fehlgeschlagen (${response.status})`);
}
function reportReasonPickerComponents(kind,targetParts=[]){
  return [{
    type:1,components:[{
      type:3,custom_id:["report_reason",kind,...targetParts].join(":"),placeholder:"Grund auswählen",min_values:1,max_values:1,
      options:REPORT_REASONS.map(x=>({label:x.label,value:x.value}))
    }]
  }];
}
async function showReportReasonPicker(interaction,kind,targetParts=[]){
  if(!reportsConfig.enabled)return interactionRespond(interaction,4,{content:"Das Meldesystem ist derzeit deaktiviert.",flags:64});
  await interactionRespond(interaction,4,{content:"**Meldung erstellen**\nBitte wähle zuerst den passenden Grund aus.",flags:64,components:reportReasonPickerComponents(kind,targetParts)});
}
function reportModalComponents(kind){
  const rows=[];
  if(kind==="general")rows.push({type:1,components:[{type:4,custom_id:"target",label:"Gemeldeter User (optional)",style:1,required:false,max_length:100,placeholder:"@User oder Discord-ID"}]});
  rows.push({type:1,components:[{type:4,custom_id:"description",label:"Beschreibung",style:2,required:kind==="general",min_length:kind==="general"?5:0,max_length:1500,placeholder:"Was ist passiert? Zusätzliche Hinweise für das Moderationsteam."}]});
  return rows;
}
function modalField(interaction,id){
  for(const row of interaction?.data?.components||[])for(const c of row.components||[])if(c.custom_id===id)return String(c.value||"");
  return "";
}
function parseMentionId(value){const m=String(value||"").match(/\d{15,22}/);return m?m[0]:null;}
async function buildTicketFromInteraction(interaction,kind,reason,parts){
  const reporter=reportActorSummary(interaction),description=modalField(interaction,"description");
  if(kind==="message"){
    const channelId=parts[0],messageId=parts[1],message=await fetchReportMessage(channelId,messageId),source=reportSourceFromMessage(message);
    return createReportTicket({reporter,reason,description,source,targetUser:source.author});
  }
  if(kind==="user"){
    const userId=parts[0],member=await fetchReportMember(userId),user=member?.user||interaction?.data?.resolved?.users?.[userId]||{id:userId,username:userId};
    return createReportTicket({reporter,reason,description,source:{type:"user",channelId:String(interaction.channel_id||""),channelName:reportChannelName(interaction.channel_id)},targetUser:reportTargetSummary(user,member)});
  }
  const targetId=parseMentionId(modalField(interaction,"target")),member=targetId?await fetchReportMember(targetId):null;
  const target=targetId?reportTargetSummary(member?.user||{id:targetId,username:targetId},member):null;
  return createReportTicket({reporter,reason,description,source:{type:"general",channelId:String(interaction.channel_id||""),channelName:reportChannelName(interaction.channel_id)},targetUser:target});
}
// 9.9.0: Gehört eine Interaktion zum Meldesystem?
function reportInteractionOf(interaction){
  const type=Number(interaction?.type);
  if(type===2){const ct=Number(interaction.data?.type||1),name=String(interaction.data?.name||"");return (name==="Nachricht melden"&&ct===3)||(name==="User melden"&&ct===2)||(name==="melden"&&ct===1);}
  if(type===3||type===5)return String(interaction.data?.custom_id||"").startsWith("report");
  return false;
}
async function handleReportInteraction(interaction){
  if(!interaction||interaction.guild_id!==IDS.guild)return;
  // 9.9.0: Modul „Meldungen“ aus → Melde-Befehle und -Knöpfe antworten „derzeit deaktiviert“.
  if(!moduleState.isOn("discordReports")){if(reportInteractionOf(interaction))await interactionRespond(interaction,4,{flags:64,content:"⏸️ Das Meldesystem ist derzeit deaktiviert."});return;}
  const type=Number(interaction.type);
  if(type===2){
    const commandType=Number(interaction.data?.type||1),name=String(interaction.data?.name||"");
    if(name==="Nachricht melden"&&commandType===3)return showReportReasonPicker(interaction,"message",[String(interaction.channel_id||""),String(interaction.data?.target_id||"")]);
    if(name==="User melden"&&commandType===2)return showReportReasonPicker(interaction,"user",[String(interaction.data?.target_id||"")]);
    if(name==="melden"&&commandType===1)return showReportReasonPicker(interaction,"general",[]);
    return;
  }
  if(type===3){
    const custom=String(interaction.data?.custom_id||"");
    if(custom==="report_open_general")return showReportReasonPicker(interaction,"general",[]);
    if(custom.startsWith("report_reason:")){
      const parts=custom.split(":"),kind=parts[1],targetParts=parts.slice(2),reason=String(interaction.data?.values?.[0]||"sonstiges");
      const modalId=["report_submit",kind,reason,...targetParts].join(":").slice(0,100);
      return interactionRespond(interaction,9,{custom_id:modalId,title:"Meldung absenden",components:reportModalComponents(kind)});
    }
    return;
  }
  if(type===5){
    const custom=String(interaction.data?.custom_id||"");
    if(!custom.startsWith("report_submit:"))return;
    await interactionRespond(interaction,5,{flags:64});
    try{
      const parts=custom.split(":"),kind=parts[1],reason=parts[2],targetParts=parts.slice(3);
      const result=await buildTicketFromInteraction(interaction,kind,reason,targetParts);
      await editInteractionOriginal(interaction,{content:result.duplicate?`Diese Nachricht wurde von dir bereits gemeldet. Das vorhandene Ticket lautet **${result.ticket.id}**.`:`Danke. Deine Meldung wurde als **${result.ticket.id}** aufgenommen und wird intern geprüft.`,components:[]});
    }catch(err){
      reportsState.lastError=err.message;saveReportsState();
      try{await editInteractionOriginal(interaction,{content:`Die Meldung konnte nicht aufgenommen werden: ${err.message}`,components:[]});}catch{}
    }
  }
}


function socialCredentials(){
  const igState=socialTokenState.instagram||{};
  const igManaged=igState.managed===true;
  const igEnvToken=String(process.env.INSTAGRAM_ACCESS_TOKEN||"").trim()||null;
  const igToken=igManaged?(igState.accessToken||null):(igState.accessToken||igEnvToken);
  const igUserId=String(igState.userId||process.env.INSTAGRAM_USER_ID||"").trim()||null;

  const tokenState=socialTokenState.tiktok||{};
  const managed=tokenState.managed===true;
  const envAccess=String(process.env.TIKTOK_ACCESS_TOKEN||"").trim()||null;
  const envRefresh=String(process.env.TIKTOK_REFRESH_TOKEN||"").trim()||null;
  const accessToken=managed?(tokenState.accessToken||null):(tokenState.accessToken||envAccess);
  const refreshToken=managed?(tokenState.refreshToken||null):(tokenState.refreshToken||envRefresh);

  return {
    instagram:{
      configured:!!igUserId&&!!igToken,managed:igManaged,
      appId:String(process.env.INSTAGRAM_APP_ID||"").trim()||null,
      userId:igUserId,accessToken:igToken,username:igState.username||null,
      installedAt:igState.installedAt||null,issuedAt:igState.issuedAt||null,expiresAt:igState.expiresAt||null,
      lastSuccessfulRefreshAt:igState.lastSuccessfulRefreshAt||null,nextRefreshAt:igState.nextRefreshAt||null,
      lastRefreshAttemptAt:igState.lastRefreshAttemptAt||null,lastError:igState.lastError||null,lastErrorAt:igState.lastErrorAt||null,
      retryCount:Number(igState.retryCount||0),reauthorizationRequired:igState.reauthorizationRequired===true
    },
    tiktok:{
      configured:!!accessToken,managed,accessToken,refreshToken,
      clientKey:String(process.env.TIKTOK_CLIENT_KEY||"").trim()||null,
      clientSecret:String(process.env.TIKTOK_CLIENT_SECRET||"").trim()||null,
      clientConfigured:!!String(process.env.TIKTOK_CLIENT_KEY||"").trim()&&!!String(process.env.TIKTOK_CLIENT_SECRET||"").trim(),
      expiresAt:tokenState.expiresAt||null,refreshExpiresAt:tokenState.refreshExpiresAt||null,
      openId:tokenState.openId||null,grantedScopes:Array.isArray(tokenState.grantedScopes)?tokenState.grantedScopes:[],
      connectedAt:tokenState.connectedAt||null,disconnectedAt:tokenState.disconnectedAt||null,
      canAutoRefresh:!!(refreshToken&&String(process.env.TIKTOK_CLIENT_KEY||"").trim()&&String(process.env.TIKTOK_CLIENT_SECRET||"").trim()),
      environment:["sandbox","production"].includes(String(process.env.TIKTOK_ENVIRONMENT||"").toLowerCase())?String(process.env.TIKTOK_ENVIRONMENT).toLowerCase():"sandbox"
    }
  };
}
function socialConnectionSummary(){
  const c=socialCredentials();
  const expiresMs=c.instagram.expiresAt?Date.parse(c.instagram.expiresAt):null;
  return {
    instagram:{
      configured:c.instagram.configured,managed:c.instagram.managed,appId:c.instagram.appId,userId:c.instagram.userId,
      tokenConfigured:!!c.instagram.accessToken,username:c.instagram.username,
      installedAt:c.instagram.installedAt,issuedAt:c.instagram.issuedAt,expiresAt:c.instagram.expiresAt,
      remainingSeconds:expiresMs&&Number.isFinite(expiresMs)?Math.max(0,Math.floor((expiresMs-Date.now())/1000)):null,
      lastSuccessfulRefreshAt:c.instagram.lastSuccessfulRefreshAt,nextRefreshAt:c.instagram.nextRefreshAt,
      lastRefreshAttemptAt:c.instagram.lastRefreshAttemptAt,lastError:c.instagram.lastError,lastErrorAt:c.instagram.lastErrorAt,
      retryCount:c.instagram.retryCount,reauthorizationRequired:c.instagram.reauthorizationRequired,
      refreshInProgress:instagramRefreshRunning,minimumRefreshAgeHours:24,automaticRefreshDays:30,
      permission:"instagram_business_basic"
    },
    tiktok:{configured:c.tiktok.configured,managed:c.tiktok.managed,clientConfigured:c.tiktok.clientConfigured,
      tokenConfigured:!!c.tiktok.accessToken,autoRefresh:c.tiktok.canAutoRefresh,expiresAt:c.tiktok.expiresAt,
      refreshExpiresAt:c.tiktok.refreshExpiresAt,openId:c.tiktok.openId,grantedScopes:c.tiktok.grantedScopes,
      connectedAt:c.tiktok.connectedAt,disconnectedAt:c.tiktok.disconnectedAt,environment:c.tiktok.environment}
  };
}
function socialCatalog(){
  return {channels:state.cache.channels.filter(c=>[0,5].includes(Number(c.type))).sort((a,b)=>Number(a.position)-Number(b.position)).map(c=>({id:c.id,name:c.name,parentId:c.parent_id||null}))};
}
function socialHistoryView(query={}){
  const platform=["instagram","tiktok"].includes(String(query.platform||""))?String(query.platform):null;
  const status=["sent","failed","baseline","waiting","skipped"].includes(String(query.status||""))?String(query.status):null;
  const search=String(query.search||"").trim().toLocaleLowerCase("de-DE");
  const page=Math.max(1,Number(query.page||1)),pageSize=Math.max(1,Math.min(100,Number(query.pageSize||50)));
  let rows=[...(socialHistory.items||[])];
  if(platform)rows=rows.filter(x=>x.platform===platform);
  if(status)rows=rows.filter(x=>x.status===status);
  if(search)rows=rows.filter(x=>[x.id,x.caption,x.type,x.url,x.error].some(v=>String(v||"").toLocaleLowerCase("de-DE").includes(search)));
  rows.sort((a,b)=>{
    const bt=Date.parse(b.publishedAt||b.detectedAt||b.createdAt||0)||0;
    const at=Date.parse(a.publishedAt||a.detectedAt||a.createdAt||0)||0;
    return bt-at;
  });
  const total=rows.length,totalPages=Math.max(1,Math.ceil(total/pageSize)),safePage=Math.min(page,totalPages);
  return {items:rows.slice((safePage-1)*pageSize,safePage*pageSize),total,page:safePage,pageSize,totalPages};
}
function socialView(query={}){
  const h=socialHistoryView(query);
  return {
    ok:true,config:clone(socialConfig),connections:socialConnectionSummary(),state:clone(socialState),
    history:h,catalog:socialCatalog()
  };
}
function socialTemplate(template,item){
  const caption=String(item.caption||item.title||"Neuer Beitrag").trim();
  return String(template||"")
    .replaceAll("{caption}",caption.slice(0,1200))
    .replaceAll("{title}",String(item.title||caption).slice(0,300))
    .replaceAll("{url}",String(item.url||""))
    .replaceAll("{type}",String(item.type||"Beitrag"))
    .replace(/\n{3,}/g,"\n\n").trim();
}
function socialHistoryRow(platform,item,status,error=null,extra={}){
  return {
    key:`${platform}:${item.id}`,platform,id:String(item.id),type:item.type||null,title:item.title||null,
    caption:item.caption||null,url:item.url||null,thumbnailUrl:item.thumbnailUrl||null,
    publishedAt:item.publishedAt||null,detectedAt:extra.detectedAt||now(),status,error:error||null,
    attempts:Number(extra.attempts||0),discordChannelId:extra.discordChannelId||null,discordMessageId:extra.discordMessageId||null,
    sentAt:extra.sentAt||null,
    note:extra.note||null,linkTries:Number(extra.linkTries||0)
  };
}
function upsertSocialHistory(row){
  const idx=socialHistory.items.findIndex(x=>x.key===row.key);
  if(idx>=0)socialHistory.items[idx]={...socialHistory.items[idx],...row};
  else socialHistory.items.push(row);
  saveSocialHistory();
  return idx>=0?socialHistory.items[idx]:row;
}
async function socialFetchJson(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(url,{...options,signal:controller.signal});
    const text=await response.text();let body=null;
    try{body=text?JSON.parse(text):null}catch{body=text}
    if(!response.ok){
      const detail=body?.error?.message||body?.error_description||body?.message||(typeof body==="string"?body:`HTTP ${response.status}`);
      const err=new Error(detail);err.status=response.status;err.body=body;throw err;
    }
    return body;
  }finally{clearTimeout(timer);}
}

const INSTAGRAM_REFRESH_INTERVAL_MS=30*24*60*60*1000;
const INSTAGRAM_MIN_REFRESH_AGE_MS=24*60*60*1000;
const INSTAGRAM_DAILY_CHECK_MS=24*60*60*1000;
const INSTAGRAM_RETRY_DELAYS_MS=[60*60*1000,6*60*60*1000,24*60*60*1000];

function safeInstagramError(err){
  const meta=err?.body?.error||{};
  const code=Number(meta.code||err?.status||0)||null,subcode=Number(meta.error_subcode||0)||null;
  let message=String(meta.message||err?.message||"Instagram API error").slice(0,500);
  message=message.replace(/access_token=[^&\s]+/gi,"access_token=***").replace(/[A-Za-z0-9_-]{80,}/g,"***");
  return {code,subcode,message};
}
function isInstagramReauthError(err){
  const e=safeInstagramError(err),m=e.message.toLowerCase();
  return e.code===190||m.includes("expired")||m.includes("invalid oauth")||m.includes("invalid access token")||m.includes("revoked");
}
function instagramRefreshAnchorMs(){
  const s=socialTokenState.instagram||{},anchor=s.lastSuccessfulRefreshAt||s.issuedAt||s.installedAt;
  const ms=anchor?Date.parse(anchor):NaN;
  return Number.isFinite(ms)?ms:null;
}
function instagramRefreshEligibleAtMs(){
  const anchor=instagramRefreshAnchorMs();
  return anchor===null?Date.now():anchor+INSTAGRAM_MIN_REFRESH_AGE_MS;
}
function instagramAutomaticDueAtMs(){
  const s=socialTokenState.instagram||{};
  if(s.nextRefreshAt){const next=Date.parse(s.nextRefreshAt);if(Number.isFinite(next))return next;}
  const anchor=instagramRefreshAnchorMs();
  return anchor===null?Date.now():anchor+INSTAGRAM_REFRESH_INTERVAL_MS;
}
function scheduleInstagramRefreshCheck(){
  if(instagramRefreshTimer){clearTimeout(instagramRefreshTimer);instagramRefreshTimer=null;}
  const c=socialCredentials().instagram;
  if(!c.configured||c.reauthorizationRequired)return;
  const due=Math.max(Date.now()+5000,Math.min(instagramAutomaticDueAtMs(),Date.now()+INSTAGRAM_DAILY_CHECK_MS));
  instagramRefreshTimer=setTimeout(()=>checkInstagramRefreshDue().catch(()=>{}),Math.max(5000,due-Date.now()));
  instagramRefreshTimer.unref?.();
}
async function validateInstagramTokenProfile(token,userId){
  const url=new URL(`https://graph.instagram.com/v25.0/${encodeURIComponent(userId)}`);
  url.searchParams.set("fields","id,username,account_type");
  url.searchParams.set("access_token",token);
  return socialFetchJson(url.toString());
}
async function installInstagramToken(token){
  const value=String(token||"").trim();
  if(value.length<40)throw new Error("Der Instagram Access Token ist leer oder offensichtlich unvollständig.");
  const configuredUserId=String(process.env.INSTAGRAM_USER_ID||"").trim();
  if(!configuredUserId)throw new Error("INSTAGRAM_USER_ID ist serverseitig nicht konfiguriert.");
  let profile;
  try{profile=await validateInstagramTokenProfile(value,configuredUserId);}
  catch(err){
    const safe=safeInstagramError(err);
    throw new Error(`Instagram-Token konnte nicht validiert werden${safe.code?` (Code ${safe.code})`:""}: ${safe.message}`);
  }
  const t=now();
  socialTokenState.instagram={
    ...DEFAULT_SOCIAL_TOKEN_STATE.instagram,
    managed:true,accessToken:value,installedAt:t,issuedAt:t,expiresAt:null,
    nextRefreshAt:new Date(Date.now()+INSTAGRAM_REFRESH_INTERVAL_MS).toISOString(),
    username:profile?.username||null,userId:String(profile?.id||configuredUserId),updatedAt:t
  };
  saveSocialTokenState();
  socialState.platforms.instagram.profile=profile||null;
  socialState.platforms.instagram.lastError=null;saveSocialState();
  scheduleInstagramRefreshCheck();
  return {ok:true,username:profile?.username||null,userId:String(profile?.id||configuredUserId),nextRefreshAt:socialTokenState.instagram.nextRefreshAt};
}
async function refreshInstagramToken({manual=false}={}){
  if(instagramRefreshRunning)throw new Error("Eine Instagram-Token-Erneuerung läuft bereits.");
  const c=socialCredentials().instagram;
  if(!c.configured)throw new Error("Kein Instagram Access Token konfiguriert.");
  if(c.reauthorizationRequired)throw new Error("Erneute Autorisierung erforderlich. Bitte einen neuen gültigen Instagram-Token hinterlegen.");

  const eligibleAt=instagramRefreshEligibleAtMs();
  if(Date.now()<eligibleAt){
    const when=new Date(eligibleAt).toISOString();
    socialTokenState.instagram.nextRefreshAt=when;saveSocialTokenState();scheduleInstagramRefreshCheck();
    throw new Error(`Der Token kann frühestens 24 Stunden nach Ausgabe beziehungsweise der letzten Erneuerung erneut verlängert werden. Frühester Zeitpunkt: ${when}`);
  }

  instagramRefreshRunning=true;
  socialTokenState.instagram.lastRefreshAttemptAt=now();saveSocialTokenState();
  try{
    const url=new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type","ig_refresh_token");
    url.searchParams.set("access_token",c.accessToken);
    const body=await socialFetchJson(url.toString(),{method:"GET"});
    if(!body?.access_token||!Number(body?.expires_in))throw new Error("Instagram lieferte keinen erneuerten Long-Lived Token mit expires_in.");
    const refreshedAt=now(),expiresAt=new Date(Date.now()+Number(body.expires_in)*1000).toISOString();
    socialTokenState.instagram={
      ...socialTokenState.instagram,managed:true,accessToken:String(body.access_token),
      issuedAt:refreshedAt,expiresAt,lastSuccessfulRefreshAt:refreshedAt,
      nextRefreshAt:new Date(Date.now()+INSTAGRAM_REFRESH_INTERVAL_MS).toISOString(),
      lastRefreshAttemptAt:refreshedAt,lastError:null,lastErrorAt:null,retryCount:0,
      reauthorizationRequired:false,updatedAt:refreshedAt
    };
    saveSocialTokenState();scheduleInstagramRefreshCheck();
    return {ok:true,expiresAt,nextRefreshAt:socialTokenState.instagram.nextRefreshAt};
  }catch(err){
    const safe=safeInstagramError(err),reauth=isInstagramReauthError(err);
    const retryCount=Math.min(3,Number(socialTokenState.instagram.retryCount||0)+1);
    const retryDelay=INSTAGRAM_RETRY_DELAYS_MS[Math.min(retryCount-1,INSTAGRAM_RETRY_DELAYS_MS.length-1)];
    socialTokenState.instagram.lastError=safe.message;
    socialTokenState.instagram.lastErrorAt=now();
    socialTokenState.instagram.retryCount=retryCount;
    socialTokenState.instagram.reauthorizationRequired=reauth;
    socialTokenState.instagram.nextRefreshAt=reauth?null:new Date(Date.now()+retryDelay).toISOString();
    saveSocialTokenState();scheduleInstagramRefreshCheck();
    const e=new Error(reauth?"Erneute Autorisierung erforderlich. Der Instagram-Token ist abgelaufen, widerrufen oder ungültig.":`Instagram-Token konnte nicht erneuert werden. Nächster automatischer Versuch: ${socialTokenState.instagram.nextRefreshAt||"später"}. ${safe.message}`);
    e.status=safe.code||500;throw e;
  }finally{
    instagramRefreshRunning=false;
  }
}
async function checkInstagramRefreshDue(){
  const c=socialCredentials().instagram;
  if(!c.configured||c.reauthorizationRequired){scheduleInstagramRefreshCheck();return {ok:true,status:"not_available"};}
  const due=instagramAutomaticDueAtMs();
  if(Date.now()<due){scheduleInstagramRefreshCheck();return {ok:true,status:"not_due",nextRefreshAt:new Date(due).toISOString()};}
  if(Date.now()<instagramRefreshEligibleAtMs()){scheduleInstagramRefreshCheck();return {ok:true,status:"too_young"};}
  try{return await refreshInstagramToken({manual:false});}
  catch(err){return {ok:false,error:safeInstagramError(err).message,reauthorizationRequired:socialTokenState.instagram.reauthorizationRequired===true};}
}

async function refreshTikTokTokenIfNeeded(force=false){
  const c=socialCredentials().tiktok;
  if(!c.canAutoRefresh)return c.accessToken;
  const expiresMs=c.expiresAt?Date.parse(c.expiresAt):0;
  if(!force&&c.accessToken&&(!expiresMs||expiresMs-Date.now()>2*60*60*1000))return c.accessToken;
  const form=new URLSearchParams({client_key:c.clientKey,client_secret:c.clientSecret,grant_type:"refresh_token",refresh_token:c.refreshToken});
  const body=await socialFetchJson("https://open.tiktokapis.com/v2/oauth/token/",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form.toString()
  });
  socialTokenState.tiktok={
    ...socialTokenState.tiktok,
    managed:socialTokenState.tiktok.managed===true,
    accessToken:body.access_token||c.accessToken,refreshToken:body.refresh_token||c.refreshToken,
    expiresAt:body.expires_in?new Date(Date.now()+Number(body.expires_in)*1000).toISOString():null,
    refreshExpiresAt:body.refresh_expires_in?new Date(Date.now()+Number(body.refresh_expires_in)*1000).toISOString():c.refreshExpiresAt,
    openId:body.open_id||socialTokenState.tiktok.openId||null,
    grantedScopes:String(body.scope||"").split(",").map(x=>x.trim()).filter(Boolean).length?String(body.scope).split(",").map(x=>x.trim()).filter(Boolean):(socialTokenState.tiktok.grantedScopes||[]),
    updatedAt:now(),disconnectedAt:null
  };
  saveSocialTokenState();
  return socialTokenState.tiktok.accessToken;
}

function validHttpsRedirectUri(value){
  try{const u=new URL(String(value||""));return u.protocol==="https:"&&!u.username&&!u.password&&!u.hash&&!u.search?u.toString():null}catch{return null}
}
function tiktokOauthInfo(redirectUri){
  const redirect=validHttpsRedirectUri(redirectUri),c=socialCredentials().tiktok;
  return {configured:c.clientConfigured,connected:c.configured,managed:c.managed,environment:c.environment,redirectUri:redirect,
    requestedScopes:["user.info.basic","video.list"],grantedScopes:c.grantedScopes,openId:c.openId,connectedAt:c.connectedAt,
    expiresAt:c.expiresAt,refreshExpiresAt:c.refreshExpiresAt,autoRefresh:c.canAutoRefresh,profile:socialState.platforms?.tiktok?.profile||null};
}
async function beginTikTokOauth({redirectUri,initiatedBy}){
  const redirect=validHttpsRedirectUri(redirectUri),c=socialCredentials().tiktok;
  if(!redirect)throw new Error("OAuth-Redirect-URI muss eine feste HTTPS-URL ohne Query oder Fragment sein.");
  if(!c.clientConfigured)throw new Error("TIKTOK_CLIENT_KEY und TIKTOK_CLIENT_SECRET sind serverseitig noch nicht konfiguriert.");
  cleanupSocialOauthStates();
  const stateToken=crypto.randomBytes(32).toString("hex");
  socialOauthState.states[stateToken]={createdAt:Date.now(),expiresAt:Date.now()+10*60*1000,initiatedBy:String(initiatedBy||"Owner").slice(0,120),
    redirectUri:redirect,environment:c.environment,requestedScopes:["user.info.basic","video.list"],usedAt:null};
  saveSocialOauthState();
  const q=new URLSearchParams({client_key:c.clientKey,response_type:"code",scope:"user.info.basic,video.list",redirect_uri:redirect,state:stateToken,disable_auto_auth:"1"});
  return {url:`https://www.tiktok.com/v2/auth/authorize/?${q.toString()}`,expiresAt:new Date(Date.now()+10*60*1000).toISOString()};
}
async function completeTikTokOauth({redirectUri,state,code,error,errorDescription,scopes}){
  const redirect=validHttpsRedirectUri(redirectUri);cleanupSocialOauthStates();
  const entry=socialOauthState.states[String(state||"")];
  if(!entry)throw new Error("OAuth-State ist ungültig, abgelaufen oder bereits verwendet.");
  delete socialOauthState.states[String(state)];saveSocialOauthState();
  if(!redirect||redirect!==entry.redirectUri)throw new Error("OAuth-Redirect-URI stimmt nicht mit dem gestarteten Vorgang überein.");
  if(error)throw new Error(errorDescription||error);
  if(!code)throw new Error("TikTok hat keinen Authorization Code geliefert.");
  const c=socialCredentials().tiktok;
  if(!c.clientConfigured)throw new Error("TikTok Client-Zugang ist nicht konfiguriert.");
  const form=new URLSearchParams({client_key:c.clientKey,client_secret:c.clientSecret,code:String(code),grant_type:"authorization_code",redirect_uri:redirect});
  const body=await socialFetchJson("https://open.tiktokapis.com/v2/oauth/token/",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-cache"},body:form.toString()
  });
  const granted=String(body.scope||scopes||"").split(",").map(x=>x.trim()).filter(Boolean),required=["user.info.basic","video.list"],missing=required.filter(x=>!granted.includes(x));
  socialTokenState.tiktok={managed:true,accessToken:body.access_token||null,refreshToken:body.refresh_token||null,
    expiresAt:body.expires_in?new Date(Date.now()+Number(body.expires_in)*1000).toISOString():null,
    refreshExpiresAt:body.refresh_expires_in?new Date(Date.now()+Number(body.refresh_expires_in)*1000).toISOString():null,
    openId:body.open_id||null,grantedScopes:granted,connectedAt:now(),updatedAt:now(),disconnectedAt:null};
  saveSocialTokenState();
  let profile=null;
  try{profile=await fetchTikTokProfile(body.access_token);socialState.platforms.tiktok.profile=profile;socialState.platforms.tiktok.lastError=missing.length?`Fehlende Scopes: ${missing.join(", ")}`:null;saveSocialState();}
  catch(profileErr){socialState.platforms.tiktok.lastError=`Profilprüfung: ${profileErr.message}`;saveSocialState();}
  return {ok:true,initiatedBy:entry.initiatedBy,profile,grantedScopes:granted,missingScopes:missing,environment:entry.environment};
}
async function disconnectTikTok(){
  const c=socialCredentials().tiktok;let revokeError=null;
  if(c.accessToken&&c.clientConfigured){
    try{const form=new URLSearchParams({client_key:c.clientKey,client_secret:c.clientSecret,token:c.accessToken});
      await socialFetchJson("https://open.tiktokapis.com/v2/oauth/revoke/",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-cache"},body:form.toString()});
    }catch(err){revokeError=err.message;}
  }
  socialTokenState.tiktok={managed:true,accessToken:null,refreshToken:null,expiresAt:null,refreshExpiresAt:null,openId:null,grantedScopes:[],connectedAt:null,updatedAt:now(),disconnectedAt:now()};
  saveSocialTokenState();socialState.platforms.tiktok.lastError=null;saveSocialState();
  return {ok:true,revokeError,localTokensRemoved:true,discordMessagesRemoved:false,historyRemoved:false};
}
function clearTikTokLocalData(){
  socialState.initialized.tiktok=false;socialState.seen.tiktok={};socialState.platforms.tiktok={...DEFAULT_SOCIAL_STATE.platforms.tiktok};
  socialHistory.items=(socialHistory.items||[]).filter(x=>x.platform!=="tiktok");saveSocialState();saveSocialHistory();
  return {ok:true,discordMessagesRemoved:false};
}

async function fetchInstagramProfile(){
  const c=socialCredentials().instagram;
  if(!c.configured)throw new Error("Instagram ist nicht konfiguriert.");
  const fields="id,username,account_type";
  const url=`https://graph.instagram.com/v25.0/${encodeURIComponent(c.userId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(c.accessToken)}`;
  return socialFetchJson(url);
}
async function fetchInstagramMedia(){
  const c=socialCredentials().instagram;
  if(!c.configured)throw new Error("Instagram ist nicht konfiguriert.");
  const fields="id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username,children{media_type,media_url,thumbnail_url}";
  const url=`https://graph.instagram.com/v25.0/${encodeURIComponent(c.userId)}/media?fields=${encodeURIComponent(fields)}&limit=25&access_token=${encodeURIComponent(c.accessToken)}`;
  const body=await socialFetchJson(url);
  return (body?.data||[]).map(x=>{
    const child=x.children?.data?.[0]||null;
    const thumb=x.thumbnail_url||((x.media_type==="IMAGE")?x.media_url:null)||child?.thumbnail_url||child?.media_url||null;
    const product=String(x.media_product_type||"").toUpperCase();
    const type=product==="REELS"?"Reel":x.media_type==="CAROUSEL_ALBUM"?"Karussell":x.media_type==="VIDEO"?"Video":"Beitrag";
    return {id:String(x.id),title:type,caption:String(x.caption||""),type,url:x.permalink||null,thumbnailUrl:thumb,publishedAt:x.timestamp||null,raw:x};
  }).filter(x=>x.id);
}
async function fetchTikTokProfile(token){
  // user.info.basic permits only basic identity fields. profile_deep_link now
  // requires user.info.profile and is intentionally not requested because the
  // application only needs user.info.basic + video.list.
  const fields="open_id,display_name,avatar_url";
  const body=await socialFetchJson(`https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`,{headers:{Authorization:`Bearer ${token}`}});
  return body?.data?.user||body?.data||null;
}
async function fetchTikTokMedia(){
  let token=await refreshTikTokTokenIfNeeded(false);
  if(!token)throw new Error("TikTok ist nicht konfiguriert.");
  const fields="id,title,video_description,duration,cover_image_url,share_url,create_time";
  const request=async t=>socialFetchJson(`https://open.tiktokapis.com/v2/video/list/?fields=${encodeURIComponent(fields)}`,{
    method:"POST",headers:{Authorization:`Bearer ${t}`,"Content-Type":"application/json"},body:JSON.stringify({max_count:20})
  });
  let body;
  try{body=await request(token);}
  catch(err){
    if(Number(err.status)===401&&socialCredentials().tiktok.canAutoRefresh){token=await refreshTikTokTokenIfNeeded(true);body=await request(token);}
    else throw err;
  }
  const apiError=body?.error;
  if(apiError&&apiError.code&&apiError.code!=="ok"&&apiError.code!==0)throw new Error(apiError.message||String(apiError.code));
  return (body?.data?.videos||[]).map(x=>({
    id:String(x.id),title:String(x.title||"TikTok-Video"),caption:String(x.video_description||x.title||""),
    type:"Video",url:x.share_url||null,thumbnailUrl:x.cover_image_url||null,
    publishedAt:x.create_time?new Date(Number(x.create_time)*1000).toISOString():null,raw:x
  })).filter(x=>x.id);
}
async function fetchThumbnailBlob(url){
  if(!url)return null;
  try{
    const downloaded=await fetchBufferLimited(url,{maxBytes:8*1024*1024,timeoutMs:10000});
    const type=downloaded.contentType||"image/jpeg";
    if(!type.startsWith("image/"))return null;
    const buf=downloaded.buffer;
    const ext=type.includes("png")?"png":type.includes("webp")?"webp":"jpg";
    return {buf,type,filename:`social-thumbnail.${ext}`};
  }catch{return null}
}
async function sendSocialDiscordMessage(platform,item,{test=false}={}){
  const cfg=socialConfig[platform],channelId=cfg.channelId;
  if(!channelById(channelId))throw new Error("Social-Media-Zielkanal wurde nicht gefunden.");
  const content=socialTemplate(cfg.text,item);
  const embed=cfg.useEmbed?{
    title:item.title||`${platform==="instagram"?"Instagram":"TikTok"} · Neuer Beitrag`,
    url:item.url||undefined,
    description:item.caption?String(item.caption).slice(0,4000):undefined,
    footer:{text:`${platform==="instagram"?"Instagram":"TikTok"}${discordTexts().socialFooterBrand?` · ${discordTexts().socialFooterBrand}`:""}`},
    timestamp:item.publishedAt||undefined
  }:null;
  let thumbnail=null;
  if(cfg.includeThumbnail&&item.thumbnailUrl)thumbnail=await fetchThumbnailBlob(item.thumbnailUrl);
  if(thumbnail){
    if(embed)embed.image={url:`attachment://${thumbnail.filename}`};
    const form=new FormData();
    form.append("payload_json",JSON.stringify({content,allowed_mentions:{parse:[],users:[],roles:[]},embeds:embed?[embed]:[]}));
    form.append("files[0]",new Blob([thumbnail.buf],{type:thumbnail.type}),thumbnail.filename);
    const r=await fetch(`${API_BASE}/channels/${channelId}/messages`,{method:"POST",headers:{Authorization:`Bot ${process.env.DISCORD_BOT_TOKEN}`,"User-Agent":discordTexts().userAgent},body:form});
    const text=await r.text();let body=null;try{body=text?JSON.parse(text):null}catch{body=text}
    if(!r.ok)throw new Error(`Discord API ${r.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
    return body;
  }
  if(embed&&item.thumbnailUrl)embed.image={url:item.thumbnailUrl};
  return sendAnnouncementMessage(channelId,content,null,embed);
}
async function processSocialItem(platform,item,{force=false,note=null}={}){
  const seen=socialState.seen[platform]?.[item.id];
  if(seen?.status==="sent"&&!force)return {status:"duplicate"};
  const existing=socialHistory.items.find(x=>x.key===`${platform}:${item.id}`);
  const attempts=Number(existing?.attempts||0)+1;
  try{
    const msg=await sendSocialDiscordMessage(platform,item);
    socialState.seen[platform][item.id]={status:"sent",seenAt:now(),seenAtMs:Date.now(),discordMessageId:msg?.id||null};
    socialState.platforms[platform].lastDiscordAt=now();
    socialState.platforms[platform].lastError=null;
    upsertSocialHistory(socialHistoryRow(platform,item,"sent",null,{detectedAt:existing?.detectedAt||now(),attempts,discordChannelId:socialConfig[platform].channelId,discordMessageId:msg?.id||null,sentAt:now(),note}));
    saveSocialState();
    return {status:"sent",messageId:msg?.id||null};
  }catch(err){
    socialState.seen[platform][item.id]={status:"failed",seenAt:now(),seenAtMs:Date.now(),error:err.message};
    socialState.platforms[platform].lastError=err.message;
    upsertSocialHistory(socialHistoryRow(platform,item,"failed",err.message,{detectedAt:existing?.detectedAt||now(),attempts,discordChannelId:socialConfig[platform].channelId}));
    saveSocialState();
    throw err;
  }
}
// 9.25.6: Linkprüfer je Plattform. Nur TikTok; Instagram bleibt unverändert.
const socialLinkCheckers={tiktok:url=>checkTikTokLink(url,{userAgent:discordTexts().userAgent})};
function recordSocialDecision(platform,item,decision){
  const existing=socialHistory.items.find(x=>x.key===`${platform}:${item.id}`);
  const status=decision.action==="wait"?"waiting":"skipped";
  socialState.seen[platform][item.id]={status,seenAt:now(),seenAtMs:Date.now(),error:decision.reason,linkTries:Number(decision.tries||0)};
  upsertSocialHistory(socialHistoryRow(platform,item,status,decision.reason,{detectedAt:existing?.detectedAt||now(),attempts:Number(existing?.attempts||0),linkTries:Number(decision.tries||0)}));
  saveSocialState();
}
function socialSortOldestFirst(items){return [...items].sort((a,b)=>Date.parse(a.publishedAt||0)-Date.parse(b.publishedAt||0));}
async function pollSocialPlatform(platform,{manual=false}={}){
  const cfg=socialConfig[platform],ps=socialState.platforms[platform];
  ps.lastCheckAt=now();saveSocialState();
  if(!socialConfig.enabled||!cfg.enabled)return {platform,status:"disabled",newCount:0};
  const creds=socialCredentials()[platform];
  if(!creds.configured){ps.lastError="API-Zugang nicht konfiguriert.";saveSocialState();return {platform,status:"not_configured",newCount:0};}
  try{
    let items,profile=null;
    if(platform==="instagram"){profile=await fetchInstagramProfile();items=await fetchInstagramMedia();}
    else{
      const token=await refreshTikTokTokenIfNeeded(false);
      profile=await fetchTikTokProfile(token);
      items=await fetchTikTokMedia();
    }
    ps.profile=profile||ps.profile;ps.lastSuccessAt=now();ps.lastError=null;

    // Erster erfolgreicher Abruf ist ausschließlich Baseline: KEIN Backfill.
    if(!socialState.initialized[platform]){
      for(const item of items){
        socialState.seen[platform][item.id]={status:"baseline",seenAt:now(),seenAtMs:Date.now()};
        upsertSocialHistory(socialHistoryRow(platform,item,"baseline",null,{detectedAt:now(),attempts:0}));
      }
      socialState.initialized[platform]=true;saveSocialState();
      return {platform,status:"baseline",baselineCount:items.length,newCount:0};
    }

    const pending=socialSortOldestFirst(items.filter(item=>{
      const row=socialState.seen[platform]?.[item.id];
      return !row||row.status==="failed"||row.status==="waiting";
    }));
    let sent=0,failed=0,skipped=0,waiting=0;
    for(const item of pending){
      ps.lastDetectedAt=now();
      try{
        const prior=socialState.seen[platform]?.[item.id];
        const decision=await decideSocialItem({item,cfg,tries:Number(prior?.linkTries||0),checkLink:socialLinkCheckers[platform]});
        if(decision.action!=="send"){
          recordSocialDecision(platform,item,decision);
          if(decision.action==="wait")waiting++;else skipped++;
          log(`ℹ️ ${platform}: Beitrag ${item.id} nicht gesendet – ${decision.reason}`);
          continue;
        }
        const r=await processSocialItem(platform,item,{note:decision.note||null});if(r.status==="sent")sent++;
      }
      catch(err){failed++;warn(`⚠️ ${platform} → Discord fehlgeschlagen (${item.id}):`,err.message);}
    }
    saveSocialState();
    return {platform,status:"ok",found:items.length,newCount:sent,failed,skipped,waiting};
  }catch(err){
    ps.lastError=err.message;saveSocialState();throw err;
  }
}
async function pollSocialAll({manual=false}={}){
  if(!moduleState.isOn("socialMedia"))return {ok:true,status:"module_disabled"}; // 9.4.0: Modul aus → keine Abfrage
  if(socialPollRunning)return {ok:true,status:"already_running"};
  socialPollRunning=true;socialState.lastPollAt=now();saveSocialState();
  const results=[];
  try{
    for(const platform of["instagram","tiktok"]){
      try{results.push(await pollSocialPlatform(platform,{manual}));}
      catch(err){results.push({platform,status:"error",error:err.message});}
    }
    return {ok:true,results};
  }finally{
    socialPollRunning=false;scheduleSocialPoll();
  }
}
function scheduleSocialPoll(){
  if(socialPollTimer){clearTimeout(socialPollTimer);socialPollTimer=null;}
  if(!socialConfig.enabled)return;
  if(!moduleState.isOn("socialMedia"))return; // 9.4.0: Modul aus → kein Abruf geplant
  const delay=Math.max(5,Number(socialConfig.pollMinutes||10))*60000;
  socialState.nextPollAt=new Date(Date.now()+delay).toISOString();saveSocialState();
  socialPollTimer=setTimeout(()=>pollSocialAll().catch(err=>warn("⚠️ Social-Poll fehlgeschlagen:",err.message)),delay);
  socialPollTimer.unref?.();
}
async function testSocialPlatform(platform){
  if(!["instagram","tiktok"].includes(platform))throw new Error("Unbekannte Plattform.");
  const item=platform==="instagram"
    ? {id:`test-${Date.now()}`,title:"Instagram · Test",caption:"Testmeldung aus dem Bot Control Center.",type:"Reel",url:"https://www.instagram.com/",thumbnailUrl:null,publishedAt:now()}
    : {id:`test-${Date.now()}`,title:"TikTok · Test",caption:"Testmeldung aus dem Bot Control Center.",type:"Video",url:"https://www.tiktok.com/",thumbnailUrl:null,publishedAt:now()};
  const msg=await sendSocialDiscordMessage(platform,item,{test:true});
  return {ok:true,messageId:msg?.id||null};
}
async function retrySocialHistory(key){
  const row=socialHistory.items.find(x=>x.key===key);if(!row)throw new Error("Veröffentlichung nicht gefunden.");
  const item={id:row.id,title:row.title,caption:row.caption,type:row.type,url:row.url,thumbnailUrl:row.thumbnailUrl,publishedAt:row.publishedAt};
  delete socialState.seen[row.platform][row.id];saveSocialState();
  return processSocialItem(row.platform,item,{force:true});
}
async function sendExistingSocialHistory(key,mode="test"){
  const row=socialHistory.items.find(x=>x.key===key);
  if(!row)throw new Error("Veröffentlichung nicht gefunden.");
  if(!["instagram","tiktok"].includes(row.platform))throw new Error("Unbekannte Social-Media-Plattform.");
  if(!["test","publish"].includes(mode))throw new Error("Ungültiger Versandmodus.");
  const item={
    id:row.id,title:row.title,caption:row.caption,type:row.type,
    url:row.url,thumbnailUrl:row.thumbnailUrl,publishedAt:row.publishedAt
  };

  if(mode==="publish"){
    // Bewusste Nachveröffentlichung eines Baseline-/Fehler-Eintrags:
    // Der Eintrag wird anschließend als an Discord ausgeliefert markiert.
    delete socialState.seen[row.platform][row.id];
    saveSocialState();
    const result=await processSocialItem(row.platform,item,{force:true});
    const updated=socialHistory.items.find(x=>x.key===key);
    if(updated){
      updated.manualPublishAt=now();
      updated.manualPublishCount=Number(updated.manualPublishCount||0)+1;
      saveSocialHistory();
    }
    return {ok:true,mode,status:result.status,messageId:result.messageId||null};
  }

  // Demo/Test: echte Metadaten + Link + Thumbnail erneut an Discord senden,
  // ohne Dedup-/Baseline-Status des Originals zu verändern.
  const msg=await sendSocialDiscordMessage(row.platform,item,{test:true});
  row.lastTestAt=now();
  row.lastTestMessageId=msg?.id||null;
  row.testCount=Number(row.testCount||0)+1;
  saveSocialHistory();
  return {ok:true,mode,status:"test_sent",messageId:msg?.id||null};
}

function renderAnnouncementTemplate(template,data){
  return String(template||"")
    .replaceAll("{broadcaster}",String(data.broadcasterName||textPackKit.get(installationTextPack).test.channelName))
    .replaceAll("{title}",String(data.title||""))
    .replaceAll("{game}",String(data.gameName||""))
    .replaceAll("{url}",String(data.url||""))
    .replaceAll("{creator}",String(data.creator||""))
    .replaceAll("{clip_id}",String(data.clipId||""))
    .replace(/\n{3,}/g,"\n\n").trim();
}
function announcementCatalog(){
  const textChannels=state.cache.channels.filter(c=>[0,5].includes(Number(c.type))).map(c=>({id:c.id,name:c.name,parentId:c.parent_id||null}));
  const mentionRoles=state.cache.roles.filter(r=>r.id!==IDS.guild && !r.managed && r.mentionable).map(r=>({id:r.id,name:r.name,mentionable:true}));
  return {channels:textChannels,mentionRoles};
}
function announcementView(){
  return {ok:true,config:announcementsConfig,state:{
    liveCount:Object.keys(announcementsState.liveStreams||{}).length,
    clipCount:Object.keys(announcementsState.clips||{}).length,
    lastLiveAt:announcementsState.lastLiveAt,lastClipAt:announcementsState.lastClipAt,lastError:announcementsState.lastError
  },catalog:announcementCatalog()};
}
async function sendAnnouncementMessage(channelId,content,mentionRoleId=null,embed=null){
  const allowed={parse:[],users:[],roles:mentionRoleId?[mentionRoleId]:[],replied_user:false};
  const body={content:(mentionRoleId?`<@&${mentionRoleId}> `:"")+content,allowed_mentions:allowed};
  if(embed)body.embeds=[embed];
  return discordApi(`/channels/${channelId}/messages`,"POST",body);
}
async function ingestAnnouncement(type,key,payload,{test=false}={}){
  if(!["live","clip"].includes(type))throw new Error("Unbekannter Ankündigungstyp.");
  const enabled=type==="live"?announcementsConfig.liveEnabled:announcementsConfig.clipsEnabled;
  const channelId=type==="live"?announcementsConfig.liveChannelId:announcementsConfig.clipsChannelId;
  if(!channelById(channelId))throw new Error("Zielkanal wurde nicht gefunden.");
  if(!enabled&&!test)return {ok:true,status:"disabled"};

  const bucket=type==="live"?announcementsState.liveStreams:announcementsState.clips;
  if(!test && bucket[key])return {ok:true,status:"duplicate"};

  const template=type==="live"?announcementsConfig.liveText:announcementsConfig.clipText;
  const content=renderAnnouncementTemplate(template,payload||{});
  let embed=null;
  if(announcementsConfig.useEmbeds){
    embed=type==="live"
      ? {title:payload?.title||`${textPackKit.get(installationTextPack).test.channelName} ist LIVE`,url:payload?.url||undefined,description:payload?.gameName?`Kategorie: ${payload.gameName}`:undefined}
            : {title:payload?.title||"Neuer Twitch-Clip",url:payload?.url||undefined,description:payload?.creator?`Erstellt von ${payload.creator}`:undefined,image:payload?.thumbnailUrl?{url:payload.thumbnailUrl}:undefined};
  }
  await sendAnnouncementMessage(channelId,content,announcementsConfig.mentionRoleId,embed);

  if(!test){
    bucket[key]={sentAt:now(),url:payload?.url||null,title:payload?.title||null};
    if(type==="live")announcementsState.lastLiveAt=now(); else announcementsState.lastClipAt=now();
    announcementsState.lastError=null; saveAnnouncementsState();
  }
  return {ok:true,status:test?"test":"sent"};
}


function discordDashboardSummary(){
  const mod=moderationStats(),reports=reportCounts(),onboarding=onboardingSummary();
  const sanctions=sanctionedUsers();
  const ctProfiles=(channelTimesConfig.profiles||[]).map(nextChannelTimeView);
  const social=socialConnectionSummary();
  const warnings=[];
  if(!state.gateway.ready)warnings.push({level:"error",area:"System",text:"Discord Gateway ist nicht bereit."});
  if(state.gateway.lastError)warnings.push({level:"error",area:"System",text:state.gateway.lastError});
  if(moderationState.lastError)warnings.push({level:"error",area:"Moderation",text:moderationState.lastError});
  if(reportsState.lastError)warnings.push({level:"error",area:"Meldungen",text:reportsState.lastError});
  if(onboarding.lastError)warnings.push({level:"error",area:"Freischaltung",text:onboarding.lastError});
  if(channelTimesState.lastError)warnings.push({level:"error",area:"Kanalzeiten",text:channelTimesState.lastError});
  if(emergencyState.lastError)warnings.push({level:"error",area:"Notfallmodus",text:emergencyState.lastError});
  if(emergencyState.active)warnings.unshift({level:"critical",area:"Notfallmodus",text:`${emergencyLevelLabel()} aktiv · ${emergencyState.reason||"kein Grund"}`});
  const failedSocial=(socialHistory.items||[]).filter(x=>x.status==="failed").length;
  return {
    ok:true,generatedAt:now(),
    service:{
      gatewayReady:state.gateway.ready,connected:state.gateway.connected,guildFound:state.guild.found,
      guildName:state.guild.name,botName:state.bot.username,uptimeSeconds:Math.round(process.uptime()),
      lastEventAt:state.gateway.lastEventAt,lastError:state.gateway.lastError
    },
    reports:{...reports,lastCreatedAt:reportsState.lastCreatedAt,lastError:reportsState.lastError},
    moderation:{
      enabled:moderationConfig.enabled,...mod,activeEscalations:sanctions.length,
      bansTracked:Object.values(moderationState.users||{}).filter(x=>x.bannedAt).length
    },
    onboarding:{
      enabled:onboarding.enabled,totalWelcomed:onboarding.totalWelcomed,totalVerified:onboarding.totalVerified,
      bypassPrevented:onboarding.bypassPrevented,lastActionAt:onboarding.lastActionAt,lastError:onboarding.lastError
    },
    channelTimes:{
      enabled:channelTimesConfig.enabled,
      closed:ctProfiles.filter(x=>x.effectiveClosed).map(x=>({id:x.id,channelId:x.channelId,channelName:x.channelName,openTime:x.openTime,nextTransitionAt:x.nextTransitionAt})),
      totalProfiles:ctProfiles.length,lastRunAt:channelTimesState.lastRunAt,lastError:channelTimesState.lastError,
      suspended:emergencyState.active
    },
    emergency:{
      active:emergencyState.active,level:emergencyState.level,levelLabel:emergencyLevelLabel(),
      reason:emergencyState.reason,actor:emergencyState.actor,startedAt:emergencyState.startedAt,endsAt:emergencyState.endsAt,lastError:emergencyState.lastError
    },
    social:{
      instagram:{configured:social.instagram.configured,username:social.instagram.username,lastError:social.instagram.lastError,reauthorizationRequired:social.instagram.reauthorizationRequired,lastSuccessAt:socialState.platforms?.instagram?.lastSuccessAt||null},
      tiktok:{configured:social.tiktok.configured,environment:social.tiktok.environment,lastError:socialState.platforms?.tiktok?.lastError||null,lastSuccessAt:socialState.platforms?.tiktok?.lastSuccessAt||null},
      failedPublications:failedSocial
    },
    warnings:warnings.slice(0,20)
  };
}


const DISCORD_BACKUP_SECTIONS = {
  discordCommunity:"Discord · Community & Ankündigungen",
  discordModeration:"Discord · Moderation & Userhistorie",
  discordReports:"Discord · Meldesystem",
  discordChannelTimes:"Discord · Kanalzeiten",
  discordEmergency:"Discord · Notfallmodus-Konfiguration",
  discordLogs:"Discord · Logs & Benachrichtigungen",
  discordSocial:"Discord · Social-Media-Konfiguration & Verlauf",
  discordLevelsystem:"Discord · Levelsystem & XP"
};

function discordSafeBackupExport(){
  return {
    version:1,
    sections:{
      discordCommunity:{
        onboardingConfig:clone(onboardingConfig),
        onboardingState:clone(onboardingState),
        announcementsConfig:clone(announcementsConfig),
        announcementsState:clone(announcementsState)
      },
      discordModeration:{
        config:clone(moderationConfig),
        state:clone(moderationState),
        log:readModerationLog(2000).slice().reverse()
      },
      discordReports:{
        config:clone(reportsConfig),
        tickets:clone(reportsStore),
        state:clone(reportsState)
      },
      discordChannelTimes:{
        config:clone(channelTimesConfig),
        history:{
          lastRunAt:channelTimesState.lastRunAt||null,
          lastError:channelTimesState.lastError||null,
          events:clone(channelTimesState.events||[])
        }
      },
      discordEmergency:{
        config:clone(emergencyConfig),
        history:{
          lastError:emergencyState.lastError||null,
          events:clone(emergencyState.history||[])
        }
      },
      discordLogs:{
        config:clone(discordLogConfig)
      },
      discordLevelsystem:{config:clone(levelEngine.config),state:clone(levelEngine.state)},
      discordSocial:{
        config:clone(socialConfig),
        state:clone(socialState),
        history:clone(socialHistory)
      }
    },
    exclusions:[
      "Discord Bot Token",
      "Discord Client Secret",
      "Instagram Access Token",
      "TikTok Access-/Refresh-Token",
      "Social OAuth-Zustände",
      "aktive Notfallmodus-Rechte-Snapshots",
      "aktive Kanalzeiten-Rechte-Snapshots",
      "archivierte Attachment-Binärdateien"
    ]
  };
}

function validateDiscordBackupPayload(payload, include=[]){
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new Error("Discord-Backup-Daten sind ungültig.");
  const selected=[...new Set((Array.isArray(include)?include:[]).map(String).filter(x=>DISCORD_BACKUP_SECTIONS[x]))];
  if(!selected.length)throw new Error("Keine gültigen Discord-Backup-Bereiche ausgewählt.");
  for(const key of selected){
    const value=payload[key];
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`${DISCORD_BACKUP_SECTIONS[key]} fehlt oder ist ungültig.`);
  }
  return selected;
}

function normalizeAnnouncementsConfigForRestore(raw={}){
  return {
    liveEnabled:raw.liveEnabled===true,
    clipsEnabled:raw.clipsEnabled===true,
    liveChannelId:cleanId(raw.liveChannelId,IDS.channels.twitch),
    clipsChannelId:cleanId(raw.clipsChannelId,IDS.channels.clips),
    liveText:normalizeAnnouncementText(raw.liveText,DEFAULT_ANNOUNCEMENTS_CONFIG.liveText).slice(0,1800),
    clipText:normalizeAnnouncementText(raw.clipText,DEFAULT_ANNOUNCEMENTS_CONFIG.clipText).slice(0,1800),
    mentionRoleId:cleanId(raw.mentionRoleId,null),
    useEmbeds:raw.useEmbeds!==false
  };
}

async function restoreDiscordSafeBackup(payload, include=[], {dryRun=false}={}){
  const selected=validateDiscordBackupPayload(payload,include);

  if((selected.includes("discordChannelTimes")||selected.includes("discordEmergency"))&&emergencyState.active){
    throw new Error("Kanalzeiten-/Notfall-Konfiguration kann während eines aktiven Notfallmodus nicht wiederhergestellt werden.");
  }

  // Vollständige Validierung vor Änderungen.
  if(selected.includes("discordCommunity")){
    const x=payload.discordCommunity;
    if(!x.onboardingConfig||!x.onboardingState||!x.announcementsConfig||!x.announcementsState)throw new Error("Discord Community-Backup ist unvollständig.");
  }
  if(selected.includes("discordModeration")){
    const x=payload.discordModeration;
    if(!x.config||!x.state||!Array.isArray(x.log))throw new Error("Discord Moderations-Backup ist unvollständig.");
  }
  if(selected.includes("discordReports")){
    const x=payload.discordReports;
    if(!x.config||!x.tickets||!Array.isArray(x.tickets.tickets)||!x.state)throw new Error("Discord Meldesystem-Backup ist unvollständig.");
  }
  if(selected.includes("discordChannelTimes")){
    const x=payload.discordChannelTimes;
    if(!x.config||typeof x.config!=="object")throw new Error("Discord Kanalzeiten-Backup ist unvollständig.");
    normalizeChannelTimesConfig(x.config);
  }
  if(selected.includes("discordEmergency")){
    const x=payload.discordEmergency;
    if(!x.config||typeof x.config!=="object")throw new Error("Discord Notfallmodus-Backup ist unvollständig.");
    normalizeEmergencyConfig(x.config);
  }
  if(selected.includes("discordLogs")){
    const x=payload.discordLogs;
    if(!x.config||typeof x.config!=="object")throw new Error("Discord Log-Backup ist unvollständig.");
    normalizeDiscordLogConfig(x.config);
  }
  if(selected.includes("discordLevelsystem")){const x=payload.discordLevelsystem;if(!x?.config||!x?.state||typeof x.state.users!=="object"||typeof x.state.grants!=="object")throw Error("Levelsystem-Backup ist unvollständig.");validateRanksForBackup(x.config.ranks);}
  if(selected.includes("discordSocial")){
    const x=payload.discordSocial;
    if(!x.config||!x.state||!x.history||!Array.isArray(x.history.items))throw new Error("Discord Social-Media-Backup ist unvollständig.");
    normalizeSocialConfig(x.config);
  }

  if(dryRun)return {ok:true,validated:selected};

  const restored=[];

  if(selected.includes("discordCommunity")){
    const x=payload.discordCommunity;
    writeJsonFile(ONBOARDING_CONFIG_FILE,x.onboardingConfig);
    if(pgStore.enabled){const r=pgStore.putDiscordOnboardingState(normalizeOnboardingState(x.onboardingState),null,{replace:true});onboardingStateRevision=Number(r?.revision||onboardingStateRevision||1);}else writeJsonFile(ONBOARDING_STATE_FILE,x.onboardingState);
    onboardingConfig=loadOnboardingConfig();
    onboardingState=loadOnboardingState();

    announcementsConfig=normalizeAnnouncementsConfigForRestore(x.announcementsConfig);
    announcementsState={
      liveStreams:x.announcementsState?.liveStreams&&typeof x.announcementsState.liveStreams==="object"?x.announcementsState.liveStreams:{},
      clips:x.announcementsState?.clips&&typeof x.announcementsState.clips==="object"?x.announcementsState.clips:{},
      lastLiveAt:x.announcementsState?.lastLiveAt||null,
      lastClipAt:x.announcementsState?.lastClipAt||null,
      lastError:null
    };
    saveAnnouncementsConfig();
    if(pgStore.enabled){const r=pgStore.putDiscordAnnouncementsState(announcementsState,null,{replace:true});announcementsStateRevision=Number(r?.revision||announcementsStateRevision||1);}else saveAnnouncementsState();
    restored.push("discordCommunity");
  }

  if(selected.includes("discordModeration")){
    const x=payload.discordModeration;
    writeJsonFile(MODERATION_CONFIG_FILE,x.config);
    if(pgStore.enabled){
      const r=pgStore.putDiscordModerationState(x.state||{recent:{},users:{},lastActionAt:null,lastError:null},null,{replace:true});
      moderationStateRevision=Number(r?.revision||moderationStateRevision||1);
    }else writeJsonFile(MODERATION_STATE_FILE,x.state);
    moderationConfig=loadModerationConfig();
    moderationState=loadModerationState();
    if(pgStore.enabled)pgStore.replaceEvents("moderation",x.log.slice(-2000).reverse());
    else{ensureDataDir();const lines=x.log.slice(-2000).map(entry=>JSON.stringify(entry)).join("\n");fs.writeFileSync(MODERATION_LOG_FILE,lines?lines+"\n":"","utf8");}
    restored.push("discordModeration");
  }

  if(selected.includes("discordReports")){
    const x=payload.discordReports;
    reportsConfig=normalizeReportsConfig(x.config);
    reportsStore={tickets:Array.isArray(x.tickets.tickets)?x.tickets.tickets.slice(-5000):[]};
    reportsState={
      sequenceByYear:x.state.sequenceByYear&&typeof x.state.sequenceByYear==="object"?x.state.sequenceByYear:{},
      cooldowns:{},
      lastCreatedAt:x.state.lastCreatedAt||null,
      lastError:null,
      commandsRegisteredAt:x.state.commandsRegisteredAt||null
    };
    saveReportsConfig();
    if(pgStore.enabled){const r=pgStore.putDiscordReportsState(reportsStore,reportsState,null,{replace:true});reportsRevision=Number(r?.revision||reportsRevision||1);}else{saveReports();saveReportsState();}
    restored.push("discordReports");
  }

  if(selected.includes("discordChannelTimes")){
    const x=payload.discordChannelTimes;
    await updateChannelTimesConfig(x.config);
    channelTimesState.events=Array.isArray(x.history?.events)?x.history.events.slice(-500):channelTimesState.events;
    channelTimesState.lastError=null;
    if(pgStore.enabled){const r=pgStore.putDiscordChannelTimesState(channelTimesState,null,{replace:true});channelTimesStateRevision=Number(r?.revision||channelTimesStateRevision||1);}else saveChannelTimesState();
    restored.push("discordChannelTimes");
  }

  if(selected.includes("discordEmergency")){
    const x=payload.discordEmergency;
    await updateEmergencyConfig(x.config);
    emergencyState.history=Array.isArray(x.history?.events)?x.history.events.slice(-500):emergencyState.history;
    emergencyState.lastError=null;
    if(pgStore.enabled){const r=pgStore.putDiscordEmergencyState(emergencyState,null,{replace:true});emergencyStateRevision=Number(r?.revision||emergencyStateRevision||1);}else saveEmergencyState();
    restored.push("discordEmergency");
  }

  if(selected.includes("discordLogs")){
    updateDiscordLogConfig(payload.discordLogs.config);
    restored.push("discordLogs");
  }

  if(selected.includes("discordLevelsystem")){
    const x=payload.discordLevelsystem;
    // Validate the complete backup before writing either restored document.
    // Keep the current in-memory game usable if a persistence operation fails.
    const previousConfig=structuredClone(levelEngine.config),previousState=structuredClone(levelEngine.state);
    levelEngine.restore(x.config,x.state);
    try{
      if(pgStore.enabled){pgStore.putDocument('levelsystem-config',x.config);pgStore.putDocument('levelsystem-state',x.state);}
      else{for(const [key,value] of Object.entries({config:x.config,state:x.state})){const f=path.join(DATA_DIR,`levelsystem-${key}.json`);fs.writeFileSync(f+'.tmp',JSON.stringify(value));fs.renameSync(f+'.tmp',f);}}
    }catch(error){levelEngine.restore(previousConfig,previousState);throw error;}
    restored.push('discordLevelsystem');
  }
  if(selected.includes("discordSocial")){
    const x=payload.discordSocial;
    socialConfig=normalizeSocialConfig(x.config);
    socialState=normalizeSocialState(x.state);
    socialHistory=normalizeSocialHistory(x.history);
    saveSocialConfig();
    if(pgStore.enabled){const r=pgStore.putDiscordSocialState(socialState,socialHistory,null,{replace:true});socialRevision=Number(r?.revision||socialRevision||1);}else{saveSocialState();saveSocialHistory();}
    scheduleSocialPoll();
    restored.push("discordSocial");
  }

  await verifyGuildConfiguration().catch(()=>{});
  return {ok:true,restored};
}

function safeStatus(){return{service:SERVICE_LABEL,version:"2.0.1",uptimeSeconds:Math.round(process.uptime()),config:{clientId:process.env.DISCORD_CLIENT_ID||null,botTokenConfigured:!!process.env.DISCORD_BOT_TOKEN,clientSecretConfigured:!!process.env.DISCORD_CLIENT_SECRET,guildId:IDS.guild||null,redirectUri:process.env.DISCORD_REDIRECT_URI||null},...state,onboarding:onboardingSummary(),reports:{enabled:reportsConfig.enabled,counts:reportCounts(),commandsRegisteredAt:reportsState.commandsRegisteredAt,lastError:reportsState.lastError},social:{config:socialConfig,connections:socialConnectionSummary(),state:socialState}};}
class RequestInputError extends Error{constructor(message,status=400){super(message);this.status=status;}}
async function readRequestJson(req,maxBytes=JSON_BODY_LIMIT){
  const declared=Number(req.headers["content-length"]||0);
  if(Number.isFinite(declared)&&declared>maxBytes)throw new RequestInputError("Request ist zu groß.",413);
  const chunks=[];let total=0;
  for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw new RequestInputError("Request ist zu groß.",413);chunks.push(chunk);}
  if(!total)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new RequestInputError("Ungültiges JSON.",400);}
}
function serviceAuthValid(req){
  if(INTERNAL_SERVICE_SECRET.length<32||/^HIER_|^CHANGE_ME/i.test(INTERNAL_SERVICE_SECRET))return false;
  const provided=String(req.headers["x-bwk-service-secret"]||"");
  const a=Buffer.from(provided),b=Buffer.from(INTERNAL_SERVICE_SECRET);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function privateLiteralHost(host){
  const h=String(host||"").toLowerCase();
  if(h==="localhost"||h==="::1"||h.endsWith(".localhost"))return true;
  const m=h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if(!m)return false;
  const p=m.slice(1).map(Number);if(p.some(x=>x<0||x>255))return true;
  return p[0]===10||p[0]===127||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168);
}
let activeExternalDownloads=0;
const MAX_EXTERNAL_DOWNLOADS=4;
async function fetchBufferLimited(url,{maxBytes=8*1024*1024,timeoutMs=10000,allowedHosts=null}={}){
  let parsed;try{parsed=new URL(url);}catch{throw new Error("Ungültige Download-URL.");}
  if(parsed.protocol!=="https:")throw new Error("Unsicheres Download-Protokoll.");
  if(privateLiteralHost(parsed.hostname))throw new Error("Private Download-Ziele sind nicht erlaubt.");
  if(Array.isArray(allowedHosts)&&allowedHosts.length&&!allowedHosts.some(h=>parsed.hostname===h||parsed.hostname.endsWith(`.${h}`)))throw new Error("Download-Host nicht freigegeben.");
  if(activeExternalDownloads>=MAX_EXTERNAL_DOWNLOADS)throw new Error("Zu viele parallele Downloads.");
  activeExternalDownloads++;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(parsed,{signal:controller.signal,redirect:"error"});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const declared=Number(response.headers.get("content-length")||0);
    if(Number.isFinite(declared)&&declared>maxBytes)throw new Error("Datei zu groß");
    const chunks=[];let total=0;
    for await(const chunk of response.body){total+=chunk.length;if(total>maxBytes){controller.abort();throw new Error("Datei zu groß");}chunks.push(Buffer.from(chunk));}
    return {buffer:Buffer.concat(chunks),contentType:response.headers.get("content-type")||"application/octet-stream"};
  }finally{clearTimeout(timer);activeExternalDownloads=Math.max(0,activeExternalDownloads-1);}
}

// Weiterleitungsadresse: explizite Umgebung (DISCORD_REDIRECT_URI) vor der vom Control Center aus der öffentlichen Adresse abgeleiteten.
function effectiveRedirectUri(provided){
  const env=String(process.env.DISCORD_REDIRECT_URI||"").trim();
  if(env)return env;
  const v=String(provided||"").trim();
  return /^https?:\/\/[^\s?#]+\/auth\/discord\/callback$/.test(v)?v:"";
}
async function exchangeDiscordOAuthCode(code,codeVerifier,providedRedirectUri){
  const clientId=String(process.env.DISCORD_CLIENT_ID||"").trim();
  const clientSecret=String(process.env.DISCORD_CLIENT_SECRET||"").trim();
  const redirectUri=effectiveRedirectUri(providedRedirectUri);
  if(!clientId||!clientSecret||!redirectUri) throw new Error("Discord OAuth-Konfiguration unvollständig.");

  const params=new URLSearchParams({
    client_id:clientId,
    client_secret:clientSecret,
    grant_type:"authorization_code",
    code:String(code||""),
    redirect_uri:redirectUri,
    code_verifier:String(codeVerifier||"")
  });
  const tr=await fetch(`${API_BASE}/oauth2/token`,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:params
  });
  const token=await tr.json().catch(()=>({}));
  if(!tr.ok) throw new Error(`Discord OAuth Token fehlgeschlagen (${tr.status}): ${token.error_description||token.error||"unbekannt"}`);

  const headers={Authorization:`Bearer ${token.access_token}`};
  const [ur,mr]=await Promise.all([
    fetch(`${API_BASE}/users/@me`,{headers}),
    fetch(`${API_BASE}/users/@me/guilds/${IDS.guild}/member`,{headers})
  ]);
  const user=await ur.json().catch(()=>({}));
  const member=await mr.json().catch(()=>null);
  if(!ur.ok) throw new Error(`Discord Identität konnte nicht gelesen werden (${ur.status}).`);
  if(!mr.ok) throw new Error(`Discord Servermitgliedschaft konnte nicht bestätigt werden (${mr.status}).`);

  return {user,member,scopes:Array.isArray(token.scope)?token.scope:String(token.scope||"").split(/\s+/).filter(Boolean)};
}

function postgresLegacyExport(){
  if(!pgStore.enabled)throw new Error("PostgreSQL ist nicht aktiv.");
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const root=path.join(DATA_DIR,"postgres-rollback",stamp);
  fs.mkdirSync(root,{recursive:true});
  const files=[];
  for(const [file,key] of PG_DOCUMENT_FILES){
    if(file===ONBOARDING_STATE_FILE||file===ANNOUNCEMENTS_STATE_FILE||file===REPORTS_FILE||file===REPORTS_STATE_FILE||file===SOCIAL_STATE_FILE||file===SOCIAL_HISTORY_FILE)continue;
    const out=path.join(root,path.basename(file));
    const value=file===MODERATION_STATE_FILE?(pgStore.getDiscordModerationState()?.state||{recent:{},users:{},lastActionAt:null,lastError:null}):pgStore.getDocument(key,{});
    fs.writeFileSync(out,JSON.stringify(value,null,2)+"\n",{mode:0o600});
    files.push(path.basename(out));
  }
  const onboardingRel=pgStore.getDiscordOnboardingState();
  const onboardingOut=path.join(root,path.basename(ONBOARDING_STATE_FILE));
  fs.writeFileSync(onboardingOut,JSON.stringify(onboardingRel?.found?onboardingRel.state:{members:{},stats:{}},null,2)+"\n",{mode:0o600});files.push(path.basename(onboardingOut));
  const announcementsRel=pgStore.getDiscordAnnouncementsState();
  const announcementsOut=path.join(root,path.basename(ANNOUNCEMENTS_STATE_FILE));
  fs.writeFileSync(announcementsOut,JSON.stringify(announcementsRel?.found?announcementsRel.state:DEFAULT_ANNOUNCEMENTS_STATE,null,2)+"\n",{mode:0o600});files.push(path.basename(announcementsOut));
  const reportsRel=pgStore.getDiscordReportsState();
  const reportsOut=path.join(root,path.basename(REPORTS_FILE));
  fs.writeFileSync(reportsOut,JSON.stringify(reportsRel?.found?reportsRel.tickets:{tickets:[]},null,2)+"\n",{mode:0o600});files.push(path.basename(reportsOut));
  const reportsStateOut=path.join(root,path.basename(REPORTS_STATE_FILE));
  fs.writeFileSync(reportsStateOut,JSON.stringify(reportsRel?.found?reportsRel.state:DEFAULT_REPORTS_STATE,null,2)+"\n",{mode:0o600});files.push(path.basename(reportsStateOut));
  const socialRel=pgStore.getDiscordSocialState();
  const socialStateOut=path.join(root,path.basename(SOCIAL_STATE_FILE));
  fs.writeFileSync(socialStateOut,JSON.stringify(socialRel?.found?socialRel.state:DEFAULT_SOCIAL_STATE,null,2)+"\n",{mode:0o600});files.push(path.basename(socialStateOut));
  const socialHistoryOut=path.join(root,path.basename(SOCIAL_HISTORY_FILE));
  fs.writeFileSync(socialHistoryOut,JSON.stringify(socialRel?.found?socialRel.history:{items:[]},null,2)+"\n",{mode:0o600});files.push(path.basename(socialHistoryOut));
  const log=[...pgStore.queryEvents("moderation",2000)].reverse();
  fs.writeFileSync(path.join(root,path.basename(MODERATION_LOG_FILE)),log.map(x=>JSON.stringify(x)).join("\n")+(log.length?"\n":""),{mode:0o600});
  files.push(path.basename(MODERATION_LOG_FILE));
  fs.writeFileSync(path.join(root,"README-ROLLBACK.txt"),"Dieser Ordner wurde aus PostgreSQL erzeugt. Für einen Rollback auf V7.1.1 die Bot-Container stoppen und die JSON/JSONL-Dateien kontrolliert in discord-data zurückkopieren. Token-Dateien verbleiben im ursprünglichen discord-data-Verzeichnis.\n","utf8");
  return {ok:true,path:root,files};
}

const api=http.createServer(async(req,res)=>{
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Cache-Control","no-store");
  const requestUrl=new URL(req.url,"http://localhost");
  if(req.url==="/health"){const database=pgStore.status();const ok=state.gateway.ready&&state.guild.found&&(!pgStore.enabled||database.ok);res.statusCode=ok?200:503;res.end(JSON.stringify({ok,gateway:state.gateway.ready,guild:state.guild.found,guildName:state.guild.name,bot:state.bot.username,database}));return;}
  if(!serviceAuthValid(req)){res.statusCode=401;res.end(JSON.stringify({ok:false,error:"Interne Dienstauthentifizierung fehlgeschlagen."}));return;}
  if(requestUrl.pathname==="/performance"&&req.method==="GET"){res.statusCode=200;res.end(JSON.stringify({ok:true,metrics:discordPerformanceSnapshot()}));return;}
  if(req.url==="/status"){res.statusCode=200;res.end(JSON.stringify(safeStatus(),null,2));return;}
  if(requestUrl.pathname==="/storage/postgres/status"&&req.method==="GET"){res.statusCode=200;res.end(JSON.stringify(pgStore.status(),null,2));return;}
  if(requestUrl.pathname==="/storage/postgres/export-legacy"&&req.method==="POST"){try{res.statusCode=200;res.end(JSON.stringify(postgresLegacyExport(),null,2));}catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;}

  if(requestUrl.pathname==="/backup/export"&&req.method==="GET"){
    try{res.statusCode=200;res.end(JSON.stringify({ok:true,...discordSafeBackupExport()},null,2));}
    catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/backup/restore"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req,BACKUP_BODY_LIMIT);
      const result=await restoreDiscordSafeBackup(body.data||{},body.include||[],{dryRun:body.dryRun===true});
      res.statusCode=200;res.end(JSON.stringify(result,null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/system/restart"&&req.method==="POST"){
    res.statusCode=200;res.end(JSON.stringify({ok:true,message:"Discord-Dienst wird neu gestartet."},null,2));
    setTimeout(()=>{
      log("🔄 Discord-Dienst: Neustart über Control Center angefordert.");
      // supervisor.js keeps the container alive and relaunches discord-server.js.
      process.exit(75);
    },900);
    return;
  }

  // 9.8.0: Verwaltung des Einladungslinks bei ausgeschaltetem Modul gesperrt (/invite/twitch antwortet weiter, mit „nicht aktiv“).
  if(requestUrl.pathname.startsWith("/invite")&&requestUrl.pathname!=="/invite/twitch"&&!moduleState.isOn("discordInvite")){res.statusCode=404;res.end(JSON.stringify({ok:false,error:"Modul ist ausgeschaltet.",module:"discordInvite"}));return;}
  if(requestUrl.pathname==="/invite"&&req.method==="GET"){res.end(JSON.stringify({ok:true,...inviteService.get()}));return;}
  if(requestUrl.pathname==="/invite/twitch"&&req.method==="GET"){res.end(JSON.stringify({ok:true,...inviteService.twitch()}));return;}
  if(requestUrl.pathname==="/invite/config"&&req.method==="PUT"){try{const b=await readRequestJson(req);const result=inviteService.configure(b);res.end(JSON.stringify({ok:true,...result}));if(result.enabled)inviteService.check().catch(e=>warn("Invite-Prüfung",e.message));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}));}return;}
  if(requestUrl.pathname==="/invite/check"&&req.method==="POST"){try{res.end(JSON.stringify({ok:true,...await inviteService.check()}));}catch(e){res.statusCode=502;res.end(JSON.stringify({error:e.message}));}return;}
  if(requestUrl.pathname==="/invite/create"&&req.method==="POST"){try{const b=await readRequestJson(req);if(b.confirm!==true)throw Error("Explizite Bestätigung erforderlich.");res.end(JSON.stringify({ok:true,...await inviteService.create()}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}));}return;}
  // 9.5.0: Levelsystem ausgeschaltet → Verwaltung gesperrt (die Weboberfläche sperrt bereits vorher).
  if((requestUrl.pathname==="/levelsystem"||requestUrl.pathname.startsWith("/levelsystem/"))&&!levelModuleOn()){res.statusCode=404;res.end(JSON.stringify({ok:false,error:"Modul ist ausgeschaltet.",module:"levelsystem"}));return;}
  if(requestUrl.pathname==="/levelsystem/setup"&&req.method==="GET"){try{res.end(JSON.stringify({ok:true,preview:await levelSetupPreview()}));}catch(e){res.statusCode=503;res.end(JSON.stringify({ok:false,error:`Discord-Kanäle konnten nicht abgefragt werden: ${e.message}`}));}return;}
  if(requestUrl.pathname==="/levelsystem/setup"&&req.method==="POST"){try{const setup=await levelSetupChannels();res.end(JSON.stringify({ok:true,setup}));}catch(e){res.statusCode=400;res.end(JSON.stringify({ok:false,error:e.message}));}return;}
  if(requestUrl.pathname==="/levelsystem/publish"&&req.method==="POST"){try{const body=await readRequestJson(req);const result=body.kind==='rules'?await levelPublishRules():body.kind==='top'?await levelPublishTop():null;if(!result)throw Error('Unbekannte Veröffentlichung');res.end(JSON.stringify({ok:true,result}));}catch(e){res.statusCode=400;res.end(JSON.stringify({ok:false,error:e.message}));}return;}
  if(requestUrl.pathname==="/levelsystem"&&req.method==="GET"){res.end(JSON.stringify({ok:true,rulesPublished:levelRulesArePublished(),config:levelEngine.config,leaderboard:levelEngine.leaderboard().slice(0,100),players:levelEngine.leaderboard().map(u=>({...u,name:levelEngine.state.users[u.id]?.name||u.id})),total:Object.keys(levelEngine.state.users).length}));return;}
  if(requestUrl.pathname==="/levelsystem/config"&&req.method==="PUT"){try{const body=await readRequestJson(req);if(body.enabled===true&&!levelEngine.config.enabled){const preview=await levelSetupPreview();if(!preview.category||Object.values(preview.channels).some(id=>!id))throw Error('Die Kategorie und alle vier Minigame-Kanäle müssen vorhanden sein.');if(!levelRulesArePublished())throw Error('Bitte zuerst die aktuellen Regeln erfolgreich veröffentlichen.');}
   const wasEnabled=levelEngine.config.enabled;const config=levelEngine.configure(body);if(config.enabled&&!wasEnabled)ensureLevelCommands().catch(e=>warn("Minigame Slash-Commands nach Aktivierung:",e.message));res.end(JSON.stringify({ok:true,config}));}catch(e){res.statusCode=400;res.end(JSON.stringify({ok:false,error:e.message}));}return;}
  if(requestUrl.pathname==="/levelsystem/statistics"&&req.method==="GET"){const days=Number(requestUrl.searchParams.get('days')||30);if(![0,7,30,90].includes(days)){res.statusCode=400;res.end(JSON.stringify({error:'Ungültiger Zeitraum'}));return;}res.end(JSON.stringify({ok:true,statistics:levelEngine.statistics(days)}));return;}
  if(requestUrl.pathname==="/levelsystem/rank-history"&&req.method==="GET"){
   const id=String(requestUrl.searchParams.get('userId')||'');
   if(!/^\d{17,22}$/.test(id)){res.statusCode=400;res.end(JSON.stringify({ok:false,error:'Ungültige Discord-ID'}));return;}
   res.end(JSON.stringify({ok:true,entries:levelEngine.rankHistory(id,10)}));return;
  }
  if(requestUrl.pathname==="/levelsystem/mission-history"&&req.method==="GET"){
   const id=String(requestUrl.searchParams.get('userId')||'');
   if(!/^\d{17,22}$/.test(id)){res.statusCode=400;res.end(JSON.stringify({ok:false,error:'Ungültige Discord-ID'}));return;}
   res.end(JSON.stringify({ok:true,entries:levelEngine.missionHistory(id,10),status:(()=>{const status=levelEngine.missionStatus(id);return {...status,current:status.current?{name:status.current.name,startedAt:status.current.startedAt,endsAt:status.current.endsAt}:null};})()}));return;
  }
  if(requestUrl.pathname==="/levelsystem/xp-history"&&req.method==="GET"){
   const id=String(requestUrl.searchParams.get('userId')||'');
   if(!/^\d{17,22}$/.test(id)){res.statusCode=400;res.end(JSON.stringify({error:'Ungültige Discord-ID'}));return;}
   res.end(JSON.stringify({ok:true,entries:levelEngine.xpHistory(id,10)}));return;
  }
  if(requestUrl.pathname==="/levelsystem/xp"&&req.method==="POST"){try{const body=await readRequestJson(req);if(!/^\d{17,22}$/.test(String(body.userId||'')))throw Error('Ungültige Discord-ID');const userId=String(body.userId),previous=levelEngine.profile(userId),result=levelEngine.changeXp(userId,body.mode,body.amount);queueLevelSync(userId);
   const updated=levelEngine.profile(userId);
   const wasPromoted=result.after>result.before&&updated.level>previous.level;
   const announcement={attempted:false,published:false,reason:null};
   if(wasPromoted){
    if(!levelEngine.config.enabled)announcement.reason='Minigame ist nicht aktiviert';
    else if(levelEngine.config.announceManualPromotions!==true)announcement.reason='Manuelle Beförderungsmeldungen sind deaktiviert';
    else if(!levelEngine.config.channels?.befoerderungen)announcement.reason='Beförderungskanal nicht eingerichtet';
    else{
     announcement.attempted=true;
     const text=`🎖️ **${LV().promotion}**\n<@${userId}> wurde zu **${updated.rank}** befördert.${updated.next?`\n${LV().nextRank}: ${updated.next} (noch ${updated.missing} XP).`:''}`;
     try{await discordApi(`/channels/${levelEngine.config.channels.befoerderungen}/messages`,'POST',{content:text,allowed_mentions:{parse:[]}});announcement.published=true;}
     catch(err){announcement.reason=`Discord-Veröffentlichung fehlgeschlagen: ${err.message}`;warn('Minigame: manuelle Beförderungsmeldung fehlgeschlagen:',err.message);}
    }
   }
   res.end(JSON.stringify({ok:true,...result,rankChanged:updated.level!==previous.level,wasPromoted,announcement}));}catch(e){res.statusCode=400;res.end(JSON.stringify({ok:false,error:e.message}));}return;}
  if(req.url==="/dashboard-summary"&&req.method==="GET"){res.statusCode=200;res.end(JSON.stringify(discordDashboardSummary(),null,2));return;}
  if(requestUrl.pathname==="/oauth/config"&&req.method==="GET"){
    res.statusCode=200;
    res.end(JSON.stringify({ok:true,clientId:String(process.env.DISCORD_CLIENT_ID||""),redirectUri:effectiveRedirectUri(requestUrl.searchParams.get("redirectUri")),scopes:["identify","guilds.members.read"]},null,2));
    return;
  }
  if(req.url==="/oauth/exchange"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req);
      if(!body.code||!body.codeVerifier) throw new Error("Authorization Code oder PKCE-Verifier fehlt.");
      const result=await exchangeDiscordOAuthCode(body.code,body.codeVerifier,body.redirectUri);
      res.statusCode=200;res.end(JSON.stringify({ok:true,...result},null,2));
    }catch(err){
      res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));
    }
    return;
  }
  // 9.12.0: Server-ID und Rollen aus dem Control Center (Profil & Branding) übernehmen und speichern.
  if(requestUrl.pathname==="/installation"&&req.method==="PUT"){
    try{
      const body=await readRequestJson(req);
      const check=installationKit.validateDiscord(body?.discord||{},installationKit.normalizeDiscord({}));
      if(check.errors.length)throw new Error(check.errors.join(" "));
      const before=JSON.stringify(discordResolved());
      installationDiscord=installationKit.normalizeDiscord(check.value);
      const incomingPack=body?.textPack==="legacy-bwk"||body?.textPack==="neutral"?body.textPack:installationTextPack;
      if(incomingPack!==installationTextPack){installationTextPack=incomingPack;log(`ℹ️ Textpaket „${incomingPack}“ gemeldet; Standardtexte gelten nach dem nächsten Neustart des Discord-Dienstes.`);}
      writeJsonFile(INSTALLATION_FILE,{...installationDiscord,textPack:installationTextPack});
      const r=applyDiscordInstallation();
      const changed=before!==JSON.stringify(r);
      const missing=missingConfig();state.checks.config=missing;
      if(changed){log("ℹ️ Discord-Server/Rollen aus Profil & Branding übernommen.");}
      if(!missing.length){
        if(!gatewayStarted)startDiscordService().catch(()=>{});
        else if(changed)verifyGuildConfiguration().catch(()=>{});
      }
      res.statusCode=200;res.end(JSON.stringify({ok:true,changed,missing,sources:r.sources}));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message}));}
    return;
  }
  // Rollenliste des Servers für die Auswahl in Profil & Branding.
  if(requestUrl.pathname==="/roles"&&req.method==="GET"){
    try{
      const r=discordResolved();
      if(r.guildId&&process.env.DISCORD_BOT_TOKEN&&!state.cache.roles.length){try{await verifyGuildConfiguration();}catch{}}
      res.statusCode=200;
      res.end(JSON.stringify({ok:true,guildId:r.guildId,guild:{found:!!state.guild?.found,name:state.guild?.name||null},sources:r.sources,missing:missingConfig(),roles:r.guildId?discordRoleCatalog().filter(x=>!x.managed||x.id===r.roles.bot).map(x=>({id:x.id,name:x.name,position:x.position,managed:x.managed})):[]}));
    }catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message,roles:[]}));}
    return;
  }
  if(req.url==="/verify"&&req.method==="POST"){await verifyGuildConfiguration();res.statusCode=200;res.end(JSON.stringify(safeStatus(),null,2));return;}
  if(req.url.startsWith("/members")&&req.method==="GET"){
    try{
      const u=new URL(req.url,"http://discord.internal");
      const data=await searchDiscordMembers(u.searchParams.get("query")||"",u.searchParams.get("limit")||50);
      res.statusCode=200;res.end(JSON.stringify({ok:true,...data},null,2));
    }catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(req.url==="/members/role"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req);
      const result=await changeDiscordMemberRole(body.userId,body.roleId,String(body.action||""));
      res.statusCode=200;res.end(JSON.stringify({ok:true,...result},null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }

  if(requestUrl.pathname==="/emergency"&&req.method==="GET"){
    try{if(!state.cache.channels.length)await verifyGuildConfiguration();res.statusCode=200;res.end(JSON.stringify(emergencyView(),null,2));}
    catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/emergency/config"&&req.method==="PUT"){
    try{const body=await readRequestJson(req),result=await updateEmergencyConfig(body||{});res.statusCode=200;res.end(JSON.stringify(result,null,2));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/emergency/activate"&&req.method==="POST"){
    try{const body=await readRequestJson(req),result=await activateEmergencyMode(body||{});res.statusCode=200;res.end(JSON.stringify(result,null,2));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/emergency/level"&&req.method==="POST"){
    try{const body=await readRequestJson(req),result=await changeEmergencyLevel(body||{});res.statusCode=200;res.end(JSON.stringify(result,null,2));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/emergency/deactivate"&&req.method==="POST"){
    try{const body=await readRequestJson(req),result=await deactivateEmergencyMode({actor:String(body.actor||"Control Center"),reason:String(body.reason||"manuell beendet"),announce:true,logEvent:true});res.statusCode=200;res.end(JSON.stringify(result,null,2));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }

  if(requestUrl.pathname==="/logs"&&req.method==="GET"){
    try{if(!state.cache.channels.length)await verifyGuildConfiguration();res.statusCode=200;res.end(JSON.stringify(discordLogsView(),null,2));}
    catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/logs/config"&&req.method==="PUT"){
    try{const body=await readRequestJson(req),result=updateDiscordLogConfig(body||{});res.statusCode=200;res.end(JSON.stringify(result,null,2));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/logs/test"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req),eventKey=String(body.eventKey||"");
      if(!discordLogConfig.events[eventKey])throw new Error("Unbekanntes Log-Ereignis.");
      const result=await sendDiscordLogEvent(eventKey,sampleDiscordLogData(eventKey),{throwOnError:true,force:true});
      res.statusCode=200;res.end(JSON.stringify({ok:true,...result},null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/system/update-event"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req),eventKey=String(body.eventKey||"");
      if(!/^system\.update_(available|started|finished|failed|attention|tools_fallback)$/.test(eventKey))throw new Error("Unbekanntes Update-Ereignis.");
      const clip=(v,n)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/@/g,"@\u200b").slice(0,n);
      const d=body.data||{};
      const result=await sendDiscordLogEvent(eventKey,{version:clip(d.version,20),currentVersion:clip(d.currentVersion,20),summary:clip(d.summary,300),actor:clip(d.actor,60),status:clip(d.status,50),message:clip(d.message,400)});
      res.statusCode=200;res.end(JSON.stringify({ok:true,...result}));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message}));}return;
  }
  if(requestUrl.pathname==="/logs/reset"&&req.method==="POST"){
    try{const body=await readRequestJson(req),result=resetDiscordLogEvent(String(body.eventKey||""));res.statusCode=200;res.end(JSON.stringify(result,null,2));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }

  if(requestUrl.pathname==="/word-filter/notify"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req);
      const entry={eventType:"violation",source:"word-filter",userId:String(body.userId||""),username:String(body.user||"Unbekannt"),channelId:null,messageId:body.messageId?String(body.messageId):null,ruleName:`Wortfilter · ${String(body.category||"unbekannt")}`,matchedTerm:String(body.term||""),actions:[`Moderator-Hinweis · Quelle ${String(body.platform||"twitch")}`],reason:`Schweregrad ${Number(body.severity||0)}`};
      const sent=await writeModerationDiscordLog(entry,{force:true});
      const ch=sent?.channelId?channelById(sent.channelId):null;
      res.statusCode=200;res.end(JSON.stringify({ok:!!sent?.sent,...sent,channelName:ch?.name||null},null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }

  // 9.9.0: Verwaltung gesperrt, wenn das jeweilige Modul aus ist (die Weboberfläche sperrt bereits vorher).
  if((requestUrl.pathname==="/channel-times"||requestUrl.pathname.startsWith("/channel-times/"))&&!moduleState.isOn("discordChannelTimes")){res.statusCode=404;res.end(JSON.stringify({ok:false,error:"Modul ist ausgeschaltet.",module:"discordChannelTimes"}));return;}
  if((requestUrl.pathname==="/reports"||requestUrl.pathname.startsWith("/reports/"))&&!moduleState.isOn("discordReports")){res.statusCode=404;res.end(JSON.stringify({ok:false,error:"Modul ist ausgeschaltet.",module:"discordReports"}));return;}
  if(requestUrl.pathname==="/channel-times"&&req.method==="GET"){
    try{
      if(!state.cache.channels.length)await verifyGuildConfiguration();
      res.statusCode=200;res.end(JSON.stringify(channelTimesView(),null,2));
    }catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/channel-times/maintenance"&&req.method==="PUT"){
    try{const body=await readRequestJson(req);res.statusCode=200;res.end(JSON.stringify({ok:true,maintenance:await setMaintenance(body||{})}));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message}));}return;
  }
  if(requestUrl.pathname==="/channel-times/config"&&req.method==="PUT"){
    try{
      const body=await readRequestJson(req),result=await updateChannelTimesConfig(body||{});
      res.statusCode=200;res.end(JSON.stringify(result,null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/channel-times/action"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req),result=await manualChannelTimeAction(String(body.profileId||""),String(body.action||""));
      res.statusCode=200;res.end(JSON.stringify({ok:true,result},null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }

  // 9.4.0: Modulstand von der Weboberfläche (sofortige Übernahme) und Anzeige des bekannten Stands.
  if(requestUrl.pathname==="/internal/modules"){
    if(req.method==="GET"){res.statusCode=200;res.end(JSON.stringify({ok:true,...moduleState.snapshot()}));return;}
    if(req.method==="PUT"){
      try{const body=await readRequestJson(req);if(!moduleState.set(body?.modules,"push",body?.features))throw new RequestInputError("Ungültiger Modulstand.",400);res.statusCode=200;res.end(JSON.stringify({ok:true,...moduleState.snapshot()}));}
      catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message}));}
      return;
    }
    res.statusCode=405;res.end(JSON.stringify({ok:false}));return;
  }
  // 9.4.0: Social Media ausgeschaltet → Verwaltung gesperrt (die Weboberfläche sperrt bereits vorher).
  if(requestUrl.pathname.startsWith("/social")&&!moduleState.isOn("socialMedia")){res.statusCode=404;res.end(JSON.stringify({ok:false,error:"Modul ist ausgeschaltet.",module:"socialMedia"}));return;}
  if(requestUrl.pathname==="/social/tiktok/oauth-info"&&req.method==="GET"){
    try{res.statusCode=200;res.end(JSON.stringify({ok:true,...tiktokOauthInfo(requestUrl.searchParams.get("redirectUri"))},null,2));}catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/social/tiktok/oauth/start"&&req.method==="POST"){
    try{const body=await readRequestJson(req),result=await beginTikTokOauth(body||{});res.statusCode=200;res.end(JSON.stringify({ok:true,...result},null,2));}catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/social/tiktok/oauth/callback"&&req.method==="POST"){
    try{const body=await readRequestJson(req),result=await completeTikTokOauth(body||{});res.statusCode=200;res.end(JSON.stringify(result,null,2));}catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/social/tiktok/disconnect"&&req.method==="POST"){
    try{const result=await disconnectTikTok();res.statusCode=200;res.end(JSON.stringify(result,null,2));}catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/social/tiktok/clear-data"&&req.method==="POST"){
    try{const result=clearTikTokLocalData();res.statusCode=200;res.end(JSON.stringify(result,null,2));}catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }

  if(requestUrl.pathname==="/social"&&req.method==="GET"){
    try{
      const q={platform:requestUrl.searchParams.get("platform"),status:requestUrl.searchParams.get("status"),search:requestUrl.searchParams.get("search"),page:requestUrl.searchParams.get("page"),pageSize:requestUrl.searchParams.get("pageSize")};
      res.statusCode=200;res.end(JSON.stringify(socialView(q),null,2));
    }catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/social/instagram/token"&&req.method==="PUT"){
    try{
      const body=await readRequestJson(req),result=await installInstagramToken(String(body.token||""));
      res.statusCode=200;res.end(JSON.stringify(result,null,2));
    }catch(err){res.statusCode=400;res.end(JSON.stringify({ok:false,error:safeInstagramError(err).message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/social/instagram/refresh"&&req.method==="POST"){
    try{
      const result=await refreshInstagramToken({manual:true});
      res.statusCode=200;res.end(JSON.stringify(result,null,2));
    }catch(err){res.statusCode=400;res.end(JSON.stringify({ok:false,error:safeInstagramError(err).message,reauthorizationRequired:socialTokenState.instagram.reauthorizationRequired===true},null,2));}
    return;
  }

  if(requestUrl.pathname==="/social/config"&&req.method==="PUT"){
    try{
      const body=await readRequestJson(req);
      const next=normalizeSocialConfig({...socialConfig,...body,instagram:{...socialConfig.instagram,...(body.instagram||{})},tiktok:{...socialConfig.tiktok,...(body.tiktok||{})}});
      if(!next.instagram.channelId||!next.tiktok.channelId)throw new Error("Instagram- und TikTok-Zielkanal müssen ausgewählt sein.");
      if(!next.instagram.text||!next.tiktok.text)throw new Error("Discord-Texte dürfen nicht leer sein.");
      socialConfig=next;saveSocialConfig();scheduleSocialPoll();
      res.statusCode=200;res.end(JSON.stringify(socialView({}),null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/social/poll"&&req.method==="POST"){
    try{const result=await pollSocialAll({manual:true});res.statusCode=200;res.end(JSON.stringify(result,null,2));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/social/test"&&req.method==="POST"){
    try{const body=await readRequestJson(req),result=await testSocialPlatform(String(body.platform||""));res.statusCode=200;res.end(JSON.stringify(result,null,2));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/social/retry"&&req.method==="POST"){
    try{const body=await readRequestJson(req),result=await retrySocialHistory(String(body.key||""));res.statusCode=200;res.end(JSON.stringify({ok:true,...result},null,2));}
    catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/social/history-send"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req),result=await sendExistingSocialHistory(String(body.key||""),String(body.mode||"test"));
      res.statusCode=200;res.end(JSON.stringify(result,null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }

  if(req.url==="/announcements"&&req.method==="GET"){
    try{res.statusCode=200;res.end(JSON.stringify(announcementView(),null,2));}
    catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(req.url==="/announcements/config"&&req.method==="PUT"){
    try{
      const body=await readRequestJson(req);
      const next={...announcementsConfig};
      if(typeof body.liveEnabled==="boolean")next.liveEnabled=body.liveEnabled;
      if(typeof body.clipsEnabled==="boolean")next.clipsEnabled=body.clipsEnabled;
      if(body.liveChannelId!==undefined)next.liveChannelId=cleanId(body.liveChannelId,null);
      if(body.clipsChannelId!==undefined)next.clipsChannelId=cleanId(body.clipsChannelId,null);
      if(body.mentionRoleId!==undefined)next.mentionRoleId=cleanId(body.mentionRoleId,null);
      if(typeof body.useEmbeds==="boolean")next.useEmbeds=body.useEmbeds;
      if(body.liveText!==undefined)next.liveText=normalizeAnnouncementText(body.liveText,"").slice(0,1800);
      if(body.clipText!==undefined)next.clipText=normalizeAnnouncementText(body.clipText,"").slice(0,1800);
      if(!next.liveChannelId||!next.clipsChannelId)throw new Error("Twitch- und Clip-Zielkanal müssen ausgewählt sein.");
      if(!next.liveText||!next.clipText)throw new Error("Ankündigungstexte dürfen nicht leer sein.");
      announcementsConfig=next;saveAnnouncementsConfig();
      res.statusCode=200;res.end(JSON.stringify(announcementView(),null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(req.url==="/announcements/ingest"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req);
      // 9.8.0: Modul „Discord-Ankündigungen“ aus → annehmen, aber nicht posten (Warteschlange im Twitch-Bot leert sich).
      if(!moduleState.isOn("discordAnnouncements")){res.statusCode=200;res.end(JSON.stringify({ok:true,status:"module_disabled"}));return;}
      const result=await ingestAnnouncement(String(body.type||""),String(body.key||""),body.payload||{});
      res.statusCode=200;res.end(JSON.stringify(result,null,2));
    }catch(err){
      announcementsState.lastError=err.message;saveAnnouncementsState();
      res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));
    }
    return;
  }
  if(req.url==="/announcements/test"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req);
      const type=String(body.type||"live");
      const payload=type==="live"
        ? {broadcasterName:textPackKit.get(installationTextPack).test.channelName,title:"Teststream",gameName:"Just Chatting",url:`https://www.twitch.tv/${textPackKit.get(installationTextPack).test.channelLogin}`}
        : {clipId:"TEST",title:"Testclip",creator:textPackKit.get(installationTextPack).test.channelName,url:`https://www.twitch.tv/${textPackKit.get(installationTextPack).test.channelLogin}`};
      const result=await ingestAnnouncement(type,`test-${Date.now()}`,payload,{test:true});
      res.statusCode=200;res.end(JSON.stringify(result,null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }

  if(requestUrl.pathname==="/reports"&&req.method==="GET"){
    try{
      const query={status:requestUrl.searchParams.get("status"),search:requestUrl.searchParams.get("search"),page:requestUrl.searchParams.get("page"),pageSize:requestUrl.searchParams.get("pageSize")};
      res.statusCode=200;res.end(JSON.stringify(reportsView(query),null,2));
    }catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/reports/config"&&req.method==="PUT"){
    try{
      const body=await readRequestJson(req),previous=reportsConfig;
      reportsConfig=normalizeReportsConfig({...reportsConfig,...body,buttonMessageId:previous.buttonMessageId,buttonMessageChannelId:previous.buttonMessageChannelId});
      if(!reportsConfig.logChannelId||!reportsConfig.buttonChannelId)throw new Error("Logkanal und Button-Kanal müssen ausgewählt sein.");
      saveReportsConfig();res.statusCode=200;res.end(JSON.stringify(reportsView({status:"open"}),null,2));
    }catch(err){reportsConfig=normalizeReportsConfig(readJsonFile(REPORTS_CONFIG_FILE,DEFAULT_REPORTS_CONFIG));res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/reports/button/publish"&&req.method==="POST"){
    try{
      const msg=await publishReportButton();res.statusCode=200;res.end(JSON.stringify({ok:true,messageId:msg.id,channelId:reportsConfig.buttonChannelId},null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/reports/action"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req),ticket=await handleReportAction(body);
      res.statusCode=200;res.end(JSON.stringify({ok:true,ticket},null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/reports/attachment"&&req.method==="GET"){
    try{
      const ticketId=String(requestUrl.searchParams.get("ticketId")||""),file=path.basename(String(requestUrl.searchParams.get("file")||""));
      if(!/^D-\d{4}-\d{4,}$/.test(ticketId)||!file)throw new Error("Ungültige Attachment-Anfrage.");
      const ticket=reportTicketById(ticketId),att=ticket?.source?.attachments?.find(a=>a.localFile===file&&a.archived);
      if(!ticket||!att)throw new Error("Attachment nicht gefunden.");
      const full=path.join(REPORT_ATTACHMENTS_DIR,ticketId,file);
      if(!fs.existsSync(full))throw new Error("Archivdatei fehlt.");
      res.statusCode=200;res.setHeader("Content-Type",att.contentType||"application/octet-stream");res.setHeader("Cache-Control","private, max-age=300");
      res.setHeader("Content-Length",String(fs.statSync(full).size));fs.createReadStream(full).pipe(res);
    }catch(err){res.statusCode=404;res.end(JSON.stringify({ok:false,error:err.message}));}
    return;
  }

  if(requestUrl.pathname==="/moderation"&&req.method==="GET"){try{res.statusCode=200;res.end(JSON.stringify(moderationView(),null,2));}catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;}
  // 9.6.0: Modul „Discord-Moderation“ aus → Einstellungen bleiben unverändert.
  if(requestUrl.pathname==="/moderation/config"&&req.method==="PUT"&&!moduleState.isOn("discordModeration")){res.statusCode=409;res.end(JSON.stringify({ok:false,error:"Modul „Discord-Moderation“ ist ausgeschaltet."}));return;}
  if(requestUrl.pathname==="/moderation/config"&&req.method==="PUT"){
    try{
      const body=await readRequestJson(req);
      moderationConfig={enabled:body.enabled===true,logEnabled:body.logEnabled!==false,logChannelId:cleanId(body.logChannelId,IDS.channels.log),warningText:String(body.warningText||DEFAULT_MODERATION_CONFIG.warningText).slice(0,1200),enforcement:normalizeEnforcement(body.enforcement||{}),escalation:normalizeEscalation(body.escalation||{}),moderationLog:normalizeModerationLog(body.moderationLog||{}),spamProtect:normalizeSpamProtectConfig(body.spamProtect||{}),linkPolicy:normalizeLinkPolicy(body.linkPolicy||{}),rules:Array.isArray(body.rules)?body.rules.map(normalizeModerationRule).slice(0,100):[]};
      if(!moderationConfig.logChannelId)throw new Error("Ein Logkanal muss ausgewählt sein.");
      if(moderationConfig.enabled&&!moderationChecks().manageMessages)throw new Error("Dem Bot fehlt die Berechtigung Nachrichten verwalten.");
      if(moderationConfig.enabled&&moderationConfig.spamProtect?.enabled&&(moderationConfig.spamProtect.action?.timeoutMinutes||[]).some(x=>Number(x)>0)&&!moderationChecks().moderateMembers)throw new Error("Spam-Schutz mit Timeout benötigt die Discord-Berechtigung Mitglieder moderieren.");
      saveModerationConfig();res.statusCode=200;res.end(JSON.stringify(moderationView(),null,2));
    }catch(err){moderationConfig=loadModerationConfig();res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;
  }
  if(requestUrl.pathname==="/moderation/test"&&req.method==="POST"){try{const body=await readRequestJson(req);res.statusCode=200;res.end(JSON.stringify(testModeration(body.content,body.channelId,body.roleIds),null,2));}catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}return;}
  if(requestUrl.pathname==="/moderation/member-history"&&req.method==="GET"){
    try{
      const userId=String(requestUrl.searchParams.get("userId")||"").trim();
      if(!/^\d{16,22}$/.test(userId)){res.statusCode=400;res.end(JSON.stringify({ok:false,error:"Ungültige Discord-ID."}));return;}
      // Nur die Ereignisse des angefragten Mitglieds aggregieren; keine gesamte Nutzerhistorie aufbauen.
      const events=readModerationLog(2000).filter(entry=>String(entry.userId||"")===userId).slice(0,30).map(entry=>({
        ts:entry.ts||null,eventType:entry.eventType||"violation",ruleName:entry.ruleName||entry.ruleId||null,
        timeoutStage:entry.timeoutStage||null,actions:Array.isArray(entry.actions)?entry.actions:[]
      }));
      let activeTimeoutUntil=null, timeoutStatusAvailable=true;
      try{const member=await discordApi(`/guilds/${IDS.guild}/members/${userId}`);const until=member?.communication_disabled_until;activeTimeoutUntil=until&&Date.parse(until)>Date.now()?until:null;}
      catch(err){timeoutStatusAvailable=false;}
      const state=moderationState.users?.[userId]||{};
      res.statusCode=200;res.end(JSON.stringify({ok:true,userId,events,activeTimeoutUntil,timeoutStatusAvailable,timeoutStage:Number(state.timeoutStage||0),timeoutCount:Number(state.timeoutCount||0),currentViolations:currentViolationCount(userId)},null,2));
    }catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/moderation/history"&&req.method==="GET"){
    try{
      const query=requestUrl.searchParams.get("query")||"";
      res.statusCode=200;res.end(JSON.stringify(moderationUserHistory(query),null,2));
    }catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/moderation/logs"&&req.method==="GET"){const limit=Math.max(1,Math.min(200,Number(requestUrl.searchParams.get("limit")||50)));res.statusCode=200;res.end(JSON.stringify({ok:true,items:readModerationLog(limit),stats:moderationStats()},null,2));return;}
  if(requestUrl.pathname==="/moderation/stats"&&req.method==="GET"){res.statusCode=200;res.end(JSON.stringify({ok:true,...moderationStats()},null,2));return;}

  if(requestUrl.pathname==="/moderation/sanctions"&&req.method==="GET"){
    try{
      const [bans,warned]=await Promise.all([listGuildBans(),sanctionedUsers()]);
      res.statusCode=200;res.end(JSON.stringify({ok:true,warned,bans,checks:moderationChecks()},null,2));
    }catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/moderation/untimeout"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req),userId=cleanId(body.userId,null);
      if(!userId)throw new Error("Ungültige User-ID.");
      const result=await clearTimeoutMember(userId,body.actor||"Control Center",body.resetEscalation===true);
      res.statusCode=200;res.end(JSON.stringify(result,null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/moderation/unban"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req),userId=cleanId(body.userId,null);
      if(!userId)throw new Error("Ungültige User-ID.");
      await unbanMember(userId,body.actor||"Control Center");
      res.statusCode=200;res.end(JSON.stringify({ok:true,userId},null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(requestUrl.pathname==="/moderation/reset-user"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req),userId=cleanId(body.userId,null);
      if(!userId)throw new Error("Ungültige User-ID.");
      const user=resetModerationUser(userId);
      res.statusCode=200;res.end(JSON.stringify({ok:true,user},null,2));
    }catch(err){res.statusCode=Number(err?.status)||400;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }

  if(req.url==="/access/preview"&&req.method==="GET"){
    try{res.statusCode=200;res.end(JSON.stringify({ok:true,...accessPlanView()},null,2));}
    catch(err){res.statusCode=500;res.end(JSON.stringify({ok:false,error:err.message},null,2));}
    return;
  }
  if(req.url==="/access/apply"&&req.method==="POST"){
    try{
      const body=await readRequestJson(req);
      if(String(body.confirmation||"").trim()!=="BERECHTIGUNGEN")throw new Error('Zur Bestätigung exakt "BERECHTIGUNGEN" eingeben.');
      const result=await applyAccessPlan();
      res.statusCode=200;res.end(JSON.stringify({ok:true,...result},null,2));
    }catch(err){res.statusCode=400;res.end(JSON.stringify({ok:false,error:err.message,preview:accessPlanView()},null,2));}
    return;
  }

  if(req.url==="/onboarding"&&req.method==="GET"){try{res.statusCode=200;res.end(JSON.stringify(await onboardingView(),null,2));}catch(err){res.statusCode=502;res.end(JSON.stringify({ok:false,error:err.message}));}return;}
  if(req.url==="/onboarding/config"&&req.method==="PUT"){
    try{
      const body=await readRequestJson(req); const previous={...onboardingConfig};
      const next={...onboardingConfig};
      if(body.welcomeChannelId!==undefined)next.welcomeChannelId=cleanId(body.welcomeChannelId,null);
      if(body.rulesChannelId!==undefined)next.rulesChannelId=cleanId(body.rulesChannelId,null);
      if(body.unlockRoleId!==undefined)next.unlockRoleId=cleanId(body.unlockRoleId,null);
      if(body.logChannelId!==undefined)next.logChannelId=cleanId(body.logChannelId,null);
      if(typeof body.logEnabled==="boolean")next.logEnabled=body.logEnabled;
      if(body.newMemberTimeoutMinutes!==undefined){
        const n=Number(body.newMemberTimeoutMinutes);
        if(!Number.isInteger(n)||n<0||n>1440)throw new Error("Der Timeout für neue Mitglieder muss eine ganze Zahl von 0 bis 1440 Minuten sein (0 = aus).");
        next.newMemberTimeoutMinutes=n;
      }
      if(body.welcomeMessage!==undefined){const v=String(body.welcomeMessage||"").trim();if(!v||v.length>1800)throw new Error("Willkommensnachricht muss 1–1800 Zeichen lang sein.");next.welcomeMessage=v;}
      if(body.rulesText!==undefined){const v=String(body.rulesText||"").trim();if(!v||v.length>2000)throw new Error("Regeltext muss 1–2000 Zeichen lang sein.");next.rulesText=v;}
      if(!next.welcomeChannelId||!next.rulesChannelId||!next.unlockRoleId||!next.logChannelId)throw new Error("Meldekopf, Regelkanal, Freischaltrolle und Logkanal müssen ausgewählt sein.");
      if(previous.rulesMessageId && next.rulesChannelId!==previous.rulesChannelId) throw new Error("Der Regelkanal kann nicht geändert werden, solange eine Regelnachricht verknüpft ist. Dadurch wird verhindert, dass unbeabsichtigt eine zweite Regelnachricht entsteht.");
      onboardingConfig=next;

      // V5.6.1: configuration and activation are deliberately separate operations.
      // This prevents a circular save/publish/enable flow and preserves the current
      // enabled state while texts or targets are edited.
      onboardingConfig.enabled = previous.enabled;
      onboardingConfig.activatedAt = previous.activatedAt;
      saveOnboardingConfig();
      log(`ℹ️ Reaktions-Freischaltung gespeichert (aktiv=${onboardingConfig.enabled}).`);
      res.statusCode=200;res.end(JSON.stringify(await onboardingView(),null,2));
    }catch(err){onboardingConfig=loadOnboardingConfig();res.statusCode=400;res.end(JSON.stringify({ok:false,error:err.message}));}
    return;
  }
  if(req.url==="/onboarding/activate"&&req.method==="POST"){
    try{
      const result=await activateOnboarding();
      res.statusCode=200;
      res.end(JSON.stringify({ok:true,...result},null,2));
    }catch(err){
      const checks=err.checks||onboardingChecks();
      res.statusCode=400;
      res.end(JSON.stringify({ok:false,error:err.message,checks},null,2));
    }
    return;
  }
  if(req.url==="/onboarding/deactivate"&&req.method==="POST"){
    try{
      const result=await deactivateOnboarding();
      res.statusCode=200;
      res.end(JSON.stringify({ok:true,...result},null,2));
    }catch(err){
      res.statusCode=400;
      res.end(JSON.stringify({ok:false,error:err.message,checks:onboardingChecks()},null,2));
    }
    return;
  }

  if(req.url==="/onboarding/test"&&req.method==="POST"){
    try{const fake={user:{id:state.bot.id||"0",username:"Test-"+RT("member"),global_name:"Test-"+RT("member")},nick:null};const preview=renderWelcomeMessage(onboardingConfig.welcomeMessage,fake).replaceAll(`<@${fake.user.id}>`,"@Test-"+RT("member"));await sendChannelMessage(onboardingConfig.welcomeChannelId,`🧪 **Freischaltungs-Test**\n${preview}`,null);res.statusCode=200;res.end(JSON.stringify({ok:true}));}catch(err){res.statusCode=502;res.end(JSON.stringify({ok:false,error:err.message}));}return;
  }
  if(req.url==="/onboarding/rules/publish"&&req.method==="POST"){
    try{const msg=await publishRulesMessage();res.statusCode=200;res.end(JSON.stringify({ok:true,messageId:msg.id,onboarding:onboardingSummary(),checks:onboardingChecks()}));}catch(err){res.statusCode=400;res.end(JSON.stringify({ok:false,error:err.message}));}return;
  }
  if(req.url==="/onboarding/rules/update"&&req.method==="POST"){
    try{const msg=await updateRulesMessage();res.statusCode=200;res.end(JSON.stringify({ok:true,messageId:msg.id,onboarding:onboardingSummary(),checks:onboardingChecks()}));}catch(err){res.statusCode=400;res.end(JSON.stringify({ok:false,error:err.message}));}return;
  }
  res.statusCode=404;res.end(JSON.stringify({error:"Not found"}));
});

api.listen(SERVICE_PORT,"0.0.0.0",()=>{log(`🩺 Discord-Service Status-API bereit auf Port ${SERVICE_PORT}`);log("ℹ️ Keine Tokens oder Secrets werden über /status ausgegeben.");});
process.on("SIGTERM",()=>{log("🛑 SIGTERM empfangen. Discord-Dienst wird beendet.");clearHeartbeat();try{ws?.close(1000,"shutdown");}catch{}api.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();});
process.on("SIGINT",()=>{log("🛑 SIGINT empfangen. Discord-Dienst wird beendet.");clearHeartbeat();try{ws?.close(1000,"shutdown");}catch{}api.close(()=>process.exit(0));});
// 9.12.0: Der Dienst startet auch ohne Server-ID/Rollen (HTTP-Schnittstelle läuft) und wartet dann auf die Einrichtung
// in Profil & Branding; sobald alles vorliegt, wird der Gateway gestartet.
let gatewayStarted = false;
async function startDiscordService(){
  if(gatewayStarted)return;
  try{
    const missing=missingConfig();state.checks.config=missing;
    if(missing.length){warn("⏳ Discord-Dienst wartet auf Konfiguration. Fehlend:",missing.join(", "));return;}
    gatewayStarted=true;
    log("🚀 Discord-Dienst startet.");log(`ℹ️ Guild: ${IDS.guild}`);log(`ℹ️ Client-ID: ${process.env.DISCORD_CLIENT_ID}`);log(`🔐 Secret-Quellen: ${describeSecretSources(SECRET_SOURCES)}`);log(`ℹ️ Bot-Token konfiguriert: ${redact(process.env.DISCORD_BOT_TOKEN)}`);log(`ℹ️ Client-Secret konfiguriert: ${redact(process.env.DISCORD_CLIENT_SECRET)}`);
    await connectGateway();
  }catch(err){state.gateway.lastError=err.message;fail("❌ Discord-Dienst Startfehler:",err.message);scheduleReconnect();}
}
startDiscordService();
