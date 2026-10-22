import { parseDocRef, projectNamespace } from "@/domain/docRef";
import type { ElementId, ProjectId } from "@/domain/types";
import { moduleCommandsOf } from "@/lib/moduleCommands";
import { projectDestination } from "@/lib/projectNavigation";
import { useSelectionStore } from "@/state/selectionStore";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { useUiStore } from "@/state/uiStore";
import type { useNavigate } from "@tanstack/react-router";

type Navigate = ReturnType<typeof useNavigate>;

/**
 * Go to a Document: the **only** way to get there from the tree, the palette,
 * the overview board or a link chip.
 *
 * In the current project: the Document is selected (the inspector opens) and
 * the board centers on it — we stay on the board, leaving the focus view or a
 * tab if there was one. A qualified ref to another project (`boutique:main`)
 * opens that project, centered via the `?doc=` link.
 * The focus view stays on double-click on a node.
 */
export function goToDocument(
  navigate: Navigate,
  args: {
    serverId: string | null | undefined;
    project: { id: string; diskId?: string | null };
    ref: string;
  },
): void {
  const { serverId, project, ref } = args;
  // A module command drawn on this project's board (`boutique:open`) reads like a
  // qualified ref: it is selected here, its form in the Properties panel.
  const { namespace, id } = isModuleCommandOf(project, ref)
    ? { namespace: null, id: ref }
    : parseDocRef(ref);
  const here = projectNamespace({ id: project.id, diskId: project.diskId ?? undefined });
  if (namespace !== null && namespace !== here) {
    void navigate({
      ...projectDestination(namespace, serverId),
      search: { doc: id },
    } as never);
    return;
  }
  useSelectionStore.getState().set([id as ElementId]);
  useUiStore.getState().requestCenter(project.id, id);
  void navigate({ ...projectDestination(project, serverId), search: {} } as never);
}

function isModuleCommandOf(project: { id: string; diskId?: string | null }, ref: string): boolean {
  if (!ref.includes(":")) return false;
  const { commands, overrides, folders } = useSystemCommandsStore.getState();
  const folder = { id: project.id as ProjectId, diskId: project.diskId ?? undefined };
  return moduleCommandsOf(folder, { commands, overrides, folders }).some((n) => n.id === ref);
}
