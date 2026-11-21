const fs=require('fs');
const s=fs.readFileSync('discord-app/discord-server.js','utf8');
if(!s.includes('for(const entry of readModerationLog(500))')) throw new Error('Spam timeout log fallback missing');
if(!s.includes('row.activeTimeoutUntil||Number(row.timeoutStage||0)>0||Number(row.currentViolations||0)>0')) throw new Error('Active timeout inclusion missing');
if(!s.includes('resetRepeatCounter(userId,"spam-protect")')) throw new Error('Spam escalation reset missing');
const ui=fs.readFileSync('public/app.js','utf8');
if(!ui.includes('Spam-Verstöße im Eskalationsfenster')) throw new Error('Spam sanctions UI missing');
console.log('discord-spam-sanctions.test.js: OK');
