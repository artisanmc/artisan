import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "./selectionStore";

describe("selectionStore", () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it("set replaces the selection", () => {
    useSelectionStore.getState().set(["a", "b"]);
    expect([...useSelectionStore.getState().ids]).toEqual(["a", "b"]);
    useSelectionStore.getState().set(["c"]);
    expect([...useSelectionStore.getState().ids]).toEqual(["c"]);
  });

  it("add appends without dropping", () => {
    useSelectionStore.getState().set(["a"]);
    useSelectionStore.getState().add("b");
    expect([...useSelectionStore.getState().ids].sort()).toEqual(["a", "b"]);
  });

  it("toggle adds when missing, removes when present", () => {
    useSelectionStore.getState().toggle("a");
    expect(useSelectionStore.getState().ids.has("a")).toBe(true);
    useSelectionStore.getState().toggle("a");
    expect(useSelectionStore.getState().ids.has("a")).toBe(false);
  });

  it("clear empties the selection", () => {
    useSelectionStore.getState().set(["a", "b", "c"]);
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().ids.size).toBe(0);
  });
});
