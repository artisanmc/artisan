import { type ChainAddress, chainTarget } from "@/domain/chainAddress";
import { type StepFrame, type StepPath, moveStepMut, resolveParentMut } from "@/domain/stepPath";
import type { Condition, ProjectId, Step } from "@/domain/types";
import type { ProjectsState } from "@/state/projectsStore";
import { produce } from "immer";

/**
 * The edits the step tree makes on one Action chain. `frames` locate the Step[] being
 * edited inside the chain (`domain/stepPath.ts`); an `if` step is named by its index in it.
 */
export interface ChainOps {
  /** Insert `step` at `index` (out of range → append). */
  add(frames: StepFrame[], index: number, step: Step): void;
  /** Move a step, possibly into another Step[] of the chain — see `moveStepMut`. */
  move(from: StepPath, to: StepPath): void;
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

/** The projects store reducers that edit an Action chain, per owner. */
export type ChainStoreActions = Pick<
  ProjectsState,
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
  | "editDocumentChain"
>;

/**
 * Chain edits routed to the store reducers of the chain's owner. `actions` is read at each
 * edit (pass `useProjectsStore.getState`); `lang` is the language new texts are written in.
 */
export function storeChainOps(
  actions: () => ChainStoreActions,
  projectId: ProjectId,
  address: ChainAddress,
  lang: string,
): ChainOps {
  switch (address.kind) {
    case "document":
      return documentChainOps(actions, projectId, address, lang);
    case "element": {
      const at = { projectId, ...chainTarget(address) };
      return {
        add: (frames, index, step) =>
          actions().addElementStep({ ...at, frames, index, step, lang }),
        move: (from, to) => actions().moveElementStep({ ...at, from, to }),
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
        move: (from, to) => actions().moveCommandStep({ ...at, from, to }),
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
        move: (from, to) => actions().moveDialogButtonStep({ ...at, from, to }),
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
 * One edit of a chain's top-level Step[], applied in place (immer draft). `gc` releases the
 * texts of steps the edit drops, where the chain's texts are i18n sites.
 */
type ChainEdit = (root: Step[], gc: (dropped: Step[]) => void) => void;

/** The edits of {@link ChainOps}, over whatever applies them (`mutate`). */
function chainEdits(mutate: (edit: ChainEdit) => void): ChainOps {
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
    move: (from, to) =>
      mutate((root) => {
        moveStepMut(root, from, to);
      }),
    remove: (path) =>
      mutate((root, gc) => {
        const parent = resolveParentMut(root, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return;
        gc(parent.splice(path.index, 1));
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
      mutate((root, gc) => {
        const dropped = ifAt(root, frames, ifStepIndex)?.cases.splice(caseIndex, 1) ?? [];
        for (const c of dropped) gc(c.steps);
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
      mutate((root, gc) => {
        const s = ifAt(root, frames, ifStepIndex);
        if (!s) return;
        if (enabled) {
          if (!s.else) s.else = [];
        } else {
          if (s.else) gc(s.else);
          s.else = undefined;
        }
      }),
  };
}

/**
 * Chain edits applied to a value held by the caller (`value` + `onChange`, no store): the
 * `actions` field of module data. Each edit hands `onChange` a new Step[] (immer).
 */
export function controlledChainOps(value: Step[], onChange: (steps: Step[]) => void): ChainOps {
  return chainEdits((edit) => onChange(produce(value, (root) => edit(root, () => {}))));
}

/**
 * Chain edits of one chain slot of a Document whose kind declares its chains
 * (`chainSlots`, a Trigger's `do`): one store write per edit, texts minted at the slot's
 * prefix in `lang` and released when a step is dropped.
 */
export function documentChainOps(
  edit: () => Pick<ProjectsState, "editDocumentChain">,
  projectId: ProjectId,
  address: Extract<ChainAddress, { kind: "document" }>,
  lang: string,
): ChainOps {
  return chainEdits((fn) =>
    edit().editDocumentChain({
      projectId,
      kind: address.docKind,
      id: address.docId,
      slot: address.slot,
      lang,
      edit: fn,
    }),
  );
}
