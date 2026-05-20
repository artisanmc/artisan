import { describe, expect, it, beforeEach } from "vitest";
import { useConflictsStore } from "./conflictsStore";

describe("conflictsStore", () => {
  beforeEach(() => {
    useConflictsStore.setState({ conflicts: [] });
  });

  it("hydrates from list", () => {
    useConflictsStore.getState().setConflicts([
      { id: "c1", packId: "p1", detectedAt: "2026-05-20T10:00:00Z", diskHash: "d", backendHashAtDetection: "b", fileCount: 2, diff: { addedOnDisk: [], removedOnDisk: [], modifiedOnDisk: [] } },
    ]);
    expect(useConflictsStore.getState().conflicts.length).toBe(1);
  });

  it("upsert adds new conflict", () => {
    useConflictsStore.getState().upsert({ id: "c1", packId: "p1", detectedAt: "t" } as any);
    expect(useConflictsStore.getState().conflicts.find((c) => c.id === "c1")).toBeDefined();
  });

  it("upsert replaces existing conflict by id", () => {
    useConflictsStore.getState().upsert({ id: "c1", packId: "p1", detectedAt: "t1" } as any);
    useConflictsStore.getState().upsert({ id: "c1", packId: "p1", detectedAt: "t2" } as any);
    const all = useConflictsStore.getState().conflicts.filter((c) => c.id === "c1");
    expect(all.length).toBe(1);
    expect(all[0].detectedAt).toBe("t2");
  });

  it("remove by id", () => {
    useConflictsStore.getState().setConflicts([
      { id: "c1" } as any,
      { id: "c2" } as any,
    ]);
    useConflictsStore.getState().remove("c1");
    expect(useConflictsStore.getState().conflicts.map((c) => c.id)).toEqual(["c2"]);
  });

  it("getByPackId returns the open conflict for a pack", () => {
    useConflictsStore.getState().setConflicts([
      { id: "c1", packId: "p1" } as any,
      { id: "c2", packId: "p2" } as any,
    ]);
    expect(useConflictsStore.getState().getByPackId("p1")?.id).toBe("c1");
    expect(useConflictsStore.getState().getByPackId("nope")).toBeUndefined();
  });
});
