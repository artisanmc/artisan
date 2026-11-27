// @vitest-environment node
import { diskAssetsFromTree } from "@/lib/pack/diskAssets";
import { createImage, decodePng, encodePng } from "@/lib/pack/png";
import { kitTheme } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { assetBytes } from "./assetBytes";
import { composedView } from "./composedAssets";
import { kitAssetsOf, kitVariantAssets, themedKitAssets } from "./kitAssets";
import {
  activeKitTheme,
  activePalette,
  serverPalette,
  serverPaletteNames,
  serverTheme,
  serverThemeNames,
} from "./kitTheme";

const GREEN = [0x3c, 0x85, 0x27];
const RED = [0xb3, 0x26, 0x1e];

function solid(width: number, height: number, [r, g, b]: number[]): Uint8Array {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i += 4)
    image.data.set([r as number, g as number, b as number, 255], i);
  return encodePng(image);
}

// The kit's base without the bundler's files: a green slot frame and a green button.
vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `base:${id}`,
  kitImageBytes: async (id: string) => {
    if (id === "cell") return solid(18, 18, GREEN);
    if (id === "button.3x1") return solid(54, 18, GREEN);
    if (id === "button.neutral.3x1") return solid(54, 18, [255, 255, 255]);
    if (id === "button.warning.3x1") return solid(54, 18, GREEN);
    throw new Error(`kit_image_missing:${id}`);
  },
}));

const DRAWN = [1, 2, 3];

describe("the kit in the server's theme", () => {
  beforeEach(() => {
    useKitStore.setState({ read: undefined, own: {}, themes: [], stacks: false });
  });

  test("each kit image is the theme's drawing of it, else itself", async () => {
    const drawn = solid(54, 18, DRAWN);
    const theme = kitTheme(
      new Map([["button.3x1", "themes/noel/assets/textures/button.3x1.png"]]),
      () => drawn,
    );
    const plain = kitAssetsOf(undefined);
    const themed = await themedKitAssets(plain, theme);
    const by = new Map(themed.map((asset) => [asset.id, asset]));
    expect(await assetBytes(by.get("kit:button.3x1")!)).toEqual(drawn);
    // An image the theme does not draw is the very asset it was: no colour is replaced.
    expect(by.get("kit:cell")).toBe(plain.find((asset) => asset.id === "kit:cell"));
    expect(themed.map((asset) => asset.id)).toEqual(plain.map((asset) => asset.id));
    // An image that cannot be read stays as it was.
    expect(by.get("kit:window.6")).toBe(plain.find((asset) => asset.id === "kit:window.6"));
  });

  test("a composed image's kit layers are in the theme, its own only in the kit module", async () => {
    const theme = kitTheme(
      new Map([
        ["cell", "cell.png"],
        ["icon", "icon.png"],
      ]),
      (path) => (path === "cell.png" ? solid(18, 18, RED) : solid(4, 4, DRAWN)),
    );
    const at = async (ownToo: boolean, x: number) => {
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
    // The cell under the icon, then the icon at (1, 1): a module's own image is the module's.
    expect(await at(false, 0)).toEqual(RED);
    expect(await at(false, 1)).toEqual(GREEN);
    // In the kit module its own image is a common one, which the theme draws.
    expect(await at(true, 1)).toEqual(DRAWN);
  });

  test("the theme in place is the one the server names, when its kit module holds it", async () => {
    const drawn = solid(1, 1, RED);
    const binary = vi.fn(async () => drawn);
    expect(activeKitTheme(binary)).toBeNull();
    const read = {
      projectId: "srv.ui-kit",
      files: {},
      binaries: [{ path: "themes/noel/assets/textures/cell.png", hash: "h" }],
    };
    useKitStore.setState({ read, themes: ["noel"] });
    const theme = activeKitTheme(binary);
    expect(await theme!.shown("cell", solid(1, 1, GREEN))).toBe(drawn);
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
      files: {},
      binaries: [
        { path: "themes/noel/assets/textures/cell.png", hash: "a" },
        { path: "themes/nuit/assets/textures/cell.png", hash: "b" },
      ],
    };
    const noel = solid(1, 1, RED);
    const nuit = solid(1, 1, DRAWN);
    const binary = async (_: string, path: string) => (path.includes("/nuit/") ? nuit : noel);
    useKitStore.setState({ read, themes: ["noel", "nuit"] });
    expect(await activeKitTheme(binary)!.shown("cell", solid(1, 1, GREEN))).toBe(nuit);
    useKitStore.setState({ themes: ["nuit", "noel"] });
    expect(await activeKitTheme(binary)!.shown("cell", solid(1, 1, GREEN))).toBe(noel);
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

  test("a theme of its own folder is read from the Project of its name", async () => {
    const read = {
      projectId: "srv.artisan",
      files: {},
      binaries: [
        { path: "themes/noel/assets/textures/cell.png", hash: "a" },
        { path: "themes/nuit/assets/textures/back.png", hash: "b" },
      ],
    };
    const own = {
      noel: {
        projectId: "srv.noel",
        // A table of colours it once held: no longer read.
        files: { "overrides/colors.yml": 'colors:\n  "#3c8527": "#b3261e"\n' },
        binaries: [{ path: "overrides/artisan/cell.png", hash: "h" }],
      },
    };
    const drawn = solid(18, 18, [7, 8, 9]);
    const asked: string[] = [];
    const binary = async (projectId: string, path: string) => {
      asked.push(`${projectId}/${path}`);
      return drawn;
    };
    expect(serverThemeNames(read, own)).toEqual(["noel", "nuit"]);
    expect(serverThemeNames(undefined, {})).toEqual([]);
    // The Project wins over the folder of that name the common images keep.
    const noel = serverTheme(read, own, "noel", binary)!;
    const green = solid(1, 1, GREEN);
    expect(await noel.shown("x", green)).toBe(green);
    expect(await noel.shown("cell", solid(18, 18, GREEN))).toBe(drawn);
    expect(asked).toEqual(["srv.noel/overrides/artisan/cell.png"]);
    expect(serverTheme(read, own, "nuit", binary)).not.toBeNull();
    expect(serverTheme(read, own, "gone", binary)).toBeNull();
    // In place: `nuit`, still kept by the common images, draws what `noel` does not.
    useKitStore.setState({ read, own, themes: ["noel", "nuit"] });
    expect(await activeKitTheme(binary)!.shown("back", solid(18, 18, GREEN))).toBe(drawn);
    // A server whose themes are all of their own folder needs no theme kept by the common images.
    useKitStore.setState({ read: undefined, themes: ["noel"] });
    expect(activeKitTheme(binary)).not.toBeNull();
  });

  test("a tint's name is a colour of the themes in place, the highest first, then of the library", async () => {
    const kit = (files: Record<string, string>) => ({ projectId: "k", files, binaries: [] });
    const read = kit({ "palette.yml": 'gold: "#d4a017"\nprimary: "#000001"\n' });
    const own = {
      nuit: kit({ "palette.yml": 'primary: "#101820"\ndanger: "#600000"\n' }),
      noel: kit({ "palette.yml": 'primary: "#ffffff"\n' }),
    };
    const stacked = serverPalette(read, own, ["nuit", "noel", "gone"]);
    expect(stacked("primary")).toBe("#ffffff");
    expect(stacked("danger")).toBe("#600000");
    expect(stacked("gold")).toBe("#d4a017");
    // One theme alone, as its page judges it; none: the library, then the default palette.
    expect(serverPalette(read, own, ["nuit"])("primary")).toBe("#101820");
    expect(serverPalette(read, own, [])("primary")).toBe("#000001");
    expect(serverPalette(undefined, {}, [])("primary")).toBe("#3b82f6");

    // The editor shows a named tint as the pack draws it.
    useKitStore.setState({ read, own, themes: ["nuit", "noel"] });
    const palette = activePalette();
    expect(activePalette()).toBe(palette);
    const disk = diskAssetsFromTree(
      "p",
      [
        {
          path: "assets/textures/card.yml",
          content: "compose:\n  - image: icon\n    tint: danger\n",
        },
      ],
      [{ path: "assets/textures/icon.png", hash: "h", size: 0 }],
    );
    const card = disk.find((asset) => asset.compose)!;
    const pixel = async (view: Awaited<ReturnType<typeof composedView>>) => {
      const image = decodePng(
        await assetBytes({ id: "card", previewUrl: view?.previewUrl } as never),
      );
      return [...image.data.slice(0, 3)];
    };
    const white = () => solid(4, 4, [255, 255, 255]);
    const none = () => undefined;
    expect(
      await pixel(await composedView(card, disk, white, none, null, false, undefined, palette)),
    ).toEqual([0x60, 0, 0]);
    expect(await pixel(await composedView(card, disk, white, none))).toEqual([255, 255, 255]);
  });

  test("a coloured variant of the base is its neutral image, as shown, in the palette's colour", async () => {
    const plain = kitAssetsOf(undefined);
    const first = async (asset: { id: string; previewUrl?: string } | undefined) => [
      ...decodePng(await assetBytes(asset as never)).data.slice(0, 3),
    ];
    // As Artisan ships it: nothing to draw again.
    expect((await kitVariantAssets(plain, plain, serverPalette(undefined, {}, []))).size).toBe(0);
    // A palette's colour: that variant alone.
    const kit = { projectId: "k", files: { "palette.yml": 'primary: "#b3261e"\n' }, binaries: [] };
    const red = await kitVariantAssets(plain, plain, serverPalette(kit, {}, []));
    expect([...red.keys()]).toEqual(["kit:button.primary.3x1"]);
    expect(await first(red.get("kit:button.primary.3x1"))).toEqual(RED);
    // A theme that draws the neutral image: every variant follows; one it draws itself stays.
    const theme = kitTheme(
      new Map([
        ["button.neutral.3x1", "n.png"],
        ["button.warning.3x1", "w.png"],
      ]),
      (path) => (path === "n.png" ? solid(54, 18, [128, 128, 128]) : solid(54, 18, DRAWN)),
    );
    const themed = await themedKitAssets(plain, theme);
    const grey = await kitVariantAssets(plain, themed, serverPalette(kit, {}, []));
    expect([...grey.keys()]).toEqual(["kit:button.primary.3x1", "kit:button.success.3x1"]);
    expect(await first(grey.get("kit:button.primary.3x1"))).toEqual([90, 19, 15]);
  });

  test("the names a tint may write: the default ones, then what the library and the themes add", () => {
    expect(serverPaletteNames(undefined, {})).toEqual([
      "neutral",
      "primary",
      "success",
      "danger",
      "warning",
    ]);
    const library = {
      projectId: "srv.artisan",
      files: { "palette.yml": 'primary: "#000000"\ngold: "#ffcc00"\n' },
      binaries: [],
    };
    const noel = {
      projectId: "srv.noel",
      files: { "palette.yml": 'frost: "#99ddff"\n' },
      binaries: [],
    };
    expect(serverPaletteNames(library, { noel }).slice(5)).toEqual(["frost", "gold"]);
  });
});
