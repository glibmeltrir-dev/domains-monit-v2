import { Router } from "express";
import { query } from "../db/pool.ts";

export const integrationsRouter = Router();

integrationsRouter.get("/", async (_req, res) => {
  try {
    const [namecheap, cloudflare, keitaro, groups] = await Promise.all([
      query("SELECT * FROM namecheap_accounts ORDER BY id"),
      query("SELECT * FROM cloudflare_accounts ORDER BY id"),
      query("SELECT * FROM keitaro_trackers ORDER BY id"),
      query("SELECT * FROM integration_groups ORDER BY id"),
    ]);
    res.json({
      namecheap: namecheap.rows.map((r) => ({ ...r, balance: Number(r.balance) })),
      cloudflare: cloudflare.rows,
      keitaro: keitaro.rows,
      groups: groups.rows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
