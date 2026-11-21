const fs=require('fs');
const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
function ok(x,m){if(!x)throw new Error(m);}
ok(html.includes('id="discordModerationLog"'),'Standalone moderation log pane missing.');
ok(app.includes('tab:"discordModerationLog",label:"Protokoll & Test"'),'Top-level security navigation missing moderation log page.');
ok(app.includes('async function renderDiscordModerationLog()'),'Standalone moderation log renderer missing.');
ok(!app.includes('data-mod-view="logtest"'),'Old nested Protokoll & Test subtab still present.');
ok(app.includes('discordModerationLogTestBtn'),'Dry-run action missing from standalone page.');
ok(app.includes('discordModerationLogRows'),'Moderation log list missing from standalone page.');
console.log('discord-moderation-log-page.test.js: OK');
