// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { KIT_SLOTS, kitFootprint, kitImage, kitNameOf } from "./kit";
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
      expect({ id: slot.id, width, height }).toEqual(slot);
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

  test("only a name after the prefix is a kit image", () => {
    expect(kitNameOf("kit:button.3x1")).toBe("button.3x1");
    expect(kitNameOf("kit:")).toBeNull();
    expect(kitNameOf("button")).toBeNull();
    expect(kitNameOf("my_kit:button")).toBeNull();
  });

  test("a name ending with its slots says the area the image covers", () => {
    expect(kitFootprint("kit:button.3x1")).toEqual({ width: 3, height: 1 });
    expect(kitFootprint("kit:arrow.next.off.1x2")).toEqual({ width: 1, height: 2 });
    expect(kitFootprint("kit:cell")).toBeNull();
    expect(kitFootprint("button.3x1")).toBeNull();
  });
});
