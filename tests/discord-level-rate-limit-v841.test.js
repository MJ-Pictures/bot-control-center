const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'../discord-app/discord-server.js'),'utf8');
test('Konfigurationsspeichern löst keinen Slash-Command-Massenabgleich aus',()=>{assert.match(server,/const wasEnabled=levelEngine\.config\.enabled;const config=levelEngine\.configure\(body\)/);assert.match(server,/config\.enabled&&!wasEnabled/);assert.doesNotMatch(server,/if\(config\.enabled\)await ensureLevelCommands\(\)/);});
test('Unveränderte Slash-Befehle werden übersprungen',()=>{assert.match(server,/if\(same\)continue/);assert.match(server,/found\.description===command\.description/);});
test('Discord HTTP 429 berücksichtigt Retry-Zeit mit begrenzten Versuchen',()=>{assert.match(server,/response\.status===429 && attempt<3/);assert.match(server,/body\?\.retry_after/);assert.match(server,/attempt<4/);});
