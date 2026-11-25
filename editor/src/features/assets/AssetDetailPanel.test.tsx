import type { Asset } from "@/domain/asset";
import * as userAssetsApi from "@/lib/api/userAssets";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { useKitStore } from "@/state/kitStore";
import { useAssetStore } from "./assetStore";

let mockCurrentUser: { id: string } | null = { id: "u1" };

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: mockCurrentUser }),
}));

vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `/kit/${id}.png`,
  kitImageBytes: async () => new Uint8Array([1, 2, 3]),
}));

const A: Asset = {
  id: "asset_a",
  projectId: "p1",
  type: "glyph",
  name: "icon",
  width: 8,
  height: 9,
  ascent: 7,
  codepoint: 0xe000,
  fontMeta: null,
  contentHash: "h",
  createdAt: "",
  updatedAt: "",
};

describe("AssetDetailPanel", () => {
  it("refreshes classification when the selected image gains another use elsewhere", async () => {
    const patch = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockResolvedValue({ ...A, name: "renamed", usages: ["menu"] });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    act(() => useAssetStore.getState().upsertAsset({ ...A, usages: ["menu"] }));
    expect(screen.getByRole("checkbox", { name: /^Images du menu$/ })).toBeChecked();
    fireEvent.change(screen.getByLabelText(/^Nom$/), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("p1", A.id, { name: "renamed" }));
  });
  beforeEach(() => {
    useAssetStore.getState().reset();
    useAssetStore.getState().setAssets([A]);
    useAssetStore.getState().setSelectedId("asset_a");
    mockCurrentUser = { id: "u1" };
    vi.restoreAllMocks();
  });

  it("shows the asset details", () => {
    render(<AssetDetailPanel projectId={"p1" as never} />);
    expect((screen.getByLabelText(/^Nom$/i) as HTMLInputElement).value).toBe("icon");
    expect(screen.getByText(/codepoint/i)).toBeTruthy();
    expect(screen.getByText(/U\+E000/)).toBeTruthy();
  });

  it("renames the asset", async () => {
    vi.spyOn(userAssetsApi, "patchAsset").mockResolvedValue({ ...A, name: "icon2" });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    fireEvent.change(screen.getByLabelText(/^Nom$/i), { target: { value: "icon2" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));
    await waitFor(() => expect(useAssetStore.getState().assets[0]!.name).toBe("icon2"));
  });

  it("deletes the asset with confirmation", async () => {
    const spy = vi.spyOn(userAssetsApi, "deleteAsset").mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetDetailPanel projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Supprimer du module/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("p1", "asset_a"));
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("reports a common image that is not at its piece's size, in the common images' Project", () => {
    useKitStore.setState({ read: { projectId: "p1", files: {}, binaries: [], byName: true } });
    const piece = { ...A, id: "button.3x1", name: "button.3x1", type: "texture" as const };
    useAssetStore.getState().setAssets([{ ...piece, width: 60, height: 18 }]);
    useAssetStore.getState().setSelectedId("button.3x1");
    const { unmount } = render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(screen.getByTestId("asset-misfit")).toHaveTextContent(
      "Cette image fait 60 × 18 px, la pièce 54 × 18 px",
    );
    // Artisan's original shows beside it, and deleting the image is restoring the original.
    expect(screen.getByTestId("common-image-original")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restaurer l'original" })).toBeInTheDocument();
    unmount();
    // At the piece's size it is taken; in any other module the name is an image like another.
    useAssetStore.getState().setAssets([{ ...piece, width: 54, height: 18 }]);
    render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(screen.queryByTestId("asset-misfit")).toBeNull();
    act(() => {
      useKitStore.setState({ read: undefined });
      useAssetStore.getState().setAssets([{ ...piece, width: 60, height: 18 }]);
    });
    expect(screen.getByText("60×18")).toBeInTheDocument();
    expect(screen.queryByTestId("asset-misfit")).toBeNull();
    expect(screen.queryByTestId("common-image-original")).toBeNull();
    expect(screen.getByRole("button", { name: "Supprimer du module" })).toBeInTheDocument();
  });

  it("renders nothing when no asset is selected", () => {
    useAssetStore.getState().setSelectedId(null);
    const { container } = render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(container.firstChild).toBeNull();
  });
  it("classifies one image for both buttons and backgrounds", async () => {
    const patch = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockResolvedValue({ ...A, usages: ["button", "menu"] });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Images de boutons/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Images du menu$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("p1", "asset_a", { usages: ["button", "menu"] }),
    );
  });
});
