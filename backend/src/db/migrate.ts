import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./pool.ts";
import { logger } from "../logger.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(): Promise<void> {
  const schema = await readFile(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  logger.info("Database schema is up to date");
}

// Allow running directly: `tsx src/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, "Migration failed");
      process.exit(1);
    });
}
