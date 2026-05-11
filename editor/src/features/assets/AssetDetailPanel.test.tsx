import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { useAssetStore } from "./assetStore";
import * as packApi from "@/lib/packApi";
import type { Asset } from "@/domain/asset";

vi.mock("@/state/sessionStore", () => ({
  useSessionStore: (sel: (s: { accessToken: string | null }) => unknown) =>
    sel({ accessToken: "tok_test" }),
}));

const A: Asset = {
  id: "asset_a", serverKeyId: "sk", type: "glyph", name: "icon",
  width: 8, height: 9, ascent: 7, codepoint: 0xE000, fontMeta: null,
  contentHash: "h", createdAt: "", updatedAt: "",
};

describe("AssetDetailPanel", () => {
  beforeEach(() => {
    useAssetStore.getState().reset();
    useAssetStore.getState().setAssets([A]);
    useAssetStore.getState().setSelectedId("asset_a");
  });

  it("shows the asset details", () => {
    render(<AssetDetailPanel />);
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe("icon");
    expect(screen.getByText(/codepoint/i)).toBeTruthy();
    expect(screen.getByText(/U\+E000/)).toBeTruthy();
  });

  it("renames the asset", async () => {
    vi.spyOn(packApi, "updateAsset").mockResolvedValue({ ...A, name: "icon2" });
    render(<AssetDetailPanel />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "icon2" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(useAssetStore.getState().assets[0].name).toBe("icon2"));
  });

  it("deletes the asset with confirmation", async () => {
    const spy = vi.spyOn(packApi, "deleteAsset").mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AssetDetailPanel />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("tok_test", "asset_a"));
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("renders nothing when no asset is selected", () => {
    useAssetStore.getState().setSelectedId(null);
    const { container } = render(<AssetDetailPanel />);
    expect(container.firstChild).toBeNull();
  });
});
