import { rekeyCommand } from "@/domain/i18nSites";
import { commandId, newCommandId } from "@/domain/ids";
import { type StepFrame, type StepPath, resolveParentMut } from "@/domain/stepPath";
import type { Command, CommandArg, CommandId, Condition, ProjectId, Step } from "@/domain/types";
import { commandKeyPrefix } from "@/lib/i18nKeys";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { produce } from "immer";
import {
  allocStepLTexts,
  findCommand,
  gcStepLTexts,
  rewriteCanvasEdgeIds,
  rewriteCanvasGroupMembers,
  touch,
  validateArgOrder,
} from "./helpers";
import type { AccountSliceContext, AccountState } from "./types";
import { commandsOf, mutableCommands } from "@/domain/documents";

/** Commands: fields, aliases, arguments and their steps. */
export interface CommandsSlice {
  /**
   * Create a new command in `projectId` with sensible defaults (no args, no
   * steps). Returns the new id.
   */
  createCommand: (input: {
    projectId: ProjectId;
    id?: string;
    name?: string;
    position?: { x: number; y: number };
  }) => CommandId;
  setCommandField: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    field: "name" | "permission" | "description";
    value: string;
  }) => void;
  setCommandAliases: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    aliases: string[];
  }) => void;
  /** Replace an entire command object in place (whole-command update). */
  updateCommand: (input: { projectId: ProjectId; command: Command }) => void;
  /** Append a new argument at the end of a command's argument list. */
  addCommandArg: (input: { projectId: ProjectId; commandId: CommandId; arg?: CommandArg }) => void;
  /** Replace the argument at `index` (whole-arg replace; immer drafts handle the merge). */
  setCommandArg: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    index: number;
    arg: CommandArg;
  }) => void;
  removeCommandArg: (input: { projectId: ProjectId; commandId: CommandId; index: number }) => void;
  /** Rename a command's id. Rejects if newId already exists in the project. */
  setCommandId: (input: { projectId: ProjectId; oldId: CommandId; newId: CommandId }) => void;
  /** Replace one step inside a command's step tree at the given path. */
  setCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    path: StepPath;
    step: Step;
    lang: string;
  }) => void;
  /** Insert a step into a command's step tree. */
  addCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    index: number;
    step: Step;
    lang: string;
  }) => void;
  removeCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    path: StepPath;
  }) => void;
  moveCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    fromIndex: number;
    toIndex: number;
  }) => void;
  addCommandIfCase: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  removeCommandIfCase: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  setCommandIfCaseConditions: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
  }) => void;
  setCommandIfCaseJoin: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  toggleCommandIfElse: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    enabled: boolean;
  }) => void;
}

export const createCommandsSlice = ({ set, get }: AccountSliceContext): CommandsSlice => ({
  createCommand: ({ projectId: pId, id: explicitId, name, position }) => {
    const id = explicitId ? commandId(explicitId) : newCommandId();
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        mutableCommands(project).push({
          id,
          projectId: pId,
          name: name ?? "newcmd",
          arguments: [],
          steps: [],
        });
        if (position) {
          (project.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
        }
        project.updatedAt = new Date().toISOString();
      }),
    );
    return id;
  },
  setCommandField: ({ projectId: pId, commandId: cId, field, value }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const cmd = commandsOf(project).find((c) => c.id === cId);
        if (!cmd) return;
        if (field === "name") cmd.name = value;
        else if (field === "permission") cmd.permission = value || undefined;
        else if (field === "description") cmd.description = value || undefined;
        project.updatedAt = new Date().toISOString();
      }),
    ),
  setCommandAliases: ({ projectId: pId, commandId: cId, aliases }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const cmd = commandsOf(project).find((c) => c.id === cId);
        if (!cmd) return;
        cmd.aliases = aliases.length > 0 ? aliases : undefined;
        project.updatedAt = new Date().toISOString();
      }),
    ),
  updateCommand: ({ projectId: pId, command }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const idx = commandsOf(project).findIndex((c) => c.id === command.id);
        if (idx === -1) return;
        mutableCommands(project)[idx] = command;
        project.updatedAt = new Date().toISOString();
      }),
    ),
  addCommandArg: ({ projectId: pId, commandId: cId, arg }) => {
    const next = produce(get().account, (draft) => {
      const project = draft.projects.find((p) => p.id === pId);
      if (!project) return;
      const cmd = commandsOf(project).find((c) => c.id === cId);
      if (!cmd) return;
      const used = new Set(cmd.arguments.map((a) => a.name));
      const defaultName = (() => {
        for (let i = 1; ; i++) {
          const candidate = `arg${i}`;
          if (!used.has(candidate)) return candidate;
        }
      })();
      const newArg = arg ?? { name: defaultName, type: "string" as const, required: true };
      validateArgOrder([...cmd.arguments, newArg]);
      cmd.arguments.push(newArg);
      project.updatedAt = new Date().toISOString();
    });
    set({ account: next });
  },
  setCommandArg: ({ projectId: pId, commandId: cId, index, arg }) => {
    const next = produce(get().account, (draft) => {
      const project = draft.projects.find((p) => p.id === pId);
      if (!project) return;
      const cmd = commandsOf(project).find((c) => c.id === cId);
      if (!cmd || index < 0 || index >= cmd.arguments.length) return;
      const newArgs = [...cmd.arguments];
      newArgs[index] = arg;
      validateArgOrder(newArgs);
      cmd.arguments[index] = arg;
      project.updatedAt = new Date().toISOString();
    });
    set({ account: next });
  },
  removeCommandArg: ({ projectId: pId, commandId: cId, index }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const cmd = commandsOf(project).find((c) => c.id === cId);
        if (!cmd || index < 0 || index >= cmd.arguments.length) return;
        cmd.arguments.splice(index, 1);
        project.updatedAt = new Date().toISOString();
      }),
    ),
  setCommandId: ({ projectId: pId, oldId, newId }) => {
    if (oldId === newId) return;
    if (!newId) throw new Error("command id cannot be empty");
    {
      const project = get().account.projects.find((p) => p.id === pId);
      if (!project) return;
      if (commandsOf(project).some((c) => c.id === newId)) {
        throw new Error(`command id "${newId}" already exists in project`);
      }
      if (!commandsOf(project).some((c) => c.id === oldId)) return;
    }
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId)!;
        const cmd = commandsOf(project).find((c) => c.id === oldId)!;
        cmd.id = newId;
        const layout = project.canvasLayout as Record<string, { x: number; y: number }>;
        if (oldId in layout) {
          layout[newId] = layout[oldId]!;
          delete layout[oldId];
        }
        rewriteCanvasEdgeIds(project, oldId as string, newId as string);
        rewriteCanvasGroupMembers(project, oldId as string, newId as string);
        rekeyCommand(project, cmd);
        project.updatedAt = new Date().toISOString();
      }),
    );
    // Same intent as setDialogId, recorded once the rename is applied.
    useProjectDraftStore
      .getState()
      .recordRename(pId, `commands/${oldId}.yaml`, `commands/${newId}.yaml`);
  },
  setCommandStep: ({ projectId: pId, commandId: cId, path, step, lang }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const cmd = findCommand(draft, pId, cId);
        if (!cmd) return;
        const parent = resolveParentMut(cmd.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return;
        gcStepLTexts(project, [parent[path.index]!]);
        parent[path.index] = step;
        allocStepLTexts(project, cmd.steps, lang, commandKeyPrefix(cId));
        touch(draft, pId);
      }),
    ),
  addCommandStep: ({ projectId: pId, commandId: cId, frames, index, step, lang }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const cmd = findCommand(draft, pId, cId);
        if (!cmd) return;
        const parent = resolveParentMut(cmd.steps, frames);
        if (!parent) return;
        const at = index < 0 || index > parent.length ? parent.length : index;
        parent.splice(at, 0, step);
        allocStepLTexts(project, cmd.steps, lang, commandKeyPrefix(cId));
        touch(draft, pId);
      }),
    ),
  removeCommandStep: ({ projectId: pId, commandId: cId, path }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const cmd = findCommand(draft, pId, cId);
        if (!cmd) return;
        const parent = resolveParentMut(cmd.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return;
        gcStepLTexts(project, [parent[path.index]!]);
        parent.splice(path.index, 1);
        touch(draft, pId);
      }),
    ),
  moveCommandStep: ({ projectId: pId, commandId: cId, frames, fromIndex, toIndex }) =>
    set(
      produce((draft: AccountState) => {
        const cmd = findCommand(draft, pId, cId);
        if (!cmd) return;
        const parent = resolveParentMut(cmd.steps, frames);
        if (!parent) return;
        if (fromIndex < 0 || fromIndex >= parent.length) return;
        if (toIndex < 0 || toIndex >= parent.length) return;
        const [moved] = parent.splice(fromIndex, 1);
        if (moved) parent.splice(toIndex, 0, moved);
        touch(draft, pId);
      }),
    ),
  addCommandIfCase: ({ projectId: pId, commandId: cId, frames, ifStepIndex }) =>
    set(
      produce((draft: AccountState) => {
        const cmd = findCommand(draft, pId, cId);
        if (!cmd) return;
        const parent = resolveParentMut(cmd.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        ifStep.cases.push({ conditions: [], steps: [] });
        touch(draft, pId);
      }),
    ),
  removeCommandIfCase: ({ projectId: pId, commandId: cId, frames, ifStepIndex, caseIndex }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const cmd = findCommand(draft, pId, cId);
        if (!cmd) return;
        const parent = resolveParentMut(cmd.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
        gcStepLTexts(project, ifStep.cases[caseIndex]!.steps);
        ifStep.cases.splice(caseIndex, 1);
        touch(draft, pId);
      }),
    ),
  setCommandIfCaseConditions: ({
    projectId: pId,
    commandId: cId,
    frames,
    ifStepIndex,
    caseIndex,
    conditions,
  }) =>
    set(
      produce((draft: AccountState) => {
        const cmd = findCommand(draft, pId, cId);
        if (!cmd) return;
        const parent = resolveParentMut(cmd.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        const c = ifStep.cases[caseIndex];
        if (!c) return;
        c.conditions = conditions;
        touch(draft, pId);
      }),
    ),
  setCommandIfCaseJoin: ({
    projectId: pId,
    commandId: cId,
    frames,
    ifStepIndex,
    caseIndex,
    joinIndex,
    op,
  }) =>
    set(
      produce((draft: AccountState) => {
        const cmd = findCommand(draft, pId, cId);
        if (!cmd) return;
        const parent = resolveParentMut(cmd.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        const c = ifStep.cases[caseIndex];
        if (!c) return;
        const max = Math.max(0, c.conditions.length - 1);
        if (joinIndex < 0 || joinIndex >= max) return;
        if (!c.joins) c.joins = Array(max).fill("and");
        while (c.joins.length < max) c.joins.push("and");
        c.joins[joinIndex] = op;
        touch(draft, pId);
      }),
    ),
  toggleCommandIfElse: ({ projectId: pId, commandId: cId, frames, ifStepIndex, enabled }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const cmd = findCommand(draft, pId, cId);
        if (!cmd) return;
        const parent = resolveParentMut(cmd.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        if (enabled) {
          if (!ifStep.else) ifStep.else = [];
        } else {
          if (ifStep.else) gcStepLTexts(project, ifStep.else);
          ifStep.else = undefined;
        }
        touch(draft, pId);
      }),
    ),
});
