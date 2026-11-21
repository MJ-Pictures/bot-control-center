const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
test('Administration enthält alle ursprünglichen Funktionsziele',()=>{
  const admin=app.match(/admin:\{label:"Administration".*?\}\},?/s)?.[0] || app.slice(app.indexOf('admin:{label:"Administration"'),app.indexOf('help:{label:'));
  for(const tab of ['users','loginlogs','discordLogsAdmin','connections','publicWebsites','system','database','backup'])assert.match(admin,new RegExp('tab:"'+tab+'"'));
});
test('Administration zeigt nur berechtigte Gruppen und drei Überschriften',()=>{
  for(const name of ['Benutzer & Sicherheit','Integrationen','System'])assert.ok(app.includes('adminSection:"'+name+'"'));
  assert.ok(app.includes('const matches=items.filter(item=>item.adminSection===section)'));
  assert.ok(app.includes('if(activeNavGroup==="admin")'));
});
