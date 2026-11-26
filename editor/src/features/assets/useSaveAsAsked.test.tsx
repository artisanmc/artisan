import type { Asset } from "@/domain/asset";
import { useKitStore } from "@/state/kitStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetStore } from "./assetStore";
import { type SaveAsRequest, useResourcesView } from "./resourcesView";
import { useSaveAsAsked } from "./useSaveAsAsked";

vi.mock("@/lib/projectPrincipal", () => ({ useProjectPrincipalId: () => "u1" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const uploadAsset = vi.fn();
vi.mock("@/lib/api/userAssets", () => ({
  uploadAsset: (...args: unknown[]) => uploadAsset(...args),
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
const request = (name: string, target: string, from = "shop"): SaveAsRequest => ({
  png: new Uint8Array([1, 2, 3]),
  type: "texture",
  name,
  target,
  from,
});
const kitRead = (projectId: string) => ({ projectId, files: {}, binaries: [] });

describe("useSaveAsAsked", () => {
  beforeEach(() => {
    uploadAsset.mockReset();
    useAssetStore.getState().reset();
    useKitStore.setState({ read: kitRead("kit"), own: {}, themes: [] });
    useResourcesView.setState({ saveAs: null, studio: null });
  });

  it("writes the image in the place's draft, once, and opens it in the atelier", async () => {
    uploadAsset.mockResolvedValue(image("guilds", "banner"));
    useResourcesView.getState().askSaveAs(request("banner", "guilds"));
    const { rerender } = renderHook(() => useSaveAsAsked("guilds" as never));
    await waitFor(() => expect(useResourcesView.getState().studio).toBe("banner"));
    rerender();
    expect(uploadAsset).toHaveBeenCalledTimes(1);
    expect(uploadAsset.mock.calls[0]?.[0]).toBe("guilds");
    expect(uploadAsset.mock.calls[0]?.[1]).toMatchObject({ type: "texture", name: "banner" });
    expect(useAssetStore.getState().selectedId).toBe("banner");
    await waitFor(() => expect(useResourcesView.getState().saveAs).toBeNull());
  });

  it("replaces the image the place already has under that name", async () => {
    uploadAsset
      .mockRejectedValueOnce(Object.assign(new Error("Asset name already exists"), { status: 409 }))
      .mockResolvedValueOnce(image("guilds", "banner"));
    useResourcesView.getState().askSaveAs(request("banner", "guilds"));
    renderHook(() => useSaveAsAsked("guilds" as never));
    await waitFor(() => expect(useResourcesView.getState().studio).toBe("banner"));
    expect(uploadAsset).toHaveBeenCalledTimes(2);
    expect(uploadAsset.mock.calls[1]?.[1]).toMatchObject({ name: "banner", replace: true });
  });

  it("waits for a theme just created to be read before writing a name of the base in it", async () => {
    uploadAsset.mockResolvedValue(image("t-noel", "button.3x1"));
    useResourcesView.getState().askSaveAs(request("button.3x1", "t-noel"));
    renderHook(() => useSaveAsAsked("t-noel" as never));
    expect(uploadAsset).not.toHaveBeenCalled();
    act(() => useKitStore.setState({ own: { noel: kitRead("t-noel") } }));
    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1));
  });

  it("is kept by the Project it was asked in, dropped by any other, and ended by a refusal", async () => {
    useResourcesView.getState().askSaveAs(request("banner", "guilds"));
    const from = renderHook(() => useSaveAsAsked("shop" as never));
    expect(useResourcesView.getState().saveAs).not.toBeNull();
    from.unmount();
    renderHook(() => useSaveAsAsked("other" as never));
    expect(useResourcesView.getState().saveAs).toBeNull();

    uploadAsset.mockRejectedValue(new Error("server_offline"));
    useResourcesView.getState().askSaveAs(request("banner", "guilds"));
    renderHook(() => useSaveAsAsked("guilds" as never));
    await waitFor(() => expect(useResourcesView.getState().saveAs).toBeNull());
    expect(useResourcesView.getState().studio).toBeNull();
  });
});
