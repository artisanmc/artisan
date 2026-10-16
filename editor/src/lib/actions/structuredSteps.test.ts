import type { Condition, I18nKey, LText, Step } from "@/domain/types";
import { describe, expect, it } from "vitest";
import {
  type ActionTextCodec,
  conditionToStructured,
  conditionsToStructured,
  stepsToStructured,
  structuredToSteps,
} from "./structuredSteps";

const values: Record<string, Record<string, string>> = {
  m1: { en: "Hi", fr: "Salut" },
  m2: { en: "Title", fr: "Titre" },
};
let counter = 0;
const codec: ActionTextCodec = {
  toWire: (key) => values[key] ?? "",
  fromWire: (raw) => {
    const key = `k${counter++}` as I18nKey;
    values[key] = typeof raw === "string" ? { en: raw } : raw;
    return { key } as LText;
  },
};

/** Domain → wire → domain → wire must be stable (text values preserved). */
function roundTrip(steps: Step[]) {
  const wire = stepsToStructured(steps, codec);
  const back = structuredToSteps(wire, codec);
  return { wire, back, wire2: stepsToStructured(back, codec) };
}

describe("structuredSteps — actions", () => {
  it("encodes scalar, null and multi-arg actions", () => {
    const steps: Step[] = [
      { kind: "action", action: { name: "send_message", value: { key: "m1" as I18nKey } } },
      { kind: "action", action: { name: "close_menu", value: null } },
      { kind: "action", action: { name: "open_previous_menu", value: null } },
      { kind: "action", action: { name: "give_money", value: 100 } },
      { kind: "action", action: { name: "run_command", value: "say hi" } },
      { kind: "action", action: { name: "run_command", value: { command: "op", as: "console" } } },
      { kind: "action", action: { name: "open_menu", value: "shop" } },
      {
        kind: "action",
        action: { name: "open_menu", value: { menu_id: "shop", context: { cat: "{cat.id}" } } },
      },
      {
        kind: "action",
        action: { name: "show_title", value: { title: { key: "m2" as I18nKey }, stay: 40 } },
      },
    ];
    expect(stepsToStructured(steps, codec)).toEqual([
      { send_message: { en: "Hi", fr: "Salut" } },
      "close_menu",
      "open_previous_menu",
      { give_money: 100 },
      { run_command: "say hi" },
      { run_command: { command: "op", as: "console" } },
      { open_menu: "shop" },
      { open_menu: { menu_id: "shop", context: { cat: "{cat.id}" } } },
      { show_title: { title: { en: "Title", fr: "Titre" }, stay: 40 } },
    ]);
  });

  it("round-trips action steps through the wire", () => {
    const steps: Step[] = [
      { kind: "action", action: { name: "send_message", value: { key: "m1" as I18nKey } } },
      {
        kind: "action",
        action: { name: "open_dialog", value: { dialog_id: "confirm", clear_context: true } },
      },
      { kind: "action", action: { name: "play_sound", value: { sound: "PLING", pitch: 1.2 } } },
      {
        kind: "action",
        action: { name: "pagination_next", value: "grid" as never },
      },
    ];
    const { wire, wire2 } = roundTrip(steps);
    expect(wire2).toEqual(wire);
  });
});

describe("structuredSteps — conditions", () => {
  it("encodes and/or/not as explicit nodes", () => {
    const c: Condition = {
      type: "and",
      of: [
        { type: "has_permission", perm: "shop.vip" },
        {
          type: "or",
          of: [
            { type: "world_is", world: "world_nether" },
            { type: "time_is", range: "night" },
          ],
        },
        { type: "not", of: { type: "has_permission", perm: "banned" } },
      ],
    };
    expect(conditionToStructured(c)).toEqual({
      and: [
        { has_permission: "shop.vip" },
        { or: [{ world_is: "world_nether" }, { time_is: "night" }] },
        { not: { has_permission: "banned" } },
      ],
    });
  });

  it("encodes scalar and object conditions", () => {
    expect(conditionToStructured({ type: "random_chance", probability: 0.1 })).toEqual({
      random_chance: 0.1,
    });
    expect(
      conditionToStructured({
        type: "placeholder_equals",
        placeholder: "%rank%",
        value: "vip",
      }),
    ).toEqual({ placeholder_equals: { placeholder: "%rank%", value: "vip" } });
    expect(conditionToStructured({ type: "has_item", material: "DIAMOND", count: 3 })).toEqual({
      has_item: { material: "DIAMOND", count: 3 },
    });
  });
});

describe("structuredSteps — if / else", () => {
  it("encodes else-if recursively and folds it back on decode", () => {
    const steps: Step[] = [
      {
        kind: "if",
        cases: [
          {
            conditions: [{ type: "has_permission", perm: "a" }],
            steps: [{ kind: "action", action: { name: "close_menu", value: null } }],
          },
          {
            conditions: [{ type: "random_chance", probability: 0.1 }],
            steps: [{ kind: "action", action: { name: "open_dialog", value: "d" } }],
          },
        ],
        else: [
          { kind: "action", action: { name: "send_message", value: { key: "m1" as I18nKey } } },
        ],
      },
    ];
    const { wire, back, wire2 } = roundTrip(steps);
    expect(wire).toEqual([
      {
        if: [{ has_permission: "a" }],
        do: ["close_menu"],
        else: [
          {
            if: [{ random_chance: 0.1 }],
            do: [{ open_dialog: "d" }],
            else: [{ send_message: { en: "Hi", fr: "Salut" } }],
          },
        ],
      },
    ]);
    // Decode folds the recursive else back into cases + else (text keys are
    // re-minted, so compare structure not identity).
    const backIf = back[0] as Extract<Step, { kind: "if" }>;
    expect(backIf.cases).toHaveLength(2);
    expect(backIf.else).toHaveLength(1);
    expect(wire2).toEqual(wire);
  });

  it("wraps a pure-OR flat condition list in or:", () => {
    const steps: Step[] = [
      {
        kind: "if",
        cases: [
          {
            conditions: [
              { type: "world_is", world: "a" },
              { type: "world_is", world: "b" },
            ],
            joins: ["or"],
            steps: [{ kind: "action", action: { name: "close_menu", value: null } }],
          },
        ],
      },
    ];
    expect(stepsToStructured(steps, codec)).toEqual([
      { if: [{ or: [{ world_is: "a" }, { world_is: "b" }] }], do: ["close_menu"] },
    ]);
  });
});

describe("structuredSteps — mixed and/or joins", () => {
  const w = (world: string): Condition => ({ type: "world_is", world });

  it("folds left to right: A and B or C → (A and B) or C", () => {
    expect(conditionsToStructured([w("a"), w("b"), w("c")], ["and", "or"])).toEqual([
      { or: [{ and: [{ world_is: "a" }, { world_is: "b" }] }, { world_is: "c" }] },
    ]);
  });

  it("folds left to right: A or B and C → (A or B) and C, AND staying implicit", () => {
    expect(conditionsToStructured([w("a"), w("b"), w("c")], ["or", "and"])).toEqual([
      { or: [{ world_is: "a" }, { world_is: "b" }] },
      { world_is: "c" },
    ]);
  });

  it("evaluates like the plugin's caseMatches for every join and truth combination", () => {
    const evalWire = (node: unknown, truth: Record<string, boolean>): boolean => {
      const [[key, value]] = Object.entries(node as Record<string, unknown>) as [[string, unknown]];
      if (key === "world_is") return truth[value as string]!;
      if (key === "and") return (value as unknown[]).every((n) => evalWire(n, truth));
      if (key === "or") return (value as unknown[]).some((n) => evalWire(n, truth));
      throw new Error(key);
    };
    const names = ["a", "b", "c", "d"];
    for (let j = 0; j < 8; j++) {
      const joins = [0, 1, 2].map((bit) => ((j >> bit) & 1 ? "or" : "and") as "and" | "or");
      const wire = conditionsToStructured(names.map(w), joins);
      for (let t = 0; t < 16; t++) {
        const truth = Object.fromEntries(names.map((n, i) => [n, ((t >> i) & 1) === 1]));
        let expected = truth.a!;
        for (let i = 1; i < 4; i++)
          expected =
            joins[i - 1] === "or" ? expected || truth[names[i]!]! : expected && truth[names[i]!]!;
        expect(wire.every((n) => evalWire(n, truth))).toBe(expected);
      }
    }
  });
});

describe("structuredSteps — tolerant decode", () => {
  it("reads a bare string as an arg-less action", () => {
    expect(structuredToSteps(["close_menu", "close_dialog"], codec)).toEqual([
      { kind: "action", action: { name: "close_menu", value: null } },
      { kind: "action", action: { name: "close_dialog", value: null } },
    ]);
  });

  it("accepts close_menu: (null) as the same action", () => {
    expect(structuredToSteps([{ close_menu: null }], codec)).toEqual([
      { kind: "action", action: { name: "close_menu", value: null } },
    ]);
  });

  it("treats a map handler as a single step, a list as steps", () => {
    expect(structuredToSteps({ send_message: "Hello" }, codec)).toHaveLength(1);
    expect(
      structuredToSteps([{ send_message: "Hello" }, { close_menu: null }], codec),
    ).toHaveLength(2);
  });
});
