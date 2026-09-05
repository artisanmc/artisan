import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect, useMemo } from "react";
import { type SelectionContext, selectionContext } from "./selectionContext";

export interface Inspector {
  /** Le panneau doit-il exister ? */
  open: boolean;
  ctx: SelectionContext;
}

/**
 * La règle d'ouverture du panneau d'édition, écrite UNE fois. Le panneau est
 * monté à deux endroits (la planche et la vue focus) ; la dupliquer là-bas,
 * c'est se garantir qu'ils divergeront.
 *
 * Règle : présent ssi quelque chose est sélectionné — ou si l'utilisateur a
 * explicitement demandé les paramètres du project, qui ne correspondent à
 * aucune sélection.
 */
export function useInspector(projectId: ProjectId): Inspector {
  const ids = useSelectionStore((s) => s.ids);
  const selectionMenuId = useSelectionStore((s) => s.menuId);
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const projectSettingsOpen = useUiStore((s) => s.projectSettingsOpen);
  const setProjectSettingsOpen = useUiStore((s) => s.setProjectSettingsOpen);

  const ctx = useMemo(
    () => selectionContext(project, ids, selectionMenuId),
    [project, ids, selectionMenuId],
  );

  // Sélectionner quoi que ce soit range les paramètres du project : sans ça,
  // revenir à une sélection vide les rouvrirait alors que l'utilisateur vient
  // justement de désélectionner pour dégager le canvas.
  useEffect(() => {
    if (ids.size > 0 && projectSettingsOpen) setProjectSettingsOpen(false);
  }, [ids.size, projectSettingsOpen, setProjectSettingsOpen]);

  return { open: ids.size > 0 || projectSettingsOpen, ctx };
}
