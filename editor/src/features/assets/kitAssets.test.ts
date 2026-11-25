import type { Asset } from "@/domain/asset";
import { KIT_SLOTS } from "@/lib/pack/kit";
import { type KitRead, useKitStore } from "@/state/kitStore";
import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useAssetStore } from "./assetStore";
import { isKitBase, kitAssetsOf, useCommonImageRef } from "./kitAssets";

const read = (files: Record<string, string>, binaries: string[]): KitRead => ({
  projectId: "srv.ui-kit",
  files,
  binaries: binaries.map((path) => ({ path, hash: `h-${path}` })),
});

describe("kit images in the editor", () => {
  test("a server without a kit module has the base, each under what a menu writes", () => {
    const assets = kitAssetsOf(undefined);
    expect(assets.map((a) => a.id)).toEqual(KIT_SLOTS.map((s) => `kit:${s.id}`));
    expect(assets.every(isKitBase)).toBe(true);
    const button = assets.find((a) => a.id === "kit:button.3x1");
    expect(button).toMatchObject({ width: 54, height: 18, contentHash: "" });
    expect(button?.previewUrl).toBeTruthy();
  });

  test("the kit module's image replaces a slot at its size, not at another, and adds its own", () => {
    const assets = kitAssetsOf(
      read(
        {
          "assets/textures/button.3x1.yml": "width: 54\nheight: 18\n",
          "assets/textures/close.1x1.yml": "width: 10\nheight: 10\n",
          "assets/textures/banner.yml": "width: 20\nheight: 12\n",
        },
        [
          "assets/textures/button.3x1.png",
          "assets/textures/close.1x1.png",
          "assets/textures/banner.png",
          "assets/textures/notes.txt",
          "originals/assets/textures/shipped.png",
        ],
      ),
    );
    const by = new Map(assets.map((a) => [a.id, a]));
    expect(by.get("kit:button.3x1")?.previewUrl).toContain(
      "/api/v1/projects/srv.ui-kit/binary?path=assets%2Ftextures%2Fbutton.3x1.png",
    );
    expect(by.get("kit:close.1x1")).toMatchObject({ width: 16, height: 16, contentHash: "" });
    expect(by.get("kit:banner")).toMatchObject({ width: 20, height: 12 });
    expect(isKitBase(by.get("kit:banner")!)).toBe(false);
    expect(assets).toHaveLength(KIT_SLOTS.length + 1);
  });

  test("a menu names a common image by its name alone, artisan: when a module holds the name", () => {
    const common = kitAssetsOf(undefined);
    const button = common.find((a) => a.id === "kit:button.3x1") as Asset;
    const close = common.find((a) => a.id === "kit:close.1x1") as Asset;
    const card = common.find((a) => a.id === "kit:card.3x2") as Asset;
    useAssetStore.getState().reset();
    // The module being edited holds a `close.1x1` of its own, not yet published.
    useAssetStore.getState().setAssets([{ ...close, id: "close.1x1", projectId: "shop" }]);
    useKitStore.setState({
      read: { ...read({}, []), byName: true },
      taken: new Set(["card.3x2"]),
    });
    const { result, rerender } = renderHook(() => useCommonImageRef("shop"));
    expect(result.current(button)).toBe("button.3x1");
    expect(result.current(close)).toBe("artisan:close.1x1");
    expect(result.current(card)).toBe("artisan:card.3x2");
    // Not a common image: as it is.
    expect(result.current({ ...button, id: "gold" })).toBe("gold");
    // A server older than the theme reads `kit:<name>` only.
    useKitStore.setState({ read: read({}, []) });
    rerender();
    expect(result.current(button)).toBe("kit:button.3x1");
    useKitStore.setState({ read: undefined, taken: new Set() });
  });
});
