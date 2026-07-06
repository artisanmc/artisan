import { describe, it, expect, beforeEach } from "vitest";
import { useProjectVersionStore } from "./projectVersionStore";

describe("projectVersionStore", () => {
  beforeEach(() => {
    useProjectVersionStore.setState({ versions: {}, conflicts: {} });
  });

  it("setVersion records the loaded/saved version per project", () => {
    useProjectVersionStore.getState().setVersion("p1", 3);
    expect(useProjectVersionStore.getState().versions["p1"]).toBe(3);
  });

  it("markConflict flags the project; clearConflict removes it", () => {
    const s = useProjectVersionStore.getState();
    s.markConflict("p1");
    expect(useProjectVersionStore.getState().conflicts["p1"]).toBe(true);
    useProjectVersionStore.getState().clearConflict("p1");
    expect(useProjectVersionStore.getState().conflicts["p1"]).toBeUndefined();
  });
});
