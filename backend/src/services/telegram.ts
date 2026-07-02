import axios from "axios";
import { query } from "../db/pool.ts";
import { logger } from "../logger.ts";

export async function getSetting(key: string): Promise<string | null> {
  const { rows } = await query<{ value: string | null }>(
    "SELECT value FROM settings WHERE key = $1",
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

async function getTelegramConfig(): Promise<{ token: string | null; chatIds: string[] }> {
  const token = (await getSetting("tg_bot_token")) || process.env.TG_BOT_TOKEN || null;
  const raw = (await getSetting("tg_chat_ids")) || process.env.TG_CHAT_IDS || "";
  const chatIds = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return { token, chatIds };
}

export type NotifyCategory = "monitoring" | "expiry" | "purchase";

const CATEGORY_SETTING: Record<NotifyCategory, string> = {
  monitoring: "notify_monitoring",
  expiry: "notify_expiry",
  purchase: "notify_purchase",
};

export async function sendTG(text: string, category?: NotifyCategory): Promise<void> {
  const { token, chatIds } = await getTelegramConfig();
  if (!token || chatIds.length === 0) {
    logger.debug("Telegram not configured, skipping notification");
    return;
  }

  // Honor the per-category toggles from Settings (default: enabled).
  if (category) {
    const flag = await getSetting(CATEGORY_SETTING[category]);
    if (flag === "0") return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await Promise.all(
    chatIds.map((chat_id) =>
      axios
        .post(
          url,
          {
            chat_id,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          },
          { timeout: 10000 }
        )
        .catch((err) => logger.warn({ err: err?.message, chat_id }, "Telegram send failed"))
    )
  );
}
