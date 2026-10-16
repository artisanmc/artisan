import type { Project, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { menuV1FromDomain } from "./menuV1FromDomain";
import { menuV1ToDomain } from "./menuV1ToDomain";
import { validateMenuV1 } from "./validateMenuV1";

describe("image button documents", () => {
  const wire = {
    schema: "menu/v1",
    id: "shop",
    title: [],
    size: 27,
    elements: [
      {
        id: "buy",
        positions: "0-2,9-11",
        image: { asset: "buy", fit: "native", offset_x: 2, offset_y: -3 },
        click: { left: 'send_message "Bought"' },
        states: [
          {
            if: [{ type: "has_permission", perm: "vip" }],
            image: { asset: "vip", fit: "stretch" },
            click: { right: 'send_message "VIP"' },
          },
        ],
      },
    ],
  };
  it("round-trips one six-slot image and its independent conditional appearance and actions", () => {
    expect(validateMenuV1(wire)).toEqual({ valid: true, errors: [] });
    const { menu, i18nKeys } = menuV1ToDomain(wire, { projectId: "p" as ProjectId, lang: "en" });
    expect(menu.layers[0]!.elements[0]!.display.image).toEqual(wire.elements[0]!.image);
    const project = { id: "p", defaultLang: "en", i18nKeys } as Project;
    const result = menuV1FromDomain(menu, project);
    expect(result).toMatchObject({
      elements: [
        {
          image: wire.elements[0]!.image,
          positions: "0-2,9-11",
          states: [{ image: { asset: "vip", fit: "stretch" } }],
        },
      ],
    });
    expect(validateMenuV1(result).valid).toBe(true);
  });
  it.each([
    { positions: "0,2" },
    { positions: "25-28" },
    { material: "STONE" },
    { item: "{item.icon}" },
    { image: { asset: "buy", fit: "native", offset_x: 1.5 } },
    { image: { asset: "buy", offset_y: 4097 } },
    { iterates: { source: "items", alias: "item" } },
  ])("rejects invalid image placement or a competing item source: %j", (patch) => {
    expect(validateMenuV1({ ...wire, elements: [{ ...wire.elements[0], ...patch }] }).valid).toBe(
      false,
    );
  });
  it("rejects another element inside an image button's area", () => {
    expect(
      validateMenuV1({
        ...wire,
        elements: [...wire.elements, { id: "other", positions: 10, material: "STONE" }],
      }).valid,
    ).toBe(false);
  });
});
