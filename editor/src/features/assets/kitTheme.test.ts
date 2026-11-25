// @vitest-environment node
import { diskAssetsFromTree } from "@/lib/pack/diskAssets";
import { type RgbaImage, createImage, decodePng, encodePng } from "@/lib/pack/png";
import { kitTheme, themeColors } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { assetBytes } from "./assetBytes";
import { composedView } from "./composedAssets";
import { kitAssetsOf, themedKitAssets } from "./kitAssets";
import { activeKitTheme } from "./kitTheme";

const GREEN = [0x3c, 0x85, 0x27];
const RED = [0xb3, 0x26, 0x1e];

function solid(width: number, height: number, [r, g, b]: number[]): Uint8Array {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i += 4)
    image.data.set([r as number, g as number, b as number, 255], i);
  return encodePng(image);
}
const first = (image: RgbaImage) => [...image.data.slice(0, 3)];

// The kit's base without the bundler's files: a green slot frame and a green button.
vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `base:${id}`,
  kitImageBytes: async (id: string) => {
    if (id === "cell") return solid(18, 18, GREEN);
    if (id === "button.3x1") return solid(54, 18, GREEN);
    throw new Error(`kit_image_missing:${id}`);
  },
}));

const table = themeColors('colors:\n  "#3c8527": "#b3261e"\n');

describe("the kit in the server's theme", () => {
  beforeEach(() => {
    useKitStore.setState({ read: undefined, themes: [], stacks: false });
  });

  test("each kit image is the theme's drawing of it, else in the theme's colours", async () => {
    const drawn = solid(54, 18, [1, 2, 3]);
    const theme = kitTheme(
      table,
      new Map([["button.3x1", "themes/noel/assets/textures/button.3x1.png"]]),
      () => drawn,
    );
    const plain = kitAssetsOf(undefined);
    const themed = await themedKitAssets(plain, new Map(), theme);
    const by = new Map(themed.map((asset) => [asset.id, asset]));
    expect(first(decodePng(await assetBytes(by.get("kit:cell")!)))).toEqual(RED);
    expect(await assetBytes(by.get("kit:button.3x1")!)).toEqual(drawn);
    // Its size, its name and its place in the list are the kit's: only the picture changes.
    expect(by.get("kit:cell")).toMatchObject({ width: 18, height: 18, contentHash: "" });
    expect(themed.map((asset) => asset.id)).toEqual(plain.map((asset) => asset.id));
    // An image that cannot be read stays as it was.
    expect(by.get("kit:window.6")).toBe(plain.find((asset) => asset.id === "kit:window.6"));
  });

  test("a composed image's kit layers are in the theme, its own only in the kit module", async () => {
    const disk = diskAssetsFromTree(
      "p",
      [
        {
          path: "assets/textures/card.yml",
          content: "compose:\n  - use: 'kit:cell'\n  - image: icon\n    x: 1\n    y: 1\n",
        },
      ],
      [{ path: "assets/textures/icon.png", hash: "h", size: 0 }],
    );
    const card = disk.find((asset) => asset.compose)!;
    const theme = kitTheme(table, new Map(), () => null);
    const at = async (ownToo: boolean, x: number) => {
      const view = await composedView(
        card,
        disk,
        () => solid(4, 4, GREEN),
        () => undefined,
        theme,
        ownToo,
      );
      const image = decodePng(
        await assetBytes({ id: "card", previewUrl: view?.previewUrl } as never),
      );
      return [...image.data.slice((image.width + x) * 4, (image.width + x) * 4 + 3)];
    };
    // The cell under the icon, then the icon at (1, 1).
    expect(await at(false, 0)).toEqual(RED);
    expect(await at(false, 1)).toEqual(GREEN);
    expect(await at(true, 1)).toEqual(RED);
  });

  test("the theme in place is the one the server names, when its kit module holds it", async () => {
    const binary = vi.fn(async () => null);
    expect(activeKitTheme(binary)).toBeNull();
    const read = {
      projectId: "srv.ui-kit",
      files: { "themes/noel/theme.yml": 'colors:\n  "#3c8527": "#b3261e"\n' },
      binaries: [],
    };
    useKitStore.setState({ read, themes: ["noel"] });
    const theme = activeKitTheme(binary);
    expect(first(decodePng(await theme!.shown("cell", solid(1, 1, GREEN))))).toEqual(RED);
    // Read once for a kit module and its themes in place.
    expect(activeKitTheme(binary)).toBe(theme);
    useKitStore.setState({ themes: ["paques"] });
    expect(activeKitTheme(binary)).toBeNull();
    useKitStore.setState({ read: undefined, themes: ["noel"] });
    expect(activeKitTheme(binary)).toBeNull();
  });

  test("several themes in place are one look, the highest last", async () => {
    const read = {
      projectId: "srv.ui-kit",
      files: {
        "themes/noel/theme.yml": 'colors:\n  "#3c8527": "#b3261e"\n',
        "themes/nuit/theme.yml": 'colors:\n  "#b3261e": "#010203"\n',
      },
      binaries: [],
    };
    const binary = async () => null;
    // `nuit` repaints what `noel` shows.
    useKitStore.setState({ read, themes: ["noel", "nuit"] });
    const stacked = await activeKitTheme(binary)!.shown("cell", solid(1, 1, GREEN));
    expect(first(decodePng(stacked))).toEqual([1, 2, 3]);
    // The other way round, `nuit` finds no red yet, then `noel` paints the green red.
    useKitStore.setState({ themes: ["nuit", "noel"] });
    const turned = await activeKitTheme(binary)!.shown("cell", solid(1, 1, GREEN));
    expect(first(decodePng(turned))).toEqual(RED);
    // The store reads the list from the server's config, the former key when the list is empty.
    useKitStore
      .getState()
      .readConfig({ "resource-pack.themes": [], "resource-pack.theme": "noel" });
    expect(useKitStore.getState()).toMatchObject({ themes: ["noel"], stacks: true });
    const same = useKitStore.getState().themes;
    useKitStore.getState().readConfig({ "resource-pack.theme": "noel" });
    expect(useKitStore.getState().themes).toBe(same);
    expect(useKitStore.getState().stacks).toBe(false);
  });
});
