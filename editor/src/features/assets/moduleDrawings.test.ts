import type { Asset } from "@/domain/asset";
import type { KitRead } from "@/state/kitStore";
import { describe, expect, it } from "vitest";
import { drawnInModule, moduleDrawings, pngHeaderSize } from "./moduleDrawings";

/** The first bytes of a PNG of `width` by `height`. */
function header(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const theme = (projectId: string, files: Record<string, string>, paths: string[]): KitRead => ({
  projectId,
  files,
  binaries: paths.map((path) => ({ path, hash: `h-${projectId}-${path}` })),
});

const banner = {
  id: "banner",
  projectId: "p-shop",
  type: "texture",
  name: "banner",
  width: 40,
  height: 10,
  contentHash: "own",
} as unknown as Asset;

describe("moduleDrawings", () => {
  it("reads a PNG's size in its header", () => {
    expect(pngHeaderSize(header(64, 18))).toEqual({ width: 64, height: 18 });
    expect(pngHeaderSize(new Uint8Array(4))).toEqual({ width: 0, height: 0 });
  });

  it("takes the highest theme's drawing, at the size beside it or in its header", async () => {
    const own = {
      noel: theme("p-noel", { "overrides/shop/banner.yml": "width: 50\nheight: 12\n" }, [
        "overrides/shop/banner.png",
        "overrides/shop/frame.png",
      ]),
      gold: theme("p-gold", {}, ["overrides/shop/banner.png", "assets/textures/banner.png"]),
    };
    const read: string[] = [];
    const binary = async (projectId: string, path: string) => {
      read.push(`${projectId}:${path}`);
      return header(64, 18);
    };
    const drawings = await moduleDrawings(["noel", "gold", "absent"], own, binary);
    expect([...drawings.keys()].sort()).toEqual(["shop/banner", "shop/frame"]);
    expect(drawings.get("shop/banner")).toMatchObject({
      width: 64,
      height: 18,
      hash: "h-p-gold-overrides/shop/banner.png",
    });
    expect(drawings.get("shop/frame")).toMatchObject({ width: 64, height: 18 });
    // The size written beside the file is not read from the file again.
    expect(read).not.toContain("p-noel:overrides/shop/banner.png");
    expect((await moduleDrawings(["gold", "noel"], own, binary)).get("shop/banner")).toMatchObject({
      width: 50,
      height: 12,
    });
  });

  it("shows a module's image as the theme draws it, and no other module's", async () => {
    const own = { gold: theme("p-gold", {}, ["overrides/shop/banner.png"]) };
    const drawings = await moduleDrawings(["gold"], own, async () => header(64, 18));
    const drawn = drawnInModule(banner, "shop", "banner", drawings);
    expect(drawn).toMatchObject({ id: "banner", width: 64, height: 18 });
    expect(drawn.previewUrl).toContain("overrides%2Fshop%2Fbanner.png");
    expect(drawnInModule(banner, "quests", "banner", drawings)).toBe(banner);
    expect(drawnInModule(banner, undefined, "banner", drawings)).toBe(banner);
    const composed = { ...banner, compose: { layers: [] } } as unknown as Asset;
    expect(drawnInModule(composed, "shop", "banner", drawings)).toBe(composed);
  });
});
