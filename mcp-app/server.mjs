import { createServer, request as httpRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import pg from 'pg';
import * as z from 'zod/v4';

// MCP-Server des Bot Control Centers: rein lesender Zugang (Statistik, Health). Seit Control Center 8.12.0
// ein Dienst des Control Centers (Ordner mcp-app/, Container bcc-mcp); er kommt mit jedem Update über das ZIP.
// Die früheren Update-Funktionen (Staging, Deploy-/Rollback-Anfragen) sind entfernt: Updates laufen
// ausschließlich über das Pull-Deployment. Der Dienst schreibt nirgends hin und hat keine Schreib-Mounts.
const port = 3100;

// Geheimnisse bevorzugt aus Dateien (Docker-Secrets), sonst aus der Umgebung.
function secretValue(name) {
  const file = (process.env[`${name}_FILE`] || '').trim();
  if (file) {
    try { return readFileSync(file, 'utf8').trim(); }
    catch { throw new Error(`${name}_FILE ist nicht lesbar`); }
  }
  return process.env[name] || '';
}
const secret = secretValue('MCP_TOKEN');
const dbPassword = secretValue('PGPASSWORD');
if (secret.length < 32 || !dbPassword) {
  throw new Error('MCP_TOKEN (>=32 Zeichen) und PGPASSWORD müssen gesetzt sein (direkt oder als *_FILE).');
}

// Die Version ist die des Control Centers (eine Versionsnummer für alles).
function appVersion() {
  try {
    const v = JSON.parse(readFileSync(process.env.VERSION_FILE || '/public/version.json', 'utf8')).version;
    return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : '0.0.0';
  } catch { return '0.0.0'; }
}
const version = appVersion();

const pool = new pg.Pool({
  host: process.env.PGHOST || 'db',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'bwk',
  user: process.env.PGUSER || 'bwk_mcp_reader',
  password: dbPassword,
  max: 2,
  connectionTimeoutMillis: 3000,
  query_timeout: 5000,
  statement_timeout: 5000,
  application_name: 'bcc-mcp-readonly'
});

function sameToken(header) {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.substring(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const textResult = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
});

// Freigegebene Hosts für die Health-Abfragen (nur interne Docker-Namen).
// Dienst- und Containernamen des Control Centers (web / twitch / discord, bcc-*). Die Namen des früheren
// Ein-Container-Betriebs sind seit 9.0.0 entfernt.
const DISCORD_HEALTH_HOSTS = ['discord', 'bcc-discord'];
const TWITCH_HEALTH_HOSTS = ['web', 'bcc-web', 'twitch', 'bcc-twitch'];

const handler = createMcpHandler(() => {
  const mcp = new McpServer({
    name: 'bot-control-center',
    version
  });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

  mcp.registerTool('get_server_status', {
    description: 'Technischer Status des BWK MCP-Servers (nur Lesen)',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => textResult({ service: 'bcc-mcp', version, online: true, mode: 'read-only', uptime_seconds: Math.floor(process.uptime()) }));

  mcp.registerTool('get_database_status', {
    description: 'Prüft die Datenbankverbindung ohne Nutzerdaten abzurufen',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => {
    try {
      const { rows } = await pool.query('SELECT current_database() AS database, current_user AS db_user, now() AS checked_at');
      return textResult({ connected: true, ...rows[0] });
    } catch (error) {
      console.error('Database status check failed:', error.code || error.name);
      return { ...textResult({ connected: false, error: 'PostgreSQL-Verbindung fehlgeschlagen' }), isError: true };
    }
  });

  mcp.registerTool('get_database_overview', {
    description: 'Listet technische PostgreSQL-Tabellenstatistiken (Schätzwerte, keine Datensätze)',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => {
    try {
      const { rows } = await pool.query(`
        SELECT relname AS table_name, n_live_tup AS estimated_rows
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY relname LIMIT 100
      `);
      return textResult({ note: 'Geschätzte Anzahl; keine Nutzerdaten', tables: rows });
    } catch (error) {
      console.error('Database overview check failed:', error.code || error.name);
      return { ...textResult({ error: 'Tabellenstatistik nicht verfügbar' }), isError: true };
    }
  });

  // Sicht nur auf eigens freigegebene, aggregierte Datenbank-Views.
  async function readView(query, label) {
    try {
      const { rows } = await pool.query(query);
      return textResult({ source: 'PostgreSQL', report: label, rows });
    } catch (error) {
      console.error('MCP report failed:', label, error.code || error.name);
      return { ...textResult({ error: 'Auswertung nicht verfügbar. SQL-Views und Berechtigungen prüfen.', report: label }), isError: true };
    }
  }

  mcp.registerTool('get_twitch_activity_summary', {
    description: 'Aggregierte Twitch-Nachrichtenanzahl nach Tag für die letzten 30 Tage (ohne Usernamen)',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => readView('SELECT day, message_count FROM bwk_mcp.twitch_daily_30d ORDER BY day DESC LIMIT 30', 'twitch_activity'));

  mcp.registerTool('get_twitch_followers_summary', {
    description: 'Gesamtzahl gespeicherter Twitch-Follower pro Namespace (ohne Nutzerdaten)',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => readView('SELECT namespace, follower_count FROM bwk_mcp.twitch_follower_summary ORDER BY namespace LIMIT 25', 'twitch_followers'));

  mcp.registerTool('get_discord_member_trend', {
    description: 'Discord-Mitgliederzahl aus den letzten 30 täglichen Snapshots (keine Live-Mitgliederzahl)',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => readView('SELECT snapshot_date, member_count FROM bwk_mcp.discord_member_trend ORDER BY snapshot_date DESC LIMIT 30', 'discord_members'));

  mcp.registerTool('get_moderation_summary', {
    description: 'Anzahl Wortfilter-Treffer der letzten 30 Tage nach Plattform (ohne Inhalt und Nutzeridentität)',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => readView('SELECT platform, hit_count, false_positives FROM bwk_mcp.moderation_summary ORDER BY platform LIMIT 5', 'moderation'));

  mcp.registerTool('get_discord_xp_leaderboard', {
    description: 'Top 10 XP anonymisiert: Rang, XP und Teilstreitkraft; keine Discord-IDs oder Namen',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => readView('SELECT position, xp, branch FROM bwk_mcp.discord_xp_leaderboard ORDER BY position LIMIT 10', 'discord_xp_leaderboard'));

  mcp.registerTool('get_discord_xp_summary', {
    description: 'Summierte Discord-XP, Teilnehmer und Verteilung nach Teilstreitkraft ohne Identitäten',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => readView('SELECT participants, total_xp, heer_users, luftwaffe_users, marine_users, state_updated_at FROM bwk_mcp.discord_xp_summary', 'discord_xp_summary'));

  mcp.registerTool('get_discord_mission_summary', {
    description: 'Abgeschlossene, erfolgreiche, fehlgeschlagene und aktive Einsätze der letzten 30 Tage; ohne Nutzeridentitäten',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => readView('SELECT completed, successful, failed, reward_xp, active, ready, state_updated_at FROM bwk_mcp.discord_mission_summary', 'discord_missions'));

  mcp.registerTool('get_discord_mission_types', {
    description: 'Aggregierte abgeschlossene Missionen der letzten 30 Tage nach Missionskennung, ohne Nutzeridentitäten',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => readView('SELECT mission_id, completed, successful, reward_xp FROM bwk_mcp.discord_mission_types ORDER BY completed DESC, mission_id LIMIT 40', 'discord_mission_types'));

  mcp.registerTool('get_discord_dailyxp_summary', {
    description: 'DailyXP-Vergaben der letzten 30 Tage: Anzahl und vergebene XP; ohne Nutzeridentitäten',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => readView('SELECT claims, awarded_xp, state_updated_at FROM bwk_mcp.discord_dailyxp_summary', 'discord_dailyxp'));

  // Node.js 22 fetch() may silently discard an explicitly provided Host header.
  // Use the core HTTP client for the Twitch health probe so the existing
  // Control Center host allowlist remains enforced without changes.
  function twitchHealthStatus(url, allowedHost) {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const req = httpRequest({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'GET',
        headers: { Host: allowedHost, Accept: 'application/json' },
        timeout: 2500,
        agent: false
      }, (res) => {
        const status = res.statusCode ?? 0;
        res.resume(); // Response is intentionally not exposed to MCP clients.
        resolve(status);
      });
      req.on('timeout', () => req.destroy(new Error('Healthcheck timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  async function health(url, label) {
    if (!url) return {service:label, configured:false, status:'unavailable', reason:'Keine Health-URL konfiguriert'};
    try {
      let status;
      if (label === 'twitch' && twitchHealthHost) {
        status = await twitchHealthStatus(url, twitchHealthHost);
      } else {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2500),
          redirect: 'manual',
          headers: {Accept: 'application/json'}
        });
        status = response.status;
        await response.body?.cancel();
      }
      return {service:label, configured:true, reachable:true, healthy:status===200, http_status:status};
    } catch {
      return {service:label, configured:true, reachable:false, healthy:false};
    }
  }
  function healthUrl(name, fallback) {
    const value = process.env[name] || fallback;
    if (!value) return null;
    let url;
    try { url = new URL(value); } catch { throw new Error(`${name} ist keine gültige URL`); }
    if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/health') {
      throw new Error(`${name} muss eine interne HTTP-Adresse mit Pfad /health sein`);
    }
    const allow = name === 'DISCORD_HEALTH_URL' ? DISCORD_HEALTH_HOSTS : TWITCH_HEALTH_HOSTS;
    if (!allow.includes(url.hostname)) throw new Error(`${name}: Host nicht freigegeben`);
    return url.href;
  }
  const discordHealthUrl = healthUrl('DISCORD_HEALTH_URL', 'http://discord:3001/health');
  const twitchHealthUrl = healthUrl('TWITCH_HEALTH_URL', 'http://web:3000/health');
  // Host-Header für die Abfrage der Weboberfläche (ihre öffentliche Adresse aus ALLOWED_HOSTS). Nur ein Hostname.
  const twitchHealthHost = (process.env.TWITCH_HEALTH_HOST || '').trim().toLowerCase();
  if (twitchHealthHost && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(twitchHealthHost)) {
    throw new Error('TWITCH_HEALTH_HOST ist kein gültiger Hostname');
  }
  mcp.registerTool('get_bot_health', {
    description: 'Prüft nur interne HTTP-Health-Endpunkte der Discord- und Twitch-Dienste; kein Docker-Zugriff und keine Geheimnisse',
    inputSchema: z.object({}), annotations: readOnly
  }, async () => textResult({checks: await Promise.all([
    health(discordHealthUrl,'discord'), health(twitchHealthUrl,'twitch')
  ]), note:'Status des Endpunkts; kein Beweis für durchgehenden Chat-/Gateway-Betrieb.'}));


  return mcp;
}, { responseMode: 'json' });

// Erreichbar nur im privaten Docker-Netz unter diesen Namen (kein veröffentlichter Port).
const ALLOWED_HTTP_HOSTS = ['mcp:3100', 'bcc-mcp:3100', 'localhost:3100', '127.0.0.1:3100'];
const nodeHandler = toNodeHandler(handler);
const httpServer = createServer((req, res) => {
  if (req.url !== '/mcp') {
    res.writeHead(404).end();
    return;
  }
  // Keine Browser-Origin-Anfragen und keine unzulässigen Hostnamen zulassen.
  if (req.headers.origin || !ALLOWED_HTTP_HOSTS.includes(req.headers.host)) {
    res.writeHead(403).end();
    return;
  }
  if (!sameToken(req.headers.authorization)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
    return;
  }
  void nodeHandler(req, res);
});
httpServer.listen(port, '0.0.0.0', () => console.log(`BCC MCP server ${version} ready on port ${port} (private Docker network, read-only)`));

async function shutdown() {
  httpServer.close();
  await handler.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
