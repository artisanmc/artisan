import { describe, expect, it } from "vitest";

import { unplacedRows } from "./unplacedRows";

/**
 * Ce qui reste à poser, pour le **Preview context** courant.
 *
 * C'est le signal qui manquait : ajouter une catégorie remplissait la source
 * sans que rien, sur la planche, n'indique qu'il y avait du travail. Les lignes
 * viennent du contexte regardé, donc le plateau change quand on navigue d'une
 * catégorie à l'autre (ADR `parameterised-menu-over-menu-per-category`).
 */
const ROWS = [
  { id: "cle_legendaire", name: "Clé Légendaire" },
  { id: "cle_rare", name: "Clé Rare" },
  { id: "cle_cosmetique", name: "Clé Cosmétique" },
];

describe("unplacedRows", () => {
  it("ne rend que les lignes qu'aucun placement ne réclame", () => {
    const out = unplacedRows(
      { keyField: "id", placements: [{ key: "cle_rare" }] },
      ROWS,
    );
    expect(out.map((r) => r.id)).toEqual(["cle_legendaire", "cle_cosmetique"]);
  });

  it("rend une liste vide quand tout est posé — le plateau disparaît", () => {
    const out = unplacedRows(
      {
        keyField: "id",
        placements: ROWS.map((r) => ({ key: r.id })),
      },
      ROWS,
    );
    expect(out).toEqual([]);
  });

  /** Un placement qui ne matche aucune ligne (catégorie voisine, ligne
   *  supprimée) ne doit rien masquer ici — il vit sa vie, silencieux. */
  it("ignore les placements sans ligne correspondante", () => {
    const out = unplacedRows(
      { keyField: "id", placements: [{ key: "kit_mineur" }] },
      ROWS,
    );
    expect(out).toHaveLength(3);
  });

  it("rend une liste vide sur une source vide", () => {
    expect(unplacedRows({ keyField: "id", placements: [] }, [])).toEqual([]);
  });

  /**
   * `keyField` mal réglé : aucune ligne ne porte la clé, donc AUCUNE n'est
   * plaçable — un placement s'épingle par Row key. Les afficher quand même
   * donnerait des tuiles qu'aucun clic ne peut poser ; le plateau reste muet et
   * c'est le panneau qui doit signaler la source mal configurée.
   */
  it("écarte les lignes sans Row key plutôt que d'offrir des tuiles mortes", () => {
    expect(unplacedRows({ keyField: "missing", placements: [] }, ROWS)).toEqual([]);
  });
});
