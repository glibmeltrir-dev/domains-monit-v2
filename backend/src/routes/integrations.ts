import { Router } from "express";
import { query } from "../db/pool.ts";
import { NamecheapClient } from "../services/namecheap.ts";

export const integrationsRouter = Router();

// Fetch the live Namecheap balance and store it.
integrationsRouter.post("/namecheap/:id/refresh-balance", async (req, res) => {
  try {
    const { rows } = await query<any>(
      "SELECT * FROM namecheap_accounts WHERE id = $1",
      [req.params.id]
    );
    const acc = rows[0];
    if (!acc) return res.status(404).json({ error: "Account not found" });

    const nc = new NamecheapClient({
      apiUser: acc.api_user,
      apiKey: acc.api_key,
      userName: acc.username,
      clientIp: acc.client_ip || "",
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
