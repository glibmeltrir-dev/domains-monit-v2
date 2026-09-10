import { Router } from "express";
import { query } from "../db/pool.ts";
import { NamecheapClient } from "../services/namecheap.ts";
import { CloudflareClient } from "../services/cloudflare.ts";
import { redactSecretsForApi, revealSecrets } from "../services/secrets.ts";

export const integrationsRouter = Router();

// Fetch the live Namecheap balance and store it.
integrationsRouter.post("/namecheap/:id/refresh-balance", async (req, res) => {
  try {
    const { rows } = await query<any>(
      "SELECT * FROM namecheap_accounts WHERE id = $1",
      [req.params.id]
    );
    const acc = revealSecrets(rows[0]);
    if (!acc) return res.status(404).json({ error: "Account not found" });

    const nc = new NamecheapClient({
      apiUser: String(acc.api_user ?? ""),
      apiKey: String(acc.api_key ?? ""),
      userName: String(acc.username ?? ""),
      clientIp: String(acc.client_ip || ""),
    });
    const balance = await nc.getBalance();
    await query("UPDATE namecheap_accounts SET balance = $1 WHERE id = $2", [
      balance,
      acc.id,
    ]);
    res.json({ balance });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

integrationsRouter.post("/cloudflare/:id/test", async (req, res) => {
  try {
    const { rows } = await query<any>(
      "SELECT * FROM cloudflare_accounts WHERE id = $1",
      [req.params.id]
    );
    const acc = revealSecrets(rows[0]);
    if (!acc) return res.status(404).json({ error: "Account not found" });

    const cf = new CloudflareClient(String(acc.api_token ?? ""), (acc.account_id as string) || undefined);
    // Account-scoped / cfat_ tokens often cannot call /user/tokens/verify (401).
    // Zone list is the permission we actually need for connect/sync.
    const zones = await cf.zoneCountSample();
    res.json({
      ok: true,
      status: "active",
      zones,
      accountId: acc.account_id || null,
    });
  } catch (e: any) {
    const cfMsg = e?.response?.data?.errors?.[0]?.message;
    res.status(500).json({ error: cfMsg || e.message });
  }
});

integrationsRouter.get("/", async (_req, res) => {
  try {
    const [namecheap, cloudflare, keitaro, groups] = await Promise.all([
      query("SELECT * FROM namecheap_accounts ORDER BY id"),
      query("SELECT * FROM cloudflare_accounts ORDER BY id"),
      query("SELECT * FROM keitaro_trackers ORDER BY id"),
      query("SELECT * FROM integration_groups ORDER BY id"),
    ]);
    res.json({
      namecheap: namecheap.rows.map((r) => ({
        ...redactSecretsForApi("namecheap_accounts", r),
        balance: Number(r.balance),
      })),
      cloudflare: cloudflare.rows.map((r) => redactSecretsForApi("cloudflare_accounts", r)),
      keitaro: keitaro.rows.map((r) => redactSecretsForApi("keitaro_trackers", r)),
      groups: groups.rows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
