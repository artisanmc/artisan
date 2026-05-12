import type { MenuId } from "@/domain/types";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./uiStore";

const MENU_A = "m_a" as MenuId;
const MENU_B = "m_b" as MenuId;

describe("uiStore — v3 title composer fields", () => {
  beforeEach(() => {
    useUiStore.setState({
      selectedLayerKey: null,
      hiddenLayerKeys: new Set<string>(),
      draggingNewLayer: null,
      lastSelectedMenuId: null,
      selectedMenuId: null,
    });
  });

  it("has the expected initial values for the new fields", () => {
    const s = useUiStore.getState();
    expect(s.selectedLayerKey).toBeNull();
    expect(s.hiddenLayerKeys).toBeInstanceOf(Set);
    expect(s.hiddenLayerKeys.size).toBe(0);
    expect(s.draggingNewLayer).toBeNull();
    expect(s.lastSelectedMenuId).toBeNull();
  });

  it("setSelectedLayerKey roundtrip", () => {
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 2 });
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_A, index: 2 });
    useUiStore.getState().setSelectedLayerKey(null);
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });

  it("toggleHiddenLayer adds when missing and removes when present", () => {
    useUiStore.getState().toggleHiddenLayer(MENU_A, 0);
    expect(useUiStore.getState().hiddenLayerKeys.has(`${MENU_A}:0`)).toBe(true);
    useUiStore.getState().toggleHiddenLayer(MENU_A, 0);
    expect(useUiStore.getState().hiddenLayerKeys.has(`${MENU_A}:0`)).toBe(false);
  });

  it("toggleHiddenLayer scopes keys per (menuId, index)", () => {
    useUiStore.getState().toggleHiddenLayer(MENU_A, 0);
    useUiStore.getState().toggleHiddenLayer(MENU_A, 1);
    useUiStore.getState().toggleHiddenLayer(MENU_B, 0);
    const keys = useUiStore.getState().hiddenLayerKeys;
    expect(keys.size).toBe(3);
    expect(keys.has(`${MENU_A}:0`)).toBe(true);
    expect(keys.has(`${MENU_A}:1`)).toBe(true);
    expect(keys.has(`${MENU_B}:0`)).toBe(true);
  });

  it("clearHiddenLayers empties the Set", () => {
    useUiStore.getState().toggleHiddenLayer(MENU_A, 0);
    useUiStore.getState().toggleHiddenLayer(MENU_A, 1);
    useUiStore.getState().clearHiddenLayers();
    expect(useUiStore.getState().hiddenLayerKeys.size).toBe(0);
  });

  it("setDraggingNewLayer roundtrip", () => {
    useUiStore.getState().setDraggingNewLayer({ kind: "image", x: 10, y: 20 });
    expect(useUiStore.getState().draggingNewLayer).toEqual({ kind: "image", x: 10, y: 20 });
    useUiStore.getState().setDraggingNewLayer({ kind: "text", x: 5, y: 6 });
    expect(useUiStore.getState().draggingNewLayer).toEqual({ kind: "text", x: 5, y: 6 });
    useUiStore.getState().setDraggingNewLayer(null);
    expect(useUiStore.getState().draggingNewLayer).toBeNull();
  });

  it("setLastSelectedMenuId roundtrip", () => {
    useUiStore.getState().setLastSelectedMenuId(MENU_A);
    expect(useUiStore.getState().lastSelectedMenuId).toBe(MENU_A);
    useUiStore.getState().setLastSelectedMenuId(null);
    expect(useUiStore.getState().lastSelectedMenuId).toBeNull();
  });

  it("setSelectedMenuId updates lastSelectedMenuId when value is non-null", () => {
    useUiStore.getState().setSelectedMenuId(MENU_A);
    expect(useUiStore.getState().selectedMenuId).toBe(MENU_A);
    expect(useUiStore.getState().lastSelectedMenuId).toBe(MENU_A);
  });

  it("setSelectedMenuId(null) preserves lastSelectedMenuId (sticky reference)", () => {
    useUiStore.getState().setSelectedMenuId(MENU_A);
    useUiStore.getState().setSelectedMenuId(null);
    expect(useUiStore.getState().selectedMenuId).toBeNull();
    expect(useUiStore.getState().lastSelectedMenuId).toBe(MENU_A);
  });

  it("setSelectedMenuId from one menu to another updates lastSelectedMenuId", () => {
    useUiStore.getState().setSelectedMenuId(MENU_A);
    useUiStore.getState().setSelectedMenuId(MENU_B);
    expect(useUiStore.getState().selectedMenuId).toBe(MENU_B);
    expect(useUiStore.getState().lastSelectedMenuId).toBe(MENU_B);
  });
});
