import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { appSettings } from "../db/schema";
import { getSetting, setSetting } from "./appSettings";

afterEach(async () => { await db.delete(appSettings).where(eq(appSettings.key, "k_test")); });

describe("appSettings", () => {
  it("returns null for an absent key", async () => { expect(await getSetting("k_test")).toBeNull(); });
  it("round-trips a JSON value", async () => {
    await setSetting("k_test", { a: 1, b: "x" }, null);
    expect(await getSetting("k_test")).toEqual({ a: 1, b: "x" });
  });
  it("upserts (overwrites) on the same key", async () => {
    // updatedBy is null here: app_settings.updated_by is an FK → users.id, so
    // arbitrary ids would violate the constraint. The upsert path is what we assert.
    await setSetting("k_test", { v: 1 }, null);
    await setSetting("k_test", { v: 2 }, null);
    expect(await getSetting("k_test")).toEqual({ v: 2 });
  });
});
