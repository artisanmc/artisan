import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Asset } from "@/domain/asset";
import type { AssetId, MenuId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";

import { useTitleLayerDrag } from "./useTitleLayerDrag";
import { menusOf } from "@/domain/documents";

const PERSONAL = "p_personal" as ProjectId;
const M_ID = "m_shop_main" as MenuId;
const ASSET_BG: Asset = {
  id: "asset_bg" as AssetId,
  projectId: "p1",
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
  projectId: "p1",
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
  useAccountStore.getState().setMenuTitleLayers({
    projectId: PERSONAL,
    menuId: M_ID,
    layers,
  });
};

const getTitle = (): MenuTitleLayer[] => {
  const project = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
  return menusOf(project).find((m) => m.id === M_ID)!.title;
};

describe("useTitleLayerDrag", () => {
  beforeEach(async () => {
    const { mockAccount } = await import("@/mock/fixtures");
    useAccountStore.setState({ account: mockAccount() });
  });

  describe("onPositionChange", () => {
    it("updates x/y in the local store on a glyph layer (no API call)", async () => {
      seedMenuTitle([{ kind: "glyph", assetId: ASSET_GLYPH.id as AssetId, x: 0, y: 0 }]);
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      await act(async () => result.current.onPositionChange({ x: 42, y: 13 }));
      const layer = getTitle()[0]!;
      expect(layer.kind).toBe("glyph");
      if (layer.kind === "glyph") {
        expect(layer.x).toBe(42);
        expect(layer.y).toBe(13);
      }
    });

    it("updates x/y on a text layer", async () => {
      seedMenuTitle([
        {
          kind: "text",
          value: { key: "menus.m_shop_main.title" as never },
          x: 0,
          y: 0,
        },
      ]);
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      await act(async () => result.current.onPositionChange({ x: 12, y: 4 }));
      const layer = getTitle()[0]!;
      if (layer.kind === "text") {
        expect(layer.x).toBe(12);
        expect(layer.y).toBe(4);
      } else {
        throw new Error("expected text layer");
      }
    });

    it("updates x/y on a textarea layer", async () => {
      seedMenuTitle([
        {
          kind: "textarea",
          value: { key: "menus.m_shop_main.instructions" as never },
          x: 0,
          y: 0,
          width: 168,
          lineHeight: 10,
          alignment: "left",
        },
      ]);
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      await act(async () => result.current.onPositionChange({ x: 20, y: 30 }));
      const layer = getTitle()[0]!;
      if (layer.kind === "textarea") {
        expect(layer.x).toBe(20);
        expect(layer.y).toBe(30);
        // Verify other fields preserved
        expect(layer.lineHeight).toBe(10);
        expect(layer.alignment).toBe("left");
        expect(layer.value).toEqual({ key: "menus.m_shop_main.instructions" as never });
      } else {
        throw new Error("expected textarea layer");
      }
    });

    it("is a no-op on a background layer (no x/y on background)", async () => {
      seedMenuTitle([{ kind: "background", assetId: ASSET_BG.id as AssetId }]);
      const before = getTitle()[0];
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      await act(async () => result.current.onPositionChange({ x: 99, y: 99 }));
      const after = getTitle()[0];
      expect(after).toEqual(before);
    });

    it("a drop at the layer's current position leaves no undo entry", async () => {
      seedMenuTitle([{ kind: "glyph", assetId: ASSET_GLYPH.id as AssetId, x: 4, y: 20 }]);
      useAccountStore.temporal.getState().clear();
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      await act(async () => result.current.onPositionChange({ x: 4, y: 20 }));
      expect(useAccountStore.temporal.getState().pastStates).toHaveLength(0);
    });

    it("ctrl+z after a drag puts the layer back", async () => {
      seedMenuTitle([{ kind: "glyph", assetId: ASSET_GLYPH.id as AssetId, x: 4, y: 20 }]);
      useAccountStore.temporal.getState().clear();
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 0 }));
      await act(async () => result.current.onPositionChange({ x: 30, y: 50 }));
      act(() => useAccountStore.temporal.getState().undo());
      expect(getTitle()[0]).toMatchObject({ x: 4, y: 20 });
    });

    it("does not crash with an invalid layer index", async () => {
      seedMenuTitle([{ kind: "background", assetId: ASSET_BG.id as AssetId }]);
      const { result } = renderHook(() => useTitleLayerDrag({ menuId: M_ID, layerIndex: 99 }));
      await expect(
        act(async () => result.current.onPositionChange({ x: 1, y: 2 })),
      ).resolves.not.toThrow();
    });
  });
});
