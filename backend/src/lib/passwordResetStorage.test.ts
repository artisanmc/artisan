import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { passwordResetTokens, users } from "../db/schema";
import {
  consumeResetToken,
  createResetToken,
  hashResetToken,
} from "./passwordResetStorage";

const EMAIL = "reset_storage@example.com";
let userId: string;

beforeEach(async () => {
  await db.delete(users).where(eq(users.email, EMAIL));
  userId = "user_reset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const now = new Date();
  await db.insert(users).values({
    id: userId,
    email: EMAIL,
    name: "Reset",
    passwordHash: "x",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  });
});

describe("createResetToken", () => {
  test("returns a plaintext token and stores only its hash", async () => {
    const token = await createResetToken(userId);
    expect(token.length).toBeGreaterThan(20);

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toBe(await hashResetToken(token));
    expect(rows[0].usedAt).toBeNull();
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("consumeResetToken", () => {
  test("returns the userId and marks the token used", async () => {
    const token = await createResetToken(userId);
    const result = await consumeResetToken(token);
    expect(result).toBe(userId);

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
    expect(rows[0].usedAt).not.toBeNull();
  });

  test("refuses a replayed token", async () => {
    const token = await createResetToken(userId);
    expect(await consumeResetToken(token)).toBe(userId);
    expect(await consumeResetToken(token)).toBeNull();
  });

  test("refuses an expired token", async () => {
    const token = await createResetToken(userId);
    await db
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResetTokens.userId, userId));
    expect(await consumeResetToken(token)).toBeNull();
  });

  test("refuses an unknown token", async () => {
    expect(await consumeResetToken("nope-not-a-token")).toBeNull();
  });

  test("only one of two concurrent consumes wins", async () => {
    const token = await createResetToken(userId);
    const [a, b] = await Promise.all([
      consumeResetToken(token),
      consumeResetToken(token),
    ]);
    expect([a, b].filter((r) => r !== null)).toHaveLength(1);
  });
});
