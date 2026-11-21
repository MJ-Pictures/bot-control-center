"use strict";
const fs=require("fs");
const path=require("path");
const root=path.join(__dirname,"..");
const pg=fs.readFileSync(path.join(root,"shared","pg-sync-store.js"),"utf8");
const ui=fs.readFileSync(path.join(root,"public","app.js"),"utf8");
function ok(v,m){if(!v)throw new Error(m);}
ok(pg.includes("function pgDateOnly"),"pgDateOnly helper fehlt");
ok(pg.includes("date:pgDateOnly(x.snapshot_date)"),"Discord Analytics Export nutzt pgDateOnly nicht");
ok(!pg.includes("date:String(x.snapshot_date).slice(0,10)"),"Fehlerhafte DATE-Konvertierung noch vorhanden");
ok(ui.includes('const parsed=/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)?new Date(raw+"T12:00:00"):new Date(raw)'),"Defensive Datumsformatierung im Frontend fehlt");
console.log("discord-analytics-date.test.js: OK");
