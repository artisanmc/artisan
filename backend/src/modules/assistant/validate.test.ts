import { describe, expect, it } from "bun:test";
import { validateMenuV1 } from "./validate";

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

  it("rejects a schema-valid action outside the subset (give_xp)", () => {
    const r = validateMenuV1(withClickSteps([
      { kind: "action", action: { type: "give_xp", amount: 10 } },
    ]));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/give_xp/);
    expect(r.errors.join(" ")).toMatch(/vocabulary/i);
  });

  it("rejects a schema-valid condition outside the subset (world_is) in appearance if", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "0", appearances: [
        { if: [{ type: "world_is", world: "spawn" }], material: "STONE" },
        { material: "STONE" },
      ] }] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/world_is/);
  });

  it("rejects out-of-subset types nested in composites and if-steps", () => {
    const r = validateMenuV1(withClickSteps([
      {
        kind: "if",
        cases: [{
          conditions: [{ type: "and", of: [
            { type: "has_permission", perm: "x" },
            { type: "has_item", material: "DIAMOND", count: 1 },
          ] }],
          steps: [{ kind: "action", action: { type: "close_menu" } }],
        }],
        else: [{ kind: "action", action: { type: "play_sound", sound: "CLICK" } }],
      },
    ]));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/has_item/);
    expect(r.errors.join(" ")).toMatch(/play_sound/);
  });

  it("rejects out-of-subset types in open_requirements / open_actions / close_actions", () => {
    const r = validateMenuV1({
      ...good,
      open_requirements: [{ type: "time_is", range: "day" }],
      open_actions: [{ type: "broadcast", text: "hi" }],
      close_actions: [{ type: "teleport", world: "spawn", x: 0, y: 64, z: 0 }],
    });
    expect(r.valid).toBe(false);
    const all = r.errors.join(" ");
    expect(all).toMatch(/time_is/);
    expect(all).toMatch(/broadcast/);
    expect(all).toMatch(/teleport/);
  });

  it("accepts every subset action and condition (expression, set_arg, pagination, dialogs…)", () => {
    const r = validateMenuV1({
      ...good,
      open_requirements: [{ type: "expression", expr: "balance >= 100" }],
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
