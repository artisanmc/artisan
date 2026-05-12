import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "@/domain/asset";
import type { AssetId, MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import * as packApi from "@/lib/packApi";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";

import { useTitleLayerDrag } from "./useTitleLayerDrag";

const PERSONAL = "p_personal" as PackId;
const M_ID = "m_shop_main" as MenuId;
const ASSET_BG: Asset = {
  id: "asset_bg" as AssetId,
  serverKeyId: "sk",
  type: "texture",
  name: "bg",
  width: 200,
  height: 16,
  ascent: null,
  codepoint: null,
  fontMeta: null,
  contentHash: "h_bg",
  createdAt: "",
  updatedAt: "",
};
const ASSET_GLYPH: Asset = {
  id: "asset_glyph" as AssetId,
  serverKeyId: "sk",
  type: "glyph",
  name: "ico",
  width: 8,
  height: 9,
  ascent: 7,
  codepoint: 0xe000,
  fontMeta: null,
  contentHash: "h_g",
  createdAt: "",
  updatedAt: "",
};

const seedMenuTitle = (layers: MenuTitleLayer[]) => {
  // Replace the seeded title on m_shop_main with the supplied layers so
  // index lookups in the hook are deterministic across cases.
  useAccountStore.getState().setMenuTitleLayers({
    packId: PERSONAL,
    menuId: M_ID,
    layers,
  });
};

const getTitle = (): MenuTitleLayer[] => {
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  return pack.menus.find((m) => m.id === M_ID)!.title;
};

describe("useTitleLayerDrag", () => {
  beforeEach(async () => {
    // mockAccount is the same fixture used by accountStore.test.ts; it gives
    // us a real pack with menu m_shop_main without rebuilding everything.
    const { mockAccount } = await import("@/mock/fixtures");
    useAccountStore.setState({ account: mockAccount() });
    useAssetStore.getState().reset();
    useAssetStore.getState().setAssets([ASSET_BG, ASSET_GLYPH]);
    useSessionStore.setState({ accessToken: "tok_test" });
    vi.restoreAllMocks();
  });

  describe("onPositionChange", () => {
    it("updates x/y on a glyph layer", () => {
      seedMenuTitle([{ kind: "glyph", assetId: ASSET_GLYPH.id as AssetId, x: 0, y: 0 }]);
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      act(() => result.current.onPositionChange({ x: 42, y: 13 }));
      const layer = getTitle()[0]!;
      expect(layer.kind).toBe("glyph");
      if (layer.kind === "glyph") {
        expect(layer.x).toBe(42);
        expect(layer.y).toBe(13);
      }
    });

    it("updates x/y on a text layer", () => {
      seedMenuTitle([
        // Reuse the seeded i18n key — the fixture pack already maps it.
        {
          kind: "text",
          value: { key: "menus.m_shop_main.title" as never },
          x: 0,
          y: 0,
        },
      ]);
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      act(() => result.current.onPositionChange({ x: 12, y: 4 }));
      const layer = getTitle()[0]!;
      if (layer.kind === "text") {
        expect(layer.x).toBe(12);
        expect(layer.y).toBe(4);
      } else {
        throw new Error("expected text layer");
      }
    });

    it("is a no-op on a background layer (no x/y on background)", () => {
      seedMenuTitle([{ kind: "background", assetId: ASSET_BG.id as AssetId }]);
      const before = getTitle()[0];
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      act(() => result.current.onPositionChange({ x: 99, y: 99 }));
      const after = getTitle()[0];
      expect(after).toEqual(before);
    });

    it("does not crash with an invalid layer index", () => {
      seedMenuTitle([{ kind: "background", assetId: ASSET_BG.id as AssetId }]);
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 99 }));
      expect(() => act(() => result.current.onPositionChange({ x: 1, y: 2 }))).not.toThrow();
    });
  });

  describe("onResize", () => {
    it("updates assetStore height on a background image layer (optimistic, no API call)", () => {
      seedMenuTitle([{ kind: "background", assetId: ASSET_BG.id as AssetId }]);
      const apiSpy = vi.spyOn(packApi, "updateAsset");
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      act(() => result.current.onResize({ width: 400, height: 32 }));
      const a = useAssetStore.getState().assets.find((x) => x.id === ASSET_BG.id)!;
      expect(a.height).toBe(32);
      expect(a.width).toBe(400);
      expect(apiSpy).not.toHaveBeenCalled();
    });

    it("updates assetStore height on a glyph image layer", () => {
      seedMenuTitle([{ kind: "glyph", assetId: ASSET_GLYPH.id as AssetId, x: 0, y: 0 }]);
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      act(() => result.current.onResize({ width: 16, height: 18 }));
      const a = useAssetStore.getState().assets.find((x) => x.id === ASSET_GLYPH.id)!;
      expect(a.height).toBe(18);
      expect(a.width).toBe(16);
    });

    it("is silently no-op on a text layer (no console.error)", () => {
      seedMenuTitle([
        {
          kind: "text",
          value: { key: "menus.m_shop_main.title" as never },
          x: 0,
          y: 0,
        },
      ]);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const before = useAssetStore.getState().assets.slice();
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      act(() => result.current.onResize({ width: 50, height: 50 }));
      expect(useAssetStore.getState().assets).toEqual(before);
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it("does not crash with an invalid layer index", () => {
      seedMenuTitle([{ kind: "background", assetId: ASSET_BG.id as AssetId }]);
      const before = useAssetStore.getState().assets.slice();
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 99 }));
      expect(() => act(() => result.current.onResize({ width: 1, height: 1 }))).not.toThrow();
      expect(useAssetStore.getState().assets).toEqual(before);
    });
  });

  describe("onResizeEnd", () => {
    it("calls updateAsset with the new height and replaces the asset on success", async () => {
      seedMenuTitle([{ kind: "background", assetId: ASSET_BG.id as AssetId }]);
      const serverAsset: Asset = { ...ASSET_BG, height: 32, width: 400, contentHash: "h_bg_v2" };
      const apiSpy = vi.spyOn(packApi, "updateAsset").mockResolvedValue(serverAsset);
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      await act(async () => {
        await result.current.onResizeEnd({ width: 400, height: 32 });
      });
      expect(apiSpy).toHaveBeenCalledWith("tok_test", ASSET_BG.id, { height: 32 });
      const a = useAssetStore.getState().assets.find((x) => x.id === ASSET_BG.id)!;
      expect(a.contentHash).toBe("h_bg_v2");
      expect(a.height).toBe(32);
    });

    it("rolls back assetStore on API failure", async () => {
      seedMenuTitle([{ kind: "background", assetId: ASSET_BG.id as AssetId }]);
      vi.spyOn(packApi, "updateAsset").mockRejectedValue(new Error("boom"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      // Drive a normal flow: onResize first (the hook itself snapshots the
      // pre-drag asset on its first call and writes the optimistic value)
      // then onResizeEnd which should fail and roll back to the snapshot.
      await act(async () => {
        result.current.onResize({ width: 400, height: 32 });
        await result.current.onResizeEnd({ width: 400, height: 32 });
      });
      const a = useAssetStore.getState().assets.find((x) => x.id === ASSET_BG.id)!;
      expect(a.height).toBe(ASSET_BG.height);
      expect(a.width).toBe(ASSET_BG.width);
      expect(a.contentHash).toBe(ASSET_BG.contentHash);
      errSpy.mockRestore();
    });

    it("is a silent no-op on a text layer (no API call)", async () => {
      seedMenuTitle([
        {
          kind: "text",
          value: { key: "menus.m_shop_main.title" as never },
          x: 0,
          y: 0,
        },
      ]);
      const apiSpy = vi.spyOn(packApi, "updateAsset");
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      await act(async () => {
        await result.current.onResizeEnd({ width: 10, height: 10 });
      });
      expect(apiSpy).not.toHaveBeenCalled();
    });

    it("does not crash with an invalid layer index", async () => {
      seedMenuTitle([{ kind: "background", assetId: ASSET_BG.id as AssetId }]);
      const apiSpy = vi.spyOn(packApi, "updateAsset");
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 99 }));
      await act(async () => {
        await result.current.onResizeEnd({ width: 1, height: 1 });
      });
      expect(apiSpy).not.toHaveBeenCalled();
    });
  });
});
