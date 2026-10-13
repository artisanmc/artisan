import type { DataSource, Project } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { projectFromFiles } from "@/schema/projectFromFiles";

export interface SourceFile {
  path: string;
  content: string;
}

const base = (project: Project) => `plugins/Artisan/projects/${project.diskId ?? project.id}/`;

/** The paths belonging to this source: its data file (or its per-row
 *  folder) and its beside schema. */
function ownsPath(rel: string, sourceId: string): boolean {
  return (
    rel === `data/${sourceId}.yaml` ||
    rel.startsWith(`data/${sourceId}/`) ||
    rel === `models/${sourceId}.yaml`
  );
}

/**
 * The files of a source, as the canonical writer would emit them — what the
 * YAML tab shows and edits (ADR `yaml-assisted-editing` ⑦/⑧).
 */
export function sourceYamlFiles(project: Project, source: DataSource): SourceFile[] {
  const emitted = transform(project);
  const prefix = base(project);
  return Object.entries(emitted)
    .filter(([full]) => full.startsWith(prefix) && ownsPath(full.slice(prefix.length), String(source.id)))
    .map(([full, content]) => ({ path: full.slice(prefix.length), content }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Writes the edited YAML back into the project: the text is reparsed by the
 * same importer as loading, and **only** the data comes out of it — menus,
 * dialogs and layout are not touched by a source edit.
 *
 * Returns null if the YAML does not parse into a usable project: the caller
 * then keeps the current state (the editor leaves the broken text savable,
 * but does not destroy the domain with it).
 */
export function applySourceYaml(project: Project, edited: SourceFile[]): Project | null {
  const files: Record<string, string> = { ...transform(project) };
  const prefix = base(project);
  // A file removed from the edited set also disappears from the project.
  const editedPaths = new Set(edited.map((f) => prefix + f.path));
  for (const path of Object.keys(files)) {
    if (editedPaths.has(path)) continue;
  }
  for (const f of edited) files[prefix + f.path] = f.content;

  const reparsed = projectFromFiles(project.id, files, {
    name: project.name,
    serverKeyId: project.serverKeyId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
  if (!reparsed) return null;

  return {
    ...project,
    dataSources: reparsed.dataSources,
    dataModels: reparsed.dataModels,
    // The file's ltext values may mint/adopt keys: the translation table follows,
    // otherwise the texts would come back empty.
    i18nKeys: reparsed.i18nKeys,
  };
}
