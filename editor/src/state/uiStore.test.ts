import type { MenuId, ProjectId } from "@/domain/types";
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

describe("uiStore — applyLayerDeleted", () => {
  beforeEach(() => {
    useUiStore.setState({
      selectedLayerKey: null,
      hiddenLayerKeys: new Set<string>(),
    });
  });

  it("clears selectedLayerKey when the deleted layer was selected", () => {
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 1 });
    useUiStore.getState().applyLayerDeleted(MENU_A, 1);
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });

  it("decrements selectedLayerKey.index when a lower index was deleted", () => {
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 3 });
    useUiStore.getState().applyLayerDeleted(MENU_A, 1);
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_A, index: 2 });
  });

  it("leaves selectedLayerKey unchanged when the deleted index is above", () => {
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 1 });
    useUiStore.getState().applyLayerDeleted(MENU_A, 3);
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_A, index: 1 });
  });

  it("leaves selectedLayerKey unchanged when the deletion is in a different menu", () => {
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 1 });
    useUiStore.getState().applyLayerDeleted(MENU_B, 0);
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_A, index: 1 });
  });

  it("drops the hidden entry for the deleted index and shifts higher entries down", () => {
    useUiStore.getState().toggleHiddenLayer(MENU_A, 0); // stays
    useUiStore.getState().toggleHiddenLayer(MENU_A, 1); // dropped
    useUiStore.getState().toggleHiddenLayer(MENU_A, 2); // → 1
    useUiStore.getState().toggleHiddenLayer(MENU_A, 3); // → 2
    useUiStore.getState().toggleHiddenLayer(MENU_B, 1); // untouched (different menu)
    useUiStore.getState().applyLayerDeleted(MENU_A, 1);
    const keys = useUiStore.getState().hiddenLayerKeys;
    expect(keys.has(`${MENU_A}:0`)).toBe(true);
    expect(keys.has(`${MENU_A}:1`)).toBe(true); // was index 2
    expect(keys.has(`${MENU_A}:2`)).toBe(true); // was index 3
    expect(keys.has(`${MENU_A}:3`)).toBe(false); // shifted down
    expect(keys.has(`${MENU_B}:1`)).toBe(true);
  });
});

describe("uiStore — search flag", () => {
  beforeEach(() => {
    useUiStore.setState({ searchOpen: false });
  });

  it("searchOpen défaut false, set le modifie", () => {
    expect(useUiStore.getState().searchOpen).toBe(false);
    useUiStore.getState().setSearchOpen(true);
    expect(useUiStore.getState().searchOpen).toBe(true);
    useUiStore.getState().setSearchOpen(false);
    expect(useUiStore.getState().searchOpen).toBe(false);
  });
});

describe("uiStore — canvasMode", () => {
  it("setter bascule entre hand (défaut) et select", () => {
    useUiStore.getState().setCanvasMode("select");
    expect(useUiStore.getState().canvasMode).toBe("select");
    useUiStore.getState().setCanvasMode("hand");
    expect(useUiStore.getState().canvasMode).toBe("hand");
  });
});

describe("uiStore — canvasViewports", () => {
  beforeEach(() => useUiStore.setState({ canvasViewports: {} }));

  it("défaut vide", () => {
    expect(useUiStore.getState().canvasViewports).toEqual({});
  });

  it("setCanvasViewport stocke par project et roundtrip", () => {
    useUiStore.getState().setCanvasViewport("p1" as ProjectId, { x: 10, y: 20, scale: 2 });
    expect(useUiStore.getState().canvasViewports.p1).toEqual({ x: 10, y: 20, scale: 2 });
  });

  it("setCanvasViewport laisse les autres projects intacts", () => {
    useUiStore.getState().setCanvasViewport("p1" as ProjectId, { x: 1, y: 2, scale: 1 });
    useUiStore.getState().setCanvasViewport("p2" as ProjectId, { x: 3, y: 4, scale: 0.5 });
    expect(useUiStore.getState().canvasViewports.p1).toEqual({ x: 1, y: 2, scale: 1 });
    expect(useUiStore.getState().canvasViewports.p2).toEqual({ x: 3, y: 4, scale: 0.5 });
  });
});

describe("uiStore — applyLayerMoved", () => {
  beforeEach(() => {
    useUiStore.setState({
      selectedLayerKey: null,
      hiddenLayerKeys: new Set<string>(),
    });
  });

  it("remaps selectedLayerKey when the selected layer itself moves (from → to)", () => {
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 0 });
    useUiStore.getState().applyLayerMoved(MENU_A, 0, 2);
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_A, index: 2 });
  });

  it("remaps selectedLayerKey when an intermediate layer crosses it (downward shift)", () => {
    // move from 0 to 2: layers at indices 1 and 2 shift down to 0 and 1
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 1 });
    useUiStore.getState().applyLayerMoved(MENU_A, 0, 2);
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_A, index: 0 });
  });

  it("remaps selectedLayerKey when an intermediate layer crosses it (upward shift)", () => {
    // move from 3 to 1: layers at indices 1 and 2 shift up to 2 and 3
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 2 });
    useUiStore.getState().applyLayerMoved(MENU_A, 3, 1);
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_A, index: 3 });
  });

  it("leaves selectedLayerKey unchanged when the move doesn't touch it", () => {
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 0 });
    useUiStore.getState().applyLayerMoved(MENU_A, 2, 3);
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_A, index: 0 });
  });

  it("leaves selectedLayerKey unchanged when the move is in a different menu", () => {
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_A, index: 1 });
    useUiStore.getState().applyLayerMoved(MENU_B, 0, 2);
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_A, index: 1 });
  });

  it("remaps hiddenLayerKeys for the same menu using the same move semantics", () => {
    useUiStore.getState().toggleHiddenLayer(MENU_A, 0); // moving from 0 → 2 → ends at 2
    useUiStore.getState().toggleHiddenLayer(MENU_A, 1); // crossed by move, shifts down to 0
    useUiStore.getState().toggleHiddenLayer(MENU_A, 2); // crossed by move, shifts down to 1
    useUiStore.getState().toggleHiddenLayer(MENU_A, 3); // untouched
    useUiStore.getState().toggleHiddenLayer(MENU_B, 0); // untouched (different menu)
    useUiStore.getState().applyLayerMoved(MENU_A, 0, 2);
    const keys = useUiStore.getState().hiddenLayerKeys;
    expect(keys.has(`${MENU_A}:0`)).toBe(true); // was 1
    expect(keys.has(`${MENU_A}:1`)).toBe(true); // was 2
    expect(keys.has(`${MENU_A}:2`)).toBe(true); // was 0 (the moved one)
    expect(keys.has(`${MENU_A}:3`)).toBe(true); // unchanged
    expect(keys.has(`${MENU_B}:0`)).toBe(true);
    expect(keys.size).toBe(5);
  });
});
