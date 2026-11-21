"use strict";

/*
 * PostgreSQL compatibility layer for the Bot Control Center.
 *
 * The existing application historically uses synchronous JSON reads/writes.
 * Rewriting the entire application to async storage in one release would create
 * unnecessary regression risk. This bridge keeps the existing synchronous API
 * while a dedicated Worker owns a persistent node-postgres connection.
 *
 * Important: the main thread blocks only for the duration of a local DB query,
 * similar to the previous fs.*Sync calls. High-frequency Watchtime is handled
 * by dedicated relational operations and does not rewrite a JSON document.
 */

const fs = require("fs");
const path = require("path");
const { Worker, MessageChannel, isMainThread, parentPort, workerData } = require("worker_threads");

const SCHEMA_VERSION = 17;

function readPassword(config={}) {
  if (config.password) return String(config.password);
  const file = config.passwordFile || process.env.DB_PASSWORD_FILE || process.env.PGPASSWORD_FILE;
  if (file) {
    try { return fs.readFileSync(file,"utf8").trim(); }
    catch (e) { throw new Error(`PostgreSQL-Passwortdatei konnte nicht gelesen werden: ${e.message}`); }
  }
  return String(process.env.PGPASSWORD || "");
}

if (!isMainThread) {
  const { Client } = require("pg");
  let client = null;
  let cfg = workerData?.config || {};

  const safeJson = value => value === undefined ? null : value;
  const safeTimestamp = value => {
    const d=new Date(value||Date.now());
    return Number.isFinite(d.getTime())?d.toISOString():new Date().toISOString();
  };

  async function connect() {
    if (client) return client;
    client = new Client({
      host: cfg.host || "postgres",
      port: Number(cfg.port || 5432),
      database: cfg.database || "bwk",
      user: cfg.user || "bwk",
      password: cfg.password || "",
      application_name: cfg.applicationName || "bwk-control-center",
      connectionTimeoutMillis: Number(cfg.connectionTimeoutMillis || 5000),
      statement_timeout: Number(cfg.statementTimeoutMillis || 10000),
      query_timeout: Number(cfg.queryTimeoutMillis || 10000),
      keepAlive: true
    });
    await client.connect();
    const connectedClient=client;
    connectedClient.on("error", err => {
      // A broken pg Client cannot be reused. Do not retry the failed mutation
      // automatically (its commit state could be ambiguous); reconnect cleanly
      // on the next storage operation instead.
      process.stderr.write(`PostgreSQL worker connection error: ${err.message}\n`);
      if(client===connectedClient) client=null;
    });
    connectedClient.on("end", () => {
      if(client===connectedClient) client=null;
    });
    return connectedClient;
  }

  async function initSchema() {
    const c = await connect();
    await c.query("BEGIN");
    try {
      // Twitch- und Discord-Dienst können beim ersten Compose-Start fast
      // gleichzeitig initialisieren. Der transaktionale Advisory Lock verhindert
      // konkurrierende DDL-Migrationen.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('bwk-control-center-schema'))");
      await c.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version integer PRIMARY KEY,
          name text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS state_documents (
          namespace text NOT NULL,
          key text NOT NULL,
          value jsonb NOT NULL,
          revision bigint NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (namespace, key)
        );

        CREATE TABLE IF NOT EXISTS operation_events (
          id bigserial PRIMARY KEY,
          service text NOT NULL,
          stream text NOT NULL,
          event_ts timestamptz NOT NULL,
          actor text,
          action text,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS operation_events_stream_ts_idx
          ON operation_events(service, stream, event_ts DESC);
        CREATE INDEX IF NOT EXISTS operation_events_action_idx
          ON operation_events(action, event_ts DESC);

        CREATE TABLE IF NOT EXISTS eventsub_messages (
          message_id text PRIMARY KEY,
          subscription_type text,
          event_timestamp timestamptz,
          service text NOT NULL DEFAULT 'twitch',
          received_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS eventsub_messages_received_idx
          ON eventsub_messages(received_at DESC);

        CREATE TABLE IF NOT EXISTS twitch_watchtime (
          twitch_user_id text PRIMARY KEY,
          login text NOT NULL DEFAULT '',
          display_name text NOT NULL DEFAULT '',
          seconds bigint NOT NULL DEFAULT 0 CHECK (seconds >= 0),
          last_seen_at timestamptz,
          corrected_at timestamptz,
          corrected_by text,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS twitch_watchtime_seconds_idx
          ON twitch_watchtime(seconds DESC);
        CREATE INDEX IF NOT EXISTS twitch_watchtime_last_seen_idx
          ON twitch_watchtime(last_seen_at DESC NULLS LAST);
        CREATE INDEX IF NOT EXISTS twitch_watchtime_name_idx
          ON twitch_watchtime(lower(display_name), lower(login));

        CREATE TABLE IF NOT EXISTS twitch_follower_cache_meta (
          namespace text PRIMARY KEY,
          total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
          revision bigint NOT NULL DEFAULT 1,
          updated_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS twitch_followers (
          namespace text NOT NULL,
          twitch_user_id text NOT NULL,
          login text NOT NULL DEFAULT '',
          display_name text NOT NULL DEFAULT '',
          followed_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,twitch_user_id)
        );
        CREATE INDEX IF NOT EXISTS twitch_followers_followed_idx
          ON twitch_followers(namespace,followed_at DESC NULLS LAST,twitch_user_id);
        CREATE INDEX IF NOT EXISTS twitch_followers_name_idx
          ON twitch_followers(namespace,lower(display_name),lower(login));

        CREATE TABLE IF NOT EXISTS twitch_message_count_meta (
          namespace text NOT NULL,
          channel_id text NOT NULL,
          tracking_started_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,channel_id)
        );

        CREATE TABLE IF NOT EXISTS twitch_message_counts (
          namespace text NOT NULL,
          channel_id text NOT NULL,
          twitch_user_id text NOT NULL,
          login text NOT NULL DEFAULT '',
          display_name text NOT NULL DEFAULT '',
          total bigint NOT NULL DEFAULT 0 CHECK(total >= 0),
          first_counted_at timestamptz NOT NULL DEFAULT now(),
          last_counted_at timestamptz NOT NULL DEFAULT now(),
          last_message_id text,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,channel_id,twitch_user_id)
        );
        CREATE INDEX IF NOT EXISTS twitch_message_counts_total_idx
          ON twitch_message_counts(namespace,channel_id,total DESC,twitch_user_id);
        CREATE INDEX IF NOT EXISTS twitch_message_counts_name_idx
          ON twitch_message_counts(namespace,channel_id,lower(display_name),lower(login));

        CREATE TABLE IF NOT EXISTS twitch_message_count_daily (
          namespace text NOT NULL,
          channel_id text NOT NULL,
          twitch_user_id text NOT NULL,
          day date NOT NULL,
          total bigint NOT NULL DEFAULT 0 CHECK(total >= 0),
          PRIMARY KEY(namespace,channel_id,twitch_user_id,day)
        );
        CREATE INDEX IF NOT EXISTS twitch_message_count_daily_window_idx
          ON twitch_message_count_daily(namespace,channel_id,day,twitch_user_id);

        CREATE TABLE IF NOT EXISTS twitch_message_count_batches (
          namespace text NOT NULL,
          channel_id text NOT NULL,
          batch_id text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,channel_id,batch_id)
        );

        CREATE TABLE IF NOT EXISTS spind_meta (
          namespace text PRIMARY KEY,
          config jsonb NOT NULL DEFAULT '{}'::jsonb,
          active_round_id text,
          next_round_allowed_at timestamptz,
          reset_generation bigint NOT NULL DEFAULT 0,
          last_reset jsonb,
          revision bigint NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS spind_accounts (
          namespace text NOT NULL,
          twitch_user_id text NOT NULL,
          login text NOT NULL DEFAULT '',
          display_name text NOT NULL DEFAULT '',
          balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
          reserved bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
          starter_granted boolean NOT NULL DEFAULT false,
          last_daily_date date,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,twitch_user_id)
        );
        CREATE INDEX IF NOT EXISTS spind_accounts_balance_idx
          ON spind_accounts(namespace,(balance+reserved) DESC);
        CREATE INDEX IF NOT EXISTS spind_accounts_login_idx
          ON spind_accounts(namespace,lower(login));

        CREATE TABLE IF NOT EXISTS spind_rounds (
          namespace text NOT NULL,
          round_id text NOT NULL,
          generation bigint NOT NULL DEFAULT 0,
          status text NOT NULL,
          created_at timestamptz NOT NULL,
          join_ends_at timestamptz,
          control_started_at timestamptz,
          control_ends_at timestamptz,
          ended_at timestamptz,
          cooldown_ends_at timestamptz,
          overlay_hide_at timestamptz,
          factor numeric(10,4) NOT NULL DEFAULT 1,
          mode text,
          overlay_phrase text NOT NULL DEFAULT '',
          abort_reason text,
          invalidated_by_reset boolean NOT NULL DEFAULT false,
          PRIMARY KEY(namespace,round_id)
        );
        CREATE INDEX IF NOT EXISTS spind_rounds_created_idx
          ON spind_rounds(namespace,created_at DESC);

        CREATE TABLE IF NOT EXISTS spind_round_participants (
          namespace text NOT NULL,
          round_id text NOT NULL,
          twitch_user_id text NOT NULL,
          login text NOT NULL DEFAULT '',
          display_name text NOT NULL DEFAULT '',
          bet bigint NOT NULL CHECK (bet >= 0),
          joined_at timestamptz,
          outcome text,
          payout bigint NOT NULL DEFAULT 0,
          delta bigint NOT NULL DEFAULT 0,
          admin_refunded_at timestamptz,
          refunded_at timestamptz,
          PRIMARY KEY(namespace,round_id,twitch_user_id),
          FOREIGN KEY(namespace,round_id) REFERENCES spind_rounds(namespace,round_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS spind_transactions (
          namespace text NOT NULL,
          transaction_id text NOT NULL,
          event_ts timestamptz NOT NULL,
          type text NOT NULL,
          user_id text,
          other_user_id text,
          amount bigint NOT NULL DEFAULT 0,
          round_id text,
          note text NOT NULL DEFAULT '',
          actor text,
          meta jsonb,
          PRIMARY KEY(namespace,transaction_id)
        );
        CREATE INDEX IF NOT EXISTS spind_transactions_ts_idx
          ON spind_transactions(namespace,event_ts DESC);
        CREATE INDEX IF NOT EXISTS spind_transactions_user_idx
          ON spind_transactions(namespace,user_id,event_ts DESC);


        CREATE TABLE IF NOT EXISTS followathon_meta (
          namespace text PRIMARY KEY,
          current_event_id text,
          config jsonb NOT NULL DEFAULT '{}'::jsonb,
          revision bigint NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS followathon_events (
          namespace text NOT NULL,
          event_id text NOT NULL,
          name text NOT NULL,
          created_at timestamptz NOT NULL,
          created_by text,
          status text NOT NULL,
          start_duration_seconds bigint NOT NULL DEFAULT 0,
          seconds_per_follow bigint NOT NULL DEFAULT 60,
          max_remaining_seconds bigint,
          hard_end_at timestamptz,
          credit_acceptance boolean NOT NULL DEFAULT false,
          follow_count bigint NOT NULL DEFAULT 0,
          credited_seconds bigint NOT NULL DEFAULT 0,
          reversed_seconds bigint NOT NULL DEFAULT 0,
          started_at timestamptz,
          paused_at timestamptz,
          resumed_at timestamptz,
          ended_at timestamptz,
          end_reason text,
          countdown_end_at timestamptz,
          paused_remaining_seconds bigint,
          anomaly jsonb NOT NULL DEFAULT '{}'::jsonb,
          overlay jsonb NOT NULL DEFAULT '{}'::jsonb,
          last_public_credit jsonb,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,event_id)
        );
        CREATE INDEX IF NOT EXISTS followathon_events_created_idx
          ON followathon_events(namespace,created_at DESC);
        CREATE INDEX IF NOT EXISTS followathon_events_status_idx
          ON followathon_events(namespace,status);

        CREATE TABLE IF NOT EXISTS followathon_acceptance_periods (
          namespace text NOT NULL,
          event_id text NOT NULL,
          period_no integer NOT NULL,
          start_at timestamptz NOT NULL,
          end_at timestamptz,
          PRIMARY KEY(namespace,event_id,period_no),
          FOREIGN KEY(namespace,event_id) REFERENCES followathon_events(namespace,event_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS followathon_users (
          namespace text NOT NULL,
          event_id text NOT NULL,
          twitch_user_id text NOT NULL,
          user_name text NOT NULL DEFAULT '',
          followed_at timestamptz,
          message_id text,
          decision text,
          held_id text,
          credited_seconds bigint NOT NULL DEFAULT 0,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,event_id,twitch_user_id),
          FOREIGN KEY(namespace,event_id) REFERENCES followathon_events(namespace,event_id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS followathon_users_event_message_uidx
          ON followathon_users(namespace,event_id,message_id) WHERE message_id IS NOT NULL AND message_id <> '';

        CREATE TABLE IF NOT EXISTS followathon_held (
          namespace text NOT NULL,
          event_id text NOT NULL,
          held_id text NOT NULL,
          status text NOT NULL,
          created_at timestamptz NOT NULL,
          twitch_user_id text,
          user_name text NOT NULL DEFAULT '',
          message_id text,
          followed_at timestamptz,
          requested_seconds bigint NOT NULL DEFAULT 0,
          reason text NOT NULL DEFAULT '',
          reviewed_at timestamptz,
          reviewed_by text,
          credited_seconds bigint,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,held_id),
          FOREIGN KEY(namespace,event_id) REFERENCES followathon_events(namespace,event_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS followathon_held_event_status_idx
          ON followathon_held(namespace,event_id,status,created_at DESC);

        CREATE TABLE IF NOT EXISTS followathon_logs (
          namespace text NOT NULL,
          event_id text NOT NULL,
          log_id text NOT NULL,
          event_ts timestamptz NOT NULL,
          source text,
          decision text,
          twitch_user_id text,
          user_name text NOT NULL DEFAULT '',
          message_id text,
          followed_at timestamptz,
          requested_seconds bigint,
          credited_seconds bigint,
          timer_adjusted_seconds bigint,
          reason text NOT NULL DEFAULT '',
          actor text,
          retracted_at timestamptz,
          retracted_by text,
          retraction_applied_seconds bigint,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,log_id),
          FOREIGN KEY(namespace,event_id) REFERENCES followathon_events(namespace,event_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS followathon_logs_event_ts_idx
          ON followathon_logs(namespace,event_id,event_ts DESC);
        CREATE INDEX IF NOT EXISTS followathon_logs_followed_idx
          ON followathon_logs(namespace,event_id,followed_at DESC NULLS LAST);

        CREATE TABLE IF NOT EXISTS followathon_seen_messages (
          namespace text NOT NULL,
          message_id text NOT NULL,
          seen_at timestamptz NOT NULL,
          PRIMARY KEY(namespace,message_id)
        );
        CREATE INDEX IF NOT EXISTS followathon_seen_messages_seen_idx
          ON followathon_seen_messages(namespace,seen_at DESC);

        CREATE TABLE IF NOT EXISTS giveaway_meta (
          namespace text PRIMARY KEY,
          current_giveaway_id text,
          revision bigint NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS giveaways (
          namespace text NOT NULL,
          giveaway_id text NOT NULL,
          type text NOT NULL CHECK (type IN ('random','keyword')),
          keyword text NOT NULL DEFAULT '',
          title text NOT NULL DEFAULT '',
          active boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL,
          created_by text,
          started_at timestamptz,
          ended_at timestamptz,
          archived boolean NOT NULL DEFAULT false,
          exclude_moderators boolean NOT NULL DEFAULT true,
          exclude_broadcaster boolean NOT NULL DEFAULT true,
          exclude_vips boolean NOT NULL DEFAULT false,
          updated_at timestamptz NOT NULL DEFAULT now(),
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,giveaway_id)
        );
        CREATE INDEX IF NOT EXISTS giveaways_created_idx
          ON giveaways(namespace,created_at DESC);
        CREATE INDEX IF NOT EXISTS giveaways_ended_idx
          ON giveaways(namespace,ended_at DESC NULLS LAST);

        CREATE TABLE IF NOT EXISTS giveaway_entries (
          namespace text NOT NULL,
          giveaway_id text NOT NULL,
          twitch_user_id text NOT NULL,
          login text NOT NULL DEFAULT '',
          display_name text NOT NULL DEFAULT '',
          is_moderator boolean NOT NULL DEFAULT false,
          is_vip boolean NOT NULL DEFAULT false,
          badges jsonb NOT NULL DEFAULT '[]'::jsonb,
          joined_at timestamptz NOT NULL DEFAULT now(),
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,giveaway_id,twitch_user_id),
          FOREIGN KEY(namespace,giveaway_id) REFERENCES giveaways(namespace,giveaway_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS giveaway_entries_joined_idx
          ON giveaway_entries(namespace,giveaway_id,joined_at,twitch_user_id);

        CREATE TABLE IF NOT EXISTS giveaway_draws (
          namespace text NOT NULL,
          giveaway_id text NOT NULL,
          draw_no integer NOT NULL CHECK (draw_no > 0),
          winner_user_id text NOT NULL,
          login text NOT NULL DEFAULT '',
          display_name text NOT NULL DEFAULT '',
          is_moderator boolean NOT NULL DEFAULT false,
          is_vip boolean NOT NULL DEFAULT false,
          badges jsonb NOT NULL DEFAULT '[]'::jsonb,
          joined_at timestamptz,
          drawn_at timestamptz NOT NULL DEFAULT now(),
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,giveaway_id,draw_no),
          UNIQUE(namespace,giveaway_id,winner_user_id),
          FOREIGN KEY(namespace,giveaway_id) REFERENCES giveaways(namespace,giveaway_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS giveaway_draws_winner_idx
          ON giveaway_draws(namespace,winner_user_id,drawn_at DESC);

        CREATE TABLE IF NOT EXISTS discord_moderation_meta (
          namespace text PRIMARY KEY,
          last_action_at timestamptz,
          last_error text,
          revision bigint NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS discord_moderation_users (
          namespace text NOT NULL,
          discord_user_id text NOT NULL,
          username text,
          timeout_stage integer NOT NULL DEFAULT 0 CHECK (timeout_stage >= 0 AND timeout_stage <= 3),
          timeout_count integer NOT NULL DEFAULT 0 CHECK (timeout_count >= 0),
          first_violation_at timestamptz,
          last_violation_at timestamptz,
          last_timeout_at timestamptz,
          banned_at timestamptz,
          unbanned_at timestamptz,
          ban_reason text,
          last_rule_name text,
          last_matched_term text,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,discord_user_id)
        );
        CREATE INDEX IF NOT EXISTS discord_moderation_users_activity_idx
          ON discord_moderation_users(namespace,last_violation_at DESC NULLS LAST,last_timeout_at DESC NULLS LAST);
        CREATE INDEX IF NOT EXISTS discord_moderation_users_name_idx
          ON discord_moderation_users(namespace,lower(username));

        CREATE TABLE IF NOT EXISTS discord_moderation_recent (
          id bigserial PRIMARY KEY,
          namespace text NOT NULL,
          discord_user_id text NOT NULL,
          rule_id text NOT NULL,
          event_ms bigint NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS discord_moderation_recent_lookup_idx
          ON discord_moderation_recent(namespace,discord_user_id,rule_id,event_ms DESC);

        CREATE TABLE IF NOT EXISTS control_users_meta (
          namespace text PRIMARY KEY,
          revision bigint NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS control_users (
          namespace text NOT NULL,
          internal_user_id text NOT NULL,
          twitch_user_id text,
          twitch_login text,
          display_name text,
          twitch_role text NOT NULL DEFAULT 'viewer',
          twitch_enabled boolean NOT NULL DEFAULT false,
          discord_user_id text,
          discord_username text,
          discord_display_name text,
          discord_avatar text,
          discord_backend_enabled boolean NOT NULL DEFAULT false,
          discord_role text NOT NULL DEFAULT 'viewer',
          capabilities_customized boolean NOT NULL DEFAULT false,
          global_owner boolean NOT NULL DEFAULT false,
          global_admin boolean NOT NULL DEFAULT false,
          created_at timestamptz,
          created_by text,
          updated_at timestamptz,
          updated_by text,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,internal_user_id),
          UNIQUE(namespace,twitch_user_id),
          UNIQUE(namespace,discord_user_id),
          CHECK (NOT (global_owner AND global_admin))
        );
        CREATE INDEX IF NOT EXISTS control_users_twitch_login_idx ON control_users(namespace,lower(twitch_login));
        CREATE INDEX IF NOT EXISTS control_users_discord_name_idx ON control_users(namespace,lower(discord_username));

        CREATE TABLE IF NOT EXISTS control_user_capabilities (
          namespace text NOT NULL,
          internal_user_id text NOT NULL,
          capability text NOT NULL,
          PRIMARY KEY(namespace,internal_user_id,capability),
          FOREIGN KEY(namespace,internal_user_id) REFERENCES control_users(namespace,internal_user_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS control_user_capabilities_cap_idx ON control_user_capabilities(namespace,capability);

        CREATE TABLE IF NOT EXISTS control_sessions (
          namespace text NOT NULL,
          session_id text NOT NULL,
          auth_provider text,
          internal_user_id text,
          twitch_user_id text,
          discord_user_id text,
          created_at timestamptz NOT NULL,
          expires_at timestamptz NOT NULL,
          security_revision integer NOT NULL DEFAULT 0,
          local_admin boolean NOT NULL DEFAULT false,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,session_id)
        );
        CREATE INDEX IF NOT EXISTS control_sessions_expiry_idx ON control_sessions(namespace,expires_at);
        CREATE INDEX IF NOT EXISTS control_sessions_twitch_idx ON control_sessions(namespace,twitch_user_id) WHERE twitch_user_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS control_sessions_discord_idx ON control_sessions(namespace,discord_user_id) WHERE discord_user_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS control_sessions_internal_idx ON control_sessions(namespace,internal_user_id) WHERE internal_user_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS discord_onboarding_meta (
          namespace text PRIMARY KEY,
          total_welcomed bigint NOT NULL DEFAULT 0,
          total_verified bigint NOT NULL DEFAULT 0,
          bypass_prevented bigint NOT NULL DEFAULT 0,
          last_action_at timestamptz,
          last_error text,
          revision bigint NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS discord_onboarding_members (
          namespace text NOT NULL, discord_user_id text NOT NULL, joined_at timestamptz, first_seen_at timestamptz, welcomed_at timestamptz, verified_at timestamptz, left_at timestamptz, verified_message_id text, verified_emoji text, bypass_prevented_at timestamptz, last_error text, extra jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(namespace,discord_user_id)
        );
        CREATE INDEX IF NOT EXISTS discord_onboarding_members_verified_idx ON discord_onboarding_members(namespace,verified_at DESC NULLS LAST);
        CREATE INDEX IF NOT EXISTS discord_onboarding_members_joined_idx ON discord_onboarding_members(namespace,joined_at DESC NULLS LAST);
        CREATE TABLE IF NOT EXISTS discord_reports_meta (
          namespace text PRIMARY KEY, sequence_by_year jsonb NOT NULL DEFAULT '{}'::jsonb, last_created_at timestamptz, last_error text, commands_registered_at timestamptz, revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS discord_report_cooldowns (namespace text NOT NULL, discord_user_id text NOT NULL, last_report_at timestamptz NOT NULL, PRIMARY KEY(namespace,discord_user_id));
        CREATE INDEX IF NOT EXISTS discord_report_cooldowns_ts_idx ON discord_report_cooldowns(namespace,last_report_at DESC);
        CREATE TABLE IF NOT EXISTS discord_reports (
          namespace text NOT NULL, ticket_id text NOT NULL, status text NOT NULL CHECK (status IN ('open','resolved','rejected')), created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, reason text NOT NULL DEFAULT 'sonstiges', reason_label text NOT NULL DEFAULT 'Sonstiges', description text NOT NULL DEFAULT '', reporter jsonb NOT NULL DEFAULT '{}'::jsonb, target_user jsonb, source jsonb NOT NULL DEFAULT '{}'::jsonb, closed_at timestamptz, closed_by jsonb, closing_note text, extra jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY(namespace,ticket_id)
        );
        CREATE INDEX IF NOT EXISTS discord_reports_status_created_idx ON discord_reports(namespace,status,created_at DESC);
        CREATE INDEX IF NOT EXISTS discord_reports_reason_idx ON discord_reports(namespace,reason,created_at DESC);
        CREATE TABLE IF NOT EXISTS discord_report_actions (
          namespace text NOT NULL, ticket_id text NOT NULL, action_id text NOT NULL, action_no integer NOT NULL CHECK (action_no > 0), type text NOT NULL, action_at timestamptz NOT NULL, actor jsonb, detail jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY(namespace,ticket_id,action_id), UNIQUE(namespace,ticket_id,action_no), FOREIGN KEY(namespace,ticket_id) REFERENCES discord_reports(namespace,ticket_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS discord_report_actions_ts_idx ON discord_report_actions(namespace,action_at DESC);

        CREATE TABLE IF NOT EXISTS discord_social_meta (
          namespace text PRIMARY KEY,
          last_poll_at timestamptz,
          next_poll_at timestamptz,
          revision bigint NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS discord_social_platforms (
          namespace text NOT NULL,
          platform text NOT NULL CHECK (platform IN ('instagram','tiktok')),
          initialized boolean NOT NULL DEFAULT false,
          last_check_at timestamptz,
          last_success_at timestamptz,
          last_detected_at timestamptz,
          last_discord_at timestamptz,
          last_error text,
          profile jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,platform)
        );
        CREATE TABLE IF NOT EXISTS discord_social_seen (
          namespace text NOT NULL,
          platform text NOT NULL CHECK (platform IN ('instagram','tiktok')),
          external_id text NOT NULL,
          status text NOT NULL DEFAULT 'seen',
          seen_at timestamptz,
          seen_at_ms bigint,
          discord_message_id text,
          error text,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,platform,external_id)
        );
        CREATE INDEX IF NOT EXISTS discord_social_seen_recent_idx ON discord_social_seen(namespace,platform,seen_at DESC NULLS LAST);
        CREATE TABLE IF NOT EXISTS discord_social_history (
          namespace text NOT NULL,
          platform text NOT NULL CHECK (platform IN ('instagram','tiktok')),
          external_id text NOT NULL,
          history_key text NOT NULL,
          media_type text,
          title text,
          caption text,
          url text,
          thumbnail_url text,
          published_at timestamptz,
          detected_at timestamptz,
          status text NOT NULL,
          error text,
          attempts integer NOT NULL DEFAULT 0,
          discord_channel_id text,
          discord_message_id text,
          sent_at timestamptz,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,platform,external_id),
          UNIQUE(namespace,history_key)
        );
        CREATE INDEX IF NOT EXISTS discord_social_history_status_idx ON discord_social_history(namespace,status,detected_at DESC NULLS LAST);
        CREATE INDEX IF NOT EXISTS discord_social_history_platform_idx ON discord_social_history(namespace,platform,published_at DESC NULLS LAST);

        CREATE TABLE IF NOT EXISTS discord_channel_times_meta (
          namespace text PRIMARY KEY,
          last_run_at timestamptz,
          last_error text,
          warning_state jsonb NOT NULL DEFAULT '{}'::jsonb,
          revision bigint NOT NULL DEFAULT 1,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE discord_channel_times_meta
          ADD COLUMN IF NOT EXISTS warning_state jsonb NOT NULL DEFAULT '{}'::jsonb;
        CREATE TABLE IF NOT EXISTS discord_channel_times_active (
          namespace text NOT NULL,
          profile_id text NOT NULL,
          channel_id text,
          closed_at timestamptz,
          source text,
          roles jsonb NOT NULL DEFAULT '[]'::jsonb,
          snapshots jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,profile_id)
        );
        CREATE TABLE IF NOT EXISTS discord_channel_times_overrides (
          namespace text NOT NULL,
          profile_id text NOT NULL,
          state text NOT NULL,
          set_at timestamptz,
          until_at timestamptz,
          PRIMARY KEY(namespace,profile_id)
        );
        CREATE TABLE IF NOT EXISTS discord_channel_times_events (
          namespace text NOT NULL,
          event_id bigserial,
          event_ts timestamptz NOT NULL,
          type text NOT NULL,
          profile_id text,
          channel_id text,
          channel_name text,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,event_id)
        );
        CREATE INDEX IF NOT EXISTS discord_channel_times_events_ts_idx
          ON discord_channel_times_events(namespace,event_ts DESC);

        CREATE TABLE IF NOT EXISTS discord_emergency_meta (
          namespace text PRIMARY KEY,
          active boolean NOT NULL DEFAULT false,
          level text,
          reason text,
          actor text,
          started_at timestamptz,
          ends_at timestamptz,
          affected jsonb NOT NULL DEFAULT '{"text":[],"voice":[]}'::jsonb,
          last_error text,
          revision bigint NOT NULL DEFAULT 1,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS discord_emergency_snapshots (
          namespace text NOT NULL,
          snapshot_key text NOT NULL,
          channel_id text,
          role_id text,
          snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,snapshot_key)
        );
        CREATE TABLE IF NOT EXISTS discord_emergency_history (
          namespace text NOT NULL,
          history_id bigserial,
          event_ts timestamptz NOT NULL,
          type text NOT NULL,
          level text,
          actor text,
          reason text,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,history_id)
        );
        CREATE INDEX IF NOT EXISTS discord_emergency_history_ts_idx
          ON discord_emergency_history(namespace,event_ts DESC);



        CREATE TABLE IF NOT EXISTS discord_announcements_meta (
          namespace text PRIMARY KEY,
          last_live_at timestamptz,
          last_clip_at timestamptz,
          last_error text,
          revision bigint NOT NULL DEFAULT 1,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS discord_announcement_items (
          namespace text NOT NULL,
          type text NOT NULL CHECK (type IN ('live','clip')),
          item_key text NOT NULL,
          sent_at timestamptz,
          url text,
          title text,
          extra jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(namespace,type,item_key)
        );
        CREATE INDEX IF NOT EXISTS discord_announcement_items_sent_idx ON discord_announcement_items(namespace,type,sent_at DESC NULLS LAST);

        CREATE TABLE IF NOT EXISTS discord_bridge_meta (
          namespace text PRIMARY KEY,
          last_delivered_at timestamptz,
          last_error text,
          revision bigint NOT NULL DEFAULT 1,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS discord_bridge_queue (
          namespace text NOT NULL,
          queue_id text NOT NULL,
          type text NOT NULL,
          item_key text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL,
          attempts integer NOT NULL DEFAULT 0,
          last_error text,
          PRIMARY KEY(namespace,queue_id),
          UNIQUE(namespace,type,item_key)
        );
        CREATE INDEX IF NOT EXISTS discord_bridge_queue_created_idx ON discord_bridge_queue(namespace,created_at,queue_id);

        CREATE TABLE IF NOT EXISTS twitch_clip_meta (
          namespace text PRIMARY KEY,
          initialized boolean NOT NULL DEFAULT false,
          last_checked_at timestamptz,
          last_shared jsonb,
          last_error text,
          revision bigint NOT NULL DEFAULT 1,
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS twitch_clips (
          namespace text NOT NULL,
          clip_id text NOT NULL,
          created_at timestamptz,
          title text NOT NULL DEFAULT '',
          url text NOT NULL DEFAULT '',
          creator_name text NOT NULL DEFAULT '',
          first_seen_at timestamptz NOT NULL DEFAULT now(),
          shared_at timestamptz,
          share_status text NOT NULL DEFAULT 'seen',
          last_error text,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,clip_id)
        );
        CREATE INDEX IF NOT EXISTS twitch_clips_created_idx
          ON twitch_clips(namespace,created_at DESC NULLS LAST,clip_id);
        CREATE INDEX IF NOT EXISTS twitch_clips_shared_idx
          ON twitch_clips(namespace,shared_at DESC NULLS LAST) WHERE shared_at IS NOT NULL;

        CREATE TABLE IF NOT EXISTS twitch_usage_stats (
          namespace text NOT NULL,
          kind text NOT NULL CHECK (kind IN ('commands','autoReplies')),
          item_id text NOT NULL,
          total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
          today_date date,
          today_count bigint NOT NULL DEFAULT 0 CHECK (today_count >= 0),
          stream_id text,
          stream_count bigint NOT NULL DEFAULT 0 CHECK (stream_count >= 0),
          last_triggered_at timestamptz,
          last_user text,
          last_input text,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,kind,item_id)
        );
        CREATE INDEX IF NOT EXISTS twitch_usage_stats_total_idx
          ON twitch_usage_stats(namespace,kind,total DESC,item_id);
        CREATE INDEX IF NOT EXISTS twitch_usage_stats_last_idx
          ON twitch_usage_stats(namespace,last_triggered_at DESC NULLS LAST);

        CREATE TABLE IF NOT EXISTS discord_analytics_snapshots (
          namespace text NOT NULL,
          snapshot_date date NOT NULL,
          member_count bigint NOT NULL CHECK (member_count >= 0),
          captured_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(namespace,snapshot_date)
        );
        CREATE INDEX IF NOT EXISTS discord_analytics_snapshots_date_idx
          ON discord_analytics_snapshots(namespace,snapshot_date DESC);



        CREATE TABLE IF NOT EXISTS word_filter_meta (
          id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
          revision bigint NOT NULL DEFAULT 1,
          retention_days integer NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 1 AND 3650),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO word_filter_meta(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

        CREATE TABLE IF NOT EXISTS word_filter_categories (
          category_id text PRIMARY KEY,
          name text NOT NULL,
          sort_order integer NOT NULL DEFAULT 100,
          builtin boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS word_filter_terms (
          term_id text PRIMARY KEY,
          term text NOT NULL,
          normalized_term text NOT NULL,
          category_id text NOT NULL REFERENCES word_filter_categories(category_id),
          severity integer NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 5),
          origin text NOT NULL DEFAULT 'manual',
          source_name text,
          source_version text,
          detection_type text NOT NULL DEFAULT 'whole_word' CHECK (detection_type IN ('whole_word','phrase','substring','regex')),
          enabled boolean NOT NULL DEFAULT true,
          test_only boolean NOT NULL DEFAULT false,
          leetspeak boolean NOT NULL DEFAULT false,
          repeat_letters boolean NOT NULL DEFAULT false,
          flex_separators boolean NOT NULL DEFAULT false,
          umlauts boolean NOT NULL DEFAULT true,
          import_id text,
          created_by text,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS word_filter_terms_norm_type_uq
          ON word_filter_terms(normalized_term,detection_type);
        CREATE INDEX IF NOT EXISTS word_filter_terms_category_idx
          ON word_filter_terms(category_id,enabled,severity DESC);

        CREATE TABLE IF NOT EXISTS word_filter_platform_rules (
          term_id text NOT NULL REFERENCES word_filter_terms(term_id) ON DELETE CASCADE,
          platform text NOT NULL CHECK (platform IN ('twitch','discord')),
          enabled boolean NOT NULL DEFAULT true,
          action text,
          timeout_seconds integer,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(term_id,platform)
        );

        CREATE TABLE IF NOT EXISTS word_filter_category_policies (
          category_id text NOT NULL REFERENCES word_filter_categories(category_id) ON DELETE CASCADE,
          platform text NOT NULL CHECK (platform IN ('twitch','discord')),
          action text NOT NULL DEFAULT 'log' CHECK (action IN ('allow','log','notify','delete','warn','timeout')),
          timeout_seconds integer,
          escalate boolean NOT NULL DEFAULT false,
          message_template text,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(category_id,platform)
        );

        CREATE TABLE IF NOT EXISTS word_filter_allowlist (
          allow_id text PRIMARY KEY,
          value text NOT NULL,
          normalized_value text NOT NULL,
          platform text NOT NULL DEFAULT 'both' CHECK (platform IN ('both','twitch','discord')),
          match_type text NOT NULL DEFAULT 'phrase' CHECK (match_type IN ('phrase','whole_word')),
          enabled boolean NOT NULL DEFAULT true,
          note text,
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS word_filter_allowlist_uq
          ON word_filter_allowlist(normalized_value,platform,match_type);

        CREATE TABLE IF NOT EXISTS word_filter_imports (
          import_id text PRIMARY KEY,
          source_name text NOT NULL,
          source_license text,
          filename text,
          format text,
          row_count integer NOT NULL DEFAULT 0,
          inserted_count integer NOT NULL DEFAULT 0,
          duplicate_count integer NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'applied',
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now(),
          rolled_back_at timestamptz
        );

        CREATE TABLE IF NOT EXISTS word_filter_import_items (
          import_id text NOT NULL REFERENCES word_filter_imports(import_id) ON DELETE CASCADE,
          term_id text NOT NULL,
          was_inserted boolean NOT NULL DEFAULT false,
          PRIMARY KEY(import_id,term_id)
        );

        CREATE TABLE IF NOT EXISTS word_filter_hits (
          hit_id bigserial PRIMARY KEY,
          term_id text REFERENCES word_filter_terms(term_id) ON DELETE SET NULL,
          platform text NOT NULL CHECK (platform IN ('twitch','discord')),
          category_id text,
          action text,
          user_id text,
          occurred_at timestamptz NOT NULL DEFAULT now(),
          false_positive boolean NOT NULL DEFAULT false
        );
        CREATE INDEX IF NOT EXISTS word_filter_hits_term_ts_idx
          ON word_filter_hits(term_id,occurred_at DESC);
        CREATE INDEX IF NOT EXISTS word_filter_hits_platform_ts_idx
          ON word_filter_hits(platform,occurred_at DESC);

        CREATE TABLE IF NOT EXISTS import_ledger (
          service text NOT NULL,
          source_key text NOT NULL,
          source_sha256 text,
          imported_at timestamptz NOT NULL DEFAULT now(),
          details jsonb NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(service, source_key)
        );
      `);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(1,'initial-postgresql-storage') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(2,'relational-spindpunkte') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(3,'relational-followathon') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(4,'relational-giveaways') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(5,'relational-discord-moderation-state') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(6,'relational-control-users-sessions') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(7,'relational-discord-onboarding-reports') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(8,'relational-discord-social-state-history') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(9,'relational-discord-channel-times-emergency') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(10,'relational-discord-announcements-bridge') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(11,'relational-twitch-follower-cache') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(12,'relational-twitch-clip-state') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(13,'relational-usage-stats-discord-analytics') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(14,'central-cross-platform-word-filter') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(15,'twitch-message-counts') ON CONFLICT(version) DO NOTHING`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(16,'discord-channel-times-warning-notices') ON CONFLICT(version) DO NOTHING`);
      await c.query(`ALTER TABLE word_filter_category_policies ADD COLUMN IF NOT EXISTS message_template text`);
      await c.query(`INSERT INTO schema_migrations(version,name) VALUES(17,'word-filter-diagnostics-notification-texts') ON CONFLICT(version) DO NOTHING`);
      await c.query(`
        INSERT INTO word_filter_categories(category_id,name,sort_order,builtin) VALUES
          ('umgangssprache','Umgangssprache',10,true),
          ('beleidigungen','Beleidigungen',20,true),
          ('schwere-beleidigungen','Schwere Beleidigungen',30,true),
          ('diskriminierung-hassrede','Diskriminierung / Hassrede',40,true),
          ('extremismus','Extremismus',50,true),
          ('drohungen','Drohungen',60,true),
          ('benutzerdefiniert','Benutzerdefiniert',70,true)
        ON CONFLICT(category_id) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order;
        INSERT INTO word_filter_category_policies(category_id,platform,action,timeout_seconds,escalate)
        SELECT c.category_id,p.platform,
          CASE c.category_id
            WHEN 'umgangssprache' THEN 'log'
            WHEN 'beleidigungen' THEN CASE WHEN p.platform='discord' THEN 'warn' ELSE 'delete' END
            WHEN 'schwere-beleidigungen' THEN 'timeout'
            WHEN 'diskriminierung-hassrede' THEN 'notify'
            WHEN 'extremismus' THEN 'notify'
            WHEN 'drohungen' THEN 'notify'
            ELSE 'log'
          END,
          CASE WHEN c.category_id='schwere-beleidigungen' THEN 600 ELSE NULL END,
          c.category_id IN ('beleidigungen','schwere-beleidigungen')
        FROM word_filter_categories c CROSS JOIN (VALUES('twitch'),('discord')) p(platform)
        ON CONFLICT(category_id,platform) DO NOTHING;
      `);
      await c.query("COMMIT");
      return {ok:true,schemaVersion:SCHEMA_VERSION};
    } catch (e) {
      await c.query("ROLLBACK").catch(()=>{});
      throw e;
    }
  }

  function pgIso(v){
    if(!v)return null;
    const d=new Date(v);
    return Number.isFinite(d.getTime())?d.toISOString():null;
  }

  function pgDateOnly(v){
    if(!v)return null;
    if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);
    const raw=String(v).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
    const d=new Date(v);
    return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;
  }

  function spindCleanState(state={}){
    const s=state&&typeof state==="object"&&!Array.isArray(state)?state:{};
    return {
      schemaVersion:Number(s.schemaVersion||1),
      config:s.config&&typeof s.config==="object"?s.config:{},
      accounts:s.accounts&&typeof s.accounts==="object"&&!Array.isArray(s.accounts)?s.accounts:{},
      rounds:Array.isArray(s.rounds)?s.rounds:[],
      transactions:Array.isArray(s.transactions)?s.transactions:[],
      activeRound:s.activeRound||null,
      nextRoundAllowedAt:s.nextRoundAllowedAt||null,
      resetGeneration:Number(s.resetGeneration||0),
      lastReset:s.lastReset||null,
      updatedAt:s.updatedAt||new Date().toISOString()
    };
  }

  async function spindLoad(c,namespace){
    const meta=await c.query(`SELECT config,active_round_id,next_round_allowed_at,reset_generation,last_reset,revision,updated_at FROM spind_meta WHERE namespace=$1`,[namespace]);
    if(!meta.rowCount)return {found:false};
    const accounts=await c.query(`SELECT twitch_user_id,login,display_name,balance::bigint AS balance,reserved::bigint AS reserved,starter_granted,to_char(last_daily_date,'YYYY-MM-DD') AS last_daily_date,created_at,updated_at FROM spind_accounts WHERE namespace=$1 ORDER BY twitch_user_id`,[namespace]);
    const rounds=await c.query(`SELECT round_id,generation,status,created_at,join_ends_at,control_started_at,control_ends_at,ended_at,cooldown_ends_at,overlay_hide_at,factor,mode,overlay_phrase,abort_reason,invalidated_by_reset FROM spind_rounds WHERE namespace=$1 ORDER BY created_at,round_id`,[namespace]);
    const participants=await c.query(`SELECT round_id,twitch_user_id,login,display_name,bet::bigint AS bet,joined_at,outcome,payout::bigint AS payout,delta::bigint AS delta,admin_refunded_at,refunded_at FROM spind_round_participants WHERE namespace=$1 ORDER BY joined_at NULLS LAST,twitch_user_id`,[namespace]);
    const txs=await c.query(`SELECT transaction_id,event_ts,type,user_id,other_user_id,amount::bigint AS amount,round_id,note,actor,meta FROM spind_transactions WHERE namespace=$1 ORDER BY event_ts,transaction_id`,[namespace]);
    const accountMap={};
    for(const a of accounts.rows){
      accountMap[a.twitch_user_id]={userId:a.twitch_user_id,login:a.login||"",name:a.display_name||a.login||a.twitch_user_id,balance:Number(a.balance||0),reserved:Number(a.reserved||0),starterGranted:!!a.starter_granted,lastDailyDate:a.last_daily_date||null,createdAt:pgIso(a.created_at)||new Date().toISOString(),updatedAt:pgIso(a.updated_at)||new Date().toISOString()};
    }
    const byRound=new Map();
    for(const p of participants.rows){
      if(!byRound.has(p.round_id))byRound.set(p.round_id,[]);
      byRound.get(p.round_id).push({userId:p.twitch_user_id,login:p.login||"",name:p.display_name||p.login||p.twitch_user_id,bet:Number(p.bet||0),joinedAt:pgIso(p.joined_at),outcome:p.outcome||null,payout:Number(p.payout||0),delta:Number(p.delta||0),adminRefundedAt:pgIso(p.admin_refunded_at),refundedAt:pgIso(p.refunded_at)});
    }
    const roundList=rounds.rows.map(r=>({id:r.round_id,generation:Number(r.generation||0),status:r.status,createdAt:pgIso(r.created_at),joinEndsAt:pgIso(r.join_ends_at),controlStartedAt:pgIso(r.control_started_at),controlEndsAt:pgIso(r.control_ends_at),endedAt:pgIso(r.ended_at),cooldownEndsAt:pgIso(r.cooldown_ends_at),overlayHideAt:pgIso(r.overlay_hide_at),factor:Number(r.factor||1),mode:r.mode||null,overlayPhrase:r.overlay_phrase||"",abortReason:r.abort_reason||null,invalidatedByReset:!!r.invalidated_by_reset,participants:byRound.get(r.round_id)||[]}));
    const activeId=meta.rows[0].active_round_id;
    const activeRound=activeId?roundList.find(r=>r.id===activeId)||null:null;
    const state={schemaVersion:1,config:meta.rows[0].config||{},accounts:accountMap,rounds:roundList.filter(r=>!activeId||r.id!==activeId),transactions:txs.rows.map(t=>({id:t.transaction_id,ts:pgIso(t.event_ts),type:t.type,userId:t.user_id||null,otherUserId:t.other_user_id||null,amount:Number(t.amount||0),roundId:t.round_id||null,note:t.note||"",actor:t.actor||null,meta:t.meta||null})),activeRound,nextRoundAllowedAt:pgIso(meta.rows[0].next_round_allowed_at),resetGeneration:Number(meta.rows[0].reset_generation||0),lastReset:meta.rows[0].last_reset||null,updatedAt:pgIso(meta.rows[0].updated_at)};
    return {found:true,state,revision:Number(meta.rows[0].revision||1)};
  }

  async function spindSave(c,namespace,state,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const s=spindCleanState(state);
    await c.query("BEGIN");
    try{
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`bwk-spind:${namespace}`]);
      const existing=await c.query(`SELECT revision FROM spind_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
      if(ifEmpty&&existing.rowCount){await c.query("ROLLBACK");return {inserted:false,revision:Number(existing.rows[0].revision||1)};}
      const currentRevision=existing.rowCount?Number(existing.rows[0].revision||1):0;
      if(expectedRevision!==null&&expectedRevision!==undefined&&currentRevision!==Number(expectedRevision)){
        const e=new Error(`Punktespiel-Zustand wurde parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${currentRevision}).`);e.code="SPIND_REVISION_CONFLICT";throw e;
      }
      if(replace&&existing.rowCount){
        await c.query(`DELETE FROM spind_round_participants WHERE namespace=$1`,[namespace]);
        await c.query(`DELETE FROM spind_rounds WHERE namespace=$1`,[namespace]);
        await c.query(`DELETE FROM spind_transactions WHERE namespace=$1`,[namespace]);
        await c.query(`DELETE FROM spind_accounts WHERE namespace=$1`,[namespace]);
      }
      const nextRevision=currentRevision+1;
      await c.query(`
        INSERT INTO spind_meta(namespace,config,active_round_id,next_round_allowed_at,reset_generation,last_reset,revision,updated_at)
        VALUES($1,$2::jsonb,$3,$4,$5,$6::jsonb,$7,now())
        ON CONFLICT(namespace) DO UPDATE SET config=EXCLUDED.config,active_round_id=EXCLUDED.active_round_id,next_round_allowed_at=EXCLUDED.next_round_allowed_at,reset_generation=EXCLUDED.reset_generation,last_reset=EXCLUDED.last_reset,revision=EXCLUDED.revision,updated_at=now()
      `,[namespace,JSON.stringify(s.config||{}),s.activeRound?.id||null,s.nextRoundAllowedAt||null,Number(s.resetGeneration||0),JSON.stringify(s.lastReset),nextRevision]);
      for(const [id,a0] of Object.entries(s.accounts||{})){
        const a=a0||{};
        await c.query(`
          INSERT INTO spind_accounts(namespace,twitch_user_id,login,display_name,balance,reserved,starter_granted,last_daily_date,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT(namespace,twitch_user_id) DO UPDATE SET login=EXCLUDED.login,display_name=EXCLUDED.display_name,balance=EXCLUDED.balance,reserved=EXCLUDED.reserved,starter_granted=EXCLUDED.starter_granted,last_daily_date=EXCLUDED.last_daily_date,updated_at=EXCLUDED.updated_at
        `,[namespace,String(a.userId||id),String(a.login||""),String(a.name||a.login||id),Math.max(0,Math.round(Number(a.balance||0))),Math.max(0,Math.round(Number(a.reserved||0))),!!a.starterGranted,a.lastDailyDate||null,a.createdAt||new Date().toISOString(),a.updatedAt||new Date().toISOString()]);
      }
      const allRounds=[...(s.rounds||[])]; if(s.activeRound)allRounds.push(s.activeRound);
      for(const r of allRounds){
        if(!r?.id)continue;
        await c.query(`
          INSERT INTO spind_rounds(namespace,round_id,generation,status,created_at,join_ends_at,control_started_at,control_ends_at,ended_at,cooldown_ends_at,overlay_hide_at,factor,mode,overlay_phrase,abort_reason,invalidated_by_reset)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT(namespace,round_id) DO UPDATE SET generation=EXCLUDED.generation,status=EXCLUDED.status,join_ends_at=EXCLUDED.join_ends_at,control_started_at=EXCLUDED.control_started_at,control_ends_at=EXCLUDED.control_ends_at,ended_at=EXCLUDED.ended_at,cooldown_ends_at=EXCLUDED.cooldown_ends_at,overlay_hide_at=EXCLUDED.overlay_hide_at,factor=EXCLUDED.factor,mode=EXCLUDED.mode,overlay_phrase=EXCLUDED.overlay_phrase,abort_reason=EXCLUDED.abort_reason,invalidated_by_reset=EXCLUDED.invalidated_by_reset
        `,[namespace,r.id,Number(r.generation||0),String(r.status||"unknown"),r.createdAt||new Date().toISOString(),r.joinEndsAt||null,r.controlStartedAt||null,r.controlEndsAt||null,r.endedAt||null,r.cooldownEndsAt||null,r.overlayHideAt||null,Number(r.factor||1),r.mode||null,String(r.overlayPhrase||""),r.abortReason||null,!!r.invalidatedByReset]);
        for(const p of r.participants||[]){
          await c.query(`
            INSERT INTO spind_round_participants(namespace,round_id,twitch_user_id,login,display_name,bet,joined_at,outcome,payout,delta,admin_refunded_at,refunded_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT(namespace,round_id,twitch_user_id) DO UPDATE SET login=EXCLUDED.login,display_name=EXCLUDED.display_name,bet=EXCLUDED.bet,joined_at=EXCLUDED.joined_at,outcome=EXCLUDED.outcome,payout=EXCLUDED.payout,delta=EXCLUDED.delta,admin_refunded_at=EXCLUDED.admin_refunded_at,refunded_at=EXCLUDED.refunded_at
          `,[namespace,r.id,String(p.userId||""),String(p.login||""),String(p.name||p.login||p.userId||""),Math.max(0,Math.round(Number(p.bet||0))),p.joinedAt||null,p.outcome||null,Math.round(Number(p.payout||0)),Math.round(Number(p.delta||0)),p.adminRefundedAt||null,p.refundedAt||null]);
        }
      }
      for(const t of s.transactions||[]){
        if(!t?.id)continue;
        await c.query(`
          INSERT INTO spind_transactions(namespace,transaction_id,event_ts,type,user_id,other_user_id,amount,round_id,note,actor,meta)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
          ON CONFLICT(namespace,transaction_id) DO NOTHING
        `,[namespace,t.id,t.ts||new Date().toISOString(),String(t.type||"unknown"),t.userId||null,t.otherUserId||null,Math.round(Number(t.amount||0)),t.roundId||null,String(t.note||""),t.actor||null,JSON.stringify(t.meta)]);
      }
      await c.query("COMMIT");
      return {inserted:!existing.rowCount,revision:nextRevision};
    }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
  }


  function followathonCleanState(state={}){
    const s=state&&typeof state==="object"&&!Array.isArray(state)?state:{};
    return {
      schema:Number(s.schema||1),
      currentEventId:s.currentEventId||null,
      events:Array.isArray(s.events)?s.events:[],
      seenMessageIds:s.seenMessageIds&&typeof s.seenMessageIds==="object"&&!Array.isArray(s.seenMessageIds)?s.seenMessageIds:{},
      config:s.config&&typeof s.config==="object"&&!Array.isArray(s.config)?s.config:{},
    };
  }

  function pickExtra(obj,known){
    const out={};
    for(const [k,v] of Object.entries(obj||{}))if(!known.has(k))out[k]=v;
    return out;
  }

  async function followathonLoad(c,namespace){
    const meta=await c.query(`SELECT current_event_id,config,revision,updated_at FROM followathon_meta WHERE namespace=$1`,[namespace]);
    if(!meta.rowCount)return {found:false};
    const events=await c.query(`SELECT * FROM followathon_events WHERE namespace=$1 ORDER BY created_at,event_id`,[namespace]);
    const periods=await c.query(`SELECT event_id,period_no,start_at,end_at FROM followathon_acceptance_periods WHERE namespace=$1 ORDER BY event_id,period_no`,[namespace]);
    const users=await c.query(`SELECT * FROM followathon_users WHERE namespace=$1 ORDER BY event_id,twitch_user_id`,[namespace]);
    const held=await c.query(`SELECT * FROM followathon_held WHERE namespace=$1 ORDER BY event_id,created_at,held_id`,[namespace]);
    const logs=await c.query(`SELECT * FROM followathon_logs WHERE namespace=$1 ORDER BY event_id,event_ts,log_id`,[namespace]);
    const seen=await c.query(`SELECT message_id,seen_at FROM followathon_seen_messages WHERE namespace=$1 ORDER BY seen_at,message_id`,[namespace]);
    const byEvent=(rows,key='event_id')=>{const m=new Map();for(const x of rows){const id=x[key];if(!m.has(id))m.set(id,[]);m.get(id).push(x);}return m;};
    const periodMap=byEvent(periods.rows),userMap=byEvent(users.rows),heldMap=byEvent(held.rows),logMap=byEvent(logs.rows);
    const eventList=events.rows.map(r=>{
      const extra=r.extra&&typeof r.extra==='object'?r.extra:{};
      const userObj={};
      for(const u of userMap.get(r.event_id)||[]){
        userObj[u.twitch_user_id]={...(u.extra||{}),userId:u.twitch_user_id,userName:u.user_name||'',followedAt:pgIso(u.followed_at),messageId:u.message_id||'',decision:u.decision||null,heldId:u.held_id||null,creditedSeconds:Number(u.credited_seconds||0)};
      }
      const heldList=(heldMap.get(r.event_id)||[]).map(h=>({...(h.extra||{}),id:h.held_id,status:h.status,createdAt:pgIso(h.created_at),userId:h.twitch_user_id||'',userName:h.user_name||'',messageId:h.message_id||'',followedAt:pgIso(h.followed_at),requestedSeconds:Number(h.requested_seconds||0),reason:h.reason||'',reviewedAt:pgIso(h.reviewed_at),reviewedBy:h.reviewed_by||null,creditedSeconds:h.credited_seconds==null?undefined:Number(h.credited_seconds)}));
      const logList=(logMap.get(r.event_id)||[]).map(l=>({...(l.extra||{}),id:l.log_id,at:pgIso(l.event_ts),source:l.source||null,decision:l.decision||null,userId:l.twitch_user_id||undefined,userName:l.user_name||undefined,messageId:l.message_id||undefined,followedAt:pgIso(l.followed_at)||undefined,requestedSeconds:l.requested_seconds==null?undefined:Number(l.requested_seconds),creditedSeconds:l.credited_seconds==null?undefined:Number(l.credited_seconds),timerAdjustedSeconds:l.timer_adjusted_seconds==null?undefined:Number(l.timer_adjusted_seconds),reason:l.reason||'',actor:l.actor||undefined,retractedAt:pgIso(l.retracted_at)||undefined,retractedBy:l.retracted_by||undefined,retractionAppliedSeconds:l.retraction_applied_seconds==null?undefined:Number(l.retraction_applied_seconds)}));
      return {...extra,id:r.event_id,name:r.name,createdAt:pgIso(r.created_at),createdBy:r.created_by||null,status:r.status,startDurationSeconds:Number(r.start_duration_seconds||0),secondsPerFollow:Number(r.seconds_per_follow||60),maxRemainingSeconds:r.max_remaining_seconds==null?null:Number(r.max_remaining_seconds),hardEndAt:pgIso(r.hard_end_at),creditAcceptance:!!r.credit_acceptance,acceptancePeriods:(periodMap.get(r.event_id)||[]).map(p=>({start:pgIso(p.start_at),end:pgIso(p.end_at)})),followCount:Number(r.follow_count||0),creditedSeconds:Number(r.credited_seconds||0),reversedSeconds:Number(r.reversed_seconds||0),startedAt:pgIso(r.started_at),pausedAt:pgIso(r.paused_at),resumedAt:pgIso(r.resumed_at),endedAt:pgIso(r.ended_at),endReason:r.end_reason||null,countdownEndAt:pgIso(r.countdown_end_at),pausedRemainingSeconds:r.paused_remaining_seconds==null?undefined:Number(r.paused_remaining_seconds),anomaly:r.anomaly||{},overlay:r.overlay||{},lastPublicCredit:r.last_public_credit||null,users:userObj,held:heldList,log:logList};
    });
    const seenMessageIds={};for(const x of seen.rows)seenMessageIds[x.message_id]=pgIso(x.seen_at)||new Date().toISOString();
    return {found:true,state:{schema:1,currentEventId:meta.rows[0].current_event_id||null,events:eventList,seenMessageIds,config:meta.rows[0].config||{}},revision:Number(meta.rows[0].revision||1),updatedAt:pgIso(meta.rows[0].updated_at)};
  }

  async function followathonSave(c,namespace,state,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const s=followathonCleanState(state);
    await c.query('BEGIN');
    try{
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bwk-followathon:${namespace}`]);
      const existing=await c.query(`SELECT revision FROM followathon_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
      if(ifEmpty&&existing.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(existing.rows[0].revision||1)};}
      const currentRevision=existing.rowCount?Number(existing.rows[0].revision||1):0;
      if(expectedRevision!==null&&expectedRevision!==undefined&&currentRevision!==Number(expectedRevision)){
        const e=new Error(`Followathon-Zustand wurde parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${currentRevision}).`);e.code='FOLLOWATHON_REVISION_CONFLICT';throw e;
      }
      if(replace&&existing.rowCount){
        await c.query(`DELETE FROM followathon_seen_messages WHERE namespace=$1`,[namespace]);
        await c.query(`DELETE FROM followathon_events WHERE namespace=$1`,[namespace]);
      }
      const nextRevision=currentRevision+1;
      await c.query(`
        INSERT INTO followathon_meta(namespace,current_event_id,config,revision,updated_at)
        VALUES($1,$2,$3::jsonb,$4,now())
        ON CONFLICT(namespace) DO UPDATE SET current_event_id=EXCLUDED.current_event_id,config=EXCLUDED.config,revision=EXCLUDED.revision,updated_at=now()
      `,[namespace,s.currentEventId||null,JSON.stringify(s.config||{}),nextRevision]);

      const eventIds=new Set();
      for(const e0 of s.events||[]){
        const e=e0||{};if(!e.id)continue;eventIds.add(String(e.id));
        const known=new Set(['id','name','createdAt','createdBy','status','startDurationSeconds','secondsPerFollow','maxRemainingSeconds','hardEndAt','creditAcceptance','acceptancePeriods','followCount','creditedSeconds','reversedSeconds','startedAt','pausedAt','resumedAt','endedAt','endReason','countdownEndAt','pausedRemainingSeconds','anomaly','overlay','lastPublicCredit','users','held','log']);
        await c.query(`
          INSERT INTO followathon_events(namespace,event_id,name,created_at,created_by,status,start_duration_seconds,seconds_per_follow,max_remaining_seconds,hard_end_at,credit_acceptance,follow_count,credited_seconds,reversed_seconds,started_at,paused_at,resumed_at,ended_at,end_reason,countdown_end_at,paused_remaining_seconds,anomaly,overlay,last_public_credit,extra)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb)
          ON CONFLICT(namespace,event_id) DO UPDATE SET name=EXCLUDED.name,created_by=EXCLUDED.created_by,status=EXCLUDED.status,start_duration_seconds=EXCLUDED.start_duration_seconds,seconds_per_follow=EXCLUDED.seconds_per_follow,max_remaining_seconds=EXCLUDED.max_remaining_seconds,hard_end_at=EXCLUDED.hard_end_at,credit_acceptance=EXCLUDED.credit_acceptance,follow_count=EXCLUDED.follow_count,credited_seconds=EXCLUDED.credited_seconds,reversed_seconds=EXCLUDED.reversed_seconds,started_at=EXCLUDED.started_at,paused_at=EXCLUDED.paused_at,resumed_at=EXCLUDED.resumed_at,ended_at=EXCLUDED.ended_at,end_reason=EXCLUDED.end_reason,countdown_end_at=EXCLUDED.countdown_end_at,paused_remaining_seconds=EXCLUDED.paused_remaining_seconds,anomaly=EXCLUDED.anomaly,overlay=EXCLUDED.overlay,last_public_credit=EXCLUDED.last_public_credit,extra=EXCLUDED.extra
        `,[namespace,String(e.id),String(e.name||'Followathon'),e.createdAt||new Date().toISOString(),e.createdBy||null,String(e.status||'draft'),Math.max(0,Math.round(Number(e.startDurationSeconds||0))),Math.max(1,Math.round(Number(e.secondsPerFollow||60))),e.maxRemainingSeconds==null?null:Math.max(0,Math.round(Number(e.maxRemainingSeconds))),e.hardEndAt||null,!!e.creditAcceptance,Math.max(0,Math.round(Number(e.followCount||0))),Math.max(0,Math.round(Number(e.creditedSeconds||0))),Math.max(0,Math.round(Number(e.reversedSeconds||0))),e.startedAt||null,e.pausedAt||null,e.resumedAt||null,e.endedAt||null,e.endReason||null,e.countdownEndAt||null,e.pausedRemainingSeconds==null?null:Math.max(0,Math.round(Number(e.pausedRemainingSeconds))),JSON.stringify(e.anomaly||{}),JSON.stringify(e.overlay||{}),JSON.stringify(e.lastPublicCredit||null),JSON.stringify(pickExtra(e,known))]);
        await c.query(`DELETE FROM followathon_acceptance_periods WHERE namespace=$1 AND event_id=$2`,[namespace,e.id]);
        let periodNo=0;for(const p of e.acceptancePeriods||[]){await c.query(`INSERT INTO followathon_acceptance_periods(namespace,event_id,period_no,start_at,end_at) VALUES($1,$2,$3,$4,$5)`,[namespace,e.id,periodNo++,p.start,p.end||null]);}
        await c.query(`DELETE FROM followathon_users WHERE namespace=$1 AND event_id=$2`,[namespace,e.id]);
        for(const [uid,u0] of Object.entries(e.users||{})){const u=u0||{};const knownU=new Set(['userId','userName','followedAt','messageId','decision','heldId','creditedSeconds']);await c.query(`INSERT INTO followathon_users(namespace,event_id,twitch_user_id,user_name,followed_at,message_id,decision,held_id,credited_seconds,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,[namespace,e.id,String(u.userId||uid),String(u.userName||''),u.followedAt||null,u.messageId||null,u.decision||null,u.heldId||null,Math.round(Number(u.creditedSeconds||0)),JSON.stringify(pickExtra(u,knownU))]);}
        await c.query(`DELETE FROM followathon_held WHERE namespace=$1 AND event_id=$2`,[namespace,e.id]);
        for(const h0 of e.held||[]){const h=h0||{};if(!h.id)continue;const knownH=new Set(['id','status','createdAt','userId','userName','messageId','followedAt','requestedSeconds','reason','reviewedAt','reviewedBy','creditedSeconds']);await c.query(`INSERT INTO followathon_held(namespace,event_id,held_id,status,created_at,twitch_user_id,user_name,message_id,followed_at,requested_seconds,reason,reviewed_at,reviewed_by,credited_seconds,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,[namespace,e.id,h.id,String(h.status||'pending'),h.createdAt||new Date().toISOString(),h.userId||null,String(h.userName||''),h.messageId||null,h.followedAt||null,Math.round(Number(h.requestedSeconds||0)),String(h.reason||''),h.reviewedAt||null,h.reviewedBy||null,h.creditedSeconds==null?null:Math.round(Number(h.creditedSeconds)),JSON.stringify(pickExtra(h,knownH))]);}
        await c.query(`DELETE FROM followathon_logs WHERE namespace=$1 AND event_id=$2`,[namespace,e.id]);
        for(const l0 of e.log||[]){const l=l0||{};if(!l.id)continue;const knownL=new Set(['id','at','source','decision','userId','userName','messageId','followedAt','requestedSeconds','creditedSeconds','timerAdjustedSeconds','reason','actor','retractedAt','retractedBy','retractionAppliedSeconds']);await c.query(`INSERT INTO followathon_logs(namespace,event_id,log_id,event_ts,source,decision,twitch_user_id,user_name,message_id,followed_at,requested_seconds,credited_seconds,timer_adjusted_seconds,reason,actor,retracted_at,retracted_by,retraction_applied_seconds,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,[namespace,e.id,l.id,l.at||new Date().toISOString(),l.source||null,l.decision||null,l.userId||null,String(l.userName||''),l.messageId||null,l.followedAt||null,l.requestedSeconds==null?null:Math.round(Number(l.requestedSeconds)),l.creditedSeconds==null?null:Math.round(Number(l.creditedSeconds)),l.timerAdjustedSeconds==null?null:Math.round(Number(l.timerAdjustedSeconds)),String(l.reason||''),l.actor||null,l.retractedAt||null,l.retractedBy||null,l.retractionAppliedSeconds==null?null:Math.round(Number(l.retractionAppliedSeconds)),JSON.stringify(pickExtra(l,knownL))]);}
      }
      if(existing.rowCount){
        const ids=[...eventIds];
        if(ids.length)await c.query(`DELETE FROM followathon_events WHERE namespace=$1 AND NOT(event_id = ANY($2::text[]))`,[namespace,ids]);
        else await c.query(`DELETE FROM followathon_events WHERE namespace=$1`,[namespace]);
      }
      await c.query(`DELETE FROM followathon_seen_messages WHERE namespace=$1`,[namespace]);
      for(const [mid,ts] of Object.entries(s.seenMessageIds||{})){if(mid)await c.query(`INSERT INTO followathon_seen_messages(namespace,message_id,seen_at) VALUES($1,$2,$3) ON CONFLICT(namespace,message_id) DO UPDATE SET seen_at=EXCLUDED.seen_at`,[namespace,mid,ts||new Date().toISOString()]);}
      await c.query('COMMIT');
      return {inserted:!existing.rowCount,revision:nextRevision};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }


  function giveawayCleanState(state={}){
    const s=state&&typeof state==='object'&&!Array.isArray(state)?state:{};
    return {current:s.current||null,history:Array.isArray(s.history)?s.history.slice(-50):[]};
  }

  function giveawayKnownExtra(obj,known){
    const out={};for(const [k,v] of Object.entries(obj||{})){if(!known.has(k))out[k]=v;}return out;
  }

  async function giveawayLoad(c,namespace){
    const meta=await c.query(`SELECT current_giveaway_id,revision,updated_at FROM giveaway_meta WHERE namespace=$1`,[namespace]);
    if(!meta.rowCount)return {found:false};
    const games=await c.query(`SELECT * FROM giveaways WHERE namespace=$1 ORDER BY COALESCE(ended_at,created_at),created_at,giveaway_id`,[namespace]);
    const entries=await c.query(`SELECT * FROM giveaway_entries WHERE namespace=$1 ORDER BY giveaway_id,joined_at,twitch_user_id`,[namespace]);
    const draws=await c.query(`SELECT * FROM giveaway_draws WHERE namespace=$1 ORDER BY giveaway_id,draw_no`,[namespace]);
    const byGame=(rows)=>{const m=new Map();for(const x of rows){if(!m.has(x.giveaway_id))m.set(x.giveaway_id,[]);m.get(x.giveaway_id).push(x);}return m;};
    const entryMap=byGame(entries.rows),drawMap=byGame(draws.rows);
    const all=games.rows.map(g=>{
      const entryObj={};
      for(const e of entryMap.get(g.giveaway_id)||[]){
        entryObj[e.twitch_user_id]={...(e.extra||{}),userId:e.twitch_user_id,login:e.login||'',name:e.display_name||e.login||e.twitch_user_id,isModerator:!!e.is_moderator,isVip:!!e.is_vip,badges:Array.isArray(e.badges)?e.badges:[],joinedAt:pgIso(e.joined_at)};
      }
      const winners=(drawMap.get(g.giveaway_id)||[]).map(d=>({...(d.extra||{}),userId:d.winner_user_id,login:d.login||'',name:d.display_name||d.login||d.winner_user_id,isModerator:!!d.is_moderator,isVip:!!d.is_vip,badges:Array.isArray(d.badges)?d.badges:[],joinedAt:pgIso(d.joined_at)}));
      return {...(g.extra||{}),id:g.giveaway_id,type:g.type,keyword:g.keyword||'',title:g.title||'',active:!!g.active,createdAt:pgIso(g.created_at),createdBy:g.created_by||null,startedAt:pgIso(g.started_at),endedAt:pgIso(g.ended_at),winner:winners.length?winners[winners.length-1]:null,winners,excludeModerators:!!g.exclude_moderators,excludeBroadcaster:!!g.exclude_broadcaster,excludeVIPs:!!g.exclude_vips,entries:entryObj,archived:!!g.archived,updatedAt:pgIso(g.updated_at)};
    });
    const byId=new Map(all.map(g=>[g.id,g]));
    const currentId=meta.rows[0].current_giveaway_id||null;
    const current=currentId?byId.get(currentId)||null:null;
    const history=all.filter(g=>g.archived);
    return {found:true,state:{current,history},revision:Number(meta.rows[0].revision||1),updatedAt:pgIso(meta.rows[0].updated_at)};
  }

  async function giveawaySave(c,namespace,state,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const s=giveawayCleanState(state);
    await c.query('BEGIN');
    try{
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bwk-giveaway:${namespace}`]);
      const existing=await c.query(`SELECT revision FROM giveaway_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
      if(ifEmpty&&existing.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(existing.rows[0].revision||1)};}
      const currentRevision=existing.rowCount?Number(existing.rows[0].revision||1):0;
      if(expectedRevision!==null&&expectedRevision!==undefined&&currentRevision!==Number(expectedRevision)){
        const e=new Error(`Gewinnspiel-Zustand wurde parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${currentRevision}).`);e.code='GIVEAWAY_REVISION_CONFLICT';throw e;
      }
      if(replace&&existing.rowCount)await c.query(`DELETE FROM giveaways WHERE namespace=$1`,[namespace]);
      const nextRevision=currentRevision+1;
      await c.query(`
        INSERT INTO giveaway_meta(namespace,current_giveaway_id,revision,updated_at)
        VALUES($1,$2,$3,now())
        ON CONFLICT(namespace) DO UPDATE SET current_giveaway_id=EXCLUDED.current_giveaway_id,revision=EXCLUDED.revision,updated_at=now()
      `,[namespace,s.current?.id||null,nextRevision]);

      const merged=new Map();
      for(const g of s.history||[]){if(g?.id)merged.set(String(g.id),g);}
      if(s.current?.id)merged.set(String(s.current.id),s.current);
      const ids=[...merged.keys()];
      if(ids.length)await c.query(`DELETE FROM giveaways WHERE namespace=$1 AND NOT (giveaway_id = ANY($2::text[]))`,[namespace,ids]);
      else await c.query(`DELETE FROM giveaways WHERE namespace=$1`,[namespace]);

      for(const [id,g0] of merged){
        const g=g0||{};
        const known=new Set(['id','type','keyword','title','active','createdAt','createdBy','startedAt','endedAt','winner','winners','excludeModerators','excludeBroadcaster','excludeVIPs','entries','archived','updatedAt']);
        await c.query(`
          INSERT INTO giveaways(namespace,giveaway_id,type,keyword,title,active,created_at,created_by,started_at,ended_at,archived,exclude_moderators,exclude_broadcaster,exclude_vips,updated_at,extra)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
          ON CONFLICT(namespace,giveaway_id) DO UPDATE SET type=EXCLUDED.type,keyword=EXCLUDED.keyword,title=EXCLUDED.title,active=EXCLUDED.active,created_by=EXCLUDED.created_by,started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,archived=EXCLUDED.archived,exclude_moderators=EXCLUDED.exclude_moderators,exclude_broadcaster=EXCLUDED.exclude_broadcaster,exclude_vips=EXCLUDED.exclude_vips,updated_at=EXCLUDED.updated_at,extra=EXCLUDED.extra
        `,[namespace,id,['random','keyword'].includes(String(g.type))?String(g.type):'keyword',String(g.keyword||''),String(g.title||''),!!g.active,g.createdAt||new Date().toISOString(),g.createdBy||null,g.startedAt||null,g.endedAt||null,!!g.archived,g.excludeModerators!==false,g.excludeBroadcaster!==false,g.excludeVIPs===true,g.updatedAt||new Date().toISOString(),JSON.stringify(giveawayKnownExtra(g,known))]);
        await c.query(`DELETE FROM giveaway_entries WHERE namespace=$1 AND giveaway_id=$2`,[namespace,id]);
        for(const [uid,e0] of Object.entries(g.entries||{})){
          const e=e0||{};const userId=String(e.userId||uid||'');if(!userId)continue;
          const eKnown=new Set(['userId','login','name','isModerator','isVip','badges','joinedAt']);
          await c.query(`INSERT INTO giveaway_entries(namespace,giveaway_id,twitch_user_id,login,display_name,is_moderator,is_vip,badges,joined_at,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)`,[namespace,id,userId,String(e.login||''),String(e.name||e.login||userId),!!e.isModerator,!!e.isVip,JSON.stringify(Array.isArray(e.badges)?e.badges:[]),e.joinedAt||new Date().toISOString(),JSON.stringify(giveawayKnownExtra(e,eKnown))]);
        }
        await c.query(`DELETE FROM giveaway_draws WHERE namespace=$1 AND giveaway_id=$2`,[namespace,id]);
        const winners=Array.isArray(g.winners)?g.winners:(g.winner?[g.winner]:[]);
        let drawNo=0;
        for(const w0 of winners){
          const w=w0||{};const userId=String(w.userId||'');if(!userId)continue;drawNo++;
          const wKnown=new Set(['userId','login','name','isModerator','isVip','badges','joinedAt']);
          await c.query(`INSERT INTO giveaway_draws(namespace,giveaway_id,draw_no,winner_user_id,login,display_name,is_moderator,is_vip,badges,joined_at,drawn_at,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now(),$11::jsonb)`,[namespace,id,drawNo,userId,String(w.login||''),String(w.name||w.login||userId),!!w.isModerator,!!w.isVip,JSON.stringify(Array.isArray(w.badges)?w.badges:[]),w.joinedAt||null,JSON.stringify(giveawayKnownExtra(w,wKnown))]);
        }
      }
      await c.query('COMMIT');
      return {inserted:!existing.rowCount,revision:nextRevision};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }


  async function discordModerationLoad(c,namespace){
    const meta=await c.query(`SELECT last_action_at,last_error,revision,updated_at FROM discord_moderation_meta WHERE namespace=$1`,[namespace]);
    if(!meta.rowCount)return {found:false,state:{recent:{},users:{},lastActionAt:null,lastError:null},revision:0,updatedAt:null};
    const usersRes=await c.query(`SELECT discord_user_id,username,timeout_stage,timeout_count,first_violation_at,last_violation_at,last_timeout_at,banned_at,unbanned_at,ban_reason,last_rule_name,last_matched_term FROM discord_moderation_users WHERE namespace=$1 ORDER BY discord_user_id`,[namespace]);
    const recentRes=await c.query(`SELECT discord_user_id,rule_id,event_ms FROM discord_moderation_recent WHERE namespace=$1 ORDER BY event_ms`,[namespace]);
    const users={};
    for(const r of usersRes.rows){users[r.discord_user_id]={userId:r.discord_user_id,username:r.username||null,timeoutStage:Number(r.timeout_stage||0),timeoutCount:Number(r.timeout_count||0),firstViolationAt:pgIso(r.first_violation_at),lastViolationAt:pgIso(r.last_violation_at),lastTimeoutAt:pgIso(r.last_timeout_at),bannedAt:pgIso(r.banned_at),unbannedAt:pgIso(r.unbanned_at),banReason:r.ban_reason||null,lastRuleName:r.last_rule_name||null,lastMatchedTerm:r.last_matched_term||null};}
    const recent={};
    for(const r of recentRes.rows){const key=`${r.discord_user_id}:${r.rule_id}`;(recent[key]||=[]).push(Number(r.event_ms));}
    return {found:true,state:{recent,users,lastActionAt:pgIso(meta.rows[0].last_action_at),lastError:meta.rows[0].last_error||null},revision:Number(meta.rows[0].revision||0),updatedAt:pgIso(meta.rows[0].updated_at)};
  }

  async function discordModerationSave(c,namespace,state,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const input=state&&typeof state==='object'?state:{};
    await c.query('BEGIN');
    try{
      await c.query("SELECT pg_advisory_xact_lock(hashtext('bwk-discord-moderation-' || $1))",[namespace]);
      const current=await c.query(`SELECT revision FROM discord_moderation_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
      if(ifEmpty&&current.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(current.rows[0].revision||0)};}
      if(expectedRevision!==null&&current.rowCount&&Number(current.rows[0].revision)!==Number(expectedRevision)){const e=new Error(`Discord-Moderationszustand wurde parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${current.rows[0].revision}).`);e.code='BWK_REVISION_CONFLICT';throw e;}
      const revision=current.rowCount?(replace?Number(current.rows[0].revision||1):Number(current.rows[0].revision||1)+1):1;
      await c.query(`INSERT INTO discord_moderation_meta(namespace,last_action_at,last_error,revision,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(namespace) DO UPDATE SET last_action_at=EXCLUDED.last_action_at,last_error=EXCLUDED.last_error,revision=EXCLUDED.revision,updated_at=now()`,[namespace,input.lastActionAt||null,input.lastError||null,revision]);
      await c.query(`DELETE FROM discord_moderation_users WHERE namespace=$1`,[namespace]);
      for(const [id,u0] of Object.entries(input.users||{})){const u=u0||{};if(!id)continue;await c.query(`INSERT INTO discord_moderation_users(namespace,discord_user_id,username,timeout_stage,timeout_count,first_violation_at,last_violation_at,last_timeout_at,banned_at,unbanned_at,ban_reason,last_rule_name,last_matched_term) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[namespace,String(id),u.username||null,Math.max(0,Math.min(3,Number(u.timeoutStage||0))),Math.max(0,Number(u.timeoutCount||0)),u.firstViolationAt||null,u.lastViolationAt||null,u.lastTimeoutAt||null,u.bannedAt||null,u.unbannedAt||null,u.banReason||null,u.lastRuleName||null,u.lastMatchedTerm||null]);}
      await c.query(`DELETE FROM discord_moderation_recent WHERE namespace=$1`,[namespace]);
      for(const [key,values] of Object.entries(input.recent||{})){const idx=String(key).indexOf(':');if(idx<1)continue;const userId=String(key).slice(0,idx),ruleId=String(key).slice(idx+1)||'global-moderation';for(const ts0 of (Array.isArray(values)?values:[])){const ts=Number(ts0);if(!Number.isFinite(ts))continue;await c.query(`INSERT INTO discord_moderation_recent(namespace,discord_user_id,rule_id,event_ms) VALUES($1,$2,$3,$4)`,[namespace,userId,ruleId,Math.trunc(ts)]);}}
      await c.query('COMMIT');
      return {inserted:!current.rowCount,revision};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }

  function userExtra(u){
    const known=new Set(['id','twitchUserId','login','displayName','role','enabled','discordUserId','discordUsername','discordDisplayName','discordAvatar','discordBackendEnabled','discordRole','capabilities','capabilitiesCustomized','globalOwner','globalAdmin','createdAt','createdBy','updatedAt','updatedBy']);
    const out={};for(const [k,v] of Object.entries(u||{}))if(!known.has(k))out[k]=v;return out;
  }

  async function controlUsersLoad(c,namespace){
    const meta=await c.query(`SELECT revision,updated_at FROM control_users_meta WHERE namespace=$1`,[namespace]);
    if(!meta.rowCount)return {found:false,data:{users:[]},revision:0,updatedAt:null};
    const ur=await c.query(`SELECT * FROM control_users WHERE namespace=$1 ORDER BY created_at NULLS LAST,internal_user_id`,[namespace]);
    const cr=await c.query(`SELECT internal_user_id,capability FROM control_user_capabilities WHERE namespace=$1 ORDER BY internal_user_id,capability`,[namespace]);
    const caps={};for(const r of cr.rows)(caps[r.internal_user_id]||=[]).push(r.capability);
    const users=ur.rows.map(r=>({...(r.extra||{}),id:r.internal_user_id,twitchUserId:r.twitch_user_id||null,login:r.twitch_login||null,displayName:r.display_name||null,role:r.twitch_role||'viewer',enabled:!!r.twitch_enabled,discordUserId:r.discord_user_id||null,discordUsername:r.discord_username||null,discordDisplayName:r.discord_display_name||null,discordAvatar:r.discord_avatar||null,discordBackendEnabled:!!r.discord_backend_enabled,discordRole:r.discord_role||'viewer',capabilities:caps[r.internal_user_id]||[],capabilitiesCustomized:!!r.capabilities_customized,globalOwner:!!r.global_owner,globalAdmin:!!r.global_admin,createdAt:pgIso(r.created_at),createdBy:r.created_by||null,updatedAt:pgIso(r.updated_at),updatedBy:r.updated_by||null}));
    return {found:true,data:{users},revision:Number(meta.rows[0].revision||0),updatedAt:pgIso(meta.rows[0].updated_at)};
  }

  async function controlUsersSave(c,namespace,data,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const users=Array.isArray(data?.users)?data.users:[];
    await c.query('BEGIN');
    try{
      await c.query("SELECT pg_advisory_xact_lock(hashtext('bwk-control-users-' || $1))",[namespace]);
      const current=await c.query(`SELECT revision FROM control_users_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
      if(ifEmpty&&current.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(current.rows[0].revision||0)};}
      if(expectedRevision!==null&&current.rowCount&&Number(current.rows[0].revision)!==Number(expectedRevision)){const e=new Error(`Benutzerdaten wurden parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${current.rows[0].revision}).`);e.code='BWK_REVISION_CONFLICT';throw e;}
      const revision=current.rowCount?(replace?Number(current.rows[0].revision||1):Number(current.rows[0].revision||1)+1):1;
      await c.query(`INSERT INTO control_users_meta(namespace,revision,updated_at) VALUES($1,$2,now()) ON CONFLICT(namespace) DO UPDATE SET revision=EXCLUDED.revision,updated_at=now()`,[namespace,revision]);
      await c.query(`DELETE FROM control_users WHERE namespace=$1`,[namespace]);
      for(const u0 of users){const u=u0||{};const id=String(u.id||'').trim();if(!id)continue;
        await c.query(`INSERT INTO control_users(namespace,internal_user_id,twitch_user_id,twitch_login,display_name,twitch_role,twitch_enabled,discord_user_id,discord_username,discord_display_name,discord_avatar,discord_backend_enabled,discord_role,capabilities_customized,global_owner,global_admin,created_at,created_by,updated_at,updated_by,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)`,[namespace,id,u.twitchUserId||null,u.login||null,u.displayName||null,u.role||'viewer',u.enabled!==false, u.discordUserId||null,u.discordUsername||null,u.discordDisplayName||null,u.discordAvatar||null,u.discordBackendEnabled===true,u.discordRole||'viewer',u.capabilitiesCustomized===true,u.globalOwner===true,u.globalAdmin===true,u.createdAt||null,u.createdBy||null,u.updatedAt||null,u.updatedBy||null,JSON.stringify(userExtra(u))]);
        for(const cap of [...new Set(Array.isArray(u.capabilities)?u.capabilities.map(String):[])])await c.query(`INSERT INTO control_user_capabilities(namespace,internal_user_id,capability) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[namespace,id,cap]);
      }
      await c.query('COMMIT');return {inserted:!current.rowCount,revision};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }

  async function controlSessionsLoad(c,namespace){
    const r=await c.query(`SELECT session_id,payload FROM control_sessions WHERE namespace=$1 AND expires_at>now() ORDER BY created_at`,[namespace]);
    const sessions={};for(const x of r.rows)sessions[x.session_id]=x.payload||{};return sessions;
  }

  async function controlSessionsReplace(c,namespace,sessions){
    const input=sessions&&typeof sessions==='object'&&!Array.isArray(sessions)?sessions:{};
    await c.query('BEGIN');
    try{
      await c.query("SELECT pg_advisory_xact_lock(hashtext('bwk-control-sessions-' || $1))",[namespace]);
      const ids=Object.keys(input);
      if(ids.length)await c.query(`DELETE FROM control_sessions WHERE namespace=$1 AND NOT (session_id=ANY($2::text[]))`,[namespace,ids]);else await c.query(`DELETE FROM control_sessions WHERE namespace=$1`,[namespace]);
      for(const [sid,raw0] of Object.entries(input)){const raw=raw0&&typeof raw0==='object'?raw0:{};const created=safeTimestamp(raw.created||raw.createdAt);const expires=new Date(new Date(created).getTime()+12*60*60*1000).toISOString();
        await c.query(`INSERT INTO control_sessions(namespace,session_id,auth_provider,internal_user_id,twitch_user_id,discord_user_id,created_at,expires_at,security_revision,local_admin,payload,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now()) ON CONFLICT(namespace,session_id) DO UPDATE SET auth_provider=EXCLUDED.auth_provider,internal_user_id=EXCLUDED.internal_user_id,twitch_user_id=EXCLUDED.twitch_user_id,discord_user_id=EXCLUDED.discord_user_id,created_at=EXCLUDED.created_at,expires_at=EXCLUDED.expires_at,security_revision=EXCLUDED.security_revision,local_admin=EXCLUDED.local_admin,payload=EXCLUDED.payload,updated_at=now()`,[namespace,sid,raw.authProvider||null,raw.internalUserId||null,raw.id||null,raw.discordId||null,created,expires,Number(raw.securityRevision||0),raw.localAdmin===true,JSON.stringify(raw)]);
      }
      await c.query('COMMIT');return {count:ids.length};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }


  function objectExtra(obj, known){ const out={}; for(const [k,v] of Object.entries(obj||{})){if(!known.has(k))out[k]=v;} return out; }

  async function discordOnboardingLoad(c,namespace){
    const meta=await c.query(`SELECT total_welcomed,total_verified,bypass_prevented,last_action_at,last_error,revision,updated_at FROM discord_onboarding_meta WHERE namespace=$1`,[namespace]);
    if(!meta.rowCount)return {found:false,state:{members:{},stats:{}},revision:0,updatedAt:null};
    const rows=await c.query(`SELECT * FROM discord_onboarding_members WHERE namespace=$1 ORDER BY discord_user_id`,[namespace]); const members={};
    for(const r of rows.rows){const e={...(r.extra||{}),joinedAt:pgIso(r.joined_at),firstSeenAt:pgIso(r.first_seen_at),welcomedAt:pgIso(r.welcomed_at),verifiedAt:pgIso(r.verified_at),leftAt:pgIso(r.left_at),verifiedMessageId:r.verified_message_id||null,verifiedEmoji:r.verified_emoji||null,bypassPreventedAt:pgIso(r.bypass_prevented_at),lastError:r.last_error||null};for(const k of Object.keys(e))if(e[k]===null)delete e[k];members[r.discord_user_id]=e;}
    const m=meta.rows[0]; return {found:true,state:{members,stats:{totalWelcomed:Number(m.total_welcomed||0),totalVerified:Number(m.total_verified||0),bypassPrevented:Number(m.bypass_prevented||0),lastActionAt:pgIso(m.last_action_at),lastError:m.last_error||null}},revision:Number(m.revision||1),updatedAt:pgIso(m.updated_at)};
  }
  async function discordOnboardingSave(c,namespace,state,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const x=state&&typeof state==='object'?state:{}; const members=x.members&&typeof x.members==='object'?x.members:{}; const stats=x.stats&&typeof x.stats==='object'?x.stats:{}; await c.query('BEGIN');
    try{await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bwk-discord-onboarding:${namespace}`]); const current=await c.query(`SELECT revision FROM discord_onboarding_meta WHERE namespace=$1 FOR UPDATE`,[namespace]); if(ifEmpty&&current.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(current.rows[0].revision||1)};} const rev=current.rowCount?Number(current.rows[0].revision||1):0; if(expectedRevision!==null&&expectedRevision!==undefined&&rev!==Number(expectedRevision)){const e=new Error(`Discord-Onboarding wurde parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${rev}).`);e.code='ONBOARDING_REVISION_CONFLICT';throw e;} if(replace)await c.query(`DELETE FROM discord_onboarding_members WHERE namespace=$1`,[namespace]); const next=rev+1;
      await c.query(`INSERT INTO discord_onboarding_meta(namespace,total_welcomed,total_verified,bypass_prevented,last_action_at,last_error,revision,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(namespace) DO UPDATE SET total_welcomed=EXCLUDED.total_welcomed,total_verified=EXCLUDED.total_verified,bypass_prevented=EXCLUDED.bypass_prevented,last_action_at=EXCLUDED.last_action_at,last_error=EXCLUDED.last_error,revision=EXCLUDED.revision,updated_at=now()`,[namespace,Number(stats.totalWelcomed||0),Number(stats.totalVerified||stats.totalAssigned||0),Number(stats.bypassPrevented||0),stats.lastActionAt||null,stats.lastError||null,next]);
      const ids=Object.keys(members).map(String); if(ids.length)await c.query(`DELETE FROM discord_onboarding_members WHERE namespace=$1 AND NOT (discord_user_id=ANY($2::text[]))`,[namespace,ids]); else await c.query(`DELETE FROM discord_onboarding_members WHERE namespace=$1`,[namespace]); const known=new Set(['joinedAt','firstSeenAt','welcomedAt','verifiedAt','leftAt','verifiedMessageId','verifiedEmoji','bypassPreventedAt','lastError']);
      for(const [uid,e0] of Object.entries(members)){const e=e0||{};await c.query(`INSERT INTO discord_onboarding_members(namespace,discord_user_id,joined_at,first_seen_at,welcomed_at,verified_at,left_at,verified_message_id,verified_emoji,bypass_prevented_at,last_error,extra,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now()) ON CONFLICT(namespace,discord_user_id) DO UPDATE SET joined_at=EXCLUDED.joined_at,first_seen_at=EXCLUDED.first_seen_at,welcomed_at=EXCLUDED.welcomed_at,verified_at=EXCLUDED.verified_at,left_at=EXCLUDED.left_at,verified_message_id=EXCLUDED.verified_message_id,verified_emoji=EXCLUDED.verified_emoji,bypass_prevented_at=EXCLUDED.bypass_prevented_at,last_error=EXCLUDED.last_error,extra=EXCLUDED.extra,updated_at=now()`,[namespace,String(uid),e.joinedAt||null,e.firstSeenAt||null,e.welcomedAt||null,e.verifiedAt||null,e.leftAt||null,e.verifiedMessageId||null,e.verifiedEmoji||null,e.bypassPreventedAt||null,e.lastError||null,JSON.stringify(objectExtra(e,known))]);}
      await c.query('COMMIT'); return {inserted:!current.rowCount,revision:next};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }
  async function discordReportsLoad(c,namespace){
    const meta=await c.query(`SELECT sequence_by_year,last_created_at,last_error,commands_registered_at,revision,updated_at FROM discord_reports_meta WHERE namespace=$1`,[namespace]); if(!meta.rowCount)return {found:false,tickets:{tickets:[]},state:{sequenceByYear:{},cooldowns:{},lastCreatedAt:null,lastError:null,commandsRegisteredAt:null},revision:0,updatedAt:null};
    const tr=await c.query(`SELECT * FROM discord_reports WHERE namespace=$1 ORDER BY created_at,ticket_id`,[namespace]); const ar=await c.query(`SELECT * FROM discord_report_actions WHERE namespace=$1 ORDER BY ticket_id,action_no`,[namespace]); const cr=await c.query(`SELECT discord_user_id,last_report_at FROM discord_report_cooldowns WHERE namespace=$1`,[namespace]); const actionMap=new Map(); for(const a of ar.rows){if(!actionMap.has(a.ticket_id))actionMap.set(a.ticket_id,[]);actionMap.get(a.ticket_id).push({...(a.detail||{}),id:a.action_id,type:a.type,at:pgIso(a.action_at),actor:a.actor||null});}
    const tickets=tr.rows.map(t=>({...(t.extra||{}),id:t.ticket_id,status:t.status,createdAt:pgIso(t.created_at),updatedAt:pgIso(t.updated_at),reason:t.reason,reasonLabel:t.reason_label,description:t.description||'',reporter:t.reporter||{},targetUser:t.target_user||null,source:t.source||{},actions:actionMap.get(t.ticket_id)||[],closedAt:pgIso(t.closed_at),closedBy:t.closed_by||null,closingNote:t.closing_note||null})); const cooldowns={}; for(const r of cr.rows)cooldowns[r.discord_user_id]=new Date(r.last_report_at).getTime(); const m=meta.rows[0]; return {found:true,tickets:{tickets},state:{sequenceByYear:m.sequence_by_year||{},cooldowns,lastCreatedAt:pgIso(m.last_created_at),lastError:m.last_error||null,commandsRegisteredAt:pgIso(m.commands_registered_at)},revision:Number(m.revision||1),updatedAt:pgIso(m.updated_at)};
  }
  async function discordReportsSave(c,namespace,ticketsState,reportsState,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const tickets=Array.isArray(ticketsState?.tickets)?ticketsState.tickets.slice(-5000):[]; const st=reportsState&&typeof reportsState==='object'?reportsState:{}; await c.query('BEGIN');
    try{await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bwk-discord-reports:${namespace}`]); const current=await c.query(`SELECT revision FROM discord_reports_meta WHERE namespace=$1 FOR UPDATE`,[namespace]); if(ifEmpty&&current.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(current.rows[0].revision||1)};} const rev=current.rowCount?Number(current.rows[0].revision||1):0; if(expectedRevision!==null&&expectedRevision!==undefined&&rev!==Number(expectedRevision)){const e=new Error(`Discord-Meldesystem wurde parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${rev}).`);e.code='REPORTS_REVISION_CONFLICT';throw e;} const next=rev+1;
      await c.query(`INSERT INTO discord_reports_meta(namespace,sequence_by_year,last_created_at,last_error,commands_registered_at,revision,updated_at) VALUES($1,$2::jsonb,$3,$4,$5,$6,now()) ON CONFLICT(namespace) DO UPDATE SET sequence_by_year=EXCLUDED.sequence_by_year,last_created_at=EXCLUDED.last_created_at,last_error=EXCLUDED.last_error,commands_registered_at=EXCLUDED.commands_registered_at,revision=EXCLUDED.revision,updated_at=now()`,[namespace,JSON.stringify(st.sequenceByYear||{}),st.lastCreatedAt||null,st.lastError||null,st.commandsRegisteredAt||null,next]);
      if(replace){await c.query(`DELETE FROM discord_reports WHERE namespace=$1`,[namespace]);await c.query(`DELETE FROM discord_report_cooldowns WHERE namespace=$1`,[namespace]);} const ids=tickets.map(t=>String(t?.id||'')).filter(Boolean); if(ids.length)await c.query(`DELETE FROM discord_reports WHERE namespace=$1 AND NOT (ticket_id=ANY($2::text[]))`,[namespace,ids]); else await c.query(`DELETE FROM discord_reports WHERE namespace=$1`,[namespace]); const known=new Set(['id','status','createdAt','updatedAt','reason','reasonLabel','description','reporter','targetUser','source','actions','closedAt','closedBy','closingNote']);
      for(const t0 of tickets){const t=t0||{};const id=String(t.id||'');if(!id)continue;await c.query(`INSERT INTO discord_reports(namespace,ticket_id,status,created_at,updated_at,reason,reason_label,description,reporter,target_user,source,closed_at,closed_by,closing_note,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14,$15::jsonb) ON CONFLICT(namespace,ticket_id) DO UPDATE SET status=EXCLUDED.status,updated_at=EXCLUDED.updated_at,reason=EXCLUDED.reason,reason_label=EXCLUDED.reason_label,description=EXCLUDED.description,reporter=EXCLUDED.reporter,target_user=EXCLUDED.target_user,source=EXCLUDED.source,closed_at=EXCLUDED.closed_at,closed_by=EXCLUDED.closed_by,closing_note=EXCLUDED.closing_note,extra=EXCLUDED.extra`,[namespace,id,['open','resolved','rejected'].includes(String(t.status))?String(t.status):'open',t.createdAt||new Date().toISOString(),t.updatedAt||t.createdAt||new Date().toISOString(),String(t.reason||'sonstiges'),String(t.reasonLabel||'Sonstiges'),String(t.description||''),JSON.stringify(t.reporter||{}),t.targetUser?JSON.stringify(t.targetUser):null,JSON.stringify(t.source||{}),t.closedAt||null,t.closedBy?JSON.stringify(t.closedBy):null,t.closingNote||null,JSON.stringify(objectExtra(t,known))]); await c.query(`DELETE FROM discord_report_actions WHERE namespace=$1 AND ticket_id=$2`,[namespace,id]); let n=0; for(const a0 of Array.isArray(t.actions)?t.actions:[]){const a=a0||{};n++;const aid=String(a.id||`action-${n}`);const aKnown=new Set(['id','type','at','actor']);await c.query(`INSERT INTO discord_report_actions(namespace,ticket_id,action_id,action_no,type,action_at,actor,detail) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,[namespace,id,aid,n,String(a.type||'note'),a.at||new Date().toISOString(),a.actor?JSON.stringify(a.actor):null,JSON.stringify(objectExtra(a,aKnown))]);}}
      const cutoff=Date.now()-7*86400000; const cds=Object.entries(st.cooldowns||{}).filter(([,ts])=>Number(ts)>=cutoff); const uids=cds.map(([uid])=>String(uid)); if(uids.length)await c.query(`DELETE FROM discord_report_cooldowns WHERE namespace=$1 AND NOT (discord_user_id=ANY($2::text[]))`,[namespace,uids]); else await c.query(`DELETE FROM discord_report_cooldowns WHERE namespace=$1`,[namespace]); for(const [uid,ts] of cds){const d=new Date(Number(ts));if(!Number.isFinite(d.getTime()))continue;await c.query(`INSERT INTO discord_report_cooldowns(namespace,discord_user_id,last_report_at) VALUES($1,$2,$3) ON CONFLICT(namespace,discord_user_id) DO UPDATE SET last_report_at=EXCLUDED.last_report_at`,[namespace,String(uid),d.toISOString()]);}
      await c.query('COMMIT'); return {inserted:!current.rowCount,revision:next};}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }


  function cleanSocialState(state={}){
    const x=state&&typeof state==='object'?state:{};
    return {
      initialized:{instagram:x.initialized?.instagram===true,tiktok:x.initialized?.tiktok===true},
      seen:{
        instagram:x.seen?.instagram&&typeof x.seen.instagram==='object'?x.seen.instagram:{},
        tiktok:x.seen?.tiktok&&typeof x.seen.tiktok==='object'?x.seen.tiktok:{}
      },
      lastPollAt:x.lastPollAt||null,
      nextPollAt:x.nextPollAt||null,
      platforms:{
        instagram:x.platforms?.instagram&&typeof x.platforms.instagram==='object'?x.platforms.instagram:{},
        tiktok:x.platforms?.tiktok&&typeof x.platforms.tiktok==='object'?x.platforms.tiktok:{}
      }
    };
  }
  function cleanSocialHistory(history={}){
    const items=Array.isArray(history?.items)?history.items:[];
    return {items:items.slice(-1500)};
  }
  async function discordSocialLoad(c,namespace){
    const meta=await c.query(`SELECT last_poll_at,next_poll_at,revision,updated_at FROM discord_social_meta WHERE namespace=$1`,[namespace]);
    if(!meta.rowCount)return {found:false,state:cleanSocialState({}),history:{items:[]},revision:0,updatedAt:null};
    const platforms=await c.query(`SELECT platform,initialized,last_check_at,last_success_at,last_detected_at,last_discord_at,last_error,profile FROM discord_social_platforms WHERE namespace=$1 ORDER BY platform`,[namespace]);
    const seenRows=await c.query(`SELECT platform,external_id,status,seen_at,seen_at_ms,discord_message_id,error,extra FROM discord_social_seen WHERE namespace=$1 ORDER BY platform,seen_at DESC NULLS LAST`,[namespace]);
    const histRows=await c.query(`SELECT platform,external_id,history_key,media_type,title,caption,url,thumbnail_url,published_at,detected_at,status,error,attempts,discord_channel_id,discord_message_id,sent_at,extra FROM discord_social_history WHERE namespace=$1 ORDER BY detected_at NULLS LAST,history_key`,[namespace]);
    const state=cleanSocialState({lastPollAt:pgIso(meta.rows[0].last_poll_at),nextPollAt:pgIso(meta.rows[0].next_poll_at)});
    for(const p of platforms.rows){state.initialized[p.platform]=!!p.initialized;state.platforms[p.platform]={lastCheckAt:pgIso(p.last_check_at),lastSuccessAt:pgIso(p.last_success_at),lastDetectedAt:pgIso(p.last_detected_at),lastDiscordAt:pgIso(p.last_discord_at),lastError:p.last_error||null,profile:p.profile||null};}
    for(const r of seenRows.rows){const extra=r.extra||{};state.seen[r.platform][r.external_id]={...extra,status:r.status,seenAt:pgIso(r.seen_at),seenAtMs:r.seen_at_ms===null?null:Number(r.seen_at_ms),discordMessageId:r.discord_message_id||null,error:r.error||null};for(const k of Object.keys(state.seen[r.platform][r.external_id]))if(state.seen[r.platform][r.external_id][k]===null)delete state.seen[r.platform][r.external_id][k];}
    const items=histRows.rows.map(r=>({...(r.extra||{}),key:r.history_key,platform:r.platform,id:r.external_id,type:r.media_type||null,title:r.title||null,caption:r.caption||null,url:r.url||null,thumbnailUrl:r.thumbnail_url||null,publishedAt:pgIso(r.published_at),detectedAt:pgIso(r.detected_at),status:r.status,error:r.error||null,attempts:Number(r.attempts||0),discordChannelId:r.discord_channel_id||null,discordMessageId:r.discord_message_id||null,sentAt:pgIso(r.sent_at)}));
    return {found:true,state,history:{items},revision:Number(meta.rows[0].revision||1),updatedAt:pgIso(meta.rows[0].updated_at)};
  }
  async function discordSocialSave(c,namespace,state0,history0,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const state=cleanSocialState(state0),history=cleanSocialHistory(history0);
    await c.query('BEGIN');
    try{
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bwk-discord-social:${namespace}`]);
      const current=await c.query(`SELECT revision FROM discord_social_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
      if(ifEmpty&&current.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(current.rows[0].revision||1)};}
      const rev=current.rowCount?Number(current.rows[0].revision||1):0;
      if(expectedRevision!==null&&expectedRevision!==undefined&&rev!==Number(expectedRevision)){const e=new Error(`Discord-Socialdaten wurden parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${rev}).`);e.code='SOCIAL_REVISION_CONFLICT';throw e;}
      const next=rev+1;
      await c.query(`INSERT INTO discord_social_meta(namespace,last_poll_at,next_poll_at,revision,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(namespace) DO UPDATE SET last_poll_at=EXCLUDED.last_poll_at,next_poll_at=EXCLUDED.next_poll_at,revision=EXCLUDED.revision,updated_at=now()`,[namespace,state.lastPollAt||null,state.nextPollAt||null,next]);
      for(const platform of ['instagram','tiktok']){const p=state.platforms?.[platform]||{};await c.query(`INSERT INTO discord_social_platforms(namespace,platform,initialized,last_check_at,last_success_at,last_detected_at,last_discord_at,last_error,profile,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now()) ON CONFLICT(namespace,platform) DO UPDATE SET initialized=EXCLUDED.initialized,last_check_at=EXCLUDED.last_check_at,last_success_at=EXCLUDED.last_success_at,last_detected_at=EXCLUDED.last_detected_at,last_discord_at=EXCLUDED.last_discord_at,last_error=EXCLUDED.last_error,profile=EXCLUDED.profile,updated_at=now()`,[namespace,platform,!!state.initialized?.[platform],p.lastCheckAt||null,p.lastSuccessAt||null,p.lastDetectedAt||null,p.lastDiscordAt||null,p.lastError||null,p.profile?JSON.stringify(p.profile):null]);}
      if(replace){await c.query(`DELETE FROM discord_social_seen WHERE namespace=$1`,[namespace]);await c.query(`DELETE FROM discord_social_history WHERE namespace=$1`,[namespace]);}
      for(const platform of ['instagram','tiktok']){
        const seen=state.seen?.[platform]||{};const ids=Object.keys(seen).slice(0,1000);
        if(ids.length)await c.query(`DELETE FROM discord_social_seen WHERE namespace=$1 AND platform=$2 AND NOT (external_id=ANY($3::text[]))`,[namespace,platform,ids]); else await c.query(`DELETE FROM discord_social_seen WHERE namespace=$1 AND platform=$2`,[namespace,platform]);
        const known=new Set(['status','seenAt','seenAtMs','discordMessageId','error']);
        for(const id of ids){const r=seen[id]||{};await c.query(`INSERT INTO discord_social_seen(namespace,platform,external_id,status,seen_at,seen_at_ms,discord_message_id,error,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(namespace,platform,external_id) DO UPDATE SET status=EXCLUDED.status,seen_at=EXCLUDED.seen_at,seen_at_ms=EXCLUDED.seen_at_ms,discord_message_id=EXCLUDED.discord_message_id,error=EXCLUDED.error,extra=EXCLUDED.extra`,[namespace,platform,String(id),String(r.status||'seen'),r.seenAt||null,Number.isFinite(Number(r.seenAtMs))?Math.trunc(Number(r.seenAtMs)):null,r.discordMessageId||null,r.error||null,JSON.stringify(objectExtra(r,known))]);}
      }
      const items=history.items||[];const keys=items.map(x=>String(x?.key||`${x?.platform||''}:${x?.id||''}`)).filter(Boolean);
      if(keys.length)await c.query(`DELETE FROM discord_social_history WHERE namespace=$1 AND NOT (history_key=ANY($2::text[]))`,[namespace,keys]); else await c.query(`DELETE FROM discord_social_history WHERE namespace=$1`,[namespace]);
      const knownH=new Set(['key','platform','id','type','title','caption','url','thumbnailUrl','publishedAt','detectedAt','status','error','attempts','discordChannelId','discordMessageId','sentAt']);
      for(const x0 of items){const x=x0||{},platform=['instagram','tiktok'].includes(String(x.platform))?String(x.platform):null,id=String(x.id||'').trim();if(!platform||!id)continue;const key=String(x.key||`${platform}:${id}`);await c.query(`INSERT INTO discord_social_history(namespace,platform,external_id,history_key,media_type,title,caption,url,thumbnail_url,published_at,detected_at,status,error,attempts,discord_channel_id,discord_message_id,sent_at,extra,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,now()) ON CONFLICT(namespace,platform,external_id) DO UPDATE SET history_key=EXCLUDED.history_key,media_type=EXCLUDED.media_type,title=EXCLUDED.title,caption=EXCLUDED.caption,url=EXCLUDED.url,thumbnail_url=EXCLUDED.thumbnail_url,published_at=EXCLUDED.published_at,detected_at=EXCLUDED.detected_at,status=EXCLUDED.status,error=EXCLUDED.error,attempts=EXCLUDED.attempts,discord_channel_id=EXCLUDED.discord_channel_id,discord_message_id=EXCLUDED.discord_message_id,sent_at=EXCLUDED.sent_at,extra=EXCLUDED.extra,updated_at=now()`,[namespace,platform,id,key,x.type||null,x.title||null,x.caption||null,x.url||null,x.thumbnailUrl||null,x.publishedAt||null,x.detectedAt||null,String(x.status||'unknown'),x.error||null,Math.max(0,Number(x.attempts||0)),x.discordChannelId||null,x.discordMessageId||null,x.sentAt||null,JSON.stringify(objectExtra(x,knownH))]);}
      await c.query('COMMIT');return {inserted:!current.rowCount,revision:next};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }


  function cleanChannelTimesState(state={}){
    const x=state&&typeof state==='object'?state:{};
    return {active:x.active&&typeof x.active==='object'?x.active:{},overrides:x.overrides&&typeof x.overrides==='object'?x.overrides:{},warningNotices:x.warningNotices&&typeof x.warningNotices==='object'?x.warningNotices:{},maintenance:x.maintenance&&typeof x.maintenance==='object'?x.maintenance:{},lastRunAt:x.lastRunAt||null,lastError:x.lastError||null,events:Array.isArray(x.events)?x.events.slice(-500):[]};
  }
  async function discordChannelTimesLoad(c,namespace){
    const meta=await c.query(`SELECT last_run_at,last_error,warning_state,revision,updated_at FROM discord_channel_times_meta WHERE namespace=$1`,[namespace]);
    if(!meta.rowCount)return {found:false,state:cleanChannelTimesState({}),revision:0,updatedAt:null};
    const activeRows=await c.query(`SELECT profile_id,channel_id,closed_at,source,roles,snapshots FROM discord_channel_times_active WHERE namespace=$1 ORDER BY profile_id`,[namespace]);
    const overrideRows=await c.query(`SELECT profile_id,state,set_at,until_at FROM discord_channel_times_overrides WHERE namespace=$1 ORDER BY profile_id`,[namespace]);
    const eventRows=await c.query(`SELECT event_ts,type,profile_id,channel_id,channel_name,extra FROM discord_channel_times_events WHERE namespace=$1 ORDER BY event_ts,event_id`,[namespace]);
    const state=cleanChannelTimesState({lastRunAt:pgIso(meta.rows[0].last_run_at),lastError:meta.rows[0].last_error||null,warningNotices:meta.rows[0].warning_state?.notices||meta.rows[0].warning_state||{},maintenance:meta.rows[0].warning_state?.maintenance||{}});
    for(const r of activeRows.rows)state.active[r.profile_id]={channelId:r.channel_id||null,closedAt:pgIso(r.closed_at),source:r.source||null,roles:Array.isArray(r.roles)?r.roles:[],snapshots:r.snapshots&&typeof r.snapshots==='object'?r.snapshots:{}};
    for(const r of overrideRows.rows)state.overrides[r.profile_id]={state:r.state,at:pgIso(r.set_at),until:pgIso(r.until_at)};
    state.events=eventRows.rows.map(r=>({...(r.extra||{}),at:pgIso(r.event_ts),type:r.type,profileId:r.profile_id||null,channelId:r.channel_id||null,channelName:r.channel_name||null}));
    return {found:true,state,revision:Number(meta.rows[0].revision||1),updatedAt:pgIso(meta.rows[0].updated_at)};
  }
  async function discordChannelTimesSave(c,namespace,state0,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const state=cleanChannelTimesState(state0);await c.query('BEGIN');
    try{await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bwk-discord-channel-times:${namespace}`]);const current=await c.query(`SELECT revision FROM discord_channel_times_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);if(ifEmpty&&current.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(current.rows[0].revision||1)};}const rev=current.rowCount?Number(current.rows[0].revision||1):0;if(expectedRevision!==null&&expectedRevision!==undefined&&rev!==Number(expectedRevision)){const e=new Error(`Discord-Kanalzeiten wurden parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${rev}).`);e.code='CHANNEL_TIMES_REVISION_CONFLICT';throw e;}const next=rev+1;
      await c.query(`INSERT INTO discord_channel_times_meta(namespace,last_run_at,last_error,warning_state,revision,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,now()) ON CONFLICT(namespace) DO UPDATE SET last_run_at=EXCLUDED.last_run_at,last_error=EXCLUDED.last_error,warning_state=EXCLUDED.warning_state,revision=EXCLUDED.revision,updated_at=now()`,[namespace,state.lastRunAt||null,state.lastError||null,JSON.stringify({notices:state.warningNotices||{},maintenance:state.maintenance||{}}),next]);
      await c.query(`DELETE FROM discord_channel_times_active WHERE namespace=$1`,[namespace]);for(const [id,a0] of Object.entries(state.active||{})){const a=a0||{};await c.query(`INSERT INTO discord_channel_times_active(namespace,profile_id,channel_id,closed_at,source,roles,snapshots) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,[namespace,id,a.channelId||null,a.closedAt||null,a.source||null,JSON.stringify(Array.isArray(a.roles)?a.roles:[]),JSON.stringify(a.snapshots&&typeof a.snapshots==='object'?a.snapshots:{})]);}
      await c.query(`DELETE FROM discord_channel_times_overrides WHERE namespace=$1`,[namespace]);for(const [id,o0] of Object.entries(state.overrides||{})){const o=o0||{};if(!o.state)continue;await c.query(`INSERT INTO discord_channel_times_overrides(namespace,profile_id,state,set_at,until_at) VALUES($1,$2,$3,$4,$5)`,[namespace,id,String(o.state),o.at||null,o.until||null]);}
      await c.query(`DELETE FROM discord_channel_times_events WHERE namespace=$1`,[namespace]);const known=new Set(['at','type','profileId','channelId','channelName']);for(const e0 of state.events||[]){const e=e0||{};if(!e.type)continue;await c.query(`INSERT INTO discord_channel_times_events(namespace,event_ts,type,profile_id,channel_id,channel_name,extra) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[namespace,e.at||new Date().toISOString(),String(e.type),e.profileId||null,e.channelId||null,e.channelName||null,JSON.stringify(objectExtra(e,known))]);}
      await c.query('COMMIT');return {inserted:!current.rowCount,revision:next};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }

  function cleanEmergencyState(state={}){const x=state&&typeof state==='object'?state:{};return {active:x.active===true,level:x.level?String(x.level):null,reason:x.reason||null,actor:x.actor||null,startedAt:x.startedAt||null,endsAt:x.endsAt||null,snapshots:x.snapshots&&typeof x.snapshots==='object'?x.snapshots:{},affected:x.affected&&typeof x.affected==='object'?x.affected:{text:[],voice:[]},lastError:x.lastError||null,history:Array.isArray(x.history)?x.history.slice(-500):[]};}
  async function discordEmergencyLoad(c,namespace){
    const meta=await c.query(`SELECT active,level,reason,actor,started_at,ends_at,affected,last_error,revision,updated_at FROM discord_emergency_meta WHERE namespace=$1`,[namespace]);if(!meta.rowCount)return {found:false,state:cleanEmergencyState({}),revision:0,updatedAt:null};
    const snapRows=await c.query(`SELECT snapshot_key,channel_id,role_id,snapshot FROM discord_emergency_snapshots WHERE namespace=$1 ORDER BY snapshot_key`,[namespace]);const histRows=await c.query(`SELECT event_ts,type,level,actor,reason,extra FROM discord_emergency_history WHERE namespace=$1 ORDER BY event_ts,history_id`,[namespace]);const m=meta.rows[0];const state=cleanEmergencyState({active:m.active,level:m.level,reason:m.reason,actor:m.actor,startedAt:pgIso(m.started_at),endsAt:pgIso(m.ends_at),affected:m.affected,lastError:m.last_error});for(const r of snapRows.rows)state.snapshots[r.snapshot_key]=r.snapshot&&typeof r.snapshot==='object'?r.snapshot:{};state.history=histRows.rows.map(r=>({...(r.extra||{}),at:pgIso(r.event_ts),type:r.type,level:r.level||null,actor:r.actor||null,reason:r.reason||null}));return {found:true,state,revision:Number(m.revision||1),updatedAt:pgIso(m.updated_at)};
  }
  async function discordEmergencySave(c,namespace,state0,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const state=cleanEmergencyState(state0);await c.query('BEGIN');try{await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bwk-discord-emergency:${namespace}`]);const current=await c.query(`SELECT revision FROM discord_emergency_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);if(ifEmpty&&current.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(current.rows[0].revision||1)};}const rev=current.rowCount?Number(current.rows[0].revision||1):0;if(expectedRevision!==null&&expectedRevision!==undefined&&rev!==Number(expectedRevision)){const e=new Error(`Discord-Notfallmodus wurde parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${rev}).`);e.code='EMERGENCY_REVISION_CONFLICT';throw e;}const next=rev+1;
      await c.query(`INSERT INTO discord_emergency_meta(namespace,active,level,reason,actor,started_at,ends_at,affected,last_error,revision,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,now()) ON CONFLICT(namespace) DO UPDATE SET active=EXCLUDED.active,level=EXCLUDED.level,reason=EXCLUDED.reason,actor=EXCLUDED.actor,started_at=EXCLUDED.started_at,ends_at=EXCLUDED.ends_at,affected=EXCLUDED.affected,last_error=EXCLUDED.last_error,revision=EXCLUDED.revision,updated_at=now()`,[namespace,state.active,state.level,state.reason,state.actor,state.startedAt,state.endsAt,JSON.stringify(state.affected||{text:[],voice:[]}),state.lastError,next]);
      await c.query(`DELETE FROM discord_emergency_snapshots WHERE namespace=$1`,[namespace]);for(const [key,snap] of Object.entries(state.snapshots||{})){const [channelId,roleId]=String(key).split(':');await c.query(`INSERT INTO discord_emergency_snapshots(namespace,snapshot_key,channel_id,role_id,snapshot) VALUES($1,$2,$3,$4,$5::jsonb)`,[namespace,key,channelId||null,roleId||null,JSON.stringify(snap&&typeof snap==='object'?snap:{})]);}
      await c.query(`DELETE FROM discord_emergency_history WHERE namespace=$1`,[namespace]);const known=new Set(['at','type','level','actor','reason']);for(const h0 of state.history||[]){const h=h0||{};if(!h.type)continue;await c.query(`INSERT INTO discord_emergency_history(namespace,event_ts,type,level,actor,reason,extra) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[namespace,h.at||new Date().toISOString(),String(h.type),h.level||null,h.actor||null,h.reason||null,JSON.stringify(objectExtra(h,known))]);}
      await c.query('COMMIT');return {inserted:!current.rowCount,revision:next};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }

  function cleanAnnouncementsState(state={}){
    const x=state&&typeof state==='object'?state:{};
    return {liveStreams:x.liveStreams&&typeof x.liveStreams==='object'?x.liveStreams:{},clips:x.clips&&typeof x.clips==='object'?x.clips:{},lastLiveAt:x.lastLiveAt||null,lastClipAt:x.lastClipAt||null,lastError:x.lastError||null};
  }
  async function discordAnnouncementsLoad(c,namespace){
    const meta=await c.query(`SELECT last_live_at,last_clip_at,last_error,revision,updated_at FROM discord_announcements_meta WHERE namespace=$1`,[namespace]);
    if(!meta.rowCount)return {found:false,state:cleanAnnouncementsState({}),revision:0,updatedAt:null};
    const rows=await c.query(`SELECT type,item_key,sent_at,url,title,extra FROM discord_announcement_items WHERE namespace=$1 ORDER BY sent_at NULLS LAST,item_key`,[namespace]);
    const state=cleanAnnouncementsState({lastLiveAt:pgIso(meta.rows[0].last_live_at),lastClipAt:pgIso(meta.rows[0].last_clip_at),lastError:meta.rows[0].last_error||null});
    for(const r of rows.rows){const bucket=r.type==='live'?state.liveStreams:state.clips;bucket[r.item_key]={...(r.extra||{}),sentAt:pgIso(r.sent_at),url:r.url||null,title:r.title||null};}
    return {found:true,state,revision:Number(meta.rows[0].revision||1),updatedAt:pgIso(meta.rows[0].updated_at)};
  }
  async function discordAnnouncementsSave(c,namespace,state0,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const state=cleanAnnouncementsState(state0);await c.query('BEGIN');
    try{
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bwk-discord-announcements:${namespace}`]);
      const current=await c.query(`SELECT revision FROM discord_announcements_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
      if(ifEmpty&&current.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(current.rows[0].revision||1)};}
      const rev=current.rowCount?Number(current.rows[0].revision||1):0;
      if(expectedRevision!==null&&expectedRevision!==undefined&&rev!==Number(expectedRevision)){const e=new Error(`Discord-Ankündigungszustand wurde parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${rev}).`);e.code='ANNOUNCEMENTS_REVISION_CONFLICT';throw e;}
      const next=rev+1;
      await c.query(`INSERT INTO discord_announcements_meta(namespace,last_live_at,last_clip_at,last_error,revision,updated_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(namespace) DO UPDATE SET last_live_at=EXCLUDED.last_live_at,last_clip_at=EXCLUDED.last_clip_at,last_error=EXCLUDED.last_error,revision=EXCLUDED.revision,updated_at=now()`,[namespace,state.lastLiveAt||null,state.lastClipAt||null,state.lastError||null,next]);
      if(replace)await c.query(`DELETE FROM discord_announcement_items WHERE namespace=$1`,[namespace]);
      for(const [type,bucket] of [['live',state.liveStreams],['clip',state.clips]]){
        const ids=Object.keys(bucket||{});
        if(ids.length)await c.query(`DELETE FROM discord_announcement_items WHERE namespace=$1 AND type=$2 AND NOT (item_key=ANY($3::text[]))`,[namespace,type,ids]); else await c.query(`DELETE FROM discord_announcement_items WHERE namespace=$1 AND type=$2`,[namespace,type]);
        for(const id of ids){const x=bucket[id]||{};const extra={...x};delete extra.sentAt;delete extra.url;delete extra.title;await c.query(`INSERT INTO discord_announcement_items(namespace,type,item_key,sent_at,url,title,extra) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(namespace,type,item_key) DO UPDATE SET sent_at=EXCLUDED.sent_at,url=EXCLUDED.url,title=EXCLUDED.title,extra=EXCLUDED.extra`,[namespace,type,String(id),x.sentAt||null,x.url||null,x.title||null,JSON.stringify(extra)]);}
      }
      await c.query('COMMIT');return {inserted:!current.rowCount,revision:next};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }

  function cleanBridgeState(state={}){const x=state&&typeof state==='object'?state:{};return {queue:Array.isArray(x.queue)?x.queue.slice(-500):[],lastDeliveredAt:x.lastDeliveredAt||null,lastError:x.lastError||null};}
  async function discordBridgeLoad(c,namespace){
    const meta=await c.query(`SELECT last_delivered_at,last_error,revision,updated_at FROM discord_bridge_meta WHERE namespace=$1`,[namespace]);if(!meta.rowCount)return {found:false,state:cleanBridgeState({}),revision:0,updatedAt:null};
    const rows=await c.query(`SELECT queue_id,type,item_key,payload,created_at,attempts,last_error FROM discord_bridge_queue WHERE namespace=$1 ORDER BY created_at,queue_id`,[namespace]);
    return {found:true,state:{queue:rows.rows.map(r=>({id:r.queue_id,type:r.type,key:r.item_key,payload:r.payload||{},createdAt:pgIso(r.created_at),attempts:Number(r.attempts||0),lastError:r.last_error||null})),lastDeliveredAt:pgIso(meta.rows[0].last_delivered_at),lastError:meta.rows[0].last_error||null},revision:Number(meta.rows[0].revision||1),updatedAt:pgIso(meta.rows[0].updated_at)};
  }
  async function discordBridgeSave(c,namespace,state0,{expectedRevision=null,replace=false,ifEmpty=false}={}){
    const state=cleanBridgeState(state0);await c.query('BEGIN');try{
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bwk-discord-bridge:${namespace}`]);const current=await c.query(`SELECT revision FROM discord_bridge_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);if(ifEmpty&&current.rowCount){await c.query('ROLLBACK');return {inserted:false,revision:Number(current.rows[0].revision||1)};}const rev=current.rowCount?Number(current.rows[0].revision||1):0;if(expectedRevision!==null&&expectedRevision!==undefined&&rev!==Number(expectedRevision)){const e=new Error(`Discord-Bridge wurde parallel geändert (erwartet Revision ${expectedRevision}, aktuell ${rev}).`);e.code='BRIDGE_REVISION_CONFLICT';throw e;}const next=rev+1;
      await c.query(`INSERT INTO discord_bridge_meta(namespace,last_delivered_at,last_error,revision,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(namespace) DO UPDATE SET last_delivered_at=EXCLUDED.last_delivered_at,last_error=EXCLUDED.last_error,revision=EXCLUDED.revision,updated_at=now()`,[namespace,state.lastDeliveredAt||null,state.lastError||null,next]);
      await c.query(`DELETE FROM discord_bridge_queue WHERE namespace=$1`,[namespace]);for(const item0 of state.queue||[]){const item=item0||{},id=String(item.id||`${item.type||'unknown'}:${item.key||''}`);if(!id)continue;await c.query(`INSERT INTO discord_bridge_queue(namespace,queue_id,type,item_key,payload,created_at,attempts,last_error) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,[namespace,id,String(item.type||''),String(item.key||''),JSON.stringify(item.payload||{}),item.createdAt||new Date().toISOString(),Math.max(0,Number(item.attempts||0)),item.lastError||null]);}
      await c.query('COMMIT');return {inserted:!current.rowCount,revision:next};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  }

  async function operation(op,args={}) {
    const c = await connect();
    switch(op) {
      case "init":
        return initSchema();
      case "ping": {
        const r=await c.query("SELECT now() AS now, current_database() AS database, current_user AS user, version() AS version");
        return {ok:true,...r.rows[0],schemaVersion:SCHEMA_VERSION};
      }
      case "doc_get": {
        const r=await c.query("SELECT value,revision,updated_at FROM state_documents WHERE namespace=$1 AND key=$2",[args.namespace,args.key]);
        return r.rowCount?{found:true,value:r.rows[0].value,revision:Number(r.rows[0].revision),updatedAt:r.rows[0].updated_at}:{found:false};
      }
      case "doc_put": {
        const r=await c.query(`
          INSERT INTO state_documents(namespace,key,value,revision)
          VALUES($1,$2,$3::jsonb,1)
          ON CONFLICT(namespace,key) DO UPDATE
            SET value=EXCLUDED.value,revision=state_documents.revision+1,updated_at=now()
          RETURNING revision,updated_at
        `,[args.namespace,args.key,JSON.stringify(safeJson(args.value))]);
        return {ok:true,revision:Number(r.rows[0].revision),updatedAt:r.rows[0].updated_at};
      }
      case "doc_put_if_absent": {
        const r=await c.query(`
          INSERT INTO state_documents(namespace,key,value,revision)
          VALUES($1,$2,$3::jsonb,1)
          ON CONFLICT(namespace,key) DO NOTHING
          RETURNING revision,updated_at
        `,[args.namespace,args.key,JSON.stringify(safeJson(args.value))]);
        return {inserted:r.rowCount===1};
      }
      case "doc_list": {
        const r=await c.query("SELECT key,revision,updated_at,pg_column_size(value) AS bytes FROM state_documents WHERE namespace=$1 ORDER BY key",[args.namespace]);
        return r.rows.map(x=>({key:x.key,revision:Number(x.revision),updatedAt:x.updated_at,bytes:Number(x.bytes||0)}));
      }
      case "event_append": {
        const entry=args.entry||{};
        const ts=safeTimestamp(entry.ts||entry.at);
        const actor=entry.user||entry.actor||entry.username||null;
        const action=entry.action||entry.decision||entry.result||null;
        await c.query(`INSERT INTO operation_events(service,stream,event_ts,actor,action,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[
          args.service,args.stream,ts,actor,action,JSON.stringify(entry)
        ]);
        return {ok:true};
      }
      case "events_import": {
        const rows=Array.isArray(args.rows)?args.rows:[];
        if(!rows.length)return {inserted:0};
        await c.query("BEGIN");
        try{
          let inserted=0;
          for(const entry of rows){
            const ts=safeTimestamp(entry?.ts||entry?.at);
            const actor=entry?.user||entry?.actor||entry?.username||null;
            const action=entry?.action||entry?.decision||entry?.result||null;
            await c.query(`INSERT INTO operation_events(service,stream,event_ts,actor,action,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[
              args.service,args.stream,ts,actor,action,JSON.stringify(entry||{})
            ]);
            inserted++;
          }
          await c.query("COMMIT");
          return {inserted};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "events_query": {
        const limit=Math.max(1,Math.min(50000,Number(args.limit||2000)));
        const r=await c.query(`SELECT payload FROM operation_events WHERE service=$1 AND stream=$2 ORDER BY event_ts DESC,id DESC LIMIT $3`,[args.service,args.stream,limit]);
        return r.rows.map(x=>x.payload);
      }
      case "events_trim": {
        const maxRows=Math.max(100,Math.min(100000,Number(args.maxRows||2000)));
        const r=await c.query(`
          DELETE FROM operation_events
          WHERE id IN (
            SELECT id FROM operation_events
            WHERE service=$1 AND stream=$2
            ORDER BY event_ts DESC,id DESC
            OFFSET $3
          )
        `,[args.service,args.stream,maxRows]);
        return {removed:r.rowCount};
      }
      case "events_delete_older": {
        const days=Math.max(1,Math.min(3650,Number(args.days||30)));
        const r=await c.query(`DELETE FROM operation_events WHERE service=$1 AND stream=$2 AND event_ts < now() - ($3::text || ' days')::interval`,[args.service,args.stream,String(days)]);
        const c2=await c.query(`SELECT count(*)::bigint AS n FROM operation_events WHERE service=$1 AND stream=$2`,[args.service,args.stream]);
        return {removed:r.rowCount,remaining:Number(c2.rows[0].n)};
      }
      case "events_replace": {
        const rows=Array.isArray(args.rows)?args.rows:[];
        await c.query("BEGIN");
        try{
          await c.query("DELETE FROM operation_events WHERE service=$1 AND stream=$2",[args.service,args.stream]);
          for(const entry of rows){
            const ts=safeTimestamp(entry?.ts||entry?.at);
            const actor=entry?.user||entry?.actor||entry?.username||null;
            const action=entry?.action||entry?.decision||entry?.result||null;
            await c.query(`INSERT INTO operation_events(service,stream,event_ts,actor,action,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[
              args.service,args.stream,ts,actor,action,JSON.stringify(entry||{})
            ]);
          }
          await c.query("COMMIT");
          return {ok:true,count:rows.length};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "control_users_get": {
        return controlUsersLoad(c,String(args.namespace||"twitch"));
      }
      case "control_users_import_if_empty": {
        return controlUsersSave(c,String(args.namespace||"twitch"),args.data||{users:[]},{ifEmpty:true});
      }
      case "control_users_put": {
        return controlUsersSave(c,String(args.namespace||"twitch"),args.data||{users:[]},{expectedRevision:args.expectedRevision??null,replace:args.replace===true});
      }
      case "control_sessions_get": {
        await c.query(`DELETE FROM control_sessions WHERE namespace=$1 AND expires_at<=now()`,[String(args.namespace||"twitch")]);
        return controlSessionsLoad(c,String(args.namespace||"twitch"));
      }
      case "control_sessions_import_if_empty": {
        const namespace=String(args.namespace||"twitch");const n=await c.query(`SELECT count(*)::bigint AS n FROM control_sessions WHERE namespace=$1`,[namespace]);if(Number(n.rows[0].n||0)>0)return {inserted:false};await controlSessionsReplace(c,namespace,args.sessions||{});return {inserted:true};
      }
      case "control_sessions_replace": {
        return controlSessionsReplace(c,String(args.namespace||"twitch"),args.sessions||{});
      }
      case "control_auth_counts": {
        const namespace=String(args.namespace||"twitch"),out={};let r=await c.query(`SELECT count(*)::bigint AS n FROM control_users WHERE namespace=$1`,[namespace]);out.control_users=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM control_user_capabilities WHERE namespace=$1`,[namespace]);out.control_capabilities=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM control_sessions WHERE namespace=$1 AND expires_at>now()`,[namespace]);out.control_sessions=Number(r.rows[0].n||0);r=await c.query(`SELECT revision,updated_at FROM control_users_meta WHERE namespace=$1`,[namespace]);out.control_users_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.control_users_updated_at=r.rows[0]?.updated_at||null;return out;
      }
      case "clip_state_import_if_empty": {
        const namespace=String(args.namespace||"twitch");
        const state=args.state&&typeof args.state==="object"?args.state:{};
        const seen=state.seen&&typeof state.seen==="object"&&!Array.isArray(state.seen)?state.seen:{};
        await c.query("BEGIN");
        try{
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`bwk-clips:${namespace}`]);
          const existing=await c.query(`SELECT revision FROM twitch_clip_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
          if(existing.rowCount){await c.query("ROLLBACK");return {inserted:false,revision:Number(existing.rows[0].revision||1)};}
          await c.query(`INSERT INTO twitch_clip_meta(namespace,initialized,last_checked_at,last_shared,last_error,revision,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,1,now())`,[
            namespace,!!state.initialized,state.lastCheckedAt||null,state.lastShared?JSON.stringify(state.lastShared):null,state.lastError||null
          ]);
          for(const [clipId,item] of Object.entries(seen)){
            if(!clipId)continue;
            await c.query(`INSERT INTO twitch_clips(namespace,clip_id,created_at,title,url,creator_name,first_seen_at,share_status,updated_at)
              VALUES($1,$2,$3,$4,$5,$6,now(),'seen',now()) ON CONFLICT(namespace,clip_id) DO NOTHING`,[
              namespace,String(clipId),item?.createdAt||null,String(item?.title||''),String(item?.url||''),String(item?.creator||'')
            ]);
          }
          if(state.lastShared?.id){
            const ls=state.lastShared;
            await c.query(`INSERT INTO twitch_clips(namespace,clip_id,created_at,title,url,creator_name,first_seen_at,shared_at,share_status,updated_at)
              VALUES($1,$2,$3,$4,$5,$6,now(),$7,'shared',now()) ON CONFLICT(namespace,clip_id) DO UPDATE SET shared_at=EXCLUDED.shared_at,share_status='shared',title=EXCLUDED.title,url=EXCLUDED.url,creator_name=EXCLUDED.creator_name,created_at=COALESCE(EXCLUDED.created_at,twitch_clips.created_at),updated_at=now()`,[
              namespace,String(ls.id),ls.createdAt||null,String(ls.title||''),String(ls.url||''),String(ls.creator||''),ls.sharedAt||null
            ]);
          }
          await c.query("COMMIT");
          return {inserted:true,rows:Object.keys(seen).length,revision:1};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "clip_state_get": {
        const namespace=String(args.namespace||"twitch");
        const meta=await c.query(`SELECT initialized,last_checked_at,last_shared,last_error,revision,updated_at FROM twitch_clip_meta WHERE namespace=$1`,[namespace]);
        if(!meta.rowCount)return {found:false,state:{initialized:false,seen:{},lastCheckedAt:null,lastShared:null,lastError:null},revision:0,knownCount:0};
        const rows=await c.query(`SELECT clip_id,created_at,title,url,creator_name FROM twitch_clips WHERE namespace=$1 ORDER BY created_at DESC NULLS LAST,first_seen_at DESC LIMIT 500`,[namespace]);
        const count=await c.query(`SELECT count(*)::bigint AS n FROM twitch_clips WHERE namespace=$1`,[namespace]);
        const seen={};for(const r of rows.rows)seen[r.clip_id]={createdAt:pgIso(r.created_at),title:r.title||'',url:r.url||'',creator:r.creator_name||''};
        return {found:true,state:{initialized:!!meta.rows[0].initialized,seen,lastCheckedAt:pgIso(meta.rows[0].last_checked_at),lastShared:meta.rows[0].last_shared||null,lastError:meta.rows[0].last_error||null,knownCount:Number(count.rows[0].n||0)},revision:Number(meta.rows[0].revision||1),knownCount:Number(count.rows[0].n||0),updatedAt:pgIso(meta.rows[0].updated_at)};
      }
      case "clip_state_put": {
        const namespace=String(args.namespace||"twitch");
        const state=args.state&&typeof args.state==="object"?args.state:{};
        const seen=state.seen&&typeof state.seen==="object"&&!Array.isArray(state.seen)?state.seen:{};
        await c.query("BEGIN");
        try{
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`bwk-clips:${namespace}`]);
          const current=await c.query(`SELECT revision FROM twitch_clip_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
          const revision=(current.rowCount?Number(current.rows[0].revision||1):0)+1;
          await c.query(`INSERT INTO twitch_clip_meta(namespace,initialized,last_checked_at,last_shared,last_error,revision,updated_at)
            VALUES($1,$2,$3,$4::jsonb,$5,$6,now()) ON CONFLICT(namespace) DO UPDATE SET initialized=EXCLUDED.initialized,last_checked_at=EXCLUDED.last_checked_at,last_shared=EXCLUDED.last_shared,last_error=EXCLUDED.last_error,revision=EXCLUDED.revision,updated_at=now()`,[
            namespace,!!state.initialized,state.lastCheckedAt||null,state.lastShared?JSON.stringify(state.lastShared):null,state.lastError||null,revision
          ]);
          for(const [clipId,item] of Object.entries(seen)){
            if(!clipId)continue;
            await c.query(`INSERT INTO twitch_clips(namespace,clip_id,created_at,title,url,creator_name,first_seen_at,share_status,updated_at)
              VALUES($1,$2,$3,$4,$5,$6,now(),'seen',now()) ON CONFLICT(namespace,clip_id) DO UPDATE SET created_at=COALESCE(EXCLUDED.created_at,twitch_clips.created_at),title=EXCLUDED.title,url=EXCLUDED.url,creator_name=EXCLUDED.creator_name,updated_at=now()`,[
              namespace,String(clipId),item?.createdAt||null,String(item?.title||''),String(item?.url||''),String(item?.creator||'')
            ]);
          }
          await c.query("COMMIT");return {ok:true,revision};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "clip_state_replace": {
        const namespace=String(args.namespace||"twitch");
        await c.query("BEGIN");
        try{await c.query(`DELETE FROM twitch_clips WHERE namespace=$1`,[namespace]);await c.query(`DELETE FROM twitch_clip_meta WHERE namespace=$1`,[namespace]);await c.query("COMMIT");}
        catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
        return await operation("clip_state_import_if_empty",{namespace,state:args.state||{}});
      }
      case "clip_reserve": {
        const namespace=String(args.namespace||"twitch"),clip=args.clip&&typeof args.clip==="object"?args.clip:{};
        const id=String(clip.id||clip.clipId||'');if(!id)return {inserted:false};
        const r=await c.query(`INSERT INTO twitch_clips(namespace,clip_id,created_at,title,url,creator_name,first_seen_at,share_status,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,now(),'seen',now()) ON CONFLICT(namespace,clip_id) DO NOTHING RETURNING clip_id`,[
          namespace,id,clip.created_at||clip.createdAt||null,String(clip.title||''),String(clip.url||''),String(clip.creator_name||clip.creator||'')
        ]);
        return {inserted:r.rowCount===1};
      }
      case "clip_mark_shared": {
        const namespace=String(args.namespace||"twitch"),clip=args.clip&&typeof args.clip==="object"?args.clip:{};const id=String(clip.id||clip.clipId||'');const sharedAt=args.sharedAt||new Date().toISOString();
        if(!id)return {ok:false};
        await c.query(`UPDATE twitch_clips SET shared_at=$3,share_status='shared',last_error=NULL,updated_at=now() WHERE namespace=$1 AND clip_id=$2`,[namespace,id,sharedAt]);
        return {ok:true};
      }
      case "clip_mark_error": {
        const namespace=String(args.namespace||"twitch"),id=String(args.clipId||''),error=String(args.error||'');
        if(id)await c.query(`UPDATE twitch_clips SET share_status='failed',last_error=$3,updated_at=now() WHERE namespace=$1 AND clip_id=$2`,[namespace,id,error]);
        return {ok:true};
      }
      case "clip_counts": {
        const namespace=String(args.namespace||"twitch"),out={};let r=await c.query(`SELECT count(*)::bigint AS n FROM twitch_clips WHERE namespace=$1`,[namespace]);out.twitch_clips=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM twitch_clips WHERE namespace=$1 AND shared_at IS NOT NULL`,[namespace]);out.twitch_clips_shared=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM twitch_clips WHERE namespace=$1 AND share_status='failed'`,[namespace]);out.twitch_clips_failed=Number(r.rows[0].n||0);r=await c.query(`SELECT revision,updated_at FROM twitch_clip_meta WHERE namespace=$1`,[namespace]);out.twitch_clips_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.twitch_clips_updated_at=r.rows[0]?.updated_at||null;return out;
      }
      case "follower_cache_import_if_empty": {
        const namespace=String(args.namespace||"twitch");
        const state=args.state&&typeof args.state==="object"?args.state:{};
        const items=Array.isArray(state.items)?state.items:[];
        await c.query("BEGIN");
        try{
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`bwk-followers:${namespace}`]);
          const existing=await c.query(`SELECT revision FROM twitch_follower_cache_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
          if(existing.rowCount){await c.query("ROLLBACK");return {inserted:false,revision:Number(existing.rows[0].revision||1)};}
          const updatedAt=state.updatedAt||null;
          const total=Math.max(0,Number(state.total||items.length||0));
          await c.query(`INSERT INTO twitch_follower_cache_meta(namespace,total,revision,updated_at) VALUES($1,$2,1,$3)`,[namespace,total,updatedAt]);
          if(items.length){
            await c.query(`
              INSERT INTO twitch_followers(namespace,twitch_user_id,login,display_name,followed_at,updated_at)
              SELECT $1,
                     elem->>'userId',
                     COALESCE(elem->>'login',''),
                     COALESCE(elem->>'name',elem->>'login',''),
                     NULLIF(elem->>'followedAt','')::timestamptz,
                     now()
              FROM jsonb_array_elements($2::jsonb) elem
              WHERE COALESCE(elem->>'userId','')<>''
              ON CONFLICT(namespace,twitch_user_id) DO UPDATE SET
                login=EXCLUDED.login,display_name=EXCLUDED.display_name,followed_at=EXCLUDED.followed_at,updated_at=now()
            `,[namespace,JSON.stringify(items)]);
          }
          await c.query("COMMIT");
          return {inserted:true,rows:items.length,revision:1};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "follower_cache_replace": {
        const namespace=String(args.namespace||"twitch");
        const state=args.state&&typeof args.state==="object"?args.state:{};
        const items=Array.isArray(state.items)?state.items:[];
        await c.query("BEGIN");
        try{
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`bwk-followers:${namespace}`]);
          const current=await c.query(`SELECT revision FROM twitch_follower_cache_meta WHERE namespace=$1 FOR UPDATE`,[namespace]);
          const revision=(current.rowCount?Number(current.rows[0].revision||1):0)+1;
          await c.query(`DELETE FROM twitch_followers WHERE namespace=$1`,[namespace]);
          if(items.length){
            await c.query(`
              INSERT INTO twitch_followers(namespace,twitch_user_id,login,display_name,followed_at,updated_at)
              SELECT $1,
                     elem->>'userId',
                     COALESCE(elem->>'login',''),
                     COALESCE(elem->>'name',elem->>'login',''),
                     NULLIF(elem->>'followedAt','')::timestamptz,
                     now()
              FROM jsonb_array_elements($2::jsonb) elem
              WHERE COALESCE(elem->>'userId','')<>''
              ON CONFLICT(namespace,twitch_user_id) DO UPDATE SET
                login=EXCLUDED.login,display_name=EXCLUDED.display_name,followed_at=EXCLUDED.followed_at,updated_at=now()
            `,[namespace,JSON.stringify(items)]);
          }
          const total=Math.max(0,Number(state.total||items.length||0));
          const updatedAt=state.updatedAt||new Date().toISOString();
          await c.query(`
            INSERT INTO twitch_follower_cache_meta(namespace,total,revision,updated_at)
            VALUES($1,$2,$3,$4)
            ON CONFLICT(namespace) DO UPDATE SET total=EXCLUDED.total,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at
          `,[namespace,total,revision,updatedAt]);
          await c.query("COMMIT");
          return {ok:true,rows:items.length,total,revision,updatedAt};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "follower_cache_meta": {
        const namespace=String(args.namespace||"twitch");
        const r=await c.query(`SELECT total,revision,updated_at FROM twitch_follower_cache_meta WHERE namespace=$1`,[namespace]);
        const n=await c.query(`SELECT count(*)::bigint AS n FROM twitch_followers WHERE namespace=$1`,[namespace]);
        return r.rowCount?{found:true,total:Number(r.rows[0].total||0),rows:Number(n.rows[0].n||0),revision:Number(r.rows[0].revision||1),updatedAt:pgIso(r.rows[0].updated_at)}:{found:false,total:0,rows:Number(n.rows[0].n||0),revision:0,updatedAt:null};
      }
      case "message_count_ensure": {
        const namespace=String(args.namespace||"twitch"),channelId=String(args.channelId||"");
        if(!channelId)throw new Error("channelId fehlt.");
        await c.query(`INSERT INTO twitch_message_count_meta(namespace,channel_id) VALUES($1,$2) ON CONFLICT(namespace,channel_id) DO NOTHING`,[namespace,channelId]);
        const r=await c.query(`SELECT tracking_started_at,updated_at FROM twitch_message_count_meta WHERE namespace=$1 AND channel_id=$2`,[namespace,channelId]);
        return {trackingStartedAt:pgIso(r.rows[0]?.tracking_started_at),updatedAt:pgIso(r.rows[0]?.updated_at)};
      }
      case "message_count_apply_batch": {
        const namespace=String(args.namespace||"twitch"),channelId=String(args.channelId||""),batchId=String(args.batchId||"");
        const rows=Array.isArray(args.rows)?args.rows:[];
        if(!channelId||!batchId||!rows.length)return {applied:false,rows:0};
        await c.query("BEGIN");
        try{
          await c.query(`INSERT INTO twitch_message_count_meta(namespace,channel_id) VALUES($1,$2) ON CONFLICT(namespace,channel_id) DO NOTHING`,[namespace,channelId]);
          const claim=await c.query(`INSERT INTO twitch_message_count_batches(namespace,channel_id,batch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING batch_id`,[namespace,channelId,batchId]);
          if(!claim.rowCount){await c.query("COMMIT");return {applied:false,duplicate:true,rows:0};}
          for(const x of rows){
            const delta=Math.max(0,Math.floor(Number(x.delta||0)));if(!delta)continue;
            await c.query(`INSERT INTO twitch_message_counts(namespace,channel_id,twitch_user_id,login,display_name,total,first_counted_at,last_counted_at,last_message_id,updated_at)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
              ON CONFLICT(namespace,channel_id,twitch_user_id) DO UPDATE SET
                login=CASE WHEN EXCLUDED.login<>'' THEN EXCLUDED.login ELSE twitch_message_counts.login END,
                display_name=CASE WHEN EXCLUDED.display_name<>'' THEN EXCLUDED.display_name ELSE twitch_message_counts.display_name END,
                total=twitch_message_counts.total+EXCLUDED.total,
                last_counted_at=GREATEST(twitch_message_counts.last_counted_at,EXCLUDED.last_counted_at),
                last_message_id=COALESCE(EXCLUDED.last_message_id,twitch_message_counts.last_message_id),
                updated_at=now()`,[namespace,channelId,String(x.userId||""),String(x.login||""),String(x.name||""),delta,safeTimestamp(x.firstCountedAt),safeTimestamp(x.lastCountedAt),x.lastMessageId||null]);
            // A daily bucket is updated in the SAME transaction and under the SAME batch id.
            // Older callers without an explicit day use the timestamp of their batch.
            const day=/^\d{4}-\d{2}-\d{2}$/.test(String(x.day||""))?x.day:new Date(x.lastCountedAt||Date.now()).toISOString().slice(0,10);
            await c.query(`INSERT INTO twitch_message_count_daily(namespace,channel_id,twitch_user_id,day,total)
              VALUES($1,$2,$3,$4,$5)
              ON CONFLICT(namespace,channel_id,twitch_user_id,day) DO UPDATE SET
                total=twitch_message_count_daily.total+EXCLUDED.total`,
              [namespace,channelId,String(x.userId||""),day,delta]);
          }
          await c.query(`UPDATE twitch_message_count_meta SET updated_at=now() WHERE namespace=$1 AND channel_id=$2`,[namespace,channelId]);
          await c.query(`DELETE FROM twitch_message_count_batches WHERE namespace=$1 AND channel_id=$2 AND applied_at < now()-interval '7 days'`,[namespace,channelId]);
          await c.query("COMMIT");return {applied:true,rows:rows.length};
        }catch(e){await c.query("ROLLBACK");throw e;}
      }
      case "message_count_get": {
        const namespace=String(args.namespace||"twitch"),channelId=String(args.channelId||""),userId=String(args.userId||"");
        const r=await c.query(`SELECT total,login,display_name,first_counted_at,last_counted_at,last_message_id FROM twitch_message_counts WHERE namespace=$1 AND channel_id=$2 AND twitch_user_id=$3`,[namespace,channelId,userId]);
        return r.rowCount?{total:Number(r.rows[0].total||0),login:r.rows[0].login||"",name:r.rows[0].display_name||"",firstCountedAt:pgIso(r.rows[0].first_counted_at),lastCountedAt:pgIso(r.rows[0].last_counted_at),lastMessageId:r.rows[0].last_message_id||null}:{total:0};
      }
      case "message_count_meta": {
        const namespace=String(args.namespace||"twitch"),channelId=String(args.channelId||"");
        const m=await c.query(`SELECT tracking_started_at,updated_at FROM twitch_message_count_meta WHERE namespace=$1 AND channel_id=$2`,[namespace,channelId]);
        const n=await c.query(`SELECT count(*)::bigint AS users,COALESCE(sum(total),0)::bigint AS total FROM twitch_message_counts WHERE namespace=$1 AND channel_id=$2`,[namespace,channelId]);
        return {trackingStartedAt:pgIso(m.rows[0]?.tracking_started_at),updatedAt:pgIso(m.rows[0]?.updated_at),users:Number(n.rows[0]?.users||0),total:Number(n.rows[0]?.total||0)};
      }
      case "message_count_leaderboard": {
        const namespace=String(args.namespace||"twitch"),channelId=String(args.channelId||"");
        const days=Number(args.days)===30?30:0;
        const limit=Math.max(1,Math.min(100,Number(args.limit||50)));
        const base=days===30
          ? `SELECT twitch_user_id,SUM(total)::bigint AS messages FROM twitch_message_count_daily
             WHERE namespace=$1 AND channel_id=$2 AND day >= (now() AT TIME ZONE 'Europe/Berlin')::date - 29 GROUP BY twitch_user_id`
          : `SELECT twitch_user_id,total::bigint AS messages FROM twitch_message_counts WHERE namespace=$1 AND channel_id=$2`;
        const r=await c.query(`SELECT x.twitch_user_id,mc.login,mc.display_name,mc.total AS lifetime,x.messages,
          EXISTS(SELECT 1 FROM twitch_followers f WHERE f.namespace=$1 AND f.twitch_user_id=x.twitch_user_id) AS follower
          FROM (${base}) x JOIN twitch_message_counts mc ON mc.namespace=$1 AND mc.channel_id=$2 AND mc.twitch_user_id=x.twitch_user_id
          ORDER BY x.messages DESC,x.twitch_user_id ASC LIMIT $3`,[namespace,channelId,limit]);
        const totals=await c.query(`SELECT COUNT(*)::bigint AS users,COALESCE(SUM(messages),0)::bigint AS messages FROM (${base}) x`,[namespace,channelId]);
        return {days,users:Number(totals.rows[0]?.users||0),messages:Number(totals.rows[0]?.messages||0),
          rows:r.rows.map(x=>({userId:x.twitch_user_id,login:x.login||"",name:x.display_name||x.login||x.twitch_user_id,
            messages:Number(x.messages||0),lifetime:Number(x.lifetime||0),follower:!!x.follower}))};
      }
      case "message_count_export": {
        const namespace=String(args.namespace||"twitch"),channelId=String(args.channelId||"");
        const meta=await operation("message_count_meta",{namespace,channelId});
        const r=await c.query(`SELECT twitch_user_id,login,display_name,total,first_counted_at,last_counted_at,last_message_id FROM twitch_message_counts WHERE namespace=$1 AND channel_id=$2 ORDER BY total DESC,twitch_user_id`,[namespace,channelId]);
        const daily=await c.query(`SELECT twitch_user_id,to_char(day,'YYYY-MM-DD') AS day,total FROM twitch_message_count_daily WHERE namespace=$1 AND channel_id=$2 ORDER BY day DESC,twitch_user_id`,[namespace,channelId]);
        return {channelId,trackingStartedAt:meta.trackingStartedAt,updatedAt:meta.updatedAt,daily:daily.rows.map(x=>({userId:x.twitch_user_id,day:String(x.day instanceof Date?x.day.toISOString().slice(0,10):x.day).slice(0,10),total:Number(x.total||0)})),users:r.rows.map(x=>({userId:x.twitch_user_id,login:x.login||"",name:x.display_name||"",total:Number(x.total||0),firstCountedAt:pgIso(x.first_counted_at),lastCountedAt:pgIso(x.last_counted_at),lastMessageId:x.last_message_id||null}))};
      }

      case "follower_cache_query": {
        const namespace=String(args.namespace||"twitch");
        const pageSize=Math.max(1,Math.min(500,Number(args.pageSize||100)));
        const page=Math.max(1,Number(args.page||1));
        const sort=String(args.sort||"newest");
        const channelId=String(args.channelId||"");
        const order=sort==="oldest"?`f.followed_at ASC NULLS LAST,f.twitch_user_id`:
          sort==="az"?`lower(f.display_name) ASC,lower(f.login) ASC,f.twitch_user_id`:
          sort==="za"?`lower(f.display_name) DESC,lower(f.login) DESC,f.twitch_user_id`:
          sort==="messages_desc"?`COALESCE(mc.total,0) DESC,lower(f.display_name),f.twitch_user_id`:
          sort==="messages_asc"?`COALESCE(mc.total,0) ASC,lower(f.display_name),f.twitch_user_id`:
          `f.followed_at DESC NULLS LAST,f.twitch_user_id`;
        const count=await c.query(`SELECT count(*)::bigint AS n FROM twitch_followers WHERE namespace=$1`,[namespace]);
        const rows=Number(count.rows[0].n||0);
        const totalPages=Math.max(1,Math.ceil(rows/pageSize));
        const finalPage=Math.min(page,totalPages);
        const offset=(finalPage-1)*pageSize;
        const r=await c.query(`SELECT f.twitch_user_id,f.login,f.display_name,f.followed_at,COALESCE(mc.total,0)::bigint AS message_count
          FROM twitch_followers f LEFT JOIN twitch_message_counts mc ON mc.namespace=f.namespace AND mc.channel_id=$4 AND mc.twitch_user_id=f.twitch_user_id
          WHERE f.namespace=$1 ORDER BY ${order} LIMIT $2 OFFSET $3`,[namespace,pageSize,offset,channelId]);
        const latest=await c.query(`SELECT f.twitch_user_id,f.login,f.display_name,f.followed_at,COALESCE(mc.total,0)::bigint AS message_count
          FROM twitch_followers f LEFT JOIN twitch_message_counts mc ON mc.namespace=f.namespace AND mc.channel_id=$2 AND mc.twitch_user_id=f.twitch_user_id
          WHERE f.namespace=$1 ORDER BY f.followed_at DESC NULLS LAST,f.twitch_user_id LIMIT 1`,[namespace,channelId]);
        const meta=await c.query(`SELECT total,revision,updated_at FROM twitch_follower_cache_meta WHERE namespace=$1`,[namespace]);
        const msgMeta=channelId?await c.query(`SELECT tracking_started_at FROM twitch_message_count_meta WHERE namespace=$1 AND channel_id=$2`,[namespace,channelId]):{rows:[]};
        const mapRow=x=>({userId:x.twitch_user_id,login:x.login||"",name:x.display_name||x.login||x.twitch_user_id,followedAt:pgIso(x.followed_at),messageCount:Number(x.message_count||0)});
        return {rows,total:Number(meta.rows[0]?.total||rows),data:r.rows.map(mapRow),page:finalPage,pageSize,totalPages,sort,updatedAt:pgIso(meta.rows[0]?.updated_at),revision:Number(meta.rows[0]?.revision||0),latest:latest.rowCount?mapRow(latest.rows[0]):null,messageTrackingStartedAt:pgIso(msgMeta.rows?.[0]?.tracking_started_at)};
      }
      case "follower_cache_export": {
        const namespace=String(args.namespace||"twitch");
        const meta=await c.query(`SELECT total,updated_at FROM twitch_follower_cache_meta WHERE namespace=$1`,[namespace]);
        const r=await c.query(`SELECT twitch_user_id,login,display_name,followed_at FROM twitch_followers WHERE namespace=$1 ORDER BY followed_at DESC NULLS LAST,twitch_user_id`,[namespace]);
        const items=r.rows.map(x=>({userId:x.twitch_user_id,login:x.login||"",name:x.display_name||x.login||x.twitch_user_id,followedAt:pgIso(x.followed_at)}));
        return {items,total:Number(meta.rows[0]?.total||items.length),updatedAt:pgIso(meta.rows[0]?.updated_at)};
      }
      case "usage_stats_import_if_empty": {
        const namespace=String(args.namespace||"twitch"),state=args.state&&typeof args.state==="object"?args.state:{};
        const rows=[];
        for(const kind of ["commands","autoReplies"]){
          const bucket=state[kind]&&typeof state[kind]==="object"&&!Array.isArray(state[kind])?state[kind]:{};
          for(const [itemId,raw] of Object.entries(bucket)){
            if(!itemId)continue;const x=raw&&typeof raw==="object"?raw:{};
            rows.push({kind,itemId,total:Math.max(0,Number(x.total||0)),todayDate:x.todayDate||null,todayCount:Math.max(0,Number(x.todayCount||0)),streamId:x.streamId||null,streamCount:Math.max(0,Number(x.streamCount||0)),lastTriggeredAt:x.lastTriggeredAt||null,lastUser:x.lastUser||null,lastInput:x.lastInput||null});
          }
        }
        await c.query("BEGIN");
        try{
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`bwk-usage-stats:${namespace}`]);
          const existing=await c.query(`SELECT 1 FROM twitch_usage_stats WHERE namespace=$1 LIMIT 1`,[namespace]);
          if(existing.rowCount){await c.query("ROLLBACK");return {inserted:false,rows:0};}
          for(const x of rows){await c.query(`INSERT INTO twitch_usage_stats(namespace,kind,item_id,total,today_date,today_count,stream_id,stream_count,last_triggered_at,last_user,last_input,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,[namespace,x.kind,x.itemId,x.total,x.todayDate,x.todayCount,x.streamId,x.streamCount,x.lastTriggeredAt,x.lastUser,x.lastInput]);}
          await c.query("COMMIT");return {inserted:true,rows:rows.length};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "usage_stats_record": {
        const namespace=String(args.namespace||"twitch"),kind=String(args.kind||""),itemId=String(args.itemId||"");
        if(!["commands","autoReplies"].includes(kind)||!itemId)return {ok:false};
        const today=String(args.today||"")||null,streamId=args.streamId?String(args.streamId):null,ts=args.ts||new Date().toISOString();
        const r=await c.query(`
          INSERT INTO twitch_usage_stats(namespace,kind,item_id,total,today_date,today_count,stream_id,stream_count,last_triggered_at,last_user,last_input,updated_at)
          VALUES($1,$2,$3,1,$4,1,$5,CASE WHEN $5::text IS NULL THEN 0 ELSE 1 END,$6,$7,$8,now())
          ON CONFLICT(namespace,kind,item_id) DO UPDATE SET
            total=twitch_usage_stats.total+1,
            today_date=EXCLUDED.today_date,
            today_count=CASE WHEN twitch_usage_stats.today_date=EXCLUDED.today_date THEN twitch_usage_stats.today_count+1 ELSE 1 END,
            stream_id=EXCLUDED.stream_id,
            stream_count=CASE WHEN EXCLUDED.stream_id IS NULL THEN twitch_usage_stats.stream_count WHEN twitch_usage_stats.stream_id=EXCLUDED.stream_id THEN twitch_usage_stats.stream_count+1 ELSE 1 END,
            last_triggered_at=EXCLUDED.last_triggered_at,last_user=EXCLUDED.last_user,last_input=EXCLUDED.last_input,updated_at=now()
          RETURNING total,today_date,today_count,stream_id,stream_count,last_triggered_at,last_user,last_input
        `,[namespace,kind,itemId,today,streamId,ts,args.user||null,args.input||null]);
        return {ok:true,row:r.rows[0]||null};
      }
      case "usage_stats_export": {
        const namespace=String(args.namespace||"twitch");
        const r=await c.query(`SELECT kind,item_id,total,to_char(today_date,'YYYY-MM-DD') AS today_date,today_count,stream_id,stream_count,last_triggered_at,last_user,last_input,updated_at FROM twitch_usage_stats WHERE namespace=$1 ORDER BY kind,item_id`,[namespace]);
        const out={commands:{},autoReplies:{},updatedAt:null};let latest=null;
        for(const x of r.rows){const bucket=x.kind==="autoReplies"?out.autoReplies:out.commands;bucket[x.item_id]={total:Number(x.total||0),todayDate:x.today_date?String(x.today_date).slice(0,10):null,todayCount:Number(x.today_count||0),streamId:x.stream_id||null,streamCount:Number(x.stream_count||0),lastTriggeredAt:pgIso(x.last_triggered_at),lastUser:x.last_user||null,lastInput:x.last_input||null};if(!latest||new Date(x.updated_at)>new Date(latest))latest=x.updated_at;}
        out.updatedAt=pgIso(latest);return out;
      }
      case "usage_stats_replace": {
        const namespace=String(args.namespace||"twitch");
        await c.query(`DELETE FROM twitch_usage_stats WHERE namespace=$1`,[namespace]);
        return await operation("usage_stats_import_if_empty",{namespace,state:args.state||{}});
      }
      case "usage_stats_counts": {
        const namespace=String(args.namespace||"twitch"),out={};
        let r=await c.query(`SELECT count(*)::bigint AS n,COALESCE(sum(total),0)::bigint AS total,max(updated_at) AS updated_at FROM twitch_usage_stats WHERE namespace=$1`,[namespace]);
        out.usage_stats_rows=Number(r.rows[0].n||0);out.usage_stats_total=Number(r.rows[0].total||0);out.usage_stats_updated_at=r.rows[0].updated_at||null;
        r=await c.query(`SELECT count(*)::bigint AS n FROM twitch_usage_stats WHERE namespace=$1 AND kind='commands'`,[namespace]);out.usage_stats_commands=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM twitch_usage_stats WHERE namespace=$1 AND kind='autoReplies'`,[namespace]);out.usage_stats_autoreplies=Number(r.rows[0].n||0);return out;
      }
      case "discord_analytics_import_if_empty": {
        const namespace=String(args.namespace||"twitch"),state=args.state&&typeof args.state==="object"?args.state:{};const snaps=Array.isArray(state.snapshots)?state.snapshots:[];
        const existing=await c.query(`SELECT 1 FROM discord_analytics_snapshots WHERE namespace=$1 LIMIT 1`,[namespace]);if(existing.rowCount)return {inserted:false,rows:0};
        for(const x of snaps){if(!x?.date||!Number.isFinite(Number(x.memberCount)))continue;await c.query(`INSERT INTO discord_analytics_snapshots(namespace,snapshot_date,member_count,captured_at,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(namespace,snapshot_date) DO UPDATE SET member_count=EXCLUDED.member_count,captured_at=EXCLUDED.captured_at,updated_at=now()`,[namespace,String(x.date),Math.max(0,Number(x.memberCount)),x.capturedAt||`${x.date}T00:00:00Z`]);}
        return {inserted:true,rows:snaps.length};
      }
      case "discord_analytics_upsert": {
        const namespace=String(args.namespace||"twitch"),date=String(args.date||""),count=Math.max(0,Number(args.memberCount||0)),capturedAt=args.capturedAt||new Date().toISOString();if(!date)return {ok:false};
        await c.query(`INSERT INTO discord_analytics_snapshots(namespace,snapshot_date,member_count,captured_at,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(namespace,snapshot_date) DO UPDATE SET member_count=EXCLUDED.member_count,captured_at=EXCLUDED.captured_at,updated_at=now()`,[namespace,date,count,capturedAt]);return {ok:true};
      }
      case "discord_analytics_export": {
        const namespace=String(args.namespace||"twitch");const r=await c.query(`SELECT to_char(snapshot_date,'YYYY-MM-DD') AS snapshot_date,member_count,captured_at,updated_at FROM discord_analytics_snapshots WHERE namespace=$1 ORDER BY snapshot_date`,[namespace]);
        return {snapshots:r.rows.map(x=>({date:pgDateOnly(x.snapshot_date),memberCount:Number(x.member_count||0),capturedAt:pgIso(x.captured_at)})),updatedAt:r.rowCount?pgIso(r.rows[r.rows.length-1].updated_at):null};
      }
      case "discord_analytics_replace": {
        const namespace=String(args.namespace||"twitch");await c.query(`DELETE FROM discord_analytics_snapshots WHERE namespace=$1`,[namespace]);return await operation("discord_analytics_import_if_empty",{namespace,state:args.state||{}});
      }
      case "discord_analytics_counts": {
        const namespace=String(args.namespace||"twitch");const r=await c.query(`SELECT count(*)::bigint AS n,to_char(max(snapshot_date),'YYYY-MM-DD') AS last_date,max(updated_at) AS updated_at FROM discord_analytics_snapshots WHERE namespace=$1`,[namespace]);return {discord_analytics_snapshots:Number(r.rows[0].n||0),discord_analytics_last_date:r.rows[0].last_date?String(r.rows[0].last_date).slice(0,10):null,discord_analytics_updated_at:r.rows[0].updated_at||null};
      }
      case "database_metrics": {
        const db=await c.query(`SELECT pg_database_size(current_database())::bigint AS bytes,current_database() AS database,current_user AS db_user`);
        const tables=await c.query(`SELECT count(*)::bigint AS n FROM pg_tables WHERE schemaname='public'`);
        const indexes=await c.query(`SELECT count(*)::bigint AS n FROM pg_indexes WHERE schemaname='public'`);
        return {databaseBytes:Number(db.rows[0].bytes||0),database:db.rows[0].database,dbUser:db.rows[0].db_user,tables:Number(tables.rows[0].n||0),indexes:Number(indexes.rows[0].n||0)};
      }

      case "word_filter_snapshot": {
        const meta=await c.query(`SELECT revision,retention_days,updated_at FROM word_filter_meta WHERE id=1`);
        const categories=(await c.query(`SELECT category_id,name,sort_order,builtin FROM word_filter_categories ORDER BY sort_order,name`)).rows;
        const terms=(await c.query(`
          SELECT t.term_id,t.term,t.normalized_term,t.category_id,t.severity,t.origin,t.source_name,t.source_version,
                 t.detection_type,t.enabled,t.test_only,t.leetspeak,t.repeat_letters,t.flex_separators,t.umlauts,
                 t.import_id,t.created_by,t.metadata,t.created_at,t.updated_at,
                 COALESCE(json_agg(json_build_object('platform',p.platform,'enabled',p.enabled,'action',p.action,'timeout_seconds',p.timeout_seconds)
                   ORDER BY p.platform) FILTER (WHERE p.platform IS NOT NULL),'[]'::json) AS platforms
          FROM word_filter_terms t
          LEFT JOIN word_filter_platform_rules p ON p.term_id=t.term_id
          GROUP BY t.term_id
          ORDER BY lower(t.term),t.term_id
        `)).rows;
        const allowlist=(await c.query(`SELECT allow_id,value,normalized_value,platform,match_type,enabled,note,created_by,created_at FROM word_filter_allowlist ORDER BY lower(value),allow_id`)).rows;
        const policies=(await c.query(`SELECT category_id,platform,action,timeout_seconds,escalate,message_template FROM word_filter_category_policies ORDER BY category_id,platform`)).rows;
        const imports=(await c.query(`SELECT * FROM word_filter_imports ORDER BY created_at DESC LIMIT 50`)).rows;
        const stats=(await c.query(`
          SELECT t.term_id,t.term,count(h.hit_id)::bigint AS hits,
                 count(h.hit_id) FILTER (WHERE h.false_positive)::bigint AS false_positives,
                 max(h.occurred_at) AS last_hit_at
          FROM word_filter_terms t LEFT JOIN word_filter_hits h ON h.term_id=t.term_id
          GROUP BY t.term_id,t.term ORDER BY count(h.hit_id) DESC,t.term
          LIMIT 250
        `)).rows;
        return {revision:Number(meta.rows[0]?.revision||1),retentionDays:Number(meta.rows[0]?.retention_days||90),updatedAt:meta.rows[0]?.updated_at||null,categories,terms,allowlist,policies,imports,stats};
      }
      case "word_filter_revision": {
        const r=await c.query(`SELECT revision,updated_at FROM word_filter_meta WHERE id=1`);
        return {revision:Number(r.rows[0]?.revision||1),updatedAt:r.rows[0]?.updated_at||null};
      }
      case "word_filter_upsert_term": {
        const x=args.term||{},id=String(x.term_id||x.id||"").trim();
        if(!id)throw new Error("term_id fehlt.");
        const norm=String(x.normalized_term||x.term||"").normalize("NFKC").toLocaleLowerCase("de-DE").trim();
        await c.query("BEGIN");
        try{
          await c.query(`INSERT INTO word_filter_terms(term_id,term,normalized_term,category_id,severity,origin,source_name,source_version,detection_type,enabled,test_only,leetspeak,repeat_letters,flex_separators,umlauts,import_id,created_by,metadata)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT(term_id) DO UPDATE SET term=EXCLUDED.term,normalized_term=EXCLUDED.normalized_term,category_id=EXCLUDED.category_id,
              severity=EXCLUDED.severity,origin=EXCLUDED.origin,source_name=EXCLUDED.source_name,source_version=EXCLUDED.source_version,
              detection_type=EXCLUDED.detection_type,enabled=EXCLUDED.enabled,test_only=EXCLUDED.test_only,leetspeak=EXCLUDED.leetspeak,
              repeat_letters=EXCLUDED.repeat_letters,flex_separators=EXCLUDED.flex_separators,umlauts=EXCLUDED.umlauts,metadata=EXCLUDED.metadata,updated_at=now()`,
            [id,String(x.term||"").trim(),norm,String(x.category_id||"benutzerdefiniert"),Math.max(1,Math.min(5,Number(x.severity||2))),
             String(x.origin||"manual"),x.source_name||null,x.source_version||null,String(x.detection_type||"whole_word"),x.enabled!==false,x.test_only===true,
             x.leetspeak===true,x.repeat_letters===true,x.flex_separators===true,x.umlauts!==false,x.import_id||null,x.created_by||null,safeJson(x.metadata||{})]);
          for(const platform of ["twitch","discord"]){
            const pr=(x.platforms||[]).find(v=>v.platform===platform)||{};
            await c.query(`INSERT INTO word_filter_platform_rules(term_id,platform,enabled,action,timeout_seconds)
              VALUES($1,$2,$3,$4,$5)
              ON CONFLICT(term_id,platform) DO UPDATE SET enabled=EXCLUDED.enabled,action=EXCLUDED.action,timeout_seconds=EXCLUDED.timeout_seconds,updated_at=now()`,
              [id,platform,pr.enabled===true,pr.action||null,pr.timeout_seconds==null?null:Number(pr.timeout_seconds)]);
          }
          await c.query(`UPDATE word_filter_meta SET revision=revision+1,updated_at=now() WHERE id=1`);
          await c.query("COMMIT");
        }catch(e){await c.query("ROLLBACK");throw e;}
        return {ok:true};
      }
      case "word_filter_delete_term": {
        await c.query(`DELETE FROM word_filter_terms WHERE term_id=$1`,[String(args.termId||"")]);
        await c.query(`UPDATE word_filter_meta SET revision=revision+1,updated_at=now() WHERE id=1`);
        return {ok:true};
      }
      case "word_filter_upsert_category": {
        const x=args.category||{},id=String(x.category_id||x.id||"").trim();
        if(!id)throw new Error("category_id fehlt.");
        await c.query(`INSERT INTO word_filter_categories(category_id,name,sort_order,builtin) VALUES($1,$2,$3,$4)
          ON CONFLICT(category_id) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,updated_at=now()`,
          [id,String(x.name||id),Number(x.sort_order||100),x.builtin===true]);
        await c.query(`UPDATE word_filter_meta SET revision=revision+1,updated_at=now() WHERE id=1`);
        return {ok:true};
      }
      case "word_filter_set_policy": {
        const x=args.policy||{};
        await c.query(`INSERT INTO word_filter_category_policies(category_id,platform,action,timeout_seconds,escalate,message_template) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(category_id,platform) DO UPDATE SET action=EXCLUDED.action,timeout_seconds=EXCLUDED.timeout_seconds,escalate=EXCLUDED.escalate,message_template=EXCLUDED.message_template,updated_at=now()`,
          [x.category_id,x.platform,x.action||"log",x.timeout_seconds==null?null:Number(x.timeout_seconds),x.escalate===true,x.message_template==null?null:String(x.message_template).slice(0,1800)]);
        await c.query(`UPDATE word_filter_meta SET revision=revision+1,updated_at=now() WHERE id=1`);
        return {ok:true};
      }
      case "word_filter_upsert_allow": {
        const x=args.item||{},id=String(x.allow_id||x.id||"").trim();if(!id)throw new Error("allow_id fehlt.");
        const norm=String(x.value||"").normalize("NFKC").toLocaleLowerCase("de-DE").trim();
        await c.query(`INSERT INTO word_filter_allowlist(allow_id,value,normalized_value,platform,match_type,enabled,note,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(allow_id) DO UPDATE SET value=EXCLUDED.value,normalized_value=EXCLUDED.normalized_value,platform=EXCLUDED.platform,match_type=EXCLUDED.match_type,enabled=EXCLUDED.enabled,note=EXCLUDED.note`,
          [id,String(x.value||"").trim(),norm,x.platform||"both",x.match_type||"phrase",x.enabled!==false,x.note||null,x.created_by||null]);
        await c.query(`UPDATE word_filter_meta SET revision=revision+1,updated_at=now() WHERE id=1`);
        return {ok:true};
      }
      case "word_filter_delete_allow": {
        await c.query(`DELETE FROM word_filter_allowlist WHERE allow_id=$1`,[String(args.allowId||"")]);
        await c.query(`UPDATE word_filter_meta SET revision=revision+1,updated_at=now() WHERE id=1`);
        return {ok:true};
      }
      case "word_filter_import": {
        const imp=args.importData||{},rows=Array.isArray(imp.terms)?imp.terms:[],importId=String(imp.import_id||"");
        let inserted=0,duplicates=0;
        await c.query("BEGIN");
        try{
          await c.query(`INSERT INTO word_filter_imports(import_id,source_name,source_license,filename,format,row_count,inserted_count,duplicate_count,status,created_by)
            VALUES($1,$2,$3,$4,$5,$6,0,0,'applied',$7)`,
            [importId,String(imp.source_name||"import"),imp.source_license||null,imp.filename||null,imp.format||null,rows.length,imp.created_by||null]);
          for(const x of rows){
            const norm=String(x.term||"").normalize("NFKC").toLocaleLowerCase("de-DE").trim();
            if(!norm)continue;
            const existing=await c.query(`SELECT term_id FROM word_filter_terms WHERE normalized_term=$1 AND detection_type=$2`,[norm,x.detection_type||"whole_word"]);
            if(existing.rowCount){
              duplicates++;const existingId=existing.rows[0].term_id;
              if(imp.merge_platforms_on_duplicate===true&&Array.isArray(x.platforms)){
                for(const platform of ["twitch","discord"]){
                  const obj=x.platforms.find(v=>typeof v==="object"&&v.platform===platform);
                  if(!obj||obj.enabled===false)continue;
                  await c.query(`INSERT INTO word_filter_platform_rules(term_id,platform,enabled,action,timeout_seconds) VALUES($1,$2,true,$3,$4)
                    ON CONFLICT(term_id,platform) DO UPDATE SET enabled=true,action=COALESCE(word_filter_platform_rules.action,EXCLUDED.action),timeout_seconds=COALESCE(word_filter_platform_rules.timeout_seconds,EXCLUDED.timeout_seconds),updated_at=now()`,
                    [existingId,platform,obj.action||null,obj.timeout_seconds==null?null:Number(obj.timeout_seconds)]);
                }
              }
              await c.query(`INSERT INTO word_filter_import_items(import_id,term_id,was_inserted) VALUES($1,$2,false) ON CONFLICT DO NOTHING`,[importId,existingId]);continue;
            }
            const id=String(x.term_id||`${importId}-${inserted+1}`);
            await c.query(`INSERT INTO word_filter_terms(term_id,term,normalized_term,category_id,severity,origin,source_name,source_version,detection_type,enabled,test_only,leetspeak,repeat_letters,flex_separators,umlauts,import_id,created_by,metadata)
              VALUES($1,$2,$3,$4,$5,'import',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
              [id,String(x.term||"").trim(),norm,x.category_id||"benutzerdefiniert",Math.max(1,Math.min(5,Number(x.severity||2))),
               imp.source_name||x.source_name||"import",imp.source_version||x.source_version||null,x.detection_type||"whole_word",x.enabled===true,x.test_only!==false,
               x.leetspeak===true,x.repeat_letters===true,x.flex_separators===true,x.umlauts!==false,importId,imp.created_by||null,safeJson(x.metadata||{})]);
            for(const platform of ["twitch","discord"]){
              let enabled=false,action=null,timeoutSeconds=null;
              if(Array.isArray(x.platforms)){
                const obj=x.platforms.find(v=>typeof v==="object"&&v.platform===platform);
                enabled=obj?obj.enabled!==false:x.platforms.includes(platform);
                if(obj){action=obj.action||null;timeoutSeconds=obj.timeout_seconds==null?null:Number(obj.timeout_seconds);}
              }
              await c.query(`INSERT INTO word_filter_platform_rules(term_id,platform,enabled,action,timeout_seconds) VALUES($1,$2,$3,$4,$5)`,[id,platform,enabled,action,timeoutSeconds]);
            }
            await c.query(`INSERT INTO word_filter_import_items(import_id,term_id,was_inserted) VALUES($1,$2,true)`,[importId,id]);
            inserted++;
          }
          await c.query(`UPDATE word_filter_imports SET inserted_count=$2,duplicate_count=$3 WHERE import_id=$1`,[importId,inserted,duplicates]);
          await c.query(`UPDATE word_filter_meta SET revision=revision+1,updated_at=now() WHERE id=1`);
          await c.query("COMMIT");
        }catch(e){await c.query("ROLLBACK");throw e;}
        return {ok:true,inserted,duplicates,total:rows.length,importId};
      }
      case "word_filter_rollback_import": {
        const id=String(args.importId||"");
        await c.query("BEGIN");
        try{
          await c.query(`DELETE FROM word_filter_terms t USING word_filter_import_items i WHERE i.import_id=$1 AND i.term_id=t.term_id AND i.was_inserted=true`,[id]);
          await c.query(`UPDATE word_filter_imports SET status='rolled_back',rolled_back_at=now() WHERE import_id=$1`,[id]);
          await c.query(`UPDATE word_filter_meta SET revision=revision+1,updated_at=now() WHERE id=1`);
          await c.query("COMMIT");
        }catch(e){await c.query("ROLLBACK");throw e;}
        return {ok:true};
      }
      case "word_filter_replace": {
        const snap=args.snapshot||{};
        await c.query("BEGIN");
        try{
          await c.query(`DELETE FROM word_filter_platform_rules`);
          await c.query(`DELETE FROM word_filter_terms`);
          await c.query(`DELETE FROM word_filter_allowlist`);
          await c.query(`DELETE FROM word_filter_category_policies`);
          await c.query(`DELETE FROM word_filter_categories WHERE builtin=false`);
          for(const cat of snap.categories||[])await c.query(`INSERT INTO word_filter_categories(category_id,name,sort_order,builtin) VALUES($1,$2,$3,$4)
            ON CONFLICT(category_id) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order`,[cat.category_id,cat.name,Number(cat.sort_order||100),cat.builtin===true]);
          for(const pol of snap.policies||[])await c.query(`INSERT INTO word_filter_category_policies(category_id,platform,action,timeout_seconds,escalate) VALUES($1,$2,$3,$4,$5)
            ON CONFLICT(category_id,platform) DO UPDATE SET action=EXCLUDED.action,timeout_seconds=EXCLUDED.timeout_seconds,escalate=EXCLUDED.escalate`,
            [pol.category_id,pol.platform,pol.action||"log",pol.timeout_seconds==null?null:Number(pol.timeout_seconds),pol.escalate===true]);
          for(const x of snap.terms||[]){
            await c.query(`INSERT INTO word_filter_terms(term_id,term,normalized_term,category_id,severity,origin,source_name,source_version,detection_type,enabled,test_only,leetspeak,repeat_letters,flex_separators,umlauts,import_id,created_by,metadata)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
              [x.term_id,String(x.term||""),String(x.normalized_term||x.term||"").normalize("NFKC").toLocaleLowerCase("de-DE").trim(),x.category_id||"benutzerdefiniert",Number(x.severity||2),x.origin||"manual",x.source_name||null,x.source_version||null,x.detection_type||"whole_word",x.enabled!==false,x.test_only===true,x.leetspeak===true,x.repeat_letters===true,x.flex_separators===true,x.umlauts!==false,x.import_id||null,x.created_by||null,safeJson(x.metadata||{})]);
            for(const pr of x.platforms||[])await c.query(`INSERT INTO word_filter_platform_rules(term_id,platform,enabled,action,timeout_seconds) VALUES($1,$2,$3,$4,$5)`,
              [x.term_id,pr.platform,pr.enabled!==false,pr.action||null,pr.timeout_seconds==null?null:Number(pr.timeout_seconds)]);
          }
          for(const a of snap.allowlist||[])await c.query(`INSERT INTO word_filter_allowlist(allow_id,value,normalized_value,platform,match_type,enabled,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [a.allow_id,a.value,a.normalized_value||String(a.value||"").normalize("NFKC").toLocaleLowerCase("de-DE").trim(),a.platform||"both",a.match_type||"phrase",a.enabled!==false,a.note||null,a.created_by||null]);
          await c.query(`UPDATE word_filter_meta SET revision=revision+1,updated_at=now() WHERE id=1`);
          await c.query("COMMIT");
        }catch(e){await c.query("ROLLBACK");throw e;}
        return {ok:true};
      }
      case "word_filter_record_hit": {
        const x=args.hit||{};
        await c.query(`INSERT INTO word_filter_hits(term_id,platform,category_id,action,user_id,occurred_at) VALUES($1,$2,$3,$4,$5,COALESCE($6::timestamptz,now()))`,
          [x.term_id||null,x.platform,x.category_id||null,x.action||null,x.user_id||null,x.occurred_at||null]);
        return {ok:true};
      }
      case "word_filter_mark_false_positive": {
        await c.query(`UPDATE word_filter_hits SET false_positive=true WHERE hit_id=$1`,[Number(args.hitId)]);
        return {ok:true};
      }
      case "word_filter_hits": {
        const r=await c.query(`SELECT h.hit_id,h.term_id,t.term,h.platform,h.category_id,h.action,h.user_id,h.occurred_at,h.false_positive
          FROM word_filter_hits h LEFT JOIN word_filter_terms t ON t.term_id=h.term_id ORDER BY h.occurred_at DESC LIMIT $1`,[Math.max(1,Math.min(500,Number(args.limit||100)))]);
        return r.rows;
      }
      case "word_filter_set_retention": {
        const days=Math.max(1,Math.min(3650,Number(args.days||90)));
        await c.query(`UPDATE word_filter_meta SET retention_days=$1,revision=revision+1,updated_at=now() WHERE id=1`,[days]);
        return {ok:true,days};
      }
      case "word_filter_cleanup": {
        let days=args.days==null?null:Number(args.days);
        if(!days){const m=await c.query(`SELECT retention_days FROM word_filter_meta WHERE id=1`);days=Number(m.rows[0]?.retention_days||90);}
        days=Math.max(1,Math.min(3650,days));
        const r=await c.query(`DELETE FROM word_filter_hits WHERE occurred_at < now()-($1::text||' days')::interval RETURNING hit_id`,[days]);
        return {deleted:r.rowCount,days};
      }

      case "eventsub_reserve": {
        if(!args.messageId)return {inserted:true,skipped:true};
        const r=await c.query(`
          INSERT INTO eventsub_messages(message_id,subscription_type,event_timestamp,service)
          VALUES($1,$2,$3,$4)
          ON CONFLICT(message_id) DO NOTHING
        `,[args.messageId,args.subscriptionType||null,args.eventTimestamp||null,args.service||"twitch"]);
        return {inserted:r.rowCount===1};
      }
      case "eventsub_cleanup": {
        const days=Math.max(7,Math.min(365,Number(args.days||90)));
        const r=await c.query(`DELETE FROM eventsub_messages WHERE received_at < now() - ($1::text || ' days')::interval`,[String(days)]);
        return {removed:r.rowCount};
      }
      case "discord_onboarding_get_state": { return discordOnboardingLoad(c,String(args.namespace||"discord")); }
      case "discord_onboarding_import_if_empty": { return discordOnboardingSave(c,String(args.namespace||"discord"),args.state||{}, {ifEmpty:true}); }
      case "discord_onboarding_put_state": { return discordOnboardingSave(c,String(args.namespace||"discord"),args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true}); }
      case "discord_onboarding_counts": { const namespace=String(args.namespace||"discord"),out={};let r=await c.query(`SELECT count(*)::bigint AS n FROM discord_onboarding_members WHERE namespace=$1`,[namespace]);out.discord_onboarding_members=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM discord_onboarding_members WHERE namespace=$1 AND verified_at IS NOT NULL`,[namespace]);out.discord_onboarding_verified=Number(r.rows[0].n||0);r=await c.query(`SELECT revision,updated_at FROM discord_onboarding_meta WHERE namespace=$1`,[namespace]);out.discord_onboarding_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.discord_onboarding_updated_at=r.rows[0]?.updated_at||null;return out; }
      case "discord_reports_get_state": { return discordReportsLoad(c,String(args.namespace||"discord")); }
      case "discord_reports_import_if_empty": { return discordReportsSave(c,String(args.namespace||"discord"),args.tickets||{tickets:[]},args.state||{}, {ifEmpty:true}); }
      case "discord_reports_put_state": { return discordReportsSave(c,String(args.namespace||"discord"),args.tickets||{tickets:[]},args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true}); }
      case "discord_reports_counts": { const namespace=String(args.namespace||"discord"),out={};let r=await c.query(`SELECT count(*)::bigint AS n FROM discord_reports WHERE namespace=$1`,[namespace]);out.discord_reports=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM discord_reports WHERE namespace=$1 AND status='open'`,[namespace]);out.discord_reports_open=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM discord_report_actions WHERE namespace=$1`,[namespace]);out.discord_report_actions=Number(r.rows[0].n||0);r=await c.query(`SELECT revision,updated_at FROM discord_reports_meta WHERE namespace=$1`,[namespace]);out.discord_reports_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.discord_reports_updated_at=r.rows[0]?.updated_at||null;return out; }
      case "discord_social_get_state": { return discordSocialLoad(c,String(args.namespace||"discord")); }
      case "discord_social_import_if_empty": { return discordSocialSave(c,String(args.namespace||"discord"),args.state||{},args.history||{items:[]},{ifEmpty:true}); }
      case "discord_social_put_state": { return discordSocialSave(c,String(args.namespace||"discord"),args.state||{},args.history||{items:[]},{expectedRevision:args.expectedRevision??null,replace:args.replace===true}); }
      case "discord_social_counts": { const namespace=String(args.namespace||"discord"),out={};let r=await c.query(`SELECT count(*)::bigint AS n FROM discord_social_seen WHERE namespace=$1`,[namespace]);out.discord_social_seen=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM discord_social_history WHERE namespace=$1`,[namespace]);out.discord_social_history=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM discord_social_history WHERE namespace=$1 AND status='failed'`,[namespace]);out.discord_social_failed=Number(r.rows[0].n||0);r=await c.query(`SELECT revision,updated_at FROM discord_social_meta WHERE namespace=$1`,[namespace]);out.discord_social_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.discord_social_updated_at=r.rows[0]?.updated_at||null;return out; }

      case "discord_announcements_get_state": { return discordAnnouncementsLoad(c,String(args.namespace||"discord")); }
      case "discord_announcements_import_if_empty": { return discordAnnouncementsSave(c,String(args.namespace||"discord"),args.state||{}, {ifEmpty:true}); }
      case "discord_announcements_put_state": { return discordAnnouncementsSave(c,String(args.namespace||"discord"),args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true}); }
      case "discord_announcements_counts": { const namespace=String(args.namespace||"discord"),out={};let r=await c.query(`SELECT count(*)::bigint AS n FROM discord_announcement_items WHERE namespace=$1 AND type='live'`,[namespace]);out.discord_announcements_live=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM discord_announcement_items WHERE namespace=$1 AND type='clip'`,[namespace]);out.discord_announcements_clips=Number(r.rows[0].n||0);r=await c.query(`SELECT revision,updated_at FROM discord_announcements_meta WHERE namespace=$1`,[namespace]);out.discord_announcements_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.discord_announcements_updated_at=r.rows[0]?.updated_at||null;return out; }
      case "discord_bridge_get_state": { return discordBridgeLoad(c,String(args.namespace||"twitch")); }
      case "discord_bridge_import_if_empty": { return discordBridgeSave(c,String(args.namespace||"twitch"),args.state||{}, {ifEmpty:true}); }
      case "discord_bridge_put_state": { return discordBridgeSave(c,String(args.namespace||"twitch"),args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true}); }
      case "discord_bridge_counts": { const namespace=String(args.namespace||"twitch"),out={};let r=await c.query(`SELECT count(*)::bigint AS n FROM discord_bridge_queue WHERE namespace=$1`,[namespace]);out.discord_bridge_queue=Number(r.rows[0].n||0);r=await c.query(`SELECT COALESCE(sum(attempts),0)::bigint AS n FROM discord_bridge_queue WHERE namespace=$1`,[namespace]);out.discord_bridge_attempts=Number(r.rows[0].n||0);r=await c.query(`SELECT revision,updated_at FROM discord_bridge_meta WHERE namespace=$1`,[namespace]);out.discord_bridge_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.discord_bridge_updated_at=r.rows[0]?.updated_at||null;return out; }
      case "discord_channel_times_get_state": { return discordChannelTimesLoad(c,String(args.namespace||"discord")); }
      case "discord_channel_times_import_if_empty": { return discordChannelTimesSave(c,String(args.namespace||"discord"),args.state||{}, {ifEmpty:true}); }
      case "discord_channel_times_put_state": { return discordChannelTimesSave(c,String(args.namespace||"discord"),args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true}); }
      case "discord_channel_times_counts": { const namespace=String(args.namespace||"discord"),out={};let r=await c.query(`SELECT count(*)::bigint AS n FROM discord_channel_times_active WHERE namespace=$1`,[namespace]);out.discord_channel_times_active=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM discord_channel_times_overrides WHERE namespace=$1`,[namespace]);out.discord_channel_times_overrides=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM discord_channel_times_events WHERE namespace=$1`,[namespace]);out.discord_channel_times_events=Number(r.rows[0].n||0);r=await c.query(`SELECT revision,updated_at FROM discord_channel_times_meta WHERE namespace=$1`,[namespace]);out.discord_channel_times_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.discord_channel_times_updated_at=r.rows[0]?.updated_at||null;return out; }
      case "discord_emergency_get_state": { return discordEmergencyLoad(c,String(args.namespace||"discord")); }
      case "discord_emergency_import_if_empty": { return discordEmergencySave(c,String(args.namespace||"discord"),args.state||{}, {ifEmpty:true}); }
      case "discord_emergency_put_state": { return discordEmergencySave(c,String(args.namespace||"discord"),args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true}); }
      case "discord_emergency_counts": { const namespace=String(args.namespace||"discord"),out={};let r=await c.query(`SELECT active,revision,updated_at FROM discord_emergency_meta WHERE namespace=$1`,[namespace]);out.discord_emergency_active=r.rowCount&&r.rows[0].active?1:0;out.discord_emergency_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.discord_emergency_updated_at=r.rows[0]?.updated_at||null;r=await c.query(`SELECT count(*)::bigint AS n FROM discord_emergency_snapshots WHERE namespace=$1`,[namespace]);out.discord_emergency_snapshots=Number(r.rows[0].n||0);r=await c.query(`SELECT count(*)::bigint AS n FROM discord_emergency_history WHERE namespace=$1`,[namespace]);out.discord_emergency_history=Number(r.rows[0].n||0);return out; }
      case "discord_moderation_get_state": {
        return discordModerationLoad(c,String(args.namespace||"discord"));
      }
      case "discord_moderation_import_if_empty": {
        return discordModerationSave(c,String(args.namespace||"discord"),args.state||{}, {ifEmpty:true});
      }
      case "discord_moderation_put_state": {
        return discordModerationSave(c,String(args.namespace||"discord"),args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true});
      }
      case "discord_moderation_counts": {
        const namespace=String(args.namespace||"discord"),out={};
        let r=await c.query(`SELECT count(*)::bigint AS n FROM discord_moderation_users WHERE namespace=$1`,[namespace]);out.discord_moderation_users=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM discord_moderation_recent WHERE namespace=$1`,[namespace]);out.discord_moderation_recent=Number(r.rows[0].n||0);
        r=await c.query(`SELECT revision,updated_at FROM discord_moderation_meta WHERE namespace=$1`,[namespace]);out.discord_moderation_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.discord_moderation_updated_at=r.rows[0]?.updated_at||null;
        r=await c.query(`SELECT count(*)::bigint AS n FROM operation_events WHERE service=$1 AND stream='moderation'`,[args.service||"discord"]);out.discord_moderation_events=Number(r.rows[0].n||0);
        return out;
      }
      case "giveaway_get_state": {
        return giveawayLoad(c,String(args.namespace||"twitch"));
      }
      case "giveaway_import_if_empty": {
        return giveawaySave(c,String(args.namespace||"twitch"),args.state||{}, {ifEmpty:true});
      }
      case "giveaway_put_state": {
        return giveawaySave(c,String(args.namespace||"twitch"),args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true});
      }
      case "giveaway_counts": {
        const namespace=String(args.namespace||"twitch"),out={};
        let r=await c.query(`SELECT count(*)::bigint AS n FROM giveaways WHERE namespace=$1`,[namespace]);out.giveaway_events=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM giveaway_entries WHERE namespace=$1`,[namespace]);out.giveaway_entries=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM giveaway_draws WHERE namespace=$1`,[namespace]);out.giveaway_draws=Number(r.rows[0].n||0);
        r=await c.query(`SELECT revision,updated_at FROM giveaway_meta WHERE namespace=$1`,[namespace]);out.giveaway_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.giveaway_updated_at=r.rows[0]?.updated_at||null;
        return out;
      }
      case "followathon_get_state": {
        return followathonLoad(c,String(args.namespace||"twitch"));
      }
      // 9.25.3: nur die Revision (eine kleine Abfrage). Der Zeitgeber prüft damit jede Sekunde,
      // ob der Followathon-Stand neu geladen werden muss, statt ihn jedes Mal komplett zu holen.
      case "followathon_revision": {
        const r=await c.query(`SELECT revision FROM followathon_meta WHERE namespace=$1`,[String(args.namespace||"twitch")]);
        return r.rowCount?{found:true,revision:Number(r.rows[0].revision||1)}:{found:false};
      }
      case "followathon_import_if_empty": {
        return followathonSave(c,String(args.namespace||"twitch"),args.state||{}, {ifEmpty:true});
      }
      case "followathon_put_state": {
        return followathonSave(c,String(args.namespace||"twitch"),args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true});
      }
      case "followathon_counts": {
        const namespace=String(args.namespace||"twitch"),out={};
        let r=await c.query(`SELECT count(*)::bigint AS n FROM followathon_events WHERE namespace=$1`,[namespace]);out.followathon_events=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM followathon_users WHERE namespace=$1`,[namespace]);out.followathon_users=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM followathon_logs WHERE namespace=$1`,[namespace]);out.followathon_logs=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM followathon_held WHERE namespace=$1`,[namespace]);out.followathon_held=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM followathon_seen_messages WHERE namespace=$1`,[namespace]);out.followathon_seen_messages=Number(r.rows[0].n||0);
        r=await c.query(`SELECT revision,updated_at FROM followathon_meta WHERE namespace=$1`,[namespace]);out.followathon_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.followathon_updated_at=r.rows[0]?.updated_at||null;
        return out;
      }
      case "spind_get_state": {
        return spindLoad(c,String(args.namespace||"twitch"));
      }
      case "spind_import_if_empty": {
        return spindSave(c,String(args.namespace||"twitch"),args.state||{}, {ifEmpty:true});
      }
      case "spind_put_state": {
        return spindSave(c,String(args.namespace||"twitch"),args.state||{}, {expectedRevision:args.expectedRevision??null,replace:args.replace===true});
      }
      case "spind_counts": {
        const namespace=String(args.namespace||"twitch"),out={};
        let r=await c.query(`SELECT count(*)::bigint AS n FROM spind_accounts WHERE namespace=$1`,[namespace]);out.spind_accounts=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM spind_rounds WHERE namespace=$1`,[namespace]);out.spind_rounds=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM spind_transactions WHERE namespace=$1`,[namespace]);out.spind_transactions=Number(r.rows[0].n||0);
        r=await c.query(`SELECT revision,updated_at FROM spind_meta WHERE namespace=$1`,[namespace]);out.spind_revision=r.rowCount?Number(r.rows[0].revision||0):0;out.spind_updated_at=r.rows[0]?.updated_at||null;
        return out;
      }
      case "watchtime_import": {
        const users=args.users&&typeof args.users==="object"?args.users:{};
        await c.query("BEGIN");
        try{
          let imported=0;
          for(const [id,e] of Object.entries(users)){
            if(!id)continue;
            await c.query(`
              INSERT INTO twitch_watchtime(twitch_user_id,login,display_name,seconds,last_seen_at,updated_at)
              VALUES($1,$2,$3,$4,$5,now())
              ON CONFLICT(twitch_user_id) DO NOTHING
            `,[String(id),String(e?.login||""),String(e?.name||e?.login||""),Math.max(0,Math.floor(Number(e?.seconds||0))),e?.lastSeenAt||null]);
            imported++;
          }
          await c.query("COMMIT");
          return {imported};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "watchtime_replace": {
        const users=args.users&&typeof args.users==="object"?args.users:{};
        await c.query("BEGIN");
        try{
          await c.query("DELETE FROM twitch_watchtime");
          let imported=0;
          for(const [id,e] of Object.entries(users)){
            if(!id)continue;
            await c.query(`
              INSERT INTO twitch_watchtime(twitch_user_id,login,display_name,seconds,last_seen_at,updated_at)
              VALUES($1,$2,$3,$4,$5,now())
            `,[String(id),String(e?.login||""),String(e?.name||e?.login||""),Math.max(0,Math.floor(Number(e?.seconds||0))),e?.lastSeenAt||null]);
            imported++;
          }
          await c.query("COMMIT");
          return {imported};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "watchtime_add_batch": {
        const users=Array.isArray(args.users)?args.users:[];
        const seconds=Math.max(0,Math.floor(Number(args.seconds||0)));
        const seenAt=args.seenAt||new Date().toISOString();
        if(!users.length||!seconds)return {updated:0};
        await c.query("BEGIN");
        try{
          let updated=0;
          for(const u of users){
            const id=String(u.userId||u.user_id||"");if(!id)continue;
            await c.query(`
              INSERT INTO twitch_watchtime(twitch_user_id,login,display_name,seconds,last_seen_at,updated_at)
              VALUES($1,$2,$3,$4,$5,now())
              ON CONFLICT(twitch_user_id) DO UPDATE SET
                seconds=twitch_watchtime.seconds+EXCLUDED.seconds,
                login=CASE WHEN EXCLUDED.login<>'' THEN EXCLUDED.login ELSE twitch_watchtime.login END,
                display_name=CASE WHEN EXCLUDED.display_name<>'' THEN EXCLUDED.display_name ELSE twitch_watchtime.display_name END,
                last_seen_at=EXCLUDED.last_seen_at,
                updated_at=now()
            `,[id,String(u.login||u.user_login||""),String(u.name||u.user_name||u.login||u.user_login||""),seconds,seenAt]);
            updated++;
          }
          await c.query("COMMIT");
          return {updated};
        }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
      }
      case "watchtime_get": {
        const r=await c.query(`SELECT twitch_user_id AS "userId",login,display_name AS name,seconds::bigint AS seconds,last_seen_at AS "lastSeenAt",corrected_at AS "correctedAt",corrected_by AS "correctedBy" FROM twitch_watchtime WHERE twitch_user_id=$1`,[String(args.userId||"")]);
        if(!r.rowCount)return null;
        const x=r.rows[0];x.seconds=Number(x.seconds||0);return x;
      }
      case "watchtime_set": {
        const r=await c.query(`
          UPDATE twitch_watchtime SET seconds=$2,corrected_at=now(),corrected_by=$3,updated_at=now()
          WHERE twitch_user_id=$1
          RETURNING twitch_user_id AS "userId",login,display_name AS name,seconds::bigint AS seconds,last_seen_at AS "lastSeenAt",corrected_at AS "correctedAt",corrected_by AS "correctedBy"
        `,[String(args.userId||""),Math.max(0,Math.floor(Number(args.seconds||0))),String(args.actor||"")]);
        if(!r.rowCount)return null;const x=r.rows[0];x.seconds=Number(x.seconds||0);return x;
      }
      case "watchtime_query": {
        const pageSize=Math.max(1,Math.min(100,Number(args.pageSize||100)));
        const search=String(args.search||"").trim();
        const order=String(args.sort||"desc")==="asc"?"seconds ASC, login ASC":String(args.sort||"")==="name"?"lower(COALESCE(NULLIF(display_name,''),login)) ASC":String(args.sort||"")==="recent"?"last_seen_at DESC NULLS LAST":"seconds DESC, login ASC";
        const where=search?`WHERE lower(login) LIKE $1 OR lower(display_name) LIKE $1 OR twitch_user_id LIKE $1`:"";
        const params=search?[`%${search.toLowerCase()}%`]:[];
        const c1=await c.query(`SELECT count(*)::bigint AS n,COALESCE(sum(seconds),0)::bigint AS total_seconds,max(updated_at) AS updated_at FROM twitch_watchtime ${where}`,params);
        const total=Number(c1.rows[0].n||0),totalPages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(totalPages,Math.max(1,Number(args.page||1))),offset=(page-1)*pageSize;
        const qparams=[...params,pageSize,offset];
        const limIndex=params.length+1,offIndex=params.length+2;
        const r=await c.query(`SELECT twitch_user_id AS "userId",login,display_name AS name,seconds::bigint AS seconds,last_seen_at AS "lastSeenAt" FROM twitch_watchtime ${where} ORDER BY ${order} LIMIT $${limIndex} OFFSET $${offIndex}`,qparams);
        return {items:r.rows.map(x=>({...x,seconds:Number(x.seconds||0)})),page,pageSize,total,totalPages,summary:{users:total,totalSeconds:Number(c1.rows[0].total_seconds||0),updatedAt:c1.rows[0].updated_at||null}};
      }
      case "watchtime_export": {
        const r=await c.query(`SELECT twitch_user_id,login,display_name,seconds::bigint AS seconds,last_seen_at FROM twitch_watchtime ORDER BY twitch_user_id`);
        const users={};for(const x of r.rows)users[x.twitch_user_id]={seconds:Number(x.seconds||0),login:x.login||"",name:x.display_name||x.login||"",lastSeenAt:x.last_seen_at||null};
        const meta=await c.query(`SELECT max(updated_at) AS updated_at FROM twitch_watchtime`);
        return {users,updatedAt:meta.rows[0]?.updated_at||null};
      }
      case "import_mark": {
        const r=await c.query(`
          INSERT INTO import_ledger(service,source_key,source_sha256,details)
          VALUES($1,$2,$3,$4::jsonb)
          ON CONFLICT(service,source_key) DO NOTHING
          RETURNING imported_at
        `,[args.service,args.sourceKey,args.sourceSha256||null,JSON.stringify(args.details||{})]);
        return {inserted:r.rowCount===1,importedAt:r.rows[0]?.imported_at||null};
      }
      case "import_list": {
        const r=await c.query(`SELECT source_key AS "sourceKey",source_sha256 AS "sourceSha256",imported_at AS "importedAt",details FROM import_ledger WHERE service=$1 ORDER BY imported_at,source_key`,[args.service]);
        return r.rows;
      }
      case "counts": {
        const out={};
        let r=await c.query(`SELECT count(*)::bigint AS n FROM state_documents WHERE namespace=$1`,[args.namespace]);out.state_documents=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM operation_events WHERE service=$1`,[args.service]);out.operation_events=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM eventsub_messages WHERE service=$1`,[args.service]);out.eventsub_messages=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM twitch_watchtime`);out.twitch_watchtime=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM import_ledger WHERE service=$1`,[args.service]);out.import_ledger=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM word_filter_terms`);out.word_filter_terms=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM word_filter_terms WHERE enabled=true`);out.word_filter_active=Number(r.rows[0].n||0);
        r=await c.query(`SELECT count(*)::bigint AS n FROM word_filter_hits`);out.word_filter_hits=Number(r.rows[0].n||0);
        r=await c.query(`SELECT revision FROM word_filter_meta WHERE id=1`);out.word_filter_revision=Number(r.rows[0]?.revision||0);
        if(args.service==="twitch"){
          const sc=await operation("spind_counts",{namespace:args.namespace});Object.assign(out,sc);
          const fc=await operation("followathon_counts",{namespace:args.namespace});Object.assign(out,fc);
          const gc=await operation("giveaway_counts",{namespace:args.namespace});Object.assign(out,gc);
          const ac=await operation("control_auth_counts",{namespace:args.namespace});Object.assign(out,ac);
          Object.assign(out,await operation("discord_bridge_counts",{namespace:args.namespace}));
          const fm=await operation("follower_cache_meta",{namespace:args.namespace});out.twitch_followers=Number(fm.rows||0);out.twitch_followers_total=Number(fm.total||0);out.twitch_followers_revision=Number(fm.revision||0);out.twitch_followers_updated_at=fm.updatedAt||null;
          Object.assign(out,await operation("clip_counts",{namespace:args.namespace}));
          Object.assign(out,await operation("usage_stats_counts",{namespace:args.namespace}));
          Object.assign(out,await operation("discord_analytics_counts",{namespace:args.namespace}));
        }
        if(args.service==="discord"){
          const mc=await operation("discord_moderation_counts",{namespace:args.namespace,service:args.service});Object.assign(out,mc);
          Object.assign(out,await operation("discord_onboarding_counts",{namespace:args.namespace}));
          Object.assign(out,await operation("discord_reports_counts",{namespace:args.namespace}));
          Object.assign(out,await operation("discord_social_counts",{namespace:args.namespace}));
          Object.assign(out,await operation("discord_channel_times_counts",{namespace:args.namespace}));
          Object.assign(out,await operation("discord_emergency_counts",{namespace:args.namespace}));
          Object.assign(out,await operation("discord_announcements_counts",{namespace:args.namespace}));
        }
        return out;
      }
      default:
        throw new Error(`Unbekannte PostgreSQL-Operation: ${op}`);
    }
  }

  parentPort.on("message", async msg => {
    const sab=msg.sab;
    const replyPort=msg.replyPort;
    const header=sab?new Int32Array(sab,0,3):null; // status, length, reserved
    const bytes=sab?new Uint8Array(sab,12):null;
    try{
      const result=await operation(msg.op,msg.args||{});
      if(replyPort){replyPort.postMessage({ok:true,result});replyPort.close();return;}
      const payload=Buffer.from(JSON.stringify({ok:true,result}),"utf8");
      if(payload.length>bytes.length)throw new Error(`PostgreSQL-Antwort zu groß (${payload.length} Bytes > ${bytes.length}).`);
      bytes.set(payload);
      Atomics.store(header,1,payload.length);
      Atomics.store(header,0,1);
    }catch(e){
      // Reconnect only on a later call. An automatic replay of a failed write
      // could duplicate a side effect when the server committed just before a
      // connection loss.
      const msg=String(e?.message||"").toLowerCase();
      if(["57P01","57P02","57P03","08000","08003","08006","ECONNRESET","ECONNREFUSED","EPIPE"].includes(String(e?.code||"")) || msg.includes("connection terminated") || msg.includes("connection closed")){
        try{ if(client) await client.end(); }catch{}
        client=null;
      }
      if(replyPort){replyPort.postMessage({ok:false,error:e?.message||String(e),code:e?.code||null});replyPort.close();return;}
      const payload=Buffer.from(JSON.stringify({ok:false,error:e?.message||String(e),code:e?.code||null}),"utf8");
      const n=Math.min(payload.length,bytes.length);bytes.set(payload.subarray(0,n));Atomics.store(header,1,n);Atomics.store(header,0,-1);
    }
    Atomics.notify(header,0,1);
  });
  return;
}

class PgSyncStore {
  constructor({namespace,service,enabled=true,host,port,database,user,password,passwordFile,timeoutMs=15000,responseBytes=8*1024*1024}={}){
    this.namespace=String(namespace||service||"app");
    this.service=String(service||namespace||"app");
    this.enabled=enabled!==false;
    this.timeoutMs=Number(timeoutMs||15000);
    this.responseBytes=Math.max(1024*1024,Number(responseBytes||8*1024*1024));
    this.worker=null;
    this.lastError=null;
    this.startedAt=null;
    if(!this.enabled)return;
    const passwordValue=readPassword({password,passwordFile});
    this.worker=new Worker(__filename,{workerData:{config:{host:host||process.env.PGHOST||"postgres",port:port||process.env.PGPORT||5432,database:database||process.env.PGDATABASE||"bwk",user:user||process.env.PGUSER||"bwk",password:passwordValue,applicationName:`bwk-${this.service}`}}});
    this.worker.on("error",e=>{this.lastError=e.message;});
    this.worker.on("exit",code=>{if(code!==0)this.lastError=`PostgreSQL-Worker beendet (Code ${code})`;});
  }
  call(op,args={}){
    if(!this.enabled)throw new Error("PostgreSQL-Speicher ist deaktiviert.");
    if(!this.worker)throw new Error(this.lastError||"PostgreSQL-Worker ist nicht verfügbar.");
    const sab=new SharedArrayBuffer(12+this.responseBytes);
    const header=new Int32Array(sab,0,3);
    this.worker.postMessage({op,args,sab});
    const wait=Atomics.wait(header,0,0,this.timeoutMs);
    if(wait==="timed-out")throw new Error(`PostgreSQL-Zeitüberschreitung bei ${op}.`);
    const len=Atomics.load(header,1);
    const payload=Buffer.from(new Uint8Array(sab,12,len)).toString("utf8");
    let parsed;try{parsed=JSON.parse(payload||"{}");}catch{throw new Error(`Ungültige PostgreSQL-Worker-Antwort bei ${op}.`);}
    if(!parsed.ok){this.lastError=parsed.error||`PostgreSQL-Fehler bei ${op}`;const e=new Error(this.lastError);if(parsed.code)e.code=parsed.code;throw e;}
    this.lastError=null;return parsed.result;
  }
  // Non-blocking alternative for independent reads. State-dependent XP writes
  // intentionally keep using call() until their ordering is migrated safely.
  callAsync(op,args={}){
    if(!this.enabled)return Promise.reject(new Error("PostgreSQL-Speicher ist deaktiviert."));
    if(!this.worker)return Promise.reject(new Error(this.lastError||"PostgreSQL-Worker ist nicht verfügbar."));
    const {port1,port2}=new MessageChannel();
    return new Promise((resolve,reject)=>{
      let finished=false;
      const finish=(error,result)=>{
        if(finished)return;
        finished=true;clearTimeout(timer);
        port1.removeAllListeners();port1.close();
        if(error)reject(error);else resolve(result);
      };
      const timer=setTimeout(()=>finish(new Error(`PostgreSQL-Zeitüberschreitung bei ${op}.`)),this.timeoutMs);
      port1.on("message",message=>{
        if(!message?.ok){const error=new Error(message?.error||`PostgreSQL-Fehler bei ${op}`);if(message?.code)error.code=message.code;this.lastError=error.message;finish(error);return;}
        this.lastError=null;finish(null,message.result);
      });
      port1.on("messageerror",()=>finish(new Error(`Ungültige PostgreSQL-Worker-Antwort bei ${op}.`)));
      try{this.worker.postMessage({op,args,replyPort:port2},[port2]);}
      catch(error){port2.close();finish(error);}
    });
  }
  messageCountLeaderboardAsync(channelId,days=0,limit=50){return this.callAsync("message_count_leaderboard",{namespace:this.namespace,channelId,days,limit});}
  messageCountMetaAsync(channelId){return this.callAsync("message_count_meta",{namespace:this.namespace,channelId});}
  init(){const r=this.call("init");this.startedAt=new Date().toISOString();return r;}
  ping(){return this.call("ping");}
  getDocument(key,fallback={}){const r=this.call("doc_get",{namespace:this.namespace,key});return r.found?r.value:fallback;}
  hasDocument(key){return this.call("doc_get",{namespace:this.namespace,key}).found;}
  putDocument(key,value){return this.call("doc_put",{namespace:this.namespace,key,value});}
  putDocumentIfAbsent(key,value){return this.call("doc_put_if_absent",{namespace:this.namespace,key,value});}
  listDocuments(){return this.call("doc_list",{namespace:this.namespace});}
  appendEvent(stream,entry){return this.call("event_append",{service:this.service,stream,entry});}
  importEvents(stream,rows){return this.call("events_import",{service:this.service,stream,rows});}
  queryEvents(stream,limit=2000){return this.call("events_query",{service:this.service,stream,limit});}
  trimEvents(stream,maxRows){return this.call("events_trim",{service:this.service,stream,maxRows});}
  deleteEventsOlderThan(stream,days){return this.call("events_delete_older",{service:this.service,stream,days});}
  replaceEvents(stream,rows){return this.call("events_replace",{service:this.service,stream,rows});}
  importFollowerCacheIfEmpty(state){return this.call("follower_cache_import_if_empty",{namespace:this.namespace,state});}
  replaceFollowerCache(state){return this.call("follower_cache_replace",{namespace:this.namespace,state});}
  followerCacheMeta(){return this.call("follower_cache_meta",{namespace:this.namespace});}
  queryFollowerCache(opts){return this.call("follower_cache_query",{namespace:this.namespace,...(opts||{})});}
  exportFollowerCache(){return this.call("follower_cache_export",{namespace:this.namespace});}
  ensureMessageCountTracking(channelId){return this.call("message_count_ensure",{namespace:this.namespace,channelId});}
  applyMessageCountBatch(channelId,batchId,rows){return this.call("message_count_apply_batch",{namespace:this.namespace,channelId,batchId,rows});}
  getMessageCount(channelId,userId){return this.call("message_count_get",{namespace:this.namespace,channelId,userId});}
  messageCountMeta(channelId){return this.call("message_count_meta",{namespace:this.namespace,channelId});}
  exportMessageCounts(channelId){return this.call("message_count_export",{namespace:this.namespace,channelId});}
  messageCountLeaderboard(channelId,days=0,limit=50){return this.call("message_count_leaderboard",{namespace:this.namespace,channelId,days,limit});}
  importClipStateIfEmpty(state){return this.call("clip_state_import_if_empty",{namespace:this.namespace,state});}
  getClipState(){return this.call("clip_state_get",{namespace:this.namespace});}
  putClipState(state){return this.call("clip_state_put",{namespace:this.namespace,state});}
  replaceClipState(state){return this.call("clip_state_replace",{namespace:this.namespace,state});}
  reserveClip(clip){return this.call("clip_reserve",{namespace:this.namespace,clip});}
  markClipShared(clip,sharedAt){return this.call("clip_mark_shared",{namespace:this.namespace,clip,sharedAt});}
  markClipError(clipId,error){return this.call("clip_mark_error",{namespace:this.namespace,clipId,error});}
  clipCounts(){return this.call("clip_counts",{namespace:this.namespace});}
  importUsageStatsIfEmpty(state){return this.call("usage_stats_import_if_empty",{namespace:this.namespace,state});}
  recordUsageStat(kind,itemId,data){return this.call("usage_stats_record",{namespace:this.namespace,kind,itemId,...(data||{})});}
  exportUsageStats(){return this.call("usage_stats_export",{namespace:this.namespace});}
  replaceUsageStats(state){return this.call("usage_stats_replace",{namespace:this.namespace,state});}
  usageStatsCounts(){return this.call("usage_stats_counts",{namespace:this.namespace});}
  importDiscordAnalyticsIfEmpty(state){return this.call("discord_analytics_import_if_empty",{namespace:this.namespace,state});}
  upsertDiscordAnalyticsSnapshot(date,memberCount,capturedAt){return this.call("discord_analytics_upsert",{namespace:this.namespace,date,memberCount,capturedAt});}
  exportDiscordAnalytics(){return this.call("discord_analytics_export",{namespace:this.namespace});}
  replaceDiscordAnalytics(state){return this.call("discord_analytics_replace",{namespace:this.namespace,state});}
  discordAnalyticsCounts(){return this.call("discord_analytics_counts",{namespace:this.namespace});}
  databaseMetrics(){return this.call("database_metrics",{});}
  wordFilterSnapshot(){return this.call("word_filter_snapshot",{});}
  wordFilterRevision(){return this.call("word_filter_revision",{});}
  upsertWordFilterTerm(term){return this.call("word_filter_upsert_term",{term});}
  deleteWordFilterTerm(termId){return this.call("word_filter_delete_term",{termId});}
  upsertWordFilterCategory(category){return this.call("word_filter_upsert_category",{category});}
  setWordFilterPolicy(policy){return this.call("word_filter_set_policy",{policy});}
  upsertWordFilterAllow(item){return this.call("word_filter_upsert_allow",{item});}
  deleteWordFilterAllow(allowId){return this.call("word_filter_delete_allow",{allowId});}
  importWordFilter(importData){return this.call("word_filter_import",{importData});}
  rollbackWordFilterImport(importId){return this.call("word_filter_rollback_import",{importId});}
  replaceWordFilter(snapshot){return this.call("word_filter_replace",{snapshot});}
  recordWordFilterHit(hit){return this.call("word_filter_record_hit",{hit});}
  markWordFilterFalsePositive(hitId){return this.call("word_filter_mark_false_positive",{hitId});}
  wordFilterHits(limit=100){return this.call("word_filter_hits",{limit});}
  setWordFilterRetention(days){return this.call("word_filter_set_retention",{days});}
  cleanupWordFilterHits(days=null){return this.call("word_filter_cleanup",{days});}
  reserveEventSub(messageId,subscriptionType,eventTimestamp){return this.call("eventsub_reserve",{messageId,subscriptionType,eventTimestamp,service:this.service}).inserted;}
  cleanupEventSub(days=90){return this.call("eventsub_cleanup",{days});}
  importWatchtime(users){return this.call("watchtime_import",{users});}
  replaceWatchtime(users){return this.call("watchtime_replace",{users});}
  addWatchtimeBatch(users,seconds,seenAt){return this.call("watchtime_add_batch",{users,seconds,seenAt});}
  getWatchtime(userId){return this.call("watchtime_get",{userId});}
  setWatchtime(userId,seconds,actor){return this.call("watchtime_set",{userId,seconds,actor});}
  queryWatchtime(opts){return this.call("watchtime_query",opts||{});}
  exportWatchtime(){return this.call("watchtime_export");}
  getGiveawayState(){return this.call("giveaway_get_state",{namespace:this.namespace});}
  importGiveawayStateIfEmpty(state){return this.call("giveaway_import_if_empty",{namespace:this.namespace,state});}
  putGiveawayState(state,expectedRevision=null,{replace=false}={}){return this.call("giveaway_put_state",{namespace:this.namespace,state,expectedRevision,replace});}
  giveawayCounts(){return this.call("giveaway_counts",{namespace:this.namespace});}
  getFollowathonState(){return this.call("followathon_get_state",{namespace:this.namespace});}
  getFollowathonRevision(){return this.call("followathon_revision",{namespace:this.namespace});}
  importFollowathonStateIfEmpty(state){return this.call("followathon_import_if_empty",{namespace:this.namespace,state});}
  putFollowathonState(state,expectedRevision=null,{replace=false}={}){return this.call("followathon_put_state",{namespace:this.namespace,state,expectedRevision,replace});}
  followathonCounts(){return this.call("followathon_counts",{namespace:this.namespace});}
  getSpindState(){return this.call("spind_get_state",{namespace:this.namespace});}
  importSpindStateIfEmpty(state){return this.call("spind_import_if_empty",{namespace:this.namespace,state});}
  putSpindState(state,expectedRevision=null,{replace=false}={}){return this.call("spind_put_state",{namespace:this.namespace,state,expectedRevision,replace});}
  spindCounts(){return this.call("spind_counts",{namespace:this.namespace});}
  getDiscordOnboardingState(){return this.call("discord_onboarding_get_state",{namespace:this.namespace});}
  importDiscordOnboardingStateIfEmpty(state){return this.call("discord_onboarding_import_if_empty",{namespace:this.namespace,state});}
  putDiscordOnboardingState(state,expectedRevision=null,{replace=false}={}){return this.call("discord_onboarding_put_state",{namespace:this.namespace,state,expectedRevision,replace});}
  discordOnboardingCounts(){return this.call("discord_onboarding_counts",{namespace:this.namespace});}
  getDiscordReportsState(){return this.call("discord_reports_get_state",{namespace:this.namespace});}
  importDiscordReportsStateIfEmpty(tickets,state){return this.call("discord_reports_import_if_empty",{namespace:this.namespace,tickets,state});}
  putDiscordReportsState(tickets,state,expectedRevision=null,{replace=false}={}){return this.call("discord_reports_put_state",{namespace:this.namespace,tickets,state,expectedRevision,replace});}
  discordReportsCounts(){return this.call("discord_reports_counts",{namespace:this.namespace});}
  getDiscordSocialState(){return this.call("discord_social_get_state",{namespace:this.namespace});}
  importDiscordSocialStateIfEmpty(state,history){return this.call("discord_social_import_if_empty",{namespace:this.namespace,state,history});}
  putDiscordSocialState(state,history,expectedRevision=null,{replace=false}={}){return this.call("discord_social_put_state",{namespace:this.namespace,state,history,expectedRevision,replace});}
  discordSocialCounts(){return this.call("discord_social_counts",{namespace:this.namespace});}

  getDiscordAnnouncementsState(){return this.call("discord_announcements_get_state",{namespace:this.namespace});}
  importDiscordAnnouncementsStateIfEmpty(state){return this.call("discord_announcements_import_if_empty",{namespace:this.namespace,state});}
  putDiscordAnnouncementsState(state,expectedRevision=null,{replace=false}={}){return this.call("discord_announcements_put_state",{namespace:this.namespace,state,expectedRevision,replace});}
  discordAnnouncementsCounts(){return this.call("discord_announcements_counts",{namespace:this.namespace});}
  getDiscordBridgeState(){return this.call("discord_bridge_get_state",{namespace:this.namespace});}
  importDiscordBridgeStateIfEmpty(state){return this.call("discord_bridge_import_if_empty",{namespace:this.namespace,state});}
  putDiscordBridgeState(state,expectedRevision=null,{replace=false}={}){return this.call("discord_bridge_put_state",{namespace:this.namespace,state,expectedRevision,replace});}
  discordBridgeCounts(){return this.call("discord_bridge_counts",{namespace:this.namespace});}
  getDiscordChannelTimesState(){return this.call("discord_channel_times_get_state",{namespace:this.namespace});}
  importDiscordChannelTimesStateIfEmpty(state){return this.call("discord_channel_times_import_if_empty",{namespace:this.namespace,state});}
  putDiscordChannelTimesState(state,expectedRevision=null,{replace=false}={}){return this.call("discord_channel_times_put_state",{namespace:this.namespace,state,expectedRevision,replace});}
  discordChannelTimesCounts(){return this.call("discord_channel_times_counts",{namespace:this.namespace});}
  getDiscordEmergencyState(){return this.call("discord_emergency_get_state",{namespace:this.namespace});}
  importDiscordEmergencyStateIfEmpty(state){return this.call("discord_emergency_import_if_empty",{namespace:this.namespace,state});}
  putDiscordEmergencyState(state,expectedRevision=null,{replace=false}={}){return this.call("discord_emergency_put_state",{namespace:this.namespace,state,expectedRevision,replace});}
  discordEmergencyCounts(){return this.call("discord_emergency_counts",{namespace:this.namespace});}
  getDiscordModerationState(){return this.call("discord_moderation_get_state",{namespace:this.namespace});}
  importDiscordModerationStateIfEmpty(state){return this.call("discord_moderation_import_if_empty",{namespace:this.namespace,state});}
  putDiscordModerationState(state,expectedRevision=null,{replace=false}={}){return this.call("discord_moderation_put_state",{namespace:this.namespace,state,expectedRevision,replace});}
  discordModerationCounts(){return this.call("discord_moderation_counts",{namespace:this.namespace,service:this.service});}
  getControlUsers(){return this.call("control_users_get",{namespace:this.namespace});}
  importControlUsersIfEmpty(data){return this.call("control_users_import_if_empty",{namespace:this.namespace,data});}
  putControlUsers(data,expectedRevision=null,{replace=false}={}){return this.call("control_users_put",{namespace:this.namespace,data,expectedRevision,replace});}
  getControlSessions(){return this.call("control_sessions_get",{namespace:this.namespace});}
  importControlSessionsIfEmpty(sessions){return this.call("control_sessions_import_if_empty",{namespace:this.namespace,sessions});}
  replaceControlSessions(sessions){return this.call("control_sessions_replace",{namespace:this.namespace,sessions});}
  controlAuthCounts(){return this.call("control_auth_counts",{namespace:this.namespace});}
  markImport(sourceKey,sourceSha256,details={}){return this.call("import_mark",{service:this.service,sourceKey,sourceSha256,details});}
  listImports(){return this.call("import_list",{service:this.service});}
  counts(){return this.call("counts",{namespace:this.namespace,service:this.service});}
  status(){
    if(!this.enabled)return {enabled:false,backend:"json"};
    try{return {enabled:true,backend:"postgres",namespace:this.namespace,service:this.service,...this.ping(),counts:this.counts(),documents:this.listDocuments(),imports:this.listImports(),metrics:this.databaseMetrics(),lastError:null};}
    catch(e){return {enabled:true,backend:"postgres",namespace:this.namespace,service:this.service,ok:false,lastError:e.message};}
  }
}

function jsonFileKey(file){return path.basename(String(file||""),path.extname(String(file||"")));}
function readLegacyJson(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return JSON.parse(JSON.stringify(fallback));}}
function readLegacyJsonl(file){try{return fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean);}catch{return[];}}

function createPgSyncStore(opts={}){
  const backend=String(opts.backend||process.env.STORAGE_BACKEND||"json").toLowerCase();
  const enabled=backend==="postgres";
  const store=new PgSyncStore({...opts,enabled,passwordFile:opts.passwordFile||process.env.DB_PASSWORD_FILE});
  if(enabled)store.init();
  return store;
}

module.exports={createPgSyncStore,jsonFileKey,readLegacyJson,readLegacyJsonl,SCHEMA_VERSION};
