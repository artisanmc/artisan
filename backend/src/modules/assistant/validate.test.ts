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
  const withClickSteps = (steps: unknown[]) => ({
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

  it("rejects expression conditions nested in composites and if-steps", () => {
    const r = validateMenuV1(withClickSteps([
      {
        kind: "if",
        cases: [{
          conditions: [{ type: "and", of: [
            { type: "has_permission", perm: "x" },
            { type: "expression", expr: "1 == 1" },
          ] }],
          steps: [{ kind: "action", action: { type: "close_menu" } }],
        }],
        else: [{ kind: "if", cases: [{
          conditions: [{ type: "expression", expr: "x > 0" }],
          steps: [],
        }] }],
      },
    ]));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/expression/);
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
            { kind: "action", action: { type: "broadcast", text: "hi all" } },
            { kind: "action", action: { type: "play_sound", sound: "ENTITY_PLAYER_LEVELUP", volume: 1, pitch: 1 } },
            { kind: "action", action: { type: "give_money", amount: 10 } },
            { kind: "action", action: { type: "give_xp", amount: 5 } },
            { kind: "action", action: { type: "give_level", amount: 1 } },
            { kind: "action", action: { type: "take_item", material: "PAPER", count: 1 } },
            { kind: "action", action: { type: "teleport", world: "spawn", x: 0, y: 64, z: 0 } },
          ] } },
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
      open_actions: [{ type: "send_message", text: "hi" }],
      close_actions: [{ type: "close_menu" }],
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
            { kind: "if",
              cases: [{ conditions: [{ type: "placeholder_match", placeholder: "%n%", regex: "^a" }],
                steps: [
                  { kind: "action", action: { type: "set_arg", arg: "cat", value: "tools" } },
                  { kind: "action", action: { type: "set_arg_cycle_next", arg: "sort", list: "price,name" } },
                  { kind: "action", action: { type: "set_arg_cycle_prev", arg: "sort", list: "price,name" } },
                  { kind: "action", action: { type: "pagination_next" } },
                  { kind: "action", action: { type: "pagination_prev" } },
                  { kind: "action", action: { type: "open_dialog", dialog_id: "confirm" } },
                  { kind: "action", action: { type: "close_dialog" } },
                  { kind: "action", action: { type: "show_title", title: "<gold>Hi</gold>" } },
                  { kind: "action", action: { type: "give_item", material: "DIAMOND", count: 1 } },
                  { kind: "action", action: { type: "take_money", amount: 5 } },
                  { kind: "action", action: { type: "run_command", command: "spawn" } },
                  { kind: "action", action: { type: "open_menu", menu_id: "shop" } },
                  { kind: "action", action: { type: "send_message", text: "ok" } },
                  { kind: "action", action: { type: "close_menu" } },
                ] }],
            },
          ] } },
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
      steps: [{ kind: "action", action: { type: "close_menu" } }],
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an out-of-vocabulary action inside a step", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "c", name: "c",
      steps: [{ kind: "action", action: { type: "launch_nukes" } }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/launch_nukes/);
  });

  it("rejects a structurally invalid command (missing name)", () => {
    const r = validateCommandV1({ schema: "command/v1", id: "c", steps: [{ kind: "action", action: { type: "close_menu" } }] });
    expect(r.valid).toBe(false);
  });

  it("rejects an out-of-vocab condition in requirements", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "c", name: "c",
      requirements: [{ type: "moon_phase" }],
      steps: [{ kind: "action", action: { type: "close_menu" } }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/moon_phase/);
  });
});

describe("validateDialogV1", () => {
  it("accepts a minimal valid dialog", () => {
    const r = validateDialogV1({
      schema: "dialog/v1", id: "d", title: "T",
      buttons: [{ id: "ok", label: "OK", actions: [{ type: "close_dialog" }] }],
    });
    expect(r.valid).toBe(true);
  });

  it("rejects an out-of-vocab action in a button", () => {
    const r = validateDialogV1({
      schema: "dialog/v1", id: "d", title: "T",
      buttons: [{ id: "ok", label: "OK", actions: [{ type: "rm_rf" }] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/rm_rf/);
  });

  it("rejects a dialog with no buttons (schema required)", () => {
    const r = validateDialogV1({ schema: "dialog/v1", id: "d", title: "T" });
    expect(r.valid).toBe(false);
  });
});
