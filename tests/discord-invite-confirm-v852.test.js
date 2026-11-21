'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
test('Invite-Erstellung verwendet themenfähige interne Bestätigung',()=>{
 const start=js.indexOf('$("inviteCreate")?.addEventListener("click",async()=>{');
 assert.ok(start>=0,'Invite-Handler vorhanden');
 const handler=[null,js.slice(start,start+500)];
 assert.ok(handler,'Invite-Handler vorhanden');
 assert.match(handler[1],/await askConfirm\(/);
 assert.match(handler[1],/if\(!confirmed\)return;/);
 assert.match(handler[1],/confirm:true/);
 assert.doesNotMatch(handler[1],/window\.confirm/);
});
test('Vorhandener Modal mit Abbrechen und Bestätigen bleibt vorhanden',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 for(const id of ['confirmModal','confirmYes','confirmNo','confirmText'])assert.match(html,new RegExp('id="'+id+'"'));
});
