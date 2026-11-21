// 9.15.1: Discord-Schritt der Ersteinrichtung, Speicherort im Login-Protokoll
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const installationKit=require("../shared/installation-profile");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
test("Ersteinrichtung: optionaler Discord-Schritt, Punktespiel wird Schritt 6",()=>{
  const ui=read("public/app.js"),web=read("app/server.js");
  assert.match(ui,/5 · Discord \(optional\)/);assert.match(ui,/6 · Punktespiel/);
  assert.match(ui,/discordGuildId:\$\("setupDiscordGuild"\)\.value/);
  assert.match(web,/if\(String\(body\?\.discordGuildId\|\|""\)\.trim\(\)\)input\.discord=\{guildId:body\.discordGuildId\}/);
  assert.match(web,/discord:\{guildId:installationProfile\(\)\.discord\?\.guildId\|\|""\}/);
});
test("Discord-Server-ID: leer erlaubt, ungültig abgelehnt, gültig übernommen",()=>{
  assert.equal(installationKit.validateDiscord({guildId:""}).errors.length,0);
  assert.ok(installationKit.validateDiscord({guildId:"abc"}).errors.length>0);
  assert.equal(installationKit.validateDiscord({guildId:"123456789012345678"}).value.guildId,"123456789012345678");
});
test("Login-Protokoll: Karte zeigt den Speicherort statt einer leeren Log-Datei",()=>{
  const ui=read("public/app.js");
  assert.doesNotMatch(ui,/<span>Log-Datei<\/span>/);
  assert.match(ui,/d\.storage==="postgres"\?/);assert.match(ui,/<span>Speicherort<\/span><strong>Datenbank<\/strong>/);
});
