import { query } from "../db/pool.ts";
import { logger } from "../logger.ts";
import { decrypt, encrypt, isEncrypted } from "./crypto.ts";

export const TABLE_SECRET_FIELDS: Record<string, string[]> = {
  namecheap_accounts: ["api_key"],
  cloudflare_accounts: ["api_token"],
  keitaro_trackers: ["api_key"],
};

export const SETTINGS_SECRET_KEYS = new Set(["tg_bot_token"]);

const DECRYPT_ALIASES = ["api_key", "api_token", "keitaro_key", "cf_token"];

export function isBlankSecret(value: unknown): boolean {
  if (value == null) return true;
  const s = String(value).trim();
  return s === "" || /^[•*]+$/.test(s);
}

export function encryptSecretsInBody(
  table: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const fields = TABLE_SECRET_FIELDS[table];
  if (!fields) return body;
  const out = { ...body };
  for (const field of fields) {
    if (!(field in out)) continue;
    if (isBlankSecret(out[field])) {
      delete out[field];
      continue;
    }
    out[field] = encrypt(String(out[field]));
  }
  return out;
}

export function revealSecrets<T extends Record<string, unknown>>(row: T | null | undefined): T | null {
  if (!row) return row ?? null;
  const out = { ...row };
  for (const field of DECRYPT_ALIASES) {
    if (typeof out[field] === "string") {
      (out as Record<string, unknown>)[field] = decrypt(out[field] as string);
    }
  }
  return out;
}

export function redactSecretsForApi<T extends Record<string, unknown>>(
  table: string,
  row: T
): T {
  const fields = TABLE_SECRET_FIELDS[table] ?? [];
  const out = { ...row } as Record<string, unknown>;
  for (const field of fields) {
    const present = typeof out[field] === "string" && String(out[field]).length > 0;
    out[field] = "";
    out[`${field}_set`] = present;
  }
  return out as T;
}

export async function encryptExistingSecrets(): Promise<void> {
  const jobs: Array<{ table: string; id: number; field: string; value: string }> = [];

  for (const [table, fields] of Object.entries(TABLE_SECRET_FIELDS)) {
    const { rows } = await query<Record<string, unknown>>(`SELECT id, ${fields.join(", ")} FROM ${table}`);
    for (const row of rows) {
      for (const field of fields) {
        const value = row[field];
        if (typeof value === "string" && value && !isEncrypted(value)) {
          jobs.push({ table, id: Number(row.id), field, value });
        }
      }
    }
  }

  const { rows: settings } = await query<{ key: string; value: string | null }>(
    "SELECT key, value FROM settings"
  );
  for (const s of settings) {
    if (!SETTINGS_SECRET_KEYS.has(s.key)) continue;
    if (typeof s.value === "string" && s.value && !isEncrypted(s.value)) {
      jobs.push({ table: "settings", id: 0, field: s.key, value: s.value });
    }
  }

  for (const job of jobs) {
    const cipher = encrypt(job.value);
    if (job.table === "settings") {
      await query("UPDATE settings SET value = $1 WHERE key = $2", [cipher, job.field]);
    } else {
      await query(`UPDATE ${job.table} SET ${job.field} = $1 WHERE id = $2`, [cipher, job.id]);
    }
  }

  if (jobs.length) logger.info({ count: jobs.length }, "encrypted plaintext secrets at rest");
}
