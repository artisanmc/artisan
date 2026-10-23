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

/**
 * A command a module declares, drawn on the board of a module folder (design
 * `framework-commandes` §3.9): read-only there, edited on its System page. Its
 * links come from what runs in its place: the admin's `steps`, else the menu
 * the module declares (`opensMenu`). The module's own code draws none.
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
 * The module commands of [project]'s board: every root its module declares, and
 * each sub-command that links somewhere (its own `steps` or menu); a sub-command
 * running the module's code has nothing to draw and stays on the System page.
 */
export function moduleCommandsOf(project: Folder, input: ModuleCommandsInput): ModuleCommandNode[] {
  return moduleCommandEntriesOf(project, input).flatMap(({ command, override, root, label }) => {
    const chain = chainOf(command, override);
    if (!root && chain === undefined) return [];
    return [
      {
        id: command.id,
        label,
        moduleId: moduleOf(command),
        state: overrideState(override),
        runs: override?.steps != null ? "steps" : command.opensMenu ? "menu" : null,
        command: syntheticCommand(project.id, command.id, label, chain),
      },
    ];
  });
}

function syntheticCommand(
  projectId: Project["id"],
  id: string,
  label: string,
  chain: unknown,
): Command {
  const steps =
    chain === undefined
      ? []
      : commandV1ToDomain({ id, name: label, actions: chain }, { projectId, lang: "en" }).command
          .steps;
  return { id: id as CommandId, projectId, name: label, arguments: [], steps };
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
