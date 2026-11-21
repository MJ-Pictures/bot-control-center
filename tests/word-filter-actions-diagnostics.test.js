"use strict";
const fs=require("fs");
const engine=require("../shared/word-filter-engine");
function ok(c,m){if(!c)throw new Error(m);}
const snap={revision:1,terms:[{term_id:"a",term:"arsch",category_id:"beleidigungen",severity:2,detection_type:"whole_word",enabled:true,test_only:false,leetspeak:true,repeat_letters:false,flex_separators:false,umlauts:true,platforms:[{platform:"discord",enabled:true}]}],allowlist:[],policies:[]};
const c=engine.compile(snap);
ok(engine.match(c,"discord","4r$ch"),"Leetspeak 4r$ch nicht erkannt");
ok(engine.match(c,"discord","4r$ch!"),"Leetspeak mit Satzzeichen nicht erkannt");
const pg=fs.readFileSync(require.resolve("../shared/pg-sync-store"),"utf8");
ok(pg.includes("SCHEMA_VERSION = 17"),"Schema 17 fehlt");
ok(pg.includes("message_template"),"Policy-Nachrichtentemplate fehlt");
const discord=fs.readFileSync(require.resolve("../discord-app/discord-server"),"utf8");
ok(discord.includes("Moderator-Hinweis → #"),"Moderator-Ziel wird nicht protokolliert");
ok(discord.includes("recentModeratedMessageIds"),"Moderations-Deduplizierung fehlt");
const ui=fs.readFileSync(require.resolve("../public/app.js"),"utf8");
ok(ui.includes("Der Grad 1–5 ist nur die fachliche Schwere"),"Schweregrad-Erklärung fehlt");
ok(ui.includes("Hinweistext bei „Verwarnen“"),"Editierbarer Hinweistext fehlt");
console.log("word-filter-actions-diagnostics.test.js: OK");
