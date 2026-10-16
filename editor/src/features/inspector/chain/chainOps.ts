import { type ChainAddress, chainTarget } from "@/domain/chainAddress";
import { type StepFrame, type StepPath, resolveParentMut } from "@/domain/stepPath";
import type { Condition, ProjectId, Step } from "@/domain/types";
import type { AccountState } from "@/state/accountStore";
import { produce } from "immer";

/**
 * The edits the step tree makes on one Action chain. `frames` locate the Step[] being
 * edited inside the chain (`domain/stepPath.ts`); an `if` step is named by its index in it.
 */
export interface ChainOps {
  /** Insert `step` at `index` (out of range → append). */
  add(frames: StepFrame[], index: number, step: Step): void;
  move(frames: StepFrame[], fromIndex: number, toIndex: number): void;
  remove(path: StepPath): void;
  set(path: StepPath, step: Step): void;
  addCase(frames: StepFrame[], ifStepIndex: number): void;
  removeCase(frames: StepFrame[], ifStepIndex: number, caseIndex: number): void;
  setCaseConditions(
    frames: StepFrame[],
    ifStepIndex: number,
    caseIndex: number,
    conditions: Condition[],
  ): void;
  setCaseJoin(
    frames: StepFrame[],
    ifStepIndex: number,
    caseIndex: number,
    joinIndex: number,
    op: "and" | "or",
  ): void;
  toggleElse(frames: StepFrame[], ifStepIndex: number, enabled: boolean): void;
}

/** The account store reducers that edit an Action chain, per owner. */
export type ChainStoreActions = Pick<
  AccountState,
  | "addElementStep"
  | "moveElementStep"
  | "removeElementStep"
  | "setElementStep"
  | "addIfCase"
  | "removeIfCase"
  | "setIfCaseConditions"
  | "setIfCaseJoin"
  | "toggleIfElse"
  | "addCommandStep"
  | "moveCommandStep"
  | "removeCommandStep"
  | "setCommandStep"
  | "addCommandIfCase"
  | "removeCommandIfCase"
  | "setCommandIfCaseConditions"
  | "setCommandIfCaseJoin"
  | "toggleCommandIfElse"
  | "addDialogButtonStep"
  | "moveDialogButtonStep"
  | "removeDialogButtonStep"
  | "setDialogButtonStep"
  | "addDialogButtonIfCase"
  | "removeDialogButtonIfCase"
  | "setDialogButtonIfCaseConditions"
  | "setDialogButtonIfCaseJoin"
  | "toggleDialogButtonIfElse"
>;

/**
 * Chain edits routed to the store reducers of the chain's owner. `actions` is read at each
 * edit (pass `useAccountStore.getState`); `lang` is the language new texts are written in.
 */
export function storeChainOps(
  actions: () => ChainStoreActions,
  projectId: ProjectId,
  address: ChainAddress,
  lang: string,
): ChainOps {
  switch (address.kind) {
    case "element": {
      const at = { projectId, ...chainTarget(address) };
      return {
        add: (frames, index, step) =>
          actions().addElementStep({ ...at, frames, index, step, lang }),
        move: (frames, fromIndex, toIndex) =>
          actions().moveElementStep({ ...at, frames, fromIndex, toIndex }),
        remove: (path) => actions().removeElementStep({ ...at, path }),
        set: (path, step) => actions().setElementStep({ ...at, path, step, lang }),
        addCase: (frames, ifStepIndex) => actions().addIfCase({ ...at, frames, ifStepIndex }),
        removeCase: (frames, ifStepIndex, caseIndex) =>
          actions().removeIfCase({ ...at, frames, ifStepIndex, caseIndex }),
        setCaseConditions: (frames, ifStepIndex, caseIndex, conditions) =>
          actions().setIfCaseConditions({ ...at, frames, ifStepIndex, caseIndex, conditions }),
        setCaseJoin: (frames, ifStepIndex, caseIndex, joinIndex, op) =>
          actions().setIfCaseJoin({ ...at, frames, ifStepIndex, caseIndex, joinIndex, op }),
        toggleElse: (frames, ifStepIndex, enabled) =>
          actions().toggleIfElse({ ...at, frames, ifStepIndex, enabled }),
      };
    }
    case "command": {
      const at = { projectId, ...chainTarget(address) };
      return {
        add: (frames, index, step) =>
          actions().addCommandStep({ ...at, frames, index, step, lang }),
        move: (frames, fromIndex, toIndex) =>
          actions().moveCommandStep({ ...at, frames, fromIndex, toIndex }),
        remove: (path) => actions().removeCommandStep({ ...at, path }),
        set: (path, step) => actions().setCommandStep({ ...at, path, step, lang }),
        addCase: (frames, ifStepIndex) =>
          actions().addCommandIfCase({ ...at, frames, ifStepIndex }),
        removeCase: (frames, ifStepIndex, caseIndex) =>
          actions().removeCommandIfCase({ ...at, frames, ifStepIndex, caseIndex }),
        setCaseConditions: (frames, ifStepIndex, caseIndex, conditions) =>
          actions().setCommandIfCaseConditions({
            ...at,
            frames,
            ifStepIndex,
            caseIndex,
            conditions,
          }),
        setCaseJoin: (frames, ifStepIndex, caseIndex, joinIndex, op) =>
          actions().setCommandIfCaseJoin({ ...at, frames, ifStepIndex, caseIndex, joinIndex, op }),
        toggleElse: (frames, ifStepIndex, enabled) =>
          actions().toggleCommandIfElse({ ...at, frames, ifStepIndex, enabled }),
      };
    }
    case "dialogButton": {
      const at = { projectId, ...chainTarget(address) };
      return {
        add: (frames, index, step) =>
          actions().addDialogButtonStep({ ...at, frames, index, step, lang }),
        move: (frames, fromIndex, toIndex) =>
          actions().moveDialogButtonStep({ ...at, frames, fromIndex, toIndex }),
        remove: (path) => actions().removeDialogButtonStep({ ...at, path }),
        set: (path, step) => actions().setDialogButtonStep({ ...at, path, step, lang }),
        addCase: (frames, ifStepIndex) =>
          actions().addDialogButtonIfCase({ ...at, frames, ifStepIndex }),
        removeCase: (frames, ifStepIndex, caseIndex) =>
          actions().removeDialogButtonIfCase({ ...at, frames, ifStepIndex, caseIndex }),
        setCaseConditions: (frames, ifStepIndex, caseIndex, conditions) =>
          actions().setDialogButtonIfCaseConditions({
            ...at,
            frames,
            ifStepIndex,
            caseIndex,
            conditions,
          }),
        setCaseJoin: (frames, ifStepIndex, caseIndex, joinIndex, op) =>
          actions().setDialogButtonIfCaseJoin({
            ...at,
            frames,
            ifStepIndex,
            caseIndex,
            joinIndex,
            op,
          }),
        toggleElse: (frames, ifStepIndex, enabled) =>
          actions().toggleDialogButtonIfElse({ ...at, frames, ifStepIndex, lang, enabled }),
      };
    }
  }
}

/**
 * Chain edits applied to a value held by the caller (`value` + `onChange`, no store): the
 * `actions` field of module data. Each edit hands `onChange` a new Step[] (immer).
 */
export function controlledChainOps(value: Step[], onChange: (steps: Step[]) => void): ChainOps {
  const mutate = (fn: (root: Step[]) => void) => onChange(produce(value, fn));
  const ifAt = (root: Step[], frames: StepFrame[], ifStepIndex: number) => {
    const s = resolveParentMut(root, frames)?.[ifStepIndex];
    return s && s.kind === "if" ? s : null;
  };
  return {
    add: (frames, index, step) =>
      mutate((root) => {
        const parent = resolveParentMut(root, frames);
        if (!parent) return;
        if (index < 0 || index >= parent.length) parent.push(step);
        else parent.splice(index, 0, step);
      }),
    move: (frames, fromIndex, toIndex) =>
      mutate((root) => {
        const parent = resolveParentMut(root, frames);
        if (!parent) return;
        const [moved] = parent.splice(fromIndex, 1);
        if (moved) parent.splice(toIndex, 0, moved);
      }),
    remove: (path) =>
      mutate((root) => {
        resolveParentMut(root, path.frames)?.splice(path.index, 1);
      }),
    set: (path, step) =>
      mutate((root) => {
        const parent = resolveParentMut(root, path.frames);
        if (parent) parent[path.index] = step;
      }),
    addCase: (frames, ifStepIndex) =>
      mutate((root) => {
        ifAt(root, frames, ifStepIndex)?.cases.push({ conditions: [], steps: [] });
      }),
    removeCase: (frames, ifStepIndex, caseIndex) =>
      mutate((root) => {
        ifAt(root, frames, ifStepIndex)?.cases.splice(caseIndex, 1);
      }),
    setCaseConditions: (frames, ifStepIndex, caseIndex, conditions) =>
      mutate((root) => {
        const c = ifAt(root, frames, ifStepIndex)?.cases[caseIndex];
        if (c) c.conditions = conditions;
      }),
    setCaseJoin: (frames, ifStepIndex, caseIndex, joinIndex, op) =>
      mutate((root) => {
        const c = ifAt(root, frames, ifStepIndex)?.cases[caseIndex];
        if (!c) return;
        const max = Math.max(0, c.conditions.length - 1);
        if (joinIndex < 0 || joinIndex >= max) return;
        if (!c.joins) c.joins = Array(max).fill("and");
        while (c.joins.length < max) c.joins.push("and");
        c.joins[joinIndex] = op;
      }),
    toggleElse: (frames, ifStepIndex, enabled) =>
      mutate((root) => {
        const s = ifAt(root, frames, ifStepIndex);
        if (!s) return;
        if (enabled) {
          if (!s.else) s.else = [];
        } else {
          s.else = undefined;
        }
      }),
  };
}
