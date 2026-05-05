import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes } from "../db/schema";
import { generateCode, generateServerKey } from "../lib/auth";

describe("link_codes schema", () => {
  test("insert and read a link code", async () => {
    const code = "TEST0001";
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await db.insert(linkCodes).values({ code, createdAt: now, expiresAt });
    const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
    expect(rows.length).toBe(1);
    expect(rows[0].code).toBe(code);
    expect(rows[0].claimedAt).toBeNull();
    expect(rows[0].serverKeyId).toBeNull();
  });
});

describe("generateCode", () => {
  test("returns 8-char uppercase alphanumeric without confusable chars", () => {
    const code = generateCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
  });

  test("two calls produce different codes", () => {
    expect(generateCode()).not.toBe(generateCode());
  });
});

describe("generateServerKey", () => {
  test("returns sk_ key, UUID id, and matching SHA-256 hash", async () => {
    const { id, key, hash } = await generateServerKey();
    expect(key).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const expected = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(hash).toBe(expected);
  });
});
