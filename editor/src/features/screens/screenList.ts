import type { Project } from "@/domain/types";
import type { ServerEditorScreen } from "@/lib/api/configScreens";

/**
 * Fallback Config screens (ADR module-config-screens): a module that declares
 * models + owns a project but declares no `editor_screens` gets one synthetic
 * screen per declared-model Table/Config found in its owned project. Synthetic
 * ids embed project + source so the route can resolve them without the store.
 */
const FALLBACK_MARK = ":__auto__";

export function fallbackScreensFor(
  moduleId: string,
  ownedProjectIds: string[],
  localProjects: Project[],
): ServerEditorScreen[] {
  const out: ServerEditorScreen[] = [];
  for (const projectId of ownedProjectIds) {
    const local = localProjects.find((p) => p.id === projectId);
    if (!local) continue;
    for (const src of local.dataSources ?? []) {
      const modelId = (src as { modelId?: string }).modelId;
      const model = modelId ? (local.dataModels ?? []).find((m) => m.id === modelId) : undefined;
      if (!model || model.provenance !== "module" || !model.id.startsWith(`${moduleId}:`)) continue;
      out.push({
        id: `${moduleId}${FALLBACK_MARK}${projectId}__${src.id}`,
        moduleId,
        label: src.name,
        table: `data/${src.id}`,
        projectId,
      });
    }
  }
  return out;
}

export function parseFallbackScreenId(
  screenId: string,
): { moduleId: string; projectId: string; sourceId: string } | null {
  const i = screenId.indexOf(FALLBACK_MARK);
  if (i === -1) return null;
  const rest = screenId.slice(i + FALLBACK_MARK.length);
  const j = rest.indexOf("__");
  if (j === -1) return null;
  return {
    moduleId: screenId.slice(0, i),
    projectId: rest.slice(0, j),
    sourceId: rest.slice(j + 2),
  };
}

/** Resolve a route's screenId: declared screen first, else a parsed fallback. */
export function resolveScreen(
  screenId: string,
  declared: ServerEditorScreen[],
  localProjects: Project[],
): ServerEditorScreen | null {
  const found = declared.find((s) => s.id === screenId);
  if (found) return found;
  const parsed = parseFallbackScreenId(screenId);
  if (!parsed) return null;
  const local = localProjects.find((p) => p.id === parsed.projectId);
  const src = local?.dataSources?.find((d) => (d.id as string) === parsed.sourceId);
  return {
    id: screenId,
    moduleId: parsed.moduleId,
    label: src?.name ?? parsed.sourceId,
    table: `data/${parsed.sourceId}`,
    projectId: parsed.projectId,
  };
}
