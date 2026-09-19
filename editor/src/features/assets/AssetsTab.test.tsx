import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssetsTab } from "./AssetsTab";
import { useAssetStore } from "./assetStore";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({ index: i, start: i * estimateSize(), size: estimateSize() })),
  }),
}));

const A1 = {
  id: "asset_1", projectId: "p1", type: "texture" as const, name: "bg_one",
  width: 16, height: 16, ascent: null, codepoint: null, fontMeta: null,
  contentHash: "h1", createdAt: "", updatedAt: "",
};
const A2 = {
  id: "asset_2", projectId: "p1", type: "glyph" as const, name: "ico_one",
  width: 8, height: 9, ascent: 7, codepoint: 0xE000, fontMeta: null,
  contentHash: "h2", createdAt: "", updatedAt: "",
};

describe("AssetsTab", () => {
  beforeEach(() => {
    // AssetsTab no longer fetches itself — the assets are loaded by
    // `useAssetInit` mounted on EditorPane. Tests seed the store directly.
    useAssetStore.getState().reset();
    useAssetStore.getState().setAssets([A1, A2]);
  });

  it("renders the assets from the store", () => {
    render(<AssetsTab />);
    expect(screen.getByTitle("bg_one")).toBeTruthy();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });

  it("opens the upload dialog when clicking Upload", () => {
    useAssetStore.getState().setAssets([]);
    render(<AssetsTab />);
    fireEvent.click(screen.getByRole("button", { name: /^upload$/i }));
    expect(screen.getByText(/importer une image/i)).toBeTruthy();
  });

  it("filters by search query (case-insensitive)", () => {
    render(<AssetsTab />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "ico" } });
    expect(screen.queryByTitle("bg_one")).toBeNull();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });

  it("filters by type chip", () => {
    render(<AssetsTab />);
    fireEvent.click(screen.getByRole("button", { name: /^glyph$/i }));
    expect(screen.queryByTitle("bg_one")).toBeNull();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });
});
