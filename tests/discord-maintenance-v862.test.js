const appSource=require("./helpers/app-source");
"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const discord=fs.readFileSync(path.join(root,'discord-app/discord-server.js'),'utf8');
const pg=fs.readFileSync(path.join(root,'shared/pg-sync-store.js'),'utf8');
const api=appSource();
const ui=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
test('Wartungsmodus benutzt unveränderte Discord-Rechte und persistierte Snapshots',()=>{
 assert.match(discord,/m\.snapshots\[key\]=snapshotOverwrite\(channel,roleId\)/);
 assert.match(discord,/saveChannelTimesState\(\); \/\/ durable rollback snapshot before the overwrite/);
 assert.match(discord,/await restoreRoleOverwrite\(channelId,roleId,snapshot\)/);
});
test('Wartungsdaten werden beim relationalen PostgreSQL-Speichern erhalten',()=>{
 assert.match(pg,/maintenance:x\.maintenance&&typeof x\.maintenance/);
 assert.match(pg,/maintenance:meta\.rows\[0\]\.warning_state\?\.maintenance/);
 assert.match(pg,/JSON\.stringify\(\{notices:state\.warningNotices\|\|\{\},maintenance:state\.maintenance\|\|\{\}\}\)/);
});
test('Neustart gleicht Wartungssperre vor den Kanalzeiten ab',()=>{
 assert.match(discord,/channelTimesState\.maintenance\?\.active\?reconcileMaintenance\(\):reconcileChannelTimes/);
 assert.match(discord,/if\(emergencyState\.active\|\|channelTimesState\.maintenance\?\.active\)return/);
 assert.match(discord,/Während der Wartung dürfen Kanalzeiten nicht manuell geöffnet werden/);
});
test('API wird durch die bestehenden Edit-Capabilities geschützt',()=>{
 assert.match(api,/"\/api\/discord\/channel-times\/maintenance"/);
 assert.match(api,/requireCapability\(req,res,"discord\.channel-times\.edit"\)/);
});
test('Sperr- und Entsperrtext sind im Kanalzeitenmenü editierbar',()=>{
 assert.match(ui,/id="maintenanceLockText"/);
 assert.match(ui,/id="maintenanceUnlockText"/);
 assert.match(ui,/id="maintenanceToggle"/);
});
