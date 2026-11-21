const appSource=require("./helpers/app-source");
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {applySecretFiles,describeSecretSources,CONTROL_CENTER_SECRETS,DISCORD_SECRETS}=require('../shared/secret-env');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bwk-secret-'));
const write=(name,content)=>{const p=path.join(dir,name);fs.writeFileSync(p,content);return p;};

test('Datei wird gelesen, Zeilenumbruch am Ende entfernt',()=>{
  const env={X_FILE:write('a','geheim-123\n')};
  const r=applySecretFiles(['X'],{env});
  assert.equal(env.X,'geheim-123');assert.equal(r.X,'datei');
});
test('Windows-Zeilenende und BOM werden entfernt, innere Zeichen bleiben',()=>{
  const env={X_FILE:write('b','﻿ab c\r\n')};
  applySecretFiles(['X'],{env});
  assert.equal(env.X,'ab c');
});
test('Datei hat Vorrang vor der Umgebungsvariable',()=>{
  const env={X:'alt',X_FILE:write('c','neu')};
  const r=applySecretFiles(['X'],{env});
  assert.equal(env.X,'neu');assert.equal(r.X,'datei');
});
test('ohne _FILE bleibt die Umgebungsvariable unverändert (Rückfall)',()=>{
  const env={X:'aus-env'};
  const r=applySecretFiles(['X','Y'],{env});
  assert.equal(env.X,'aus-env');assert.equal(r.X,'umgebung');assert.equal(r.Y,'fehlt');assert.equal('Y' in env,false);
});
test('nicht lesbare Datei: Umgebungsvariable bleibt, Fehler wird ohne Wert gemeldet',()=>{
  const logs=[];
  const env={X:'aus-env',X_FILE:path.join(dir,'gibt-es-nicht')};
  const r=applySecretFiles(['X'],{env,log:m=>logs.push(m)});
  assert.equal(env.X,'aus-env');assert.equal(r.X,'datei-fehler');
  assert.equal(logs.length,1);assert.ok(!logs[0].includes('aus-env'));assert.match(logs[0],/ENOENT/);
});
test('leere Datei oder nur Leerraum wird nicht als Secret übernommen',()=>{
  for(const content of ['','\n','  \r\n']){
    const env={X_FILE:write('leer',content)};
    const r=applySecretFiles(['X'],{env,log:()=>{}});
    assert.equal(r.X,'datei-fehler');assert.equal('X' in env,false);
  }
});
test('zu große Datei wird abgelehnt',()=>{
  const env={X_FILE:write('gross','a'.repeat(16*1024+1))};
  const r=applySecretFiles(['X'],{env,log:()=>{}});
  assert.equal(r.X,'datei-fehler');assert.equal('X' in env,false);
});
test('Ergebnis und Beschreibung enthalten nie Secret-Werte',()=>{
  const env={X_FILE:write('d','TOP-SECRET-WERT'),Y:'ENV-SECRET-WERT'};
  const r=applySecretFiles(['X','Y'],{env});
  const text=JSON.stringify(r)+describeSecretSources(r);
  assert.ok(!text.includes('TOP-SECRET-WERT')&&!text.includes('ENV-SECRET-WERT'));
  assert.equal(describeSecretSources(r),'X=datei, Y=umgebung');
});
test('Namenslisten decken alle Secrets der Dienste ab',()=>{
  for(const n of ['TWITCH_CLIENT_SECRET','LOCAL_ADMIN_PASSWORD','INTERNAL_SERVICE_SECRET'])assert.ok(CONTROL_CENTER_SECRETS.includes(n),n);
  for(const n of ['DISCORD_BOT_TOKEN','DISCORD_CLIENT_SECRET','INTERNAL_SERVICE_SECRET'])assert.ok(DISCORD_SECRETS.includes(n),n);
});
test('beide Server laden die Secret-Dateien vor der ersten Verwendung',()=>{
  const cc=appSource();
  const dc=fs.readFileSync(path.join(__dirname,'..','discord-app','discord-server.js'),'utf8');
  assert.ok(cc.indexOf('applySecretFiles(CONTROL_CENTER_SECRETS')>0&&cc.indexOf('applySecretFiles(CONTROL_CENTER_SECRETS')<cc.indexOf('process.env.TWITCH_CLIENT_SECRET'));
  assert.ok(cc.indexOf('applySecretFiles(CONTROL_CENTER_SECRETS')<cc.indexOf('process.env.INTERNAL_SERVICE_SECRET'));
  assert.ok(dc.indexOf('applySecretFiles(DISCORD_SECRETS')>0&&dc.indexOf('applySecretFiles(DISCORD_SECRETS')<dc.indexOf('process.env.INTERNAL_SERVICE_SECRET'));
  assert.ok(dc.indexOf('applySecretFiles(DISCORD_SECRETS')<dc.indexOf('process.env.DISCORD_BOT_TOKEN'));
});
