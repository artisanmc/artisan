import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { packCommits, packBranches, packs, networks, serverKeys, users } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  createCommit, getCommit, listCommitsByPack, computeContentHash,
} from "./commitStorage";
import { createNetwork } from "./networkManager";
import { createPack } from "./packStorage";
import { generateServerKey } from "./auth";

async function seedSetup() {
  await db.delete(packBranches);
  await db.delete(packCommits);
  await db.delete(packs);
  await db.delete(serverKeys);
  await db.delete(networks);
  await db.delete(users);
  const net = await createNetwork("N");
  const { id: skId, hash: skHash } = await generateServerKey();
  await db.insert(serverKeys).values({ id: skId, hash: skHash, label: null, networkId: net.id, createdAt: new Date() });
  const pack = await createPack({ networkId: net.id, serverKeyId: skId, name: "p" });
  return { networkId: net.id, packId: pack.id };
}

describe("commitStorage", () => {
  it("computeContentHash is deterministic across calls", () => {
    const files = { "a.yaml": "x", "b.yaml": "y" };
    const h1 = computeContentHash(files);
    const h2 = computeContentHash({ "b.yaml": "y", "a.yaml": "x" });  // different key order
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("createCommit inserts with cmt_ id and computed contentHash", async () => {
    const { packId } = await seedSetup();
    const cmt = await createCommit({
      packId,
      parentId: null,
      files: { "a.yaml": "x" },
      editor: { id: packId, menus: [] },
      authorUserId: null,
      message: "initial",
    });
    expect(cmt.id).toMatch(/^cmt_[0-9a-f]{12}$/);
    expect(cmt.packId).toBe(packId);
    expect(cmt.parentId).toBeNull();
    expect(cmt.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cmt.message).toBe("initial");
  });

  it("createCommit returns existing commit when same (packId, contentHash) — dedup", async () => {
    const { packId } = await seedSetup();
    const files = { "a.yaml": "x" };
    const editor = { id: packId, menus: [] };
    const c1 = await createCommit({ packId, parentId: null, files, editor, authorUserId: null, message: "first" });
    const c2 = await createCommit({ packId, parentId: c1.id, files, editor, authorUserId: null, message: "second" });
    expect(c2.id).toBe(c1.id);  // same id = same commit (dedup)
    // Note: createPack now auto-creates an initial empty commit, so there are 2 total:
    // the initial commit (empty files) and the commit created by this test (with files).
    const rows = await db.select().from(packCommits).where(eq(packCommits.packId, packId));
    expect(rows).toHaveLength(2);
  });

  it("getCommit returns the row or null", async () => {
    const { packId } = await seedSetup();
    const c = await createCommit({ packId, parentId: null, files: { "a": "x" }, editor: null, authorUserId: null, message: "" });
    expect((await getCommit(c.id))?.id).toBe(c.id);
    expect(await getCommit("cmt_nope")).toBeNull();
  });

  it("listCommitsByPack returns commits in reverse chronological order", async () => {
    const { packId } = await seedSetup();
    const a = await createCommit({ packId, parentId: null, files: { "f": "1" }, editor: null, authorUserId: null, message: "a" });
    await new Promise((r) => setTimeout(r, 10));
    const b = await createCommit({ packId, parentId: a.id, files: { "f": "2" }, editor: null, authorUserId: null, message: "b" });
    const list = await listCommitsByPack(packId, 10);
    // Note: createPack now auto-creates an initial empty commit, so expect it in the list.
    // Order should be: b (newest), a, then the auto-created initial commit (oldest).
    const ids = list.map((c) => c.id);
    expect(ids[0]).toBe(b.id);
    expect(ids[1]).toBe(a.id);
    expect(ids).toHaveLength(3);  // b, a, and the auto-created initial commit
  });
});
