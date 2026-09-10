import express from "express";
import cors from "cors";
import { logger } from "./logger.ts";
import { attachUser, requireAuth } from "./middleware/auth.ts";
import { authRouter } from "./routes/auth.ts";
import { crudRouter } from "./routes/crud.ts";
import { domainsRouter } from "./routes/domains.ts";
import { integrationsRouter } from "./routes/integrations.ts";
import { templatesRouter } from "./routes/templates.ts";
import { settingsRouter } from "./routes/settings.ts";
import { purchaseRouter } from "./routes/purchase.ts";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(attachUser);

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", authRouter);

  app.use("/api", requireAuth);
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
