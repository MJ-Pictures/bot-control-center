"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
// Seit 9.0.0 wird die Vorlage unter tools/compose geprüft (fünf Dienste); die Datei im Hauptordner ist die alte Ein-Container-Vorlage.
const compose=fs.readFileSync(path.join(__dirname,"..","tools","compose","compose.yaml"),"utf8");
const block=name=>{
  const m=new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z]+:\\n|\\nsecrets:\\n|\\n# Jede Datei)`).exec(compose);
  assert.ok(m,`${name}-Block fehlt`);return m[1];
};
const declared=()=>{
  const m=/\nsecrets:(\n[\s\S]*?)\nnetworks:/.exec(compose);
  assert.ok(m,"secrets-Abschnitt fehlt");
  const out={};
  for(const x of m[1].matchAll(/\n  ([a-z_]+):\n    file: (\S+)/g))out[x[1]]=x[2];
  return out;
};
const serviceSecrets=b=>{
  const m=/\n    secrets:\n((?:      - [a-z_]+\n)+)/.exec(b);
  assert.ok(m,"secrets-Liste fehlt");
  return [...m[1].matchAll(/- ([a-z_]+)/g)].map(x=>x[1]);
};

test("8.8.0: Vorlage enthält keine Klartext-Secrets oder Platzhalter mehr",()=>{
  assert.ok(!/HIER_/.test(compose),"Platzhalter HIER_ gefunden");
  for(const name of ["TWITCH_CLIENT_SECRET","LOCAL_ADMIN_PASSWORD","INTERNAL_SERVICE_SECRET","DISCORD_CLIENT_SECRET","DISCORD_BOT_TOKEN"]){
    assert.ok(!new RegExp(`\\n\\s+${name}:`).test(compose),`${name} steht noch als Umgebungswert in der Vorlage`);
    assert.ok(new RegExp(`\\n\\s+${name}_FILE: "/run/secrets/[a-z_]+"`).test(compose),`${name}_FILE fehlt`);
  }
});
test("8.8.0: jede *_FILE-Variable zeigt auf ein deklariertes und beim Dienst eingetragenes Secret",()=>{
  const decl=declared();
  for(const name of ["web","twitch","discord","mcp"]){
    const b=block(name);const list=serviceSecrets(b);
    for(const m of b.matchAll(/\n\s+([A-Z_]+_FILE): "\/run\/secrets\/([a-z_]+)"/g)){
      assert.ok(decl[m[2]],`${name}: ${m[1]} → Secret ${m[2]} nicht deklariert`);
      assert.ok(list.includes(m[2]),`${name}: Secret ${m[2]} fehlt in der secrets-Liste`);
    }
  }
});
test("8.8.0: Secret-Dateien liegen unter ./secrets, jedes Secret wird benutzt",()=>{
  const decl=declared();
  for(const [name,file] of Object.entries(decl))assert.equal(file,`./secrets/${name}.txt`,name);
  const used=new Set([...compose.matchAll(/\/run\/secrets\/([a-z_]+)/g)].map(x=>x[1]));
  for(const name of Object.keys(decl))assert.ok(used.has(name),`${name} wird nirgends verwendet`);
});
test("8.8.0: alle drei Dienste nutzen dasselbe INTERNAL_SERVICE_SECRET",()=>{
  for(const name of ["web","twitch","discord"]){
    const b=block(name);
    assert.match(b,/INTERNAL_SERVICE_SECRET_FILE: "\/run\/secrets\/internal_service_secret"/);
    assert.ok(serviceSecrets(b).includes("internal_service_secret"));
  }
});
test("8.8.0: Dienste lesen genau die Secrets, die der Code per *_FILE unterstützt",()=>{
  const {CONTROL_CENTER_SECRETS,DISCORD_SECRETS}=require("../shared/secret-env");
  const files=name=>[...block(name).matchAll(/\n\s+([A-Z_]+)_FILE: "\/run\/secrets/g)].map(x=>x[1]).filter(x=>x!=="DB_PASSWORD");
  // Seit 9.0.0: web und twitch (früher gemeinsam „twitchbot“) lesen ihre Secrets über dieselbe Liste.
  for(const name of ["web","twitch"])for(const n of files(name))assert.ok(CONTROL_CENTER_SECRETS.includes(n),`${name}: ${n}`);
  for(const n of files("discord"))assert.ok(DISCORD_SECRETS.includes(n),`discord: ${n}`);
});
