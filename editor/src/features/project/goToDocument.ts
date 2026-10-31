import { parseDocRef, projectNamespace } from "@/domain/docRef";
import { docKey, isDocKey, parseDocKey, resolveDocKey } from "@/domain/documents";
import { isCollectionKind } from "@/lib/documentCollections";
import { projectDestination } from "@/lib/projectNavigation";
import { useProjectsStore } from "@/state/projectsStore";
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
 * The focus view stays on double-click on a node. A collection's Document (SDK 1.9), which
 * has no node on the board, opens on its own view instead.
 *
 * [ref]: a key (`menu/main`), a bare id, or a qualified ref. Two kinds may share an id:
 * [kind], when the caller knows it, says which Document; a bare id without it goes to the
 * first of that id (`resolveDocKey`).
 */
export function goToDocument(
  navigate: Navigate,
  args: {
    serverId: string | null | undefined;
    project: { id: string; diskId?: string | null };
    ref: string;
    kind?: string;
  },
): void {
  const { serverId, project, ref } = args;
  // A key may carry a qualified id (`menu/boutique:main`, a link chip's target).
  const keyed = isDocKey(ref) ? parseDocKey(ref) : null;
  const kind = keyed?.kind ?? args.kind;
  const { namespace, id } = parseDocRef(keyed?.id ?? ref);
  const here = projectNamespace({ id: project.id, diskId: project.diskId ?? undefined });
  if (namespace !== null && namespace !== here) {
    void navigate({
      ...projectDestination(namespace, serverId),
      search: { doc: kind ? docKey(kind, id) : id },
    } as never);
    return;
  }
  const documents = useProjectsStore
    .getState()
    .openProjects.projects.find((p) => p.id === project.id);
  const key = kind ? docKey(kind, id) : documents ? resolveDocKey(documents, id) : undefined;
  // A collection's Document has no node on the board (SDK 1.9): it opens on its own view.
  const keyKind = key ? parseDocKey(key)?.kind : undefined;
  if (key && keyKind && isCollectionKind(keyKind)) {
    useSelectionStore.getState().set([key]);
    void navigate(projectDestination(project, serverId, id, keyKind) as never);
    return;
  }
  if (key) {
    useSelectionStore.getState().set([key]);
    useUiStore.getState().requestCenter(project.id, key);
  }
  void navigate({ ...projectDestination(project, serverId), search: { tab: "board" } } as never);
}
