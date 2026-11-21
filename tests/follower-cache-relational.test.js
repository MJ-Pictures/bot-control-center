const appSource=require("./helpers/app-source");
"use strict";
const fs=require("fs");
const path=require("path");
const pg=fs.readFileSync(path.join(__dirname,"../shared/pg-sync-store.js"),"utf8");
const server=appSource();
const app=fs.readFileSync(path.join(__dirname,"../public/app.js"),"utf8");
function ok(c,m){if(!c)throw new Error(m);}
ok(pg.includes("const SCHEMA_VERSION = 17"),"Schema 17 fehlt");
ok(pg.includes("CREATE TABLE IF NOT EXISTS twitch_followers"),"Follower-Tabelle fehlt");
ok(pg.includes("relational-twitch-follower-cache"),"Migration 11 fehlt");
ok(pg.includes("follower_cache_replace"),"atomarer Replace fehlt");
ok(pg.includes("PRIMARY KEY(namespace,twitch_user_id)"),"eindeutiger Follower-Key fehlt");
ok(server.includes("importFollowerCacheIfEmpty"),"Legacy-Import fehlt");
ok(server.includes("queryFollowerCache"),"relationale Pagination fehlt");
ok(server.includes("pgStore.exportFollowerCache()"),"Rollback-Export fehlt");
ok(app.includes("Follower-Revision"),"DB-Diagnose fehlt");
console.log("follower-cache-relational.test.js: OK");
