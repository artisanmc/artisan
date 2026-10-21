import { ownerModuleOf } from "@/components/projectOwnership";
import { selectModuleNavEntries } from "@/distribution/moduleNav";
import type { Project } from "@/domain/types";
import { fallbackScreensFor } from "@/features/screens/screenList";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import type { PlayerCommand } from "@/lib/api/playerCommands";
import type { ProjectSummary } from "@/lib/api/servers";
import { getModule } from "@artisan/editor-sdk";

/**
 * The ids read from the server's disk, presented as Projects.
 *
 * Nothing more to say: the folder name IS the identity (ADR
 * `server-disk-only-storage`). The fields that described the old copy
 * (`hash`) stay empty — a single factory so the sidebar and a server's page
 * do not diverge.
 */
export function diskProjectsToSummaries(
  serverKeyId: string,
  projectIds: string[],
  metadata: ProjectSummary[] = [],
): ProjectSummary[] {
  const projects = projectIds.map(
    (id) =>
      metadata.find((project) => (project.externalId ?? project.id) === id) ?? {
        id,
        name: id,
        externalId: id,
        hash: "",
        serverKeyId,
      },
  );
  return [
    ...projects,
    ...metadata.filter(
      (project) => project.pendingRename && !projects.some((listed) => listed.id === project.id),
    ),
  ];
}

/** A project of the list. `ownerModule`: the module that ships it (ADR
 *  `addon-owned-project-roots`), null for an ordinary project; `ownerLabel`: that
 *  module's name, for the badge. */
export type ProjectRow = ProjectSummary & { ownerModule: string | null; ownerLabel: string | null };

/** A row under a module: one of its Config screens, or its configuration route. */
export type ModuleGroupEntry =
  | { kind: "screen"; screen: ServerEditorScreen }
  | { kind: "config"; moduleId: string };

export interface ModuleGroup {
  id: string;
  label: string;
  screens: ServerEditorScreen[];
  /** The module has an editor route (`/m/<id>`) → "Configuration" entry. */
  hasScreen: boolean;
  entries: ModuleGroupEntry[];
}

export interface ProjectGroupsInput {
  /** The server's Projects, already ordered by the calling surface. */
  projects: ProjectSummary[];
  screens: ServerEditorScreen[];
  mountedModuleIds: string[];
  localProjects: Project[];
}

/**
 * Splits the two things a server offers by task, not by owner:
 *
 * - `projects`: **every** Project, in one list. A module is usable in any project,
 *   so the content a module ships is a project like the others, badged with the
 *   module's name (`ownerLabel`) instead of hidden under it.
 * - `moduleGroups`: what only the module manages — its Config screens (ADR
 *   `module-config-screens`) and its configuration route. A module with neither
 *   has no group. A module's configuration root (`role: "config"`) is reached
 *   through these screens only: it holds settings, not content, so it is left out
 *   of `projects`.
 *
 * Pure, shared function: the sidebar and a server's page show the same thing
 * because they read the same list, not because the rule was copied twice.
 */
export function buildProjectGroups({
  projects,
  screens,
  mountedModuleIds,
  localProjects,
}: ProjectGroupsInput): { projects: ProjectRow[]; moduleGroups: ModuleGroup[] } {
  const nav = selectModuleNavEntries(mountedModuleIds);
  const navIds = nav.map((m) => m.id);
  // A routable module carries a sidebar label; otherwise its displayName.
  // moduleNav only lists modules WITH a screen — fall back to the registered
  // module's displayName for the others (shop).
  const labelOf = (id: string) =>
    nav.find((m) => m.id === id)?.sidebar.label ?? getModule(id)?.displayName ?? id;

  const rows: ProjectRow[] = projects.map((p) => {
    const owner = ownerModuleOf(p, screens) ?? null;
    return { ...p, ownerModule: owner, ownerLabel: owner ? labelOf(owner) : null };
  });

  const groupIds = Array.from(
    new Set<string>([
      ...navIds,
      ...rows.flatMap((p) => (p.ownerModule ? [p.ownerModule] : [])),
      ...screens.flatMap((s) => (s.moduleId ? [s.moduleId] : [])),
    ]),
  );

  const moduleGroups = groupIds
    .map((id): ModuleGroup => {
      // Screens declared in the Presence; failing that, screens synthesised from
      // the owned project's declared model tables.
      const declared = screens.filter((s) => s.moduleId === id);
      const groupScreens =
        declared.length > 0
          ? declared
          : fallbackScreensFor(
              id,
              rows.filter((p) => p.ownerModule === id).map((p) => p.id),
              localProjects,
            );
      const hasScreen = navIds.includes(id);
      const entries: ModuleGroupEntry[] = [
        ...groupScreens.map((screen): ModuleGroupEntry => ({ kind: "screen", screen })),
        ...(hasScreen ? [{ kind: "config", moduleId: id } as ModuleGroupEntry] : []),
      ];
      return { id, label: labelOf(id), screens: groupScreens, hasScreen, entries };
    })
    .filter((g) => g.entries.length > 0);

  return { projects: rows.filter((p) => p.role !== "config"), moduleGroups };
}

/**
 * A plugin's module: the folder(s) it registered (`projects`, usually one, never its
 * configuration root) and what it alone manages (`entries`: Config screens, then its
 * configuration route).
 */
export interface PluginModule {
  id: string;
  label: string;
  projects: ProjectRow[];
  entries: ModuleGroupEntry[];
  /** Its system commands (design `framework-commandes` §3.9), root commands only. */
  commands: PlayerCommand[];
}

/**
 * The server's modules, one folder = one module (design `projets-en-modules`):
 *
 * - `pluginModules`: every module a plugin provides, with its folders, screens and system
 *   commands, sorted by name. A module with neither a folder nor anything to configure is left out.
 * - `contentModules`: the admin's folders, owned by no plugin, in the caller's order.
 *
 * Built on [buildProjectGroups]: the same owners, labels and screens, grouped by module.
 */
export function buildModuleList(
  input: ProjectGroupsInput & {
    /** The commands the server's modules declare: each goes under its module, created if needed. */
    commands?: PlayerCommand[];
  },
): {
  pluginModules: PluginModule[];
  contentModules: ProjectRow[];
} {
  const { projects, moduleGroups } = buildProjectGroups(input);
  const byId = new Map<string, PluginModule>(
    moduleGroups.map((g) => [
      g.id,
      { id: g.id, label: g.label, projects: [], entries: g.entries, commands: [] },
    ]),
  );
  const contentModules: ProjectRow[] = [];
  for (const row of projects) {
    if (!row.ownerModule) {
      contentModules.push(row);
      continue;
    }
    const module = byId.get(row.ownerModule) ?? {
      id: row.ownerModule,
      label: row.ownerLabel ?? row.ownerModule,
      projects: [],
      entries: [],
      commands: [],
    };
    module.projects.push(row);
    byId.set(module.id, module);
  }
  // A command registered outside a module (no module id) goes under the module of its namespace.
  for (const command of input.commands ?? []) {
    const id = command.moduleId ?? command.id.slice(0, command.id.indexOf(":"));
    const module = byId.get(id) ?? { id, label: id, projects: [], entries: [], commands: [] };
    module.commands.push(command);
    byId.set(id, module);
  }
  const pluginModules = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  return { pluginModules, contentModules };
}
