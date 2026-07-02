import { Worker } from "bullmq";
import { connection, QUEUE_NAMES } from "../queue/connection.ts";
import type { CheckDomainJob, ProvisionDomainJob } from "../queue/index.ts";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import { checkDomain } from "../services/monitor.ts";
import { provisionDomain } from "../services/provision.ts";

const monitorWorker = new Worker<CheckDomainJob>(
  QUEUE_NAMES.monitor,
  async (job) => {
    await checkDomain(job.data.domainId);
  },
  { connection, concurrency: config.monitor.concurrency }
);

const provisionWorker = new Worker<ProvisionDomainJob>(
  QUEUE_NAMES.provision,
  async (job) => {
    await provisionDomain(job.data.domainId, {
      register: job.data.register,
      cfTemplateId: job.data.cfTemplateId,
      years: job.data.years,
    });
  },
  { connection, concurrency: config.provision.concurrency }
);

for (const [name, worker] of [
  ["monitor", monitorWorker],
  ["provision", provisionWorker],
] as const) {
  worker.on("failed", (job, err) =>
    logger.warn({ queue: name, jobId: job?.id, err: err?.message }, "job failed")
  );
  worker.on("error", (err) => logger.error({ queue: name, err }, "worker error"));
}

logger.info(
  { monitor: config.monitor.concurrency, provision: config.provision.concurrency },
  "Workers started"
);

async function shutdown() {
  logger.info("Shutting down workers...");
  await Promise.allSettled([monitorWorker.close(), provisionWorker.close()]);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
