const appSource=require("./helpers/app-source");
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('daily buckets use same atomic batch and retry id',()=>{const s=read('shared/pg-sync-store.js');assert.match(s,/CREATE TABLE IF NOT EXISTS twitch_message_count_daily/);assert.match(s,/ON CONFLICT\(namespace,channel_id,twitch_user_id,day\)/);assert.match(s,/case "message_count_leaderboard"/);assert.match(s,/message_count_batches/);});
test('day is timezone-aware and separated from lifetime counting',()=>{const s=appSource();assert.match(s,/timeZone:"Europe\/Berlin"/);assert.match(s,/messageCountPending\.set\(key,cur\)/);assert.match(s,/api\/twitch\/chat-leaderboard/);});
test('leaderboard enforces read permission and includes non followers',()=>{const s=appSource(),p=read('shared/pg-sync-store.js');assert.match(s,/requireCapability\(req,res,"twitch.followage.view"\)/);assert.match(p,/EXISTS\(SELECT 1 FROM twitch_followers/);});
test('community navigation exposes leaderboard',()=>{const s=read('public/app.js');assert.match(s,/tab:"chatters"/);assert.match(s,/renderChatLeaderboard/);assert.match(read('public/index.html'),/id="chatters"/);});
