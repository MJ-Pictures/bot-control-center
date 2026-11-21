-- BWK MCP 1.1.0: nur aggregierte Auswertungen; KEINE Tabellen-SELECT-Rechte für MCP.
-- Als PostgreSQL-Administrator in Datenbank bwk ausführen.
BEGIN;
CREATE SCHEMA IF NOT EXISTS bwk_mcp;
REVOKE ALL ON SCHEMA bwk_mcp FROM PUBLIC;
GRANT USAGE ON SCHEMA bwk_mcp TO bwk_mcp_reader;

CREATE OR REPLACE VIEW bwk_mcp.twitch_daily_30d AS
SELECT day, SUM(total)::bigint AS message_count
FROM public.twitch_message_count_daily
WHERE day >= (CURRENT_DATE - 29)
GROUP BY day;

CREATE OR REPLACE VIEW bwk_mcp.twitch_follower_summary AS
SELECT namespace, COUNT(*)::bigint AS follower_count
FROM public.twitch_followers
GROUP BY namespace;

CREATE OR REPLACE VIEW bwk_mcp.discord_member_trend AS
SELECT snapshot_date, SUM(member_count)::bigint AS member_count
FROM public.discord_analytics_snapshots
WHERE snapshot_date >= (CURRENT_DATE - 29)
GROUP BY snapshot_date;

CREATE OR REPLACE VIEW bwk_mcp.moderation_summary AS
SELECT platform, COUNT(*)::bigint AS hit_count,
       COUNT(*) FILTER (WHERE false_positive)::bigint AS false_positives
FROM public.word_filter_hits
WHERE occurred_at >= (NOW() - INTERVAL '30 days')
GROUP BY platform;

REVOKE ALL ON ALL TABLES IN SCHEMA bwk_mcp FROM PUBLIC;
GRANT SELECT ON bwk_mcp.twitch_daily_30d,
                bwk_mcp.twitch_follower_summary,
                bwk_mcp.discord_member_trend,
                bwk_mcp.moderation_summary
TO bwk_mcp_reader;
COMMIT;
