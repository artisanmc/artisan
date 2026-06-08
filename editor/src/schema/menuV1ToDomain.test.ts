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

describe("menuV1ToDomain — actions + steps", () => {
  it("un-snakes open_menu (menu_id, clear_context, context)", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "open_menu", menu_id: "target", clear_context: true, context: { player: "{player}" } })]), opts);
    const act = clickAction(r);
    expect(act).toEqual({ type: "open_menu", menuId: "target", clearContext: true, context: { player: "{player}" } });
  });

  it("open_menu without clear_context/context omits those keys", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "open_menu", menu_id: "target" })]), opts);
    expect(clickAction(r)).toEqual({ type: "open_menu", menuId: "target" });
  });

  it("send_message maps text string → LText and stores the value", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "send_message", text: "Hello" })]), opts);
    const act = clickAction(r) as { type: string; text: { key: string } };
    expect(act.type).toBe("send_message");
    expect(r.i18nKeys[act.text.key]).toEqual({ en: "Hello" });
  });

  it("show_title un-snakes fade_in/stay/fade_out and maps title/subtitle to LText", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "show_title", title: "T", subtitle: "S", fade_in: 5, stay: 10, fade_out: 15 })]), opts);
    const act = clickAction(r) as Record<string, any>;
    expect(act.type).toBe("show_title");
    expect(act.fadeIn).toBe(5);
    expect(act.stay).toBe(10);
    expect(act.fadeOut).toBe(15);
    expect(r.i18nKeys[act.title.key]).toEqual({ en: "T" });
    expect(r.i18nKeys[act.subtitle.key]).toEqual({ en: "S" });
  });

  it("run_command defaults as to player when absent", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "run_command", command: "say hi" })]), opts);
    expect(clickAction(r)).toEqual({ type: "run_command", command: "say hi", as: "player" });
  });

  it("pagination_next → paginate{direction:'next', targetElementId?}", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "pagination_next", element_id: "grid" })]), opts);
    expect(clickAction(r)).toEqual({ type: "paginate", direction: "next", targetElementId: "grid" });
  });

  it("pagination_prev without element_id omits targetElementId", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "pagination_prev" })]), opts);
    expect(clickAction(r)).toEqual({ type: "paginate", direction: "prev" });
  });

  it("set_arg passes arg/value through", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "set_arg", arg: "page", value: "2" })]), opts);
    expect(clickAction(r)).toEqual({ type: "set_arg", arg: "page", value: "2" });
  });

  it("open_dialog un-snakes dialog_id", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "open_dialog", dialog_id: "confirm" })]), opts);
    expect(clickAction(r)).toEqual({ type: "open_dialog", dialogId: "confirm" });
  });

  it("round-trips an if-step (cases + else)", () => {
    const step = {
      kind: "if",
      cases: [
        {
          conditions: [{ type: "has_permission", perm: "vip" }],
          steps: [actionStep({ type: "close_menu" })],
        },
      ],
      else: [actionStep({ type: "run_command", command: "say no", as: "console" })],
    };
    const r = menuV1ToDomain(menuWithClick("left", [step]), opts);
    const steps = clickSteps(r) as any[];
    expect(steps[0].kind).toBe("if");
    expect(steps[0].cases[0].conditions[0]).toEqual({ type: "has_permission", perm: "vip" });
    expect(steps[0].cases[0].steps[0]).toEqual({ kind: "action", action: { type: "close_menu" } });
    expect(steps[0].else[0]).toEqual({ kind: "action", action: { type: "run_command", command: "say no", as: "console" } });
  });

  it("flags unsupported action (give_money) and drops it", () => {
    const r = menuV1ToDomain(menuWithClick("left", [actionStep({ type: "give_money", amount: 100 })]), opts);
    expect(r.unsupported.join(" ")).toMatch(/give_money/);
    expect(clickSteps(r)).toHaveLength(0);
  });
});

function actionStep(action: Record<string, unknown>): Record<string, unknown> {
  return { kind: "action", action };
}

function menuWithClick(clickType: string, steps: unknown[]): Record<string, unknown> {
  return {
    schema: "menu/v1",
    id: "shop",
    title: [],
    size: 27,
    layers: [
      {
        id: "l1",
        name: "default",
        elements: [
          {
            id: "e1",
            positions: "0",
            appearances: [{ material: "STONE", click: { [clickType]: { steps } } }],
          },
        ],
      },
    ],
  };
}

function clickSteps(r: ReturnType<typeof menuV1ToDomain>): unknown[] {
  return r.menu.layers[0]!.elements[0]!.appearances[0]!.click!.left!.steps;
}

function clickAction(r: ReturnType<typeof menuV1ToDomain>): unknown {
  const steps = clickSteps(r) as { kind: string; action: unknown }[];
  return steps[0]!.action;
}

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
