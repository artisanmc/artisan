import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssetsTab } from "./AssetsTab";
import { useAssetStore } from "./assetStore";
import * as packApi from "@/lib/packApi";

vi.mock("@/state/sessionStore", () => ({
  useSessionStore: (sel: (s: { accessToken: string | null }) => unknown) =>
    sel({ accessToken: "tok_test" }),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({ index: i, start: i * estimateSize(), size: estimateSize() })),
  }),
}));

const A1 = {
  id: "asset_1", serverKeyId: "sk", type: "texture" as const, name: "bg_one",
  width: 16, height: 16, ascent: null, codepoint: null, fontMeta: null,
  contentHash: "h1", createdAt: "", updatedAt: "",
};
const A2 = {
  id: "asset_2", serverKeyId: "sk", type: "glyph" as const, name: "ico_one",
  width: 8, height: 9, ascent: 7, codepoint: 0xE000, fontMeta: null,
  contentHash: "h2", createdAt: "", updatedAt: "",
};

describe("AssetsTab", () => {
  beforeEach(() => useAssetStore.getState().reset());

  it("loads assets on mount", async () => {
    vi.spyOn(packApi, "listAssets").mockResolvedValue([A1, A2]);
    render(<AssetsTab />);
    await waitFor(() => expect(screen.getByTitle("bg_one")).toBeTruthy());
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });

  it("opens the upload dialog when clicking Upload", async () => {
    vi.spyOn(packApi, "listAssets").mockResolvedValue([]);
    render(<AssetsTab />);
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));
    expect(screen.getByText(/upload asset/i)).toBeTruthy();
  });

  it("filters by search query (case-insensitive)", async () => {
    vi.spyOn(packApi, "listAssets").mockResolvedValue([A1, A2]);
    render(<AssetsTab />);
    await waitFor(() => expect(screen.getByTitle("bg_one")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "ico" } });
    expect(screen.queryByTitle("bg_one")).toBeNull();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });

  it("filters by type chip", async () => {
    vi.spyOn(packApi, "listAssets").mockResolvedValue([A1, A2]);
    render(<AssetsTab />);
    await waitFor(() => expect(screen.getByTitle("bg_one")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^glyph$/i }));
    expect(screen.queryByTitle("bg_one")).toBeNull();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });
});
