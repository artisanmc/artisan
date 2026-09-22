import * as userAssetsApi from "@/lib/api/userAssets";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));
import type { Asset } from "@/domain/asset";
import { AssetPicker } from "./AssetPicker";
import { useAssetStore } from "./assetStore";

const TEX: Asset = {
  id: "asset_t1",
  projectId: "p1",
  type: "texture",
  name: "shop_bg",
  width: 256,
  height: 64,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  contentHash: "h1",
  createdAt: "",
  updatedAt: "",
};
const GLYPH: Asset = {
  id: "asset_g1",
  projectId: "p1",
  type: "glyph",
  name: "coin",
  width: 8,
  height: 9,
  ascent: 8,
  codepoint: 0xe000,
  fontMeta: null,
  contentHash: "h2",
  createdAt: "",
  updatedAt: "",
};

describe("AssetPicker", () => {
  it("does not place an image after closing during classification", async () => {
    let finish!: (asset: Asset) => void;
    vi.spyOn(userAssetsApi, "patchAsset").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onPick = vi.fn();
    const { rerender } = render(
      <AssetPicker
        projectId={"p1" as never}
        usage="button"
        open
        onClose={() => {}}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Afficher toutes les images/ }));
    fireEvent.click(screen.getByTitle("shop_bg"));
    rerender(
      <AssetPicker
        projectId={"p1" as never}
        usage="button"
        open={false}
        onClose={() => {}}
        onPick={onPick}
      />,
    );
    await act(async () => finish({ ...TEX, usages: ["button"] }));
    expect(onPick).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    useAssetStore.getState().reset();
    useAssetStore.getState().setAssets([TEX, GLYPH]);
  });

  it("renders only assets matching typeFilter", () => {
    render(<AssetPicker open typeFilter="texture" onClose={() => {}} onPick={() => {}} />);
    expect(screen.getByTitle("shop_bg")).toBeTruthy();
    expect(screen.queryByTitle("coin")).toBeNull();
  });

  it("filters by search query", () => {
    render(<AssetPicker open typeFilter="glyph" onClose={() => {}} onPick={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Rechercher/i), { target: { value: "no_match" } });
    expect(screen.queryByTitle("coin")).toBeNull();
  });

  it("calls onPick and onClose when a tile is clicked", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<AssetPicker open typeFilter="glyph" onClose={onClose} onPick={onPick} />);
    fireEvent.click(screen.getByTitle("coin"));
    expect(onPick).toHaveBeenCalledWith(GLYPH);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an empty-state message when no matches", () => {
    useAssetStore.getState().setAssets([]);
    render(<AssetPicker open typeFilter="texture" onClose={() => {}} onPick={() => {}} />);
    expect(screen.getByText(/Aucune ressource/i)).toBeTruthy();
  });

  it("without typeFilter shows every image asset (texture + glyph)", () => {
    render(<AssetPicker open onClose={() => {}} onPick={() => {}} />);
    // Both kinds appear — the upload UX no longer distinguishes them so the
    // picker shouldn't either.
    expect(screen.getByTitle("shop_bg")).toBeTruthy();
    expect(screen.getByTitle("coin")).toBeTruthy();
  });

  it("accepts an array of types and shows all matching ones", () => {
    render(
      <AssetPicker open typeFilter={["texture", "glyph"]} onClose={() => {}} onPick={() => {}} />,
    );
    expect(screen.getByTitle("shop_bg")).toBeTruthy();
    expect(screen.getByTitle("coin")).toBeTruthy();
  });

  it("without a projectId offers no upload", () => {
    render(<AssetPicker open onClose={() => {}} onPick={() => {}} />);
    expect(screen.queryByRole("button", { name: /importer/i })).toBeNull();
  });

  it("uploads a new image from the picker and picks it", async () => {
    const uploaded: Asset = { ...GLYPH, id: "gem", name: "gem", codepoint: 0xe001 };
    vi.spyOn(userAssetsApi, "uploadAsset").mockResolvedValue(uploaded);
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<AssetPicker projectId={"p1" as never} open onClose={onClose} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /importer/i }));
    const file = new File([new Uint8Array([1])], "gem.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/fichier/i), { target: { files: [file] } });
    fireEvent.click(screen.getAllByRole("button", { name: /^importer$/i }).at(-1)!);
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(uploaded));
    expect(onClose).toHaveBeenCalled();
  });
  it("offers other images explicitly and adds the contextual use without duplicating the file", async () => {
    useAssetStore.getState().setAssets([
      { ...TEX, usages: ["menu"] },
      { ...GLYPH, usages: ["button"] },
    ]);
    const patch = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockResolvedValue({ ...TEX, usages: ["menu", "button"] });
    const onPick = vi.fn();
    render(
      <AssetPicker
        projectId={"p1" as never}
        usage="button"
        open
        onClose={() => {}}
        onPick={onPick}
      />,
    );
    expect(screen.queryByTitle("shop_bg")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Afficher toutes les images/ }));
    fireEvent.click(screen.getByTitle("shop_bg"));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("p1", TEX.id, { usages: ["menu", "button"] }),
    );
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: TEX.id }));
  });
  it("keeps the picker open when persisting a new use fails", async () => {
    vi.spyOn(userAssetsApi, "patchAsset").mockRejectedValue(new Error("Could not save role"));
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <AssetPicker
        projectId={"p1" as never}
        usage="button"
        open
        onClose={onClose}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Afficher toutes les images/ }));
    fireEvent.click(screen.getByTitle("shop_bg"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save role"));
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
