import { describe, it, expect } from "vitest";
import { isDirty, draftAge } from "./draft";

/**
 * The draft (ADR `server-disk-only-storage`, revised decisions 3 and 7): the
 * base and the current tree, kept in the browser.
 *
 * `isDirty` answers the only question that matters to the admin — "do I have
 * unsaved work?" — and must answer it **without** hashing anything: it feeds a
 * permanent indicator, not a save.
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
    // A freshly opened, empty project must not report itself as modified.
    expect(isDirty(undefined, {})).toBe(false);
  });

  it("une base absente avec du contenu est sale", () => {
    // Nothing was ever read from the server: everything is to be written.
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
