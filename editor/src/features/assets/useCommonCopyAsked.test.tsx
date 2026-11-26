import type { Asset } from "@/domain/asset";
import { useKitStore } from "@/state/kitStore";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetStore } from "./assetStore";
import { useResourcesView } from "./resourcesView";
import { useCommonCopyAsked } from "./useCommonCopyAsked";

vi.mock("@/lib/projectPrincipal", () => ({ useProjectPrincipalId: () => "u1" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const copyAsset = vi.fn();
vi.mock("@/lib/api/userAssets", () => ({
  copyAsset: (...args: unknown[]) => copyAsset(...args),
}));

const image = (projectId: string, name: string): Asset => ({
  id: name,
  projectId,
  type: "texture",
  name,
  width: 54,
  height: 18,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  contentHash: "h",
  createdAt: "",
  updatedAt: "",
});

describe("useCommonCopyAsked", () => {
  beforeEach(() => {
    copyAsset.mockReset();
    useAssetStore.getState().reset();
    useKitStore.setState({ read: { projectId: "kit", files: {}, binaries: [] }, themes: [] });
    useResourcesView.setState({ shared: null, sharedFrom: null });
  });

  it("copies the module's image into the common images' draft, once, and selects it", async () => {
    const source = image("shop", "banner");
    const copy = image("kit", "banner");
    copyAsset.mockResolvedValue({ asset: copy, outcome: "copied" });
    useResourcesView.getState().askShare(source, "shop");
    const { rerender } = renderHook(() => useCommonCopyAsked("kit" as never));
    await waitFor(() => expect(useAssetStore.getState().selectedId).toBe("banner"));
    rerender();
    expect(copyAsset).toHaveBeenCalledTimes(1);
    expect(copyAsset).toHaveBeenCalledWith("kit", source);
    expect(useAssetStore.getState().assets).toEqual([copy]);
    expect(useResourcesView.getState().shared).toBeNull();
  });

  it("waits for the common images to be read, and ends a request the copy refused", async () => {
    useAssetStore.getState().setLoading(true);
    useResourcesView.getState().askShare(image("shop", "banner"), "shop");
    renderHook(() => useCommonCopyAsked("kit" as never));
    expect(copyAsset).not.toHaveBeenCalled();
    copyAsset.mockRejectedValue(new Error("server_offline"));
    useAssetStore.getState().setLoading(false);
    await waitFor(() => expect(useResourcesView.getState().shared).toBeNull());
    expect(copyAsset).toHaveBeenCalledTimes(1);
    expect(useAssetStore.getState().selectedId).toBeNull();
  });

  it("is kept by the module it was made in, and dropped by any other", () => {
    const source = image("shop", "banner");
    useResourcesView.getState().askShare(source, "shop");
    const { unmount } = renderHook(() => useCommonCopyAsked("shop" as never));
    expect(useResourcesView.getState().shared).toBe(source);
    unmount();
    renderHook(() => useCommonCopyAsked("guilds" as never));
    expect(useResourcesView.getState().shared).toBeNull();
    expect(copyAsset).not.toHaveBeenCalled();
  });
});
