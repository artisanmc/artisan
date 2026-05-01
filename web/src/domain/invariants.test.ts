import { describe, expect, it } from "vitest";
import { assertPackHermetic } from "./invariants";
import type { Pack } from "./types";

const basePack = (overrides: Partial<Pack> = {}): Pack => ({
  id: "p_1" as Pack["id"],
  name: "Test",
  source: "user_created",
  createdAt: "2026-04-30T00:00:00Z",
  updatedAt: "2026-04-30T00:00:00Z",
  menus: [],
  commands: [],
  templates: [],
  assets: [],
  i18nKeys: {},
  defaultLang: "en",
  canvasLayout: {},
  ...overrides,
});

describe("assertPackHermetic", () => {
  it("accepts an empty pack", () => {
    expect(() => assertPackHermetic(basePack())).not.toThrow();
  });

  it("rejects an open_menu action targeting a menu outside the pack", () => {
    const pack = basePack({
      menus: [
        {
          id: "m_inside" as never,
          packId: "p_1" as Pack["id"],
          title: "Inside",
          rows: 3,
          layers: [
            {
              id: "l1" as never,
              name: "default",
              elements: [
                {
                  id: "el1" as never,
                  positions: "0",
                  appearances: [
                    {
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: { type: "open_menu", menuId: "m_outside" as never },
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(() => assertPackHermetic(pack)).toThrow(/cross-pack open_menu/);
  });

  it("rejects a templateRef pointing to a template outside the pack", () => {
    const pack = basePack({
      menus: [
        {
          id: "m1" as never,
          packId: "p_1" as Pack["id"],
          title: "M",
          rows: 3,
          layers: [
            {
              id: "l1" as never,
              name: "default",
              elements: [
                {
                  id: "el1" as never,
                  positions: "0",
                  appearances: [{}],
                  templateRef: { id: "tpl_outside" as never, vars: {} },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(() => assertPackHermetic(pack)).toThrow(/cross-pack template_ref/);
  });

  it("accepts a templateRef pointing to a template inside the pack", () => {
    const pack = basePack({
      templates: [
        {
          id: "tpl_inside" as never,
          packId: "p_1" as Pack["id"],
          name: "T",
          variables: [],
          appearances: [{}],
        },
      ],
      menus: [
        {
          id: "m1" as never,
          packId: "p_1" as Pack["id"],
          title: "M",
          rows: 3,
          layers: [
            {
              id: "l1" as never,
              name: "default",
              elements: [
                {
                  id: "el1" as never,
                  positions: "0",
                  appearances: [{}],
                  templateRef: { id: "tpl_inside" as never, vars: {} },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(() => assertPackHermetic(pack)).not.toThrow();
  });
});
