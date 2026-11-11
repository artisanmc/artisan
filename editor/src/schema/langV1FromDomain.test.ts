import { projectId } from "@/domain/ids";
import type { Project } from "@/domain/types";
import { DURATION_KEYS } from "@/lib/expr/duration";
import { flattenLangTree } from "@/lib/langTree";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { projectToFiles } from "./projectToFiles";

const BASE = "plugins/Artisan/projects/p_test";

const makeProject = (overrides: Partial<Project> = {}): Project =>
  ({
    id: projectId("p_test"),
    name: "Test",
    description: "",
    source: "user_created",
    defaultLang: "en",
    createdAt: "",
    updatedAt: "",
    i18nKeys: {},
    documents: {
      menu: [],
      command: [],
      dialog: [],
    },
    assets: [],
    canvasLayout: {},
    ...overrides,
  }) as Project;

const langOf = (files: Record<string, string>, lang: string) =>
  flattenLangTree(parse(files[`${BASE}/lang/${lang}.yml`] ?? ""));

/**
 * Presentation keys (`artisan.duration.*`) belong to the **project**, not to any
 * document site — so unlike a menu title they have nowhere to be inlined, and the
 * lang file is their only home (ADR `expression-parity` §8).
 */
describe("presentation keys in lang files", () => {
  it("are written out with their defaults", () => {
    const files = projectToFiles(makeProject());

    const lang = langOf(files, "en");
    expect(lang[DURATION_KEYS.hours]).toBe("{n}h");
    expect(lang[DURATION_KEYS.minutes]).toBe("{n}m");
    expect(lang[DURATION_KEYS.days]).toBe("{n}d");
    expect(lang[DURATION_KEYS.seconds]).toBe("{n}s");
  });

  it("carry nothing else — site-addressed text stays in its document", () => {
    const files = projectToFiles(makeProject());

    expect(Object.keys(langOf(files, "en")).sort()).toEqual(Object.values(DURATION_KEYS).sort());
  });

  it("keep an admin's override instead of the default", () => {
    const files = projectToFiles(
      makeProject({
        i18nKeys: { [DURATION_KEYS.hours]: { en: "{n} hours" } } as Project["i18nKeys"],
      }),
    );

    expect(langOf(files, "en")[DURATION_KEYS.hours]).toBe("{n} hours");
    // The untouched ones still land on their defaults.
    expect(langOf(files, "en")[DURATION_KEYS.minutes]).toBe("{n}m");
  });
});
