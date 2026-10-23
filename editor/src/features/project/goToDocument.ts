import { parseDocRef, projectNamespace } from "@/domain/docRef";
import type { ElementId } from "@/domain/types";
import { projectDestination } from "@/lib/projectNavigation";
import { useSelectionStore } from "@/state/selectionStore";
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
  const { namespace, id } = parseDocRef(ref);
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
