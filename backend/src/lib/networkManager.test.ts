import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { networks } from "../db/schema";
import { createNetwork, getNetworkById } from "./networkManager";

describe("networkManager", () => {
  beforeEach(async () => { await db.delete(networks); });

  it("createNetwork inserts a row with tier=free + returns id", async () => {
    const net = await createNetwork("My Network");
    expect(net.id).toMatch(/^net_/);
    expect(net.name).toBe("My Network");
    expect(net.tier).toBe("free");
    const rows = await db.select().from(networks);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(net.id);
  });

  it("getNetworkById returns the row or null", async () => {
    const net = await createNetwork("X");
    const found = await getNetworkById(net.id);
    expect(found?.name).toBe("X");
    const missing = await getNetworkById("net_nope");
    expect(missing).toBeNull();
  });
});
