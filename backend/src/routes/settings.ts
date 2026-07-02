import { Router } from "express";
import { query } from "../db/pool.ts";
import { getSetting, setSetting, sendTG } from "../services/telegram.ts";

export const settingsRouter = Router();

const KEYS = [
  "tg_bot_token",
  "tg_chat_ids",
  "notify_monitoring",
  "notify_expiry",
  "notify_purchase",
  "slow_threshold_ms",
  "ssl_reminder_days",
  "namecheap_contact",
];

settingsRouter.get("/", async (_req, res) => {
  try {
    const { rows } = await query<{ key: string; value: string | null }>(
      "SELECT key, value FROM settings"
    );
    const out: Record<string, string | null> = {};
    for (const k of KEYS) out[k] = null;
    for (const r of rows) out[r.key] = r.value;
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

settingsRouter.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    for (const key of KEYS) {
      if (key in body) await setSetting(key, String(body[key] ?? ""));
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

settingsRouter.post("/test-telegram", async (_req, res) => {
  try {
    const token = await getSetting("tg_bot_token");
    if (!token) return res.status(400).json({ error: "Telegram bot token not set" });
    await sendTG("✅ <b>Test</b> — DomainOps подключён к Telegram");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
