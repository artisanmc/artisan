import type { ModuleGroupEntry, PluginModule, ProjectRow } from "./projectGroups";

/** What the overview reads of a Version: when, who, which files. */
export interface DeployedVersion {
  createdAt: string;
  /** `null`: the server itself (files edited by hand, then a reload). */
  author: { name: string } | null;
  changed: string[];
}

/**
 * One module of the server, as the overview's table shows it: what the sidebar does not say
 * (where it comes from, when it last went out, what waits in the player's drafts).
 */
export interface ModuleLine {
  key: string;
  /** `addon`: a plugin ships it; `content`: a folder of the admin's. */
  kind: "addon" | "content";
  label: string;
  /** The plugin module, for its icon and version; null for a folder of the admin's. */
  moduleId: string | null;
  /** Its folders (an add-on's, usually one; a folder of the admin's is its own). */
  projects: ProjectRow[];
  /** What else the module manages: its row opens the first when it has no folder. */
  entries: ModuleGroupEntry[];
  /** The newest Version of its folders: undefined while read, null when it never went out. */
  lastDeploy: DeployedVersion | null | undefined;
  /** Files changed in the player's drafts of its folders. */
  pending: number;
}

/** A Version of a folder, under the module it belongs to. */
export interface ActivityEntry {
  key: string;
  label: string;
  moduleId: string | null;
  version: DeployedVersion;
}

/** Versions per folder (project id): undefined while read, null when they could not be read. */
export type VersionsByProject = Readonly<
  Record<string, readonly DeployedVersion[] | null | undefined>
>;

const newestFirst = (a: DeployedVersion, b: DeployedVersion) =>
  b.createdAt.localeCompare(a.createdAt);

/**
 * The newest Version among [projects]: undefined while one of them is still read and none is
 * known yet, null when every folder was read and none ever went out (or could not be read).
 */
function lastDeployOf(
  projects: readonly ProjectRow[],
  versions: VersionsByProject,
): DeployedVersion | null | undefined {
  let newest: DeployedVersion | null = null;
  let reading = false;
  for (const project of projects) {
    const list = versions[project.id];
    if (list === undefined) {
      reading = true;
      continue;
    }
    for (const version of list ?? [])
      if (!newest || newestFirst(version, newest) < 0) newest = version;
  }
  return newest ?? (reading ? undefined : null);
}

/**
 * The server's modules in one list, the plugins' first then the admin's folders, each in the
 * order its caller gives (the sidebar's).
 */
export function moduleLines({
  pluginModules,
  contentModules,
  versions,
  pending,
}: {
  pluginModules: readonly PluginModule[];
  contentModules: readonly ProjectRow[];
  versions: VersionsByProject;
  /** Changed files per folder in the player's drafts. */
  pending: Readonly<Record<string, number>>;
}): ModuleLine[] {
  const pendingOf = (projects: readonly ProjectRow[]) =>
    projects.reduce((sum, p) => sum + (pending[p.id] ?? 0), 0);
  return [
    ...pluginModules.map(
      (m): ModuleLine => ({
        key: `m:${m.id}`,
        kind: "addon",
        label: m.label,
        moduleId: m.id,
        projects: m.projects,
        entries: m.entries,
        lastDeploy: lastDeployOf(m.projects, versions),
        pending: pendingOf(m.projects),
      }),
    ),
    ...contentModules.map(
      (p): ModuleLine => ({
        key: `p:${p.id}`,
        kind: "content",
        label: p.name,
        moduleId: null,
        projects: [p],
        entries: [],
        lastDeploy: lastDeployOf([p], versions),
        pending: pendingOf([p]),
      }),
    ),
  ];
}

/** The latest Versions of every module, newest first, at most [limit]. */
export function recentActivity(
  lines: readonly ModuleLine[],
  versions: VersionsByProject,
  limit = 8,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const line of lines)
    for (const project of line.projects)
      for (const [i, version] of (versions[project.id] ?? []).entries())
        entries.push({
          key: `${project.id}:${i}:${version.createdAt}`,
          label: line.label,
          moduleId: line.moduleId,
          version,
        });
  return entries.sort((a, b) => newestFirst(a.version, b.version)).slice(0, limit);
}

/** The newest Version of the server, across every module; null when none is known. */
export function lastDeployOfServer(lines: readonly ModuleLine[]): DeployedVersion | null {
  let newest: DeployedVersion | null = null;
  for (const line of lines)
    if (line.lastDeploy && (!newest || newestFirst(line.lastDeploy, newest) < 0))
      newest = line.lastDeploy;
  return newest;
}

/** Every folder of [lines], once: the ones whose Versions the overview reads. */
export function foldersOf(lines: readonly ModuleLine[]): ProjectRow[] {
  return lines.flatMap((line) => line.projects);
}
