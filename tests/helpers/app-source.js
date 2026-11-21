// Seit 8.9.18 (Entkopplung 1d) liegt der Quelltext des Control Centers in zwei Dateien:
// app/server.js (Web-Kern) und die Twitch-Laufzeit (seit 8.9.21 shared/twitch-runtime.js). Tests, die den Quelltext
// auf Muster prüfen, lesen deshalb beide zusammen – so gelten Positiv- und Negativprüfungen
// weiterhin für den gesamten Code und nicht nur für den Teil, der in server.js geblieben ist.
const fs=require("node:fs"),path=require("node:path");
const root=path.join(__dirname,"..","..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
// Seit 8.9.21 (3b) kommt das gemeinsame Fundament shared/bcc-core.js dazu.
const PARTS=["app/server.js","shared/twitch-runtime.js","shared/twitch-data.js","shared/bcc-core.js"];
function appSource(){return PARTS.filter(f=>fs.existsSync(path.join(root,f))).map(read).join("\n");}
appSource.parts=PARTS;
appSource.web=()=>read("app/server.js");
appSource.runtime=()=>read("shared/twitch-runtime.js");
module.exports=appSource;
