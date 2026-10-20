import { commandsOf, mutableCommands, renamedDocumentFiles } from "@/domain/documents";
import { rekeyCommand } from "@/domain/i18nSites";
import { commandId, newCommandId } from "@/domain/ids";
import { type StepFrame, type StepPath, resolveParentMut } from "@/domain/stepPath";
import type { Command, CommandArg, CommandId, Condition, ProjectId, Step } from "@/domain/types";
import { commandKeyPrefix } from "@/lib/i18nKeys";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { allocStepLTexts, gcStepLTexts, rewriteCanvasEdgeIds, validateArgOrder } from "./helpers";
import type { ProjectsSliceContext } from "./types";

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

export const createCommandsSlice = ({
  get,
  mutateProject,
  mutateCommand,
}: ProjectsSliceContext): CommandsSlice => ({
  createCommand: ({ projectId: pId, id: explicitId, name, position }) => {
    const id = explicitId ? commandId(explicitId) : newCommandId();
    mutateProject(pId, (project) => {
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
    });
    return id;
  },
  setCommandField: ({ projectId: pId, commandId: cId, field, value }) =>
    mutateCommand(pId, cId, (cmd) => {
      if (field === "name") cmd.name = value;
      else if (field === "permission") cmd.permission = value || undefined;
      else if (field === "description") cmd.description = value || undefined;
    }),
  setCommandAliases: ({ projectId: pId, commandId: cId, aliases }) =>
    mutateCommand(pId, cId, (cmd) => {
      cmd.aliases = aliases.length > 0 ? aliases : undefined;
    }),
  updateCommand: ({ projectId: pId, command }) =>
    mutateProject(pId, (project) => {
      const idx = commandsOf(project).findIndex((c) => c.id === command.id);
      if (idx === -1) return false;
      mutableCommands(project)[idx] = command;
    }),
  addCommandArg: ({ projectId: pId, commandId: cId, arg }) =>
    mutateCommand(pId, cId, (cmd) => {
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
    }),
  setCommandArg: ({ projectId: pId, commandId: cId, index, arg }) =>
    mutateCommand(pId, cId, (cmd) => {
      if (index < 0 || index >= cmd.arguments.length) return false;
      const newArgs = [...cmd.arguments];
      newArgs[index] = arg;
      validateArgOrder(newArgs);
      cmd.arguments[index] = arg;
    }),
  removeCommandArg: ({ projectId: pId, commandId: cId, index }) =>
    mutateCommand(pId, cId, (cmd) => {
      if (index < 0 || index >= cmd.arguments.length) return false;
      cmd.arguments.splice(index, 1);
    }),
  setCommandId: ({ projectId: pId, oldId, newId }) => {
    if (oldId === newId) return;
    if (!newId) throw new Error("command id cannot be empty");
    {
      const project = get().openProjects.projects.find((p) => p.id === pId);
      if (!project) return;
      if (commandsOf(project).some((c) => c.id === newId)) {
        throw new Error(`command id "${newId}" already exists in project`);
      }
      if (!commandsOf(project).some((c) => c.id === oldId)) return;
    }
    mutateCommand(pId, oldId, (cmd, project) => {
      cmd.id = newId;
      const layout = project.canvasLayout as Record<string, { x: number; y: number }>;
      if (oldId in layout) {
        layout[newId] = layout[oldId]!;
        delete layout[oldId];
      }
      rewriteCanvasEdgeIds(project, oldId as string, newId as string);
      rekeyCommand(project, cmd);
    });
    // Same intent as setDialogId, recorded once the rename is applied.
    const moved = renamedDocumentFiles(
      get().openProjects.projects.find((p) => p.id === pId),
      "command",
      oldId as string,
      newId as string,
    );
    useProjectDraftStore.getState().recordRename(pId, moved.from, moved.to);
  },
  setCommandStep: ({ projectId: pId, commandId: cId, path, step, lang }) =>
    mutateCommand(pId, cId, (cmd, project) => {
      const parent = resolveParentMut(cmd.steps, path.frames);
      if (!parent || path.index < 0 || path.index >= parent.length) return false;
      gcStepLTexts(project, [parent[path.index]!]);
      parent[path.index] = step;
      allocStepLTexts(project, cmd.steps, lang, commandKeyPrefix(cId));
    }),
  addCommandStep: ({ projectId: pId, commandId: cId, frames, index, step, lang }) =>
    mutateCommand(pId, cId, (cmd, project) => {
      const parent = resolveParentMut(cmd.steps, frames);
      if (!parent) return false;
      const at = index < 0 || index > parent.length ? parent.length : index;
      parent.splice(at, 0, step);
      allocStepLTexts(project, cmd.steps, lang, commandKeyPrefix(cId));
    }),
  removeCommandStep: ({ projectId: pId, commandId: cId, path }) =>
    mutateCommand(pId, cId, (cmd, project) => {
      const parent = resolveParentMut(cmd.steps, path.frames);
      if (!parent || path.index < 0 || path.index >= parent.length) return false;
      gcStepLTexts(project, [parent[path.index]!]);
      parent.splice(path.index, 1);
    }),
  moveCommandStep: ({ projectId: pId, commandId: cId, frames, fromIndex, toIndex }) =>
    mutateCommand(pId, cId, (cmd) => {
      const parent = resolveParentMut(cmd.steps, frames);
      if (!parent) return false;
      if (fromIndex < 0 || fromIndex >= parent.length) return false;
      if (toIndex < 0 || toIndex >= parent.length) return false;
      const [moved] = parent.splice(fromIndex, 1);
      if (moved) parent.splice(toIndex, 0, moved);
    }),
  addCommandIfCase: ({ projectId: pId, commandId: cId, frames, ifStepIndex }) =>
    mutateCommand(pId, cId, (cmd) => {
      const ifStep = resolveParentMut(cmd.steps, frames)?.[ifStepIndex];
      if (!ifStep || ifStep.kind !== "if") return false;
      ifStep.cases.push({ conditions: [], steps: [] });
    }),
  removeCommandIfCase: ({ projectId: pId, commandId: cId, frames, ifStepIndex, caseIndex }) =>
    mutateCommand(pId, cId, (cmd, project) => {
      const ifStep = resolveParentMut(cmd.steps, frames)?.[ifStepIndex];
      if (!ifStep || ifStep.kind !== "if") return false;
      if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return false;
      gcStepLTexts(project, ifStep.cases[caseIndex]!.steps);
      ifStep.cases.splice(caseIndex, 1);
    }),
  setCommandIfCaseConditions: ({
    projectId: pId,
    commandId: cId,
    frames,
    ifStepIndex,
    caseIndex,
    conditions,
  }) =>
    mutateCommand(pId, cId, (cmd) => {
      const ifStep = resolveParentMut(cmd.steps, frames)?.[ifStepIndex];
      if (!ifStep || ifStep.kind !== "if") return false;
      const c = ifStep.cases[caseIndex];
      if (!c) return false;
      c.conditions = conditions;
    }),
  setCommandIfCaseJoin: ({
    projectId: pId,
    commandId: cId,
    frames,
    ifStepIndex,
    caseIndex,
    joinIndex,
    op,
  }) =>
    mutateCommand(pId, cId, (cmd) => {
      const ifStep = resolveParentMut(cmd.steps, frames)?.[ifStepIndex];
      if (!ifStep || ifStep.kind !== "if") return false;
      const c = ifStep.cases[caseIndex];
      if (!c) return false;
      const max = Math.max(0, c.conditions.length - 1);
      if (joinIndex < 0 || joinIndex >= max) return false;
      if (!c.joins) c.joins = Array(max).fill("and");
      while (c.joins.length < max) c.joins.push("and");
      c.joins[joinIndex] = op;
    }),
  toggleCommandIfElse: ({ projectId: pId, commandId: cId, frames, ifStepIndex, enabled }) =>
    mutateCommand(pId, cId, (cmd, project) => {
      const ifStep = resolveParentMut(cmd.steps, frames)?.[ifStepIndex];
      if (!ifStep || ifStep.kind !== "if") return false;
      if (enabled) {
        if (!ifStep.else) ifStep.else = [];
      } else {
        if (ifStep.else) gcStepLTexts(project, ifStep.else);
        ifStep.else = undefined;
      }
    }),
});
