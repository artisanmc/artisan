import type { Asset } from "@/domain/asset";
import { useKitStore } from "@/state/kitStore";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetStore } from "./assetStore";
import { useResourcesView } from "./resourcesView";
import { useKitPieceAsked } from "./useKitPieceAsked";

vi.mock("@/lib/projectPrincipal", () => ({ useProjectPrincipalId: () => "u1" }));
vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `/kit/${id}.png`,
  kitImageBytes: async () => new Uint8Array([1, 2, 3]),
}));
const uploadAsset = vi.fn();
vi.mock("@/lib/api/userAssets", () => ({
  uploadAsset: (...args: unknown[]) => uploadAsset(...args),
}));

const image = (name: string, width: number, height: number): Asset => ({
  id: name,
  projectId: "kit",
  type: "glyph",
  name,
  width,
  height,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  usages: ["button"],
  contentHash: "h",
  createdAt: "",
  updatedAt: "",
});

describe("useKitPieceAsked", () => {
  beforeEach(() => {
    uploadAsset.mockReset();
    useAssetStore.getState().reset();
    useKitStore.setState({ read: { projectId: "kit", files: {}, binaries: [] }, theme: undefined });
    useResourcesView.setState({ view: "files", studio: null, piece: null, pieceFrom: null });
  });

  it("opens the kit module's image of the piece asked for", () => {
    useAssetStore.getState().setAssets([image("button.3x1", 54, 18)]);
    useResourcesView.getState().askPiece("button.3x1");
    renderHook(() => useKitPieceAsked("kit"));
    expect(useResourcesView.getState().studio).toBe("button.3x1");
    expect(useResourcesView.getState().piece).toBeNull();
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it("copies Artisan's image first when the piece is not redrawn, once", async () => {
    uploadAsset.mockResolvedValue(image("close.1x1", 16, 16));
    useResourcesView.getState().askPiece("close.1x1");
    renderHook(() => useKitPieceAsked("kit"));
    await waitFor(() => expect(useResourcesView.getState().studio).toBe("close.1x1"));
    expect(uploadAsset).toHaveBeenCalledTimes(1);
    expect(uploadAsset.mock.calls[0]?.[1]).toMatchObject({ name: "close.1x1", type: "glyph" });
    expect(useResourcesView.getState().piece).toBeNull();
  });

  it("waits for the images to be read, and drops a request made to another module", () => {
    useAssetStore.getState().setLoading(true);
    useResourcesView.getState().askPiece("close.1x1");
    const { unmount } = renderHook(() => useKitPieceAsked("kit"));
    expect(uploadAsset).not.toHaveBeenCalled();
    expect(useResourcesView.getState().piece).toBe("close.1x1");
    unmount();
    renderHook(() => useKitPieceAsked("shop"));
    expect(useResourcesView.getState().piece).toBeNull();
  });

  it("leaves a request made in a module for the common images it then opens", () => {
    useAssetStore.getState().setAssets([image("blason", 32, 32)]);
    useResourcesView.getState().askPiece("blason", "shop");
    const { unmount } = renderHook(() => useKitPieceAsked("shop"));
    expect(useResourcesView.getState().piece).toBe("blason");
    unmount();
    // An image the server added: opened as it is, never copied from Artisan's.
    renderHook(() => useKitPieceAsked("kit"));
    expect(useResourcesView.getState().studio).toBe("blason");
    expect(useResourcesView.getState().piece).toBeNull();
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it("drops a request for an image the common images do not hold", () => {
    useResourcesView.getState().askPiece("ribbon", "shop");
    renderHook(() => useKitPieceAsked("kit"));
    expect(useResourcesView.getState().piece).toBeNull();
    expect(useResourcesView.getState().studio).toBeNull();
  });
});
