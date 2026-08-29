import type { Menu } from "@/domain/types";

/**
 * Un placement dont la ligne ne résout pas : faut-il l'AFFICHER ?
 *
 * Deux situations très différentes se ressemblent, et les confondre est ce qui
 * remplit un menu de cases pointillées :
 *
 * - **La ligne a disparu.** La source n'est filtrée par rien : ce que le
 *   placement désigne aurait dû être là. Le montrer (case vide, pointillés) est
 *   le seul moyen de voir qu'une ligne supprimée laisse un trou.
 * - **La ligne appartient à un AUTRE contexte.** La source est filtrée par une
 *   entrée du menu — un menu de catégorie ne montre qu'une catégorie — et les
 *   placements des autres catégories sont posés sur les mêmes slots à dessein,
 *   puisqu'un seul contexte est vivant à la fois. Les afficher couvre le menu
 *   de cases vides qui n'ont rien d'anormal, et donne l'illusion d'un
 *   territoire réservé alors qu'on est en placement libre.
 *
 * On ne peut pas les distinguer par la ligne absente — dans les deux cas la clé
 * est introuvable. On les distingue par la SOURCE : filtrée par un placeholder,
 * elle ne rend qu'une tranche du tout, donc l'absence n'y prouve rien.
 */
export function sourceIsContextFiltered(menu: Menu, sourceName: string): boolean {
  const rootName = sourceName.split(".")[0];
  const input = (menu.contextInputs ?? []).find((c) => c.name === rootName);
  if (!input || input.kind !== "sourceRef") return false;
  const values = [...Object.values(input.filter ?? {}), ...Object.values(input.params ?? {})];
  // Un placeholder (`{category}`) veut dire « cette source dépend du contexte » :
  // une valeur en dur filtre toujours pareil, donc une absence y est bien un trou.
  return values.some((v) => typeof v === "string" && /\{[^}]+\}/.test(v));
}
