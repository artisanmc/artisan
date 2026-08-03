import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { passwordResetTokens } from "../db/schema";
import { generateRandomToken } from "./auth";

const EXPIRES_IN_MS = 60 * 60 * 1000; // 1 hour

export async function hashResetToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Creates a reset token and returns it in plaintext — only its hash is stored. */
export async function createResetToken(userId: string): Promise<string> {
  const token = generateRandomToken();
  const now = new Date();
  await db.insert(passwordResetTokens).values({
    id: "prt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    userId,
    tokenHash: await hashResetToken(token),
    expiresAt: new Date(now.getTime() + EXPIRES_IN_MS),
    usedAt: null,
    createdAt: now,
  });
  return token;
}

/**
 * Atomically consumes a reset token: stamps usedAt only if the row is still
 * unused and unexpired at the DB level. Returns the owning userId, or null if
 * the token is unknown / expired / already spent (including when a concurrent
 * submit won the race).
 */
export async function consumeResetToken(
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  const tokenHash = await hashResetToken(token);
  const rows = await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, now),
    ))
    .returning();
  return rows[0]?.userId ?? null;
}

/** Invalidates every outstanding token of a user (called after a successful reset). */
export async function invalidateUserResetTokens(userId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
}
