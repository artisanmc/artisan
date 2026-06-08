import { describe, expect, it } from "vitest";
import { packId } from "@/domain/ids";
import { menuV1ToDomain } from "./menuV1ToDomain";

const opts = { packId: packId("p"), lang: "en" };

describe("menuV1ToDomain — i18n + conditions", () => {
  it("allocates a fresh key for literal text and stores the value", () => {
    const src = minimalMenu({ appTitle: "Shop" });
    const r = menuV1ToDomain(src, opts);
    const app = r.menu.layers[0]!.elements[0]!.appearances[0]!;
    const key = app.title!.key;
    expect(r.i18nKeys[key]).toEqual({ en: "Shop" });
  });

  it("references an existing {i18n:KEY} without allocating", () => {
    const src = minimalMenu({ appTitle: "{i18n:menus.x.title}" });
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.layers[0]!.elements[0]!.appearances[0]!.title!.key).toBe("menus.x.title");
    expect(Object.keys(r.i18nKeys)).toHaveLength(0);
  });

  it("copies translation for {i18n:KEY} when provided", () => {
    const src = minimalMenu({ appTitle: "{i18n:menus.x.title}" });
    const r = menuV1ToDomain(src, {
      ...opts,
      translations: { "menus.x.title": { en: "Shop", fr: "Boutique" } },
    });
    expect(r.i18nKeys["menus.x.title"]).toEqual({ en: "Shop", fr: "Boutique" });
  });

  it("maps and/or with of, preserving 'of'", () => {
    const src = minimalMenu({
      if: [
        {
          type: "and",
          of: [
            { type: "has_permission", perm: "vip" },
            { type: "has_money", amount: 100 },
          ],
        },
      ],
    });
    const r = menuV1ToDomain(src, opts);
    const cond = r.menu.layers[0]!.elements[0]!.appearances[0]!.if![0] as {
      type: string;
      of: unknown[];
    };
    expect(cond.type).toBe("and");
    expect(cond.of).toHaveLength(2);
  });

  it("drops fields the domain condition type does not carry (has_money currency)", () => {
    const src = minimalMenu({
      if: [{ type: "has_money", amount: 50, currency: "tokens" }],
    });
    const r = menuV1ToDomain(src, opts);
    const cond = r.menu.layers[0]!.elements[0]!.appearances[0]!.if![0] as Record<string, unknown>;
    expect(cond).toEqual({ type: "has_money", amount: 50 });
  });

  it("maps not to the domain shape", () => {
    const src = minimalMenu({
      if: [{ type: "not", of: { type: "has_permission", perm: "vip" } }],
    });
    const r = menuV1ToDomain(src, opts);
    const cond = r.menu.layers[0]!.elements[0]!.appearances[0]!.if![0] as {
      type: string;
      of: { type: string; perm: string };
    };
    expect(cond.type).toBe("not");
    expect(cond.of).toEqual({ type: "has_permission", perm: "vip" });
  });

  it("maps placeholder_equals / placeholder_match / expression explicitly", () => {
    const src = minimalMenu({
      if: [
        { type: "placeholder_equals", placeholder: "%foo%", value: "bar", extra: "x" },
        { type: "placeholder_match", placeholder: "%foo%", regex: "b.*", extra: "x" },
        { type: "expression", expr: "1 == 1", extra: "x" },
      ],
    });
    const r = menuV1ToDomain(src, opts);
    const ifs = r.menu.layers[0]!.elements[0]!.appearances[0]!.if! as Record<string, unknown>[];
    expect(ifs[0]).toEqual({ type: "placeholder_equals", placeholder: "%foo%", value: "bar" });
    expect(ifs[1]).toEqual({ type: "placeholder_match", placeholder: "%foo%", regex: "b.*" });
    expect(ifs[2]).toEqual({ type: "expression", expr: "1 == 1" });
  });

  it("sets ifJoins to all 'and' for a multi-condition appearance if", () => {
    const src = minimalMenu({
      if: [
        { type: "has_permission", perm: "a" },
        { type: "has_permission", perm: "b" },
        { type: "has_permission", perm: "c" },
      ],
    });
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.layers[0]!.elements[0]!.appearances[0]!.ifJoins).toEqual(["and", "and"]);
  });

  it("flags unsupported conditions instead of crashing", () => {
    const src = minimalMenu({ if: [{ type: "has_item", material: "DIRT", count: 1 }] });
    const r = menuV1ToDomain(src, opts);
    expect(r.unsupported.join(" ")).toMatch(/has_item/);
  });
});

function minimalMenu(p: { appTitle?: string; if?: unknown[] }): Record<string, unknown> {
  const appearance: Record<string, unknown> = {};
  if (p.appTitle) appearance.title = p.appTitle;
  if (p.if) appearance.if = p.if;
  appearance.material = "STONE";
  return {
    schema: "menu/v1",
    id: "shop",
    title: [],
    size: 27,
    layers: [
      {
        id: "l1",
        name: "default",
        elements: [{ id: "e1", positions: "0", appearances: [appearance] }],
      },
    ],
  };
}
