import { query } from "../db/pool.ts";
import { logger } from "../logger.ts";
import { CloudflareClient } from "./cloudflare.ts";
import { NamecheapClient } from "./namecheap.ts";
import { KeitaroClient } from "./keitaro.ts";

export interface SyncSummary {
  domains: number;
  cloudflareMatched: number;
  namecheapUpdated: number;
  keitaroRegistered: number;
  errors: string[];
}

// Reconcile all domains against the connected providers in bulk (a handful of
// list calls instead of per-domain requests):
//   - Cloudflare: zone id, delegated NS, origin A record IP, proxy state.
//   - Namecheap:  registry expiry date (reliable for our TLDs).
//   - Keitaro:    whether the domain already exists in the tracker.
export async function syncAll(): Promise<SyncSummary> {
  const summary: SyncSummary = {
    domains: 0,
    cloudflareMatched: 0,
    namecheapUpdated: 0,
    keitaroRegistered: 0,
    errors: [],
  };

  const { rows: domains } = await query<{ id: number; domain_name: string }>(
    "SELECT id, domain_name FROM domains"
  );
  summary.domains = domains.length;
  const byName = new Map(domains.map((d) => [d.domain_name.toLowerCase(), d.id]));

  // ---- Cloudflare: zone / NS / origin IP / proxied ----
  try {
    const { rows: cfAccounts } = await query<{
      id: number;
      api_token: string;
      account_id: string | null;
    }>("SELECT id, api_token, account_id FROM cloudflare_accounts WHERE status = 'ACTIVE'");

    for (const acc of cfAccounts) {
      const cf = new CloudflareClient(acc.api_token, acc.account_id ?? undefined);
      let zones;
      try {
        zones = await cf.listZones();
      } catch (e: any) {
        summary.errors.push(`Cloudflare#${acc.id} zones: ${e.message}`);
        continue;
      }

      for (const z of zones) {
        const id = byName.get(z.name);
        if (!id) continue;

        let origin: string | null = null;
        let proxied: boolean | null = null;
        try {
          const rec = await cf.getARecord(z.id, z.name);
          if (rec) {
            origin = rec.content;
            proxied = rec.proxied;
          }
        } catch (e: any) {
          summary.errors.push(`Cloudflare ${z.name}: ${e.message}`);
        }

        await query(
          `UPDATE domains
             SET cloudflare_account_id = COALESCE(cloudflare_account_id, $1),
                 cloudflare_zone_id    = $2,
                 ns                    = CASE WHEN $3 <> '' THEN $3 ELSE ns END,
                 resolved_ip           = COALESCE($4, resolved_ip),
                 proxied               = COALESCE($5, proxied),
                 synced_at             = now()
           WHERE id = $6`,
          [acc.id, z.id, z.nameServers.join("\n"), origin, proxied, id]
        );
        summary.cloudflareMatched++;
      }
    }
  } catch (e: any) {
    summary.errors.push(`Cloudflare: ${e.message}`);
  }

  // ---- Namecheap: registry expiry ----
  try {
    const { rows: ncAccounts } = await query<{
      id: number;
      api_user: string;
      api_key: string;
      username: string;
      client_ip: string;
    }>(
      "SELECT id, api_user, api_key, username, client_ip FROM namecheap_accounts WHERE status = 'ACTIVE'"
    );

    for (const acc of ncAccounts) {
      const nc = new NamecheapClient({
        apiUser: acc.api_user,
        apiKey: acc.api_key,
        userName: acc.username,
        clientIp: acc.client_ip || "",
      });
      let list;
      try {
        list = await nc.listDomains();
      } catch (e: any) {
        summary.errors.push(`Namecheap#${acc.id}: ${e.message}`);
        continue;
      }

      for (const item of list) {
        const id = byName.get(item.domain);
        if (!id || !item.expires) continue;
        await query(
          `UPDATE domains
             SET expiration_date      = $1,
                 namecheap_account_id = COALESCE(namecheap_account_id, $2)
           WHERE id = $3`,
          [item.expires.toISOString(), acc.id, id]
        );
        summary.namecheapUpdated++;
      }
    }
  } catch (e: any) {
    summary.errors.push(`Namecheap: ${e.message}`);
  }

  // ---- Keitaro: membership ----
  try {
    const { rows: trackers } = await query<{ id: number; url: string; api_key: string }>(
      "SELECT id, url, api_key FROM keitaro_trackers WHERE status = 'ACTIVE' AND url <> '' AND api_key <> ''"
    );

    if (trackers.length) {
      const registered = new Set<string>();
      for (const t of trackers) {
        try {
          const list = await new KeitaroClient(t.url, t.api_key).listDomains();
          for (const d of list) registered.add(String(d.name).toLowerCase());
        } catch (e: any) {
          summary.errors.push(`Keitaro#${t.id}: ${e.message}`);
        }
      }
      const arr = [...registered];
      await query(
        "UPDATE domains SET keitaro_registered = (lower(domain_name) = ANY($1::text[]))",
        [arr]
      );
      summary.keitaroRegistered = arr.length;
    }
  } catch (e: any) {
    summary.errors.push(`Keitaro: ${e.message}`);
  }

  logger.info(summary, "domain sync complete");
  return summary;
}
