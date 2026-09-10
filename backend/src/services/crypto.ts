import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.ts";

const PREFIX = "enc:v1:";

function keyBytes(): Buffer {
  const raw = config.encryption.key;
  if (!raw || raw.length < 16) {
    throw new Error("ENCRYPTION_KEY is not configured");
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

// AES-256-GCM. Stored as enc:v1:<iv>.<tag>.<ciphertext> (base64url).
export function encrypt(plaintext: string | null | undefined): string {
  if (plaintext == null || plaintext === "") return plaintext ?? "";
  if (isEncrypted(plaintext)) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decrypt(value: string | null | undefined): string {
  if (value == null || value === "") return value ?? "";
  if (!isEncrypted(value)) return value;
  const rest = value.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = rest.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Corrupt encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
