import express from "express";
import cors from "cors";
import { logger } from "./logger.ts";
import { crudRouter } from "./routes/crud.ts";
import { domainsRouter } from "./routes/domains.ts";
import { integrationsRouter } from "./routes/integrations.ts";
import { templatesRouter } from "./routes/templates.ts";
import { settingsRouter } from "./routes/settings.ts";
import { purchaseRouter } from "./routes/purchase.ts";

export function createApp() {
  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/crud", crudRouter);
  app.use("/api/domains", domainsRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/templates", templatesRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/purchase", purchaseRouter);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: err?.message ?? "internal error" });
  });

  return app;
}
