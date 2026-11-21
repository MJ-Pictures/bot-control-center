"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
// Seit 9.0.0 wird die Vorlage unter tools/compose geprüft (fünf Dienste); die Datei im Hauptordner ist die alte Ein-Container-Vorlage.
const compose=fs.readFileSync(path.join(__dirname,"..","tools","compose","compose.yaml"),"utf8");
const block=name=>{
  const m=new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z]+:\\n|\\nsecrets:\\n)`).exec(compose);
  assert.ok(m,`${name}-Block fehlt`);return m[1];
};
// Seit 9.0.0 heißen die Dienste web, twitch und discord (Datenbank: db); der frühere Dienst twitchbot ist aufgeteilt.
for(const name of ["web","twitch","discord"]){
  test(`N-6/8.7.0: ${name} läuft als Non-Root mit PID-Limit und behält die bisherige Härtung`,()=>{
    const b=block(name);
    assert.match(b,/\n    user: "1000:1000"\n/);
    assert.match(b,/\n    pids_limit: 256\n/);
    assert.match(b,/no-new-privileges:true/);
    assert.match(b,/cap_drop:\n      - ALL/);
    assert.match(b,/mem_limit: 384m/);
    assert.match(b,/image: bwk-node-pg:7\.2\.0/);
  });
}
test("N-6/8.7.0: PostgreSQL bleibt ohne user/cap_drop (Entrypoint braucht Rechte)",()=>{
  const b=block("db").split("\n").filter(l=>!l.trim().startsWith("#")).join("\n");
  assert.ok(!/\n    user:/.test(b));
  assert.ok(!/cap_drop/.test(b));
});
test("N-6/8.7.0: Code-Mounts bleiben read-only",()=>{
  assert.match(block("web"),/\.\/app:\/app:ro/);
  assert.match(block("twitch"),/\.\/twitch-app:\/app:ro/);
  assert.match(block("discord"),/\.\/discord-app:\/app:ro/);
  for(const name of ["web","twitch","discord"])assert.match(block(name),/\.\/shared:\/shared:ro/);
});

for(const name of ["web","twitch","discord"]){
  test(`N-6/8.7.1: ${name} hat ein schreibgeschütztes Root-Dateisystem mit /tmp als RAM-Disk`,()=>{
    const b=block(name);
    assert.match(b,/\n    read_only: true\n/);
    assert.match(b,/\n    tmpfs:\n      - \/tmp:rw,noexec,nosuid,size=16m\n/);
  });
}
test("N-6/8.7.1: PostgreSQL bleibt ohne read_only",()=>{
  const b=block("db").split("\n").filter(l=>!l.trim().startsWith("#")).join("\n");
  assert.ok(!/\n    read_only:/.test(b));
});
