// 9.29.1: Die Compose-Vorlage muss gültiges YAML sein (Einrückung in Zeile 13 war seit 9.16.0 falsch).
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const rd=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");

// Einfache Strukturprüfung ohne YAML-Bibliothek: Auf eine Zeile „schlüssel: wert“ (Wert nicht leer, kein Blockzeichen,
// kein Listeneintrag) darf keine tiefer eingerückte Zeile folgen. Genau das war der Fehler. Zusätzlich: Einrückung gerade
// und keine Tabulatoren.
function strukturFehler(text){
  const fehler=[];
  const zeilen=text.split("\n");
  let vorher=null;
  zeilen.forEach((z,i)=>{
    if(/^ *\t/.test(z))fehler.push(`Zeile ${i+1}: Tabulator in der Einrückung`);
    if(!z.trim()||/^\s*#/.test(z))return;
    const ein=z.match(/^ */)[0].length;
    if(ein%2)fehler.push(`Zeile ${i+1}: ungerade Einrückung (${ein})`);
    if(vorher){
      const m=vorher.text.match(/^\s*(?:- )?[^\s#:][^:]*:\s+(\S.*)$/);
      const istSkalar=m&&!/^[|>][+-]?\s*(#.*)?$/.test(m[1])&&!/^\s*- /.test(vorher.text);
      if(istSkalar&&ein>vorher.ein&&!/^\s*-/.test(z))fehler.push(`Zeile ${i+1}: tiefer eingerückt als die Zeile davor (${vorher.nr}), die schon einen Wert hat`);
    }
    vorher={text:z,ein,nr:i+1};
  });
  return fehler;
}

test("Vorlage tools/compose/compose.yaml: Struktur gültig",()=>{
  const f=strukturFehler(rd("tools/compose/compose.yaml"));
  assert.deepEqual(f,[],f.join("\n"));
});
test("Strukturprüfung erkennt den Fehler aus 9.16.0 (networks: zu tief eingerückt)",()=>{
  const kaputt="services:\n  db:\n    image: postgres:17-alpine\n    container_name: bcc-db\n        networks:\n      default:\n";
  assert.ok(strukturFehler(kaputt).length>0);
  const ok="services:\n  db:\n    image: postgres:17-alpine\n    container_name: bcc-db\n    networks:\n      default:\n";
  assert.deepEqual(strukturFehler(ok),[]);
});
test("Vorlage: fünf Dienste mit festen Namen, Netz und Alias postgres",()=>{
  const s=rd("tools/compose/compose.yaml");
  for(const k of ["  db:","  web:","  twitch:","  discord:","  mcp:","container_name: bcc-db","container_name: bcc-web","container_name: bcc-twitch","container_name: bcc-discord","container_name: bcc-mcp","name: bwk-control-center","- postgres"])assert.ok(s.includes(k),k);
  assert.match(s,/container_name: bcc-db\n    networks:\n      default:\n        aliases:\n          - postgres\n/);
});
test("Vorlage mit PyYAML lesen, wenn Python und PyYAML vorhanden sind",t=>{
  const r=cp.spawnSync("python3",["-I","-c","import sys,yaml;d=yaml.safe_load(open(sys.argv[1],encoding='utf-8'));assert list(d['services'])==['db','web','twitch','discord','mcp'],list(d['services']);print('ok')",path.join(__dirname,"..","tools/compose/compose.yaml")],{encoding:"utf8"});
  if(r.error||/No module named 'yaml'/.test(r.stderr||"")){t.skip("Python oder PyYAML fehlt");return;}
  assert.equal(r.status,0,r.stderr);
});
test("Anleitung zweite Installation: Hinweise auf Namen, Netz, Port und Gateway",()=>{
  const s=rd("tools/compose/INSTALLATION.md");
  for(const k of ["## Zweite Installation","container_name","networks","3010","TRUSTED_PROXY_CIDRS","eigene Twitch-Anwendung","docker network inspect"])assert.ok(s.includes(k),k);
});
