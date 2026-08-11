/**
 * Ce qu'il reste à poser dans un Élément en **mode placement**.
 *
 * Un menu paramétré porte les Placements de tous ses contextes ; les lignes, elles,
 * viennent du **Preview context** courant. Le reliquat se calcule donc toujours
 * contre les lignes visibles maintenant — c'est ce qui fait que le plateau suit la
 * navigation de catégorie en catégorie (ADR
 * `parameterised-menu-over-menu-per-category`).
 */
export function unplacedRows(
  places: { keyField: string; placements: readonly { key: string }[] },
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const placed = new Set(places.placements.map((p) => p.key));
  return rows.filter((row) => {
    const key = row[places.keyField];
    // Une ligne sans clé n'est pas plaçable : la garder dans le plateau
    // afficherait une tuile qu'aucun clic ne pourrait poser.
    if (key === undefined || key === null) return false;
    return !placed.has(String(key));
  });
}
