-- MCP v1.2.0: Zusatz-Views auf JSONB-Levelsystem-Dokumente aus BWK 8.6.4.
-- Nur der bestehende DB-Admin führt dieses Skript aus.
-- Tabellenrechte werden NICHT an bwk_mcp_reader erteilt.
BEGIN;
CREATE SCHEMA IF NOT EXISTS bwk_mcp;
REVOKE ALL ON SCHEMA bwk_mcp FROM PUBLIC;
GRANT USAGE ON SCHEMA bwk_mcp TO bwk_mcp_reader;

-- Isoliert nur den benötigten, von der Anwendung gespeicherten Discord-Levelzustand.
CREATE OR REPLACE VIEW bwk_mcp.discord_xp_leaderboard AS
WITH doc AS (
  SELECT value FROM public.state_documents
  WHERE namespace = 'discord' AND key = 'levelsystem-state'
), members AS (
  SELECT (u.value->>'xp')::bigint AS xp,
         CASE WHEN u.value->>'branch' IN ('heer','luftwaffe','marine')
           THEN u.value->>'branch' ELSE 'heer' END AS branch
  FROM doc CROSS JOIN LATERAL jsonb_each(COALESCE(doc.value->'users','{}'::jsonb)) u
  WHERE (u.value->>'xp') ~ '^[0-9]{1,15}$'
)
SELECT row_number() OVER (ORDER BY xp DESC, branch) AS position, xp, branch
FROM members ORDER BY xp DESC, branch LIMIT 10;

CREATE OR REPLACE VIEW bwk_mcp.discord_xp_summary AS
WITH doc AS (
  SELECT value,updated_at FROM public.state_documents
  WHERE namespace='discord' AND key='levelsystem-state'
), members AS (
  SELECT CASE WHEN (u.value->>'xp') ~ '^[0-9]{1,15}$'
              THEN (u.value->>'xp')::bigint ELSE 0 END AS xp,
         u.value->>'branch' AS branch
  FROM doc CROSS JOIN LATERAL jsonb_each(COALESCE(doc.value->'users','{}'::jsonb)) u
)
SELECT COUNT(*)::bigint AS participants, COALESCE(SUM(xp),0)::bigint AS total_xp,
       COUNT(*) FILTER (WHERE branch='heer')::bigint AS heer_users,
       COUNT(*) FILTER (WHERE branch='luftwaffe')::bigint AS luftwaffe_users,
       COUNT(*) FILTER (WHERE branch='marine')::bigint AS marine_users,
       (SELECT MAX(updated_at) FROM doc) AS state_updated_at
FROM members;

CREATE OR REPLACE VIEW bwk_mcp.discord_mission_summary AS
WITH doc AS (
 SELECT value,updated_at FROM public.state_documents
 WHERE namespace='discord' AND key='levelsystem-state'
), events AS (
 SELECT m.value AS event FROM doc CROSS JOIN LATERAL
 jsonb_array_elements(CASE WHEN jsonb_typeof(doc.value->'missionLog')='array' THEN doc.value->'missionLog' ELSE '[]'::jsonb END) m
 WHERE (m.value->>'claimedAt') ~ '^[0-9]{10,15}$'
 AND (m.value->>'claimedAt')::bigint >= extract(epoch FROM now() - interval '30 days') * 1000
), active AS (
 SELECT m.value AS event FROM doc CROSS JOIN LATERAL
 jsonb_each(CASE WHEN jsonb_typeof(doc.value->'missions')='object' THEN doc.value->'missions' ELSE '{}'::jsonb END) m
)
SELECT (SELECT COUNT(*) FROM events)::bigint AS completed,
 (SELECT COUNT(*) FROM events WHERE event->>'success'='true')::bigint AS successful,
 (SELECT COUNT(*) FROM events WHERE event->>'success' IS DISTINCT FROM 'true')::bigint AS failed,
 (SELECT COALESCE(SUM((event->>'reward')::bigint),0) FROM events WHERE (event->>'reward') ~ '^[0-9]{1,12}$')::bigint AS reward_xp,
 (SELECT COUNT(*) FROM active)::bigint AS active,
 (SELECT COUNT(*) FROM active WHERE (event->>'endsAt') ~ '^[0-9]{10,15}$'
 AND (event->>'endsAt')::bigint <= extract(epoch FROM now()) * 1000)::bigint AS ready,
 (SELECT MAX(updated_at) FROM doc) AS state_updated_at;

CREATE OR REPLACE VIEW bwk_mcp.discord_mission_types AS
WITH events AS (
 SELECT m.value AS event FROM public.state_documents d CROSS JOIN LATERAL
 jsonb_array_elements(CASE WHEN jsonb_typeof(d.value->'missionLog')='array' THEN d.value->'missionLog' ELSE '[]'::jsonb END) m
 WHERE d.namespace='discord' AND d.key='levelsystem-state'
 AND (m.value->>'claimedAt') ~ '^[0-9]{10,15}$'
 AND (m.value->>'claimedAt')::bigint >= extract(epoch FROM now() - interval '30 days') * 1000
)
SELECT LEFT(COALESCE(event->>'missionId','unbekannt'),80) AS mission_id,
 COUNT(*)::bigint AS completed,
 COUNT(*) FILTER (WHERE event->>'success'='true')::bigint AS successful,
 COALESCE(SUM(CASE WHEN (event->>'reward') ~ '^[0-9]{1,12}$' THEN (event->>'reward')::bigint ELSE 0 END),0)::bigint AS reward_xp
FROM events GROUP BY 1;

CREATE OR REPLACE VIEW bwk_mcp.discord_dailyxp_summary AS
WITH doc AS (
 SELECT value,updated_at FROM public.state_documents
 WHERE namespace='discord' AND key='levelsystem-state'
), bonuses AS (
 SELECT b.value AS event FROM doc CROSS JOIN LATERAL
 jsonb_array_elements(CASE WHEN jsonb_typeof(doc.value->'bonusGrants')='array' THEN doc.value->'bonusGrants' ELSE '[]'::jsonb END) b
 WHERE b.value->>'source'='daily'
 AND (b.value->>'at') ~ '^[0-9]{10,15}$'
 AND (b.value->>'at')::bigint >= extract(epoch FROM now() - interval '30 days') * 1000
)
SELECT (SELECT COUNT(*) FROM bonuses)::bigint AS claims,
 (SELECT COALESCE(SUM((event->>'delta')::bigint),0) FROM bonuses WHERE (event->>'delta') ~ '^[0-9]{1,12}$')::bigint AS awarded_xp,
 (SELECT MAX(updated_at) FROM doc) AS state_updated_at;

REVOKE ALL ON bwk_mcp.discord_xp_leaderboard, bwk_mcp.discord_xp_summary,
 bwk_mcp.discord_mission_summary, bwk_mcp.discord_mission_types,
 bwk_mcp.discord_dailyxp_summary FROM PUBLIC;
GRANT SELECT ON bwk_mcp.discord_xp_leaderboard, bwk_mcp.discord_xp_summary,
 bwk_mcp.discord_mission_summary, bwk_mcp.discord_mission_types,
 bwk_mcp.discord_dailyxp_summary TO bwk_mcp_reader;
COMMIT;
