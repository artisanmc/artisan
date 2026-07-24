import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { projects, networks, projectBranches, projectCommits, serverKeys } from "../db/schema";
import { eq } from "drizzle-orm";
import { createProject, getProject, upsertProjectContent, softDeleteProject, listProjectsForNetwork } from "./projectStorage";
import { createNetwork } from "./networkManager";
import { getBranch } from "./branchStorage";
import { generateServerKey } from "./auth";

async function seedServerKey(networkId: string): Promise<string> {
  const { id, hash } = await generateServerKey();
  await db.insert(serverKeys).values({ id, hash, label: null, networkId, createdAt: new Date() });
  return id;
}

describe("projectStorage", () => {
  let networkId: string;
  let skId: string;
  beforeEach(async () => {
    await db.delete(projectBranches);
    await db.delete(projectCommits);
    await db.delete(projects);
    await db.delete(serverKeys);
    await db.delete(networks);
    networkId = (await createNetwork("N")).id;
    skId = await seedServerKey(networkId);
  });

  it("createProject inserts with default hash and files", async () => {
    const p = await createProject({ networkId, serverKeyId: skId, name: "main" });
    expect(p.id).toMatch(/^pack_/);
    expect(p.networkId).toBe(networkId);
    expect(p.hash).toBe("");
    expect(p.filesJson).toBe("{}");
  });

  it("createProject with an already-existing id returns the existing project instead of throwing", async () => {
    // Trouvé au smoke Docker 2026-07-09 : un setup/hello concurrent tentait de
    // re-créer boutique_shop → duplicate key non catché → crash du process.
    const first = await createProject({ networkId, serverKeyId: skId, name: "boutique_shop", id: "p_dup" });
    await upsertProjectContent("p_dup", { hash: "h1", filesJson: '{"a.yaml":"x"}' });
    const second = await createProject({ networkId, serverKeyId: skId, name: "boutique_shop", id: "p_dup" });
    expect(second.id).toBe(first.id);
    // L'existant n'est pas écrasé (le create perdant n'est pas un reset) :
    expect(second.hash).toBe("h1");
  });

  it("getProject returns the row or null", async () => {
    const p = await createProject({ networkId, serverKeyId: skId, name: "main" });
    expect((await getProject(p.id))?.id).toBe(p.id);
    expect(await getProject("pack_nope")).toBeNull();
  });

  it("upsertProjectContent updates hash + filesJson", async () => {
    const p = await createProject({ networkId, serverKeyId: skId, name: "main" });
    await upsertProjectContent(p.id, { hash: "abc", filesJson: '{"a.yaml":"x"}' });
    const updated = await getProject(p.id);
    expect(updated?.hash).toBe("abc");
    expect(updated?.filesJson).toBe('{"a.yaml":"x"}');
  });

  it("softDeleteProject sets deletedAt", async () => {
    const p = await createProject({ networkId, serverKeyId: skId, name: "main" });
    await softDeleteProject(p.id);
    expect((await getProject(p.id))?.deletedAt).toBeTruthy();
  });

  it("listProjectsForNetwork filters by network + non-deleted", async () => {
    const p1 = await createProject({ networkId, serverKeyId: skId, name: "a" });
    const p2 = await createProject({ networkId, serverKeyId: skId, name: "b" });
    await softDeleteProject(p2.id);
    const list = await listProjectsForNetwork(networkId);
    expect(list.map((p) => p.id)).toEqual([p1.id]);
  });

  it("createProject auto-creates main branch with initial commit", async () => {
    const project = await createProject({ networkId, serverKeyId: skId, name: "auto-branch" });
    const main = await getBranch(project.id, "main");
    expect(main).not.toBeNull();
    expect(main!.headCommitId).toMatch(/^cmt_/);
    const cmt = (await db.select().from(projectCommits).where(eq(projectCommits.id, main!.headCommitId)))[0];
    expect(cmt.parentId).toBeNull();
    expect(cmt.message).toBe("Initial commit");
  });
});
