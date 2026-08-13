import { describe, it, expect } from "vitest";
import { applyResolutions } from "./resolveConflicts";

/**
 * Résolution d'un conflit d'enregistrement (ADR `server-disk-only-storage`, P2).
 *
 * Tout passe par un seul geste : **adopter le contenu disque comme base**.
 * - « garder ma version » → la base devient le disque, donc le ré-enregistrement
 *   porte le bon jeton et écrase légitimement ;
 * - « prendre celle du serveur » → la base devient le disque *et* l'arbre de
 *   l'éditeur aussi, donc il n'y a plus rien à écrire pour ce fichier.
 */
describe("applyResolutions", () => {
  const conflicts = [
    { path: "menus/a.yaml", disk: "title: A serveur\n" },
    { path: "menus/b.yaml", disk: "title: B serveur\n" },
  ];

  it("« garder ma version » rebase sans toucher à l'arbre de l'éditeur", () => {
    const out = applyResolutions({}, conflicts, {
      "menus/a.yaml": "mine",
      "menus/b.yaml": "mine",
    });

    expect(out.nextBaseline).toEqual({
      "menus/a.yaml": "title: A serveur\n",
      "menus/b.yaml": "title: B serveur\n",
    });
    // Rien à réintégrer : l'éditeur garde ce qu'il a.
    expect(out.adoptFromDisk).toEqual({});
  });

  it("« prendre celle du serveur » rebase ET rend le contenu à réintégrer", () => {
    const out = applyResolutions({}, conflicts, {
      "menus/a.yaml": "disk",
      "menus/b.yaml": "mine",
    });

    expect(out.nextBaseline["menus/a.yaml"]).toBe("title: A serveur\n");
    expect(out.adoptFromDisk).toEqual({ "menus/a.yaml": "title: A serveur\n" });
  });

  it("un fichier supprimé sur disque sort de la base au lieu d'y rester à null", () => {
    const out = applyResolutions(
      { "menus/parti.yaml": "title: Ancien\n" },
      [{ path: "menus/parti.yaml", disk: null }],
      { "menus/parti.yaml": "mine" },
    );

    // Absent de la base = « je m'attends à ce qu'il n'y ait pas de fichier ici »,
    // ce qui produira base_hash null au ré-enregistrement : exactement l'état
    // du disque.
    expect("menus/parti.yaml" in out.nextBaseline).toBe(false);
  });

  it("« prendre celle du serveur » sur un fichier supprimé le marque pour retrait", () => {
    const out = applyResolutions(
      { "menus/parti.yaml": "title: Ancien\n" },
      [{ path: "menus/parti.yaml", disk: null }],
      { "menus/parti.yaml": "disk" },
    );

    expect("menus/parti.yaml" in out.nextBaseline).toBe(false);
    expect(out.removeFromTree).toEqual(["menus/parti.yaml"]);
  });

  it("préserve les entrées de base non conflictuelles", () => {
    const out = applyResolutions(
      { "lang/fr.yaml": "x: y\n" },
      [{ path: "menus/a.yaml", disk: "title: A\n" }],
      { "menus/a.yaml": "mine" },
    );

    expect(out.nextBaseline["lang/fr.yaml"]).toBe("x: y\n");
  });

  it("un fichier sans choix explicite est laissé intact — jamais de défaut silencieux", () => {
    const out = applyResolutions({}, conflicts, { "menus/a.yaml": "mine" });

    // b n'a pas été tranché : sa base ne bouge pas, donc le ré-enregistrement
    // rebutera dessus plutôt que de trancher à la place de l'admin.
    expect("menus/b.yaml" in out.nextBaseline).toBe(false);
    expect(out.unresolved).toEqual(["menus/b.yaml"]);
  });
});
