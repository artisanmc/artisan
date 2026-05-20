import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { packBindings, packs, serverKeys, networks, editorSessions, linkCodes } from "../db/schema";
import {
  createBinding, deleteBinding, listPacksForServerKey, listServerKeysForPack,
} from "./packBindingManager";
import { createNetwork } from "./networkManager";
import { createPack } from "./packStorage";

describe("packBindingManager", () => {
  let networkId: string, skId: string;
  beforeEach(async () => {
    await db.delete(packBindings);
    await db.delete(packs);
    await db.delete(editorSessions);
    await db.delete(linkCodes);
    await db.delete(serverKeys);
    await db.delete(networks);
    networkId = (await createNetwork("N")).id;
    skId = "sk_" + crypto.randomUUID().slice(0, 8);
    await db.insert(serverKeys).values({
      id: skId, hash: "h", networkId, label: null, createdAt: new Date(),
    });
  });

  it("createBinding inserts a row", async () => {
    const pack = await createPack({ networkId, name: "main" });
    await createBinding(skId, pack.id);
    const rows = await db.select().from(packBindings);
    expect(rows).toHaveLength(1);
  });

  it("listPacksForServerKey returns bound non-deleted packs", async () => {
    const p1 = await createPack({ networkId, name: "a" });
    const p2 = await createPack({ networkId, name: "b" });
    await createBinding(skId, p1.id);
    await createBinding(skId, p2.id);
    const list = await listPacksForServerKey(skId);
    expect(list.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
  });

  it("listServerKeysForPack returns all bound server keys", async () => {
    const pack = await createPack({ networkId, name: "main" });
    await createBinding(skId, pack.id);
    const list = await listServerKeysForPack(pack.id);
    expect(list).toEqual([skId]);
  });

  it("deleteBinding removes the row", async () => {
    const pack = await createPack({ networkId, name: "main" });
    await createBinding(skId, pack.id);
    await deleteBinding(skId, pack.id);
    expect(await db.select().from(packBindings)).toHaveLength(0);
  });
});
