import { projectNamespace } from "./docRef";
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

/** What a module's Config screen says of the file it edits (`ServerEditorScreen`). */
interface ScreenTable {
  projectId?: string;
  table: string;
}

/**
 * The declared screen that edits this Project's source `sourceId` (its `table` is
 * `data/<sourceId>`, its `projectId` the Project's disk id), if any.
 */
export function screenOfSource<S extends ScreenTable>(
  project: Pick<Project, "id" | "diskId">,
  sourceId: string,
  screens: S[],
): S | undefined {
  const ns = projectNamespace(project);
  return screens.find(
    (s) => !!s.projectId && s.projectId === ns && s.table.replace(/^data\//, "") === sourceId,
  );
}

/**
 * The sources a Project's tree lists: its own, less the ones a module's screen edits. That
 * screen has its row under the module; a second row would open the generated form instead.
 */
export function listedDataSources(
  project: Pick<Project, "id" | "diskId" | "dataModels" | "dataSources">,
  screens: ScreenTable[],
): DataSource[] {
  return ownDataSources(project).filter((d) => !screenOfSource(project, String(d.id), screens));
}
