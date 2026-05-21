import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBranches, packCommits, packs, networks } from "../db/schema";
import {
  createBranch, getBranch, advanceBranchHead, listBranchesForPack, isAncestor,
  findLCA,
} from "./branchStorage";
import { createNetwork } from "./networkManager";
import { createPack } from "./packStorage";
import { createCommit } from "./commitStorage";

async function seedSetup() {
  await db.delete(packBranches);
  await db.delete(packCommits);
  await db.delete(packs);
  await db.delete(networks);
  const net = await createNetwork("N");
  const pack = await createPack({ networkId: net.id, name: "p" });
  const root = await createCommit({
    packId: pack.id, parentId: null, files: { "init": "" }, editor: null,
    authorUserId: null, message: "root",
  });
  return { packId: pack.id, rootCommitId: root.id };
}

describe("branchStorage", () => {
  it("createBranch + getBranch", async () => {
    const { packId, rootCommitId } = await seedSetup();
    // createPack now auto-creates "main", so use a different name for this test
    await createBranch(packId, "dev", rootCommitId);
    const branch = await getBranch(packId, "dev");
    expect(branch?.name).toBe("dev");
    expect(branch?.headCommitId).toBe(rootCommitId);
  });

  it("createBranch errors on duplicate (packId, name)", async () => {
    const { packId, rootCommitId } = await seedSetup();
    // createPack now auto-creates "main", so test duplicate with "main"
    let errorThrown = false;
    try {
      await createBranch(packId, "main", rootCommitId);
    } catch (e) {
      errorThrown = true;
    }
    expect(errorThrown).toBe(true);
  });

  it("advanceBranchHead updates head + updatedAt", async () => {
    const { packId, rootCommitId } = await seedSetup();
    // createPack now auto-creates "main", so we can directly use it
    const second = await createCommit({
      packId, parentId: rootCommitId, files: { "init": "x" }, editor: null,
      authorUserId: null, message: "second",
    });
    await advanceBranchHead(packId, "main", second.id);
    const branch = await getBranch(packId, "main");
    expect(branch?.headCommitId).toBe(second.id);
  });

  it("listBranchesForPack returns all branches", async () => {
    const { packId, rootCommitId } = await seedSetup();
    // createPack now auto-creates "main", so just add "dev"
    await createBranch(packId, "dev", rootCommitId);
    const list = await listBranchesForPack(packId);
    expect(list.map((b) => b.name).sort()).toEqual(["dev", "main"]);
  });

  it("isAncestor walks parentId chain", async () => {
    const { packId, rootCommitId } = await seedSetup();
    const c2 = await createCommit({
      packId, parentId: rootCommitId, files: { "x": "1" }, editor: null,
      authorUserId: null, message: "c2",
    });
    const c3 = await createCommit({
      packId, parentId: c2.id, files: { "x": "2" }, editor: null,
      authorUserId: null, message: "c3",
    });
    expect(await isAncestor(rootCommitId, c3.id)).toBe(true);
    expect(await isAncestor(c2.id, c3.id)).toBe(true);
    expect(await isAncestor(c3.id, rootCommitId)).toBe(false);
    expect(await isAncestor(c3.id, c3.id)).toBe(true);  // identity
  });
});

describe("findLCA", () => {
  it("returns the same commit when a === b", async () => {
    const { packId, rootCommitId } = await seedSetup();
    expect(await findLCA(rootCommitId, rootCommitId)).toBe(rootCommitId);
  });

  it("returns A when A is an ancestor of B", async () => {
    const { packId, rootCommitId } = await seedSetup();
    const c2 = await createCommit({
      packId, parentId: rootCommitId, files: { "x": "1" }, editor: null,
      authorUserId: null, message: "c2",
    });
    expect(await findLCA(rootCommitId, c2.id)).toBe(rootCommitId);
  });

  it("returns B when B is an ancestor of A (symmetric)", async () => {
    const { packId, rootCommitId } = await seedSetup();
    const c2 = await createCommit({
      packId, parentId: rootCommitId, files: { "x": "1" }, editor: null,
      authorUserId: null, message: "c2",
    });
    expect(await findLCA(c2.id, rootCommitId)).toBe(rootCommitId);
  });

  it("returns the common base when two branches diverge", async () => {
    const { packId, rootCommitId } = await seedSetup();
    // dev branch commit
    const dev1 = await createCommit({
      packId, parentId: rootCommitId, files: { "dev": "1" }, editor: null,
      authorUserId: null, message: "dev1",
    });
    // main branch commit (sibling of dev1, both children of rootCommitId)
    const main1 = await createCommit({
      packId, parentId: rootCommitId, files: { "main": "1" }, editor: null,
      authorUserId: null, message: "main1",
    });
    expect(await findLCA(dev1.id, main1.id)).toBe(rootCommitId);
  });

  it("walks through parentId2 (merge commit ancestry)", async () => {
    const { packId, rootCommitId } = await seedSetup();
    const dev1 = await createCommit({
      packId, parentId: rootCommitId, files: { "dev": "1" }, editor: null,
      authorUserId: null, message: "dev1",
    });
    const main1 = await createCommit({
      packId, parentId: rootCommitId, files: { "main": "1" }, editor: null,
      authorUserId: null, message: "main1",
    });
    // Synthetic merge commit on main: parentId = main1, parentId2 = dev1
    await db.update(packCommits).set({ parentId: main1.id, parentId2: dev1.id })
      .where(eq(packCommits.id, main1.id));
    // (in real code, merge commit is a new commit; here we mutate main1 for brevity)
    // After this, dev1 is reachable from main1 via parentId2.
    // Add a new commit on dev to test cross-parent walk:
    const dev2 = await createCommit({
      packId, parentId: dev1.id, files: { "dev": "2" }, editor: null,
      authorUserId: null, message: "dev2",
    });
    // dev1 should be the LCA of main1 (via parentId2) and dev2 (via parentId chain)
    expect(await findLCA(main1.id, dev2.id)).toBe(dev1.id);
  });

  it("throws when no common ancestor (synthetic disconnected commits)", async () => {
    const { packId } = await seedSetup();
    // Orphan commit with no parent (different pack would make more sense but this is enough)
    const orphan1 = await createCommit({
      packId, parentId: null, files: { "o1": "" }, editor: null,
      authorUserId: null, message: "orphan1",
    });
    const orphan2 = await createCommit({
      packId, parentId: null, files: { "o2": "" }, editor: null,
      authorUserId: null, message: "orphan2",
    });
    // Both are roots — no common ancestor. Use try/catch (Bun rejects.toThrow + DB hangs).
    let thrown: Error | null = null;
    try {
      await findLCA(orphan1.id, orphan2.id);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toMatch(/no common ancestor/i);
  });
});
