import { describe, expect, it } from "vitest";

import { isResolvedContext } from "./resolvedContexts";

/**
 * Un contexte d'appel se calcule en résolvant les arguments du lien contre les
 * lignes de l'appelant. Quand la source n'a pas de données — serveur non lié,
 * donc aucun snapshot — il n'y a aucune ligne à itérer et les templates
 * ressortent tels quels : `{cat}`, `{cat.id}`. Les proposer comme contexte donne
 * un bandeau qui affiche « Vu depuis : shop_main › {cat} » et un choix qui ne
 * change rien.
 */
describe("isResolvedContext", () => {
  it("accepte des valeurs réellement résolues", () => {
    expect(isResolvedContext({ category: "les_cles", category_name: "Les Clés" })).toBe(true);
  });

  it("accepte une valeur non-texte (la ligne entière passée telle quelle)", () => {
    expect(isResolvedContext({ cat: { id: "les_cles", name: "Les Clés" } })).toBe(true);
  });

  it("rejette un template resté brut", () => {
    expect(isResolvedContext({ category: "{cat.id}" })).toBe(false);
    expect(isResolvedContext({ cat: "{cat}" })).toBe(false);
  });

  /** Un seul argument non résolu suffit : l'écran obtenu serait faux. */
  it("rejette dès qu'un argument sur deux est brut", () => {
    expect(isResolvedContext({ category: "les_cles", category_name: "{cat.name}" })).toBe(false);
  });

  it("accepte une accolade qui n'est pas un template", () => {
    expect(isResolvedContext({ label: "Pack {rare}" })).toBe(false);
    expect(isResolvedContext({ label: "100% coton" })).toBe(true);
  });
});
