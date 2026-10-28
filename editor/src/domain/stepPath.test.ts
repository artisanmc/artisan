import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { type StepPath, moveStepMut } from "./stepPath";
import type { Step } from "./types";

const a = (name: string): Step => ({ kind: "action", action: { name, value: null } });
const ifOf = (cases: Step[][], otherwise?: Step[]): Step => ({
  kind: "if",
  cases: cases.map((steps) => ({ conditions: [], steps })),
  ...(otherwise ? { else: otherwise } : {}),
});
const top = (index: number): StepPath => ({ frames: [], index });
const inCase = (stepIndex: number, c: number, index: number): StepPath => ({
  frames: [{ stepIndex, descend: { case: c } }],
  index,
});
const inElse = (stepIndex: number, index: number): StepPath => ({
  frames: [{ stepIndex, descend: "else" }],
  index,
});

function move(root: Step[], from: StepPath, to: StepPath): { ok: boolean; steps: Step[] } {
  let ok = false;
  const steps = produce(root, (draft) => {
    ok = moveStepMut(draft, from, to);
  });
  return { ok, steps };
}

describe("moveStepMut", () => {
  it("reorders within one list like an array move", () => {
    expect(move([a("1"), a("2"), a("3")], top(0), top(2)).steps).toEqual([a("2"), a("3"), a("1")]);
    expect(move([a("1"), a("2"), a("3")], top(2), top(0)).steps).toEqual([a("3"), a("1"), a("2")]);
  });

  it("moves a step from the top level into an if case, before or after its steps", () => {
    const root = [ifOf([[a("x")]]), a("m")];
    expect(move(root, top(1), inCase(0, 0, 0)).steps).toEqual([ifOf([[a("m"), a("x")]])]);
    expect(move(root, top(1), inCase(0, 0, 1)).steps).toEqual([ifOf([[a("x"), a("m")]])]);
  });

  it("moves a step from above the if into it: the if's index is read before the move", () => {
    const root = [a("m"), ifOf([[a("x")]])];
    expect(move(root, top(0), inCase(1, 0, 0)).steps).toEqual([ifOf([[a("m"), a("x")]])]);
  });

  it("moves a step out of a case, between cases and into the else branch", () => {
    const root = [ifOf([[a("x")], [a("y")]], [a("z")])];
    expect(move(root, inCase(0, 0, 0), top(1)).steps).toEqual([
      ifOf([[], [a("y")]], [a("z")]),
      a("x"),
    ]);
    expect(move(root, inCase(0, 0, 0), inCase(0, 1, 1)).steps).toEqual([
      ifOf([[], [a("y"), a("x")]], [a("z")]),
    ]);
    expect(move(root, inCase(0, 1, 0), inElse(0, 0)).steps).toEqual([
      ifOf([[a("x")], []], [a("y"), a("z")]),
    ]);
  });

  it("clamps an insertion past the end of the target list", () => {
    const root = [ifOf([[]]), a("m")];
    expect(move(root, top(1), inCase(0, 0, 5)).steps).toEqual([ifOf([[a("m")]])]);
  });

  it("refuses to drop an if inside itself, and a missing source", () => {
    const root = [ifOf([[ifOf([[a("x")]])]])];
    expect(move(root, top(0), inCase(0, 0, 0)).ok).toBe(false);
    expect(
      move(root, top(0), {
        frames: [
          { stepIndex: 0, descend: { case: 0 } },
          { stepIndex: 0, descend: { case: 0 } },
        ],
        index: 0,
      }).ok,
    ).toBe(false);
    expect(move(root, top(3), top(0)).ok).toBe(false);
  });

  it("lets a nested if move out to its parent's list", () => {
    const inner = ifOf([[a("x")]]);
    const root = [ifOf([[inner]])];
    expect(move(root, inCase(0, 0, 0), top(1)).steps).toEqual([ifOf([[]]), inner]);
  });
});
