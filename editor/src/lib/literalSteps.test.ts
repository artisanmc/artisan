import type { I18nKey, Step } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { stepsFromWire, stepsToWire } from "./literalSteps";

const lt = (s: string) => ({ key: s as I18nKey });

describe("literalSteps (data-source / module `actions`, structured step wire)", () => {
  it("emits a keyed step tree (literal text) and reads it back", () => {
    const steps: Step[] = [
      {
        kind: "action",
        action: { name: "run_command", value: { command: "give {player} diamond", as: "console" } },
      },
      { kind: "action", action: { name: "send_message", value: lt("§aMerci pour ton achat !") } },
    ];
    const wire = stepsToWire(steps);
    expect(wire).toEqual([
      { run_command: { command: "give {player} diamond", as: "console" } },
      { send_message: "§aMerci pour ton achat !" },
    ]);
    expect(stepsFromWire(wire)).toEqual(steps);
  });

  it("round-trips an if-step with conditions and else", () => {
    const steps: Step[] = [
      {
        kind: "if",
        cases: [
          {
            conditions: [
              { type: "has_permission", perm: "shop.vip" },
              { type: "has_money", amount: 100 },
            ],
            joins: ["and"],
            steps: [
              {
                kind: "action",
                action: { name: "run_command", value: { command: "kit vip", as: "console" } },
              },
            ],
          },
        ],
        else: [{ kind: "action", action: { name: "send_message", value: lt("Pas assez !") } }],
      },
    ];
    const wire = stepsToWire(steps);
    expect(wire).toEqual([
      {
        if: [{ has_permission: "shop.vip" }, { has_money: 100 }],
        do: [{ run_command: { command: "kit vip", as: "console" } }],
        else: [{ send_message: "Pas assez !" }],
      },
    ]);
    // A flat AND list canonicalizes to an implicit-AND list (no `joins`).
    expect(stepsFromWire(wire)).toEqual([
      {
        kind: "if",
        cases: [
          {
            conditions: [
              { type: "has_permission", perm: "shop.vip" },
              { type: "has_money", amount: 100 },
            ],
            steps: [
              {
                kind: "action",
                action: { name: "run_command", value: { command: "kit vip", as: "console" } },
              },
            ],
          },
        ],
        else: [{ kind: "action", action: { name: "send_message", value: lt("Pas assez !") } }],
      },
    ]);
  });

  it("reads a legacy Action DSL string", () => {
    expect(stepsFromWire('send_message "hi"')).toEqual([
      { kind: "action", action: { name: "send_message", value: lt("hi") } },
    ]);
  });

  it("tolerates garbage (null, empty, unparseable)", () => {
    expect(stepsFromWire(null)).toEqual([]);
    expect(stepsFromWire([])).toEqual([]);
    expect(stepsFromWire("")).toEqual([]);
    expect(stepsFromWire("   ")).toEqual([]);
    expect(stepsFromWire("this is not @@ valid dsl :::")).toEqual([]);
  });
});
