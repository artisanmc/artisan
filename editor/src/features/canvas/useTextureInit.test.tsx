import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchUserItems = vi.fn();
const fetchUserCustomItems = vi.fn();
vi.mock("@/lib/api/userProjects", () => ({
  fetchUserItems: (...a: unknown[]) => fetchUserItems(...a),
  fetchUserCustomItems: (...a: unknown[]) => fetchUserCustomItems(...a),
}));
const preloadModels = vi.fn();
const renderToCanvas = vi.fn();
vi.mock("@/lib/mcModelRenderer", () => ({
  preloadModels: (...a: unknown[]) => preloadModels(...a),
  renderToCanvas: (...a: unknown[]) => renderToCanvas(...a),
}));

import { useAuthStore } from "@/state/authStore";
import { useUiStore } from "@/state/uiStore";
import { useTextureStore } from "./textureStore";
import { useTextureInit } from "./useTextureInit";

const ITEMS = [{ id: "stone", label: "Stone" }];

beforeEach(() => {
  vi.clearAllMocks();
  renderToCanvas.mockResolvedValue(null);
  fetchUserItems.mockResolvedValue({ version: "1.21.4", items: ITEMS });
  fetchUserCustomItems.mockResolvedValue({ items: [], serverKeyId: null });
  useTextureStore.setState({ libraryItems: [], libraryError: false });
  useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } as never });
  useUiStore.setState({ lastActiveProjectId: "pack_open" as never });
});

describe("useTextureInit", () => {
  it("loads the library for the last active project by default", async () => {
    renderHook(() => useTextureInit());
    await waitFor(() => expect(fetchUserItems).toHaveBeenCalledWith("pack_open"));
    await waitFor(() => expect(useTextureStore.getState().libraryItems).toEqual(ITEMS));
  });

  // A Config screen edits a module-owned project without opening its canvas —
  // the item picker must still resolve items (ADR module-config-screens).
  it("loads the library for an explicitly passed project id", async () => {
    renderHook(() => useTextureInit("boutique_shop" as never));
    await waitFor(() => expect(fetchUserItems).toHaveBeenCalledWith("boutique_shop"));
    expect(fetchUserItems).not.toHaveBeenCalledWith("pack_open");
  });

  // The first fetch sometimes goes out with the URL slug (project not loaded
  // yet) and 404s: the "Library unavailable" banner must disappear as soon as
  // the next fetch, with the real id, succeeds.
  it("clears a stale library error once the fetch succeeds", async () => {
    useTextureStore.setState({ libraryError: true });
    renderHook(() => useTextureInit());
    await waitFor(() => expect(useTextureStore.getState().libraryItems).toEqual(ITEMS));
    expect(useTextureStore.getState().libraryError).toBe(false);
  });

  it("flags the library as unavailable when the fetch fails", async () => {
    fetchUserItems.mockRejectedValue(new Error("404"));
    renderHook(() => useTextureInit());
    await waitFor(() => expect(useTextureStore.getState().libraryError).toBe(true));
  });

  // The hub serves no model bundle: the catalog ships pre-rendered icons, and
  // custom items only have a name (placeholder).
  it("renders only vanilla items with a model, without any model bundle", async () => {
    fetchUserItems.mockResolvedValue({
      version: "1.21.4",
      items: [...ITEMS, { id: "chest", label: "Chest", model: "item/chest" }],
    });
    fetchUserCustomItems.mockResolvedValue({
      serverKeyId: "local",
      items: [{ id: "nexo:coin", label: "coin", category: "nexo", model: "nexo/coin" }],
    });
    renderHook(() => useTextureInit());
    await waitFor(() => expect(useTextureStore.getState().libraryBundleReady).toBe(true));
    expect(preloadModels).not.toHaveBeenCalled();
    expect(renderToCanvas).toHaveBeenCalledTimes(1);
    expect(renderToCanvas).toHaveBeenCalledWith("item/chest", "1.21.4", undefined);
  });

  it("does nothing without a project id", () => {
    useUiStore.setState({ lastActiveProjectId: null as never });
    renderHook(() => useTextureInit());
    expect(fetchUserItems).not.toHaveBeenCalled();
  });

  // Leaving a view and coming back (project page ⇄ Play tab) must not wipe the icons
  // already drawn and fetch them again.
  it("keeps the library when the same user and Project come back", async () => {
    const first = renderHook(() => useTextureInit("keep_me" as never));
    await waitFor(() => expect(useTextureStore.getState().libraryBundleReady).toBe(true));
    first.unmount();
    fetchUserItems.mockClear();
    renderHook(() => useTextureInit("keep_me" as never));
    expect(fetchUserItems).not.toHaveBeenCalled();
    expect(useTextureStore.getState().libraryItems).toEqual(ITEMS);
  });
});
