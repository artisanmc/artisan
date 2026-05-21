import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssetPicker } from "./AssetPicker";
import { useAssetStore } from "./assetStore";
import type { Asset } from "@/domain/asset";

const TEX: Asset = {
  id: "asset_t1", packId: "p1", type: "texture", name: "shop_bg",
  width: 256, height: 64, ascent: null, codepoint: null, fontMeta: null,
  contentHash: "h1", createdAt: "", updatedAt: "",
};
const GLYPH: Asset = {
  id: "asset_g1", packId: "p1", type: "glyph", name: "coin",
  width: 8, height: 9, ascent: 8, codepoint: 0xE000, fontMeta: null,
  contentHash: "h2", createdAt: "", updatedAt: "",
};

describe("AssetPicker", () => {
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
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "no_match" } });
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
    expect(screen.getByText(/no texture assets/i)).toBeTruthy();
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
      <AssetPicker
        open
        typeFilter={["texture", "glyph"]}
        onClose={() => {}}
        onPick={() => {}}
      />,
    );
    expect(screen.getByTitle("shop_bg")).toBeTruthy();
    expect(screen.getByTitle("coin")).toBeTruthy();
  });
});
