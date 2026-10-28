import type { DataSource, Project } from "./types";

/**
 * The module whose declared model types this source (`shop:category` → `shop`), or null
 * for the admin's own data. A module-typed source is edited in its module's screen
 * (ADR module-config-screens), whatever its shape.
 */
export function dataSourceModule(
  project: Pick<Project, "dataModels">,
  source: DataSource,
): string | null {
  const modelId = source.modelId;
  if (!modelId) return null;
  const model = (project.dataModels ?? []).find((m) => m.id === modelId);
  return model?.provenance === "module" ? (model.id.split(":")[0] ?? null) : null;
}

/** The Project's own data: the tables and config sheets the sidebar lists and edits. */
export function ownDataSources(project: Pick<Project, "dataModels" | "dataSources">): DataSource[] {
  return (project.dataSources ?? []).filter((d) => dataSourceModule(project, d) === null);
}
