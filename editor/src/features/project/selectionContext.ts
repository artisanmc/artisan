import type { Project } from "@/domain/types";

/**
 * Ce que la sélection courante désigne, pour le project donné. Une seule
 * dérivation, partagée par le dispatch du panneau (`FlowCanvas`) et par le
 * gating de ses onglets — les écrire deux fois, c'est les faire diverger.
 */
/**
 * Les ids sont des `string` nus : ce type traverse les familles (menu,
 * commande, dialogue, élément) et leurs marques nominales ne se recouvrent
 * pas. Le rebranding se fait chez l'appelant, qui sait ce qu'il cherche.
 */
export type SelectionContext =
  | { kind: "none" }
  | { kind: "multi" }
  | { kind: "menu"; menuId: string }
  | { kind: "element"; menuId: string; elementId: string }
  | { kind: "command"; id: string }
  | { kind: "dialog"; id: string }
  | { kind: "unknown" };

export function selectionContext(
  project: Project | undefined,
  ids: ReadonlySet<string>,
  selectionMenuId: string | null,
): SelectionContext {
  if (!project) return { kind: "none" };
  if (ids.size > 1) return { kind: "multi" };
  if (ids.size === 0) return { kind: "none" };

  const id = [...ids][0]!;
  if (project.commands.some((c) => c.id === id)) return { kind: "command", id };
  if ((project.dialogs ?? []).some((d) => d.id === id)) return { kind: "dialog", id };

  // Un id d'élément n'est unique QUE dans son menu (menu/v1) : on restreint la
  // résolution au menu où la sélection a été faite, sinon un id partagé (deux
  // menus avec `grid`) éditerait le mauvais.
  const menus = selectionMenuId
    ? project.menus.filter((m) => m.id === selectionMenuId)
    : project.menus;
  for (const menu of menus) {
    for (const layer of menu.layers) {
      if (layer.elements.some((e) => e.id === id)) {
        return { kind: "element", menuId: menu.id, elementId: id };
      }
    }
  }

  const menu = project.menus.find((m) => m.id === id);
  if (menu) return { kind: "menu", menuId: menu.id };
  return { kind: "unknown" };
}

/**
 * Les onglets Bibliothèque et Assets n'ont de sens que s'il y a un menu où
 * déposer un item ou un glyphe — pas dans une commande ni un dialogue.
 */
export function isMenuContext(ctx: SelectionContext): boolean {
  return ctx.kind === "menu" || ctx.kind === "element";
}
