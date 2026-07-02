import { Router } from "express";
import { query } from "../db/pool.ts";

// Whitelisted tables and their writable columns. Anything not listed is rejected
// to avoid SQL/column injection through the generic endpoint.
const TABLES: Record<string, { columns: string[]; booleans?: string[] }> = {
  integration_groups: { columns: ["name"] },
  namecheap_accounts: {
    columns: ["name", "username", "api_user", "api_key", "client_ip", "status", "balance", "group_id"],
  },
  cloudflare_accounts: {
    columns: ["name", "api_token", "email", "account_id", "status", "group_id"],
  },
  keitaro_trackers: {
    columns: ["name", "url", "api_key", "server_ip", "status", "group_id"],
  },
  cloudflare_templates: {
    columns: ["name", "proxy_on", "ssl_mode", "bot_fight_mode", "https_redirect"],
    booleans: ["proxy_on", "bot_fight_mode", "https_redirect"],
  },
  monitor_templates: {
    columns: [
      "name",
      "request_timeout_ms",
      "follow_redirects",
      "check_ssl_errors",
      "ssl_expiry_reminder_days",
      "domain_expiry_reminder_days",
      "slow_alert_ms",
      "up_status_codes",
      "check_interval_sec",
    ],
    booleans: ["follow_redirects", "check_ssl_errors"],
  },
  domains: {
    columns: [
      "domain_name",
      "status",
      "registrar",
      "namecheap_account_id",
      "cloudflare_account_id",
      "keitaro_id",
      "monitor_template_id",
      "enabled",
    ],
    booleans: ["enabled"],
  },
};

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function sanitize(table: string, body: Record<string, unknown>) {
  const spec = TABLES[table];
  const cols: string[] = [];
  const values: unknown[] = [];
  for (const col of spec.columns) {
    if (!(col in body)) continue;
    let value = body[col];
    if (spec.booleans?.includes(col)) value = toBool(value);
    if (value === "") value = null;
    cols.push(col);
    values.push(value);
  }
  return { cols, values };
}

export const crudRouter = Router();

crudRouter.post("/:table", async (req, res) => {
  const { table } = req.params;
  if (!TABLES[table]) return res.status(400).json({ error: "Invalid table" });
  try {
    const { cols, values } = sanitize(table, req.body ?? {});
    if (!cols.length) return res.status(400).json({ error: "No valid columns" });
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      values
    );
    res.json({ id: rows[0].id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

crudRouter.put("/:table/:id", async (req, res) => {
  const { table, id } = req.params;
  if (!TABLES[table]) return res.status(400).json({ error: "Invalid table" });
  try {
    const { cols, values } = sanitize(table, req.body ?? {});
    if (!cols.length) return res.status(400).json({ error: "No valid columns" });
    const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
    await query(`UPDATE ${table} SET ${sets} WHERE id = $${cols.length + 1}`, [
      ...values,
      id,
    ]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

crudRouter.delete("/:table/:id", async (req, res) => {
  const { table, id } = req.params;
  if (!TABLES[table]) return res.status(400).json({ error: "Invalid table" });
  try {
    await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
