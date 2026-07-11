import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { useAssetStore } from "./assetStore";
import * as userAssetsApi from "@/lib/api/userAssets";
import type { Asset } from "@/domain/asset";

let mockCurrentUser: { id: string } | null = { id: "u1" };

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: mockCurrentUser }),
}));

const A: Asset = {
  id: "asset_a", projectId: "p1", type: "glyph", name: "icon",
  width: 8, height: 9, ascent: 7, codepoint: 0xE000, fontMeta: null,
  contentHash: "h", createdAt: "", updatedAt: "",
};

describe("AssetDetailPanel", () => {
  beforeEach(() => {
    useAssetStore.getState().reset();
    useAssetStore.getState().setAssets([A]);
    useAssetStore.getState().setSelectedId("asset_a");
    mockCurrentUser = { id: "u1" };
    vi.restoreAllMocks();
  });

  it("shows the asset details", () => {
    render(<AssetDetailPanel projectId={"p1" as never} />);
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe("icon");
    expect(screen.getByText(/codepoint/i)).toBeTruthy();
    expect(screen.getByText(/U\+E000/)).toBeTruthy();
  });

  it("renames the asset", async () => {
    vi.spyOn(userAssetsApi, "patchAsset").mockResolvedValue({ ...A, name: "icon2" });
    render(<AssetDetailPanel projectId={"p1" as never} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "icon2" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(useAssetStore.getState().assets[0].name).toBe("icon2"));
  });

  it("deletes the asset with confirmation", async () => {
    const spy = vi.spyOn(userAssetsApi, "deleteAsset").mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetDetailPanel projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("p1", "asset_a"));
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("renders nothing when no asset is selected", () => {
    useAssetStore.getState().setSelectedId(null);
    const { container } = render(<AssetDetailPanel projectId={"p1" as never} />);
    expect(container.firstChild).toBeNull();
  });
});
