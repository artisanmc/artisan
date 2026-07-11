import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";

// 8-char uppercase alphanumeric, excludes I/O/0/1 (visually confusing)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

export async function generateServerKey(): Promise<{ id: string; key: string; hash: string }> {
  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = "sk_" + Array.from(rawBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const idBytes = crypto.getRandomValues(new Uint8Array(6));
  // `srv_` prefix (NOT `sk_`) so the row id is visually distinct from the
  // plaintext key (`sk_<64 hex>`). URLs like /networks/.../servers/srv_xxx
  // can't be mistaken for an exposed credential.
  const id = "srv_" + Array.from(idBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return { id, key, hash };
}

export async function validateServerKeyHeader(c: Context): Promise<string | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const rawKey = authHeader.slice(7);
  if (!rawKey) return null;

  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Generic opaque random token — used for one-off links (e.g. network transfers). */
export function generateRandomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return Array.from(bytes, (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join("");
}
