// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  KIT_SLOTS,
  assetNamesIn,
  commonImageKey,
  commonImageRef,
  commonNameOf,
  imageNamed,
  imageRefsIn,
  imageUses,
  kitFolderAmong,
  kitFootprint,
  kitImage,
  kitNameOf,
  kitShippedName,
  kitShippedPath,
  moduleImageKey,
} from "./kit";
import { createImage, decodePng, encodePng } from "./png";

const shipped = async (id: string) =>
  new Uint8Array(readFileSync(resolve(__dirname, "../../assets/kit", `${id}.png`)));

const png = (width: number, height: number) => {
  const image = createImage(width, height);
  image.data.fill(0x7f);
  return encodePng(image);
};

describe("UI kit", () => {
  test("every slot of the base ships an image of its size", async () => {
    expect(KIT_SLOTS).toHaveLength(19);
    expect(new Set(KIT_SLOTS.map((s) => s.id)).size).toBe(KIT_SLOTS.length);
    for (const slot of KIT_SLOTS) {
      const { width, height } = decodePng(await shipped(slot.id));
      expect({ id: slot.id, width, height }).toEqual({
        id: slot.id,
        width: slot.width,
        height: slot.height,
      });
      // Margins leave a middle to stretch, inside the image.
      if (slot.slice) {
        expect(slot.slice.left + slot.slice.right).toBeLessThan(width);
        expect(slot.slice.top + slot.slice.bottom).toBeLessThan(height);
      }
    }
  });

  test("the kit module's image wins at the base's size, the base's stays at another", async () => {
    const own = png(16, 16);
    expect((await kitImage("close.1x1", own, shipped))?.png).toBe(own);
    const base = await shipped("close.1x1");
    expect((await kitImage("close.1x1", png(10, 10), shipped))?.png).toEqual(base);
    expect((await kitImage("close.1x1", new Uint8Array([1, 2, 3]), shipped))?.png).toEqual(base);
    expect((await kitImage("close.1x1", undefined, shipped))?.png).toEqual(base);
  });

  test("a name outside the base is the kit module's own image, or nothing", async () => {
    expect(await kitImage("banner", png(20, 12), shipped)).toMatchObject({ width: 20, height: 12 });
    expect(await kitImage("banner", undefined, shipped)).toBeNull();
    expect(await kitImage("banner", new Uint8Array([1, 2, 3]), shipped)).toBeNull();
  });

  test("the base is the one the server holds, when it holds one", async () => {
    const held = png(20, 12);
    // Another version of Artisan's than this build's: its size is the one a redraw has to match.
    expect((await kitImage("close.1x1", undefined, shipped, held))?.png).toBe(held);
    const own = png(20, 12);
    expect((await kitImage("close.1x1", own, shipped, held))?.png).toBe(own);
    expect((await kitImage("close.1x1", png(16, 16), shipped, held))?.png).toBe(held);
    expect((await kitImage("later", undefined, shipped, held))?.png).toBe(held);
    const base = await shipped("close.1x1");
    expect((await kitImage("close.1x1", undefined, shipped, new Uint8Array([1])))?.png).toEqual(
      base,
    );
  });

  test("the common images are the theme artisan's, the ui-kit module's on a server without it", () => {
    expect(kitFolderAmong(["shop", "artisan", "ui-kit"])).toBe("artisan");
    expect(kitFolderAmong(["shop", "ui-kit"])).toBe("ui-kit");
    expect(kitFolderAmong(["shop"])).toBe("artisan");
    expect(kitShippedPath("button.3x1")).toBe("originals/assets/textures/button.3x1.png");
    expect(kitShippedName("originals/assets/textures/button.3x1.png")).toBe("button.3x1");
    expect(kitShippedName("assets/textures/button.3x1.png")).toBeNull();
    expect(kitShippedName("originals/assets/textures/sub/x.png")).toBeNull();
    expect(kitShippedName("originals/assets/textures/x.yml")).toBeNull();
  });

  test("only a name after the prefix is a kit image", () => {
    expect(kitNameOf("kit:button.3x1")).toBe("button.3x1");
    expect(kitNameOf("artisan:button.3x1")).toBe("button.3x1");
    expect(kitNameOf("artisan:")).toBeNull();
    expect(kitNameOf("kit:")).toBeNull();
    expect(kitNameOf("button")).toBeNull();
    expect(kitNameOf("my_kit:button")).toBeNull();
  });

  test("a menu's name is the module's image, else the common one; artisan: is the common one", () => {
    const images = [{ id: "gold" }, { id: "kit:gold" }, { id: "kit:panel" }];
    expect(imageNamed(images, "gold")).toBe(images[0]);
    expect(imageNamed(images, "artisan:gold")).toBe(images[1]);
    expect(imageNamed(images, "kit:gold")).toBe(images[1]);
    expect(imageNamed(images, "panel")).toBe(images[2]);
    expect(imageNamed(images, "ribbon")).toBeUndefined();
  });

  test("a list that holds other modules' images answers their keys, and a name alone last", () => {
    const images = [
      { id: "gold" },
      { id: "kit:panel" },
      { id: "bank:gold" },
      { id: "bank:coin" },
      { id: "guilds:coin" },
      { id: "guilds:panel" },
    ];
    expect(imageNamed(images, "bank:gold")).toBe(images[2]);
    expect(imageNamed(images, "guilds:coin")).toBe(images[4]);
    // A name alone: the module's own, then the common one, then the first module holding it.
    expect(imageNamed(images, "gold")).toBe(images[0]);
    expect(imageNamed(images, "panel")).toBe(images[1]);
    expect(imageNamed(images, "coin")).toBe(images[3]);
    // A common image is never reached as another module's, nor a module's by a longer name.
    expect(imageNamed([{ id: "kit:star" }, { id: "bank:big:star" }], "star")).toMatchObject({
      id: "kit:star",
    });
    expect(imageNamed(images, "warps:coin")).toBeUndefined();
  });

  test("a theme's own image answers its whole name, never the name alone", () => {
    const images = [{ id: "kit:panel" }, { id: "noel:star", qualifiedOnly: true }];
    expect(imageNamed(images, "noel:star")).toBe(images[1]);
    expect(imageNamed(images, "star")).toBeUndefined();
    // A module's image of that name is still reached by the name alone.
    const withModule = [...images, { id: "bank:star" }];
    expect(imageNamed(withModule, "star")).toBe(withModule[2]);
  });

  test("a name ending with its slots says the area the image covers", () => {
    expect(kitFootprint("kit:button.3x1")).toEqual({ width: 3, height: 1 });
    expect(kitFootprint("kit:arrow.next.off.1x2")).toEqual({ width: 1, height: 2 });
    expect(kitFootprint("kit:cell")).toBeNull();
    expect(kitFootprint("button.3x1")).toBeNull();
  });

  test("a module's files say which names it holds", () => {
    expect(
      assetNamesIn([
        "assets/glyphs/gold.png",
        "assets/glyphs/gold.yml",
        "assets/textures/panel.yaml",
        "assets/fonts/title/font.yml",
        "assets/fonts/title/a.png",
        "originals/assets/textures/button.3x1.png",
        "themes/noel/assets/textures/ribbon.png",
        "menus/main.yml",
      ]).sort(),
    ).toEqual(["button.3x1", "gold", "panel", "title"]);
  });

  test("a menu writes a common image's name alone, artisan: when its module holds the name", () => {
    const own = (name: string) => name === "gold";
    expect(commonImageRef("panel", own)).toBe("panel");
    expect(commonImageRef("gold", own)).toBe("artisan:gold");
  });

  test("a name written in a menu names a common image when its module holds none of that name", () => {
    const own = (name: string) => name === "gold";
    const common = (name: string) => name === "gold" || name === "panel";
    expect(commonNameOf("panel", own, common)).toBe("panel");
    expect(commonNameOf("artisan:gold", own, common)).toBe("gold");
    expect(commonNameOf("kit:ribbon", own, common)).toBe("ribbon");
    expect(commonNameOf("gold", own, common)).toBeNull();
    expect(commonNameOf("ribbon", own, common)).toBeNull();
    expect(commonNameOf("guilds:panel", own, common)).toBeNull();
  });

  test("the menus naming each image: the common one, the module's own, another module's by its folder", () => {
    const common = (name: string) => name === "gold" || name === "panel";
    const uses = imageUses(
      [
        {
          id: "p_shop",
          name: "Shop",
          folder: "shop",
          own: (name) => name === "gold",
          menus: [
            { id: "main", refs: ["panel", "panel", "gold", "artisan:gold"] },
            { id: "sell", refs: ["gold", "coin"] },
          ],
        },
        {
          id: "p_guilds",
          name: "Guilds",
          folder: "guilds",
          own: () => false,
          menus: [{ id: "list", refs: ["gold", "kit:panel", "shop:gold", "shop:panel"] }],
        },
      ],
      common,
    );
    const shopMain = { projectId: "p_shop", projectName: "Shop", menuId: "main" };
    const guildsList = { projectId: "p_guilds", projectName: "Guilds", menuId: "list" };
    expect(uses.get(commonImageKey("panel"))).toEqual([shopMain, guildsList]);
    // The shop's `gold` is its own; `artisan:gold` there and `gold` in the guilds name the common one.
    expect(uses.get(commonImageKey("gold"))).toEqual([shopMain, guildsList]);
    expect(uses.get(moduleImageKey("shop", "gold"))).toEqual([
      shopMain,
      { projectId: "p_shop", projectName: "Shop", menuId: "sell" },
      guildsList,
    ]);
    // A name no one holds, and a qualified name its module does not hold, name nothing here.
    expect([...uses.keys()].sort()).toEqual(["artisan:gold", "artisan:panel", "shop:gold"]);
  });

  test("a composed image's layers and a kind's file count as what names an image, once each", () => {
    const common = (name: string) => name === "frame" || name === "panel";
    const uses = imageUses(
      [
        {
          id: "p_shop",
          name: "Shop",
          folder: "shop",
          own: (name) => name === "gold",
          menus: [{ id: "main", refs: ["panel"] }],
          others: [
            { kind: "image", name: "banner", refs: ["kit:frame", "frame", "gold"] },
            { kind: "file", name: "conversation_modes/hud.yml", refs: ["panel", "nothing"] },
          ],
        },
        {
          // The common images' Project: a composed common image names the others by their names.
          id: "p_kit",
          name: "artisan",
          folder: "artisan",
          own: (name) => name === "frame" || name === "panel",
          menus: [],
          others: [{ kind: "image", name: "panel", refs: ["frame"] }],
        },
      ],
      common,
    );
    const banner = {
      projectId: "p_shop",
      projectName: "Shop",
      menuId: "",
      by: { kind: "image", name: "banner" },
    };
    expect(uses.get(commonImageKey("frame"))).toEqual([
      banner,
      {
        projectId: "p_kit",
        projectName: "artisan",
        menuId: "",
        by: { kind: "image", name: "panel" },
      },
    ]);
    expect(uses.get(moduleImageKey("shop", "gold"))).toEqual([banner]);
    expect(uses.get(commonImageKey("panel"))).toEqual([
      { projectId: "p_shop", projectName: "Shop", menuId: "main" },
      {
        projectId: "p_shop",
        projectName: "Shop",
        menuId: "",
        by: { kind: "file", name: "conversation_modes/hud.yml" },
      },
    ]);
  });

  test("a Document's image names are its asset and assetId values, at any depth", () => {
    expect(
      imageRefsIn({
        title: {
          layers: [
            { kind: "glyph", assetId: "panel", x: 0 },
            { kind: "text", text: "asset" },
          ],
        },
        slots: { 4: { appearance: { image: { asset: "artisan:button.3x1", width: 3 } } } },
        asset: 12,
      }),
    ).toEqual(["panel", "artisan:button.3x1"]);
  });
});
