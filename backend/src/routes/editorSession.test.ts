import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";

describe("editor_sessions schema", () => {
  test("insert and read a session", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "testhash" + keyId.slice(0,8), createdAt: new Date() });

    const token = "test_token_" + crypto.randomUUID().slice(0, 8);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "TestAdmin",
      createdAt: now,
      expiresAt,
    });

    const rows = await db.select().from(editorSessions).where(eq(editorSessions.token, token));
    expect(rows.length).toBe(1);
    expect(rows[0].serverKeyId).toBe(keyId);
    expect(rows[0].revokedAt).toBeNull();
  });
});
