import { query } from "./db/pool.ts";
import { monitorQueue } from "./queue/index.ts";
import { config } from "./config.ts";
import { logger } from "./logger.ts";
import { syncAll } from "./services/sync.ts";

// Find domains whose individual check interval has elapsed and enqueue a check
// for each. Using a de-duplicated jobId prevents piling up duplicate checks if
// a worker is slow. NOTE: BullMQ forbids ":" in custom job ids — use "-".
async function enqueueDueChecks(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `SELECT d.id
     FROM domains d
     LEFT JOIN monitor_templates t ON t.id = d.monitor_template_id
     WHERE d.enabled = TRUE
       AND d.provision_status = 'CONNECTED'
       AND (
         d.last_check IS NULL
         OR d.last_check <= now() - make_interval(secs => COALESCE(t.check_interval_sec, $1))
       )
     ORDER BY d.last_check ASC NULLS FIRST
     LIMIT 1000`,
    [config.monitor.defaultIntervalSec]
  );

  if (!rows.length) return 0;

  await monitorQueue.addBulk(
    rows.map((r) => ({
      name: "check",
      data: { domainId: r.id },
      opts: { jobId: `check-${r.id}` },
    }))
  );
  return rows.length;
}

async function tick() {
  try {
    const count = await enqueueDueChecks();
    if (count) logger.info({ count }, "enqueued domain checks");
  } catch (err) {
    logger.error({ err }, "scheduler tick failed");
  }
}

// Periodically reconcile domains with Cloudflare/Namecheap/Keitaro (origin IP,
// NS, expiry, tracker membership). Kept well apart from the fast health-check
// loop since it hits external APIs in bulk.
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
async function syncTick() {
  try {
    const summary = await syncAll();
    logger.info(summary, "scheduled provider sync");
  } catch (err) {
    logger.error({ err }, "scheduled provider sync failed");
  }
}

logger.info(
  { intervalSec: config.monitor.schedulerIntervalSec },
  "Scheduler started"
);
void tick();
const timer = setInterval(tick, config.monitor.schedulerIntervalSec * 1000);

// First reconcile shortly after boot, then on the long interval.
const syncBoot = setTimeout(syncTick, 15_000);
const syncTimer = setInterval(syncTick, SYNC_INTERVAL_MS);

function shutdown() {
  clearInterval(timer);
  clearTimeout(syncBoot);
  clearInterval(syncTimer);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
