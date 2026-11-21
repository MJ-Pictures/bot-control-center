"use strict";
// Gemeinsames Fundament des Control Centers (Entkopplung Schritt 3b, 8.9.21).
// Alles, was sowohl die Weboberfläche als auch der Twitch-Bot brauchen und was keinen eigenen
// Laufzeitzustand der einen oder anderen Seite hat: Konfiguration aus der Umgebung, Dateipfade,
// Standard-Einstellungen, Datenbankzugang, Lesen/Schreiben der Dokumente, Audit, zentraler Wortfilter,
// App-Zugang zu Twitch und der Aufruf des Discord-Dienstes.
// Jeder Prozess erzeugt genau ein Fundament über createCore(). Secrets aus Dateien müssen vorher
// in die Umgebung übernommen sein (applySecretFiles im jeweiligen Startprogramm).
// Der Inhalt wurde unverändert aus app/server.js übernommen; deshalb ist er nicht eingerückt.
const fs = require("fs");
const path = require("path");

function createCore() {

const { createGiveawayStore } = require("/shared/giveaway-store");

const { createPgSyncStore, readLegacyJson, readLegacyJsonl } = require("/shared/pg-sync-store");

const { compile: compileWordFilter, match: matchWordFilter, safeRegex: validateWordFilterRegex, diagnoseCandidate: diagnoseWordFilterCandidate, diagnose: diagnoseWordFilter } = require("/shared/word-filter-engine");

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;

const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

const CHANNEL_LOGIN = (process.env.TWITCH_CHANNEL_LOGIN || "").toLowerCase();

const INTERNAL_SERVICE_SECRET = String(process.env.INTERNAL_SERVICE_SECRET || "");

// 8.9.19: geprüfte interne Adresse (nur http/https, ohne Zugangsdaten und Pfad); Standard wie bisher.
const {internalBaseUrl,serviceLabel} = require("/shared/internal-url");

const DISCORD_SERVICE_URL = internalBaseUrl(process.env.DISCORD_SERVICE_URL,"http://discord:3001",{name:"DISCORD_SERVICE_URL",warn:m=>console.warn("⚠️ "+m)});

const DATA_DIR = "/data";

const FILES = {
  settings: path.join(DATA_DIR, "settings.json"),
  sessions: path.join(DATA_DIR, "sessions.json"),
  users: path.join(DATA_DIR, "users.json"),
  giveaways: path.join(DATA_DIR, "giveaways.json"),
  clipState: path.join(DATA_DIR, "clip-state.json"),
  watchtime: path.join(DATA_DIR, "watchtime.json"),
  usageStats: path.join(DATA_DIR, "usage-stats.json"),
  eventProfiles: path.join(DATA_DIR, "event-profiles.json"),
  followerCache: path.join(DATA_DIR, "follower-cache.json"),
  stubenkontrolle: path.join(DATA_DIR, "stubenkontrolle.json"),
  discordBridge: path.join(DATA_DIR, "discord-bridge.json"),
  discordAnalytics: path.join(DATA_DIR, "discord-analytics.json"),
  authLog: path.join(DATA_DIR, "auth-log.jsonl"),
  audit: path.join(DATA_DIR, "audit.jsonl"),
  publicPages: path.join(DATA_DIR, "public-pages.json"),
  followathon: path.join(DATA_DIR, "followathon.json"),
  followerAlert: path.join(DATA_DIR, "follower-alert.json"),
  lurkReturn: path.join(DATA_DIR, "lurk-return.json"),
  bw: path.join(DATA_DIR, "bot-main-token.json"),
  helper: path.join(DATA_DIR, "hilfsausbilderbot-token.json"),
  giveaway: path.join(DATA_DIR, "bot-giveaway-token.json"),
  clips: path.join(DATA_DIR, "bot-clips-token.json"),
  live: path.join(DATA_DIR, "bot-live-token.json"),
  channel: path.join(DATA_DIR, "channel-token.json"),
  app: path.join(DATA_DIR, "app-access-token.json")
};

// 9.13.0: Standardtexte kommen aus dem Textpaket (neutral). Eine Bestandsinstallation behält ihre bisherigen Texte
// (Profil.textPack = "legacy-bwk"); sie sind über textPack.get(settings) abrufbar.
const textPack = require(require("path").join(__dirname, "text-pack")); // gleicher Ordner (/shared), auch ohne Einbindung unter /shared ladbar
const DEFAULT_SETTINGS = textPack.clone(textPack.NEUTRAL.defaultSettings);

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILES.settings)) fs.writeFileSync(FILES.settings, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  if (!fs.existsSync(FILES.sessions)) fs.writeFileSync(FILES.sessions, "{}");
  if (!fs.existsSync(FILES.users)) fs.writeFileSync(FILES.users, JSON.stringify({users:[]}, null, 2));
  if (!fs.existsSync(FILES.giveaways)) fs.writeFileSync(FILES.giveaways, JSON.stringify({current:null,history:[]}, null, 2));
  if (!fs.existsSync(FILES.clipState)) fs.writeFileSync(FILES.clipState, JSON.stringify({
    initialized:false,
    seen:{},
    lastCheckedAt:null,
    lastShared:null,
    lastError:null
  }, null, 2));
  if (!fs.existsSync(FILES.watchtime)) fs.writeFileSync(FILES.watchtime, JSON.stringify({
    users:{},
    updatedAt:null
  }, null, 2));
  if (!fs.existsSync(FILES.usageStats)) fs.writeFileSync(FILES.usageStats, JSON.stringify({
    commands:{},
    autoReplies:{},
    updatedAt:null
  }, null, 2));
  if (!fs.existsSync(FILES.eventProfiles)) fs.writeFileSync(FILES.eventProfiles, JSON.stringify({
    profiles:[],
    activeProfileId:null,
    updatedAt:null
  }, null, 2));
  if (!fs.existsSync(FILES.followerCache)) fs.writeFileSync(FILES.followerCache, JSON.stringify({
    items:[],
    total:0,
    updatedAt:null
  }, null, 2));
}

ensureFiles();

// PostgreSQL ist ab V7.2.0 der primäre Speicher für strukturierte Laufzeitdaten; ab V7.2.20 liegen auch Nutzungsstatistiken und Discord-Analytics relational.
// Token-/Secret-Dateien bleiben bewusst im geschützten /data-Dateisystem.
const pgStore = createPgSyncStore({namespace:"twitch",service:"twitch"});

let wordFilterCompiled={revision:0,terms:[],allow:[]};

let wordFilterCheckedAt=0;

let wordFilterCentralReady=false;

const wordFilterRepeatState=new Map();

function twitchWordFilterEscalation(userId,category){
  const key=`${userId||"unknown"}:${category||"default"}`,now=Date.now(),cutoff=now-60*60*1000;
  const rows=(wordFilterRepeatState.get(key)||[]).filter(ts=>ts>=cutoff);rows.push(now);wordFilterRepeatState.set(key,rows.slice(-20));
  if(rows.length<3)return 0;
  wordFilterRepeatState.set(key,[]);return Math.min(3,Math.floor(rows.length/3));
}

function wordFilterRefresh(force=false){
  if(!pgStore.enabled)return wordFilterCompiled;
  const now=Date.now();
  if(!force&&now-wordFilterCheckedAt<5000)return wordFilterCompiled;
  wordFilterCheckedAt=now;
  try{
    const rev=pgStore.wordFilterRevision();
    if(force||Number(rev.revision||0)!==Number(wordFilterCompiled.revision||0)){
      const snapshot=pgStore.wordFilterSnapshot();
      wordFilterCentralReady=!!((snapshot.terms||[]).length||(snapshot.imports||[]).some(x=>String(x.import_id||"").startsWith("legacy-")||String(x.source_name||"").length));
      wordFilterCompiled=compileWordFilter(snapshot);
    }
  }catch(e){console.error("⚠️ Wortfilter-Refresh fehlgeschlagen:",e.message);}
  return wordFilterCompiled;
}

function wordFilterAction(match,platform){
  const policy=(wordFilterCompiled.policies||[]).find(p=>p.category_id===match.term.category_id&&p.platform===platform)||{};
  const override=match.platformRule||{};
  return {action:override.action||policy.action||"log",timeoutSeconds:Number(override.timeout_seconds??policy.timeout_seconds??0),escalate:override.action?false:policy.escalate===true,messageTemplate:String(policy.message_template||"")};
}

const PG_DOCUMENT_FILES = new Map([
  [FILES.settings,"settings"],
  [FILES.sessions,"sessions"],
  [FILES.users,"users"],
  [FILES.giveaways,"giveaways"],
  [FILES.clipState,"clip-state"],
  [FILES.eventProfiles,"event-profiles"],
  [FILES.followerCache,"follower-cache"],
  [FILES.discordBridge,"discord-bridge"],
  [FILES.publicPages,"public-pages"],
  [FILES.followathon,"followathon"],
  [FILES.followerAlert,"follower-alert"]
]);

function pgDocKey(file){return PG_DOCUMENT_FILES.get(file)||null;}

const giveawayStore = createGiveawayStore({file:FILES.giveaways,storage:pgStore,storageKey:"giveaways"});

if(pgStore.enabled)giveawayStore.ensureRelational();

function readJson(file, fallback={}) {
  const key=pgDocKey(file);
  if(pgStore.enabled&&key){
    try{return pgStore.getDocument(key,fallback);}catch(e){console.error(`⚠️ PostgreSQL-Lesen ${key}:`,e.message);throw e;}
  }
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  const key=pgDocKey(file);
  if(pgStore.enabled&&key){pgStore.putDocument(key,value);return;}
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function audit(user, action, detail={}) {
  const entry={ ts: new Date().toISOString(), user, action, detail };
  if(pgStore.enabled){pgStore.appendEvent("audit",entry);return;}
  fs.appendFileSync(FILES.audit, JSON.stringify(entry) + "\n");
}

function appTokenStillValid(token) {
  if (!token?.access_token) return false;
  if (!token.expires_at) return false;
  // 5 Minuten Puffer
  return Date.now() < Number(token.expires_at) - 5 * 60 * 1000;
}

async function createAppAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("TWITCH_CLIENT_ID oder TWITCH_CLIENT_SECRET fehlt.");
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials"
  });

  const r = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
    method: "POST"
  });

  const j = await r.json();

  if (!r.ok) {
    throw new Error(`App Access Token fehlgeschlagen: ${r.status} ${JSON.stringify(j)}`);
  }

  const token = {
    ...j,
    created_at: Date.now(),
    expires_at: Date.now() + Number(j.expires_in || 0) * 1000
  };

  writeJson(FILES.app, token);
  console.log("✅ App Access Token erstellt/erneuert.");
  return token;
}

async function getAppAccessToken(force=false) {
  if (!force && fs.existsSync(FILES.app)) {
    const token = readJson(FILES.app, {});
    if (appTokenStillValid(token)) return token;
  }

  return createAppAccessToken();
}

async function twitchAppFetch(url, options={}) {
  let token = await getAppAccessToken();

  const doFetch = (t) => fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${t.access_token}`,
      "Client-Id": CLIENT_ID
    }
  });

  let r = await doFetch(token);

  if (r.status === 401) {
    token = await getAppAccessToken(true);
    r = await doFetch(token);
  }

  return r;
}

function internalServiceSecretReady(){return INTERNAL_SERVICE_SECRET.length>=32&&!/^HIER_|^CHANGE_ME/i.test(INTERNAL_SERVICE_SECRET);}

function internalServiceHeaders(extra={}){
  if(!internalServiceSecretReady())throw new Error("INTERNAL_SERVICE_SECRET fehlt, ist zu kurz oder enthält noch den Platzhalter.");
  return {"X-BWK-Service-Secret":INTERNAL_SERVICE_SECRET,...extra};
}

async function discordServiceRequest(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${DISCORD_SERVICE_URL}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...internalServiceHeaders(options.headers || {})
      }
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); }
      catch { body = {raw:text}; }
    }
    if (!response.ok && response.status !== 503) {
      const err=new Error(body?.error || body?.message || `Discord-Service HTTP ${response.status}`);
      err.status=response.status;err.body=body;
      throw err;
    }
    return {status:response.status, body};
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Discord-Service antwortet nicht innerhalb von 5 Sekunden.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

  return {
    createGiveawayStore, createPgSyncStore, readLegacyJson, readLegacyJsonl, compileWordFilter, matchWordFilter, validateWordFilterRegex, diagnoseWordFilterCandidate, diagnoseWordFilter, CLIENT_ID, CLIENT_SECRET, CHANNEL_LOGIN, INTERNAL_SERVICE_SECRET, internalBaseUrl, serviceLabel, DISCORD_SERVICE_URL, DATA_DIR, FILES, DEFAULT_SETTINGS, ensureFiles, pgStore, twitchWordFilterEscalation, wordFilterRefresh, wordFilterAction, PG_DOCUMENT_FILES, pgDocKey, giveawayStore, readJson, writeJson, audit, appTokenStillValid, createAppAccessToken, getAppAccessToken, twitchAppFetch, internalServiceSecretReady, internalServiceHeaders, discordServiceRequest,
    // Zustand des Wortfilters bleibt hier gekapselt; nach außen nur als Abfrage.
    wordFilterCentralReady: () => wordFilterCentralReady
  };
}

module.exports = { createCore };
