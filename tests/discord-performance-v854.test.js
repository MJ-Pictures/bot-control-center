const appSource=require("./helpers/app-source");
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const root=path.resolve(__dirname,'..');
test('Discord performance endpoint is internal-only',()=>{const s=fs.readFileSync(path.join(root,'discord-app/discord-server.js'),'utf8');assert.ok(s.indexOf('if(!serviceAuthValid(req))')<s.indexOf('requestUrl.pathname==="/performance"'));});
test('Discord metrics avoid chat/user contents',()=>{const s=fs.readFileSync(path.join(root,'discord-app/discord-server.js'),'utf8');const x=s.match(/function discordPerformanceSnapshot\(\)\{[^}]+\}/)?.[0];assert.ok(x);assert.ok(!/content|username|userId|token/.test(x));});
test('Discord moderation precedes XP and remains asynchronous',()=>{const s=fs.readFileSync(path.join(root,'discord-app/discord-server.js'),'utf8');assert.match(s,/await moderateMessage\(payload\.d\);if\(!wasRecentlyModerated\(payload\.d\?\.id\)\)/);});
test('Admin only performance endpoint aggregates Discord metrics',()=>{const s=appSource();assert.match(s,/requireGlobalAdmin\(req,res\)/);assert.match(s,/discordServiceRequest\("\/performance"\)/);});
