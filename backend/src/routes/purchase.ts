import { Router } from "express";
import { query } from "../db/pool.ts";
import { provisionQueue } from "../queue/index.ts";
import { NamecheapClient } from "../services/namecheap.ts";

export const purchaseRouter = Router();

interface GroupAccounts {
  namecheap: any | null;
  cloudflare: any | null;
  keitaro: any | null;
}

async function resolveGroupAccounts(groupId: number | null): Promise<GroupAccounts> {
  const where = groupId ? "WHERE group_id = $1" : "";
  const params = groupId ? [groupId] : [];
  const [nc, cf, k] = await Promise.all([
    query(`SELECT * FROM namecheap_accounts ${where} ORDER BY id LIMIT 1`, params),
    query(`SELECT * FROM cloudflare_accounts ${where} ORDER BY id LIMIT 1`, params),
    query(`SELECT * FROM keitaro_trackers ${where} ORDER BY id LIMIT 1`, params),
  ]);
  return { namecheap: nc.rows[0] ?? null, cloudflare: cf.rows[0] ?? null, keitaro: k.rows[0] ?? null };
}

function cleanDomain(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

// Check availability of a list of domains against the group's Namecheap account.
purchaseRouter.post("/check", async (req, res) => {
  try {
    const { domains, group_id = null } = req.body ?? {};
    const list = (domains as string[]).map(cleanDomain).filter(Boolean);
    if (!list.length) return res.status(400).json({ error: "domains[] required" });

    const { namecheap } = await resolveGroupAccounts(group_id);
    if (!namecheap) return res.status(400).json({ error: "No Namecheap account in group" });

    const nc = new NamecheapClient({
      apiUser: namecheap.api_user,
      apiKey: namecheap.api_key,
      userName: namecheap.username,
      clientIp: namecheap.client_ip || "",
    });

    const results = await nc.checkDomains(list);
    res.json({ results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Buy (optional) + connect the given domains, enqueueing provisioning jobs.
purchaseRouter.post("/buy", async (req, res) => {
  try {
    const {
      domains,
      group_id = null,
      cf_template_id = null,
      register = true,
      years = 1,
    } = req.body ?? {};

    const list = (domains as string[]).map(cleanDomain).filter(Boolean);
    if (!list.length) return res.status(400).json({ error: "domains[] required" });

    const { namecheap, cloudflare, keitaro } = await resolveGroupAccounts(group_id);
    if (!cloudflare) return res.status(400).json({ error: "No Cloudflare account in group" });

    const queued: string[] = [];
    for (const name of list) {
      const { rows } = await query(
        `INSERT INTO domains
           (domain_name, namecheap_account_id, cloudflare_account_id, keitaro_id, provision_status, monitoring_status, enabled)
         VALUES ($1, $2, $3, $4, 'PENDING', 'PENDING', FALSE)
         ON CONFLICT (domain_name) DO UPDATE SET
           namecheap_account_id = EXCLUDED.namecheap_account_id,
           cloudflare_account_id = EXCLUDED.cloudflare_account_id,
           keitaro_id = EXCLUDED.keitaro_id,
           provision_status = 'PENDING'
         RETURNING id`,
        [name, namecheap?.id ?? null, cloudflare.id, keitaro?.id ?? null]
      );
      const domainId = rows[0].id as number;
      await provisionQueue.add(
        "provision",
        { domainId, register: !!register, cfTemplateId: cf_template_id, years },
        { jobId: `provision:${domainId}:${Date.now()}` }
      );
      queued.push(name);
    }

    res.json({ queued: queued.length, domains: queued });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
