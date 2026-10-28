import { describe, expect, it } from "vitest";
import canonicalButton from "../../../docs/schema/menu/v1/examples/canonical-button.json";
import canonicalConditional from "../../../docs/schema/menu/v1/examples/canonical-conditional.json";
import { validateMenuV1 } from "./validateMenuV1";

describe("validateMenuV1", () => {
  it("accepts the canonical button example", () => {
    const r = validateMenuV1(canonicalButton);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("accepts the canonical conditional example", () => {
    expect(validateMenuV1(canonicalConditional).valid).toBe(true);
  });

  it("rejects a menu with a bad size", () => {
    const bad = { ...(canonicalButton as object), size: 13 };
    const r = validateMenuV1(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/size/);
  });

  it("accepts a string title (canonical sugar for one plain layer)", () => {
    const sweet = { ...(canonicalButton as object), title: "Shop" };
    expect(validateMenuV1(sweet).valid).toBe(true);
  });

  it("accepts a field-local lang map on an appearance", () => {
    const m = structuredClone(canonicalButton) as Record<string, any>;
    m.layers[0].elements[0].title = { en: "Back", fr: "Retour" };
    expect(validateMenuV1(m).valid).toBe(true);
  });

  it("accepts a lore as one list per language, and the legacy map per line", () => {
    const m = structuredClone(canonicalButton) as Record<string, any>;
    m.layers[0].elements[0].lore = { en: ["Members", "", "Click"], fr: ["Membres", "Clic"] };
    expect(validateMenuV1(m).valid).toBe(true);
    m.layers[0].elements[0].lore = ["", { en: "Members", fr: "Membres" }];
    expect(validateMenuV1(m).valid).toBe(true);
    m.layers[0].elements[0].lore = { en: ["Members"], "BAD KEY": ["x"] };
    expect(validateMenuV1(m).valid).toBe(false);
  });

  it("accepts a field-local lang map on a title layer", () => {
    const m = structuredClone(canonicalButton) as Record<string, any>;
    m.title = [{ kind: "plain", value: { en: "Shop", fr: "Boutique" } }];
    expect(validateMenuV1(m).valid).toBe(true);
  });

  it("rejects a lang map with a non-LangCode key", () => {
    const m = structuredClone(canonicalButton) as Record<string, any>;
    m.layers[0].elements[0].title = { en: "Back", "BAD KEY": "x" };
    expect(validateMenuV1(m).valid).toBe(false);
  });

  it("rejects a click with flat actions instead of steps", () => {
    const bad = JSON.parse(JSON.stringify(canonicalButton));
    bad.layers[0].elements[0].click.left = { actions: [] };
    expect(validateMenuV1(bad).valid).toBe(false);
  });

  it("accepts an appearance with a custom head", () => {
    const m = structuredClone(canonicalButton) as Record<string, any>;
    const app = m.layers[0].elements[0];
    app.material = "PLAYER_HEAD";
    app.head = "hdb:128276";
    expect(validateMenuV1(m).valid).toBe(true);
  });

  it("rejects a non-string head", () => {
    const m = structuredClone(canonicalButton) as Record<string, any>;
    m.layers[0].elements[0].head = 42;
    expect(validateMenuV1(m).valid).toBe(false);
  });
});

describe("validateMenuV1 inventory_type cross-validation", () => {
  const base = {
    schema: "menu/v1",
    id: "m",
    title: [],
    layers: [
      {
        id: "l",
        name: "L",
        elements: [{ id: "e", positions: "0", material: "STONE" }],
      },
    ],
  };
  it("accepts a chest menu with no inventory_type (back-compat)", () => {
    expect(validateMenuV1({ ...base, size: 27 }).valid).toBe(true);
  });
  it("accepts inventory_type=chest with a multiple-of-9 size", () => {
    expect(validateMenuV1({ ...base, inventory_type: "chest", size: 54 }).valid).toBe(true);
  });
  it("accepts inventory_type=hopper with size 5", () => {
    expect(validateMenuV1({ ...base, inventory_type: "hopper", size: 5 }).valid).toBe(true);
  });
  it("accepts inventory_type=dropper with size 9", () => {
    expect(validateMenuV1({ ...base, inventory_type: "dropper", size: 9 }).valid).toBe(true);
  });
  it("rejects hopper with size 9 (must be 5)", () => {
    expect(validateMenuV1({ ...base, inventory_type: "hopper", size: 9 }).valid).toBe(false);
  });
  it("rejects dropper with size 5", () => {
    expect(validateMenuV1({ ...base, inventory_type: "dropper", size: 5 }).valid).toBe(false);
  });
  it("rejects chest with size 5 (5 only valid for hopper)", () => {
    expect(validateMenuV1({ ...base, size: 5 }).valid).toBe(false);
  });
  it("rejects an unknown inventory_type", () => {
    expect(validateMenuV1({ ...base, inventory_type: "furnace", size: 9 }).valid).toBe(false);
  });
});

describe("validateMenuV1 — structured action wire", () => {
  const withElement = (element: Record<string, unknown>) => ({
    schema: "menu/v1",
    id: "m",
    title: [],
    size: 27,
    layers: [
      {
        id: "l",
        name: "L",
        elements: [{ id: "e", positions: "0", material: "STONE", ...element }],
      },
    ],
  });

  it("accepts a legacy DSL string handler", () => {
    expect(validateMenuV1(withElement({ click: { left: 'send_message "hi"' } })).valid).toBe(true);
  });

  it("accepts the legacy wrapped {steps} handler", () => {
    expect(
      validateMenuV1(withElement({ click: { left: { steps: 'send_message "hi"' } } })).valid,
    ).toBe(true);
  });

  it("accepts keyed scalar, multi-arg, bare string and null actions", () => {
    const left = [
      { send_message: { en: "Hi", fr: "Salut" } },
      { give_money: 100 },
      { run_command: { command: "op", as: "console" } },
      "close_menu",
      { close_dialog: null },
      "open_previous_menu",
      { open_previous_menu: null },
    ];
    expect(validateMenuV1(withElement({ click: { left } })).valid).toBe(true);
  });

  it("accepts a keyed if/else with or/not", () => {
    const left = [
      {
        if: [
          { has_permission: "shop.vip" },
          { or: [{ world_is: "world_nether" }, { time_is: "night" }] },
          { not: { has_permission: "banned" } },
        ],
        do: [{ show_title: { title: { en: "VIP", fr: "VIP" }, stay: 40 } }],
        else: [{ send_message: "No" }],
      },
    ];
    expect(validateMenuV1(withElement({ click: { left } })).valid).toBe(true);
  });

  it("accepts a single action map as a handler (single-step sugar)", () => {
    expect(validateMenuV1(withElement({ click: { left: { send_message: "Hello" } } })).valid).toBe(
      true,
    );
  });

  it("accepts a keyed condition on an appearance if", () => {
    expect(validateMenuV1(withElement({ if: [{ world_is: "world_nether" }] })).valid).toBe(true);
  });

  it("rejects an unknown action verb", () => {
    expect(validateMenuV1(withElement({ click: { left: [{ teleport_all: true }] } })).valid).toBe(
      false,
    );
  });
});
