const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
test('Spielerverwaltung bietet berechtigungsgebunden den gemeinsamen Profil-Einstieg',()=>{
  assert.match(app,/hasCapability\('discord\.members\.view'\)\?`<button class="secondary" data-member-profile=/);
  assert.match(app,/openDiscordMemberFromMinigame\(btn\.dataset\.memberProfile\)/);
});
test('Profil-Einstieg verwendet bestehenden Mitgliederbereich und Minigame-Profilreiter',()=>{
  assert.match(app,/async function openDiscordMemberFromMinigame\(userId\)/);
  assert.match(app,/discordMemberProfileTab='minigame';/);
  assert.match(app,/await openNavTab\('discordMembers',\{persist:true\}\)/);
  assert.match(app,/if\(discordSelectedMemberId\)showDiscordMemberProfile\(discordSelectedMemberId,discordMemberProfileTab\)/);
});
