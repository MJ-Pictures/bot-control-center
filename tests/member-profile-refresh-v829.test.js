const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'..','public','app.js'),'utf8');
test('central profile refresh uses shared data loader',()=>{
 assert.match(code,/async function refreshDiscordMemberProfile\(memberId,section\)/);
 assert.match(code,/await renderDiscordMembers\(query\)/);
 assert.match(code,/id="refreshDiscordProfile"/);
 assert.match(code,/await refreshDiscordMemberProfile\(member\.id,'minigame'\)/);
});
