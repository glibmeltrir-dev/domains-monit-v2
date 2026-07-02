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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Telegram rate limits group messages hard (~20/min). Serialize all sends
// through a single queue with a minimum spacing between messages and honour
// the server's `retry_after` on 429, so bursts (e.g. mass status transitions)
// no longer spam failed requests.
const MIN_INTERVAL_MS = 1500;
const MAX_QUEUE = 500;
let chain: Promise<void> = Promise.resolve();
let lastSentAt = 0;
let pending = 0;

function enqueueSend(url: string, chat_id: string, text: string): void {
  if (pending >= MAX_QUEUE) {
    logger.warn({ pending }, "Telegram queue full, dropping message");
    return;
  }
  pending++;
  chain = chain
    .then(async () => {
      const wait = MIN_INTERVAL_MS - (Date.now() - lastSentAt);
      if (wait > 0) await sleep(wait);

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await axios.post(
            url,
            { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true },
            { timeout: 10000 }
          );
          break;
        } catch (err: any) {
          const status = err?.response?.status;
          const retryAfter = Number(err?.response?.data?.parameters?.retry_after);
          if (status === 429 && Number.isFinite(retryAfter) && attempt === 0) {
            await sleep((retryAfter + 1) * 1000);
            continue;
          }
          logger.warn({ err: err?.message, chat_id }, "Telegram send failed");
          break;
        }
      }
      lastSentAt = Date.now();
    })
    .catch(() => undefined)
    .finally(() => {
      pending--;
    });
}

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

  // Fire-and-forget into the throttled queue — callers (monitor jobs) are not
  // blocked on delivery.
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  for (const chat_id of chatIds) enqueueSend(url, chat_id, text);
}
