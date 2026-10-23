import { walkDocumentRefs } from "@/domain/actionArgs";
import type { Command, CommandId, Project } from "@/domain/types";
import type { PlayerCommand } from "@/lib/api/playerCommands";
import {
  type OverrideState,
  type StoredOverride,
  overrideState,
  withProjectOverrides,
} from "@/lib/commandOverride";
import { commandV1ToDomain } from "@/schema/commandV1ToDomain";
import type { CommandFolder } from "@/state/systemCommandsStore";

/** A sub-command, a row of its root's node (as a quest is of its group's). */
export interface ModuleSubCommand {
  /** `<module>:<root>.<child>`: never a node of its own. */
  id: string;
  /** After the root's name, as players type it: `sell`, `balance add`. */
  label: string;
  /** 1 under the root, 2 under a sub-command… */
  depth: number;
  state: OverrideState;
}

/**
 * A root command a module declares, drawn on the board of a module folder (design
 * `framework-commandes` §3.9) with a row per sub-command: read-only there, edited in the
 * Properties panel. Its links come from what runs in place of the module's code, its
 * sub-commands' included: the admin's `steps`, else the menu the module declares
 * (`opensMenu`). The module's own code draws none.
 */
export interface ModuleCommandNode {
  /** `<module>:<name>`: the node's id on the board, never a Document id (they have no `:`). */
  id: string;
  /** As players type it: `boutique`, `g balance add`. */
  label: string;
  moduleId: string;
  state: OverrideState;
  /** What its links come from; null: the module's code, no link. */
  runs: "steps" | "menu" | null;
  /** Its sub-commands, depth first. */
  children: ModuleSubCommand[];
  /** The synthetic Command the board's edges and layout read. */
  command: Command;
}

export interface ModuleCommandsInput {
  commands: PlayerCommand[];
  overrides: Record<string, StoredOverride>;
  folders: CommandFolder[];
}

/** A module command id; a Document id never holds `:`. */
export const isModuleCommandId = (id: string): boolean => id.includes(":");

const moduleOf = (command: PlayerCommand): string =>
  command.moduleId ?? command.id.slice(0, command.id.indexOf(":"));

/** The project's folder on disk: what overrides and `ownerModule` speak of. */
const folderOf = (project: Pick<Project, "id" | "diskId">): string => project.diskId ?? project.id;

/**
 * The folder a command shows in: the one holding its override (where its `steps`
 * resolve a bare id), else the module's first folder by name, else its namespace's.
 */
export function homeFolder(
  command: PlayerCommand,
  overrides: Record<string, StoredOverride>,
  folders: CommandFolder[],
  fallback: string | null,
): string | null {
  const stored = overrides[command.id]?.folder;
  if (stored) return stored;
  if (fallback) return fallback;
  const module = moduleOf(command);
  const owned = folders
    .filter((f) => f.ownerModule === module)
    .map((f) => f.folder)
    .sort();
  // A module without a folder of its own: the one named after its namespace, created for it.
  const namespace = command.id.slice(0, command.id.indexOf(":"));
  return owned[0] ?? folders.find((f) => f.folder === namespace)?.folder ?? null;
}

function chainOf(command: PlayerCommand, override: StoredOverride | undefined): unknown {
  if (override?.steps != null) return override.steps;
  return command.opensMenu ? [{ open_menu: command.opensMenu }] : undefined;
}

/** A module command whose texts and System page belong to a folder. */
export interface ModuleCommandEntry {
  command: PlayerCommand;
  override: StoredOverride | undefined;
  /** A root command: only a root has a name and aliases of its own. */
  root: boolean;
  /** As players type it: `boutique`, `g balance add`. */
  label: string;
}

type Folder = Pick<Project, "id" | "diskId"> & Partial<Pick<Project, "moduleData">>;

/**
 * Every command of the modules shown in [project]'s folder, sub-commands included: those
 * whose override it holds, else, with no override, those of its module (a sub-command
 * follows its root). A Project read from files speaks for its own overrides (its draft's
 * edits included); the server's disk for the other folders'.
 */
export function moduleCommandEntriesOf(
  project: Folder,
  input: ModuleCommandsInput,
): ModuleCommandEntry[] {
  const folder = folderOf(project);
  const overrides = withProjectOverrides(input.overrides, project);
  const out: ModuleCommandEntry[] = [];
  const visit = (command: PlayerCommand, path: string[], parentHome: string | null) => {
    const override = overrides[command.id];
    const root = path.length === 0;
    const name = root ? override?.fields.name?.trim() || command.name : command.name;
    const home = homeFolder(command, overrides, input.folders, root ? null : parentHome);
    if (home === folder) out.push({ command, override, root, label: [...path, name].join(" ") });
    for (const child of command.children) visit(child, [...path, name], home);
  };
  for (const command of input.commands) visit(command, [], null);
  return out;
}

/**
 * The module commands of [project]'s board: one node per root its module declares, its
 * sub-commands as rows. The node's chain gathers theirs; a menu a sub-command opens links
 * from that sub-command's row (`moduleCommandRefs`).
 */
export function moduleCommandsOf(project: Folder, input: ModuleCommandsInput): ModuleCommandNode[] {
  const nodes: {
    node: Omit<ModuleCommandNode, "command">;
    chains: unknown[];
    rootChain: unknown;
    rowChains: unknown[];
  }[] = [];
  // Each sub-command's root: the node whose row it is.
  const rootOf = new Map<string, string>();
  const walk = (root: string, children: PlayerCommand[]) => {
    for (const child of children) {
      rootOf.set(child.id, root);
      walk(root, child.children);
    }
  };
  for (const command of input.commands) walk(command.id, command.children);
  for (const { command, override, root, label } of moduleCommandEntriesOf(project, input)) {
    const chain = chainOf(command, override);
    const state = overrideState(override);
    if (root) {
      nodes.push({
        node: {
          id: command.id,
          label,
          moduleId: moduleOf(command),
          state,
          runs: override?.steps != null ? "steps" : command.opensMenu ? "menu" : null,
          children: [],
        },
        chains: chain === undefined ? [] : [chain],
        rootChain: chain,
        rowChains: [],
      });
      continue;
    }
    // A sub-command whose root shows in another folder has no node here.
    const parent = nodes.find((n) => n.node.id === rootOf.get(command.id));
    if (!parent) continue;
    const path = label.split(" ");
    parent.node.children.push({
      id: command.id,
      label: path.slice(1).join(" "),
      depth: path.length - 1,
      state,
    });
    parent.rowChains.push(chain);
    if (chain !== undefined) parent.chains.push(chain);
  }
  return nodes.map(({ node, chains, rootChain, rowChains }) => ({
    ...node,
    command: syntheticCommand(
      project.id,
      node.id,
      node.label,
      chains.length === 0 ? undefined : chains.flatMap((c) => (Array.isArray(c) ? c : [c])),
      rootChain,
      rowChains,
    ),
  }));
}

/** The node a module command shows in: itself, or the root whose row it is. */
export function moduleCommandNodeOf(
  nodes: ModuleCommandNode[],
  id: string,
): { node: ModuleCommandNode; item: string | null } | null {
  for (const node of nodes) {
    if (node.id === id) return { node, item: null };
    if (node.children.some((child) => child.id === id)) return { node, item: id };
  }
  return null;
}

interface SubCommandRows {
  count: number;
  /** The Documents the root's own chain references (raw refs). */
  root: string[];
  /** The Documents each row's chain references (raw refs), by row. */
  rows: string[][];
}

const subCommandRows = new WeakMap<Command, SubCommandRows>();

/** How many sub-command rows the node of a synthetic command has (0 for any other command). */
export const moduleCommandRows = (command: Command): number =>
  subCommandRows.get(command)?.count ?? 0;

/**
 * The Documents a synthetic command's chains reference (raw refs): its root's own, and
 * each sub-command row's, by row.
 */
export const moduleCommandRefs = (command: Command): { root: string[]; rows: string[][] } => {
  const entry = subCommandRows.get(command);
  return { root: entry?.root ?? [], rows: entry?.rows ?? [] };
};

const stepsOf = (projectId: Project["id"], id: string, label: string, chain: unknown) =>
  chain === undefined
    ? []
    : commandV1ToDomain({ id, name: label, actions: chain }, { projectId, lang: "en" }).command
        .steps;

function syntheticCommand(
  projectId: Project["id"],
  id: string,
  label: string,
  chain: unknown,
  rootChain: unknown,
  rowChains: unknown[],
): Command {
  const steps = stepsOf(projectId, id, label, chain);
  const command: Command = { id: id as CommandId, projectId, name: label, arguments: [], steps };
  const refsOf = (c: unknown) =>
    [...walkDocumentRefs(stepsOf(projectId, id, label, c))].map((r) => r.id).filter(Boolean);
  subCommandRows.set(command, {
    count: rowChains.length,
    root: refsOf(rootChain),
    rows: rowChains.map(refsOf),
  });
  return command;
}

/**
 * [project] as the board reads it: its own Documents plus [nodes] as commands, so that
 * edges, layout and off-board chips treat them like any command. Never stored: the
 * project the store holds and saves stays without them.
 */
export function withModuleCommands(project: Project, nodes: ModuleCommandNode[]): Project {
  if (nodes.length === 0) return project;
  return {
    ...project,
    documents: {
      ...project.documents,
      command: [...(project.documents.command ?? []), ...nodes.map((n) => n.command)],
    },
  };
}
