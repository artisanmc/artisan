import { ownerModuleOf } from "@/components/projectOwnership";
import { selectModuleNavEntries } from "@/distribution/moduleNav";
import type { Project } from "@/domain/types";
import { fallbackScreensFor } from "@/features/screens/screenList";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import type { ProjectSummary } from "@/lib/api/networks";
import { LOCAL_ID } from "@/lib/localServer";
import { getModule } from "@artisan/editor-sdk";

export type OwnedProject = ProjectSummary & { ownerModule: string };

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
        networkId: LOCAL_ID,
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

/** A row under a module. `label: null` = the generic "Editor" entry: the
 *  module name is already carried by the group header. */
export type ModuleGroupEntry =
  | { kind: "project"; project: OwnedProject; label: string | null }
  | { kind: "screen"; screen: ServerEditorScreen }
  | { kind: "config"; moduleId: string };

export interface ModuleGroup {
  id: string;
  label: string;
  projects: OwnedProject[];
  screens: ServerEditorScreen[];
  /** The module has an editor route (`/m/<id>`) → "Configuration" entry. */
  hasScreen: boolean;
  entries: ModuleGroupEntry[];
  /** The whole group fits in a single project entry: a surface that prefers a
   *  single row shows it under the module name (shop case). */
  collapsed: boolean;
}

export interface ProjectGroupsInput {
  /** The server's Projects, already ordered by the calling surface. */
  projects: ProjectSummary[];
  screens: ServerEditorScreen[];
  mountedModuleIds: string[];
  localProjects: Project[];
}

/**
 * Splits ordinary Projects from Projects owned by an Add-on
 * (ADR `addon-owned-project-roots`) and composes, for each installed module,
 * its group: the canvas, its Config screens (ADR `module-config-screens`) and
 * its configuration route.
 *
 * Pure, shared function: the sidebar and a server's page show the same thing
 * because they read the same list, not because the rule was copied twice.
 */
export function buildProjectGroups({
  projects,
  screens,
  mountedModuleIds,
  localProjects,
}: ProjectGroupsInput): { flatProjects: ProjectSummary[]; moduleGroups: ModuleGroup[] } {
  const owned = projects.map((p) => ({ p, owner: ownerModuleOf(p, screens) }));
  const flatProjects = owned.filter((e) => !e.owner).map((e) => e.p);
  const ownedProjects: OwnedProject[] = owned
    .filter((e) => e.owner)
    .map((e) => ({ ...e.p, ownerModule: e.owner as string }));

  const nav = selectModuleNavEntries(mountedModuleIds);
  const navIds = nav.map((m) => m.id);
  const groupIds = Array.from(
    new Set<string>([...navIds, ...ownedProjects.map((p) => p.ownerModule)]),
  );

  const moduleGroups = groupIds.map((id) => {
    const groupProjects = ownedProjects.filter((p) => p.ownerModule === id);
    // Screens declared in the Presence; failing that, screens synthesised from
    // the owned project's declared model tables.
    const declared = screens.filter((s) => s.moduleId === id);
    const groupScreens =
      declared.length > 0
        ? declared
        : fallbackScreensFor(
            id,
            groupProjects.map((p) => p.id),
            localProjects,
          );
    const hasScreen = navIds.includes(id);
    const entries: ModuleGroupEntry[] = [
      ...groupProjects.map(
        (project): ModuleGroupEntry => ({
          kind: "project",
          project,
          label: groupProjects.length === 1 ? null : project.name,
        }),
      ),
      ...groupScreens.map((screen): ModuleGroupEntry => ({ kind: "screen", screen })),
      ...(hasScreen ? [{ kind: "config", moduleId: id } as ModuleGroupEntry] : []),
    ];
    return {
      id,
      // A routable module carries a sidebar label; otherwise its displayName.
      // moduleNav only lists modules WITH a screen — fall back to the registered
      // module's displayName for the others (shop).
      label: nav.find((m) => m.id === id)?.sidebar.label ?? getModule(id)?.displayName ?? id,
      projects: groupProjects,
      screens: groupScreens,
      hasScreen,
      entries,
      collapsed: entries.length === 1 && entries[0]!.kind === "project",
    };
  });

  return { flatProjects, moduleGroups };
}
