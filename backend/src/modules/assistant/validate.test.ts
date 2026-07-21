import { describe, expect, it } from "bun:test";
import { validateCommandV1, validateDialogV1, validateMenuV1 } from "./validate";

const good = {
  schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "k" } }], size: 27,
  layers: [{ id: "l1", name: "default", elements: [{ id: "e1", positions: "0", appearances: [{ material: "STONE" }] }] }],
};

describe("validateMenuV1 (backend gate)", () => {
  it("accepts a canonical menu", () => {
    expect(validateMenuV1(good)).toEqual({ valid: true, errors: [] });
  });
  it("rejects a bad size (ajv)", () => {
    const r = validateMenuV1({ ...good, size: 13 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/size/);
  });
  it("rejects duplicate element ids (validateMenuLayout)", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [
        { id: "dup", positions: "0", appearances: [{ material: "STONE" }] },
        { id: "dup", positions: "1", appearances: [{ material: "STONE" }] },
      ] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/dup/);
  });
  it("rejects an out-of-bounds position (validateMenuLayout)", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "99", appearances: [{ material: "STONE" }] }] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/bounds|out of/i);
  });
});

// Le schéma complet accepte plus de types que le sous-ensemble importable
// (SUPPORTED_ACTIONS / SUPPORTED_CONDITIONS). Le gate doit tenir la promesse
// du guide : « anything else is rejected ».
describe("validateMenuV1 (vocab subset gate)", () => {
  const withClickSteps = (steps: string) => ({
    ...good,
    layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "0", appearances: [
      { material: "STONE", click: { left: { steps } } },
    ] }] }],
  });

  it("rejects expression conditions (no server-side evaluator yet)", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "0", appearances: [
        { if: [{ type: "expression", expr: "balance >= 100" }], material: "STONE" },
        { material: "STONE" },
      ] }] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/expression/);
    expect(r.errors.join(" ")).toMatch(/vocabulary/i);
  });

  it("rejects free-comparison (expression) conditions inside a DSL click chain", () => {
    // Free comparisons (`balance >= 100`) parse to `{type:"expression"}`, which is
    // outside the subset — no server-side expression evaluator yet.
    const r = validateMenuV1(withClickSteps(
      [
        'if has_permission(x) and balance >= 100:',
        '  close_menu',
        'else if score > 0:',
        '  send_message "hi"',
      ].join("\n"),
    ));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/expression/);
  });

  it("surfaces a DSL parse error as a readable validation error", () => {
    const r = validateMenuV1(withClickSteps("if has_permission(x)\n  close_menu"));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/invalid Action DSL/);
  });

  it("accepts the extended runtime-OK actions and conditions", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "0", appearances: [
        {
          if: [
            { type: "has_item", material: "DIAMOND", count: 1 },
            { type: "world_is", world: "spawn" },
            { type: "time_is", range: { from_ticks: 0, to_ticks: 6000 } },
            { type: "random_chance", probability: 0.25 },
            { type: "cooldown_passed", cooldown_id: "daily" },
            { type: "player_in_region", region: "shop" },
            { type: "has_xp", amount: 5 },
            { type: "has_level", level: 3 },
            { type: "pagination_at_first" },
            { type: "pagination_at_last", element_id: "grid" },
          ],
          material: "STONE",
          click: { left: { steps: [
            'broadcast "hi all"',
            "play_sound ENTITY_PLAYER_LEVELUP vol=1 pitch=1",
            "give_money 10",
            "give_xp 5",
            "give_level 1",
            "take_item PAPER 1",
            "teleport spawn 0 64 0",
          ].join("\n") } },
        },
        { material: "STONE" },
      ] }] }],
    });
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("rejects open_requirements / open_actions / close_actions / background even with subset types (implemented nowhere)", () => {
    const r = validateMenuV1({
      ...good,
      open_requirements: [{ type: "has_permission", perm: "x" }],
      open_actions: 'send_message "hi"',
      close_actions: "close_menu",
      background: { material: "GRAY_STAINED_GLASS_PANE" },
    });
    expect(r.valid).toBe(false);
    const all = r.errors.join(" ");
    expect(all).toMatch(/open_requirements/);
    expect(all).toMatch(/open_actions/);
    expect(all).toMatch(/close_actions/);
    expect(all).toMatch(/background/);
  });

  it("accepts every subset action and condition (set_arg, pagination, dialogs…)", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "0", appearances: [
        {
          if: [
            { type: "not", of: { type: "has_permission", perm: "x" } },
            { type: "or", of: [{ type: "has_money", amount: 1 }, { type: "placeholder_equals", placeholder: "%w%", value: "spawn" }] },
          ],
          material: "STONE",
          click: { left: { steps: [
            'if %n% matches "^a":',
            "  set cat = tools",
            '  cycle next sort in "price,name"',
            '  cycle prev sort in "price,name"',
            "  paginate next",
            "  paginate prev",
            "  open_dialog confirm",
            "  close_dialog",
            '  show_title "<gold>Hi</gold>"',
            "  give_item DIAMOND 1",
            "  take_money 5",
            '  run_command "spawn" as player',
            "  open_menu shop",
            '  send_message "ok"',
            "  close_menu",
          ].join("\n") } },
        },
        { material: "STONE" },
      ] }] }],
    });
    expect(r).toEqual({ valid: true, errors: [] });
  });
});

describe("validateCommandV1", () => {
  it("accepts a minimal valid command", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "heal", name: "heal",
      steps: "close_menu",
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an out-of-vocabulary action inside a step (DSL parse error)", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "c", name: "c",
      steps: "launch_nukes",
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/launch_nukes/);
  });

  it("rejects run_actions (out of the assistant subset) inside a step", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "c", name: "c",
      steps: "run_actions item.on_buy",
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/run_actions/);
    expect(r.errors.join("\n")).toMatch(/vocabulary/i);
  });

  it("rejects a structurally invalid command (missing name)", () => {
    const r = validateCommandV1({ schema: "command/v1", id: "c", steps: "close_menu" });
    expect(r.valid).toBe(false);
  });

  it("rejects an out-of-vocab condition in requirements (structured)", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "c", name: "c",
      requirements: [{ type: "moon_phase" }],
      steps: "close_menu",
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/moon_phase/);
  });

  it("accepts an if/else DSL chain with subset conditions and actions", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "pay", name: "pay",
      requirements: [{ type: "has_money", amount: 1 }],
      steps: [
        "if has_permission(artisan.vip):",
        "  take_money 1",
        '  send_message "<green>Paid.</green>"',
        "else:",
        '  send_message "<red>No perm.</red>"',
      ].join("\n"),
      fallback: [{ type: "send_message", text: "<red>Not enough money.</red>" }],
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe("validateDialogV1", () => {
  it("accepts a minimal valid dialog", () => {
    const r = validateDialogV1({
      schema: "dialog/v1", id: "d", title: "T",
      buttons: [{ id: "ok", label: "OK", actions: "close_dialog" }],
    });
    expect(r.valid).toBe(true);
  });

  it("accepts an if-branch DSL chain in a button", () => {
    const r = validateDialogV1({
      schema: "dialog/v1", id: "d", title: "T",
      buttons: [{ id: "ok", label: "OK", actions: [
        "if has_money(100):",
        "  take_money 100",
        "close_dialog",
      ].join("\n") }],
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an out-of-vocab action in a button (DSL parse error)", () => {
    const r = validateDialogV1({
      schema: "dialog/v1", id: "d", title: "T",
      buttons: [{ id: "ok", label: "OK", actions: "rm_rf" }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/rm_rf/);
  });

  it("rejects a dialog with no buttons (schema required)", () => {
    const r = validateDialogV1({ schema: "dialog/v1", id: "d", title: "T" });
    expect(r.valid).toBe(false);
  });
});

describe("validators are crash-safe on malformed input", () => {
  it("validateCommandV1 returns invalid (no throw) for type-wrong containers / bad DSL", () => {
    for (const bad of [
      { schema: "command/v1", id: "c", name: "c", steps: "nope" }, // unknown DSL verb
      { schema: "command/v1", id: "c", name: "c", steps: "if has_money(1)\n  close_menu" }, // missing ':'
      { schema: "command/v1", id: "c", name: "c", steps: [] }, // wrong type (array, schema wants string)
      { schema: "command/v1", id: "c", name: "c", steps: "close_menu", requirements: "x" },
      { schema: "command/v1", id: "c", name: "c", steps: "close_menu", requirements: [{ type: "and", of: "x" }] },
      { schema: "command/v1", id: "c", name: "c", steps: "close_menu", fallback: "x" },
    ]) {
      expect(() => validateCommandV1(bad)).not.toThrow();
      expect(validateCommandV1(bad).valid).toBe(false);
    }
  });

  it("validateDialogV1 returns invalid (no throw) for type-wrong containers / bad DSL", () => {
    for (const bad of [
      { schema: "dialog/v1", id: "d", title: "t", buttons: "x" },
      { schema: "dialog/v1", id: "d", title: "t", buttons: [null] },
      { schema: "dialog/v1", id: "d", title: "t", buttons: [{ id: "ok", label: "OK", actions: 42 }] },
      { schema: "dialog/v1", id: "d", title: "t", buttons: [{ id: "ok", label: "OK", actions: "nope_verb" }] },
    ]) {
      expect(() => validateDialogV1(bad)).not.toThrow();
      expect(validateDialogV1(bad).valid).toBe(false);
    }
  });
});
