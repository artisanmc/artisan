import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchUserItems = vi.fn();
const fetchUserCustomItems = vi.fn();
vi.mock("@/lib/api/userProjects", () => ({
  fetchUserItems: (...a: unknown[]) => fetchUserItems(...a),
  fetchUserCustomItems: (...a: unknown[]) => fetchUserCustomItems(...a),
}));
vi.mock("@/lib/mcModelRenderer", () => ({
  preloadModels: vi.fn().mockResolvedValue(undefined),
  renderToCanvas: vi.fn().mockResolvedValue(null),
}));

import { useAuthStore } from "@/state/authStore";
import { useUiStore } from "@/state/uiStore";
import { useTextureStore } from "./textureStore";
import { useTextureInit } from "./useTextureInit";

const ITEMS = [{ id: "stone", label: "Stone" }];

beforeEach(() => {
  vi.clearAllMocks();
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

  // Le premier fetch part parfois avec le slug de l'URL (le project n'est pas
  // encore chargé) et 404 : la bannière « Bibliothèque indisponible » doit
  // disparaître dès que le fetch suivant, avec le vrai id, aboutit.
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

  it("does nothing without a project id", () => {
    useUiStore.setState({ lastActiveProjectId: null as never });
    renderHook(() => useTextureInit());
    expect(fetchUserItems).not.toHaveBeenCalled();
  });
});
