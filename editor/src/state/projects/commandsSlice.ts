import { commandNodeAt, commandNodeKeyPrefix } from "@/domain/commandNodes";
import { commandsOf, docKey, mutableCommands, renamedDocumentFiles } from "@/domain/documents";
import { rekeyCommand } from "@/domain/i18nSites";
import { commandId, newCommandId } from "@/domain/ids";
import { type StepFrame, type StepPath, moveStepMut, resolveParentMut } from "@/domain/stepPath";
import type {
  Command,
  CommandArg,
  CommandId,
  CommandNode,
  CommandNodePath,
  Condition,
  I18nKey,
  Project,
  ProjectId,
  Step,
} from "@/domain/types";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { allocStepLTexts, gcStepLTexts, renameBoardKey, validateArgOrder } from "./helpers";
import type { Mutation } from "./mutate";
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
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    field: "name" | "permission";
    value: string;
  }) => void;
  setCommandAliases: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    aliases: string[];
  }) => void;
  /** A node's description in `lang`; empty in every language removes it. */
  setCommandDescription: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    sub?: CommandNodePath;
    lang: string;
    value: string;
  }) => void;
  /** Turn a command or a sub-command off without deleting it (`enabled: false`). */
  setCommandEnabled: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    sub?: CommandNodePath;
    enabled: boolean;
  }) => void;
  /** Append a sub-command under the node at `sub`. Returns the new node's path. */
  addSubcommand: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    sub?: CommandNodePath;
    name?: string;
  }) => CommandNodePath | undefined;
  /** Remove the sub-command at `sub` (never the root), its texts and its children's. */
  removeSubcommand: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    sub: CommandNodePath;
  }) => void;
  /** Replace an entire command object in place (whole-command update). */
  updateCommand: (input: { projectId: ProjectId; command: Command }) => void;
  /** Append a new argument at the end of a command's argument list. */
  addCommandArg: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    sub?: CommandNodePath;
    arg?: CommandArg;
  }) => void;
  /** Replace the argument at `index` (whole-arg replace; immer drafts handle the merge). */
  setCommandArg: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    index: number;
    arg: CommandArg;
  }) => void;
  removeCommandArg: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    sub?: CommandNodePath;
    index: number;
  }) => void;
  /** Rename a command's id. Rejects if newId already exists in the project. */
  setCommandId: (input: { projectId: ProjectId; oldId: CommandId; newId: CommandId }) => void;
  /** Replace one step inside a command's step tree at the given path. */
  setCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    path: StepPath;
    step: Step;
    lang: string;
  }) => void;
  /** Insert a step into a command's step tree. */
  addCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    frames: StepFrame[];
    index: number;
    step: Step;
    lang: string;
  }) => void;
  removeCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    path: StepPath;
  }) => void;
  moveCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    from: StepPath;
    to: StepPath;
  }) => void;
  addCommandIfCase: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  removeCommandIfCase: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  setCommandIfCaseConditions: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
  }) => void;
  setCommandIfCaseJoin: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  toggleCommandIfElse: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    /** The sub-command edited; absent: the command itself. */
    sub?: CommandNodePath;
    frames: StepFrame[];
    ifStepIndex: number;
    enabled: boolean;
  }) => void;
}

export const createCommandsSlice = ({
  get,
  mutateProject,
  mutateCommand,
}: ProjectsSliceContext): CommandsSlice => {
  /** {@link mutateCommand} on the node at `sub`; nothing changes when it does not exist. */
  const mutateNode = (
    pId: ProjectId,
    cId: CommandId,
    sub: CommandNodePath | undefined,
    fn: Mutation<[node: CommandNode, project: Project, cmd: Command]>,
  ) =>
    mutateCommand(pId, cId, (cmd, project) => {
      const node = commandNodeAt(cmd, sub);
      if (!node) return false;
      return fn(node, project, cmd);
    });

  return {
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
          project.canvasLayout[docKey("command", id)] = position;
        }
      });
      return id;
    },
    setCommandField: ({ projectId: pId, commandId: cId, sub, field, value }) =>
      mutateNode(pId, cId, sub, (node) => {
        if (field === "name") node.name = value;
        else if (field === "permission") node.permission = value || undefined;
      }),
    setCommandAliases: ({ projectId: pId, commandId: cId, sub, aliases }) =>
      mutateNode(pId, cId, sub, (node) => {
        node.aliases = aliases.length > 0 ? aliases : undefined;
      }),
    setCommandDescription: ({ projectId: pId, commandId: cId, sub, lang, value }) =>
      mutateNode(pId, cId, sub, (node, project) => {
        const key = (node.description?.key ??
          `${commandNodeKeyPrefix(cId, sub ?? [])}.description`) as I18nKey;
        const entry = { ...project.i18nKeys[key] };
        if (value) entry[lang] = value;
        else delete entry[lang];
        if (Object.values(entry).some((v) => v !== "")) {
          project.i18nKeys[key] = entry;
          node.description = { key };
        } else {
          delete project.i18nKeys[key];
          node.description = undefined;
        }
      }),
    setCommandEnabled: ({ projectId: pId, commandId: cId, sub, enabled }) =>
      mutateNode(pId, cId, sub, (node) => {
        node.enabled = enabled ? undefined : false;
      }),
    addSubcommand: ({ projectId: pId, commandId: cId, sub, name }) => {
      let added: CommandNodePath | undefined;
      mutateNode(pId, cId, sub, (node) => {
        const children = node.subcommands ?? [];
        const used = new Set(children.map((c) => c.name));
        let fresh = name ?? "sub";
        for (let i = 2; !name && used.has(fresh); i++) fresh = `sub${i}`;
        children.push({ name: fresh, arguments: [], steps: [] });
        node.subcommands = children;
        added = [...(sub ?? []), children.length - 1];
      });
      return added;
    },
    removeSubcommand: ({ projectId: pId, commandId: cId, sub }) =>
      mutateCommand(pId, cId, (cmd, project) => {
        if (sub.length === 0) return false;
        const parent = commandNodeAt(cmd, sub.slice(0, -1));
        const index = sub[sub.length - 1]!;
        const removed = parent?.subcommands?.[index];
        if (!parent?.subcommands || !removed) return false;
        // Every text of the node and of its children leaves with it.
        const release = (node: CommandNode) => {
          if (node.description) delete project.i18nKeys[node.description.key];
          gcStepLTexts(project, node.steps);
          for (const child of node.subcommands ?? []) release(child);
        };
        release(removed);
        parent.subcommands.splice(index, 1);
        if (parent.subcommands.length === 0) parent.subcommands = undefined;
        // The siblings after it moved up: their canonical keys follow.
        rekeyCommand(project, cmd);
      }),
    updateCommand: ({ projectId: pId, command }) =>
      mutateProject(pId, (project) => {
        const idx = commandsOf(project).findIndex((c) => c.id === command.id);
        if (idx === -1) return false;
        mutableCommands(project)[idx] = command;
      }),
    addCommandArg: ({ projectId: pId, commandId: cId, sub, arg }) =>
      mutateNode(pId, cId, sub, (cmd) => {
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
    setCommandArg: ({ projectId: pId, commandId: cId, sub, index, arg }) =>
      mutateNode(pId, cId, sub, (cmd) => {
        if (index < 0 || index >= cmd.arguments.length) return false;
        const newArgs = [...cmd.arguments];
        newArgs[index] = arg;
        validateArgOrder(newArgs);
        cmd.arguments[index] = arg;
      }),
    removeCommandArg: ({ projectId: pId, commandId: cId, sub, index }) =>
      mutateNode(pId, cId, sub, (cmd) => {
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
        renameBoardKey(project, "command", oldId, newId);
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
    setCommandStep: ({ projectId: pId, commandId: cId, sub, path, step, lang }) =>
      mutateNode(pId, cId, sub, (cmd, project) => {
        const parent = resolveParentMut(cmd.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return false;
        gcStepLTexts(project, [parent[path.index]!]);
        parent[path.index] = step;
        allocStepLTexts(project, cmd.steps, lang, commandNodeKeyPrefix(cId, sub ?? []));
      }),
    addCommandStep: ({ projectId: pId, commandId: cId, sub, frames, index, step, lang }) =>
      mutateNode(pId, cId, sub, (cmd, project) => {
        const parent = resolveParentMut(cmd.steps, frames);
        if (!parent) return false;
        const at = index < 0 || index > parent.length ? parent.length : index;
        parent.splice(at, 0, step);
        allocStepLTexts(project, cmd.steps, lang, commandNodeKeyPrefix(cId, sub ?? []));
      }),
    removeCommandStep: ({ projectId: pId, commandId: cId, sub, path }) =>
      mutateNode(pId, cId, sub, (cmd, project) => {
        const parent = resolveParentMut(cmd.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return false;
        gcStepLTexts(project, [parent[path.index]!]);
        parent.splice(path.index, 1);
      }),
    moveCommandStep: ({ projectId: pId, commandId: cId, sub, from, to }) =>
      mutateNode(pId, cId, sub, (cmd) => {
        if (!moveStepMut(cmd.steps, from, to)) return false;
      }),
    addCommandIfCase: ({ projectId: pId, commandId: cId, sub, frames, ifStepIndex }) =>
      mutateNode(pId, cId, sub, (cmd) => {
        const ifStep = resolveParentMut(cmd.steps, frames)?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return false;
        ifStep.cases.push({ conditions: [], steps: [] });
      }),
    removeCommandIfCase: ({
      projectId: pId,
      commandId: cId,
      sub,
      frames,
      ifStepIndex,
      caseIndex,
    }) =>
      mutateNode(pId, cId, sub, (cmd, project) => {
        const ifStep = resolveParentMut(cmd.steps, frames)?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return false;
        if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return false;
        gcStepLTexts(project, ifStep.cases[caseIndex]!.steps);
        ifStep.cases.splice(caseIndex, 1);
      }),
    setCommandIfCaseConditions: ({
      projectId: pId,
      commandId: cId,
      sub,
      frames,
      ifStepIndex,
      caseIndex,
      conditions,
    }) =>
      mutateNode(pId, cId, sub, (cmd) => {
        const ifStep = resolveParentMut(cmd.steps, frames)?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return false;
        const c = ifStep.cases[caseIndex];
        if (!c) return false;
        c.conditions = conditions;
      }),
    setCommandIfCaseJoin: ({
      projectId: pId,
      commandId: cId,
      sub,
      frames,
      ifStepIndex,
      caseIndex,
      joinIndex,
      op,
    }) =>
      mutateNode(pId, cId, sub, (cmd) => {
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
    toggleCommandIfElse: ({ projectId: pId, commandId: cId, sub, frames, ifStepIndex, enabled }) =>
      mutateNode(pId, cId, sub, (cmd, project) => {
        const ifStep = resolveParentMut(cmd.steps, frames)?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return false;
        if (enabled) {
          if (!ifStep.else) ifStep.else = [];
        } else {
          if (ifStep.else) gcStepLTexts(project, ifStep.else);
          ifStep.else = undefined;
        }
      }),
  };
};
