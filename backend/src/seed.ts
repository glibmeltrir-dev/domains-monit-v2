import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool, query } from "./db/pool.ts";
import { migrate } from "./db/migrate.ts";
import { config } from "./config.ts";
import { logger } from "./logger.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function upsertReturningId(
  table: string,
  matchCol: string,
  matchVal: string,
  insertCols: string[],
  insertVals: unknown[]
): Promise<number> {
  const existing = await query<{ id: number }>(
    `SELECT id FROM ${table} WHERE ${matchCol} = $1 LIMIT 1`,
    [matchVal]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await query<{ id: number }>(
    `INSERT INTO ${table} (${insertCols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    insertVals
  );
  return rows[0].id;
}

async function seedIntegrations(): Promise<{ keitaroId: number; monitorTemplateId: number }> {
  const groupId = await upsertReturningId(
    "integration_groups",
    "name",
    "Production",
    ["name"],
    ["Production"]
  );

  // Namecheap (credentials come from env; defaults are placeholders)
  const ncUser = process.env.NAMECHEAP_API_USER;
  const ncKey = process.env.NAMECHEAP_API_KEY;
  const ncName = process.env.NAMECHEAP_USERNAME ?? ncUser;
  if (ncUser && ncKey && ncName) {
    await upsertReturningId(
      "namecheap_accounts",
      "api_user",
      ncUser,
      ["name", "username", "api_user", "api_key", "client_ip", "status", "group_id"],
      ["Main NC", ncName, ncUser, ncKey, process.env.NAMECHEAP_CLIENT_IP ?? "", "ACTIVE", groupId]
    );
  }

  // Cloudflare
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  if (cfToken) {
    await upsertReturningId(
      "cloudflare_accounts",
      "api_token",
      cfToken,
      ["name", "api_token", "email", "account_id", "status", "group_id"],
      ["Main CF", cfToken, process.env.CLOUDFLARE_EMAIL ?? null, process.env.CLOUDFLARE_ACCOUNT_ID ?? null, "ACTIVE", groupId]
    );
  }

  // Keitaro tracker (target server all domains point to)
  const keitaroIp = process.env.KEITARO_IP ?? config.keitaroDefaultIp;
  const keitaroId = await upsertReturningId(
    "keitaro_trackers",
    "server_ip",
    keitaroIp,
    ["name", "url", "api_key", "server_ip", "status", "group_id"],
    [
      "Keitaro Main",
      process.env.KEITARO_URL ?? "",
      process.env.KEITARO_API_KEY ?? "",
      keitaroIp,
      "ACTIVE",
      groupId,
    ]
  );

  // Cloudflare provisioning templates
  await query(
    `INSERT INTO cloudflare_templates (name, proxy_on, ssl_mode, bot_fight_mode, https_redirect)
     SELECT 'Default (Proxy + Full SSL)', true, 'Full', false, true
     WHERE NOT EXISTS (SELECT 1 FROM cloudflare_templates WHERE name = 'Default (Proxy + Full SSL)')`
  );
  await query(
    `INSERT INTO cloudflare_templates (name, proxy_on, ssl_mode, bot_fight_mode, https_redirect)
     SELECT 'Grey cloud (DNS only)', false, 'Flexible', false, false
     WHERE NOT EXISTS (SELECT 1 FROM cloudflare_templates WHERE name = 'Grey cloud (DNS only)')`
  );

  // Monitor template mirroring the current 15-minute Keitaro checks.
  const monitorTemplateId = await upsertReturningId(
    "monitor_templates",
    "name",
    "Main",
    [
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
    ["Main", 30000, true, true, "14,7,3,1", "30,14,7,1", null, "2xx,3xx,404", 900]
  );

  return { keitaroId, monitorTemplateId };
}

async function seedDomains(keitaroId: number, monitorTemplateId: number): Promise<number> {
  const raw = await readFile(path.join(__dirname, "..", "data", "seed-domains.json"), "utf8");
  const domains: string[] = JSON.parse(raw);
  let created = 0;
  for (const name of domains) {
    const clean = name.trim().toLowerCase();
    if (!clean) continue;
    const { rowCount } = await query(
      `INSERT INTO domains (domain_name, keitaro_id, monitor_template_id, registrar, provision_status, monitoring_status, enabled)
       VALUES ($1, $2, $3, 'Namecheap', 'CONNECTED', 'PENDING', TRUE)
       ON CONFLICT (domain_name) DO NOTHING`,
      [clean, keitaroId, monitorTemplateId]
    );
    if (rowCount) created++;
  }
  return created;
}

async function main() {
  await migrate();
  const { keitaroId, monitorTemplateId } = await seedIntegrations();
  const created = await seedDomains(keitaroId, monitorTemplateId);
  logger.info({ created }, "Seed complete");
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exit(1);
  });
