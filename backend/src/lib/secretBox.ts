import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const hex = process.env.CONFIG_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("CONFIG_ENC_KEY must be a 32-byte hex string (64 chars)");
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM. Returns `iv:tag:ciphertext` (each base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(packed: string): string {
  const [ivB, tagB, ctB] = packed.split(":");
  if (!ivB || !tagB || !ctB) throw new Error("malformed ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  d.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([d.update(Buffer.from(ctB, "base64")), d.final()]).toString("utf8");
}

/** True when CONFIG_ENC_KEY is set & well-formed (else DB secret config is disabled). */
export function isSecretsConfigured(): boolean {
  const hex = process.env.CONFIG_ENC_KEY;
  return !!hex && hex.length === 64;
}
