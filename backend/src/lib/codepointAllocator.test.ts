import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { assets, serverKeys } from "../db/schema";
import { allocateCodepoint, CODEPOINT_MIN, CODEPOINT_MAX } from "./codepointAllocator";

async function seedServerKey(): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(serverKeys).values({ id, hash: "h" + id.slice(0, 8), createdAt: new Date() });
  return id;
}

async function seedGlyph(serverKeyId: string, codepoint: number): Promise<void> {
  await db.insert(assets).values({
    id: crypto.randomUUID(),
    serverKeyId,
    type: "glyph",
    name: "g" + codepoint,
    width: 8,
    height: 8,
    ascent: 7,
    codepoint,
    fontMeta: null,
    contentHash: "abc" + codepoint,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function seedTexture(serverKeyId: string): Promise<void> {
  await db.insert(assets).values({
    id: crypto.randomUUID(),
    serverKeyId,
    type: "texture",
    name: "tex_" + crypto.randomUUID().slice(0, 8),
    width: 16,
    height: 16,
    ascent: null,
    codepoint: null,
    fontMeta: null,
    contentHash: "tex" + crypto.randomUUID().slice(0, 8),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("allocateCodepoint", () => {
  test("returns CODEPOINT_MIN when no glyphs exist", async () => {
    const sk = await seedServerKey();
    expect(await allocateCodepoint(sk)).toBe(CODEPOINT_MIN);
  });

  test("returns next after highest used", async () => {
    const sk = await seedServerKey();
    await seedGlyph(sk, CODEPOINT_MIN);
    await seedGlyph(sk, CODEPOINT_MIN + 2);
    expect(await allocateCodepoint(sk)).toBe(CODEPOINT_MIN + 3);
  });

  test("ignores other server_keys' codepoints", async () => {
    const sk1 = await seedServerKey();
    const sk2 = await seedServerKey();
    await seedGlyph(sk1, CODEPOINT_MIN + 50);
    expect(await allocateCodepoint(sk2)).toBe(CODEPOINT_MIN);
  });

  test("throws when range exhausted", async () => {
    const sk = await seedServerKey();
    await seedGlyph(sk, CODEPOINT_MAX);
    try {
      await allocateCodepoint(sk);
      throw new Error("Expected allocateCodepoint to throw");
    } catch (e: any) {
      expect(e.message).toMatch(/range exhausted/i);
    }
  });

  test("ignores texture rows with NULL codepoint", async () => {
    const sk = await seedServerKey();
    await seedTexture(sk);
    expect(await allocateCodepoint(sk)).toBe(CODEPOINT_MIN);
  });

  test("never allocates into the U+F800..U+F8FF reserved range (space-offset codepoints)", async () => {
    // Sanity: the cap (CODEPOINT_MAX = U+F7FF) sits exactly below the
    // reserved range used by lib/spaceOffsets.ts. Any allocation up to and
    // including the cap must stay below U+F800.
    const sk = await seedServerKey();
    await seedGlyph(sk, CODEPOINT_MAX - 1);
    const next = await allocateCodepoint(sk);
    expect(next).toBe(CODEPOINT_MAX);
    expect(next).toBeLessThan(0xF800);
  });
});
