const appSource=require("./helpers/app-source");
"use strict";
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
const db=fs.readFileSync(path.join(root,'shared/pg-sync-store.js'),'utf8');
const server=appSource();
test('Asynchroner Workerpfad erfordert keine Atomics.wait-Sperre',()=>{
 const body=db.slice(db.indexOf('  callAsync(op,args={}){'),db.indexOf('  messageCountLeaderboardAsync('));
 assert.match(body,/new MessageChannel\(\)/);assert.match(body,/setTimeout\(/);
 assert.doesNotMatch(body,/Atomics\.wait\(/);assert.match(body,/replyPort:port2/);
});
test('Worker sendet asynchrone Erfolge und Fehler getrennt vom SAB-Pfad',()=>{
 assert.match(db,/if\(replyPort\)\{replyPort\.postMessage\(\{ok:true,result\}\)/);
 assert.match(db,/if\(replyPort\)\{replyPort\.postMessage\(\{ok:false,error:/);
});
test('Top-Chatters-API blockiert nicht mehr synchron',()=>{
 const section=server.split('u.pathname === "/api/twitch/chat-leaderboard"')[1].split('u.pathname === "/api/followers"')[0];
 assert.match(section,/await pgStore\.messageCountLeaderboardAsync\(/);
 assert.match(section,/await pgStore\.messageCountMetaAsync\(/);
 assert.doesNotMatch(section,/pgStore\.messageCountLeaderboard\(/);
});
