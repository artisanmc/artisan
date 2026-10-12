import { expect, test } from "bun:test";
import vectors from "../../../testdata/resource-pack-conformance.json";
import { buildCase, entriesOf, type ConformanceCase } from "../../scripts/gen-resource-pack-conformance";

// Le constructeur du backend est la source du vecteur : un écart ici veut dire
// que le pack a changé — régénérer le vecteur, et refaire passer l'éditeur.
for (const c of vectors.cases as ConformanceCase[])
  test(`resource pack conformance: ${c.name}`, () => {
    const { zipBytes, hash } = buildCase(c);
    expect(entriesOf(zipBytes)).toEqual({ entries: c.entries, textYFonts: c.textYFonts });
    expect(hash).toBe(c.sha1);
  });
