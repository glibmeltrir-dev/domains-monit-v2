-- Domains monitoring & provisioning schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS integration_groups (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS namecheap_accounts (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  username   TEXT NOT NULL,
  api_user   TEXT NOT NULL,
  api_key    TEXT NOT NULL,
  client_ip  TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'ACTIVE',
  balance    NUMERIC(12,2) NOT NULL DEFAULT 0,
  group_id   INTEGER REFERENCES integration_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cloudflare_accounts (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  api_token   TEXT NOT NULL,
  email       TEXT,
  account_id  TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE',
  group_id    INTEGER REFERENCES integration_groups(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS keitaro_trackers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  api_key    TEXT NOT NULL DEFAULT '',
  server_ip  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ACTIVE',
  group_id   INTEGER REFERENCES integration_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cloudflare provisioning presets applied when a domain is connected.
CREATE TABLE IF NOT EXISTS cloudflare_templates (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  proxy_on       BOOLEAN NOT NULL DEFAULT TRUE,
  ssl_mode       TEXT NOT NULL DEFAULT 'Full',
  bot_fight_mode BOOLEAN NOT NULL DEFAULT FALSE,
  https_redirect BOOLEAN NOT NULL DEFAULT TRUE
);

-- Monitoring behaviour presets (timeouts, reminders, intervals).
CREATE TABLE IF NOT EXISTS monitor_templates (
  id                          SERIAL PRIMARY KEY,
  name                        TEXT NOT NULL,
  request_timeout_ms          INTEGER NOT NULL DEFAULT 30000,
  follow_redirects            BOOLEAN NOT NULL DEFAULT TRUE,
  check_ssl_errors            BOOLEAN NOT NULL DEFAULT TRUE,
  ssl_expiry_reminder_days    TEXT NOT NULL DEFAULT '14,7,3,1',
  domain_expiry_reminder_days TEXT NOT NULL DEFAULT '30,14,7,1',
  slow_alert_ms               INTEGER,
  up_status_codes             TEXT NOT NULL DEFAULT '2xx,3xx,404',
  check_interval_sec          INTEGER NOT NULL DEFAULT 300
);

CREATE TABLE IF NOT EXISTS domains (
  id                    SERIAL PRIMARY KEY,
  domain_name           TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'ACTIVE',
  registrar             TEXT NOT NULL DEFAULT 'Namecheap',
  registration_date     TIMESTAMPTZ,
  expiration_date       TIMESTAMPTZ,
  namecheap_account_id  INTEGER REFERENCES namecheap_accounts(id) ON DELETE SET NULL,
  cloudflare_account_id INTEGER REFERENCES cloudflare_accounts(id) ON DELETE SET NULL,
  keitaro_id            INTEGER REFERENCES keitaro_trackers(id) ON DELETE SET NULL,
  cloudflare_zone_id    TEXT,
  monitor_template_id   INTEGER REFERENCES monitor_templates(id) ON DELETE SET NULL,
  ns                    TEXT NOT NULL DEFAULT '',
  ssl                   TEXT,
  ssl_valid_till        TIMESTAMPTZ,
  http_status           TEXT,
  last_http_code        INTEGER,
  latency_ms            INTEGER,
  last_check            TIMESTAMPTZ,
  monitoring_status     TEXT NOT NULL DEFAULT 'PENDING',  -- UP | SLOW | DOWN | PENDING
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  provision_status      TEXT NOT NULL DEFAULT 'CONNECTED', -- PENDING | PROVISIONING | CONNECTED | FAILED
  provision_error       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domains_enabled_lastcheck
  ON domains (enabled, last_check);

CREATE TABLE IF NOT EXISTS incidents (
  id         SERIAL PRIMARY KEY,
  domain_id  INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,          -- up | down | slow | ssl_expiry | domain_expiry | purchase | provision
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_domain ON incidents (domain_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Columns added after the initial release (idempotent for existing databases).
ALTER TABLE domains ADD COLUMN IF NOT EXISTS resolved_ip        TEXT;      -- origin IP (from Cloudflare A record)
ALTER TABLE domains ADD COLUMN IF NOT EXISTS proxied            BOOLEAN;   -- Cloudflare orange-cloud on/off
ALTER TABLE domains ADD COLUMN IF NOT EXISTS keitaro_registered BOOLEAN;   -- present in the Keitaro tracker
ALTER TABLE domains ADD COLUMN IF NOT EXISTS synced_at          TIMESTAMPTZ;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS keitaro_group_id   INTEGER;   -- Keitaro domain group id (from sync)
ALTER TABLE domains ADD COLUMN IF NOT EXISTS keitaro_group_name TEXT;      -- Keitaro domain group name (from sync)
