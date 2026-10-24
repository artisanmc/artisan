import type { I18nKey, ProjectId } from "@/domain/types";
import { flattenLangTree } from "@/lib/langTree";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { projectFromFiles } from "./projectFromFiles";
import { projectToFiles } from "./projectToFiles";

const base = "plugins/Artisan/projects/auctions";

const MODULE = "schema: module/v1\ndefault_lang: en\nlanguages: [en, fr]\n";

const MENU = `schema: menu/v1
id: main
title: "{i18n:auctions.legacy_title}"
size: 9
layers:
  - id: main
    elements: []
`;

function lang(out: Record<string, string>, code: string): Record<string, string> {
  const file = out[`${base}/lang/${code}.yml`];
  return file ? flattenLangTree(parse(file)) : {};
}

describe("lang keys nothing in the module reads", () => {
  const files = {
    [`${base}/artisan-module.yml`]: MODULE,
    [`${base}/menus/main.yml`]: MENU,
    [`${base}/lang/en.yml`]:
      'auctions:\n  legacy_title: "Auction house"\n  messages:\n    no_item: "<red>Hold the item."\nmenus:\n  gone:\n    title: "Old"\n',
    [`${base}/lang/fr.yml`]: 'auctions:\n  messages:\n    no_item: "<red>Tenez l\'objet."\n',
  };

  it("are written back as they were read", () => {
    const project = projectFromFiles("auctions" as ProjectId, files);
    expect(project.keptLangKeys).toEqual(["auctions.messages.no_item"]);
    const out = projectToFiles(project);
    expect(lang(out, "en")["auctions.messages.no_item"]).toBe("<red>Hold the item.");
    expect(lang(out, "fr")["auctions.messages.no_item"]).toBe("<red>Tenez l'objet.");
    // The menu's title is now in the menu, and a key under the editor's own
    // namespaces is a site's: neither stays in lang/.
    expect(lang(out, "en")["auctions.legacy_title"]).toBeUndefined();
    expect(lang(out, "en")["menus.gone.title"]).toBeUndefined();
  });

  it("follow their edits, and go once removed", () => {
    const project = projectFromFiles("auctions" as ProjectId, files);
    const key = "auctions.messages.no_item" as I18nKey;
    project.i18nKeys[key] = { en: "<red>Edited." };
    let out = projectToFiles(project);
    expect(lang(out, "en")[key]).toBe("<red>Edited.");
    expect(lang(out, "fr")[key]).toBeUndefined();
    delete project.i18nKeys[key];
    out = projectToFiles(project);
    expect(lang(out, "en")[key]).toBeUndefined();
  });

  it("reach a fixed point", () => {
    const once = projectToFiles(projectFromFiles("auctions" as ProjectId, files));
    expect(projectToFiles(projectFromFiles("auctions" as ProjectId, once))).toEqual(once);
  });
});
