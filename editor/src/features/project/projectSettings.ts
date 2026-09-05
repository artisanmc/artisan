import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";

/**
 * Montrer les paramètres du project dans le panneau d'édition. Ils ne
 * correspondent à aucune sélection — depuis que le panneau est l'inspecteur de
 * la sélection, il faut le demander explicitement. Trois portes d'entrée (la
 * racine de l'arbre, le clic droit sur le fond du canvas, le kebab de la
 * topbar) pour un seul geste : vider la sélection, puis lever le drapeau.
 */
export function openProjectSettings(): void {
  useSelectionStore.getState().clear();
  useUiStore.getState().setProjectSettingsOpen(true);
}
