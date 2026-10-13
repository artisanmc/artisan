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
describe("projectBaselineStore — l'identité ne change que si le contenu change", () => {
  beforeEach(() => {
    useProjectBaselineStore.setState({ baselines: {} } as never);
  });

  it("garde le même objet quand on repose un contenu identique", () => {
    const store = useProjectBaselineStore.getState();
    store.set("p1", { "menus/a.yaml": "x" });
    const first = store.get("p1");

    store.set("p1", { "menus/a.yaml": "x" });

    expect(useProjectBaselineStore.getState().get("p1")).toBe(first);
  });

  it("change d'objet dès qu'un contenu diffère", () => {
    const store = useProjectBaselineStore.getState();
    store.set("p1", { "menus/a.yaml": "x" });
    const first = store.get("p1");

    store.set("p1", { "menus/a.yaml": "modifié" });

    expect(useProjectBaselineStore.getState().get("p1")).not.toBe(first);
  });

  it("change d'objet quand un fichier apparaît ou disparaît", () => {
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
