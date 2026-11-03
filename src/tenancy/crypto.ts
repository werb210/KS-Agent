// KS_SHARED_HOSTING_v1 - the shared registry encryption format (same in every Keystone repo):
//   key   = SHA-256(KS_TENANT_KEY)                      (AES-256)
//   value = v1:<iv base64>:<auth tag base64>:<ciphertext base64>   AES-256-GCM, 12-byte random IV, UTF-8 plaintext
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyFrom(tenantKey: string | undefined): Buffer {
  if (!tenantKey) throw new Error("KS_TENANT_KEY is not configured");
  return createHash("sha256").update(tenantKey, "utf8").digest();
}

export function encryptTenantValue(plaintext: string, tenantKey: string | undefined = process.env.KS_TENANT_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(tenantKey), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function decryptTenantValue(value: string, tenantKey: string | undefined = process.env.KS_TENANT_KEY): string {
  const parts = String(value ?? "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("unsupported_encrypted_value");
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  if (iv.length !== 12) throw new Error("unsupported_encrypted_value");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(tenantKey), iv);
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** env_enc → a JSON object of string values. An empty env_enc is an empty object. */
export function decryptTenantEnv(envEnc: string | null | undefined, tenantKey: string | undefined = process.env.KS_TENANT_KEY): Record<string, string> {
  if (!envEnc) return {};
  const parsed = JSON.parse(decryptTenantValue(envEnc, tenantKey)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("env_enc_not_an_object");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}
