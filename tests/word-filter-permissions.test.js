const appSource=require("./helpers/app-source");
const fs=require("fs"),path=require("path");
function ok(v,m){if(!v)throw new Error(m);}
const root=path.resolve(__dirname,"..");
const ui=fs.readFileSync(path.join(root,"public/app.js"),"utf8");
const server=appSource();
ok(!ui.includes('{tab:"wordFilter",label:"Wortfilter",adminOnly:true}'),"Wortfilter darf nicht adminOnly sein");
ok(ui.includes('anyCapabilities:["twitch.moderation.view","twitch.blocked.view","discord.moderation.view"]'),"Twitch-Wortfilter-Navigation berücksichtigt bestehende Moderationsrechte nicht");
ok(server.includes('function apiAnyCapabilitiesFor(pathname,method)'),"Any-Capability-Guard fehlt");
ok(server.includes('"twitch.blocked.edit","discord.moderation.edit"'),"Wortfilter-Schreibrechte fehlen");
ok(!server.includes('if(p.startsWith("/api/word-filter"))return"admin";'),"Wortfilter ist serverseitig noch admin-only");
console.log("word-filter-permissions.test.js: OK");
