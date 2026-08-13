import { describe, it, expect } from "vitest";
import { planWrite, toRelative } from "./diskSave";

/**
 * Le planificateur d'enregistrement (ADR `server-disk-only-storage`, P2).
 *
 * L'éditeur garde en mémoire la **base** : le contenu de chaque fichier tel
 * qu'il l'a chargé. Enregistrer = comparer l'arbre courant à cette base, et
 * n'envoyer que ce qui a bougé, chaque entrée portant le hash de sa base pour
 * que le plugin puisse refuser si le disque a changé entre-temps.
 */
describe("planWrite", () => {
  it("n'envoie que ce qui a changé", async () => {
    const baseline = {
      "menus/a.yaml": "title: A\n",
      "menus/b.yaml": "title: B\n",
    };
    const next = {
      "menus/a.yaml": "title: A\n", // inchangé
      "menus/b.yaml": "title: B modifié\n",
    };

    const plan = await planWrite(baseline, next);

    expect(plan.files.map((f) => f.path)).toEqual(["menus/b.yaml"]);
    expect(plan.files[0]!.content).toBe("title: B modifié\n");
    expect(plan.deletes).toEqual([]);
  });

  it("un fichier neuf part avec base_hash null", async () => {
    const plan = await planWrite({}, { "menus/neuf.yaml": "title: Neuf\n" });

    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]!.path).toBe("menus/neuf.yaml");
    // null = « je m'attends à ce qu'il n'y ait pas de fichier ici ».
    expect(plan.files[0]!.base_hash).toBeNull();
  });

  it("un fichier disparu de l'arbre devient une suppression portant son hash de base", async () => {
    const baseline = { "menus/vieux.yaml": "title: Vieux\n" };
    const plan = await planWrite(baseline, {});

    expect(plan.files).toEqual([]);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.deletes[0]!.path).toBe("menus/vieux.yaml");
    expect(plan.deletes[0]!.base_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("le base_hash d'un fichier modifié est celui de la BASE, pas du nouveau contenu", async () => {
    const baseline = { "menus/a.yaml": "ancien\n" };
    const plan = await planWrite(baseline, { "menus/a.yaml": "nouveau\n" });
    const planOfBase = await planWrite({}, { "menus/a.yaml": "ancien\n" });

    // sha256("ancien\n") — le jeton décrit ce qu'on croyait trouver sur disque.
    expect(plan.files[0]!.base_hash).not.toBeNull();
    expect(plan.files[0]!.base_hash).not.toBe(planOfBase.files[0]!.base_hash);
  });

  it("un arbre identique à la base ne produit aucune écriture", async () => {
    const tree = { "menus/a.yaml": "title: A\n", "lang/fr.yaml": "x: y\n" };
    const plan = await planWrite(tree, { ...tree });

    expect(plan.files).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.empty).toBe(true);
  });

  it("les chemins sortent triés — un diff lisible et un ordre d'écriture déterministe", async () => {
    const plan = await planWrite({}, {
      "menus/z.yaml": "z\n",
      "commands/a.yaml": "a\n",
      "lang/fr.yaml": "f\n",
    });

    expect(plan.files.map((f) => f.path)).toEqual([
      "commands/a.yaml",
      "lang/fr.yaml",
      "menus/z.yaml",
    ]);
  });
});

describe("toRelative", () => {
  it("retire le préfixe canonique que produit transform()", () => {
    const canonical = {
      "plugins/Artisan/projects/boutique_shop/menus/a.yaml": "title: A\n",
      "plugins/Artisan/projects/boutique_shop/.artisan/editor.yaml": "i18n_mode: inline\n",
    };

    expect(toRelative(canonical, "boutique_shop")).toEqual({
      "menus/a.yaml": "title: A\n",
      ".artisan/editor.yaml": "i18n_mode: inline\n",
    });
  });

  it("ignore ce qui n'appartient pas au project — jamais d'écriture hors de son arbre", () => {
    const canonical = {
      "plugins/Artisan/projects/boutique_shop/menus/a.yaml": "title: A\n",
      "plugins/Artisan/projects/autre_project/menus/vole.yaml": "title: Volé\n",
    };

    expect(toRelative(canonical, "boutique_shop")).toEqual({ "menus/a.yaml": "title: A\n" });
  });
});
