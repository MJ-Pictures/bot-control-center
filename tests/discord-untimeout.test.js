const appSource=require("./helpers/app-source");
const fs=require('fs');
const server=fs.readFileSync('discord-app/discord-server.js','utf8');
const app=appSource();
const ui=fs.readFileSync('public/app.js','utf8');
function ok(x,m){if(!x)throw new Error(m);}
ok(server.includes('communication_disabled_until:null'),'Discord timeout is not cleared with null.');
ok(server.includes('Date.now()-5000'),'Timeout fallback timestamp missing.');
ok(server.includes('Discord meldet den Timeout weiterhin als aktiv'),'Post-action timeout verification missing.');
ok(server.includes('/moderation/untimeout'),'Discord service route missing.');
ok(server.includes('moderation.untimeout'),'Discord timeout removal log event missing.');
ok(app.includes('/api/discord/moderation/untimeout'),'Control Center API route missing.');
ok(app.includes('discord.moderation.edit'),'Server-side moderation capability missing.');
ok(ui.includes('Timeout aufheben'),'Timeout UI action missing.');
ok(ui.includes('Timeout + Eskalation zurücksetzen'),'Combined timeout/reset action missing.');
ok(ui.includes('activeTimeoutUntil'),'Active Discord timeout status missing.');
ok(ui.includes('j.error||j.message||`Timeout konnte nicht aufgehoben werden (HTTP ${x.status}).`'),'Detailed frontend timeout error missing.');
console.log('discord-untimeout.test.js: OK');
