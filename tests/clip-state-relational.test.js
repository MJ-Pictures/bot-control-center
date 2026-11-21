const appSource=require("./helpers/app-source");
"use strict";
const fs=require("fs");
const path=require("path");
const pg=fs.readFileSync(path.join(__dirname,"../shared/pg-sync-store.js"),"utf8");
const server=appSource();
const app=fs.readFileSync(path.join(__dirname,"../public/app.js"),"utf8");
function ok(c,m){if(!c)throw new Error(m);}
ok(pg.includes("const SCHEMA_VERSION = 17"),"Schema 17 fehlt");
ok(pg.includes("CREATE TABLE IF NOT EXISTS twitch_clip_meta"),"Clip-Meta-Tabelle fehlt");
ok(pg.includes("CREATE TABLE IF NOT EXISTS twitch_clips"),"Clip-Tabelle fehlt");
ok(pg.includes("PRIMARY KEY(namespace,clip_id)"),"eindeutiger Clip-Key fehlt");
ok(pg.includes("relational-twitch-clip-state"),"Migration 12 fehlt");
ok(pg.includes('case "clip_reserve"'),"atomare Clip-Reservierung fehlt");
ok(server.includes("importClipStateIfEmpty"),"Legacy-Import fehlt");
ok(server.includes("pgStore.reserveClip(clip)"),"relationale Deduplizierung fehlt");
ok(server.includes("pgStore.replaceClipState(restoredClipState)"),"Restore fehlt");
ok(app.includes("Clip-Revision"),"DB-Diagnose fehlt");
console.log("clip-state-relational.test.js: OK");
