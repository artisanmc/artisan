import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes } from "../db/schema";

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
