import type { ServerEditorScreen } from "@/lib/api/configScreens";

/**
 * The module owning a Project (ADR `addon-owned-project-roots`), or
 * `undefined` for an ordinary project.
 *
 * Re-reading the project manifest would cost a disk round-trip per Project
 * just to fill a sidebar, so it is derived from the **declared screens**, where
 * the module itself announced the project it owns — the same Presence data
 * that makes its group exist.
 *
 * First, `ownerModule`: the module the plugin reported with the Add-on root
 * (`register(projectId, dir, moduleId)`). It is the only source for an Add-on
 * without a configuration screen (MSGuilds: menus only); screens remain the
 * fallback for an Add-on that does not name its module.
 *
 * Matching is done on the **disk id**: it is the one the module declares, and
 * it differs from the internal id as soon as another server has already
 * claimed the same name (cf. `projects.externalId`).
 */
export function ownerModuleOf(
  project: { id: string; externalId?: string | null; ownerModule?: string | null },
  screens: ServerEditorScreen[],
): string | undefined {
  if (project.ownerModule) return project.ownerModule;
  const diskId = project.externalId ?? project.id;
  return screens.find((s) => s.projectId === diskId && s.moduleId)?.moduleId ?? undefined;
}
