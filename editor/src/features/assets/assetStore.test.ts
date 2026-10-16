import type { Asset } from "@/domain/asset";
import { beforeEach, describe, expect, it } from "vitest";
import { useAssetStore } from "./assetStore";

const a1: Asset = {
  id: "asset_1",
  projectId: "p1",
  type: "texture",
  name: "bg_a",
  width: 16,
  height: 16,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  contentHash: "hash1",
  createdAt: "",
  updatedAt: "",
};
const a2: Asset = {
  ...a1,
  id: "asset_2",
  name: "ico",
  type: "glyph",
  codepoint: 0xe000,
  ascent: 7,
};

describe("assetStore", () => {
  beforeEach(() => useAssetStore.getState().reset());

  it("starts empty and not loading", () => {
    const s = useAssetStore.getState();
    expect(s.assets).toEqual([]);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("setAssets replaces the list", () => {
    useAssetStore.getState().setAssets([a1, a2]);
    expect(useAssetStore.getState().assets).toHaveLength(2);
  });

  it("upsertAsset inserts a new asset", () => {
    useAssetStore.getState().upsertAsset(a1);
    expect(useAssetStore.getState().assets).toHaveLength(1);
  });

  it("upsertAsset replaces an existing one by id", () => {
    useAssetStore.getState().setAssets([a1]);
    useAssetStore.getState().upsertAsset({ ...a1, name: "bg_a_renamed" });
    const list = useAssetStore.getState().assets;
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("bg_a_renamed");
  });

  it("removeAsset removes by id", () => {
    useAssetStore.getState().setAssets([a1, a2]);
    useAssetStore.getState().removeAsset("asset_1");
    expect(useAssetStore.getState().assets.map((x) => x.id)).toEqual(["asset_2"]);
  });

  it("selection getter and setter", () => {
    useAssetStore.getState().setSelectedId("asset_2");
    expect(useAssetStore.getState().selectedId).toBe("asset_2");
  });
});
