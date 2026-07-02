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
} as const;
