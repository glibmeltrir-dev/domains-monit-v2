import { Router } from "express";
import { query } from "../db/pool.ts";
import { monitorQueue, provisionQueue } from "../queue/index.ts";
import { normalizeUrl } from "../services/checkers.ts";
import { removeFromKeitaro } from "../services/provision.ts";
import {
  checkNewDomain,
  getKeitaroUsage,
  replaceDomain,
  ReplaceValidationError,
} from "../services/replace.ts";

export const domainsRouter = Router();

// Whitelisted sortable columns → their SQL expression. Never interpolate the raw
// value from the request; unknown columns fall back to `id`.
const SORTABLE: Record<string, string> = {
  id: "d.id",
  domain_name: "d.domain_name",
  monitoring_status: "d.monitoring_status",
  ssl_valid_till: "d.ssl_valid_till",
  expiration_date: "d.expiration_date",
  keitaro_registered: "d.keitaro_registered",
  resolved_ip: "d.resolved_ip",
  last_check: "d.last_check",
  created_at: "d.created_at",
};
// Nullable columns need NULLS LAST so empty values sink to the bottom regardless
// of sort direction.
const NULLS_LAST = new Set([
  "ssl_valid_till",
  "expiration_date",
  "keitaro_registered",
  "resolved_ip",
  "last_check",
]);

const SELECT_COLS = `d.*,
             k.name  AS keitaro_name,
             k.server_ip AS keitaro_ip,
             nc.name AS namecheap_name,
             cf.name AS cloudflare_name`;
const JOINS = `FROM domains d
      LEFT JOIN keitaro_trackers k    ON d.keitaro_id = k.id
      LEFT JOIN namecheap_accounts nc ON d.namecheap_account_id = nc.id
      LEFT JOIN cloudflare_accounts cf ON d.cloudflare_account_id = cf.id`;

// List domains with joined integration names (shape expected by the UI).
// Backward compatible: without pagination params returns a plain array (old
// shape); with any of page/pageSize/sort/dir/search/status returns
// `{ rows, total }` for server-side pagination + sorting.
domainsRouter.get("/", async (req, res) => {
  try {
    const q = req.query;
    const paginated =
      q.page !== undefined ||
      q.pageSize !== undefined ||
      q.sort !== undefined ||
      q.dir !== undefined ||
      q.search !== undefined ||
      q.status !== undefined;

    if (!paginated) {
      const { rows } = await query(
        `SELECT ${SELECT_COLS} ${JOINS} ORDER BY d.id DESC`
      );
      return res.json(rows);
    }

    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const sortKey = SORTABLE[String(q.sort)] ? String(q.sort) : "id";
    const sortCol = SORTABLE[sortKey];
    const dir = String(q.dir).toLowerCase() === "asc" ? "ASC" : "DESC";
    const nullsLast = NULLS_LAST.has(sortKey) ? " NULLS LAST" : "";
    const search = String(q.search ?? "").trim();
    const status = String(q.status ?? "ALL");

    const where: string[] = [];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`d.domain_name ILIKE $${params.length}`);
    }
    if (status && status !== "ALL") {
      params.push(status);
      where.push(`d.monitoring_status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows: countRows } = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total ${JOINS} ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    const offset = (page - 1) * pageSize;
    const { rows } = await query(
      `SELECT ${SELECT_COLS} ${JOINS} ${whereSql}
       ORDER BY ${sortCol} ${dir}${nullsLast}, d.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );
    res.json({ rows, total });
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

// Reconcile every domain with Cloudflare / Namecheap / Keitaro (async job):
// origin IP, NS, proxy state, registry expiry and tracker membership.
domainsRouter.post("/sync", async (_req, res) => {
  try {
    await provisionQueue.add(
      "sync",
      { domainId: 0, mode: "sync" },
      { jobId: `sync-${Date.now()}` }
    );
    res.json({ queued: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Point one or many domains at the Keitaro IP (via Cloudflare) and register
// them in the tracker. Domains without a Cloudflare/Keitaro account attached
// fall back to the first active account of each type.
domainsRouter.post("/point-to-keitaro", async (req, res) => {
  try {
    const { ids }: { ids: number[] } = req.body ?? {};
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: "ids[] required" });
    }

    const { rows: cf } = await query<{ id: number }>(
      "SELECT id FROM cloudflare_accounts WHERE status = 'ACTIVE' ORDER BY id LIMIT 1"
    );
    if (!cf[0]) return res.status(400).json({ error: "No Cloudflare account configured" });
    const { rows: k } = await query<{ id: number }>(
      "SELECT id FROM keitaro_trackers WHERE status = 'ACTIVE' ORDER BY id LIMIT 1"
    );
    const cfId = cf[0].id;
    const kId = k[0]?.id ?? null;

    for (const id of ids) {
      await query(
        `UPDATE domains
           SET cloudflare_account_id = COALESCE(cloudflare_account_id, $1),
               keitaro_id            = COALESCE(keitaro_id, $2)
         WHERE id = $3`,
        [cfId, kId, id]
      );
      await provisionQueue.add(
        "repoint",
        { domainId: id, mode: "repoint" },
        { jobId: `repoint-${id}-${Date.now()}` }
      );
    }
    res.json({ queued: true, count: ids.length });
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
      { jobId: `manual-${id}-${Date.now()}` }
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
      // Убираем каждый домен из Keitaro (best-effort) до удаления строки в БД.
      for (const id of ids) await removeFromKeitaro(id);
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

// Replace an expiring domain with a new one: carry over the Keitaro group,
// rebind campaigns and remove the old domain. Runs synchronously and returns a
// detailed report.
domainsRouter.post("/replace", async (req, res) => {
  try {
    const { oldId, newDomain }: { oldId?: number; newDomain?: string } = req.body ?? {};
    if (!oldId || !newDomain) {
      return res.status(400).json({ error: "oldId и newDomain обязательны" });
    }
    const report = await replaceDomain(Number(oldId), String(newDomain));
    res.json(report);
  } catch (e: any) {
    const status = e instanceof ReplaceValidationError ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

// Preview validation of a replacement candidate: is the new domain absent or
// "clean" (no group, no campaigns) in the old domain's tracker?
domainsRouter.get("/:id/new-domain-check", async (req, res) => {
  try {
    const newDomain = String(req.query.newDomain ?? "");
    if (!newDomain.trim()) return res.status(400).json({ error: "newDomain обязателен" });
    const result = await checkNewDomain(Number(req.params.id), newDomain);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Current Keitaro footprint of a domain (group + bound campaigns) — used by the
// replace page preview.
domainsRouter.get("/:id/keitaro-usage", async (req, res) => {
  try {
    const usage = await getKeitaroUsage(Number(req.params.id));
    res.json(usage);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a single domain from Keitaro (best-effort) and from our DB.
domainsRouter.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await removeFromKeitaro(id);
    await query("DELETE FROM domains WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export { normalizeUrl };
