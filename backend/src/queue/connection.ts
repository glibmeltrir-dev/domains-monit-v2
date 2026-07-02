import type { ConnectionOptions } from "bullmq";
import { config } from "../config.ts";

// BullMQ creates its own ioredis connections from these options.
// `maxRetriesPerRequest: null` is required for blocking commands used by workers.
export const connection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
};

export const QUEUE_NAMES = {
  monitor: "monitor",
  provision: "provision",
} as const;
