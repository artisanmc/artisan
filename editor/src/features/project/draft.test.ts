import { describe, it, expect } from "vitest";
import { isDirty, draftAge } from "./draft";

/**
 * Le brouillon (ADR `server-disk-only-storage`, décisions 3 et 7 révisées) : la
 * base et l'arbre courant, gardés dans le navigateur.
 *
 * `isDirty` répond à la seule question qui compte pour l'admin — « ai-je du
 * travail non enregistré ? » — et elle doit y répondre **sans** hacher quoi que
 * ce soit : elle alimente un indicateur permanent, pas un enregistrement.
 */
describe("isDirty", () => {
  it("un arbre identique à la base n'est pas sale", () => {
    const t = { "menus/a.yaml": "x\n", "lang/fr.yaml": "y\n" };
    expect(isDirty(t, { ...t })).toBe(false);
  });

  it("un contenu modifié est sale", () => {
    expect(isDirty({ "menus/a.yaml": "x\n" }, { "menus/a.yaml": "z\n" })).toBe(true);
  });

  it("un fichier ajouté est sale", () => {
    expect(isDirty({}, { "menus/a.yaml": "x\n" })).toBe(true);
  });

  it("un fichier supprimé est sale", () => {
    expect(isDirty({ "menus/a.yaml": "x\n" }, {})).toBe(true);
  });

  it("une base absente avec un arbre vide n'est pas sale", () => {
    // Un project fraîchement ouvert et vide ne doit pas s'annoncer modifié.
    expect(isDirty(undefined, {})).toBe(false);
  });

  it("une base absente avec du contenu est sale", () => {
    // Rien n'a jamais été lu du serveur : tout est à écrire.
    expect(isDirty(undefined, { "menus/a.yaml": "x\n" })).toBe(true);
  });
});

describe("draftAge", () => {
  it("rend l'âge en heures depuis la prise de la base", () => {
    const now = new Date("2026-08-15T12:00:00Z").getTime();
    const at = new Date("2026-08-15T09:00:00Z").getTime();
    expect(draftAge(at, now)).toBe(3);
  });

  it("arrondit vers le bas — un brouillon de 59 minutes a zéro heure", () => {
    const now = new Date("2026-08-15T12:00:00Z").getTime();
    expect(draftAge(now - 59 * 60_000, now)).toBe(0);
  });
});
