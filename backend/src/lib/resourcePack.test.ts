import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { db } from "../db/index";
import {
  assets,
  serverKeys,
  projects,
  networks,
  linkCodes,
} from "../db/schema";
import { writeAssetFile, assetRoot } from "./assetStorage";
import { resourcePackRoot, resourcePackPath } from "./resourcePackStorage";
import { rebuildResourcePack, currentPackInfo } from "./resourcePack";
import { createNetwork } from "./networkManager";
import { createProject } from "./projectStorage";
import { join } from "path";

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

async function seedSetup(): Promise<{ serverKeyId: string; projectId: string }> {
  const net = await createNetwork("N");
  const serverKeyId = crypto.randomUUID();
  await db.insert(serverKeys).values({
    id: serverKeyId,
    hash: "h" + serverKeyId.slice(0, 8),
    networkId: net.id,
    createdAt: new Date(),
  });
  const project = await createProject({ networkId: net.id, serverKeyId, name: "p" });
  return { serverKeyId, projectId: project.id };
}

async function seedGlyph(projectId: string, name: string, codepoint: number): Promise<string> {
  const id = "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(assets).values({
    id, projectId, type: "glyph", name,
    width: 1, height: 1, ascent: 0, codepoint, fontMeta: null,
    contentHash: "h" + name, createdAt: new Date(), updatedAt: new Date(),
  });
  await writeAssetFile(projectId, id, PNG_1x1);
  return id;
}

let serverKeyId: string;
let projectId: string;

beforeEach(async () => {
  // FK-safe cleanup
  await db.delete(assets);
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(networks);
  ({ serverKeyId, projectId } = await seedSetup());
});

afterEach(async () => {
  await rm(join(resourcePackRoot(), serverKeyId), { recursive: true, force: true });
  await rm(join(assetRoot(), projectId), { recursive: true, force: true });
});

describe("rebuildResourcePack", () => {
  test("writes a zip and updates server_keys columns", async () => {
    await seedGlyph(projectId, "coin", 0xE000);
    const { hash, url } = await rebuildResourcePack(serverKeyId);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(url).toMatch(new RegExp(`/api/v1/resource-pack/${serverKeyId}/${hash}\\.zip$`));
    expect(existsSync(resourcePackPath(serverKeyId, hash))).toBe(true);

    const rows = await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId));
    expect(rows[0].resourcePackHash).toBe(hash);
    expect(rows[0].resourcePackUpdatedAt).toBeInstanceOf(Date);
  });

  test("two consecutive rebuilds with same assets produce the same hash", async () => {
    await seedGlyph(projectId, "coin", 0xE000);
    const r1 = await rebuildResourcePack(serverKeyId);
    const r2 = await rebuildResourcePack(serverKeyId);
    expect(r1.hash).toBe(r2.hash);
  });

  test("adding a glyph changes the hash", async () => {
    const r1 = await rebuildResourcePack(serverKeyId);
    await seedGlyph(projectId, "coin", 0xE000);
    const r2 = await rebuildResourcePack(serverKeyId);
    expect(r2.hash).not.toBe(r1.hash);
  });

  test("keeps at most 3 projects on disk plus the current one", async () => {
    for (let i = 0; i < 5; i++) {
      await seedGlyph(projectId, `g${i}`, 0xE000 + i);
      await rebuildResourcePack(serverKeyId);
      await new Promise((r) => setTimeout(r, 15));
    }
    const { hash } = await rebuildResourcePack(serverKeyId);
    expect(existsSync(resourcePackPath(serverKeyId, hash))).toBe(true);

    const { readdir } = await import("fs/promises");
    const files = await readdir(join(resourcePackRoot(), serverKeyId));
    expect(files.filter((f) => f.endsWith(".zip")).length).toBeLessThanOrEqual(3);
  });

  test("currentPackInfo returns null when never built", async () => {
    expect(await currentPackInfo(serverKeyId)).toBeNull();
  });

  test("currentPackInfo returns { url, hash } after a build", async () => {
    await seedGlyph(projectId, "coin", 0xE000);
    const { hash } = await rebuildResourcePack(serverKeyId);
    const info = await currentPackInfo(serverKeyId);
    expect(info).not.toBeNull();
    expect(info!.hash).toBe(hash);
    expect(info!.url.endsWith(`/api/v1/resource-pack/${serverKeyId}/${hash}.zip`)).toBe(true);
  });

  test("multi-project: server_key bound to 2 projects with colliding codepoints → asset-index has distinct final codepoints", async () => {
    // The seedSetup fixture already created `projectId` (project A) for serverKeyId.
    // Add a second bound project B with a glyph that collides at the same codepoint.
    const skRow = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0]!;
    const projectB = await createProject({ networkId: skRow.networkId, serverKeyId, name: "pb" });

    const glyphAId = await seedGlyph(projectId, "alpha", 0xE000);
    const glyphBId = await seedGlyph(projectB.id, "beta", 0xE000);

    const { hash } = await rebuildResourcePack(serverKeyId);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);

    // Inspect the produced zip to read asset-index.json.
    const { unzipSync, strFromU8 } = await import("fflate");
    const { readFile } = await import("fs/promises");
    const zipBytes = await readFile(resourcePackPath(serverKeyId, hash));
    const entries = unzipSync(new Uint8Array(zipBytes));
    const indexBytes = entries["assets/artisan/asset-index.json"]!;
    const index = JSON.parse(strFromU8(indexBytes)) as {
      assets: Record<string, { codepoint?: number }>;
    };

    // First project (oldest createdAt) keeps 0xE000; second project gets remapped to 0xE001.
    expect(index.assets[glyphAId].codepoint).toBe(0xE000);
    expect(index.assets[glyphBId].codepoint).toBe(0xE001);
  });
});
