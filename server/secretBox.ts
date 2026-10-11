/**
 * Encryption at rest for operator secrets (their PayLink API key, 0094).
 *
 * AES-256-GCM with a server-only key from env (OPERATOR_SECRETS_KEY — 32 random
 * bytes, base64; set in Netlify, never in the database, never VITE_-prefixed).
 * A database dump, backup, or dashboard viewer sees only ciphertext. Each value
 * is bound to its operator (GCM additional data = operator id), so a ciphertext
 * copied onto another operator's row won't decrypt. Plaintext is never stored:
 * without the env key, sealing throws and callers refuse to connect.
 */
import crypto from "node:crypto";

const PREFIX = "v1:";

function key(): Buffer | null {
  const raw = process.env.OPERATOR_SECRETS_KEY;
  if (!raw) return null;
  const b = Buffer.from(raw, "base64");
  // Accept a proper 32-byte base64 key; otherwise derive 32 bytes from the value.
  return b.length === 32 ? b : crypto.createHash("sha256").update(raw).digest();
}

export function secretsKeyConfigured(): boolean {
  return !!key();
}

/** Encrypt `plain` for `ownerId`. Throws if the server key isn't configured. */
export function sealSecret(plain: string, ownerId: string): string {
  const k = key();
  if (!k) throw new Error("OPERATOR_SECRETS_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(ownerId, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a sealed value for `ownerId`; null if missing, tampered, or not ours. */
export function openSecret(stored: string | null | undefined, ownerId: string): string | null {
  if (!stored || !stored.startsWith(PREFIX)) return null; // never trust a plaintext value
  const k = key();
  if (!k) return null;
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAAD(Buffer.from(ownerId, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
