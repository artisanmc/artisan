import type { ChainAddress } from "@/domain/chainAddress";
import type { CommandId, DialogId, ElementId, MenuId, ProjectId, Step } from "@/domain/types";
import { describe, expect, it, vi } from "vitest";
import { type ChainStoreActions, controlledChainOps, storeChainOps } from "./chainOps";

const PID = "p" as ProjectId;
const step: Step = { kind: "action", action: { name: "close", value: null } };
const frames = [{ stepIndex: 0, descend: { case: 0 } as const }];

/** Every reducer a spy, so a test reads which one an edit reached and with what. */
function fakeActions() {
  return new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (target, name: string) => {
      target[name] ??= vi.fn();
      return target[name];
    },
  });
}

function opsFor(address: ChainAddress) {
  const actions = fakeActions();
  const ops = storeChainOps(() => actions as unknown as ChainStoreActions, PID, address, "fr");
  return { ops, actions };
}

describe("storeChainOps", () => {
  it("routes an Element chain to the element reducers with its appearance target", () => {
    const { ops, actions } = opsFor({
      kind: "element",
      menuId: "m" as MenuId,
      elementId: "e" as ElementId,
      stateIndex: 1,
      clickType: "left",
    });
    const at = {
      projectId: PID,
      menuId: "m",
      elementId: "e",
      appearanceIndex: 1,
      clickType: "left",
    };
    ops.add(frames, 3, step);
    ops.move(frames, 0, 2);
    ops.remove({ frames, index: 1 });
    ops.set({ frames, index: 1 }, step);
    ops.addCase(frames, 4);
    ops.removeCase(frames, 4, 1);
    ops.setCaseConditions(frames, 4, 1, []);
    ops.setCaseJoin(frames, 4, 1, 0, "or");
    ops.toggleElse(frames, 4, true);
    expect(actions.addElementStep).toHaveBeenCalledWith({
      ...at,
      frames,
      index: 3,
      step,
      lang: "fr",
    });
    expect(actions.moveElementStep).toHaveBeenCalledWith({
      ...at,
      frames,
      fromIndex: 0,
      toIndex: 2,
    });
    expect(actions.removeElementStep).toHaveBeenCalledWith({ ...at, path: { frames, index: 1 } });
    expect(actions.setElementStep).toHaveBeenCalledWith({
      ...at,
      path: { frames, index: 1 },
      step,
      lang: "fr",
    });
    expect(actions.addIfCase).toHaveBeenCalledWith({ ...at, frames, ifStepIndex: 4 });
    expect(actions.removeIfCase).toHaveBeenCalledWith({
      ...at,
      frames,
      ifStepIndex: 4,
      caseIndex: 1,
    });
    expect(actions.setIfCaseConditions).toHaveBeenCalledWith({
      ...at,
      frames,
      ifStepIndex: 4,
      caseIndex: 1,
      conditions: [],
    });
    expect(actions.setIfCaseJoin).toHaveBeenCalledWith({
      ...at,
      frames,
      ifStepIndex: 4,
      caseIndex: 1,
      joinIndex: 0,
      op: "or",
    });
    expect(actions.toggleIfElse).toHaveBeenCalledWith({
      ...at,
      frames,
      ifStepIndex: 4,
      enabled: true,
    });
  });

  it("routes a Command chain to the command reducers", () => {
    const { ops, actions } = opsFor({ kind: "command", commandId: "c" as CommandId });
    const at = { projectId: PID, commandId: "c" };
    ops.add([], 0, step);
    ops.remove({ frames: [], index: 0 });
    ops.toggleElse([], 0, false);
    expect(actions.addCommandStep).toHaveBeenCalledWith({
      ...at,
      frames: [],
      index: 0,
      step,
      lang: "fr",
    });
    expect(actions.removeCommandStep).toHaveBeenCalledWith({
      ...at,
      path: { frames: [], index: 0 },
    });
    expect(actions.toggleCommandIfElse).toHaveBeenCalledWith({
      ...at,
      frames: [],
      ifStepIndex: 0,
      enabled: false,
    });
    expect(actions.addElementStep).not.toHaveBeenCalled();
  });

  it("routes a Dialog button chain to the dialog reducers, the else toggle with the language", () => {
    const { ops, actions } = opsFor({
      kind: "dialogButton",
      dialogId: "d" as DialogId,
      buttonIndex: 2,
    });
    const at = { projectId: PID, dialogId: "d", buttonIndex: 2 };
    ops.move([], 1, 0);
    ops.toggleElse([], 0, true);
    expect(actions.moveDialogButtonStep).toHaveBeenCalledWith({
      ...at,
      frames: [],
      fromIndex: 1,
      toIndex: 0,
    });
    expect(actions.toggleDialogButtonIfElse).toHaveBeenCalledWith({
      ...at,
      frames: [],
      ifStepIndex: 0,
      lang: "fr",
      enabled: true,
    });
  });

  it("reads the reducers at edit time", () => {
    const first = fakeActions();
    const second = fakeActions();
    let current = first;
    const ops = storeChainOps(
      () => current as unknown as ChainStoreActions,
      PID,
      {
        kind: "command",
        commandId: "c" as CommandId,
      },
      "en",
    );
    current = second;
    ops.remove({ frames: [], index: 0 });
    expect(first.removeCommandStep).not.toHaveBeenCalled();
    expect(second.removeCommandStep).toHaveBeenCalledOnce();
  });
});

describe("controlledChainOps", () => {
  const a = (name: string): Step => ({ kind: "action", action: { name, value: null } });
  const ifStep = (): Step => ({ kind: "if", cases: [{ conditions: [], steps: [a("x")] }] });

  function run(value: Step[], edit: (ops: ReturnType<typeof controlledChainOps>) => void) {
    let out: Step[] | undefined;
    edit(
      controlledChainOps(value, (next) => {
        out = next;
      }),
    );
    return out;
  }

  it("adds, moves, sets and removes without touching the given value", () => {
    const value = [a("one"), a("two")];
    expect(run(value, (ops) => ops.add([], 2, a("three")))).toEqual([
      a("one"),
      a("two"),
      a("three"),
    ]);
    expect(run(value, (ops) => ops.add([], 0, a("zero")))).toEqual([a("zero"), a("one"), a("two")]);
    expect(run(value, (ops) => ops.move([], 0, 1))).toEqual([a("two"), a("one")]);
    expect(run(value, (ops) => ops.set({ frames: [], index: 1 }, a("2")))).toEqual([
      a("one"),
      a("2"),
    ]);
    expect(run(value, (ops) => ops.remove({ frames: [], index: 0 }))).toEqual([a("two")]);
    expect(value).toEqual([a("one"), a("two")]);
  });

  it("edits inside an if case through its frames", () => {
    const out = run([ifStep()], (ops) => ops.add(frames, 1, a("y")));
    expect(out?.[0]).toEqual({ kind: "if", cases: [{ conditions: [], steps: [a("x"), a("y")] }] });
  });

  it("adds and removes cases and toggles the else branch", () => {
    const withCase = run([ifStep()], (ops) => ops.addCase([], 0));
    expect(withCase?.[0]?.kind === "if" && withCase[0].cases).toHaveLength(2);
    const withElse = run([ifStep()], (ops) => ops.toggleElse([], 0, true));
    expect(withElse?.[0]).toMatchObject({ else: [] });
    const without = run(withElse!, (ops) => ops.toggleElse([], 0, false));
    expect(without?.[0]).toMatchObject({ else: undefined });
    expect(run(withCase!, (ops) => ops.removeCase([], 0, 1))).toEqual([ifStep()]);
  });

  it("sets a case join, filling the missing joins with and", () => {
    const cond = { kind: "permission", permission: "a" } as never;
    const value: Step[] = [{ kind: "if", cases: [{ conditions: [cond, cond, cond], steps: [] }] }];
    const out = run(value, (ops) => ops.setCaseJoin([], 0, 0, 1, "or"));
    expect(out?.[0]).toMatchObject({ cases: [{ joins: ["and", "or"] }] });
    expect(run(value, (ops) => ops.setCaseJoin([], 0, 0, 2, "or"))?.[0]).toEqual(value[0]);
  });
});
