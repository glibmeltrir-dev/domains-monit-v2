import { createApp } from "./api.ts";
import { migrate } from "./db/migrate.ts";
import { config } from "./config.ts";
import { logger } from "./logger.ts";

async function main() {
  // Ensure schema exists before serving requests.
  await migrate();

  const app = createApp();
  const server = app.listen(config.port, "0.0.0.0", () => {
    logger.info(`API listening on :${config.port}`);
  });

  const shutdown = () => {
    logger.info("Shutting down API...");
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "API failed to start");
  process.exit(1);
});
