import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { packs, networks, packBranches, packCommits, serverKeys } from "../db/schema";
import { eq } from "drizzle-orm";
import { createPack, getPack, upsertPackContent, softDeletePack, listPacksForNetwork } from "./packStorage";
import { createNetwork } from "./networkManager";
import { getBranch } from "./branchStorage";
import { generateServerKey } from "./auth";

async function seedServerKey(networkId: string): Promise<string> {
  const { id, hash } = await generateServerKey();
  await db.insert(serverKeys).values({ id, hash, label: null, networkId, createdAt: new Date() });
  return id;
}

describe("packStorage", () => {
  let networkId: string;
  let skId: string;
  beforeEach(async () => {
    await db.delete(packBranches);
    await db.delete(packCommits);
    await db.delete(packs);
    await db.delete(serverKeys);
    await db.delete(networks);
    networkId = (await createNetwork("N")).id;
    skId = await seedServerKey(networkId);
  });

  it("createPack inserts with default hash and files", async () => {
    const p = await createPack({ networkId, serverKeyId: skId, name: "main" });
    expect(p.id).toMatch(/^pack_/);
    expect(p.networkId).toBe(networkId);
    expect(p.hash).toBe("");
    expect(p.filesJson).toBe("{}");
  });

  it("getPack returns the row or null", async () => {
    const p = await createPack({ networkId, serverKeyId: skId, name: "main" });
    expect((await getPack(p.id))?.id).toBe(p.id);
    expect(await getPack("pack_nope")).toBeNull();
  });

  it("upsertPackContent updates hash + filesJson", async () => {
    const p = await createPack({ networkId, serverKeyId: skId, name: "main" });
    await upsertPackContent(p.id, { hash: "abc", filesJson: '{"a.yaml":"x"}', editorJson: '{"id":"main"}' });
    const updated = await getPack(p.id);
    expect(updated?.hash).toBe("abc");
    expect(updated?.filesJson).toBe('{"a.yaml":"x"}');
  });

  it("softDeletePack sets deletedAt", async () => {
    const p = await createPack({ networkId, serverKeyId: skId, name: "main" });
    await softDeletePack(p.id);
    expect((await getPack(p.id))?.deletedAt).toBeTruthy();
  });

  it("listPacksForNetwork filters by network + non-deleted", async () => {
    const p1 = await createPack({ networkId, serverKeyId: skId, name: "a" });
    const p2 = await createPack({ networkId, serverKeyId: skId, name: "b" });
    await softDeletePack(p2.id);
    const list = await listPacksForNetwork(networkId);
    expect(list.map((p) => p.id)).toEqual([p1.id]);
  });

  it("createPack auto-creates main branch with initial commit", async () => {
    const pack = await createPack({ networkId, serverKeyId: skId, name: "auto-branch" });
    const main = await getBranch(pack.id, "main");
    expect(main).not.toBeNull();
    expect(main!.headCommitId).toMatch(/^cmt_/);
    const cmt = (await db.select().from(packCommits).where(eq(packCommits.id, main!.headCommitId)))[0];
    expect(cmt.parentId).toBeNull();
    expect(cmt.message).toBe("Initial commit");
  });
});
