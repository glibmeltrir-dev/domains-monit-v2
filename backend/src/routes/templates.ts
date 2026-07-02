import { Router } from "express";
import { query } from "../db/pool.ts";

export const templatesRouter = Router();

// Cloudflare provisioning templates (used by the UI /templates page).
templatesRouter.get("/", async (_req, res) => {
  try {
    const { rows } = await query("SELECT * FROM cloudflare_templates ORDER BY id");
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Monitoring behaviour templates.
templatesRouter.get("/monitor", async (_req, res) => {
  try {
    const { rows } = await query("SELECT * FROM monitor_templates ORDER BY id");
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
