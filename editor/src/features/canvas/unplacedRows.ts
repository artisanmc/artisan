/**
 * What is left to place in an Element in **placement mode**.
 *
 * A parameterised menu carries the Placements of all its contexts; the rows
 * come from the current **Preview context**. The remainder is therefore
 * always computed against the rows visible now — which is what makes the
 * tray follow navigation from category to category (ADR
 * `parameterised-menu-over-menu-per-category`).
 */
export function unplacedRows(
  places: { keyField: string; placements: readonly { key: string }[] },
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const placed = new Set(places.placements.map((p) => p.key));
  return rows.filter((row) => {
    const key = row[places.keyField];
    // A row without a key cannot be placed: keeping it in the tray would show
    // a tile no click could place.
    if (key === undefined || key === null) return false;
    return !placed.has(String(key));
  });
}
