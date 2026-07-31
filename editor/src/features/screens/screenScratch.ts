import type { Project, ProjectId } from "@/domain/types";
import { injectDeclaredModels } from "@/domain/dataModels";
import { transform } from "@/features/export/transform";
import type { ConfigFile, ServerEditorScreen } from "@/lib/api/configScreens";
import { projectFromFiles } from "@/schema/projectFromFiles";

/**
 * Config screens edit a live working copy held in the account store under a
 * scratch project id (ADR module-config-screens). The scratch is NEVER
 * persisted to the backend (filtered out of the auto-save and the sidebar) —
 * saving goes through the WS live channel (`configWrite`) instead.
 */
const SCRATCH_PREFIX = "__screen__";

/** Path of the schema file living beside a screen's table (`data/x` → `models/x`). */
export function besideModelPath(table: string): string {
  return `models/${table.split("/").pop() ?? ""}`;
}

export function screenScratchId(screenId: string): ProjectId {
  return `${SCRATCH_PREFIX}${screenId.replace(":", "_")}` as ProjectId;
}

export function isScreenScratchId(projectId: string): boolean {
  return projectId.startsWith(SCRATCH_PREFIX);
}

/**
 * Build the scratch Project from the files returned by `configRead`. Paths are
 * project-relative (`data/categories/weapons.yaml`); the declared models are
 * injected so the table resolves its schema from the JAR declaration.
 */
export function buildScratchProject(
  screen: ServerEditorScreen,
  files: ConfigFile[],
  declaredModels: Record<string, unknown>[],
): Project {
  const id = screenScratchId(screen.id);
  const base = `plugins/Artisan/projects/${id}`;
  const fileMap: Record<string, string> = {
    [`${base}/manifest.yaml`]:
      `schema: manifest/v1\nproject_id: ${id}\ndefault_lang: en\nlanguages: [en]\nfiles:\n  menus: []\n  commands: []\n`,
  };
  for (const f of files) fileMap[`${base}/${f.path}`] = f.content;
  const project = projectFromFiles(id, fileMap, { name: screen.label });
  injectDeclaredModels(project, declaredModels);
  return project;
}

/**
 * Serialize the scratch back to the screen's table files and diff against the
 * originally-read set: returns the writes (changed or new) and the deletes
 * (originally present, no longer emitted — e.g. a removed per-row file).
 */
export function diffScratchForWrite(
  project: Project,
  screen: ServerEditorScreen,
  original: ConfigFile[],
): { files: ConfigFile[]; deletes: string[] } {
  const base = `plugins/Artisan/projects/${project.id}/`;
  const emitted = transform(project);
  const tablePrefix = `${screen.table}/`;
  const tableFile = (p: string) =>
    p === `${screen.table}.yaml` || p === `${screen.table}.yml` || p.startsWith(tablePrefix);
  // A project-authored source keeps its schema in `models/<id>.yaml` beside the
  // data file (the canonical writer emits values-only). It travels with the
  // table: dropping it would strip the schema from disk on the first save.
  const sourceId = screen.table.split("/").pop() ?? "";
  const besideModel = (p: string) => p === `models/${sourceId}.yaml`;

  const current = new Map<string, string>();
  for (const [full, content] of Object.entries(emitted)) {
    if (!full.startsWith(base)) continue;
    const rel = full.slice(base.length);
    if (tableFile(rel) || besideModel(rel)) current.set(rel, content);
  }

  const originalByPath = new Map(original.map((f) => [f.path, f.content]));
  const files: ConfigFile[] = [];
  for (const [path, content] of current) {
    if (originalByPath.get(path) !== content) files.push({ path, content });
  }
  const deletes: string[] = [];
  for (const path of originalByPath.keys()) {
    if (tableFile(path) && !current.has(path)) deletes.push(path);
  }
  return { files, deletes };
}
