import { labelLayers } from "@/domain/imageButton";
import type { Project, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { labelFrame } from "../../../docs/schema/menu/v1/imageButtonGeometry";
import { menuV1FromDomain } from "./menuV1FromDomain";
import { menuV1ToDomain } from "./menuV1ToDomain";
import { validateMenuV1 } from "./validateMenuV1";

describe("element labels", () => {
  const wire = {
    schema: "menu/v1",
    id: "calendar",
    title: [],
    size: 54,
    elements: [
      {
        id: "freezes",
        positions: "7-8",
        image: { asset: "freeze_box", fit: "native" },
        label: { text: "<aqua>{status[0].freezes}" },
        states: [
          {
            if: [{ type: "has_permission", perm: "vip" }],
            image: { asset: "freeze_box", fit: "native" },
            label: { text: { en: "VIP", fr: "VIP !" }, align: "left", size: 12, offset_y: -1 },
          },
        ],
      },
      { id: "streak", positions: "0-2", title: "Streak", lore: ["Longest: 4"] },
    ],
  };

  it("validates a label and an element without item (a hover area)", () => {
    expect(validateMenuV1(wire)).toEqual({ valid: true, errors: [] });
    const bad = { ...wire, elements: [{ ...wire.elements[0], label: { text: "a", size: 9 } }] };
    expect(validateMenuV1(bad).valid).toBe(false);
  });

  it("round-trips the label of the display and of a state", () => {
    const { menu, i18nKeys } = menuV1ToDomain(wire, { projectId: "p" as ProjectId, lang: "en" });
    const project = { id: "p", defaultLang: "en", i18nKeys } as Project;
    const out = menuV1FromDomain(menu, project);
    expect(out).toMatchObject({
      elements: [
        {
          label: { text: "<aqua>{status[0].freezes}" },
          states: [
            { label: { text: { en: "VIP", fr: "VIP !" }, align: "left", size: 12, offset_y: -1 } },
          ],
        },
        { id: "streak" },
      ],
    });
    expect(validateMenuV1(out).valid).toBe(true);
  });

  it("places the label like the plugin: centred in the slot rectangle", () => {
    expect(labelFrame({}, { x: 133, y: 17, width: 36, height: 18 })).toMatchObject({
      x: 151,
      y: 22,
      width: 36,
      alignment: "center",
      size: 8,
    });
    const area = { x: 7, y: 17, width: 54, height: 18 };
    expect(labelFrame({ align: "left" }, area).x).toBe(9);
    expect(labelFrame({ align: "right" }, area).x).toBe(59);
    expect(labelFrame({ size: 12, offset_x: 3, offset_y: -2 }, area)).toMatchObject({
      x: 37,
      y: 19,
      size: 12,
    });
  });

  it("draws the display labels of fixed elements as title textareas", () => {
    const { menu } = menuV1ToDomain(wire, { projectId: "p" as ProjectId, lang: "en" });
    const layers = labelLayers(menu);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ kind: "textarea", x: 151, y: 22, alignment: "center" });
  });
});
