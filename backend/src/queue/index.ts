import { Queue } from "bullmq";
import { connection, QUEUE_NAMES } from "./connection.ts";

export interface CheckDomainJob {
  domainId: number;
}

export interface ProvisionDomainJob {
  domainId: number;
  register?: boolean;
  cfTemplateId?: number | null;
  years?: number;
  // "full"    -> buy/connect end-to-end (default)
  // "repoint" -> point existing domain to Keitaro IP + register in tracker
  // "sync"    -> reconcile all domains with providers (domainId ignored)
  mode?: "full" | "repoint" | "sync";
}

// Queue for individual domain health checks.
export const monitorQueue = new Queue<CheckDomainJob>(QUEUE_NAMES.monitor, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 2000 },
    // Remove on both complete AND fail so the de-duplicated jobId (`check:<id>`)
    // is always freed for the next scheduling cycle — a stuck failed job would
    // otherwise block a domain from ever being re-checked. History of real
    // problems lives in the `incidents` table instead.
    removeOnComplete: true,
    removeOnFail: true,
  },
});

// Queue for buying + connecting a domain (Namecheap -> Cloudflare -> Keitaro).
export const provisionQueue = new Queue<ProvisionDomainJob>(
  QUEUE_NAMES.provision,
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  }
);

export { QUEUE_NAMES };
