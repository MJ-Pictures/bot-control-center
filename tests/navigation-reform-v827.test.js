const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const s=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
test('neue Discord-Einstiegswege enthalten alle kritischen Ziel-Tabs',()=>{for(const key of ['discordMembersGroup','discordCommunication','discordServer','discordSecurity'])assert.match(s,new RegExp(key+':\{'));for(const tab of ['discordMembers','discordWelcome','discordAnnouncements','discordReports','discordEmergency'])assert.match(s,new RegExp('tab:"'+tab+'"'));});
test('Favoriten und Suche nutzen weiterhin gemeinsame Navigation',()=>{assert.match(s,/function favoriteTarget\(/);assert.match(s,/function globalSearchIndex\(/);assert.match(s,/for\(const group of PLATFORM_NAV\[platform\]/);});
