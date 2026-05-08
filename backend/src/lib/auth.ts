import { desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";

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
  const id = crypto.randomUUID();
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

export function generateEditorToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return Array.from(bytes, (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join("");
}

export function generateTrustCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

export async function validateAccessToken(
  token: string,
): Promise<{ serverKeyId: string; sessionId: string; trusted: boolean; trustCode: string; trustedIp: string | null } | null> {
  const rows = await db.select().from(editorSessions).where(eq(editorSessions.accessToken, token));
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revokedAt) return null;
  if (!row.accessExpiresAt || row.accessExpiresAt < new Date()) return null;
  return {
    serverKeyId: row.serverKeyId,
    sessionId: row.token,
    trusted: row.trustedAt != null,
    trustCode: row.trustCode ?? "",
    trustedIp: row.trustedIp ?? null,
  };
}

export async function findSessionByTrustCode(
  trustCode: string,
): Promise<{ urlToken: string; accessToken: string | null; serverKeyId: string } | null> {
  const rows = await db
    .select()
    .from(editorSessions)
    .where(eq(editorSessions.trustCode, trustCode))
    .orderBy(desc(editorSessions.createdAt));
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revokedAt || row.expiresAt < new Date()) return null;
  return { urlToken: row.token, accessToken: row.accessToken, serverKeyId: row.serverKeyId };
}

export async function validateEditorToken(
  token: string,
): Promise<{ serverKeyId: string } | null> {
  const rows = await db
    .select()
    .from(editorSessions)
    .where(eq(editorSessions.token, token));
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revokedAt) return null;
  if (row.expiresAt < new Date()) return null;
  return { serverKeyId: row.serverKeyId };
}
