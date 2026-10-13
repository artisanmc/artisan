import { describe, expect, it } from "vitest";

import { unplacedRows } from "./unplacedRows";

/**
 * What is left to place, for the current **Preview context**.
 *
 * This is the missing signal: adding a category filled the source without
 * anything on the board showing there was work to do. The rows come from the
 * context being viewed, so the tray changes when navigating from one category
 * to another (ADR `parameterised-menu-over-menu-per-category`).
 */
const ROWS = [
  { id: "cle_legendaire", name: "Clé Légendaire" },
  { id: "cle_rare", name: "Clé Rare" },
  { id: "cle_cosmetique", name: "Clé Cosmétique" },
];

describe("unplacedRows", () => {
  it("renders only the rows that no placement claims", () => {
    const out = unplacedRows(
      { keyField: "id", placements: [{ key: "cle_rare" }] },
      ROWS,
    );
    expect(out.map((r) => r.id)).toEqual(["cle_legendaire", "cle_cosmetique"]);
  });

  it("returns an empty list when everything is placed — the tray disappears", () => {
    const out = unplacedRows(
      {
        keyField: "id",
        placements: ROWS.map((r) => ({ key: r.id })),
      },
      ROWS,
    );
    expect(out).toEqual([]);
  });

  /** A placement matching no row (neighbouring category, deleted row) must
   *  hide nothing here — it lives on, silently. */
  it("ignores placements without a matching row", () => {
    const out = unplacedRows(
      { keyField: "id", placements: [{ key: "kit_mineur" }] },
      ROWS,
    );
    expect(out).toHaveLength(3);
  });

  it("returns an empty list for an empty source", () => {
    expect(unplacedRows({ keyField: "id", placements: [] }, [])).toEqual([]);
  });

  /**
   * Misconfigured `keyField`: no row carries the key, so NONE is placeable — a
   * placement pins by Row key. Showing them anyway would give tiles no click
   * can place; the tray stays silent and the panel has to flag the
   * misconfigured source.
   */
  it("drops rows without a Row key rather than offering dead tiles", () => {
    expect(unplacedRows({ keyField: "missing", placements: [] }, ROWS)).toEqual([]);
  });
});
