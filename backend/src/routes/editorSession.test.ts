import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";
import { generateEditorToken, validateEditorToken } from "../lib/auth";

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

describe("generateEditorToken", () => {
  test("returns 30-char alphanumeric token", () => {
    const token = generateEditorToken();
    expect(token).toHaveLength(30);
    expect(token).toMatch(/^[A-Za-z0-9]{30}$/);
  });

  test("two calls produce different tokens", () => {
    expect(generateEditorToken()).not.toBe(generateEditorToken());
  });
});

describe("validateEditorToken", () => {
  test("returns serverKeyId for valid token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "vh" + keyId.slice(0,8), createdAt: new Date() });

    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "CONSOLE",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const result = await validateEditorToken(token);
    expect(result).not.toBeNull();
    expect(result!.serverKeyId).toBe(keyId);
  });

  test("returns null for unknown token", async () => {
    expect(await validateEditorToken("doesnotexist000000000000000000")).toBeNull();
  });

  test("returns null for expired token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "eh" + keyId.slice(0,8), createdAt: new Date() });
    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "CONSOLE",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1),
    });
    expect(await validateEditorToken(token)).toBeNull();
  });

  test("returns null for revoked token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "rh" + keyId.slice(0,8), createdAt: new Date() });
    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "CONSOLE",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      revokedAt: new Date(),
    });
    expect(await validateEditorToken(token)).toBeNull();
  });
});
