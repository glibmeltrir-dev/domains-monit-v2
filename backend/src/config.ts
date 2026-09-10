import "dotenv/config";

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: num(process.env.PORT, 3000),

  database: {
    url:
      process.env.DATABASE_URL ??
      "postgres://domains:domains@localhost:5432/domains",
  },

  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: num(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  monitor: {
    // How many domain checks run in parallel per worker.
    concurrency: num(process.env.MONITOR_CONCURRENCY, 20),
    // How often the scheduler wakes up to enqueue due checks (seconds).
    schedulerIntervalSec: num(process.env.SCHEDULER_INTERVAL_SEC, 30),
    // Default check interval for a domain if its template has none (seconds).
    defaultIntervalSec: num(process.env.MONITOR_DEFAULT_INTERVAL_SEC, 300),
  },

  provision: {
    concurrency: num(process.env.PROVISION_CONCURRENCY, 5),
  },

  // Default target server (Keitaro) all domains point their A record to.
  keitaroDefaultIp: process.env.KEITARO_DEFAULT_IP ?? "178.63.149.98",

  encryption: {
    // 64 hex chars (openssl rand -hex 32) or any passphrase ≥ 16 chars.
    key: process.env.ENCRYPTION_KEY ?? "",
  },

  session: {
    secret: process.env.SESSION_SECRET ?? "",
    // Set COOKIE_SECURE=1 when the panel is served over HTTPS.
    cookieSecure: process.env.COOKIE_SECURE === "1" || process.env.COOKIE_SECURE === "true",
    ttlMs: 7 * 24 * 60 * 60 * 1000,
  },
} as const;

export function assertSecretsConfigured(): void {
  if (!config.encryption.key || config.encryption.key.length < 16) {
    throw new Error(
      "ENCRYPTION_KEY is required (≥16 chars, ideally `openssl rand -hex 32`). API keys cannot be stored without it."
    );
  }
  if (!config.session.secret || config.session.secret.length < 16) {
    throw new Error(
      "SESSION_SECRET is required (≥16 chars, ideally `openssl rand -hex 32`)."
    );
  }
}
