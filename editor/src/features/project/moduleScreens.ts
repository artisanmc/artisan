import { ownerModuleOf } from "@/components/projectOwnership";
import { projectNamespace } from "@/domain/docRef";
import type { Project } from "@/domain/types";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import { projectCollections } from "@/lib/documentCollections";

/**
 * The settings screens of a module's folder: the screens of its own tables and those of
 * the plugin module that owns it. A collection shows its own screen at the top of its
 * page, so it is not one of them. They are views of the folder: its home lists them and
 * its header has them under **More** (never rows of the sidebar, which lists places).
 */
export function moduleScreensOf(
  project: Project,
  screens: ServerEditorScreen[],
): ServerEditorScreen[] {
  const owner = ownerModuleOf(
    { id: projectNamespace(project), ownerModule: project.ownerModule },
    screens,
  );
  const collectionScreens = new Set(
    projectCollections(project).flatMap((c) => c.collection?.screen ?? []),
  );
  const ns = projectNamespace(project);
  return screens.filter(
    (s) =>
      !collectionScreens.has(s.id) && (s.projectId === ns || (!!owner && s.moduleId === owner)),
  );
}
