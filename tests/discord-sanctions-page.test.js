const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(root,"public","app.js"),"utf8");
const html=fs.readFileSync(path.join(root,"public","index.html"),"utf8");
function ok(cond,msg){if(!cond)throw new Error(msg);}
ok(html.includes('id="discordSanctions"'),"Eigener discordSanctions-Pane fehlt.");
ok(app.includes('tab:"discordSanctions",label:"Sanktionsübersicht"'),"Navigation zur Sanktionsübersicht fehlt.");
ok(app.includes('async function renderDiscordSanctions()'),"Renderer der Sanktionsübersicht fehlt.");
ok(app.includes('data-sanctions-filter="timeout"'),"Timeout-Filter fehlt.");
ok(app.includes('data-sanctions-filter="banned"'),"Ban-Filter fehlt.");
ok(app.includes('data-sanctions-filter="spam"'),"Spam-Filter fehlt.");
ok(!app.includes('<h3>Sanktionsübersicht</h3><p class="hint">Verstoßzähler, ausgesprochene Timeouts und Bans.</p>'),"Alte eingebettete Sanktionsübersicht ist noch vorhanden.");
console.log("discord-sanctions-page.test.js: OK");
