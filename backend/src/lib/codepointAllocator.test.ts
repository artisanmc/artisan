import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "../db/index";
import { assets, projects, networks, serverKeys } from "../db/schema";
import { allocateCodepoint, CODEPOINT_MIN, CODEPOINT_MAX } from "./codepointAllocator";
import { createNetwork } from "./networkManager";
import { createProject } from "./projectStorage";
import { generateServerKey } from "./auth";

async function seedProject(): Promise<string> {
  const net = await createNetwork("N");
  const { id: skId, hash: skHash } = await generateServerKey();
  await db.insert(serverKeys).values({ id: skId, hash: skHash, label: null, networkId: net.id, createdAt: new Date() });
  const project = await createProject({ networkId: net.id, serverKeyId: skId, name: "p_" + crypto.randomUUID().slice(0, 6) });
  return project.id;
}

async function seedGlyph(projectId: string, codepoint: number): Promise<void> {
  await db.insert(assets).values({
    id: "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    projectId,
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

async function seedTexture(projectId: string): Promise<void> {
  await db.insert(assets).values({
    id: "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    projectId,
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
  beforeEach(async () => {
    await db.delete(assets);
    await db.delete(projects);
    await db.delete(networks);
  });

  test("returns CODEPOINT_MIN when no glyphs exist", async () => {
    const pk = await seedProject();
    expect(await allocateCodepoint(pk)).toBe(CODEPOINT_MIN);
  });

  test("returns next after highest used", async () => {
    const pk = await seedProject();
    await seedGlyph(pk, CODEPOINT_MIN);
    await seedGlyph(pk, CODEPOINT_MIN + 2);
    expect(await allocateCodepoint(pk)).toBe(CODEPOINT_MIN + 3);
  });

  test("ignores other projects' codepoints", async () => {
    const pk1 = await seedProject();
    const pk2 = await seedProject();
    await seedGlyph(pk1, CODEPOINT_MIN + 50);
    expect(await allocateCodepoint(pk2)).toBe(CODEPOINT_MIN);
  });

  test("throws when range exhausted", async () => {
    const pk = await seedProject();
    await seedGlyph(pk, CODEPOINT_MAX);
    try {
      await allocateCodepoint(pk);
      throw new Error("Expected allocateCodepoint to throw");
    } catch (e: any) {
      expect(e.message).toMatch(/range exhausted/i);
    }
  });

  test("ignores texture rows with NULL codepoint", async () => {
    const pk = await seedProject();
    await seedTexture(pk);
    expect(await allocateCodepoint(pk)).toBe(CODEPOINT_MIN);
  });

  test("never allocates into the U+F800..U+F8FF reserved range (space-offset codepoints)", async () => {
    const pk = await seedProject();
    await seedGlyph(pk, CODEPOINT_MAX - 1);
    const next = await allocateCodepoint(pk);
    expect(next).toBe(CODEPOINT_MAX);
    expect(next).toBeLessThan(0xF800);
  });
});
