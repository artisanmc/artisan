import { beforeEach, describe, expect, it } from "vitest";
import { isElementSelected, useSelectionStore } from "./selectionStore";

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

  it("toggleElement adds items of one menu without ever keeping the menu itself", () => {
    useSelectionStore.getState().set(["shop"]);
    useSelectionStore.getState().toggleElement("a", "shop");
    expect([...useSelectionStore.getState().ids]).toEqual(["a"]);
    useSelectionStore.getState().toggleElement("b", "shop");
    expect([...useSelectionStore.getState().ids]).toEqual(["a", "b"]);
    expect(useSelectionStore.getState().menuId).toBe("shop");
    useSelectionStore.getState().toggleElement("a", "shop");
    expect([...useSelectionStore.getState().ids]).toEqual(["b"]);
  });

  it("toggleElement restarts the selection when the item lives in another menu", () => {
    useSelectionStore.getState().set(["a"], 0, "shop");
    useSelectionStore.getState().toggleElement("x", "bank");
    expect([...useSelectionStore.getState().ids]).toEqual(["x"]);
    expect(useSelectionStore.getState().menuId).toBe("bank");
  });

  it("clear empties the selection", () => {
    useSelectionStore.getState().set(["a", "b", "c"]);
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().ids.size).toBe(0);
  });

  it("set records the owning menu; add/toggle/clear drop it", () => {
    useSelectionStore.getState().set(["grid"], 4, "shop_category");
    expect(useSelectionStore.getState().menuId).toBe("shop_category");
    useSelectionStore.getState().add("other");
    expect(useSelectionStore.getState().menuId).toBeNull();
    useSelectionStore.getState().set(["grid"], null, "shop_main");
    useSelectionStore.getState().toggle("grid");
    expect(useSelectionStore.getState().menuId).toBeNull();
    useSelectionStore.getState().set(["grid"], null, "shop_main");
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().menuId).toBeNull();
  });
});

describe("isElementSelected", () => {
  const ids = new Set(["grid"]);

  it("scopes a shared element id to the owning menu", () => {
    // 'grid' exists in both menus but was selected in shop_category.
    expect(isElementSelected(ids, "shop_category", "grid", "shop_category")).toBe(true);
    expect(isElementSelected(ids, "shop_category", "grid", "shop_main")).toBe(false);
  });

  it("falls back to bare-id matching when no menu scope is set", () => {
    expect(isElementSelected(ids, null, "grid", "shop_main")).toBe(true);
    expect(isElementSelected(ids, null, "grid", "shop_category")).toBe(true);
  });

  it("returns false when the id isn't selected at all", () => {
    expect(isElementSelected(ids, "shop_main", "back", "shop_main")).toBe(false);
  });
});
