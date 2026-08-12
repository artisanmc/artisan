import { projectId } from "@/domain/ids";
import { describe, expect, it } from "vitest";
import { menuV1ToDomain } from "./menuV1ToDomain";

const opts = { projectId: projectId("p"), lang: "en" };

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

  it("flags unknown (future) conditions instead of crashing", () => {
    const src = minimalMenu({ if: [{ type: "biome_is", biome: "PLAINS" }] });
    const r = menuV1ToDomain(src, opts);
    expect(r.unsupported.join(" ")).toMatch(/biome_is/);
  });
});

describe("menuV1ToDomain — actions + steps (Action DSL)", () => {
  it("parses open_menu with clear + context tail", () => {
    const r = menuV1ToDomain(
      menuWithClick("left", 'open_menu target clear with player="{player}"'),
      opts,
    );
    expect(clickAction(r)).toEqual({
      type: "open_menu",
      menuId: "target",
      clearContext: true,
      context: { player: "{player}" },
    });
  });

  it("reads template refs on iterates/places (appearances live in templates/)", () => {
    const r = menuV1ToDomain(
      {
        schema: "menu/v1",
        id: "shop",
        title: [],
        size: 54,
        elements: [
          { id: "grid", positions: "10-43", iterates: { source: "boutique:items", template: "tpl_a" } },
          {
            id: "pins",
            positions: 0,
            places: { source: "boutique:items", template: "tpl_a", placements: [{ key: "sword", page: 0, position: 10 }] },
          },
        ],
      },
      opts,
    );
    const [grid, pins] = r.menu.layers[0]!.elements;
    expect(grid!.appearances).toEqual([]);
    // Wire `template` → domain `templateId`; alias/keyField come from the
    // template at render/export time (empty locally).
    expect(grid!.iterates).toEqual({ source: "boutique:items", alias: "", templateId: "tpl_a" });
    expect(pins!.places).toMatchObject({ source: "boutique:items", templateId: "tpl_a" });
  });

  it("reads the canonical `inputs` field (legacy `context_inputs` alias)", () => {
    const r = menuV1ToDomain(
      {
        schema: "menu/v1",
        id: "shop",
        title: [],
        size: 27,
        inputs: [{ name: "items", type: "list", source: { ref: "boutique:items" } }],
        elements: [],
      },
      opts,
    );
    expect(r.menu.contextInputs).toEqual([
      { kind: "sourceRef", name: "items", ref: "boutique:items" },
    ]);
  });

  it("normalizes positions: bare int, bare range, and list forms", () => {
    const r = menuV1ToDomain(
      {
        schema: "menu/v1",
        id: "shop",
        title: [],
        size: 27,
        elements: [
          { id: "a", positions: 26, appearances: [{ material: "STONE" }] },
          { id: "b", positions: "11-14", appearances: [{ material: "STONE" }] },
          { id: "c", positions: [0, 8, "18-20"], appearances: [{ material: "STONE" }] },
        ],
      },
      opts,
    );
    const els = r.menu.layers[0]!.elements;
    expect(els.map((e) => e.positions)).toEqual(["26", "11-14", "0,8,18-20"]);
  });

  it("accepts a bare-string title (sugar for one plain layer)", () => {
    const r = menuV1ToDomain(
      { schema: "menu/v1", id: "shop", title: "{i18n:menus.shop.title}", size: 27, elements: [] },
      opts,
    );
    expect(r.menu.title).toEqual([{ kind: "plain", value: { key: "menus.shop.title" } }]);
  });

  it("accepts a literal bare-string title (mints a key)", () => {
    const r = menuV1ToDomain(
      { schema: "menu/v1", id: "shop", title: "Boutique", size: 27, elements: [] },
      opts,
    );
    const layer = r.menu.title[0]!;
    expect(layer.kind).toBe("plain");
    const key = (layer as { value: { key: string } }).value.key;
    expect(r.i18nKeys[key]).toEqual({ en: "Boutique" });
  });

  it("accepts string entries and string `value` inside a title layer array", () => {
    const r = menuV1ToDomain(
      {
        schema: "menu/v1",
        id: "shop",
        title: [
          "{i18n:menus.shop.line1}",
          { kind: "text", value: "{i18n:menus.shop.line2}", x: 8, y: 5 },
        ],
        size: 27,
        elements: [],
      },
      opts,
    );
    expect(r.menu.title).toEqual([
      { kind: "plain", value: { key: "menus.shop.line1" } },
      { kind: "text", value: { key: "menus.shop.line2" }, x: 8, y: 5 },
    ]);
  });

  it("accepts flat top-level `elements` (canonical form, no layers)", () => {
    const r = menuV1ToDomain(
      {
        schema: "menu/v1",
        id: "shop",
        title: [],
        size: 27,
        elements: [
          { id: "a", positions: "0", appearances: [{ material: "STONE" }] },
          { id: "b", positions: "1", appearances: [{ material: "DIRT" }] },
        ],
      },
      opts,
    );
    expect(r.menu.layers).toHaveLength(1);
    expect(r.menu.layers[0]!.elements.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("accepts a click handler as a bare DSL string (canonical collapsed form)", () => {
    const menu = menuWithClick("left", "close_menu");
    const el = (menu.layers as any[])[0].elements[0];
    el.appearances[0].click = { left: "close_menu" };
    const r = menuV1ToDomain(menu, opts);
    expect(clickAction(r)).toEqual({ type: "close_menu" });
  });

  it("open_menu without clear/context omits those keys", () => {
    const r = menuV1ToDomain(menuWithClick("left", "open_menu target"), opts);
    expect(clickAction(r)).toEqual({ type: "open_menu", menuId: "target" });
  });

  it("send_message literal mints an LText and stores the value", () => {
    const r = menuV1ToDomain(menuWithClick("left", 'send_message "Hello"'), opts);
    const act = clickAction(r) as { type: string; text: { key: string } };
    expect(act.type).toBe("send_message");
    expect(r.i18nKeys[act.text.key]).toEqual({ en: "Hello" });
  });

  it("send_message @key references an existing i18n key (no mint)", () => {
    const r = menuV1ToDomain(menuWithClick("left", "send_message @menus.x.msg"), opts);
    const act = clickAction(r) as { type: string; text: { key: string } };
    expect(act.text.key).toBe("menus.x.msg");
  });

  it("show_title carries timings and mints title/subtitle literals", () => {
    const r = menuV1ToDomain(
      menuWithClick("left", 'show_title "T" "S" fadeIn=5 stay=10 fadeOut=15'),
      opts,
    );
    const act = clickAction(r) as {
      type: string;
      title: { key: string };
      subtitle: { key: string };
      fadeIn: number;
      stay: number;
      fadeOut: number;
    };
    expect(act.type).toBe("show_title");
    expect(act.fadeIn).toBe(5);
    expect(act.stay).toBe(10);
    expect(act.fadeOut).toBe(15);
    expect(r.i18nKeys[act.title.key]).toEqual({ en: "T" });
    expect(r.i18nKeys[act.subtitle.key]).toEqual({ en: "S" });
  });

  it("parses run_command with an explicit as target", () => {
    const r = menuV1ToDomain(menuWithClick("left", 'run_command "say hi" as player'), opts);
    expect(clickAction(r)).toEqual({ type: "run_command", command: "say hi", as: "player" });
  });

  it("paginate next with target element", () => {
    const r = menuV1ToDomain(menuWithClick("left", "paginate next grid"), opts);
    expect(clickAction(r)).toEqual({
      type: "paginate",
      direction: "next",
      targetElementId: "grid",
    });
  });

  it("paginate prev without target omits targetElementId", () => {
    const r = menuV1ToDomain(menuWithClick("left", "paginate prev"), opts);
    expect(clickAction(r)).toEqual({ type: "paginate", direction: "prev" });
  });

  it("set arg = value passes through", () => {
    const r = menuV1ToDomain(menuWithClick("left", "set page = 2"), opts);
    expect(clickAction(r)).toEqual({ type: "set_arg", arg: "page", value: "2" });
  });

  it("open_dialog with a bare id", () => {
    const r = menuV1ToDomain(menuWithClick("left", "open_dialog confirm"), opts);
    expect(clickAction(r)).toEqual({ type: "open_dialog", dialogId: "confirm" });
  });

  it("round-trips an if-step (cases + else)", () => {
    const dsl = 'if has_permission(vip):\n  close_menu\nelse:\n  run_command "say no" as console';
    const r = menuV1ToDomain(menuWithClick("left", dsl), opts);
    // biome-ignore lint/suspicious/noExplicitAny: deep structural read of an if-step
    const steps = clickSteps(r) as Array<Record<string, any>>;
    expect(steps[0]!.kind).toBe("if");
    expect(steps[0]!.cases[0].conditions[0]).toEqual({ type: "has_permission", perm: "vip" });
    expect(steps[0]!.cases[0].steps[0]).toEqual({ kind: "action", action: { type: "close_menu" } });
    expect(steps[0]!.else[0]).toEqual({
      kind: "action",
      action: { type: "run_command", command: "say no", as: "console" },
    });
  });

  it("flags an unknown (future) verb and drops the chain", () => {
    const r = menuV1ToDomain(menuWithClick("left", "give_effect SPEED"), opts);
    expect(r.unsupported.join(" ")).toMatch(/give_effect/);
    expect(clickSteps(r)).toHaveLength(0);
  });

  it("flags a malformed action (teleport missing operands) and drops the chain", () => {
    const r = menuV1ToDomain(menuWithClick("left", "teleport"), opts);
    expect(r.unsupported.length).toBeGreaterThan(0);
    expect(clickSteps(r)).toHaveLength(0);
  });
});

describe("menuV1ToDomain — title layers + menu assembly", () => {
  it("maps size to rows (27 → 3)", () => {
    const r = menuV1ToDomain({ schema: "menu/v1", id: "s", title: [], size: 27, layers: [] }, opts);
    expect(r.menu.rows).toBe(3);
  });

  it("un-snakes background/glyph title layers", () => {
    const src = {
      schema: "menu/v1",
      id: "s",
      size: 27,
      layers: [],
      title: [
        { kind: "background", asset_id: "bg" },
        { kind: "glyph", asset_id: "g", x: 4, y: 6 },
      ],
    };
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.title[0]).toEqual({ kind: "background", assetId: "bg" });
    expect(r.menu.title[1]).toEqual({ kind: "glyph", assetId: "g", x: 4, y: 6 });
  });

  it("un-snakes text title layer and references value.key (no allocation)", () => {
    const src = {
      schema: "menu/v1",
      id: "s",
      size: 27,
      layers: [],
      title: [
        {
          kind: "text",
          value: { key: "menus.s.t" },
          x: 8,
          y: 5,
          color: "#fff",
          font_asset_id: "f",
          size: 16,
        },
      ],
    };
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.title[0]).toEqual({
      kind: "text",
      value: { key: "menus.s.t" },
      x: 8,
      y: 5,
      color: "#fff",
      fontAssetId: "f",
      size: 16,
    });
    expect(Object.keys(r.i18nKeys)).toHaveLength(0);
  });

  it("un-snakes textarea title layer (line_height → lineHeight)", () => {
    const src = {
      schema: "menu/v1",
      id: "s",
      size: 27,
      layers: [],
      title: [
        {
          kind: "textarea",
          value: { key: "k" },
          x: 0,
          y: 0,
          width: 168,
          line_height: 10,
          alignment: "center",
          font_asset_id: "f",
          size: 12,
        },
      ],
    };
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.title[0]).toEqual({
      kind: "textarea",
      value: { key: "k" },
      x: 0,
      y: 0,
      width: 168,
      lineHeight: 10,
      alignment: "center",
      fontAssetId: "f",
      size: 12,
    });
  });

  it("un-snakes external_glyph title layer (glyph_name → glyphName)", () => {
    const src = {
      schema: "menu/v1",
      id: "s",
      size: 27,
      layers: [],
      title: [{ kind: "external_glyph", provider: "nexo", glyph_name: "icon", x: 2, y: 3 }],
    };
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.title[0]).toEqual({
      kind: "external_glyph",
      provider: "nexo",
      glyphName: "icon",
      x: 2,
      y: 3,
    });
  });

  it("maps plain title layer", () => {
    const src = {
      schema: "menu/v1",
      id: "s",
      size: 27,
      layers: [],
      title: [{ kind: "plain", value: { key: "k" }, color: "#abc" }],
    };
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.title[0]).toEqual({ kind: "plain", value: { key: "k" }, color: "#abc" });
  });

  it("maps context_inputs to contextInputs (primitive + sourceRef)", () => {
    const src = {
      schema: "menu/v1",
      id: "s",
      size: 27,
      layers: [],
      title: [],
      context_inputs: [
        { name: "page", type: "integer", default: "0" },
        { name: "items", ref: "pack:shop" },
      ],
    };
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.contextInputs).toEqual([
      { kind: "primitive", name: "page", type: "integer", default: "0" },
      { kind: "sourceRef", name: "items", ref: "pack:shop" },
    ]);
  });

  it("maps a single literal lore line to an LText", () => {
    const src = menuWithAppearance({ material: "STONE", lore: ["A line"] });
    const r = menuV1ToDomain(src, opts);
    const lore = r.menu.layers[0]!.elements[0]!.appearances[0]!.lore!;
    expect(r.i18nKeys[lore.key]).toEqual({ en: "A line" });
  });

  it("joins multi-line literal lore with newlines into one LText", () => {
    const src = menuWithAppearance({ material: "STONE", lore: ["L1", "L2"] });
    const r = menuV1ToDomain(src, opts);
    const lore = r.menu.layers[0]!.elements[0]!.appearances[0]!.lore!;
    expect(r.i18nKeys[lore.key]).toEqual({ en: "L1\nL2" });
  });

  it("references a single {i18n:} lore line without allocating", () => {
    const src = menuWithAppearance({ material: "STONE", lore: ["{i18n:menus.s.lore}"] });
    const r = menuV1ToDomain(src, opts);
    const lore = r.menu.layers[0]!.elements[0]!.appearances[0]!.lore!;
    expect(lore.key).toBe("menus.s.lore");
    expect(Object.keys(r.i18nKeys)).toHaveLength(0);
  });

  it("leaves lore undefined when absent", () => {
    const src = menuWithAppearance({ material: "STONE" });
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.layers[0]!.elements[0]!.appearances[0]!.lore).toBeUndefined();
  });

  it("imports appearance.head", () => {
    const src = menuWithAppearance({ material: "PLAYER_HEAD", head: "hdb:128276" });
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.layers[0]!.elements[0]!.appearances[0]!.head).toBe("hdb:128276");
  });

  it("carries permission and element iterates/tags through", () => {
    const src = {
      schema: "menu/v1",
      id: "s",
      size: 54,
      permission: "menu.use",
      title: [],
      layers: [
        {
          id: "l1",
          name: "main",
          elements: [
            {
              id: "grid",
              positions: "0-8",
              iterates: { source: "items", alias: "item" },
              tags: ["a"],
              appearances: [{ material: "STONE" }],
            },
          ],
        },
      ],
    };
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.permission).toBe("menu.use");
    expect(r.menu.rows).toBe(6);
    expect(r.menu.layers[0]!.elements[0]!.iterates).toEqual({ source: "items", alias: "item" });
    expect(r.menu.layers[0]!.elements[0]!.tags).toEqual(["a"]);
  });
});

function menuWithAppearance(appearance: Record<string, unknown>): Record<string, unknown> {
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

function menuWithClick(clickType: string, steps: string): Record<string, unknown> {
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

describe("menuV1ToDomain — context inputs", () => {
  const withInputs = (context_inputs: unknown[]) => ({
    ...minimalMenu({}),
    context_inputs,
  });

  it("imports the canonical connector shape {name, type, source:{ref}}", () => {
    const r = menuV1ToDomain(
      withInputs([{ name: "items", type: "list", source: { ref: "pack:shop_items" } }]),
      opts,
    );
    expect(r.menu.contextInputs).toEqual([
      { kind: "sourceRef", name: "items", ref: "pack:shop_items" },
    ]);
    expect(r.unsupported).toEqual([]);
  });

  it("still accepts the legacy flat {name, ref} connector shape", () => {
    const r = menuV1ToDomain(withInputs([{ name: "items", ref: "pack:shop_items" }]), opts);
    expect(r.menu.contextInputs).toEqual([
      { kind: "sourceRef", name: "items", ref: "pack:shop_items" },
    ]);
  });

  it("preserves caller-provided list/object primitive inputs (iterates pattern)", () => {
    const r = menuV1ToDomain(
      withInputs([
        { name: "shops", type: "list" },
        { name: "profile", type: "object" },
      ]),
      opts,
    );
    expect(r.menu.contextInputs).toEqual([
      { kind: "primitive", name: "shops", type: "list" },
      { kind: "primitive", name: "profile", type: "object" },
    ]);
  });
});

describe("menuV1ToDomain — pagination_at_first / pagination_at_last", () => {
  it("imports pagination_at_first / pagination_at_last", () => {
    const src = minimalMenu({
      if: [
        { type: "pagination_at_first", element_id: "grid" },
        { type: "pagination_at_last" },
      ],
    });
    const r = menuV1ToDomain(src, opts);
    expect(r.unsupported).toEqual([]);
    expect(r.menu.layers[0]!.elements[0]!.appearances[0]!.if).toEqual([
      { type: "pagination_at_first", elementId: "grid" },
      { type: "pagination_at_last" },
    ]);
  });
});

describe("menuV1ToDomain — extended runtime-OK vocab", () => {
  it("imports the extended conditions without unsupported markers", () => {
    const src = minimalMenu({
      if: [
        { type: "has_item", material: "DIAMOND", count: 3 },
        { type: "has_xp", amount: 10 },
        { type: "has_level", level: 5 },
        { type: "world_is", world: "spawn" },
        { type: "time_is", range: "day" },
        { type: "time_is", range: { from_ticks: 0, to_ticks: 6000 } },
        { type: "random_chance", probability: 0.5 },
        { type: "cooldown_passed", cooldown_id: "daily" },
        { type: "player_in_region", region: "shop_zone" },
      ],
    });
    const r = menuV1ToDomain(src, opts);
    expect(r.unsupported).toEqual([]);
    const ifs = r.menu.layers[0]!.elements[0]!.appearances[0]!.if!;
    expect(ifs).toHaveLength(9);
    expect(ifs[0]).toEqual({ type: "has_item", material: "DIAMOND", count: 3 });
    expect(ifs[5]).toEqual({ type: "time_is", range: { from_ticks: 0, to_ticks: 6000 } });
    expect(ifs[7]).toEqual({ type: "cooldown_passed", cooldown_id: "daily" });
  });

  it("imports the extended actions without unsupported markers", () => {
    const dsl = [
      'broadcast "<gold>Big news!</gold>"',
      "play_sound ENTITY_PLAYER_LEVELUP vol=0.5 pitch=1.2",
      "give_money 250",
      "give_xp 10",
      "give_level 1",
      "take_item PAPER 2",
      "teleport spawn 0.5 64 0.5 yaw=90 pitch=0",
    ].join("\n");
    const src = {
      ...minimalMenu({}),
      layers: [
        {
          id: "l1",
          name: "d",
          elements: [
            {
              id: "e1",
              positions: "0",
              appearances: [{ material: "STONE", click: { left: { steps: dsl } } }],
            },
          ],
        },
      ],
    };
    const r = menuV1ToDomain(src, opts);
    expect(r.unsupported).toEqual([]);
    const steps = r.menu.layers[0]!.elements[0]!.appearances[0]!.click!.left!.steps;
    expect(steps).toHaveLength(7);
    const bc = steps[0] as { kind: "action"; action: { type: string; text: { key: string } } };
    expect(bc.action.type).toBe("broadcast");
    expect(r.i18nKeys[bc.action.text.key]).toEqual({ en: "<gold>Big news!</gold>" });
    expect((steps[1] as { action: unknown }).action).toEqual({
      type: "play_sound", sound: "ENTITY_PLAYER_LEVELUP", volume: 0.5, pitch: 1.2,
    });
    expect((steps[6] as { action: unknown }).action).toEqual({
      type: "teleport", world: "spawn", x: 0.5, y: 64, z: 0.5, yaw: 90, pitch: 0,
    });
  });
});

describe("menuV1ToDomain inventory_type", () => {
  it("defaults to chest (undefined) when inventory_type is absent; rows = size/9", () => {
    const { menu } = menuV1ToDomain(
      {
        schema: "menu/v1",
        id: "m",
        title: [],
        size: 27,
        layers: [{ id: "l", name: "L", elements: [] }],
      },
      opts,
    );
    expect(menu.inventoryType).toBeUndefined();
    expect(menu.rows).toBe(3);
  });
  it("reads inventory_type=hopper; rows defaults to 1", () => {
    const { menu } = menuV1ToDomain(
      {
        schema: "menu/v1",
        id: "m",
        title: [],
        inventory_type: "hopper",
        size: 5,
        layers: [{ id: "l", name: "L", elements: [] }],
      },
      opts,
    );
    expect(menu.inventoryType).toBe("hopper");
    expect(menu.rows).toBe(1);
  });
  it("reads inventory_type=dropper; rows defaults to 3", () => {
    const { menu } = menuV1ToDomain(
      {
        schema: "menu/v1",
        id: "m",
        title: [],
        inventory_type: "dropper",
        size: 9,
        layers: [{ id: "l", name: "L", elements: [] }],
      },
      opts,
    );
    expect(menu.inventoryType).toBe("dropper");
    expect(menu.rows).toBe(3);
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

// `title` has two sugar forms that are not arrays: the bare string, and its
// i18n twin — an LText ref, which is what a module bootstrap emits when the
// text lives in a lang file. Mapping over the ref threw and took the editor
// down with a black page (Boutique menus, 2026-08-12).
describe("title sugar — non-array forms", () => {
  const base = { schema: "menu/v1", id: "m", size: 27 };

  it("reads an LText ref title as one plain layer", () => {
    const { menu } = menuV1ToDomain(
      { ...base, title: { key: "boutique.shop_main.title" } } as never,
      { projectId: "p" as never, lang: "fr", translations: {} },
    );
    expect(menu.title).toEqual([{ kind: "plain", value: { key: "boutique.shop_main.title" } }]);
  });

  it("still reads the bare-string form", () => {
    const { menu } = menuV1ToDomain(
      { ...base, title: "Boutique" } as never,
      { projectId: "p" as never, lang: "fr", translations: {} },
    );
    expect(menu.title).toHaveLength(1);
    expect(menu.title[0]!.kind).toBe("plain");
  });
});
