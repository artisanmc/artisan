import type { I18nKey, Step } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { stepsFromWire, stepsToWire } from "./literalSteps";

const lt = (s: string) => ({ key: s as I18nKey });

describe("literalSteps (module-data steps, literal text — no i18n)", () => {
  it("round-trips run_command + send_message with literal text", () => {
    const steps: Step[] = [
      { kind: "action", action: { type: "run_command", command: "give {player} diamond", as: "console" } },
      { kind: "action", action: { type: "send_message", text: lt("§aMerci pour ton achat !") } },
    ];
    const wire = stepsToWire(steps);
    expect(wire).toEqual([
      { kind: "action", action: { type: "run_command", command: "give {player} diamond", as: "console" } },
      { kind: "action", action: { type: "send_message", text: "§aMerci pour ton achat !" } },
    ]);
    expect(stepsFromWire(wire)).toEqual(steps);
  });

  it("round-trips an if-step with conditions, joins and else", () => {
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
            steps: [{ kind: "action", action: { type: "run_command", command: "kit vip", as: "console" } }],
          },
        ],
        else: [{ kind: "action", action: { type: "send_message", text: lt("Pas assez !") } }],
      },
    ];
    const wire = stepsToWire(steps);
    expect(stepsFromWire(wire)).toEqual(steps);
  });

  it("stepsFromWire tolerates garbage (null, non-array, unknown types)", () => {
    expect(stepsFromWire(null)).toEqual([]);
    expect(stepsFromWire("nope")).toEqual([]);
    expect(stepsFromWire([{ kind: "action", action: { type: "warp_drive" } }])).toEqual([]);
  });
});
