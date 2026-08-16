import { describe, it, expect } from "vitest";
import { planWrite, applyRenames } from "./diskSave";

const BASE = { "menus/ancien.yaml": "title: A\n", "lang/fr.yaml": "x: y\n" };

/**
 * Renommer est un déplacement. L'arbre seul montre une disparition et une
 * apparition — seul l'éditeur sait que c'est le même Document.
 */
describe("applyRenames", () => {
  it("remplace supprimer+créer par un déplacement", async () => {
    const tree = { "menus/nouveau.yaml": "title: A\n", "lang/fr.yaml": "x: y\n" };
    const plan = await applyRenames(
      await planWrite(BASE, tree),
      [{ from: "menus/ancien.yaml", to: "menus/nouveau.yaml" }],
      BASE,
    );

    expect(plan.renames).toEqual([
      { from: "menus/ancien.yaml", to: "menus/nouveau.yaml", base_hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
    // Ni suppression de l'ancien, ni création du nouveau : le fichier bouge.
    expect(plan.deletes).toEqual([]);
    expect(plan.files).toEqual([]);
  });

  it("renommer ET modifier : le déplacement, puis une écriture basée sur l'ancien contenu", async () => {
    const tree = { "menus/nouveau.yaml": "title: A modifié\n", "lang/fr.yaml": "x: y\n" };
    const plan = await applyRenames(
      await planWrite(BASE, tree),
      [{ from: "menus/ancien.yaml", to: "menus/nouveau.yaml" }],
      BASE,
    );

    expect(plan.renames).toHaveLength(1);
    expect(plan.deletes).toEqual([]);
    expect(plan.files).toHaveLength(1);
    // Après le déplacement, la destination porte l'ancien contenu : c'est lui
    // que le compare-and-swap doit attendre, et non « aucun fichier ».
    expect(plan.files[0]!.base_hash).toBe(plan.renames[0]!.base_hash);
  });

  it("un renommage dont la source est inconnue de la base retombe en création", async () => {
    const tree = { "menus/nouveau.yaml": "title: N\n", ...BASE };
    const plan = await applyRenames(
      await planWrite(BASE, tree),
      [{ from: "menus/jamais_vu.yaml", to: "menus/nouveau.yaml" }],
      BASE,
    );

    expect(plan.renames).toEqual([]);
    expect(plan.files.map((f) => f.path)).toEqual(["menus/nouveau.yaml"]);
    expect(plan.files[0]!.base_hash).toBeNull();
  });

  it("sans renommage déclaré, le plan est inchangé", async () => {
    const tree = { "menus/ancien.yaml": "title: B\n", "lang/fr.yaml": "x: y\n" };
    const before = await planWrite(BASE, tree);
    const after = await applyRenames(before, [], BASE);
    expect(after.files).toEqual(before.files);
    expect(after.deletes).toEqual(before.deletes);
    expect(after.renames).toEqual([]);
  });
});
