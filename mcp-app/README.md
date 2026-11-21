# MCP-Server des Bot Control Centers (rein lesend)

Optionaler Dienst `mcp` (Container `bcc-mcp`): ein MCP-Zugang, über den ein KI-Assistent Kennzahlen und den Zustand der Dienste **lesen** kann. Er verändert nichts, hat keine Schreib-Mounts, keinen Docker-Zugriff und keinen veröffentlichten Port.

## Was er kann
- Status des Servers und der Datenbankverbindung.
- Zusammengefasste Kennzahlen aus den Ansichten im Schema `bwk_mcp` (Twitch-Aktivität und Follower, Discord-Mitglieder, Moderation, XP, Missionen, DailyXP). Keine Rohdaten, keine Namen.
- `get_bot_health`: fragt die internen `/health`-Adressen von Weboberfläche und Discord-Bot ab.

## Einrichtung (Teil der `compose.yaml` des Control Centers)
- Code: dieser Ordner; das Image wird beim Update mit `docker compose up -d --build` gebaut. Ändert sich `package.json`, braucht der Bau Zugriff auf die npm-Registry.
- Geheimnisse als Dateien im Ordner `secrets/` des Projekts:
  - `mcp_token.txt` – Zugangstoken, mindestens 32 Zeichen (`openssl rand -hex 32`).
  - `mcp_db_password.txt` – Passwort des Datenbank-Benutzers `bwk_mcp_reader`.
- Datenbank: Benutzer und Ansichten einmalig mit `setup-readonly-views.sql` und `setup-levelsystem-views.sql` anlegen (nur `SELECT` auf die Ansichten).
- Umgebung (in der `compose.yaml`): `PGHOST=db`, `TWITCH_HEALTH_URL=http://web:3000/health`, `TWITCH_HEALTH_HOST=<öffentliche Adresse der Weboberfläche>`, `DISCORD_HEALTH_URL=http://discord:3001/health`.
- Im Docker-Netz erreichbar unter `http://mcp:3100/mcp`, nur mit `Authorization: Bearer <Token>`. Anfragen mit `Origin`-Kopf oder fremdem Host werden abgelehnt.

## Prüfen (auf dem Host)
```bash
sudo docker exec bcc-mcp node -e "const http=require('http'),fs=require('fs');const t=fs.readFileSync(process.env.MCP_TOKEN_FILE,'utf8').trim();const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_bot_health',arguments:{}}});const req=http.request({host:'127.0.0.1',port:3100,path:'/mcp',method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','authorization':'Bearer '+t,'content-length':Buffer.byteLength(body)}},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>console.log(r.statusCode,b))});req.write(body);req.end();"
```
Erwartet: `200` und für `discord` und `twitch` jeweils `healthy: true`.

## Ein externer Zugang
Ist nicht eingerichtet. Wer den Dienst von außen nutzen will, braucht ein eigenes Konzept (Adresse, TLS, Anmeldung); ohne das bleibt er im privaten Docker-Netz.
