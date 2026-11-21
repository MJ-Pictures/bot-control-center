const appSource=require("./helpers/app-source");
const fs=require("fs");
const assert=require("assert");
const app=fs.readFileSync("public/app.js","utf8");
const server=appSource();
const html=fs.readFileSync("public/index.html","utf8");

assert(server.includes('/api/dashboard-summary'),"Dashboard-Summary-API fehlt");
assert(server.includes('wordFilter:{'),"Zentraler Wortfilter fehlt in Dashboard-Summary");
assert(server.includes('legacyActive:'),"Legacy-Zähler soll nur diagnostisch erhalten bleiben");
assert(!/activeBlocked=settings\.blockedWords\.filter/.test(app),"Dashboard darf Legacy blockedWords nicht mehr als Wortfilter zählen");
assert(app.includes('await loadDashboardSummary();'),"Dashboard-Summary wird nicht geladen");
assert(app.includes('Test') && app.includes('T ${Number(wf.twitch)}') && app.includes('D ${Number(wf.discord)}'),"Wortfilter-Unterzahlen fehlen");
assert(html.includes('Twitch App Token'),"App-Token-Karte ist noch irreführend benannt");
assert(html.includes('Legacy-Wortliste') && html.includes('zentrale V8-Wortfilter'),"Reset-Hinweis ist nicht auf Legacy-Bestand korrigiert");
assert(app.includes('testMessageCard') && app.includes('twitch.commands.edit'),"Testnachricht wird nicht capability-basiert ausgeblendet");
console.log('dashboard-summary-v8013.test.js: OK');
