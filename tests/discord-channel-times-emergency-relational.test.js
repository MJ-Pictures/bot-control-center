"use strict";
const fs=require("fs");
function assert(x,m){if(!x)throw new Error(m);}
const pg=fs.readFileSync("shared/pg-sync-store.js","utf8");
const ds=fs.readFileSync("discord-app/discord-server.js","utf8");
assert(pg.includes("const SCHEMA_VERSION = 17;"),"Schema-Version 17 fehlt");
for(const table of ["discord_channel_times_meta","discord_channel_times_active","discord_channel_times_overrides","discord_channel_times_events","discord_emergency_meta","discord_emergency_snapshots","discord_emergency_history"])assert(pg.includes(table),`Tabelle ${table} fehlt`);
for(const method of ["getDiscordChannelTimesState","putDiscordChannelTimesState","getDiscordEmergencyState","putDiscordEmergencyState"])assert(pg.includes(method),`Store-Methode ${method} fehlt`);
assert(ds.includes("importDiscordChannelTimesStateIfEmpty"),"Kanalzeiten-Legacyimport fehlt");
assert(ds.includes("importDiscordEmergencyStateIfEmpty"),"Notfall-Legacyimport fehlt");
assert(ds.includes("putDiscordChannelTimesState(channelTimesState,channelTimesStateRevision)"),"Kanalzeiten schreiben nicht relational");
assert(ds.includes("putDiscordEmergencyState(emergencyState,emergencyStateRevision)"),"Notfallmodus schreibt nicht relational");
console.log("discord-channel-times-emergency-relational.test.js: OK");
