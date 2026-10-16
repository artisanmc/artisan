import type { Action, Step } from "./types";

/**
 * Path into a Step tree.
 *
 *   frames: how to descend through if-steps (zero or more)
 *   index : position in the final Step[]
 *
 * Each frame names which step to enter (must resolve to an if-step) and
 * which sub-list to take — a specific case's steps, or the else branch.
 */
export interface StepPath {
  frames: StepFrame[];
  index: number;
}

export interface StepFrame {
  stepIndex: number;
  descend: { case: number } | "else";
}

/**
 * Walk to the parent step list inside an immer draft, ensuring
 * `if-step.else` exists when the path requires it. Returns the live
 * (drafted) list for in-place mutation.
 */
export function resolveParentMut(root: Step[], frames: StepFrame[]): Step[] | null {
  let list: Step[] = root;
  for (const frame of frames) {
    const step = list[frame.stepIndex];
    if (!step || step.kind !== "if") return null;
    if (frame.descend === "else") {
      if (!step.else) step.else = [];
      list = step.else;
    } else {
      const c = step.cases[frame.descend.case];
      if (!c) return null;
      list = c.steps;
    }
  }
  return list;
}

/**
 * Walk a Step tree depth-first and emit every Action. Used by helpers that
 * need to inspect every action in a chain (edge derivation, hermeticity
 * checks, etc).
 */
export function* walkActions(steps: Step[]): Generator<Action> {
  for (const step of steps) {
    if (step.kind === "action") {
      yield step.action;
    } else {
      for (const c of step.cases) yield* walkActions(c.steps);
      if (step.else) yield* walkActions(step.else);
    }
  }
}
