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

/** Read-only twin of `resolveParentMut`: the Step[] `frames` lead to, or null. */
export function resolveParent(root: Step[], frames: StepFrame[]): Step[] | null {
  let list: Step[] = root;
  for (const frame of frames) {
    const step = list[frame.stepIndex];
    if (!step || step.kind !== "if") return null;
    const next = frame.descend === "else" ? step.else : step.cases[frame.descend.case]?.steps;
    if (!next) return null;
    list = next;
  }
  return list;
}

/**
 * Move the step at `from` to `to`, across lists of the same tree (into or out of an `if`
 * branch, from one branch to another). Both lists are resolved before the step leaves its
 * list, so `to` is read against the tree as it was. In the same list `to.index` is the step's
 * final index (array move); in another list it is the insertion index, clamped to its length.
 * Refuses (returns false) a missing source or target, and an `if` dropped inside itself.
 */
export function moveStepMut(root: Step[], from: StepPath, to: StepPath): boolean {
  const source = resolveParentMut(root, from.frames);
  const moved = source?.[from.index];
  if (!source || !moved) return false;
  if (moved.kind === "if" && pathEntersStep(from, to.frames)) return false;
  const target = resolveParentMut(root, to.frames);
  if (!target) return false;
  if (source === target && from.index === to.index) return false;
  source.splice(from.index, 1);
  target.splice(Math.max(0, Math.min(to.index, target.length)), 0, moved);
  return true;
}

/** Whether `frames` descend through the step at `step` (its own branches or deeper). */
function pathEntersStep(step: StepPath, frames: StepFrame[]): boolean {
  if (frames.length <= step.frames.length) return false;
  const sameParent = step.frames.every(
    (f, i) => f.stepIndex === frames[i]!.stepIndex && sameDescend(f.descend, frames[i]!.descend),
  );
  return sameParent && frames[step.frames.length]!.stepIndex === step.index;
}

function sameDescend(a: StepFrame["descend"], b: StepFrame["descend"]): boolean {
  return a === "else" || b === "else" ? a === b : a.case === b.case;
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
