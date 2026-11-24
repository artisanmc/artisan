import { KIT_SLOTS } from "@/lib/pack/kit";
import type { KitRead } from "@/state/kitStore";
import { describe, expect, test } from "vitest";
import { isKitBase, kitAssetsOf } from "./kitAssets";

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
});
