import { beforeEach, describe, expect, it } from "vitest";
import { useProjectBaselineStore } from "./projectBaselineStore";

/**
 * The base serves as the "which load does this draft date from?" marker, and
 * that marker is read by object IDENTITY (`useDraftSync`). Setting a base with
 * identical content but a new object therefore looked like a new load — and
 * the sync then froze `initialTree` on the current tree, declaring the draft
 * CLEAN while it held work. On the next reload, that work was thrown away.
 *
 * It became systematic when revalidation started setting the base on every
 * visit: a rare case became the common case.
 */
describe("projectBaselineStore — the identity changes only when the content changes", () => {
  beforeEach(() => {
    useProjectBaselineStore.setState({ baselines: {} } as never);
  });

  it("keeps the same object when an identical content is set again", () => {
    const store = useProjectBaselineStore.getState();
    store.set("p1", { "menus/a.yaml": "x" });
    const first = store.get("p1");

    store.set("p1", { "menus/a.yaml": "x" });

    expect(useProjectBaselineStore.getState().get("p1")).toBe(first);
  });

  it("changes object as soon as a content differs", () => {
    const store = useProjectBaselineStore.getState();
    store.set("p1", { "menus/a.yaml": "x" });
    const first = store.get("p1");

    store.set("p1", { "menus/a.yaml": "modifié" });

    expect(useProjectBaselineStore.getState().get("p1")).not.toBe(first);
  });

  it("changes object when a file appears or disappears", () => {
    const store = useProjectBaselineStore.getState();
    store.set("p1", { "menus/a.yaml": "x" });
    const first = store.get("p1");

    store.set("p1", { "menus/a.yaml": "x", "menus/b.yaml": "y" });
    expect(useProjectBaselineStore.getState().get("p1")).not.toBe(first);

    const second = useProjectBaselineStore.getState().get("p1");
    store.set("p1", { "menus/a.yaml": "x" });
    expect(useProjectBaselineStore.getState().get("p1")).not.toBe(second);
  });
});
