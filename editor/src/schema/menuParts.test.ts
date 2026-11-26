import { appearanceImages, labelLayers } from "@/domain/imageButton";
import type { Project, ProjectId } from "@/domain/types";
import { imageButtonKey, imageButtonsFromMenus } from "@/lib/pack/imageButtons";
import { describe, expect, it } from "vitest";
import { imageButtonGeometry, labelFrame } from "../../../docs/schema/menu/v1/imageButtonGeometry";
import { menuV1FromDomain } from "./menuV1FromDomain";
import { menuV1ToDomain } from "./menuV1ToDomain";
import { validateMenuV1 } from "./validateMenuV1";

describe("a look made of parts", () => {
  const parts = [
    { image: "panel" },
    { image: "coin", anchor: "left", offset_x: 3 },
    { label: "Buy" },
    { label: { en: "{price}", fr: "{price} !" }, anchor: "top_right", size: 12, offset_x: -4 },
  ];
  const wire = {
    schema: "menu/v1",
    id: "shop",
    title: [],
    size: 27,
    elements: [{ id: "buy", positions: "0-2", parts }],
  };
  const withElement = (element: Record<string, unknown>) => ({ ...wire, elements: [element] });

  it("validates, and says what a look of parts cannot be", () => {
    expect(validateMenuV1(wire)).toEqual({ valid: true, errors: [] });
    const errors = (element: Record<string, unknown>) =>
      validateMenuV1(withElement({ id: "buy", positions: "0-2", ...element })).errors.join("\n");
    expect(errors({ parts, image: { asset: "panel" } })).toMatch(/keep the parts/);
    expect(errors({ parts, material: "STONE" })).toMatch(/an image and an item/);
    expect(errors({ parts: [{ image: "{row.icon}" }] })).toMatch(/expression/);
    expect(validateMenuV1(withElement({ id: "buy", positions: "0-2", parts: [{}] })).valid).toBe(
      false,
    );
    expect(
      validateMenuV1(
        withElement({ id: "buy", positions: "0-2", parts: [{ image: "a", anchor: "middle" }] }),
      ).valid,
    ).toBe(false);
    expect(errors({ parts: [{ image: "a" }], iterates: { source: "rows", alias: "row" } })).toMatch(
      /iterates or places/,
    );
  });

  it("round-trips the parts, texts included", () => {
    const { menu, i18nKeys } = menuV1ToDomain(wire, { projectId: "p" as ProjectId, lang: "en" });
    const project = { id: "p", defaultLang: "en", i18nKeys } as Project;
    const out = menuV1FromDomain(menu, project);
    expect(out).toMatchObject({ elements: [{ id: "buy", parts }] });
    expect((out.elements as Record<string, unknown>[])[0]).not.toHaveProperty("image");
    expect(validateMenuV1(out).valid).toBe(true);
  });

  it("draws each image at its anchor and each text as a title textarea", () => {
    const { menu } = menuV1ToDomain(wire, { projectId: "p" as ProjectId, lang: "en" });
    const element = menu.layers[0]!.elements[0]!;
    const images = appearanceImages(element.display);
    expect(images).toEqual([
      { asset: "panel", fit: "native" },
      { asset: "coin", fit: "native", offset_x: 3, anchor: "left" },
    ]);
    expect(imageButtonGeometry(images[1]!, 12, 10, 54, 18)).toEqual({
      width: 12,
      height: 10,
      x: 3,
      y: 4,
    });
    expect(
      imageButtonGeometry({ asset: "a", fit: "native", anchor: "bottom_right" }, 12, 10, 54, 18),
    ).toMatchObject({ x: 42, y: 8 });
    const layers = labelLayers(menu);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toMatchObject({ x: 7 + 27, y: 22, alignment: "center" });
    expect(layers[1]).toMatchObject({ x: 7 + 54 - 2 - 4, y: 19, alignment: "right", size: 12 });
    expect(labelFrame({ valign: "bottom" }, { x: 7, y: 17, width: 54, height: 36 }).y).toBe(44);
  });

  it("asks the pack for one glyph per image, the anchor in its key", () => {
    const placements = imageButtonsFromMenus([
      {
        path: "menus/shop.yaml",
        content: JSON.stringify(wire),
      },
    ]);
    expect(placements.map((p) => [p.asset, p.fit, p.anchor])).toEqual([
      ["panel", "native", undefined],
      ["coin", "native", "left"],
    ]);
    expect(imageButtonKey(placements[0]!)).toMatch(/_54_18_native_17$/);
    expect(imageButtonKey(placements[1]!)).toMatch(/_54_18_native_17_3_0_left$/);
  });
});
