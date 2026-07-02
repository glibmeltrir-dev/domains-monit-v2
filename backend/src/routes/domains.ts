import { Router } from "express";
import { query } from "../db/pool.ts";
import { monitorQueue } from "../queue/index.ts";
import { normalizeUrl } from "../services/checkers.ts";

export const domainsRouter = Router();

// List domains with joined integration names (shape expected by the UI).
domainsRouter.get("/", async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT d.*,
             k.name  AS keitaro_name,
             k.server_ip AS keitaro_ip,
             nc.name AS namecheap_name,
             cf.name AS cloudflare_name
      FROM domains d
      LEFT JOIN keitaro_trackers k    ON d.keitaro_id = k.id
      LEFT JOIN namecheap_accounts nc ON d.namecheap_account_id = nc.id
      LEFT JOIN cloudflare_accounts cf ON d.cloudflare_account_id = cf.id
      ORDER BY d.id DESC
    `);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Bulk import of existing domains into monitoring (used for the current list).
domainsRouter.post("/import", async (req, res) => {
  try {
    const {
      domains,
      keitaro_id = null,
      monitor_template_id = null,
    }: { domains: string[]; keitaro_id?: number | null; monitor_template_id?: number | null } =
      req.body ?? {};

    if (!Array.isArray(domains) || !domains.length) {
      return res.status(400).json({ error: "domains[] required" });
    }

    let created = 0;
    for (const raw of domains) {
      const name = String(raw || "")
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "")
        .toLowerCase();
      if (!name) continue;
      const { rowCount } = await query(
        `INSERT INTO domains (domain_name, keitaro_id, monitor_template_id, provision_status, monitoring_status)
         VALUES ($1, $2, $3, 'CONNECTED', 'PENDING')
         ON CONFLICT (domain_name) DO NOTHING`,
        [name, keitaro_id, monitor_template_id]
      );
      if (rowCount) created++;
    }
    res.json({ created });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Trigger an immediate check for one domain.
domainsRouter.post("/:id/check", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await monitorQueue.add(
      "check",
      { domainId: id },
      { jobId: `manual:${id}:${Date.now()}` }
    );
    res.json({ queued: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Bulk enable/disable or delete.
domainsRouter.post("/bulk", async (req, res) => {
  try {
    const { ids, action }: { ids: number[]; action: "enable" | "disable" | "delete" } =
      req.body ?? {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "ids[] required" });
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    if (action === "delete") {
      await query(`DELETE FROM domains WHERE id IN (${placeholders})`, ids);
    } else {
      await query(
        `UPDATE domains SET enabled = $${ids.length + 1} WHERE id IN (${placeholders})`,
        [...ids, action === "enable"]
      );
    }
    res.json({ success: true, affected: ids.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export { normalizeUrl };
