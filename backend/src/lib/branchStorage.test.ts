import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { packBranches, packCommits, packs, networks } from "../db/schema";
import {
  createBranch, getBranch, advanceBranchHead, listBranchesForPack, isAncestor,
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
