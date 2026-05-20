import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { packs, networks } from "../db/schema";
import { createPack, getPack, upsertPackContent, softDeletePack, listPacksForNetwork } from "./packStorage";
import { createNetwork } from "./networkManager";

describe("packStorage", () => {
  let networkId: string;
  beforeEach(async () => {
    await db.delete(packs);
    await db.delete(networks);
    networkId = (await createNetwork("N")).id;
  });

  it("createPack inserts with default hash and files", async () => {
    const p = await createPack({ networkId, name: "main" });
    expect(p.id).toMatch(/^pack_/);
    expect(p.networkId).toBe(networkId);
    expect(p.hash).toBe("");
    expect(p.filesJson).toBe("{}");
  });

  it("getPack returns the row or null", async () => {
    const p = await createPack({ networkId, name: "main" });
    expect((await getPack(p.id))?.id).toBe(p.id);
    expect(await getPack("pack_nope")).toBeNull();
  });

  it("upsertPackContent updates hash + filesJson", async () => {
    const p = await createPack({ networkId, name: "main" });
    await upsertPackContent(p.id, { hash: "abc", filesJson: '{"a.yaml":"x"}', editorJson: '{"id":"main"}' });
    const updated = await getPack(p.id);
    expect(updated?.hash).toBe("abc");
    expect(updated?.filesJson).toBe('{"a.yaml":"x"}');
  });

  it("softDeletePack sets deletedAt", async () => {
    const p = await createPack({ networkId, name: "main" });
    await softDeletePack(p.id);
    expect((await getPack(p.id))?.deletedAt).toBeTruthy();
  });

  it("listPacksForNetwork filters by network + non-deleted", async () => {
    const p1 = await createPack({ networkId, name: "a" });
    const p2 = await createPack({ networkId, name: "b" });
    await softDeletePack(p2.id);
    const list = await listPacksForNetwork(networkId);
    expect(list.map((p) => p.id)).toEqual([p1.id]);
  });
});
