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
  const now = new Date("2026-08-15T12:00:00Z").getTime();

  it("rend les heures pleines au-delà d'une heure", () => {
    expect(draftAge(now - 3 * 3_600_000, now)).toEqual({ unit: "hours", value: 3 });
  });

  it("rend les minutes en deçà — « il y a 0 h » ne veut rien dire", () => {
    expect(draftAge(now - 12 * 60_000, now)).toEqual({ unit: "minutes", value: 12 });
  });

  it("un brouillon tout juste pris se dit « à l'instant », pas « 0 minute »", () => {
    expect(draftAge(now - 20_000, now)).toEqual({ unit: "now", value: 0 });
  });

  it("les jours au-delà de 48 h : « il y a 73 h » ne se lit pas", () => {
    expect(draftAge(now - 73 * 3_600_000, now)).toEqual({ unit: "days", value: 3 });
  });
});
