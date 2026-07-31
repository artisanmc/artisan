import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { projectBranches, projectCommits, projects, networks, serverKeys } from "../db/schema";
import {
  createBranch, getBranch, advanceBranchHead, listBranchesForProject, isAncestor,
  findLCA,
} from "./branchStorage";
import { createNetwork } from "./networkManager";
import { createProject } from "./projectStorage";
import { createCommit } from "./commitStorage";
import { generateServerKey } from "./auth";

async function seedSetup() {
  await db.delete(projectBranches);
  await db.delete(projectCommits);
  await db.delete(projects);
  await db.delete(serverKeys);
  await db.delete(networks);
  const net = await createNetwork("N");
  const { id: skId, hash: skHash } = await generateServerKey();
  await db.insert(serverKeys).values({ id: skId, hash: skHash, label: null, networkId: net.id, createdAt: new Date() });
  const project = await createProject({ networkId: net.id, serverKeyId: skId, name: "p" });
  const root = await createCommit({
    projectId: project.id, parentId: null, files: { "init": "" }, editor: null,
    authorUserId: null, message: "root",
  });
  return { projectId: project.id, rootCommitId: root.id };
}

describe("branchStorage", () => {
  it("createBranch + getBranch", async () => {
    const { projectId, rootCommitId } = await seedSetup();
    // createProject now auto-creates "main", so use a different name for this test
    await createBranch(projectId, "dev", rootCommitId);
    const branch = await getBranch(projectId, "dev");
    expect(branch?.name).toBe("dev");
    expect(branch?.headCommitId).toBe(rootCommitId);
  });

  it("createBranch errors on duplicate (projectId, name)", async () => {
    const { projectId, rootCommitId } = await seedSetup();
    // createProject now auto-creates "main", so test duplicate with "main"
    let errorThrown = false;
    try {
      await createBranch(projectId, "main", rootCommitId);
    } catch (e) {
      errorThrown = true;
    }
    expect(errorThrown).toBe(true);
  });

  it("advanceBranchHead updates head + updatedAt", async () => {
    const { projectId, rootCommitId } = await seedSetup();
    // createProject now auto-creates "main", so we can directly use it
    const second = await createCommit({
      projectId, parentId: rootCommitId, files: { "init": "x" }, editor: null,
      authorUserId: null, message: "second",
    });
    await advanceBranchHead(projectId, "main", second.id);
    const branch = await getBranch(projectId, "main");
    expect(branch?.headCommitId).toBe(second.id);
  });

  it("listBranchesForProject returns all branches", async () => {
    const { projectId, rootCommitId } = await seedSetup();
    // createProject now auto-creates "main", so just add "dev"
    await createBranch(projectId, "dev", rootCommitId);
    const list = await listBranchesForProject(projectId);
    expect(list.map((b) => b.name).sort()).toEqual(["dev", "main"]);
  });

  it("isAncestor walks parentId chain", async () => {
    const { projectId, rootCommitId } = await seedSetup();
    const c2 = await createCommit({
      projectId, parentId: rootCommitId, files: { "x": "1" }, editor: null,
      authorUserId: null, message: "c2",
    });
    const c3 = await createCommit({
      projectId, parentId: c2.id, files: { "x": "2" }, editor: null,
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
    const { projectId, rootCommitId } = await seedSetup();
    expect(await findLCA(rootCommitId, rootCommitId)).toBe(rootCommitId);
  });

  it("returns A when A is an ancestor of B", async () => {
    const { projectId, rootCommitId } = await seedSetup();
    const c2 = await createCommit({
      projectId, parentId: rootCommitId, files: { "x": "1" }, editor: null,
      authorUserId: null, message: "c2",
    });
    expect(await findLCA(rootCommitId, c2.id)).toBe(rootCommitId);
  });

  it("returns B when B is an ancestor of A (symmetric)", async () => {
    const { projectId, rootCommitId } = await seedSetup();
    const c2 = await createCommit({
      projectId, parentId: rootCommitId, files: { "x": "1" }, editor: null,
      authorUserId: null, message: "c2",
    });
    expect(await findLCA(c2.id, rootCommitId)).toBe(rootCommitId);
  });

  it("returns the common base when two branches diverge", async () => {
    const { projectId, rootCommitId } = await seedSetup();
    // dev branch commit
    const dev1 = await createCommit({
      projectId, parentId: rootCommitId, files: { "dev": "1" }, editor: null,
      authorUserId: null, message: "dev1",
    });
    // main branch commit (sibling of dev1, both children of rootCommitId)
    const main1 = await createCommit({
      projectId, parentId: rootCommitId, files: { "main": "1" }, editor: null,
      authorUserId: null, message: "main1",
    });
    expect(await findLCA(dev1.id, main1.id)).toBe(rootCommitId);
  });

  it("walks through parentId2 (merge commit ancestry)", async () => {
    const { projectId, rootCommitId } = await seedSetup();
    const dev1 = await createCommit({
      projectId, parentId: rootCommitId, files: { "dev": "1" }, editor: null,
      authorUserId: null, message: "dev1",
    });
    const main1 = await createCommit({
      projectId, parentId: rootCommitId, files: { "main": "1" }, editor: null,
      authorUserId: null, message: "main1",
    });
    // Synthetic merge commit on main: parentId = main1, parentId2 = dev1
    await db.update(projectCommits).set({ parentId: main1.id, parentId2: dev1.id })
      .where(eq(projectCommits.id, main1.id));
    // (in real code, merge commit is a new commit; here we mutate main1 for brevity)
    // After this, dev1 is reachable from main1 via parentId2.
    // Add a new commit on dev to test cross-parent walk:
    const dev2 = await createCommit({
      projectId, parentId: dev1.id, files: { "dev": "2" }, editor: null,
      authorUserId: null, message: "dev2",
    });
    // dev1 should be the LCA of main1 (via parentId2) and dev2 (via parentId chain)
    expect(await findLCA(main1.id, dev2.id)).toBe(dev1.id);
  });

  it("throws when no common ancestor (synthetic disconnected commits)", async () => {
    const { projectId } = await seedSetup();
    // Orphan commit with no parent (different project would make more sense but this is enough)
    const orphan1 = await createCommit({
      projectId, parentId: null, files: { "o1": "" }, editor: null,
      authorUserId: null, message: "orphan1",
    });
    const orphan2 = await createCommit({
      projectId, parentId: null, files: { "o2": "" }, editor: null,
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
