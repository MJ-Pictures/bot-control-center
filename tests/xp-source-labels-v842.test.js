const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
test('Daily- und Einsatz-XP haben explizite Bezeichnungen im Buchungsverlauf',()=>{
 const labels=app.match(/const labels=\{chat:'Chatnachricht'[^\n]+/);
 assert.ok(labels);assert.match(labels[0],/daily:`\$\{lv\('dailyTitle'\)\} \(\/dailyxp\)`/);assert.match(labels[0],/mission:`\$\{lv\('missionSingular'\)\}-Belohnung \(\/\$\{lv\('missionCmd'\)\}\)`/);
});
test('Daily- und Einsatz-XP haben explizite Bezeichnungen in der Ranghistorie',()=>{
 const labels=app.match(/const sources=\{chat:'Chatnachricht'[^\n]+/);
 assert.ok(labels);assert.match(labels[0],/daily:`\$\{lv\('dailyTitle'\)\} \(\/dailyxp\)`/);assert.match(labels[0],/mission:`\$\{lv\('missionSingular'\)\}-Belohnung \(\/\$\{lv\('missionCmd'\)\}\)`/);
});
