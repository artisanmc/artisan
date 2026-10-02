import { parseDocRef, projectNamespace } from "@/domain/docRef";
import type { ElementId } from "@/domain/types";
import { projectDestination } from "@/lib/projectNavigation";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import type { useNavigate } from "@tanstack/react-router";

type Navigate = ReturnType<typeof useNavigate>;

/**
 * Aller à un Document : la **seule** façon d'y arriver depuis l'arbre, la
 * palette, la planche générale ou une pastille de lien.
 *
 * Dans le project courant : le Document est sélectionné (l'inspecteur s'ouvre)
 * et la planche se centre dessus — on reste sur la planche, on quitte la vue
 * focus ou un onglet s'il y en avait un. Une référence qualifiée vers un autre
 * project (`boutique:main`) ouvre ce project, centré par le lien `?doc=`.
 * La vue focus reste au double-clic sur un nœud.
 */
export function goToDocument(
  navigate: Navigate,
  args: {
    networkId: string | null | undefined;
    serverId: string | null | undefined;
    project: { id: string; diskId?: string | null };
    ref: string;
  },
): void {
  const { networkId, serverId, project, ref } = args;
  const { namespace, id } = parseDocRef(ref);
  const here = projectNamespace({ id: project.id, diskId: project.diskId ?? undefined });
  if (namespace !== null && namespace !== here) {
    void navigate({
      ...projectDestination(networkId, namespace, serverId),
      search: { doc: id },
    } as never);
    return;
  }
  useSelectionStore.getState().set([id as ElementId]);
  useUiStore.getState().requestCenter(project.id, id);
  void navigate({ ...projectDestination(networkId, project, serverId), search: {} } as never);
}
