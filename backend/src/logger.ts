import pino from "pino";
import { config } from "./config.ts";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    config.env === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
