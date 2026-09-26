import type { Asset } from "@/domain/asset";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsTab } from "./AssetsTab";
import { useAssetStore } from "./assetStore";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * estimateSize(),
        size: estimateSize(),
      })),
  }),
}));

const A1: Asset = {
  id: "asset_1",
  projectId: "p1",
  type: "texture" as const,
  name: "bg_one",
  width: 16,
  height: 16,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  usages: ["background"],
  contentHash: "h1",
  createdAt: "",
  updatedAt: "",
};
const A2: Asset = {
  id: "asset_2",
  projectId: "p1",
  type: "glyph" as const,
  name: "ico_one",
  width: 8,
  height: 9,
  ascent: 7,
  codepoint: 0xe000,
  fontMeta: null,
  usages: ["button"],
  contentHash: "h2",
  createdAt: "",
  updatedAt: "",
};

describe("AssetsTab", () => {
  beforeEach(() => {
    // AssetsTab no longer fetches itself — the assets are loaded by
    // `useAssetInit` mounted on EditorPane. Tests seed the store directly.
    useAssetStore.getState().reset();
    useAssetStore.getState().setAssets([A1, A2]);
  });

  it("renders the assets from the store", () => {
    render(<AssetsTab projectId={"p1" as never} />);
    expect(screen.getByTitle("bg_one")).toBeTruthy();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });

  it("opens the upload dialog when clicking Upload", () => {
    useAssetStore.getState().setAssets([]);
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /^Importer une image$/i }));
    expect(screen.getByRole("dialog", { name: /importer une image/i })).toBeTruthy();
  });

  it("filters by search query (case-insensitive)", () => {
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.change(screen.getByPlaceholderText(/Rechercher/i), { target: { value: "ico" } });
    expect(screen.queryByTitle("bg_one")).toBeNull();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });

  it("filters by type chip", () => {
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /^Images de boutons$/i }));
    expect(screen.queryByTitle("bg_one")).toBeNull();
    expect(screen.getByTitle("ico_one")).toBeTruthy();
  });
  it("groups legacy backgrounds and decorations with menu images and scopes imports", () => {
    useAssetStore
      .getState()
      .setAssets([
        A1,
        A2,
        { ...A1, id: "logo", name: "logo", usages: ["decoration"] },
        { ...A1, id: "frame", name: "frame", usages: ["menu"] },
      ]);
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /^Images du menu$/ }));
    for (const name of ["bg_one", "logo", "frame"]) expect(screen.getByTitle(name)).toBeTruthy();
    expect(screen.queryByTitle("ico_one")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Importer une image$/ }));
    expect(screen.getByRole("checkbox", { name: /^Images du menu$/ })).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
  });
  it("keeps unclassified images accessible and separates no-results from load failures", () => {
    useAssetStore.getState().setAssets([{ ...A1, usages: [] }, A2]);
    render(<AssetsTab projectId={"p1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /À classer/i }));
    expect(screen.getByTitle("bg_one")).toBeTruthy();
    expect(screen.queryByTitle("ico_one")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "not-found" } });
    expect(screen.getByRole("status")).toHaveTextContent(/Aucune ressource ne correspond/);
  });
});
